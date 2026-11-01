import { z } from 'zod';
import type { Workflow } from '@prisma/client';
import { prisma } from './lib/prisma.js';

type JsonRecord = Record<string, unknown>;

export type WorkflowNode = {
  id: string;
  type?: string | null;
  data: {
    kind: string;
    label?: string;
    config?: JsonRecord;
  };
};

export type WorkflowEdge = {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
};

export type WorkflowDefinition = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

const definitionSchema = z.object({
  nodes: z.array(z.object({
    id: z.string().min(1),
    type: z.string().optional().nullable(),
    data: z.object({
      kind: z.string().min(1),
      label: z.string().optional(),
      config: z.record(z.unknown()).optional(),
    }),
  })).max(100),
  edges: z.array(z.object({
    id: z.string().optional(),
    source: z.string().min(1),
    target: z.string().min(1),
    sourceHandle: z.string().optional().nullable(),
  })).max(200),
});

const supportedKinds = new Set([
  'manual-trigger',
  'inquiry-trigger',
  'webhook-trigger',
  'scheduled-trigger',
  'condition',
  'create-task',
  'assign-team',
  'notification',
  'transform-data',
  'log-message',
  'delay',
  'end',
]);

export function parseDefinition(input: unknown): WorkflowDefinition {
  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Workflow definition is invalid');
  }
  return parsed.data as WorkflowDefinition;
}

export function validateDefinition(input: unknown) {
  const errors: string[] = [];
  let definition: WorkflowDefinition;
  try {
    definition = parseDefinition(input);
  } catch (error) {
    return { valid: false, errors: [error instanceof Error ? error.message : 'Workflow definition is invalid'] };
  }

  const nodeById = new Map<string, WorkflowNode>();
  for (const node of definition.nodes) {
    if (nodeById.has(node.id)) errors.push(`Duplicate node id: ${node.id}`);
    nodeById.set(node.id, node);
    if (!supportedKinds.has(node.data.kind)) errors.push(`Unsupported node type: ${node.data.kind}`);
  }

  const triggers = definition.nodes.filter((node) => node.data.kind.endsWith('-trigger'));
  if (triggers.length !== 1) errors.push('A workflow must contain exactly one trigger node');
  if (definition.nodes.length === 0) errors.push('Add a trigger and at least one workflow node');

  const outgoing = new Map<string, WorkflowEdge[]>();
  const incomingCount = new Map<string, number>();
  const edgeKeys = new Set<string>();

  for (const edge of definition.edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      errors.push(`Connection references a missing node: ${edge.source} → ${edge.target}`);
      continue;
    }
    if (edge.source === edge.target) errors.push(`A node cannot connect to itself: ${edge.source}`);

    const key = `${edge.source}:${edge.sourceHandle ?? ''}:${edge.target}`;
    if (edgeKeys.has(key)) errors.push('Duplicate connections are not allowed');
    edgeKeys.add(key);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
  }

  for (const node of definition.nodes) {
    const edges = outgoing.get(node.id) ?? [];
    if (node.data.kind === 'condition') {
      const handles = new Set(edges.map((edge) => edge.sourceHandle));
      if (edges.length !== 2 || !handles.has('true') || !handles.has('false')) {
        errors.push(`Condition "${node.data.label ?? node.id}" needs one true and one false connection`);
      }
    } else if (node.data.kind !== 'end' && edges.length > 1) {
      errors.push(`Node "${node.data.label ?? node.id}" can have only one outgoing connection`);
    }
  }

  for (const node of definition.nodes) {
    if (node.data.kind.endsWith('-trigger') && (incomingCount.get(node.id) ?? 0) > 0) {
      errors.push('The trigger node cannot have incoming connections');
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) {
      errors.push('Workflow contains a cycle. Cyclic graphs are not supported.');
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of outgoing.get(id) ?? []) visit(edge.target);
    visiting.delete(id);
    visited.add(id);
  }
  for (const node of definition.nodes) visit(node.id);

  const trigger = triggers[0];
  if (trigger) {
    const reachable = new Set<string>();
    const queue = [trigger.id];
    while (queue.length) {
      const id = queue.shift();
      if (!id || reachable.has(id)) continue;
      reachable.add(id);
      for (const edge of outgoing.get(id) ?? []) queue.push(edge.target);
    }
    for (const node of definition.nodes) {
      if (!reachable.has(node.id)) errors.push(`Node "${node.data.label ?? node.id}" is not reachable from the trigger`);
    }
  }

  return { valid: errors.length === 0, errors, definition };
}

function getPathValue(source: JsonRecord, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as JsonRecord)[key];
  }, source);
}

function compareCondition(actual: unknown, operator: string, expected: unknown) {
  switch (operator) {
    case 'equals': return String(actual ?? '') === String(expected ?? '');
    case 'not-equals': return String(actual ?? '') !== String(expected ?? '');
    case 'contains': return String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
    case 'greater-than': return Number(actual) > Number(expected);
    case 'less-than': return Number(actual) < Number(expected);
    case 'is-empty': return actual === undefined || actual === null || actual === '';
    case 'is-not-empty': return actual !== undefined && actual !== null && actual !== '';
    default: throw new Error(`Unsupported condition operator: ${operator}`);
  }
}

function jsonStringify(value: unknown) {
  return JSON.stringify(value ?? null);
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    /password|secret|token|authorization/i.test(key) ? '[REDACTED]' : redact(child),
  ]));
}

async function executeNode(
  node: WorkflowNode,
  context: JsonRecord,
  workflow: Workflow & { workspace: { id: string; ownerId: string } },
  runId: string,
) {
  const config = node.data.config ?? {};
  switch (node.data.kind) {
    case 'manual-trigger':
    case 'inquiry-trigger':
    case 'webhook-trigger':
    case 'scheduled-trigger':
      return { result: context, branch: undefined };
    case 'condition': {
      const field = typeof config.field === 'string' ? config.field : '';
      const operator = typeof config.operator === 'string' ? config.operator : 'equals';
      return {
        result: { matched: compareCondition(getPathValue(context, field), operator, config.value) },
        branch: compareCondition(getPathValue(context, field), operator, config.value) ? 'true' : 'false',
      };
    }
    case 'create-task': {
      const task = await prisma.task.create({
        data: {
          workspaceId: workflow.workspace.id,
          runId,
          title: typeof config.title === 'string' && config.title.trim() ? config.title.trim() : 'Workflow task',
          description: typeof config.description === 'string' ? config.description : '',
        },
      });
      return { result: { taskId: task.id, title: task.title } };
    }
    case 'assign-team':
      return { result: { assignedTeam: typeof config.team === 'string' ? config.team : 'Operations' } };
    case 'notification': {
      const notification = await prisma.notification.create({
        data: {
          userId: workflow.workspace.ownerId,
          workspaceId: workflow.workspace.id,
          title: typeof config.title === 'string' && config.title.trim() ? config.title.trim() : 'Workflow notification',
          message: typeof config.message === 'string' ? config.message : 'A workflow action was completed.',
        },
      });
      return { result: { notificationId: notification.id } };
    }
    case 'transform-data': {
      const key = typeof config.key === 'string' && config.key.trim() ? config.key.trim() : 'transformed';
      const value = typeof config.value === 'string' ? config.value : '';
      return { result: { [key]: value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => String(getPathValue(context, path) ?? '')) } };
    }
    case 'log-message':
      return { result: { message: typeof config.message === 'string' ? config.message : 'Workflow step completed' } };
    case 'delay': {
      const duration = Number(config.milliseconds ?? 0);
      if (!Number.isInteger(duration) || duration < 0 || duration > 2000) {
        throw new Error('Delay must be an integer between 0 and 2000 milliseconds');
      }
      if (duration > 0) await new Promise((resolve) => setTimeout(resolve, duration));
      return { result: { delayedMilliseconds: duration } };
    }
    case 'end':
      return { result: { completed: true }, branch: 'end' };
    default:
      throw new Error(`Unsupported node type: ${node.data.kind}`);
  }
}

export async function executeWorkflow(
  workflow: Workflow & { workspace: { id: string; ownerId: string } },
  userId: string,
  input: JsonRecord,
) {
  const validation = validateDefinition(JSON.parse(workflow.definitionJson));
  if (!validation.valid || !validation.definition) {
    throw new Error(validation.errors.join('; ') || 'Workflow definition is invalid');
  }

  const definition = validation.definition;
  const trigger = definition.nodes.find((node) => node.data.kind.endsWith('-trigger'));
  if (!trigger) throw new Error('Workflow has no trigger node');
  const versionNumber = await prisma.workflowVersion.count({ where: { workflowId: workflow.id } }) + 1;
  const version = await prisma.workflowVersion.create({
    data: {
      workflowId: workflow.id,
      versionNumber: versionNumber || 1,
      definitionJson: workflow.definitionJson,
      createdById: userId,
    },
  });
  const run = await prisma.workflowRun.create({
    data: {
      workflowId: workflow.id,
      versionId: version.id,
      triggeredById: userId,
      triggerType: 'MANUAL',
      status: 'RUNNING',
      inputData: jsonStringify(redact(input)),
    },
  });

  const nodeById = new Map(definition.nodes.map((node) => [node.id, node]));
  const context: JsonRecord = { ...input };
  let currentId: string | undefined = trigger.id;
  let finalStatus = 'SUCCESS';
  let errorMessage: string | undefined;
  let executedCount = 0;

  try {
    while (currentId) {
      if (++executedCount > 100) throw new Error('Execution limit exceeded');
      const node = nodeById.get(currentId);
      if (!node) throw new Error(`Missing node: ${currentId}`);
      const startedAt = new Date();
      const inputSnapshot = redact({ ...context });
      try {
        const { result, branch } = await executeNode(node, context, workflow, run.id);
        Object.assign(context, result);
        await prisma.executionLog.create({
          data: {
            runId: run.id,
            nodeId: node.id,
            nodeType: node.data.kind,
            status: 'SUCCESS',
            inputData: jsonStringify(inputSnapshot),
            outputData: jsonStringify(redact(result)),
            startedAt,
            finishedAt: new Date(),
          },
        });
        const outgoing = definition.edges.filter((edge) => edge.source === node.id);
        const selected = node.data.kind === 'condition'
          ? outgoing.find((edge) => edge.sourceHandle === branch)
          : outgoing[0];
        currentId = branch === 'end' ? undefined : selected?.target;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Node execution failed';
        await prisma.executionLog.create({
          data: {
            runId: run.id,
            nodeId: node.id,
            nodeType: node.data.kind,
            status: 'FAILED',
            inputData: jsonStringify(inputSnapshot),
            errorMessage: message,
            startedAt,
            finishedAt: new Date(),
          },
        });
        throw error;
      }
    }
  } catch (error) {
    finalStatus = 'FAILED';
    errorMessage = error instanceof Error ? error.message : 'Workflow execution failed';
  }

  const updatedRun = await prisma.workflowRun.update({
    where: { id: run.id },
    data: {
      status: finalStatus,
      errorMessage,
      outputData: jsonStringify(redact(context)),
      finishedAt: new Date(),
    },
    include: { logs: { orderBy: { startedAt: 'asc' } } },
  });

  return updatedRun;
}
