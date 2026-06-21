import { getOtpExpiryMinutes } from '../config/otp.js';

const APP_NAME = 'RetireWise';
const APP_URL = process.env.APP_PUBLIC_URL || 'http://localhost:5173';

function expiryLine() {
  const minutes = getOtpExpiryMinutes();
  return `This code is valid for ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

function layout({ title, intro, bodyHtml, footerNote }) {
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.08)">
    <div style="background:linear-gradient(135deg,#6366f1,#9333ea);padding:20px 24px">
      <p style="margin:0;font-size:13px;color:rgba(255,255,255,.85);letter-spacing:.04em;text-transform:uppercase">${APP_NAME}</p>
      <h1 style="margin:8px 0 0;font-size:22px;font-weight:700;color:#ffffff;line-height:1.3">${title}</h1>
    </div>
    <div style="padding:24px">
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155">${intro}</p>
      ${bodyHtml}
      ${footerNote ? `<p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#64748b">${footerNote}</p>` : ''}
    </div>
    <div style="padding:16px 24px;background:#f8fafc;border-top:1px solid #e2e8f0">
      <p style="margin:0;font-size:12px;color:#94a3b8">© ${new Date().getFullYear()} ${APP_NAME}. Personal finance & FIRE planning.</p>
    </div>
  </div>
</body>
</html>`.trim();

  const textIntro = intro.replace(/<[^>]+>/g, '');
  const textFooter = footerNote ? `\n\n${footerNote.replace(/<[^>]+>/g, '')}` : '';
  const text = `${title}\n\n${textIntro}${textFooter}\n\n— ${APP_NAME}`;

  return { html, text };
}

function otpCodeBlock(otp) {
  return `
    <div style="text-align:center;margin:8px 0 20px;padding:20px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0">
      <p style="margin:0 0 8px;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.06em">Your code</p>
      <p style="margin:0;font-size:32px;font-weight:700;letter-spacing:6px;color:#4f46e5">${otp}</p>
    </div>
    <p style="margin:0;font-size:14px;color:#64748b;text-align:center">${expiryLine()}</p>
  `;
}

const OTP_PURPOSES = {
  activation: {
    subject: 'Verify your RetireWise account',
    title: 'Verify your email',
    intro: 'Thanks for signing up. Enter this code in the app to activate your account.',
    footer: 'If you did not create a RetireWise account, you can ignore this email.',
  },
  login: {
    subject: 'Your RetireWise login code',
    title: 'Sign in to RetireWise',
    intro: 'Use this one-time code to sign in to your account.',
    footer: 'If you did not try to sign in, you can ignore this email.',
  },
  reset: {
    subject: 'Reset your RetireWise password',
    title: 'Password reset code',
    intro: 'We received a request to reset your password. Enter this code in the app, then choose a new password.',
    footer: 'If you did not request a password reset, you can ignore this email. Your password will stay the same.',
  },
  leave_group: {
    subject: 'Confirm leaving your household',
    title: 'Leave household confirmation',
    intro: 'Use this code to confirm that you want to leave your current financial household.',
    footer: 'If you did not request to leave a household, you can ignore this email.',
  },
};

export function buildOtpEmail(otp, purpose) {
  const copy = OTP_PURPOSES[purpose] || {
    subject: 'Your RetireWise verification code',
    title: 'Verification code',
    intro: 'Use this code to continue.',
    footer: 'If you did not request this code, you can ignore this email.',
  };

  const { html, text } = layout({
    title: copy.title,
    intro: copy.intro,
    bodyHtml: otpCodeBlock(otp),
    footerNote: copy.footer,
  });

  const textBody = [
    copy.intro,
    '',
    `Your code: ${otp}`,
    '',
    expiryLine(),
    '',
    copy.footer,
  ].join('\n');

  return { subject: copy.subject, html, text: `${copy.subject}\n\n${textBody}\n\n— ${APP_NAME}` };
}

export function buildJoinApprovedEmail({ name, householdName, role }) {
  const roleLabel = role === 'editor' ? 'Editor (can edit)' : 'Viewer (read only)';
  const greeting = name ? `Hi ${name},` : 'Hi,';

  const { html, text } = layout({
    title: 'Access approved',
    intro: `${greeting} great news — the owner of <strong>${householdName}</strong> has approved your request to join their financial dashboard.`,
    bodyHtml: `
      <div style="padding:16px;background:#ecfdf5;border-radius:10px;border:1px solid #a7f3d0;margin-bottom:8px">
        <p style="margin:0 0 8px;font-size:14px;color:#065f46"><strong>Your access level:</strong> ${roleLabel}</p>
        <p style="margin:0;font-size:14px;color:#047857">You can now sign in and view the shared dashboard.</p>
      </div>
      <p style="margin:16px 0 0;text-align:center">
        <a href="${APP_URL}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">Open RetireWise</a>
      </p>
    `,
    footerNote: 'If you were not expecting this approval, contact the dashboard owner.',
  });

  return {
    subject: `You're approved to join ${householdName} on RetireWise`,
    html,
    text: `${greeting} Your request to join "${householdName}" was approved. Access: ${roleLabel}. Sign in at ${APP_URL}`,
  };
}

export function buildJoinRejectedEmail({ name, householdName }) {
  const greeting = name ? `Hi ${name},` : 'Hi,';

  const { html, text } = layout({
    title: 'Join request not approved',
    intro: `${greeting} the owner of <strong>${householdName}</strong> did not approve your request to join their financial dashboard at this time.`,
    bodyHtml: `
      <p style="margin:0;font-size:14px;line-height:1.6;color:#475569">
        You can sign up without a join code to create your own household, or ask the owner for a new invitation.
      </p>
      <p style="margin:16px 0 0;text-align:center">
        <a href="${APP_URL}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">Go to RetireWise</a>
      </p>
    `,
    footerNote: 'If you believe this was a mistake, contact the dashboard owner directly.',
  });

  return {
    subject: `Update on your request to join ${householdName}`,
    html,
    text: `${greeting} Your request to join "${householdName}" was not approved. Visit ${APP_URL} to create your own dashboard or try again later.`,
  };
}

export function buildTeamInviteEmail({ householdName, role, inviterName }) {
  const roleLabel = role === 'editor' ? 'Editor (can edit)' : 'Viewer (read only)';
  const inviter = inviterName ? `${inviterName} has` : 'You have been';

  const { html, text } = layout({
    title: 'Dashboard invitation',
    intro: `${inviter} invited you to join <strong>${householdName}</strong> on RetireWise as a <strong>${roleLabel}</strong>.`,
    bodyHtml: `
      <p style="margin:0;font-size:14px;line-height:1.6;color:#475569">
        Sign up or log in with this email address to accept the invitation.
      </p>
      <p style="margin:16px 0 0;text-align:center">
        <a href="${APP_URL}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">Open RetireWise</a>
      </p>
    `,
    footerNote: 'If you were not expecting this invitation, you can ignore this email.',
  });

  return {
    subject: `You're invited to ${householdName} on RetireWise`,
    html,
    text: `${inviter} invited you to join "${householdName}" as ${roleLabel}. Sign in at ${APP_URL}`,
  };
}

export function buildPasswordResetSuccessEmail({ name }) {
  const greeting = name ? `Hi ${name},` : 'Hi,';

  const { html, text } = layout({
    title: 'Password updated',
    intro: `${greeting} your RetireWise password was changed successfully.`,
    bodyHtml: `
      <p style="margin:0;font-size:14px;line-height:1.6;color:#475569">
        If you made this change, no further action is needed. You can sign in with your new password.
      </p>
    `,
    footerNote: 'If you did <strong>not</strong> change your password, contact support immediately and secure your account.',
  });

  return {
    subject: 'Your RetireWise password was changed',
    html,
    text: `${greeting} Your RetireWise password was changed successfully. If this wasn't you, secure your account immediately.`,
  };
}

export function buildWelcomeEmail({ name, householdName, isJoinRequest }) {
  const greeting = name ? `Hi ${name},` : 'Hi,';

  const intro = isJoinRequest
    ? `${greeting} your email is verified. Your request to join <strong>${householdName}</strong> is pending — the owner will review it soon.`
    : `${greeting} welcome to RetireWise! Your account is active and your personal household <strong>${householdName}</strong> is ready.`;

  const { html, text } = layout({
    title: isJoinRequest ? 'Email verified — awaiting approval' : 'Welcome to RetireWise',
    intro,
    bodyHtml: `
      <p style="margin:0;font-size:14px;line-height:1.6;color:#475569">
        ${isJoinRequest
    ? 'We will email you again when the owner approves or declines your request.'
    : 'Start adding your assets, expenses, and retirement plans from your dashboard.'}
      </p>
      <p style="margin:16px 0 0;text-align:center">
        <a href="${APP_URL}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">Open RetireWise</a>
      </p>
    `,
    footerNote: null,
  });

  return {
    subject: isJoinRequest ? 'Email verified — waiting for dashboard approval' : 'Welcome to RetireWise',
    html,
    text: `${intro.replace(/<[^>]+>/g, '')} Visit ${APP_URL}`,
  };
}

function formatAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `₹${n.toLocaleString('en-IN')}`;
}

export function buildCardBillAmountRequestEmail({ memberName, cardName, billProvider, estimatedAmount, billDueDay }) {
  const amountText = formatAmount(estimatedAmount);
  const { html, text } = layout({
    title: 'Enter this month\'s credit card bill',
    intro: `Hi ${memberName || 'there'}, your <strong>${billProvider}</strong> bill for <strong>${cardName}</strong> was generated yesterday.`,
    bodyHtml: `
      <div style="padding:16px;background:#fffbeb;border-radius:10px;border:1px solid #fde68a;margin-bottom:8px">
        <p style="margin:0 0 8px;font-size:14px;color:#92400e"><strong>Bill provider:</strong> ${billProvider}</p>
        <p style="margin:0 0 8px;font-size:14px;color:#92400e"><strong>Card:</strong> ${cardName}</p>
        ${amountText
    ? `<p style="margin:0 0 8px;font-size:14px;color:#92400e"><strong>Amount on file:</strong> ${amountText} — please confirm or update</p>`
    : '<p style="margin:0 0 8px;font-size:14px;color:#92400e"><strong>Amount:</strong> not entered yet</p>'}
        <p style="margin:0;font-size:14px;color:#92400e"><strong>Payment due:</strong> day ${billDueDay} of this month</p>
      </div>
      <p style="margin:0;font-size:14px;color:#475569">Open RetireWise → Monthly Expenses → Member Cards & Bills and enter this month's bill amount.</p>
    `,
    footerNote: 'You will receive a payment reminder one day before the due date.',
  });

  return {
    subject: `Enter bill amount: ${billProvider} — ${cardName}`,
    html,
    text: `Your ${billProvider} bill for ${cardName} was generated yesterday.${amountText ? ` Amount on file: ${amountText}.` : ' Please enter the amount.'} Due on day ${billDueDay}.`,
  };
}

export function buildCardBillDueSoonEmail({ memberName, cardName, billProvider, estimatedAmount, billDueDay }) {
  const amountText = formatAmount(estimatedAmount);
  const { html, text } = layout({
    title: 'Credit card bill due tomorrow',
    intro: `Hi ${memberName || 'there'}, payment for your <strong>${billProvider}</strong> bill (<strong>${cardName}</strong>) is <strong>due tomorrow</strong> (day ${billDueDay}).`,
    bodyHtml: `
      <div style="padding:16px;background:#fef2f2;border-radius:10px;border:1px solid #fecaca;margin-bottom:8px">
        <p style="margin:0 0 8px;font-size:14px;color:#991b1b"><strong>Bill provider:</strong> ${billProvider}</p>
        <p style="margin:0 0 8px;font-size:14px;color:#991b1b"><strong>Card:</strong> ${cardName}</p>
        ${amountText
    ? `<p style="margin:0;font-size:14px;color:#991b1b"><strong>Amount due:</strong> ${amountText}</p>`
    : '<p style="margin:0;font-size:14px;color:#991b1b"><strong>Amount:</strong> not entered — please add it in RetireWise before paying</p>'}
      </div>
      <p style="margin:0;font-size:14px;color:#475569">Please complete the payment tomorrow to avoid late fees.</p>
    `,
    footerNote: 'View card bills on your RetireWise dashboard.',
  });

  return {
    subject: `Payment due tomorrow: ${billProvider} — ${cardName}`,
    html,
    text: `Payment for ${billProvider} (${cardName}) is due tomorrow.${amountText ? ` Amount: ${amountText}.` : ' Bill amount not entered yet.'}`,
  };
}

/** @deprecated Use buildCardBillAmountRequestEmail — kept for reference */
export function buildCardBillGeneratedEmail(props) {
  return buildCardBillAmountRequestEmail(props);
}

/** @deprecated Use buildCardBillDueSoonEmail */
export function buildCardBillDueEmail(props) {
  return buildCardBillDueSoonEmail({ ...props, billDueDay: props.billDueDay });
}
