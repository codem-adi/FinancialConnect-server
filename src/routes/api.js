import express from 'express';
import AppData from '../models/AppData.js';
import { createDefaultPlan, generateId } from '../utils/defaults.js';
import { requireAuth, requireEditor, requireOwner } from '../middleware/auth.js';
import { getOrCreateHouseholdData } from '../services/householdService.js';
import { recordChange, extractAuditMeta } from '../services/auditService.js';

const router = express.Router();

async function getDoc(householdId) {
  return getOrCreateHouseholdData(householdId);
}

async function logIfPresent(req, audit, fallbackSummary) {
  if (!audit && !fallbackSummary) return;
  await recordChange({
    householdId: req.householdId,
    userId: req.user._id,
    userName: req.user.name,
    section: audit?.section || 'general',
    action: audit?.action || 'update',
    entityId: audit?.entityId || null,
    summary: audit?.summary || fallbackSummary,
    details: audit?.details || null,
  });
}

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const doc = await getDoc(req.householdId);
    res.json({
      personalFinance: doc.personalFinance,
      retirementPlans: doc.retirementPlans,
      activePlanId: doc.activePlanId,
      theme: doc.theme,
      role: req.role,
      canEdit: req.canEdit,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', requireOwner, async (req, res) => {
  try {
    const doc = await getDoc(req.householdId);
    const { data, audit } = extractAuditMeta(req.body);
    Object.assign(doc, data);
    await doc.save();
    await logIfPresent(req, audit, audit?.summary);
    res.json({
      personalFinance: doc.personalFinance,
      retirementPlans: doc.retirementPlans,
      activePlanId: doc.activePlanId,
      theme: doc.theme,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/finance', requireEditor, async (req, res) => {
  try {
    const doc = await getDoc(req.householdId);
    const { data, audit } = extractAuditMeta(req.body);
    doc.personalFinance = { ...data, updatedAt: new Date().toISOString() };
    await doc.save();
    await logIfPresent(req, audit, audit?.summary || 'Updated financial data');
    res.json(doc.personalFinance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/plans', async (req, res) => {
  try {
    const doc = await getDoc(req.householdId);
    res.json({ plans: doc.retirementPlans, activePlanId: doc.activePlanId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/plans', requireEditor, async (req, res) => {
  try {
    const doc = await getDoc(req.householdId);
    const { data, audit } = extractAuditMeta(req.body);
    const plan = { ...data, updatedAt: new Date().toISOString() };
    const idx = doc.retirementPlans.findIndex((p) => p.id === plan.id);
    if (idx >= 0) doc.retirementPlans[idx] = plan;
    else doc.retirementPlans.push(plan);
    doc.activePlanId = plan.id;
    await doc.save();
    await logIfPresent(req, audit, audit?.summary || `Updated plan: ${plan.name}`);
    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/plans/:id', requireEditor, async (req, res) => {
  try {
    const doc = await getDoc(req.householdId);
    const removed = doc.retirementPlans.find((p) => p.id === req.params.id);
    doc.retirementPlans = doc.retirementPlans.filter((p) => p.id !== req.params.id);
    if (doc.activePlanId === req.params.id) {
      doc.activePlanId = doc.retirementPlans[0]?.id || null;
    }
    await doc.save();
    await recordChange({
      householdId: req.householdId,
      userId: req.user._id,
      userName: req.user.name,
      section: 'retirewise',
      action: 'delete',
      entityId: req.params.id,
      summary: `Deleted plan: ${removed?.name || req.params.id}`,
    });
    res.json({ plans: doc.retirementPlans, activePlanId: doc.activePlanId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/plans/:id/duplicate', requireEditor, async (req, res) => {
  try {
    const doc = await getDoc(req.householdId);
    const source = doc.retirementPlans.find((p) => p.id === req.params.id);
    if (!source) return res.status(404).json({ error: 'Plan not found' });
    const now = new Date().toISOString();
    const duplicate = {
      ...source,
      id: generateId(),
      name: `${source.name} (Copy)`,
      createdAt: now,
      updatedAt: now,
    };
    doc.retirementPlans.push(duplicate);
    await doc.save();
    await recordChange({
      householdId: req.householdId,
      userId: req.user._id,
      userName: req.user.name,
      section: 'retirewise',
      action: 'duplicate',
      entityId: duplicate.id,
      summary: `Duplicated plan: ${source.name}`,
    });
    res.json(duplicate);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/plans/active/:id', requireEditor, async (req, res) => {
  try {
    const doc = await getDoc(req.householdId);
    doc.activePlanId = req.params.id;
    await doc.save();
    res.json({ activePlanId: doc.activePlanId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/theme', requireEditor, async (req, res) => {
  try {
    const doc = await getDoc(req.householdId);
    doc.theme = req.body.theme;
    await doc.save();
    res.json({ theme: doc.theme });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
