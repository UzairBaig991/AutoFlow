export type User = {
  id: string;
  name: string;
  email: string;
  role: string;
};

export type Workflow = {
  id: string;
  name: string;
  description: string;
  status: string;
  definitionJson: WorkflowDefinition;
  updatedAt: string;
  createdAt: string;
  runCount?: number;
};

export type WorkflowDefinition = {
  nodes: Array<{
    id: string;
    type?: string | null;
    position?: { x: number; y: number };
    data: { kind: string; label?: string; config?: Record<string, unknown> };
  }>;
  edges: Array<{ id?: string; source: string; target: string; sourceHandle?: string | null }>;
};

export type WorkflowRun = {
  id: string;
  status: string;
  triggerType: string;
  startedAt: string;
  finishedAt?: string | null;
  errorMessage?: string | null;
  inputData?: string | null;
  outputData?: string | null;
  workflow: { id: string; name: string };
  logs?: Array<{
    id: string;
    nodeId: string;
    nodeType: string;
    status: string;
    inputData?: string | null;
    outputData?: string | null;
    errorMessage?: string | null;
    startedAt: string;
    finishedAt?: string | null;
  }>;
};

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...init, headers, credentials: 'include' });
  const payload = await response.json().catch(() => ({})) as { message?: string } & T;
  if (!response.ok) throw new Error(payload.message ?? `Request failed (${response.status})`);
  return payload;
}

export async function getCurrentUser() {
  const response = await apiRequest<{ user: User }>('/api/auth/me');
  return response.user;
}
