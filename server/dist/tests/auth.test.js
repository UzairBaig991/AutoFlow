import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
describe('Auth API', () => {
    it('returns health status', async () => {
        const response = await request(app).get('/api/health');
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
    });
    it('registers a new user', async () => {
        const email = `demo-${Date.now()}@example.com`;
        const response = await request(app)
            .post('/api/auth/register')
            .send({
            name: 'Demo User',
            email: email.toUpperCase(),
            password: 'StrongPass123',
        });
        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
        expect(response.body.user.email).toBe(email);
    });
    it('reports which optional OAuth providers are configured', async () => {
        const response = await request(app).get('/api/auth/providers');
        expect(response.status).toBe(200);
        expect(typeof response.body.providers.google).toBe('boolean');
        expect(typeof response.body.providers.github).toBe('boolean');
    });
    it('rejects weak passwords and cross-origin signup requests', async () => {
        const weakPassword = await request(app)
            .post('/api/auth/register')
            .send({ name: 'Weak Password', email: `weak-${Date.now()}@example.com`, password: 'short123' });
        expect(weakPassword.status).toBe(400);
        const crossOrigin = await request(app)
            .post('/api/auth/register')
            .set('Origin', 'https://untrusted.example')
            .send({ name: 'Cross Origin', email: `origin-${Date.now()}@example.com`, password: 'LongEnoughPass123' });
        expect(crossOrigin.status).toBe(403);
    });
    it('revokes a persisted session when the user logs out', async () => {
        const agent = request.agent(app);
        const email = `logout-${Date.now()}@example.com`;
        const registration = await agent.post('/api/auth/register').send({
            name: 'Logout User',
            email,
            password: 'LongEnoughPass123',
        });
        expect(registration.status).toBe(201);
        expect((await agent.get('/api/auth/me')).status).toBe(200);
        expect((await agent.post('/api/auth/logout')).status).toBe(200);
        expect((await agent.get('/api/auth/me')).status).toBe(401);
        expect(await prisma.authSession.count({ where: { userId: registration.body.user.id, revokedAt: null } })).toBe(0);
    });
    it('creates a single-use invitation and joins the invited workspace', async () => {
        const owner = request.agent(app);
        const ownerEmail = `owner-${Date.now()}@example.com`;
        const inviteeEmail = `invitee-${Date.now()}@example.com`;
        const registration = await owner.post('/api/auth/register').send({
            name: 'Workspace Owner',
            email: ownerEmail,
            password: 'LongEnoughPass123',
        });
        expect(registration.status).toBe(201);
        const invitation = await owner.post('/api/auth/invitations').send({ email: inviteeEmail });
        expect(invitation.status).toBe(201);
        const token = new URL(invitation.body.invitation.url).pathname.split('/').at(-1);
        if (!token)
            throw new Error('Invitation URL did not contain a token');
        expect(await prisma.workspaceInvitation.findUnique({ where: { tokenHash: token } })).toBeNull();
        const invitee = request.agent(app);
        const joined = await invitee.post('/api/auth/register').send({
            name: 'Invited Teammate',
            email: inviteeEmail,
            password: 'LongEnoughPass123',
            inviteToken: token,
        });
        expect(joined.status).toBe(201);
        expect(joined.body.user.role).toBe('MEMBER');
        expect(await prisma.workspaceMember.findFirst({
            where: { userId: joined.body.user.id, workspace: { owner: { email: ownerEmail } } },
        })).not.toBeNull();
        expect(await prisma.auditLog.count({ where: { actorId: joined.body.user.id, action: 'WORKSPACE_INVITATION_ACCEPTED' } })).toBe(1);
        const replay = await request(app).post('/api/auth/register').send({
            name: 'Another Teammate',
            email: `replay-${Date.now()}@example.com`,
            password: 'LongEnoughPass123',
            inviteToken: token,
        });
        expect(replay.status).toBe(400);
    });
});
