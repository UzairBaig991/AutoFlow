import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { validateDefinition } from '../src/workflow-engine.js';

describe('Workflow engine', () => {
  it('rejects cyclic workflow graphs', () => {
    const result = validateDefinition({
      nodes: [
        { id: 'trigger', data: { kind: 'manual-trigger' } },
        { id: 'task', data: { kind: 'create-task' } },
      ],
      edges: [
        { source: 'trigger', target: 'task' },
        { source: 'task', target: 'trigger' },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('cycle'))).toBe(true);
  });

  it('executes only the matching condition branch and persists its logs and task', async () => {
    const agent = request.agent(app);
    const email = `workflow-${Date.now()}@example.com`;
    const registration = await agent.post('/api/auth/register').send({
      name: 'Workflow Test',
      email,
      password: 'StrongPass123',
    });
    expect(registration.status).toBe(201);

    const title = `Sales follow-up ${Date.now()}`;
    const created = await agent.post('/api/workflows').send({
      name: 'Inquiry branch test',
      description: 'Verifies condition routing',
      definitionJson: {
        nodes: [
          { id: 'start', type: 'automation', data: { kind: 'inquiry-trigger', label: 'New inquiry', config: {} } },
          { id: 'condition', type: 'automation', data: { kind: 'condition', label: 'Sales inquiry?', config: { field: 'category', operator: 'equals', value: 'sales' } } },
          { id: 'sales', type: 'automation', data: { kind: 'create-task', label: 'Create sales task', config: { title, description: 'Call the sales lead.' } } },
          { id: 'notify', type: 'automation', data: { kind: 'notification', label: 'Notify owner', config: { title: 'Sales inquiry received', message: 'A new sales follow-up is ready.' } } },
          { id: 'finish-sales', type: 'automation', data: { kind: 'end', label: 'Finish sales path', config: {} } },
          { id: 'support', type: 'automation', data: { kind: 'create-task', label: 'Create support task', config: { title: `Support follow-up ${Date.now()}`, description: '' } } },
        ],
        edges: [
          { id: 'start-condition', source: 'start', target: 'condition' },
          { id: 'condition-sales', source: 'condition', target: 'sales', sourceHandle: 'true' },
          { id: 'condition-support', source: 'condition', target: 'support', sourceHandle: 'false' },
          { id: 'sales-notify', source: 'sales', target: 'notify' },
          { id: 'notify-end', source: 'notify', target: 'finish-sales' },
        ],
      },
    });
    expect(created.status).toBe(201);

    const run = await agent.post(`/api/workflows/${created.body.workflow.id}/runs`).send({ category: 'sales' });
    expect(run.status).toBe(201);
    expect(run.body.run.status).toBe('SUCCESS');
    expect(run.body.run.logs.map((log: { nodeId: string }) => log.nodeId)).toEqual(['start', 'condition', 'sales', 'notify', 'finish-sales']);

    const tasks = await agent.get('/api/tasks');
    expect(tasks.status).toBe(200);
    expect(tasks.body.tasks.some((task: { title: string }) => task.title === title)).toBe(true);

    const notifications = await agent.get('/api/notifications');
    expect(notifications.status).toBe(200);
    expect(notifications.body.notifications.some((notification: { title: string }) => notification.title === 'Sales inquiry received')).toBe(true);

    const falseBranchRun = await agent.post(`/api/workflows/${created.body.workflow.id}/runs`).send({ category: 'support' });
    expect(falseBranchRun.status).toBe(201);
    expect(falseBranchRun.body.run.status).toBe('SUCCESS');
    expect(falseBranchRun.body.run.logs.map((log: { nodeId: string }) => log.nodeId)).toEqual(['start', 'condition', 'support']);
    const tasksAfterFalseBranch = await agent.get('/api/tasks');
    expect(tasksAfterFalseBranch.body.tasks.some((task: { title: string }) => task.title.startsWith('Support follow-up'))).toBe(true);
  });
});
