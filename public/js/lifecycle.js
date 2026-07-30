// ╔══════════════════════════════════════════════════════════╗
// ║  lifecycle.js — قرار "تعديل سجل مُعتمَد" الموحَّد        ║
// ║  Track A / Phase 1 — 2026-07-29                          ║
// ╚══════════════════════════════════════════════════════════╝
//
// المشكلة اللي بيحلّها هذا الملف: القرار "هل السجل ده كان مُرحَّلاً فعليًا قبل
// التعديل؟ (يبقى عنده قيد محاسبي حي بالفعل) لو أيوه → التعديل يترقّي السجل
// لـpending_edit (يحتاج موافقة على القيمة الجديدة). لو لأ (لسه draft، مفيش
// قيد له خالص) → التعديل يفضل draft عادي، من غير ترقية وهمية" — كان مُعاد
// كتابته يدويًا 6 مرات منفصلة (sales, payments, expenses, collections,
// partner_payouts, purchase_orders) عبر operations.js/dashboard.js/settings.js/
// modals.js. اتنين منهم (sales, partner_payouts) كانوا بيطبّقوا الترقية
// **بشكل مطلق** بلا فحص، فسجل draft كان يترقّى pending_edit وهميًا رغم عدم
// وجود قيد له خالص — عند الموافقة لاحقًا، الكود كان يفترض "القيد اتحدّث
// مسبقًا" ويكتفي بتغيير الحالة لـposted من غير ما يرحّل أي قيد أصلاً (فجوة
// محاسبية صامتة، اكتُشفت حيًّا 2026-07-28 على BOX-133). ثالث حالة
// (purchase_orders) كانت بتستدعي updateJEInPlace بلا شرط أصلًا، فترمي خطأ
// بعد ما تكون عدّلت بيانات السند/السيارات/الشركاء فعليًا بصمت (بلا rollback).
//
// راجع project_full_cost_lifecycle_session_2026-07-28 و
// project_dashboard_purchase_kpi_fix_and_track_a_scope في الذاكرة للتفاصيل الكاملة.

/**
 * هل السجل كان مُرحَّلاً فعليًا (له قيد محاسبي حي) قبل هذا التعديل؟
 * posted = مُعتمَد ومُرحَّل. pending_edit = مُعتمَد أصلًا وتحت مراجعة تعديل سابق
 * (له قيد حي كمان، القيد الحالي بيعكس آخر تعديل مُوافَق عليه أو المُرحَّل الأصلي).
 * أي حالة تانية (draft/pending_void/cancelled/voided) لا قيد حي مضمون لها بنفس المعنى.
 */
export function wasAlreadyPosted(currentStatus) {
  return currentStatus === 'posted' || currentStatus === 'pending_edit';
}

/**
 * الحالة الصحيحة للسجل بعد حفظ تعديل عليه، بناءً فقط على حالته قبل التعديل.
 * - كان مُرحَّلاً (posted/pending_edit) → pending_edit (تعديل على قيمة حقيقية،
 *   محتاج موافقة — والقيد الفعلي لازم يتحدّث في نفس اللحظة عبر updateJEInPlace،
 *   لا وقت الموافقة، هذا القرار مسؤولية المستدعي).
 * - غير كده (draft أو أي حالة تانية) → يفضل draft، بلا أي لمس لأي قيد (مفيش
 *   قيد له أصلًا ليُحدَّث).
 *
 * ✅ لا تستخدم هذه الدالة وحدها لتقرير "هل أستدعي updateJEInPlace؟" — استخدم
 * wasAlreadyPosted(oldStatus) مباشرة لذلك (نفس القيمة، لكن الاسم أوضح في سياق
 * "فيه قيد ينفع يتحدّث ولا لأ" بدل "الحالة الجديدة إيه").
 */
export function statusAfterEdit(currentStatus) {
  return wasAlreadyPosted(currentStatus) ? 'pending_edit' : 'draft';
}

// ╔══════════════════════════════════════════════════════════╗
// ║  Track A / Phase 2 — قرار "حذف/إلغاء سجل" الموحَّد        ║
// ╚══════════════════════════════════════════════════════════╝
//
// المشكلة: زر "حذف" لكل كيان لازم يقرر "فيه قيد محاسبي حي لهذا السجل ولا لأ؟"
// (لو أيوه → إلغاء بقيد عكسي عبر voidTransaction، لو لأ → حذف حقيقي مباشر) —
// كان مُعاد كتابته يدويًا 4 مرات بنتائج مختلفة:
//   - deletePayoutEntry (reports.js): صحيحة أصلًا — فرع صريح posted/draft
//   - deletePaymentEntry/deleteExpenseEntry (settings.js): بلا أي فرع، دايمًا
//     voidTransaction — سجل draft (بلا قيد) كان يدخل pending_void بهدوء لو
//     entryStatus() المستخدم='draft' (وضع الموافقة الافتراضي)، أو يُرفض بخطأ
//     مربك (JE not found) لو entryStatus()='posted' — بغض النظر عن حالة
//     السجل نفسه، لأن القرار كان معتمدًا خطأً على وضع المستخدم العام بدل حالة
//     السجل. اكتُشف حيًّا 2026-07-29 عبر سويت اختبار حقيقي (scripts/regression-track-a.js)
//   - deleteCollectionEntry (settings.js): كانت تتفرّع على paid_date مباشرة،
//     وللسجل بلا قيد كانت تعمل PATCH→voided (سجل يفضل موجود، مُعلَّم "ملغى")
//     بدل حذف حقيقي — قرار سياسة اتحسم 2026-07-30: توحيد كامل لحذف حقيقي
//     زي باقي الثلاثة، بلا استثناء لـcollections
//
// ✅ التصميم مبنيّ حرفيًا على deletePayoutEntry (المرجع الصحيح أصلًا) — قرار
// بالحالة مباشرة posted/draft/غير كده، **مش** boolean "hasJE" عام. جرّبنا
// أول تصميم بـhasJE=wasAlreadyPosted(status) لكنه غلط لحالة pending_void
// تحديدًا: السجل ده له قيد حي فعليًا (لسه ما اتعكسش، بس فيه طلب إلغاء معلّق)،
// لكن wasAlreadyPosted('pending_void') ترجع false (تعريفها الأصلي من Phase 1
// بيستثنيها عمدًا) — لو استخدمناها هنا كانت pending_void هتتحذف حذفًا حقيقيًا
// غلط. القرار المباشر بالحالة هنا أأمن وأوضح ومطابق للمرجع الوحيد المُثبَت
// صحته فعليًا (deletePayoutEntry، 3/3 في سويت الاختبار).
//
// لكيانات فيها قيد "مشروط" بحقل إضافي غير post_status (collections تحديدًا:
// قيدها الفعلي مرتبط بـpaid_date كمان — تحصيل posted بلا paid_date ما عندوش
// قيد فعلي، سياسة الترسملة القديمة) — المستدعي بيطبّق تعديل بسيط فوق النتيجة
// هنا (لو 'void' لكن مفيش قيد فعلي حقيقي → 'delete')، مش الدالة دي بتعرف
// حاجة عن أي كيان بعينه عمدًا. راجع deleteCollectionEntry (settings.js).

/**
 * قرار "حذف/إلغاء" سجل — بناءً على حالته الحالية مباشرة:
 * - 'posted' → 'void' (فيه قيد حي، المستدعي ينده voidTransaction)
 * - 'draft'  → 'delete' (لسه ما اتحفظش، مفيش قيد له خالص، حذف حقيقي مباشر)
 * - أي حالة تانية (pending_edit/pending_void/cancelled/voided) → 'reject'
 *   (السجل في حالة انتقالية أو نهائية — هذا الزر مش مكان التعامل معاها؛
 *   pending_edit/pending_void لها قيد حي لكن تحت مراجعة بالفعل، cancelled/voided
 *   لا تحتاج أي فعل جديد)
 */
export function resolveDeleteAction(status) {
  if (status === 'posted') return 'void';
  if (status === 'draft') return 'delete';
  return 'reject';
}

// ╔══════════════════════════════════════════════════════════╗
// ║  توزيع مصروف بالتساوي بين شركاء مختارين يدويًا             ║
// ╚══════════════════════════════════════════════════════════╝
//
// حسابان نقيان مشتركان بين مودال الإنشاء (modals.js) ومودال التعديل
// (settings.js) — بلا أي اعتماد على DOM، عشان الاتنين يستخدموا نفس منطق
// التقريب/المقارنة بالحرف، مش نسختين منفصلتين ممكن يختلفوا بصمت.

/**
 * تقسيم مبلغ بالتساوي بين مجموعة شركاء مختارين يدويًا. يُستدعى من الصفر
 * عند أي إنشاء أو تعديل (مبلغ أو قائمة شركاء) — النتيجة تُخزَّن مجمَّدة في
 * expenses.paid_by_split، لا يُعاد استخدام حصص قديمة أبدًا.
 *
 * ✅ الحساب بالكامل في نطاق أعداد صحيحة (فلس = جزء من ألف من الدينار) لتفادي
 * انجراف التقريب التراكمي لفاصلة عائمة. آخر شريك في الترتيب المُمرَّر يمتص
 * الباقي (قد يزيد فلسًا أو اتنين عن نصيب الباقين) لضمان أن مجموع الحصص =
 * المبلغ الأصلي بالضبط — قيد غير متوازن بفارق تقريب غير مقبول محاسبيًا.
 */
export function computeEqualSplit(amount, partnerNames) {
  const names = (partnerNames || []).filter(Boolean);
  if (!names.length) throw new Error('لازم تحديد شريك واحد على الأقل للتوزيع المتساوي');
  const totalFils = Math.round((+amount || 0) * 1000);
  const shareFils  = Math.floor(totalFils / names.length);
  return names.map((partner, idx) => {
    const fils = (idx === names.length - 1)
      ? totalFils - shareFils * (names.length - 1)
      : shareFils;
    return { partner, amount: fils / 1000 };
  });
}

/**
 * مقارنة محتوى (لا مرجعية) بين قائمتَي أسماء شركاء — تتجاهل الترتيب والتكرار.
 * ✅ جافاسكريبت ليس فيه مقارنة Set مباشرة (`a === b` مرجعية دائمًا)؛ هذه
 * تُطبَّع الاتنين (إزالة تكرار + ترتيب أبجدي) قبل مقارنة كل عنصر بعنصره.
 * تُستخدم في routingChanged (settings.js) لتقرير "هل تغيّرت مجموعة الشركاء
 * الموزَّع عليهم مصروف؟" — عضوية/عدد، لا ترتيب الاختيار في الواجهة.
 */
export function samePartnerSet(a, b) {
  const A = [...new Set((a || []).filter(Boolean))].sort();
  const B = [...new Set((b || []).filter(Boolean))].sort();
  if (A.length !== B.length) return false;
  return A.every((v, i) => v === B[i]);
}

// ════════════════════════════════════════
// WINDOW BRIDGE — تعريض الرمز للسكريبتات الكلاسيكية (نفس نمط باقي الملفات —
// لا imports حقيقية بين ملفات js/*.js في هذا المشروع، الاعتماد على globals)
// ════════════════════════════════════════
Object.assign(window, { wasAlreadyPosted, statusAfterEdit, resolveDeleteAction, computeEqualSplit, samePartnerSet });
