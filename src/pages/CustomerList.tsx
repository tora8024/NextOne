import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { formatPhone } from '../lib/format';
import { usePageTitle } from '../lib/hooks';
import { useDatabase } from '../lib/store';
import { useRowNavigate } from '../components/useRowNavigate';

export function CustomerListPage() {
  const db = useDatabase();
  const rowNavigate = useRowNavigate();
  usePageTitle('客戶');
  const customers = [...db.customers].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));

  return (
    <>
      <PageHeader
        kicker="客戶"
        title="客戶"
        lede="每位客戶名下的設備與維修單。新客戶可在建立維修單時一併登錄。"
        actions={
          <Link className="btn btn-primary" to="/orders/new">
            建立維修單
          </Link>
        }
      />
      <section className="panel">
        <div className="table-wrap">
        <table className="data-table responsive" aria-label="客戶">
          <thead>
            <tr>
              <th scope="col">客戶</th>
              <th scope="col">公號</th>
              <th scope="col">NT 帳號</th>
              <th scope="col">電話</th>
              <th scope="col">設備</th>
              <th scope="col">未結案</th>
              <th scope="col">全部維修單</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => {
              const devices = db.devices.filter((device) => device.customerId === customer.id).length;
              const orders = db.orders.filter((order) => order.customerId === customer.id);
              const open = orders.filter((order) => order.status !== 'completed').length;
              return (
                <tr key={customer.id} {...rowNavigate(`/customers/${customer.id}`, `開啟客戶 ${customer.name}`)}>
                  <td data-label="客戶">
                    <strong>{customer.name}</strong>
                    {customer.note ? <span className="muted tiny">{customer.note}</span> : null}
                  </td>
                  <td data-label="公號" className="mono">
                    {customer.employeeNumber}
                  </td>
                  <td data-label="NT 帳號" className="mono">
                    {customer.ntAccount}
                  </td>
                  <td data-label="電話" className="mono">
                    {formatPhone(customer.phone)}
                  </td>
                  <td data-label="設備">{devices}</td>
                  <td data-label="未結案">{open}</td>
                  <td data-label="全部維修單">{orders.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </section>
    </>
  );
}
