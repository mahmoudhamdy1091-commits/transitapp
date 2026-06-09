// ╔══════════════════════════════════════════════════════════════╗
// ║  search.js — Global Search                                   ║
// ║  Transit Management System                                   ║
// ║  بحث شامل في: ملفات، سيارات، عملاء، موردين، فواتير، مصاريف ║
// ╚══════════════════════════════════════════════════════════════╝

const GS = {
  query:    '',
  timer:    null,
  active:   -1,    // index العنصر المحدد بالكيبورد
  results:  [],
  loading:  false,
  DELAY:    280,   // debounce ms
};

// ── Keyboard shortcut: "/" يفتح البحث ──────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT'
      && document.activeElement.tagName !== 'TEXTAREA'
      && document.activeElement.tagName !== 'SELECT') {
    e.preventDefault();
    const inp = document.getElementById('gsInput');
    if (inp) { inp.focus(); inp.select(); }
  }
  if (e.key === 'Escape') gsHide();
});

// ── Events ────────────────────────────────────────────────────
function gsOnInput(val) {
  GS.query = val.trim();
  clearTimeout(GS.timer);
  if (!GS.query) { gsRenderEmpty(); return; }
  gsShowLoading();
  GS.timer = setTimeout(() => gsSearch(GS.query), GS.DELAY);
}

function gsOnKey(e) {
  const dd = document.getElementById('gsDropdown');
  const items = dd?.querySelectorAll('.gs-item') || [];
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    GS.active = Math.min(GS.active + 1, items.length - 1);
    gsHighlight(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    GS.active = Math.max(GS.active - 1, 0);
    gsHighlight(items);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (GS.active >= 0 && items[GS.active]) items[GS.active].click();
  }
}

function gsHighlight(items) {
  items.forEach((el, i) => el.classList.toggle('gs-active', i === GS.active));
  items[GS.active]?.scrollIntoView({ block: 'nearest' });
}

function gsShow() {
  if (GS.query) gsSearch(GS.query);
  document.getElementById('gsBackdrop').style.display = 'block';
}

function gsHide() {
  document.getElementById('gsDropdown')?.classList.remove('open');
  document.getElementById('gsBackdrop').style.display = 'none';
  GS.active = -1;
}

// ── Core Search ───────────────────────────────────────────────
async function gsSearch(q) {
  if (!q || q.length < 2) { gsRenderEmpty(); return; }
  GS.loading = true;
  GS.active  = -1;

  const sys = state.system;
  // PostgREST: or=(field.ilike.*q*,field2.ilike.*q*) — يجب وضع القوسين
  const il  = v => `ilike.*${v.replace(/[()]/g,'')}*`;
  const or  = (...fields) => `(${fields.map(f => `${f}.${il(q)}`).join(',')})`;

  try {
    // نستخدم apiGet مباشرة (لا apiGetAll) — البحث لنظام محدد فقط، مع limit
    const [vehicles, pos, sales, expenses, contacts, collections] = await Promise.all([

      // السيارات: شاصي، موديل، لون
      apiGet('vehicles', {
        select: 'id,vin,model,year,color,file_no,purchase_price,post_status',
        system_type: `eq.${sys}`,
        or: or('vin','model','color'),
        limit: 8, order: 'id.desc',
      }),

      // ملفات الشراء: رقم الملف، المورد
      apiGet('purchase_orders', {
        select: 'id,file_no,supplier,po_date,total_purchase,status',
        system_type: `eq.${sys}`,
        or: or('file_no','supplier','po_no'),
        limit: 6, order: 'id.desc',
      }),

      // المبيعات: العميل، رقم الفاتورة، الشاصي
      apiGet('sales', {
        select: 'id,inv_no,customer,vin,sale_price,sale_date,file_no,post_status',
        system_type: `eq.${sys}`,
        or: or('customer','inv_no','vin'),
        limit: 6, order: 'id.desc',
      }),

      // المصاريف: الوصف، المستفيد، رقم المرجع
      apiGet('expenses', {
        select: 'id,ref_no,description,exp_type,beneficiary,amount,file_no,exp_date,post_status',
        system_type: `eq.${sys}`,
        or: or('description','beneficiary','ref_no'),
        limit: 5, order: 'id.desc',
      }),

      // جهات الاتصال: عملاء، موردين، شركاء
      apiGet('contacts', {
        select: 'id,name,type,phone,email',
        system_type: `eq.${sys}`,
        or: or('name','phone','email'),
        limit: 5, order: 'id.desc',
      }),

      // التحصيلات: العميل، رقم الفاتورة
      apiGet('collections', {
        select: 'id,inv_no,customer,amount,paid_date,file_no,post_status',
        system_type: `eq.${sys}`,
        or: or('customer','inv_no'),
        limit: 4, order: 'id.desc',
      }),
    ]);

    GS.results = { vehicles, pos, sales, expenses, contacts, collections };
    gsRender(q, GS.results);

  } catch(err) {
    console.warn('[GS] search error:', err.message);
    gsRenderError();
  } finally {
    GS.loading = false;
  }
}

// ── Render ────────────────────────────────────────────────────
function gsRender(q, r) {
  const dd = document.getElementById('gsDropdown');
  if (!dd) return;

  const hl  = (text) => _gsHighlight(text || '', q);
  const fmt = (n)    => (+n||0).toLocaleString('en-US', { minimumFractionDigits:3, maximumFractionDigits:3 });
  const sections = [];

  // ── ١. الملفات / سندات الشراء ──
  if (r.pos?.length) {
    sections.push(`<div class="gs-group-header">📋 ملفات الشراء</div>`);
    r.pos.forEach(p => {
      const badge = _gsBadge(p.status);
      sections.push(`
        <div class="gs-item" onclick="gsNavigate('po','${p.file_no}')">
          <div class="gs-item-icon" style="background:var(--accent-dim)">📋</div>
          <div class="gs-item-body">
            <div class="gs-item-title">${hl(p.file_no)} — ${hl(p.supplier||'—')}</div>
            <div class="gs-item-meta">${p.po_date||''} · ${fmt(p.total_purchase)} KWD</div>
          </div>
          ${badge}
        </div>`);
    });
  }

  // ── ٢. السيارات ──
  if (r.vehicles?.length) {
    sections.push(`<div class="gs-group-header">🚗 السيارات</div>`);
    r.vehicles.forEach(v => {
      const sold = v.post_status === 'sold';
      sections.push(`
        <div class="gs-item" onclick="gsNavigate('vehicle','${v.file_no}','${v.vin}')">
          <div class="gs-item-icon" style="background:${sold?'var(--green-dim)':'var(--blue-dim)'}">🚗</div>
          <div class="gs-item-body">
            <div class="gs-item-title">${hl(v.vin||'—')} — ${hl([v.model,v.year].filter(Boolean).join(' '))}</div>
            <div class="gs-item-meta">ملف: ${v.file_no||'—'} · ${fmt(v.purchase_price)} KWD${v.color?' · '+v.color:''}</div>
          </div>
          <span class="gs-item-badge" style="background:${sold?'var(--green-dim)':'var(--blue-dim)'};color:${sold?'var(--green)':'var(--blue)'}">
            ${sold?'مباع':'متاح'}
          </span>
        </div>`);
    });
  }

  // ── ٣. المبيعات / الفواتير ──
  if (r.sales?.length) {
    sections.push(`<div class="gs-group-header">🤝 المبيعات والفواتير</div>`);
    r.sales.forEach(s => {
      const invNo = s.inv_no || '—';
      sections.push(`
        <div class="gs-item" onclick="gsNavigate('sale','${s.file_no}','${invNo}')">
          <div class="gs-item-icon" style="background:var(--green-dim)">🤝</div>
          <div class="gs-item-body">
            <div class="gs-item-title">${hl(s.customer||'—')} — ${hl(invNo)}</div>
            <div class="gs-item-meta">ملف: ${s.file_no||'—'} · ${fmt(s.sale_price)} KWD · ${s.sale_date||''}</div>
          </div>
        </div>`);
    });
  }

  // ── ٤. جهات الاتصال ──
  if (r.contacts?.length) {
    sections.push(`<div class="gs-group-header">👤 جهات الاتصال</div>`);
    r.contacts.forEach(c => {
      const typeMap = { customer:'عميل', supplier:'مورد', partner:'شريك', custodian:'عهدة' };
      const typeColor = { customer:'var(--blue)', supplier:'var(--accent)', partner:'var(--purple)', custodian:'var(--cyan)' };
      sections.push(`
        <div class="gs-item" onclick="gsNavigate('contact','${c.id}','${c.type}')">
          <div class="gs-item-icon" style="background:var(--card2)">👤</div>
          <div class="gs-item-body">
            <div class="gs-item-title">${hl(c.name||'—')}</div>
            <div class="gs-item-meta">${c.phone||''} ${c.email?'· '+c.email:''}</div>
          </div>
          <span class="gs-item-badge" style="background:${typeColor[c.type]||'var(--card2)'}22;color:${typeColor[c.type]||'var(--text2)'}">
            ${typeMap[c.type]||c.type||'—'}
          </span>
        </div>`);
    });
  }

  // ── ٥. المصاريف ──
  if (r.expenses?.length) {
    sections.push(`<div class="gs-group-header">💸 المصاريف</div>`);
    r.expenses.forEach(e => {
      sections.push(`
        <div class="gs-item" onclick="gsNavigate('expense','${e.file_no}','${e.id}')">
          <div class="gs-item-icon" style="background:var(--red-dim)">💸</div>
          <div class="gs-item-body">
            <div class="gs-item-title">${hl(e.description||'—')}</div>
            <div class="gs-item-meta">ملف: ${e.file_no||'—'} · ${fmt(e.amount)} KWD · ${e.exp_type||''}</div>
          </div>
        </div>`);
    });
  }

  // ── ٦. التحصيلات ──
  if (r.collections?.length) {
    sections.push(`<div class="gs-group-header">💰 التحصيلات</div>`);
    r.collections.forEach(c => {
      sections.push(`
        <div class="gs-item" onclick="gsNavigate('collection','${c.file_no}','${c.inv_no}')">
          <div class="gs-item-icon" style="background:var(--green-dim)">💰</div>
          <div class="gs-item-body">
            <div class="gs-item-title">${hl(c.customer||'—')} — ${hl(c.inv_no||'—')}</div>
            <div class="gs-item-meta">ملف: ${c.file_no||'—'} · ${fmt(c.amount)} KWD${c.paid_date?' · '+c.paid_date:''}</div>
          </div>
          <span class="gs-item-badge" style="background:${c.paid_date?'var(--green-dim)':'var(--accent-dim)'};color:${c.paid_date?'var(--green)':'var(--accent)'}">
            ${c.paid_date?'مُحصَّل':'منتظر'}
          </span>
        </div>`);
    });
  }

  if (!sections.length) {
    dd.innerHTML = `<div class="gs-empty">🔍 لا نتائج لـ "<strong>${_escHtml(q)}</strong>"</div>`;
  } else {
    dd.innerHTML = sections.join('');
  }
  dd.classList.add('open');
  GS.active = -1;
}

function gsShowLoading() {
  const dd = document.getElementById('gsDropdown');
  if (!dd) return;
  dd.innerHTML = `<div class="gs-loading"><div class="spinner" style="width:16px;height:16px;border-width:2px"></div> جاري البحث...</div>`;
  dd.classList.add('open');
  document.getElementById('gsBackdrop').style.display = 'block';
}

function gsRenderEmpty() {
  const dd = document.getElementById('gsDropdown');
  if (dd) { dd.innerHTML = ''; dd.classList.remove('open'); }
  document.getElementById('gsBackdrop').style.display = 'none';
}

function gsRenderError() {
  const dd = document.getElementById('gsDropdown');
  if (dd) {
    dd.innerHTML = `<div class="gs-empty">⚠️ حدث خطأ في البحث</div>`;
    dd.classList.add('open');
  }
}

// ── Navigation: الانتقال لنتيجة البحث ────────────────────────
async function gsNavigate(type, fileNo, extra) {
  gsHide();
  document.getElementById('gsInput').value = '';
  GS.query = '';

  switch (type) {
    case 'po':
      // فتح ملف الصفقة في الـ viewer
      await openViewerFile(fileNo);
      break;

    case 'vehicle':
      // فتح الملف وانتقل لتاب السيارات
      await openViewerFile(fileNo);
      setTimeout(() => switchTab && switchTab(0), 400);
      break;

    case 'sale':
      // فتح الملف وانتقل لتاب المبيعات
      await openViewerFile(fileNo);
      setTimeout(() => switchTab && switchTab(4), 400);
      break;

    case 'expense':
      // فتح الملف وانتقل لتاب المصاريف
      await openViewerFile(fileNo);
      setTimeout(() => switchTab && switchTab(3), 400);
      break;

    case 'collection':
      // فتح الملف وانتقل لتاب التحصيلات
      await openViewerFile(fileNo);
      setTimeout(() => switchTab && switchTab(5), 400);
      break;

    case 'contact':
      // فتح شاشة جهات الاتصال مع تمييز الاسم
      if (typeof showContacts === 'function') showContacts();
      break;

    default:
      if (fileNo) await openViewerFile(fileNo);
  }
}

// helper: فتح viewer لملف معين
async function openViewerFile(fileNo) {
  if (!fileNo) return;
  // showViewer موجود في viewer.js
  if (typeof showViewer === 'function') {
    await showViewer(fileNo, state.system);
  } else if (typeof openFileViewer === 'function') {
    openFileViewer(fileNo);
  }
}

// ── Helpers ───────────────────────────────────────────────────
function _gsHighlight(text, query) {
  if (!query || !text) return _escHtml(String(text));
  const escaped  = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex    = new RegExp(`(${escaped})`, 'gi');
  return _escHtml(String(text)).replace(
    new RegExp(_escHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
    '<mark>$&</mark>'
  );
}

function _escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _gsBadge(status) {
  const map = {
    'OPEN':        ['var(--blue-dim)',   'var(--blue)',   'مفتوحة'],
    'IN PROGRESS': ['var(--accent-dim)', 'var(--accent)', 'جارية'],
    'CLOSED':      ['var(--green-dim)',  'var(--green)',  'مغلقة'],
  };
  const [bg, color, label] = map[status] || ['var(--card2)', 'var(--text2)', status||''];
  if (!label) return '';
  return `<span class="gs-item-badge" style="background:${bg};color:${color}">${label}</span>`;
}
