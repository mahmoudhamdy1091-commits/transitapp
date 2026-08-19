// ╔══════════════════════════════════════════════════════════╗
// ║  fleet-print.js — طباعة سندات القبض/الصرف عربي/إنجليزي   ║
// ║  نمط مستقل (window.open + CSS مضمَّن)، بنفس فلسفة عزل     ║
// ║  الطباعة الموجودة في js/print.js لكن بدون استيراده.       ║
// ╚══════════════════════════════════════════════════════════╝

import { fmtKWD } from './fleet-core.js';

const PRINT_CSS = `
@page { size: A4 portrait; margin: 16mm 14mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Cairo', Arial, sans-serif; color: #1a1a1a; direction: rtl; line-height: 1.7; padding: 24px; }
.voucher { max-width: 700px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; padding: 24px; }
.voucher-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #333; padding-bottom: 12px; margin-bottom: 20px; }
.voucher-brand { display: flex; align-items: center; gap: 10px; }
.voucher-company-ar { font-size: 13px; font-weight: 700; }
.voucher-company-en { font-size: 10px; color: #666; direction: ltr; }
.voucher-title-ar { font-size: 20px; font-weight: 700; }
.voucher-title-en { font-size: 14px; color: #555; direction: ltr; }
.voucher-no { font-size: 13px; color: #555; }
.voucher-body-ar { font-size: 15px; margin-bottom: 16px; }
.voucher-body-en { font-size: 13px; color: #333; direction: ltr; text-align: left; border-top: 1px dashed #ccc; padding-top: 12px; }
.voucher-amount { font-size: 18px; font-weight: 700; margin: 12px 0; }
.voucher-footer { display: flex; justify-content: space-between; margin-top: 40px; font-size: 12px; color: #555; }
.sig-line { border-top: 1px solid #999; width: 160px; text-align: center; padding-top: 4px; }
`;

function _open(html) {
  const win = window.open('', '_blank', 'width=800,height=900');
  if (!win) { alert('يرجى السماح بالنوافذ المنبثقة لإتمام الطباعة'); return; }
  win.document.open();
  win.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>سند</title><style>${PRINT_CSS}</style></head><body>${html}<script>window.onload=()=>window.print()</` + `script></body></html>`);
  win.document.close();
  win.focus();
}

// docType: 'receipt' | 'payment'
// data: { docNo, date, driverName, driverCivilId, vehiclePlate, amount, descriptionAr, descriptionEn }
export function printFleetVoucher(docType, data) {
  const isReceipt = docType === 'receipt';
  const titleAr = isReceipt ? 'سند قبض' : 'سند صرف';
  const titleEn = isReceipt ? 'Receipt Voucher' : 'Payment Voucher';
  const verbAr = isReceipt ? 'استلمنا من السائق' : 'صرفنا للسائق';
  const verbEn = isReceipt ? 'Received from driver' : 'Paid to driver';

  const html = `
    <div class="voucher">
      <div class="voucher-header">
        <div class="voucher-brand">
          <img src="/fleet/icon.svg" alt="TIC" style="width:40px;height:40px;border-radius:10px">
          <div>
            <div class="voucher-company-ar">الترانزيت الدولي لنقل البضائع</div>
            <div class="voucher-company-en">Transit International Company — For Transport Goods</div>
          </div>
        </div>
        <div class="voucher-no">
          رقم: ${data.docNo || ''}<br>
          التاريخ: ${data.date || ''}
        </div>
      </div>
      <div style="text-align:center;margin-bottom:16px">
        <div class="voucher-title-ar">${titleAr}</div>
        <div class="voucher-title-en">${titleEn}</div>
      </div>
      <div class="voucher-body-ar">
        ${verbAr} <strong>${data.driverName || ''}</strong>
        حامل الرقم المدني رقم <strong>${data.driverCivilId || ''}</strong>
        مبلغ وقدره <strong>${fmtKWD(data.amount)}</strong>
        عن السيارة رقم <strong>${data.vehiclePlate || ''}</strong>
        ${data.descriptionAr ? ' — ' + data.descriptionAr : ''}
      </div>
      <div class="voucher-amount">${fmtKWD(data.amount)}</div>
      <div class="voucher-body-en">
        ${verbEn} <strong>${data.driverName || ''}</strong>,
        holder of Civil ID No. <strong>${data.driverCivilId || ''}</strong>,
        the amount of <strong>${fmtKWD(data.amount)}</strong>
        for vehicle plate No. <strong>${data.vehiclePlate || ''}</strong>
        ${data.descriptionEn ? ' — ' + data.descriptionEn : ''}
      </div>
      <div class="voucher-footer">
        <div class="sig-line">توقيع المستلم / Recipient</div>
        <div class="sig-line">توقيع المحاسب / Accountant</div>
      </div>
    </div>`;
  _open(html);
}
