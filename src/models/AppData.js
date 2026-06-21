import mongoose from 'mongoose';

const appDataSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'main' },
    householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', unique: true, sparse: true },
    personalFinance: { type: mongoose.Schema.Types.Mixed, required: true },
    retirementPlans: { type: [mongoose.Schema.Types.Mixed], default: [] },
    activePlanId: { type: String, default: null },
    theme: { type: String, enum: ['light', 'dark'], default: 'dark' },
  },
  { timestamps: true },
);

export default mongoose.model('AppData', appDataSchema);
