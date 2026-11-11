const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT_DIR = path.resolve(__dirname, '..');
const AUTH_JS_PATH = path.join(ROOT_DIR, 'auth.js');
const INDEX_HTML_PATH = path.join(ROOT_DIR, 'index.html');
const TEMPLATE_HTML_PATH = path.join(ROOT_DIR, 'bill_system', 'templates', 'index.html');

function createClassList(initial = []) {
  const set = new Set(initial);
  return {
    add(...tokens) {
      tokens.forEach((t) => set.add(t));
    },
    remove(...tokens) {
      tokens.forEach((t) => set.delete(t));
    },
    contains(token) {
      return set.has(token);
    },
    toArray() {
      return [...set];
    }
  };
}

function createElement(tagName, id = '', attrs = {}) {
  const children = [];
  const el = {
    tagName: String(tagName || 'div').toUpperCase(),
    id,
    hidden: !!attrs.hidden,
    disabled: false,
    value: attrs.value !== undefined ? attrs.value : '',
    textContent: '',
    title: '',
    className: attrs.className || '',
    classList: createClassList(attrs.initialClasses || []),
    attributes: {},
    children,
    setAttribute(name, val) {
      this.attributes[name] = String(val);
    },
    getAttribute(name) {
      return this.attributes[name];
    },
    append(...nodes) {
      children.push(...nodes);
    },
    replaceChildren(...nodes) {
      children.length = 0;
      children.push(...nodes);
    },
    querySelector(selector) {
      if (selector === 'button[type=submit]') {
        return el.submitButton || null;
      }
      return null;
    },
    focus() {},
    reset() {
      this._resetCalled = true;
    }
  };
  return el;
}

function findByText(node, needle) {
  if (!node) return null;
  if (typeof node.textContent === 'string' && node.textContent.includes(needle)) return node;
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const hit = findByText(child, needle);
      if (hit) return hit;
    }
  }
  return null;
}

function collectByTag(node, tagName, out = []) {
  if (!node) return out;
  if (node.tagName === tagName.toUpperCase()) out.push(node);
  if (Array.isArray(node.children)) {
    for (const child of node.children) collectByTag(child, tagName, out);
  }
  return out;
}

function createAuthSandbox(options = {}) {
  const elements = new Map();
  const register = (id, tag = 'div', attrs = {}) => {
    const el = createElement(tag, id, attrs);
    elements.set(id, el);
    return el;
  };

  register('authGate', 'div', { hidden: true });
  register('authGateCancelBtn', 'button', { hidden: true });
  register('loginUsername', 'input');
  register('loginPassword', 'input');
  register('loginMessage', 'div');
  register('loginSubmit', 'button');

  register('accountLabel', 'span');
  register('headerAccountsBtn', 'button');
  register('headerLoginBtn', 'button');
  register('headerPasswordBtn', 'button', { hidden: true });
  register('headerLogoutBtn', 'button', { hidden: true });

  register('passwordModal', 'div', { hidden: true });
  register('currentPassword', 'input');
  register('newPassword', 'input');
  register('confirmPassword', 'input');
  register('passwordMessage', 'div');

  register('accountsModal', 'div', { initialClasses: ['hidden'] });
  register('accountsCurrentIdentity', 'span');
  register('accountsLoginGate', 'div', { initialClasses: ['hidden'] });
  register('accountsLoginIdentifier', 'input');
  register('accountsLoginPassword', 'input');
  register('accountsLoginMessage', 'div');
  register('accountsLoginSubmit', 'button');
  register('accountsRoleNotice', 'div', { initialClasses: ['hidden'] });
  register('accountsRoleNoticeText', 'p');
  register('accountsManageView', 'div', { initialClasses: ['hidden'] });
  register('newAccountEmail', 'input');
  register('newRole', 'select', { value: 'user' });
  register('accountPassword', 'input');
  register('accountMessage', 'div');
  register('accountsList', 'div');

  const adminOnlyElements = [createElement('span', 'adminHint', { hidden: true })];

  const state = {
    currentUser: options.currentUser || null,
    profiles: { ...(options.profiles || {}) },
    usersList: options.usersList ? [...options.usersList] : [],
    invokeCalls: [],
    signInCalls: [],
    signOutCalls: [],
    toasts: [],
    alerts: [],
    confirms: [],
    loadAllDataCalls: 0
  };

  const mockClient = {
    auth: {
      onAuthStateChange() {},
      async getUser() {
        return { data: { user: state.currentUser }, error: null };
      },
      async signInWithPassword({ email, password }) {
        state.signInCalls.push({ email, password });
        if (options.signInHandler) {
          return options.signInHandler({ email, password }, state);
        }
        const matched = Object.entries(state.profiles).find(
          ([, p]) => (p.email || '').toLowerCase() === email.toLowerCase()
            || `${p.username}@electricity-bills.acmepoint.internal`.toLowerCase() === email.toLowerCase()
        );
        if (!matched || password === 'wrong-password') {
          return { data: { user: null }, error: { message: 'Invalid login credentials' } };
        }
        const [userId, prof] = matched;
        state.currentUser = { id: userId, email: prof.email || email };
        return { data: { user: state.currentUser }, error: null };
      },
      async signOut(arg) {
        state.signOutCalls.push(arg);
        state.currentUser = null;
        return { error: null };
      },
      async updateUser({ password }) {
        state.updatedPassword = password;
        return { error: null };
      }
    },
    from(table) {
      assert.equal(table, 'bill_app_users');
      let filterUserId = null;
      const builder = {
        select() {
          return builder;
        },
        eq(col, val) {
          if (col === 'user_id') filterUserId = val;
          return builder;
        },
        async maybeSingle() {
          const profile = filterUserId ? (state.profiles[filterUserId] || null) : null;
          return { data: profile, error: null };
        }
      };
      return builder;
    },
    functions: {
      async invoke(fnName, { body }) {
        state.invokeCalls.push({ fnName, body: JSON.parse(JSON.stringify(body)) });
        if (options.invokeHandler) {
          return options.invokeHandler(body, state);
        }
        if (body.action === 'list') {
          return { data: { users: state.usersList }, error: null };
        }
        if (body.action === 'create') {
          return {
            data: {
              ok: true,
              mode: body.email === 'existing@acmepointes.com' ? 'linked_existing' : 'created',
              email: body.email,
              username: body.username,
              role: body.role,
              password_ignored: body.email === 'existing@acmepointes.com'
            },
            error: null
          };
        }
        return { data: { ok: true }, error: null };
      }
    }
  };

  const doc = {
    documentElement: { classList: createClassList() },
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelectorAll(selector) {
      return selector === '[data-admin-only]' ? adminOnlyElements : [];
    },
    createElement(tagName) {
      return createElement(tagName);
    }
  };

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    document: doc,
    window: {},
    SupabaseBillService: {
      getClient() {
        return mockClient;
      },
      init() {
        return mockClient;
      }
    },
    showToast(msg) {
      state.toasts.push(msg);
    },
    loadAllData: async () => {
      state.loadAllDataCalls += 1;
    },
    alert(msg) {
      state.alerts.push(msg);
    },
    confirm(msg) {
      state.confirms.push(msg);
      return true;
    },
    prompt() {
      return 'NewPassword123!';
    }
  };
  sandbox.globalThis = sandbox;

  const source = fs.readFileSync(AUTH_JS_PATH, 'utf8');
  vm.runInNewContext(`${source}\nthis.__BillAuth = BillAuth;`, sandbox, { filename: 'auth.js' });

  return {
    BillAuth: sandbox.__BillAuth,
    elements,
    adminOnlyElements,
    state
  };
}

test('resolveEmail and isValidIdentifier accept both real Email and legacy usernames', () => {
  const { BillAuth } = createAuthSandbox();

  assert.equal(BillAuth.resolveEmail('  Colleague@AcmepointES.com '), 'colleague@acmepointes.com');
  assert.equal(BillAuth.resolveEmail('davidyeh'), 'davidyeh@electricity-bills.acmepoint.internal');
  assert.equal(BillAuth.resolveEmail(''), '');

  assert.equal(BillAuth.isValidIdentifier('davidyeh@acmepointes.com'), true);
  assert.equal(BillAuth.isValidIdentifier('colleague.test+01@acmepointes.com'), true);
  assert.equal(BillAuth.isValidIdentifier('davidyeh'), true);

  assert.equal(BillAuth.isValidIdentifier(''), false);
  assert.equal(BillAuth.isValidIdentifier('ab'), false);
  assert.equal(BillAuth.isValidIdentifier('bad user@acmepointes.com'), false);
  assert.equal(BillAuth.isValidIdentifier('@acmepointes.com'), false);
  assert.equal(BillAuth.isValidIdentifier('user-name'), false);
});

test('Guest mode exposes Accounts & Login buttons in header and shows inline admin login inside accounts modal', async () => {
  const { BillAuth, elements, adminOnlyElements } = createAuthSandbox();

  await BillAuth.init();

  assert.equal(BillAuth.isGuest(), true);
  assert.equal(elements.get('accountLabel').textContent, '免配置瀏覽模式 · 未登入');
  assert.equal(elements.get('headerAccountsBtn').hidden, false);
  assert.equal(elements.get('headerLoginBtn').hidden, false);
  assert.equal(elements.get('headerPasswordBtn').hidden, true);
  assert.equal(elements.get('headerLogoutBtn').hidden, true);
  assert.equal(adminOnlyElements[0].hidden, true);

  await BillAuth.openAccounts();

  assert.equal(elements.get('accountsModal').classList.contains('hidden'), false);
  assert.equal(elements.get('accountsCurrentIdentity').textContent, '免配置瀏覽模式 · 未登入');
  assert.equal(elements.get('accountsLoginGate').classList.contains('hidden'), false);
  assert.equal(elements.get('accountsRoleNotice').classList.contains('hidden'), true);
  assert.equal(elements.get('accountsManageView').classList.contains('hidden'), true);
});

test('Regular user login hides admin controls and blocks adminRequest', async () => {
  const { BillAuth, elements, adminOnlyElements, state } = createAuthSandbox({
    profiles: {
      'user-001': {
        user_id: 'user-001',
        username: 'minahuang@acmepointes.com',
        email: 'minahuang@acmepointes.com',
        role: 'user',
        active: true
      }
    }
  });

  await BillAuth.init();
  elements.get('loginUsername').value = 'minahuang@acmepointes.com';
  elements.get('loginPassword').value = 'SecretPass123!';

  await BillAuth.login({ preventDefault() {} });

  assert.equal(BillAuth.isGuest(), false);
  assert.equal(elements.get('accountLabel').textContent, 'minahuang@acmepointes.com · 使用者');
  assert.equal(elements.get('headerLoginBtn').hidden, true);
  assert.equal(elements.get('headerPasswordBtn').hidden, false);
  assert.equal(elements.get('headerLogoutBtn').hidden, false);
  assert.equal(elements.get('headerAccountsBtn').hidden, false);
  assert.equal(adminOnlyElements[0].hidden, true);
  assert.equal(state.loadAllDataCalls, 1);

  await BillAuth.openAccounts();

  assert.equal(elements.get('accountsLoginGate').classList.contains('hidden'), true);
  assert.equal(elements.get('accountsRoleNotice').classList.contains('hidden'), false);
  assert.equal(elements.get('accountsManageView').classList.contains('hidden'), true);
  assert.match(elements.get('accountsRoleNoticeText').textContent, /僅「管理者」可新增 Email 帳號/);

  await assert.rejects(
    () => BillAuth.adminRequest({ action: 'list' }),
    /僅限管理者使用/
  );
  assert.equal(state.invokeCalls.length, 0);
});

test('Unauthorized or inactive account is signed out and rejected on login', async () => {
  const { BillAuth, state } = createAuthSandbox({
    profiles: {
      'disabled-001': {
        user_id: 'disabled-001',
        username: 'disabled@acmepointes.com',
        email: 'disabled@acmepointes.com',
        role: 'user',
        active: false
      }
    },
    signInHandler: async ({ email }) => {
      if (email === 'stranger@acmepointes.com') {
        return { data: { user: { id: 'stranger-999', email } }, error: null };
      }
      return { data: { user: { id: 'disabled-001', email } }, error: null };
    }
  });

  await assert.rejects(
    () => BillAuth.authenticateWithCredentials('stranger@acmepointes.com', 'AnyPass123!'),
    /尚未授權使用本系統或已被停用/
  );
  assert.equal(state.signOutCalls.length, 1);

  await assert.rejects(
    () => BillAuth.authenticateWithCredentials('disabled@acmepointes.com', 'AnyPass123!'),
    /尚未授權使用本系統或已被停用/
  );
  assert.equal(state.signOutCalls.length, 2);
});

test('Admin Email login via accounts modal manages Email accounts, roles, validation, and logout', async () => {
  const adminId = 'admin-david-001';
  const colleagueId = 'user-colleague-002';

  const { BillAuth, elements, adminOnlyElements, state } = createAuthSandbox({
    profiles: {
      [adminId]: {
        user_id: adminId,
        username: 'davidyeh@acmepointes.com',
        email: 'davidyeh@acmepointes.com',
        role: 'admin',
        active: true
      }
    },
    usersList: [
      {
        user_id: adminId,
        username: 'davidyeh@acmepointes.com',
        email: 'davidyeh@acmepointes.com',
        role: 'admin',
        active: true,
        last_sign_in_at: '2026-11-11T05:00:00Z'
      },
      {
        user_id: colleagueId,
        username: 'evanyang@acmepointes.com',
        email: 'evanyang@acmepointes.com',
        role: 'user',
        active: true,
        last_sign_in_at: null
      }
    ]
  });

  await BillAuth.init();
  await BillAuth.openAccounts();

  elements.get('accountsLoginIdentifier').value = 'davidyeh@acmepointes.com';
  elements.get('accountsLoginPassword').value = 'AdminPass123!';
  await BillAuth.login({ preventDefault() {} }, { fromAccountsModal: true });

  assert.equal(BillAuth.isGuest(), false);
  assert.equal(elements.get('accountLabel').textContent, 'davidyeh@acmepointes.com · 管理者');
  assert.equal(adminOnlyElements[0].hidden, false);
  assert.equal(elements.get('accountsManageView').classList.contains('hidden'), false);
  assert.equal(state.invokeCalls[0].fnName, 'bill-account-admin');
  assert.deepEqual(state.invokeCalls[0].body, { action: 'list' });

  const listEl = elements.get('accountsList');
  assert.equal(listEl.children.length, 2);
  assert.ok(findByText(listEl.children[0], '目前登入者'));
  assert.equal(collectByTag(listEl.children[0], 'select').length, 0);

  const roleSelects = collectByTag(listEl.children[1], 'select');
  assert.equal(roleSelects.length, 1);
  assert.equal(roleSelects[0].value, 'user');

  // Change colleague role from user -> admin
  roleSelects[0].value = 'admin';
  await roleSelects[0].onchange();
  assert.deepEqual(state.invokeCalls[1].body, {
    action: 'update',
    user_id: colleagueId,
    role: 'admin'
  });

  // Invalid email rejected cleanly before Edge Function call
  const invokeCountBeforeInvalid = state.invokeCalls.length;
  elements.get('newAccountEmail').value = 'not-an-email!';
  elements.get('newRole').value = 'user';
  elements.get('accountPassword').value = '';
  await BillAuth.createAccount({
    preventDefault() {},
    target: {
      querySelector: () => null,
      reset() {}
    }
  });
  assert.equal(state.invokeCalls.length, invokeCountBeforeInvalid);
  assert.match(elements.get('accountMessage').textContent, /請輸入有效的 Email/);
  assert.match(elements.get('accountMessage').className, /text-rose-700/);

  // Create new Email account with admin role
  const submitBtn = { disabled: false };
  let resetCalled = false;
  elements.get('newAccountEmail').value = 'Finance@AcmepointES.com';
  elements.get('newRole').value = 'admin';
  elements.get('accountPassword').value = 'InitPass123!';
  await BillAuth.createAccount({
    preventDefault() {},
    target: {
      querySelector: () => submitBtn,
      reset() { resetCalled = true; }
    }
  });
  assert.equal(resetCalled, true);
  assert.equal(submitBtn.disabled, false);
  const createCall = state.invokeCalls.find((c) => c.body.action === 'create');
  assert.deepEqual(createCall.body, {
    action: 'create',
    email: 'finance@acmepointes.com',
    username: 'finance@acmepointes.com',
    role: 'admin',
    password: 'InitPass123!'
  });
  assert.match(elements.get('accountMessage').textContent, /已新增 Email 帳號 finance@acmepointes\.com（權限：管理者）/);
  assert.match(elements.get('accountMessage').className, /text-emerald-700/);

  // Link existing company account without resetting password
  elements.get('newAccountEmail').value = 'existing@acmepointes.com';
  elements.get('newRole').value = 'user';
  elements.get('accountPassword').value = '';
  await BillAuth.createAccount({
    preventDefault() {},
    target: {
      querySelector: () => null,
      reset() {}
    }
  });
  assert.match(elements.get('accountMessage').textContent, /已授權現有公司帳號 existing@acmepointes\.com（權限：使用者；沿用該帳號原密碼）/);

  // Logout restores guest UI and hides modal
  await BillAuth.logout();
  assert.equal(BillAuth.isGuest(), true);
  assert.equal(elements.get('headerLoginBtn').hidden, false);
  assert.equal(elements.get('accountsModal').classList.contains('hidden'), true);
});

test('index.html and bill_system/templates/index.html remain synchronized with required Account Management IDs', () => {
  const indexHtml = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const templateHtml = fs.readFileSync(TEMPLATE_HTML_PATH, 'utf8');
  assert.equal(indexHtml, templateHtml);

  const requiredIds = [
    'headerAccountsBtn',
    'headerLoginBtn',
    'headerPasswordBtn',
    'headerLogoutBtn',
    'authGate',
    'authGateCancelBtn',
    'accountsModal',
    'accountsLoginGate',
    'accountsLoginIdentifier',
    'accountsLoginPassword',
    'accountsRoleNotice',
    'accountsManageView',
    'newAccountEmail',
    'newRole',
    'accountPassword',
    'accountsList'
  ];
  for (const id of requiredIds) {
    assert.ok(indexHtml.includes(`id="${id}"`), `Missing id="${id}" in index.html`);
  }
  assert.ok(indexHtml.includes('auth.js?v=20261111.1'), 'Expected bumped auth.js cache-buster in index.html');
});
