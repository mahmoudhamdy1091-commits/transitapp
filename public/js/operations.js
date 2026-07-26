// ╔══════════════════════════════════════════════════════════╗
// ║  operations.js — OPEX · Approval Queue · Partner        ║
// ║               Account · Review · Warehouses             ║
// ║  Transit Management System — نقل حرفي، لا تعديل منطق   ║
// ╚══════════════════════════════════════════════════════════╝
// OPERATING EXPENSES (مصاريف تشغيلية)
// ════════════════════════════════════════

const OPEX_TYPES = ['رواتب','إيجارات','عمولات','نظافة','ضيافة','مصروفات حكومية','أخرى'];
const OPEX_COLORS = {
  'رواتب':'var(--blue)', 'إيجارات':'var(--purple)', 'عمولات':'var(--accent)',
  'نظافة':'var(--cyan)', 'ضيافة':'var(--green)', 'مصروفات حكومية':'var(--red)', 'أخرى':'var(--text2)'
};

export async function showOpex() {
  hideAllViews();
  el('opexView').style.display = 'block';
  el('topBarTitle').textContent = 'مصروفات تشغيلية';
  el('topBarSub').textContent   = `نظام ${state.system}`;
  if(el('opexSystemLabel')) el('opexSystemLabel').textContent = `نظام ${state.system}`;
  navActive('nav-opex');
  sessionStorage.setItem('tm_last_view','opex');
  setOpexPeriod('year');
}

export function setOpexPeriod(period) {
  document.querySelectorAll('[id^="opexperiod-"]').forEach(b => b.classList.remove('active'));
  el('opexperiod-' + period)?.classList.add('active');
  const customWrap = el('opexCustomDateWrap');

  if (period === 'custom') {
    customWrap.style.display = 'flex';
    return;
  }
  customWrap.style.display = 'none';

  // ✅ المصدر الموحّد: getPeriodDates (periods.js) — Phase 1
  const { from, to } = getPeriodDates(period);
  if (el('opex-filter-from')) el('opex-filter-from').value = from || '';
  if (el('opex-filter-to'))   el('opex-filter-to').value   = to   || '';
  loadOpex();
}

export async function loadOpex() {
  const wrap = el('opexTableBody');
  if (!wrap) return;
  setLoading('opexTableBody');

  const typeFilter = el('opex-filter-type')?.value || '';
  const fromFilter = el('opex-filter-from')?.value || '';
  const toFilter   = el('opex-filter-to')?.value   || '';

  try {
    const params = { select:'*', system_type:`eq.${state.system}`, order:'exp_date.desc' };
    if (typeFilter) params.exp_type = `eq.${typeFilter}`;
    if (fromFilter) params['exp_date'] = `gte.${fromFilter}`;
    if (toFilter)   params['exp_date_end'] = `lte.${toFilter}`;

    // Build URL manually for date range — يشمل null system_type (بيانات قديمة)
    const buildOpexUrl = (sysParam) => {
      let u = `${SB_URL}/rest/v1/operating_expenses?${sysParam}&order=exp_date.desc&select=*`;
      if (typeFilter) u += `&exp_type=eq.${encodeURIComponent(typeFilter)}`;
      if (fromFilter) u += `&exp_date=gte.${encodeURIComponent(fromFilter)}`;
      if (toFilter)   u += `&exp_date=lte.${encodeURIComponent(toFilter)}`;
      return u;
    };
    const [r1opex, r2opex] = await Promise.all([
      fetch(buildOpexUrl(`system_type=eq.${encodeURIComponent(state.system)}`), { headers: headers() }),
      fetch(buildOpexUrl('system_type=is.null'), { headers: headers() }),
    ]);
    const [d1opex, d2opex] = await Promise.all([r1opex.ok?r1opex.json():[], r2opex.ok?r2opex.json():[]]);
    const seenOpex = new Set();
    const data = [];
    [...(d1opex||[]),...(d2opex||[])].forEach(r => { const k=r.id??JSON.stringify(r); if(!seenOpex.has(k)){seenOpex.add(k);data.push(r);} });

    // KPIs
    renderOpexKpis(data);

    if (!data.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="e-icon">💼</div><p>لا توجد مصاريف تشغيلية</p><small>اضغط "إضافة مصروف" لتسجيل أول مصروف</small></div>`;
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>الرقم المرجعي</th><th>النوع</th><th>الوصف / البيان</th>
          <th>المستفيد</th><th>المبلغ</th><th>طريقة الدفع</th>
          <th>المستند</th><th>التاريخ</th><th>ملاحظات</th><th></th>
        </tr></thead>
        <tbody>
          ${data.map(r => `<tr>
            <td class="mono" style="font-size:13px;color:var(--purple);font-weight:700">${r.ref_no||'—'}</td>
            <td><span style="background:var(--purple-dim);color:var(--purple);padding:2px 10px;border-radius:20px;font-size:13px;font-weight:700;white-space:nowrap">${r.exp_type||'—'}</span></td>
            <td style="font-weight:600">${r.description||'—'}</td>
            <td style="color:var(--text2)">${r.beneficiary||'—'}</td>
            <td class="mono text-red" style="font-weight:700">${fmt(r.amount)}</td>
            <td>${r.pay_method||'—'}</td>
            <td class="mono">${r.document||'—'}</td>
            <td class="mono">${fmtDate(r.exp_date)}</td>
            <td style="color:var(--text2);font-size:12px">${r.notes||''}</td>
            <td style="text-align:center">
              <button class="btn-ctx-menu" onclick="event.stopPropagation();_ctxOpex(this)" data-id="${r.id}" title="إجراءات">⋮</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch(e) {
    wrap.innerHTML = `<div class="alert alert-err" style="margin:16px">⚠️ خطأ: ${e.message}</div>`;
  }
}

export function renderOpexKpis(data) {
  const kpis = el('opexKpis');
  if (!kpis) return;
  const total = data.reduce((s,r) => s + (+r.amount||0), 0);

  // Group by type
  const byType = {};
  data.forEach(r => {
    const t = r.exp_type || 'أخرى';
    byType[t] = (byType[t]||0) + (+r.amount||0);
  });

  const topType = Object.entries(byType).sort((a,b)=>b[1]-a[1])[0];

  kpis.innerHTML = `
    <div class="vkpi" style="border-right:3px solid var(--purple)">
      <div class="vkpi-label">إجمالي التشغيلية</div>
      <div class="vkpi-val" style="color:var(--purple)">${fmt(total)}</div>
      <div style="font-size:12px;color:var(--text2);margin-top:3px">${data.length} قيد</div>
    </div>
    ${Object.entries(byType).map(([type, amt]) => `
    <div class="vkpi" style="border-right:3px solid ${OPEX_COLORS[type]||'var(--text2)'}">
      <div class="vkpi-label">${type}</div>
      <div class="vkpi-val" style="color:${OPEX_COLORS[type]||'var(--text2)'}">${fmt(amt)}</div>
      <div style="font-size:12px;color:var(--text2);margin-top:3px">${((amt/total)*100).toFixed(0)}% من الإجمالي</div>
    </div>`).join('')}`;
}

export function onOpexTypeChange() {
  const type = el('opex-type').value;
  const wrap = el('opex-other-wrap');
  if (wrap) wrap.style.display = type === 'أخرى' ? 'block' : 'none';
}

export function openOpexModal() {
  el('opex-id').value          = '';
  el('opexModalTitle').textContent = 'إضافة مصروف تشغيلي';
  el('opex-type').value        = '';
  el('opex-desc').value        = '';
  el('opex-amount').value      = '';
  el('opex-date').value        = today();
  el('opex-method').value      = 'تحويل بنكي';
  el('opex-doc').value         = '';
  el('opex-beneficiary').value = '';
  el('opex-notes').value       = '';
  el('opexError').style.display = 'none';
  if(el('opex-other-wrap')) el('opex-other-wrap').style.display = 'none';
  el('opexSubmitBtn').textContent = '💾 حفظ';
  el('opexSubmitBtn').onclick = submitOpex;
  openModal('opexModal');
}

export async function openEditOpexModal(id) {
  try {
    const data = await apiGet('operating_expenses', { select:'*', id:`eq.${id}` });
    const r = data?.[0];
    if (!r) { toast('لم يُعثر على البيانات','err'); return; }
    el('opex-id').value          = r.id;
    el('opexModalTitle').textContent = 'تعديل مصروف تشغيلي';
    el('opex-type').value        = OPEX_TYPES.includes(r.exp_type) ? r.exp_type : 'أخرى';
    el('opex-desc').value        = r.description   || '';
    el('opex-amount').value      = r.amount        || '';
    el('opex-date').value        = r.exp_date      || '';
    el('opex-method').value      = r.pay_method    || 'تحويل بنكي';
    el('opex-doc').value         = r.document      || '';
    el('opex-beneficiary').value = r.beneficiary   || '';
    el('opex-notes').value       = r.notes         || '';
    el('opexError').style.display = 'none';
    if (!OPEX_TYPES.includes(r.exp_type) || r.exp_type === 'أخرى') {
      if(el('opex-other-wrap'))  el('opex-other-wrap').style.display  = 'block';
      if(el('opex-other-label')) el('opex-other-label').value = r.exp_type !== 'أخرى' ? r.exp_type : '';
    } else {
      if(el('opex-other-wrap')) el('opex-other-wrap').style.display = 'none';
    }
    el('opexSubmitBtn').textContent = '💾 حفظ التعديل';
    el('opexSubmitBtn').onclick = submitEditOpex;
    openModal('opexModal');
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

export async function submitOpex() {
  const type        = el('opex-type').value;
  const otherLabel  = el('opex-other-label')?.value?.trim() || '';
  const finalType   = type === 'أخرى' ? (otherLabel || 'أخرى') : type;
  const desc        = el('opex-desc').value.trim();
  const amount      = parseFloat(el('opex-amount').value);
  const date        = el('opex-date').value;
  const method      = el('opex-method').value;
  const doc         = el('opex-doc').value.trim();
  const beneficiary = el('opex-beneficiary').value.trim();
  const notes       = el('opex-notes').value.trim();

  if (!finalType || !desc || !amount || !date) {
    showFieldErr('opexError','يرجى ملء الحقول المطلوبة: النوع، الوصف، المبلغ، التاريخ');
    return;
  }

  try {
    const refNo = await genSeqRef('OPEX', state.system, null, 'operating_expenses') || `OPEX-${state.system}-${Date.now()}`;
    const payload = {
      system_type: state.system, ref_no: refNo,
      exp_type: finalType, description: desc, amount,
      exp_date: date, pay_method: method,
      document: doc||null, beneficiary: beneficiary||null, notes: notes||null
    };
    const ins = await apiPost('operating_expenses', payload);
    const newId = ins?.[0]?.id || null;
    // قيد محاسبي مزدوج للمصروف التشغيلي
    // ✅ ذرّياً: لو فشل القيد نتراجع عن حفظ المصروف حتى لا يبقى سجل بلا قيد (المشكلة السابقة)
    try {
      await je_opex({ sys:state.system, date, amount, expType:finalType, desc, method, refNo });
    } catch(jeErr) {
      if (newId) { try { await apiDelete('operating_expenses', { id:`eq.${newId}` }); } catch(_){} }
      showFieldErr('opexError', `⚠️ فشل إنشاء القيد المحاسبي — لم يُحفظ المصروف: ${jeErr.message}`);
      return;
    }
    await logAudit('INSERT','operating_expenses', null, null, payload);
    markSaving('opexModal'); closeModal('opexModal');
    invalidateCache();
    toast('✅ تم تسجيل المصروف التشغيلي وقيده','ok');
    await loadOpex();
  } catch(e) { showFieldErr('opexError','خطأ: '+e.message); }
}

export async function submitEditOpex() {
  const id          = el('opex-id').value;
  const type        = el('opex-type').value;
  const otherLabel  = el('opex-other-label')?.value?.trim() || '';
  const finalType   = type === 'أخرى' ? (otherLabel || 'أخرى') : type;
  const desc        = el('opex-desc').value.trim();
  const amount      = parseFloat(el('opex-amount').value);
  const date        = el('opex-date').value;
  const method      = el('opex-method').value;
  const doc         = el('opex-doc').value.trim();
  const beneficiary = el('opex-beneficiary').value.trim();
  const notes       = el('opex-notes').value.trim();

  if (!finalType || !desc || !amount || !date) {
    showFieldErr('opexError','يرجى ملء الحقول المطلوبة');
    return;
  }
  try {
    // ── 1. جلب السجل القديم لمعرفة المبلغ القديم ──
    const oldRows = await apiGet('operating_expenses', { select:'*', id:`eq.${id}` });
    const old = oldRows?.[0];

    // 1. تحديث السجل
    // ✅ جدول operating_expenses بلا عمود post_status (لا دورة اعتماد) — لا نضبطه هنا
    //    (كان يسبب فشل التعديل: "column post_status does not exist")
    await apiPatch('operating_expenses', { id:`eq.${id}` }, {
      exp_type: finalType, description: desc, amount,
      exp_date: date, pay_method: method,
      document: doc||null, beneficiary: beneficiary||null, notes: notes||null,
    });

    // 2. تحديث القيد في مكانه (المبلغ + التاريخ)
    await updateJEInPlace({
      sys: state.system, fileNo: old?.file_no || null,
      refTable: 'operating_expenses', refId: id,
      oldAmount: +old?.amount||0, newAmount: amount,
      newDate: date,   // ✅ مزامنة تاريخ القيد مع تاريخ المصروف التشغيلي الجديد
    });

    // ✅ سجّل تعديل المصروف التشغيلي (كان غير مسجَّل — فجوة تتبّع)
    await logAudit('EDIT', 'operating_expenses', old?.file_no || null, old || null, { exp_type:finalType, description:desc, amount, exp_date:date, pay_method:method }, `تعديل مصروف تشغيلي ${old?.ref_no||id}`);
    markSaving('opexModal'); closeModal('opexModal');
    toast('✅ تم تعديل المصروف التشغيلي وقيده','ok');
    await loadOpex();
  } catch(e) { showFieldErr('opexError','خطأ: '+e.message); }
}

export async function deleteOpex(id) {
  showConfirm('حذف مصروف تشغيلي', 'سيتم حذف هذا المصروف وعكس قيده المحاسبي. لا يمكن التراجع.', async () => {
    try {
      const rows = await apiGetAll('operating_expenses', { select:'*', system_type:`eq.${state.system}`, id:`eq.${id}` });
      const o = rows?.[0];
      if (!o) { toast('لم يُعثر على المصروف','err'); return; }
      if (o.post_status === 'voided') { toast('⚠️ هذا المصروف مُلغى مسبقاً','warn'); return; }

      // ✅ عكس القيد المحاسبي الأصلي (Dr eAcc / Cr cashAcc → عكسه)
      const amount = +o.amount || 0;
      // ✅ حارس: لو فيه قيد مصروف تشغيلي مُرحَّل فعلاً بنفس ref_no (je_opex يمرر
      // ref_no كـ refId) لكن amount قرأت صفر/غير صالحة — ميصحش نحذف السجل بصمت
      // من غير عكس قيده، يبقى فيه قيد يتيم بلا مصدر بعد الحذف (والحذف نهائي).
      if (amount <= 0 && o.ref_no) {
        const existingOpexJE = await apiGet('journal_entries', {
          select:'id', system_type:`eq.${state.system}`, ref_table:'eq.operating_expenses', ref_id:`eq.${o.ref_no}`, post_status:'eq.posted', limit:1,
        });
        if (existingOpexJE?.length) {
          throw new Error('يوجد قيد مصروف تشغيلي مُرحَّل لهذا السجل لكن قيمته الحالية صفر/غير صالحة — لا يمكن الحذف بأمان بدون عكس القيد، راجعي البيانات أولاً');
        }
      }
      if (amount > 0) {
        const eAcc    = OPEX_ACC_MAP[o.exp_type] || '6700';
        const cashAcc = o.pay_method === 'نقد' ? '1110' : '1120';
        const cashNm  = o.pay_method === 'نقد' ? 'النقد' : 'البنك';
        await postDoubleEntry({
          sys: state.system, date: today(), fileNo: null,
          refTable: 'reversal', refId: o.id,
          desc: `عكس مصروف تشغيلي ${o.ref_no||''} — ${o.description||o.exp_type||''}`,
          lines: [
            { acc: cashAcc, name: cashNm,                                 dr: amount, cr: 0,      contact: null },
            { acc: eAcc,    name: `مصروف تشغيلي — ${o.exp_type||'أخرى'}`, dr: 0,      cr: amount, contact: null },
          ],
        });
      }
      // ✅ operating_expenses بلا عمود post_status — لا يمكن وضع voided (كان يسبب فشل الحذف).
      //    نحذف السجل فعلياً؛ القيد العكسي يبقى في اليومية كأثر تدقيق كامل.
      await apiDelete('operating_expenses', { id:`eq.${id}` });
      await logAudit('DELETE','operating_expenses', null, o, { deleted_at: today() }, `حذف مصروف تشغيلي بقيد عكسي ${o.ref_no||''}`);
      invalidateCache();
      toast('✅ تم حذف المصروف بقيد عكسي','ok');
      await loadOpex();
    } catch(e) { toast('خطأ: '+e.message,'err'); }
  });
}

export function exportOpexExcel() {
  const rows = document.querySelectorAll('#opexTableBody table tbody tr');
  if (!rows.length) { toast('لا توجد بيانات للتصدير','err'); return; }
  const data = [['الرقم','النوع','الوصف','المستفيد','المبلغ','طريقة الدفع','المستند','التاريخ','ملاحظات']];
  rows.forEach(tr => {
    const cells = tr.querySelectorAll('td');
    data.push([
      cells[0]?.textContent?.trim()||'',
      cells[1]?.textContent?.trim()||'',
      cells[2]?.textContent?.trim()||'',
      cells[3]?.textContent?.trim()||'',
      cells[4]?.textContent?.trim()||'',
      cells[5]?.textContent?.trim()||'',
      cells[6]?.textContent?.trim()||'',
      cells[7]?.textContent?.trim()||'',
      cells[8]?.textContent?.trim()||'',
    ]);
  });
  exportToExcel([{ name:'المصاريف التشغيلية', data }], `OPEX_${state.system}_${today()}`);
}

// ── Inject opex into Journal ──
// Called from loadJournal — adds operating_expenses to journal entries
export async function fetchOpexForJournal(from, to, sys) {
  try {
    const [r1, r2] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/operating_expenses?system_type=eq.${encodeURIComponent(sys)}&exp_date=gte.${encodeURIComponent(from)}&exp_date=lte.${encodeURIComponent(to)}&order=exp_date.desc&select=*`, { headers: headers() }),
      fetch(`${SB_URL}/rest/v1/operating_expenses?system_type=is.null&exp_date=gte.${encodeURIComponent(from)}&exp_date=lte.${encodeURIComponent(to)}&order=exp_date.desc&select=*`, { headers: headers() }),
    ]);
    const [d1, d2] = await Promise.all([r1.ok?r1.json():[], r2.ok?r2.json():[]]);
    const seen = new Set(); const out = [];
    [...(d1||[]),...(d2||[])].forEach(r => { const k=r.id??JSON.stringify(r); if(!seen.has(k)){seen.add(k);out.push(r);} });
    return out;
  } catch(e) { return []; }
}

// ── Opex in Reports ──
export async function loadOpexReport(from, to) {
  const wrap = el('reportTable');
  const kpis = el('reportKpis');
  if (!wrap) return;
  wrap.innerHTML = `<div class="loading"><div class="spinner"></div><br>جاري التحميل...</div>`;

  try {
    const makeOpexUrl = (sysParam) => {
      let u = `${SB_URL}/rest/v1/operating_expenses?${sysParam}&select=*&order=exp_date.desc`;
      if (from) u += `&exp_date=gte.${encodeURIComponent(from)}`;
      if (to)   u += `&exp_date=lte.${encodeURIComponent(to)}`;
      return u;
    };
    const [ro1, ro2] = await Promise.all([
      fetch(makeOpexUrl(`system_type=eq.${encodeURIComponent(state.system)}`), { headers: headers() }),
      fetch(makeOpexUrl('system_type=is.null'), { headers: headers() }),
    ]);
    const [do1, do2] = await Promise.all([ro1.ok?ro1.json():[], ro2.ok?ro2.json():[]]);
    const seenO = new Set(); const data = [];
    [...(do1||[]),...(do2||[])].forEach(r => { const k=r.id??JSON.stringify(r); if(!seenO.has(k)){seenO.add(k);data.push(r);} });

    const total = data.reduce((s,r) => s + (+r.amount||0), 0);
    const byType = {};
    data.forEach(r => { const t=r.exp_type||'أخرى'; byType[t]=(byType[t]||0)+(+r.amount||0); });

    kpis.innerHTML = `
      <div class="vkpi" style="border-right:3px solid var(--purple)">
        <div class="vkpi-label">الإجمالي</div>
        <div class="vkpi-val" style="color:var(--purple)">${fmt(total)}</div>
      </div>
      ${Object.entries(byType).map(([t,v])=>`
      <div class="vkpi" style="border-right:3px solid ${OPEX_COLORS[t]||'var(--text2)'}">
        <div class="vkpi-label">${t}</div>
        <div class="vkpi-val">${fmt(v)}</div>
      </div>`).join('')}`;

    if (!data.length) { wrap.innerHTML = `<div class="empty-state"><div class="e-icon">💼</div><p>لا توجد مصاريف في هذه الفترة</p></div>`; return; }

    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>الرقم</th><th>النوع</th><th>الوصف</th><th>المستفيد</th>
          <th>المبلغ</th><th>طريقة الدفع</th><th>التاريخ</th>
        </tr></thead>
        <tbody>
          ${data.map(r=>`<tr>
            <td class="mono" style="font-size:13px;color:var(--purple)">${r.ref_no||'—'}</td>
            <td><span style="background:var(--purple-dim);color:var(--purple);padding:2px 8px;border-radius:20px;font-size:13px;font-weight:700">${r.exp_type||'—'}</span></td>
            <td>${r.description||'—'}</td>
            <td style="color:var(--text2)">${r.beneficiary||'—'}</td>
            <td class="mono text-red">${fmt(r.amount)}</td>
            <td>${r.pay_method||'—'}</td>
            <td class="mono">${fmtDate(r.exp_date)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch(e) { wrap.innerHTML = errHTML(e.message); }
}

// ════════════════════════════════════════
// DRILL-DOWN — كل KPI بيفتح تفاصيله
// ════════════════════════════════════════
export let _ddState = { type: null, data: {} };

export function closeDrillDownMain() {
  if(el('dash-details-area')) el('dash-details-area').style.display = 'none';
  _ddState.type = null;
  document.querySelectorAll('.kpi-card').forEach(c => c.classList.remove('kpi-active'));
}

export function closeDrillDown() {
  if(el('dash-drilldown')) el('dash-drilldown').style.display = 'none';
  if(el('dash-details-area')) el('dash-details-area').style.display = 'none';
  document.querySelectorAll('.kpi-clickable').forEach(c => c.classList.remove('dd-active'));
  _ddState.type = null;
}


export function toggleDrillDown(type) {
  document.querySelectorAll('.kpi-card').forEach(c => c.classList.remove('kpi-active'));
  const activeCard = el('kpi-card-' + type);
  if(activeCard && _ddState.type !== type) activeCard.classList.add('kpi-active');
  if (_ddState.type === type) { closeDrillDownMain(); return; }
  _ddState.type = type;
  document.querySelectorAll('.kpi-clickable').forEach(c => c.classList.remove('dd-active'));
  el('kpi-card-' + type)?.classList.add('dd-active');
  renderDrillDown(type);
  // أظهر في المنطقة الجديدة
  if(el('dash-details-area')) {
    el('dash-details-area').style.display = 'block';
    el('dash-details-area').scrollIntoView({ behavior:'smooth', block:'nearest' });
  }
  if(el('dash-drilldown')) el('dash-drilldown').style.display = 'none';
}

export function renderDrillDown(type) {
  const d = _ddState.data;
  const panel = el('dash-details-area') || el('dash-drilldown');
  const ddKpis = el('dd-kpis-main')||el('dd-kpis');
  const ddTable = el('dd-table-main')||el('dd-table');
  const ddChartWrap = el('dd-chart-wrap-main')||el('dd-chart-wrap');
  if (!panel) return;

  const periodLabel = el('dash-period-label')?.textContent || '';

  // ── تكلفة الشراء ──
  if (type === 'purchase') {
    (el('dd-title-main')||el('dd-title')).textContent = `📋 تفاصيل تكلفة الشراء — ${periodLabel}`;
    const deals = (d.periodPurchaseDeals && d.periodPurchaseDeals.length) ? d.periodPurchaseDeals : (d.periodDeals || []);
    const total = deals.reduce((s,d2)=>s+(+d2.total_purchase||0),0);
    const bySupplier = {};
    deals.forEach(d2=>{ bySupplier[d2.supplier||'غير محدد']=(bySupplier[d2.supplier||'غير محدد']||0)+(+d2.total_purchase||0); });
    ddKpis.style.gridTemplateColumns = 'repeat(3,1fr)';
    ddKpis.innerHTML = `
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--blue)">${fmt(total)}</div><div class="dd-kpi-lbl">إجمالي الشراء</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val">${deals.length}</div><div class="dd-kpi-lbl">عدد الصفقات</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val">${deals.reduce((s,d2)=>s+(+d2.vehicle_count||0),0)}</div><div class="dd-kpi-lbl">عدد السيارات</div></div>`;
    renderDDChart(Object.entries(bySupplier).sort((a,b)=>b[1]-a[1]), 'var(--blue)');
    ddTable.innerHTML = deals.length ? `
      <table class="data-table"><thead><tr>
        <th>رقم الملف</th><th>المورد</th><th>تاريخ PO</th><th>السيارات</th><th>تكلفة الشراء</th><th>الحالة</th>
      </tr></thead><tbody>
      ${deals.map(d2=>`<tr onclick="openViewer('${d2.file_no}')" style="cursor:pointer">
        <td class="mono text-amber" style="font-weight:700">${d2.file_no}</td>
        <td>${d2.supplier||'—'}</td>
        <td class="mono"><span class="ltr-num">${fmtDate(d2.po_date)}</span></td>
        <td style="text-align:center">${d2.vehicle_count||0}</td>
        <td class="mono text-blue" style="font-weight:700">${fmt(d2.total_purchase)}</td>
        <td><span class="badge badge-${statusClass(d2.status)}">${d2.status}</span></td>
      </tr>`).join('')}
      </tbody></table>` : emptyHTML('📋','لا توجد صفقات في هذه الفترة');
  }

  // ── مبيعات ── مجمّعة بالفاتورة
  else if (type === 'sales') {
    (el('dd-title-main')||el('dd-title')).textContent = `💹 تفاصيل المبيعات — ${periodLabel}`;
    const sales = d.periodSales || [];
    const total = sales.reduce((s,r)=>s+(+r.sale_price||0),0);

    // تجميع بالفاتورة (inv_no + file_no)
    const invMap = {};
    sales.forEach(r => {
      const key = (r.file_no||'') + '||' + (r.inv_no||'');
      if (!invMap[key]) invMap[key] = { file_no:r.file_no, inv_no:r.inv_no, customer:r.customer, sale_date:r.sale_date, total:0, vins:[] };
      invMap[key].total    += +r.sale_price || 0;
      invMap[key].vins.push(r.vin||'');
    });
    const invoices = Object.values(invMap).sort((a,b)=>(b.sale_date||'').localeCompare(a.sale_date||''));
    const byFile = {};
    invoices.forEach(r => { byFile[r.file_no]=(byFile[r.file_no]||0)+r.total; });

    ddKpis.style.gridTemplateColumns = 'repeat(3,1fr)';
    ddKpis.innerHTML = `
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--green)">${fmt(total)}</div><div class="dd-kpi-lbl">إجمالي المبيعات</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val">${invoices.length}</div><div class="dd-kpi-lbl">عدد الفواتير</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val">${Object.keys(byFile).length}</div><div class="dd-kpi-lbl">عدد الملفات</div></div>`;
    renderDDChart(Object.entries(byFile).sort((a,b)=>b[1]-a[1]), 'var(--green)');
    ddTable.innerHTML = invoices.length ? `
      <table class="data-table"><thead><tr>
        <th>التاريخ</th><th>رقم الفاتورة</th><th>الملف</th><th>العميل</th><th>السيارات</th><th>إجمالي الفاتورة</th>
      </tr></thead><tbody>
      ${invoices.map(r=>`<tr onclick="openViewer('${r.file_no}')" style="cursor:pointer" title="اضغط لفتح الملف">
        <td class="mono">${fmtDate(r.sale_date)}</td>
        <td class="mono text-blue" style="font-weight:700">${r.inv_no||'—'}</td>
        <td class="mono text-amber" style="font-weight:700">${r.file_no||'—'}</td>
        <td>${r.customer||'—'}</td>
        <td style="text-align:center;color:var(--text2)">${r.vins.filter(Boolean).length} سيارة</td>
        <td class="mono text-green" style="font-weight:700">${fmt(r.total)}</td>
      </tr>`).join('')}
      </tbody></table>` : emptyHTML('💹','لا توجد مبيعات في هذه الفترة');
  }

  // ── تحصيلات ──
  else if (type === 'collections') {
    (el('dd-title-main')||el('dd-title')).textContent = `💰 تفاصيل التحصيلات — ${periodLabel}`;
    const colls = d.periodCollections || [];
    const paid   = colls.filter(c=>c.paid_date).reduce((s,c)=>s+(+c.amount||0),0);
    const unpaid = colls.filter(c=>!c.paid_date).reduce((s,c)=>s+(+c.amount||0),0);
    const overdue= colls.filter(c=>!c.paid_date && (c.due_date ? c.due_date <= d.todayStr : true)).length;
    ddKpis.style.gridTemplateColumns = 'repeat(4,1fr)';
    ddKpis.innerHTML = `
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--blue)">${fmt(paid+unpaid)}</div><div class="dd-kpi-lbl">إجمالي التحصيلات</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--green)">${fmt(paid)}</div><div class="dd-kpi-lbl">تم تحصيله</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--accent)">${fmt(unpaid)}</div><div class="dd-kpi-lbl">لم يُحصَّل</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--red)">${overdue}</div><div class="dd-kpi-lbl">متأخر</div></div>`;
    // chart by customer
    const byCustomer = {};
    colls.forEach(c=>{ byCustomer[c.customer||'غير محدد']=(byCustomer[c.customer||'غير محدد']||0)+(+c.amount||0); });
    renderDDChart(Object.entries(byCustomer).sort((a,b)=>b[1]-a[1]).slice(0,8), 'var(--blue)');
    ddTable.innerHTML = colls.length ? `
      <table class="data-table"><thead><tr>
        <th>الاستحقاق</th><th>تاريخ الدفع</th><th>الملف</th><th>رقم الفاتورة</th><th>العميل</th><th>المبلغ</th><th>الحالة</th>
      </tr></thead><tbody>
      ${colls.map(c=>{
        const isOverdue = !c.paid_date && c.due_date && c.due_date < d.todayStr;
        return `<tr onclick="openViewer('${c.file_no||''}')" style="cursor:pointer">
          <td class="mono">${fmtDate(c.due_date)}</td>
          <td class="mono" style="color:${c.paid_date?'var(--green)':'var(--text2)'}">${c.paid_date?fmtDate(c.paid_date):'—'}</td>
          <td class="mono text-amber">${c.file_no||'—'}</td>
          <td class="mono">${c.inv_no||'—'}</td>
          <td>${c.customer||'—'}</td>
          <td class="mono" style="font-weight:700;color:var(--blue)">${fmt(c.amount)}</td>
          <td><span style="background:${c.paid_date?'var(--green-dim)':isOverdue?'var(--red-dim)':'var(--accent-dim)'};color:${c.paid_date?'var(--green)':isOverdue?'var(--red)':'var(--accent)'};padding:2px 8px;border-radius:10px;font-size:12px;font-weight:700">
            ${c.paid_date?'✓ مُحصَّل':isOverdue?'متأخر':'معلق'}</span></td>
        </tr>`;
      }).join('')}
      </tbody></table>` : emptyHTML('💰','لا توجد تحصيلات في هذه الفترة');
  }

  // ── مصاريف ──
  else if (type === 'expenses') {
    (el('dd-title-main')||el('dd-title')).textContent = `💸 تفاصيل المصاريف — ${periodLabel}`;
    const exps = d.periodExp || [];
    const total = exps.reduce((s,e)=>s+(+e.amount||0),0);
    const byType = {};
    exps.forEach(e=>{byType[e.exp_type||'أخرى']=(byType[e.exp_type||'أخرى']||0)+(+e.amount||0);});
    ddKpis.style.gridTemplateColumns = `repeat(${Math.min(Object.keys(byType).length+1,5)},1fr)`;
    ddKpis.innerHTML = `<div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--red)">${fmt(total)}</div><div class="dd-kpi-lbl">إجمالي المصاريف</div></div>`
      + Object.entries(byType).sort((a,b)=>b[1]-a[1]).map(([t,v])=>
        `<div class="dd-kpi"><div class="dd-kpi-val">${fmt(v)}</div><div class="dd-kpi-lbl">${t}</div></div>`).join('');
    renderDDChart(Object.entries(byType).sort((a,b)=>b[1]-a[1]), 'var(--red)');
    ddTable.innerHTML = exps.length ? `
      <table class="data-table"><thead><tr>
        <th>التاريخ</th><th>الملف</th><th>الوصف</th><th>النوع</th><th>طريقة الدفع</th><th>المبلغ</th>
      </tr></thead><tbody>
      ${exps.map(e=>`<tr onclick="${e.file_no?`openViewer('${e.file_no}')`:'void(0)'}" style="cursor:${e.file_no?'pointer':'default'}">
        <td class="mono">${fmtDate(e.exp_date||e.expense_date)}</td>
        <td class="mono text-amber">${e.file_no||'—'}</td>
        <td>${e.description||'—'}</td>
        <td><span style="background:var(--red-dim);color:var(--red);padding:2px 8px;border-radius:10px;font-size:12px">${e.exp_type||'—'}</span></td>
        <td>${e.pay_method||'—'}</td>
        <td class="mono text-red" style="font-weight:700">${fmt(e.amount)}</td>
      </tr>`).join('')}
      </tbody></table>` : emptyHTML('💸','لا توجد مصاريف في هذه الفترة');
  }

  // ── التكلفة الكاملة ──
  else if (type === 'fullcost') {
    (el('dd-title-main')||el('dd-title')).textContent = `🏷️ التكلفة الكاملة — ${periodLabel}`;
    const deals  = d.periodPurchaseDeals  || [];
    const totPur = deals.reduce((s,d2)=>s+(+d2.total_purchase||0),0);
    const totExp = (d.periodExp||[]).filter(e=>e.file_no).reduce((s,e)=>s+(+e.amount||0),0);
    ddKpis.style.gridTemplateColumns = 'repeat(3,1fr)';
    ddKpis.innerHTML = `
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--blue)">${fmt(totPur)}</div><div class="dd-kpi-lbl">تكلفة الشراء</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--red)">${fmt(totExp)}</div><div class="dd-kpi-lbl">مصاريف الصفقات</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--accent)">${fmt(totPur+totExp)}</div><div class="dd-kpi-lbl">التكلفة الكاملة</div></div>`;
    const byFile = {};
    deals.forEach(d2=>{
      const fe = (d.periodExp||[]).filter(e=>e.file_no===d2.file_no).reduce((s,e)=>s+(+e.amount||0),0);
      byFile[d2.file_no]=(+d2.total_purchase||0)+fe;
    });
    renderDDChart(Object.entries(byFile).sort((a,b)=>b[1]-a[1]), 'var(--accent)');
    ddTable.innerHTML = deals.length ? `
      <table class="data-table"><thead><tr>
        <th>الملف</th><th>المورد</th><th>تكلفة الشراء</th><th>المصاريف</th><th>التكلفة الكاملة</th><th>الحالة</th>
      </tr></thead><tbody>
      ${deals.map(d2=>{
        const fe=(d.periodExp||[]).filter(e=>e.file_no===d2.file_no).reduce((s,e)=>s+(+e.amount||0),0);
        const fc=(+d2.total_purchase||0)+fe;
        return `<tr onclick="openViewer('${d2.file_no}')" style="cursor:pointer">
          <td class="mono text-amber" style="font-weight:700">${d2.file_no}</td>
          <td>${d2.supplier||'—'}</td>
          <td class="mono text-blue">${fmt(d2.total_purchase)}</td>
          <td class="mono text-red">${fmt(fe)}</td>
          <td class="mono" style="font-weight:700;color:var(--accent)">${fmt(fc)}</td>
          <td><span class="badge badge-${statusClass(d2.status)}">${d2.status}</span></td>
        </tr>`;
      }).join('')}
      </tbody></table>` : emptyHTML('🏷️','لا توجد صفقات في هذه الفترة');
  }

  // ── صافي الربح ──
  else if (type === 'profit') {
    (el('dd-title-main')||el('dd-title')).textContent = `📈 نتائج العمليات — ${periodLabel}`;
    const sales   = d.periodSales  || [];
    const deals   = d.periodDeals  || [];
    // الإجماليات من computeFinancials (نفس الكارد — SSOT)
    const fin    = d.fin || {};
    const totS   = fin.totSales   || 0;
    const profit = fin.netProfit  || 0;
    const totC   = fin.totCOGS + fin.totDealExp || 0;
    const margin = totS>0?((profit/totS)*100).toFixed(1):0;
    // ربح كل صفقة — من _profit (قيود اليومية، COGS المباع فقط)
    const fileNos  = [...new Set(sales.map(s=>s.file_no))];
    const fileData = fileNos.map(fn=>{
      const fd  = deals.find(d2=>d2.file_no===fn);
      const fs  = +fd?._totalSale || sales.filter(s=>s.file_no===fn).reduce((s,r)=>s+(+r.sale_price||0),0);
      const pf  = fd?._profit != null ? +fd._profit : 0;
      return {fn, sales:fs, cost:fs-pf, profit:pf};
    });
    ddKpis.style.gridTemplateColumns = 'repeat(4,1fr)';
    ddKpis.innerHTML = `
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--green)">${fmt(totS)}</div><div class="dd-kpi-lbl">المبيعات</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--blue)">${fmt(totC)}</div><div class="dd-kpi-lbl">تكلفة المبيعات</div></div>
      <div class="dd-kpi" style="background:${profit>=0?'var(--green-dim)':'var(--red-dim)'}"><div class="dd-kpi-val" style="color:${profit>=0?'var(--green)':'var(--red)'}">${profit>=0?'+':''}${fmt(profit)}</div><div class="dd-kpi-lbl">صافي الربح</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:${profit>=0?'var(--green)':'var(--red)'}">${margin}%</div><div class="dd-kpi-lbl">هامش الربح</div></div>`;
    renderDDChart(fileData.sort((a,b)=>b.profit-a.profit).map(f=>[f.fn, f.profit]), profit>=0?'var(--accent)':'var(--red)');
    ddTable.innerHTML = fileData.length ? `
      <table class="data-table"><thead><tr>
        <th>الملف</th><th>المبيعات</th><th>تكلفة المبيعات</th><th>الربح / الخسارة</th><th>الهامش</th>
      </tr></thead><tbody>
      ${fileData.sort((a,b)=>b.profit-a.profit).map(f=>`<tr onclick="openViewer('${f.fn}')" style="cursor:pointer">
        <td class="mono text-amber" style="font-weight:700">${f.fn}</td>
        <td class="mono text-green">${fmt(f.sales)}</td>
        <td class="mono">${fmt(f.cost)}</td>
        <td class="mono" style="font-weight:700;color:${f.profit>=0?'var(--green)':'var(--red)'}">${f.profit>=0?'+':''}${fmt(f.profit)}</td>
        <td style="color:${f.profit>=0?'var(--green)':'var(--red)'}">${f.sales>0?((f.profit/f.sales)*100).toFixed(1)+'%':'—'}</td>
      </tr>`).join('')}
      </tbody></table>` : emptyHTML('📈','لا توجد بيانات');
  }

  // ── المخزن ──
  else if (type === 'stock') {
    (el('dd-title-main')||el('dd-title')).textContent = `🚗 تفاصيل المخزن`;
    const stock = d.stockVehicles || [];
    const old60 = stock.filter(v=>daysSince(v.created_at)>60).length;
    const old30 = stock.filter(v=>daysSince(v.created_at)>30&&daysSince(v.created_at)<=60).length;
    ddKpis.style.gridTemplateColumns = 'repeat(4,1fr)';
    ddKpis.innerHTML = `
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--purple)">${stock.length}</div><div class="dd-kpi-lbl">إجمالي المخزن</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--green)">${stock.length-old30-old60}</div><div class="dd-kpi-lbl">أقل من 30 يوم</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--accent)">${old30}</div><div class="dd-kpi-lbl">30-60 يوم</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--red)">${old60}</div><div class="dd-kpi-lbl">أكثر من 60 يوم</div></div>`;
    ddChartWrap.style.display = 'none';
    ddTable.innerHTML = stock.length ? `
      <table class="data-table"><thead><tr>
        <th>الملف</th><th>الموديل</th><th>رقم الشاصي</th><th>تكلفة الشراء</th><th>أيام في المخزن</th><th>الحالة</th>
      </tr></thead><tbody>
      ${stock.sort((a,b)=>daysSince(b.created_at)-daysSince(a.created_at)).map(v=>{
        const days=daysSince(v.created_at);
        const color=days>60?'var(--red)':days>30?'var(--accent)':'var(--green)';
        const bg=days>60?'var(--red-dim)':days>30?'var(--accent-dim)':'var(--green-dim)';
        return `<tr onclick="openViewer('${v.file_no}')" style="cursor:pointer">
          <td class="mono text-amber">${v.file_no||'—'}</td>
          <td style="font-weight:600">${v.model||v.make||'—'} ${v.year||''}</td>
          <td class="mono" style="font-size:13px">${v.vin||'—'}</td>
          <td class="mono">${fmt(v.purchase_price)}</td>
          <td><span style="background:${bg};color:${color};padding:2px 8px;border-radius:10px;font-size:12px;font-weight:700">${days} يوم</span></td>
          <td><span style="font-size:12px;color:${color}">${days>60?'⚠️ راكدة':days>30?'تنبه':'جيدة'}</span></td>
        </tr>`;
      }).join('')}
      </tbody></table>` : emptyHTML('🚗','المخزن فارغ');

  }
  // ── تحصيلات مستحقة من العملاء (تفصيلي) ──
  // ✅ المصدر: d.allCollections — تُبنى في dashboard.js عبر buildCollectionsWithVirtualDue()
  // وتشمل الآن أي فاتورة بيع بلا أي سطر تحصيل إطلاقاً (تُحسب مستحقة بالكامل)
  // الإجمالي = collections.amount (شامل extra charges)
  // المحصّل  = sum(amount) where paid_date IS NOT NULL
  // الباقي   = sum(amount) where paid_date IS NULL
  else if (type === 'overdue_collections') {
    (el('dd-title-main')||el('dd-title')).textContent = 'تحصيلات مستحقة من العملاء';
    const allCols = (d.allCollections || []).filter(c => isPosted(c) && c.post_status !== 'voided');

    // تجميع بالفاتورة (inv_no)
    const invMap = {};
    allCols.forEach(c => {
      const key = c.inv_no || `col-${c.id}`;
      if (!invMap[key]) invMap[key] = {
        inv_no:    c.inv_no   || '—',
        file_no:   c.file_no  || '—',
        customer:  c.customer || '—',
        due_date:  c.due_date || '',
        total:     0,  // إجمالي الفاتورة من collections
        collected: 0,  // المدفوع فعلاً
        pending:   0,  // المستحق
        carCount:  0,
      };
      const inv = invMap[key];
      inv.total += +c.amount || 0;
      if (c.paid_date) {
        inv.collected += +c.amount || 0;
      } else {
        inv.pending   += +c.amount || 0;
      }
      // أقدم due_date
      if (c.due_date && (!inv.due_date || c.due_date < inv.due_date))
        inv.due_date = c.due_date;
    });

    // جلب عدد السيارات من allSales للعرض فقط (ليس للحساب)
    const allSalesD = d.allSales || [];
    const carCountMap = {};
    allSalesD.forEach(s => {
      const key = s.inv_no;
      if (key) carCountMap[key] = (carCountMap[key]||0) + 1;
    });

    const rows = Object.values(invMap).filter(inv => inv.pending > 0.01).map(inv => {
      const due_date = inv.due_date || '';
      const days     = due_date ? daysSince(due_date) : null;
      return {
        ...inv,
        _remaining: inv.pending,
        _collected: inv.collected,
        _due:       due_date,
        _days:      days,
        _overdue:   due_date && due_date <= d.todayStr,
        carCount:   carCountMap[inv.inv_no] || 0,
      };
    }).sort((a,b)=>
      a._overdue&&!b._overdue?-1:!a._overdue&&b._overdue?1:(a._due||'')>(b._due||'')?1:-1
    );
    const totRem = rows.reduce((s,r)=>s+r._remaining,0);
    const totCol = rows.reduce((s,r)=>s+r._collected,0);
    const overdueCount = rows.filter(r=>r._overdue).length;
    const oldest = rows.filter(r=>r._overdue).sort((a,b)=>(a._due||'')>(b._due||'')?1:-1)[0];
    ddKpis.style.gridTemplateColumns = 'repeat(4,1fr)';
    ddKpis.innerHTML = `
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--accent)">${fmt(totRem)}</div><div class="dd-kpi-lbl">اجمالي الباقي المستحق</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--green)">${fmt(totCol)}</div><div class="dd-kpi-lbl">اجمالي المحصل</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--red)">${overdueCount}</div><div class="dd-kpi-lbl">فواتير متاخرة</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--red)">${oldest?daysSince(oldest._due)+' يوم':'---'}</div><div class="dd-kpi-lbl">اقدم فاتورة متاخرة</div></div>`;
    const byCust = {};
    rows.forEach(r=>{byCust[r.customer||'غير محدد']=(byCust[r.customer||'غير محدد']||0)+r._remaining;});
    renderDDChart(Object.entries(byCust).sort((a,b)=>b[1]-a[1]).slice(0,8),'var(--accent)');
    ddTable.innerHTML = rows.length ? `
      <table class="data-table"><thead><tr>
        <th>الملف</th><th>رقم الفاتورة</th><th>العميل</th><th style="text-align:center">السيارات</th>
        <th style="text-align:left">إجمالي الفاتورة</th>
        <th style="text-align:left">المحصّل</th>
        <th style="text-align:left;color:var(--accent)">الباقي</th>
        <th>الاستحقاق</th><th>الأيام</th>
      </tr></thead><tbody>
      ${rows.map(r=>{
        const dc=r._overdue?'var(--red)':r._due?'var(--accent)':'var(--text2)';
        const db=r._overdue?'var(--red-dim)':r._due?'var(--accent-dim)':'var(--card2)';
        const dl=r._overdue?`متأخر ${r._days} يوم`:r._days!==null?`${r._days} يوم`:'---';
        return `<tr onclick="openViewer('${r.file_no||''}')" style="cursor:pointer">
          <td class="mono text-amber" style="font-weight:700">${r.file_no||'---'}</td>
          <td class="mono">${r.inv_no||'---'}</td>
          <td style="font-weight:600">${r.customer||'---'}</td>
          <td style="text-align:center;font-weight:700">${r.carCount} سيارة</td>
          <td class="mono text-blue" style="text-align:left">${fmt(r.total)}</td>
          <td class="mono text-green" style="text-align:left">${fmt(r._collected)}</td>
          <td class="mono" style="text-align:left;font-weight:900;color:var(--accent)">${fmt(r._remaining)}</td>
          <td class="mono" style="font-size:13px">${r._due||'---'}</td>
          <td><span style="background:${db};color:${dc};padding:2px 8px;border-radius:10px;font-size:12px;font-weight:700">${dl}</span></td>
        </tr>`;
      }).join('')}
      </tbody></table>` : emptyHTML('💰','لا توجد تحصيلات مستحقة');
  }

  // ── تحصيلات مقبوضة فعلاً ──
  else if (type === 'collected_summary') {
    (el('dd-title-main')||el('dd-title')).textContent = 'التحصيلات المقبوضة';
    const collected = (d.collectedList || []).filter(c => c.post_status !== 'voided');
    const pending   = (d.pendingList   || []).filter(c => c.post_status !== 'voided');
    const totC = collected.reduce((s,c)=>s+(+c.amount||0),0);
    const totP = pending.reduce((s,c)=>s+(+c.amount||0),0);
    ddKpis.style.gridTemplateColumns = 'repeat(3,1fr)';
    ddKpis.innerHTML = `
      <div class="dd-kpi" style="background:var(--green-dim)">
        <div class="dd-kpi-val" style="color:var(--green)">${fmt(totC)}</div>
        <div class="dd-kpi-lbl">✅ إجمالي المحصّل</div>
      </div>
      <div class="dd-kpi" style="background:var(--accent-dim)">
        <div class="dd-kpi-val" style="color:var(--accent)">${fmt(totP)}</div>
        <div class="dd-kpi-lbl">⏳ لم يُحصَّل بعد</div>
      </div>
      <div class="dd-kpi">
        <div class="dd-kpi-val">${collected.length + pending.length}</div>
        <div class="dd-kpi-lbl">إجمالي الفواتير</div>
      </div>`;
    const allRows = [...collected.map(c=>({...c,_status:'paid'})), ...pending.map(c=>({...c,_status:'pending'}))];
    allRows.sort((a,b)=>(b.paid_date||b.due_date||'').localeCompare(a.paid_date||a.due_date||''));
    ddTable.innerHTML = allRows.length ? `
      <table class="data-table"><thead><tr>
        <th>رقم التحصيل</th><th>رقم الفاتورة</th><th>الملف</th>
        <th>العميل</th><th>المبلغ</th><th>الاستحقاق</th><th>تاريخ الدفع</th><th>الحالة</th>
      </tr></thead><tbody>
      ${allRows.map(c=>`<tr onclick="openViewer('${c.file_no||''}')" style="cursor:pointer">
        <td class="mono" style="font-size:13px;color:var(--text2)">${c.ref_no||'—'}</td>
        <td class="mono" style="color:var(--blue)">${c.inv_no||'—'}</td>
        <td class="mono text-amber" style="font-weight:700">${c.file_no||'—'}</td>
        <td>${c.customer||'—'}</td>
        <td class="mono" style="color:${c._status==='paid'?'var(--green)':'var(--accent)'};font-weight:700">${fmt(c.amount)}</td>
        <td class="mono" style="font-size:13px">${c.due_date||'—'}</td>
        <td class="mono" style="font-size:13px;color:var(--green)">${c.paid_date||'—'}</td>
        <td><span style="background:${c._status==='paid'?'var(--green-dim)':'#fef3c7'};color:${c._status==='paid'?'var(--green)':'#92400e'};padding:1px 7px;border-radius:10px;font-size:12px;font-weight:700">
          ${c._status==='paid'?'✅ محصّل':'⏳ مستحق'}</span></td>
      </tr>`).join('')}
      </tbody></table>` : emptyHTML('💰','لا توجد تحصيلات في هذه الفترة');
  }

  // ── مستحق للموردين (تفصيلي) ──
  else if (type === 'supplier_due') {
    (el('dd-title-main')||el('dd-title')).textContent = 'مستحقات الموردين - تفاصيل كل الصفقات';
    const duelist = d.supplierDuelist || [];
    const totalDue  = duelist.reduce((s,r)=>s+r.due,0);
    const totalPaid = duelist.reduce((s,r)=>s+r.paid,0);
    const totalPO   = duelist.reduce((s,r)=>s+r.total_purchase,0);
    ddKpis.style.gridTemplateColumns = 'repeat(3,1fr)';
    ddKpis.innerHTML = `
      <div class="dd-kpi" style="background:var(--red-dim)"><div class="dd-kpi-val" style="color:var(--red)">${fmt(totalDue)}</div><div class="dd-kpi-lbl">اجمالي المستحق للموردين</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--green)">${fmt(totalPaid)}</div><div class="dd-kpi-lbl">اجمالي المدفوع</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--blue)">${fmt(totalPO)}</div><div class="dd-kpi-lbl">اجمالي قيمة الصفقات</div></div>`;
    renderDDChart(duelist.slice(0,10).map(r=>[r.supplier+'·'+r.file_no,r.due]),'var(--red)');
    ddTable.innerHTML = duelist.length ? `
      <table class="data-table"><thead><tr>
        <th>الملف</th><th>المورد</th><th>تاريخ PO</th>
        <th style="text-align:left">قيمة الصفقة</th>
        <th style="text-align:left">المدفوع</th>
        <th style="text-align:left;color:var(--red)">المتبقي المستحق</th>
        <th>%</th><th>الحالة</th>
      </tr></thead><tbody>
      ${duelist.map(r=>{
        const pct=r.total_purchase>0?((r.paid/r.total_purchase)*100).toFixed(0):0;
        const bc=+pct>=80?'var(--green)':+pct>=50?'var(--accent)':'var(--red)';
        return `<tr onclick="openViewer('${r.file_no}')" style="cursor:pointer">
          <td class="mono text-amber" style="font-weight:700">${r.file_no}</td>
          <td style="font-weight:600">${r.supplier}</td>
          <td class="mono" style="font-size:13px">${r.po_date||'---'}</td>
          <td class="mono text-blue" style="text-align:left">${fmt(r.total_purchase)}</td>
          <td class="mono text-green" style="text-align:left">${fmt(r.paid)}</td>
          <td class="mono" style="text-align:left;font-weight:900;color:var(--red)">${fmt(r.due)}</td>
          <td><div style="display:flex;align-items:center;gap:4px">
            <div style="width:40px;height:5px;background:var(--card2);border-radius:3px;overflow:hidden">
              <div style="width:${pct}%;height:100%;background:${bc};border-radius:3px"></div>
            </div>
            <span style="font-size:12px;color:${bc}">${pct}%</span>
          </div></td>
          <td><span class="badge badge-${statusClass(r.status)}">${r.status}</span></td>
        </tr>`;
      }).join('')}
      </tbody></table>` : emptyHTML('🔴','لا توجد مستحقات للموردين');
  }


  }

// ── DD mini chart ──
export function renderDDChart(entries, color) {
  const chartWrap  = el('dd-chart-wrap-main')||el('dd-chart-wrap');
  const chart      = el('dd-chart-main')||el('dd-chart');
  const labelsWrap = el('dd-chart-labels-main')||el('dd-chart-labels');
  if (!chartWrap||!chart||!entries.length) { if(chartWrap) chartWrap.style.display='none'; return; }
  chartWrap.style.display = 'block';
  const CHART_H = 100;
  const max = Math.max(...entries.map(e=>Math.abs(+e[1]||0)), 1);
  chart.style.cssText = `display:flex;gap:6px;align-items:flex-end;height:${CHART_H}px;border-bottom:1px solid var(--border);padding-bottom:0`;
  chart.innerHTML = entries.slice(0,10).map(([label,val])=>{
    const h   = Math.max(Math.round((Math.abs(+val)/max)*CHART_H), +val!==0?4:0);
    const c   = +val >= 0 ? color : 'var(--red)';
    const amt = Math.abs(+val) >= 1000 ? (Math.abs(+val)/1000).toFixed(1)+'K' : (+val||0).toFixed(0);
    return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;min-width:0;position:relative">
      <div style="font-size:8px;color:${c};font-weight:600;margin-bottom:2px;white-space:nowrap">${amt}</div>
      <div style="width:100%;height:${h}px;background:${c};border-radius:3px 3px 0 0"></div>
    </div>`;
  }).join('');
  labelsWrap.innerHTML = entries.slice(0,10).map(([label])=>`
    <div style="flex:1;text-align:center;font-size:13px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;padding-top:4px">${label}</div>`).join('');
}

// ── Regenerate file number ──
export async function regenFileNo() {
  try {
    const sys  = state.system;
    const all  = await apiGetAll('purchase_orders', { select:'file_no', system_type:`eq.${sys}`, order:'created_at.desc' });
    const nums = (all||[]).map(d => { const m=(d.file_no||'').match(/(\d+)$/); return m?parseInt(m[1]):0; });
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    el('nf-fileNo').value = `${sys}-${String(next).padStart(3,'0')}`;
    el('nf-fileNo').style.borderColor = 'var(--accent)';
    setTimeout(() => el('nf-fileNo').style.borderColor = '', 1000);
  } catch(e) { toast('خطأ في توليد الرقم','err'); }
}

// ── Regenerate invoice number ──
export async function regenInvNo() {
  try {
    const fn  = state.currentFileNo || el('nf-fileNo')?.value?.trim();
    const sys = state.system;
    if (!fn) { toast('حدد رقم الملف أولاً','err'); return; }
    const existing = await apiGetAll('sales', { select:'inv_no', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'created_at.desc' });
    const nums = (existing||[]).map(s => { const m=(s.inv_no||'').match(/(\d+)$/); return m?parseInt(m[1]):0; });
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    el('sale-invNo').value = `INV-${fn}-${String(next).padStart(3,'0')}`;
    el('sale-invNo').style.borderColor = 'var(--green)';
    setTimeout(() => el('sale-invNo').style.borderColor = '', 1000);
  } catch(e) { toast('خطأ في توليد رقم الفاتورة','err'); }
}

// ════════════════════════════════════════
// APPROVAL QUEUE
// ════════════════════════════════════════
// approvalState moved to top

const APPROVAL_CONFIG = {
  purchase:  { icon:'📋', label:'سند شراء',    color:'var(--accent)', table:'purchase_orders', amountField:'total_purchase', dateField:'po_date',    descFields:['file_no','supplier'] },
  sale:      { icon:'🧾', label:'بيع',          color:'var(--green)',  table:'sales',           amountField:'sale_price',     dateField:'sale_date',  descFields:['inv_no','customer','vin'] },
  expense:   { icon:'💸', label:'مصروف',        color:'var(--red)',    table:'expenses',         amountField:'amount',         dateField:'exp_date',   descFields:['description','exp_type','file_no'] },
  collection:{ icon:'💰', label:'تحصيل',        color:'var(--blue)',   table:'collections',      amountField:'amount',         dateField:'paid_date',  descFields:['inv_no','customer','file_no'] },
  payment:   { icon:'💳', label:'دفعة مورد',    color:'var(--cyan)',   table:'payments',         amountField:'amount',         dateField:'pay_date',   descFields:['payer','file_no','pay_method'] },
  payout:    { icon:'👥', label:'صرف شريك',    color:'var(--purple)', table:'partner_payouts',  amountField:'amount',         dateField:'pay_date',   descFields:['partner','payout_type','file_no'] },
  reversal:      { icon:'🔄', label:'طلب إلغاء',        color:'var(--orange,#f97316)', table:null,          amountField:'amount', dateField:'created_at', descFields:['ref_type','ref_desc','file_no'] },
  // ✅ طلبات التعديل — in-place edit requests
  payment_edit:    { icon:'✏️', label:'تعديل دفعة',      color:'var(--cyan)',   table:'payments',         amountField:'amount',      dateField:'pay_date',   descFields:['payer','file_no'] },
  expense_edit:    { icon:'✏️', label:'تعديل مصروف',     color:'var(--red)',    table:'expenses',         amountField:'amount',      dateField:'exp_date',   descFields:['description','file_no'] },
  collection_edit: { icon:'✏️', label:'تعديل تحصيل',     color:'var(--blue)',   table:'collections',      amountField:'amount',      dateField:'paid_date',  descFields:['inv_no','customer','file_no'] },
  purchase_edit:   { icon:'✏️', label:'تعديل سند شراء',  color:'var(--purple)', table:'purchase_orders',  amountField:'total_purchase', dateField:'updated_at', descFields:['file_no','supplier'] },
  payout_edit:     { icon:'✏️', label:'تعديل صرف شريك', color:'var(--purple)', table:'partner_payouts',  amountField:'amount',      dateField:'pay_date',   descFields:['partner','file_no'] },
  opex_edit:       { icon:'✏️', label:'تعديل مصروف تشغيلي', color:'var(--orange,#f97316)', table:'operating_expenses', amountField:'amount', dateField:'exp_date', descFields:['description','file_no'] },
  sale_edit:       { icon:'✏️', label:'تعديل فاتورة بيع',  color:'var(--green)',  table:'sales',              amountField:'sale_price', dateField:'sale_date', descFields:['inv_no','customer','file_no'] },
};

// ✅ خريطة طلبات التعديل (pending_edit) — على مستوى الموديول حتى تُستخدم من
// approveItem (فردي) وapproveAll (جماعي) معاً بنفس التعريف
const EDIT_TYPES = {
  payment_edit:    { table:'payments',           label:'دفعة' },
  expense_edit:    { table:'expenses',           label:'مصروف' },
  collection_edit: { table:'collections',        label:'تحصيل' },
  purchase_edit:   { table:'purchase_orders',    label:'سند شراء' },
  payout_edit:     { table:'partner_payouts',    label:'صرف شريك' },
  opex_edit:       { table:'operating_expenses', label:'مصروف تشغيلي' },
  sale_edit:       { table:'sales',              label:'فاتورة بيع' },
};

export async function showApprovalQueue() {
  if (!can('approve')) { toast('🔒 قائمة المراجعة للمدراء فقط','err'); return; }
  hideAllViews();
  el('approvalView').style.display = 'block';
  el('topBarTitle').textContent = 'المراجعة';
  navActive('nav-approval');
  sessionStorage.setItem('tm_last_view','approval');
  await loadApprovalQueue();
}

export async function loadApprovalQueue() {
  const wrap = el('approval-list');
  setLoading('approval-list');

  try {
    const sys = state.system;

    // جيب كل البنود المعلقة من كل الجداول بالتوازي
    const [purchases, sales, expenses, collections, payments, payouts,
           voidPay, voidExp, voidCol, voidPayout,
           editPay, editExp, editCol, editPO, editPayout] = await Promise.all([
      apiGetAll('purchase_orders', { select:'*', system_type:`eq.${sys}`, post_status:`eq.draft`,        order:'created_at.desc' }),
      apiGetAll('sales',           { select:'*', system_type:`eq.${sys}`, post_status:`eq.draft`,        order:'created_at.desc' }),
      apiGetAll('expenses',        { select:'*', system_type:`eq.${sys}`, post_status:`eq.draft`,        order:'created_at.desc' }),
      apiGetAll('collections',     { select:'*', system_type:`eq.${sys}`, post_status:`eq.draft`,        order:'created_at.desc' }),
      apiGetAll('payments',        { select:'*', system_type:`eq.${sys}`, post_status:`eq.draft`,        order:'created_at.desc' }),
      apiGetAll('partner_payouts', { select:'*', system_type:`eq.${sys}`, post_status:`eq.draft`,        order:'created_at.desc' }),
      apiGetAll('payments',        { select:'*', system_type:`eq.${sys}`, post_status:`eq.pending_void`, order:'created_at.desc' }),
      apiGetAll('expenses',        { select:'*', system_type:`eq.${sys}`, post_status:`eq.pending_void`, order:'created_at.desc' }),
      apiGetAll('collections',     { select:'*', system_type:`eq.${sys}`, post_status:`eq.pending_void`, order:'created_at.desc' }),
      apiGetAll('partner_payouts', { select:'*', system_type:`eq.${sys}`, post_status:`eq.pending_void`, order:'created_at.desc' }),
      // ✅ pending_edit — تعديلات في انتظار الموافقة
      apiGetAll('payments',            { select:'*', system_type:`eq.${sys}`, post_status:`eq.pending_edit`, order:'created_at.desc' }),
      apiGetAll('expenses',            { select:'*', system_type:`eq.${sys}`, post_status:`eq.pending_edit`, order:'created_at.desc' }),
      apiGetAll('collections',         { select:'*', system_type:`eq.${sys}`, post_status:`eq.pending_edit`, order:'created_at.desc' }),
      apiGetAll('purchase_orders',     { select:'*', system_type:`eq.${sys}`, post_status:`eq.pending_edit`, order:'created_at.desc' }),
      apiGetAll('partner_payouts',     { select:'*', system_type:`eq.${sys}`, post_status:`eq.pending_edit`, order:'created_at.desc' }),
      // operating_expenses لا تحتوي على post_status — لا تدخل في قائمة المراجعة
    ]);
    const editOpex = []; // operating_expenses بدون workflow موافقة

    // فواتير البيع pending_edit — نجمّع بـ inv_no لتفادي التكرار
    const editSalesRaw = await apiGetAll('sales', { select:'*', system_type:`eq.${sys}`, post_status:`eq.pending_edit`, order:'created_at.desc' });
    const editSalesMap = {};
    (editSalesRaw||[]).forEach(r => {
      const k = r.inv_no || r.id;
      if (!editSalesMap[k]) editSalesMap[k] = { ...r, _totalSale: 0 };
      editSalesMap[k]._totalSale += +r.sale_price||0;
    });
    const editSales = Object.values(editSalesMap);

    // ✅ فواتير بيع جديدة (draft) — نجمّع بـ inv_no حتى تكون فاتورة واحدة = بطاقة اعتماد واحدة
    // (كانت كل سيارة في الفاتورة تظهر كبطاقة مستقلة تتطلب ضغطة "موافقة" خاصة بها)
    const salesMap = {};
    (sales||[]).forEach(r => {
      const k = r.inv_no || r.id;
      if (!salesMap[k]) salesMap[k] = { ...r, _totalSale: 0, _carCount: 0 };
      salesMap[k]._totalSale += +r.sale_price||0;
      salesMap[k]._carCount += 1;
    });
    const groupedSales = Object.values(salesMap);

    // دمج كل البنود مع نوعها
    // جيب المستخدمين من audit_log
    const allIds = [...(purchases||[]),...(sales||[]),...(expenses||[]),...(collections||[]),...(payments||[]),...(payouts||[])].map(r=>r.id).filter(Boolean);
    let _auditUsers = {};
    try {
      const audits = []; // audit_log لا يحتوي على ref_id
      (audits||[]).forEach(a=>{ if(a.ref_id) _auditUsers[String(a.ref_id)] = (a.user_email||'').split('@')[0]; });
    } catch(e) { console.warn('approvalQueue auditUsers:', e.message); }
    approvalState.auditUsers = _auditUsers;

    // بناء reversal items من pending_void records
    const buildRevItem = (r, srcType, descFn) => ({
      ...r, _type:'reversal', _srcType:srcType,
      _amount:+r.amount||0, _date:r.created_at,
      _desc:`إلغاء ${srcType==='payment'?'دفعة':srcType==='expense'?'مصروف':srcType==='collection'?'تحصيل':'صرف شريك'} — ${descFn(r)}`,
      _file:r.file_no,
    });
    const reversalItems = [
      ...(voidPay   ||[]).map(r => buildRevItem(r,'payment',   r=>`${r.payer||'—'} · ${r.file_no||'—'}`)),
      ...(voidExp   ||[]).map(r => buildRevItem(r,'expense',   r=>`${r.description||'—'} · ${r.file_no||'—'}`)),
      ...(voidCol   ||[]).map(r => buildRevItem(r,'collection',r=>`${r.inv_no||'—'} · ${r.customer||'—'}`)),
      ...(voidPayout||[]).map(r => buildRevItem(r,'payout',    r=>`${r.partner||'—'} · ${r.file_no||'—'}`)),
    ];

    // بناء edit items
    const buildEditItem = (r, srcType, descFn) => ({
      ...r, _type: srcType + '_edit', _srcType: srcType,
      _amount: +r.amount || +r.sale_price || 0,
      _date: r.created_at,
      _desc: `تعديل ${srcType==='payment'?'دفعة':srcType==='expense'?'مصروف':'تحصيل'} — ${descFn(r)}`,
      _file: r.file_no,
      _editData: {
        payment:    { payer:r._edit_payer, amount:r._edit_amount, method:r._edit_method, date:r._edit_date, doc:r._edit_doc },
        expense:    { desc:r._edit_desc, type:r._edit_type, amount:r._edit_amount, date:r._edit_date, method:r._edit_method, doc:r._edit_doc },
        collection: { amount:r._edit_amount, method:r._edit_method, due:r._edit_due, paid:r._edit_paid, doc:r._edit_doc },
      }[srcType],
    });
    const editItems = [
      ...(editPay   ||[]).map(r => ({...r, _type:'payment_edit',    _amount:+r.amount||0,          _date:r.pay_date,  _desc:`تعديل دفعة — ${r.payer||'—'} · ${fmt(r.amount)} · ${r.file_no||'—'}`, _file:r.file_no })),
      ...(editExp   ||[]).map(r => ({...r, _type:'expense_edit',    _amount:+r.amount||0,          _date:r.exp_date,  _desc:`تعديل مصروف — ${r.description||'—'} · ${fmt(r.amount)} · ${r.file_no||'—'}`, _file:r.file_no })),
      ...(editCol   ||[]).map(r => ({...r, _type:'collection_edit', _amount:+r.amount||0,          _date:r.paid_date, _desc:`تعديل تحصيل — ${r.inv_no||'—'} · ${fmt(r.amount)} · ${r.file_no||'—'}`, _file:r.file_no })),
      ...(editPO    ||[]).map(r => ({...r, _type:'purchase_edit',   _amount:+r.total_purchase||0,  _date:r.po_date,   _desc:`تعديل سند شراء — ${r.file_no||'—'} · ${r.supplier||'—'} · ${fmt(r.total_purchase)}`, _file:r.file_no })),
      ...(editPayout||[]).map(r => ({...r, _type:'payout_edit',     _amount:+r.amount||0,          _date:r.pay_date,  _desc:`تعديل صرف شريك — ${r.partner||'—'} · ${fmt(r.amount)} · ${r.file_no||'—'}`, _file:r.file_no })),
      ...(editOpex  ||[]).map(r => ({...r, _type:'opex_edit',       _amount:+r.amount||0,          _date:r.exp_date,  _desc:`تعديل مصروف تشغيلي — ${r.description||'—'} · ${fmt(r.amount)}`, _file:r.file_no||null })),
      ...(editSales ||[]).map(r => ({...r, _type:'sale_edit',       _amount:r._totalSale||+r.sale_price||0, _date:r.sale_date, _desc:`تعديل فاتورة — ${r.inv_no||'—'} · ${r.customer||'—'} · ${fmt(r._totalSale||r.sale_price)}`, _file:r.file_no })),
    ];

    approvalState.all = [
      ...(purchases||[]).map(r    => ({...r, _type:'purchase',   _amount:+r.total_purchase||0, _date:r.po_date,    _desc:`${r.file_no||'—'} · ${r.supplier||'—'} · ${r.vehicle_count||0} سيارة`, _file:r.file_no })),
      ...(groupedSales||[]).map(r => ({...r, _type:'sale',       _amount:r._totalSale||+r.sale_price||0, _date:r.sale_date, _desc:`${r.inv_no||'—'} · ${r.customer||'—'} · ${r._carCount||1} سيارة · ${fmt(r._totalSale||r.sale_price)}`, _file:r.file_no })),
      ...(expenses||[]).map(r     => ({...r, _type:'expense',    _amount:+r.amount||0,         _date:r.exp_date||r.expense_date, _desc:`${r.description||'—'} · ${r.exp_type||'—'} · ${r.file_no||'—'}`, _file:r.file_no })),
      ...(collections||[]).map(r  => ({...r, _type:'collection', _amount:+r.amount||0,         _date:r.paid_date||r.due_date,    _desc:`${r.inv_no||'—'} · ${r.customer||'—'} · ${r.file_no||'—'}`,      _file:r.file_no })),
      ...(payments||[]).map(r     => ({...r, _type:'payment',    _amount:+r.amount||0,         _date:r.pay_date,   _desc:`${r.payer||'—'} · ${r.file_no||'—'} · ${r.pay_method||'—'}`,          _file:r.file_no })),
      ...(payouts||[]).map(r      => ({...r, _type:'payout',     _amount:+r.amount||0,         _date:r.pay_date,   _desc:`${r.partner||'—'} · ${r.payout_type||'—'} · ${r.file_no||'—'}`,       _file:r.file_no })),
      ...reversalItems,
      ...editItems,
    ].sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0));

    // تحديث الـ badge في الـ sidebar
    const total = approvalState.all.length;
    const badge = el('approval-badge');
    if (badge) { badge.textContent = total || ''; badge.style.display = total ? '' : 'none'; }

    // تحديث الـ subtitle
    if (el('approval-subtitle')) el('approval-subtitle').textContent = `${total} عملية معلقة للمراجعة`;

    // تحديث counts
    Object.keys(APPROVAL_CONFIG).forEach(type => {
      const cnt = el(`af-count-${type}`);
      if (cnt) cnt.textContent = approvalState.all.filter(r=>r._type===type).length || '';
    });
    // reversal badge
    const revBtn = el('af-reversal');
    if (revBtn) {
      const revCount = reversalItems.length;
      const revCnt = el('af-count-reversal');
      if (revCnt) revCnt.textContent = revCount || '';
      revBtn.style.display = revCount ? '' : '';
    }
    const cntAll = el('af-count-all');
    if (cntAll) cntAll.textContent = total || '';

    // زر موافقة على الكل
    if (el('approve-all-btn')) el('approve-all-btn').style.display = total ? '' : 'none';

    filterApproval(approvalState.currentType);

  } catch(e) {
    wrap.innerHTML = `<div class="alert alert-err">خطأ: ${e.message}</div>`;
  }
}

// ── Optimistic UI: شيل العنصر فوراً من الشاشة قبل انتهاء DB ──
export function _optimisticRemove(type, id) {
  approvalState.all      = approvalState.all.filter(r => !(r._type === type && String(r.id) === String(id)));
  approvalState.filtered = approvalState.filtered.filter(r => !(r._type === type && String(r.id) === String(id)));
  renderApprovalList();
  // تحديث badge وعدادات الفلتر فوراً
  const total = approvalState.all.length;
  const badge = el('approval-badge');
  if (badge) { badge.textContent = total || ''; badge.style.display = total ? '' : 'none'; }
  if (el('approval-subtitle')) el('approval-subtitle').textContent = `${total} عملية معلقة للمراجعة`;
  Object.keys(APPROVAL_CONFIG).forEach(t => {
    const cnt = el(`af-count-${t}`);
    if (cnt) cnt.textContent = approvalState.all.filter(r => r._type === t).length || '';
  });
  const cntAll = el('af-count-all');
  if (cntAll) cntAll.textContent = total || '';
}

export function filterApproval(type) {
  approvalState.currentType = type;
  document.querySelectorAll('.approval-filter-btn').forEach(b => b.classList.remove('active'));
  el('af-' + type)?.classList.add('active');

  approvalState.filtered = type === 'all'
    ? approvalState.all.filter(r => r.post_status !== 'cancelled')
    : approvalState.all.filter(r => r._type === type && r.post_status !== 'cancelled');

  renderApprovalList();
}

export function renderApprovalList() {
  const wrap = el('approval-list');
  const items = approvalState.filtered;

  if (!items.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="e-icon">✅</div><p>لا توجد عمليات معلقة</p><small>كل العمليات تمت الموافقة عليها</small></div>`;
    return;
  }

  wrap.innerHTML = items.map(r => {
    const cfg = APPROVAL_CONFIG[r._type];
    const isReversal = r._type === 'reversal';
    const color = isReversal ? '#f97316' : cfg.color;
    const approveLabel = isReversal ? '✓ تنفيذ الإلغاء' : '✓ موافقة';
    const approveMsg   = isReversal
      ? 'سيتم تنفيذ القيد العكسي وإلغاء العملية نهائياً — هل أنت متأكد؟'
      : 'هل تريد الموافقة على هذه العملية وترحيلها؟';
    const rejectLabel  = isReversal ? '↩ استرداد' : null;
    return `
    <div class="approval-row" onclick="openApprovalDetail('${r._type}','${r.id}')" style="${isReversal?'border-right:3px solid #f97316':''}">
      <div class="approval-row-icon" style="background:${color}22;color:${color}">${cfg.icon}</div>
      <div class="approval-row-body">
        <div class="approval-row-title" style="${isReversal?'color:#f97316':''}">
          ${isReversal ? '🔄 طلب إلغاء — ' : ''}${r._desc}
        </div>
        <div class="approval-row-meta">
          ${fmtDate(r._date)}
          ${r.created_at ? `· <span style="color:var(--text2)">🕐 ${fmtTime(r.created_at)}</span>` : ''}
          ${r._file ? `· <span style="color:var(--accent);font-family:monospace">${r._file}</span>` : ''}
          · <span style="color:var(--text2)">${r.ref_no||r.pay_id||r.inv_no||r.file_no||'—'}</span>
          ${approvalState.auditUsers?.[String(r.id)] ? `· <span style="color:var(--blue);font-size:12px;font-weight:600">👤 ${approvalState.auditUsers[String(r.id)]}</span>` : ''}
        </div>
      </div>
      <div class="approval-row-amount" style="color:${color}">${fmt(r._amount)}</div>
      <div class="approval-row-actions" onclick="event.stopPropagation()" style="display:flex;gap:6px;align-items:center">
        <button class="btn btn-sm approve-btn" onclick="confirmAction('${isReversal?'تنفيذ الإلغاء':'موافقة على العملية'}','${approveMsg}',()=>approveItem('${r._type}','${r.id}'),${isReversal})"
          style="background:${isReversal?'rgba(249,115,22,.15)':'var(--green-dim)'};border:1px solid ${isReversal?'#f97316':'var(--green)'};color:${isReversal?'#f97316':'var(--green)'};padding:4px 10px;font-weight:700">${approveLabel}</button>
        ${isReversal
          ? `<button class="btn btn-sm reject-btn" onclick="event.stopPropagation();confirmAction('استرداد العملية','سيتم إلغاء طلب الإلغاء وإعادة العملية لحالتها السابقة',()=>rejectItem('${r._type}','${r.id}'),false)"
              style="background:var(--green-dim);border:1px solid var(--green);color:var(--green);padding:4px 10px;font-weight:700">↩ استرداد</button>`
          : `<button class="btn-ctx-menu" onclick="event.stopPropagation();_ctxApproval(this)" data-type="${r._type}" data-id="${r.id}" title="المزيد">⋮</button>`
        }
      </div>
    </div>`;
  }).join('');
}


const FIELD_LABELS = {
  file_no:'رقم الملف', supplier:'المورد', po_no:'رقم PO', po_date:'تاريخ PO',
  total_purchase:'قيمة الصفقة', vehicle_count:'عدد السيارات',
  payer:'الدافع', amount:'المبلغ', pay_method:'طريقة الدفع', pay_date:'تاريخ الدفع',
  document:'رقم المستند', notes:'ملاحظات', ref_no:'مرجع', pay_id:'رقم العملية',
  description:'الوصف', exp_type:'النوع', exp_date:'التاريخ',
  inv_no:'رقم الفاتورة', customer:'العميل', vin:'رقم الشاصي',
  sale_price:'سعر البيع', sale_date:'تاريخ البيع',
  due_date:'تاريخ الاستحقاق', paid_date:'تاريخ الدفع',
  partner:'الشريك', payout_type:'نوع الصرف',
  capital_amount:'رأس المال', profit_amount:'الأرباح', advance_amount:'السلفة',
};
const SKIP_FIELDS = new Set(['_type','_amount','_date','_desc','_file','post_status',
  'created_at','updated_at','id','system_type','ref_table','ref_id','status','po_no']);

export async function openApprovalDetail(type, id) {
  const cfg  = APPROVAL_CONFIG[type];
  const item = approvalState.all.find(r => r._type === type && String(r.id) === String(id));
  if (!item || !cfg) return;

  approvalState.currentItem = { type, id, item };

  el('ad-icon').textContent = cfg.icon;
  el('ad-icon').style.background = cfg.color + '22';
  el('ad-title').textContent = cfg.label + ' — مراجعة';

  const fullFileBtn = el('ad-fullfile-btn');
  if (fullFileBtn) fullFileBtn.style.display = item._file ? '' : 'none';

  const fields = Object.entries(item).filter(([k,v]) =>
    !SKIP_FIELDS.has(k) && v !== null && v !== undefined && v !== ''
  );

  el('ad-body').innerHTML = `
    <div style="background:${cfg.color}11;border:1px solid ${cfg.color}33;border-radius:var(--radius-sm);padding:12px 16px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:13px;color:${cfg.color};font-weight:700">${cfg.label}</div>
        <div style="font-size:12px;color:var(--text2);margin-top:2px">${item._desc}</div>
        ${approvalState.auditUsers?.[String(item.id)]?`<div style="font-size:13px;color:var(--blue);margin-top:3px">👤 أُدخل بواسطة: ${approvalState.auditUsers[String(item.id)]}</div>`:''}
        ${item._file?`<div style="font-size:13px;color:var(--accent);font-family:monospace;margin-top:2px">${item._file}</div>`:''}
      </div>
      <div style="font-size:22px;font-weight:900;color:${cfg.color};font-family:monospace">${fmt(item._amount)}</div>
    </div>
    <table class="data-table" style="font-size:12px">
      <tbody>
        ${fields.map(([k,v])=>`
        <tr>
          <td style="color:var(--text2);font-weight:600;padding:7px 14px;width:42%">${FIELD_LABELS[k]||k}</td>
          <td style="padding:7px 14px;font-family:${typeof v==='number'||String(v).match(/^[0-9.\-]+$/)?'monospace':'inherit'}">${v}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  openModal('approvalDetailModal');
}

export async function openFullFileFromDetail() {
  if (!approvalState.currentItem) return;
  const { item } = approvalState.currentItem;
  if (!item._file) return;
  closeModal('approvalDetailModal');
  await openViewer(item._file);
}

export async function approveFromDetail() {
  if (!approvalState.currentItem) return;
  const { type, id } = approvalState.currentItem;
  closeModal('approvalDetailModal');
  await approveItem(type, id);
}

export async function cancelFromDetail() {
  if (!approvalState.currentItem) return;
  const { type, id, item } = approvalState.currentItem;
  closeModal('approvalDetailModal');
  showConfirm('إلغاء العملية', 'سيتم وضع العملية كـ "ملغية" مع إمكانية الإرجاع لاحقاً.', async () => {
    try {
      const cfg = APPROVAL_CONFIG[type];
      await apiPatch(cfg.table, { id:`eq.${id}` }, { post_status:'cancelled' });
      invalidateCache();
      toast('⊘ تم إلغاء العملية','ok');
      await loadApprovalQueue();
    } catch(e) { toast('خطأ: '+e.message,'err'); }
  });
}

export async function rejectFromDetail() {
  if (!approvalState.currentItem) return;
  const { type, id } = approvalState.currentItem;
  closeModal('approvalDetailModal');
  await rejectItem(type, id);
}

// ════════════════════════════════════════
// EDIT SALE FROM APPROVAL QUEUE
// ════════════════════════════════════════
export async function openEditSaleApproval(saleId, fileNo, invNo) {
  if (!fileNo || !invNo) { toast('بيانات الفاتورة ناقصة', 'err'); return; }
  try {
    // جيب كل سطور الفاتورة (ممكن أكثر من سيارة)
    // ✅ استثناء cancelled/voided — وإلا تظهر سيارة محذوفة مسبقاً مُعلَّمة "checked" في قائمة
    // التعديل، وأي حفظ بلا تعديلها يُعيد إدراجها كسيارة "جديدة" (تكرار/إحياء سيارة محذوفة)
    const allSaleItems = await apiGetAll('sales', {
      select: '*',
      system_type: `eq.${state.system}`,
      file_no: `eq.${fileNo}`,
      inv_no: `eq.${invNo}`,
      'post_status': 'not.in.(cancelled,voided)',
    });
    if (!allSaleItems?.length) { toast('لم يُعثر على بيانات الفاتورة', 'err'); return; }
    const firstItem = allSaleItems[0];

    // عشان الـ modal يعرف يجيب السيارات المتاحة
    state.currentFileNo = fileNo;

    // افتح modal الـ sale وامليه بالبيانات
    await openSaleModal(fileNo);

    // بعد ما الـ modal يتفتح وتتحمّل السيارات
    setTimeout(async () => {
      if (el('sale-invNo'))    el('sale-invNo').value    = invNo || '';
      if (el('sale-date'))     el('sale-date').value     = firstItem.sale_date || today();
      if (el('sale-customer')) el('sale-customer').value = firstItem.customer || '';
      if (el('sale-notes'))    el('sale-notes').value    = firstItem.notes || '';

      // ── بناء صفوف السيارات في وضع التعديل ──
      // نجلب: كل سيارات الملف + السيارات المتاحة (غير مباعة في فواتير أخرى)
      let allFileVehicles = [];
      try {
        allFileVehicles = await apiGetAll('vehicles', { select:'*', system_type:`eq.${state.system}`, file_no:`eq.${fileNo}` });
      } catch(e) {}

      // السيارات المباعة في فواتير أخرى (مش هذه الفاتورة)
      let otherSoldVins = new Set();
      try {
        const otherSales = await apiGetAll('sales', {
          select:'vin,post_status', system_type:`eq.${state.system}`, file_no:`eq.${fileNo}`,
        });
        // ✅ 'cancelled' (رُفض من طابور الموافقات) و'voided' (اتعكس بعد الترحيل) حالتين
        // مختلفتين — استبعاد cancelled بس كان بيسيب سيارة بيعها اتعكس فعليًا مقفولة
        // للأبد من شاشات تعديل الفواتير التانية لنفس الملف (نفس مبدأ isVisible في core.js)
        (otherSales||[]).filter(s => s.post_status !== 'cancelled' && s.post_status !== 'voided').forEach(s => {
          // استثنِ سيارات هذه الفاتورة
          if (!allSaleItems.find(si => si.vin === s.vin)) otherSoldVins.add(s.vin);
        });
      } catch(e) {}

      // خريطة بيانات هذه الفاتورة بالـ VIN
      const thisSaleMap = {};
      allSaleItems.forEach(si => { if(si.vin) thisSaleMap[si.vin] = si; });

      const s  = 'width:100%;background:var(--card);border:1px solid var(--border);border-radius:4px;padding:6px 8px;color:var(--text);font-family:monospace;font-size:12px';
      const sn = 'width:100%;background:var(--card);border:1px solid var(--border);border-radius:4px;padding:6px 8px;color:var(--text);font-family:Cairo,sans-serif;font-size:12px';

      el('saleVehiclesContainer').innerHTML = (allFileVehicles||[]).map(v => {
        const inThisInv  = !!thisSaleMap[v.vin];
        const inOtherInv = otherSoldVins.has(v.vin);
        if (inOtherInv) return ''; // مباعة في فاتورة أخرى — لا تظهر

        const saleRecord = thisSaleMap[v.vin] || {};
        const rowBg      = inThisInv ? 'background:rgba(16,185,129,.07)' : '';
        const label      = inThisInv ? '' : `<span style="font-size:10px;background:var(--card2);color:var(--text2);border-radius:3px;padding:1px 5px;margin-right:4px">متاح للإضافة</span>`;

        return `<tr class="sale-v-row"
          data-vehicle-id="${v.id||''}"
          data-vin="${(v.vin||'').replace(/"/g,'&quot;')}"
          data-model="${(v.model||v.vehicle_type||'').replace(/"/g,'&quot;')}"
          data-plate="${(v.plate||'').replace(/"/g,'&quot;')}"
          data-color="${(v.color||'').replace(/"/g,'&quot;')}"
          data-year="${v.year||''}"
          data-engine="${v.engine_size||''}"
          style="${rowBg}">
          <td style="padding:6px 8px;text-align:center;width:36px">
            <input type="checkbox" class="sv-check" ${inThisInv?'checked':''}
              onchange="onSaleVehicleCheck(this)"
              style="width:16px;height:16px;cursor:pointer;accent-color:var(--green)">
          </td>
          <td style="padding:6px 8px">
            <div style="font-weight:600;font-size:13px">${label}${v.model||v.vehicle_type||v.vin||'—'} ${v.year||''}</div>
            <div style="font-family:monospace;font-size:13px;font-weight:700;color:var(--blue);direction:ltr;letter-spacing:.8px;margin:2px 0">${v.vin||'—'}</div>
            <div style="font-size:13px;color:var(--text2)">${v.color||''}${v.plate?' · '+v.plate:''}</div>
          </td>
          <td style="padding:6px 8px;text-align:center">
            <span style="color:var(--blue);font-family:monospace;font-size:12px;font-weight:600">${fmt(v.purchase_price||0)}</span>
          </td>
          <td style="padding:6px 8px">
            <input type="number" name="sv-price"
              value="${inThisInv ? (saleRecord.sale_price||'') : ''}"
              placeholder="سعر البيع *" min="0" step="0.001"
              ${inThisInv ? '' : 'disabled'}
              oninput="updateSaleTotal()"
              style="${s}${inThisInv ? '' : ';opacity:.4;cursor:not-allowed'}">
          </td>
          <td style="padding:6px 8px">
            <input type="text" name="sv-notes"
              value="${inThisInv ? (saleRecord.notes||'').replace(/"/g,'&quot;') : ''}"
              placeholder="ملاحظة"
              ${inThisInv ? '' : 'disabled'}
              style="${sn}${inThisInv ? '' : ';opacity:.4;cursor:not-allowed'}">
          </td>
        </tr>`;
      }).join('');
      updateSaleTotal();

      // ── استرجاع المصاريف الإضافية من sale_charges ──
      try {
        const charges = await apiGetAll('sale_charges', {
          select: '*', system_type: `eq.${state.system}`, inv_no: `eq.${invNo}`
        });
        if (charges?.length) {
          if (el('extraChargesContainer')) el('extraChargesContainer').innerHTML = '';
          charges.forEach(c => addExtraChargeRow(c.description, c.amount));
          updateSaleTotal();
        }
      } catch(e) { console.warn('load sale_charges:', e.message); }

      // Override زرار الحفظ — تعديل in-place + إرسال للموافقة
      const submitBtn = el('saleSubmitBtn');
      submitBtn._editMode  = true;
      submitBtn._editInvNo = invNo;
      submitBtn._editFileNo= fileNo;
      submitBtn.onclick = async () => {
        try {
          const sys = state.system;
          // جيب السجلات القديمة — استثناء cancelled/voided حتى لا تُحسَب ضمن الإجمالي القديم
          // ولا تُعاد معالجتها كـ"مزالة" في كل حفظ (كانت تُكرّر ملاحظة الحذف على كل ضغطة)
          const oldSales = await apiGetAll('sales', {
            select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, inv_no:`eq.${invNo}`,
            'post_status':'not.in.(cancelled,voided)',
          });
          const totalOld     = (oldSales||[]).reduce((s,r)=>s+(+r.sale_price||0),0);
          const oldCustomer  = oldSales?.[0]?.customer || '';
          const wasPosted    = (oldSales||[]).some(s => s.post_status === 'posted' || s.post_status === 'pending_edit');

          // ── 1. حساب الإجمالي الجديد من الـ form ──
          const rows = el('saleVehiclesContainer').querySelectorAll('tr.sale-v-row');
          let totalNew = 0;
          rows.forEach(row => {
            const cb = row.querySelector('.sv-check');
            if (cb && !cb.checked) return;
            totalNew += parseFloat(row.querySelector('[name="sv-price"]')?.value)||0;
          });
          const newCustomer = el('sale-customer')?.value?.trim() || oldCustomer;

          // ── 2. تصنيف السيارات: محدودة / مزالة / جديدة ──
          const newDate  = el('sale-date')?.value || firstItem.sale_date;
          const newNotes = el('sale-notes')?.value?.trim() || '';
          const oldVinSet = new Set((oldSales||[]).map(s=>s.vin));
          const checkedRows = Array.from(rows).filter(r => r.querySelector('.sv-check')?.checked);
          const checkedVins = new Set(checkedRows.map(r => r.dataset?.vin).filter(Boolean));

          // أ) سيارات مزالة (كانت في الفاتورة والآن unchecked) → إلغاء
          const removedSales = (oldSales||[]).filter(s => !checkedVins.has(s.vin));
          for (const s of removedSales) {
            await apiPatch('sales', { id:`eq.${s.id}` }, {
              post_status: 'cancelled',
              notes: `${s.notes||''} | حُذفت من الفاتورة ${invNo} بتاريخ ${today()}`.trim()
            });
          }

          // ب) سيارات موجودة في الفاتورة → تحديث
          const keptSales = (oldSales||[]).filter(s => checkedVins.has(s.vin));
          for (const s of keptSales) {
            const matchRow = checkedRows.find(r => r.dataset?.vin === s.vin);
            const newPrice = parseFloat(matchRow?.querySelector('[name="sv-price"]')?.value) || s.sale_price;
            const rowNotes = matchRow?.querySelector('[name="sv-notes"]')?.value?.trim() || s.notes;
            await apiPatch('sales', { id:`eq.${s.id}` }, {
              customer: newCustomer, sale_date: newDate,
              sale_price: newPrice, notes: rowNotes||null,
              post_status: 'pending_edit',
            });
          }

          // ج) سيارات جديدة (checked لكن لم تكن في الفاتورة) → إضافة
          const addedRows = checkedRows.filter(r => !oldVinSet.has(r.dataset?.vin));
          for (const row of addedRows) {
            const vin      = row.dataset?.vin || '';
            const newPrice = parseFloat(row.querySelector('[name="sv-price"]')?.value) || 0;
            const rowNotes = row.querySelector('[name="sv-notes"]')?.value?.trim() || '';
            if (!newPrice) continue;
            const newSaleData = {
              system_type: sys, file_no: fileNo,
              inv_no: invNo, vin,
              customer: newCustomer,
              sale_price: newPrice, sale_date: newDate,
              notes: rowNotes||null,
              post_status: 'pending_edit',
            };
            await apiPost('sales', newSaleData);
          }

          // إعادة حساب الإجماليات للقيد
          totalNew = checkedRows.reduce((s,r) => s + (parseFloat(r.querySelector('[name="sv-price"]')?.value)||0), 0);

          // ── 3. تحديث القيد في مكانه ──
          // ✅ يشمل الآن تغيّر التاريخ فقط (قيد البيع بلا ref_id — يُطابَق بالمبلغ القديم)
          // ✅ وأيضاً تغيّر تركيبة السيارات حتى لو الإجمالي المالي ثابت — لإعادة حساب COGS
          const oldDate = oldSales?.[0]?.sale_date || null;
          const dateChangedSale = !!newDate && newDate !== oldDate;
          const vinSetChanged   = removedSales.length > 0 || addedRows.length > 0;
          if (wasPosted && (Math.abs(totalOld - totalNew) > 0.001 || newCustomer !== oldCustomer || dateChangedSale || vinSetChanged)) {
            // ✅ تكلفة البضاعة القديمة الفعلية من القيد الحالي (نفس طريقة voidSaleInvoice)
            let oldCost = 0;
            try {
              const cogsLines = await apiGetAll('journal_entries', {
                select:'dr_amount,description,ref_id', system_type:`eq.${sys}`,
                ref_table:`eq.sales`, file_no:`eq.${fileNo}`, account_code:`eq.5100`, post_status:`eq.posted`,
              });
              // ✅ ref_id أولاً (قيود ما بعد post_sale_je RPC)، fallback نصي بس للقيود القديمة
              const byRefId = (cogsLines||[]).filter(r => r.ref_id === invNo);
              const oldCostRows = byRefId.length
                ? byRefId
                : (cogsLines||[]).filter(r => !r.ref_id && (r.description||'').includes(invNo));
              oldCost = oldCostRows.reduce((s,r)=>s+(+r.dr_amount||0), 0);
            } catch(e) { console.warn('openEditSaleApproval oldCost lookup:', e.message); }
            // ✅ تكلفة البضاعة الجديدة محسوبة على السيارات النشطة الفعلية بعد التعديل —
            // نستثني مساهمة هذه الفاتورة نفسها (قيدها القديم لا يزال posted حتى لحظة updateJEInPlace
            // التالية) من "المُباع سابقاً" و"التكلفة المُستهلكة سابقاً"، حتى لا تُحسب مرتين
            let newCost = 0;
            try {
              const _isPart = v => (v||'').startsWith('PART-');
              const [otherSales, allCogsLines] = await Promise.all([
                apiGetAll('sales', { select:'vin,inv_no', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, post_status:'eq.posted' }),
                apiGetAll('journal_entries', { select:'dr_amount,description,ref_id', system_type:`eq.${sys}`, ref_table:'eq.sales', file_no:`eq.${fileNo}`, account_code:'eq.5100', post_status:'eq.posted' }),
              ]);
              const otherAlreadySold = (otherSales||[]).filter(s => s.inv_no !== invNo && !_isPart(s.vin)).length;
              // ✅ ref_id أولاً (استبعاد دقيق لسطور هذه الفاتورة)، fallback نصي بس
              // للقيود القديمة اللي ref_id فيها null
              const otherAlreadyCOGS = (allCogsLines||[])
                .filter(r => r.ref_id ? r.ref_id !== invNo : !(r.description||'').includes(invNo))
                .reduce((s,r)=>s+(+r.dr_amount||0), 0);
              newCost = await calcCOGS(sys, fileNo, checkedRows.length, {
                soldVins: [...checkedVins], alreadySold: otherAlreadySold, alreadyCOGS: otherAlreadyCOGS,
              });
            } catch(e) { console.warn('openEditSaleApproval newCost calc:', e.message); }
            await updateJEInPlace({
              // ✅ refId=رقم الفاتورة (مش id سطر سيارة) — يطابق ref_id الحقيقي اللي
              // post_sale_je بيرحّله دلوقتي، فالمسار الأساسي في updateJEInPlace
              // (ref_id-based) بقى يلاقي القيد مباشرة بدل الاعتماد الدائم على fallback
              // مطابقة المبلغ (لسه موجود كـfallback للقيود القديمة بلا ref_id)
              sys, fileNo, refTable:'sales', refId: invNo||null,
              oldAmount: totalOld, newAmount: totalNew,
              oldCost, newCost,
              contactPatch: newCustomer !== oldCustomer ? newCustomer : null,
              newDate: dateChangedSale ? newDate : null,   // ✅ مزامنة تاريخ قيد البيع
            });
          }

          await logAudit('EDIT','sales', fileNo, {invNo,totalOld,oldCustomer}, {totalNew,newCustomer}, `تعديل فاتورة ${invNo}`);
          await updateApprovalBadge();
          submitBtn.onclick  = () => submitSale();
          submitBtn._editMode= false;
          closeModal('saleModal');
          toast('⚠️ تم تعديل الفاتورة والقيد — في انتظار الموافقة','warn');
          invalidateCache();
          if (typeof loadSalesTab === 'function') await loadSalesTab(fileNo, sys);
        } catch(e) {
          toast('خطأ في حفظ التعديل: '+e.message,'err');
          console.error(e);
        }
      };

      toast('✏️ جاهز للتعديل — عدّل ثم اضغط حفظ', 'ok');
    }, 700);
  } catch(e) {
    toast('خطأ في فتح الفاتورة: ' + e.message, 'err');
    console.error(e);
  }
}

export async function editFromDetail() {
  if (!approvalState.currentItem) return;
  const { type, id, item } = approvalState.currentItem;
  closeModal('approvalDetailModal');
  // فتح الأمر مع إمكانية التعديل — نفس المودال سواء كان طلب إدخال أول مرة (purchase)
  // أو طلب تعديل على سجل قائم بالفعل (purchase_edit) — الفرق بينهم بس post_status
  const baseType = type.replace(/_edit$/, '');
  if (baseType === 'purchase' && item?.file_no) {
    openNewFileModal(item.file_no);
  } else if (baseType === 'sale') {
    await openEditSaleApproval(id, item?.file_no, item?.inv_no || item?.invoice_no);
  } else if (baseType === 'payment') {
    openEditPaymentModal(id);
  } else if (baseType === 'expense') {
    openEditExpenseModal(id);
  } else if (baseType === 'collection') {
    openEditCollectionModal(id);
  } else if (baseType === 'payout') {
    openEditPayoutModal(id);
  } else if (baseType === 'opex') {
    openEditOpexModal(id);
  } else if (item?.file_no) {
    openViewer(item.file_no);
  } else {
    toast('لا يمكن فتح هذا الأمر','err');
  }
}


export async function approveItem(type, id) {
  try {
    const cfg = APPROVAL_CONFIG[type];
    if (!cfg) { toast('نوع غير معروف','err'); return; }

    // ── معالجة طلبات التعديل (pending_edit) — القيد اتحدث مسبقاً، نكتفي بالموافقة ──
    if (EDIT_TYPES[type]) {
      const cfg  = EDIT_TYPES[type];
      const item = approvalState.all.find(r => r._type === type && String(r.id) === String(id));
      if (!item) { toast('لم يُعثر على طلب التعديل','err'); return; }

      // ① شيل فوراً من الشاشة
      _optimisticRemove(type, id);
      toast(`✅ تمت الموافقة على تعديل ${cfg.label}`,'ok');

      // ② اكمل DB في الخلفية — نمرر item مباشرةً لأنه اتحذف من approvalState بخطوة _optimisticRemove
      const _capturedItem = item;
      (async () => {
        const res = await _processEditApproval(type, id, _capturedItem);
        if (!res.ok) toast('خطأ في حفظ الموافقة: '+res.message,'err');
        invalidateCache();
        loadApprovalQueue();
      })();
      return;
    }

    // ── معالجة طلبات الإلغاء ──
    if (type === 'reversal') {
      const item = approvalState.all.find(r => r._type === 'reversal' && String(r.id) === String(id));
      if (!item) { toast('لم يُعثر على طلب الإلغاء','err'); return; }

      // ① شيل فوراً — نمرر item مباشرةً لأنه اتحذف من approvalState بخطوة _optimisticRemove
      const _capturedItem = item;
      _optimisticRemove(type, id);
      toast('✅ تم تنفيذ الإلغاء بقيد عكسي','ok');

      // ② اكمل في الخلفية — نفس النواة المشتركة مع approveAll
      (async () => {
        const res = await _processReversalApproval(id, _capturedItem);
        if (!res.ok) toast('خطأ في تنفيذ الإلغاء: '+res.message,'err');
        invalidateCache();
        loadApprovalQueue();
      })();
      return;
    }

    // ✅ خذ نسخة من بيانات السجل قبل إزالته من القائمة (الإزالة المتفائلة تمسحه من approvalState.all)
    const approvedItem = approvalState.all.find(r => r._type === type && String(r.id) === String(id));

    // ① شيل فوراً من الشاشة
    _optimisticRemove(type, id);
    toast('✅ تمت الموافقة','ok');

    // ② اكمل DB في الخلفية
    (async () => { try {
    // ✅ فاتورة بيع = كل سيارات نفس inv_no دفعة واحدة، لا سطر واحد فقط — موافقة واحدة للفاتورة كاملة
    const isSaleInvoice = type === 'sale' && approvedItem?.inv_no && approvedItem?.file_no;
    const saleInvoiceFilter = isSaleInvoice
      ? { system_type:`eq.${state.system}`, file_no:`eq.${approvedItem.file_no}`, inv_no:`eq.${approvedItem.inv_no}` }
      : null;
    // ✅ فحص idempotency: لو السجل أُعتمد فعلاً (لم يعد draft) — توقف بدون تكرار القيود
    const patched = isSaleInvoice
      ? await apiPatch(cfg.table, { ...saleInvoiceFilter, post_status:`eq.draft` }, { post_status:'posted' })
      : await apiPatch(cfg.table, { id:`eq.${id}`, post_status:`eq.draft` }, { post_status:'posted' });
    if (!patched?.length) return;
    // ✅ لو فشل إنشاء القيد بعد الموافقة — رجّع السجل (أو الفاتورة كاملة) لـ draft ليظهر في قائمة الاعتمادات من جديد
    const revertToDraft = async () => {
      if (isSaleInvoice) await apiPatch(cfg.table, saleInvoiceFilter, { post_status:'draft' });
      else await apiPatch(cfg.table, { id:`eq.${id}` }, { post_status:'draft' });
      toast(`⚠️ فشلت الموافقة على ${cfg.label} — أُعيد لقائمة الاعتمادات`,'warn');
    };
    // ✅ شراء/دفعة/مصروف/صرف شريك — دالة مشتركة مع _ensureApprovalJE (كانت 5 نسخ منفصلة)
    if (type === 'purchase' || type === 'payment' || type === 'expense' || type === 'payout') {
      if (approvedItem) {
        try { await _createApprovalJE(type, approvedItem, state.system); }
        catch(e) { await revertToDraft(); throw e; }
      }
    }
    if (type === 'sale') {
      const item = approvedItem;
      if (item && item.inv_no && item.file_no) {
        // ✅ قفل بـPromise مشترك لمنع تكرار القيد عند موافقات فردية متسارعة على
        // سيارات متعددة من نفس الفاتورة (نفس النواة المستخدمة في _ensureApprovalJE)
        try {
          await _ensureSaleJE(state.system, item.file_no, item.inv_no, item.sale_date, item.customer);
        } catch(e) { await revertToDraft(); throw e; }

        // ✅ OPTION B: تحصيلات مرتبطة بهذه الفاتورة (مدفوعة فعلاً) — اعتماد تلقائي
        // بدالة مشتركة مع _ensureApprovalJE (كانت نسختين منفصلتين تفرَّقتا)
        await _approveLinkedPaidCollections(state.system, item.file_no, item.inv_no, item.customer);
      }
    }
    if (type === 'collection') {
      // ✅ القيد يُولَّد فقط إذا كان مدفوعاً فعلاً (paid_date موجود) — دالة مشتركة مع _ensureApprovalJE
      // لو لا يوجد paid_date → التحصيل معلق، يظهر في قائمة "مستحق" ليُسجَّل الدفع لاحقاً، لا قيد الآن
      if (approvedItem) {
        try { await _createApprovalJE(type, approvedItem, state.system); }
        catch(e) { await revertToDraft(); throw e; }
      }
    }
    // ✅ سجّل "من وافق" على المسودة (كان غير مسجَّل — فجوة تتبّع)
    await logAudit('APPROVE', cfg.table, approvedItem?.file_no || null, approvedItem || null, { approved_at: today() }, `موافقة ${cfg.label} ${approvedItem?.ref_no || approvedItem?.inv_no || id}`);
    invalidateCache();
    loadApprovalQueue(); // refresh هادي في الخلفية
    } catch(e) { toast('خطأ في حفظ الموافقة: '+e.message,'err'); } })();
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

export async function rejectItem(type, id) {
  const cfg = APPROVAL_CONFIG[type];
  if (!cfg) return;

  // ── رفض طلب التعديل — يرجع السجل والقيد للقيمة قبل التعديل ──
  if (type === 'payment_edit' || type === 'expense_edit' || type === 'collection_edit') {
    const srcType = type.replace('_edit','');
    const tableMap = { payment:'payments', expense:'expenses', collection:'collections' };
    const tbl = tableMap[srcType];
    const item = approvalState.all.find(r => r._type === type && String(r.id) === String(id));

    _optimisticRemove(type, id);
    toast('↩ تم رفض التعديل — رجعت للحالة الأصلية','ok');

    (async () => { try {
      // ✅ ابحث في سجل التدقيق عن القيمة الأصلية (قبل التعديل) لهذا السجل
      const logs = await apiGetAll('audit_log', {
        select: 'old_value,created_at', system_type:`eq.${state.system}`,
        table_name:`eq.${tbl}`, action:`eq.EDIT`, order:'id.desc', limit: 50,
      });
      let oldRow = null;
      for (const log of (logs||[])) {
        try {
          const parsed = JSON.parse(log.old_value);
          if (String(parsed?.id) === String(id)) { oldRow = parsed; break; }
        } catch(e) {}
      }
      if (!oldRow) {
        // لا يوجد سجل تدقيق — لا يمكن استرجاع القيمة الأصلية، نُرجع الحالة لـ posted فقط
        await apiPatch(tbl, { id:`eq.${id}`, post_status:`eq.pending_edit` }, { post_status:'posted' });
        toast('⚠️ لم يُعثر على القيمة الأصلية في سجل التدقيق — تم إلغاء حالة "معلّق" فقط بدون عكس القيد','warn');
        invalidateCache();
        loadApprovalQueue();
        return;
      }

      const currentRows = await apiGetAll(tbl, { select:'*', id:`eq.${id}` });
      const current = currentRows?.[0];
      if (!current || current.post_status !== 'pending_edit') return; // idempotency

      const newAmount = +current.amount || 0;
      const oldAmount = +oldRow.amount || 0;

      // ✅ استرجاع الحقول الأصلية للسجل (باستثناء المعرّف والتواريخ النظامية)
      const restoreData = { ...oldRow, post_status: 'posted' };
      delete restoreData.id; delete restoreData.created_at; delete restoreData.updated_at;
      await apiPatch(tbl, { id:`eq.${id}` }, restoreData);

      // ✅ عكس القيد المحاسبي للقيمة الأصلية (وكذلك اسم الطرف لو تغيّر)
      const contactPatch = (srcType === 'payment' && oldRow.payer !== current.payer) ? oldRow.payer : null;
      // ✅ إرجاع تاريخ القيد لتاريخ العملية الأصلي (اتساقاً مع مزامنة التاريخ عند التعديل)
      const _dateField = { payments:'pay_date', expenses:'exp_date', collections:'paid_date', partner_payouts:'pay_date', sales:'sale_date', purchase_orders:'po_date', operating_expenses:'exp_date' }[tbl];
      await updateJEInPlace({
        sys: state.system, fileNo: oldRow.file_no,
        refTable: tbl, refId: id,
        oldAmount: newAmount, newAmount: oldAmount,
        contactPatch,
        newDate: _dateField ? (oldRow[_dateField] || null) : null,
      });

      await logAudit('EDIT_REJECTED', tbl, oldRow.file_no, current, oldRow, `رفض تعديل ${cfg.label} ${oldRow.ref_no||id}`);
      invalidateCache();
      loadApprovalQueue();
    } catch(e) { toast('خطأ: '+e.message,'err'); } })();
    return;
  }

  // ── استرداد طلب الإلغاء (reversal) — يرجع للحالة posted ──
  if (type === 'reversal') {
    const item = approvalState.all.find(r => r._type === 'reversal' && String(r.id) === String(id));
    if (!item) return;
    const tableMap = { payment:'payments', expense:'expenses', collection:'collections', payout:'partner_payouts' };
    const tbl = tableMap[item._srcType];
    if (tbl) {
      _optimisticRemove(type, id);
      toast('↩ تم استرداد العملية — رجعت لحالة مرحّلة','ok');
      (async () => { try {
        await apiPatch(tbl, { id:`eq.${item.id}` }, { post_status:'posted', notes:`${item.notes||''} | استُرد طلب الإلغاء بتاريخ ${today()}`.trim() });
        invalidateCache();
        loadApprovalQueue();
      } catch(e) { toast('خطأ: '+e.message,'err'); } })();
    }
    return;
  }

  // تأكيد الرفض — مع توضيح أن السجل هيتعلّم "مرفوض" وليس محذوفاً نهائياً
  showConfirm(
    '🗑 رفض العملية',
    `سيتم وضع العملية كـ "مرفوضة" (cancelled).\nيمكن للمدير مراجعتها لاحقاً من سجل المراجعة.\n\nالمسح النهائي يحتاج موافقة مدير.`,
    async () => {
      try {
        const item = approvalState.all.find(r => r._type === type && String(r.id) === String(id));

        // ① شيل فوراً
        _optimisticRemove(type, id);
        toast('⊘ تم رفض العملية — وضعت كـ "مرفوضة"', 'ok');

        // ② اكمل في الخلفية
        (async () => { try {
          if (type === 'purchase' && item?.file_no) {
            const fn  = item.file_no;
            const sys = state.system;
            await apiPatch('purchase_orders', { id:`eq.${id}` }, {
              post_status: 'cancelled',
              notes: `${item.notes||''} | مرفوض بتاريخ ${today()}`.trim(),
            });
            for (const t of ['payments','expenses','sales','collections','partner_payouts']) {
              try {
                const rows = await apiGetAll(t, { select:'id,post_status', system_type:`eq.${sys}`, file_no:`eq.${fn}`, post_status:'eq.draft' });
                for (const r of (rows||[])) {
                  await apiPatch(t, { id:`eq.${r.id}` }, { post_status:'cancelled' });
                }
              } catch(e) { console.warn(`cancelCascade ${t}:`, e.message); }
            }
            await logAudit('REJECT','purchase_orders', fn, item, null, `رفض أمر شراء draft ملف ${fn}`);
          } else {
            await apiPatch(cfg.table, { id:`eq.${id}` }, {
              post_status: 'cancelled',
              notes: `${item?.notes||''} | مرفوض بتاريخ ${today()}`.trim(),
            });
            await logAudit('REJECT', cfg.table, item?.file_no||null, item, null, `رفض ${cfg.label} #${id}`);
          }
          invalidateCache();
          loadApprovalQueue();
        } catch(e) { toast('خطأ في حفظ الرفض: '+e.message,'err'); } })();
      } catch(e) { toast('خطأ: '+e.message,'err'); }
    }
  );
}


// تعديل مباشر من صف القائمة
export async function editApprovalRow(type, id) {
  approvalState.currentItem = {
    type, id,
    item: approvalState.all.find(r => r._type === type && String(r.id) === String(id))
  };
  await editFromDetail();
}

// إلغاء مباشر من صف القائمة
export async function cancelApprovalRow(type, id) {
  const cfg = APPROVAL_CONFIG[type];
  if (!cfg) return;
  try {
    const item = approvalState.all.find(r => r._type === type && String(r.id) === String(id));
    await apiPatch(cfg.table, { id:`eq.${id}` }, { post_status:'cancelled' });
    // ✅ سجّل الإلغاء (كان غير مسجَّل — نفس فجوة كانت موجودة في rejectItem قبل إصلاحها)
    await logAudit('REJECT', cfg.table, item?.file_no||null, item||null, null, `إلغاء سريع ${cfg.label} #${id}`);
    invalidateCache();
    toast('⊘ تم إلغاء العملية','ok');
    await loadApprovalQueue();
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

// ════════════════════════════════════════════════════════════
// ✅ ضمان قيد بيع واحد فقط لكل فاتورة — يمنع التكرار عند الموافقة الفردية
// المتسارعة على سيارات متعددة من نفس الفاتورة (كل نقرة تستدعي هذه الدالة
// بنفس مفتاح الفاتورة؛ النقرات المتزامنة تنتظر نفس الـPromise بدل بدء
// فحص-ثم-إنشاء منفصل، فلا تتسابق على "هل يوجد قيد؟"). يُستخدم من
// approveItem و _ensureApprovalJE معاً حتى لا يتفرّق المنطق.
// ════════════════════════════════════════════════════════════
const _saleJEInFlight = new Map(); // key: `${sys}:${fileNo}:${invNo}` → Promise
export async function _ensureSaleJE(sys, fileNo, invNo, dateFallback, customerFallback) {
  if (!fileNo || !invNo) return;
  const key = `${sys}:${fileNo}:${invNo}`;
  if (_saleJEInFlight.has(key)) return _saleJEInFlight.get(key);

  const p = (async () => {
    const allInvSales = await apiGetAll('sales', {
      select:'sale_price,vin', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, inv_no:`eq.${invNo}`,
    });
    const totalAmt = (allInvSales||[]).reduce((s,r)=>s+(+r.sale_price||0),0);
    if (totalAmt <= 0) return;
    // ✅ الحساب والترحيل بقى ذرّي داخل القاعدة (post_sale_je RPC — sql/post_sale_je.sql)
    // بدل calcCOGS+je_sale على العميل: يمنع سباق فاتورتين لنفس الملف اتعتمدوا
    // بفرق ثوانٍ (زي حادثة BOX-138 70700/-004)، ويتأكد idempotency عبر ref_id
    // حقيقي (رقم الفاتورة) بدل مطابقة نص description القديمة — والقيد بيترحّل
    // ومعاه ref_id=invNo فعليًا (كان دايمًا null قبل كده)
    const [row] = await apiRpc('post_sale_je', {
      p_sys: sys, p_file_no: fileNo, p_inv_no: invNo,
      p_customer: customerFallback || '', p_date: dateFallback || today(),
      p_sold_vins: (allInvSales||[]).map(s=>s.vin).filter(Boolean),
      p_sale_amount: totalAmt,
    });
    if (!row) throw new Error('post_sale_je: لم يرجع نتيجة — تحقق من تنفيذ sql/post_sale_je.sql على القاعدة');
  })();

  _saleJEInFlight.set(key, p);
  try { await p; } finally { _saleJEInFlight.delete(key); }
  return p;
}

// ════════════════════════════════════════════════════════════
// ✅ إنشاء قيد الموافقة لسجل عادي (شراء/دفعة/مصروف/تحصيل/صرف شريك) — بأمان (idempotent)
// دالة واحدة من approveItem (فردي) و_ensureApprovalJE (جماعي عبر approveAll) — كانتا
// 5 نسخ منفصلة لكل نوع، تفرَّقت حتى في القيمة الافتراضية لطريقة الدفع (مصروف/صرف شريك
// كانا 'نقد' في نسخة و'تحويل بنكي' في الأخرى). فحص ref_id قبل الإنشاء يمنع التكرار
// حتى لو استُدعيت الدالة مرتين لنفس السجل.
// ════════════════════════════════════════════════════════════
export async function _createApprovalJE(type, record, sys) {
  const refMap = { collection:'collections', payment:'payments', expense:'expenses', payout:'partner_payouts' };

  if (refMap[type] && record.id != null) {
    const ex = await apiGet('journal_entries', {
      select:'entry_no', system_type:`eq.${sys}`,
      ref_table:`eq.${refMap[type]}`, ref_id:`eq.${record.id}`, post_status:'eq.posted', limit:1,
    });
    if (ex?.length) return; // القيد موجود بالفعل
  }

  if (type === 'purchase') {
    if (!record.file_no) return;
    const ex = await apiGet('journal_entries', { select:'entry_no', system_type:`eq.${sys}`, ref_table:'eq.purchase_orders', file_no:`eq.${record.file_no}`, post_status:'eq.posted', limit:1 });
    if (!ex?.length) await je_purchase({ sys, date:record.po_date||today(), amount:+record.total_purchase||0, fileNo:record.file_no, supplier:record.supplier||'', refId:record.id||null });
  } else if (type === 'payment') {
    await je_payment({ sys, date:record.pay_date||today(), amount:+record.amount||0, fileNo:record.file_no, refId:record.id||null, supplierName:record.supplier||'', payerName:record.payer||'', method:record.pay_method||'تحويل بنكي' });
  } else if (type === 'expense') {
    await je_expense({ sys, date:record.exp_date||today(), amount:+record.amount||0, fileNo:record.file_no, refId:record.id||null, desc:record.description||'مصروف', expType:record.exp_type||'أخرى', method:record.pay_method||'تحويل بنكي' });
  } else if (type === 'payout') {
    await je_payout({ sys, date:record.pay_date||today(), amount:+record.amount||0, fileNo:record.file_no, refId:record.id||null, partner:record.partner||'', method:record.pay_method||'تحويل بنكي' });
  } else if (type === 'collection') {
    // القيد يُولَّد فقط إذا كان مدفوعاً فعلاً (paid_date موجود) — لو مستحق فقط، لا قيد الآن
    if (record.paid_date) await je_collection({ sys, date:record.paid_date, amount:+record.amount||0, fileNo:record.file_no, refId:record.id||null, customer:record.customer||'', invNo:record.inv_no||'', method:record.pay_method||'تحويل بنكي' });
  }
}

// ════════════════════════════════════════════════════════════
// ✅ إنشاء قيد الموافقة بأمان (idempotent) — يُنشئ القيد فقط لو غير موجود.
// يُستخدم في approveAll بترتيب آمن: (قيد ثم ترحيل) حتى لا يبقى سجل posted بلا قيد
// لو انقطعت العملية. فحص-القيد-الموجود يمنع تكرار القيد عند إعادة المحاولة.
// ════════════════════════════════════════════════════════════
export async function _ensureApprovalJE(r, sys) {
  const t = r._type;
  if (t === 'payment' || t === 'expense' || t === 'payout' || t === 'collection' || t === 'purchase') {
    await _createApprovalJE(t, r, sys);
  } else if (t === 'sale' && r.inv_no && r.file_no) {
    // ✅ نفس القفل المشترك المستخدم في approveItem — يمنع تكرار القيد لو نفس الفاتورة
    // قيد المعالجة من approveAll ومن نقرة فردية متزامنة في نفس اللحظة
    await _ensureSaleJE(sys, r.file_no, r.inv_no, r.sale_date, r.customer);
    // ✅ تحصيلات مرتبطة بالفاتورة (مدفوعة فعلاً) — اعتماد تلقائي بدالة مشتركة مع approveItem
    await _approveLinkedPaidCollections(sys, r.file_no, r.inv_no, r.customer);
  }
}

// ════════════════════════════════════════════════════════════
// ✅ موافقة تلقائية على تحصيلات مرتبطة بفاتورة بيع (مدفوعة فعلاً، لا تزال draft)
// تُستخدم عند اعتماد الفاتورة نفسها — لا تحتاج تدخل المستخدم لاعتمادها لاحقاً.
// دالة واحدة من approveItem (فردي) و_ensureApprovalJE (جماعي عبر approveAll) —
// كانتا نسختين منفصلتين تفرَّقتا (واحدة بلا فحص ref_id، والأخرى بلا تسجيل تدقيق)
// ════════════════════════════════════════════════════════════
export async function _approveLinkedPaidCollections(sys, fileNo, invNo, fallbackCustomer) {
  if (!fileNo || !invNo) return;
  try {
    const linkedCols = await apiGetAll('collections', {
      select: '*', system_type: `eq.${sys}`, file_no: `eq.${fileNo}`, inv_no: `eq.${invNo}`, post_status: `eq.draft`,
    });
    for (const col of (linkedCols||[])) {
      if (!col.paid_date) continue; // مستحق فقط — لا قيد الآن
      // ✅ قيد ثم ترحيل (لا العكس) — حتى لا يبقى سجل posted بلا قيد لو انقطعت العملية
      const exC = await apiGet('journal_entries', {
        select:'entry_no', system_type:`eq.${sys}`, ref_table:'eq.collections', ref_id:`eq.${col.id}`, post_status:'eq.posted', limit:1,
      });
      if (!exC?.length) {
        try {
          await je_collection({
            sys, date: col.paid_date, amount: +col.amount, fileNo: col.file_no, refId: col.id || null,
            customer: col.customer || fallbackCustomer || '', invNo: col.inv_no || invNo || '',
            method: col.pay_method || 'تحويل بنكي',
          });
        } catch(jeErr) {
          toast(`⚠️ فشل قيد تحصيل ${col.inv_no||col.file_no}: ${jeErr.message}`, 'warn');
          continue; // لا تُرحِّل السجل بلا قيد
        }
      }
      const colPatched = await apiPatch('collections', { id:`eq.${col.id}`, post_status:`eq.draft` }, { post_status:'posted' });
      if (colPatched?.length) {
        // ✅ تسجيل تدقيق — كان مفقوداً تماماً في كلا النسختين القديمتين
        await logAudit('APPROVE', 'collections', col.file_no||fileNo, col, { approved_at: today(), auto: true, via: 'sale_approval' }, `موافقة تلقائية تحصيل مرتبط بفاتورة ${invNo}`);
      }
    }
  } catch(e) { console.warn('_approveLinkedPaidCollections:', e.message); }
}

// ════════════════════════════════════════════════════════════
// نواة معالجة "موافقة على طلب تعديل" — بلا أي تأثيرات على الواجهة
// (toast/refresh)، فقط عمليات القاعدة + ترجع {ok, message}.
// نفس المنطق المستخدم في approveItem تمامًا — يُستخدم من approveItem
// (فردي) وapproveAll (جماعي) معًا حتى لا يتكرر المنطق ولا يتفرّق.
// ════════════════════════════════════════════════════════════
export async function _processEditApproval(type, id, preloadedItem = null) {
  const cfg  = EDIT_TYPES[type];
  if (!cfg) return { ok:false, message:'نوع تعديل غير معروف' };
  const item = preloadedItem || approvalState.all.find(r => r._type === type && String(r.id) === String(id));
  if (!item) return { ok:false, message:'لم يُعثر على طلب التعديل' };

  try {
    // ✅ لو السجل كان "مسودة" قبل التعديل (لم يُرحَّل/يُنشأ له قيد من قبل) —
    // updateJEInPlace عند الحفظ لم يجد قيداً ليُحدّثه، فننشئ القيد الآن
    // بالبيانات الحالية (بعد التعديل) — يضمن ظهور المبلغ على اسم المورد/العميل الجديد
    const refTableMap = {
      purchase_edit:'purchase_orders', payment_edit:'payments', expense_edit:'expenses',
      collection_edit:'collections',   payout_edit:'partner_payouts',
      opex_edit:'operating_expenses',  sale_edit:'sales',
    };
    const refTable = refTableMap[type];
    if (refTable && (item.file_no || type === 'opex_edit')) {
      // ✅ opex_edit: je_opex يخزن ref_id = ref_no (نص) وليس id الرقمي
      // ✅ sale_edit: je_sale لا يخزن ref_id أصلاً — نطابق عبر file_no + وصف يحتوي رقم الفاتورة
      let existingJE;
      if (type === 'opex_edit') {
        existingJE = await apiGet('journal_entries', {
          select:'entry_no', system_type:`eq.${state.system}`,
          ref_table:`eq.operating_expenses`, ref_id:`eq.${item.ref_no||item.id}`, limit:'1',
        });
      } else if (type === 'sale_edit') {
        // ✅ post_sale_je (RPC) بيتحقق idempotency داخليًا بـref_id=inv_no
        // حقيقي — مفيش داعي لفحص مسبق هنا بمطابقة نص، فنسيب existingJE فاضية
        // ونخلي الاستدعاء تحت (يشتغل دايمًا لـsale_edit) يتولى الأمر بأمان
        existingJE = [];
      } else {
        existingJE = await apiGet('journal_entries', {
          select:'entry_no', system_type:`eq.${state.system}`,
          ref_table:`eq.${refTable}`, ref_id:`eq.${item.id}`, limit:'1',
        });
        // ✅ سند الشراء: je_purchase تاريخيًا ما كانتش بتكتب ref_id (تصحيح مستقبلي فقط) —
        // fallback بمطابقة file_no، نفس حارس _createApprovalJE (أسفل)
        if (!existingJE?.length && type === 'purchase_edit' && item.file_no) {
          existingJE = await apiGet('journal_entries', {
            select:'entry_no', system_type:`eq.${state.system}`,
            ref_table:'eq.purchase_orders', file_no:`eq.${item.file_no}`, post_status:'eq.posted', limit:'1',
          });
        }
      }
      if (!existingJE?.length) {
        if (type === 'purchase_edit') {
          await je_purchase({ sys:state.system, date:item.po_date||today(), amount:+item.total_purchase||0, fileNo:item.file_no, supplier:item.supplier||'', refId:item.id||null });
        } else if (type === 'payment_edit') {
          await je_payment({ sys:state.system, date:item.pay_date||today(), amount:+item.amount||0, fileNo:item.file_no, refId:item.id||null, supplierName:item.supplier||'', payerName:item.payer||'', method:item.pay_method||'تحويل بنكي' });
        } else if (type === 'expense_edit') {
          await je_expense({ sys:state.system, date:item.exp_date||today(), amount:+item.amount||0, fileNo:item.file_no, refId:item.id||null, desc:item.description||'مصروف', expType:item.exp_type||'أخرى', method:item.pay_method||'نقد' });
        } else if (type === 'collection_edit' && item.paid_date) {
          await je_collection({ sys:state.system, date:item.paid_date, amount:+item.amount||0, fileNo:item.file_no, refId:item.id||null, customer:item.customer||'', invNo:item.inv_no||'', method:item.pay_method||'تحويل بنكي' });
        } else if (type === 'payout_edit') {
          await je_payout({ sys:state.system, date:item.pay_date||today(), amount:+item.amount||0, fileNo:item.file_no, refId:item.id||null, partner:item.partner||'', method:item.pay_method||'نقد' });
        } else if (type === 'opex_edit') {
          await je_opex({ sys:state.system, date:item.exp_date||today(), amount:+item.amount||0, expType:item.exp_type||'أخرى', desc:item.description||'مصروف تشغيلي', method:item.pay_method||'نقد', refNo:item.ref_no||item.id });
        } else if (type === 'sale_edit' && item.inv_no && item.file_no) {
          const allInvSales = await apiGetAll('sales', { select:'sale_price,vin', system_type:`eq.${state.system}`, file_no:`eq.${item.file_no}`, inv_no:`eq.${item.inv_no}` });
          const totalAmt = (allInvSales||[]).reduce((s,x)=>s+(+x.sale_price||0),0);
          if (totalAmt > 0) {
            await apiRpc('post_sale_je', {
              p_sys: state.system, p_file_no: item.file_no, p_inv_no: item.inv_no,
              p_customer: item.customer || '', p_date: item.sale_date || today(),
              p_sold_vins: (allInvSales||[]).map(s=>s.vin).filter(Boolean),
              p_sale_amount: totalAmt,
            });
          }
        }
      }
    }

    // ✅ تعديل سند شراء قد يُنشئ دفعات شركاء جديدة بحالة pending_edit (بدون قيد بعد)
    // — أنشئ قيودها الآن مع الموافقة على التعديل
    if (type === 'purchase_edit' && item.file_no) {
      const pendingPayments = await apiGetAll('payments', {
        select:'*', system_type:`eq.${state.system}`,
        file_no:`eq.${item.file_no}`, post_status:`eq.pending_edit`,
      });
      for (const pmt of (pendingPayments||[])) {
        const hasJE = await apiGet('journal_entries', {
          select:'entry_no', system_type:`eq.${state.system}`,
          ref_table:`eq.payments`, ref_id:`eq.${pmt.id}`, limit:'1',
        });
        if (!hasJE?.length) {
          await je_payment({ sys:state.system, date:pmt.pay_date||today(), amount:+pmt.amount||0, fileNo:pmt.file_no, refId:pmt.id||null, supplierName:item.supplier||'', payerName:pmt.payer||'', method:pmt.pay_method||'تحويل بنكي' });
        }
        await apiPatch('payments', { id:`eq.${pmt.id}` }, { post_status:'posted' });
      }
    }

    // ✅ فحص idempotency: لو السجل اعتُمد فعلاً (لم يعد pending_edit) — توقف بدون تكرار
    let cleanPatched;
    if (type === 'sale_edit' && item.inv_no) {
      cleanPatched = await apiPatch('sales',
        { system_type:`eq.${state.system}`, inv_no:`eq.${item.inv_no}`, post_status:`eq.pending_edit` },
        { post_status: 'posted' }
      );
    } else {
      cleanPatched = await apiPatch(cfg.table, { id:`eq.${id}`, post_status:`eq.pending_edit` }, { post_status: 'posted' });
    }
    if (!cleanPatched?.length) return { ok:true, message:`${cfg.label}: كانت معتمدة مسبقاً`, already:true };

    await logAudit('EDIT_APPROVED', cfg.table, item.file_no, item, {}, `موافقة تعديل ${cfg.label} ${item.ref_no||item.file_no||item.inv_no||id}`);
    return { ok:true, message:`تمت الموافقة على تعديل ${cfg.label}` };
  } catch(e) {
    return { ok:false, message: `${cfg.label}: ${e.message}` };
  }
}

// نواة معالجة "موافقة على طلب إلغاء" — نفس منطق approveItem للـ reversal
export async function _processReversalApproval(id, preloadedItem=null) {
  const item = preloadedItem || approvalState.all.find(r => r._type === 'reversal' && String(r.id) === String(id));
  if (!item) return { ok:false, message:'لم يُعثر على طلب الإلغاء' };
  try {
    await voidTransaction(item._srcType, item, true);
    return { ok:true, message:'تم تنفيذ الإلغاء بقيد عكسي' };
  } catch(e) {
    return { ok:false, message: e.message };
  }
}

export async function approveAll() {
  const items = approvalState.filtered;
  if (!items.length) return;
  showConfirm(`موافقة على الكل`, `هل تريد الموافقة على ${items.length} عملية دفعة واحدة؟`, async () => {
    const sys = state.system;
    let okCount = 0, failCount = 0;
    const resultLines = [];
    // ✅ ترتيب آمن ضد الانقطاع/السباق: لكل عملية → أنشئ القيد (لو غير موجود) → ثم رحّل السجل.
    //    السجل لا يصير "posted" قبل وجود قيده؛ فلو انقطعت العملية يبقى draft ويعود لقائمة الاعتمادات.
    for (const r of items) {
      // ── طلبات التعديل: نفس نواة approveItem بالضبط، لا تجاهل صامت ──
      if (EDIT_TYPES[r._type]) {
        const res = await _processEditApproval(r._type, r.id);
        if (res.ok) okCount++; else failCount++;
        resultLines.push(`${res.ok ? '✅' : '❌'} ${_escHtml(res.message)}`);
        continue;
      }
      // ── طلبات الإلغاء (reversal): نفس نواة approveItem بالضبط ──
      if (r._type === 'reversal') {
        const res = await _processReversalApproval(r.id, r);
        if (res.ok) okCount++; else failCount++;
        resultLines.push(`${res.ok ? '✅' : '❌'} إلغاء — ${_escHtml(r._desc||r.id)}${res.ok?'':': '+_escHtml(res.message)}`);
        continue;
      }
      // ── الأنواع العادية (شراء/بيع/تحصيل/دفعة/صرف شريك) ──
      const cfg = APPROVAL_CONFIG[r._type];
      if (!cfg) { failCount++; resultLines.push(`❌ نوع غير معروف: ${_escHtml(r._type)}`); continue; }
      try {
        await _ensureApprovalJE(r, sys);
        // ✅ فاتورة بيع = كل سيارات نفس inv_no دفعة واحدة، لا سطر واحد فقط
        const patched = (r._type === 'sale' && r.inv_no && r.file_no)
          ? await apiPatch(cfg.table, { system_type:`eq.${sys}`, file_no:`eq.${r.file_no}`, inv_no:`eq.${r.inv_no}`, post_status:`eq.draft` }, { post_status:'posted' })
          : await apiPatch(cfg.table, { id:`eq.${r.id}`, post_status:`eq.draft` }, { post_status:'posted' });
        if (patched?.length) {
          okCount++;
          // ✅ سجّل "من وافق" (موافقة جماعية)
          await logAudit('APPROVE', cfg.table, r.file_no||null, r, { approved_at: today(), bulk:true }, `موافقة جماعية ${cfg.label} ${r.ref_no||r.inv_no||r.id}`);
          resultLines.push(`✅ ${_escHtml(cfg.label)} — ${_escHtml(r._desc||r.ref_no||r.inv_no||r.id)}`);
        } else {
          failCount++;
          resultLines.push(`❌ ${_escHtml(cfg.label)} — ${_escHtml(r._desc||r.ref_no||r.id)}: كانت معتمدة مسبقاً أو تغيّرت حالتها`);
        }
      } catch(jeErr) {
        failCount++;
        console.warn(`approveAll failed ${r._type} ${r.id}:`, jeErr.message);
        resultLines.push(`❌ ${_escHtml(cfg.label)} — ${_escHtml(r._desc||r.ref_no||r.id)}: ${_escHtml(jeErr.message)}`);
      }
    }
    invalidateCache();
    toast(`✅ تمت الموافقة على ${okCount} عملية${failCount?` · ${failCount} لم تكتمل`:''}`, failCount?'warn':'ok');
    // ✅ تفاصيل واضحة لكل عملية بدل التجاهل الصامت السابق
    if (resultLines.length) {
      showConfirmHtml(
        failCount ? `⚠️ تفاصيل الموافقة الجماعية (${okCount} نجح · ${failCount} لم يكتمل)` : `✅ تفاصيل الموافقة الجماعية (${okCount} نجح)`,
        `<div style="text-align:right;font-size:13px;line-height:1.8;max-height:50vh;overflow-y:auto">${resultLines.join('<br>')}</div>`,
        async () => {}
      );
    }
    await loadApprovalQueue();
  });
}

// تحديث badge في الـ sidebar عند تحميل أي صفحة
export async function updateApprovalBadge() {
  try {
    const sys = state.system;
    const [s,e,c,p,po] = await Promise.all([
      apiGetAll('sales',           { select:'id', system_type:`eq.${sys}`, post_status:`eq.draft` }),
      apiGetAll('expenses',        { select:'id', system_type:`eq.${sys}`, post_status:`eq.draft` }),
      apiGetAll('collections',     { select:'id', system_type:`eq.${sys}`, post_status:`eq.draft` }),
      apiGetAll('payments',        { select:'id', system_type:`eq.${sys}`, post_status:`eq.draft` }),
      apiGetAll('partner_payouts', { select:'id', system_type:`eq.${sys}`, post_status:`eq.draft` }),
    ]);
    const total = (s?.length||0)+(e?.length||0)+(c?.length||0)+(p?.length||0)+(po?.length||0);
    const badge = el('approval-badge');
    if (badge) { badge.textContent = total||''; badge.style.display = total?'':'none'; }
  } catch(e) { console.warn('updateApprovalBadge:', e.message); }
}

// ════════════════════════════════════════
// جاري الشريك — Partner Account Ledger
// ════════════════════════════════════════
const partnerAccountState = { partner: null, entries: [] };

export async function openPartnerAccountLedger(partnerName) {
  partnerAccountState.partner = partnerName;
  el('pa-partner-name').textContent = partnerName;
  el('pa-ledger-table').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري التحميل...</div>';
  openModal('partnerAccountModal');
  await loadPartnerAccountLedger();
}

export async function loadPartnerAccountLedger() {
  const partner = partnerAccountState.partner;
  const sys     = state.system;
  if (!partner) return;

  try {
    // ── جلب كل البيانات دفعة واحدة ──
    const [allDeals, allPayouts, accountEntries, partnerPayments] = await Promise.all([
      apiGetAll('partners_master', { select:'file_no,share_percent', system_type:`eq.${sys}`, partner:`eq.${partner}` }),
      apiGetAll('partner_payouts', { select:'*', system_type:`eq.${sys}`, partner:`eq.${partner}`, order:'pay_date.asc' }),
      apiGet('partner_accounts',   { select:'*', system_type:`eq.${sys}`, partner:`eq.${partner}`, order:'entry_date.asc' }),
      // ما دفعه الشريك للمورد — للعرض التفصيلي لكل دفعة (الأرقام الإجمالية من المصدر الموحّد أدناه)
      apiGetAll('payments', { select:'*', system_type:`eq.${sys}`, payer:`eq.${partner}`, order:'pay_date.asc' }),
    ]);

    const shareMap  = {};
    (allDeals||[]).forEach(pm => { shareMap[pm.file_no] = (+pm.share_percent||0)/100; });
    const fileNos = Object.keys(shareMap);

    // ✅ تسوية موحّدة لكل صفقة — computePartnerSettlement (core.js) بدل حلقة
    // P&L محلية منفصلة (كانت نسخة ثالثة من نفس المعادلة، وناقصة مصاريف الجيب
    // والتحصيلات الممسوكة تمامًا من هذا الدفتر). نفس مصدر تبويب الملخص وكشف
    // حساب الشريك بالضبط.
    const settlements  = await Promise.all(fileNos.map(fn => computePartnerSettlement(fn, sys)));
    const settleByFile = {};
    fileNos.forEach((fn,i) => { settleByFile[fn] = settlements[i]; });

    // ── بناء الحركات الكاملة لكل صفقة ──
    const allEntries = [];
    let totalLiability = 0;   // إجمالي حصته في التكلفة الكاملة (ما عليه)
    let totalPaid      = 0;   // إجمالي ما دفعه للمورد
    let totalExpPaid   = 0;   // إجمالي مصاريف دفعها من جيبه (كانت غائبة تمامًا)
    let totalCollHeld  = 0;   // إجمالي تحصيلات عملاء ممسوكة — تقلل المستحق
    let totalProfit    = 0;   // إجمالي حصته في الربح
    let totalPayout    = 0;   // إجمالي ما استرده

    for (const fn of fileNos) {
      const share = shareMap[fn];
      const pct   = Math.round(share * 100);
      const x = (settleByFile[fn]?.partners||[]).find(p => p.name === partner)
        || { fairShare:0, expPaid:0, collectionsHeld:0, profitShare:0 };

      // 1. حصة الشريك في التكلفة الكاملة — شراء + مصاريف (مرجعي فقط)
      // ✅ _sign:0 عمدًا: ده رقم مرجعي (نصيبه العادل لو اتقسمت التكلفة بالتساوي)
      // مش معاملة نقدية فعلية — لو دخل في حساب "الرصيد" التراكمي جنب المعاملات
      // الحقيقية (دفعات/أرباح) هيطلع رقم هجين مايطابقش "إجمالي المستحق له" في
      // نفس المستند ولا في أي شاشة تانية بالتطبيق (باج مُكتشف فعليًا من مراجعة
      // كشف حساب مطبوع — الرصيد التراكمي كان بيوقف عند رقم مختلف عن الكارت العلوي)
      if (x.fairShare > 0) {
        totalLiability += x.fairShare;
        allEntries.push({
          type: 'liability', file_no: fn,
          amount: x.fairShare, entry_date: null,
          description: `حصة ${pct}% في التكلفة الكاملة (شراء + مصاريف) — مرجعي، لا يدخل في الرصيد`,
          _sign: 0,
        });
      }

      // 2. ما دفعه للمورد في هذه الصفقة (يُقلّل المديونية) — تفصيل كل دفعة
      const paidInDeal = (partnerPayments||[])
        .filter(p => p.file_no === fn && isPosted(p))
        .reduce((s,p) => s + (+p.amount||0), 0);
      if (paidInDeal > 0) {
        totalPaid += paidInDeal;
        // سجّل كل دفعة منفصلة
        (partnerPayments||[]).filter(p => p.file_no === fn && isPosted(p)).forEach(p => {
          allEntries.push({
            type: 'partner_payment', file_no: fn,
            amount: +p.amount||0, entry_date: p.pay_date||null,
            description: `دفعة للمورد — ${p.pay_method||''}${p.document?' | '+p.document:''}`,
            pay_method: p.pay_method, document: p.document,
            _sign: +1,  // ما دفعه = يُقلّل ما عليه
          });
        });
      }

      // 2.5 مصاريف دفعها من جيبه في هذه الصفقة — من حساب 2400 (كانت غائبة من هذا الدفتر)
      if (x.expPaid > 0.01) {
        totalExpPaid += x.expPaid;
        allEntries.push({
          type: 'partner_expense', file_no: fn,
          amount: x.expPaid, entry_date: null,
          description: `مصاريف دفعها من جيبه — صفقة ${fn}`,
          _sign: +1,
        });
      }

      // 2.6 تحصيلات عملاء ممسوكة — فلوس في إيده فعليًا فتقلل المستحق له
      if (x.collectionsHeld > 0.01) {
        totalCollHeld += x.collectionsHeld;
        allEntries.push({
          type: 'collection_held', file_no: fn,
          amount: x.collectionsHeld, entry_date: null,
          description: `تحصيلات عملاء ممسوكة — صفقة ${fn}`,
          _sign: -1,
        });
      }

      // 3. حصته في الربح/الخسارة
      const dealProfit = x.profitShare;
      if (Math.abs(dealProfit) > 0.001) {
        totalProfit += dealProfit;
        allEntries.push({
          type: dealProfit >= 0 ? 'profit_credit' : 'loss_debit',
          file_no: fn, amount: Math.abs(dealProfit), entry_date: null,
          description: `${dealProfit >= 0 ? 'حصة ربح' : 'حصة خسارة'} صفقة ${fn} (${pct}%)`,
          _sign: dealProfit >= 0 ? +1 : -1,
        });
      }
    }

    // 4. ما استرده (partner_payouts)
    (allPayouts||[]).filter(isPosted).forEach(p => {
      totalPayout += +p.amount||0;
      allEntries.push({
        ...p, type:'deal_payout',
        description: `صرف ${p.payout_type||''} — ${p.file_no||'—'}`,
        entry_date: p.pay_date||null,
        _sign: -1,
      });
    });

    // 5. سحوبات عامة وسلف
    (accountEntries||[]).forEach(e => {
      allEntries.push({
        ...e,
        _sign: (e.entry_type==='general_withdraw'||e.entry_type==='advance') ? -1 : +1,
      });
    });

    // ترتيب بالتاريخ
    allEntries.sort((a,b) => {
      const da = a.entry_date||a.pay_date||'0';
      const db = b.entry_date||b.pay_date||'0';
      return da.localeCompare(db);
    });

    partnerAccountState.entries  = allEntries;
    partnerAccountState.fileNos  = fileNos; // حفظ قائمة الصفقات للفلتر

    // ── ملء قائمة الصفقات في الفلتر ──
    const fileSelect = el('pa-filter-file');
    if (fileSelect) {
      const currentFile = fileSelect.value;
      fileSelect.innerHTML = '<option value="">كل الصفقات</option>' +
        fileNos.map(fn => `<option value="${fn}"${fn===currentFile?'selected':''}>${fn}</option>`).join('');
    }

    // ── حساب الأرصدة ──
    const netLiability = totalLiability - totalPaid - totalExpPaid; // المديونية المتبقية
    // ✅ إجمالي المستحق = رأس مال مدفوع + مصاريف من جيبه + حصة الربح − مسحوبات − تحصيلات ممسوكة
    // (نفس معادلة netDue الموحّدة في computePartnerSettlement — كانت هنا تتجاهل
    // مصاريف الجيب والتحصيلات الممسوكة تمامًا، فيفضل رقم مختلف عن باقي الشاشات)
    const totalDue     = totalPaid + totalExpPaid + totalProfit - totalPayout - totalCollHeld;

    // ── KPIs ──
    const liabilityColor = netLiability > 0.01 ? 'var(--red)' : 'var(--green)';
    const dueColor       = totalDue > 0.01 ? 'var(--green)' : totalDue < -0.01 ? 'var(--red)' : 'var(--text2)';

    el('pa-summary-kpis').innerHTML = `
      <div class="j-kpi" style="border-right:3px solid var(--blue)">
        <div class="j-kpi-label">إجمالي ما دفع للمورد</div>
        <div class="j-kpi-val" style="color:var(--blue)">${fmt(totalPaid)}</div>
        <div style="font-size:12px;color:${liabilityColor};font-weight:700">
          ${netLiability > 0.01 ? `⚠️ متبقي عليه ${fmt(netLiability)}` : netLiability < -0.01 ? `✅ دفع زيادة عن حصته بـ ${fmt(Math.abs(netLiability))}` : '✅ سوّى حصته بالظبط'}
        </div>
      </div>
      <div class="j-kpi" style="border-right:3px solid var(--green)">
        <div class="j-kpi-label">حصته في الأرباح</div>
        <div class="j-kpi-val" style="color:${totalProfit>=0?'var(--green)':'var(--red)'}">${fmt(Math.abs(totalProfit))}</div>
        <div style="font-size:12px;color:var(--text2)">${totalProfit>=0?'ربح صافي':'خسارة'}</div>
      </div>
      <div class="j-kpi" style="border-right:3px solid var(--accent)">
        <div class="j-kpi-label">إجمالي الصرف السابق</div>
        <div class="j-kpi-val" style="color:var(--accent)">${fmt(totalPayout)}</div>
      </div>
      <div class="j-kpi" style="border-right:3px solid var(--purple);background:var(--purple-dim)">
        <div class="j-kpi-label">إجمالي المستحق له</div>
        <div class="j-kpi-val" style="color:${dueColor};font-size:20px;font-weight:900">${fmt(Math.abs(totalDue))}</div>
        <div style="font-size:12px;color:${dueColor};font-weight:700">
          ${totalDue > 0.01 ? '← رأس مال + أرباح' : totalDue < -0.01 ? '← مدين عليه' : '← تسوية كاملة'}
        </div>
      </div>`;

    partnerAccountState.balance      = totalDue;
    partnerAccountState.netLiability = netLiability;
    partnerAccountState.totalPaid    = totalPaid;

    renderPartnerAccountLedger();
  } catch(e) {
    el('pa-ledger-table').innerHTML = `<div class="alert alert-err">خطأ: ${e.message}</div>`;
    console.error('loadPartnerAccountLedger:', e);
  }
}

export function renderPartnerAccountLedger() {
  const filterType = el('pa-filter-type')?.value || '';
  const filterFile = el('pa-filter-file')?.value || '';
  let entries = partnerAccountState.entries || [];

  // تطبيق فلتر الصفقة
  if (filterFile) entries = entries.filter(e => e.file_no === filterFile);
  // تطبيق فلتر النوع
  if (filterType) entries = entries.filter(e => (e.type||e.entry_type) === filterType);

  // ── إعادة حساب KPIs بناءً على الفلتر الحالي ──
  // نستخدم الـ entries المفلترة بالصفقة فقط (بدون فلتر النوع) للـ KPIs
  const entriesForKpi = filterFile
    ? (partnerAccountState.entries||[]).filter(e => e.file_no === filterFile)
    : (partnerAccountState.entries||[]);

  const kpiLiability = entriesForKpi.filter(e=>e.type==='liability').reduce((s,e)=>s+(+e.amount||0),0);
  const kpiPaid      = entriesForKpi.filter(e=>e.type==='partner_payment').reduce((s,e)=>s+(+e.amount||0),0);
  const kpiExpPaid   = entriesForKpi.filter(e=>e.type==='partner_expense').reduce((s,e)=>s+(+e.amount||0),0);
  const kpiCollHeld  = entriesForKpi.filter(e=>e.type==='collection_held').reduce((s,e)=>s+(+e.amount||0),0);
  const kpiProfit    = entriesForKpi.filter(e=>e.type==='profit_credit').reduce((s,e)=>s+(+e.amount||0),0)
                     - entriesForKpi.filter(e=>e.type==='loss_debit').reduce((s,e)=>s+(+e.amount||0),0);
  const kpiPayout    = entriesForKpi.filter(e=>e.type==='deal_payout'||e.type==='general_withdraw'||e.type==='advance').reduce((s,e)=>s+(+e.amount||0),0);
  const kpiNetLiab   = kpiLiability - kpiPaid - kpiExpPaid;
  // ✅ إجمالي المستحق = ما دفع + مصاريف من جيبه + حصة الربح − ما استرده − تحصيلات ممسوكة
  const kpiTotalDue  = kpiPaid + kpiExpPaid + kpiProfit - kpiPayout - kpiCollHeld;
  const liabColor    = kpiNetLiab > 0.01 ? 'var(--red)' : 'var(--green)';
  const balColor     = kpiTotalDue > 0.01 ? 'var(--green)' : kpiTotalDue < -0.01 ? 'var(--red)' : 'var(--text2)';
  const filterLabel  = filterFile ? ` — ${filterFile}` : ' — كل الصفقات';

  if (el('pa-summary-kpis')) el('pa-summary-kpis').innerHTML = `
    <div class="j-kpi" style="border-right:3px solid var(--blue)">
      <div class="j-kpi-label">ما دفع للمورد${filterLabel}</div>
      <div class="j-kpi-val" style="color:var(--blue)">${fmt(kpiPaid)}</div>
      <div style="font-size:12px;color:${liabColor};font-weight:700">
        ${kpiNetLiab > 0.01 ? `⚠️ متبقي عليه ${fmt(kpiNetLiab)}` : kpiNetLiab < -0.01 ? `✅ دفع زيادة عن حصته بـ ${fmt(Math.abs(kpiNetLiab))}` : '✅ سوّى حصته بالظبط'}
      </div>
    </div>
    <div class="j-kpi" style="border-right:3px solid var(--green)">
      <div class="j-kpi-label">حصته في الأرباح</div>
      <div class="j-kpi-val" style="color:${kpiProfit>=0?'var(--green)':'var(--red)'}">${fmt(Math.abs(kpiProfit))}</div>
      <div style="font-size:12px;color:var(--text2)">${kpiProfit>=0?'ربح':'خسارة'}</div>
    </div>
    <div class="j-kpi" style="border-right:3px solid var(--accent)">
      <div class="j-kpi-label">إجمالي الصرف السابق</div>
      <div class="j-kpi-val" style="color:var(--accent)">${fmt(kpiPayout)}</div>
    </div>
    <div class="j-kpi" style="border-right:3px solid var(--purple);background:var(--purple-dim)">
      <div class="j-kpi-label">إجمالي المستحق له</div>
      <div class="j-kpi-val" style="color:${balColor};font-size:20px;font-weight:900">${fmt(Math.abs(kpiTotalDue))}</div>
      <div style="font-size:12px;color:${balColor};font-weight:700">
        ${kpiTotalDue > 0.01 ? '← رأس مال + أرباح' : kpiTotalDue < -0.01 ? '← مدين عليه' : '← تسوية كاملة'}
      </div>
    </div>`;

  const typeLabels = {
    profit_credit:   'حصة ربح',
    loss_debit:      'حصة خسارة',
    liability:       'حصة في التكلفة',
    partner_payment: 'دفعة للمورد',
    partner_expense: 'مصاريف من جيبه',
    collection_held: 'تحصيل عملاء ممسوك',
    capital_credit:  'رأس مال مرصود',
    general_withdraw:'سحب عام',
    advance:         'سلفة',
    deal_payout:     'صرف أرباح',
  };
  const typeColors = {
    profit_credit:   'var(--green)',
    loss_debit:      'var(--red)',
    liability:       'var(--blue)',
    partner_payment: 'var(--accent)',
    partner_expense: 'var(--accent)',
    collection_held: 'var(--red)',
    capital_credit:  'var(--blue)',
    general_withdraw:'var(--red)',
    advance:         'var(--amber)',
    deal_payout:     'var(--purple)',
  };

  if (!entries.length) {
    el('pa-ledger-table').innerHTML = emptyHTML('📒','لا توجد حركات');
    return;
  }

  let runningBalance = 0;
  // ✅ الحساب من القديم للحديث (الترتيب الصح للرصيد التراكمي)
  // ✅ e._sign !== undefined بدل e._sign||fallback — الصفر falsy في JS، فكان
  // أي بند _sign:0 (مرجعي، زي "حصة في التكلفة") بيرجع للـfallback (+1) بدل
  // ما يتجاهل تمامًا من حساب الرصيد
  const rowsData = entries.map(e => {
    const type   = e.type || e.entry_type;
    const sign   = e._sign !== undefined ? e._sign : (type==='general_withdraw'||type==='advance'||type==='deal_payout' ? -1 : +1);
    const amount = +e.amount || 0;
    runningBalance += sign * amount;
    return { e, type, sign, amount, balance: runningBalance };
  });

  const rows = rowsData.map(({e, type, sign, amount, balance}) => {
    const color = typeColors[type] || 'var(--text2)';
    const date  = e.entry_date||e.pay_date||e.created_at?.split('T')[0]||'—';
    return `<tr>
      <td class="mono" style="font-size:13px;color:var(--text2)">${fmtDate(date)}</td>
      <td>
        <span style="background:${color}22;color:${color};padding:2px 8px;border-radius:10px;font-size:12px;font-weight:700">
          ${typeLabels[type]||type}
        </span>
      </td>
      <td style="font-size:12px">${e.description||'—'}</td>
      <td class="mono text-amber" style="font-size:13px">${e.file_no||'—'}</td>
      <td class="mono" style="color:${sign>0?'var(--green)':sign<0?'var(--red)':'var(--text2)'};font-weight:700">
        ${sign>0?'+':sign<0?'−':'≈'}${fmt(amount)}
      </td>
      <td class="mono" style="font-weight:700;color:${balance>=0?'var(--blue)':'var(--red)'}">
        ${sign===0 ? `<span style="color:var(--text2);font-weight:400">${fmt(balance)} (بدون تغيير)</span>` : fmt(balance)}
      </td>
      <td style="font-size:13px;color:var(--text2)">${e.document||e.notes||'—'}</td>
    </tr>`;
  }).join('');

  el('pa-ledger-table').innerHTML = `
    <table class="data-table" style="font-size:12px">
      <thead><tr>
        <th>التاريخ</th><th>النوع</th><th>البيان</th>
        <th>الملف</th><th>المبلغ</th><th>الرصيد</th><th>ملاحظات</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ══ تصدير كشف الشريك PDF ══
export function exportPartnerAccountPDF() {
  const partnerName = el('pa-partner-name')?.textContent || '—';
  const kpisEl      = el('pa-summary-kpis');
  const tableEl     = el('pa-ledger-table');
  if (!tableEl) { toast('لا توجد بيانات للتصدير', 'warn'); return; }

  const html = `
    <div class="page">
      <div class="print-header">
        <div class="logo-area">
          <img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMDAgMjAwIiB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCI+CiAgPGRlZnM+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImJnIiB4MT0iMCUiIHkxPSIwJSIgeDI9IjEzNSUiIHkyPSIxMzUlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgc3R5bGU9InN0b3AtY29sb3I6IzFDMTkxNyIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEwMCUiIHN0eWxlPSJzdG9wLWNvbG9yOiMyQzI5MjYiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImxpbmUiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjAlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgICBzdHlsZT0ic3RvcC1jb2xvcjojNzg3MTZDO3N0b3Atb3BhY2l0eTowIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iMjAlIiAgc3R5bGU9InN0b3AtY29sb3I6I0M4QzRCQTtzdG9wLW9wYWNpdHk6MSIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjgwJSIgIHN0eWxlPSJzdG9wLWNvbG9yOiNGOUY4RjY7c3RvcC1vcGFjaXR5OjEiLz4KICAgICAgPHN0b3Agb2Zmc2V0PSIxMDAlIiBzdHlsZT0ic3RvcC1jb2xvcjojRjlGOEY2O3N0b3Atb3BhY2l0eTowLjMiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9Imdsb3ciIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjAlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwJSIgICBzdHlsZT0ic3RvcC1jb2xvcjojNDQ0MDNDO3N0b3Atb3BhY2l0eTowIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iNTAlIiAgc3R5bGU9InN0b3AtY29sb3I6IzZCNjU2MDtzdG9wLW9wYWNpdHk6MC4zIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3R5bGU9InN0b3AtY29sb3I6IzQ0NDAzQztzdG9wLW9wYWNpdHk6MCIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICAgIDxmaWx0ZXIgaWQ9InNvZnQiPgogICAgICA8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIwLjgiLz4KICAgIDwvZmlsdGVyPgogICAgPGZpbHRlciBpZD0iZ2xvdy1maWx0ZXIiPgogICAgICA8ZmVHYXVzc2lhbkJsdXIgc3RkRGV2aWF0aW9uPSIyIiByZXN1bHQ9ImJsdXIiLz4KICAgICAgPGZlQ29tcG9zaXRlIGluPSJTb3VyY2VHcmFwaGljIiBpbjI9ImJsdXIiIG9wZXJhdG9yPSJvdmVyIi8+CiAgICA8L2ZpbHRlcj4KICA8L2RlZnM+CgogIDwhLS0g2K7ZhNmB2YrYqSAtLT4KICA8cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgcng9IjM4IiByeT0iMzgiIGZpbGw9InVybCgjYmcpIi8+CgogIDwhLS0g2KrZiNmH2Kwg2K7ZgdmK2YEg2YHZiiDYp9mE2YXZhtiq2LXZgSAtLT4KICA8ZWxsaXBzZSBjeD0iMTAwIiBjeT0iOTUiIHJ4PSI3NSIgcnk9IjUwIiBmaWxsPSIjNDQ0MDNDIiBvcGFjaXR5PSIwLjE1Ii8+CgogIDwhLS0g4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQ4pWQCiAgICAgICDYp9mE2LTYp9it2YbYqSDYqNiu2Lcg2YjYp9it2K8g2YXYqti12YQKICAgICAgINin2YTYrti3INmK2KjYr9ijINmF2YYg2KfZhNmK2LPYp9ixINmI2YrYtNmD2YQg2KfZhNi02KfYrdmG2KkKICAgICAgINir2YUg2YrYqtit2YjZhCDZhNit2LHZiNmBIFRJQwogIOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkOKVkCAtLT4KCiAgPCEtLSDYrti3INin2YTYs9ix2LnYqSDYrtmE2YEg2KfZhNi02KfYrdmG2KkgKG1vdGlvbiBsaW5lcykgLS0+CiAgPGxpbmUgeDE9IjE0IiB5MT0iODEiIHgyPSIzNCIgeTI9IjgxIiBzdHJva2U9IiM0NDQwM0MiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KICA8bGluZSB4MT0iMTAiIHkxPSI4OSIgeDI9IjM0IiB5Mj0iODkiIHN0cm9rZT0iIzNDMzgzNCIgc3Ryb2tlLXdpZHRoPSIxIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz4KICA8bGluZSB4MT0iMTYiIHkxPSI5NyIgeDI9IjM0IiB5Mj0iOTciIHN0cm9rZT0iIzQ0NDAzQyIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgoKICA8IS0tINin2YTYtNin2K3ZhtipIOKAlCDYrti3INmI2KfYrdivINmF2KrYtdmEIC0tPgogIDwhLS0g2KfZhNmF2LPYp9ixINin2YTZg9in2YXZhCDZhNmE2LTYp9it2YbYqSAtLT4KICA8cGF0aCBkPSIKICAgIE0gMzQgOTcKICAgIEwgMzQgNzAKICAgIEwgMTAwIDcwCiAgICBMIDEwMCA1OAogICAgTCAxMjggNTgKICAgIEwgMTQwIDcwCiAgICBMIDE1NSA3MAogICAgTCAxNTUgNzYKICAgIEwgMTYwIDc2CiAgICBMIDE2MCA5NwogICAgTCAxNTUgOTcKICAgIE0gMzQgOTcKICAgIEwgMTU1IDk3CiAgIgogICAgZmlsbD0ibm9uZSIKICAgIHN0cm9rZT0idXJsKCNsaW5lKSIKICAgIHN0cm9rZS13aWR0aD0iMi4yIgogICAgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIgogICAgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIKICAvPgoKICA8IS0tINiq2YHYp9i12YrZhCDYp9mE2LTYp9it2YbYqSDYr9in2K7ZhNmK2KkgLS0+CiAgPCEtLSDZgdin2LXZhCDYp9mE2YPYp9io2YrZhtipINmI2KfZhNi12YbYr9mI2YIgLS0+CiAgPGxpbmUgeDE9IjEwMCIgeTE9IjcwIiB4Mj0iMTAwIiB5Mj0iOTciIHN0cm9rZT0iI0M4QzRCQSIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC43Ii8+CgogIDwhLS0g2LLYrNin2Kwg2KfZhNmD2KfYqNmK2YbYqSAtLT4KICA8cGF0aCBkPSJNIDEwNSA2MyBMIDEyOCA2MyBMIDEzOCA3MyBMIDEwNSA3MyBaIgogICAgZmlsbD0iIzJDMjkyNiIgb3BhY2l0eT0iMC42Ii8+CiAgPHBhdGggZD0iTSAxMDUgNjMgTCAxMjggNjMgTCAxMzggNzMgTCAxMDUgNzMgWiIKICAgIGZpbGw9Im5vbmUiIHN0cm9rZT0iI0M4QzRCQSIgc3Ryb2tlLXdpZHRoPSIxIiBvcGFjaXR5PSIwLjUiLz4KCiAgPCEtLSDZhdi12KjYp9itINij2YXYp9mF2YogLS0+CiAgPHJlY3QgeD0iMTU2IiB5PSI4MiIgd2lkdGg9IjUiIGhlaWdodD0iNyIgcng9IjIiIGZpbGw9IiNGOUY4RjYiIG9wYWNpdHk9IjAuOSIvPgogIDwhLS0g2KPYtNi52Kkg2KfZhNiz2LHYudipINmF2YYg2KfZhNmF2LXYqNin2K0gLS0+CiAgPGxpbmUgeDE9IjE2MSIgeTE9IjgzIiB4Mj0iMTcwIiB5Mj0iNzkiIHN0cm9rZT0iI0Y5RjhGNiIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC43Ii8+CiAgPGxpbmUgeDE9IjE2MSIgeTE9Ijg2IiB4Mj0iMTcyIiB5Mj0iODUiIHN0cm9rZT0iI0Y5RjhGNiIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC42Ii8+CiAgPGxpbmUgeDE9IjE2MSIgeTE9Ijg5IiB4Mj0iMTcwIiB5Mj0iOTIiIHN0cm9rZT0iI0Y5RjhGNiIgc3Ryb2tlLXdpZHRoPSIxLjgiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgb3BhY2l0eT0iMC41Ii8+CgogIDwhLS0g2YXYtdio2KfYrSDYrtmE2YHZiiAtLT4KICA8cmVjdCB4PSIzMCIgeT0iODIiIHdpZHRoPSI1IiBoZWlnaHQ9IjciIHJ4PSIyIiBmaWxsPSIjQzAzOTJCIiBvcGFjaXR5PSIwLjgiLz4KCiAgPCEtLSDYp9mE2LnYrNmE2KfYqiDigJQg2KzYstihINmF2YYg2KfZhNiu2Lcg2KfZhNmF2KrYtdmEIC0tPgogIDwhLS0g2LnYrNmE2Kkg2K7ZhNmB2YrYqSDYo9mI2YTZiSAtLT4KICA8Y2lyY2xlIGN4PSI1NSIgY3k9Ijk3IiByPSIxMSIgZmlsbD0iIzFDMTkxNyIgc3Ryb2tlPSIjQzhDNEJBIiBzdHJva2Utd2lkdGg9IjEuOCIvPgogIDxjaXJjbGUgY3g9IjU1IiBjeT0iOTciIHI9IjUuNSIgZmlsbD0iIzJDMjkyNiIvPgogIDxjaXJjbGUgY3g9IjU1IiBjeT0iOTciIHI9IjIuNSIgZmlsbD0iI0M4QzRCQSIvPgoKICA8IS0tINi52KzZhNipINiu2YTZgdmK2Kkg2KvYp9mG2YrYqSAtLT4KICA8Y2lyY2xlIGN4PSI4MiIgY3k9Ijk3IiByPSIxMSIgZmlsbD0iIzFDMTkxNyIgc3Ryb2tlPSIjQzhDNEJBIiBzdHJva2Utd2lkdGg9IjEuOCIvPgogIDxjaXJjbGUgY3g9IjgyIiBjeT0iOTciIHI9IjUuNSIgZmlsbD0iIzJDMjkyNiIvPgogIDxjaXJjbGUgY3g9IjgyIiBjeT0iOTciIHI9IjIuNSIgZmlsbD0iI0M4QzRCQSIvPgoKICA8IS0tINi52KzZhNipINij2YXYp9mF2YrYqSAtLT4KICA8Y2lyY2xlIGN4PSIxNDAiIGN5PSI5NyIgcj0iMTEiIGZpbGw9IiMxQzE5MTciIHN0cm9rZT0iI0M4QzRCQSIgc3Ryb2tlLXdpZHRoPSIxLjgiLz4KICA8Y2lyY2xlIGN4PSIxNDAiIGN5PSI5NyIgcj0iNS41IiBmaWxsPSIjMkMyOTI2Ii8+CiAgPGNpcmNsZSBjeD0iMTQwIiBjeT0iOTciIHI9IjIuNSIgZmlsbD0iI0M4QzRCQSIvPgoKICA8IS0tINin2YTYtNin2LPZitmHIC0tPgogIDxsaW5lIHgxPSIzNCIgeTE9IjEwNiIgeDI9IjE2MiIgeTI9IjEwNiIgc3Ryb2tlPSIjNTc1MzRFIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgoKICA8IS0tIOKVkOKVkOKVkCDYrti3INmB2KfYtdmEIOKVkOKVkOKVkCAtLT4KICA8bGluZSB4MT0iMzAiIHkxPSIxMTgiIHgyPSIxNzAiIHkyPSIxMTgiIHN0cm9rZT0idXJsKCNnbG93KSIgc3Ryb2tlLXdpZHRoPSIxIi8+CgogIDwhLS0g4pWQ4pWQ4pWQINit2LHZiNmBIFRJQyDilZDilZDilZAgLS0+CiAgPHRleHQgeD0iMTAwIiB5PSIxNTEiCiAgICBmb250LWZhbWlseT0iJ1RyZWJ1Y2hldCBNUycsICdDZW50dXJ5IEdvdGhpYycsIEZ1dHVyYSwgc2Fucy1zZXJpZiIKICAgIGZvbnQtc2l6ZT0iMjgiCiAgICBmb250LXdlaWdodD0iNzAwIgogICAgZmlsbD0iI0Y5RjhGNiIKICAgIHRleHQtYW5jaG9yPSJtaWRkbGUiCiAgICBsZXR0ZXItc3BhY2luZz0iMTAiCiAgICBzdHlsZT0iZm9udC1zdHJldGNoOmNvbmRlbnNlZCI+VElDPC90ZXh0PgoKICA8IS0tIOKVkOKVkOKVkCDYp9mE2YbYtSDYp9mE2LXYutmK2LEg4pWQ4pWQ4pWQIC0tPgogIDx0ZXh0IHg9IjEwMCIgeT0iMTcyIgogICAgZm9udC1mYW1pbHk9IkFyaWFsLCBzYW5zLXNlcmlmIgogICAgZm9udC1zaXplPSI4LjUiCiAgICBmaWxsPSIjQThBNDlDIgogICAgdGV4dC1hbmNob3I9Im1pZGRsZSIKICAgIGxldHRlci1zcGFjaW5nPSIyLjUiPlRSQU5TSVQgSU5URVJOQVRJT05BTCBDTy48L3RleHQ+CgogIDwhLS0g2YbZgtin2Lcg2LPYsdi52Kkg2KrYstmK2YbZitipIC0tPgogIDxjaXJjbGUgY3g9IjE4IiBjeT0iODQiIHI9IjEuMiIgZmlsbD0iIzQ0NDAzQyIgb3BhY2l0eT0iMC44Ii8+CiAgPGNpcmNsZSBjeD0iMTMiIGN5PSI5MSIgcj0iMC45IiBmaWxsPSIjM0MzODM0IiBvcGFjaXR5PSIwLjYiLz4KICA8Y2lyY2xlIGN4PSIyMCIgY3k9Ijk5IiByPSIxLjIiIGZpbGw9IiM0NDQwM0MiIG9wYWNpdHk9IjAuOCIvPgoKPC9zdmc+Cg==" alt="TIC" style="width:40px;height:40px;border-radius:8px;display:block;margin-bottom:4px"><div class="company">Transit International</div>
          <div style="font-size:12px;color:#666">نظام ${state.system}</div>
        </div>
        <div>
          <div class="doc-title">كشف حساب شريك</div>
          <div style="font-size:13px;font-weight:700;margin-top:4px">${partnerName}</div>
          <div style="font-size:13px;color:#666">تاريخ الطباعة: ${new Date().toLocaleDateString('ar-KW')}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
        ${kpisEl ? kpisEl.innerHTML : ''}
      </div>
      ${tableEl.innerHTML}
    </div>`;
  openPrintOverlay(html, `كشف حساب — ${partnerName}`);
}

export function openGeneralWithdrawModal() {
  el('gw-amount').value  = '';
  el('gw-date').value    = today();
  el('gw-doc').value     = '';
  el('gw-notes').value   = '';
  el('gwError').style.display = 'none';
  const balance = partnerAccountState.balance || 0;
  if(el('gw-available')) el('gw-available').textContent = fmt(balance);
  el('gw-available').style.color = balance > 0 ? 'var(--purple)' : 'var(--red)';
  openModal('generalWithdrawModal');
}

export async function submitGeneralWithdraw() {
  const partner = partnerAccountState.partner;
  const amount  = parseFloat(el('gw-amount').value);
  const date    = el('gw-date').value;
  const method  = el('gw-method').value;
  const doc     = el('gw-doc').value.trim();
  const notes   = el('gw-notes').value.trim();

  if (!amount || !date) { showFieldErr('gwError','يرجى ملء المبلغ والتاريخ'); return; }

  const balance = partnerAccountState.balance || 0;
  if (amount > balance + 0.001) {
    const go = confirm(`⚠️ المبلغ (${fmt(amount)}) أكبر من الرصيد المتاح (${fmt(balance)}).\nهل تريد المتابعة؟`);
    if (!go) return;
  }

  try {
    await apiPost('partner_accounts', {
      system_type: state.system,
      partner, entry_type:'general_withdraw',
      amount, entry_date:date,
      description:`سحب عام — ${partner}`,
      document:doc||null, notes:notes||null
    });
    await logAudit('INSERT','partner_accounts', null, null, {partner, amount, date});
    markSaving('generalWithdrawModal'); closeModal('generalWithdrawModal');
    toast(`✅ تم تسجيل السحب العام — ${fmt(amount)}`,'ok');
    await loadPartnerAccountLedger();
  } catch(e) { showFieldErr('gwError','خطأ: '+e.message); }
}


// ════════════════════════════════════════════════════════
// DEAL NOTES — ملاحظات الصفقة
// تُخزَّن في audit_log بـ action='DEAL_NOTE'
// ════════════════════════════════════════════════════════

export function openDealNoteModal() {
  el('dn-text').value = '';
  el('dn-type').value = 'عام';
  el('dn-date').value = today();
  el('dnError').style.display = 'none';
  openModal('dealNoteModal');
  setTimeout(() => el('dn-text')?.focus(), 200);
}

export async function submitDealNote() {
  const text = el('dn-text').value.trim();
  const type = el('dn-type').value;
  const date = el('dn-date').value;
  const fn   = state.currentFileNo;

  if (!text) { showFieldErr('dnError', 'يرجى كتابة نص الملاحظة'); return; }
  if (!fn)   { showFieldErr('dnError', 'لا يوجد ملف محدد'); return; }

  const btn = el('dnSubmitBtn');
  btn.disabled = true; btn.textContent = '⏳ جاري الحفظ...';

  try {
    await apiPost('audit_log', {
      system_type: state.system,
      action:      'DEAL_NOTE',
      table_name:  'purchase_orders',
      file_no:     fn,
      notes:       text,
      old_value:   type,           // نحفظ النوع هنا
      new_value:   date || today(), // نحفظ التاريخ المحدد هنا
      user_email:  state.user?.email || 'unknown',
    });
    closeModal('dealNoteModal');
    toast('✅ تم حفظ الملاحظة', 'ok');
    await loadDealNotes();
  } catch(e) {
    showFieldErr('dnError', 'خطأ: ' + e.message);
  }
  btn.disabled = false; btn.textContent = '💾 حفظ الملاحظة';
}

export async function loadDealNotes() {
  const fn  = state.currentFileNo;
  const container = el('dealNotesContainer');
  if (!container || !fn) return;

  container.innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري التحميل...</div>';

  try {
    const notes = await apiGet('audit_log', {
      select:     '*',
      system_type:`eq.${state.system}`,
      action:     'eq.DEAL_NOTE',
      file_no:    `eq.${fn}`,
      order:      'created_at.desc',
    });

    if (!notes?.length) {
      container.innerHTML = `
        <div style="text-align:center;padding:48px 20px;color:var(--text2)">
          <div style="font-size:40px;margin-bottom:12px">📝</div>
          <div style="font-size:14px;font-weight:600;margin-bottom:6px">لا توجد ملاحظات بعد</div>
          <div style="font-size:12px">اضغط "إضافة ملاحظة" لتسجيل أول ملاحظة على هذه الصفقة</div>
        </div>`;
      return;
    }

    const typeStyles = {
      'عام':     { icon:'📌', bg:'var(--card2)',       border:'var(--border)',  color:'var(--text2)'  },
      'متابعة':  { icon:'🔔', bg:'var(--blue-dim)',    border:'var(--blue)',    color:'var(--blue)'   },
      'مشكلة':   { icon:'⚠️', bg:'var(--accent-dim)',  border:'var(--accent)',  color:'var(--accent)' },
      'مهم':     { icon:'🔴', bg:'var(--red-dim)',      border:'var(--red)',     color:'var(--red)'    },
      'تم':      { icon:'✅', bg:'var(--green-dim)',    border:'var(--green)',   color:'var(--green)'  },
    };

    const rows = notes.map(n => {
      const noteType = n.old_value || 'عام';
      const noteDate = n.new_value || '';
      const st = typeStyles[noteType] || typeStyles['عام'];
      const createdAt = n.created_at ? new Date(n.created_at).toLocaleString('en-GB', {
        day:'2-digit', month:'2-digit', year:'numeric',
        hour:'2-digit', minute:'2-digit'
      }) : '—';
      const author = (n.user_email || 'unknown').split('@')[0];

      return `
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;margin-bottom:10px;border-right:4px solid ${st.border}">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
            <div style="flex:1">
              <!-- نوع + تاريخ الملاحظة -->
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
                <span style="background:${st.bg};color:${st.color};border:1px solid ${st.border};padding:2px 10px;border-radius:20px;font-size:13px;font-weight:700">
                  ${st.icon} ${noteType}
                </span>
                ${noteDate ? `<span style="font-size:13px;color:var(--text2);font-family:monospace">📅 ${noteDate}</span>` : ''}
              </div>
              <!-- نص الملاحظة -->
              <div style="font-size:13px;line-height:1.7;color:var(--text);white-space:pre-wrap">${(n.notes||'').replace(/</g,'&lt;')}</div>
            </div>
            <!-- حذف -->
            ${can('delete') ? `
            <button onclick="deleteDealNote(${n.id})"
              style="background:var(--red-dim);border:1px solid var(--red);color:var(--red);border-radius:6px;padding:4px 8px;font-size:13px;cursor:pointer;font-family:'Cairo',sans-serif;flex-shrink:0"
              title="حذف الملاحظة">🗑</button>` : ''}
          </div>
          <!-- معلومات التسجيل -->
          <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border);display:flex;align-items:center;gap:12px;font-size:13px;color:var(--text2)">
            <span>👤 ${author}</span>
            <span>🕐 ${createdAt}</span>
          </div>
        </div>`;
    }).join('');

    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-size:12px;color:var(--text2)">${notes.length} ملاحظة مسجلة</div>
      </div>
      ${rows}`;

  } catch(e) {
    container.innerHTML = errHTML('خطأ في تحميل الملاحظات: ' + e.message);
  }
}

export async function deleteDealNote(noteId) {
  showConfirm('حذف الملاحظة', 'هل تريد حذف هذه الملاحظة نهائياً؟', async () => {
    try {
      await apiDelete('audit_log', { id:`eq.${noteId}` });
      toast('✅ تم حذف الملاحظة', 'ok');
      await loadDealNotes();
    } catch(e) { toast('خطأ: ' + e.message, 'err'); }
  });
}

// ════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════
// DB STRUCTURE CHECK + MIGRATION TOOL
// ════════════════════════════════════════════════════════

export async function checkDbStructure() {
  const out = el('dbCheckResult');
  if (!out) return;
  out.innerHTML = '<div style="color:var(--text2);font-size:12px">⏳ جاري الفحص...</div>';

  const tables = [
    'journal_entries','purchase_orders','sales','expenses',
    'payments','collections','partner_payouts','vehicles',
    'contacts','audit_log','operating_expenses'
  ];

  const results = await Promise.all(tables.map(async t => {
    try {
      const r = await apiGet(t, { select:'*', limit:'1' });
      // r is array — table exists
      const cols = r?.length > 0 ? Object.keys(r[0]) : [];
      return { table: t, exists: true, cols, sample: r?.[0] };
    } catch(e) {
      return { table: t, exists: false, error: e.message };
    }
  }));

  // Check journal_entries columns specifically
  const je = results.find(r => r.table === 'journal_entries');
  const requiredCols = ['id','system_type','entry_no','entry_date','account_code',
    'account_name','dr_amount','cr_amount','description','ref_table',
    'ref_id','file_no','post_status','posted_at'];

  const jeMissing = je?.exists
    ? requiredCols.filter(c => !je.cols.includes(c))
    : requiredCols;

  // Count existing data
  const counts = await Promise.all(['sales','payments','expenses','collections','partner_payouts'].map(async t => {
    try {
      const [r1,r2] = await Promise.all([
        apiGet(t, { select:'id', system_type:`eq.${state.system}` }),
        apiGet(t, { select:'id', system_type:'is.null' }),
      ]);
      return { table: t, count: ((r1||[]).length + (r2||[]).length) };
    } catch(e) { return { table: t, count: '?' }; }
  }));

  const jeCount = je?.exists ? (() => {
    return apiGet('journal_entries', { select:'id', system_type:`eq.${state.system}` })
      .then(r => r?.length || 0).catch(()=>0);
  })() : Promise.resolve(0);
  const jeTotal = await jeCount;

  const statusIcon = (ok) => ok
    ? '<span style="color:var(--green);font-weight:700">✓</span>'
    : '<span style="color:var(--red);font-weight:700">✗</span>';

  out.innerHTML = `
    <div style="font-size:13px;font-weight:700;margin-bottom:12px;color:var(--text)">نتيجة فحص قاعدة البيانات</div>

    <div style="margin-bottom:14px">
      <div style="font-size:13px;font-weight:700;color:var(--text2);margin-bottom:6px">جدول journal_entries</div>
      <div style="background:var(--card2);border-radius:6px;padding:10px 12px;font-size:12px">
        ${statusIcon(je?.exists)} موجود: ${je?.exists ? 'نعم' : 'لا — يجب إنشاؤه'}
        ${je?.exists ? `<br>${statusIcon(jeMissing.length===0)} الأعمدة المطلوبة: ${jeMissing.length===0 ? 'كلها موجودة ✓' : 'ناقص: ' + jeMissing.join(', ')}` : ''}
        ${je?.exists ? `<br>📊 عدد القيود الحالية للنظام الحالي: <strong>${jeTotal}</strong>` : ''}
      </div>
    </div>

    <div style="margin-bottom:14px">
      <div style="font-size:13px;font-weight:700;color:var(--text2);margin-bottom:6px">البيانات التي تحتاج قيوداً</div>
      <div style="background:var(--card2);border-radius:6px;padding:10px 12px;font-size:12px">
        ${counts.map(c => `${statusIcon(c.count > 0)} ${c.table}: <strong>${c.count}</strong> سجل`).join('<br>')}
        <br><br>
        <span style="color:${jeTotal < counts.reduce((s,c)=>s+(+c.count||0),0) ? 'var(--red)' : 'var(--green)'};font-weight:700">
          ${jeTotal < counts.reduce((s,c)=>s+(+c.count||0),0)
            ? '⚠️ البيانات أكثر من القيود — تحتاج migration'
            : '✓ الأعداد متوازنة'}
        </span>
      </div>
    </div>

    <div style="margin-bottom:14px">
      <div style="font-size:13px;font-weight:700;color:var(--text2);margin-bottom:6px">كل الجداول</div>
      <div style="background:var(--card2);border-radius:6px;padding:10px 12px;font-size:12px;display:grid;grid-template-columns:1fr 1fr;gap:4px">
        ${results.map(r => `${statusIcon(r.exists)} ${r.table}${r.exists ? ` (${r.cols?.length||0} عمود)` : ': غير موجود'}`).join('')}
      </div>
    </div>`;
}
// ════════════════════════════════════════════════════════
// REVIEW MODULE — مراجعة الحسابات الشاملة
// ════════════════════════════════════════════════════════

const reviewState = {
  period: 'year', from: null, to: null,
  checkResults: [], activeTab: 0,
};

export function showReview() {
  hideAllViews();
  el('reviewView').style.display = 'block';
  el('topBarTitle').textContent  = '🔍 مراجعة الحسابات';
  el('topBarSub').textContent    = `نظام ${state.system}`;
  navActive('nav-review');
  sessionStorage.setItem('tm_last_view','review');
  setReviewPeriod('month');
  renderReviewChecklist();
}

export function setReviewPeriod(period) {
  reviewState.period = period;
  document.querySelectorAll('[id^="rvperiod-"]').forEach(b => b.classList.remove('active'));
  el('rvperiod-'+period)?.classList.add('active');
  const customWrap = el('rvCustomDateWrap');
  if (period === 'custom') { if (customWrap) customWrap.style.display='flex'; return; }
  if (customWrap) customWrap.style.display = 'none';
  const pad = n => String(n).padStart(2,'0');
  const now = new Date(), yr = now.getFullYear();
  let from, to;
  if (period === 'month') {
    from = `${yr}-${pad(now.getMonth()+1)}-01`;
    const last = new Date(yr, now.getMonth()+1, 0);
    to   = `${last.getFullYear()}-${pad(last.getMonth()+1)}-${pad(last.getDate())}`;
  } else if (period === 'lastmonth') {
    const lm = new Date(yr, now.getMonth()-1, 1), lme = new Date(yr, now.getMonth(), 0);
    from = `${lm.getFullYear()}-${pad(lm.getMonth()+1)}-01`;
    to   = `${lme.getFullYear()}-${pad(lme.getMonth()+1)}-${pad(lme.getDate())}`;
  } else if (period === 'year')     { from=`${yr}-01-01`; to=`${yr}-12-31`; }
  else if (period === 'lastyear')   { from=`${yr-1}-01-01`; to=`${yr-1}-12-31`; }
  if (el('rv-from')) el('rv-from').value = from;
  if (el('rv-to'))   el('rv-to').value   = to;
  reviewState.from = from; reviewState.to = to;
  const mnths = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const lbl = period==='month'?`${mnths[now.getMonth()]} ${yr}`:period==='lastmonth'?`${mnths[(now.getMonth()-1+12)%12]} ${now.getMonth()===0?yr-1:yr}`:period==='year'?`سنة ${yr}`:period==='lastyear'?`سنة ${yr-1}`:`${from} — ${to}`;
  if (el('review-period-label')) el('review-period-label').textContent = `الفترة: ${lbl} · نظام ${state.system}`;
  runAllReviewChecks();
}

export function switchReviewTab(idx) {
  reviewState.activeTab = idx;
  document.querySelectorAll('.review-tab-content').forEach((c,i) => c.style.display=i===idx?'block':'none');
  document.querySelectorAll('.rv-tab-btn').forEach((t,i) => t.classList.toggle('active', i===idx));
  if (idx===2) loadReconciliations();
  if (idx===3) loadReviewHistory();
}

// ════ الفحوصات التلقائية ════
export async function runAllReviewChecks() {
  const wrap = el('review-auto-checks');
  if (!wrap) return;
  wrap.innerHTML = `<div class="loading"><div class="spinner"></div><br>جاري الفحص الشامل لـ ${reviewState.from} — ${reviewState.to}...</div>`;
  const sys  = state.system;
  const from = reviewState.from;
  const to   = reviewState.to;
  if (!from||!to) { wrap.innerHTML=errHTML('يرجى تحديد الفترة'); return; }

  try {
    await ensureCache();
    const [allPayments, allPayouts, allPartners, jeData] = await Promise.all([
      apiGetAll('payments',        { select:'*', system_type:`eq.${sys}` }),
      apiGetAll('partner_payouts', { select:'*', system_type:`eq.${sys}` }),
      apiGetAll('partners_master', { select:'*', system_type:`eq.${sys}` }),
      apiGet('journal_entries', { select:'id,dr_amount,cr_amount,entry_no,file_no,account_code,ref_table', system_type:`eq.${sys}`, post_status:'eq.posted' }).catch(()=>[]),
    ]);

    const deals=state.allDeals||[], vehicles=state.allVehicles||[];
    const sales=state.allSales||[], expenses=state.allExpenses||[];
    const collections=state.allCollections||[];
    const inPeriod = d => d&&d>=from&&d<=to;
    const todayStr = new Date().toISOString().split('T')[0];
    const pSales   = sales.filter(s=>isPosted(s)&&inPeriod(s.sale_date||s.created_at?.split('T')[0]));
    const pDeals   = deals.filter(d=>inPeriod(d.po_date||d.created_at?.split('T')[0]));
    const checks   = [];

    // ══ A. العمليات المعلقة ══
    const draftCounts = {
      sales:(sales||[]).filter(isDraft).length, expenses:(expenses||[]).filter(isDraft).length,
      payments:(allPayments||[]).filter(isDraft).length, collections:(collections||[]).filter(isDraft).length,
      payouts:(allPayouts||[]).filter(isDraft).length,
    };
    const totalDrafts = Object.values(draftCounts).reduce((s,v)=>s+v,0);
    checks.push({ cat:'A', icon:'⏳', catLabel:'العمليات المعلقة',
      id:'A1', label:'عمليات غير مرحّلة (Draft معلق)',
      status: totalDrafts===0?'pass':totalDrafts<=5?'warn':'fail',
      value: totalDrafts===0?'✓ صفر':totalDrafts,
      detail: totalDrafts===0?'كل العمليات مرحّلة ✓':`مبيعات: ${draftCounts.sales} · مصاريف: ${draftCounts.expenses} · دفعات: ${draftCounts.payments} · تحصيلات: ${draftCounts.collections} · توزيعات: ${draftCounts.payouts}`,
      action: totalDrafts>0?{ label:'فتح قائمة الانتظار', fn:'showApprovalQueue()' }:null });

    // ══ B. التحصيلات ══
    const overdueCol     = collections.filter(c=>isPosted(c)&&!c.paid_date&&c.due_date&&c.due_date<todayStr);
    const overdue30      = overdueCol.filter(c=>daysSince(c.due_date)>30);
    const overdue30Amt   = overdue30.reduce((s,c)=>s+(+c.amount||0),0);
    checks.push({ cat:'B', icon:'💰', catLabel:'التحصيلات',
      id:'B1', label:'تحصيلات متأخرة أكثر من 30 يوم',
      status: overdue30.length===0?'pass':overdue30.length<=3?'warn':'fail',
      value: overdue30.length===0?'✓ لا يوجد':fmt(overdue30Amt),
      detail: overdue30.length===0?'لا توجد تحصيلات متأخرة ✓':`${overdue30.length} فاتورة · إجمالي ${fmt(overdue30Amt)}`,
      rows: overdue30.slice(0,5).map(c=>({ cols:[c.customer||'—',c.inv_no||'—',fmt(c.amount),`${daysSince(c.due_date)} يوم`], action:`openViewer('${c.file_no}')`, actionLabel:'📂 فتح الملف' })),
      action: overdue30.length>0?{ label:'📂 فتح التحصيلات', fn:`showAllCollections()` }:null });

    const pendingPeriod  = collections.filter(c=>isPosted(c)&&!c.paid_date&&inPeriod(c.due_date||c.created_at?.split('T')[0]));
    const pendingAmt     = pendingPeriod.reduce((s,c)=>s+(+c.amount||0),0);
    checks.push({ cat:'B', icon:'💰', catLabel:'التحصيلات',
      id:'B2', label:'فواتير الفترة لم تُحصَّل بعد',
      status: pendingPeriod.length===0?'pass':'warn',
      value: pendingPeriod.length===0?'✓ كل محصّل':fmt(pendingAmt),
      detail: pendingPeriod.length===0?'كل فواتير الفترة محصّلة ✓':`${pendingPeriod.length} فاتورة بمبلغ ${fmt(pendingAmt)} منتظرة`,
      rows: pendingPeriod.slice(0,5).map(c=>({ cols:[c.customer||'—',c.inv_no||'—',fmt(c.amount),c.due_date||'—'], action:`openViewer('${c.file_no}')`, actionLabel:'📂 الملف' })),
      action: pendingPeriod.length>0?{ label:'📂 كل التحصيلات', fn:`showAllCollections()` }:null });

    // ══ C. الموردون ══
    const payMap = {};
    (allPayments||[]).filter(isPosted).forEach(p=>{ payMap[p.file_no]=(payMap[p.file_no]||0)+(+p.amount||0); });
    const overpaid = deals.filter(d=>(payMap[d.file_no]||0)>(+d.total_purchase||0)+0.01);
    checks.push({ cat:'C', icon:'🏭', catLabel:'الموردون',
      id:'C1', label:'دفعات تجاوزت قيمة الصفقة',
      status: overpaid.length===0?'pass':'fail',
      value: overpaid.length===0?'✓ سليم':overpaid.length,
      detail: overpaid.length===0?'كل الدفعات في حدود قيم الصفقات ✓':`${overpaid.length} صفقة فيها دفع زائد`,
      rows: overpaid.map(d=>({ cols:[d.file_no,d.supplier||'—',fmt(d.total_purchase),fmt(payMap[d.file_no]),`↑ زيادة ${fmt((payMap[d.file_no]||0)-(+d.total_purchase||0))}`], action:`openViewer('${d.file_no}')`, actionLabel:'📂 فتح' })),
      action: overpaid.length>0?{ label:'📂 فتح الصفقة', fn:`openViewer('${overpaid[0]?.file_no}')` }:null });

    const openOld = deals.filter(d=>d.status==='OPEN'&&daysSince(d.po_date||d.created_at)>90);
    checks.push({ cat:'C', icon:'🏭', catLabel:'الموردون',
      id:'C2', label:'صفقات مفتوحة أكثر من 90 يوم',
      status: openOld.length===0?'pass':openOld.length<=2?'warn':'fail',
      value: openOld.length===0?'✓ لا يوجد':openOld.length,
      detail: openOld.length===0?'لا توجد صفقات قديمة مفتوحة ✓':`${openOld.length} صفقة مفتوحة منذ > 90 يوم`,
      rows: openOld.map(d=>({ cols:[d.file_no,d.supplier||'—',fmt(d.total_purchase),`${daysSince(d.po_date||d.created_at)} يوم`], action:`openViewer('${d.file_no}')`, actionLabel:'📂 فتح' })),
      action: openOld.length>0?{ label:'📂 فتح الصفقة', fn:`openViewer('${openOld[0]?.file_no}')` }:null });

    // ══ D. المخزون ══
    const noVin = vehicles.filter(v=>!v.vin);
    checks.push({ cat:'D', icon:'🚗', catLabel:'المخزون',
      id:'D1', label:'سيارات بدون رقم شاصي VIN',
      status: noVin.length===0?'pass':'warn',
      value: noVin.length===0?'✓ كل السيارات':noVin.length,
      detail: noVin.length===0?'كل السيارات لها VIN ✓':`${noVin.length} سيارة بدون VIN`,
      rows: noVin.slice(0,5).map(v=>({ cols:[v.file_no||'—',v.model||'—',v.vehicle_type||'—','⚠️ بدون VIN'], action:`openViewer('${v.file_no}')`, actionLabel:'📂 فتح' })) });

    const soldVinsSet  = new Set(sales.filter(isPosted).map(s=>s.vin).filter(Boolean));
    const stockV       = vehicles.filter(v=>!soldVinsSet.has(v.vin));
    const oldStock     = stockV.filter(v=>daysSince(v.created_at)>90);
    const oldStockVal  = oldStock.reduce((s,v)=>s+(+v.purchase_price||0),0);
    checks.push({ cat:'D', icon:'🚗', catLabel:'المخزون',
      id:'D2', label:'مخزون راكد أكثر من 90 يوم',
      status: oldStock.length===0?'pass':oldStock.length<=3?'warn':'fail',
      value: oldStock.length===0?'✓ لا يوجد':`${oldStock.length} (${fmt(oldStockVal)})`,
      detail: oldStock.length===0?'لا يوجد مخزون راكد ✓':`${oldStock.length} سيارة بقيمة ${fmt(oldStockVal)} راكدة`,
      rows: oldStock.slice(0,5).map(v=>({ cols:[v.file_no||'—',v.vin||'—',v.model||'—',`${daysSince(v.created_at)} يوم`,fmt(v.purchase_price)] })) });

    const vMap = {}; vehicles.forEach(v=>{ if(v.vin) vMap[v.vin]=v; });
    const lossySales = pSales.filter(s=>{ const v=vMap[s.vin]; return v&&(+s.sale_price||0)<(+v.purchase_price||0)-0.01; });
    checks.push({ cat:'D', icon:'🚗', catLabel:'المخزون',
      id:'D3', label:'مبيعات الفترة بأقل من سعر الشراء',
      status: lossySales.length===0?'pass':'warn',
      value: lossySales.length===0?'✓ لا يوجد':lossySales.length,
      detail: lossySales.length===0?'لا توجد مبيعات بخسارة ✓':`${lossySales.length} سيارة بيعت بأقل من تكلفتها`,
      rows: lossySales.slice(0,5).map(s=>{ const v=vMap[s.vin]; return { cols:[s.file_no||'—',s.vin||'—',fmt(v?.purchase_price),fmt(s.sale_price),`خسارة ${fmt((+v?.purchase_price||0)-(+s.sale_price||0))}`] }; }) });

    // ══ E. القيود المحاسبية ══
    const jeTotalDr = (jeData||[]).reduce((s,e)=>s+(+e.dr_amount||0),0);
    const jeTotalCr = (jeData||[]).reduce((s,e)=>s+(+e.cr_amount||0),0);
    const jeDiff    = Math.abs(jeTotalDr-jeTotalCr);
    checks.push({ cat:'E', icon:'📒', catLabel:'القيود المحاسبية',
      id:'E1', label:'توازن القيود المزدوجة Dr = Cr',
      status: jeDiff<0.01?'pass':'fail',
      value: jeDiff<0.01?'✓ متوازن':fmt(jeDiff),
      detail: jeDiff<0.01?`مدين = دائن = ${fmt(jeTotalDr)} ✓`:`فرق ${fmt(jeDiff)} — مدين: ${fmt(jeTotalDr)} · دائن: ${fmt(jeTotalCr)}` });

    const jeFileSet = new Set((jeData||[]).map(e=>e.file_no).filter(Boolean));
    const dealsNoJE = pDeals.filter(d=>d.file_no&&!jeFileSet.has(d.file_no));
    checks.push({ cat:'E', icon:'📒', catLabel:'القيود المحاسبية',
      id:'E2', label:'صفقات الفترة بدون قيود محاسبية',
      status: dealsNoJE.length===0?'pass':dealsNoJE.length<=2?'warn':'fail',
      value: dealsNoJE.length===0?'✓ مكتمل':dealsNoJE.length,
      detail: dealsNoJE.length===0?'كل الصفقات لها قيود ✓':`${dealsNoJE.length} صفقة بدون قيود — تحتاج ترحيل`,
      rows: dealsNoJE.map(d=>({ cols:[d.file_no,d.supplier||'—',fmt(d.total_purchase),d.po_date||'—'] })),
      action: dealsNoJE.length>0?{ label:'فتح قائمة الانتظار', fn:'showApprovalQueue()' }:null });

    // فحص: تحصيلات مدفوعة بدون قيد تحصيل
    const jeRefSet = new Set((jeData||[]).map(e=>e.ref_table&&e.file_no?`${e.ref_table}|${e.file_no}`:'').filter(Boolean));
    const paidColNoJE = collections.filter(c => isPosted(c) && c.paid_date && inPeriod(c.paid_date));
    const missingColJE = paidColNoJE.filter(c => {
      // تحقق وجود قيد تحصيل لهذا الملف
      return !(jeData||[]).some(e => e.ref_table==='collections' && e.file_no===c.file_no && e.account_code==='1200' && Math.abs((+e.cr_amount||0)-(+c.amount||0))<0.01);
    });
    checks.push({ cat:'E', icon:'📒', catLabel:'القيود المحاسبية',
      id:'E3', label:'تحصيلات مدفوعة بدون قيد محاسبي',
      status: missingColJE.length===0?'pass':missingColJE.length<=2?'warn':'fail',
      value: missingColJE.length===0?'✓ مكتمل':missingColJE.length,
      detail: missingColJE.length===0?'كل التحصيلات المدفوعة لها قيود ✓':`${missingColJE.length} تحصيل مدفوع بدون قيد — يؤثر على ميزان المراجعة`,
      rows: missingColJE.slice(0,5).map(c=>({ cols:[c.file_no||'—',c.customer||'—',c.inv_no||'—',fmt(c.amount),c.paid_date||'—'] })) });

    // ══ F. سلامة البيانات ══
    // الفحص الصحيح: نفس inv_no في file_no مختلف = تكرار حقيقي
    // نفس inv_no في نفس file_no = طبيعي (فاتورة متعددة السيارات)
    const invFileMap = {};
    pSales.forEach(s => {
      if (!s.inv_no) return;
      if (!invFileMap[s.inv_no]) invFileMap[s.inv_no] = new Set();
      invFileMap[s.inv_no].add(s.file_no);
    });
    const dupInv = Object.entries(invFileMap)
      .filter(([,files]) => files.size > 1)
      .map(([inv]) => inv);
    checks.push({ cat:'F', icon:'🛡️', catLabel:'سلامة البيانات',
      id:'F1', label:'فواتير مبيعات مكررة في ملفات مختلفة',
      status: dupInv.length===0?'pass':'fail',
      value:  dupInv.length===0?'✓ لا يوجد':dupInv.length,
      detail: dupInv.length===0?'لا توجد فواتير مكررة ✓':`أرقام مكررة في ملفات مختلفة: ${dupInv.join(', ')}`,
      action: dupInv.length>0?{ label:'🔍 فتح المبيعات', fn:`showTransactions();setTimeout(()=>{const s=document.getElementById('tx-type');if(s){s.value='sales';loadTransactions();}},300)` }:null });

    const shareMap  = {};
    (allPartners||[]).forEach(p=>{ shareMap[p.file_no]=(shareMap[p.file_no]||0)+(+p.share_percent||0); });
    const wrongShr  = Object.entries(shareMap).filter(([,t])=>Math.abs(t-100)>0.01);
    checks.push({ cat:'F', icon:'🛡️', catLabel:'سلامة البيانات',
      id:'F2', label:'صفقات بحصص شركاء ≠ 100%',
      status: wrongShr.length===0?'pass':'fail',
      value:  wrongShr.length===0?'✓ سليم':wrongShr.length,
      detail: wrongShr.length===0?'كل حصص الشركاء 100% ✓':`${wrongShr.length} صفقة: ${wrongShr.map(([fn,t])=>`${fn}(${t.toFixed(1)}%)`).join(', ')}`,
      rows:   wrongShr.map(([fn,t])=>({ cols:[fn, t.toFixed(1)+'%', '⚠️ ليست 100%'], action:`openViewer('${fn}')` })),
      action: wrongShr.length>0?{ label:'🔍 فتح أول صفقة', fn:`openViewer('${wrongShr[0]?.[0]}')` }:null });

    const zeroDeals = deals.filter(d=>!(+d.total_purchase));
    checks.push({ cat:'F', icon:'🛡️', catLabel:'سلامة البيانات',
      id:'F3', label:'صفقات بقيمة شراء صفر',
      status: zeroDeals.length===0?'pass':'warn',
      value:  zeroDeals.length===0?'✓ لا يوجد':zeroDeals.length,
      detail: zeroDeals.length===0?'كل الصفقات لها قيمة ✓':`${zeroDeals.length} صفقة بقيمة صفر`,
      rows:   zeroDeals.slice(0,3).map(d=>({ cols:[d.file_no, d.supplier||'—', d.po_date||'—', '⚠️ قيمة صفر'], action:`openViewer('${d.file_no}')` })),
      action: zeroDeals.length>0?{ label:'🔍 فتح الصفقة', fn:`openViewer('${zeroDeals[0]?.file_no}')` }:null });

    // ══ G. حسابات الشركاء ══
    const partnerNames = [...new Set((allPartners||[]).map(p=>p.partner).filter(Boolean))];
    const partnerBadList = [];
    for (const pName of partnerNames) {
      const capPaid   = (allPayments||[]).filter(p=>isPosted(p)&&p.payer===pName).reduce((s,p)=>s+(+p.amount||0),0);
      const withdrawn = (allPayouts||[]).filter(p=>isPosted(p)&&p.partner===pName).reduce((s,p)=>s+(+p.amount||0),0);
      let profitDue   = 0;
      (allPartners||[]).filter(p=>p.partner===pName).forEach(pd=>{
        const deal=deals.find(d=>d.file_no===pd.file_no); if(!deal) return;
        // الربح يُحسب فقط على الصفقات المغلقة CLOSED
        // الصفقات المفتوحة فيها سيارات لم تُبَع بعد → لا خسارة حقيقية
        if (deal.status !== 'CLOSED') return;
        const dSales=sales.filter(s=>isPosted(s)&&s.file_no===pd.file_no).reduce((s,x)=>s+(+x.sale_price||0),0);
        const dExp  =expenses.filter(e=>isPosted(e)&&e.file_no===pd.file_no).reduce((s,x)=>s+(+x.amount||0),0);
        profitDue  +=(dSales-(+deal.total_purchase||0)-dExp)*(+pd.share_percent||0)/100;
      });
      const balance = capPaid+profitDue-withdrawn;
      if (balance<-0.01) partnerBadList.push({ name:pName, capPaid, profitDue, withdrawn, balance });
    }
    checks.push({ cat:'G', icon:'👥', catLabel:'حسابات الشركاء',
      id:'G1', label:'شركاء بحساب سالب (الصفقات المغلقة فقط)',
      status: partnerBadList.length===0?'pass':'fail',
      value:  partnerBadList.length===0?'✓ كل الحسابات سليمة':partnerBadList.length,
      detail: partnerBadList.length===0?'كل حسابات الشركاء إيجابية ✓ (محسوبة على الصفقات المغلقة)':`${partnerBadList.length} شريك: ${partnerBadList.map(p=>p.name).join(', ')}`,
      rows:   partnerBadList.map(p=>({
        cols: [p.name, `رأس مال: ${fmt(p.capPaid)}`, `أرباح (مغلق): ${fmt(p.profitDue)}`, `مسحوب: ${fmt(p.withdrawn)}`, `رصيد: ${fmt(p.balance)}`],
        action: `showPartnerStatement('${p.name.replace(/'/g,"\\'")}')`,
        actionLabel: '📋 كشف الحساب',
      })) });

    // ════ النتائج الإجمالية ════
    const passCount = checks.filter(c=>c.status==='pass').length;
    const warnCount = checks.filter(c=>c.status==='warn').length;
    const failCount = checks.filter(c=>c.status==='fail').length;
    const score     = Math.round((passCount/checks.length)*100);
    reviewState.checkResults = checks;

    // Banner
    const bColor = failCount>0?'var(--red)':warnCount>0?'var(--accent)':'var(--green)';
    const bBg    = failCount>0?'var(--red-dim)':warnCount>0?'var(--accent-dim)':'var(--green-dim)';
    const bLabel = failCount>0?'🔴 يحتاج تصحيح فوري قبل الإغلاق':warnCount>0?'🟡 يحتاج مراجعة — تحقق من التحذيرات':'🟢 اجتاز كل الفحوصات — جاهز للإغلاق';
    if (el('review-score-banner')) el('review-score-banner').innerHTML = `
      <div style="background:${bBg};border:2px solid ${bColor};border-radius:var(--radius);padding:14px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
        <div style="width:60px;height:60px;border-radius:50%;background:${bColor}22;border:3px solid ${bColor};display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:900;color:${bColor};flex-shrink:0">${score}%</div>
        <div style="flex:1;min-width:160px">
          <div style="font-size:14px;font-weight:700;color:${bColor};margin-bottom:4px">${bLabel}</div>
          <div style="font-size:12px;color:var(--text2)">
            ✅ نجح: <strong style="color:var(--green)">${passCount}</strong> &nbsp;·&nbsp;
            ⚠️ تحذير: <strong style="color:var(--accent)">${warnCount}</strong> &nbsp;·&nbsp;
            ❌ فشل: <strong style="color:var(--red)">${failCount}</strong>
            &nbsp;·&nbsp; إجمالي: ${checks.length} فحص
          </div>
          <div style="font-size:13px;color:var(--text2);margin-top:2px">${from} — ${to} · نظام ${sys}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm" onclick="runAllReviewChecks()" style="font-size:13px">🔄 إعادة الفحص</button>
          <button class="btn btn-primary btn-sm" onclick="switchReviewTab(1)" style="font-size:13px">📋 قائمة المراجعة</button>
        </div>
      </div>`;

    // تحديث Badge
    if (el('review-issues-badge')) {
      el('review-issues-badge').style.display = failCount>0?'inline-block':'none';
      el('review-issues-badge').textContent   = failCount;
    }

    // عرض الفحوصات مقسّمة بالفئة
    const cats = ['A','B','C','D','E','F','G'];
    const catLabels2 = { A:'⏳ العمليات المعلقة', B:'💰 التحصيلات', C:'🏭 الموردون', D:'🚗 المخزون', E:'📒 القيود المحاسبية', F:'🛡️ سلامة البيانات', G:'👥 حسابات الشركاء' };
    wrap.innerHTML = cats.map(cat => {
      const catChecks = checks.filter(c=>c.cat===cat);
      if (!catChecks.length) return '';
      const catFail = catChecks.filter(c=>c.status==='fail').length;
      const catWarn = catChecks.filter(c=>c.status==='warn').length;
      const catIcon = catFail>0?'❌':catWarn>0?'⚠️':'✅';
      return `<div style="margin-bottom:16px">
        <div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;padding:6px 10px;background:var(--card2);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center">
          <span>${catLabels2[cat]||cat}</span>
          <span style="font-size:13px">${catIcon} ${catFail>0?catFail+' فشل':''}${catWarn>0?' '+catWarn+' تحذير':''}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">${catChecks.map(renderCheckItem).join('')}</div>
      </div>`;
    }).join('');

  } catch(e) {
    if(wrap) wrap.innerHTML = errHTML('خطأ في الفحص: '+e.message);
    console.error(e);
  }
}

export function renderCheckItem(c) {
  const ss = {
    pass:{ bg:'var(--green-dim)',  border:'var(--green)',  icon:'✅', lbl:'نجح' },
    warn:{ bg:'var(--accent-dim)', border:'var(--accent)', icon:'⚠️', lbl:'تحذير' },
    fail:{ bg:'var(--red-dim)',    border:'var(--red)',    icon:'❌', lbl:'فشل' },
  };
  const st = ss[c.status]||ss.pass;

  // جدول التفاصيل مع زر تنقل لكل صف
  const detailRows = c.rows?.length ? `
    <div style="margin-top:8px;overflow-x:auto;border-radius:4px;overflow:hidden">
      <table style="width:100%;border-collapse:collapse;font-size:13px;background:var(--card)">
        <tbody>${c.rows.map(r=>`<tr>
          ${r.cols.map(v=>`<td style="padding:5px 8px;border-bottom:1px solid var(--border)">${v}</td>`).join('')}
          <td style="padding:5px 8px;border-bottom:1px solid var(--border);white-space:nowrap">
            ${r.action ? `<button class="btn btn-sm" onclick="closeModal&&closeModal();${r.action}" style="font-size:12px;padding:2px 8px;background:var(--card2)">${r.actionLabel||'🔍 فتح'}</button>` : ''}
          </td>
        </tr>`).join('')}</tbody>
      </table>
    </div>` : '';

  return `<div style="background:${st.bg};border:1px solid ${st.border};border-radius:var(--radius-sm);padding:10px 14px">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="font-size:16px;flex-shrink:0">${st.icon}</span>
      <div style="flex:1;min-width:120px">
        <div style="font-size:12px;font-weight:700;color:var(--text)">${c.label}</div>
        <div style="font-size:13px;color:var(--text2);margin-top:1px">${c.detail}</div>
      </div>
      <div style="text-align:left;flex-shrink:0">
        <div style="font-size:13px;font-weight:700;color:${st.border};font-family:var(--mono)">${c.value}</div>
        <div style="font-size:12px;color:var(--text2)">${st.lbl}</div>
      </div>
      ${c.action ? `<button class="btn btn-sm" onclick="${c.action.fn}" style="font-size:12px;padding:4px 10px;flex-shrink:0;white-space:nowrap">${c.action.label}</button>` : ''}
    </div>${detailRows}
  </div>`;
}

// ════ قائمة المراجعة اليدوية ════
const REVIEW_CHECKLIST = [
  { id:'CL01', cat:'المستندات', label:'مراجعة كل الفواتير ومطابقتها مع مستندات العملاء الأصلية', risk:'high' },
  { id:'CL02', cat:'البنك',     label:'مطابقة إجمالي التحصيلات المدفوعة مع كشف الحساب البنكي', risk:'high' },
  { id:'CL03', cat:'المبيعات',  label:'التحقق من صحة أسعار البيع ومقارنتها بأسعار السوق', risk:'medium' },
  { id:'CL04', cat:'المصاريف',  label:'مراجعة كل المصاريف والتأكد من وجود مستنداتها وفواتيرها', risk:'high' },
  { id:'CL05', cat:'المخزون',   label:'التحقق الميداني الفعلي من عدد السيارات في المخزن', risk:'high' },
  { id:'CL06', cat:'الموردون',  label:'مراجعة دفعات الموردين وتأكيد الأرصدة المستحقة', risk:'high' },
  { id:'CL07', cat:'الشركاء',   label:'مراجعة حسابات الشركاء وتوزيعات الأرباح والسحوبات', risk:'high' },
  { id:'CL08', cat:'القيود',    label:'التحقق من صحة القيود المحاسبية المرحّلة في الفترة', risk:'medium' },
  { id:'CL09', cat:'التشغيل',   label:'مراجعة وتوثيق كل المصاريف التشغيلية (إيجار، رواتب، إلخ)', risk:'medium' },
  { id:'CL10', cat:'الختام',    label:'الموافقة النهائية على إقفال الفترة — لا تعديل بعد ذلك', risk:'high' },
];

export function renderReviewChecklist() {
  const wrap = el('review-checklist-wrap');
  if (!wrap) return;
  const riskColor = { high:'var(--red)', medium:'var(--accent)', low:'var(--text2)' };
  const riskLabel = { high:'مهم جداً', medium:'مهم', low:'عادي' };
  wrap.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:12px">
      <div style="font-size:13px;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:8px">
        📋 قائمة التحقق اليدوي
        <span style="font-size:13px;font-weight:400;color:var(--text2)">— يجب إكمالها بعد الفحص التلقائي قبل إغلاق الفترة</span>
      </div>
      ${REVIEW_CHECKLIST.map(item=>`
      <label style="display:flex;align-items:flex-start;gap:12px;padding:10px 12px;border-radius:var(--radius-sm);margin-bottom:6px;cursor:pointer;border:1px solid var(--border);background:var(--card2);transition:background .15s"
        onmouseover="this.style.background='var(--card)'" onmouseout="this.style.background='var(--card2)'"
        id="cl-label-${item.id}">
        <input type="checkbox" id="cl-${item.id}" onchange="updateChecklistProgress()"
          style="width:18px;height:18px;margin-top:1px;accent-color:var(--green);flex-shrink:0;cursor:pointer">
        <div style="flex:1">
          <div style="font-size:12px;font-weight:600;color:var(--text)">${item.label}</div>
          <div style="display:flex;gap:8px;margin-top:3px">
            <span style="font-size:12px;color:var(--text2)">${item.cat}</span>
            <span style="font-size:12px;font-weight:700;color:${riskColor[item.risk]}">${riskLabel[item.risk]}</span>
          </div>
        </div>
        <span id="cl-tick-${item.id}" style="display:none;color:var(--green);font-size:16px;flex-shrink:0">✓</span>
      </label>`).join('')}

      <div style="margin-top:14px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:12px;font-weight:700">التقدم في المراجعة</span>
          <span id="cl-progress-text" style="font-size:12px;color:var(--text2)">0 / ${REVIEW_CHECKLIST.length}</span>
        </div>
        <div style="height:8px;background:var(--card2);border-radius:10px;overflow:hidden">
          <div id="cl-progress-bar" style="height:100%;background:var(--red);border-radius:10px;transition:width .4s,background .4s;width:0%"></div>
        </div>
      </div>
    </div>`;
  renderSignoff();
  updateChecklistProgress();
}

export function updateChecklistProgress() {
  const total   = REVIEW_CHECKLIST.length;
  const checked = REVIEW_CHECKLIST.filter(item => el('cl-'+item.id)?.checked).length;
  const pct     = Math.round((checked/total)*100);
  if (el('cl-progress-text')) el('cl-progress-text').textContent = `${checked} / ${total}`;
  if (el('cl-progress-bar'))  {
    el('cl-progress-bar').style.width      = pct+'%';
    el('cl-progress-bar').style.background = pct===100?'var(--green)':pct>50?'var(--accent)':'var(--red)';
  }
  REVIEW_CHECKLIST.forEach(item => {
    const lbl  = el('cl-label-'+item.id);
    const tick = el('cl-tick-'+item.id);
    const chk  = el('cl-'+item.id)?.checked;
    if (lbl)  lbl.style.borderColor  = chk?'var(--green)':'var(--border)';
    if (lbl)  lbl.style.background   = chk?'var(--green-dim)':'var(--card2)';
    if (tick) tick.style.display     = chk?'inline':'none';
  });
  const saveBtn = el('review-save-btn');
  if (saveBtn) {
    saveBtn.disabled = checked<total;
    saveBtn.style.opacity  = checked<total?'0.5':'1';
    saveBtn.textContent    = checked<total
      ? `⏳ أكمل القائمة — ${total-checked} بند متبقي`
      : '💾 حفظ وإغلاق الفترة';
  }
}

export function renderSignoff() {
  const wrap = el('review-signoff-wrap');
  if (!wrap) return;
  wrap.innerHTML = `
    <div style="background:var(--card);border:2px solid var(--border);border-radius:var(--radius);padding:20px">
      <div style="font-size:14px;font-weight:700;margin-bottom:14px">✍️ التوقيع والاعتماد النهائي</div>
      <div class="field" style="margin-bottom:14px">
        <label>ملاحظات المراجعة</label>
        <textarea id="review-notes" rows="3"
          placeholder="أي ملاحظات أو تحفظات أو بنود للمتابعة في الدورة القادمة..."
          style="background:var(--card2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 10px;width:100%;color:var(--text);font-family:'Cairo',sans-serif;font-size:12px;resize:vertical"></textarea>
      </div>
      <div style="background:var(--accent-dim);border:1px solid var(--accent);border-radius:var(--radius-sm);padding:10px 14px;font-size:13px;color:var(--text);margin-bottom:14px;line-height:1.6">
        ⚠️ <strong>تنبيه:</strong> بالضغط على "حفظ وإغلاق الفترة" أنت تؤكد رسمياً أنك راجعت كل البنود المذكورة أعلاه، وأن الأرقام مطابقة للواقع لهذه الفترة. سيتم تسجيل هذا الإقرار باسمك وتاريخه.
      </div>
      <button id="review-save-btn" class="btn btn-primary" onclick="saveReviewSignoff()" disabled style="opacity:0.5;width:100%;padding:12px">
        ⏳ أكمل قائمة المراجعة أولاً
      </button>
    </div>`;
}

export async function saveReviewSignoff() {
  const from  = reviewState.from;
  const to    = reviewState.to;
  const notes = el('review-notes')?.value?.trim() || '';
  const allChecked = REVIEW_CHECKLIST.every(item => el('cl-'+item.id)?.checked);
  if (!allChecked) { toast('يرجى إكمال كل بنود القائمة أولاً','err'); return; }
  const failCount = reviewState.checkResults.filter(c=>c.status==='fail').length;
  if (failCount>0) {
    const go = confirm(`⚠️ يوجد ${failCount} فحص فاشل.\nهل تريد المتابعة بالإغلاق رغم ذلك؟\n\nيُنصح بتصحيح المشاكل أولاً.`);
    if (!go) return;
  }
  const btn = el('review-save-btn');
  btn.disabled=true; btn.textContent='⏳ جاري الحفظ...';
  try {
    await apiPost('audit_log', {
      system_type: state.system,
      action:      'PERIOD_REVIEW',
      table_name:  'review_sessions',
      file_no:     null,
      notes:       notes || `مراجعة ${from} — ${to}`,
      old_value:   JSON.stringify({ from, to, checks: reviewState.checkResults.map(c=>({ id:c.id,status:c.status })) }),
      new_value:   JSON.stringify({
        period_from:from, period_to:to, system:state.system,
        reviewer: state.user?.email,
        checks_passed: reviewState.checkResults.filter(c=>c.status==='pass').length,
        checks_warned: reviewState.checkResults.filter(c=>c.status==='warn').length,
        checks_failed: failCount, notes,
      }),
      user_email: state.user?.email || 'unknown',
    });
    toast(`✅ تم حفظ مراجعة الفترة ${from} — ${to}`,'ok');
    switchReviewTab(3);
    await loadReviewHistory();
  } catch(e) {
    toast('خطأ في الحفظ: '+e.message,'err');
    btn.disabled=false; btn.textContent='💾 حفظ وإغلاق الفترة';
  }
}

// ════ التسويات ════
export async function loadReconciliations() {
  const wrap = el('review-reconciliation-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري تحميل التسويات...</div>';
  const sys=state.system;
  try {
    await ensureCache();
    const [allPayments, allPayouts, allPartners] = await Promise.all([
      apiGetAll('payments',        { select:'*', system_type:`eq.${sys}` }),
      apiGetAll('partner_payouts', { select:'*', system_type:`eq.${sys}` }),
      apiGetAll('partners_master', { select:'*', system_type:`eq.${sys}` }),
    ]);
    const deals=state.allDeals||[], sales=state.allSales||[], expenses=state.allExpenses||[], collections=state.allCollections||[];

    // ── تسوية التحصيلات ──
    const invMap={};
    sales.filter(isPosted).forEach(s=>{ const k=`${s.file_no}__${s.inv_no}`; if(!invMap[k]) invMap[k]={inv_no:s.inv_no,file_no:s.file_no,customer:s.customer,invoiced:0,collected:0}; invMap[k].invoiced+=(+s.sale_price||0); });
    collections.filter(isPosted).forEach(c=>{ if(!c.inv_no) return; const k=`${c.file_no}__${c.inv_no}`; if(invMap[k]) invMap[k].collected+=c.paid_date?(+c.amount||0):0; });
    const invRows=Object.values(invMap).map(v=>({...v,outstanding:v.invoiced-v.collected})).sort((a,b)=>b.outstanding-a.outstanding);
    const tInv=invRows.reduce((s,r)=>s+r.invoiced,0), tCol=invRows.reduce((s,r)=>s+r.collected,0), tOut=invRows.reduce((s,r)=>s+r.outstanding,0);

    // ── تسوية الموردين ──
    const payM={};
    (allPayments||[]).filter(isPosted).forEach(p=>{ payM[p.file_no]=(payM[p.file_no]||0)+(+p.amount||0); });
    const dealRows=deals.map(d=>({ file_no:d.file_no,supplier:d.supplier||'—',total:+d.total_purchase||0,paid:payM[d.file_no]||0,outstanding:(+d.total_purchase||0)-(payM[d.file_no]||0),status:d.status })).sort((a,b)=>b.outstanding-a.outstanding);
    const tDC=dealRows.reduce((s,r)=>s+r.total,0), tPD=dealRows.reduce((s,r)=>s+r.paid,0), tDD=dealRows.reduce((s,r)=>s+r.outstanding,0);

    // ── تسوية الشركاء ──
    const partnerNames=[...new Set((allPartners||[]).map(p=>p.partner).filter(Boolean))];
    const partnerRows=partnerNames.map(pName=>{
      const capPaid=(allPayments||[]).filter(p=>isPosted(p)&&p.payer===pName).reduce((s,p)=>s+(+p.amount||0),0);
      const withdrawn=(allPayouts||[]).filter(p=>isPosted(p)&&p.partner===pName).reduce((s,p)=>s+(+p.amount||0),0);
      let profitDue=0, profitPending=0;
      (allPartners||[]).filter(p=>p.partner===pName).forEach(pd=>{
        const deal=deals.find(d=>d.file_no===pd.file_no); if(!deal) return;
        const dS=sales.filter(s=>isPosted(s)&&s.file_no===pd.file_no).reduce((s,x)=>s+(+x.sale_price||0),0);
        const dE=expenses.filter(e=>isPosted(e)&&e.file_no===pd.file_no).reduce((s,x)=>s+(+x.amount||0),0);
        const contrib=(dS-(+deal.total_purchase||0)-dE)*(+pd.share_percent||0)/100;
        // الصفقات المغلقة → ربح محقق · المفتوحة → ربح متوقع
        if (deal.status==='CLOSED') profitDue+=contrib;
        else profitPending+=contrib;
      });
      return { name:pName, capPaid, profitDue, profitPending, withdrawn, balance:capPaid+profitDue-withdrawn };
    });

    const tblStyle='width:100%;border-collapse:collapse';
    const thStyle='background:var(--card2);padding:8px 12px;font-size:13px;font-weight:700;text-align:right;border-bottom:2px solid var(--border)';
    const tdStyle='padding:8px 12px;border-bottom:1px solid var(--border);font-size:12px';

    wrap.innerHTML = `
      <!-- 1. تسوية التحصيلات -->
      <div style="margin-bottom:20px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
        <div style="padding:12px 16px;border-bottom:2px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <span style="font-size:13px;font-weight:700">💰 تسوية التحصيلات — فاتورة بفاتورة</span>
          <div style="display:flex;gap:12px;font-size:13px">
            <span>مُفوتَر: <b>${fmt(tInv)}</b></span>
            <span style="color:var(--green)">محصّل: <b>${fmt(tCol)}</b></span>
            <span style="color:${tOut>0?'var(--red)':'var(--green)'}">متبقي: <b>${fmt(tOut)}</b></span>
          </div>
        </div>
        <div style="overflow-x:auto;max-height:280px;overflow-y:auto">
          <table style="${tblStyle}">
            <thead><tr><th style="${thStyle}">الفاتورة</th><th style="${thStyle}">الملف</th><th style="${thStyle}">العميل</th><th style="${thStyle}">المُفوتَر</th><th style="${thStyle}">المحصّل</th><th style="${thStyle}">المتبقي</th><th style="${thStyle}">الحالة</th></tr></thead>
            <tbody>${invRows.map(r=>{ const sc=r.outstanding<0.01?'var(--green)':r.outstanding<r.invoiced?'var(--accent)':'var(--red)'; const si=r.outstanding<0.01?'✅ مكتمل':r.outstanding<r.invoiced?'⚡ جزئي':'⏳ مستحق';
              return `<tr><td style="${tdStyle}" class="mono text-amber">${r.inv_no||'—'}</td><td style="${tdStyle}" class="mono">${r.file_no||'—'}</td><td style="${tdStyle}">${r.customer||'—'}</td><td style="${tdStyle}" class="mono">${fmt(r.invoiced)}</td><td style="${tdStyle}" class="mono text-green">${fmt(r.collected)}</td><td style="${tdStyle}" class="mono" style="color:${sc};font-weight:700">${fmt(r.outstanding)}</td><td style="${tdStyle}"><span style="font-size:12px;color:${sc};font-weight:700">${si}</span></td></tr>`;
            }).join('')}</tbody>
            <tfoot><tr style="background:var(--card2);font-weight:700"><td colspan="3" style="${tdStyle}">الإجمالي</td><td style="${tdStyle}" class="mono">${fmt(tInv)}</td><td style="${tdStyle}" class="mono text-green">${fmt(tCol)}</td><td style="${tdStyle}" class="mono" style="color:${tOut>0?'var(--red)':'var(--green)'}">${fmt(tOut)}</td><td style="${tdStyle}"></td></tr></tfoot>
          </table>
        </div>
      </div>

      <!-- 2. تسوية الموردين -->
      <div style="margin-bottom:20px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
        <div style="padding:12px 16px;border-bottom:2px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <span style="font-size:13px;font-weight:700">🏭 تسوية الموردين — صفقة بصفقة</span>
          <div style="display:flex;gap:12px;font-size:13px">
            <span>إجمالي: <b>${fmt(tDC)}</b></span>
            <span style="color:var(--green)">مدفوع: <b>${fmt(tPD)}</b></span>
            <span style="color:${tDD>0?'var(--accent)':'var(--green)'}">مستحق: <b>${fmt(tDD)}</b></span>
          </div>
        </div>
        <div style="overflow-x:auto;max-height:260px;overflow-y:auto">
          <table style="${tblStyle}">
            <thead><tr><th style="${thStyle}">الملف</th><th style="${thStyle}">المورد</th><th style="${thStyle}">قيمة الصفقة</th><th style="${thStyle}">المدفوع</th><th style="${thStyle}">المستحق</th><th style="${thStyle}">الحالة</th></tr></thead>
            <tbody>${dealRows.map(r=>{ const sc=r.outstanding<0.01?'var(--green)':r.outstanding>0?'var(--accent)':'var(--red)'; const si=r.outstanding<0.01?'✅ مسدّد':r.outstanding>0?'⏳ متبقي':'⚠️ زيادة';
              return `<tr><td style="${tdStyle}" class="mono text-amber" onclick="openViewer('${r.file_no}')" style="cursor:pointer">${r.file_no}</td><td style="${tdStyle}">${r.supplier}</td><td style="${tdStyle}" class="mono">${fmt(r.total)}</td><td style="${tdStyle}" class="mono text-green">${fmt(r.paid)}</td><td style="${tdStyle}" class="mono" style="font-weight:700;color:${sc}">${fmt(Math.abs(r.outstanding))}</td><td style="${tdStyle}"><span style="font-size:12px;color:${sc};font-weight:700">${si}</span></td></tr>`;
            }).join('')}</tbody>
            <tfoot><tr style="background:var(--card2);font-weight:700"><td colspan="2" style="${tdStyle}">الإجمالي</td><td style="${tdStyle}" class="mono">${fmt(tDC)}</td><td style="${tdStyle}" class="mono text-green">${fmt(tPD)}</td><td style="${tdStyle}" class="mono" style="color:${tDD>0?'var(--accent)':'var(--green)'}">${fmt(tDD)}</td><td style="${tdStyle}"></td></tr></tfoot>
          </table>
        </div>
      </div>

      <!-- 3. تسوية الشركاء -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
        <div style="padding:12px 16px;border-bottom:2px solid var(--border);font-size:13px;font-weight:700">👥 تسوية حسابات الشركاء
          <span style="font-size:13px;font-weight:400;color:var(--text2);margin-right:8px">— الأرباح المحققة من الصفقات المغلقة فقط</span>
        </div>
        <div style="overflow-x:auto">
          <table style="${tblStyle}">
            <thead><tr>
              <th style="${thStyle}">الشريك</th>
              <th style="${thStyle}">رأس المال المدفوع</th>
              <th style="${thStyle}">أرباح محققة (مغلق)</th>
              <th style="${thStyle}">أرباح متوقعة (مفتوح)</th>
              <th style="${thStyle}">إجمالي المسحوب</th>
              <th style="${thStyle}">الرصيد الصافي</th>
              <th style="${thStyle}">الحالة</th>
            </tr></thead>
            <tbody>${partnerRows.map(r=>{ const sc=r.balance>=0?'var(--green)':'var(--red)'; const si=r.balance>=0?'✅ سليم':'🔴 سالب!';
              return `<tr>
                <td style="${tdStyle}" style="font-weight:700">${r.name}</td>
                <td style="${tdStyle}" class="mono text-blue">${fmt(r.capPaid)}</td>
                <td style="${tdStyle}" class="mono" style="color:${r.profitDue>=0?'var(--green)':'var(--red)'}">${fmt(r.profitDue)}</td>
                <td style="${tdStyle}" class="mono text-muted" style="font-size:13px">${fmt(r.profitPending||0)} <span style="font-size:13px;color:var(--text2)">(تقديري)</span></td>
                <td style="${tdStyle}" class="mono text-amber">${fmt(r.withdrawn)}</td>
                <td style="${tdStyle}" class="mono" style="font-weight:900;color:${sc}">${fmt(r.balance)}</td>
                <td style="${tdStyle}"><span style="font-size:12px;color:${sc};font-weight:700">${si}</span></td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>`;
  } catch(e) { wrap.innerHTML=errHTML('خطأ: '+e.message); }
}

// ════ سجل المراجعات ════
export async function loadReviewHistory() {
  const wrap = el('review-history-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري التحميل...</div>';
  try {
    const reviews = await apiGet('audit_log', {
      select:'*', system_type:`eq.${state.system}`,
      action:'eq.PERIOD_REVIEW', order:'created_at.desc', limit:'20',
    });
    if (!reviews?.length) {
      wrap.innerHTML = `<div style="text-align:center;padding:48px 20px;color:var(--text2)">
        <div style="font-size:40px;margin-bottom:12px">📋</div>
        <div style="font-size:14px;font-weight:600;margin-bottom:6px">لا توجد مراجعات محفوظة بعد</div>
        <div style="font-size:12px">أكمل أول مراجعة وستظهر هنا كسجل تاريخي</div>
      </div>`;
      return;
    }
    wrap.innerHTML = `
      <div style="font-size:12px;color:var(--text2);margin-bottom:12px">${reviews.length} مراجعة محفوظة — آخر تحديث ${fmtDate(reviews[0]?.created_at?.split('T')[0])}</div>
      ${reviews.map(r => {
        let data={}; try { data=JSON.parse(r.new_value||'{}'); } catch(e) { data={}; }
        const passed=data.checks_passed||0,warned=data.checks_warned||0,failed=data.checks_failed||0;
        const total=passed+warned+failed;
        const score=total>0?Math.round((passed/total)*100):0;
        const sc=failed>0?'var(--red)':warned>0?'var(--accent)':'var(--green)';
        const label=failed>0?'يحتاج متابعة':warned>0?'مع تحفظات':'مكتمل ✓';
        const dt=r.created_at?new Date(r.created_at).toLocaleString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
        const reviewer=(r.user_email||'unknown').split('@')[0];
        return `<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;margin-bottom:10px;display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <div style="width:54px;height:54px;border-radius:50%;background:${sc}22;border:2px solid ${sc};display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0">
            <div style="font-size:15px;font-weight:900;color:${sc};line-height:1">${score}%</div>
          </div>
          <div style="flex:1;min-width:120px">
            <div style="font-size:13px;font-weight:700;margin-bottom:3px">${data.period_from||'—'} — ${data.period_to||'—'}</div>
            <div style="font-size:13px;color:var(--text2)">✅ ${passed} · ⚠️ ${warned} · ❌ ${failed} &nbsp;|&nbsp; 👤 ${reviewer} &nbsp;|&nbsp; 🕐 ${dt}</div>
            <div style="font-size:13px;color:${sc};font-weight:700;margin-top:3px">${label}</div>
            ${r.notes?`<div style="font-size:13px;color:var(--text2);margin-top:3px;font-style:italic">"${r.notes}"</div>`:''}
          </div>
        </div>`;
      }).join('')}`;
  } catch(e) { wrap.innerHTML=errHTML('خطأ: '+e.message); }
}

// ════════════════════════════════════════════════════════
// JOURNAL ENTRIES MANAGER — دفتر القيود
// ════════════════════════════════════════════════════════

const jeMgrState = {
  period: 'month', from: null, to: null,
  allEntries: [],    // flat rows from journal_entries
  grouped: {},       // entry_no → { header, lines[] }
  editEntryNo: null, // للتعديل
};

// ── الدوال الحسابية المعرّفة للحسابات ──
// قائمة احتياطية بس لو فشل تحميل شجرة الحسابات الفعلية من الداتابيز (نادر) —
// المصدر الأساسي دايماً _jeAccountOptions من جدول chart_of_accounts (بما فيها الحسابات الفرعية).
const JE_ACCOUNT_SUGGESTIONS = [
  { code:'1110', name:'النقد',                  type:'أصول'        },
  { code:'1120', name:'البنك',                  type:'أصول'        },
  { code:'1200', name:'ذمم العملاء',             type:'أصول'        },
  { code:'1300', name:'المخزون — سيارات',        type:'أصول'        },
  { code:'1400', name:'مصاريف مدفوعة مقدماً',   type:'أصول'        },
  { code:'1500', name:'أصول ثابتة',             type:'أصول'        },
  { code:'2100', name:'ذمم الموردين',            type:'التزامات'    },
  { code:'2200', name:'مصاريف مستحقة',          type:'التزامات'    },
  { code:'2300', name:'ضرائب مستحقة',           type:'التزامات'    },
  { code:'2400', name:'حسابات الشركاء',         type:'التزامات'    },
  { code:'3100', name:'رأس المال',              type:'حقوق الملكية'},
  { code:'3200', name:'الأرباح المبقاة',        type:'حقوق الملكية'},
  { code:'4100', name:'إيرادات المبيعات',       type:'إيرادات'     },
  { code:'4200', name:'إيرادات أخرى',          type:'إيرادات'     },
  { code:'5100', name:'تكلفة المخزون المباع',   type:'تكلفة'       },
  { code:'6100', name:'مصروف رواتب',           type:'مصروفات'     },
  { code:'6200', name:'مصروف إيجارات',         type:'مصروفات'     },
  { code:'6300', name:'مصروف عمولات',          type:'مصروفات'     },
  { code:'6400', name:'مصروف نظافة',           type:'مصروفات'     },
  { code:'6500', name:'مصروف ضيافة',           type:'مصروفات'     },
  { code:'6600', name:'مصروفات حكومية',        type:'مصروفات'     },
  { code:'6700', name:'مصروفات أخرى',          type:'مصروفات'     },
];

// المصدر الفعلي لأكواد الحسابات في القيد اليدوي — من شجرة الحسابات الحقيقية
// (chart_of_accounts) بما فيها كل الحسابات الفرعية اللي المستخدم أنشأها، مش القائمة الثابتة فوق.
let _jeAccountOptions = JE_ACCOUNT_SUGGESTIONS.slice();
async function _loadJEAccountOptions() {
  try {
    const rows = await apiGetAll('chart_of_accounts', {
      select: 'account_code,account_name,account_type,parent_code',
      system_type: `eq.${state.system}`, is_active: 'eq.true', order: 'account_code.asc',
    });
    if (rows && rows.length) {
      _jeAccountOptions = rows.map(a => ({ code:a.account_code, name:a.account_name, type:a.account_type, parent:a.parent_code||null }));
    }
  } catch(e) { console.warn('_loadJEAccountOptions:', e.message); }
}

export function showJEManager() {
  hideAllViews();
  el('jeManagerView').style.display = 'block';
  el('topBarTitle').textContent  = '📝 دفتر القيود';
  el('topBarSub').textContent    = `نظام ${state.system}`;
  navActive('nav-je-manager');
  sessionStorage.setItem('tm_last_view','je-manager');
  setJEMgrPeriod('month');
}

export function setJEMgrPeriod(period) {
  jeMgrState.period = period;
  document.querySelectorAll('[id^="je-period-"]').forEach(b => b.classList.remove('active'));
  el('je-period-'+period)?.classList.add('active');
  const customWrap = el('je-custom-dates');
  if (period === 'custom') { if (customWrap) customWrap.style.display='flex'; return; }
  if (customWrap) customWrap.style.display = 'none';
  const pad = n => String(n).padStart(2,'0');
  const now = new Date(), yr = now.getFullYear();
  let from, to;
  if (period === 'month') {
    from = `${yr}-${pad(now.getMonth()+1)}-01`;
    const last = new Date(yr, now.getMonth()+1, 0);
    to   = `${last.getFullYear()}-${pad(last.getMonth()+1)}-${pad(last.getDate())}`;
  } else if (period === 'lastmonth') {
    const lm = new Date(yr, now.getMonth()-1, 1), lme = new Date(yr, now.getMonth(), 0);
    from = `${lm.getFullYear()}-${pad(lm.getMonth()+1)}-01`;
    to   = `${lme.getFullYear()}-${pad(lme.getMonth()+1)}-${pad(lme.getDate())}`;
  } else if (period === 'year')  { from=`${yr}-01-01`; to=`${yr}-12-31`; }
  else if (period === 'all')     { from='2000-01-01'; to='2099-12-31'; }
  if (el('je-from')) el('je-from').value = from || '';
  if (el('je-to'))   el('je-to').value   = to   || '';
  jeMgrState.from = from; jeMgrState.to = to;
  loadJEManager();
}

export async function loadJEManager() {
  const wrap = el('je-mgr-table');
  if (!wrap) return;
  const from = el('je-from')?.value || jeMgrState.from;
  const to   = el('je-to')?.value   || jeMgrState.to;
  jeMgrState.from = from; jeMgrState.to = to;
  wrap.innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري تحميل القيود...</div>';
  if (el('je-mgr-kpis')) el('je-mgr-kpis').innerHTML = '';
  if (el('je-balance-banner')) el('je-balance-banner').innerHTML = '';
  if (el('je-mgr-sub')) el('je-mgr-sub').textContent = `${from} — ${to} · نظام ${state.system}`;

  try {
    const params = {
      select:      '*',
      system_type: `eq.${state.system}`,
      order:       'entry_date.desc,entry_no.desc',
    };
    if (from) params['entry_date'] = `gte.${from}`;
    // Supabase: can't use two conditions on same field in params object — build URL manually
    let url = `${SB_URL}/rest/v1/journal_entries?system_type=eq.${encodeURIComponent(state.system)}&order=entry_date.desc,entry_no.desc&select=*`;
    if (from) url += `&entry_date=gte.${encodeURIComponent(from)}`;
    if (to)   url += `&entry_date=lte.${encodeURIComponent(to+'T23:59:59')}`;
    url += `&limit=2000`;
    const res = await apiFetch(url, {});
    if (!res.ok) throw new Error(await res.text());
    const rows = await res.json();
    jeMgrState.allEntries = rows || [];

    // تجميع بـ entry_no
    const grouped = {};
    (rows||[]).forEach(r => {
      const no = r.entry_no || `SINGLE-${r.id}`;
      if (!grouped[no]) grouped[no] = { no, date:r.entry_date, desc:r.description, file_no:r.file_no, ref_table:r.ref_table, lines:[], totalDr:0, totalCr:0, isManual: r.ref_table==='manual' || !r.ref_table };
      grouped[no].lines.push(r);
      grouped[no].totalDr += +r.dr_amount||0;
      grouped[no].totalCr += +r.cr_amount||0;
    });
    jeMgrState.grouped = grouped;

    // KPIs
    const totalDr  = (rows||[]).reduce((s,r)=>s+(+r.dr_amount||0),0);
    const totalCr  = (rows||[]).reduce((s,r)=>s+(+r.cr_amount||0),0);
    const diff     = Math.abs(totalDr-totalCr);
    const entCount = Object.keys(grouped).length;
    const manualCount = Object.values(grouped).filter(g=>g.isManual).length;
    const autoCount   = entCount - manualCount;

    if (el('je-mgr-kpis')) el('je-mgr-kpis').innerHTML = [
      ['إجمالي القيود', entCount, 'var(--text)'],
      ['🤖 تلقائي', autoCount, 'var(--blue)'],
      ['✍️ يدوي', manualCount, 'var(--purple)'],
      ['إجمالي مدين', fmt(totalDr), 'var(--green)'],
      ['إجمالي دائن', fmt(totalCr), 'var(--red)'],
      ['الفرق', diff<0.01?'✓ متوازن':fmt(diff), diff<0.01?'var(--green)':'var(--red)'],
    ].map(([l,v,c])=>`<div class="j-kpi"><div class="j-kpi-label">${l}</div><div class="j-kpi-val" style="color:${c}">${v}</div></div>`).join('');

    // Balance banner
    if (el('je-balance-banner')) {
      if (diff < 0.01) {
        el('je-balance-banner').innerHTML = `<div style="background:var(--green-dim);border:1px solid var(--green);border-radius:var(--radius-sm);padding:8px 14px;font-size:12px;font-weight:700;color:var(--green)">✅ القيود متوازنة — مدين = دائن = ${fmt(totalDr)}</div>`;
      } else {
        // حساب القيود غير المتوازنة
        const unbalanced = Object.values(jeMgrState.grouped).filter(g => Math.abs(g.totalDr-g.totalCr)>0.01);
        el('je-balance-banner').innerHTML = `
          <div style="background:var(--red-dim);border:2px solid var(--red);border-radius:var(--radius-sm);padding:10px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <div style="flex:1;min-width:200px">
              <div style="font-size:12px;font-weight:700;color:var(--red)">❌ فرق ${fmt(diff)} بين المدين والدائن — يؤثر على ميزان المراجعة!</div>
              <div style="font-size:13px;color:var(--text2);margin-top:3px">${unbalanced.length} قيد غير متوازن — السبب: فشل جزئي أثناء الترحيل أو الإدخال</div>
            </div>
            <button class="btn btn-sm" onclick="fixUnbalancedEntries()" style="background:var(--red);color:#fff;border:none;font-weight:700;white-space:nowrap">🔧 إصلاح تلقائي</button>
            <button class="btn btn-secondary btn-sm" onclick="showUnbalancedDetail()" style="white-space:nowrap">🔍 تفاصيل</button>
          </div>`;
      }
    }

    renderJEManagerTable();
  } catch(e) {
    wrap.innerHTML = errHTML('خطأ: '+e.message);
    console.error(e);
  }
}

export function renderJEManagerTable() {
  const wrap     = el('je-mgr-table');
  if (!wrap) return;
  const srcFilter = el('je-filter-source')?.value || '';
  const search    = (el('je-filter-search')?.value||'').trim().toLowerCase();

  let entries = Object.values(jeMgrState.grouped);

  // فلتر المصدر
  if (srcFilter === 'manual') {
    entries = entries.filter(g => g.isManual);
  } else if (srcFilter === 'auto') {
    entries = entries.filter(g => !g.isManual);
  } else if (srcFilter) {
    entries = entries.filter(g => g.ref_table === srcFilter);
  }

  // فلتر البحث
  if (search) {
    entries = entries.filter(g =>
      (g.no||'').toLowerCase().includes(search) ||
      (g.desc||'').toLowerCase().includes(search) ||
      (g.file_no||'').toLowerCase().includes(search) ||
      g.lines.some(l => (l.account_name||'').toLowerCase().includes(search) || (l.account_code||'').toLowerCase().includes(search))
    );
  }

  if (!entries.length) {
    wrap.innerHTML = emptyHTML('📝','لا توجد قيود في هذه الفترة');
    return;
  }

  const srcLabels = {
    purchase_orders:'شراء', sales:'بيع', collections:'تحصيل',
    payments:'دفعة مورد', expenses:'مصروف', partner_payouts:'صرف شريك',
    operating_expenses:'مصروف تشغيلي', manual:'يدوي', reversal:'قيد عكسي',
  };
  const srcColors = {
    purchase_orders:'var(--accent)', sales:'var(--green)', collections:'var(--blue)',
    payments:'var(--cyan)', expenses:'var(--red)', partner_payouts:'var(--purple)',
    operating_expenses:'var(--purple)', manual:'var(--text)', reversal:'var(--text2)',
  };
  const isAdmin = state.userRole === 'admin';

  const rows = entries.map(g => {
    const balanced = Math.abs(g.totalDr - g.totalCr) < 0.01;
    const srcLabel = srcLabels[g.ref_table] || (g.isManual?'يدوي':'تلقائي');
    const srcColor = srcColors[g.ref_table] || 'var(--text2)';
    const balIcon  = balanced ? '<span style="color:var(--green);font-weight:700">✓</span>' : '<span style="color:var(--red);font-weight:700">!</span>';

    const linesHtml = g.lines.map(l => `
      <tr style="background:var(--card2)">
        <td style="padding:5px 12px 5px 28px;font-size:13px">
          <span class="mono" style="color:var(--text2)">${l.account_code||'—'}</span>
        </td>
        <td style="padding:5px 12px;font-size:13px;color:var(--text2)">${l.account_name||'—'}</td>
        <td style="padding:5px 12px;text-align:left;font-family:var(--mono);font-size:13px;color:var(--green)">${+l.dr_amount>0?fmt(l.dr_amount):'—'}</td>
        <td style="padding:5px 12px;text-align:left;font-family:var(--mono);font-size:13px;color:var(--red)">${+l.cr_amount>0?fmt(l.cr_amount):'—'}</td>
        <td></td>
      </tr>`).join('');

    const ctxBtn = isAdmin
      ? `<button class="btn-ctx-menu" onclick="event.stopPropagation();_ctxJE(this)" data-no="${g.no}" data-manual="${g.isManual?'1':'0'}" title="إجراءات">⋮</button>`
      : '';

    return `
      <tr class="je-entry-row" onclick="toggleJELines(this)" style="cursor:pointer">
        <td style="padding:10px 12px">
          <div style="font-size:13px;font-weight:700;font-family:var(--mono);color:var(--accent)">${g.no}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:1px">${g.date||'—'}</div>
        </td>
        <td style="padding:10px 12px">
          <div style="font-size:12px;font-weight:600">${g.desc||'—'}</div>
          ${g.file_no?`<div style="font-size:12px;color:var(--text2);margin-top:1px">ملف: ${g.file_no}</div>`:''}
        </td>
        <td style="padding:10px 12px">
          <span style="font-size:13px;font-weight:700;padding:2px 8px;border-radius:10px;background:${srcColor}22;color:${srcColor}">${srcLabel}</span>
        </td>
        <td style="padding:10px 12px;text-align:left;font-family:var(--mono);font-size:12px;font-weight:700;color:var(--green)">${fmt(g.totalDr)}</td>
        <td style="padding:10px 12px;text-align:left;font-family:var(--mono);font-size:12px;font-weight:700;color:var(--red)">${fmt(g.totalCr)}</td>
        <td style="padding:10px 12px;text-align:center">${balIcon}</td>
        <td style="padding:10px 12px;text-align:center">${ctxBtn}</td>
      </tr>
      <tr class="je-lines-row" style="display:none">
        <td colspan="7" style="padding:0;background:var(--card2)">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:var(--card);border-bottom:1px solid var(--border)">
              <th style="padding:5px 12px 5px 28px;font-size:12px;color:var(--text3);text-align:right">الكود</th>
              <th style="padding:5px 12px;font-size:12px;color:var(--text3);text-align:right">الحساب</th>
              <th style="padding:5px 12px;font-size:12px;color:var(--green);text-align:left">مدين</th>
              <th style="padding:5px 12px;font-size:12px;color:var(--red);text-align:left">دائن</th>
              <th></th>
            </tr></thead>
            <tbody>${linesHtml}</tbody>
          </table>
        </td>
      </tr>`;
  }).join('');

  wrap.innerHTML = `
    <div style="font-size:13px;color:var(--text2);margin-bottom:6px">${entries.length} قيد · اضغط على أي صف لعرض الأسطر</div>
    <div style="overflow-x:auto">
    <table class="data-table" style="min-width:700px">
      <thead><tr>
        <th>رقم القيد</th>
        <th>البيان</th>
        <th>المصدر</th>
        <th style="text-align:left;color:var(--green)">مدين</th>
        <th style="text-align:left;color:var(--red)">دائن</th>
        <th style="text-align:center">توازن</th>
        <th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>`;
}

export function showUnbalancedDetail() {
  const unbalanced = Object.values(jeMgrState.grouped).filter(g => Math.abs(g.totalDr-g.totalCr)>0.01);
  if (!unbalanced.length) { toast('✅ لا توجد قيود غير متوازنة','ok'); return; }

  const rows = unbalanced.map(g => {
    const diff = g.totalDr - g.totalCr;
    // ✅ Audit fix: escaping احترازي على الحقول النصية قبل الحقن في innerHTML
    const esc = v => String(v||'—').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return `<tr style="background:var(--red-dim)">
      <td class="mono" style="color:var(--accent);font-weight:700;padding:8px 12px">${esc(g.no)}</td>
      <td style="padding:8px 12px;font-size:13px">${esc(g.desc)}</td>
      <td style="padding:8px 12px;font-size:13px">${esc(g.ref_table||'manual')}</td>
      <td style="padding:8px 12px;font-size:13px">${esc(g.file_no)}</td>
      <td class="mono" style="padding:8px 12px;color:var(--green)">${fmt(g.totalDr)}</td>
      <td class="mono" style="padding:8px 12px;color:var(--red)">${fmt(g.totalCr)}</td>
      <td class="mono" style="padding:8px 12px;font-weight:700;color:var(--red)">${diff>0?'+':''}${fmt(diff)}</td>
    </tr>`;
  }).join('');

  // ✅ Audit fix: showConfirm تستخدم textContent فتُهرّب HTML — نستخدم showConfirmHtml
  // لعرض الجدول بشكل صحيح مع الحفاظ على escaping الحقول النصية أعلاه
  showConfirmHtml(
    `🔍 ${unbalanced.length} قيد غير متوازن`,
    `<div style="overflow-x:auto;max-height:300px;overflow-y:auto">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:var(--card2)">
          <th style="padding:7px 10px;text-align:right">القيد</th>
          <th style="padding:7px 10px;text-align:right">البيان</th>
          <th style="padding:7px 10px;text-align:right">المصدر</th>
          <th style="padding:7px 10px;text-align:right">الملف</th>
          <th style="padding:7px 10px;text-align:left;color:var(--green)">مدين</th>
          <th style="padding:7px 10px;text-align:left;color:var(--red)">دائن</th>
          <th style="padding:7px 10px;text-align:left">الفرق</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="margin-top:10px;font-size:13px;color:var(--text2)">اضغط "إصلاح" لحذف هذه القيود وإعادة ترحيل بياناتها</div>`,
    () => fixUnbalancedEntries()
  );
}
export async function fixUnbalancedEntries() {
  const unbalanced = Object.values(jeMgrState.grouped).filter(g => Math.abs(g.totalDr-g.totalCr)>0.01);
  if (!unbalanced.length) { toast('✅ لا توجد قيود غير متوازنة','ok'); return; }

  const sys = state.system;
  toast(`⏳ جاري إصلاح ${unbalanced.length} قيد...`,'ok');

  let fixed = 0, failed = 0;

  for (const g of unbalanced) {
    try {
      // حذف القيد الناقص
      const delRes = await fetch(
        `${SB_URL}/rest/v1/journal_entries?entry_no=eq.${encodeURIComponent(g.no)}&system_type=eq.${encodeURIComponent(sys)}`,
        { method:'DELETE', headers: headers() }
      );
      if (!delRes.ok && delRes.status !== 404) throw new Error('فشل الحذف');

      // إعادة توليد القيد من المصدر الأصلي
      if (g.ref_table && g.ref_table !== 'manual') {
        const refTable = g.ref_table;
        const fileNo   = g.file_no;

        // جلب السجل الأصلي
        if (refTable === 'purchase_orders' && fileNo) {
          const data = await apiGetAll('purchase_orders', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` });
          const d = data?.[0];
          if (d && +d.total_purchase > 0)
            await je_purchase({ sys, date:d.po_date||today(), amount:+d.total_purchase, fileNo:d.file_no, supplier:d.supplier||'', refId:d.id||null });

        } else if (refTable === 'payments' && fileNo) {
          // جلب كل الدفعات لهذا الملف وإعادة قيدها
          const data = await apiGetAll('payments', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` });
          for (const p of (data||[]).filter(isPosted)) {
            if (+p.amount > 0)
              await je_payment({ sys, date:p.pay_date||today(), amount:+p.amount, fileNo:p.file_no,refId:p.id||null, supplierName:p.supplier||'', payerName:p.payer||'', method:p.pay_method||'تحويل بنكي' });
          }

        } else if (refTable === 'sales' && fileNo) {
          const data = await apiGetAll('sales', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` });
          // COGS = (إجمالي الشراء + المصاريف) ÷ عدد السيارات × عدد سيارات الفاتورة
          const byInv = {};
          (data||[]).filter(isPosted).forEach(s => {
            const k=`${s.file_no}__${s.inv_no||s.id}`;
            if(!byInv[k]) byInv[k]={...s,total:0,soldCount:0,vins:[]};
            byInv[k].total     += +s.sale_price||0;
            byInv[k].soldCount += 1;
            byInv[k].vins.push(s.vin);
          });
          for (const s of Object.values(byInv)) {
            if (s.total > 0) {
              // ✅ post_sale_je idempotent بـref_id=inv_no — لو فاتورة تانية في
              // نفس الملف ليها قيد صحيح بالفعل، بترجع already_posted بدل ما
              // تكرره (كانت calcCOGS+je_sale القديمة بتكرر بلا شرط)
              await apiRpc('post_sale_je', {
                p_sys: sys, p_file_no: s.file_no, p_inv_no: s.inv_no || ('SALE-' + s.id),
                p_customer: s.customer || '', p_date: s.sale_date || today(),
                p_sold_vins: s.vins.filter(Boolean), p_sale_amount: s.total,
              });
            }
          }

        } else if (refTable === 'collections' && fileNo) {
          const data = await apiGetAll('collections', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` });
          for (const c of (data||[]).filter(c=>isPosted(c)&&c.paid_date)) {
            if (+c.amount > 0)
              await je_collection({ sys, date:c.paid_date, amount:+c.amount, fileNo:c.file_no,refId:c.id||null, customer:c.customer||'', invNo:c.inv_no||'', method:c.pay_method||'تحويل بنكي' });
          }

        } else if (refTable === 'expenses' && fileNo) {
          const data = await apiGetAll('expenses', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` });
          for (const e of (data||[]).filter(isPosted)) {
            if (+e.amount > 0)
              await je_expense({ sys, date:e.exp_date||today(), amount:+e.amount, fileNo:e.file_no,refId:e.id||null, desc:e.description||'مصروف', expType:e.exp_type||'أخرى', method:e.pay_method||'نقد' });
          }

        } else if (refTable === 'partner_payouts' && fileNo) {
          const data = await apiGetAll('partner_payouts', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` });
          for (const p of (data||[]).filter(isPosted)) {
            if (+p.amount > 0)
              await je_payout({ sys, date:p.pay_date||today(), amount:+p.amount, fileNo:p.file_no,refId:p.id||null, partner:p.partner||'', method:p.pay_method||'نقد' });
          }

        } else if (refTable === 'operating_expenses') {
          const data = await apiGetAll('operating_expenses', { select:'*', system_type:`eq.${sys}` });
          for (const o of (data||[])) {
            if (+o.amount > 0)
              await je_opex({ sys, date:o.exp_date||today(), amount:+o.amount, expType:o.exp_type||'أخرى', desc:o.description||'', method:o.pay_method||'نقد', refNo:o.ref_no||null });
          }
        }
      }
      fixed++;
    } catch(e) {
      failed++;
      console.warn(`Fix failed for ${g.no}:`, e.message);
    }
  }

  const msg = failed > 0
    ? `⚠️ تم إصلاح ${fixed} قيد — فشل ${failed}. شغّل الترحيل الكامل لو المشكلة مستمرة.`
    : `✅ تم إصلاح ${fixed} قيد بنجاح`;
  toast(msg, failed > 0 ? 'warn' : 'ok');
  await loadJEManager();
}

// ════════════════════════════════════════
// فحص القيود المفقودة — سجلات posted بدون قيد محاسبي مطابق
// ════════════════════════════════════════
const MISSING_JE_TABLES = [
  { table:'expenses',        label:'مصروف',       refLabel:'EXP' },
  { table:'payments',        label:'دفعة مورد',    refLabel:'PMT' },
  { table:'collections',     label:'تحصيل',        refLabel:'COL' },
  { table:'partner_payouts', label:'صرف شريك',     refLabel:'PAY' },
];

export async function checkMissingEntries() {
  const sys = state.system;
  toast('⏳ جاري فحص القيود المفقودة...','ok');
  try {
    const jeRows = await apiGetAll('journal_entries', { select:'ref_table,ref_id', system_type:`eq.${sys}` });
    const haveJE = new Set((jeRows||[]).filter(r=>r.ref_table && r.ref_id!=null).map(r=>`${r.ref_table}:${r.ref_id}`));

    const missing = [];
    for (const { table, label, refLabel } of MISSING_JE_TABLES) {
      const rows = await apiGetAll(table, { select:'*', system_type:`eq.${sys}`, post_status:'eq.posted' });
      for (const r of (rows||[])) {
        if (+r.amount > 0 && !haveJE.has(`${table}:${r.id}`)) {
          if (table === 'collections' && !r.paid_date) continue; // مستحق غير محصَّل — لا قيد متوقع
          missing.push({ table, label, refLabel, row:r });
        }
      }
    }

    if (!missing.length) { toast('✅ لا توجد سجلات مرحّلة بدون قيود','ok'); return; }

    const esc = v => String(v||'—').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const rowsHTML = missing.map((m,i) => {
      const r = m.row;
      return `<tr>
        <td style="padding:7px 10px;font-size:13px">${esc(m.label)}</td>
        <td style="padding:7px 10px;font-size:13px">${esc(r.file_no)}</td>
        <td style="padding:7px 10px;font-size:13px">${esc(r.pay_id || r.ref_no || r.id)}</td>
        <td class="mono" style="padding:7px 10px;color:var(--accent)">${fmt(r.amount)}</td>
        <td style="padding:7px 10px;text-align:left">
          <button class="btn btn-sm btn-primary" onclick="createMissingJE(${i})">📝 إنشاء القيد</button>
        </td>
      </tr>`;
    }).join('');

    _missingJEList = missing;

    el('missingJETitle').textContent = `⚠️ ${missing.length} سجل مرحّل بدون قيد محاسبي`;
    el('missingJEBody').innerHTML = `<div style="margin-bottom:10px"><button class="btn btn-sm btn-primary" onclick="createAllMissingJE()">⚡ إنشاء كل القيود الناقصة (${missing.length})</button></div><div style="overflow-x:auto;max-height:320px;overflow-y:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:var(--card2)">
            <th style="padding:7px 10px;text-align:right">النوع</th>
            <th style="padding:7px 10px;text-align:right">الملف</th>
            <th style="padding:7px 10px;text-align:right">المرجع</th>
            <th style="padding:7px 10px;text-align:left">المبلغ</th>
            <th></th>
          </tr></thead>
          <tbody id="missing-je-tbody">${rowsHTML}</tbody>
        </table>
      </div>
      <div style="margin-top:10px;font-size:13px;color:var(--text2)">هذه السجلات معلّمة "مرحّلة" لكن لا يوجد لها قيد في دفتر القيود — اضغط "إنشاء القيد" لكل سجل لترحيله.</div>`;
    openModal('missingJEModal');
  } catch(e) {
    toast('خطأ: '+e.message,'err');
  }
}

let _missingJEList = [];

export async function createMissingJE(idx) {
  const m = _missingJEList[idx];
  if (!m) return;
  const r = m.row;
  const sys = state.system;
  try {
    if (m.table === 'expenses') {
      await je_expense({ sys, date:r.exp_date||r.expense_date||today(), amount:+r.amount, fileNo:r.file_no, refId:r.id, desc:r.description||'مصروف', expType:r.exp_type||r.category||'أخرى', method:r.pay_method||'نقد' });
    } else if (m.table === 'payments') {
      await je_payment({ sys, date:r.pay_date||today(), amount:+r.amount, fileNo:r.file_no, refId:r.id, supplierName:r.supplier||'', payerName:r.payer||'', method:r.pay_method||'نقد' });
    } else if (m.table === 'collections') {
      if (!r.paid_date) { toast('⚠️ هذا التحصيل مستحق (غير مدفوع) — لا يُنشأ له قيد','warn'); return; }
      await je_collection({ sys, date:r.paid_date, amount:+r.amount, fileNo:r.file_no, refId:r.id, customer:r.customer||'—', invNo:r.inv_no||'', method:r.pay_method||'نقد' });
    } else if (m.table === 'partner_payouts') {
      await je_payout({ sys, date:r.pay_date||today(), amount:+r.amount, fileNo:r.file_no, refId:r.id, partner:r.partner||'', method:r.pay_method||'نقد' });
    }
    toast(`✅ تم إنشاء القيد لـ ${m.label} (${r.file_no})`,'ok');
    const tr = document.querySelector(`#missing-je-tbody tr:nth-child(${idx+1})`);
    if (tr) tr.style.opacity = '0.4';
    const btn = tr?.querySelector('button');
    if (btn) { btn.disabled = true; btn.textContent = '✅ تم'; }
    await loadJEManager();
  } catch(e) {
    toast(`⚠️ فشل إنشاء القيد: ${e.message}`,'err');
  }
}

// ✅ إنشاء كل القيود الناقصة دفعة واحدة (شبكة أمان لإصلاح اليتامى من سباق الموافقات)
export async function createAllMissingJE() {
  const list = _missingJEList || [];
  if (!list.length) { toast('لا يوجد ما يُصلَح','ok'); return; }
  const sys = state.system;
  let ok = 0, fail = 0;
  for (const m of list) {
    const r = m.row;
    try {
      // فحص وجود القيد أولاً (تفادي التكرار)
      const ex = await apiGet('journal_entries', { select:'entry_no', system_type:`eq.${sys}`, ref_table:`eq.${m.table}`, ref_id:`eq.${r.id}`, post_status:'eq.posted', limit:1 });
      if (ex?.length) { ok++; continue; }
      if (m.table === 'expenses') {
        await je_expense({ sys, date:r.exp_date||r.expense_date||today(), amount:+r.amount, fileNo:r.file_no, refId:r.id, desc:r.description||'مصروف', expType:r.exp_type||r.category||'أخرى', method:r.pay_method||'نقد' });
      } else if (m.table === 'payments') {
        await je_payment({ sys, date:r.pay_date||today(), amount:+r.amount, fileNo:r.file_no, refId:r.id, supplierName:r.supplier||'', payerName:r.payer||'', method:r.pay_method||'نقد' });
      } else if (m.table === 'collections') {
        if (!r.paid_date) continue;
        await je_collection({ sys, date:r.paid_date, amount:+r.amount, fileNo:r.file_no, refId:r.id, customer:r.customer||'—', invNo:r.inv_no||'', method:r.pay_method||'نقد' });
      } else if (m.table === 'partner_payouts') {
        await je_payout({ sys, date:r.pay_date||today(), amount:+r.amount, fileNo:r.file_no, refId:r.id, partner:r.partner||'', method:r.pay_method||'نقد' });
      }
      ok++;
    } catch(e) { fail++; console.warn('createAllMissingJE:', m.table, r.id, e.message); }
  }
  invalidateCache();
  toast(`✅ تم إنشاء ${ok} قيد${fail?` · ${fail} فشل`:''}`, fail?'warn':'ok');
  closeModal('missingJEModal');
  await checkMissingEntries(); // إعادة فحص لتأكيد عدم بقاء يتامى
}

export function toggleJELines(row) {
  const next = row.nextElementSibling;
  if (!next || !next.classList.contains('je-lines-row')) return;
  const isHidden = next.style.display === 'none' || !next.style.display;
  next.style.display = isHidden ? 'table-row' : 'none';
  row.style.background = isHidden ? 'var(--accent-dim)' : '';
}

// ═══ إنشاء / تعديل قيد يدوي ═══

let _jeLines = []; // أسطر القيد الحالية في الموديل

export async function openNewJEModal() {
  jeMgrState.editEntryNo = null;
  _jeLines = [
    { acc:'', name:'', dr:0, cr:0 },
    { acc:'', name:'', dr:0, cr:0 },
  ];
  el('je-modal-title').textContent  = '📝 قيد محاسبي جديد';
  el('je-edit-entry-no').value      = '';
  el('je-date').value               = today();
  el('je-file-no').value            = '';
  el('je-desc').value               = '';
  el('je-submit-btn').textContent   = '💾 حفظ القيد';
  el('jeError').style.display       = 'none';
  renderJELines();
  openModal('jeModal');
  await _loadJEAccountOptions();
  renderJELines();
}

export async function openEditJEModal(entryNo) {
  const group = jeMgrState.grouped[entryNo];
  if (!group) { toast('القيد غير موجود','err'); return; }
  if (!group.isManual) { toast('⚠️ لا يمكن تعديل القيود التلقائية — راجع العملية الأصلية','warn'); return; }
  jeMgrState.editEntryNo = entryNo;
  _jeLines = group.lines.map(l => ({ acc: l.account_code||'', name: l.account_name||'', dr: +l.dr_amount||0, cr: +l.cr_amount||0 }));
  el('je-modal-title').textContent  = `✏️ تعديل قيد — ${entryNo}`;
  el('je-edit-entry-no').value      = entryNo;
  el('je-date').value               = (group.date||'').split('T')[0];
  el('je-file-no').value            = group.file_no || '';
  el('je-desc').value               = group.desc    || '';
  el('je-submit-btn').textContent   = '💾 حفظ التعديل';
  el('jeError').style.display       = 'none';
  renderJELines();
  openModal('jeModal');
  await _loadJEAccountOptions();
  renderJELines();
}

export function renderJELines() {
  const tbody = el('je-lines-body');
  if (!tbody) return;
  tbody.innerHTML = _jeLines.map((line, i) => {
    const suggestions = _jeAccountOptions.map(s =>
      `<option value="${s.code}">${s.parent ? '↳ ' : ''}${s.code} — ${s.name}</option>`
    ).join('');
    const match = _jeAccountOptions.find(s => s.code === (line.acc||'').trim());
    const linked = !!match;
    return `<tr id="je-line-${i}">
      <td style="padding:4px 6px">
        <div style="position:relative">
          <input list="je-acc-list-${i}" type="text" value="${line.acc}"
            placeholder="1110" style="width:90px;background:var(--card2);border:1px solid var(--border);border-radius:4px;padding:5px 8px;color:var(--text);font-family:var(--mono);font-size:12px"
            oninput="onJEAccInput(${i},this.value)" onchange="onJEAccChange(${i},this.value)">
          <datalist id="je-acc-list-${i}">${suggestions}</datalist>
        </div>
      </td>
      <td style="padding:4px 6px">
        <input type="text" id="je-line-name-${i}" value="${line.name}" readonly placeholder="${linked?'':'اختر رقم حساب صحيح من القائمة ⟵'}"
          style="width:100%;min-width:160px;background:var(--card2);border:1px solid ${linked?'var(--border)':'var(--red)'};border-radius:4px;padding:5px 8px;color:${linked?'var(--text)':'var(--red)'};font-family:'Cairo',sans-serif;font-size:12px;cursor:not-allowed">
      </td>
      <td style="padding:4px 6px">
        <input type="number" value="${line.dr||''}" placeholder="0.00" min="0" step="0.01"
          style="width:110px;background:var(--card2);border:1px solid var(--green);border-radius:4px;padding:5px 8px;color:var(--green);font-family:var(--mono);font-size:12px;text-align:left"
          oninput="_jeLines[${i}].dr=parseFloat(this.value)||0;_jeLines[${i}].cr=0;updateJETotals()">
      </td>
      <td style="padding:4px 6px">
        <input type="number" value="${line.cr||''}" placeholder="0.00" min="0" step="0.01"
          style="width:110px;background:var(--card2);border:1px solid var(--red);border-radius:4px;padding:5px 8px;color:var(--red);font-family:var(--mono);font-size:12px;text-align:left"
          oninput="_jeLines[${i}].cr=parseFloat(this.value)||0;_jeLines[${i}].dr=0;updateJETotals()">
      </td>
      <td style="padding:4px 6px;text-align:center">
        ${_jeLines.length > 2 ? `<button onclick="removeJELine(${i})" class="btn btn-sm" style="background:var(--red-dim);color:var(--red);border:none;padding:3px 8px;font-size:13px">✕</button>` : ''}
      </td>
    </tr>`;
  }).join('');
  updateJETotals();
}

export function addJELine() {
  _jeLines.push({ acc:'', name:'', dr:0, cr:0 });
  renderJELines();
}

export function removeJELine(i) {
  if (_jeLines.length <= 2) return;
  _jeLines.splice(i, 1);
  renderJELines();
}

// اسم الحساب دايماً مرتبط تلقائيًا برقمه من شجرة الحسابات الفعلية — مفيش كتابة اسم مستقل
// عن الرقم؛ لو الرقم مش موجود في الشجرة يفضل الاسم فاضغ (حقل قراءة فقط) لحد ما يختار رقم صحيح.
function _syncJELineName(i) {
  const match = _jeAccountOptions.find(s => s.code === (_jeLines[i].acc||'').trim());
  _jeLines[i].name = match ? match.name : '';
  const nameInp = el(`je-line-name-${i}`);
  if (nameInp) {
    nameInp.value = _jeLines[i].name;
    nameInp.style.borderColor = match ? 'var(--border)' : 'var(--red)';
    nameInp.style.color       = match ? 'var(--text)'   : 'var(--red)';
    nameInp.placeholder       = match ? '' : 'اختر رقم حساب صحيح من القائمة ⟵';
  }
}

export function onJEAccInput(i, val) {
  _jeLines[i].acc = val;
  _syncJELineName(i);
}

export function onJEAccChange(i, val) {
  _jeLines[i].acc = val.trim();
  _syncJELineName(i);
}

export function updateJETotals() {
  const totalDr = _jeLines.reduce((s,l)=>s+(+l.dr||0),0);
  const totalCr = _jeLines.reduce((s,l)=>s+(+l.cr||0),0);
  const diff    = Math.abs(totalDr-totalCr);
  if (el('je-total-dr')) el('je-total-dr').textContent = fmt(totalDr);
  if (el('je-total-cr')) el('je-total-cr').textContent = fmt(totalCr);
  const ind = el('je-balance-indicator');
  if (ind) {
    if (totalDr===0 && totalCr===0) { ind.style.display='none'; return; }
    ind.style.display = 'block';
    if (diff < 0.01) {
      ind.style.background = 'var(--green-dim)';
      ind.style.border     = '1px solid var(--green)';
      ind.style.color      = 'var(--green)';
      ind.textContent      = `✅ القيد متوازن — مدين = دائن = ${fmt(totalDr)}`;
    } else {
      ind.style.background = 'var(--red-dim)';
      ind.style.border     = '1px solid var(--red)';
      ind.style.color      = 'var(--red)';
      ind.textContent      = `❌ غير متوازن — مدين: ${fmt(totalDr)} · دائن: ${fmt(totalCr)} · فرق: ${fmt(diff)}`;
    }
  }
}

export async function submitJE() {
  const date    = el('je-date').value;
  const desc    = el('je-desc').value.trim();
  const fileNo  = el('je-file-no').value.trim() || null;
  const entryNo = el('je-edit-entry-no').value || null;
  const errEl   = el('jeError');

  // قراءة القيم من الـ inputs (لأن _jeLines قد لا يتحدث لحظياً مع كل keypress)
  document.querySelectorAll('#je-lines-body tr').forEach((row, i) => {
    const inputs = row.querySelectorAll('input');
    if (inputs.length >= 4) {
      if (_jeLines[i]) {
        _jeLines[i].acc  = inputs[0].value.trim();
        _jeLines[i].name = inputs[1].value.trim();
        _jeLines[i].dr   = parseFloat(inputs[2].value) || 0;
        _jeLines[i].cr   = parseFloat(inputs[3].value) || 0;
      }
    }
  });

  errEl.style.display = 'none';
  if (!date) { showFieldErr('jeError','يرجى تحديد التاريخ'); return; }
  if (!desc) { showFieldErr('jeError','يرجى كتابة بيان القيد'); return; }

  const validLines = _jeLines.filter(l => l.acc || l.name || l.dr || l.cr);
  if (validLines.length < 2) { showFieldErr('jeError','يجب أن يكون في القيد سطران على الأقل'); return; }

  const unlinked = validLines.find(l => !_jeAccountOptions.find(s => s.code === (l.acc||'').trim()));
  if (unlinked) { showFieldErr('jeError',`❌ رقم الحساب "${unlinked.acc||'—'}" غير موجود في شجرة الحسابات — اختر رقمًا من القائمة أو أضِفه أولاً من شجرة الحسابات`); return; }

  const totalDr = validLines.reduce((s,l)=>s+(+l.dr||0),0);
  const totalCr = validLines.reduce((s,l)=>s+(+l.cr||0),0);
  if (Math.abs(totalDr-totalCr) > 0.01) {
    showFieldErr('jeError',`❌ القيد غير متوازن — مدين: ${fmt(totalDr)} · دائن: ${fmt(totalCr)} · فرق: ${fmt(Math.abs(totalDr-totalCr))}`);
    return;
  }
  if (totalDr <= 0) { showFieldErr('jeError','المبالغ يجب أن تكون أكبر من صفر'); return; }

  const btn = el('je-submit-btn');
  btn.disabled = true; btn.textContent = '⏳ جاري الحفظ...';

  try {
    // ✅ لو تعديل: وثّق شكل القيد القديم فعلياً قبل حذفه (كان يُسجَّل old_value=null —
    // فجوة تدقيق: الأسطر القديمة تُحذف نهائياً بدون أي أثر لشكلها قبل التعديل)
    let oldLinesSnapshot = null;
    if (entryNo) {
      try {
        const oldRows = await apiGetAll('journal_entries', {
          select: 'account_code,account_name,dr_amount,cr_amount,entry_date,description',
          system_type: `eq.${state.system}`, entry_no: `eq.${entryNo}`,
        });
        oldLinesSnapshot = { entry_no: entryNo, lines: oldRows || [] };
      } catch(e) { console.warn('submitJE: فشل توثيق القيد القديم قبل التعديل:', e.message); }
    }

    // لو تعديل: احذف القيود القديمة بنفس entry_no أولاً
    if (entryNo) {
      const delRes = await fetch(`${SB_URL}/rest/v1/journal_entries?entry_no=eq.${encodeURIComponent(entryNo)}&system_type=eq.${encodeURIComponent(state.system)}`, {
        method: 'DELETE', headers: headers(),
      });
      if (!delRes.ok && delRes.status !== 404) throw new Error('فشل حذف القيد القديم');
    }

    // إنشاء رقم قيد جديد
    const no = entryNo || await _jeNo(state.system);

    // إدراج الأسطر
    for (const l of validLines) {
      const row = {
        system_type:  state.system,
        entry_no:     no,
        entry_date:   date,
        account_code: l.acc  || null,
        account_name: l.name || null,
        dr_amount:    +l.dr  || 0,
        cr_amount:    +l.cr  || 0,
        description:  desc,
        ref_table:    'manual',
        ref_id:       null,
        file_no:      fileNo,
        post_status:  'posted',
        posted_at:    new Date().toISOString(),
      };
      const r = await fetch(`${SB_URL}/rest/v1/journal_entries`, {
        method:'POST', headers:{...headers(),'Prefer':'return=minimal'}, body:JSON.stringify(row),
      });
      if (!r.ok) throw new Error(`فشل إدراج السطر: ${await r.text()}`);
    }

    await logAudit(entryNo?'UPDATE':'INSERT','journal_entries', fileNo, oldLinesSnapshot, { entry_no:no, desc, totalDr, totalCr });
    closeModal('jeModal');
    toast(`✅ تم ${entryNo?'تعديل':'حفظ'} القيد ${no}`, 'ok');
    await loadJEManager();
  } catch(e) {
    showFieldErr('jeError','خطأ: '+e.message);
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = entryNo ? '💾 حفظ التعديل' : '💾 حفظ القيد';
  }
}

// opts (اختياري) — لإعادة استخدام نفس منطق الحذف من شاشات تانية غير دفتر القيود
// (مثال: صف اليومية) من غير الاعتماد على jeMgrState اللي بيتملى بس لما تتفتح شاشة دفتر القيود:
//   opts.group     — نفس شكل عنصر jeMgrState.grouped[entryNo] جاهز (بدل قراءته من jeMgrState)
//   opts.onDeleted — دالة تحديث الشاشة الحالية بعد الحذف (بدل loadJEManager الافتراضية)
export async function deleteJEEntry(entryNo, opts) {
  const group = (opts && opts.group) || jeMgrState.grouped[entryNo];
  if (!group) return;
  const isManual = group.isManual !== undefined ? group.isManual : (group.ref_table === 'manual' || !group.ref_table);

  // ✅ منع حذف قيد يدوي مُرحَّل نهائياً — يُفقد الأثر المحاسبي والتدقيق بلا رجعة.
  // التوجيه لـ"🔄 عكس" بدلاً منه (يحافظ على القيد الأصلي ويضيف قيداً عكسياً صحيحاً).
  // لو أُضيفت لاحقاً حالة draft حقيقية للقيد اليدوي (راجع البند 1.5 المؤجَّل)، الحذف
  // يبقى متاحاً طالما لم يُرحَّل بعد — isPosted تتعامل مع post_status=null كمُرحَّل (بيانات قديمة)
  if (isManual && isPosted(group.lines[0] || {})) {
    toast('⚠️ لا يمكن حذف قيد يدوي مُرحَّل نهائياً — استخدم "🔄 عكس" من القائمة بدلاً منه', 'warn');
    return;
  }

  // ✅ منع حذف قيد تلقائي مرتبط بسجل تشغيلي لسه فعّال (posted) لأربعة الأنواع
  // اللي بيديرها محرك الإلغاء (payments/expenses/collections/partner_payouts).
  // لو حذفنا القيد وسبنا السجل فعّال، لاحقاً أي محاولة "إلغاء" للسجل هتفشل تلاقي
  // القيد الأصلي، وبعض الأنواع (زي expense) بترجع لحساب افتراضي بصمت وتعمل
  // قيد عكسي يتيم بلا نظير — فرق حقيقي دايم في ميزان المراجعة (حصل فعلياً على
  // ملف BOX-138 يوم 2026-07-25). الحل: لو السجل لسه posted، امنعي ووجّهي لـ"إلغاء".
  const reversibleTableMap = { payments:'payment', expenses:'expense', collections:'collection', partner_payouts:'payout' };
  const srcTable = reversibleTableMap[group.ref_table] ? group.ref_table : null;
  if (srcTable) {
    const refId = group.lines[0]?.ref_id;
    if (refId) {
      try {
        const srcRows = await apiGet(srcTable, { select:'post_status', id:`eq.${refId}` });
        const src = srcRows?.[0];
        if (src && src.post_status === 'posted') {
          toast(`⚠️ العملية الأصلية (${group.ref_table}) لسه فعّالة ولم تُلغَ — حذف القيد مباشرة هيسيب السجل بلا أثر محاسبي ويكسر أي إلغاء لاحق. استخدمي "إلغاء" من شاشة العملية بدلاً من حذف القيد.`, 'warn');
          return;
        }
      } catch(e) { console.warn('deleteJEEntry: فشل التحقق من حالة السجل الأصلي:', e.message); }
    }
  }

  const warnTxt  = isManual
    ? `هل تريد حذف القيد اليدوي "${entryNo}" نهائياً؟\nهذا الإجراء لا يمكن التراجع عنه.`
    : `⚠️ تحذير: هذا قيد تلقائي مرتبط بعملية "${group.ref_table||'غير محدد'}".\n\nحذف القيد لن يحذف العملية الأصلية، لكنه سيؤثر على ميزان المراجعة ودفتر الأستاذ.\n\nهل أنت متأكد من الحذف؟`;

  showConfirm(`حذف القيد ${entryNo}`, warnTxt, async () => {
    try {
      const delRes = await fetch(
        `${SB_URL}/rest/v1/journal_entries?entry_no=eq.${encodeURIComponent(entryNo)}&system_type=eq.${encodeURIComponent(state.system)}`,
        { method:'DELETE', headers: headers() }
      );
      if (!delRes.ok && delRes.status !== 404) throw new Error('فشل الحذف: '+await delRes.text());
      await logAudit('DELETE','journal_entries', group.file_no||null, { entry_no:entryNo, desc:group.desc, totalDr:group.totalDr }, null);
      toast(`✅ تم حذف القيد ${entryNo}`,'ok');
      if (opts && typeof opts.onDeleted === 'function') await opts.onDeleted();
      else await loadJEManager();
    } catch(e) { toast('خطأ: '+e.message,'err'); }
  });
}

// ════════════════════════════════════════════════════════
// HISTORICAL DATA MIGRATION — ترحيل البيانات التاريخية
// ════════════════════════════════════════════════════════

export function openMigrationModal() {
  const inp = el('mig-confirm-input');
  if (inp) inp.value = '';
  if (el('mig-pre-run'))  el('mig-pre-run').style.display  = 'block';
  if (el('mig-progress')) el('mig-progress').style.display = 'none';
  if (el('mig-footer'))   el('mig-footer').style.display   = 'flex';
  if (el('mig-pre-error')) el('mig-pre-error').style.display = 'none';
  if (el('mig-system-label')) el('mig-system-label').textContent = state.system;
  if (el('mig-close-btn'))    el('mig-close-btn').style.display = 'inline-flex';
  openModal('migrationModal');
}

export function _migLog(msg, type='info') {
  const log = el('mig-log');
  if (!log) return;
  const color = type==='ok'?'var(--green)':type==='err'?'var(--red)':type==='warn'?'var(--accent)':'var(--text2)';
  log.innerHTML += `<div style="color:${color}">${msg}</div>`;
  log.scrollTop = log.scrollHeight;
}

export function _migProgress(pct, label) {
  if (el('mig-progress-bar'))  el('mig-progress-bar').style.width = pct + '%';
  if (el('mig-step-label'))    el('mig-step-label').textContent   = label;
}

export async function runMigration() {
  const confirm = el('mig-confirm-input')?.value?.trim();
  if (confirm !== 'MIGRATE') {
    if (el('mig-pre-error')) { el('mig-pre-error').style.display='block'; el('mig-pre-error').textContent='اكتب MIGRATE بالأحرف الكبيرة للتأكيد'; }
    return;
  }
  // Switch UI
  if (el('mig-pre-run'))    el('mig-pre-run').style.display    = 'none';
  if (el('mig-progress'))   el('mig-progress').style.display   = 'block';
  if (el('mig-footer'))     el('mig-footer').style.display     = 'none';
  if (el('mig-close-btn'))  el('mig-close-btn').style.display  = 'none';
  if (el('mig-status-text')) el('mig-status-text').textContent = '⚡ جاري الترحيل — لا تغلق النافذة...';
  if (el('mig-log')) el('mig-log').innerHTML = '';

  const sys = state.system;
  let created = 0, skipped = 0, errors = 0;
  let firstError = null; // لتسجيل أول خطأ للتشخيص

  try {
    // ── PRE-FLIGHT: تحقق من صلاحية الكتابة قبل البدء ──
    _migProgress(2, 'فحص الصلاحيات...');
    const testRow = {
      system_type: sys, entry_no: '__TEST__', entry_date: today(),
      account_code: '9999', account_name: 'اختبار', dr_amount: 0, cr_amount: 0,
      description: 'اختبار ترحيل', ref_table: '__test__', post_status: 'draft',
    };
    const testRes = await fetch(`${SB_URL}/rest/v1/journal_entries`, {
      method: 'POST',
      headers: { ...headers(), 'Prefer': 'return=minimal' },
      body: JSON.stringify(testRow),
    });
    if (!testRes.ok) {
      const errBody = await testRes.text().catch(() => testRes.statusText);
      const hint = testRes.status === 403
        ? 'خطأ صلاحيات (403) — تحقق من RLS policies في Supabase'
        : testRes.status === 401
        ? 'انتهت الجلسة — سجّل خروج ودخول مجدداً'
        : `خطأ ${testRes.status}`;
      throw new Error(`فشل اختبار الصلاحيات: ${hint}\nالتفاصيل: ${errBody.slice(0,200)}`);
    }
    // احذف سطر الاختبار
    await fetch(
      `${SB_URL}/rest/v1/journal_entries?entry_no=eq.__TEST__&system_type=eq.${encodeURIComponent(sys)}`,
      { method: 'DELETE', headers: headers() }
    );
    _migLog('✅ الصلاحيات سليمة — بدء الترحيل', 'ok');

    // ── الخطوة 1: حذف كل القيود التلقائية ──
    _migProgress(5, 'الخطوة 1/8: حذف القيود التلقائية القديمة...');
    _migLog(`🗑 حذف القيود التلقائية لنظام ${sys}...`);

    // حذف القيود التلقائية (ref_table موجود وليس manual)
    const delRes = await fetch(
      `${SB_URL}/rest/v1/journal_entries?system_type=eq.${encodeURIComponent(sys)}&ref_table=neq.manual&ref_table=not.is.null`,
      { method:'DELETE', headers: headers() }
    );
    if (!delRes.ok && delRes.status !== 404) {
      const delErr = await delRes.text().catch(() => delRes.statusText);
      throw new Error(`فشل حذف القيود القديمة (${delRes.status}): ${delErr.slice(0,200)}`);
    }

    // حذف القيود بدون ref_table (قديمة جداً — ما عدا اليدوية)
    const delRes2 = await fetch(
      `${SB_URL}/rest/v1/journal_entries?system_type=eq.${encodeURIComponent(sys)}&ref_table=is.null&entry_no=not.like.MAN*`,
      { method:'DELETE', headers: headers() }
    );
    if (!delRes2.ok && delRes2.status !== 404) {
      const del2Err = await delRes2.text().catch(() => delRes2.statusText);
      _migLog(`⚠️ حذف القيود القديمة (بدون ref_table): ${delRes2.status} — ${del2Err.slice(0,100)}`, 'warn');
    } else {
      _migLog('✅ تم مسح القيود التلقائية القديمة', 'ok');
    }

    // جلب كل البيانات
    _migProgress(10, 'الخطوة 2/8: جلب بيانات الصفقات...');
    const [deals, payments, expenses, sales, collections, payouts, opexItems] = await Promise.all([
      apiGetAll('purchase_orders',   { select:'*', system_type:`eq.${sys}` }),
      apiGetAll('payments',          { select:'*', system_type:`eq.${sys}` }),
      apiGetAll('expenses',          { select:'*', system_type:`eq.${sys}` }),
      apiGetAll('sales',             { select:'*', system_type:`eq.${sys}` }),
      apiGetAll('collections',       { select:'*', system_type:`eq.${sys}` }),
      apiGetAll('partner_payouts',   { select:'*', system_type:`eq.${sys}` }),
      apiGetAll('operating_expenses',{ select:'*', system_type:`eq.${sys}` }),
    ]);

    const total = (deals?.length||0)+(payments?.length||0)+(expenses?.length||0)+
                  (sales?.length||0)+(collections?.length||0)+(payouts?.length||0)+(opexItems?.length||0);
    _migLog(`📊 إجمالي السجلات: ${total} سجل`);
    let done = 0;
    const tick = () => { done++; _migProgress(10+Math.round(done/total*85), `${done}/${total} سجل`); };

    // مساعد ترحيل آمن مع تسجيل أول خطأ
    const safe = async (label, fn) => {
      try { await fn(); created++; tick(); }
      catch(e) {
        errors++;
        tick();
        _migLog(`⚠️ ${label}: ${e.message}`, 'warn');
        if (!firstError) firstError = `${label}: ${e.message}`;
      }
    };

    // ── الخطوة 3: صفقات الشراء ──
    _migProgress(12, 'الخطوة 3/8: قيود الشراء...');
    _migLog(`📋 ${(deals||[]).filter(isPosted).length} صفقة شراء...`);
    for (const d of (deals||[]).filter(isPosted)) {
      if (!d.total_purchase||!+d.total_purchase) { skipped++; tick(); continue; }
      await safe(`شراء ${d.file_no}`, () => je_purchase({ sys, date:d.po_date||today(), amount:+d.total_purchase, fileNo:d.file_no, supplier:d.supplier||'', refId:d.id||null }));
    }

    // ── الخطوة 4: الدفعات ──
    _migProgress(24, 'الخطوة 4/8: قيود الدفعات...');
    _migLog(`💳 ${(payments||[]).filter(isPosted).length} دفعة مورد...`);
    for (const p of (payments||[]).filter(isPosted)) {
      if (!p.amount||!+p.amount) { skipped++; tick(); continue; }
      await safe(`دفعة ${p.pay_id||p.id}`, () => je_payment({ sys, date:p.pay_date||today(), amount:+p.amount, fileNo:p.file_no,refId:p.id||null, supplierName:p.supplier||'', payerName:p.payer||'', method:p.pay_method||'تحويل بنكي' }));
    }

    // ── الخطوة 5: المبيعات ──
    _migProgress(38, 'الخطوة 5/8: قيود المبيعات...');
    // ── بناء خرائط التكلفة الكاملة لكل ملف ──
    const _allVehicles = await apiGetAll('vehicles', { select:'id,file_no', system_type:`eq.${sys}` });
    const _vehCountByFile = {};
    (_allVehicles||[]).forEach(v => { if (v.file_no) _vehCountByFile[v.file_no] = (_vehCountByFile[v.file_no]||0) + 1; });

    const _poCostByFile = {};
    (deals||[]).forEach(d => { if (d.file_no) _poCostByFile[d.file_no] = +d.total_purchase || 0; });

    const _expCostByFile = {};
    (expenses||[]).filter(isPosted).forEach(e => {
      if (e.file_no) _expCostByFile[e.file_no] = (_expCostByFile[e.file_no]||0) + (+e.amount||0);
    });

    // التكلفة الكاملة لكل ملف = شراء + مصاريف
    const _fullCostByFile = {};
    [...new Set([...Object.keys(_poCostByFile), ...Object.keys(_expCostByFile)])].forEach(fn => {
      _fullCostByFile[fn] = (_poCostByFile[fn]||0) + (_expCostByFile[fn]||0);
    });

    // ── تجميع الفواتير مرتبةً زمنياً ──
    // المنطق: السيارة المباعة تُقفل تكلفتها، والمصاريف اللاحقة تُحمَّل على الباقين فقط
    // → نعالج الفواتير بالترتيب الزمني ونتتبع لكل ملف: (alreadySold, alreadyCOGS)
    const salesByInv = {};
    (sales||[]).filter(isPosted).forEach(s => {
      const k = `${s.file_no}__${s.inv_no||s.id}`;
      if (!salesByInv[k]) salesByInv[k] = { ...s, total:0, soldCount:0 };
      salesByInv[k].total     += +s.sale_price||0;
      salesByInv[k].soldCount += 1;
    });
    // رتّب زمنياً بالتاريخ ثم بالـ id
    const sortedInvs = Object.values(salesByInv).sort((a,b) =>
      (a.sale_date||'').localeCompare(b.sale_date||'') || String(a.id).localeCompare(String(b.id))
    );

    // حالة متراكمة لكل ملف خلال المعالجة
    const _fileState = {}; // { [fileNo]: { alreadySold, alreadyCOGS } }
    for (const s of sortedInvs) {
      const fn = s.file_no;
      if (!_fileState[fn]) _fileState[fn] = { alreadySold:0, alreadyCOGS:0 };
      const st        = _fileState[fn];
      const totalVeh  = _vehCountByFile[fn] || 1;
      const fullCost  = _fullCostByFile[fn] || 0;
      const remVeh    = Math.max(totalVeh - st.alreadySold, s.soldCount);
      const remCost   = Math.max(fullCost  - st.alreadyCOGS, 0);
      const cogs      = remVeh > 0 ? Math.round((remCost / remVeh) * s.soldCount * 100) / 100 : 0;
      s.cogs          = cogs;
      st.alreadySold += s.soldCount;
      st.alreadyCOGS += cogs;
    }
    _migLog(`🤝 ${sortedInvs.length} فاتورة بيع...`);
    for (const s of sortedInvs) {
      if (!s.total) { skipped++; done++; continue; }
      await safe(`بيع ${s.inv_no||s.id}`, () => je_sale({ sys, date:s.sale_date||today(), amount:s.total, cost:s.cogs, fileNo:s.file_no, customer:s.customer||'', invNo:s.inv_no||'' }));
    }

    // ── الخطوة 6: التحصيلات ──
    _migProgress(54, 'الخطوة 6/8: قيود التحصيلات المدفوعة...');
    const paidCols = (collections||[]).filter(c => isPosted(c) && c.paid_date);
    _migLog(`💰 ${paidCols.length} تحصيل مدفوع...`);
    for (const c of paidCols) {
      if (!c.amount||!+c.amount) { skipped++; tick(); continue; }
      await safe(`تحصيل ${c.ref_no||c.id}`, () => je_collection({ sys, date:c.paid_date, amount:+c.amount, fileNo:c.file_no,refId:c.id||null, customer:c.customer||'', invNo:c.inv_no||'', method:c.pay_method||'تحويل بنكي' }));
    }
    const pendingCount = (collections||[]).filter(c=>isPosted(c)&&!c.paid_date).length;
    if (pendingCount>0) _migLog(`ℹ️ ${pendingCount} تحصيل منتظر — سيُضاف قيده عند الدفع`, 'warn');

    // ── الخطوة 7: المصاريف ──
    _migProgress(68, 'الخطوة 7/8: قيود المصاريف...');
    _migLog(`💸 ${(expenses||[]).filter(isPosted).length} مصروف + ${(payouts||[]).filter(isPosted).length} صرف شريك...`);
    for (const e of (expenses||[]).filter(isPosted)) {
      if (!e.amount||!+e.amount) { skipped++; tick(); continue; }
      await safe(`مصروف ${e.ref_no||e.id}`, () => je_expense({ sys, date:e.exp_date||today(), amount:+e.amount, fileNo:e.file_no,refId:e.id||null, desc:e.description||e.category||'مصروف', expType:e.exp_type||e.category||'أخرى', method:e.pay_method||'نقد' }));
    }
    for (const p of (payouts||[]).filter(isPosted)) {
      if (!p.amount||!+p.amount) { skipped++; tick(); continue; }
      await safe(`صرف ${p.pay_id||p.id}`, () => je_payout({ sys, date:p.pay_date||today(), amount:+p.amount, fileNo:p.file_no,refId:p.id||null, partner:p.partner||'', method:p.pay_method||'نقد' }));
    }

    // ── الخطوة 8: المصاريف التشغيلية ──
    _migProgress(84, 'الخطوة 8/8: قيود المصاريف التشغيلية...');
    _migLog(`💼 ${(opexItems||[]).length} مصروف تشغيلي...`);
    for (const o of (opexItems||[])) {
      if (!o.amount||!+o.amount) { skipped++; tick(); continue; }
      await safe(`OPEX ${o.ref_no||o.id}`, () => je_opex({ sys, date:o.exp_date||today(), amount:+o.amount, expType:o.exp_type||'أخرى', desc:o.description||'', method:o.pay_method||'نقد', refNo:o.ref_no||null }));
    }

    // ── النتيجة النهائية ──
    _migProgress(100, errors === 0 ? 'اكتمل الترحيل ✅' : `اكتمل مع ${errors} خطأ ⚠️`);
    if (el('mig-status-text')) el('mig-status-text').textContent = errors === 0
      ? `✅ اكتمل الترحيل — ${created} قيد جديد`
      : `⚠️ اكتمل مع أخطاء — ${created} نجح / ${errors} فشل`;
    _migLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    _migLog(`✅ تم إنشاء: ${created} قيد`, 'ok');
    if (skipped>0) _migLog(`⏭ تجاهل:    ${skipped} (مبلغ صفر)`, 'warn');
    if (errors>0)  {
      _migLog(`❌ أخطاء:    ${errors}`, 'err');
      if (firstError) _migLog(`أول خطأ: ${firstError}`, 'err');
    }
    _migLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    if (created > 0) _migLog(`📊 اذهب إلى: دفتر القيود أو ميزان المراجعة للتحقق`, 'ok');
    else             _migLog(`⚠️ لم يُنشأ أي قيد — راجع رسائل الخطأ أعلاه`, 'err');

    // زر إغلاق + تحديث
    if (el('mig-footer')) el('mig-footer').innerHTML =
      `<button class="btn btn-primary" onclick="closeModal('migrationModal');loadJEManager();invalidateCache()">✅ إغلاق وتحديث</button>`;
    if (el('mig-footer')) el('mig-footer').style.display = 'flex';
    if (el('mig-close-btn')) el('mig-close-btn').style.display = 'inline-flex';
    invalidateCache();
    await logAudit('MIGRATION','journal_entries',null,null,{ sys, created, skipped, errors, total });

  } catch(e) {
    _migProgress(100, '❌ حدث خطأ أثناء الترحيل');
    _migLog(`❌ خطأ: ${e.message}`, 'err');
    if (el('mig-status-text')) el('mig-status-text').textContent = '❌ توقف الترحيل بسبب خطأ';
    if (el('mig-footer')) el('mig-footer').innerHTML =
      `<button class="btn btn-secondary" onclick="closeModal('migrationModal')">إغلاق</button>
       <button class="btn btn-primary" onclick="runMigration()">🔄 إعادة المحاولة</button>`;
    if (el('mig-footer')) el('mig-footer').style.display = 'flex';
    console.error('Migration error:', e);
  }
}

// ════════════════════════════════════════════════════════
// WAREHOUSES MODULE — المخازن والتحويلات المخزنية
// ════════════════════════════════════════════════════════

const whState = {
  warehouses:    [],   // قائمة المخازن (أسماء فريدة)
  transfers:     [],   // كل التحويلات
  allTransfers:  [],   // نسخة كاملة للفلترة
  locationFilter:'',   // '' = الجميع
  statusFilter:  'all',// all | stock | sold
  searchQuery:   '',
};

// ── العرض الرئيسي ──
export function showWarehouses() {
  hideAllViews();
  el('warehousesView').style.display = 'block';
  el('topBarTitle').textContent      = '🏪 المخازن';
  el('topBarSub').textContent        = `نظام ${state.system}`;
  navActive('nav-warehouses');
  sessionStorage.setItem('tm_last_view','warehouses');
  loadWarehouses();
}


// فلتر المخزن — ديناميكي بالاسم الحقيقي
export function filterWhByLocation(loc) {
  document.querySelectorAll('[id^="whf-"]').forEach(b => b.classList.remove('active'));
  el('whf-' + loc)?.classList.add('active');
  whState.locationFilter = loc === 'all' ? '' : loc;
  const transfers = whState.locationFilter
    ? (whState.allTransfers||[]).filter(t => t.location_name === whState.locationFilter)
    : whState.allTransfers;
  whState.transfers = transfers;
  ensureCache().then(() => {
    const soldVins = new Set((state.allSales||[]).filter(isPosted).map(s=>s.vin).filter(Boolean));
    renderWhKpis(transfers, soldVins);
    renderWhAll();
  });
}

// فلتر الحالة (الكل / في المخزن / مباع) — يعمل فوق فلتر المخزن والبحث
export function filterWhByStatus(status) {
  whState.statusFilter = status;
  ['all','stock','sold'].forEach(s => {
    el('whfs-'+s)?.classList.toggle('active', s === status);
  });
  renderWhAll();
}

// بحث داخل قائمة السيارات — يعمل فوق فلتر المخزن والحالة
export function filterWhSearch() {
  whState.searchQuery = el('wh-search')?.value || '';
  renderWhAll();
}
// اسم قديم محتفَظ به للتوافق
export function filterWhTransfers() { filterWhSearch(); }

// يطبّق كل الفلاتر (المخزن + الحالة + البحث) ويُعيد رسم جدول السيارات
export function renderWhAll() {
  const soldVins = new Set((state.allSales||[]).filter(isPosted).map(s=>s.vin).filter(Boolean));
  let list = whState.locationFilter
    ? (whState.allTransfers||[]).filter(t => t.location_name === whState.locationFilter)
    : (whState.allTransfers||[]);
  if (whState.statusFilter === 'stock') list = list.filter(t => !soldVins.has(t.vin));
  else if (whState.statusFilter === 'sold') list = list.filter(t => soldVins.has(t.vin));
  const q = (whState.searchQuery||'').toLowerCase().trim();
  if (q) list = list.filter(t =>
    (t.vin||'').toLowerCase().includes(q) ||
    (t.location_name||'').toLowerCase().includes(q) ||
    (t.file_no||'').toLowerCase().includes(q) ||
    (t.model||'').toLowerCase().includes(q)
  );
  renderWhTable(list, soldVins);
}

export async function loadWarehouses() {
  const sys = state.system;
  try {
    // جلب كل التحويلات
    const transfers = await apiGetAll('stock_locations', {
      select:'*', system_type:`eq.${sys}`, order:'transfer_date.desc,id.desc'
    });
    whState.transfers     = transfers || [];
    whState.allTransfers  = transfers || [];
    whState.locationFilter= '';
    whState.statusFilter  = 'all';
    whState.searchQuery   = '';
    if (el('wh-search')) el('wh-search').value = '';
    document.querySelectorAll('[id^="whfs-"]').forEach(b => b.classList.toggle('active', b.id === 'whfs-all'));

    // جلب أسماء المخازن الفريدة
    whState.warehouses = [...new Set((transfers||[]).map(t=>t.location_name).filter(Boolean))];

    // جلب المبيعات والسيارات للحالة
    await ensureCache();
    const soldVins = new Set((state.allSales||[]).filter(isPosted).map(s=>s.vin).filter(Boolean));

    renderWhKpis(transfers, soldVins);
    renderWhCards(transfers, soldVins);
  } catch(e) {
    if(el('wh-cards')) el('wh-cards').innerHTML = errHTML('خطأ: '+e.message);
  }
}

export function renderWhKpis(transfers, soldVins) {
  const total    = transfers.length;
  const sold     = transfers.filter(t => soldVins.has(t.vin)).length;
  const inStock  = total - sold;
  const whs      = new Set(transfers.map(t=>t.location_name).filter(Boolean)).size;
  if (el('wh-kpis')) el('wh-kpis').innerHTML = [
    ['🏪 المخازن',    whs,     'var(--purple)'],
    ['🚗 إجمالي محوّل', total, 'var(--blue)'],
    ['📦 في المخزن',  inStock, 'var(--accent)'],
    ['✅ مباع',       sold,    'var(--green)'],
  ].map(([l,v,c])=>`<div class="j-kpi"><div class="j-kpi-label">${l}</div><div class="j-kpi-val" style="color:${c};font-size:20px;font-weight:900">${v}</div></div>`).join('');
}

export function renderWhCards(transfers, soldVins) {
  // بناء أزرار الفلتر ديناميكياً من المخازن الموجودة
  const filterBar = el('wh-filter-bar');
  if (filterBar) {
    const names = [...new Set((whState.allTransfers||[]).map(t=>t.location_name).filter(Boolean))].sort();
    const cur = whState.locationFilter || 'all';
    // إزالة الأزرار القديمة غير الـ "الجميع"
    filterBar.querySelectorAll('[data-wh-btn]').forEach(b => b.remove());
    names.forEach(name => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm journal-period-btn' + (cur === name ? ' active' : '');
      btn.id = 'whf-' + name;
      btn.setAttribute('data-wh-btn','1');
      btn.textContent = '🏪 ' + name;
      btn.onclick = () => filterWhByLocation(name);
      filterBar.appendChild(btn);
    });
  }
  renderWhTable(transfers, soldVins);
}

export function renderWhTable(transfers, soldVins) {
  const wrap = el('wh-cards');
  if (!wrap) return;
  if (!transfers.length) {
    wrap.innerHTML = emptyHTML('🏪','لا توجد سيارات في هذا المخزن');
    return;
  }
  const rows = transfers.map(t => {
    const isSold = soldVins.has(t.vin);
    return `<tr>
      <td><span style="font-weight:700;color:var(--purple)">🏪 ${t.location_name||'—'}</span></td>
      <td class="mono text-accent" style="cursor:pointer;font-weight:700" onclick="openViewer('${t.file_no}')">${t.file_no||'—'}</td>
      <td class="mono" style="direction:ltr;font-size:13px">${t.vin||'—'}</td>
      <td>${t.model||'—'}</td>
      <td>${t.transfer_date||'—'}</td>
      <td>${t.transfer_ref||'—'}</td>
      <td><span style="font-size:12px;font-weight:700;padding:2px 8px;border-radius:10px;background:${isSold?'var(--green-dim)':'var(--accent-dim)'};color:${isSold?'var(--green)':'var(--accent)'}">${isSold?'✅ مباع':'📦 في المخزن'}</span></td>
      <td>
        <button class="btn btn-sm" onclick="openViewer('${t.file_no}')" style="padding:2px 8px;font-size:12px">📂</button>
        ${t.id ? `<button class="btn btn-sm" onclick="deleteTransfer(${t.id},'${t.vin}')" style="padding:2px 8px;font-size:12px;background:var(--red-dim);color:var(--red);border:1px solid var(--red)">🗑</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `<div style="overflow-x:auto">
    <table class="data-table">
      <thead><tr>
        <th>المخزن</th><th>الملف</th><th>VIN</th>
        <th>الموديل</th><th>تاريخ الإدخال</th><th>المستند</th><th>الحالة</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// ── إدارة المخازن ──
export async function openManageWarehousesModal() {
  await refreshWhList();
  openModal('manageWarehousesModal');
}

export async function refreshWhList() {
  const sys    = state.system;
  const data   = await apiGetAll('stock_locations', { select:'location_name', system_type:`eq.${sys}` });
  const names  = [...new Set((data||[]).map(t=>t.location_name).filter(Boolean))];
  whState.warehouses = names;
  const wrap = el('wh-list-manage');
  if (!wrap) return;
  if (!names.length) { wrap.innerHTML = `<div style="color:var(--text2);font-size:12px;text-align:center;padding:16px">لا توجد مخازن بعد</div>`; return; }
  wrap.innerHTML = names.map(n => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:6px;background:var(--card2)">
      <span style="font-weight:600">🏪 ${n}</span>
      <button class="btn btn-sm" onclick="deleteWarehouse('${n.replace(/'/g,"\\'")}',this)" style="background:var(--red-dim);color:var(--red);border:1px solid var(--red);padding:2px 8px;font-size:13px">🗑 حذف</button>
    </div>`).join('');
  // تحديث قائمة select في موديل التحويل
  refreshWhSelect();
}

export function refreshWhSelect() {
  const sel = el('st-location');
  if (!sel) return;
  sel.innerHTML = `<option value="">اختر المخزن...</option>` +
    whState.warehouses.map(n=>`<option value="${n}">${n}</option>`).join('');
}

export async function addWarehouse() {
  const name = el('new-wh-name')?.value?.trim();
  if (!name) { if(el('whManageError')){el('whManageError').style.display='block';el('whManageError').textContent='أدخل اسم المخزن';} return; }
  if (whState.warehouses.includes(name)) { if(el('whManageError')){el('whManageError').style.display='block';el('whManageError').textContent='المخزن موجود بالفعل';} return; }
  whState.warehouses.push(name);
  if (el('new-wh-name')) el('new-wh-name').value = '';
  if (el('whManageError')) el('whManageError').style.display='none';
  // حفظ المخزن في localStorage كاسم محجوز
  const key = `wh_names_${state.system}`;
  const saved = JSON.parse(localStorage.getItem(key)||'[]');
  if (!saved.includes(name)) { saved.push(name); localStorage.setItem(key, JSON.stringify(saved)); }
  refreshWhList();
  toast(`✅ تم إضافة مخزن "${name}"`,'ok');
}

export async function deleteWarehouse(name) {
  // تحقق إن مفيش سيارات في المخزن
  const inWh = whState.allTransfers.filter(t=>t.location_name===name);
  if (inWh.length>0) { toast(`⚠️ المخزن فيه ${inWh.length} سيارة — احذفها أولاً`,'warn'); return; }
  whState.warehouses = whState.warehouses.filter(n=>n!==name);
  const key = `wh_names_${state.system}`;
  const saved = JSON.parse(localStorage.getItem(key)||'[]');
  localStorage.setItem(key, JSON.stringify(saved.filter(n=>n!==name)));
  refreshWhList();
  toast(`✅ تم حذف مخزن "${name}"`,'ok');
}

// ── تحويل مخزني جديد ──
let _stSelectedVins = new Set();

export async function openNewTransferModal(prefillWh='') {
  // تحديث قائمة المخازن — دمج DB + localStorage
  const sys  = state.system;
  const key  = `wh_names_${state.system}`;
  const dbWh = whState.warehouses;
  const lsWh = JSON.parse(localStorage.getItem(key)||'[]');
  whState.warehouses = [...new Set([...dbWh,...lsWh])];
  refreshWhSelect();

  if (el('st-location') && prefillWh) el('st-location').value = prefillWh;
  if (el('st-date'))    el('st-date').value    = today();
  if (el('st-file-no')) el('st-file-no').value = '';
  if (el('st-ref'))     el('st-ref').value     = '';
  if (el('st-notes'))   el('st-notes').value   = '';
  if (el('st-vehicles-list')) el('st-vehicles-list').innerHTML = `<div style="color:var(--text2);font-size:12px;text-align:center;padding:10px">أدخل رقم الصفقة أولاً</div>`;
  if (el('stError'))    el('stError').style.display = 'none';
  _stSelectedVins = new Set();
  updateSelectedCount();
  openModal('stockTransferModal');
}

export async function loadVehiclesForTransfer(fileNo) {
  const fn = fileNo.trim().toUpperCase();
  if (fn.length < 3) return;
  const wrap = el('st-vehicles-list');
  if (!wrap) return;
  wrap.innerHTML = '<div style="text-align:center;padding:10px;font-size:12px;color:var(--text2)">جاري التحميل...</div>';
  try {
    const [vehicles, sales, existing] = await Promise.all([
      apiGetAll('vehicles',       { select:'*',          system_type:`eq.${state.system}`, file_no:`eq.${fn}` }),
      apiGetAll('sales',          { select:'vin,post_status', system_type:`eq.${state.system}`, file_no:`eq.${fn}` }),
      apiGetAll('stock_locations',{ select:'vin,location_name', system_type:`eq.${state.system}`, file_no:`eq.${fn}` }),
    ]);
    // ✅ سيارة بيعها الوحيد مُلغى (voided) لازم ترجع "متاحة" — استبعاد voided فقط
    // (نفس اتفاقية loadAvailableVehicles في modals.js). من غير الفلتر ده، سيارة
    // اتباعت ثم اتلغى بيعها كانت تفضل معطّلة "مباع" هنا للأبد
    const soldVins    = new Set((sales||[]).filter(isVisible).map(s=>s.vin).filter(Boolean));
    const transferMap = {};
    (existing||[]).forEach(t => { transferMap[t.vin] = t.location_name; });
    if (!vehicles?.length) { wrap.innerHTML = `<div style="color:var(--red);font-size:12px;text-align:center;padding:10px">لم يُعثر على سيارات في هذه الصفقة</div>`; return; }
    _stSelectedVins = new Set();
    wrap.innerHTML = (vehicles||[]).map(v => {
      const isSold     = soldVins.has(v.vin);
      const inWh       = transferMap[v.vin];
      const disabled   = isSold ? 'opacity:0.4;pointer-events:none' : '';
      const badge      = isSold
        ? `<span style="font-size:12px;color:var(--green);font-weight:700">✅ مباع</span>`
        : inWh
          ? `<span style="font-size:12px;color:var(--purple);font-weight:700">🏪 ${inWh}</span>`
          : `<span style="font-size:12px;color:var(--text2)">المخزن الرئيسي</span>`;
      return `<label style="display:flex;align-items:center;gap:8px;padding:7px 4px;cursor:pointer;border-bottom:1px solid var(--border);${disabled}">
        <input type="checkbox" value="${v.vin}" ${isSold?'disabled':''} onchange="toggleVinSelect(this)"
          style="width:16px;height:16px;accent-color:var(--purple);flex-shrink:0">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-family:monospace;direction:ltr;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v.vin||'—'}</div>
          <div style="font-size:12px;color:var(--text2)">${v.model||''} ${v.year||''} ${v.color||''}</div>
        </div>
        ${badge}
      </label>`;
    }).join('');
  } catch(e) {
    wrap.innerHTML = errHTML('خطأ: '+e.message);
  }
}

export function toggleVinSelect(chk) {
  if (chk.checked) _stSelectedVins.add(chk.value);
  else             _stSelectedVins.delete(chk.value);
  updateSelectedCount();
}

export function selectAllVehicles(select) {
  el('st-vehicles-list')?.querySelectorAll('input[type="checkbox"]:not([disabled])').forEach(c => {
    c.checked = select;
    if (select) _stSelectedVins.add(c.value);
    else        _stSelectedVins.delete(c.value);
  });
  updateSelectedCount();
}

export function updateSelectedCount() {
  if (el('st-selected-count')) el('st-selected-count').textContent = `${_stSelectedVins.size} سيارة محددة`;
}

export async function submitStockTransfer() {
  const location = el('st-location')?.value?.trim();
  const date     = el('st-date')?.value;
  const fileNo   = el('st-file-no')?.value?.trim().toUpperCase();
  const ref      = el('st-ref')?.value?.trim();
  const notes    = el('st-notes')?.value?.trim();
  if (!location) { showFieldErr('stError','اختر المخزن'); return; }
  if (!date)     { showFieldErr('stError','أدخل تاريخ التحويل'); return; }
  if (!fileNo)   { showFieldErr('stError','أدخل رقم الصفقة'); return; }
  if (_stSelectedVins.size === 0) { showFieldErr('stError','اختر سيارة واحدة على الأقل'); return; }

  const btn = document.querySelector('#stockTransferModal .btn-primary');
  if (btn) { btn.disabled=true; btn.textContent='⏳ جاري الحفظ...'; }

  try {
    // جلب بيانات السيارات المحددة
    const vehicles = await apiGetAll('vehicles', { select:'*', system_type:`eq.${state.system}`, file_no:`eq.${fileNo}` });
    const vinMap   = {};
    (vehicles||[]).forEach(v => { if(v.vin) vinMap[v.vin]=v; });

    const inserts = [..._stSelectedVins].map(vin => ({
      system_type:    state.system,
      location_name:  location,
      vin:            vin,
      file_no:        fileNo,
      model:          vinMap[vin]?.model || null,
      transfer_date:  date,
      transfer_ref:   ref || null,
      notes:          notes || null,
      transferred_by: state.user?.email || null,
    }));

    // batch insert
    const res = await fetch(`${SB_URL}/rest/v1/stock_locations`, {
      method:'POST',
      headers:{ ...headers(), 'Prefer':'return=minimal' },
      body: JSON.stringify(inserts),
    });
    if (!res.ok) throw new Error(await res.text());

    await logAudit('INSERT','stock_locations', fileNo, null, { location, vins:[..._stSelectedVins], date });
    toast(`✅ تم تحويل ${_stSelectedVins.size} سيارة إلى ${location}`,'ok');
    closeModal('stockTransferModal');
    await loadWarehouses();
    // تحديث تبويب السيارات لو مفتوح
    if (state.currentFileNo === fileNo && state.currentTab === 1) loadVehiclesTab(fileNo, state.system);
  } catch(e) {
    showFieldErr('stError','خطأ: '+e.message);
    if (btn) { btn.disabled=false; btn.textContent='🚛 تأكيد التحويل'; }
  }
}

export async function deleteTransfer(id, vin) {
  showConfirm(`حذف تحويل`, `هل تريد حذف تحويل السيارة ${vin}؟\nسيُعاد احتسابها في المخزن الرئيسي.`, async () => {
    try {
      await apiDelete('stock_locations', { id:`eq.${id}` });
      toast('✅ تم حذف التحويل','ok');
      await loadWarehouses();
    } catch(e) { toast('خطأ: '+e.message,'err'); }
  });
}

export async function exportWhCard(whName) {
  const rows = whState.allTransfers.filter(t=>t.location_name===whName);
  const soldVins = new Set((state.allSales||[]).filter(isPosted).map(s=>s.vin).filter(Boolean));
  const csvRows = rows.map(t=>[t.vin||'—',t.model||'—',t.file_no||'—',t.transfer_date||'—',t.transfer_ref||'—',soldVins.has(t.vin)?'مباع':'في المخزن',t.notes||'']);
  exportCSV(['VIN','الموديل','الملف','تاريخ التحويل','المستند','الحالة','ملاحظات'],csvRows,`مخزن_${whName}`);
}

// ── إضافة عمود المخزن في تبويب السيارات ──
const _origLoadVehiclesTab = loadVehiclesTab;
export async function loadVehiclesTab(fn, sys) {
  try {
    const [data, locations] = await Promise.all([
      apiGetAll('vehicles',       { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGetAll('stock_locations',{ select:'vin,location_name', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
    ]);
    state.currentVehicles = data || [];
    // ✅ استبعاد voided فقط — نفس اتفاقية loadAvailableVehicles/loadVehiclesForTransfer،
    // وإلا سيارة اتباعت ثم اتلغى بيعها تفضل ظاهرة "مباع" هنا للأبد
    const soldVins   = new Set((state.currentSales||[]).filter(isVisible).map(s=>s.vin).filter(Boolean));
    const locMap     = {};
    (locations||[]).forEach(t => { locMap[t.vin] = t.location_name; });

    if (!data?.length) { el('vehiclesTable').innerHTML = emptyHTML('🚗','لا توجد سيارات'); return; }

    // بيانات CSV للتصدير
    const vCsvRows = (data||[]).map((v,i) => [
      `${fn}-V${String(i+1).padStart(2,'0')}`, v.vin||'', v.vehicle_type||'', v.model||'',
      v.year||'', v.plate||'', v.color||'', v.engine_size||'',
      +v.purchase_price||0, v.license_expiry||'',
      locMap[v.vin]||'المخزن الرئيسي',
      soldVins.has(v.vin)?'مباع':'في المخزن'
    ]);

    el('vehiclesTable').innerHTML = `
      ${exportBtns(
        () => exportCSV(['الكود','VIN','النوع','الموديل','السنة','اللوحة','اللون','الحجم','سعر الشراء','انتهاء الرخصة','الموقع','الحالة'], vCsvRows, 'سيارات_'+fn),
        () => printVehiclesTab(data, fn)
      )}
      <table class="data-table" style="table-layout:fixed;width:100%">
        <colgroup>
          <col style="width:10%"><!-- الكود -->
          <col style="width:9%"> <!-- VIN -->
          <col class="hide-mobile" style="width:8%"> <!-- النوع -->
          <col style="width:10%"><!-- الموديل -->
          <col style="width:5%"> <!-- السنة -->
          <col class="hide-mobile" style="width:8%"> <!-- اللوحة -->
          <col class="hide-mobile" style="width:6%"> <!-- اللون -->
          <col class="hide-mobile" style="width:6%"> <!-- الحجم -->
          <col style="width:9%"> <!-- سعر الشراء -->
          <col class="hide-mobile" style="width:9%"> <!-- انتهاء الرخصة -->
          <col class="hide-mobile" style="width:12%"><!-- الموقع -->
          <col style="width:8%"> <!-- الحالة -->
          <col style="width:3%"> <!-- ⋮ -->
        </colgroup>
        <thead><tr>
          <th>الكود</th><th>VIN</th><th class="hide-mobile">النوع</th><th>الموديل</th>
          <th>السنة</th><th class="hide-mobile">اللوحة</th><th class="hide-mobile">اللون</th><th class="hide-mobile">الحجم</th>
          <th>سعر الشراء</th><th class="hide-mobile">انتهاء الرخصة</th><th class="hide-mobile">الموقع</th><th>الحالة</th><th></th>
        </tr></thead>
        <tbody>${(data||[]).map((v,i)=>{
          const code    = `${fn}-V${String(i+1).padStart(2,'0')}`;
          const expired = v.license_expiry && new Date(v.license_expiry) < new Date();
          const isSold  = soldVins.has(v.vin);
          const loc     = locMap[v.vin];
          const locBadge = loc
            ? `<span style="font-size:12px;font-weight:700;padding:2px 7px;border-radius:10px;background:var(--purple-dim);color:var(--purple);cursor:pointer" onclick="showWarehouses()" title="في مخزن ${loc}">🏪 ${loc}</span>`
            : `<span style="font-size:12px;color:var(--text2)">المخزن الرئيسي</span>`;
          return `<tr>
            <td style="overflow:hidden;text-overflow:ellipsis"><span class="mono text-amber" style="font-size:13px">${code}</span></td>
            <td style="overflow:hidden;text-overflow:ellipsis"><span class="mono" style="direction:ltr;font-size:13px">${v.vin||'—'}</span></td>
            <td class="hide-mobile" style="overflow:hidden;text-overflow:ellipsis">${v.vehicle_type||'—'}</td>
            <td style="overflow:hidden;text-overflow:ellipsis">${v.model||'—'}</td>
            <td style="text-align:center">${v.year||'—'}</td>
            <td class="hide-mobile" style="overflow:hidden"><span class="mono" style="direction:ltr">${v.plate||'—'}</span></td>
            <td class="hide-mobile" style="overflow:hidden;text-overflow:ellipsis">${v.color||'—'}</td>
            <td class="hide-mobile" style="text-align:center;white-space:nowrap">${v.engine_size||'—'}</td>
            <td class="mono text-blue">${fmt(v.purchase_price)}</td>
            <td class="hide-mobile ${expired?'text-red':'text-muted'}">${v.license_expiry||'—'}</td>
            <td class="hide-mobile">${locBadge}</td>
            <td><span class="badge ${isSold?'badge-closed':'badge-open'}">${isSold?'مباع':'في المخزن'}</span></td>
            <td style="text-align:center">
              <button class="btn-ctx-menu" onclick="event.stopPropagation();_ctxVehicle(this)" data-id="${v.id}" data-fn="${fn}" title="إجراءات">⋮</button>
            </td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>`;
  } catch(e) { el('vehiclesTable').innerHTML = errHTML(e.message); }
}

// ════════════════════════════════════════════════════════
// CONTACT STATEMENT — كشف حساب من القيود المحاسبية
// ════════════════════════════════════════════════════════

export const csState = { contactName:'', contactType:'', entries:[] };

// تُستدعى من قائمة جهات الاتصال أو أي مكان آخر
export async function showContactStatement(contactName, contactType) {
  // الشريك له كشف متخصص — نحوّله تلقائياً
  if (contactType === 'partner') {
    openPartnerAccountLedger(contactName);
    return;
  }
  hideAllViews();
  el('contactStatementView').style.display = 'block';
  navActive('nav-contacts');
  csState.contactName = contactName;
  csState.contactType = contactType || '';

  const typeLabel = { customer:'عميل', supplier:'مورد', partner:'شريك', custodian:'عهدة' };
  const icon      = { customer:'👤', supplier:'🏭', partner:'🤲', custodian:'🗝' };
  el('topBarTitle').textContent = `📋 كشف حساب`;
  el('topBarSub').textContent   = `${icon[contactType]||'👤'} ${contactName} · نظام ${state.system}`;
  el('cs-title').textContent    = `📋 كشف حساب — ${contactName}`;
  el('cs-sub').textContent      = `${typeLabel[contactType]||''} · نظام ${state.system} · من القيود المحاسبية`;

  await loadContactStatement();
}

export async function loadContactStatement() {
  const wrap = el('cs-table');
  if (!wrap) return;
  wrap.innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري تحميل كشف الحساب...</div>';
  if (el('cs-kpis')) el('cs-kpis').innerHTML = '';

  const sys  = state.system;
  const name = csState.contactName;
  if (!name) return;

  try {
    // جلب كل القيود التي تحمل contact_name = اسم الطرف
    const url = `${SB_URL}/rest/v1/journal_entries?system_type=eq.${encodeURIComponent(sys)}&contact_name=eq.${encodeURIComponent(name)}&post_status=eq.posted&order=entry_date.asc,entry_no.asc&select=*&limit=5000`;
    const res  = await fetch(url, { headers: headers() });
    if (!res.ok) throw new Error(await res.text());
    const rows = await res.json();
    csState.entries = rows || [];

    if (!rows?.length) {
      // محاولة بحث بـ account_name (للبيانات القديمة قبل الـ migration)
      const url2 = `${SB_URL}/rest/v1/journal_entries?system_type=eq.${encodeURIComponent(sys)}&account_name=like.*${encodeURIComponent(name)}*&post_status=eq.posted&order=entry_date.asc,entry_no.asc&select=*&limit=5000`;
      const res2  = await fetch(url2, { headers: headers() });
      const rows2 = res2.ok ? await res2.json() : [];
      csState.entries = rows2 || [];
      if (!rows2?.length) {
        wrap.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text2)">
          <div style="font-size:36px;margin-bottom:10px">📋</div>
          <div style="font-size:14px;font-weight:700;margin-bottom:6px">لا توجد قيود باسم "${name}"</div>
          <div style="font-size:12px">شغّل الترحيل التاريخي من دفتر القيود لتحديث البيانات</div>
          <button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="showJEManager();setTimeout(openMigrationModal,300)">⚡ ترحيل البيانات</button>
        </div>`;
        return;
      }
    }

    const entries = csState.entries;

    // حساب الأرصدة — المدين يزيد الرصيد، الدائن ينقصه
    let running = 0;
    let totalDr = 0, totalCr = 0;

    const tableRows = entries.map(r => {
      const dr = +r.dr_amount || 0;
      const cr = +r.cr_amount || 0;
      running += dr - cr;
      totalDr += dr;
      totalCr += cr;

      const srcLabels = {
        purchase_orders:'شراء', sales:'بيع', collections:'تحصيل',
        payments:'دفعة مورد', expenses:'مصروف',
        partner_payouts:'صرف شريك', operating_expenses:'مصروف تشغيلي', manual:'يدوي',
      };
      const srcColors = {
        purchase_orders:'var(--accent)', sales:'var(--green)',
        collections:'var(--blue)', payments:'var(--cyan)',
        expenses:'var(--red)', partner_payouts:'var(--purple)',
        operating_expenses:'var(--purple)', manual:'var(--text)',
      };
      const src      = r.ref_table || 'manual';
      const srcLabel = srcLabels[src] || src;
      const srcColor = srcColors[src] || 'var(--text2)';
      const balColor = running > 0 ? 'var(--green)' : running < 0 ? 'var(--red)' : 'var(--text2)';
      const balLabel = running > 0 ? 'مدين' : running < 0 ? 'دائن' : 'تسوية';

      return `<tr>
        <td class="mono text-muted" style="font-size:13px;white-space:nowrap">${(r.entry_date||'').split('T')[0]}</td>
        <td><span style="font-size:13px;font-weight:700;font-family:monospace;color:var(--accent)">${r.entry_no||'—'}</span></td>
        <td><span style="font-size:12px;font-weight:700;padding:2px 7px;border-radius:10px;background:${srcColor}22;color:${srcColor}">${srcLabel}</span></td>
        <td style="font-size:13px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${(r.description||'').replace(/"/g,'&quot;')}">${r.description||'—'}</td>
        <td class="mono text-muted" style="font-size:13px">${r.file_no||'—'}</td>
        <td class="mono text-green" style="text-align:left;font-weight:700">${dr>0?fmt(dr):'—'}</td>
        <td class="mono text-red"   style="text-align:left;font-weight:700">${cr>0?fmt(cr):'—'}</td>
        <td style="text-align:left;white-space:nowrap">
          <span class="mono" style="font-weight:900;color:${balColor}">${fmt(Math.abs(running))}</span>
          <span style="font-size:12px;color:${balColor};margin-right:4px">${balLabel}</span>
        </td>
      </tr>`;
    }).join('');

    const balance    = totalDr - totalCr;
    const balColor   = balance > 0 ? 'var(--green)' : balance < 0 ? 'var(--red)' : 'var(--text2)';
    const balLabel   = balance > 0 ? 'مدين' : balance < 0 ? 'دائن' : 'متوازن';

    // KPIs
    if (el('cs-kpis')) el('cs-kpis').innerHTML = [
      ['إجمالي مدين',   fmt(totalDr),         'var(--green)'],
      ['إجمالي دائن',   fmt(totalCr),         'var(--red)'],
      ['الرصيد الختامي', `${fmt(Math.abs(balance))}<span style="font-family:'Cairo',sans-serif;font-size:13px;font-weight:700;margin-right:4px">${balLabel}</span>`, balColor],
      ['عدد القيود',    entries.length,        'var(--blue)'],
    ].map(([l,v,c])=>`<div class="j-kpi"><div class="j-kpi-label">${l}</div><div class="j-kpi-val" style="color:${c};font-size:18px;font-weight:900">${v}</div></div>`).join('');

    wrap.innerHTML = `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
        <div style="padding:10px 16px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text2);display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px">
          <span>📋 كشف حساب: <strong style="color:var(--text)">${name}</strong> · ${entries.length} حركة</span>
          <span style="font-weight:700;color:${balColor}">الرصيد: ${fmt(Math.abs(balance))} ${balLabel}</span>
        </div>
        <div style="overflow-x:auto">
          <table class="data-table" style="min-width:700px">
            <thead><tr>
              <th>التاريخ</th><th>رقم القيد</th><th>النوع</th><th>البيان</th><th>الملف</th>
              <th style="color:var(--green);text-align:left">مدين</th>
              <th style="color:var(--red);text-align:left">دائن</th>
              <th style="text-align:left">الرصيد</th>
            </tr></thead>
            <tbody>${tableRows}</tbody>
            <tfoot style="background:var(--card2)">
              <tr>
                <td colspan="5" style="padding:10px 16px;font-weight:700">الإجمالي</td>
                <td class="mono text-green" style="padding:10px 16px;font-weight:900;text-align:left">${fmt(totalDr)}</td>
                <td class="mono text-red"   style="padding:10px 16px;font-weight:900;text-align:left">${fmt(totalCr)}</td>
                <td style="padding:10px 16px;font-weight:900;color:${balColor};text-align:left">
                  ${fmt(Math.abs(balance))} <span style="font-size:13px">${balLabel}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>`;

  } catch(e) {
    wrap.innerHTML = errHTML('خطأ: '+e.message);
    console.error(e);
  }
}

// printContactStatement → js/print.js


export function exportContactStatementCSV() {
  const rows = csState.entries.map(r => [
    (r.entry_date||'').split('T')[0], r.entry_no||'—',
    r.ref_table||'—', r.description||'—', r.file_no||'—',
    +r.dr_amount||0, +r.cr_amount||0,
  ]);
  exportCSV(['التاريخ','رقم القيد','النوع','البيان','الملف','مدين','دائن'], rows, `كشف_${csState.contactName}`);
}

// تُستدعى من صفحة جهات الاتصال عند الضغط على الطرف
// showPartnerStatement → js/accounting.js

// ════════════════════════════════════════════════════════
// IMPORT WIZARD — استيراد بيانات تاريخية من Excel
// ════════════════════════════════════════════════════════

const IMPORT_SCHEMAS = {
  deals: {
    label: 'الصفقات', table: 'purchase_orders',
    cols: [
      { key:'file_no',        label:'رقم الملف *',       req:true,  example:'BOX-001'     },
      { key:'po_date',        label:'تاريخ الصفقة *',    req:true,  example:'2024-01-15'  },
      { key:'supplier',       label:'المورد *',           req:true,  example:'شركة المعادن'},
      { key:'total_purchase', label:'إجمالي الشراء *',   req:true,  example:'100000'      },
      { key:'po_no',          label:'رقم أمر الشراء',    req:false, example:'PO-2024-001' },
      { key:'status',         label:'الحالة',            req:false, example:'OPEN'        },
      { key:'notes',          label:'ملاحظات',           req:false, example:''            },
    ],
    fixed: { post_status:'posted' },
  },
  vehicles: {
    label: 'السيارات', table: 'vehicles',
    cols: [
      { key:'file_no',        label:'رقم الملف *',       req:true,  example:'BOX-001'     },
      { key:'vin',            label:'رقم الشاصي VIN *',  req:true,  example:'1HGBH41JX'   },
      { key:'model',          label:'الموديل *',         req:true,  example:'Toyota Camry'},
      { key:'year',           label:'سنة الصنع',         req:false, example:'2022'        },
      { key:'color',          label:'اللون',             req:false, example:'أبيض'        },
      { key:'vehicle_type',   label:'نوع المركبة',       req:false, example:'سيدان'       },
      { key:'purchase_price', label:'سعر الشراء',        req:false, example:'20000'       },
      { key:'engine_size',    label:'حجم المحرك',        req:false, example:'2000'        },
      { key:'plate',          label:'رقم اللوحة',        req:false, example:''            },
    ],
    fixed: {},
  },
  payments: {
    label: 'الدفعات', table: 'payments',
    cols: [
      { key:'file_no',    label:'رقم الملف *',   req:true,  example:'BOX-001'        },
      { key:'payer',      label:'الدافع *',       req:true,  example:'الصندوق'        },
      { key:'amount',     label:'المبلغ *',       req:true,  example:'50000'          },
      { key:'pay_date',   label:'تاريخ الدفع *', req:true,  example:'2024-01-20'     },
      { key:'pay_method', label:'طريقة الدفع',   req:false, example:'تحويل بنكي'     },
      { key:'document',   label:'رقم المستند',   req:false, example:'CHQ-001'        },
      { key:'notes',      label:'ملاحظات',       req:false, example:''               },
    ],
    fixed: { post_status:'posted' },
  },
  sales: {
    label: 'المبيعات', table: 'sales',
    cols: [
      { key:'file_no',    label:'رقم الملف *',     req:true,  example:'BOX-001'        },
      { key:'inv_no',     label:'رقم الفاتورة *',  req:true,  example:'INV-BOX-001-001'},
      { key:'sale_date',  label:'تاريخ البيع *',   req:true,  example:'2024-02-10'     },
      { key:'customer',   label:'العميل *',         req:true,  example:'أحمد محمد'     },
      { key:'vin',        label:'رقم الشاصي',      req:false, example:'1HGBH41JX'      },
      { key:'model',      label:'الموديل',         req:false, example:'Toyota Camry'   },
      { key:'sale_price', label:'سعر البيع *',      req:true,  example:'25000'         },
      { key:'pay_method', label:'طريقة الدفع',     req:false, example:'آجل'            },
    ],
    fixed: { post_status:'posted' },
  },
  expenses: {
    label: 'المصاريف', table: 'expenses',
    cols: [
      { key:'file_no',     label:'رقم الملف *',    req:true,  example:'BOX-001'       },
      { key:'exp_date',    label:'تاريخ المصروف *',req:true,  example:'2024-01-25'    },
      { key:'description', label:'البيان *',        req:true,  example:'شحن ونقل'     },
      { key:'amount',      label:'المبلغ *',        req:true,  example:'500'           },
      { key:'exp_type',    label:'نوع المصروف',    req:false, example:'شحن'           },
      { key:'vendor',      label:'المورد',          req:false, example:'شركة الشحن'   },
      { key:'pay_method',  label:'طريقة الدفع',    req:false, example:'نقد'           },
    ],
    fixed: { post_status:'posted' },
  },
  collections: {
    label: 'التحصيلات', table: 'collections',
    cols: [
      { key:'file_no',    label:'رقم الملف *',       req:true,  example:'BOX-001'        },
      { key:'inv_no',     label:'رقم الفاتورة *',    req:true,  example:'INV-BOX-001-001'},
      { key:'customer',   label:'العميل *',           req:true,  example:'أحمد محمد'     },
      { key:'amount',     label:'المبلغ *',           req:true,  example:'25000'          },
      { key:'due_date',   label:'تاريخ الاستحقاق',   req:false, example:'2024-03-01'     },
      { key:'paid_date',  label:'تاريخ الدفع الفعلي',req:false, example:'2024-03-05'     },
      { key:'pay_method', label:'طريقة الدفع',       req:false, example:'تحويل بنكي'    },
    ],
    fixed: { post_status:'posted' },
  },
};

const importState = { type: null, step: 1, parsedRows: [], file: null };

export function showImportWizard() {
  hideAllViews();
  el('importWizardView').style.display = 'block';
  el('topBarTitle').textContent = '📥 استيراد بيانات';
  el('topBarSub').textContent   = `نظام ${state.system}`;
  navActive('nav-import');
  setImportStep(1);
}

export function setImportStep(n) {
  importState.step = n;
  for (let i=1; i<=4; i++) {
    const panel = el(`imp-panel-${i}`);
    if (panel) panel.style.display = i===n ? 'block' : 'none';
    const step  = el(`imp-step-${i}`);
    if (step) {
      step.classList.remove('active','done');
      if (i===n) step.classList.add('active');
      else if (i<n) step.classList.add('done');
    }
  }
}

export function selectImportType(type) {
  importState.type = type;
  const schema = IMPORT_SCHEMAS[type];
  document.querySelectorAll('.imp-type-card').forEach(c => c.classList.remove('active'));
  el(`itype-${type}`)?.classList.add('active');
  const btn = el('imp-next-1');
  if (btn) { btn.disabled=false; btn.textContent=`التالي ← Template ${schema.label}`; }

  // تحضير Step 2
  if (el('imp-template-title')) el('imp-template-title').textContent = `Template ${schema.label}`;
  if (el('imp-cols-list')) {
    el('imp-cols-list').innerHTML = schema.cols.map(c =>
      `<div style="padding:2px 0"><span style="color:${c.req?'var(--red)':'var(--text2)'};font-weight:700;font-family:monospace;margin-left:8px">${c.key}</span>
       <span>${c.label}</span>
       ${c.req?'<span style="color:var(--red);font-size:12px"> (مطلوب)</span>':''}
       <span style="color:var(--text2);font-size:12px"> — مثال: ${c.example}</span>
      </div>`
    ).join('');
  }
}

export function downloadImportTemplate() {
  const type = importState.type;
  if (!type) return;
  const schema = IMPORT_SCHEMAS[type];

  // بناء CSV template
  const headers = schema.cols.map(c => c.key).join(',');
  const example = schema.cols.map(c => `"${c.example}"`).join(',');
  const csv = '\uFEFF' + headers + '\n' + example + '\n';

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8'}));
  a.download = `template_${type}_${state.system}.csv`;
  a.click();
  toast(`✅ تم تنزيل template_${type}.csv`,'ok');
}

export function handleImportDrop(event) {
  event.preventDefault();
  el('imp-drop-zone').style.borderColor = 'var(--border)';
  const file = event.dataTransfer.files[0];
  if (file) processImportFile(file);
}

export function handleImportFile(input) {
  const file = input.files[0];
  if (file) processImportFile(file);
}

export function processImportFile(file) {
  importState.file = file;
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['xlsx','xls','csv'].includes(ext)) {
    el('imp-file-status').innerHTML = `<span style="color:var(--red)">❌ نوع الملف غير مدعوم — استخدم xlsx أو csv</span>`;
    return;
  }
  el('imp-file-status').innerHTML = `<span style="color:var(--green)">✅ ${file.name} (${(file.size/1024).toFixed(1)} KB)</span>`;
  const btn = el('imp-parse-btn');
  if (btn) btn.disabled = false;
}

export async function parseImportFile() {
  const file = importState.file;
  const type = importState.type;
  if (!file || !type) return;

  const schema = IMPORT_SCHEMAS[type];
  const btn    = el('imp-parse-btn');
  btn.disabled = true; btn.textContent = '⏳ جاري التحليل...';

  try {
    const rows = await readFileAsRows(file);
    if (!rows || rows.length < 2) throw new Error('الملف فارغ أو لا يحتوي على بيانات');

    const headerRow   = rows[0].map(h => String(h||'').trim());
    const dataRows    = rows.slice(1).filter(r => r.some(v => v !== null && v !== ''));
    const schemaKeys  = schema.cols.map(c => c.key);

    // تحقق الأعمدة المطلوبة
    const missingReq  = schema.cols.filter(c => c.req && !headerRow.includes(c.key));
    if (missingReq.length) throw new Error(`أعمدة مطلوبة غير موجودة: ${missingReq.map(c=>c.key).join(', ')}`);

    // تحويل الصفوف لـ objects
    const parsed = dataRows.map((row, i) => {
      const obj = { system_type: state.system, ...schema.fixed };
      headerRow.forEach((h, idx) => {
        if (schemaKeys.includes(h)) {
          let val = row[idx];
          if (val === null || val === undefined || val === '') val = null;
          else val = String(val).trim();
          obj[h] = val;
        }
      });
      return obj;
    });

    // تحقق الأعمدة المطلوبة في البيانات
    const errors = [];
    parsed.forEach((row, i) => {
      schema.cols.filter(c=>c.req).forEach(c => {
        if (!row[c.key]) errors.push(`سطر ${i+2}: ${c.key} فارغ`);
      });
    });

    importState.parsedRows = parsed;
    setImportStep(4);
    renderImportPreview(parsed, errors, schema);
  } catch(e) {
    el('imp-file-status').innerHTML = `<span style="color:var(--red)">❌ خطأ: ${e.message}</span>`;
  } finally {
    btn.disabled = false; btn.textContent = 'التالي ← مراجعة البيانات';
  }
}

export async function readFileAsRows(file) {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();

    if (ext === 'csv') {
      reader.onload = e => {
        const text = e.target.result;
        const rows = text.split('\n').filter(l=>l.trim()).map(line => {
          // parse CSV with quotes
          const result=[], re=/("([^"]*)"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g;
          let m;
          const simple = line.split(',');
          return simple.map(v => v.replace(/^"|"$/g,'').trim() || null);
        });
        resolve(rows);
      };
      reader.readAsText(file, 'utf-8');
    } else {
      reader.onload = e => {
        try {
          const XLSX = window.XLSX;
          if (!XLSX) { reject(new Error('مكتبة XLSX غير محملة — استخدم CSV')); return; }
          const wb   = XLSX.read(e.target.result, {type:'array'});
          const ws   = wb.Sheets[wb.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json(ws, {header:1, defval:null});
          resolve(data);
        } catch(err) { reject(err); }
      };
      reader.readAsArrayBuffer(file);
    }
    reader.onerror = reject;
  });
}

export function renderImportPreview(parsed, errors, schema) {
  const wrap = el('imp-preview-wrap');
  if (!wrap) return;

  const validRows = errors.length === 0 ? parsed : parsed.filter((_,i) => {
    return !errors.some(e => e.startsWith(`سطر ${i+2}:`));
  });

  const errHtml = errors.length ? `
    <div style="background:var(--red-dim);border:1px solid var(--red);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:12px;max-height:150px;overflow-y:auto">
      <div style="font-size:12px;font-weight:700;color:var(--red);margin-bottom:6px">⚠️ ${errors.length} خطأ في البيانات:</div>
      ${errors.slice(0,20).map(e=>`<div style="font-size:13px;color:var(--red)">${e}</div>`).join('')}
      ${errors.length>20?`<div style="font-size:13px;color:var(--text2)">... و ${errors.length-20} خطأ آخر</div>`:''}
    </div>` : '';

  const previewCols = schema.cols.slice(0,6);
  const tableRows   = parsed.slice(0,10).map(row => `<tr>${previewCols.map(c=>`<td style="padding:6px 10px;font-size:13px;border-bottom:1px solid var(--border)">${row[c.key]||'—'}</td>`).join('')}</tr>`).join('');

  wrap.innerHTML = `
    ${errHtml}
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:14px">
      <div style="font-size:13px;font-weight:700;margin-bottom:10px">
        📊 معاينة البيانات — ${parsed.length} صف
        ${errors.length?`<span style="color:var(--red);font-size:13px"> (${errors.length} سطر فيه أخطاء)</span>`:'<span style="color:var(--green);font-size:13px"> ✅ كل البيانات صحيحة</span>'}
      </div>
      <div style="overflow-x:auto;max-height:240px;overflow-y:auto;margin-bottom:12px">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:var(--card2)">${previewCols.map(c=>`<th style="padding:6px 10px;font-size:13px;text-align:right">${c.label}</th>`).join('')}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
        ${parsed.length>10?`<div style="font-size:13px;color:var(--text2);padding:6px 10px">... و ${parsed.length-10} صف آخر</div>`:''}
      </div>
    </div>

    <div style="background:var(--accent-dim);border:1px solid var(--accent);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:14px;font-size:12px">
      ⚠️ سيتم إدراج <strong>${validRows.length} صف</strong> في جدول <strong>${schema.table}</strong> لنظام <strong>${state.system}</strong>
      — العملية لا يمكن التراجع عنها بسهولة
    </div>

    <div style="display:flex;gap:8px">
      <button class="btn btn-secondary" onclick="setImportStep(3)">← رجوع</button>
      <button class="btn btn-primary" onclick="runImport()" style="background:var(--accent);border-color:var(--accent)">
        ⚡ استيراد ${validRows.length} سجل
      </button>
    </div>
    <div id="imp-run-progress" style="margin-top:12px"></div>`;
}

export async function runImport() {
  const type   = importState.type;
  const schema = IMPORT_SCHEMAS[type];
  const rows   = importState.parsedRows;
  const sys    = state.system;

  const prog  = el('imp-run-progress');
  const btn   = el('imp-preview-wrap')?.querySelector('.btn-primary');
  if (btn) { btn.disabled=true; btn.textContent='⏳ جاري الاستيراد...'; }

  let inserted=0, failed=0;
  const BATCH = 50;

  prog.innerHTML = `<div style="background:var(--card2);border-radius:var(--radius-sm);padding:10px 14px">
    <div style="height:8px;background:var(--border);border-radius:6px;overflow:hidden;margin-bottom:6px">
      <div id="imp-prog-bar" style="height:100%;background:var(--accent);border-radius:6px;transition:width .3s;width:0%"></div>
    </div>
    <div id="imp-prog-label" style="font-size:13px;color:var(--text2)">0 / ${rows.length}</div>
  </div>`;

  for (let i=0; i<rows.length; i+=BATCH) {
    const batch = rows.slice(i, i+BATCH);
    try {
      const res = await fetch(`${SB_URL}/rest/v1/${schema.table}`, {
        method: 'POST',
        headers: { ...headers(), 'Prefer':'return=minimal' },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        const err = await res.text();
        console.warn(`Batch ${i}-${i+BATCH} failed:`, err);
        failed += batch.length;
      } else {
        inserted += batch.length;
      }
    } catch(e) { failed += batch.length; }

    const pct = Math.round((i+BATCH)/rows.length*100);
    if (el('imp-prog-bar')) el('imp-prog-bar').style.width = Math.min(pct,100)+'%';
    if (el('imp-prog-label')) el('imp-prog-label').textContent = `${Math.min(i+BATCH,rows.length)} / ${rows.length} · نجح: ${inserted}${failed?` · فشل: ${failed}`:''}`;
  }

  // النتيجة
  const ok = failed===0;
  prog.innerHTML += `
    <div style="background:${ok?'var(--green-dim)':'var(--accent-dim)'};border:1px solid ${ok?'var(--green)':'var(--accent)'};border-radius:var(--radius-sm);padding:12px 14px;margin-top:10px">
      <div style="font-size:13px;font-weight:700;color:${ok?'var(--green)':'var(--accent)'}">
        ${ok?'✅ اكتمل الاستيراد بنجاح':'⚠️ اكتمل مع أخطاء'}
      </div>
      <div style="font-size:12px;margin-top:4px">
        ✅ تم إدراج: <strong>${inserted}</strong>
        ${failed?` · ❌ فشل: <strong>${failed}</strong>`:''}
      </div>
    </div>
    <div style="margin-top:10px;display:flex;gap:8px">
      <button class="btn btn-primary" onclick="runPostImportMigration()">⚡ توليد القيود المحاسبية</button>
      <button class="btn btn-secondary" onclick="selectImportType('${type}');setImportStep(3)">📥 استيراد ملف آخر</button>
      <button class="btn btn-secondary" onclick="showDashboard()">🏠 الداشبورد</button>
    </div>`;

  invalidateCache();
  await logAudit('IMPORT', schema.table, null, null, { type, inserted, failed, system:sys });
}

export async function runPostImportMigration() {
  toast('⏳ جاري توليد القيود للبيانات المستوردة...','ok');
  openMigrationModal();
  setTimeout(() => {
    if (el('mig-confirm-input')) el('mig-confirm-input').value = 'MIGRATE';
  }, 400);
}
let _pwaInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _pwaInstallPrompt = e;
  // Show all install buttons
  document.querySelectorAll('.pwa-install-btn').forEach(b => b.style.display = 'flex');
});

export function installPWA() {
  if (_pwaInstallPrompt) {
    _pwaInstallPrompt.prompt();
    _pwaInstallPrompt.userChoice.then(() => {
      _pwaInstallPrompt = null;
      document.querySelectorAll('.pwa-install-btn').forEach(b => b.style.display = 'none');
    });
  }
}

// ════════════════════════════════════════════════════════
// POSTING ENGINE v2 — Double Entry Accounting
// كل العمليات بتسجل قيودًا مزدوجة Dr/Cr في journal_entries
// ════════════════════════════════════════════════════════

// ── window bridge: تعريض الدوال للاستخدام من classic scripts وسمات onclick ──
Object.assign(window, {
  showOpex, setOpexPeriod, loadOpex, renderOpexKpis, onOpexTypeChange,
  openOpexModal, openEditOpexModal, submitOpex, submitEditOpex, deleteOpex,
  exportOpexExcel, fetchOpexForJournal, loadOpexReport, closeDrillDownMain, closeDrillDown,
  toggleDrillDown, renderDrillDown, renderDDChart, regenFileNo, regenInvNo,
  showApprovalQueue, loadApprovalQueue, _optimisticRemove, filterApproval, renderApprovalList,
  openApprovalDetail, approveFromDetail, cancelFromDetail, rejectFromDetail, openFullFileFromDetail, openEditSaleApproval,
  editFromDetail, approveItem, rejectItem, editApprovalRow, cancelApprovalRow,
  _ensureSaleJE, _createApprovalJE, _ensureApprovalJE, _approveLinkedPaidCollections, _processEditApproval,
  _processReversalApproval, approveAll, updateApprovalBadge, openPartnerAccountLedger, loadPartnerAccountLedger,
  renderPartnerAccountLedger, exportPartnerAccountPDF, openGeneralWithdrawModal, submitGeneralWithdraw, openDealNoteModal,
  submitDealNote, loadDealNotes, deleteDealNote, checkDbStructure, showReview,
  setReviewPeriod, switchReviewTab, runAllReviewChecks, renderCheckItem, renderReviewChecklist,
  updateChecklistProgress, renderSignoff, saveReviewSignoff, loadReconciliations, loadReviewHistory,
  showJEManager, setJEMgrPeriod, loadJEManager, renderJEManagerTable, showUnbalancedDetail,
  fixUnbalancedEntries, checkMissingEntries, createMissingJE, createAllMissingJE, toggleJELines,
  openNewJEModal, openEditJEModal, renderJELines, addJELine, removeJELine,
  onJEAccInput, onJEAccChange, updateJETotals, submitJE, deleteJEEntry,
  openMigrationModal, _migLog, _migProgress, runMigration, showWarehouses,
  filterWhByLocation, filterWhByStatus, filterWhSearch, filterWhTransfers, renderWhAll,
  loadWarehouses, renderWhKpis, renderWhCards, renderWhTable, openManageWarehousesModal,
  refreshWhList, refreshWhSelect, addWarehouse, deleteWarehouse, openNewTransferModal,
  loadVehiclesForTransfer, toggleVinSelect, selectAllVehicles, updateSelectedCount, submitStockTransfer,
  deleteTransfer, exportWhCard, loadVehiclesTab, showContactStatement, loadContactStatement,
  exportContactStatementCSV, showImportWizard, setImportStep, selectImportType, downloadImportTemplate,
  handleImportDrop, handleImportFile, processImportFile, parseImportFile, readFileAsRows,
  renderImportPreview, runImport, runPostImportMigration, installPWA,
  _ddState, csState,
});
