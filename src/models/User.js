import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: false },
    otpHash: { type: String, default: null },
    otpExpires: { type: Date, default: null },
    otpPurpose: {
      type: String,
      enum: ['activation', 'reset', 'login', 'leave_group', null],
      default: null,
    },
    otpSendCount: { type: Number, default: 0 },
    otpLastSentAt: { type: Date, default: null },
    otpBlockedUntil: { type: Date, default: null },
  },
  { timestamps: true },
);

export default mongoose.model('User', userSchema);
