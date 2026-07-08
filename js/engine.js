// ╔══════════════════════════════════════════════════════════╗
// ║  engine.js — JE Manager · Migration · Import Wizard     ║
// ║           Double Entry Posting Engine · PWA · Init      ║
// ║  Transit Management System — نقل حرفي، لا تعديل منطق   ║
// ╚══════════════════════════════════════════════════════════╝
export const EXPENSE_ACCOUNT_MAP = {
  // ── تكلفة مباشرة (5xxx) ──
  'شحن بحري':       '5200',
  'شحن داخلي':      '5210',
  'نقل':            '5210',
  'تأمين الشحنة':   '5220',
  'تأمين':          '5220',
  'جمارك':          '5300',
  'رسوم ميناء':     '5310',
  'تخليص جمركي':    '5320',
  'فحص وتقييم':     '5400',
  'صيانة وإصلاح':   '5410',
  'صيانة':          '5410',
  'دهان وتشطيب':    '5420',
  'تسجيل ولوحات':   '5430',
  // ── مصاريف الصفقة (6xxx) ──
  'عمولة وسيط':     '6510',
  'رسوم حكومية':    '6610',
  'مصاريف متنوعة':  '6700',
  'أخرى':           '6700',
  // ── احتياطي للبيانات القديمة ──
  'شحن':   '5200',
  'إدارية':'6700',
};

// ✅ مطابق لشجرة الحسابات الفعلية (chart_of_accounts):
// 6100=إيجار، 6200=رواتب وأجور، 6300=نقل وشحن، 6400=تسويق وإعلان،
// 6500=مصاريف عمومية وإدارية، 6600=جمارك وتأمين، 6700=صيانة ومتفرقات
export const OPEX_ACC_MAP = {
  'رواتب وأجور':          '6200',
  'إيجار مكتب / معرض':    '6100',
  'كهرباء وماء ومرافق':   '6500',
  'مصاريف إدارية':        '6500',
  'تسويق وإعلانات':       '6400',
  'عمولات ووساطة':        '6500',
  'ضيافة ومطاعم':         '6500',
  'رسوم حكومية ورخص':     '6600',
  'نظافة وصيانة':         '6700',
  'مصاريف متنوعة':        '6700',
  // احتياطي للبيانات القديمة
  'رواتب':'6200','إيجارات':'6100','عمولات':'6500',
  'نظافة':'6700','ضيافة':'6500','مصروفات حكومية':'6600','أخرى':'6700',
};

// ════════════════════════════════════════════════════════════════
// ENTRY STATUS — حالة الترحيل (نُقلت من accounting.js — Phase 1)
// تُحدِّد هل تُرحَّل العملية فوراً أم تذهب للمراجعة (draft).
// مكانها هنا لأن المحرك (voidTransaction) يستدعي entryStatus() —
// كانت في accounting.js مما يسبب تبعية عكسية من المحرك لطبقة أعلى.
// ════════════════════════════════════════════════════════════════
export function isAdminUser() { return getCurrentRole() === 'admin'; }
export function adminPostsImmediately() { return localStorage.getItem('tm_admin_post') === 'posted'; }
export function entryStatus() { return (isAdminUser() && adminPostsImmediately()) ? 'posted' : 'draft'; }
export function toggleAdminPostSetting() {
  const v = adminPostsImmediately() ? 'draft' : 'posted';
  localStorage.setItem('tm_admin_post', v);
  updateAdminPostToggleUI();
  toast(v==='draft'?'✅ إدخالات المدير ستحتاج موافقة':'✅ إدخالات المدير ستُرحَّل فوراً','ok');
}
export function updateAdminPostToggleUI() {
  const im=adminPostsImmediately(),t=document.getElementById('adminPostToggle'),k=document.getElementById('adminPostKnob'),l=document.getElementById('adminPostLabel');
  if(!t)return; t.style.background=im?'var(--green)':'var(--border2)';
  if(k)k.style.transform=im?'translateX(0)':'translateX(-18px)';
  if(l)l.textContent=im?'ترحيل فوري ✓':'يحتاج موافقة';
}

// ════════════════════════════════════════════════════════════════
// IN-PLACE JE UPDATE HELPER
// يُحدِّث أسطر القيد الأصلي مباشرة دون إنشاء قيد جديد
// الاستخدام: updateJEInPlace({ sys, fileNo, refTable, refId, oldAmount, newAmount, contactPatch })
// oldCost/newCost (اختياري): لقيود متعددة المبالغ (مثل البيع: إيراد + تكلفة) — يُحدَّث
// كل زوج بمبلغه الخاص فقط (مطابقة بالقيمة الفعلية، لا "أي سطر موجب") حتى لا يُكتب
// مبلغ الإيراد فوق سطر التكلفة بالخطأ
// ════════════════════════════════════════════════════════════════
export async function updateJEInPlace({ sys, fileNo, refTable, refId, oldAmount, newAmount, contactPatch = null, newDate = null, oldCost = null, newCost = null }) {
  const amountChanged  = oldAmount != null && Math.abs((+oldAmount||0) - (+newAmount||0)) > 0.001;
  const costChanged    = oldCost != null && newCost != null && Math.abs((+oldCost||0) - (+newCost||0)) > 0.001;
  const contactChanged = contactPatch != null;
  const dateChanged    = newDate != null && newDate !== '';   // ✅ مزامنة تاريخ القيد مع تاريخ العملية
  if (!amountChanged && !costChanged && !contactChanged && !dateChanged) return;

  try {
    let entryNo = null;

    // ✅ المسار الأساسي: بحث مباشر عبر ref_id (بدون حد أقصى على عدد السطور) — يعمل بشكل صحيح حتى مع الملفات الكبيرة
    if (refId != null) {
      const byRef = await apiGetAll('journal_entries', {
        select: 'entry_no', system_type: `eq.${sys}`,
        ref_table: `eq.${refTable}`, ref_id: `eq.${refId}`,
        post_status: 'eq.posted', limit: 1, order: 'id.desc',
      });
      if (byRef?.length) entryNo = byRef[0].entry_no;
    }

    // مسار احتياطي: بحث بالمبلغ ضمن آخر 40 قيد لهذا الملف — فقط لو ref_id غير موجود/غير مطابق
    // ✅ يعمل أيضاً عند تغيّر التاريخ فقط (قيود الشراء/البيع بلا ref_id) — يطابق بالمبلغ القديم
    // ✅ وأيضاً عند تغيّر التكلفة فقط (سيارات استُبدلت بنفس الإجمالي المالي) — نطابق عبر oldAmount (الإيراد) دائماً
    if (!entryNo && (amountChanged || dateChanged || costChanged)) {
      const filter = {
        select: 'entry_no,dr_amount,cr_amount',
        system_type: `eq.${sys}`,
        ref_table: `eq.${refTable}`,
        post_status: 'eq.posted',
        order: 'id.desc',
        limit: 40,
      };
      if (fileNo) filter.file_no = `eq.${fileNo}`;
      const jeLines = await apiGetAll('journal_entries', filter);
      const amt = +oldAmount;
      const fallback = (jeLines||[]).find(j =>
        Math.abs((+j.dr_amount||0) - amt) < 0.001 ||
        Math.abs((+j.cr_amount||0) - amt) < 0.001
      );
      if (fallback) entryNo = fallback.entry_no;
    }
    if (!entryNo) return;

    // جيب كل أسطر هذا القيد بالـ entry_no
    const allLines = await apiGetAll('journal_entries', {
      select: 'id,dr_amount,cr_amount,contact_name,entry_date',
      system_type: `eq.${sys}`,
      entry_no: `eq.${entryNo}`,
    });

    for (const line of (allLines||[])) {
      const patch = {};
      const dr = +line.dr_amount||0, cr = +line.cr_amount||0;
      // ✅ مطابقة بالقيمة الفعلية لكل سطر — لا "أي سطر موجب" — حتى لا يُكتب مبلغ
      // الإيراد فوق سطر التكلفة (أو العكس) في قيود متعددة المبالغ مثل البيع
      if (amountChanged) {
        if (Math.abs(dr - (+oldAmount||0)) < 0.001 && dr > 0) patch.dr_amount = +newAmount;
        if (Math.abs(cr - (+oldAmount||0)) < 0.001 && cr > 0) patch.cr_amount = +newAmount;
      }
      if (costChanged) {
        if (Math.abs(dr - (+oldCost||0)) < 0.001 && dr > 0) patch.dr_amount = +newCost;
        if (Math.abs(cr - (+oldCost||0)) < 0.001 && cr > 0) patch.cr_amount = +newCost;
      }
      if (contactChanged && contactPatch && (line.contact_name || (+line.cr_amount||0) > 0)) {
        patch.contact_name = contactPatch;
      }
      // ✅ مزامنة تاريخ القيد مع تاريخ العملية الجديد (يشمل كل أسطر القيد)
      if (dateChanged && line.entry_date !== newDate) {
        patch.entry_date = newDate;
      }
      if (Object.keys(patch).length) {
        await apiPatch('journal_entries', { id: `eq.${line.id}` }, patch);
      }
    }
  } catch(e) {
    console.warn(`updateJEInPlace [${refTable}]:`, e.message);
  }
}

// ════════════════════════════════════════════════════════════════
// ENGINE HOOKS — نقطة اتصال لملفات أعلى (operations.js, transactions.js)
// المحرك لا يعرف أسماء دوال من ملفات أخرى مباشرة (اقتران عكسي) —
// بدلاً من typeof fn === 'function'، الملف الأعلى يسجّل نفسه هنا.
// ════════════════════════════════════════════════════════════════
const engineHooks = {
  onVoidComplete: null, // operations.js → loadApprovalQueue
  onAppReady: null,     // transactions.js → initApp
};

// ════════════════════════════════════════════════════════════════
// REVERSAL ENGINE — إلغاء العمليات بقيد عكسي
// المبدأ:
//   1. يُضيف قيد عكسي (Dr↔Cr معكوسة) بتاريخ اليوم
//   2. يضع post_status='voided' على السجل التشغيلي
//   3. لا يُحذف أي بيانات — كل شيء يبقى في التاريخ
// ════════════════════════════════════════════════════════════════

export async function voidTransaction(type, record, force=false) {
  const sys     = state.system;
  const today_  = today();
  const amount  = +record.amount || +record.sale_price || 0;

  if (!amount || amount <= 0) throw new Error('المبلغ صفر — لا يوجد قيد لعكسه');
  // ✅ حارس دفاعي: يمنع إلغاء سجل مُلغى بالفعل (قيد عكسي مزدوج) — لا يمنع pending_void
  // (مطلوب لموافقة قائمة المراجعة عبر force=true) ولا أي حالة أخرى
  if (record.post_status === 'voided') throw new Error('هذا السجل ملغى بالفعل — لا يمكن إلغاؤه مرة أخرى');

  // ── إذا كان النظام على draft mode → أرسل للمراجعة بدل تنفيذ فوري ──
  // ✅ استثناء: عند التنفيذ من قائمة المراجعة (force=true) — السجل أصلاً pending_void
  // والموافقة تعني "نفّذ الآن فعلياً"، فلا معنى لإعادة إرساله للمراجعة (كان يسبب حلقة عالقة)
  if (!force && typeof entryStatus === 'function' && entryStatus() === 'draft') {
    const tableMap = { payment:'payments', expense:'expenses', collection:'collections', payout:'partner_payouts' };
    const tbl = tableMap[type];
    if (tbl) {
      await apiPatch(tbl, { id:`eq.${record.id}` }, {
        post_status: 'pending_void',
        notes: `${record.notes||''} | طلب إلغاء بتاريخ ${today_}`.trim(),
      });
      await logAudit('VOID_REQUEST', tbl, record.file_no, record, null, `طلب إلغاء ${type} — ${record.ref_no||record.id}`);
      if (engineHooks.onVoidComplete) await engineHooks.onVoidComplete();
      toast('🔄 تم إرسال طلب الإلغاء للمراجعة', 'ok');
      return;
    }
  }

  // ── بناء أسطر القيد العكسي حسب نوع العملية ──
  let reversalLines = [];
  let reversalDesc  = '';
  let refTable      = 'reversal';

  if (type === 'payment') {
    const cashAcc = (record.pay_method||'') === 'نقد' ? '1110' : '1120';
    const cashNm  = (record.pay_method||'') === 'نقد' ? 'النقد' : 'البنك';
    const sup     = record.supplier || 'مورد';
    reversalDesc  = `عكس دفعة ${record.ref_no||record.pay_id||''} — ${sup} — ملف ${record.file_no}`;
    // الأصلي: Dr 2100 ذمم موردين / Cr (نقد/بنك أو 2400 لو دفعها شريك) — العكس بالمقابل تماماً
    const cr = _isPartnerPocket(record.payer)
      ? { acc:'2400', name:'حسابات الشركاء', dr:amount, cr:0, contact:record.payer.trim() }
      : { acc:cashAcc, name:cashNm, dr:amount, cr:0, contact:null };
    reversalLines = [
      cr,
      { acc: '2100',  name: 'ذمم الموردين',   dr: 0,      cr: amount, contact: sup  },
    ];

  } else if (type === 'expense') {
    // الأصلي: Dr 6xxx / Cr (نقد/بنك أو 2400 لو دفعها شريك) — العكس بالمقابل تماماً
    const eAcc    = EXPENSE_ACCOUNT_MAP[record.exp_type||record.category] || '6500';
    const dr = _isPartnerPocket(record.paid_by)
      ? { acc:'2400', name:'حسابات الشركاء', dr:amount, cr:0, contact:record.paid_by.trim() }
      : { acc:((record.pay_method||'')==='نقد'?'1110':'1120'), name:((record.pay_method||'')==='نقد'?'النقد':'البنك'), dr:amount, cr:0, contact:null };
    reversalDesc  = `عكس مصروف ${record.ref_no||''} — ${record.description||''} — ملف ${record.file_no}`;
    reversalLines = [
      dr,
      { acc: eAcc, name: record.exp_type || 'مصروف', dr: 0, cr: amount, contact: null },
    ];

  } else if (type === 'collection') {
    // الأصلي: Dr (نقد/بنك أو 2400 لو احتفظ بها شريك) / Cr 1200 — العكس بالمقابل تماماً
    const cust    = record.customer || 'عميل';
    const cr = _isPartnerPocket(record.received_by)
      ? { acc:'2400', name:'حسابات الشركاء', dr:0, cr:amount, contact:record.received_by.trim() }
      : { acc:((record.pay_method||'')==='نقد'?'1110':'1120'), name:((record.pay_method||'')==='نقد'?'النقد':'البنك'), dr:0, cr:amount, contact:null };
    reversalDesc  = `عكس تحصيل ${record.ref_no||''} — ${cust} — فاتورة ${record.inv_no||''}`;
    reversalLines = [
      { acc: '1200', name: 'ذمم العملاء', dr: amount, cr: 0, contact: cust },
      cr,
    ];

  } else if (type === 'payout') {
    // القيد الأصلي: Dr 2400 حسابات شركاء / Cr 1110|1120
    // العكس:        Dr 1110|1120 / Cr 2400
    const cashAcc = (record.pay_method||'') === 'نقد' ? '1110' : '1120';
    const cashNm  = (record.pay_method||'') === 'نقد' ? 'النقد' : 'البنك';
    reversalDesc  = `عكس صرف شريك ${record.pay_id||record.ref_no||''} — ${record.partner||''} — ملف ${record.file_no}`;
    reversalLines = [
      { acc: cashAcc, name: cashNm,                dr: amount, cr: 0,      contact: null            },
      { acc: '2400',  name: 'حسابات الشركاء',     dr: 0,      cr: amount, contact: record.partner  },
    ];

  } else {
    throw new Error(`نوع العملية "${type}" غير مدعوم في الإلغاء`);
  }

  // ── 1. تسجيل القيد العكسي ──
  await postDoubleEntry({
    sys,
    date:      today_,
    fileNo:    record.file_no || null,
    refTable:  'reversal',
    refId:     record.id || null,
    desc:      reversalDesc,
    lines:     reversalLines,
  });

  // ── 2. وضع post_status = 'voided' على السجل التشغيلي ──
  const tableMap = {
    payment:    'payments',
    expense:    'expenses',
    collection: 'collections',
    payout:     'partner_payouts',
  };
  const tableName = tableMap[type];
  if (tableName && record.id) {
    await apiPatch(tableName, { id:`eq.${record.id}` }, {
      post_status: 'voided',
      notes: `${record.notes ? record.notes + ' | ' : ''}مُلغى بتاريخ ${today_}`,
    });
  }

  // ── 3. تسجيل في audit_log ──
  await logAudit(
    'VOID', tableName, record.file_no,
    record, { reversal_desc: reversalDesc, voided_at: today_ },
    `إلغاء بقيد عكسي: ${reversalDesc}`
  );

  invalidateCache();
}

// ════════════════════════════════════════════════════════════
// REVERSE MANUAL JE — عكس قيد يدوي بقيد جديد منفصل
//   لا تلمس القيد الأصلي إطلاقاً — فقط تُنشئ قيداً جديداً بنفس الأسطر
//   مع Dr↔Cr معكوسة. مخصّصة فقط لقيود ref_table='manual' (القيد اليدوي
//   لا جدول مصدر منفصل له، فلا معنى لتحديث "حالة مصدر" كما في voidTransaction).
// ════════════════════════════════════════════════════════════
export async function reverseManualJE(entryNo) {
  const sys = state.system;

  const lines = await apiGetAll('journal_entries', {
    select: '*', system_type: `eq.${sys}`, entry_no: `eq.${entryNo}`,
  });
  if (!lines?.length) throw new Error('لم يُعثر على القيد');
  if (lines.some(l => l.ref_table !== 'manual')) {
    throw new Error('هذه الدالة لعكس القيود اليدوية فقط — القيد المحدد ليس يدوياً');
  }

  // ✅ حارس دفاعي (أفضل مجهود، مطابقة نصية — لا يوجد ref_id حقيقي يربط
  // القيد بعكسه هنا، انظر project_dual_je_audit Case 1): يمنع عكس نفس
  // القيد مرتين لو القيد العكسي السابق لسه موجود بنفس وصف "عكس قيد {entryNo}"
  const already = await apiGetAll('journal_entries', {
    select: 'id', system_type: `eq.${sys}`, ref_table: 'eq.manual',
    description: `ilike.*عكس قيد ${entryNo}*`, limit: 1,
  });
  if (already?.length) throw new Error('هذا القيد تم عكسه بالفعل');

  const fileNo = lines[0].file_no || null;
  const date_  = today();
  const reversalLines = lines.map(l => ({
    acc:     l.account_code,
    name:    l.account_name,
    dr:      +l.cr_amount || 0,
    cr:      +l.dr_amount || 0,
    contact: l.contact_name || null,
  }));

  await postDoubleEntry({
    sys, date: date_, fileNo,
    refTable: 'manual', refId: null,
    desc: `عكس قيد ${entryNo}`,
    lines: reversalLines,
  });

  await logAudit(
    'REVERSE', 'journal_entries', fileNo,
    { entry_no: entryNo, lines: lines.map(l => ({ account_code:l.account_code, account_name:l.account_name, dr_amount:l.dr_amount, cr_amount:l.cr_amount })) },
    { reversed_entry_no: entryNo },
    `عكس قيد يدوي ${entryNo} بقيد جديد — الأصلي بلا تغيير`
  );

  invalidateCache();
}

// ════════════════════════════════════════════════════════════
// VOID PURCHASE ORDER — إلغاء سند شراء مُرحَّل بقيد عكسي
//   شرطان مانعان (يرميان Error برسالة واضحة، بلا أي تعديل):
//     1. أي سيارة من الملف لها بيع فعّال (posted/pending_edit) — COGS
//        المُسجَّل لها يعتمد على total_purchase هذا، فحذفه يُفسد حسابها.
//     2. أي دفعة فعّالة للمورد على هذا الملف — عكس الشراء سيُنقص 2100
//        بالكامل بينما جزء منه دُفع فعليًا، فيصبح الحساب سالباً.
//   لا يُلغي المصاريف أو يعكس الدفعات تلقائياً — الملف "يُقفل جزئياً"؛
//   إلغاء أي بند آخر قرار منفصل يقوم به المستخدم عبر voidTransaction.
// ════════════════════════════════════════════════════════════
export async function voidPurchaseOrder(fileNo) {
  const sys = state.system;

  const poRows = await apiGetAll('purchase_orders', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` });
  const po = poRows?.[0];
  if (!po) throw new Error('لم يُعثر على سند الشراء لهذا الملف');
  if (po.post_status === 'voided') throw new Error('سند الشراء مُلغى مسبقاً');

  // ── الشرط المانع 1: سيارات مباعة ──
  const salesRows = await apiGetAll('sales', { select:'vin,post_status', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` });
  const soldEffective = (salesRows||[]).filter(isEffective);
  if (soldEffective.length) {
    throw new Error(`لا يمكن إلغاء سند الشراء — يوجد ${soldEffective.length} سيارة مباعة في هذا الملف. اعكس فواتير البيع المرتبطة أولاً.`);
  }

  // ── الشرط المانع 2: دفعات للمورد ──
  const paymentRows = await apiGetAll('payments', { select:'id,post_status', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` });
  const paysEffective = (paymentRows||[]).filter(isEffective);
  if (paysEffective.length) {
    throw new Error(`لا يمكن إلغاء سند الشراء — يوجد ${paysEffective.length} دفعة مسجّلة للمورد على هذا الملف. اعكسها أولاً.`);
  }

  // ── القيد العكسي: نفس قيمة total_purchase الحالية، عكس Dr1300/Cr2100 الأصلي ──
  const amount = +po.total_purchase || 0;
  const today_ = today();
  if (amount > 0) {
    await postDoubleEntry({
      sys, date: today_, fileNo,
      refTable: 'reversal', refId: po.id,
      desc: `عكس شراء — ملف ${fileNo} — ${po.supplier||''}`,
      lines: [
        { acc:'2100', name:'ذمم الموردين',     dr:amount, cr:0,      contact:po.supplier||null },
        { acc:'1300', name:'المخزون — سيارات', dr:0,      cr:amount, contact:null               },
      ],
    });
  }

  // ── تحديث حالة السند ──
  await apiPatch('purchase_orders', { id:`eq.${po.id}` }, {
    post_status: 'voided',
    status: 'VOIDED',
    notes: `${po.notes ? po.notes + ' | ' : ''}مُلغى بتاريخ ${today_}`,
  });

  // ── تسجيل في audit_log ──
  await logAudit('VOID', 'purchase_orders', fileNo, po, null, `إلغاء سند شراء ملف ${fileNo} بقيد عكسي`);

  invalidateCache();
}

export async function _jeNo(sys) {
  // ✅ توليد ذرّي عبر RPC في Postgres (دالة + جدول عدّادات بقفل صفّي)
  // يمنع تضارب entry_no بين عمليات ترحيل متزامنة (انظر next_je_no في قاعدة البيانات)
  try {
    const no = await apiRpc('next_je_no', { p_sys: sys });
    if (no) return no;
  } catch(e) { console.error('_jeNo: فشل next_je_no RPC —', e.message); }
  // fallback غير ذرّي (يُستخدم فقط لو الدالة غير موجودة في القاعدة بعد)
  try {
    const r = await apiGet('journal_entries',{select:'id',system_type:`eq.${sys}`,order:'id.desc',limit:1});
    return `JE-${new Date().getFullYear()}-${String((r?.[0]?.id||0)+1).padStart(5,'0')}`;
  } catch(e) { return `JE-${Date.now()}`; }
}

export async function postDoubleEntry({sys, date, fileNo, refTable, refId, desc, lines}) {
  if (!lines || !lines.length) { console.warn('postDoubleEntry: no lines'); return; }
  const dr = lines.reduce((s,l)=>s+(+l.dr||0),0);
  const cr = lines.reduce((s,l)=>s+(+l.cr||0),0);
  if (Math.abs(dr-cr)>0.01) {
    const msg = `قيد غير متوازن: مدين=${dr.toFixed(2)} دائن=${cr.toFixed(2)} — ${desc}`;
    console.error(msg);
    throw new Error(msg);
  }
  const no      = await _jeNo(sys);
  const now     = new Date().toISOString();
  const inserts = lines.map(l => ({
    system_type:  sys,
    entry_no:     no,
    entry_date:   date || today(),
    account_code: l.acc     || null,
    account_name: l.name    || null,
    contact_name: l.contact || null,
    dr_amount:    +l.dr  || 0,
    cr_amount:    +l.cr  || 0,
    description:  l.desc || desc,
    ref_table:    refTable || null,
    ref_id:       refId    || null,
    file_no:      fileNo   || null,
    post_status:  'posted',
    posted_at:    now,
  }));

  // ── Batch insert: كل الأسطر في request واحد — إما كلها أو لا شيء ──
  const res = await fetch(`${SB_URL}/rest/v1/journal_entries`, {
    method:  'POST',
    headers: { ...headers(), 'Prefer': 'return=minimal' },
    body:    JSON.stringify(inserts),   // array = batch
  });

  if (!res.ok) {
    const body = await res.text().catch(()=>'');
    // محاولة حذف أي سطر تسرّب بنفس entry_no (حماية من التكرار)
    try {
      await fetch(`${SB_URL}/rest/v1/journal_entries?entry_no=eq.${encodeURIComponent(no)}&system_type=eq.${encodeURIComponent(sys)}`,
        { method:'DELETE', headers: headers() });
    } catch(_) {}
    throw new Error(`فشل تسجيل القيد "${desc}" — ${res.status}: ${body}`);
  }
}

// ── حساب تكلفة المخزون المباع (COGS) — المنطق الصح ──
//
// السيارة المباعة تُقفل تكلفتها وقت البيع، والمصاريف اللاحقة تُحمَّل
// على السيارات المتبقية فقط. المعادلة:
//
//   التكلفة المتبقية = (إجمالي الشراء + جميع المصاريف) − COGS المرحّل سابقاً
//   السيارات المتبقية = إجمالي السيارات − سيارات مباعة سابقاً (مرحّلة)
//   تكلفة/سيارة = التكلفة المتبقية ÷ السيارات المتبقية
//   COGS الفاتورة = تكلفة/سيارة × عدد سيارات الفاتورة
//
// params:
//   sys, fileNo, soldCount  — كالمعتاد
//   alreadySold (optional)  — للمهاجر (migration) الذي يتتبع الحالة داخلياً
//   alreadyCOGS (optional)  — نفس الغرض؛ لو null يُجلب من journal_entries
// ✅ الخيار ②: فصل تكلفة القطع (vin يبدأ بـ PART-) عن متوسط الشاحنات.
//   - القطعة COGS = سعر شرائها الفعلي (لا متوسط).
//   - الشاحنات تأخذ المتوسط على تكلفتها وعددها فقط (بعد طرح القطع).
//   - متوافق رجعياً: ملف بلا قطع PART- (وبدون soldVins) ⇒ نفس النتيجة القديمة حرفياً.
export async function calcCOGS(sys, fileNo, soldCount, { alreadySold = null, alreadyCOGS = null, soldVins = null } = {}) {
  if (!soldCount || soldCount <= 0) return 0;
  try {
    // جلب بيانات الملف (vin + سعر الشراء لازمان لفصل القطع)
    const [poRows, vehRows, expRows] = await Promise.all([
      apiGetAll('purchase_orders', { select:'total_purchase',    system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGetAll('vehicles',        { select:'vin,purchase_price', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGetAll('expenses',        { select:'amount',            system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, post_status:'eq.posted' }),
    ]);
    const totalPurchase = +((poRows||[])[0]?.total_purchase || 0);
    const totalExp      = (expRows||[]).reduce((s,e) => s + (+e.amount||0), 0);
    const fullCost      = totalPurchase + totalExp;

    // ✅ فصل القطع عن الشاحنات
    const _isPart = vin => (vin||'').startsWith('PART-');
    const allVeh  = vehRows || [];
    const priceByVin = {};
    allVeh.forEach(v => { if (v.vin) priceByVin[v.vin] = +v.purchase_price || 0; });
    const partsCost  = allVeh.filter(v => _isPart(v.vin)).reduce((s,v)=>s+(+v.purchase_price||0),0);
    const truckCount = allVeh.filter(v => !_isPart(v.vin)).length;
    const truckCost  = Math.max(fullCost - partsCost, 0);

    // تصنيف بنود هذه الفاتورة (قطع vs شاحنات)
    let soldPartVins = [], soldTruckCount = soldCount;
    if (Array.isArray(soldVins)) {
      soldPartVins   = soldVins.filter(_isPart);
      soldTruckCount = soldVins.filter(v => !_isPart(v)).length;
    }
    // COGS القطع = سعر شرائها الفعلي
    const partCOGS = soldPartVins.reduce((s,vin) => s + (priceByVin[vin] ?? 0), 0);

    // COGS الشاحنات = متوسط "المتبقي" على الشاحنات فقط
    let truckCOGS = 0;
    if (soldTruckCount > 0) {
      let _alreadyCOGS = alreadyCOGS;
      let _alreadySold = alreadySold;
      if (_alreadyCOGS === null || _alreadySold === null) {
        const [jeRows, soldRows] = await Promise.all([
          apiGetAll('journal_entries', { select:'dr_amount', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, account_code:'eq.5100', post_status:'eq.posted' }),
          apiGetAll('sales',           { select:'vin',       system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, post_status:'eq.posted' }),
        ]);
        const totalAlreadyCOGS = (jeRows||[]).reduce((s,r) => s + (+r.dr_amount||0), 0);
        const soldRowsArr      = soldRows || [];
        const soldPartsPrev    = soldRowsArr.filter(s => _isPart(s.vin));
        const alreadyPartCOGS  = soldPartsPrev.reduce((s,row) => s + (priceByVin[row.vin] ?? 0), 0);
        // نطرح حصة القطع لنحصل على قيم الشاحنات فقط
        if (_alreadyCOGS === null) _alreadyCOGS = Math.max(totalAlreadyCOGS - alreadyPartCOGS, 0);
        if (_alreadySold === null) _alreadySold = soldRowsArr.length - soldPartsPrev.length;
      }
      const remainingTrucks = Math.max(truckCount - _alreadySold, soldTruckCount);
      const remainingCost   = Math.max(truckCost - _alreadyCOGS, 0);
      const costPerTruck    = remainingTrucks > 0 ? remainingCost / remainingTrucks : 0;
      truckCOGS = costPerTruck * soldTruckCount;
    }

    return Math.round((partCOGS + truckCOGS) * 100) / 100;
  } catch(e) {
    console.warn('calcCOGS error:', e.message);
    return 0;
  }
}

// شراء: مخزون Dr / مورد Cr
export async function je_purchase({sys,date,amount,fileNo,supplier,refId}) {
  if(!amount||amount<=0) return;
  await postDoubleEntry({sys,date,fileNo,refTable:'purchase_orders',refId,desc:`شراء — ملف ${fileNo} — ${supplier}`,lines:[
    {acc:'1300', name:getAccountName('1300'),  dr:amount, cr:0,      contact:null     },
    {acc:'2100', name:`ذمم الموردين`,           dr:0,      cr:amount, contact:supplier },
  ]});
}

// بيع: عميل Dr / إيراد Cr
export async function je_sale({sys,date,amount,cost,fileNo,customer,invNo}) {
  if(!amount||amount<=0) return;
  const lines = [
    {acc:'1200', name:`ذمم العملاء`,        dr:amount, cr:0,     contact:customer, desc:`فاتورة ${invNo}`},
    {acc:'4100', name:getAccountName('4100'), dr:0,    cr:amount, contact:null,     desc:`فاتورة ${invNo}`},
  ];
  if (cost>0) {
    lines.push({acc:'5100', name:'تكلفة المخزون المباع', dr:cost, cr:0,    contact:null});
    lines.push({acc:'1300', name:'المخزون — سيارات',     dr:0,    cr:cost, contact:null});
  }
  await postDoubleEntry({sys,date,fileNo,refTable:'sales',desc:`بيع فاتورة ${invNo} — ${customer} — ملف ${fileNo}`,lines});
}

// تحصيل: نقد Dr / عميل Cr
// ════════════════════════════════════════
// نموذج الشركاء: الصندوق = الخزينة (نقد 1110 + بنك 1120).
// أي شريك آخر يدفع/يستلم من جيبه → القيد على حسابه 2400 بدل النقدية.
// ════════════════════════════════════════
export const TREASURY_PARTNER = 'الصندوق';
export function _isPartnerPocket(name) { return !!(name && name.trim() && name.trim() !== TREASURY_PARTNER); }

export const USER_DISPLAY_NAMES = {
  'mahmoud.hamdy1091@gmail.com': 'محمود حمدي',
  'transit.co.2002@gmail.com':   'ترانزيت ابو محمد',
};
export function displayUser(email) {
  if (!email) return 'غير معروف';
  return USER_DISPLAY_NAMES[email] || email.split('@')[0];
}

export async function je_collection({sys,date,amount,fileNo,refId,customer,invNo,method,receivedBy}) {
  if(!amount||amount<=0) return;
  // المدين: الخزينة (نقد/بنك) افتراضياً، أو حساب الشريك 2400 لو احتفظ بالمبلغ خارج الصندوق
  const debit = _isPartnerPocket(receivedBy)
    ? {acc:'2400', name:'حسابات الشركاء', dr:amount, cr:0, contact:receivedBy.trim()}
    : {acc:(method==='نقد'?'1110':'1120'), name:(method==='نقد'?'النقد':'البنك'), dr:amount, cr:0, contact:null};
  const tail = _isPartnerPocket(receivedBy) ? ` — احتفظ بها ${receivedBy.trim()}` : '';
  await postDoubleEntry({sys,date,fileNo,refTable:'collections',refId,desc:`تحصيل ${invNo} — ${customer} — ملف ${fileNo}${tail}`,lines:[
    debit,
    {acc:'1200',  name:`ذمم العملاء`,    dr:0,      cr:amount, contact:customer },
  ]});
}

// دفعة مورد: مورد Dr / نقد Cr
// لو الدافع (payer) شريك مختلف عن المورد → يُضاف سطر ثالث على حساب الشريك 2400
// حتى يظهر ما دفعه الشريك في كشف حسابه
export async function je_payment({sys,date,amount,fileNo,refId,supplier,supplierName,payer,payerName,method}) {
  if(!amount||amount<=0) return;
  let sup = supplier || supplierName || '';
  if (!sup && fileNo) {
    // ✅ احتياطي: لو لم يُمرَّر اسم المورد (مثلاً جدول payments بدون عمود supplier)
    // اجلبه من ملف الشراء بدلاً من استخدام كلمة "مورد" العامة كـ contact_name
    try {
      const po = await apiGet('purchase_orders', { select:'supplier', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, limit:1 });
      sup = po?.[0]?.supplier || '';
    } catch(_) {}
  }
  if (!sup) sup = 'مورد';
  const payerStr = payer || payerName || sup;
  const cashAcc  = method==='نقد'?'1110':'1120';
  const cashNm   = method==='نقد'?'النقد':'البنك';
  // ✅ موحّد مع je_expense/je_collection: التوجيه بـ_isPartnerPocket لا بمقارنة اسم المورد
  // (fallback لـ TREASURY_PARTNER لا sup هنا تحديدًا — لمنع معاملة اسم المورد نفسه كـ"شريك" في حالة payer/payerName فاضيين)
  const payerIsPartner = _isPartnerPocket(payer || payerName || TREASURY_PARTNER);

  if (payerIsPartner) {
    // الشريك يدفع للمورد نيابةً عن الصفقة:
    // DR ذمم الموردين (يُبرئ ذمة المورد)
    // CR حسابات الشركاء (الشريك يُقرض الصفقة)
    await postDoubleEntry({sys,date,fileNo,refTable:'payments',refId,
      desc:`دفعة للمورد ${sup} بواسطة ${payerStr} — ملف ${fileNo}`,lines:[
      {acc:'2100', name:`ذمم الموردين`,   dr:amount, cr:0,     contact:sup      },
      {acc:'2400', name:`حسابات الشركاء`, dr:0,      cr:amount, contact:payerStr },
    ]});
  } else {
    // الدفع مباشرة من نقدية الشركة
    await postDoubleEntry({sys,date,fileNo,refTable:'payments',refId,
      desc:`دفعة للمورد ${sup} — ملف ${fileNo}`,lines:[
      {acc:'2100',  name:`ذمم الموردين`, dr:amount, cr:0,     contact:sup  },
      {acc:cashAcc, name:cashNm,         dr:0,      cr:amount, contact:null },
    ]});
  }
}

// مصروف: مصروف Dr / نقد Cr
export async function je_expense({sys,date,amount,fileNo,refId,desc,expType,method,paidBy}) {
  if(!amount||amount<=0) return;
  const eAcc     = EXPENSE_ACCOUNT_MAP[expType]||'6500';
  // الدائن: الخزينة (نقد/بنك) افتراضياً، أو حساب الشريك 2400 لو دفعها من جيبه
  const credit = _isPartnerPocket(paidBy)
    ? {acc:'2400', name:'حسابات الشركاء', dr:0, cr:amount, contact:paidBy.trim()}
    : {acc:(method==='نقد'?'1110':'1120'), name:(method==='نقد'?'النقد':'البنك'), dr:0, cr:amount, contact:null};
  const tail = _isPartnerPocket(paidBy) ? ` — دفعها ${paidBy.trim()}` : '';
  await postDoubleEntry({sys,date,fileNo,refTable:'expenses',refId,desc:`${desc} — ملف ${fileNo||'عام'}${tail}`,lines:[
    {acc:eAcc,    name:expType||'مصروف', dr:amount, cr:0,     contact:null},
    credit,
  ]});
}

// صرف شريك: شريك Dr / نقد Cr
export async function je_payout({sys,date,amount,fileNo,refId,partner,method}) {
  if(!amount||amount<=0) return;
  const cashAcc = method==='نقد'?'1110':'1120';
  const cashNm  = method==='نقد'?'النقد':'البنك';
  await postDoubleEntry({sys,date,fileNo,refTable:'partner_payouts',refId,desc:`صرف شريك ${partner} — ملف ${fileNo}`,lines:[
    {acc:'2400',  name:`حسابات الشركاء`, dr:amount, cr:0,     contact:partner },
    {acc:cashAcc, name:cashNm,           dr:0,      cr:amount, contact:null    },
  ]});
}

// عهدة: صرف = عهدة Dr / نقد Cr — تسوية = نقد Dr / عهدة Cr
export async function je_custodian({sys, date, amount, custodian, desc, method, direction='issue', refId=null}) {
  if (!amount || amount <= 0) return;
  const cashAcc = method === 'نقد' ? '1110' : '1120';
  const cashNm  = method === 'نقد' ? 'النقد' : 'البنك';
  if (direction === 'issue') {
    // صرف عهدة: DR حسابات العهد / CR نقد
    await postDoubleEntry({sys, date, fileNo:null, refTable:'custodians', refId,
      desc: desc || `عهدة — ${custodian}`, lines:[
      {acc:'1400', name:`حسابات العهد`, dr:amount, cr:0,      contact:custodian },
      {acc:cashAcc, name:cashNm,        dr:0,      cr:amount, contact:null      },
    ]});
  } else {
    // تسوية عهدة: DR نقد / CR حسابات العهد
    await postDoubleEntry({sys, date, fileNo:null, refTable:'custodians', refId,
      desc: desc || `تسوية عهدة — ${custodian}`, lines:[
      {acc:cashAcc, name:cashNm,        dr:amount, cr:0,      contact:null      },
      {acc:'1400',  name:`حسابات العهد`, dr:0,     cr:amount, contact:custodian },
    ]});
  }
}

// مصروف تشغيلي: مصروف Dr / نقد Cr
export async function je_opex({sys,date,amount,expType,desc,method,refNo}) {
  if(!amount||amount<=0) return;
  const eAcc    = OPEX_ACC_MAP[expType] || '6700';
  const cashAcc = method==='نقد'?'1110':'1120';
  const cashNm  = method==='نقد'?'النقد':'البنك';
  await postDoubleEntry({sys,date,fileNo:null,refTable:'operating_expenses',refId:refNo||null,
    desc:`مصروف تشغيلي: ${desc||expType}`,lines:[
    {acc:eAcc,    name:`مصروف تشغيلي — ${expType||'أخرى'}`, dr:amount, cr:0,     contact:null},
    {acc:cashAcc, name:cashNm,                               dr:0,      cr:amount, contact:null},
  ]});
}

// ════════════════════════════════════════════════════════════
// SIMULATE DRAFT JE — معاينة فقط (Preview Mode)
// ════════════════════════════════════════════════════════════
// يبني صفوف "قيود وهمية" (في الذاكرة فقط — لا إدراج في القاعدة)
// تمثّل الأثر المحاسبي المتوقع للعمليات draft (لم تُعتمد بعد) ضمن الفترة.
// تُستخدم لعرض "أرقام تشمل المسودات" للموظف في التقارير دون أي تعديل
// على محرك الترحيل أو على القيود الفعلية. كل صف ناتج يحمل post_status:'draft'
// ومُعرّف سالب (id) لتمييزه كصف معاينة.
//
// نفس منطق je_purchase / je_payment / je_expense / je_payout / je_sale /
// je_collection بالظبط — لكن بدون postDoubleEntry (بدون أي كتابة في DB).
export async function simulateDraftJE(sys, from, to) {
  const toEOD = to + 'T23:59:59';
  const inRange = d => !!d && d >= from && d <= toEOD;
  const out = [];
  let synthId = -1;

  const push = (lines, fileNo, refTable, desc, date) => {
    (lines||[]).forEach(l => {
      out.push({
        id: synthId--,
        entry_date:   date,
        account_code: l.acc,
        account_name: l.name,
        contact_name: l.contact || null,
        dr_amount:    +l.dr || 0,
        cr_amount:    +l.cr || 0,
        ref_table:    refTable,
        file_no:      fileNo || null,
        description:  l.desc || desc,
        post_status:  'draft',
        _preview:     true,
      });
    });
  };

  try {
    // ── المشتريات draft ──
    const POs = await apiGetAll('purchase_orders', {
      select:'id,po_date,total_purchase,supplier,file_no', system_type:`eq.${sys}`, post_status:'eq.draft',
    });
    (POs||[]).forEach(p => {
      if (!inRange(p.po_date) || !(+p.total_purchase>0)) return;
      push([
        {acc:'1300', name:getAccountName('1300'), dr:+p.total_purchase, cr:0, contact:null},
        {acc:'2100', name:'ذمم الموردين',          dr:0, cr:+p.total_purchase, contact:p.supplier},
      ], p.file_no, 'purchase_orders', `شراء — ملف ${p.file_no} — ${p.supplier} (معاينة)`, p.po_date);
    });

    // ── المدفوعات draft ──
    const PMs = await apiGetAll('payments', {
      select:'id,pay_date,amount,file_no,payer,pay_method', system_type:`eq.${sys}`, post_status:'eq.draft',
    });
    for (const pmt of (PMs||[])) {
      if (!inRange(pmt.pay_date) || !(+pmt.amount>0)) continue;
      let sup = '';
      if (!sup && pmt.file_no) {
        try {
          const po = await apiGet('purchase_orders', { select:'supplier', system_type:`eq.${sys}`, file_no:`eq.${pmt.file_no}`, limit:1 });
          sup = po?.[0]?.supplier || '';
        } catch(_) {}
      }
      if (!sup) sup = 'مورد';
      const payerStr = pmt.payer || sup;
      const cashAcc  = pmt.pay_method==='نقد'?'1110':'1120';
      const cashNm   = pmt.pay_method==='نقد'?'النقد':'البنك';
      if (payerStr && payerStr !== sup) {
        push([
          {acc:'2100', name:'ذمم الموردين',   dr:+pmt.amount, cr:0, contact:sup},
          {acc:'2400', name:'حسابات الشركاء', dr:0, cr:+pmt.amount, contact:payerStr},
        ], pmt.file_no, 'payments', `دفعة للمورد ${sup} بواسطة ${payerStr} — ملف ${pmt.file_no} (معاينة)`, pmt.pay_date);
      } else {
        push([
          {acc:'2100',  name:'ذمم الموردين', dr:+pmt.amount, cr:0, contact:sup},
          {acc:cashAcc, name:cashNm,         dr:0, cr:+pmt.amount, contact:null},
        ], pmt.file_no, 'payments', `دفعة للمورد ${sup} — ملف ${pmt.file_no} (معاينة)`, pmt.pay_date);
      }
    }

    // ── المصاريف draft ──
    const EXPs = await apiGetAll('expenses', {
      select:'id,exp_date,amount,file_no,description,exp_type,pay_method', system_type:`eq.${sys}`, post_status:'eq.draft',
    });
    (EXPs||[]).forEach(e => {
      if (!inRange(e.exp_date) || !(+e.amount>0)) return;
      const eAcc    = EXPENSE_ACCOUNT_MAP[e.exp_type] || '6500';
      const cashAcc = e.pay_method==='نقد'?'1110':'1120';
      const cashNm  = e.pay_method==='نقد'?'النقد':'البنك';
      push([
        {acc:eAcc,    name:e.exp_type||'مصروف', dr:+e.amount, cr:0, contact:null},
        {acc:cashAcc, name:cashNm,               dr:0, cr:+e.amount, contact:null},
      ], e.file_no, 'expenses', `${e.description||'مصروف'} — ملف ${e.file_no||'عام'} (معاينة)`, e.exp_date);
    });

    // ── صرف الشركاء draft ──
    const POuts = await apiGetAll('partner_payouts', {
      select:'id,pay_date,amount,file_no,partner,pay_method', system_type:`eq.${sys}`, post_status:'eq.draft',
    });
    (POuts||[]).forEach(o => {
      if (!inRange(o.pay_date) || !(+o.amount>0)) return;
      const cashAcc = o.pay_method==='نقد'?'1110':'1120';
      const cashNm  = o.pay_method==='نقد'?'النقد':'البنك';
      push([
        {acc:'2400',  name:'حسابات الشركاء', dr:+o.amount, cr:0, contact:o.partner},
        {acc:cashAcc, name:cashNm,           dr:0, cr:+o.amount, contact:null},
      ], o.file_no, 'partner_payouts', `صرف شريك ${o.partner} — ملف ${o.file_no} (معاينة)`, o.pay_date);
    });

    // ── المبيعات draft — مجمّعة حسب الفاتورة لحساب COGS ──
    const Sales = await apiGetAll('sales', {
      select:'id,sale_date,sale_price,vin,customer,file_no,inv_no', system_type:`eq.${sys}`, post_status:'eq.draft',
    });
    const byInv = {};
    (Sales||[]).forEach(s => {
      if (!inRange(s.sale_date)) return;
      const k = `${s.file_no}|${s.inv_no}`;
      if (!byInv[k]) byInv[k] = { rows:[], file_no:s.file_no, inv_no:s.inv_no, customer:s.customer, sale_date:s.sale_date };
      byInv[k].rows.push(s);
    });
    for (const k in byInv) {
      const grp = byInv[k];
      const totalAmount = grp.rows.reduce((s,r)=>s+(+r.sale_price||0),0);
      if (!(totalAmount>0)) continue;
      let cost = 0;
      try { cost = await calcCOGS(sys, grp.file_no, grp.rows.length, { soldVins: grp.rows.map(r=>r.vin) }); } catch(_) {}
      const lines = [
        {acc:'1200', name:'ذمم العملاء',          dr:totalAmount, cr:0, contact:grp.customer, desc:`فاتورة ${grp.inv_no}`},
        {acc:'4100', name:getAccountName('4100'), dr:0, cr:totalAmount, contact:null,          desc:`فاتورة ${grp.inv_no}`},
      ];
      if (cost>0) {
        lines.push({acc:'5100', name:'تكلفة المخزون المباع', dr:cost, cr:0, contact:null});
        lines.push({acc:'1300', name:'المخزون — سيارات',     dr:0,    cr:cost, contact:null});
      }
      push(lines, grp.file_no, 'sales', `بيع فاتورة ${grp.inv_no} — ${grp.customer} — ملف ${grp.file_no} (معاينة)`, grp.sale_date);
    }

    // ── التحصيلات المدفوعة draft ──
    const Cols = await apiGetAll('collections', {
      select:'id,paid_date,amount,file_no,customer,inv_no,pay_method', system_type:`eq.${sys}`, post_status:'eq.draft',
    });
    (Cols||[]).forEach(c => {
      if (!c.paid_date || !inRange(c.paid_date) || !(+c.amount>0)) return;
      const cashAcc = c.pay_method==='نقد'?'1110':'1120';
      const cashNm  = c.pay_method==='نقد'?'النقد':'البنك';
      push([
        {acc:cashAcc, name:cashNm,        dr:+c.amount, cr:0, contact:null},
        {acc:'1200',  name:'ذمم العملاء', dr:0, cr:+c.amount, contact:c.customer},
      ], c.file_no, 'collections', `تحصيل ${c.inv_no} — ${c.customer} — ملف ${c.file_no} (معاينة)`, c.paid_date);
    });
  } catch(e) { console.warn('simulateDraftJE:', e.message); }

  return out;
}

// ════════════════════════════════════════
// WINDOW BRIDGE — تعريض رموز الموديول للسكريبتات الكلاسيكية
// (مؤقت لحد ما باقي الملفات تتحول لـ ES Modules في Phase 2)
// ════════════════════════════════════════
Object.assign(window, {
  EXPENSE_ACCOUNT_MAP, OPEX_ACC_MAP,
  isAdminUser, adminPostsImmediately, entryStatus,
  toggleAdminPostSetting, updateAdminPostToggleUI,
  updateJEInPlace, voidTransaction, reverseManualJE, voidPurchaseOrder,
  _jeNo, postDoubleEntry, calcCOGS,
  je_purchase, je_sale, je_collection, je_payment, je_expense, je_payout,
  je_custodian, je_opex, simulateDraftJE,
  TREASURY_PARTNER, _isPartnerPocket, USER_DISPLAY_NAMES, displayUser,
});

// ════════════════════════════════════════
// INIT
// ════════════════════════════════════════

// ✅ ربط engineHooks بالدوال الفعلية بيحصل هنا (جوه engine.js) مش في
// transactions.js/operations.js — تنفيذ الموديول مؤجَّل زي defer، فمضمون
// إن window.initApp / window.loadApprovalQueue اتعرّفوا قبل السطرين دول.
engineHooks.onAppReady     = window.initApp;
engineHooks.onVoidComplete = window.loadApprovalQueue;

(function init() {
  const savedToken   = localStorage.getItem('tm_token');
  const savedRefresh = localStorage.getItem('tm_refresh');
  const savedUser    = localStorage.getItem('tm_user');
  if (savedToken) {
    state.token        = savedToken;
    state.refreshToken = savedRefresh || null;
    state.user         = savedUser ? JSON.parse(savedUser) : { email: 'user@tm.com' };
    // ✅ الموديول مؤجَّل بطبيعته، فـ readyState عملياً مش هيبقى 'loading'
    // هنا أبداً — سايبين الفرع ده كطبقة أمان زيادة بس.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        if (engineHooks.onAppReady) engineHooks.onAppReady();
      });
    } else {
      if (engineHooks.onAppReady) engineHooks.onAppReady();
    }
  }

  // Prefill saved credentials
  const remember    = localStorage.getItem('tm_remember');
  const savedEmail  = localStorage.getItem('tm_saved_email');
  const savedPass   = localStorage.getItem('tm_saved_pass');
  if (remember && savedEmail) {
    document.getElementById('loginEmail').value   = savedEmail;
    document.getElementById('rememberMe').checked = true;
    document.getElementById('savedBadge').style.display    = 'inline-block';
    document.getElementById('clearSavedBtn').style.display = 'block';
    if (savedPass) {
      try {
        document.getElementById('loginPass').value = decodeURIComponent(escape(atob(savedPass)));
      } catch(e) {}
    }
  }

  // Set today as default dates
  const dateInputs = document.querySelectorAll('input[type="date"]');
  dateInputs.forEach(inp => { if (!inp.value) inp.value = today(); });
})();

// ════════════════════════════════════════
// PWA — unregister any old SW to prevent caching
// ════════════════════════════════════════
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(reg => reg.unregister());
  });
}
