// ╔══════════════════════════════════════════════════════════╗
// ║  contacts.js — Contacts · Autocomplete · Statements     ║
// ║  Transit Management System — نقل حرفي، لا تعديل منطق   ║
// ╚══════════════════════════════════════════════════════════╝
function exportBtns(csvFn, printFn) {
  // ✅ no-print: يُخفى في نافذة الطباعة (PRINT_CSS يتعامل معه)
  return `<div class="no-print" style="display:flex;gap:6px;margin-bottom:10px;justify-content:flex-end">
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


// printLedgerStatement → js/print.js


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