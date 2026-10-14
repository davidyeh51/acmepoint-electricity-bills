/**
 * 進金生能源 6692 ｜ 客戶太陽能電費單管理系統
 * Supabase 集中管理模組 (Vanilla JS for GitHub Pages)
 */

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
  getStoredConfig() {
    return {
      url: localStorage.getItem('SB_URL') || '',
      anonKey: localStorage.getItem('SB_ANON_KEY') || ''
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

  async fetchBills({ keyword = '', customer = '', month = '', city = '', sortBy = 'id', order = 'desc' } = {}) {
    if (!this.isConfigured()) {
      // Return local seed bills with in-memory filtering
      let list = [...SEED_BILLS];
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

      // Sort
      list.sort((a, b) => {
        let vA = a[sortBy] ?? a.id;
        let vB = b[sortBy] ?? b.id;
        if (order === 'desc') return vA < vB ? 1 : -1;
        return vA > vB ? 1 : -1;
      });

      return { bills: list, total: list.length, isDemo: true };
    }

    // Query Supabase PostgreSQL
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
      'id': 'id',
      'month': 'bill_year_month_ad',
      'electric_no': 'electric_number',
      'site_name': 'site_name',
      'amount': 'net_payable_amount',
      'kwh': 'total_kwh',
      'capacity': 'installed_capacity_kw'
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

        // Check format
        const m = elecNo.match(/\d{2}-\d{2}-\d{4}-\d{2}-\d{1}/);
        if (m) elecNo = m[0];
        if (elecNo && siteName) {
          records.push({ electric_number: elecNo, site_name: siteName, filename: fname });
        }
      }
    }

    if (!records.length) throw new Error('未能識別出有效的電號與案場名稱');

    if (!this.isConfigured()) {
      // Update local memory
      let updated = 0;
      for (let r of records) {
        for (let b of SEED_BILLS) {
          if (b.electric_number === r.electric_number || (r.filename && b.filename === r.filename)) {
            b.site_name = r.site_name;
            updated++;
          }
        }
      }
      return { success: true, count: updated, message: `[展示模式] 成功更新 ${updated} 筆案場名稱關聯！` };
    }

    // Update in Supabase
    let count = 0;
    for (let r of records) {
      // 1. Upsert site_mappings
      await supabaseInstance.from('site_mappings').upsert({
        electric_number: r.electric_number,
        site_name: r.site_name,
        updated_at: new Date().toISOString()
      });

      // 2. Update electricity_bills
      const { data, error } = await supabaseInstance.from('electricity_bills')
        .update({ site_name: r.site_name, updated_at: new Date().toISOString() })
        .eq('electric_number', r.electric_number);

      if (!error) count++;
    }

    return { success: true, count, message: `成功同步更新 Supabase 雲端資料庫中 ${count} 筆案場資料！` };
  },

  async uploadPdfFile(file) {
    if (!this.isConfigured()) {
      throw new Error('請先完成 Supabase 連線設定，以啟用雲端 Storage 檔案儲存！');
    }

    const cleanName = file.name.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5.-]/g, '_');
    const storagePath = `bills/${Date.now()}_${cleanName}`;

    const { data, error } = await supabaseInstance.storage
      .from('bills')
      .upload(storagePath, file, { cacheControl: '3600', upsert: true });

    if (error) throw error;

    const { data: pubData } = supabaseInstance.storage.from('bills').getPublicUrl(storagePath);
    return pubData.publicUrl;
  }
};

// Auto initialize on script load
SupabaseBillService.init();
