import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
const url = Deno.env.get('SUPABASE_URL')!;
const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {auth:{persistSession:false,autoRefreshToken:false}});
const origin = 'https://davidyeh51.github.io';
const allowed = new Set([origin,'http://127.0.0.1:8501','http://127.0.0.1:8765','http://localhost:8765']);
Deno.serve(async(req) => {
  const requestOrigin=req.headers.get('origin');
  const headers={'Content-Type':'application/json','Access-Control-Allow-Origin':allowed.has(requestOrigin||'')?requestOrigin!:origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
  const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(req.method==='OPTIONS')return new Response('ok',{headers});
  if(req.method!=='POST')return reply({error:'Method not allowed'},405);
  try {
    const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
    const {data:{user},error:authError}=await service.auth.getUser(token);
    if(authError||!user)return reply({error:'請先登入。'},401);
    const {data:caller}=await service.from('bill_app_users').select('*').eq('user_id',user.id).maybeSingle();
    if(!caller?.active||caller.role!=='admin')return reply({error:'此功能僅限管理者使用。'},403);
    const body=await req.json();
    if(body.action==='list'){
      const {data,error}=await service.from('bill_app_users').select('user_id,username,role,active,created_at').order('created_at');
      if(error)throw error;return reply({users:data});
    }
    if(body.action==='create'){
      const username=String(body.username||'').trim().toLowerCase();
      if(!/^[a-z][a-z0-9_]{2,31}$/.test(username))return reply({error:'帳號需為 3–32 個小寫英數或底線，並以英文字母開頭。'},400);
      if(!['admin','user'].includes(body.role)||typeof body.password!=='string'||body.password.length<8)return reply({error:'請選擇有效權限，並設定至少 8 字元的密碼。'},400);
      const {data,error}=await service.auth.admin.createUser({email:username+'@electricity-bills.acmepoint.internal',password:body.password,email_confirm:true});
      if(error)return reply({error:'建立帳號失敗，請確認帳號是否已存在。'},400);
      const {error:profileError}=await service.from('bill_app_users').insert({user_id:data.user.id,username,role:body.role});
      if(profileError){await service.auth.admin.deleteUser(data.user.id);throw profileError;}
      return reply({success:true});
    }
    const {data:target}=await service.from('bill_app_users').select('*').eq('user_id',body.user_id).maybeSingle();
    if(!target)return reply({error:'找不到此系統的帳號。'},404);
    if(target.user_id===user.id)return reply({error:'請使用修改密碼功能；管理者不能停用或降級自己。'},400);
    if(body.action==='password'){
      if(typeof body.password!=='string'||body.password.length<8)return reply({error:'新密碼至少需要 8 字元。'},400);
      const {error}=await service.auth.admin.updateUserById(target.user_id,{password:body.password});
      if(error)throw error;return reply({success:true});
    }
    if(body.action==='update'){
      const patch:Record<string,unknown>={};
      if(body.role!==undefined){if(!['admin','user'].includes(body.role))return reply({error:'無效權限。'},400);patch.role=body.role;}
      if(body.active!==undefined){if(typeof body.active!=='boolean')return reply({error:'無效啟用狀態。'},400);patch.active=body.active;}
      if(!Object.keys(patch).length)return reply({error:'沒有要更新的欄位。'},400);
      const {error}=await service.from('bill_app_users').update(patch).eq('user_id',target.user_id);
      if(error)throw error;return reply({success:true});
    }
    return reply({error:'不支援的操作。'},400);
  }catch(error){console.error('Account operation failed',error);return reply({error:'帳號操作失敗，請稍後再試。'},500);}
});
