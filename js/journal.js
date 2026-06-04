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
        return `<span style="font-size:10px;color:var(--text2);display:inline-block;margin-left:8px">${l.account_code||''} ${l.account_name||'—'}: ${side}</span>`;
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
        <div style="font-size:10px;color:var(--text2)">${groups[c.key].length} قيد</div>
      </div>
      <div class="j-kpi-val" style="color:${c.color}">${fmt(totals[c.key])}</div>
      <div style="font-size:9px;color:var(--text2);margin-top:3px">اضغط للتفاصيل</div>
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
            style="background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer;font-family:'Cairo',sans-serif;color:var(--text)">✕ إغلاق</button>
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
          style="background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer;font-family:'Cairo',sans-serif;color:var(--text)">✕ إغلاق</button>
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
              <span style="background:var(--card2);padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700">${cfg.label}</span>
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

async function printJournalVoucher(entryNo, entryType, fileNo, amount, date, title) {
  try {
    // جلب كل أسطر هذا القيد
    const lines = entryNo
      ? await apiGet('journal_entries', {
          select: 'account_code,account_name,dr_amount,cr_amount,description',
          system_type: `eq.${state.system}`,
          entry_no: `eq.${entryNo}`,
          order: 'id.asc',
        })
      : [];

    const typeLabelsVoucher = {
      purchase:'سند شراء', sale:'سند بيع', collection:'سند تحصيل',
      expense:'سند مصروف', payment:'سند دفع', payout:'سند صرف شريك', journal:'قيد يومية'
    };
    const voucherTitle = typeLabelsVoucher[entryType] || 'سند قيد';
    const printDate    = new Date().toLocaleDateString('ar-EG', { year:'numeric', month:'long', day:'numeric' });
    const voucherDate  = date ? new Date(date).toLocaleDateString('ar-EG', { year:'numeric', month:'long', day:'numeric' }) : '—';

    const totalDr = (lines||[]).reduce((s,l)=>s+(+l.dr_amount||0),0);
    const totalCr = (lines||[]).reduce((s,l)=>s+(+l.cr_amount||0),0);

    const linesHtml = (lines||[]).map((l,i) => `
      <tr>
        <td style="text-align:center;color:#666;font-size:11px">${i+1}</td>
        <td style="font-family:monospace;font-weight:700;color:#1a1a1a">${l.account_code||'—'}</td>
        <td>${l.account_name||'—'}</td>
        <td style="font-size:11px;color:#666">${l.description||'—'}</td>
        <td style="text-align:left;font-weight:700;color:#16a34a">${+l.dr_amount>0 ? (+l.dr_amount).toLocaleString('en-US',{minimumFractionDigits:3}) : '—'}</td>
        <td style="text-align:left;font-weight:700;color:#dc2626">${+l.cr_amount>0 ? (+l.cr_amount).toLocaleString('en-US',{minimumFractionDigits:3}) : '—'}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>${voucherTitle} — ${entryNo}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Segoe UI',Arial,sans-serif; color:#1a1a1a; font-size:13px; background:#fff; }
  .page { max-width:780px; margin:0 auto; padding:32px 36px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px; padding-bottom:16px; border-bottom:2px solid #1a1a1a; }
  .company { font-size:20px; font-weight:800; }
  .company-sub { font-size:12px; color:#666; margin-top:4px; }
  .voucher-title { text-align:left; }
  .voucher-title h1 { font-size:22px; font-weight:800; color:#1a1a1a; }
  .voucher-no { font-size:14px; font-weight:700; color:#c47a00; margin-top:4px; font-family:monospace; }
  .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:20px; }
  .info-box { background:#f8f9fa; border-radius:8px; padding:12px 14px; }
  .info-row { display:flex; justify-content:space-between; padding:3px 0; font-size:12px; border-bottom:1px solid #eee; }
  .info-row:last-child { border:none; }
  .info-label { color:#888; }
  .info-val { font-weight:700; }
  table { width:100%; border-collapse:collapse; margin-bottom:16px; }
  thead tr { background:#1a1a1a; color:#fff; }
  thead th { padding:9px 10px; font-size:11px; font-weight:700; text-align:right; }
  tbody tr { border-bottom:1px solid #eee; }
  tbody tr:nth-child(even) { background:#fafafa; }
  tbody td { padding:9px 10px; vertical-align:middle; }
  tfoot tr { background:#f0f0f0; font-weight:700; }
  tfoot td { padding:9px 10px; border-top:2px solid #1a1a1a; }
  .total-box { display:flex; justify-content:flex-end; margin-bottom:20px; }
  .total-inner { background:#1a1a1a; color:#fff; border-radius:10px; padding:14px 20px; min-width:220px; }
  .total-label { font-size:11px; color:#aaa; margin-bottom:3px; }
  .total-amount { font-size:20px; font-weight:900; }
  .balanced { font-size:11px; color:#4ade80; margin-top:4px; }
  .sig-row { display:grid; grid-template-columns:1fr 1fr 1fr; gap:30px; margin-top:30px; }
  .sig-box { text-align:center; padding-top:36px; border-top:1px solid #ccc; font-size:11px; color:#888; }
  .footer { text-align:center; margin-top:20px; padding-top:12px; border-top:1px solid #eee; font-size:10px; color:#aaa; }
  .no-print { text-align:center; margin-bottom:20px; display:flex; gap:10px; justify-content:center; }
  @media print { .no-print { display:none!important; } body { print-color-adjust:exact; -webkit-print-color-adjust:exact; } }
</style>
</head>
<body>
<div class="page">
  <div class="no-print">
    <button onclick="window.print()" style="background:#1a1a1a;color:#fff;border:none;padding:9px 24px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">🖨️ طباعة</button>
    <button onclick="window.close()" style="background:#f1f1f1;color:#333;border:1px solid #ddd;padding:9px 18px;border-radius:8px;font-size:13px;cursor:pointer">✕ إغلاق</button>
  </div>

  <div class="header">
    <div>
      <div class="company">Transit Co. · ترانزيت</div>
      <div class="company-sub">Kuwait · الكويت</div>
    </div>
    <div class="voucher-title">
      <h1>${voucherTitle}</h1>
      <div class="voucher-no"># ${entryNo||'—'}</div>
    </div>
  </div>

  <div class="info-grid">
    <div class="info-box">
      <div class="info-row"><span class="info-label">رقم السند</span><span class="info-val" style="color:#c47a00;font-family:monospace">${entryNo||'—'}</span></div>
      <div class="info-row"><span class="info-label">نوع العملية</span><span class="info-val">${voucherTitle}</span></div>
      <div class="info-row"><span class="info-label">تاريخ العملية</span><span class="info-val">${voucherDate}</span></div>
    </div>
    <div class="info-box">
      <div class="info-row"><span class="info-label">رقم الملف</span><span class="info-val" style="font-family:monospace">${fileNo||'—'}</span></div>
      <div class="info-row"><span class="info-label">البيان</span><span class="info-val">${title||'—'}</span></div>
      <div class="info-row"><span class="info-label">تاريخ الطباعة</span><span class="info-val">${printDate}</span></div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:36px">#</th>
        <th style="width:80px">كود الحساب</th>
        <th>اسم الحساب</th>
        <th>البيان</th>
        <th style="text-align:left">مدين (Dr)</th>
        <th style="text-align:left">دائن (Cr)</th>
      </tr>
    </thead>
    <tbody>${linesHtml||`<tr><td colspan="6" style="text-align:center;color:#888;padding:20px">لا توجد تفاصيل — المبلغ الإجمالي: ${amount?.toLocaleString?.('en-US',{minimumFractionDigits:3})||'—'}</td></tr>`}</tbody>
    <tfoot>
      <tr>
        <td colspan="4" style="text-align:right;font-weight:700">الإجمالي</td>
        <td style="text-align:left;color:#16a34a">${totalDr.toLocaleString('en-US',{minimumFractionDigits:3})}</td>
        <td style="text-align:left;color:#dc2626">${totalCr.toLocaleString('en-US',{minimumFractionDigits:3})}</td>
      </tr>
    </tfoot>
  </table>

  <div class="total-box">
    <div class="total-inner">
      <div class="total-label">إجمالي القيد / Total</div>
      <div class="total-amount">${(totalDr||amount||0).toLocaleString('en-US',{minimumFractionDigits:3})}</div>
      <div class="total-currency" style="font-size:11px;color:#aaa">KWD / د.ك</div>
      ${Math.abs(totalDr-totalCr)<0.01 ? '<div class="balanced">✓ القيد متوازن</div>' : '<div style="color:#f87171;font-size:11px">⚠ القيد غير متوازن</div>'}
    </div>
  </div>

  <div class="sig-row">
    <div class="sig-box">المحاسب / Accountant</div>
    <div class="sig-box">المراجع / Reviewer</div>
    <div class="sig-box">المدير / Manager</div>
  </div>

  <div class="footer">Transit Cars System · ${printDate} · رقم السند: ${entryNo||'—'}</div>
</div>
</body>
</html>`;

    openPrintOverlay(html);
  } catch(e) {
    toast('خطأ في طباعة القيد: ' + e.message, 'err');
  }
}


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

function printSection(title, subtitle, tableHtml, summaryHtml='') {
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Cairo',Arial,sans-serif;color:#1a1a1a;font-size:12px;background:#fff}
  .page{max-width:900px;margin:0 auto;padding:28px 32px}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1a1a1a;padding-bottom:16px;margin-bottom:20px}
  .co-name{font-size:20px;font-weight:900} .co-sub{font-size:11px;color:#888;margin-top:2px}
  .rep-title{text-align:left} .rep-title h1{font-size:22px;font-weight:900}
  .rep-title .sub{font-size:12px;color:#666;margin-top:4px}
  .summary{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}
  .s-box{background:#f8f9fa;border-radius:8px;padding:10px 16px;flex:1;min-width:120px}
  .s-box-label{font-size:10px;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
  .s-box-val{font-size:16px;font-weight:900;margin-top:3px}
  table{width:100%;border-collapse:collapse;margin-bottom:16px}
  thead tr{background:#1a1a1a;color:#fff}
  thead th{padding:9px 10px;font-size:11px;font-weight:700;text-align:right}
  tbody tr:nth-child(even){background:#fafafa}
  tbody td{padding:8px 10px;border-bottom:1px solid #eee;vertical-align:middle}
  tfoot td{padding:9px 10px;background:#f0f2f5;font-weight:700}
  .footer{text-align:center;padding-top:12px;border-top:1px solid #eee;color:#aaa;font-size:10px;margin-top:12px}
  .no-print{text-align:center;margin-bottom:16px;display:flex;gap:8px;justify-content:center}
  .no-print button{padding:9px 24px;border-radius:8px;font-family:'Cairo',sans-serif;font-size:13px;font-weight:700;cursor:pointer;border:none}
  @media print{.no-print{display:none!important}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
</style>
</head>
<body><div class="page">
  <div class="no-print">
    <button onclick="window.print()" style="background:#1a1a1a;color:#fff">🖨️ طباعة</button>
    <button onclick="window.close()" style="background:#f1f1f1;color:#333;border:1px solid #ddd">✕ إغلاق</button>
  </div>
  <div class="hdr">
    <div><div class="co-name">Transit Cars</div><div class="co-sub">الكويت</div></div>
    <div class="rep-title"><h1>${title}</h1><div class="sub">${subtitle}</div></div>
  </div>
  ${summaryHtml}
  ${tableHtml}
  <div class="footer">تم الإنشاء بتاريخ ${new Date().toLocaleDateString('en-GB')} · Transit Cars System</div>
</div></body></html>`;
  openPrintOverlay(html, title);
}

// ── Journal entry action helpers (avoid quote-escaping issues in templates) ──
function _jPrint(btn) {
  const p = btn.closest('.j-entry-actions') || btn.parentElement;
  printJournalVoucher(
    p.dataset.eno   || '',
    p.dataset.etype || '',
    p.dataset.fno   || '',
    parseFloat(p.dataset.amt) || 0,
    p.dataset.date  || '',
    p.dataset.etitle|| ''
  );
}
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
            <div style="font-size:11px;color:var(--text2)">${fmtDate(inv.date)}</div>
          </td>
          <td><div style="font-weight:600">${inv.customer||'—'}</div></td>
          <td class="mono text-amber" style="font-size:11px">${inv.fn}</td>
          <td style="font-size:12px;direction:ltr;color:var(--text2)">${vins}</td>
          <td style="text-align:center">
            <span style="background:var(--blue-dim);color:var(--blue);padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">${inv.items.length}</span>
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
