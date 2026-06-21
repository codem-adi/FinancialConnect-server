import express from 'express';
import User from '../models/User.js';
import Household from '../models/Household.js';
import HouseholdMember from '../models/HouseholdMember.js';
import { requireAuth, requireEditor, signToken } from '../middleware/auth.js';
import { recordChange } from '../services/auditService.js';
import {
  sendJoinApprovedEmail,
  sendJoinRejectedEmail,
  sendTeamInviteEmail,
} from '../services/emailService.js';
import {
  createHouseholdForUser,
  getUserMembership,
  buildAuthResponse,
} from '../services/householdService.js';
import {
  requestOtpSend,
  verifyUserOtp,
  otpRateLimitMeta,
  sendOtpRateLimitResponse,
} from '../services/otpService.js';
import { generateJoinCode } from '../utils/joinCode.js';

const router = express.Router();
const IS_DEV = process.env.NODE_ENV !== 'production';

async function ensureJoinCode(household) {
  if (household.joinCode) return household.joinCode;
  for (let i = 0; i < 10; i++) {
    const code = generateJoinCode();
    const clash = await Household.findOne({ joinCode: code });
    if (!clash) {
      household.joinCode = code;
      await household.save();
      return code;
    }
  }
  return household.joinCode;
}

router.get('/join-code', requireAuth, async (req, res) => {
  try {
    if (req.role !== 'owner') return res.status(403).json({ error: 'Only the dashboard owner can view the join code' });
    const household = await Household.findById(req.householdId);
    const joinCode = await ensureJoinCode(household);
    res.json({ joinCode, householdName: household.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/join-requests', requireAuth, async (req, res) => {
  try {
    if (req.role !== 'owner') return res.status(403).json({ error: 'Only the owner can review join requests' });
    const requests = await HouseholdMember.find({
      householdId: req.householdId,
      status: 'awaiting_approval',
    }).sort({ createdAt: -1 });

    const userIds = requests.filter((r) => r.userId).map((r) => r.userId);
    const users = await User.find({ _id: { $in: userIds } });
    const userMap = Object.fromEntries(users.map((u) => [u._id.toString(), u]));

    res.json({
      requests: requests.map((r) => ({
        id: r._id,
        email: r.email,
        name: r.userId ? userMap[r.userId.toString()]?.name : null,
        role: r.role,
        joinCodeUsed: r.joinCodeUsed,
        requestedAt: r.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/join-requests/:id/approve', requireAuth, async (req, res) => {
  try {
    if (req.role !== 'owner') return res.status(403).json({ error: 'Only the owner can approve requests' });
    const member = await HouseholdMember.findOne({
      _id: req.params.id,
      householdId: req.householdId,
      status: 'awaiting_approval',
    });
    if (!member) return res.status(404).json({ error: 'Request not found' });

    member.status = 'active';
    await member.save();

    const household = await Household.findById(req.householdId);
    const approvedUser = member.userId ? await User.findById(member.userId) : null;
    await sendJoinApprovedEmail(member.email, {
      name: approvedUser?.name,
      householdName: household?.name || 'the dashboard',
      role: member.role,
    });

    await recordChange({
      householdId: req.householdId,
      userId: req.user._id,
      userName: req.user.name,
      section: 'team',
      action: 'approve_join',
      entityId: member._id.toString(),
      summary: `Approved dashboard access for ${member.email}`,
    });

    res.json({ ok: true, member: { id: member._id, email: member.email, status: member.status } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/join-requests/:id/reject', requireAuth, async (req, res) => {
  try {
    if (req.role !== 'owner') return res.status(403).json({ error: 'Only the owner can reject requests' });
    const member = await HouseholdMember.findOne({
      _id: req.params.id,
      householdId: req.householdId,
      status: 'awaiting_approval',
    });
    if (!member) return res.status(404).json({ error: 'Request not found' });

    member.status = 'rejected';
    await member.save();

    const household = await Household.findById(req.householdId);
    const rejectedUser = member.userId ? await User.findById(member.userId) : null;
    await sendJoinRejectedEmail(member.email, {
      name: rejectedUser?.name,
      householdName: household?.name || 'the dashboard',
    });

    await recordChange({
      householdId: req.householdId,
      userId: req.user._id,
      userName: req.user.name,
      section: 'team',
      action: 'reject_join',
      entityId: member._id.toString(),
      summary: `Rejected dashboard access for ${member.email}`,
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/members', requireAuth, async (req, res) => {
  try {
    const members = await HouseholdMember.find({
      householdId: req.householdId,
      status: { $in: ['active', 'pending', 'awaiting_approval'] },
    }).sort({ createdAt: 1 });
    const userIds = members.filter((m) => m.userId).map((m) => m.userId);
    const users = await User.find({ _id: { $in: userIds } });
    const userMap = Object.fromEntries(users.map((u) => [u._id.toString(), u]));

    res.json({
      members: members.map((m) => ({
        id: m._id,
        userId: m.userId,
        email: m.email,
        name: m.userId ? userMap[m.userId.toString()]?.name : null,
        role: m.role,
        status: m.status,
        invitedAt: m.invitedAt,
        isSelf: m.userId?.toString() === req.user._id.toString(),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/members', requireAuth, requireEditor, async (req, res) => {
  try {
    const { email, role = 'viewer' } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    if (!['viewer', 'editor'].includes(role)) {
      return res.status(400).json({ error: 'Role must be viewer or editor' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await HouseholdMember.findOne({
      householdId: req.householdId,
      email: normalizedEmail,
    });
    if (existing) return res.status(409).json({ error: 'Member already invited' });

    const invitedUser = await User.findOne({ email: normalizedEmail });
    const household = await Household.findById(req.householdId);
    const member = await HouseholdMember.create({
      householdId: req.householdId,
      userId: invitedUser?._id || null,
      email: normalizedEmail,
      role,
      status: invitedUser?.isActive ? 'active' : 'pending',
      invitedBy: req.user._id,
    });

    await sendTeamInviteEmail(normalizedEmail, {
      householdName: household?.name || 'a financial dashboard',
      role,
      inviterName: req.user.name,
    });

    await recordChange({
      householdId: req.householdId,
      userId: req.user._id,
      userName: req.user.name,
      section: 'team',
      action: 'invite',
      entityId: member._id.toString(),
      summary: `Invited ${normalizedEmail} as ${role}`,
    });

    res.status(201).json({
      member: {
        id: member._id,
        email: member.email,
        role: member.role,
        status: member.status,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/members/:id', requireAuth, requireEditor, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['viewer', 'editor'].includes(role)) {
      return res.status(400).json({ error: 'Role must be viewer or editor' });
    }

    const member = await HouseholdMember.findOne({
      _id: req.params.id,
      householdId: req.householdId,
    });
    if (!member) return res.status(404).json({ error: 'Member not found' });
    if (member.role === 'owner') return res.status(403).json({ error: 'Cannot change owner role' });

    member.role = role;
    await member.save();

    await recordChange({
      householdId: req.householdId,
      userId: req.user._id,
      userName: req.user.name,
      section: 'team',
      action: 'update_role',
      entityId: member._id.toString(),
      summary: `Changed ${member.email} access to ${role}`,
    });

    res.json({ member: { id: member._id, email: member.email, role: member.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/members/:id', requireAuth, requireEditor, async (req, res) => {
  try {
    const member = await HouseholdMember.findOne({
      _id: req.params.id,
      householdId: req.householdId,
    });
    if (!member) return res.status(404).json({ error: 'Member not found' });
    if (member.role === 'owner') return res.status(403).json({ error: 'Cannot remove owner' });
    if (member.userId?.toString() === req.user._id.toString()) {
      return res.status(403).json({ error: 'Use “Leave group” to exit this dashboard' });
    }

    await member.deleteOne();

    await recordChange({
      householdId: req.householdId,
      userId: req.user._id,
      userName: req.user.name,
      section: 'team',
      action: 'remove',
      entityId: member._id.toString(),
      summary: `Removed ${member.email} from financial group`,
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Leave the current household — non-owners get a fresh personal dashboard */
async function executeLeaveGroup(user, membership) {
  if (!membership) {
    const err = new Error('No group membership to leave');
    err.status = 403;
    throw err;
  }

  if (membership.role === 'owner') {
    const otherMembers = await HouseholdMember.countDocuments({
      householdId: membership.householdId,
      status: 'active',
      _id: { $ne: membership._id },
    });
    if (otherMembers > 0) {
      const err = new Error('You own this dashboard. Remove other members or transfer ownership before leaving.');
      err.status = 403;
      throw err;
    }
    const err = new Error('You are the dashboard owner. This is your personal household — there is no group to leave.');
    err.status = 403;
    throw err;
  }

  const leftHouseholdId = membership.householdId;
  const leftHousehold = await Household.findById(leftHouseholdId);
  const memberId = membership._id.toString();

  await membership.deleteOne();

  await recordChange({
    householdId: leftHouseholdId,
    userId: user._id,
    userName: user.name,
    section: 'team',
    action: 'leave',
    entityId: memberId,
    summary: `${user.name} left the financial group`,
    details: leftHousehold?.name || null,
  });

  const household = await createHouseholdForUser(user);
  const newMembership = await getUserMembership(user._id);
  const auth = await buildAuthResponse(user, newMembership, household);
  const token = signToken(user._id);

  return {
    token,
    ...auth,
    message: 'You left the group. A new personal dashboard was created for you.',
  };
}

router.post('/leave/request-otp', requireAuth, async (req, res) => {
  try {
    const membership = req.membership;
    if (!membership) {
      return res.status(403).json({ error: 'No group membership to leave' });
    }
    if (membership.role === 'owner') {
      return res.status(403).json({ error: 'Dashboard owners cannot leave their own household this way' });
    }

    const devOtp = await requestOtpSend(req.user, 'leave_group');
    res.json({
      ok: true,
      message: 'Verification code sent to your email',
      ...otpRateLimitMeta(req.user),
      resendAvailableIn: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS) || 30,
      ...(IS_DEV && { devOtp }),
    });
  } catch (err) {
    if (sendOtpRateLimitResponse(res, err)) return;
    res.status(500).json({ error: err.message });
  }
});

router.post('/leave', requireAuth, async (req, res) => {
  try {
    const { otp } = req.body;
    if (!otp) {
      return res.status(400).json({ error: 'Verification code is required' });
    }

    const membership = req.membership;
    if (!membership) {
      return res.status(403).json({ error: 'No group membership to leave' });
    }

    if (req.user.otpPurpose && req.user.otpPurpose !== 'leave_group') {
      return res.status(400).json({ error: 'Request a new verification code to leave the group' });
    }

    const ok = await verifyUserOtp(req.user, otp);
    if (!ok) {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    const payload = await executeLeaveGroup(req.user, membership);
    res.json(payload);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
