// ╔══════════════════════════════════════════════════════════╗
// ║  core.js — Config · State · Cache · API · Auth          ║
// ║  Transit Management System                               ║
// ╚══════════════════════════════════════════════════════════╝
//
// ⚠️  ميزة "تذكرني": تحفظ الإيميل وكلمة المرور (مرمّزة base64 — ليست
//     تشفيرًا) بناءً على طلب صريح من المستخدم بعد التحذير من المخاطرة
//     الأمنية (2026-07-15) — راجع login() أدناه.

// ════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════
export const SB_URL  = 'https://tepaonhqszocyjsdcyoz.supabase.co';
export const SB_KEY  = 'sb_publishable_l24VhFauUbUD7GfAyEnyhQ_9F_PKHH3';

// ════════════════════════════════════════
// STATE
// ════════════════════════════════════════
export const state = {
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
export function cacheStale() {
  return state._cacheSystem !== state.system || (Date.now() - state._cacheTime) > 60000;
}

let _cacheLoadingPromise = null;

export async function ensureCache() {
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

export async function _doLoadCache() {
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
    const dr = +r.dr_amount||0, cr = +r.cr_amount||0;
    // ✅ خصم الجانب العكسي بدل جمع جانب واحد فقط — وإلا يبقى قيد إلغاء/عكس
    // (يدين 4xxx أو يُقيِّد 5xxx/6xxx) بلا أثر على هذا الإجمالي، فيظل المبلغ الأصلي محسوباً كاملاً
    if (acc.startsWith('4')) jeMap[r.file_no].sales += (cr - dr);
    if (acc.startsWith('5')) jeMap[r.file_no].cogs  += (dr - cr);
    if (acc.startsWith('6')) jeMap[r.file_no].exp   += (dr - cr);
  });

  state.allDealsEnriched = state.allDeals.map(d => {
    const fn = d.file_no;
    const vList = vehicleMap[fn]||[], sList = salesMap[fn]||[], eList = expMap[fn]||[];
    const postedSales = sList.filter(isActive);
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

export function invalidateCache() {
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
export function isPosted(row) {
  return !row.post_status || row.post_status === 'posted';
}

// isDraft: في انتظار الموافقة
export function isDraft(row) {
  return row.post_status === 'draft';
}

// isActive: تُحسب في الأرقام (posted + pending_edit)
// pending_edit = عملية معتمدة قيمتها تحت المراجعة → تُحسب
export function isActive(row) {
  return isPosted(row) || row.post_status === 'pending_edit';
}

// isEffective: تُحسب في الأرقام وليست ملغاة
// الأكثر استخداماً في الإجماليات والتقارير
export function isEffective(row) {
  return isActive(row) && row.post_status !== 'voided';
}

// isVisible: تظهر في الجداول (كل شيء إلا voided)
// للعرض فقط — لا للحساب
export function isVisible(row) {
  return row.post_status !== 'voided';
}

// isOccupying: تشغل الشاصي/الفتحة فعليًا (كل شيء إلا cancelled/voided) — يُستخدم
// لحساب "هل هذا الشاصي مباع/محجوز حاليًا" في كل شاشات توفّر السيارات (بيع جديد،
// نقل مخزن، تبويب السيارات، الطباعة، تحديث حالة الصفقة). draft/pending_edit/
// pending_void لسه تحجز السيارة (منع بيع مزدوج لبيع تحت المراجعة)، لكن cancelled
// (مرفوضة) و voided (ملغاة) الاتنين يُفرِجان عن السيارة.
// ✅ اكتُشف حيًّا 2026-07-28: كل هذه الشاشات كانت تستخدم isVisible خطأً (توثيقها
// الصريح "للعرض فقط — لا للحساب") فسيارة بيعها اتُرفض (cancelled) كانت تفضل
// "مباعة" للأبد — لا تظهر متاحة للبيع رغم رفض الفاتورة فعليًا.
export function isOccupying(row) {
  return row.post_status !== 'cancelled' && row.post_status !== 'voided';
}

// isPending: طلب معلق (تعديل أو إلغاء)
export function isPending(row) {
  return row.post_status === 'pending_edit' || row.post_status === 'pending_void';
}

// passesPostFilter: فلتر عرض موحّد للتقارير — يطابق خيارات #r-post-filter
//   'posted' (افتراضي) → مرحّل فقط (isPosted)
//   'draft'            → معلّق فقط (draft)
//   غير ذلك ('all')    → الكل ما عدا المرفوض/الملغى (cancelled/voided)
export function passesPostFilter(row, filter) {
  if (filter === 'draft')  return isDraft(row);
  if (filter === 'posted' || !filter) return isPosted(row);
  return row.post_status !== 'cancelled' && row.post_status !== 'voided';
}

// ════════════════════════════════════════
// TOKEN REFRESH
// ════════════════════════════════════════
// ✅ قفل تزامن (mutex): Supabase الـrefresh token دوّار — استخدامه مرتين
// بالتوازي (401 من apiFetch + استدعاء initApp في نفس اللحظة مثلاً) يخلي
// أول طلب ينجح ويستهلك التوكن، والتاني يوصل ومعاه توكن اتلغى بالفعل
// فيفشل ويسجّل خروج — رغم إن الجلسة فعلياً كانت سليمة. الحل: أي استدعاء
// وهو طلب شغّال بالفعل ينتظر نفس النتيجة بدل ما يبعت طلب تجديد تاني.
let _refreshInFlight = null;
export async function refreshAccessToken() {
  if (_refreshInFlight) return _refreshInFlight;
  _refreshInFlight = (async () => {
    const rt = state.refreshToken || localStorage.getItem('tm_refresh');
    if (!rt) { logout(); return false; }

    // ✅ فشل شبكة عابر (نت بطيء/منقطع لحظة تحميل الصفحة) لازم يُعامَل مختلف
    // عن رفض صريح من Supabase — كان أي استثناء هنا (حتى لو مجرد فشل fetch
    // مؤقت) يسجّل خروج فوري ويمسح الجلسة، رغم إنها سليمة وكانت هتنجح لو
    // تكرر المحاولة لاحقاً. دلوقتي: نفشل بصمت ونسيب الجلسة زي ما هي لحد ما
    // يوصل رد فعلي من السيرفر يرفض التوكن صراحة.
    let res;
    try {
      res = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'apikey': SB_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt })
      });
    } catch(e) {
      console.error('refreshAccessToken: فشل شبكة عابر — الجلسة لم تُمسح:', e.message);
      return false;
    }

    let data = {};
    try { data = await res.json(); } catch(e) {}

    if (data.access_token) {
      state.token        = data.access_token;
      state.refreshToken = data.refresh_token || rt;
      localStorage.setItem('tm_token',   data.access_token);
      localStorage.setItem('tm_refresh', data.refresh_token || rt);
      return true;
    }

    // السيرفر رد فعليًا لكن رفض الـrefresh token (منتهي/ملغى) — هنا بس
    // يصح تسجيل الخروج، مش على أي استثناء أو فشل استجابة غامض
    if (res.status === 400 || res.status === 401) {
      logout();
    } else {
      console.warn('refreshAccessToken: رد غير متوقع من السيرفر، الجلسة لم تُمسح:', res.status);
    }
    return false;
  })();
  try {
    return await _refreshInFlight;
  } finally {
    _refreshInFlight = null;
  }
}

// ✅ فحص صلاحية access token (JWT) محليًا بدون طلب شبكة — يقرأ claim الـexp.
// يُستخدم لتجنّب تجديد التوكن كل مرة يُفتح فيها التطبيق (كان بيستهلك
// refresh token دوّار من غير داعي ويكبّر فرصة تعارض التزامن أعلاه).
export function isTokenValid(token, bufferMs = 5 * 60 * 1000) {
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
    if (!payload.exp) return false;
    return Date.now() < (payload.exp * 1000 - bufferMs);
  } catch(e) { return false; }
}

// ════════════════════════════════════════
// API HELPERS
// ════════════════════════════════════════
// ✅ Accept-Profile/Content-Profile صريحين على كل طلب — تحصين دائم مش مرتبط
// بـfleet بالذات: PostgREST بيحدد الـschema الافتراضي لأي طلب من غير هيدر
// صراحة بناءً على ترتيب داخلي في "Exposed schemas" مش مضمون ولا ظاهر في
// الواجهة، وده سبب فعليًا outage حي كامل يوم 2026-08-18 (كل شاشات BOX/TM
// طلعت "الجدول مش موجود" لأن الطلبات بلا هيدر راحت لـgraphql_public بدل
// public لحظة إضافة fleet لقائمة الـExposed schemas). صحّة كل طلب هنا بقت
// معتمدة على هيدر صريح، مش على افتراض PostgREST الضمني — بغض النظر عن عدد
// الـschemas المُفعَّلة مستقبلًا.
export function headers(extra = {}) {
  const h = {
    'apikey': SB_KEY,
    'Content-Type': 'application/json',
    'Accept-Profile': 'public',
    'Content-Profile': 'public',
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

// ════════════════════════════════════════
// API FETCH — نقطة مركزية واحدة لمعالجة 401 (انتهاء الجلسة)
// كل طلب لـ Supabase REST يمر من هنا: لو 401 يعمل refresh ويعيد المحاولة
// مرة واحدة بهيدرز محدَّثة (تُبنى من جديد داخلياً — لا تُمرَّر جاهزة من
// الخارج — كي لا يُعاد إرسال التوكن القديم المنتهي في محاولة إعادة الإرسال).
// ════════════════════════════════════════
// ✅ تصنيف مركزي لأخطاء الشبكة — "Failed to fetch"/"NetworkError" بيحصل لما
// المتصفح يفشل حتى في إتمام الطلب (انقطاع، مهلة، إلخ) — ده مختلف جوهريًا عن
// رد الخادم بخطأ (يعني الخادم استلم ونفّذ، ورد برفض واضح). في حالة انقطاع
// الشبكة، مش قادرين نعرف هل الطلب وصل للخادم فعلاً واتنفّذ ولا لأ — أي رسالة
// "فشلت العملية" هنا مضلِّلة، ممكن تكون نجحت فعلاً. راجع project_ui_restructure
// في الذاكرة — نفس الأعراض المُبلَّغة (Failed to fetch بعد نجاح فعلي)
function _isNetworkLevelError(e) {
  return e instanceof TypeError && /fetch|network/i.test(e.message || '');
}
const NETWORK_UNCERTAIN_MSG = '⚠️ انقطع الاتصال بالخادم أثناء العملية — قد تكون نجحت فعلاً رغم ظهور هذا الخطأ. تأكد من القائمة قبل إعادة المحاولة، حتى لا يتكرر البند';

export async function apiFetch(url, { headers: extraHeaders = {}, ...rest } = {}) {
  let res;
  try {
    res = await fetch(url, { ...rest, headers: headers(extraHeaders) });
  } catch (e) {
    if (_isNetworkLevelError(e)) throw new Error(NETWORK_UNCERTAIN_MSG);
    throw e;
  }
  if (res.status === 401) {
    const ok = await refreshAccessToken();
    if (!ok) throw new Error('انتهت الجلسة، يرجى تسجيل الدخول مجدداً');
    try {
      res = await fetch(url, { ...rest, headers: headers(extraHeaders) });
    } catch (e) {
      if (_isNetworkLevelError(e)) throw new Error(NETWORK_UNCERTAIN_MSG);
      throw e;
    }
  }
  return res;
}

// ✅ Supabase/PostgREST بيفرض حد صارم من السيرفر نفسه = 1000 صف لكل طلب، بغض
// النظر عن أي Range أكبر بيبعته الكلاينت (كنا بنبعت 0-49999 وبيترجاهل تمامًا —
// مُثبَت مباشرة ضد القاعدة الحية 2026-08-23: 3 طلبات Range مختلفة، النتيجة
// اتقطعت عند 1000 في كل مرة إلا لو الـRange نفسه كان صفحة 1000 مضبوطة). الحد
// القديم (206 + console.warn) كان مفعّل بس نظريًا: Supabase بترجع 200 عادي
// (مش 206) طالما الطلب مش حامل Prefer:count=exact، وheaders() هنا ما كانتش
// بتبعته على GET — يعني التحذير نفسه معطّل بصمت في الإنتاج الفعلي. الحل
// الوحيد الشغّال: صفحات حقيقية (loop على Range) لحد ما صفحة ترجع أقل من
// PAGE_SIZE، بسقف MAX_PAGES يمنع أي loop مفتوح لو حصل سلوك غريب من السيرفر.
const _API_PAGE_SIZE = 1000;
const _API_MAX_PAGES = 50; // سقف 50,000 صف — يطابق نية الحد القديم (49999)

export async function apiGet(table, params = {}) {
  const NO_ENCODE = new Set(['select','order','or','and','limit','offset']);
  // ✅ منع الكاش المتصفح/HTTP لطلبات GET — كان يسبب عرض بيانات قديمة
  // مباشرة بعد عمليات التعديل (مثال: طلب إلغاء يبقى ظاهراً في قائمة الانتظار رغم تنفيذه)

  const hasLimit  = 'limit'  in params;
  const explicitLimit  = hasLimit ? parseInt(params.limit, 10) : null;

  // ✅ حالة سريعة وآمنة: limit صريح ≤ حجم الصفحة (1000) — طلب واحد كافٍ، حد
  // السيرفر مش هيقطع لأن المطلوب أصلاً أصغر من/يساوي حده، فمفيش داعي لأي حلقة.
  if (hasLimit && explicitLimit <= _API_PAGE_SIZE) {
    const qs = Object.entries(params).map(([k,v]) => NO_ENCODE.has(k) ? `${k}=${v}` : `${k}=${encodeURIComponent(v)}`).join('&');
    const url = `${SB_URL}/rest/v1/${table}${qs ? '?' + qs : ''}`;
    const res = await apiFetch(url, { cache: 'no-store' });
    if (!res.ok && res.status !== 206) {
      const e = await res.json().catch(()=>({}));
      throw new Error(e.message || res.statusText);
    }
    return res.json();
  }

  // ✅ باقي الحالات: مفيش limit خالص (يعني "هات كل حاجة")، أو limit > حجم
  // الصفحة (يعني لسه محتاج صفحات حقيقية لحد ما نوصل له). الاتنين لازم
  // pagination فعلي بالـRange — بلا limit/offset في الـquery string نفسه،
  // لأن سيبهم في الطلب مع Range على صفحة غير الأولى بيسبب تعارض حقيقي مُثبَت
  // (HTTP 416 PGRST103). لو مفيش limit، بيكرر لحد ما البيانات تخلص أو سقف
  // الصفحات. لو فيه limit > 1000، بيوقف بالظبط لما يجمع العدد المطلوب —
  // مش يتخطى الصفحات زي ما كان بيحصل غلط قبل كده (اكتُشف حيًّا: getCreatorsMap
  // بـlimit:2000 كان برجّع 1000 بصمت status 200 بلا أي تحذير).
  const restParams = { ...params };
  delete restParams.limit;
  delete restParams.offset;
  const qs = Object.entries(restParams).map(([k,v]) => NO_ENCODE.has(k) ? `${k}=${v}` : `${k}=${encodeURIComponent(v)}`).join('&');
  const url = `${SB_URL}/rest/v1/${table}${qs ? '?' + qs : ''}`;

  let out = [];
  let offset = 'offset' in params ? parseInt(params.offset, 10) : 0;
  for (let page = 0; page < _API_MAX_PAGES; page++) {
    const remaining = explicitLimit != null ? (explicitLimit - out.length) : _API_PAGE_SIZE;
    if (remaining <= 0) break;
    const pageSize = Math.min(_API_PAGE_SIZE, remaining);
    const res = await apiFetch(url, {
      headers: { 'Range': `${offset}-${offset + pageSize - 1}`, 'Range-Unit': 'items' },
      cache: 'no-store',
    });
    if (!res.ok && res.status !== 206) {
      const e = await res.json().catch(()=>({}));
      throw new Error(e.message || res.statusText);
    }
    const body = await res.json();
    out = out.concat(body);
    if (body.length < pageSize) break; // آخر صفحة فعليًا (وصلنا لآخر البيانات)
    offset += pageSize;
    if (page === _API_MAX_PAGES - 1) {
      console.warn(
        `[Transit] ⚠️ apiGet("${table}"): وصلنا لسقف ${_API_MAX_PAGES} صفحة (${_API_MAX_PAGES * _API_PAGE_SIZE} صف) — ` +
        `البيانات ممكن تكون ناقصة لو الجدول أكبر من كده فعليًا لهذا الاستعلام.`
      );
    }
  }
  return out;
}

export async function apiGetAll(table, params = {}) {
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

// ✅ بناء قيمة فلتر PostgREST "in.(...)" بأمان لقيم نصية حرة (أرقام ملفات
// تحتوي مسافات/أقواس/فواصل — مثال حي: "BOX-138 - ( LOT 1 OLD 2024 )").
// بلا اقتباس، القوس الداخلي يكسر تحليل PostgREST للقائمة بصمت (يرجع صفوفًا
// فاضية بلا أي خطأ HTTP ظاهر) بمجرد أكتر من قيمة واحدة في القائمة — اكتُشف
// حيًّا 2026-09-21 أثناء التحقق من computePartnerSettlementBatch: ملف واحد
// كان يعمل صح والدُفعة (٣ ملفات معًا) ترجع صفرًا للكل. راجع PostgREST docs:
// قيمة تحتوي حروفًا خاصة تُكتب بين علامتَي اقتباس مزدوجتين، وأي " داخلها تُهرَّب بـ\".
export function pgIn(values) {
  return `in.(${(values||[]).map(v => `"${String(v).replace(/"/g, '\\"')}"`).join(',')})`;
}

// ════════════════════════════════════════
// FINANCIALS — مصدر موحّد لحساب أرقام الربح/التكاليف
// مستخدم في: dashboard.js (KPIs) و reports.js (تقرير الأرباح والخسائر)
// الهدف: ضمان تطابق "صافي الربح" وما شابه بين الشاشتين لنفس الفترة
// ════════════════════════════════════════

// ✅ استُخرجت من fetchJEForPeriod (كانت fetchOne محلية) عشان تتشارك مع أي
// استهلاك تاني بيبني رابط journal_entries يدويًا ومحتاج صفحات حقيقية بدل
// طلب واحد بـRange كبير (نفس سبب _API_PAGE_SIZE/_API_MAX_PAGES فوق: Supabase
// بتقطع عند 1000 صف بغض النظر عن الـRange المطلوب). بلا &limit في الرابط
// نفسه لنفس سبب apiGet — يتعارض مع صفحات الـRange المتتالية.
export async function fetchAllPages(url, label = '') {
  let out = [];
  let offset = 0;
  for (let page = 0; page < _API_MAX_PAGES; page++) {
    const res = await apiFetch(url, {
      headers: { 'Range': `${offset}-${offset + _API_PAGE_SIZE - 1}`, 'Range-Unit': 'items' },
    });
    if (!res.ok && res.status !== 206) return out; // نفس السلوك القديم: تجاهل الخطأ، رجّع اللي اتجمّع لحد كده
    const body = await res.json();
    out = out.concat(body);
    if (body.length < _API_PAGE_SIZE) break;
    offset += _API_PAGE_SIZE;
    if (page === _API_MAX_PAGES - 1) {
      console.warn(`[Transit] ⚠️ fetchAllPages${label ? '(' + label + ')' : ''}: وصلنا لسقف ${_API_MAX_PAGES} صفحة — البيانات ممكن تكون ناقصة.`);
    }
  }
  return out;
}

/** جلب قيود journal_entries المرحّلة لفترة معيّنة (النظام الحالي + system_type=null) مع إزالة التكرار */
export async function fetchJEForPeriod(sys, from, to) {
  const toEOD = to + 'T23:59:59';
  const buildUrl = (sysParam) =>
    `${SB_URL}/rest/v1/journal_entries?${sysParam}` +
    `&entry_date=gte.${encodeURIComponent(from)}` +
    `&entry_date=lte.${encodeURIComponent(toEOD)}` +
    `&post_status=eq.posted` +
    `&select=id,entry_no,ref_id,account_code,account_name,dr_amount,cr_amount,ref_table,file_no,reverses`;

  const [rows1, rows2] = await Promise.all([
    fetchAllPages(buildUrl(`system_type=eq.${encodeURIComponent(sys)}`), 'fetchJEForPeriod'),
    fetchAllPages(buildUrl('system_type=is.null'), 'fetchJEForPeriod'),
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
 *
 * ⚠️ نسخة موازية من نفس معادلة byFile[fn] (مبيعات−COGS−مصاريف الصفقة) موجودة
 * أيضًا داخل sql/m6_profit_postings_phase1.sql (post_profit_for_file، قسم ٢)
 * — مقصودة (السيرفر مصدر الحقيقة لترحيل الأرباح، لا يثق برقم من المتصفح)، لا
 * تكرار سهو. أي تعديل هنا يمس معادلة الربح لازم يُنعكس هناك بالمثل، وإلا
 * postFileProfit (تحته، غلاف postFileProfit في نفس الملف) هيكتشف الانحراف
 * ويُظهر تحذيرًا فور أي ترحيل فعلي — لكن الأفضل مطابقتهما يدويًا وقت التعديل.
 */
export function computeFinancials(jeRows) {
  let totSales = 0, totCOGS = 0, totDealExp = 0, totOpex = 0, totPurchase = 0, totExpenseAmount = 0;
  // ✅ totCorrections (Tier 0 بند 6): تتبّع موازٍ لقد إيه من totSales/totCOGS فوق
  // أصله قيد ref_table='correction' — تصحيح انحراف تراكمي قديم (لا "أصل" بعينه
  // يقابله في نفس الفترة، بعكس reversal العادي) لا يغيّر أي رقم محسوب، بس
  // بيسمح لأي مستهلك لهذه الدالة (التقارير) يعرض شفافية عن حجم التصحيحات
  // المُتضمّنة في رقم الفترة، بدل ما تظهر كأرقام "طبيعية" بلا تفسير
  let totCorrections = 0;
  const byFile = {};
  const ensure = fn => {
    if (!byFile[fn]) byFile[fn] = { sales:0, cogs:0, dealExp:0, purchase:0, expenseAmount:0, corrections:0 };
  };

  // ✅ أي entry_no فيه سطر على حساب 2100 (ذمم الموردين) — الحساب الوحيد
  // المُستخدَم حصريًا مع الشراء وعكسه (تعديل/إلغاء)، بعكس 1300 اللي بيُستخدم
  // كمان في البيع/التصحيح. اكتُشف حيًّا 2026-07-29 (BOX-141): تعديل سند شراء
  // بعد الترحيل بيعكس القيد الأصلي بـref_table='reversal' (مش 'purchase_orders')
  // — فالشرط القديم (ref==='purchase_orders' فقط، بلا طرح cr) كان يتجاهل قيد
  // العكس تمامًا ويجمع الشراء القديم والجديد معًا (تضخيم كامل بقيمة السند).
  // المطابقة عبر entry_no تلتقط القيد الأصلي وعكسه معًا (كل واحد بيحمل سطر
  // 2100 في نفس entry_no بتاعه) بغض النظر عن ref_table، وتستثني تلقائيًا
  // البيع/التصحيح (بيستخدما 1300 لكن من غير أي سطر 2100 في نفس القيد)
  const purchaseEntryNos = new Set();
  (jeRows || []).forEach(r => {
    if (r.account_code === '2100' && r.entry_no) purchaseEntryNos.add(r.entry_no);
  });

  // ✅ نفس مبدأ purchaseEntryNos فوق، لنفس السبب — أي ref_id ظهر ولو مرة بـ
  // ref_table='expenses' يخصّ مصروفًا حقيقيًا؛ يُستخدم تحت لتمييز قيود عكس
  // المصاريف (ref_table='reversal' بنفس ref_id) عن عكس أنواع تانية (دفعات/
  // تحصيلات/صرف شركاء) بتستخدم نفس حسابات الدفع بالضبط (1110/1120/2400)
  // (باج مُكتشَف 2026-08-02 — راجع project_expenseamount_double_count_bug
  // في الذاكرة: مصروف اتعدّل قبل كده كان بيتضاعف في totExpenseAmount لأن
  // الجديد المُصحَّح بيترحّل بنفس ref_table='expenses' القديم، وكانت الصيغة
  // بتجمع الطرف الدائن فقط بلا أي صافي أو استبعاد للقديم المُستبدَل)
  const expenseRefIds = new Set();
  (jeRows || []).forEach(r => {
    if (r.ref_table === 'expenses' && r.ref_id != null) expenseRefIds.add(r.ref_id);
  });
  // ✅ المرحلة ٢ (partner_account_links، 2026-09-16): حسابات الشركاء المخصَّصة
  // (2401-2408 BOX / 2401 TM) كلها 24xx تحت الأب 2400 بقرار تصميم موثَّق
  // (project_partner_current_account_model.md). isPartnerPocketAcc تلتقطها
  // كلها برقم الحساب نفسه — بلا حاجة لجلب partner_account_links هنا (الدالة
  // متزامنة sync وبلا معرفة بـsys، وهذا الرقم توضيحي فقط، لا يدخل الربح).
  const EXPENSE_CREDIT_FIXED = new Set(['1110', '1120']);
  const isPartnerPocketAcc = acc => EXPENSE_CREDIT_FIXED.has(acc) || acc.startsWith('24');

  // ✅ استبعاد قيود عكس أصلها بره نطاق الفترة المطلوبة (اكتُشف حيًّا 2026-08-09،
  // TM-004/BOX-141: -18,764/-7,107 في كارت المشتريات لآخر 30 يوم) — fetchJEForPeriod
  // بتفلتر بالتاريخ فقط، فلو القيد الأصلي (مثلاً شراء مكرر من 2024) بره الفترة
  // لكن عكسه (تصحيح تاريخي حديث) جوّاها، كان بيدخل في المجموع سالبًا بلا أي
  // رقم موجب يقابله من نفس الفترة. reverses بيحمل id القيد الأصلي الحقيقي (نفس
  // الآلية المستخدمة في journal reverses display) — لو مش موجود ضمن jeRows
  // نفسها، يبقى الأصل أكيد بره الفترة، فنستبعد سطر العكس بالكامل من كل الإجماليات
  // (مش بس المشتريات — نفس أثر الحد الفاصل ممكن يحصل في أي حساب).
  // ⚠️ حد معروف: قيود عكس أقدم من 2026-07-27 (قبل إصلاح journal reverses display)
  // ممكن يكون reverses=null فيها حتى لو بتعكس أصل بره الفترة فعليًا — الاستبعاد
  // ده معتمد كليًا على وجود قيمة حقيقية في reverses، فمش هيمسك هذه الحالات القديمة.
  // لا يمسّ ref_table='correction' (totCorrections تحت) — حالة مختلفة تمامًا،
  // مفيش "أصل" قابل للربط أصلاً، والحل الصحيح ليها شريط الإفصاح في قائمة الدخل
  const fetchedIds = new Set((jeRows || []).map(r => r.id));

  (jeRows || []).forEach(r => {
    if (r.ref_table === 'reversal' && r.reverses != null && !fetchedIds.has(r.reverses)) return;
    const acc = r.account_code || '';
    const dr  = +r.dr_amount  || 0;
    const cr  = +r.cr_amount  || 0;
    const ref = r.ref_table   || '';
    const fn  = r.file_no     || null;

    // 4xxx = إيراد مبيعات (cr - dr) لمعالجة قيود العكس بشكل صحيح
    if (acc.startsWith('4')) {
      totSales += (cr - dr);
      if (fn) { ensure(fn); byFile[fn].sales += (cr - dr); }
      if (ref === 'correction') { totCorrections += Math.abs(cr - dr); if (fn) byFile[fn].corrections += Math.abs(cr - dr); }
    }
    // 5xxx (عدا التشغيلية) = تكلفة مخزون مباع — (dr - cr) لمعالجة قيود العكس
    if (acc.startsWith('5') && ref !== 'operating_expenses') {
      totCOGS += (dr - cr);
      if (fn) { ensure(fn); byFile[fn].cogs += (dr - cr); }
      if (ref === 'correction') { totCorrections += Math.abs(dr - cr); if (fn) byFile[fn].corrections += Math.abs(dr - cr); }
    }
    // 1300 = تكلفة شراء المخزون (للصفقة) — صافي (dr-cr) ضمن قيود الشراء
    // (تحديدها فوق عبر وجود سطر 2100 بنفس entry_no)، يشمل عكس التعديل/الإلغاء
    // تلقائيًا مهما كان ref_table لسطر العكس
    if (acc === '1300' && purchaseEntryNos.has(r.entry_no)) {
      totPurchase += (dr - cr);
      if (fn) { ensure(fn); byFile[fn].purchase += (dr - cr); }
    }
    // 6xxx مدين + ref=expenses = مصاريف صفقة (تفضل ~صفر بعد سياسة الترسملة —
    // المصاريف بقت جزء من 1300/5100 مش 6xxx. الحقل متسيّب زي ما هو لعدم
    // كسر معادلة grossProfit؛ استخدم expenseAmount تحت للرقم التوضيحي الحقيقي)
    if (acc.startsWith('6') && dr > 0 && ref === 'expenses') {
      totDealExp += dr;
      if (fn) { ensure(fn); byFile[fn].dealExp += dr; }
    }
    // ✅ إجمالي مبلغ مصاريف الصفقة الحقيقي — صافٍ (cr-dr) على حسابات الدفع فقط
    // (1110/1120/أي حساب شريك 24xx — الطرف الدائن الوحيد الذي يبنيه je_expense
    // دائمًا، فردي أو موزَّع)، لا أي سطر بـref_table='expenses' كما كان. يشمل
    // قيود عكس المصاريف (ref_table='reversal' بنفس ref_id ضمن expenseRefIds)
    // فتُطرح تلقائيًا أي نسخة قديمة استُبدلت — بدل جمع القديم والجديد معًا بالغلط.
    // ثابت بغض النظر عن حساب الترسملة (1300/5100/6xxx للطرف المدين). توضيحي
    // فقط، لا يدخل في حساب الربح (مُحتسب بالفعل ضمن totCOGS عبر calcCOGS عند البيع)
    const isExpenseCreditLine = isPartnerPocketAcc(acc) && (
      ref === 'expenses' || (ref === 'reversal' && r.ref_id != null && expenseRefIds.has(r.ref_id))
    );
    if (isExpenseCreditLine) {
      totExpenseAmount += (cr - dr);
      if (fn) { ensure(fn); byFile[fn].expenseAmount += (cr - dr); }
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

  return { totSales, totCOGS, totDealExp, totOpex, totPurchase, totExpenseAmount, totCorrections, grossProfit, netProfit, byFile };
}

/**
 * تسوية الشركاء الموحّدة لملف واحد — مصدر واحد يحل محل 6 معادلات "مستحق"
 * كانت متفرقة ومتناقضة في dashboard.js/modals.js/accounting.js/print.js/operations.js.
 *
 * كل حركة نقدية لشريك (دفع للمورد، دفع مصروف من جيبه، إمساك تحصيل، استلام
 * صرف) تُقيَّد أصلاً على حساب 2400 بـ contact_name=اسم الشريك (je_payment/
 * je_expense/je_collection/je_payout في engine.js، عبر _isPartnerPocket).
 * فاستعلام واحد على قيود الملف، مُجمَّع حسب contact_name، يعطي كل حركة
 * الشريك بإشارة صحيحة — دون إعادة بناء كل بند من الجداول المصدرية.
 *
 * "الصندوق" (TREASURY_PARTNER) لا يُقيَّد على 2400 بتصميم النظام (مصاريفه
 * تذهب للنقدية مباشرة، فهو الخزينة نفسها لا شريك خارجي) — فمساهمته الفعلية
 * تُحسب بالمتبقي (fullCost − مجموع مساهمات باقي الشركاء)، ما يضمن أن مجموع
 * فروق "العدالة" (fairShareDiff) عبر كل الشركاء = صفر دائمًا (تحقق ذاتي).
 */
export async function computePartnerSettlement(fileNo, sys) {
  const [partnersRaw, jeAll, poRow, confirmations, accountLinks] = await Promise.all([
    apiGetAll('partners_master', { select:'partner,share_percent', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
    apiGetAll('journal_entries', {
      select:'account_code,contact_name,dr_amount,cr_amount,ref_table,ref_id,entry_date,description,entry_no,file_no',
      system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, post_status:`eq.posted`,
      order:'entry_date.asc,id.asc',
    }),
    // ✅ حالة السند — لازمة لـpayableNow تحت (أي فرع يُطبَّق). مجلوبة بالتوازي
    // مع الاتنين فوق فبلا أي زيادة في زمن الاستجابة
    apiGetAll('purchase_orders', { select:'status', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
    // ✅ Phase 2 / المرحلة أ — صفوف "تأكيد استلام" (LEDGER_TYPES, lifecycle.js):
    // بلا قيد محاسبي بالتصميم (الشريك ماسك الفلوس أصلاً)، فمش هتظهر في jeAll
    // فوق إطلاقًا. تُضاف لـwithdrawnViaPayout يدويًا تحت — بلا هذا الاستعلام
    // كان صرف "تأكيد استلام" هيفضل يُحسب كمستحق غير مسدَّد للأبد
    apiGetAll('partner_ledger', {
      select:'partner,amount', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`,
      entry_type:'eq.تأكيد استلام', post_status:`eq.posted`,
    }),
    // ✅ المرحلة ٢ (partner_account_links، 2026-09-16): دليل شريك→حساب مخصَّص.
    // 9 صفوف إجمالاً في كل النظام — جلبها كاملة أرخص من فلترة بالشركاء. لسه
    // صفر صف مكتوب على أي حساب مخصَّص فعليًا (الكتّاب لسه بيكتبوا 2400)، فهذا
    // التغيير regression بحت اليوم: يجب أن يطابق الناتج القديم بالحرف.
    apiGetAll('partner_account_links', { select:'partner_name,account_code', system_type:`eq.${sys}` }),
  ]);
  return _settlePartnerRows(fileNo, partnersRaw, jeAll, poRow, confirmations, accountLinks);
}

/**
 * ✅ استُخرجت من computePartnerSettlement بلا أي تغيير في المنطق (نفس الأسطر
 * بالحرف) — تسمح لدالة دفعية (computePartnerSettlementBatch تحت) تستخدم نفس
 * الحساب بالضبط بعد جلب دفعة ملفات الشريك مرة واحدة بدل استعلام لكل ملف على
 * حدة (كان يسبب ~45 ثانية لكشف حساب شريك بـ95 ملف — راجع
 * docs/PLAN-partner-statement-restructure-2026-09-20.md قسم ٤).
 * لا تُعدَّل هذه الدالة بمعزل عن توثيق computePartnerSettlement أعلاه — أي
 * انحراف هنا ينحرف في الاستخدامين معًا (الفردي والدفعي) في آنٍ واحد.
 */
function _settlePartnerRows(fileNo, partnersRaw, jeAll, poRow, confirmations, accountLinks) {
  // كود الحساب المخصَّص لكل شريك في هذا الملف (لو موجود) — يُستخدم تحت
  // لتوسيع فلتر حساب الشركاء بدل الاقتصار على '2400' وحده
  const linkedCodes = new Set((accountLinks||[]).map(r => r.account_code));
  const isClosed = (poRow?.[0]?.status || '') === 'CLOSED';

  const fin = computeFinancials(jeAll).byFile[fileNo] || { sales:0, cogs:0, dealExp:0, purchase:0, expenseAmount:0 };
  // مجموع الطرف الدائن لأي سطر مصروف — ثابت بغض النظر عن حساب الترسملة
  // (1300/5100/6xxx حسب سياسة الترسملة)، لأنه دائمًا الطرف المقابل للنقدية/2400
  const totalExpenseAmount = fin.expenseAmount;
  const totalPurchase = fin.purchase;
  const fullCost = totalPurchase + totalExpenseAmount;
  const profit   = fin.sales - fin.cogs - fin.dealExp;
  const hasJEData = (jeAll||[]).length > 0;

  // ✅ اتجاه القيد يختلف حسب نوعه: je_payment/je_expense (الشريك بيساهم) يدائنون
  // 2400، وje_collection/je_payout (الشريك بياخد/يمسك فلوس) يدينون 2400 —
  // فلازم نتابع الطرفين حسب ref_table لا الدائن بس، وإلا التحصيلات الممسوكة
  // (دائمًا مدين) تفضل صفر وهميًا رغم وجودها فعليًا في القيود
  // ✅ نفس مبدأ expenseRefIds في computeFinancials، ونفس السبب — أي ref_id ظهر
  // ولو مرة بـref_table معيّن (payments/expenses/collections/partner_payouts)
  // يخص حركة شريك حقيقية من هذا النوع؛ يُستخدم تحت لربط قيود عكسها
  // (ref_table='reversal' بنفس ref_id) بنفس الـbucket بدل تجاهلها بالكامل.
  // (باج مُكتشَف 2026-08-02 على TM-004 — راجع
  // project_is_primary_line_double_reversal_tm004 في الذاكرة: مصروف/دفعة
  // اتعدّلت أكتر من مرة كانت بتفضل النسخة القديمة محسوبة جنب الجديدة للأبد،
  // لأن crByRef/drByRef كانت بتجمع خام حسب ref_table الحرفي بلا أي خصم
  // لقيود العكس أصلاً — 'reversal' مش مفتاح موجود في crByRef/drByRef فكانت
  // بتتجاهل تمامًا، حتى من المجموع الخام)
  const paymentRefIds = new Set();
  const expenseRefIds = new Set();
  const collectionRefIds = new Set();
  const payoutRefIds = new Set();
  (jeAll||[]).forEach(r => {
    if (r.ref_id == null) return;
    if (r.ref_table === 'payments') paymentRefIds.add(r.ref_id);
    else if (r.ref_table === 'expenses') expenseRefIds.add(r.ref_id);
    else if (r.ref_table === 'collections') collectionRefIds.add(r.ref_id);
    // ✅ 'partner_ledger' — Phase 2 / المرحلة أ، جنب 'partner_payouts' التاريخية
    // (الهجرة لا تعدّل القيود القديمة، راجع sql/partner_ledger_stage_a.sql)
    else if (r.ref_table === 'partner_payouts' || r.ref_table === 'partner_ledger') payoutRefIds.add(r.ref_id);
  });

  // ✅ 2400 (القديم) + أي كود مخصَّص للشركاء (partner_account_links، المرحلة ٢)
  // — contact_name يفضل مُتسجَّل صح على السطرين معًا (الكتّاب بيكتبوه دايمًا)
  // فتجميع byContact تحت بالاسم يشتغل بلا أي تغيير إضافي
  const je2400 = (jeAll||[]).filter(r => r.account_code === '2400' || linkedCodes.has(r.account_code));
  const byContact = {};
  je2400.forEach(r => {
    const name = (r.contact_name||'').trim();
    if (!name) return;
    if (!byContact[name]) byContact[name] = {
      cr:0, dr:0,
      crByRef:{payments:0,expenses:0}, drByRef:{collections:0,partner_payouts:0},
      movements:[],
    };
    const cr = +r.cr_amount||0, dr = +r.dr_amount||0;
    byContact[name].cr += cr;
    byContact[name].dr += dr;
    const ref = r.ref_table, refId = r.ref_id;
    // ✅ صافٍ (cr-dr)/(dr-cr) بدل جمع الدائن/المدين الخام — بلا أي فرق سلوك
    // على القيود العادية (طرف واحد بس دايمًا صفر فيها)، لكن يسمح بخصم قيد
    // العكس (لو وقع على نفس bucket عبر مطابقة ref_id تحت) بدل تجاهله
    if (ref === 'payments') byContact[name].crByRef.payments += (cr - dr);
    else if (ref === 'expenses') byContact[name].crByRef.expenses += (cr - dr);
    else if (ref === 'collections') byContact[name].drByRef.collections += (dr - cr);
    else if (ref === 'partner_payouts' || ref === 'partner_ledger') byContact[name].drByRef.partner_payouts += (dr - cr);
    else if (ref === 'reversal' && refId != null) {
      if (paymentRefIds.has(refId)) byContact[name].crByRef.payments += (cr - dr);
      else if (expenseRefIds.has(refId)) byContact[name].crByRef.expenses += (cr - dr);
      else if (collectionRefIds.has(refId)) byContact[name].drByRef.collections += (dr - cr);
      else if (payoutRefIds.has(refId)) byContact[name].drByRef.partner_payouts += (dr - cr);
    }
    byContact[name].movements.push({ date:r.entry_date, desc:r.description, ref:r.entry_no, dr, cr, refTable:r.ref_table });
  });

  // ✅ استثناء صريح لأسماء الخزينة (TREASURY_ALIASES, engine.js) من مجموع
  // "مساهمات باقي الشركاء" — لو اسم الخزينة ظهر هنا (بسبب باج توجيه، مكتشف
  // فعليًا على 9 ملفات: قيد دفعة كان المفروض يروح نقد/بنك مباشرة اتقيد غلط على
  // 2400 بدل كده)، من غيرها كانت مساهمة الخزينة الحقيقية (treasuryActual تحت)
  // بتتطرح من نفسها — فيظهر "متبقي عليه" رغم إنها دفعت بالفعل. الحساب دلوقتي
  // صحيح دايمًا بغض النظر عن نظافة البيانات، مش بس لما التوجيه يكون سليم
  const nonTreasurySum = Object.entries(byContact)
    .filter(([name]) => !TREASURY_ALIASES.has(name))
    .reduce((s,[,c]) => s + c.crByRef.payments + c.crByRef.expenses, 0);
  const treasuryActual = Math.max(0, fullCost - nonTreasurySum);

  // ✅ النقد المحصَّل فعليًا للملف — من نفس القيود المجلوبة، بلا استعلام إضافي.
  // je_collection (engine.js) بتدائن 1200 بالمبلغ دايمًا، سواء راح الطرف المدين
  // للنقد/البنك أو لجيب شريك (2400) — فمجموع دائن 1200 بمرجع collections هو
  // "الفلوس اللي دخلت فعلاً" بغض النظر عن مين ماسكها. طرح المدين يستوعب قيود
  // العكس (إلغاء تحصيل يدين 1200 بنفس المرجع).
  // مصدر القيود مقصود لا جدول collections: journal_entries هو مصدر الحقيقة،
  // ومقارنة المصدرين على 77 ملف أعطت تطابقًا في 75 (الشاذّان BOX-138/TM-035
  // لهما تاريخ تصحيحات يدوية — بند منفصل)
  const collectedCash = (jeAll||[])
    .filter(r => r.account_code === '1200' && r.ref_table === 'collections')
    .reduce((s,r) => s + (+r.cr_amount||0) - (+r.dr_amount||0), 0);

  const partners = (partnersRaw||[]).map(p => {
    const name  = (p.partner||'').trim();
    const share = (+p.share_percent||0) / 100;
    const isTreasury = TREASURY_ALIASES.has(name);
    const c = byContact[name] || { cr:0, dr:0, crByRef:{payments:0,expenses:0}, drByRef:{collections:0,partner_payouts:0}, movements:[] };

    const capitalPaid        = c.crByRef.payments;
    const expPaid            = c.crByRef.expenses;
    const collectionsHeld    = c.drByRef.collections;
    // ✅ صفوف "تأكيد استلام" (بلا قيد) تُضاف يدويًا — لا تظهر في byContact
    // أصلاً لأنها لم تمرّ بـjeAll إطلاقًا (راجع الاستعلام الرابع أعلى الدالة)
    const confirmedAmt = (confirmations||[])
      .filter(cf => (cf.partner||'').trim() === name)
      .reduce((s,cf) => s + (+cf.amount||0), 0);
    const withdrawnViaPayout = c.drByRef.partner_payouts + confirmedAmt;
    const netJE2400          = c.cr - c.dr;
    const actualContribution = isTreasury ? treasuryActual : (capitalPaid + expPaid);
    const fairShare      = fullCost * share;
    const fairShareDiff  = actualContribution - fairShare;
    const profitShare    = profit * share;
    // ✅ صافي المستحق = فرق العدالة (رأس المال) + حصة الربح — موحّد لكل الشركاء
    // بما فيهم الخزينة (fairShareDiff بتاعها محسوب أصلاً بالمتبقي، treasuryActual
    // فوق). قرار المستخدم 2026-07-28: مين ساهم زيادة عن حصته العادلة ياخد
    // الفائض + نصيبه من الربح، ومين ساهم أقل يتخصم منه النقص من نصيبه في الربح.
    // بما إن مجموع fairShareDiff عبر كل الشركاء = صفر دايمًا (تحقق ذاتي أعلاه)،
    // مجموع netDue عبر كل الشركاء = صافي ربح/خسارة الملف بالظبط — رقم قابل للتدقيق.
    // (الصيغة القديمة كانت تعتمد netJE2400 — الحركة الفعلية على 2400 — واللي
    // كانت بتطابق fairShareDiff بالصدفة بس لو الشريك مالوش أي صرفات سابقة)
    const netDue = fairShareDiff + profitShare;

    // ✅ سقف "استرداد وتوزيع أرباح" — مفهوم مختلف عن netDue تمامًا، إضافة لا
    // استبدال. netDue بيقيس التسوية بين الشركاء (مين ساهم زيادة/نقص عن حصته
    // العادلة) ومجموعه عبر الشركاء = ربح الملف — ثابت مُتحقَّق منه على 115 من
    // 116 ملف (الاستثناء BOX-127: الملف الوحيد بلا شريك خزينة يستوعب المتبقي).
    // أما payableNow فبيجاوب سؤالًا تانيًا: كام فلوس تتصرف فعليًا دلوقتي؟
    //
    // ⚠️ فرع الملف المغلق: actualContribution + profitShare (لا netDue).
    // اكتُشف باج حقيقي 2026-09-06 (بعد اعتماد payableNow في commit سابق):
    // netDue = fairShareDiff + profitShare = (actualContribution − fairShare)
    // + profitShare — يحمل طرح fairShare زيادة عن اللزوم. fairShare مفهومها
    // الصح في *التسوية بين الشركاء* (مين يدي لمين عشان يتساووا)، لا في "كام
    // فلوس الشريك ده يقدر ياخدها من ماله هو". أُثبت بتحفّظ نقدية مستقل على
    // BOX-141: مجموع (actualContribution+profitShare) لكل الشركاء = 13,400
    // بالضبط = collectedCash (النقد الفعلي المتاح)، بينما مجموع netDue = 3,039
    // (الربح فقط — لا يطابق أي نقد حقيقي). وبسيناريو سحب جزئي حي عبر
    // create_partner_ledger_entry الفعلية: بعد سحب 2,000 من أصل استحقاق حقيقي
    // 8,626.50، الصيغة القديمة رفضت سحب المتبقي المشروع 6,626.50 (سقفها كان
    // 1,446 غلط بدل 6,626.50 الصحيح) — تقييد زائد يمنع سحبًا مشروعًا بالكامل،
    // لا مجرد فرق تقريب. صفر أثر إنتاجي وقتها: payableNow لم تكن معروضة في
    // أي واجهة بعد.
    //
    //   • ملف مغلق: كل رأس ماله الفعلي المدفوع + ربحه، ناقص اللي أخده فعلاً —
    //     بدون طرح المسحوب يظهر شريك استلم كل حقه كأنه لسه مستحقّله
    //     (BOX-141/ماجد الجبالي: 8,626.50 = رأس ماله 7,107 + ربحه 1,519.50
    //     بالظبط) — وده الباج الموجود في grandTransferable (accounting.js).
    //
    //   • ملف مفتوح: نفس صيغة المغلق (actualContribution+profitShare-withdrawn)،
    //     مُقيَّدة إضافيًا بسقف النقد الفعلي المتاح (collectedCash×share-withdrawn
    //     -collectionsHeld) — الربح لسه جزئي (محسوب من مبيعات/COGS فعليين
    //     مُرحَّلين لحد الآن، رقم حقيقي لا وهمي) فلا يجوز توزيع أكتر مما تحصَّل
    //     نقدًا فعلاً. اكتُشفت هنا شبهة معاكسة لباج المغلق (تساهل لا تقييد):
    //     الصيغة القديمة (collectedCash×share فقط، بلا اعتبار للمساهمة) كانت
    //     تسمح لشريك بمساهمة صفر يسحب نصف كل نقد جمعه شريك ساهم بالكامل من
    //     جيبه — مُثبَت حيًّا 2026-09-06: سيناريو (شريك أ دفع 7,107 كل التكلفة،
    //     شريك ب صفر، تحصيل جزئي 6,000) كانت الصيغة القديمة تعطي 3,000 لكل
    //     واحد بالتساوي؛ الصيغة الجديدة تعطي شريك ب 1,223.25 فقط (حصته من
    //     الربح الجزئي المحقَّق 2,446.50)، ومجموع التوزيع (4,223.25) أقل عمدًا
    //     من كل النقد المتاح — الباقي يفضل غير موزَّع لحد ما شريك ب يساهم أو
    //     الملف يقفل، بدل توزيعه بالتساوي بلا أساس.
    //
    // ⚠️ ملاحظة منفصلة مؤجَّلة (غير معالَجة هنا): الصيغتان تفترضان ضمنيًا
    // تحصيل المبيعات نقدًا. ملف مغلق (كل السيارات اتباعت) لكن جزء من ثمنها
    // لسه دَين على عميل (collectedCash < totalSales) ممكن يعطي سقفًا أكبر من
    // النقد الموجود فعليًا في يد الشركة — يحتاج فحصًا مستقلًا لاحقًا.
    // الوعد باسترداد رأس مال لسه محبوس في مخزون غير مباع هو وعد بفلوس مش موجودة
    const grossEntitlement = actualContribution + profitShare - withdrawnViaPayout;
    const cashAvailable    = collectedCash * share - withdrawnViaPayout - collectionsHeld;
    const payableNow = isClosed
      ? Math.max(0, grossEntitlement)
      : Math.max(0, Math.min(grossEntitlement, cashAvailable));

    return {
      name, share, sharePercent: +p.share_percent, isTreasury,
      capitalPaid, expPaid, collectionsHeld, withdrawnViaPayout, netJE2400,
      actualContribution, fairShare, fairShareDiff,
      profitShare, netDue, payableNow, movements: c.movements,
      // ✅ مكشوفان لأن العرض يحتاجهما: payableNow وحدها لا تفسّر نفسها.
      //    grossEntitlement = ما يستحقه على الورق، cashAvailable = سقف
      //    النقد المتاح. الفرق بينهما هو ما كانت الشاشة تُخفيه فتعرض
      //    معادلة طرفاها غير متساويين، وتصف شريكًا مستحقًّا بأنه مدين.
      //    وكشفهما يمنع نسخة يدوية سادسة من الصيغة (checkPayoutCap تحت
      //    كانت تعيد حساب cashAvailable بالحرف).
      grossEntitlement, cashAvailable,
    };
  });

  // isClosed/collectedCash مُصدَّران عشان الواجهة تقدر تشرح للمستخدم ليه السقف
  // بالرقم ده، بدل ما يظهر رقم بلا مبرر
  return { fullCost, totalPurchase, totalExpenseAmount, totalSales: fin.sales, profit, hasJEData, isClosed, collectedCash, partners };
}

/**
 * نسخة دفعية من computePartnerSettlement — نفس الحساب بالحرف (عبر
 * _settlePartnerRows الموحّدة)، لكن بجلب واحد للجداول الخمسة مقيَّد بـ
 * file_no IN (كل الملفات)، بدل استعلام لكل ملف على حدة. الهدف: كشف حساب
 * شريك بعشرات الملفات (showPartnerStatement) بلا ~14×N طلب متزامن.
 *
 * ⚠️ partner_account_links وحده لا يُفلتَر بـfile_no (نفس سلوك النسخة
 * المفردة أصلًا — 9 صفوف إجمالاً في كل النظام، أرخص جلبها كاملة).
 *
 * يرجع خريطة { file_no: <نفس ناتج computePartnerSettlement لهذا الملف> }.
 * ملف مطلوب بلا أي صف مطابق (بيانات ناقصة، لا خطأ) يرجع بنفس شكل النتيجة
 * الفارغة التي كانت ستُبنى من مصفوفات فارغة في النسخة المفردة.
 */
export async function computePartnerSettlementBatch(fileNos, sys) {
  const files = [...new Set((fileNos||[]).filter(Boolean))];
  if (!files.length) return {};
  const inList = pgIn(files);

  const [partnersRaw, jeAll, poRows, confirmations, accountLinks] = await Promise.all([
    apiGetAll('partners_master', { select:'partner,share_percent,file_no', system_type:`eq.${sys}`, file_no:inList }),
    apiGetAll('journal_entries', {
      select:'account_code,contact_name,dr_amount,cr_amount,ref_table,ref_id,entry_date,description,entry_no,file_no',
      system_type:`eq.${sys}`, file_no:inList, post_status:`eq.posted`,
      order:'entry_date.asc,id.asc',
    }),
    apiGetAll('purchase_orders', { select:'status,file_no', system_type:`eq.${sys}`, file_no:inList }),
    apiGetAll('partner_ledger', {
      select:'partner,amount,file_no', system_type:`eq.${sys}`, file_no:inList,
      entry_type:'eq.تأكيد استلام', post_status:`eq.posted`,
    }),
    apiGetAll('partner_account_links', { select:'partner_name,account_code', system_type:`eq.${sys}` }),
  ]);

  const groupByFile = rows => {
    const m = {};
    (rows||[]).forEach(r => { (m[r.file_no] ||= []).push(r); });
    return m;
  };
  const partnersByFile = groupByFile(partnersRaw);
  const jeByFile       = groupByFile(jeAll);
  const poByFile       = groupByFile(poRows);
  const confByFile     = groupByFile(confirmations);

  const out = {};
  files.forEach(fn => {
    out[fn] = _settlePartnerRows(
      fn, partnersByFile[fn]||[], jeByFile[fn]||[], poByFile[fn]||[], confByFile[fn]||[], accountLinks
    );
  });
  return out;
}

/**
 * صفة الشريك: دائم أم خارجي — انعكاس حرفي لدالة is_permanent_partner()
 * (sql/m_is_permanent_only.sql) بالكود، بلا استدعاء RPC. الخزينة (بأي اسم في
 * TREASURY_ALIASES) دائمًا true بلا صف ربط، زي الدالة تمامًا. `accountLinks`
 * لازم يحمل عمود is_permanent في الـselect (بعكس النسخة المُستخدَمة داخل
 * computePartnerSettlementBatch فوق، اللي بتجيب partner_name/account_code بس
 * — لا تُستخدم هنا لأنها ناقصة العمود). true=دائم · false=خارجي · null=غير
 * مصنَّف (أو بلا صف ربط أصلًا) — القارئ يتعامل معه بالرفض/الافتراضي الآمن،
 * لا بافتراض دائم أو خارجي. راجع docs/PLAN-partner-statement-restructure-2026-09-20.md قسم ٥.
 */
export function isPermanentPartner(sys, partnerName, accountLinksWithFlag) {
  const name = (partnerName||'').trim();
  if (TREASURY_ALIASES.has(name)) return true;
  const row = (accountLinksWithFlag||[]).find(r => r.partner_name === name);
  // ⚠️ لا تحوّل row.is_permanent === null إلى false هنا — نفس فخ الافتراض
  // الصامت اللي الدالة الأصلية اتصمّمت عشان تمنعه (راجع التعليق فوق)
  return row ? row.is_permanent : null;
}

// ✅ تصنيف مركزي لأخطاء "قيد فريد" (unique constraint) — مُعمَّم لأي اسم قيد،
// مش بس uniq_expense_active/uniq_payment_active الأصليين. قيد فريد يعني الصف
// اللي إنت بتحاول تكتبه (أو نسخة مطابقة منه) موجود بالفعل — غالبًا لأن محاولة
// سابقة نجحت فعلاً (تكرار ضغط، أو إعادة محاولة بعد انقطاع شبكي كان الطلب
// الأول فيها وصل ونجح). نفس مبدأ الاستثناء الأصلي، بس بلا الاقتصار على اسمين
// بعينهم — أي قيد فريد تاني (زي uq_je_ref_primary_posted) كان قبل كده بيظهر
// كنص الخطأ الخام من postgres بلا أي تفسير. راجع project_ui_restructure في الذاكرة
function _classifyUniqueViolation(msg) {
  const m = String(msg || '');
  const match = m.match(/duplicate key value violates unique constraint "([^"]+)"/);
  if (!match) return null;
  if (/^uniq_(expense|payment)_active$/.test(match[1])) {
    return '⚠️ يوجد بالفعل بند بنفس المبلغ والوصف/الدافع والتاريخ لهذا الملف — تأكد إن هذا ليس تكراراً قبل المتابعة';
  }
  return `⚠️ يبدو إن هذه العملية اتسجّلت بالفعل من قبل (قيد فريد: ${match[1]}) — تأكد من القائمة قبل إعادة المحاولة، حتى لا يتكرر البند`;
}

export async function apiPost(table, data) {
  const body = JSON.stringify(data);
  const res = await apiFetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {'Prefer':'return=representation'},
    body
  });
  const resBody = await res.json();
  if (!res.ok) {
    const msg = resBody.message || resBody.error || res.statusText || '';
    const classified = _classifyUniqueViolation(msg);
    if (classified) throw new Error(classified);
    throw new Error(msg);
  }
  return resBody;
}

export async function apiPatch(table, matchParams, data) {
  let url = `${SB_URL}/rest/v1/${table}?`;
  for (const [k, v] of Object.entries(matchParams)) url += `${k}=${encodeURIComponent(v)}&`;
  const body = JSON.stringify(data);
  const res = await apiFetch(url, {
    method: 'PATCH',
    headers: {'Prefer':'return=representation'},
    body
  });
  const resBody = await res.json();
  if (!res.ok) {
    const msg = resBody.message || resBody.error || res.statusText || '';
    const classified = _classifyUniqueViolation(msg);
    if (classified) throw new Error(classified);
    throw new Error(msg);
  }
  return resBody;
}

export async function apiRpc(fn, args = {}) {
  const body = JSON.stringify(args);
  const res = await apiFetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body
  });
  if (!res.ok) {
    const e = await res.json().catch(()=>({}));
    throw new Error(e.message || res.statusText);
  }
  return res.json();
}

// ✅ يحدّ من طول old_value/new_value — سجلات قديمة بها notes متراكمة من خلل سابق
// كانت تُنتج JSON ضخماً يتجاوز حد عمود audit_log فيرفضه PostgREST بـ 400
const AUDIT_VALUE_MAX = 8000;
export function _safeAuditJSON(val) {
  if (!val) return null;
  let s;
  try { s = JSON.stringify(val); } catch(e) { return null; }
  return s.length > AUDIT_VALUE_MAX ? s.slice(0, AUDIT_VALUE_MAX) + '…[truncated]' : s;
}

export async function logAudit(action, tableName, fileNo, oldVal, newVal, notes='') {
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
export async function getRecordAuditTrail({ table, fileNo, refNo, id } = {}) {
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
export async function getCreatorsMap(table, fileNo) {
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
export async function login() {
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

      // ⚠️ "تذكرني" ترجع تحفظ كلمة المرور بـ base64 بناءً على طلب صريح من
      // المستخدم (2026-07-15) — base64 ترميز لا تشفير، قابل للفك فورًا من
      // أي حد عنده وصول للجهاز. تم التحذير من المخاطرة الأمنية قبل التنفيذ.
      if (remember) {
        localStorage.setItem('tm_saved_email', email);
        localStorage.setItem('tm_saved_pass',  btoa(unescape(encodeURIComponent(pass))));
        localStorage.setItem('tm_remember', '1');
      } else {
        localStorage.removeItem('tm_saved_email');
        localStorage.removeItem('tm_saved_pass');
        localStorage.removeItem('tm_remember');
      }

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

// ╔══════════════════════════════════════════════════════════╗
// ║  Phase 2 / المرحلة أ — موديل معاملات الشريك الموحَّد       ║
// ╚══════════════════════════════════════════════════════════╝

/**
 * الرصيد التراكمي لشريك عبر كل ملفاته في نظام معيّن — صافي حركة حساب 2400
 * الخام من journal_entries وحده (بلا فلتر ملف). يُستخدم كسقف "سحب عام"
 * (Math.max(0, …) عند الاستدعاء — القيمة الخام قد تكون سالبة).
 *
 * ⚠️ قرار مُتحقَّق منه بالأرقام: هذا الرصيد الخام ≠ "المستحق الفعلي" — شريك
 * أخذ ربحه بالكامل عبر je_payout/je_partnerLedger (قيد نقدي حقيقي) يظهر هنا
 * سالبًا رغم عدم استحقاقه أي شيء، لأن الربح لا يُقيَّد كدائن على 2400 قبل
 * صرفه (هو مفهوم مشتق في computePartnerSettlement، لا حركة نقدية). مثال
 * حي: ماجد الجبالي/BOX-141 — رصيد خام=-1,519.50 بينما payableNow=0.00
 * (استلم رأس ماله وربحه بالكامل). لحساب "المستحق الفعلي" الصحيح اقتصاديًا،
 * استخدم مجموع payableNow عبر computePartnerSettlement لكل ملفات الشريك —
 * أُجِّل عمدًا هنا (قرار 2026-09-03): "سحب عام" ليس مسارًا ساخنًا حاليًا
 * (صفر استخدام فعلي)، وتكرار حساب التسوية المعقّد بلغة SQL منفصلة هو نفس
 * نمط الأخطاء المعالَج طول هذه الجلسة (تسمية الخزينة، الحسابات الفرعية
 * المهجورة) — يُعاد النظر بدليل أداء حقيقي لا افتراض مسبق.
 */
export async function computePartnerGlobalBalance(partner, sys) {
  const trimmed = partner.trim();
  // ✅ المرحلة ٢ (partner_account_links، 2026-09-16): لو الشريك له حساب مخصَّص
  // (24xx)، حركته دلوقتي ممكن تكون على 2400 (تاريخي، contact_name=الاسم) أو
  // على حسابه (جديد). 🔴 القيود اليدوية الموجودة فعليًا على 2401/2402 كلها
  // contact_name=null (مُتحقَّق حيًّا) — فاستعلام واحد بشرط
  // `contact_name=eq.X AND account_code IN (...)` كان هيرفض صفوف الحساب
  // الجديد كلها بصمت (باج رصده المراجع، مثال: أبو أسعد كان هيرجع 0 بدل
  // +48,600). ⇒ استعلامان منفصلان: بالاسم على 2400 (كالسابق)، وبالحساب وحده
  // على الأكواد المخصَّصة (الحساب نفسه يحدد الشريك، بلا شرط اسم) — union.
  const link = await apiGetAll('partner_account_links', {
    select:'account_code', system_type:`eq.${sys}`, partner_name:`eq.${trimmed}`,
  });
  const linkedCodesOnly = (link||[]).map(r => r.account_code);
  const [byName, byLinkedAccount] = await Promise.all([
    apiGetAll('journal_entries', {
      select:'dr_amount,cr_amount', system_type:`eq.${sys}`,
      account_code:'eq.2400', contact_name:`eq.${trimmed}`, post_status:`eq.posted`,
    }),
    linkedCodesOnly.length ? apiGetAll('journal_entries', {
      select:'dr_amount,cr_amount', system_type:`eq.${sys}`,
      account_code:`in.(${linkedCodesOnly.join(',')})`, post_status:`eq.posted`,
    }) : Promise.resolve([]),
  ]);
  const je2400 = [...byName, ...byLinkedAccount];
  return je2400.reduce((s,r) => s + (+r.cr_amount||0) - (+r.dr_amount||0), 0);
}

/**
 * كل حركات حساب الشريك (2400 التاريخي بالاسم ∪ حسابه المخصَّص لو موجود) —
 * بلا أي فلتر ملف، بعكس settlement.partners[].movements في
 * computePartnerSettlement (مربوطة بـfile_no واحد، فبتفوّت أي قيد بلا ملف —
 * زي القيد الافتتاحي أو حركة أُعيد تصنيفها لاحقًا). اكتُشف حيًّا 2026-09-21:
 * تجميع movements عبر كل ملفات الشريك (خطوة ٣، showPartnerStatement) أعطى
 * حركة واحدة بس لمازن من أصل 95 ملف — تاريخه الحقيقي (القيد الافتتاحي +871
 * سطر أُعيدت تصنيفها في م٤) بلا file_no أو على حساب تاني أصلًا، فمستحيل
 * يظهر من مصدر مربوط بملف مهما كان القالب. نفس منطق
 * computePartnerGlobalBalance بالضبط (فوق) — union لا شرط واحد، لنفس السبب
 * الموثَّق هناك — لكن صفوف كاملة للعرض لا مجموع فقط.
 */
export async function fetchPartnerLedgerMovements(sys, partner) {
  const trimmed = (partner||'').trim();
  const link = await apiGetAll('partner_account_links', {
    select:'account_code', system_type:`eq.${sys}`, partner_name:`eq.${trimmed}`,
  });
  const linkedCodesOnly = (link||[]).map(r => r.account_code);
  const selectCols = 'id,entry_date,description,entry_no,dr_amount,cr_amount,file_no,ref_table,ref_id';
  const [byName, byLinkedAccount] = await Promise.all([
    apiGetAll('journal_entries', {
      select:selectCols, system_type:`eq.${sys}`,
      account_code:'eq.2400', contact_name:`eq.${trimmed}`, post_status:`eq.posted`,
    }),
    linkedCodesOnly.length ? apiGetAll('journal_entries', {
      select:selectCols, system_type:`eq.${sys}`,
      account_code:`in.(${linkedCodesOnly.join(',')})`, post_status:`eq.posted`,
    }) : Promise.resolve([]),
  ]);
  const seen = new Set();
  const rows = [];
  [...byName, ...byLinkedAccount].forEach(r => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    rows.push(r);
  });
  rows.sort((a,b) => (a.entry_date||'').localeCompare(b.entry_date||'') || (a.id - b.id));

  // ✅ اكتُشف حيًّا 2026-09-22: وصف قيود "سحب عام"/"إيداع عام" (ref_table=
  // 'partner_ledger') ثابت عام دايمًا ("سحب عام — مازن الخلف" بلا أي تفصيل)
  // — لكن سبب العملية الحقيقي مكتوب فعلًا في partner_ledger.notes وقت
  // التسجيل (فحصت 98 صف حي لمازن — كلها ملاحظات حقيقية ومفصَّلة)، ومجرد
  // معزول عن journal_entries.description من وقت الإنشاء (je_partnerLedger،
  // engine.js). نجيبها هنا للعرض بدل ما نلمس قيودًا مُرحَّلة فعليًا.
  const ledgerRefIds = [...new Set(rows.filter(r => r.ref_table === 'partner_ledger' && r.ref_id != null).map(r => r.ref_id))];
  const notesById = {};
  if (ledgerRefIds.length) {
    const notesRows = await apiGetAll('partner_ledger', { select:`id,notes`, id:`in.(${ledgerRefIds.join(',')})` });
    (notesRows||[]).forEach(n => { if (n.notes && n.notes.trim()) notesById[n.id] = n.notes.trim(); });
  }

  return rows.map(r => {
    const extraNote = r.ref_table === 'partner_ledger' ? notesById[r.ref_id] : null;
    return {
      date: (r.entry_date||'').split('T')[0], desc: extraNote ? `${r.description||'—'} — ${extraNote}` : (r.description||'—'),
      ref: r.entry_no||'', debit: +r.dr_amount||0, credit: +r.cr_amount||0, fileNo: r.file_no||'',
    };
  });
}

/**
 * م٦ (سجل ترحيل الأرباح) — المرحلة الأولى: غلاف حول RPC
 * post_profit_for_file (sql/m6_profit_postings_phase1.sql) — شريك دائم
 * مُسمَّى يرحّل ربح ملفه هو (لا الخزينة، مؤجَّل لمرحلة تانية).
 *
 * ✅ تحقّق حي فوري ضد انحراف صيغتَي الربح (JS/SQL) — راجع التعليق المقابل
 * في الملف SQL قسم ٢. الدالة السيرفر (لا هذا التحقق) هي مصدر الحقيقة اللي
 * كُتب فعليًا في 3200/حساب الشريك — رقمها لا يُستبدَل هنا مهما كانت النتيجة.
 * لكن أي فرق عن computeFinancials المحلية (نفس المعادلة، مصدر مختلف) لازم
 * يظهر فورًا وصارخًا، لا سكريبت دوري لازم حد يفتكر يشغّله.
 */
export async function postFileProfit(sys, fileNo, partner) {
  const [result] = await apiRpc('post_profit_for_file', { p_sys: sys, p_file_no: fileNo, p_partner: partner });
  if (!result) return result;

  try {
    const jeAll = await apiGetAll('journal_entries', {
      select: 'account_code,dr_amount,cr_amount,ref_table,file_no',
      system_type: `eq.${sys}`, file_no: `eq.${fileNo}`, post_status: `eq.posted`,
    });
    const fin = computeFinancials(jeAll).byFile[fileNo] || { sales:0, cogs:0, dealExp:0 };
    const jsProfit = fin.sales - fin.cogs - fin.dealExp;
    const drift = Math.abs(jsProfit - (+result.file_profit || 0));
    if (drift > 0.01) {
      console.error(`⚠️ انحراف صيغة الربح! SQL=${result.file_profit} JS=${jsProfit.toFixed(2)} فرق=${drift.toFixed(2)} — ملف ${fileNo} — راجع فورًا`);
      toast(`⚠️ تحذير: رقم الربح المُرحَّل (${result.file_profit}) يختلف عن الحساب المحلي (${jsProfit.toFixed(2)}) — راجع الصيغتين فورًا`, 'err');
    }
  } catch(e) { console.warn('postFileProfit: فشل التحقق التلقائي من انحراف الصيغة:', e.message); }

  return result;
}

/**
 * "المرشَّح" الافتراضي لـ"تأكيد استلام" ملف معيّن — من تحصيلاته الفعلية
 * (collections.received_by)، لا افتراض ثابت باسم الخزينة. الأكبر مبلغًا هو
 * top (يُستخدم كتحديد مسبق في الواجهة)؛ isMixed=true يعني الملف فيه أكتر
 * من مستلم حقيقي — الواجهة تُلزم اختيارًا يدويًا بدل التحديد التلقائي.
 * لا تسجيل "تأكيد استلام" تلقائيًا بناءً على هذه — قرار المستخدم دائمًا.
 */
export async function getFileDefaultReceiver(fileNo, sys) {
  const cols = await apiGetAll('collections', {
    select:'received_by,amount', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, post_status:'eq.posted',
  });
  const byReceiver = {};
  cols.forEach(c => {
    const rb = (c.received_by && c.received_by.trim()) || TREASURY_PARTNER;
    byReceiver[rb] = (byReceiver[rb]||0) + (+c.amount||0);
  });
  const entries = Object.entries(byReceiver).sort((a,b) => b[1]-a[1]);
  return { top: entries[0]?.[0] || TREASURY_PARTNER, isMixed: entries.length > 1, breakdown: entries };
}

/**
 * فحص سقف "صرف شريك" المربوط بملف — نقطة واحدة يستدعيها كل مسار كتابة
 * (submitPayout في modals.js، submitQuickPayout في viewer.js). لا تُكرَّر
 * الصيغة في المستدعي: تكرارها يدويًا هو بالضبط نمط الأخطاء الذي عولج في
 * 2026-09-06/07 (تسع مواضع netDue، ثم ثلاث نسخ يدوية لمعادلة الاستحقاق).
 *
 * ⚠️ سبب وجودها كإجراء مؤقت: قرار المستخدم 2026-09-07 أن الصرف المربوط بملف
 * *له سقف* بالتصميم. الـRPC الجديدة (create_partner_ledger_entry) تفرضه
 * ذرّيًا، لكن الزر القديم يكتب في partner_payouts مباشرة بلا أي فحص. وأسوأ:
 * سقف الـRPC يحسب "الاستحقاق الإجمالي" من قيود الجدولين بينما يحسب "المسدَّد
 * سابقًا" (v_prior) من partner_ledger وحدها — فأي صرف جديد بالزر القديم يرفع
 * سقف الـRPC بمقدار نفسه، أي يصير المبلغ قابلًا للسحب مرتين. هذا الفحص يغلق
 * النافذة حتى تنقل المرحلة ب-٢ مسار الكتابة إلى الـRPC، وعندها يصبح زائدًا
 * (لا ضار) ويمكن إزالته مع الزر القديم.
 *
 * ليس بديلًا عن قفل الـRPC الذرّي: هذا فحص من طرف العميل، يمنع الخطأ العادي
 * لا السباق المتزامن. القراءة طازجة عند الإرسال عمدًا (لا الرقم المعروض في
 * النموذج) لأن النموذج قد يبقى مفتوحًا بعد تغيّر البيانات.
 */
export async function checkPayoutCap(fileNo, partner, sys, amount, excludeRowId = null, ledgerType = null) {
  const nm = (partner || '').trim();
  const f2 = n => (+n || 0).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });

  // ✅ المرحلة ١ — ترانزيت: سقف "استرداد وتوزيع أرباح" = الربح المُرحَّل لهذا
  // الملف ناقص الربح المسحوب منه، لا payableNow. السبب بنيوي لا تجميلي: قيد
  // الافتتاح JE-2026-01501 سُجّل **بلا رقم ملف**، فرأس مال الشركة المدوَّر ما
  // زال داخل صافي 2400 لكل ملف (TM-010 ≈ 22,642) — ومن هنا جاء السماح بصرف
  // 24,450 لمازن على TM-010 مقابل نصيب ربح ≈1,808 (قياس حي 2026-09).
  // سجل الترحيل profit_postings لم يُنشأ بعد (المرحلة ٣) ⇒ المُرحَّل = صفر.
  // مُتحقَّق حيًّا 2026-09-16: ترانزيت بلا أي صف مرتبط بملف في الجدولين
  // (98 صفًّا كلها "سحب عام"، وpartner_payouts فارغ) ⇒ صفر أثر على بيانات قائمة.
  if (sys === 'TM') {
    const postedProfit = 0;
    const LIVE = ['posted','draft','pending_edit','pending_void'];
    const [plRows, ppRows] = await Promise.all([
      apiGetAll('partner_ledger',  { select:'id,profit_amount,ref_no,post_status', system_type:`eq.${sys}`,
        file_no:`eq.${fileNo}`, partner:`eq.${nm}` }),
      apiGetAll('partner_payouts', { select:'profit_amount,pay_id,post_status',  system_type:`eq.${sys}`,
        file_no:`eq.${fileNo}`, partner:`eq.${nm}` }),
    ]);
    // نفس دلالة v_prior في create_partner_ledger_entry: الجدولان معًا مع إزالة
    // تكرار صفوف الهجرة (partner_ledger.ref_no = partner_payouts.pay_id)
    const migrated = new Set((plRows||[]).map(r => r.ref_no).filter(Boolean));
    let withdrawnProfit =
      (plRows||[]).filter(r => LIVE.includes(r.post_status)).reduce((s,r) => s + (+r.profit_amount||0), 0) +
      (ppRows||[]).filter(r => LIVE.includes(r.post_status) && !migrated.has(r.pay_id))
                  .reduce((s,r) => s + (+r.profit_amount||0), 0);
    // ✅ استثناء الصف الجاري تعديله (البند الكامن الأول من المرحلة ١، م٧) —
    // كان هذا الفرع يتجاهل excludeRowId تمامًا بعكس فرع BOX تحت، فيُخصم مبلغ
    // الصف مرتين عند تعديله. كامن حاليًا فقط لأن postedProfit=0 دائمًا (سجل
    // profit_postings لم يُنشأ بعد، م٦) فالسقف صفر بغض النظر عن أي تعديل —
    // سيظهر أثره الفعلي فور تفعيل م٦. راجع docs/PLAN-partner-accounts-2026-09-17.md
    if (excludeRowId) {
      const cur = (plRows||[]).find(r => String(r.id) === String(excludeRowId));
      if (cur) withdrawnProfit = Math.max(0, withdrawnProfit - (+cur.profit_amount||0));
    }
    const capTM = Math.max(0, postedProfit - withdrawnProfit);
    if (amount > capTM + 0.001) {
      // ✅ البند الكامن الثاني من المرحلة ١ (م٧) — "تأكيد استلام" (needsJE:false،
      // lifecycle.js) بلا أي حركة نقدية أصلًا، فنصيحة "استخدم سحب عام" (نوع
      // بحركة نقدية) لا تنطبق عليه ومربكة. تظهر فقط للأنواع اللي فعلاً بتصرف نقدًا.
      const suggestion = ledgerType === 'تأكيد استلام' ? '' : ' لصرف مبلغ للشريك استخدم «سحب عام» من رصيد حسابه.';
      return { ok:false, payableNow:capTM, pendingDraft:0, warning:'',
        message:`في ترانزيت يُحسب الاسترداد من الربح المُرحَّل للملف ${fileNo}: المُرحَّل ${f2(postedProfit)} والمسحوب منه ${f2(withdrawnProfit)} ⇒ المتاح ${f2(capTM)}.${suggestion}` };
    }
    return { ok:true, payableNow:capTM, pendingDraft:0, warning:'', message:'' };
  }
  // ✅ المسوّدات لازم تُطرح يدويًا — بلا هذا الفحص لا يعمل إطلاقًا للمستخدم
  // العادي: entryStatus() (engine.js:58) ترجع 'draft' لغير المدير، وsubmitPayout
  // لا تستدعي je_payout إلا لو 'posted' ⇒ صف المسودة بلا قيد ⇒ وpayableNow
  // محسوبة من journal_entries بـpost_status=eq.posted وحدها ⇒ المسودة لا
  // تُنقِص السقف ⇒ N مسودات كلها تمرّ بنفس الرقم، ثم يعتمدها الطابور كلها
  // (مسارات الاعتماد لا تعيد الفحص). رصدته مراجعة مستقلة 2026-09-07.
  //
  // ⚠️ النطاق 'draft' وحدها عمدًا — لا 'pending_edit' رغم أن v_prior في الـRPC
  // تعدّها. السببان مختلفان بنيويًا ولا يجوز نسخ نطاقها هنا:
  //   • v_prior تُطرح من "الاستحقاق الإجمالي" (قبل أي سحب) فتعدّ كل الصفوف.
  //   • payableNow هنا *صافية* أصلًا من كل سحب له قيد مُرحَّل.
  // وpending_edit له قيد فعلًا: statusAfterEdit (lifecycle.js) تُرجع
  // 'pending_edit' فقط لصف كان posted/pending_edit، وsubmitEditPayout تستدعي
  // updateJEInPlace كلما wasAlreadyPosted ⇒ القيد موجود ومحدَّث بالمبلغ الجديد
  // ⇒ مطروح أصلًا داخل payableNow. طرحه ثانيةً خصم مزدوج يمنع صرفًا مشروعًا.
  // نفس المنطق لـpending_void (قيده قائم حتى يُعتمد العكس).
  const [settlement, draftPayouts, draftLedger] = await Promise.all([
    computePartnerSettlement(fileNo, sys),
    apiGetAll('partner_payouts', { select:'amount', system_type:`eq.${sys}`,
      file_no:`eq.${fileNo}`, partner:`eq.${nm}`, post_status:'eq.draft' }),
    // partner_ledger كذلك: 'استرداد وتوزيع أرباح' لا قيد له قبل الاعتماد،
    // و'تأكيد استلام' لا يُحتسب في core.js إلا بـposted (الاستعلام الرابع أعلى
    // computePartnerSettlement) — فمسودتاهما غير مرئيتين لـpayableNow أيضًا
    apiGetAll('partner_ledger', { select:'amount', system_type:`eq.${sys}`,
      file_no:`eq.${fileNo}`, partner:`eq.${nm}`, post_status:'eq.draft' }),
  ]);
  const x = (settlement.partners || []).find(p => p.name === nm);
  if (!x) {
    return { ok:false, payableNow:0, pendingDraft:0,
      message:`الشريك "${nm}" غير مسجَّل ضمن شركاء الملف ${fileNo} — لا يمكن تحديد مستحقه` };
  }
  const sum = rows => (rows || []).reduce((s, r) => s + (+r.amount || 0), 0);
  let pendingDraft = sum(draftPayouts) + sum(draftLedger);
  let gross = +x.payableNow || 0;

  // ✅ استثناء الصف الجاري تعديله — نظير pl.id <> p_id في
  // update_partner_ledger_entry. بدونه يُخصم مبلغه مرتين: مرة كصف قائم
  // ومرة كمبلغ جديد ⇒ يرفض العميل تعديلًا تقبله القاعدة، فيظهر تناقض
  // بين طبقتين كلتاهما صحيحة.
  //
  // ⚠️ والاستثناء ليس واحدًا — يختلف بحالة الصف، وهذا موضع الخطأ السهل:
  //   • draft        → لا قيد له، فمبلغه داخل pendingDraft ⇒ يُطرح منها
  //   • posted/pending_edit/pending_void → له قيد مُرحَّل، فمبلغه مطروح
  //     أصلًا داخل payableNow ⇒ يُضاف إلى gross
  // خلطهما يعطي إما تشدّدًا يمنع تعديلًا مشروعًا أو تساهلًا يرفع السقف.
  if (excludeRowId) {
    const [cur] = await apiGetAll('partner_ledger', {
      select: 'amount,post_status', id: `eq.${excludeRowId}` });
    // ⚠️ يرمي بدل أن يمرّ: صفٌّ غير موجود يعني أن الاستثناء لم يُطبَّق، فيُخصم
    // مبلغه مرتين ويُرفض تعديل مشروع — بلا أي أثر يدلّ على السبب. والصف لازم
    // أن يكون موجودًا أصلًا حتى يُعدَّل، فوصولنا هنا بلا صف خللٌ لا حالة عادية.
    if (!cur) throw new Error(`تعذّر إيجاد المعاملة ${excludeRowId} للتحقق من سقفها`);
    const curAmt = +cur.amount || 0;
    if (cur.post_status === 'draft') pendingDraft = Math.max(0, pendingDraft - curAmt);
    else gross += curAmt;
  }

  const cap   = Math.max(0, gross - pendingDraft);

  // ✅ تحذير (لا منع) حين يتجاوز المبلغ النقد المحصَّل فعلًا — قرار المستخدم
  // 2026-09-07 بعد قياس حي على BOX-126: ملف مغلق (كل السيارات بيعت) لكن
  // 2,210 لسه ذمة على عميل. فرع الملف المغلق في payableNow بلا سقف نقدي
  // بالتصميم، فيأذن بصرف مبلغ غير موجود في الخزينة. المنع كان سيرفض صرفًا
  // مشروعًا في ملف انتهى فعلًا، فالقرار: نبّه ودع القرار للمستخدم.
  // ملاحظة: لا ينطبق على الملف المفتوح — payableNow هناك مُقيَّدة بالنقد أصلًا
  // فلا يمكن تجاوزه، والتحذير لن يظهر إلا في الحالة المغلقة ذات الذمم.
  // ✅ من كائن الشريك مباشرة — كانت هنا نسخة حرفية من نفس الصيغة في
  //    computePartnerSettlement؛ نسختان تنحرفان بصمت إن عُدِّلت إحداهما.
  const cashAvailable = +x.cashAvailable || 0;
  const overCash = amount > cashAvailable + 0.001;
  const warning = overCash
    ? `المبلغ ${f2(amount)} أكبر من النقد المحصَّل فعلًا لهذا الشريك على الملف (${f2(Math.max(0, cashAvailable))}). `
      + `الفرق ${f2(amount - Math.max(0, cashAvailable))} ما زال ذمّة على العملاء ولم يدخل الخزينة بعد.`
    : '';
  // 0.001 — نفس هامش create_partner_ledger_entry بالضبط، حتى لا يقبل مسار
  // ما يرفضه الآخر على نفس المبلغ
  if (amount > cap + 0.001) {
    // نذكر المسوّدات صراحةً — بدونها يرى المستخدم "مستحقه 10,000" على الشاشة
    // ويُرفض له 10,000 بلا سبب مفهوم
    const extra = pendingDraft > 0.001
      ? ` (المستحق ${f2(gross)} ناقص ${f2(pendingDraft)} صرف مُسجَّل بانتظار الاعتماد)`
      : '';
    return { ok:false, payableNow:cap, pendingDraft, warning,
      message:`المبلغ ${f2(amount)} يتجاوز المستحق المتبقي ${f2(cap)} للشريك ${nm} على الملف ${fileNo}${extra}` };
  }
  return { ok:true, payableNow:cap, pendingDraft, warning, message:'' };
}

/**
 * كتابة صف partner_ledger — عبر create_partner_ledger_entry (RPC، راجع
 * sql/partner_ledger_stage_a.sql). القفل + فحص السقف + الترقيم + الإدراج
 * كلهم في نفس الـtransaction بالضرورة: PostgREST ينفّذ كل نداء RPC في
 * transaction مستقلة، فأي قفل يُحرَّر لحظة رجوع النداء — فصل "احجز رقمًا"
 * عن "أدرِج الصف" في نداءين منفصلين يعيد فتح نفس سباق التزامن الذي هذه
 * الدالة مصمَّمة لإغلاقه.
 *
 * ⚠️ settlementPartner (لا رقم مفرد): مرِّر كائن الشريك كما يرجعه
 * computePartnerSettlement(fileNo, sys).partners.find(...) — إلزامي للأنواع
 * المرتبطة بملف (استرداد وتوزيع أرباح / تأكيد استلام) فقط. الدالة تحسب
 * الاستحقاق الإجمالي داخليًا (payableNow + withdrawnViaPayout) وتمرّره
 * كمعامل موثوق للـRPC (نفس الموقف الأمني القائم في التطبيق كله؛
 * postDoubleEntry لا يعيد التحقق من الأرصدة من طرف الخادم هو الآخر) —
 * تمرير payableNow وحدها مباشرة يُنتج خصمًا مزدوجًا (اكتُشف تجريبيًا
 * 2026-09-06، راجع sql/partner_ledger_stage_a.sql)، لذا الدالة تفرض الكائن
 * الكامل بدل رقم مفصول عن حسابه، لا مجرد توثيق بالتعليق.
 */
export async function createPartnerLedgerEntry({sys, partner, entryType, payDate, fileNo=null,
  amount=null, capital=0, profit=0, payMethod=null, document=null, notes=null,
  postStatus='draft', idempotencyKey=null, settlementPartner=null}) {
  const grossEntitlement = settlementPartner
    ? settlementPartner.payableNow + settlementPartner.withdrawnViaPayout
    : null;
  return await apiRpc('create_partner_ledger_entry', {
    p_sys: sys, p_partner: partner, p_entry_type: entryType, p_pay_date: payDate,
    p_file_no: fileNo, p_amount: amount, p_capital: capital, p_profit: profit,
    p_pay_method: payMethod, p_document: document, p_notes: notes,
    p_post_status: postStatus, p_idempotency_key: idempotencyKey, p_gross_entitlement: grossEntitlement,
  });
}

/**
 * تعديل صف partner_ledger — عبر update_partner_ledger_entry (RPC، راجع
 * sql/partner_ledger_update_rpc.sql). القفل + فحص الحالة + فحص السقف +
 * التحديث + ضبط post_status كلها في transaction واحدة.
 *
 * ⚠️ دلالة الحقول **استبدال لا دمج**: مرّر حالة النموذج كاملة في كل نداء.
 * القيمة الفارغة تعني «مسحها المستخدم» لا «لم يذكرها» — فإرسال المبلغ وحده
 * يمسح المستند والملاحظات. هذا مقصود وموحَّد عبر الحقول الأربعة، بعد أن
 * كانت الدالة نصفين بدلالتين مختلفتين (رُصد في المراجعة 2026-09-08).
 *
 * ⚠️ settlementPartner إلزامي للأنواع المرتبطة بملف — نفس سبب
 * createPartnerLedgerEntry: الاستحقاق الإجمالي يُحسب هنا من الكائن نفسه
 * (payableNow + withdrawnViaPayout) لا يُمرَّر رقمًا مفصولًا عن حسابه.
 * والـRPC تستثني الصف المُعدَّل من «المسدَّد سابقًا» بنفسها.
 *
 * لا تُمرَّر entry_type ولا partner ولا file_no: غير قابلة للتغيير بالتصميم.
 */
export async function updatePartnerLedgerEntry({ id, payDate, amount = null,
  capital = 0, profit = 0, payMethod = null, document = null, notes = null,
  settlementPartner = null }) {
  const grossEntitlement = settlementPartner
    ? settlementPartner.payableNow + settlementPartner.withdrawnViaPayout
    : null;
  return await apiRpc('update_partner_ledger_entry', {
    p_id: id, p_pay_date: payDate, p_amount: amount,
    p_capital: capital, p_profit: profit,
    p_pay_method: payMethod, p_document: document, p_notes: notes,
    p_gross_entitlement: grossEntitlement,
  });
}

export function logout() {
  localStorage.removeItem('tm_token');
  localStorage.removeItem('tm_refresh');
  localStorage.removeItem('tm_user');
  state.token        = null;
  state.refreshToken = null;
  state.user         = null;
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appScreen').style.display   = 'none';
  if (!localStorage.getItem('tm_remember')) document.getElementById('loginPass').value = '';
}

// ════════════════════════════════════════
// PARTNER TRANSACTIONS — اتحاد الموديلين، نقطة واحدة
// ════════════════════════════════════════
/**
 * كل معاملات الشركاء من الموديلين معًا، منزوعة التكرار.
 *
 * ⚠️ الهجرة نسخت ولم تنقل (sql/partner_ledger_stage_a.sql بلا delete)، فالصفوف
 *    المهاجَرة موجودة في الجدولين. مفتاح المطابقة: partner_ledger.ref_no =
 *    partner_payouts.pay_id — نُبقي نسخة الموديل الموحَّد ونُسقط نظيرتها القديمة.
 *    اتحاد ساذج بلا هذا النزع يعرض كل صفٍّ مهاجَر مرتين ويضاعف الإجمالي.
 *
 * ⚠️ كل صف يحمل __src ('ledger' أو 'payout'): id الجدولين تسلسلان مستقلان،
 *    فأي إجراء (تعديل/إلغاء/سجل) يجب أن يقرأ __src أولًا. الخلط بينهما يُلغي
 *    سجلًّا آخر تمامًا بقيد عكسي — لا خطأ ظاهر، ومال يتحرك.
 *
 * ملاحظة: نجلب system_type المطابق و null معًا كما تفعل شاشة المعاملات —
 * بيانات ما قبل فصل النظامين system_type فيها null.
 */
export async function fetchPartnerTransactions(sys, { fileNo = null } = {}) {
  const scope = extra => ({ select:'*', ...(fileNo ? { file_no:`eq.${fileNo}` } : {}), ...extra });
  const both = async table => {
    const [a, n] = await Promise.all([
      apiGetAll(table, scope({ system_type:`eq.${sys}` })),
      apiGetAll(table, scope({ system_type:'is.null' })),
    ]);
    const seen = new Set(); const out = [];
    [...(a||[]), ...(n||[])].forEach(r => { if (!seen.has(r.id)) { seen.add(r.id); out.push(r); } });
    return out;
  };
  const [led, pay] = await Promise.all([both('partner_ledger'), both('partner_payouts')]);
  const migrated = new Set((led||[]).map(r => r.ref_no).filter(Boolean));
  const norm = (r, src) => ({
    ...r,
    __src:  src,
    __ref:  (src === 'ledger' ? r.ref_no : r.pay_id) || '',
    __type: (src === 'ledger' ? r.entry_type : r.payout_type) || '—',
    __date: r.pay_date || '',
  });
  return [
    ...(led||[]).map(r => norm(r, 'ledger')),
    ...(pay||[]).filter(r => !migrated.has(r.pay_id)).map(r => norm(r, 'payout')),
  ].sort((a, b) => (b.__date || '').localeCompare(a.__date || ''));
}

// ── window bridge: تعريض الدوال والحالة للاستخدام من classic scripts وسمات onclick ──
Object.assign(window, {
  cacheStale, ensureCache, _doLoadCache, invalidateCache, isPosted,
  isDraft, isActive, isEffective, isVisible, isOccupying, isPending,
  passesPostFilter, refreshAccessToken, isTokenValid, headers, apiFetch, apiGet,
  apiGetAll, fetchJEForPeriod, fetchAllPages, computeFinancials, computePartnerSettlement, computePartnerSettlementBatch, isPermanentPartner, pgIn, apiPost, apiPatch,
  apiRpc, _safeAuditJSON, logAudit, getRecordAuditTrail, getCreatorsMap,
  computePartnerGlobalBalance, fetchPartnerLedgerMovements, postFileProfit, getFileDefaultReceiver, createPartnerLedgerEntry, updatePartnerLedgerEntry, checkPayoutCap,
  fetchPartnerTransactions,
  login, logout, state, SB_URL, SB_KEY,
});
