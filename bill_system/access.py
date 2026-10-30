"""Authenticate local APIs with the same Supabase accounts as GitHub Pages."""
import os
import re
from pathlib import Path
import httpx
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

class BillAccessMiddleware(BaseHTTPMiddleware):
    async def dispatch(self,request,call_next):
        protected=request.url.path.startswith(("/api/","/客戶電費單資料庫"))
        if not protected:return await call_next(request)
        token=request.headers.get("authorization","")
        if not token.startswith("Bearer "):return JSONResponse({"error":"請先登入。"},status_code=401)
        source=(Path(__file__).resolve().parents[1]/"supabase-client.js").read_text("utf-8")
        url=os.environ.get("SUPABASE_URL") or re.search(r"const DEFAULT_URL = '([^']+)'",source)[1]
        key=os.environ.get("SUPABASE_PUBLISHABLE_KEY") or re.search(r"const DEFAULT_ANON_KEY = '([^']+)'",source)[1]
        headers={"apikey":key,"Authorization":token}
        try:
            async with httpx.AsyncClient(timeout=12) as client:
                user=await client.get(url+"/auth/v1/user",headers=headers)
                if user.status_code!=200:return JSONResponse({"error":"登入已失效。"},status_code=401)
                uid=user.json()["id"]
                profile=await client.get(url+"/rest/v1/bill_app_users",headers=headers,params={"select":"role,active","user_id":"eq."+uid})
                rows=profile.json() if profile.status_code==200 else []
                if not rows or not rows[0]["active"]:return JSONResponse({"error":"無電費單系統權限。"},status_code=403)
                if request.method=="DELETE" and rows[0]["role"]!="admin":return JSONResponse({"error":"此功能僅限管理者。"},status_code=403)
        except (httpx.HTTPError,KeyError,ValueError):return JSONResponse({"error":"暫時無法驗證登入狀態。"},status_code=503)
        return await call_next(request)
