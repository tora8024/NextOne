import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import { RESET_CONFIRM, showDemoAndReset } from '../lib/ux';
import { ChangePasswordPage } from '../pages/ChangePassword';
import { LoginPage } from '../pages/Login';
import { IconClipboard, IconDevice, IconHome, IconPeople, IconPlus, IconSearch } from './Icons';

const NAV = [
  { id: 'home', to: '/', label: '總覽', icon: <IconHome /> },
  { id: 'orders', to: '/orders', label: '維修單', icon: <IconClipboard /> },
  { id: 'create', to: '/orders/new', label: '建立維修單', icon: <IconPlus /> },
  { id: 'customers', to: '/customers', label: '客戶', icon: <IconPeople /> },
  { id: 'devices', to: '/devices', label: '設備', icon: <IconDevice /> },
] as const;

function activeId(pathname: string): string {
  if (pathname === '/') return 'home';
  if (pathname === '/orders/new') return 'create';
  if (pathname === '/orders' || pathname.startsWith('/orders/')) return 'orders';
  if (pathname.startsWith('/customers')) return 'customers';
  if (pathname.startsWith('/devices')) return 'devices';
  return '';
}

export function AdminLayout() {
  const { db, error, user, phase, resetDemo, logout } = useStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetPhrase, setResetPhrase] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const current = activeId(location.pathname);
  const openCount = db?.orders.filter((order) => order.status !== 'completed').length ?? 0;

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  if (phase === 'loading') {
    return (
      <main className="lookup-page">
        <p className="empty">正在確認登入狀態…</p>
      </main>
    );
  }
  if (!user) {
    return (
      <>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <LoginPage />
      </>
    );
  }
  if (phase === 'password' || user.mustChangePassword) {
    return <ChangePasswordPage />;
  }

  return (
    <div className="shell">
      <a className="skip" href="#content">
        跳到內容
      </a>
      <button type="button" className={open ? 'scrim show' : 'scrim'} aria-label="關閉選單" onClick={() => setOpen(false)} />
      <aside id="nav" className={open ? 'sidebar open' : 'sidebar'}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            N
          </div>
          <div>
            <h2>NextOne 維修台</h2>
            <p>大同區 · 電腦維修</p>
          </div>
        </div>
        <nav aria-label="主要">
          {NAV.map((item) => (
            <Link key={item.id} to={item.to} className={current === item.id ? 'nav-link active' : 'nav-link'} aria-current={current === item.id ? 'page' : undefined}>
              {item.icon}
              <span>{item.label}</span>
              {item.id === 'orders' && openCount > 0 ? <span className="count-pill">{openCount}</span> : null}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <p className="who">
            {user.username} · {user.role === 'admin' ? '管理員' : '櫃檯人員'}
          </p>
          <Link className="nav-link" to="/lookup" target="_blank" rel="noreferrer">
            <IconSearch />
            <span>客戶查詢頁</span>
          </Link>
          {user.role === 'admin' && showDemoAndReset(import.meta.env.PROD) ? (
            <div className="reset-block">
              {resetOpen ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (resetPhrase !== RESET_CONFIRM) return;
                    setResetError('');
                    void resetDemo()
                      .then(() => {
                        setResetPhrase('');
                        setResetOpen(false);
                        navigate('/');
                      })
                      .catch((reason: unknown) => {
                        setResetError(reason instanceof Error ? reason.message : '無法還原示範資料');
                      });
                  }}
                >
                  <label className="field">
                    <span>請輸入「{RESET_CONFIRM}」以確認</span>
                    <input value={resetPhrase} onChange={(event) => setResetPhrase(event.target.value)} autoComplete="off" />
                  </label>
                  <button type="submit" className="reset-danger" disabled={resetPhrase !== RESET_CONFIRM}>
                    確認還原
                  </button>
                </form>
              ) : (
                <button type="button" className="reset-danger" onClick={() => setResetOpen(true)}>
                  還原示範資料
                </button>
              )}
              {resetError ? <p className="sidebar-error">{resetError}</p> : null}
            </div>
          ) : null}
          <button
            type="button"
            className="logout-btn"
            onClick={() => {
              void logout();
            }}
          >
            登出
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="mobile-bar">
          <button type="button" className="menu-btn" aria-expanded={open} aria-controls="nav" onClick={() => setOpen((value) => !value)}>
            選單
          </button>
          <strong>NextOne 維修台</strong>
        </header>
        <main id="content" className="content">
          {!db ? <p className={error ? 'form-error' : 'empty'}>{error || '正在從資料庫讀取…'}</p> : <Outlet />}
        </main>
      </div>
    </div>
  );
}
