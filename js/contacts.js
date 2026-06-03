// ╔══════════════════════════════════════════════════════════╗
// ║  contacts.js — Contacts · Autocomplete · Statements     ║
// ║  Transit Management System — نقل حرفي، لا تعديل منطق   ║
// ╚══════════════════════════════════════════════════════════╝
function exportBtns(csvFn, printFn) {
  return `<div style="display:flex;gap:6px;margin-bottom:10px;justify-content:flex-end">
    <button class="btn btn-sm btn-secondary" onclick="${csvFn}" style="color:var(--green)">⬇️ Excel</button>
    <button class="btn btn-sm btn-secondary" onclick="${printFn}" style="color:var(--blue)">🖨️ PDF</button>
  </div>`;
}


// ════════════════════════════════════════
// CONTACTS VIEW
// ════════════════════════════════════════
const contactsState = { all: [], typeFilter: 'all' };

async function showContacts(type='all') {
  sessionStorage.setItem('tm_last_view','contacts');
  hideAllViews();
  el('contactsView').style.display = 'block';
  el('topBarTitle').textContent = 'جهات الاتصال';
  navActive('nav-contacts');
  contactsState.typeFilter = type;
  await loadContacts();
  // Apply filter after data loads
  filterContacts(type);
}

async function loadContacts() {
  el('contactsGrid').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري التحميل...</div>';
  try {
    // جلب جهات الاتصال — نجلب الكل ونشمل البيانات القديمة التي ممكن تكون system_type=null أو مختلفة
    // نستخدم or لجلب system_type المطابق + null (بيانات قديمة)
    const sys = state.system;
    const [contactsMatched, contactsNull] = await Promise.all([
      apiGet('contacts', { select:'*', system_type:`eq.${sys}`, order:'name.asc' }),
      apiGet('contacts', { select:'*', system_type:'is.null',   order:'name.asc' }),
    ]);
    // دمج بدون تكرار (بالـ id)
    const seen = new Set();
    const contacts = [];
    [...(contactsMatched||[]), ...(contactsNull||[])].forEach(c => {
      if (!seen.has(c.id)) { seen.add(c.id); contacts.push(c); }
    });
    contacts.sort((a,b) => (a.name||'').localeCompare(b.name||'', 'ar'));

    const jeEntries = await apiGet('journal_entries', { select:'contact_id,dr_amount,cr_amount', system_type:`eq.${sys}`, post_status:'eq.posted' });

    // Aggregate balances per contact from journal_entries
    const balMap = {};
    (jeEntries||[]).forEach(e => {
      if (!e.contact_id) return;
      if (!balMap[e.contact_id]) balMap[e.contact_id] = { debit:0, credit:0 };
      balMap[e.contact_id].debit  += +e.dr_amount || 0;
      balMap[e.contact_id].credit += +e.cr_amount || 0;
    });

    contactsState.all = contacts.map(c => ({
      ...c,
      totalDebit:  (balMap[c.id]?.debit  || 0) + (+c.opening_balance > 0 ? +c.opening_balance : 0),
      totalCredit: (balMap[c.id]?.credit || 0) + (+c.opening_balance < 0 ? Math.abs(+c.opening_balance) : 0),
      balance:     (balMap[c.id]?.debit || 0) - (balMap[c.id]?.credit || 0) + (+c.opening_balance || 0)
    }));

    renderContactsList();
  } catch(e) {
    el('contactsGrid').innerHTML = errHTML('خطأ في تحميل جهات الاتصال: ' + e.message);
  }
}

function filterContacts(type) {
  contactsState.typeFilter = type;
  document.querySelectorAll('[id^="ctype-"]').forEach(b => b.classList.remove('active'));
  el('ctype-' + type)?.classList.add('active');
  renderContactsList();
}

function renderContactsList() {
  const search = (el('contactSearch')?.value || '').toLowerCase();
  let list = contactsState.all;
  if (contactsState.typeFilter !== 'all') list = list.filter(c => c.type === contactsState.typeFilter);
  if (search) list = list.filter(c => c.name.toLowerCase().includes(search));

  if (!list.length) {
    el('contactsGrid').innerHTML = emptyHTML('👤','لا توجد جهات اتصال — أضف جهة جديدة');
    return;
  }

  const typeColors = {
    asset:'var(--blue)', liability:'var(--red)', equity:'var(--purple)',
    revenue:'var(--green)', cogs:'var(--accent)', expense:'var(--red)',
    customer:'var(--blue)', supplier:'var(--accent)', partner:'var(--purple)',
  };
  const typeLabelsAcc = {
    asset:'أصول', liability:'التزامات', equity:'حقوق ملكية',
    revenue:'إيرادات', cogs:'تكلفة مبيعات', expense:'مصروفات', other:'أخرى',
  };
  const typeDims   = { customer:'var(--blue-dim)', supplier:'var(--accent-dim)', partner:'var(--purple-dim)', custodian:'var(--cyan-dim)' };
  const typeIcons  = { customer:'🤝', supplier:'🏭', partner:'👥', custodian:'🗝' };

  const rows = list.map((c,i) => {
    const bal = c.balance;
    const balColor = bal > 0 ? 'var(--green)' : bal < 0 ? 'var(--red)' : 'var(--text3)';
    const balLabel = bal > 0 ? 'له عندك' : bal < 0 ? 'عليك له' : '—';
    const safeName = c.name.replace(/'/g,"\\'");
    return `<tr style="transition:background .12s" onmouseover="this.style.background='var(--card2)'" onmouseout="this.style.background=''">
      <td style="padding:11px 14px;font-size:12px;color:var(--text3);width:40px;text-align:center">${i+1}</td>
      <td style="padding:11px 14px;cursor:pointer" onclick="showLedger(${c.id},'${safeName}','${c.type}')">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:32px;height:32px;border-radius:50%;background:${typeDims[c.type]||'var(--card2)'};display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">
            ${typeIcons[c.type]||'👤'}
          </div>
          <div>
            <div style="font-weight:700;font-size:13px">${c.name}</div>
            ${c.phone ? `<div style="font-size:11px;color:var(--text3)">📞 ${c.phone}</div>` : ''}
          </div>
        </div>
      </td>
      <td style="padding:11px 14px">
        <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:10px;background:${typeDims[c.type]||'var(--card2)'};color:${typeColors[c.type]||'var(--text2)'}">
          ${typeLabels[c.type]||c.type}
        </span>
      </td>
      <td style="padding:11px 14px;font-family:var(--mono);font-size:12px;color:var(--green);text-align:left">${fmt(c.totalDebit)}</td>
      <td style="padding:11px 14px;font-family:var(--mono);font-size:12px;color:var(--red);text-align:left">${fmt(c.totalCredit)}</td>
      <td style="padding:11px 14px;text-align:left">
        <div style="font-family:var(--mono);font-size:13px;font-weight:700;color:${balColor}">${bal!==0?fmt(Math.abs(bal)):'—'}</div>
        <div style="font-size:10px;color:${balColor}">${balLabel}</div>
      </td>
      <td style="padding:11px 14px;text-align:center;white-space:nowrap">
        <button onclick="showContactStatement('${safeName}','${c.type}')" title="كشف حساب"
          style="background:var(--green-dim);border:1px solid var(--green);color:var(--green);border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;font-family:Cairo,sans-serif;margin-left:4px">📋</button>
        <button onclick="showLedger(${c.id},'${safeName}','${c.type}')" title="دفتر الأستاذ"
          style="background:var(--blue-dim);border:1px solid var(--blue);color:var(--blue);border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;font-family:Cairo,sans-serif;margin-left:4px">📖</button>
        <button onclick="openContactModal(contactsState.all.find(x=>x.id===${c.id}))" title="تعديل"
          style="background:var(--card2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;font-family:Cairo,sans-serif;margin-left:4px">✏️</button>
        <button onclick="deleteContact(${c.id},'${safeName}')" title="حذف"
          style="background:var(--red-dim);border:1px solid var(--red);color:var(--red);border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;font-family:Cairo,sans-serif">🗑</button>
      </td>
    </tr>`;
  }).join('');

  el('contactsGrid').innerHTML = `
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:var(--card2);border-bottom:1px solid var(--border)">
            <th style="padding:10px 14px;font-size:11px;color:var(--text3);font-weight:700;text-align:center">#</th>
            <th style="padding:10px 14px;font-size:11px;color:var(--text3);font-weight:700;text-align:right">الاسم</th>
            <th style="padding:10px 14px;font-size:11px;color:var(--text3);font-weight:700;text-align:right">النوع</th>
            <th style="padding:10px 14px;font-size:11px;color:var(--text3);font-weight:700;text-align:left">مدين</th>
            <th style="padding:10px 14px;font-size:11px;color:var(--text3);font-weight:700;text-align:left">دائن</th>
            <th style="padding:10px 14px;font-size:11px;color:var(--text3);font-weight:700;text-align:left">الرصيد</th>
            <th style="padding:10px 14px;font-size:11px;color:var(--text3);font-weight:700;text-align:center">إجراءات</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ════════════════════════════════════════
// CONTACT LEDGER — يقرأ من journal_entries فقط (مصدر واحد)
// ════════════════════════════════════════
async function showLedger(contactId, contactName, contactType) {
  hideAllViews();
  el('ledgerView').style.display = 'block';
  el('topBarTitle').textContent = 'دفتر الأستاذ';
  el('ledger-contact-badge').innerHTML = `<span style="color:var(--text2);font-weight:400;font-size:13px">دفتر الأستاذ /</span> ${contactName}
    <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;background:var(--blue-dim);color:var(--blue);margin-right:6px">${typeLabels[contactType]||contactType}</span>`;
  navActive('nav-contacts');
  el('ledgerTable').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري التحميل من القيود...</div>';

  window._ledgerContactId   = contactId;
  window._ledgerContactName = contactName;
  window._ledgerContactType = contactType;

  try {
    const sys     = state.system;
    const contact = contactsState.all.find(c => c.id === contactId);
    window._ledgerOpening = contact?.opening_balance ? +contact.opening_balance : 0;

    // ── الجلب الأساسي: بـ contact_name (البيانات الجديدة) ──
    const byContactName = await apiGetAll('journal_entries', {
      select: 'id,entry_date,account_code,account_name,contact_name,dr_amount,cr_amount,description,file_no,entry_no,ref_table,post_status',
      system_type:  `eq.${sys}`,
      contact_name: `eq.${contactName}`,
      order: 'entry_date.asc,id.asc',
    });

    // ── Fallback: البيانات القديمة (قبل إضافة contact_name) ──
    // نجلب بالأنماط القديمة: "عميل: X", "مورد: X", "شريك: X"
    const prefixMap  = { customer:'عميل', supplier:'مورد', partner:'شريك', custodian:'عهدة' };
    const prefix     = prefixMap[contactType] || '';
    const oldPattern = prefix ? `${prefix}: ${contactName}` : contactName;

    const byOldFormat = prefix ? await apiGetAll('journal_entries', {
      select: 'id,entry_date,account_code,account_name,contact_name,dr_amount,cr_amount,description,file_no,entry_no,ref_table,post_status',
      system_type:  `eq.${sys}`,
      account_name: `eq.${oldPattern}`,
      order: 'entry_date.asc,id.asc',
    }) : [];

    // ── دمج بدون تكرار ──
    const seen = new Set();
    const raw  = [];
    [...(byContactName||[]), ...(byOldFormat||[])].forEach(r => {
      if (!seen.has(r.id)) { seen.add(r.id); raw.push(r); }
    });

    const jeRows = raw.filter(isPosted);
    jeRows.sort((a,b) => (a.entry_date||'').localeCompare(b.entry_date||'') || a.id - b.id);

    const srcLabels = {
      purchase_orders:'شراء', sales:'بيع', collections:'تحصيل',
      payments:'دفعة مورد', expenses:'مصروف', partner_payouts:'صرف شريك',
      operating_expenses:'مصروف تشغيلي', manual:'يدوي',
    };

    const entries = jeRows.map(r => ({
      date:    (r.entry_date||'').split('T')[0],
      type:    srcLabels[r.ref_table] || r.ref_table || 'قيد',
      desc:    r.description || '—',
      ref:     r.entry_no   || '',
      debit:   +r.dr_amount || 0,
      credit:  +r.cr_amount || 0,
      file_no: r.file_no    || '',
    }));

    window._ledgerAllEntries = entries;

    // فلتر الملفات
    const fileNos = [...new Set(entries.map(e=>e.file_no).filter(Boolean))].sort();
    const sel = el('ledger-file-filter');
    if (sel) {
      sel.innerHTML = '<option value="">كل الصفقات</option>' +
        fileNos.map(f=>`<option value="${f}">${f}</option>`).join('');
    }

    // تنبيه لو بيانات قديمة
    if (byContactName?.length === 0 && byOldFormat?.length > 0) {
      toast('⚠️ بيانات قديمة — شغّل الترحيل لتحديث القيود','warn');
    }

    el('ledgerView').dataset.contactName = contactName;
    renderLedgerTable();

  } catch(e) {
    el('ledgerTable').innerHTML = errHTML('خطأ: ' + e.message);
    console.error('showLedger:', e);
  }
}


function printLedgerStatement() {
  const contactName = window._ledgerContactName || '—';
  const contactType = window._ledgerContactType || '';
  const allEntries  = window._ledgerAllEntries  || [];
  const vehicleMap  = window._ledgerVehicleMap  || {};
  const fileFilter  = el('ledger-file-filter')?.value || '';
  const opening     = !fileFilter ? (window._ledgerOpening || 0) : 0;
  const fmt2        = n => (+n||0).toLocaleString('en-US',{minimumFractionDigits:2});

  const typeLabelsP = { customer:'عميل', supplier:'مورد', partner:'شريك', custodian:'عهدة' };
  const typeColors  = { customer:'#2563eb', supplier:'#e6930a', partner:'#7c3aed', custodian:'#0891b2' };
  const color = typeColors[contactType] || '#1a1a1a';

  let list = fileFilter ? allEntries.filter(e => e.file_no === fileFilter) : allEntries;
  let running = opening;

  const totalDebit  = list.reduce((s,e)=>s+(+e.debit||0),0)  + (opening>0?opening:0);
  const totalCredit = list.reduce((s,e)=>s+(+e.credit||0),0) + (opening<0?Math.abs(opening):0);
  const finalBal    = opening + list.reduce((s,e)=>s+(+e.debit||0)-(+e.credit||0),0);

  let rows = '';
  if (opening !== 0) {
    rows += `<tr style="background:#f8f9fa;font-weight:700">
      <td>—</td><td colspan="2">رصيد افتتاحي</td>
      <td style="color:#16a34a;text-align:left">${opening>0?fmt2(opening):'—'}</td>
      <td style="color:#dc2626;text-align:left">${opening<0?fmt2(Math.abs(opening)):'—'}</td>
      <td style="text-align:left;font-weight:700">${fmt2(Math.abs(opening))}</td>
    </tr>`;
  }

  list.forEach(e => {
    running += (+e.debit||0) - (+e.credit||0);
    const desc = (e.desc || e.description || '—').replace(/<[^>]+>/g,'');
    const rowBg = running < 0 ? '#fff5f5' : '';
    rows += `<tr style="background:${rowBg}">
      <td style="white-space:nowrap">${e.date||e.entry_date||'—'}</td>
      <td style="font-size:11px;line-height:1.6">${e.type?`<strong>[${e.type}]</strong> `:''} ${desc}</td>
      <td style="font-family:monospace;font-size:11px;color:#666">${e.file_no||'—'}</td>
      <td style="color:#16a34a;text-align:left;font-weight:600">${+e.debit?fmt2(e.debit):'—'}</td>
      <td style="color:#dc2626;text-align:left;font-weight:600">${+e.credit?fmt2(e.credit):'—'}</td>
      <td style="text-align:left;font-weight:700;color:${running>=0?'#16a34a':'#dc2626'}">${fmt2(Math.abs(running))}</td>
    </tr>`;
  });

  const printDate = new Date().toLocaleDateString('en-GB');
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>كشف حساب — ${contactName}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Cairo',Arial,sans-serif;color:#1a1a1a;background:#fff;font-size:12px}
  .page{max-width:960px;margin:0 auto;padding:28px 32px}
  .no-print{text-align:center;margin-bottom:16px;display:flex;gap:8px;justify-content:center}
  .no-print button{padding:9px 24px;border-radius:8px;font-family:'Cairo',sans-serif;font-size:13px;font-weight:700;cursor:pointer;border:none}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1a1a1a;padding-bottom:16px;margin-bottom:20px}
  .co{font-size:18px;font-weight:900}.co-sub{font-size:11px;color:#888;margin-top:2px}
  .title-area h1{font-size:22px;font-weight:900;text-align:left}
  .contact-badge{display:inline-block;background:${color};color:#fff;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;margin-top:6px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
  .kpi{background:#f8f9fa;border-radius:8px;padding:10px 14px;border-right:3px solid ${color}}
  .kpi-label{font-size:10px;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
  .kpi-val{font-size:15px;font-weight:900;margin-top:3px}
  table{width:100%;border-collapse:collapse;margin-bottom:16px;font-size:11px}
  thead tr{background:#1a1a1a;color:#fff}
  thead th{padding:8px 10px;text-align:right;font-weight:700}
  tbody tr{border-bottom:1px solid #eee}
  tbody tr:nth-child(even){background:#fafafa}
  tbody td{padding:7px 10px;vertical-align:top}
  tfoot td{padding:9px 10px;background:#f0f2f5;font-weight:700}
  .footer{text-align:center;padding-top:12px;border-top:1px solid #eee;color:#aaa;font-size:10px;margin-top:16px}
  .sig-row{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:28px}
  .sig-box{text-align:center;padding-top:40px;border-top:1px solid #ccc;font-size:11px;color:#888}
  @media print{
    .no-print{display:none!important}
    body{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    .page{padding:14px}
  }
</style>
</head>
<body><div class="page">

  <div class="no-print">
    <button onclick="window.print()" style="background:#1a1a1a;color:#fff">🖨️ طباعة</button>
    <button onclick="window.close()" style="background:#f1f1f1;color:#333;border:1px solid #ddd">✕ إغلاق</button>
  </div>

  <div class="hdr">
    <div>
      <div class="co">Transit Cars</div>
      <div class="co-sub">ترانزيت للسيارات · الكويت</div>
      <div class="co-sub" style="margin-top:4px">تاريخ الطباعة: ${printDate}</div>
    </div>
    <div class="title-area">
      <h1>كشف حساب</h1>
      <div class="contact-badge">${typeLabelsP[contactType]||contactType}</div>
      <div style="font-size:18px;font-weight:900;text-align:left;margin-top:6px">${contactName}</div>
      ${fileFilter?`<div style="font-size:12px;color:#666;text-align:left;margin-top:2px">ملف: ${fileFilter}</div>`:''}
    </div>
  </div>

  <div class="kpis">
    <div class="kpi"><div class="kpi-label">إجمالي المدين</div><div class="kpi-val" style="color:#16a34a">${fmt2(totalDebit)}</div></div>
    <div class="kpi"><div class="kpi-label">إجمالي الدائن</div><div class="kpi-val" style="color:#dc2626">${fmt2(totalCredit)}</div></div>
    <div class="kpi"><div class="kpi-label">الرصيد الحالي</div><div class="kpi-val" style="color:${finalBal>=0?'#16a34a':'#dc2626'}">${fmt2(Math.abs(finalBal))} ${finalBal>=0?'مدين':'دائن'}</div></div>
    <div class="kpi"><div class="kpi-label">عدد الحركات</div><div class="kpi-val">${list.length}</div></div>
  </div>

  <table>
    <thead><tr>
      <th>التاريخ</th><th>البيان</th><th>الملف</th>
      <th style="text-align:left">مدين</th>
      <th style="text-align:left">دائن</th>
      <th style="text-align:left">الرصيد</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr>
      <td colspan="3">الإجمالي</td>
      <td style="color:#16a34a;text-align:left">${fmt2(totalDebit)}</td>
      <td style="color:#dc2626;text-align:left">${fmt2(totalCredit)}</td>
      <td style="color:${finalBal>=0?'#16a34a':'#dc2626'};text-align:left">${fmt2(Math.abs(finalBal))} ${finalBal>=0?'مدين':'دائن'}</td>
    </tr></tfoot>
  </table>

  <div class="sig-row">
    <div class="sig-box">توقيع المحاسب</div>
    <div class="sig-box">توقيع المدير</div>
  </div>

  <div class="footer">Transit Cars System · تم الإنشاء بتاريخ ${printDate}</div>

</div></body></html>`;

  openPrintOverlay(html);

}

// ════════════════════════════════════════
// CONTACT AUTOCOMPLETE
// ════════════════════════════════════════
let _acTimer;
const _acCache = {};

async function getContactsByType(type) {
  const key = state.system + ':' + type;
  if (_acCache[key] && (Date.now() - _acCache[key].ts < 30000)) return _acCache[key].data;
  try {
    const typeParam = type === 'all' ? undefined : type;
    const baseParams = { select:'id,name,type', order:'name.asc' };
    if (typeParam) baseParams.type = `eq.${typeParam}`;

    // جلب المطابق + null (بيانات قديمة بدون system_type)
    const [matched, nullSys] = await Promise.all([
      apiGet('contacts', { ...baseParams, system_type:`eq.${state.system}` }),
      apiGet('contacts', { ...baseParams, system_type:'is.null' }),
    ]);
    const seen = new Set();
    const data = [];
    [...(matched||[]), ...(nullSys||[])].forEach(c => {
      if (!seen.has(c.id)) { seen.add(c.id); data.push(c); }
    });
    data.sort((a,b) => (a.name||'').localeCompare(b.name||'', 'ar'));
    _acCache[key] = { data, ts: Date.now() };
    return data;
  } catch(e) { return []; }
}

function contactAutocomplete(input, type) {
  clearTimeout(_acTimer);
  const q = input.value.trim();
  removeAcList(input);
  if (!q || q.length < 1) return;
  _acTimer = setTimeout(async () => {
    const contacts = await getContactsByType(type === 'any' ? 'all' : type);
    const matches = contacts.filter(c => c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
    if (!matches.length) return;
    showAcList(input, matches, type);
  }, 250);
}

function showAcList(input, items, type) {
  removeAcList(input);
  const typeColors = {
    asset:'var(--blue)', liability:'var(--red)', equity:'var(--purple)',
    revenue:'var(--green)', cogs:'var(--accent)', expense:'var(--red)',
    customer:'var(--blue)', supplier:'var(--accent)', partner:'var(--purple)',
  };
  const typeLabelsAcc = {
    asset:'أصول', liability:'التزامات', equity:'حقوق ملكية',
    revenue:'إيرادات', cogs:'تكلفة مبيعات', expense:'مصروفات', other:'أخرى',
  };
  const typeDims   = { customer:'var(--blue-dim)', supplier:'var(--accent-dim)', partner:'var(--purple-dim)', custodian:'var(--cyan-dim)' };

  // Wrap input if not already wrapped
  let wrap = input.parentElement;
  if (!wrap.classList.contains('ac-wrap')) {
    wrap = document.createElement('div');
    wrap.className = 'ac-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
  }

  const list = document.createElement('div');
  list.className = 'ac-list';
  list.id = 'ac-list-' + input.id;

  items.forEach((c, i) => {
    const item = document.createElement('div');
    item.className = 'ac-item' + (i === 0 ? ' ac-active' : '');
    item.innerHTML = `<span class="ac-item-name">${c.name}</span>
      <span class="ac-item-type" style="background:${typeDims[c.type]||'var(--card2)'};color:${typeColors[c.type]||'var(--text2)'}">${typeLabels[c.type]||c.type}</span>`;
    item.onmousedown = (e) => {
      e.preventDefault();
      input.value = c.name;
      removeAcList(input);
      input.dispatchEvent(new Event('change'));
    };
    list.appendChild(item);
  });

  wrap.appendChild(list);
}

function removeAcList(input) {
  const existing = document.getElementById('ac-list-' + input.id);
  if (existing) existing.remove();
}