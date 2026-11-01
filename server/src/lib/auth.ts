import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from './prisma.js';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        name: string;
        email: string;
        role: string;
      };
    }
  }
}

export const authCookieName = 'autoflow_session';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production' && (!secret || secret === 'change-me-in-production')) {
    throw new Error('A production JWT_SECRET must be configured');
  }
  return secret ?? 'development-secret';
}

export const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export function signToken(userId: string) {
  return jwt.sign({ sub: userId }, getJwtSecret(), { expiresIn: '7d' });
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie(authCookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });
}

export async function getAuthenticatedUser(req: Request) {
  const token = req.cookies?.[authCookieName] ?? null;
  if (!token) return null;

  let userId: string;
  const secret = getJwtSecret();
  try {
    const payload = jwt.verify(token, secret) as { sub: string };
    if (typeof payload.sub !== 'string') return null;
    userId = payload.sub;
  } catch {
    return null;
  }

  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true },
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  getAuthenticatedUser(req).then((user) => {
    if (!user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    req.user = user;
    next();
  }).catch(next);
}
