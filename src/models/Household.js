import mongoose from 'mongoose';

const householdSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    joinCode: { type: String, unique: true, sparse: true, uppercase: true, trim: true },
  },
  { timestamps: true },
);

export default mongoose.model('Household', householdSchema);
