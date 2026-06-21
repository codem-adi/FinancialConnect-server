import express from 'express';
import AuditLog from '../models/AuditLog.js';
import Notification from '../models/Notification.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

const AUDIT_DEFAULT_LIMIT = 20;
const AUDIT_MAX_LIMIT = 100;
const NOTIFICATIONS_LIMIT = 10;

router.get('/audit', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || AUDIT_DEFAULT_LIMIT, 1),
      AUDIT_MAX_LIMIT,
    );
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const filter = {
      householdId: req.householdId,
      createdAt: { $gte: oneYearAgo },
    };

    const logs = await AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit + 1);

    const hasMore = logs.length > limit;
    const page = hasMore ? logs.slice(0, limit) : logs;

    res.json({
      logs: page,
      offset,
      limit,
      hasMore,
      returned: page.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || NOTIFICATIONS_LIMIT, NOTIFICATIONS_LIMIT);

    const notifications = await Notification.find({
      userId: req.user._id,
      householdId: req.householdId,
    })
      .sort({ createdAt: -1 })
      .limit(limit);

    const unreadCount = await Notification.countDocuments({
      userId: req.user._id,
      householdId: req.householdId,
      read: false,
    });

    res.json({ notifications, unreadCount, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    await Notification.updateOne(
      { _id: req.params.id, userId: req.user._id },
      { read: true },
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/notifications/read-all', requireAuth, async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.user._id, householdId: req.householdId, read: false },
      { read: true },
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
