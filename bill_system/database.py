import sqlite3
import json
import re
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple
import pandas as pd

from .config import DB_PATH

def get_connection():
    """Get SQLite database connection with row factory."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize database tables, indexes, and mappings."""
    with get_connection() as conn:
        cursor = conn.cursor()
        
        # Main bills table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS bills (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT UNIQUE NOT NULL,
            file_path TEXT NOT NULL,
            file_size INTEGER,
            file_hash TEXT,
            electric_number TEXT,
            contract_number TEXT,
            site_name TEXT,
            customer_name TEXT,
            customer_address TEXT,
            tax_id TEXT,
            bill_year_month TEXT,
            bill_year_month_ad TEXT,
            billing_period TEXT,
            billing_start_ad TEXT,
            billing_end_ad TEXT,
            plant_location TEXT,
            city TEXT,
            district TEXT,
            installed_capacity_kw REAL,
            grid_capacity_kw REAL,
            total_kwh REAL,
            fit_rate REAL,
            purchase_amount REAL,
            tax_amount REAL,
            total_bill_amount REAL,
            meter_rental_amount REAL,
            net_payable_amount REAL,
            payment_account TEXT,
            taipower_branch TEXT,
            taipower_tel TEXT,
            meter_read_last TEXT,
            meter_read_curr TEXT,
            meter_read_next TEXT,
            machines_json TEXT,
            raw_text TEXT,
            extraction_mode TEXT,
            status TEXT DEFAULT 'PARSED',
            created_at TEXT,
            updated_at TEXT
        );
        """)
        
        # Site mappings table (maps electric_number to site_name)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS site_mappings (
            electric_number TEXT PRIMARY KEY,
            site_name TEXT NOT NULL,
            updated_at TEXT
        );
        """)
        
        # Performance Indexes
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_electric_no ON bills(electric_number);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_contract_no ON bills(contract_number);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_site_name ON bills(site_name);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_customer ON bills(customer_name);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_bill_month ON bills(bill_year_month);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_city ON bills(city);")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_file_hash ON bills(file_hash);")

        conn.commit()

def upsert_bill(data: Dict[str, Any]) -> int:
    """Insert or update a bill record."""
    now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with get_connection() as conn:
        cursor = conn.cursor()
        
        # Check if site_name can be auto-filled from site_mappings
        if not data.get("site_name") and data.get("electric_number"):
            cursor.execute("SELECT site_name FROM site_mappings WHERE electric_number = ?", (data["electric_number"],))
            m_row = cursor.fetchone()
            if m_row and m_row["site_name"]:
                data["site_name"] = m_row["site_name"]
                
        cursor.execute("SELECT id, site_name FROM bills WHERE filename = ?", (data["filename"],))
        row = cursor.fetchone()
        if row and row["site_name"] and not data.get("site_name"):
            data["site_name"] = row["site_name"]
        
        fields = [
            "filename", "file_path", "file_size", "file_hash",
            "electric_number", "contract_number", "site_name", "customer_name", "customer_address",
            "tax_id", "bill_year_month", "bill_year_month_ad", "billing_period",
            "billing_start_ad", "billing_end_ad", "plant_location", "city", "district",
            "installed_capacity_kw", "grid_capacity_kw", "total_kwh", "fit_rate",
            "purchase_amount", "tax_amount", "total_bill_amount", "meter_rental_amount",
            "net_payable_amount", "payment_account", "taipower_branch", "taipower_tel",
            "meter_read_last", "meter_read_curr", "meter_read_next",
            "machines_json", "raw_text", "extraction_mode", "status"
        ]
        
        if row:
            bill_id = row["id"]
            set_clause = ", ".join([f"{f} = ?" for f in fields])
            values = [data.get(f) for f in fields]
            values.append(now_iso)
            values.append(bill_id)
            cursor.execute(f"UPDATE bills SET {set_clause}, updated_at = ? WHERE id = ?", values)
        else:
            cols = ", ".join(fields + ["created_at", "updated_at"])
            placeholders = ", ".join(["?"] * (len(fields) + 2))
            values = [data.get(f) for f in fields] + [now_iso, now_iso]
            cursor.execute(f"INSERT INTO bills ({cols}) VALUES ({placeholders})", values)
            bill_id = cursor.lastrowid
            
        conn.commit()
        return bill_id

def get_bill_by_id(bill_id: int) -> Optional[Dict[str, Any]]:
    """Retrieve bill details by ID."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM bills WHERE id = ?", (bill_id,))
        row = cursor.fetchone()
        if not row:
            return None
        res = dict(row)
        if res.get("machines_json"):
            try:
                res["machines"] = json.loads(res["machines_json"])
            except Exception:
                res["machines"] = []
        else:
            res["machines"] = []
        return res

def get_bill_by_filename(filename: str) -> Optional[Dict[str, Any]]:
    """Retrieve bill by filename."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM bills WHERE filename = ?", (filename,))
        row = cursor.fetchone()
        return dict(row) if row else None

def get_bill_by_hash(file_hash: str) -> Optional[Dict[str, Any]]:
    """Retrieve bill by file hash."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM bills WHERE file_hash = ?", (file_hash,))
        row = cursor.fetchone()
        return dict(row) if row else None

def delete_bill(bill_id: int) -> bool:
    """Delete bill by ID."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM bills WHERE id = ?", (bill_id,))
        conn.commit()
        return cursor.rowcount > 0

def update_bill_fields(bill_id: int, updates: Dict[str, Any]) -> bool:
    """Update editable fields of a bill."""
    allowed = {
        "electric_number", "contract_number", "site_name", "customer_name", "customer_address",
        "tax_id", "bill_year_month", "billing_period", "plant_location", "city",
        "district", "installed_capacity_kw", "grid_capacity_kw", "total_kwh",
        "fit_rate", "purchase_amount", "tax_amount", "total_bill_amount",
        "meter_rental_amount", "net_payable_amount", "payment_account",
        "taipower_branch", "taipower_tel", "meter_read_last", "meter_read_curr",
        "meter_read_next", "status"
    }
    valid_updates = {k: v for k, v in updates.items() if k in allowed}
    if not valid_updates:
        return False
        
    valid_updates["status"] = "MANUAL_EDITED"
    valid_updates["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    set_clause = ", ".join([f"{k} = ?" for k in valid_updates.keys()])
    values = list(valid_updates.values()) + [bill_id]
    
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(f"UPDATE bills SET {set_clause} WHERE id = ?", values)
        
        # If site_name or electric_number updated, sync mapping
        if "site_name" in valid_updates:
            cursor.execute("SELECT electric_number FROM bills WHERE id = ?", (bill_id,))
            r = cursor.fetchone()
            if r and r["electric_number"]:
                cursor.execute("""
                    INSERT INTO site_mappings (electric_number, site_name, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(electric_number) DO UPDATE SET site_name = excluded.site_name, updated_at = excluded.updated_at
                """, (r["electric_number"], valid_updates["site_name"], datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
                
        conn.commit()
        return cursor.rowcount > 0

def list_bills(
    keyword: Optional[str] = None,
    customer: Optional[str] = None,
    month: Optional[str] = None,
    city: Optional[str] = None,
    sort_by: str = "id",
    order: str = "desc",
    limit: int = 100,
    offset: int = 0
) -> Tuple[List[Dict[str, Any]], int]:
    """
    Search and list bills with flexible multi-field filtering.
    Keyword searches across: electric_number, contract_number, site_name, customer_name,
    tax_id, plant_location, taipower_branch, and raw_text.
    """
    where_clauses = []
    params = []
    
    if keyword and keyword.strip():
        kw = f"%{keyword.strip()}%"
        where_clauses.append("""(
            electric_number LIKE ? OR
            contract_number LIKE ? OR
            site_name LIKE ? OR
            customer_name LIKE ? OR
            tax_id LIKE ? OR
            plant_location LIKE ? OR
            taipower_branch LIKE ? OR
            bill_year_month LIKE ? OR
            raw_text LIKE ?
        )""")
        params.extend([kw] * 9)
        
    if customer and customer.strip():
        where_clauses.append("customer_name = ?")
        params.append(customer.strip())
        
    if month and month.strip():
        where_clauses.append("bill_year_month = ?")
        params.append(month.strip())
        
    if city and city.strip():
        where_clauses.append("city = ?")
        params.append(city.strip())
        
    where_sql = " WHERE " + " AND ".join(where_clauses) if where_clauses else ""
    
    # Safe sort column mapping
    sort_map = {
        "id": "id",
        "month": "bill_year_month_ad",
        "electric_no": "electric_number",
        "site_name": "site_name",
        "customer": "customer_name",
        "location": "plant_location",
        "capacity": "installed_capacity_kw",
        "kwh": "total_kwh",
        "rate": "fit_rate",
        "amount": "net_payable_amount",
        "created_at": "created_at"
    }
    col = sort_map.get(sort_by, "id")
    sort_order = "ASC" if str(order).lower() == "asc" else "DESC"
    
    with get_connection() as conn:
        cursor = conn.cursor()
        # Count total
        cursor.execute(f"SELECT COUNT(*) as cnt FROM bills{where_sql}", params)
        total_count = cursor.fetchone()["cnt"]
        
        # Query page
        query_sql = f"""
            SELECT id, filename, file_path, file_size, electric_number, contract_number,
                   site_name, customer_name, tax_id, bill_year_month, billing_period, plant_location,
                   city, district, installed_capacity_kw, grid_capacity_kw, total_kwh,
                   fit_rate, purchase_amount, tax_amount, total_bill_amount, meter_rental_amount,
                   net_payable_amount, taipower_branch, meter_read_curr, status, created_at
            FROM bills{where_sql}
            ORDER BY {col} {sort_order}
            LIMIT ? OFFSET ?
        """
        cursor.execute(query_sql, params + [limit, offset])
        rows = [dict(r) for r in cursor.fetchall()]
        return rows, total_count

def import_dispatch_list(text: str) -> Dict[str, Any]:
    """
    Parse dispatch email/notice text and link site names to electric numbers and bills.
    """
    init_db()
    lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
    now_iso = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    updated_count = 0
    records = []
    
    with get_connection() as conn:
        cursor = conn.cursor()
        seen = set()
        for line in lines:
            m_elec = re.search(r'(\d{2}-\d{2}-\d{4}-\d{2}-\d{1})', line)
            if not m_elec:
                continue
            elec_no = m_elec.group(1)
            site_name = ""
            fname = ""

            # Pattern 1: Brackets format: [elec] site
            m1 = re.search(r'\[\s*' + re.escape(elec_no) + r'\s*\]\s*[-—:：]?\s*([^\s\t|]+)', line)
            if m1:
                site_name = m1.group(1).strip()

            # Pattern 2: Key-value: 案場[名稱]?[:：]?\s*([^\s]+)
            if not site_name:
                m2 = re.search(r'(?:案場|案場名稱)[：:]\s*([^\s,，|]+)', line)
                if m2:
                    site_name = m2.group(1).strip()

            # Pattern 3: Delimited by tabs, pipes, or spaces
            if not site_name:
                cleaned = re.sub(r'^\s*(?:\d+[.)]|[-*])\s*', '', line)
                parts = [p.strip() for p in re.split(r'[\t|]+|\s{1,}', cleaned) if p.strip()]
                for j, p in enumerate(parts):
                    if elec_no in p:
                        if j + 1 < len(parts) and not re.search(r'^\d{8}$', parts[j+1]) and not parts[j+1].endswith('.pdf'):
                            site_name = parts[j+1]
                        elif j > 0 and not re.search(r'^\d{8}$', parts[j-1]):
                            site_name = parts[j-1]
                        break

            # Check filename
            m_pdf = re.search(r'([0-9a-zA-Z_\-]+\.pdf)', line, re.I)
            if m_pdf:
                fname = m_pdf.group(1)

            if site_name:
                site_name = re.sub(r'[\[\]()（）]', '', site_name).strip()

            if elec_no and site_name and elec_no not in seen:
                seen.add(elec_no)
                cursor.execute("""
                    INSERT INTO site_mappings (electric_number, site_name, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(electric_number) DO UPDATE SET site_name = excluded.site_name, updated_at = excluded.updated_at
                """, (elec_no, site_name, now_iso))

                cursor.execute("""
                    UPDATE bills SET site_name = ?, updated_at = ?
                    WHERE electric_number = ? OR filename = ?
                """, (site_name, now_iso, elec_no, fname))

                cnt = cursor.rowcount
                updated_count += max(cnt, 1)
                records.append({
                    "electric_number": elec_no,
                    "site_name": site_name,
                    "filename": fname,
                    "matched_bills": cnt
                })

        conn.commit()
        
    return {
        "success": True,
        "updated_count": updated_count,
        "records": records,
        "message": f"成功匯入 {len(records)} 筆派送案場資料，已自動同步更新關聯電費單！"
    }

def get_kpis() -> Dict[str, Any]:
    """Calculate aggregated summary KPIs across all bills."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                COUNT(*) as bill_count,
                COUNT(DISTINCT electric_number) as plant_count,
                COUNT(DISTINCT customer_name) as customer_count,
                SUM(total_kwh) as sum_kwh,
                SUM(purchase_amount) as sum_purchase_amount,
                SUM(total_bill_amount) as sum_bill_amount,
                SUM(net_payable_amount) as sum_payable_amount,
                AVG(fit_rate) as avg_fit_rate,
                SUM(installed_capacity_kw) as sum_capacity_kw
            FROM bills
        """)
        row = cursor.fetchone()
        return {
            "bill_count": row["bill_count"] or 0,
            "plant_count": row["plant_count"] or 0,
            "customer_count": row["customer_count"] or 0,
            "sum_kwh": round(row["sum_kwh"] or 0, 2),
            "sum_purchase_amount": int(row["sum_purchase_amount"] or 0),
            "sum_bill_amount": int(row["sum_bill_amount"] or 0),
            "sum_payable_amount": int(row["sum_payable_amount"] or 0),
            "avg_fit_rate": round(row["avg_fit_rate"] or 0, 4),
            "sum_capacity_kw": round(row["sum_capacity_kw"] or 0, 2),
        }

def get_filter_options() -> Dict[str, List[str]]:
    """Get list of distinct filter values for the UI dropdowns."""
    with get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT customer_name FROM bills WHERE customer_name != '' ORDER BY customer_name")
        customers = [r["customer_name"] for r in cursor.fetchall()]
        
        cursor.execute("SELECT DISTINCT bill_year_month FROM bills WHERE bill_year_month != '' ORDER BY bill_year_month DESC")
        months = [r["bill_year_month"] for r in cursor.fetchall()]
        
        cursor.execute("SELECT DISTINCT city FROM bills WHERE city != '' ORDER BY city")
        cities = [r["city"] for r in cursor.fetchall()]
        
        return {
            "customers": customers,
            "months": months,
            "cities": cities
        }

def export_bills_to_dataframe(
    keyword: Optional[str] = None,
    customer: Optional[str] = None,
    month: Optional[str] = None,
    city: Optional[str] = None
) -> pd.DataFrame:
    """Generate a clean pandas DataFrame for Excel export."""
    bills, _ = list_bills(keyword=keyword, customer=customer, month=month, city=city, limit=10000)
    
    col_mapping = {
        "site_name": "案場名稱",
        "bill_year_month": "帳單年月",
        "billing_period": "計費期間",
        "electric_number": "電號",
        "contract_number": "契約編號",
        "customer_name": "用戶名稱",
        "tax_id": "統一編號",
        "plant_location": "設置地點",
        "city": "縣市",
        "installed_capacity_kw": "併聯總裝置容量(kW)",
        "total_kwh": "購電度數(kWh)",
        "fit_rate": "躉購費率(元/度)",
        "purchase_amount": "購電電費(元)",
        "tax_amount": "營業稅(元)",
        "total_bill_amount": "本期電費合計(元)",
        "meter_rental_amount": "電表租費扣項(元)",
        "net_payable_amount": "應付總金額(元)",
        "taipower_branch": "服務部門",
        "meter_read_curr": "本次抄表日",
        "filename": "原始檔案名稱"
    }
    
    df = pd.DataFrame(bills)
    if df.empty:
        return pd.DataFrame(columns=list(col_mapping.values()))
        
    cols_to_use = [c for c in col_mapping.keys() if c in df.columns]
    df = df[cols_to_use].rename(columns=col_mapping)
    return df

def export_to_excel(
    excel_path: Path,
    keyword: Optional[str] = None,
    customer: Optional[str] = None,
    month: Optional[str] = None,
    city: Optional[str] = None
) -> Path:
    """Export filtered bills directly into a styled Excel workbook."""
    df = export_bills_to_dataframe(keyword, customer, month, city)
    excel_path = Path(excel_path)
    
    with pd.ExcelWriter(excel_path, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name="電費單明細", index=False)
        
        # Style sheet
        import openpyxl
        from openpyxl.utils import get_column_letter
        from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
        ws = writer.sheets["電費單明細"]
        
        header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
        header_font = Font(name="微軟正黑體", size=11, bold=True, color="FFFFFF")
        regular_font = Font(name="微軟正黑體", size=10)
        thin_border = Border(
            left=Side(style='thin', color='D1D5DB'),
            right=Side(style='thin', color='D1D5DB'),
            top=Side(style='thin', color='D1D5DB'),
            bottom=Side(style='thin', color='D1D5DB')
        )
        
        for col_idx, col in enumerate(ws.iter_cols(min_row=1, max_row=ws.max_row), start=1):
            max_len = 0
            for cell in col:
                cell.border = thin_border
                if cell.row == 1:
                    cell.fill = header_fill
                    cell.font = header_font
                    cell.alignment = Alignment(horizontal="center", vertical="center")
                else:
                    cell.font = regular_font
                    if isinstance(cell.value, (int, float)):
                        cell.alignment = Alignment(horizontal="right", vertical="center")
                    else:
                        cell.alignment = Alignment(horizontal="left", vertical="center")
                val_str = str(cell.value or "")
                max_len = max(max_len, len(val_str.encode('utf-8')))
            col_letter = openpyxl.utils.get_column_letter(col_idx)
            ws.column_dimensions[col_letter].width = max(max_len + 4, 12)
            
    return excel_path
