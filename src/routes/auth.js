import express from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Household from '../models/Household.js';
import HouseholdMember from '../models/HouseholdMember.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import {
  createHouseholdForUser,
  findHouseholdByJoinCode,
  getUserMembership,
  getUserAwaitingMembership,
  buildAuthResponse,
} from '../services/householdService.js';
import {
  requestOtpSend,
  verifyUserOtp,
  otpRateLimitMeta,
  getOtpRateLimitStatus,
  sendOtpRateLimitResponse,
  clearExpiredOtpBlock,
} from '../services/otpService.js';
import { recordChange } from '../services/auditService.js';
import { generateJoinCode } from '../utils/joinCode.js';

const router = express.Router();
const IS_DEV = process.env.NODE_ENV !== 'production';

function withOtpMeta(user, body, devOtp) {
  return {
    ...body,
    ...otpRateLimitMeta(user),
    resendAvailableIn: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS) || 30,
    ...(IS_DEV && devOtp ? { devOtp } : {}),
  };
}

async function sessionPayload(user) {
  const active = await getUserMembership(user._id);
  const awaiting = await getUserAwaitingMembership(user._id);
  const membership = active || awaiting;
  const household = membership ? await Household.findById(membership.householdId) : null;
  const auth = await buildAuthResponse(user, membership, household);
  const token = signToken(user._id);
  return { token, ...auth };
}

async function ensureHouseholdJoinCode(household) {
  if (household.joinCode) return household;
  for (let i = 0; i < 10; i++) {
    const code = generateJoinCode();
    const clash = await Household.findOne({ joinCode: code });
    if (!clash) {
      household.joinCode = code;
      await household.save();
      return household;
    }
  }
  return household;
}

/** Signup — optional joinCode requests access to an existing dashboard */
router.post('/signup', async (req, res) => {
  try {
    const { email, password, name, joinCode, role = 'viewer' } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (joinCode && !['viewer', 'editor'].includes(role)) {
      return res.status(400).json({ error: 'Role must be viewer or editor when joining a dashboard' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      email: normalizedEmail,
      passwordHash,
      name: name.trim(),
      isActive: false,
    });

    let devOtp;

    if (joinCode) {
      const household = await findHouseholdByJoinCode(joinCode);
      if (!household) {
        await user.deleteOne();
        return res.status(400).json({ error: 'Invalid dashboard join code' });
      }

      const dup = await HouseholdMember.findOne({ householdId: household._id, email: normalizedEmail });
      if (dup) {
        await user.deleteOne();
        return res.status(409).json({ error: 'Already requested or joined this dashboard' });
      }

      const member = await HouseholdMember.create({
        householdId: household._id,
        userId: user._id,
        email: normalizedEmail,
        role,
        status: 'awaiting_approval',
        joinCodeUsed: household.joinCode,
      });

      await recordChange({
        householdId: household._id,
        userId: user._id,
        userName: name.trim(),
        section: 'team',
        action: 'join_request',
        entityId: member._id.toString(),
        summary: `requested ${role} access to the dashboard`,
        details: normalizedEmail,
        notificationType: 'join_request',
        notifyRoles: ['owner'],
      });

      devOtp = await requestOtpSend(user, 'activation');
      const payload = await sessionPayload(user);
      return res.status(201).json(withOtpMeta(user, {
        ...payload,
        message: 'Verify your email with OTP, then wait for the dashboard owner to approve access.',
      }, devOtp));
    }

    await createHouseholdForUser(user);
    devOtp = await requestOtpSend(user, 'activation');
    const payload = await sessionPayload(user);
    res.status(201).json(withOtpMeta(user, {
      ...payload,
      message: 'Account created. Check your email for a verification code.',
    }, devOtp));
  } catch (err) {
    if (sendOtpRateLimitResponse(res, err)) return;
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    if (!user.isActive) {
      const devOtp = await requestOtpSend(user, 'activation');
      const payload = await sessionPayload(user);
      return res.status(403).json(withOtpMeta(user, {
        ...payload,
        error: 'Account not activated',
        code: 'NEEDS_VERIFICATION',
      }, devOtp));
    }

    const payload = await sessionPayload(user);
    res.json(payload);
  } catch (err) {
    if (sendOtpRateLimitResponse(res, err)) return;
    res.status(500).json({ error: err.message });
  }
});

/** Passwordless login — send OTP to email */
router.post('/login-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.json({ ok: true, message: 'If the email exists, a login code was sent' });
    }

    const devOtp = await requestOtpSend(user, 'login');
    res.json(withOtpMeta(user, {
      ok: true,
      message: 'Login code sent to your email',
    }, devOtp));
  } catch (err) {
    if (sendOtpRateLimitResponse(res, err)) return;
    res.status(500).json({ error: err.message });
  }
});

router.get('/otp-status', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.json({ allowed: true, resendAvailableIn: 0, sendsRemaining: 5, blocked: false });
    }

    clearExpiredOtpBlock(user);
    const status = getOtpRateLimitStatus(user);
    res.json({
      allowed: status.allowed,
      blocked: status.code === 'OTP_BLOCKED',
      code: status.code,
      resendAvailableIn: status.resendAvailableIn || 0,
      retryAfterSeconds: status.retryAfterSeconds || 0,
      blockedUntil: status.blockedUntil || null,
      sendsRemaining: status.sendsRemaining ?? 0,
      message: status.allowed ? null : status.message,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp, purpose = 'activation' } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.status(400).json({ error: 'Invalid OTP' });
    if (user.otpPurpose && user.otpPurpose !== purpose) {
      return res.status(400).json({ error: 'Invalid OTP type' });
    }

    const ok = await verifyUserOtp(user, otp);
    if (!ok) return res.status(400).json({ error: 'Invalid or expired OTP' });

    if (purpose === 'activation' || purpose === 'login') {
      if (!user.isActive) {
        user.isActive = true;
        await user.save();
      }
    }

    const payload = await sessionPayload(user);
    const messages = {
      activation: 'Account activated',
      login: 'Logged in',
      reset: 'OTP verified',
    };
    res.json({ ...payload, message: messages[purpose] || 'OTP verified' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/resend-otp', async (req, res) => {
  try {
    const { email, purpose = 'activation' } = req.body;
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.json({ ok: true, message: 'If the email exists, a new OTP was sent' });

    const devOtp = await requestOtpSend(user, purpose);
    res.json(withOtpMeta(user, {
      ok: true,
      message: 'New OTP sent',
    }, devOtp));
  } catch (err) {
    if (sendOtpRateLimitResponse(res, err)) return;
    res.status(500).json({ error: err.message });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.json({ ok: true, message: 'If the email exists, an OTP was sent' });
    }

    const devOtp = await requestOtpSend(user, 'reset');
    res.json(withOtpMeta(user, {
      ok: true,
      message: 'Password reset OTP sent',
    }, devOtp));
  } catch (err) {
    if (sendOtpRateLimitResponse(res, err)) return;
    res.status(500).json({ error: err.message });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'Email, OTP, and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user || user.otpPurpose !== 'reset') {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    const ok = await verifyUserOtp(user, otp);
    if (!ok) return res.status(400).json({ error: 'Invalid or expired OTP' });

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.isActive = true;
    await user.save();

    const payload = await sessionPayload(user);
    res.json({ ...payload, message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


router.get('/me', requireAuth, async (req, res) => {
  try {
    const household = req.householdId ? await Household.findById(req.householdId) : null;
    if (household) await ensureHouseholdJoinCode(household);
    const auth = await buildAuthResponse(req.user, req.membership, household);
    res.json(auth);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/status', requireAuth, async (req, res) => {
  try {
    const household = req.householdId ? await Household.findById(req.householdId) : null;
    res.json({
      needsVerification: !req.user.isActive,
      awaitingApproval: req.awaitingApproval,
      householdName: household?.name,
      email: req.user.email,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
