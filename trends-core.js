/* Bill-backed specific yield. No external dependencies and no implicit date/capacity estimates. */
(function(root){
'use strict';
const DAY=86400000;
const number=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
function day(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const stamp=Date.parse(value+'T00:00:00Z');
 return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===value?stamp/DAY:null;
}
const iso=d=>new Date(d*DAY).toISOString().slice(0,10);
function today(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date());}
function machines(row){try{const m=typeof row.machines_json==='string'?JSON.parse(row.machines_json):row.machines_json;return Array.isArray(m)?m:[];}catch{return [];}}
function plants(rows){
 const grouped=new Map();
 for(const row of rows){if(row.bill_type==='CONSUMPTION'||!row.electric_number)continue;let p=grouped.get(row.electric_number);if(!p){p={id:row.electric_number,names:new Map(),count:0};grouped.set(p.id,p);}const name=String(row.site_name||p.id).replace(/\s*\(轉供計費\)/,'');p.names.set(name,(p.names.get(name)||0)+1);p.count++;}
 return [...grouped.values()].map(p=>({id:p.id,name:[...p.names].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'zh-Hant'))[0][0],count:p.count})).sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant'));
}
function analyze(rows,electric,options={}){
 const asOf=options.asOf||today(),cutoff=day(asOf);
 if(cutoff===null)throw new Error('無效的分析日期');
 const revenueField=options.revenueField==='net_payable_amount'?'net_payable_amount':'purchase_amount';
 const selected=rows.filter(r=>r.electric_number===electric),issues=[],candidates=[],dedup=new Set();
 const addIssue=(row,reason)=>issues.push({id:row.id,filename:row.filename||'',reason});
 let expenseCount=0,duplicateCount=0;
 // Prefer an explicitly corrected duplicate; distinct overlapping bills are all withheld.
 for(const row of [...selected].sort((a,b)=>(b.status==='MANUAL_EDITED')-(a.status==='MANUAL_EDITED')||String(b.updated_at||'').localeCompare(String(a.updated_at||'')))){
  if(row.bill_type==='CONSUMPTION'){expenseCount++;continue;}
  const start=day(row.billing_start_ad),end=day(row.billing_end_ad),energy=number(row.total_kwh),capacity=number(row.installed_capacity_kw);
  if(!['PARSED','MANUAL_EDITED'].includes(row.status)){addIssue(row,'帳單尚待核對');continue;}
  if(start===null||end===null||end<start||end-start>3660){addIssue(row,'計費起迄日期缺漏或無效');continue;}
  if(end>cutoff){addIssue(row,'計費期間超出資料檢視日');continue;}
  if(energy===null||energy<0||capacity===null||capacity<=0){addIssue(row,'售電量或裝置容量缺漏／無效');continue;}
  const days=end-start+1,parts=machines(row),partsValid=parts.length&&parts.every(p=>number(p.kwh)!==null&&number(p.kwh)>=0);
  if(partsValid&&Math.abs(parts.reduce((s,p)=>s+Number(p.kwh),0)-energy)>1){addIssue(row,'機組加總與帳單購電度數不符');continue;}
  if(energy/(capacity*days)>24){addIssue(row,'每日每 kW 度數超過 24，需核對容量或度數');continue;}
  const revenue=number(row[revenueField]);
  const key=[start,end,energy,capacity,number(row.purchase_amount),number(row.net_payable_amount)].join('|');
  if(dedup.has(key)){duplicateCount++;addIssue(row,'相同期間及數值的重複帳單');continue;}dedup.add(key);
  candidates.push({row,start,end,days,energy,capacity,exposure:capacity*days,revenue,daily:energy/(capacity*days),parts});
 }
 candidates.sort((a,b)=>a.start-b.start||a.end-b.end||Number(a.row.id)-Number(b.row.id));
 const overlap=new Set();
 for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length&&candidates[j].start<=candidates[i].end;j++){overlap.add(i);overlap.add(j);}
 const periods=candidates.filter((p,i)=>{if(overlap.has(i)){addIssue(p.row,'計費期間重疊，需先確認是否為重複或不同售電來源');return false;}return true;});
 const dates=new Map();
 for(const p of periods)for(let d=p.start;d<=p.end;d++)dates.set(d,{energy:p.energy/p.days,exposure:p.capacity,revenue:p.revenue===null?null:p.revenue/p.days});
 const start=candidates.length?candidates[0].start:null,end=candidates.length?Math.max(...candidates.map(p=>p.end)):null;
 const gaps=[];
 if(start!==null){let first=null;for(let d=start;d<=end+1;d++){if(d<=end&&!dates.has(d)){if(first===null)first=d;}else if(first!==null){gaps.push({start:iso(first),end:iso(d-1),days:d-first});first=null;}}}
 const yearsMap=new Map();
 for(const [stamp,values] of dates){const year=new Date(stamp*DAY).getUTCFullYear();let y=yearsMap.get(year);if(!y){y={year,energy:0,exposure:0,revenue:0,revenueMissing:false,days:0,start:stamp,end:stamp};yearsMap.set(year,y);}y.energy+=values.energy;y.exposure+=values.exposure;y.days++;y.start=Math.min(y.start,stamp);y.end=Math.max(y.end,stamp);if(values.revenue===null)y.revenueMissing=true;else y.revenue+=values.revenue;}
 const years=[...yearsMap.values()].sort((a,b)=>a.year-b.year).map(y=>{const calendarDays=(Date.UTC(y.year+1,0,1)-Date.UTC(y.year,0,1))/DAY;return {...y,calendarDays,complete:y.days===calendarDays,daily:y.energy/y.exposure,annualStandard:y.days===calendarDays?365*y.energy/y.exposure:null,revenue:y.revenueMissing?null:y.revenue,label:String(y.year),date:iso(y.end)};});
 const sum=(list,key)=>list.reduce((s,p)=>s+p[key],0),full=years.filter(y=>y.complete);
 const energy=periods.length?sum(periods,'energy'):null,exposure=sum(periods,'exposure'),revenueKnown=periods.filter(p=>p.revenue!==null);
 const baselineDaily=full.length?sum(full,'energy')/sum(full,'exposure'):null;
 const recent=periods.slice(-3),recentDaily=recent.length?sum(recent,'energy')/sum(recent,'exposure'):null;
 return {electric,asOf,revenueField,rawCount:selected.length,expenseCount,duplicateCount,overlapCount:overlap.size,issues,periods,years,fullYears:full,start:start===null?null:iso(start),end:end===null?null:iso(end),spanDays:start===null?0:end-start+1,coveredDays:dates.size,missingDays:gaps.reduce((s,g)=>s+g.days,0),gaps,coverage:start===null?null:dates.size/(end-start+1),lagDays:end===null?null:cutoff-end,energy,exposure,daily:exposure>0?energy/exposure:null,cumulativeSpecific:periods.length?sum(periods.map(p=>({yield:p.energy/p.capacity})),'yield'):null,revenue:revenueKnown.length?sum(revenueKnown,'revenue'):null,revenueCount:revenueKnown.length,latestCapacity:periods.length?periods[periods.length-1].capacity:null,baselineDaily,baselineAnnual:baselineDaily===null?null:365*baselineDaily,minimumAnnual:full.length?Math.min(...full.map(y=>y.annualStandard)):null,recentDaily,recentCount:recent.length,recentDelta:baselineDaily>0?recentDaily/baselineDaily-1:null};
}
function scenario(model,capacity,factor=100,source='average'){
 capacity=number(capacity);factor=number(factor);
 if(capacity===null||capacity<=0||factor===null||factor<0||factor>100||!['average','minimum'].includes(source))return null;
 const base=source==='minimum'?model.minimumAnnual:model.baselineAnnual;
 return base===null?null:{capacity,factor,source,specificAnnual:base*factor/100,energyAnnual:base*factor/100*capacity};
}
const api={day,iso,today,number,plants,analyze,scenario};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
root.SolarTrends=api;
})(typeof window!=='undefined'?window:globalThis);
