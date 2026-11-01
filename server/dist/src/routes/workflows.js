import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { executeWorkflow, validateDefinition } from '../workflow-engine.js';
export const workflowsRouter = Router();
const workflowInputSchema = z.object({
    name: z.string().trim().min(2).max(100),
    description: z.string().max(1000).default(''),
    status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).default('DRAFT'),
    definitionJson: z.unknown().default({ nodes: [], edges: [] }),
});
async function workspaceIdsForUser(userId) {
    const [owned, memberships] = await Promise.all([
        prisma.workspace.findMany({ where: { ownerId: userId }, select: { id: true } }),
        prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true } }),
    ]);
    return [...new Set([...owned.map((workspace) => workspace.id), ...memberships.map((member) => member.workspaceId)])];
}
async function userWorkspaceId(userId) {
    const workspace = await prisma.workspace.findFirst({
        where: { OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
    });
    if (workspace)
        return workspace.id;
    const created = await prisma.workspace.create({ data: { name: 'My Workspace', ownerId: userId } });
    return created.id;
}
async function findAccessibleWorkflow(workflowId, userId) {
    const workspaceIds = await workspaceIdsForUser(userId);
    if (!workspaceIds.length)
        return null;
    return prisma.workflow.findFirst({
        where: { id: workflowId, workspaceId: { in: workspaceIds } },
        include: { workspace: { select: { id: true, ownerId: true } } },
    });
}
function parseStoredDefinition(serialized) {
    try {
        return JSON.parse(serialized);
    }
    catch {
        throw new Error('Stored workflow definition is corrupted');
    }
}
workflowsRouter.use(requireAuth);
workflowsRouter.get('/', async (req, res, next) => {
    try {
        const user = req.user;
        if (!user)
            return res.status(401).json({ success: false, message: 'Authentication required' });
        const workspaceIds = await workspaceIdsForUser(user.id);
        const workflows = await prisma.workflow.findMany({
            where: { workspaceId: { in: workspaceIds } },
            include: { _count: { select: { runs: true } } },
            orderBy: { updatedAt: 'desc' },
        });
        return res.json({
            success: true,
            workflows: workflows.map((workflow) => ({
                ...workflow,
                definitionJson: parseStoredDefinition(workflow.definitionJson),
                runCount: workflow._count.runs,
            })),
        });
    }
    catch (error) {
        return next(error);
    }
});
workflowsRouter.post('/', async (req, res, next) => {
    try {
        const user = req.user;
        if (!user)
            return res.status(401).json({ success: false, message: 'Authentication required' });
        const data = workflowInputSchema.parse(req.body);
        if (data.status === 'ACTIVE') {
            const validation = validateDefinition(data.definitionJson);
            if (!validation.valid)
                return res.status(400).json({ success: false, message: 'Workflow is not valid', errors: validation.errors });
        }
        const workspaceId = await userWorkspaceId(user.id);
        const serialized = JSON.stringify(data.definitionJson);
        const workflow = await prisma.$transaction(async (transaction) => {
            const created = await transaction.workflow.create({
                data: {
                    name: data.name,
                    description: data.description,
                    status: data.status,
                    createdById: user.id,
                    workspaceId,
                    definitionJson: serialized,
                },
            });
            await transaction.workflowVersion.create({
                data: { workflowId: created.id, versionNumber: 1, definitionJson: serialized, createdById: user.id },
            });
            return created;
        });
        return res.status(201).json({ success: true, workflow: { ...workflow, definitionJson: data.definitionJson } });
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
        if (!user)
            return res.status(401).json({ success: false, message: 'Authentication required' });
        const workflow = await findAccessibleWorkflow(req.params.id, user.id);
        if (!workflow)
            return res.status(404).json({ success: false, message: 'Workflow not found' });
        return res.json({ success: true, workflow: { ...workflow, definitionJson: parseStoredDefinition(workflow.definitionJson) } });
    }
    catch (error) {
        return next(error);
    }
});
workflowsRouter.patch('/:id', async (req, res, next) => {
    try {
        const user = req.user;
        if (!user)
            return res.status(401).json({ success: false, message: 'Authentication required' });
        const workflow = await findAccessibleWorkflow(req.params.id, user.id);
        if (!workflow)
            return res.status(404).json({ success: false, message: 'Workflow not found' });
        const data = workflowInputSchema.partial().parse(req.body);
        const nextDefinition = data.definitionJson ?? parseStoredDefinition(workflow.definitionJson);
        if ((data.status ?? workflow.status) === 'ACTIVE') {
            const validation = validateDefinition(nextDefinition);
            if (!validation.valid)
                return res.status(400).json({ success: false, message: 'Workflow is not valid', errors: validation.errors });
        }
        const definition = data.definitionJson === undefined ? undefined : JSON.stringify(data.definitionJson);
        const updated = await prisma.$transaction(async (transaction) => {
            const saved = await transaction.workflow.update({
                where: { id: workflow.id },
                data: {
                    name: data.name,
                    description: data.description,
                    status: data.status,
                    definitionJson: definition,
                },
            });
            if (definition !== undefined && definition !== workflow.definitionJson) {
                const latest = await transaction.workflowVersion.findFirst({
                    where: { workflowId: workflow.id },
                    orderBy: { versionNumber: 'desc' },
                    select: { versionNumber: true },
                });
                await transaction.workflowVersion.create({
                    data: {
                        workflowId: workflow.id,
                        versionNumber: (latest?.versionNumber ?? 0) + 1,
                        definitionJson: definition,
                        createdById: user.id,
                    },
                });
            }
            return saved;
        });
        return res.json({
            success: true,
            workflow: {
                ...updated,
                definitionJson: data.definitionJson ?? parseStoredDefinition(updated.definitionJson),
            },
        });
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
        if (!user)
            return res.status(401).json({ success: false, message: 'Authentication required' });
        const workflow = await findAccessibleWorkflow(req.params.id, user.id);
        if (!workflow)
            return res.status(404).json({ success: false, message: 'Workflow not found' });
        await prisma.workflow.delete({ where: { id: workflow.id } });
        return res.json({ success: true, message: 'Workflow deleted' });
    }
    catch (error) {
        return next(error);
    }
});
workflowsRouter.post('/:id/validate', async (req, res, next) => {
    try {
        const user = req.user;
        if (!user)
            return res.status(401).json({ success: false, message: 'Authentication required' });
        const workflow = await findAccessibleWorkflow(req.params.id, user.id);
        if (!workflow)
            return res.status(404).json({ success: false, message: 'Workflow not found' });
        return res.json({ success: true, ...validateDefinition(parseStoredDefinition(workflow.definitionJson)) });
    }
    catch (error) {
        return next(error);
    }
});
workflowsRouter.post('/:id/activate', async (req, res, next) => {
    try {
        const user = req.user;
        if (!user)
            return res.status(401).json({ success: false, message: 'Authentication required' });
        const workflow = await findAccessibleWorkflow(req.params.id, user.id);
        if (!workflow)
            return res.status(404).json({ success: false, message: 'Workflow not found' });
        const validation = validateDefinition(parseStoredDefinition(workflow.definitionJson));
        if (!validation.valid)
            return res.status(400).json({ success: false, message: 'Workflow is not valid', errors: validation.errors });
        const updated = await prisma.workflow.update({ where: { id: workflow.id }, data: { status: 'ACTIVE' } });
        return res.json({ success: true, workflow: updated });
    }
    catch (error) {
        return next(error);
    }
});
workflowsRouter.post('/:id/deactivate', async (req, res, next) => {
    try {
        const user = req.user;
        if (!user)
            return res.status(401).json({ success: false, message: 'Authentication required' });
        const workflow = await findAccessibleWorkflow(req.params.id, user.id);
        if (!workflow)
            return res.status(404).json({ success: false, message: 'Workflow not found' });
        const updated = await prisma.workflow.update({ where: { id: workflow.id }, data: { status: 'DRAFT' } });
        return res.json({ success: true, workflow: updated });
    }
    catch (error) {
        return next(error);
    }
});
workflowsRouter.post('/:id/runs', async (req, res, next) => {
    try {
        const user = req.user;
        if (!user)
            return res.status(401).json({ success: false, message: 'Authentication required' });
        const workflow = await findAccessibleWorkflow(req.params.id, user.id);
        if (!workflow)
            return res.status(404).json({ success: false, message: 'Workflow not found' });
        const input = z.record(z.unknown()).safeParse(req.body ?? {});
        if (!input.success)
            return res.status(400).json({ success: false, message: 'Run input must be an object' });
        const validation = validateDefinition(parseStoredDefinition(workflow.definitionJson));
        if (!validation.valid)
            return res.status(400).json({ success: false, message: 'Workflow is not valid', errors: validation.errors });
        const run = await executeWorkflow(workflow, user.id, input.data);
        return res.status(201).json({ success: run.status === 'SUCCESS', run });
    }
    catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ success: false, message: error.issues[0]?.message ?? 'Invalid run input' });
        }
        return next(error);
    }
});
