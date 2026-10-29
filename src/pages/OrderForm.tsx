import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { normalizePhone } from '../lib/format';
import { usePageTitle, useTechnician } from '../lib/hooks';
import { DEVICE_KIND_LABEL, DEVICE_KINDS, REPAIR_KIND_LABEL, REPAIR_KINDS } from '../lib/labels';
import { isEmployeeNumber, isNtAccount, toHalfWidth } from '../lib/orderNumber';
import { useDatabase, useStore } from '../lib/store';
import type { DeviceKind, RepairKind } from '../types';

export function OrderFormPage() {
  const db = useDatabase();
  const { createOrder } = useStore();
  const navigate = useNavigate();
  const [author, setAuthor] = useTechnician();
  usePageTitle('建立維修單');

  const [params] = useSearchParams();
  const presetCustomer = params.get('customer');
  const presetDevice = db.devices.find((device) => device.id === params.get('device'));
  const initialCustomerId =
    presetDevice?.customerId ??
    (presetCustomer && db.customers.some((customer) => customer.id === presetCustomer) ? presetCustomer : (db.customers[0]?.id ?? ''));

  const [customerMode, setCustomerMode] = useState<'existing' | 'new'>(initialCustomerId ? 'existing' : 'new');
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [customerNote, setCustomerNote] = useState('');
  const [employeeNumber, setEmployeeNumber] = useState('');
  const [ntAccount, setNtAccount] = useState('');
  const [saving, setSaving] = useState(false);

  const [deviceMode, setDeviceMode] = useState<'existing' | 'new'>('existing');
  const [deviceId, setDeviceId] = useState(() => {
    if (presetDevice && presetDevice.customerId === initialCustomerId) return presetDevice.id;
    return db.devices.find((device) => device.customerId === initialCustomerId)?.id ?? '';
  });
  const [kind, setKind] = useState<DeviceKind>('laptop');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [deviceNote, setDeviceNote] = useState('');

  const [repairKind, setRepairKind] = useState<RepairKind>('hardware');
  const [repairTarget, setRepairTarget] = useState('');
  const [requirements, setRequirements] = useState('');
  const [initialLog, setInitialLog] = useState('');
  const [initialLogVisible, setInitialLogVisible] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const customers = useMemo(
    () => [...db.customers].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')),
    [db.customers],
  );
  const owned = useMemo(
    () => db.devices.filter((device) => device.customerId === customerId),
    [db.devices, customerId],
  );
  const forceNewDevice = customerMode === 'new' || owned.length === 0;
  const creatingDevice = forceNewDevice || deviceMode === 'new';
  const selectedCustomer = customers.find((customer) => customer.id === customerId);

  useEffect(() => {
    if (customerMode !== 'existing') return;
    const first = owned[0];
    if (!first) {
      setDeviceId('');
      return;
    }
    setDeviceId((current) => (owned.some((device) => device.id === current) ? current : first.id));
  }, [customerMode, owned]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (customerMode === 'existing') {
      if (!customerId) nextErrors.customer = '請選擇客戶';
    } else {
      if (!name.trim()) nextErrors.name = '請填寫客戶姓名';
      if (normalizePhone(phone).length < 8) nextErrors.phone = '請填寫有效的聯絡電話';
      if (!isEmployeeNumber(toHalfWidth(employeeNumber).trim())) nextErrors.employeeNumber = '工號必須是 6 位數字';
      if (!isNtAccount(ntAccount.trim())) nextErrors.ntAccount = '請填寫 NT 帳號，例如 CORP\\pinyan';
      if (email.trim() && !email.includes('@')) nextErrors.email = '電子郵件格式不正確';
    }
    if (!creatingDevice) {
      if (!deviceId) nextErrors.device = '請選擇設備';
    } else if (!brand.trim() || !model.trim()) {
      nextErrors.deviceName = '請填寫品牌與型號';
    }
    if (!repairTarget.trim()) nextErrors.repairTarget = '請描述送修的硬體或軟體';
    if (Object.keys(nextErrors).length > 0) {
      setErrors({ ...nextErrors, form: '請先修正表單中的欄位。' });
      return;
    }

    try {
      setSaving(true);
      const order = await createOrder({
        customer:
          customerMode === 'existing'
            ? { mode: 'existing', id: customerId }
            : {
                mode: 'new',
                name: name.trim(),
                phone: phone.trim(),
                email: email.trim() || undefined,
                note: customerNote.trim() || undefined,
                employeeNumber: toHalfWidth(employeeNumber).trim(),
                ntAccount: ntAccount.trim(),
              },
        device: creatingDevice
          ? {
              mode: 'new',
              kind,
              brand,
              model,
              serialNumber,
              note: deviceNote,
            }
          : { mode: 'existing', id: deviceId },
        repairKind,
        repairTarget,
        requirements,
        initialLog,
        initialLogVisible,
        author,
      });
      navigate(`/orders/${order.id}`, { state: { created: true } });
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : '無法建立維修單' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="narrow" onSubmit={onSubmit} noValidate>
      <PageHeader
        kicker="受理"
        title="建立維修單"
        lede="新客戶要填 6 位數工號與 NT 帳號。單號依台北時間當天自動編號，例如 WO-20261029-001，隔日從 001 重新開始。"
      />
      {errors.form ? (
        <p className="form-error" role="alert">
          {errors.form}
        </p>
      ) : null}

      <section className="panel">
        <h2>客戶</h2>
        <fieldset>
          <legend className="sr-only">客戶來源</legend>
          <div className="choice-row" role="radiogroup" aria-label="客戶來源">
            <label className={customerMode === 'existing' ? 'choice active' : 'choice'}>
              <input type="radio" name="customerMode" checked={customerMode === 'existing'} onChange={() => setCustomerMode('existing')} disabled={customers.length === 0} />
              既有客戶
            </label>
            <label className={customerMode === 'new' ? 'choice active' : 'choice'}>
              <input type="radio" name="customerMode" checked={customerMode === 'new'} onChange={() => setCustomerMode('new')} />
              新客戶
            </label>
          </div>
        </fieldset>
        {customerMode === 'existing' ? (
          <label className="field">
            <span>選擇客戶</span>
            <select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name} · {customer.employeeNumber}
                </option>
              ))}
            </select>
            {errors.customer ? <span className="field-error">{errors.customer}</span> : null}
            {selectedCustomer ? (
              <span className="hint">
                工號 {selectedCustomer.employeeNumber} · {selectedCustomer.ntAccount}
                {selectedCustomer.note ? ` · ${selectedCustomer.note}` : ''}
              </span>
            ) : null}
          </label>
        ) : (
          <div className="grid-2">
            <label className="field">
              <span>客戶姓名</span>
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} autoComplete="name" placeholder="例如 陳品妍" />
              {errors.name ? <span className="field-error">{errors.name}</span> : null}
            </label>
            <label className="field">
              <span>聯絡電話</span>
              <input value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={30} autoComplete="tel" inputMode="tel" placeholder="0912-334-567" />
              {errors.phone ? <span className="field-error">{errors.phone}</span> : null}
            </label>
            <label className="field">
              <span>工號</span>
              <input value={employeeNumber} onChange={(event) => setEmployeeNumber(event.target.value)} inputMode="numeric" maxLength={6} placeholder="6 位數字，例如 100006" />
              {errors.employeeNumber ? <span className="field-error">{errors.employeeNumber}</span> : null}
            </label>
            <label className="field">
              <span>NT 帳號</span>
              <input value={ntAccount} onChange={(event) => setNtAccount(event.target.value)} maxLength={80} placeholder="CORP\name 或 name" spellCheck={false} />
              {errors.ntAccount ? <span className="field-error">{errors.ntAccount}</span> : null}
            </label>
            <label className="field">
              <span>電子郵件（選填）</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} maxLength={80} autoComplete="email" inputMode="email" />
              {errors.email ? <span className="field-error">{errors.email}</span> : null}
            </label>
            <label className="field">
              <span>客戶備註（選填）</span>
              <input value={customerNote} onChange={(event) => setCustomerNote(event.target.value)} maxLength={200} placeholder="取件時間、發票抬頭等" />
            </label>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>設備</h2>
        {forceNewDevice ? (
          <p className="hint">{customerMode === 'new' ? '新客戶會一併登錄這台設備。' : '這位客戶還沒有設備，請先登錄。'}</p>
        ) : (
          <div className="choice-row" role="radiogroup" aria-label="設備來源">
            <label className={deviceMode === 'existing' ? 'choice active' : 'choice'}>
              <input type="radio" name="deviceMode" checked={deviceMode === 'existing'} onChange={() => setDeviceMode('existing')} />
              既有設備
            </label>
            <label className={deviceMode === 'new' ? 'choice active' : 'choice'}>
              <input type="radio" name="deviceMode" checked={deviceMode === 'new'} onChange={() => setDeviceMode('new')} />
              登錄新設備
            </label>
          </div>
        )}
        {!creatingDevice ? (
          <label className="field">
            <span>選擇設備</span>
            <select value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
              {owned.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.brand} {device.model}
                  {device.serialNumber ? ` · ${device.serialNumber}` : ''}
                </option>
              ))}
            </select>
            {errors.device ? <span className="field-error">{errors.device}</span> : null}
          </label>
        ) : (
          <>
            <fieldset>
              <legend>類型</legend>
              <div className="choice-row">
                {DEVICE_KINDS.map((item) => (
                  <label key={item} className={kind === item ? 'choice active' : 'choice'}>
                    <input type="radio" name="deviceKind" checked={kind === item} onChange={() => setKind(item)} />
                    {DEVICE_KIND_LABEL[item]}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid-2">
              <label className="field">
                <span>品牌</span>
                <input value={brand} onChange={(event) => setBrand(event.target.value)} maxLength={40} placeholder="例如 ASUS、Apple、Lenovo" />
              </label>
              <label className="field">
                <span>型號</span>
                <input value={model} onChange={(event) => setModel(event.target.value)} maxLength={80} placeholder="例如 Zenbook 14 OLED" />
              </label>
              <label className="field">
                <span>序號（選填）</span>
                <input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} maxLength={40} />
              </label>
              <label className="field">
                <span>設備備註（選填）</span>
                <input value={deviceNote} onChange={(event) => setDeviceNote(event.target.value)} maxLength={200} />
              </label>
            </div>
            {errors.deviceName ? <p className="field-error">{errors.deviceName}</p> : null}
          </>
        )}
      </section>

      <section className="panel">
        <h2>維修內容</h2>
        <fieldset>
          <legend>類型</legend>
          <div className="choice-row" role="radiogroup" aria-label="維修類型">
            {REPAIR_KINDS.map((item) => (
              <label key={item} className={repairKind === item ? 'choice active' : 'choice'}>
                <input type="radio" name="repairKind" checked={repairKind === item} onChange={() => setRepairKind(item)} />
                {REPAIR_KIND_LABEL[item]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="field">
          <span>送修項目</span>
          <textarea value={repairTarget} onChange={(event) => setRepairTarget(event.target.value)} maxLength={500} placeholder="例如 鍵盤局部失靈、無法開機、系統重灌" />
          {errors.repairTarget ? <span className="field-error">{errors.repairTarget}</span> : null}
        </label>
        <label className="field">
          <span>客戶需求與備註</span>
          <textarea value={requirements} onChange={(event) => setRequirements(event.target.value)} maxLength={2000} placeholder="希望保留的資料、取件時間、不要重灌等。這段只給店內看。" />
        </label>
      </section>

      <section className="panel">
        <h2>初步處理紀錄</h2>
        <label className="field">
          <span>紀錄人</span>
          <input value={author} onChange={(event) => setAuthor(event.target.value)} maxLength={40} />
        </label>
        <label className="field">
          <span>檢測指令或處理事項（選填）</span>
          <textarea
            value={initialLog}
            onChange={(event) => setInitialLog(event.target.value)}
            maxLength={2000}
            placeholder={'例如：\n外觀無進液。\nsmartctl -a /dev/nvme0n1'}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={initialLogVisible} onChange={(event) => setInitialLogVisible(event.target.checked)} />
          <span>客戶可在查詢頁看到這段紀錄。請不要寫入密碼或內部指令。</span>
        </label>
      </section>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? '建立中…' : '建立維修單'}
        </button>
      </div>
    </form>
  );
}
