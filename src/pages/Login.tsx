import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { usePageTitle } from '../lib/hooks';
import { useStore } from '../lib/store';
import { countdownSeconds } from '../lib/ux';
import { ChangePasswordPage } from './ChangePassword';

export function LoginPage() {
  const { login } = useStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [cooldownTotal, setCooldownTotal] = useState(0);
  const [cooldownStart, setCooldownStart] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const cooldown = countdownSeconds(cooldownTotal, cooldownStart, now);
  usePageTitle('登入');

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      await login(username.trim(), password);
    } catch (reason) {
      if (reason instanceof ApiError && reason.retryAfterSeconds) {
        setCooldownTotal(reason.retryAfterSeconds);
        setCooldownStart(Date.now());
        setNow(Date.now());
      }
      setError(reason instanceof Error ? reason.message : '無法登入');
    } finally {
      setPending(false);
    }
  }

  return (
    <main id="content" className="lookup-page">
      <div className="lookup-wrap">
        <header className="lookup-brand">
          <div className="brand-mark" aria-hidden="true">
            N
          </div>
          <div>
            <p className="kicker">NEXTONE SERVICE</p>
            <h1>登入維修台</h1>
          </div>
        </header>
        <p className="lede">店內工作台需要登入。客戶查詢頁不用登入，但必須有完整單號與電話末四碼。</p>
        <form className="panel" onSubmit={onSubmit}>
          <label className="field">
            <span>帳號</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              spellCheck={false}
              required
            />
          </label>
          <label className="field">
            <span>密碼</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error ? (
            <p className="form-error" role="alert">
              {error}
              {cooldown > 0 ? `請等待 ${cooldown} 秒` : ''}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={pending || cooldown > 0}>
            {pending ? '登入中…' : cooldown > 0 ? `請等待 ${cooldown} 秒` : '登入'}
          </button>
        </form>
      </div>
    </main>
  );
}

export function LoginRoute() {
  const { user, phase } = useStore();
  if (phase === 'loading') {
    return (
      <main className="lookup-page">
        <p className="empty">正在確認登入狀態…</p>
      </main>
    );
  }
  if (user?.mustChangePassword || phase === 'password') return <ChangePasswordPage />;
  if (user) return <Navigate to="/" replace />;
  return <LoginPage />;
}
