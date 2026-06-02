// ╔══════════════════════════════════════════════════════════╗
// ║  engine.js — JE Manager · Migration · Import Wizard     ║
// ║           Double Entry Posting Engine · PWA · Init      ║
// ║  Transit Management System — نقل حرفي، لا تعديل منطق   ║
// ╚══════════════════════════════════════════════════════════╝
const EXPENSE_ACCOUNT_MAP = {
  'شحن':'5200','جمارك':'6600','تأمين':'6600',
  'إدارية':'6500','صيانة':'6700','أخرى':'6500',
  'إيجار':'6100','رواتب':'6200','نقل':'5200','تسويق':'6500',
};

// ════════════════════════════════════════════════════════════════
// REVERSAL ENGINE — إلغاء العمليات بقيد عكسي
// المبدأ:
//   1. يُضيف قيد عكسي (Dr↔Cr معكوسة) بتاريخ اليوم
//   2. يضع post_status='voided' على السجل التشغيلي
//   3. لا يُحذف أي بيانات — كل شيء يبقى في التاريخ
// ════════════════════════════════════════════════════════════════

async function voidTransaction(type, record) {
  const sys     = state.system;
  const today_  = today();
  const amount  = +record.amount || +record.sale_price || 0;

  if (!amount || amount <= 0) throw new Error('المبلغ صفر — لا يوجد قيد لعكسه');

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
async function je_collection({sys,date,amount,fileNo,customer,invNo,method}) {
  if(!amount||amount<=0) return;
  const cashAcc = method==='نقد'?'1110':'1120';
  const cashNm  = method==='نقد'?'النقد':'البنك';
  await postDoubleEntry({sys,date,fileNo,refTable:'collections',desc:`تحصيل ${invNo} — ${customer} — ملف ${fileNo}`,lines:[
    {acc:cashAcc, name:cashNm,           dr:amount, cr:0,     contact:null     },
    {acc:'1200',  name:`ذمم العملاء`,    dr:0,      cr:amount, contact:customer },
  ]});
}

// دفعة مورد: مورد Dr / نقد Cr
async function je_payment({sys,date,amount,fileNo,supplier,supplierName,payer,payerName,method}) {
  if(!amount||amount<=0) return;
  const sup      = supplier || supplierName || 'مورد';
  const payerStr = payer || payerName || sup;
  const cashAcc  = method==='نقد'?'1110':'1120';
  const cashNm   = method==='نقد'?'النقد':'البنك';
  await postDoubleEntry({sys,date,fileNo,refTable:'payments',desc:`دفعة للمورد ${sup} بواسطة ${payerStr} — ملف ${fileNo}`,lines:[
    {acc:'2100',  name:`ذمم الموردين`, dr:amount, cr:0,     contact:sup  },
    {acc:cashAcc, name:cashNm,         dr:0,      cr:amount, contact:null },
  ]});
}

// مصروف: مصروف Dr / نقد Cr
async function je_expense({sys,date,amount,fileNo,desc,expType,method}) {
  if(!amount||amount<=0) return;
  const eAcc     = EXPENSE_ACCOUNT_MAP[expType]||'6500';
  const cashAcc  = method==='نقد'?'1110':'1120';
  const cashNm   = method==='نقد'?'النقد':'البنك';
  await postDoubleEntry({sys,date,fileNo,refTable:'expenses',desc:`${desc} — ملف ${fileNo||'عام'}`,lines:[
    {acc:eAcc,    name:expType||'مصروف', dr:amount, cr:0,     contact:null},
    {acc:cashAcc, name:cashNm,           dr:0,      cr:amount, contact:null},
  ]});
}

// صرف شريك: شريك Dr / نقد Cr
async function je_payout({sys,date,amount,fileNo,partner,method}) {
  if(!amount||amount<=0) return;
  const cashAcc = method==='نقد'?'1110':'1120';
  const cashNm  = method==='نقد'?'النقد':'البنك';
  await postDoubleEntry({sys,date,fileNo,refTable:'partner_payouts',desc:`صرف شريك ${partner} — ملف ${fileNo}`,lines:[
    {acc:'2400',  name:`حسابات الشركاء`, dr:amount, cr:0,     contact:partner },
    {acc:cashAcc, name:cashNm,           dr:0,      cr:amount, contact:null    },
  ]});
}

// مصروف تشغيلي: مصروف Dr / نقد Cr
async function je_opex({sys,date,amount,expType,desc,method,refNo}) {
  if(!amount||amount<=0) return;
  const OPEX_ACC_MAP = {
    'رواتب':'6100','إيجارات':'6200','عمولات':'6300',
    'نظافة':'6400','ضيافة':'6500','مصروفات حكومية':'6600','أخرى':'6700',
  };
  const eAcc    = OPEX_ACC_MAP[expType] || '6700';
  const cashAcc = method==='نقد'?'1110':'1120';
  const cashNm  = method==='نقد'?'النقد':'البنك';
  await postDoubleEntry({sys,date,fileNo:null,refTable:'operating_expenses',refId:refNo||null,
    desc:`مصروف تشغيلي: ${desc||expType}`,lines:[
    {acc:eAcc,    name:`مصروف تشغيلي — ${expType||'أخرى'}`, dr:amount, cr:0,     contact:null},
    {acc:cashAcc, name:cashNm,                               dr:0,      cr:amount, contact:null},
  ]});
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
    initApp();
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
