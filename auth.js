// App membership is checked by database RLS and the account administration service.
const BillAuth = {
  profile: null,
  user: null,
  domain: 'electricity-bills.acmepoint.internal',
  email(username) { return username.trim().toLowerCase() + '@' + this.domain; },
  async init() {
    const client = SupabaseBillService.getClient();
    if (!client) { this.message('無法連接登入服務，請重新整理後再試。'); return false; }
    client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') this.lock();
      if (event === 'TOKEN_REFRESHED') setTimeout(() => this.refresh(), 0);
    });
    return this.refresh();
  },
  async refresh() {
    const client = SupabaseBillService.getClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) { this.lock(); return false; }
    const { data: profile, error: accessError } = await client.from('bill_app_users').select('*').eq('user_id', data.user.id).maybeSingle();
    if (accessError || !profile || !profile.active) {
      this.lock(); this.message('此帳號尚未取得電費單系統權限，或已被停用。'); return false;
    }
    this.user = data.user; this.profile = profile;
    document.documentElement.classList.add('authenticated');
    document.getElementById('authGate').hidden = true;
    document.getElementById('accountLabel').textContent = profile.username + ' · ' + (profile.role === 'admin' ? '管理者' : '使用者');
    document.querySelectorAll('[data-admin-only]').forEach(el => el.hidden = profile.role !== 'admin');
    return true;
  },
  lock() {
    this.profile = null; this.user = null;
    document.documentElement.classList.remove('authenticated');
    const gate = document.getElementById('authGate'); if (gate) gate.hidden = false;
    // Never retain another user's bill list or preview after logout.
    if (typeof currentBills !== 'undefined') currentBills = [];
    const rows = document.getElementById('billsTableBody'); if (rows) rows.replaceChildren();
    const frame = document.querySelector('#previewModal iframe'); if (frame) frame.src = 'about:blank';
    for (const key of ['CUSTOM_LOCAL_BILLS','SITE_MAPPINGS']) localStorage.removeItem(key);
    document.querySelectorAll('[id$="Modal"]').forEach(el => el.classList.add('hidden'));
  },
  message(text) { document.getElementById('loginMessage').textContent = text || ''; },
  requireUser() { if (!this.profile?.active) throw new Error('請先登入有效帳號。'); },
  async login(event) {
    event.preventDefault();
    const button = document.getElementById('loginSubmit'); button.disabled = true; this.message('');
    try {
      const username = document.getElementById('loginUsername').value.trim().toLowerCase();
      if (!/^[a-z][a-z0-9_]{2,31}$/.test(username)) throw new Error('請輸入有效的帳號。');
      const password = document.getElementById('loginPassword').value;
      const { error } = await SupabaseBillService.getClient().auth.signInWithPassword({email:this.email(username),password});
      if (error) throw new Error('帳號或密碼錯誤，請重新輸入。');
      if (!await this.refresh()) return;
      document.getElementById('loginPassword').value = '';
      await loadAllData();
    } catch (error) { this.message(error.message); }
    finally { button.disabled = false; }
  },
  async logout() {
    await SupabaseBillService.getClient().auth.signOut({scope:'local'});
    this.lock();
  },
  async changePassword(event) {
    event.preventDefault();
    const message = document.getElementById('passwordMessage'); message.textContent = '';
    try {
      this.requireUser();
      const oldPassword = document.getElementById('currentPassword').value;
      const password = document.getElementById('newPassword').value;
      if (password.length < 8) throw new Error('新密碼至少需要 8 個字元。');
      if (password !== document.getElementById('confirmPassword').value) throw new Error('兩次輸入的新密碼不一致。');
      const client = SupabaseBillService.getClient();
      const { error: verifyError } = await client.auth.signInWithPassword({email:this.user.email,password:oldPassword});
      if (verifyError) throw new Error('目前密碼不正確。');
      const { error } = await client.auth.updateUser({password});
      if (error) throw error;
      event.target.reset(); message.textContent = '密碼已更新。';
    } catch (error) { message.textContent = error.message; }
  },
  async adminRequest(body) {
    this.requireUser();
    if (this.profile.role !== 'admin') throw new Error('此功能僅限管理者使用。');
    const { data, error } = await SupabaseBillService.getClient().functions.invoke('bill-account-admin',{body});
    if (error) {
      let detail;
      try { detail = await error.context.json(); } catch {}
      throw new Error(detail?.error || error.message || '帳號管理服務暫時無法使用。');
    }
    if (data?.error) throw new Error(data.error);
    return data;
  },
  async openAccounts() {
    document.getElementById('accountsModal').classList.remove('hidden');
    const list = document.getElementById('accountsList'); list.textContent = '正在讀取帳號…';
    try {
      const { users } = await this.adminRequest({action:'list'}); list.replaceChildren();
      for (const user of users) {
        const row = document.createElement('div'); row.className = 'flex flex-wrap items-center justify-between gap-2 border-b py-3';
        const label = document.createElement('span');
        label.textContent = user.username + ' · ' + (user.role === 'admin' ? '管理者' : '使用者') + (user.active ? '' : '（已停用）');
        row.append(label);
        if (user.user_id !== this.user.id) {
          const controls = document.createElement('div'); controls.className = 'flex gap-2';
          const select = document.createElement('select'); select.className = 'border rounded px-2 py-1'; select.setAttribute('aria-label', user.username + ' 權限');
          for (const [value,text] of [['user','使用者'],['admin','管理者']]) { const option=document.createElement('option'); option.value=value; option.textContent=text; select.append(option); }
          select.value=user.role;
          select.onchange=async()=>{try{await this.adminRequest({action:'update',user_id:user.user_id,role:select.value});await this.openAccounts();}catch(e){alert(e.message);select.value=user.role;}};
          controls.append(select);
          const toggle = document.createElement('button'); toggle.type='button'; toggle.className='border rounded px-2 py-1'; toggle.textContent=user.active?'停用':'啟用';
          toggle.onclick=async()=>{try{await this.adminRequest({action:'update',user_id:user.user_id,active:!user.active});await this.openAccounts();}catch(e){alert(e.message);}};
          const reset = document.createElement('button'); reset.type='button'; reset.className='border rounded px-2 py-1'; reset.textContent='重設密碼';
          reset.onclick=async()=>{const password=prompt('請輸入 '+user.username+' 的新密碼（至少 8 字元）');if(!password)return;try{await this.adminRequest({action:'password',user_id:user.user_id,password});showToast('密碼已重設。');}catch(e){alert(e.message);}};
          controls.append(toggle,reset); row.append(controls);
        }
        list.append(row);
      }
    } catch (error) { list.textContent=error.message; }
  },
  async createAccount(event) {
    event.preventDefault(); const message=document.getElementById('accountMessage'); message.textContent='';
    const button=event.target.querySelector('button[type=submit]'); button.disabled=true;
    try {
      await this.adminRequest({action:'create',username:document.getElementById('newUsername').value,role:document.getElementById('newRole').value,password:document.getElementById('accountPassword').value});
      event.target.reset(); await this.openAccounts(); message.textContent='帳號已建立。';
    } catch (error) { message.textContent=error.message; }
    finally { button.disabled=false; }
  }
};
