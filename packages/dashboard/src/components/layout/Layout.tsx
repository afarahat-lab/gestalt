import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useDashboardApi } from '../../hooks/useApi';
import { useLiveEvent } from '../../hooks/useLiveEvents';
import { useProject } from '../../context/ProjectContext';
import { useCurrentUser } from '../../context/CurrentUserContext';

const NAV_ITEMS = [
  { path: '/',             label: 'Intents',     icon: '◈' },
  { path: '/agents',       label: 'Agents',      icon: '◎' },
  { path: '/gate',         label: 'Gate',        icon: '◉' },
  { path: '/deployments',  label: 'Deployments', icon: '↑' },
  { path: '/maintenance',  label: 'Maintenance', icon: '⟳' },
  { path: '/alerts',       label: 'Alerts',      icon: '!' },
];

// platform-admin only — see CurrentUserProvider and RequirePlatformAdmin.
const ADMIN_NAV_ITEM = { path: '/admin', label: 'Admin', icon: '★' };

export function Layout() {
  const api = useDashboardApi();
  const navigate = useNavigate();
  const {
    projects, currentProjectId, setCurrentProjectId,
    loading: projectsLoading, currentUserRole,
  } = useProject();
  const { user: currentUser } = useCurrentUser();
  const isPlatformAdmin = currentUser?.role === 'platform-admin';
  // ⚙ Settings link is shown when the operator can edit project
  // config — i.e. is the project-admin on the current project OR
  // a platform-admin (who bypasses every project guard).
  const canEditProject = isPlatformAdmin || currentUserRole === 'project-admin';
  const [alertCount, setAlertCount] = useState(0);
  const [connected] = useState(true);

  // Track unacknowledged alerts
  useLiveEvent('alert.created', () => {
    setAlertCount(c => c + 1);
  });
  useLiveEvent('alert.acknowledged', () => {
    setAlertCount(c => Math.max(0, c - 1));
  });

  // Load initial alert count
  useEffect(() => {
    api.listAlerts({ acknowledged: false }).then(r => {
      setAlertCount(r.total);
    }).catch(() => {});
  }, [api]);

  function handleLogout() {
    localStorage.removeItem('gestalt_token');
    navigate('/login');
  }

  return (
    <div style={styles.shell}>
      {/* Sidebar */}
      <nav style={styles.sidebar}>
        {/* Logo */}
        <div style={styles.logo}>
          <span style={styles.logoMark}>◈</span>
          <span style={styles.logoText}>gestalt</span>
        </div>

        {/* Project selector — sits between the logo and the nav so it
            reads as "you are looking at this project" rather than as
            another navigation item. The selection persists via
            ProjectContext + localStorage and applies to every
            project-scoped view (Intents / Alerts / Deployments /
            Gate / Maintenance). */}
        <div style={styles.projectSelector}>
          {projectsLoading ? (
            <p style={styles.projectMuted}>loading...</p>
          ) : projects.length === 0 ? (
            <p style={styles.projectMuted}>No projects — run gestalt init</p>
          ) : (
            <select
              value={currentProjectId ?? ''}
              onChange={(e) => setCurrentProjectId(e.target.value)}
              style={styles.projectSelect}
              aria-label="Current project"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Nav */}
        <ul style={styles.navList}>
          {NAV_ITEMS.map(item => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                end={item.path === '/'}
                style={({ isActive }) => ({
                  ...styles.navItem,
                  ...(isActive ? styles.navItemActive : {}),
                })}
              >
                <span style={styles.navIcon}>{item.icon}</span>
                <span>{item.label}</span>
                {item.path === '/alerts' && alertCount > 0 && (
                  <span style={styles.badge}>{alertCount}</span>
                )}
              </NavLink>
            </li>
          ))}
          {/* ⚙ Settings — visible to platform-admin OR project-admin on
              the current project. Completely absent from the DOM for
              editors / readers (so an editor can't even see that
              project config exists). Navigates to a project-scoped
              path so deep links survive switching projects. */}
          {canEditProject && currentProjectId && (
            <li key="settings">
              <NavLink
                to={`/projects/${currentProjectId}/settings`}
                style={({ isActive }) => ({
                  ...styles.navItem,
                  ...(isActive ? styles.navItemActive : {}),
                })}
              >
                <span style={styles.navIcon}>⚙</span>
                <span>Settings</span>
              </NavLink>
            </li>
          )}
          {/* Admin entry is rendered only for platform-admin —
              completely absent from the DOM for everyone else. */}
          {isPlatformAdmin && (
            <li key={ADMIN_NAV_ITEM.path}>
              <NavLink
                to={ADMIN_NAV_ITEM.path}
                style={({ isActive }) => ({
                  ...styles.navItem,
                  ...(isActive ? styles.navItemActive : {}),
                })}
              >
                <span style={styles.navIcon}>{ADMIN_NAV_ITEM.icon}</span>
                <span>{ADMIN_NAV_ITEM.label}</span>
              </NavLink>
            </li>
          )}
        </ul>

        {/* Footer */}
        <div style={styles.sidebarFooter}>
          <div style={styles.connectionStatus}>
            <span style={{
              ...styles.dot,
              background: connected ? 'var(--green)' : 'var(--red)',
              animation: connected ? 'pulse-dot 2s infinite' : 'none',
            }} />
            <span style={{ color: 'var(--text-dim)', fontSize: '12px' }}>
              {connected ? 'connected' : 'disconnected'}
            </span>
          </div>
          <button style={styles.logoutBtn} onClick={handleLogout}>
            sign out
          </button>
        </div>
      </nav>

      {/* Main */}
      <main style={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: 'flex',
    height: '100vh',
    overflow: 'hidden',
  },
  sidebar: {
    width: 'var(--sidebar-w)',
    minWidth: 'var(--sidebar-w)',
    background: 'var(--bg-raised)',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '20px 16px 16px',
    borderBottom: '1px solid var(--border)',
    marginBottom: '8px',
  },
  logoMark: {
    color: 'var(--accent)',
    fontSize: '20px',
    lineHeight: 1,
  },
  logoText: {
    fontFamily: 'var(--font-mono)',
    fontWeight: 500,
    fontSize: '15px',
    letterSpacing: '0.05em',
    color: 'var(--text-primary)',
  },
  projectSelector: {
    padding: '10px 16px 12px',
    borderBottom: '1px solid var(--border)',
    marginBottom: '8px',
  },
  projectSelect: {
    width: '100%',
    background: 'var(--bg-subtle)',
    border: '1px solid var(--border)',
    borderRadius: '5px',
    padding: '6px 8px',
    fontSize: '12px',
    fontFamily: 'var(--font-mono)',
    color: 'var(--text-primary)',
    outline: 'none',
    cursor: 'pointer',
  },
  projectMuted: {
    fontSize: '11px',
    fontFamily: 'var(--font-mono)',
    color: 'var(--text-dim)',
    fontStyle: 'italic',
  },
  navList: {
    listStyle: 'none',
    flex: 1,
    padding: '4px 8px',
    overflowY: 'auto',
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 10px',
    borderRadius: '6px',
    color: 'var(--text-secondary)',
    fontSize: '13px',
    transition: 'all 0.12s',
    marginBottom: '2px',
    position: 'relative',
  },
  navItemActive: {
    color: 'var(--text-primary)',
    background: 'var(--bg-subtle)',
    borderLeft: '2px solid var(--accent)',
    paddingLeft: '8px',
  },
  navIcon: {
    fontFamily: 'var(--font-mono)',
    width: '16px',
    textAlign: 'center',
    color: 'var(--accent)',
  },
  badge: {
    marginLeft: 'auto',
    background: 'var(--red)',
    color: '#fff',
    fontSize: '10px',
    fontWeight: 600,
    padding: '1px 5px',
    borderRadius: '10px',
    fontFamily: 'var(--font-mono)',
  },
  sidebarFooter: {
    padding: '12px 16px',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  connectionStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  dot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
  },
  logoutBtn: {
    fontSize: '12px',
    color: 'var(--text-dim)',
    textAlign: 'left',
    padding: 0,
  },
  main: {
    flex: 1,
    overflow: 'auto',
    background: 'var(--bg-base)',
  },
};
