import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addEdge, Background, Controls, Handle, MiniMap, Position, ReactFlow, useEdgesState, useNodesState,
  type Connection, type Edge, type NodeChange, type EdgeChange, type NodeProps, type ReactFlowInstance,
} from '@xyflow/react';
import { ArrowLeft, Check, Play, Plus, Save, Settings2, Trash2, Upload, X } from 'lucide-react';
import { apiRequest, type Workflow } from './api';
import { initialDefinition, nodeCatalog, type AutomationNode, type FlowNodeData } from './flow-types';

import '@xyflow/react/dist/style.css';

const kindColors: Record<string, string> = {
  'manual-trigger': 'trigger',
  'inquiry-trigger': 'trigger',
  condition: 'condition',
  'create-task': 'action',
  'assign-team': 'action',
  notification: 'action',
  'transform-data': 'action',
  'log-message': 'action',
  delay: 'control',
  end: 'control',
};

function FlowNode({ data, selected }: NodeProps<AutomationNode>) {
  const isTrigger = data.kind.endsWith('-trigger');
  return (
    <div className={`flow-node ${kindColors[data.kind] ?? 'action'} ${selected ? 'selected' : ''}`}>
      {!isTrigger && <Handle type="target" position={Position.Top} />}
      <div className="flow-node-type">{data.kind.replaceAll('-', ' ')}</div>
      <strong>{data.label}</strong>
      {data.kind === 'condition' ? <>
        <div className="condition-labels"><span>True</span><span>False</span></div>
        <Handle id="true" type="source" position={Position.Right} style={{ top: '42%' }} />
        <Handle id="false" type="source" position={Position.Right} style={{ top: '72%' }} />
      </> : data.kind !== 'end' && <Handle type="source" position={Position.Bottom} />}
    </div>
  );
}

const nodeTypes = { automation: FlowNode };

function createNode(kind: string, index: number): AutomationNode {
  const item = nodeCatalog.find((node) => node.kind === kind);
  const defaults: Record<string, Record<string, unknown>> = {
    condition: { field: 'category', operator: 'equals', value: 'sales' },
    'create-task': { title: 'Review inquiry', description: '' },
    'assign-team': { team: 'Sales' },
    notification: { title: 'Workflow update', message: 'A workflow action was completed.' },
    'transform-data': { key: 'normalized', value: '{{category}}' },
    'log-message': { message: 'Workflow step completed' },
    delay: { milliseconds: 500 },
  };
  const label = item?.label ?? kind.replaceAll('-', ' ');
  return {
    id: `${kind}-${crypto.randomUUID().slice(0, 8)}`,
    type: 'automation',
    position: { x: 120 + (index % 3) * 260, y: 120 + Math.floor(index / 3) * 150 },
    data: { kind, label, config: defaults[kind] ?? {} },
  };
}

const configFields: Record<string, Array<{ key: string; label: string; type?: string }>> = {
  condition: [
    { key: 'field', label: 'Field path' },
    { key: 'operator', label: 'Operator', type: 'operator' },
    { key: 'value', label: 'Compare value' },
  ],
  'create-task': [{ key: 'title', label: 'Task title' }, { key: 'description', label: 'Description', type: 'textarea' }],
  'assign-team': [{ key: 'team', label: 'Team name' }],
  notification: [{ key: 'title', label: 'Notification title' }, { key: 'message', label: 'Message', type: 'textarea' }],
  'transform-data': [{ key: 'key', label: 'Output key' }, { key: 'value', label: 'Value (supports {{field}})', type: 'textarea' }],
  'log-message': [{ key: 'message', label: 'Message', type: 'textarea' }],
  delay: [{ key: 'milliseconds', label: 'Delay (0–2000 ms)', type: 'number' }],
};

export function WorkflowBuilder() {
  const { id } = useParams();
  const workflowQuery = useQuery({
    queryKey: ['workflow', id],
    queryFn: () => apiRequest<{ workflow: Workflow }>(`/api/workflows/${id}`),
    enabled: Boolean(id),
  });

  if (workflowQuery.isError) return <div className="builder-error"><Link to="/app/workflows"><ArrowLeft size={16} /> Back to workflows</Link><p>{workflowQuery.error.message}</p></div>;
  if (workflowQuery.isPending && id) return <div className="loading-inline">Loading workflow…</div>;

  return <WorkflowEditor key={id ?? 'new'} savedWorkflow={workflowQuery.data?.workflow} />;
}

function WorkflowEditor({ savedWorkflow }: { savedWorkflow?: Workflow }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [workflowId, setWorkflowId] = useState(savedWorkflow?.id);
  const [name, setName] = useState(savedWorkflow?.name ?? 'Inquiry follow-up');
  const [description, setDescription] = useState(savedWorkflow?.description ?? 'Route new inquiries and notify the right people.');
  const [nodes, setNodes, onNodesChange] = useNodesState<AutomationNode>(savedWorkflow ? savedWorkflow.definitionJson.nodes as AutomationNode[] : initialDefinition.nodes as AutomationNode[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(savedWorkflow ? savedWorkflow.definitionJson.edges as Edge[] : initialDefinition.edges as Edge[]);
  const [selectedId, setSelectedId] = useState<string>();
  const [dirty, setDirty] = useState(!savedWorkflow);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<AutomationNode, Edge> | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string }>();
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const selectedNode = nodes.find((node) => node.id === selectedId);
  const definition = useMemo(() => ({ nodes, edges }), [nodes, edges]);
  const saveMutation = useMutation({
    mutationFn: (payload: { name: string; description: string; definitionJson: typeof definition }) => apiRequest<{ workflow: Workflow }>(
      workflowId ? `/api/workflows/${workflowId}` : '/api/workflows',
      { method: workflowId ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
    ),
    onSuccess: ({ workflow }) => {
      setWorkflowId(workflow.id);
      setDirty(false);
      setNotice({ type: 'success', text: 'Workflow saved.' });
      setValidationErrors([]);
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      if (!savedWorkflow) navigate(`/app/workflows/${workflow.id}/edit`, { replace: true });
    },
    onError: (error) => setNotice({ type: 'error', text: error.message }),
  });
  const validateMutation = useMutation({
    mutationFn: () => apiRequest<{ valid: boolean; errors?: string[] }>(`/api/workflows/${workflowId}/validate`, { method: 'POST' }),
    onSuccess: (result) => {
      setValidationErrors(result.errors ?? []);
      setNotice({ type: result.valid ? 'success' : 'error', text: result.valid ? 'Workflow validation passed.' : 'Fix the validation issues below.' });
    },
    onError: (error) => setNotice({ type: 'error', text: error.message }),
  });
  const runMutation = useMutation({
    mutationFn: (idToRun: string) => apiRequest<{ run: { id: string; status: string; errorMessage?: string } }>(`/api/workflows/${idToRun}/runs`, {
      method: 'POST',
      body: JSON.stringify({ category: 'sales', customer: 'Demo customer', source: 'builder test' }),
    }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      setNotice({
        type: result.run.status === 'SUCCESS' ? 'success' : 'error',
        text: result.run.status === 'SUCCESS' ? `Run completed (${result.run.id.slice(0, 8)}).` : result.run.errorMessage ?? 'Run failed.',
      });
    },
    onError: (error) => setNotice({ type: 'error', text: error.message }),
  });
  const statusMutation = useMutation({
    mutationFn: (active: boolean) => apiRequest(`/api/workflows/${workflowId}/${active ? 'activate' : 'deactivate'}`, { method: 'POST' }),
    onSuccess: (_result, active) => {
      setNotice({ type: 'success', text: active ? 'Workflow activated.' : 'Workflow moved to draft.' });
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
    onError: (error) => setNotice({ type: 'error', text: error.message }),
  });

  const handleNodesChange = useCallback((changes: NodeChange<AutomationNode>[]) => {
    if (changes.length) setDirty(true);
    onNodesChange(changes);
  }, [onNodesChange]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (changes.length) setDirty(true);
    onEdgesChange(changes);
  }, [onEdgesChange]);

  const onConnect = useCallback((connection: Connection) => {
    setDirty(true);
    setEdges((current) => addEdge({ ...connection, id: crypto.randomUUID() }, current));
  }, [setEdges]);

  const addPaletteNode = (kind: string) => {
    const node = createNode(kind, nodes.length);
    setDirty(true);
    setNodes((current) => [...current, node]);
    setSelectedId(node.id);
  };

  const updateSelectedNode = (key: string, value: string) => {
    if (!selectedId) return;
    setDirty(true);
    setNodes((current) => current.map((node) => {
      if (node.id !== selectedId) return node;
      if (key === 'label') return { ...node, data: { ...node.data, label: value } };
      return { ...node, data: { ...node.data, config: { ...node.data.config, [key]: key === 'milliseconds' ? Number(value) : value } } };
    }));
  };

  const save = async () => {
    if (name.trim().length < 2) {
      setNotice({ type: 'error', text: 'Workflow name must contain at least 2 characters.' });
      return;
    }
    return saveMutation.mutateAsync({ name: name.trim(), description, definitionJson: definition });
  };

  const validate = async () => {
    if (!workflowId) {
      const result = await save();
      if (!result) return;
      const response = await apiRequest<{ valid: boolean; errors?: string[] }>(`/api/workflows/${result.workflow.id}/validate`, { method: 'POST' });
      setValidationErrors(response.errors ?? []);
      setNotice({ type: response.valid ? 'success' : 'error', text: response.valid ? 'Workflow validation passed.' : 'Fix the validation issues below.' });
      return;
    }
    validateMutation.mutate();
  };

  const run = async () => {
    if (!workflowId) {
      const result = await save();
      if (!result) return;
      runMutation.mutate(result.workflow.id);
      return;
    }
    runMutation.mutate(workflowId);
  };

  return (
    <div className="builder-page">
      <div className="builder-top">
        <Link className="back-link" to="/app/workflows"><ArrowLeft size={16} /> Workflows</Link>
        <div className="builder-title-fields"><input aria-label="Workflow name" value={name} onChange={(event) => { setDirty(true); setName(event.target.value); }} /><input aria-label="Workflow description" value={description} onChange={(event) => { setDirty(true); setDescription(event.target.value); }} /></div>
        <div className="builder-toolbar">
          <span className="save-state"><span className={`status-dot ${dirty ? 'draft-dot' : 'active-dot'}`} /> {dirty ? 'Unsaved changes' : 'Saved'}</span>
          <button className="secondary-btn" onClick={() => void validate()} disabled={saveMutation.isPending || validateMutation.isPending}><Check size={15} /> Validate</button>
          <button className="secondary-btn" onClick={() => void save()} disabled={saveMutation.isPending}><Save size={15} /> Save</button>
          <button className="secondary-btn" onClick={() => runMutation.isPending ? undefined : void run()} disabled={saveMutation.isPending || runMutation.isPending}><Play size={15} /> {runMutation.isPending ? 'Running…' : 'Test run'}</button>
          <button className="primary-btn" onClick={() => statusMutation.mutate(true)} disabled={!workflowId || statusMutation.isPending}><Upload size={15} /> Publish</button>
        </div>
      </div>
      {notice && <div className={`builder-notice ${notice.type}`} role="status"><span>{notice.text}</span><button aria-label="Dismiss message" onClick={() => setNotice(undefined)}><X size={15} /></button></div>}
      {validationErrors.length > 0 && <div className="validation-errors"><strong>Validation issues</strong><ul>{validationErrors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul></div>}
      <div className="builder-workspace">
        <aside className="node-palette">
          <div className="palette-heading"><strong>Node library</strong><span>Click to add</span></div>
          {['Trigger', 'Logic', 'Action', 'Control'].map((group) => <div className="palette-group" key={group}><div className="palette-label">{group}</div>{nodeCatalog.filter((item) => item.group === group).map((item) => <button key={item.kind} className="palette-node" draggable onDragStart={(event) => { event.dataTransfer.setData('application/autoflow-node', item.kind); event.dataTransfer.effectAllowed = 'move'; }} onClick={() => addPaletteNode(item.kind)}><span className={`palette-dot ${kindColors[item.kind]}`} /><span>{item.label}</span><Plus size={14} /></button>)}</div>)}
          <div className="palette-tip">Connect nodes by dragging from a handle. Condition nodes need both true and false paths.</div>
        </aside>
        <section className="flow-canvas" aria-label="Workflow canvas">
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onInit={setFlowInstance} onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange} onConnect={onConnect} onNodeClick={(_event, node) => setSelectedId(node.id)} onPaneClick={() => setSelectedId(undefined)} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} onDrop={(event) => { event.preventDefault(); const kind = event.dataTransfer.getData('application/autoflow-node'); if (!kind || !flowInstance) return; const node = createNode(kind, nodes.length); node.position = flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY }); setDirty(true); setNodes((current) => [...current, node]); setSelectedId(node.id); }} fitView deleteKeyCode={['Backspace', 'Delete']} snapToGrid snapGrid={[16, 16]}>
            <Background color="#dce3ef" gap={20} />
            <Controls />
            <MiniMap nodeColor={(node) => kindColors[(node.data as FlowNodeData).kind] === 'trigger' ? '#5998e7' : kindColors[(node.data as FlowNodeData).kind] === 'condition' ? '#d9aa36' : '#42a989'} />
          </ReactFlow>
          {nodes.length === 0 && <div className="canvas-empty"><strong>Start building your workflow</strong><span>Add a trigger node from the library.</span></div>}
        </section>
        <aside className="node-inspector">
          {selectedNode ? <>
            <div className="inspector-heading"><div><div className="page-eyebrow">Node settings</div><h2>{selectedNode.data.kind.replaceAll('-', ' ')}</h2></div><button className="icon-btn danger-text" title="Delete node" onClick={() => { setDirty(true); setNodes((current) => current.filter((node) => node.id !== selectedId)); setEdges((current) => current.filter((edge) => edge.source !== selectedId && edge.target !== selectedId)); setSelectedId(undefined); }}><Trash2 size={16} /></button></div>
            <label className="field-label">Node label<input value={selectedNode.data.label} onChange={(event) => updateSelectedNode('label', event.target.value)} /></label>
            {(configFields[selectedNode.data.kind] ?? []).map((field) => <label className="field-label" key={field.key}>{field.label}{field.type === 'textarea' ? <textarea rows={3} value={String(selectedNode.data.config[field.key] ?? '')} onChange={(event) => updateSelectedNode(field.key, event.target.value)} /> : field.type === 'operator' ? <select value={String(selectedNode.data.config[field.key] ?? 'equals')} onChange={(event) => updateSelectedNode(field.key, event.target.value)}><option value="equals">Equals</option><option value="not-equals">Does not equal</option><option value="contains">Contains</option><option value="greater-than">Greater than</option><option value="less-than">Less than</option><option value="is-empty">Is empty</option><option value="is-not-empty">Is not empty</option></select> : <input type={field.type === 'number' ? 'number' : 'text'} min={field.type === 'number' ? 0 : undefined} max={field.type === 'number' ? 2000 : undefined} value={String(selectedNode.data.config[field.key] ?? '')} onChange={(event) => updateSelectedNode(field.key, event.target.value)} />}</label>)}
            {selectedNode.data.kind.endsWith('-trigger') && <p className="inspector-help">This node starts the flow. Test runs provide sample inquiry data to downstream steps.</p>}
            <div className="inspector-footer"><span>Node ID</span><code>{selectedNode.id}</code></div>
          </> : <>
            <div className="inspector-empty"><div className="empty-icon"><Settings2 size={19} /></div><h3>Workflow settings</h3><p>Select a node to edit its label and configuration. Drag nodes to arrange your flow.</p></div>
            <div className="builder-help-card"><strong>Quick start</strong><p>Connect a trigger to one or more actions. Use the test run button to create actual tasks and notifications.</p><button className="text-action" onClick={() => addPaletteNode('create-task')}><Plus size={14} /> Add task action</button></div>
          </>}
        </aside>
      </div>
      {saveMutation.error && <div className="inline-error builder-bottom-error">{saveMutation.error.message}</div>}
    </div>
  );
}
