// ╔══════════════════════════════════════════════════════════╗
// ║  engine.js — JE Manager · Migration · Import Wizard     ║
// ║           Double Entry Posting Engine · PWA · Init      ║
// ║  Transit Management System — نقل حرفي، لا تعديل منطق   ║
// ╚══════════════════════════════════════════════════════════╝
const EXPENSE_ACCOUNT_MAP = {
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
const OPEX_ACC_MAP = {
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
// IN-PLACE JE UPDATE HELPER
// يُحدِّث أسطر القيد الأصلي مباشرة دون إنشاء قيد جديد
// الاستخدام: updateJEInPlace({ sys, fileNo, refTable, refId, oldAmount, newAmount, contactPatch })
// ════════════════════════════════════════════════════════════════
async function updateJEInPlace({ sys, fileNo, refTable, refId, oldAmount, newAmount, contactPatch = null }) {
  const amountChanged  = Math.abs((+oldAmount||0) - (+newAmount||0)) > 0.001;
  const contactChanged = contactPatch != null;
  if (!amountChanged && !contactChanged) return;

  try {
    let entryNo = null;

    // ✅ المسار الأساسي: بحث مباشر عبر ref_id (بدون حد أقصى على عدد السطور) — يعمل بشكل صحيح حتى مع الملفات الكبيرة
    if (refId != null) {
      const byRef = await apiGetAll('journal_entries', {
        select: 'entry_no', system_type: `eq.${sys}`,
        ref_table: `eq.${refTable}`, ref_id: `eq.${refId}`,
        post_status: 'eq.posted', limit: 1,
      });
      if (byRef?.length) entryNo = byRef[0].entry_no;
    }

    // مسار احتياطي: بحث بالمبلغ ضمن آخر 40 قيد لهذا الملف — فقط لو ref_id غير موجود/غير مطابق
    if (!entryNo && amountChanged) {
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
      select: 'id,dr_amount,cr_amount,contact_name',
      system_type: `eq.${sys}`,
      entry_no: `eq.${entryNo}`,
    });

    for (const line of (allLines||[])) {
      const patch = {};
      if (amountChanged) {
        if ((+line.dr_amount||0) > 0) patch.dr_amount = +newAmount;
        if ((+line.cr_amount||0) > 0) patch.cr_amount = +newAmount;
      }
      if (contactChanged && contactPatch && (line.contact_name || (+line.cr_amount||0) > 0)) {
        patch.contact_name = contactPatch;
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
// REVERSAL ENGINE — إلغاء العمليات بقيد عكسي
// المبدأ:
//   1. يُضيف قيد عكسي (Dr↔Cr معكوسة) بتاريخ اليوم
//   2. يضع post_status='voided' على السجل التشغيلي
//   3. لا يُحذف أي بيانات — كل شيء يبقى في التاريخ
// ════════════════════════════════════════════════════════════════

async function voidTransaction(type, record, force=false) {
  const sys     = state.system;
  const today_  = today();
  const amount  = +record.amount || +record.sale_price || 0;

  if (!amount || amount <= 0) throw new Error('المبلغ صفر — لا يوجد قيد لعكسه');

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
      if (typeof loadApprovalQueue === 'function') await loadApprovalQueue();
      toast('🔄 تم إرسال طلب الإلغاء للمراجعة', 'ok');
      return;
    }
  }

  // ── بناء أسطر القيد العكسي حسب نوع العملية ──
  let reversalLines = [];
  let reversalDesc  = '';
  let refTable      = 'reversal';

  if (type === 'payment') {
    // القيد الأصلي: Dr 2100 ذمم موردين / Cr 1110|1120 نقد|بنك
    // العكس:        Dr 1110|1120 / Cr 2100
    const cashAcc = (record.pay_method||'') === 'نقد' ? '1110' : '1120';
    const cashNm  = (record.pay_method||'') === 'نقد' ? 'النقد' : 'البنك';
    const sup     = record.supplier || record.payer || 'مورد';
    reversalDesc  = `عكس دفعة ${record.ref_no||record.pay_id||''} — ${sup} — ملف ${record.file_no}`;
    reversalLines = [
      { acc: cashAcc, name: cashNm,           dr: amount, cr: 0,      contact: null },
      { acc: '2100',  name: 'ذمم الموردين',   dr: 0,      cr: amount, contact: sup  },
    ];

  } else if (type === 'expense') {
    // القيد الأصلي: Dr 6xxx / Cr 1110|1120
    // العكس:        Dr 1110|1120 / Cr 6xxx
    const eAcc    = EXPENSE_ACCOUNT_MAP[record.exp_type||record.category] || '6500';
    const cashAcc = (record.pay_method||'') === 'نقد' ? '1110' : '1120';
    const cashNm  = (record.pay_method||'') === 'نقد' ? 'النقد' : 'البنك';
    reversalDesc  = `عكس مصروف ${record.ref_no||''} — ${record.description||''} — ملف ${record.file_no}`;
    reversalLines = [
      { acc: cashAcc, name: cashNm,                         dr: amount, cr: 0,      contact: null },
      { acc: eAcc,    name: record.exp_type || 'مصروف',     dr: 0,      cr: amount, contact: null },
    ];

  } else if (type === 'collection') {
    // القيد الأصلي: Dr 1110|1120 / Cr 1200 ذمم عملاء
    // العكس:        Dr 1200 / Cr 1110|1120
    const cashAcc = (record.pay_method||'') === 'نقد' ? '1110' : '1120';
    const cashNm  = (record.pay_method||'') === 'نقد' ? 'النقد' : 'البنك';
    const cust    = record.customer || 'عميل';
    reversalDesc  = `عكس تحصيل ${record.ref_no||''} — ${cust} — فاتورة ${record.inv_no||''}`;
    reversalLines = [
      { acc: '1200',  name: 'ذمم العملاء', dr: amount, cr: 0,      contact: cust },
      { acc: cashAcc, name: cashNm,         dr: 0,      cr: amount, contact: null },
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

async function _jeNo(sys) {
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

async function postDoubleEntry({sys, date, fileNo, refTable, refId, desc, lines}) {
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
async function calcCOGS(sys, fileNo, soldCount, { alreadySold = null, alreadyCOGS = null } = {}) {
  if (!soldCount || soldCount <= 0) return 0;
  try {
    // جلب بيانات الملف
    const [poRows, vehRows, expRows] = await Promise.all([
      apiGetAll('purchase_orders', { select:'total_purchase', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGetAll('vehicles',        { select:'id',             system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGetAll('expenses',        { select:'amount',         system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, post_status:'eq.posted' }),
    ]);
    const totalPurchase = +((poRows||[])[0]?.total_purchase || 0);
    const totalExp      = (expRows||[]).reduce((s,e) => s + (+e.amount||0), 0);
    const totalVeh      = (vehRows||[]).length || 1;
    const fullCost      = totalPurchase + totalExp;

    // إذا لم تُمرَّر قيم جاهزة — اجلبها من القيود المرحّلة
    let _alreadyCOGS = alreadyCOGS;
    let _alreadySold = alreadySold;

    if (_alreadyCOGS === null || _alreadySold === null) {
      const [jeRows, soldRows] = await Promise.all([
        apiGetAll('journal_entries', { select:'dr_amount', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, account_code:'eq.5100', post_status:'eq.posted' }),
        apiGetAll('sales',           { select:'id',        system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, post_status:'eq.posted' }),
      ]);
      if (_alreadyCOGS === null) _alreadyCOGS = (jeRows||[]).reduce((s,r) => s + (+r.dr_amount||0), 0);
      if (_alreadySold === null) _alreadySold  = (soldRows||[]).length;
    }

    // التكلفة والسيارات المتبقية قبل هذا البيع
    const remainingVeh  = Math.max(totalVeh - _alreadySold, soldCount);
    const remainingCost = Math.max(fullCost  - _alreadyCOGS, 0);
    const costPerVeh    = remainingVeh > 0 ? remainingCost / remainingVeh : 0;

    return Math.round(costPerVeh * soldCount * 100) / 100;
  } catch(e) {
    console.warn('calcCOGS error:', e.message);
    return 0;
  }
}

// شراء: مخزون Dr / مورد Cr
async function je_purchase({sys,date,amount,fileNo,supplier}) {
  if(!amount||amount<=0) return;
  await postDoubleEntry({sys,date,fileNo,refTable:'purchase_orders',desc:`شراء — ملف ${fileNo} — ${supplier}`,lines:[
    {acc:'1300', name:getAccountName('1300'),  dr:amount, cr:0,      contact:null     },
    {acc:'2100', name:`ذمم الموردين`,           dr:0,      cr:amount, contact:supplier },
  ]});
}

// بيع: عميل Dr / إيراد Cr
async function je_sale({sys,date,amount,cost,fileNo,customer,invNo}) {
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
async function je_collection({sys,date,amount,fileNo,refId,customer,invNo,method}) {
  if(!amount||amount<=0) return;
  const cashAcc = method==='نقد'?'1110':'1120';
  const cashNm  = method==='نقد'?'النقد':'البنك';
  await postDoubleEntry({sys,date,fileNo,refTable:'collections',refId,desc:`تحصيل ${invNo} — ${customer} — ملف ${fileNo}`,lines:[
    {acc:cashAcc, name:cashNm,           dr:amount, cr:0,     contact:null     },
    {acc:'1200',  name:`ذمم العملاء`,    dr:0,      cr:amount, contact:customer },
  ]});
}

// دفعة مورد: مورد Dr / نقد Cr
// لو الدافع (payer) شريك مختلف عن المورد → يُضاف سطر ثالث على حساب الشريك 2400
// حتى يظهر ما دفعه الشريك في كشف حسابه
async function je_payment({sys,date,amount,fileNo,refId,supplier,supplierName,payer,payerName,method}) {
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

  const payerIsPartner = payerStr && payerStr !== sup;

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
async function je_expense({sys,date,amount,fileNo,refId,desc,expType,method}) {
  if(!amount||amount<=0) return;
  const eAcc     = EXPENSE_ACCOUNT_MAP[expType]||'6500';
  const cashAcc  = method==='نقد'?'1110':'1120';
  const cashNm   = method==='نقد'?'النقد':'البنك';
  await postDoubleEntry({sys,date,fileNo,refTable:'expenses',refId,desc:`${desc} — ملف ${fileNo||'عام'}`,lines:[
    {acc:eAcc,    name:expType||'مصروف', dr:amount, cr:0,     contact:null},
    {acc:cashAcc, name:cashNm,           dr:0,      cr:amount, contact:null},
  ]});
}

// صرف شريك: شريك Dr / نقد Cr
async function je_payout({sys,date,amount,fileNo,refId,partner,method}) {
  if(!amount||amount<=0) return;
  const cashAcc = method==='نقد'?'1110':'1120';
  const cashNm  = method==='نقد'?'النقد':'البنك';
  await postDoubleEntry({sys,date,fileNo,refTable:'partner_payouts',refId,desc:`صرف شريك ${partner} — ملف ${fileNo}`,lines:[
    {acc:'2400',  name:`حسابات الشركاء`, dr:amount, cr:0,     contact:partner },
    {acc:cashAcc, name:cashNm,           dr:0,      cr:amount, contact:null    },
  ]});
}

// عهدة: صرف = عهدة Dr / نقد Cr — تسوية = نقد Dr / عهدة Cr
async function je_custodian({sys, date, amount, custodian, desc, method, direction='issue', refId=null}) {
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
async function je_opex({sys,date,amount,expType,desc,method,refNo}) {
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
async function simulateDraftJE(sys, from, to) {
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
      try { cost = await calcCOGS(sys, grp.file_no, grp.rows.length); } catch(_) {}
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

let _pwaInstallPrompt = null;



// ════════════════════════════════════════
// INIT
// ════════════════════════════════════════
(function init() {
  const savedToken   = localStorage.getItem('tm_token');
  const savedRefresh = localStorage.getItem('tm_refresh');
  const savedUser    = localStorage.getItem('tm_user');
  if (savedToken) {
    state.token        = savedToken;
    state.refreshToken = savedRefresh || null;
    state.user         = savedUser ? JSON.parse(savedUser) : { email: 'user@tm.com' };
    // ✅ انتظر اكتمال DOM + كل الملفات قبل initApp
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        if (typeof initApp === 'function') initApp();
      });
    } else {
      if (typeof initApp === 'function') initApp();
    }
  }

  // Prefill saved credentials
  const remember    = localStorage.getItem('tm_remember');
  const savedEmail  = localStorage.getItem('tm_saved_email');
  const savedPass   = localStorage.getItem('tm_saved_pass');
  // ── تذكرني: email فقط — كلمة المرور لا تُحفظ ──
  if (remember && savedEmail) {
    document.getElementById('loginEmail').value   = savedEmail;
    document.getElementById('rememberMe').checked = true;
    document.getElementById('savedBadge').style.display    = 'inline-block';
    document.getElementById('clearSavedBtn').style.display = 'block';
  }
  // مسح أي كلمة مرور قديمة محفوظة من نسخ سابقة
  localStorage.removeItem('tm_saved_pass');

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
