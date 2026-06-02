// ╔══════════════════════════════════════════════════════════╗
// ║  transactions.js — TX View · Invoice Modal · Export     ║
// ║  Transit Management System — نقل حرفي، لا تعديل منطق   ║
// ╚══════════════════════════════════════════════════════════╝
const TX_CONFIG = {
  sales:       { title:'المبيعات',         icon:'🧾', color:'var(--green)',  table:'sales',           amountField:'sale_price',     dateField:'sale_date', labelField:'customer' },
  expenses:    { title:'المصاريف',         icon:'💸', color:'var(--red)',    table:'expenses',        amountField:'amount',         dateField:'exp_date',  labelField:'description' },
  collections: { title:'التحصيلات',        icon:'💰', color:'var(--blue)',   table:'collections',     amountField:'amount',         dateField:'due_date',  labelField:'customer' },
  payments:    { title:'دفعات الموردين',   icon:'💳', color:'var(--cyan)',   table:'payments',        amountField:'amount',         dateField:'pay_date',  labelField:'payer' },
  payouts:     { title:'مسحوبات الشركاء', icon:'👥', color:'var(--purple)', table:'partner_payouts', amountField:'amount',         dateField:'pay_date',  labelField:'partner' },
  opex:        { title:'مصروفات عامة',     icon:'💼', color:'var(--text2)',  table:'operating_expenses', amountField:'amount',    dateField:'exp_date',  labelField:'description' },
};

let _txType = 'deals';

function showTransactions(type) {
  // الصفقات موجودة في الداشبورد — لا نكررها
  if (!type || type === 'deals') {
    showDashboard();
    return;
  }

  _txType = type;
  const cfg = TX_CONFIG[_txType];
  sessionStorage.setItem('tm_last_view', 'tx:'+_txType);

  hideAllViews();
  el('transactionsView').style.display = 'block';
  el('topBarTitle').textContent = cfg.icon + ' ' + cfg.title;
  navActive('');

  // التحصيلات تفتح على "هذه السنة" بدلاً من "هذا الشهر"
  // لأن التحصيل قد يكون due_date في شهر سابق ولم يُدفع بعد
  const now = new Date();
  const y = now.getFullYear(), m = String(now.getMonth()+1).padStart(2,'0');
  document.querySelectorAll('[id^="txperiod-"]').forEach(b => b.classList.remove('active'));
  if (el('txCustomDateWrap')) el('txCustomDateWrap').style.display = 'none';

  if (type === 'collections') {
    // سنة كاملة لتشمل كل التحصيلات المستحقة والمقبوضة
    el('tx-from').value = `${y}-01-01`;
    el('tx-to').value   = `${y}-12-31`;
    el('txperiod-year')?.classList.add('active');
  } else {
    // بقية الأنواع: هذا الشهر
    el('tx-from').value = `${y}-${m}-01`;
    el('tx-to').value   = today();
    el('txperiod-month')?.classList.add('active');
  }

  el('tx-title').textContent = cfg.icon + ' ' + cfg.title;
  loadTransactions();
}


// ════════════════════════════════════════
// TRANSACTIONS DATE FILTER
// ════════════════════════════════════════
function setTxPeriod(period) {
  document.querySelectorAll('[id^="txperiod-"]').forEach(b => b.classList.remove('active'));
  el('txperiod-' + period)?.classList.add('active');
  const customWrap = el('txCustomDateWrap');
  const pad = n => String(n).padStart(2,'0');
  const toDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const now = new Date();
  const yr  = now.getFullYear();

  if (period === 'custom') {
    customWrap.style.display = 'flex';
    return;
  }
  customWrap.style.display = 'none';

  let from, to;
  if (period === 'today') {
    from = to = toDate(now);
  } else if (period === 'week') {
    const sun = new Date(now); sun.setDate(now.getDate() - now.getDay());
    const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
    from = toDate(sun); to = toDate(sat);
  } else if (period === 'month') {
    from = `${yr}-${pad(now.getMonth()+1)}-01`;
    to   = toDate(new Date(yr, now.getMonth()+1, 0));
  } else if (period === '3months') {
    const f = new Date(now); f.setMonth(f.getMonth() - 3);
    from = toDate(f); to = toDate(now);
  } else if (period === 'year') {
    from = `${yr}-01-01`;
    to   = `${yr}-12-31`;
  } else if (period === 'lastyear') {
    from = `${yr-1}-01-01`;
    to   = `${yr-1}-12-31`;
  }

  if (el('tx-from')) el('tx-from').value = from;
  if (el('tx-to'))   el('tx-to').value   = to;
  loadTransactions();
}

async function loadTransactions() {
  const type = _txType;
  const cfg  = TX_CONFIG[type];
  const from = el('tx-from').value;
  const to   = el('tx-to').value;
  const pf   = el('tx-post-filter')?.value || 'all';
  const sys  = state.system;

  el('tx-table').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري التحميل...</div>';
  el('tx-kpis').innerHTML  = '';

  if (!from || !to) {
    el('tx-table').innerHTML = emptyHTML('📅','يرجى تحديد الفترة الزمنية');
    return;
  }

  const toEOD = to + 'T23:59:59';

  // helper: build Supabase URL with correct filters — يشمل null system_type (بيانات قديمة)
  async function fetchRows(table, dateCol) {
    // جلب المطابق + null معاً
    const base = `${SB_URL}/rest/v1/${table}?select=*&${dateCol}=gte.${encodeURIComponent(from)}&${dateCol}=lte.${encodeURIComponent(toEOD)}&order=${dateCol}.desc`;
    const psFilter = pf === 'draft' ? '&post_status=eq.draft'
                   : pf === 'posted' ? '&or=(post_status.eq.posted,post_status.is.null)'
                   : '';
    const [r1, r2] = await Promise.all([
      fetch(base + `&system_type=eq.${encodeURIComponent(sys)}` + psFilter, { headers: headers() }),
      fetch(base + '&system_type=is.null' + psFilter, { headers: headers() }),
    ]);
    const [d1, d2] = await Promise.all([r1.ok ? r1.json() : [], r2.ok ? r2.json() : []]);
    const seen = new Set(); const out = [];
    [...(d1||[]), ...(d2||[])].forEach(r => {
      const key = r.id ?? JSON.stringify(r);
      if (!seen.has(key)) { seen.add(key); out.push(r); }
    });
    // إعادة ترتيب بالتاريخ
    out.sort((a,b) => (b[dateCol]||'').localeCompare(a[dateCol]||''));
    return out;
  }

  // helper خاص بالتحصيلات: يجلب بـ due_date أو paid_date أو created_at
  async function fetchCollections() {
    const psFilter = pf === 'draft'  ? '&post_status=eq.draft'
                   : pf === 'posted' ? '&or=(post_status.eq.posted,post_status.is.null)'
                   : '';
    // PostgREST OR على عمودين مختلفين — نجلب الكل ونفلتر client-side
    const buildUrl = (sysParam) =>
      `${SB_URL}/rest/v1/collections?select=*&${sysParam}&order=id.desc${psFilter}`;

    const h = headers({ 'Range': '0-49999', 'Range-Unit': 'items' });
    const [r1, r2] = await Promise.all([
      fetch(buildUrl(`system_type=eq.${encodeURIComponent(sys)}`), { headers: h }),
      fetch(buildUrl('system_type=is.null'),                        { headers: h }),
    ]);
    const [d1, d2] = await Promise.all([r1.ok ? r1.json() : [], r2.ok ? r2.json() : []]);
    const seen = new Set(); const all = [];
    [...(d1||[]), ...(d2||[])].forEach(r => {
      const key = r.id ?? JSON.stringify(r);
      if (!seen.has(key)) { seen.add(key); all.push(r); }
    });
    // فلتر بالفترة: أي تاريخ (due_date أو paid_date أو created_at) يقع في النطاق
    return all.filter(r => {
      const d1 = (r.due_date  || '').slice(0,10);
      const d2 = (r.paid_date || '').slice(0,10);
      const d3 = (r.created_at|| '').slice(0,10);
      const anyDate = d1 || d2 || d3;
      if (!anyDate) return true; // بدون تاريخ → أظهره دايماً
      return (d1 && d1 >= from && d1 <= to)
          || (d2 && d2 >= from && d2 <= to)
          || (d3 && d3 >= from && d3 <= to);
    }).sort((a,b) => {
      const da = a.due_date || a.paid_date || a.created_at || '';
      const db = b.due_date || b.paid_date || b.created_at || '';
      return db.localeCompare(da);
    });
  }

  try {
    let rows = [];

    if (type === 'opex') {
      rows = await fetchRows('operating_expenses', 'exp_date');
    } else if (type === 'collections') {
      rows = await fetchCollections();
    } else {
      rows = await fetchRows(cfg.table, cfg.dateField);
    }

    rows = rows || [];

    // audit_log لا يحتوي على ref_id — نتجاهل created_by
    let auditMap = {};

    // KPIs
    const total       = rows.reduce((s,r)=>s+(+r[cfg.amountField]||0), 0);
    const draftCount  = rows.filter(isDraft).length;
    const postedCount = rows.length - draftCount;

    // KPIs خاصة بالتحصيلات
    const colPaidAmt    = type==='collections' ? rows.filter(r=>r.paid_date && isPosted(r)).reduce((s,r)=>s+(+r.amount||0),0) : 0;
    const colPendingAmt = type==='collections' ? rows.filter(r=>!r.paid_date && isPosted(r)).reduce((s,r)=>s+(+r.amount||0),0) : 0;

    el('tx-subtitle').textContent = `${rows.length} سجل · ${from} — ${to}`;
    el('tx-kpis').innerHTML = `
      <div class="j-kpi" style="border-right:3px solid ${cfg.color}">
        <div class="j-kpi-label">${cfg.icon} إجمالي ${cfg.title}</div>
        <div class="j-kpi-val" style="color:${cfg.color};font-size:18px;font-weight:900">${fmt(total)}</div>
      </div>
      <div class="j-kpi">
        <div class="j-kpi-label">عدد السجلات</div>
        <div class="j-kpi-val">${rows.length}</div>
      </div>
      ${type==='collections' ? `
      <div class="j-kpi" style="border-right:3px solid var(--green)">
        <div class="j-kpi-label">✅ محصّل فعلاً</div>
        <div class="j-kpi-val text-green">${fmt(colPaidAmt)}</div>
      </div>
      <div class="j-kpi" style="border-right:3px solid var(--accent)">
        <div class="j-kpi-label">⏳ مستحق</div>
        <div class="j-kpi-val" style="color:${colPendingAmt>0?'var(--accent)':'var(--text2)'}">${fmt(colPendingAmt)}</div>
      </div>` : ''}
      ${pf==='all' && draftCount > 0 ? `
      <div class="j-kpi">
        <div class="j-kpi-label">✅ مرحَّل</div>
        <div class="j-kpi-val text-green">${postedCount}</div>
      </div>
      <div class="j-kpi">
        <div class="j-kpi-label">⏳ معلق</div>
        <div class="j-kpi-val" style="color:var(--accent)">${draftCount}</div>
      </div>` : ''}`;

    window._txRows = rows;
    window._txAuditMap = auditMap;
    window._txCfg = cfg;
    window._txType2 = type;

    renderTxTable(rows, cfg, auditMap, type);

  } catch(e) {
    el('tx-table').innerHTML = `<div class="empty-state"><div class="e-icon">⚠️</div><p>خطأ: ${e.message}</p></div>`;
    console.error('loadTransactions error:', e);
  }
}

function renderTxTable(rows, cfg, auditMap, type) {
  if (!rows.length) {
    el('tx-table').innerHTML = emptyHTML(cfg.icon, 'لا توجد سجلات في هذه الفترة');
    return;
  }

  // ══ المبيعات: تجميع بالفاتورة ══
  if (type === 'sales') {
    renderSalesInvoices(rows, cfg, auditMap);
    return;
  }

  // Build columns based on type
  const cols = {
    deals:       [{k:'po_date',t:'التاريخ'},{k:'file_no',t:'رقم الملف'},{k:'supplier',t:'المورد'},{k:'vehicle_count',t:'سيارات'},{k:'total_purchase',t:'القيمة',mono:true},{k:'status',t:'الحالة'}],
    expenses:    [{k:'exp_date',t:'التاريخ'},{k:'file_no',t:'الملف'},{k:'ref_no',t:'المرجع'},{k:'description',t:'الوصف'},{k:'exp_type',t:'النوع'},{k:'amount',t:'المبلغ',mono:true}],
    collections: [{k:'due_date',t:'الاستحقاق'},{k:'paid_date',t:'تاريخ الدفع'},{k:'file_no',t:'الملف'},{k:'ref_no',t:'المرجع'},{k:'inv_no',t:'الفاتورة'},{k:'customer',t:'العميل'},{k:'amount',t:'إجمالي الفاتورة',mono:true}],
    payments:    [{k:'pay_date',t:'التاريخ'},{k:'file_no',t:'الملف'},{k:'ref_no',t:'المرجع'},{k:'payer',t:'الدافع'},{k:'pay_method',t:'الطريقة'},{k:'amount',t:'المبلغ',mono:true}],
    payouts:     [{k:'pay_date',t:'التاريخ'},{k:'file_no',t:'الملف'},{k:'pay_id',t:'المرجع'},{k:'partner',t:'الشريك'},{k:'payout_type',t:'النوع'},{k:'amount',t:'المبلغ',mono:true}],
    opex:        [{k:'exp_date',t:'التاريخ'},{k:'ref_no',t:'المرجع'},{k:'description',t:'الوصف'},{k:'category',t:'الفئة'},{k:'amount',t:'المبلغ',mono:true}],
  };

  const typeCols = cols[type] || [];

  const statusBadge = r => {
    if (!r.post_status || r.post_status==='posted') return '<span style="background:var(--green-dim);color:var(--green);padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">✅ مرحَّل</span>';
    return '<span style="background:#fef3c7;color:#92400e;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">⏳ معلق</span>';
  };

  const thead = `<tr>${typeCols.map(c=>`<th>${c.t}</th>`).join('')}<th>بواسطة</th><th>الحالة</th></tr>`;

  const tbody = rows.map(r => {
    const cells = typeCols.map(col => {
      let v = r[col.k] ?? '—';
      if (col.k.includes('date')) v = v && v !== '—' ? fmtDate(v) : '—';
      if (col.mono) {
        v = (v !== null && v !== undefined && v !== '—' && v !== '' && +v !== 0 || (+v === 0 && v === 0))
          ? `<span class="mono" style="color:${cfg.color};font-weight:700">${fmt(v)}</span>`
          : (r[col.k] > 0 ? `<span class="mono" style="color:${cfg.color};font-weight:700">${fmt(r[col.k])}</span>` : '—');
      }
      return `<td>${v}</td>`;
    }).join('');
    const user      = auditMap[String(r.id)] || '—';
    const shortUser = user.split('@')[0];
    const rowClick  = type==='deals' ? `onclick="openViewer('${r.file_no}')" style="cursor:pointer"` : '';
    let statusCell  = statusBadge(r);
    let rowStyle = '';
    if (type === 'collections') {
      if (r.post_status === 'voided') {
        statusCell = '<span style="background:var(--card2);color:var(--text2);padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">🚫 ملغى</span>';
        rowStyle = 'opacity:.5;';
      } else if (r.paid_date) {
        statusCell = '<span style="background:var(--green-dim);color:var(--green);padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">✅ محصّل</span>';
      } else {
        statusCell = '<span style="background:#fef3c7;color:#92400e;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">⏳ مستحق</span>';
        rowStyle = 'background:var(--accent-dim);';
      }
    }
    return `<tr ${rowClick} style="${rowStyle}">${cells}<td style="font-size:11px;color:var(--text2)">${shortUser}</td><td>${statusCell}</td></tr>`;
  }).join('');

  const total = rows.filter(r=>r.post_status!=='voided').reduce((s,r)=>s+(+r[cfg.amountField]||0),0);
  const totalPaidTX = type==='collections' ? rows.filter(r=>r.paid_date&&r.post_status!=='voided').reduce((s,r)=>s+(+r.amount||0),0) : 0;
  const totalPendTX = type==='collections' ? rows.filter(r=>!r.paid_date&&r.post_status!=='voided').reduce((s,r)=>s+(+r.amount||0),0) : 0;
  const tfoot = type==='collections'
    ? `<tr style="background:var(--card2);font-weight:700">
        <td colspan="${typeCols.length-1}">الإجمالي (${rows.filter(r=>r.post_status!=='voided').length} تحصيل)</td>
        <td class="mono text-blue">${fmt(total)}</td>
        <td style="font-size:11px;color:var(--text2)">
          ✅ محصّل: <span style="color:var(--green);font-weight:700">${fmt(totalPaidTX)}</span>
          ${totalPendTX>0?` · ⏳ مستحق: <span style="color:var(--accent);font-weight:700">${fmt(totalPendTX)}</span>`:''}
        </td>
        <td></td>
       </tr>`
    : `<tr style="background:var(--card2);font-weight:700"><td colspan="${typeCols.length-1}">الإجمالي</td><td class="mono">${fmt(total)}</td><td colspan="2"></td></tr>`;

  el('tx-table').innerHTML = `
    <table class="data-table" id="tx-data-table">
      <thead>${thead}</thead>
      <tbody id="tx-tbody">${tbody}</tbody>
      <tfoot>${tfoot}</tfoot>
    </table>`;
}

// ══ عرض الفواتير مجمّعة بـ inv_no ══
function renderSalesInvoices(rows, cfg, auditMap) {
  // تجميع بالفاتورة
  const invMap = {};
  rows.forEach(r => {
    const key = r.inv_no || `no-inv-${r.id}`;
    if (!invMap[key]) invMap[key] = {
      inv_no:    r.inv_no   || '—',
      file_no:   r.file_no  || '—',
      customer:  r.customer || '—',
      sale_date: r.sale_date,
      vehicles:  [],
      total:     0,
      post_status: r.post_status,
    };
    invMap[key].vehicles.push(r);
    invMap[key].total += +r.sale_price || 0;
  });

  const invoices   = Object.values(invMap).sort((a,b) => (b.sale_date||'').localeCompare(a.sale_date||''));
  const grandTotal = invoices.reduce((s,inv)=>s+inv.total, 0);

  // KPIs
  el('tx-kpis').innerHTML = `
    <div class="j-kpi" style="border-right:3px solid ${cfg.color}">
      <div class="j-kpi-label">💹 إجمالي المبيعات</div>
      <div class="j-kpi-val" style="color:${cfg.color};font-size:18px;font-weight:900">${fmt(grandTotal)}</div>
    </div>
    <div class="j-kpi">
      <div class="j-kpi-label">🧾 عدد الفواتير</div>
      <div class="j-kpi-val">${invoices.length}</div>
    </div>
    <div class="j-kpi">
      <div class="j-kpi-label">🚗 إجمالي السيارات</div>
      <div class="j-kpi-val">${rows.length}</div>
    </div>`;

  const tbody = invoices.map(inv => `
    <tr onclick="openInvoiceModal(${JSON.stringify(inv.inv_no).replace(/"/g,'&quot;')})" style="cursor:pointer"
      onmouseover="this.style.background='var(--accent-dim)'" onmouseout="this.style.background=''">
      <td class="mono text-muted" style="font-size:11px;white-space:nowrap">${fmtDate(inv.sale_date)}</td>
      <td class="mono text-amber" style="font-weight:700">${inv.file_no}</td>
      <td><span style="font-weight:700;color:var(--green);font-family:monospace">${inv.inv_no}</span></td>
      <td style="font-weight:600">${inv.customer}</td>
      <td style="text-align:center">
        <span style="background:var(--blue-dim);color:var(--blue);padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">${inv.vehicles.length} سيارة</span>
      </td>
      <td><span class="mono" style="color:var(--green);font-weight:900;font-size:14px">${fmt(inv.total)}</span></td>
      <td>
        <span style="background:${(inv.post_status==='posted'||!inv.post_status)?'var(--green-dim)':'#fef3c7'};color:${(inv.post_status==='posted'||!inv.post_status)?'var(--green)':'#92400e'};padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">
          ${(inv.post_status==='posted'||!inv.post_status)?'✅ مرحّلة':'⏳ معلقة'}
        </span>
      </td>
      <td>
        <button class="btn btn-sm" onclick="event.stopPropagation();openInvoiceModal('${inv.inv_no}')" style="font-size:11px;padding:3px 8px">🖨️ فتح</button>
      </td>
    </tr>`).join('');

  const tfoot = `<tr style="background:var(--card2);font-weight:700">
    <td colspan="5" style="padding:10px 16px">الإجمالي (${invoices.length} فاتورة · ${rows.length} سيارة)</td>
    <td class="mono text-green" style="padding:10px 16px;font-size:15px;font-weight:900">${fmt(grandTotal)}</td>
    <td colspan="2"></td>
  </tr>`;

  el('tx-table').innerHTML = `
    <div style="font-size:11px;color:var(--text2);margin-bottom:6px">اضغط على أي فاتورة لعرض تفاصيلها وطباعتها</div>
    <table class="data-table" id="tx-data-table">
      <thead><tr>
        <th>التاريخ</th><th>الملف</th><th>رقم الفاتورة</th>
        <th>العميل</th><th style="text-align:center">السيارات</th>
        <th>الإجمالي</th><th>الحالة</th><th></th>
      </tr></thead>
      <tbody id="tx-tbody">${tbody}</tbody>
      <tfoot>${tfoot}</tfoot>
    </table>`;

  // حفظ البيانات للبحث
  window._txInvoices = invMap;
  window._txRawRows  = rows;
}

// ══ موديل الفاتورة الكاملة ══
async function openInvoiceModal(invNo) {
  // جلب كل سطور الفاتورة
  const allRows = window._txRawRows || [];
  let vehicles  = allRows.filter(r => r.inv_no === invNo);

  // لو مش موجود في الـ cache — اجلب من DB
  if (!vehicles.length) {
    try {
      vehicles = await apiGetAll('sales', {
        select:'*', system_type:`eq.${state.system}`, inv_no:`eq.${invNo}`
      });
    } catch(e) { toast('خطأ في جلب الفاتورة: '+e.message,'err'); return; }
  }

  if (!vehicles.length) { toast('الفاتورة غير موجودة','err'); return; }

  const first    = vehicles[0];
  const total    = vehicles.reduce((s,v)=>s+(+v.sale_price||0),0);
  const invDate  = fmtDate(first.sale_date);
  const customer = first.customer || '—';
  const fileNo   = first.file_no  || '—';
  const sysName  = state.system === 'BOX' ? 'BOX System' : 'TM System';

  // محتوى الفاتورة
  const itemRows = vehicles.map((v,i) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${i+1}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;direction:ltr;font-family:monospace">${v.vin||'—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${v.model||'—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${v.year||'—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${v.color||'—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:left;font-family:monospace;font-weight:700">${(+v.sale_price||0).toLocaleString('en-US',{minimumFractionDigits:2})}</td>
    </tr>`).join('');

  const invoiceHTML = `
    <div id="invoice-print-area" style="font-family:'Cairo',Arial,sans-serif;direction:rtl;max-width:800px;margin:0 auto;background:#fff;color:#111;padding:32px">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:16px;border-bottom:3px solid #1a1a2e">
        <div>
          <div style="font-size:26px;font-weight:900;color:#1a1a2e">🚗 Transit Cars</div>
          <div style="font-size:13px;color:#666;margin-top:4px">${sysName} — نظام إدارة صفقات السيارات</div>
        </div>
        <div style="text-align:left">
          <div style="font-size:22px;font-weight:900;color:#1a1a2e">فاتورة بيع</div>
          <div style="font-size:14px;color:#666;margin-top:2px">رقم: <strong>${invNo}</strong></div>
        </div>
      </div>

      <!-- Info -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
        <div style="background:#f8fafc;border-radius:8px;padding:14px 16px">
          <div style="font-size:11px;color:#888;margin-bottom:6px;font-weight:700">بيانات العميل</div>
          <div style="font-size:16px;font-weight:800">${customer}</div>
        </div>
        <div style="background:#f8fafc;border-radius:8px;padding:14px 16px">
          <div style="font-size:11px;color:#888;margin-bottom:6px;font-weight:700">بيانات الفاتورة</div>
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px">
            <span style="color:#666">رقم الملف</span><strong>${fileNo}</strong>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:13px">
            <span style="color:#666">تاريخ الإصدار</span><strong>${invDate}</strong>
          </div>
        </div>
      </div>

      <!-- Items Table -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <thead>
          <tr style="background:#1a1a2e;color:#fff">
            <th style="padding:10px 12px;text-align:center;font-size:12px">#</th>
            <th style="padding:10px 12px;font-size:12px">رقم الشاصي VIN</th>
            <th style="padding:10px 12px;font-size:12px">الموديل</th>
            <th style="padding:10px 12px;font-size:12px">السنة</th>
            <th style="padding:10px 12px;font-size:12px">اللون</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px">السعر</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <!-- Total -->
      <div style="display:flex;justify-content:flex-end;margin-bottom:32px">
        <div style="background:#1a1a2e;color:#fff;border-radius:10px;padding:14px 24px;min-width:220px">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
            <span>عدد السيارات</span><strong>${vehicles.length}</strong>
          </div>
          <div style="border-top:1px solid rgba(255,255,255,0.2);margin:8px 0"></div>
          <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:900">
            <span>الإجمالي</span>
            <span style="direction:ltr">${total.toLocaleString('en-US',{minimumFractionDigits:2})}</span>
          </div>
        </div>
      </div>

      <!-- Signatures -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;border-top:2px solid #e5e7eb;padding-top:24px">
        <div style="text-align:center">
          <div style="height:50px;border-bottom:1px solid #666;margin-bottom:8px"></div>
          <div style="font-size:12px;color:#666">توقيع المورد / البائع</div>
        </div>
        <div style="text-align:center">
          <div style="height:50px;border-bottom:1px solid #666;margin-bottom:8px"></div>
          <div style="font-size:12px;color:#666">توقيع العميل / المشتري</div>
        </div>
      </div>
    </div>`;

  // عرض في موديل
  el('invoice-modal-content').innerHTML = invoiceHTML;
  el('invoice-modal-title').textContent = `فاتورة ${invNo}`;
  openModal('invoiceModal');
}

function printInvoice() {
  const content = el('invoice-print-area')?.innerHTML;
  if (!content) return;
  openPrintOverlay(content, 'فاتورة بيع');
}

async function downloadInvoicePDF() {
  printInvoice();
  toast('💡 اضغط "طباعة" ثم اختر "حفظ كـ PDF"','ok');
}

function filterTxTable() {
  const q = el('tx-search')?.value?.toLowerCase() || '';
  const rows = document.querySelectorAll('#tx-tbody tr');
  rows.forEach(r => {
    r.style.display = !q || r.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

async function exportTxPDF() {
  const table = el('tx-data-table');
  if (!table) { toast('لا توجد بيانات','err'); return; }
  const cfg = TX_CONFIG[_txType];
  printDocument(`<h2 style="margin-bottom:16px">${cfg.icon} ${cfg.title}</h2>${table.outerHTML}`, cfg.title);
}

async function exportTxExcel() {
  if (!window._txRows?.length) { toast('لا توجد بيانات','err'); return; }
  const cfg = window._txCfg;
  const rows = window._txRows;
  const auditMap = window._txAuditMap || {};

  const headers2 = Object.keys(rows[0]).filter(k=>!k.startsWith('_'));
  headers2.push('created_by');
  const data = rows.map(r => {
    const row = headers2.slice(0,-1).map(k => r[k] ?? '');
    row.push(auditMap[String(r.id)] || '');
    return row;
  });

  exportToExcel([{ name: cfg.title, headers: headers2, data }], cfg.title + '_' + today());
}


function initApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';

  // User info
  const email = state.user?.email || 'user@tm.com';
  const name  = email.split('@')[0].replace('.', ' ');
  document.getElementById('userAvatar').textContent = name[0].toUpperCase();
  document.getElementById('userName').textContent = name;
  document.getElementById('userEmailDisplay').textContent = email;

  // تجديد الـ token تلقائياً كل 50 دقيقة
  if (window._tokenRefreshTimer) clearInterval(window._tokenRefreshTimer);
  window._tokenRefreshTimer = setInterval(async () => {
    const ok = await refreshAccessToken();
    if (!ok) console.warn('Auto-refresh failed — session expired');
  }, 50 * 60 * 1000);

  loadChartOfAccounts();
  loadDashboard().then(() => {
    // Restore last view after refresh
    const lastView = sessionStorage.getItem('tm_last_view');
    if (lastView === 'contacts') showContacts();
    else if (lastView === 'journal') showJournal();
    else if (lastView === 'activity') showActivityLog();
    else if (lastView === 'settings') showSettings();
    else if (lastView && lastView.startsWith('report:')) showReport(lastView.split(':')[1]);
    else showDashboard();
  });
  loadUserRoleFromDB();
  updateSystemUI();
}

// ════════════════════════════════════════
// SYSTEM SWITCH
// ════════════════════════════════════════
// Approval state
const approvalState = { all: [], filtered: [], currentType: 'all', currentItem: null, auditUsers: {} };

// تحميل شجرة الحسابات وتخزينها في cache
async function loadChartOfAccounts() {
  try {
    const rows = await apiGet('chart_of_accounts', {
      select: 'account_code,account_name,account_type,parent_code',
      system_type: `eq.${state.system}`,
      is_active: 'eq.true',
    });
    state.chartOfAccounts = {};
    (rows||[]).forEach(r => {
      state.chartOfAccounts[r.account_code] = {
        name: r.account_name,
        type: r.account_type,
        parent_code: r.parent_code,
      };
    });
  } catch(e) { console.warn('loadChartOfAccounts:', e.message); state.chartOfAccounts = {}; }
}

// جيب اسم الحساب من الـ cache
function getAccountName(code) {
  return state.chartOfAccounts[code]?.name || code;
}

function getAccountTypeCOA(code) {
  return state.chartOfAccounts[code]?.type || getAccountType(code);
}

function switchSystem(sys) {
  state.system = sys;
  state.currentFileNo = null;
  invalidateCache(); // إجبار إعادة تحميل بيانات النظام الجديد
  document.getElementById('sysBox').classList.toggle('active', sys === 'BOX');
  document.getElementById('sysTm').classList.toggle('active', sys === 'TM');
  updateSystemUI();
  loadChartOfAccounts();
  showDashboard(); // showDashboard تستدعي loadDashboard داخلياً
}

function updateSystemUI() {
  const sys = state.system;
  document.getElementById('topBarSub').textContent = `نظام ${sys}`;
  document.getElementById('nfSystemLabel').textContent = sys;
}

// ════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════
// ════════════════════════════════════════
// DASHBOARD — period-based
// ════════════════════════════════════════
const dashState = { days: 30, from: null, to: null };

function setDashPeriod(days) {
  // Update active button
  document.querySelectorAll('.dash-period-btn').forEach(b => b.classList.remove('active'));
  const btn = el('period-btn-' + days);
  if (btn) btn.classList.add('active');

  const customDates = el('dash-custom-dates');
  const now = new Date();
  const yr  = now.getFullYear();

  if (days === 'custom') {
    if (customDates) customDates.style.display = 'flex';
    const from = el('dash-from')?.value;
    const to   = el('dash-to')?.value;
    if (!from || !to) return;
    dashState.days = 'custom';
    dashState.from = from;
    dashState.to   = to;
  } else if (days === 'year') {
    if (customDates) customDates.style.display = 'none';
    dashState.days = 'year';
    dashState.from = `${yr}-01-01`;
    dashState.to   = `${yr}-12-31`;
  } else if (days === 'lastyear') {
    if (customDates) customDates.style.display = 'none';
    dashState.days = 'lastyear';
    dashState.from = `${yr-1}-01-01`;
    dashState.to   = `${yr-1}-12-31`;
  } else {
    if (customDates) customDates.style.display = 'none';
    dashState.days = days;
    const fromDate = new Date(Date.now() - days * 864e5);
    dashState.from = fromDate.toISOString().split('T')[0];
    dashState.to   = now.toISOString().split('T')[0];
  }

  // Update period label
  const labels = {7:'آخر 7 أيام', 30:'آخر 30 يوم', 60:'آخر 60 يوم', 90:'آخر 90 يوم', year:`سنة ${yr}`, lastyear:`سنة ${yr-1}`};
  if (el('dash-period-label')) {
    el('dash-period-label').textContent = days === 'custom'
      ? `${dashState.from} — ${dashState.to}`
      : labels[days] || '';
  }

  loadDashboard();
}

