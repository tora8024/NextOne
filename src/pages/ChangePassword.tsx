import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePageTitle } from '../lib/hooks';
import { useStore } from '../lib/store';
import { isCommonPassword } from '../lib/common-passwords';
import { INITIAL_PASSWORD_HINT, PASSWORD_RULE, PASSWORD_UPDATED } from '../lib/ux';

export function ChangePasswordPage() {
  const { user, changePassword, logout } = useStore();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  usePageTitle('變更密碼');

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword.length < 12) {
      setError('新密碼至少要 12 個字');
      return;
    }
    if (isCommonPassword(newPassword)) {
      setError('請換一個不容易猜到的密碼');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('兩次輸入的新密碼不一樣');
      return;
    }
    setError('');
    setPending(true);
    try {
      await changePassword(currentPassword, newPassword);
      navigate('/', { replace: true, state: { notice: PASSWORD_UPDATED } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '無法變更密碼');
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
            <h1>變更密碼</h1>
          </div>
        </header>
        <p className="lede">
          {user?.username ?? '這個帳號'} 必須先設定新密碼，才能使用店內工作台。變更完成前，其他功能會先停用。
        </p>
        <form className="panel" onSubmit={onSubmit}>
          <label className="field">
            <span>目前密碼</span>
            <input
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          <label className="field">
            <span>新密碼</span>
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              minLength={12}
              required
            />
          </label>
          <label className="field">
            <span>再輸入一次新密碼</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              minLength={12}
              required
            />
          </label>
          <p className="hint">{INITIAL_PASSWORD_HINT}</p>
          <p className="hint">{PASSWORD_RULE}</p>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? '變更中…' : '變更密碼'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              void logout();
            }}
          >
            登出
          </button>
        </form>
      </div>
    </main>
  );
}
