"""Prepare requested imports with bounded OCR workers and resumable private cache."""
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor,as_completed
import json,sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from bill_system.parser import parse_taiwan_power_bill,calculate_sha256,validate_bill
from opencc import OpenCC
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'.system_generated';CACHE=OUT/'parsed'
def convert_item(job):
    item,digest=job
    source=Path(item['source']);cached=CACHE/(digest+'.json')
    if cached.exists():data=json.loads(cached.read_text('utf-8'))
    else:
        data=parse_taiwan_power_bill(source)
        cached.write_text(json.dumps(data,ensure_ascii=False,indent=2),'utf-8')
    data['site_name']='常利－'+item['case'];data=validate_bill(data)
    data['_source']=str(source);data['_case']=item['case']
    md=Path(item['markdown']);old=md.read_text('utf-8')
    appendix=('\n\n## Extracted Images'+old.split('## Extracted Images',1)[1]) if '## Extracted Images' in old else ''
    if '(cid:' in old or item['text_chars']<80:
        cc=OpenCC('s2twp');md.write_text('# '+cc.convert(source.stem)+'\n\n'+cc.convert(data['raw_text'])+appendix,'utf-8')
    return data
def main():
    CACHE.mkdir(exist_ok=True)
    manifest=json.loads((OUT/'source_manifest.json').read_text('utf-8'))
    jobs=[];seen={};duplicates=[];result=[];errors=[]
    for item in manifest:
        digest=calculate_sha256(item['source'])
        if digest in seen:duplicates.append({'source':item['source'],'same_as':seen[digest],'reason':'identical_file'})
        else:seen[digest]=item['source'];jobs.append((item,digest))
    with ProcessPoolExecutor(max_workers=4) as pool:
        futures={pool.submit(convert_item,job):job[0] for job in jobs}
        for index,future in enumerate(as_completed(futures),1):
            item=futures[future]
            try:result.append(future.result())
            except Exception as error:errors.append({'source':item['source'],'error':str(error)})
            (OUT/'import_progress.json').write_text(json.dumps({'bills':result,'errors':errors,'duplicates':duplicates},ensure_ascii=False),'utf-8')
            if index%5==0 or index==len(jobs):
                print(json.dumps({'processed':index,'total':len(jobs),'review':sum(x['status']=='NEEDS_REVIEW' for x in result),'errors':len(errors)},ensure_ascii=False),flush=True)
    unique=[];periods={}
    for data in sorted(result,key=lambda x:x['_source']):
        key=tuple(data.get(k) for k in ['electric_number','billing_start_ad','billing_end_ad','bill_type','total_kwh','net_payable_amount'])
        if all(key[:3]) and key in periods:duplicates.append({'source':data['_source'],'same_as':periods[key]['_source'],'reason':'same_period_and_amount'})
        else:unique.append(data);periods[key]=data
    report={'bills':unique,'errors':errors,'duplicates':duplicates,'source_count':len(manifest)}
    (OUT/'prepared_import.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf-8')
    print(json.dumps({'complete':True,'sources':len(manifest),'unique':len(unique),'duplicates':len(duplicates),'errors':errors,'review':[{k:x.get(k) for k in ['filename','bill_type','parse_warnings']} for x in unique if x['status']=='NEEDS_REVIEW']},ensure_ascii=False),flush=True)
if __name__=='__main__':main()
