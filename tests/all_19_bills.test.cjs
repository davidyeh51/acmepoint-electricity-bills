const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const context = { console, Date, deriveSiteNameFromLocation: () => '', currentBills: [] };
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'audited-bills-data.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'bill-recognition.js'), 'utf8'), context);

test('AUDITED_BILLS_REGISTRY has all 19 verified bills', () => {
  assert.equal(context.AUDITED_BILLS_REGISTRY.length, 19);
});

test('Every audited bill in 19 bills has complete and valid figures', () => {
  for (const b of context.AUDITED_BILLS_REGISTRY) {
    assert.ok(b.electric_number, `missing electric_number in ${b.filename}`);
    assert.ok(b.total_kwh != null && b.total_kwh >= 0, `invalid total_kwh in ${b.filename}`);
    assert.ok(b.net_payable_amount != null && b.net_payable_amount >= 0, `invalid net_payable_amount in ${b.filename}`);
    assert.ok(b.fit_rate != null && b.fit_rate > 0, `invalid fit_rate in ${b.filename}`);
    assert.ok(b.installed_capacity_kw != null && b.installed_capacity_kw > 0, `invalid capacity in ${b.filename}`);
    assert.ok(b.customer_name, `missing customer_name in ${b.filename}`);
    assert.ok(b.plant_location, `missing plant_location in ${b.filename}`);
    assert.ok(b.city, `missing city in ${b.filename}`);
    assert.ok(b.district, `missing district in ${b.filename}`);
  }
});

test('getAuditedBillMatch finds newly added bill 11-62-9140-94-9_213935_1.pdf', () => {
  const match = context.getAuditedBillMatch('f44e4a221d296c87bc6da2be0dc2ef9e2de708afc07142a98f96b7aecad423fe', '11-62-9140-94-9_213935_1.pdf');
  assert.ok(match, 'Match 11-62-9140-94-9_213935_1.pdf failed');
  assert.equal(match.electric_number, '11-62-9140-94-9');
  assert.equal(match.bill_year_month, '115年10月');
  assert.equal(match.total_kwh, 41504);
  assert.equal(match.net_payable_amount, 200380);
  assert.equal(match.site_name, '高雄岡山本工路');
});
