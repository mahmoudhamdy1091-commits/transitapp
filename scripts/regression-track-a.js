#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════
// Track A — Phase 0: Regression Suite
// ════════════════════════════════════════════════════════════════════════
// سويت اختبار انحدار دائم لحماية Phase 1 (توحيد قرار "تعديل سجل مُعتمَد" وإلغائه)
// قبل أي تعديل على الكود المشترك — راجع project_dashboard_purchase_kpi_fix_and_track_a_scope
// و project_full_cost_lifecycle_session_2026-07-28 في الذاكرة.
//
// الاستخدام:
//   node scripts/regression-track-a.js
//
// ── التصميم (اقرأ قبل الثقة في النتيجة) ──
// يستخدم بيانات ZZTEST-* حقيقية عبر apiPost/apiPatch (anon key، الكتابة مسموحة
// فعليًا حسب RLS — تحقّقنا حيًّا 2026-07-29)، وتنظيف تلقائي في finally بـref_id/
// entry_no فقط (لا ref_table)، حتى لو فشل أي اختبار.
//
// كل ما يمس "منطق محاسبي حقيقي" (ترحيل قيد، عكسه، تحديثه، اعتماد تعديل) يستدعي
// **الكود الإنتاجي الفعلي** بلا تعديل (عبر scripts/_headless-app-env.js):
//   postDoubleEntry, je_payment, je_expense, je_collection, je_payout,
//   updateJEInPlace, voidTransaction, _processEditApproval (operations.js),
//   _processReversalApproval (operations.js)
// هذه أهم نقطة: أي regression حقيقي في هذه الدوال بعد Phase 1 سينكشف هنا تلقائيًا.
//
// الاستثناء الوحيد: "قرار الحفظ" نفسه (wasPosted ? pending_edit : draft) وقرارات
// الرفض/طلب الإلغاء البسيطة — هذه تحديدًا هي الأماكن المُكرَّرة يدويًا 5 مرات
// (settings.js×3 لـpayments/expenses/collections، dashboard.js×1 لـpartner_payouts،
// operations.js×1 لـsales) واللي Phase 1 وحّدها في js/lifecycle.js. بما إن الدوال
// الحاملة لها (submitEditPayment وغيرها) بتقرأ من DOM مباشرة (el('...').value)،
// مش قابلة للاستدعاء بلا متصفح حقيقي — فهذا القرار (سطر واحد بسيط لكل حالة) كان
// مُقلَّدًا هنا يدويًا (inline داخل كل دالة سيناريو، لا دوال منفصلة بأسماء خاصة)،
// مع إشارة صريحة لرقم السطر المصدري اللي بيقلّده. **بعد Phase 1** (نُفِّذ فعليًا):
// السيناريوهات دلوقتي بتستورد js/lifecycle.js الحقيقي مباشرة (راجع فحص
// "lifecycle.js / ... جدول الحقيقة الكامل" أسفل) — يقفل آخر فجوة تقليد.
//
// ── التغطية ──
// payments/expenses/collections/partner_payouts × 6 سيناريوهات = 24 حالة، +
// purchase_orders × 3 سيناريوهات (S1-S3 بس — إضافة Phase 1 Step B، تغطي بالظبط
// العلة اللي submitEditFileFull كانت بتقع فيها). المجموع 27 + فحص lifecycle.js.
// sales غير مغطاة بعد: post_sale_je (RPC) يعتمد على متوسط COGS عبر باقي شاحنات
// الملف — يحتاج fixture أكبر (سند شراء + عدة شاحنات)، هيُضاف كامتداد منفصل.
// purchase_orders S4-S6 (رفض/إلغاء) غير مغطاة: voidPurchaseOrder آلية منفصلة
// تمامًا عن voidTransaction (Track C، مش جزء من Phase 1).
//
// ✅ توزيع مصروف بالتساوي بين شركاء مختارين يدويًا (paid_by_split، expenses فقط)
// — 12 سيناريو إضافي (ES1-ES12): إنشاء موزَّع (قسمة متساوية/كسر أصلي)، موافقة
// draft موزَّع، 4 انتقالات فرد↔موزَّع عبر routingChanged، تعديل تاريخ فقط،
// إلغاء موزَّع (2 و3 شركاء)، انحدار على إلغاء مصروف فردي غير-صندوق بعد إعادة
// كتابة voidTransaction، وتجميع computePartnerSettlement. راجع التعليق التوثيقي
// أعلى قسم "EXPENSES — توزيع مصروف بالتساوي" لتفاصيل التصميم.
//
// ✅ دعم الصندوق/صندوق الترانزيت داخل التوزيع المتساوي — 5 سيناريوهات إضافية
// (ET1-ET5): إنشاء صندوق+شريك (زوجي وكسر أصلي)، تعديل (الصندوق ينضم لمجموعة
// موزَّعة قائمة)، إلغاء موزَّع مختلط الحسابات (1110/1120 + 2400 معًا)، وتجميع
// computePartnerSettlement على ملف معزول. راجع قسم "EXPENSES — دعم الصندوق..."
// لتفاصيل التصميم (كل عنصر في paidBySplit يُفحص بـ_isPartnerPocket مستقلاً).

const { loadApp } = require('./_headless-app-env.js');

// ✅ استثناء/رفض غير مُمسوك في أي مكان (خارج try/catch سيناريو معين — زي
// onclick غير مُنتظَر داخل _runConfirm) كان بيقتل العملية بصمت بلا أي أثر —
// اكتُشف حيًّا 2026-08-07 أثناء بناء IDEM2B. حارس صريح هنا بدل عملية تموت
// فجأة بلا تفسير في منتصف السويت
process.on('unhandledRejection', (reason) => {
  console.error('\n💥 UNHANDLED REJECTION (السويت هيكمل، لكن ده لازم يتصلّح):', reason && reason.stack || reason);
});
process.on('uncaughtException', (e) => {
  console.error('\n💥 UNCAUGHT EXCEPTION:', e && e.stack || e);
  process.exit(1);
});

const results = []; // {name, ok, error}
const cleanupOps = []; // [{table, match}] — يُنفَّذ بالعكس في finally

function record(name, ok, error) {
  results.push({ name, ok, error: error ? String(error.message || error) : null });
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ' — ' + (error?.message || error)}`);
}

async function scenario(name, fn) {
  try {
    await fn();
    record(name, true);
  } catch (e) {
    record(name, false, e);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
}

let app;
function apiPost(table, data) { return app.core.apiPost(table, data); }
function apiPatch(table, match, data) { return app.core.apiPatch(table, match, data); }
function apiGetAll(table, params) { return app.core.apiGetAll(table, params); }
function apiGet(table, params) { return app.core.apiGet(table, params); }
function apiDelete(table, params) {
  // core.js لا يُصدّر apiDelete صراحة في كل نسخة — نبني الاستدعاء يدويًا لو غاب
  if (typeof app.core.apiDelete === 'function') return app.core.apiDelete(table, params);
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return fetch(`${app.core.SB_URL || ''}/rest/v1/${table}?${qs}`, {
    method: 'DELETE', headers: app.core.headers(),
  });
}

const SYS = 'BOX';
const FILE_NO = 'ZZTEST-TRACKA-' + Date.now();
// ✅ سيناريوهات purchase_orders (Step B) كل واحد لازم file_no مستقل خاص بيه
// (السند = سجل الملف نفسه، مش ممكن نكرر نفس FILE_NO فوق) — بتتسجل هنا عشان
// التنظيف يغطّي قيودها كمان، مش بس FILE_NO الأساسي
const extraFileNos = [];

function registerCleanup(table, id) { cleanupOps.push({ table, id }); }
function registerExtraFileNo(fn) { extraFileNos.push(fn); }

async function runCleanup() {
  console.log('\n── تنظيف بيانات ZZTEST (بـref_id/id فقط، بدون ref_table) ──');
  // 1. كل قيود journal_entries المرتبطة بـFILE_NO الأساسي + أي file_no فرعي (purchase_orders)
  const allFileNos = [FILE_NO, ...extraFileNos];
  for (const fn of allFileNos) {
    const jeByFile = await apiGetAll('journal_entries', {
      select: 'id', system_type: `eq.${SYS}`, file_no: `eq.${fn}`,
    }).catch(() => []);
    for (const je of (jeByFile || [])) {
      await apiDelete('journal_entries', { id: `eq.${je.id}` }).catch(() => {});
    }
  }
  // 2. السجلات التشغيلية نفسها (بالعكس، احتياطًا لأي ترتيب اعتمادية)
  for (const op of cleanupOps.reverse()) {
    await apiDelete(op.table, { id: `eq.${op.id}` }).catch(() => {});
  }
  // 3. تحقق نهائي: مفيش أي قيد باقٍ بأي file_no تجريبي
  let leftoverTotal = 0;
  for (const fn of allFileNos) {
    const leftover = await apiGetAll('journal_entries', {
      select: 'id', system_type: `eq.${SYS}`, file_no: `eq.${fn}`,
    }).catch(() => []);
    leftoverTotal += (leftover || []).length;
  }
  if (leftoverTotal) {
    console.log(`⚠️ تحذير: ${leftoverTotal} قيد لسه موجود بعد التنظيف عبر ${allFileNos.length} file_no تجريبي — راجع يدويًا`);
  } else {
    console.log(`✓ تأكدنا: صفر قيود متبقية عبر كل الـ${allFileNos.length} file_no التجريبية`);
  }
}

// ✅ اكتُشف حيًّا 2026-08-08: runCleanup() فوق بتنظّف بس بيانات *هذه* التشغيلة
// (عبر cleanupOps/extraFileNos المُسجَّلة أثناءها) — أي تشغيلة سابقة اتقطعت
// بكرش/هنج في النص (حصل فعليًا مرات كتير أثناء بناء IDEM2B) بتسيب بياناتها
// بلا تنظيف خالص، للأبد، لحد ما حد يلاحظ يدويًا. اتراكم كذا آلاف صف عبر BOX
// وTM كنتيجة (راجع sql/cleanup_zztest_regression_leftovers_2026-08-08.sql
// للتنظيف التاريخي لمرة واحدة، نُفِّذ يدويًا من المستخدم).
//
// الحل البنيوي: sweep استباقي بيشتغل في *بداية* أي تشغيلة جديدة للسويت، قبل
// أي سيناريو، بيمسح أي بقايا ZZTEST-* من أي تشغيلة سابقة (مش بس تشغيلتنا
// الحالية) — عبر DELETE واحد جماعي لكل جدول (WHERE file_no LIKE 'ZZTEST-%')
// بدل حذف صف-صف (أسرع بكتير مع الحجوم الكبيرة دي). نفس ترتيب الاعتمادية
// المستخدَم في ملف الـSQL: journal_entries/audit_log أولاً (بلا مرجعية عكسية)،
// بعدين الجداول التفصيلية، بعدين sales/vehicles/partners_master، وأخيرًا
// purchase_orders (الأب اللي باقي الجداول عندها FK على file_no بتاعه).
async function sweepZZTestLeftovers() {
  const tables = [
    'journal_entries', 'audit_log', 'expenses', 'payments', 'collections',
    'partner_payouts', 'sales', 'vehicles', 'partners_master', 'purchase_orders',
  ];
  console.log('\n── sweep استباقي: تنظيف بقايا ZZTEST من تشغيلات سابقة اتقطعت ──');
  for (const t of tables) {
    try {
      const res = await apiDelete(t, { file_no: 'like.ZZTEST-*' });
      if (res && typeof res.ok === 'boolean' && !res.ok) {
        console.log(`  ⚠️ ${t}: فشل الحذف الجماعي (HTTP ${res.status})`);
      }
    } catch (e) {
      console.log(`  ⚠️ ${t}: خطأ أثناء الحذف الجماعي — ${e.message}`);
    }
  }
  console.log('  ✓ اكتمل sweep البداية');
}

// ════════════════════════════════════════════════════════════════════════
// ENTITY CONFIGS
// ════════════════════════════════════════════════════════════════════════
function buildEntityConfigs(app) {
  const { je_payment, je_expense, je_collection, je_payout, updateJEInPlace, voidTransaction } = app.engine;
  const { _processEditApproval, _processReversalApproval } = app.operations;

  return [
    {
      label: 'payments',
      table: 'payments',
      dateField: 'pay_date',
      editType: 'payment_edit',
      srcType: 'payment',
      // ✅ لا عمود "supplier" فعليًا على جدول payments (تحقّقنا حيًّا من الأعمدة
      // الحقيقية) — je_payment بتاخد اسم المورد كـparam منفصل (supplierName)، مش من عمود على السجل
      baseFields: (amount) => ({
        pay_id: zid('PMT'), ref_no: zid('PMT'),
        payer: 'ZZTEST-TREASURY-PAYER', pay_method: 'تحويل بنكي',
        pay_date: today(), amount, notes: 'ZZTEST regression',
      }),
      postJE: (row) => je_payment({
        sys: SYS, date: row.pay_date, amount: +row.amount, fileNo: FILE_NO, refId: row.id,
        supplierName: 'ZZTEST-SUPPLIER', payerName: row.payer, method: row.pay_method,
      }),
      // ✅ Phase 2 — الدالة المُشغِّلة الحقيقية (settings.js:1182). لا await على
      // النداء نفسه (نفس استخدام onclick الحقيقي) — الانتظار الفعلي عبر waitForLastConfirm
      // ⚠️ لازم await على النداء نفسه أولًا — الدالة async وفيها await (apiGetAll)
      // قبل ما توصل لـshowConfirm، فلو مانتظرناش دلوقتي waitForLastConfirm()
      // ممكن يمسك القيمة القديمة (سباق حقيقي، اكتُشف أثناء بناء Phase 2)
      deleteFn: async (app, id, fileNo) => { await app.settings.deletePaymentEntry(id, fileNo); await app.waitForLastConfirm(); },
    },
    {
      label: 'expenses',
      table: 'expenses',
      dateField: 'exp_date',
      editType: 'expense_edit',
      srcType: 'expense',
      baseFields: (amount) => ({
        exp_id: zid('EXP'), ref_no: zid('EXP'), pay_id: zid('EXP'),
        description: 'ZZTEST regression expense', exp_type: 'أخرى', pay_method: 'تحويل بنكي',
        exp_date: today(), amount, paid_by: null, notes: 'ZZTEST regression',
      }),
      postJE: (row) => je_expense({
        sys: SYS, date: row.exp_date, amount: +row.amount, fileNo: FILE_NO, refId: row.id,
        desc: row.description, expType: row.exp_type, method: row.pay_method, paidBy: row.paid_by,
      }),
      // ✅ Phase 2 — settings.js:1216
      deleteFn: async (app, id, fileNo) => { await app.settings.deleteExpenseEntry(id, fileNo); await app.waitForLastConfirm(); },
    },
    {
      label: 'collections',
      table: 'collections',
      dateField: 'paid_date',
      editType: 'collection_edit',
      srcType: 'collection',
      // ✅ settings.js:1433 (submitEditCollection) — الشرط الحقيقي أدقّ من باقي
      // الأنواع: يتطلب paid_date موجود كمان (تحصيل مستحق بلا paid_date، حتى لو
      // posted، معناه لسه معلّق ومفيهوش قيد فعلي) — نقلّد النسخة الكاملة هنا
      baseFields: (amount) => ({
        pay_id: zid('COL'), ref_no: zid('COL'),
        customer: 'ZZTEST-CUSTOMER', inv_no: 'ZZTEST-INV', pay_method: 'تحويل بنكي',
        due_date: today(), paid_date: today(), amount, received_by: null, notes: 'ZZTEST regression',
      }),
      postJE: (row) => je_collection({
        sys: SYS, date: row.paid_date, amount: +row.amount, fileNo: FILE_NO, refId: row.id,
        customer: row.customer, invNo: row.inv_no, method: row.pay_method, receivedBy: row.received_by,
      }),
      // ✅ Phase 2 — settings.js:1242. تتفرّع على paid_date لا post_status (راجع
      // ملاحظة Phase 2 التوثيقية) — نفس الدالة، فحصها جزء من نفس السويت
      deleteFn: async (app, id, fileNo) => { await app.settings.deleteCollectionEntry(id, fileNo); await app.waitForLastConfirm(); },
    },
    {
      label: 'partner_payouts',
      table: 'partner_payouts',
      dateField: 'pay_date',
      editType: 'payout_edit',
      srcType: 'payout',
      baseFields: (amount) => ({
        pay_id: zid('POU'),
        partner: 'ZZTEST-PARTNER', payout_type: 'ربح', pay_method: 'تحويل بنكي',
        pay_date: today(), amount, notes: 'ZZTEST regression',
      }),
      postJE: (row) => je_payout({
        sys: SYS, date: row.pay_date, amount: +row.amount, fileNo: FILE_NO, refId: row.id,
        partner: row.partner, method: row.pay_method,
      }),
      // ✅ Phase 2 — reports.js:822. الدالة الوحيدة من الأربعة بفرع draft/posted
      // صريح وصحيح بالفعل — مرجع الهدف اللي باقي الثلاثة لازم يتوحّدوا معاه
      deleteFn: async (app, id, fileNo) => { await app.reports.deletePayoutEntry(id, fileNo); await app.waitForLastConfirm(); },
    },
  ];
}

function today() { return new Date().toISOString().slice(0, 10); }
function zid(prefix) { return `ZZTEST-${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`; }

// ════════════════════════════════════════════════════════════════════════
// SCENARIO IMPLEMENTATIONS (parameterized by entity config)
// ════════════════════════════════════════════════════════════════════════

// S1 — draft → edit → يفضل draft، بلا استدعاء updateJEInPlace، بلا أي قيد يُنشأ.
// يستخدم js/lifecycle.js الحقيقي (wasAlreadyPosted) — نفس الدالة المُستخدَمة الآن
// فعليًا في الأربعة مواقع (settings.js×3، dashboard.js×1) بعد Phase 1.
async function s1_draftEditStaysDraft(cfg, app) {
  const row = await apiPost(cfg.table, {
    system_type: SYS, file_no: FILE_NO, post_status: 'draft', ...cfg.baseFields(100),
  });
  const created = row[0];
  registerCleanup(cfg.table, created.id);

  const wasPosted = app.lifecycle.wasAlreadyPosted(created.post_status);
  assert(wasPosted === false, 'precondition: سجل draft لازم wasPosted=false');
  // الفرع "لسه draft" الحقيقي (settings.js/dashboard.js) — PATCH مباشر بلا لمس أي قيد
  await apiPatch(cfg.table, { id: `eq.${created.id}` }, { amount: 150 });

  const after = (await apiGetAll(cfg.table, { select: '*', id: `eq.${created.id}` }))[0];
  assert(after.post_status === 'draft', `المتوقع يفضل draft، طلع ${after.post_status}`);

  const jeCount = await apiGetAll('journal_entries', {
    select: 'id', system_type: `eq.${SYS}`, ref_table: `eq.${cfg.table}`, ref_id: `eq.${created.id}`,
  });
  assert((jeCount || []).length === 0, `المتوقع صفر قيود، طلع ${jeCount.length}`);
}

// S2 — posted → edit → يترقّى pending_edit، القيد الحقيقي يتحدّث فعليًا (updateJEInPlace حقيقية)
async function s2_postedEditPromotes(cfg, app) {
  const row = await apiPost(cfg.table, {
    system_type: SYS, file_no: FILE_NO, post_status: 'posted', ...cfg.baseFields(200),
  });
  const created = row[0];
  registerCleanup(cfg.table, created.id);
  // ✅ لا نعتمد على قيمة الإرجاع من postJE — je_payout (engine.js:1011-1018) ناقصة
  // `return` قبل `await postDoubleEntry(...)` (بعكس je_payment/je_expense/je_collection
  // الشقيقة، كلها بترجع {entryNo,ids} فعليًا) فترجع دايمًا undefined. اكتُشف هنا
  // 2026-07-29 أثناء بناء هذا السويت — غير مؤثر فعليًا في الإنتاج (كل الـ8 مواقع
  // استدعاء الحقيقية بتستخدم `await je_payout(...)` بلا التقاط القيمة المرجعة أصلًا)،
  // لكنه تضارب حقيقي في العقد بين je_* الأربعة يستحق تسجيله (Track B مرشّح، ليس Track A).
  // التحقق هنا بالتالي بالاستعلام المباشر بدل الاعتماد على قيمة الإرجاع.
  await cfg.postJE(created);
  const jeCheck = await apiGetAll('journal_entries', {
    select: 'id', system_type: `eq.${SYS}`, ref_table: `eq.${cfg.table}`, ref_id: `eq.${created.id}`, post_status: 'eq.posted',
  });
  assert((jeCheck || []).length > 0, 'فشل إنشاء القيد الأولي (postJE) — لا سطور posted');

  const wasPosted = app.lifecycle.wasAlreadyPosted(created.post_status);
  assert(wasPosted === true, 'precondition: سجل posted لازم wasPosted=true');
  await apiPatch(cfg.table, { id: `eq.${created.id}` }, { amount: 250, post_status: app.lifecycle.statusAfterEdit(created.post_status) });
  await app.engine.updateJEInPlace({
    sys: SYS, fileNo: FILE_NO, refTable: cfg.table, refId: created.id,
    oldAmount: 200, newAmount: 250,
  });

  const after = (await apiGetAll(cfg.table, { select: '*', id: `eq.${created.id}` }))[0];
  assert(after.post_status === 'pending_edit', `المتوقع pending_edit، طلع ${after.post_status}`);

  const jeLines = await apiGetAll('journal_entries', {
    select: 'dr_amount,cr_amount,post_status', system_type: `eq.${SYS}`,
    ref_table: `eq.${cfg.table}`, ref_id: `eq.${created.id}`, post_status: 'eq.posted',
  });
  const activeAmt = Math.max(...jeLines.map(l => Math.max(+l.dr_amount || 0, +l.cr_amount || 0)));
  assert(Math.abs(activeAmt - 250) < 0.01, `المتوقع القيد الفعلي = 250، طلع ${activeAmt}`);
  return created.id; // يُستخدم في S3
}

// S3 — pending_edit → موافقة → posted، بلا تكرار قيد (_processEditApproval حقيقية)
async function s3_pendingEditApprove(cfg, app) {
  const row = await apiPost(cfg.table, {
    system_type: SYS, file_no: FILE_NO, post_status: 'posted', ...cfg.baseFields(300),
  });
  const created = row[0];
  registerCleanup(cfg.table, created.id);
  await cfg.postJE(created);
  await apiPatch(cfg.table, { id: `eq.${created.id}` }, { amount: 350, post_status: 'pending_edit' });
  await app.engine.updateJEInPlace({
    sys: SYS, fileNo: FILE_NO, refTable: cfg.table, refId: created.id, oldAmount: 300, newAmount: 350,
  });

  const preApproval = (await apiGetAll(cfg.table, { select: '*', id: `eq.${created.id}` }))[0];
  const res = await app.operations._processEditApproval(cfg.editType, created.id, preApproval);
  assert(res.ok, `_processEditApproval فشلت: ${res.message}`);

  const after = (await apiGetAll(cfg.table, { select: '*', id: `eq.${created.id}` }))[0];
  assert(after.post_status === 'posted', `المتوقع posted، طلع ${after.post_status}`);

  const jeLines = await apiGetAll('journal_entries', {
    select: 'id', system_type: `eq.${SYS}`, ref_table: `eq.${cfg.table}`, ref_id: `eq.${created.id}`, post_status: 'eq.posted',
  });
  const maxAmts = await apiGetAll('journal_entries', {
    select: 'dr_amount,cr_amount', system_type: `eq.${SYS}`, ref_table: `eq.${cfg.table}`, ref_id: `eq.${created.id}`, post_status: 'eq.posted',
  });
  const activeAmt = Math.max(...maxAmts.map(l => Math.max(+l.dr_amount || 0, +l.cr_amount || 0)));
  assert(Math.abs(activeAmt - 350) < 0.01, `المتوقع القيد النهائي = 350 (لا تكرار)، طلع ${activeAmt}`);

  // idempotency: موافقة تانية على نفس السجل (already posted) لازم ترجع {already:true} بلا قيد إضافي
  const res2 = await app.operations._processEditApproval(cfg.editType, created.id, after);
  assert(res2.ok && res2.already, 'المتوقع idempotency: موافقة مكررة ترجع already=true بلا فعل شيء');
}

// S4 — draft → رفض → cancelled، بلا أي قيد كان له وجود من الأصل
// يقلّد operations.js:1859-1865 (الفرع else غير-purchase من rejectItem)
async function s4_draftReject(cfg) {
  const row = await apiPost(cfg.table, {
    system_type: SYS, file_no: FILE_NO, post_status: 'draft', ...cfg.baseFields(400),
  });
  const created = row[0];
  registerCleanup(cfg.table, created.id);

  await apiPatch(cfg.table, { id: `eq.${created.id}` }, {
    post_status: 'cancelled', notes: `${created.notes || ''} | مرفوض بتاريخ ${today()}`,
  });

  const after = (await apiGetAll(cfg.table, { select: '*', id: `eq.${created.id}` }))[0];
  assert(after.post_status === 'cancelled', `المتوقع cancelled، طلع ${after.post_status}`);
  const jeCount = await apiGetAll('journal_entries', {
    select: 'id', system_type: `eq.${SYS}`, ref_table: `eq.${cfg.table}`, ref_id: `eq.${created.id}`,
  });
  assert((jeCount || []).length === 0, `المتوقع صفر قيود (لم يوجد قيد من الأصل)، طلع ${jeCount.length}`);
}

// S5 — posted → طلب إلغاء → موافقة → voided + قيد عكسي صحيح
// طلب الإلغاء يقلّد engine.js:253-256 (فرع entryStatus()==='draft' داخل voidTransaction)؛
// الموافقة تستدعي _processReversalApproval الحقيقية (بتنادي voidTransaction(force=true) فعليًا)
async function s5_voidRequestApprove(cfg, app) {
  const row = await apiPost(cfg.table, {
    system_type: SYS, file_no: FILE_NO, post_status: 'posted', ...cfg.baseFields(500),
  });
  const created = row[0];
  registerCleanup(cfg.table, created.id);
  await cfg.postJE(created);

  // طلب الإلغاء (مقلَّد، engine.js:253-256)
  await apiPatch(cfg.table, { id: `eq.${created.id}` }, {
    post_status: 'pending_void', notes: `${created.notes || ''} | طلب إلغاء بتاريخ ${today()}`,
  });
  const pendingRow = (await apiGetAll(cfg.table, { select: '*', id: `eq.${created.id}` }))[0];
  assert(pendingRow.post_status === 'pending_void', 'precondition: لازم pending_void قبل الموافقة');

  // الموافقة — كود حقيقي 100%
  const res = await app.operations._processReversalApproval(created.id, { ...pendingRow, _srcType: cfg.srcType });
  assert(res.ok, `_processReversalApproval فشلت: ${res.message}`);

  const after = (await apiGetAll(cfg.table, { select: '*', id: `eq.${created.id}` }))[0];
  assert(after.post_status === 'voided', `المتوقع voided، طلع ${after.post_status}`);

  const reversalLines = await apiGetAll('journal_entries', {
    select: 'dr_amount,cr_amount,ref_table', system_type: `eq.${SYS}`,
    ref_table: `eq.reversal`, ref_id: `eq.${created.id}`, post_status: 'eq.posted',
  });
  assert((reversalLines || []).length >= 2, `المتوقع قيد عكسي (سطرين على الأقل)، طلع ${reversalLines.length}`);
  const drSum = reversalLines.reduce((s, l) => s + (+l.dr_amount || 0), 0);
  const crSum = reversalLines.reduce((s, l) => s + (+l.cr_amount || 0), 0);
  assert(Math.abs(drSum - crSum) < 0.01, `القيد العكسي غير متوازن: dr=${drSum} cr=${crSum}`);
  assert(Math.abs(drSum - 500) < 0.01, `المتوقع القيد العكسي = 500، طلع ${drSum}`);
}

// S6 — posted → طلب إلغاء → رفض → يرجع posted، بلا أي قيد يتيم
// طلب الإلغاء نفس S5؛ الرفض يقلّد operations.js:1811-1827 (فرع type==='reversal' في rejectItem)
async function s6_voidRequestReject(cfg, app) {
  const row = await apiPost(cfg.table, {
    system_type: SYS, file_no: FILE_NO, post_status: 'posted', ...cfg.baseFields(600),
  });
  const created = row[0];
  registerCleanup(cfg.table, created.id);
  await cfg.postJE(created);

  await apiPatch(cfg.table, { id: `eq.${created.id}` }, {
    post_status: 'pending_void', notes: `${created.notes || ''} | طلب إلغاء بتاريخ ${today()}`,
  });

  // الرفض (مقلَّد، operations.js:1821 — PATCH وحيد لـposted، بلا أي لمس للقيد)
  await apiPatch(cfg.table, { id: `eq.${created.id}` }, {
    post_status: 'posted', notes: `مُسترد — استُرد طلب الإلغاء بتاريخ ${today()}`,
  });

  const after = (await apiGetAll(cfg.table, { select: '*', id: `eq.${created.id}` }))[0];
  assert(after.post_status === 'posted', `المتوقع يرجع posted، طلع ${after.post_status}`);

  const reversalLines = await apiGetAll('journal_entries', {
    select: 'id', system_type: `eq.${SYS}`, ref_table: `eq.reversal`, ref_id: `eq.${created.id}`,
  });
  assert((reversalLines || []).length === 0, `المتوقع صفر قيود عكسية يتيمة، طلع ${reversalLines.length}`);

  const activeLines = await apiGetAll('journal_entries', {
    select: 'id', system_type: `eq.${SYS}`, ref_table: `eq.${cfg.table}`, ref_id: `eq.${created.id}`, post_status: 'eq.posted',
  });
  assert((activeLines || []).length >= 2, `المتوقع القيد الأصلي لسه فعّال (سطرين)، طلع ${activeLines.length}`);
}

// ════════════════════════════════════════════════════════════════════════
// PURCHASE_ORDERS (Step B) — نفس منطق S1/S2/S3 فوق، لكن السند هو سجل الملف
// نفسه (file_no مستقل لكل سيناريو، مش مشترك مع FILE_NO الأساسي). يغطي بالظبط
// العلة اللي submitEditFileFull (js/modals.js) كانت بتقع فيها قبل Step B:
// استدعاء updateJEInPlace بلا شرط حتى لو السند لسه draft. S4-S6 (رفض/إلغاء)
// غير مغطاة هنا — voidPurchaseOrder آلية منفصلة تمامًا عن voidTransaction
// (Track C، مش جزء من هذا الإصلاح).
// ════════════════════════════════════════════════════════════════════════

async function poS1_draftEditStaysDraft(app) {
  const poFileNo = zid('PO-S1');
  registerExtraFileNo(poFileNo);
  const row = await apiPost('purchase_orders', {
    system_type: SYS, file_no: poFileNo, supplier: 'ZZTEST-SUPPLIER', po_date: today(),
    total_purchase: 1000, post_status: 'draft', notes: 'ZZTEST regression PO',
  });
  const created = row[0];
  registerCleanup('purchase_orders', created.id);

  const wasPosted = app.lifecycle.wasAlreadyPosted(created.post_status);
  assert(wasPosted === false, 'precondition: سند draft لازم wasPosted=false');
  // الإصلاح الأساسي (Step B): بلا استدعاء updateJEInPlace خالص هنا
  await apiPatch('purchase_orders', { id: `eq.${created.id}` }, {
    total_purchase: 1500, post_status: app.lifecycle.statusAfterEdit(created.post_status),
  });

  const after = (await apiGetAll('purchase_orders', { select: '*', id: `eq.${created.id}` }))[0];
  assert(after.post_status === 'draft', `المتوقع يفضل draft، طلع ${after.post_status}`);
  const jeCount = await apiGetAll('journal_entries', {
    select: 'id', system_type: `eq.${SYS}`, ref_table: `eq.purchase_orders`, ref_id: `eq.${created.id}`,
  });
  assert((jeCount || []).length === 0, `المتوقع صفر قيود، طلع ${jeCount.length}`);
}

async function poS2_postedEditPromotes(app) {
  const poFileNo = zid('PO-S2');
  registerExtraFileNo(poFileNo);
  const row = await apiPost('purchase_orders', {
    system_type: SYS, file_no: poFileNo, supplier: 'ZZTEST-SUPPLIER', po_date: today(),
    total_purchase: 2000, post_status: 'posted', notes: 'ZZTEST regression PO',
  });
  const created = row[0];
  registerCleanup('purchase_orders', created.id);
  await app.engine.je_purchase({
    sys: SYS, date: created.po_date, amount: +created.total_purchase, fileNo: poFileNo,
    supplier: created.supplier, refId: created.id,
  });
  const jePrecheck = await apiGetAll('journal_entries', {
    select: 'id', system_type: `eq.${SYS}`, ref_table: `eq.purchase_orders`, ref_id: `eq.${created.id}`, post_status: 'eq.posted',
  });
  assert((jePrecheck || []).length > 0, 'فشل إنشاء القيد الأولي (je_purchase) — لا سطور posted');

  const wasPosted = app.lifecycle.wasAlreadyPosted(created.post_status);
  assert(wasPosted === true, 'precondition: سند posted لازم wasPosted=true');
  await apiPatch('purchase_orders', { id: `eq.${created.id}` }, {
    total_purchase: 2500, post_status: app.lifecycle.statusAfterEdit(created.post_status),
  });
  await app.engine.updateJEInPlace({
    sys: SYS, fileNo: poFileNo, refTable: 'purchase_orders', refId: created.id,
    oldAmount: 2000, newAmount: 2500,
  });

  const after = (await apiGetAll('purchase_orders', { select: '*', id: `eq.${created.id}` }))[0];
  assert(after.post_status === 'pending_edit', `المتوقع pending_edit، طلع ${after.post_status}`);
  const jeLines = await apiGetAll('journal_entries', {
    select: 'dr_amount,cr_amount', system_type: `eq.${SYS}`,
    ref_table: `eq.purchase_orders`, ref_id: `eq.${created.id}`, post_status: 'eq.posted',
  });
  const activeAmt = Math.max(...jeLines.map(l => Math.max(+l.dr_amount || 0, +l.cr_amount || 0)));
  assert(Math.abs(activeAmt - 2500) < 0.01, `المتوقع القيد الفعلي = 2500، طلع ${activeAmt}`);
  return created.id;
}

async function poS3_pendingEditApprove(app) {
  const poFileNo = zid('PO-S3');
  registerExtraFileNo(poFileNo);
  const row = await apiPost('purchase_orders', {
    system_type: SYS, file_no: poFileNo, supplier: 'ZZTEST-SUPPLIER', po_date: today(),
    total_purchase: 3000, post_status: 'posted', notes: 'ZZTEST regression PO',
  });
  const created = row[0];
  registerCleanup('purchase_orders', created.id);
  await app.engine.je_purchase({
    sys: SYS, date: created.po_date, amount: +created.total_purchase, fileNo: poFileNo,
    supplier: created.supplier, refId: created.id,
  });
  await apiPatch('purchase_orders', { id: `eq.${created.id}` }, {
    total_purchase: 3500, post_status: 'pending_edit',
  });
  await app.engine.updateJEInPlace({
    sys: SYS, fileNo: poFileNo, refTable: 'purchase_orders', refId: created.id, oldAmount: 3000, newAmount: 3500,
  });

  const preApproval = (await apiGetAll('purchase_orders', { select: '*', id: `eq.${created.id}` }))[0];
  const res = await app.operations._processEditApproval('purchase_edit', created.id, preApproval);
  assert(res.ok, `_processEditApproval فشلت: ${res.message}`);

  const after = (await apiGetAll('purchase_orders', { select: '*', id: `eq.${created.id}` }))[0];
  assert(after.post_status === 'posted', `المتوقع posted، طلع ${after.post_status}`);
  const maxAmts = await apiGetAll('journal_entries', {
    select: 'dr_amount,cr_amount', system_type: `eq.${SYS}`,
    ref_table: `eq.purchase_orders`, ref_id: `eq.${created.id}`, post_status: 'eq.posted',
  });
  const activeAmt = Math.max(...maxAmts.map(l => Math.max(+l.dr_amount || 0, +l.cr_amount || 0)));
  assert(Math.abs(activeAmt - 3500) < 0.01, `المتوقع القيد النهائي = 3500 (لا تكرار)، طلع ${activeAmt}`);
}

// ════════════════════════════════════════════════════════════════════════
// PHASE 2 — قرار "الحذف/الإلغاء" (draft→حذف مباشر بلا قيد، posted→voidTransaction)
// ════════════════════════════════════════════════════════════════════════
// يستدعي الدوال المُشغِّلة الحقيقية (deletePaymentEntry/deleteExpenseEntry/
// deleteCollectionEntry من settings.js، deletePayoutEntry من reports.js) —
// showConfirm مُعاد توجيهه تلقائيًا (_headless-app-env.js)، والانتظار الفعلي
// عبر app.waitForLastConfirm() بعد كل نداء (الدالة الحقيقية لا تنتظر showConfirm).
//
// الهدف الموثَّق من الجرد: سجل draft (بلا قيد خالص) لازم يتحذف مباشرة بغض النظر
// عن entryStatus() (وضع المستخدم العام لـ"ترحيل فوري")، لأن القرار ده خاص
// بحالة *السجل* نفسه لا بوضع المستخدم وقت الحذف. حاليًا:
//   - deletePayoutEntry (reports.js:822): صحيحة — فرع صريح posted/draft/غير كده
//   - deletePaymentEntry/deleteExpenseEntry: بلا أي فرع، بينادوا voidTransaction
//     دايمًا — سلوكهم لسجل draft يعتمد بالكامل على entryStatus() الحالي:
//       entryStatus()='posted' → voidTransaction تحاول تلاقي قيد فترمي خطأ
//         (مُمسوك داخليًا بـtoast) — السجل يفضل draft زي ما هو، بلا ضرر لكن UX سيئة
//       entryStatus()='draft'  → مسار "طلب" بلا أي فحص لوجود قيد أصلًا — السجل
//         يدخل pending_void بهدوء رغم عدم وجود قيد له خالص (الحالة الأخطر)
//   - deleteCollectionEntry (settings.js:1242): تتفرّع على paid_date لا
//     post_status — تُختبَر بحالتين: draft+paid_date موجود (نفس فجوة
//     payments/expenses بالضبط، لأن paid_date وحده لا يضمن وجود قيد فعلي)،
//     وdraft بلا paid_date (المسار "الآمن" الحالي، لكن نهايته "voided" بـPATCH
//     مباشر، مش حذف حقيقي زي deletePayoutEntry — سؤال تصميم مفتوح لم يُحسم
//     بعد، مُسجَّل هنا بدون افتراض إجابة، القرار يُترك لخطوة التنفيذ الفعلية)

// ✅ role='admin' دايمًا — accounting.js's apiDelete (اللي deletePayoutEntry بتستخدمها
// لحذف draft) عندها حارس صلاحية can('delete') منفصل تمامًا عن entryStatus()، وROLES
// بتاعت readonly/employee كلاهما delete:false. لو غيّرنا الدور لـ'readonly' لاختبار
// entryStatus()='draft'، الحارس ده كان بيمنع الحذف قبل ما نوصل لمنطق entryStatus()
// أصلًا (اكتُشف حيًّا 2026-07-29 — رسالة "🔒 ليس لديك صلاحية الحذف" مش من منطق
// الحذف نفسه). الدور والـentryStatus() محورين منفصلين فعليًا — admin ثابت هنا
// يعزل تأثير tm_admin_post وحده، وهو الشيء المطلوب اختباره فعلًا.
function setEntryStatus(app, mode) {
  app.permissions.setCurrentRole('admin');
  globalThis.localStorage.setItem('tm_admin_post', mode === 'posted' ? 'posted' : 'draft');
}

// سجل draft (بلا قيد) — يُختبَر تحت وضعي entryStatus() الاثنين
async function p2_draftDelete(cfg, app, entryMode) {
  setEntryStatus(app, entryMode);
  // ✅ مبلغ مختلف حسب entryMode — لو السجل الأول لم يُحذف فعليًا (العلة قيد
  // الفحص) لا يصطدم بحارس التكرار الحقيقي في apiPost (core.js:601) مع السجل الثاني
  const amt = entryMode === 'posted' ? 701 : 700;
  const row = await apiPost(cfg.table, {
    system_type: SYS, file_no: FILE_NO, post_status: 'draft', ...cfg.baseFields(amt),
  });
  const created = row[0];
  registerCleanup(cfg.table, created.id);

  await cfg.deleteFn(app, created.id, FILE_NO);

  const after = (await apiGetAll(cfg.table, { select: '*', id: `eq.${created.id}` }))[0];
  const jeCount = await apiGetAll('journal_entries', {
    select: 'id', system_type: `eq.${SYS}`, ref_table: `eq.${cfg.table}`, ref_id: `eq.${created.id}`,
  });
  assert((jeCount || []).length === 0, `[entryMode=${entryMode}] المتوقع صفر قيود لسجل draft، طلع ${jeCount.length}`);
  assert(!after, `[entryMode=${entryMode}] المتوقع حذف مباشر لسجل draft (السطر يختفي)، لكنه لسه موجود بحالة "${after?.post_status}"`);
}

// سجل posted (بقيد حقيقي) — المسار السعيد الحالي، لازم يفضل شغّال بعد أي توحيد لاحق
async function p2_postedDelete(cfg, app) {
  setEntryStatus(app, 'posted'); // تنفيذ فوري، نتأكد من مسار العكس الفعلي مباشرة
  const row = await apiPost(cfg.table, {
    system_type: SYS, file_no: FILE_NO, post_status: 'posted', ...cfg.baseFields(800),
  });
  const created = row[0];
  registerCleanup(cfg.table, created.id);
  await cfg.postJE(created);

  await cfg.deleteFn(app, created.id, FILE_NO);

  const after = (await apiGetAll(cfg.table, { select: '*', id: `eq.${created.id}` }))[0];
  assert(after && after.post_status === 'voided', `المتوقع voided، طلع ${after?.post_status}`);
  const reversalLines = await apiGetAll('journal_entries', {
    select: 'dr_amount,cr_amount', system_type: `eq.${SYS}`,
    ref_table: `eq.reversal`, ref_id: `eq.${created.id}`, post_status: 'eq.posted',
  });
  assert((reversalLines || []).length >= 2, `المتوقع قيد عكسي متوازن (سطرين على الأقل)، طلع ${reversalLines.length}`);
  const drSum = reversalLines.reduce((s, l) => s + (+l.dr_amount || 0), 0);
  const crSum = reversalLines.reduce((s, l) => s + (+l.cr_amount || 0), 0);
  assert(Math.abs(drSum - crSum) < 0.01, `القيد العكسي غير متوازن: dr=${drSum} cr=${crSum}`);
}

// collections فقط — حالة حافة: draft بلا paid_date (المسار الحالي "الآمن" —
// بيوثّق النتيجة الفعلية بدل افتراض إجابة، السؤال التصميمي لسه مفتوح)
// ✅ قرار سياسة اتحسم 2026-07-30: توحيد كامل — كلا الحالتين (draft، وposted
// بلا paid_date) لازم يتحذفوا حذفًا حقيقيًا زي باقي الكيانات، بلا استثناء
async function p2_collectionsNoPaidDate(app, status) {
  setEntryStatus(app, 'draft');
  const row = await apiPost('collections', {
    system_type: SYS, file_no: FILE_NO, post_status: status,
    pay_id: zid('COL'), ref_no: zid('COL'), customer: 'ZZTEST-CUSTOMER', inv_no: 'ZZTEST-INV',
    pay_method: 'تحويل بنكي', due_date: today(), paid_date: null, amount: 750, received_by: null,
    notes: 'ZZTEST regression',
  });
  const created = row[0];
  registerCleanup('collections', created.id);

  await app.settings.deleteCollectionEntry(created.id, FILE_NO);
  await app.waitForLastConfirm();

  const after = (await apiGetAll('collections', { select: '*', id: `eq.${created.id}` }))[0];
  const jeCount = await apiGetAll('journal_entries', {
    select: 'id', system_type: `eq.${SYS}`, ref_table: `eq.collections`, ref_id: `eq.${created.id}`,
  });
  assert((jeCount || []).length === 0, `المتوقع صفر قيود (لا paid_date، لا JE أصلًا)، طلع ${jeCount.length}`);
  assert(!after, `[status=${status}, بلا paid_date] المتوقع حذف حقيقي (قرار 2026-07-30)، لكن السطر لسه موجود بحالة "${after?.post_status}"`);
}

// ✅ فروع 'reject' الجديدة (Phase 2) — pending_edit له قيد حي فعلًا لكن تحت
// مراجعة تعديل بالفعل؛ الزر ده مش مكان التعامل معاه. سلوك جديد لـpayments/
// expenses/collections (متبنّى من deletePayoutEntry، المرجع الصحيح أصلًا)
async function p2_rejectPendingEdit(cfg, app) {
  setEntryStatus(app, 'draft');
  const row = await apiPost(cfg.table, {
    system_type: SYS, file_no: FILE_NO, post_status: 'pending_edit', ...cfg.baseFields(760),
  });
  const created = row[0];
  registerCleanup(cfg.table, created.id);
  await cfg.postJE(created); // pending_edit فعليًا له قيد حي — نتأكد إنه يفضل كده بعد الرفض

  await cfg.deleteFn(app, created.id, FILE_NO);

  const after = (await apiGetAll(cfg.table, { select: '*', id: `eq.${created.id}` }))[0];
  assert(after && after.post_status === 'pending_edit', `المتوقع يفضل pending_edit (الزر يرفض التعامل)، طلع ${after?.post_status}`);
  const jeLines = await apiGetAll('journal_entries', {
    select: 'id', system_type: `eq.${SYS}`, ref_table: `eq.${cfg.table}`, ref_id: `eq.${created.id}`, post_status: 'eq.posted',
  });
  assert((jeLines || []).length >= 2, `المتوقع القيد الحي يفضل كما هو (سطرين على الأقل)، طلع ${jeLines.length}`);
}

// ════════════════════════════════════════════════════════════════════════
// EXPENSES — توزيع مصروف بالتساوي بين شركاء مختارين يدويًا (paid_by_split)
// ════════════════════════════════════════════════════════════════════════
// يغطي: إنشاء موزَّع (قسمة متساوية/كسر أصلي)، موافقة draft موزَّع، الانتقالات
// الأربعة بين فرد↔موزَّع عبر routingChanged، تعديل تاريخ فقط (بلا عكس فعلي على
// القيمة)، إلغاء موزَّع (2 و3 شركاء)، إلغاء مصروف فردي غير-صندوق (انحدار على
// إعادة كتابة voidTransaction)، وتجميع computePartnerSettlement بعد كل هذا —
// كله عبر postDoubleEntry/je_expense/voidTransaction/updateJEInPlace/
// _createApprovalJE/computePartnerSettlement/computeEqualSplit/samePartnerSet
// الحقيقية بلا تعديل.
//
// ✅ simulateEditExpense تقلّد قلب submitEditExpense (settings.js) حرفيًا —
// الدالة الحقيقية DOM-مقترنة (el('ee-...').value)، غير قابلة للاستدعاء هنا
// مباشرة، تمامًا زي بقية "قرارات الحفظ" الموثَّقة أعلى الملف. لكن routingChanged
// نفسها محسوبة هنا عبر samePartnerSet الحقيقية من app.lifecycle (لا تقليد)،
// فالتحقق من "هل قرار المسار صح؟" حقيقي 100%، والتحقق من "هل نتيجة القيد
// النهائية صحيحة؟" (المُختبَر أسفل) مستقل تمامًا عن أي افتراض بخصوص الآلية.

const SPLIT_PARTNERS = ['ZZTEST-SPLIT-A', 'ZZTEST-SPLIT-B', 'ZZTEST-SPLIT-C'];

async function setupSplitPartnersFixture() {
  for (const name of SPLIT_PARTNERS) {
    const row = await apiPost('partners_master', {
      system_type: SYS, file_no: FILE_NO, partner: name, share_percent: 100 / SPLIT_PARTNERS.length,
    });
    registerCleanup('partners_master', row[0].id);
  }
}

function partnerSetOf(paidBy, paidBySplit) {
  return (Array.isArray(paidBySplit) && paidBySplit.length)
    ? paidBySplit.map(p => p.partner)
    : [paidBy || 'الصندوق'];
}

// ✅ نفس الأسطر بالحرف من fetchActiveExpenseEntryLines أسفل fetchExpenseJELines:
// أي مصروف اتعدَّل قبل كده (routingChanged=true) بيسيب أكتر من entry_no posted
// لنفس ref_id (القديم المُستبدَل + عكسه + الجديد) — لازم نضيّق على أحدث entry_no
// فعّال فقط (نفس منطق engine.js's voidTransaction المُعاد كتابته بالحرف)
async function fetchActiveExpenseEntryLines(id) {
  const lines = await apiGetAll('journal_entries', {
    select: 'id,entry_no,account_code,account_name,contact_name,dr_amount,cr_amount,entry_date',
    system_type: `eq.${SYS}`, ref_table: 'eq.expenses', ref_id: `eq.${id}`, post_status: 'eq.posted',
    order: 'id.desc',
  });
  const drLine = (lines || []).find(l => (+l.dr_amount || 0) > 0);
  if (!drLine) return [];
  return (lines || []).filter(l => l.entry_no === drLine.entry_no);
}

// ✅ يقلّد قلب submitEditExpense (settings.js:1377) — راجع التعليق فوق القسم كامل
async function simulateEditExpense(app, old, newFields) {
  const { amount, date, paidBy = null, paidBySplit = null } = newFields;
  const oldAmount = +old.amount;
  const oldPartnerSet = partnerSetOf(old.paid_by, old.paid_by_split);
  const newPartnerSet = partnerSetOf(paidBy, paidBySplit);
  const amountChanged = Math.abs(oldAmount - amount) > 0.001;
  const routingChanged = amountChanged || !app.lifecycle.samePartnerSet(oldPartnerSet, newPartnerSet);

  await apiPatch('expenses', { id: `eq.${old.id}` }, {
    amount, exp_date: date, paid_by: paidBy || null, paid_by_split: paidBySplit,
    post_status: 'pending_edit',
  });

  if (routingChanged) {
    // ✅ order:'id.desc' + account_code/dr_amount — يقلّد settings.js:1471-1479
    // الحقيقية بالحرف بعد إصلاح ازدواج حساب الترسملة (targetOverride)
    const oldJELines = await apiGetAll('journal_entries', {
      select: 'id,account_code,account_name,dr_amount', system_type: `eq.${SYS}`,
      ref_table: 'eq.expenses', ref_id: `eq.${old.id}`, post_status: 'eq.posted', order: 'id.desc',
    });
    const oldDebitLine = (oldJELines || []).find(l => (+l.dr_amount || 0) > 0);
    await app.engine.voidTransaction('expense', old, true);
    const newJE = await app.engine.je_expense({
      sys: SYS, date, amount, fileNo: old.file_no, refId: old.id,
      desc: old.description, expType: old.exp_type, method: old.pay_method,
      paidBy: paidBy || null, paidBySplit, isPrimary: false,
      targetOverride: oldDebitLine ? { acc: oldDebitLine.account_code, name: oldDebitLine.account_name } : null,
    });
    if (newJE?.ids?.length) {
      await app.engine._handoffPrimaryLine({ sys: SYS, oldIds: (oldJELines || []).map(l => l.id), newIds: newJE.ids });
    }
    await apiPatch('expenses', { id: `eq.${old.id}` }, { post_status: 'pending_edit' });
  } else {
    await app.engine.updateJEInPlace({
      sys: SYS, fileNo: old.file_no, refTable: 'expenses', refId: old.id,
      oldAmount, newAmount: amount, newDate: date,
    });
  }
  return routingChanged;
}

async function postSplitExpense(app, { amount, desc, paidBy = null, paidBySplit = null, postStatus = 'posted', fileNo = FILE_NO }) {
  const row = await apiPost('expenses', {
    system_type: SYS, file_no: fileNo, post_status: postStatus,
    exp_id: zid('EXP'), ref_no: zid('EXP'), pay_id: zid('EXP'),
    description: desc, exp_type: 'أخرى', pay_method: 'تحويل بنكي',
    exp_date: today(), amount, paid_by: paidBy, paid_by_split: paidBySplit, notes: 'ZZTEST regression split',
  });
  const created = row[0];
  registerCleanup('expenses', created.id);
  if (postStatus === 'posted') {
    await app.engine.je_expense({
      sys: SYS, date: created.exp_date, amount, fileNo, refId: created.id,
      desc: created.description, expType: created.exp_type, method: created.pay_method,
      paidBy, paidBySplit,
    });
  }
  return created;
}

// ES1 — إنشاء مصروف موزَّع على شريكين، مبلغ يقبل القسمة بالتساوي
async function es1_createSplitEven(app) {
  const amount = 100;
  const members = SPLIT_PARTNERS.slice(0, 2);
  const split = app.lifecycle.computeEqualSplit(amount, members);
  const created = await postSplitExpense(app, { amount, desc: 'ZZTEST split expense even', paidBySplit: split });

  const lines = await fetchActiveExpenseEntryLines(created.id);
  const creditLines = lines.filter(l => (+l.cr_amount || 0) > 0);
  assert(creditLines.length === 2, `المتوقع سطرين دائنين (2 شركاء)، طلع ${creditLines.length}`);
  for (const l of creditLines) {
    assert(l.account_code === '2400', `المتوقع حساب 2400 لكل سطر دائن، طلع ${l.account_code}`);
    assert(Math.abs((+l.cr_amount) - 50) < 0.001, `المتوقع حصة 50 لكل شريك، طلع ${l.cr_amount}`);
  }
  const names = creditLines.map(l => l.contact_name).sort();
  assert(JSON.stringify(names) === JSON.stringify([...members].sort()), `أسماء الشركاء على السطور غير مطابقة: ${names}`);
  const drSum = lines.reduce((s, l) => s + (+l.dr_amount || 0), 0);
  const crSum = lines.reduce((s, l) => s + (+l.cr_amount || 0), 0);
  assert(Math.abs(drSum - crSum) < 0.01, `القيد غير متوازن: dr=${drSum} cr=${crSum}`);
}

// ES2 — 3 شركاء، مبلغ فيه كسر أصلي (100.001) — الأخير يمتص الباقي بالضبط،
// بلا انجراف تقريب تراكمي (نقطة راجعها المستخدم صراحة)
async function es2_createSplitRemainder(app) {
  const amount = 100.001;
  const split = app.lifecycle.computeEqualSplit(amount, SPLIT_PARTNERS);
  const created = await postSplitExpense(app, { amount, desc: 'ZZTEST split expense remainder', paidBySplit: split });

  const lines = await fetchActiveExpenseEntryLines(created.id);
  const creditLines = lines.filter(l => (+l.cr_amount || 0) > 0);
  assert(creditLines.length === 3, `المتوقع 3 سطور دائنة، طلع ${creditLines.length}`);
  const crSum = creditLines.reduce((s, l) => s + (+l.cr_amount || 0), 0);
  assert(Math.abs(crSum - amount) < 0.0005, `مجموع الحصص لازم يساوي ${amount} بالضبط، طلع ${crSum}`);
  const drSum = lines.reduce((s, l) => s + (+l.dr_amount || 0), 0);
  assert(Math.abs(drSum - crSum) < 0.01, `القيد غير متوازن: dr=${drSum} cr=${crSum}`);
}

// ES3 — draft موزَّع → موافقة عبر _createApprovalJE الحقيقية (operations.js) →
// نفس التوزيع posted — يغطي فعليًا forwarding paidBySplit في operations.js:1967
async function es3_draftSplitApprove(app) {
  const amount = 90;
  const split = app.lifecycle.computeEqualSplit(amount, SPLIT_PARTNERS);
  const created = await postSplitExpense(app, { amount, desc: 'ZZTEST split draft approve', paidBySplit: split, postStatus: 'draft' });

  await app.operations._createApprovalJE('expense', created, SYS);
  await apiPatch('expenses', { id: `eq.${created.id}` }, { post_status: 'posted' });

  const lines = await fetchActiveExpenseEntryLines(created.id);
  const creditLines = lines.filter(l => (+l.cr_amount || 0) > 0);
  assert(creditLines.length === 3, `المتوقع 3 سطور دائنة بعد الموافقة، طلع ${creditLines.length}`);
  const crSum = creditLines.reduce((s, l) => s + (+l.cr_amount || 0), 0);
  assert(Math.abs(crSum - amount) < 0.01, `المجموع بعد الموافقة لازم = ${amount}، طلع ${crSum}`);
}

// ES4 — تعديل: فرد (شريك غير-صندوق) → موزَّع، لمصروف posted بالفعل
async function es4_editSingleToSplit(app) {
  const amount = 120;
  const created = await postSplitExpense(app, { amount, desc: 'ZZTEST edit single to split', paidBy: SPLIT_PARTNERS[0] });

  const newSplit = app.lifecycle.computeEqualSplit(amount, SPLIT_PARTNERS.slice(0, 2));
  const routingChanged = await simulateEditExpense(app, created, { amount, date: created.exp_date, paidBy: null, paidBySplit: newSplit });
  assert(routingChanged === true, 'المتوقع routingChanged=true (فرد→موزَّع)');

  const activeLines = await fetchActiveExpenseEntryLines(created.id);
  const creditLines = activeLines.filter(l => (+l.cr_amount || 0) > 0);
  assert(creditLines.length === 2, `المتوقع سطرين دائنين بعد التحويل لموزَّع، طلع ${creditLines.length}`);
  const crSum = creditLines.reduce((s, l) => s + (+l.cr_amount || 0), 0);
  assert(Math.abs(crSum - amount) < 0.01, `مجموع الحصص لازم = ${amount}، طلع ${crSum}`);

  const reversalLines = await apiGetAll('journal_entries', {
    select: 'id', system_type: `eq.${SYS}`, ref_table: 'eq.reversal', ref_id: `eq.${created.id}`, post_status: 'eq.posted',
  });
  assert((reversalLines || []).length >= 2, `المتوقع عكس القيد الفردي القديم (سطرين على الأقل)، طلع ${reversalLines.length}`);
}

// ES5 — تعديل: موزَّع → فرد، عكس اتجاه ES4
async function es5_editSplitToSingle(app) {
  const amount = 140;
  const oldSplit = app.lifecycle.computeEqualSplit(amount, SPLIT_PARTNERS.slice(0, 2));
  const created = await postSplitExpense(app, { amount, desc: 'ZZTEST edit split to single', paidBySplit: oldSplit });

  const routingChanged = await simulateEditExpense(app, created, { amount, date: created.exp_date, paidBy: SPLIT_PARTNERS[0], paidBySplit: null });
  assert(routingChanged === true, 'المتوقع routingChanged=true (موزَّع→فرد)');

  const activeLines = await fetchActiveExpenseEntryLines(created.id);
  const creditLines = activeLines.filter(l => (+l.cr_amount || 0) > 0);
  assert(creditLines.length === 1, `المتوقع سطر دائن واحد بعد الرجوع لفرد، طلع ${creditLines.length}`);
  assert(creditLines[0].contact_name === SPLIT_PARTNERS[0], `المتوقع الشريك ${SPLIT_PARTNERS[0]}، طلع ${creditLines[0].contact_name}`);
  assert(Math.abs((+creditLines[0].cr_amount) - amount) < 0.01, `المتوقع كامل المبلغ ${amount} على الشريك الواحد، طلع ${creditLines[0].cr_amount}`);
}

// ES6 — تعديل: موزَّع→موزَّع بنفس مجموعة الشركاء، مبلغ إجمالي مختلف — لازم
// يُكتشف amountChanged ويمر عبر عكس+إعادة ترحيل، لا updateJEInPlace (نقطة
// اكتشاف الجرد: مطابقة updateJEInPlace بالمبلغ الكامل كانت هتفشل هنا بصمت)
async function es6_editSplitSameMembersAmountChanged(app) {
  const oldAmount = 90;
  const members = SPLIT_PARTNERS; // الثلاثة
  const oldSplit = app.lifecycle.computeEqualSplit(oldAmount, members);
  const created = await postSplitExpense(app, { amount: oldAmount, desc: 'ZZTEST edit split same-members amount-changed', paidBySplit: oldSplit });

  const newAmount = 180;
  const newSplit = app.lifecycle.computeEqualSplit(newAmount, members);
  const routingChanged = await simulateEditExpense(app, created, { amount: newAmount, date: created.exp_date, paidBy: null, paidBySplit: newSplit });
  assert(routingChanged === true, 'المتوقع routingChanged=true (نفس الشركاء، مبلغ مختلف — amountChanged يوجب عكس+إعادة ترحيل)');

  const activeLines = await fetchActiveExpenseEntryLines(created.id);
  const creditLines = activeLines.filter(l => (+l.cr_amount || 0) > 0);
  assert(creditLines.length === 3, `المتوقع 3 سطور دائنة، طلع ${creditLines.length}`);
  const crSum = creditLines.reduce((s, l) => s + (+l.cr_amount || 0), 0);
  assert(Math.abs(crSum - newAmount) < 0.01, `المتوقع مجموع الحصص = ${newAmount} (المبلغ الجديد بالكامل، لا القديم)، طلع ${crSum}`);
  // ✅ التحقق الحرج: كل حصة = newAmount/3 لا oldAmount/3 — يثبت إن الحصص اتحسبت
  // من جديد فعليًا، لا تركت بقيمتها القديمة بصمت (بالظبط العلة اللي كانت
  // ستحصل لو مرّت هذه الحالة عبر updateJEInPlace القديمة)
  for (const l of creditLines) {
    assert(Math.abs((+l.cr_amount) - (newAmount / 3)) < 0.01, `المتوقع حصة ${newAmount / 3} لكل شريك، طلع ${l.cr_amount}`);
  }
}

// ES7 — تعديل: موزَّع→موزَّع بمجموعة شركاء مختلفة، نفس المبلغ الإجمالي
async function es7_editSplitDifferentMembersSameAmount(app) {
  const amount = 90;
  const oldMembers = SPLIT_PARTNERS.slice(0, 2); // A,B
  const newMembers = [SPLIT_PARTNERS[0], SPLIT_PARTNERS[2]]; // A,C — B خرج
  const oldSplit = app.lifecycle.computeEqualSplit(amount, oldMembers);
  const created = await postSplitExpense(app, { amount, desc: 'ZZTEST edit split different-members', paidBySplit: oldSplit });

  const newSplit = app.lifecycle.computeEqualSplit(amount, newMembers);
  const routingChanged = await simulateEditExpense(app, created, { amount, date: created.exp_date, paidBy: null, paidBySplit: newSplit });
  assert(routingChanged === true, 'المتوقع routingChanged=true (نفس المبلغ، مجموعة شركاء مختلفة)');

  const activeLines = await fetchActiveExpenseEntryLines(created.id);
  const creditLines = activeLines.filter(l => (+l.cr_amount || 0) > 0);
  const names = creditLines.map(l => l.contact_name).sort();
  assert(JSON.stringify(names) === JSON.stringify([...newMembers].sort()), `المتوقع الشركاء الجدد ${newMembers}، طلع ${names}`);
  assert(!names.includes(SPLIT_PARTNERS[1]), 'الشريك اللي خرج (B) ما لازمش يظهر على القيد الجديد');
}

// ES8 — تعديل تاريخ فقط لمصروف موزَّع (بلا تغيير مبلغ/مجموعة شركاء) —
// routingChanged لازم false، الحصص تفضل كما هي بلا تغيير قيمة
async function es8_editSplitDateOnly(app) {
  const amount = 60;
  const members = SPLIT_PARTNERS.slice(0, 2);
  const split = app.lifecycle.computeEqualSplit(amount, members);
  const created = await postSplitExpense(app, { amount, desc: 'ZZTEST edit split date-only', paidBySplit: split });

  const newDate = '2020-01-01';
  const routingChanged = await simulateEditExpense(app, created, { amount, date: newDate, paidBy: null, paidBySplit: split });
  assert(routingChanged === false, 'المتوقع routingChanged=false (تاريخ فقط، بلا تغيير مبلغ/شركاء) — يمر عبر updateJEInPlace');

  const activeLines = await fetchActiveExpenseEntryLines(created.id);
  const creditLines = activeLines.filter(l => (+l.cr_amount || 0) > 0);
  assert(creditLines.length === 2, `المتوقع سطرين دائنين بلا تغيير (تاريخ فقط)، طلع ${creditLines.length}`);
  for (const l of creditLines) {
    assert(Math.abs((+l.cr_amount) - (amount / 2)) < 0.01, `المتوقع الحصص تفضل ${amount / 2} بلا تغيير، طلع ${l.cr_amount}`);
  }
  assert(activeLines.every(l => l.entry_date === newDate), `المتوقع تاريخ القيد الفعّال = ${newDate} على كل الأسطر`);
}

// ES9 — إلغاء (voidTransaction) مصروف موزَّع مُرحَّل على شريكين
async function es9_voidSplitTwoPartners(app) {
  const amount = 130;
  const members = SPLIT_PARTNERS.slice(0, 2);
  const split = app.lifecycle.computeEqualSplit(amount, members);
  const created = await postSplitExpense(app, { amount, desc: 'ZZTEST void split 2partners', paidBySplit: split });

  await app.engine.voidTransaction('expense', created, true);

  const after = (await apiGetAll('expenses', { select: '*', id: `eq.${created.id}` }))[0];
  assert(after.post_status === 'voided', `المتوقع voided، طلع ${after.post_status}`);

  const reversalLines = await apiGetAll('journal_entries', {
    select: 'account_code,contact_name,dr_amount,cr_amount', system_type: `eq.${SYS}`,
    ref_table: 'eq.reversal', ref_id: `eq.${created.id}`, post_status: 'eq.posted',
  });
  assert((reversalLines || []).length === 3, `المتوقع 3 أسطر عكسية (1 مدين أصلي + 2 دائن أصليين)، طلع ${reversalLines.length}`);
  const drSum = reversalLines.reduce((s, l) => s + (+l.dr_amount || 0), 0);
  const crSum = reversalLines.reduce((s, l) => s + (+l.cr_amount || 0), 0);
  assert(Math.abs(drSum - crSum) < 0.01, `القيد العكسي غير متوازن: dr=${drSum} cr=${crSum}`);
  assert(Math.abs(drSum - amount) < 0.01, `المتوقع مجموع العكس = ${amount}، طلع ${drSum}`);
  const partnerReversalLines = reversalLines.filter(l => l.account_code === '2400');
  assert(partnerReversalLines.length === 2, `المتوقع سطرين 2400 معكوسين (كانوا دائنين، بقوا مدينين)، طلع ${partnerReversalLines.length}`);
  for (const l of partnerReversalLines) {
    assert(Math.abs((+l.dr_amount) - (amount / 2)) < 0.01, `المتوقع مدين=${amount / 2} في سطر العكس لكل شريك، طلع ${l.dr_amount}`);
  }
}

// ES10 — إلغاء مصروف موزَّع على 3 شركاء، مبلغ غير قابل للقسمة بالتساوي
async function es10_voidSplitThreePartnersUneven(app) {
  const amount = 133;
  const split = app.lifecycle.computeEqualSplit(amount, SPLIT_PARTNERS);
  const created = await postSplitExpense(app, { amount, desc: 'ZZTEST void split 3partners uneven', paidBySplit: split });

  await app.engine.voidTransaction('expense', created, true);

  const after = (await apiGetAll('expenses', { select: '*', id: `eq.${created.id}` }))[0];
  assert(after.post_status === 'voided', `المتوقع voided، طلع ${after.post_status}`);

  const reversalLines = await apiGetAll('journal_entries', {
    select: 'account_code,dr_amount,cr_amount', system_type: `eq.${SYS}`,
    ref_table: 'eq.reversal', ref_id: `eq.${created.id}`, post_status: 'eq.posted',
  });
  assert((reversalLines || []).length === 4, `المتوقع 4 أسطر عكسية (1 مدين + 3 دائن أصليين)، طلع ${reversalLines.length}`);
  const drSum = reversalLines.reduce((s, l) => s + (+l.dr_amount || 0), 0);
  const crSum = reversalLines.reduce((s, l) => s + (+l.cr_amount || 0), 0);
  assert(Math.abs(drSum - crSum) < 0.01, `القيد العكسي غير متوازن: dr=${drSum} cr=${crSum}`);
  assert(Math.abs(drSum - amount) < 0.01, `المتوقع مجموع العكس = ${amount} بالضبط رغم عدم القابلية للقسمة المتساوية، طلع ${drSum}`);
}

// ES11 — انحدار: إلغاء مصروف فردي (شريك واحد غير-صندوق، غير موزَّع) بعد إعادة
// كتابة voidTransaction — يثبت إن السلوك القديم (سطر دائن واحد) لسه صحيح
async function es11_voidSingleNonTreasuryRegression(app) {
  const amount = 210;
  const partner = SPLIT_PARTNERS[0];
  const created = await postSplitExpense(app, { amount, desc: 'ZZTEST void single non-treasury regression', paidBy: partner });

  await app.engine.voidTransaction('expense', created, true);

  const after = (await apiGetAll('expenses', { select: '*', id: `eq.${created.id}` }))[0];
  assert(after.post_status === 'voided', `المتوقع voided، طلع ${after.post_status}`);
  const reversalLines = await apiGetAll('journal_entries', {
    select: 'account_code,contact_name,dr_amount,cr_amount', system_type: `eq.${SYS}`,
    ref_table: 'eq.reversal', ref_id: `eq.${created.id}`, post_status: 'eq.posted',
  });
  assert((reversalLines || []).length === 2, `المتوقع سطرين عكسيين (مصروف فردي غير موزَّع)، طلع ${reversalLines.length}`);
  const partnerLine = reversalLines.find(l => l.account_code === '2400');
  assert(!!partnerLine, 'المتوقع سطر 2400 معكوس للشريك الفردي');
  assert(partnerLine.contact_name === partner, `المتوقع الشريك ${partner}، طلع ${partnerLine.contact_name}`);
  assert(Math.abs((+partnerLine.dr_amount) - amount) < 0.01, `المتوقع مدين=${amount} كامل على الشريك الواحد`);
}

// ES12 — computePartnerSettlement بعد مصروف موزَّع: كل شريك مختار ياخد حصته
// تلقائيًا بلا أي تعديل كود (core.js تُجمِّع بـcontact_name)، والشريك غير
// المختار في نفس الملف لا يتأثر بهذا المصروف بالذات.
// ✅ file_no مستقل خاص بهذا السيناريو (نفس نمط purchase_orders Step B فوق) —
// FILE_NO المشترك بقية السيناريوهات (ES4/ES5/ES6/ES7/ES9/ES10/ES11) بتستخدم
// نفس أسماء SPLIT_PARTNERS فعليًا على 2400 لنفس الملف، فقياس computePartnerSettlement
// على FILE_NO المشترك كان بيجمع مساهمات كل السيناريوهات الأخرى مع بعضها (اكتُشف
// حيًّا: أول محاولة رجّعت 1137.666 بدل 75 — علة في تصميم الاختبار نفسه، لا في
// الكود الإنتاجي؛ الإصلاح عزل الملف، لا تغيير computePartnerSettlement)
async function es12_computePartnerSettlementAfterSplit(app) {
  const es12FileNo = zid('ES12');
  registerExtraFileNo(es12FileNo);
  const poRow = await apiPost('purchase_orders', {
    system_type: SYS, file_no: es12FileNo, supplier: 'ZZTEST-SUPPLIER',
    total_purchase: 1, post_status: 'draft', notes: 'ZZTEST regression ES12 fixture',
  });
  registerCleanup('purchase_orders', poRow[0].id);
  for (const name of SPLIT_PARTNERS) {
    const pRow = await apiPost('partners_master', {
      system_type: SYS, file_no: es12FileNo, partner: name, share_percent: 100 / SPLIT_PARTNERS.length,
    });
    registerCleanup('partners_master', pRow[0].id);
  }

  const amount = 150;
  const members = SPLIT_PARTNERS.slice(0, 2); // A,B — C لا يُختار
  const split = app.lifecycle.computeEqualSplit(amount, members);
  await postSplitExpense(app, { amount, desc: 'ZZTEST settlement after split', paidBySplit: split, fileNo: es12FileNo });

  const settlement = await app.core.computePartnerSettlement(es12FileNo, SYS);
  const a = settlement.partners.find(p => p.name === SPLIT_PARTNERS[0]);
  const b = settlement.partners.find(p => p.name === SPLIT_PARTNERS[1]);
  const c = settlement.partners.find(p => p.name === SPLIT_PARTNERS[2]);
  assert(a && b && c, 'لازم تلاقي الشركاء الثلاثة في التسوية (partners_master fixture)');
  assert(Math.abs(a.expPaid - (amount / 2)) < 0.01, `المتوقع مصروفات A من جيبه = ${amount / 2}، طلع ${a.expPaid}`);
  assert(Math.abs(b.expPaid - (amount / 2)) < 0.01, `المتوقع مصروفات B من جيبه = ${amount / 2}، طلع ${b.expPaid}`);
  // ✅ ملف معزول تمامًا، فC هنا لازم يساوي صفر بالضبط (لا مجرد "لا يساوي حصة التوزيع")
  assert(Math.abs(c.expPaid - 0) < 0.01, `الشريك C لازم لا يتأثر بمصروف لم يُختَر له فيه (ملف معزول)، طلع ${c.expPaid}`);
}

// ════════════════════════════════════════════════════════════════════════
// EXPENSES — دعم الصندوق/صندوق الترانزيت داخل توزيع مصروف متساوٍ
// ════════════════════════════════════════════════════════════════════════
// ✅ TREASURY_NAME هنا هو "الصندوق" الحرفي (نظام BOX، نفس SYS المستخدَم في كل
// هذا الملف) — _isPartnerPocket بتتحقق من TREASURY_ALIASES، فنفس المنطق يعمم
// على "صندوق الترانزيت" (TM) بلا أي فرق، مفيش داعي لتكرار كل سيناريو بنظامين.
const TREASURY_NAME = 'الصندوق';

// ET1 — إنشاء موزَّع على الصندوق + شريك بشري واحد، قسمة متساوية زوجية
async function et1_createSplitTreasuryPlusPartner(app) {
  const amount = 100;
  const members = [TREASURY_NAME, SPLIT_PARTNERS[0]];
  const split = app.lifecycle.computeEqualSplit(amount, members);
  const created = await postSplitExpense(app, { amount, desc: 'ZZTEST split treasury+partner', paidBySplit: split });

  const lines = await fetchActiveExpenseEntryLines(created.id);
  const creditLines = lines.filter(l => (+l.cr_amount || 0) > 0);
  assert(creditLines.length === 2, `المتوقع سطرين دائنين، طلع ${creditLines.length}`);
  const treasuryLine = creditLines.find(l => l.account_code === '1110' || l.account_code === '1120');
  const partnerLine  = creditLines.find(l => l.account_code === '2400');
  assert(!!treasuryLine, 'المتوقع سطر دائن للصندوق على 1110/1120، لا 2400');
  assert(treasuryLine.contact_name === null, 'المتوقع contact_name=null لسطر الصندوق (ليس شريكًا خارجيًا)');
  assert(!!partnerLine, 'المتوقع سطر دائن للشريك البشري على 2400');
  assert(partnerLine.contact_name === SPLIT_PARTNERS[0], `المتوقع contact_name=${SPLIT_PARTNERS[0]}، طلع ${partnerLine.contact_name}`);
  assert(Math.abs((+treasuryLine.cr_amount) - 50) < 0.01, `المتوقع حصة الصندوق = 50، طلع ${treasuryLine.cr_amount}`);
  assert(Math.abs((+partnerLine.cr_amount) - 50) < 0.01, `المتوقع حصة الشريك = 50، طلع ${partnerLine.cr_amount}`);
  const drSum = lines.reduce((s, l) => s + (+l.dr_amount || 0), 0);
  const crSum = lines.reduce((s, l) => s + (+l.cr_amount || 0), 0);
  assert(Math.abs(drSum - crSum) < 0.01, `القيد غير متوازن: dr=${drSum} cr=${crSum}`);
}

// ET2 — الصندوق + شريكين بشريين، مبلغ غير قابل للقسمة المتساوية (كسر أصلي)
async function et2_createSplitTreasuryPlusTwoPartnersUneven(app) {
  const amount = 100.001;
  const members = [TREASURY_NAME, SPLIT_PARTNERS[0], SPLIT_PARTNERS[1]];
  const split = app.lifecycle.computeEqualSplit(amount, members);
  const created = await postSplitExpense(app, { amount, desc: 'ZZTEST split treasury+2partners uneven', paidBySplit: split });

  const lines = await fetchActiveExpenseEntryLines(created.id);
  const creditLines = lines.filter(l => (+l.cr_amount || 0) > 0);
  assert(creditLines.length === 3, `المتوقع 3 سطور دائنة، طلع ${creditLines.length}`);
  const treasuryLines = creditLines.filter(l => l.account_code === '1110' || l.account_code === '1120');
  const partnerLines  = creditLines.filter(l => l.account_code === '2400');
  assert(treasuryLines.length === 1, `المتوقع سطر صندوق واحد بالضبط، طلع ${treasuryLines.length}`);
  assert(partnerLines.length === 2, `المتوقع سطري شركاء بشريين، طلع ${partnerLines.length}`);
  const crSum = creditLines.reduce((s, l) => s + (+l.cr_amount || 0), 0);
  assert(Math.abs(crSum - amount) < 0.0005, `مجموع الحصص لازم يساوي ${amount} بالضبط، طلع ${crSum}`);
  const drSum = lines.reduce((s, l) => s + (+l.dr_amount || 0), 0);
  assert(Math.abs(drSum - crSum) < 0.01, `القيد غير متوازن: dr=${drSum} cr=${crSum}`);
}

// ET3 — تعديل: موزَّع على شريك بشري بس → موزَّع على الصندوق+نفس الشريك (الصندوق
// يدخل مجموعة موزَّعة قائمة) — لازم يُكتشف كتغيّر مجموعة، عكس+إعادة ترحيل
async function et3_editAddTreasuryToSplit(app) {
  const amount = 120;
  const oldMembers = [SPLIT_PARTNERS[0], SPLIT_PARTNERS[1]];
  const oldSplit = app.lifecycle.computeEqualSplit(amount, oldMembers);
  const created = await postSplitExpense(app, { amount, desc: 'ZZTEST edit add treasury to split', paidBySplit: oldSplit });

  const newMembers = [TREASURY_NAME, SPLIT_PARTNERS[0], SPLIT_PARTNERS[1]];
  const newSplit = app.lifecycle.computeEqualSplit(amount, newMembers);
  const routingChanged = await simulateEditExpense(app, created, { amount, date: created.exp_date, paidBy: null, paidBySplit: newSplit });
  assert(routingChanged === true, 'المتوقع routingChanged=true (الصندوق انضم لمجموعة التوزيع)');

  const activeLines = await fetchActiveExpenseEntryLines(created.id);
  const creditLines = activeLines.filter(l => (+l.cr_amount || 0) > 0);
  assert(creditLines.length === 3, `المتوقع 3 سطور دائنة بعد الإضافة، طلع ${creditLines.length}`);
  const treasuryLines = creditLines.filter(l => l.account_code === '1110' || l.account_code === '1120');
  assert(treasuryLines.length === 1, `المتوقع سطر صندوق واحد ظهر حديثًا، طلع ${treasuryLines.length}`);
  const crSum = creditLines.reduce((s, l) => s + (+l.cr_amount || 0), 0);
  assert(Math.abs(crSum - amount) < 0.01, `مجموع الحصص لازم = ${amount}، طلع ${crSum}`);
}

// ET4 — إلغاء (voidTransaction) مصروف موزَّع مختلط (صندوق + شريك بشري)
async function et4_voidMixedSplit(app) {
  const amount = 140;
  const members = [TREASURY_NAME, SPLIT_PARTNERS[0]];
  const split = app.lifecycle.computeEqualSplit(amount, members);
  const created = await postSplitExpense(app, { amount, desc: 'ZZTEST void treasury+partner split', paidBySplit: split });

  await app.engine.voidTransaction('expense', created, true);

  const after = (await apiGetAll('expenses', { select: '*', id: `eq.${created.id}` }))[0];
  assert(after.post_status === 'voided', `المتوقع voided، طلع ${after.post_status}`);
  const reversalLines = await apiGetAll('journal_entries', {
    select: 'account_code,contact_name,dr_amount,cr_amount', system_type: `eq.${SYS}`,
    ref_table: 'eq.reversal', ref_id: `eq.${created.id}`, post_status: 'eq.posted',
  });
  assert((reversalLines || []).length === 3, `المتوقع 3 أسطر عكسية (1 مدين + صندوق + شريك)، طلع ${reversalLines.length}`);
  const drSum = reversalLines.reduce((s, l) => s + (+l.dr_amount || 0), 0);
  const crSum = reversalLines.reduce((s, l) => s + (+l.cr_amount || 0), 0);
  assert(Math.abs(drSum - crSum) < 0.01, `القيد العكسي غير متوازن: dr=${drSum} cr=${crSum}`);
  assert(Math.abs(drSum - amount) < 0.01, `المتوقع مجموع العكس = ${amount}، طلع ${drSum}`);
  const treasuryRev = reversalLines.find(l => l.account_code === '1110' || l.account_code === '1120');
  const partnerRev  = reversalLines.find(l => l.account_code === '2400');
  assert(!!treasuryRev && !!partnerRev, 'المتوقع عكس سطري الصندوق والشريك معًا');
  assert(Math.abs((+treasuryRev.dr_amount) - amount/2) < 0.01, `المتوقع مدين=${amount/2} في عكس سطر الصندوق`);
  assert(Math.abs((+partnerRev.dr_amount) - amount/2) < 0.01, `المتوقع مدين=${amount/2} في عكس سطر الشريك`);
}

// ET5 — computePartnerSettlement بعد موزَّع مختلط: الصندوق يظهر بمساهمته
// بالمتبقي (fullCost−nonTreasurySum)، الشريك البشري بحصته المباشرة من 2400 —
// file_no معزول (نفس درس ES12) لضمان قياس نظيف
async function et5_settlementAfterMixedSplit(app) {
  const et5FileNo = zid('ET5');
  registerExtraFileNo(et5FileNo);
  const poRow = await apiPost('purchase_orders', {
    system_type: SYS, file_no: et5FileNo, supplier: 'ZZTEST-SUPPLIER',
    total_purchase: 1, post_status: 'draft', notes: 'ZZTEST regression ET5 fixture',
  });
  registerCleanup('purchase_orders', poRow[0].id);
  for (const name of [TREASURY_NAME, SPLIT_PARTNERS[0]]) {
    const pRow = await apiPost('partners_master', { system_type: SYS, file_no: et5FileNo, partner: name, share_percent: 50 });
    registerCleanup('partners_master', pRow[0].id);
  }

  const amount = 200;
  const members = [TREASURY_NAME, SPLIT_PARTNERS[0]];
  const split = app.lifecycle.computeEqualSplit(amount, members);
  await postSplitExpense(app, { amount, desc: 'ZZTEST settlement mixed split', paidBySplit: split, fileNo: et5FileNo });

  const settlement = await app.core.computePartnerSettlement(et5FileNo, SYS);
  const treasury = settlement.partners.find(p => p.name === TREASURY_NAME);
  const partner  = settlement.partners.find(p => p.name === SPLIT_PARTNERS[0]);
  assert(treasury && partner, 'لازم تلاقي الصندوق والشريك في التسوية');
  assert(treasury.isTreasury === true, 'المتوقع isTreasury=true للصندوق');
  assert(Math.abs(treasury.actualContribution - (amount / 2)) < 0.01, `المتوقع مساهمة الصندوق (بالمتبقي) = ${amount / 2}، طلع ${treasury.actualContribution}`);
  assert(Math.abs(partner.expPaid - (amount / 2)) < 0.01, `المتوقع مصروفات الشريك من جيبه = ${amount / 2}، طلع ${partner.expPaid}`);
  assert(Math.abs(settlement.totalExpenseAmount - amount) < 0.01, `المتوقع totalExpenseAmount = ${amount} رغم اختلاط الحسابات، طلع ${settlement.totalExpenseAmount}`);
}

// ════════════════════════════════════════════════════════════════════════
// EXPENSES — إصلاح ازدواج expenseAmount (مصروف مُعدَّل يُحسب مرتين)
// ════════════════════════════════════════════════════════════════════════
// اكتُشف حيًّا 2026-08-02 على TM-004 الحقيقي (21 ref_id مكرّر، تضخيم 5,949 —
// fullCost=19,297 بدل 13,348 الصحيح). السبب: computeFinancials's expenseAmount
// كانت تجمع الطرف الدائن لأي سطر ref_table='expenses' بلا أي صافٍ أو استبعاد
// للنسخة القديمة المُستبدَلة عند التعديل (بعكس totPurchase/totSales/totCOGS
// اللي بتستخدم (dr-cr) صافٍ أصلاً). الإصلاح: صافٍ (cr-dr) على حسابات الدفع
// الحصرية للمصاريف (1110/1120/2400) فقط، شامل قيود عكس المصاريف (ref_table=
// 'reversal' بنفس ref_id) — راجع core.js's computeFinancials للتفاصيل الكاملة
// وproject_expenseamount_double_count_bug في الذاكرة.
//
// كل سيناريو على file_no معزول تمامًا (نفس درس ES12) لقياس نظيف عبر
// computePartnerSettlement. يغطي: تعديل مرة، تعديل مرتين متتاليتين (يحاكي
// سلسلة TM-004 الحقيقية 15→7.5→15 بالضبط)، مصروف موزَّع مُعدَّل، إلغاء
// (voidTransaction — نقطة راجعها المستخدم صراحة، غير مغطاة في الفحص اليدوي
// الأولي)، ومصروف عادي غير مُعدَّل (انحدار — لازم يفضل صحيح زي الأول).

async function eaFixtureFile(app, prefix) {
  const fileNo = zid(prefix);
  registerExtraFileNo(fileNo);
  const poRow = await apiPost('purchase_orders', {
    system_type: SYS, file_no: fileNo, supplier: 'ZZTEST-SUPPLIER',
    total_purchase: 1, post_status: 'draft', notes: 'ZZTEST regression expenseAmount fixture',
  });
  registerCleanup('purchase_orders', poRow[0].id);
  const pRow = await apiPost('partners_master', { system_type: SYS, file_no: fileNo, partner: SPLIT_PARTNERS[0], share_percent: 100 });
  registerCleanup('partners_master', pRow[0].id);
  return fileNo;
}

// EA1 — مصروف فردي (غير موزَّع) مُعدَّل مرة واحدة (مبلغ) — expenseAmount لازم
// يُحسب بالمبلغ الجديد بس، لا القديم+الجديد معًا
async function ea1_expenseAmountEditedOnce(app) {
  const fileNo = await eaFixtureFile(app, 'EA1');
  const created = await postSplitExpense(app, { amount: 100, desc: 'ZZTEST EA1 edited once', paidBy: SPLIT_PARTNERS[0], fileNo });

  const newAmount = 150;
  await simulateEditExpense(app, created, { amount: newAmount, date: created.exp_date, paidBy: SPLIT_PARTNERS[0], paidBySplit: null });

  const settlement = await app.core.computePartnerSettlement(fileNo, SYS);
  assert(Math.abs(settlement.totalExpenseAmount - newAmount) < 0.01, `المتوقع totalExpenseAmount=${newAmount} (المبلغ الجديد بس)، طلع ${settlement.totalExpenseAmount}`);
}

// EA2 — مصروف مُعدَّل مرتين متتاليتين (100→70→100) — يحاكي سلسلة TM-004
// الحقيقية بالضبط (15→7.5→15) — لازم يُحسب بآخر مبلغ فقط رغم 3 قيود متتالية
async function ea2_expenseAmountEditedTwice(app) {
  const fileNo = await eaFixtureFile(app, 'EA2');
  const created = await postSplitExpense(app, { amount: 100, desc: 'ZZTEST EA2 edited twice', paidBy: SPLIT_PARTNERS[0], fileNo });

  await simulateEditExpense(app, created, { amount: 70, date: created.exp_date, paidBy: SPLIT_PARTNERS[0], paidBySplit: null });
  const afterFirst = (await apiGetAll('expenses', { select: '*', id: `eq.${created.id}` }))[0];
  await simulateEditExpense(app, afterFirst, { amount: 100, date: created.exp_date, paidBy: SPLIT_PARTNERS[0], paidBySplit: null });

  const settlement = await app.core.computePartnerSettlement(fileNo, SYS);
  assert(Math.abs(settlement.totalExpenseAmount - 100) < 0.01, `المتوقع totalExpenseAmount=100 (آخر قيمة بعد تعديلين متتاليين)، طلع ${settlement.totalExpenseAmount}`);
}

// EA3 — مصروف موزَّع مُعدَّل (مبلغ) — يتأكد إن الصافي يعمل مع N سطر دائن
async function ea3_expenseAmountSplitEdited(app) {
  const fileNo = await eaFixtureFile(app, 'EA3');
  const members = SPLIT_PARTNERS.slice(0, 2);
  const oldSplit = app.lifecycle.computeEqualSplit(100, members);
  const created = await postSplitExpense(app, { amount: 100, desc: 'ZZTEST EA3 split edited', paidBySplit: oldSplit, fileNo });

  const newAmount = 180;
  const newSplit = app.lifecycle.computeEqualSplit(newAmount, members);
  await simulateEditExpense(app, created, { amount: newAmount, date: created.exp_date, paidBy: null, paidBySplit: newSplit });

  const settlement = await app.core.computePartnerSettlement(fileNo, SYS);
  assert(Math.abs(settlement.totalExpenseAmount - newAmount) < 0.01, `المتوقع totalExpenseAmount=${newAmount} لمصروف موزَّع مُعدَّل، طلع ${settlement.totalExpenseAmount}`);
}

// EA4 — إلغاء (voidTransaction) مصروف — expenseAmount لازم يرجع صفر بالضبط
// (نقطة أضافها المستخدم صراحة — غير مغطاة في التحقق اليدوي الأولي)
async function ea4_expenseAmountVoided(app) {
  const fileNo = await eaFixtureFile(app, 'EA4');
  const created = await postSplitExpense(app, { amount: 100, desc: 'ZZTEST EA4 voided', paidBy: SPLIT_PARTNERS[0], fileNo });

  const before = await app.core.computePartnerSettlement(fileNo, SYS);
  assert(Math.abs(before.totalExpenseAmount - 100) < 0.01, `precondition: قبل الإلغاء لازم = 100، طلع ${before.totalExpenseAmount}`);

  const row = (await apiGetAll('expenses', { select: '*', id: `eq.${created.id}` }))[0];
  await app.engine.voidTransaction('expense', row, true);

  const after = await app.core.computePartnerSettlement(fileNo, SYS);
  assert(Math.abs(after.totalExpenseAmount - 0) < 0.01, `المتوقع totalExpenseAmount=0 بعد الإلغاء، طلع ${after.totalExpenseAmount}`);
}

// EA5 — انحدار: مصروف عادي غير مُعدَّل خالص — لازم يفضل صحيح زي الأول
async function ea5_expenseAmountUnaffectedRegression(app) {
  const fileNo = await eaFixtureFile(app, 'EA5');
  await postSplitExpense(app, { amount: 250, desc: 'ZZTEST EA5 unedited baseline', paidBy: SPLIT_PARTNERS[0], fileNo });

  const settlement = await app.core.computePartnerSettlement(fileNo, SYS);
  assert(Math.abs(settlement.totalExpenseAmount - 250) < 0.01, `المتوقع totalExpenseAmount=250 (بلا أي تعديل)، طلع ${settlement.totalExpenseAmount}`);
}

// EA6 — حساب الترسملة (1300/5100) لازم يفضل ثابت عبر تعديلات "مين دفع"
// المتتالية حتى لو حالة البيع اتغيّرت بينهم — الباج الحقيقي المُكتشَف حيًّا
// على TM-004 (وكيل الشحن، 2026-08-02): fileExpenseTarget كانت تُعاد اشتقاقها
// من حالة البيع *الحالية* وقت كل إعادة ترحيل (routingChanged)، فمصروف اتقيّد
// قبل البيع على 1300 كان بينتقل لـ5100 بعد أول تعديل توجيه بعد البيع —
// ازدواج حقيقي في COGS (نفس المبلغ محسوب مرتين: جوّه قيد البيع المجمَّد،
// وكقيد مباشر جديد). يتحقق كمان من نقطة الترتيب المستقلة اللي راجعها
// المستخدم: تعديلان متتاليان لازم ياخدوا حساب القيد الحالي النشط في كل
// مرة (order:'id.desc')، لا أي قيد قديم من التاريخ (لا اعتماد على
// reversed_by، best-effort وممكن يفشل بصمت — راجع postDoubleEntry).
async function ea6_targetAccountPreservedAcrossSaleStatusChange(app) {
  const fileNo = zid('EA6');
  registerExtraFileNo(fileNo);
  const poRow = await apiPost('purchase_orders', {
    system_type: SYS, file_no: fileNo, supplier: 'ZZTEST-SUPPLIER',
    total_purchase: 1000, post_status: 'draft', notes: 'ZZTEST regression EA6 fixture',
  });
  registerCleanup('purchase_orders', poRow[0].id);
  const vin = zid('VIN-EA6');
  const vehRow = await apiPost('vehicles', { system_type: SYS, file_no: fileNo, vin, purchase_price: 1000 });
  registerCleanup('vehicles', vehRow[0].id);
  for (const name of [SPLIT_PARTNERS[0], SPLIT_PARTNERS[1]]) {
    const pRow = await apiPost('partners_master', { system_type: SYS, file_no: fileNo, partner: name, share_percent: 50 });
    registerCleanup('partners_master', pRow[0].id);
  }

  // 1. مصروف يُرحَّل قبل البيع — لازم 1300 (المخزون)
  const created = await postSplitExpense(app, { amount: 100, desc: 'ZZTEST EA6 pre-sale expense', paidBy: SPLIT_PARTNERS[0], fileNo });
  let lines = await fetchActiveExpenseEntryLines(created.id);
  let debitLine = lines.find(l => (+l.dr_amount || 0) > 0);
  assert(debitLine.account_code === '1300', `precondition: قبل البيع لازم 1300، طلع ${debitLine.account_code}`);

  // 2. السيارة بتتباع — سطر sales مباشر يكفي (fileExpenseTarget بتفحص
  // vehicles/sales بس، مش محتاجة قيد post_sale_je الفعلي لهذا الاختبار)
  const saleRow = await apiPost('sales', {
    system_type: SYS, file_no: fileNo, vin, customer: 'ZZTEST-CUSTOMER',
    inv_no: zid('INV'), sale_price: 1500, sale_date: today(), post_status: 'posted',
  });
  registerCleanup('sales', saleRow[0].id);

  // 3. تعديل توجيه (routingChanged) بعد البيع — لازم يحافظ على 1300 الأصلي،
  // لا يتحول لـ5100 رغم إن الملف بقى "مُباع بالكامل" الآن
  await simulateEditExpense(app, created, { amount: 100, date: created.exp_date, paidBy: SPLIT_PARTNERS[1], paidBySplit: null });
  lines = await fetchActiveExpenseEntryLines(created.id);
  debitLine = lines.find(l => (+l.dr_amount || 0) > 0);
  assert(debitLine.account_code === '1300', `المتوقع الحفاظ على 1300 بعد أول تعديل توجيه بعد البيع، طلع ${debitLine.account_code}`);

  // 4. تعديل توجيه ثانٍ متتالٍ — يتأكد إن الحساب مُشتَق من القيد النشط
  // الحالي (نتيجة الخطوة 3)، لا القيد الأصلي القديم من الخطوة 1
  const updatedAfterFirst = (await apiGetAll('expenses', { select: '*', id: `eq.${created.id}` }))[0];
  await simulateEditExpense(app, updatedAfterFirst, { amount: 100, date: created.exp_date, paidBy: SPLIT_PARTNERS[0], paidBySplit: null });
  lines = await fetchActiveExpenseEntryLines(created.id);
  debitLine = lines.find(l => (+l.dr_amount || 0) > 0);
  assert(debitLine.account_code === '1300', `المتوقع الحفاظ على 1300 بعد تعديل توجيه ثانٍ متتالٍ، طلع ${debitLine.account_code}`);

  // 5. تحقق نهائي: expenseAmount (إصلاح النهارده الأول) لسه صحيح رغم كل
  // هذه التعديلات المتتالية — 100 بس، لا مضاعف
  const settlement = await app.core.computePartnerSettlement(fileNo, SYS);
  assert(Math.abs(settlement.totalExpenseAmount - 100) < 0.01, `المتوقع totalExpenseAmount=100 رغم تعديلين متتاليين، طلع ${settlement.totalExpenseAmount}`);
}

// ════════════════════════════════════════════════════════════════════════
// PRIMARY-LINE HANDOFF FIX — عكس (reversal) مزدوج عند "لمسة تانية"
// ════════════════════════════════════════════════════════════════════════
// اكتُشف حيًّا 2026-07-30 (TM-004، 23 سجل متأثر + BOX-141): تعديل ثانٍ متتالٍ
// (updateJEInPlace مرتين) أو إلغاء بعد تعديل (updateJEInPlace ثم voidTransaction)
// على نفس السجل كان بيصطدم بالقيد الفريد uq_je_ref_primary_posted — لأن عكس
// التعديل الأول (ref_table='reversal') بيفضل is_primary_line=true بلا تنزيل،
// و_handoffPrimaryLine (updateJEInPlace) بتغطي بس سطور الكيان الأصلي، مش سطور
// العكس. الإصلاح مركزي جوه postDoubleEntry نفسها (يحمي كل الـ7 مواقع اللي
// بتنشئ عكس تلقائيًا) — السيناريوهين هنا يثبتوا الحماية فعليًا لحالتين مختلفتين
// (تعديل→تعديل، تعديل→إلغاء)، مش بافتراض التعميم من مكان الإصلاح.

async function p3_editThenEdit(cfg, app) {
  const row = await apiPost(cfg.table, {
    system_type: SYS, file_no: FILE_NO, post_status: 'posted', ...cfg.baseFields(910),
  });
  const created = row[0];
  registerCleanup(cfg.table, created.id);
  await cfg.postJE(created);

  await app.engine.updateJEInPlace({
    sys: SYS, fileNo: FILE_NO, refTable: cfg.table, refId: created.id, oldAmount: 910, newAmount: 920,
  });
  // ✅ التعديل الثاني — ده بالضبط اللي كان بيصطدم بـ409 حيًّا قبل الإصلاح
  await app.engine.updateJEInPlace({
    sys: SYS, fileNo: FILE_NO, refTable: cfg.table, refId: created.id, oldAmount: 920, newAmount: 930,
  });

  const activeReversals = await apiGetAll('journal_entries', {
    select: 'id', system_type: `eq.${SYS}`, ref_table: `eq.reversal`, ref_id: `eq.${created.id}`,
    is_primary_line: 'eq.true', post_status: 'eq.posted',
  });
  assert(activeReversals.length === 1, `المتوقع صف عكس نشط واحد بس بعد تعديلين متتاليين، طلع ${activeReversals.length}`);

  const activeMain = await apiGetAll('journal_entries', {
    select: 'dr_amount,cr_amount', system_type: `eq.${SYS}`, ref_table: `eq.${cfg.table}`, ref_id: `eq.${created.id}`, post_status: 'eq.posted',
  });
  const activeAmt = Math.max(...activeMain.map(l => Math.max(+l.dr_amount || 0, +l.cr_amount || 0)));
  assert(Math.abs(activeAmt - 930) < 0.01, `المتوقع القيمة النهائية = 930، طلع ${activeAmt}`);
}

async function p3_editThenVoid(cfg, app) {
  const row = await apiPost(cfg.table, {
    system_type: SYS, file_no: FILE_NO, post_status: 'posted', ...cfg.baseFields(940),
  });
  const created = row[0];
  registerCleanup(cfg.table, created.id);
  await cfg.postJE(created);

  await app.engine.updateJEInPlace({
    sys: SYS, fileNo: FILE_NO, refTable: cfg.table, refId: created.id, oldAmount: 940, newAmount: 950,
  });

  const preVoid = (await apiGetAll(cfg.table, { select: '*', id: `eq.${created.id}` }))[0];
  // ✅ force=true — تنفيذ فوري بلا مرور بمسار "طلب مراجعة"، نفس ما بيحصل عند
  // الموافقة من قائمة الاعتماد (_processReversalApproval)
  await app.engine.voidTransaction(cfg.srcType, preVoid, true);

  const after = (await apiGetAll(cfg.table, { select: '*', id: `eq.${created.id}` }))[0];
  assert(after.post_status === 'voided', `المتوقع voided، طلع ${after.post_status}`);

  const activeReversals = await apiGetAll('journal_entries', {
    select: 'id', system_type: `eq.${SYS}`, ref_table: `eq.reversal`, ref_id: `eq.${created.id}`,
    is_primary_line: 'eq.true', post_status: 'eq.posted',
  });
  assert(activeReversals.length === 1, `المتوقع صف عكس نشط واحد بس بعد تعديل ثم إلغاء، طلع ${activeReversals.length}`);
}

// نفس سيناريو p3_editThenEdit لكن لـpurchase_orders — الحالة الحقيقية اللي
// ظهرت في البيانات الحية (BOX-141، وTM-004's purchase_orders تحديدًا)
async function p3po_editThenEdit(app) {
  const poFileNo = zid('PO-P3');
  registerExtraFileNo(poFileNo);
  const row = await apiPost('purchase_orders', {
    system_type: SYS, file_no: poFileNo, supplier: 'ZZTEST-SUPPLIER', po_date: today(),
    total_purchase: 5000, post_status: 'posted', notes: 'ZZTEST regression P3',
  });
  const created = row[0];
  registerCleanup('purchase_orders', created.id);
  await app.engine.je_purchase({
    sys: SYS, date: created.po_date, amount: +created.total_purchase, fileNo: poFileNo,
    supplier: created.supplier, refId: created.id,
  });

  await app.engine.updateJEInPlace({
    sys: SYS, fileNo: poFileNo, refTable: 'purchase_orders', refId: created.id, oldAmount: 5000, newAmount: 5100,
  });
  await app.engine.updateJEInPlace({
    sys: SYS, fileNo: poFileNo, refTable: 'purchase_orders', refId: created.id, oldAmount: 5100, newAmount: 5200,
  });

  const activeReversals = await apiGetAll('journal_entries', {
    select: 'id', system_type: `eq.${SYS}`, ref_table: `eq.reversal`, ref_id: `eq.${created.id}`,
    is_primary_line: 'eq.true', post_status: 'eq.posted',
  });
  assert(activeReversals.length === 1, `المتوقع صف عكس نشط واحد بس (purchase_orders)، طلع ${activeReversals.length}`);

  const activeMain = await apiGetAll('journal_entries', {
    select: 'dr_amount,cr_amount', system_type: `eq.${SYS}`, ref_table: `eq.purchase_orders`, ref_id: `eq.${created.id}`, post_status: 'eq.posted',
  });
  const activeAmt = Math.max(...activeMain.map(l => Math.max(+l.dr_amount || 0, +l.cr_amount || 0)));
  assert(Math.abs(activeAmt - 5200) < 0.01, `المتوقع القيمة النهائية = 5200، طلع ${activeAmt}`);
}

// ════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════
// PARTNER-SETTLEMENT REVERSAL NETTING FIX — computePartnerSettlement's
// crByRef/drByRef كانت بتتجاهل أي ref_table='reversal' بالكامل ('reversal'
// مش مفتاح موجود في crByRef/drByRef، فالشرط `!== undefined` كان بيرفضها من
// الأساس، حتى من المجموع الخام) — أي دفعة/مصروف/تحصيل/صرف شريك اتعدّل أو
// اتلغى أكتر من مرة كان بيفضل يحسب النسخة القديمة المُستبدَلة للأبد جنب
// الجديدة. اكتُشف حيًّا على TM-004 (وكيل الشحن: مصروف اتعدّل 3 مرات بنفس
// المبلغ، fairShareDiff ظهر 2,316.5 غلط). راجع
// project_is_primary_line_double_reversal_tm004 في الذاكرة للتفاصيل الكاملة.
//
// كل سيناريو على file_no + اسم شريك معزولين تمامًا (نفس درس EA*/ES12) لقياس
// نظيف عبر computePartnerSettlement مباشرة. لا نستخدم cfg.postJE من
// buildEntityConfigs هنا عمدًا — هي مربوطة بـFILE_NO المشترك (hardcoded)،
// غير مناسبة للعزل المطلوب لقياس تسوية شريك بمعزل عن باقي حركات السويت على
// نفس الملف؛ بدلها نستدعي je_payment/je_expense/je_collection/je_payout
// الحقيقية مباشرة بـfileNo معزول، بنفس أسلوب postSplitExpense فوق بالحرف.

async function psFixtureFile(app, prefix, partnerName) {
  const fileNo = zid(prefix);
  registerExtraFileNo(fileNo);
  // ✅ expenses/payments/collections/partner_payouts/partners_master كلها بها
  // FK على file_no → purchase_orders(file_no) — نفس ملاحظة eaFixtureFile فوق
  const poRow = await apiPost('purchase_orders', {
    system_type: SYS, file_no: fileNo, supplier: 'ZZTEST-SUPPLIER',
    total_purchase: 1, post_status: 'draft', notes: 'ZZTEST regression settlement fixture',
  });
  registerCleanup('purchase_orders', poRow[0].id);
  const pRow = await apiPost('partners_master', { system_type: SYS, file_no: fileNo, partner: partnerName, share_percent: 100 });
  registerCleanup('partners_master', pRow[0].id);
  return fileNo;
}

const PS_TYPES = {
  payments: {
    table: 'payments', srcType: 'payment', settlementField: 'capitalPaid',
    createRow: (fileNo, amount, partnerName) => ({
      system_type: SYS, file_no: fileNo, post_status: 'posted',
      pay_id: zid('PMT'), ref_no: zid('PMT'), payer: partnerName, pay_method: 'تحويل بنكي',
      pay_date: today(), amount, notes: 'ZZTEST regression settlement',
    }),
    postJE: (app, row, fileNo, partnerName) => app.engine.je_payment({
      sys: SYS, date: row.pay_date, amount: +row.amount, fileNo, refId: row.id,
      supplierName: 'ZZTEST-SUPPLIER', payerName: partnerName, method: row.pay_method,
    }),
  },
  expenses: {
    table: 'expenses', srcType: 'expense', settlementField: 'expPaid',
    createRow: (fileNo, amount, partnerName) => ({
      system_type: SYS, file_no: fileNo, post_status: 'posted',
      exp_id: zid('EXP'), ref_no: zid('EXP'), pay_id: zid('EXP'),
      description: 'ZZTEST regression settlement expense', exp_type: 'أخرى', pay_method: 'تحويل بنكي',
      exp_date: today(), amount, paid_by: partnerName, notes: 'ZZTEST regression settlement',
    }),
    postJE: (app, row, fileNo, partnerName) => app.engine.je_expense({
      sys: SYS, date: row.exp_date, amount: +row.amount, fileNo, refId: row.id,
      desc: row.description, expType: row.exp_type, method: row.pay_method, paidBy: partnerName,
    }),
  },
  collections: {
    table: 'collections', srcType: 'collection', settlementField: 'collectionsHeld',
    createRow: (fileNo, amount, partnerName) => ({
      system_type: SYS, file_no: fileNo, post_status: 'posted',
      pay_id: zid('COL'), ref_no: zid('COL'),
      customer: 'ZZTEST-CUSTOMER', inv_no: zid('INV'), pay_method: 'تحويل بنكي',
      due_date: today(), paid_date: today(), amount, received_by: partnerName, notes: 'ZZTEST regression settlement',
    }),
    postJE: (app, row, fileNo, partnerName) => app.engine.je_collection({
      sys: SYS, date: row.paid_date, amount: +row.amount, fileNo, refId: row.id,
      customer: row.customer, invNo: row.inv_no, method: row.pay_method, receivedBy: partnerName,
    }),
  },
  partner_payouts: {
    table: 'partner_payouts', srcType: 'payout', settlementField: 'withdrawnViaPayout',
    createRow: (fileNo, amount, partnerName) => ({
      system_type: SYS, file_no: fileNo, post_status: 'posted',
      pay_id: zid('POU'),
      partner: partnerName, payout_type: 'ربح', pay_method: 'تحويل بنكي',
      pay_date: today(), amount, notes: 'ZZTEST regression settlement',
    }),
    postJE: (app, row, fileNo, partnerName) => app.engine.je_payout({
      sys: SYS, date: row.pay_date, amount: +row.amount, fileNo, refId: row.id,
      partner: partnerName, method: row.pay_method,
    }),
  },
};

async function psSettlementValue(app, fileNo, partnerName, typeKey) {
  const settlement = await app.core.computePartnerSettlement(fileNo, SYS);
  const p = settlement.partners.find(x => x.name === partnerName.trim());
  assert(p, `[${typeKey}] لازم نلاقي الشريك ${partnerName} في نتيجة التسوية`);
  return p[PS_TYPES[typeKey].settlementField];
}

// PS-EDIT-ONCE — تعديل مرة واحدة (100→150) — لازم القيمة الجديدة بس تُحسب
async function ps_editOnce(typeKey, app) {
  const t = PS_TYPES[typeKey];
  const partnerName = zid('PS1-' + typeKey);
  const fileNo = await psFixtureFile(app, 'PS1-' + typeKey, partnerName);
  const row = (await apiPost(t.table, t.createRow(fileNo, 100, partnerName)))[0];
  registerCleanup(t.table, row.id);
  await t.postJE(app, row, fileNo, partnerName);

  await app.engine.updateJEInPlace({ sys: SYS, fileNo, refTable: t.table, refId: row.id, oldAmount: 100, newAmount: 150 });

  const val = await psSettlementValue(app, fileNo, partnerName, typeKey);
  assert(Math.abs(val - 150) < 0.01, `[${typeKey}] المتوقع ${t.settlementField}=150 بعد تعديل مرة، طلع ${val}`);
}

// PS-EDIT-TWICE — تعديل مرتين متتاليتين (100→70→100) — يحاكي سلسلة TM-004
async function ps_editTwice(typeKey, app) {
  const t = PS_TYPES[typeKey];
  const partnerName = zid('PS2-' + typeKey);
  const fileNo = await psFixtureFile(app, 'PS2-' + typeKey, partnerName);
  const row = (await apiPost(t.table, t.createRow(fileNo, 100, partnerName)))[0];
  registerCleanup(t.table, row.id);
  await t.postJE(app, row, fileNo, partnerName);

  await app.engine.updateJEInPlace({ sys: SYS, fileNo, refTable: t.table, refId: row.id, oldAmount: 100, newAmount: 70 });
  await app.engine.updateJEInPlace({ sys: SYS, fileNo, refTable: t.table, refId: row.id, oldAmount: 70, newAmount: 100 });

  const val = await psSettlementValue(app, fileNo, partnerName, typeKey);
  assert(Math.abs(val - 100) < 0.01, `[${typeKey}] المتوقع ${t.settlementField}=100 بعد تعديلين متتاليين، طلع ${val}`);
}

// PS-VOID — إلغاء (voidTransaction) — لازم يرجع صفر بالضبط
async function ps_void(typeKey, app) {
  const t = PS_TYPES[typeKey];
  const partnerName = zid('PS3-' + typeKey);
  const fileNo = await psFixtureFile(app, 'PS3-' + typeKey, partnerName);
  const row = (await apiPost(t.table, t.createRow(fileNo, 100, partnerName)))[0];
  registerCleanup(t.table, row.id);
  await t.postJE(app, row, fileNo, partnerName);

  const before = await psSettlementValue(app, fileNo, partnerName, typeKey);
  assert(Math.abs(before - 100) < 0.01, `[${typeKey}] precondition قبل الإلغاء لازم =100، طلع ${before}`);

  await app.engine.voidTransaction(t.srcType, row, true);

  const after = await psSettlementValue(app, fileNo, partnerName, typeKey);
  assert(Math.abs(after - 0) < 0.01, `[${typeKey}] المتوقع ${t.settlementField}=0 بعد الإلغاء، طلع ${after}`);
}

// PS4 — نفس حالة "وكيل الشحن" الحقيقية بالضبط: مصروف اتعدّل 3 مرات متتالية
// بنفس المبلغ بالظبط (1150→1150→1150) — قبل الإصلاح كان يظهر 3,450 (الثلاث
// نسخ مجموعة) بدل 1,150 (النسخة النشطة الوحيدة فقط)
async function ps4_expenseThreeEditsSameAmount(app) {
  const t = PS_TYPES.expenses;
  const partnerName = zid('PS4-expenses');
  const fileNo = await psFixtureFile(app, 'PS4-expenses', partnerName);
  const row = (await apiPost(t.table, t.createRow(fileNo, 1150, partnerName)))[0];
  registerCleanup(t.table, row.id);
  await t.postJE(app, row, fileNo, partnerName);

  await app.engine.updateJEInPlace({ sys: SYS, fileNo, refTable: t.table, refId: row.id, oldAmount: 1150, newAmount: 1150 });
  await app.engine.updateJEInPlace({ sys: SYS, fileNo, refTable: t.table, refId: row.id, oldAmount: 1150, newAmount: 1150 });
  await app.engine.updateJEInPlace({ sys: SYS, fileNo, refTable: t.table, refId: row.id, oldAmount: 1150, newAmount: 1150 });

  const val = await psSettlementValue(app, fileNo, partnerName, 'expenses');
  assert(Math.abs(val - 1150) < 0.01, `[وكيل الشحن سيناريو حقيقي] المتوقع expPaid=1150 رغم 3 تعديلات متتالية بنفس المبلغ، طلع ${val}`);
}

// ════════════════════════════════════════════════════════════════════════
// QUICK-SALE inv_no COLUMN FIX (viewer.js:335)
// ════════════════════════════════════════════════════════════════════════
// اكتُشف حيًّا: submitQuickSale (js/viewer.js) كانت بتدرج في جدول sales
// بعمود invoice_no — العمود الحقيقي inv_no (خطأ فعلي من القاعدة: "Could not
// find the 'invoice_no' column of 'sales' in the schema cache"). الإصلاح:
// سطر واحد (invoice_no → inv_no). submitQuickSale نفسها DOM-مقترنة (بتقرا
// el('qs-...').value مباشرة) — بلا استدعاء مباشر ممكن هنا (نفس قيد "قرار
// الحفظ" الموثَّق أعلى الملف)، فالاختبار بيكرر بنية القيد بالحرف من نفس
// السطر المُصلَح (system_type/file_no/vin/customer/inv_no/sale_price/
// sale_date/notes/post_status)، ويستخدم apiPost الحقيقية على القاعدة
// الفعلية — فأي رجوع لاسم العمود الغلط هيفشل هنا بنفس الخطأ الحي بالضبط.

async function qs1_quickSaleInvNoRecordedCorrectly(app) {
  const fileNo = zid('QS1');
  registerExtraFileNo(fileNo);
  const poRow = await apiPost('purchase_orders', {
    system_type: SYS, file_no: fileNo, supplier: 'ZZTEST-SUPPLIER',
    total_purchase: 1000, post_status: 'draft', notes: 'ZZTEST regression quick-sale fixture',
  });
  registerCleanup('purchase_orders', poRow[0].id);
  const vin = zid('VIN-QS1');
  const vehRow = await apiPost('vehicles', { system_type: SYS, file_no: fileNo, vin, purchase_price: 1000 });
  registerCleanup('vehicles', vehRow[0].id);

  const invNo = zid('INV-QS1');
  // ✅ نفس بنية القيد بالحرف من viewer.js:333-335 (submitQuickSale) بعد الإصلاح
  const data = {
    system_type: SYS, file_no: fileNo, vin, customer: 'ZZTEST-CUSTOMER',
    inv_no: invNo, sale_price: 1500, sale_date: today(), notes: null, post_status: 'draft',
  };
  const saleRow = await apiPost('sales', data);
  registerCleanup('sales', saleRow[0].id);

  const fetched = (await apiGetAll('sales', { select: 'id,inv_no', id: `eq.${saleRow[0].id}` }))[0];
  assert(fetched, 'لازم نلاقي سطر البيع المُدرَج');
  assert(fetched.inv_no === invNo, `المتوقع sales.inv_no="${invNo}"، طلع "${fetched.inv_no}"`);
}

// ════════════════════════════════════════════════════════════════════════
// DEAL STATEMENT inv_no FIX (settings.js:716)
// ════════════════════════════════════════════════════════════════════════
// اكتُشف عرضًا أثناء التحقق من إصلاح viewer.js: نفس الاسم الغلط (invoice_no
// بدل inv_no) في extra نص صف البيع بكشف حساب الملف (Tab 7) — يؤثر على
// العرض المباشر + تصدير Excel + طباعة PDF (الثلاثة بيقروا نفس entries[].extra،
// راجع project_quicksale_invoice_no_column_bug في الذاكرة للتفاصيل الكاملة).
// loadDealStatement نفسها مش DOM-مقترنة من ناحية القراءة (fn/sys parameters
// عاديين، بتكتب لـwrap.innerHTML بس) — تُستدعى هنا حقيقية مباشرة، بلا تقليد.
// ✅ نظام TM عمدًا (بدل SYS='BOX' المشترك) — طلب صريح من المستخدم.

async function ds1_dealStatementSaleInvNoDisplayed(app) {
  const DS_SYS = 'TM';
  const fileNo = zid('DS1');
  registerExtraFileNo(fileNo);
  const poRow = await apiPost('purchase_orders', {
    system_type: DS_SYS, file_no: fileNo, supplier: 'ZZTEST-SUPPLIER',
    total_purchase: 1000, post_status: 'draft', notes: 'ZZTEST regression deal-statement fixture',
  });
  registerCleanup('purchase_orders', poRow[0].id);
  const vin = zid('VIN-DS1');
  const vehRow = await apiPost('vehicles', { system_type: DS_SYS, file_no: fileNo, vin, purchase_price: 1000 });
  registerCleanup('vehicles', vehRow[0].id);
  const invNo = zid('INV-DS1');
  const saleRow = await apiPost('sales', {
    system_type: DS_SYS, file_no: fileNo, vin, customer: 'ZZTEST-CUSTOMER',
    inv_no: invNo, sale_price: 1500, sale_date: today(), notes: null, post_status: 'posted',
  });
  registerCleanup('sales', saleRow[0].id);

  await app.settings.loadDealStatement(fileNo, DS_SYS);
  const data = globalThis._dealStatementData;
  assert(data && data.fn === fileNo, 'لازم loadDealStatement تحدّث window._dealStatementData لنفس الملف');
  const saleEntry = (data.entries || []).find(e => e.type === 'بيع');
  assert(saleEntry, 'لازم نلاقي صف البيع في entries');
  assert(saleEntry.extra && saleEntry.extra.includes(invNo), `المتوقع extra يحتوي رقم الفاتورة "${invNo}"، طلع "${saleEntry.extra}"`);
}

// ════════════════════════════════════════════════════════════════════════
// UI MESSAGING REDESIGN — closeModal async dirty-check + تصنيف أخطاء مركزي
// ════════════════════════════════════════════════════════════════════════
// راجع project_ui_restructure_needed_warnings_approvals في الذاكرة. closeModal
// بقت async (تستخدم confirmAsync الجديدة بدل confirm() الأصلية المتزامنة) —
// السيناريوهات هنا بتختبر فرعي القرار الحقيقيين جوه closeModal نفسها، بلا
// تقليد. _modalDirty خاص بالوحدة (module-private) — __setModalDirtyForTest
// (اختبار فقط، utils.js) بتحضّر حالة "متسخ" مباشرة بدل محاكاة حدث input/change
// كامل (غير متاح في بيئة الاختبار headless — addEventListener بتاع الـstub
// no-op، راجع تعليق __setModalDirtyForTest نفسه لتفاصيل السبب. نفس القيد
// بيمنع اختبار مسار "المستخدم ضغط إلغاء" آليًا — showConfirm نفسها مُستبدَلة
// بـstub تلقائي التأكيد لكل السويت (installConfirmStub)، وزرار الإلغاء مش
// قابل للوصول من بره confirmAsync أصلاً؛ ده قرار تصميم واعٍ للسويت كله (كل
// تأكيد "بيتأكَّد" تلقائيًا)، مش فجوة في هذا الاختبار تحديدًا).

// UM1 — closeModal(dirty=true, بلا markSaving): لازم يستدعي showConfirm فعليًا
// (عبر confirmAsync) وينتظر رده — مع الـstub تلقائي التأكيد الافتراضي، لازم
// يرجع وينظّف بلا "تعليق" (نفس البلاغ الأصلي: كانت النافذة بتفضل معلَّقة في
// أي سياق آلي بلا ضغطة زر حقيقية — لازم دلوقتي await يشتغل وينتهي طبيعي)
async function um1_closeModalDirtyAwaitsAndProceeds(app) {
  const id = 'ZZTEST-UM1-' + Date.now();
  app.utils.__setModalDirtyForTest(id, true);
  let showConfirmCalled = false;
  const original = globalThis.showConfirm;
  globalThis.showConfirm = (title, msg, onConfirm) => { showConfirmCalled = true; return original(title, msg, onConfirm); };
  try {
    await app.utils.closeModal(id); // لازم يكمل بلا throw وبلا تعليق
  } finally {
    globalThis.showConfirm = original;
  }
  assert(showConfirmCalled, 'closeModal لمودال متسخ بلا markSaving لازم يستدعي showConfirm فعليًا');
}

// UM2 — closeModal(dirty=true, markSaving مُسجَّل قبلها): لازم يتخطى فحص الـ
// dirty بالكامل، showConfirm ما ينادوش خالص — هذا بالظبط الفرع اللي بيحمي كل
// الـ~30 موقع markSaving+closeModal في المشروع من نفس مشكلة "التعليق"، حتى
// بعد ما بقت async
async function um2_closeModalMarkSavingSkipsDirtyCheck(app) {
  const id = 'ZZTEST-UM2-' + Date.now();
  app.utils.__setModalDirtyForTest(id, true);
  app.utils.markSaving(id);
  let showConfirmCalled = false;
  const original = globalThis.showConfirm;
  globalThis.showConfirm = () => { showConfirmCalled = true; throw new Error('لا يجب استدعاء showConfirm هنا — markSaving لازم يتخطى الفحص بالكامل'); };
  try {
    await app.utils.closeModal(id); // لازم يكمل فورًا بلا استدعاء showConfirm
  } finally {
    globalThis.showConfirm = original;
  }
  assert(!showConfirmCalled, 'closeModal بعد markSaving لازم يتخطى فحص الـdirty بالكامل، بلا أي استدعاء لـshowConfirm');
}

// UM3 — closeModal(dirty=false): نفس UM2 — بلا markSaving أصلاً، بس الحالة
// الافتراضية (مش متسخة) لازم برضه تتخطى showConfirm تمامًا
async function um3_closeModalNotDirtySkipsConfirm(app) {
  const id = 'ZZTEST-UM3-' + Date.now();
  app.utils.__setModalDirtyForTest(id, false);
  let showConfirmCalled = false;
  const original = globalThis.showConfirm;
  globalThis.showConfirm = () => { showConfirmCalled = true; throw new Error('لا يجب استدعاء showConfirm هنا — المودال مش متسخ أصلاً'); };
  try {
    await app.utils.closeModal(id);
  } finally {
    globalThis.showConfirm = original;
  }
  assert(!showConfirmCalled, 'closeModal لمودال غير متسخ لازم يتخطى showConfirm بالكامل');
}

// UM4 — تعميم تصنيف "قيد فريد" (core.js): قيد فريد حقيقي موجود بالفعل في
// القاعدة (uq_je_ref_primary_posted — نفس القيد من إصلاح is_primary_line
// السابق)، مش uniq_expense_active/uniq_payment_active الأصليين — يتأكد إن
// apiPost بترجع رسالة عربية مفهومة برضه ("قيد فريد: uq_je_ref_primary_posted")
// بدل نص postgres الخام، بلا الاقتصار على الاسمين الأصليين بس
async function um4_uniqueConstraintGeneralizedToAnyName(app) {
  const fileNo = zid('UM4');
  registerExtraFileNo(fileNo);
  const poRow = await apiPost('purchase_orders', {
    system_type: SYS, file_no: fileNo, supplier: 'ZZTEST-SUPPLIER',
    total_purchase: 100, post_status: 'draft', notes: 'ZZTEST regression UM4 fixture',
  });
  registerCleanup('purchase_orders', poRow[0].id);
  const refId = zid('UM4-REF');

  const baseLine = {
    system_type: SYS, entry_no: zid('JE-UM4'), entry_date: today(),
    account_code: '1300', account_name: 'ZZTEST', dr_amount: 100, cr_amount: 0,
    description: 'ZZTEST UM4', ref_table: 'reversal', ref_id: refId, file_no: fileNo,
    post_status: 'posted', posted_at: new Date().toISOString(), is_primary_line: true,
  };
  const firstRow = await apiPost('journal_entries', baseLine);
  registerCleanup('journal_entries', firstRow[0].id);

  let threw = null;
  try {
    await apiPost('journal_entries', { ...baseLine, entry_no: zid('JE-UM4-DUP') });
  } catch (e) { threw = e; }
  assert(threw, 'المتوقع apiPost يفشل بقيد فريد (uq_je_ref_primary_posted) للسطر الثاني بنفس (system_type, file_no, ref_id, ref_table, is_primary_line=true, posted)');
  assert(/قيد فريد: uq_je_ref_primary_posted/.test(threw.message), `المتوقع رسالة مصنَّفة تحتوي "قيد فريد: uq_je_ref_primary_posted"، طلعت: "${threw.message}"`);
}

// UM5 — تصنيف خطأ الشبكة (apiFetch/core.js): محاكاة "Failed to fetch" فعلية
// (TypeError حقيقي، نفس نوع الخطأ اللي المتصفح بيرميه لما الطلب ما يوصلش
// للخادم خالص) عبر استبدال مؤقت لـglobal.fetch — يتأكد إن الرسالة النهائية
// توضّح إن العملية "غالبًا نجحت" بدل نص "Failed to fetch" المضلِّل الخام
async function um5_networkErrorClassified(app) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  let threw = null;
  try {
    await apiGetAll('purchase_orders', { select: 'id', limit: 1 });
  } catch (e) { threw = e; } finally {
    globalThis.fetch = originalFetch;
  }
  assert(threw, 'المتوقع apiGetAll يفشل لما fetch نفسها بترمي TypeError');
  assert(/قد تكون نجحت فعلاً/.test(threw.message), `المتوقع رسالة مصنَّفة تحتوي "قد تكون نجحت فعلاً"، طلعت: "${threw.message}"`);
  assert(!/Failed to fetch/.test(threw.message), `المتوقع عدم ظهور نص "Failed to fetch" الخام في الرسالة النهائية، طلعت: "${threw.message}"`);
}

// ════════════════════════════════════════════════════════════════════════
// APPROVE ITEM — إصلاح باج "موافقة صامتة بلا قيد محاسبي" (اكتُشف حيًّا
// 2026-08-03، TM-023)
// ════════════════════════════════════════════════════════════════════════
// approveItem كانت بتاخد approvedItem عبر approvalState.all.find(...) —
// لو الكاش فاضي/قديم (approveItem اتنادت بلا loadApprovalQueue() قبلها)،
// approvedItem بيبقى undefined، والقيد كان بيتخطى بصمت (if(approvedItem){...})
// بينما الترحيل لـposted كان بيحصل قبلها بلا شرط أصلاً. الإصلاح: fallback
// جلب مباشر من القاعدة بالـid، ولو لسه مالقيناهوش نوقف بالكامل قبل أي تعديل.
// السيناريو هنا بيستدعي approveItem الحقيقية على سجل حقيقي (ZZTEST) بلا أي
// نداء لـloadApprovalQueue() قبلها — نفس ظرف الباج بالحرف، مش تقليد.

async function waitUntilPosted(table, id, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await apiGetAll(table, { select: 'post_status', id: `eq.${id}` });
    if (rows?.[0]?.post_status === 'posted') return rows[0];
    await new Promise(r => setTimeout(r, 200));
  }
  const rows = await apiGetAll(table, { select: 'post_status', id: `eq.${id}` });
  return rows?.[0] || null;
}

// ✅ post_status='posted' بيتحقق قبل إنشاء القيد (الترتيب الأصلي في approveItem
// نفسها — الباتش يسبق _createApprovalJE) — الانتظار على post_status وحده مش
// كافٍ هنا، القيد بيتكوّن في خطوة لاحقة (IIFE خلفية غير مُنتظَرة من المستدعي)
async function waitUntilJEExists(sys, refTable, refId, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await apiGetAll('journal_entries', {
      select: 'id', system_type: `eq.${sys}`, ref_table: `eq.${refTable}`, ref_id: `eq.${refId}`, post_status: 'eq.posted',
    });
    if (rows?.length) return rows;
    await new Promise(r => setTimeout(r, 200));
  }
  return apiGetAll('journal_entries', {
    select: 'id', system_type: `eq.${sys}`, ref_table: `eq.${refTable}`, ref_id: `eq.${refId}`, post_status: 'eq.posted',
  });
}

async function ai1_approveItemEmptyCacheStillCreatesJE(app) {
  // ✅ نظام TM عمدًا (بدل SYS='BOX' المشترك) — نفس نظام الاكتشاف الحي (TM-023)
  const AI_SYS = 'TM';
  const fileNo = zid('AI1');
  registerExtraFileNo(fileNo);
  const poRow = await apiPost('purchase_orders', {
    system_type: AI_SYS, file_no: fileNo, supplier: 'ZZTEST-SUPPLIER',
    total_purchase: 100, post_status: 'draft', notes: 'ZZTEST regression AI1 fixture',
  });
  registerCleanup('purchase_orders', poRow[0].id);

  const expRow = await apiPost('expenses', {
    system_type: AI_SYS, file_no: fileNo, exp_id: zid('EXP'), ref_no: zid('EXP'), pay_id: zid('EXP'),
    description: 'ZZTEST AI1 empty-cache approval', exp_type: 'أخرى', pay_method: 'نقد',
    exp_date: today(), amount: 150, post_status: 'draft',
  });
  registerCleanup('expenses', expRow[0].id);

  const prevSys = app.state.system;
  app.state.system = AI_SYS;
  try {
    // ✅ بلا loadApprovalQueue() عمدًا — approvalState.all تفضل بلا هذا السجل،
    // نفس ظرف الباج بالحرف. approveItem الحقيقية (بلا تقليد).
    assert(
      !app.transactions.approvalState.all.some(r => String(r.id) === String(expRow[0].id)),
      'شرط مسبق: السجل ما لازمش يكون موجود في approvalState.all (الكاش فاضي/غير محمَّل)'
    );
    await app.operations.approveItem('expense', expRow[0].id);

    const after = await waitUntilPosted('expenses', expRow[0].id);
    assert(after?.post_status === 'posted', `المتوقع post_status='posted' بعد الموافقة (حتى مع كاش فاضي)، طلع '${after?.post_status}'`);

    const je = await waitUntilJEExists(AI_SYS, 'expenses', expRow[0].id);
    assert(je?.length >= 1, `المتوقع قيد محاسبي واحد على الأقل مرتبط — طلع ${je?.length || 0} (الباج الأصلي: صفر قيد بصمت)`);
  } finally {
    app.state.system = prevSys;
  }
}

// ════════════════════════════════════════════════════════════════════════
// APPROVAL QUEUE UX ITEMS (بند 4 المؤجَّل سابقًا، اتفَق على تنفيذه اليوم)
// ════════════════════════════════════════════════════════════════════════
// راجع project_ui_restructure_needed_warnings_approvals في الذاكرة.

// UM6 — طابور showConfirm الحقيقي (reports.js): نداء تانٍ قبل ما الأول
// يترد عليه لازم "يستنى دوره" — العنوان المعروض يفضل بتاع الأول لحد ما
// نرد عليه، وبعدين يتحول لبتاع الثاني تلقائيًا. getElementById بقت ثابتة
// لكل id (راجع stableEl في _headless-app-env.js) — ضروري هنا تحديدًا عشان
// نقدر "نضغط" نفس زرار _runConfirm الحقيقي من بره.
async function um6_showConfirmRealQueue(app) {
  const original = globalThis.showConfirm;
  let confirmedA = false, confirmedB = false;
  // ✅ app.reports.showConfirm هي النسخة المُصحَّحة تلقائية التأكيد (loadPatchedReports —
  // مطلوبة لباقي الـ99 سيناريو). عشان نختبر الطابور الحقيقي فعليًا، نستورد
  // js/reports.js خام (بلا تصحيح) مباشرة — نفس أسلوب سكريبت التحقيق المستقل
  // اللي أثبت باج التداخل الأصلي (repro_um4_confirm_overwrite.js)
  const realReports = await import('file:///C:/Users/hamdy/Documents/tarnsit%20app/transitapp/js/reports.js?um6=' + Date.now());
  globalThis.showConfirm = realReports.showConfirm;
  try {
    globalThis.showConfirm('عنوان أ', 'رسالة أ', () => { confirmedA = true; });
    globalThis.showConfirm('عنوان ب', 'رسالة ب', () => { confirmedB = true; });

    // ✅ لسه العنوان المعروض لازم يكون "أ" — "ب" في الطابور مستنية
    await new Promise(r => setTimeout(r, 50));
    assert(document.getElementById('confirmDeleteTitle').textContent === 'عنوان أ',
      `المتوقع العنوان المعروض يفضل "عنوان أ" لحد ما نرد عليه، طلع "${document.getElementById('confirmDeleteTitle').textContent}"`);
    assert(!confirmedB, 'المتوقع onConfirm بتاع "ب" ما يتنفّذش قبل ما "أ" يترد عليه');

    // ✅ نرد على "أ" (نضغط تأكيد) — لازم "ب" يظهر بعدها مباشرة (دوره جه)
    document.getElementById('confirmDeleteOkBtn').onclick();
    await new Promise(r => setTimeout(r, 50));
    assert(confirmedA, 'المتوقع onConfirm بتاع "أ" يتنفّذ بعد الرد عليه');
    assert(document.getElementById('confirmDeleteTitle').textContent === 'عنوان ب',
      `المتوقع العنوان يتحول لـ"عنوان ب" بعد رد "أ"، طلع "${document.getElementById('confirmDeleteTitle').textContent}"`);

    // ✅ نرد على "ب" كمان — تنظيف الطابور قبل باقي السويت
    document.getElementById('confirmDeleteOkBtn').onclick();
    await new Promise(r => setTimeout(r, 50));
    assert(confirmedB, 'المتوقع onConfirm بتاع "ب" يتنفّذ بعد الرد عليه');
  } finally {
    globalThis.showConfirm = original;
  }
}

// UM7 — approveAll لسه شغّالة صح بعد التحويل لـconfirmAsync (بدل showConfirm
// الخام) — بيانات ZZTEST حقيقية على نظام TM، القيود بتتكوّن صح والسجلات
// بترحّل، مش بس "الكود بيتنفّذ بلا خطأ"
async function um7_approveAllStillWorksAfterConfirmAsyncRefactor(app) {
  const AI_SYS = 'TM';
  const fileNo = zid('UM7');
  registerExtraFileNo(fileNo);
  const poRow = await apiPost('purchase_orders', {
    system_type: AI_SYS, file_no: fileNo, supplier: 'ZZTEST-SUPPLIER',
    total_purchase: 100, post_status: 'draft', notes: 'ZZTEST regression UM7 fixture',
  });
  registerCleanup('purchase_orders', poRow[0].id);

  const exp1 = await apiPost('expenses', {
    system_type: AI_SYS, file_no: fileNo, exp_id: zid('EXP'), ref_no: zid('EXP'), pay_id: zid('EXP'),
    description: 'ZZTEST UM7 expense 1', exp_type: 'أخرى', pay_method: 'نقد',
    exp_date: today(), amount: 40, post_status: 'draft',
  });
  registerCleanup('expenses', exp1[0].id);
  const exp2 = await apiPost('expenses', {
    system_type: AI_SYS, file_no: fileNo, exp_id: zid('EXP'), ref_no: zid('EXP'), pay_id: zid('EXP'),
    description: 'ZZTEST UM7 expense 2', exp_type: 'أخرى', pay_method: 'نقد',
    exp_date: today(), amount: 60, post_status: 'draft',
  });
  registerCleanup('expenses', exp2[0].id);

  const prevSys = app.state.system;
  app.state.system = AI_SYS;
  try {
    await app.operations.loadApprovalQueue();
    app.operations.filterApproval('all');
    const ourItems = app.transactions.approvalState.filtered.filter(r => r._file === fileNo || r.file_no === fileNo);
    // ✅ 3 بنود متوقَّعة: poRow نفسه (draft) بيظهر كبند "شراء" في القائمة كمان،
    // زي أي سند شراء draft — مش بس المصروفين المقصودين
    assert(ourItems.length === 3, `المتوقع 3 بنود من ملفنا (سند الشراء + مصروفين) في approvalState.filtered، طلع ${ourItems.length}`);
    app.transactions.approvalState.filtered = ourItems; // نعزل approveAll عن أي بند تاني موجود فعليًا في القائمة الحية

    await app.operations.approveAll(); // بلا وسيط زرار — confirmAsync + الـstub التلقائي يكفوا هنا

    const afterPo = await waitUntilPosted('purchase_orders', poRow[0].id);
    const after1 = await waitUntilPosted('expenses', exp1[0].id);
    const after2 = await waitUntilPosted('expenses', exp2[0].id);
    assert(afterPo?.post_status === 'posted', `المتوقع سند الشراء posted، طلع '${afterPo?.post_status}'`);
    assert(after1?.post_status === 'posted', `المتوقع exp1 posted، طلع '${after1?.post_status}'`);
    assert(after2?.post_status === 'posted', `المتوقع exp2 posted، طلع '${after2?.post_status}'`);

    const jePo = await waitUntilJEExists(AI_SYS, 'purchase_orders', poRow[0].id);
    const je1 = await waitUntilJEExists(AI_SYS, 'expenses', exp1[0].id);
    const je2 = await waitUntilJEExists(AI_SYS, 'expenses', exp2[0].id);
    assert(jePo?.length >= 1, 'المتوقع قيد لسند الشراء');
    assert(je1?.length >= 1, 'المتوقع قيد لـexp1');
    assert(je2?.length >= 1, 'المتوقع قيد لـexp2');
  } finally {
    app.state.system = prevSys;
  }
}

// UM8 — renderApprovalList بتعرض زرار "رفض" مباشر (مش مخبّى جوه "⋮") للأنواع
// العادية (غير طلب إلغاء) — فحص على المُخرَج الفعلي، بلا تقليد لمنطق البناء
async function um8_renderApprovalListShowsDirectRejectButton(app) {
  const prevAll = app.transactions.approvalState.all;
  const prevFiltered = app.transactions.approvalState.filtered;
  try {
    app.transactions.approvalState.all = [{
      id: 'zztest-um8', _type: 'expense', _amount: 100, _date: today(),
      _desc: 'ZZTEST UM8 row', _file: 'ZZTEST-UM8-FILE', ref_no: 'ZZTEST-REF', created_at: new Date().toISOString(),
    }];
    app.operations.filterApproval('all');
    const html = document.getElementById('approval-list').innerHTML;
    assert(html.includes('✗ رفض'), 'المتوقع زرار "✗ رفض" ظاهر مباشرة في الصف (مش مخبّى جوه ⋮)');
    assert(html.includes("rejectItem('expense','zztest-um8')"), 'المتوقع زرار الرفض ينادي rejectItem مباشرة بنفس النوع/id');
    assert(html.includes('_ctxApproval(this)'), 'المتوقع زرار "⋮" يفضل موجود كمان (لتعديل/إلغاء)');
  } finally {
    app.transactions.approvalState.all = prevAll;
    app.transactions.approvalState.filtered = prevFiltered;
  }
}

// ════════════════════════════════════════════════════════════════════════
// IDEMPOTENCY KEY — بديل uniq_expense_active/uniq_payment_active
// ════════════════════════════════════════════════════════════════════════
// راجع sql/add_idempotency_key_expenses_payments.sql وjs/utils.js
// (newIdemKey/warnIfSimilarActive). idem3/idem4 يتطلبان العمود idempotency_key
// فعليًا على القاعدة الحية — بيتفحصا ذاتيًا عبر idemKeyColumnReady() ويُتخطَّيا
// بوضوح (بلا فشل مصطنع) لو الهجرة SQL لسه ما اتنفذتش.

async function idemKeyColumnReady() {
  try {
    await apiGetAll('expenses', { select: 'idempotency_key', limit: 1 });
    return true;
  } catch (_) {
    return false;
  }
}

async function idem1_newIdemKeyDistinctUUIDs(app) {
  const a = app.utils.newIdemKey();
  const b = app.utils.newIdemKey();
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  assert(uuidRe.test(a), `المتوقع newIdemKey() يرجع UUID صالح، طلع '${a}'`);
  assert(uuidRe.test(b), `المتوقع newIdemKey() يرجع UUID صالح، طلع '${b}'`);
  assert(a !== b, 'المتوقع مفتاحين مختلفين لنداءين منفصلين');
}

// idem2a — لا تشابه نشط → true فورًا بلا أي عرض تأكيد؛ صف مشابه لكن voided → يُتجاهَل
async function idem2a_warnIfSimilarActiveNoMatchAndVoidedIgnored(app) {
  const fileNo = zid('IDEM2A');
  registerExtraFileNo(fileNo);
  const poRow = await apiPost('purchase_orders', {
    system_type: SYS, file_no: fileNo, supplier: 'ZZTEST-SUPPLIER',
    total_purchase: 100, post_status: 'draft', notes: 'ZZTEST IDEM2A fixture',
  });
  registerCleanup('purchase_orders', poRow[0].id);
  const dateStr = today();

  // لا صفوف مطابقة إطلاقًا → true بلا أي نداء showConfirm
  const originalSC1 = globalThis.showConfirm;
  let confirmCalled1 = false;
  globalThis.showConfirm = (...args) => { confirmCalled1 = true; return originalSC1(...args); };
  try {
    const proceed1 = await app.utils.warnIfSimilarActive('expenses', {
      select: 'id,post_status', system_type: `eq.${SYS}`, file_no: `eq.${fileNo}`,
      amount: 'eq.999', description: 'eq.ZZTEST-NOTHING-MATCHES', exp_date: `eq.${dateStr}`,
    }, 'مصروف');
    assert(proceed1 === true, 'المتوقع true لما مفيش أي صف مطابق');
    assert(!confirmCalled1, 'المتوقع showConfirm ما يتناداش خالص لما مفيش تشابه');
  } finally { globalThis.showConfirm = originalSC1; }

  // صف مطابق تمامًا لكن post_status='voided' → يُعتبر "غير نشط" ويُتجاهَل
  const voidedRow = await apiPost('expenses', {
    system_type: SYS, file_no: fileNo, exp_id: zid('EXP'), ref_no: zid('EXP'), pay_id: zid('EXP'),
    description: 'ZZTEST IDEM2A voided-match', exp_type: 'أخرى', pay_method: 'نقد',
    exp_date: dateStr, amount: 55, post_status: 'voided',
  });
  registerCleanup('expenses', voidedRow[0].id);
  const originalSC2 = globalThis.showConfirm;
  let confirmCalled2 = false;
  globalThis.showConfirm = (...args) => { confirmCalled2 = true; return originalSC2(...args); };
  try {
    const proceed2 = await app.utils.warnIfSimilarActive('expenses', {
      select: 'id,post_status', system_type: `eq.${SYS}`, file_no: `eq.${fileNo}`,
      amount: 'eq.55', description: 'eq.ZZTEST IDEM2A voided-match', exp_date: `eq.${dateStr}`,
    }, 'مصروف');
    assert(proceed2 === true, 'المتوقع true — الصف الوحيد المطابق ملغى (voided)، لا يُحسب تشابهًا نشطًا');
    assert(!confirmCalled2, 'المتوقع showConfirm ما يتناداش خالص — الصف المطابق الوحيد voided');
  } finally { globalThis.showConfirm = originalSC2; }
}

// idem2b — صف مطابق فعلاً نشط: المستخدم يوافق → true، المستخدم يرفض → false
// (نفس أسلوب UM6: استيراد reports.js الخام مباشرة عشان نتحكم في الرد فعليًا)
async function idem2b_warnIfSimilarActiveConfirmDeclineRespected(app) {
  const fileNo = zid('IDEM2B');
  registerExtraFileNo(fileNo);
  const poRow = await apiPost('purchase_orders', {
    system_type: SYS, file_no: fileNo, supplier: 'ZZTEST-SUPPLIER',
    total_purchase: 100, post_status: 'draft', notes: 'ZZTEST IDEM2B fixture',
  });
  registerCleanup('purchase_orders', poRow[0].id);
  const dateStr = today();
  const activeRow = await apiPost('expenses', {
    system_type: SYS, file_no: fileNo, exp_id: zid('EXP'), ref_no: zid('EXP'), pay_id: zid('EXP'),
    description: 'ZZTEST IDEM2B active-match', exp_type: 'أخرى', pay_method: 'نقد',
    exp_date: dateStr, amount: 88, post_status: 'draft',
  });
  registerCleanup('expenses', activeRow[0].id);

  const matchParams = {
    select: 'id,post_status', system_type: `eq.${SYS}`, file_no: `eq.${fileNo}`,
    amount: 'eq.88', description: 'eq.ZZTEST IDEM2B active-match', exp_date: `eq.${dateStr}`,
  };

  // موافقة (auto-confirm الافتراضي بيوافق دائمًا) → true
  const proceedYes = await app.utils.warnIfSimilarActive('expenses', matchParams, 'مصروف');
  assert(proceedYes === true, 'المتوقع true — تشابه نشط موجود والمستخدم وافق على المتابعة');

  // رفض — نحتاج showConfirm الخام الحقيقي (الـstub التلقائي دايمًا بيوافق)
  const realReports = await import('file:///C:/Users/hamdy/Documents/tarnsit%20app/transitapp/js/reports.js?idem2b=' + Date.now());
  const originalSC = globalThis.showConfirm;
  globalThis.showConfirm = realReports.showConfirm;
  try {
    const p = app.utils.warnIfSimilarActive('expenses', matchParams, 'مصروف');
    // ✅ warnIfSimilarActive بينتظر apiGetAll (نداء شبكة حقيقي) قبل ما يوصل
    // لـshowConfirm أصلاً — بعكس UM6 (نداء showConfirm مباشر بلا شبكة قبله)،
    // فيه سباق حقيقي هنا. نستنى فعليًا لحد ما زرار الإلغاء يتربط بمعالج حقيقي
    // (لا timeout ثابت قصير — كان بيفشل أحيانًا حسب زمن استجابة الشبكة)
    const cancelBtn = document.getElementById('confirmDeleteCancelBtn');
    assert(cancelBtn, 'المتوقع زرار الإلغاء موجود في DOM');
    // ✅ فحص "onclick بقت function" وحده غير كافٍ — cancelBtn عنصر مُخزَّن ثابت
    // (stableEl) بيتشارك عبر كل السويت؛ لو سيناريو سابق حقيقي (UM6) خلّى
    // onclick بالفعل function من نداء قديم، الفحص كان بينجح فورًا ويدوس زرار
    // "باقي" مش زرار *هذه* المحاولة — فـp الحقيقية تفضل معلَّقة للأبد (اكتُشف
    // حيًّا 2026-08-07: السويت كان بيهنج بصمت هنا بالظبط لما IDEM2B بيجي بعد
    // UM6). الفحص الصحيح: العنوان المعروض فعليًا لازم يبقى عنوان *هذه* المحاولة
    const titleEl = document.getElementById('confirmDeleteTitle');
    const expectedTitle = '⚠️ بند مشابه موجود بالفعل';
    const start = Date.now();
    while (titleEl?.textContent !== expectedTitle && Date.now() - start < 8000) {
      await new Promise(r => setTimeout(r, 20));
    }
    assert(titleEl?.textContent === expectedTitle, `المتوقع عنوان التأكيد الفعلي "${expectedTitle}" خلال 8 ثوانٍ، طلع "${titleEl?.textContent}"`);
    assert(typeof cancelBtn.onclick === 'function', 'المتوقع زرار الإلغاء مربوط بمعالج فعلي بعد ظهور العنوان الصحيح');
    cancelBtn.onclick();
    const proceedNo = await p;
    assert(proceedNo === false, 'المتوقع false — تشابه نشط موجود والمستخدم رفض المتابعة');
  } finally { globalThis.showConfirm = originalSC; }
}

// idem3 — نفس مفتاح idempotency مرتين → الإدراج الثاني يُرفَض (فهرس فريد جزئي حقيقي)
async function idem3_duplicateIdempotencyKeyRejected(app) {
  const fileNo = zid('IDEM3');
  registerExtraFileNo(fileNo);
  const poRow = await apiPost('purchase_orders', {
    system_type: SYS, file_no: fileNo, supplier: 'ZZTEST-SUPPLIER',
    total_purchase: 100, post_status: 'draft', notes: 'ZZTEST IDEM3 fixture',
  });
  registerCleanup('purchase_orders', poRow[0].id);

  const key = app.utils.newIdemKey();
  const row1 = await apiPost('expenses', {
    system_type: SYS, file_no: fileNo, exp_id: zid('EXP'), ref_no: zid('EXP'), pay_id: zid('EXP'),
    description: 'ZZTEST IDEM3 attempt 1', exp_type: 'أخرى', pay_method: 'نقد',
    exp_date: today(), amount: 33, post_status: 'draft', idempotency_key: key,
  });
  registerCleanup('expenses', row1[0].id);

  let rejected = false;
  try {
    await apiPost('expenses', {
      system_type: SYS, file_no: fileNo, exp_id: zid('EXP'), ref_no: zid('EXP'), pay_id: zid('EXP'),
      description: 'ZZTEST IDEM3 attempt 2 (retry)', exp_type: 'أخرى', pay_method: 'نقد',
      exp_date: today(), amount: 33, post_status: 'draft', idempotency_key: key,
    });
  } catch (e) {
    rejected = true;
  }
  assert(rejected, 'المتوقع الإدراج الثاني بنفس idempotency_key يُرفَض (فهرس فريد جزئي)');
}

// idem4 — نفس الحقول التجارية (مبلغ+وصف+تاريخ+ملف)، مفتاحين مختلفين → الإدراجان
// ينجحان (القيد الصلب القديم uniq_expense_active اتشال فعلاً)
async function idem4_similarBusinessFieldsNoLongerBlocked(app) {
  const fileNo = zid('IDEM4');
  registerExtraFileNo(fileNo);
  const poRow = await apiPost('purchase_orders', {
    system_type: SYS, file_no: fileNo, supplier: 'ZZTEST-SUPPLIER',
    total_purchase: 100, post_status: 'draft', notes: 'ZZTEST IDEM4 fixture',
  });
  registerCleanup('purchase_orders', poRow[0].id);

  const dateStr = today();
  const shared = {
    system_type: SYS, file_no: fileNo, description: 'ZZTEST IDEM4 legit-duplicate',
    exp_type: 'أخرى', pay_method: 'نقد', exp_date: dateStr, amount: 21, post_status: 'draft',
  };
  const row1 = await apiPost('expenses', { ...shared, exp_id: zid('EXP'), ref_no: zid('EXP'), pay_id: zid('EXP'), idempotency_key: app.utils.newIdemKey() });
  registerCleanup('expenses', row1[0].id);
  const row2 = await apiPost('expenses', { ...shared, exp_id: zid('EXP'), ref_no: zid('EXP'), pay_id: zid('EXP'), idempotency_key: app.utils.newIdemKey() });
  registerCleanup('expenses', row2[0].id);

  assert(row1[0].id !== row2[0].id, 'المتوقع صفين منفصلين فعليًا — نفس الحقول التجارية، مفتاحين مختلفين');
}

(async () => {
  console.log('Track A — Phase 0 Regression Suite');
  console.log('file_no تجريبي:', FILE_NO, '| نظام:', SYS);
  console.log('يستدعي الكود الإنتاجي الفعلي (postDoubleEntry/je_*/updateJEInPlace/voidTransaction/');
  console.log('_processEditApproval/_processReversalApproval) — لا إعادة تنفيذ يدوي لمنطق القيود.\n');

  try {
    app = await loadApp();
    await sweepZZTestLeftovers();

    // ✅ Track A / Phase 1 — js/lifecycle.js دلوقتي مصدر الحقيقة الوحيد لقرار
    // "تعديل سجل مُعتمَد". بما إنه DOM-مستقل بطبيعته (دالتان صرفتان، بلا أي
    // تبعية UI)، نستورده هنا حقيقيًا (مش تقليد) ونتأكد من كل قيم post_status
    // الممكنة — هذا يغلق فجوة كانت موجودة في نسخة Phase 0 (كان القرار وقتها
    // مُقلَّدًا يدويًا داخل كل سيناريو لعدم وجود دالة مشتركة حقيقية بعد)
    await scenario('lifecycle.js / wasAlreadyPosted و statusAfterEdit — جدول الحقيقة الكامل', async () => {
      const lifecycle = await import('file:///C:/Users/hamdy/Documents/tarnsit%20app/transitapp/js/lifecycle.js');
      const cases = [
        ['posted', true, 'pending_edit'],
        ['pending_edit', true, 'pending_edit'],
        ['draft', false, 'draft'],
        ['pending_void', false, 'draft'],
        ['cancelled', false, 'draft'],
        ['voided', false, 'draft'],
        [null, false, 'draft'],
        [undefined, false, 'draft'],
      ];
      for (const [status, expectPosted, expectAfter] of cases) {
        assert(lifecycle.wasAlreadyPosted(status) === expectPosted, `wasAlreadyPosted(${status}) لازم ${expectPosted}`);
        assert(lifecycle.statusAfterEdit(status) === expectAfter, `statusAfterEdit(${status}) لازم ${expectAfter}`);
      }
    });

    // ✅ expenses/payments/collections/partner_payouts كلها بها FK على file_no
    // → purchase_orders(file_no) — لازم سند شراء ZZTEST حقيقي موجود قبل أي إدراج
    const poRow = await apiPost('purchase_orders', {
      system_type: SYS, file_no: FILE_NO, supplier: 'ZZTEST-SUPPLIER',
      total_purchase: 1, post_status: 'draft', notes: 'ZZTEST Track A regression fixture',
    });
    registerCleanup('purchase_orders', poRow[0].id);

    const configs = buildEntityConfigs(app);

    for (const cfg of configs) {
      console.log(`\n── ${cfg.label} ──`);
      await scenario(`${cfg.label} / S1 draft→edit يفضل draft بلا قيد`, () => s1_draftEditStaysDraft(cfg, app));
      await scenario(`${cfg.label} / S2 posted→edit يترقّى pending_edit + قيد محدَّث فعليًا`, () => s2_postedEditPromotes(cfg, app));
      await scenario(`${cfg.label} / S3 pending_edit→موافقة يبقى posted بلا تكرار قيد`, () => s3_pendingEditApprove(cfg, app));
      await scenario(`${cfg.label} / S4 draft→رفض يبقى cancelled بلا قيد`, () => s4_draftReject(cfg));
      await scenario(`${cfg.label} / S5 posted→طلب إلغاء→موافقة يبقى voided+قيد عكسي متوازن`, () => s5_voidRequestApprove(cfg, app));
      await scenario(`${cfg.label} / S6 posted→طلب إلغاء→رفض يرجع posted بلا قيد يتيم`, () => s6_voidRequestReject(cfg, app));
    }

    // ✅ purchase_orders (Track A Phase 1 Step B) — يغطي فعليًا العلة اللي
    // submitEditFileFull كانت بتقع فيها (updateJEInPlace بلا شرط) قبل الإصلاح
    console.log(`\n── purchase_orders (Step B) ──`);
    await scenario('purchase_orders / S1 draft→edit يفضل draft بلا قيد', () => poS1_draftEditStaysDraft(app));
    await scenario('purchase_orders / S2 posted→edit يترقّى pending_edit + قيد محدَّث فعليًا', () => poS2_postedEditPromotes(app));
    await scenario('purchase_orders / S3 pending_edit→موافقة يبقى posted بلا تكرار قيد', () => poS3_pendingEditApprove(app));

    // ✅ Phase 2 — قرار الحذف/الإلغاء (draft→حذف مباشر، posted→voidTransaction)
    // يختبر الدوال المُشغِّلة الحقيقية عبر وضعي entryStatus() الاثنين — راجع
    // الشرح التوثيقي فوق p2_draftDelete لتفاصيل الفجوة المتوقَّعة حاليًا
    console.log(`\n── Phase 2: قرار الحذف/الإلغاء ──`);
    for (const cfg of configs) {
      await scenario(`${cfg.label} / P2-draft حذف مباشر (entryStatus=draft)`, () => p2_draftDelete(cfg, app, 'draft'));
      await scenario(`${cfg.label} / P2-draft حذف مباشر (entryStatus=posted)`, () => p2_draftDelete(cfg, app, 'posted'));
      await scenario(`${cfg.label} / P2-posted إلغاء بقيد عكسي متوازن`, () => p2_postedDelete(cfg, app));
      await scenario(`${cfg.label} / P2-reject pending_edit يفضل كما هو`, () => p2_rejectPendingEdit(cfg, app));
    }
    await scenario('collections / P2 حالة حافة — draft بلا paid_date → حذف حقيقي', () => p2_collectionsNoPaidDate(app, 'draft'));
    await scenario('collections / P2 حالة حافة — posted بلا paid_date → حذف حقيقي', () => p2_collectionsNoPaidDate(app, 'posted'));
    setEntryStatus(app, 'draft'); // إعادة الوضع الافتراضي بعد خلوص السويت

    // ✅ إصلاح ازدواج is_primary_line على قيود العكس (اكتُشف حيًّا 2026-07-30، TM-004)
    console.log(`\n── إصلاح ازدواج reversal is_primary_line (postDoubleEntry) ──`);
    for (const cfg of configs) {
      await scenario(`${cfg.label} / P3 تعديل ثم تعديل — عكس واحد نشط بس`, () => p3_editThenEdit(cfg, app));
      await scenario(`${cfg.label} / P3 تعديل ثم إلغاء — عكس واحد نشط بس`, () => p3_editThenVoid(cfg, app));
    }
    await scenario('purchase_orders / P3 تعديل ثم تعديل — عكس واحد نشط بس', () => p3po_editThenEdit(app));

    // ✅ توزيع مصروف بالتساوي بين شركاء مختارين يدويًا (paid_by_split) —
    // partners_master fixture مطلوب لـES12 (computePartnerSettlement)، ومُفيد
    // أيضًا كمصدر أسماء واقعي لباقي السيناريوهات
    console.log(`\n── expenses: توزيع مصروف بالتساوي (paid_by_split) ──`);
    await setupSplitPartnersFixture();
    await scenario('expenses / ES1 إنشاء موزَّع على شريكين (قسمة متساوية)', () => es1_createSplitEven(app));
    await scenario('expenses / ES2 إنشاء موزَّع على 3 شركاء (كسر أصلي، الأخير يمتص الباقي)', () => es2_createSplitRemainder(app));
    await scenario('expenses / ES3 draft موزَّع → موافقة (_createApprovalJE) يحافظ على التوزيع', () => es3_draftSplitApprove(app));
    await scenario('expenses / ES4 تعديل فرد→موزَّع (posted)', () => es4_editSingleToSplit(app));
    await scenario('expenses / ES5 تعديل موزَّع→فرد (posted)', () => es5_editSplitToSingle(app));
    await scenario('expenses / ES6 تعديل موزَّع→موزَّع نفس الشركاء مبلغ مختلف (يوجب عكس+إعادة ترحيل)', () => es6_editSplitSameMembersAmountChanged(app));
    await scenario('expenses / ES7 تعديل موزَّع→موزَّع مجموعة شركاء مختلفة نفس المبلغ', () => es7_editSplitDifferentMembersSameAmount(app));
    await scenario('expenses / ES8 تعديل تاريخ فقط لمصروف موزَّع (بلا تغيير حصص)', () => es8_editSplitDateOnly(app));
    await scenario('expenses / ES9 إلغاء موزَّع على شريكين', () => es9_voidSplitTwoPartners(app));
    await scenario('expenses / ES10 إلغاء موزَّع على 3 شركاء (مبلغ غير قابل للقسمة المتساوية)', () => es10_voidSplitThreePartnersUneven(app));
    await scenario('expenses / ES11 انحدار: إلغاء مصروف فردي غير-صندوق (voidTransaction المُعاد كتابتها)', () => es11_voidSingleNonTreasuryRegression(app));
    await scenario('expenses / ES12 computePartnerSettlement بعد موزَّع — كل شريك يأخذ حصته تلقائيًا', () => es12_computePartnerSettlementAfterSplit(app));

    // ✅ دعم الصندوق/صندوق الترانزيت داخل توزيع مصروف متساوٍ (طلب لاحق، بعد ES1-ES12)
    await scenario('expenses / ET1 توزيع صندوق+شريك بشري (قسمة زوجية)', () => et1_createSplitTreasuryPlusPartner(app));
    await scenario('expenses / ET2 توزيع صندوق+شريكين بشريين (كسر أصلي)', () => et2_createSplitTreasuryPlusTwoPartnersUneven(app));
    await scenario('expenses / ET3 تعديل: الصندوق ينضم لمجموعة موزَّعة قائمة', () => et3_editAddTreasuryToSplit(app));
    await scenario('expenses / ET4 إلغاء موزَّع مختلط (صندوق+شريك)', () => et4_voidMixedSplit(app));
    await scenario('expenses / ET5 computePartnerSettlement بعد موزَّع مختلط', () => et5_settlementAfterMixedSplit(app));

    // ✅ إصلاح ازدواج expenseAmount (طلب لاحق بعد اكتشاف TM-004 حي 2026-08-02)
    await scenario('expenses / EA1 expenseAmount بعد تعديل مرة (لا يُحسب القديم+الجديد)', () => ea1_expenseAmountEditedOnce(app));
    await scenario('expenses / EA2 expenseAmount بعد تعديلين متتاليين (يحاكي TM-004: 15→7.5→15)', () => ea2_expenseAmountEditedTwice(app));
    await scenario('expenses / EA3 expenseAmount لمصروف موزَّع مُعدَّل', () => ea3_expenseAmountSplitEdited(app));
    await scenario('expenses / EA4 expenseAmount يرجع صفر بعد الإلغاء (void)', () => ea4_expenseAmountVoided(app));
    await scenario('expenses / EA5 انحدار: expenseAmount لمصروف غير مُعدَّل يفضل صحيح', () => ea5_expenseAmountUnaffectedRegression(app));
    await scenario('expenses / EA6 حساب الترسملة يفضل ثابت عبر تعديلات توجيه متتالية بعد البيع', () => ea6_targetAccountPreservedAcrossSaleStatusChange(app));

    // ✅ إصلاح ازدواج crByRef/drByRef في computePartnerSettlement (اكتُشف حيًّا
    // على TM-004 2026-08-02 — وكيل الشحن/بيد سامر) — عبر الأربعة أنواع كلها
    console.log(`\n── computePartnerSettlement: إصلاح ازدواج crByRef/drByRef عند لمسة تانية ──`);
    for (const typeKey of Object.keys(PS_TYPES)) {
      await scenario(`partner-settlement / ${typeKey} PS1 تعديل مرة`, () => ps_editOnce(typeKey, app));
      await scenario(`partner-settlement / ${typeKey} PS2 تعديل مرتين متتاليتين`, () => ps_editTwice(typeKey, app));
      await scenario(`partner-settlement / ${typeKey} PS3 إلغاء (voidTransaction)`, () => ps_void(typeKey, app));
    }
    await scenario('partner-settlement / PS4 مصروف بنفس حالة وكيل الشحن الحقيقية — 3 تعديلات متتالية بنفس المبلغ', () => ps4_expenseThreeEditsSameAmount(app));

    // ✅ إصلاح عمود inv_no في البيع السريع (viewer.js:335)
    console.log(`\n── quick-sale: إصلاح عمود inv_no ──`);
    await scenario('quick-sale / QS1 sales.inv_no يتسجّل صح والإدراج لا يفشل', () => qs1_quickSaleInvNoRecordedCorrectly(app));

    // ✅ إصلاح عمود inv_no في كشف حساب الملف (settings.js:716)
    console.log(`\n── كشف حساب الملف (Tab 7): إصلاح عمود inv_no ──`);
    await scenario('deal-statement / DS1 رقم الفاتورة يظهر في extra صف البيع (نظام TM)', () => ds1_dealStatementSaleInvNoDisplayed(app));

    // ✅ إعادة هيكلة نظام الرسائل التحذيرية (خيار A) — closeModal async + تصنيف أخطاء مركزي
    console.log(`\n── إعادة هيكلة الرسائل التحذيرية: closeModal async + تصنيف الأخطاء ──`);
    await scenario('ui-messaging / UM1 closeModal(dirty, بلا markSaving) يستدعي showConfirm وينتظره بلا تعليق', () => um1_closeModalDirtyAwaitsAndProceeds(app));
    await scenario('ui-messaging / UM2 closeModal(dirty + markSaving) يتخطى فحص الـdirty بالكامل', () => um2_closeModalMarkSavingSkipsDirtyCheck(app));
    await scenario('ui-messaging / UM3 closeModal(غير متسخ) يتخطى showConfirm بالكامل', () => um3_closeModalNotDirtySkipsConfirm(app));
    await scenario('ui-messaging / UM4 تعميم تصنيف قيد فريد لأي اسم (uq_je_ref_primary_posted)', () => um4_uniqueConstraintGeneralizedToAnyName(app));
    await scenario('ui-messaging / UM5 تصنيف خطأ الشبكة (Failed to fetch) لرسالة "غالبًا نجحت"', () => um5_networkErrorClassified(app));

    // ✅ إصلاح باج "موافقة صامتة بلا قيد محاسبي" (عاجل، اكتُشف حيًّا 2026-08-03، TM-023)
    console.log(`\n── approveItem: إصلاح موافقة صامتة بلا قيد (كاش فاضي) ──`);
    await scenario('approve-item / AI1 approveItem بكاش فاضي لسه بيكوّن القيد صح (نظام TM)', () => ai1_approveItemEmptyCacheStillCreatesJE(app));

    // ✅ بنود UX صفحة الموافقات الأربعة (اتفَق على تنفيذها بعد الإصلاح العاجل)
    console.log(`\n── صفحة الموافقات: بنود UX الأربعة ──`);
    await scenario('ui-messaging / UM6 طابور showConfirm الحقيقي — نداء تانٍ ينتظر دوره', () => um6_showConfirmRealQueue(app));
    await scenario('approve-item / UM7 approveAll لسه شغّالة صح بعد confirmAsync (نظام TM)', () => um7_approveAllStillWorksAfterConfirmAsyncRefactor(app));
    await scenario('approve-item / UM8 renderApprovalList بتعرض زرار رفض مباشر', () => um8_renderApprovalListShowsDirectRejectButton(app));

    // ✅ idempotency_key — بديل uniq_expense_active/uniq_payment_active (طلب لاحق 2026-08-07)
    console.log(`\n── idempotency_key: بديل uniq_expense_active/uniq_payment_active ──`);
    await scenario('idempotency / IDEM1 newIdemKey يرجع UUID صالح ومختلف كل نداء', () => idem1_newIdemKeyDistinctUUIDs(app));
    await scenario('idempotency / IDEM2A warnIfSimilarActive: لا تشابه/صف voided → true بلا عرض', () => idem2a_warnIfSimilarActiveNoMatchAndVoidedIgnored(app));
    await scenario('idempotency / IDEM2B warnIfSimilarActive: تشابه نشط — موافقة/رفض المستخدم يُحترَم', () => idem2b_warnIfSimilarActiveConfirmDeclineRespected(app));
    if (await idemKeyColumnReady()) {
      await scenario('idempotency / IDEM3 نفس المفتاح مرتين → الإدراج الثاني يُرفَض', () => idem3_duplicateIdempotencyKeyRejected(app));
      await scenario('idempotency / IDEM4 نفس الحقول التجارية، مفتاحين مختلفين → الإدراجان ينجحان', () => idem4_similarBusinessFieldsNoLongerBlocked(app));
    } else {
      console.log('⏭️  IDEM3/IDEM4 اتخطّيا — عمود idempotency_key لسه مش موجود على القاعدة الحية.');
      console.log('   نفّذ sql/add_idempotency_key_expenses_payments.sql ثم أعد تشغيل السويت.');
    }
  } catch (e) {
    console.error('\n💥 خطأ غير متوقَّع أوقف السويت:', e);
    console.error(e.stack);
  } finally {
    if (app) await runCleanup();
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n════════════════════════════════════════`);
  console.log(`النتيجة: ${results.length - failed.length}/${results.length} نجحت`);
  if (failed.length) {
    console.log('\nالفاشلة:');
    failed.forEach(f => console.log(`  ❌ ${f.name}\n     ${f.error}`));
    process.exit(1);
  }
  process.exit(0);
})();
