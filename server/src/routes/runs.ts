import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { executeWorkflow } from '../workflow-engine.js';

export const runsRouter = Router();

async function workspaceIdsForUser(userId: string) {
  const [owned, memberships] = await Promise.all([
    prisma.workspace.findMany({ where: { ownerId: userId }, select: { id: true } }),
    prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true } }),
  ]);
  return [...new Set([...owned.map(({ id }) => id), ...memberships.map(({ workspaceId }) => workspaceId)])];
}

runsRouter.use(requireAuth);

runsRouter.get('/', async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: 'Authentication required' });
    const workspaceIds = await workspaceIdsForUser(user.id);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const runs = await prisma.workflowRun.findMany({
      where: {
        workflow: { workspaceId: { in: workspaceIds } },
        ...(status ? { status } : {}),
      },
      include: { workflow: { select: { id: true, name: true } } },
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
    return res.json({ success: true, runs });
  } catch (error) {
    return next(error);
  }
});

runsRouter.get('/:id', async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: 'Authentication required' });
    const workspaceIds = await workspaceIdsForUser(user.id);
    const run = await prisma.workflowRun.findFirst({
      where: { id: req.params.id, workflow: { workspaceId: { in: workspaceIds } } },
      include: {
        workflow: { select: { id: true, name: true } },
        logs: { orderBy: { startedAt: 'asc' } },
      },
    });
    if (!run) return res.status(404).json({ success: false, message: 'Run not found' });
    return res.json({ success: true, run });
  } catch (error) {
    return next(error);
  }
});

runsRouter.get('/:id/logs', async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: 'Authentication required' });
    const workspaceIds = await workspaceIdsForUser(user.id);
    const run = await prisma.workflowRun.findFirst({
      where: { id: req.params.id, workflow: { workspaceId: { in: workspaceIds } } },
      select: { id: true },
    });
    if (!run) return res.status(404).json({ success: false, message: 'Run not found' });
    const logs = await prisma.executionLog.findMany({ where: { runId: run.id }, orderBy: { startedAt: 'asc' } });
    return res.json({ success: true, logs });
  } catch (error) {
    return next(error);
  }
});

runsRouter.post('/:id/retry', async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: 'Authentication required' });
    const workspaceIds = await workspaceIdsForUser(user.id);
    const previous = await prisma.workflowRun.findFirst({
      where: { id: req.params.id, status: 'FAILED', workflow: { workspaceId: { in: workspaceIds } } },
      include: { workflow: { include: { workspace: { select: { id: true, ownerId: true } } } } },
    });
    if (!previous) return res.status(404).json({ success: false, message: 'Retryable failed run not found' });
    const input = previous.inputData ? JSON.parse(previous.inputData) as Record<string, unknown> : {};
    const run = await executeWorkflow(previous.workflow, user.id, input);
    return res.status(201).json({ success: run.status === 'SUCCESS', run });
  } catch (error) {
    return next(error);
  }
});
