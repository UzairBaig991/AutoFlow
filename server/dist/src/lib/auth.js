import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from './prisma.js';
export const authCookieName = 'autoflow_session';
export const sessionLifetimeMs = 1000 * 60 * 60 * 24 * 7;
function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (process.env.NODE_ENV === 'production' && (!secret || secret.length < 32 || /^(change-me|replace-with|your[-_])/i.test(secret))) {
        throw new Error('A private JWT_SECRET of at least 32 characters must be configured in production');
    }
    return secret ?? 'development-secret';
}
const passwordSchema = z.string()
    .min(12, 'Password must be at least 12 characters')
    .max(128, 'Password must be at most 128 characters')
    .refine((password) => Buffer.byteLength(password, 'utf8') <= 72, 'Password must not exceed 72 UTF-8 bytes');
export const registerSchema = z.object({
    name: z.string().trim().min(2).max(80),
    email: z.string().trim().email().max(254),
    password: passwordSchema,
    inviteToken: z.string().min(32).max(256).optional(),
});
export const loginSchema = z.object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(128)
        .refine((password) => Buffer.byteLength(password, 'utf8') <= 72, 'Password is too long'),
});
export function signToken(userId, sessionId) {
    return jwt.sign({ sub: userId, sid: sessionId }, getJwtSecret(), { expiresIn: '7d' });
}
const authCookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
};
export function setAuthCookie(res, token) {
    res.cookie(authCookieName, token, { ...authCookieOptions, maxAge: sessionLifetimeMs });
}
export function clearAuthCookie(res) {
    res.clearCookie(authCookieName, authCookieOptions);
}
export async function createAuthSession(userId) {
    const expiresAt = new Date(Date.now() + sessionLifetimeMs);
    const session = await prisma.authSession.create({
        data: { userId, expiresAt },
        select: { id: true },
    });
    return signToken(userId, session.id);
}
function getSessionClaims(token) {
    try {
        const payload = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
        if (typeof payload === 'string')
            return null;
        const claims = payload;
        if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string')
            return null;
        return { userId: claims.sub, sessionId: claims.sid };
    }
    catch {
        return null;
    }
}
export async function getAuthenticatedUser(req) {
    const token = req.cookies?.[authCookieName];
    if (!token)
        return null;
    const claims = getSessionClaims(token);
    if (!claims)
        return null;
    const session = await prisma.authSession.findFirst({
        where: {
            id: claims.sessionId,
            userId: claims.userId,
            revokedAt: null,
            expiresAt: { gt: new Date() },
        },
        select: { user: { select: { id: true, name: true, email: true, role: true } } },
    });
    return session?.user ?? null;
}
export async function revokeCurrentSession(req) {
    const token = req.cookies?.[authCookieName];
    if (!token)
        return;
    const claims = getSessionClaims(token);
    if (!claims)
        return;
    await prisma.authSession.updateMany({
        where: { id: claims.sessionId, userId: claims.userId, revokedAt: null },
        data: { revokedAt: new Date() },
    });
}
export function requireAuth(req, res, next) {
    getAuthenticatedUser(req).then((user) => {
        if (!user) {
            res.status(401).json({ success: false, message: 'Authentication required' });
            return;
        }
        req.user = user;
        next();
    }).catch(next);
}
