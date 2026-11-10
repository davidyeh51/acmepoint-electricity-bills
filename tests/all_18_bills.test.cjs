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

test('AUDITED_BILLS_REGISTRY has all 18 verified bills', () => {
  assert.equal(context.AUDITED_BILLS_REGISTRY.length, 18);
});

test('Every audited bill in 18 bills has complete and valid figures', () => {
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

test('getAuditedBillMatch finds new 6 bills correctly', () => {
  // Test Wujiawei 115/11
  const wujiawei = context.getAuditedBillMatch(null, '11-63-0824-95-9_214657_1.pdf');
  assert.ok(wujiawei, 'Match Wujiawei 115/11 failed');
  assert.equal(wujiawei.electric_number, '11-63-0824-95-9');
  assert.equal(wujiawei.total_kwh, 568635);
  assert.equal(wujiawei.net_payable_amount, 2896522);

  // Test Tainan Annan
  const annan = context.getAuditedBillMatch(null, '10-57-1231-91-1_214315_1.pdf');
  assert.ok(annan, 'Match Annan failed');
  assert.equal(annan.electric_number, '10-57-1231-91-1');
  assert.equal(annan.installed_capacity_kw, 771.75);
  assert.equal(annan.total_kwh, 99039);
  assert.equal(annan.net_payable_amount, 447124);

  // Test Kaohsiung Qianzhen
  const qianzhen = context.getAuditedBillMatch(null, '11-24-4010-95-5_214726_1.pdf');
  assert.ok(qianzhen, 'Match Qianzhen failed');
  assert.equal(qianzhen.electric_number, '11-24-4010-95-5');
  assert.equal(qianzhen.installed_capacity_kw, 438.36);
  assert.equal(qianzhen.total_kwh, 51194);
  assert.equal(qianzhen.net_payable_amount, 256778);
});
