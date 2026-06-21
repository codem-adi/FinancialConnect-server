import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { connectDB } from './config/db.js';
import { runStartupMigrations } from './services/seedService.js';
import { verifySmtpConnection } from './services/emailService.js';
import { startCardBillReminderScheduler } from './services/cardBillReminderService.js';
import apiRoutes from './routes/api.js';
import authRoutes from './routes/auth.js';
import teamRoutes from './routes/team.js';
import notificationRoutes from './routes/notifications.js';

const app = express();
const PORT = process.env.PORT || 5000;

const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
  : undefined;

app.use(cors(corsOrigins ? { origin: corsOrigins, credentials: true } : undefined));
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'RetireWise API' });
});

app.use('/api/auth', authRoutes);
app.use('/api/team', teamRoutes);
app.use('/api', notificationRoutes);
app.use('/api', apiRoutes);

async function start() {
  try {
    await connectDB();
    await runStartupMigrations();
    await verifySmtpConnection();
    startCardBillReminderScheduler();
    app.listen(PORT, () => console.log(`RetireWise API listening on port ${PORT}`));
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
}

start();
