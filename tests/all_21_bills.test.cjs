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

test('AUDITED_BILLS_REGISTRY has all 26 verified bills', () => {
  assert.equal(context.AUDITED_BILLS_REGISTRY.length, 26);
});

test('Every audited bill in registry has complete and valid figures', () => {
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

test('getAuditedBillMatch finds newly added bill 08-40-8620-12-7_215136_1.pdf', () => {
  const match = context.getAuditedBillMatch('ec8824b5284be785b6ec61e4b13e893a4eb51414323d3d8fd4fb5dddafd8355d', '08-40-8620-12-7_215136_1.pdf');
  assert.ok(match, 'Match 08-40-8620-12-7_215136_1.pdf failed');
  assert.equal(match.electric_number, '08-40-8620-12-7');
  assert.equal(match.bill_year_month, '115年11月');
  assert.equal(match.total_kwh, 199796);
  assert.equal(match.net_payable_amount, 888787);
  assert.equal(match.site_name, '美傢家具鹿港廠1');
  assert.equal(match.customer_name, '中租迪和股份有限公司');
  assert.equal(match.plant_location, '彰化縣鹿港鎮上林段598、599地號');
});

test('getAuditedBillMatch finds newly added bill 21-60-1433-90-2_215141_1.pdf', () => {
  const match = context.getAuditedBillMatch('e3b7b59e8678ab49adc4e56c4ed787f019bd15105e41212b457006e0986582ac', '21-60-1433-90-2_215141_1.pdf');
  assert.ok(match, 'Match 21-60-1433-90-2_215141_1.pdf failed');
  assert.equal(match.electric_number, '21-60-1433-90-2');
  assert.equal(match.bill_year_month, '115年11月');
  assert.equal(match.total_kwh, 68398);
  assert.equal(match.net_payable_amount, 368287);
  assert.equal(match.site_name, '苗栗銅鑼民治路');
  assert.equal(match.customer_name, '中租迪和股份有限公司');
  assert.equal(match.installed_capacity_kw, 646.695);
});

test('CCK001 高振實業 (建坤 SPV) 5 bills match PDF totals and settlement math', () => {
  const spvBills = context.AUDITED_BILLS_REGISTRY.filter(b => b.electric_number === '11-71-0067-91-9');
  assert.equal(spvBills.length, 5);
  assert.equal(spvBills.reduce((s, b) => s + b.total_kwh, 0), 831077);
  assert.equal(spvBills.reduce((s, b) => s + b.purchase_amount, 0), 3099087);
  assert.equal(spvBills.reduce((s, b) => s + b.tax_amount, 0), 154954);
  assert.equal(spvBills.reduce((s, b) => s + b.meter_rental_amount, 0), -4619);
  assert.equal(spvBills.reduce((s, b) => s + b.net_payable_amount, 0), 3249422);

  const settleBill = context.getAuditedBillMatch('1de47c82e2929aa61413a45568dd1054d48d80066480853e0db09b0e9331ea27', '11508 台電通知單 CCK001高振實業(1150801-1150812).pdf');
  assert.ok(settleBill);
  assert.equal(settleBill.site_name, 'CCK001 高振實業');
  assert.equal(settleBill.customer_name, '建坤能源股份有限公司');
  assert.equal(settleBill.fit_rate, 3.729);
  assert.equal(settleBill.purchase_amount, 696485);

  const sepBill = context.getAuditedBillMatch('98ca2ef288e431f892c1b8119b034f3b77f5cc8df5291ac00c859316cd6070b7', '11510 台電通知單 CCK001高振實業(1150901-1150930).pdf');
  assert.ok(sepBill);
  assert.equal(sepBill.total_kwh, 189772);
  assert.equal(sepBill.net_payable_amount, 742060);
});
