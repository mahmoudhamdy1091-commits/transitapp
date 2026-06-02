// ╔══════════════════════════════════════════════════════════╗
// ║  operations.js — OPEX · Approval Queue · Partner        ║
// ║               Account · Review · Warehouses             ║
// ║  Transit Management System — نقل حرفي، لا تعديل منطق   ║
// ╚══════════════════════════════════════════════════════════╝
    markSaving('editCollectionModal'); closeModal('editCollectionModal');
    toast('✅ تم تعديل التحصيل','ok');
    invalidateCache();
    if (state.currentTab === 5) loadCollectionsTab(state.currentFileNo, state.system);
    if (state.currentTab === 0) loadSummaryTab(state.currentFileNo, state.system);
  } catch(e) { showFieldErr('ecError','خطأ: '+e.message); }
}

// ════════════════════════════════════════
// OPERATING EXPENSES (مصاريف تشغيلية)
// ════════════════════════════════════════

const OPEX_TYPES = ['رواتب','إيجارات','عمولات','نظافة','ضيافة','مصروفات حكومية','أخرى'];
const OPEX_COLORS = {
  'رواتب':'var(--blue)', 'إيجارات':'var(--purple)', 'عمولات':'var(--accent)',
  'نظافة':'var(--cyan)', 'ضيافة':'var(--green)', 'مصروفات حكومية':'var(--red)', 'أخرى':'var(--text2)'
};

async function showOpex() {
  hideAllViews();
  el('opexView').style.display = 'block';
  el('topBarTitle').textContent = 'المصاريف التشغيلية';
  el('topBarSub').textContent   = `نظام ${state.system}`;
  if(el('opexSystemLabel')) el('opexSystemLabel').textContent = `نظام ${state.system}`;
  navActive('nav-opex');
  sessionStorage.setItem('tm_last_view','opex');
  await loadOpex();
}

async function loadOpex() {
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
            <td class="mono" style="font-size:11px;color:var(--purple);font-weight:700">${r.ref_no||'—'}</td>
            <td><span style="background:var(--purple-dim);color:var(--purple);padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap">${r.exp_type||'—'}</span></td>
            <td style="font-weight:600">${r.description||'—'}</td>
            <td style="color:var(--text2)">${r.beneficiary||'—'}</td>
            <td class="mono text-red" style="font-weight:700">${fmt(r.amount)}</td>
            <td>${r.pay_method||'—'}</td>
            <td class="mono">${r.document||'—'}</td>
            <td class="mono">${fmtDate(r.exp_date)}</td>
            <td style="color:var(--text2);font-size:12px">${r.notes||''}</td>
            <td>
              <div style="display:flex;gap:4px">
                <button class="btn btn-secondary btn-sm" onclick="openEditOpexModal(${r.id})">✏️</button>
                ${can('delete') ? `<button class="btn btn-secondary btn-sm" onclick="deleteOpex(${r.id})" style="color:var(--red)">🗑</button>` : ''}
              </div>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  } catch(e) {
    wrap.innerHTML = `<div class="alert alert-err" style="margin:16px">⚠️ خطأ: ${e.message}</div>`;
  }
}

function renderOpexKpis(data) {
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
      <div style="font-size:10px;color:var(--text2);margin-top:3px">${data.length} قيد</div>
    </div>
    ${Object.entries(byType).map(([type, amt]) => `
    <div class="vkpi" style="border-right:3px solid ${OPEX_COLORS[type]||'var(--text2)'}">
      <div class="vkpi-label">${type}</div>
      <div class="vkpi-val" style="color:${OPEX_COLORS[type]||'var(--text2)'}">${fmt(amt)}</div>
      <div style="font-size:10px;color:var(--text2);margin-top:3px">${((amt/total)*100).toFixed(0)}% من الإجمالي</div>
    </div>`).join('')}`;
}

function onOpexTypeChange() {
  const type = el('opex-type').value;
  const wrap = el('opex-other-wrap');
  if (wrap) wrap.style.display = type === 'أخرى' ? 'block' : 'none';
}

function openOpexModal() {
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

async function openEditOpexModal(id) {
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

async function submitOpex() {
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
    await apiPost('operating_expenses', payload);
    await logAudit('INSERT','operating_expenses', null, null, payload);
    // قيد محاسبي مزدوج للمصروف التشغيلي
    try {
      await je_opex({ sys:state.system, date, amount, expType:finalType, desc, method, refNo });
    } catch(jeErr) {
      toast(`⚠️ تم الحفظ لكن فشل القيد المحاسبي: ${jeErr.message}`, 'warn');
    }
    markSaving('opexModal'); closeModal('opexModal');
    invalidateCache();
    toast('✅ تم تسجيل المصروف التشغيلي','ok');
    invalidateCache();
    await loadOpex();
  } catch(e) { showFieldErr('opexError','خطأ: '+e.message); }
}

async function submitEditOpex() {
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
    await apiPatch('operating_expenses', { id:`eq.${id}` }, {
      exp_type: finalType, description: desc, amount,
      exp_date: date, pay_method: method,
      document: doc||null, beneficiary: beneficiary||null, notes: notes||null
    });
    markSaving('opexModal'); closeModal('opexModal');
    toast('✅ تم تعديل المصروف','ok');
    await loadOpex();
  } catch(e) { showFieldErr('opexError','خطأ: '+e.message); }
}

async function deleteOpex(id) {
  showConfirm('حذف مصروف تشغيلي', 'سيتم حذف هذا المصروف نهائياً. لا يمكن التراجع.', async () => {
    try {
      await apiDelete('operating_expenses', { id:`eq.${id}` });
      toast('✅ تم الحذف','ok');
      await loadOpex();
    } catch(e) { toast('خطأ: '+e.message,'err'); }
  });
}

function exportOpexExcel() {
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
async function fetchOpexForJournal(from, to, sys) {
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
async function loadOpexReport(from, to) {
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
            <td class="mono" style="font-size:11px;color:var(--purple)">${r.ref_no||'—'}</td>
            <td><span style="background:var(--purple-dim);color:var(--purple);padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700">${r.exp_type||'—'}</span></td>
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
let _ddState = { type: null, data: {} };

function closeDrillDownMain() {
  if(el('dash-details-area')) el('dash-details-area').style.display = 'none';
  _ddState.type = null;
  document.querySelectorAll('.kpi-card').forEach(c => c.classList.remove('kpi-active'));
}

function closeDrillDown() {
  if(el('dash-drilldown')) el('dash-drilldown').style.display = 'none';
  if(el('dash-details-area')) el('dash-details-area').style.display = 'none';
  document.querySelectorAll('.kpi-clickable').forEach(c => c.classList.remove('dd-active'));
  _ddState.type = null;
}


function toggleDrillDown(type) {
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

function renderDrillDown(type) {
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
        <td class="mono">${fmtDate(d2.po_date)}</td>
        <td style="text-align:center">${d2.vehicle_count||0}</td>
        <td class="mono text-blue" style="font-weight:700">${fmt(d2.total_purchase)}</td>
        <td><span class="badge badge-${statusClass(d2.status)}">${d2.status}</span></td>
      </tr>`).join('')}
      </tbody></table>` : emptyHTML('📋','لا توجد صفقات في هذه الفترة');
  }

  // ── مبيعات ──
  else if (type === 'sales') {
    (el('dd-title-main')||el('dd-title')).textContent = `💹 تفاصيل المبيعات — ${periodLabel}`;
    const sales = d.periodSales || [];
    const total = sales.reduce((s,r)=>s+(+r.sale_price||0),0);
    const byFile = {};
    sales.forEach(r => { byFile[r.file_no]=(byFile[r.file_no]||0)+(+r.sale_price||0); });
    ddKpis.style.gridTemplateColumns = 'repeat(3,1fr)';
    ddKpis.innerHTML = `
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--green)">${fmt(total)}</div><div class="dd-kpi-lbl">إجمالي المبيعات</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val">${sales.length}</div><div class="dd-kpi-lbl">عدد الفواتير</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val">${Object.keys(byFile).length}</div><div class="dd-kpi-lbl">عدد الملفات</div></div>`;
    renderDDChart(Object.entries(byFile).sort((a,b)=>b[1]-a[1]), 'var(--green)');
    ddTable.innerHTML = sales.length ? `
      <table class="data-table"><thead><tr>
        <th>التاريخ</th><th>الملف</th><th>الشاصي</th><th>العميل</th><th>سعر البيع</th>
      </tr></thead><tbody>
      ${sales.map(r=>`<tr onclick="openViewer('${r.file_no}')" style="cursor:pointer">
        <td class="mono">${fmtDate(r.sale_date)}</td>
        <td class="mono text-amber">${r.file_no||'—'}</td>
        <td class="mono" style="font-size:11px">${r.vin||'—'}</td>
        <td>${r.customer||'—'}</td>
        <td class="mono text-green" style="font-weight:700">${fmt(r.sale_price)}</td>
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
          <td><span style="background:${c.paid_date?'var(--green-dim)':isOverdue?'var(--red-dim)':'var(--accent-dim)'};color:${c.paid_date?'var(--green)':isOverdue?'var(--red)':'var(--accent)'};padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">
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
        <td><span style="background:var(--red-dim);color:var(--red);padding:2px 8px;border-radius:10px;font-size:10px">${e.exp_type||'—'}</span></td>
        <td>${e.pay_method||'—'}</td>
        <td class="mono text-red" style="font-weight:700">${fmt(e.amount)}</td>
      </tr>`).join('')}
      </tbody></table>` : emptyHTML('💸','لا توجد مصاريف في هذه الفترة');
  }

  // ── التكلفة الكاملة ──
  else if (type === 'fullcost') {
    (el('dd-title-main')||el('dd-title')).textContent = `🏷️ التكلفة الكاملة — ${periodLabel}`;
    const deals  = d.periodDeals  || [];
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
    const exps    = d.periodExp    || [];
    const totS    = sales.reduce((s,r)=>s+(+r.sale_price||0),0);
    const totPur  = deals.reduce((s,d2)=>s+(+d2.total_purchase||0),0);
    const totE    = exps.filter(e=>e.file_no).reduce((s,e)=>s+(+e.amount||0),0);
    const profit  = totS - totPur - totE;
    const margin  = totS>0?((profit/totS)*100).toFixed(1):0;
    ddKpis.style.gridTemplateColumns = 'repeat(5,1fr)';
    ddKpis.innerHTML = `
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--green)">${fmt(totS)}</div><div class="dd-kpi-lbl">المبيعات</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--blue)">${fmt(totPur)}</div><div class="dd-kpi-lbl">تكلفة الشراء</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:var(--red)">${fmt(totE)}</div><div class="dd-kpi-lbl">المصاريف</div></div>
      <div class="dd-kpi" style="background:${profit>=0?'var(--green-dim)':'var(--red-dim)'}"><div class="dd-kpi-val" style="color:${profit>=0?'var(--green)':'var(--red)'}">${fmt(profit)}</div><div class="dd-kpi-lbl">صافي الربح</div></div>
      <div class="dd-kpi"><div class="dd-kpi-val" style="color:${profit>=0?'var(--green)':'var(--red)'}">${margin}%</div><div class="dd-kpi-lbl">هامش الربح</div></div>`;
    // ربح كل صفقة
    const fileNos = [...new Set(sales.map(s=>s.file_no))];
    const fileData = fileNos.map(fn=>{
      const fs = sales.filter(s=>s.file_no===fn).reduce((s,r)=>s+(+r.sale_price||0),0);
      const fd = deals.find(d2=>d2.file_no===fn);
      const fe = exps.filter(e=>e.file_no===fn).reduce((s,e)=>s+(+e.amount||0),0);
      const fp = (+fd?.total_purchase||0)+fe;
      return {fn, sales:fs, cost:fp, profit:fs-fp};
    });
    renderDDChart(fileData.sort((a,b)=>b.profit-a.profit).map(f=>[f.fn, f.profit]), profit>=0?'var(--accent)':'var(--red)');
    ddTable.innerHTML = fileData.length ? `
      <table class="data-table"><thead><tr>
        <th>الملف</th><th>المبيعات</th><th>التكلفة الكاملة</th><th>الربح / الخسارة</th><th>الهامش</th>
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
          <td class="mono" style="font-size:11px">${v.vin||'—'}</td>
          <td class="mono">${fmt(v.purchase_price)}</td>
          <td><span style="background:${bg};color:${color};padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">${days} يوم</span></td>
          <td><span style="font-size:10px;color:${color}">${days>60?'⚠️ راكدة':days>30?'تنبه':'جيدة'}</span></td>
        </tr>`;
      }).join('')}
      </tbody></table>` : emptyHTML('🚗','المخزن فارغ');

  }
  // ── تحصيلات مستحقة من العملاء (تفصيلي) ──
  // ✅ المصدر الوحيد للحقيقة: جدول collections
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
          <td class="mono" style="font-size:11px">${r._due||'---'}</td>
          <td><span style="background:${db};color:${dc};padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">${dl}</span></td>
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
        <td class="mono" style="font-size:11px;color:var(--text2)">${c.ref_no||'—'}</td>
        <td class="mono" style="color:var(--blue)">${c.inv_no||'—'}</td>
        <td class="mono text-amber" style="font-weight:700">${c.file_no||'—'}</td>
        <td>${c.customer||'—'}</td>
        <td class="mono" style="color:${c._status==='paid'?'var(--green)':'var(--accent)'};font-weight:700">${fmt(c.amount)}</td>
        <td class="mono" style="font-size:11px">${c.due_date||'—'}</td>
        <td class="mono" style="font-size:11px;color:var(--green)">${c.paid_date||'—'}</td>
        <td><span style="background:${c._status==='paid'?'var(--green-dim)':'#fef3c7'};color:${c._status==='paid'?'var(--green)':'#92400e'};padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">
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
          <td class="mono" style="font-size:11px">${r.po_date||'---'}</td>
          <td class="mono text-blue" style="text-align:left">${fmt(r.total_purchase)}</td>
          <td class="mono text-green" style="text-align:left">${fmt(r.paid)}</td>
          <td class="mono" style="text-align:left;font-weight:900;color:var(--red)">${fmt(r.due)}</td>
          <td><div style="display:flex;align-items:center;gap:4px">
            <div style="width:40px;height:5px;background:var(--card2);border-radius:3px;overflow:hidden">
              <div style="width:${pct}%;height:100%;background:${bc};border-radius:3px"></div>
            </div>
            <span style="font-size:10px;color:${bc}">${pct}%</span>
          </div></td>
          <td><span class="badge badge-${statusClass(r.status)}">${r.status}</span></td>
        </tr>`;
      }).join('')}
      </tbody></table>` : emptyHTML('🔴','لا توجد مستحقات للموردين');
  }


  }

// ── DD mini chart ──
function renderDDChart(entries, color) {
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
    <div style="flex:1;text-align:center;font-size:9px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;padding-top:4px">${label}</div>`).join('');
}

// ── Regenerate file number ──
async function regenFileNo() {
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
async function regenInvNo() {
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
  purchase: { icon:'📋', label:'سند شراء', color:'var(--accent)', table:'purchase_orders', amountField:'total_purchase', dateField:'po_date', descFields:['file_no','supplier'] },
  sale:       { icon:'🧾', label:'بيع',         color:'var(--green)',  table:'sales',           amountField:'sale_price',   dateField:'sale_date',  descFields:['inv_no','customer','vin'] },
  expense:    { icon:'💸', label:'مصروف',       color:'var(--red)',    table:'expenses',         amountField:'amount',       dateField:'exp_date',   descFields:['description','exp_type','file_no'] },
  collection: { icon:'💰', label:'تحصيل',       color:'var(--blue)',   table:'collections',      amountField:'amount',       dateField:'paid_date',  descFields:['inv_no','customer','file_no'] },
  payment:    { icon:'💳', label:'دفعة مورد',   color:'var(--cyan)',   table:'payments',         amountField:'amount',       dateField:'pay_date',   descFields:['payer','file_no','pay_method'] },
  payout:     { icon:'👥', label:'صرف شريك',   color:'var(--purple)', table:'partner_payouts',  amountField:'amount',       dateField:'pay_date',   descFields:['partner','payout_type','file_no'] },
};

async function showApprovalQueue() {
  if (!can('roles')) { toast('🔒 هذه الصفحة للمدراء فقط','err'); return; }
  hideAllViews();
  el('approvalView').style.display = 'block';
  el('topBarTitle').textContent = 'المراجعة';
  navActive('nav-approval');
  sessionStorage.setItem('tm_last_view','approval');
  await loadApprovalQueue();
}

async function loadApprovalQueue() {
  const wrap = el('approval-list');
  setLoading('approval-list');

  try {
    const sys = state.system;

    // جيب كل البنود المعلقة من كل الجداول بالتوازي
    const [purchases, sales, expenses, collections, payments, payouts] = await Promise.all([
      apiGetAll('purchase_orders', { select:'*', system_type:`eq.${sys}`, post_status:`eq.draft`, order:'created_at.desc' }),
      apiGetAll('sales',           { select:'*', system_type:`eq.${sys}`, post_status:`eq.draft`, order:'created_at.desc' }),
      apiGetAll('expenses',        { select:'*', system_type:`eq.${sys}`, post_status:`eq.draft`, order:'created_at.desc' }),
      apiGetAll('collections',     { select:'*', system_type:`eq.${sys}`, post_status:`eq.draft`, order:'created_at.desc' }),
      apiGetAll('payments',        { select:'*', system_type:`eq.${sys}`, post_status:`eq.draft`, order:'created_at.desc' }),
      apiGetAll('partner_payouts', { select:'*', system_type:`eq.${sys}`, post_status:`eq.draft`, order:'created_at.desc' }),
    ]);

    // دمج كل البنود مع نوعها
    // جيب المستخدمين من audit_log
    const allIds = [...(purchases||[]),...(sales||[]),...(expenses||[]),...(collections||[]),...(payments||[]),...(payouts||[])].map(r=>r.id).filter(Boolean);
    let _auditUsers = {};
    try {
      const audits = []; // audit_log لا يحتوي على ref_id
      (audits||[]).forEach(a=>{ if(a.ref_id) _auditUsers[String(a.ref_id)] = (a.user_email||'').split('@')[0]; });
    } catch(e) { console.warn('approvalQueue auditUsers:', e.message); }
    approvalState.auditUsers = _auditUsers;

    approvalState.all = [
      ...(purchases||[]).map(r    => ({...r, _type:'purchase',   _amount:+r.total_purchase||0, _date:r.po_date,    _desc:`${r.file_no||'—'} · ${r.supplier||'—'} · ${r.vehicle_count||0} سيارة`, _file:r.file_no })),
      ...(sales||[]).map(r        => ({...r, _type:'sale',       _amount:+r.sale_price||0,     _date:r.sale_date,  _desc:`${r.inv_no||'—'} · ${r.customer||'—'} · ${r.vin||'—'}`,               _file:r.file_no })),
      ...(expenses||[]).map(r     => ({...r, _type:'expense',    _amount:+r.amount||0,         _date:r.exp_date||r.expense_date, _desc:`${r.description||'—'} · ${r.exp_type||'—'} · ${r.file_no||'—'}`, _file:r.file_no })),
      ...(collections||[]).map(r  => ({...r, _type:'collection', _amount:+r.amount||0,         _date:r.paid_date||r.due_date,    _desc:`${r.inv_no||'—'} · ${r.customer||'—'} · ${r.file_no||'—'}`,      _file:r.file_no })),
      ...(payments||[]).map(r     => ({...r, _type:'payment',    _amount:+r.amount||0,         _date:r.pay_date,   _desc:`${r.payer||'—'} · ${r.file_no||'—'} · ${r.pay_method||'—'}`,          _file:r.file_no })),
      ...(payouts||[]).map(r      => ({...r, _type:'payout',     _amount:+r.amount||0,         _date:r.pay_date,   _desc:`${r.partner||'—'} · ${r.payout_type||'—'} · ${r.file_no||'—'}`,       _file:r.file_no })),
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
    const cntAll = el('af-count-all');
    if (cntAll) cntAll.textContent = total || '';

    // زر موافقة على الكل
    if (el('approve-all-btn')) el('approve-all-btn').style.display = total ? '' : 'none';

    filterApproval(approvalState.currentType);

  } catch(e) {
    wrap.innerHTML = `<div class="alert alert-err">خطأ: ${e.message}</div>`;
  }
}

function filterApproval(type) {
  approvalState.currentType = type;
  document.querySelectorAll('.approval-filter-btn').forEach(b => b.classList.remove('active'));
  el('af-' + type)?.classList.add('active');

  approvalState.filtered = type === 'all'
    ? approvalState.all.filter(r => r.post_status !== 'cancelled')
    : approvalState.all.filter(r => r._type === type && r.post_status !== 'cancelled');

  renderApprovalList();
}

function renderApprovalList() {
  const wrap = el('approval-list');
  const items = approvalState.filtered;

  if (!items.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="e-icon">✅</div><p>لا توجد عمليات معلقة</p><small>كل العمليات تمت الموافقة عليها</small></div>`;
    return;
  }

  wrap.innerHTML = items.map(r => {
    const cfg = APPROVAL_CONFIG[r._type];
    return `
    <div class="approval-row" onclick="openApprovalDetail('${r._type}','${r.id}')">
      <div class="approval-row-icon" style="background:${cfg.color}22;color:${cfg.color}">${cfg.icon}</div>
      <div class="approval-row-body">
        <div class="approval-row-title">${cfg.label} — ${r._desc}</div>
        <div class="approval-row-meta">
          ${fmtDate(r._date)}
          ${r._file ? `· <span style="color:var(--accent);font-family:monospace">${r._file}</span>` : ''}
          · <span style="color:var(--text2)">${r.ref_no||r.pay_id||r.inv_no||r.file_no||'—'}</span>
          ${approvalState.auditUsers?.[String(r.id)] ? `· <span style="color:var(--blue);font-size:10px;font-weight:600">👤 ${approvalState.auditUsers[String(r.id)]}</span>` : ''}
        </div>
      </div>
      <div class="approval-row-amount" style="color:${cfg.color}">${fmt(r._amount)}</div>
      <div class="approval-row-actions" onclick="event.stopPropagation()" style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">
        <button class="btn btn-sm" onclick="approveItem('${r._type}','${r.id}')"
          style="background:var(--green-dim);border:1px solid var(--green);color:var(--green);padding:4px 8px" title="موافقة">✓</button>
        <button class="btn btn-sm" onclick="editApprovalRow('${r._type}','${r.id}')"
          style="background:var(--card2);border:1px solid var(--blue);color:var(--blue);padding:4px 8px" title="تعديل">✏️</button>
        <button class="btn btn-sm" onclick="cancelApprovalRow('${r._type}','${r.id}')"
          style="background:var(--card2);border:1px solid var(--border);color:var(--text2);padding:4px 8px" title="إلغاء">⊘</button>
        <button class="btn btn-sm" onclick="rejectItem('${r._type}','${r.id}')"
          style="background:var(--red-dim);border:1px solid var(--red);color:var(--red);padding:4px 8px" title="مسح نهائي">🗑</button>
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

async function openApprovalDetail(type, id) {
  const cfg  = APPROVAL_CONFIG[type];
  const item = approvalState.all.find(r => r._type === type && String(r.id) === String(id));
  if (!item || !cfg) return;

  approvalState.currentItem = { type, id, item };

  el('ad-icon').textContent = cfg.icon;
  el('ad-icon').style.background = cfg.color + '22';
  el('ad-title').textContent = cfg.label + ' — مراجعة';

  const fields = Object.entries(item).filter(([k,v]) =>
    !SKIP_FIELDS.has(k) && v !== null && v !== undefined && v !== ''
  );

  el('ad-body').innerHTML = `
    <div style="background:${cfg.color}11;border:1px solid ${cfg.color}33;border-radius:var(--radius-sm);padding:12px 16px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:11px;color:${cfg.color};font-weight:700">${cfg.label}</div>
        <div style="font-size:12px;color:var(--text2);margin-top:2px">${item._desc}</div>
        ${approvalState.auditUsers?.[String(item.id)]?`<div style="font-size:11px;color:var(--blue);margin-top:3px">👤 أُدخل بواسطة: ${approvalState.auditUsers[String(item.id)]}</div>`:''}
        ${item._file?`<div style="font-size:11px;color:var(--accent);font-family:monospace;margin-top:2px">${item._file}</div>`:''}
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

async function approveFromDetail() {
  if (!approvalState.currentItem) return;
  const { type, id } = approvalState.currentItem;
  closeModal('approvalDetailModal');
  await approveItem(type, id);
}

async function cancelFromDetail() {
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

async function rejectFromDetail() {
  if (!approvalState.currentItem) return;
  const { type, id } = approvalState.currentItem;
  closeModal('approvalDetailModal');
  await rejectItem(type, id);
}

// ════════════════════════════════════════
// EDIT SALE FROM APPROVAL QUEUE
// ════════════════════════════════════════
async function openEditSaleApproval(saleId, fileNo, invNo) {
  if (!fileNo || !invNo) { toast('بيانات الفاتورة ناقصة', 'err'); return; }
  try {
    // جيب كل سطور الفاتورة (ممكن أكثر من سيارة)
    const allSaleItems = await apiGetAll('sales', {
      select: '*',
      system_type: `eq.${state.system}`,
      file_no: `eq.${fileNo}`,
      inv_no: `eq.${invNo}`
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

      // امسح الصف الافتراضي وحط صفوف الفاتورة الحقيقية
      el('saleVehiclesContainer').innerHTML = '';
      for (const item of allSaleItems) {
        addSaleVehicleRow();
        const rows = el('saleVehiclesContainer').querySelectorAll('tr.sale-v-row');
        const row  = rows[rows.length - 1];
        if (!row) continue;
        // حدد السيارة في الـ select بالـ VIN
        const vehicleSel = row.querySelector('[name="sv-vehicle"]');
        if (vehicleSel && item.vin) {
          Array.from(vehicleSel.options).forEach(opt => {
            if (opt.dataset?.vin === item.vin) vehicleSel.value = opt.value;
          });
          // trigger change لتحديث VIN display
          onSaleRowVehicleChange(vehicleSel);
        }
        const vinInp   = row.querySelector('[name="sv-vin"]');
        const priceInp = row.querySelector('[name="sv-price"]');
        const notesInp = row.querySelector('[name="sv-notes"]');
        if (vinInp)   vinInp.value   = item.vin || '';
        if (priceInp) priceInp.value = item.sale_price || '';
        if (notesInp) notesInp.value = item.notes || '';
      }
      updateSaleTotal();

      // Override زرار الحفظ — يمسح الـ draft القديم ويحفظ الجديد
      const submitBtn = el('saleSubmitBtn');
      submitBtn._editMode = true;
      submitBtn._editInvNo = invNo;
      submitBtn._editFileNo = fileNo;
      submitBtn.onclick = async () => {
        try {
          // امسح الـ sale records القديمة
          await apiDelete('sales', {
            system_type: `eq.${state.system}`,
            file_no:     `eq.${fileNo}`,
            inv_no:      `eq.${invNo}`
          });
          // امسح الـ collections المرتبطة (غير مدفوعة)
          try {
            await apiDelete('collections', {
              system_type: `eq.${state.system}`,
              inv_no:      `eq.${invNo}`,
              paid_date:   'is.null'
            });
          } catch(e) { console.warn('editSale delete pending collections:', e.message); }
        } catch(e) { console.warn('edit sale cleanup:', e.message); }
        // إعادة تعيين الـ onclick للأصل وبعدين submit
        submitBtn.onclick = () => submitSale();
        submitBtn._editMode = false;
        await submitSale();
      };

      toast('✏️ جاهز للتعديل — عدّل ثم اضغط حفظ', 'ok');
    }, 700);
  } catch(e) {
    toast('خطأ في فتح الفاتورة: ' + e.message, 'err');
    console.error(e);
  }
}

async function editFromDetail() {
  if (!approvalState.currentItem) return;
  const { type, id, item } = approvalState.currentItem;
  closeModal('approvalDetailModal');
  // فتح الأمر مع إمكانية التعديل
  if (type === 'purchase' && item?.file_no) {
    openNewFileModal(item.file_no);
  } else if (type === 'sale') {
    await openEditSaleApproval(id, item?.file_no, item?.inv_no || item?.invoice_no);
  } else if (type === 'payment') {
    openEditPaymentModal(id);
  } else if (type === 'expense') {
    openEditExpenseModal(id);
  } else if (type === 'collection') {
    openEditCollectionModal(id);
  } else if (type === 'payout') {
    openEditPayoutModal(id);
  } else if (item?.file_no) {
    openViewer(item.file_no);
  } else {
    toast('لا يمكن فتح هذا الأمر','err');
  }
}


async function approveItem(type, id) {
  try {
    const cfg = APPROVAL_CONFIG[type];
    if (!cfg) { toast('نوع غير معروف','err'); return; }
    await apiPatch(cfg.table, { id:`eq.${id}` }, { post_status:'posted' });
    // لو شراء — نولّد قيد محاسبي
    if (type === 'purchase') {
      const item = approvalState.all.find(r => r._type === type && String(r.id) === String(id));
      if (item && item.file_no) {
        await je_purchase({ sys:state.system, date:item.po_date||today(), amount:+item.total_purchase||0, fileNo:item.file_no, supplier:item.supplier||'' });
      }
    }
    if (type === 'sale') {
      const item = approvalState.all.find(r => r._type === type && String(r.id) === String(id));
      if (item && item.inv_no && item.file_no) {
        // تجميع كل سيارات الفاتورة — الفاتورة قد تحتوي أكثر من سيارة
        try {
          const allInvSales = await apiGetAll('sales', {
            select:'sale_price,vin,sale_date,customer,file_no,inv_no',
            system_type:`eq.${state.system}`,
            file_no:`eq.${item.file_no}`,
            inv_no:`eq.${item.inv_no}`,
          });
          const totalInvAmount = (allInvSales||[]).reduce((s,r)=>s+(+r.sale_price||0),0);
          const _vRows = await apiGetAll('vehicles', { select:'vin,purchase_price', system_type:`eq.${state.system}`, file_no:`eq.${item.file_no}` });
          const _vCost = {};
          (_vRows||[]).forEach(v => { if (v.vin) _vCost[v.vin] = +v.purchase_price||0; });
          const totalCOGS = (allInvSales||[]).reduce((s,r)=>s+(_vCost[r.vin]||0),0);
          if (totalInvAmount > 0) {
            await je_sale({ sys:state.system, date:item.sale_date||today(), amount:totalInvAmount, cost:totalCOGS, fileNo:item.file_no, customer:item.customer||'', invNo:item.inv_no||'' });
          }
        } catch(e) { console.warn('approveItem sale je_sale:', e.message); }
      }
    }
    if (type === 'collection') {
      const item = approvalState.all.find(r => r._type === type && String(r.id) === String(id));
      // القيد يُولَّد فقط إذا كان مدفوعاً فعلاً (paid_date موجود)
      if (item && item.paid_date) {
        await je_collection({ sys:state.system, date:item.paid_date, amount:+item.amount||0, fileNo:item.file_no, customer:item.customer||'', invNo:item.inv_no||'', method:item.pay_method||'تحويل بنكي' });
      }
      // لو لا يوجد paid_date → لا قيد الآن، سيُنشأ عند تسجيل الدفع لاحقاً
    }
    if (type === 'payment') {
      const item = approvalState.all.find(r => r._type === type && String(r.id) === String(id));
      if (item) await je_payment({ sys:state.system, date:item.pay_date||today(), amount:+item.amount||0, fileNo:item.file_no, supplierName:item.supplier||'', payerName:item.payer||'', method:item.pay_method||'تحويل بنكي' });
    }
    if (type === 'expense') {
      const item = approvalState.all.find(r => r._type === type && String(r.id) === String(id));
      if (item) await je_expense({ sys:state.system, date:item.exp_date||today(), amount:+item.amount||0, fileNo:item.file_no, desc:item.description||'مصروف', expType:item.exp_type||'أخرى', method:item.pay_method||'تحويل بنكي' });
    }
    if (type === 'payout') {
      const item = approvalState.all.find(r => r._type === type && String(r.id) === String(id));
      if (item) await je_payout({ sys:state.system, date:item.pay_date||today(), amount:+item.amount||0, fileNo:item.file_no, partner:item.partner||'', method:item.pay_method||'تحويل بنكي' });
    }
    invalidateCache();
    toast('✅ تمت الموافقة','ok');
    await loadApprovalQueue();
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

async function rejectItem(type, id) {
  const cfg = APPROVAL_CONFIG[type];
  if (!cfg) return;
  showConfirm('مسح نهائي', '⚠️ هل تريد مسح هذه العملية نهائياً؟ لا يمكن التراجع.', async () => {
    try {
      const item = approvalState.all.find(r => r._type === type && String(r.id) === String(id));

      if (type === 'purchase' && item?.file_no) {
        // cascade delete لأمر الشراء — امسح كل البيانات المرتبطة
        const sys = state.system;
        const fn  = item.file_no;
        const cascadeTables = ['vehicles','payments','expenses','sales','collections','partner_payouts','partners_master','journal_entries'];
        for (const t of cascadeTables) {
          try { await apiDelete(t, { system_type:`eq.${sys}`, file_no:`eq.${fn}` }); } catch(e) { console.warn(`migration delete ${t}:`, e.message); }
        }
        await apiDelete('purchase_orders', { id:`eq.${id}` });
      } else {
        await apiDelete(cfg.table, { id:`eq.${id}` });
        if (type === 'sale' && item?.inv_no) {
          try { await apiDelete('collections', { system_type:`eq.${state.system}`, inv_no:`eq.${item.inv_no}`, paid_date:'is.null' }); } catch(e) { console.warn('migration delete pending collections:', e.message); }
        }
      }

      invalidateCache();
      toast('🗑 تم المسح النهائي','ok');
      await loadApprovalQueue();
    } catch(e) { toast('خطأ: '+e.message,'err'); }
  });
}


// تعديل مباشر من صف القائمة
async function editApprovalRow(type, id) {
  approvalState.currentItem = {
    type, id,
    item: approvalState.all.find(r => r._type === type && String(r.id) === String(id))
  };
  await editFromDetail();
}

// إلغاء مباشر من صف القائمة
async function cancelApprovalRow(type, id) {
  const cfg = APPROVAL_CONFIG[type];
  if (!cfg) return;
  showConfirm('إلغاء العملية', 'سيتم وضع العملية كـ "ملغية" مع إمكانية الإرجاع لاحقاً.', async () => {
    try {
      await apiPatch(cfg.table, { id:`eq.${id}` }, { post_status:'cancelled' });
      invalidateCache();
      toast('⊘ تم إلغاء العملية','ok');
      await loadApprovalQueue();
    } catch(e) { toast('خطأ: '+e.message,'err'); }
  });
}

async function approveAll() {
  const items = approvalState.filtered;
  if (!items.length) return;
  showConfirm(`موافقة على الكل`, `هل تريد الموافقة على ${items.length} عملية دفعة واحدة؟`, async () => {
    try {
      // أولاً: رحّل كل السجلات دفعة واحدة
      await Promise.all(items.map(r => apiPatch(APPROVAL_CONFIG[r._type].table, { id:`eq.${r.id}` }, { post_status:'posted' })));
      // ثانياً: ولّد القيود المحاسبية لكل عملية (نفس منطق approveItem)
      for (const r of items) {
        try {
          if (r._type === 'purchase' && r.file_no) {
            await je_purchase({ sys:state.system, date:r.po_date||today(), amount:+r.total_purchase||0, fileNo:r.file_no, supplier:r.supplier||'' });
          } else if (r._type === 'sale' && r.inv_no && r.file_no) {
            const allInvSales = await apiGetAll('sales', { select:'sale_price,vin', system_type:`eq.${state.system}`, file_no:`eq.${r.file_no}`, inv_no:`eq.${r.inv_no}` });
            const totalAmt = (allInvSales||[]).reduce((s,x)=>s+(+x.sale_price||0),0);
            const _vRows = await apiGetAll('vehicles', { select:'vin,purchase_price', system_type:`eq.${state.system}`, file_no:`eq.${r.file_no}` });
            const _vCost = {}; (_vRows||[]).forEach(v=>{ if(v.vin) _vCost[v.vin]=+v.purchase_price||0; });
            const cogs = (allInvSales||[]).reduce((s,x)=>s+(_vCost[x.vin]||0),0);
            if (totalAmt > 0) await je_sale({ sys:state.system, date:r.sale_date||today(), amount:totalAmt, cost:cogs, fileNo:r.file_no, customer:r.customer||'', invNo:r.inv_no||'' });
          } else if (r._type === 'collection' && r.paid_date) {
            await je_collection({ sys:state.system, date:r.paid_date, amount:+r.amount||0, fileNo:r.file_no, customer:r.customer||'', invNo:r.inv_no||'', method:r.pay_method||'تحويل بنكي' });
          } else if (r._type === 'payment') {
            await je_payment({ sys:state.system, date:r.pay_date||today(), amount:+r.amount||0, fileNo:r.file_no, supplierName:r.supplier||'', payerName:r.payer||'', method:r.pay_method||'تحويل بنكي' });
          } else if (r._type === 'expense') {
            await je_expense({ sys:state.system, date:r.exp_date||today(), amount:+r.amount||0, fileNo:r.file_no, desc:r.description||'مصروف', expType:r.exp_type||'أخرى', method:r.pay_method||'نقد' });
          } else if (r._type === 'payout') {
            await je_payout({ sys:state.system, date:r.pay_date||today(), amount:+r.amount||0, fileNo:r.file_no, partner:r.partner||'', method:r.pay_method||'نقد' });
          }
        } catch(jeErr) { console.warn(`approveAll je_ failed for ${r._type} ${r.id}:`, jeErr.message); }
      }
      invalidateCache();
      toast(`✅ تمت الموافقة على ${items.length} عملية`,'ok');
      await loadApprovalQueue();
    } catch(e) { toast('خطأ: '+e.message,'err'); }
  });
}

// تحديث badge في الـ sidebar عند تحميل أي صفحة
async function updateApprovalBadge() {
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

async function openPartnerAccountLedger(partnerName) {
  partnerAccountState.partner = partnerName;
  el('pa-partner-name').textContent = partnerName;
  el('pa-ledger-table').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري التحميل...</div>';
  openModal('partnerAccountModal');
  await loadPartnerAccountLedger();
}

async function loadPartnerAccountLedger() {
  const partner = partnerAccountState.partner;
  const sys     = state.system;
  if (!partner) return;

  try {
    // جيب كل الصفقات اللي فيها الشريك
    const [allDeals, allPayouts, accountEntries] = await Promise.all([
      apiGetAll('partners_master',   { select:'file_no,share_percent', system_type:`eq.${sys}`, partner:`eq.${partner}` }),
      apiGetAll('partner_payouts',   { select:'*', system_type:`eq.${sys}`, partner:`eq.${partner}`, order:'pay_date.desc' }),
      apiGet('partner_accounts',  { select:'*', system_type:`eq.${sys}`, partner:`eq.${partner}`, order:'entry_date.desc' }),
    ]);

    // احسب الأرباح من كل الصفقات
    let totalProfits = 0;
    const dealEntries = [];
    for (const pm of (allDeals||[])) {
      try {
        const [po, sales, expenses] = await Promise.all([
          apiGetAll('purchase_orders', { select:'total_purchase', system_type:`eq.${sys}`, file_no:`eq.${pm.file_no}` }),
          apiGetAll('sales', { select:'sale_price',     system_type:`eq.${sys}`, file_no:`eq.${pm.file_no}` }),
          apiGetAll('expenses', { select:'amount',         system_type:`eq.${sys}`, file_no:`eq.${pm.file_no}` }),
        ]);
        const share      = (+pm.share_percent||0)/100;
        const totalPurch = +po?.[0]?.total_purchase||0;
        const totalSale  = (sales||[]).filter(isPosted).reduce((s,r)=>s+(+r.sale_price||0),0);
        const totalExp   = (expenses||[]).filter(isPosted).reduce((s,r)=>s+(+r.amount||0),0);
        const profit     = (totalSale - totalPurch - totalExp) * share;
        if (Math.abs(profit) > 0.001) {
          totalProfits += profit;
          dealEntries.push({
            type:'profit_credit', file_no:pm.file_no,
            amount:profit, entry_date:'—',
            description:`ربح صفقة ${pm.file_no} (${pm.share_percent}%)`,
            _sign: +1
          });
        }
      } catch(e) { console.warn('postProfitCredit:', e.message); }
    }

    // صرف على صفقات
    const dealPayouts = (allPayouts||[]).map(p => ({
      ...p,
      type:'deal_payout',
      description:`صرف ${p.payout_type||''} — ${p.file_no||'—'}`,
      _sign: -1
    }));

    // سحوبات عامة وسلف من partner_accounts
    const generalEntries = (accountEntries||[]).map(e => ({
      ...e,
      _sign: e.entry_type === 'general_withdraw' || e.entry_type === 'advance' ? -1 : +1
    }));

    // دمج كل الحركات
    const allEntries = [
      ...dealEntries,
      ...dealPayouts,
      ...generalEntries,
    ].sort((a,b) => {
      const da = a.entry_date||a.pay_date||'0';
      const db = b.entry_date||b.pay_date||'0';
      return db.localeCompare(da);
    });

    partnerAccountState.entries = allEntries;

    // KPIs
    const totalDebits  = allEntries.filter(e=>e._sign>0).reduce((s,e)=>s+(+e.amount||0),0);
    const totalCredits = allEntries.filter(e=>e._sign<0).reduce((s,e)=>s+(+e.amount||0),0);
    const balance      = totalDebits - totalCredits;

    el('pa-summary-kpis').innerHTML = `
      <div class="j-kpi" style="border-right:3px solid var(--green)">
        <div class="j-kpi-label">إجمالي الأرباح</div>
        <div class="j-kpi-val text-green">${fmt(totalProfits)}</div>
      </div>
      <div class="j-kpi" style="border-right:3px solid var(--red)">
        <div class="j-kpi-label">إجمالي السحوبات</div>
        <div class="j-kpi-val text-red">${fmt(totalCredits)}</div>
      </div>
      <div class="j-kpi" style="border-right:3px solid var(--purple);background:var(--purple-dim)">
        <div class="j-kpi-label">الرصيد المتاح</div>
        <div class="j-kpi-val" style="color:${balance>=0?'var(--green)':'var(--red)'};">${fmt(balance)}</div>
      </div>
      <div class="j-kpi" style="border-right:3px solid var(--blue)">
        <div class="j-kpi-label">عدد الصفقات</div>
        <div class="j-kpi-val text-blue">${(allDeals||[]).length}</div>
      </div>`;

    // Store balance for withdraw modal
    partnerAccountState.balance = balance;

    renderPartnerAccountLedger();
  } catch(e) {
    el('pa-ledger-table').innerHTML = `<div class="alert alert-err">خطأ: ${e.message}</div>`;
  }
}

function renderPartnerAccountLedger() {
  const filterType = el('pa-filter-type')?.value || '';
  let entries = partnerAccountState.entries;
  if (filterType) entries = entries.filter(e => (e.type||e.entry_type) === filterType);

  const typeLabels = {
    profit_credit:'أرباح مرصودة', capital_credit:'رأس مال مرصود',
    general_withdraw:'سحب عام', advance:'سلفة', deal_payout:'صرف صفقة'
  };
  const typeColors = {
    profit_credit:'var(--green)', capital_credit:'var(--blue)',
    general_withdraw:'var(--red)', advance:'var(--amber)', deal_payout:'var(--purple)'
  };

  if (!entries.length) {
    el('pa-ledger-table').innerHTML = emptyHTML('📒','لا توجد حركات');
    return;
  }

  let runningBalance = 0;
  const rows = [...entries].reverse().map(e => {
    const type   = e.type || e.entry_type;
    const sign   = e._sign || (type==='general_withdraw'||type==='advance'||type==='deal_payout' ? -1 : +1);
    const amount = +e.amount || 0;
    runningBalance += sign * amount;
    const balance = runningBalance;
    return { e, type, sign, amount, balance };
  }).reverse().map(({e, type, sign, amount, balance}) => {
    const color = typeColors[type] || 'var(--text2)';
    const date  = e.entry_date||e.pay_date||e.created_at?.split('T')[0]||'—';
    return `<tr>
      <td class="mono" style="font-size:11px;color:var(--text2)">${fmtDate(date)}</td>
      <td>
        <span style="background:${color}22;color:${color};padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">
          ${typeLabels[type]||type}
        </span>
      </td>
      <td style="font-size:12px">${e.description||'—'}</td>
      <td class="mono text-amber" style="font-size:11px">${e.file_no||'—'}</td>
      <td class="mono" style="color:${sign>0?'var(--green)':'var(--red)'};font-weight:700">
        ${sign>0?'+':'−'}${fmt(amount)}
      </td>
      <td class="mono" style="font-weight:700;color:${balance>=0?'var(--blue)':'var(--red)'}">
        ${fmt(balance)}
      </td>
      <td style="font-size:11px;color:var(--text2)">${e.document||e.notes||'—'}</td>
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
function exportPartnerAccountPDF() {
  const partnerName = el('pa-partner-name')?.textContent || '—';
  const kpisEl      = el('pa-summary-kpis');
  const tableEl     = el('pa-ledger-table');
  if (!tableEl) { toast('لا توجد بيانات للتصدير', 'warn'); return; }

  const html = `
    <div class="page">
      <div class="print-header">
        <div class="logo-area">
          <div class="company">Transit Management</div>
          <div style="font-size:12px;color:#666">نظام ${state.system}</div>
        </div>
        <div>
          <div class="doc-title">كشف حساب شريك</div>
          <div style="font-size:13px;font-weight:700;margin-top:4px">${partnerName}</div>
          <div style="font-size:11px;color:#666">تاريخ الطباعة: ${new Date().toLocaleDateString('ar-KW')}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
        ${kpisEl ? kpisEl.innerHTML : ''}
      </div>
      ${tableEl.innerHTML}
    </div>`;
  openPrintOverlay(html, `كشف حساب — ${partnerName}`);
}

function openGeneralWithdrawModal() {
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

async function submitGeneralWithdraw() {
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

// تحديث onPayoutTypeChange لإظهار رصيد الشريك عند السحب العام
// (يتم patch الدالة الموجودة بإضافة منطق السحب العام)
const _patchPayoutType = () => {
  const orig = window.onPayoutTypeChange;
  window.onPayoutTypeChange = function() {
    orig && orig();
    const type    = el('pout-type')?.value;
    const accCard = el('pout-account-card');
    if (!accCard) return;
    if (type === 'سحب عام') {
      accCard.style.display = 'block';
      loadPartnerAccountBalance();
    } else {
      accCard.style.display = 'none';
    }
  };
};
// تطبيق الـ patch بعد تحميل الصفحة
document.addEventListener('DOMContentLoaded', _patchPayoutType);

async function loadPartnerAccountBalance() {
  const partner = el('pout-partner')?.value;
  if (!partner) return;
  try {
    const [allDeals, allPayouts, accountEntries] = await Promise.all([
      apiGetAll('partners_master',  { select:'file_no,share_percent', system_type:`eq.${state.system}`, partner:`eq.${partner}` }),
      apiGetAll('partner_payouts',  { select:'amount', system_type:`eq.${state.system}`, partner:`eq.${partner}` }),
      apiGet('partner_accounts', { select:'amount,entry_type', system_type:`eq.${state.system}`, partner:`eq.${partner}` }),
    ]);

    let totalProfits = 0;
    for (const pm of (allDeals||[])) {
      try {
        const [po, sales, exp] = await Promise.all([
          apiGetAll('purchase_orders', {select:'total_purchase',system_type:`eq.${state.system}`,file_no:`eq.${pm.file_no}`}),
          apiGetAll('sales', {select:'sale_price',system_type:`eq.${state.system}`,file_no:`eq.${pm.file_no}`}),
          apiGetAll('expenses', {select:'amount',system_type:`eq.${state.system}`,file_no:`eq.${pm.file_no}`}),
        ]);
        const share = (+pm.share_percent||0)/100;
        const profit = ((sales||[]).reduce((s,r)=>s+(+r.sale_price||0),0) - (+po?.[0]?.total_purchase||0) - (exp||[]).reduce((s,e)=>s+(+e.amount||0),0)) * share;
        totalProfits += profit;
      } catch(e) { console.warn('partnerProfitCalc:', e.message); }
    }

    const totalPayouts = (allPayouts||[]).reduce((s,p)=>s+(+p.amount||0),0);
    const generalWithdrawn = (accountEntries||[]).filter(e=>e.entry_type==='general_withdraw'||e.entry_type==='advance').reduce((s,e)=>s+(+e.amount||0),0);
    const balance = totalProfits - totalPayouts - generalWithdrawn;

    if(el('pacc-profits'))   el('pacc-profits').textContent   = fmt(totalProfits);
    if(el('pacc-withdrawn')) el('pacc-withdrawn').textContent = fmt(totalPayouts + generalWithdrawn);
    if(el('pacc-balance'))   { el('pacc-balance').textContent = fmt(balance); el('pacc-balance').style.color = balance>=0?'var(--purple)':'var(--red)'; }
  } catch(e) { console.error('onPayoutPartnerChange balance:', e.message); toast('خطأ في حساب رصيد الشريك','err'); }
}

// ════════════════════════════════════════════════════════
// DEAL NOTES — ملاحظات الصفقة
// تُخزَّن في audit_log بـ action='DEAL_NOTE'
// ════════════════════════════════════════════════════════

function openDealNoteModal() {
  el('dn-text').value = '';
  el('dn-type').value = 'عام';
  el('dn-date').value = today();
  el('dnError').style.display = 'none';
  openModal('dealNoteModal');
  setTimeout(() => el('dn-text')?.focus(), 200);
}

async function submitDealNote() {
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

async function loadDealNotes() {
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
                <span style="background:${st.bg};color:${st.color};border:1px solid ${st.border};padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700">
                  ${st.icon} ${noteType}
                </span>
                ${noteDate ? `<span style="font-size:11px;color:var(--text2);font-family:monospace">📅 ${noteDate}</span>` : ''}
              </div>
              <!-- نص الملاحظة -->
              <div style="font-size:13px;line-height:1.7;color:var(--text);white-space:pre-wrap">${(n.notes||'').replace(/</g,'&lt;')}</div>
            </div>
            <!-- حذف -->
            ${can('delete') ? `
            <button onclick="deleteDealNote(${n.id})"
              style="background:var(--red-dim);border:1px solid var(--red);color:var(--red);border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;font-family:'Cairo',sans-serif;flex-shrink:0"
              title="حذف الملاحظة">🗑</button>` : ''}
          </div>
          <!-- معلومات التسجيل -->
          <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border);display:flex;align-items:center;gap:12px;font-size:11px;color:var(--text2)">
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

async function deleteDealNote(noteId) {
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

async function checkDbStructure() {
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
      <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:6px">جدول journal_entries</div>
      <div style="background:var(--card2);border-radius:6px;padding:10px 12px;font-size:12px">
        ${statusIcon(je?.exists)} موجود: ${je?.exists ? 'نعم' : 'لا — يجب إنشاؤه'}
        ${je?.exists ? `<br>${statusIcon(jeMissing.length===0)} الأعمدة المطلوبة: ${jeMissing.length===0 ? 'كلها موجودة ✓' : 'ناقص: ' + jeMissing.join(', ')}` : ''}
        ${je?.exists ? `<br>📊 عدد القيود الحالية للنظام الحالي: <strong>${jeTotal}</strong>` : ''}
      </div>
    </div>

    <div style="margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:6px">البيانات التي تحتاج قيوداً</div>
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
      <div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:6px">كل الجداول</div>
      <div style="background:var(--card2);border-radius:6px;padding:10px 12px;font-size:12px;display:grid;grid-template-columns:1fr 1fr;gap:4px">
        ${results.map(r => `${statusIcon(r.exists)} ${r.table}${r.exists ? ` (${r.cols?.length||0} عمود)` : ': غير موجود'}`).join('')}
      </div>
    </div>`;
}
// ════════════════════════════════════════════════════════
// REVIEW MODULE — مراجعة الحسابات الشاملة
// ════════════════════════════════════════════════════════

const reviewState = {
  period: 'month', from: null, to: null,
  checkResults: [], activeTab: 0,
};

function showReview() {
  hideAllViews();
  el('reviewView').style.display = 'block';
  el('topBarTitle').textContent  = '🔍 مراجعة الحسابات';
  el('topBarSub').textContent    = `نظام ${state.system}`;
  navActive('nav-review');
  sessionStorage.setItem('tm_last_view','review');
  setReviewPeriod('month');
  renderReviewChecklist();
}

function setReviewPeriod(period) {
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

function switchReviewTab(idx) {
  reviewState.activeTab = idx;
  document.querySelectorAll('.review-tab-content').forEach((c,i) => c.style.display=i===idx?'block':'none');
  document.querySelectorAll('.rv-tab-btn').forEach((t,i) => t.classList.toggle('active', i===idx));
  if (idx===2) loadReconciliations();
  if (idx===3) loadReviewHistory();
}

// ════ الفحوصات التلقائية ════
async function runAllReviewChecks() {
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
      apiGet('journal_entries', { select:'id,dr_amount,cr_amount,entry_no,file_no', system_type:`eq.${sys}`, post_status:'eq.posted' }).catch(()=>[]),
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
          <div style="font-size:11px;color:var(--text2);margin-top:2px">${from} — ${to} · نظام ${sys}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-sm" onclick="runAllReviewChecks()" style="font-size:11px">🔄 إعادة الفحص</button>
          <button class="btn btn-primary btn-sm" onclick="switchReviewTab(1)" style="font-size:11px">📋 قائمة المراجعة</button>
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
          <span style="font-size:11px">${catIcon} ${catFail>0?catFail+' فشل':''}${catWarn>0?' '+catWarn+' تحذير':''}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">${catChecks.map(renderCheckItem).join('')}</div>
      </div>`;
    }).join('');

  } catch(e) {
    if(wrap) wrap.innerHTML = errHTML('خطأ في الفحص: '+e.message);
    console.error(e);
  }
}

function renderCheckItem(c) {
  const ss = {
    pass:{ bg:'var(--green-dim)',  border:'var(--green)',  icon:'✅', lbl:'نجح' },
    warn:{ bg:'var(--accent-dim)', border:'var(--accent)', icon:'⚠️', lbl:'تحذير' },
    fail:{ bg:'var(--red-dim)',    border:'var(--red)',    icon:'❌', lbl:'فشل' },
  };
  const st = ss[c.status]||ss.pass;

  // جدول التفاصيل مع زر تنقل لكل صف
  const detailRows = c.rows?.length ? `
    <div style="margin-top:8px;overflow-x:auto;border-radius:4px;overflow:hidden">
      <table style="width:100%;border-collapse:collapse;font-size:11px;background:var(--card)">
        <tbody>${c.rows.map(r=>`<tr>
          ${r.cols.map(v=>`<td style="padding:5px 8px;border-bottom:1px solid var(--border)">${v}</td>`).join('')}
          <td style="padding:5px 8px;border-bottom:1px solid var(--border);white-space:nowrap">
            ${r.action ? `<button class="btn btn-sm" onclick="closeModal&&closeModal();${r.action}" style="font-size:10px;padding:2px 8px;background:var(--card2)">${r.actionLabel||'🔍 فتح'}</button>` : ''}
          </td>
        </tr>`).join('')}</tbody>
      </table>
    </div>` : '';

  return `<div style="background:${st.bg};border:1px solid ${st.border};border-radius:var(--radius-sm);padding:10px 14px">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="font-size:16px;flex-shrink:0">${st.icon}</span>
      <div style="flex:1;min-width:120px">
        <div style="font-size:12px;font-weight:700;color:var(--text)">${c.label}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:1px">${c.detail}</div>
      </div>
      <div style="text-align:left;flex-shrink:0">
        <div style="font-size:13px;font-weight:700;color:${st.border};font-family:var(--mono)">${c.value}</div>
        <div style="font-size:10px;color:var(--text2)">${st.lbl}</div>
      </div>
      ${c.action ? `<button class="btn btn-sm" onclick="${c.action.fn}" style="font-size:10px;padding:4px 10px;flex-shrink:0;white-space:nowrap">${c.action.label}</button>` : ''}
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

function renderReviewChecklist() {
  const wrap = el('review-checklist-wrap');
  if (!wrap) return;
  const riskColor = { high:'var(--red)', medium:'var(--accent)', low:'var(--text2)' };
  const riskLabel = { high:'مهم جداً', medium:'مهم', low:'عادي' };
  wrap.innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:12px">
      <div style="font-size:13px;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:8px">
        📋 قائمة التحقق اليدوي
        <span style="font-size:11px;font-weight:400;color:var(--text2)">— يجب إكمالها بعد الفحص التلقائي قبل إغلاق الفترة</span>
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
            <span style="font-size:10px;color:var(--text2)">${item.cat}</span>
            <span style="font-size:10px;font-weight:700;color:${riskColor[item.risk]}">${riskLabel[item.risk]}</span>
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

function updateChecklistProgress() {
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

function renderSignoff() {
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
      <div style="background:var(--accent-dim);border:1px solid var(--accent);border-radius:var(--radius-sm);padding:10px 14px;font-size:11px;color:var(--text);margin-bottom:14px;line-height:1.6">
        ⚠️ <strong>تنبيه:</strong> بالضغط على "حفظ وإغلاق الفترة" أنت تؤكد رسمياً أنك راجعت كل البنود المذكورة أعلاه، وأن الأرقام مطابقة للواقع لهذه الفترة. سيتم تسجيل هذا الإقرار باسمك وتاريخه.
      </div>
      <button id="review-save-btn" class="btn btn-primary" onclick="saveReviewSignoff()" disabled style="opacity:0.5;width:100%;padding:12px">
        ⏳ أكمل قائمة المراجعة أولاً
      </button>
    </div>`;
}

async function saveReviewSignoff() {
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
async function loadReconciliations() {
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
    const thStyle='background:var(--card2);padding:8px 12px;font-size:11px;font-weight:700;text-align:right;border-bottom:2px solid var(--border)';
    const tdStyle='padding:8px 12px;border-bottom:1px solid var(--border);font-size:12px';

    wrap.innerHTML = `
      <!-- 1. تسوية التحصيلات -->
      <div style="margin-bottom:20px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
        <div style="padding:12px 16px;border-bottom:2px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <span style="font-size:13px;font-weight:700">💰 تسوية التحصيلات — فاتورة بفاتورة</span>
          <div style="display:flex;gap:12px;font-size:11px">
            <span>مُفوتَر: <b>${fmt(tInv)}</b></span>
            <span style="color:var(--green)">محصّل: <b>${fmt(tCol)}</b></span>
            <span style="color:${tOut>0?'var(--red)':'var(--green)'}">متبقي: <b>${fmt(tOut)}</b></span>
          </div>
        </div>
        <div style="overflow-x:auto;max-height:280px;overflow-y:auto">
          <table style="${tblStyle}">
            <thead><tr><th style="${thStyle}">الفاتورة</th><th style="${thStyle}">الملف</th><th style="${thStyle}">العميل</th><th style="${thStyle}">المُفوتَر</th><th style="${thStyle}">المحصّل</th><th style="${thStyle}">المتبقي</th><th style="${thStyle}">الحالة</th></tr></thead>
            <tbody>${invRows.map(r=>{ const sc=r.outstanding<0.01?'var(--green)':r.outstanding<r.invoiced?'var(--accent)':'var(--red)'; const si=r.outstanding<0.01?'✅ مكتمل':r.outstanding<r.invoiced?'⚡ جزئي':'⏳ مستحق';
              return `<tr><td style="${tdStyle}" class="mono text-amber">${r.inv_no||'—'}</td><td style="${tdStyle}" class="mono">${r.file_no||'—'}</td><td style="${tdStyle}">${r.customer||'—'}</td><td style="${tdStyle}" class="mono">${fmt(r.invoiced)}</td><td style="${tdStyle}" class="mono text-green">${fmt(r.collected)}</td><td style="${tdStyle}" class="mono" style="color:${sc};font-weight:700">${fmt(r.outstanding)}</td><td style="${tdStyle}"><span style="font-size:10px;color:${sc};font-weight:700">${si}</span></td></tr>`;
            }).join('')}</tbody>
            <tfoot><tr style="background:var(--card2);font-weight:700"><td colspan="3" style="${tdStyle}">الإجمالي</td><td style="${tdStyle}" class="mono">${fmt(tInv)}</td><td style="${tdStyle}" class="mono text-green">${fmt(tCol)}</td><td style="${tdStyle}" class="mono" style="color:${tOut>0?'var(--red)':'var(--green)'}">${fmt(tOut)}</td><td style="${tdStyle}"></td></tr></tfoot>
          </table>
        </div>
      </div>

      <!-- 2. تسوية الموردين -->
      <div style="margin-bottom:20px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
        <div style="padding:12px 16px;border-bottom:2px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <span style="font-size:13px;font-weight:700">🏭 تسوية الموردين — صفقة بصفقة</span>
          <div style="display:flex;gap:12px;font-size:11px">
            <span>إجمالي: <b>${fmt(tDC)}</b></span>
            <span style="color:var(--green)">مدفوع: <b>${fmt(tPD)}</b></span>
            <span style="color:${tDD>0?'var(--accent)':'var(--green)'}">مستحق: <b>${fmt(tDD)}</b></span>
          </div>
        </div>
        <div style="overflow-x:auto;max-height:260px;overflow-y:auto">
          <table style="${tblStyle}">
            <thead><tr><th style="${thStyle}">الملف</th><th style="${thStyle}">المورد</th><th style="${thStyle}">قيمة الصفقة</th><th style="${thStyle}">المدفوع</th><th style="${thStyle}">المستحق</th><th style="${thStyle}">الحالة</th></tr></thead>
            <tbody>${dealRows.map(r=>{ const sc=r.outstanding<0.01?'var(--green)':r.outstanding>0?'var(--accent)':'var(--red)'; const si=r.outstanding<0.01?'✅ مسدّد':r.outstanding>0?'⏳ متبقي':'⚠️ زيادة';
              return `<tr><td style="${tdStyle}" class="mono text-amber" onclick="openViewer('${r.file_no}')" style="cursor:pointer">${r.file_no}</td><td style="${tdStyle}">${r.supplier}</td><td style="${tdStyle}" class="mono">${fmt(r.total)}</td><td style="${tdStyle}" class="mono text-green">${fmt(r.paid)}</td><td style="${tdStyle}" class="mono" style="font-weight:700;color:${sc}">${fmt(Math.abs(r.outstanding))}</td><td style="${tdStyle}"><span style="font-size:10px;color:${sc};font-weight:700">${si}</span></td></tr>`;
            }).join('')}</tbody>
            <tfoot><tr style="background:var(--card2);font-weight:700"><td colspan="2" style="${tdStyle}">الإجمالي</td><td style="${tdStyle}" class="mono">${fmt(tDC)}</td><td style="${tdStyle}" class="mono text-green">${fmt(tPD)}</td><td style="${tdStyle}" class="mono" style="color:${tDD>0?'var(--accent)':'var(--green)'}">${fmt(tDD)}</td><td style="${tdStyle}"></td></tr></tfoot>
          </table>
        </div>
      </div>

      <!-- 3. تسوية الشركاء -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
        <div style="padding:12px 16px;border-bottom:2px solid var(--border);font-size:13px;font-weight:700">👥 تسوية حسابات الشركاء
          <span style="font-size:11px;font-weight:400;color:var(--text2);margin-right:8px">— الأرباح المحققة من الصفقات المغلقة فقط</span>
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
                <td style="${tdStyle}" class="mono text-muted" style="font-size:11px">${fmt(r.profitPending||0)} <span style="font-size:9px;color:var(--text2)">(تقديري)</span></td>
                <td style="${tdStyle}" class="mono text-amber">${fmt(r.withdrawn)}</td>
                <td style="${tdStyle}" class="mono" style="font-weight:900;color:${sc}">${fmt(r.balance)}</td>
                <td style="${tdStyle}"><span style="font-size:10px;color:${sc};font-weight:700">${si}</span></td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>`;
  } catch(e) { wrap.innerHTML=errHTML('خطأ: '+e.message); }
}

// ════ سجل المراجعات ════
async function loadReviewHistory() {
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
            <div style="font-size:11px;color:var(--text2)">✅ ${passed} · ⚠️ ${warned} · ❌ ${failed} &nbsp;|&nbsp; 👤 ${reviewer} &nbsp;|&nbsp; 🕐 ${dt}</div>
            <div style="font-size:11px;color:${sc};font-weight:700;margin-top:3px">${label}</div>
            ${r.notes?`<div style="font-size:11px;color:var(--text2);margin-top:3px;font-style:italic">"${r.notes}"</div>`:''}
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
const JE_ACCOUNT_SUGGESTIONS = [
  { code:'1110', name:'النقد',                  type:'أصول'        },
  { code:'1120', name:'البنك',                  type:'أصول'        },
  { code:'1200', name:'ذمم العملاء',             type:'أصول'        },
  { code:'1300', name:'المخزون — سيارات',        type:'أصول'        },
  { code:'1400', name:'مصاريف مدفوعة مقدماً',   type:'أصول'        },
  { code:'1500', name:'أصول ثابتة',             type:'أصول'        },
