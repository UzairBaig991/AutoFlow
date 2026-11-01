import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

export const tasksRouter = Router();
export const notificationsRouter = Router();
export const adminRouter = Router();

async function workspaceIdsForUser(userId: string) {
  const [owned, memberships] = await Promise.all([
    prisma.workspace.findMany({ where: { ownerId: userId }, select: { id: true } }),
    prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true } }),
  ]);
  return [...new Set([...owned.map(({ id }) => id), ...memberships.map(({ workspaceId }) => workspaceId)])];
}

tasksRouter.use(requireAuth);
tasksRouter.get('/', async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: 'Authentication required' });
    const workspaceIds = await workspaceIdsForUser(user.id);
    const tasks = await prisma.task.findMany({
      where: { workspaceId: { in: workspaceIds } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return res.json({ success: true, tasks });
  } catch (error) {
    return next(error);
  }
});

tasksRouter.patch('/:id', async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: 'Authentication required' });
    const data = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']) }).parse(req.body);
    const workspaceIds = await workspaceIdsForUser(user.id);
    const task = await prisma.task.findFirst({ where: { id: req.params.id, workspaceId: { in: workspaceIds } } });
    if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
    const updated = await prisma.task.update({ where: { id: task.id }, data });
    return res.json({ success: true, task: updated });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ success: false, message: error.issues[0]?.message });
    return next(error);
  }
});

notificationsRouter.use(requireAuth);
notificationsRouter.get('/', async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: 'Authentication required' });
    const notifications = await prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return res.json({ success: true, notifications });
  } catch (error) {
    return next(error);
  }
});

notificationsRouter.patch('/:id/read', async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: 'Authentication required' });
    const notification = await prisma.notification.findFirst({ where: { id: req.params.id, userId: user.id } });
    if (!notification) return res.status(404).json({ success: false, message: 'Notification not found' });
    const updated = await prisma.notification.update({ where: { id: notification.id }, data: { isRead: true } });
    return res.json({ success: true, notification: updated });
  } catch (error) {
    return next(error);
  }
});

adminRouter.use(requireAuth);
adminRouter.get('/summary', async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, message: 'Authentication required' });
    const workspaceIds = await workspaceIdsForUser(user.id);
    if (!['OWNER', 'ADMIN'].includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Administrator access required' });
    }
    const [workflows, runs, tasks, failedRuns, members] = await Promise.all([
      prisma.workflow.count({ where: { workspaceId: { in: workspaceIds } } }),
      prisma.workflowRun.count({ where: { workflow: { workspaceId: { in: workspaceIds } } } }),
      prisma.task.count({ where: { workspaceId: { in: workspaceIds } } }),
      prisma.workflowRun.count({ where: { workflow: { workspaceId: { in: workspaceIds } }, status: 'FAILED' } }),
      prisma.workspaceMember.count({ where: { workspaceId: { in: workspaceIds } } }),
    ]);
    return res.json({
      success: true,
      summary: { workspaces: workspaceIds.length, members: members + workspaceIds.length, workflows, runs, tasks, failedRuns },
    });
  } catch (error) {
    return next(error);
  }
});
