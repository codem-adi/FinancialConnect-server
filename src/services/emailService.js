import nodemailer from 'nodemailer';
import { isSendEmailEnabled } from '../config/email.js';
import {
  buildOtpEmail,
  buildJoinApprovedEmail,
  buildJoinRejectedEmail,
  buildTeamInviteEmail,
  buildPasswordResetSuccessEmail,
  buildWelcomeEmail,
  buildCardBillAmountRequestEmail,
  buildCardBillDueSoonEmail,
  buildCardBillGeneratedEmail,
  buildCardBillDueEmail,
} from './emailTemplates.js';

const DEFAULT_FROM_NAME = 'RetireWise';
const RENDER_SMTP_BLOCK_HINT = '[email] Render FREE tier blocks SMTP ports 587/465 — use Resend (RESEND_API_KEY) or upgrade Render to a paid plan';

function stripQuotes(value) {
  const v = (value || '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1).trim();
  }
  return v;
}

/** Support F_Dashboard (SMTP_*) and K_Dashboard (EMAIL_SMTP_*) env names. */
function smtpEnv(key) {
  const k = key.replace(/^SMTP_/, '');
  const map = {
    HOST: ['SMTP_HOST', 'EMAIL_SMTP_HOST'],
    PORT: ['SMTP_PORT', 'EMAIL_SMTP_PORT'],
    SECURE: ['SMTP_SECURE', 'EMAIL_SMTP_SECURE'],
    USER: ['SMTP_USER', 'EMAIL_SMTP_USER'],
    PASS: ['SMTP_PASS', 'EMAIL_SMTP_PASSWORD'],
    FROM: ['EMAIL_FROM', 'EMAIL_SMTP_FROM'],
  };
  for (const name of map[k] || [key]) {
    const value = process.env[name];
    if (value != null && String(value).trim() !== '') return stripQuotes(value);
  }
  return '';
}

export function isResendConfigured() {
  return Boolean(stripQuotes(process.env.RESEND_API_KEY));
}

export function isSmtpConfigured() {
  return Boolean(smtpEnv('SMTP_HOST') && smtpEnv('SMTP_USER') && smtpEnv('SMTP_PASS'));
}

/** True when any outbound email path is configured. */
export function isEmailConfigured() {
  return isResendConfigured() || isSmtpConfigured();
}

/** Build From header. SMTP defaults to plain email (K_Dashboard style) unless EMAIL_FROM_NAME is set. */
export function getFromAddress() {
  if (isResendConfigured()) {
    const name = stripQuotes(process.env.EMAIL_FROM_NAME) || DEFAULT_FROM_NAME;
    const address = stripQuotes(process.env.RESEND_FROM || process.env.EMAIL_FROM || 'onboarding@resend.dev').toLowerCase();
    return { name, address };
  }

  const smtpUser = smtpEnv('SMTP_USER').toLowerCase();
  const rawFrom = smtpEnv('SMTP_FROM');
  const explicitName = stripQuotes(process.env.EMAIL_FROM_NAME);

  const angleMatch = rawFrom.match(/^(.+?)\s*<([^>]+)>$/);
  const parsedName = angleMatch ? stripQuotes(angleMatch[1]) : '';
  const parsedAddress = angleMatch ? stripQuotes(angleMatch[2]).toLowerCase() : '';

  const address = parsedAddress || smtpUser || rawFrom.toLowerCase();
  if (!address.includes('@')) {
    return smtpUser || rawFrom;
  }

  // Plain email only — same as K_Dashboard EMAIL_SMTP_FROM (no display name)
  const displayName = explicitName || parsedName;
  if (!displayName) {
    return address;
  }

  return { name: displayName, address };
}

export function formatFromAddress(from = getFromAddress()) {
  if (typeof from === 'string') return from;
  return `${from.name} <${from.address}>`;
}

function getTransport() {
  const port = Number(smtpEnv('SMTP_PORT') || 587);
  const secure = smtpEnv('SMTP_SECURE') === 'true' || port === 465;
  const user = smtpEnv('SMTP_USER');
  const pass = smtpEnv('SMTP_PASS');

  return nodemailer.createTransport({
    host: smtpEnv('SMTP_HOST'),
    port,
    secure,
    auth: user ? { user, pass } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000,
  });
}

async function sendViaResend(to, { subject, text, html }, logLabel) {
  const from = getFromAddress();
  const fromHeader = formatFromAddress(from);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripQuotes(process.env.RESEND_API_KEY)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromHeader,
      to: [to],
      subject,
      text,
      html,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.message || body.error || `Resend HTTP ${res.status}`);
  }

  console.log(`[email] ${logLabel} → ${to} (via Resend, id: ${body.id || 'sent'})`);
  return body;
}

async function sendViaSmtp(to, { subject, text, html }, logLabel) {
  const from = getFromAddress();
  const transport = getTransport();
  const mail = { from, to, subject, text, html };
  if (typeof from === 'object') {
    mail.sender = from.address;
  }
  const info = await transport.sendMail(mail);

  const id = info.messageId || info.response || 'accepted';
  console.log(`[email] ${logLabel} → ${to} (via SMTP, id: ${id})`);
  return info;
}

async function sendEmail(to, { subject, text, html }, logLabel) {
  if (!isSendEmailEnabled()) {
    console.log(`[email] Skipped (${logLabel}) → ${to} — SEND_EMAIL=false`);
    return null;
  }
  if (isResendConfigured()) {
    return sendViaResend(to, { subject, text, html }, logLabel);
  }
  if (isSmtpConfigured()) {
    return sendViaSmtp(to, { subject, text, html }, logLabel);
  }
  return null;
}

/** Send without failing the caller — for notification emails */
export async function sendEmailSafe(to, template, logLabel) {
  try {
    return await sendEmail(to, template, logLabel);
  } catch (err) {
    console.error(`[email] Failed (${logLabel}) to ${to}:`, err.message);
    return null;
  }
}

export async function sendOtpEmail(to, otp, purpose) {
  return sendEmail(to, buildOtpEmail(otp, purpose), `OTP (${purpose})`);
}

export async function sendJoinApprovedEmail(to, data) {
  return sendEmailSafe(to, buildJoinApprovedEmail(data), 'join approved');
}

export async function sendJoinRejectedEmail(to, data) {
  return sendEmailSafe(to, buildJoinRejectedEmail(data), 'join rejected');
}

export async function sendTeamInviteEmail(to, data) {
  return sendEmailSafe(to, buildTeamInviteEmail(data), 'team invite');
}

export async function sendPasswordResetSuccessEmail(to, data) {
  return sendEmailSafe(to, buildPasswordResetSuccessEmail(data), 'password reset success');
}

export async function sendWelcomeEmail(to, data) {
  return sendEmailSafe(to, buildWelcomeEmail(data), 'welcome');
}

export async function sendCardBillAmountRequestEmail(to, data) {
  return sendEmailSafe(to, buildCardBillAmountRequestEmail(data), 'card bill amount request');
}

export async function sendCardBillDueSoonEmail(to, data) {
  return sendEmailSafe(to, buildCardBillDueSoonEmail(data), 'card bill due tomorrow');
}

export async function sendCardBillGeneratedEmail(to, data) {
  return sendCardBillAmountRequestEmail(to, data);
}

export async function sendCardBillDueEmail(to, data) {
  return sendCardBillDueSoonEmail(to, data);
}

function isLikelyRenderSmtpBlock(err) {
  const msg = (err?.message || '').toLowerCase();
  return msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout') || msg.includes('econnrefused');
}

export async function verifySmtpConnection() {
  if (!isSendEmailEnabled()) {
    console.log('[email] SEND_EMAIL=false — outbound email and OTP auth disabled');
    return true;
  }
  if (isResendConfigured()) {
    console.log(`[email] Resend API configured — from ${formatFromAddress()} (HTTPS, works on Render free tier)`);
    return true;
  }

  if (!isSmtpConfigured()) {
    console.warn('[email] No email provider configured — set RESEND_API_KEY (Render free) or SMTP_* (local/paid Render)');
    return false;
  }

  console.log(`[email] SMTP env loaded — from ${formatFromAddress()} via ${smtpEnv('SMTP_HOST')}:${smtpEnv('SMTP_PORT') || 587}`);

  try {
    await getTransport().verify();
    console.log('[email] SMTP connection verified — server accepted login');
    return true;
  } catch (err) {
    console.error('[email] SMTP connection FAILED:', err.message);
    if (isLikelyRenderSmtpBlock(err)) {
      console.error(RENDER_SMTP_BLOCK_HINT);
      console.error('[email] Fix: sign up at https://resend.com → API Keys → add RESEND_API_KEY + RESEND_FROM to Render env');
    } else {
      console.error('[email] Check SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (Gmail App Password)');
    }
    return false;
  }
}
