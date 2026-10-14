import os
from pathlib import Path
from typing import Dict, Any, List

from .config import BILLS_DIR, SUPPORTED_EXTENSIONS
from .parser import parse_taiwan_power_bill, calculate_sha256
from .database import upsert_bill, get_bill_by_filename, init_db

def sync_folder(folder_path: Path = BILLS_DIR, force: bool = False) -> Dict[str, Any]:
    """
    Scan folder for electricity bill PDFs and parse new or changed files into database.
    """
    init_db()
    folder_path = Path(folder_path)
    
    if not folder_path.exists():
        return {
            "success": False,
            "message": f"目錄不存在: {folder_path}",
            "total_files": 0,
            "added_or_updated": 0,
            "skipped": 0,
            "errors": [],
            "items": []
        }
        
    pdf_files = [f for f in folder_path.iterdir() if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS]
    
    total = len(pdf_files)
    added = 0
    skipped = 0
    errors = []
    items = []
    
    for pdf_file in pdf_files:
        try:
            curr_hash = calculate_sha256(pdf_file)
            existing = get_bill_by_filename(pdf_file.name)
            
            # Check if file has already been parsed and unchanged
            if existing and existing.get("file_hash") == curr_hash and not force:
                skipped += 1
                continue
                
            # Parse PDF
            print(f"[Sync] Parsing bill: {pdf_file.name}...")
            parsed = parse_taiwan_power_bill(pdf_file)
            bill_id = upsert_bill(parsed)
            parsed["id"] = bill_id
            added += 1
            items.append({
                "id": bill_id,
                "filename": pdf_file.name,
                "electric_number": parsed.get("electric_number"),
                "customer_name": parsed.get("customer_name"),
                "bill_year_month": parsed.get("bill_year_month"),
                "total_kwh": parsed.get("total_kwh"),
                "net_payable_amount": parsed.get("net_payable_amount"),
                "plant_location": parsed.get("plant_location")
            })
        except Exception as e:
            err_msg = f"檔案 {pdf_file.name} 解析失敗: {str(e)}"
            print(f"[Sync Error] {err_msg}")
            errors.append(err_msg)
            
    return {
        "success": True,
        "total_files": total,
        "added_or_updated": added,
        "skipped": skipped,
        "errors": errors,
        "items": items,
        "message": f"掃描完成！總檔案: {total} 個，新增/更新: {added} 個，已存在略過: {skipped} 個。"
    }
