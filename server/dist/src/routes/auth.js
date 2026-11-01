import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { loginSchema, registerSchema, requireAuth, setAuthCookie, signToken } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
export const authRouter = Router();
authRouter.post('/register', async (req, res, next) => {
    try {
        const data = registerSchema.parse(req.body);
        const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
        if (existing) {
            return res.status(409).json({ success: false, message: 'User already exists' });
        }
        const passwordHash = await bcrypt.hash(data.password, 12);
        const user = await prisma.$transaction(async (transaction) => {
            const createdUser = await transaction.user.create({
                data: {
                    name: data.name,
                    email: data.email.toLowerCase(),
                    passwordHash,
                    role: 'OWNER',
                },
                select: { id: true, name: true, email: true, role: true, createdAt: true },
            });
            await transaction.workspace.create({
                data: { name: `${data.name}'s Workspace`, ownerId: createdUser.id },
            });
            return createdUser;
        });
        const token = signToken(user.id);
        setAuthCookie(res, token);
        return res.status(201).json({ success: true, user });
    }
    catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, message: error.issues[0]?.message ?? 'Invalid input' });
        }
        return next(error);
    }
});
authRouter.post('/login', async (req, res, next) => {
    try {
        const data = loginSchema.parse(req.body);
        const user = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }
        const valid = await bcrypt.compare(data.password, user.passwordHash);
        if (!valid) {
            return res.status(401).json({ success: false, message: 'Invalid email or password' });
        }
        const token = signToken(user.id);
        setAuthCookie(res, token);
        return res.status(200).json({
            success: true,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
            },
        });
    }
    catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, message: error.issues[0]?.message ?? 'Invalid input' });
        }
        return next(error);
    }
});
authRouter.post('/logout', (_req, res) => {
    res.clearCookie('autoflow_session');
    res.json({ success: true, message: 'Logged out' });
});
authRouter.get('/me', requireAuth, async (req, res) => {
    const user = req.user;
    if (!user) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    return res.json({ success: true, user });
});
