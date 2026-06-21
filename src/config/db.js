import mongoose from 'mongoose';

function authFailureHint() {
  return [
    'MongoDB authentication failed. On Render, verify MONGODB_URI:',
    '  • Copy the full connection string from MongoDB Atlas (Connect → Drivers).',
    '  • Replace <password> with your database user password.',
    '  • URL-encode special characters in the password (@ → %40, # → %23, / → %2F).',
    '  • Confirm the database user exists under Atlas → Database Access.',
  ].join('\n');
}

export async function connectDB() {
  const isProd = process.env.NODE_ENV === 'production';
  const uri = process.env.MONGODB_URI?.trim();

  if (!uri) {
    if (isProd) {
      throw new Error('MONGODB_URI is not set. Add it under Render → Environment.');
    }
    await mongoose.connect('mongodb://127.0.0.1:27017/retirewise');
    console.log('MongoDB connected (local fallback)');
    return;
  }

  try {
    await mongoose.connect(uri);
    console.log('MongoDB connected');
  } catch (err) {
    if (/bad auth|authentication failed|auth fail/i.test(err.message || '')) {
      throw new Error(`${err.message}\n${authFailureHint()}`);
    }
    throw err;
  }
}
