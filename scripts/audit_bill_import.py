"""Reparse cached OCR with current rules, audit duplicates, and prepare private import."""
from pathlib import Path
from collections import Counter,defaultdict
import json,re,sys
from opencc import OpenCC
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from bill_system.parser import parse_bill_text,calculate_sha256,validate_bill
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'.system_generated'
def main():
    manifest=json.loads((OUT/'source_manifest.json').read_text('utf-8'))
    candidates=[];excluded=[];duplicates=[];seen={};missing=[];cc=OpenCC('s2twp')
    for item in manifest:
        source=Path(item['source']);digest=calculate_sha256(source);cache=OUT/'parsed'/(digest+'.json')
        if not cache.exists():missing.append(str(source));continue
        cached=json.loads(cache.read_text('utf-8'))
        data=parse_bill_text(cached['raw_text'],source.name)
        data.update(file_size=source.stat().st_size,file_hash=digest,extraction_mode=cached.get('extraction_mode','OCR'),site_name='常利－'+item['case'],_source=str(source),_case=item['case'])
        if '台電費用通知單' in source.name:data['extraction_mode']+=';MONTH_FROM_FILENAME'
        md=Path(item['markdown']);old=md.read_text('utf-8')
        appendix=('\n\n## Extracted Images'+old.split('## Extracted Images',1)[1]) if '## Extracted Images' in old else ''
        text='# '+cc.convert(source.stem)+'\n\n'+cc.convert(data['raw_text'])+appendix
        assets=source.parent/(cc.convert(source.stem)+'.assets')
        if assets.exists():
            for image in assets.iterdir():
                target=assets.name+'/'+image.name;text=text.replace(']('+target+')','](<'+target+'>)')
        md.write_text(text,'utf-8')
        if '維運費用' in source.name and not data.get('electric_number'):
            excluded.append({'source':str(source),'reason':'維運費用試算表，非台電帳單'});continue
        if digest in seen:
            duplicates.append({'source':str(source),'same_as':seen[digest],'reason':'identical_file'});continue
        seen[digest]=str(source);candidates.append(data)
    if missing:raise SystemExit('OCR cache incomplete: '+str(len(missing))+' files remaining')
    case_electrics=defaultdict(Counter)
    for data in candidates:
        if data.get("electric_number") and data["bill_type"]=="FIT":case_electrics[data["_case"]][data["electric_number"]]+=1
    expected={case:counts.most_common(1)[0][0] for case,counts in case_electrics.items()}
    source_mismatches=[{"source":data["_source"],"folder_case":data["_case"],"printed_electric_number":data["electric_number"],"expected_electric_number":expected[data["_case"]]} for data in candidates if data["bill_type"]=="FIT" and data.get("electric_number") and data["_case"] in expected and data["electric_number"]!=expected[data["_case"]]]
    unique=[];periods={}
    for data in candidates:
        key=tuple(data.get(k) for k in ['electric_number','billing_start_ad','billing_end_ad','bill_type','total_kwh','net_payable_amount'])
        if all(key[:3]) and key in periods:duplicates.append({'source':data['_source'],'same_as':periods[key]['_source'],'reason':'same_period_and_amount'})
        else:unique.append(data);periods[key]=data
    groups=defaultdict(list)
    for data in unique:
        if data.get('billing_start_ad') and data['bill_type']=='FIT':
            groups[(data['electric_number'],data['billing_start_ad'],data['billing_end_ad'])].append(data)
    conflicts=[{'period':key,'files':[x['filename'] for x in rows]} for key,rows in groups.items() if len(rows)>1]
    repairs=[]
    baseline=json.loads((OUT/'baseline_bills.json').read_text('utf-8'))
    for fixture in (OUT/'diagnosis').glob('*.json'):
        cached=json.loads(fixture.read_text('utf-8'));source=fixture.with_suffix('.pdf')
        if not source.exists():continue
        data=parse_bill_text(cached['raw_text'],source.name)
        existing=next(x for x in baseline if x['filename']==source.name)
        data['site_name']=existing.get('site_name') if existing.get('site_name') and not re.match(r'^\d{2}-\d{2}-',existing['site_name']) else data['plant_location'].replace('裏','里')
        data['plant_location']=data['plant_location'].replace('裏','里')
        data.update(file_hash=calculate_sha256(source),file_size=source.stat().st_size,extraction_mode='OCR_REPAIRED',_source=str(source),_case='既有異常修復')
        repairs.append(data)
    originals=[]
    for data in baseline:
        source=ROOT/'客戶電費單資料庫'/data['filename']
        if source.exists() and not data.get('file_url'):
            row=dict(data);row.update(file_hash=calculate_sha256(source),file_size=source.stat().st_size,_source=str(source),_case='既有原檔移轉')
            originals.append(row)
    summary={'source_pdf_count':len(manifest),'unique_bill_count':len(unique),'source_fit_count':sum(x['bill_type']=='FIT' for x in unique),'source_expense_count':sum(x['bill_type']=='CONSUMPTION' for x in unique),'by_case':dict(Counter(x['_case'] for x in unique)),'duplicates':duplicates,'source_mismatches':source_mismatches,'excluded':excluded,'conflicts':conflicts,'repairs':len(repairs),'original_pdf_migrations':len(originals),'review':[{'filename':x['filename'],'warnings':x['parse_warnings']} for x in unique if x['status']=='NEEDS_REVIEW']}
    (OUT/'audited_import.json').write_text(json.dumps({'bills':unique+repairs+originals,'errors':conflicts,'summary':summary},ensure_ascii=False,indent=2),'utf-8')
    (OUT/'import_audit.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),'utf-8')
    print(json.dumps(summary,ensure_ascii=False),flush=True)
if __name__=='__main__':main()
