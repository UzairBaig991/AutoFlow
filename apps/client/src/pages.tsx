import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Archive, ArrowDownRight, ArrowUpRight, Check, Clock3, Copy, Play, Plus, RotateCcw, Search, Settings2, Workflow as WorkflowIcon, X } from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts';
import { apiRequest, type User, type Workflow, type WorkflowRun } from './api';

type Overview = {
  totalWorkflows: number;
  activeWorkflows: number;
  workflowsExecuted: number;
  successfulExecutions: number;
  failedExecutions: number;
};

type OverviewResponse = {
  overview: Overview;
  recentRuns: WorkflowRun[];
  workflows: Workflow[];
};

type ExecutionAnalytics = {
  series: Array<{ date: string; success: number; failed: number; total: number }>;
  mostExecuted: Array<{ workflowId: string; name: string; runs: number; failed: number }>;
  totalRuns: number;
  successRate: number;
  averageDurationMs: number;
};

function PageHeading({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <div className="page-eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</div>;
}

function ErrorState({ message }: { message: string }) {
  return <div className="error-state" role="alert"><div className="error-icon"><X size={18} /></div><div><strong>Couldn’t load this data</strong><p>{message}</p></div></div>;
}

function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><WorkflowIcon size={22} /></div><h3>{title}</h3><p>{message}</p>{action}</div>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function StatusBadge({ status }: { status: string }) {
  const tone = status.toLowerCase();
  return <span className={`status-badge ${tone}`}>{status.toLowerCase()}</span>;
}

export function DashboardPage() {
  const overviewQuery = useQuery({
    queryKey: ['overview'],
    queryFn: () => apiRequest<OverviewResponse>('/api/analytics/overview'),
  });
  const chartQuery = useQuery({
    queryKey: ['execution-analytics', 7],
    queryFn: () => apiRequest<{ analytics: ExecutionAnalytics }>('/api/analytics/executions?days=7'),
  });
  const overview = overviewQuery.data?.overview;
  const metrics = [
    { label: 'Total workflows', value: overview?.totalWorkflows ?? 0, icon: WorkflowIcon, tone: 'violet', note: `${overview?.activeWorkflows ?? 0} active` },
    { label: 'Workflow runs', value: overview?.workflowsExecuted ?? 0, icon: Activity, tone: 'blue', note: 'All time' },
    { label: 'Successful runs', value: overview?.successfulExecutions ?? 0, icon: Check, tone: 'green', note: `${overview?.workflowsExecuted ? Math.round((overview.successfulExecutions / overview.workflowsExecuted) * 100) : 0}% success rate` },
    { label: 'Failed runs', value: overview?.failedExecutions ?? 0, icon: ArrowDownRight, tone: 'rose', note: 'Needs attention' },
  ];

  if (overviewQuery.isError) return <><PageHeading eyebrow="Workspace" title="Overview" description="Your workflow activity at a glance." /><ErrorState message={overviewQuery.error.message} /></>;

  return (
    <>
      <PageHeading eyebrow="Workspace" title="Overview" description="Your workflow activity at a glance." actions={<Link to="/app/workflows/new" className="primary-btn"><Plus size={16} /> Create workflow</Link>} />
      {overviewQuery.isPending ? <div className="metric-grid">{metrics.map((metric) => <div className="metric-card skeleton" key={metric.label} />)}</div> : <div className="metric-grid">{metrics.map(({ label, value, icon: Icon, tone, note }) => <article className="metric-card" key={label}><div className={`metric-icon ${tone}`}><Icon size={18} /></div><div className="metric-label">{label}</div><div className="metric-value">{value.toLocaleString()}</div><div className="metric-note">{note}</div></article>)}</div>}
      <div className="dashboard-grid">
        <section className="panel chart-panel">
          <div className="panel-heading"><div><h2>Execution activity</h2><p>Success and failures over the last 7 days</p></div><Link to="/app/analytics">View analytics</Link></div>
          {chartQuery.isError ? <ErrorState message={chartQuery.error.message} /> : <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartQuery.data?.analytics.series ?? []} margin={{ top: 10, right: 12, bottom: 0, left: -18 }}><CartesianGrid stroke="#e9edf4" strokeDasharray="3 4" vertical={false} /><XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} tickLine={false} axisLine={false} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} /><Tooltip /><Line type="monotone" dataKey="success" stroke="#6755d9" strokeWidth={2.5} dot={false} /><Line type="monotone" dataKey="failed" stroke="#ed7182" strokeWidth={2.5} dot={false} /></LineChart></ResponsiveContainer></div>}
        </section>
        <section className="panel status-panel">
          <div className="panel-heading"><div><h2>Workflow status</h2><p>Current workspace distribution</p></div></div>
          <div className="status-summary"><div className="status-count"><span className="status-dot active-dot" /><span>Active</span><strong>{overview?.activeWorkflows ?? 0}</strong></div><div className="status-count"><span className="status-dot draft-dot" /><span>Draft</span><strong>{Math.max(0, (overview?.totalWorkflows ?? 0) - (overview?.activeWorkflows ?? 0))}</strong></div></div>
          <div className="status-bar"><span style={{ width: `${overview?.totalWorkflows ? (overview.activeWorkflows / overview.totalWorkflows) * 100 : 0}%` }} /></div>
          <div className="status-footnote">{overview?.totalWorkflows ? `${Math.round((overview.activeWorkflows / overview.totalWorkflows) * 100)}% of workflows are active` : 'Create a workflow to start automating.'}</div>
        </section>
      </div>
      <div className="dashboard-grid lower-grid">
        <section className="panel">
          <div className="panel-heading"><div><h2>Recent executions</h2><p>Latest workflow runs</p></div><Link to="/app/runs">View history</Link></div>
          {overviewQuery.isPending ? <div className="loading-inline">Loading runs…</div> : overviewQuery.data?.recentRuns.length ? <div className="compact-list">{overviewQuery.data.recentRuns.map((run) => <Link className="compact-row" to="/app/runs" key={run.id}><span className={`run-icon ${run.status.toLowerCase()}`}><Activity size={15} /></span><span className="row-main"><strong>{run.workflow.name}</strong><small>{formatDate(run.startedAt)}</small></span><StatusBadge status={run.status} /></Link>)}</div> : <EmptyState title="No executions yet" message="Run a workflow to see its results here." /> }
        </section>
        <section className="panel">
          <div className="panel-heading"><div><h2>Your workflows</h2><p>Recently updated</p></div><Link to="/app/workflows">View all</Link></div>
          {overviewQuery.isPending ? <div className="loading-inline">Loading workflows…</div> : overviewQuery.data?.workflows.length ? <div className="compact-list">{overviewQuery.data.workflows.slice(0, 4).map((workflow) => <Link className="compact-row" to={`/app/workflows/${workflow.id}/edit`} key={workflow.id}><span className="run-icon draft"><WorkflowIcon size={15} /></span><span className="row-main"><strong>{workflow.name}</strong><small>{workflow.runCount ?? 0} runs · updated {formatDate(workflow.updatedAt)}</small></span><StatusBadge status={workflow.status} /></Link>)}</div> : <EmptyState title="Your workspace is ready" message="Create a workflow to get started." action={<Link className="secondary-btn" to="/app/workflows/new">Create workflow</Link>} />}
        </section>
      </div>
    </>
  );
}

export function WorkflowsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const query = useQuery({
    queryKey: ['workflows'],
    queryFn: () => apiRequest<{ workflows: Workflow[] }>('/api/workflows'),
  });
  const action = useMutation({
    mutationFn: async ({ id, kind }: { id: string; kind: 'delete' | 'activate' | 'deactivate' | 'duplicate' | 'archive' | 'restore' }) => {
      if (kind === 'duplicate') {
        const workflow = query.data?.workflows.find((item) => item.id === id);
        if (!workflow) throw new Error('Workflow not found');
        return apiRequest('/api/workflows', { method: 'POST', body: JSON.stringify({ ...workflow, name: `${workflow.name} copy`, status: 'DRAFT' }) });
      }
      if (kind === 'archive' || kind === 'restore') {
        return apiRequest(`/api/workflows/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: kind === 'archive' ? 'ARCHIVED' : 'DRAFT' }),
        });
      }
      return apiRequest(`/api/workflows/${id}${kind === 'delete' ? '' : `/${kind}`}`, { method: kind === 'delete' ? 'DELETE' : 'POST' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    },
  });
  const filtered = useMemo(() => (query.data?.workflows ?? []).filter((workflow) => {
    const matchesText = `${workflow.name} ${workflow.description}`.toLowerCase().includes(search.toLowerCase());
    return matchesText && (status === 'ALL' || workflow.status === status);
  }), [query.data?.workflows, search, status]);

  return (
    <>
      <PageHeading eyebrow="Automation" title="Workflows" description="Design, run, and manage your business automations." actions={<Link to="/app/workflows/new" className="primary-btn"><Plus size={16} /> New workflow</Link>} />
      <section className="panel workflow-list-panel">
        <div className="list-toolbar"><label className="search-field"><Search size={16} /><input placeholder="Search workflows" value={search} onChange={(event) => setSearch(event.target.value)} /></label><select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter workflow status"><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="DRAFT">Draft</option><option value="ARCHIVED">Archived</option></select></div>
        {query.isError ? <ErrorState message={query.error.message} /> : query.isPending ? <div className="loading-inline">Loading workflows…</div> : filtered.length ? <div className="workflow-table-wrap"><table className="data-table"><thead><tr><th>Workflow</th><th>Status</th><th>Runs</th><th>Last updated</th><th>Actions</th></tr></thead><tbody>{filtered.map((workflow) => <tr key={workflow.id}><td><Link className="workflow-name-cell" to={`/app/workflows/${workflow.id}/edit`}><span className="run-icon draft"><WorkflowIcon size={16} /></span><span><strong>{workflow.name}</strong><small>{workflow.description || 'No description'}</small></span></Link></td><td><StatusBadge status={workflow.status} /></td><td>{workflow.runCount ?? 0}</td><td>{formatDate(workflow.updatedAt)}</td><td><div className="table-actions">{workflow.status === 'ARCHIVED' ? <button className="text-action" onClick={() => action.mutate({ id: workflow.id, kind: 'restore' })}>Restore</button> : workflow.status === 'ACTIVE' ? <button className="text-action" onClick={() => action.mutate({ id: workflow.id, kind: 'deactivate' })}>Pause</button> : <button className="text-action" onClick={() => action.mutate({ id: workflow.id, kind: 'activate' })}>Activate</button>}{workflow.status !== 'ARCHIVED' ? <button className="icon-btn small" title="Archive workflow" aria-label="Archive workflow" onClick={() => action.mutate({ id: workflow.id, kind: 'archive' })}><Archive size={15} /></button> : <button className="icon-btn small" title="Restore workflow" aria-label="Restore workflow" onClick={() => action.mutate({ id: workflow.id, kind: 'restore' })}><RotateCcw size={15} /></button>}<button className="icon-btn small" title="Duplicate workflow" onClick={() => action.mutate({ id: workflow.id, kind: 'duplicate' })}><Copy size={15} /></button><button className="icon-btn small danger-text" title="Delete workflow" onClick={() => window.confirm(`Delete “${workflow.name}”? This also removes its run history.`) && action.mutate({ id: workflow.id, kind: 'delete' })}><X size={15} /></button></div></td></tr>)}</tbody></table></div> : <EmptyState title={search || status !== 'ALL' ? 'No matching workflows' : 'No workflows yet'} message={search || status !== 'ALL' ? 'Try adjusting your search or status filter.' : 'Build your first visual automation.'} action={<Link to="/app/workflows/new" className="primary-btn"><Plus size={16} /> Create workflow</Link>} />}
        {action.error && <div className="inline-error">{action.error.message}</div>}
      </section>
    </>
  );
}

export function RunHistoryPage() {
  const [selectedId, setSelectedId] = useState<string>();
  const runsQuery = useQuery({
    queryKey: ['runs'],
    queryFn: () => apiRequest<{ runs: WorkflowRun[] }>('/api/runs'),
  });
  const detailQuery = useQuery({
    queryKey: ['run', selectedId],
    queryFn: () => apiRequest<{ run: WorkflowRun }>(`/api/runs/${selectedId}`),
    enabled: Boolean(selectedId),
  });
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/runs/${id}/retry`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['overview'] });
    },
  });
  const selected = detailQuery.data?.run;

  return (
    <>
      <PageHeading eyebrow="Monitoring" title="Execution history" description="Review workflow results and inspect node-by-node logs." />
      <div className="run-layout">
        <section className="panel run-list-panel">
          <div className="panel-heading"><div><h2>Recent runs</h2><p>Latest 100 executions</p></div></div>
          {runsQuery.isError ? <ErrorState message={runsQuery.error.message} /> : runsQuery.isPending ? <div className="loading-inline">Loading execution history…</div> : runsQuery.data?.runs.length ? <div className="compact-list">{runsQuery.data.runs.map((run) => <button className={`compact-row run-select ${selectedId === run.id ? 'selected' : ''}`} key={run.id} onClick={() => setSelectedId(run.id)}><span className={`run-icon ${run.status.toLowerCase()}`}><Activity size={15} /></span><span className="row-main"><strong>{run.workflow.name}</strong><small>{formatDate(run.startedAt)}</small></span><StatusBadge status={run.status} /></button>)}</div> : <EmptyState title="No runs to show" message="Run one of your workflows to see execution details." /> }
        </section>
        <section className="panel run-detail-panel">
          {!selectedId ? <EmptyState title="Select an execution" message="Choose a run from the list to inspect its results and logs." /> : detailQuery.isPending ? <div className="loading-inline">Loading run details…</div> : detailQuery.isError ? <ErrorState message={detailQuery.error.message} /> : selected ? <>
            <div className="panel-heading"><div><div className="detail-eyebrow">Run details</div><h2>{selected.workflow.name}</h2><p>Started {formatDate(selected.startedAt)}</p></div><StatusBadge status={selected.status} /></div>
            <div className="run-detail-meta"><div><span>Trigger</span><strong>{selected.triggerType}</strong></div><div><span>Duration</span><strong>{selected.finishedAt ? `${((new Date(selected.finishedAt).getTime() - new Date(selected.startedAt).getTime()) / 1000).toFixed(2)}s` : '—'}</strong></div></div>
            {selected.errorMessage && <div className="inline-error">{selected.errorMessage}</div>}
            <h3 className="section-title">Node execution log</h3>
            <div className="node-log-list">{(selected.logs ?? []).map((log, index) => <article className="node-log" key={log.id}><div className="log-step">{index + 1}</div><div className="log-content"><div className="log-title"><strong>{log.nodeType.replaceAll('-', ' ')}</strong><StatusBadge status={log.status} /></div><small>{formatDate(log.startedAt)}</small>{log.errorMessage && <p className="log-error">{log.errorMessage}</p>}{log.outputData && <pre>{log.outputData}</pre>}</div></article>)}</div>
            {selected.status === 'FAILED' && <button className="secondary-btn retry-button" onClick={() => retry.mutate(selected.id)} disabled={retry.isPending}><Play size={15} /> {retry.isPending ? 'Retrying…' : 'Retry run'}</button>}
          </> : null}
          {retry.error && <div className="inline-error">{retry.error.message}</div>}
        </section>
      </div>
    </>
  );
}

export function AnalyticsPage() {
  const [days, setDays] = useState(7);
  const query = useQuery({
    queryKey: ['execution-analytics', days],
    queryFn: () => apiRequest<{ analytics: ExecutionAnalytics }>(`/api/analytics/executions?days=${days}`),
  });
  const data = query.data?.analytics;
  const breakdown = useMemo(() => data ? [
    { name: 'Success', value: data.series.reduce((sum, item) => sum + item.success, 0), color: '#34b88a' },
    { name: 'Failed', value: data.series.reduce((sum, item) => sum + item.failed, 0), color: '#ee7082' },
  ] : [], [data]);

  return (
    <>
      <PageHeading eyebrow="Insights" title="Analytics" description="Understand workflow volume, reliability, and execution performance." actions={<select className="range-select" value={days} onChange={(event) => setDays(Number(event.target.value))} aria-label="Date range"><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select>} />
      {query.isError ? <ErrorState message={query.error.message} /> : <>
        <div className="metric-grid analytics-metrics">
          <article className="metric-card"><div className="metric-icon blue"><Activity size={18} /></div><div className="metric-label">Total runs</div><div className="metric-value">{data?.totalRuns ?? 0}</div><div className="metric-note">Selected date range</div></article>
          <article className="metric-card"><div className="metric-icon green"><ArrowUpRight size={18} /></div><div className="metric-label">Success rate</div><div className="metric-value">{data?.successRate ?? 0}%</div><div className="metric-note">Completed successfully</div></article>
          <article className="metric-card"><div className="metric-icon violet"><Clock3 size={18} /></div><div className="metric-label">Average duration</div><div className="metric-value">{((data?.averageDurationMs ?? 0) / 1000).toFixed(2)}s</div><div className="metric-note">For finished runs</div></article>
        </div>
        <div className="dashboard-grid analytics-grid">
          <section className="panel chart-panel"><div className="panel-heading"><div><h2>Execution volume</h2><p>Daily successful and failed runs</p></div></div><div className="chart-wrap tall-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={data?.series ?? []} margin={{ top: 10, right: 12, bottom: 0, left: -18 }}><CartesianGrid stroke="#e9edf4" strokeDasharray="3 4" vertical={false} /><XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} tickLine={false} axisLine={false} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} /><Tooltip /><Bar dataKey="success" fill="#6d5bdd" radius={[4, 4, 0, 0]} /><Bar dataKey="failed" fill="#ed7182" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></section>
          <section className="panel chart-panel"><div className="panel-heading"><div><h2>Run outcomes</h2><p>Execution status breakdown</p></div></div><div className="donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={breakdown} dataKey="value" nameKey="name" innerRadius={66} outerRadius={94} paddingAngle={4}>{breakdown.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer><div className="donut-center"><strong>{data?.totalRuns ?? 0}</strong><span>runs</span></div></div><div className="chart-legend"><span><i className="legend-success" />Successful</span><span><i className="legend-failed" />Failed</span></div></section>
        </div>
        <section className="panel analytics-table-panel"><div className="panel-heading"><div><h2>Most executed workflows</h2><p>By run volume in this date range</p></div></div>{data?.mostExecuted.length ? <div className="workflow-table-wrap"><table className="data-table"><thead><tr><th>Workflow</th><th>Runs</th><th>Failed</th><th>Reliability</th></tr></thead><tbody>{data.mostExecuted.map((item) => <tr key={item.workflowId}><td><strong>{item.name}</strong></td><td>{item.runs}</td><td>{item.failed}</td><td>{item.runs ? `${Math.round(((item.runs - item.failed) / item.runs) * 100)}%` : '—'}</td></tr>)}</tbody></table></div> : <EmptyState title="No run data yet" message="Analytics will appear after you execute workflows." />}</section>
      </>}
    </>
  );
}

type Task = { id: string; title: string; description: string; assignedTeam?: string | null; status: string; createdAt: string };
type Notification = { id: string; title: string; message: string; isRead: boolean; createdAt: string };
type AdminSummary = { workspaces: number; members: number; workflows: number; runs: number; tasks: number; failedRuns: number };

export function AdminPage() {
  const queryClient = useQueryClient();
  const currentUser = queryClient.getQueryData<User>(['me']);
  const [invitationEmail, setInvitationEmail] = useState('');
  const [copyError, setCopyError] = useState('');
  const tasksQuery = useQuery({ queryKey: ['tasks'], queryFn: () => apiRequest<{ tasks: Task[] }>('/api/tasks') });
  const notificationsQuery = useQuery({ queryKey: ['notifications'], queryFn: () => apiRequest<{ notifications: Notification[] }>('/api/notifications') });
  const summaryQuery = useQuery({ queryKey: ['admin-summary'], queryFn: () => apiRequest<{ summary: AdminSummary }>('/api/admin/summary') });
  const createInvitation = useMutation({
    mutationFn: () => apiRequest<{ invitation: { email: string; expiresAt: string; url: string } }>('/api/auth/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: invitationEmail }),
    }),
  });
  const updateTask = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiRequest(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
  });
  const readNotification = useMutation({
    mutationFn: (id: string) => apiRequest(`/api/notifications/${id}/read`, { method: 'PATCH' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <>
      <PageHeading eyebrow="Workspace tools" title="Tasks & administration" description="Manage generated work, notifications, and workspace health." />
      {summaryQuery.data && <div className="metric-grid admin-metrics">{Object.entries(summaryQuery.data.summary).map(([label, value]) => <article className="metric-card compact-metric" key={label}><div className="metric-label">{label.replace(/([A-Z])/g, ' $1')}</div><div className="metric-value">{value}</div></article>)}</div>}
      {summaryQuery.isError && <div className="info-banner"><Settings2 size={17} /> Workspace metrics are restricted to workspace administrators. Your tasks and notifications remain available below.</div>}
      {currentUser?.role === 'OWNER' && <section className="panel invite-panel">
        <div className="panel-heading"><div><h2>Invite a teammate</h2><p>Share a secure, single-use link that expires in seven days.</p></div></div>
        <form className="invite-form" onSubmit={(event) => { event.preventDefault(); createInvitation.mutate(); setCopyError(''); }}>
          <label className="field-label">Teammate email<input type="email" required maxLength={254} value={invitationEmail} onChange={(event) => setInvitationEmail(event.target.value)} /></label>
          <button className="primary-btn" type="submit" disabled={createInvitation.isPending}>{createInvitation.isPending ? 'Creating…' : 'Create invite link'}</button>
        </form>
        {createInvitation.error && <div className="inline-error invite-feedback" role="alert">{createInvitation.error.message}</div>}
        {createInvitation.data && <div className="invite-result">
          <div className="invite-link">{createInvitation.data.invitation.url}</div>
          <button className="secondary-btn" type="button" onClick={async () => {
            try {
              await navigator.clipboard.writeText(createInvitation.data.invitation.url);
              setCopyError('');
            } catch {
              setCopyError('Clipboard access failed. Copy the invitation link above.');
            }
          }}><Copy size={14} /> Copy link</button>
          <small>Expires {formatDate(createInvitation.data.invitation.expiresAt)} · Only the invited email can use it.</small>
          {copyError && <div className="inline-error" role="alert">{copyError}</div>}
        </div>}
      </section>}
      <div className="dashboard-grid admin-grid">
        <section className="panel"><div className="panel-heading"><div><h2>Workflow tasks</h2><p>Tasks generated by your automations</p></div></div>{tasksQuery.isError ? <ErrorState message={tasksQuery.error.message} /> : tasksQuery.isPending ? <div className="loading-inline">Loading tasks…</div> : tasksQuery.data?.tasks.length ? <div className="task-list">{tasksQuery.data.tasks.map((task) => <article className="task-row" key={task.id}><span className={`task-check ${task.status === 'COMPLETED' ? 'checked' : ''}`}>{task.status === 'COMPLETED' && <Check size={13} />}</span><div className="row-main"><strong>{task.title}</strong><small>{task.description || 'No description'}{task.assignedTeam ? ` · Team: ${task.assignedTeam}` : ''} · {formatDate(task.createdAt)}</small></div><select aria-label={`Update status for ${task.title}`} value={task.status} onChange={(event) => updateTask.mutate({ id: task.id, status: event.target.value })}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option></select></article>)}</div> : <EmptyState title="No tasks yet" message="Tasks created by workflow actions will appear here." />}</section>
        <section className="panel" id="notifications"><div className="panel-heading"><div><h2>Notifications</h2><p>Recent workflow updates</p></div></div>{notificationsQuery.isError ? <ErrorState message={notificationsQuery.error.message} /> : notificationsQuery.isPending ? <div className="loading-inline">Loading notifications…</div> : notificationsQuery.data?.notifications.length ? <div className="notification-list">{notificationsQuery.data.notifications.map((notification) => <article className={`notification-row ${notification.isRead ? 'read' : ''}`} key={notification.id}><span className="notification-mark"><Activity size={15} /></span><div className="row-main"><strong>{notification.title}</strong><p>{notification.message}</p><small>{formatDate(notification.createdAt)}</small></div>{!notification.isRead && <button className="text-action" onClick={() => readNotification.mutate(notification.id)}>Mark read</button>}</article>)}</div> : <EmptyState title="No notifications" message="Workflow notifications will be listed here." />}</section>
      </div>
      {(updateTask.error || readNotification.error) && <div className="inline-error">{updateTask.error?.message ?? readNotification.error?.message}</div>}
    </>
  );
}
