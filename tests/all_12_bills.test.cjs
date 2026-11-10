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

test('AUDITED_BILLS_REGISTRY has all 12 verified bills', () => {
  assert.equal(context.AUDITED_BILLS_REGISTRY.length, 12);
});

test('Every audited bill has complete and valid figures', () => {
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

test('getAuditedBillMatch finds bill by filename and hash', () => {
  const matchByName = context.getAuditedBillMatch(null, '03-54-8093-99-5_213400_1.pdf');
  assert.ok(matchByName, 'Match by filename failed');
  assert.equal(matchByName.electric_number, '03-54-8093-99-5');
  assert.equal(matchByName.total_kwh, 29744);
  assert.equal(matchByName.net_payable_amount, 160986);

  const matchEpc = context.getAuditedBillMatch(null, '1150901-1150930中租迪和股份有限公司EPC計費通知書11-73-5518-95-1.pdf');
  assert.ok(matchEpc, 'Match EPC failed');
  assert.equal(matchEpc.electric_number, '11-73-5518-95-1');
  assert.equal(matchEpc.total_kwh, 52240);
  assert.equal(matchEpc.net_payable_amount, 263597);
});
