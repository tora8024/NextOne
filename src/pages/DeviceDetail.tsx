import { Link, useParams } from 'react-router-dom';
import { OrderTable } from '../components/OrderTable';
import { sortOrders } from '../lib/db';
import { deviceLabel, formatDateTime } from '../lib/format';
import { usePageTitle } from '../lib/hooks';
import { useDatabase } from '../lib/store';

export function DeviceDetailPage() {
  const { deviceId } = useParams();
  const db = useDatabase();
  const device = db.devices.find((item) => item.id === deviceId);
  const customer = db.customers.find((item) => item.id === device?.customerId);
  usePageTitle(device ? `${device.brand} ${device.model}` : '找不到設備');

  if (!device) {
    return (
      <div className="panel">
        <h1>找不到這台設備</h1>
        <Link className="btn btn-primary" to="/devices">
          返回設備
        </Link>
      </div>
    );
  }

  const orders = sortOrders(db.orders.filter((order) => order.deviceId === device.id));

  return (
    <>
      <nav className="crumb" aria-label="麵包屑">
        <Link to="/devices">設備</Link>
        <span aria-hidden="true">/</span>
        <span>
          {device.brand} {device.model}
        </span>
      </nav>
      <div className="page-head">
        <div>
          <p className="kicker">設備</p>
          <h1>
            {device.brand} {device.model}
          </h1>
          <p className="lede">{deviceLabel(device)}</p>
        </div>
        <div className="page-actions">
          <Link className="btn btn-primary" to={`/orders/new?customer=${device.customerId}&device=${device.id}`}>
            為此設備建立維修單
          </Link>
        </div>
      </div>
      <section className="panel">
        <h2>資料</h2>
        <dl className="meta">
          <dt>客戶</dt>
          <dd>{customer ? <Link to={`/customers/${customer.id}`}>{customer.name}</Link> : '未知客戶'}</dd>
          <dt>序號</dt>
          <dd className="mono">{device.serialNumber ?? <span className="muted">未填寫</span>}</dd>
          <dt>登錄時間</dt>
          <dd>{formatDateTime(device.createdAt)}</dd>
          <dt>備註</dt>
          <dd>{device.note ?? <span className="muted">未填寫</span>}</dd>
        </dl>
      </section>
      <section className="panel">
        <div className="section-head">
          <h2>維修紀錄</h2>
          <Link to={`/orders?device=${device.id}`}>在列表中篩選</Link>
        </div>
        <OrderTable orders={orders} customers={db.customers} devices={db.devices} empty="這台設備還沒有維修單。" />
      </section>
    </>
  );
}
