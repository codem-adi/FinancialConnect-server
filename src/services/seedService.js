import User from '../models/User.js';
import Household from '../models/Household.js';
import { generateJoinCode } from '../utils/joinCode.js';

export async function runStartupMigrations() {
  await User.updateMany({ isActive: { $exists: false } }, { $set: { isActive: true } });

  const households = await Household.find({
    $or: [{ joinCode: { $exists: false } }, { joinCode: null }, { joinCode: '' }],
  });
  for (const household of households) {
    for (let i = 0; i < 10; i++) {
      const code = generateJoinCode();
      const clash = await Household.findOne({ joinCode: code, _id: { $ne: household._id } });
      if (!clash) {
        household.joinCode = code;
        await household.save();
        break;
      }
    }
  }
}
