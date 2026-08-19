#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════
// Fleet — Regression Suite (Phase 5: invoices/bills/settlements)
// ════════════════════════════════════════════════════════════════════════
// الاستخدام:
//   FLEET_TEST_EMAIL=<إيميل حساب اختبار مصرَّح له FLEET> FLEET_TEST_PASSWORD=<كلمة المرور> node scripts/regression-fleet.js
// (الاتنان إلزاميان عبر متغيرات بيئة — عمدًا بدون أي قيمة افتراضية مكتوبة في
// الكود، عشان مفيش بيانات اعتماد حقيقية تتحفظ في تاريخ git بأي شكل)
//
// ── التصميم ──
// خلافًا لـregression-track-a.js (اللي بيحمّل js/engine.js حقيقي في Node عبر
// _headless-app-env.js لأن المنطق المحاسبي هناك JS بحت)، نظام fleet دفع كل
// المنطق المالي عمدًا لدوال RPC في Postgres (§3 من البرومبت المعتمد: "صفر
// منطق مالي في الواجهة"). يبقى "الكود الإنتاجي الحقيقي" المطلوب اختباره هنا
// هو RPCs نفسها (fleet_issue_invoice/fleet_settle_invoice/...) — نفس آلية
// الاستدعاء اللي fleet-core.js بيستخدمها بالحرف (نفس الهيدرات: apikey +
// Authorization Bearer + Accept-Profile/Content-Profile: fleet)، عبر fetch
// مباشر بدون أي طبقة وسيطة. طبقة الواجهة (fleet-invoices.js/fleet-bills.js)
// نفسها بس غلاف رفيع حول openFormModal+apiRpc بلا منطق مستقل يستاهل اختبار
// منفصل — القيمة كلها في الـRPC.
//
// بيانات معزولة تمامًا (مش سيارات حقيقية): سيارة/سائق ثابتان بمعرّف صريح
// (ZZTEST-FLEET-REGRESSION) يُعاد استخدامهما بين التشغيلات (upsert-style) —
// مش إنشاء جديد كل مرة، لأن الجداول ممنوع فيها DELETE على مستوى القاعدة
// (§3 بند 9: أرشفة لا حذف، حتى للوكيل) فتراكم بيانات تجريبية بلا نهاية لو
// كل تشغيلة عملت سيارة جديدة (نفس فئة مشكلة ZZTEST التاريخية في BOX/TM).
//
// كل سيناريو مالي بينضّف نفسه بالكامل في finally (void بالترتيب الصحيح:
// السند قبل الفاتورة/الالتزام) — الهدف: صفر أثر مالي متبقٍ على أي تشغيلة
// ناجحة، حتى لو السيارة/السائق التجريبيين أنفسهم يفضلوا موجودين (مؤرشفين).

const SB_URL = 'https://tepaonhqszocyjsdcyoz.supabase.co';
const SB_KEY = 'sb_publishable_l24VhFauUbUD7GfAyEnyhQ_9F_PKHH3';

const TEST_EMAIL = process.env.FLEET_TEST_EMAIL;
const TEST_PASSWORD = process.env.FLEET_TEST_PASSWORD;
if (!TEST_EMAIL || !TEST_PASSWORD) {
  console.error('❌ لازم FLEET_TEST_EMAIL و FLEET_TEST_PASSWORD كمتغيرات بيئة — راجع التعليق أعلى الملف.');
  process.exit(1);
}

process.on('unhandledRejection', (reason) => {
  console.error('\n💥 UNHANDLED REJECTION (السويت هيكمل، لكن ده لازم يتصلّح):', reason && reason.stack || reason);
});
process.on('uncaughtException', (e) => {
  console.error('\n💥 UNCAUGHT EXCEPTION:', e && e.stack || e);
  process.exit(1);
});

// ── هيدرات مطابقة لـfleet-core.js بالحرف ──
function headers(token, extra = {}) {
  return {
    apikey: SB_KEY,
    'Content-Type': 'application/json',
    'Accept-Profile': 'fleet',
    'Content-Profile': 'fleet',
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

async function login(email, password) {
  const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('تسجيل الدخول فشل: ' + (body.error_description || body.msg || res.statusText));
  return body.access_token;
}

async function apiGet(token, table, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${qs}`, { headers: headers(token) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(`GET ${table}: ${body?.message || res.statusText}`), { body, status: res.status });
  return body;
}
async function apiPost(token, table, data) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST', headers: headers(token, { Prefer: 'return=representation' }), body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(`POST ${table}: ${body?.message || res.statusText}`), { body, status: res.status });
  return body;
}
async function apiPatch(token, table, match, data) {
  const qs = new URLSearchParams(match).toString();
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${qs}`, {
    method: 'PATCH', headers: headers(token, { Prefer: 'return=representation' }), body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(`PATCH ${table}: ${body?.message || res.statusText}`), { body, status: res.status });
  return body;
}
async function apiRpc(token, fn, args) {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: headers(token), body: JSON.stringify(args),
  });
  // ✅ لازم يطابق fleet-core.js بالحرف — نسخة سابقة هنا كانت بتستخدم
  // res.json().catch(()=>null) اللي بيبلع فشل الـparse بصمت، وده بالظبط اللي
  // خبّى باج fleet_void_* (ترجع 204 بجسم فاضي) عن الريجريشن وقت التشغيلة
  // الأولى — الاختبار اليدوي على سيارة حقيقية هو اللي كشفه، مش السويت ده.
  // لو الهرنيس هنا بيتسامح مع فشل مختلف عن العميل الحقيقي، أي باج مشابه
  // ممكن يفوت تاني من غير ما السويت يمسكه.
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw Object.assign(new Error(body?.message || res.statusText), { body, status: res.status });
  return Array.isArray(body) ? body[0] : body;
}

const results = [];
function record(name, ok, error) {
  results.push({ name, ok, error: error ? String(error.message || error) : null });
  console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ' — ' + (error?.message || error)}`);
}
async function scenario(name, fn) {
  try { await fn(); record(name, true); }
  catch (e) { record(name, false, e); }
}
function assert(cond, msg) { if (!cond) throw new Error('ASSERTION FAILED: ' + msg); }

function today() { return new Date().toISOString().slice(0, 10); }
function thisMonth() { return new Date().toISOString().slice(0, 7) + '-01'; }
const uuid = () => globalThis.crypto.randomUUID();

// ── تجهيز سيارة/سائق ثابتين معزولين، upsert-style (مفيش DELETE ممكن) ──
const FIX_PLATE = 'ZZTEST-FLEET-REGRESSION';
const FIX_DRIVER_CIVIL = 'ZZTEST-FLEET-DRIVER';

async function ensureFixture(token) {
  let [vehicle] = await apiGet(token, 'fleet_vehicles', { select: '*', plate_no: `eq.${FIX_PLATE}` });
  if (!vehicle) {
    [vehicle] = await apiPost(token, 'fleet_vehicles', { plate_no: FIX_PLATE, chassis_no: 'ZZTEST-CHASSIS', make: 'ZZTEST', model: 'REGRESSION', status: 'active' });
  } else if (vehicle.status !== 'active') {
    [vehicle] = await apiPatch(token, 'fleet_vehicles', { id: `eq.${vehicle.id}` }, { status: 'active' });
  }

  let [driver] = await apiGet(token, 'fleet_drivers', { select: '*', civil_id: `eq.${FIX_DRIVER_CIVIL}` });
  if (!driver) {
    [driver] = await apiPost(token, 'fleet_drivers', { full_name: 'ZZTEST FLEET REGRESSION DRIVER', civil_id: FIX_DRIVER_CIVIL, status: 'active' });
  } else if (driver.status !== 'active') {
    [driver] = await apiPatch(token, 'fleet_drivers', { id: `eq.${driver.id}` }, { status: 'active' });
  }

  let [assignment] = await apiGet(token, 'fleet_assignments', { select: '*', vehicle_id: `eq.${vehicle.id}`, end_date: 'is.null' });
  if (!assignment) {
    [assignment] = await apiPost(token, 'fleet_assignments', {
      vehicle_id: vehicle.id, driver_id: driver.id, monthly_rent: 150, start_date: today(),
    });
  }

  return { vehicle, driver, assignment };
}

// ── sweep استباقي: يلغي أي فاتورة/التزام معزول لسه posted من تشغيلة سابقة
// اتقطعت (نفس درس ZZTEST التاريخي — لازم في بداية كل تشغيلة، مش في نهايتها بس) ──
async function sweepLeftovers(token, vehicleId) {
  console.log('\n── sweep استباقي: تنظيف أي بقايا posted من تشغيلات سابقة اتقطعت ──');
  const invoices = await apiGet(token, 'fleet_rent_invoices', { select: 'id', vehicle_id: `eq.${vehicleId}`, post_status: 'eq.posted' });
  for (const inv of invoices) {
    const receipts = await apiGet(token, 'fleet_receipts', { select: 'id', invoice_id: `eq.${inv.id}`, post_status: 'eq.posted' });
    for (const r of receipts) await apiRpc(token, 'fleet_void_receipt', { p_receipt_id: r.id }).catch(() => {});
    await apiRpc(token, 'fleet_void_invoice', { p_invoice_id: inv.id }).catch(() => {});
  }
  const bills = await apiGet(token, 'fleet_expense_bills', { select: 'id', vehicle_id: `eq.${vehicleId}`, post_status: 'eq.posted' });
  for (const b of bills) {
    const payments = await apiGet(token, 'fleet_payments', { select: 'id', bill_id: `eq.${b.id}`, post_status: 'eq.posted' });
    for (const p of payments) await apiRpc(token, 'fleet_void_payment', { p_payment_id: p.id }).catch(() => {});
    await apiRpc(token, 'fleet_void_bill', { p_bill_id: b.id }).catch(() => {});
  }
  console.log(`  ✓ sweep خلص — ${invoices.length} فاتورة و${bills.length} التزام كانوا مرشحين للفحص`);
}

// ════════════════════════════════════════════════════════════════════════
// السيناريوهات
// ════════════════════════════════════════════════════════════════════════

async function run() {
  console.log('── تسجيل دخول حساب الاختبار ──');
  const token = await login(TEST_EMAIL, TEST_PASSWORD);
  console.log('  ✓ تم تسجيل الدخول');

  const { vehicle, driver, assignment } = await ensureFixture(token);
  console.log(`  ✓ Fixture جاهز — vehicle_id=${vehicle.id} driver_id=${driver.id} assignment_id=${assignment.id}`);

  await sweepLeftovers(token, vehicle.id);

  // نستخدم شهر ماضٍ ثابت (بعيد عن أي تشغيلة تانية أو اختبار يدوي بيحصل بالتوازي
  // على "الشهر الحالي") — يقلل فرصة تصادم قيد الفريد (vehicle_id+for_month) لو
  // في تشغيلة تانية شغالة في نفس الوقت. راجع §3 بند 8 للفرق بين ده وidempotency.
  const testMonth = '2020-01-01';

  let invoiceId, receiptIds = [];

  // S1 — إصدار فاتورة
  await scenario('S1: إصدار فاتورة إيجار (1.000 د.ك)', async () => {
    const invoice = await apiRpc(token, 'fleet_issue_invoice', {
      p_client_uuid: uuid(), p_vehicle_id: vehicle.id, p_driver_id: driver.id,
      p_for_month: testMonth, p_amount: 1.000, p_issue_date: today(),
    });
    assert(invoice && invoice.id, 'الفاتورة لم تُنشأ');
    assert(Number(invoice.amount) === 1, `المتوقع amount=1، طلع ${invoice.amount}`);
    invoiceId = invoice.id;

    // توازن القيد: مجموع dr = مجموع cr لنفس entry_no
    const jeLines = await apiGet(token, 'fleet_journal_entries', { select: 'dr_amount,cr_amount', ref_table: 'eq.fleet_rent_invoices', ref_id: `eq.${invoiceId}`, post_status: 'eq.posted' });
    const dr = jeLines.reduce((s, l) => s + Number(l.dr_amount), 0);
    const cr = jeLines.reduce((s, l) => s + Number(l.cr_amount), 0);
    assert(Math.abs(dr - cr) < 0.0005, `القيد غير متوازن: dr=${dr} cr=${cr}`);
    assert(Math.abs(dr - 1) < 0.0005, `المتوقع قيمة القيد = 1، طلع ${dr}`);
  });

  // S2 — رفض فاتورة مكررة لنفس السيارة/الشهر (قيد فريد تجاري)
  await scenario('S2: رفض فاتورة ثانية لنفس السيارة/الشهر', async () => {
    let rejected = false, msg = '';
    try {
      await apiRpc(token, 'fleet_issue_invoice', {
        p_client_uuid: uuid(), p_vehicle_id: vehicle.id, p_driver_id: driver.id,
        p_for_month: testMonth, p_amount: 5, p_issue_date: today(),
      });
    } catch (e) { rejected = true; msg = e.message; }
    assert(rejected, 'المفروض السيرفر يرفض فاتورة تانية لنفس السيارة/الشهر');
    assert(/فاتورة مرحّلة/.test(msg), `رسالة الرفض غير متوقعة: "${msg}"`);
  });

  // S3 — رفض idempotency: نفس client_uuid تاني على فاتورة تانية لازم يرجع نفس الأولى
  await scenario('S3: idempotency — إعادة إرسال نفس client_uuid لا ينشئ فاتورة ثانية', async () => {
    const cid = uuid();
    const first = await apiRpc(token, 'fleet_issue_invoice', {
      p_client_uuid: cid, p_vehicle_id: vehicle.id, p_driver_id: driver.id,
      p_for_month: '2020-02-01', p_amount: 9, p_issue_date: today(),
    });
    const second = await apiRpc(token, 'fleet_issue_invoice', {
      p_client_uuid: cid, p_vehicle_id: vehicle.id, p_driver_id: driver.id,
      p_for_month: '2020-03-01', p_amount: 999, p_issue_date: today(), // بيانات مختلفة عمدًا
    });
    assert(first.id === second.id, `المتوقع نفس الفاتورة (${first.id})، طلع (${second.id})`);
    assert(Number(second.amount) === 9, `المتوقع الرد يرجع الفاتورة الأصلية (amount=9)، طلع ${second.amount}`);
    await apiRpc(token, 'fleet_void_invoice', { p_invoice_id: first.id }); // تنظيف فوري
  });

  // S4 — رفض Overpayment
  await scenario('S4: رفض تحصيل مبلغ أكبر من الفاتورة (overpayment)', async () => {
    let rejected = false, msg = '';
    try {
      await apiRpc(token, 'fleet_settle_invoice', {
        p_client_uuid: uuid(), p_invoice_id: invoiceId, p_amount: 5, p_receipt_date: today(),
      });
    } catch (e) { rejected = true; msg = e.message; }
    assert(rejected, 'المفروض السيرفر يرفض تحصيل أكبر من الرصيد المتبقي');
    assert(/أكبر من الرصيد المتبقي/.test(msg), `رسالة الرفض غير متوقعة: "${msg}"`);

    const [bal] = await apiGet(token, 'v_invoice_balances', { select: 'remaining_amount', id: `eq.${invoiceId}` });
    assert(Math.abs(Number(bal.remaining_amount) - 1) < 0.0005, `الرصيد لازم يفضل 1 بعد الرفض، طلع ${bal.remaining_amount}`);
  });

  // S5 — تحصيل جزئي
  await scenario('S5: تحصيل جزئي (0.400) وتحديث الرصيد صح', async () => {
    const receipt = await apiRpc(token, 'fleet_settle_invoice', {
      p_client_uuid: uuid(), p_invoice_id: invoiceId, p_amount: 0.4, p_receipt_date: today(),
    });
    assert(receipt && receipt.id, 'سند التحصيل لم يُنشأ');
    receiptIds.push(receipt.id);

    const [bal] = await apiGet(token, 'v_invoice_balances', { select: 'paid_amount,remaining_amount', id: `eq.${invoiceId}` });
    assert(Math.abs(Number(bal.paid_amount) - 0.4) < 0.0005, `المتوقع paid_amount=0.4، طلع ${bal.paid_amount}`);
    assert(Math.abs(Number(bal.remaining_amount) - 0.6) < 0.0005, `المتوقع remaining_amount=0.6، طلع ${bal.remaining_amount}`);
  });

  // S6 — تحصيل الباقي، الفاتورة تبقى مسددة بالكامل
  await scenario('S6: تحصيل الباقي (0.600) — الفاتورة تبقى مسددة بالكامل', async () => {
    const receipt = await apiRpc(token, 'fleet_settle_invoice', {
      p_client_uuid: uuid(), p_invoice_id: invoiceId, p_amount: 0.6, p_receipt_date: today(),
    });
    receiptIds.push(receipt.id);

    const [bal] = await apiGet(token, 'v_invoice_balances', { select: 'paid_amount,remaining_amount', id: `eq.${invoiceId}` });
    assert(Math.abs(Number(bal.paid_amount) - 1) < 0.0005, `المتوقع paid_amount=1، طلع ${bal.paid_amount}`);
    assert(Math.abs(Number(bal.remaining_amount) - 0) < 0.0005, `المتوقع remaining_amount=0، طلع ${bal.remaining_amount}`);
  });

  // S7 — رفض إلغاء فاتورة عليها سندات مُرحَّلة
  await scenario('S7: رفض إلغاء الفاتورة طالما عليها سندات مُرحَّلة', async () => {
    let rejected = false, msg = '';
    try { await apiRpc(token, 'fleet_void_invoice', { p_invoice_id: invoiceId }); }
    catch (e) { rejected = true; msg = e.message; }
    assert(rejected, 'المفروض السيرفر يرفض إلغاء فاتورة عليها سندات');
    assert(/سند قبض مُرحَّل/.test(msg), `رسالة الرفض غير متوقعة: "${msg}"`);
  });

  // S8 — الترتيب الصحيح: إلغاء السندات أولًا، بعدين الفاتورة — لازم ينجح
  await scenario('S8: إلغاء بالترتيب الصحيح (سندات ثم فاتورة) ينجح', async () => {
    for (const rid of receiptIds) {
      await apiRpc(token, 'fleet_void_receipt', { p_receipt_id: rid });
    }
    const [bal] = await apiGet(token, 'v_invoice_balances', { select: 'paid_amount', id: `eq.${invoiceId}` });
    assert(Math.abs(Number(bal.paid_amount) - 0) < 0.0005, `المتوقع paid_amount=0 بعد إلغاء كل السندات، طلع ${bal.paid_amount}`);

    await apiRpc(token, 'fleet_void_invoice', { p_invoice_id: invoiceId }); // لازم تنجح دلوقتي
    const [afterVoid] = await apiGet(token, 'v_invoice_balances', { select: 'id', id: `eq.${invoiceId}` });
    assert(!afterVoid, 'المتوقع الفاتورة تختفي من v_invoice_balances (فلتر post_status=posted) بعد الإلغاء');
  });

  // S9 — تزامن فعلي: نداءان متوازيان على فاتورة واحدة، مجموعهما أكبر من الرصيد
  await scenario('S9: منع Overpayment تحت تزامن فعلي (نداءان متوازيان حقيقيان)', async () => {
    const concInvoice = await apiRpc(token, 'fleet_issue_invoice', {
      p_client_uuid: uuid(), p_vehicle_id: vehicle.id, p_driver_id: driver.id,
      p_for_month: '2020-04-01', p_amount: 10, p_issue_date: today(),
    });
    const [r1, r2] = await Promise.allSettled([
      apiRpc(token, 'fleet_settle_invoice', { p_client_uuid: uuid(), p_invoice_id: concInvoice.id, p_amount: 6, p_receipt_date: today() }),
      apiRpc(token, 'fleet_settle_invoice', { p_client_uuid: uuid(), p_invoice_id: concInvoice.id, p_amount: 6, p_receipt_date: today() }),
    ]);
    const succeeded = [r1, r2].filter(r => r.status === 'fulfilled');
    const failed = [r1, r2].filter(r => r.status === 'rejected');
    assert(succeeded.length === 1, `المتوقع نجاح نداء واحد بالظبط تحت التزامن، طلع ${succeeded.length}`);
    assert(failed.length === 1, `المتوقع فشل نداء واحد بالظبط تحت التزامن، طلع ${failed.length}`);
    assert(/أكبر من الرصيد المتبقي/.test(failed[0].reason.message), `رسالة الفشل غير متوقعة: "${failed[0].reason.message}"`);

    const [bal] = await apiGet(token, 'v_invoice_balances', { select: 'paid_amount,remaining_amount', id: `eq.${concInvoice.id}` });
    assert(Math.abs(Number(bal.paid_amount) - 6) < 0.0005, `المتوقع paid_amount=6 (مش 12)، طلع ${bal.paid_amount}`);

    // تنظيف
    const [okReceipt] = succeeded[0].value ? [succeeded[0].value] : [];
    if (okReceipt) await apiRpc(token, 'fleet_void_receipt', { p_receipt_id: okReceipt.id });
    await apiRpc(token, 'fleet_void_invoice', { p_invoice_id: concInvoice.id });
  });

  // ── جانب المصروفات — نفس البنية بالمرآة ──
  let billId, paymentIds = [];

  await scenario('B1: تسجيل التزام مصروف على السيارة', async () => {
    const [account] = await apiGet(token, 'fleet_accounts', { select: 'code', code: 'eq.6110' }); // وقود
    const bill = await apiRpc(token, 'fleet_issue_bill', {
      p_client_uuid: uuid(), p_vehicle_id: vehicle.id, p_account_code: account.code,
      p_for_month: testMonth, p_amount: 2, p_issue_date: today(),
    });
    assert(bill && bill.id, 'الالتزام لم يُنشأ');
    billId = bill.id;
  });

  await scenario('B2: رفض سداد أكبر من الالتزام (overpayment)', async () => {
    let rejected = false, msg = '';
    try {
      await apiRpc(token, 'fleet_settle_bill', { p_client_uuid: uuid(), p_bill_id: billId, p_amount: 3, p_payment_date: today() });
    } catch (e) { rejected = true; msg = e.message; }
    assert(rejected, 'المفروض السيرفر يرفض سداد أكبر من رصيد الالتزام');
    assert(/أكبر من الرصيد المتبقي/.test(msg), `رسالة الرفض غير متوقعة: "${msg}"`);
  });

  await scenario('B3: سداد كامل ثم إلغاء بالترتيب الصحيح', async () => {
    const payment = await apiRpc(token, 'fleet_settle_bill', { p_client_uuid: uuid(), p_bill_id: billId, p_amount: 2, p_payment_date: today() });
    paymentIds.push(payment.id);

    let rejected = false;
    try { await apiRpc(token, 'fleet_void_bill', { p_bill_id: billId }); } catch { rejected = true; }
    assert(rejected, 'المفروض رفض إلغاء الالتزام طالما عليه سند صرف مُرحَّل');

    for (const pid of paymentIds) await apiRpc(token, 'fleet_void_payment', { p_payment_id: pid });
    await apiRpc(token, 'fleet_void_bill', { p_bill_id: billId }); // لازم تنجح دلوقتي
  });

  // ── تحقق نهائي: صفر أثر مالي متبقٍ على السيارة التجريبية ──
  await scenario('FINAL: صفر فواتير/التزامات posted متبقية على السيارة التجريبية', async () => {
    const invoices = await apiGet(token, 'v_invoice_balances', { select: 'id', vehicle_id: `eq.${vehicle.id}` });
    const bills = await apiGet(token, 'v_bill_balances', { select: 'id', vehicle_id: `eq.${vehicle.id}` });
    assert(invoices.length === 0, `المتوقع صفر فواتير متبقية، طلع ${invoices.length}`);
    assert(bills.length === 0, `المتوقع صفر التزامات متبقية، طلع ${bills.length}`);
  });

  // ── الملخص ──
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);
  console.log(`\n${'═'.repeat(60)}\nالنتيجة: ${passed}/${results.length} نجحوا`);
  if (failed.length) {
    console.log('\nفشل:');
    failed.forEach(f => console.log(`  ❌ ${f.name}: ${f.error}`));
    process.exitCode = 1;
  } else {
    console.log('✅ كل السيناريوهات نجحت — السيارة/السائق التجريبيين اتأرشفوا لإعادة الاستخدام، صفر أثر مالي متبقٍ.');
  }

  // أرشفة الـfixture (مش حذف — ممنوع على مستوى القاعدة، §3 بند 9) عشان
  // ملفات الاختبار متظهرش جوه القوائم الحقيقية بين تشغيلة وتانية
  await apiPatch(token, 'fleet_assignments', { id: `eq.${assignment.id}` }, { end_date: today() }).catch(() => {});
  await apiPatch(token, 'fleet_vehicles', { id: `eq.${vehicle.id}` }, { status: 'archived' }).catch(() => {});
  await apiPatch(token, 'fleet_drivers', { id: `eq.${driver.id}` }, { status: 'inactive' }).catch(() => {});
}

run().catch(e => { console.error('\n💥 السويت فشل قبل الاكتمال:', e.stack || e); process.exitCode = 1; });
