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
// IN-PLACE JE UPDATE HELPER — (الاسم قديم، لم يعد "in place" فعلياً)
// القيد المُرحَّل لا يُعدَّل مطلقاً بعد اليوم (مبدأ ثبات القيد المُرحَّل):
// بدل الـPATCH المباشر على الصف القديم، الدالة تعكس القيد القديم بقيمه
// الأصلية بالضبط (Dr↔Cr معكوسة، بنفس أسلوب voidTransaction) ثم تُرحِّل قيداً
// جديداً صحيحاً بنفس أسطر/حسابات القيد القديم بعد تطبيق التعديل عليها —
// بنفس ref_table/ref_id الأصليين حتى يظل قابلاً للتعديل مرة أخرى لاحقاً
// (كل استدعاء يجد أحدث قيد posted بنفس ref_table/ref_id عبر order:id.desc).
// الاستخدام: updateJEInPlace({ sys, fileNo, refTable, refId, oldAmount, newAmount, contactPatch })
// oldCost/newCost (اختياري): لقيود متعددة المبالغ (مثل البيع: إيراد + تكلفة) — يُحدَّث
// كل زوج بمبلغه الخاص فقط (مطابقة بالقيمة الفعلية، لا "أي سطر موجب") حتى لا يُكتب
// مبلغ الإيراد فوق سطر التكلفة بالخطأ
// ════════════════════════════════════════════════════════════════
// contactAccount: لو اتحدد، تغيير الاسم (contactPatch) يتطبّق على سطور الحساب ده
// بس. من غيره (الافتراضي القديم) بيتطبّق على أي سطر فيه اسم أو دائن — وده في
// قيد تحصيل استلمه شريك كان هيكتب اسم العميل مكان الشريك على سطر 2400، وفي قيد
// البيع بيحط اسم العميل على 4100/1300 (post_sale_je بيحطه على 1200 بس)
export async function updateJEInPlace({ sys, fileNo, refTable, refId, oldAmount, newAmount, contactPatch = null, contactAccount = null, newDate = null, oldCost = null, newCost = null, oldMethod = null, newMethod = null, oldSourceAccount = null, newSource = null }) {
  // ✅ B-2c3 — «مصدر ← مصدر» (DESIGN §٦): لو السجل ليه مصدر محفوظ (oldSourceAccount)، سطر المصدر
  // بيتحرك **بس** لما newSource (من resolveMoneySource/sourceFromRecord) يبقى حساب تاني — وطريقة
  // الدفع لوحدها مابتحرّكش القيد (عرض بس لحد البنوك). من غيرهم (السجل القديم) ⇒ المسار القديم بالحرف.
  const sourceMode = oldSourceAccount != null || newSource != null;
  if (sourceMode) {
    if (oldSourceAccount == null) throw new Error(`تعديل ${refTable}: نقل سجل قديم (من غير مصدر محفوظ) لمصدر = عكس + إعادة ترحيل، مش تعديل في المكان`);
    if (newSource == null || !isResolvedSource(newSource)) throw new Error(`تعديل ${refTable}: المصدر الجديد لازم ييجي من resolveMoneySource/sourceFromRecord`);
    if (newSource.sys !== sys) throw new Error(`تعديل ${refTable}: مصدر من ${newSource.sys} والقيد في ${sys} — القيد المرآة لسه (B-2f)`);
    // contactPatch من غير contactAccount بيلمس كل سطر فيه contact أو دائن — منهم سطر المصدر
    // (contact لازم يفضل null للعهدة، §٣) ⇒ مع مصدر محفوظ لازم يتحدد الحساب صراحةً
    if (contactPatch != null && !contactAccount) throw new Error(`تعديل ${refTable}: تغيير الطرف مع مصدر محفوظ محتاج contactAccount صريح`);
  }
  const sourceChanged  = sourceMode && String(newSource.account) !== String(oldSourceAccount);
  const amountChanged  = oldAmount != null && Math.abs((+oldAmount||0) - (+newAmount||0)) > 0.001;
  const costChanged    = oldCost != null && newCost != null && Math.abs((+oldCost||0) - (+newCost||0)) > 0.001;
  const contactChanged = contactPatch != null;
  const dateChanged    = newDate != null && newDate !== '';   // ✅ مزامنة تاريخ القيد مع تاريخ العملية
  // ✅ تغيّر حساب النقدية (نقد↔بنك). كان مفقودًا تمامًا: تعديل طريقة الدفع
  // كان يُحدِّث السجل ويترك القيد على الحساب القديم ⇒ رصيد النقد أعلى من
  // الحقيقة والبنك أقل بنفس المبلغ، بلا أي كاشف — القيد يبقى متوازنًا
  // فميزان المراجعة يظل سليمًا. باج حيّ في تعديل الدفعات والمصاريف
  // والتحصيلات وصرف الشريك. نقارن الحساب لا النصّ: 'تحويل بنكي'→'شيك'
  // كلاهما 1120 فلا يستدعي إعادة ترحيل.
  const _cashAccOf     = m => (m||'') === 'نقد' ? '1110' : '1120';
  const methodChanged  = !sourceMode && oldMethod != null && newMethod != null   // ✅ B-2c3: مع مصدر ⇒ عرض بس
                       && _cashAccOf(oldMethod) !== _cashAccOf(newMethod);
  if (!amountChanged && !costChanged && !contactChanged && !dateChanged && !methodChanged && !sourceChanged) return;

  {
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
    // ⚠️ لا يعمل المسار الاحتياطي بلا file_no — لأي نوع. أمانه كله قائم على
    // حصر البحث في ملف واحد؛ بدونه يصير بحثًا عبر النظام كله بمطابقة مبلغ
    // مجرّد ضمن آخر 40 قيدًا، فقد يلتقط قيد كيان آخر تمامًا ويعكسه بصمت.
    // الأنواع بلا ملف (سحب/إيداع عام بالتصميم، والمصروف التشغيلي) تعتمد على
    // ref_id وحده وتفشل صراحةً إن غاب — والفشل الظاهر أأمن من عكس قيد خطأ.
    if (!entryNo && fileNo && (amountChanged || dateChanged || costChanged || methodChanged || sourceChanged)) {
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
    if (!entryNo) throw new Error(`تعديل ${refTable}: لم يُعثر على القيد المحاسبي الأصلي لتحديثه — التعديل على السجل لن يكتمل`);

    // جيب كل أسطر هذا القيد بالـ entry_no — نحتاج account_code/account_name/description
    // كاملة الآن (لا فقط dr/cr/contact) عشان نعيد ترحيلها كقيد جديد، مش نُعدِّلها في مكانها
    const allLines = await apiGetAll('journal_entries', {
      select: 'id,account_code,account_name,contact_name,dr_amount,cr_amount,entry_date,description',
      system_type: `eq.${sys}`,
      entry_no: `eq.${entryNo}`,
    });
    if (!allLines?.length) throw new Error(`تعديل ${refTable}: القيد ${entryNo} غير موجود بأسطره — التعديل على السجل لن يكتمل`);

    // ✅ B-2c3: القيد لازم يكون فعلًا على حساب المصدر المحفوظ — وإلا السجل والقيد مختلفين ⇒ وقف
    // (مش تخمين). واسم الحساب الجديد من الشجرة زي الكتّاب (_sourceLine).
    let newSrcName = null;
    if (sourceMode) {
      if (!allLines.some(l => String(l.account_code) === String(oldSourceAccount))) {
        throw new Error(`تعديل ${refTable}: القيد ${entryNo} مش على حساب المصدر المحفوظ ${oldSourceAccount} — راجع اليومية قبل التعديل`);
      }
      if (sourceChanged) newSrcName = (await _sourceLine(sys, newSource, 0, 'cr')).name;
    }

    // ── ابنِ أسطر القيد الجديد الصحيح: نفس حسابات القيد القديم بالضبط، بعد
    //    تطبيق التعديل على كل سطر بمطابقة القيمة الفعلية (نفس منطق المطابقة
    //    القديم) — لا "أي سطر موجب"، حتى لا يُكتب مبلغ الإيراد فوق سطر التكلفة
    let anyLineChanged = false;
    const correctedLines = allLines.map(line => {
      const dr = +line.dr_amount||0, cr = +line.cr_amount||0;
      let newDr = dr, newCr = cr, contact = line.contact_name || null;
      if (amountChanged) {
        if (Math.abs(dr - (+oldAmount||0)) < 0.001 && dr > 0) { newDr = +newAmount; anyLineChanged = true; }
        if (Math.abs(cr - (+oldAmount||0)) < 0.001 && cr > 0) { newCr = +newAmount; anyLineChanged = true; }
      }
      if (costChanged) {
        if (Math.abs(dr - (+oldCost||0)) < 0.001 && dr > 0) { newDr = +newCost; anyLineChanged = true; }
        if (Math.abs(cr - (+oldCost||0)) < 0.001 && cr > 0) { newCr = +newCost; anyLineChanged = true; }
      }
      if (contactChanged && contactPatch && (contactAccount ? line.account_code === contactAccount : (line.contact_name || cr > 0))
          && contact !== contactPatch) { contact = contactPatch; anyLineChanged = true; }
      // ✅ نقل سطر النقدية إلى حسابها الجديد. الشرط على 1110/1120 حصرًا
      // مقصود: مصروف دفعه شريك من جيبه طرفه المقابل 2400 لا نقدية، وطريقة
      // الدفع لا تعنيه — فلا يُلمس. وكذلك 2100/1200 وباقي الحسابات.
      let accCode = line.account_code, accName = line.account_name;
      if (methodChanged && (accCode === '1110' || accCode === '1120')) {
        accCode = _cashAccOf(newMethod);
        accName = accCode === '1110' ? 'النقد' : 'البنك';
        anyLineChanged = true;
      }
      // ✅ B-2c3: نقل سطر المصدر (المحفوظ) للمصدر الجديد — contact null للعهدة واسم الشريك للشريك
      if (sourceChanged && String(accCode) === String(oldSourceAccount)) {
        accCode = newSource.account;
        accName = newSrcName;
        contact = newSource.kind === 'partner' ? newSource.contact : null;
        anyLineChanged = true;
      }
      return {
        acc: accCode, name: accName,
        dr: newDr, cr: newCr, contact,
        desc: line.description || null,
      };
    });
    if (!anyLineChanged && !dateChanged) return;   // لا تغيير فعلي على أي سطر — لا داعي لقيدين جديدين

    const today_     = today();
    const entryDate  = dateChanged ? newDate : (allLines[0].entry_date || today_);
    const fallbackDesc = `تصحيح قيد ${refTable} — ملف ${fileNo||'—'}`;

    // ── 1. ترحيل القيد الجديد الصحيح أولاً (قبل عكس القديم) ──
    // ✅ الترتيب مقصود: لو رحّلنا العكس أولاً ثم فشل ترحيل الجديد (خطأ شبكة/عدم
    // توازن/إلخ)، القيمة المحاسبية للعملية تتصفّر فعليًا وبصمت (القديم اتعكس،
    // ولا بديل حل محله) — خطر تصفير صامت. بالترتيب العكسي (الجديد أولاً): لو
    // فشل ترحيل الجديد، القديم يبقى كما هو (قيمة قديمة لكن غير صفر — لا فقدان
    // بيانات، والخطأ يُسجَّل زي ما كان). لو نجح الجديد وفشل عكس القديم (الخطوة
    // 2 تحت)، النتيجة ازدواج مكتشَف بسهولة (الرصيد يبقى مضاعفاً لا مصفَّراً)
    // وله تنبيه صريح تحت بدل الابتلاع الصامت.
    // ✅ isPrimary:false — القديم يفضل حامل uq_je_ref_primary_posted لحد ما
    // عكسه (الخطوة 2) ينجح كمان؛ التسليم الفعلي مؤجَّل لـ_handoffPrimaryLine
    // تحت، بعد نجاح الاتنين معاً (راجع تعليق postDoubleEntry لتفصيل السبب)
    const newPosted = await postDoubleEntry({
      sys, date: entryDate, fileNo,
      refTable, refId,
      desc: fallbackDesc,
      lines: correctedLines,
      isPrimary: false,
    });

    // ── 2. عكس القيد القديم بالكامل بقيمه الأصلية (Dr↔Cr معكوسة) — بنفس أسلوب
    //    voidTransaction، لكن الوصف يبدأ بـ"عكس تعديل" (لا "عكس" العادي) ويحمل
    //    entry_no الصريح للقيد القديم المُعكوس — يستخدمه _excludeReversalPairs
    //    (journal.js) ليُخفي هذا القيد بعينه فقط (لا مطابقة عبر ref_id: بعض
    //    الأنواع مثل sales/operating_expenses ref_id فيها تاريخيًا null أو غير
    //    متّسق مع القيمة المستخدمة هنا، فمطابقة ref_id كانت ستُبقي القيد القديم
    //    ظاهراً "مكرراً" بجانب الجديد لهذين النوعين تحديداً)
    const reversalLines = allLines.map(line => ({
      acc: line.account_code, name: line.account_name,
      dr: +line.cr_amount||0, cr: +line.dr_amount||0,
      contact: line.contact_name || null,
    }));
    try {
      await postDoubleEntry({
        sys, date: today_, fileNo,
        refTable: 'reversal', refId,
        desc: `عكس تعديل ${refTable} — ملف ${fileNo||'—'} — تصحيح قيد ${entryNo}`,
        lines: reversalLines,
        reversesId: allLines[0].id,
      });
      // ✅ الاتنين نجحوا (الجديد + عكس القديم) — دلوقتي بس نسلّم is_primary_line
      if (newPosted?.ids?.length) {
        await _handoffPrimaryLine({ sys, oldIds: allLines.map(l => l.id), newIds: newPosted.ids });
      }
    } catch(revErr) {
      // ✅ القيد الجديد اتُرحّل بنجاح لكن عكس القديم فشل — النتيجة ازدواج (قديم
      // + جديد معاً)، لازم تنبيه صريح للمستخدم لأنه محتاج تنظيف يدوي فوري —
      // لا يجوز ابتلاعه بصمت زي باقي أخطاء هذه الدالة
      console.error(`updateJEInPlace [${refTable}]: فشل عكس القيد القديم بعد نجاح ترحيل الجديد — ازدواج محتمل في القيود:`, revErr.message);
      toast(`⚠️ تم ترحيل التصحيح لكن فشل عكس القيد القديم (قيد ${entryNo}) — راجع اليومية يدوياً، قد يوجد قيد مكرر`, 'warn');
    }
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
    const tableMap = { payment:'payments', expense:'expenses', collection:'collections', payout:'partner_payouts', ledger:'partner_ledger' };
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
  // ✅ id لسطر من القيد الأصلي — يُمرَّر لـpostDoubleEntry لكتابة reverses/reversed_by
  // الفعليين (project_dual_je_audit Case 1)، بدل الاعتماد على مطابقة نصية/ref_id فقط
  let origId        = null;

  if (type === 'payment') {
    // الأصلي: Dr 2100 ذمم موردين / Cr (نقد/بنك أو 2400 لو دفعها شريك)
    // ✅ نقرا الحساب الفعلي من القيد الأصلي (بحث بـref_id) بدل إعادة حسابه بمنطق
    // التوجيه الحالي وقت الإلغاء — نفس مبدأ فرع expense تحت بالحرف. لو منطق
    // التوجيه اتغيّر لاحقًا، أو القيد الأصلي اتقيد وقت فجوة نشر قديمة (حصل فعليًا:
    // JE-2026-00412 على ملف LOT 3 NEW — دفعة اتقيدت غلط على 2400 قبل ما إصلاح
    // التوجيه يوصل للنشر، وبعدين العكس استخدم الحساب "الصح" الجديد فمتقابلوش)،
    // إعادة الحساب كانت بتنتج عكسًا لا يطابق الأصل، وتسيب أثر حقيقي دائم في الدفاتر.
    let crAcc = null, crName = null, crContact = null;
    try {
      // ✅ order:'id.desc' — لو السجل اتعدّل قبل كده (تغيير توجيه عبر submitEditPayment)
      // ممكن يكون فيه أكتر من سطر posted بنفس ref_id (القديم المُستبدَل + الجديد
      // الفعلي، عمدًا زي ما هو موثّق — راجع updateJEInPlace)؛ من غير ترتيب كنا
      // ممكن نمسك السطر القديم الميت بدل الفعلي (نفس فئة باج c799ed7)
      const orig = await apiGetAll('journal_entries', {
        select:'id,account_code,account_name,contact_name,cr_amount',
        system_type:`eq.${sys}`, ref_table:'eq.payments', ref_id:`eq.${record.id}`, post_status:'eq.posted',
        order:'id.desc',
      });
      const crLine = (orig||[]).find(l => (+l.cr_amount||0) > 0);
      if (crLine) { crAcc = crLine.account_code; crName = crLine.account_name; crContact = crLine.contact_name || null; origId = crLine.id || null; }
    } catch(e) { console.warn('void payment: فشل جلب القيد الأصلي:', e.message); }
    if (!crAcc) {
      throw new Error(`تعذّر إيجاد القيد المحاسبي الأصلي لهذه الدفعة (${record.ref_no||record.pay_id||record.id}) — على الأغلب اتحذف من اليومية مباشرة قبل الإلغاء. لا يمكن إلغاؤها بأمان بدون معرفة الحساب الأصلي؛ راجعي اليومية يدوياً أولاً أو أعيدي إدخال القيد.`);
    }
    const sup     = record.supplier || 'مورد';
    reversalDesc  = `عكس دفعة ${record.ref_no||record.pay_id||''} — ${sup} — ملف ${record.file_no}`;
    reversalLines = [
      { acc: crAcc, name: crName, dr: amount, cr: 0, contact: crContact },
      { acc: '2100',  name: 'ذمم الموردين',   dr: 0,      cr: amount, contact: sup  },
    ];

  } else if (type === 'expense') {
    // الأصلي: Dr 1300|5100 (سياسة الترسملة) أو 6xxx/52xx (قيود قديمة) / Cr (نقد/بنك
    // أو 2400 — سطر واحد لمصروف عادي، أو N سطر لمصروف موزَّع بالتساوي على شركاء)
    // ✅ نقرأ كل أسطر القيد الفعلي (كل الأسطر المشتركة في نفس entry_no لسطر
    // المدين المكتشَف) ونعكسها كما هي بالضبط — بدل إعادة بناء سطر دائن واحد من
    // record.paid_by (كانت هذه إعادة البناء تفترض دائمًا شريكًا واحدًا بالضبط،
    // فتفشل تمامًا لمصروف موزَّع على أكثر من شريك؛ نفس مبدأ updateJEInPlace/
    // reverseManualJE أصلاً: نعكس ما هو مكتوب فعليًا في اليومية، لا نعيد تخمينه)
    let eAcc = null, eName = null, expenseLines = [];
    try {
      // ✅ order:'id.desc' — نفس سبب فرع payment فوق (احتمال أكثر من entry_no
      // posted بنفس ref_id فى نفس الوقت، لو السجل اتعدّل قبل كده بتغيير توجيه)
      const orig = await apiGetAll('journal_entries', {
        select:'id,entry_no,account_code,account_name,contact_name,dr_amount,cr_amount',
        system_type:`eq.${sys}`, ref_table:'eq.expenses', ref_id:`eq.${record.id}`, post_status:'eq.posted',
        order:'id.desc',
      });
      const drLine = (orig||[]).find(l => (+l.dr_amount||0) > 0);
      if (drLine) {
        eAcc = drLine.account_code; eName = drLine.account_name || record.exp_type || 'مصروف'; origId = drLine.id || null;
        // كل أسطر نفس القيد الفعلي (نفس entry_no لسطر المدين المكتشَف) — سطر
        // دائن واحد لمصروف عادي، أو N سطر لمصروف موزَّع
        expenseLines = (orig||[]).filter(l => l.entry_no === drLine.entry_no);
      }
    } catch(e) { console.warn('void expense: فشل جلب القيد الأصلي:', e.message); }
    // ✅ لو مفيش قيد أصلي مُرحَّل نلقاه لهذا السجل (اتحذف مباشرة من اليومية مثلاً)،
    // ممنوع نكمل بحساب افتراضي بصمت — ده كان بيعمل قيد عكسي "يتيم" بلا نظير
    // (Dr/Cr على حساب مش بالضرورة الصح) يفرق ميزان المراجعة فعلياً وبلا تنبيه
    // (حصل فعلياً على ملف BOX-138 يوم 2026-07-25 — راجع project_dual_je_audit).
    // الحل: نوقف العملية بخطأ صريح بدل التخمين.
    if (!eAcc) {
      throw new Error(`تعذّر إيجاد القيد المحاسبي الأصلي لهذا المصروف (${record.ref_no||record.id}) — على الأغلب اتحذف من اليومية مباشرة قبل الإلغاء. لا يمكن إلغاؤه بأمان بدون معرفة الحساب الأصلي؛ راجعي اليومية يدوياً أولاً أو أعيدي إدخال القيد.`);
    }
    reversalDesc  = `عكس مصروف ${record.ref_no||''} — ${record.description||''} — ملف ${record.file_no}`;
    reversalLines = expenseLines.map(l => ({
      acc: l.account_code, name: l.account_name,
      dr: +l.cr_amount||0, cr: +l.dr_amount||0,
      contact: l.contact_name || null,
    }));

  } else if (type === 'collection') {
    // الأصلي: Dr (نقد/بنك أو 2400 لو احتفظ بها شريك) / Cr 1200
    // ✅ نفس مبدأ فرع payment/expense فوق: نقرا الحساب الفعلي من القيد الأصلي
    // بدل إعادة حسابه بمنطق التوجيه الحالي وقت الإلغاء
    let drAcc = null, drName = null, drContact = null;
    try {
      // ✅ order:'id.desc' — نفس سبب فرع payment فوق (احتمال سطر قديم مُستبدَل)
      const orig = await apiGetAll('journal_entries', {
        select:'id,account_code,account_name,contact_name,dr_amount',
        system_type:`eq.${sys}`, ref_table:'eq.collections', ref_id:`eq.${record.id}`, post_status:'eq.posted',
        order:'id.desc',
      });
      const drLine = (orig||[]).find(l => (+l.dr_amount||0) > 0);
      if (drLine) { drAcc = drLine.account_code; drName = drLine.account_name; drContact = drLine.contact_name || null; origId = drLine.id || null; }
    } catch(e) { console.warn('void collection: فشل جلب القيد الأصلي:', e.message); }
    if (!drAcc) {
      throw new Error(`تعذّر إيجاد القيد المحاسبي الأصلي لهذا التحصيل (${record.ref_no||record.id}) — على الأغلب اتحذف من اليومية مباشرة قبل الإلغاء. لا يمكن إلغاؤه بأمان بدون معرفة الحساب الأصلي؛ راجعي اليومية يدوياً أولاً أو أعيدي إدخال القيد.`);
    }
    const cust    = record.customer || 'عميل';
    reversalDesc  = `عكس تحصيل ${record.ref_no||''} — ${cust} — فاتورة ${record.inv_no||''}`;
    reversalLines = [
      { acc: '1200', name: 'ذمم العملاء', dr: amount, cr: 0, contact: cust },
      { acc: drAcc, name: drName, dr: 0, cr: amount, contact: drContact },
    ];

  } else if (type === 'payout') {
    // ✅ المرحلة ٢ (partner_account_links، 2026-09-16): نقرا سطري القيد الأصلي
    // فعليًا (نفس نمط payment/expense/collection/ledger فوق) بدل بناء '2400'
    // بالحرف — يحل مشكلة الحساب المخصَّص تلقائيًا بلا أي اعتماد على
    // partner_account_links/TREASURY_ALIASES هنا.
    let partnerAcc = null, partnerName = null, partnerContact = record.partner;
    let cashAccFromJE = null, cashNameFromJE = null;
    try {
      const orig = await apiGetAll('journal_entries', {
        select:'id,account_code,account_name,contact_name',
        system_type:`eq.${sys}`, ref_table:'eq.partner_payouts', ref_id:`eq.${record.id}`,
        post_status:'eq.posted', order:'id.desc',
      });
      const partnerLine = (orig||[]).find(l => l.contact_name);
      const cashLine     = (orig||[]).find(l => !l.contact_name);
      if (partnerLine) { partnerAcc = partnerLine.account_code; partnerName = partnerLine.account_name; partnerContact = partnerLine.contact_name; origId = partnerLine.id || null; }
      if (cashLine)     { cashAccFromJE = cashLine.account_code; cashNameFromJE = cashLine.account_name; if (!origId) origId = cashLine.id || null; }
    } catch(e) { console.warn('void payout: فشل جلب القيد الأصلي:', e.message); }
    if (!partnerAcc) {
      throw new Error(`تعذّر إيجاد القيد المحاسبي الأصلي لهذا الصرف (${record.pay_id||record.ref_no||record.id}) — على الأغلب اتحذف من اليومية مباشرة قبل الإلغاء. لا يمكن إلغاؤه بأمان بدون معرفة الحساب الأصلي؛ راجعي اليومية يدوياً أولاً أو أعيدي إدخال القيد.`);
    }
    // ✅ B-2c3: الـfallback (القيد الأصلي من غير سطر نقدية) يقرا المصدر المحفوظ قبل pay_method
    const _fbSrc  = cashAccFromJE ? null : await sourceFromRecord(sys, 'partner_payouts', record);
    const cashAcc = cashAccFromJE || _fbSrc?.account || ((record.pay_method||'') === 'نقد' ? '1110' : '1120');
    const cashNm  = cashNameFromJE || _fbSrc?.accountName || ((record.pay_method||'') === 'نقد' ? 'النقد' : 'البنك');
    reversalDesc  = `عكس صرف شريك ${record.pay_id||record.ref_no||''} — ${record.partner||''} — ملف ${record.file_no}`;
    reversalLines = [
      { acc: cashAcc,    name: cashNm,      dr: amount, cr: 0,      contact: null           },
      { acc: partnerAcc, name: partnerName, dr: 0,      cr: amount, contact: partnerContact },
    ];

  } else if (type === 'ledger') {
    // ✅ Phase 2 / المرحلة ب — الموديل الموحَّد.
    // "تأكيد استلام" لا قيد له بالتصميم (LEDGER_TYPES.needsJE=false) — إلغاؤه
    // تغيير حالة فقط، بلا قيد عكسي. لا نرمي خطأً: الإلغاء عملية مشروعة، غير
    // أن ما يُعكَس غير موجود. نُرحّل الحالة ونخرج قبل بناء أي سطر.
    if (record.entry_type === 'تأكيد استلام') {
      await apiPatch('partner_ledger', { id:`eq.${record.id}` }, {
        post_status: 'voided',
        notes: `${record.notes ? record.notes + ' | ' : ''}مُلغى بتاريخ ${today_}`,
      });
      await logAudit('VOID', 'partner_ledger', record.file_no,
        record, { voided_at: today_, no_je: true },
        `إلغاء تأكيد استلام ${record.ref_no||''} — ${record.partner||''} (بلا قيد عكسي، لا قيد أصلي له)`);
      invalidateCache();
      return;
    }
    // ✅ المرحلة ٢ (partner_account_links، 2026-09-16): نقرا سطري القيد الأصلي
    // فعليًا (نفس نمط فروع payment/expense/collection فوق بالحرف) بدل بناء
    // '2400' بالحرف. يحل مشكلة الحساب المخصَّص (24xx) تلقائيًا بلا أي حاجة
    // لمعرفة partner_account_links أو TREASURY_ALIASES هنا — بنعكس أيًّا كان
    // الحساب المكتوب فعليًا وقت الترحيل، شريك كان بحساب مخصَّص أو خزينة على
    // 2400، فمينفعش نبني قيد عكسي على حساب غير اللي القيد الأصلي كان عليه
    // فعلاً (كان هيسيب الحساب الجديد مختل للأبد — راجع تحذير المراجع).
    let partnerAcc = null, partnerName = null, partnerContact = record.partner;
    let cashAccFromJE = null, cashNameFromJE = null;
    try {
      const orig = await apiGetAll('journal_entries', {
        select:'id,account_code,account_name,contact_name',
        system_type:`eq.${sys}`, ref_table:'eq.partner_ledger', ref_id:`eq.${record.id}`,
        post_status:'eq.posted', order:'id.desc',
      });
      // خط الشريك = اللي عنده contact_name؛ خط النقد/البنك = اللي بلاه —
      // نفس اتفاقية الكتابة في je_partnerLedger فوق بالحرف
      const partnerLine = (orig||[]).find(l => l.contact_name);
      const cashLine     = (orig||[]).find(l => !l.contact_name);
      if (partnerLine) { partnerAcc = partnerLine.account_code; partnerName = partnerLine.account_name; partnerContact = partnerLine.contact_name; origId = partnerLine.id || null; }
      if (cashLine)     { cashAccFromJE = cashLine.account_code; cashNameFromJE = cashLine.account_name; if (!origId) origId = cashLine.id || null; }
    } catch(e) { console.warn('void ledger: فشل جلب القيد الأصلي:', e.message); }
    if (!partnerAcc) {
      throw new Error(`تعذّر إيجاد القيد المحاسبي الأصلي لهذه المعاملة (${record.ref_no||record.id}) — على الأغلب اتحذف من اليومية مباشرة قبل الإلغاء. لا يمكن إلغاؤها بأمان بدون معرفة الحساب الأصلي؛ راجعي اليومية يدوياً أولاً أو أعيدي إدخال القيد.`);
    }
    // ✅ B-2c3: الـfallback (القيد الأصلي من غير سطر نقدية) يقرا المصدر المحفوظ قبل pay_method
    const _fbSrc  = cashAccFromJE ? null : await sourceFromRecord(sys, 'partner_ledger', record);
    const cashAcc = cashAccFromJE || _fbSrc?.account || ((record.pay_method||'') === 'نقد' ? '1110' : '1120');
    const cashNm  = cashNameFromJE || _fbSrc?.accountName || ((record.pay_method||'') === 'نقد' ? 'النقد' : 'البنك');
    const isDeposit = record.entry_type === 'إيداع عام';
    reversalDesc  = `عكس ${record.entry_type||'معاملة شريك'} ${record.ref_no||''} — ${record.partner||''}${record.file_no ? ' — ملف '+record.file_no : ''}`;
    reversalLines = isDeposit
      ? [ { acc: partnerAcc, name: partnerName,      dr: amount, cr: 0,      contact: partnerContact },
          { acc: cashAcc,    name: cashNm,           dr: 0,      cr: amount, contact: null           } ]
      : [ { acc: cashAcc,    name: cashNm,           dr: amount, cr: 0,      contact: null           },
          { acc: partnerAcc, name: partnerName,      dr: 0,      cr: amount, contact: partnerContact } ];

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
    reversesId: origId,
  });

  // ── 2. وضع post_status = 'voided' على السجل التشغيلي ──
  const tableMap = {
    payment:    'payments',
    expense:    'expenses',
    collection: 'collections',
    payout:     'partner_payouts',
    ledger:     'partner_ledger',
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
  // ✅ ref_table:'eq.reversal' (مش 'manual') — يطابق refTable الفعلي بالأسفل،
  // بعد تصحيح تناقض كان يخلي هذا القيد يفلت من _excludeReversalPairs (journal.js)
  const already = await apiGetAll('journal_entries', {
    select: 'id', system_type: `eq.${sys}`, ref_table: 'eq.reversal',
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

  // ✅ refTable:'reversal' (كان 'manual' سابقاً — تناقض مع كل دوال العكس الأخرى)
  // يخليه يُصنَّف ويُستبعد صح في journal.js (loadJournal/_excludeReversalPairs)
  await postDoubleEntry({
    sys, date: date_, fileNo,
    refTable: 'reversal', refId: null,
    desc: `عكس قيد ${entryNo}`,
    lines: reversalLines,
    reversesId: lines[0].id,
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
// VOID SALE INVOICE CORE — عكس فاتورة بيع (إيراد+COGS) وكل تحصيلاتها المرتبطة
//   منطق محاسبي نقي بلا واجهة — استُخدم أصلاً في dashboard.js voidSaleInvoice
//   (زر تفاعلي، لسه بيستدعي الدالة دي كغلاف) ونُقل هنا 2026-09-23 عشان
//   كاسكيد voidPurchaseOrder تحت يقدر يستدعيه بلا تبعية عكسية للواجهة (نفس
//   مبدأ نقل entryStatus من accounting.js فوق). يرمي Error للأخطاء الحقيقية
//   (فاتورة مش موجودة)، ويرجع {skipped:'سبب'} للحالات المشروعة اللي مفيهاش
//   حاجة تُعكس (فاتورة مُلغاة مسبقاً/بلا سيارات نشطة).
// ════════════════════════════════════════════════════════════
export async function _voidSaleInvoiceCore(invNo, fileNo) {
  const sys = state.system;
  const allItems = await apiGetAll('sales', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, inv_no:`eq.${invNo}` });
  if (!allItems?.length) throw new Error('لم يُعثر على بيانات الفاتورة');
  if (allItems.every(r => r.post_status === 'voided')) return { skipped: 'هذه الفاتورة مُلغاة مسبقاً' };
  // ✅ استثناء cancelled/voided من حساب مبلغ العكس — وإلا تُحسب سيارات
  // أُزيلت من الفاتورة في تعديل سابق ضمن مبلغ الإلغاء فيُفرَط في عكس الإيراد/الذمم
  const saleItems = allItems.filter(r => r.post_status !== 'cancelled' && r.post_status !== 'voided');
  if (!saleItems.length) return { skipped: 'لا توجد سيارات نشطة في هذه الفاتورة لعكسها' };
  const first = saleItems[0];
  const totalSale = saleItems.reduce((s,r)=>s+(+r.sale_price||0),0);
  let totalCOGS = 0, origId = null;
  try {
    const saleJELines = await apiGetAll('journal_entries', {
      select:'id,account_code,dr_amount,description,ref_id', system_type:`eq.${sys}`,
      ref_table:`eq.sales`, file_no:`eq.${fileNo}`, post_status:`eq.posted`,
    });
    const byRefId = (saleJELines||[]).filter(r => r.ref_id === invNo);
    const jeLines = byRefId.length
      ? byRefId
      : (saleJELines||[]).filter(r => !r.ref_id && (r.description||'').includes(invNo));
    totalCOGS = jeLines.filter(r => r.account_code === '5100').reduce((s,r)=>s+(+r.dr_amount||0), 0);
    origId    = jeLines[0]?.id || null;
  } catch(e) { console.warn('_voidSaleInvoiceCore: فشل جلب القيد الأصلي:', e.message); }
  const reversalLines = [];
  if (totalSale > 0) {
    reversalLines.push({acc:'4100', name:'إيرادات المبيعات', dr:totalSale, cr:0, contact:null});
    reversalLines.push({acc:'1200', name:'ذمم العملاء',       dr:0, cr:totalSale, contact:first.customer||null});
  }
  if (totalCOGS > 0) {
    reversalLines.push({acc:'1300', name:'المخزون — سيارات',     dr:totalCOGS, cr:0, contact:null});
    reversalLines.push({acc:'5100', name:'تكلفة المخزون المباع', dr:0, cr:totalCOGS, contact:null});
  }
  if (reversalLines.length) {
    await postDoubleEntry({ sys, date:today(), fileNo,
      refTable:'reversal', desc:`عكس بيع فاتورة ${invNo} — ${first.customer||''}`,
      lines: reversalLines,
      reversesId: origId,
    });
  }
  await apiPatch('sales', { system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, inv_no:`eq.${invNo}` }, { post_status:'voided' });
  // ✅ عكس قيود التحصيلات المرحّلة/المدفوعة المرتبطة بهذه الفاتورة قبل إلغائها —
  // وإلا يبقى قيدها حيًّا في journal_entries رغم إلغاء فاتورة البيع نفسها
  // (حادثة فعلية: BOX-138 بتاريخ 2026-07-23 — فاتورة "70700")
  let colReverseFailures = 0;
  try {
    const relatedCols = await apiGetAll('collections', { select:'*', system_type:`eq.${sys}`, inv_no:`eq.${invNo}` });
    for (const c of (relatedCols||[])) {
      if (c.post_status === 'voided') continue;
      const hadLikelyPostedJE = c.post_status === 'posted' || c.post_status === 'pending_edit' || c.post_status === 'pending_void';
      if (c.paid_date && hadLikelyPostedJE) {
        try { await voidTransaction('collection', c, true); }
        catch(e) { colReverseFailures++; console.warn('_voidSaleInvoiceCore: فشل عكس قيد تحصيل مرتبط', c.id, e.message); }
      } else {
        try { await apiPatch('collections', { id:`eq.${c.id}` }, { post_status:'voided' }); } catch(e) {}
      }
    }
  } catch(e) { console.warn('_voidSaleInvoiceCore: فشل جلب التحصيلات المرتبطة:', e.message); }
  await logAudit('VOID','sales', fileNo, {inv_no:invNo}, {voided_at:today()}, `إلغاء فاتورة بقيد عكسي`);
  invalidateCache();
  return { colReverseFailures };
}

// ════════════════════════════════════════════════════════════
// مستحق الفاتورة في جدول التحصيلات — قاعدة واحدة لكل الشاشات
//   سطور التحصيل الشاغلة (isOccupying) لأي فاتورة مجموعها = قيمة الفاتورة
//   دايمًا: مدفوع (paid_date) + مستحق (بلا paid_date). ملخص الملف وتبويب
//   التحصيلات وفورم التحصيل بياخدوا إجمالي الفاتورة من مجموع السطور دي.
//   فأي عملية بتغيّر مجموع السطور (تحصيل جديد، تعديل مبلغ تحصيل مدفوع، رفض/
//   إلغاء/حذف تحصيل مدفوع) لازم تعدّل المستحق بنفس الفرق بالعكس — وإلا
//   الفاتورة تتحسب مرتين. اكتُشف حيًّا 2026-09-27 على BOX-144: تحصيل جزئي
//   119,877 من «تسجيل سريع» اتسجّل سطر جديد وسطر المستحق فضل 261,000 ←
//   مبيعات الملف 523,877 بدل 404,000 (القيود نفسها كانت سليمة). العيب كان
//   موجود من أول نسخة (يونيو)؛ إصلاح 2026-07-28 غطّى «نفس المبلغ بالظبط»
//   في فورم الملف بس. لا تُستدعى من كاسكيد إلغاء/حذف الفاتورة نفسها.
// ════════════════════════════════════════════════════════════
const _r3 = n => Math.round((+n || 0) * 1000) / 1000;

/**
 * حالة تحصيل كل فاتورة — مصدر واحد لفورم «💰 تحصيل» جوه الملف وفورم
 * «تسجيل سريع ← 💰 تحصيل» (كانوا بيحسبوا «الباقي» بطريقتين: الأول من سطور
 * التحصيل، والتاني من سعر البيع بلا فلتر حالة — فطلعوا 261,000 و141,123
 * لنفس الفاتورة). الإجمالي = مجموع سطور التحصيل المرحّلة (يشمل المصاريف
 * الإضافية)، ولو مفيش سطور يرجع لسعر البيع. ترجع الفواتير اللي باقيها > 0.
 */
export function computeInvoiceDueStatus(sales, collections) {
  const invoicedMap = {}, collectedMap = {}, pendingMap = {};
  (collections||[]).filter(c => c.inv_no && isPosted(c)).forEach(c => {
    const key = `${c.file_no}__${c.inv_no}`;
    invoicedMap[key] = (invoicedMap[key]||0) + (+c.amount||0);
    if (c.paid_date) collectedMap[key] = (collectedMap[key]||0) + (+c.amount||0);
    else (pendingMap[key] = pendingMap[key]||[]).push(c);
  });
  // ✅ استبعاد cancelled/voided (isOccupying) — فاتورة ملغاة مالهاش باقي
  const invMap = {};
  (sales||[]).filter(s => s.inv_no && isOccupying(s)).forEach(s => {
    const k = `${s.file_no}__${s.inv_no}`;
    if (!invMap[k]) invMap[k] = { inv_no:s.inv_no, customer:s.customer, file_no:s.file_no, sale_date:s.sale_date, total:0, vins:[] };
    invMap[k].total += +s.sale_price || 0;
    if (s.vin) invMap[k].vins.push(s.vin);
  });
  return Object.values(invMap).map(inv => {
    const key         = `${inv.file_no}__${inv.inv_no}`;
    const realTotal   = invoicedMap[key] > 0 ? invoicedMap[key] : inv.total;
    const collected   = collectedMap[key] || 0;
    const pendingRows = pendingMap[key] || [];
    // سطر مستحق واحد بس ← الحفظ بنفس مبلغه يكمّله بدل ما ينشئ سطر جديد
    const single      = pendingRows.length === 1 ? pendingRows[0] : null;
    return {
      ...inv,
      sale_price:    realTotal,
      vin:           inv.vins.join(' / '),
      collected,
      remaining:     _r3(realTotal - collected),
      hasPending:    pendingRows.length > 0,
      pendingId:     single ? single.id : null,
      pendingAmount: single ? (+single.amount||0) : null,
    };
  }).filter(inv => inv.remaining > 0.001)
    .sort((a,b) => (a.sale_date||'') > (b.sale_date||'') ? -1 : 1);
}

/**
 * إجماليات مبيعات/تحصيل ملف من سطور التحصيل — مصدر واحد لتبويب ملخص الملف
 * (loadSummaryTab, dashboard.js) والملخص الإداري المطبوع (printDealSummary,
 * print.js)؛ كانوا نسختين من نفس الحلقة. لكل فاتورة: لو ليها سطور تحصيل
 * مرحّلة ← إجماليها = مجموع السطور (يشمل المصاريف الإضافية)؛ لو مالهاش ←
 * سعر البيع كله «غير محصّل».
 * ✅ تحصيل مدفوع لسه draft بيتخصم من المستحق وقت تسجيله (adjustInvoiceDue)،
 * فبيتضاف هنا لإجمالي الفاتورة بس (مش للمقبوض ولا للمستحق) — وإلا المبيعات
 * تنزل بمبلغه لحد ما يتعتمد.
 */
export function computeFileSalesTotals(sales, collections) {
  const salesByInv = {};
  (sales||[]).filter(isEffective).forEach(s => {
    const k = s.inv_no || `__no_inv_${s.id}`;
    salesByInv[k] = (salesByInv[k]||0) + (+s.sale_price||0);
  });
  const colByInv = {}, draftPaidByInv = {};
  (collections||[]).forEach(c => {
    const k = c.inv_no || `__no_inv_${c.id}`;
    if (isEffective(c)) (colByInv[k] = colByInv[k]||[]).push(c);
    else if (isDraft(c) && c.paid_date) draftPaidByInv[k] = (draftPaidByInv[k]||0) + (+c.amount||0);
  });
  let invoiced = 0, collected = 0, pending = 0, draftPaid = 0;
  new Set([...Object.keys(salesByInv), ...Object.keys(colByInv)]).forEach(k => {
    const cols = colByInv[k];
    if (cols && cols.length) {
      cols.forEach(c => {
        invoiced += +c.amount||0;
        if (c.paid_date) collected += +c.amount||0;
        else pending += +c.amount||0;
      });
      if (salesByInv[k] != null && draftPaidByInv[k]) {
        invoiced  += draftPaidByInv[k];
        draftPaid += draftPaidByInv[k];
      }
    } else {
      const amt = salesByInv[k]||0;
      invoiced += amt;
      pending  += amt;
    }
  });
  return { invoiced:_r3(invoiced), collected:_r3(collected), pending:_r3(pending), draftPaid:_r3(draftPaid) };
}

/**
 * يعدّل مستحق فاتورة بفرق موقَّع (سطور بلا paid_date، مالهاش قيد):
 *   delta < 0 ← خصم (تحصيل جديد / زيادة مبلغ تحصيل مدفوع): الأقدم أولًا،
 *               والسطر اللي يتخصم بالكامل يتعلّم cancelled (مالوش قيد أصلًا)
 *   delta > 0 ← إرجاع (رفض/إلغاء/حذف تحصيل مدفوع، أو تقليل مبلغه): يتضاف
 *               لأقدم سطر مستحق، ولو مفيش يتعمل سطر مستحق جديد
 * excludeId: سطر التحصيل اللي بيتغيّر نفسه (مايتحسبش ضمن المستحق).
 * بيتخطى بهدوء لو الفاتورة مالهاش مبيعات قائمة (اتلغت/اترفضت/اتحذفت).
 * يرجع { changed, unmatched } — unmatched = جزء من الخصم مالقاش مستحق.
 */
export async function adjustInvoiceDue({ sys, fileNo, invNo, delta, excludeId = null, reason = '' }) {
  delta = _r3(delta);
  if (!sys || !fileNo || !invNo || Math.abs(delta) < 0.001) return { changed: 0, unmatched: 0 };
  const [saleRows, colRows] = await Promise.all([
    apiGetAll('sales',       { select:'id,customer,vin,sale_date,post_status', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, inv_no:`eq.${invNo}` }),
    apiGetAll('collections', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, inv_no:`eq.${invNo}` }),
  ]);
  const liveSales = (saleRows||[]).filter(isOccupying);
  if (!liveSales.length) return { changed: 0, unmatched: 0, skipped: 'الفاتورة مالهاش مبيعات قائمة' };

  const dueLines = (colRows||[])
    .filter(c => isOccupying(c) && !c.paid_date && String(c.id) !== String(excludeId))
    .sort((a,b) => (a.due_date||'').localeCompare(b.due_date||'') || String(a.created_at||'').localeCompare(String(b.created_at||'')));
  const why = reason ? ` — ${reason}` : '';

  if (delta < 0) {
    let left = -delta, changed = 0;
    for (const d of dueLines) {
      if (left < 0.001) break;
      const amt = +d.amount || 0;
      if (amt <= left + 0.0005) {
        await apiPatch('collections', { id:`eq.${d.id}` }, { post_status:'cancelled', notes:`${d.notes||''} | استُهلك بالكامل بالتحصيل${why}`.trim() });
        await logAudit('DUE_ADJUST', 'collections', fileNo, d, { post_status:'cancelled' }, `مستحق فاتورة ${invNo}: ${d.ref_no||d.id} استُهلك بالكامل (${fmt(amt)})${why}`);
        left = _r3(left - amt);
      } else {
        const newAmt = _r3(amt - left);
        await apiPatch('collections', { id:`eq.${d.id}` }, { amount:newAmt });
        await logAudit('DUE_ADJUST', 'collections', fileNo, d, { amount:newAmt }, `مستحق فاتورة ${invNo}: ${d.ref_no||d.id} ${fmt(amt)} ← ${fmt(newAmt)}${why}`);
        left = 0;
      }
      changed++;
    }
    return { changed, unmatched: _r3(left) };
  }

  if (dueLines.length) {
    const d = dueLines[0];
    const newAmt = _r3((+d.amount||0) + delta);
    await apiPatch('collections', { id:`eq.${d.id}` }, { amount:newAmt });
    await logAudit('DUE_ADJUST', 'collections', fileNo, d, { amount:newAmt }, `مستحق فاتورة ${invNo}: ${d.ref_no||d.id} ${fmt(+d.amount||0)} ← ${fmt(newAmt)}${why}`);
    return { changed: 1, unmatched: 0 };
  }
  const first = liveSales[0];
  const refNo = (await genSeqRef('COL', sys, fileNo, 'collections')) || `COL-${fileNo}-${Date.now()}`;
  const row = {
    system_type: sys, file_no: fileNo, inv_no: invNo, customer: first.customer || null,
    vin: liveSales.map(s => s.vin).filter(Boolean).join(' / ') || null, amount: delta,
    pay_method: null, document: null, due_date: first.sale_date || null, paid_date: null,
    notes: `مستحق مُعاد${why}`, ref_no: refNo, pay_id: refNo,
    // مستحق فاتورة لسه draft يفضل draft معاها
    post_status: liveSales.some(isActive) ? 'posted' : 'draft',
  };
  await apiPost('collections', row);
  await logAudit('DUE_ADJUST', 'collections', fileNo, null, row, `مستحق فاتورة ${invNo}: سطر مستحق جديد ${fmt(delta)}${why}`);
  return { changed: 1, unmatched: 0 };
}

/**
 * مزامنة سطور تحصيل فاتورة بعد تعديلها (openEditSaleApproval, operations.js) —
 * مسار تعديل الفاتورة الوحيد في البرنامج كان بيعدّل السيارات وقيد البيع ومش
 * بيلمس التحصيلات خالص (فحص 2026-09-29): الإجمالي يتغيّر والمستحق يفضل،
 * والاسم يتغيّر وقيود التحصيل تفضل على القديم (LOT 3 NEW وBOX-126 — رصيد
 * العميل اتقسم على اسمين).
 *   totalDelta  ← المستحق يتظبط بنفس الفرق (adjustInvoiceDue)
 *   newCustomer ← اسم العميل على سطور التحصيل + سطر 1200 في قيود التحصيلات
 *                 المدفوعة (updateJEInPlace بـcontactAccount '1200' — سطر النقد/
 *                 الشريك مايتلمسش)
 *   vins/newDate ← نص الشاصيهات على السطور، وتاريخ استحقاق المستحق لو كان =
 *                 تاريخ البيع القديم (الاستحقاق الرسمي = تاريخ البيع)
 * يرجع { unmatched, jeMoved, jeFailed } — unmatched > 0 = العميل دافع أكتر من
 * قيمة الفاتورة الجديدة بالمبلغ ده (البرنامج مايتصرّفش فيه لوحده).
 */
export async function syncInvoiceCollectionsAfterSaleEdit({ sys, fileNo, invNo, totalDelta = 0, oldCustomer = null, newCustomer = null, vins = null, oldDate = null, newDate = null }) {
  const res = { unmatched: 0, jeMoved: 0, jeFailed: 0 };
  if (!sys || !fileNo || !invNo) return res;

  if (Math.abs(+totalDelta||0) > 0.0005) {
    const adj = await adjustInvoiceDue({ sys, fileNo, invNo, delta: +totalDelta, reason: `تعديل فاتورة ${invNo}` });
    res.unmatched = adj.unmatched || 0;
  }

  const cols = (await apiGetAll('collections', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, inv_no:`eq.${invNo}` })) || [];
  const live = cols.filter(isOccupying);
  const renamed    = !!newCustomer && newCustomer !== oldCustomer;
  const vinText    = vins?.length ? vins.join(' / ') : null;
  const dateMoved  = !!newDate && !!oldDate && newDate !== oldDate;
  // نفس السيارات بترتيب مختلف مش تغيير — نقارن كمجموعة
  const vinKey     = t => String(t||'').split('/').map(x => x.trim()).filter(Boolean).sort().join('|');
  const vinSetNew  = vinText ? vinKey(vinText) : null;

  for (const c of live) {
    const patch = {};
    if (renamed && c.customer !== newCustomer) patch.customer = newCustomer;
    if (vinText && vinKey(c.vin) !== vinSetNew) patch.vin = vinText;
    if (dateMoved && !c.paid_date && c.due_date === oldDate) patch.due_date = newDate;
    if (Object.keys(patch).length) await apiPatch('collections', { id:`eq.${c.id}` }, patch);

    // قيد التحصيل المدفوع يتنقل للاسم الجديد (draft مالوش قيد لسه — قيده هيتعمل بالاسم الجديد)
    if (renamed && c.paid_date && isActive(c)) {
      try {
        await updateJEInPlace({ sys, fileNo, refTable:'collections', refId:c.id,
          oldAmount:+c.amount||0, newAmount:+c.amount||0, contactPatch:newCustomer, contactAccount:'1200' });
        res.jeMoved++;
      } catch(e) {
        res.jeFailed++;
        console.warn('syncInvoiceCollectionsAfterSaleEdit: فشل نقل قيد التحصيل للاسم الجديد', c.ref_no||c.id, e.message);
      }
    }
  }
  if (renamed || dateMoved || live.some(c => vinText && vinKey(c.vin) !== vinSetNew)) {
    await logAudit('EDIT', 'collections', fileNo, { inv_no:invNo, customer:oldCustomer, date:oldDate },
      { customer:newCustomer, vins:vinText, date:newDate, je_moved:res.jeMoved },
      `مزامنة تحصيلات فاتورة ${invNo} بعد تعديلها`);
  }
  return res;
}

// ════════════════════════════════════════════════════════════
// VOID PURCHASE ORDER — إلغاء ملف بالكامل (إعادة تصميم 2026-09-23)
//   قرار المالك النهائي (بعد تصحيح مسار حذف/عكس محاسبي كان مقترحًا أول
//   الأمر): "ممكن متحذفش الداتا بس تكون كأنها مش موجودة" — لا حذف نهائي
//   ولا أي قيد عكسي جديد لأي شيء. الفويد = إعادة تصنيف post_status='voided'
//   على كل صف مرتبط بالملف (مصاريف/دفعات/تحصيلات/مبيعات/صرف شركاء/جاري
//   شريك/قيود اليومية) دفعة واحدة — البيانات نفسها تبقى محفوظة بالكامل في
//   القاعدة (قابلة للمراجعة لاحقًا)، لكنها تخرج تلقائيًا من كل حساب/تقرير/KPI
//   يستخدم أصلاً isEffective/isPosted/isVisible (المصدر الموحّد، core.js) —
//   بلا حاجة لتعديل كل شاشة استهلاك على حدة، بنفس مبدأ voidTransaction تمامًا
//   لكن على مستوى الملف كله دفعة واحدة بدل معاملة بمعاملة.
//   vehicles استثناء وحيد (لا عمود post_status عندها) — استُبعدت في نقاط
//   الاستهلاك القليلة المحتاجاها مباشرة (تقرير المخزون/كارت المخزون).
//   سبب الإلغاء إلزامي — يُحفظ في void_reason ويظهر على بادج/تفاصيل الملف.
// ════════════════════════════════════════════════════════════
async function _bulkVoidTable(sys, table, fileNo) {
  const rows = await apiGetAll(table, { select:'id,post_status', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` });
  const activeIds = (rows||[]).filter(r => r.post_status !== 'voided').map(r => r.id).filter(id => id != null);
  // ✅ دفعات بحجم 200 — تحصين ضد طول URL مفرط لو ملف نشط جدًا بمئات السطور
  for (let i = 0; i < activeIds.length; i += 200) {
    const chunk = activeIds.slice(i, i+200);
    await apiPatch(table, { id:`in.(${chunk.join(',')})` }, { post_status: 'voided' });
  }
  return activeIds.length;
}

export async function voidPurchaseOrder(fileNo, reason) {
  const sys = state.system;
  const reasonTrimmed = (reason||'').trim();
  if (!reasonTrimmed) throw new Error('سبب الإلغاء إلزامي — لازم تكتب سبب واضح قبل إلغاء الملف');

  const poRows = await apiGetAll('purchase_orders', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` });
  const po = poRows?.[0];
  if (!po) throw new Error('لم يُعثر على سند الشراء لهذا الملف');
  if (po.post_status === 'voided') throw new Error('هذا الملف مُلغى بالفعل');

  const today_ = today();

  // ── إعادة تصنيف كل الجداول المرتبطة بالملف — بلا حذف وبلا قيود عكسية جديدة ──
  const counts = {};
  for (const t of ['expenses', 'payments', 'collections', 'sales', 'partner_payouts', 'partner_ledger']) {
    try { counts[t] = await _bulkVoidTable(sys, t, fileNo); }
    catch(e) { console.warn(`voidPurchaseOrder: فشل إعادة تصنيف ${t}:`, e.message); counts[t] = 0; }
  }
  // ✅ journal_entries مالهاش file_no في كل صف بالضرورة زي باقي الجداول (بعضها
  // ref_table مختلف) — لكن اللي عليه file_no=الملف ده تحديدًا (كل قيود الملف)
  // لازم يتخفى برضه، بلا شرط post_status='posted' بس — pending_edit كمان له
  // أثر ظاهر لازم يستتر
  let jeCount = 0;
  try {
    const jeRows = await apiGetAll('journal_entries', {
      select:'id,post_status', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`,
    });
    const jeIds = (jeRows||[]).filter(r => r.post_status !== 'voided' && r.post_status !== 'draft').map(r => r.id);
    jeCount = jeIds.length;
    for (let i = 0; i < jeIds.length; i += 200) {
      const chunk = jeIds.slice(i, i+200);
      await apiPatch('journal_entries', { id:`in.(${chunk.join(',')})` }, { post_status: 'voided' });
    }
  } catch(e) { console.warn('voidPurchaseOrder: فشل إعادة تصنيف journal_entries:', e.message); }

  // ── تحديث حالة السند نفسه ──
  await apiPatch('purchase_orders', { id:`eq.${po.id}` }, {
    post_status: 'voided',
    status: 'VOIDED',
    void_reason: reasonTrimmed,
    notes: `${po.notes ? po.notes + ' | ' : ''}مُلغى بالكامل بتاريخ ${today_} — السبب: ${reasonTrimmed}`,
  });

  // ── تسجيل في audit_log ──
  const summary = `إلغاء كامل لملف ${fileNo} — السبب: ${reasonTrimmed} — مصاريف:${counts.expenses||0} دفعات:${counts.payments||0} تحصيلات:${counts.collections||0} مبيعات:${counts.sales||0} صرف شركاء:${counts.partner_payouts||0} جاري شريك:${counts.partner_ledger||0} قيود يومية:${jeCount}`;
  await logAudit('VOID', 'purchase_orders', fileNo, po, { ...counts, journal_entries: jeCount, reason: reasonTrimmed }, summary);

  invalidateCache();
  return { ...counts, journal_entries: jeCount };
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

// reversesId (اختياري): id لأي سطر من سطور القيد الأصلي لو هذا القيد عكسي —
// النوع الفعلي لعمودي reverses/reversed_by هو integer (تحقّقنا منه مباشرة على
// بيانات تجريبية قبل الاعتماد عليه — راجع project_dual_je_audit Case 1)، فيُمرَّر
// id حقيقي من المستدعي مباشرة، لا entry_no نصي — العمود بلا UNIQUE constraint
// وله تاريخ تضارب فعلي قبل next_je_no الذري (انظر next_je_no.sql)، فالاعتماد
// عليه كمفتاح تفرّد عالمي كان سيخاطر بربط سطور قيد غير ذي علاقة لو تطابق نصياً.
// نتحقق أدناه إن كل سطور القيد الأصلي (المُجمَّعة بـentry_no) تشترك فعلاً في
// نفس ref_table/ref_id قبل نشر reversed_by عليها — لو لأ، نتخطى الربط بأمان
// بدل التخمين.
// isPrimary (اختياري، افتراضي true): يضبط is_primary_line=true على أول سطر
// بس من هذا القيد — يشارك في uq_je_ref_primary_posted (Tier 0 بند 4)، القيد
// الفريد الوحيد المسموح بيه لكل (system_type, file_no, ref_id, ref_table)
// posted. مرّر false وقت ترحيل قيد "جديد صحيح" بديل لقيد قديم لسه posted
// (updateJEInPlace/فروع تغيير التوجيه) — القديم يفضل حاملاً للـslot لحد ما
// ينجح كل شيء (الجديد + عكس القديم)، وبعدها المستدعي ينده _handoffPrimaryLine
// صراحة ليسلّم الـslot — بدل تسليم مبكر ممكن يسيب فترة بلا حماية لو أي خطوة فشلت.
export async function postDoubleEntry({sys, date, fileNo, refTable, refId, desc, lines, reversesId=null, isPrimary=true}) {
  if (!lines || !lines.length) { console.warn('postDoubleEntry: no lines'); return; }
  const dr = lines.reduce((s,l)=>s+(+l.dr||0),0);
  const cr = lines.reduce((s,l)=>s+(+l.cr||0),0);
  if (Math.abs(dr-cr)>0.01) {
    const msg = `قيد غير متوازن: مدين=${dr.toFixed(2)} دائن=${cr.toFixed(2)} — ${desc}`;
    console.error(msg);
    throw new Error(msg);
  }

  // ✅ تحقّق من هوية القيد الأصلي بالكامل (أفضل مجهود — فشل التحقق لا يوقف ترحيل القيد نفسه)
  let origSiblingIds = null;
  if (reversesId) {
    try {
      const anchor = await apiGetAll('journal_entries', {
        select:'entry_no,ref_table,ref_id', system_type:`eq.${sys}`, id:`eq.${reversesId}`, limit:1,
      });
      if (anchor?.[0]) {
        const { entry_no, ref_table, ref_id } = anchor[0];
        const siblings = await apiGetAll('journal_entries', {
          select:'id,ref_table,ref_id', system_type:`eq.${sys}`, entry_no:`eq.${entry_no}`,
        });
        const allMatch = siblings?.length && siblings.every(s => s.ref_table === ref_table && s.ref_id === ref_id);
        if (allMatch) { origSiblingIds = siblings.map(s => s.id); }
        else console.warn(`postDoubleEntry: entry_no ${entry_no} غير موثوق للربط (تضارب ref_table/ref_id بين سطوره) — تخطي reversed_by`);
      }
    } catch(e) { console.warn('postDoubleEntry: فشل التحقق من القيد الأصلي للربط', reversesId, e.message); }
  }

  // ✅ إصلاح ازدواج is_primary_line على قيود العكس (ref_table='reversal') —
  // اكتُشف حيًّا 2026-07-30 على TM-004: تعديل ثانٍ (أو إلغاء بعد تعديل) على نفس
  // السجل بيحاول يسجّل عكس جديد بـis_primary_line=true بينما عكس أول تعديل
  // سابق لسه حامل نفس العلم — يصطدم بالقيد الفريد uq_je_ref_primary_posted.
  // _handoffPrimaryLine (تُستدعى من updateJEInPlace) بتغطي بس سطور الكيان
  // الأصلي (ref_table الحقيقي)، مش سطور العكس نفسها — فجوة منفصلة تمامًا.
  // ✅ مركزية هنا (مش تكرارها في كل مكان بينادي postDoubleEntry بـrefTable=
  // 'reversal' — updateJEInPlace/voidTransaction/voidPurchaseOrder/
  // reverseManualJE/voidSaleInvoice/deleteSaleInvoice/deleteOpex، 7 مواقع) —
  // نفس مبدأ Track A: نقطة إنفاذ واحدة تحمي كل المستدعين الحاليين والمستقبليين.
  // ✅ refId == null (voidSaleInvoice/deleteSaleInvoice/reverseManualJE أحيانًا)
  // — بلا فحص عمدًا: Postgres بيعامل NULL كغير متساوٍ مع NULL في القيد الفريد
  // (NULLS DISTINCT، الافتراضي)، فمفيش تصادم فعلي بين صفوف NULL مع بعض أصلًا.
  if (refTable === 'reversal' && isPrimary && refId != null) {
    try {
      const filter = {
        select: 'id', system_type: `eq.${sys}`, ref_table: 'eq.reversal',
        ref_id: `eq.${refId}`, is_primary_line: 'eq.true', post_status: 'eq.posted',
      };
      if (fileNo) filter.file_no = `eq.${fileNo}`;
      const priorPrimary = await apiGetAll('journal_entries', filter);
      if (priorPrimary?.length) {
        const demoteRes = await fetch(`${SB_URL}/rest/v1/journal_entries?id=in.(${priorPrimary.map(r => r.id).join(',')})`, {
          method: 'PATCH', headers: { ...headers(), 'Prefer': 'return=minimal' },
          body: JSON.stringify({ is_primary_line: false }),
        });
        if (!demoteRes.ok) console.warn('postDoubleEntry: فشل تنزيل is_primary_line عن عكس سابق نشط', await demoteRes.text().catch(() => ''));
      }
    } catch(e) { console.warn('postDoubleEntry: فشل فحص عكس سابق نشط لتنزيله', e.message); }
  }

  const no      = await _jeNo(sys);
  const now     = new Date().toISOString();
  const inserts = lines.map((l, idx) => ({
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
    reverses:     reversesId,
    // ✅ سطر واحد بس (الأول) يحمل is_primary_line=true — كل سطور نفس القيد
    // تشترك في نفس (file_no, ref_id, ref_table)، فلو أكتر من سطر حمل true
    // كانوا هيتصادموا مع بعض على uq_je_ref_primary_posted من نفس الإدراج
    is_primary_line: isPrimary && idx === 0,
  }));

  // ── Batch insert: كل الأسطر في request واحد — إما كلها أو لا شيء ──
  // ✅ return=representation (بدل minimal) — نحتاج id الأسطر الجديدة فورًا لكتابة
  // reversed_by على الأصلي، بدل استعلام SELECT إضافي منفصل بعد الإدراج
  const res = await fetch(`${SB_URL}/rest/v1/journal_entries`, {
    method:  'POST',
    headers: { ...headers(), 'Prefer': 'return=representation' },
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

  const inserted = await res.json().catch(()=>[]);
  const insertedIds = inserted.map(r => r.id).filter(Boolean);

  // ✅ ربط الأصل بالعكس (reversed_by) — على مجموعة id المتحقَّق منها فقط
  // (origSiblingIds)، لا بمطابقة entry_no مباشرة — أفضل مجهود، لا يوقف نجاح العملية لو فشل
  if (origSiblingIds?.length) {
    try {
      const newId = inserted?.[0]?.id || null;
      if (newId) {
        const patchRes = await fetch(`${SB_URL}/rest/v1/journal_entries?id=in.(${origSiblingIds.join(',')})`, {
          method:  'PATCH',
          headers: { ...headers(), 'Prefer': 'return=minimal' },
          body:    JSON.stringify({ reversed_by: newId }),
        });
        if (!patchRes.ok) console.warn('postDoubleEntry: فشل تحديث reversed_by (رفض القاعدة)', await patchRes.text().catch(()=>''));
      }
    } catch(e) { console.warn('postDoubleEntry: فشل تحديث reversed_by على القيد الأصلي', reversesId, e.message); }
  }

  // ✅ يسمح للمستدعي (مثلاً updateJEInPlace) بمعرفة entry_no/ids الجديدة —
  // لازمة لتسليم is_primary_line المؤجَّل عبر _handoffPrimaryLine بعدين
  return { entryNo: no, ids: insertedIds };
}

// تسليم is_primary_line من قيد قديم لقيد جديد بعد نجاح كل خطوات الاستبدال —
// الترتيب إلزامي (قديم=false أولاً، بعدها جديد=true): لو عكسنا الترتيب، لحظة
// وجود الاتنين true معاً كانت هتصطدم بـuq_je_ref_primary_posted. أفضل مجهود
// (لا تستوقف العملية لو فشلت) — أسوأ نتيجة ممكنة هي عدم وجود "حامل" مؤقت لهذا
// الـref_id، مش تعارض ولا فساد بيانات (updateJEInPlace وباقي المسارات لا تعتمد
// على is_primary_line لإيجاد القيد النشط أصلاً، تعتمد على post_status/ref_id).
// ✅ newIds[0] فقط بيُكتب true — مش كل newIds: كل سطور نفس القيد تشترك في نفس
// (file_no, ref_id, ref_table)، فلو أكتر من سطر واحد اتعلّم true كانوا هيتصادموا
// مع بعض على uq_je_ref_primary_posted (اكتُشف حيًّا: PATCH لعدة id بنفس القيمة
// true رفضته القاعدة بصمت — fetch() ما بيرفضش على status غير ok، فكان لازم نفحص
// res.ok صراحة ونحذّر لو فشل، بدل الاعتماد على "مفيش استثناء = نجح").
export async function _handoffPrimaryLine({ sys, oldIds, newIds }) {
  try {
    if (oldIds?.length) {
      const res = await fetch(`${SB_URL}/rest/v1/journal_entries?id=in.(${oldIds.join(',')})`, {
        method: 'PATCH', headers: { ...headers(), 'Prefer': 'return=minimal' },
        body: JSON.stringify({ is_primary_line: false }),
      });
      if (!res.ok) console.warn('_handoffPrimaryLine: فشل تصفير is_primary_line على القديم', await res.text().catch(()=>''));
    }
    if (newIds?.[0]) {
      const res = await fetch(`${SB_URL}/rest/v1/journal_entries?id=eq.${newIds[0]}`, {
        method: 'PATCH', headers: { ...headers(), 'Prefer': 'return=minimal' },
        body: JSON.stringify({ is_primary_line: true }),
      });
      if (!res.ok) console.warn('_handoffPrimaryLine: فشل ضبط is_primary_line على الجديد', await res.text().catch(()=>''));
    }
  } catch(e) { console.warn('_handoffPrimaryLine: فشل تسليم is_primary_line', e.message); }
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

// ── فحص تطابق تكلفة المخزون (Reconciliation Check) ──
// يتأكد إن: (شراء + مصاريف مرحّلة) = (تكلفة مباعة فعليًا) + (نصيب السيارات
// الباقية العادل) لملف معيّن. حساب "النصيب العادل" هنا مرآة لمنطق calcCOGS
// بالضبط (نفس فصل قطع PART- عن متوسط الشاحنات) — عشان الفحص يقيس calcCOGS
// نفسه، مش تخمين منفصل قد يختلف معاه بالصدفة.
// ✅ دالة نقية (sync، بلا طلبات شبكة) — تاخد بيانات جاهزة من المستدعي:
//   - loadSummaryTab (dashboard.js) عندها البيانات دي أصلاً مجلوبة لكل ملف
//   - auditAllFilesCOGS (تحت) بتجيبها لكل الملفات دفعة واحدة للمسح الشامل
// actualRemaining = "المخزون المتبقي بالتكلفة" الفعلي — نفس unsoldCostBasis
// المحسوبة في dashboard.js (fullCost - fin.cogs - fin.dealExp) عشان نفس
// مصدر computeFinancials يبقى مرجع واحد لكل الشاشات.
export function checkCOGSInvariant({ vehicles, soldVins, totalPurchase, totalExp, actualRemaining }) {
  const _isPart    = vin => (vin||'').startsWith('PART-');
  const allVeh     = vehicles || [];
  const sold       = soldVins || new Set();
  const fullCost   = (+totalPurchase||0) + (+totalExp||0);
  const partsCost  = allVeh.filter(v => _isPart(v.vin)).reduce((s,v)=>s+(+v.purchase_price||0),0);
  const truckCount = allVeh.filter(v => !_isPart(v.vin)).length;
  const truckCost  = Math.max(fullCost - partsCost, 0);

  const unsoldPartsCost = allVeh
    .filter(v => _isPart(v.vin) && !sold.has(v.vin))
    .reduce((s,v)=>s+(+v.purchase_price||0),0);
  const unsoldTrucks = allVeh.filter(v => !_isPart(v.vin) && !sold.has(v.vin)).length;
  const expectedTruckRemaining = truckCount > 0 ? truckCost * (unsoldTrucks / truckCount) : 0;
  const expectedRemaining = Math.round((unsoldPartsCost + expectedTruckRemaining) * 100) / 100;

  const actual = Math.round((+actualRemaining || 0) * 100) / 100;
  const drift  = Math.round((actual - expectedRemaining) * 100) / 100;
  // ✅ هامش تسامح: أكبر من (وحدة عملة واحدة) أو (0.5% من التكلفة الكلية) —
  // يمنع إنذارات كاذبة من انجراف تقريب بسيط عبر عمليات كتير
  const epsilon = Math.max(1, fullCost * 0.005);

  return {
    expectedRemaining, actualRemaining: actual, drift,
    hasDrift: Math.abs(drift) > epsilon,
    direction: drift > 0 ? 'مخزون زيادة عن المتوقع (COGS ناقص)' : 'مخزون ناقص عن المتوقع (COGS زيادة)',
    fullCost,
  };
}

// ── مسح شامل لكل ملفات نظام معيّن — يكتشف كل الملفات اللي فيها انحراف ──
// قراءة فقط، بلا أي كتابة. يُستخدم من الكونسول: await auditAllFilesCOGS('BOX')
export async function auditAllFilesCOGS(sys) {
  const poRows = await apiGetAll('purchase_orders', { select:'file_no,total_purchase', system_type:`eq.${sys}` });
  const files  = (poRows||[]).map(p => p.file_no).filter(Boolean);
  const results = [];
  for (const fileNo of files) {
    try {
      const [vehRows, expRows, salesRows, jeRows] = await Promise.all([
        apiGetAll('vehicles',        { select:'vin,purchase_price', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
        apiGetAll('expenses',        { select:'amount',             system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, post_status:'eq.posted' }),
        apiGetAll('sales',           { select:'vin,post_status',    system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
        apiGetAll('journal_entries', { select:'account_code,dr_amount,cr_amount,ref_table,file_no', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, post_status:'eq.posted' }),
      ]);
      const totalPurchase = +((poRows||[]).find(p=>p.file_no===fileNo)?.total_purchase || 0);
      const totalExp      = (expRows||[]).reduce((s,e)=>s+(+e.amount||0),0);
      const soldVins      = new Set((salesRows||[]).filter(isActive).map(s=>s.vin).filter(Boolean));
      const fin           = computeFinancials(jeRows||[]).byFile[fileNo] || { cogs:0, dealExp:0 };
      const fullCost      = totalPurchase + totalExp;
      const actualRemaining = Math.max(fullCost - fin.cogs - fin.dealExp, 0);
      const check = checkCOGSInvariant({ vehicles: vehRows, soldVins, totalPurchase, totalExp, actualRemaining });
      results.push({ file_no: fileNo, ...check });
    } catch(e) {
      results.push({ file_no: fileNo, error: e.message });
    }
  }
  const drifted = results.filter(r => r.hasDrift);
  console.table(results.map(r => ({
    file_no: r.file_no, expected: r.expectedRemaining, actual: r.actualRemaining,
    drift: r.drift, direction: r.direction || r.error || '',
  })));
  console.log(`✅ فحص ${results.length} ملف — ${drifted.length} ملف فيه انحراف حقيقي (أكبر من هامش التسامح).`);
  return { results, drifted };
}

// شراء: مخزون Dr / مورد Cr
export async function je_purchase({sys,date,amount,fileNo,supplier,refId}) {
  if(!amount||amount<=0) throw new Error(`قيمة شراء غير صالحة (${amount}) — لن يُسجَّل القيد ولا يُعتمد السند`);
  // ✅ Track B — return ناقصة كانت هنا (اكتُشف حيًّا 2026-07-30 أثناء بناء
  // Track A Phase 1 Step B) — بعكس je_payment/je_expense/je_collection الشقيقة،
  // كلهم بيرجّعوا {entryNo,ids}. تأكدنا: كل الـ5 مواقع استدعاء حقيقية لا تلتقط
  // القيمة المرجعة، فالإضافة دي إضافية بحتة بلا أي تأثير سلوكي حالي
  return await postDoubleEntry({sys,date,fileNo,refTable:'purchase_orders',refId,desc:`شراء — ملف ${fileNo} — ${supplier}`,lines:[
    {acc:'1300', name:getAccountName('1300'),  dr:amount, cr:0,      contact:null     },
    {acc:'2100', name:`ذمم الموردين`,           dr:0,      cr:amount, contact:supplier },
  ]});
}

// بيع: عميل Dr / إيراد Cr
export async function je_sale({sys,date,amount,cost,fileNo,customer,invNo}) {
  if(!amount||amount<=0) throw new Error(`قيمة فاتورة بيع غير صالحة (${amount}) — لن يُسجَّل القيد ولا تُعتمد الفاتورة`);
  const lines = [
    {acc:'1200', name:`ذمم العملاء`,        dr:amount, cr:0,     contact:customer, desc:`فاتورة ${invNo}`},
    {acc:'4100', name:getAccountName('4100'), dr:0,    cr:amount, contact:null,     desc:`فاتورة ${invNo}`},
  ];
  if (cost>0) {
    lines.push({acc:'5100', name:'تكلفة المخزون المباع', dr:cost, cr:0,    contact:null});
    lines.push({acc:'1300', name:'المخزون — سيارات',     dr:0,    cr:cost, contact:null});
  }
  // ✅ Track B — نفس علة je_purchase/je_payout (return ناقصة). الموقع الوحيد
  // الحقيقي (operations.js:4754، داخل safe() من أداة إصلاح جماعي/migration
  // قديمة) لا يلتقط القيمة المرجعة، فالإضافة دي إضافية بحتة
  return await postDoubleEntry({sys,date,fileNo,refTable:'sales',desc:`بيع فاتورة ${invNo} — ${customer} — ملف ${fileNo}`,lines});
}

// تحصيل: نقد Dr / عميل Cr
// ════════════════════════════════════════
// نموذج الشركاء: الصندوق = الخزينة (نقد 1110 + بنك 1120).
// أي شريك آخر يدفع/يستلم من جيبه → القيد على حسابه 2400 بدل النقدية.
// ════════════════════════════════════════
export const TREASURY_PARTNER = 'الصندوق';
// ✅ TM: شركاء الملف دايمًا "صندوق الترانزيت"/"مازن الخلف" — لا يوجد شريك اسمه "الصندوق" أصلاً
// في هذا النظام. "صندوق الترانزيت" هو الخزينة بعينها هنا (مرادف TREASURY_PARTNER)، فلازم يُستثنى
// من "دفع جيب شريك" زي TREASURY_PARTNER بالظبط، وإلا كل قيود TM هتتقيّد غلط كصرف شخصي على 2400.
// ✅ مُصدَّرة (كانت خاصة بالملف) — مصدر واحد لأسماء الخزينة يُعاد استخدامه في
// فحص "مراجعة الحسابات" (operations.js) وcomputePartnerSettlement (core.js)
// بدل ما تتكرر كنسخة ثانية قد تنحرف عن هذي مستقبلًا (زي ما حصل مع TM قبل كده)
export const TREASURY_ALIASES = new Set([TREASURY_PARTNER, 'صندوق الترانزيت']);
export function _isPartnerPocket(name) { const n = name && name.trim(); return !!(n && !TREASURY_ALIASES.has(n)); }

// ════════════════════════════════════════════════════════════
// ✅ B-2c2 (2026-09-30) — مصدر الفلوس في الكتّاب (docs/DESIGN-B2-custody-money-source.md §٣ و§٣ب و§٥).
// **نايم:** ولا منادي بيبعت `source` لحد B-2d ⇒ source = null ⇒ المسار القديم بالحرف (بصمة جسم
// القيد اتقاست قبل/بعد). ولما يتبعت:
// - لازم يكون طالع من resolveMoneySource (isResolvedSource) — مايتبنيش باليد.
// - source.sys ≠ sys ⇒ رفض (القيد المرآة بين الشركتين = B-2f).
// - الاسم في خانة الدافع/المستلم لازم يطابق المصدر: العهدة «عهدة: …»، والأساسية فاضي أو اسم خزينة،
//   والشريك اسمه — عشان قرّاء «تجميع الفلوس بالاسم» (§٣ب-ج) مايحسبوش دفعة من عهدة مساهمة من الشريك.
// - «عهدة: …» في الخانة **من غير** source ⇒ رفض بصوت قبل أي نداء شبكة (المسار القديم مايعرفش حسابها).
// - سطر المصدر: الحساب من source، والاسم من الشجرة (زي المسار القديم)، وcontact = null للعهدة
//   (§٣ — عشان voidTransaction/cashAccFromJE يعكس على نفس الحساب) واسم الشريك للشريك.
// ════════════════════════════════════════════════════════════
const _SOURCE_KINDS = new Set(['custody', 'custody-base', 'partner']);
function _checkSource(sys, source, { allowPartner = true, what = 'العملية' } = {}) {
  if (!isResolvedSource(source)) throw new Error('مصدر الفلوس لازم ييجي من resolveMoneySource — مايتبنيش باليد');
  if (source.sys !== sys) throw new Error(`مصدر الفلوس من ${source.sys} والقيد في ${sys} — القيد المرآة بين الشركتين لسه (B-2f)`);
  if (!_SOURCE_KINDS.has(source.kind)) throw new Error(`نوع مصدر مش مدعوم في الكتّاب (${source.kind})`);
  if (source.kind === 'partner' && !allowPartner) throw new Error(`${what} من جاري شريك مش مدعومة — المصدر لازم عهدة`);
}
function _assertNameMatchesSource(name, source, field) {
  const n = (name || '').trim();
  if (source.kind === 'custody-base') {
    if (n && !TREASURY_ALIASES.has(n)) throw new Error(`${field} «${n}» مش مطابق لمصدر الفلوس (العهدة الأساسية)`);
    return;
  }
  const want = source.kind === 'partner' ? source.contact : source.label;
  if (n !== want) throw new Error(`${field} «${n || '—'}» مش مطابق لمصدر الفلوس «${want}»`);
}
function _assertNoCustodyLabel(names, field) {
  const hit = (names || []).find(n => isCustodyLabel(n));
  if (hit) throw new Error(`${field} «${hit.trim()}» مصدر عهدة — لازم يتبعت source من resolveMoneySource (المسار القديم مايعرفش حساب العهدة)`);
}
// ذيل الوصف لعهدة شخص «من عهدة: …» (عرض بس، عشان اليومية تبقى مفهومة)؛ الأساسية من غير ذيل زي الخزينة النهارده
const _custodyTail = source => source.kind === 'custody' ? ` — من ${source.label}` : '';
async function _sourceLine(sys, source, amount, side) {
  const acc = await apiGetAll('chart_of_accounts', {
    select:'account_name', system_type:`eq.${sys}`, account_code:`eq.${source.account}`,
  });
  if (!acc?.[0]?.account_name) throw new Error(`حساب المصدر ${source.account} مش موجود في شجرة ${sys} — مفيش ترحيل`);
  return { acc:source.account, name:acc[0].account_name, dr: side === 'dr' ? amount : 0, cr: side === 'cr' ? amount : 0,
           contact: source.kind === 'partner' ? source.contact : null };
}

// ✅ حارس ضد الكتابة على ملف مُلغى (VOIDED، 2026-09-23) — يتخطّى لو fileNo فاضي
// (مصروف/صرف عام بلا ملف). يُستدعى أول أي دالة ترحّل نشاطًا جديدًا مرتبطًا
// بملف — je_expense/je_payment/je_collection/je_payout/je_partnerLedger هنا،
// وsubmitSale (modals.js) على طبقة العميل قبل الترحيل.
export async function _assertFileNotVoided(sys, fileNo) {
  if (!fileNo) return;
  const po = await apiGetAll('purchase_orders', { select:'post_status', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` });
  if (po?.[0]?.post_status === 'voided') {
    throw new Error(`الملف "${fileNo}" مُلغى (VOIDED) — لا يمكن تسجيل أي عملية جديدة عليه`);
  }
}

export const USER_DISPLAY_NAMES = {
  'mahmoud.hamdy1091@gmail.com': 'محمود حمدي',
  'transit.co.2002@gmail.com':   'ترانزيت ابو محمد',
};
export function displayUser(email) {
  if (!email) return 'غير معروف';
  return USER_DISPLAY_NAMES[email] || email.split('@')[0];
}

export async function je_collection({sys,date,amount,fileNo,refId,customer,invNo,method,receivedBy,isPrimary=true,source=null}) {
  if(!amount||amount<=0) throw new Error(`قيمة تحصيل غير صالحة (${amount}) — لن يُسجَّل القيد ولا يُعتمد التحصيل`);
  // ✅ B-2c2: حراس المصدر قبل أي نداء شبكة
  if (source != null) { _checkSource(sys, source); _assertNameMatchesSource(receivedBy, source, 'المستلم'); }
  else _assertNoCustodyLabel([receivedBy], 'المستلم');
  await _assertFileNotVoided(sys, fileNo);
  // المدين: الخزينة (نقد/بنك) افتراضياً، أو حساب الشريك المخصَّص لو احتفظ
  // بالمبلغ خارج الصندوق. ✅ المرحلة ٢ (partner_account_links، 2026-09-16) —
  // نفس نمط je_payment: _isPartnerPocket أصلاً بتستبعد الخزينة، فاللوكاب هنا
  // بس. حارس صريح يرفض مُستلِم بلا حساب مربوط بدل التسجيل الصامت على 2400.
  let debit;
  if (source != null) {
    debit = await _sourceLine(sys, source, amount, 'dr');   // ✅ B-2c2: المصدر المحلول بدل pay_method/_isPartnerPocket
  } else if (_isPartnerPocket(receivedBy)) {
    const receivedByTrimmed = receivedBy.trim();
    const link = await apiGetAll('partner_account_links', {
      select:'account_code', system_type:`eq.${sys}`, partner_name:`eq.${receivedByTrimmed}`,
    });
    if (!link?.length) {
      throw new Error(`المُستلِم "${receivedByTrimmed}" ليس له حساب مربوط في partner_account_links — راجع sql/partner_account_links.sql قبل تسجيل تحصيل باسمه`);
    }
    const partnerAcc = link[0].account_code;
    let partnerAccName = 'حسابات الشركاء';
    const acc = await apiGetAll('chart_of_accounts', {
      select:'account_name', system_type:`eq.${sys}`, account_code:`eq.${partnerAcc}`,
    });
    if (acc?.[0]?.account_name) partnerAccName = acc[0].account_name;
    debit = {acc:partnerAcc, name:partnerAccName, dr:amount, cr:0, contact:receivedByTrimmed};
  } else {
    debit = {acc:(method==='نقد'?'1110':'1120'), name:(method==='نقد'?'النقد':'البنك'), dr:amount, cr:0, contact:null};
  }
  const tail = source != null
    ? (source.kind === 'partner' ? ` — احتفظ بها ${source.contact}` : source.kind === 'custody' ? ` — في ${source.label}` : '')
    : _isPartnerPocket(receivedBy) ? ` — احتفظ بها ${receivedBy.trim()}` : '';
  return await postDoubleEntry({sys,date,fileNo,refTable:'collections',refId,isPrimary,desc:`تحصيل ${invNo} — ${customer} — ملف ${fileNo}${tail}`,lines:[
    debit,
    {acc:'1200',  name:`ذمم العملاء`,    dr:0,      cr:amount, contact:customer },
  ]});
}

// دفعة مورد: مورد Dr / نقد Cr
// لو الدافع (payer) شريك مختلف عن المورد → يُضاف سطر ثالث على حساب الشريك 2400
// حتى يظهر ما دفعه الشريك في كشف حسابه
export async function je_payment({sys,date,amount,fileNo,refId,supplier,supplierName,payer,payerName,method,isPrimary=true,source=null}) {
  if(!amount||amount<=0) throw new Error(`قيمة دفعة مورد غير صالحة (${amount}) — لن يُسجَّل القيد ولا تُعتمد الدفعة`);
  // ✅ B-2c2: حراس المصدر قبل أي نداء شبكة
  if (source != null) { _checkSource(sys, source); _assertNameMatchesSource(payer || payerName, source, 'الدافع'); }
  else _assertNoCustodyLabel([payer, payerName], 'الدافع');
  await _assertFileNotVoided(sys, fileNo);
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
  // ✅ B-2c2: المصدر المحلول بيحدد الدائن بدل pay_method/_isPartnerPocket (والوصف: الشريك زي النهارده
  // «بواسطة …»، والعهدة «من عهدة: …»، والأساسية من غير ذيل زي الخزينة)
  if (source != null) {
    const by = source.kind === 'partner' ? ` بواسطة ${source.contact}` : source.kind === 'custody' ? ` من ${source.label}` : '';
    return await postDoubleEntry({sys,date,fileNo,refTable:'payments',refId,isPrimary,
      desc:`دفعة للمورد ${sup}${by} — ملف ${fileNo}`,lines:[
      {acc:'2100', name:`ذمم الموردين`, dr:amount, cr:0, contact:sup},
      await _sourceLine(sys, source, amount, 'cr'),
    ]});
  }
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
    // ✅ المرحلة ٢ (partner_account_links، 2026-09-16): payerIsPartner فوق أصلاً
    // بتستبعد أسماء الخزينة (_isPartnerPocket بترجع false ليها) قبل ما نوصل
    // هنا — فمفيش حاجة لفحص TREASURY_ALIASES تاني، اللوكاب هنا بس. حارس صريح
    // يرفض أي payer مش شريك مسجَّل بدل ما يتقيد بصمت على 2400 باسمه الحرفي —
    // ده تشديد سلوك مقصود (نفس هدف المشروع)، مش تراجع: أي payer غريب (خطأ
    // إملائي، اسم موظف) كان بينجح بصمت قبل كده، ودلوقتي هيرفض صراحة.
    const payerTrimmed = payerStr.trim();
    const link = await apiGetAll('partner_account_links', {
      select:'account_code', system_type:`eq.${sys}`, partner_name:`eq.${payerTrimmed}`,
    });
    if (!link?.length) {
      throw new Error(`الدافع "${payerTrimmed}" ليس له حساب مربوط في partner_account_links — راجع sql/partner_account_links.sql قبل تسجيل دفعة باسمه`);
    }
    const partnerAcc = link[0].account_code;
    let partnerAccName = 'حسابات الشركاء';
    const acc = await apiGetAll('chart_of_accounts', {
      select:'account_name', system_type:`eq.${sys}`, account_code:`eq.${partnerAcc}`,
    });
    if (acc?.[0]?.account_name) partnerAccName = acc[0].account_name;
    return await postDoubleEntry({sys,date,fileNo,refTable:'payments',refId,isPrimary,
      desc:`دفعة للمورد ${sup} بواسطة ${payerStr} — ملف ${fileNo}`,lines:[
      {acc:'2100',     name:`ذمم الموردين`, dr:amount, cr:0,     contact:sup      },
      {acc:partnerAcc, name:partnerAccName, dr:0,      cr:amount, contact:payerTrimmed },
    ]});
  } else {
    // الدفع مباشرة من نقدية الشركة
    return await postDoubleEntry({sys,date,fileNo,refTable:'payments',refId,isPrimary,
      desc:`دفعة للمورد ${sup} — ملف ${fileNo}`,lines:[
      {acc:'2100',  name:`ذمم الموردين`, dr:amount, cr:0,     contact:sup  },
      {acc:cashAcc, name:cashNm,         dr:0,      cr:amount, contact:null },
    ]});
  }
}

// ════════════════════════════════════════════════════════════
// سياسة الترسملة (قرار 2026-07-14): مصاريف الملفات تُرسمل في المخزون
// 1300 وتخرج لتكلفة البيع 5100 وقت البيع — calcCOGS يشملها أصلاً في
// التكلفة الكاملة، والتسجيل القديم على 52xx/6xxx كان يخصم المصروف
// مرتين من الربح (مرة كمصروف مباشر ومرة داخل COGS).
// - ملف مُباع بالكامل (لا شاحنات متبقية) → المصروف مباشرة لـ5100
//   (لا مخزون متبقٍ يحمله؛ ولو أُضيفت سيارات لاحقاً calcCOGS يخصمه
//   تلقائياً ضمن alreadyCOGS فلا ازدواج).
// - مصروف بلا ملف → حسابات المصاريف كالسابق (لا يدخل COGS أصلاً).
// ════════════════════════════════════════════════════════════
export async function fileExpenseTarget(sys, fileNo, expType) {
  if (!fileNo) return { acc: EXPENSE_ACCOUNT_MAP[expType] || '6500', name: expType || 'مصروف' };
  try {
    const [vehRows, soldRows] = await Promise.all([
      apiGetAll('vehicles', { select:'vin', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGetAll('sales',    { select:'vin', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, post_status:'eq.posted' }),
    ]);
    const _isPart    = vin => (vin||'').startsWith('PART-');
    const trucks     = (vehRows||[]).filter(v => !_isPart(v.vin)).length;
    const soldTrucks = (soldRows||[]).filter(s => !_isPart(s.vin)).length;
    const fullySold  = (vehRows||[]).length > 0 && soldTrucks >= trucks;
    return fullySold
      ? { acc:'5100', name:'تكلفة المخزون المباع' }
      : { acc:'1300', name:'المخزون — سيارات' };
  } catch(e) {
    console.warn('fileExpenseTarget:', e.message);
    return { acc:'1300', name:'المخزون — سيارات' };
  }
}

// مصروف ملف: مخزون 1300 (أو 5100 لو الملف مُباع) Dr / نقد Cr — مصروف عام: حساب مصروف Dr / نقد Cr
// paidBySplit (اختياري): [{partner,amount}] — توزيع بالتساوي على شركاء مختارين
// يدويًا (js/lifecycle.js computeEqualSplit)، يبني N سطر دائن 2400 بدل السطر
// الواحد. لو غير موجود/فاضي، السلوك مطابق تمامًا لما قبل إضافة هذا الباراميتر.
// targetOverride (اختياري): {acc,name} يتجاوز fileExpenseTarget بالكامل — للمستدعي
// اللي بيعيد ترحيل مصروف *موجود بالفعل* (submitEditExpense's routingChanged) لا
// ينشئ واحدًا جديدًا؛ fileExpenseTarget بتشتق 1300/5100 من حالة البيع *الحالية*
// وقت الاستدعاء، فلو اتغيّرت حالة البيع (اتباعت السيارة) بين الترحيل الأصلي وأي
// تعديل لاحق على "مين دفع"، إعادة الاشتقاق كانت بتنقل المبلغ لحساب مختلف عن
// الأصلي — ازدواج حقيقي في COGS (المبلغ مُحتسَب أصلاً جوّه قيد البيع المجمَّد،
// ويُحسب تاني كقيد مباشر جديد). اكتُشف حيًّا 2026-08-02 على TM-004 (وكيل الشحن).
// ✅ المرحلة ٢ (partner_account_links، 2026-09-16): سطر دائن واحد لطرف دفع
// معيّن — شريك حقيقي (يبحث عن حسابه المخصَّص، حارس صريح لو بلا رابط) أو
// خزينة/دفع مباشر (نقد/بنك ثابت، بلا لوكاب). مُستخرجة كدالة مستقلة لاستخدامها
// في مسار التوزيع (N شريك) والمسار الفردي معًا بلا تكرار منطق.
// creditOverride (P0-2، اختياري): { 'اسم الشريك': {acc, name} } — لو الشريك ليه مفتاح،
// السطر الدائن بيتكتب على الحساب القديم بدل partner_account_links. بيبعته
// submitEditExpense بس (من سطور القيد النشط القديم)، والباقيين null ⇒ نفس السلوك
async function _expenseCreditLine(sys, name, amount, method, creditOverride = null) {
  if (_isPartnerPocket(name)) {
    const trimmed = name.trim();
    const ov = creditOverride && creditOverride[trimmed];
    if (ov && ov.acc) return {acc:ov.acc, name:ov.name || ov.acc, dr:0, cr:amount, contact:trimmed};
    const link = await apiGetAll('partner_account_links', {
      select:'account_code', system_type:`eq.${sys}`, partner_name:`eq.${trimmed}`,
    });
    if (!link?.length) {
      throw new Error(`الشريك "${trimmed}" ليس له حساب مربوط في partner_account_links — راجع sql/partner_account_links.sql قبل تسجيل مصروف باسمه`);
    }
    const partnerAcc = link[0].account_code;
    let partnerAccName = 'حسابات الشركاء';
    const acc = await apiGetAll('chart_of_accounts', {
      select:'account_name', system_type:`eq.${sys}`, account_code:`eq.${partnerAcc}`,
    });
    if (acc?.[0]?.account_name) partnerAccName = acc[0].account_name;
    return {acc:partnerAcc, name:partnerAccName, dr:0, cr:amount, contact:trimmed};
  }
  return {acc:(method==='نقد'?'1110':'1120'), name:(method==='نقد'?'النقد':'البنك'), dr:0, cr:amount, contact:null};
}

// ✅ P0-2 (N-09، 2026-09-27): creditOverride اختياري — راجع _expenseCreditLine فوق.
// من غيره تعديل مبلغ مصروف مقسوم كان بيرجّع نص مازن من 3200 (فلوس شركة، m4b)
// لـ2401 (حسابه) بصمت، لأن السطر الدائن بيتحسب من partner_account_links من الأول
export async function je_expense({sys,date,amount,fileNo,refId,desc,expType,method,paidBy,paidBySplit=null,isPrimary=true,targetOverride=null,isCommission=false,creditOverride=null,source=null}) {
  if(!amount||amount<=0) throw new Error(`قيمة مصروف غير صالحة (${amount}) — لن يُسجَّل القيد ولا يُعتمد المصروف`);
  // ✅ B-2c2: حراس المصدر قبل أي نداء شبكة. source وcreditOverride الاتنين بيحددوا جانب الدائن ⇒ واحد
  // بس (قرار المراجعة)؛ أما targetOverride فجانب المدين ⇒ يتجمعوا عادي.
  if (source != null) {
    _checkSource(sys, source);
    if (Array.isArray(paidBySplit) && paidBySplit.length) throw new Error('المصروف بمصدر واحد — التقسيم بالتساوي مع مصدر مش مسموح (§٥)');
    if (creditOverride) throw new Error('source وcreditOverride الاتنين بيحددوا الدائن — ينفع واحد بس');
    if (isCommission) throw new Error('العمولة المستحقة مش دفع فلوس — مالهاش مصدر');
    _assertNameMatchesSource(paidBy, source, 'الدافع');
  } else _assertNoCustodyLabel([paidBy, ...(Array.isArray(paidBySplit) ? paidBySplit.map(p => p && p.partner) : [])], 'الدافع');
  await _assertFileNotVoided(sys, fileNo);
  const hasSplit = Array.isArray(paidBySplit) && paidBySplit.length > 0;
  // ✅ م٦ (2026-09-22، قرار مالك) — "عمولة مستحقة لمستفيد": نفس القيد بالحرف
  // (مدين تكلفة الملف / دائن حساب الطرف)، الفرق في المعنى فقط ⇒ في الوصف فقط.
  // مصروف عادي: الشريك دفع من جيبه فالشركة مدينة له. عمولة: الشركة مدينة له
  // مقابل خدمته. الاتنان "الشركة عليها فلوس له"، فالمحاسبة واحدة — لكن كشف
  // حسابه كان هيكذب لو قال "دفعها" عن عمولة. راجع
  // project_m6_commission_as_deal_expense في الذاكرة.
  // ⚠️ حارس fail-closed قبل أي نداء شبكة: عمولة لطرف غير شريك (خزينة/نقد)
  // بتدائن 1110/1120 — يعني الشركة بتدفع لنفسها، رقم بلا معنى بلا مستفيد.
  // يُرفض صراحةً لا بصمت.
  if (isCommission && (hasSplit || !_isPartnerPocket(paidBy))) {
    throw new Error('عمولة مستحقة لازم يكون لها مستفيد واحد محدَّد له حساب شريك — لا خزينة ولا توزيع متساوٍ');
  }
  // ⚠️ طبقة تانية: _isPartnerPocket بتقارن تطابقًا تامًّا، وفيه حساب حقيقي
  // اسمه "صندوق الترانزيت — تاريخي" بيعدّي منها وهو خزينة فعلًا. مقصورة على
  // العمولة عمدًا — توسيع _isPartnerPocket نفسها كان هيعيد توجيه مصاريف
  // قائمة، وده تغيير محاسبي مالوش داعي هنا.
  if (isCommission && [...TREASURY_ALIASES].some(a => (paidBy||'').includes(a))) {
    throw new Error(`"${(paidBy||'').trim()}" حساب خزينة — العمولة لازم تروح لمستفيد حقيقي، لا للشركة نفسها`);
  }
  const target = targetOverride || await fileExpenseTarget(sys, fileNo, expType);
  // الدائن: توزيع بالتساوي على شركاء مختارين (N سطر) لو hasSplit، وإلا الخزينة
  // (نقد/بنك) افتراضياً، أو حساب الشريك المخصَّص لو دفعها من جيبه بمفرده.
  // ✅ داخل التوزيع نفسه، كل عنصر يُفحص بـ_isPartnerPocket مستقلاً — لو الصندوق/
  // صندوق الترانزيت مُختار ضمن مجموعة التوزيع، حصته تروح 1110/1120 زي الدفع
  // الفردي العادي بالظبط (فلوس الشركة نفسها، مش دَين شخصي)، لا حساب شريك مطلقًا.
  // ⚠️ Promise.all إلزامي هنا لا .map() عادية: كولباك async جوّه .map() بيرجّع
  // مصفوفة Promises لا كائنات حساب فعلية — postDoubleEntry كانت هتاخد lines
  // فيها [Promise, Promise,...] بدل {acc,name,dr,cr,contact} (رصدها المراجع
  // قبل الكتابة، مش بعد اكتشاف باج حي).
  // ✅ B-2c2: المصدر المحلول = سطر دائن واحد (بدل pay_method/_isPartnerPocket)
  const creditLines = source != null
    ? [ await _sourceLine(sys, source, amount, 'cr') ]
    : hasSplit
    ? await Promise.all(paidBySplit.map(p => _expenseCreditLine(sys, p.partner, +p.amount||0, method, creditOverride)))
    : [ await _expenseCreditLine(sys, paidBy, amount, method, creditOverride) ];
  const tail = source != null
    ? (source.kind === 'partner' ? ` — دفعها ${source.contact}` : _custodyTail(source))
    : hasSplit
    ? ` — موزَّع بالتساوي على ${paidBySplit.map(p=>p.partner).join('، ')}`
    : (_isPartnerPocket(paidBy)
        ? (isCommission ? ` — عمولة مستحقة لـ${paidBy.trim()}` : ` — دفعها ${paidBy.trim()}`)
        : '');
  return await postDoubleEntry({sys,date,fileNo,refTable:'expenses',refId,isPrimary,desc:`${desc} — ملف ${fileNo||'عام'}${tail}`,lines:[
    {acc:target.acc, name:target.name, dr:amount, cr:0, contact:null},
    ...creditLines,
  ]});
}

// صرف شريك (الموديل القديم — لا تُستخدم لأي صف جديد، تفضل للصفوف التاريخية
// المرحَّلة قبل Phase 2 فقط): شريك Dr / نقد Cr
export async function je_payout({sys,date,amount,fileNo,refId,partner,method,source=null}) {
  if(!amount||amount<=0) throw new Error(`قيمة صرف شريك غير صالحة (${amount}) — لن يُسجَّل القيد ولا يُعتمد الصرف`);
  // ✅ B-2c2: المصدر هنا عهدة بس (النهارده الصرف من الخزينة بس — مفيش «صرف من جاري شريك تاني»)
  if (source != null) _checkSource(sys, source, { allowPartner:false, what:'صرف الشريك' });
  await _assertFileNotVoided(sys, fileNo);
  const cashAcc = method==='نقد'?'1110':'1120';
  const cashNm  = method==='نقد'?'النقد':'البنك';
  const partnerTrimmed = (partner||'').trim();
  // ✅ م٣ (docs/PLAN-partner-accounts-2026-09-17.md، 2026-09-20): رُفع استثناء
  // الخزينة — كانت تكتب 2400 بالحرف، ودلوقتي عندها حساب مخصَّص فريد
  // (partner_account_links) زي أي شريك بالظبط، بعد ما اتأكد إنها مش هتظهر
  // كخيار في أي شاشة صرف غلط (فلتر _fillLedgerPartners، commit 65db271).
  let partnerAcc = '2400', partnerAccName = 'حسابات الشركاء';
  const link = await apiGetAll('partner_account_links', {
    select:'account_code', system_type:`eq.${sys}`, partner_name:`eq.${partnerTrimmed}`,
  });
  if (!link?.length) {
    throw new Error(`الشريك "${partnerTrimmed}" ليس له حساب مربوط في partner_account_links — راجع sql/partner_account_links.sql قبل تسجيل معاملة له`);
  }
  partnerAcc = link[0].account_code;
  const acc = await apiGetAll('chart_of_accounts', {
    select:'account_name', system_type:`eq.${sys}`, account_code:`eq.${partnerAcc}`,
  });
  if (acc?.[0]?.account_name) partnerAccName = acc[0].account_name;
  // ✅ Track B — نفس علة je_purchase/je_sale (return ناقصة). تأكدنا: كل الـ8
  // مواقع استدعاء حقيقية لا تلتقط القيمة المرجعة، فالإضافة دي إضافية بحتة
  return await postDoubleEntry({sys,date,fileNo,refTable:'partner_payouts',refId,desc:`صرف شريك ${partner} — ملف ${fileNo}${source != null ? _custodyTail(source) : ''}`,lines:[
    {acc:partnerAcc, name:partnerAccName, dr:amount, cr:0,     contact:partnerTrimmed },
    source != null ? await _sourceLine(sys, source, amount, 'cr')   // ✅ B-2c2
      : {acc:cashAcc,    name:cashNm,         dr:0,      cr:amount, contact:null    },
  ]});
}

// ✅ Phase 2 / المرحلة أ — موديل معاملات الشريك الموحَّد (js/lifecycle.js
// LEDGER_TYPES). يحل محل je_payout لكل صف جديد. 'تأكيد استلام' (needsJE=false
// في LEDGER_TYPES) لا تستدعي هذه الدالة إطلاقًا — الفرع يُقرَّر عند الكتابة،
// لا هنا. سحب عام/إيداع عام: fileNo=null (postDoubleEntry تتعامل معه كقيد
// عام، computeFinancials تتجاهله تلقائياً لأنه بلا ملف — راجع core.js:92).
export async function je_partnerLedger({sys,date,entryType,amount,fileNo,refId,partner,method,notes,source=null}) {
  if(!amount||amount<=0) throw new Error(`قيمة غير صالحة (${amount}) — لن يُسجَّل القيد`);
  // ✅ B-2c2 (قرار المراجعة): صف partner_ledger بيتكتب بـRPC لسه مابتقبلش المصدر ⇒ قيد على 115x والصف
  // مش حافظ مصدره ⇒ أي تعديل/اعتماد/إصلاح يرجّعه للمسار القديم بصمت. يتفتح مع p_source_* في SQL الـB-2e.
  if (source != null) throw new Error('مصدر الفلوس لقيد الشريك لسه ما اتفعّلش — بعد B-2e');
  await _assertFileNotVoided(sys, fileNo);
  const cashAcc = method==='نقد'?'1110':'1120';
  const cashNm  = method==='نقد'?'النقد':'البنك';
  const isDeposit = entryType === 'إيداع عام';
  const partnerTrimmed = (partner||'').trim();
  // ✅ م٣ (docs/PLAN-partner-accounts-2026-09-17.md، 2026-09-20): رُفع استثناء
  // الخزينة (كان يكتب 2400 بالحرف، راجع project_partner_current_account_model.md)
  // — الخزينة عندها حساب مخصَّص فريد دلوقتي (partner_account_links)، وأي شريك
  // (بما فيهم الخزينة) لازم يكون له حساب مربوط، وإلا رفض صريح (الحارس) بدل
  // كتابة صامتة على 2400 تُفقِد حركته من computePartnerGlobalBalance/computePartnerSettlement.
  let partnerAcc = '2400', partnerAccName = 'حسابات الشركاء';
  const link = await apiGetAll('partner_account_links', {
    select:'account_code', system_type:`eq.${sys}`, partner_name:`eq.${partnerTrimmed}`,
  });
  if (!link?.length) {
    throw new Error(`الشريك "${partnerTrimmed}" ليس له حساب مربوط في partner_account_links — راجع sql/partner_account_links.sql قبل تسجيل معاملة له`);
  }
  partnerAcc = link[0].account_code;
  // ✅ الاسم الحقيقي المخزَّن لازم يطابق الحساب المرحَّل عليه فعليًا (2401
  // "جاري الشريك أبو هادي" لا "حسابات الشركاء" — الاسم الأخير بتاع الأب 2400
  // بس). باج رصده المراجع: بلا هذا الاستعلام كل معاملة جديدة على حساب
  // مخصَّص كانت هتترحّل بالكود الصح والاسم المخزَّن الغلط.
  const acc = await apiGetAll('chart_of_accounts', {
    select:'account_name', system_type:`eq.${sys}`, account_code:`eq.${partnerAcc}`,
  });
  if (acc?.[0]?.account_name) partnerAccName = acc[0].account_name;
  // ✅ اكتُشف حيًّا 2026-09-22: الوصف كان ثابتًا عامًا دايمًا ("سحب عام —
  // الشريك") رغم إن المستخدم بيكتب سبب العملية فعليًا في حقل الملاحظات وقت
  // التسجيل (partner_ledger.notes) — الملاحظة محفوظة في القاعدة لكن معزولة
  // عن وصف القيد نفسه، فأي شاشة (بما فيها كشف حساب الشريك) بتعرض نصًّا عامًا
  // بلا تفسير. نضيفها هنا لكل قيد جديد من الآن فصاعدًا.
  const notesTrimmed = (notes||'').trim();
  const baseDesc = fileNo ? `${entryType} — ${partner} — ملف ${fileNo}` : `${entryType} — ${partner}`;
  const desc = notesTrimmed ? `${baseDesc} — ${notesTrimmed}` : baseDesc;
  return await postDoubleEntry({sys,date,fileNo:fileNo||null,refTable:'partner_ledger',refId,desc,lines: isDeposit
    ? [ {acc:cashAcc,   name:cashNm,       dr:amount, cr:0,      contact:null           },
        {acc:partnerAcc,name:partnerAccName,dr:0,      cr:amount, contact:partnerTrimmed } ]
    : [ {acc:partnerAcc,name:partnerAccName,dr:amount, cr:0,      contact:partnerTrimmed },
        {acc:cashAcc,   name:cashNm,       dr:0,      cr:amount, contact:null           } ],
  });
}

// عهدة: صرف = عهدة Dr / نقد Cr — تسوية = نقد Dr / عهدة Cr
export async function je_custodian({sys, date, amount, custodian, desc, method, direction='issue', refId=null}) {
  if (!amount || amount <= 0) throw new Error(`قيمة عهدة غير صالحة (${amount}) — لن يُسجَّل القيد`);
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
export async function je_opex({sys,date,amount,expType,desc,method,refNo,source=null}) {
  if(!amount||amount<=0) throw new Error(`قيمة مصروف تشغيلي غير صالحة (${amount}) — لن يُسجَّل القيد ولا يُعتمد المصروف`);
  // ✅ B-2c2: المصدر هنا عهدة بس (النهارده التشغيلي من الخزينة بس — مالوش دافع شريك)
  if (source != null) _checkSource(sys, source, { allowPartner:false, what:'المصروف التشغيلي' });
  const eAcc    = OPEX_ACC_MAP[expType] || '6700';
  const cashAcc = method==='نقد'?'1110':'1120';
  const cashNm  = method==='نقد'?'النقد':'البنك';
  await postDoubleEntry({sys,date,fileNo:null,refTable:'operating_expenses',refId:refNo||null,
    desc:`مصروف تشغيلي: ${desc||expType}${source != null ? _custodyTail(source) : ''}`,lines:[
    {acc:eAcc,    name:`مصروف تشغيلي — ${expType||'أخرى'}`, dr:amount, cr:0,     contact:null},
    source != null ? await _sourceLine(sys, source, amount, 'cr')   // ✅ B-2c2
      : {acc:cashAcc, name:cashNm,                               dr:0,      cr:amount, contact:null},
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
  // ✅ B-2c3: سطر المصدر المحفوظ في المعاينة (تقريبي زي باقي المعاينة — الترحيل الحقيقي عبر
  // sourceFromRecord). ⚠️ الـselect الصريح فيه source_* ⇒ ده **بعد SQL c1** بس (شرط §٥ب).
  const _srcLine = (r, who, amt, side) => { const k = String(r.source_account);
    return { acc:k, name:getAccountName(k), dr: side === 'dr' ? amt : 0, cr: side === 'cr' ? amt : 0, contact: /^24/.test(k) ? (who || null) : null }; };
  // ✅ B-2c3b: تأمين تسلسل — لو SQL c1 لسه ما اتشغّلش، الـselect بـsource_* بيرجع 400 («column
  // … source_sys does not exist») ⇒ نعيد نفس الطلب من غير العمودين (المعاينة القديمة بالحرف)، بدل ما
  // الـcatch الكبير تحت يضيّع كل المسودات بصمت. أي خطأ تاني بيطلع زي ما هو.
  const _draftRows = async (table, select) => {
    try { return await apiGetAll(table, { select: select + ',source_sys,source_account', system_type:`eq.${sys}`, post_status:'eq.draft' }); }
    catch (e) {
      if (!/source_(sys|account)/.test(String(e?.message || '')) || !/does not exist/.test(String(e?.message || ''))) throw e;
      return await apiGetAll(table, { select, system_type:`eq.${sys}`, post_status:'eq.draft' });
    }
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
    const PMs = await _draftRows('payments', 'id,pay_date,amount,file_no,payer,pay_method');
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
      if (pmt.source_account) {   // ✅ B-2c3
        push([
          {acc:'2100', name:'ذمم الموردين', dr:+pmt.amount, cr:0, contact:sup},
          _srcLine(pmt, pmt.payer, +pmt.amount, 'cr'),
        ], pmt.file_no, 'payments', `دفعة للمورد ${sup} — ${pmt.payer||'العهدة الأساسية'} — ملف ${pmt.file_no} (معاينة)`, pmt.pay_date);
        continue;
      }
      const payerStr = pmt.payer || sup;
      const cashAcc  = pmt.pay_method==='نقد'?'1110':'1120';
      const cashNm   = pmt.pay_method==='نقد'?'النقد':'البنك';
      if (payerStr && payerStr !== sup) {
        // ✅ المرحلة ٢ (partner_account_links، 2026-09-16) — نفس نمط je_payment
        // الحقيقية، عشان المعاينة لا تكذب عن الحساب اللي هيترحّل عليه فعليًا.
        // best-effort (تقريب 2400 لو بلا رابط) زي معاينة payout — المعاينة
        // تجميعية، والرفض الفعلي بيحصل في je_payment وقت الترحيل الحقيقي
        const payerTrimmed = payerStr.trim();
        let partnerAcc = '2400', partnerAccName = 'حسابات الشركاء';
        // ✅ م٣: الخزينة بقت لها حساب مربوط زي أي شريك — نفس المسار للجميع
        try {
          const link = await apiGetAll('partner_account_links', {
            select:'account_code', system_type:`eq.${sys}`, partner_name:`eq.${payerTrimmed}`,
          });
          if (link?.length) {
            partnerAcc = link[0].account_code;
            const acc = await apiGetAll('chart_of_accounts', {
              select:'account_name', system_type:`eq.${sys}`, account_code:`eq.${partnerAcc}`,
            });
            if (acc?.[0]?.account_name) partnerAccName = acc[0].account_name;
          }
        } catch(_) {}
        push([
          {acc:'2100',     name:'ذمم الموردين', dr:+pmt.amount, cr:0, contact:sup},
          {acc:partnerAcc, name:partnerAccName, dr:0, cr:+pmt.amount, contact:payerStr},
        ], pmt.file_no, 'payments', `دفعة للمورد ${sup} بواسطة ${payerStr} — ملف ${pmt.file_no} (معاينة)`, pmt.pay_date);
      } else {
        push([
          {acc:'2100',  name:'ذمم الموردين', dr:+pmt.amount, cr:0, contact:sup},
          {acc:cashAcc, name:cashNm,         dr:0, cr:+pmt.amount, contact:null},
        ], pmt.file_no, 'payments', `دفعة للمورد ${sup} — ملف ${pmt.file_no} (معاينة)`, pmt.pay_date);
      }
    }

    // ── المصاريف draft ──
    const EXPs = await _draftRows('expenses', 'id,exp_date,amount,file_no,description,exp_type,pay_method,paid_by');
    (EXPs||[]).forEach(e => {
      if (!inRange(e.exp_date) || !(+e.amount>0)) return;
      // سياسة الترسملة: مصروف ملف → مخزون 1300 (المعاينة تتجاهل حالة "الملف
      // المُباع بالكامل → 5100" تبسيطاً — الترحيل الفعلي عبر je_expense يفرّق)
      const eAcc    = e.file_no ? '1300' : (EXPENSE_ACCOUNT_MAP[e.exp_type] || '6500');
      const eNm     = e.file_no ? 'المخزون — سيارات' : (e.exp_type||'مصروف');
      const cashAcc = e.pay_method==='نقد'?'1110':'1120';
      const cashNm  = e.pay_method==='نقد'?'النقد':'البنك';
      push([
        {acc:eAcc,    name:eNm,    dr:+e.amount, cr:0, contact:null},
        e.source_account ? _srcLine(e, e.paid_by, +e.amount, 'cr')   // ✅ B-2c3
          : {acc:cashAcc, name:cashNm, dr:0, cr:+e.amount, contact:null},
      ], e.file_no, 'expenses', `${e.description||'مصروف'} — ملف ${e.file_no||'عام'} (معاينة)`, e.exp_date);
    });

    // ── صرف الشركاء draft ──
    const POuts = await _draftRows('partner_payouts', 'id,pay_date,amount,file_no,partner,pay_method');
    for (const o of (POuts||[])) {
      if (!inRange(o.pay_date) || !(+o.amount>0)) continue;
      const cashAcc = o.pay_method==='نقد'?'1110':'1120';
      const cashNm  = o.pay_method==='نقد'?'النقد':'البنك';
      // ✅ المرحلة ٢ (partner_account_links، 2026-09-16) — نفس نمط je_payout
      // الحقيقية، عشان المعاينة لا تكذب على المستخدم عن الحساب اللي هيترحّل عليه فعليًا
      const partnerTrimmed = (o.partner||'').trim();
      let partnerAcc = '2400', partnerAccName = 'حسابات الشركاء';
      // ✅ م٣: الخزينة بقت لها حساب مربوط زي أي شريك — نفس المسار للجميع
      try {
        const link = await apiGetAll('partner_account_links', {
          select:'account_code', system_type:`eq.${sys}`, partner_name:`eq.${partnerTrimmed}`,
        });
        if (link?.length) {
          partnerAcc = link[0].account_code;
          const acc = await apiGetAll('chart_of_accounts', {
            select:'account_name', system_type:`eq.${sys}`, account_code:`eq.${partnerAcc}`,
          });
          if (acc?.[0]?.account_name) partnerAccName = acc[0].account_name;
        }
        // ✅ بلا شريك مربوط: المعاينة تسيبها 2400 (بدل رفض الحلقة كلها بـthrow
        // زي الكاتب الحقيقي) — هي عرض تقريبي بس، والرفض الفعلي هيحصل عند
        // الترحيل الحقيقي عبر je_payout نفسها
      } catch(_) {}
      push([
        {acc:partnerAcc, name:partnerAccName, dr:+o.amount, cr:0, contact:o.partner},
        o.source_account ? _srcLine(o, null, +o.amount, 'cr')   // ✅ B-2c3
          : {acc:cashAcc,    name:cashNm,         dr:0, cr:+o.amount, contact:null},
      ], o.file_no, 'partner_payouts', `صرف شريك ${o.partner} — ملف ${o.file_no} (معاينة)`, o.pay_date);
    }

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
    const Cols = await _draftRows('collections', 'id,paid_date,amount,file_no,customer,inv_no,pay_method,received_by');
    (Cols||[]).forEach(c => {
      if (!c.paid_date || !inRange(c.paid_date) || !(+c.amount>0)) return;
      const cashAcc = c.pay_method==='نقد'?'1110':'1120';
      const cashNm  = c.pay_method==='نقد'?'النقد':'البنك';
      push([
        c.source_account ? _srcLine(c, c.received_by, +c.amount, 'dr')   // ✅ B-2c3
          : {acc:cashAcc, name:cashNm,        dr:+c.amount, cr:0, contact:null},
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
  updateJEInPlace, voidTransaction, reverseManualJE, voidPurchaseOrder, _voidSaleInvoiceCore, _assertFileNotVoided,
  computeInvoiceDueStatus, computeFileSalesTotals, adjustInvoiceDue, syncInvoiceCollectionsAfterSaleEdit,
  _jeNo, postDoubleEntry, _handoffPrimaryLine, calcCOGS, checkCOGSInvariant, auditAllFilesCOGS,
  je_purchase, je_sale, je_collection, je_payment, je_expense, je_payout, je_partnerLedger,
  je_custodian, je_opex, simulateDraftJE,
  TREASURY_PARTNER, TREASURY_ALIASES, _isPartnerPocket, USER_DISPLAY_NAMES, displayUser,
});

// ════════════════════════════════════════
// INIT
// ════════════════════════════════════════

// ✅ ربط engineHooks بالدوال الفعلية بيحصل هنا (جوه engine.js) مش في
// transactions.js/operations.js. lazy lookup مقصود، مش eager capture:
// operations.js (موديول) بييجي بعد engine.js في ترتيب الملفات بـ index.html،
// فـ window.loadApprovalQueue لسه مش معرّفة وقت تنفيذ هذا السطر لو كانت
// eager — ده سبب انكسار onVoidComplete بصمت بعد تحويل operations.js لموديول.
// transactions.js (لسه classic) بتتنفذ قبل أي موديول فعليًا، فـ onAppReady
// كانت شغّالة بالصدفة — lazy lookup موحّد وأأمن للاتنين، ومش هيتكسر لو
// transactions.js اتحوّلت لموديول لاحقًا.
engineHooks.onAppReady     = () => window.initApp?.();
engineHooks.onVoidComplete = () => window.loadApprovalQueue?.();

(function init() {
  // ✅ استرجاع النظام المختار (BOX/TM) قبل أي تحميل بيانات — بدونه initApp/
  // loadDashboard كانوا بيشتغلوا دايمًا على state.system الافتراضي ('BOX')
  // بغض النظر عن آخر نظام كان شغال فيه المستخدم قبل الريفرش
  const savedSystem = localStorage.getItem('tm_system');
  if (savedSystem === 'BOX' || savedSystem === 'TM') state.system = savedSystem;

  const savedToken   = localStorage.getItem('tm_token');
  const savedRefresh = localStorage.getItem('tm_refresh');
  const savedUser    = localStorage.getItem('tm_user');
  if (savedToken) {
    state.token        = savedToken;
    state.refreshToken = savedRefresh || null;
    state.user         = savedUser ? JSON.parse(savedUser) : { email: 'user@tm.com' };
    // ✅ استدعاء onAppReady لازم يتأجل لـ DOMContentLoaded دايمًا، مش يتنفذ فورًا هنا.
    // السبب: transactions.js (اللي بيعرّف initApp) بقى موديول زي engine.js بعد ترحيل
    // Plan A (2026-07-08)، وترتيبه في index.html بعد engine.js — يعني وقت تنفيذ هذا
    // السطر، window.initApp لسه undefined. الاستدعاء كان بيرجع بصمت (?.()) من غير
    // ما يعمل حاجة، فشاشة الدخول تفضل ظاهرة حتى مع توكن سليم محفوظ (هي سبب اختفاء
    // "استرجاع الجلسة بعد الريفرش" رغم إن التوكن والـremember me سليمين تمامًا).
    // DOMContentLoaded بيتأجل لحد ما كل الموديولات (بما فيها transactions.js) تخلص
    // تنفيذها بالضبط — فده مضمون يشتغل بغض النظر عن ترتيب الملفات.
    document.addEventListener('DOMContentLoaded', () => {
      if (engineHooks.onAppReady) engineHooks.onAppReady();
    });
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

  // ✅ إغلاق تلقائي لدرج القائمة الجانبية على الموبايل بعد أي تنقل فعلي (بند
  // تنقل أو مبدّل BOX/TM) — بلا لمس الأربعين+ onclick الفردية للبنود، عبر
  // تفويض حدث واحد على .sidebar نفسها. .nav-section-title (فتح/قفل قسم) لا
  // يُغلق الدرج عمدًا — مش تنقل فعلي، مجرد توسيع/طي قائمة
  const sidebarEl = document.querySelector('.sidebar');
  if (sidebarEl) {
    sidebarEl.addEventListener('click', (e) => {
      if (e.target.closest('.nav-item, .sys-btn')) closeMobileSidebar();
    });
  }
})();

// ════════════════════════════════════════
// PWA — unregister any old SW to prevent caching
// ════════════════════════════════════════
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(reg => reg.unregister());
  });
}
