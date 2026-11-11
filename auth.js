// App membership is checked by database RLS and the account administration service.
const EMAIL_INPUT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LEGACY_USERNAME_RE = /^[a-z][a-z0-9_]{2,31}$/;

const BillAuth = {
  profile: null,
  user: null,
  domain: 'electricity-bills.acmepoint.internal',

  resolveEmail(identifier) {
    const raw = String(identifier || '').trim().toLowerCase();
    if (!raw) return '';
    return raw.includes('@') ? raw : (raw + '@' + this.domain);
  },

  email(username) {
    return this.resolveEmail(username);
  },

  isValidIdentifier(identifier) {
    const raw = String(identifier || '').trim().toLowerCase();
    if (!raw) return false;
    return raw.includes('@') ? EMAIL_INPUT_RE.test(raw) : LEGACY_USERNAME_RE.test(raw);
  },

  isGuest() {
    return !this.user || this.user.id === 'team-guest';
  },

  getDisplayName() {
    if (this.isGuest()) return '免配置瀏覽模式 · 未登入';
    return (this.profile && (this.profile.email || this.profile.username)) || (this.user && this.user.email) || '已登入使用者';
  },

  syncHeaderControls(isSignedIn, isAdmin) {
    const loginBtn = document.getElementById('headerLoginBtn');
    const pwdBtn = document.getElementById('headerPasswordBtn');
    const logoutBtn = document.getElementById('headerLogoutBtn');
    const accBtn = document.getElementById('headerAccountsBtn');
    if (loginBtn) loginBtn.hidden = !!isSignedIn;
    if (pwdBtn) pwdBtn.hidden = !isSignedIn;
    if (logoutBtn) logoutBtn.hidden = !isSignedIn;
    if (accBtn) {
      accBtn.hidden = false;
      accBtn.title = isAdmin
        ? '開啟帳戶與權限管理（可新增 Email 與設定管理者／使用者權限）'
        : '管理或切換管理者帳戶';
    }
    document.querySelectorAll('[data-admin-only]').forEach(el => {
      el.hidden = !isAdmin;
    });
  },

  async init() {
    const client = SupabaseBillService.getClient();
    if (!client) {
      this.setGuestUser();
      return true;
    }
    try {
      client.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') this.setGuestUser();
        if (event === 'TOKEN_REFRESHED') setTimeout(() => this.refresh(), 0);
      });
      return await this.refresh();
    } catch (e) {
      this.setGuestUser();
      return true;
    }
  },

  setGuestUser() {
    this.user = { id: 'team-guest', email: 'guest@acmepoint.internal' };
    this.profile = { username: '團隊成員', role: 'member', active: true };
    document.documentElement.classList.add('authenticated');
    const gate = document.getElementById('authGate');
    if (gate) gate.hidden = true;
    const lbl = document.getElementById('accountLabel');
    if (lbl) lbl.textContent = '免配置瀏覽模式 · 未登入';
    this.syncHeaderControls(false, false);
  },

  async refresh() {
    const client = SupabaseBillService.getClient();
    if (!client) {
      this.setGuestUser();
      return true;
    }
    try {
      const { data, error } = await client.auth.getUser();
      if (error || !data || !data.user) {
        this.setGuestUser();
        return true;
      }
      const { data: profile, error: accessError } = await client
        .from('bill_app_users')
        .select('*')
        .eq('user_id', data.user.id)
        .maybeSingle();
      if (accessError || !profile || !profile.active) {
        this.setGuestUser();
        return true;
      }
      this.user = data.user;
      this.profile = profile;
      document.documentElement.classList.add('authenticated');
      const gate = document.getElementById('authGate');
      if (gate) gate.hidden = true;
      const lbl = document.getElementById('accountLabel');
      const displayId = profile.email || data.user.email || profile.username;
      const roleLabel = profile.role === 'admin' ? '管理者' : '使用者';
      if (lbl) lbl.textContent = `${displayId} · ${roleLabel}`;
      this.syncHeaderControls(true, profile.role === 'admin');
      return true;
    } catch (e) {
      this.setGuestUser();
      return true;
    }
  },

  openLoginModal() {
    const gate = document.getElementById('authGate');
    if (!gate) return;
    this.message('');
    gate.hidden = false;
    const cancelBtn = document.getElementById('authGateCancelBtn');
    if (cancelBtn) cancelBtn.hidden = false;
    const inp = document.getElementById('loginUsername');
    if (inp) setTimeout(() => inp.focus(), 20);
  },

  closeLoginModal() {
    const gate = document.getElementById('authGate');
    if (gate) gate.hidden = true;
    this.message('');
  },

  lock() {
    this.setGuestUser();
  },

  message(text, elementId = 'loginMessage') {
    const msg = document.getElementById(elementId);
    if (msg) msg.textContent = text || '';
  },

  requireUser() {
    if (!this.profile) {
      this.setGuestUser();
    }
  },

  async authenticateWithCredentials(identifier, password) {
    const cleaned = String(identifier || '').trim().toLowerCase();
    if (!this.isValidIdentifier(cleaned)) {
      throw new Error('請輸入有效的 Email（如 name@acmepointes.com）或帳號名稱。');
    }
    const client = SupabaseBillService.getClient() || SupabaseBillService.init();
    if (!client) {
      throw new Error('Supabase 尚未就緒，請重新整理頁面。');
    }
    const targetEmail = this.resolveEmail(cleaned);
    const { data, error } = await client.auth.signInWithPassword({
      email: targetEmail,
      password
    });
    if (error || !data || !data.user) {
      throw new Error('Email / 帳號或密碼錯誤，請重新輸入。');
    }
    const { data: profile, error: accessError } = await client
      .from('bill_app_users')
      .select('*')
      .eq('user_id', data.user.id)
      .maybeSingle();
    if (accessError || !profile || !profile.active) {
      try {
        await client.auth.signOut({ scope: 'local' });
      } catch (e) {}
      throw new Error('此帳號尚未授權使用本系統或已被停用，請聯繫管理者於「帳戶管理」新增授權。');
    }
    await this.refresh();
    return profile;
  },

  async login(event, options = {}) {
    event.preventDefault();
    const fromAccountsModal = !!options.fromAccountsModal;
    const userInpId = fromAccountsModal ? 'accountsLoginIdentifier' : 'loginUsername';
    const pwdInpId = fromAccountsModal ? 'accountsLoginPassword' : 'loginPassword';
    const msgId = fromAccountsModal ? 'accountsLoginMessage' : 'loginMessage';
    const submitId = fromAccountsModal ? 'accountsLoginSubmit' : 'loginSubmit';

    const button = document.getElementById(submitId);
    if (button) button.disabled = true;
    this.message('', msgId);

    try {
      const identifier = document.getElementById(userInpId).value;
      const password = document.getElementById(pwdInpId).value;
      const profile = await this.authenticateWithCredentials(identifier, password);
      document.getElementById(pwdInpId).value = '';
      this.closeLoginModal();
      if (typeof showToast === 'function') {
        const label = profile.email || profile.username;
        showToast(`已登入 ${label}（${profile.role === 'admin' ? '管理者' : '使用者'}）`);
      }
      if (typeof loadAllData === 'function') {
        await loadAllData();
      }
      if (fromAccountsModal) {
        await this.openAccounts();
      }
    } catch (error) {
      this.message(error.message, msgId);
    } finally {
      if (button) button.disabled = false;
    }
  },

  async logout() {
    try {
      const client = SupabaseBillService.getClient();
      if (client) await client.auth.signOut({ scope: 'local' });
    } catch (e) {}
    this.setGuestUser();
    const modal = document.getElementById('accountsModal');
    if (modal) modal.classList.add('hidden');
    if (typeof showToast === 'function') showToast('已登出帳號並切回免配置瀏覽模式。');
    if (typeof loadAllData === 'function') {
      await loadAllData();
    }
  },

  async changePassword(event) {
    event.preventDefault();
    const message = document.getElementById('passwordMessage');
    if (message) message.textContent = '';
    try {
      this.requireUser();
      if (this.isGuest()) throw new Error('請先登入個人帳號後再修改密碼。');
      const oldPassword = document.getElementById('currentPassword').value;
      const password = document.getElementById('newPassword').value;
      if (password.length < 8) throw new Error('新密碼至少需要 8 個字元。');
      if (password !== document.getElementById('confirmPassword').value) throw new Error('兩次輸入的新密碼不一致。');
      const client = SupabaseBillService.getClient();
      const loginEmail = (this.profile && this.profile.email) || (this.user && this.user.email);
      const { error: verifyError } = await client.auth.signInWithPassword({ email: loginEmail, password: oldPassword });
      if (verifyError) throw new Error('目前密碼不正確。');
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      event.target.reset();
      if (message) message.textContent = '密碼已更新。';
    } catch (error) {
      if (message) message.textContent = error.message;
    }
  },

  async adminRequest(body) {
    this.requireUser();
    if (this.isGuest() || this.profile?.role !== 'admin') {
      throw new Error('此功能僅限管理者使用，請先登入管理者帳號。');
    }
    const client = SupabaseBillService.getClient();
    if (!client) throw new Error('Supabase 尚未初始化。');
    const { data, error } = await client.functions.invoke('bill-account-admin', { body });
    if (error) {
      let detail;
      try { detail = await error.context.json(); } catch {}
      throw new Error(detail?.error || error.message || '帳號管理服務暫時無法使用。');
    }
    if (data?.error) throw new Error(data.error);
    return data;
  },

  async openAccounts() {
    const modal = document.getElementById('accountsModal');
    if (!modal) return;
    modal.classList.remove('hidden');

    const identityBadge = document.getElementById('accountsCurrentIdentity');
    const loginGate = document.getElementById('accountsLoginGate');
    const roleNotice = document.getElementById('accountsRoleNotice');
    const roleNoticeText = document.getElementById('accountsRoleNoticeText');
    const manageView = document.getElementById('accountsManageView');

    if (identityBadge) {
      identityBadge.textContent = this.getDisplayName();
    }

    if (this.isGuest()) {
      if (loginGate) loginGate.classList.remove('hidden');
      if (roleNotice) roleNotice.classList.add('hidden');
      if (manageView) manageView.classList.add('hidden');
      this.message('', 'accountsLoginMessage');
      return;
    }

    if (this.profile?.role !== 'admin') {
      if (loginGate) loginGate.classList.add('hidden');
      if (roleNotice) roleNotice.classList.remove('hidden');
      if (manageView) manageView.classList.add('hidden');
      if (roleNoticeText) {
        roleNoticeText.textContent = `您目前登入身分為「${this.profile?.email || this.user?.email || this.profile?.username}（使用者）」，僅「管理者」可新增 Email 帳號或變更權限。`;
      }
      return;
    }

    if (loginGate) loginGate.classList.add('hidden');
    if (roleNotice) roleNotice.classList.add('hidden');
    if (manageView) manageView.classList.remove('hidden');

    const list = document.getElementById('accountsList');
    if (!list) return;
    list.textContent = '正在讀取帳戶清單…';

    try {
      const { users } = await this.adminRequest({ action: 'list' });
      list.replaceChildren();
      if (!users || users.length === 0) {
        list.textContent = '目前尚無已授權帳戶。';
        return;
      }

      for (const user of users) {
        const displayEmail = user.email || (String(user.username || '').includes('@') ? user.username : `${user.username}@electricity-bills.acmepoint.internal`);
        const isSelf = this.user && user.user_id === this.user.id;

        const row = document.createElement('div');
        row.className = 'flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 border-b border-slate-200 py-3 last:border-b-0';

        const left = document.createElement('div');
        left.className = 'space-y-0.5 min-w-0';

        const topLine = document.createElement('div');
        topLine.className = 'flex flex-wrap items-center gap-1.5';

        const emailEl = document.createElement('span');
        emailEl.className = 'font-bold text-slate-900 break-all';
        emailEl.textContent = displayEmail;
        topLine.append(emailEl);

        const roleBadge = document.createElement('span');
        roleBadge.className = user.role === 'admin'
          ? 'px-2 py-0.5 text-[11px] font-bold rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200'
          : 'px-2 py-0.5 text-[11px] font-bold rounded-full bg-slate-100 text-slate-700 border border-slate-200';
        roleBadge.textContent = user.role === 'admin' ? '管理者' : '使用者';
        topLine.append(roleBadge);

        if (!user.active) {
          const inactiveBadge = document.createElement('span');
          inactiveBadge.className = 'px-2 py-0.5 text-[11px] font-bold rounded-full bg-rose-100 text-rose-700';
          inactiveBadge.textContent = '已停用';
          topLine.append(inactiveBadge);
        }

        if (isSelf) {
          const selfBadge = document.createElement('span');
          selfBadge.className = 'px-2 py-0.5 text-[11px] font-bold rounded-full bg-emerald-100 text-emerald-800';
          selfBadge.textContent = '目前登入者';
          topLine.append(selfBadge);
        }

        const metaLine = document.createElement('div');
        metaLine.className = 'text-[11px] text-slate-500 font-mono';
        const loginText = user.last_sign_in_at
          ? new Date(user.last_sign_in_at).toLocaleString('zh-TW', { hour12: false })
          : '尚未登入';
        const aliasText = user.username && user.username !== displayEmail ? `帳號：${user.username} ｜ ` : '';
        metaLine.textContent = `${aliasText}最後登入：${loginText}`;

        left.append(topLine, metaLine);
        row.append(left);

        if (!isSelf) {
          const controls = document.createElement('div');
          controls.className = 'flex flex-wrap items-center gap-1.5 text-xs';

          const select = document.createElement('select');
          select.className = 'border border-slate-300 rounded-lg px-2 py-1.5 bg-white font-semibold text-slate-700';
          select.setAttribute('aria-label', `${displayEmail} 權限`);
          for (const [value, text] of [['user', '使用者'], ['admin', '管理者']]) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = text;
            select.append(option);
          }
          select.value = user.role;
          select.onchange = async () => {
            try {
              await this.adminRequest({ action: 'update', user_id: user.user_id, role: select.value });
              if (typeof showToast === 'function') {
                showToast(`已將 ${displayEmail} 權限變更為「${select.value === 'admin' ? '管理者' : '使用者'}」`);
              }
              await this.openAccounts();
            } catch (e) {
              alert(e.message);
              select.value = user.role;
            }
          };

          const toggle = document.createElement('button');
          toggle.type = 'button';
          toggle.className = 'border border-slate-300 hover:bg-slate-100 rounded-lg px-2.5 py-1.5 font-semibold text-slate-700';
          toggle.textContent = user.active ? '停用' : '啟用';
          toggle.onclick = async () => {
            try {
              await this.adminRequest({ action: 'update', user_id: user.user_id, active: !user.active });
              await this.openAccounts();
            } catch (e) {
              alert(e.message);
            }
          };

          const reset = document.createElement('button');
          reset.type = 'button';
          reset.className = 'border border-slate-300 hover:bg-slate-100 rounded-lg px-2.5 py-1.5 font-semibold text-slate-700';
          reset.textContent = '重設密碼';
          reset.onclick = async () => {
            const password = prompt(`請輸入 ${displayEmail} 的新密碼（至少 8 字元）`);
            if (!password) return;
            try {
              await this.adminRequest({ action: 'password', user_id: user.user_id, password });
              if (typeof showToast === 'function') showToast(`${displayEmail} 密碼已重設。`);
            } catch (e) {
              alert(e.message);
            }
          };

          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'border border-rose-200 text-rose-700 hover:bg-rose-50 rounded-lg px-2.5 py-1.5 font-semibold';
          removeBtn.textContent = '移除權限';
          removeBtn.onclick = async () => {
            if (!confirm(`確定要移除 ${displayEmail} 在電費單系統的操作權限嗎？（不會刪除共用的公司帳號）`)) return;
            try {
              await this.adminRequest({ action: 'remove', user_id: user.user_id });
              if (typeof showToast === 'function') showToast(`已移除 ${displayEmail} 的系統權限。`);
              await this.openAccounts();
            } catch (e) {
              alert(e.message);
            }
          };

          controls.append(select, toggle, reset, removeBtn);
          row.append(controls);
        }

        list.append(row);
      }
    } catch (error) {
      list.textContent = error.message;
    }
  },

  async createAccount(event) {
    event.preventDefault();
    const message = document.getElementById('accountMessage');
    if (message) {
      message.textContent = '';
      message.className = 'text-xs font-semibold sm:col-span-2 text-blue-700';
    }
    const button = event.target.querySelector('button[type=submit]');
    if (button) button.disabled = true;

    try {
      const emailEl = document.getElementById('newAccountEmail') || document.getElementById('newUsername');
      const roleEl = document.getElementById('newRole');
      const pwdEl = document.getElementById('accountPassword');

      const identifier = String(emailEl ? emailEl.value : '').trim().toLowerCase();
      const role = roleEl ? roleEl.value : 'user';
      const password = pwdEl ? pwdEl.value : '';

      if (!this.isValidIdentifier(identifier)) {
        throw new Error('請輸入有效的 Email（如 colleague@acmepointes.com）或小寫英數帳號。');
      }
      if (password && password.length < 8) {
        throw new Error('初始密碼若需設定，長度至少需為 8 個字元。');
      }

      const res = await this.adminRequest({
        action: 'create',
        email: identifier,
        username: identifier,
        role,
        password
      });

      event.target.reset();
      await this.openAccounts();

      const roleText = role === 'admin' ? '管理者' : '使用者';
      const msgText = res?.mode === 'linked_existing'
        ? `已授權現有公司帳號 ${res.email || identifier}（權限：${roleText}${res.password_ignored ? '；沿用該帳號原密碼' : ''}）。`
        : `已新增 Email 帳號 ${res?.email || identifier}（權限：${roleText}）。`;

      if (message) {
        message.className = 'text-xs font-semibold sm:col-span-2 text-emerald-700';
        message.textContent = msgText;
      }
      if (typeof showToast === 'function') showToast(msgText);
    } catch (error) {
      if (message) {
        message.className = 'text-xs font-semibold sm:col-span-2 text-rose-700';
        message.textContent = error.message;
      }
    } finally {
      if (button) button.disabled = false;
    }
  }
};
