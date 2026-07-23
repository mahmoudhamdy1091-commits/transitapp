// ╔══════════════════════════════════════════════════════════╗
// ║  journal.js — Journal Page · Filters · Render           ║
// ║  Transit Management System — نقل حرفي، لا تعديل منطق   ║
// ╚══════════════════════════════════════════════════════════╝
// JOURNAL (صفحة اليومية)
// ════════════════════════════════════════
export const journalState = {
  period: 'year',
  entries: [],
};

export function showJournal() {
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

export function setJournalPeriod(period) {
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

export function getJournalDateRange() {
  if (journalState.period === 'custom') {
    return { from: el('jDateFrom').value, to: el('jDateTo').value };
  }
  // ✅ المصدر الموحّد: getPeriodDates (periods.js) — Phase 1
  const { from, to } = getPeriodDates(journalState.period);
  if (from && to) return { from, to };
  const pad = n => String(n).padStart(2,'0');
  const now = new Date();
  const td  = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  return { from: td, to: td };
}

export async function loadJournal() {
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

    const res = await apiFetch(url, {});
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
          file_no: r.file_no, ref_table: r.ref_table, ref_id: r.ref_id,
          type: cfg.type, sign: cfg.sign, icon: cfg.icon,
          color: cfg.color, label: cfg.label, postedAt: r.posted_at || r.created_at,
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
      // ✅ قيمة سند البيع = صافي الإيراد على حسابات 4xxx: cr − dr
      // قيد البيع مركّب (إيراد + COGS) فمجموع المدين يضخّم القيمة وKPI المبيعات.
      // القيد العكسي (عكس بيع): 4100 مدين → netRev سالب → يُطرح من إجمالي المبيعات
      let displayAmount = g.totalDr;
      if (g.type === 'sale') {
        const netRev = g.lines.reduce((s,l) => s + ((l.account_code||'').startsWith('4') ? ((+l.cr_amount||0) - (+l.dr_amount||0)) : 0), 0);
        if (netRev !== 0) displayAmount = netRev;
      }
      return {
        type:    g.type, date: g.date, postedAt: g.postedAt,
        amount:  displayAmount, sign: g.sign,
        title:   g.desc || '—',
        entryNo: g.no,  fileNo: g.file_no, refId: g.ref_id,
        meta,   raw: g,
        status: 'posted',
      };
    }).sort((a,b) => (b.date||'').localeCompare(a.date||''));

    // ✅ journalState.entries تبقى كاملة بلا فلترة — عليها تعتمد كروت KPI ولوحة
    // "عرض التفاصيل" عند الضغط على كارت (filterJournalByType)، ولازم تطابق نفس
    // الإجمالي المعروض في الكارت. فلتر استبعاد أزواج (قيد أصلي + قيد عكسه) يُطبَّق
    // فقط عند نقطة العرض في renderJournalEntries() (القائمة الزمنية) وshowJournalReport()
    // (تقرير اليومية) — أي view آخر يستخدم journalState.entries لا يتأثر.
    journalState.entries = entries;
    // ✅ حفظ نطاق التاريخ الفعلي لهذه البيانات حتى يطابقه تقرير الطباعة دائماً
    journalState.loadedFrom = from;
    journalState.loadedTo   = to;
    renderJournalKpis(entries);
    renderJournalEntries();
    loadJournalDrafts();
  } catch(e) {
    el('journalTimeline').innerHTML = errHTML('خطأ في تحميل اليومية: ' + e.message);
    console.error(e);
  }
}

export function renderJournalKpis(entries) {
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

export function filterJournalByType(filterVal, key) {
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

export function renderJournalEntries() {
  const typeFilter = el('jTypeFilter')?.value || 'all';
  // ✅ فلتر عرض فقط لهذه القائمة الزمنية — يستبعد أزواج (قيد أصلي + قيد عكسه)
  // (voided بقيد عكسي). journalState.entries نفسها تبقى كاملة (تعتمد عليها
  // كروت KPI ولوحة "عرض التفاصيل" — انظر التعليق في loadJournal أعلاه).
  let entries = _excludeReversalPairs(journalState.entries);
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

    html += `<div class="journal-day-group">
      <div class="journal-day-header">
        <span class="journal-day-label">${fmtDate(date)}</span>
        <div class="journal-day-line"></div>
        <span class="journal-day-total">
          ${dayEntries.length} عملية
        </span>
      </div>`;

    // ✅ تجميع بصري فقط: قيود "بيع" متكررة لنفس الفاتورة (نفس fileNo+رقم الفاتورة)
    // تُعرض كسطر واحد قابل للتوسعة بدل تكرارها — المجموع محسوب من e.amount الفعلية
    // (لا تغيير على journalState.entries ولا على dayIn/dayOut/dayNet أدناه، المحسوبة قبل هذا التجميع)
    const invoiceGroups = {};
    const renderOrder = [];
    dayEntries.forEach(e => {
      let key = e.entryNo || `_solo_${renderOrder.length}`;
      if (e.type === 'sale') {
        const token = _extractInvToken(e.title);
        if (token) key = `${e.fileNo||''}::${token}`;
      }
      if (!invoiceGroups[key]) { invoiceGroups[key] = []; renderOrder.push(key); }
      invoiceGroups[key].push(e);
    });

    renderOrder.forEach(key => {
      const items = invoiceGroups[key];
      if (items.length === 1) {
        html += _renderSingleJournalEntry(items[0]);
      } else {
        html += _renderGroupedSaleEntries(items, key, typeConfig);
      }
    });

    html += `</div>`;
  });

  el('journalTimeline').innerHTML = html;
}

// استخراج رقم الفاتورة من وصف القيد — يتوقف عند أول em-dash (" — ") أو نهاية النص
// (يتطابق مع صيغة الوصف في je_sale: "فاتورة INV-..." أو "بيع فاتورة INV-... — العميل — ملف ...")
export function _extractInvToken(desc) {
  const m = (desc||'').match(/INV-[\s\S]*?(?=\s—|$)/);
  return m ? m[0].trim() : null;
}

// ════════════════════════════════════════════════════════════════
// استبعاد أزواج (قيد أصلي + قيد عكسه) من عرض اليومية/تقريرها فقط —
// عرض فقط، لا تعديل على journal_entries ولا على دفتر الأستاذ/الأرصدة.
//
// لا يوجد عمود ربط مباشر (reversed_by/reverses) يُعبّأ من أي مسار عكس في
// التطبيق حتى الآن — الإسناد هنا بأفضل مجهود متاح:
//  Tier 1 (موثوق): ref_id — voidTransaction (تحصيل/دفعة/مصروف/صرف شريك)
//    وvoidPurchaseOrder يمرّرون نفس refId للقيد الأصلي وقيد عكسه، فنطابق به.
//  Tier 2: البيع (je_sale/voidSaleInvoice لا يستخدمان ref_id إطلاقاً) —
//    مطابقة نصية برقم الفاتورة (INV-...) المستخرج من الوصف + رقم الملف.
//  Tier 3: القيد اليدوي المُعكوس عبر reverseManualJE — "عكس قيد {entry_no}".
//
// أي قيد ref_table='reversal' يُستبعد دائماً (ليس "نشاطاً" قائماً بذاته)،
// وإن أمكن تحديد القيد الأصلي المقابل له ضمن نفس البيانات المحمّلة يُستبعد معه.
// ════════════════════════════════════════════════════════════════
export function _excludeReversalPairs(entries) {
  const reversals = entries.filter(e => e.raw?.ref_table === 'reversal');
  if (!reversals.length) return entries;

  const toExclude = new Set(reversals.map(e => e.entryNo));

  const REF_ID_SOURCE = [
    { re:/^عكس تحصيل/,    type:'collection' },
    { re:/^عكس دفعة/,     type:'payment'    },
    { re:/^عكس مصروف/,    type:'expense'    },
    { re:/^عكس صرف شريك/, type:'payout'     },
    { re:/^عكس شراء/,     type:'purchase'   },
  ];

  reversals.forEach(rev => {
    const desc = rev.title || '';

    // Tier 1 — ref_id مباشر
    if (rev.refId) {
      const src = REF_ID_SOURCE.find(s => s.re.test(desc));
      if (src) {
        entries.forEach(e => {
          if (e.type === src.type && e.refId === rev.refId) toExclude.add(e.entryNo);
        });
        return;
      }
    }

    // Tier 2 — عكس بيع (فاتورة كاملة) — لا ref_id، مطابقة برقم الفاتورة + الملف
    if (/^عكس (بيع فاتورة|\+ حذف فاتورة)/.test(desc)) {
      const token = _extractInvToken(desc);
      if (token) {
        entries.forEach(e => {
          if (e.type === 'sale' && e.fileNo === rev.fileNo && _extractInvToken(e.title) === token) {
            toExclude.add(e.entryNo);
          }
        });
      }
      return;
    }

    // Tier 3 — عكس قيد يدوي: "عكس قيد {entry_no}"
    const manualMatch = desc.match(/^عكس قيد (.+)$/);
    if (manualMatch) {
      const targetNo = manualMatch[1].trim();
      entries.forEach(e => {
        if (e.type === 'manual' && e.entryNo === targetNo) toExclude.add(e.entryNo);
      });
    }
  });

  return entries.filter(e => !toExclude.has(e.entryNo));
}

export function _renderSingleJournalEntry(e) {
  const typeConfig = {
    purchase:   { icon:'📋', bg:'var(--accent-dim)', label:'سند شراء', amountColor:'var(--accent)' },
    sale:       { icon:'🤝', bg:'var(--green-dim)',   label:'بيع',            amountColor:'var(--green)'  },
    collection: { icon:'💰', bg:'var(--blue-dim)',    label:'تحصيل',          amountColor:'var(--blue)'   },
    expense:    { icon:'💸', bg:'var(--red-dim)',     label:'مصروف',          amountColor:'var(--red)'    },
    payment:    { icon:'💳', bg:'var(--cyan-dim)',    label:'دفعة مورد',      amountColor:'var(--cyan)'   },
    payout:     { icon:'👥', bg:'var(--purple-dim)',  label:'صرف شريك',       amountColor:'var(--purple)' },
    opex:       { icon:'💼', bg:'var(--purple-dim)',  label:'مصروف عام',         amountColor:'var(--purple)' },
  };
  const cfg = typeConfig[e.type] || { icon:'📌', bg:'var(--card2)', label:e.type, amountColor:'var(--text)' };
  const metaFiltered = (e.meta||[]).filter(Boolean).join(' · ');
  const amountSign = (e.sign < 0 || e.amount < 0) ? '-' : '+';
  return `
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
              ${e.postedAt ? `<span style="color:var(--text2)">🕐 ${fmtTime(e.postedAt)}</span>` : ''}
              ${metaFiltered}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <div class="j-entry-amount" style="color:${cfg.amountColor}">
              ${amountSign}${fmt(Math.abs(e.amount))}
            </div>
            <span class="j-entry-actions"
              data-eno="${e.entryNo||''}"
              data-etype="${e.type}"
              data-fno="${e.fileNo||''}"
              data-amt="${e.amount}"
              data-date="${e.date||''}"
              data-etitle="${(e.title||'')}"
              data-erefid="${e.refId||''}">
              <button class="btn-ctx-menu" onclick="event.stopPropagation();_ctxJournal(this)"
                style="background:var(--card2);border:1px solid var(--border);cursor:pointer;color:var(--text2);font-size:14px;padding:3px 8px;border-radius:6px" title="إجراءات">⋮</button>
            </span>
          </div>
        </div>`;
}

export let _jGroupSeq = 0;
export function _renderGroupedSaleEntries(items, key, typeConfig) {
  const cfg = typeConfig['sale'];
  const groupTotal = items.reduce((s,e)=>s+e.amount,0);
  const amountSign = groupTotal < 0 ? '-' : '+';
  const token = _extractInvToken(items[0].title) || items[0].title;
  const gid = `jgrp-${++_jGroupSeq}`;
  const detailsHtml = items.map(e => _renderSingleJournalEntry(e)).join('');
  return `
        <div class="j-entry j-type-sale" style="cursor:default">
          <div class="j-entry-icon" style="background:${cfg.bg}">${cfg.icon}</div>
          <div class="j-entry-body">
            <div class="j-entry-title">${token}</div>
            <div class="j-entry-meta">
              <span style="background:var(--card2);padding:1px 7px;border-radius:10px;font-size:12px;font-weight:700">${cfg.label}</span>
              <span style="background:var(--accent-dim);color:var(--accent);padding:1px 7px;border-radius:10px;font-size:12px;font-weight:700">📑 مجمّع — ${items.length} قيود</span>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <div class="j-entry-amount" style="color:${cfg.amountColor}">
              ${amountSign}${fmt(Math.abs(groupTotal))}
            </div>
            <button onclick="event.stopPropagation();const w=document.getElementById('${gid}');const open=w.style.display!=='none';w.style.display=open?'none':'block';this.textContent=open?'👁 عرض التفاصيل':'🔼 إخفاء التفاصيل';"
              style="width:auto;height:auto;background:var(--card2);border:1px solid var(--border);cursor:pointer;color:var(--text2);font-size:13px;padding:3px 10px;border-radius:6px;white-space:nowrap;flex-shrink:0">👁 عرض التفاصيل</button>
          </div>
        </div>
        <div id="${gid}" style="display:none;margin-right:16px;border-right:2px dashed var(--border);padding-right:8px">${detailsHtml}</div>`;
}

// ════════════════════════════════════════
// ════════════════════════════════════════
// LEDGER ENGINE — auto-creates entries
// ════════════════════════════════════════
export const typeLabels = { customer:'عميل', supplier:'مورد', partner:'شريك', custodian:'عهدة' };

// printJournalVoucher → js/print.js



// ════════════════════════════════════════
// REFERENCE NUMBERS & EXPORT HELPERS
// ════════════════════════════════════════

export async function genSeqRef(prefix, sys, fileNo, table) {
  const safe = (fileNo || 'GEN').toString().replace(/[^A-Za-z0-9\-]/g,'');
  try {
    const rows = await apiGet(table, { select:'id', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, limit:1000 });
    const next = ((rows && rows.length) || 0) + 1;
    return `${prefix}-${safe}-${String(next).padStart(3,'0')}`;
  } catch(e) {
    return `${prefix}-${safe}-${String(Date.now()).slice(-5)}`;
  }
}

export function exportCSV(headers, rows, filename) {
  const csv = [headers, ...rows]
    .map(r => r.map(v => `"${String(v==null?'':v).replace(/"/g,'""')}"`).join(','))
    .join('\n');
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8'});
  // \u2705 \u0646\u062D\u0641\u0638 \u0627\u0644\u0640 blob \u0645\u0624\u0642\u062A\u0627\u064B \u0644\u0644\u0645\u0634\u0627\u0631\u0643\u0629 \u0639\u0628\u0631 Web Share API
  window._lastExportBlob = blob;
  window._lastExportFilename = (filename||'export') + '.csv';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = window._lastExportFilename;
  a.click();
}

// printSection → js/print.js


// ── Journal entry action helpers (avoid quote-escaping issues in templates) ──
// _jPrint → js/print.js

export function _jEdit(btn) {
  const p = btn.closest('.j-entry-actions') || btn.parentElement;
  editJournalEntry(p.dataset.etype || '', null, p.dataset.fno || '');
}

// حذف قيد من شاشة اليومية مباشرة — بيستخدم نفس منطق deleteJEEntry (operations.js)
// لكن بمجموعة بيانات جاهزة من journalState.entries بدل jeMgrState (مش متملية غير
// لما شاشة "دفتر القيود" اتفتحت فعلاً)، وبتحديث اليومية بعد الحذف بدل دفتر القيود.
export function _jDelete(btn) {
  const p = btn.closest('.j-entry-actions') || btn.parentElement;
  const entryNo = p.dataset.eno;
  if (!entryNo) { toast('لا يوجد رقم قيد لهذا العنصر','err'); return; }
  const entry = (journalState.entries || []).find(e => e.entryNo === entryNo);
  const group = entry ? entry.raw : null;
  if (!group) { toast('تعذر العثور على بيانات القيد — أعد تحميل الصفحة وحاول تاني','err'); return; }
  deleteJEEntry(entryNo, { group, onDeleted: loadJournal });
}

// ════════════════════════════════════════
// JOURNAL SALES DETAIL — نفس شكل جدول المبيعات جوا الملف
// ════════════════════════════════════════
export async function _loadJournalSalesDetail(entries) {
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

// ════════════════════════════════════════
// WINDOW BRIDGE — تعريض رموز الموديول للسكريبتات الكلاسيكية
// (مؤقت لحد ما باقي الملفات تتحول لـ ES Modules في Phase 2)
// journalState وtypeLabels لازم يتبردجوا — contacts.js (موديول بالفعل)
// بيقرا typeLabels كمرجع مباشر، وaccounting.js بيقرا journalState.
// ════════════════════════════════════════
Object.assign(window, {
  journalState, typeLabels,
  showJournal, setJournalPeriod, getJournalDateRange, loadJournal, renderJournalKpis,
  filterJournalByType, renderJournalEntries, _extractInvToken, _renderSingleJournalEntry,
  _renderGroupedSaleEntries, genSeqRef, exportCSV, _jEdit, _jDelete, _loadJournalSalesDetail,
  _excludeReversalPairs,
});
