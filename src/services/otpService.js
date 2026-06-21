import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getOtpExpiryMs } from '../config/otp.js';
import { isSmtpConfigured, sendOtpEmail } from './emailService.js';

export function generateOtp() {
  return String(crypto.randomInt(100000, 999999));
}

export class OtpRateLimitError extends Error {
  constructor(message, { code, retryAfterSeconds, blockedUntil }) {
    super(message);
    this.name = 'OtpRateLimitError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.blockedUntil = blockedUntil;
  }
}

function getRateLimitConfig() {
  return {
    cooldownSec: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS) || 30,
    maxSends: Number(process.env.OTP_MAX_SENDS) || 5,
    blockMinutes: Number(process.env.OTP_BLOCK_MINUTES) || 60,
  };
}

function formatWaitMessage(seconds) {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.ceil((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h} hour${h !== 1 ? 's' : ''}`;
  }
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m} minute${m !== 1 ? 's' : ''}`;
  }
  return `${seconds} second${seconds !== 1 ? 's' : ''}`;
}

export function clearExpiredOtpBlock(user) {
  if (user.otpBlockedUntil && user.otpBlockedUntil <= new Date()) {
    user.otpBlockedUntil = null;
    user.otpSendCount = 0;
  }
}

/** Read-only rate limit status for UI countdowns */
export function getOtpRateLimitStatus(user) {
  const { cooldownSec, maxSends, blockMinutes } = getRateLimitConfig();
  const now = Date.now();

  clearExpiredOtpBlock(user);

  if (user.otpBlockedUntil && user.otpBlockedUntil > new Date()) {
    const retryAfterSeconds = Math.ceil((user.otpBlockedUntil.getTime() - now) / 1000);
    return {
      allowed: false,
      code: 'OTP_BLOCKED',
      retryAfterSeconds,
      blockedUntil: user.otpBlockedUntil.toISOString(),
      resendAvailableIn: retryAfterSeconds,
      sendsRemaining: 0,
      message: `Too many code requests. Please try again in ${formatWaitMessage(retryAfterSeconds)}.`,
    };
  }

  if (user.otpLastSentAt) {
    const elapsed = (now - user.otpLastSentAt.getTime()) / 1000;
    if (elapsed < cooldownSec) {
      const retryAfterSeconds = Math.ceil(cooldownSec - elapsed);
      return {
        allowed: false,
        code: 'OTP_COOLDOWN',
        retryAfterSeconds,
        resendAvailableIn: retryAfterSeconds,
        sendsRemaining: Math.max(0, maxSends - (user.otpSendCount || 0)),
        message: `Please wait ${formatWaitMessage(retryAfterSeconds)} before requesting a new code.`,
      };
    }
  }

  const sendsRemaining = Math.max(0, maxSends - (user.otpSendCount || 0));
  return {
    allowed: true,
    code: null,
    retryAfterSeconds: 0,
    resendAvailableIn: 0,
    sendsRemaining,
    cooldownSec,
    maxSends,
    blockMinutes,
  };
}

export function otpRateLimitMeta(user) {
  const { cooldownSec, maxSends } = getRateLimitConfig();
  clearExpiredOtpBlock(user);
  return {
    resendAvailableIn: getOtpRateLimitStatus(user).resendAvailableIn || 0,
    sendsRemaining: Math.max(0, maxSends - (user.otpSendCount || 0)),
    cooldownSec,
    maxSends,
  };
}

async function applyOtpToUser(user, purpose) {
  const otp = generateOtp();
  user.otpHash = await bcrypt.hash(otp, 10);
  user.otpExpires = new Date(Date.now() + getOtpExpiryMs());
  user.otpPurpose = purpose;
  return otp;
}

/** Send OTP with 30s cooldown and 5-send / 1h block limits */
export async function requestOtpSend(user, purpose) {
  const { maxSends, blockMinutes, cooldownSec } = getRateLimitConfig();

  clearExpiredOtpBlock(user);

  if (user.otpBlockedUntil && user.otpBlockedUntil > new Date()) {
    const retryAfterSeconds = Math.ceil((user.otpBlockedUntil.getTime() - Date.now()) / 1000);
    throw new OtpRateLimitError(
      `Too many code requests. Please try again in ${formatWaitMessage(retryAfterSeconds)}.`,
      { code: 'OTP_BLOCKED', retryAfterSeconds, blockedUntil: user.otpBlockedUntil.toISOString() },
    );
  }

  if ((user.otpSendCount || 0) >= maxSends) {
    user.otpBlockedUntil = new Date(Date.now() + blockMinutes * 60 * 1000);
    user.otpSendCount = 0;
    await user.save();
    const retryAfterSeconds = blockMinutes * 60;
    throw new OtpRateLimitError(
      'Too many code requests. Please try again in one hour.',
      { code: 'OTP_BLOCKED', retryAfterSeconds, blockedUntil: user.otpBlockedUntil.toISOString() },
    );
  }

  if (user.otpLastSentAt) {
    const elapsed = (Date.now() - user.otpLastSentAt.getTime()) / 1000;
    if (elapsed < cooldownSec) {
      const retryAfterSeconds = Math.ceil(cooldownSec - elapsed);
      throw new OtpRateLimitError(
        `Please wait ${formatWaitMessage(retryAfterSeconds)} before requesting a new code.`,
        { code: 'OTP_COOLDOWN', retryAfterSeconds },
      );
    }
  }

  const otp = await applyOtpToUser(user, purpose);
  user.otpSendCount = (user.otpSendCount || 0) + 1;
  user.otpLastSentAt = new Date();
  await user.save();

  if (isSmtpConfigured()) {
    try {
      await sendOtpEmail(user.email, otp, purpose);
    } catch (err) {
      console.error(`[email] OTP saved for ${user.email} but email NOT sent:`, err.message);
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[OTP] ${user.email} (${purpose}): ${otp}`);
      }
      throw new Error('Could not send verification email. Please try again later.');
    }
  } else if (process.env.NODE_ENV !== 'production') {
    console.log(`[OTP] ${user.email} (${purpose}): ${otp}`);
  } else {
    console.warn(`[OTP] OTP saved for ${user.email} (${purpose}) — SMTP not configured, no email sent`);
  }

  return otp;
}

export async function verifyUserOtp(user, otp) {
  if (!user.otpHash || !user.otpExpires) return false;
  if (user.otpExpires < new Date()) return false;
  const valid = await bcrypt.compare(String(otp), user.otpHash);
  if (!valid) return false;
  user.otpHash = null;
  user.otpExpires = null;
  user.otpPurpose = null;
  user.otpSendCount = 0;
  user.otpBlockedUntil = null;
  user.otpLastSentAt = null;
  await user.save();
  return true;
}

export function clearUserOtp(user) {
  user.otpHash = null;
  user.otpExpires = null;
  user.otpPurpose = null;
}

export function sendOtpRateLimitResponse(res, err) {
  if (err instanceof OtpRateLimitError) {
    console.error(`[otp] Code not sent: ${err.message}`);
    return res.status(429).json({
      error: err.message,
      code: err.code,
      retryAfterSeconds: err.retryAfterSeconds,
      blockedUntil: err.blockedUntil || null,
    });
  }
  return null;
}
