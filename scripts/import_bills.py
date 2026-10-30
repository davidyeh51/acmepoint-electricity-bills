"""Import an audited private manifest using an authorized application account."""
import argparse,json,os,re,sys
from pathlib import Path
import httpx
ROOT=Path(__file__).resolve().parents[1]
FIELDS=set("filename file_url file_size file_hash electric_number contract_number site_name customer_name customer_address tax_id bill_year_month bill_year_month_ad billing_period billing_start_ad billing_end_ad plant_location city district installed_capacity_kw grid_capacity_kw total_kwh fit_rate purchase_amount tax_amount total_bill_amount meter_rental_amount net_payable_amount payment_account taipower_branch taipower_tel meter_read_last meter_read_curr meter_read_next machines_json raw_text extraction_mode status parse_warnings bill_type consumption_amount consumption_kwh".split())
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("manifest",type=Path)
    parser.add_argument("--username",default="davidyeh")
    args=parser.parse_args()
    document=json.loads(args.manifest.read_text("utf-8"))
    if document.get("errors"):raise SystemExit("Manifest contains errors; audit and repair first.")
    records=document["bills"]
    config=(ROOT/"supabase-client.js").read_text("utf-8")
    url=re.search(r"const DEFAULT_URL = '([^']+)'",config)[1]
    key=re.search(r"const DEFAULT_ANON_KEY = '([^']+)'",config)[1]
    password=os.environ.get("BILLS_PASSWORD")
    if not password:raise SystemExit("Set BILLS_PASSWORD in the process environment.")
    results=[];errors=[]
    with httpx.Client(timeout=120,headers={"apikey":key}) as client:
        response=client.post(url+"/auth/v1/token?grant_type=password",json={"email":args.username+"@electricity-bills.acmepoint.internal","password":password})
        response.raise_for_status()
        token=response.json()["access_token"]
        client.headers["Authorization"]="Bearer "+token
        for index,row in enumerate(records,1):
            try:
                data={k:v for k,v in row.items() if k in FIELDS}
                if isinstance(data.get("machines_json"),str):data["machines_json"]=json.loads(data["machines_json"])
                source=Path(row["_source"])
                storage_path="source/"+data["file_hash"]+".pdf"
                uploaded=client.post(url+"/storage/v1/object/bills/"+storage_path,headers={"Content-Type":"application/pdf","x-upsert":"true","Cache-Control":"private,max-age=0"},content=source.read_bytes())
                uploaded.raise_for_status()
                data["file_url"]="storage://bills/"+storage_path
                saved=client.post(url+"/rest/v1/electricity_bills?on_conflict=filename",headers={"Prefer":"resolution=merge-duplicates,return=representation"},json=data)
                saved.raise_for_status()
                record=saved.json()[0]
                if record.get("electric_number") and record.get("site_name"):
                    client.post(url+"/rest/v1/site_mappings?on_conflict=electric_number",headers={"Prefer":"resolution=merge-duplicates"},json={"electric_number":record["electric_number"],"site_name":record["site_name"]}).raise_for_status()
                results.append({"filename":data["filename"],"id":record["id"],"status":record["status"],"case":row.get("_case")})
                if index%10==0 or index==len(records):print(json.dumps({"saved":len(results),"total":len(records),"errors":len(errors)},ensure_ascii=False),flush=True)
            except Exception as error:
                errors.append({"filename":row.get("filename"),"error":str(error)})
            (ROOT/".system_generated"/"cloud_import_result.json").write_text(json.dumps({"results":results,"errors":errors},ensure_ascii=False,indent=2),"utf-8")
        client.post(url+"/auth/v1/logout?scope=local")
    print(json.dumps({"complete":True,"saved":len(results),"errors":errors},ensure_ascii=False),flush=True)
    if errors:raise SystemExit(1)
if __name__=="__main__":main()
