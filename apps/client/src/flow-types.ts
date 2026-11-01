import type { Node } from '@xyflow/react';

export type FlowNodeData = {
  kind: string;
  label: string;
  config: Record<string, unknown>;
};

export type AutomationNode = Node<FlowNodeData, 'automation'>;

export const initialDefinition = {
  nodes: [
    {
      id: 'trigger-1',
      type: 'automation',
      position: { x: 80, y: 120 },
      data: { kind: 'manual-trigger', label: 'Manual trigger', config: {} },
    },
    {
      id: 'task-1',
      type: 'automation',
      position: { x: 380, y: 120 },
      data: { kind: 'create-task', label: 'Create task', config: { title: 'Follow up with inquiry', description: 'Review the submitted inquiry.' } },
    },
    {
      id: 'notify-1',
      type: 'automation',
      position: { x: 680, y: 120 },
      data: { kind: 'notification', label: 'Notify owner', config: { title: 'New workflow task', message: 'A new inquiry task is ready.' } },
    },
  ],
  edges: [
    { id: 'e-trigger-task', source: 'trigger-1', target: 'task-1' },
    { id: 'e-task-notify', source: 'task-1', target: 'notify-1' },
  ],
};

export const nodeCatalog = [
  { kind: 'manual-trigger', label: 'Manual trigger', group: 'Trigger' },
  { kind: 'inquiry-trigger', label: 'New inquiry', group: 'Trigger' },
  { kind: 'condition', label: 'Condition', group: 'Logic' },
  { kind: 'create-task', label: 'Create task', group: 'Action' },
  { kind: 'assign-team', label: 'Assign team', group: 'Action' },
  { kind: 'notification', label: 'Notification', group: 'Action' },
  { kind: 'transform-data', label: 'Transform data', group: 'Action' },
  { kind: 'log-message', label: 'Log message', group: 'Action' },
  { kind: 'delay', label: 'Delay', group: 'Control' },
  { kind: 'end', label: 'End workflow', group: 'Control' },
];
