// ╔══════════════════════════════════════════════════════════╗
// ║  reports.js — Reports · Filters · Export                ║
// ║  Transit Management System — نقل حرفي، لا تعديل منطق   ║
// ╚══════════════════════════════════════════════════════════╝
function showReport(type) {
  sessionStorage.setItem('tm_last_view','report:'+type);
  hideAllViews();
  el('reportsView').style.display = 'block';
  const _rt={profit:'الأرباح والخسائر',cashflow:'التدفقات النقدية',inventory:'تقرير المخزون',sales:'المبيعات',expenses:'المصاريف',partners:'الشركاء',opex:'التشغيلية'};
  el('topBarTitle').textContent = _rt[type]||'التقارير';
  navActive('');
  setReportPeriod(reportState.period || 'year', false); // بدون run — setReportType هتشغل
  setReportType(type);
}

const reportPeriodState = { period: 'year' };

function setReportPeriod(period, autoRun = true) {
  reportPeriodState.period = period;
  document.querySelectorAll('[id^="rperiod-"]').forEach(b => b.classList.remove('active'));
  el('rperiod-' + period)?.classList.add('active');
  const wrap = el('rCustomDateWrap');
  if (period === 'custom') {
    if (wrap) wrap.style.display = 'flex';
    return; // المستخدم يختار التاريخ يدوياً
  }
  if (wrap) wrap.style.display = 'none';
  // ✅ المصدر الموحّد: getPeriodDates (periods.js) — Phase 1
  const { from, to } = getPeriodDates(period);
  if (el('r-from')) el('r-from').value = from;
  if (el('r-to'))   el('r-to').value   = to;
  if (autoRun) runReport();
}

function setReportType(type) {
  reportState.type = type;
  document.querySelectorAll('[id^="rtype-"]').forEach(b => b.classList.remove('active'));
  el('rtype-' + type)?.classList.add('active');
  // ✅ فلتر المخزن يظهر فقط في تقرير المخزون
  const whWrap = el('inv-warehouse-filter-wrap');
  if (whWrap) {
    whWrap.style.display = type === 'inventory' ? 'flex' : 'none';
    if (type !== 'inventory') {
      // إعادة ضبط الفلتر عند الخروج من تقرير المخزون
      const sel = el('inv-warehouse-filter');
      if (sel) sel.value = '';
    }
  }
  runReport();
}

async function runReport() {
  const from = el('r-from').value;
  const to   = el('r-to').value;
  if (!from || !to) return;
  const sys  = state.system;
  const type = reportState.type;
  el('reportTable').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري إعداد التقرير...</div>';
  el('reportKpis').innerHTML = '';

  // ── فلتر العرض الموحّد لكل التقارير: مرحّل فقط (افتراضي) / الكل / معلّق فقط ──
  // 'draft' و'all' يضيفون معاينة (preview) لأثر العمليات المعلّقة (لم تُعتمد بعد)
  // بدون أي قيود فعلية أو تعديل على المحرك المحاسبي
  const postFilter = el('r-post-filter')?.value || 'posted';

  try {
    if (type === 'profit') {
      // ✅ A02: تقرير P&L يُبنى الآن من journal_entries مباشرة
      // مصدر واحد موحّد (computeFinancials في core.js) = نفس أرقام لوحة التحكم بالظبط
      await ensureCache();

      // جلب كل القيود المرحّلة في الفترة (النظام + system_type=null) — حساب واحد فقط
      const postedRows  = await fetchJEForPeriod(sys, from, to);

      let jeRows = postedRows;
      let draftRows = [];
      if (postFilter !== 'posted') {
        draftRows = await simulateDraftJE(sys, from, to);
        jeRows = postFilter === 'draft' ? draftRows : [...postedRows, ...draftRows];
      }

      const previewBanner = (postFilter !== 'posted' && draftRows.length)
        ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:13px;color:#92400e">
            🔍 <strong>معاينة:</strong> الأرقام أدناه تشمل ${draftRows.length} سطر قيد من ${postFilter==='draft'?'':'إجمالي '}عمليات <strong>معلّقة (لم تُعتمد بعد)</strong> — قد تتغيّر بعد المراجعة.
           </div>`
        : (postFilter !== 'posted' ? `<div style="background:var(--card2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:13px;color:var(--text2)">
            🔍 لا توجد عمليات معلّقة (draft) في هذه الفترة.
           </div>` : '');

      // ── تجميع الأرقام من القيود عبر الدالة الموحّدة ──
      const fin = computeFinancials(jeRows);
      const ts        = fin.totSales;
      const tCOGS     = fin.totCOGS;
      const tDealExp  = fin.totDealExp;
      const tOpex     = fin.totOpex;
      const byFile    = fin.byFile;

      // ربح الصفقات = إيراد - COGS - مصاريف صفقات
      const dealProfit = fin.grossProfit;
      const netProfit  = fin.netProfit;

      // ✅ تحذير: لو فيه قيود في الفترة لكن كل الأرقام صفر → أكواد الحسابات لا تطابق 4xxx/5xxx/6xxx
      const hasEntries = (jeRows||[]).length > 0;
      const allZero    = ts === 0 && tCOGS === 0 && tDealExp === 0 && tOpex === 0;
      const acctWarn   = hasEntries && allZero
        ? `<div style="background:var(--accent-dim);border:1px solid var(--accent);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:13px;color:var(--accent)">
            ⚠️ يوجد <strong>${jeRows.length}</strong> قيد في هذه الفترة لكن جميع الأرقام صفر —
            تحقق من أن أكواد حسابات الإيراد تبدأ بـ <strong>4</strong>، والتكاليف بـ <strong>5</strong>، والمصاريف بـ <strong>6</strong> في شجرة الحسابات.
           </div>` : '';

      // ── KPIs ──
      el('reportKpis').innerHTML = `
        <div class="j-kpi" style="border-right:3px solid var(--green)">
          <div class="j-kpi-label">إجمالي المبيعات</div>
          <div class="j-kpi-val text-green">${fmt(ts)}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">من حساب 4100</div>
        </div>
        <div class="j-kpi" style="border-right:3px solid var(--blue)">
          <div class="j-kpi-label">تكلفة المخزون المباع</div>
          <div class="j-kpi-val text-blue">${fmt(tCOGS)}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">من حساب 5100</div>
        </div>
        <div class="j-kpi" style="border-right:3px solid var(--red)">
          <div class="j-kpi-label">مصاريف الصفقات</div>
          <div class="j-kpi-val text-red">${fmt(tDealExp)}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">من حسابات 6xxx</div>
        </div>
        <div class="j-kpi" style="border-right:3px solid var(--accent);background:var(--accent-dim)">
          <div class="j-kpi-label">ربح الصفقات</div>
          <div class="j-kpi-val" style="color:${dealProfit>=0?'var(--green)':'var(--red)'};font-size:20px">${fmt(dealProfit)}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">مبيعات - COGS - مصاريف</div>
        </div>
        <div class="j-kpi" style="border-right:3px solid var(--purple)">
          <div class="j-kpi-label">المصاريف التشغيلية</div>
          <div class="j-kpi-val text-purple">${fmt(tOpex)}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">إيجار، رواتب، إلخ</div>
        </div>
        <div class="j-kpi" style="border-right:3px solid ${netProfit>=0?'var(--green)':'var(--red)'};background:${netProfit>=0?'var(--green-dim)':'var(--red-dim)'}">
          <div class="j-kpi-label">صافي ربح الشركة</div>
          <div class="j-kpi-val" style="color:${netProfit>=0?'var(--green)':'var(--red)'};font-size:20px;font-weight:900">${fmt(netProfit)}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">بعد خصم التشغيلية · من القيود</div>
        </div>`;

      // ── بناء rows_data للجدول التفصيلي ──
      // ملفات لها مبيعات في القيود خلال الفترة
      const fileNos = Object.keys(byFile).filter(fn => byFile[fn].sales > 0);

      // بيانات الصفقات من الـ cache (مورد، تاريخ، حالة، سيارات)
      const enriched   = state.allDealsEnriched || [];
      const enrichMap  = {};
      enriched.forEach(d => { enrichMap[d.file_no] = d; });

      const deals = state.allDeals || [];
      const dealMap = {};
      deals.forEach(d => { dealMap[d.file_no] = d; });

      const rows_data = fileNos.map(fn => {
        const je  = byFile[fn];
        const en  = enrichMap[fn] || {};
        const d   = dealMap[fn]   || {};
        const fullCost = je.cogs + je.dealExp;
        const profit   = je.sales - fullCost;
        return {
          file:       fn,
          file_no:    fn,
          supplier:   d.supplier  || en.supplier || '—',
          po_date:    d.po_date   || en.po_date  || '',
          notes:      d.notes     || en.notes    || '',
          status:     d.status    || en.status   || '—',
          purchase:   je.purchase,
          expenses:   je.dealExp,
          sales:      je.sales,
          fullCost,
          profit,
          // fields for renderDealsTable
          _totalCost: je.purchase,
          _totalExp:  je.dealExp,
          _fullCost:  fullCost,
          _totalSale: je.sales,
          _profit:    profit,
          _vTotal:    en._vTotal  || 0,
          _vSold:     en._vSold   || 0,
          _vLeft:     en._vLeft   || 0,
        };
      }).sort((a, b) => b.profit - a.profit);

      reportState.data = rows_data;

      el('reportTable').innerHTML = previewBanner + acctWarn + (rows_data.length
        ? '<div id="reportDealsTable"></div>'
        : emptyHTML('📈', 'لا توجد بيانات في هذه الفترة'));

      if (rows_data.length) {
        renderDealsTable(rows_data, 'reportDealsTable', { showSales: true, totalRow: true });
      }

    } else if (type === 'sales') {
      await ensureCache();
      const data = state.allSales.filter(s => {
        if (!passesPostFilter(s, postFilter)) return false;
        const d = s.sale_date || s.created_at?.split('T')[0] || '';
        return d >= from && d <= to;
      }).sort((a,b)=>(b.sale_date||'').localeCompare(a.sale_date||''));
      const total = data.reduce((s,r)=>s+(+r.sale_price||0),0);
      const draftCount = data.filter(isDraft).length;
      reportState.data = data;
      el('reportKpis').innerHTML = `
        <div class="j-kpi"><div class="j-kpi-label">عدد المبيعات</div><div class="j-kpi-val">${data.length}</div></div>
        <div class="j-kpi"><div class="j-kpi-label">إجمالي</div><div class="j-kpi-val text-green">${fmt(total)}</div></div>`;
      const rows = data.map(s=>`<tr onclick="openViewer('${s.file_no}')" style="cursor:pointer${isDraft(s)?';opacity:.6':''}">
        <td class="mono text-muted">${fmtDate(s.sale_date)}</td><td class="mono text-amber">${s.file_no}</td>
        <td class="mono" style="direction:ltr">${s.vin||'—'}</td><td>${s.customer||'—'}${isDraft(s)?' <span style="font-size:11px;color:#f59e0b">⏳ معلّق</span>':''}</td>
        <td class="mono text-green">${fmt(s.sale_price)}</td></tr>`).join('');
      el('reportTable').innerHTML =
        (postFilter !== 'posted' && draftCount ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:13px;color:#92400e">🔍 يشمل ${draftCount} عملية بيع معلّقة (لم تُعتمد بعد)</div>` : '') +
        (rows ? `<table class="data-table"><thead><tr><th>التاريخ</th><th>الملف</th><th>VIN</th><th>العميل</th><th>السعر</th></tr></thead><tbody>${rows}</tbody></table>` : emptyHTML('💹','لا توجد مبيعات'));

    } else if (type === 'expenses') {
      await ensureCache();
      const data = state.allExpenses.filter(e => {
        if (!passesPostFilter(e, postFilter)) return false;
        const d = e.exp_date || e.expense_date || e.created_at?.split('T')[0] || '';
        return d >= from && d <= to;
      }).sort((a,b)=>(b.exp_date||'').localeCompare(a.exp_date||''));
      const total = data.reduce((s,r)=>s+(+r.amount||0),0);
      const draftCount = data.filter(isDraft).length;
      reportState.data = data;
      el('reportKpis').innerHTML = `
        <div class="j-kpi"><div class="j-kpi-label">عدد المصاريف</div><div class="j-kpi-val">${data.length}</div></div>
        <div class="j-kpi"><div class="j-kpi-label">إجمالي</div><div class="j-kpi-val text-red">${fmt(total)}</div></div>`;
      const rows = data.map(e=>`<tr style="${isDraft(e)?'opacity:.6':''}">
        <td class="mono text-muted">${fmtDate(e.exp_date||e.expense_date)}</td><td class="mono text-amber">${e.file_no||'—'}</td>
        <td>${e.description||'—'}${isDraft(e)?' <span style="font-size:11px;color:#f59e0b">⏳ معلّق</span>':''}</td><td>${e.exp_type||e.category||'—'}</td>
        <td class="mono text-red">${fmt(e.amount)}</td></tr>`).join('');
      el('reportTable').innerHTML =
        (postFilter !== 'posted' && draftCount ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:13px;color:#92400e">🔍 يشمل ${draftCount} مصروف معلّق (لم يُعتمد بعد)</div>` : '') +
        (rows ? `<table class="data-table"><thead><tr><th>التاريخ</th><th>الملف</th><th>البيان</th><th>النوع</th><th>المبلغ</th></tr></thead><tbody>${rows}</tbody></table>` : emptyHTML('💸','لا توجد مصاريف'));

    } else if (type === 'partners') {
      await ensureCache();
      const [payoutsRaw, allPartnerDeals] = await Promise.all([
        apiGetDateRange('partner_payouts','pay_date',from,to,{order:'pay_date.desc'}),
        apiGetAll('partners_master', { select:'partner', system_type:`eq.${sys}` }),
      ]);
      // payments من الـ cache مع فلتر تاريخ
      const paymentsRaw = state.allPayments
        ? state.allPayments.filter(p => { const d = p.pay_date||''; return d >= from && d <= to; })
        : await apiGetDateRange('payments','pay_date',from,to);

      // ── فلتر العرض الموحّد (مرحّل/معلّق/الكل) ──
      const payouts  = (payoutsRaw||[]).filter(p => passesPostFilter(p, postFilter));
      const payments = (paymentsRaw||[]).filter(p => passesPostFilter(p, postFilter));
      const draftCount = payouts.filter(isDraft).length + payments.filter(isDraft).length;

      // قائمة الشركاء الفريدة
      const uniquePartners = [...new Set((allPartnerDeals||[]).map(p=>p.partner))].filter(Boolean);

      const tp  = (payments||[]).reduce((s,r)=>s+(+r.amount||0),0);
      const tpo = (payouts||[]).reduce((s,r)=>s+(+r.amount||0),0);
      reportState.data = payouts||[];

      el('reportKpis').innerHTML = `
        <div class="j-kpi"><div class="j-kpi-label">دفعات للموردين</div><div class="j-kpi-val text-cyan">${fmt(tp)}</div></div>
        <div class="j-kpi"><div class="j-kpi-label">صرف للشركاء</div><div class="j-kpi-val text-purple">${fmt(tpo)}</div></div>
        <div class="j-kpi" style="border-right:3px solid var(--accent)">
          <div class="j-kpi-label">كشف شامل لشريك</div>
          <div style="margin-top:6px">
            <select id="report-partner-select" style="background:var(--card2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:5px 10px;color:var(--text);font-family:'Cairo',sans-serif;font-size:12px;width:100%">
              <option value="">اختر شريكاً...</option>
              ${uniquePartners.map(p=>`<option value="${p}">${p}</option>`).join('')}
            </select>
            <button onclick="openPartnerStatementFromReport()" class="btn btn-primary btn-sm" style="margin-top:6px;width:100%">📋 عرض الكشف</button>
          </div>
        </div>`;

      const rows = (payouts||[]).map(p=>`<tr style="${isDraft(p)?'opacity:.6':''}">
        <td class="mono text-muted">${fmtDate(p.pay_date)}</td>
        <td class="mono text-amber">${p.file_no||'—'}</td>
        <td>${p.partner||'—'}${isDraft(p)?' <span style="font-size:11px;color:#f59e0b">⏳ معلّق</span>':''}</td>
        <td>${p.payout_type||'—'}</td>
        <td class="mono text-purple">${fmt(p.amount)}</td>
        <td><button class="btn btn-secondary btn-sm" onclick="showPartnerStatement('${p.partner}')">📋 كشف شامل</button></td>
      </tr>`).join('');
      el('reportTable').innerHTML =
        (postFilter !== 'posted' && draftCount ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:13px;color:#92400e">🔍 يشمل ${draftCount} عملية معلّقة (لم تُعتمد بعد)</div>` : '') +
        (rows
          ? `<table class="data-table"><thead><tr><th>التاريخ</th><th>الملف</th><th>الشريك</th><th>النوع</th><th>المبلغ</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
          : emptyHTML('👥','لا توجد بيانات'));
    }
    if (type === 'inventory') {
      await runInventoryReport(sys);
      return;
    }
    if (type === 'cashflow') { await runCashFlowReport(from, to, sys, postFilter); return; }
    if (type === 'opex') {
      await loadOpexReport(from, to);
    }
  } catch(e) { el('reportTable').innerHTML = errHTML('خطأ: '+e.message); console.error(e); }
}

// ════════════════════════════════════════
// CASH FLOW REPORT — من القيود المحاسبية
// ════════════════════════════════════════
async function runCashFlowReport(from, to, sys, postFilter = 'posted') {
  el('reportKpis').innerHTML = '';
  el('reportTable').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري إعداد تقرير التدفقات من القيود...</div>';
  try {
    const toEOD = to + 'T23:59:59';
    // ── مصدر واحد: journal_entries فقط — حسابات النقد والبنك ──
    const url = `${SB_URL}/rest/v1/journal_entries?system_type=eq.${encodeURIComponent(sys)}&entry_date=gte.${encodeURIComponent(from)}&entry_date=lte.${encodeURIComponent(toEOD)}&post_status=eq.posted&select=*&limit=49999`;
    const res  = await fetch(url, { headers: headers() });
    if (!res.ok) throw new Error(await res.text());
    let jeRows = await res.json();

    // ── معاينة: تضمين أثر العمليات المعلّقة (draft) دون أي كتابة فعلية ──
    let draftRows = [];
    if (postFilter !== 'posted') {
      draftRows = await simulateDraftJE(sys, from, to);
      jeRows = postFilter === 'draft' ? draftRows : [...jeRows, ...draftRows];
    }
    const previewBanner = (postFilter !== 'posted')
      ? (draftRows.length
          ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:13px;color:#92400e">🔍 <strong>معاينة:</strong> يشمل ${draftRows.length} سطر قيد من عمليات معلّقة (لم تُعتمد بعد) — قد تتغيّر بعد المراجعة.</div>`
          : `<div style="background:var(--card2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:13px;color:var(--text2)">🔍 لا توجد عمليات معلّقة (draft) في هذه الفترة.</div>`)
      : '';

    // حركات حسابات النقد/البنك
    const cashRows = jeRows.filter(r => r.account_code === '1110' || r.account_code === '1120');

    // داخل = مدين على النقد/البنك
    const inflows  = cashRows.filter(r => (+r.dr_amount||0) > 0);
    // خارج = دائن على النقد/البنك
    const outflows = cashRows.filter(r => (+r.cr_amount||0) > 0);

    const totalIn  = inflows.reduce((s,r)=>s+(+r.dr_amount||0),0);
    const totalOut = outflows.reduce((s,r)=>s+(+r.cr_amount||0),0);
    const net      = totalIn - totalOut;

    // تجميع الداخل حسب المصدر (ref_table)
    const inBySource = {};
    inflows.forEach(r => {
      const src = r.ref_table || 'manual';
      if (!inBySource[src]) inBySource[src] = { amount:0, count:0 };
      inBySource[src].amount += +r.dr_amount||0;
      inBySource[src].count++;
    });

    // تجميع الخارج حسب المصدر
    const outBySource = {};
    outflows.forEach(r => {
      const src = r.ref_table || 'manual';
      if (!outBySource[src]) outBySource[src] = { amount:0, count:0 };
      outBySource[src].amount += +r.cr_amount||0;
      outBySource[src].count++;
    });

    const srcLabels = {
      collections:'تحصيلات العملاء', payments:'دفعات الموردين',
      expenses:'مصاريف الصفقات', partner_payouts:'صرف الشركاء',
      operating_expenses:'مصاريف تشغيلية', manual:'قيود يدوية', sales:'مبيعات',
    };
    const srcIcons = {
      collections:'💰', payments:'💳', expenses:'💸',
      partner_payouts:'👥', operating_expenses:'💼', manual:'✍️', sales:'🤝',
    };

    el('reportKpis').innerHTML = `
      <div class="j-kpi" style="border-right:3px solid var(--green);background:var(--green-dim)">
        <div class="j-kpi-label">💚 إجمالي الداخل</div>
        <div class="j-kpi-val text-green" style="font-size:20px;font-weight:900">${fmt(totalIn)}</div>
        <div style="font-size:12px;color:var(--text2);margin-top:2px">قيود نقدية مدينة — ${inflows.length} سطر</div>
      </div>
      <div class="j-kpi" style="border-right:3px solid var(--red);background:var(--red-dim)">
        <div class="j-kpi-label">❤️ إجمالي الخارج</div>
        <div class="j-kpi-val text-red" style="font-size:20px;font-weight:900">${fmt(totalOut)}</div>
        <div style="font-size:12px;color:var(--text2);margin-top:2px">قيود نقدية دائنة — ${outflows.length} سطر</div>
      </div>
      <div class="j-kpi" style="border-right:3px solid ${net>=0?'var(--green)':'var(--red)'};background:${net>=0?'var(--green-dim)':'var(--red-dim)'}">
        <div class="j-kpi-label">💵 صافي التدفق</div>
        <div class="j-kpi-val" style="color:${net>=0?'var(--green)':'var(--red)'};font-size:22px;font-weight:900">${net>=0?'+':''}${fmt(net)}</div>
        <div style="font-size:12px;color:var(--text2);margin-top:2px">من القيود المحاسبية ${from} — ${to}</div>
      </div>`;

    // تفصيل الداخل والخارج
    const inRows  = Object.entries(inBySource).map(([src, d]) => `
      <tr><td><div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:18px">${srcIcons[src]||'📌'}</span>
        <div><div style="font-weight:600">${srcLabels[src]||src}</div>
        <div style="font-size:13px;color:var(--text2)">${d.count} قيد</div></div></div></td>
      <td><span style="background:var(--green-dim);color:var(--green);padding:2px 8px;border-radius:10px;font-size:13px;font-weight:700">↑ داخل</span></td>
      <td class="mono text-green" style="font-weight:700">${fmt(d.amount)}</td>
      <td><div style="background:var(--card2);border-radius:4px;height:8px;overflow:hidden;min-width:80px"><div style="width:${totalIn>0?Math.round(d.amount/totalIn*100):0}%;height:100%;background:var(--green);border-radius:4px"></div></div></td></tr>`).join('');

    const outRows = Object.entries(outBySource).map(([src, d]) => `
      <tr><td><div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:18px">${srcIcons[src]||'📌'}</span>
        <div><div style="font-weight:600">${srcLabels[src]||src}</div>
        <div style="font-size:13px;color:var(--text2)">${d.count} قيد</div></div></div></td>
      <td><span style="background:var(--red-dim);color:var(--red);padding:2px 8px;border-radius:10px;font-size:13px;font-weight:700">↓ خارج</span></td>
      <td class="mono text-red" style="font-weight:700">${fmt(d.amount)}</td>
      <td><div style="background:var(--card2);border-radius:4px;height:8px;overflow:hidden;min-width:80px"><div style="width:${totalOut>0?Math.round(d.amount/totalOut*100):0}%;height:100%;background:var(--red);border-radius:4px"></div></div></td></tr>`).join('');

    // تحليل شهري
    const months = {};
    const addM = (date, amt, dir) => {
      if (!date) return;
      const m = date.slice(0,7);
      if (!months[m]) months[m] = { in:0, out:0 };
      if (dir > 0) months[m].in  += amt;
      else         months[m].out += amt;
    };
    inflows.forEach(r => addM((r.entry_date||'').split('T')[0], +r.dr_amount||0, +1));
    outflows.forEach(r => addM((r.entry_date||'').split('T')[0], +r.cr_amount||0, -1));
    const mks = Object.keys(months).sort();
    const monthRows = mks.map(m => {
      const n = months[m].in - months[m].out;
      return `<tr><td style="font-family:monospace">${m}</td>
        <td class="mono text-green">${fmt(months[m].in)}</td>
        <td class="mono text-red">${fmt(months[m].out)}</td>
        <td class="mono" style="font-weight:700;color:${n>=0?'var(--green)':'var(--red)'}">${n>=0?'+':''}${fmt(n)}</td></tr>`;
    }).join('');

    reportState.data = [...Object.entries(inBySource).map(([src,d])=>({البند:srcLabels[src]||src,الاتجاه:'داخل',المبلغ:d.amount})),
                        ...Object.entries(outBySource).map(([src,d])=>({البند:srcLabels[src]||src,الاتجاه:'خارج',المبلغ:d.amount}))];

    el('reportTable').innerHTML = previewBanner + `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:16px">
        <div style="padding:12px 16px;border-bottom:1px solid var(--border);font-weight:700;font-size:13px;display:flex;justify-content:space-between">
          <span>📊 تفصيل التدفقات النقدية (من القيود)</span>
          <span style="font-size:13px;color:var(--text2)">${from} — ${to}</span>
        </div>
        <table class="data-table">
          <thead><tr><th>البند</th><th style="text-align:center">الاتجاه</th><th>المبلغ</th><th style="min-width:100px">النسبة</th></tr></thead>
          <tbody>${inRows}${outRows}</tbody>
          <tfoot style="background:var(--card2)">
            <tr><td colspan="2" style="padding:10px 16px;font-weight:700">صافي التدفق</td>
            <td class="mono" style="padding:10px 16px;font-weight:900;font-size:15px;color:${net>=0?'var(--green)':'var(--red)'}">${net>=0?'+':''}${fmt(net)}</td><td></td></tr>
          </tfoot>
        </table>
      </div>
      ${mks.length>1?`<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
        <div style="padding:12px 16px;border-bottom:1px solid var(--border);font-weight:700;font-size:13px">📅 التحليل الشهري</div>
        <table class="data-table"><thead><tr><th>الشهر</th><th style="color:var(--green)">↑ داخل</th><th style="color:var(--red)">↓ خارج</th><th>الصافي</th></tr></thead>
        <tbody>${monthRows}</tbody>
        <tfoot style="background:var(--card2)"><tr><td style="padding:10px 16px;font-weight:700">الإجمالي</td>
          <td class="mono text-green" style="padding:10px 16px;font-weight:700">${fmt(totalIn)}</td>
          <td class="mono text-red" style="padding:10px 16px;font-weight:700">${fmt(totalOut)}</td>
          <td class="mono" style="padding:10px 16px;font-weight:900;color:${net>=0?'var(--green)':'var(--red)'}">${net>=0?'+':''}${fmt(net)}</td>
        </tr></tfoot></table></div>`:''}`;
  } catch(e) { el('reportTable').innerHTML = errHTML('خطأ: '+e.message); console.error(e); }
}
// ════════════════════════════════════════
// INVENTORY REPORT — تقرير المخزون
// ════════════════════════════════════════
async function runInventoryReport(sys) {
  el('reportKpis').innerHTML = '';
  el('reportTable').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري تحميل المخزون...</div>';
  try {
    await ensureCache();
    const vehicles = state.allVehicles || [];
    const sales    = state.allSales    || [];
    const deals    = state.allDeals    || [];

    // ✅ جلب بيانات المخازن من stock_locations
    const locations = await apiGetAll('stock_locations', {
      select: 'vin,location_name,transfer_date,model,file_no',
      system_type: `eq.${sys}`,
      order: 'transfer_date.desc,id.desc',
    });

    // آخر موقع لكل VIN (الترتيب desc يضمن أول سجل = الأحدث)
    const vinLocationMap = {};
    (locations || []).forEach(t => {
      if (t.vin && !vinLocationMap[t.vin]) {
        vinLocationMap[t.vin] = t.location_name || 'غير محدد';
      }
    });

    // أسماء المخازن الفريدة
    const warehouseNames = [...new Set(Object.values(vinLocationMap))].sort();

    const soldVins = new Set((sales).filter(isPosted).map(s => s.vin).filter(Boolean));
    const dealMap  = {};
    deals.forEach(d => { dealMap[d.file_no] = d; });
    const saleMap  = {};
    sales.forEach(s => { if (s.vin) saleMap[s.vin] = s; });
    // مصاريف كل صفقة (للربح الحقيقي)
    const expByDeal = {};
    (state.allExpenses||[]).filter(isPosted).forEach(e => {
      expByDeal[e.file_no] = (expByDeal[e.file_no]||0) + (+e.amount||0);
    });

    const inStock = vehicles.filter(v => !soldVins.has(v.vin));
    const sold    = vehicles.filter(v =>  soldVins.has(v.vin));

    const stockValue  = inStock.reduce((s, v) => s + (+v.purchase_price || 0), 0);
    const soldRevenue = sold.reduce((s, v) => s + (+saleMap[v.vin]?.sale_price || 0), 0);
    const soldCost    = sold.reduce((s, v) => s + (+v.purchase_price || 0), 0);
    // توزيع المصاريف على السيارات المباعة بالتناسب مع عدد سيارات كل صفقة
    const soldExpenses = sold.reduce((s, v) => {
      const dealVehicleCount = (state.allVehicles||[]).filter(vx => vx.file_no === v.file_no).length || 1;
      const dealExpShare = (expByDeal[v.file_no]||0) / dealVehicleCount;
      return s + dealExpShare;
    }, 0);
    const soldProfit  = soldRevenue - soldCost - soldExpenses;

    // عدد السيارات الموزّعة على المخازن
    const inWarehouse = inStock.filter(v => vinLocationMap[v.vin]).length;

    // ── KPIs ──
    el('reportKpis').innerHTML = `
      <div class="j-kpi" style="border-right:3px solid var(--accent)">
        <div class="j-kpi-label">📦 إجمالي السيارات</div>
        <div class="j-kpi-val" style="color:var(--accent);font-size:22px;font-weight:900">${vehicles.length}</div>
      </div>
      <div class="j-kpi" style="border-right:3px solid var(--blue)">
        <div class="j-kpi-label">🏭 في المخزن</div>
        <div class="j-kpi-val text-blue" style="font-size:22px;font-weight:900">${inStock.length}</div>
        <div style="font-size:13px;color:var(--text2);margin-top:2px">قيمة: ${fmt(stockValue)}</div>
      </div>
      <div class="j-kpi" style="border-right:3px solid var(--purple)">
        <div class="j-kpi-label">🏪 المخازن</div>
        <div class="j-kpi-val text-purple" style="font-size:22px;font-weight:900">${warehouseNames.length}</div>
        <div style="font-size:13px;color:var(--text2);margin-top:2px">${inWarehouse} سيارة محوّلة</div>
      </div>
      <div class="j-kpi" style="border-right:3px solid var(--green)">
        <div class="j-kpi-label">✅ مباعة</div>
        <div class="j-kpi-val text-green" style="font-size:22px;font-weight:900">${sold.length}</div>
        <div style="font-size:13px;color:var(--text2);margin-top:2px">إيراد: ${fmt(soldRevenue)} · مصاريف موزّعة: ${fmt(soldExpenses)}</div>
      </div>
      <div class="j-kpi" style="border-right:3px solid ${soldProfit>=0?'var(--green)':'var(--red)'}">
        <div class="j-kpi-label">💰 ربح المبيعات</div>
        <div class="j-kpi-val" style="color:${soldProfit>=0?'var(--green)':'var(--red)'};font-size:20px;font-weight:900">${fmt(soldProfit)}</div>
      </div>`;

    // ── بناء الجدول ──
    // أولاً: سيارات في المخزن مرتّبة بالمخزن ثم بالصفقة
    const allRows = [
      ...inStock.map(v => ({ ...v, _status:'stock' })),
      ...sold.map(v   => ({ ...v, _status:'sold'  })),
    ];

    // فلتر المخزن المختار (لو فيه)
    const whFilter = el('inv-warehouse-filter')?.value || '';

    const filteredRows = whFilter
      ? allRows.filter(v => {
          if (v._status === 'sold') return false; // المخزن = غير مباع فقط
          return (vinLocationMap[v.vin] || '') === whFilter;
        })
      : allRows;

    // ── بناء فلتر المخازن (مرة واحدة عند أول تحميل) ──
    const filterWrap = el('inv-warehouse-filter-wrap');
    if (filterWrap && warehouseNames.length > 0) {
      filterWrap.style.display = '';
      const sel = el('inv-warehouse-filter');
      if (sel && sel.options.length <= 1) {
        sel.innerHTML = '<option value="">كل المخازن</option>' +
          warehouseNames.map(w => `<option value="${w}">${w}</option>`).join('');
      }
    }

    const rows = filteredRows.map(v => {
      const deal   = dealMap[v.file_no] || {};
      const sale   = saleMap[v.vin]     || {};
      const isSold = v._status === 'sold';
      const profit = isSold ? ((+sale.sale_price || 0) - (+v.purchase_price || 0)) : null;
      const days   = Math.floor((Date.now() - new Date(v.created_at || Date.now())) / 864e5);
      const whName = vinLocationMap[v.vin] || '';
      return `<tr>
        <td class="mono" style="direction:ltr;font-size:13px">${v.vin || '—'}</td>
        <td>${v.model || v.vehicle_type || '—'} ${v.year || ''}</td>
        <td>${v.color || '—'}</td>
        <td class="mono text-accent" onclick="openViewer('${v.file_no}')" style="cursor:pointer;font-weight:700">${v.file_no || '—'}</td>
        <td>${deal.supplier || '—'}</td>
        <td class="mono text-blue">${fmt(v.purchase_price)}</td>
        <td>
          ${isSold
            ? `<span style="background:var(--green-dim);color:var(--green);padding:2px 10px;border-radius:10px;font-size:13px;font-weight:700">✅ مباعة</span>`
            : `<span style="background:var(--blue-dim);color:var(--blue);padding:2px 10px;border-radius:10px;font-size:13px;font-weight:700">🏭 مخزن (${days}د)</span>`}
        </td>
        <td>
          ${whName
            ? `<span style="background:var(--purple-dim,#f3e8ff);color:var(--purple,#7c3aed);padding:2px 10px;border-radius:10px;font-size:13px;font-weight:700">🏪 ${whName}</span>`
            : `<span style="color:var(--text2);font-size:13px">—</span>`}
        </td>
        ${isSold ? `
          <td class="mono text-green">${fmt(sale.sale_price)}</td>
          <td class="mono" style="color:${profit>=0?'var(--green)':'var(--red)'};font-weight:700">${fmt(profit)}</td>
          <td style="font-size:13px;color:var(--text2)">${sale.customer || '—'}</td>
        ` : `<td>—</td><td>—</td><td>—</td>`}
      </tr>`;
    }).join('');

    // ── ملخص بالمخزن (لو فيه مخازن) ──
    let whSummaryHtml = '';
    if (warehouseNames.length > 0 && !whFilter) {
      const byWh = {};
      inStock.forEach(v => {
        const wh = vinLocationMap[v.vin];
        if (!wh) return;
        if (!byWh[wh]) byWh[wh] = { count:0, value:0 };
        byWh[wh].count++;
        byWh[wh].value += +v.purchase_price || 0;
      });
      const whCards = Object.entries(byWh).map(([wh, d]) => `
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px 16px;display:flex;justify-content:space-between;align-items:center;cursor:pointer"
          onclick="filterInventoryByWarehouse('${wh.replace(/'/g,"\'")}')" >
          <div>
            <div style="font-weight:700;font-size:13px">🏪 ${wh}</div>
            <div style="font-size:13px;color:var(--text2);margin-top:2px">${d.count} سيارة في المخزن</div>
          </div>
          <div style="text-align:left">
            <div style="font-family:monospace;font-weight:900;color:var(--purple)">${fmt(d.value)}</div>
            <div style="font-size:12px;color:var(--text2)">قيمة المخزون</div>
          </div>
        </div>`).join('');
      whSummaryHtml = `
        <div style="margin-bottom:14px">
          <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px">ملخص المخازن — اضغط للفلترة</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px">${whCards}</div>
        </div>`;
    }

    // زر إلغاء الفلتر لو مفعّل
    const clearBtn = whFilter
      ? `<button onclick="filterInventoryByWarehouse('')" style="background:var(--red-dim);border:1px solid var(--red);color:var(--red);border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer;margin-bottom:10px">✕ إلغاء فلتر: ${whFilter}</button>`
      : '';

    reportState.data = filteredRows.map(v => ({
      VIN:             v.vin || '',
      الموديل:         (v.model || v.vehicle_type || '') + (v.year ? ' ' + v.year : ''),
      اللون:           v.color || '',
      الملف:           v.file_no || '',
      المورد:          dealMap[v.file_no]?.supplier || '',
      المخزن:          vinLocationMap[v.vin] || '—',
      'تكلفة الشراء':  +v.purchase_price || 0,
      الحالة:          v._status === 'sold' ? 'مباعة' : 'في المخزن',
      'سعر البيع':     v._status === 'sold' ? (+saleMap[v.vin]?.sale_price || 0) : '',
      الربح:           v._status === 'sold' ? ((+saleMap[v.vin]?.sale_price || 0) - (+v.purchase_price || 0)) : '',
      العميل:          v._status === 'sold' ? saleMap[v.vin]?.customer || '' : '',
    }));

    el('reportTable').innerHTML = `
      ${whSummaryHtml}
      ${clearBtn}
      <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
        <table class="data-table">
          <thead><tr>
            <th>VIN</th><th>الموديل</th><th>اللون</th><th>الملف</th>
            <th>المورد</th><th>التكلفة</th><th>الحالة</th><th>المخزن</th>
            <th>سعر البيع</th><th>الربح</th><th>العميل</th>
          </tr></thead>
          <tbody>${rows.length ? rows : '<tr><td colspan="11" style="text-align:center;padding:20px;color:var(--text2)">لا توجد سيارات</td></tr>'}</tbody>
        </table>
      </div>`;

  } catch(e) {
    el('reportTable').innerHTML = `<div class="empty-state"><div class="e-icon">⚠️</div><p>خطأ: ${e.message}</p></div>`;
    console.error(e);
  }
}

// فلترة تقرير المخزون بالمخزن — يُستدعى من كروت المخازن
function filterInventoryByWarehouse(whName) {
  const sel = el('inv-warehouse-filter');
  if (sel) {
    sel.value = whName;
    runInventoryReport(state.system);
  }
}

function exportReportCSV() {
  if (!reportState.data?.length) { toast('لا توجد بيانات للتصدير','err'); return; }
  const rows = [Object.keys(reportState.data[0])];
  reportState.data.forEach(r => rows.push(Object.values(r)));
  downloadCSV(rows, `تقرير_${reportState.type}.csv`);
}

// ════════════════════════════════════════
// LOGIN HELPERS
// ════════════════════════════════════════
function togglePassword() {
  const inp = document.getElementById('loginPass');
  const btn = document.getElementById('togglePass');
  if (inp.type === 'password') {
    inp.type = 'text';
    btn.textContent = '🙈';
  } else {
    inp.type = 'password';
    btn.textContent = '👁';
  }
}

function clearSavedLogin() {
  localStorage.removeItem('tm_saved_email');
  localStorage.removeItem('tm_saved_pass');
  localStorage.removeItem('tm_remember');
  document.getElementById('loginEmail').value = '';
  document.getElementById('loginPass').value  = '';
  document.getElementById('rememberMe').checked = false;
  document.getElementById('savedBadge').style.display    = 'none';
  document.getElementById('clearSavedBtn').style.display = 'none';
  toast('تم مسح البيانات المحفوظة', 'ok');
}

// ════════════════════════════════════════
// EVENT LISTENERS
// ════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('loginBtn')?.addEventListener('click', login);
  document.getElementById('loginPass')?.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', function(e) {
      if (e.target === this) closeModal(this.id);
    });
  });

  // Intercept collection/sale/payout modal buttons
  document.querySelector('[onclick="openModal(\'collectionModal\')"]')?.setAttribute('onclick','openCollectionModal()');
  document.querySelector('[onclick="openModal(\'payoutModal\')"]')?.setAttribute('onclick','openPayoutModal()');
});


// ════════════════════════════════════════
// FEATURE 1 — CONFIRM DELETE MODAL
// ════════════════════════════════════════
function showConfirm(title, msg, onConfirm) {
  el('confirmDeleteTitle').textContent = title;
  el('confirmDeleteMsg').textContent = msg;
  const btn = el('confirmDeleteOkBtn');
  btn.onclick = async () => { closeModal('confirmDeleteModal'); await onConfirm(); };
  openModal('confirmDeleteModal');
}

// ✅ Audit fix: نسخة منفصلة تستخدم innerHTML لعرض محتوى HTML (جداول/قوائم)
// يجب أن يكون كل محتوى HTML الممرَّر مُعقَّماً مسبقاً بـ esc() قبل الاستدعاء
function showConfirmHtml(title, htmlMsg, onConfirm) {
  el('confirmDeleteTitle').textContent = title;   // العنوان دائماً textContent
  el('confirmDeleteMsg').innerHTML = htmlMsg;      // المحتوى HTML مُعقَّم مسبقاً من المُستدعي
  const btn = el('confirmDeleteOkBtn');
  btn.onclick = async () => { closeModal('confirmDeleteModal'); await onConfirm(); };
  openModal('confirmDeleteModal');
}

// Override browser confirm() for delete operations
async function confirmDeleteDealFromModal() {
  const fn = _nfEditFileNo;
  if (!fn) return;
  showConfirm(
    `حذف الصفقة ${fn}`,
    `سيتم حذف كل السيارات والعمليات والمدفوعات المرتبطة بها نهائياً. هذا الإجراء لا يمكن التراجع عنه.`,
    async () => {
      const btn = el('nfDeleteBtn');
      btn.disabled = true; btn.textContent = '⏳ جاري الحذف...';
      try {
        const sys = state.system;
        const tables = ['vehicles','payments','expenses','sales','collections','partner_payouts','partners_master','ledger_entries','journal_entries','opex_entries','account_ledger'];
        for (const t of tables) { try { await apiDelete(t, { system_type:`eq.${sys}`, file_no:`eq.${fn}` }); } catch(e) { console.warn(`deleteDeal table ${t}:`, e.message); } }
        await logAudit('DELETE','purchase_orders', fn, {file_no:fn}, null, 'حذف صفقة كاملة');
        try { await apiDelete('audit_log', { file_no:`eq.${fn}` }); } catch(e) { console.warn('deleteDeal audit_log:', e.message); }
        await apiDelete('purchase_orders', { system_type:`eq.${sys}`, file_no:`eq.${fn}` });
        closeModal('newFileModal');
        toast(`✅ تم حذف الصفقة ${fn}`,'ok');
        state.currentFileNo = null;
        await loadDashboard(); showDashboard();
      } catch(e) { toast('خطأ: '+e.message,'err'); btn.disabled=false; btn.textContent='🗑 حذف الصفقة'; }
    }
  );
}

async function confirmDeleteVehicle() {
  if (!_editVehicleId) return;
  showConfirm('حذف السيارة', 'هل تريد حذف هذه السيارة نهائياً من الصفقة؟', async () => {
    try {
      await apiDelete('vehicles', { id:`eq.${_editVehicleId}` });
      closeModal('editVehicleModal');
      toast('✅ تم حذف السيارة','ok');
      if (state.currentFileNo) await loadViewerTab(state.currentTab);
    } catch(e) { toast('خطأ: '+e.message,'err'); }
  });
}

async function deletePayoutEntry(payoutId, fileNo, silent=false) {
  try {
    const data = await apiGetAll('partner_payouts', { select:'*', id:`eq.${payoutId}` });
    const p = data?.[0];
    if (!p) { if (!silent) toast('لم يُعثر على السجل','err'); return; }

    if (silent) {
      // تعديل من modal — Void القديم بدل Hard Delete
      if (p.post_status === 'posted') {
        await voidTransaction('payout', p);
      } else {
        // draft فقط: مسح مباشر مقبول
        await apiDelete('partner_payouts', { id:`eq.${payoutId}` });
      }
      await loadPayoutsTab(fileNo, state.system);
      return;
    }

    if (p.post_status === 'posted') {
      // مرحّل: إلغاء بقيد عكسي
      showConfirm(
        `🔄 إلغاء صرف شريك — ${p.partner||''}`,
        `سيتم إلغاء هذا الصرف بقيد عكسي محاسبي.\nالسجل لن يُحذف — سيُعلَّم "ملغى".\n\nالشريك: ${p.partner||'—'}\nالمبلغ: ${fmt(p.amount)}\nالتاريخ: ${p.pay_date||'—'}`,
        async () => {
          try {
            await voidTransaction('payout', p);
            toast(`✅ تم إلغاء الصرف ${p.pay_id||''} بقيد عكسي`, 'ok');
            await loadPayoutsTab(fileNo||p.file_no, state.system);
          } catch(e) { toast('خطأ: '+e.message,'err'); }
        }
      );
    } else {
      // draft: مسح نهائي مقبول (لم يُرحَّل بعد)
      showConfirm('مسح صرف شريك', 'هل تريد مسح هذا الصرف؟ (لم يُرحَّل — لا يوجد قيد)', async () => {
        try {
          await apiDelete('partner_payouts', { id:`eq.${payoutId}` });
          await logAudit('DELETE','partner_payouts', fileNo||p.file_no, p, null, `مسح صرف شريك draft ${p.pay_id||payoutId}`);
          await loadPayoutsTab(fileNo||p.file_no, state.system);
          toast('✅ تم المسح','ok');
        } catch(e) { toast('خطأ: '+e.message,'err'); }
      });
    }
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}


function openRolesModal() {
  openModal('rolesModal');
  updateRoleUI(_currentRole);
}

let _pendingRole = _currentRole;
function setRole(role) {
  _pendingRole = role;
  updateRoleUI(role);
}

function updateRoleUI(role) {
  document.querySelectorAll('.role-btn').forEach(b => b.classList.toggle('active', b.dataset.role === role));
  const r = ROLES[role];
  el('perm-edit').innerHTML        = r.edit         ? '<span class="perm-yes">✅ مسموح</span>' : '<span class="perm-no">❌ ممنوع</span>';
  el('perm-delete').innerHTML      = r.delete        ? '<span class="perm-yes">✅ مسموح</span>' : '<span class="perm-no">❌ ممنوع</span>';
  el('perm-transactions').innerHTML= r.transactions  ? '<span class="perm-yes">✅ مسموح</span>' : '<span class="perm-no">❌ ممنوع</span>';
  el('perm-roles').innerHTML       = r.roles         ? '<span class="perm-yes">✅ مسموح</span>' : '<span class="perm-limited">🔒 مدير فقط</span>';
}

function saveRole() {
  _currentRole = _pendingRole;
  localStorage.setItem('tm_role', _currentRole);
  applyRoleRestrictions();
  closeModal('rolesModal');
  toast(`✅ تم الحفظ — الدور: ${ROLES[_currentRole].label}`,'ok');
}

function applyRoleRestrictions() {
  const canDel      = can('delete');
  const canTx       = can('transactions');
  const canApprove  = can('approve');
  const canSettings = can('settings');
  const isAdmin     = can('settings');
  const role        = ROLES[_currentRole] || ROLES.readonly;

  // ── ١. Role badge في sidebar ──
  const badge = el('userRoleBadge');
  if (badge) {
    badge.textContent   = role.label;
    badge.style.background = role.bg;
    badge.style.color      = role.color;
  }

  // ── ٢. زرار "ملف جديد" في top-bar ──
  const newFileBtn = el('topBarNewFile');
  if (newFileBtn) newFileBtn.style.display = canTx ? '' : 'none';

  // ── ٣. أزرار الحذف ──
  document.querySelectorAll('.btn-danger, #nfDeleteBtn').forEach(btn => {
    btn.style.display = canDel ? '' : 'none';
  });

  // ── ٤. أزرار الإضافة/الحفظ في المودالات ──
  document.querySelectorAll('#nfSubmitBtn, #saleSubmitBtn, #paymentSubmitBtn, #expSubmitBtn, #collectionSubmitBtn, #payoutSubmitBtn').forEach(btn => {
    btn.style.display = canTx ? '' : 'none';
  });

  // ── ٥. FAB مصروف سريع ──
  const fab = el('quickExpFab');
  if (fab) fab.style.display = canTx && state.currentFileNo ? 'flex' : 'none';

  // ── ٦. أزرار التسجيل السريع في اليومية ──
  document.querySelectorAll('.j-quick-btns .btn').forEach(btn => {
    btn.style.display = canTx ? '' : 'none';
  });
  const quickLabel = document.querySelector('.j-quick-label');
  if (quickLabel) quickLabel.style.display = canTx ? '' : 'none';

  // ── ٧. قسم الإدارة في sidebar (الإعدادات + المراجعة + إلخ) ──
  const adminNav = el('nav-section-admin');
  if (adminNav) adminNav.style.display = canSettings ? '' : 'none';

  // ── ٨. قائمة المراجعة في sidebar ──
  const approvalNav = el('nav-section-approval');
  if (approvalNav) approvalNav.style.display = canApprove ? '' : 'none';

  // ── ٩. أزرار الموافقة/الرفض في صفحة المراجعة ──
  document.querySelectorAll('.approve-btn, .reject-btn, #approve-all-btn').forEach(btn => {
    btn.style.display = canApprove ? '' : 'none';
  });

  // ── ١٠. زرار تعديل الملف في viewer ──
  document.querySelectorAll('#viewerEditBtn, .vh-edit-btn').forEach(btn => {
    btn.style.display = canTx ? '' : 'none';
  });

  // ── ١١. CSS class على body للتحكم بالـ context menus ──
  document.body.classList.toggle('role-readonly',  _currentRole === 'readonly');
  document.body.classList.toggle('role-employee',  _currentRole === 'employee');
  document.body.classList.toggle('role-admin',     _currentRole === 'admin');
}

// ════════════════════════════════════════
// FEATURE 3 — VIN DUPLICATE CHECK
// ════════════════════════════════════════
async function checkVinDuplicate(vin, excludeFileNo='') {
  if (!vin || vin.length < 3) return null;
  try {
    const results = await apiGetAll('vehicles', { select:'file_no,model,vin', system_type:`eq.${state.system}`, vin:`eq.${vin}` });
    const found = (results||[]).filter(v => v.file_no !== excludeFileNo);
    if (!found.length) return null;
    const deals = await apiGetAll('purchase_orders', { select:'file_no', system_type:`eq.${state.system}`, file_no:`eq.${found[0].file_no}` });
    if (!deals || !deals.length) {
      // VIN exists but deal is deleted — clean up orphan silently
      try { await apiDelete('vehicles', { system_type:`eq.${state.system}`, vin:`eq.${vin}`, file_no:`eq.${found[0].file_no}` }); } catch(e) { console.warn('deleteVehicle:', e.message); }
      return null;
    }
    return found[0];
  } catch(e) { return null; }
}

async function onVinBlur(input, excludeFileNo='') {
  const vin = input.value.trim().toUpperCase();
  if (!vin) return;
  input.value = vin;
  const dup = await checkVinDuplicate(vin, excludeFileNo);
  if (dup) {
    input.style.borderColor = 'var(--red)';
    input.style.boxShadow = '0 0 0 3px var(--red-dim)';
    const warn = input.parentElement.querySelector('.vin-warn') || (() => {
      const d = document.createElement('div');
      d.className = 'vin-warn hint';
      d.style.color = 'var(--red)';
      input.parentElement.appendChild(d);
      return d;
    })();
    warn.textContent = `⚠️ هذا الشاصي موجود في صفقة ${dup.file_no} (${dup.model||''})`;
  } else {
    input.style.borderColor = '';
    input.style.boxShadow = '';
    const warn = input.parentElement.querySelector('.vin-warn');
    if (warn) warn.remove();
  }
}

// ════════════════════════════════════════
// FEATURE 4 — WHATSAPP INVOICE
// ════════════════════════════════════════
function sendWhatsappInvoice({ invNo, customer, date, items, total, phone='' }) {
  const itemLines = items.map((it,i) => `${i+1}. ${it.model||'سيارة'} — ${it.price.toLocaleString('en-US',{minimumFractionDigits:2})} ج.م`).join('\n');
  const msg = `🚗 *ترانزيت — فاتورة مبيعات*\n\n` +
    `رقم الفاتورة: *${invNo}*\n` +
    `التاريخ: ${date}\n` +
    `العميل: ${customer}\n\n` +
    `*السيارات:*\n${itemLines}\n\n` +
    `*الإجمالي: ${total.toLocaleString('en-US',{minimumFractionDigits:2})} ج.م*\n\n` +
    `شكراً لتعاملكم مع ترانزيت 🤝`;

  const num = phone.replace(/\D/g,'');
  const url = num ? `https://wa.me/${num}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

// WhatsApp after print — called from reprint buttons directly

// ════════════════════════════════════════
// FEATURE 5 — QUICK EXPENSE FAB
// ════════════════════════════════════════
function openQuickExpFab() {
  if (!state.currentFileNo) { toast('افتح صفقة أولاً','err'); return; }
  openQuickModal('expense');
}

// FAB shown in openViewer directly

function showDashboard_withFab() {
  showDashboard();
  const fab = el('quickExpFab');
  if (fab) fab.style.display = 'none';
}

// Init roles on load
document.addEventListener('DOMContentLoaded', () => {
  _currentRole = localStorage.getItem('tm_role') || 'admin';
  _pendingRole = _currentRole;

  // Top bar shadow on scroll
  const contentArea = document.querySelector('.content-area');
  const topBar = document.querySelector('.top-bar');
  if (contentArea && topBar) {
    contentArea.addEventListener('scroll', () => {
      topBar.classList.toggle('scrolled', contentArea.scrollTop > 10);
    });
  }
});
