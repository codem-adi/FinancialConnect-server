import mongoose from 'mongoose';

const householdMemberSchema = new mongoose.Schema(
  {
    householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: ['owner', 'editor', 'viewer'], required: true },
    status: {
      type: String,
      enum: ['active', 'pending', 'awaiting_approval', 'rejected'],
      default: 'pending',
    },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    invitedAt: { type: Date, default: Date.now },
    joinCodeUsed: { type: String, default: null },
  },
  { timestamps: true },
);

householdMemberSchema.index({ householdId: 1, email: 1 }, { unique: true });

export default mongoose.model('HouseholdMember', householdMemberSchema);
