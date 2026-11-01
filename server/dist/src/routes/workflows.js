import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
export const workflowsRouter = Router();
const workflowInputSchema = z.object({
    name: z.string().min(2).max(100),
    description: z.string().default(''),
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('DRAFT'),
    definitionJson: z.any().default({ nodes: [], edges: [] }),
});
workflowsRouter.use(requireAuth);
workflowsRouter.get('/', async (req, res, next) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }
        const workflows = await prisma.workflow.findMany({
            where: { createdById: user.id },
            orderBy: { updatedAt: 'desc' },
        });
        return res.json({ success: true, workflows });
    }
    catch (error) {
        return next(error);
    }
});
workflowsRouter.post('/', async (req, res, next) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }
        const data = workflowInputSchema.parse(req.body);
        const workflow = await prisma.workflow.create({
            data: {
                name: data.name,
                description: data.description,
                status: data.status,
                createdById: user.id,
                workspaceId: 'default-workspace',
                definitionJson: data.definitionJson,
            },
        });
        return res.status(201).json({ success: true, workflow });
    }
    catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, message: error.issues[0]?.message ?? 'Invalid workflow data' });
        }
        return next(error);
    }
});
workflowsRouter.get('/:id', async (req, res, next) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }
        const workflow = await prisma.workflow.findFirst({
            where: { id: req.params.id, createdById: user.id },
        });
        if (!workflow) {
            return res.status(404).json({ success: false, message: 'Workflow not found' });
        }
        return res.json({ success: true, workflow });
    }
    catch (error) {
        return next(error);
    }
});
workflowsRouter.patch('/:id', async (req, res, next) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }
        const workflow = await prisma.workflow.findFirst({
            where: { id: req.params.id, createdById: user.id },
        });
        if (!workflow) {
            return res.status(404).json({ success: false, message: 'Workflow not found' });
        }
        const data = workflowInputSchema.partial().parse(req.body);
        const updated = await prisma.workflow.update({
            where: { id: workflow.id },
            data: {
                ...data,
                updatedAt: new Date(),
            },
        });
        return res.json({ success: true, workflow: updated });
    }
    catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, message: error.issues[0]?.message ?? 'Invalid workflow data' });
        }
        return next(error);
    }
});
workflowsRouter.delete('/:id', async (req, res, next) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }
        const workflow = await prisma.workflow.findFirst({ where: { id: req.params.id, createdById: user.id } });
        if (!workflow) {
            return res.status(404).json({ success: false, message: 'Workflow not found' });
        }
        await prisma.workflow.delete({ where: { id: workflow.id } });
        return res.json({ success: true, message: 'Workflow deleted' });
    }
    catch (error) {
        return next(error);
    }
});
