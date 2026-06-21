import AppData from '../models/AppData.js';
import HouseholdMember from '../models/HouseholdMember.js';
import Notification from '../models/Notification.js';
import {
  getMonthKey,
  getCardBillAmount,
  isDayAfterBillGenerate,
  isDayBeforeBillDue,
  normalizeMemberCards,
} from '../utils/cardBillUtils.js';
import { sendCardBillAmountRequestEmail, sendCardBillDueSoonEmail } from './emailService.js';

async function getHouseholdOwner(householdId) {
  if (!householdId) return null;
  const owner = await HouseholdMember.findOne({
    householdId,
    role: 'owner',
    status: 'active',
    userId: { $ne: null },
  });
  if (!owner) return null;
  return {
    email: (owner.email || '').trim().toLowerCase(),
    userId: owner.userId,
  };
}

async function notifyUser(householdId, userId, message) {
  if (!householdId || !userId) return;
  await Notification.create({
    householdId,
    userId,
    type: 'card_bill',
    message,
    read: false,
  });
}

async function notifyUsersOnce(householdId, userIds, message) {
  const seen = new Set();
  for (const userId of userIds) {
    if (!userId || seen.has(String(userId))) continue;
    seen.add(String(userId));
    await notifyUser(householdId, userId, message);
  }
}

async function sendEmailsOnce(emails, sendFn, payload) {
  const seen = new Set();
  for (const raw of emails) {
    const email = (raw || '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    await sendFn(email, payload);
  }
}

function cardOwnerWantsReminder(card) {
  return card.sendReminder !== false;
}

async function collectNotifyUserIds(householdId, card, cardEmail, groupOwner) {
  const notifyUserIds = [];
  if (cardOwnerWantsReminder(card) && cardEmail) {
    const member = await HouseholdMember.findOne({
      householdId,
      email: cardEmail,
      status: 'active',
      userId: { $ne: null },
    });
    if (member?.userId) notifyUserIds.push(member.userId);
  }
  if (groupOwner?.userId) notifyUserIds.push(groupOwner.userId);
  return notifyUserIds;
}

function recipientEmails(card, cardEmail, groupOwner) {
  const emails = [];
  if (cardOwnerWantsReminder(card) && cardEmail) emails.push(cardEmail);
  if (groupOwner?.email) emails.push(groupOwner.email);
  return emails;
}

export async function runCardBillReminders(today = new Date()) {
  const monthKey = getMonthKey(today);
  const docs = await AppData.find({ householdId: { $ne: null } });
  let sent = 0;
  const ownerCache = new Map();

  for (const doc of docs) {
    const cards = normalizeMemberCards(doc.personalFinance);
    let dirty = false;

    let groupOwner = ownerCache.get(String(doc.householdId));
    if (groupOwner === undefined) {
      groupOwner = await getHouseholdOwner(doc.householdId);
      ownerCache.set(String(doc.householdId), groupOwner);
    }

    for (const card of cards) {
      const cardEmail = (card.notifyEmail || '').trim().toLowerCase();
      const cardName = card.cardName || card.carName || 'Card';
      const billAmount = getCardBillAmount(doc.personalFinance, monthKey, card.id, card);
      const payload = {
        memberName: card.memberName,
        cardName,
        billProvider: card.billProvider,
        estimatedAmount: billAmount || undefined,
        billDueDay: card.billDueDay,
      };

      const amountRequestDay = isDayAfterBillGenerate(card, today);
      const dueSoonDay = isDayBeforeBillDue(card, today);
      if (!amountRequestDay && !dueSoonDay) continue;

      const ownerEmails = recipientEmails(card, cardEmail, groupOwner);
      if (!ownerEmails.length) continue;

      if (amountRequestDay && card.lastAmountRequestReminderMonth !== monthKey) {
        const message = `Enter bill amount: ${card.billProvider} for ${cardName} (${card.memberName})`;
        await sendEmailsOnce(ownerEmails, sendCardBillAmountRequestEmail, payload);
        await notifyUsersOnce(
          doc.householdId,
          await collectNotifyUserIds(doc.householdId, card, cardEmail, groupOwner),
          message,
        );
        card.lastAmountRequestReminderMonth = monthKey;
        card.lastGenerateReminderMonth = monthKey;
        dirty = true;
        sent += ownerEmails.length;
      }

      if (dueSoonDay && card.lastDueSoonReminderMonth !== monthKey) {
        const message = `Bill due tomorrow: ${card.billProvider} for ${cardName} (${card.memberName})`;
        await sendEmailsOnce(ownerEmails, sendCardBillDueSoonEmail, payload);
        await notifyUsersOnce(
          doc.householdId,
          await collectNotifyUserIds(doc.householdId, card, cardEmail, groupOwner),
          message,
        );
        card.lastDueSoonReminderMonth = monthKey;
        card.lastDueReminderMonth = monthKey;
        dirty = true;
        sent += ownerEmails.length;
      }
    }

    if (dirty) {
      doc.personalFinance.memberCards = cards;
      delete doc.personalFinance.memberCars;
      doc.markModified('personalFinance');
      await doc.save();
    }
  }

  if (sent > 0) {
    console.log(`[card-bills] Sent ${sent} reminder(s) for ${monthKey}`);
  }
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export function startCardBillReminderScheduler() {
  const tick = () => {
    runCardBillReminders().catch((err) => {
      console.error('[card-bills] Reminder job failed:', err.message);
    });
  };

  tick();
  setInterval(tick, SIX_HOURS_MS);
  console.log('[card-bills] Reminder scheduler started (checks every 6 hours)');
}
