import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const url = Deno.env.get('SUPABASE_URL')!;
const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const DEFAULT_ORIGIN = 'https://davidyeh51.github.io';
const STATIC_ALLOWED_ORIGINS = new Set([
  DEFAULT_ORIGIN,
  'http://127.0.0.1:8501',
  'http://127.0.0.1:8765',
  'http://localhost:8765',
  'http://127.0.0.1:4180',
  'http://localhost:4180'
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LEGACY_USER_RE = /^[a-z][a-z0-9_]{2,31}$/;

function resolveAllowedOrigin(requestOrigin: string | null): string {
  if (!requestOrigin) return DEFAULT_ORIGIN;
  if (STATIC_ALLOWED_ORIGINS.has(requestOrigin)) return requestOrigin;
  try {
    const parsed = new URL(requestOrigin);
    if (parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')) {
      return requestOrigin;
    }
  } catch {}
  return DEFAULT_ORIGIN;
}

async function listAllAuthUsers() {
  const out: Array<{ id: string; email?: string; email_confirmed_at?: string | null; last_sign_in_at?: string | null }> = [];
  for (let page = 1; ; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    out.push(...data.users);
    if (data.users.length < 1000) return out;
  }
}

Deno.serve(async (req) => {
  const requestOrigin = req.headers.get('origin');
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': resolveAllowedOrigin(requestOrigin),
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers });

  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: { user }, error: authError } = await service.auth.getUser(token);
    if (authError || !user) return reply({ error: '請先登入。' }, 401);

    const { data: caller } = await service
      .from('bill_app_users')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!caller?.active || caller.role !== 'admin') {
      return reply({ error: '此功能僅限管理者使用。' }, 403);
    }

    const body = await req.json();

    if (body.action === 'list') {
      const [{ data: rows, error }, authUsers] = await Promise.all([
        service.from('bill_app_users').select('user_id,username,email,role,active,created_at').order('created_at'),
        listAllAuthUsers()
      ]);
      if (error) throw error;
      const byId = new Map(authUsers.map((u) => [u.id, u]));
      const users = (rows || []).map((r) => {
        const authUser = byId.get(r.user_id);
        return {
          ...r,
          email: r.email || authUser?.email || '',
          last_sign_in_at: authUser?.last_sign_in_at || null
        };
      });
      return reply({ users });
    }

    if (body.action === 'create') {
      const rawIdentifier = String(body.email ?? body.username ?? '').trim().toLowerCase();
      if (!rawIdentifier) {
        return reply({ error: '請輸入 Email 或帳號。' }, 400);
      }

      let targetEmail = '';
      let username = '';
      if (rawIdentifier.includes('@')) {
        if (!EMAIL_RE.test(rawIdentifier)) {
          return reply({ error: '請輸入有效的 Email 格式（例如 name@acmepointes.com）。' }, 400);
        }
        targetEmail = rawIdentifier;
        username = rawIdentifier;
      } else {
        if (!LEGACY_USER_RE.test(rawIdentifier)) {
          return reply({ error: '若非完整 Email，帳號需為 3–32 個小寫英數或底線，並以英文字母開頭。' }, 400);
        }
        targetEmail = rawIdentifier + '@electricity-bills.acmepoint.internal';
        username = rawIdentifier;
      }

      if (!['admin', 'user'].includes(body.role)) {
        return reply({ error: '請選擇有效權限（管理者或使用者）。' }, 400);
      }

      const password = typeof body.password === 'string' ? body.password : '';
      if (password && password.length < 8) {
        return reply({ error: '密碼至少需要 8 個字元。' }, 400);
      }

      const authUsers = await listAllAuthUsers();
      const existingAuthUser = authUsers.find(
        (u) => String(u.email || '').toLowerCase() === targetEmail
      );

      let targetUserId = '';
      let mode: 'created' | 'linked_existing' = 'created';

      if (existingAuthUser) {
        const { data: existingMember } = await service
          .from('bill_app_users')
          .select('user_id')
          .eq('user_id', existingAuthUser.id)
          .maybeSingle();
        if (existingMember) {
          return reply({ error: '此帳號已存在於權限清單中，請於上方列表調整權限或重設密碼。' }, 400);
        }
        targetUserId = existingAuthUser.id;
        mode = 'linked_existing';
      } else {
        if (!password || password.length < 8) {
          return reply({ error: '此 Email 尚未註冊登入帳號，請設定至少 8 字元的初始密碼。' }, 400);
        }
        const { data, error } = await service.auth.admin.createUser({
          email: targetEmail,
          password,
          email_confirm: true
        });
        if (error || !data?.user) {
          return reply({ error: '建立登入帳號失敗：' + (error?.message || '請確認信箱是否有效。') }, 400);
        }
        targetUserId = data.user.id;
      }

      let finalUsername = username;
      const { data: usernameTaken } = await service
        .from('bill_app_users')
        .select('user_id')
        .eq('username', finalUsername)
        .maybeSingle();
      if (usernameTaken && usernameTaken.user_id !== targetUserId) {
        finalUsername = targetEmail;
      }

      const { error: profileError } = await service
        .from('bill_app_users')
        .insert({
          user_id: targetUserId,
          username: finalUsername,
          email: targetEmail,
          role: body.role,
          active: true
        });
      if (profileError) {
        if (mode === 'created') {
          await service.auth.admin.deleteUser(targetUserId);
        }
        throw profileError;
      }

      return reply({
        success: true,
        mode,
        email: targetEmail,
        role: body.role,
        password_ignored: mode === 'linked_existing' && password.length > 0
      });
    }

    const { data: target } = await service
      .from('bill_app_users')
      .select('*')
      .eq('user_id', body.user_id)
      .maybeSingle();
    if (!target) return reply({ error: '找不到此系統的帳號。' }, 404);
    if (target.user_id === user.id) {
      return reply({ error: '請使用修改密碼功能；管理者不能停用、降級或移除自己。' }, 400);
    }

    if (body.action === 'password') {
      if (typeof body.password !== 'string' || body.password.length < 8) {
        return reply({ error: '新密碼至少需要 8 字元。' }, 400);
      }
      const { error } = await service.auth.admin.updateUserById(target.user_id, {
        password: body.password
      });
      if (error) throw error;
      return reply({ success: true });
    }

    if (body.action === 'update') {
      const patch: Record<string, unknown> = {};
      if (body.role !== undefined) {
        if (!['admin', 'user'].includes(body.role)) return reply({ error: '無效權限。' }, 400);
        patch.role = body.role;
      }
      if (body.active !== undefined) {
        if (typeof body.active !== 'boolean') return reply({ error: '無效啟用狀態。' }, 400);
        patch.active = body.active;
      }
      if (!Object.keys(patch).length) return reply({ error: '沒有要更新的欄位。' }, 400);
      const { error } = await service
        .from('bill_app_users')
        .update(patch)
        .eq('user_id', target.user_id);
      if (error) throw error;
      return reply({ success: true });
    }

    if (body.action === 'remove') {
      const { error } = await service
        .from('bill_app_users')
        .delete()
        .eq('user_id', target.user_id);
      if (error) throw error;
      return reply({ success: true });
    }

    return reply({ error: '不支援的操作。' }, 400);
  } catch (error) {
    console.error('Account operation failed', error);
    return reply({ error: '帳號操作失敗，請稍後再試。' }, 500);
  }
});
