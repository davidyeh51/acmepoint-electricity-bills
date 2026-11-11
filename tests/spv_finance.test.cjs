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

  for (const file of ['audited-bills-data.js', 'spv-finance-data.js', 'spv-board-charts.js', 'spv-finance.js']) {
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

test('compute20YearFinancialModel matches duck v1.xlsx baseline (56,250/kWp, 80% PPA + 20% FIT, 4-stage O&M, Fixed Rent, CFADS DSCR)', () => {
  const ctx = loadSpvContext();
  const m = ctx.SPV_DEFAULT_MODELS[0];
  const fin = ctx.SpvFinance.compute20YearFinancialModel(m);

  assert.equal(Math.round(fin.capex_untaxed), 76395375);
  assert.equal(Math.round(fin.capex_total_cash), 80215144);
  assert.equal(Math.round(fin.loan_amount), 57296531);
  assert.equal(Math.round(fin.equity_y0), 22918613);
  assert.equal(fin.years.length, 21); // Y0 .. Y20

  // Verify exact duck v1.xlsx outputs
  assert.ok(Math.abs(fin.weighted_tariff - 4.73118) < 1e-6);
  assert.ok(Math.abs(fin.project_irr - 0.0339346) < 0.0001, `Expected project_irr ~3.393%, got ${fin.project_irr}`);
  assert.ok(Math.abs(fin.equity_irr - 0.053721) < 0.002, `Expected equity_irr ~5.37-5.39%, got ${fin.equity_irr}`);
  assert.ok(Math.abs(fin.project_npv - (-14537216.47)) < 2, `Expected project_npv -14,537,216.47, got ${fin.project_npv}`);
  assert.ok(Math.abs(fin.min_dscr - 1.154749) < 0.0001, `Expected min_dscr 1.155x, got ${fin.min_dscr}`);
  assert.deepEqual([...fin.dscr_fail_years], ['Y1', 'Y2', 'Y3']);
  assert.ok(Math.abs(fin.project_payback_years - 13.51068) < 0.001);
  assert.ok(Math.abs(fin.equity_payback_years - 15.321) < 0.01);
  assert.ok(Math.abs(fin.lcoe_untaxed - 3.653637) < 0.0001);
  assert.equal(Math.round(fin.total_generation_kwh), 33890303);
  assert.equal(Math.round(fin.total_revenue_untaxed), 160341123);
  assert.ok(fin.equity_moic > 1.80 && fin.equity_moic < 1.82);

  // Waterfall identity checks: Revenue - OPEX = EBITDA; EBITDA - Debt - Tax + VAT&Decom = Equity Returned
  assert.ok(Math.abs((fin.total_revenue_untaxed - fin.total_opex_20y) - fin.total_ebitda) < 1e-4);
  assert.ok(Math.abs((fin.total_ebitda - fin.total_debt_service_20y - fin.total_tax_20y + fin.total_vat_recovery_decom_net) - fin.total_equity_returned) < 1e-4);

  // Lower EPC CapEx sensitivity (42,000 NT$/kWp -> higher project IRR > 5.5% and all-year DSCR >= 1.2)
  const tunedModel = {
    ...m,
    assumptions_json: {
      ...m.assumptions_json,
      unit_capex_untaxed: 42000
    }
  };
  const tunedFin = ctx.SpvFinance.compute20YearFinancialModel(tunedModel);
  assert.ok(tunedFin.project_irr > 0.055 && tunedFin.project_irr > fin.project_irr);
  assert.ok(tunedFin.equity_irr > tunedFin.project_irr);
  assert.ok(tunedFin.min_dscr >= 1.2);
});

test('reconcileSpvMonthlyTracking decomposes YTD Volume vs Tariff variance accurately', () => {
  const ctx = loadSpvContext();
  const res = ctx.SpvFinance.reconcileSpvMonthlyTracking(
    ctx.SPV_DEFAULT_MODELS[0],
    ctx.SPV_DEFAULT_MONTHLY_RECORDS,
    ctx.AUDITED_BILLS_REGISTRY
  );
  const s = res.summary;
  // Volume variance: (831,077 - 754,175) * 4.73118 = +363,837
  assert.ok(Math.abs(s.volume_variance_amount - 363837) < 5);
  // Tariff/PPA gap: 3,099,087 - 831,077 * 4.73118 = -832,888
  assert.ok(Math.abs(s.tariff_variance_amount - (-832888)) < 5);
  // Realized / planned revenue = 3,099,087 / (754,175 * 4.73118) = 86.85%
  assert.ok(Math.abs(s.revenue_vs_plan_pct - 0.868545) < 0.0002);
  assert.ok(Math.abs(s.actual_effective_tariff - 3.729) < 0.001);
});

test('computeBoardRoiScenarios & SpvBoardCharts produce all 5 Board SVGs and Printable Brief HTML', () => {
  const ctx = loadSpvContext();
  const m = ctx.SPV_DEFAULT_MODELS[0];
  const tracked = ctx.SpvFinance.reconcileSpvMonthlyTracking(
    m,
    ctx.SPV_DEFAULT_MONTHLY_RECORDS,
    ctx.AUDITED_BILLS_REGISTRY
  );
  const baseFin = ctx.SpvFinance.compute20YearFinancialModel(ctx.SpvFinance.getInvestmentBaselineModel(m));
  const scenarios = ctx.SpvFinance.computeBoardRoiScenarios(m, tracked);

  assert.equal(scenarios.items.length, 4);
  assert.equal(scenarios.verdict.tier, 'GEN_BEAT_TARIFF_GAP');
  assert.equal(scenarios.verdict.tone, 'amber');
  assert.ok(scenarios.verdict.headline.includes('110.2%'));

  const svg1 = ctx.SpvBoardCharts.buildEquityPaybackJCurveSvg(baseFin, tracked.financial_model, m, scenarios);
  const svg2 = ctx.SpvBoardCharts.buildCashWaterfallSvg(baseFin, m);
  const svg3 = ctx.SpvBoardCharts.buildDscrDebtCoverageSvg(baseFin, m);
  const svg4 = ctx.SpvBoardCharts.buildBoardScenarioComparisonSvg(scenarios, m);
  const svg5 = ctx.SpvFinance.buildGenerationSvgChart(tracked.rows, m);

  for (const svg of [svg1, svg2, svg3, svg4, svg5]) {
    assert.ok(svg.startsWith('<svg '), 'Expected SVG output');
    assert.ok(!svg.includes('NaN'), 'SVG must not contain NaN coordinates');
    assert.ok(!svg.includes('undefined'), 'SVG must not contain undefined values');
  }
  assert.ok(svg3.includes('DSCR'));
  assert.ok(svg4.includes('原投資核定案'));
  assert.ok(svg5.includes('26-05') && svg5.includes('27-04'));

  const briefHtml = ctx.SpvBoardCharts.buildPrintableBoardBriefHtml({
    model: m,
    baseFin,
    liveFin: tracked.financial_model,
    scenarios,
    rows: tracked.rows,
    summary: tracked.summary
  });
  assert.ok(briefHtml.includes('<!DOCTYPE html>'));
  assert.ok(briefHtml.includes('CCK001 高振實業'));
  assert.ok(briefHtml.includes('圖表一') && briefHtml.includes('圖表四'));
});

test('Reusable Board Template supports arbitrary second plant (CCK002 100% FIT) and auto-generates 12M schedule', () => {
  const ctx = loadSpvContext();
  const cck002 = {
    id: 2,
    spv_code: 'CK-SPV',
    spv_name: '建坤能源股份有限公司',
    spv_tax_id: '00180909',
    plant_code: 'CCK002',
    site_name: 'CCK002 永康示範二廠',
    electric_number: '11-71-9999-88-1',
    contract_number: '115-01-999999',
    plant_location: '台南市永康區中正路 100 號',
    capacity_kwp: 2000,
    cod_date: '2027-01-15',
    tracking_start_date: '2027-01-15',
    tracking_end_date: '2027-12-31',
    target_daily_yield: 3.60,
    annual_degradation_rate: 0.004,
    fit_rate: 3.90,
    provisional_trial_rate: 3.90,
    ppa_share: 0,
    ppa_rate: 0,
    vat_rate: 0.05,
    assumptions_json: {
      template_version: 'duck-v1',
      unit_capex_untaxed: 50000,
      extra_capex_untaxed: 0,
      om_mode: 'fixed_per_kwp',
      om_unit_y1_5: 445,
      om_unit_y6_10: 500,
      om_unit_y11_15: 550,
      om_unit_y16_20: 610,
      rent_mode: 'pct_revenue',
      rent_pct_revenue: 0.10,
      rent_fixed_annual: 0,
      loan_ratio: 0.75,
      loan_interest_rate: 0.025,
      loan_years: 15,
      dscr_target: 1.2
    }
  };

  const rows12 = ctx.SpvFinance.generateStandard12MonthlyRows(cck002);
  assert.equal(rows12.length, 12);
  assert.equal(rows12[0].tracking_year_month, '2027-01');
  assert.equal(rows12[0].days, 17); // Jan 15 .. Jan 31
  assert.equal(rows12[11].tracking_year_month, '2027-12');

  // Feed 2 months actual performance beating budget
  rows12[0].report_actual_kwh = rows12[0].predicted_kwh + 5000;
  rows12[0].taipower_billed_kwh = rows12[0].predicted_kwh + 5000;
  rows12[0].bill_purchase_amount = Math.round((rows12[0].predicted_kwh + 5000) * 3.90);

  const tracked = ctx.SpvFinance.reconcileSpvMonthlyTracking(cck002, rows12, []);
  const scenarios = ctx.SpvFinance.computeBoardRoiScenarios(cck002, tracked);
  assert.equal(scenarios.verdict.tone, 'emerald');

  const sectionHtml = ctx.SpvBoardCharts.buildBoardRoiSectionHtml({
    model: cck002,
    baseFin: tracked.financial_model,
    liveFin: tracked.financial_model,
    scenarios,
    summary: tracked.summary
  });
  assert.ok(sectionHtml.includes('CCK002 永康示範二廠'));
  assert.ok(!sectionHtml.includes('CCK001 高振實業'));
});

test('SpvFinance.render renders full CCK001 + Board ROI charts into spvFinanceRoot without error', () => {
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
  for (const file of ['audited-bills-data.js', 'spv-finance-data.js', 'spv-board-charts.js', 'spv-finance.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  }
  context.currentBills = context.AUDITED_BILLS_REGISTRY;
  context.SpvFinance.state.models = context.SPV_DEFAULT_MODELS;
  context.SpvFinance.state.monthly = context.SPV_DEFAULT_MONTHLY_RECORDS;
  context.SpvFinance.render();
  assert.ok(rootEl.innerHTML.includes('CCK001 高振實業'));
  assert.ok(rootEl.innerHTML.includes('BOARD ROI TEMPLATE'));
  assert.ok(rootEl.innerHTML.includes('spvNewPlantModal'));
  assert.ok(rootEl.innerHTML.includes('831,077'));
  assert.ok(rootEl.innerHTML.includes('3,249,422'));
});

test('SpvFinance.load + SupabaseBillService.fetchSpvData/saveSpvPlantModel/createSpvPlantModel work under guest and cloud modes', async () => {
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

  for (const file of ['audited-bills-data.js', 'supabase-client.js', 'spv-finance-data.js', 'spv-board-charts.js', 'spv-finance.js']) {
    let code = fs.readFileSync(path.join(root, file), 'utf8');
    if (file === 'supabase-client.js') code += '\n;globalThis.SupabaseBillService = SupabaseBillService;';
    vm.runInContext(code, ctx);
  }

  // 0. Stale pre-duck-v1 local override is ignored automatically
  storage.set('SPV_PLANT_OVERRIDES_V1', JSON.stringify({
    '11-71-0067-91-9': {
      electric_number: '11-71-0067-91-9',
      assumptions_json: { template_version: 'v1.2', unit_capex_untaxed: 51500 }
    }
  }));
  await ctx.SpvFinance.load(true);
  assert.equal(ctx.SpvFinance.getActiveModel().assumptions_json.unit_capex_untaxed, 56250);

  // 1. Guest mode load renders complete SPV dashboard instead of stuck loading banner
  assert.ok(!rootEl.innerHTML.includes('正在載入建坤 SPV 財務追蹤資料'));
  assert.ok(rootEl.innerHTML.includes('CCK001 高振實業'));
  assert.ok(rootEl.innerHTML.includes('BOARD ROI TEMPLATE'));
  assert.equal(ctx.SpvFinance.state.source, 'fallback');

  // 2. Guest mode local save & create plant reload persistence
  const saveRes = await ctx.SupabaseBillService.saveSpvPlantModel({
    ...ctx.SPV_DEFAULT_MODELS[0],
    assumptions_json: { ...ctx.SPV_DEFAULT_MODELS[0].assumptions_json, unit_capex_untaxed: 42000 }
  });
  assert.equal(saveRes.synced, false);

  const customPlant = {
    ...ctx.SPV_DEFAULT_MODELS[0],
    plant_code: 'CCK002',
    site_name: 'CCK002 二期案場',
    electric_number: '11-71-8888-77-1'
  };
  const customRows = ctx.SpvFinance.generateStandard12MonthlyRows(customPlant);
  const createRes = await ctx.SupabaseBillService.createSpvPlantModel(customPlant, customRows);
  assert.equal(createRes.synced, false);

  await ctx.SpvFinance.load(true);
  assert.equal(ctx.SpvFinance.getActiveModel().assumptions_json.unit_capex_untaxed, 42000);
  assert.equal(ctx.SpvFinance.state.models.length, 2);

  // 3. Authenticated real user loads directly from Supabase cloud tables
  ctx.BillAuth.user = { id: 'real-auth-uuid', email: 'david@acmepoint.internal' };
  await ctx.SpvFinance.load(true);
  assert.equal(ctx.SpvFinance.state.source, 'cloud');
  assert.ok(rootEl.innerHTML.includes('Supabase 雲端即時同步'));
});
