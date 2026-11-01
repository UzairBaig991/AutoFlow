import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { authRouter } from './routes/auth.js';
import { workflowsRouter } from './routes/workflows.js';
import { analyticsRouter } from './routes/analytics.js';
import { prisma } from './lib/prisma.js';
const app = express();
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
app.use('/api/analytics', analyticsRouter);
app.use((error, _req, res, _next) => {
    const statusCode = error.status ?? 500;
    const isOperationalError = statusCode < 500;
    res.status(statusCode).json({
        success: false,
        message: isOperationalError ? error.message : 'Internal server error',
    });
});
export default app;
