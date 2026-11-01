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
  const secret = process.env.JWT_SECRET ?? 'development-secret';
  return jwt.sign({ sub: userId }, secret, { expiresIn: '7d' });
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

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET ?? 'development-secret') as { sub: string };
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true, role: true },
    });
    return user;
  } catch {
    return null;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  req.user = user;
  next();
}
