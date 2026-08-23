// ╔══════════════════════════════════════════════════════════╗
// ║  fleet-core.js — API helpers للـfleet schema المنفصل     ║
// ║  إعادة بناء (مش استيراد) لنمط js/core.js — نفس الفلسفة،  ║
// ║  عزل كود كامل (§3 بند 2 من البرومبت المعتمد v6)          ║
// ╚══════════════════════════════════════════════════════════╝

// نفس مشروع Supabase الحالي (schema منفصل fleet، مش مشروع منفصل — §3 بند 1)
export const SB_URL = 'https://tepaonhqszocyjsdcyoz.supabase.co';
export const SB_KEY = 'sb_publishable_l24VhFauUbUD7GfAyEnyhQ_9F_PKHH3';

// نفس مفاتيح localStorage اللي بيستخدمها التطبيق الأصلي (js/core.js) —
// نفس جلسة الدخول، بدون فورم لوجين منفصل لـfleet.
export const state = {
  token: localStorage.getItem('tm_token') || null,
  user:  (() => { try { return JSON.parse(localStorage.getItem('tm_user') || 'null'); } catch { return null; } })(),
};

// ── لا نعيد بناء تجديد التوكن (refresh) هنا عمدًا ──
// refreshAccessToken() في core.js بيستهلك refresh token دوّار (rotating) —
// نسخة ثانية مستقلة هنا ممكن تتسابق مع النسخة الأصلية على نفس التوكن وتكسر
// الجلسة في الاتنين. أبسط وأسلم قرار لـv1: عند 401، رجوع مباشر لصفحة الدخول
// الرئيسية بدل محاولة تجديد مستقلة (تريد أوف واعٍ، موثَّق هنا صراحةً).
function _redirectToMainLogin() {
  window.location.href = '/';
}

function headers(extra = {}) {
  const h = {
    'apikey': SB_KEY,
    'Content-Type': 'application/json',
    'Accept-Profile': 'fleet',
    'Content-Profile': 'fleet',
    ...extra,
  };
  h['Authorization'] = `Bearer ${state.token || SB_KEY}`;
  return h;
}

// ✅ نفس تصنيف "خطأ شبكة غير مؤكد" الموجود في core.js — انقطاع الاتصال
// أثناء العملية لا يعني بالضرورة فشلها، والرسالة يجب أن تعكس ذلك (§3 بند 13:
// لا فشل صامت، لا نجاح وهمي — الحالة المعلَّقة يجب أن تكون واضحة للمستخدم).
function _isNetworkLevelError(e) {
  return e instanceof TypeError && /fetch|network/i.test(e.message || '');
}
export const NETWORK_UNCERTAIN_MSG =
  '⚠️ انقطع الاتصال بالخادم أثناء العملية — قد تكون نجحت فعلاً رغم ظهور هذا الخطأ. تأكد من القائمة قبل إعادة المحاولة';

export async function fleetFetch(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, { ...opts, headers: headers(opts.headers) });
  } catch (e) {
    if (_isNetworkLevelError(e)) throw new Error(NETWORK_UNCERTAIN_MSG);
    throw e;
  }
  if (res.status === 401) {
    _redirectToMainLogin();
    throw new Error('انتهت الجلسة — جاري التوجيه لصفحة الدخول');
  }
  return res;
}

function _buildQs(params) {
  const NO_ENCODE = new Set(['select', 'order', 'or', 'and', 'limit', 'offset']);
  return Object.entries(params)
    .map(([k, v]) => (NO_ENCODE.has(k) ? `${k}=${v}` : `${k}=${encodeURIComponent(v)}`))
    .join('&');
}

export async function apiGet(table, params = {}) {
  const qs = _buildQs(params);
  const url = `${SB_URL}/rest/v1/${table}${qs ? '?' + qs : ''}`;
  const res = await fleetFetch(url);
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || res.statusText);
  }
  return res.json();
}

export async function apiPost(table, data) {
  const res = await fleetFetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || res.statusText);
  }
  return res.json();
}

export async function apiPatch(table, matchParams, data) {
  const qs = Object.entries(matchParams).map(([k, v]) => `${k}=${v}`).join('&');
  const res = await fleetFetch(`${SB_URL}/rest/v1/${table}?${qs}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || res.statusText);
  }
  return res.json();
}

// حذف حقيقي — مسموح بس لـfleet_vehicle_notes (استثناء متعمّد، §sql/fleet_vehicle_notes.sql).
// باقي جداول الفليت مالهاش GRANT DELETE أصلًا من القاعدة، فأي محاولة استخدام
// الدالة دي عليهم هترجع خطأ صريح من PostgREST (RLS/GRANT)، مش فشل صامت.
export async function apiDelete(table, matchParams) {
  const qs = Object.entries(matchParams).map(([k, v]) => `${k}=${v}`).join('&');
  const res = await fleetFetch(`${SB_URL}/rest/v1/${table}?${qs}`, { method: 'DELETE' });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || res.statusText);
  }
}

// كل الكتابات المالية تمر من دوال RPC المركزية في sql/fleet_schema.sql —
// مفيش أي شاشة بتكتب مباشرة في fleet_journal_entries أو تحسب رصيد بنفسها.
export async function apiRpc(fn, args = {}) {
  const res = await fleetFetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || res.statusText);
  }
  // ✅ باج حقيقي اكتُشف حيًّا (اختبار يدوي على سيارة حقيقية، مش الريجريشن —
  // هرنيس الريجريشن كان بيبلع فشل res.json() بـ.catch(()=>null) فمخبّاه بالغلط):
  // دوال RPC اللي بترجع "void" (fleet_void_receipt/fleet_void_invoice/
  // fleet_void_bill/fleet_void_payment) بترجع 204 بجسم فاضي — res.json()
  // عليه كان بيرمي "Unexpected end of JSON input" رغم إن العملية نجحت فعليًا
  // على القاعدة (تأكيد حي: سند اتلغى صح على السيرفر، والواجهة كانت هتوريه
  // "فشل" رغم كده — أخطر من فشل حقيقي لأنه بيوهم بإعادة محاولة على عملية
  // خلصت أصلًا). القراءة كنص أولًا ثم parse بس لو فيه محتوى فعلي تحلّها.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// مفتاح idempotency — يُولَّد وقت فتح أي نموذج إدخال، مش وقت الإرسال (§3 بند 8)
export function genClientUuid() {
  return crypto.randomUUID();
}

// الدينار الكويتي: 3 خانات عشرية (fils) — دالة مستقلة، لا تُستعار من دوال
// التطبيق الأصلي المبنية على افتراض خانتين عشريتين (§3 بند 7).
export function fmtKWD(amount) {
  const n = Number(amount || 0);
  return n.toLocaleString('en-KW', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' د.ك';
}

export function hasSession() {
  return !!(state.token && state.user?.email);
}

// فلتر نطاق تاريخ مشترك — نُقل من fleet-vehicles.js (Stage 3) لهنا عشان
// الداشبورد (Phase 7) يعيد استخدام نفس منطق الحساب بالظبط، مش نسخة يدوية
// موازية. preset='all' (كل الوقت) = بدون فلتر، تراكمي كامل.
export function periodRange(preset, from, to) {
  if (preset === 'custom') return (from && to) ? { from, to } : null;
  if (preset === 'all') return null;
  const end = new Date();
  const start = new Date();
  if (preset === '3m') start.setMonth(start.getMonth() - 3);
  if (preset === '1y') start.setFullYear(start.getFullYear() - 1);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export function inRange(dateStr, range) {
  if (!range) return true;
  if (range.from && dateStr < range.from) return false;
  if (range.to && dateStr > range.to) return false;
  return true;
}

// إعادة بناء مستقلة لنفس منطق logout() في js/core.js (بدون import منه) —
// فليت مالهاش شاشة لوجين خاصة بيها، فالخروج هنا معناه مسح الجلسة والرجوع
// لصفحة اللوجين الرئيسية مباشرة (مش إخفاء/إظهار شاشات محلية زي الأصل).
export function fleetLogout() {
  localStorage.removeItem('tm_token');
  localStorage.removeItem('tm_refresh');
  localStorage.removeItem('tm_user');
  window.location.href = '/';
}
