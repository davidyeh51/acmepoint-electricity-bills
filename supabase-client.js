/**
 * 進金生能源 6692 ｜ 客戶太陽能電費單管理系統
 * Supabase 集中管理模組 ＆ 本地離線儲存引擎 (Vanilla JS for GitHub Pages & Local Server)
 */

// 1. IndexedDB 離線 PDF 儲存引擎（解決瀏覽器端上傳之 PDF 原檔儲存與即時預覽、下載）
const PdfStorageDB = {
  db: null,
  async getDB() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('AcmePointBillsDB', 2);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('pdfFiles')) {
          db.createObjectStore('pdfFiles');
        }
      };
      req.onsuccess = e => {
        this.db = e.target.result;
        resolve(this.db);
      };
      req.onerror = e => reject(e);
    });
  },
  async savePdf(filename, blob) {
    if (!blob) return;
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('pdfFiles', 'readwrite');
        tx.objectStore('pdfFiles').put(blob, filename);
        tx.oncomplete = () => resolve(true);
        tx.onerror = e => reject(e);
      });
    } catch(e) {
      console.warn('PdfStorageDB save failed:', e);
    }
  },
  async getPdf(filename) {
    if (!filename) return null;
    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('pdfFiles', 'readonly');
        const req = tx.objectStore('pdfFiles').get(filename);
        req.onsuccess = e => resolve(e.target.result || null);
        req.onerror = () => resolve(null);
      });
    } catch(e) {
      return null;
    }
  }
};

// 2. 初始展示種子資料 (Fallback Seed Bills)


// 預設專案連線設定（全團隊開箱即用，免任何手動配置）
window.DEFAULT_SUPABASE_CONFIG = window.DEFAULT_SUPABASE_CONFIG || {
  url: 'https://cowljafosekwvxithwjd.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvd2xqYWZvc2Vrd3Z4aXRod2pkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NTYzODcsImV4cCI6MjA5NDIzMjM4N30.c8YXP7EXDeTOw-mJEmnYZ_DJeZv6Qt6HVDzEf8J2K_I'
};

let supabaseInstance = null;

const SupabaseBillService = {
  // 自動解析 URL 邀請參數或 LocalStorage 中的設定
  getStoredConfig() {
    try {
      // 支援網址帶入 #sb_url=...&sb_key=... 或 ?sb_url=...&sb_key=...
      const rawHash = window.location.hash.replace(/^#/, '');
      const rawSearch = window.location.search.replace(/^\?/, '');
      const searchStr = rawHash.includes('sb_url') ? rawHash : (rawSearch.includes('sb_url') ? rawSearch : '');
      
      if (searchStr.includes('sb_url')) {
        const params = new URLSearchParams(searchStr);
        const pUrl = params.get('sb_url');
        const pKey = params.get('sb_key');
        if (pUrl && pKey) {
          localStorage.setItem('SB_URL', pUrl.trim());
          localStorage.setItem('SB_ANON_KEY', pKey.trim());
          // 清除網址雜訊以保護憑證安全
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }
    } catch (e) {
      console.warn("URL params parse note:", e);
    }

    // 預設進金生能源團隊共用 Supabase 雲端憑證 (團隊同仁免手動設定，開箱即用同步)
    const DEFAULT_URL = 'https://cowljafosekwvxithwjd.supabase.co';
    const DEFAULT_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvd2xqYWZvc2Vrd3Z4aXRod2pkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NTYzODcsImV4cCI6MjA5NDIzMjM4N30.c8YXP7EXDeTOw-mJEmnYZ_DJeZv6Qt6HVDzEf8J2K_I';

    const defCfg = window.DEFAULT_SUPABASE_CONFIG || window.SUPABASE_CONFIG || {};
    const localUrl = localStorage.getItem('SB_URL');
    const localKey = localStorage.getItem('SB_ANON_KEY');
    return {
      url: (localUrl && localUrl.trim()) ? localUrl.trim() : (defCfg.url || DEFAULT_URL),
      anonKey: (localKey && localKey.trim()) ? localKey.trim() : (defCfg.anonKey || DEFAULT_ANON_KEY)
    };
  },

  isConfigured() {
    const cfg = this.getStoredConfig();
    return !!(cfg.url && cfg.anonKey && supabaseInstance);
  },

  getClient() {
    return supabaseInstance;
  },

  init(url, anonKey) {
    if (!url || !anonKey) {
      const cfg = this.getStoredConfig();
      url = cfg.url;
      anonKey = cfg.anonKey;
    }

    if (url && anonKey && window.supabase) {
      try {
        supabaseInstance = window.supabase.createClient(url.trim(), anonKey.trim(), { auth: { storageKey: 'acmepoint-bills-auth-v1', persistSession: true, autoRefreshToken: true } });
        localStorage.setItem('SB_URL', url.trim());
        localStorage.setItem('SB_ANON_KEY', anonKey.trim());
        

        return supabaseInstance;
      } catch (e) {
        console.error("Supabase client init failed:", e);
        supabaseInstance = null;
      }
    }
    return null;
  },

  disconnect() {
    localStorage.removeItem('SB_URL');
    localStorage.removeItem('SB_ANON_KEY');
    supabaseInstance = null;
  },

  // 取得使用者透過瀏覽器上傳並儲存於本機之電費單清單
  getLocalBills() {
    try {
      const s = localStorage.getItem('CUSTOM_LOCAL_BILLS');
      return s ? JSON.parse(s) : [];
    } catch(e) {
      return [];
    }
  },

  // 儲存至本機 LocalStorage（持久化儲存）
  saveLocalBill(bill) {
    const list = this.getLocalBills();
    const idx = list.findIndex(b => b.filename === bill.filename || (b.id && b.id === bill.id));
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...bill };
    } else {
      list.unshift(bill);
    }
    localStorage.setItem('CUSTOM_LOCAL_BILLS', JSON.stringify(list));
  },

  // 核心上傳與儲存整合函式：同時處理本機 IndexedDB/LocalStorage 與 Supabase 雲端
  async saveBill(billData, fileBlob) {
    BillAuth.requireUser();
    if (!this.isConfigured()) throw new Error('雲端連線尚未設定，無法儲存帳單。');
    // 1. 若有檔案二進制，存入 IndexedDB 供後續隨時預覽與下載
    if (fileBlob) {
      await PdfStorageDB.savePdf(billData.filename, fileBlob);
      if (!billData.file_url) {
        billData.file_url = URL.createObjectURL(fileBlob);
      }
    }

    // 2. 存入本機 LocalStorage 備援
    if (!billData.id) {
      billData.id = Date.now();
    }
    this.saveLocalBill(billData);

    // 3. 若已連線 Supabase，同步上傳 Storage 並寫入 PostgreSQL
    if (this.isConfigured() && supabaseInstance) {
      try {
        let cloudFileUrl = billData.file_url;
        if (fileBlob) {
          const uploaded = await this.uploadPdfFile(fileBlob, billData.filename);
          if (uploaded) {
            cloudFileUrl = uploaded;
            billData.file_url = cloudFileUrl;
          }
        }

        // 整理寫入欄位
        const payload = {
          filename: billData.filename,
          file_url: cloudFileUrl,
          file_size: billData.file_size || (fileBlob ? fileBlob.size : null),
          electric_number: billData.electric_number,
          contract_number: billData.contract_number,
          site_name: billData.site_name,
          customer_name: billData.customer_name,
          customer_address: billData.customer_address,
          tax_id: billData.tax_id,
          bill_year_month: billData.bill_year_month,
          bill_year_month_ad: billData.bill_year_month_ad,
          billing_period: billData.billing_period,
          billing_start_ad: billData.billing_start_ad || null,
          billing_end_ad: billData.billing_end_ad || null,
          plant_location: billData.plant_location,
          city: billData.city,
          district: billData.district,
          installed_capacity_kw: billData.installed_capacity_kw,
          grid_capacity_kw: billData.grid_capacity_kw,
          total_kwh: billData.total_kwh,
          fit_rate: billData.fit_rate,
          purchase_amount: billData.purchase_amount,
          tax_amount: billData.tax_amount,
          total_bill_amount: billData.total_bill_amount,
          meter_rental_amount: billData.meter_rental_amount,
          net_payable_amount: billData.net_payable_amount,
          payment_account: billData.payment_account,
          taipower_branch: billData.taipower_branch,
          taipower_tel: billData.taipower_tel,
          meter_read_curr: billData.meter_read_curr,
          machines_json: billData.machines || [],
          status: billData.status || 'NEEDS_REVIEW',
          bill_type: billData.bill_type || 'FIT',
          consumption_amount: billData.consumption_amount ?? null,
          consumption_kwh: billData.consumption_kwh ?? null,
          parse_warnings: billData.parse_warnings || [],
          raw_text: billData.raw_text || null,
          extraction_mode: billData.extraction_mode || null,
          file_hash: billData.file_hash || null,
          updated_at: new Date().toISOString()
        };

        // 讀取既有記錄並進行智慧合併，嚴格防護避免解析不完全的空值蓋掉雲端已有數值
        let finalPayload = { ...payload };
        const { data: existingRow } = await supabaseInstance
          .from('electricity_bills')
          .select('*')
          .eq('filename', billData.filename)
          .maybeSingle();

        if (existingRow) {
          finalPayload = { ...existingRow };
          for (const [k, v] of Object.entries(payload)) {
            if (v !== null && v !== undefined && v !== '') {
              // 防護 1: 裝置容量防護，禁止以小容量覆蓋既有大容量
              if (k === 'installed_capacity_kw' && existingRow.installed_capacity_kw >= 500 && v < existingRow.installed_capacity_kw * 0.8) {
                continue;
              }
              // 防護 2: 發電度數防護，禁止以錯誤小數值或單機組局部值 (< 既有值 50%) 覆蓋雲端正確發電量
              if (k === 'total_kwh' && existingRow.total_kwh > 500 && v < existingRow.total_kwh * 0.5) {
                continue;
              }
              // 防護 3: 金額防護，禁止以低額 (< 既有值 50%) 覆蓋雲端正確請款金額
              if ((k === 'net_payable_amount' || k === 'purchase_amount' || k === 'total_bill_amount') && existingRow[k] > 2000 && v < existingRow[k] * 0.5) {
                continue;
              }
              // 防護 4: 案場名稱防護，禁止以未命名的原始電號檔名 (如 18-35-9151-58-2_210632_1) 覆蓋已命名的中文案場名
              if (k === 'site_name' && existingRow.site_name && !/^\d{2}-\d{2}-\d{4}/.test(existingRow.site_name) && /^\d{2}-\d{2}-\d{4}/.test(String(v))) {
                continue;
              }
              finalPayload[k] = v;
            }
          }
        }
        finalPayload.updated_at = new Date().toISOString();

        const { error } = await supabaseInstance
          .from('electricity_bills')
          .upsert(finalPayload, { onConflict: 'filename' });

        if (!error) {
          billData.synced_to_cloud = true;
          this.saveLocalBill(billData);
        } else {
          throw new Error("雲端資料儲存失敗：" + error.message);
        }
      } catch (err) {
        console.error("Cloud sync error:", err);
        throw err;
      }
    }

    return billData;
  },

  // 取得真實可下載 / 預覽的 URL
  async getBillFileUrl(bill) {
    BillAuth.requireUser();
    if (!bill) return '';
    const value = bill.file_url || '';
    let objectPath = '';
    if (value.startsWith('storage://bills/')) objectPath = value.slice('storage://bills/'.length);
    else if (value.includes('/storage/v1/object/')) {
      const match = new URL(value).pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/bills\/(.+)/);
      if (match) objectPath = decodeURIComponent(match[1]);
    }
    if (objectPath) {
      const {data,error} = await supabaseInstance.storage.from('bills').createSignedUrl(objectPath, 300);
      if (error) throw new Error('取得檔案權限失敗：' + error.message);
      return data.signedUrl;
    }
    const blob = await PdfStorageDB.getPdf(bill.filename);
    if (blob) return URL.createObjectURL(blob);
    throw new Error('此帳單尚未有可用的雲端 PDF，請重新上傳原檔。');
  },

  // 查詢電費單清單
  async fetchBills({ keyword = '', customer = '', month = '', city = '', sortBy = 'id', order = 'desc' } = {}) {
    BillAuth.requireUser();
    if (!this.isConfigured()) throw new Error('雲端連線尚未設定。');
    // 查詢 Supabase PostgreSQL
    let query = supabaseInstance.from('electricity_bills').select('*', { count: 'exact' });

    if (customer) query = query.eq('customer_name', customer);
    if (month) query = query.eq('bill_year_month', month);
    if (city) query = query.eq('city', city);

    if (keyword) {
      query = query.or(
        `site_name.ilike.%${keyword}%,` +
        `electric_number.ilike.%${keyword}%,` +
        `contract_number.ilike.%${keyword}%,` +
        `customer_name.ilike.%${keyword}%,` +
        `plant_location.ilike.%${keyword}%,` +
        `tax_id.ilike.%${keyword}%`
      );
    }

    const sortColMap = {
      id: 'id',
      month: 'billing_start_ad',
      amount: 'net_payable_amount',
      kwh: 'total_kwh',
      capacity: 'installed_capacity_kw'
    };
    const col = sortColMap[sortBy] || 'id';
    query = query.order(col, { ascending: order.toLowerCase() === 'asc' });

    const { data, count, error } = await query;
    if (error) throw error;

    // 當載入完整帳單時，自動回寫本機快取並標記已同步，徹底覆蓋並洗淨歷史殘留之舊數據
    if (data && data.length > 0 && !customer && !month && !city && !keyword) {
      try {
        const syncedData = data.map(r => ({ ...r, synced_to_cloud: true }));
        localStorage.setItem('CUSTOM_LOCAL_BILLS', JSON.stringify(syncedData));
      } catch (e) {}
    }

    return { bills: data || [], total: count || (data ? data.length : 0), isDemo: false };
  },

  async fetchKPIs() {
    const { bills: allBills } = await this.fetchBills();
    const bills = allBills.filter(b => b.bill_type !== 'CONSUMPTION');
    const plantSet = new Set(bills.map(b => b.electric_number).filter(Boolean));
    const custSet = new Set(bills.map(b => b.customer_name).filter(Boolean));

    const sumKwh = bills.reduce((acc, b) => acc + (Number(b.total_kwh) || 0), 0);
    const sumPurchase = bills.reduce((acc, b) => acc + (Number(b.purchase_amount) || 0), 0);
    const sumBill = bills.reduce((acc, b) => acc + (Number(b.total_bill_amount) || 0), 0);
    const sumPayable = bills.reduce((acc, b) => acc + (Number(b.net_payable_amount) || 0), 0);
    const avgRate = bills.length ? bills.reduce((acc, b) => acc + (Number(b.fit_rate) || 0), 0) / bills.length : 0;

    return {
      bill_count: bills.length,
      plant_count: plantSet.size,
      customer_count: custSet.size,
      sum_kwh: sumKwh,
      sum_purchase_amount: sumPurchase,
      sum_bill_amount: sumBill,
      sum_payable_amount: sumPayable,
      avg_fit_rate: avgRate
    };
  },

  async importDispatchText(text) {
    BillAuth.requireUser();
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    const records = [];
    const seen = new Set();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Skip header line only if it doesn't contain a real electric number
      if (line.includes('電號') && line.includes('案場') && !/\d{2}-\d{2}/.test(line)) continue;

      const mElec = line.match(/(\d{2}-\d{2}-\d{4}-\d{2}-\d{1})/);
      if (!mElec) continue;
      const elecNo = mElec[1];

      let siteName = '';
      let fname = '';

      // Pattern 1: Brackets format: [10-56-4770-02-1] 賴侯淑貞 or 2. [10-56-4770-02-1] 賴侯淑貞
      const escapedElec = elecNo.replace(/-/g, '\\-');
      const mBracket = line.match(new RegExp('\\[' + escapedElec + '\\]\\s*[-—:：]?\\s*([^\\s\\t|]+)'));
      if (mBracket) {
        siteName = mBracket[1].trim();
      }

      // Pattern 2: Key-value: 案場[名稱]?[:：]?\s*([^\s]+)
      if (!siteName) {
        const mKV = line.match(/(?:案場|案場名稱)[：:]\s*([^\s,，|]+)/);
        if (mKV) siteName = mKV[1].trim();
      }

      // Pattern 3: Delimited by tabs, pipes, or spaces (e.g. 10-56-4770-02-1 賴侯淑貞)
      if (!siteName) {
        const cleaned = line.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '');
        const parts = cleaned.split(/[\t|]+|\s{1,}/).map(p => p.trim()).filter(Boolean);
        for (let j = 0; j < parts.length; j++) {
          if (parts[j].includes(elecNo)) {
            if (j + 1 < parts.length && !/^\d{8}$/.test(parts[j + 1]) && !parts[j + 1].endsWith('.pdf')) {
              siteName = parts[j + 1];
            } else if (j > 0 && !/^\d{8}$/.test(parts[j - 1])) {
              siteName = parts[j - 1];
            }
            break;
          }
        }
      }

      // Pattern 4: Check if pdf filename exists in line
      const mPdf = line.match(/([0-9a-zA-Z_\-]+\.pdf)/i);
      if (mPdf) fname = mPdf[1];

      // Clean siteName from punctuation or trailing brackets
      if (siteName) {
        siteName = siteName.replace(/[\[\]()（）]/g, '').trim();
      }

      if (elecNo && siteName && !seen.has(elecNo)) {
        seen.add(elecNo);
        records.push({ electric_number: elecNo, site_name: siteName, filename: fname });
      }
    }

    if (!records.length) {
      throw new Error('未能識別出有效的電號與案場名稱（請確保包含如 10-56-4770-02-1 與對應案場名稱）');
    }

    // 儲存至本地對照快取
    const mappings = JSON.parse(localStorage.getItem('SITE_MAPPINGS') || '{}');
    for (let r of records) {
      mappings[r.electric_number] = r.site_name;
    }
    localStorage.setItem('SITE_MAPPINGS', JSON.stringify(mappings));

    // Also update existing local bills
    let updated = 0;
    const customList = this.getLocalBills();
    for (let r of records) {
      for (let b of customList) {
        if (b.electric_number === r.electric_number || (r.filename && b.filename === r.filename)) {
          b.site_name = r.site_name;
          updated++;
        }
      }
      for (let b of SEED_BILLS) {
        if (b.electric_number === r.electric_number || (r.filename && b.filename === r.filename)) {
          b.site_name = r.site_name;
          updated++;
        }
      }
    }
    localStorage.setItem('CUSTOM_LOCAL_BILLS', JSON.stringify(customList));

    if (!this.isConfigured()) {
      return { 
        success: true, 
        count: records.length, 
        message: `[展示模式] 成功識別並關聯 ${records.length} 組案場名稱（已即時更新 ${updated} 筆帳單）！` 
      };
    }

    // 更新 Supabase 雲端資料庫
    let count = 0;
    for (let r of records) {
      await supabaseInstance.from('site_mappings').upsert({
        electric_number: r.electric_number,
        site_name: r.site_name,
        updated_at: new Date().toISOString()
      });

      const { error } = await supabaseInstance.from('electricity_bills')
        .update({ site_name: r.site_name, updated_at: new Date().toISOString() })
        .eq('electric_number', r.electric_number);

      if (!error) count++;
    }

    return { 
      success: true, 
      count: records.length, 
      message: `成功同步更新 Supabase 雲端資料庫中 ${records.length} 組案場名稱對照！` 
    };
  },

  async uploadPdfFile(fileOrBlob, customFilename = '') {
    BillAuth.requireUser();
    if (!this.isConfigured() || !supabaseInstance) {
      return '';
    }

    const rawName = (fileOrBlob && fileOrBlob.name) || customFilename || 'bill.pdf';
    // Supabase / S3 物件鍵僅支援純 ASCII 字元，過濾非英數符號避免 InvalidKey 錯誤
    const baseAscii = rawName.replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 30);
    const storagePath = `bills/${Date.now()}_${baseAscii || 'bill'}.pdf`;

    try {
      const { data, error } = await supabaseInstance.storage
        .from('bills')
        .upload(storagePath, fileOrBlob, { cacheControl: '3600', upsert: true, contentType: 'application/pdf' });

      if (error) {
        throw new Error("PDF 雲端上傳失敗：" + error.message);
      }

      return 'storage://bills/' + storagePath;
    } catch (e) {
      console.warn("Storage upload failed:", e);
      throw e;
    }
  },

  // 自動將瀏覽器本地離線上傳之電費單（如五甲尾）同步至 Supabase 雲端
  async syncLocalBillsToCloud() {
    BillAuth.requireUser();
    if (!this.isConfigured() || !supabaseInstance) {
      return { success: false, syncedCount: 0, reason: '未連線 Supabase' };
    }

    const customList = this.getLocalBills();
    if (!customList || customList.length === 0) {
      return { success: true, syncedCount: 0 };
    }

    let syncedCount = 0;
    for (let b of customList) {
      try {
        // 若此筆已標記同步完成且已有雲端 URL，直接跳過，避免拿本機舊快取重複覆寫雲端最新修正資料
        if (b.synced_to_cloud && b.file_url && (b.file_url.includes('supabase.co') || b.file_url.startsWith('storage://bills/'))) {
          continue;
        }

        // 先檢查雲端是否已經存在完整記錄
        const { data: existingCheck } = await supabaseInstance
          .from('electricity_bills')
          .select('*')
          .eq('filename', b.filename)
          .maybeSingle();

        if (existingCheck && ['PARSED','MANUAL_EDITED'].includes(existingCheck.status)) {
          b.synced_to_cloud = true;
          syncedCount++;
          continue;
        }

        let cloudFileUrl = b.file_url;
        // 若尚未有雲端 Storage 連結（或仍是 blob: 本地臨時連結），嘗試上傳 PDF 二進制
        if (!cloudFileUrl || cloudFileUrl.startsWith('blob:') || !(cloudFileUrl.includes('supabase.co') || cloudFileUrl.startsWith('storage://bills/'))) {
          if (b.filename) {
            const blob = await PdfStorageDB.getPdf(b.filename);
            if (blob) {
              const uploaded = await this.uploadPdfFile(blob, b.filename);
              if (uploaded) {
                cloudFileUrl = uploaded;
                b.file_url = cloudFileUrl;
              }
            }
          }
        }

        const payload = {
          filename: b.filename,
          file_url: cloudFileUrl || null,
          file_size: b.file_size || null,
          electric_number: b.electric_number,
          contract_number: b.contract_number,
          site_name: b.site_name,
          customer_name: b.customer_name,
          customer_address: b.customer_address,
          tax_id: b.tax_id,
          bill_year_month: b.bill_year_month,
          bill_year_month_ad: b.bill_year_month_ad,
          billing_period: b.billing_period,
          billing_start_ad: b.billing_start_ad || null,
          billing_end_ad: b.billing_end_ad || null,
          plant_location: b.plant_location,
          city: b.city,
          district: b.district,
          installed_capacity_kw: b.installed_capacity_kw,
          grid_capacity_kw: b.grid_capacity_kw,
          total_kwh: b.total_kwh,
          fit_rate: b.fit_rate,
          purchase_amount: b.purchase_amount,
          tax_amount: b.tax_amount,
          total_bill_amount: b.total_bill_amount,
          meter_rental_amount: b.meter_rental_amount,
          net_payable_amount: b.net_payable_amount,
          payment_account: b.payment_account,
          taipower_branch: b.taipower_branch,
          taipower_tel: b.taipower_tel,
          meter_read_curr: b.meter_read_curr,
          machines_json: b.machines || [],
          status: b.status || 'NEEDS_REVIEW',
          parse_warnings: b.parse_warnings || [],
          updated_at: new Date().toISOString()
        };

        // 讀取既有記錄並進行智慧合併，嚴格防護避免解析不完全的空值蓋掉雲端已有數值
        let finalPayload = { ...payload };
        const { data: existingRow } = await supabaseInstance
          .from('electricity_bills')
          .select('*')
          .eq('filename', b.filename)
          .maybeSingle();

        if (existingRow) {
          finalPayload = { ...existingRow };
          for (const [k, v] of Object.entries(payload)) {
            if (v !== null && v !== undefined && v !== '') {
              // 防護 1: 裝置容量防護，禁止以小容量覆蓋既有大容量
              if (k === 'installed_capacity_kw' && existingRow.installed_capacity_kw >= 500 && v < existingRow.installed_capacity_kw * 0.8) {
                continue;
              }
              // 防護 2: 發電度數防護，禁止以錯誤小數值或單機組局部值 (< 既有值 50%) 覆蓋雲端正確發電量
              if (k === 'total_kwh' && existingRow.total_kwh > 500 && v < existingRow.total_kwh * 0.5) {
                continue;
              }
              // 防護 3: 金額防護，禁止以低額 (< 既有值 50%) 覆蓋雲端正確請款金額
              if ((k === 'net_payable_amount' || k === 'purchase_amount' || k === 'total_bill_amount') && existingRow[k] > 2000 && v < existingRow[k] * 0.5) {
                continue;
              }
              // 防護 4: 案場名稱防護，禁止以未命名的原始電號檔名 (如 18-35-9151-58-2_210632_1) 覆蓋已命名的中文案場名
              if (k === 'site_name' && existingRow.site_name && !/^\d{2}-\d{2}-\d{4}/.test(existingRow.site_name) && /^\d{2}-\d{2}-\d{4}/.test(String(v))) {
                continue;
              }
              finalPayload[k] = v;
            }
          }
        }
        finalPayload.updated_at = new Date().toISOString();

        const { error } = await supabaseInstance
          .from('electricity_bills')
          .upsert(finalPayload, { onConflict: 'filename' });

        if (!error) {
          b.synced_to_cloud = true;
          syncedCount++;
        }
      } catch (err) {
        console.warn("Sync local bill error:", b.filename, err);
      }
    }

    if (syncedCount > 0) {
      localStorage.setItem('CUSTOM_LOCAL_BILLS', JSON.stringify(customList));
    }

    // 亦將本地案場對照 SITE_MAPPINGS 同步至雲端
    try {
      const mappings = JSON.parse(localStorage.getItem('SITE_MAPPINGS') || '{}');
      for (const [elecNo, sName] of Object.entries(mappings)) {
        await supabaseInstance.from('site_mappings').upsert({
          electric_number: elecNo,
          site_name: sName,
          updated_at: new Date().toISOString()
        });
      }
    } catch (e) {
      console.warn("Sync site mappings warning:", e);
    }

    return { success: true, syncedCount };
  },

  // 更新特定電費單資料（支援線上預覽核對時直接修改保存）
  async updateBill(id, fields) {
    BillAuth.requireUser();
    if (!id) throw new Error('找不到電費單。');
    const {data: previous,error: readError} = await supabaseInstance.from('electricity_bills').select('*').eq('id',id).single();
    if (readError) throw readError;
    const validated = validateBillRecognition({...previous,...fields});
    const payload = {...fields,status:validated.status === 'PARSED' ? 'MANUAL_EDITED' : 'NEEDS_REVIEW',parse_warnings:validated.parse_warnings,updated_at:new Date().toISOString()};
    const {data,error} = await supabaseInstance.from('electricity_bills').update(payload).eq('id',id).select('id').single();
    if (error || !data) throw new Error('雲端儲存失敗：' + (error?.message || '沒有更新任何帳單'));
    this.saveLocalBill({...previous,...payload});
  },

  // 產生一鍵分享連結（附帶已設定之 Supabase 憑證，供團隊無痛連線）
  generateShareUrl() {
    const cfg = this.getStoredConfig();
    if (!cfg.url || !cfg.anonKey) return window.location.href;
    const base = window.location.origin + window.location.pathname;
    return `${base}#sb_url=${encodeURIComponent(cfg.url)}&sb_key=${encodeURIComponent(cfg.anonKey)}`;
  }
};

// 載入時自動初始化
SupabaseBillService.init();
