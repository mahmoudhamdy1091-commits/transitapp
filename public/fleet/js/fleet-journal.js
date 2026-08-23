// ╔══════════════════════════════════════════════════════════╗
// ║  fleet-journal.js — صفحة اليومية + الأوامر السريعة         ║
// ║  Phase 7 Stage 4 — نفس نمط #journalView في BOX/TM بالحرف   ║
// ║  (فلتر فترة، تسجيل سريع، تايم لاين مجمّع باليوم). صفر منطق ║
// ║  مالي جديد — كل زرار بينادي دوال fleet-invoices.js/         ║
// ║  fleet-bills.js الموجودة أصلًا من Phase 5.                 ║
// ╚══════════════════════════════════════════════════════════╝

import { apiGet, fmtKWD } from './fleet-core.js';
import { toast, openFormModal, showCtxMenu, mountVehiclePicker } from './fleet-ui.js';
import { issueInvoiceFlow, settleInvoiceFlow, voidInvoiceFlow, voidReceiptFlow } from './fleet-invoices.js';
import { issueBillFlow, settleBillFlow, voidBillFlow, voidPaymentFlow } from './fleet-bills.js';

// نفس تعيين الألوان الدلالي في journal.js: فاتورة إيجار≈بيع=أخضر،
// تحصيل≈تحصيل=أزرق، مصروف≈مصروف=أحمر، سداد≈دفعة مورد=سيان.
const TYPE_CONFIG = {
  invoice: { icon: '🧾', bg: 'var(--green-dim)', color: 'var(--green)', label: 'فاتورة إيجار', sign: '+' },
  receipt: { icon: '💰', bg: 'var(--blue-dim)', color: 'var(--blue)', label: 'تحصيل', sign: '+' },
  bill:    { icon: '💸', bg: 'var(--red-dim)', color: 'var(--red)', label: 'مصروف', sign: '-' },
  payment: { icon: '💳', bg: 'var(--cyan-dim)', color: 'var(--cyan)', label: 'سداد', sign: '-' },
};

function _periodRange(preset, from, to) {
  const today = new Date().toISOString().slice(0, 10);
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'custom') return (from && to) ? { from, to } : null;
  const start = new Date();
  if (preset === 'week') start.setDate(start.getDate() - 7);
  if (preset === 'month') start.setMonth(start.getMonth() - 1);
  if (preset === 'year') start.setFullYear(start.getFullYear() - 1);
  return { from: start.toISOString().slice(0, 10), to: today };
}

export async function renderJournal(params, main) {
  const ui = { preset: 'today', from: '', to: '' };
  const refresh = () => renderJournal(params, main);

  main.innerHTML = `
    <div class="fleet-card">
      <div style="font-size:15px;font-weight:700;margin-bottom:12px">📒 صفحة اليومية</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
        <span style="font-size:11px;color:var(--text2);font-weight:700;white-space:nowrap">الفترة:</span>
        <div style="display:flex;background:var(--card2);border-radius:var(--radius-sm);padding:3px;gap:2px">
          <button class="journal-period-btn active" data-preset="today" type="button">اليوم</button>
          <button class="journal-period-btn" data-preset="week" type="button">هذا الأسبوع</button>
          <button class="journal-period-btn" data-preset="month" type="button">هذا الشهر</button>
          <button class="journal-period-btn" data-preset="year" type="button">هذه السنة</button>
          <button class="journal-period-btn" data-preset="custom" type="button">تاريخ محدد</button>
        </div>
        <div id="customDateWrap" style="display:none;align-items:center;gap:6px">
          <input type="date" id="jFrom" class="fleet-input" style="width:auto">
          <span style="color:var(--text2)">—</span>
          <input type="date" id="jTo" class="fleet-input" style="width:auto">
          <button class="fleet-btn" id="applyCustomBtn" type="button">تطبيق</button>
        </div>
      </div>
      <div class="j-quick-btns">
        <span class="j-quick-label">تسجيل سريع:</span>
        <button class="btn btn-sm" id="qInvoiceBtn" type="button" style="background:var(--green-dim);border:1px solid var(--green);color:var(--green)">🧾 فاتورة إيجار</button>
        <button class="btn btn-sm" id="qReceiptBtn" type="button" style="background:var(--blue-dim);border:1px solid var(--blue);color:var(--blue)">💰 تحصيل</button>
        <button class="btn btn-sm" id="qBillBtn" type="button" style="background:var(--red-dim);border:1px solid var(--red);color:var(--red)">💸 مصروف</button>
        <button class="btn btn-sm" id="qPaymentBtn" type="button" style="background:var(--cyan-dim);border:1px solid var(--cyan);color:var(--cyan)">💳 سداد</button>
      </div>
    </div>
    <div id="journalTimeline"><div class="fleet-loading">جاري التحميل...</div></div>`;

  const [vehicles, openAssignments, invoices, bills, receipts, payments] = await Promise.all([
    apiGet('fleet_vehicles', { select: 'id,file_no,plate_no,status', plate_no: 'not.ilike.ZZTEST*', order: 'plate_no.asc' }),
    apiGet('fleet_assignments', { select: 'vehicle_id,driver_id,monthly_rent,fleet_drivers(full_name)', end_date: 'is.null' }),
    apiGet('v_invoice_balances', { select: '*', order: 'issue_date.desc' }),
    apiGet('v_bill_balances', { select: '*', order: 'issue_date.desc' }),
    apiGet('fleet_receipts', { select: '*', post_status: 'eq.posted', order: 'receipt_date.desc' }),
    apiGet('fleet_payments', { select: '*', post_status: 'eq.posted', order: 'payment_date.desc' }),
  ]);
  const plateById = Object.fromEntries(vehicles.map(v => [v.id, v.file_no || v.plate_no]));
  const assignmentByVehicle = Object.fromEntries(openAssignments.map(a => [a.vehicle_id, a]));
  const invoiceById = Object.fromEntries(invoices.map(i => [i.id, i]));
  const billById = Object.fromEntries(bills.map(b => [b.id, b]));

  // خيارات عنصر اختيار السيارة (بحث بدل <select>) — رقم الملف/اللوحة +
  // السائق الحالي مع بعض، فلترة حية على أي منهم.
  function _vehicleOptions(list) {
    return list.map(v => {
      const driverName = assignmentByVehicle[v.id]?.fleet_drivers?.full_name;
      const label = `${v.file_no || v.plate_no} — ${driverName || 'بدون سائق'}`;
      return { value: String(v.id), label, searchText: `${v.file_no || ''} ${v.plate_no} ${driverName || ''}` };
    });
  }

  function _buildEntries() {
    const entries = [];
    invoices.forEach(i => entries.push({
      type: 'invoice', id: i.id, date: i.issue_date, amount: Number(i.amount),
      title: `فاتورة إيجار ${i.invoice_no} — ${plateById[i.vehicle_id] || '—'}`,
    }));
    receipts.forEach(r => {
      const inv = invoiceById[r.invoice_id];
      entries.push({
        type: 'receipt', id: r.id, date: r.receipt_date, amount: Number(r.amount),
        title: `سند قبض ${r.receipt_no} — ${inv ? (plateById[inv.vehicle_id] || '—') : '—'}`,
      });
    });
    bills.forEach(b => entries.push({
      type: 'bill', id: b.id, date: b.issue_date, amount: Number(b.amount),
      title: `التزام مصروف ${b.bill_no} — ${b.vehicle_id ? (plateById[b.vehicle_id] || '—') : 'عمومي'}`,
    }));
    payments.forEach(p => {
      const bill = billById[p.bill_id];
      entries.push({
        type: 'payment', id: p.id, date: p.payment_date, amount: Number(p.amount),
        title: `سند صرف ${p.payment_no} — ${bill ? (bill.vehicle_id ? (plateById[bill.vehicle_id] || '—') : 'عمومي') : '—'}`,
      });
    });
    return entries;
  }

  async function _voidEntry(type, id) {
    let ok = false;
    if (type === 'invoice') ok = await voidInvoiceFlow(id);
    if (type === 'receipt') ok = await voidReceiptFlow(id);
    if (type === 'bill') ok = await voidBillFlow(id);
    if (type === 'payment') ok = await voidPaymentFlow(id);
    if (ok) refresh();
  }

  function _renderTimeline() {
    const range = _periodRange(ui.preset, ui.from, ui.to);
    const entries = _buildEntries().filter(e => !range || (e.date >= range.from && e.date <= range.to));
    const timeline = document.getElementById('journalTimeline');

    if (!entries.length) {
      timeline.innerHTML = `<div class="empty-state"><div class="e-icon">📅</div><p>لا توجد عمليات في هذه الفترة</p></div>`;
      return;
    }

    const groups = {};
    entries.forEach(e => { (groups[e.date] = groups[e.date] || []).push(e); });

    let html = '';
    Object.keys(groups).sort((a, b) => b.localeCompare(a)).forEach(date => {
      const dayEntries = groups[date];
      html += `<div class="journal-day-group">
        <div class="journal-day-header">
          <span class="journal-day-label">${date}</span>
          <div class="journal-day-line"></div>
          <span class="journal-day-total">${dayEntries.length} عملية</span>
        </div>`;
      dayEntries.forEach(e => {
        const cfg = TYPE_CONFIG[e.type];
        html += `
          <div class="j-entry">
            <div class="j-entry-icon" style="background:${cfg.bg}">${cfg.icon}</div>
            <div class="j-entry-body">
              <div class="j-entry-title">${e.title}</div>
              <div class="j-entry-meta"><span style="background:var(--card2);padding:2px 8px;border-radius:10px;font-size:13px;font-weight:700">${cfg.label}</span></div>
            </div>
            <div class="j-entry-amount" style="color:${cfg.color}">${cfg.sign}${fmtKWD(e.amount)}</div>
            <button class="btn-ctx-menu entry-ctx-btn" type="button" data-type="${e.type}" data-id="${e.id}" title="إجراءات">⋮</button>
          </div>`;
      });
      html += `</div>`;
    });
    timeline.innerHTML = html;

    timeline.querySelectorAll('.entry-ctx-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const type = btn.dataset.type, id = Number(btn.dataset.id);
        showCtxMenu(btn, [
          { icon: '⊘', label: 'إلغاء', danger: true, action: () => _voidEntry(type, id) },
        ]);
      };
    });
  }

  main.querySelectorAll('.journal-period-btn').forEach(btn => {
    btn.onclick = () => {
      ui.preset = btn.dataset.preset;
      main.querySelectorAll('.journal-period-btn').forEach(b => b.classList.toggle('active', b === btn));
      main.querySelector('#customDateWrap').style.display = ui.preset === 'custom' ? 'flex' : 'none';
      if (ui.preset !== 'custom') _renderTimeline();
    };
  });
  main.querySelector('#applyCustomBtn').onclick = () => {
    ui.from = main.querySelector('#jFrom').value;
    ui.to = main.querySelector('#jTo').value;
    _renderTimeline();
  };

  // ── تسجيل سريع: تدفّق تدريجي (اختار سيارة → فاتورة/التزام غير مسدد لو
  // أكتر من واحد → الحقول) بينادي دوال fleet-invoices.js/fleet-bills.js
  // الموجودة أصلًا مباشرة — صفر منطق مالي جديد هنا.
  main.querySelector('#qInvoiceBtn').onclick = async () => {
    const eligible = vehicles.filter(v => assignmentByVehicle[v.id]);
    if (!eligible.length) { toast('لا يوجد سيارات عندها سائق حالي', 'warn'); return; }
    const fd = await openFormModal('فاتورة إيجار سريعة', `
      <label>السيارة *</label>
      <div id="vehiclePickerHost" style="margin-bottom:14px"></div>`, {
      submitLabel: 'التالي',
      onMount: (formEl) => mountVehiclePicker(formEl.querySelector('#vehiclePickerHost'), _vehicleOptions(eligible), { name: 'vehicle_id' }),
    });
    if (!fd) return;
    if (!fd.get('vehicle_id')) { toast('اختر سيارة أولًا', 'warn'); return; }
    const vehicleId = Number(fd.get('vehicle_id'));
    const a = assignmentByVehicle[vehicleId];
    if (await issueInvoiceFlow(vehicleId, a.driver_id, a.monthly_rent)) refresh();
  };

  main.querySelector('#qReceiptBtn').onclick = async () => {
    const eligibleInvoices = invoices.filter(i => Number(i.remaining_amount) > 0);
    if (!eligibleInvoices.length) { toast('لا يوجد فواتير غير مسددة', 'warn'); return; }
    const eligibleVehicleIds = [...new Set(eligibleInvoices.map(i => i.vehicle_id))];
    const eligibleVehicles = vehicles.filter(v => eligibleVehicleIds.includes(v.id));
    const fd1 = await openFormModal('تحصيل سريع', `
      <label>السيارة *</label>
      <div id="vehiclePickerHost" style="margin-bottom:14px"></div>`, {
      submitLabel: 'التالي',
      onMount: (formEl) => mountVehiclePicker(formEl.querySelector('#vehiclePickerHost'), _vehicleOptions(eligibleVehicles), { name: 'vehicle_id' }),
    });
    if (!fd1) return;
    if (!fd1.get('vehicle_id')) { toast('اختر سيارة أولًا', 'warn'); return; }
    const vehicleId = Number(fd1.get('vehicle_id'));
    const vehicleInvoices = eligibleInvoices.filter(i => i.vehicle_id === vehicleId);
    let inv = vehicleInvoices[0];
    if (vehicleInvoices.length > 1) {
      const fd2 = await openFormModal('اختر الفاتورة', `
        <label>الفاتورة *
          <select name="invoice_id" required class="fleet-input">
            ${vehicleInvoices.map(i => `<option value="${i.id}">${i.invoice_no} — ${i.for_month.slice(0, 7)} — متبقي ${fmtKWD(i.remaining_amount)}</option>`).join('')}
          </select>
        </label>`, { submitLabel: 'التالي' });
      if (!fd2) return;
      inv = vehicleInvoices.find(i => i.id === Number(fd2.get('invoice_id')));
    }
    if (await settleInvoiceFlow(inv, { vehiclePlate: plateById[vehicleId] })) refresh();
  };

  main.querySelector('#qBillBtn').onclick = async () => {
    const generalOption = { value: '', label: 'عمومي (بدون سيارة)', searchText: 'عمومي بدون سيارة general' };
    const fd = await openFormModal('مصروف سريع', `
      <label>السيارة</label>
      <div id="vehiclePickerHost" style="margin-bottom:14px"></div>`, {
      submitLabel: 'التالي',
      onMount: (formEl) => {
        const picker = mountVehiclePicker(formEl.querySelector('#vehiclePickerHost'), [generalOption, ..._vehicleOptions(vehicles)], { name: 'vehicle_id' });
        picker.setValue('', 'عمومي (بدون سيارة)');
      },
    });
    if (!fd) return;
    const vehicleId = fd.get('vehicle_id') ? Number(fd.get('vehicle_id')) : null;
    if (await issueBillFlow(vehicleId)) refresh();
  };

  main.querySelector('#qPaymentBtn').onclick = async () => {
    const eligibleBills = bills.filter(b => Number(b.remaining_amount) > 0);
    if (!eligibleBills.length) { toast('لا يوجد التزامات غير مسددة', 'warn'); return; }
    const scopeIds = [...new Set(eligibleBills.map(b => b.vehicle_id ? String(b.vehicle_id) : 'general'))];
    const scopeOptions = scopeIds.map(o => o === 'general'
      ? { value: 'general', label: 'عمومي', searchText: 'عمومي general' }
      : _vehicleOptions(vehicles.filter(v => String(v.id) === o))[0]);
    const fd1 = await openFormModal('سداد سريع', `
      <label>السيارة / الجهة *</label>
      <div id="scopePickerHost" style="margin-bottom:14px"></div>`, {
      submitLabel: 'التالي',
      onMount: (formEl) => mountVehiclePicker(formEl.querySelector('#scopePickerHost'), scopeOptions, { name: 'scope' }),
    });
    if (!fd1) return;
    if (!fd1.get('scope')) { toast('اختر سيارة أو جهة أولًا', 'warn'); return; }
    const scope = fd1.get('scope');
    const scopedBills = eligibleBills.filter(b => (b.vehicle_id ? String(b.vehicle_id) : 'general') === scope);
    let bill = scopedBills[0];
    if (scopedBills.length > 1) {
      const fd2 = await openFormModal('اختر الالتزام', `
        <label>الالتزام *
          <select name="bill_id" required class="fleet-input">
            ${scopedBills.map(b => `<option value="${b.id}">${b.bill_no} — ${b.for_month.slice(0, 7)} — متبقي ${fmtKWD(b.remaining_amount)}</option>`).join('')}
          </select>
        </label>`, { submitLabel: 'التالي' });
      if (!fd2) return;
      bill = scopedBills.find(b => b.id === Number(fd2.get('bill_id')));
    }
    if (await settleBillFlow(bill, bill.vehicle_id ? { vehiclePlate: plateById[bill.vehicle_id] } : {})) refresh();
  };

  _renderTimeline();
}
