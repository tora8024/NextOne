import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { StatusBadge } from '../components/StatusBadge';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { usePageTitle } from '../lib/hooks';
import { REPAIR_KIND_LABEL, STATUS_HINT, STATUS_LABEL, STATUS_ORDER } from '../lib/labels';
import type { PublicOrder, RepairStatus } from '../types';

type Query = { number: string; nt: string; from: string; to: string };

function StatusStepper({ status }: { status: RepairStatus }) {
  const current = STATUS_ORDER.indexOf(status);
  return (
    <ol className="stepper" aria-label="維修進度">
      {STATUS_ORDER.map((item, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'todo';
        return (
          <li key={item} className={`step ${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="step-dot">{index < current ? '✓' : index + 1}</span>
            <span>{STATUS_LABEL[item]}</span>
          </li>
        );
      })}
    </ol>
  );
}

function LookupCard({ order }: { order: PublicOrder }) {
  return (
    <article className="panel lookup-card">
      <div className="lookup-card-top">
        <div>
          <p className="kicker">維修單號</p>
          <p className="mono order-no">{order.orderNumber}</p>
        </div>
        <StatusBadge status={order.status} />
      </div>
      <p className="status-hint">{STATUS_HINT[order.status]}</p>
      <StatusStepper status={order.status} />
      <dl className="meta">
        <dt>客戶</dt>
        <dd>
          {order.customerName}
          {order.phoneMasked ? <span className="muted"> · {order.phoneMasked}</span> : null}
        </dd>
        <dt>設備</dt>
        <dd>
          {order.deviceSummary}
          {order.serialLast4 ? <span className="muted">（序號末四碼 {order.serialLast4}）</span> : null}
        </dd>
        <dt>送修內容</dt>
        <dd>
          {REPAIR_KIND_LABEL[order.repairKind]} · {order.repairTarget}
        </dd>
        <dt>受理時間</dt>
        <dd>{formatDateTime(order.createdAt)}</dd>
        <dt>最後更新</dt>
        <dd>{formatDateTime(order.updatedAt)}</dd>
        {order.completedAt ? (
          <>
            <dt>完成時間</dt>
            <dd>{formatDateTime(order.completedAt)}</dd>
          </>
        ) : null}
      </dl>
      <h3>進度說明</h3>
      {order.publicLogs.length === 0 ? (
        <p className="empty">目前沒有額外說明，請以上方狀態為準。</p>
      ) : (
        <ol className="timeline">
          {order.publicLogs.map((entry) => (
            <li key={entry.id}>
              <div className="log-meta">
                <span>{formatDateTime(entry.at)}</span>
                <span>{entry.author}</span>
              </div>
              <p className="log-body">{entry.content}</p>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

export function LookupPage() {
  const [params] = useSearchParams();
  const preset = params.get('number') ?? '';
  const [number, setNumber] = useState(preset);
  const [nt, setNt] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [orders, setOrders] = useState<PublicOrder[] | null>(null);
  const [query, setQuery] = useState<Query | null>(preset ? { number: preset, nt: '', from: '', to: '' } : null);
  usePageTitle('查詢維修進度');

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    const search = new URLSearchParams();
    if (query.number.trim()) search.set('number', query.number.trim());
    if (query.nt.trim()) search.set('nt', query.nt.trim());
    if (query.from) search.set('from', query.from);
    if (query.to) search.set('to', query.to);
    setPending(true);
    api<{ orders: PublicOrder[] }>(`/api/lookup?${search.toString()}`, { signal: controller.signal })
      .then((result) => {
        setOrders(result.orders);
        setError('');
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setOrders([]);
        setError(reason instanceof Error ? reason.message : '查詢失敗');
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    return () => controller.abort();
  }, [query]);

  function runQuery(next: Query) {
    setNumber(next.number);
    setNt(next.nt);
    setFrom(next.from);
    setTo(next.to);
    setError('');
    setQuery(next);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!number.trim() && !nt.trim()) {
      setOrders(null);
      setError('請輸入工號、完整單號或 NT 帳號');
      return;
    }
    setError('');
    setQuery({ number, nt, from, to });
  }

  return (
    <main id="content" className="lookup-page">
      <a className="skip" href="#lookup-form">
        跳到查詢
      </a>
      <div className="lookup-wrap">
        <header className="lookup-brand">
          <div className="brand-mark" aria-hidden="true">
            N
          </div>
          <div>
            <p className="kicker">NEXTONE SERVICE</p>
            <h1>查詢維修進度</h1>
          </div>
        </header>
        <p className="lede">輸入 6 位數工號或 NT 帳號。此頁只顯示狀態與可公開的進度，不含店內檢測指令。</p>

        <form id="lookup-form" className="panel" onSubmit={onSubmit} noValidate>
          <label className="field">
            <span>工號或完整單號</span>
            <input
              value={number}
              onChange={(event) => {
                setNumber(event.target.value);
                setOrders(null);
                setError('');
              }}
              placeholder="100002 或 WO-20261024-001"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>NT 帳號</span>
            <input
              value={nt}
              onChange={(event) => {
                setNt(event.target.value);
                setOrders(null);
                setError('');
              }}
              placeholder="chenghan 或 CORP\chenghan"
              autoComplete="username"
              spellCheck={false}
            />
          </label>
          <div className="grid-2">
            <label className="field">
              <span>建立日起（選填）</span>
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label className="field">
              <span>建立日迄（選填）</span>
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
          </div>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? '查詢中…' : '查詢進度'}
          </button>
          <p className="hint">
            工號會同時找員工編號，以及維修單當天的流水號。流水號每天從 001 重來，只查 1 或 001 可能看到很多天；可加上日期。示範：
            <button type="button" className="text-btn" onClick={() => runQuery({ number: '100002', nt: '', from: '', to: '' })}>
              工號 100002
            </button>
            、
            <button type="button" className="text-btn" onClick={() => runQuery({ number: '', nt: 'chenghan', from: '', to: '' })}>
              NT chenghan
            </button>
            、
            <button type="button" className="text-btn" onClick={() => runQuery({ number: '1', nt: '', from: '2026-10-24', to: '2026-10-24' })}>
              流水號 1（2026-10-24）
            </button>
            。
          </p>
        </form>

        {orders && orders.length === 0 && !error ? (
          <div className="panel empty-state">
            <h2>查無符合的維修單</h2>
            <p>請再核對工號、NT 帳號或日期。流水號若沒有搭配日期，不同天的 001 都會出現。</p>
          </div>
        ) : null}

        {orders && orders.length > 0 ? (
          <div className="stack">
            <p className="result-count">找到 {orders.length} 張維修單</p>
            {orders.map((order) => (
              <LookupCard key={order.orderNumber} order={order} />
            ))}
          </div>
        ) : null}

        <footer className="lookup-foot">
          <p>NextOne 維修台 · 台北市大同區承德路一段 100 號 1 樓</p>
          <p>週一至週六 11:00–20:00 · 02-2345-6780</p>
        </footer>
      </div>
    </main>
  );
}
