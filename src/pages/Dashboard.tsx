import { Link } from 'react-router-dom';
import { OrderTable } from '../components/OrderTable';
import { PageHeader } from '../components/PageHeader';
import { recentActivity, sortOrders } from '../lib/db';
import { deviceKindSummary, formatDateTime, formatLongDate } from '../lib/format';
import { usePageTitle } from '../lib/hooks';
import { STATUS_LABEL, STATUS_ORDER } from '../lib/labels';
import { useStore } from '../lib/store';

export function DashboardPage() {
  const { db } = useStore();
  usePageTitle('總覽');
  const openOrders = sortOrders(db.orders.filter((order) => order.status !== 'completed'));
  const activity = recentActivity(db.orders, 6);

  return (
    <>
      <PageHeader
        kicker="工作台"
        title="總覽"
        lede={`${formatLongDate(new Date())}。這裡看店內設備與每張維修單的進度。資料保存在這個瀏覽器，側邊欄可還原示範資料。`}
        actions={
          <Link className="btn btn-primary" to="/orders/new">
            建立維修單
          </Link>
        }
      />

      <section className="stat-grid" aria-label="數量">
        <Link className="stat-card primary" to="/devices">
          <p className="kicker">設備總數</p>
          <p className="stat-value">{db.devices.length}</p>
          <p className="stat-foot">{deviceKindSummary(db.devices) || '尚未登錄設備'}</p>
        </Link>
        <Link className="stat-card" to="/customers">
          <p className="kicker">客戶</p>
          <p className="stat-value">{db.customers.length}</p>
          <p className="stat-foot">已建檔的送修客戶</p>
        </Link>
        <Link className="stat-card" to="/orders?status=open">
          <p className="kicker">未結案</p>
          <p className="stat-value">{openOrders.length}</p>
          <p className="stat-foot">不含已完成的維修單</p>
        </Link>
      </section>

      <section className="status-grid" aria-label="依狀態">
        {STATUS_ORDER.map((status) => {
          const count = db.orders.filter((order) => order.status === status).length;
          return (
            <Link key={status} className="status-card" to={`/orders?status=${status}`}>
              <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>
              <strong>{count}</strong>
            </Link>
          );
        })}
      </section>

      <section className="panel">
        <div className="section-head">
          <h2>尚未完成</h2>
          <Link to="/orders?status=open">查看全部</Link>
        </div>
        <OrderTable orders={openOrders.slice(0, 6)} customers={db.customers} devices={db.devices} empty="目前沒有未結案的維修單。" />
      </section>
      <section className="panel">
        <div className="section-head">
          <h2>最近的處理紀錄</h2>
        </div>
        {activity.length === 0 ? (
          <p className="empty">還沒有處理紀錄。</p>
        ) : (
          <div className="activity activity-grid">
            {activity.map((item) => (
              <Link key={item.log.id} to={`/orders/${item.orderId}`} className="activity-item">
                <span className="log-meta">
                  <span className="mono">{item.orderNumber}</span>
                  <span>{formatDateTime(item.log.at)}</span>
                  <span>{item.log.author}</span>
                  <span className="tag">{item.log.visibleToCustomer ? '客戶可見' : '內部'}</span>
                </span>
                <span className="clamp-3">{item.log.content}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
