function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function getMonthKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function dayInMonth(year, monthIndex, day) {
  const last = new Date(year, monthIndex + 1, 0).getDate();
  return Math.min(Math.max(1, toNum(day) || 1), last);
}

export function isBillGenerateDay(card, today = new Date()) {
  return today.getDate() === dayInMonth(today.getFullYear(), today.getMonth(), card.billGenerateDay);
}

export function isBillDueDay(card, today = new Date()) {
  return today.getDate() === dayInMonth(today.getFullYear(), today.getMonth(), card.billDueDay);
}

export function daysUntil(targetDay, today = new Date()) {
  const year = today.getFullYear();
  const month = today.getMonth();
  const clamped = dayInMonth(year, month, targetDay);
  const target = new Date(year, month, clamped);
  const start = new Date(year, month, today.getDate());
  const diff = Math.round((target - start) / (24 * 60 * 60 * 1000));
  if (diff >= 0) return diff;
  const nextMonth = new Date(year, month + 1, dayInMonth(year, month + 1, targetDay));
  return Math.round((nextMonth - start) / (24 * 60 * 60 * 1000));
}

export function daysSinceBillGenerate(card, today = new Date()) {
  const year = today.getFullYear();
  const month = today.getMonth();
  const start = new Date(year, month, today.getDate());
  const thisMonthGen = new Date(year, month, dayInMonth(year, month, card.billGenerateDay));
  let diff = Math.round((start - thisMonthGen) / (24 * 60 * 60 * 1000));
  if (diff < 0) {
    const prev = new Date(year, month - 1, dayInMonth(year, month - 1, card.billGenerateDay));
    diff = Math.round((start - prev) / (24 * 60 * 60 * 1000));
  }
  return diff;
}

export function isDayAfterBillGenerate(card, today = new Date()) {
  return daysSinceBillGenerate(card, today) === 1;
}

export function isDayBeforeBillDue(card, today = new Date()) {
  return daysUntil(card.billDueDay, today) === 1;
}

/** Bill amount for a card in a given month (falls back to legacy card.estimatedAmount). */
export function getCardBillAmount(personalFinance, monthKey, cardId, card) {
  const record = (personalFinance?.monthlyRecords || []).find((r) => r.month === monthKey);
  const stored = record?.cardBillAmounts?.[cardId];
  if (stored !== undefined && stored !== null && stored !== '') return toNum(stored);
  return toNum(card?.estimatedAmount);
}

/** Supports legacy memberCars / carName from earlier builds. */
export function normalizeMemberCards(pf) {
  const raw = pf?.memberCards ?? pf?.memberCars ?? [];
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => ({
    ...item,
    cardName: item.cardName || item.carName || '',
    sendReminder: item.sendReminder !== false,
  }));
}
