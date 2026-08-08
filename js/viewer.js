// ╔══════════════════════════════════════════════════════════╗
// ║  viewer.js — File Viewer · Tabs · Summary · Vehicles    ║
// ║           Payments · Expenses · Sales · Collections     ║
// ║  Transit Management System — نقل حرفي، لا تعديل منطق   ║
// ╚══════════════════════════════════════════════════════════╝
export function openAddVehicleModal() {
  el('av-vin').value=''; el('av-type').value=''; el('av-model').value='';
  el('av-plate').value=''; el('av-color').value=''; el('av-price').value='';
  el('av-date').value = today(); el('av-notes').value='';
  el('avError').style.display='none';
  openModal('addVehicleModal');
}

export async function submitAddVehicle() {
  const fn    = state.currentFileNo;
  const vin   = el('av-vin').value.trim();
  const type  = el('av-type').value.trim();
  const model = el('av-model').value.trim();
  const plate = el('av-plate').value.trim();
  const color = el('av-color').value.trim();
  const price = parseFloat(el('av-price').value) || 0;
  const date  = el('av-date').value;
  const notes = el('av-notes').value.trim();

  if (!type) { showFieldErr('avError','يرجى إدخال نوع السيارة'); return; }

  try {
    let finalVin = vin;
    if (!finalVin) { const _a = [{ vin:'' }]; await _assignPartVins(fn, _a); finalVin = _a[0].vin; }  // ✅ كود فريد لقطعة بلا VIN
    const data = {
      system_type: state.system, file_no: fn,
      po_no: state.currentDeal?.po_no || null,
      vin: finalVin||null, vehicle_type: type, model: model||type,
      plate: plate||null, color: color||null,
      purchase_price: price, purchase_date: date||null, notes: notes||null
    };
    await apiPost('vehicles', data);
    // Update vehicle count on PO
    const vCount = (await apiGetAll('vehicles', { select:'id', system_type:`eq.${state.system}`, file_no:`eq.${fn}` })).length;
    await apiPatch('purchase_orders', { system_type:`eq.${state.system}`, file_no:`eq.${fn}` }, { vehicle_count: vCount });
    await logAudit('INSERT','vehicles',fn,null,data);
    markSaving('addVehicleModal'); await closeModal('addVehicleModal');
    invalidateCache();
    toast('✅ تم إضافة السيارة','ok');
    loadVehiclesTab(fn, state.system);
  } catch(e) { showFieldErr('avError','خطأ: '+e.message); }
}

// ════════════════════════════════════════
// FILE DROPDOWN HELPER
// ════════════════════════════════════════

export async function populateFileDropdown(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">-- اختر الملف --</option>';
  try {
    const deals = await apiGetAll('purchase_orders', {
      select:'file_no,supplier',
      system_type:`eq.${state.system}`,
      order:'created_at.desc'
    });
    (deals||[]).forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.file_no;
      opt.textContent = `${d.file_no} — ${d.supplier||''}`;
      sel.appendChild(opt);
    });
    // Pre-select current file if open
    if (state.currentFileNo) sel.value = state.currentFileNo;
    else if (currentVal) sel.value = currentVal;
  } catch(e) { console.warn('populateFileSelector:', e.message); }
}

// ════════════════════════════════════════
// MODAL EXPAND / COLLAPSE
// ════════════════════════════════════════
export function toggleModalSize(modalId) {
  const overlay = document.getElementById(modalId);
  if (!overlay) return;
  const modal = overlay.querySelector('.modal');
  if (!modal) return;
  modal.classList.toggle('expanded');
}

// ════════════════════════════════════════
// QUICK ENTRY (from Journal)
// ════════════════════════════════════════
export async function openQuickModal(type) {
  const map = {
    sale:       'quickSaleModal',
    collection: 'quickCollectionModal',
    expense:    'quickExpenseModal',
    payment:    'quickPaymentModal',
    payout:     'quickPayoutModal',
  };
  // ✅ مفتاح idempotency لهذه المحاولة — يتولّد وقت فتح المودال، لا وقت
  // الإرسال. راجع js/utils.js newIdemKey
  const quickModalEl = map[type] && el(map[type]);
  if (quickModalEl) quickModalEl.dataset.idemKey = newIdemKey();
  // Reset error messages
  ['qsSaleError','qsColError','qsExpError','qsPayError','qsPoError'].forEach(id => {
    const e = el(id); if (e) { e.style.display='none'; e.textContent=''; }
  });
  // Set today as default date
  const dateIds = ['qs-date','qc-date','qe-date','qp-date','qpo-date'];
  dateIds.forEach(id => { const e = el(id); if (e && !e.value) e.value = today(); });

  // Populate file dropdowns
  const fileSelIds = { sale:'qs-fileNo', collection:'qc-fileNo', expense:'qe-fileNo', payment:'qp-fileNo', payout:'qpo-fileNo' };
  if (fileSelIds[type]) await populateFileDropdown(fileSelIds[type]);

  if (type === 'expense') { openExpenseModal(); return; }
  if (type === 'sale')    { await populateContactSelect('qs-customer','customer'); }
  if (type === 'payment') {
    el('qp-po-card').style.display    = 'none';
    el('qp-form-fields').style.display = 'none';
    el('qp-submit-btn').style.display  = 'none';
    el('qp-amount').value = '';
    el('qp-doc').value    = '';
    el('qp-notes').value  = '';
    // لو في ملف مفتوح — حمّله تلقائياً
    if (state.currentFileNo) {
      el('qp-fileNo').value = state.currentFileNo;
      await loadPaymentPOCard(state.currentFileNo);
    }
  }

  // Collection — reset invoice fields
  if (type === 'collection') {
    el('qc-invNo').innerHTML    = '<option value="">— اختر ملفاً أولاً —</option>';
    el('qc-inv-card').style.display    = 'none';
    el('qc-form-fields').style.display = 'none';
    el('qc-submit-btn').style.display  = 'none';
    el('qc-amount').value  = '';
    el('qc-doc').value     = '';
    el('qc-notes').value   = '';
    el('qc-dueDate').value = '';
    el('qc-receivedBy').innerHTML = `<option value="${TREASURY_PARTNER}">${TREASURY_PARTNER}</option>`;
    // لو في ملف مفتوح حالياً — حمّل فواتيره تلقائياً
    if (state.currentFileNo) {
      el('qc-fileNo').value = state.currentFileNo;
      await loadQuickInvoices(state.currentFileNo);
      await loadQuickReceivedBy(state.currentFileNo);
    }
  }

  openModal(map[type]);
}

// Load unsold VINs for a file (used in quick sale)
export let _vinLoadTimer;
export async function loadQuickVins(fileNo) {
  clearTimeout(_vinLoadTimer);
  if (!fileNo) return;
  _vinLoadTimer = setTimeout(async () => {
    try {
      const vehicles = await apiGetAll('vehicles', { select:'vin,model,vehicle_type', system_type:`eq.${state.system}`, file_no:`eq.${fileNo.trim()}` });
      const sales    = await apiGetAll('sales', { select:'vin,post_status', system_type:`eq.${state.system}`, file_no:`eq.${fileNo.trim()}` });
      // ✅ استبعاد cancelled/voided (isOccupying) — سيارة بيعها الوحيد اتلغى أو
      // اتُرفض لازم تظهر تاني كمتاحة للبيع السريع
      const soldVins = new Set((sales||[]).filter(isOccupying).map(s=>s.vin).filter(Boolean));
      const unsold   = (vehicles||[]).filter(v => !soldVins.has(v.vin));
      el('qs-vin').innerHTML = unsold.length
        ? unsold.map(v=>`<option value="${v.vin}" title="${v.model||v.vehicle_type||''}">${v.vin}</option>`).join('')
        : '<option value="">— لا توجد سيارات متاحة في هذا الملف —</option>';
    } catch(e) { console.warn('loadQuickVins:', e.message); }
  }, 500);
}

// Load sales invoices for a file (used in quick collection)
export let _invLoadTimer;
export async function loadQuickInvoices(fileNo) {
  clearTimeout(_invLoadTimer);
  const invSel = el('qc-invNo');
  invSel.innerHTML = '<option value="">جاري التحميل...</option>';
  el('qc-inv-card').style.display    = 'none';
  el('qc-form-fields').style.display = 'none';
  el('qc-submit-btn').style.display  = 'none';

  if (!fileNo) {
    invSel.innerHTML = '<option value="">— اختر ملفاً أولاً —</option>';
    return;
  }

  try {
    const sys = state.system;
    const fn  = fileNo.trim();

    const [sales, collections] = await Promise.all([
      apiGetAll('sales',       { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'sale_date.desc' }),
      apiGetAll('collections', { select:'inv_no,amount,paid_date,file_no', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
    ]);

    // مجموع ما تم تحصيله فعلاً (paid_date موجود فقط — المسجّل بدون دفع لا يُحسب)
    const collectedMap = {};
    (collections||[]).forEach(c => {
      if (c.inv_no && c.paid_date)
        collectedMap[c.inv_no] = (collectedMap[c.inv_no]||0) + (+c.amount||0);
    });

    // الفواتير اللي فيها سجل collection بدون paid_date = منتظرة (مش مدفوعة)
    const pendingInvSet = new Set(
      (collections||[]).filter(c => c.inv_no && !c.paid_date).map(c => c.inv_no)
    );

    // تجميع السيارات بنفس inv_no في فاتورة واحدة
    const invMap = {};
    (sales||[]).filter(s => s.inv_no).forEach(s => {
      const k = s.inv_no;
      if (!invMap[k]) invMap[k] = {
        inv_no: k, customer: s.customer, file_no: s.file_no,
        sale_date: s.sale_date, total: 0, vins: []
      };
      invMap[k].total += +s.sale_price || 0;
      if (s.vin) invMap[k].vins.push(s.vin);
    });

    const pending = Object.values(invMap).map(inv => ({
      ...inv,
      sale_price: inv.total,
      vin:        inv.vins.join(' / '),
      collected:  collectedMap[inv.inv_no] || 0,
      remaining:  inv.total - (collectedMap[inv.inv_no] || 0),
    })).filter(inv => inv.remaining > 0.001)
       .sort((a,b) => (a.sale_date||'') > (b.sale_date||'') ? -1 : 1);

    invSel._salesData = pending;

    if (!pending.length) {
      invSel.innerHTML = '<option value="">لا توجد فواتير غير محصّلة</option>';
      return;
    }

    invSel.innerHTML = '<option value="">— اختر الفاتورة —</option>' +
      pending.map(inv => {
        const hasPendingCol = pendingInvSet.has(inv.inv_no);
        const label = hasPendingCol
          ? `${inv.inv_no} — ${inv.customer||'—'} — ${inv.vins.length} سيارة — ⏳ تحصيل منتظر (${fmt(inv.remaining)})`
          : `${inv.inv_no} — ${inv.customer||'—'} — ${inv.vins.length} سيارة (باقي: ${fmt(inv.remaining)})`;
        return `<option value="${inv.inv_no}"
          data-customer="${inv.customer||''}"
          data-vin="${inv.vin||''}"
          data-total="${inv.total||0}"
          data-collected="${inv.collected}"
          data-remaining="${inv.remaining}"
          data-has-pending="${hasPendingCol}">
          ${label}
        </option>`;
      }).join('');

  } catch(e) {
    console.error('loadQuickInvoices error:', e.message, e);
    invSel.innerHTML = `<option value="">خطأ: ${e.message}</option>`;
  }
}

export function onQuickCollectionInvChange() {
  const sel = el('qc-invNo');
  const opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.value) {
    el('qc-inv-card').style.display    = 'none';
    el('qc-form-fields').style.display = 'none';
    el('qc-submit-btn').style.display  = 'none';
    return;
  }
  const total     = parseFloat(opt.dataset.total)     || 0;
  const collected = parseFloat(opt.dataset.collected) || 0;
  const remaining = parseFloat(opt.dataset.remaining) || 0;

  el('qc-customer').value          = opt.dataset.customer || '';
  el('qc-vin').value               = opt.dataset.vin      || '';
  el('qc-card-customer').textContent  = opt.dataset.customer || '—';
  el('qc-card-vin').textContent       = opt.dataset.vin      || '—';
  el('qc-card-total').textContent     = fmt(total);
  el('qc-card-collected').textContent = fmt(collected);
  el('qc-card-remaining').textContent = fmt(remaining);
  el('qc-card-remaining').style.color = remaining > 0 ? 'var(--accent)' : 'var(--green)';
  el('qc-amount').value = remaining > 0 ? remaining.toFixed(3) : '';

  el('qc-inv-card').style.display    = 'block';
  el('qc-form-fields').style.display = 'block';
  el('qc-submit-btn').style.display  = '';
}

// Legacy — not used anymore
export function fillCollectionCustomer() {}

// Load partners for a file (used in quick payout)
export let _partnerLoadTimer;
export async function loadQuickPartners(fileNo) {
  clearTimeout(_partnerLoadTimer);
  if (!fileNo) return;
  _partnerLoadTimer = setTimeout(async () => {
    try {
      const partners = await apiGetAll('partners_master', { select:'partner', system_type:`eq.${state.system}`, file_no:`eq.${fileNo.trim()}` });
      el('qpo-partner').innerHTML = (partners&&partners.length)
        ? partners.map(p=>`<option value="${p.partner}">${p.partner}</option>`).join('')
        : '<option value="">— لا يوجد شركاء في هذا الملف —</option>';
    } catch(e) { console.warn('loadQuickPartners:', e.message); }
  }, 500);
}

// من استلم التحصيل فعلياً (الصندوق افتراضياً، أو شريك احتفظ بالمبلغ) — يستخدم
// في submitQuickCollection لتمرير receivedBy لـje_collection (نفس منطق الفورم الكامل)
export async function loadQuickReceivedBy(fileNo) {
  if (!fileNo) return;
  try {
    const partners = await apiGetAll('partners_master', { select:'partner', system_type:`eq.${state.system}`, file_no:`eq.${fileNo.trim()}` });
    const raw  = (partners||[]).map(p=>p.partner);
    // ✅ نتحقق من وجود أي اسم خزينة (TREASURY_ALIASES) لا "الصندوق" الحرفي بس —
    // TM مسجّلة باسم "صندوق الترانزيت" فعليًا كشريك حقيقي في partners_master؛
    // كانت المقارنة القديمة تفشل معه فتحقن "الصندوق" العام كخيار وهمي ثالث
    const list = raw.some(p => TREASURY_ALIASES.has(p)) ? raw : [TREASURY_PARTNER, ...raw];
    const rb = el('qc-receivedBy');
    if (rb) {
      rb.innerHTML = list.map(p=>`<option value="${p}">${p}</option>`).join('');
      rb.value = raw.includes('صندوق الترانزيت') ? 'صندوق الترانزيت' : TREASURY_PARTNER;
    }
  } catch(e) { console.warn('loadQuickReceivedBy:', e.message); }
}

// Submit quick sale
export async function submitQuickSale() {
  const fileNo   = el('qs-fileNo').value;
  const vin      = el('qs-vin').value.trim();
  const customer = el('qs-customer')?.value?.trim() || '';
  const invNo    = el('qs-invNo').value.trim();
  const price    = parseFloat(el('qs-price').value);
  const date     = el('qs-date').value;
  const notes    = el('qs-notes').value.trim();

  if (!fileNo || !vin || !customer || !price || !date) {
    showFieldErr('qsSaleError','يرجى ملء جميع الحقول المطلوبة (*)'); return;
  }
  try {
    const data = { system_type:state.system, file_no:fileNo, vin, customer,
      inv_no:invNo||null, sale_price:price, sale_date:date, notes:notes||null , post_status:entryStatus()};
    const qsIns = await apiPost('sales', data);
    await logAudit('INSERT','sales',fileNo,null,data);
    if (entryStatus()==='posted') {
      const saleId = qsIns?.[0]?.id || null;
      try {
        // ✅ post_sale_je (RPC) بيستخدم p_inv_no كمعرّف idempotency حقيقي —
        // لو مفيش رقم فاتورة (شائع في البيع السريع) لازم fallback فريد لكل
        // عملية (مش النص الثابت 'QS' القديم)، وإلا بيع سريع تاني بلا رقم
        // فاتورة في نفس الملف هيتعامل معاه كـ"نفس الفاتورة" ويتجاهل قيده
        const qsRef = invNo || ('QS-' + (saleId || Date.now()));
        await apiRpc('post_sale_je', {
          p_sys: state.system, p_file_no: fileNo, p_inv_no: qsRef,
          p_customer: customer || '', p_date: date,
          p_sold_vins: [vin], p_sale_amount: price,
        });
      } catch(jeErr) {
        if (saleId) await apiPatch('sales', { id:`eq.${saleId}` }, { post_status:'draft' });
        toast(`⚠️ تم حفظ البيع بدون ترحيل قيده — راجع قائمة الاعتمادات (${jeErr.message})`,'warn');
      }
    }
    // ✅ سطر تحصيل "مستحق" تلقائي (paid_date:null) لنفس قيمة الفاتورة — بدون هذا
    // السطر الفاتورة تختفي من تتبّع "تحصيلات مستحقة" ويظهر الملف كمحصَّل بالكامل
    // وهي مش (راجع: فاتورة ابو لزام INV-LOT 3 NEW-004)
    try {
      const colRefNo = (await genSeqRef('COL', state.system, fileNo, 'collections')) || `COL-${invNo||'QS'}-${Date.now()}`;
      await apiPost('collections', {
        system_type: state.system, file_no: fileNo, inv_no: invNo||null, customer,
        vin, amount: price, pay_method: null, document: null,
        due_date: date, paid_date: null, notes: null,
        ref_no: colRefNo, pay_id: colRefNo, post_status: entryStatus(),
      });
    } catch(colErr) {
      console.error('quick sale collection create error:', colErr.message);
      toast(`⚠️ تم حفظ البيع لكن فشل إنشاء سطر التحصيل المستحق: ${colErr.message}`,'warn');
    }
    markSaving('quickSaleModal'); await closeModal('quickSaleModal');
    toast('✅ تم تسجيل البيع بنجاح','ok');
    invalidateCache();
    loadJournal();
  } catch(e) { showFieldErr('qsSaleError','خطأ: '+e.message); }
}

// Submit quick collection
export async function submitQuickCollection() {
  const fileNo   = el('qc-fileNo').value;
  const invNo    = el('qc-invNo').value;
  const customer = el('qc-customer').value.trim();
  const vin      = el('qc-vin').value.trim();
  const amount   = parseFloat(el('qc-amount').value);
  const method   = el('qc-method').value;
  const doc      = el('qc-doc').value.trim();
  const due      = el('qc-dueDate').value;
  const paid     = el('qc-date').value;
  const notes    = el('qc-notes').value.trim();
  const receivedBy = el('qc-receivedBy')?.value?.trim() || null;

  if (!fileNo || !invNo || !amount || !paid) {
    showFieldErr('qsColError','يرجى ملء جميع الحقول المطلوبة (*)'); return;
  }

  // تحقق من عدم تجاوز الباقي
  const sel = el('qc-invNo');
  const opt = sel.options[sel.selectedIndex];
  const remaining = parseFloat(opt?.dataset.remaining || 0);
  if (amount > remaining + 0.001) {
    showFieldErr('qsColError', `⚠️ المبلغ أكبر من الباقي المستحق (${fmt(remaining)})`);
    return;
  }

  try {
    const refNo = (await genSeqRef('COL', state.system, fileNo, 'collections')) || `COL-${fileNo}-${Date.now()}`;
    // ✅ paid_date يُحفظ دائماً (الحقل إجباري في الفورم) — كان يُرمى عند Draft
    // مما يخلي التحصيل يفضل "مستحق" للأبد حتى بعد الموافقة، لأن الموافقة
    // لا تُعيد تاريخ الدفع ولا تُنشئ قيده بدونه (نفس نمط modals.js لفاتورة البيع)
    const isPostedNow = entryStatus() === 'posted';
    const data = {
      system_type: state.system, file_no: fileNo,
      pay_id: refNo, inv_no: invNo, customer: customer||null,
      vin: vin||null, amount, pay_method: method,
      document: doc||null, due_date: due||null,
      paid_date: paid || null,
      notes: notes||null, ref_no: refNo, received_by: receivedBy,
    post_status:entryStatus()};
    const qcIns = await apiPost('collections', data);
    await logAudit('INSERT','collections', fileNo, null, data);
    if (isPostedNow && customer) {
      const qcId = qcIns?.[0]?.id || null;
      try {
        await je_collection({sys:state.system,date:paid||today(),amount,fileNo,refId:qcId,customer,invNo,method,receivedBy});
      } catch(jeErr) {
        if (qcId) await apiPatch('collections', { id:`eq.${qcId}` }, { post_status:'draft' });
        toast(`⚠️ تم حفظ التحصيل بدون ترحيل قيده — راجع قائمة الاعتمادات (${jeErr.message})`,'warn');
      }
    }
    markSaving('quickCollectionModal'); await closeModal('quickCollectionModal');
    toast('✅ تم تسجيل التحصيل بنجاح','ok');
    invalidateCache();
    loadJournal();
    if (state.currentTab === 5 && state.currentFileNo === fileNo) loadCollectionsTab(fileNo, state.system);
  } catch(e) { showFieldErr('qsColError','خطأ: '+e.message); }
}

// Submit quick expense
export async function submitQuickExpense() {
  const fileNo = el('qe-fileNo').value;
  const desc   = el('qe-desc').value.trim();
  const type   = el('qe-type').value;
  const amount = parseFloat(el('qe-amount').value);
  const method = el('qe-method').value;
  const doc    = el('qe-doc').value.trim();
  const date   = el('qe-date').value;
  const notes  = el('qe-notes').value.trim();

  if (!fileNo || !desc || !amount || !date) {
    showFieldErr('qsExpError','يرجى ملء جميع الحقول المطلوبة (*)'); return;
  }

  // ✅ تحذير ناعم بدل الرفض الصلب القديم (uniq_expense_active) — راجع
  // sql/add_idempotency_key_expenses_payments.sql وjs/utils.js warnIfSimilarActive
  const proceedQe = await warnIfSimilarActive('expenses', {
    select: 'id,post_status', system_type: `eq.${state.system}`, file_no: `eq.${fileNo}`,
    amount: `eq.${amount}`, description: `eq.${desc}`, exp_date: `eq.${date}`,
  }, 'مصروف');
  if (!proceedQe) return;

  try {
    const refNo = (await genSeqRef('EXP', state.system, fileNo, 'expenses')) || `EXP-${fileNo}-${Date.now()}`;
    const idemKey = el('quickExpenseModal')?.dataset.idemKey || newIdemKey();
    const data = { system_type:state.system, file_no:fileNo, description:desc,
      pay_id:refNo, exp_type:type, category:type, amount, pay_method:method, document:doc||null,
      exp_date: date, expense_date:date, notes:notes||null, ref_no:refNo, idempotency_key: idemKey,
      post_status:entryStatus() };
    const qeIns = await apiPost('expenses', data);
    await logAudit('INSERT','expenses',fileNo,null,data);
    if (entryStatus()==='posted') {
      const expId = qeIns?.[0]?.id || null;
      try {
        await je_expense({sys:state.system,date,amount,fileNo,refId:expId,desc,expType:type,method});
      } catch(jeErr) {
        console.error('je_expense failed:', jeErr.message);
        if (expId) await apiPatch('expenses', { id:`eq.${expId}` }, { post_status:'draft' });
        toast(`⚠️ تم حفظ المصروف بدون ترحيل قيده — راجع قائمة الاعتمادات (${jeErr.message})`,'warn');
      }
    }
    markSaving('quickExpenseModal'); await closeModal('quickExpenseModal');
    toast('✅ تم تسجيل المصروف بنجاح','ok');
    invalidateCache();
    loadJournal();
  } catch(e) { showFieldErr('qsExpError','خطأ: '+e.message); }
}

// Submit quick payment (to supplier)
export async function loadPaymentPOCard(fileNo) {
  el('qp-po-card').style.display    = 'none';
  el('qp-form-fields').style.display = 'none';
  el('qp-submit-btn').style.display  = 'none';
  if (!fileNo) return;

  try {
    const sys = state.system;
    const [po, prevPayments, partners] = await Promise.all([
      apiGetAll('purchase_orders', { select:'file_no,supplier,total_purchase', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGetAll('payments',        { select:'amount', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGetAll('partners_master', { select:'partner', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
    ]);

    const poData    = po?.[0] || {};
    const totalPO   = +poData.total_purchase || 0;
    const totalPaid = (prevPayments||[]).reduce((s,p)=>s+(+p.amount||0), 0);
    const remaining = Math.max(totalPO - totalPaid, 0);

    el('qp-card-supplier').textContent  = poData.supplier || '—';
    el('qp-card-total').textContent     = fmt(totalPO);
    el('qp-card-paid').textContent      = fmt(totalPaid);
    el('qp-card-remaining').textContent = fmt(remaining);
    el('qp-card-remaining').style.color = remaining > 0 ? 'var(--accent)' : 'var(--green)';

    el('qp-amount').value = remaining > 0 ? remaining.toFixed(3) : '';

    // الدافع
    const rawPartners = (partners||[]).map(p=>p.partner);
    // ✅ نفس إصلاح TREASURY_ALIASES أعلى الملف (loadQuickReceivedBy) — TM مسجّلة
    // باسم "صندوق الترانزيت" فعليًا، فمقارنة "الصندوق" الحرفي كانت تحقن خيارًا وهميًا
    const payerList = rawPartners.some(p => TREASURY_ALIASES.has(p)) ? rawPartners : [TREASURY_PARTNER, ...rawPartners];
    el('qp-payer').innerHTML = payerList.map(p=>`<option value="${p}">${p}</option>`).join('');
    el('qp-payer').value = rawPartners.includes('صندوق الترانزيت') ? 'صندوق الترانزيت' : TREASURY_PARTNER;

    el('qp-po-card').style.display    = 'block';
    el('qp-form-fields').style.display = 'block';
    el('qp-submit-btn').style.display  = '';

  } catch(e) { console.error('loadPaymentPOCard:', e.message); toast('خطأ في تحميل بيانات الصفقة', 'err'); }
}

export async function submitQuickPayment() {
  // ✅ مسح رسالة خطأ سابقة أولاً — راجع نفس الإصلاح في submitPayment (modals.js)
  const errEl = el('qsPayError');
  if (errEl) errEl.style.display = 'none';

  const fileNo = el('qp-fileNo').value;
  const payer  = (el('qp-payer').value || '').trim();
  const amount = parseFloat(el('qp-amount').value);
  const method = el('qp-method').value;
  const doc    = el('qp-doc').value.trim();
  const date   = el('qp-date').value;
  const notes  = el('qp-notes').value.trim();

  if (!fileNo || !payer || !amount || !date) {
    showFieldErr('qsPayError','يرجى ملء جميع الحقول المطلوبة (*)'); return;
  }

  // تحقق من عدم تجاوز الباقي
  const remainingText = el('qp-card-remaining')?.textContent?.replace(/,/g,'');
  const remaining = parseFloat(remainingText) || 0;
  if (remaining > 0 && amount > remaining + 0.001) {
    const proceed = await confirmAsync('⚠️ تجاوز الباقي المستحق', `قيمة الدفعة (${fmt(amount)}) أكبر من الباقي للمورد (${fmt(remaining)}).\n\nهل تريد المتابعة؟`, true);
    if (!proceed) return;
  }

  // ✅ تحذير ناعم بدل الرفض الصلب القديم (uniq_payment_active) — راجع
  // sql/add_idempotency_key_expenses_payments.sql وjs/utils.js warnIfSimilarActive
  const proceedQp = await warnIfSimilarActive('payments', {
    select: 'id,post_status', system_type: `eq.${state.system}`, file_no: `eq.${fileNo}`,
    amount: `eq.${amount}`, payer: `eq.${payer}`, pay_date: `eq.${date}`,
  }, 'دفعة');
  if (!proceedQp) return;

  try {
    const refNo = (await genSeqRef('PMT', state.system, fileNo, 'payments')) || `PMT-${fileNo}-${Date.now()}`;
    const supplierName = el('qp-card-supplier')?.textContent || '';
    const idemKey = el('quickPaymentModal')?.dataset.idemKey || newIdemKey();
    const data = { system_type:state.system, file_no:fileNo, payer, amount,
      pay_id:refNo, ref_no:refNo,
      pay_method:method, document:doc||null, pay_date: date, notes:notes||null, idempotency_key: idemKey,
      post_status:entryStatus() };
    const qpIns = await apiPost('payments', data);
    await logAudit('INSERT','payments', fileNo, null, data);
    if (entryStatus()==='posted') {
      const qpId = qpIns?.[0]?.id || null;
      try {
        await je_payment({sys:state.system,date,amount,fileNo,refId:qpId,supplierName,payerName:payer,method});
      } catch(jeErr) {
        if (qpId) await apiPatch('payments', { id:`eq.${qpId}` }, { post_status:'draft' });
        toast(`⚠️ تم حفظ الدفعة بدون ترحيل قيدها — راجع قائمة الاعتمادات (${jeErr.message})`,'warn');
      }
    }
    markSaving('quickPaymentModal'); await closeModal('quickPaymentModal');
    toast('✅ تم تسجيل الدفعة بنجاح','ok');
    loadJournal();
    if (state.currentTab === 2 && state.currentFileNo === fileNo) loadPaymentsTab(fileNo, state.system);
  } catch(e) { showFieldErr('qsPayError','خطأ: '+e.message); }
}

// Submit quick payout (to partner)
export async function submitQuickPayout() {
  const fileNo  = el('qpo-fileNo').value;
  const partner = el('qpo-partner').value;
  const type    = el('qpo-type').value;
  const amount  = parseFloat(el('qpo-amount').value);
  const method  = el('qpo-method').value;
  const doc     = el('qpo-doc').value.trim();
  const date    = el('qpo-date').value;
  const notes   = el('qpo-notes').value.trim();

  if (!fileNo || !partner || !amount || !date) {
    showFieldErr('qsPoError','يرجى ملء جميع الحقول المطلوبة (*)'); return;
  }
  // ✅ تفصيل رأس مال/أرباح/سلفة — نفس ما يحفظه فورم "صرف شريك" الكامل،
  // يُستخدم في كشف حساب الشريك وجاري الشريك (راجع capital_amount في dashboard.js/print.js)
  let capitalAmt = 0, profitAmt = 0, advanceAmt = 0;
  if (type === 'استرداد') capitalAmt = amount;
  else if (type === 'توزيع أرباح') profitAmt = amount;
  else if (type === 'سلفة') advanceAmt = amount;
  try {
    // Generate pay_id
    let pay_id = `PAY-${fileNo}-001`;
    try {
      const existing = await apiGetAll('partner_payouts', { select:'pay_id', system_type:`eq.${state.system}`, file_no:`eq.${fileNo}`, order:'created_at.desc', limit:100 });
      const lastNums = (existing||[]).map(p=>{ const m=(p.pay_id||'').match(/(\d+)$/); return m?parseInt(m[1]):0; });
      const nextNum  = (lastNums.length ? Math.max(...lastNums) : 0) + 1;
      pay_id = `PAY-${fileNo}-${String(nextNum).padStart(3,'0')}`;
    } catch(e) { console.warn('quickPayoutId generator:', e.message); }
    const data = { system_type:state.system, file_no:fileNo, partner,
      pay_id, payout_type:type, amount,
      capital_amount: capitalAmt, profit_amount: profitAmt, advance_amount: advanceAmt,
      pay_method:method, document:doc||null,
      pay_date: date, notes:notes||null, post_status:entryStatus() };
    const qpoIns = await apiPost('partner_payouts', data);
    await logAudit('INSERT','partner_payouts',fileNo,null,data);
    if (entryStatus()==='posted') {
      const qpoId = qpoIns?.[0]?.id || null;
      try {
        await je_payout({sys:state.system,date,amount,fileNo,refId:qpoId,partner,method});
      } catch(jeErr) {
        if (qpoId) await apiPatch('partner_payouts', { id:`eq.${qpoId}` }, { post_status:'draft' });
        toast(`⚠️ تم حفظ ${type} بدون ترحيل قيده — راجع قائمة الاعتمادات (${jeErr.message})`,'warn');
      }
    }
    markSaving('quickPayoutModal'); await closeModal('quickPayoutModal');
    invalidateCache();
    toast('✅ تم تسجيل الصرف بنجاح','ok');
    loadJournal();
  } catch(e) { showFieldErr('qsPoError','خطأ: '+e.message); }
}

// VIN Search
export function closeVinDropdown() {
  const dd = el('vinDropdown');
  if (dd) dd.style.display = 'none';
}

export let _vinSearchTimer = null;
export async function searchVinDropdown(q) {
  const dd = el('vinDropdown');
  if (!dd) return;

  if (!q || q.length < 3) { dd.style.display = 'none'; return; }

  dd.innerHTML = '<div style="padding:10px 14px;color:var(--text2);font-size:12px">⏳ جاري البحث...</div>';
  dd.style.display = 'block';

  clearTimeout(_vinSearchTimer);
  _vinSearchTimer = setTimeout(async () => {
    try {
      const vehicles = await apiGetAll('vehicles', {
        select: 'vin,model,vehicle_type,year,file_no,color',
        system_type: `eq.${state.system}`,
        vin: `ilike.*${q}*`,
        limit: 10
      });

      if (!vehicles?.length) {
        dd.innerHTML = '<div style="padding:10px 14px;color:var(--text2);font-size:12px">لا توجد نتائج</div>';
        return;
      }

      dd.innerHTML = vehicles.map(v => {
        const label = [v.model||v.vehicle_type, v.year, v.color].filter(Boolean).join(' · ');
        return `
        <div onclick="selectVinFromDropdown('${v.vin}')"
          style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center"
          onmouseenter="this.style.background='var(--card2)'" onmouseleave="this.style.background=''">
          <div>
            <div style="font-family:monospace;font-weight:700;color:var(--accent);font-size:13px;direction:ltr">${v.vin}</div>
            <div style="font-size:13px;color:var(--text2);margin-top:2px">${label||'—'}</div>
          </div>
          <span style="font-size:13px;background:var(--accent-dim);color:var(--accent);padding:2px 8px;border-radius:10px;font-family:monospace;flex-shrink:0;margin-right:8px">${v.file_no||'—'}</span>
        </div>`;
      }).join('');

    } catch(e) {
      dd.innerHTML = `<div style="padding:10px 14px;color:var(--red);font-size:12px">خطأ: ${e.message}</div>`;
    }
  }, 300);
}

export async function selectVinFromDropdown(vin) {
  closeVinDropdown();
  const inp = el('vinSearch');
  if (inp) inp.value = vin;
  await searchVin(vin);
}

// Close dropdown when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('.sidebar-search')) closeVinDropdown();
});

export async function searchVin(q) {
  if (!q || q.length < 3) {
    el('vin-card-overlay')?.remove();
    return;
  }
  try {
    const [vehicles, sales] = await Promise.all([
      apiGetAll('vehicles', {
        select: '*',
        system_type: `eq.${state.system}`,
        vin: `ilike.*${q}*`,
        limit: 5
      }),
      apiGetAll('sales', {
        select: 'vin,sale_price,sale_date,customer,inv_no',
        system_type: `eq.${state.system}`,
        vin: `ilike.*${q}*`
      })
    ]);

    el('vin-card-overlay')?.remove();

    if (!vehicles?.length) {
      toast('لم يُعثر على هذا الـ VIN', 'err');
      return;
    }

    const v    = vehicles[0];
    const sale = (sales||[]).find(s => s.vin === v.vin);
    const isSold = !!sale;
    const days = Math.floor((Date.now() - new Date(v.created_at||Date.now()).getTime()) / 864e5);

    const card = document.createElement('div');
    card.id = 'vin-card-overlay';
    card.style.cssText = `
      position:fixed;top:0;left:0;right:0;bottom:0;
      background:rgba(0,0,0,.5);z-index:9999;
      display:flex;align-items:center;justify-content:center;padding:20px
    `;
    card.onclick = e => { if(e.target===card) card.remove(); };

    card.innerHTML = `
      <div style="background:var(--card);border-radius:var(--radius);padding:0;max-width:480px;width:100%;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3);animation:fadeSlideIn .25s ease">

        <!-- Header -->
        <div style="background:${isSold?'var(--green)':'var(--purple)'};padding:16px 20px;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:13px;color:#ffffff99;margin-bottom:2px">${isSold?'✅ مباعة':'🏭 في المخزن'}</div>
            <div style="font-size:18px;font-weight:700;color:#fff;font-family:monospace">${v.vin||'—'}</div>
          </div>
          <button onclick="document.getElementById('vin-card-overlay').remove()"
            style="background:#ffffff22;border:none;color:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px;font-family:'Cairo',sans-serif">✕</button>
        </div>

        <!-- Body -->
        <div style="padding:20px">

          <!-- Vehicle info -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
            <div style="background:var(--card2);border-radius:var(--radius-sm);padding:10px">
              <div style="font-size:12px;color:var(--text2);margin-bottom:3px">الموديل</div>
              <div style="font-size:14px;font-weight:700">${v.model||v.make||'—'} ${v.year||''}</div>
            </div>
            <div style="background:var(--card2);border-radius:var(--radius-sm);padding:10px">
              <div style="font-size:12px;color:var(--text2);margin-bottom:3px">رقم الملف</div>
              <div style="font-size:14px;font-weight:700;color:var(--accent)">${v.file_no||'—'}</div>
            </div>
            <div style="background:var(--card2);border-radius:var(--radius-sm);padding:10px">
              <div style="font-size:12px;color:var(--text2);margin-bottom:3px">تكلفة الشراء</div>
              <div style="font-size:14px;font-weight:700;color:var(--blue);font-family:monospace">${fmt(v.purchase_price)}</div>
            </div>
            <div style="background:var(--card2);border-radius:var(--radius-sm);padding:10px">
              <div style="font-size:12px;color:var(--text2);margin-bottom:3px">${isSold?'سعر البيع':'في المخزن منذ'}</div>
              <div style="font-size:14px;font-weight:700;color:${isSold?'var(--green)':'var(--accent)'};font-family:monospace">
                ${isSold ? fmt(sale.sale_price) : days+' يوم'}
              </div>
            </div>
          </div>

          <!-- Sale info if sold -->
          ${isSold ? `
          <div style="background:var(--green-dim);border:1px solid var(--green);border-radius:var(--radius-sm);padding:12px;margin-bottom:16px">
            <div style="font-size:13px;font-weight:700;color:var(--green);margin-bottom:8px">تفاصيل البيع</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px">
              <div><span style="color:var(--text2)">العميل: </span><span style="font-weight:600">${sale.customer||'—'}</span></div>
              <div><span style="color:var(--text2)">تاريخ البيع: </span><span style="font-weight:600">${fmtDate(sale.sale_date)}</span></div>
              <div><span style="color:var(--text2)">رقم الفاتورة: </span><span style="font-family:monospace">${sale.inv_no||'—'}</span></div>
              <div><span style="color:var(--text2)">الربح: </span><span style="font-weight:700;color:${(+sale.sale_price-(+v.purchase_price||0))>=0?'var(--green)':'var(--red)'}">
                ${fmt((+sale.sale_price||0)-(+v.purchase_price||0))}
              </span></div>
            </div>
          </div>` : ''}

          <!-- Actions -->
          <div style="display:flex;gap:8px">
            <button onclick="document.getElementById('vin-card-overlay').remove();openViewer('${v.file_no}')"
              style="background:var(--accent);color:#fff;border:none;border-radius:8px;padding:8px 16px;cursor:pointer;font-size:12px;font-weight:700;font-family:'Cairo',sans-serif;flex:1">
              🔍 فتح الملف
            </button>
            <button onclick="document.getElementById('vin-card-overlay').remove()"
              style="background:var(--card2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:8px 16px;cursor:pointer;font-size:12px;font-family:'Cairo',sans-serif">
              إغلاق
            </button>
          </div>
        </div>
      </div>`;

    document.body.appendChild(card);
  } catch(e) { console.error('searchVin:', e); }
}

// ════════════════════════════════════════
// WINDOW BRIDGE — تعريض رموز الموديول للسكريبتات الكلاسيكية
// (مؤقت لحد ما باقي الملفات تتحول لـ ES Modules في Phase 2)
// ════════════════════════════════════════
Object.assign(window, {
  openAddVehicleModal, submitAddVehicle, populateFileDropdown, toggleModalSize,
  openQuickModal, loadQuickVins, loadQuickInvoices, onQuickCollectionInvChange,
  fillCollectionCustomer, loadQuickPartners, loadQuickReceivedBy, submitQuickSale,
  submitQuickCollection, submitQuickExpense, loadPaymentPOCard, submitQuickPayment,
  submitQuickPayout, closeVinDropdown, searchVinDropdown, selectVinFromDropdown, searchVin,
});
