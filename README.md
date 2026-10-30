# 進金生能源｜電費單管理系統

[開啟網站](https://davidyeh51.github.io/acmepoint-electricity-bills/)

GitHub Pages 提供介面，Supabase Auth、PostgreSQL RLS 與私人 Storage 提供登入、資料存取及 PDF 保護。本機 Python 服務提供相同帳號驗證與 RapidOCR 辨識。

## 帳號與權限

登入狀態使用專屬儲存鍵，與相同 GitHub Pages 網域的其他系統分開。以帳號及密碼登入；帳號在內部對應至專用的 Auth email alias，使用者不需要輸入電子郵件。

| 權限 | 功能 |
| --- | --- |
| 使用者 | 查詢、上傳、核對、修正、匯出帳單與檢視原始 PDF、修改自己的密碼 |
| 管理者 | 使用者全部功能，以及新增帳號、調整角色、啟用／停用帳號、重設密碼 |

角色與啟用狀態保存在 bill_app_users，由資料庫政策與帳號管理服務驗證。使用者不能修改自己的角色，也不能只靠更動瀏覽器儲存內容取得權限。停用帳號後，新的資料與檔案請求會被拒絕；先前核發的 PDF 短效網址最長有效五分鐘。

初始帳號為 davidyeh（管理者）及 ivychung（使用者）。初始密碼由管理者提供，不存放在原始碼。可使用右上角「修改密碼」變更。

## 辨識與核對

- 先依頁面座標重建 PDF 文字列；內容不完整時進行繁體中文與英文的整頁 OCR，支援多頁。
- 加總不同費率的全部機組，保留零發電量、負應付金額及舊式正數列示的表租扣款。
- 帳單年月取自通知單標題，計費起迄日期分開儲存。無法辨識日期時不以今天代填。
- 以機組、購電電費、營業稅、電費合計和扣款交叉核對。缺漏或不符的資料標記「待核對」。
- PDF 上傳或資料庫儲存失敗時顯示錯誤，不顯示已同步成功。
- 用電繳費憑證標記為 CONSUMPTION，不計入售電收益。維運費用試算等非帳單文件保留來源紀錄，排除帳單匯入。

## 部署與環境

前端不需要編譯，GitHub Pages 從 main 根目錄發布。瀏覽器端僅使用公開的 Supabase publishable／anon key；service role key 只由 Edge Function 環境提供。

新專案先執行 supabase-schema.sql。既有專案的變更來源分別保存在：

- sql/bill_app_users.sql
- sql/bill_document_types.sql
- sql/bill_access.sql

部署 supabase/functions/bill-account-admin/index.ts 為 bill-account-admin。函式自行以 Auth API 驗證 access token，再查詢本系統的有效管理者資格；未登入或一般使用者無法建立帳號。不提供公開註冊或初始化入口。

新的環境須由可信任管理者在 Supabase Auth Admin 介面／API 建立第一位使用者，並在 bill_app_users 加入對應的 UUID、帳號與管理者角色。後續帳號均可由網站內的帳號管理建立。不得將 service role key 或初始密碼寫入前端或提交到 Git。

PDF 原檔、SQLite、OCR 暫存、資料匯入清單與瀏覽器測試輸出已排除於 Git；原檔改存於私人 bills bucket，登入後產生短效下載網址。過去公開版本的 Git 歷史不會因新版本權限而自動消失。

## 本機執行

Python 3.10+：

~~~powershell
python -m pip install -r requirements.txt
python -m uvicorn bill_system.server:app --host 127.0.0.1 --port 8501
~~~

介面直接使用雲端帳號與資料；本機 /api/* 和原始檔路徑也需要有效的 Supabase bearer token。修改專案時可透過 SUPABASE_URL、SUPABASE_PUBLISHABLE_KEY 指定連線。

~~~powershell
node --test tests/recognition.test.cjs
python -m unittest discover -s tests
~~~

## 批次匯入

scripts/prepare_sources.py 使用本機 PDF 轉 Markdown 技能，將繁體 Markdown 與圖片放在來源旁，並保留 PDF。以 BILLS_SOURCE_ROOT 指定兩個案場共用的父目錄；輸出先放在唯一暫存目錄。

scripts/prepare_bill_import.py 使用四個有界工作程序辨識，於 .system_generated/ 留下可恢復的快取、錯誤、重複及待核對清單。匯入前需審核清單；不要直接將原始資料加入 GitHub Pages。
\n完成 OCR 後，以 scripts/audit_bill_import.py 重新套用目前解析規則，檢查重複、期別衝突與非帳單文件。通過後，以 scripts/import_bills.py <已審核清單.json> 寫入私人儲存桶；密碼僅透過程序環境變數 BILLS_PASSWORD 提供。\n
## 案場發電與收益趨勢

「案場發電與收益趨勢」分頁以電號選取案場，獨立分頁讀取全部歷史帳單，不受主清單搜尋條件影響。提供計費期／年度三張趨勢圖、未稅售電收入／含稅應付淨額切換、機組與 PDF 核對，以及四分頁 Excel 匯出。

每日峰瓦值＝Σ購電度數／Σ（各期帳單容量 × 含起迄日的計費天數），單位 kWh/kW/日。採帳單容量，不代表已確認模組 DC 銘牌容量；購電度數是售電量，不等於逆變器總發電量或 PR。

全年參考基準僅使用完整覆蓋 365／366 天的曆年，並以 365 日標準化。跨年帳單按日均勻分攤；不是每日實測。首尾未滿年度、缺漏、無效或待核對資料不偽補為零。重複帳單去重，有疑義的不同重疊帳單先排除；用電／輸電支出不計入售電收入。匯入稽核會另外標示來源資料夾與 PDF 電號不符的檔案。

試算可輸入評估容量、保留比例及平均／最低完整年度基準。歷年最低值不代表 P90；頁面不提供氣象不確定性、衰退或可用率模型，也不將參考試算宣稱為已驗證的保證發電量。

驗證：node --test tests/trends.test.cjs。計算核心 trends-core.js 可獨立測試；plant-trends.js 處理登入、資料載入與畫面，登出時清除分析狀態。
