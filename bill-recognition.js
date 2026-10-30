// Quality checks run before a bill is counted as successfully recognized.
function validateBillRecognition(bill) {
  const fields = {electric_number:'電號',bill_year_month_ad:'帳單年月',billing_period:'計費期間',customer_name:'客戶名稱',plant_location:'設置地點',installed_capacity_kw:'裝置容量',city:'縣市',tax_id:'統一編號',purchase_amount:'購電電費',tax_amount:'營業稅',total_bill_amount:'電費合計',total_kwh:'購電度數',net_payable_amount:'應付總金額'};
  const warnings=[];
  for (const [key,label] of Object.entries(fields)) {
    const value=bill[key];
    if(value===null||value===undefined||value===''||(typeof value==='number'&&!Number.isFinite(value))) warnings.push('缺少'+label);
  }
  if(bill.installed_capacity_kw!==null&&Number(bill.installed_capacity_kw)<=0) warnings.push('裝置容量需大於零');
  if(bill.total_kwh!==null&&Number(bill.total_kwh)<0) warnings.push('購電度數不可為負值');
  if(bill.purchase_amount!=null&&bill.tax_amount!=null&&bill.total_bill_amount!=null&&Math.abs(Number(bill.purchase_amount)+Number(bill.tax_amount)-Number(bill.total_bill_amount))>2) warnings.push('購電電費與營業稅加總不符');
  if(bill.total_bill_amount!=null&&bill.net_payable_amount!=null&&bill.meter_rental_amount!=null&&Math.abs(Number(bill.total_bill_amount)+Number(bill.meter_rental_amount)-Number(bill.net_payable_amount))>2) warnings.push('電費合計、調整費用與應付金額不符');
  if(bill.total_kwh!=null&&bill.fit_rate!=null&&bill.purchase_amount!=null&&(!bill.machines||bill.machines.length<=1)&&Math.abs(Number(bill.total_kwh)*Number(bill.fit_rate)-Number(bill.purchase_amount))>Math.max(3,Number(bill.purchase_amount)*0.005)) warnings.push('度數、費率與購電電費不符');
  if(bill.machines?.length && bill.total_kwh!=null && Math.abs(bill.machines.reduce((s,m)=>s+m.kwh,0)-Number(bill.total_kwh))>1) warnings.push('機組加總與購電度數不符');
  if(bill.bill_type==='CONSUMPTION'){
    warnings.length=0;
    for(const [key,label] of Object.entries({electric_number:'電號',bill_year_month_ad:'期別',consumption_amount:'費用金額'}))if(bill[key]==null||bill[key]==='')warnings.push('缺少'+label);
  }
  if(bill.bill_type!=='CONSUMPTION' && bill.tax_id && !/^\d{8}$/.test(bill.tax_id)) warnings.push('統一編號需為 8 碼');
  bill.parse_warnings=[...new Set(warnings)];
  bill.status=warnings.length?'NEEDS_REVIEW':'PARSED';
  return bill;
}
function normalizeBillText(text) {
  return String(text||'').normalize('NFKC').replace(/臺/g,'台').replace(/([\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])/g,'$1').replace(/[“”‘’]/g,'').replace(/[‐‑–—−]/g,'-').replace(/(\d)\s*\.\s*(\d)/g,'$1.$2').replace(/(\d),\s*(\d{3})/g,'$1,$2').replace(/(\d)\s+(?=[年月日])/g,'$1').replace(/([年月])\s+(\d)/g,'$1$2');
}
function pdfTextRows(items) {
  const rows=[];
  for(const item of items.filter(x=>x.str).sort((a,b)=>b.transform[5]-a.transform[5]||a.transform[4]-b.transform[4])) {
    const y=item.transform[5]; let row=rows.find(x=>Math.abs(x.y-y)<3);
    if(!row){row={y,items:[]};rows.push(row);} row.items.push(item);
  }
  return rows.sort((a,b)=>b.y-a.y).map(row=>row.items.sort((a,b)=>a.transform[4]-b.transform[4]).map(x=>x.str).join(' '));
}
async function recognizeBillPdf(file) {
  if(!window.pdfjsLib) throw new Error('PDF 讀取元件未載入，請重新整理後再試。');
  const bytes=await file.arrayBuffer();
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
  let pdf,worker;
  try {
    pdf=await pdfjsLib.getDocument({data:bytes.slice(0)}).promise;
    if(pdf.numPages>20)throw new Error('單份電費單最多支援 20 頁，請拆分後上傳。');
    const pages=[],direct=[];
    for(let i=1;i<=pdf.numPages;i++){
      const page=await pdf.getPage(i);pages.push(page);
      direct.push(...pdfTextRows((await page.getTextContent()).items));
    }
    let lines=direct.map(normalizeBillText);
    let bill=validateBillRecognition(parseTaipowerBillFromText(lines.join('\n'),lines,file.name));
    bill.extraction_mode='DIRECT_PDF';
    if(bill.parse_warnings.length){
      if(!window.Tesseract)throw new Error('此檔案需要 OCR，但辨識元件未載入，請重新整理後再試。');
      const status=document.getElementById('uploadStatusText');
      if(status)status.textContent='正在辨識整頁文字：'+file.name;
      worker=await Tesseract.createWorker('chi_tra+eng',1,{logger:info=>{
        if(status&&info.status==='recognizing text')status.textContent='正在辨識 '+file.name+'：'+Math.round((info.progress||0)*100)+'%';
      }});
      await worker.setParameters({preserve_interword_spaces:'1'});
      const ocr=[];
      for(let i=0;i<pages.length;i++){
        const viewport=pages[i].getViewport({scale:2.2});
        const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        await pages[i].render({canvasContext:ctx,viewport}).promise;
        const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
        for(let p=0;p<pixels.data.length;p+=4){
          const gray=0.299*pixels.data[p]+0.587*pixels.data[p+1]+0.114*pixels.data[p+2];
          const value=gray<185?0:255;pixels.data[p]=pixels.data[p+1]=pixels.data[p+2]=value;pixels.data[p+3]=255;
        }
        ctx.putImageData(pixels,0,0);
        const {data}=await worker.recognize(canvas);
        ocr.push(...String(data.text||'').split(/\r?\n/).map(normalizeBillText));
        canvas.width=0;canvas.height=0;
      }
      const ocrBill=validateBillRecognition(parseTaipowerBillFromText(ocr.join('\n'),ocr,file.name));
      if(ocrBill.parse_warnings.length<=bill.parse_warnings.length){
        for(const [key,value] of Object.entries(bill))if((ocrBill[key]===null||ocrBill[key]===undefined||ocrBill[key]==='')&&value!=null)ocrBill[key]=value;
        bill=validateBillRecognition(ocrBill);
      }
      bill.extraction_mode='FULL_PAGE_OCR'; bill.raw_text=ocr.join('\n');
    }
    if(!bill.electric_number&&!bill.total_kwh&&!bill.net_payable_amount)throw new Error('無法辨識有效的電費單內容；請確認 PDF 清晰、未加密且為電費通知單。');
    bill.file_hash=hash;bill.file_size=file.size;
    return validateBillRecognition(bill);
  }catch(error){
    if(error.name==='PasswordException')throw new Error('PDF 受到密碼保護，請解除密碼後再上傳。');
    throw error;
  }finally{
    if(worker)await worker.terminate();
    if(pdf)await pdf.destroy();
  }
}
function parseTaipowerBillFromText(rawText, rawLines, filename) {
  const text=normalizeBillText(rawText);
  const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const bill={filename,raw_text:text,bill_type:'FIT'};
  const find=(pattern)=>{const m=text.match(pattern);return m?m[1].trim():'';};
  const number=(label)=>{const m=text.split('發票資訊')[0].match(new RegExp(label+'\\s*[:：]?\\s*(-?\\s*\\d[\\d,]*(?:\\.\\d+)?)(?![\\d,.\\-])'));return m?Number(m[1].replace(/[,\s]/g,'')):null;};
  bill.electric_number=find(/(\d{2}-\d{2}-\d{4}-\d{2}-\d)/)||(filename.match(/(\d{2}-\d{2}-\d{4}-\d{2}-\d)/)||[])[1]||'';
  bill.contract_number=find(/(\d{2}-[A-Za-z]{2}-\d{3}-\d{4})/);
  bill.bill_year_month=find(/(\d{3}年\s*\d{1,2}月)\s*再生能源/).replace(/\s/g,'');
  bill.billing_period='';bill.billing_start_ad=null;bill.billing_end_ad=null;
  const period=text.match(/(\d{3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*[~～至到-]\s*(\d{3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/)||
    text.match(/(\d{3})[./](\d{1,2})[./](\d{1,2})\s*[~～至到-]\s*(\d{3})[./](\d{1,2})[./](\d{1,2})/);
  const pad=x=>String(x).padStart(2,'0');
  if(period){
    const [y1,m1,d1,y2,m2,d2]=period.slice(1).map(Number);
    const valid=(y,m,d)=>{const dt=new Date(Date.UTC(y+1911,m-1,d));return m>=1&&m<=12&&dt.getUTCDate()===d&&dt.getUTCMonth()===m-1;};
    if(valid(y1,m1,d1)&&valid(y2,m2,d2)){
      bill.billing_start_ad=(y1+1911)+'-'+pad(m1)+'-'+pad(d1);
      bill.billing_end_ad=(y2+1911)+'-'+pad(m2)+'-'+pad(d2);
      if(bill.billing_start_ad<=bill.billing_end_ad)bill.billing_period=y1+'年'+pad(m1)+'月'+pad(d1)+'日~'+y2+'年'+pad(m2)+'月'+pad(d2)+'日';
      else bill.billing_start_ad=bill.billing_end_ad=null;
    }
  }
  if(!bill.bill_year_month)bill.bill_year_month=find(/(\d{3}年\d{1,2}月)/);
  const month=bill.bill_year_month.match(/(\d{3})年(\d{1,2})月/);
  bill.bill_year_month_ad=month&&Number(month[2])<=12?(Number(month[1])+1911)+'-'+pad(month[2]):null;
  bill.customer_name='';bill.customer_address='';
  for(let i=0;i<lines.length;i++){
    if(/先生\s*[/、]\s*女士|寶號/.test(lines[i])){
      bill.customer_name=lines[i].split(/先生|女士|寶號/)[0].trim()||(i?lines[i-1]:'');
      for(let j=i-1;j>=Math.max(0,i-5);j--)if(/[縣市].*[路街段巷號樓]/.test(lines[j])&&!/公司|電力/.test(lines[j])){bill.customer_address=lines[j];break;}
      break;
    }
  }
  if(!bill.customer_name)bill.customer_name=(text.match(/[\u4e00-\u9fff]{2,15}(?:股份)?有限公司/g)||[]).find(x=>!x.includes('台灣電力'))||'';
  bill.tax_id=find(/統一編號\s*[:：]?\s*(\d{8})\b/);
  bill.plant_location=find(/設(?:置|定)地點\s*[:：]?\s*([^\n]+)/);
  const city=bill.plant_location.match(/(?:台北|新北|桃園|台中|台南|高雄|基隆|新竹|嘉義)市|(?:新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|台東|澎湖|金門|連江)縣/);
  bill.city=city?city[0]:'';
  const district=bill.city?bill.plant_location.match(new RegExp(bill.city+'([^\\d縣市、]{1,5}?[區鄉鎮市])')):null;bill.district=district?district[1]:'';
  bill.installed_capacity_kw=number('(?:併聯總)?裝置容量');
  bill.grid_capacity_kw=number('(?:併聯總)?購售電容量')??bill.installed_capacity_kw;
  bill.purchase_amount=number('購電電費');bill.tax_amount=number('營業稅');
  bill.total_bill_amount=number('(?:本期)?電費合計');bill.net_payable_amount=number('應付總金額');
  const headerAmounts=text.match(/(\d{2}-\d{2}-\d{4}-\d{2}-\d)\s+(\d{2}-[A-Za-z]{2}-\d{3}-\d{4})\s+(-?[\d,]+)\s*元/);
  if(headerAmounts)bill.net_payable_amount=Number(headerAmounts[3].replace(/,/g,''));
  const rent=number('本期電表租費');bill.meter_rental_amount=rent==null?null:-Math.abs(rent);
  const machines=[];
  for(const m of text.matchAll(/機組\s*0?(\d+)\s+([0-9]+(?:\.[0-9]{1,6})?)\s+([\d,]+)\s+([\d,]+)\s*元?/g)){
    const rate=Number(m[2]),kwh=Number(m[3].replace(/,/g,'')),amount=Number(m[4].replace(/,/g,''));
    if(rate>0&&rate<20&&Math.abs(rate*kwh-amount)<=Math.max(3,amount*0.002)&&!machines.some(x=>x.name==='機組'+Number(m[1])&&x.kwh===kwh&&x.amount===amount))machines.push({name:'機組'+Number(m[1]),rate,kwh,amount});
  }
  bill.machines=machines;bill.machines_json=machines;
  const formula=text.match(/[=＝]\s*([\d,]+)\s*度/);
  bill.total_kwh=formula?Number(formula[1].replace(/,/g,'')):(machines.length?machines.reduce((s,m)=>s+m.kwh,0):null);
  if(bill.purchase_amount==null&&machines.length)bill.purchase_amount=machines.reduce((s,m)=>s+m.amount,0);
  const machineKwh=machines.reduce((s,m)=>s+m.kwh,0);
  bill.fit_rate=machines.length?(machineKwh?Number((machines.reduce((s,m)=>s+m.amount,0)/machineKwh).toFixed(4)):machines[0].rate):number('費率');
  const machineAmount=machines.reduce((s,m)=>s+m.amount,0);
  if(machines.length&&bill.tax_amount!=null&&bill.net_payable_amount!=null&&rent!=null&&Math.abs(machineAmount+bill.tax_amount-Math.abs(rent)-bill.net_payable_amount)<=2)bill.purchase_amount=machineAmount;
  if(bill.purchase_amount!=null&&bill.tax_amount!=null&&bill.net_payable_amount!=null&&rent!=null&&Math.abs(bill.purchase_amount+bill.tax_amount-Math.abs(rent)-bill.net_payable_amount)<=2)bill.total_bill_amount=bill.purchase_amount+bill.tax_amount;
  if(bill.total_bill_amount==null&&bill.purchase_amount!=null&&bill.tax_amount!=null)bill.total_bill_amount=bill.purchase_amount+bill.tax_amount;
  if(bill.tax_amount==null&&bill.total_bill_amount!=null&&bill.purchase_amount!=null)bill.tax_amount=bill.total_bill_amount-bill.purchase_amount;
  if(bill.total_bill_amount!=null&&bill.net_payable_amount!=null)bill.meter_rental_amount=bill.net_payable_amount-bill.total_bill_amount;
  bill.taipower_branch=find(/服務部門\s*[:：]\s*([^\n]+)/);bill.taipower_tel=find(/服務電話\s*[:：]\s*([^\n]+)/);
  bill.payment_account=find(/([^\n]*銀行[^\n]*(?:\n[\d]+號帳戶[^\n]*)?)/);
  bill.meter_read_curr=find(/本次抄表日\s*(\d{3}年\d{1,2}月\d{1,2}日)/);
  const cppa=/購電計費通知書|轉供度數|發電業者|發電電號/.test(text);
  if(cppa){
    bill.customer_name=find(/發電業者\s*[:：]?\s*([^\n]+)/)||bill.customer_name;
    bill.total_kwh=number('轉供度數')??number('計費度數')??bill.total_kwh;
    bill.purchase_amount=number('售電收入')??number('購電金額')??bill.purchase_amount;
    bill.net_payable_amount=number('應付總金額')??number('應付金額')??bill.net_payable_amount;
  }
  if(/繳費憑證|台電費用通知單/.test(filename)||(!/再生能源/.test(text)&&/高壓用電|繳費憑證|輸電費率/.test(text))){
    bill.bill_type='CONSUMPTION';bill.consumption_amount=number('繳費總金額');bill.consumption_kwh=null;
    if(!bill.electric_number&&text.includes('發電電號')){
      const generator=text.match(/[A-Z]{2}\d+\s+(\d{11})\s+[A-Z]{2}\d+/);
      if(generator){const n=generator[1];bill.electric_number=n.slice(0,2)+'-'+n.slice(2,4)+'-'+n.slice(4,8)+'-'+n.slice(8,10)+'-'+n[10];}
    }
    if(!bill.electric_number){
      const digits=Array.from(text.matchAll(/(?<!\d)(\d{11})(?!\d)/g)).map(x=>x[1]);
      if(digits.length===1){const n=digits[0];bill.electric_number=n.slice(0,2)+'-'+n.slice(2,4)+'-'+n.slice(4,8)+'-'+n.slice(8,10)+'-'+n[10];}
    }
    if(/輸電費率/.test(text)){
      const m=text.match(/([\d,]+)\s+(0\.\d+)\s+([\d,]+)\s*$/);
      if(m){const usage=Number(m[1].replace(/,/g,'')),rate=Number(m[2]),money=Number(m[3].replace(/,/g,''));if(Math.abs(usage*rate-money)<2){bill.consumption_amount=money;bill.consumption_kwh=usage;}}
    }
    if(bill.consumption_kwh==null){const peak=number('尖峯度數'),off=number('離峯度數');if(peak!=null&&off!=null)bill.consumption_kwh=peak+off;}
    if(!bill.bill_year_month_ad){const m=filename.match(/(?<!\d)(1\d{2})(0[1-9]|1[0-2])(?!\d)/);if(m){bill.bill_year_month=m[1]+'年'+Number(m[2])+'月';bill.bill_year_month_ad=(Number(m[1])+1911)+'-'+m[2];}}
    for(const key of ['total_kwh','purchase_amount','tax_amount','total_bill_amount','net_payable_amount','fit_rate'])bill[key]=null;
  }
  if(typeof currentBills!=='undefined'){
    const known=currentBills.find(x=>x.electric_number===bill.electric_number);
    if(known && !bill.city && known.city && known.plant_location){bill.plant_location=known.plant_location;bill.city=known.city;bill.district=known.district;}
    if(known && bill.tax_id && known.tax_id===bill.tax_id && known.customer_name)bill.customer_name=known.customer_name;
    if(known)for(const key of ['site_name','customer_name','customer_address','tax_id','plant_location','city','district','contract_number'])if(!bill[key]&&known[key])bill[key]=known[key];
  }
  bill.site_name=bill.site_name||deriveSiteNameFromLocation(bill.plant_location)||filename.replace(/\.pdf$/i,'');
  return bill;
}

