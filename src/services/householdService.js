import AppData from '../models/AppData.js';
import Household from '../models/Household.js';
import HouseholdMember from '../models/HouseholdMember.js';
import { createFreshAppData } from '../utils/defaults.js';
import { generateJoinCode } from '../utils/joinCode.js';

async function ensureUniqueJoinCode() {
  for (let i = 0; i < 10; i++) {
    const code = generateJoinCode();
    const exists = await Household.findOne({ joinCode: code });
    if (!exists) return code;
  }
  throw new Error('Could not generate unique join code');
}

export async function getOrCreateHouseholdData(householdId, userName) {
  let doc = await AppData.findOne({ householdId });
  if (doc) return doc;

  const legacy = await AppData.findOne({ key: 'main', householdId: { $exists: false } });
  if (legacy && !legacy.householdId) {
    legacy.householdId = householdId;
    legacy.key = `household-${householdId}`;
    await legacy.save();
    return legacy;
  }

  const defaults = createFreshAppData(userName);
  doc = await AppData.create({
    key: `household-${householdId}`,
    householdId,
    ...defaults,
  });
  return doc;
}

export async function createHouseholdForUser(user, householdName) {
  const joinCode = await ensureUniqueJoinCode();
  const household = await Household.create({
    name: householdName || `${user.name}'s Household`,
    ownerId: user._id,
    joinCode,
  });

  await HouseholdMember.create({
    householdId: household._id,
    userId: user._id,
    email: user.email,
    role: 'owner',
    status: 'active',
    invitedBy: user._id,
  });

  await getOrCreateHouseholdData(household._id, user.name);
  return household;
}

export async function findHouseholdByJoinCode(code) {
  if (!code) return null;
  return Household.findOne({ joinCode: String(code).trim().toUpperCase() });
}

export async function linkPendingInvites(user) {
  const pending = await HouseholdMember.find({
    email: user.email,
    status: { $in: ['pending', 'awaiting_approval'] },
  });
  for (const invite of pending) {
    invite.userId = user._id;
    if (invite.status === 'pending') invite.status = 'active';
    await invite.save();
  }
}

export async function getUserMembership(userId) {
  return HouseholdMember.findOne({ userId, status: 'active' });
}

export async function getUserAwaitingMembership(userId) {
  return HouseholdMember.findOne({ userId, status: 'awaiting_approval' });
}

export async function buildAuthResponse(user, membership, household) {
  const awaiting = membership?.status === 'awaiting_approval';
  return {
    user: { id: user._id, email: user.email, name: user.name, isActive: user.isActive },
    household: household ? { id: household._id, name: household.name, joinCode: household.joinCode } : null,
    role: membership?.role || null,
    canEdit: !awaiting && (membership?.role === 'owner' || membership?.role === 'editor'),
    awaitingApproval: awaiting,
    needsVerification: !user.isActive,
  };
}
