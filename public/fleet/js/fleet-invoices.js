// ╔══════════════════════════════════════════════════════════╗
// ║  fleet-invoices.js — إصدار/تحصيل/إلغاء فواتير الإيجار     ║
// ║  صفر منطق مالي هنا — كل حساب رصيد/رفض/قفل من دوال RPC     ║
// ║  المركزية في sql/fleet_schema.sql فقط.                    ║
// ╚══════════════════════════════════════════════════════════╝

import { apiRpc, genClientUuid, fmtKWD } from './fleet-core.js';
import { toast, confirmAsync, openFormModal, guardedCall } from './fleet-ui.js';
import { printFleetVoucher } from './fleet-print.js';

const today = () => new Date().toISOString().slice(0, 10);

// context: { vehiclePlate, driverName, driverCivilId }
export async function issueInvoiceFlow(vehicleId, driverId, defaultRent) {
  const fd = await openFormModal('فاتورة إيجار جديدة', `
    <label>الشهر *<input name="for_month" type="month" required class="fleet-input" value="${new Date().toISOString().slice(0, 7)}"></label>
    <label>المبلغ *<input name="amount" type="number" step="0.001" min="0.001" required class="fleet-input" value="${defaultRent ?? ''}"></label>
    <label>تاريخ الإصدار<input name="issue_date" type="date" class="fleet-input" value="${today()}"></label>
  `, { submitLabel: 'إصدار الفاتورة' });
  if (!fd) return false;

  const { ok } = await guardedCall(() => apiRpc('fleet_issue_invoice', {
    p_client_uuid: genClientUuid(),
    p_vehicle_id: Number(vehicleId),
    p_driver_id: Number(driverId),
    p_for_month: fd.get('for_month') + '-01',
    p_amount: Number(fd.get('amount')),
    p_issue_date: fd.get('issue_date') || today(),
  }), 'إصدار فاتورة إيجار');

  if (ok) toast('تم إصدار الفاتورة', 'ok');
  return ok;
}

export async function settleInvoiceFlow(invoice, context) {
  const remaining = Number(invoice.remaining_amount);
  const fd = await openFormModal('تحصيل دفعة', `
    <div style="margin-bottom:10px;color:var(--text2);font-size:13px">الرصيد المتبقي على الفاتورة ${invoice.invoice_no}: <strong>${fmtKWD(remaining)}</strong></div>
    <label>المبلغ المُحصَّل *<input name="amount" type="number" step="0.001" min="0.001" max="${remaining}" required class="fleet-input" value="${remaining}"></label>
    <label>تاريخ التحصيل<input name="receipt_date" type="date" class="fleet-input" value="${today()}"></label>
    <label>ملاحظات<input name="description_ar" class="fleet-input"></label>
  `, { submitLabel: 'تحصيل' });
  if (!fd) return false;

  const { ok, result } = await guardedCall(() => apiRpc('fleet_settle_invoice', {
    p_client_uuid: genClientUuid(),
    p_invoice_id: invoice.id,
    p_amount: Number(fd.get('amount')),
    p_receipt_date: fd.get('receipt_date') || today(),
    p_description_ar: fd.get('description_ar') || null,
  }), 'تحصيل فاتورة');

  if (ok) {
    toast('تم التحصيل', 'ok');
    const receipt = Array.isArray(result) ? result[0] : result;
    printFleetVoucher('receipt', {
      docNo: receipt.receipt_no,
      date: receipt.receipt_date,
      driverName: context.driverName,
      driverCivilId: context.driverCivilId,
      vehiclePlate: context.vehiclePlate,
      amount: receipt.amount,
      descriptionAr: receipt.description_ar,
    });
  }
  return ok;
}

export async function voidInvoiceFlow(invoiceId) {
  const sure = await confirmAsync('إلغاء الفاتورة', 'هيتم عكس القيد المحاسبي المرتبط بقيد جديد. الفاتورة تفضل في السجل بحالة "ملغاة". لو عليها سند تحصيل مُرحَّل، الإلغاء هيُرفض ولازم تلغي السند الأول.', true, 'إلغاء الفاتورة');
  if (!sure) return false;
  const { ok } = await guardedCall(() => apiRpc('fleet_void_invoice', { p_invoice_id: invoiceId }), 'إلغاء فاتورة');
  if (ok) toast('تم إلغاء الفاتورة', 'ok');
  return ok;
}

export async function voidReceiptFlow(receiptId) {
  const sure = await confirmAsync('إلغاء سند القبض', 'هيتم عكس القيد المحاسبي المرتبط بسند التحصيل ده.', true, 'إلغاء السند');
  if (!sure) return false;
  const { ok } = await guardedCall(() => apiRpc('fleet_void_receipt', { p_receipt_id: receiptId }), 'إلغاء سند قبض');
  if (ok) toast('تم إلغاء السند', 'ok');
  return ok;
}
