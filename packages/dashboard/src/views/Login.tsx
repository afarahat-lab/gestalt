import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDashboardApi } from '../hooks/useApi';

type ProviderName = 'windows-kerberos' | 'saml' | 'oidc' | 'local';

export function Login() {
  const api = useDashboardApi();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState<ProviderName[] | null>(null);

  // ADR-040 — on mount, discover which auth providers are configured
  // so we render only the buttons that will actually work.
  useEffect(() => {
    // Also pick up an in-URL token from a SAML/OIDC redirect — the
    // callback handlers redirect to `/app/?token=<jwt>` which lands
    // on this view via React Router's basename. localStorage that
    // token + bounce to the dashboard root.
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get('token');
    if (tokenFromUrl) {
      localStorage.setItem('gestalt_token', tokenFromUrl);
      api.setToken(tokenFromUrl);
      // Strip the token from the URL to keep it out of browser history
      window.history.replaceState({}, '', '/app/');
      navigate('/');
      return;
    }
    fetch('/auth/providers')
      .then((r) => r.json())
      .then((data: { providers: ProviderName[] }) => setProviders(data.providers))
      .catch(() => setProviders(['local']));
  }, [api, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.login(email, password);
      localStorage.setItem('gestalt_token', res.token);
      api.setToken(res.token);
      navigate('/');
    } catch {
      setError('Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  // Kerberos uses the browser's native SPNEGO flow. Hitting the
  // endpoint without an Authorization header triggers the 401 +
  // WWW-Authenticate, the browser silently re-requests with the
  // SPNEGO token, server validates and returns the JWT.
  const handleKerberos = async () => {
    try {
      const r = await fetch('/auth/kerberos', { credentials: 'include' });
      if (!r.ok) {
        setError(`Kerberos SSO failed (${r.status})`);
        return;
      }
      const data = (await r.json()) as { token: string };
      localStorage.setItem('gestalt_token', data.token);
      api.setToken(data.token);
      navigate('/');
    } catch (e) {
      setError(`Kerberos SSO failed: ${(e as Error).message}`);
    }
  };

  const ssoProviders = providers ?? [];
  const hasKerberos = ssoProviders.includes('windows-kerberos');
  const hasSaml = ssoProviders.includes('saml');
  const hasOidc = ssoProviders.includes('oidc');
  const hasLocal = ssoProviders.length === 0 || ssoProviders.includes('local');
  const hasAnySso = hasKerberos || hasSaml || hasOidc;

  return (
    <div style={styles.shell}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <span style={{ color: 'var(--accent)', fontSize: '32px' }}>◈</span>
          <span style={styles.logoText}>gestalt</span>
        </div>
        <p style={styles.tagline}>agent-first software development platform</p>

        {hasKerberos && (
          <button type="button" style={styles.ssoBtn} onClick={() => { void handleKerberos(); }}>
            🪟 Sign in with Windows (Kerberos SSO)
          </button>
        )}
        {hasSaml && (
          <a href="/auth/saml/login?relay=/app/" style={styles.ssoBtnLink}>
            🏢 Sign in with Corporate SSO (SAML)
          </a>
        )}
        {hasOidc && (
          <a href="/auth/oidc/login" style={styles.ssoBtnLink}>
            🔐 Sign in with Azure AD (OIDC)
          </a>
        )}

        {hasAnySso && hasLocal && (
          <div style={styles.divider}>
            <span style={styles.dividerText}>── or ──</span>
          </div>
        )}

        {hasLocal && (
          <form onSubmit={(e) => { void handleLogin(e); }}>
            <div style={styles.field}>
              <label style={styles.label}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                style={styles.input}
                placeholder="you@company.com"
                autoFocus={!hasAnySso}
                required
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={styles.input}
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <p style={{ fontSize: '12px', color: 'var(--red)', marginBottom: '12px',
                fontFamily: 'var(--font-mono)' }}>
                {error}
              </p>
            )}

            <button type="submit" style={styles.btn} disabled={loading}>
              {loading ? 'signing in...' : 'sign in'}
            </button>
          </form>
        )}

        {!hasLocal && error && (
          <p style={{ fontSize: '12px', color: 'var(--red)', marginTop: '12px',
            fontFamily: 'var(--font-mono)' }}>{error}</p>
        )}

        {!hasAnySso && (
          <p style={styles.hint}>
            Corporate SSO available when auth.config.json is mounted
          </p>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-base)',
  },
  card: {
    width: '360px',
    background: 'var(--bg-raised)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    padding: '36px 32px',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '6px',
  },
  logoText: {
    fontFamily: 'var(--font-mono)',
    fontWeight: 500,
    fontSize: '22px',
    letterSpacing: '0.04em',
    color: 'var(--text-primary)',
  },
  tagline: {
    fontSize: '11px',
    color: 'var(--text-dim)',
    fontFamily: 'var(--font-mono)',
    marginBottom: '28px',
  },
  field: { marginBottom: '16px' },
  label: {
    display: 'block',
    fontSize: '11px',
    color: 'var(--text-secondary)',
    marginBottom: '5px',
    fontFamily: 'var(--font-mono)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  input: {
    width: '100%',
    background: 'var(--bg-base)',
    border: '1px solid var(--border-strong)',
    borderRadius: '6px',
    padding: '9px 12px',
    fontSize: '13px',
    color: 'var(--text-primary)',
    outline: 'none',
  },
  btn: {
    width: '100%',
    background: 'var(--accent)',
    color: '#000',
    fontWeight: 600,
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    padding: '10px',
    borderRadius: '6px',
    marginTop: '4px',
    cursor: 'pointer',
    transition: 'opacity 0.12s',
  },
  hint: {
    marginTop: '20px',
    fontSize: '11px',
    color: 'var(--text-dim)',
    fontFamily: 'var(--font-mono)',
    textAlign: 'center',
  },
  ssoBtn: {
    display: 'block',
    width: '100%',
    background: 'var(--bg-base)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-strong)',
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    padding: '11px',
    borderRadius: '6px',
    marginBottom: '8px',
    cursor: 'pointer',
    textAlign: 'center' as const,
  },
  ssoBtnLink: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box' as const,
    background: 'var(--bg-base)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-strong)',
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    padding: '11px',
    borderRadius: '6px',
    marginBottom: '8px',
    cursor: 'pointer',
    textDecoration: 'none',
    textAlign: 'center' as const,
  },
  divider: {
    textAlign: 'center' as const,
    margin: '20px 0 16px',
  },
  dividerText: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--text-dim)',
  },
};
