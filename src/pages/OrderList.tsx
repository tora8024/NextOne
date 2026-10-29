import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { OrderTable } from '../components/OrderTable';
import { PageHeader } from '../components/PageHeader';
import { api } from '../lib/api';
import { parseFullOrderNumber, toHalfWidth } from '../lib/orderNumber';
import { deviceLabel } from '../lib/format';
import { usePageTitle } from '../lib/hooks';
import { isRepairStatus, STATUS_LABEL, STATUS_ORDER } from '../lib/labels';
import { useDatabase, useStore } from '../lib/store';
import type { RepairOrder } from '../types';

export function OrderListPage() {
  const db = useDatabase();
  const { revision } = useStore();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [orders, setOrders] = useState<RepairOrder[]>([]);
  const [searchError, setSearchError] = useState('');
  const [numberHint, setNumberHint] = useState('');
  usePageTitle('維修單');

  const status = params.get('status') ?? '';
  const customerId = params.get('customer') ?? '';
  const deviceId = params.get('device') ?? '';
  const number = params.get('number') ?? '';
  const nt = params.get('nt') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';

  const customers = useMemo(
    () => [...db.customers].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')),
    [db.customers],
  );
  const deviceOptions = db.devices.filter((device) => !customerId || device.customerId === customerId);
  const selectedDevice = db.devices.find((device) => device.id === deviceId);
  const deviceChoices =
    selectedDevice && !deviceOptions.some((device) => device.id === selectedDevice.id)
      ? [selectedDevice, ...deviceOptions]
      : deviceOptions;

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key === 'customer' && value && deviceId) {
      const device = db.devices.find((item) => item.id === deviceId);
      if (device && device.customerId !== value) next.delete('device');
    }
    setParams(next, { replace: true });
  }

  useEffect(() => {
    const token = toHalfWidth(number).trim();
    const numberReady = !token || /^\d+$/.test(token) || parseFullOrderNumber(token) != null;
    if (!numberReady) {
      setNumberHint('完整單號請輸入到 維修單-YYYYMMDD-NNN，流水號則只輸入數字。');
      return;
    }
    setNumberHint('');
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (q.trim()) query.set('q', q.trim());
    if (status) query.set('status', status);
    if (customerId) query.set('customerId', customerId);
    if (deviceId) query.set('deviceId', deviceId);
    if (number.trim()) query.set('number', number.trim());
    if (nt.trim()) query.set('nt', nt.trim());
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    api<{ orders: RepairOrder[] }>(`/api/orders/search?${query.toString()}`, { signal: controller.signal })
      .then((result) => {
        setOrders(result.orders);
        setSearchError('');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setSearchError(error instanceof Error ? error.message : '查詢失敗');
      });
    return () => controller.abort();
  }, [q, status, customerId, deviceId, number, nt, from, to, revision]);

  const hasFilter = Boolean(q || status || customerId || deviceId || number || nt || from || to);

  return (
    <>
      <PageHeader
        kicker="追蹤"
        title="維修單"
        lede="可用公號、NT 帳號、建立日期，或完整單號查詢。公號也會比對當天流水號。"
        actions={
          <Link className="btn btn-primary" to="/orders/new">
            建立維修單
          </Link>
        }
      />
      <div className="toolbar">
        <label className="field">
          <span>關鍵字</span>
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="客戶、電話、型號或送修內容" />
        </label>
        <label className="field">
          <span>狀態</span>
          <select value={isRepairStatus(status) || status === 'open' || status === '' ? status : ''} onChange={(event) => updateParam('status', event.target.value)}>
            <option value="">全部狀態</option>
            <option value="open">未結案</option>
            {STATUS_ORDER.map((item) => (
              <option key={item} value={item}>
                {STATUS_LABEL[item]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>客戶</span>
          <select value={customerId} onChange={(event) => updateParam('customer', event.target.value)}>
            <option value="">全部客戶</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name} · {customer.employeeNumber}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>設備</span>
          <select value={deviceId} onChange={(event) => updateParam('device', event.target.value)}>
            <option value="">全部設備</option>
            {deviceChoices.map((device) => (
              <option key={device.id} value={device.id}>
                {deviceLabel(device)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="toolbar">
        <label className="field">
          <span>公號或單號</span>
          <input value={number} onChange={(event) => updateParam('number', event.target.value)} placeholder="100002 或 維修單-20261024-001" inputMode="text" />
        </label>
        <label className="field">
          <span>NT 帳號</span>
          <input value={nt} onChange={(event) => updateParam('nt', event.target.value)} placeholder="chenghan 或 CORP\chenghan" spellCheck={false} />
        </label>
        <label className="field">
          <span>建立日起</span>
          <input type="date" value={from} onChange={(event) => updateParam('from', event.target.value)} />
        </label>
        <label className="field">
          <span>建立日迄</span>
          <input type="date" value={to} onChange={(event) => updateParam('to', event.target.value)} />
        </label>
      </div>
      <p className="hint">
        6 位公號會找到該員工的全部維修單，也會把數字當成當日流水號（1、001、000001 都對到 001）。流水號每天從 001 重來，所以常會跨日命中，可加上日期範圍。NT 帳號不分大小寫，網域可省略。
      </p>
      {numberHint ? <p className="hint">{numberHint}</p> : null}
      {searchError ? (
        <p className="form-error" role="alert">
          {searchError}
        </p>
      ) : null}
      <section className="panel">
        <div className="section-head">
          <p className="result-count">共 {orders.length} 張</p>
          {hasFilter ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setQ('');
                setParams(new URLSearchParams(), { replace: true });
              }}
            >
              清除篩選
            </button>
          ) : null}
        </div>
        <OrderTable orders={orders} customers={db.customers} devices={db.devices} />
      </section>
    </>
  );
}
