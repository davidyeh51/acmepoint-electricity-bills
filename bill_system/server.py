import os
import shutil
import tempfile
import urllib.parse
from pathlib import Path
from datetime import datetime

from starlette.applications import Starlette
from starlette.responses import HTMLResponse, JSONResponse, FileResponse, Response
from starlette.routing import Route
from starlette.requests import Request
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware

from .access import BillAccessMiddleware
from .config import BILLS_DIR, DB_PATH, DEFAULT_HOST, DEFAULT_PORT
from .database import (
    init_db, list_bills, get_bill_by_id, delete_bill,
    update_bill_fields, get_kpis, get_filter_options,
    export_to_excel, upsert_bill, import_dispatch_list
)
from .parser import parse_taiwan_power_bill
from .sync_service import sync_folder

ROOT_HTML = Path(__file__).resolve().parent.parent / "index.html"
TEMPLATE_HTML = Path(__file__).resolve().parent / "templates" / "index.html"

async def index_view(request: Request):
    """Serve the Single-Page Application."""
    target = ROOT_HTML if ROOT_HTML.exists() else TEMPLATE_HTML
    if target.exists():
        content = target.read_text(encoding="utf-8")
        return HTMLResponse(content)
    return HTMLResponse("<h1>UI template not found.</h1>", status_code=404)

async def api_list_bills(request: Request):
    """List bills with search & filters."""
    params = request.query_params
    keyword = params.get("q")
    customer = params.get("customer")
    month = params.get("month")
    city = params.get("city")
    sort_by = params.get("sort_by", "id")
    order = params.get("order", "desc")
    limit = int(params.get("limit", 100))
    offset = int(params.get("offset", 0))
    
    bills, total = list_bills(
        keyword=keyword, customer=customer, month=month, city=city,
        sort_by=sort_by, order=order, limit=limit, offset=offset
    )
    return JSONResponse({"bills": bills, "total": total})

async def api_get_bill(request: Request):
    """Get single bill details."""
    bill_id = int(request.path_params["bill_id"])
    bill = get_bill_by_id(bill_id)
    if not bill:
        return JSONResponse({"error": "找不到此電費單記錄"}, status_code=404)
    return JSONResponse(bill)

async def api_update_bill(request: Request):
    """Update editable bill fields."""
    bill_id = int(request.path_params["bill_id"])
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "無效的 JSON 內容"}, status_code=400)
        
    ok = update_bill_fields(bill_id, body)
    if ok:
        updated = get_bill_by_id(bill_id)
        return JSONResponse({"success": True, "bill": updated})
    return JSONResponse({"error": "更新失敗或無更動欄位"}, status_code=400)

async def api_delete_bill(request: Request):
    """Delete bill record and optionally its local file."""
    bill_id = int(request.path_params["bill_id"])
    delete_file = request.query_params.get("delete_file", "false").lower() == "true"
    
    bill = get_bill_by_id(bill_id)
    if not bill:
        return JSONResponse({"error": "找不到此記錄"}, status_code=404)
        
    if delete_file and bill.get("file_path"):
        fpath = Path(bill["file_path"])
        if fpath.exists():
            try:
                fpath.unlink()
            except Exception as e:
                print(f"Could not delete physical file: {e}")
                
    ok = delete_bill(bill_id)
    return JSONResponse({"success": ok})

async def api_kpi(request: Request):
    """Get aggregate statistics."""
    kpi_data = get_kpis()
    return JSONResponse(kpi_data)

async def api_filter_options(request: Request):
    """Get available filter values."""
    opts = get_filter_options()
    return JSONResponse(opts)

async def api_sync(request: Request):
    """Scan folder and recognize new bills."""
    res = sync_folder()
    return JSONResponse(res)

async def api_upload(request: Request):
    """Upload one or more bill PDFs, save, and auto-parse into DB."""
    form = await request.form()
    files = form.getlist("files")
    if not files and "file" in form:
        files = [form["file"]]
        
    if not files:
        return JSONResponse({"error": "未接收到任何上傳檔案"}, status_code=400)
        
    results = []
    errors = []
    
    for upload in files:
        filename = getattr(upload, "filename", "unnamed.pdf")
        if not filename.lower().endswith(".pdf"):
            errors.append(f"{filename} 不是 PDF 格式")
            continue
            
        target_path = BILLS_DIR / filename
        # If file exists with same name, make sure not to overwrite unless necessary or keep original
        try:
            content = await upload.read()
            with open(target_path, "wb") as f:
                f.write(content)
                
            # Parse PDF
            parsed = parse_taiwan_power_bill(target_path)
            bill_id = upsert_bill(parsed)
            parsed["id"] = bill_id
            results.append({
                "id": bill_id,
                "filename": filename,
                "electric_number": parsed.get("electric_number"),
                "customer_name": parsed.get("customer_name"),
                "bill_year_month": parsed.get("bill_year_month"),
                "net_payable_amount": parsed.get("net_payable_amount"),
                "total_kwh": parsed.get("total_kwh"),
                "status": parsed.get("status"),
                "parse_warnings": parsed.get("parse_warnings", [])
            })
        except Exception as e:
            errors.append(f"{filename} 處理失敗: {str(e)}")
            
    return JSONResponse({
        "success": len(results) > 0,
        "added_count": len(results),
        "results": results,
        "errors": errors
    })

async def api_download(request: Request):
    """Download the original electricity bill PDF."""
    bill_id = int(request.path_params["bill_id"])
    bill = get_bill_by_id(bill_id)
    if not bill or not bill.get("file_path"):
        return JSONResponse({"error": "找不到電費單檔案"}, status_code=404)
        
    fpath = Path(bill["file_path"])
    if not fpath.exists():
        # Fallback to BILLS_DIR / filename
        fpath = BILLS_DIR / bill["filename"]
        if not fpath.exists():
            return JSONResponse({"error": "實體 PDF 檔案不存在"}, status_code=404)
            
    encoded_filename = urllib.parse.quote(bill["filename"])
    return FileResponse(
        path=str(fpath),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"
        }
    )

async def api_preview(request: Request):
    """Stream PDF for inline preview in browser."""
    bill_id = int(request.path_params["bill_id"])
    bill = get_bill_by_id(bill_id)
    if not bill or not bill.get("file_path"):
        return JSONResponse({"error": "找不到電費單檔案"}, status_code=404)
        
    fpath = Path(bill["file_path"])
    if not fpath.exists():
        fpath = BILLS_DIR / bill["filename"]
        if not fpath.exists():
            return JSONResponse({"error": "實體 PDF 檔案不存在"}, status_code=404)
            
    encoded_filename = urllib.parse.quote(bill["filename"])
    return FileResponse(
        path=str(fpath),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"inline; filename*=UTF-8''{encoded_filename}"
        }
    )

async def api_export_excel(request: Request):
    """Export filtered bills to styled Excel file."""
    params = request.query_params
    keyword = params.get("q")
    customer = params.get("customer")
    month = params.get("month")
    city = params.get("city")
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    temp_dir = Path(tempfile.gettempdir())
    export_file = temp_dir / f"進金生能源_客戶電費單報表_{timestamp}.xlsx"
    
    export_to_excel(export_file, keyword=keyword, customer=customer, month=month, city=city)
    
    encoded_name = urllib.parse.quote(f"進金生能源_客戶電費單報表_{timestamp}.xlsx")
    return FileResponse(
        path=str(export_file),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_name}"
        }
    )

async def api_import_dispatch(request: Request):
    """Import dispatch text and link site names to electric numbers."""
    try:
        body = await request.json()
        text = body.get("text", "")
    except Exception:
        return JSONResponse({"error": "無效的請求內容"}, status_code=400)
        
    if not text.strip():
        return JSONResponse({"error": "派送清冊文字不得為空"}, status_code=400)
        
    res = import_dispatch_list(text)
    return JSONResponse(res)

from starlette.routing import Route, Mount
from starlette.staticfiles import StaticFiles

async def client_script(request):
    name = request.path_params['name'] + '.js'
    if name not in {'supabase-client.js','auth.js','bill-recognition.js'}:
        return Response(status_code=404)
    return FileResponse(ROOT_HTML.parent / name, media_type='application/javascript')

routes = [
    Route('/{name}.js', endpoint=client_script, methods=['GET']),
    Route("/", endpoint=index_view, methods=["GET"]),
    Route("/api/bills", endpoint=api_list_bills, methods=["GET"]),
    Route("/api/bills/{bill_id:int}", endpoint=api_get_bill, methods=["GET"]),
    Route("/api/bills/{bill_id:int}", endpoint=api_update_bill, methods=["PUT"]),
    Route("/api/bills/{bill_id:int}", endpoint=api_delete_bill, methods=["DELETE"]),
    Route("/api/kpi", endpoint=api_kpi, methods=["GET"]),
    Route("/api/filters", endpoint=api_filter_options, methods=["GET"]),
    Route("/api/sync", endpoint=api_sync, methods=["POST"]),
    Route("/api/upload", endpoint=api_upload, methods=["POST"]),
    Route("/api/dispatch", endpoint=api_import_dispatch, methods=["POST"]),
    Route("/api/download/{bill_id:int}", endpoint=api_download, methods=["GET"]),
    Route("/api/preview/{bill_id:int}", endpoint=api_preview, methods=["GET"]),
    Route("/api/export", endpoint=api_export_excel, methods=["GET"]),
    Mount("/客戶電費單資料庫", app=StaticFiles(directory=str(BILLS_DIR)), name="bills_static"),
]

init_db()

app = Starlette(
    routes=routes,
    middleware=[
        Middleware(BillAccessMiddleware),
        Middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
        )
    ]
)
