import AuditLog from '../models/AuditLog.js';
import Notification from '../models/Notification.js';
import HouseholdMember from '../models/HouseholdMember.js';

export async function recordChange({
  householdId, userId, userName, section, action, entityId, summary, details,
  notificationType = 'change', notifyRoles = null,
}) {
  const log = await AuditLog.create({
    householdId,
    userId,
    userName,
    section,
    action,
    entityId: entityId || null,
    summary,
    details: details || null,
  });

  const memberQuery = {
    householdId,
    status: 'active',
    userId: { $ne: null, $nin: [userId] },
  };
  if (notifyRoles?.length) memberQuery.role = { $in: notifyRoles };

  const members = await HouseholdMember.find(memberQuery);

  if (members.length > 0) {
    await Notification.insertMany(
      members.map((m) => ({
        householdId,
        userId: m.userId,
        auditLogId: log._id,
        type: notificationType,
        message: `${userName}: ${summary}`,
        read: false,
      })),
    );
  }

  return log;
}

export function extractAuditMeta(body) {
  if (!body || typeof body !== 'object') return { data: body, audit: null };
  const { _audit, ...data } = body;
  return { data, audit: _audit || null };
}
