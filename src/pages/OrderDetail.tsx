import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { StatusBadge } from '../components/StatusBadge';
import { deviceLabel, formatDateTime, formatPhone } from '../lib/format';
import { usePageTitle } from '../lib/hooks';
import { REPAIR_KIND_LABEL, STATUS_LABEL, STATUS_ORDER } from '../lib/labels';
import { useDatabase, useStore } from '../lib/store';
import { statusConfirmText } from '../lib/ux';
import type { RepairStatus } from '../types';

export function OrderDetailPage() {
  const { orderId } = useParams();
  const location = useLocation();
  const db = useDatabase();
  const { updateStatus, addLog, user } = useStore();
  const order = db.orders.find((item) => item.id === orderId);
  const customer = db.customers.find((item) => item.id === order?.customerId);
  const device = db.devices.find((item) => item.id === order?.deviceId);
  const created = Boolean((location.state as { created?: boolean } | null)?.created);
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState('');
  const [visibleToCustomer, setVisibleToCustomer] = useState(false);
  const [logError, setLogError] = useState('');
  usePageTitle(order?.orderNumber ?? '找不到維修單');

  useEffect(() => {
    setNotice(created ? '維修單已建立。客戶需用完整單號與電話末四碼查詢。' : '');
    setDraft('');
    setLogError('');
  }, [orderId, location.key, created]);

  if (!order) {
    return (
      <div className="panel">
        <h1>找不到這張維修單</h1>
        <Link className="btn btn-primary" to="/orders">
          返回維修單
        </Link>
      </div>
    );
  }

  async function copyNumber() {
    try {
      await navigator.clipboard.writeText(order!.orderNumber);
      setNotice('已複製維修單號，可以傳給客戶。');
    } catch {
      setNotice('這個瀏覽器沒有開放剪貼簿，請手動選取單號。');
    }
  }

  async function changeStatus(status: RepairStatus) {
    if (!order || status === order.status) return;
    const ok = window.confirm(statusConfirmText(STATUS_LABEL[status]));
    if (!ok) return;
    try {
      await updateStatus(order.id, status);
      setNotice(`狀態已更新為「${STATUS_LABEL[status]}」。客戶查詢頁會看到這次變更。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '無法更新狀態');
    }
  }

  async function onAddLog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!order) return;
    if (!draft.trim()) {
      setLogError('請寫下做了什麼事或下了什麼指令');
      return;
    }
    try {
      await addLog(order.id, { content: draft, visibleToCustomer });
      setDraft('');
      setLogError('');
      setNotice(visibleToCustomer ? '已加入處理紀錄，客戶查詢頁看得到。' : '已加入內部處理紀錄。');
    } catch (error) {
      setLogError(error instanceof Error ? error.message : '無法新增紀錄');
    }
  }

  return (
    <>
      <nav className="crumb" aria-label="麵包屑">
        <Link to="/orders">維修單</Link>
        <span aria-hidden="true">/</span>
        <span>{order.orderNumber}</span>
      </nav>
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}
      <div className="page-head">
        <div>
          <p className="kicker">維修單</p>
          <h1 className="mono order-title">{order.orderNumber}</h1>
          <p className="lede">
            建立於 {formatDateTime(order.createdAt)} · 更新於 {formatDateTime(order.updatedAt)}
            {order.completedAt ? ` · 完成於 ${formatDateTime(order.completedAt)}` : ''}
          </p>
        </div>
        <div className="page-actions">
          <StatusBadge status={order.status} />
          <button type="button" className="btn btn-ghost" onClick={() => void copyNumber()}>
            複製單號
          </button>
          <Link className="btn btn-ghost" to={`/lookup?number=${encodeURIComponent(order.orderNumber)}`} target="_blank" rel="noreferrer">
            預覽客戶頁
          </Link>
        </div>
      </div>

      <section className="panel">
        <div className="section-head">
          <h2>狀態</h2>
          <p className="hint">紀錄人：{user?.username ?? '登入帳號'}</p>
        </div>
        <div className="status-switch" role="group" aria-label="更新狀態">
          {STATUS_ORDER.map((status) => (
            <button key={status} type="button" aria-pressed={order.status === status} onClick={() => changeStatus(status)}>
              {STATUS_LABEL[status]}
            </button>
          ))}
        </div>
        <p className="hint">變更狀態時會留下一筆客戶看得到的進度，並寫入狀態歷程。</p>
        {order.statusHistory && order.statusHistory.length > 0 ? (
          <ol className="status-history">
            {order.statusHistory.map((change) => (
              <li key={change.id}>
                <span className="muted">{formatDateTime(change.at)}</span> {change.fromStatus ? `${STATUS_LABEL[change.fromStatus]} → ` : ''}
                {STATUS_LABEL[change.toStatus]}
                <span className="muted"> · {change.author}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </section>

      <div className="detail-grid">
        <div className="stack">
          <section className="panel">
            <h2>送修內容</h2>
            <dl className="meta">
              <dt>類型</dt>
              <dd>{REPAIR_KIND_LABEL[order.repairKind]}</dd>
              <dt>項目</dt>
              <dd className="pre">{order.repairTarget}</dd>
              <dt>客戶需求</dt>
              <dd className="pre">{order.requirements.trim() ? order.requirements : <span className="muted">未填寫</span>}</dd>
            </dl>
          </section>

          <section className="panel">
            <h2>處理紀錄</h2>
            <ol className="timeline">
              {order.logs.map((entry) => (
                <li key={entry.id} className={entry.visibleToCustomer ? 'visible-log' : 'internal'}>
                  <div className="log-meta">
                    <span>{formatDateTime(entry.at)}</span>
                    <span>{entry.author}</span>
                    <span className="tag">{entry.visibleToCustomer ? '客戶可見' : '內部'}</span>
                    {entry.kind === 'status' ? <span className="tag">狀態</span> : null}
                  </div>
                  <p className="log-body">{entry.content}</p>
                </li>
              ))}
            </ol>
            <form className="log-form" onSubmit={onAddLog}>
              <label className="field">
                <span>新增紀錄</span>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={2000}
                  placeholder={'可記錄檢測指令、更換零件、與客戶確認的事項。\nCtrl + Enter 可直接新增。'}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                {logError ? <span className="field-error">{logError}</span> : null}
              </label>
              <label className="check">
                <input type="checkbox" checked={visibleToCustomer} onChange={(event) => setVisibleToCustomer(event.target.checked)} />
                <span>客戶可在查詢頁看到這段文字。請不要寫入密碼或內部指令。</span>
              </label>
              <button type="submit" className="btn btn-primary">
                新增處理紀錄
              </button>
            </form>
          </section>
        </div>

        <aside className="stack">
          <section className="panel">
            <h2>客戶</h2>
            {customer ? (
              <>
                <p className="side-title">
                  <Link to={`/customers/${customer.id}`}>{customer.name}</Link>
                </p>
                <p className="mono">公號 {customer.employeeNumber}</p>
                <p className="mono">{customer.ntAccount}</p>
                <p className="mono">{formatPhone(customer.phone)}</p>
                {customer.email ? <p>{customer.email}</p> : null}
                {customer.note ? <p className="hint">{customer.note}</p> : null}
                <Link to={`/orders?customer=${customer.id}`}>此客戶的維修單</Link>
              </>
            ) : (
              <p>未知客戶</p>
            )}
          </section>
          <section className="panel">
            <h2>設備</h2>
            {device ? (
              <>
                <p className="side-title">
                  <Link to={`/devices/${device.id}`}>{device.brand} {device.model}</Link>
                </p>
                <p>{deviceLabel(device)}</p>
                {device.serialNumber ? <p className="mono">{device.serialNumber}</p> : null}
                {device.note ? <p className="hint">{device.note}</p> : null}
                <Link to={`/orders?device=${device.id}`}>此設備的維修紀錄</Link>
              </>
            ) : (
              <p>未知設備</p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
