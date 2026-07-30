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
