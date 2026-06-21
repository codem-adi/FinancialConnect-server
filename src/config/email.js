/** When false: no outbound email, no OTP auth — password login/signup only. */
export function isSendEmailEnabled() {
  const raw = String(process.env.SEND_EMAIL ?? 'true').trim().toLowerCase();
  return !['false', '0', 'no', 'off'].includes(raw);
}

export function getAuthFeatures() {
  const sendEmail = isSendEmailEnabled();
  return {
    sendEmail,
    otpEnabled: sendEmail,
    passwordResetEnabled: sendEmail,
    leaveGroupOtpEnabled: sendEmail,
  };
}
