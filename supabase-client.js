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
const SEED_BILLS = [
  {
    id: 1,
    filename: "08-40-8620-12-7_211307_1.pdf",
    file_url: "客戶電費單資料庫/08-40-8620-12-7_211307_1.pdf",
    electric_number: "08-40-8620-12-7",
    contract_number: "08-PV-109-0339",
    site_name: "美傢家具鹿港廠1",
    customer_name: "中租迪和股份有限公司",
    customer_address: "114 台北市內湖區瑞光路362號8樓至12樓",
    tax_id: "05072925",
    bill_year_month: "115年10月",
    bill_year_month_ad: "2026-10",
    billing_period: "115年09月01日~115年09月30日",
    plant_location: "彰化縣鹿港鎮上林段598、599地號",
    city: "彰化縣",
    district: "鹿港鎮",
    installed_capacity_kw: 1628.9,
    grid_capacity_kw: 1628.9,
    total_kwh: 231396,
    fit_rate: 4.2444,
    purchase_amount: 982137,
    tax_amount: 49107,
    total_bill_amount: 1031244,
    meter_rental_amount: -1628,
    net_payable_amount: 1029616,
    payment_account: "彰化商業銀行民生分行95106999900835號帳戶",
    taipower_branch: "彰化區營業處核算（收費）課",
    taipower_tel: "(04)7256461",
    meter_read_curr: "115年10月01日",
    machines: [
      { name: "機組1", rate: 4.2444, kwh: 70638, amount: 299816 },
      { name: "機組2", rate: 4.2444, kwh: 160758, amount: 682321 }
    ],
    status: "PARSED"
  },
  {
    id: 2,
    filename: "10-56-4770-02-1_211458_1.pdf",
    file_url: "客戶電費單資料庫/10-56-4770-02-1_211458_1.pdf",
    electric_number: "10-56-4770-02-1",
    contract_number: "10-PV-106-0047",
    site_name: "賴侯淑貞",
    customer_name: "中租迪和股份有限公司",
    customer_address: "114 台北市內湖區瑞光路362號8樓至12樓",
    tax_id: "05072925",
    bill_year_month: "115年10月",
    bill_year_month_ad: "2026-10",
    billing_period: "115年09月04日~115年10月05日",
    plant_location: "台南市安南區公學路五段656巷198號",
    city: "台南市",
    district: "安南區",
    installed_capacity_kw: 196.62,
    grid_capacity_kw: 196.62,
    total_kwh: 28062,
    fit_rate: 4.8111,
    purchase_amount: 135009,
    tax_amount: 6750,
    total_bill_amount: 141759,
    meter_rental_amount: -249,
    net_payable_amount: 141510,
    payment_account: "永豐商業銀行營業部99717300000067號帳戶",
    taipower_branch: "台南區營業處核算（收費）課",
    taipower_tel: "(06)2160121",
    meter_read_curr: "115年10月06日",
    machines: [
      { name: "機組1", rate: 4.8111, kwh: 28062, amount: 135009 }
    ],
    status: "PARSED"
  }
];

let supabaseInstance = null;

const SupabaseBillService = {
  // 自動解析 URL 邀請參數或 LocalStorage 中的設定
  getStoredConfig() {
    try {
      // 支援網址帶入 #sb_url=...&sb_key=... 或 ?sb_url=...&sb_key=...
      const rawHash = window.location.hash.replace(/^#/, '');
      const rawSearch = window.location.search.replace(/^\?/, '');
      const searchStr = rawHash.includes('sb_url') ? rawHash : rawSearch;
      
      if (searchStr.includes('sb_url')) {
        const params = new URLSearchParams(searchStr);
        const pUrl = params.get('sb_url');
        const pKey = params.get('sb_key');
        if (pUrl && pKey) {
          localStorage.setItem('SB_URL', pUrl.trim());
          localStorage.setItem('SB_ANON_KEY', pKey.trim());
          // 清除網址雜訊以保護憑證
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }
    } catch (e) {
      console.warn("URL params parse note:", e);
    }

    return {
      url: localStorage.getItem('SB_URL') || (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) || '',
      anonKey: localStorage.getItem('SB_ANON_KEY') || (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.anonKey) || ''
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
        supabaseInstance = window.supabase.createClient(url.trim(), anonKey.trim());
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
          cloudFileUrl = await this.uploadPdfFile(fileBlob);
          billData.file_url = cloudFileUrl;
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
          status: 'PARSED',
          updated_at: new Date().toISOString()
        };

        const { error } = await supabaseInstance
          .from('electricity_bills')
          .upsert(payload, { onConflict: 'filename' });

        if (error) {
          console.warn("Supabase upsert warning:", error);
        }
      } catch (err) {
        console.error("Cloud sync error:", err);
      }
    }

    return billData;
  },

  // 取得真實可下載 / 預覽的 URL
  async getBillFileUrl(bill) {
    if (!bill) return '';
    // 先看 IndexedDB 是否有原檔
    if (bill.filename) {
      const blob = await PdfStorageDB.getPdf(bill.filename);
      if (blob) {
        return URL.createObjectURL(blob);
      }
    }
    return bill.file_url || (bill.filename ? `客戶電費單資料庫/${bill.filename}` : '');
  },

  // 查詢電費單清單
  async fetchBills({ keyword = '', customer = '', month = '', city = '', sortBy = 'id', order = 'desc' } = {}) {
    if (!this.isConfigured()) {
      // 合併使用者本地上傳之電費單與種子資料
      const customList = this.getLocalBills();
      let list = [...customList, ...SEED_BILLS];
      
      // 去重 (依 filename 或 electric_number + month)
      const seen = new Set();
      list = list.filter(b => {
        const key = b.filename || `${b.electric_number}_${b.bill_year_month}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      if (keyword) {
        const kw = keyword.toLowerCase();
        list = list.filter(b => 
          (b.site_name && b.site_name.toLowerCase().includes(kw)) ||
          (b.electric_number && b.electric_number.toLowerCase().includes(kw)) ||
          (b.contract_number && b.contract_number.toLowerCase().includes(kw)) ||
          (b.customer_name && b.customer_name.toLowerCase().includes(kw)) ||
          (b.plant_location && b.plant_location.toLowerCase().includes(kw)) ||
          (b.tax_id && b.tax_id.includes(kw))
        );
      }
      if (customer) list = list.filter(b => b.customer_name === customer);
      if (month) list = list.filter(b => b.bill_year_month === month);
      if (city) list = list.filter(b => b.city === city);

      // 排序
      list.sort((a, b) => {
        let vA = a[sortBy] ?? a.id;
        let vB = b[sortBy] ?? b.id;
        if (order === 'desc') return vA < vB ? 1 : -1;
        return vA > vB ? 1 : -1;
      });

      return { bills: list, total: list.length, isDemo: true };
    }

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

    return { bills: data || [], total: count || (data ? data.length : 0), isDemo: false };
  },

  async fetchKPIs() {
    const { bills } = await this.fetchBills();
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
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    const records = [];

    for (let line of lines) {
      if (line.includes('電號') && line.includes('案場')) continue;
      const parts = line.split(/\t+|\s{2,}/);
      if (parts.length >= 2) {
        let elecNo = parts[0].trim();
        let siteName = parts[1].trim();
        let fname = parts[4] ? parts[4].trim() : '';

        const m = elecNo.match(/\d{2}-\d{2}-\d{4}-\d{2}-\d{1}/);
        if (m) elecNo = m[0];
        if (elecNo && siteName) {
          records.push({ electric_number: elecNo, site_name: siteName, filename: fname });
        }
      }
    }

    if (!records.length) throw new Error('未能識別出有效的電號與案場名稱');

    // 儲存至本地對照快取
    const mappings = JSON.parse(localStorage.getItem('SITE_MAPPINGS') || '{}');
    for (let r of records) {
      mappings[r.electric_number] = r.site_name;
    }
    localStorage.setItem('SITE_MAPPINGS', JSON.stringify(mappings));

    if (!this.isConfigured()) {
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
      return { success: true, count: updated, message: `[展示模式] 成功更新 ${updated} 筆案場名稱關聯！` };
    }

    // 更新 Supabase
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

    return { success: true, count, message: `成功同步更新 Supabase 雲端資料庫中 ${count} 筆案場資料！` };
  },

  async uploadPdfFile(file) {
    if (!this.isConfigured()) {
      return '';
    }

    const cleanName = file.name.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5.-]/g, '_');
    const storagePath = `bills/${Date.now()}_${cleanName}`;

    const { data, error } = await supabaseInstance.storage
      .from('bills')
      .upload(storagePath, file, { cacheControl: '3600', upsert: true });

    if (error) {
      console.warn("Storage upload note:", error);
      return '';
    }

    const { data: pubData } = supabaseInstance.storage.from('bills').getPublicUrl(storagePath);
    return pubData ? pubData.publicUrl : '';
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
