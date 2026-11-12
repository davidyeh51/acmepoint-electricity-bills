const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function makeElement(id) {
  const el = {
    id,
    _text: '',
    _html: '',
    value: '',
    disabled: false,
    dataset: {},
    children: [],
    classList: { contains: () => false, add: () => {}, remove: () => {} },
    append(...nodes) {
      for (const n of nodes) this.children.push(n);
    },
    replaceChildren(...nodes) {
      this.children = [...nodes];
      if (!this.children.length) this.value = '';
    }
  };
  Object.defineProperty(el, 'textContent', {
    get() { return el._text; },
    set(v) { el._text = String(v ?? ''); }
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) { el._html = String(v ?? ''); }
  });
  return el;
}

function buildHarness({ permissionDenied = true } = {}) {
  const elements = new Map();
  for (const id of [
    'trendStatus', 'trendRefresh', 'trendExport', 'trendPlant', 'trendGrain',
    'trendRevenue', 'trendRevenueTitle', 'trendYearRevenueHeader', 'trendPeriod',
    'trendMetrics', 'trendQuality', 'trendEnergyChart', 'trendRevenueChart',
    'trendYieldChart', 'trendYearRows', 'trendBillRows', 'trendIssues',
    'trendAuditSummary', 'trendFullYears', 'trendScenarioCapacity',
    'trendScenarioFactor', 'trendScenarioSource', 'trendScenarioResult', 'trendsView'
  ]) {
    elements.set(id, makeElement(id));
  }
  elements.get('trendGrain').value = 'period';
  elements.get('trendRevenue').value = 'purchase_amount';
  elements.get('trendScenarioFactor').value = '100';
  elements.get('trendScenarioSource').value = 'average';

  const storage = new Map();
  const mockSupabaseClient = {
    from() {
      const builder = {
        select() { return builder; },
        order() { return builder; },
        eq() { return builder; },
        or() { return builder; },
        update() { return builder; },
        upsert() { return Promise.resolve({ error: { message: 'permission denied for table electricity_bills' } }); },
        limit() { return builder; },
        range() {
          if (permissionDenied) {
            return Promise.resolve({ data: null, count: null, error: { message: 'permission denied for table electricity_bills' } });
          }
          const seed = context.AUDITED_BILLS_REGISTRY.slice(0, 2);
          return Promise.resolve({ data: seed, count: seed.length, error: null });
        },
        single() {
          return Promise.resolve({ data: null, error: { message: 'permission denied for table electricity_bills' } });
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: { message: 'permission denied for table electricity_bills' } });
        },
        then(resolve, reject) {
          return this.range().then(resolve, reject);
        }
      };
      return builder;
    },
    storage: { from() { return { createSignedUrl: async () => ({ data: null, error: { message: 'denied' } }) }; } }
  };

  const context = {
    console,
    Date,
    Intl,
    URL,
    URLSearchParams,
    setTimeout,
    indexedDB: null,
    toastMessages: [],
    showToast(msg, isErr) { context.toastMessages.push({ msg, isErr }); },
    BillAuth: { profile: { username: '團隊成員', role: 'member', active: true }, requireUser() {} },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k)
    },
    location: { hash: '', search: '', origin: 'https://example.test', pathname: '/', href: 'https://example.test/' },
    history: { replaceState() {} },
    document: {
      title: 'Test',
      getElementById: (id) => elements.get(id) || null,
      createElement: (tag) => ({ tagName: tag.toUpperCase(), value: '', textContent: '' })
    },
    supabase: { createClient: () => mockSupabaseClient }
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);

  for (const file of ['audited-bills-data.js', 'bill-recognition.js', 'trends-core.js', 'supabase-client.js', 'plant-trends.js']) {
    let code = fs.readFileSync(path.join(root, file), 'utf8');
    if (file === 'supabase-client.js') code += '\n;globalThis.SupabaseBillService = SupabaseBillService;';
    if (file === 'plant-trends.js') code += '\n;globalThis.PlantTrends = PlantTrends;';
    vm.runInContext(code, context);
  }
  return { context, elements };
}

test('PlantTrends.load falls back cleanly on Supabase permission denied error', async () => {
  const { context, elements } = buildHarness({ permissionDenied: true });
  await context.PlantTrends.load();

  const statusText = elements.get('trendStatus').textContent;
  assert.ok(!statusText.includes('資料讀取失敗'), `Unexpected error status: ${statusText}`);
  assert.ok(!statusText.includes('permission denied'), `Should not leak raw error: ${statusText}`);
  assert.equal(context.PlantTrends.data.length, context.AUDITED_BILLS_REGISTRY.length);

  const options = elements.get('trendPlant').children;
  const expectedPlantCount = new Set(context.AUDITED_BILLS_REGISTRY.map(b => b.electric_number)).size;
  assert.equal(options.length, expectedPlantCount, 'All plants with audited bills should be populated in dropdown');
  assert.ok(options.some(o => o.value === '21-60-1433-90-2'), 'New Miaoli plant should appear in trendPlant selector');
  assert.ok(options.some(o => o.value === '08-40-8620-12-7'), 'Changhua Lukang plant should appear in trendPlant selector');
  assert.ok(options.some(o => o.value === '11-71-0067-91-9'), 'CCK001 Gaozhen plant should appear in trendPlant selector');
  assert.ok(options.some(o => o.value === '10-56-4770-02-1'), 'Tainan Annan Gongxue Rd plant (10-56-4770-02-1) should appear in trendPlant selector');
  assert.equal(elements.get('trendExport').disabled, false);

  for (const opt of options) {
    elements.get('trendPlant').value = opt.value;
    context.PlantTrends.selectPlant();
    assert.ok(context.PlantTrends.model, `Model missing for ${opt.value}`);
    assert.ok(context.PlantTrends.model.periods.length >= 1, `Expected >=1 valid period for ${opt.value}`);
  }
});

test('PlantTrends.load prefers Supabase cloud data when permission is granted', async () => {
  const { context, elements } = buildHarness({ permissionDenied: false });
  await context.PlantTrends.load();

  assert.equal(context.PlantTrends.data.length, 2);
  assert.ok(elements.get('trendStatus').textContent.includes('已載入雲端完整歷史 2 筆'));
});

test('SupabaseBillService.importDispatchText and updateBill fall back cleanly under permission denied', async () => {
  const { context } = buildHarness({ permissionDenied: true });
  const dispatchRes = await context.SupabaseBillService.importDispatchText('[08-40-8620-12-7] 美傢家具鹿港廠1測試');
  assert.equal(dispatchRes.success, true);

  const editRes = await context.SupabaseBillService.updateBill(21, { site_name: '苗栗銅鑼民治路(測試)' });
  assert.equal(editRes.synced, false);
  const local = context.SupabaseBillService.getLocalBills();
  assert.ok(local.some(b => b.id === 21 && b.site_name === '苗栗銅鑼民治路(測試)'));
});
