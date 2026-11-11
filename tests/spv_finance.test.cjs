const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function loadSpvContext() {
  const context = {
    console,
    Date,
    Math,
    Intl,
    document: { getElementById: () => null },
    window: null,
    globalThis: null
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);

  for (const file of ['audited-bills-data.js', 'spv-finance-data.js', 'spv-finance.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  }
  return context;
}

test('calcTaiwanCorporateIncomeTax enforces 120k exemption and 200k phase-in thresholds', () => {
  const { SpvFinance } = loadSpvContext();
  assert.equal(SpvFinance.calcTaiwanCorporateIncomeTax(0), 0);
  assert.equal(SpvFinance.calcTaiwanCorporateIncomeTax(120000), 0);
  assert.equal(SpvFinance.calcTaiwanCorporateIncomeTax(150000), 15000);
  assert.equal(SpvFinance.calcTaiwanCorporateIncomeTax(200000), 40000);
  assert.equal(SpvFinance.calcTaiwanCorporateIncomeTax(1000000), 200000);
});

test('reconcileSpvMonthlyTracking reconciles 5 CCK001 bills and 12M Excel report to exact NT$ and kWh', () => {
  const ctx = loadSpvContext();
  const model = ctx.SPV_DEFAULT_MODELS[0];
  const monthly = ctx.SPV_DEFAULT_MONTHLY_RECORDS;
  const bills = ctx.AUDITED_BILLS_REGISTRY;

  const res = ctx.SpvFinance.reconcileSpvMonthlyTracking(model, monthly, bills);
  const s = res.summary;

  assert.equal(res.rows.length, 12);
  assert.equal(res.linked_bills.length, 5);
  assert.equal(s.actual_months_count, 5);
  assert.equal(s.billed_months_count, 5);

  assert.equal(s.total_predicted_12m, 1700601);
  assert.equal(s.total_predicted_to_date, 754175);
  assert.equal(s.total_report_actual_to_date, 831077);
  assert.equal(s.total_billed_kwh, 831077);
  assert.equal(s.bill_vs_report_diff_kwh, 0);

  // July (-623 kWh) and August (+623 kWh) cross-month variance offsets cleanly
  const jul = res.rows.find(r => r.tracking_year_month === '2026-07');
  const aug = res.rows.find(r => r.tracking_year_month === '2026-08');
  assert.equal(jul.bill_report_diff_kwh, -623);
  assert.equal(aug.bill_report_diff_kwh, 623);

  // Exact financial figures across 5 Taipower bills
  assert.equal(s.total_bill_purchase, 2690440);
  assert.equal(s.total_bill_settlement, 408647);
  assert.equal(s.total_billed_untaxed, 3099087);
  assert.equal(s.total_bill_tax, 154954);
  assert.equal(s.total_bill_rental, -4619);
  assert.equal(s.total_bill_net_payable, 3249422);
});

test('reconcileSpvMonthlyTracking auto-links newly uploaded 2026-10 bill into forecast row', () => {
  const ctx = loadSpvContext();
  const model = ctx.SPV_DEFAULT_MODELS[0];
  const monthly = ctx.SPV_DEFAULT_MONTHLY_RECORDS;
  const extendedBills = [
    ...ctx.AUDITED_BILLS_REGISTRY,
    {
      id: 99,
      electric_number: '11-71-0067-91-9',
      bill_year_month: '115年11月',
      bill_year_month_ad: '2026-11',
      billing_start_ad: '2026-10-01',
      billing_end_ad: '2026-10-31',
      total_kwh: 140000,
      purchase_amount: 522060,
      tax_amount: 26103,
      meter_rental_amount: -983,
      net_payable_amount: 547180,
      bill_type: 'FIT',
      status: 'PARSED'
    }
  ];

  const res = ctx.SpvFinance.reconcileSpvMonthlyTracking(model, monthly, extendedBills);
  const oct = res.rows.find(r => r.tracking_year_month === '2026-10');
  assert.equal(oct.auto_matched_from_bills, true);
  assert.equal(oct.taipower_billed_kwh, 140000);
  assert.equal(oct.bill_purchase_amount, 522060);
  assert.equal(res.summary.actual_months_count, 6);
  assert.equal(res.summary.total_billed_kwh, 831077 + 140000);
  assert.equal(res.summary.total_bill_net_payable, 3249422 + 547180);
});

test('compute20YearFinancialModel calculates CapEx, 75% debt, IRR, NPV and DSCR under v1.2 conventions', () => {
  const ctx = loadSpvContext();
  const fin = ctx.SpvFinance.compute20YearFinancialModel(ctx.SPV_DEFAULT_MODELS[0]);

  assert.equal(Math.round(fin.capex_untaxed), Math.round(1358.14 * 51500));
  assert.equal(Math.round(fin.loan_amount), Math.round(fin.capex_untaxed * 0.75));
  assert.equal(fin.years.length, 21); // Y0 .. Y20
  assert.ok(fin.project_irr > 0.01 && fin.project_irr < 0.03, `Unexpected project IRR: ${fin.project_irr}`);
  assert.ok(fin.min_dscr > 0.90 && fin.min_dscr < 1.10, `Unexpected min DSCR at 51,500/kWp: ${fin.min_dscr}`);
  assert.ok(fin.project_payback_years > 10 && fin.project_payback_years < 18);

  // Lower EPC CapEx sensitivity (38,000 NT$/kWp -> higher project IRR > 4.5% and higher DSCR)
  const tunedModel = {
    ...ctx.SPV_DEFAULT_MODELS[0],
    assumptions_json: {
      ...ctx.SPV_DEFAULT_MODELS[0].assumptions_json,
      unit_capex_untaxed: 38000
    }
  };
  const tunedFin = ctx.SpvFinance.compute20YearFinancialModel(tunedModel);
  assert.ok(tunedFin.project_irr > 0.045 && tunedFin.project_irr > fin.project_irr, `Expected project IRR > 4.5% at 38k/kWp, got ${tunedFin.project_irr}`);
  assert.ok(tunedFin.equity_irr > tunedFin.project_irr, `Expected Equity IRR > Project IRR at 38k/kWp`);
  assert.ok(tunedFin.min_dscr >= 1.2, `Expected min DSCR >= 1.2 at 38k/kWp, got ${tunedFin.min_dscr}`);
});

test('buildGenerationSvgChart emits a valid SVG containing all 12 tracking months', () => {
  const ctx = loadSpvContext();
  const res = ctx.SpvFinance.reconcileSpvMonthlyTracking(
    ctx.SPV_DEFAULT_MODELS[0],
    ctx.SPV_DEFAULT_MONTHLY_RECORDS,
    ctx.AUDITED_BILLS_REGISTRY
  );
  const svg = ctx.SpvFinance.buildGenerationSvgChart(res.rows);
  assert.ok(svg.startsWith('<svg '));
  assert.ok(svg.includes('26-05'));
  assert.ok(svg.includes('27-04'));
});

test('SpvFinance.render renders full CCK001 dashboard into spvFinanceRoot without error', () => {
  const rootEl = { innerHTML: '', classList: { add() {}, remove() {} } };
  const context = {
    console,
    Date,
    Math,
    Intl,
    lucide: { createIcons() {} },
    document: { getElementById: (id) => (id === 'spvFinanceRoot' ? rootEl : null) },
    window: null,
    globalThis: null
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  for (const file of ['audited-bills-data.js', 'spv-finance-data.js', 'spv-finance.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  }
  context.currentBills = context.AUDITED_BILLS_REGISTRY;
  context.SpvFinance.state.models = context.SPV_DEFAULT_MODELS;
  context.SpvFinance.state.monthly = context.SPV_DEFAULT_MONTHLY_RECORDS;
  context.SpvFinance.render();
  assert.ok(rootEl.innerHTML.includes('CCK001 高振實業'));
  assert.ok(rootEl.innerHTML.includes('831,077'));
  assert.ok(rootEl.innerHTML.includes('3,249,422'));
});

test('SpvFinance.load + SupabaseBillService.fetchSpvData/saveSpvPlantModel work under guest and cloud modes without ReferenceError', async () => {
  const rootEl = { innerHTML: '', classList: { add() {}, remove() {} } };
  const storage = new Map();
  const mockSupabaseClient = {
    from(table) {
      const builder = {
        select() { return builder; },
        order() { return builder; },
        eq() { return builder; },
        update() { return builder; },
        upsert() { return builder; },
        limit() { return builder; },
        single() { return Promise.resolve({ data: null, error: { message: 'permission denied' } }); },
        maybeSingle() { return Promise.resolve({ data: null, error: { message: 'permission denied' } }); },
        then(resolve) {
          if (table === 'spv_plant_models' && ctx.BillAuth.user.id !== 'team-guest') {
            return Promise.resolve({ data: ctx.SPV_DEFAULT_MODELS, error: null }).then(resolve);
          }
          if (table === 'spv_monthly_tracking' && ctx.BillAuth.user.id !== 'team-guest') {
            return Promise.resolve({ data: ctx.SPV_DEFAULT_MONTHLY_RECORDS, error: null }).then(resolve);
          }
          return Promise.resolve({ data: null, count: null, error: { message: 'permission denied' } }).then(resolve);
        }
      };
      return builder;
    }
  };

  const ctx = {
    console,
    Date,
    Math,
    Intl,
    URLSearchParams,
    setTimeout,
    indexedDB: null,
    lucide: { createIcons() {} },
    BillAuth: { user: { id: 'team-guest' }, profile: { username: '團隊成員' }, requireUser() {} },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k)
    },
    location: { hash: '', search: '', origin: 'https://example.test', pathname: '/', href: 'https://example.test/' },
    history: { replaceState() {} },
    document: { title: 'Test', getElementById: (id) => (id === 'spvFinanceRoot' ? rootEl : null) },
    supabase: { createClient: () => mockSupabaseClient },
    window: null,
    globalThis: null
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  for (const file of ['audited-bills-data.js', 'supabase-client.js', 'spv-finance-data.js', 'spv-finance.js']) {
    let code = fs.readFileSync(path.join(root, file), 'utf8');
    if (file === 'supabase-client.js') code += '\n;globalThis.SupabaseBillService = SupabaseBillService;';
    vm.runInContext(code, ctx);
  }

  // 1. Guest mode load renders complete SPV dashboard instead of stuck loading banner
  await ctx.SpvFinance.load(true);
  assert.ok(!rootEl.innerHTML.includes('正在載入建坤 SPV 財務追蹤資料'));
  assert.ok(rootEl.innerHTML.includes('CCK001 高振實業'));
  assert.ok(rootEl.innerHTML.includes('3,249,422'));
  assert.equal(ctx.SpvFinance.state.source, 'fallback');

  // 2. Guest mode local save & reload persistence (no cloudAvailable ReferenceError)
  const saveRes = await ctx.SupabaseBillService.saveSpvPlantModel({
    ...ctx.SPV_DEFAULT_MODELS[0],
    assumptions_json: { ...ctx.SPV_DEFAULT_MODELS[0].assumptions_json, unit_capex_untaxed: 42000 }
  });
  assert.equal(saveRes.synced, false);

  const rowRes = await ctx.SupabaseBillService.upsertSpvMonthlyRow({
    ...ctx.SPV_DEFAULT_MONTHLY_RECORDS[5],
    report_actual_kwh: 141000
  });
  assert.equal(rowRes.synced, false);

  await ctx.SpvFinance.load(true);
  assert.equal(ctx.SpvFinance.getActiveModel().assumptions_json.unit_capex_untaxed, 42000);

  // 3. Authenticated real user loads directly from Supabase cloud tables
  ctx.BillAuth.user = { id: 'real-auth-uuid', email: 'david@acmepoint.internal' };
  await ctx.SpvFinance.load(true);
  assert.equal(ctx.SpvFinance.state.source, 'cloud');
  assert.ok(rootEl.innerHTML.includes('Supabase 雲端即時同步'));
});
