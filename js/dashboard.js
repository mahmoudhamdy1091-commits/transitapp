// ╔══════════════════════════════════════════════════════════╗
// ║  dashboard.js — Dashboard · KPIs · Charts · Drill-down  ║
// ║  Transit Management System — نقل حرفي، لا تعديل منطق   ║
// ╚══════════════════════════════════════════════════════════╝
async function loadDashboard() {
  setLoading('dealsTableBody');
  const sys  = state.system;
  const from = dashState.from || new Date(Date.now() - 30*864e5).toISOString().split('T')[0];
  const to   = dashState.to   || new Date().toISOString().split('T')[0];
  const todayStr = new Date().toISOString().split('T')[0];
  const in7   = new Date(Date.now() + 7*864e5).toISOString().split('T')[0];

  try {
    await ensureCache();
    const deals       = state.allDeals;
    const vehicles    = state.allVehicles;
    const allSales    = state.allSales;
    const allExpenses = state.allExpenses;
    const collections = state.allCollections;
    const drafts      = await apiGet('journal_entries', { select:'id', system_type:`eq.${sys}`, post_status:'eq.draft' });

    // ── فلتر بيانات الفترة (posted + null فقط = البيانات المرحَّلة والقديمة) ──
    const inPeriod = (dateStr) => dateStr && dateStr >= from && dateStr <= to;
    const periodSales = (allSales||[]).filter(s => isPosted(s) && inPeriod(s.sale_date||s.created_at?.split('T')[0]));
    const periodExp   = (allExpenses||[]).filter(e => isPosted(e) && inPeriod(e.exp_date||e.expense_date||e.created_at?.split('T')[0]));

    // ── Enrich deals — من الـ cache ──
    // ensureCache() بنت allDealsEnriched بالفعل

    // ── حسابات الفترة — المصدر الموحد: journal_entries ──
    // يشمل: النظام الحالي + صفوف system_type=null (بيانات قديمة)
    const toEOD = to + 'T23:59:59';
    const _buildJeKpiUrl = (sysParam) =>
      `${SB_URL}/rest/v1/journal_entries` +
      `?${sysParam}` +
      `&entry_date=gte.${encodeURIComponent(from)}` +
      `&entry_date=lte.${encodeURIComponent(toEOD)}` +
      `&post_status=eq.posted` +
      `&select=account_code,dr_amount,cr_amount,ref_table,file_no` +
      `&limit=49999`;

    // دالة مساعدة: fetch مع معالجة 401
    const _fetchJeKpi = async (url) => {
      const h = headers({ 'Range': '0-49999', 'Range-Unit': 'items' });
      let res = await fetch(url, { headers: h });
      if (res.status === 401) {
        const ok = await refreshAccessToken();
        if (!ok) throw new Error('انتهت الجلسة');
        res = await fetch(url, { headers: headers({ 'Range': '0-49999', 'Range-Unit': 'items' }) });
      }
      return res.ok ? res.json() : [];
    };

    // جلب صفوف النظام + صفوف system_type=null معاً
    const [_jeKpi1, _jeKpi2] = await Promise.all([
      _fetchJeKpi(_buildJeKpiUrl(`system_type=eq.${encodeURIComponent(sys)}`)),
      _fetchJeKpi(_buildJeKpiUrl('system_type=is.null')),
    ]);
    const _seenJeKpi = new Set();
    const jeKpiRows = [];
    [...(_jeKpi1||[]), ...(_jeKpi2||[])].forEach(r => {
      const k = r.id ?? JSON.stringify(r);
      if (!_seenJeKpi.has(k)) { _seenJeKpi.add(k); jeKpiRows.push(r); }
    });

    // تجميع الأرقام من القيود المحاسبية
    // totExp  = مصاريف الصفقات فقط (ref=expenses) — الـ opex يُعرض منفصلاً
    let totSales = 0, totDealExp = 0, totOpex = 0, totPurchase = 0;
    (jeKpiRows || []).forEach(r => {
      const acc = r.account_code || '';
      const dr  = +r.dr_amount  || 0;
      const cr  = +r.cr_amount  || 0;
      const ref = r.ref_table   || '';
      // إيرادات المبيعات — حساب 4xxx دائن
      if (acc.startsWith('4') && cr > 0) totSales += cr;
      // مصاريف الصفقات — 5xxx أو 6xxx مدين + ref=expenses
      // (شحن/نقل → 5200، جمارك/صيانة → 6xxx — كلاهما مصاريف صفقة)
      if ((acc.startsWith('5') || acc.startsWith('6')) && dr > 0 && ref === 'expenses') totDealExp += dr;
      // المصاريف التشغيلية — 6xxx مدين + ref=operating_expenses
      if (acc.startsWith('6') && dr > 0 && ref === 'operating_expenses') totOpex += dr;
      // تكلفة الشراء — حساب 1300 مدين من أوامر شراء
      if (acc === '1300' && dr > 0 && ref === 'purchase_orders') totPurchase += dr;
    });
    // totExp = مجموع مصاريف الصفقات + التشغيلية (للـ KPI الإجمالي)
    const totExp = totDealExp + totOpex;

    // totSalesRaw للـ drill-down فقط (قائمة الفواتير)
    const totSalesRaw = (state.allSales||[]).filter(s => isPosted(s) && (s.sale_date||'') >= from && (s.sale_date||'') <= to)
      .reduce((s,r)=>s+(+r.sale_price||0),0);
    const periodSalesForDD = (state.allSales||[]).filter(s => isPosted(s) && (s.sale_date||'') >= from && (s.sale_date||'') <= to);
    const periodExpForDD   = (state.allExpenses||[]).filter(e => isPosted(e) && ((e.exp_date||e.expense_date||'') >= from) && ((e.exp_date||e.expense_date||'') <= to));

    const allDealsEnriched = state.allDealsEnriched || [];

    // المشتريات للـ drill-down: من الـ cache
    const periodPurchaseDeals = allDealsEnriched.filter(d => {
      const dt = d.po_date || d.created_at?.split('T')[0] || '';
      return dt >= from && dt <= to;
    });

    const soldVinsAll   = new Set((allSales||[]).filter(isPosted).map(s=>s.vin));
    const stockVehicles = (vehicles||[]).filter(v => !soldVinsAll.has(v.vin));
    const overdueList   = (collections||[]).filter(c => isPosted(c) && !c.paid_date && c.due_date && c.due_date <= todayStr);
    const upcomingList  = (collections||[]).filter(c => isPosted(c) && !c.paid_date && c.due_date && c.due_date > todayStr && c.due_date <= in7);
    const overdueAmt    = overdueList.reduce((s,c)=>s+(+c.amount||0),0);
    const draftCount    = (drafts||[]).length;

    // ── حفظ البيانات للـ drill-down ──
    _ddState.data = {
      periodSales: periodSalesForDD, periodExp: periodExpForDD,
      periodDeals: allDealsEnriched,
      periodPurchaseDeals,
      // periodCollections: يشمل أي تحصيل له due_date أو paid_date أو created_at في الفترة
      // أو تحصيلات بدون تاريخ تظهر دائماً
      periodCollections: (collections||[]).filter(c => {
        const d1 = (c.due_date  || '').slice(0,10);
        const d2 = (c.paid_date || '').slice(0,10);
        const d3 = (c.created_at|| '').slice(0,10);
        if (!d1 && !d2 && !d3) return true;
        return (d1 && d1 >= from && d1 <= to)
            || (d2 && d2 >= from && d2 <= to)
            || (d3 && d3 >= from && d3 <= to);
      }),
      allCollections: collections || [],
      allSales: allSales || [],
      stockVehicles, todayStr, from, to,
    };

    // ── KPIs — من journal_entries (SSOT) ──
    // نشاط الفترة: إيراد - شراء - (مصاريف صفقات + تشغيلية)
    const profit      = totSales - totPurchase - totExp;
    const margin      = totSales > 0 ? ((profit/totSales)*100).toFixed(1) : 0;
    // فلتر التحصيلات: فقط المقبوض فعلاً (paid_date موجود)
    const paidCollections    = (_ddState.data.periodCollections||[]).filter(c => isPosted(c) && c.paid_date);
    const pendingCollections = (_ddState.data.periodCollections||[]).filter(c => isPosted(c) && !c.paid_date);
    const totCollections     = paidCollections.reduce((s,c)=>s+(+c.amount||0),0);
    const totPending         = pendingCollections.reduce((s,c)=>s+(+c.amount||0),0);
    const totFullCost        = totPurchase + totExp;

    const setKpi = (id, val, color) => { const e = el(id); if(!e) return; animateCount(e, String(val), color); };
    setKpi('kpi-purchase',    fmt(totPurchase),    'var(--blue)');
    setKpi('kpi-sales',       fmt(totSales),       'var(--green)');
    setKpi('kpi-month-exp',   fmt(totExp),         totExp>0?'var(--red)':'var(--text2)');
    setKpi('kpi-fullcost',    fmt(totFullCost),     'var(--accent)');
    setKpi('kpi-profit',      fmt(profit),          profit>=0?'var(--green)':'var(--red)');
    setKpi('kpi-stock',       stockVehicles.length, stockVehicles.length>0?'var(--purple)':'var(--green)');

    if(el('kpi-purchase-sub'))  el('kpi-purchase-sub').textContent  = `${periodPurchaseDeals.length} صفقة`;
    if(el('kpi-sales-sub'))     el('kpi-sales-sub').textContent     = `${periodSalesForDD.length} فاتورة`;

    // ── كارد التحصيلات المقبوضة ──
    if (el('dash-collected-amt')) el('dash-collected-amt').textContent = fmt(totCollections);
    if (el('dash-collected-sub')) {
      const pendCount = pendingCollections.length;
      el('dash-collected-sub').innerHTML = pendCount > 0
        ? `${paidCollections.length} فاتورة · <span style="color:var(--accent)">⏳ ${pendCount} مستحق</span>`
        : `${paidCollections.length} فاتورة ✅ كل شيء محصّل`;
    }
    // حفظ للـ drill-down
    _ddState.data.collectedList  = paidCollections;
    _ddState.data.pendingList    = pendingCollections;

    // Indicator التحصيلات المنتظرة جوه كارت المبيعات
    const pendEl = el('kpi-pending-collections');
    if (pendEl) {
      if (totPending > 0) {
        pendEl.style.display = 'block';
        pendEl.textContent   = `⏳ ${fmt(totPending)} منتظرة`;
        pendEl.title         = `${pendingCollections.length} فاتورة لم تُحصَّل بعد`;
      } else {
        pendEl.style.display = 'none';
      }
    }
    if(el('kpi-month-exp-sub'))   el('kpi-month-exp-sub').textContent   = `${periodExpForDD.length} بند`;
    if(el('kpi-fullcost-sub'))    el('kpi-fullcost-sub').textContent    = `شراء ${fmt(totPurchase)} + مصاريف ${fmt(totDealExp)} + تشغيلي ${fmt(totOpex)}`;
    if(el('kpi-profit-sub'))      el('kpi-profit-sub').textContent      = `هامش ${margin}% · نشاط الفترة`;
    if(el('kpi-stock-sub'))       el('kpi-stock-sub').textContent       = stockVehicles.filter(v=>daysSince(v.created_at)>60).length>0 ? `${stockVehicles.filter(v=>daysSince(v.created_at)>60).length} أكثر من 60 يوم` : 'لم تُباع بعد';

    // ── Badges ──
    if(el('badge-open'))     el('badge-open').textContent     = (deals||[]).filter(d=>d.status==='OPEN').length || '';
    if(el('badge-progress')) el('badge-progress').textContent = (deals||[]).filter(d=>d.status==='IN PROGRESS').length || '';

    // ── مستحق للموردين — من الـ cache ──
    try {
      const allPayments = state.allPayments?.length
        ? state.allPayments
        : await apiGetAll('payments', { select:'file_no,amount,post_status', system_type:`eq.${sys}` });
      const paidMap = {};
      (allPayments||[]).filter(isPosted).forEach(p => { paidMap[p.file_no] = (paidMap[p.file_no]||0) + (+p.amount||0); });
      const duelist = (deals||[]).map(d => ({
        file_no: d.file_no, supplier: d.supplier||'—',
        total_purchase: +d.total_purchase||0,
        paid: paidMap[d.file_no]||0,
        due: (+d.total_purchase||0) - (paidMap[d.file_no]||0),
        po_date: d.po_date||'',
        status: d.status||'—',
      })).filter(d => d.due > 0.01).sort((a,b) => b.due - a.due);
      const totalDue = duelist.reduce((s,d) => s + d.due, 0);
      _ddState.data.supplierDuelist = duelist; // للـ drill-down
      if (el('dash-supplier-due')) el('dash-supplier-due').textContent = fmt(totalDue);
      if (el('dash-supplier-due-list')) {
        el('dash-supplier-due-list').innerHTML = duelist.length
          ? duelist.slice(0,3).map(d =>
              `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border)">
                <span style="color:var(--text)">${d.supplier} <span style="color:var(--accent);font-family:monospace;font-size:10px">${d.file_no}</span></span>
                <span style="font-family:monospace;color:var(--red);font-weight:700">${fmt(d.due)}</span>
              </div>`).join('') + (duelist.length > 3 ? `<div style="font-size:10px;color:var(--text2);margin-top:4px">+ ${duelist.length-3} صفقة أخرى</div>` : '')
          : '<div style="color:var(--green);font-size:11px">✓ لا توجد مستحقات</div>';
      }
    } catch(e) { console.warn('supplier due list:', e.message); }

    // ── تحصيلات متأخرة — فقط التي لم تُدفع بعد ──
    const overdueItems = (collections||[]).filter(c =>
      isPosted(c) && !c.paid_date && c.due_date && c.due_date <= todayStr
    ).sort((a,b) => a.due_date > b.due_date ? 1 : -1);

    // حساب المجموع الكلي للتحصيلات المستحقة (كل مبالغ غير محصّلة)
    const allCollected = (collections||[]).filter(c => isPosted(c) && c.paid_date).reduce((s,c)=>s+(+c.amount||0),0);
    const allDueTotal  = (collections||[]).filter(c => isPosted(c)).reduce((s,c)=>s+(+c.amount||0),0);
    const overdueTotal = overdueItems.reduce((s,c) => s + (+c.amount||0), 0);
    if (el('dash-overdue-amt')) el('dash-overdue-amt').textContent = fmt(overdueTotal);
    if (el('dash-overdue-list')) {
      el('dash-overdue-list').innerHTML = overdueItems.length
        ? overdueItems.slice(0,3).map(c =>
            `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border)">
              <span style="color:var(--text)">${c.customer||'—'} <span style="color:var(--text2);font-size:10px">${c.due_date}</span></span>
              <span style="font-family:monospace;color:var(--accent);font-weight:700">${fmt(c.amount)}</span>
            </div>`).join('') + (overdueItems.length > 3 ? `<div style="font-size:10px;color:var(--text2);margin-top:4px">+ ${overdueItems.length-3} فاتورة أخرى</div>` : '')
        : '<div style="color:var(--green);font-size:11px">✓ لا توجد تحصيلات متأخرة</div>';
    }

    // ── Alerts ──
    renderDashAlerts(overdueList, upcomingList, stockVehicles, draftCount, deals||[]);

    // ── Performance chart ──
    // Chart removed — drill-down replaces it

    // ── Expenses breakdown ──
    renderDashExpBreakdown(periodExpForDD); // visual breakdown — operational data للعرض فقط

    // ── Collections list ──
    renderDashCollections(overdueList, upcomingList, todayStr);

    // ── Full deals table ──
    const list = state.dealsFilter==='all' ? state.allDealsEnriched : state.allDealsEnriched.filter(d=>d.status===state.dealsFilter);
    if(el('dealsCountLabel')) el('dealsCountLabel').textContent = `${state.allDealsEnriched.length} ملف`;
    renderDealsTable(list);

    // ── لو كان drill-down مفتوح، نحدثه ──
    if (_ddState.type) renderDrillDown(_ddState.type);

    // تحديث badge الموافقات
    if (can('roles')) updateApprovalBadge();

  } catch(e) {
    showErr('dealsTableBody', 'خطأ في تحميل البيانات: ' + e.message);
    console.error(e);
  }
}

// ── Performance Chart — Stacked Bar ──
function renderDashPerfChart(sales, expenses, from, to, days, deals) {
  const chartWrap  = el('dash-perf-chart');
  const labelsWrap = el('dash-perf-labels');
  if (!chartWrap) return;

  const fromD = new Date(from), toD = new Date(to);
  const totalDays = Math.round((toD - fromD) / 864e5) + 1;
  let buckets = [];

  if (totalDays <= 14) {
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(fromD); d.setDate(d.getDate() + i);
      const ds = d.toISOString().split('T')[0];
      buckets.push({ label: `${d.getDate()}/${d.getMonth()+1}`, from:ds, to:ds, purchase:0, exp:0, sales:0 });
    }
  } else if (totalDays <= 60) {
    let cur = new Date(fromD);
    while (cur <= toD) {
      const wEnd = new Date(cur); wEnd.setDate(wEnd.getDate()+6);
      if (wEnd > toD) wEnd.setTime(toD.getTime());
      buckets.push({ label:`${cur.getDate()}/${cur.getMonth()+1}`, from:cur.toISOString().split('T')[0], to:wEnd.toISOString().split('T')[0], purchase:0, exp:0, sales:0 });
      cur = new Date(wEnd); cur.setDate(cur.getDate()+1);
    }
  } else {
    let cur = new Date(fromD.getFullYear(), fromD.getMonth(), 1);
    while (cur <= toD) {
      const mEnd = new Date(cur.getFullYear(), cur.getMonth()+1, 0);
      buckets.push({ label:cur.toLocaleDateString('en-GB',{month:'short'}), from:cur.toISOString().split('T')[0], to:mEnd.toISOString().split('T')[0], purchase:0, exp:0, sales:0 });
      cur = new Date(cur.getFullYear(), cur.getMonth()+1, 1);
    }
  }

  // توزيع البيانات
  (deals||[]).forEach(d => {
    const date = d.po_date||'';
    const b = buckets.find(bk => date >= bk.from && date <= bk.to);
    if (b) b.purchase += +d.total_purchase||0;
  });
  sales.forEach(s => {
    const d = s.sale_date||s.created_at?.split('T')[0]||'';
    const b = buckets.find(bk => d >= bk.from && d <= bk.to);
    if (b) b.sales += +s.sale_price||0;
  });
  expenses.forEach(e => {
    const d = e.exp_date||e.expense_date||e.created_at?.split('T')[0]||'';
    const b = buckets.find(bk => d >= bk.from && d <= bk.to);
    if (b) b.exp += +e.amount||0;
  });
  buckets.forEach(b => b.profit = b.sales - b.purchase - b.exp);

  const fmtK = v => v >= 1000 ? (v/1000).toFixed(1)+'K' : v > 0 ? v.toFixed(0) : '';
  const CHART_H = 110;

  // Stacked Bar: كل بار = purchase (أزرق) + exp (أحمر) مكدسين، وبار المبيعات جنبهم (أخضر)
  const maxVal = Math.max(...buckets.map(b => Math.max(b.purchase + b.exp, b.sales, 1)), 1);

  chartWrap.style.cssText = 'display:flex;gap:6px;align-items:flex-end;height:' + CHART_H + 'px;margin-bottom:8px;padding-top:14px';

  chartWrap.innerHTML = buckets.map(b => {
    const stackH = Math.max(((b.purchase + b.exp) / maxVal) * CHART_H, (b.purchase+b.exp)>0?4:0);
    const purH   = stackH > 0 ? Math.round((b.purchase / (b.purchase+b.exp||1)) * stackH) : 0;
    const expH   = stackH - purH;
    const salH   = Math.max((b.sales / maxVal) * CHART_H, b.sales>0?4:0);
    const pColor = b.profit >= 0 ? 'var(--green)' : 'var(--red)';
    const tooltip = `مشتريات: ${fmtK(b.purchase)} | مصروفات: ${fmtK(b.exp)} | مبيعات: ${fmtK(b.sales)} | ربح: ${fmtK(Math.abs(b.profit))}`;
    return `
    <div style="flex:1;display:flex;gap:2px;align-items:flex-end;min-width:0" title="${tooltip}">
      <!-- Stacked: مشتريات + مصروفات -->
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;position:relative">
        ${b.purchase+b.exp > 0 ? `<div style="font-size:8px;color:var(--text2);position:absolute;top:-12px;white-space:nowrap">${fmtK(b.purchase+b.exp)}</div>` : ''}
        <div style="width:100%;display:flex;flex-direction:column;border-radius:3px 3px 0 0;overflow:hidden">
          <div style="width:100%;height:${purH}px;background:var(--blue);min-height:${b.purchase>0?2:0}px"></div>
          <div style="width:100%;height:${expH}px;background:var(--red);min-height:${b.exp>0?2:0}px"></div>
        </div>
      </div>
      <!-- مبيعات -->
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;position:relative">
        ${b.sales > 0 ? `<div style="font-size:8px;color:var(--green);position:absolute;top:-12px;white-space:nowrap">${fmtK(b.sales)}</div>` : ''}
        <div style="width:100%;height:${salH}px;background:var(--green);border-radius:3px 3px 0 0;min-height:${b.sales>0?2:0}px"></div>
      </div>
    </div>`;
  }).join('');

  if (labelsWrap) {
    labelsWrap.innerHTML = buckets.map(b =>
      `<div style="flex:1;text-align:center;font-size:9px;color:var(--text2);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.label}</div>`
    ).join('');
  }
}

// ── Period deals summary ──

// ── Helper: days since date ──
function daysSince(dateStr) {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 864e5);
}

// ── Alerts strip ──
function renderDashAlerts(overdueList, upcomingList, stockVehicles, draftCount, deals) {
  const wrap   = el('dash-alerts-wrap');
  const alerts = el('dash-alerts');
  if (!wrap || !alerts) return;

  const items = [];
  if (overdueList.length)  items.push({ count: overdueList.length,  label: 'تحصيلات متأخرة',  sub: `أقدمها ${daysSince(overdueList.sort((a,b)=>a.due_date>b.due_date?1:-1)[0]?.due_date)} يوم`, color:'var(--red)',    bg:'var(--red-dim)' });
  if (upcomingList.length) items.push({ count: upcomingList.length, label: 'تحصيلات قادمة',   sub: 'خلال 7 أيام',  color:'var(--accent)', bg:'var(--accent-dim)' });
  const oldStock = stockVehicles.filter(v => daysSince(v.created_at) > 60);
  if (oldStock.length)     items.push({ count: oldStock.length,     label: 'سيارات +60 يوم',  sub: 'راكدة في المخزن', color:'var(--amber)', bg:'var(--amber-dim)||var(--accent-dim)' });
  if (draftCount)          items.push({ count: draftCount,          label: 'مسودات معلقة',    sub: 'لم تُرحَّل بعد', color:'var(--purple)', bg:'var(--purple-dim)' });
  const oldDeals = deals.filter(d => d.status==='OPEN' && daysSince(d.created_at||d.po_date) > 30);
  if (oldDeals.length)     items.push({ count: oldDeals.length,     label: 'صفقات مفتوحة طويل', sub: 'أكثر من 30 يوم', color:'var(--blue)', bg:'var(--blue-dim)' });

  if (!items.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  alerts.innerHTML = items.map(a => `
    <div style="flex-shrink:0;background:var(--card);border:1px solid var(--border);border-right:3px solid ${a.color};border-radius:var(--radius-sm);padding:10px 14px;min-width:140px;cursor:pointer;transition:background .15s"
      onmouseover="this.style.background='var(--card2)'" onmouseout="this.style.background='var(--card)'">
      <div style="font-size:22px;font-weight:700;color:${a.color};font-family:var(--mono);line-height:1;margin-bottom:3px">${a.count}</div>
      <div style="font-size:11px;font-weight:600;color:var(--text)">${a.label}</div>
      <div style="font-size:10px;color:${a.color};margin-top:2px">${a.sub}</div>
    </div>`).join('');
}

// ── Collections list ──
function renderDashCollections(overdueList, upcomingList, today) {
  const wrap = el('dash-collections-list');
  if (!wrap) return;
  const all  = [
    ...overdueList.map(c=>({...c, _type:'overdue'})),
    ...upcomingList.map(c=>({...c, _type:'upcoming'})),
  ].sort((a,b) => (a.due_date||'') > (b.due_date||'') ? 1 : -1).slice(0,5);
  if(el('collections-label')) el('collections-label').textContent = `${overdueList.length} متأخر · ${upcomingList.length} قادم`;
  if (!all.length) { wrap.innerHTML = `<div style="font-size:12px;color:var(--green);text-align:center;padding:16px">✓ لا توجد تحصيلات متأخرة</div>`; return; }
  wrap.innerHTML = all.map(c => {
    const isOverdue = c._type === 'overdue';
    const daysAgo   = daysSince(c.due_date);
    const color     = isOverdue ? 'var(--red)' : 'var(--accent)';
    const subText   = isOverdue ? `متأخر ${daysAgo} يوم` : `يستحق ${c.due_date}`;
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="openViewer('${c.file_no||''}')">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.customer||'—'}</div>
        <div style="font-size:10px;color:var(--text2)">${c.file_no||'—'} · ${c.inv_no||'—'}</div>
      </div>
      <div style="text-align:left;flex-shrink:0;margin-right:8px">
        <div style="font-size:12px;font-weight:700;color:${color};font-family:monospace">${fmt(c.amount)}</div>
        <div style="font-size:10px;color:${color}">${subText}</div>
      </div>
    </div>`; }).join('');
}

// ── Expenses breakdown ──
function renderDashExpBreakdown(expenses) {
  const wrap = el('dash-exp-breakdown');
  if (!wrap) return;
  const byType = {};
  expenses.forEach(e => { const t = e.exp_type||e.category||'أخرى'; byType[t]=(byType[t]||0)+(+e.amount||0); });
  const total = Object.values(byType).reduce((s,v)=>s+v,0);
  if (!total) { wrap.innerHTML = `<div style="font-size:11px;color:var(--text2)">لا توجد مصاريف</div>`; return; }
  const colors = ['var(--blue)','var(--purple)','var(--accent)','var(--cyan)','var(--green)'];
  wrap.innerHTML = Object.entries(byType).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([type,amt],i) => {
    const pct = Math.round((amt/total)*100);
    return `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">
      <div style="font-size:11px;color:var(--text2);width:55px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${type}</div>
      <div style="flex:1;height:5px;background:var(--card2);border-radius:3px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${colors[i%colors.length]};border-radius:3px"></div>
      </div>
      <div style="font-size:10px;font-weight:600;color:${colors[i%colors.length]};width:28px;text-align:left">${pct}%</div>
    </div>`;
  }).join('');
}



// دالة موحدة لعرض جدول الصفقات
// targetId: العنصر اللي هيتكتب فيه
// opts.showSales: يضيف عمود المبيعات (للتقارير)
// opts.totalRow: يضيف صف الإجمالي
function renderDealsTable(deals, targetId = 'dealsTableBody', opts = {}) {
  const target = el(targetId);
  if (!target) return;

  const countLabel = el('dealsCountLabel');
  if (countLabel) countLabel.textContent = `${deals.length} ملف`;

  if (!deals.length) {
    target.innerHTML = `<div class="empty-state"><div class="e-icon">📂</div><p>لا توجد صفقات بعد</p><small>أضف ملف جديد للبدء</small></div>`;
    return;
  }

  // ══ الأعمدة الثابتة: مشتريات → مصاريف → تكلفة كاملة → مبيعات → صافي الربح/الخسارة ══
  const rows = deals.map(d => {
    const purchase    = d._totalCost || d.total_purchase || d.purchase || 0;
    const expenses    = d._totalExp  || d.expenses || 0;
    const fullCost    = d._fullCost  || d.fullCost || (purchase + expenses);
    const sales       = d._totalSale || d.sales || 0;
    const profit      = d._profit    || d.profit || (sales - fullCost);
    const profitColor = profit > 0 ? 'var(--green)' : profit < 0 ? 'var(--red)' : 'var(--text2)';
    const profitBg    = profit > 0 ? 'var(--green-dim)' : profit < 0 ? 'var(--red-dim)' : 'transparent';
    const profitArrow = profit >= 0 ? '▲' : '▼';

    const fileNoDisplay = d.file_no || '⚠️ بدون رقم';
    const canOpen       = !!d.file_no;

    return `<tr onclick="${canOpen?`openViewer('${d.file_no}')`:'void(0)'}" style="cursor:${canOpen?'pointer':'default'}">
      <!-- رقم الملف + تاريخ -->
      <td>
        <div style="display:flex;align-items:center;gap:5px">
          <span class="mono text-amber" style="font-weight:700;font-size:13px">${fileNoDisplay}</span>
          ${canOpen ? `<button onclick="event.stopPropagation();openNewFileModal('${d.file_no}')"
            style="background:none;border:none;cursor:pointer;color:var(--text2);font-size:12px;padding:1px 3px;border-radius:3px" title="تعديل">✏️</button>` : ''}
          ${can('delete') ? `<button onclick="event.stopPropagation();deleteOrphanDeal('${d.id||d.file_no}')"
            style="background:none;border:none;cursor:pointer;color:var(--red);font-size:12px;padding:1px 3px;border-radius:3px" title="حذف">🗑</button>` : ''}
        </div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px">${fmtDate(d.po_date)}</div>
      </td>
      <!-- المورد + ملاحظات -->
      <td>
        <div style="font-weight:600">${d.supplier||d.file||'—'}</div>
        <div style="font-size:11px;color:var(--text2)">${d.notes||''}</div>
      </td>
      <!-- السيارات -->
      <td style="text-align:center">
        <div style="font-family:var(--mono);font-weight:700;font-size:13px">${d._vTotal||0}</div>
        <div style="font-size:10px;color:var(--text2)">${d._vSold||0} مباع · ${d._vLeft||0} متبقي</div>
      </td>
      <!-- المشتريات -->
      <td>
        <div class="mono text-blue" style="font-weight:700">${fmt(purchase)}</div>
      </td>
      <!-- المصاريف -->
      <td>
        <div class="mono text-red" style="font-weight:700">${fmt(expenses)}</div>
      </td>
      <!-- التكلفة الكاملة -->
      <td>
        <div class="mono" style="font-weight:700;color:var(--accent)">${fmt(fullCost)}</div>
        <div style="font-size:10px;color:var(--text2)">شراء ${fmt(purchase)} + مصاريف ${fmt(expenses)}</div>
      </td>
      <!-- المبيعات -->
      <td>
        <div class="mono text-green" style="font-weight:700">${fmt(sales)}</div>
      </td>
      <!-- صافي الربح / الخسارة -->
      <td>
        <div style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:8px;background:${profitBg}">
          <span style="font-size:12px">${profitArrow}</span>
          <span class="mono" style="font-weight:900;color:${profitColor};font-size:13px">${fmt(Math.abs(profit))}</span>
        </div>
        ${profit!==0 && sales>0 ? `<div style="font-size:10px;color:var(--text2);margin-top:2px;text-align:center">هامش ${sales>0?((profit/sales)*100).toFixed(1):0}%</div>` : ''}
      </td>
      <!-- الحالة -->
      <td><span class="badge badge-${statusClass(d.status)}">${d.status||'—'}</span></td>
    </tr>`;
  }).join('');

  // ══ صف الإجمالي ══
  const tp = deals.reduce((s,d)=>s+(d._totalCost||d.total_purchase||d.purchase||0),0);
  const te = deals.reduce((s,d)=>s+(d._totalExp||d.expenses||0),0);
  const ts = deals.reduce((s,d)=>s+(d._totalSale||d.sales||0),0);
  const tP = deals.reduce((s,d)=>s+(d._profit||d.profit||(( d._totalSale||0)-(d._fullCost||0))),0);
  const totalRow = `<tr style="background:var(--card2);font-weight:700;border-top:2px solid var(--border)">
    <td colspan="2" style="padding:10px 14px;font-size:12px">الإجمالي — ${deals.length} صفقة</td>
    <td></td>
    <td class="mono text-blue" style="font-weight:900">${fmt(tp)}</td>
    <td class="mono text-red"  style="font-weight:900">${fmt(te)}</td>
    <td class="mono" style="font-weight:900;color:var(--accent)">${fmt(tp+te)}</td>
    <td class="mono text-green" style="font-weight:900">${fmt(ts)}</td>
    <td>
      <div style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:8px;background:${tP>=0?'var(--green-dim)':'var(--red-dim)'}">
        <span>${tP>=0?'▲':'▼'}</span>
        <span class="mono" style="font-weight:900;color:${tP>=0?'var(--green)':'var(--red)'};">${fmt(Math.abs(tP))}</span>
      </div>
    </td>
    <td></td>
  </tr>`;

  target.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>رقم الملف</th>
        <th>المورد / البيان</th>
        <th style="text-align:center">السيارات</th>
        <th style="color:var(--blue)">المشتريات</th>
        <th style="color:var(--red)">المصاريف</th>
        <th style="color:var(--accent)">التكلفة الكاملة</th>
        <th style="color:var(--green)">المبيعات</th>
        <th>صافي الربح / الخسارة</th>
        <th>الحالة</th>
      </tr></thead>
      <tbody>${rows}${totalRow}</tbody>
    </table>`;
}

function filterDeals(status) {
  state.dealsFilter = status;
  const src = state.allDealsEnriched || state.allDeals || [];
  const deals = status === 'all' ? src : src.filter(d => d.status === status);
  renderDealsTable(deals);
  navActive('nav-dashboard');
  showDashboard();
  // Update active filter button
  document.querySelectorAll('.section-actions .btn').forEach(b => b.classList.remove('active-filter'));
  const labels = {'all':'الكل','OPEN':'مفتوح','IN PROGRESS':'جاري','CLOSED':'مغلق'};
  document.querySelectorAll('.section-actions .btn').forEach(b => {
    if (b.textContent.trim() === (labels[status]||status)) b.classList.add('active-filter');
  });
}

// ════════════════════════════════════════
// VIEWER
// ════════════════════════════════════════

async function openViewer(fileNo) {
  state.currentFileNo = fileNo;
  state.currentTab = 0;

  hideAllViews();
  el('viewerView').style.display = 'block';

  // Find deal from cache
  const deal = state.allDeals.find(d => d.file_no === fileNo);
  state.currentDeal = deal;

  // Header
  el('vh-fileNo').textContent = fileNo;
  el('vh-meta').innerHTML = `
    <span class="vh-meta-item"><strong>المورد:</strong> ${deal?.supplier || '—'}</span>
    <span class="vh-meta-item"><strong>PO:</strong> ${deal?.po_no || '—'}</span>
    <span class="vh-meta-item"><strong>التاريخ:</strong> ${fmtDate(deal?.po_date)}</span>
    <span class="vh-meta-item"><strong>عدد السيارات:</strong> ${deal?.vehicle_count || '—'}</span>
  `;
  el('vh-status-badge').innerHTML = `<span class="badge badge-${statusClass(deal?.status)}">${deal?.status}</span>`;
  el('vh-actions').innerHTML = `
    <div class="vh-action-group">
      <button class="btn btn-secondary btn-sm" onclick="openPaymentModal()">💳 دفعة</button>
      <button class="btn btn-secondary btn-sm" onclick="openSaleModal()">🤝 بيع</button>
      <button class="btn btn-secondary btn-sm" onclick="openExpenseModal()">💸 مصروف</button>
      <button class="btn btn-secondary btn-sm" onclick="openCollectionModal()">💰 تحصيل</button>
      <button class="btn btn-secondary btn-sm" onclick="openPayoutModal()">👥 صرف شريك</button>
      <button class="btn btn-secondary btn-sm" onclick="openNewFileModal('${fileNo}')">✏️ تعديل</button>
    </div>
    <div class="vh-print-group">
      <button class="btn btn-secondary btn-sm" onclick="printPurchaseOrder('${fileNo}')">🖨️ سند</button>
      <button class="btn btn-secondary btn-sm" onclick="printDealStatement('${fileNo}')">🖨️ كشف</button>
      <button class="btn btn-secondary btn-sm" onclick="exportDealExcel('${fileNo}')">📊 Excel</button>
      <button class="btn btn-secondary btn-sm" onclick="exportPurchaseOrderExcel('${fileNo}')">📋 Excel PO</button>
    </div>
  `;

  // Reset tabs
  switchTab(0);
  loadViewerTab(0);
  navActive('');
  // Show quick expense FAB
  const fab = el('quickExpFab');
  if (fab && can('transactions')) fab.style.display = 'flex';
}

function switchTab(idx) {
  state.currentTab = idx;
  document.querySelectorAll('.tabs .tab').forEach((t,i) => t.classList.toggle('active', i === idx));
  document.querySelectorAll('.tab-content').forEach((c,i) => c.classList.toggle('active', i === idx));
  loadViewerTab(idx);
}

async function loadViewerTab(idx) {
  const fn = state.currentFileNo;
  const sys = state.system;
  if (!fn) return;

  if (idx === 0) await loadSummaryTab(fn, sys);
  loadViewerKpis(fn, sys);
  if (idx === 1) await loadVehiclesTab(fn, sys);
  if (idx === 2) await loadPaymentsTab(fn, sys);
  if (idx === 3) await loadExpensesTab(fn, sys);
  if (idx === 4) await loadSalesTab(fn, sys);
  if (idx === 5) await loadCollectionsTab(fn, sys);
  if (idx === 6) await loadPayoutsTab(fn, sys);
  if (idx === 7) await loadDealStatement(fn, sys);
  if (idx === 8) await loadDealNotes();
}

async function loadSummaryTab(fn, sys) {
  try {
    const [vehicles, payments, expenses, sales, collections, partners, payouts, poArr] = await Promise.all([
      apiGetAll('vehicles',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGetAll('payments',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGetAll('expenses',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGetAll('sales',           { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGetAll('collections',     { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGetAll('partners_master', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGetAll('partner_payouts', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGetAll('purchase_orders', { select:'total_purchase,supplier', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
    ]);

    state.currentVehicles = vehicles || [];
    state.currentSales    = sales    || [];

    const totalPurchase  = +(poArr?.[0]?.total_purchase) || (vehicles||[]).reduce((s,v)=>s+(+v.purchase_price||0),0);

    // فصل posted من draft — null يُعامَل كـ posted (بيانات قديمة)
    const postedPay  = (payments||[]).filter(isPosted);
    const postedExp  = (expenses||[]).filter(isPosted);
    const postedSal  = (sales||[]).filter(isPosted);
    const postedCol  = (collections||[]).filter(isPosted);
    const postedPout = (payouts||[]).filter(isPosted);
    const draftCount = (payments||[]).filter(isDraft).length +
                       (expenses||[]).filter(isDraft).length +
                       (sales||[]).filter(isDraft).length +
                       (collections||[]).filter(isDraft).length +
                       (payouts||[]).filter(isDraft).length;

    const totalPaid      = postedPay.reduce((s,p)=>s+(+p.amount||0),0);
    const totalExp       = postedExp.reduce((s,e)=>s+(+e.amount||0),0);
    // ✅ المصدر الوحيد للحقيقة: collections.amount يشمل الفاتورة كاملة (سيارات + extra charges)
    // totalSales من جدول sales لا يشمل extra charges → نستخدمه للربحية فقط
    const totalSalesRaw  = postedSal.reduce((s,s2)=>s+(+s2.sale_price||0),0);
    const totalCollected = postedCol.filter(c => c.paid_date && c.post_status !== 'voided').reduce((s,c)=>s+(+c.amount||0),0);
    const totalPending   = postedCol.filter(c => !c.paid_date && c.post_status !== 'voided').reduce((s,c)=>s+(+c.amount||0),0);
    // إجمالي الفواتير الحقيقي = collections (شامل extra) — إذا لا يوجد collection نسقط على sales
    const totalInvoiced  = postedCol.length > 0
      ? postedCol.filter(c => c.post_status !== 'voided').reduce((s,c)=>s+(+c.amount||0),0)
      : totalSalesRaw;
    const totalSales     = totalInvoiced; // للعرض والربحية
    const totalPayouts   = postedPout.reduce((s,p)=>s+(+p.amount||0),0);
    const fullCost       = totalPurchase + totalExp;
    const profit         = totalSales - fullCost;
    const remaining      = totalPurchase - totalPaid;
    // المستحق = التحصيلات المسجلة غير المدفوعة بعد (يشمل المصاريف المضافة على الفاتورة)
    const uncollected    = totalPending;
    const soldVins       = new Set(postedSal.map(s=>s.vin));
    const draftSoldVins  = new Set((sales||[]).filter(isDraft).map(s=>s.vin));
    const totalV         = (vehicles||[]).length;
    const soldV          = soldVins.size;
    const unsoldV        = totalV - soldV - draftSoldVins.size;
    const sellPct        = totalV > 0 ? Math.round(soldV/totalV*100) : 0;
    const margin         = totalSales > 0 ? Math.round(profit/totalSales*100) : 0;
    const draftBanner    = draftCount > 0 ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:var(--radius-sm);padding:8px 14px;margin-bottom:12px;font-size:12px;color:#92400e;display:flex;align-items:center;gap:8px">⏳ <strong>${draftCount} عملية معلقة</strong> لم تُرحَّل بعد — الأرقام تعكس المرحَّل فقط &nbsp;<a onclick="showApprovalQueue()" href="javascript:void(0)" style="color:#92400e;font-weight:700;text-decoration:underline">راجعها</a></div>` : '';

    // ── KPI Strip ──
    el('sum-financial').innerHTML = draftBanner + `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px">
          <div style="font-size:11px;color:var(--text2);margin-bottom:4px">تكلفة الشراء</div>
          <div style="font-size:20px;font-weight:700;color:var(--blue)">${fmt(totalPurchase)}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">+ ${fmt(totalExp)} مصاريف</div>
        </div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px">
          <div style="font-size:11px;color:var(--text2);margin-bottom:4px">المبيعات</div>
          <div style="font-size:20px;font-weight:700;color:var(--green)">${fmt(totalSales)}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">${soldV} سيارة مباعة</div>
        </div>
        <div style="background:var(--card);border:1px solid ${profit>=0?'var(--green)':'var(--red)'};border-radius:var(--radius);padding:14px 16px">
          <div style="font-size:11px;color:var(--text2);margin-bottom:4px">صافي الربح</div>
          <div style="font-size:20px;font-weight:700;color:${profit>=0?'var(--green)':'var(--red)'}">${fmt(Math.abs(profit))}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">${profit>=0?'ربح':'خسارة'} · هامش ${margin}%</div>
        </div>
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px">
          <div style="font-size:11px;color:var(--text2);margin-bottom:4px">غير محصّل</div>
          <div style="font-size:20px;font-weight:700;color:${uncollected>0?'var(--accent)':'var(--green)'}">${fmt(uncollected)}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px">${uncollected>0?`فواتير مستحقة من العملاء`:'✓ كل شيء محصّل'}</div>
        </div>
      </div>

      <!-- Two cols -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">

        <!-- المالية -->
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px">
          <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:6px">💰 المالية</div>
          ${summRow('تكلفة الشراء','text-blue',fmt(totalPurchase))}
          ${summRow('المصاريف','text-red',fmt(totalExp))}
          ${summRow('التكلفة الكاملة','',fmt(fullCost),true)}
          <hr style="border:none;border-top:1px solid var(--border);margin:6px 0">
          ${summRow('المبيعات','text-green',fmt(totalSales))}
          ${summRow('مقبوض فعلاً','text-green',fmt(totalCollected))}
          ${totalPending > 0 ? summRow('⏳ منتظر تحصيل','text-amber',fmt(totalPending)) : ''}
          ${summRow('متبقي غير محصّل',uncollected>0?'text-amber':'text-green',fmt(uncollected))}
          <hr style="border:none;border-top:1px solid var(--border);margin:6px 0">
          <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:14px;font-weight:700">
            <span>الربح الصافي</span>
            <span style="color:${profit>=0?'var(--green)':'var(--red)'}">${fmt(Math.abs(profit))} ${profit>=0?'✓':'↓'}</span>
          </div>
        </div>

        <!-- المورد + السيارات -->
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px">
          <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border)">🏭 المورد</div>
          ${summRow('قيمة الصفقة','',fmt(totalPurchase))}
          ${summRow('المدفوع','text-green',fmt(totalPaid))}
          ${summRow('المتبقي',remaining>0?'text-red':'text-green',fmt(remaining) + (remaining<=0?' ✓':''))}
          <hr style="border:none;border-top:1px solid var(--border);margin:10px 0">
          <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px">🚗 السيارات</div>
          ${summRow('الإجمالي','',totalV)}
          ${summRow('مباع','text-green',soldV)}
          ${summRow('في المخزن',unsoldV>0?'text-amber':'',unsoldV)}
          <div style="margin-top:8px">
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2);margin-bottom:4px"><span>نسبة البيع</span><span>${sellPct}%</span></div>
            <div style="height:6px;background:var(--card2);border-radius:10px;overflow:hidden">
              <div style="width:${sellPct}%;height:100%;background:var(--green);border-radius:10px;transition:width .5s"></div>
            </div>
          </div>
        </div>
      </div>`;

    // ── Partners ──
    const partnerColors = [
      {bg:'var(--blue-dim)',   color:'var(--blue)'},
      {bg:'var(--accent-dim)',color:'var(--accent)'},
      {bg:'var(--green-dim)', color:'var(--green)'},
      {bg:'var(--purple-dim)',color:'var(--purple)'},
      {bg:'var(--cyan-dim)',  color:'var(--cyan)'},
    ];

    const partnersHtml = (partners||[]).map((p,i) => {
      const share     = +p.share_percent || 0;
      const pAmt      = profit * (share/100);   // حصته في الربح/الخسارة
      // ما دفعه للمورد في هذه الصفقة (posted فقط)
      const capitalIn = (payments||[]).filter(px=>isPosted(px)&&px.payer===p.partner).reduce((s,px)=>s+(+px.amount||0),0);
      // حصته في تكلفة الشراء (ما عليه)
      const liability = totalPurchase * (share/100);
      // المديونية المتبقية = ما عليه - ما دفعه (لو صفر أو أقل = سوّى)
      const remainingLiab = Math.max(liability - capitalIn, 0);
      // ما استرده من أرباح
      const pPayouts  = (payouts||[]).filter(px=>isPosted(px)&&px.partner===p.partner);
      const totalOut  = pPayouts.reduce((s,px)=>s+(+px.amount||0),0);
      // الرصيد الصافي = حصة ربح - مديونية متبقية - ما استرد
      const netDue    = pAmt - remainingLiab - totalOut;
      const c         = partnerColors[i % partnerColors.length];
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer"
          onclick="showPartnerDealStatement('${fn}','${p.partner}','${sys}')"
          onmouseover="this.style.background='var(--card2)'" onmouseout="this.style.background=''">
          <div style="width:36px;height:36px;border-radius:50%;background:${c.bg};color:${c.color};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0">
            ${p.partner[0]}
          </div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600;margin-bottom:4px">
              ${p.partner}
              <span style="font-size:10px;padding:2px 7px;border-radius:10px;background:${c.bg};color:${c.color};margin-right:4px">${share}%</span>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--card2);color:var(--text2)">حصة التكلفة: <strong style="color:var(--blue)">${fmt(liability)}</strong></span>
              <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--card2);color:var(--text2)">دفع: <strong style="color:var(--accent)">${fmt(capitalIn)}</strong></span>
              ${remainingLiab > 0.01 ? `<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:#fef3c7;color:#92400e">⚠️ عليه: <strong>${fmt(remainingLiab)}</strong></span>` : `<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--green-dim);color:var(--green)">✅ سوّى</span>`}
              <span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--card2);color:var(--text2)">ربح: <strong style="color:${pAmt>=0?'var(--green)':'var(--red)'}">${fmt(pAmt)}</strong></span>
              ${totalOut > 0 ? `<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--card2);color:var(--text2)">سُحب: <strong style="color:var(--amber)">${fmt(totalOut)}</strong></span>` : ''}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
            <div style="text-align:left">
              <div style="font-size:15px;font-weight:700;color:${netDue>=0?'var(--green)':'var(--red)'}">${fmt(Math.abs(netDue))}</div>
              <div style="font-size:10px;color:var(--text2)">${netDue>=0?'مستحق له':'مدين عليه'}</div>
            </div>
            <div style="display:flex;gap:4px">
              <button onclick="event.stopPropagation();showPartnerStatement('${p.partner}','${fn}')"
                style="background:var(--accent-dim);color:var(--accent);border:1px solid var(--accent);border-radius:6px;padding:3px 8px;font-size:10px;font-weight:700;cursor:pointer;font-family:'Cairo',sans-serif">
                📋 هذه الصفقة
              </button>
              <button onclick="event.stopPropagation();showPartnerStatement('${p.partner}')"
                style="background:var(--purple-dim);color:var(--purple);border:1px solid var(--purple);border-radius:6px;padding:3px 8px;font-size:10px;font-weight:700;cursor:pointer;font-family:'Cairo',sans-serif">
                📊 كل الصفقات
              </button>
              <button onclick="event.stopPropagation();openPartnerAccountLedger('${p.partner}')"
                style="background:var(--blue-dim);color:var(--blue);border:1px solid var(--blue);border-radius:6px;padding:3px 8px;font-size:10px;font-weight:700;cursor:pointer;font-family:'Cairo',sans-serif">
                📒 جاري الشريك
              </button>
            </div>
          </div>
        </div>`;
    }).join('');

    el('sum-partners').innerHTML = `
      <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border)">👥 الشركاء</div>
      ${partnersHtml || '<div style="color:var(--text2);padding:8px;font-size:13px">لا يوجد شركاء</div>'}`;

    el('sum-vehicles').innerHTML = '';
    el('sum-payments').innerHTML = '';

  } catch(e) { console.error('Summary error:', e); el('sum-financial').innerHTML = errHTML('خطأ في تحميل الملخص: ' + e.message); }
}

function summRow(label, cls, val, bold=false) {
  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px">
    <span style="color:var(--text2)">${label}</span>
    <span class="${cls}" style="${bold?'font-weight:700':''}${cls?'':';color:var(--text)'}">${val}</span>
  </div>`;
}

async function loadVehiclesTab(fn, sys) {
  try {
    const data = await apiGetAll('vehicles', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` });
    state.currentVehicles = data || [];
    const soldVins = new Set((state.currentSales||[]).map(s=>s.vin));

    if (!data?.length) { el('vehiclesTable').innerHTML = emptyHTML('🚗','لا توجد سيارات'); return; }
    el('vehiclesTable').innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>الكود</th><th>VIN</th><th>النوع</th><th>الموديل</th>
          <th>السنة</th><th>اللوحة</th><th>اللون</th><th>الحجم</th>
          <th>سعر الشراء</th><th>انتهاء الرخصة</th><th>الحالة</th><th></th>
        </tr></thead>
        <tbody>${data.map((v,i)=>{
          const code = `${fn}-V${String(i+1).padStart(2,'0')}`;
          const expired = v.license_expiry && new Date(v.license_expiry) < new Date();
          return `<tr>
            <td><span class="mono text-amber" style="font-size:11px">${code}</span></td>
            <td><span class="mono" style="direction:ltr;font-size:11px">${v.vin||'—'}</span></td>
            <td>${v.vehicle_type||'—'}</td>
            <td>${v.model||'—'}</td>
            <td>${v.year||'—'}</td>
            <td><span class="mono" style="direction:ltr">${v.plate||'—'}</span></td>
            <td>${v.color||'—'}</td>
            <td>${v.engine_size||'—'}</td>
            <td class="mono text-blue">${fmt(v.purchase_price)}</td>
            <td class="${expired?'text-red':'text-muted'}">${v.license_expiry||'—'}</td>
            <td><span class="badge ${soldVins.has(v.vin)?'badge-closed':'badge-open'}">${soldVins.has(v.vin)?'مباع':'في المخزن'}</span></td>
            <td><button class="btn btn-secondary btn-sm" onclick="openEditVehicleModal(${v.id})">✏️</button></td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>`;
  } catch(e) { el('vehiclesTable').innerHTML = errHTML(e.message); }
}

async function loadPaymentsTab(fn, sys) {
  try {
    const data = await apiGetAll('payments', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'pay_date.asc,id.asc' });
    if (!data?.length) { el('paymentsTable').innerHTML = emptyHTML('💳','لا توجد دفعات'); return; }
    const total = data.reduce((s,p)=>s+(+p.amount||0),0);

    // كشف الدفعات المشبوهة (نفس المبلغ ونفس الدافع في نفس اليوم أو متقاربة)
    const dupKeys = new Set();
    const keyCount = {};
    data.forEach(p => {
      const k = `${p.amount}__${p.payer}__${p.pay_date}`;
      keyCount[k] = (keyCount[k]||0) + 1;
    });
    data.forEach(p => {
      const k = `${p.amount}__${p.payer}__${p.pay_date}`;
      if (keyCount[k] > 1) dupKeys.add(p.id);
    });

    const csvRows = data.map(p=>[p.ref_no||'—', p.payer||'—', +p.amount||0, p.pay_method||'—', p.document||'—', p.pay_date||'—', p.notes||'']);
    const csvHeaders = ['رقم الدفعة','الدافع','المبلغ','طريقة الدفع','المستند','التاريخ','ملاحظات'];

    const dupWarning = dupKeys.size > 0
      ? `<div style="background:var(--red-dim);border:1px solid var(--red);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:10px;font-size:12px;color:var(--red);display:flex;align-items:center;gap:8px">
          <span style="font-size:16px">⚠️</span>
          <span>يوجد <strong>${dupKeys.size}</strong> دفعة مشبوهة بنفس المبلغ والدافع والتاريخ — مُعلَّمة بالأحمر</span>
         </div>`
      : '';

    el('paymentsTable').innerHTML = `
      ${dupWarning}
      ${exportBtns(
        `exportCSV(${JSON.stringify(csvHeaders)},${JSON.stringify(csvRows)},'دفعات_${fn}')`,
        `printSection('دفعات المورد','ملف: ${fn}',document.querySelector('#tab-2 table')?.outerHTML||'')`
      )}
      <table class="data-table">
        <thead><tr>
          <th style="width:36px;text-align:center">#</th>
          <th>رقم الدفعة</th><th>الدافع</th><th>المبلغ</th><th>طريقة الدفع</th>
          <th>المستند</th><th>التاريخ</th><th>ملاحظات</th><th></th>
        </tr></thead>
        <tbody>
          ${data.map((p,i)=>{
            const isDup = dupKeys.has(p.id);
            const rowStyle = isDup ? 'background:var(--red-dim);' : '';
            const dupBadge = isDup ? '<span style="font-size:9px;background:var(--red);color:#fff;padding:1px 5px;border-radius:4px;font-weight:700;margin-right:4px">مكرر؟</span>' : '';
            const isVoided = p.post_status === 'voided';
            const voidedBadge = isVoided ? '<span style="font-size:9px;background:var(--text2);color:#fff;padding:1px 5px;border-radius:4px;font-weight:700;margin-right:4px">ملغى</span>' : '';
            const trStyle = isVoided ? 'opacity:.55;' : (isDup ? 'background:var(--red-dim);' : '');
            return `<tr style="${trStyle}">
              <td style="text-align:center;font-size:11px;color:var(--text3);font-weight:700">${i+1}</td>
              <td class="mono" style="color:var(--cyan);font-weight:700;font-size:11px">${p.ref_no||'—'} ${voidedBadge}</td>
              <td>${p.payer||'—'}</td>
              <td class="mono text-blue" style="${isVoided?'text-decoration:line-through;':''}">${fmt(p.amount)} ${dupBadge}</td>
              <td>${p.pay_method||'—'}</td>
              <td class="mono">${p.document||'—'}</td>
              <td class="mono">${fmtDate(p.pay_date)}</td>
              <td class="text-muted" style="font-size:11px">${p.notes||''}</td>
              <td style="white-space:nowrap;display:flex;gap:4px">
                ${!isVoided ? `<button class="btn btn-secondary btn-sm" onclick="openEditPaymentModal(${p.id})" title="تعديل">✏️</button>` : ''}
                ${!isVoided ? `<button class="btn btn-sm" onclick="deletePaymentEntry(${p.id},'${fn}')"
                  style="background:var(--red-dim);color:var(--red);border:1px solid var(--red)" title="إلغاء بقيد عكسي">🔄 إلغاء</button>` : ''}
              </td>
            </tr>`;
          }).join('')}
          <tr style="background:var(--card2);font-weight:700">
            <td colspan="3" style="padding:10px 16px">الإجمالي (${data.length} دفعة)</td>
            <td class="mono text-blue" style="padding:10px 16px">${fmt(total)}</td>
            <td colspan="5"></td>
          </tr>
        </tbody>
      </table>`;
  } catch(e) { el('paymentsTable').innerHTML = errHTML(e.message); }
}

async function loadExpensesTab(fn, sys) {
  try {
    const data = await apiGetAll('expenses', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'exp_date.asc,id.asc' });
    if (!data?.length) { el('expensesTable').innerHTML = emptyHTML('💸','لا توجد مصاريف'); return; }
    const total = data.reduce((s,e)=>s+(+e.amount||0),0);

    // كشف المصاريف المشبوهة
    const dupKeyCount = {};
    data.forEach(e => { const k=`${e.amount}__${e.description}__${e.exp_date}`; dupKeyCount[k]=(dupKeyCount[k]||0)+1; });
    const dupIds = new Set(data.filter(e=>dupKeyCount[`${e.amount}__${e.description}__${e.exp_date}`]>1).map(e=>e.id));
    const dupWarning = dupIds.size ? `<div style="background:var(--red-dim);border:1px solid var(--red);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:10px;font-size:12px;color:var(--red);display:flex;align-items:center;gap:8px">⚠️ <span>يوجد <strong>${dupIds.size}</strong> مصروف مشبوه بنفس المبلغ والبيان والتاريخ — مُعلَّم بالأحمر</span></div>` : '';

    const csvRows = data.map(e=>[e.ref_no||'—', e.description||'—', e.exp_type||'—', +e.amount||0, e.pay_method||'—', e.document||'—', e.exp_date||'—']);
    const csvHeaders = ['رقم المصروف','الوصف','النوع','المبلغ','طريقة الدفع','المستند','التاريخ'];
    el('expensesTable').innerHTML = `
      ${dupWarning}
      ${exportBtns(
        `exportCSV(${JSON.stringify(csvHeaders)},${JSON.stringify(csvRows)},'مصاريف_${fn}')`,
        `printSection('المصاريف','ملف: ${fn}',document.querySelector('#tab-3 table')?.outerHTML||'')`
      )}
      <table class="data-table">
        <thead><tr>
          <th style="width:36px;text-align:center">#</th>
          <th>رقم المصروف</th><th>الوصف</th><th>النوع</th><th>المبلغ</th>
          <th>طريقة الدفع</th><th>المستند</th><th>التاريخ</th><th></th>
        </tr></thead>
        <tbody>
          ${data.map((e,i)=>{
            const isDup = dupIds.has(e.id);
            const dupBadge = isDup ? '<span style="font-size:9px;background:var(--red);color:#fff;padding:1px 5px;border-radius:4px;font-weight:700;margin-right:4px">مكرر؟</span>' : '';
            const isVoidedE = e.post_status === 'voided';
            const voidedBadgeE = isVoidedE ? '<span style="font-size:9px;background:var(--text2);color:#fff;padding:1px 5px;border-radius:4px;font-weight:700;margin-right:4px">ملغى</span>' : '';
            return `<tr style="${isVoidedE?'opacity:.55;':(isDup?'background:var(--red-dim);':'')}">
              <td style="text-align:center;font-size:11px;color:var(--text3);font-weight:700">${i+1}</td>
              <td class="mono" style="color:var(--red);font-weight:700;font-size:11px">${e.ref_no||'—'} ${voidedBadgeE}</td>
              <td>${e.description||'—'}</td>
              <td><span class="chip">${e.exp_type||'—'}</span></td>
              <td class="mono text-red" style="${isVoidedE?'text-decoration:line-through;':''}">${fmt(e.amount)} ${dupBadge}</td>
              <td>${e.pay_method||'—'}</td>
              <td class="mono">${e.document||'—'}</td>
              <td class="mono">${fmtDate(e.exp_date)}</td>
              <td style="white-space:nowrap;display:flex;gap:4px">
                ${!isVoidedE ? `<button class="btn btn-secondary btn-sm" onclick="openEditExpenseModal(${e.id})" title="تعديل">✏️</button>` : ''}
                ${!isVoidedE ? `<button class="btn btn-sm" onclick="deleteExpenseEntry(${e.id},'${fn}')"
                  style="background:var(--red-dim);color:var(--red);border:1px solid var(--red)" title="إلغاء بقيد عكسي">🔄 إلغاء</button>` : ''}
              </td>
            </tr>`;
          }).join('')}
          <tr style="background:var(--card2);font-weight:700">
            <td colspan="4" style="padding:10px 16px">الإجمالي (${data.length} مصروف)</td>
            <td class="mono text-red" style="padding:10px 16px">${fmt(total)}</td>
            <td colspan="4"></td>
          </tr>
        </tbody>
      </table>`;
  } catch(e) { el('expensesTable').innerHTML = errHTML(e.message); }
}

async function loadSalesTab(fn, sys) {
  try {
    const data = await apiGetAll('sales', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'sale_date.desc' });
    state.currentSales = data || [];
    if (!data?.length) { el('salesTable').innerHTML = emptyHTML('🤝','لا توجد مبيعات'); return; }
    const total = data.reduce((s,v)=>s+(+v.sale_price||0),0);

    // Group by invoice number
    const invoices = {};
    (data||[]).forEach(s => {
      const k = s.inv_no || '__no_inv__';
      if (!invoices[k]) invoices[k] = { inv_no:s.inv_no, customer:s.customer, date:s.sale_date, fn:s.file_no, notes:s.notes, items:[] };
      invoices[k].items.push(s);
    });

    const rows = Object.values(invoices).map(inv => {
      const invTotal = inv.items.reduce((s,i)=>s+(+i.sale_price||0),0);
      const vins = inv.items.map(i=>i.vin||'—').join('، ');
      return `<tr>
        <td>
          <div class="mono text-amber" style="font-weight:700">${inv.inv_no||'—'}</div>
          <div style="font-size:11px;color:var(--text2)">${fmtDate(inv.date)}</div>
        </td>
        <td>
          <div style="font-weight:600">${inv.customer||'—'}</div>
        </td>
        <td style="font-size:12px;direction:ltr">${vins}</td>
        <td style="text-align:center">${inv.items.length}</td>
        <td class="mono text-green" style="font-weight:700">${fmt(invTotal)}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="reprintInvoice('${inv.inv_no}','${fn}')">🖨️ طباعة</button>
          <button class="btn btn-secondary btn-sm" onclick="deleteSaleInvoice('${inv.inv_no}','${fn}')" style="color:var(--red)">🗑 حذف</button>
          <button class="btn btn-secondary btn-sm" onclick="sendWhatsappInvoice({invNo:'${inv.inv_no}',customer:'${(inv.customer||'').replace(/'/g,"\\'")}',date:'${inv.sale_date||''}',items:${JSON.stringify(inv._items||[])},total:${inv._total||0},phone:''})" style="background:rgba(37,211,102,.1);border-color:#25d366;color:#25d366">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:middle;margin-left:3px"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.135.558 4.14 1.535 5.878L.057 23.943l6.235-1.635A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.001-1.366l-.36-.214-3.7.971.988-3.608-.236-.372A9.818 9.818 0 0112 2.182c5.42 0 9.818 4.398 9.818 9.818 0 5.42-4.398 9.818-9.818 9.818z"/></svg>
            واتساب
          </button>
        </td>
      </tr>`;
    }).join('');

    el('salesTable').innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>رقم الفاتورة</th><th>العميل</th><th>VINs</th>
          <th style="text-align:center">عدد السيارات</th><th>الإجمالي</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot style="background:var(--card2)">
          <tr><td colspan="4" style="padding:10px 16px;font-weight:700">الإجمالي الكلي</td>
          <td class="mono text-green" style="padding:10px 16px;font-weight:700">${fmt(total)}</td><td></td></tr>
        </tfoot>
      </table>`;
  } catch(e) { el('salesTable').innerHTML = errHTML(e.message); }
}

async function reprintInvoice(invNo, fn) {
  try {
    // جيب بيانات الفاتورة — من الـ cache أو fresh fetch
    await ensureCache();
    let data = state.allSales.filter(s => s.file_no === fn && s.inv_no === invNo);
    if (!data.length) {
      // fallback: fresh fetch لو مش في الـ cache
      data = await apiGetAll('sales', { select:'*', system_type:`eq.${state.system}`, file_no:`eq.${fn}`, inv_no:`eq.${invNo}` });
    }
    if (!data?.length) { toast('لم يتم إيجاد بيانات الفاتورة','err'); return; }
    const s = data[0];

    // جيب بيانات السيارات من الـ cache
    const vehicles = state.allVehicles.filter(v => v.file_no === fn);

    const items = data.map(d => {
      const v = vehicles.find(v => v.vin === d.vin);
      return {
        vin:           d.vin||'',
        model:         v?.model||v?.vehicle_type||'',
        plate:         v?.plate||'',
        color:         v?.color||'',
        engine:        v?.engine_size||'',
        year:          v?.year||'',
        price:         +d.sale_price||0,
        vnote:         d.notes||'',
        purchasePrice: +v?.purchase_price||0,
      };
    });

    printSaleInvoice({
      invNo, customer: s.customer, date: s.sale_date,
      fn, notes: s.notes||'',
      items, total: items.reduce((t,i)=>t+i.price,0)
    });
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

async function deleteSaleInvoice(invNo, fileNo) {
  showConfirm(
    `حذف فاتورة ${invNo}`,
    `سيتم حذف الفاتورة وجميع التحصيلات المرتبطة بها نهائياً. لا يمكن التراجع.`,
    async () => {
      try {
        await apiDelete('sales', { system_type:`eq.${state.system}`, file_no:`eq.${fileNo}`, inv_no:`eq.${invNo}` });
        try { await apiDelete('collections', { system_type:`eq.${state.system}`, inv_no:`eq.${invNo}` }); } catch(e) { console.warn('deleteSale cleanup collections:', e.message); }
        // تحديث حالة الصفقة
        try {
          const allV = await apiGetAll('vehicles', { select:'vin', system_type:`eq.${state.system}`, file_no:`eq.${fileNo}` });
          const allS = await apiGetAll('sales', { select:'vin', system_type:`eq.${state.system}`, file_no:`eq.${fileNo}` });
          const soldSet = new Set((allS||[]).map(s=>s.vin));
          const hasAnySales = (allS||[]).length > 0;
          const allSold = hasAnySales && (allV||[]).every(v=>soldSet.has(v.vin));
          await apiPatch('purchase_orders',
            { system_type:`eq.${state.system}`, file_no:`eq.${fileNo}` },
            { status: !hasAnySales ? 'OPEN' : (allSold ? 'CLOSED' : 'IN PROGRESS') }
          );
        } catch(e) { console.warn('updateDealStatus after delete:', e.message); }
        invalidateCache();
        toast(`✅ تم حذف فاتورة ${invNo}`, 'ok');
        await loadSalesTab(fileNo, state.system);
        if (state.currentTab === 5) loadCollectionsTab(fileNo, state.system);
        if (state.currentTab === 0) loadSummaryTab(fileNo, state.system);
      } catch(e) { toast('خطأ: ' + e.message, 'err'); }
    }
  );
}

function printSaleInvoice({ invNo, customer, date, fn, notes, items, total, extraCharges = [], grandTotal = null }) {
  const companyName = 'Transit Co.';
  const companyNameAr = 'ترانزيت';
  const companyAddress = 'Kuwait · الكويت';
  const finalTotal = grandTotal != null ? grandTotal : total;

  const itemsHtml = items.map((item, i) => `
    <tr>
      <td style="text-align:center">${i+1}</td>
      <td>
        <div style="font-weight:600">${item.model||'—'}</div>
        <div style="font-size:11px;color:#666">${item.color||''}${item.year?' · '+item.year:''}</div>
      </td>
      <td style="direction:ltr;text-align:center;font-family:monospace;font-size:12px">${item.vin||'—'}</td>
      <td style="direction:ltr;text-align:center;font-family:monospace">${item.plate||'—'}</td>
      <td style="text-align:center">${item.engine?item.engine+' L':'—'}</td>
      <td style="text-align:left;font-weight:600">${item.price.toLocaleString('en-US',{minimumFractionDigits:2})}</td>
    </tr>`).join('');

  // صف المجموع الفرعي للسيارات (فقط إذا في مصاريف إضافية)
  const subtotalRow = extraCharges.length > 0 ? `
    <tr style="background:#f0f0f0;font-weight:600">
      <td colspan="5" style="text-align:right;padding:8px 12px;color:#555">مجموع السيارات / Vehicles Subtotal</td>
      <td style="text-align:left;padding:8px 12px">${total.toLocaleString('en-US',{minimumFractionDigits:2})}</td>
    </tr>` : '';

  // بنود المصاريف الإضافية
  const extraRowsHtml = extraCharges.map((c, i) => `
    <tr style="background:#fff8ec">
      <td style="text-align:center;color:#c47a00;font-size:11px">+</td>
      <td colspan="4" style="color:#c47a00;font-weight:600;padding:8px 12px">
        ${c.desc}
        <span style="font-size:10px;background:#fef3c7;color:#92400e;padding:1px 7px;border-radius:10px;margin-right:8px;font-weight:700">مصروف إضافي</span>
      </td>
      <td style="text-align:left;font-weight:600;color:#c47a00;padding:8px 12px">${c.amount.toLocaleString('en-US',{minimumFractionDigits:2})}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>فاتورة ${invNo}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color:#1a1a1a; font-size:13px; background:#fff; }
  .page { max-width:800px; margin:0 auto; padding:32px 36px; }

  /* Header */
  .inv-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:28px; padding-bottom:20px; border-bottom:3px solid #1a1a1a; }
  .logo-area { text-align:right; }
  .logo-placeholder { width:120px; height:60px; border:2px dashed #ccc; border-radius:8px; display:flex; align-items:center; justify-content:center; color:#aaa; font-size:11px; margin-bottom:6px; }
  .company-name { font-size:22px; font-weight:800; color:#1a1a1a; }
  .company-name-ar { font-size:14px; color:#555; margin-top:2px; }
  .inv-title-area { text-align:left; }
  .inv-title { font-size:28px; font-weight:800; color:#1a1a1a; letter-spacing:-0.5px; }
  .inv-title-ar { font-size:16px; color:#555; margin-top:4px; }
  .inv-number { font-size:16px; font-weight:700; margin-top:8px; color:#c47a00; }

  /* Info boxes */
  .inv-info { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:24px; }
  .info-box { background:#f8f9fa; border-radius:8px; padding:14px 16px; }
  .info-box-title { font-size:10px; font-weight:700; color:#888; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px; }
  .info-row { display:flex; justify-content:space-between; padding:3px 0; font-size:13px; }
  .info-label { color:#666; }
  .info-value { font-weight:600; color:#1a1a1a; }

  /* Table */
  table { width:100%; border-collapse:collapse; margin-bottom:20px; }
  thead tr { background:#1a1a1a; color:#fff; }
  thead th { padding:10px 12px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; }
  tbody tr { border-bottom:1px solid #eee; }
  tbody tr:nth-child(even):not(.extra-row):not(.subtotal-row) { background:#fafafa; }
  tbody td { padding:10px 12px; vertical-align:middle; }

  /* Total */
  .total-section { display:flex; justify-content:flex-end; margin-bottom:24px; }
  .total-box { background:#1a1a1a; color:#fff; border-radius:10px; padding:16px 24px; min-width:260px; }
  .total-label { font-size:12px; color:#aaa; margin-bottom:4px; }
  .total-amount { font-size:24px; font-weight:800; color:#fff; }
  .total-currency { font-size:13px; color:#aaa; margin-top:2px; }
  .total-sub-row { display:flex; justify-content:space-between; font-size:12px; color:#aaa; padding:3px 0; border-top:1px solid #444; margin-top:8px; padding-top:8px; }

  /* Notes */
  .notes-section { background:#f8f9fa; border-radius:8px; padding:14px 16px; margin-bottom:24px; }
  .notes-title { font-size:11px; font-weight:700; color:#888; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px; }

  /* Footer */
  .inv-footer { text-align:center; padding-top:20px; border-top:1px solid #eee; color:#999; font-size:11px; }

  /* Signature area */
  .sig-area { display:grid; grid-template-columns:1fr 1fr; gap:40px; margin-bottom:24px; }
  .sig-box { text-align:center; padding-top:40px; border-top:1px solid #ccc; }
  .sig-label { font-size:11px; color:#888; margin-top:6px; }

  @media print {
    body { print-color-adjust:exact; -webkit-print-color-adjust:exact; }
    .page { padding:20px; }
    .no-print { display:none !important; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Print button -->
  <div class="no-print" style="text-align:center;margin-bottom:20px;display:flex;gap:10px;justify-content:center">
    <button onclick="window.print()" style="background:#1a1a1a;color:#fff;border:none;padding:10px 28px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer">🖨️ طباعة / Print</button>
    <button onclick="window.close()" style="background:#f1f1f1;color:#333;border:1px solid #ddd;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer">✕ إغلاق</button>
  </div>

  <!-- Header -->
  <div class="inv-header">
    <div class="logo-area">
      <div class="logo-placeholder">LOGO</div>
      <div class="company-name">${companyName}</div>
      <div class="company-name-ar">${companyNameAr}</div>
      <div style="font-size:11px;color:#888;margin-top:4px">${companyAddress}</div>
    </div>
    <div class="inv-title-area">
      <div class="inv-title">INVOICE</div>
      <div class="inv-title-ar">فاتورة بيع</div>
      <div class="inv-number"># ${invNo}</div>
    </div>
  </div>

  <!-- Info -->
  <div class="inv-info">
    <div class="info-box">
      <div class="info-box-title">بيانات العميل / Bill To</div>
      <div class="info-row">
        <span class="info-label">العميل / Customer</span>
        <span class="info-value">${customer}</span>
      </div>
      <div class="info-row">
        <span class="info-label">رقم الملف / File No</span>
        <span class="info-value">${fn||'—'}</span>
      </div>
    </div>
    <div class="info-box">
      <div class="info-box-title">بيانات الفاتورة / Invoice Details</div>
      <div class="info-row">
        <span class="info-label">رقم الفاتورة / No</span>
        <span class="info-value" style="color:#c47a00">${invNo}</span>
      </div>
      <div class="info-row">
        <span class="info-label">التاريخ / Date</span>
        <span class="info-value">${new Date(date).toLocaleDateString('en-GB',{year:'numeric',month:'long',day:'numeric'})}</span>
      </div>
      <div class="info-row">
        <span class="info-label">عدد السيارات / Vehicles</span>
        <span class="info-value">${items.length}</span>
      </div>
      ${extraCharges.length>0 ? `<div class="info-row">
        <span class="info-label">مصاريف إضافية</span>
        <span class="info-value" style="color:#c47a00">${extraCharges.length} بند</span>
      </div>` : ''}
    </div>
  </div>

  <!-- Items table -->
  <table>
    <thead>
      <tr>
        <th style="width:40px">#</th>
        <th>السيارة / Vehicle</th>
        <th>رقم الشاصي / VIN</th>
        <th>اللوحة / Plate</th>
        <th>الحجم / Engine</th>
        <th style="text-align:left">السعر / Price</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
      ${subtotalRow}
      ${extraRowsHtml}
    </tbody>
  </table>

  <!-- Total -->
  <div class="total-section">
    <div class="total-box">
      <div class="total-label">الإجمالي / Total Amount</div>
      <div class="total-amount">${finalTotal.toLocaleString('en-US',{minimumFractionDigits:2})}</div>
      <div class="total-currency">KWD / د.ك</div>
      ${extraCharges.length>0 ? `
      <div class="total-sub-row">
        <span>قيمة السيارات</span>
        <span>${total.toLocaleString('en-US',{minimumFractionDigits:2})}</span>
      </div>
      <div class="total-sub-row">
        <span>مصاريف إضافية</span>
        <span>${(finalTotal-total).toLocaleString('en-US',{minimumFractionDigits:2})}</span>
      </div>` : ''}
    </div>
  </div>

  ${notes ? `<div class="notes-section"><div class="notes-title">ملاحظات / Notes</div><p style="color:#444;line-height:1.6">${notes}</p></div>` : ''}

  <!-- Signatures -->
  <div class="sig-area">
    <div class="sig-box">
      <div class="sig-label">توقيع البائع / Seller Signature</div>
    </div>
    <div class="sig-box">
      <div class="sig-label">توقيع المشتري / Buyer Signature</div>
    </div>
  </div>

  <div class="inv-footer">
    ${companyName} · ${companyAddress} · شكراً لتعاملكم معنا · Thank you for your business
  </div>
</div>
</body>
</html>`;

  openPrintOverlay(html);

  // WhatsApp option after print
  setTimeout(() => {
    if (confirm('إرسال الفاتورة عبر واتساب؟')) {
      const phone = prompt('رقم واتساب العميل (مثال: 96512345678)\nاتركه فارغاً لاختيار يدوي:','');
      if (phone !== null) sendWhatsappInvoice({ invNo, customer, date, fn, notes, items, total, extraCharges, grandTotal, phone });
    }
  }, 800);
}

async function loadCollectionsTab(fn, sys) {
  try {
    const data = await apiGetAll('collections', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'due_date.desc' });
    if (!data?.length) { el('collectionsTable').innerHTML = emptyHTML('💰','لا توجد تحصيلات'); return; }

    // فصل المقبوض عن المنتظر
    const paidData    = data.filter(c => c.paid_date);
    const pendingData = data.filter(c => !c.paid_date);
    const totalInvoiced = data.reduce((s,c)=>s+(+c.amount||0),0);
    const totalPaid     = paidData.reduce((s,c)=>s+(+c.amount||0),0);
    const totalPending  = pendingData.reduce((s,c)=>s+(+c.amount||0),0);

    const csvRows = data.map(c=>[c.ref_no||'—', c.inv_no||'—', c.customer||'—', c.vin||'—', +c.amount||0, c.pay_method||'—', c.due_date||'—', c.paid_date||'—', c.paid_date?'محصّل':'مستحق']);
    const csvHeaders = ['رقم التحصيل','رقم الفاتورة','العميل','الشاصي','المبلغ','طريقة الدفع','تاريخ الاستحقاق','تاريخ الدفع','الحالة'];

    const statusBadge = c => c.paid_date
      ? `<span style="background:var(--green-dim);color:var(--green);padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">✅ محصّل</span>`
      : `<span style="background:#fef3c7;color:#92400e;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">⏳ مستحق</span>`;

    el('collectionsTable').innerHTML = `
      ${exportBtns(
        `exportCSV(${JSON.stringify(csvHeaders)},${JSON.stringify(csvRows)},'تحصيلات_${fn}')`,
        `printSection('التحصيلات','ملف: ${fn}',document.querySelector('#tab-5 table')?.outerHTML||'')`
      )}
      <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <div class="j-kpi" style="border-right:3px solid var(--blue)"><div class="j-kpi-label">📄 إجمالي الفواتير</div><div class="j-kpi-val text-blue">${fmt(totalInvoiced)}</div></div>
        <div class="j-kpi" style="border-right:3px solid var(--green)"><div class="j-kpi-label">✅ مقبوض فعلاً</div><div class="j-kpi-val text-green">${fmt(totalPaid)}</div></div>
        <div class="j-kpi" style="border-right:3px solid var(--accent)"><div class="j-kpi-label">⏳ منتظر تحصيل</div><div class="j-kpi-val" style="color:${totalPending>0?'var(--accent)':'var(--text2)'}">${fmt(totalPending)}</div></div>
      </div>
      <table class="data-table">
        <thead><tr>
          <th style="width:36px;text-align:center">#</th>
          <th>رقم التحصيل</th><th>رقم الفاتورة</th><th>العميل</th><th>الشاصي</th>
          <th>المبلغ</th><th>طريقة الدفع</th><th>الاستحقاق</th><th>تاريخ الدفع</th><th>الحالة</th><th></th>
        </tr></thead>
        <tbody>
          ${data.map((c,i)=>{
            const isVoidedC = c.post_status === 'voided';
            const voidedBadgeC = isVoidedC ? '<span style="font-size:9px;background:var(--text2);color:#fff;padding:1px 5px;border-radius:4px;font-weight:700;margin-right:4px">ملغى</span>' : '';
            return `<tr style="${isVoidedC?'opacity:.55;':''}">
            <td style="text-align:center;font-size:11px;color:var(--text3);font-weight:700">${i+1}</td>
            <td class="mono" style="color:var(--green);font-weight:700;font-size:11px">${c.ref_no||'—'} ${voidedBadgeC}</td>
            <td class="mono">${c.inv_no||'—'}</td>
            <td>${c.customer||'—'}</td>
            <td class="mono">${c.vin||'—'}</td>
            <td class="mono text-blue" style="font-weight:700${isVoidedC?';text-decoration:line-through':''}">${fmt(c.amount)}</td>
            <td>${c.pay_method||'—'}</td>
            <td class="mono">${fmtDate(c.due_date)}</td>
            <td class="mono">${c.paid_date ? fmtDate(c.paid_date) : '—'}</td>
            <td>${isVoidedC ? '<span style="background:var(--card2);color:var(--text2);padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">ملغى</span>' : statusBadge(c)}</td>
            <td style="white-space:nowrap;display:flex;gap:4px">
              ${!isVoidedC && !c.paid_date ? `<button class="btn btn-sm" onclick="markCollectionPaid(${c.id},'${fn}')"
                style="background:var(--green-dim);color:var(--green);border:1px solid var(--green);font-weight:700" title="تسجيل دفع">✅ دفع</button>` : ''}
              ${!isVoidedC ? `<button class="btn btn-secondary btn-sm" onclick="openEditCollectionModal(${c.id})" title="تعديل">✏️</button>` : ''}
              ${!isVoidedC ? `<button class="btn btn-sm" onclick="deleteCollectionEntry(${c.id},'${fn}')"
                style="background:var(--red-dim);color:var(--red);border:1px solid var(--red)" title="إلغاء بقيد عكسي">🔄 إلغاء</button>` : ''}
            </td>
          </tr>`;}).join('')}
          <tr style="background:var(--card2);font-weight:700">
            <td colspan="4">الإجمالي</td>
            <td class="mono text-blue"><strong>${fmt(totalInvoiced)}</strong></td>
            <td colspan="4" style="font-size:11px;color:var(--text2)">
              محصّل: <span style="color:var(--green)">${fmt(totalPaid)}</span>
              ${totalPending>0?` · منتظر: <span style="color:var(--accent)">${fmt(totalPending)}</span>`:''}
            </td>
            <td></td>
          </tr>
        </tbody>
      </table>`;
  } catch(e) { el('collectionsTable').innerHTML = errHTML(e.message); }
}

async function loadPayoutsTab(fn, sys) {
  try {
    const [data, poArr] = await Promise.all([
      apiGetAll('partner_payouts', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'pay_date.desc' }),
      apiGetAll('purchase_orders', { select:'supplier', system_type:`eq.${sys}`, file_no:`eq.${fn}`, limit:1 }),
    ]);
    const supplierName = poArr?.[0]?.supplier || '—';
    if (!data?.length) { el('payoutsTable').innerHTML = emptyHTML('👥','لا توجد صرف للشركاء بعد'); return; }
    const total     = data.reduce((s,p)=>s+(+p.amount||0),0);
    const capTotal  = data.reduce((s,p)=>s+(+p.capital_amount||0),0);
    const profTotal = data.reduce((s,p)=>s+(+p.profit_amount||0),0);
    const advTotal  = data.reduce((s,p)=>s+(+p.advance_amount||0),0);

    const rows = data.map(p => {
      const hasSplit = (+p.capital_amount||0) + (+p.profit_amount||0) + (+p.advance_amount||0) > 0;
      const splitInfo = hasSplit ? `
        <div style="font-size:10px;color:var(--text2);margin-top:2px;display:flex;gap:6px">
          ${+p.capital_amount ? `<span style="color:var(--blue)">رأس مال: ${fmt(p.capital_amount)}</span>` : ''}
          ${+p.profit_amount  ? `<span style="color:${+p.profit_amount>=0?'var(--green)':'var(--red)'}">أرباح: ${fmt(p.profit_amount)}</span>` : ''}
          ${+p.advance_amount ? `<span style="color:var(--amber)">سلفة: ${fmt(p.advance_amount)}</span>` : ''}
        </div>` : '';
      return `<tr>
        <td style="text-align:center;font-size:11px;color:var(--text3);font-weight:700">${data.indexOf(p)+1}</td>
        <td class="mono" style="color:var(--accent);font-weight:700;font-size:11px">${p.pay_id||'—'}</td>
        <td><strong>${p.partner||'—'}</strong></td>
        <td>
          <span class="chip">${p.payout_type||'—'}</span>
          ${splitInfo}
        </td>
        <td class="mono" style="color:var(--purple);font-weight:700">${fmt(p.amount)}</td>
        <td style="font-size:11px;color:var(--text2)">${supplierName}</td>
        <td>${p.pay_method||'—'}</td>
        <td class="mono text-muted">${p.document||'—'}</td>
        <td class="mono text-muted">${fmtDate(p.pay_date)}</td>
        <td>
          <div style="display:flex;gap:4px">
            <button class="btn btn-secondary btn-sm" onclick="printPayoutVoucher(${p.id})" title="طباعة سند" style="color:var(--purple)">🖨️</button>
            <button class="btn btn-secondary btn-sm" onclick="openEditPayoutModal(${p.id})" title="تعديل">✏️</button>
            ${can('delete') ? `<button class="btn btn-secondary btn-sm" onclick="deletePayoutEntry(${p.id},'${fn}')" title="حذف" style="color:var(--red)">🗑</button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');

    el('payoutsTable').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
        <div class="j-kpi"><div class="j-kpi-label">إجمالي الصرف</div><div class="j-kpi-val" style="color:var(--purple)">${fmt(total)}</div></div>
        <div class="j-kpi"><div class="j-kpi-label">رأس مال مُسترد</div><div class="j-kpi-val text-blue">${fmt(capTotal)}</div></div>
        <div class="j-kpi"><div class="j-kpi-label">أرباح موزعة</div><div class="j-kpi-val text-green">${fmt(profTotal)}</div></div>
        <div class="j-kpi"><div class="j-kpi-label">سلف</div><div class="j-kpi-val text-amber">${fmt(advTotal)}</div></div>
      </div>
      ${exportBtns(
        `exportCSV(['رقم الصرف','الشريك','نوع الصرف','المبلغ','طريقة الدفع','المستند','التاريخ'],${JSON.stringify(data.map(p=>[p.pay_id||'—',p.partner||'—',p.payout_type||'—',+p.amount||0,p.pay_method||'—',p.document||'—',p.pay_date||'—']))},'صرف_شركاء_${fn}')`,
        `printSection('صرف الشركاء','ملف: ${fn}',document.querySelector('#tab-6 table')?.outerHTML||'')`
      )}
      <table class="data-table">
        <thead><tr>
          <th style="width:36px;text-align:center">#</th>
          <th>رقم الصرف</th><th>الشريك</th><th>نوع الصرف</th><th>المبلغ</th><th>دفع للمورد</th>
          <th>طريقة الدفع</th><th>المستند</th><th>التاريخ</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot style="background:var(--card2)">
          <tr><td colspan="2" style="padding:10px 16px;font-weight:700">الإجمالي</td>
          <td class="mono" style="color:var(--purple);padding:10px 16px;font-weight:700">${fmt(total)}</td>
          <td colspan="4"></td></tr>
        </tfoot>
      </table>`;
  } catch(e) { el('payoutsTable').innerHTML = errHTML(e.message); }
}

async function printPayoutVoucher(payoutId) {
  try {
    const [pArr, dealArr] = await Promise.all([
      apiGetAll('partner_payouts', { select:'*', id:`eq.${payoutId}` }),
      null
    ]);
    const p = pArr?.[0];
    if (!p) { toast('لم يُعثر على بيانات الصرف','err'); return; }

    const poArr = await apiGetAll('purchase_orders', { select:'supplier,po_date,total_purchase', system_type:`eq.${state.system}`, file_no:`eq.${p.file_no}` });
    const deal  = poArr?.[0];
    // Get full deal balance for this partner
    let dealSummary = null;
    try { dealSummary = await getPartnerDealBalance(p.file_no, p.partner, state.system); } catch(e) { console.warn('getPartnerDealBalance:', e.message); }
    const fmt2 = n => (+n||0).toLocaleString('en-US',{minimumFractionDigits:2});
    const typeColor = { 'استرداد رأس مال':'#2563eb', 'توزيع أرباح':'#16a34a', 'رأس مال + أرباح':'#7c3aed', 'سلفة':'#e6930a' };
    const color = typeColor[p.payout_type] || '#1a1a1a';

    const dealBreakdown = dealSummary ? `
      <div style="background:#f8f9fa;border-radius:8px;padding:14px 16px;margin-bottom:20px">
        <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">ملخص الصفقة — ملف ${p.file_no}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:10px">
          <div><div style="font-size:10px;color:#888">رأس المال (شراء)</div><div style="font-weight:700;color:#2563eb">${fmt2(dealSummary._totalCost)} KWD</div></div>
          <div><div style="font-size:10px;color:#888">المصاريف</div><div style="font-weight:700;color:#dc2626">${fmt2(dealSummary._totalExp)} KWD</div></div>
          <div><div style="font-size:10px;color:#888">المبيعات</div><div style="font-weight:700;color:#16a34a">${fmt2(dealSummary._totalSales)} KWD</div></div>
        </div>
        <div style="border-top:1px solid #e5e7eb;padding-top:10px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
          <div><div style="font-size:10px;color:#888">رأس المال المدفوع (حصتي)</div><div style="font-weight:700;color:#2563eb">${fmt2(dealSummary.capitalPaid)} KWD</div></div>
          <div><div style="font-size:10px;color:#888">الربح المستحق (حصتي)</div><div style="font-weight:700;color:${dealSummary.profit>=0?'#16a34a':'#dc2626'}">${fmt2(Math.abs(dealSummary.profit))} KWD</div></div>
          <div><div style="font-size:10px;color:#888">المسحوبات السابقة</div><div style="font-weight:700;color:#e6930a">${fmt2(dealSummary.totalWithdrawn)} KWD</div></div>
        </div>
      </div>` : '';

    const splitRows = [];
    if (+p.capital_amount) splitRows.push(`<tr><td>رأس مال مُسترد</td><td style="font-weight:700;color:#2563eb">${(+p.capital_amount).toLocaleString('en-US',{minimumFractionDigits:2})} KWD</td></tr>`);
    if (+p.profit_amount)  splitRows.push(`<tr><td>أرباح موزعة</td><td style="font-weight:700;color:#16a34a">${(+p.profit_amount).toLocaleString('en-US',{minimumFractionDigits:2})} KWD</td></tr>`);
    if (+p.advance_amount) splitRows.push(`<tr><td>سلفة</td><td style="font-weight:700;color:#e6930a">${(+p.advance_amount).toLocaleString('en-US',{minimumFractionDigits:2})} KWD</td></tr>`);

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>سند صرف ${p.pay_id||payoutId}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Cairo',Arial,sans-serif;color:#1a1a1a;background:#fff;font-size:13px}
  .page{max-width:700px;margin:0 auto;padding:32px 36px}
  .no-print{text-align:center;margin-bottom:20px;display:flex;gap:10px;justify-content:center}
  .no-print button{padding:10px 28px;border-radius:8px;font-family:'Cairo',sans-serif;font-size:14px;font-weight:700;cursor:pointer;border:none}
  /* Header */
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:18px;border-bottom:3px solid #1a1a1a}
  .company-name{font-size:22px;font-weight:900}
  .company-sub{font-size:12px;color:#888;margin-top:3px}
  .voucher-title{text-align:left}
  .voucher-title h1{font-size:26px;font-weight:900;letter-spacing:-0.5px}
  .voucher-title .pay-id{font-size:15px;font-weight:700;color:${color};margin-top:6px;letter-spacing:1px}
  /* Info grid */
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:22px}
  .info-box{background:#f8f9fa;border-radius:8px;padding:14px 16px}
  .info-box-title{font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
  .info-row{display:flex;justify-content:space-between;padding:3px 0;font-size:13px}
  .info-label{color:#666}
  .info-value{font-weight:700;color:#1a1a1a}
  /* Amount box */
  .amount-box{background:#1a1a1a;color:#fff;border-radius:10px;padding:20px 28px;text-align:center;margin-bottom:22px}
  .amount-label{font-size:12px;color:#aaa;margin-bottom:6px}
  .amount-value{font-size:32px;font-weight:900;letter-spacing:-1px}
  .amount-currency{font-size:13px;color:#aaa;margin-top:4px}
  .amount-type{display:inline-block;background:${color};color:#fff;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700;margin-top:8px}
  /* Split table */
  .split-table{width:100%;border-collapse:collapse;margin-bottom:22px}
  .split-table td{padding:8px 14px;border-bottom:1px solid #eee}
  .split-table td:last-child{text-align:left}
  /* Notes */
  .notes-box{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:22px}
  .notes-label{font-size:10px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
  /* Signatures */
  .sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-bottom:28px}
  .sig-box{text-align:center;padding-top:44px;border-top:1px solid #ccc}
  .sig-label{font-size:11px;color:#888;margin-top:6px}
  /* Footer */
  .footer{text-align:center;padding-top:16px;border-top:1px solid #eee;color:#bbb;font-size:10px}
  @media print{
    body{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    .page{padding:16px}
    .no-print{display:none!important}
  }
</style>
</head>
<body>
<div class="page">

  <div class="no-print">
    <button onclick="window.print()" style="background:#1a1a1a;color:#fff">🖨️ طباعة</button>
    <button onclick="window.close()" style="background:#f1f1f1;color:#333;border:1px solid #ddd">✕ إغلاق</button>
  </div>

  <div class="hdr">
    <div>
      <div class="company-name">Transit Cars</div>
      <div class="company-sub">ترانزيت للسيارات · الكويت</div>
    </div>
    <div class="voucher-title">
      <h1>سند صرف شريك</h1>
      <div class="pay-id"># ${p.pay_id||payoutId}</div>
    </div>
  </div>

  ${dealBreakdown}

  <div class="info-grid">
    <div class="info-box">
      <div class="info-box-title">بيانات الشريك</div>
      <div class="info-row"><span class="info-label">اسم الشريك</span><span class="info-value">${p.partner||'—'}</span></div>
      <div class="info-row"><span class="info-label">رقم الملف</span><span class="info-value">${p.file_no||'—'}</span></div>
      ${deal ? `<div class="info-row"><span class="info-label">المورد</span><span class="info-value">${deal.supplier||'—'}</span></div>` : ''}
    </div>
    <div class="info-box">
      <div class="info-box-title">بيانات الدفع</div>
      <div class="info-row"><span class="info-label">التاريخ</span><span class="info-value">${p.pay_date||'—'}</span></div>
      <div class="info-row"><span class="info-label">طريقة الدفع</span><span class="info-value">${p.pay_method||'—'}</span></div>
      ${p.document ? `<div class="info-row"><span class="info-label">رقم المستند</span><span class="info-value">${p.document}</span></div>` : ''}
    </div>
  </div>

  <div class="amount-box">
    <div class="amount-label">المبلغ الإجمالي</div>
    <div class="amount-value">${(+p.amount).toLocaleString('en-US',{minimumFractionDigits:2})}</div>
    <div class="amount-currency">KWD — دينار كويتي</div>
    <div><span class="amount-type">${p.payout_type||'صرف'}</span></div>
  </div>

  ${splitRows.length > 1 ? `
  <table class="split-table">
    <tr style="background:#f8f9fa"><td colspan="2" style="padding:8px 14px;font-weight:700;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px">تفاصيل التوزيع</td></tr>
    ${splitRows.join('')}
  </table>` : ''}

  ${p.notes ? `
  <div class="notes-box">
    <div class="notes-label">ملاحظات</div>
    <div>${p.notes}</div>
  </div>` : ''}

  <div class="sig-grid">
    <div class="sig-box">
      <div class="sig-label">توقيع المستلم (الشريك)</div>
      <div style="font-size:12px;color:#1a1a1a;margin-top:4px">${p.partner||''}</div>
    </div>
    <div class="sig-box">
      <div class="sig-label">توقيع المُصدِر</div>
    </div>
  </div>

  <div class="footer">
    تم إنشاؤه بتاريخ ${new Date().toLocaleDateString('en-GB')} · Transit Cars System
  </div>

</div>
</body></html>`;

    openPrintOverlay(html);

  } catch(e) { toast('خطأ في الطباعة: '+e.message,'err'); }
}

async function openEditPayoutModal(payoutId) {
  // Load payout data and reopen payout modal in edit mode
  try {
    const data = await apiGetAll('partner_payouts', { select:'*', id:`eq.${payoutId}` });
    const p = data?.[0];
    if (!p) return;
    // Set modal values
    const partners = await apiGetAll('partners_master', { select:'partner', system_type:`eq.${state.system}`, file_no:`eq.${p.file_no}` });
    el('poutModalTitle').textContent = `تعديل صرف — ${p.partner}`;
    el('pout-partner').innerHTML = (partners||[]).map(pm=>`<option value="${pm.partner}" ${pm.partner===p.partner?'selected':''}>${pm.partner}</option>`).join('');
    el('pout-type').value    = p.payout_type || 'استرداد رأس مال';
    el('pout-date').value    = p.pay_date    || today();
    el('pout-method').value  = p.pay_method  || 'تحويل بنكي';
    el('pout-doc').value     = p.document    || '';
    el('pout-notes').value   = p.notes       || '';
    el('poutError').style.display = 'none';
    onPayoutTypeChange();
    if (p.payout_type === 'رأس مال + أرباح') {
      el('pout-capital').value = p.capital_amount || '';
      el('pout-profit').value  = p.profit_amount  || '';
    } else {
      el('pout-amount').value = p.amount || '';
    }
    // Override submit to edit mode
    el('poutSubmitBtn').onclick = async () => {
      await deletePayoutEntry(payoutId, p.file_no, true);
      el('poutSubmitBtn').onclick = () => submitPayout();
      await submitPayout();
    };
    el('pout-balance-card').style.display = 'none';
    openModal('payoutModal');
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}


// ════════════════════════════════════════
// NEW FILE FORM
// ════════════════════════════════════════
// ════════════════════════════════════════
// NEW FILE MODAL — سند شراء
// ════════════════════════════════════════
let nfPriceMode = 'equal';

// Edit mode state
let _nfEditMode = false;
let _nfEditFileNo = null;


// Add vehicle row pre-filled with existing data
function addVehicleRowWithData(v) {
  addVehicleRow();
  const rows = el('vehiclesContainer').querySelectorAll('tr.v-row');
  const row  = rows[rows.length - 1];
  if (!row) return;
  row.dataset.vehicleId = v.id;
  const setVal = (name, val) => { const i = row.querySelector(`[name="${name}"]`); if(i) i.value = val||''; };
  setVal('v-type',   v.vehicle_type  || '');
  setVal('v-model',  v.model         || '');
  setVal('v-year',   v.year          || '');
  setVal('v-vin',    v.vin           || '');
  setVal('v-plate',  v.plate         || '');
  setVal('v-color',  v.color         || '');
  setVal('v-engine', v.engine_size   || '');
  setVal('v-expiry', v.license_expiry|| '');
  setVal('v-notes',  v.notes         || '');
  const priceInp = row.querySelector('[name="v-price"]');
  if (priceInp) { priceInp.value = v.purchase_price || ''; priceInp.readOnly = false; priceInp.style.opacity = '1'; priceInp.style.cursor = ''; }
}

// Add partner row pre-filled with existing data
async function addPartnerRowWithData(partner, payment) {
  await addPartnerRow();
  const rows = el('partnersContainer').querySelectorAll('.p-row');
  const row  = rows[rows.length - 1];
  if (!row) return;
  row.dataset.partnerId = partner.id;

  const inputs = row.querySelectorAll('input');
  const sels   = row.querySelectorAll('select');

  // Partner name — set in select, add option if missing
  if (sels[0]) {
    const partnerName = partner.partner || '';
    let opt = Array.from(sels[0].options).find(o => o.value === partnerName);
    if (!opt && partnerName) {
      opt = document.createElement('option');
      opt.value = partnerName; opt.textContent = partnerName;
      sels[0].insertBefore(opt, sels[0].lastElementChild);
    }
    sels[0].value = partnerName;
  }

  // Share percent
  if (inputs[0]) inputs[0].value = partner.share_percent || '';

  // Payment data
  if (payment) {
    if (inputs[1]) inputs[1].value = payment.amount     || '';
    if (inputs[2]) inputs[2].value = payment.pay_date   || '';
    if (sels[1])   sels[1].value   = payment.pay_method || 'تحويل بنكي';
    if (inputs[3]) inputs[3].value = payment.document   || '';
  }

  updatePartnerSummary();
}

