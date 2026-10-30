/* Interactive trend workspace backed by the complete authenticated bill history. */
const PlantTrends = {
 data:null,model:null,serial:0,lastPlant:null,loadedAt:null,
 fields:'id,filename,file_hash,electric_number,site_name,bill_type,billing_start_ad,billing_end_ad,bill_year_month_ad,installed_capacity_kw,total_kwh,purchase_amount,net_payable_amount,machines_json,status,updated_at',
 el(id){return document.getElementById(id);},
 h(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));},
 fmt(value,digits=0){return value===null||value===undefined||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString('zh-TW',{minimumFractionDigits:digits,maximumFractionDigits:digits});},
 clear(){this.model=null;for(const id of ['trendMetrics','trendQuality','trendPeriod','trendEnergyChart','trendRevenueChart','trendYieldChart','trendYearRows','trendBillRows','trendIssues','trendScenarioResult'])this.el(id)?.replaceChildren();if(this.el('trendExport'))this.el('trendExport').disabled=true;},
 reset(){this.serial++;this.data=null;this.lastPlant=null;this.clear();this.el('trendPlant')?.replaceChildren();if(this.el('trendStatus'))this.el('trendStatus').textContent='請登入後載入資料。';},
 invalidate(){this.data=null;if(this.el('trendsView')&&!this.el('trendsView').classList.contains('hidden'))this.load(true);},
 async load(force=false){
  BillAuth.requireUser();
  if(this.data&&!force){this.render();return;}
  const ticket=++this.serial;this.el('trendStatus').textContent='正在讀取所有案場的完整帳單歷史…';this.el('trendRefresh').disabled=true;this.el('trendExport').disabled=true;
  try{
   const client=SupabaseBillService.getClient(),rows=[];let offset=0;
   while(true){
    const {data,count,error}=await client.from('electricity_bills').select(this.fields,{count:'exact'}).order('id',{ascending:true}).range(offset,offset+499);
    if(error)throw error;
    if(ticket!==this.serial||!BillAuth.profile?.active)return;
    rows.push(...(data||[]));offset+=(data||[]).length;
    if(count!==null&&offset>=count)break;
    if(!data?.length){if(count!==null&&offset<count)throw new Error('帳單讀取未完成，請重試。');break;}
    if(count===null&&data.length<500)break;
   }
   if(ticket!==this.serial||!BillAuth.profile?.active)return;
   this.data=rows;this.loadedAt=new Date().toLocaleString('zh-TW',{timeZone:'Asia/Taipei'});
   const select=this.el('trendPlant'),old=select.value,plants=SolarTrends.plants(rows);select.replaceChildren();
   for(const plant of plants){const option=document.createElement('option');option.value=plant.id;option.textContent=plant.name+'｜'+plant.id+'（'+plant.count+' 期）';select.append(option);}
   if(plants.some(p=>p.id===old))select.value=old;else if(plants.length)select.value=[...plants].sort((a,b)=>b.count-a.count)[0].id;
   this.selectPlant();
  }catch(error){
   if(ticket!==this.serial)return;
   this.data=null;this.clear();this.el('trendStatus').textContent='資料讀取失敗：'+error.message+'。請重新整理；未以舊資料或零值代替。';
  }finally{if(ticket===this.serial)this.el('trendRefresh').disabled=false;}
 },
 selectPlant(){this.lastPlant=null;this.render();},
 render(){
  if(!this.data||!BillAuth.profile?.active)return;
  const electric=this.el('trendPlant').value,revenueField=this.el('trendRevenue').value;
  const model=SolarTrends.analyze(this.data,electric,{revenueField});this.model=model;
  const title=revenueField==='net_payable_amount'?'含稅應付淨額':'未稅售電收入';
  this.el('trendRevenueTitle').textContent=title;this.el('trendYearRevenueHeader').textContent=title+' NT$';
  this.el('trendStatus').textContent='已載入完整歷史 '+this.data.length+' 筆｜本案有效 '+model.periods.length+' 期｜更新：'+this.loadedAt+'（台灣時間）';
  this.el('trendPeriod').textContent=model.start?'可追溯計費期間 '+model.start+' 至 '+model.end+'｜有效 '+model.coveredDays+' 天／期間共 '+model.spanDays+' 天｜距今日 '+model.lagDays+' 天尚無後續帳單資料':'此案場尚無可納入的計費期間。';
  const card=(name,value,sub)=>'<article class="trend-metric"><p class="trend-metric-label">'+name+'</p><p class="trend-metric-value">'+value+'</p><p class="trend-metric-sub">'+sub+'</p></article>';
  this.el('trendMetrics').innerHTML=[
   card('累計售電量',this.fmt(model.energy,0)+' <span class="trend-small">kWh</span>','有效帳單購電度數；不重複加總機組'),
   card('累計'+title,'<span class="trend-currency">NT$</span> '+this.fmt(model.revenue,0),'金額完整 '+model.revenueCount+'／'+model.periods.length+' 期'+(model.revenueCount<model.periods.length?'，僅加總已知金額':'')),
   card('歷史平均每日峰瓦值',this.fmt(model.daily,3),'kWh/kW/日｜依各期容量與天數加權'),
   card('完整年度平均',this.fmt(model.baselineAnnual,1),'kWh/kW/年｜365 日標準化，'+model.fullYears.length+' 個完整曆年'),
   card('完整年度最低觀測值',this.fmt(model.minimumAnnual,1),'kWh/kW/年｜歷史最低，不是 P90'),
   card('計費期間覆蓋率',model.coverage===null?'—':this.fmt(model.coverage*100,1)+'%','缺漏 '+model.missingDays+' 天｜不含最新計費日之後')
  ].join('');
  const quality=[];
  quality.push('有效 '+model.periods.length+' 期；排除 '+model.expenseCount+' 筆用電／輸電支出，'+model.issues.length+' 筆資料需另行檢核。');
  if(model.gaps.length)quality.push('資料庫未覆蓋：'+model.gaps.map(g=>g.start+'～'+g.end+'（'+g.days+' 天）').join('、')+'。請核對該期 PDF 的電號與計費期間；來源有檔案仍須確認案場匹配。');
  if(!model.fullYears.length)quality.push('尚無完整曆年，暫不產生全年基準或保證量參考試算。');
  if(model.recentDaily!==null)quality.push('最近 '+model.recentCount+' 期平均 '+this.fmt(model.recentDaily,3)+' kWh/kW/日'+(model.recentDelta===null?'':'，較完整年度平均 '+(model.recentDelta>=0?'+':'')+this.fmt(model.recentDelta*100,1)+'%')+'；未做季節與天候校正。');
  this.el('trendQuality').textContent=quality.join(' ');this.el('trendQuality').dataset.warning=String(!!model.issues.length||!!model.missingDays||!model.fullYears.length||(model.recentDelta!==null&&model.recentDelta<0));
  const annual=this.el('trendGrain').value==='year';
  const points=annual?model.years.map(y=>({...y,x:SolarTrends.day(y.date),label:y.year+(y.complete?'':'（未完整）'),tip:y.days+'/'+y.calendarDays+' 天'})):model.periods.map(p=>({...p,x:p.end,label:SolarTrends.iso(p.start)+'～'+SolarTrends.iso(p.end),tip:p.days+' 天',complete:true}));
  this.chart('trendEnergyChart',points,'energy','kWh','#167c87');
  this.chart('trendRevenueChart',points,'revenue','NT$','#316cb0');
  this.chart('trendYieldChart',points,'daily','kWh/kW/日','#167c87',model.baselineDaily);
  this.el('trendYearRows').innerHTML=model.years.map(y=>'<tr><td>'+y.year+'</td><td>'+y.days+' / '+y.calendarDays+'</td><td>'+this.fmt(y.energy,1)+'</td><td>'+this.fmt(y.revenue,2)+'</td><td>'+this.fmt(y.daily,3)+'</td><td>'+this.fmt(y.annualStandard,1)+'</td><td>'+(y.complete?'完整年度':'未完整，排除')+'</td></tr>').join('')||'<tr><td colspan="7">尚無可納入資料</td></tr>';
  this.el('trendBillRows').innerHTML=model.periods.map((p,i)=>'<tr><td>'+this.h(SolarTrends.iso(p.start)+'～'+SolarTrends.iso(p.end))+'</td><td>'+p.days+'</td><td>'+this.fmt(p.capacity,2)+'</td><td>'+this.fmt(p.energy,0)+'</td><td>'+this.fmt(p.revenue,2)+'</td><td>'+this.fmt(p.daily,3)+'</td><td>'+this.h(p.parts.length?p.parts.map(m=>(m.name||'機組')+'：'+this.fmt(m.kwh)+' kWh').join('；'):'未提供機組明細')+'</td><td><button type="button" onclick="PlantTrends.preview('+i+')">查看 PDF</button></td></tr>').join('')||'<tr><td colspan="8">尚無可納入資料</td></tr>';
  const audits=model.issues.map(i=>'<li>'+this.h(i.filename)+'：'+this.h(i.reason)+'</li>');
  this.el('trendIssues').innerHTML='<p>本案共 '+model.rawCount+' 筆資料；有效 '+model.periods.length+' 期；用電／輸電支出 '+model.expenseCount+' 筆；重複 '+model.duplicateCount+' 筆；有疑義的重疊帳單 '+model.overlapCount+' 筆。</p>'+(audits.length?'<ul>'+audits.join('')+'</ul>':'<p>目前未發現需排除的售電帳單。</p>');
  this.el('trendAuditSummary').textContent='資料檢核與統計口徑'+(model.issues.length?'（'+model.issues.length+' 筆需檢核）':'');
  this.el('trendFullYears').textContent=model.fullYears.length?model.fullYears.map(y=>y.year).join('、')+' 年':'尚無完整曆年';
  if(this.lastPlant!==electric){this.el('trendScenarioCapacity').value=model.latestCapacity??'';this.lastPlant=electric;}
  this.el('trendExport').disabled=false;this.scenario();
 },
 scenario(){
  if(!this.model)return;
  const result=SolarTrends.scenario(this.model,this.el('trendScenarioCapacity').value,this.el('trendScenarioFactor').value,this.el('trendScenarioSource').value);
  this.el('trendScenarioResult').textContent=!this.model.fullYears.length?'資料尚不足一個完整曆年，暫不試算全年保證量參考值。':!result?'請輸入大於零的容量與 0～100% 的保留比例。':'參考年售電量 '+this.fmt(result.energyAnnual,0)+' kWh／年　｜　每 kW '+this.fmt(result.specificAnnual,1)+' kWh／年　｜　容量 '+this.fmt(result.capacity,2)+' kW × 保留比例 '+this.fmt(result.factor,1)+'%';
 },
 chart(id,points,key,unit,color,baseline=null){
  const container=this.el(id),known=points.filter(p=>Number.isFinite(p[key]));
  if(!known.length){container.innerHTML='<div class="trend-empty">尚無可納入的'+(key==='revenue'?'收入':'計費期')+'資料</div>';return;}
  const width=id==='trendYieldChart'?1100:600,height=285,left=75,right=22,top=32,bottom=58;
  const plotW=width-left-right,plotH=height-top-bottom;
  let xMin=Math.min(...points.map(p=>p.x)),xMax=Math.max(...points.map(p=>p.x));if(xMin===xMax){xMin-=15;xMax+=15;}
  let lo=Math.min(0,...known.map(p=>p[key])),hi=Math.max(0,...known.map(p=>p[key]),baseline??0);if(hi===lo)hi=lo+1;hi+=(hi-lo)*.08;
  const x=v=>left+(v-xMin)/(xMax-xMin)*plotW,y=v=>top+(hi-v)/(hi-lo)*plotH;
  const axis=v=>Math.abs(v)>=10000?this.fmt(v/10000,1)+'萬':this.fmt(v,key==='daily'?1:0);
  let svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+this.h(unit+' 歷史趨勢，詳細數值可查看下方表格')+'"><title>'+this.h(unit+' 歷史趨勢')+'</title>';
  svg+='<text x="8" y="18" fill="#657b90" font-size="12">'+this.h(unit)+'</text>';
  for(let tick=0;tick<5;tick++){const value=lo+(hi-lo)*tick/4,py=y(value);svg+='<line x1="'+left+'" x2="'+(width-right)+'" y1="'+py+'" y2="'+py+'" stroke="#e5edf3"/><text x="'+(left-10)+'" y="'+(py+4)+'" text-anchor="end" fill="#687d91" font-size="12">'+axis(value)+'</text>';}
  const ticks=[...new Set([0,Math.round((points.length-1)/4),Math.round((points.length-1)/2),Math.round((points.length-1)*3/4),points.length-1])];
  for(const i of ticks){const p=points[i];if(!p)continue;const label=this.el('trendGrain').value==='year'?String(p.year):SolarTrends.iso(p.x).slice(0,7);svg+='<text x="'+x(p.x)+'" y="'+(height-bottom+28)+'" text-anchor="'+(points.length===1?'middle':i===0?'start':i===points.length-1?'end':'middle')+'" fill="#687d91" font-size="12">'+label+'</text>';}
  if(baseline!==null)svg+='<line x1="'+left+'" x2="'+(width-right)+'" y1="'+y(baseline)+'" y2="'+y(baseline)+'" stroke="#a87524" stroke-dasharray="6 5"/><text x="'+(width-right)+'" y="18" text-anchor="end" fill="#8b6429" font-size="12">完整年度平均 '+this.fmt(baseline,3)+'</text>';
  let segments=[],segment=[],last=null;
  for(const p of points){if(!Number.isFinite(p[key])){if(segment.length)segments.push(segment);segment=[];last=null;continue;}if(last&&p.start>last.end+1){segments.push(segment);segment=[];}segment.push(p);last=p;}if(segment.length)segments.push(segment);
  for(const part of segments)svg+='<path d="'+part.map((p,i)=>(i?'L':'M')+x(p.x).toFixed(2)+','+y(p[key]).toFixed(2)).join(' ')+'" fill="none" stroke="'+color+'" stroke-width="2.5" stroke-linejoin="round"/>';
  for(const p of known){const tip=p.label+'｜'+p.tip+'｜'+this.fmt(p[key],key==='daily'?3:2)+' '+unit;svg+='<circle cx="'+x(p.x)+'" cy="'+y(p[key])+'" r="'+(points.length>30?3.2:4.5)+'" fill="'+(p.complete?color:'#fff')+'" stroke="'+color+'" stroke-width="1.8" tabindex="0" aria-label="'+this.h(tip)+'"><title>'+this.h(tip)+'</title></circle>';}
  svg+='<text x="'+left+'" y="'+(height-8)+'" fill="#778a9b" font-size="11">滑鼠停留或鍵盤選取資料點可讀取數值'+(this.el('trendGrain').value==='year'?'；空心點為未完整年度。':'；依實際計費期顯示，期長可能不同。')+'</text></svg>';
  container.innerHTML=svg;
 },
 async preview(index){try{BillAuth.requireUser();const bill=this.model.periods[index]?.row;if(!bill)return;const url=await SupabaseBillService.getBillFileUrl(bill);window.open(url,'_blank','noopener,noreferrer');}catch(error){showToast('無法開啟帳單：'+error.message,true);}},
 exportExcel(){
  try{
   BillAuth.requireUser();const m=this.model;if(!m||!window.XLSX)throw new Error('分析資料或匯出元件尚未載入。');
   const plant=SolarTrends.plants(this.data).find(p=>p.id===m.electric),trial=SolarTrends.scenario(m,this.el('trendScenarioCapacity').value,this.el('trendScenarioFactor').value,this.el('trendScenarioSource').value);
   const summary=[['案場',plant?.name||m.electric],['電號',m.electric],['資料檢視日',m.asOf],['資料更新（台灣時間）',this.loadedAt],['最早帳單期間',m.start],['最後計費日',m.end],['有效天數',m.coveredDays],['缺漏天數',m.missingDays],['購電度數 kWh',m.energy],['收入口徑',m.revenueField==='purchase_amount'?'未稅售電收入':'含稅應付淨額（非實際入帳）'],['已知收入總額 NT$',m.revenue],['收入完整期數',m.revenueCount],['納入計費期數',m.periods.length],['歷史每日峰瓦值 kWh/kW/日',m.daily],['完整年度',m.fullYears.map(y=>y.year).join('、')],['完整年度平均 kWh/kW/年（365日）',m.baselineAnnual],['完整年度最低 kWh/kW/年（365日）',m.minimumAnnual],['最近期數',m.recentCount],['近期每日峰瓦值',m.recentDaily],['試算基準',trial?.source||'資料不足'],['試算容量 kW',trial?.capacity??null],['試算保留比例 %',trial?.factor??null],['試算年售電量 kWh',trial?.energyAnnual??null],['適用範圍','歷史售電量參考，非總發電量、P90、預測或已驗證保證值。'],['公式','每日峰瓦值＝總購電度數／Σ(各期容量×計費天數)；完整年度年值乘365。'],['分攤','跨年帳單按日均勻分攤，非每日實測；缺漏日不填零；用電與輸電支出排除。'],['分母','採帳單裝置容量；與模組 DC 銘牌容量不同時需核對。']];
   const periods=[['計費起日','計費迄日','計費天數','容量 kW','購電度數 kWh','收入 NT$','每日峰瓦值','機組明細','來源檔名'],...m.periods.map(p=>[SolarTrends.iso(p.start),SolarTrends.iso(p.end),p.days,p.capacity,p.energy,p.revenue,p.daily,p.parts.map(x=>(x.name||'機組')+': '+x.kwh+' kWh').join('；'),p.row.filename])];
   const years=[['年度','覆蓋天數','全年天數','完整年度','購電度數 kWh','收入 NT$','每日峰瓦值','365日年化 kWh/kW'],...m.years.map(y=>[y.year,y.days,y.calendarDays,y.complete?'是':'否',y.energy,y.revenue,y.daily,y.annualStandard])];
   const audit=[['分類','來源／起日','原因／迄日','天數'],...m.issues.map(i=>['帳單檢核',i.filename,i.reason,null]),...m.gaps.map(g=>['缺漏期間',g.start,g.end,g.days]),['排除支出帳單',m.expenseCount,'不計入售電收益',null]];
   const book=XLSX.utils.book_new();
   for(const [name,rows] of [['分析摘要',summary],['計費期',periods],['年度',years],['資料檢核',audit]]){const sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=rows[0].map((_,i)=>({wch:i===0?27:i===1?24:22}));XLSX.utils.book_append_sheet(book,sheet,name);}
   XLSX.writeFile(book,'發電收益趨勢_'+(plant?.name||m.electric).replace(/[<>:"/\\|?*]/g,'_')+'_'+m.asOf+'.xlsx');
  }catch(error){showToast('匯出失敗：'+error.message,true);}
 }
};
