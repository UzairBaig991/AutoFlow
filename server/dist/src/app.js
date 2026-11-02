import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { authRouter } from './routes/auth.js';
import { workflowsRouter } from './routes/workflows.js';
import { analyticsRouter } from './routes/analytics.js';
import { adminRouter, notificationsRouter, tasksRouter } from './routes/activity.js';
import { runsRouter } from './routes/runs.js';
import { prisma } from './lib/prisma.js';
const app = express();
const authRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many authentication attempts. Please try again later.' },
});
app.use(helmet({
    contentSecurityPolicy: false,
}));
app.use(cors({
    origin: process.env.CLIENT_URL ?? 'http://localhost:5173',
    credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please try again later.' },
}));
app.use('/api/auth', authRateLimit);
app.get('/api/health', async (_req, res) => {
    try {
        await prisma.$queryRaw `SELECT 1`;
        res.json({ success: true, status: 'ok', database: 'ready' });
    }
    catch {
        res.status(500).json({ success: false, status: 'error', database: 'unavailable' });
    }
});
app.use('/api/auth', authRouter);
app.use('/api/workflows', workflowsRouter);
app.use('/api/runs', runsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/admin', adminRouter);
app.use((error, _req, res, _next) => {
    const statusCode = error.statusCode ?? error.status ?? 500;
    const isOperationalError = statusCode < 500;
    if (!isOperationalError)
        console.error(error);
    res.status(statusCode).json({
        success: false,
        message: isOperationalError ? error.message : 'Internal server error',
    });
});
export default app;
