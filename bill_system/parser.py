"""Taipower bill extraction with explicit OCR quality and arithmetic checks."""
import hashlib
import json
import re
import unicodedata
from datetime import date
from pathlib import Path
from typing import Any, Dict, Optional
import pymupdf
from opencc import OpenCC

_ocr_engine = None
_cc = OpenCC("s2t")
NUM = r"(-?\s*\d[\d,]*(?:\.\d+)?)"
DATE = r"(\d{2,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日"

def get_ocr_engine():
    global _ocr_engine
    if _ocr_engine is None:
        from rapidocr import RapidOCR
        _ocr_engine = RapidOCR(params={"EngineConfig.onnxruntime.intra_op_num_threads":2,"EngineConfig.onnxruntime.inter_op_num_threads":1})
    return _ocr_engine

def calculate_sha256(path):
    digest = hashlib.sha256()
    with open(path,"rb") as file:
        for chunk in iter(lambda:file.read(65536),b""): digest.update(chunk)
    return digest.hexdigest()

def normalize_text(text):
    text = _cc.convert(unicodedata.normalize("NFKC",str(text))).replace("臺","台")
    text = re.sub(r"[“”‘’]","",text)
    text = re.sub(r"[‐‑–—−]","-",text)
    text = re.sub(r"([\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])",r"\1",text)
    text = re.sub(r"(\d)\s*\.\s*(\d)",r"\1.\2",text)
    return re.sub(r"(\d),\s+(\d{3})",r"\1,\2",text)

def clean_num(value:Any)->Optional[float]:
    if value is None:return None
    value = re.sub(r"[,\s元度瓩]","",str(value))
    value = re.sub(r"k[wWhH]+","",value,flags=re.I)
    try:
        number=float(value)
        return int(number) if number.is_integer() else number
    except ValueError:return None

def roc_to_ad_date(value):
    match=re.search(DATE,value or "") or re.search(r"(\d{2,3})[./-](\d{1,2})[./-](\d{1,2})",value or "")
    if not match:return None
    try:return date(int(match[1])+1911,int(match[2]),int(match[3])).isoformat()
    except ValueError:return None

def roc_to_ad_month(value):
    match=re.search(r"(\d{2,3})年(\d{1,2})月",value or "")
    if not match or not 1<=int(match[2])<=12:return None
    return f"{int(match[1])+1911:04d}-{int(match[2]):02d}"

def validate_bill(data):
    fields={"electric_number":"電號","bill_year_month_ad":"帳單年月","billing_period":"計費期間","customer_name":"客戶名稱","plant_location":"設置地點","installed_capacity_kw":"裝置容量","city":"縣市","tax_id":"統一編號","purchase_amount":"購電電費","tax_amount":"營業稅","total_bill_amount":"電費合計","total_kwh":"購電度數","net_payable_amount":"應付總金額"}
    warnings=[f"缺少{label}" for key,label in fields.items() if data.get(key) is None or data.get(key)==""]
    if data.get("installed_capacity_kw") is not None and data["installed_capacity_kw"]<=0:warnings.append("裝置容量需大於零")
    if data.get("total_kwh") is not None and data["total_kwh"]<0:warnings.append("購電度數不可為負值")
    if all(data.get(k) is not None for k in ["purchase_amount","tax_amount","total_bill_amount"]):
        if abs(data["purchase_amount"]+data["tax_amount"]-data["total_bill_amount"])>2:warnings.append("購電電費與營業稅加總不符")
    if all(data.get(k) is not None for k in ["total_bill_amount","meter_rental_amount","net_payable_amount"]):
        if abs(data["total_bill_amount"]+data["meter_rental_amount"]-data["net_payable_amount"])>2:warnings.append("應付金額與扣款不符")
    machines=data.get("machines",[])
    if machines and data.get("total_kwh") is not None and abs(sum(m["kwh"] for m in machines)-data["total_kwh"])>1:warnings.append("機組加總與購電度數不符")
    if machines and data.get("purchase_amount") is not None and abs(sum(m["amount"] for m in machines)-data["purchase_amount"])>3:warnings.append("機組加總與購電電費不符")
    if data.get("bill_type")=="CONSUMPTION":
        warnings=["缺少"+label for key,label in {"electric_number":"電號","bill_year_month_ad":"期別","consumption_amount":"費用金額"}.items() if data.get(key) is None or data.get(key)==""]
    if data.get("bill_type")!="CONSUMPTION" and data.get("tax_id") and not re.fullmatch(r"\d{8}",data["tax_id"]):warnings.append("統一編號需為8碼")
    data["parse_warnings"]=list(dict.fromkeys(warnings))
    data["status"]="NEEDS_REVIEW" if warnings else "PARSED"
    return data

def parse_bill_text(raw_text,filename=""):
    text=normalize_text(raw_text)
    lines=[line.strip() for line in text.splitlines() if line.strip()]
    text="\n".join(lines)
    data={"filename":filename,"raw_text":text,"bill_type":"FIT"}
    def find(pattern,default=""):
        match=re.search(pattern,text,re.I)
        return match[1].strip() if match else default
    def amount(label):
        match=re.search(label+r"\s*[:：]?\s*"+NUM+r"(?![\d,.\-])",text.split("發票資訊",1)[0])
        return clean_num(match[1]) if match else None
    data["electric_number"]=find(r"(\d{2}-\d{2}-\d{4}-\d{2}-\d)") or (re.search(r"(\d{2}-\d{2}-\d{4}-\d{2}-\d)",filename)[1] if re.search(r"(\d{2}-\d{2}-\d{4}-\d{2}-\d)",filename) else "")
    data["contract_number"]=find(r"(\d{2}-[A-Za-z]{2}-\d{3}-\d{4})")
    data["bill_year_month"]=find(r"(\d{3}年\s*\d{1,2}月)\s*再生能源").replace(" ","")
    period=re.search(DATE+r"\s*[~～至到-]\s*"+DATE,text) or re.search(r"(\d{3})[/.](\d{1,2})[/.](\d{1,2})\s*[~～至到-]\s*(\d{3})[/.](\d{1,2})[/.](\d{1,2})",text)
    data["billing_period"]=""
    data["billing_start_ad"]=data["billing_end_ad"]=None
    if period:
        y1,m1,d1,y2,m2,d2=map(int,period.groups())
        try:
            start=date(y1+1911,m1,d1);end=date(y2+1911,m2,d2)
            if start<=end:
                data.update(billing_period=f"{y1}年{m1:02d}月{d1:02d}日~{y2}年{m2:02d}月{d2:02d}日",billing_start_ad=start.isoformat(),billing_end_ad=end.isoformat())
        except ValueError:pass
    if not data["bill_year_month"]:
        data["bill_year_month"]=find(r"(\d{3}年\d{1,2}月)")
    data["bill_year_month_ad"]=roc_to_ad_month(data["bill_year_month"])
    data["customer_name"]=""
    data["customer_address"]=""
    for index,line in enumerate(lines):
        if re.search(r"先生\s*[/、]\s*女士|寶號",line):
            prefix=re.split(r"先生|女士|寶號",line)[0].strip()
            data["customer_name"]=prefix or (lines[index-1] if index else "")
            for candidate in reversed(lines[max(0,index-5):index]):
                if re.search(r"[縣市].*[路街段巷號樓]",candidate) and not re.search(r"公司|電力",candidate):
                    data["customer_address"]=candidate;break
            break
    if not data["customer_name"] or data["customer_name"] in {"收件","先生","女士"}:
        companies=re.findall(r"[\u4e00-\u9fff]{2,15}(?:股份)?有限公司",text)
        data["customer_name"]=next((c for c in companies if "台灣電力" not in c),"")
    data["tax_id"]=find(r"統一編號\s*[:：]?\s*(\d{8})\b")
    data["plant_location"]=find(r"設置地點\s*[:：]?\s*([^\n]+)")
    data["city"]=""
    data["district"]=""
    city=re.search(r"(?:台北|新北|桃園|台中|台南|高雄|基隆|新竹|嘉義)市|(?:新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|台東|澎湖|金門|連江)縣",data["plant_location"])
    if city:
        data["city"]=city[0]
        district=re.search(re.escape(city[0])+r"([^\d縣市、]{1,5}?[區鄉鎮市])",data["plant_location"])
        data["district"]=district[1] if district else ""
    data["installed_capacity_kw"]=amount(r"(?:併聯總)?裝置容量")
    data["grid_capacity_kw"]=amount(r"(?:併聯總)?購售電容量")
    if data["grid_capacity_kw"] is None:data["grid_capacity_kw"]=data["installed_capacity_kw"]
    data["purchase_amount"]=amount("購電電費")
    data["tax_amount"]=amount("營業稅")
    data["total_bill_amount"]=amount(r"(?:本期)?電費合計")
    data["net_payable_amount"]=amount("應付總金額")
    header_amount=re.search(r"(\d{2}-\d{2}-\d{4}-\d{2}-\d)\s+(\d{2}-[A-Za-z]{2}-\d{3}-\d{4})\s+(-?[\d,]+)\s*元",text)
    if header_amount:data["net_payable_amount"]=clean_num(header_amount[3])
    rent=amount("本期電表租費")
    data["meter_rental_amount"]=-abs(rent) if rent is not None else None
    machines=[]
    pattern=r"機組\s*0?(\d+)\s+([0-9]+(?:\.[0-9]{1,6})?)\s+([\d,]+)\s+([\d,]+)\s*元?"
    for match in re.finditer(pattern,text):
        rate,kwh,money=map(clean_num,match.groups()[1:])
        if rate is not None and 0<rate<20 and kwh is not None and money is not None:
            if abs(rate*kwh-money)<=max(3,money*0.002):
                item={"name":"機組"+str(int(match[1])),"rate":rate,"kwh":kwh,"amount":money}
                if item not in machines:machines.append(item)
    data["machines"]=machines
    data["machines_json"]=json.dumps(machines,ensure_ascii=False)
    formula=re.search(r"[=＝]\s*([\d,]+)\s*度",text)
    data["total_kwh"]=clean_num(formula[1]) if formula else (sum(m["kwh"] for m in machines) if machines else None)
    if machines and data["purchase_amount"] is None:data["purchase_amount"]=sum(m["amount"] for m in machines)
    data["fit_rate"]=None
    if machines:
        kwh_sum=sum(m["kwh"] for m in machines)
        data["fit_rate"]=round(sum(m["amount"] for m in machines)/kwh_sum,4) if kwh_sum else machines[0]["rate"]
    if data["fit_rate"] is None:data["fit_rate"]=amount("費率")
    machine_amount=sum(m["amount"] for m in machines)
    if machines and data["tax_amount"] is not None and data["net_payable_amount"] is not None and rent is not None and abs(machine_amount+data["tax_amount"]-abs(rent)-data["net_payable_amount"])<=2:data["purchase_amount"]=machine_amount
    if data["purchase_amount"] is not None and data["tax_amount"] is not None and data["net_payable_amount"] is not None and rent is not None and abs(data["purchase_amount"]+data["tax_amount"]-abs(rent)-data["net_payable_amount"])<=2:data["total_bill_amount"]=data["purchase_amount"]+data["tax_amount"]
    if data["total_bill_amount"] is None and data["purchase_amount"] is not None and data["tax_amount"] is not None:
        data["total_bill_amount"]=data["purchase_amount"]+data["tax_amount"]
    if data["tax_amount"] is None and data["total_bill_amount"] is not None and data["purchase_amount"] is not None:
        data["tax_amount"]=data["total_bill_amount"]-data["purchase_amount"]
    if data["total_bill_amount"] is not None and data["net_payable_amount"] is not None:
        data["meter_rental_amount"]=data["net_payable_amount"]-data["total_bill_amount"]
    data["taipower_branch"]=find(r"服務部門\s*[:：]\s*([^\n]+)")
    data["taipower_tel"]=find(r"服務電話\s*[:：]\s*([^\n]+)")
    data["payment_account"]=find(r"([^\n]*銀行[^\n]*(?:\n[\d]+號帳戶[^\n]*)?)")
    for key,label in [("meter_read_last","上次抄表日"),("meter_read_curr","本次抄表日"),("meter_read_next","下次抄表日")]:
        data[key]=find(label+r"\s*("+DATE+r")")
    if "繳費憑證" in filename or "台電費用通知單" in filename or ("再生能源" not in text and ("高壓用電" in filename or "輸電費率" in text)):
        data["bill_type"]="CONSUMPTION"
        data["consumption_amount"]=amount("繳費總金額")
        data["consumption_kwh"]=None
        if not data["electric_number"] and "發電電號" in text:
            generator=re.search(r"[A-Z]{2}\d+\s+(\d{11})\s+[A-Z]{2}\d+",text)
            if generator:
                n=generator[1];data["electric_number"]=f"{n[:2]}-{n[2:4]}-{n[4:8]}-{n[8:10]}-{n[10]}"
        if not data["electric_number"]:
            digits=re.findall(r"(?<!\d)(\d{11})(?!\d)",text)
            if len(digits)==1:
                n=digits[0];data["electric_number"]=f"{n[:2]}-{n[2:4]}-{n[4:8]}-{n[8:10]}-{n[10]}"
        if "輸電費率" in text:
            triplet=re.search(r"([\d,]+)\s+(0\.\d+)\s+([\d,]+)\s*$",text)
            if triplet:
                usage,rate,money=map(clean_num,triplet.groups())
                if abs(usage*rate-money)<2:data["consumption_kwh"]=usage;data["consumption_amount"]=money
        if data["consumption_kwh"] is None:
            usage=[amount("尖峯度數"),amount("離峯度數")]
            if all(v is not None for v in usage):data["consumption_kwh"]=sum(usage)
        if not data["bill_year_month_ad"]:
            ym=re.search(r"(?<!\d)(1\d{2})(0[1-9]|1[0-2])(?!\d)",filename)
            if ym:data["bill_year_month"]=f"{ym[1]}年{int(ym[2])}月";data["bill_year_month_ad"]=f"{int(ym[1])+1911}-{ym[2]}"
        for key in ["total_kwh","purchase_amount","tax_amount","total_bill_amount","net_payable_amount","fit_rate"]:data[key]=None
    return validate_bill(data)

def extract_text_from_pdf(pdf_path):
    output=[];modes=[]
    with pymupdf.open(pdf_path) as doc:
        for page in doc:
            direct=normalize_text(page.get_text("text",sort=True))
            candidate=parse_bill_text(direct,Path(pdf_path).name)
            if len(direct)>80 and not candidate["parse_warnings"] and "(cid:" not in direct:
                output.extend(direct.splitlines());modes.append("DIRECT_PDF");continue
            result=get_ocr_engine()(page.get_pixmap(dpi=150).tobytes("png"))
            ocr=normalize_text("\n".join(result.txts or []))
            ocr_candidate=parse_bill_text(ocr,Path(pdf_path).name)
            # Prefer OCR for scrambled PDF text order even when both results need review.
            if ocr.strip() and (len(ocr_candidate["parse_warnings"])<=len(candidate["parse_warnings"]) or not candidate["electric_number"]):
                output.extend(ocr.splitlines());modes.append("OCR")
            else:
                output.extend(direct.splitlines());modes.append("DIRECT_PDF")
    return [line.strip() for line in output if line.strip()],"+".join(sorted(set(modes)))

def parse_taiwan_power_bill(pdf_path):
    pdf_path=Path(pdf_path)
    lines,mode=extract_text_from_pdf(pdf_path)
    data=parse_bill_text("\n".join(lines),pdf_path.name)
    data.update(file_path=str(pdf_path.resolve()),file_size=pdf_path.stat().st_size,file_hash=calculate_sha256(pdf_path),extraction_mode=mode)
    return data
