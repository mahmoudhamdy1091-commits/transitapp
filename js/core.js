// ╔══════════════════════════════════════════════════════════╗
// ║  core.js — Config · State · Cache · API · Auth          ║
// ║  Transit Management System                               ║
// ╚══════════════════════════════════════════════════════════╝
//
// ⚠️  تعديلات الأمان المُطبّقة في هذا الملف:
//   1. حُذف btoa(pass) / atob(savedPass) — كانت خطراً أمنياً
//   2. ميزة "تذكرني" تحفظ الـ email فقط (لا كلمة المرور)
//   3. باقي المنطق لم يتغير — نفس السلوك تماماً

// ════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════
const SB_URL  = 'https://tepaonhqszocyjsdcyoz.supabase.co';
const SB_KEY  = 'sb_publishable_l24VhFauUbUD7GfAyEnyhQ_9F_PKHH3';

// ════════════════════════════════════════
// STATE
// ════════════════════════════════════════
const state = {
  token: null,
  refreshToken: null,
  user: null,
  system: 'BOX',
  currentFileNo: null,
  currentTab: 0,
  dealsFilter: 'all',
  allDeals: [],
  allDealsEnriched: [],
  allVehicles: [],
  allSales: [],
  allExpenses: [],
  allCollections: [],
  allPayments: [],
  currentDeal: null,
  currentVehicles: [],
  currentSales: [],
  chartOfAccounts: {},
  _cacheSystem: null,
  _cacheTime: 0,
};

// ════════════════════════════════════════
// CACHE
// ════════════════════════════════════════
function cacheStale() {
  return state._cacheSystem !== state.system || (Date.now() - state._cacheTime) > 60000;
}

let _cacheLoadingPromise = null;

async function ensureCache() {
  if (!cacheStale()) return;
  if (_cacheLoadingPromise) {
    await _cacheLoadingPromise;
    return;
  }
  _cacheLoadingPromise = _doLoadCache();
  try {
    await _cacheLoadingPromise;
  } finally {
    _cacheLoadingPromise = null;
  }
}

async function _doLoadCache() {
  const sys = state.system;
  const [deals, vehicles, sales, expenses, collections, payments] = await Promise.all([
    apiGetAll('purchase_orders', { select:'*', system_type:`eq.${sys}`, order:'created_at.desc' }),
    apiGetAll('vehicles',        { select:'*', system_type:`eq.${sys}` }),
    apiGetAll('sales',           { select:'*', system_type:`eq.${sys}` }),
    apiGetAll('expenses',        { select:'*', system_type:`eq.${sys}` }),
    apiGetAll('collections',     { select:'*', system_type:`eq.${sys}` }),
    apiGetAll('payments',        { select:'*', system_type:`eq.${sys}` }),
  ]);
  state.allDeals       = deals       || [];
  state.allVehicles    = vehicles    || [];
  state.allSales       = sales       || [];
  state.allExpenses    = expenses    || [];
  state.allCollections = collections || [];
  state.allPayments    = payments    || [];
  state._cacheSystem   = sys;
  state._cacheTime     = Date.now();

  const vehicleMap = {}, salesMap = {}, expMap = {};
  state.allVehicles.forEach(v => { vehicleMap[v.file_no]=vehicleMap[v.file_no]||[]; vehicleMap[v.file_no].push(v); });
  state.allSales.forEach(s   => { salesMap[s.file_no]=salesMap[s.file_no]||[];      salesMap[s.file_no].push(s); });
  state.allExpenses.forEach(e=> { expMap[e.file_no]=expMap[e.file_no]||[];          expMap[e.file_no].push(e); });

  state.allDealsEnriched = state.allDeals.map(d => {
    const fn = d.file_no;
    const vList = vehicleMap[fn]||[], sList = salesMap[fn]||[], eList = expMap[fn]||[];
    const postedSales = sList.filter(isPosted);
    const postedExp   = eList.filter(isPosted);
    const soldCount   = postedSales.length;
    const totalCost   = +d.total_purchase || vList.reduce((s,v)=>s+(+v.purchase_price||0),0);
    const totalExp    = postedExp.reduce((s,e)=>s+(+e.amount||0),0);
    const totalSale   = postedSales.reduce((s,s2)=>s+(+s2.sale_price||0),0);
    const soldVins    = new Set(postedSales.map(s=>s.vin));
    const fullCost    = totalCost + totalExp;
    return { ...d,
      _vTotal:vList.length, _vSold:soldCount, _vLeft:Math.max(0,vList.length-soldCount),
      _totalCost:totalCost, _totalExp:totalExp, _fullCost:fullCost,
      _totalSale:totalSale, _profit:totalSale-fullCost, _remaining:fullCost-totalSale,
      _stockVehicles: vList.filter(v => !soldVins.has(v.vin)),
    };
  });
}

function invalidateCache() {
  state._cacheTime = 0;
  _cacheLoadingPromise = null;
}

// ════════════════════════════════════════
// CORE RULES
// post_status = null → posted (بيانات قديمة قبل إضافة العمود)
// ════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// STATUS FILTERS — المصدر الواحد لكل فلاتر post_status
// عدّل هنا فقط — ينعكس على كل التطبيق
//
// post_status values:
//   null          → بيانات قديمة (تُعامَل كـ posted)
//   'posted'      → مرحّلة ومعتمدة
//   'draft'       → في انتظار الموافقة
//   'pending_edit'→ معتمدة + طلب تعديل معلق
//   'pending_void'→ معتمدة + طلب إلغاء معلق
//   'voided'      → ملغاة نهائياً
//   'cancelled'   → مرفوضة
// ════════════════════════════════════════════════════════════

// isPosted: مرحّلة فعلاً (يشمل null للبيانات القديمة)
function isPosted(row) {
  return !row.post_status || row.post_status === 'posted';
}

// isDraft: في انتظار الموافقة
function isDraft(row) {
  return row.post_status === 'draft';
}

// isActive: تُحسب في الأرقام (posted + pending_edit)
// pending_edit = عملية معتمدة قيمتها تحت المراجعة → تُحسب
function isActive(row) {
  return isPosted(row) || row.post_status === 'pending_edit';
}

// isEffective: تُحسب في الأرقام وليست ملغاة
// الأكثر استخداماً في الإجماليات والتقارير
function isEffective(row) {
  return isActive(row) && row.post_status !== 'voided';
}

// isVisible: تظهر في الجداول (كل شيء إلا voided)
// للعرض فقط — لا للحساب
function isVisible(row) {
  return row.post_status !== 'voided';
}

// isPending: طلب معلق (تعديل أو إلغاء)
function isPending(row) {
  return row.post_status === 'pending_edit' || row.post_status === 'pending_void';
}

// ════════════════════════════════════════
// TOKEN REFRESH
// ════════════════════════════════════════
async function refreshAccessToken() {
  const rt = state.refreshToken || localStorage.getItem('tm_refresh');
  if (!rt) { logout(); return false; }
  try {
    const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'apikey': SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt })
    });
    const data = await res.json();
    if (data.access_token) {
      state.token        = data.access_token;
      state.refreshToken = data.refresh_token || rt;
      localStorage.setItem('tm_token',   data.access_token);
      localStorage.setItem('tm_refresh', data.refresh_token || rt);
      return true;
    }
  } catch(e) { console.error('refreshAccessToken:', e); }
  logout();
  return false;
}

// ════════════════════════════════════════
// API HELPERS
// ════════════════════════════════════════
function headers(extra = {}) {
  const h = {
    'apikey': SB_KEY,
    'Content-Type': 'application/json',
    ...extra
  };
  if (state.token) {
    h['Authorization'] = `Bearer ${state.token}`;
  } else {
    h['Authorization'] = `Bearer ${SB_KEY}`;
    console.warn('headers(): لا يوجد access token — يُستخدم anon key');
  }
  return h;
}

async function apiGet(table, params = {}) {
  const NO_ENCODE = new Set(['select','order']);
  const qs = Object.entries(params).map(([k,v]) => NO_ENCODE.has(k) ? `${k}=${v}` : `${k}=${encodeURIComponent(v)}`).join('&');
  const url = `${SB_URL}/rest/v1/${table}${qs ? '?' + qs : ''}`;
  // ✅ Audit fix: رُفع الحد من 9999 إلى 49999 لمنع قطع البيانات الصامت
  const h = headers({ 'Range': '0-49999', 'Range-Unit': 'items' });
  // ✅ منع الكاش المتصفح/HTTP لطلبات GET — كان يسبب عرض بيانات قديمة
  // مباشرة بعد عمليات التعديل (مثال: طلب إلغاء يبقى ظاهراً في قائمة الانتظار رغم تنفيذه)
  let res = await fetch(url, { headers: h, cache: 'no-store' });
  if (res.status === 401) {
    const ok = await refreshAccessToken();
    if (!ok) throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مجدداً');
    res = await fetch(url, { headers: h, cache: 'no-store' });
  }
  // ✅ Audit fix: HTTP 206 = Supabase أعاد بيانات جزئية فقط (تجاوز الحد)
  // نُسجّل تحذيراً في الـ console بدلاً من قبول النتيجة بصمت
  if (res.status === 206) {
    const contentRange = res.headers.get('Content-Range') || '';
    console.warn(
      `[Transit] ⚠️ apiGet("${table}"): تحذير truncation — HTTP 206 Partial Content.\n` +
      `Content-Range: ${contentRange}\n` +
      `الجدول يحتوي على أكثر من 50,000 سجل أو تجاوز الحد المحدد.\n` +
      `راجع إضافة pagination لهذا الجدول.`
    );
  }
  if (!res.ok && res.status !== 206) {
    const e = await res.json().catch(()=>({}));
    throw new Error(e.message || res.statusText);
  }
  return res.json();
}

async function apiGetAll(table, params = {}) {
  const { system_type, ...rest } = params;
  if (!system_type || !system_type.startsWith('eq.')) {
    return apiGet(table, params);
  }
  const [matched, nullRows] = await Promise.all([
    apiGet(table, params),
    apiGet(table, { ...rest, system_type: 'is.null' }),
  ]);
  const seen = new Set();
  const out = [];
  [...(matched||[]), ...(nullRows||[])].forEach(r => {
    const key = r.id ?? JSON.stringify(r);
    if (!seen.has(key)) { seen.add(key); out.push(r); }
  });
  return out;
}

async function apiPost(table, data) {
  const body = JSON.stringify(data);
  let res = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers({'Prefer':'return=representation'}),
    body
  });
  if (res.status === 401) {
    const ok = await refreshAccessToken();
    if (!ok) throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مجدداً');
    res = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: headers({'Prefer':'return=representation'}),
      body
    });
  }
  const resBody = await res.json();
  if (!res.ok) throw new Error(resBody.message || resBody.error || res.statusText);
  return resBody;
}

async function apiPatch(table, matchParams, data) {
  let url = `${SB_URL}/rest/v1/${table}?`;
  for (const [k, v] of Object.entries(matchParams)) url += `${k}=${encodeURIComponent(v)}&`;
  const body = JSON.stringify(data);
  let res = await fetch(url, {
    method: 'PATCH',
    headers: headers({'Prefer':'return=representation'}),
    body
  });
  if (res.status === 401) {
    const ok = await refreshAccessToken();
    if (!ok) throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مجدداً');
    res = await fetch(url, {
      method: 'PATCH',
      headers: headers({'Prefer':'return=representation'}),
      body
    });
  }
  const resBody = await res.json();
  if (!res.ok) throw new Error(resBody.message || resBody.error || res.statusText);
  return resBody;
}

async function apiRpc(fn, args = {}) {
  const body = JSON.stringify(args);
  let res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: headers({'Content-Type':'application/json'}),
    body
  });
  if (res.status === 401) {
    const ok = await refreshAccessToken();
    if (!ok) throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مجدداً');
    res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: headers({'Content-Type':'application/json'}),
      body
    });
  }
  if (!res.ok) {
    const e = await res.json().catch(()=>({}));
    throw new Error(e.message || res.statusText);
  }
  return res.json();
}

// ✅ يحدّ من طول old_value/new_value — سجلات قديمة بها notes متراكمة من خلل سابق
// كانت تُنتج JSON ضخماً يتجاوز حد عمود audit_log فيرفضه PostgREST بـ 400
const AUDIT_VALUE_MAX = 8000;
function _safeAuditJSON(val) {
  if (!val) return null;
  let s;
  try { s = JSON.stringify(val); } catch(e) { return null; }
  return s.length > AUDIT_VALUE_MAX ? s.slice(0, AUDIT_VALUE_MAX) + '…[truncated]' : s;
}

async function logAudit(action, tableName, fileNo, oldVal, newVal, notes='') {
  try {
    await apiPost('audit_log', {
      system_type: state.system,
      action,
      table_name: tableName,
      file_no: fileNo,
      old_value: _safeAuditJSON(oldVal),
      new_value: _safeAuditJSON(newVal),
      notes,
      user_email: state.user?.email || 'unknown'
    });
  } catch(e) { console.error(`[audit] فشل تسجيل ${action} على ${tableName}:`, e.message); }
}

// ════════════════════════════════════════
// AUTH
// ════════════════════════════════════════
async function login() {
  const email    = document.getElementById('loginEmail').value.trim();
  const pass     = document.getElementById('loginPass').value;
  const btn      = document.getElementById('loginBtn');
  const err      = document.getElementById('loginErr');
  const remember = document.getElementById('rememberMe').checked;

  if (!email || !pass) {
    err.textContent = 'يرجى إدخال البيانات كاملة';
    err.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'جاري الدخول...';
  err.style.display = 'none';

  try {
    const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass })
    });
    const data = await res.json();

    if (data.access_token) {
      state.token        = data.access_token;
      state.refreshToken = data.refresh_token;
      state.user         = data.user;

      localStorage.setItem('tm_token',   data.access_token);
      localStorage.setItem('tm_refresh', data.refresh_token || '');
      localStorage.setItem('tm_user',    JSON.stringify(data.user));

      // ── تذكرني: نحفظ الـ email فقط — لا كلمة المرور أبداً ──
      if (remember) {
        localStorage.setItem('tm_saved_email', email);
        localStorage.setItem('tm_remember', '1');
        // tm_saved_pass حُذف بالكامل — btoa/atob غير آمن
      } else {
        localStorage.removeItem('tm_saved_email');
        localStorage.removeItem('tm_remember');
      }
      // مسح أي كلمة مرور قديمة محفوظة من النسخ السابقة
      localStorage.removeItem('tm_saved_pass');

      initApp();
    } else {
      err.textContent = '⚠️ ' + (data.error_description || data.msg || 'بيانات الدخول غير صحيحة');
      err.style.display = 'block';
    }
  } catch(e) {
    err.textContent = '⚠️ خطأ في الاتصال: ' + e.message;
    err.style.display = 'block';
  }

  btn.disabled = false;
  btn.textContent = 'دخول';
}

function logout() {
  localStorage.removeItem('tm_token');
  localStorage.removeItem('tm_refresh');
  localStorage.removeItem('tm_user');
  state.token        = null;
  state.refreshToken = null;
  state.user         = null;
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appScreen').style.display   = 'none';
  document.getElementById('loginPass').value = '';
}
