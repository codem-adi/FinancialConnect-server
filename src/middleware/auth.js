import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import HouseholdMember from '../models/HouseholdMember.js';
import { isSendEmailEnabled } from '../config/email.js';

const JWT_SECRET = process.env.JWT_SECRET || 'retirewise-dev-secret-change-in-production';

export function signToken(userId) {
  const expiresIn = process.env.JWT_EXPIRES_IN || '30d';
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export async function resolveAuthState(user) {
  const activeMembership = await HouseholdMember.findOne({ userId: user._id, status: 'active' });
  const awaitingMembership = await HouseholdMember.findOne({ userId: user._id, status: 'awaiting_approval' });

  return {
    membership: activeMembership || awaitingMembership,
    isAwaiting: !!awaitingMembership && !activeMembership,
    isActive: user.isActive,
  };
}

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Authentication required' });

    const payload = verifyToken(token);
    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ error: 'Invalid token' });

    if (!isSendEmailEnabled() && !user.isActive) {
      user.isActive = true;
      await user.save();
    }

    const { membership, isAwaiting, isActive } = await resolveAuthState(user);

    req.user = user;
    req.membership = membership;
    req.householdId = membership?.householdId;
    req.role = membership?.role;
    req.awaitingApproval = isAwaiting;
    req.canEdit = !isAwaiting && (membership?.role === 'owner' || membership?.role === 'editor');
    req.needsVerification = isSendEmailEnabled() && !isActive;

    const inactiveAllowed = ['/me', '/status'].includes(req.path);
    if (!isActive && !inactiveAllowed && isSendEmailEnabled()) {
      return res.status(403).json({ error: 'Account not activated', code: 'NEEDS_VERIFICATION', email: user.email });
    }

    if (isAwaiting) {
      const onAuthRouter = req.baseUrl === '/api/auth';
      const onTeamLeave = req.baseUrl === '/api/team'
        && (req.path === '/leave' || req.path === '/leave/request-otp')
        && req.method === 'POST';
      const authAllowed = onAuthRouter && ['/me', '/status'].includes(req.path);
      if (!authAllowed && !onTeamLeave) {
        return res.status(403).json({
          error: 'Waiting for household owner approval',
          code: 'AWAITING_APPROVAL',
        });
      }
    }

    if (!membership && !isAwaiting && isActive) {
      return res.status(403).json({ error: 'No household membership' });
    }

    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireEditor(req, res, next) {
  if (req.awaitingApproval) {
    return res.status(403).json({ error: 'Access pending owner approval' });
  }
  if (!req.canEdit) {
    return res.status(403).json({ error: 'View-only access — you cannot edit financial data' });
  }
  next();
}

export function requireOwner(req, res, next) {
  if (req.awaitingApproval) {
    return res.status(403).json({ error: 'Access pending owner approval' });
  }
  if (req.role !== 'owner') {
    return res.status(403).json({ error: 'Only the dashboard owner can import or export full household data' });
  }
  next();
}

export { JWT_SECRET };
