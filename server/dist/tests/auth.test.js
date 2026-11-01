import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
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
            email,
            password: 'StrongPass123',
        });
        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
        expect(response.body.user.email).toBe(email);
    });
});
