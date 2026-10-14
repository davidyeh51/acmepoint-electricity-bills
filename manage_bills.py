import sys
import os
import json
import argparse
from pathlib import Path
import requests
import uvicorn


# Add current workspace to path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from bill_system.config import DEFAULT_HOST, DEFAULT_PORT, BILLS_DIR, DB_PATH
from bill_system.database import init_db, list_bills, get_kpis, export_to_excel
from bill_system.sync_service import sync_folder

def cmd_web(args):
    """Launch the Web UI application."""
    print(f"啟動進金生能源 - 客戶太陽能電費單管理系統...")
    print(f"伺服器網址: http://{args.host}:{args.port}")
    print(f"電費單資料夾: {BILLS_DIR}")
    print(f"資料庫位置: {DB_PATH}")
    print("按 Ctrl+C 可停止伺服器。\n")
    uvicorn.run("bill_system.server:app", host=args.host, port=args.port, reload=False)

def cmd_sync(args):
    """Scan and synchronize electricity bills from folder."""
    print(f"正在掃描資料夾: {BILLS_DIR}...")
    res = sync_folder(force=args.force)
    print(res["message"])
    if res.get("items"):
        print("\n新增/更新明細:")
        for item in res["items"]:
            print(f" - [{item['electric_number']}] {item['customer_name']} | 帳單: {item['bill_year_month']} | 實付: NT$ {item['net_payable_amount']}")
    if res.get("errors"):
        print("\n異常檔案:")
        for err in res["errors"]:
            print(f" ! {err}")

def cmd_list(args):
    """List bills in database."""
    init_db()
    bills, total = list_bills(limit=args.limit)
    kpi = get_kpis()
    print(f"\n=== 電費單資料庫清單 (共 {total} 筆) ===")
    print(f"納管案場: {kpi['plant_count']} 處 | 累計度數: {kpi['sum_kwh']:,.0f} kWh | 累計實收金額: NT$ {kpi['sum_payable_amount']:,}")
    print("-" * 90)
    for b in bills:
        pay = f"NT$ {int(b['net_payable_amount']):,}" if b['net_payable_amount'] else "-"
        kwh = f"{int(b['total_kwh']):,} kWh" if b['total_kwh'] else "-"
        site = b.get('site_name') or '未設案場'
        print(f"ID {b['id']:<3} | {b['bill_year_month']:<8} | 案場: {site:<12} | 電號: {b['electric_number']:<15} | 度數: {kwh:<12} | 實付: {pay:<14}")
    print("-" * 90)

def cmd_search(args):
    """Search bills by keyword."""
    init_db()
    kw = args.keyword
    bills, total = list_bills(keyword=kw)
    print(f"\n搜尋關鍵字: [{kw}] (符合: {total} 筆)")
    print("-" * 90)
    for b in bills:
        pay = f"NT$ {int(b['net_payable_amount']):,}" if b['net_payable_amount'] else "-"
        kwh = f"{int(b['total_kwh']):,} kWh" if b['total_kwh'] else "-"
        site = b.get('site_name') or '未設案場'
        print(f"ID {b['id']:<3} | {b['bill_year_month']:<8} | 案場: {site:<12} | 電號: {b['electric_number']:<15} | 度數: {kwh:<12} | 實付: {pay:<14}")
    print("-" * 90)

def cmd_export(args):
    """Export database to Excel."""
    out_path = Path(args.output) if args.output else BILLS_DIR / "客戶電費單彙總清冊.xlsx"
    print(f"正在匯出電費單資料庫至 Excel...")
    export_to_excel(out_path)
    print(f"匯出成功！檔案已儲存至: {out_path.resolve()}")

def cmd_push_supabase(args):
    """Push local SQLite bills and PDF files to Supabase Database & Storage."""
    url = (args.url or os.environ.get("SUPABASE_URL", "")).rstrip("/")
    key = args.key or os.environ.get("SUPABASE_KEY", "")
    if not url or not key:
        print("\n[錯誤] 請提供 Supabase Project URL 與 API Key！")
        print("使用範例:")
        print("  python manage_bills.py push-supabase --url https://xxxx.supabase.co --key eyJhbGciOi...")
        print("或設定環境變數 SUPABASE_URL 與 SUPABASE_KEY\n")
        return

    init_db()
    bills, total = list_bills(limit=2000)
    print(f"\n=======================================================")
    print(f"準備同步 {total} 筆電費單至 Supabase: {url}")
    print(f"=======================================================")

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
    }

    uploaded_pdf = 0
    synced_db = 0

    for b in bills:
        filename = b["filename"]
        pdf_path = Path(b["file_path"])
        file_url = None

        # 1. 上傳 PDF 至 Supabase Storage (bucket: bills)
        if pdf_path.exists():
            upload_url = f"{url}/storage/v1/object/bills/{filename}"
            storage_headers = {
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "x-upsert": "true",
                "Content-Type": "application/pdf"
            }
            try:
                with open(pdf_path, "rb") as f:
                    resp = requests.post(upload_url, headers=storage_headers, data=f.read(), timeout=15)
                    if resp.status_code in [200, 201]:
                        uploaded_pdf += 1
                        file_url = f"{url}/storage/v1/object/public/bills/{filename}"
                        print(f" [PDF 上傳成功] {filename}")
                    else:
                        file_url = f"{url}/storage/v1/object/public/bills/{filename}"
            except Exception as e:
                print(f" [PDF 上傳警示] {filename}: {e}")

        # 2. 同步資料表記錄至 public.electricity_bills
        payload = {
            "filename": filename,
            "file_url": file_url or f"客戶電費單資料庫/{filename}",
            "file_size": b.get("file_size"),
            "file_hash": b.get("file_hash"),
            "electric_number": b.get("electric_number"),
            "contract_number": b.get("contract_number"),
            "site_name": b.get("site_name"),
            "customer_name": b.get("customer_name"),
            "customer_address": b.get("customer_address"),
            "tax_id": b.get("tax_id"),
            "bill_year_month": b.get("bill_year_month"),
            "bill_year_month_ad": b.get("bill_year_month_ad"),
            "billing_period": b.get("billing_period"),
            "billing_start_ad": b.get("billing_start_ad") or None,
            "billing_end_ad": b.get("billing_end_ad") or None,
            "plant_location": b.get("plant_location"),
            "city": b.get("city"),
            "district": b.get("district"),
            "installed_capacity_kw": b.get("installed_capacity_kw"),
            "grid_capacity_kw": b.get("grid_capacity_kw"),
            "total_kwh": b.get("total_kwh"),
            "fit_rate": b.get("fit_rate"),
            "purchase_amount": b.get("purchase_amount"),
            "tax_amount": b.get("tax_amount"),
            "total_bill_amount": b.get("total_bill_amount"),
            "meter_rental_amount": b.get("meter_rental_amount"),
            "net_payable_amount": b.get("net_payable_amount"),
            "payment_account": b.get("payment_account"),
            "taipower_branch": b.get("taipower_branch"),
            "taipower_tel": b.get("taipower_tel"),
            "meter_read_last": b.get("meter_read_last"),
            "meter_read_curr": b.get("meter_read_curr"),
            "meter_read_next": b.get("meter_read_next"),
            "machines_json": json.loads(b["machines_json"]) if b.get("machines_json") else [],
            "raw_text": b.get("raw_text"),
            "extraction_mode": b.get("extraction_mode"),
            "status": b.get("status") or "PARSED"
        }

        db_endpoint = f"{url}/rest/v1/electricity_bills?on_conflict=filename"
        try:
            r = requests.post(db_endpoint, headers=headers, json=payload, timeout=10)
            if r.status_code in [200, 201]:
                synced_db += 1
                print(f" [DB 同步成功] [{payload['electric_number']}] {payload['site_name']} ({payload['bill_year_month']})")
            else:
                print(f" [DB 同步警示] {filename}: {r.status_code} - {r.text}")
        except Exception as e:
            print(f" [DB 連線失敗] {filename}: {e}")

    print(f"\n=======================================================")
    print(f"同步完成！資料庫: {synced_db}/{total} 筆成功，Storage: {uploaded_pdf} 份 PDF 成功。")
    print(f"=======================================================\n")

def main():
    parser = argparse.ArgumentParser(description="進金生能源 - 客戶太陽能電費單資料庫管理工具")
    subparsers = parser.add_subparsers(dest="command", help="子指令")

    # Web subparser
    web_p = subparsers.add_parser("web", help="啟動 Web 視覺化檢索與上傳系統")
    web_p.add_argument("--host", default=DEFAULT_HOST, help="綁定主機 (預設 127.0.0.1)")
    web_p.add_argument("--port", type=int, default=DEFAULT_PORT, help="綁定連接埠 (預設 8501)")

    # Sync subparser
    sync_p = subparsers.add_parser("sync", help="掃描資料夾並自動辨識新增電費單")
    sync_p.add_argument("--force", action="store_true", help="強制重新辨識所有檔案")

    # List subparser
    list_p = subparsers.add_parser("list", help="條列資料庫中的電費單")
    list_p.add_argument("--limit", type=int, default=50, help="顯示上限筆數")

    # Search subparser
    search_p = subparsers.add_parser("search", help="以關鍵字全文搜尋電費單")
    search_p.add_argument("keyword", help="搜尋關鍵字")

    # Export subparser
    export_p = subparsers.add_parser("export", help="將資料庫匯出為 Excel 檔案")
    export_p.add_argument("--output", "-o", default=None, help="匯出 Excel 檔名或路徑")

    # Push to Supabase subparser
    supa_p = subparsers.add_parser("push-supabase", help="將本機 SQLite 電費單與 PDF 同步至 Supabase")
    supa_p.add_argument("--url", default=None, help="Supabase 專案 URL")
    supa_p.add_argument("--key", default=None, help="Supabase API Key (service_role 或 anon key)")

    args = parser.parse_args()
    if args.command == "web":
        cmd_web(args)
    elif args.command == "sync":
        cmd_sync(args)
    elif args.command == "list":
        cmd_list(args)
    elif args.command == "search":
        cmd_search(args)
    elif args.command == "export":
        cmd_export(args)
    elif args.command == "push-supabase":
        cmd_push_supabase(args)
    else:
        # Default action: launch web UI
        parser.print_help()
        print("\n[預設] 即將為您啟動 Web 系統...")
        class DefaultArgs:
            host = DEFAULT_HOST
            port = DEFAULT_PORT
        cmd_web(DefaultArgs())

if __name__ == "__main__":
    main()

