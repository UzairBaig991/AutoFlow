import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
export const analyticsRouter = Router();
async function workspaceIdsForUser(userId) {
    const [owned, memberships] = await Promise.all([
        prisma.workspace.findMany({ where: { ownerId: userId }, select: { id: true } }),
        prisma.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true } }),
    ]);
    return [...new Set([...owned.map(({ id }) => id), ...memberships.map(({ workspaceId }) => workspaceId)])];
}
analyticsRouter.use(requireAuth);
analyticsRouter.get('/overview', async (req, res, next) => {
    try {
        const user = req.user;
        if (!user)
            return res.status(401).json({ success: false, message: 'Authentication required' });
        const workspaceIds = await workspaceIdsForUser(user.id);
        const [totalWorkflows, activeWorkflows, totalRuns, succeededRuns, failedRuns, recentRuns, workflows] = await Promise.all([
            prisma.workflow.count({ where: { workspaceId: { in: workspaceIds } } }),
            prisma.workflow.count({ where: { workspaceId: { in: workspaceIds }, status: 'ACTIVE' } }),
            prisma.workflowRun.count({ where: { workflow: { workspaceId: { in: workspaceIds } } } }),
            prisma.workflowRun.count({ where: { workflow: { workspaceId: { in: workspaceIds } }, status: 'SUCCESS' } }),
            prisma.workflowRun.count({ where: { workflow: { workspaceId: { in: workspaceIds } }, status: 'FAILED' } }),
            prisma.workflowRun.findMany({
                where: { workflow: { workspaceId: { in: workspaceIds } } },
                include: { workflow: { select: { id: true, name: true } } },
                orderBy: { startedAt: 'desc' },
                take: 6,
            }),
            prisma.workflow.findMany({
                where: { workspaceId: { in: workspaceIds } },
                include: { _count: { select: { runs: true } } },
                orderBy: { updatedAt: 'desc' },
                take: 5,
            }),
        ]);
        return res.json({
            success: true,
            overview: {
                totalWorkflows,
                activeWorkflows,
                workflowsExecuted: totalRuns,
                successfulExecutions: succeededRuns,
                failedExecutions: failedRuns,
            },
            recentRuns,
            workflows: workflows.map(({ _count, ...workflow }) => ({
                ...workflow,
                definitionJson: JSON.parse(workflow.definitionJson),
                runCount: _count.runs,
            })),
        });
    }
    catch (error) {
        return next(error);
    }
});
analyticsRouter.get('/executions', async (req, res, next) => {
    try {
        const user = req.user;
        if (!user)
            return res.status(401).json({ success: false, message: 'Authentication required' });
        const workspaceIds = await workspaceIdsForUser(user.id);
        const requestedDays = Number(req.query.days ?? 7);
        const days = Number.isInteger(requestedDays) ? Math.min(Math.max(requestedDays, 1), 90) : 7;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days + 1);
        startDate.setHours(0, 0, 0, 0);
        const runs = await prisma.workflowRun.findMany({
            where: {
                workflow: { workspaceId: { in: workspaceIds } },
                startedAt: { gte: startDate },
            },
            select: { status: true, startedAt: true, finishedAt: true, workflowId: true, workflow: { select: { name: true } } },
            orderBy: { startedAt: 'asc' },
            take: 5000,
        });
        const byDate = new Map();
        for (let offset = 0; offset < days; offset += 1) {
            const date = new Date(startDate);
            date.setDate(startDate.getDate() + offset);
            const key = date.toISOString().slice(0, 10);
            byDate.set(key, { date: key, success: 0, failed: 0, total: 0 });
        }
        let totalDuration = 0;
        let durationCount = 0;
        const workflowCounts = new Map();
        for (const run of runs) {
            const date = run.startedAt.toISOString().slice(0, 10);
            const bucket = byDate.get(date);
            if (bucket) {
                bucket.total += 1;
                if (run.status === 'SUCCESS')
                    bucket.success += 1;
                if (run.status === 'FAILED')
                    bucket.failed += 1;
            }
            if (run.finishedAt) {
                totalDuration += run.finishedAt.getTime() - run.startedAt.getTime();
                durationCount += 1;
            }
            const current = workflowCounts.get(run.workflowId) ?? {
                workflowId: run.workflowId,
                name: run.workflow.name,
                runs: 0,
                failed: 0,
            };
            current.runs += 1;
            if (run.status === 'FAILED')
                current.failed += 1;
            workflowCounts.set(run.workflowId, current);
        }
        return res.json({
            success: true,
            analytics: {
                series: [...byDate.values()],
                mostExecuted: [...workflowCounts.values()].sort((a, b) => b.runs - a.runs).slice(0, 5),
                totalRuns: runs.length,
                successRate: runs.length ? Math.round((runs.filter((run) => run.status === 'SUCCESS').length / runs.length) * 100) : 0,
                averageDurationMs: durationCount ? Math.round(totalDuration / durationCount) : 0,
            },
        });
    }
    catch (error) {
        return next(error);
    }
});
