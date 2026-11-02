import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  clearAuthCookie,
  createAuthSession,
  loginSchema,
  registerSchema,
  requireAuth,
  revokeCurrentSession,
  setAuthCookie,
} from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

export const authRouter = Router();

type OAuthProvider = 'google' | 'github';
type OAuthProfile = { provider: OAuthProvider; providerAccountId: string; email: string; name: string };

class InvalidInvitationError extends Error {}

function isProvider(value: string): value is OAuthProvider {
  return value === 'google' || value === 'github';
}

function getProviderConfig(provider: OAuthProvider) {
  const clientId = process.env[provider === 'google' ? 'GOOGLE_CLIENT_ID' : 'GITHUB_CLIENT_ID'];
  const clientSecret = process.env[provider === 'google' ? 'GOOGLE_CLIENT_SECRET' : 'GITHUB_CLIENT_SECRET'];
  if (!clientId || !clientSecret) return null;

  const serverUrl = process.env.SERVER_URL ?? 'http://localhost:4000';
  return {
    clientId,
    clientSecret,
    callbackUrl: new URL(`/api/auth/oauth/${provider}/callback`, serverUrl).toString(),
  };
}

function invitationTokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function getClientUrl(path: string) {
  return new URL(path, process.env.CLIENT_URL ?? 'http://localhost:5173').toString();
}

function stateCookieName(provider: OAuthProvider) {
  return `autoflow_oauth_${provider}_state`;
}

function stateCookieOptions(provider: OAuthProvider) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: `/api/auth/oauth/${provider}`,
    maxAge: 10 * 60 * 1000,
  };
}

function stateMatches(queryValue: string, cookieValue: string) {
  const query = Buffer.from(queryValue);
  const cookie = Buffer.from(cookieValue);
  return query.length === cookie.length && timingSafeEqual(query, cookie);
}

function parseOAuthState(value: string) {
  try {
    const parsed = z.object({ state: z.string(), inviteToken: z.string().optional() }).safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function findValidInvitation(token: string, email: string) {
  return prisma.workspaceInvitation.findFirst({
    where: {
      tokenHash: invitationTokenHash(token),
      email,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
}

async function claimInvitation(transaction: Prisma.TransactionClient, invitationId: string, email: string) {
  const claimed = await transaction.workspaceInvitation.updateMany({
    where: {
      id: invitationId,
      email,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { acceptedAt: new Date() },
  });
  if (claimed.count !== 1) throw new InvalidInvitationError('Invitation is invalid or has expired');
}

async function acceptInvitationForUser(userId: string, email: string, token: string) {
  const normalizedEmail = email.toLowerCase();
  await prisma.$transaction(async (transaction) => {
    const invitation = await transaction.workspaceInvitation.findFirst({
      where: {
        tokenHash: invitationTokenHash(token),
        email: normalizedEmail,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!invitation) throw new InvalidInvitationError('Invitation is invalid or has expired');

    await claimInvitation(transaction, invitation.id, normalizedEmail);
    await transaction.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId } },
      update: {},
      create: { workspaceId: invitation.workspaceId, userId, role: invitation.role },
    });
    await transaction.auditLog.create({
      data: {
        workspaceId: invitation.workspaceId,
        actorId: userId,
        action: 'WORKSPACE_INVITATION_ACCEPTED',
        resourceType: 'WorkspaceInvitation',
        resourceId: invitation.id,
        metadata: JSON.stringify({ email: normalizedEmail }),
      },
    });
  });
}

async function authenticateOAuthProfile(profile: OAuthProfile, inviteToken?: string) {
  const identity = z.object({
    email: z.string().email().max(254),
    name: z.string().trim().min(1).max(80),
    providerAccountId: z.string().min(1).max(255),
  }).parse(profile);
  const email = identity.email.toLowerCase();
  const existingAccount = await prisma.authAccount.findUnique({
    where: { provider_providerAccountId: { provider: profile.provider, providerAccountId: profile.providerAccountId } },
    include: { user: true },
  });

  if (inviteToken) {
    return prisma.$transaction(async (transaction) => {
      const invitation = await transaction.workspaceInvitation.findFirst({
        where: {
          tokenHash: invitationTokenHash(inviteToken),
          email,
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (!invitation) throw new InvalidInvitationError('Invitation is invalid or has expired');

      const linkedAccount = existingAccount
        ? await transaction.authAccount.findUnique({
          where: { id: existingAccount.id },
          include: { user: true },
        })
        : await transaction.authAccount.findUnique({
          where: { provider_providerAccountId: { provider: profile.provider, providerAccountId: profile.providerAccountId } },
          include: { user: true },
        });
      if (linkedAccount && linkedAccount.user.email.toLowerCase() !== email) {
        throw new InvalidInvitationError('Invitation email does not match the signed-in account');
      }
      const user = linkedAccount?.user ?? await transaction.user.findUnique({ where: { email } }) ??
        await transaction.user.create({
          data: { name: identity.name, email, passwordHash: null, role: 'MEMBER' },
        });

      if (!linkedAccount) {
        await transaction.authAccount.create({
          data: { userId: user.id, provider: profile.provider, providerAccountId: profile.providerAccountId },
        });
      }
      await claimInvitation(transaction, invitation.id, email);
      await transaction.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: user.id } },
        update: {},
        create: { workspaceId: invitation.workspaceId, userId: user.id, role: invitation.role },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: invitation.workspaceId,
          actorId: user.id,
          action: 'WORKSPACE_INVITATION_ACCEPTED',
          resourceType: 'WorkspaceInvitation',
          resourceId: invitation.id,
          metadata: JSON.stringify({ email }),
        },
      });
      return user;
    });
  }

  if (existingAccount) return existingAccount.user;

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    await prisma.authAccount.create({
      data: { userId: existingUser.id, provider: profile.provider, providerAccountId: profile.providerAccountId },
    });
    return existingUser;
  }

  return prisma.$transaction(async (transaction) => {
    const user = await transaction.user.create({
      data: { name: identity.name, email, passwordHash: null, role: 'OWNER' },
    });
    await transaction.workspace.create({ data: { name: `${identity.name}'s Workspace`, ownerId: user.id } });
    await transaction.authAccount.create({
      data: { userId: user.id, provider: profile.provider, providerAccountId: profile.providerAccountId },
    });
    return user;
  });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`OAuth provider request failed (${response.status})`);
  return response.json() as Promise<T>;
}

async function getGoogleProfile(code: string, config: NonNullable<ReturnType<typeof getProviderConfig>>): Promise<OAuthProfile> {
  const token = await fetchJson<{ access_token?: string }>('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.callbackUrl,
      grant_type: 'authorization_code',
    }),
  });
  if (!token.access_token) throw new Error('Google did not return an access token');

  const profile = await fetchJson<{ sub?: string; email?: string; email_verified?: boolean; name?: string }>(
    'https://openidconnect.googleapis.com/v1/userinfo',
    { headers: { Authorization: `Bearer ${token.access_token}` } },
  );
  if (!profile.sub || !profile.email || profile.email_verified !== true) {
    throw new Error('Google account must have a verified email address');
  }
  return {
    provider: 'google',
    providerAccountId: profile.sub,
    email: profile.email,
    name: profile.name || profile.email.split('@')[0] || profile.email,
  };
}

async function getGitHubProfile(code: string, config: NonNullable<ReturnType<typeof getProviderConfig>>): Promise<OAuthProfile> {
  const token = await fetchJson<{ access_token?: string }>('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.callbackUrl,
    }),
  });
  if (!token.access_token) throw new Error('GitHub did not return an access token');

  const headers = { Authorization: `Bearer ${token.access_token}`, Accept: 'application/vnd.github+json' };
  const [profile, emails] = await Promise.all([
    fetchJson<{ id?: number; name?: string | null; login?: string }>('https://api.github.com/user', { headers }),
    fetchJson<Array<{ email: string; primary: boolean; verified: boolean }>>('https://api.github.com/user/emails', { headers }),
  ]);
  const verifiedEmail = emails.find((item) => item.primary && item.verified)?.email;
  if (!profile.id || !verifiedEmail) throw new Error('GitHub account must have a verified email address');
  return {
    provider: 'github',
    providerAccountId: String(profile.id),
    email: verifiedEmail,
    name: profile.name || profile.login || verifiedEmail,
  };
}

authRouter.get('/providers', (_req, res) => {
  return res.json({
    success: true,
    providers: { google: Boolean(getProviderConfig('google')), github: Boolean(getProviderConfig('github')) },
  });
});

authRouter.post('/register', async (req, res, next) => {
  try {
    const data = registerSchema.parse(req.body);
    const email = data.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ success: false, message: 'User already exists' });

    const invitation = data.inviteToken ? await findValidInvitation(data.inviteToken, email) : null;
    if (data.inviteToken && !invitation) {
      return res.status(400).json({ success: false, message: 'Invitation is invalid, expired, or for a different email' });
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = await prisma.$transaction(async (transaction) => {
      if (invitation) await claimInvitation(transaction, invitation.id, email);

      const createdUser = await transaction.user.create({
        data: {
          name: data.name,
          email,
          passwordHash,
          role: invitation ? 'MEMBER' : 'OWNER',
        },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      });

      if (invitation) {
        await transaction.workspaceMember.create({
          data: { workspaceId: invitation.workspaceId, userId: createdUser.id, role: invitation.role },
        });
        await transaction.auditLog.create({
          data: {
            workspaceId: invitation.workspaceId,
            actorId: createdUser.id,
            action: 'WORKSPACE_INVITATION_ACCEPTED',
            resourceType: 'WorkspaceInvitation',
            resourceId: invitation.id,
            metadata: JSON.stringify({ email }),
          },
        });
      } else {
        await transaction.workspace.create({
          data: { name: `${data.name}'s Workspace`, ownerId: createdUser.id },
        });
      }

      return createdUser;
    });

    const token = await createAuthSession(user.id);
    setAuthCookie(res, token);
    return res.status(201).json({ success: true, user });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: error.issues[0]?.message ?? 'Invalid input' });
    }
    if (error instanceof InvalidInvitationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'User already exists' });
    }
    return next(error);
  }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const data = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
    const valid = user?.passwordHash ? await bcrypt.compare(data.password, user.passwordHash) : false;
    if (!user || !valid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const token = await createAuthSession(user.id);
    setAuthCookie(res, token);
    return res.status(200).json({
      success: true,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: error.issues[0]?.message ?? 'Invalid input' });
    }
    return next(error);
  }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    await revokeCurrentSession(req);
    clearAuthCookie(res);
    return res.json({ success: true, message: 'Logged out' });
  } catch (error) {
    return next(error);
  }
});

authRouter.post('/invitations', requireAuth, async (req, res, next) => {
  try {
    const user = req.user;
    if (!user || !['OWNER', 'ADMIN'].includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Workspace owner access required' });
    }
    const data = z.object({ email: z.string().trim().email().max(254) }).parse(req.body);
    const email = data.email.toLowerCase();
    const workspace = await prisma.workspace.findFirst({
      where: { ownerId: user.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!workspace) return res.status(404).json({ success: false, message: 'Owned workspace not found' });

    const token = randomBytes(32).toString('base64url');
    const invitation = await prisma.$transaction(async (transaction) => {
      await transaction.workspaceInvitation.updateMany({
        where: { workspaceId: workspace.id, email, acceptedAt: null },
        data: { expiresAt: new Date() },
      });
      const createdInvitation = await transaction.workspaceInvitation.create({
        data: {
          workspaceId: workspace.id,
          invitedById: user.id,
          email,
          tokenHash: invitationTokenHash(token),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
        select: { id: true, expiresAt: true },
      });
      await transaction.auditLog.create({
        data: {
          workspaceId: workspace.id,
          actorId: user.id,
          action: 'WORKSPACE_INVITATION_CREATED',
          resourceType: 'WorkspaceInvitation',
          resourceId: createdInvitation.id,
          metadata: JSON.stringify({ email }),
        },
      });
      return createdInvitation;
    });
    return res.status(201).json({
      success: true,
      invitation: { email, expiresAt: invitation.expiresAt, url: getClientUrl(`/invite/${token}`) },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: error.issues[0]?.message ?? 'Invalid input' });
    }
    return next(error);
  }
});

authRouter.post('/invitations/accept', requireAuth, async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: 'Authentication required' });
    const { token } = z.object({ token: z.string().min(32).max(256) }).parse(req.body);
    await acceptInvitationForUser(user.id, user.email, token);
    return res.json({ success: true, message: 'Workspace invitation accepted' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, message: error.issues[0]?.message ?? 'Invalid input' });
    }
    if (error instanceof InvalidInvitationError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
});

authRouter.get('/oauth/:provider', (req, res) => {
  const providerName = req.params.provider;
  if (!isProvider(providerName)) return res.status(404).json({ success: false, message: 'OAuth provider not found' });
  const config = getProviderConfig(providerName);
  if (!config) return res.status(503).json({ success: false, message: `${providerName} sign-in is not configured` });

  const rawInviteToken = typeof req.query.inviteToken === 'string' ? req.query.inviteToken : undefined;
  const parsedInviteToken = rawInviteToken === undefined
    ? undefined
    : z.string().min(32).max(256).safeParse(rawInviteToken);
  if (parsedInviteToken && !parsedInviteToken.success) {
    return res.status(400).json({ success: false, message: 'Invitation token is invalid' });
  }
  const inviteToken = parsedInviteToken?.success ? parsedInviteToken.data : undefined;
  const state = randomBytes(32).toString('base64url');
  res.cookie(stateCookieName(providerName), JSON.stringify({ state, inviteToken }), stateCookieOptions(providerName));

  const authorizationUrl = new URL(
    providerName === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://github.com/login/oauth/authorize',
  );
  authorizationUrl.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    response_type: 'code',
    scope: providerName === 'google' ? 'openid email profile' : 'read:user user:email',
    state,
    ...(providerName === 'google' ? { prompt: 'select_account' } : {}),
  }).toString();
  return res.redirect(authorizationUrl.toString());
});

authRouter.get('/oauth/:provider/callback', async (req, res) => {
  const providerName = req.params.provider;
  if (!isProvider(providerName)) return res.status(404).json({ success: false, message: 'OAuth provider not found' });

  const cookieName = stateCookieName(providerName);
  const cookieValue = req.cookies?.[cookieName] as string | undefined;
  res.clearCookie(cookieName, stateCookieOptions(providerName));
  const parsedState = cookieValue ? parseOAuthState(cookieValue) : null;
  const inviteToken = parsedState?.inviteToken;

  try {
    const queryState = typeof req.query.state === 'string' ? req.query.state : '';
    if (!queryState || !parsedState || !stateMatches(queryState, parsedState.state)) {
      return res.redirect(getClientUrl('/login?error=oauth_state'));
    }
    if (typeof req.query.error === 'string') {
      const path = inviteToken
        ? `/invite/${encodeURIComponent(inviteToken)}?error=oauth_cancelled`
        : '/login?error=oauth_cancelled';
      return res.redirect(getClientUrl(path));
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) throw new Error('OAuth provider did not return an authorization code');
    const config = getProviderConfig(providerName);
    if (!config) throw new Error(`${providerName} sign-in is not configured`);

    const profile = providerName === 'google'
      ? await getGoogleProfile(code, config)
      : await getGitHubProfile(code, config);
    const user = await authenticateOAuthProfile(profile, inviteToken);
    const token = await createAuthSession(user.id);
    setAuthCookie(res, token);
    return res.redirect(getClientUrl('/app'));
  } catch (error) {
    if (error instanceof InvalidInvitationError) {
      const path = inviteToken
        ? `/invite/${encodeURIComponent(inviteToken)}?error=invitation_invalid`
        : '/login?error=invitation_invalid';
      return res.redirect(getClientUrl(path));
    }
    console.error('OAuth callback failed:', error instanceof Error ? error.message : 'Unknown error');
    const path = inviteToken
      ? `/invite/${encodeURIComponent(inviteToken)}?error=oauth_failed`
      : '/login?error=oauth_failed';
    return res.redirect(getClientUrl(path));
  }
});

authRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  return res.json({ success: true, user });
});
