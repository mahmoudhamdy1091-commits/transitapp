// ╔══════════════════════════════════════════════════════════╗
// ║  fleet-bills.js — إصدار/سداد/إلغاء التزامات المصروفات     ║
// ║  بنية موازية تمامًا لـfleet-invoices.js. صفر منطق مالي هنا ║
// ╚══════════════════════════════════════════════════════════╝

import { apiGet, apiRpc, genClientUuid, fmtKWD } from './fleet-core.js';
import { toast, confirmAsync, openFormModal, guardedCall } from './fleet-ui.js';
import { printFleetVoucher } from './fleet-print.js';

const today = () => new Date().toISOString().slice(0, 10);

// vehicleId = null → مصروف عمومي على الشركة (§5 من البرومبت المعتمد)
export async function issueBillFlow(vehicleId) {
  const accounts = await apiGet('fleet_accounts', { select: 'code,name_ar', type: 'eq.expense', order: 'code.asc' });
  const fd = await openFormModal(vehicleId ? 'تسجيل مصروف على السيارة' : 'تسجيل مصروف عمومي', `
    <label>التصنيف *
      <select name="account_code" required class="fleet-input">
        ${accounts.map(a => `<option value="${a.code}">${a.name_ar}</option>`).join('')}
      </select>
    </label>
    <label>الشهر *<input name="for_month" type="month" required class="fleet-input" value="${new Date().toISOString().slice(0, 7)}"></label>
    <label>المبلغ *<input name="amount" type="number" step="0.001" min="0.001" required class="fleet-input"></label>
    <label>تاريخ الإصدار<input name="issue_date" type="date" class="fleet-input" value="${today()}"></label>
  `, { submitLabel: 'تسجيل الالتزام' });
  if (!fd) return false;

  const { ok } = await guardedCall(() => apiRpc('fleet_issue_bill', {
    p_client_uuid: genClientUuid(),
    p_vehicle_id: vehicleId ? Number(vehicleId) : null,
    p_account_code: fd.get('account_code'),
    p_for_month: fd.get('for_month') + '-01',
    p_amount: Number(fd.get('amount')),
    p_issue_date: fd.get('issue_date') || today(),
  }), 'تسجيل التزام مصروف');

  if (ok) toast('تم تسجيل الالتزام', 'ok');
  return ok;
}

// context: { vehiclePlate, driverName, driverCivilId } — فارغين لو مصروف عمومي
export async function settleBillFlow(bill, context = {}) {
  const remaining = Number(bill.remaining_amount);
  const fd = await openFormModal('سداد دفعة', `
    <div style="margin-bottom:10px;color:var(--text2);font-size:13px">الرصيد المتبقي على الالتزام ${bill.bill_no}: <strong>${fmtKWD(remaining)}</strong></div>
    <label>المبلغ المسدَّد *<input name="amount" type="number" step="0.001" min="0.001" max="${remaining}" required class="fleet-input" value="${remaining}"></label>
    <label>تاريخ السداد<input name="payment_date" type="date" class="fleet-input" value="${today()}"></label>
    <label>ملاحظات<input name="description_ar" class="fleet-input"></label>
  `, { submitLabel: 'سداد' });
  if (!fd) return false;

  const { ok, result } = await guardedCall(() => apiRpc('fleet_settle_bill', {
    p_client_uuid: genClientUuid(),
    p_bill_id: bill.id,
    p_amount: Number(fd.get('amount')),
    p_payment_date: fd.get('payment_date') || today(),
    p_description_ar: fd.get('description_ar') || null,
  }), 'سداد التزام');

  if (ok) {
    toast('تم السداد', 'ok');
    const payment = Array.isArray(result) ? result[0] : result;
    printFleetVoucher('payment', {
      docNo: payment.payment_no,
      date: payment.payment_date,
      driverName: context.driverName || '—',
      driverCivilId: context.driverCivilId || '—',
      vehiclePlate: context.vehiclePlate || 'مصروف عمومي',
      amount: payment.amount,
      descriptionAr: payment.description_ar,
    });
  }
  return ok;
}

export async function voidBillFlow(billId) {
  const sure = await confirmAsync('إلغاء الالتزام', 'هيتم عكس القيد المحاسبي المرتبط بقيد جديد. لو عليه سند صرف مُرحَّل، الإلغاء هيُرفض ولازم تلغي السند الأول.', true, 'إلغاء الالتزام');
  if (!sure) return false;
  const { ok } = await guardedCall(() => apiRpc('fleet_void_bill', { p_bill_id: billId }), 'إلغاء التزام');
  if (ok) toast('تم إلغاء الالتزام', 'ok');
  return ok;
}

export async function voidPaymentFlow(paymentId) {
  const sure = await confirmAsync('إلغاء سند الصرف', 'هيتم عكس القيد المحاسبي المرتبط بسند السداد ده.', true, 'إلغاء السند');
  if (!sure) return false;
  const { ok } = await guardedCall(() => apiRpc('fleet_void_payment', { p_payment_id: paymentId }), 'إلغاء سند صرف');
  if (ok) toast('تم إلغاء السند', 'ok');
  return ok;
}
