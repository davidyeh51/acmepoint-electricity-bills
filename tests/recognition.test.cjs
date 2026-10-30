const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const context={console,Date,deriveSiteNameFromLocation:()=>'',currentBills:[]};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'bill-recognition.js'),'utf8'),context);
const fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'bill-fixtures.json'),'utf8'));
for(const fixture of fixtures)test(fixture.name,()=>{
 const actual=context.validateBillRecognition(context.parseTaipowerBillFromText(fixture.text,fixture.text.split('\n'),fixture.filename||'test.pdf'));
 for(const [key,value] of Object.entries(fixture.expected))assert.equal(actual[key],value,key+' '+JSON.stringify(actual.parse_warnings));
});
test('PDF text is sorted into rows before parsing',()=>{
 const items=[{str:'right',transform:[0,0,0,0,100,100]},{str:'below',transform:[0,0,0,0,20,80]},{str:'left',transform:[0,0,0,0,20,101]}];
 assert.equal(context.pdfTextRows(items).join('\n'),'left right\nbelow');
});
