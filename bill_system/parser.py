import os
import re
import hashlib
import json
from pathlib import Path
from typing import Dict, Any, Tuple, List, Optional
import pymupdf

# Lazy loaded OCR engine
_ocr_engine = None

def get_ocr_engine():
    global _ocr_engine
    if _ocr_engine is None:
        try:
            from rapidocr import RapidOCR
            _ocr_engine = RapidOCR()
        except Exception as e:
            print(f"[Parser] Failed to initialize RapidOCR: {e}")
            _ocr_engine = None
    return _ocr_engine

def calculate_sha256(file_path: Path) -> str:
    """Calculate SHA256 checksum of file."""
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            sha256.update(chunk)
    return sha256.hexdigest()

def roc_to_ad_date(roc_str: str) -> Optional[str]:
    """Convert ROC date like '115年09月01日' or '115/09/01' to AD '2026-09-01'."""
    if not roc_str:
        return None
    m = re.search(r'(\d{2,3})[年/.-](\d{1,2})[月/.-](\d{1,2})', roc_str)
    if m:
        roc_y = int(m.group(1))
        m_val = int(m.group(2))
        d_val = int(m.group(3))
        ad_y = roc_y + 1911
        return f"{ad_y:04d}-{m_val:02d}-{d_val:02d}"
    return None

def roc_to_ad_month(roc_str: str) -> Optional[str]:
    """Convert ROC month like '115年10月' to '2026-10'."""
    if not roc_str:
        return None
    m = re.search(r'(\d{2,3})[年/.-](\d{1,2})', roc_str)
    if m:
        roc_y = int(m.group(1))
        m_val = int(m.group(2))
        ad_y = roc_y + 1911
        return f"{ad_y:04d}-{m_val:02d}"
    return None

def clean_num(s: Any) -> Optional[float]:
    """Clean string to float/int."""
    if s is None:
        return None
    clean = str(s).replace(',', '').replace('元', '').replace('度', '').replace('kW', '').replace('KW', '').strip()
    try:
        val = float(clean)
        return int(val) if val.is_integer() else val
    except Exception:
        return None

def extract_text_from_pdf(pdf_path: Path) -> Tuple[List[str], str]:
    """
    Extract text lines from PDF.
    If digital text exists (>80 chars), extract directly.
    Otherwise, render page to image and use RapidOCR.
    """
    with pymupdf.open(pdf_path) as doc:
        for page in doc:
            txt = page.get_text()
            if txt and txt.strip():
                lines = [l.strip() for l in txt.splitlines() if l.strip()]
                all_direct_lines.extend(lines)
                
        # Check if direct text is substantial (not empty or single watermark)
        joined_direct = "".join(all_direct_lines)
        if len(joined_direct) > 80 and ("躉購" in joined_direct or "電號" in joined_direct or "台灣電力" in joined_direct):
            return all_direct_lines, "DIRECT_PDF"
            
        # Fallback to OCR
        engine = get_ocr_engine()
        if engine is None:
            return all_direct_lines, "NO_OCR_AVAILABLE"
            
        ocr_lines = []
        for page in doc:
            # 150 DPI gives great accuracy and fast speed
            pix = page.get_pixmap(dpi=150)
            img_bytes = pix.tobytes("png")
            res = engine(img_bytes)
            if res and res.txts:
                ocr_lines.extend([t.strip() for t in res.txts if t.strip()])
                
        return ocr_lines, "OCR"

def parse_taiwan_power_bill(pdf_path: Path) -> Dict[str, Any]:
    """
    Parse a Taipower Feed-in Tariff Billing Notification PDF (再生能源電能躉購電費通知單).
    Returns a dictionary of standardized fields.
    """
    pdf_path = Path(pdf_path)
    file_size = pdf_path.stat().st_size
    file_hash = calculate_sha256(pdf_path)
    
    lines, extraction_mode = extract_text_from_pdf(pdf_path)
    full_text = "\n".join(lines)
    
    data: Dict[str, Any] = {
        "filename": pdf_path.name,
        "file_path": str(pdf_path.resolve()),
        "file_size": file_size,
        "file_hash": file_hash,
        "extraction_mode": extraction_mode,
        "raw_text": full_text,
    }
    
    # 1. 電號 (e.g. 08-40-8620-12-7)
    m = re.search(r'(\d{2}-\d{2}-\d{4}-\d{2}-\d{1})', full_text)
    data["electric_number"] = m.group(1) if m else ""
    
    # 2. 契約編號 (e.g. 08-PV-109-0339 or 10-PV-106-0047)
    m = re.search(r'(\d{2}-[A-Za-z0-9]{2}-\d{3}-\d{4})', full_text)
    data["contract_number"] = m.group(1) if m else ""
    
    # 3. 帳單年月 (e.g. 115年10月)
    m = re.search(r'(\d{2,3}年\d{1,2}月)', full_text)
    data["bill_year_month"] = m.group(1) if m else ""
    data["bill_year_month_ad"] = roc_to_ad_month(data["bill_year_month"])
    
    # 4. 計費期間 (e.g. 115年09月01日~115年09月30日)
    m = re.search(r'計費期間[：:]\s*([0-9]{2,3}年[0-9]{1,2}月[0-9]{1,2}日\s*~\s*[0-9]{2,3}年[0-9]{1,2}月[0-9]{1,2}日)', full_text)
    if not m:
        m = re.search(r'([0-9]{2,3}年[0-9]{1,2}月[0-9]{1,2}日\s*~\s*[0-9]{2,3}年[0-9]{1,2}月[0-9]{1,2}日)', full_text)
    if m:
        period_str = m.group(1).replace(" ", "")
        data["billing_period"] = period_str
        parts = period_str.split("~")
        if len(parts) == 2:
            data["billing_start_ad"] = roc_to_ad_date(parts[0])
            data["billing_end_ad"] = roc_to_ad_date(parts[1])
        else:
            data["billing_start_ad"] = None
            data["billing_end_ad"] = None
    else:
        data["billing_period"] = ""
        data["billing_start_ad"] = None
        data["billing_end_ad"] = None

    # 5. 用戶名稱 & 地址 (Usually before '先生/女士/寶號')
    data["customer_name"] = ""
    data["customer_address"] = ""
    for i, line in enumerate(lines):
        if "先生/女士/寶號" in line and i > 0:
            data["customer_name"] = lines[i-1].strip()
            # Find address in lines above customer name
            for k in range(2, 5):
                if i - k >= 0:
                    cand = lines[i - k].strip()
                    if any(x in cand for x in ["市", "縣", "路", "街", "段", "號"]):
                        if i - k - 1 >= 0 and re.match(r'^\d{3,5}$', lines[i - k - 1].strip()):
                            cand = lines[i - k - 1].strip() + " " + cand
                        data["customer_address"] = cand
                        break
            break
            
    # 6. 統一編號 (8 digits)
    m = re.search(r'統一編號[：:]?\s*(\d{8})', full_text)
    if not m:
        for i, line in enumerate(lines):
            if "統一編號" in line and i + 1 < len(lines):
                next_val = lines[i + 1].strip()
                if re.match(r'^\d{8}$', next_val):
                    m_val = next_val
                    break
        else:
            m_val = ""
        data["tax_id"] = m_val
    else:
        data["tax_id"] = m.group(1)
        
    # 7. 設置地點 (Plant location)
    m = re.search(r'設置地點[：:]\s*([^\n\r]+)', full_text)
    if m:
        data["plant_location"] = m.group(1).strip()
    else:
        data["plant_location"] = ""
        
    # Extract City & District
    city_m = re.search(r'(基隆市|台北市|新北市|桃園市|新竹市|新竹縣|苗栗縣|台中市|彰化縣|南投縣|雲林縣|嘉義市|嘉義縣|台南市|高雄市|屏東縣|宜蘭縣|花蓮縣|台東縣|澎湖縣|金門縣|連江縣)', data["plant_location"])
    data["city"] = city_m.group(1) if city_m else ""
    if data["city"]:
        dist_m = re.search(re.escape(data["city"]) + r'([^市縣0-9、]+?[市區鄉鎮])', data["plant_location"])
        data["district"] = dist_m.group(1) if dist_m else ""
    else:
        data["district"] = ""

    # 8. 裝置容量 (Installed Capacity kW)
    m = re.search(r'併聯總裝置容量[^\d]*([0-9.]+)', full_text)
    data["installed_capacity_kw"] = clean_num(m.group(1)) if m else None
    
    # 9. 購售電容量 (Grid-connected Capacity kW)
    m = re.search(r'併聯總購售電容量[^\d]*([0-9.]+)', full_text)
    data["grid_capacity_kw"] = clean_num(m.group(1)) if m else data["installed_capacity_kw"]

    # 10. 服務部門 & 電話
    m = re.search(r'服務部門[：:]\s*([^\n\r]+)', full_text)
    data["taipower_branch"] = m.group(1).strip() if m else ""
    m = re.search(r'服務電話[：:]\s*([^\n\r]+)', full_text)
    data["taipower_tel"] = m.group(1).strip() if m else ""

    # 11. 匯款銀行帳戶
    for i, line in enumerate(lines):
        if "銀行" in line:
            acc = line.strip()
            if i + 1 < len(lines) and ("帳戶" in lines[i + 1] or re.search(r'\d+號', lines[i + 1])):
                acc += " " + lines[i + 1].strip()
            data["payment_account"] = acc.rstrip("。")
            break
    else:
        data["payment_account"] = ""

    # 12. 抄表日 (Meter reading dates)
    m = re.search(r'上次抄表日[^\d]*([0-9]{2,3}年[0-9]{1,2}月[0-9]{1,2}日)', full_text)
    data["meter_read_last"] = m.group(1) if m else ""
    m = re.search(r'本次抄表日[^\d]*([0-9]{2,3}年[0-9]{1,2}月[0-9]{1,2}日)', full_text)
    data["meter_read_curr"] = m.group(1) if m else ""
    m = re.search(r'下次抄表日[^\d]*([0-9]{2,3}年[0-9]{1,2}月[0-9]{1,2}日)', full_text)
    data["meter_read_next"] = m.group(1) if m else ""

    # 13. 金額欄位
    m = re.search(r'購電電費\s*[\n\r]*([0-9,]+)\s*元?', full_text)
    data["purchase_amount"] = clean_num(m.group(1)) if m else None

    m = re.search(r'營業稅\s*[\n\r]*([0-9,]+)\s*元?', full_text)
    data["tax_amount"] = clean_num(m.group(1)) if m else None

    m = re.search(r'本期電表租費\s*[\n\r]*([-0-9,]+)\s*元?', full_text)
    data["meter_rental_amount"] = clean_num(m.group(1)) if m else None

    m = re.search(r'本期電費合計\s*[\n\r]*([0-9,]+)', full_text)
    data["total_bill_amount"] = clean_num(m.group(1)) if m else None

    m_all = re.findall(r'應付總金額\s*[\n\r]*([0-9,]+)\s*元?', full_text)
    if m_all:
        valid = [x for x in m_all if len(x.replace(',', '')) >= 4]
        data["net_payable_amount"] = clean_num(valid[0]) if valid else None
    else:
        data["net_payable_amount"] = None

    # Sanity calculation check
    if data["total_bill_amount"] is None and data["purchase_amount"] and data["tax_amount"]:
        data["total_bill_amount"] = data["purchase_amount"] + data["tax_amount"]
    if data["net_payable_amount"] is None and data["total_bill_amount"] is not None:
        rent = data["meter_rental_amount"] or 0
        data["net_payable_amount"] = data["total_bill_amount"] + rent

    # 14. 機組明細 (Machines)
    machines = []
    for i, line in enumerate(lines):
        if re.match(r'^機組\d+$', line.strip()):
            m_name = line.strip()
            vals = []
            for j in range(1, 5):
                if i + j < len(lines):
                    v = lines[i + j].strip()
                    if re.match(r'^[0-9.,元]+$', v):
                        vals.append(v)
            if len(vals) >= 3:
                machines.append({
                    "name": m_name,
                    "rate": clean_num(vals[0]),
                    "kwh": clean_num(vals[1]),
                    "amount": clean_num(vals[2])
                })
    data["machines"] = machines
    data["machines_json"] = json.dumps(machines, ensure_ascii=False)

    # 15. 總度數 (kWh)
    m = re.search(r'=\s*([0-9,]+)\s*度', full_text)
    if m:
        data["total_kwh"] = clean_num(m.group(1))
    elif machines:
        data["total_kwh"] = sum(m.get("kwh", 0) for m in machines if m.get("kwh"))
    else:
        m_deg = re.search(r'度數\s*[\n\r]*([0-9,]+)', full_text)
        data["total_kwh"] = clean_num(m_deg.group(1)) if m_deg else None

    # 16. 主躉購費率 (FiT rate)
    if machines and machines[0].get("rate"):
        data["fit_rate"] = machines[0].get("rate")
    else:
        m = re.search(r'費率\s*[\n\r]*([0-9.]+)', full_text)
        data["fit_rate"] = clean_num(m.group(1)) if m else None

    data["status"] = "PARSED"
    return data
