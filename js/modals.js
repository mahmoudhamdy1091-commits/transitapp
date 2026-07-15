// ╔══════════════════════════════════════════════════════════╗
// ║  modals.js — NewFile · Payment · Expense · Sale         ║
// ║           Collection · Payout Modals                    ║
// ║  Transit Management System — نقل حرفي، لا تعديل منطق   ║
// ╚══════════════════════════════════════════════════════════╝

// ── حالة مودال سند الشراء (نُقلت من dashboard.js — Phase 1) ──
let nfPriceMode = 'equal';

// Edit mode state
let _nfEditMode = false;
let _nfEditFileNo = null;
let _originalPOTotal = 0;
let _originalPOSupplier = '';
let _originalPOPostStatus = null;
let _originalVehicleIds = [];   // IDs of all vehicles loaded at edit open time
let _originalPartners = [];     // partner+payment data loaded at edit open time
let _nfSaving = false;          // guard against double-submit
export function getNfEditFileNo() { return _nfEditFileNo; }

export async function openNewFileModal(editFileNo = null) {
  // ── set mode FIRST ──
  _nfEditMode   = !!editFileNo;
  _nfEditFileNo = editFileNo || null;

  // Generate file no only for NEW mode
  if (!_nfEditMode) {
    try {
      const data = await apiGetAll('purchase_orders', { select:'file_no', system_type:`eq.${state.system}`, order:'created_at.desc', limit:100 });
      let nextNum = 1;
      if (data && data.length) {
        const nums = data.map(d => parseInt((d.file_no||'').split('-')[1]) || 0);
        nextNum = Math.max(...nums) + 1;
      }
      el('nf-fileNo').value = `${state.system}-${String(nextNum).padStart(3,'0')}`;
    } catch(e) { el('nf-fileNo').value = `${state.system}-001`; }
  }

  // UI labels
  if (el('nfModalIcon'))  el('nfModalIcon').textContent   = _nfEditMode ? '✏️' : '📋';
  if (el('nfModalTitle')) el('nfModalTitle').innerHTML    = _nfEditMode
    ? `تعديل سند الشراء — <span id="nfSystemLabel">${state.system}</span> — <span style="color:var(--accent)">${editFileNo}</span>`
    : `سند شراء جديد — <span id="nfSystemLabel">${state.system}</span>`;
  if (el('nfSubmitBtn'))  el('nfSubmitBtn').textContent   = _nfEditMode ? '💾 حفظ التعديلات' : '💾 حفظ السند';
  if (el('nfDeleteBtn'))  el('nfDeleteBtn').style.display = _nfEditMode ? 'inline-flex' : 'none';

  el('nfError').style.display = 'none';
  el('vehiclesContainer').innerHTML = '';
  el('partnersContainer').innerHTML = '';
  el('partnerSummary').style.display = 'none';

  // Lock file no in edit mode
  if (_nfEditMode) {
    el('nf-fileNo').setAttribute('readonly', true);
    el('nf-fileNo').style.opacity = '0.6';
    el('nf-fileNo').style.cursor  = 'not-allowed';
  } else {
    el('nf-fileNo').removeAttribute('readonly');
    el('nf-fileNo').style.opacity = '1';
    el('nf-fileNo').style.cursor  = '';
  }

  await populatePartnersSelect();

  if (_nfEditMode && editFileNo) {
    // ── EDIT: load existing deal ──
    nfPriceMode = 'manual';
    document.querySelectorAll('[id^="pm-"]').forEach(b => b.classList.remove('active'));
    el('pm-manual')?.classList.add('active');
    el('nf-vehicles-label').style.display = '';
    el('nf-price-mode-wrap').style.display = '';
    // Show loading
    el('vehiclesContainer').innerHTML = '<div style="padding:12px;color:var(--text2);font-size:13px">⏳ جاري تحميل البيانات...</div>';
    el('partnersContainer').innerHTML = '<div style="padding:12px;color:var(--text2);font-size:13px">⏳ جاري التحميل...</div>';

    try {
      const [deals, vList, pList, payList] = await Promise.all([
        apiGetAll('purchase_orders', { select:'*', system_type:`eq.${state.system}`, file_no:`eq.${editFileNo}` }),
        apiGetAll('vehicles', { select:'*', system_type:`eq.${state.system}`, file_no:`eq.${editFileNo}` }),
        apiGetAll('partners_master', { select:'*', system_type:`eq.${state.system}`, file_no:`eq.${editFileNo}` }),
        apiGetAll('payments', { select:'*', system_type:`eq.${state.system}`, file_no:`eq.${editFileNo}` }),
      ]);

      const d = deals?.[0] || {};
      // حفظ القيم الأصلية للمقارنة عند الحفظ
      _originalPOTotal      = +(d.total_purchase||0);
      _originalPOSupplier   = d.supplier || '';
      _originalPOPostStatus = d.post_status || null;
      el('nf-fileNo').value       = d.file_no       || editFileNo;
      el('nf-poDate').value       = d.po_date        || '';
      el('nf-notes').value        = d.notes          || '';
      el('nf-poNo').value         = d.po_no          || '';
      el('nf-totalAmount').value  = d.total_purchase || '';
      el('nf-vehicleCount').value = d.vehicle_count  || '';
      

      // Set supplier — ac-input (text), just set value directly
      el('nf-supplier').value = d.supplier || '';
      // pre-cache supplier contacts silently
      acGetContacts('supplier').catch(()=>{});

      // حفظ IDs الأصلية للمقارنة عند الحفظ (للكشف عن المحذوفة)
      _originalVehicleIds = (vList||[]).map(v => v.id).filter(Boolean);

      // حفظ بيانات الشركاء والدفعات الأصلية للمقارنة عند الحفظ
      _originalPartners = (pList||[]).map(p => {
        const pay = (payList||[]).find(pm => pm.payer === p.partner);
        return {
          pid: p.id, name: p.partner, share: +p.share_percent||0,
          paymentId: pay?.id || null,
          paymentAmount: +pay?.amount || 0,
          paymentPostStatus: pay?.post_status || null,
        };
      });

      // Load vehicles
      el('vehiclesContainer').innerHTML = '';
      if (vList?.length) {
        vList.forEach(v => addVehicleRowWithData(v));
      } else {
        addVehicleRow();
      }

      // Load partners
      el('partnersContainer').innerHTML = '';
      if (pList?.length) {
        for (const p of pList) {
          const pay = (payList||[]).find(pm => pm.payer === p.partner);
          await addPartnerRowWithData(p, pay);
        }
      } else {
        await addPartnerRow();
      }

      // Update price mode UI
      setPriceMode('manual');
      updateEqualPriceInfo();

    } catch(e) {
      console.error('Edit load error:', e);
      el('vehiclesContainer').innerHTML = '';
      el('partnersContainer').innerHTML = '';
      addVehicleRow();
      await addPartnerRow();
      showFieldErr('nfError', 'خطأ في تحميل بيانات الصفقة: ' + e.message);
    }
  } else {
    // ── NEW ──
    nfPriceMode = 'equal';
    document.querySelectorAll('[id^="pm-"]').forEach(b => b.classList.remove('active'));
    el('pm-equal')?.classList.add('active');
    el('nf-vehicles-label').style.display = 'none';
    el('nf-price-mode-wrap').style.display = 'none';
    el('nf-poDate').value       = today();
    el('nf-notes').value        = '';
    
    el('nf-poNo').value         = '';
    el('nf-totalAmount').value  = '';
    el('nf-vehicleCount').value = '';
    await addPartnerRow();
  }

  openModal('newFileModal');
}

export async function populatePartnersSelect() {
  // Pre-cache partners for autocomplete in partner rows
  await getContactsByType('partner');
}

export function onVehicleCountChange(val) {
  const n = parseInt(val) || 0;
  if (n < 1 || n > 100) return;
  el('nf-vehicles-label').style.display = '';
  el('nf-price-mode-wrap').style.display = '';
  buildVehicleRows(n);
  updateEqualPriceInfo();
}

export function onTotalAmountChange() {
  updateEqualPriceInfo();
  if (nfPriceMode === 'equal') applyEqualPrices();
  checkPriceTotal();
}

export function setPriceMode(mode) {
  nfPriceMode = mode;
  document.querySelectorAll('[id^="pm-"]').forEach(b => b.classList.remove('active'));
  el('pm-' + mode)?.classList.add('active');
  el('vehiclesContainer').querySelectorAll('[name="v-price"]').forEach(inp => {
    inp.readOnly = (mode === 'equal');
    inp.style.opacity = mode === 'equal' ? '.6' : '1';
    inp.style.cursor  = mode === 'equal' ? 'not-allowed' : '';
  });
  if (mode === 'equal') applyEqualPrices();
  updateEqualPriceInfo();
}

export function buildVehicleRows(n) {
  const container = el('vehiclesContainer');
  const existing = container.querySelectorAll('tr.v-row').length;
  for (let i = existing; i < n; i++) addVehicleRow();
  const rows = container.querySelectorAll('tr.v-row');
  for (let i = rows.length - 1; i >= n; i--) rows[i].remove();
  renumberVehicles();
  setPriceMode(nfPriceMode);
}

export function applyEqualPrices() {
  const total = parseFloat(el('nf-totalAmount').value) || 0;
  const rows = el('vehiclesContainer').querySelectorAll('[name="v-price"]');
  if (!rows.length) return;
  const each = total / rows.length;
  rows.forEach(inp => { inp.value = each.toFixed(2); });
  checkPriceTotal();
}

export function checkPriceTotal() {
  const total = parseFloat(el('nf-totalAmount').value) || 0;
  const chk = el('pm-total-check');
  if (!chk) return;
  if (!total) { chk.style.display='none'; return; }
  let sum = 0;
  el('vehiclesContainer').querySelectorAll('[name="v-price"]').forEach(inp => { sum += parseFloat(inp.value)||0; });
  const diff = Math.abs(sum - total);
  chk.style.display = '';
  if (diff < 0.01) {
    chk.innerHTML = `<span style="color:var(--green)">✓ مجموع الأسعار = ${fmt(sum)} — متطابق مع إجمالي الصفقة</span>`;
  } else {
    chk.innerHTML = `<span style="color:var(--red)">⚠ مجموع الأسعار = ${fmt(sum)} — الفرق: ${fmt(diff)}</span>`;
  }
}

export function updateEqualPriceInfo() {
  const total = parseFloat(el('nf-totalAmount').value) || 0;
  const n = el('vehiclesContainer').querySelectorAll('[name="v-price"]').length;
  const info = el('pm-equal-info');
  if (!info) return;
  if (!n || !total) { info.textContent = ''; return; }
  info.innerHTML = `سعر كل سيارة = <strong style="color:var(--accent)">${fmt(total/n)}</strong>`;
}

export function addVehicleRow() {
  const container = el('vehiclesContainer');
  // Ensure table exists
  let tbody = container.querySelector('tbody');
  if (!tbody) {
    container.innerHTML = `
      <table class="vt-table">
        <thead><tr>
          <th class="vt-num">#</th>
          <th style="min-width:90px">النوع</th>
          <th style="min-width:120px">الموديل</th>
          <th style="min-width:50px">السنة</th>
          <th style="min-width:130px">VIN</th>
          <th style="min-width:80px">اللوحة</th>
          <th style="min-width:70px">اللون</th>
          <th style="min-width:60px">الحجم</th>
          <th style="min-width:90px">السعر</th>
          <th style="min-width:95px">انتهاء الرخصة</th>
          <th style="min-width:80px">ملاحظات</th>
          <th style="width:56px"></th>
        </tr></thead>
        <tbody></tbody>
      </table>
      <div id="pm-total-check" style="font-size:12px;margin-top:6px"></div>`;
    tbody = container.querySelector('tbody');
  }

  const num = tbody.querySelectorAll('tr').length + 1;
  const isEqual = nfPriceMode === 'equal';
  const tr = document.createElement('tr');
  tr.className = 'v-row';
  tr.innerHTML = `
    <td class="vt-num">${num}</td>
    <td><input class="vt-inp" type="text" name="v-type" placeholder="Pickup"></td>
    <td><input class="vt-inp" type="text" name="v-model" placeholder="Hilux 2024"></td>
    <td><input class="vt-inp" type="number" name="v-year" placeholder="2024" min="1990" max="2030" style="width:60px"></td>
    <td><input class="vt-inp" type="text" name="v-vin" placeholder="VIN" style="direction:ltr;letter-spacing:.5px" onblur="onVinBlur(this,'')"></td>
    <td><input class="vt-inp" type="text" name="v-plate" placeholder="ABC-123" style="direction:ltr"></td>
    <td><input class="vt-inp" type="text" name="v-color" placeholder="أبيض"></td>
    <td><input class="vt-inp" type="text" name="v-engine" placeholder="1.5" style="width:55px"></td>
    <td><input class="vt-inp" type="number" name="v-price" placeholder="0.00" min="0" step="0.01"
      ${isEqual ? 'readonly style="opacity:.6;cursor:not-allowed"' : ''}
      oninput="checkPriceTotal()"></td>
    <td><input class="vt-inp" type="date" name="v-expiry" style="width:110px"></td>
    <td><input class="vt-inp" type="text" name="v-notes" placeholder="..."></td>
    <td>
      <button class="btn-remove" onclick="uploadLicenseForRow(this.closest('tr'))" title="رفع رخصة" style="color:var(--blue);margin-left:2px">📷</button>
      <button class="btn-remove" onclick="this.closest('tr').remove();renumberVehicles();checkPriceTotal()" title="حذف">✕</button>
    </td>
  `;
  // Copy button
  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn-remove';
  copyBtn.title = 'نسخ الصف';
  copyBtn.textContent = '⧉';
  copyBtn.style.cssText = 'color:var(--text2);margin-left:2px';
  copyBtn.onclick = () => copyVehicleRow(tr);
  tr.querySelector('td:last-child').appendChild(copyBtn);

  tbody.appendChild(tr);
}

export function copyVehicleRow(sourceTr) {
  const container = el('vehiclesContainer');
  const tbody = container.querySelector('tbody');
  const newTr = sourceTr.cloneNode(true);
  // Clear VIN and plate (unique per car)
  const vinInp = newTr.querySelector('[name="v-vin"]');
  const plateInp = newTr.querySelector('[name="v-plate"]');
  if (vinInp) vinInp.value = '';
  if (plateInp) plateInp.value = '';
  // Re-attach event handlers
  newTr.querySelector('.btn-remove').onclick = function() {
    this.closest('tr').remove(); renumberVehicles(); checkPriceTotal();
  };
  const btns = newTr.querySelectorAll('.btn-remove');
  if (btns[1]) btns[1].onclick = () => copyVehicleRow(newTr);
  tbody.appendChild(newTr);
  renumberVehicles();
  checkPriceTotal();
}

export function renumberVehicles() {
  const rows = el('vehiclesContainer').querySelectorAll('tr.v-row');
  rows.forEach((r, i) => {
    const numCell = r.querySelector('.vt-num');
    if (numCell) numCell.textContent = i + 1;
  });
  updateEqualPriceInfo();
  if (nfPriceMode === 'equal') applyEqualPrices();
}

export async function addPartnerRow() {
  const partners = await getContactsByType('partner');
  const inp = (placeholder, type='text', extra='') =>
    `<input type="${type}" placeholder="${placeholder}" ${extra}
      style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-family:Cairo,sans-serif;font-size:12px;width:100%">`;
  const div = document.createElement('div');
  div.className = 'dyn-row p-row';
  div.style.cssText = 'grid-template-columns:1.8fr 0.7fr 0.8fr 0.7fr 0.9fr 0.8fr 32px;gap:6px;align-items:center;padding:8px 4px;border-bottom:1px solid var(--border)';
  const opts = partners.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
  div.innerHTML = `
    <select style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-family:Cairo,sans-serif;font-size:12px;width:100%">
      <option value="">-- اختر --</option>${opts}
      <option value="__new__">+ جديد...</option>
    </select>
    ${inp('الحصة %','number','min="0" max="100" step="0.01" oninput="updatePartnerSummary()"')}
    ${inp('المبلغ','number','min="0" step="0.01" oninput="updatePartnerSummary()"')}
    <input type="date" style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-family:Cairo,sans-serif;font-size:12px;width:100%" value="${today()}">
    <select style="background:var(--card);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-family:Cairo,sans-serif;font-size:12px;width:100%">
      <option value="تحويل بنكي">تحويل بنكي</option>
      <option value="نقد">نقد</option>
      <option value="شيك">شيك</option>
      <option value="SWIFT">SWIFT</option>
    </select>
    ${inp('رقم المستند')}
    <button class="btn-remove" onclick="this.parentElement.remove();updatePartnerSummary()" title="حذف">✕</button>
  `;
  const sel = div.querySelector('select');
  sel.onchange = function() {
    if (this.value === '__new__') {
      const name = prompt('اسم الشريك الجديد:');
      if (name) {
        const opt = document.createElement('option');
        opt.value = name; opt.textContent = name;
        this.insertBefore(opt, this.lastElementChild);
        this.value = name;
      } else { this.value = ''; }
    }
    updatePartnerSummary();
  };
  el('partnersContainer').appendChild(div);
}

export function updatePartnerSummary() {
  const total = parseFloat(el('nf-totalAmount').value) || 0;
  const rows  = el('partnersContainer').querySelectorAll('.p-row');
  let shareSum = 0, paidSum = 0, valid = true;
  const lines = [];
  rows.forEach(row => {
    const inputs = row.querySelectorAll('input');
    const sel    = row.querySelector('select');
    const name   = sel?.value || '';
    const share  = parseFloat(inputs[0].value) || 0;
    const paid   = parseFloat(inputs[1].value) || 0;
    if (name && share) {
      const due       = total * share / 100;
      const remaining = due - paid;
      shareSum += share;
      paidSum  += paid;
      lines.push(`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="font-weight:600">${name}</span>
        <span style="font-size:13px;color:var(--text2)">حصة: ${share}% = <span style="color:var(--accent)">${fmt(due)}</span> | دفع: <span style="color:var(--green)">${fmt(paid)}</span> | متبقي: <span style="color:${remaining>0?'var(--red)':'var(--green)'}">${fmt(remaining)}</span></span>
      </div>`);
    }
    if (name && share) valid = true;
  });
  el('partnerShareWarning').style.display = (shareSum > 0 && Math.abs(shareSum-100) > 0.01) ? 'block' : 'none';
  const summary = el('partnerSummary');
  if (lines.length) {
    summary.style.display = '';
    summary.innerHTML = lines.join('') +
      `<div style="display:flex;justify-content:space-between;margin-top:6px;font-weight:700">
        <span>الإجمالي</span>
        <span style="font-size:13px">الحصص: ${fmt(shareSum)}% | مدفوع: <span style="color:var(--green)">${fmt(paidSum)}</span> | متبقي: <span style="color:var(--red)">${fmt(total-paidSum)}</span></span>
      </div>`;
  } else { summary.style.display = 'none'; }
}

export function checkShareTotal() {
  updatePartnerSummary();
}

// ✅ يفرض كوداً فريداً (PART-{ملف}-{رقم}) لأي قطعة/سيارة بلا VIN عند الإدخال
// يمنع تصادم المفتاح (vin فاضي/مكرر) في فلاتر "مباع/متاح" بكل الشاشات.
export async function _assignPartVins(fileNo, vehiclesArr) {
  if (!vehiclesArr?.some(v => !v.vin || !String(v.vin).trim())) return;
  let existing = [];
  try { existing = await apiGetAll('vehicles', { select:'vin', system_type:`eq.${state.system}`, file_no:`eq.${fileNo}` }); } catch(_) {}
  const used = new Set((existing||[]).map(v => (v.vin||'').trim()).filter(Boolean));
  let n = 1;
  vehiclesArr.forEach(v => {
    if (!v.vin || !String(v.vin).trim()) {
      let code; do { code = `PART-${fileNo}-${n++}`; } while (used.has(code));
      used.add(code); v.vin = code;
    }
  });
}

export async function submitNewFile() {
  // ✅ منع التنفيذ المزدوج (مثلاً عند ضغط الحفظ مرتين أو ظهور الديالوج مرتين)
  if (_nfSaving) return;
  _nfSaving = true;
  try {
    await _submitNewFileInner();
  } finally {
    _nfSaving = false;
  }
}

export async function _submitNewFileInner() {
  // Route to edit if in edit mode
  if (_nfEditMode) { await submitEditFileFull(); return; }

  const fileNo      = el('nf-fileNo').value.trim();
  const supplier    = el('nf-supplier')?.value?.trim() || '';
  const poNo        = el('nf-poNo').value.trim();
  const poDate      = el('nf-poDate').value;
  const notes       = el('nf-notes').value.trim();
  const totalAmount = parseFloat(el('nf-totalAmount').value) || 0;

  if (!fileNo)      { showFieldErr('nfError','يرجى إدخال رقم الملف'); return; }
  if (!supplier)    { showFieldErr('nfError','يرجى اختيار المورد'); return; }
  if (!poDate)      { showFieldErr('nfError','يرجى إدخال التاريخ'); return; }
  // التحقق من صحة التاريخ — السنة بين 2000 و 2100
  const poYear = parseInt(poDate.split('-')[0]);
  if (isNaN(poYear) || poYear < 2000 || poYear > 2100) {
    showFieldErr('nfError', `التاريخ غير صحيح: "${poDate}" — تأكد من السنة (مثال: 2026-03-10)`); return;
  }
  if (!totalAmount) { showFieldErr('nfError','يرجى إدخال قيمة الصفقة'); return; }

  // Collect vehicles from table rows
  const vRows = el('vehiclesContainer').querySelectorAll('tr.v-row');
  const vehicles = [];
  let totalPurchase = 0;
  vRows.forEach(row => {
    const type   = row.querySelector('[name="v-type"]')?.value.trim()   || '';
    const model  = row.querySelector('[name="v-model"]')?.value.trim()  || '';
    const year   = parseInt(row.querySelector('[name="v-year"]')?.value) || null;
    const vin    = row.querySelector('[name="v-vin"]')?.value.trim()    || '';
    const plate  = row.querySelector('[name="v-plate"]')?.value.trim()  || '';
    const color  = row.querySelector('[name="v-color"]')?.value.trim()  || '';
    const engine = row.querySelector('[name="v-engine"]')?.value.trim() || '';
    const expiry = row.querySelector('[name="v-expiry"]')?.value        || '';
    const price  = parseFloat(row.querySelector('[name="v-price"]')?.value) || 0;
    const vnotes = row.querySelector('[name="v-notes"]')?.value.trim()  || '';
    vehicles.push({ type, model, year, vin, plate, color, engine, expiry, price, notes:vnotes });
    totalPurchase += price;
  });

  // Use totalAmount as the authoritative total
  const finalTotal = totalAmount || totalPurchase;

  // Collect partners
  const pRows = el('partnersContainer').querySelectorAll('.p-row');
  const partners = [];
  let shareTotal = 0;
  pRows.forEach(row => {
    const inputs  = row.querySelectorAll('input');
    const sels    = row.querySelectorAll('select');
    const name    = sels[0]?.value || '';
    const share   = parseFloat(inputs[0].value) || 0;
    const paid    = parseFloat(inputs[1].value) || 0;
    const payDate = inputs[2]?.value || poDate || '';
    const method  = sels[1]?.value || 'تحويل بنكي';
    const doc     = inputs[3]?.value.trim() || '';
    if (name && share) { partners.push({ name, share, paid, payDate, method, doc }); shareTotal += share; }
  });

  if (partners.length && Math.abs(shareTotal-100) > 0.01) {
    showFieldErr('nfError',`مجموع حصص الشركاء = ${shareTotal}% يجب أن يساوي 100%`); return;
  }

  const btn = el('nfSubmitBtn');
  btn.disabled = true; btn.textContent = '⏳ جاري الحفظ...';

  try {
    await _assignPartVins(fileNo, vehicles);  // ✅ كود فريد للقطع بلا VIN
    // 1. Insert PO
    const poData = {
      system_type:    state.system,
      file_no:        fileNo,
      supplier,
      po_no:          poNo || null,
      po_date:        poDate || null,
      total_purchase: finalTotal,
      vehicle_count:  vehicles.length,
      status:         'OPEN',
      post_status:    entryStatus(),
      notes:          notes || null
    };
    const poIns   = await apiPost('purchase_orders', poData);
    const newPoId = poIns?.[0]?.id || null;

    // 2. Ledger entry for supplier — امسح القديم وأضف جديد
    if (finalTotal > 0) {
      const vinList = vehicles.filter(v=>v.vin).map(v=>v.vin).join(' / ');
      if (entryStatus()==='posted') {
        try {
          await je_purchase({sys:state.system,date:poDate||today(),amount:finalTotal,fileNo,supplier,refId:newPoId});
        } catch(jeErr) {
          await apiPatch('purchase_orders', { system_type:`eq.${state.system}`, file_no:`eq.${fileNo}` }, { post_status:'draft' });
          toast(`⚠️ تم حفظ الصفقة بدون ترحيل قيد الشراء — راجع قائمة الاعتمادات (${jeErr.message})`,'warn');
        }
      }
    }

    // 3. Insert vehicles + تسجيل في مخزن الكويت الأساسي
    for (const v of vehicles) {
      await apiPost('vehicles', {
        system_type: state.system, file_no: fileNo, po_no: poNo||null,
        vin: v.vin||null, vehicle_type: v.type||v.model||null,
        model: v.model||v.type||null, plate: v.plate||null,
        color: v.color||null, engine_size: v.engine||null,
        year: v.year||null, license_expiry: v.expiry||null,
        purchase_price: v.price||0,
        purchase_date: poDate||null, notes: v.notes||null
      });
      // تسجيل تلقائي في مخزن الكويت (المخزن الأساسي)
      if (v.vin) {
        try {
          await apiPost('stock_locations', {
            system_type: state.system, file_no: fileNo,
            vin: v.vin, model: v.model||v.type||null,
            location_name: 'الكويت',
            transfer_date: poDate||today(),
            transfer_ref: 'إدخال أولي', notes: 'مخزن أساسي',
            transferred_by: state.user?.email||null,
          });
        } catch(e) { /* تجاهل لو VIN مكرر */ }
      }
    }

    // 4. Insert partners + their payments
    for (const p of partners) {
      await apiPost('partners_master', {
        system_type: state.system, file_no: fileNo,
        partner: p.name, share_percent: p.share
      });
      // If partner paid something, record as payment
      if (p.paid > 0) {
        const pmtId = `PMT-${fileNo}-P${partners.indexOf(p)+1}`;
        const pmtIns = await apiPost('payments', {
          system_type: state.system, file_no: fileNo,
          pay_id: pmtId, ref_no: pmtId,
          po_no: poNo||null, payer: p.name,
          amount: p.paid, pay_method: p.method||'تحويل بنكي',
          document: p.doc||null, pay_date: p.payDate||poDate||null,
          notes: `حصة ${p.share}% — دفع مقدماً`,
          post_status: entryStatus(),
        });
        // Ledger: partner paid (credit partner account)
        if (entryStatus()==='posted') {
          const pmtId = pmtIns?.[0]?.id || null;
          try {
            await je_payment({sys:state.system,date:poDate||today(),amount:p.paid,fileNo,refId:pmtId,supplierName:supplier,payerName:p.name,method:p.method||'تحويل بنكي'});
          } catch(jeErr) {
            if (pmtId) await apiPatch('payments', { id:`eq.${pmtId}` }, { post_status:'draft' });
            toast(`⚠️ فشل قيد دفعة ${p.name} — أُعيدت لانتظار الموافقة: ${jeErr.message}`,'warn');
          }
        }
      }
    }

    // 5. Audit + تسجيل جهة الاتصال تلقائياً
    await logAudit('INSERT','purchase_orders', fileNo, null, poData);
    if (supplier) await ensureContact(supplier, 'supplier');
    markSaving('newFileModal'); closeModal('newFileModal');
    toast(`✅ تم إنشاء الملف ${fileNo} — ${vehicles.length} سيارة`, 'ok');
    invalidateCache();
    await loadDashboard();
    showDashboard();

    // ✅ طباعة سند الشراء تلقائياً
    // طباعة اختيارية من داخل الملف

  } catch(e) {
    showFieldErr('nfError','خطأ: ' + e.message);
    console.error(e);
  }
  btn.disabled = false; btn.textContent = '💾 حفظ السند';
}

// ════════════════════════════════════════
// SUBMIT EDIT (full sند update)
// ════════════════════════════════════════

// إلغاء دفعة شريك أُزيلت/صُفِّرت أثناء التعديل: عكس قيدها لو كانت مُرحَّلة، أو حذفها مباشرة لو لم يُرحَّل لها قيد بعد
export async function voidOrDeleteOldPayment(op) {
  try {
    if (op.paymentPostStatus === 'posted') {
      const rows = await apiGet('payments', { select:'*', id:`eq.${op.paymentId}` });
      const record = rows?.[0];
      if (record) await voidTransaction('payment', record, true);
    } else {
      await apiDelete('payments', { id:`eq.${op.paymentId}` });
    }
  } catch(e) { console.warn('voidOrDeleteOldPayment:', e.message); }
}

export async function submitEditFileFull() {
  const oldFileNo   = _nfEditFileNo;
  const newFileNo   = el('nf-fileNo').value.trim();
  const supplier    = el('nf-supplier')?.value?.trim() || '';
  const poNo        = el('nf-poNo').value.trim();
  const poDate      = el('nf-poDate').value;
  const notes       = el('nf-notes').value.trim();
  const totalAmount = parseFloat(el('nf-totalAmount').value) || 0;

  if (!supplier)    { showFieldErr('nfError','يرجى اختيار المورد'); return; }
  if (!totalAmount) { showFieldErr('nfError','يرجى إدخال قيمة الصفقة'); return; }

  // Collect vehicles from table rows
  const vRows2 = el('vehiclesContainer').querySelectorAll('tr.v-row');
  const vehicles = [];
  let totalPurchase = 0;
  vRows2.forEach(row => {
    const type   = row.querySelector('[name="v-type"]')?.value.trim()   || '';
    const model  = row.querySelector('[name="v-model"]')?.value.trim()  || '';
    const year   = parseInt(row.querySelector('[name="v-year"]')?.value) || null;
    const vin    = row.querySelector('[name="v-vin"]')?.value.trim()    || '';
    const plate  = row.querySelector('[name="v-plate"]')?.value.trim()  || '';
    const color  = row.querySelector('[name="v-color"]')?.value.trim()  || '';
    const engine = row.querySelector('[name="v-engine"]')?.value.trim() || '';
    const expiry = row.querySelector('[name="v-expiry"]')?.value        || '';
    const price  = parseFloat(row.querySelector('[name="v-price"]')?.value) || 0;
    const vnotes = row.querySelector('[name="v-notes"]')?.value.trim()  || '';
    const vid    = row.dataset.vehicleId || null;
    vehicles.push({ vid, type, model, year, vin, plate, color, engine, expiry, price, notes:vnotes });
    totalPurchase += price;
  });

  // Collect partners
  const pRows = el('partnersContainer').querySelectorAll('.p-row');
  const partners = [];
  let shareTotal = 0;
  pRows.forEach(row => {
    const inputs = row.querySelectorAll('input');
    const sels   = row.querySelectorAll('select');
    const name   = sels[0]?.value || '';
    const share  = parseFloat(inputs[0].value) || 0;
    const paid   = parseFloat(inputs[1].value) || 0;
    const payDate= inputs[2]?.value || poDate || '';
    const method = sels[1]?.value || 'تحويل بنكي';
    const doc    = inputs[3]?.value.trim() || '';
    const pid    = row.dataset.partnerId || null;
    const paymentId = row.dataset.paymentId || null;
    const paymentPostStatus = row.dataset.paymentPostStatus || null;
    if (name) { partners.push({ pid, name, share, paid, payDate, method, doc, paymentId, paymentPostStatus }); shareTotal += share; }
  });

  if (partners.length && Math.abs(shareTotal-100) > 0.01) {
    showFieldErr('nfError',`مجموع حصص الشركاء = ${shareTotal}% يجب أن يساوي 100%`); return;
  }

  const finalTotal = totalAmount || totalPurchase;
  const btn = el('nfSubmitBtn');
  btn.disabled = true; btn.textContent = '⏳ جاري الحفظ...';

  try {
    await _assignPartVins(newFileNo, vehicles);  // ✅ كود فريد للقطع بلا VIN
    // 1. Update PO
    const poPatch = await apiPatch('purchase_orders',
      { system_type:`eq.${state.system}`, file_no:`eq.${oldFileNo}` },
      { file_no:newFileNo, supplier, po_no:poNo||null, po_date:poDate||null,
        total_purchase:finalTotal, vehicle_count:vehicles.length,
        notes:notes||null }
    );
    const poId = poPatch?.[0]?.id || null;

    // 2a. حذف السيارات التي أزالها المستخدم من الجدول
    const remainingVids = new Set(vehicles.filter(v=>v.vid).map(v=>v.vid));
    const deletedVids   = (_originalVehicleIds||[]).filter(id => !remainingVids.has(id));
    for (const vid of deletedVids) {
      try {
        // جيب VIN قبل الحذف لتنظيف المخزون
        const vRow = await apiGet('vehicles', { select:'vin', id:`eq.${vid}` });
        const vin  = vRow?.[0]?.vin;
        await apiDelete('vehicles', { id:`eq.${vid}` });
        if (vin) {
          await apiDelete('stock_locations', { system_type:`eq.${state.system}`, vin:`eq.${vin}` });
        }
      } catch(delErr) { console.warn('delete removed vehicle:', delErr.message); }
    }

    // 2b. Update/insert remaining vehicles
    for (const v of vehicles) {
      if (v.vid) {
        await apiPatch('vehicles', { id:`eq.${v.vid}` }, {
          vehicle_type:v.type||v.model||null, model:v.model||v.type||null,
          vin:v.vin||null, plate:v.plate||null, color:v.color||null,
          engine_size:v.engine||null, year:v.year||null,
          license_expiry:v.expiry||null,
          purchase_price:v.price||0, notes:v.notes||null,
          file_no: newFileNo
        });
      } else {
        const newV = await apiPost('vehicles', {
          system_type:state.system, file_no:newFileNo,
          po_no:poNo||null, vin:v.vin||null,
          vehicle_type:v.type||v.model||null, model:v.model||v.type||null,
          plate:v.plate||null, color:v.color||null,
          purchase_price:v.price||0, purchase_date:poDate||null, notes:v.notes||null
        });
        if (v.vin) {
          try {
            await apiPost('stock_locations', {
              system_type:state.system, file_no:newFileNo,
              vin:v.vin, model:v.model||v.type||null,
              location_name:'الكويت',
              transfer_date:poDate||today(),
              transfer_ref:'إدخال أولي', notes:'مخزن أساسي',
              transferred_by:state.user?.email||null,
            });
          } catch(e) {}
        }
      }
    }

    // 3. Update partners — diff-based: تعديل في المكان للموجود، حذف للمُزال، إنشاء للجديد فقط
    //    (نفس أسلوب السيارات أعلاه) — يحافظ على ثبات id الدفعة فيعمل updateJEInPlace بشكل صحيح
    const remainingPids = new Set(partners.filter(p=>p.pid).map(p=>p.pid));

    // 3a. شركاء أُزيلوا بالكامل من الجدول
    for (const op of (_originalPartners||[])) {
      if (remainingPids.has(op.pid)) continue;
      try { await apiDelete('partners_master', { id:`eq.${op.pid}` }); } catch(e) { console.warn('delete removed partner:', e.message); }
      if (op.paymentId && op.paymentAmount > 0) {
        await voidOrDeleteOldPayment(op);
      }
    }

    // 3b. شركاء موجودون (تعديل في المكان) أو جدد (إنشاء)
    for (const p of partners) {
      const pIndex = partners.indexOf(p) + 1;
      if (p.pid) {
        await apiPatch('partners_master', { id:`eq.${p.pid}` }, {
          partner:p.name, share_percent:p.share, file_no:newFileNo
        });
      } else {
        await apiPost('partners_master', {
          system_type:state.system, file_no:newFileNo,
          partner:p.name, share_percent:p.share
        });
      }

      if (p.paymentId) {
        const orig = (_originalPartners||[]).find(op => op.paymentId === p.paymentId);
        if (p.paid > 0) {
          // تعديل الدفعة في مكانها — نفس id فيبقى ref_id في القيد صحيحاً
          await apiPatch('payments', { id:`eq.${p.paymentId}` }, {
            payer:p.name, amount:p.paid, pay_method:p.method||'تحويل بنكي',
            document:p.doc||null, pay_date:p.payDate||poDate||null,
            file_no:newFileNo, notes:`حصة ${p.share}%`
          });
          if (orig?.paymentPostStatus === 'posted') {
            const amountChanged  = Math.abs((+orig.paymentAmount||0) - (+p.paid||0)) > 0.001;
            const contactChanged = orig.name !== p.name;
            if (amountChanged || contactChanged) {
              await updateJEInPlace({
                sys: state.system, fileNo: oldFileNo,
                refTable: 'payments', refId: p.paymentId,
                oldAmount: orig.paymentAmount, newAmount: p.paid,
                contactPatch: contactChanged ? p.name : null,
                newDate: p.payDate || poDate || null,   // ✅ مزامنة تاريخ قيد دفعة الشريك
              });
            }
          }
        } else if (orig) {
          // المستخدم صفّر مبلغ هذه الدفعة — إلغاؤها
          await voidOrDeleteOldPayment(orig);
        }
      } else if (p.paid > 0) {
        // دفعة جديدة (شريك جديد، أو شريك بدون دفعة سابقة)
        const newPmtId = `PMT-${newFileNo}-P${pIndex}`;
        await apiPost('payments', {
          system_type:state.system, file_no:newFileNo,
          pay_id: newPmtId, ref_no: newPmtId,
          po_no:poNo||null, payer:p.name,
          amount:p.paid, pay_method:p.method||'تحويل بنكي',
          document:p.doc||null, pay_date:p.payDate||poDate||null,
          notes:`حصة ${p.share}%`,
          // الصفقة كانت مُرحَّلة → الدفعة الجديدة تنتظر الموافقة (سيتم إنشاء قيدها عند الموافقة)
          post_status: _originalPOPostStatus==='posted' ? 'pending_edit' : entryStatus(),
        });
      }
    }

    // 4. تحديث القيد المحاسبي في مكانه (كل أسطر القيد)
    await updateJEInPlace({
      sys: state.system, fileNo: oldFileNo,
      refTable: 'purchase_orders', refId: poId,
      oldAmount: _originalPOTotal || finalTotal,
      newAmount: finalTotal,
      contactPatch: supplier !== _originalPOSupplier ? supplier : null,
      newDate: poDate || null,   // ✅ مزامنة تاريخ قيد الشراء مع تاريخ السند الجديد
    });

    // 5. تحديث حالة الصفقة → pending_edit للموافقة
    await apiPatch('purchase_orders',
      { system_type:`eq.${state.system}`, file_no:`eq.${newFileNo}` },
      { post_status: 'pending_edit' }
    );

    // 6. فحص سريع (غير معطِّل): تأكيد أن القيود المُرحَّلة تعكس القيم الجديدة بعد التحديث
    try {
      const checkLines = await apiGetAll('journal_entries', {
        select: 'ref_table,ref_id,dr_amount,cr_amount',
        system_type:`eq.${state.system}`, file_no:`eq.${newFileNo}`,
        post_status:'eq.posted',
      });
      const poLine = (checkLines||[]).find(l => l.ref_table==='purchase_orders' && (+l.dr_amount||0) > 0);
      if (poLine && Math.abs((+poLine.dr_amount||0) - finalTotal) > 0.01) {
        toast(`⚠️ تحقّق من قيد المخزون — القيمة الحالية لا تطابق قيمة الصفقة الجديدة`,'warn');
      }
      for (const p of partners) {
        if (p.paymentId && p.paymentPostStatus==='posted' && p.paid>0) {
          const pLine = (checkLines||[]).find(l => l.ref_table==='payments' && String(l.ref_id)===String(p.paymentId));
          const lineAmt = pLine ? (+pLine.dr_amount||+pLine.cr_amount||0) : 0;
          if (Math.abs(lineAmt - p.paid) > 0.01) {
            toast(`⚠️ تحقّق من قيد دفعة ${p.name} — لم يُحدَّث بالكامل`,'warn');
          }
        }
      }
    } catch(e) { console.warn('post-edit JE check:', e.message); }

    await logAudit('EDIT','purchase_orders',oldFileNo,null,{newFileNo,supplier,finalTotal}, `تعديل سند الشراء ${oldFileNo}`);
    await updateApprovalBadge();

    markSaving('newFileModal'); closeModal('newFileModal');
    toast(`⚠️ تم تعديل الصفقة ${newFileNo} والقيد — في انتظار الموافقة`,'warn');
    await loadDashboard();
    if (state.currentFileNo === oldFileNo || state.currentFileNo === newFileNo) {
      state.currentFileNo = newFileNo;
      openViewer(newFileNo);
    } else {
      showDashboard();
    }
  } catch(e) {
    showFieldErr('nfError','خطأ: '+e.message);
    console.error(e);
  }
  btn.disabled = false; btn.textContent = '💾 حفظ التعديلات';
}



// ════════════════════════════════════════
// OPERATIONS
// ════════════════════════════════════════

export async function openPaymentModal() {
  const fn  = state.currentFileNo;
  const sys = state.system;

  el('payError').style.display = 'none';
  el('pay-amount').value = '';
  el('pay-date').value   = today();
  el('pay-doc').value    = '';
  el('pay-notes').value  = '';

  // لو مفيش ملف محدد — أضف selector للملفات
  let fileSelector = '';
  if (!fn) {
    await ensureCache();
    const dealOptions = (state.allDeals||[])
      .map(d => `<option value="${d.file_no}">${d.file_no} — ${d.supplier||'—'}</option>`)
      .join('');
    fileSelector = `
      <div class="field" style="margin-bottom:12px">
        <label>رقم الملف / الصفقة *</label>
        <select id="pay-file-selector" onchange="onPayFileSelectorChange()" style="width:100%">
          <option value="">— اختر الملف —</option>
          ${dealOptions}
        </select>
      </div>`;
  }

  // بطاقة أمر الشراء
  if (el('pay-file-selector-wrap')) el('pay-file-selector-wrap').innerHTML = fileSelector;

  if (fn) await _loadPaymentModalData(fn, sys);
  else {
    if(el('pay-card-supplier'))  el('pay-card-supplier').textContent  = '—';
    if(el('pay-card-file'))      el('pay-card-file').textContent      = '—';
    if(el('pay-card-total'))     el('pay-card-total').textContent     = '—';
    if(el('pay-card-paid'))      el('pay-card-paid').textContent      = '—';
    if(el('pay-card-remaining')) el('pay-card-remaining').textContent = '—';
  }

  openModal('paymentModal');
}

export async function onPayFileSelectorChange() {
  const fn = el('pay-file-selector')?.value;
  if (fn) await _loadPaymentModalData(fn, state.system);
}

export async function _loadPaymentModalData(fn, sys) {
  try {
    const [po, prevPayments, partners] = await Promise.all([
      apiGetAll('purchase_orders', { select:'file_no,supplier,total_purchase', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGetAll('payments',        { select:'amount,post_status', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGetAll('partners_master', { select:'partner', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
    ]);

    const poData    = po?.[0] || {};
    const totalPO   = +poData.total_purchase || 0;
    const totalPaid = (prevPayments||[]).filter(isPosted).reduce((s,p)=>s+(+p.amount||0), 0);
    const remaining = Math.max(totalPO - totalPaid, 0);

    if(el('pay-card-supplier'))  el('pay-card-supplier').textContent  = poData.supplier || '—';
    if(el('pay-card-file'))      el('pay-card-file').textContent      = fn || '—';
    if(el('pay-card-total'))     el('pay-card-total').textContent     = fmt(totalPO);
    if(el('pay-card-paid'))      el('pay-card-paid').textContent      = fmt(totalPaid);
    if(el('pay-card-remaining')) {
      el('pay-card-remaining').textContent = fmt(remaining);
      el('pay-card-remaining').style.color = remaining > 0 ? 'var(--accent)' : 'var(--green)';
    }
    el('pay-amount').value = remaining > 0 ? remaining.toFixed(3) : '';

    let rawPartners = (partners||[]).map(p=>p.partner);
    if (!rawPartners.length) {
      const allPartners = await getContactsByType('partner');
      rawPartners = (allPartners||[]).map(p=>p.name);
    }
    const payerList = rawPartners.includes(TREASURY_PARTNER) ? rawPartners : [TREASURY_PARTNER, ...rawPartners];
    el('pay-payer').innerHTML = payerList.map(p=>`<option value="${p}">${p}</option>`).join('');
    el('pay-payer').value = TREASURY_PARTNER;
    // حفظ fn في الـ modal
    el('pay-payer').dataset.fileNo = fn;
  } catch(e) { console.error('_loadPaymentModalData:', e.message); toast('خطأ في تحميل بيانات الدفعة: ' + e.message, 'err'); }
}

// ════════════════════════════════════════
// EXPENSE MODAL — multi-row
// ════════════════════════════════════════
export async function openExpenseModal() {
  const fn = state.currentFileNo;
  el('exp-date').value   = today();
  el('exp-method').value = 'تحويل بنكي';
  el('exp-doc').value    = '';
  el('expError').style.display = 'none';
  el('expenseRowsContainer').innerHTML = '';
  addExpenseRow({ fileNo: fn });
  openModal('expenseModal');
  // populate paid_by dropdown async (بعد فتح المودال مباشرة)
  const paidByEl = el('exp-paidBy');
  if (paidByEl && fn) {
    try {
      const partners = await apiGetAll('partners_master', {
        select: 'partner', system_type: `eq.${state.system}`, file_no: `eq.${fn}`
      });
      const raw = (partners||[]).map(p => p.partner);
      const list = raw.includes(TREASURY_PARTNER) ? raw : [TREASURY_PARTNER, ...raw];
      paidByEl.innerHTML = list.map(p => `<option value="${p}">${p}</option>`).join('');
      paidByEl.value = TREASURY_PARTNER;
    } catch(_) {
      paidByEl.innerHTML = `<option value="${TREASURY_PARTNER}">${TREASURY_PARTNER}</option>`;
    }
  }
}

export function addExpenseRow(prefill={}) {
  const tbody = el('expenseRowsContainer');
  if (!tbody) return;
  const fn = prefill.fileNo || state.currentFileNo || '';
  const dealOpts = (state.allDeals||[]).map(d =>
    `<option value="${d.file_no}" ${d.file_no===fn?'selected':''}>${d.file_no} — ${d.supplier||''}</option>`
  ).join('');
  const tr = document.createElement('tr');
  tr.style.borderBottom = '1px solid var(--border)';
  const s = 'width:100%;background:var(--card);border:1px solid var(--border);border-radius:4px;padding:5px 7px;color:var(--text);font-family:Cairo,sans-serif;font-size:12px';
  tr.innerHTML = `
    <td style="padding:4px 3px">
      <select name="er-file" style="${s}">
        <option value="">-- اختر --</option>${dealOpts}
      </select>
    </td>
    <td style="padding:4px 3px"><input type="text" name="er-desc" placeholder="الوصف *" style="${s}"></td>
    <td style="padding:4px 3px">
      <select name="er-type" style="${s}">
        <optgroup label="تكلفة مباشرة">
          <option>شحن بحري</option><option>شحن داخلي</option><option>تأمين الشحنة</option>
          <option>جمارك</option><option>رسوم ميناء</option><option>تخليص جمركي</option>
          <option>فحص وتقييم</option><option>صيانة وإصلاح</option>
          <option>دهان وتشطيب</option><option>تسجيل ولوحات</option>
        </optgroup>
        <optgroup label="مصاريف الصفقة">
          <option>عمولة وسيط</option><option>رسوم حكومية</option><option>مصاريف متنوعة</option>
        </optgroup>
      </select>
    </td>
    <td style="padding:4px 3px"><input type="number" name="er-amount" placeholder="0.00" min="0" step="0.01" oninput="updateExpenseTotal()" style="${s}"></td>
    <td style="padding:4px 3px"><input type="text" name="er-doc" placeholder="مستند" style="${s}"></td>
    <td style="padding:4px 3px"><input type="text" name="er-notes" placeholder="..." style="${s}"></td>
    <td style="padding:4px 3px;text-align:center">
      <button class="btn-remove" onclick="this.closest('tr').remove();updateExpenseTotal()">✕</button>
    </td>`;
  tbody.appendChild(tr);
  updateExpenseTotal();
}

export function updateExpenseTotal() {
  const rows = el('expenseRowsContainer')?.querySelectorAll('tr') || [];
  let total = 0;
  rows.forEach(r => { total += parseFloat(r.querySelector('[name="er-amount"]')?.value)||0; });
  if (el('exp-total')) el('exp-total').textContent = fmt(total);
}

export function toggleExpenseModalSize() {
  const modal = el('expenseModalInner');
  if (!modal) return;
  if (modal.style.maxWidth === '98vw') {
    modal.style.maxWidth = '';
    modal.style.width    = '';
  } else {
    modal.style.maxWidth = '98vw';
    modal.style.width    = '98vw';
    modal.style.maxHeight= '95vh';
  }
}

export async function submitExpense() {
  const dateEl   = document.getElementById('exp-date');
  const methodEl = document.getElementById('exp-method');
  const docEl    = document.getElementById('exp-doc');
  const date    = dateEl?.value   || today();
  const method  = methodEl?.value || 'تحويل بنكي';
  const docRef  = docEl?.value?.trim() || '';
  const paidBy  = el('exp-paidBy')?.value?.trim() || null;

  if (!date) { showFieldErr('expError','يرجى إدخال التاريخ'); return; }

  const rows = el('expenseRowsContainer')?.querySelectorAll('tr') || [];
  const expenses = [];
  rows.forEach(r => {
    const fileNo = r.querySelector('[name="er-file"]')?.value || state.currentFileNo || '';
    const desc   = r.querySelector('[name="er-desc"]')?.value.trim()  || '';
    const type   = r.querySelector('[name="er-type"]')?.value         || 'أخرى';
    const amount = parseFloat(r.querySelector('[name="er-amount"]')?.value) || 0;
    const doc    = r.querySelector('[name="er-doc"]')?.value.trim()   || docRef || '';
    const notes  = r.querySelector('[name="er-notes"]')?.value.trim() || '';
    if (amount > 0) expenses.push({ fileNo, desc:desc||'مصروف', type, amount, doc, notes });
  });

  if (!expenses.length) { showFieldErr('expError','يرجى إضافة بند واحد على الأقل مع المبلغ'); return; }
  
  // Validate file_no for each row
  const missingFile = expenses.find(e => !e.fileNo);
  if (missingFile) { showFieldErr('expError','يرجى اختيار رقم الملف لكل بند'); return; }

  const btn = document.querySelector('#expenseModal .btn-primary');
  if (btn) { btn.disabled=true; btn.textContent='⏳ جاري الحفظ...'; }
  try {
    for (const exp of expenses) {
      const expFileNo = exp.fileNo || state.currentFileNo || 'GENERAL';
      const refNo = (await genSeqRef('EXP', state.system, expFileNo, 'expenses')) || `EXP-${expFileNo}-${Date.now()}`;
      const data = {
        system_type: state.system,
        file_no:     expFileNo,
        pay_id:      refNo,
        description: exp.desc  || 'مصروف',
        exp_type:    exp.type  || 'Miscellaneous',
        category:    exp.type  || null,
        amount:      exp.amount,
        pay_method:  method    || 'Cash',
        document:    exp.doc   || null,
        exp_date:    date,
        expense_date:date,
        notes:       exp.notes || null,
        ref_no:      refNo,
        paid_by:     paidBy    || null,
        post_status: entryStatus()};
      const expIns = await apiPost('expenses', data);
      await logAudit('INSERT','expenses', expFileNo, null, data);
      if (entryStatus()==='posted') {
        const expId = expIns?.[0]?.id || null;
        try {
          await je_expense({sys:state.system,date,amount:exp.amount,fileNo:expFileNo,refId:expId,desc:exp.desc||'مصروف',expType:exp.type||'أخرى',method,paidBy});
        } catch(jeErr) {
          console.error('je_expense failed:', jeErr.message);
          if (expId) await apiPatch('expenses', { id:`eq.${expId}` }, { post_status:'draft' });
          toast(`⚠️ تم حفظ المصروف بدون ترحيل قيده — راجع قائمة الاعتمادات (${jeErr.message})`,'warn');
        }
      }
    }
    markSaving('expenseModal'); closeModal('expenseModal');
    invalidateCache();
    toast(`✅ تم تسجيل ${expenses.length} مصروف`,'ok');
    if (state.currentFileNo) {
      if (state.currentTab === 3) loadExpensesTab(state.currentFileNo, state.system);
      if (state.currentTab === 0) loadSummaryTab(state.currentFileNo, state.system);
      loadViewerKpis(state.currentFileNo, state.system);
    }
  } catch(e) { showFieldErr('expError','خطأ: '+e.message); }
  if (btn) { btn.disabled=false; btn.textContent='💾 حفظ الكل'; }
}

// Payment
export async function submitPayment() {
  const fn     = state.currentFileNo || el('pay-file-selector')?.value || el('pay-payer')?.dataset?.fileNo || null;
  const payer  = (el('pay-payer').value || '').trim();
  const amount = parseFloat(el('pay-amount').value);
  const method = el('pay-method').value;
  const doc    = el('pay-doc').value.trim();
  const date   = el('pay-date').value;
  const notes  = el('pay-notes').value.trim();

  if (!fn)     { showFieldErr('payError','يرجى اختيار الملف/الصفقة'); return; }
  if (!payer || !amount || !date) { showFieldErr('payError','يرجى ملء الحقول المطلوبة'); return; }

  // تحذير لو الدفعة أكبر من المتبقي
  const remainingText = el('pay-card-remaining')?.textContent?.replace(/,/g,'');
  const remaining = parseFloat(remainingText) || 0;
  const totalPOText = el('pay-card-total')?.textContent?.replace(/,/g,'');
  const totalPO = parseFloat(totalPOText) || 0;
  if (amount > remaining + 0.001) {
    const exceedTotal = totalPO > 0 && amount > totalPO + 0.001;
    const warningTitle = exceedTotal ? '⚠️ تجاوز إجمالي الصفقة' : '⚠️ تجاوز الباقي المستحق';
    const warningMsg   = exceedTotal
      ? `قيمة الدفعة (${fmt(amount)}) تتجاوز إجمالي الصفقة (${fmt(totalPO)}).\nهل تريد المتابعة رغم ذلك؟`
      : `قيمة الدفعة (${fmt(amount)}) أكبر من الباقي للمورد (${fmt(remaining)}).\nهل تريد المتابعة؟`;
    const okBtn = document.getElementById('confirmDeleteOkBtn');
    confirmAction(warningTitle, warningMsg, async () => {
      await _proceedSubmitPayment();
    }, true);
    if (okBtn) { okBtn.textContent = '⚠️ نعم، متابعة'; okBtn.style.background = 'var(--accent)'; }
    return;
  }
  await _proceedSubmitPayment();
}

// Helper to avoid code duplication
export async function _proceedSubmitPayment() {
  const fn     = state.currentFileNo;
  const payer  = el('pay-payer')?.value?.trim()  || '';
  const amount = parseFloat(el('pay-amount').value);
  const method = el('pay-method').value;
  const doc    = el('pay-doc').value.trim();
  const date   = el('pay-date').value;
  const notes  = el('pay-notes').value.trim();
  if (!fn || !payer || !amount || !date) return;

  try {
    const refNo = (await genSeqRef('PMT', state.system, fn, 'payments')) || `PMT-${fn}-${Date.now()}`;
    const data = {
      system_type: state.system, file_no: fn,
      pay_id: refNo, ref_no: refNo,
      po_no: state.currentDeal?.po_no || null,
      payer, amount, pay_method: method,
      document: doc||null, pay_date: date,
      notes: notes||null
    , post_status:entryStatus()};
    const payIns = await apiPost('payments', data);
    await logAudit('INSERT','payments',fn,null,data);
    const poArr = await apiGetAll('purchase_orders', { select:'supplier', system_type:`eq.${state.system}`, file_no:`eq.${fn}` });
    const supplierName = poArr?.[0]?.supplier || state.allDeals.find(d=>d.file_no===fn)?.supplier || '';
    if (entryStatus()==='posted') {
      const payId = payIns?.[0]?.id || null;
      try {
        await je_payment({sys:state.system,date,amount,fileNo:fn,refId:payId,supplierName,payerName:payer,method});
      } catch(jeErr) {
        if (payId) await apiPatch('payments', { id:`eq.${payId}` }, { post_status:'draft' });
        toast(`⚠️ تم حفظ الدفعة بدون ترحيل قيدها — راجع قائمة الاعتمادات (${jeErr.message})`,'warn');
      }
    }

    // ── ⛔ تم إلغاء الإنشاء التلقائي لـ partner_payouts عند دفع شريك ──
    // كان يُنشئ سجل "استرداد رأس مال" تلقائياً بنفس مبلغ كل دفعة للمورد إذا كان
    // الدافع شريكاً، مما تسبب في سجلات وهمية متكررة (تم تنظيفها يدوياً عبر cleanup.js).
    // التسجيل الآن خطوة يدوية واعية يقوم بها المستخدم من شاشة "صرف شريك".

    markSaving('paymentModal'); closeModal('paymentModal');
    toast('✅ تم تسجيل الدفعة بنجاح','ok');
    if (state.currentTab === 2) loadPaymentsTab(fn, state.system);
    if (state.currentTab === 0) loadSummaryTab(fn, state.system);
  } catch(e) { showFieldErr('payError','خطأ: '+e.message); }
}

// Expense
// submitExpense moved to EXPENSE MODAL section above

// Sale - open modal, populate vehicles
export async function openSaleModal(fileNoOverride = null) {
  const fn  = fileNoOverride || state.currentFileNo;
  const sys = state.system;

  // ملأ قائمة الملفات
  const sel = el('sale-fileNo');
  sel.innerHTML = '<option value="">— اختر الملف —</option>';
  try {
    const deals = await apiGetAll('purchase_orders', {
      select:'file_no,supplier', system_type:`eq.${sys}`, order:'created_at.desc'
    });
    (deals||[]).forEach(d => {
      const o = document.createElement('option');
      o.value = d.file_no;
      o.textContent = `${d.file_no} — ${d.supplier||''}`;
      sel.appendChild(o);
    });
    if (fn) sel.value = fn;
  } catch(e) { console.warn('openSaleModal files:', e.message); }

  // Reset
  el('sale-date').value  = today();
  el('sale-notes').value = '';
  el('sale-customer').value = '';
  el('saleError').style.display = 'none';
  el('saleTotalDisplay').textContent = '0.000';
  await populateContactSelect('sale-customer','customer');

  // رقم الفاتورة
  const fileNo = sel.value;
  try {
    if (fileNo) {
      const prev = await apiGetAll('sales', { select:'inv_no', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, order:'created_at.desc', limit:100 });
      const max  = Math.max(0, ...(prev||[]).map(s=>{ const m=(s.inv_no||'').match(/(\d+)$/); return m?+m[1]:0; }));
      el('sale-invNo').value = `INV-${fileNo}-${String(max+1).padStart(3,'0')}`;
    } else {
      el('sale-invNo').value = `INV-${sys}-001`;
    }
  } catch(e) { console.warn('regenInvNo:', e.message); }

  // مسح المصاريف الإضافية
  if (el('extraChargesContainer')) el('extraChargesContainer').innerHTML = '';
  updateSaleTotal();
  // تحميل السيارات مباشرة (renderSaleVehiclePicker تعرض + تحمّل state._saleAvailableVehicles)
  await renderSaleVehiclePicker(fileNo, sys);
  openModal('saleModal');
}

export async function onSaleFileChange(fn) {
  try {
    if (fn) {
      const prev = await apiGetAll('sales', { select:'inv_no', system_type:`eq.${state.system}`, file_no:`eq.${fn}`, order:'created_at.desc', limit:100 });
      const max  = Math.max(0, ...(prev||[]).map(s=>{ const m=(s.inv_no||'').match(/(\d+)$/); return m?+m[1]:0; }));
      el('sale-invNo').value = `INV-${fn}-${String(max+1).padStart(3,'0')}`;
    }
  } catch(e) { console.warn('onSaleFileChange invNo:', e.message); }
  // Reset VIN search on file change
  const vinSearchInp = el('sale-vin-search');
  if (vinSearchInp) vinSearchInp.value = '';
  const clearBtn = el('sale-vin-search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  const countSpan = el('sale-vin-match-count');
  if (countSpan) countSpan.style.display = 'none';
  await renderSaleVehiclePicker(fn, state.system);
}

export async function loadAvailableVehicles(fn, sys) {
  const vehicles = await apiGetAll('vehicles', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` });
  const sales    = await apiGetAll('sales', { select:'vin', system_type:`eq.${sys}`, file_no:`eq.${fn}` });
  const soldVins = new Set((sales||[]).map(s=>s.vin).filter(Boolean));
  return (vehicles||[]).filter(v=>!soldVins.has(v.vin));
}


// ════════════════════════════════════════
// SALE VEHICLE PICKER — checkboxes
// ════════════════════════════════════════
export async function renderSaleVehiclePicker(fn, sys) {
  const container = el('saleVehiclesContainer');
  if (!fn) {
    container.innerHTML = `<tr id="sale-no-file-msg"><td colspan="5" style="padding:20px;text-align:center;color:var(--text2);font-size:12px">اختر رقم الملف لعرض السيارات المتاحة</td></tr>`;
    updateSaleTotal();
    return;
  }
  container.innerHTML = `<tr><td colspan="5" style="padding:14px;text-align:center;color:var(--text2);font-size:12px"><div class="spinner" style="display:inline-block;width:16px;height:16px;margin-left:6px"></div> جاري تحميل السيارات...</td></tr>`;
  try {
    const vehicles = await loadAvailableVehicles(fn, sys);
    state._saleAvailableVehicles = vehicles;
    if (!vehicles.length) {
      container.innerHTML = `<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--text2);font-size:12px">⚠️ لا توجد سيارات متاحة في هذا الملف</td></tr>`;
      updateSaleTotal();
      return;
    }
    const s = 'width:100%;background:var(--card);border:1px solid var(--border);border-radius:4px;padding:6px 8px;color:var(--text);font-family:monospace;font-size:12px';
    const sn = 'width:100%;background:var(--card);border:1px solid var(--border);border-radius:4px;padding:6px 8px;color:var(--text);font-family:Cairo,sans-serif;font-size:12px';
    container.innerHTML = vehicles.map((v, i) => `
      <tr class="sale-v-row"
        data-vehicle-id="${v.id}"
        data-vin="${(v.vin||'').replace(/"/g,'&quot;')}"
        data-model="${(v.model||v.vehicle_type||'').replace(/"/g,'&quot;')}"
        data-plate="${(v.plate||'').replace(/"/g,'&quot;')}"
        data-color="${(v.color||'').replace(/"/g,'&quot;')}"
        data-year="${v.year||''}"
        data-engine="${v.engine_size||''}"
        style="transition:background .15s">
        <td style="padding:6px 8px;text-align:center;width:36px">
          <input type="checkbox" class="sv-check"
            onchange="onSaleVehicleCheck(this)"
            style="width:16px;height:16px;cursor:pointer;accent-color:var(--green)">
        </td>
        <td style="padding:6px 8px">
          <div style="font-weight:600;font-size:13px">${v.model||v.vehicle_type||'—'} ${v.year||''}</div>
          <div class="sale-vin-text" style="font-family:monospace;font-size:13px;font-weight:700;color:var(--blue);direction:ltr;letter-spacing:.8px;margin:2px 0">${v.vin||'—'}</div>
          <div style="font-size:13px;color:var(--text2)">${v.color||''}${v.plate?' · '+v.plate:''}</div>
        </td>
        <td style="padding:6px 8px;text-align:center">
          <span style="color:var(--blue);font-family:monospace;font-size:12px;font-weight:600">${fmt(v.purchase_price)}</span>
        </td>
        <td style="padding:6px 8px">
          <input type="number" name="sv-price" placeholder="سعر البيع *" min="0" step="0.001"
            disabled oninput="updateSaleTotal()"
            style="${s};opacity:.4;cursor:not-allowed">
        </td>
        <td style="padding:6px 8px">
          <input type="text" name="sv-notes" placeholder="ملاحظة" disabled
            style="${sn};opacity:.4;cursor:not-allowed">
        </td>
      </tr>`).join('');
    updateSaleTotal();
  } catch(e) {
    container.innerHTML = `<tr><td colspan="5" style="padding:12px;color:var(--red);font-size:12px">خطأ: ${e.message}</td></tr>`;
  }
}

export function filterSaleVehiclesByVin(query) {
  const clearBtn  = el('sale-vin-search-clear');
  const countSpan = el('sale-vin-match-count');
  const rows      = document.querySelectorAll('#saleVehiclesContainer .sale-v-row');
  const q         = (query || '').trim().toLowerCase();

  if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';

  let visible = 0;
  rows.forEach(row => {
    const vin = (row.dataset.vin || '').toLowerCase();
    const model = (row.dataset.model || '').toLowerCase();
    const matches = !q || vin.includes(q) || model.includes(q);
    row.style.display = matches ? '' : 'none';
    if (matches) visible++;

    // Highlight matching VIN text
    const vinEl = row.querySelector('.sale-vin-text');
    if (vinEl && q && vin.includes(q)) {
      const original = row.dataset.vin || '—';
      const idx = original.toLowerCase().indexOf(q);
      if (idx >= 0) {
        vinEl.innerHTML =
          original.slice(0, idx) +
          `<mark style="background:var(--yellow,#ffe066);color:#000;border-radius:2px;padding:0 1px">${original.slice(idx, idx + q.length)}</mark>` +
          original.slice(idx + q.length);
      }
    } else if (vinEl) {
      vinEl.textContent = row.dataset.vin || '—';
    }
  });

  if (countSpan) {
    if (q && rows.length > 0) {
      countSpan.textContent = `${visible} / ${rows.length}`;
      countSpan.style.display = 'block';
    } else {
      countSpan.style.display = 'none';
    }
  }
}

export function clearSaleVinSearch() {
  const inp = el('sale-vin-search');
  if (inp) { inp.value = ''; inp.focus(); }
  filterSaleVehiclesByVin('');
}

export function onSaleVehicleCheck(checkbox) {
  const row      = checkbox.closest('tr');
  const priceInp = row.querySelector('[name="sv-price"]');
  const notesInp = row.querySelector('[name="sv-notes"]');
  const checked  = checkbox.checked;
  row.style.background = checked ? 'var(--green-dim)' : '';
  if (priceInp) {
    priceInp.disabled = !checked;
    priceInp.style.opacity  = checked ? '1' : '.4';
    priceInp.style.cursor   = checked ? '' : 'not-allowed';
    if (checked) { priceInp.focus(); priceInp.select(); }
  }
  if (notesInp) {
    notesInp.disabled = !checked;
    notesInp.style.opacity = checked ? '1' : '.4';
    notesInp.style.cursor  = checked ? '' : 'not-allowed';
  }
  updateSaleTotal();
}

export function saleToggleAll(masterCheck) {
  const rows = el('saleVehiclesContainer').querySelectorAll('tr.sale-v-row');
  rows.forEach(row => {
    const cb = row.querySelector('.sv-check');
    if (cb) { cb.checked = masterCheck.checked; onSaleVehicleCheck(cb); }
  });
}

// kept for backward compat (openEditSaleApproval uses addSaleVehicleRow)
export function addSaleVehicleRow() {
  const container = el('saleVehiclesContainer');
  // In picker mode, this is no-op — rows are auto-generated
  // Only used when editing from approval queue via openEditSaleApproval
}

export function onSaleRowVehicleChange(sel) {}
export function onSaleVehicleChange(sel)    {}

export function updateSaleTotal() {
  const rows = el('saleVehiclesContainer')?.querySelectorAll('tr.sale-v-row') || [];
  let carsTotal = 0, checked = 0;
  rows.forEach(r => {
    const cb = r.querySelector('.sv-check');
    if (cb && cb.checked) {
      carsTotal += parseFloat(r.querySelector('[name="sv-price"]')?.value) || 0;
      checked++;
    }
  });
  if (el('saleTotalDisplay')) el('saleTotalDisplay').textContent = fmt(carsTotal);
  if (el('saleTotalWrap'))    el('saleTotalWrap').style.display  = checked > 0 ? 'flex' : 'none';
  // update label
  const lbl = el('sale-selected-count');
  if (lbl) lbl.textContent = checked > 0 ? `${checked} سيارة مختارة` : '';

  // حساب المصاريف الإضافية
  const extraRows = el('extraChargesContainer')?.querySelectorAll('.extra-charge-row') || [];
  let extraTotal = 0;
  extraRows.forEach(r => {
    extraTotal += parseFloat(r.querySelector('.ec-amount')?.value) || 0;
  });
  if (el('extraChargesTotalDisplay')) el('extraChargesTotalDisplay').textContent = fmt(extraTotal);
  const extraWrap = el('extraChargesTotalWrap');
  if (extraWrap) extraWrap.style.display = extraRows.length > 0 ? 'flex' : 'none';

  // الإجمالي الكلي
  const grandTotal = carsTotal + extraTotal;
  const grandWrap = el('saleGrandTotalWrap');
  if (grandWrap) grandWrap.style.display = (checked > 0 || extraRows.length > 0) ? 'flex' : 'none';
  if (el('saleGrandTotalDisplay')) el('saleGrandTotalDisplay').textContent = fmt(grandTotal);
}

export function addExtraChargeRow(desc = '', amount = '') {
  const container = el('extraChargesContainer');
  if (!container) return;
  const idx = Date.now();
  const s = 'background:var(--card);border:1px solid var(--border);border-radius:4px;padding:7px 10px;color:var(--text);font-family:Cairo,sans-serif;font-size:12px;width:100%';
  const sm = 'background:var(--card);border:1px solid var(--border);border-radius:4px;padding:7px 10px;color:var(--text);font-family:monospace;font-size:12px;width:100%';
  const row = document.createElement('div');
  row.className = 'extra-charge-row';
  row.dataset.idx = idx;
  row.style.cssText = 'display:grid;grid-template-columns:1fr 140px auto;gap:8px;align-items:center;margin-bottom:8px';
  row.innerHTML = `
    <input type="text" class="ec-desc" placeholder="وصف المصروف (مثال: رسوم تسجيل، نقل، ...)" value="${desc}"
      style="${s}" oninput="updateSaleTotal()">
    <input type="number" class="ec-amount" placeholder="0.000" value="${amount}" min="0" step="0.001"
      style="${sm}" oninput="updateSaleTotal()">
    <button type="button" onclick="removeExtraChargeRow(this)"
      style="background:var(--red-dim);border:1px solid var(--red);color:var(--red);border-radius:4px;padding:6px 10px;cursor:pointer;font-size:13px;line-height:1">✕</button>
  `;
  container.appendChild(row);
  updateSaleTotal();
  row.querySelector('.ec-desc').focus();
}

export function removeExtraChargeRow(btn) {
  btn.closest('.extra-charge-row').remove();
  updateSaleTotal();
}

export function toggleSalePayment(checked) {
  const fields = el('sale-payment-fields');
  if (fields) fields.style.display = checked ? 'block' : 'none';
  if (checked) {
    // اضبط تاريخ الدفع على اليوم تلقائي
    const payDate = el('sale-pay-date');
    if (payDate && !payDate.value) payDate.value = today();
    // اضبط المبلغ على الإجمالي تلقائي
    const totalAmt = Array.from(document.querySelectorAll('[name="sv-price"]'))
      .reduce((s, i) => s + (parseFloat(i.value)||0), 0);
    const payAmt = el('sale-pay-amount');
    if (payAmt && !payAmt.value && totalAmt > 0) payAmt.value = totalAmt.toFixed(3);
  }
}

let _saleSaving = false;
export async function submitSale() {
  if (_saleSaving) { toast('⏳ جاري الحفظ، انتظر...', 'err'); return; }

  const fn       = el('sale-fileNo').value.trim();
  const invNo    = el('sale-invNo').value.trim();
  const customer = el('sale-customer')?.value?.trim() || '';
  const date     = el('sale-date').value;
  const notes    = el('sale-notes').value.trim();

  if (!fn)       { showFieldErr('saleError','يرجى اختيار رقم الملف'); return; }
  if (!customer) { showFieldErr('saleError','يرجى اختيار العميل'); return; }
  if (!date)     { showFieldErr('saleError','يرجى إدخال التاريخ'); return; }
  if (!invNo)    { showFieldErr('saleError','يرجى إدخال رقم الفاتورة'); return; }

  // ── جمع السيارات المحددة من الـ picker ──
  const rows = el('saleVehiclesContainer').querySelectorAll('tr.sale-v-row');
  const saleItems = [];
  rows.forEach(row => {
    const cb    = row.querySelector('.sv-check');
    // support both picker mode (checkbox) and legacy mode (select)
    const isChecked = cb ? cb.checked : !!row.querySelector('[name="sv-vehicle"]')?.value;
    if (!isChecked) return;
    const price = parseFloat(row.querySelector('[name="sv-price"]')?.value) || 0;
    const vnote = row.querySelector('[name="sv-notes"]')?.value?.trim() || '';
    const vin   = row.dataset?.vin  || row.querySelector('[name="sv-vin"]')?.value || '';
    const vehicleSel = row.querySelector('[name="sv-vehicle"]');
    const opt   = vehicleSel?.options[vehicleSel?.selectedIndex];
    if (price > 0) {
      saleItems.push({
        vehicleId: row.dataset?.vehicleId || vehicleSel?.value || '',
        price, vnote, fileNo: fn,
        vin:    vin  || opt?.dataset?.vin    || '',
        model:  row.dataset?.model  || opt?.dataset?.model  || '',
        plate:  row.dataset?.plate  || opt?.dataset?.plate  || '',
        color:  row.dataset?.color  || opt?.dataset?.color  || '',
        year:   row.dataset?.year   || opt?.dataset?.year   || '',
        engine: row.dataset?.engine || opt?.dataset?.engine || '',
      });
    }
  });

  if (!saleItems.length) { showFieldErr('saleError','يرجى تحديد سيارة واحدة على الأقل وإدخال سعر البيع'); return; }

  // ── جمع المصاريف الإضافية على العميل ──
  const extraCharges = [];
  el('extraChargesContainer')?.querySelectorAll('.extra-charge-row').forEach(r => {
    const desc   = r.querySelector('.ec-desc')?.value?.trim() || '';
    const amount = parseFloat(r.querySelector('.ec-amount')?.value) || 0;
    if (amount > 0) extraCharges.push({ desc: desc || 'مصروف إضافي', amount });
  });
  const extraTotal = extraCharges.reduce((s, c) => s + c.amount, 0);

  // ── منع التكرار: تحقق من رقم الفاتورة ضمن نفس النظام فقط ──
  try {
    // نستخدم apiGet بدلاً من apiGetAll لتجنب جلب بيانات النظام الآخر
    const existing = await apiGet('sales', { select:'id', system_type:`eq.${state.system}`, inv_no:`eq.${invNo}` });
    if (existing?.length && !el('saleSubmitBtn')._editMode) {
      showFieldErr('saleError', `⚠️ رقم الفاتورة "${invNo}" مسجّل مسبقاً في نظام ${state.system} — غيّر الرقم أو استخدم 🔄 لتوليد رقم جديد`);
      return;
    }
  } catch(e) { console.warn('duplicate invoice check:', e.message); }

  const totalPrice = saleItems.reduce((s,i)=>s+i.price,0);
  const grandTotal = totalPrice + extraTotal; // إجمالي شامل المصاريف الإضافية
  const btn = el('saleSubmitBtn');
  _saleSaving = true;
  btn.disabled = true;
  btn.textContent = '⏳ جاري الحفظ...';

  try {
    // ── تسجيل سجل بيع لكل سيارة ──
    const saleIds = [];
    for (const item of saleItems) {
      const data = {
        system_type: state.system, file_no: item.fileNo||fn,
        inv_no: invNo, vin: item.vin||null, customer,
        sale_price: item.price, sale_date: date, post_status: entryStatus(),
        notes: item.vnote||notes||null
      };
      const saleIns = await apiPost('sales', data);
      await logAudit('INSERT','sales', item.fileNo||fn, null, data);
      if (saleIns?.[0]?.id) saleIds.push(saleIns[0].id);
    }
    if (customer) await ensureContact(customer, 'customer');

    // ── حفظ المصاريف الإضافية في sale_charges ──
    // عند التعديل: احذف القديمة أولاً ثم أعد الحفظ
    if (el('saleSubmitBtn')._editMode) {
      try { await apiDelete('sale_charges', { system_type:`eq.${state.system}`, inv_no:`eq.${invNo}` }); } catch(e) {}
    }
    for (const ec of extraCharges) {
      await apiPost('sale_charges', {
        system_type: state.system, file_no: fn,
        inv_no: invNo, description: ec.desc, amount: ec.amount,
      });
    }

    if (entryStatus()==='posted') {
      try {
        // ✅ COGS = (إجمالي الشراء + المصاريف المرحّلة) ÷ عدد السيارات × عدد المباعة في الفاتورة
        const totalCOGS = await calcCOGS(state.system, fn, saleItems.length, { soldVins: saleItems.map(i=>i.vin) });
        // ✅ القيد يستخدم grandTotal (شامل extra charges) لتطابق قيمة التحصيل
        await je_sale({sys:state.system, date, amount:grandTotal, cost:totalCOGS, fileNo:fn, customer, invNo});
      } catch(jeErr) {
        if (saleIds.length) await apiPatch('sales', { id:`in.(${saleIds.join(',')})` }, { post_status:'draft' });
        toast(`⚠️ تم حفظ الفاتورة بدون ترحيل قيدها — راجع قائمة الاعتمادات (${jeErr.message})`,'warn');
      }
    }

    // ── اقرأ بيانات الدفع قبل إغلاق المودال ──
    // FIX: القراءة تتم هنا قبل closeModal لضمان وجود العناصر في DOM
    const isPaid      = el('sale-paid-now')?.checked || false;
    const payMethod   = el('sale-pay-method')?.value || 'تحويل بنكي';
    const payDoc      = el('sale-pay-doc')?.value?.trim() || null;
    const payDate     = el('sale-pay-date')?.value || date;
    const payNotes    = el('sale-pay-notes')?.value?.trim() || null;
    const payAmtInput = parseFloat(el('sale-pay-amount')?.value) || 0;
    const allVins     = saleItems.map(i=>i.vin).filter(Boolean).join(' / ');

    // ── تحديث حالة الصفقة ──
    const allV = await apiGetAll('vehicles', { select:'vin', system_type:`eq.${state.system}`, file_no:`eq.${fn}` });
    const allS = await apiGetAll('sales', { select:'vin', system_type:`eq.${state.system}`, file_no:`eq.${fn}` });
    const soldSet = new Set((allS||[]).map(s=>s.vin).filter(Boolean));
    const allSold = (allV||[]).every(v=>soldSet.has(v.vin));
    await apiPatch('purchase_orders', { system_type:`eq.${state.system}`, file_no:`eq.${fn}` },
      { status: allSold ? 'CLOSED' : 'IN PROGRESS' });

    closeModal('saleModal');
    invalidateCache();

    // ── تحصيل واحد للفاتورة كلها (شامل المصاريف الإضافية) ──
    // OPTION B: إذا كان posted → paid_date + قيد فوراً
    //           إذا كان draft + isPaid=true → paid_date يُحفظ في draft
    //             لتُعالَج تلقائياً عند الموافقة على البيع من approveItem('sale')
    //           إذا كان draft + isPaid=false → paid_date=null (مستحق)
    const isPostedNow = entryStatus() === 'posted';
    const isPartial   = isPaid && payAmtInput > 0 && payAmtInput < grandTotal;

    try {
      const colRefNo = (await genSeqRef('COL', state.system, fn, 'collections')) || `COL-${invNo}-${Date.now()}`;

      if (isPartial) {
        // دفع جزئي: سجّل المدفوع + الباقي كمستحق
        const colRefNo2 = `${colRefNo}-R`;
        const col1 = {
          system_type: state.system, file_no: fn, inv_no: invNo, customer,
          vin: allVins, amount: payAmtInput, pay_method: payMethod,
          document: payDoc, due_date: date,
          // draft+isPaid → نحفظ paid_date ليُعالَج تلقائياً عند الموافقة
          paid_date: isPaid ? payDate : null,
          notes: payNotes, post_status: entryStatus(),
          ref_no: colRefNo, pay_id: colRefNo,
        };
        const col2 = {
          system_type: state.system, file_no: fn, inv_no: invNo, customer,
          vin: allVins, amount: grandTotal - payAmtInput, pay_method: payMethod,
          document: null, due_date: date, paid_date: null,
          notes: `باقي الفاتورة ${invNo}`, post_status: entryStatus(),
          ref_no: colRefNo2, pay_id: colRefNo2,
        };
        const col1Ins = await apiPost('collections', col1);
        await apiPost('collections', col2);
        await logAudit('INSERT','collections',fn,null,col1);
        if (customer) await ensureContact(customer, 'customer');
        if (isPostedNow) {
          const col1Id = col1Ins?.[0]?.id || null;
          try {
            await je_collection({ sys:state.system, date:payDate, amount:payAmtInput, fileNo:fn, refId:col1Id, customer, invNo, method:payMethod });
          } catch(jeErr) {
            if (col1Id) await apiPatch('collections', { id:`eq.${col1Id}` }, { post_status:'draft' });
            toast(`⚠️ فشل قيد التحصيل — أُعيد لانتظار الموافقة: ${jeErr.message}`,'warn');
          }
        }
      } else {
        // دفع كامل أو بدون دفع الآن
        const colData = {
          system_type: state.system, file_no: fn, inv_no: invNo, customer,
          vin: allVins, amount: grandTotal, pay_method: payMethod,
          document: payDoc, due_date: date,
          // draft+isPaid → نحفظ paid_date ليُعالَج تلقائياً عند الموافقة
          paid_date: isPaid ? payDate : null,
          notes: payNotes, post_status: entryStatus(),
          ref_no: colRefNo, pay_id: colRefNo,
        };
        const colDataIns = await apiPost('collections', colData);
        await logAudit('INSERT','collections',fn,null,colData);
        if (customer) await ensureContact(customer, 'customer');
        if (isPaid && isPostedNow) {
          const colDataId = colDataIns?.[0]?.id || null;
          try {
            await je_collection({ sys:state.system, date:payDate, amount:grandTotal, fileNo:fn, refId:colDataId, customer, invNo, method:payMethod });
          } catch(jeErr) {
            if (colDataId) await apiPatch('collections', { id:`eq.${colDataId}` }, { post_status:'draft' });
            toast(`⚠️ فشل قيد التحصيل — أُعيد لانتظار الموافقة: ${jeErr.message}`,'warn');
          }
        }
      }
    } catch(e) { console.error('collection create error:', e.message); toast('⚠️ تم حفظ البيع لكن فشل إنشاء التحصيل: ' + e.message, 'warn'); }

    invalidateCache();
    toast(`✅ تم تسجيل فاتورة ${invNo} — ${saleItems.length} سيارة${extraCharges.length?' + '+extraCharges.length+' مصروف إضافي':''}`, 'ok');
    state.currentSales = allS || [];
    if (state.currentTab === 4) loadSalesTab(fn, state.system);
    if (state.currentTab === 0) loadSummaryTab(fn, state.system);
    printSaleInvoice({ invNo, customer, date, fn, notes, items: saleItems, total: totalPrice, extraCharges, grandTotal });

  } catch(e) { showFieldErr('saleError','خطأ: '+e.message); console.error(e); }
  finally {
    _saleSaving = false;
    btn.disabled = false;
    btn.textContent = '💾 حفظ وعرض الفاتورة';
  }
}

// ════════════════════════════════════════
// PRINT SALE INVOICE
// ════════════════════════════════════════

// Collection - open modal
export async function openCollectionModal() {
  const fn  = state.currentFileNo;
  const sys = state.system;

  // Reset form
  el('col-invNo').innerHTML    = '<option value="">جاري التحميل...</option>';
  el('col-inv-card').style.display   = 'none';
  el('col-form-fields').style.display = 'none';
  el('col-submit-btn').style.display  = 'none';
  el('col-amount').value   = '';
  el('col-dueDate').value  = '';
  el('col-paidDate').value = '';
  el('col-doc').value      = '';
  el('col-notes').value    = '';
  el('colError').style.display = 'none';
  const recByEl = el('col-receivedBy');
  if (recByEl) recByEl.innerHTML = `<option value="${TREASURY_PARTNER}">${TREASURY_PARTNER}</option>`;
  openModal('collectionModal');

  try {
    // لو مفيش ملف محدد — جيب كل الفواتير من كل الملفات
    const salesParams = fn
      ? { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, order:'sale_date.desc' }
      : { select:'*', system_type:`eq.${sys}`, order:'sale_date.desc' };
    const colParams = fn
      ? { select:'inv_no,amount,paid_date,file_no,post_status', system_type:`eq.${sys}`, file_no:`eq.${fn}` }
      : { select:'inv_no,amount,paid_date,file_no,post_status', system_type:`eq.${sys}` };
    const partnerParams = fn
      ? { select:'partner', system_type:`eq.${sys}`, file_no:`eq.${fn}` }
      : null;

    const [sales, collections, partnersRes] = await Promise.all([
      apiGetAll('sales',       salesParams),
      apiGetAll('collections', colParams),
      partnerParams ? apiGetAll('partners_master', partnerParams) : Promise.resolve([]),
    ]);

    // populate receivedBy if file known at open time
    if (recByEl) {
      const raw = (partnersRes||[]).map(p => p.partner);
      const list = raw.includes(TREASURY_PARTNER) ? raw : [TREASURY_PARTNER, ...raw];
      recByEl.innerHTML = list.map(p => `<option value="${p}">${p}</option>`).join('');
      recByEl.value = TREASURY_PARTNER;
    }

    // مجموع المدفوع فعلاً (paid_date موجود) لكل فاتورة
    const collectedMap = {};
    // مجموع كل التحصيلات المسجلة (مدفوعة + منتظرة) لكل فاتورة — هو الإجمالي الحقيقي
    const invoicedMap  = {};
    (collections||[]).filter(c => c.inv_no && isPosted(c)).forEach(c => {
      const key = `${c.file_no}__${c.inv_no}`;
      invoicedMap[key] = (invoicedMap[key]||0) + (+c.amount||0);
      if (c.paid_date) collectedMap[key] = (collectedMap[key]||0) + (+c.amount||0);
    });

    // تجميع بالفاتورة (inv_no + file_no) — لجلب بيانات العميل والـ VINs فقط
    const invMap = {};
    (sales||[]).filter(s => s.inv_no).forEach(s => {
      const k = `${s.file_no}__${s.inv_no}`;
      if (!invMap[k]) invMap[k] = { inv_no:s.inv_no, customer:s.customer, file_no:s.file_no, sale_date:s.sale_date, total:0, vins:[] };
      invMap[k].total += +s.sale_price || 0;
      if (s.vin) invMap[k].vins.push(s.vin);
    });

    const pendingSales = Object.values(invMap).map(inv => {
      const key       = `${inv.file_no}__${inv.inv_no}`;
      // الإجمالي الحقيقي = مجموع التحصيلات المسجلة (يشمل المصاريف الإضافية على الفاتورة)
      // لو ما في تحصيلات مسجلة بعد نرجع على sale_price
      const realTotal  = invoicedMap[key] > 0 ? invoicedMap[key] : inv.total;
      const collected  = collectedMap[key] || 0;
      const remaining  = realTotal - collected;
      return {
        ...inv,
        sale_price: realTotal,
        vin:        inv.vins.join(' / '),
        collected,
        remaining,
      };
    }).filter(inv => inv.remaining > 0.001)
      .sort((a,b) => (a.sale_date||'') > (b.sale_date||'') ? -1 : 1);

    if (!pendingSales.length) {
      el('col-invNo').innerHTML = '<option value="">لا توجد فواتير غير محصّلة</option>';
      return;
    }

    el('col-invNo').innerHTML = '<option value="">— اختر فاتورة —</option>' +
      pendingSales.map(s => `
        <option value="${s.inv_no}"
          data-file="${s.file_no||''}"
          data-customer="${s.customer||''}"
          data-vin="${s.vin||''}"
          data-total="${s.sale_price||0}"
          data-collected="${s.collected}"
          data-remaining="${s.remaining}">
          ${s.inv_no} — ${s.customer||'—'} — ملف: ${s.file_no||'—'} — ${s.vins.length} سيارة (باقي: ${fmt(s.remaining)})
        </option>`).join('');

    el('col-invNo')._salesData = pendingSales;

  } catch(e) {
    el('col-invNo').innerHTML = '<option value="">خطأ في التحميل</option>';
    console.error(e);
  }
}

export function onCollectionInvChange() {
  const sel = el('col-invNo');
  const opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.value) {
    el('col-inv-card').style.display    = 'none';
    el('col-form-fields').style.display = 'none';
    el('col-submit-btn').style.display  = 'none';
    return;
  }

  const total     = parseFloat(opt.dataset.total)     || 0;
  const collected = parseFloat(opt.dataset.collected) || 0;
  const remaining = parseFloat(opt.dataset.remaining) || 0;

  // ملء الـ hidden fields
  el('col-customer').value = opt.dataset.customer || '';
  el('col-vin').value      = opt.dataset.vin      || '';

  // بطاقة الفاتورة
  el('col-card-customer').textContent  = opt.dataset.customer || '—';
  el('col-card-vin').textContent       = opt.dataset.vin      || '—';
  el('col-card-total').textContent     = fmt(total);
  el('col-card-collected').textContent = fmt(collected);
  el('col-card-remaining').textContent = fmt(remaining);

  // لون الباقي
  const remEl = el('col-card-remaining');
  remEl.style.color = remaining > 0 ? 'var(--accent)' : 'var(--green)';

  // اقتراح المبلغ = الباقي كاملاً
  el('col-amount').value = remaining > 0 ? remaining.toFixed(3) : '';

  el('col-inv-card').style.display    = 'block';
  el('col-form-fields').style.display = 'block';
  el('col-submit-btn').style.display  = '';

  // populate receivedBy based on selected invoice's file
  const fileFromOpt = opt.dataset.file || state.currentFileNo;
  if (fileFromOpt) {
    apiGetAll('partners_master', {
      select: 'partner', system_type: `eq.${state.system}`, file_no: `eq.${fileFromOpt}`
    }).then(partners => {
      const rb = el('col-receivedBy');
      if (rb) {
        const raw = (partners||[]).map(p => p.partner);
        const list = raw.includes(TREASURY_PARTNER) ? raw : [TREASURY_PARTNER, ...raw];
        rb.innerHTML = list.map(p => `<option value="${p}">${p}</option>`).join('');
        rb.value = TREASURY_PARTNER;
      }
    }).catch(() => {});
  }
}

export async function submitCollection() {
  const invNo  = el('col-invNo').value;
  const cust   = el('col-customer').value.trim();
  const vin    = el('col-vin').value.trim();
  const amount = parseFloat(el('col-amount').value);
  const method = el('col-method').value;
  const doc    = el('col-doc').value.trim();
  const due        = el('col-dueDate').value;
  const paid       = el('col-paidDate').value;
  const notes      = el('col-notes').value.trim();
  const receivedBy = el('col-receivedBy')?.value?.trim() || null;

  // ✅ لو المستلم شريك حقيقي (مش الصندوق) لازم تاريخ دفع — وإلا يتسجّل صف
  // "مُستلم" بلا أثر محاسبي (JE) بصمت، بدل التوجيه الصح لحساب الشريك 2400
  if (_isPartnerPocket(receivedBy) && !paid) {
    showFieldErr('colError', '⚠️ يجب تحديد تاريخ الدفع عند اختيار شريك كمستلم للتحصيل');
    return;
  }

  // file_no: من الـ state لو داخل ملف، ولا من الـ option المختار
  const sel2   = el('col-invNo');
  const opt2   = sel2?.options[sel2?.selectedIndex];
  const fn     = state.currentFileNo || opt2?.dataset?.file || null;

  if (!invNo || !amount) { showFieldErr('colError','يرجى ملء الحقول المطلوبة'); return; }
  if (!fn) { showFieldErr('colError','يرجى اختيار فاتورة'); return; }

  // تحقق من عدم تجاوز الباقي
  const remAllowed = parseFloat(opt2?.dataset?.remaining || 999999);
  if (amount > remAllowed + 0.001) {
    showFieldErr('colError', `⚠️ المبلغ أكبر من الباقي المستحق (${fmt(remAllowed)})`);
    return;
  }

  try {
    const refNo  = (await genSeqRef('COL', state.system, fn, 'collections')) || `COL-${fn}-${Date.now()}`;
    const pay_id = refNo;
    // FIX: paid_date لا يُحفظ في حالة Draft — سيُضاف عند الموافقة أو عند تسجيل الدفع
    const isPostedNow = entryStatus() === 'posted';
    const data = {
      system_type: state.system, file_no: fn,
      pay_id, inv_no: invNo, customer: cust, vin: vin||null, amount,
      pay_method: method, document: doc||null,
      due_date: due||null, paid_date: (paid && isPostedNow) ? paid : null,
      notes: notes||null, ref_no: refNo, post_status: entryStatus(),
      received_by: receivedBy || null,
    };
    const colIns = await apiPost('collections', data);
    await logAudit('INSERT','collections',fn,null,data);
    if (cust) await ensureContact(cust, 'customer');
    if (isPostedNow && cust && paid) {
      const colId = colIns?.[0]?.id || null;
      try {
        await je_collection({sys:state.system,date:paid,amount,fileNo:fn,refId:colId,customer:cust,invNo:invNo||'',method,receivedBy});
      } catch(jeErr) {
        if (colId) await apiPatch('collections', { id:`eq.${colId}` }, { post_status:'draft' });
        toast(`⚠️ تم حفظ التحصيل بدون ترحيل قيده — راجع قائمة الاعتمادات (${jeErr.message})`,'warn');
      }
    }
    markSaving('collectionModal'); closeModal('collectionModal');
    toast('✅ تم تسجيل التحصيل بنجاح','ok');
    invalidateCache();
    if (state.currentTab === 5) loadCollectionsTab(fn, state.system);
    if (state.currentTab === 0) loadSummaryTab(fn, state.system);
  } catch(e) { showFieldErr('colError','خطأ: '+e.message); }
}

// Payout
export async function openPayoutModal() {
  const fn  = state.currentFileNo;
  const sys = state.system;

  // لو مفيش ملف — أضف selector
  if (el('pout-file-selector-wrap')) {
    if (!fn) {
      await ensureCache();
      const dealOptions = (state.allDeals||[])
        .map(d => `<option value="${d.file_no}">${d.file_no} — ${d.supplier||'—'}</option>`)
        .join('');
      el('pout-file-selector-wrap').innerHTML = `
        <div class="field" style="margin-bottom:12px">
          <label>رقم الملف / الصفقة *</label>
          <select id="pout-file-selector" onchange="onPoutFileSelectorChange()" style="width:100%">
            <option value="">— اختر الملف —</option>${dealOptions}
          </select>
        </div>`;
    } else {
      el('pout-file-selector-wrap').innerHTML = '';
    }
  }

  let partners = fn
    ? await apiGetAll('partners_master', { select:'partner', system_type:`eq.${sys}`, file_no:`eq.${fn}` })
    : [];
  if (!partners?.length) {
    const allPartners = await getContactsByType('partner');
    partners = (allPartners||[]).map(p => ({ partner: p.name }));
  }

  el('poutModalTitle').textContent = fn ? `صرف للشريك — ملف ${fn}` : 'صرف للشريك';
  el('pout-partner').innerHTML = '<option value="">-- اختر الشريك --</option>' +
    (partners||[]).map(p=>`<option value="${p.partner}">${p.partner}</option>`).join('');
  el('pout-amount').value  = '';
  el('pout-capital').value = '';
  el('pout-profit').value  = '';
  el('pout-date').value    = today();
  el('pout-doc').value     = '';
  el('pout-notes').value   = '';
  el('poutError').style.display        = 'none';
  el('pout-balance-card').style.display = 'none';
  el('pout-type').value = 'استرداد رأس مال';
  onPayoutTypeChange();
  openModal('payoutModal');
}

export async function onPoutFileSelectorChange() {
  const fn  = el('pout-file-selector')?.value;
  const sys = state.system;
  if (!fn) return;
  el('poutModalTitle').textContent = `صرف للشريك — ملف ${fn}`;
  const partners = await apiGetAll('partners_master', { select:'partner', system_type:`eq.${sys}`, file_no:`eq.${fn}` });
  if (partners?.length) {
    el('pout-partner').innerHTML = '<option value="">-- اختر الشريك --</option>' +
      partners.map(p=>`<option value="${p.partner}">${p.partner}</option>`).join('');
  }
}

export async function onPayoutPartnerChange() {
  const partner = el('pout-partner').value;
  const fn      = state.currentFileNo;
  if (!partner || !fn) return;
  const card = el('pout-balance-card');
  card.style.display = '';
  card.innerHTML = `<div style="text-align:center;padding:8px;color:var(--text2);font-size:12px">⏳ جاري التحميل...</div>`;
  try {
    const s = await getPartnerDealBalance(fn, partner, state.system);
    const shareP = (s.share * 100).toFixed(0);
    const fmt2 = n => (+n||0).toLocaleString('en-US',{minimumFractionDigits:2});
    card.innerHTML = `
      <div style="font-weight:800;font-size:13px;color:var(--purple);margin-bottom:10px;display:flex;align-items:center;gap:6px">
        👤 ${partner}
        <span style="background:var(--purple);color:#fff;border-radius:20px;padding:2px 10px;font-size:13px">${shareP}% حصة</span>
      </div>
      <div style="font-size:12px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:6px">تفاصيل الصفقة الكاملة</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px">
        <div style="background:var(--card2);border-radius:6px;padding:8px 10px;border-right:3px solid var(--blue)">
          <div style="font-size:13px;color:var(--text2);font-weight:700">رأس المال (شراء)</div>
          <div style="font-family:var(--mono);font-size:13px;font-weight:800;color:var(--blue)">${fmt2(s._totalCost)}</div>
        </div>
        <div style="background:var(--card2);border-radius:6px;padding:8px 10px;border-right:3px solid var(--red)">
          <div style="font-size:13px;color:var(--text2);font-weight:700">المصاريف</div>
          <div style="font-family:var(--mono);font-size:13px;font-weight:800;color:var(--red)">${fmt2(s._totalExp)}</div>
        </div>
        <div style="background:var(--card2);border-radius:6px;padding:8px 10px;border-right:3px solid var(--green)">
          <div style="font-size:13px;color:var(--text2);font-weight:700">المبيعات</div>
          <div style="font-family:var(--mono);font-size:13px;font-weight:800;color:var(--green)">${fmt2(s._totalSales)}</div>
        </div>
      </div>
      <div style="font-size:12px;font-weight:700;color:var(--text2);letter-spacing:.5px;margin-bottom:6px">حصة الشريك (${shareP}%)</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:10px">
        <div style="background:var(--card2);border-radius:6px;padding:8px 10px">
          <div style="font-size:13px;color:var(--text2);font-weight:700">رأس المال المدفوع</div>
          <div style="font-family:var(--mono);font-size:13px;font-weight:800;color:var(--blue)">${fmt2(s.capitalPaid)}</div>
        </div>
        <div style="background:var(--card2);border-radius:6px;padding:8px 10px">
          <div style="font-size:13px;color:var(--text2);font-weight:700">الربح المستحق</div>
          <div style="font-family:var(--mono);font-size:13px;font-weight:800;color:${s.profit>=0?'var(--green)':'var(--red)'}">${fmt2(Math.abs(s.profit))}</div>
        </div>
        <div style="background:var(--card2);border-radius:6px;padding:8px 10px">
          <div style="font-size:13px;color:var(--text2);font-weight:700">إجمالي المسحوبات</div>
          <div style="font-family:var(--mono);font-size:13px;font-weight:800;color:var(--amber)">${fmt2(s.totalWithdrawn)}</div>
        </div>
        <div style="background:var(--card2);border-radius:6px;padding:8px 10px">
          <div style="font-size:13px;color:var(--text2);font-weight:700">صافي الربح (حصتي)</div>
          <div style="font-family:var(--mono);font-size:13px;font-weight:800;color:${s.dealProfit>=0?'var(--green)':'var(--red)'}">${fmt2(s.dealProfit * s.share)}</div>
        </div>
      </div>
      <div style="background:${s.netDue>=0?'var(--green-dim)':'var(--red-dim)'};border:1px solid ${s.netDue>=0?'var(--green)':'var(--red)'};border-radius:8px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:12px;font-weight:700">المتبقي المستحق للشريك</span>
        <span style="font-family:var(--mono);font-size:16px;font-weight:900;color:${s.netDue>=0?'var(--green)':'var(--red)'}">
          ${fmt2(Math.abs(s.netDue))} ${s.netDue>=0?'✅':'⚠️'}
        </span>
      </div>`;
    // ملء المبالغ تلقائياً
    const type = el('pout-type').value;
    if (type === 'رأس مال + أرباح') {
      if (!el('pout-capital').value) el('pout-capital').value = Math.max(0, s.capitalPaid - s.capitalRet).toFixed(3);
      if (!el('pout-profit').value && s.profit > 0) el('pout-profit').value = Math.max(0, s.profit - s.profitTaken).toFixed(3);
      calcPayoutTotal();
    } else if (type === 'استرداد رأس مال' && !el('pout-amount').value) {
      el('pout-amount').value = Math.max(0, s.capitalPaid - s.capitalRet).toFixed(3);
    } else if (type === 'توزيع أرباح' && !el('pout-amount').value && s.profit > 0) {
      el('pout-amount').value = Math.max(0, s.profit - s.profitTaken).toFixed(3);
    }
  } catch(e) {
    card.innerHTML = `<div style="color:var(--red);padding:8px">خطأ: ${e.message}</div>`;
  }
}

export function onPayoutTypeChange() {
  const type = el('pout-type').value;
  const isSplit = type === 'رأس مال + أرباح';
  el('pout-split-wrap').style.display  = isSplit ? '' : 'none';
  el('pout-simple-wrap').style.display = isSplit ? 'none' : '';
  el('pout-amount-label').textContent  = type === 'توزيع أرباح' ? 'مبلغ الأرباح *' :
                                          type === 'سلفة' ? 'مبلغ السلفة *' : 'مبلغ رأس المال *';
}

export function onPayoutAmountChange() { /* live validation if needed */ }

export function calcPayoutTotal() {
  const cap = parseFloat(el('pout-capital').value) || 0;
  const prf = parseFloat(el('pout-profit').value)  || 0;
  const tot = cap + prf;
  el('pout-split-total').innerHTML = `الإجمالي: <strong style="color:var(--accent)">${fmt(tot)}</strong>`;
  el('pout-amount').value = tot;
}

// Get partner balance for a deal
// ✅ موحّد مع computeFinancials (core.js) — نفس مصدر لوحة التحكم وتقرير
// الأرباح وكشف حساب الشريك (showPartnerStatement) بالضبط: صافي بعد قيود
// العكس، وبلا ازدواج مصاريف الصفقات داخل COGS (كانت تُحسب من الجداول
// المصدرية مباشرة قبل توحيد المصدر — رقم مختلف عن كشف الحساب لنفس الصفقة)
export async function getPartnerDealBalance(fileNo, partner, sys) {
  const [pmRow, payments, payouts, jeAll] = await Promise.all([
    apiGetAll('partners_master', { select:'share_percent', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, partner:`eq.${partner}` }),
    apiGetAll('payments',        { select:'amount,post_status', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, payer:`eq.${partner}` }),
    apiGetAll('partner_payouts', { select:'amount,payout_type,capital_amount,profit_amount,advance_amount', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, partner:`eq.${partner}` }),
    apiGetAll('journal_entries', { select:'account_code,dr_amount,cr_amount,ref_table,file_no', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, post_status:'eq.posted' }),
  ]);
  const share       = (pmRow?.[0]?.share_percent || 0) / 100;
  const capitalPaid = (payments||[]).filter(isPosted).reduce((s,p)=>s+(+p.amount||0),0);
  const finFile     = computeFinancials(jeAll).byFile[fileNo] || { sales:0, cogs:0, dealExp:0, purchase:0 };
  const dealProfit  = finFile.sales - finFile.cogs - finFile.dealExp;
  const profit      = dealProfit * share;
  const capitalRet  = (payouts||[]).reduce((s,p)=>s+(+p.capital_amount||0),0);
  const profitTaken = (payouts||[]).reduce((s,p)=>s+(+p.profit_amount||0),0);
  const advances    = (payouts||[]).reduce((s,p)=>s+(+p.advance_amount||0),0);
  const totalWithdrawn = capitalRet + profitTaken + advances;
  const netDue = capitalPaid + profit - totalWithdrawn;
  return { share, capitalPaid, profit, capitalRet, profitTaken, advances, totalWithdrawn, netDue, dealProfit,
           _totalCost: finFile.purchase, _totalExp: finFile.dealExp, _totalSales: finFile.sales };
}

export async function submitPayout() {
  const fn      = state.currentFileNo || el('pout-file-selector')?.value || null;
  const partner = el('pout-partner').value;
  const type    = el('pout-type').value;
  const date    = el('pout-date').value;
  const method  = el('pout-method').value;
  const doc     = el('pout-doc').value.trim();
  const notes   = el('pout-notes').value.trim();

  if (!fn)      { showFieldErr('poutError','يرجى اختيار الملف/الصفقة'); return; }
  if (!partner) { showFieldErr('poutError','يرجى اختيار الشريك'); return; }
  if (!date)    { showFieldErr('poutError','يرجى إدخال التاريخ'); return; }

  let amount = 0, capitalAmt = 0, profitAmt = 0, advanceAmt = 0;

  if (type === 'رأس مال + أرباح') {
    capitalAmt = parseFloat(el('pout-capital').value) || 0;
    profitAmt  = parseFloat(el('pout-profit').value)  || 0;
    amount     = capitalAmt + profitAmt;
  } else if (type === 'استرداد رأس مال') {
    amount = capitalAmt = parseFloat(el('pout-amount').value) || 0;
  } else if (type === 'توزيع أرباح') {
    amount = profitAmt = parseFloat(el('pout-amount').value) || 0;
  } else if (type === 'سلفة') {
    amount = advanceAmt = parseFloat(el('pout-amount').value) || 0;
  }

  if (!amount && type !== 'رأس مال + أرباح') { showFieldErr('poutError','يرجى إدخال المبلغ'); return; }
  if (type === 'رأس مال + أرباح' && amount === 0) { showFieldErr('poutError','يرجى إدخال المبالغ'); return; }

  try {
    // Generate pay_id
    let pay_id = `PAY-${fn}-001`;
    try {
      const existing = await apiGetAll('partner_payouts', { select:'pay_id', system_type:`eq.${state.system}`, file_no:`eq.${fn}`, order:'created_at.desc', limit:100 });
      const lastNums = (existing||[]).map(p=>{ const m=(p.pay_id||'').match(/(\d+)$/); return m?parseInt(m[1]):0; });
      const nextNum  = (lastNums.length ? Math.max(...lastNums) : 0) + 1;
      pay_id = `PAY-${fn}-${String(nextNum).padStart(3,'0')}`;
    } catch(e) { console.warn('payoutId generator:', e.message); }
    const data = {
      system_type: state.system, file_no: fn, partner,
      pay_id, payout_type: type, amount,
      capital_amount: capitalAmt, profit_amount: profitAmt, advance_amount: advanceAmt,
      pay_method: method, document: doc||null, pay_date: date, notes: notes||null,
      post_status: entryStatus()
    };
    const poutDataIns = await apiPost('partner_payouts', data);
    await logAudit('INSERT','partner_payouts',fn,null,data);
    if (entryStatus()==='posted') {
      const poutId = poutDataIns?.[0]?.id || null;
      try {
        await je_payout({sys:state.system,date,amount,fileNo:fn,refId:poutId,partner,method});
      } catch(jeErr) {
        if (poutId) await apiPatch('partner_payouts', { id:`eq.${poutId}` }, { post_status:'draft' });
        toast(`⚠️ تم حفظ ${type} بدون ترحيل قيده — راجع قائمة الاعتمادات (${jeErr.message})`,'warn');
      }
    }
    markSaving('payoutModal'); closeModal('payoutModal');
    toast(`✅ تم تسجيل ${type} للشريك ${partner}`,'ok');
    invalidateCache();
    if (state.currentTab === 6) loadPayoutsTab(fn, state.system);
    if (state.currentTab === 0) loadSummaryTab(fn, state.system);
  } catch(e) { showFieldErr('poutError','خطأ: '+e.message); }
}

// ── window bridge: تعريض الدوال للاستخدام من classic scripts وسمات onclick ──
Object.assign(window, {
  getNfEditFileNo, openNewFileModal, populatePartnersSelect, onVehicleCountChange,
  onTotalAmountChange, setPriceMode, buildVehicleRows, applyEqualPrices, checkPriceTotal,
  updateEqualPriceInfo, addVehicleRow, copyVehicleRow, renumberVehicles, addPartnerRow,
  updatePartnerSummary, checkShareTotal, _assignPartVins, submitNewFile, _submitNewFileInner,
  voidOrDeleteOldPayment, submitEditFileFull, openPaymentModal, onPayFileSelectorChange,
  _loadPaymentModalData, openExpenseModal, addExpenseRow, updateExpenseTotal,
  toggleExpenseModalSize, submitExpense, submitPayment, _proceedSubmitPayment, openSaleModal,
  onSaleFileChange, loadAvailableVehicles, renderSaleVehiclePicker, filterSaleVehiclesByVin,
  clearSaleVinSearch, onSaleVehicleCheck, saleToggleAll, addSaleVehicleRow,
  onSaleRowVehicleChange, onSaleVehicleChange, updateSaleTotal, addExtraChargeRow,
  removeExtraChargeRow, toggleSalePayment, submitSale, openCollectionModal,
  onCollectionInvChange, submitCollection, openPayoutModal, onPoutFileSelectorChange,
  onPayoutPartnerChange, onPayoutTypeChange, onPayoutAmountChange, calcPayoutTotal,
  getPartnerDealBalance, submitPayout,
});

// Add vehicle to existing deal
