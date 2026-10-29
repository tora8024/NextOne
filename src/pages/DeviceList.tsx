import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { useRowNavigate } from '../components/useRowNavigate';
import { sortOrders } from '../lib/db';
import { usePageTitle } from '../lib/hooks';
import { DEVICE_KIND_LABEL } from '../lib/labels';
import { useDatabase } from '../lib/store';

export function DeviceListPage() {
  const db = useDatabase();
  const rowNavigate = useRowNavigate();
  usePageTitle('設備');
  const latestByDevice = new Map<string, (typeof db.orders)[number]>();
  for (const order of sortOrders(db.orders)) {
    if (!latestByDevice.has(order.deviceId)) latestByDevice.set(order.deviceId, order);
  }
  const devices = [...db.devices].sort((a, b) => `${a.brand}${a.model}`.localeCompare(`${b.brand}${b.model}`, 'zh-Hant'));

  return (
    <>
      <PageHeader
        kicker="設備"
        title="設備"
        lede="店內登錄的電腦與周邊。點進去可看這台設備的全部維修紀錄。"
        actions={
          <Link className="btn btn-primary" to="/orders/new">
            建立維修單
          </Link>
        }
      />
      <section className="panel">
        <div className="table-wrap">
        <table className="data-table responsive" aria-label="設備">
          <thead>
            <tr>
              <th scope="col">設備</th>
              <th scope="col">類型</th>
              <th scope="col">客戶</th>
              <th scope="col">序號</th>
              <th scope="col">最近狀態</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => {
              const customer = db.customers.find((item) => item.id === device.customerId);
              const latest = latestByDevice.get(device.id);
              const repairCount = db.orders.filter((order) => order.deviceId === device.id).length;
              return (
                <tr key={device.id} {...rowNavigate(`/devices/${device.id}`, `開啟設備 ${device.brand} ${device.model}`)}>
                  <td data-label="設備">
                    <strong>
                      {device.brand} {device.model}
                    </strong>
                    <span className="muted tiny">{repairCount} 張維修單</span>
                  </td>
                  <td data-label="類型">{DEVICE_KIND_LABEL[device.kind]}</td>
                  <td data-label="客戶">{customer?.name ?? '未知客戶'}</td>
                  <td data-label="序號" className="mono">
                    {device.serialNumber ?? '—'}
                  </td>
                  <td data-label="最近狀態">{latest ? <StatusBadge status={latest.status} /> : <span className="muted">尚無維修單</span>}</td>
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
