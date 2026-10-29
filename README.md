# NextOne 維修台

電腦與設備維修單管理。店內人員可建立維修單、追蹤狀態、記錄檢測指令；客戶用自己的手機打開查詢頁，看同一份資料庫裡的進度。介面為繁體中文。

## Stack

- [Vite](https://vite.dev/) 8、[React](https://react.dev/) 19、TypeScript、[React Router](https://reactrouter.com/) 7
- 本機 API：Node.js `node:sqlite`（SQLite）
- 資料檔：`data/repair.sqlite`
- 字型：Noto Sans TC、IBM Plex Mono

SQLite 是單一檔案、不需另外安裝資料庫服務，適合只在這台電腦上跑。維修資料放在 API 進程裡，而不是各瀏覽器的 localStorage，所以櫃台電腦和客戶手機只要連到同一個開發網址，看到的是同一批維修單。

單號格式是 `WO-YYYYMMDD-NNN`（台北時間）。日期與當日流水號分開存，並以 `(日期, 流水號)` 唯一。流水號用 `daily_serials` 計數表，在 `BEGIN IMMEDIATE` 交易裡做 `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`，同一天同時建立也不會拿到同一個號。每天從 001 開始，不滿 3 位補零，超過 999 就繼續加位數。

## Run locally

需要 Node.js 22 或以上。

```bash
npm install
npm run dev
```

這會同時啟動：

- API：<http://127.0.0.1:8787>
- 網頁：<http://localhost:5173>（`/api` 會轉到 API）

- 店內工作台：<http://localhost:5173/>
- 客戶查詢（沒有後台連結，也不會拿到內部指令）：<http://localhost:5173/lookup>

手機與櫃台要在同一個區網。用櫃台電腦的區網 IP 打開 `http://<電腦IP>:5173/lookup` 即可查到同一份資料。

第一次啟動若資料庫是空的，會自動寫入示範資料。要整份還原：

```bash
npm run seed
```

或在側邊欄按「還原示範資料」。

檢查 API 行為（搜尋、權限、並行取號）：

```bash
npm run check:api
```

打包前端：

```bash
npm run build
npm run start
npm run preview
```

`npm run start` 只開 API。`npm run preview` 預覽打包後的網頁（<http://localhost:4173>），同樣需要 API 在 8787。

## 查詢條件

店內維修單列表與客戶查詢都走後端，條件有索引：

| 條件 | 行為 |
| --- | --- |
| 工號 | 正好 6 位數字時，比對客戶的工號，並把所有維修單找出來。同一個數字也會當成流水號的數值（`1`、`001`、`000001` 都對到當天序號 001）。因為每天都會重來，沒有日期時可能跨很多天。 |
| 完整單號 | `WO-20261024-001` 精準比對，大小寫不拘。`WO-20261024-1` 也會對到該日流水號 1。 |
| NT 帳號 | 不分大小寫。`chenghan`、`CORP\chenghan` 都比對帳號名稱（`\` 後面那段），網域可省略。 |
| 日期 | 依維修單建立日（含起迄）。客戶查詢不能只填日期，必須再加上工號、單號或 NT 帳號。 |

店內列表會標出這張單是靠哪一個欄位對上的。客戶查詢只回傳狀態、送修摘要與標成客戶可見的進度，不回傳內部檢測指令、客戶備註或需求。

工號在這套示範資料裡當作 **6 位數員工／客戶編號**，不是電話，也不是整張單號。

## Demo

| 單號 | 客戶 | 工號 | NT 帳號 | 狀態 |
| --- | --- | --- | --- | --- |
| WO-20261024-001 | 林承翰 | 100002 | CORP\chenghan | 維修中 |
| WO-20261025-001 | 林承翰 | 100002 | CORP\chenghan | 待取件 |
| WO-20261028-001 | 陳品妍 | 100001 | CORP\pinyan | 已受理 |
| WO-20261028-002 | 張家豪 | 100004 | CORP\jiahao | 已受理 |

工號 `100002` 會看到林承翰的兩張單。只查流水號 `1` 會看到很多天的 001；加上 2026-10-24 就只剩 MacBook 那張。`WO-20261028-001` 與 `WO-20261028-002` 是同一天的 001、002。

## Project layout

- `server/` — SQLite schema、種子資料寫入、查詢與 HTTP API
- `src/pages/` — 總覽、維修單、客戶、設備、客戶查詢
- `src/data/seed.ts` — 示範資料
- `src/lib/orderNumber.ts` — 單號格式與工號／NT 帳號的比對規則
- `data/repair.sqlite` — 執行後產生，不進版控
