import { lazy, Suspense, useState } from 'react';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, BarChart3, Bell, ChevronDown, CircleHelp, LayoutDashboard, LogOut, Menu, Moon, Plus, Settings2, Sun, Workflow as WorkflowIcon } from 'lucide-react';
import { apiRequest, getCurrentUser, type User } from './api';
import './App.css';

const DashboardPage = lazy(() => import('./pages').then((module) => ({ default: module.DashboardPage })));
const WorkflowsPage = lazy(() => import('./pages').then((module) => ({ default: module.WorkflowsPage })));
const RunHistoryPage = lazy(() => import('./pages').then((module) => ({ default: module.RunHistoryPage })));
const AnalyticsPage = lazy(() => import('./pages').then((module) => ({ default: module.AnalyticsPage })));
const AdminPage = lazy(() => import('./pages').then((module) => ({ default: module.AdminPage })));
const WorkflowBuilder = lazy(() => import('./workflow-builder').then((module) => ({ default: module.WorkflowBuilder })));

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

function Brand() {
  return (
    <Link to="/" className="brand-row">
      <div className="brand-mark">A</div>
      <div>
        <div className="brand-name">AutoFlow</div>
        <div className="brand-tag">Workflows, in motion</div>
      </div>
    </Link>
  );
}

function LandingPage() {
  return (
    <div className="landing-shell">
      <header className="landing-header">
        <Brand />
        <nav className="landing-nav">
          <a href="#features">Features</a>
          <a href="#use-cases">Use cases</a>
        </nav>
        <div className="actions">
          <Link className="secondary-btn" to="/login">Log in</Link>
          <Link className="primary-btn" to="/register">Get started <Plus size={15} /></Link>
        </div>
      </header>
      <main>
        <section className="hero-section">
          <div className="hero-copy">
            <span className="eyebrow">Visual business automation</span>
            <h1>Automate the work behind the work.</h1>
            <p>Design no-code workflows, route inquiries to the right team, create tasks, and see every execution clearly.</p>
            <div className="cta-row">
              <Link className="primary-btn" to="/register">Build your first workflow <Plus size={16} /></Link>
              <a className="secondary-btn" href="#features">Explore the platform</a>
            </div>
            <div className="hero-stats">
              <div><strong>Visual</strong><span>no-code workflow design</span></div>
              <div><strong>Traceable</strong><span>step-by-step execution logs</span></div>
              <div><strong>Flexible</strong><span>built-in business actions</span></div>
            </div>
          </div>
          <div className="demo-card">
            <div className="card-header"><span className="dot green" /><span className="dot amber" /><span className="dot red" /><span className="demo-label">Inquiry routing</span></div>
            <div className="demo-flow">
              <div className="demo-node trigger">New inquiry</div>
              <div className="demo-line" />
              <div className="demo-node condition">Category = sales?</div>
              <div className="demo-branches"><div className="demo-node action">Assign sales team</div><div className="demo-node action">Create support task</div></div>
              <div className="demo-node notification">Notify owner</div>
              <div className="demo-run"><span className="status-dot" /> Workflow ready to run</div>
            </div>
          </div>
        </section>
        <section className="feature-grid" id="features">
          <article className="feature-card"><span className="feature-pill">Visual builder</span><h3>Drag, connect, and publish</h3><p>Build and validate business logic with a visual node-based editor.</p></article>
          <article className="feature-card"><span className="feature-pill accent">Execution logs</span><h3>Know what happened</h3><p>Inspect every workflow run, node result, and failure reason.</p></article>
          <article className="feature-card"><span className="feature-pill muted">Business actions</span><h3>Move work forward</h3><p>Create tasks and notifications with persistent, database-backed records.</p></article>
        </section>
        <section className="use-cases" id="use-cases">
          <h2>Built for everyday operations</h2>
          <div className="use-case-grid">
            <article className="case-card"><h4>Lead routing</h4><p>Send sales leads to the right team instantly.</p></article>
            <article className="case-card"><h4>Support triage</h4><p>Classify requests and create support tasks automatically.</p></article>
            <article className="case-card"><h4>Team follow-up</h4><p>Assign work, notify owners, and track completion.</p></article>
          </div>
        </section>
      </main>
      <footer className="landing-footer"><Brand /><span>AutoFlow — university software engineering project</span></footer>
    </div>
  );
}

function AuthPage({ mode, inviteToken }: { mode: 'login' | 'register'; inviteToken?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const providersQuery = useQuery({
    queryKey: ['auth-providers'],
    queryFn: () => apiRequest<{ providers: { google: boolean; github: boolean } }>('/api/auth/providers'),
  });
  const oauthError = searchParams.get('error');
  const authErrorMessage = oauthError === 'oauth_cancelled'
    ? 'Sign-in was cancelled.'
    : oauthError === 'oauth_state'
      ? 'The sign-in request expired. Please try again.'
      : oauthError === 'invitation_invalid'
        ? 'This invitation is no longer valid. Ask the workspace owner for a new link.'
        : oauthError
          ? 'Social sign-in could not be completed. Please try again.'
          : null;
  const mutation = useMutation({
    mutationFn: () => apiRequest<{ user: User }>(`/api/auth/${mode}`, {
      method: 'POST',
      body: JSON.stringify(mode === 'register'
        ? { name, email, password, ...(inviteToken ? { inviteToken } : {}) }
        : { email, password }),
    }),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(['me'], user);
      navigate('/app');
    },
  });

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Brand />
        <span className="eyebrow">{inviteToken ? 'Workspace invitation' : mode === 'login' ? 'Welcome back' : 'Get started'}</span>
        <h1>{inviteToken ? 'Join your workspace' : mode === 'login' ? 'Sign in to AutoFlow' : 'Create your account'}</h1>
        <p className="muted-copy">{inviteToken ? 'Create an account with the invited email address to join this team.' : mode === 'login' ? 'Continue to your workspace and workflows.' : 'Your workspace will be created automatically.'}</p>
        {authErrorMessage && <div className="inline-error" role="alert">{authErrorMessage}</div>}
        {providersQuery.data && (providersQuery.data.providers.google || providersQuery.data.providers.github) && (
          <div className="oauth-options">
            {providersQuery.data.providers.google && <a className="oauth-btn" href={`/api/auth/oauth/google${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ''}`}>Continue with Google</a>}
            {providersQuery.data.providers.github && <a className="oauth-btn" href={`/api/auth/oauth/github${inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : ''}`}>Continue with GitHub</a>}
            <div className="auth-divider"><span>or use email</span></div>
          </div>
        )}
        <form onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }} className="auth-form">
          {mode === 'register' && <label>Your name<input autoComplete="name" required minLength={2} value={name} onChange={(event) => setName(event.target.value)} /></label>}
          <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Password<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'login' ? 1 : 12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} />{mode === 'register' && <small className="field-hint">Use at least 12 characters. A longer passphrase is recommended.</small>}</label>
          {mutation.error && <div className="inline-error" role="alert">{mutation.error.message}</div>}
          <button className="primary-btn full-width" type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Please wait…' : inviteToken ? 'Join workspace' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        </form>
        <p className="auth-switch">{mode === 'login' ? 'New to AutoFlow?' : 'Already have an account?'} <Link to={mode === 'login' ? (inviteToken ? `/invite/${inviteToken}` : '/register') : '/login'}>{mode === 'login' ? 'Create account' : 'Sign in'}</Link></p>
      </section>
    </main>
  );
}

function InvitePage({ user }: { user?: User }) {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const acceptInvitation = useMutation({
    mutationFn: () => apiRequest('/api/auth/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate('/app');
    },
  });

  if (!user) return <AuthPage mode="register" inviteToken={token} />;

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Brand />
        <span className="eyebrow">Workspace invitation</span>
        <h1>Join your workspace</h1>
        <p className="muted-copy">Accept this invitation while signed in as <strong>{user.email}</strong>.</p>
        {acceptInvitation.error && <div className="inline-error" role="alert">{acceptInvitation.error.message}</div>}
        <button className="primary-btn full-width" type="button" onClick={() => acceptInvitation.mutate()} disabled={acceptInvitation.isPending}>
          {acceptInvitation.isPending ? 'Joining…' : 'Accept invitation'}
        </button>
        <p className="auth-switch"><Link to="/app">Go back to AutoFlow</Link></p>
      </section>
    </main>
  );
}

const navigation = [
  { to: '/app', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/app/workflows', label: 'Workflows', icon: WorkflowIcon },
  { to: '/app/runs', label: 'Execution history', icon: Activity },
  { to: '/app/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/app/admin', label: 'Tasks & admin', icon: Settings2 },
];

function AppLayout({ user }: { user: User }) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('autoflow-theme') === 'dark');
  const logout = useMutation({
    mutationFn: () => apiRequest('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      queryClient.setQueryData(['me'], null);
      navigate('/login');
    },
  });
  const currentLabel = navigation.find(({ to, end }) => end ? location.pathname === to : location.pathname.startsWith(to))?.label ?? 'Workflow builder';

  return (
    <div className="workspace-shell" data-theme={darkMode ? 'dark' : 'light'}>
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand"><Brand /><button className="icon-btn mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Close navigation">×</button></div>
        <div className="workspace-picker"><div className="workspace-avatar">W</div><span><strong>My workspace</strong><small>Personal workspace</small></span><ChevronDown size={15} /></div>
        <div className="nav-caption">WORKSPACE</div>
        <nav className="sidebar-nav">
          {navigation.map(({ to, label, icon: Icon, end }) => {
            const active = end ? location.pathname === to : location.pathname.startsWith(to);
            return <Link key={to} to={to} className={active ? 'active' : ''} onClick={() => setSidebarOpen(false)}><Icon size={18} /><span>{label}</span></Link>;
          })}
        </nav>
        <div className="sidebar-spacer" />
        <Link className="help-link" to="/app/admin"><CircleHelp size={17} /> Help & settings</Link>
        <div className="sidebar-profile">
          <div className="profile-avatar">{user.name.slice(0, 1).toUpperCase()}</div>
          <div className="profile-meta"><strong>{user.name}</strong><span>{user.email}</span></div>
          <button className="icon-btn" onClick={() => logout.mutate()} title="Log out" aria-label="Log out"><LogOut size={17} /></button>
        </div>
      </aside>
      {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" />}
      <div className="workspace-main">
        <header className="workspace-topbar">
          <button className="icon-btn mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
          <div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-divider">/</span><strong>{currentLabel}</strong></div>
          <div className="topbar-actions"><Link className="topbar-cta" to="/app/workflows/new"><Plus size={16} /> New workflow</Link><button className="icon-btn" title="Toggle theme" aria-label="Toggle theme" onClick={() => setDarkMode((value) => { const next = !value; localStorage.setItem('autoflow-theme', next ? 'dark' : 'light'); return next; })}>{darkMode ? <Sun size={18} /> : <Moon size={18} />}</button><button className="icon-btn" title="Notifications" aria-label="Notifications"><Bell size={18} /></button><div className="topbar-avatar">{user.name.slice(0, 1).toUpperCase()}</div></div>
        </header>
        <div className="page-content"><Outlet /></div>
      </div>
    </div>
  );
}

function AppRoutes() {
  const { data: user, isPending, isError } = useQuery<User>({
    queryKey: ['me'],
    queryFn: getCurrentUser,
    retry: false,
  });

  if (isPending) return <div className="loading-screen"><div className="loader" />Loading AutoFlow…</div>;

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={user ? <Navigate to="/app" replace /> : <AuthPage mode="login" />} />
      <Route path="/register" element={user ? <Navigate to="/app" replace /> : <AuthPage mode="register" />} />
      <Route path="/invite/:token" element={<InvitePage user={user} />} />
      <Route path="/app" element={user && !isError ? <AppLayout user={user} /> : <Navigate to="/login" replace />}>
        <Route index element={<Suspense fallback={<div className="loading-inline">Loading workspace…</div>}><DashboardPage /></Suspense>} />
        <Route path="workflows" element={<Suspense fallback={<div className="loading-inline">Loading workflows…</div>}><WorkflowsPage /></Suspense>} />
        <Route path="workflows/new" element={<Suspense fallback={<div className="loading-inline">Loading builder…</div>}><WorkflowBuilder /></Suspense>} />
        <Route path="workflows/:id/edit" element={<Suspense fallback={<div className="loading-inline">Loading builder…</div>}><WorkflowBuilder /></Suspense>} />
        <Route path="runs" element={<Suspense fallback={<div className="loading-inline">Loading runs…</div>}><RunHistoryPage /></Suspense>} />
        <Route path="analytics" element={<Suspense fallback={<div className="loading-inline">Loading analytics…</div>}><AnalyticsPage /></Suspense>} />
        <Route path="admin" element={<Suspense fallback={<div className="loading-inline">Loading workspace tools…</div>}><AdminPage /></Suspense>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return <QueryClientProvider client={queryClient}><BrowserRouter><AppRoutes /></BrowserRouter></QueryClientProvider>;
}

export default App;
