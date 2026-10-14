# 進金生能源 6692 ｜ 客戶太陽能電費單智能管理系統
> **AcmePoint Energy Customer Solar Feed-in Tariff Billing Database & Cloud Portal**  
> 具備 AI 智慧辨識 (OCR)、全文關鍵字檢索、派送清冊關聯、電費單 PDF 線上預覽下載，以及 Supabase 雲端資料庫／Storage 雙向串接。

🌐 **GitHub Pages 線上預覽入口**：[https://davidyeh51.github.io/acmepoint-electricity-bills/](https://davidyeh51.github.io/acmepoint-electricity-bills/)

---

## 🌟 核心功能特色

1. **AI 智慧辨識 (RapidOCR & PyMuPDF)**：
   - 自動提取台電「再生能源電能躉購電費通知單」中 25+ 項核心結構化欄位（電號、契約編號、用戶名稱、統編、帳單期別、計費期間、裝置容量、購電度數、躉購費率、各機組發電拆解明細、營業稅、電表租費、應付總金額、匯款銀行帳號等）。
2. **多維度關鍵字檢索**：
   - 支援依**案場名稱**（如：美傢、賴侯）、**電號**、**契約編號**、**設置地點**、**客戶名稱**、**統一編號**即時模糊搜尋。
3. **派送清冊一鍵貼上關聯**：
   - 收到每日派送 Email 通知時，直接將派送清冊文字貼上，系統自動識別電號並綁定案場名稱，永久記憶。
4. **電費單原檔線上預覽與下載**：
   - 列表提供一鍵下載 PDF 原檔；提供雙欄對照視窗（左側看 PDF，右側即時核對解析數據與各機組費率）。
5. **Excel 報表一鍵匯出**：
   - 支援將全庫或當前搜尋篩選結果導出為標準格式之 `.xlsx` 試算表。
6. **Supabase ✕ GitHub Pages 雲端雙向串接**：
   - 前端純靜態部署於 GitHub Pages，透過 `@supabase/supabase-js@2` 串接 Supabase PostgreSQL 與 Storage 儲存桶。
   - 本地端提供 Python 辨識引擎與離線 SQLite 備份。

---

## 🚀 雲端 Supabase 連線設定（快速上手）

本專案支援免後端純靜態直連 Supabase BaaS：

### 步驟 1：建立 Supabase 資料表與儲存桶
1. 前往 [Supabase Console](https://supabase.com/) 登入您的專案。
2. 進入左側選單的 **SQL Editor**。
3. 開啟本專案內的 [`supabase-schema.sql`](./supabase-schema.sql)，複製全文並貼上至 SQL Editor 點擊 **Run**。
   - 此腳本會自動建立 `public.electricity_bills` 資料表、`public.site_mappings` 案場對照表。
   - 強制啟用 **RLS (Row Level Security)** 行級安全防護。
   - 自動建立 `bills` 公開檔案儲存桶 (Storage Bucket)。
   - 寫入目前 2 筆案場種子資料。

### 步驟 2：在網頁介面啟用連線
1. 開啟 [GitHub Pages 網站](https://davidyeh51.github.io/acmepoint-electricity-bills/)。
2. 點擊頂部右上角的 **「本地展示模式 (點擊設定 Supabase)」** 狀態標籤。
3. 貼入您的 Supabase **Project URL** 與 **Anon Public Key**（於 Supabase Settings → API 取得）。
4. 點擊 **「儲存並測試連線」**，狀態將轉為 **🟢 Supabase 雲端已連線**！

---

## 💻 本地端運行指南

若您在辦公電腦需離線處理大量掃描件，可直接使用本機端運行：

### 1. 一鍵雙擊啟動 (Windows)
在資料夾內直接雙擊：
👉 `啟動電費單資料庫系統.bat`
將自動啟動本地伺服器並開啟瀏覽器至 `http://127.0.0.1:8501`。

### 2. 命令列工具 (`manage_bills.py`)
```bash
# 掃描資料夾內新加入的電費單 PDF 並自動辨識入庫
python manage_bills.py sync

# 條列資料庫中所有電費單記錄與累計 KPI
python manage_bills.py list

# 關鍵字檢索電費單
python manage_bills.py search 美傢

# 匯出資料庫至 Excel
python manage_bills.py export -o 客戶電費單清冊.xlsx

# 啟動 Web 服務
python manage_bills.py web --port 8501
```

---

## 📁 檔案結構說明

```
.
├── index.html                     # GitHub Pages 根目錄前端 (含 Supabase JS 整合)
├── supabase-client.js             # Supabase 客戶端模組與展示模式相容層
├── supabase-schema.sql            # Supabase PostgreSQL 資料表、RLS 政策與 Storage 設定腳本
├── manage_bills.py                # 本地 CLI 管理與同步腳本
├── 啟動電費單資料庫系統.bat         # Windows 一鍵啟動批次檔
├── 客戶電費單資料庫/
│   ├── electricity_bills.db       # 本地 SQLite 資料庫
│   ├── 08-40-8620-12-7_211307_1.pdf # 美傢家具鹿港廠1 電費單原檔
│   └── 10-56-4770-02-1_211458_1.pdf # 賴侯淑貞 電費單原檔
└── bill_system/                   # 本地 Python Starlette 後端與 RapidOCR 引擎
    ├── parser.py                  # 智慧電費單辨識模組
    ├── database.py                # 本地 SQLite 存取與 FTS5 檢索
    ├── sync_service.py            # 資料夾掃描與 SHA-256 去重服務
    └── server.py                  # 本地 API 伺服器
```

---
進金生能源服務股份有限公司 (AcmePoint Energy Services Co., Ltd. 6692) ｜ 運維管理部
