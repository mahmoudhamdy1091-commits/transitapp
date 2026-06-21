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
  allJEs: [],
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
  const [deals, vehicles, sales, expenses, collections, payments, jes] = await Promise.all([
    apiGetAll('purchase_orders', { select:'*', system_type:`eq.${sys}`, order:'created_at.desc' }),
    apiGetAll('vehicles',        { select:'*', system_type:`eq.${sys}` }),
    apiGetAll('sales',           { select:'*', system_type:`eq.${sys}` }),
    apiGetAll('expenses',        { select:'*', system_type:`eq.${sys}` }),
    apiGetAll('collections',     { select:'*', system_type:`eq.${sys}` }),
    apiGetAll('payments',        { select:'*', system_type:`eq.${sys}` }),
    apiGetAll('journal_entries', { select:'file_no,account_code,dr_amount,cr_amount', system_type:`eq.${sys}`, post_status:'eq.posted' }),
  ]);
  state.allDeals       = deals       || [];
  state.allVehicles    = vehicles    || [];
  state.allSales       = sales       || [];
  state.allExpenses    = expenses    || [];
  state.allCollections = collections || [];
  state.allPayments    = payments    || [];
  state.allJEs         = jes         || [];
  state._cacheSystem   = sys;
  state._cacheTime     = Date.now();

  const vehicleMap = {}, salesMap = {}, expMap = {}, jeMap = {};
  state.allVehicles.forEach(v => { vehicleMap[v.file_no]=vehicleMap[v.file_no]||[]; vehicleMap[v.file_no].push(v); });
  state.allSales.forEach(s   => { salesMap[s.file_no]=salesMap[s.file_no]||[];      salesMap[s.file_no].push(s); });
  state.allExpenses.forEach(e=> { expMap[e.file_no]=expMap[e.file_no]||[];          expMap[e.file_no].push(e); });
  state.allJEs.forEach(r => {
    if (!r.file_no) return;
    jeMap[r.file_no] = jeMap[r.file_no] || { sales:0, cogs:0, exp:0 };
    const acc = r.account_code || '';
    if (acc.startsWith('4') && (+r.cr_amount||0) > 0) jeMap[r.file_no].sales += +r.cr_amount;
    if (acc.startsWith('5') && (+r.dr_amount||0) > 0) jeMap[r.file_no].cogs  += +r.dr_amount;
    if (acc.startsWith('6') && (+r.dr_amount||0) > 0) jeMap[r.file_no].exp   += +r.dr_amount;
  });

  state.allDealsEnriched = state.allDeals.map(d => {
    const fn = d.file_no;
    const vList = vehicleMap[fn]||[], sList = salesMap[fn]||[], eList = expMap[fn]||[];
    const postedSales = sList.filter(isPosted);
    const postedExp   = eList.filter(isPosted);
    const soldCount   = postedSales.length;
    const totalCost   = +d.total_purchase || vList.reduce((s,v)=>s+(+v.purchase_price||0),0);
    const totalExp    = postedExp.reduce((s,e)=>s+(+e.amount||0),0);
    const totalSale   = postedSales.reduce((s,s2)=>s+(+s2.sale_price||0),0);
    const soldVins    = new Set(postedSales.map(s=>s.vin).filter(Boolean));
    const fullCost    = totalCost + totalExp;
    const je          = jeMap[fn];
    const jeProfit    = je ? (je.sales - je.cogs - je.exp) : null;
    const jeTotalSale = je ? je.sales : null;  // يشمل sale_charges (CR 4xxx من القيود)
    return { ...d,
      _vTotal:vList.length, _vSold:soldCount, _vLeft:Math.max(0,vList.length-soldCount),
      _totalCost:totalCost, _totalExp:totalExp, _fullCost:fullCost,
      _totalSale: jeTotalSale !== null ? jeTotalSale : totalSale,
      _profit: jeProfit !== null ? jeProfit : (totalSale - fullCost),
      _remaining:fullCost-totalSale,
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

// passesPostFilter: فلتر عرض موحّد للتقارير — يطابق خيارات #r-post-filter
//   'posted' (افتراضي) → مرحّل فقط (isPosted)
//   'draft'            → معلّق فقط (draft)
//   غير ذلك ('all')    → الكل ما عدا المرفوض/الملغى (cancelled/voided)
function passesPostFilter(row, filter) {
  if (filter === 'draft')  return isDraft(row);
  if (filter === 'posted' || !filter) return isPosted(row);
  return row.post_status !== 'cancelled' && row.post_status !== 'voided';
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
  const NO_ENCODE = new Set(['select','order','or','and','limit','offset']);
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
  // ✅ إصلاح جذري: لو select محدد بلا "id" نحقنه — حتى تتم إزالة التكرار بالـ id الحقيقي.
  //    بدون id كانت الصفوف المتطابقة محتوىً (مثل دفعتين بنفس المبلغ والحالة) تُدمَج خطأً
  //    عبر JSON.stringify فينقص الإجمالي (كان سبب ظهور "تم دفعه" أقل من الحقيقي).
  let qParams = params, qRest = rest;
  if (params.select && params.select !== '*' && !/(^|,)\s*id\s*(,|$)/.test(params.select)) {
    const sel = 'id,' + params.select;
    qParams = { ...params, select: sel };
    qRest   = { ...rest,   select: sel };
  }
  const [matched, nullRows] = await Promise.all([
    apiGet(table, qParams),
    apiGet(table, { ...qRest, system_type: 'is.null' }),
  ]);
  const seen = new Set();
  const out = [];
  [...(matched||[]), ...(nullRows||[])].forEach(r => {
    // نزيل التكرار بالـ id فقط؛ لو غاب (نظرياً) لا ندمج بالمحتوى لتفادي حذف صفوف صحيحة متطابقة
    const key = (r.id != null) ? ('id:' + r.id) : ('row:' + (seen.size));
    if (!seen.has(key)) { seen.add(key); out.push(r); }
  });
  return out;
}

// ════════════════════════════════════════
// FINANCIALS — مصدر موحّد لحساب أرقام الربح/التكاليف
// مستخدم في: dashboard.js (KPIs) و reports.js (تقرير الأرباح والخسائر)
// الهدف: ضمان تطابق "صافي الربح" وما شابه بين الشاشتين لنفس الفترة
// ════════════════════════════════════════

/** جلب قيود journal_entries المرحّلة لفترة معيّنة (النظام الحالي + system_type=null) مع إزالة التكرار */
async function fetchJEForPeriod(sys, from, to) {
  const toEOD = to + 'T23:59:59';
  const buildUrl = (sysParam) =>
    `${SB_URL}/rest/v1/journal_entries?${sysParam}` +
    `&entry_date=gte.${encodeURIComponent(from)}` +
    `&entry_date=lte.${encodeURIComponent(toEOD)}` +
    `&post_status=eq.posted` +
    `&select=id,account_code,account_name,dr_amount,cr_amount,ref_table,file_no` +
    `&limit=49999`;

  const fetchOne = async (url) => {
    const h = headers({ 'Range': '0-49999', 'Range-Unit': 'items' });
    let res = await fetch(url, { headers: h });
    if (res.status === 401) {
      const ok = await refreshAccessToken();
      if (!ok) throw new Error('انتهت الجلسة');
      res = await fetch(url, { headers: headers({ 'Range': '0-49999', 'Range-Unit': 'items' }) });
    }
    if (!res.ok && res.status !== 206) return [];
    return res.json();
  };

  const [rows1, rows2] = await Promise.all([
    fetchOne(buildUrl(`system_type=eq.${encodeURIComponent(sys)}`)),
    fetchOne(buildUrl('system_type=is.null')),
  ]);

  const seen = new Set();
  const rows = [];
  [...(rows1||[]), ...(rows2||[])].forEach(r => {
    const k = r.id ?? JSON.stringify(r);
    if (!seen.has(k)) { seen.add(k); rows.push(r); }
  });
  return rows;
}

/**
 * حساب أرقام الربح/التكاليف من قيود journal_entries — معادلة موحّدة
 * تُستخدم في لوحة التحكم وتقرير الأرباح والخسائر لضمان تطابق الأرقام بينهما
 */
function computeFinancials(jeRows) {
  let totSales = 0, totCOGS = 0, totDealExp = 0, totOpex = 0, totPurchase = 0;
  const byFile = {};
  const ensure = fn => {
    if (!byFile[fn]) byFile[fn] = { sales:0, cogs:0, dealExp:0, purchase:0 };
  };

  (jeRows || []).forEach(r => {
    const acc = r.account_code || '';
    const dr  = +r.dr_amount  || 0;
    const cr  = +r.cr_amount  || 0;
    const ref = r.ref_table   || '';
    const fn  = r.file_no     || null;

    // 4xxx دائن = إيراد مبيعات
    if (acc.startsWith('4') && cr > 0) {
      totSales += cr;
      if (fn) { ensure(fn); byFile[fn].sales += cr; }
    }
    // 5xxx مدين (عدا التشغيلية) = تكلفة مخزون مباع + مصاريف شحن/نقل
    if (acc.startsWith('5') && dr > 0 && ref !== 'operating_expenses') {
      totCOGS += dr;
      if (fn) { ensure(fn); byFile[fn].cogs += dr; }
    }
    // 1300 مدين = تكلفة شراء المخزون (للصفقة)
    if (acc === '1300' && dr > 0 && ref === 'purchase_orders') {
      totPurchase += dr;
      if (fn) { ensure(fn); byFile[fn].purchase += dr; }
    }
    // 6xxx مدين + ref=expenses = مصاريف صفقة
    if (acc.startsWith('6') && dr > 0 && ref === 'expenses') {
      totDealExp += dr;
      if (fn) { ensure(fn); byFile[fn].dealExp += dr; }
    }
    // 6xxx مدين + ref=operating_expenses = مصاريف تشغيلية
    if (acc.startsWith('6') && dr > 0 && ref === 'operating_expenses') {
      totOpex += dr;
    }
  });

  // مجمل ربح الصفقات = إيراد - COGS - مصاريف صفقات
  const grossProfit = totSales - totCOGS - totDealExp;
  // صافي الربح = مجمل الربح - المصاريف التشغيلية
  const netProfit = grossProfit - totOpex;

  return { totSales, totCOGS, totDealExp, totOpex, totPurchase, grossProfit, netProfit, byFile };
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
  if (!res.ok) {
    const msg = resBody.message || resBody.error || res.statusText || '';
    if (/duplicate key value violates unique constraint "uniq_(expense|payment)_active"/.test(msg)) {
      throw new Error('⚠️ يوجد بالفعل بند بنفس المبلغ والوصف/الدافع والتاريخ لهذا الملف — تأكد إن هذا ليس تكراراً قبل المتابعة');
    }
    throw new Error(msg);
  }
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
// AUDIT TRAIL — جلب تتبّع سجل واحد (المرحلة ب)
// audit_log لا يحوي عمود record_id؛ نربط بالجدول + الملف + مطابقة
// ref_no/id داخل old_value/new_value/notes. الأنسب: تمرير ref_no.
// ════════════════════════════════════════
const AUDIT_ACTION_LABELS = {
  INSERT:'أُنشئ', EDIT:'عُدّل', EDIT_REQUEST:'طلب تعديل', EDIT_APPROVED:'اعتُمد التعديل',
  EDIT_REJECTED:'رُفض التعديل', APPROVE:'وُوفق عليه', REJECT:'رُفض', VOID:'أُلغي',
  VOID_REQUEST:'طلب إلغاء', VOID_REJECTED:'رُفض الإلغاء', DELETE:'حُذف', PAY:'سُجّل دفعه',
  DELETE_DRAFT_LEFTOVER:'حُذفت مسودة', MIGRATION:'ترحيل', IMPORT:'استيراد', UPDATE:'تحديث',
};
const AUDIT_ACTION_ICONS = {
  INSERT:'➕', EDIT:'✏️', EDIT_REQUEST:'📝', EDIT_APPROVED:'✅', EDIT_REJECTED:'🚫',
  APPROVE:'✅', REJECT:'🚫', VOID:'🔄', VOID_REQUEST:'⏳', VOID_REJECTED:'↩️',
  DELETE:'🗑', PAY:'💰', DELETE_DRAFT_LEFTOVER:'🗑', MIGRATION:'📦', IMPORT:'📥', UPDATE:'🔁',
};

/**
 * يجلب الخط الزمني (audit trail) لسجل محدّد، مرتّباً زمنياً.
 * @param {object} opts { table, fileNo, refNo, id } — table إلزامي؛ refNo هو الأدق للربط.
 * @returns {Promise<Array<{action,label,icon,email,user,date,notes}>>}
 */
async function getRecordAuditTrail({ table, fileNo, refNo, id } = {}) {
  if (!table) return [];
  const sys = state.system;
  const params = {
    select: 'action,table_name,file_no,old_value,new_value,notes,user_email,created_at',
    system_type: `eq.${sys}`,
    table_name: `eq.${table}`,
    order: 'created_at.asc',
    limit: 300,
  };
  if (fileNo) params.file_no = `eq.${fileNo}`;
  let rows = [];
  try { rows = (await apiGetAll('audit_log', params)) || []; }
  catch(e) { console.warn('getRecordAuditTrail:', e.message); return []; }

  // فلترة دقيقة بالسجل: مطابقة ref_no/id داخل القيم أو الملاحظات
  const keys = [refNo, id].filter(v => v != null && v !== '').map(String);
  const belongs = (r) => {
    if (!keys.length) return true; // بلا مفتاح → كل سجلات الجدول/الملف
    const hay = `${r.old_value || ''}\n${r.new_value || ''}\n${r.notes || ''}`;
    return keys.some(k => hay.includes(k));
  };

  return rows.filter(belongs).map(r => ({
    action: r.action,
    label:  AUDIT_ACTION_LABELS[r.action] || r.action,
    icon:   AUDIT_ACTION_ICONS[r.action]  || '•',
    email:  r.user_email || 'unknown',
    user:   (r.user_email || 'unknown').split('@')[0],
    date:   r.created_at,
    notes:  r.notes || '',
  }));
}

/**
 * خريطة "من أنشأ" لكل سجل (من قيود INSERT في audit_log) — لعمود "بواسطة".
 * المفتاح = ref_no / pay_id / inv_no الموجود داخل new_value.
 * @returns {Promise<Object<string,string>>} { key: user_email }
 */
async function getCreatorsMap(table, fileNo) {
  const map = {};
  if (!table) return map;
  try {
    const params = { select:'new_value,user_email', system_type:`eq.${state.system}`, table_name:`eq.${table}`, action:'eq.INSERT', limit:2000 };
    if (fileNo) params.file_no = `eq.${fileNo}`;
    const rows = (await apiGetAll('audit_log', params)) || [];
    rows.forEach(r => {
      if (!r.user_email) return;
      let v = null; try { v = JSON.parse(r.new_value); } catch(_) {}
      const key = v && (v.ref_no || v.pay_id || v.inv_no);
      if (key && !map[key]) map[key] = r.user_email;
    });
  } catch(e) { console.warn('getCreatorsMap:', e.message); }
  return map;
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
