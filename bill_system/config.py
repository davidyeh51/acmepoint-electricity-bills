import os
from pathlib import Path

# Base directory for the AI Agent workspace
BASE_DIR = Path(__file__).resolve().parent.parent

# Bills directory containing the PDF files
BILLS_DIR = BASE_DIR / "客戶電費單資料庫"

# SQLite Database path inside the bills directory
DB_PATH = BILLS_DIR / "electricity_bills.db"

# Server configuration
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8501

# Supported extensions
SUPPORTED_EXTENSIONS = {".pdf"}

# Make sure directories exist
BILLS_DIR.mkdir(parents=True, exist_ok=True)
