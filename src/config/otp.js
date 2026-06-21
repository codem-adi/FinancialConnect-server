/** Single source of truth for OTP validity (minutes). Must match DB expiry and email copy. */
export function getOtpExpiryMinutes() {
  const n = Number(process.env.OTP_EXPIRY_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

export function getOtpExpiryMs() {
  return getOtpExpiryMinutes() * 60 * 1000;
}
