// ╔══════════════════════════════════════════════════════════╗
// ║  journal.js — Journal Page · Filters · Render           ║
// ║  Transit Management System — نقل حرفي، لا تعديل منطق   ║
// ╚══════════════════════════════════════════════════════════╝
// JOURNAL (صفحة اليومية)
// ════════════════════════════════════════
const journalState = {
  period: 'year',
  entries: [],
};

function showJournal() {
  sessionStorage.setItem('tm_last_view','journal');
  hideAllViews();
  el('journalView').style.display  = 'block';
  el('topBarTitle').textContent    = 'صفحة اليومية';
  el('topBarSub').textContent      = `نظام ${state.system}`;
  navActive('nav-journal');
  state.currentFileNo = null;
  // ✅ تفعيل زرار السنة الحالية عند الفتح
  document.querySelectorAll('.journal-period-btn').forEach(b => b.classList.remove('active'));
  el('jperiod-year')?.classList.add('active');
  loadJournal();
}

function setJournalPeriod(period) {
  journalState.period = period;
  document.querySelectorAll('.journal-period-btn').forEach(b => b.classList.remove('active'));
  el('jperiod-' + period)?.classList.add('active');
  const customWrap = el('jCustomDateWrap');
  if (period === 'custom') {
    customWrap.style.display = 'flex';
  } else {
    customWrap.style.display = 'none';
    loadJournal();
  }
}

function getJournalDateRange() {
  const pad = n => String(n).padStart(2,'0');
  const toDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const now = new Date();
  const yr  = now.getFullYear();

  if (journalState.period === 'today') {
    const t = toDate(now);
    return { from: t, to: t };
  }
  if (journalState.period === 'week') {
    const day  = now.getDay();
    const sun  = new Date(now); sun.setDate(now.getDate() - day);
    const sat  = new Date(sun); sat.setDate(sun.getDate() + 6);
    return { from: toDate(sun), to: toDate(sat) };
  }
  if (journalState.period === 'month') {
    const from = `${yr}-${pad(now.getMonth()+1)}-01`;
    const last = new Date(yr, now.getMonth()+1, 0);
    return { from, to: toDate(last) };
  }
  if (journalState.period === 'year') {
    return { from: `${yr}-01-01`, to: `${yr}-12-31` };
  }
  if (journalState.period === 'lastyear') {
    return { from: `${yr-1}-01-01`, to: `${yr-1}-12-31` };
  }
  if (journalState.period === 'custom') {
    return { from: el('jDateFrom').value, to: el('jDateTo').value };
  }
  return { from: toDate(now), to: toDate(now) };
}

async function loadJournal() {
  el('journalTimeline').innerHTML = `<div class="loading"><div class="spinner"></div><br>جاري تحميل اليومية من القيود...</div>`;
  el('journalKpis').innerHTML = '';

  const { from, to } = getJournalDateRange();
  if (!from || !to) {
    el('journalTimeline').innerHTML = `<div class="empty-state"><div class="e-icon">📅</div><p>اختر نطاق تاريخ</p></div>`;
    return;
  }

  try {
    const sys    = state.system;
    const toEOD  = to + 'T23:59:59';

    // ── مصدر واحد: journal_entries فقط ──
    const url = `${SB_URL}/rest/v1/journal_entries?system_type=eq.${encodeURIComponent(sys)}&entry_date=gte.${encodeURIComponent(from)}&entry_date=lte.${encodeURIComponent(toEOD)}&post_status=eq.posted&order=entry_date.desc,entry_no.desc&select=*&limit=5000`;

    let res = await fetch(url, { headers: headers() });
    // إعادة المحاولة تلقائياً لو JWT انتهت
    if (res.status === 401) {
      const ok = await refreshAccessToken();
      if (!ok) { el('journalTimeline').innerHTML = errHTML('انتهت الجلسة — يرجى تسجيل الدخول مجدداً'); return; }
      res = await fetch(url, { headers: headers() });
    }
    if (!res.ok) throw new Error(await res.text());
    const jeRows = await res.json();

    // ── ربط نوع العملية بـ ref_table ──
    const RT = {
      'purchase_orders':    { type:'purchase',   sign:-1, icon:'📋', color:'var(--accent)',  label:'شراء'           },
      'sales':              { type:'sale',        sign:+1, icon:'🤝', color:'var(--green)',   label:'بيع'            },
      'collections':        { type:'collection',  sign:+1, icon:'💰', color:'var(--blue)',    label:'تحصيل'          },
      'payments':           { type:'payment',     sign:-1, icon:'💳', color:'var(--cyan)',    label:'دفعة مورد'      },
      'expenses':           { type:'expense',     sign:-1, icon:'💸', color:'var(--red)',     label:'مصروف'          },
      'partner_payouts':    { type:'payout',      sign:-1, icon:'👥', color:'var(--purple)',  label:'صرف شريك'       },
      'operating_expenses': { type:'opex',        sign:-1, icon:'💼', color:'var(--purple)',  label:'مصروف تشغيلي'   },
      'manual':             { type:'manual',      sign: 0, icon:'✍️', color:'var(--text)',    label:'يدوي'           },
    };

    // ── تجميع بـ entry_no ──
    const grouped = {};
    jeRows.forEach(r => {
      const no = r.entry_no || `single_${r.id}`;
      if (!grouped[no]) {
        const cfg = RT[r.ref_table] || RT['manual'];
        grouped[no] = { no, date: r.entry_date, desc: r.description,
          file_no: r.file_no, ref_table: r.ref_table,
          type: cfg.type, sign: cfg.sign, icon: cfg.icon,
          color: cfg.color, label: cfg.label,
          lines: [], totalDr: 0, totalCr: 0 };
      }
      grouped[no].lines.push(r);
      grouped[no].totalDr += +r.dr_amount || 0;
      grouped[no].totalCr += +r.cr_amount || 0;
    });

    // ── تحويل إلى entries متوافقة مع renderJournalEntries ──
    const entries = Object.values(grouped).map(g => {
      // بناء meta من أسطر القيد
      const meta = g.lines.map(l => {
        const side = l.dr_amount > 0
          ? `<span style="color:var(--green)">مدين ${fmt(l.dr_amount)}</span>`
          : `<span style="color:var(--red)">دائن ${fmt(l.cr_amount)}</span>`;
        return `<span style="font-size:12px;color:var(--text2);display:inline-block;margin-left:8px">${l.account_code||''} ${l.account_name||'—'}: ${side}</span>`;
      });
      return {
        type:    g.type, date: g.date,
        amount:  g.totalDr, sign: g.sign,
        title:   g.desc || '—',
        entryNo: g.no,  fileNo: g.file_no,
        meta,   raw: g,
        status: 'posted',
      };
    }).sort((a,b) => (b.date||'').localeCompare(a.date||''));

    journalState.entries = entries;
    renderJournalKpis(entries);
    renderJournalEntries();
    loadJournalDrafts();
  } catch(e) {
    el('journalTimeline').innerHTML = errHTML('خطأ في تحميل اليومية: ' + e.message);
    console.error(e);
  }
}

function renderJournalKpis(entries) {
  const groups = {
    purchase:   entries.filter(e=>e.type==='purchase'),
    sale:       entries.filter(e=>e.type==='sale'),
    expenses:   entries.filter(e=>e.type==='expense'||e.type==='opex'),
    collection: entries.filter(e=>e.type==='collection'),
    payment:    entries.filter(e=>e.type==='payment'),
    payout:     entries.filter(e=>e.type==='payout'),
  };
  const totals = {
    purchase:   groups.purchase.reduce((s,e)=>s+e.amount,0),
    sale:       groups.sale.reduce((s,e)=>s+e.amount,0),
    expenses:   groups.expenses.reduce((s,e)=>s+e.amount,0),
    collection: groups.collection.reduce((s,e)=>s+e.amount,0),
    payment:    groups.payment.reduce((s,e)=>s+e.amount,0),
    payout:     groups.payout.reduce((s,e)=>s+e.amount,0),
  };
  const config = [
    { key:'purchase', label:'مشتريات',    icon:'📋', color:'var(--accent)', filterVal:'purchase'   },
    { key:'sale',     label:'مبيعات',      icon:'🧾', color:'var(--green)',  filterVal:'sale'       },
    { key:'expenses', label:'مصاريف',      icon:'💸', color:'var(--red)',    filterVal:'expense'    },
    { key:'collection', label:'تحصيلات',  icon:'💰', color:'var(--blue)',   filterVal:'collection' },
    { key:'payment',  label:'دفعات مورد', icon:'💳', color:'var(--cyan)',   filterVal:'payment'    },
    { key:'payout',   label:'صرف شركاء',  icon:'👥', color:'var(--purple)', filterVal:'payout'     },
  ];

  el('journalKpis').innerHTML = config.map(c => `
    <div class="j-kpi" id="jkpi-${c.key}"
      onclick="filterJournalByType('${c.filterVal}', '${c.key}')"
      style="cursor:pointer;border-right:3px solid ${c.color};transition:all .15s"
      onmouseover="this.style.background='var(--card2)'"
      onmouseout="this.style.background=''">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <div class="j-kpi-label">${c.icon} ${c.label}</div>
        <div style="font-size:12px;color:var(--text2)">${groups[c.key].length} قيد</div>
      </div>
      <div class="j-kpi-val" style="color:${c.color}">${fmt(totals[c.key])}</div>
      <div style="font-size:13px;color:var(--text2);margin-top:3px">اضغط للتفاصيل</div>
    </div>`).join('');

  // Detail panel
  if (!el('jkpi-detail')) {
    const panel = document.createElement('div');
    panel.id = 'jkpi-detail';
    panel.style.cssText = 'display:none;margin-bottom:14px;background:var(--card);border:2px solid var(--accent);border-radius:var(--radius);padding:14px 16px;animation:fadeSlideIn .2s ease';
    el('journalKpis').after(panel);
  }
}

function filterJournalByType(filterVal, key) {
  // Toggle — لو نفس البند اضغطت تاني يغلق
  const panel = el('jkpi-detail');
  const sel   = el('jTypeFilter');

  // Remove active from all
  document.querySelectorAll('[id^="jkpi-"]').forEach(k => {
    k.style.borderWidth = '3px';
    k.style.boxShadow   = '';
  });

  if (panel._activeKey === key) {
    panel.style.display  = 'none';
    panel._activeKey     = null;
    if (sel) { sel.value = 'all'; renderJournalEntries(); }
    return;
  }

  // Set active
  panel._activeKey = key;
  const activeEl = el('jkpi-' + key);
  if (activeEl) { activeEl.style.borderWidth = '3px'; activeEl.style.boxShadow = '0 0 0 2px var(--accent)'; }

  // Filter timeline
  if (sel) {
    sel.value = filterVal;
    renderJournalEntries();
  }

  // Build detail table
  const entries = journalState.entries.filter(e => {
    if (key === 'expenses') return e.type==='expense'||e.type==='opex';
    return e.type === filterVal;
  });

  const configs = {
    purchase:   { color:'var(--accent)',  title:'📋 تفاصيل المشتريات' },
    sale:       { color:'var(--green)',   title:'🧾 تفاصيل المبيعات' },
    expenses:   { color:'var(--red)',     title:'💸 تفاصيل المصاريف' },
    collection: { color:'var(--blue)',    title:'💰 تفاصيل التحصيلات' },
    payment:    { color:'var(--cyan)',    title:'💳 تفاصيل دفعات المورد' },
    payout:     { color:'var(--purple)',  title:'👥 تفاصيل صرف الشركاء' },
  };
  const cfg   = configs[key] || { color:'var(--text)', title:'تفاصيل' };
  const total = entries.reduce((s,e)=>s+e.amount,0);

  // أعمدة مخصصة حسب النوع
  const isPurchase = key === 'purchase';
  const isSale = key === 'sale';

  // ── المبيعات: جيب من Supabase مباشرة بنفس شكل جدول المبيعات جوا الملف ──
  if (isSale) {
    panel.style.display = 'block';
    panel.style.borderColor = cfg.color;
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="font-size:13px;font-weight:700">${cfg.title}</div>
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:13px;font-weight:700;color:${cfg.color};font-family:monospace">${fmt(total)}</span>
          <button onclick="document.getElementById('jkpi-detail').style.display='none';document.getElementById('jkpi-detail')._activeKey=null;document.getElementById('jTypeFilter').value='all';renderJournalEntries()"
            style="background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:3px 10px;font-size:13px;cursor:pointer;font-family:'Cairo',sans-serif;color:var(--text)">✕ إغلاق</button>
        </div>
      </div>
      <div id="jkpi-sale-detail-body"><div class="loading"><div class="spinner"></div></div></div>`;
    _loadJournalSalesDetail(entries);
    return;
  }

  const colHeaders = isPurchase
    ? '<th>التاريخ</th><th>الملف</th><th>المورد</th><th>عدد السيارات</th><th>إجمالي الشراء</th>'
    : '<th>التاريخ</th><th>البيان</th><th>الملف</th><th>طريقة الدفع</th><th>المبلغ</th>';

  panel.style.display = 'block';
  panel.style.borderColor = cfg.color;
  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <div style="font-size:13px;font-weight:700">${cfg.title}</div>
      <div style="display:flex;align-items:center;gap:12px">
        <span style="font-size:13px;font-weight:700;color:${cfg.color};font-family:monospace">${fmt(total)}</span>
        <button onclick="document.getElementById('jkpi-detail').style.display='none';document.getElementById('jkpi-detail')._activeKey=null;document.getElementById('jTypeFilter').value='all';renderJournalEntries()"
          style="background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:3px 10px;font-size:13px;cursor:pointer;font-family:'Cairo',sans-serif;color:var(--text)">✕ إغلاق</button>
      </div>
    </div>
    ${entries.length ? `
    <div style="max-height:280px;overflow-y:auto">
      <table class="data-table" style="font-size:12px">
        <thead><tr>${colHeaders}</tr></thead>
        <tbody>
          ${entries.map(e => {
            const r = e.raw || {};
            const fileNo = e.fileNo||r.file_no||'—';
            const clickAttr = fileNo!=='—' ? `onclick="openViewer('${fileNo}')" style="cursor:pointer"` : '';
            if (isPurchase) {
              return `<tr ${clickAttr}>
                <td class="mono">${fmtDate(e.date)}</td>
                <td class="mono text-amber" style="font-weight:700">${fileNo}</td>
                <td>${r.supplier||e.title?.replace('سند شراء — ','')||'—'}</td>
                <td style="text-align:center">${r.vehicle_count||'—'}</td>
                <td class="mono" style="font-weight:900;color:var(--accent)">${fmt(e.amount)}</td>
              </tr>`;
            }

            const method = r.pay_method||r.method||'—';
            return `<tr ${clickAttr}>
              <td class="mono">${fmtDate(e.date)}</td>
              <td>${e.title||'—'}</td>
              <td class="mono text-amber">${fileNo}</td>
              <td>${method}</td>
              <td class="mono" style="font-weight:700;color:${cfg.color}">${fmt(e.amount)}</td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot>
          <tr style="background:var(--card2);font-weight:700">
            <td colspan="4">الإجمالي — ${entries.length} قيد</td>
            <td class="mono" style="color:${cfg.color}">${fmt(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>` : `<div class="empty-state" style="padding:20px"><div class="e-icon">📭</div><p>لا توجد عمليات</p></div>`}`;
}

function renderJournalEntries() {
  const typeFilter = el('jTypeFilter')?.value || 'all';
  let entries = journalState.entries;
  if (typeFilter === 'expense') {
    // مصاريف الصفقات + المصاريف التشغيلية معاً
    entries = entries.filter(e => e.type === 'expense' || e.type === 'opex');
  } else if (typeFilter !== 'all') {
    entries = entries.filter(e => e.type === typeFilter);
  }

  if (!entries.length) {
    el('journalTimeline').innerHTML = `<div class="empty-state"><div class="e-icon">📅</div><p>لا توجد عمليات في هذه الفترة</p></div>`;
    return;
  }

  // Group by date
  const groups = {};
  entries.forEach(e => {
    const d = (e.date||'').split('T')[0];
    if (!groups[d]) groups[d] = [];
    groups[d].push(e);
  });

  const typeConfig = {
    purchase:   { icon:'📋', bg:'var(--accent-dim)', label:'سند شراء', amountColor:'var(--accent)' },
    sale:       { icon:'🤝', bg:'var(--green-dim)',   label:'بيع',            amountColor:'var(--green)'  },
    collection: { icon:'💰', bg:'var(--blue-dim)',    label:'تحصيل',          amountColor:'var(--blue)'   },
    expense:    { icon:'💸', bg:'var(--red-dim)',     label:'مصروف',          amountColor:'var(--red)'    },
    payment:    { icon:'💳', bg:'var(--cyan-dim)',    label:'دفعة مورد',      amountColor:'var(--cyan)'   },
    payout:     { icon:'👥', bg:'var(--purple-dim)',  label:'صرف شريك',       amountColor:'var(--purple)' },
    opex:       { icon:'💼', bg:'var(--purple-dim)',  label:'مصروف عام',         amountColor:'var(--purple)' },
  };

  let html = '';
  Object.keys(groups).sort((a,b)=>b.localeCompare(a)).forEach(date => {
    const dayEntries = groups[date];
    const dayIn  = dayEntries.filter(e=>e.sign>0).reduce((s,e)=>s+e.amount,0);
    const dayOut = dayEntries.filter(e=>e.sign<0).reduce((s,e)=>s+e.amount,0);
    const dayNet = dayIn - dayOut;

    html += `<div class="journal-day-group">
      <div class="journal-day-header">
        <span class="journal-day-label">${fmtDate(date)}</span>
        <div class="journal-day-line"></div>
        <span class="journal-day-total" style="color:${dayNet>=0?'var(--green)':'var(--red)'}">
          صافي: ${dayNet>=0?'+':''}${fmt(dayNet)}
        </span>
      </div>`;

    dayEntries.forEach(e => {
      const cfg = typeConfig[e.type] || { icon:'📌', bg:'var(--card2)', label:e.type, amountColor:'var(--text)' };
      const metaFiltered = (e.meta||[]).filter(Boolean).join(' · ');
      const amountSign = e.sign > 0 ? '+' : '-';
      html += `
        <div class="j-entry j-type-${e.type}${e.status==='draft'?' is-draft':''}" style="cursor:pointer"
          onclick="${e.fileNo ? `openViewer('${e.fileNo}')` : ''}">
          <div class="j-entry-icon" style="background:${cfg.bg}">${cfg.icon}</div>
          <div class="j-entry-body">
            <div class="j-entry-title">
              ${e.title}
              ${e.status==='draft'?'<span class="draft-badge" style="margin-right:6px">مسودة</span>':''}
            </div>
            <div class="j-entry-meta">
              <span style="background:var(--card2);padding:1px 7px;border-radius:10px;font-size:12px;font-weight:700">${cfg.label}</span>
              ${metaFiltered}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <div class="j-entry-amount" style="color:${cfg.amountColor}">
              ${amountSign}${fmt(e.amount)}
            </div>
            <span class="j-entry-actions"
              data-eno="${e.entryNo||''}"
              data-etype="${e.type}"
              data-fno="${e.fileNo||''}"
              data-amt="${e.amount}"
              data-date="${e.date||''}"
              data-etitle="${(e.title||'')}">
              <button onclick="event.stopPropagation();_jPrint(this)" 
                style="background:var(--card2);border:1px solid var(--border);cursor:pointer;color:var(--text2);font-size:12px;padding:3px 8px;border-radius:6px" title="طباعة سند القيد">🖨️</button>
              <button onclick="event.stopPropagation();_jEdit(this)"
                style="background:none;border:none;cursor:pointer;color:var(--text2);font-size:13px;padding:2px 4px" title="تعديل">✏️</button>
            </span>
          </div>
        </div>`;
    });

    html += `</div>`;
  });

  el('journalTimeline').innerHTML = html;
}

// ════════════════════════════════════════
// ════════════════════════════════════════
// LEDGER ENGINE — auto-creates entries
// ════════════════════════════════════════
const typeLabels = { customer:'عميل', supplier:'مورد', partner:'شريك', custodian:'عهدة' };

// printJournalVoucher → js/print.js



// ════════════════════════════════════════
// REFERENCE NUMBERS & EXPORT HELPERS
// ════════════════════════════════════════

async function genSeqRef(prefix, sys, fileNo, table) {
  const safe = (fileNo || 'GEN').toString().replace(/[^A-Za-z0-9\-]/g,'');
  try {
    const rows = await apiGet(table, { select:'id', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, limit:1000 });
    const next = ((rows && rows.length) || 0) + 1;
    return `${prefix}-${safe}-${String(next).padStart(3,'0')}`;
  } catch(e) {
    return `${prefix}-${safe}-${String(Date.now()).slice(-5)}`;
  }
}

function exportCSV(headers, rows, filename) {
  const csv = [headers, ...rows]
    .map(r => r.map(v => `"${String(v==null?'':v).replace(/"/g,'""')}"`).join(','))
    .join('\n');
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename + '.csv';
  a.click();
}

// printSection → js/print.js


// ── Journal entry action helpers (avoid quote-escaping issues in templates) ──
// _jPrint → js/print.js

function _jEdit(btn) {
  const p = btn.closest('.j-entry-actions') || btn.parentElement;
  editJournalEntry(p.dataset.etype || '', null, p.dataset.fno || '');
}

// ════════════════════════════════════════
// JOURNAL SALES DETAIL — نفس شكل جدول المبيعات جوا الملف
// ════════════════════════════════════════
async function _loadJournalSalesDetail(entries) {
  const wrap = document.getElementById('jkpi-sale-detail-body');
  if (!wrap) return;

  try {
    const sys = state.system;
    // استخرج كل الملفات الفريدة من الـ entries
    const fileNos = [...new Set(entries.map(e => e.fileNo).filter(Boolean))];

    // جيب كل المبيعات للملفات دي في الفترة الزمنية المحددة
    const { from, to } = getJournalDateRange();
    let allSales = [];
    for (const fn of fileNos) {
      try {
        const rows = await apiGetAll('sales', {
          select: '*',
          system_type: `eq.${sys}`,
          file_no: `eq.${fn}`,
          order: 'sale_date.desc'
        });
        // فلتر بالفترة الزمنية
        const filtered = (rows||[]).filter(s => {
          const d = (s.sale_date||'').slice(0,10);
          return (!from || d >= from) && (!to || d <= to);
        });
        allSales = allSales.concat(filtered);
      } catch(e) { console.warn('_loadJournalSalesDetail:', e.message); }
    }

    if (!allSales.length) {
      wrap.innerHTML = `<div class="empty-state" style="padding:20px"><div class="e-icon">📭</div><p>لا توجد مبيعات</p></div>`;
      return;
    }

    // تجميع بالفاتورة — نفس منطق loadSalesTab
    const invoices = {};
    allSales.forEach(s => {
      const k = s.inv_no || `__${s.id}__`;
      if (!invoices[k]) invoices[k] = { inv_no:s.inv_no, customer:s.customer, date:s.sale_date, fn:s.file_no, items:[] };
      invoices[k].items.push(s);
    });

    const total = allSales.reduce((sum,s) => sum + (+s.sale_price||0), 0);

    const rows = Object.values(invoices)
      .sort((a,b) => (b.date||'').localeCompare(a.date||''))
      .map(inv => {
        const invTotal = inv.items.reduce((s,i) => s+(+i.sale_price||0), 0);
        const vins = inv.items.map(i => i.vin||'—').join('، ');
        const safeInv = (inv.inv_no||'').replace(/'/g,"\\'");
        return `<tr style="cursor:pointer" onclick="openInvoiceModal('${safeInv}')"
          onmouseover="this.style.background='var(--card2)'" onmouseout="this.style.background=''">
          <td>
            <div class="mono text-amber" style="font-weight:700">${inv.inv_no||'—'}</div>
            <div style="font-size:13px;color:var(--text2)">${fmtDate(inv.date)}</div>
          </td>
          <td><div style="font-weight:600">${inv.customer||'—'}</div></td>
          <td class="mono text-amber" style="font-size:13px">${inv.fn}</td>
          <td style="font-size:12px;direction:ltr;color:var(--text2)">${vins}</td>
          <td style="text-align:center">
            <span style="background:var(--blue-dim);color:var(--blue);padding:2px 8px;border-radius:10px;font-size:13px;font-weight:700">${inv.items.length}</span>
          </td>
          <td class="mono text-green" style="font-weight:700">${fmt(invTotal)}</td>
        </tr>`;
      }).join('');

    wrap.innerHTML = `
      <div style="max-height:320px;overflow-y:auto">
        <table class="data-table" style="font-size:12px">
          <thead><tr>
            <th>رقم الفاتورة</th><th>العميل</th><th>الملف</th>
            <th>VINs</th><th style="text-align:center">سيارات</th><th>الإجمالي</th>
          </tr></thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr style="background:var(--card2);font-weight:700">
              <td colspan="5">الإجمالي (${Object.keys(invoices).length} فاتورة)</td>
              <td class="mono text-green">${fmt(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
  } catch(e) {
    const wrap2 = document.getElementById('jkpi-sale-detail-body');
    if (wrap2) wrap2.innerHTML = errHTML('خطأ: ' + e.message);
  }
}
