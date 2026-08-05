#!/usr/bin/env node
// بيئة Node بلا متصفح لاستيراد الوحدات الحقيقية للتطبيق (core.js/permissions.js/
// periods.js/utils.js/engine.js/operations.js) وتشغيل دوالها الفعلية — بلا DOM حقيقي،
// عبر polyfills خفيفة (document/localStorage/sessionStorage/window كـglobalThis).
//
// الهدف: مجموعات اختبار الانحدار (scripts/regression-*.js) تستدعي الكود الإنتاجي
// الحقيقي (postDoubleEntry, updateJEInPlace, voidTransaction, je_payment, je_expense,
// je_collection, je_payout, _processEditApproval, _processReversalApproval...) بدل
// إعادة كتابته يدويًا — أي تغيير حقيقي في هذه الدوال ينكشف تلقائيًا في الاختبار.
//
// ✅ engine.js وحدها فيها كود تهيئة صفحة عند نهاية الملف (login-form prefill,
// DOMContentLoaded wiring, serviceWorker unregister) داخل `(function init() {...})()`
// — مقترن بـDOM حقيقي بشكل لا يمكن تشغيله بلا متصفح فعلي. هذا الجزء بس يُقصّ عند
// الاستيراد (كل ما فوقه — كل الدوال المُصدَّرة الفعلية — يُستورد كما هو، بلا تعديل).
// لو تغيّرت بنية الملف بحيث `(function init() {` لم تعد موجودة، الاستيراد يفشل
// برسالة صريحة بدل صمت — حدّث marker أسفل عند الحاجة.
//
// باقي الملفات (core/permissions/periods/utils/lifecycle/transactions/operations)
// بلا أي كود تهيئة DOM خطير عند نهايتها (تحقّقنا فعليًا 2026-07-29) فتُستورد
// كاملة بلا أي تعديل.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = 'C:/Users/hamdy/Documents/tarnsit app/transitapp';

function stubEl() {
  return {
    value: '', checked: false, style: {}, textContent: '', innerHTML: '',
    onclick: null,
    addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  };
}

// ✅ getElementById بترجّع نفس العنصر دايمًا لنفس الـid (Map ثابتة) — بعكس
// stubEl() المباشرة (كائن جديد كل نداء). ضروري لأي اختبار محتاج يتحقق من
// حالة مشتركة عبر أكتر من نداء لنفس العنصر (زي طابور showConfirm الجديد —
// reports.js — اللي بيكتب على confirmDeleteOkBtn/CancelBtn من استدعاءين
// مختلفين ويحتاج يفضلوا نفس العنصر). أقرب لسلوك DOM حقيقي، مفيش أي كود حالي
// كان معتمد على عنصر جديد كل نداء (تحقّقنا — سويت الانحدار كامله بلا تغيير سلوك)
const _elCache = new Map();
function stableEl(id) {
  if (!_elCache.has(id)) _elCache.set(id, stubEl());
  return _elCache.get(id);
}

// ✅ مخزن حقيقي في الذاكرة (مش no-op) — Phase 2 محتاجة تتحكّم فعليًا في
// localStorage['tm_admin_post'] (entryStatus() في engine.js بتقرأه) لاختبار
// وضعي الإلغاء الاثنين (طلب مراجعة مقابل تنفيذ فوري)
function makeStorageStub() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
  };
}

function installPolyfills() {
  globalThis.window = globalThis;
  globalThis.localStorage   = makeStorageStub();
  globalThis.sessionStorage = makeStorageStub();
  globalThis.document = {
    getElementById: stableEl,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => stubEl(),
    addEventListener() {},
    body: stubEl(),
  };
  globalThis.addEventListener = function () {};
  installConfirmStub();
}

// ✅ showConfirm/showConfirmHtml — تُعرَّف فعليًا في js/reports.js:744 (فتحت
// modal حقيقي وتنتظر ضغطة زر — لا تُنادي onConfirm إلا من onclick حقيقي).
// إعادة تعيين globalThis.showConfirm بعد الاستيراد **لا تكفي** لأي دالة معرَّفة
// في *نفس ملف* reports.js (زي deletePayoutEntry) — الجافاسكريبت بيحل المعرِّف
// الحر lexically من نطاق الموديول أولاً (نفس الملف)، مش من الكائن العام، حتى
// لو الاتنين اسمهم زي بعض. اكتُشف حيًّا 2026-07-29 (كل سيناريوهات Phase 2 لـ
// partner_payouts كانت بترجع بلا أي تغيير، بصمت، بدون أي toast — الـstub
// المُعاد تعيينه في window كان شغّال لدوال settings.js العابرة للملفات بس،
// مش لـdeletePayoutEntry جوه نفس ملف reports.js). الحل الوحيد الموثوق: تعديل
// نص reports.js نفسه وقت الاستيراد (نفس أسلوب قصّ تذييل engine.js) — استبدال
// جسم الدالتين فقط بنداء لـ__autoConfirm المشتركة، بلا لمس الملف الأصلي على القرص.
//
// في السياق الآلي هنا نوافق تلقائيًا (نفّذ onConfirm فورًا) — الاختبارات لا
// تحتاج "تأكيد بصري"، وده بيخلي rejectItem/approveAll والدوال المشغِّلة للحذف
// (deletePaymentEntry وغيرها) الحقيقية قابلة للاستدعاء.
// ⚠️ الكود الحقيقي بينادي showConfirm(title,msg,onConfirm) من غير await —
// onConfirm نفسه async وبيشتغل في الخلفية. لازم أي سيناريو اختبار يستدعي
// trigger function زي deletePaymentEntry ثم await waitForLastConfirm() فورًا
// بعدها، وإلا الـassertions هتتنفّذ قبل ما الحذف/الإلغاء الفعلي يخلص.
let _lastConfirmPromise = Promise.resolve();
globalThis.__autoConfirm = (onConfirm) => { _lastConfirmPromise = Promise.resolve(onConfirm ? onConfirm() : undefined); };
function installConfirmStub() {
  globalThis.showConfirm     = (title, msg, onConfirm) => globalThis.__autoConfirm(onConfirm);
  globalThis.showConfirmHtml = (title, html, onConfirm) => globalThis.__autoConfirm(onConfirm);
  globalThis.__waitForLastConfirm = () => _lastConfirmPromise;
}

function u(p) { return 'file:///' + (ROOT + p).replace(/ /g, '%20'); }

async function loadStrippedEngine() {
  const src = fs.readFileSync(path.join(ROOT, 'js/engine.js'), 'utf8');
  const marker = '(function init() {';
  const idx = src.indexOf(marker);
  if (idx === -1) {
    throw new Error(
      'headless-app-env: لم يُعثر على marker "(function init() {" في js/engine.js — ' +
      'بنية الملف تغيّرت. حدّث الـmarker هنا قبل الوثوق في نتيجة أي اختبار انحدار.'
    );
  }
  const stripped = src.slice(0, idx) +
    '\n// [_headless-app-env.js: تذييل تهيئة الصفحة المقترن بـDOM اتحذف هنا للاختبار بلا متصفح]\n';
  const tmpFile = path.join(os.tmpdir(), `engine-headless-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(tmpFile, stripped, 'utf8');
  try {
    return await import('file:///' + tmpFile.replace(/\\/g, '/'));
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

async function loadPatchedReports() {
  const src = fs.readFileSync(path.join(ROOT, 'js/reports.js'), 'utf8');
  // ✅ مطابقة عبر توقيع الدالة + regex لجسمها (بدل نص كامل ثابت) — النص الكامل
  // بيحتوي تعليقات عربية بعلامات تشكيل ممكن تختلف في الترميز (NFC/NFD) بين نسخ
  // مختلفة من نفس الملف حرفيًا بصريًا، فمطابقة exact-string كانت بتفشل بصمت
  // (اكتُشف حيًّا 2026-07-29). \n\} (قوس إغلاق وحيد في بداية سطر) موثوق بما إن
  // القوس الداخلي الوحيد جوه الجسم (btn.onclick = async () => {...};) على نفس
  // السطر مع كود تاني، مش وحيد على سطره.
  // ✅ التوقيع اتغيّر (onCancel/beforeShow جداد — طابور showConfirm الحقيقي،
  // راجع project_ui_restructure_needed_warnings_approvals) — الـregex هنا
  // لازم يتابع نفس التوقيع بالظبط، وإلا loadApp() كله بيفشل (الفحص الصريح تحت)
  const reSC  = /export function showConfirm\(title, msg, onConfirm, onCancel, beforeShow\) \{[\s\S]*?\n\}/;
  const reSCH = /export function showConfirmHtml\(title, htmlMsg, onConfirm, onCancel, beforeShow\) \{[\s\S]*?\n\}/;
  if (!reSC.test(src) || !reSCH.test(src)) {
    throw new Error(
      'headless-app-env: توقيع showConfirm/showConfirmHtml في js/reports.js تغيّر عن ' +
      'المتوقَّع هنا — حدّث reSC/reSCH في loadPatchedReports() قبل الوثوق في نتيجة أي ' +
      'اختبار انحدار يستخدم reports.js (deletePayoutEntry وغيرها).'
    );
  }
  const patched = src
    .replace(reSC,  `export function showConfirm(title, msg, onConfirm, onCancel, beforeShow) { globalThis.__autoConfirm(onConfirm); }`)
    .replace(reSCH, `export function showConfirmHtml(title, htmlMsg, onConfirm, onCancel, beforeShow) { globalThis.__autoConfirm(onConfirm); }`);
  const tmpFile = path.join(os.tmpdir(), `reports-headless-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(tmpFile, patched, 'utf8');
  try {
    return await import('file:///' + tmpFile.replace(/\\/g, '/'));
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

/**
 * يحمّل الوحدات الحقيقية بترتيب index.html (core → permissions → periods → utils
 * → engine → operations) ويرجّع كل الـexports + state. استدعِها مرة واحدة في بداية
 * أي سكريبت اختبار.
 */
async function loadApp() {
  installPolyfills();
  const core        = await import(u('/js/core.js'));
  const permissions  = await import(u('/js/permissions.js'));
  const periods      = await import(u('/js/periods.js'));
  const utils        = await import(u('/js/utils.js'));
  const lifecycle    = await import(u('/js/lifecycle.js'));
  const engine       = await loadStrippedEngine();
  // ✅ transactions.js: je_purchase (engine.js) بتستخدم getAccountName (المُصدَّرة
  // من هنا كـglobal) لاسم حساب 1300 — لازم تُحمَّل قبل استدعاء je_purchase.
  // تحقّقنا (2026-07-29): بلا أي كود تهيئة مقترن بـDOM عند نهايتها (Object.assign
  // bridge بس)، فتُستورد كاملة بلا تعديل زي operations.js بالضبط.
  const transactions = await import(u('/js/transactions.js'));
  // ✅ accounting.js: apiDelete (deletePayoutEntry بتستخدمها لحذف draft مباشرة)
  // مُصدَّرة من هنا، مش core.js. بلا كود تهيئة مقترن بـDOM عند نهايتها (تحقّقنا)
  const accounting   = await import(u('/js/accounting.js'));
  // ✅ reports.js (deletePayoutEntry) وsettings.js (deletePaymentEntry/
  // deleteExpenseEntry/deleteCollectionEntry) — Phase 2. reports.js تحديدًا
  // تُستورد عبر loadPatchedReports() (راجع تعليقها) لأنها الملف الوحيد اللي
  // بيعرِّف showConfirm الحقيقية جوه نفس ملف الدالة المُختبَرة (deletePayoutEntry)
  const reports      = await loadPatchedReports();
  const settings     = await import(u('/js/settings.js'));
  const operations   = await import(u('/js/operations.js'));
  // ✅ search.js: _escHtml (approveAll بتستخدمها لبناء نص نتائج الموافقة
  // الجماعية) مُصدَّرة من هنا، مش core.js/operations.js. بلا كود تهيئة مقترن
  // بـDOM عند نهايتها (Object.assign bridge بس، تحقّقنا) — بتُحمَّل بعد
  // operations.js في index.html الحقيقي كمان، لكن الترتيب هنا مش مهم
  // (بتُستخدَم وقت التشغيل بس، مش وقت تحميل الموديول)
  const search       = await import(u('/js/search.js'));

  // ✅ إعادة تثبيت — reports.js دهس الـstub بالتعريف الحقيقي في تذييله، راجع
  // تعليق installConfirmStub فوق
  installConfirmStub();

  core.state.system = 'BOX';
  core.state.user    = { email: 'zztest-regression@headless.local' };
  // ✅ token يفضل null → headers() (core.js) يقع تلقائيًا على anon key — نفس
  // سلوك تطبيق حقيقي بلا جلسة، وتحقّقنا 2026-07-29 إن الـRLS تسمح بالكتابة بيه

  return {
    core, permissions, periods, utils, lifecycle, engine, transactions, accounting, reports, settings, operations, search,
    state: core.state,
    waitForLastConfirm: () => globalThis.__waitForLastConfirm(),
  };
}

module.exports = { loadApp };
