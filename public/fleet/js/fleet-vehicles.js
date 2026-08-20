// ╔══════════════════════════════════════════════════════════╗
// ║  fleet-vehicles.js — قائمة السيارات + إدارة (CRUD)        ║
// ╚══════════════════════════════════════════════════════════╝

import { apiGet, apiPost, apiPatch, fmtKWD } from './fleet-core.js';
import { toast, confirmAsync, openFormModal, guardedCall } from './fleet-ui.js';
import { navigate } from './fleet-router.js';
import { issueInvoiceFlow, settleInvoiceFlow, voidInvoiceFlow, voidReceiptFlow } from './fleet-invoices.js';
import { issueBillFlow, settleBillFlow, voidBillFlow, voidPaymentFlow } from './fleet-bills.js';

const STATUS_LABEL = {
  active: { label: 'نشطة', cls: 'ok' },
  maintenance: { label: 'صيانة', cls: 'warn' },
  sold: { label: 'مباعة', cls: 'err' },
  archived: { label: 'مؤرشفة', cls: 'err' },
};

function _statusBadge(status) {
  const s = STATUS_LABEL[status] || { label: status, cls: 'warn' };
  return `<span class="fleet-badge ${s.cls}">${s.label}</span>`;
}

// ── جدول "ملفات" — نفس نمط renderDealsTable (public/js/dashboard.js) بالحرف:
// إيراد/مصروف/صافي كـpill ملوّن + سهم + نسبة هامش، صف إجمالي أسفل الجدول
// (Phase 7 Stage 2). إيراد/مصروف تراكميان منذ البداية — بدون فلتر تاريخ هنا
// عمدًا (فلتر النطاق الزمني حصري جوه ملف السيارة، Stage 3).
function _renderVehiclesTable(list, driverByVehicle, revByVehicle, expByVehicle, main) {
  const wrap = main.querySelector('#vehiclesTableWrap');
  if (!list.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="e-icon">🚚</div><p>لا توجد سيارات</p></div>`;
    return;
  }

  const rows = list.map(v => {
    const rev = revByVehicle[v.id] || 0;
    const exp = expByVehicle[v.id] || 0;
    const net = rev - exp;
    const netColor = net > 0 ? 'var(--green)' : net < 0 ? 'var(--red)' : 'var(--text2)';
    const netBg    = net > 0 ? 'var(--green-dim)' : net < 0 ? 'var(--red-dim)' : 'transparent';
    const netArrow = net >= 0 ? '▲' : '▼';
    const driver = driverByVehicle[v.id];

    return `<tr style="cursor:pointer" data-id="${v.id}">
      <td>
        <div class="mono" style="font-weight:700">${v.plate_no || '—'}</div>
        <div style="font-size:12px;color:var(--text2)">${[v.make, v.model].filter(Boolean).join(' ') || '—'}</div>
      </td>
      <td>
        ${driver ? `<div style="font-weight:600">${driver.full_name}</div><div style="font-size:12px;color:var(--text2)">${driver.civil_id || ''}</div>` : `<span style="color:var(--text3)">لا يوجد سائق</span>`}
      </td>
      <td><div class="mono text-blue" style="font-weight:700">${fmtKWD(rev)}</div></td>
      <td><div class="mono text-red" style="font-weight:700">${fmtKWD(exp)}</div></td>
      <td>
        <div style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:8px;background:${netBg}">
          <span style="font-size:12px">${netArrow}</span>
          <span class="mono" style="font-weight:900;color:${netColor};font-size:13px">${fmtKWD(Math.abs(net))}</span>
        </div>
        ${net !== 0 && rev > 0 ? `<div style="font-size:12px;color:var(--text2);margin-top:2px">هامش ${((net / rev) * 100).toFixed(1)}%</div>` : ''}
      </td>
      <td>${_statusBadge(v.status)}</td>
    </tr>`;
  }).join('');

  const tRev = list.reduce((s, v) => s + (revByVehicle[v.id] || 0), 0);
  const tExp = list.reduce((s, v) => s + (expByVehicle[v.id] || 0), 0);
  const tNet = tRev - tExp;
  const totalRow = `<tr style="background:var(--card2);font-weight:700;border-top:2px solid var(--border)">
    <td colspan="2" style="padding:10px 14px;font-size:12px">الإجمالي — ${list.length} سيارة</td>
    <td class="mono text-blue" style="font-weight:900">${fmtKWD(tRev)}</td>
    <td class="mono text-red" style="font-weight:900">${fmtKWD(tExp)}</td>
    <td>
      <div style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:8px;background:${tNet >= 0 ? 'var(--green-dim)' : 'var(--red-dim)'}">
        <span>${tNet >= 0 ? '▲' : '▼'}</span>
        <span class="mono" style="font-weight:900;color:${tNet >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtKWD(Math.abs(tNet))}</span>
      </div>
    </td>
    <td></td>
  </tr>`;

  wrap.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>رقم اللوحة</th>
        <th>السائق الحالي</th>
        <th style="color:var(--blue)">الإيراد</th>
        <th style="color:var(--red)">المصروف</th>
        <th>الصافي</th>
        <th>الحالة</th>
      </tr></thead>
      <tbody>${rows}${totalRow}</tbody>
    </table>`;

  wrap.querySelectorAll('tbody tr[data-id]').forEach(tr => {
    tr.onclick = () => navigate('vehicle', { id: tr.dataset.id });
  });
}

export async function renderVehiclesList(params, main) {
  const [vehicles, openAssignments, invoices, bills] = await Promise.all([
    apiGet('fleet_vehicles', { select: '*', order: 'created_at.desc' }),
    apiGet('fleet_assignments', { select: 'vehicle_id,fleet_drivers(full_name,civil_id)', end_date: 'is.null' }),
    apiGet('v_invoice_balances', { select: 'vehicle_id,amount' }),
    apiGet('v_bill_balances', { select: 'vehicle_id,amount' }),
  ]);

  const driverByVehicle = Object.fromEntries(openAssignments.map(a => [a.vehicle_id, a.fleet_drivers]));
  const revByVehicle = {};
  invoices.forEach(i => { revByVehicle[i.vehicle_id] = (revByVehicle[i.vehicle_id] || 0) + Number(i.amount); });
  const expByVehicle = {};
  bills.forEach(b => { if (b.vehicle_id) expByVehicle[b.vehicle_id] = (expByVehicle[b.vehicle_id] || 0) + Number(b.amount); });

  main.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap">
      <input id="vehicleSearch" placeholder="بحث برقم اللوحة أو الشاصي" class="fleet-btn" style="flex:1;min-width:180px;text-align:right;cursor:text">
      <button id="addVehicleBtn" class="fleet-btn primary" type="button">+ سيارة جديدة</button>
    </div>
    <div class="data-table-wrap" id="vehiclesTableWrap"></div>`;

  _renderVehiclesTable(vehicles, driverByVehicle, revByVehicle, expByVehicle, main);

  main.querySelector('#vehicleSearch').oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = vehicles.filter(v =>
      (v.plate_no || '').toLowerCase().includes(q) || (v.chassis_no || '').toLowerCase().includes(q));
    _renderVehiclesTable(filtered, driverByVehicle, revByVehicle, expByVehicle, main);
  };

  main.querySelector('#addVehicleBtn').onclick = async () => {
    const fd = await openFormModal('سيارة جديدة', `
      <label>رقم اللوحة *<input name="plate_no" required class="fleet-input"></label>
      <label>رقم الشاصي<input name="chassis_no" class="fleet-input"></label>
      <label>الماركة<input name="make" class="fleet-input"></label>
      <label>الموديل<input name="model" class="fleet-input"></label>
      <label>السنة<input name="year" type="number" class="fleet-input"></label>
      <label>مواصفات<textarea name="specs" class="fleet-input"></textarea></label>
    `);
    if (!fd) return;
    const { ok } = await guardedCall(() => apiPost('fleet_vehicles', {
      plate_no: fd.get('plate_no'), chassis_no: fd.get('chassis_no') || null,
      make: fd.get('make') || null, model: fd.get('model') || null,
      year: fd.get('year') ? Number(fd.get('year')) : null,
      specs: fd.get('specs') || null, status: 'active',
    }), 'إضافة سيارة');
    if (ok) { toast('تمت إضافة السيارة', 'ok'); renderVehiclesList(params, main); }
  };
}

export async function renderVehicleDetail(params, main) {
  const id = params.id;
  const [vehicle] = await apiGet('fleet_vehicles', { select: '*', id: `eq.${id}` });
  if (!vehicle) { main.innerHTML = '<div class="fleet-card">السيارة غير موجودة</div>'; return; }

  const assignments = await apiGet('fleet_assignments', {
    select: '*,fleet_drivers(full_name,civil_id,residency_expiry)', vehicle_id: `eq.${id}`, order: 'start_date.desc',
  });
  const current = assignments.find(a => !a.end_date);

  main.innerHTML = `
    <button class="fleet-btn" id="backBtn" type="button" style="margin-bottom:12px">→ رجوع لقائمة السيارات</button>
    <div class="fleet-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
        <div>
          <div style="font-weight:700;font-size:18px">${vehicle.plate_no}</div>
          <div style="color:var(--text2);font-size:13px">${[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' — ') || '—'}</div>
          <div style="color:var(--text3);font-size:12px">شاصي: ${vehicle.chassis_no || '—'}</div>
        </div>
        <div style="display:flex;gap:8px">
          ${_statusBadge(vehicle.status)}
          <button id="editVehicleBtn" class="fleet-btn" type="button">تعديل</button>
          ${vehicle.status !== 'archived' ? '<button id="archiveVehicleBtn" class="fleet-btn danger" type="button">أرشفة</button>' : ''}
        </div>
      </div>
    </div>

    <div class="fleet-card">
      <div style="font-weight:700;margin-bottom:10px">السائق الحالي</div>
      ${current ? `
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-weight:700">${current.fleet_drivers?.full_name || '—'}</div>
            <div style="color:var(--text3);font-size:12px">رقم مدني: ${current.fleet_drivers?.civil_id || '—'} — إيجار شهري: ${current.monthly_rent ?? '—'}</div>
          </div>
          <button id="endAssignmentBtn" class="fleet-btn danger" type="button">إنهاء التعيين</button>
        </div>` : `
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="color:var(--text3)">لا يوجد سائق حاليًا</span>
          <button id="newAssignmentBtn" class="fleet-btn primary" type="button">تعيين سائق</button>
        </div>`}
    </div>

    <div class="fleet-card">
      <div style="font-weight:700;margin-bottom:10px">سجل السائقين</div>
      <table class="fleet-table">
        <thead><tr><th>السائق</th><th>من</th><th>إلى</th><th>الإيجار الشهري</th></tr></thead>
        <tbody>
          ${assignments.length ? assignments.map(a => `
            <tr>
              <td data-label="السائق">${a.fleet_drivers?.full_name || '—'}</td>
              <td data-label="من">${a.start_date}</td>
              <td data-label="إلى">${a.end_date || '<span class="fleet-badge ok">حاليًا</span>'}</td>
              <td data-label="الإيجار الشهري">${a.monthly_rent ?? '—'}</td>
            </tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text3)">لا يوجد سجل بعد</td></tr>'}
        </tbody>
      </table>
    </div>

    <div id="vehicleFinancials"><div class="fleet-loading">جاري التحميل...</div></div>`;

  main.querySelector('#backBtn').onclick = () => navigate('vehicles');
  _renderVehicleFinancials(vehicle, current, id, main, params);

  main.querySelector('#editVehicleBtn').onclick = async () => {
    const fd = await openFormModal('تعديل السيارة', `
      <label>رقم اللوحة *<input name="plate_no" required class="fleet-input" value="${vehicle.plate_no || ''}"></label>
      <label>رقم الشاصي<input name="chassis_no" class="fleet-input" value="${vehicle.chassis_no || ''}"></label>
      <label>الماركة<input name="make" class="fleet-input" value="${vehicle.make || ''}"></label>
      <label>الموديل<input name="model" class="fleet-input" value="${vehicle.model || ''}"></label>
      <label>السنة<input name="year" type="number" class="fleet-input" value="${vehicle.year || ''}"></label>
      <label>الحالة
        <select name="status" class="fleet-input">
          ${Object.entries(STATUS_LABEL).map(([v, s]) => `<option value="${v}" ${vehicle.status === v ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
      </label>
      <label>مواصفات<textarea name="specs" class="fleet-input">${vehicle.specs || ''}</textarea></label>
    `);
    if (!fd) return;
    const { ok } = await guardedCall(() => apiPatch('fleet_vehicles', { id: `eq.${id}` }, {
      plate_no: fd.get('plate_no'), chassis_no: fd.get('chassis_no') || null,
      make: fd.get('make') || null, model: fd.get('model') || null,
      year: fd.get('year') ? Number(fd.get('year')) : null,
      status: fd.get('status'), specs: fd.get('specs') || null,
    }), 'تعديل سيارة');
    if (ok) { toast('تم التعديل', 'ok'); renderVehicleDetail(params, main); }
  };

  main.querySelector('#archiveVehicleBtn')?.addEventListener('click', async () => {
    const sure = await confirmAsync('أرشفة السيارة', 'هيتم تعطيل السيارة من القوائم النشطة. السجل المالي والتاريخي هيفضل محفوظ كامل.', true, 'أرشفة');
    if (!sure) return;
    const { ok } = await guardedCall(() => apiPatch('fleet_vehicles', { id: `eq.${id}` }, { status: 'archived' }), 'أرشفة سيارة');
    if (ok) { toast('تمت الأرشفة', 'ok'); renderVehicleDetail(params, main); }
  });

  main.querySelector('#endAssignmentBtn')?.addEventListener('click', async () => {
    const sure = await confirmAsync('إنهاء التعيين', `هيتم إنهاء تعيين ${current.fleet_drivers?.full_name || 'السائق'} على السيارة دي اليوم.`, true, 'إنهاء');
    if (!sure) return;
    const { ok } = await guardedCall(() => apiPatch('fleet_assignments', { id: `eq.${current.id}` }, {
      end_date: new Date().toISOString().slice(0, 10),
    }), 'إنهاء تعيين');
    if (ok) { toast('تم إنهاء التعيين', 'ok'); renderVehicleDetail(params, main); }
  });

  main.querySelector('#newAssignmentBtn')?.addEventListener('click', async () => {
    const drivers = await apiGet('fleet_drivers', { select: 'id,full_name,civil_id', status: 'eq.active', order: 'full_name.asc' });
    if (!drivers.length) { toast('لا يوجد سائقين نشطين — أضف سائق أولًا', 'warn'); return; }
    const fd = await openFormModal('تعيين سائق', `
      <label>السائق *
        <select name="driver_id" required class="fleet-input">
          ${drivers.map(d => `<option value="${d.id}">${d.full_name} — ${d.civil_id || ''}</option>`).join('')}
        </select>
      </label>
      <label>الإيجار الشهري<input name="monthly_rent" type="number" step="0.001" class="fleet-input"></label>
      <label>تاريخ البدء *<input name="start_date" type="date" required class="fleet-input" value="${new Date().toISOString().slice(0, 10)}"></label>
    `);
    if (!fd) return;
    const { ok } = await guardedCall(() => apiPost('fleet_assignments', {
      vehicle_id: Number(id), driver_id: Number(fd.get('driver_id')),
      monthly_rent: fd.get('monthly_rent') ? Number(fd.get('monthly_rent')) : null,
      start_date: fd.get('start_date'),
    }), 'تعيين سائق');
    if (ok) { toast('تم تعيين السائق', 'ok'); renderVehicleDetail(params, main); }
  });
}

// ── الإيراد والمصروف الشهري (هدف المرحلة 5) ──
// يستخدم v_invoice_balances/v_bill_balances (الرصيد محسوب دائمًا في القاعدة،
// صفر حساب رصيد هنا) — كل فعل (إصدار/تحصيل/سداد/إلغاء) بينادي دوال fleet-invoices.js
// / fleet-bills.js اللي بدورها بتنادي دوال RPC المركزية فقط.
async function _renderVehicleFinancials(vehicle, currentAssignment, vehicleId, main, params) {
  const container = document.getElementById('vehicleFinancials');
  if (!container) return;

  const [invoices, bills] = await Promise.all([
    apiGet('v_invoice_balances', { select: '*', vehicle_id: `eq.${vehicleId}`, order: 'for_month.desc' }),
    apiGet('v_bill_balances', { select: '*', vehicle_id: `eq.${vehicleId}`, order: 'for_month.desc' }),
  ]);

  const months = [...new Set([...invoices.map(i => i.for_month), ...bills.map(b => b.for_month)])].sort().reverse();
  const currentMonthStr = new Date().toISOString().slice(0, 7) + '-01';
  const hasCurrentInvoice = invoices.some(i => i.for_month === currentMonthStr);
  const context = {
    vehiclePlate: vehicle.plate_no,
    driverName: currentAssignment?.fleet_drivers?.full_name,
    driverCivilId: currentAssignment?.fleet_drivers?.civil_id,
  };
  const refresh = () => _renderVehicleFinancials(vehicle, currentAssignment, vehicleId, main, params);

  container.innerHTML = `
    ${(!hasCurrentInvoice && currentAssignment) ? `
      <div class="fleet-card" style="border:1px solid var(--accent);background:var(--accent-dim)">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <span>⚠️ الشهر الحالي لسه ما اتصدرلوش فاتورة إيجار</span>
          <button id="quickIssueBtn" class="fleet-btn primary" type="button">إصدار الآن</button>
        </div>
      </div>` : ''}
    <div class="fleet-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <div style="font-weight:700">الإيراد والمصروف الشهري</div>
        <div style="display:flex;gap:8px">
          <button id="newInvoiceBtn" class="fleet-btn primary" type="button">+ فاتورة إيجار</button>
          <button id="newBillBtn" class="fleet-btn" type="button">+ مصروف على السيارة</button>
        </div>
      </div>
      ${months.length ? `
      <table class="fleet-table">
        <thead><tr><th>الشهر</th><th>الإيراد</th><th>المصروف</th><th>الصافي</th></tr></thead>
        <tbody id="monthsBody"></tbody>
      </table>` : '<div style="text-align:center;color:var(--text3);padding:16px">لا يوجد فواتير أو مصروفات بعد</div>'}
    </div>`;

  const tbody = container.querySelector('#monthsBody');
  months.forEach(m => {
    const monthInvoices = invoices.filter(i => i.for_month === m);
    const monthBills = bills.filter(b => b.for_month === m);
    const rev = monthInvoices.reduce((s, i) => s + Number(i.amount), 0);
    const exp = monthBills.reduce((s, b) => s + Number(b.amount), 0);

    const row = document.createElement('tr');
    row.style.cursor = 'pointer';
    row.innerHTML = `
      <td data-label="الشهر">${m.slice(0, 7)}</td>
      <td data-label="الإيراد" style="color:var(--green)">${fmtKWD(rev)}</td>
      <td data-label="المصروف" style="color:var(--red)">${fmtKWD(exp)}</td>
      <td data-label="الصافي">${fmtKWD(rev - exp)}</td>`;

    const detailRow = document.createElement('tr');
    const detailCell = document.createElement('td');
    detailCell.colSpan = 4;
    detailCell.style.padding = '0';
    detailRow.style.display = 'none';
    detailRow.appendChild(detailCell);

    row.onclick = () => {
      const opening = detailRow.style.display === 'none';
      detailRow.style.display = opening ? 'table-row' : 'none';
      if (opening && !detailCell.dataset.built) {
        detailCell.dataset.built = '1';
        _buildMonthDetail(monthInvoices, monthBills, context, refresh).then(el => detailCell.appendChild(el));
      }
    };

    tbody.appendChild(row);
    tbody.appendChild(detailRow);
  });

  container.querySelector('#quickIssueBtn')?.addEventListener('click', async () => {
    if (!currentAssignment) return;
    const ok = await issueInvoiceFlow(vehicleId, currentAssignment.driver_id, currentAssignment.monthly_rent);
    if (ok) refresh();
  });
  container.querySelector('#newInvoiceBtn')?.addEventListener('click', async () => {
    if (!currentAssignment) { toast('لازم تعيين سائق نشط على السيارة أولًا', 'warn'); return; }
    const ok = await issueInvoiceFlow(vehicleId, currentAssignment.driver_id, currentAssignment.monthly_rent);
    if (ok) refresh();
  });
  container.querySelector('#newBillBtn')?.addEventListener('click', async () => {
    const ok = await issueBillFlow(vehicleId);
    if (ok) refresh();
  });
}

function _balanceBadge(paid, amount) {
  paid = Number(paid); amount = Number(amount);
  if (paid >= amount) return '<span class="fleet-badge ok">مسددة بالكامل</span>';
  if (paid > 0) return `<span class="fleet-badge warn">جزئي (${fmtKWD(amount - paid)} متبقي)</span>`;
  return '<span class="fleet-badge err">غير مسددة</span>';
}

// السندات (قبض/صرف) نفسها ليها زرار إلغاء مستقل هنا — كانت غائبة في نسخة
// أولى من هذه الشاشة رغم إنها جزء من التصميم المعتمد أصلاً (§5 بند 5 من
// البرومبت: "زرار إلغاء صغير على كل سطر: فاتورة/التزام/سند") — الفجوة دي
// انكشفت بالاختبار اليدوي الحي (مش الريجريشن) لما محتجنا نلغي سند حقيقي
// ومكانش قدّامنا زرار يعمل كده أصلًا.
async function _buildMonthDetail(monthInvoices, monthBills, context, refresh) {
  const receiptsByInvoice = {};
  for (const i of monthInvoices) {
    if (Number(i.paid_amount) > 0) {
      receiptsByInvoice[i.id] = await apiGet('fleet_receipts', { select: '*', invoice_id: `eq.${i.id}`, post_status: 'eq.posted', order: 'receipt_date.asc' });
    }
  }
  const paymentsByBill = {};
  for (const b of monthBills) {
    if (Number(b.paid_amount) > 0) {
      paymentsByBill[b.id] = await apiGet('fleet_payments', { select: '*', bill_id: `eq.${b.id}`, post_status: 'eq.posted', order: 'payment_date.asc' });
    }
  }

  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding:10px 16px;background:var(--card2)';
  wrap.innerHTML = `
    ${monthInvoices.length ? `
      <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:6px">فواتير الإيجار</div>
      <table class="fleet-table" style="margin-bottom:10px">
        <tbody>
          ${monthInvoices.map(i => `
            <tr>
              <td data-label="رقم">${i.invoice_no}</td>
              <td data-label="المبلغ">${fmtKWD(i.amount)}</td>
              <td data-label="الحالة">${_balanceBadge(i.paid_amount, i.amount)}</td>
              <td data-label="إجراءات" style="display:flex;gap:6px">
                ${Number(i.remaining_amount) > 0 ? `<button class="fleet-btn success settle-invoice-btn" type="button" data-id="${i.id}">تحصيل</button>` : ''}
                ${Number(i.paid_amount) === 0 ? `<button class="fleet-btn danger void-invoice-btn" type="button" data-id="${i.id}">إلغاء</button>` : ''}
              </td>
            </tr>
            ${(receiptsByInvoice[i.id] || []).map(r => `
              <tr style="background:var(--bg)">
                <td data-label="سند">↳ ${r.receipt_no}</td>
                <td data-label="المبلغ">${fmtKWD(r.amount)}</td>
                <td data-label="التاريخ" style="color:var(--text3);font-size:12px">${r.receipt_date}</td>
                <td data-label="إجراءات">
                  <button class="fleet-btn danger void-receipt-btn" type="button" data-id="${r.id}">إلغاء السند</button>
                </td>
              </tr>`).join('')}`).join('')}
        </tbody>
      </table>` : ''}
    ${monthBills.length ? `
      <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:6px">الالتزامات</div>
      <table class="fleet-table">
        <tbody>
          ${monthBills.map(b => `
            <tr>
              <td data-label="رقم">${b.bill_no}</td>
              <td data-label="المبلغ">${fmtKWD(b.amount)}</td>
              <td data-label="الحالة">${_balanceBadge(b.paid_amount, b.amount)}</td>
              <td data-label="إجراءات" style="display:flex;gap:6px">
                ${Number(b.remaining_amount) > 0 ? `<button class="fleet-btn success settle-bill-btn" type="button" data-id="${b.id}">سداد</button>` : ''}
                ${Number(b.paid_amount) === 0 ? `<button class="fleet-btn danger void-bill-btn" type="button" data-id="${b.id}">إلغاء</button>` : ''}
              </td>
            </tr>
            ${(paymentsByBill[b.id] || []).map(p => `
              <tr style="background:var(--bg)">
                <td data-label="سند">↳ ${p.payment_no}</td>
                <td data-label="المبلغ">${fmtKWD(p.amount)}</td>
                <td data-label="التاريخ" style="color:var(--text3);font-size:12px">${p.payment_date}</td>
                <td data-label="إجراءات">
                  <button class="fleet-btn danger void-payment-btn" type="button" data-id="${p.id}">إلغاء السند</button>
                </td>
              </tr>`).join('')}`).join('')}
        </tbody>
      </table>` : ''}
  `;

  wrap.querySelectorAll('.settle-invoice-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const inv = monthInvoices.find(i => i.id === Number(btn.dataset.id));
      const ok = await settleInvoiceFlow(inv, context);
      if (ok) refresh();
    };
  });
  wrap.querySelectorAll('.void-invoice-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const ok = await voidInvoiceFlow(Number(btn.dataset.id));
      if (ok) refresh();
    };
  });
  wrap.querySelectorAll('.settle-bill-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const bill = monthBills.find(b => b.id === Number(btn.dataset.id));
      const ok = await settleBillFlow(bill, context);
      if (ok) refresh();
    };
  });
  wrap.querySelectorAll('.void-bill-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const ok = await voidBillFlow(Number(btn.dataset.id));
      if (ok) refresh();
    };
  });
  wrap.querySelectorAll('.void-receipt-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const ok = await voidReceiptFlow(Number(btn.dataset.id));
      if (ok) refresh();
    };
  });
  wrap.querySelectorAll('.void-payment-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const ok = await voidPaymentFlow(Number(btn.dataset.id));
      if (ok) refresh();
    };
  });

  return wrap;
}
