import { Link, useParams } from 'react-router-dom';
import { OrderTable } from '../components/OrderTable';
import { deviceLabel, formatDateTime, formatPhone } from '../lib/format';
import { usePageTitle } from '../lib/hooks';
import { sortOrders } from '../lib/db';
import { useStore } from '../lib/store';

export function CustomerDetailPage() {
  const { customerId } = useParams();
  const { db } = useStore();
  const customer = db.customers.find((item) => item.id === customerId);
  usePageTitle(customer?.name ?? '找不到客戶');
  if (!customer) {
    return (
      <div className="panel">
        <h1>找不到這位客戶</h1>
        <Link className="btn btn-primary" to="/customers">
          返回客戶
        </Link>
      </div>
    );
  }

  const devices = db.devices.filter((device) => device.customerId === customer.id);
  const orders = sortOrders(db.orders.filter((order) => order.customerId === customer.id));

  return (
    <>
      <nav className="crumb" aria-label="麵包屑">
        <Link to="/customers">客戶</Link>
        <span aria-hidden="true">/</span>
        <span>{customer.name}</span>
      </nav>
      <div className="page-head">
        <div>
          <p className="kicker">客戶</p>
          <h1>{customer.name}</h1>
          <p className="lede">建檔於 {formatDateTime(customer.createdAt)}</p>
        </div>
        <div className="page-actions">
          <Link className="btn btn-primary" to={`/orders/new?customer=${customer.id}`}>
            為此客戶建立維修單
          </Link>
        </div>
      </div>
      <div className="detail-grid">
        <section className="panel">
          <h2>聯絡方式</h2>
          <dl className="meta">
            <dt>電話</dt>
            <dd className="mono">{formatPhone(customer.phone)}</dd>
            <dt>電子郵件</dt>
            <dd>{customer.email ?? <span className="muted">未填寫</span>}</dd>
            <dt>備註</dt>
            <dd>{customer.note ?? <span className="muted">未填寫</span>}</dd>
          </dl>
        </section>
        <section className="panel">
          <h2>設備</h2>
          {devices.length === 0 ? (
            <p className="empty">尚未登錄設備。</p>
          ) : (
            <ul className="card-list">
              {devices.map((device) => (
                <li key={device.id}>
                  <Link to={`/devices/${device.id}`}>{deviceLabel(device)}</Link>
                  {device.serialNumber ? <span className="mono tiny">{device.serialNumber}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <section className="panel">
        <div className="section-head">
          <h2>維修單</h2>
          <Link to={`/orders?customer=${customer.id}`}>在列表中篩選</Link>
        </div>
        <OrderTable orders={orders} customers={db.customers} devices={db.devices} empty="這位客戶還沒有維修單。" />
      </section>
    </>
  );
}
