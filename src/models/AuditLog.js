import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, required: true },
    section: { type: String, required: true },
    action: { type: String, required: true },
    entityId: { type: String, default: null },
    summary: { type: String, required: true },
    details: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

export default mongoose.model('AuditLog', auditLogSchema);
