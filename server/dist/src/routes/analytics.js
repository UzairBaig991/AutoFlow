import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
export const analyticsRouter = Router();
analyticsRouter.use(requireAuth);
analyticsRouter.get('/overview', async (req, res, next) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }
        const [totalWorkflows, activeWorkflows, totalRuns, succeededRuns, failedRuns] = await Promise.all([
            prisma.workflow.count({ where: { createdById: user.id } }),
            prisma.workflow.count({ where: { createdById: user.id, status: 'ACTIVE' } }),
            prisma.workflowRun.count({ where: { workflow: { createdById: user.id } } }),
            prisma.workflowRun.count({ where: { workflow: { createdById: user.id }, status: 'SUCCESS' } }),
            prisma.workflowRun.count({ where: { workflow: { createdById: user.id }, status: 'FAILED' } }),
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
        });
    }
    catch (error) {
        return next(error);
    }
});
