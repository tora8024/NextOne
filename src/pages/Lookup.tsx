import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { StatusBadge } from '../components/StatusBadge';
import { findCustomerByContact, findOrderByNumber, sortOrders } from '../lib/db';
import { deviceLabel, formatDateTime, maskPhone, maskSerial, normalizePhone } from '../lib/format';
import { usePageTitle } from '../lib/hooks';
import { REPAIR_KIND_LABEL, STATUS_HINT, STATUS_LABEL, STATUS_ORDER } from '../lib/labels';
import { useStore } from '../lib/store';
import type { RepairOrder, RepairStatus } from '../types';

type Query =
  | { kind: 'number'; value: string }
  | { kind: 'contact'; name: string; phone: string };

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

function LookupCard({ order }: { order: RepairOrder }) {
  const { db } = useStore();
  const customer = db.customers.find((item) => item.id === order.customerId);
  const device = db.devices.find((item) => item.id === order.deviceId);
  const visibleLogs = order.logs.filter((entry) => entry.visibleToCustomer);
  const serial = maskSerial(device?.serialNumber);

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
          {customer?.name ?? '—'}
          {customer ? <span className="muted"> · {maskPhone(customer.phone)}</span> : null}
        </dd>
        <dt>設備</dt>
        <dd>
          {device ? deviceLabel(device) : '—'}
          {serial ? <span className="muted">（序號末四碼 {serial}）</span> : null}
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
      {visibleLogs.length === 0 ? (
        <p className="empty">目前沒有額外說明，請以上方狀態為準。</p>
      ) : (
        <ol className="timeline">
          {visibleLogs.map((entry) => (
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
  const { db } = useStore();
  const [params] = useSearchParams();
  const presetNo = params.get('no') ?? '';
  const [mode, setMode] = useState<'number' | 'contact'>('number');
  const [orderNo, setOrderNo] = useState(presetNo);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState<Query | null>(presetNo ? { kind: 'number', value: presetNo } : null);
  usePageTitle('查詢維修進度');

  useEffect(() => {
    if (!presetNo) return;
    setMode('number');
    setOrderNo(presetNo);
    setError('');
    setQuery({ kind: 'number', value: presetNo });
  }, [presetNo]);

  const orders = useMemo(() => {
    if (!query) return [];
    if (query.kind === 'number') {
      const order = findOrderByNumber(db.orders, query.value);
      return order ? [order] : [];
    }
    const customer = findCustomerByContact(db.customers, query.name, query.phone);
    if (!customer) return [];
    return sortOrders(db.orders.filter((order) => order.customerId === customer.id));
  }, [db, query]);

  function searchByNumber(value: string) {
    setMode('number');
    setOrderNo(value);
    if (!value.trim()) {
      setQuery(null);
      setError('請輸入維修單號');
      return;
    }
    setError('');
    setQuery({ kind: 'number', value });
  }

  function searchByContact(nextName: string, nextPhone: string) {
    setMode('contact');
    setName(nextName);
    setPhone(nextPhone);
    if (!nextName.trim()) {
      setQuery(null);
      setError('請輸入客戶姓名');
      return;
    }
    if (normalizePhone(nextPhone).length < 8) {
      setQuery(null);
      setError('請輸入完整電話');
      return;
    }
    setError('');
    setQuery({ kind: 'contact', name: nextName, phone: nextPhone });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === 'number') searchByNumber(orderNo);
    else searchByContact(name, phone);
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
        <p className="lede">輸入維修單號，或使用留在店裡的姓名與電話。此頁只顯示進度，不含內部檢測紀錄。</p>

        <form id="lookup-form" className="panel" onSubmit={onSubmit} noValidate>
          <div className="choice-row" role="radiogroup" aria-label="查詢方式">
            <label className={mode === 'number' ? 'choice active' : 'choice'}>
              <input
                type="radio"
                name="lookupMode"
                checked={mode === 'number'}
                onChange={() => {
                  setMode('number');
                  setError('');
                }}
              />
              維修單號
            </label>
            <label className={mode === 'contact' ? 'choice active' : 'choice'}>
              <input
                type="radio"
                name="lookupMode"
                checked={mode === 'contact'}
                onChange={() => {
                  setMode('contact');
                  setError('');
                }}
              />
              姓名與電話
            </label>
          </div>
          {mode === 'number' ? (
            <label className="field">
              <span>維修單號</span>
              <input
                value={orderNo}
                onChange={(event) => {
                  setOrderNo(event.target.value);
                  setQuery(null);
                  setError('');
                }}
                placeholder="例如 NX-2610-002"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={20}
              />
            </label>
          ) : (
            <div className="grid-2">
              <label className="field">
                <span>客戶姓名</span>
                <input
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setQuery(null);
                    setError('');
                  }}
                  autoComplete="name"
                  maxLength={40}
                  placeholder="需與建檔姓名相同"
                />
              </label>
              <label className="field">
                <span>聯絡電話</span>
                <input
                  value={phone}
                  onChange={(event) => {
                    setPhone(event.target.value);
                    setQuery(null);
                    setError('');
                  }}
                  autoComplete="tel"
                  inputMode="tel"
                  maxLength={30}
                  placeholder="0912-334-567"
                />
              </label>
            </div>
          )}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn btn-primary">
            查詢進度
          </button>
          <p className="hint">
            示範：
            <button type="button" className="text-btn" onClick={() => searchByNumber('NX-2610-002')}>
              NX-2610-002
            </button>
            ，或
            <button type="button" className="text-btn" onClick={() => searchByContact('林承翰', '0928-110-334')}>
              林承翰 / 0928-110-334
            </button>
            。
          </p>
        </form>

        {query && !error && orders.length === 0 ? (
          <div className="panel empty-state">
            <h2>查無符合的維修單</h2>
            <p>請再核對單號，或改用建檔時的姓名與電話。電話可以含或不含連字號。</p>
          </div>
        ) : null}

        {orders.length > 0 ? (
          <div className="stack">
            <p className="result-count">找到 {orders.length} 張維修單</p>
            {orders.map((order) => (
              <LookupCard key={order.id} order={order} />
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
