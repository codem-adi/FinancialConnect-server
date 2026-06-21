import nodemailer from 'nodemailer';
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

function stripQuotes(value) {
  const v = (value || '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1).trim();
  }
  return v;
}

/** Build a Gmail-safe From header — address must match SMTP_USER. */
export function getFromAddress() {
  const smtpUser = stripQuotes(process.env.SMTP_USER).toLowerCase();
  const rawFrom = stripQuotes(process.env.EMAIL_FROM);
  const explicitName = stripQuotes(process.env.EMAIL_FROM_NAME);

  // "RetireWise <user@gmail.com>"
  const angleMatch = rawFrom.match(/^(.+?)\s*<([^>]+)>$/);
  const parsedName = angleMatch ? stripQuotes(angleMatch[1]) : '';
  const parsedAddress = angleMatch ? stripQuotes(angleMatch[2]).toLowerCase() : '';

  const name = explicitName || parsedName || DEFAULT_FROM_NAME;
  const address = smtpUser || parsedAddress || rawFrom.toLowerCase();

  if (!address.includes('@')) {
    return smtpUser || rawFrom;
  }

  return { name, address };
}

export function formatFromAddress(from = getFromAddress()) {
  if (typeof from === 'string') return from;
  return `${from.name} <${from.address}>`;
}

export function isSmtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST
    && process.env.SMTP_USER
    && process.env.SMTP_PASS,
  );
}

function getTransport() {
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendEmail(to, { subject, text, html }, logLabel) {
  if (!isSmtpConfigured()) return null;

  const from = getFromAddress();
  const transport = getTransport();
  const info = await transport.sendMail({
    from,
    sender: typeof from === 'object' ? from.address : from,
    to,
    subject,
    text,
    html,
  });

  const id = info.messageId || info.response || 'accepted';
  console.log(`[email] ${logLabel} → ${to} (from: ${formatFromAddress(from)}, id: ${id})`);
  return info;
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

export async function verifySmtpConnection() {
  if (!isSmtpConfigured()) {
    console.warn('[email] SMTP not configured — set SMTP_HOST, SMTP_USER, SMTP_PASS on Render');
    return false;
  }

  console.log(`[email] SMTP env loaded — from ${formatFromAddress()} via ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}`);

  try {
    await getTransport().verify();
    console.log('[email] SMTP connection verified — server accepted login');
    return true;
  } catch (err) {
    console.error('[email] SMTP connection FAILED:', err.message);
    console.error('[email] Production checklist: SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_SECURE=false');
    console.error('[email] SMTP_USER = full Gmail address, SMTP_PASS = 16-char App Password (not your login password)');
    console.error('[email] EMAIL_FROM_NAME is optional; do not set EMAIL_FROM to a different address than SMTP_USER for Gmail');
    return false;
  }
}
