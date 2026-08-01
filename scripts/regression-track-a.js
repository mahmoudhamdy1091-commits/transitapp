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
    const oldJELines = await apiGetAll('journal_entries', {
      select: 'id', system_type: `eq.${SYS}`, ref_table: 'eq.expenses', ref_id: `eq.${old.id}`, post_status: 'eq.posted',
    });
    await app.engine.voidTransaction('expense', old, true);
    const newJE = await app.engine.je_expense({
      sys: SYS, date, amount, fileNo: old.file_no, refId: old.id,
      desc: old.description, expType: old.exp_type, method: old.pay_method,
      paidBy: paidBy || null, paidBySplit, isPrimary: false,
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
(async () => {
  console.log('Track A — Phase 0 Regression Suite');
  console.log('file_no تجريبي:', FILE_NO, '| نظام:', SYS);
  console.log('يستدعي الكود الإنتاجي الفعلي (postDoubleEntry/je_*/updateJEInPlace/voidTransaction/');
  console.log('_processEditApproval/_processReversalApproval) — لا إعادة تنفيذ يدوي لمنطق القيود.\n');

  try {
    app = await loadApp();

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
