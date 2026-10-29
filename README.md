# NextOne 維修台

電腦與設備維修單管理。店內人員登入後建立維修單、追蹤狀態、記錄檢測指令。客戶在這台電腦上打開查詢頁，用完整單號和電話末四碼看進度。介面為繁體中文。

這套程式只給本機使用。API 與網頁都綁在 `127.0.0.1`，不要改成 `0.0.0.0`，也不要把連接埠轉到區網。

## Stack

- [Vite](https://vite.dev/) 8、[React](https://react.dev/) 19、TypeScript、[React Router](https://reactrouter.com/) 7
- 本機 API：Node.js `node:sqlite`（SQLite）
- 資料檔：`data/repair.sqlite`（檔案權限 600）
- 字型：Noto Sans TC、IBM Plex Mono

SQLite 是單一檔案、不需另外安裝資料庫服務。維修資料放在 API 進程裡，而不是瀏覽器的 localStorage。

單號格式是 `維修單-YYYYMMDD-NNN`（台北時間）。日期與當日流水號分開存，並以 `(日期, 流水號)` 唯一。流水號用 `daily_serials` 計數表，在 `BEGIN IMMEDIATE` 交易裡做 `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`，同一天同時建立也不會拿到同一個號。每天從 001 開始，不滿 3 位補零，超過 999 就繼續加位數。客戶查詢也接受同等的 `WO-YYYYMMDD-NNN`（序號同樣要補齊）。

## Run locally

需要 Node.js 22 或以上。

```bash
npm install
npm run dev
```

這會同時啟動，而且只聽本機：

- API：<http://127.0.0.1:8787>
- 網頁：<http://127.0.0.1:5173>（`/api` 會轉到 API）

- 店內工作台：<http://127.0.0.1:5173/>（需登入）
- 客戶查詢：<http://127.0.0.1:5173/lookup>

第一次啟動若資料庫是空的，會寫入示範資料，並建立預設管理員。

檢查 API（搜尋、權限、並行取號、登入、還原封鎖、客戶查詢不得越權、速率限制）：

```bash
npm run check:api
```

## 登入

店內頁面需要登入。角色有 `admin`（管理員）與 `staff`（櫃檯人員）。客戶查詢頁不用登入。

資料庫第一次建立管理員時，帳號是 `admin`。密碼在當下隨機產生，印在執行 API 或 `npm run seed` 的主控台，不會寫進程式碼。請先抄下來。

```text
預設管理員帳號：admin
預設管理員密碼：<隨機密碼>
```

忘記密碼時，先停止 API，刪除 `data/repair.sqlite`、`data/repair.sqlite-wal`、`data/repair.sqlite-shm`，再重新啟動。新的密碼會再印一次。

登入成功後，瀏覽器只會拿到 `HttpOnly`、`SameSite=Strict` 的 session cookie。處理紀錄與狀態歷程的紀錄人是登入帳號，請求內容裡的名字不會被採用。

只有管理員可以「還原示範資料」。`NODE_ENV=production` 時這個功能會關閉。預設只建立管理員；`users` 表的 `role` 可以是 `staff`，但目前沒有另開帳號的畫面。

## 正式使用

不要用 `npm run dev` 對外或長期服務。開發伺服器會提供原始碼，`host: true` 時還能用 `/@fs/` 把 `data/repair.sqlite` 下載走。正式環境請用打包結果：

```bash
npm run build
NODE_ENV=production npm run start
npm run preview
```

- `npm run build` 產出 `dist/`
- `npm run start` 只啟動 API，綁定 `127.0.0.1:8787`
- `npm run preview` 用 `dist/` 提供網頁，綁定 `127.0.0.1:4173`，並把 `/api` 轉到 API

`NODE_ENV=production` 會停用還原示範資料。網頁與 API 都不要綁到 `0.0.0.0`。

## 資料庫與備份

預設檔案是專案目錄下的 `data/repair.sqlite`（程式會轉成絕對路徑），建立時設為 mode `600`。

要改位置時，環境變數必須是絕對路徑，相對路徑會被拒絕：

```bash
REPAIR_DB_PATH=/absolute/path/repair.sqlite npm run start
```

備份使用 SQLite `VACUUM INTO`，備份檔也會設為 `600`：

```bash
npm run backup -- /absolute/path/repair-backup.sqlite
```

## 查詢條件

店內維修單列表要先登入，仍可用公號、NT 帳號、建立日期與完整單號，條件有索引：

| 條件 | 店內（已登入） | 客戶查詢 |
| --- | --- | --- |
| 公號 | 正好 6 位數字時比對員工公號，並把所有維修單找出來。同一個數字也會當成流水號。 | 不接受 |
| 流水號 | `1`、`001`、`000001` 都對到當天序號 001。沒有日期時可能跨很多天。 | 不接受 |
| 完整單號 | `維修單-20261024-001` 精準比對。`維修單-20261024-1` 也會對到該日流水號 1。 | 必須是補齊的 `維修單-YYYYMMDD-NNN` 或 `WO-YYYYMMDD-NNN` |
| 電話末四碼 | 不需要 | 必須與客戶電話的末四碼一致，否則回空結果 |
| NT 帳號 | 不分大小寫。`chenghan`、`CORP\chenghan` 都比對帳號名稱。 | 不接受 |
| 日期 | 依維修單建立日（含起迄） | 不接受 |

客戶查詢只回傳狀態、送修摘要與標成客戶可見的進度，不回傳內部檢測指令、客戶備註或需求。單號與電話對不上時，回應與「沒有這張單」相同。查詢有每個 IP 的速率限制。

公號在這套示範資料裡當作 **6 位數員工／客戶編號**，不是電話，也不是整張單號。

## Demo

| 單號 | 客戶 | 公號 | 電話末四碼 | NT 帳號 | 狀態 |
| --- | --- | --- | --- | --- | --- |
| 維修單-20261024-001 | 林承翰 | 100002 | 0334 | CORP\chenghan | 維修中 |
| 維修單-20261025-001 | 林承翰 | 100002 | 0334 | CORP\chenghan | 待取件 |
| 維修單-20261028-001 | 陳品妍 | 100001 | 4567 | CORP\pinyan | 已受理 |
| 維修單-20261028-002 | 張家豪 | 100004 | 1208 | CORP\jiahao | 已受理 |

店內用公號 `100002` 會看到林承翰的兩張單。客戶查詢必須用完整單號再加電話末四碼，例如 `維修單-20261024-001` 與 `0334`，只會看到那一張。

## Project layout

- `server/` — SQLite schema、登入與 session、種子資料、查詢與 HTTP API
- `src/pages/` — 總覽、維修單、客戶、設備、登入、客戶查詢
- `src/data/seed.ts` — 示範資料
- `src/lib/orderNumber.ts` — 單號格式與公號／NT 帳號的比對規則
- `data/repair.sqlite` — 執行後產生，不進版控
