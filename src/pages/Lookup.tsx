import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { StatusBadge } from '../components/StatusBadge';
import { ApiError, api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { usePageTitle } from '../lib/hooks';
import { REPAIR_KIND_LABEL, STATUS_HINT, STATUS_LABEL, STATUS_ORDER } from '../lib/labels';
import { canonicalWorkOrderNumber, toHalfWidth } from '../lib/orderNumber';
import { LOOKUP_NUMBER_HELP, LOOKUP_PHONE_PLACEHOLDER, SERIAL_HINT, countdownSeconds, showDemoAndReset } from '../lib/ux';
import type { PublicOrder, RepairStatus } from '../types';

type Query = { number: string; phoneLast4: string };

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
  const presetNumber = params.get('number') ?? '';
  const presetPhone = toHalfWidth(params.get('phoneLast4') ?? '').trim();
  const [number, setNumber] = useState(presetNumber);
  const [phoneLast4, setPhoneLast4] = useState(presetPhone);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [cooldownTotal, setCooldownTotal] = useState(0);
  const [cooldownStart, setCooldownStart] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const cooldown = countdownSeconds(cooldownTotal, cooldownStart, now);
  const [orders, setOrders] = useState<PublicOrder[] | null>(null);
  const [query, setQuery] = useState<Query | null>(
    presetNumber && /^\d{4}$/.test(presetPhone) ? { number: presetNumber, phoneLast4: presetPhone } : null,
  );
  usePageTitle('查詢維修進度');

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    const search = new URLSearchParams();
    search.set('number', query.number.trim());
    search.set('phoneLast4', toHalfWidth(query.phoneLast4).trim());
    setPending(true);
    api<{ orders: PublicOrder[] }>(`/api/lookup?${search.toString()}`, { signal: controller.signal })
      .then((result) => {
        setOrders(result.orders);
        setError('');
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        if (reason instanceof ApiError && reason.retryAfterSeconds) {
          setCooldownTotal(reason.retryAfterSeconds);
          setCooldownStart(Date.now());
          setNow(Date.now());
        }
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
    setPhoneLast4(next.phoneLast4);
    setError('');
    setQuery(next);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cooldown > 0) return;
    const last4 = toHalfWidth(phoneLast4).trim();
    const padded = canonicalWorkOrderNumber(number) ?? number;
    if (!padded.trim() || !/^\d{4}$/.test(last4)) {
      setOrders(null);
      setError('請輸入完整單號與電話末四碼');
      return;
    }
    setNumber(padded);
    setError('');
    setQuery({ number: padded, phoneLast4: last4 });
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
        <p className="lede">請輸入完整維修單號，以及留在店裡的電話末四碼。此頁只顯示狀態與可公開的進度，不含店內檢測指令。</p>

        <form id="lookup-form" className="panel" onSubmit={onSubmit} noValidate>
          <label className="field">
            <span>完整單號</span>
            <input
              value={number}
              onChange={(event) => {
                setNumber(event.target.value);
                setOrders(null);
                setError('');
              }}
              placeholder="維修單-20261024-001"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>電話末四碼</span>
            <input
              value={phoneLast4}
              onChange={(event) => {
                setPhoneLast4(event.target.value);
                setOrders(null);
                setError('');
              }}
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              placeholder={LOOKUP_PHONE_PLACEHOLDER}
              spellCheck={false}
            />
          </label>
          {error ? (
            <p className="form-error" role="alert">
              {error}
              {cooldown > 0 ? `請等待 ${cooldown} 秒` : ''}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={pending || cooldown > 0}>
            {pending ? '查詢中…' : cooldown > 0 ? `請等待 ${cooldown} 秒` : '查詢進度'}
          </button>
          <p className="hint">
            {LOOKUP_NUMBER_HELP}。{SERIAL_HINT}。只填公號、NT 帳號或流水號不會查出維修單。
            {showDemoAndReset(import.meta.env.PROD) ? (
              <>
                示範：
                <button type="button" className="text-btn" onClick={() => runQuery({ number: '維修單-20261024-001', phoneLast4: '0334' })}>
                  維修單-20261024-001／電話末四碼 0334
                </button>
                。
              </>
            ) : null}
          </p>
        </form>

        {orders && orders.length === 0 && !error ? (
          <div className="panel empty-state">
            <h2>查無符合的維修單</h2>
            <p>請再核對完整單號與電話末四碼。兩者都要和送修時留下的資料一致。</p>
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
