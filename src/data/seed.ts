import { formatOrderNumber, isEmployeeNumber, isNtAccount, taipeiCalendar } from '../lib/orderNumber';
import type { ActionLog, Customer, Database, Device, RepairOrder } from '../types';

function log(
  id: string,
  at: string,
  author: string,
  content: string,
  visibleToCustomer: boolean,
  kind: ActionLog['kind'] = 'note',
): ActionLog {
  return { id, at, author, content, visibleToCustomer, kind };
}

function makeOrder(order: Omit<RepairOrder, 'updatedAt' | 'statusHistory' | 'matches'>): RepairOrder {
  const lastLog = order.logs.at(-1);
  return { ...order, updatedAt: lastLog?.at ?? order.createdAt };
}

export function createSeed(): Database {
  const customers: Customer[] = [
    {
      id: 'cus-chen',
      name: '陳品妍',
      phone: '0912-334-567',
      email: 'pinyan@example.com',
      employeeNumber: '100001',
      ntAccount: 'CORP\\pinyan',
      note: '偏好週二、週四下午以後取件。',
      createdAt: '2026-03-02T10:00:00+08:00',
    },
    {
      id: 'cus-lin',
      name: '林承翰',
      phone: '0928-110-334',
      employeeNumber: '100002',
      ntAccount: 'CORP\\chenghan',
      note: '剪輯用機為主，取件前請先電話確認。',
      createdAt: '2026-05-18T10:00:00+08:00',
    },
    {
      id: 'cus-huang',
      name: '黃詩涵',
      phone: '0933-882-019',
      employeeNumber: '100003',
      ntAccount: 'CORP\\shihan',
      note: '學生，晚上六點後較容易聯絡。',
      createdAt: '2026-09-01T10:00:00+08:00',
    },
    {
      id: 'cus-zhang',
      name: '張家豪',
      phone: '0955-441-208',
      email: 'jiahao@example.com',
      employeeNumber: '100004',
      ntAccount: 'CORP\\jiahao',
      note: '舊零件請退回，不要代為回收。',
      createdAt: '2026-01-20T10:00:00+08:00',
    },
    {
      id: 'cus-wu',
      name: '吳佩琪',
      phone: '0918-667-452',
      employeeNumber: '100005',
      ntAccount: 'CORP\\peiqi',
      note: '請開立發票，抬頭「佩琪會計師事務所」。',
      createdAt: '2026-07-11T10:00:00+08:00',
    },
  ];

  const devices: Device[] = [
    {
      id: 'dev-zenbook',
      customerId: 'cus-chen',
      kind: 'laptop',
      brand: 'ASUS',
      model: 'Zenbook 14 OLED（UX3402）',
      serialNumber: 'UX3402-22918',
      createdAt: '2026-03-02T10:00:00+08:00',
    },
    {
      id: 'dev-diy',
      customerId: 'cus-chen',
      kind: 'desktop',
      brand: '自組',
      model: 'Ryzen 5 7600 / RTX 4060',
      serialNumber: 'DIY-CH-7781',
      note: '桌面資料夾「10月提案」是工作檔。',
      createdAt: '2026-06-12T10:00:00+08:00',
    },
    {
      id: 'dev-macbook',
      customerId: 'cus-lin',
      kind: 'laptop',
      brand: 'Apple',
      model: 'MacBook Pro 14（M3）',
      serialNumber: 'C02ZK19J',
      note: '客戶沒有備用備份。',
      createdAt: '2026-05-18T10:00:00+08:00',
    },
    {
      id: 'dev-imac',
      customerId: 'cus-lin',
      kind: 'aio',
      brand: 'Apple',
      model: 'iMac 24（M1）',
      serialNumber: 'IMAC-8821',
      createdAt: '2026-08-03T10:00:00+08:00',
    },
    {
      id: 'dev-acer',
      customerId: 'cus-huang',
      kind: 'laptop',
      brand: 'Acer',
      model: 'Swift Go 14',
      serialNumber: 'SFG14-55102',
      createdAt: '2026-09-01T10:00:00+08:00',
    },
    {
      id: 'dev-thinkpad',
      customerId: 'cus-zhang',
      kind: 'laptop',
      brand: 'Lenovo',
      model: 'ThinkPad T14 Gen 4',
      serialNumber: 'PF-4A88K2',
      createdAt: '2026-01-20T10:00:00+08:00',
    },
    {
      id: 'dev-benq',
      customerId: 'cus-zhang',
      kind: 'display',
      brand: 'BenQ',
      model: 'PD2705U',
      serialNumber: 'PD27-3301',
      createdAt: '2026-02-14T10:00:00+08:00',
    },
    {
      id: 'dev-hp',
      customerId: 'cus-wu',
      kind: 'desktop',
      brand: 'HP',
      model: 'ProDesk 400 G9',
      serialNumber: 'HP400-19C',
      note: '報稅主機，可借備機。',
      createdAt: '2026-07-11T10:00:00+08:00',
    },
  ];

  const orders: RepairOrder[] = [
    makeOrder({
      id: 'ord-2610001',
      orderDate: '20261027',
      serial: 1,
      orderNumber: 'WO-20261027-001',
      customerId: 'cus-chen',
      deviceId: 'dev-zenbook',
      repairKind: 'hardware',
      repairTarget: '鍵盤右側數鍵偶發失靈，觸控板點擊無反應',
      requirements: '下週三要帶去客戶簡報，希望週二前可取。請保留原系統與檔案，不要重灌。',
      status: 'received',
      createdAt: '2026-10-27T14:20:00+08:00',
      logs: [
        log(
          'log-2610001-1',
          '2026-10-27T14:22:00+08:00',
          '林可恩',
          '已受理。外觀無明顯摔傷或進液，已拍照存檔。客戶希望週二前可取，並保留原系統。',
          true,
        ),
        log(
          'log-2610001-2',
          '2026-10-27T16:05:00+08:00',
          '周予安',
          '拆開 C 件後，右側鍵盤排線插槽有氧化。\n觸控板排線重插仍無反應。\n建議更換鍵盤總成，尚未報價、尚未訂料。',
          false,
        ),
      ],
    }),
    makeOrder({
      id: 'ord-2610002',
      orderDate: '20261024',
      serial: 1,
      orderNumber: 'WO-20261024-001',
      customerId: 'cus-lin',
      deviceId: 'dev-macbook',
      repairKind: 'hardware',
      repairTarget: '無法開機，電源燈閃爍後熄滅；電池疑似膨脹',
      requirements: '內有未備份的剪輯專案，請先救援資料再維修。可聯絡本人確認零件費用。',
      status: 'in_progress',
      createdAt: '2026-10-24T11:05:00+08:00',
      logs: [
        log(
          'log-2610002-1',
          '2026-10-24T11:10:00+08:00',
          '林可恩',
          '已受理。客戶表示未備份剪輯專案，會先嘗試救援資料。',
          true,
        ),
        log(
          'log-2610002-2',
          '2026-10-24T15:40:00+08:00',
          '周予安',
          '電池有輕微膨脹，已先斷電隔離。資料救援進行中。',
          true,
        ),
        log(
          'log-2610002-3',
          '2026-10-25T10:18:00+08:00',
          '周予安',
          '斷開電池排線後，以外接電源可進入 DFU。\nApple Configurator 回報 error 4013。\n目標磁碟模式無法掛載，改將 NVMe 接上外接盒：\n\ndiskutil list\ndiskutil verifyVolume disk4s1\ndiskutil repairVolume disk4s1\n\n修復後可讀。已拷出影片：\nrsync -a "/Volumes/Macintosh HD - Data/Users/han/Movies" /repair/rescue/han/',
          false,
        ),
        log(
          'log-2610002-4',
          '2026-10-26T17:02:00+08:00',
          '周予安',
          '已下訂電池，預計 10/29 到貨。邏輯板待更換電池後再測。',
          false,
        ),
        log('log-2610002-5', '2026-10-26T17:05:00+08:00', '周予安', '狀態更新為「維修中」。', true, 'status'),
      ],
    }),
    makeOrder({
      id: 'ord-2610003',
      orderDate: '20261022',
      serial: 1,
      orderNumber: 'WO-20261022-001',
      customerId: 'cus-huang',
      deviceId: 'dev-acer',
      repairKind: 'software',
      repairTarget: 'Windows 11 系統重灌、驅動安裝與 OneDrive 資料還原',
      requirements: '保留 D 槽「專題_2026」。需要可使用 Office、Visual Studio Code。登入密碼客戶到店時再輸入，請勿寫進維修單。',
      status: 'ready',
      createdAt: '2026-10-22T13:10:00+08:00',
      logs: [
        log('log-2610003-1', '2026-10-22T13:16:00+08:00', '林可恩', '已受理系統重灌。會保留 D 槽專題資料。', true),
        log(
          'log-2610003-2',
          '2026-10-23T16:40:00+08:00',
          '許安晴',
          'diskpart → list disk → select disk 0 → clean\n僅清理系統碟。D 槽在 Disk 1，未更動。\n以 Windows 11 24H2 安裝完成。\nwinget install --id Microsoft.VisualStudioCode -e\nwinget install --id Git.Git -e\n「專題_2026」18.4 GB，抽樣開啟 .docx / .pptx 正常。',
          false,
        ),
        log(
          'log-2610003-3',
          '2026-10-27T18:05:00+08:00',
          '許安晴',
          '系統與專題資料已確認可開啟。請於營業時間攜帶身分證件取件。',
          true,
          'status',
        ),
      ],
    }),
    makeOrder({
      id: 'ord-2610004',
      orderDate: '20261015',
      serial: 1,
      orderNumber: 'WO-20261015-001',
      customerId: 'cus-zhang',
      deviceId: 'dev-thinkpad',
      repairKind: 'both',
      repairTarget: '更換 1TB NVMe，並遷移原系統與 Adobe 專案',
      requirements: '舊碟請退回，不要回收。Adobe 專案要能直接開啟。',
      status: 'completed',
      createdAt: '2026-10-15T10:00:00+08:00',
      completedAt: '2026-10-21T16:40:00+08:00',
      logs: [
        log('log-2610004-1', '2026-10-15T10:08:00+08:00', '林可恩', '已受理。舊碟會退還給客戶。', true),
        log(
          'log-2610004-2',
          '2026-10-16T14:22:00+08:00',
          '許安晴',
          'smartctl -H /dev/nvme0n1 → PASSED，可用備用空間剩 6%。\n以 Clonezilla 磁碟對磁碟複製到新的 1TB NVMe。\n開機後以 WinRE 修復開機紀錄。\nAdobe 暫存碟已改到新碟。舊碟裝袋，待退還客戶。',
          false,
        ),
        log('log-2610004-3', '2026-10-21T16:40:00+08:00', '許安晴', '新碟已完成遷移並交件，維修單結案。', true, 'status'),
      ],
    }),
    makeOrder({
      id: 'ord-2610005',
      orderDate: '20261026',
      serial: 1,
      orderNumber: 'WO-20261026-001',
      customerId: 'cus-wu',
      deviceId: 'dev-hp',
      repairKind: 'hardware',
      repairTarget: '開機後約三分鐘自動重啟，疑似記憶體或電源',
      requirements: '事務所月底報稅，請優先。若當天修不好，請先提供備機。發票抬頭「佩琪會計師事務所」。',
      status: 'in_progress',
      createdAt: '2026-10-26T09:30:00+08:00',
      logs: [
        log('log-2610005-1', '2026-10-26T09:36:00+08:00', '林可恩', '已受理開機重啟問題。月底報稅使用，會優先處理。', true),
        log(
          'log-2610005-2',
          '2026-10-26T15:20:00+08:00',
          '周予安',
          'memtest86+ 6.2，四條 DDR4 交叉測試。\nSlot A2（第三支 8GB）在 Test 7 出現錯誤。\n其餘記憶體單條與雙通道皆通過。\n暫以單通道開機，連續壓力測試 40 分鐘未重啟。\n已調貨 DDR4-3200 8GB，預計次日到貨。',
          false,
        ),
        log(
          'log-2610005-3',
          '2026-10-27T19:12:00+08:00',
          '周予安',
          '已找出故障記憶體，更換零件中。目前可暫時穩定開機。',
          true,
        ),
      ],
    }),
    makeOrder({
      id: 'ord-2610006',
      orderDate: '20261028',
      serial: 1,
      orderNumber: 'WO-20261028-001',
      customerId: 'cus-chen',
      deviceId: 'dev-diy',
      repairKind: 'software',
      repairTarget: '遊戲與剪輯軟體閃退，事件檢視器出現顯示卡驅動錯誤',
      requirements: '不要格式化。工作專案在桌面「10月提案」。遊戲與 Premiere 都會閃退。',
      status: 'received',
      createdAt: '2026-10-28T09:40:00+08:00',
      logs: [
        log('log-2610006-1', '2026-10-28T09:48:00+08:00', '林可恩', '已受理。會先備份桌面「10月提案」，不會格式化。', true),
        log(
          'log-2610006-2',
          '2026-10-28T10:10:00+08:00',
          '許安晴',
          '事件檢視器：Display driver nvlddmkm stopped responding\ndxdiag 驅動版本 32.0.15.6094\n已複製桌面「10月提案」到 D:\\RepairHold\\chen-diy\n計畫：安全模式執行 DDU 後安裝 Studio Driver，不格式化。',
          false,
        ),
      ],
    }),
    makeOrder({
      id: 'ord-2610007',
      orderDate: '20261025',
      serial: 1,
      orderNumber: 'WO-20261025-001',
      customerId: 'cus-lin',
      deviceId: 'dev-imac',
      repairKind: 'hardware',
      repairTarget: '外接螢幕無訊號，疑似 USB-C 擴充座',
      requirements: '只用來剪片，修好外接螢幕即可，不需升級系統。',
      status: 'ready',
      createdAt: '2026-10-25T15:00:00+08:00',
      logs: [
        log('log-2610007-1', '2026-10-25T15:08:00+08:00', '林可恩', '已受理外接螢幕無訊號。客戶不需升級系統。', true),
        log(
          'log-2610007-2',
          '2026-10-26T11:40:00+08:00',
          '許安晴',
          '內建螢幕正常。原 USB-C 擴充座的 HDMI 無輸出。\n改接店內擴充座後，外接 4K 60Hz 正常。\n已向客戶確認更換同型擴充座，不拆主機。',
          false,
        ),
        log(
          'log-2610007-3',
          '2026-10-28T11:20:00+08:00',
          '許安晴',
          '更換 USB-C 擴充座後，外接螢幕輸出正常，可以取件。',
          true,
          'status',
        ),
      ],
    }),
    makeOrder({
      id: 'ord-2610008',
      orderDate: '20261008',
      serial: 1,
      orderNumber: 'WO-20261008-001',
      customerId: 'cus-zhang',
      deviceId: 'dev-benq',
      repairKind: 'hardware',
      repairTarget: 'HDMI 無訊號檢修，並更新韌體與校色',
      requirements: '校色設定檔若能裝回客戶的 ThinkPad 更好。HDMI 線可一併檢查。',
      status: 'completed',
      createdAt: '2026-10-08T11:00:00+08:00',
      completedAt: '2026-10-10T17:30:00+08:00',
      logs: [
        log('log-2610008-1', '2026-10-08T11:12:00+08:00', '林可恩', '已受理螢幕無訊號與校色。', true),
        log(
          'log-2610008-2',
          '2026-10-09T14:05:00+08:00',
          '許安晴',
          'HDMI 與 DP 交叉測試，更換線材後有訊號。\n螢幕韌體更新至 V009。\n以 DisplayCAL 做快速校色，設定檔已匯入客戶的 ThinkPad。',
          false,
        ),
        log('log-2610008-3', '2026-10-10T17:30:00+08:00', '許安晴', '韌體與校色已完成，客戶已取回。', true, 'status'),
      ],
    }),
    makeOrder({
      id: 'ord-2610009',
      orderDate: '20261028',
      serial: 2,
      orderNumber: 'WO-20261028-002',
      customerId: 'cus-zhang',
      deviceId: 'dev-thinkpad',
      repairKind: 'hardware',
      repairTarget: '外接滑鼠時好時壞',
      requirements: '下午會來取筆電，滑鼠可先換一顆店內備用。',
      status: 'received',
      createdAt: '2026-10-28T15:10:00+08:00',
      logs: [
        log('log-2610009-1', '2026-10-28T15:12:00+08:00', '林可恩', '已受理。先更換接收器測試。', true),
        log(
          'log-2610009-2',
          '2026-10-28T15:40:00+08:00',
          '許安晴',
          '裝置管理員顯示 USB 裝置反覆重連。\npowercfg /devicequery wake_armed\n先不重灌，改接店內接收器後指標穩定。',
          false,
        ),
      ],
    }),
  ];

  const db: Database = { version: 1, customers, devices, orders };
  assertSeed(db);
  return db;
}

function assertSeed(db: Database) {
  const employees = new Set<string>();
  for (const customer of db.customers) {
    if (!isEmployeeNumber(customer.employeeNumber)) throw new Error(`工號不正確：${customer.name}`);
    if (employees.has(customer.employeeNumber)) throw new Error(`工號重複：${customer.employeeNumber}`);
    employees.add(customer.employeeNumber);
    if (!isNtAccount(customer.ntAccount)) throw new Error(`NT 帳號不正確：${customer.name}`);
  }
  const orderNumbers = new Set<string>();
  const daySerial = new Set<string>();
  for (const order of db.orders) {
    if (orderNumbers.has(order.orderNumber)) throw new Error(`單號重複：${order.orderNumber}`);
    orderNumbers.add(order.orderNumber);
    if (order.orderNumber !== formatOrderNumber(order.orderDate, order.serial)) {
      throw new Error(`單號格式不符：${order.orderNumber}`);
    }
    if (order.orderDate !== taipeiCalendar(new Date(order.createdAt)).compact) {
      throw new Error(`單號日期與建立時間不符：${order.orderNumber}`);
    }
    const key = `${order.orderDate}:${order.serial}`;
    if (daySerial.has(key)) throw new Error(`當日序號重複：${key}`);
    daySerial.add(key);
    if (!db.customers.some((customer) => customer.id === order.customerId)) {
      throw new Error(`維修單缺少客戶：${order.orderNumber}`);
    }
    const device = db.devices.find((item) => item.id === order.deviceId);
    if (!device || device.customerId !== order.customerId) {
      throw new Error(`設備與客戶不符：${order.orderNumber}`);
    }
    if (order.logs.length === 0) throw new Error(`缺少處理紀錄：${order.orderNumber}`);
    let previous = '';
    for (const entry of order.logs) {
      if (previous && entry.at < previous) throw new Error(`紀錄時間顛倒：${order.orderNumber}`);
      previous = entry.at;
    }
    const last = order.logs.at(-1);
    if (last && order.updatedAt !== last.at) throw new Error(`更新時間不符：${order.orderNumber}`);
    if (order.status === 'completed' && !order.completedAt) throw new Error(`缺少完成時間：${order.orderNumber}`);
    if (order.status !== 'completed' && order.completedAt) throw new Error(`未結案卻有完成時間：${order.orderNumber}`);
  }
  for (const device of db.devices) {
    if (!db.customers.some((customer) => customer.id === device.customerId)) {
      throw new Error(`設備沒有客戶：${device.id}`);
    }
  }
}
