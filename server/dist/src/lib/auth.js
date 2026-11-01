import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from './prisma.js';
export const authCookieName = 'autoflow_session';
export const registerSchema = z.object({
    name: z.string().min(2).max(80),
    email: z.string().email(),
    password: z.string().min(8).max(128),
});
export const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8).max(128),
});
export function signToken(userId) {
    const secret = process.env.JWT_SECRET ?? 'development-secret';
    return jwt.sign({ sub: userId }, secret, { expiresIn: '7d' });
}
export function setAuthCookie(res, token) {
    res.cookie(authCookieName, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 24 * 7,
    });
}
export async function getAuthenticatedUser(req) {
    const token = req.cookies?.[authCookieName] ?? null;
    if (!token)
        return null;
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET ?? 'development-secret');
        const user = await prisma.user.findUnique({ where: { id: payload.sub } });
        return user;
    }
    catch {
        return null;
    }
}
export async function requireAuth(req, res, next) {
    const user = await getAuthenticatedUser(req);
    if (!user) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return;
    }
    req.user = user;
    next();
}
