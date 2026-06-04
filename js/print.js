// ╔══════════════════════════════════════════════════════════════════════╗
// ║  print.js — Print Module · Transit Cars Management System           ║
// ║  Extracted from index.html — non-breaking isolation                 ║
// ║  All functions remain on window (global scope) for compatibility    ║
// ╚══════════════════════════════════════════════════════════════════════╝
//
// ── DEPENDENCIES (must be available before this module runs) ──────────
//   state           → core.js   (state.system)
//   apiGetAll()     → core.js
//   fmt()           → utils.js
//   el()            → utils.js
//   loadDealStatement()        → settings module
//   getPartnerDealBalance()    → engine/accounting module
//   window._ledgerAllEntries   → set by contacts module
//   window._ledgerContactName  → set by contacts module
//   window._ledgerVehicleMap   → set by contacts module
//   window._dealStatementData  → set by settings module
//
// ── DOM REQUIREMENTS ──────────────────────────────────────────────────
//   #printOverlay              → in index.html
//   #printOverlayBody          → in index.html
//   #printOverlayTitle         → in index.html
//   #invoice-print-area        → in transactions UI
//   #partnerStatementContent   → in accounting UI
//   #cs-table, #cs-kpis        → in operations UI
//
// ── USAGE ─────────────────────────────────────────────────────────────
//   All function names unchanged. Call exactly as before:
//   openPrintOverlay(html, title)
//   printDocument(html, title)
//   printSaleInvoice({ invNo, customer, ... })
//   printPurchaseOrder(fileNo)
//   etc.
// ══════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════
// SECTION 1 — Print Infrastructure (Overlay + Styles)
// ════════════════════════════════════════════════════════════

const PRINT_STYLES=`*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Cairo','Segoe UI',Arial,sans-serif;color:#1a1a1a;font-size:12px;direction:rtl}.print-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:14px;border-bottom:3px solid #1a1a1a}.logo-area .company{font-size:20px;font-weight:800}.doc-title{font-size:24px;font-weight:800;text-align:left}table{width:100%;border-collapse:collapse;margin:12px 0;font-size:11px}thead tr{background:#1a1a1a;color:#fff}thead th{padding:8px 10px;text-align:right}tbody tr{border-bottom:1px solid #eee}tbody td{padding:7px 10px}tfoot tr{background:#f0f0f0;font-weight:700}.kpi-box{background:#f8f9fa;border-radius:6px;padding:10px 14px;border-right:3px solid #e6930a}.info-row{display:flex;justify-content:space-between;padding:3px 0;font-size:12px;border-bottom:1px solid #eee}.green{color:#16a34a}.red{color:#dc2626}.blue{color:#2563eb}.amber{color:#d97706}.page{max-width:700px;margin:0 auto;padding:20px}.amount-box{background:#1a1a1a;color:#fff;border-radius:10px;padding:20px 28px;text-align:center;margin-bottom:22px}.amount-value{font-size:32px;font-weight:900}.sig-box{text-align:center;padding-top:44px;border-top:1px solid #ccc}`;function openPrintOverlay(html,title){const o=document.getElementById('printOverlay'),b=document.getElementById('printOverlayBody'),t=document.getElementById('printOverlayTitle');if(!o||!b)return;if(t)t.textContent=title||'معاينة الطباعة';b.innerHTML=`<style>${PRINT_STYLES}</style>`+html;o.style.display='block';document.body.style.overflow='hidden';}function closePrintOverlay(){const o=document.getElementById('printOverlay');if(o)o.style.display='none';document.body.style.overflow='';}document.addEventListener('keydown',e=>{if(e.key==='Escape')closePrintOverlay();});
function printDocument(html,title){openPrintOverlay(html,title);}

// ════════════════════════════════════════════════════════════
// SECTION 2 — Document Header Template
// ════════════════════════════════════════════════════════════

function docHeader(title, subtitle, fileNo) {
  return `<div class="print-header">
    <div class="logo-area">
      <div class="company">Transit International</div>
      <div class="sub">نظام إدارة صفقات السيارات</div>
      <div class="sub" style="margin-top:4px;color:#999">تاريخ الطباعة: ${new Date().toLocaleDateString('en-GB')}</div>
    </div>
    <div>
      <div class="doc-title">${title}</div>
      ${subtitle ? `<div class="doc-subtitle">${subtitle}</div>` : ''}
      ${fileNo ? `<div style="font-size:13px;color:#e6930a;font-weight:700;text-align:left;margin-top:4px"># ${fileNo}</div>` : ''}
    </div>
  </div>`;
}

// ════════════════════════════════════════════════════════════
// SECTION 3 — Invoice Print (reads #invoice-print-area DOM)
// ════════════════════════════════════════════════════════════

function printInvoice() {
  const content = el('invoice-print-area')?.innerHTML;
  if (!content) return;
  openPrintOverlay(content, 'فاتورة بيع');
}

// ════════════════════════════════════════════════════════════
// SECTION 4 — Sale Invoice Templates
// ════════════════════════════════════════════════════════════

async function reprintInvoice(invNo, fn) {
  try {
    // جيب بيانات الفاتورة — من الـ cache أو fresh fetch
    await ensureCache();
    let data = state.allSales.filter(s => s.file_no === fn && s.inv_no === invNo);
    if (!data.length) {
      // fallback: fresh fetch لو مش في الـ cache
      data = await apiGetAll('sales', { select:'*', system_type:`eq.${state.system}`, file_no:`eq.${fn}`, inv_no:`eq.${invNo}` });
    }
    if (!data?.length) { toast('لم يتم إيجاد بيانات الفاتورة','err'); return; }
    const s = data[0];

    // جيب بيانات السيارات من الـ cache
    const vehicles = state.allVehicles.filter(v => v.file_no === fn);

    const items = data.map(d => {
      const v = vehicles.find(v => v.vin === d.vin);
      return {
        vin:           d.vin||'',
        model:         v?.model||v?.vehicle_type||'',
        plate:         v?.plate||'',
        color:         v?.color||'',
        engine:        v?.engine_size||'',
        year:          v?.year||'',
        price:         +d.sale_price||0,
        vnote:         d.notes||'',
        purchasePrice: +v?.purchase_price||0,
      };
    });

    printSaleInvoice({
      invNo, customer: s.customer, date: s.sale_date,
      fn, notes: s.notes||'',
      items, total: items.reduce((t,i)=>t+i.price,0)
    });
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

function printSaleInvoice({ invNo, customer, date, fn, notes, items, total, extraCharges = [], grandTotal = null }) {
  const companyName = 'Transit Co.';
  const companyNameAr = 'ترانزيت';
  const companyAddress = 'Kuwait · الكويت';
  const finalTotal = grandTotal != null ? grandTotal : total;

  const itemsHtml = items.map((item, i) => `
    <tr>
      <td style="text-align:center">${i+1}</td>
      <td>
        <div style="font-weight:600">${item.model||'—'}</div>
        <div style="font-size:11px;color:#666">${item.color||''}${item.year?' · '+item.year:''}</div>
      </td>
      <td style="direction:ltr;text-align:center;font-family:monospace;font-size:12px">${item.vin||'—'}</td>
      <td style="direction:ltr;text-align:center;font-family:monospace">${item.plate||'—'}</td>
      <td style="text-align:center">${item.engine?item.engine+' L':'—'}</td>
      <td style="text-align:left;font-weight:600">${item.price.toLocaleString('en-US',{minimumFractionDigits:2})}</td>
    </tr>`).join('');

  // صف المجموع الفرعي للسيارات (فقط إذا في مصاريف إضافية)
  const subtotalRow = extraCharges.length > 0 ? `
    <tr style="background:#f0f0f0;font-weight:600">
      <td colspan="5" style="text-align:right;padding:8px 12px;color:#555">مجموع السيارات / Vehicles Subtotal</td>
      <td style="text-align:left;padding:8px 12px">${total.toLocaleString('en-US',{minimumFractionDigits:2})}</td>
    </tr>` : '';

  // بنود المصاريف الإضافية
  const extraRowsHtml = extraCharges.map((c, i) => `
    <tr style="background:#fff8ec">
      <td style="text-align:center;color:#c47a00;font-size:11px">+</td>
      <td colspan="4" style="color:#c47a00;font-weight:600;padding:8px 12px">
        ${c.desc}
        <span style="font-size:10px;background:#fef3c7;color:#92400e;padding:1px 7px;border-radius:10px;margin-right:8px;font-weight:700">مصروف إضافي</span>
      </td>
      <td style="text-align:left;font-weight:600;color:#c47a00;padding:8px 12px">${c.amount.toLocaleString('en-US',{minimumFractionDigits:2})}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>فاتورة ${invNo}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color:#1a1a1a; font-size:13px; background:#fff; }
  .page { max-width:800px; margin:0 auto; padding:32px 36px; }

  /* Header */
  .inv-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:28px; padding-bottom:20px; border-bottom:3px solid #1a1a1a; }
  .logo-area { text-align:right; }
  .logo-placeholder { width:120px; height:60px; border:2px dashed #ccc; border-radius:8px; display:flex; align-items:center; justify-content:center; color:#aaa; font-size:11px; margin-bottom:6px; }
  .company-name { font-size:22px; font-weight:800; color:#1a1a1a; }
  .company-name-ar { font-size:14px; color:#555; margin-top:2px; }
  .inv-title-area { text-align:left; }
  .inv-title { font-size:28px; font-weight:800; color:#1a1a1a; letter-spacing:-0.5px; }
  .inv-title-ar { font-size:16px; color:#555; margin-top:4px; }
  .inv-number { font-size:16px; font-weight:700; margin-top:8px; color:#c47a00; }

  /* Info boxes */
  .inv-info { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:24px; }
  .info-box { background:#f8f9fa; border-radius:8px; padding:14px 16px; }
  .info-box-title { font-size:10px; font-weight:700; color:#888; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px; }
  .info-row { display:flex; justify-content:space-between; padding:3px 0; font-size:13px; }
  .info-label { color:#666; }
  .info-value { font-weight:600; color:#1a1a1a; }

  /* Table */
  table { width:100%; border-collapse:collapse; margin-bottom:20px; }
  thead tr { background:#1a1a1a; color:#fff; }
  thead th { padding:10px 12px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px; }
  tbody tr { border-bottom:1px solid #eee; }
  tbody tr:nth-child(even):not(.extra-row):not(.subtotal-row) { background:#fafafa; }
  tbody td { padding:10px 12px; vertical-align:middle; }

  /* Total */
  .total-section { display:flex; justify-content:flex-end; margin-bottom:24px; }
  .total-box { background:#1a1a1a; color:#fff; border-radius:10px; padding:16px 24px; min-width:260px; }
  .total-label { font-size:12px; color:#aaa; margin-bottom:4px; }
  .total-amount { font-size:24px; font-weight:800; color:#fff; }
  .total-currency { font-size:13px; color:#aaa; margin-top:2px; }
  .total-sub-row { display:flex; justify-content:space-between; font-size:12px; color:#aaa; padding:3px 0; border-top:1px solid #444; margin-top:8px; padding-top:8px; }

  /* Notes */
  .notes-section { background:#f8f9fa; border-radius:8px; padding:14px 16px; margin-bottom:24px; }
  .notes-title { font-size:11px; font-weight:700; color:#888; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px; }

  /* Footer */
  .inv-footer { text-align:center; padding-top:20px; border-top:1px solid #eee; color:#999; font-size:11px; }

  /* Signature area */
  .sig-area { display:grid; grid-template-columns:1fr 1fr; gap:40px; margin-bottom:24px; }
  .sig-box { text-align:center; padding-top:40px; border-top:1px solid #ccc; }
  .sig-label { font-size:11px; color:#888; margin-top:6px; }

  @media print {
    body { print-color-adjust:exact; -webkit-print-color-adjust:exact; }
    .page { padding:20px; }
    .no-print { display:none !important; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Print button -->
  <div class="no-print" style="text-align:center;margin-bottom:20px;display:flex;gap:10px;justify-content:center">
    <button onclick="window.print()" style="background:#1a1a1a;color:#fff;border:none;padding:10px 28px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer">🖨️ طباعة / Print</button>
    <button onclick="window.close()" style="background:#f1f1f1;color:#333;border:1px solid #ddd;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer">✕ إغلاق</button>
  </div>

  <!-- Header -->
  <div class="inv-header">
    <div class="logo-area">
      <div class="logo-placeholder">LOGO</div>
      <div class="company-name">${companyName}</div>
      <div class="company-name-ar">${companyNameAr}</div>
      <div style="font-size:11px;color:#888;margin-top:4px">${companyAddress}</div>
    </div>
    <div class="inv-title-area">
      <div class="inv-title">INVOICE</div>
      <div class="inv-title-ar">فاتورة بيع</div>
      <div class="inv-number"># ${invNo}</div>
    </div>
  </div>

  <!-- Info -->
  <div class="inv-info">
    <div class="info-box">
      <div class="info-box-title">بيانات العميل / Bill To</div>
      <div class="info-row">
        <span class="info-label">العميل / Customer</span>
        <span class="info-value">${customer}</span>
      </div>
      <div class="info-row">
        <span class="info-label">رقم الملف / File No</span>
        <span class="info-value">${fn||'—'}</span>
      </div>
    </div>
    <div class="info-box">
      <div class="info-box-title">بيانات الفاتورة / Invoice Details</div>
      <div class="info-row">
        <span class="info-label">رقم الفاتورة / No</span>
        <span class="info-value" style="color:#c47a00">${invNo}</span>
      </div>
      <div class="info-row">
        <span class="info-label">التاريخ / Date</span>
        <span class="info-value">${new Date(date).toLocaleDateString('en-GB',{year:'numeric',month:'long',day:'numeric'})}</span>
      </div>
      <div class="info-row">
        <span class="info-label">عدد السيارات / Vehicles</span>
        <span class="info-value">${items.length}</span>
      </div>
      ${extraCharges.length>0 ? `<div class="info-row">
        <span class="info-label">مصاريف إضافية</span>
        <span class="info-value" style="color:#c47a00">${extraCharges.length} بند</span>
      </div>` : ''}
    </div>
  </div>

  <!-- Items table -->
  <table>
    <thead>
      <tr>
        <th style="width:40px">#</th>
        <th>السيارة / Vehicle</th>
        <th>رقم الشاصي / VIN</th>
        <th>اللوحة / Plate</th>
        <th>الحجم / Engine</th>
        <th style="text-align:left">السعر / Price</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
      ${subtotalRow}
      ${extraRowsHtml}
    </tbody>
  </table>

  <!-- Total -->
  <div class="total-section">
    <div class="total-box">
      <div class="total-label">الإجمالي / Total Amount</div>
      <div class="total-amount">${finalTotal.toLocaleString('en-US',{minimumFractionDigits:2})}</div>
      <div class="total-currency">KWD / د.ك</div>
      ${extraCharges.length>0 ? `
      <div class="total-sub-row">
        <span>قيمة السيارات</span>
        <span>${total.toLocaleString('en-US',{minimumFractionDigits:2})}</span>
      </div>
      <div class="total-sub-row">
        <span>مصاريف إضافية</span>
        <span>${(finalTotal-total).toLocaleString('en-US',{minimumFractionDigits:2})}</span>
      </div>` : ''}
    </div>
  </div>

  ${notes ? `<div class="notes-section"><div class="notes-title">ملاحظات / Notes</div><p style="color:#444;line-height:1.6">${notes}</p></div>` : ''}

  <!-- Signatures -->
  <div class="sig-area">
    <div class="sig-box">
      <div class="sig-label">توقيع البائع / Seller Signature</div>
    </div>
    <div class="sig-box">
      <div class="sig-label">توقيع المشتري / Buyer Signature</div>
    </div>
  </div>

  <div class="inv-footer">
    ${companyName} · ${companyAddress} · شكراً لتعاملكم معنا · Thank you for your business
  </div>
</div>
</body>
</html>`;

  openPrintOverlay(html);

  // WhatsApp option after print
  setTimeout(() => {
    if (confirm('إرسال الفاتورة عبر واتساب؟')) {
      const phone = prompt('رقم واتساب العميل (مثال: 96512345678)\nاتركه فارغاً لاختيار يدوي:','');
      if (phone !== null) sendWhatsappInvoice({ invNo, customer, date, fn, notes, items, total, extraCharges, grandTotal, phone });
    }
  }, 800);
}

// ════════════════════════════════════════════════════════════
// SECTION 5 — Payout Voucher
// ════════════════════════════════════════════════════════════

async function printPayoutVoucher(payoutId) {
  try {
    const [pArr, dealArr] = await Promise.all([
      apiGetAll('partner_payouts', { select:'*', id:`eq.${payoutId}` }),
      null
    ]);
    const p = pArr?.[0];
    if (!p) { toast('لم يُعثر على بيانات الصرف','err'); return; }

    const poArr = await apiGetAll('purchase_orders', { select:'supplier,po_date,total_purchase', system_type:`eq.${state.system}`, file_no:`eq.${p.file_no}` });
    const deal  = poArr?.[0];
    // Get full deal balance for this partner
    let dealSummary = null;
    try { dealSummary = await getPartnerDealBalance(p.file_no, p.partner, state.system); } catch(e) { console.warn('getPartnerDealBalance:', e.message); }
    const fmt2 = n => (+n||0).toLocaleString('en-US',{minimumFractionDigits:2});
    const typeColor = { 'استرداد رأس مال':'#2563eb', 'توزيع أرباح':'#16a34a', 'رأس مال + أرباح':'#7c3aed', 'سلفة':'#e6930a' };
    const color = typeColor[p.payout_type] || '#1a1a1a';

    const dealBreakdown = dealSummary ? `
      <div style="background:#f8f9fa;border-radius:8px;padding:14px 16px;margin-bottom:20px">
        <div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">ملخص الصفقة — ملف ${p.file_no}</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:10px">
          <div><div style="font-size:10px;color:#888">رأس المال (شراء)</div><div style="font-weight:700;color:#2563eb">${fmt2(dealSummary._totalCost)} KWD</div></div>
          <div><div style="font-size:10px;color:#888">المصاريف</div><div style="font-weight:700;color:#dc2626">${fmt2(dealSummary._totalExp)} KWD</div></div>
          <div><div style="font-size:10px;color:#888">المبيعات</div><div style="font-weight:700;color:#16a34a">${fmt2(dealSummary._totalSales)} KWD</div></div>
        </div>
        <div style="border-top:1px solid #e5e7eb;padding-top:10px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
          <div><div style="font-size:10px;color:#888">رأس المال المدفوع (حصتي)</div><div style="font-weight:700;color:#2563eb">${fmt2(dealSummary.capitalPaid)} KWD</div></div>
          <div><div style="font-size:10px;color:#888">الربح المستحق (حصتي)</div><div style="font-weight:700;color:${dealSummary.profit>=0?'#16a34a':'#dc2626'}">${fmt2(Math.abs(dealSummary.profit))} KWD</div></div>
          <div><div style="font-size:10px;color:#888">المسحوبات السابقة</div><div style="font-weight:700;color:#e6930a">${fmt2(dealSummary.totalWithdrawn)} KWD</div></div>
        </div>
      </div>` : '';

    const splitRows = [];
    if (+p.capital_amount) splitRows.push(`<tr><td>رأس مال مُسترد</td><td style="font-weight:700;color:#2563eb">${(+p.capital_amount).toLocaleString('en-US',{minimumFractionDigits:2})} KWD</td></tr>`);
    if (+p.profit_amount)  splitRows.push(`<tr><td>أرباح موزعة</td><td style="font-weight:700;color:#16a34a">${(+p.profit_amount).toLocaleString('en-US',{minimumFractionDigits:2})} KWD</td></tr>`);
    if (+p.advance_amount) splitRows.push(`<tr><td>سلفة</td><td style="font-weight:700;color:#e6930a">${(+p.advance_amount).toLocaleString('en-US',{minimumFractionDigits:2})} KWD</td></tr>`);

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>سند صرف ${p.pay_id||payoutId}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Cairo',Arial,sans-serif;color:#1a1a1a;background:#fff;font-size:13px}
  .page{max-width:700px;margin:0 auto;padding:32px 36px}
  .no-print{text-align:center;margin-bottom:20px;display:flex;gap:10px;justify-content:center}
  .no-print button{padding:10px 28px;border-radius:8px;font-family:'Cairo',sans-serif;font-size:14px;font-weight:700;cursor:pointer;border:none}
  /* Header */
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:18px;border-bottom:3px solid #1a1a1a}
  .company-name{font-size:22px;font-weight:900}
  .company-sub{font-size:12px;color:#888;margin-top:3px}
  .voucher-title{text-align:left}
  .voucher-title h1{font-size:26px;font-weight:900;letter-spacing:-0.5px}
  .voucher-title .pay-id{font-size:15px;font-weight:700;color:${color};margin-top:6px;letter-spacing:1px}
  /* Info grid */
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:22px}
  .info-box{background:#f8f9fa;border-radius:8px;padding:14px 16px}
  .info-box-title{font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
  .info-row{display:flex;justify-content:space-between;padding:3px 0;font-size:13px}
  .info-label{color:#666}
  .info-value{font-weight:700;color:#1a1a1a}
  /* Amount box */
  .amount-box{background:#1a1a1a;color:#fff;border-radius:10px;padding:20px 28px;text-align:center;margin-bottom:22px}
  .amount-label{font-size:12px;color:#aaa;margin-bottom:6px}
  .amount-value{font-size:32px;font-weight:900;letter-spacing:-1px}
  .amount-currency{font-size:13px;color:#aaa;margin-top:4px}
  .amount-type{display:inline-block;background:${color};color:#fff;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700;margin-top:8px}
  /* Split table */
  .split-table{width:100%;border-collapse:collapse;margin-bottom:22px}
  .split-table td{padding:8px 14px;border-bottom:1px solid #eee}
  .split-table td:last-child{text-align:left}
  /* Notes */
  .notes-box{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin-bottom:22px}
  .notes-label{font-size:10px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
  /* Signatures */
  .sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-bottom:28px}
  .sig-box{text-align:center;padding-top:44px;border-top:1px solid #ccc}
  .sig-label{font-size:11px;color:#888;margin-top:6px}
  /* Footer */
  .footer{text-align:center;padding-top:16px;border-top:1px solid #eee;color:#bbb;font-size:10px}
  @media print{
    body{print-color-adjust:exact;-webkit-print-color-adjust:exact}
    .page{padding:16px}
    .no-print{display:none!important}
  }
</style>
</head>
<body>
<div class="page">

  <div class="no-print">
    <button onclick="window.print()" style="background:#1a1a1a;color:#fff">🖨️ طباعة</button>
    <button onclick="window.close()" style="background:#f1f1f1;color:#333;border:1px solid #ddd">✕ إغلاق</button>
  </div>

  <div class="hdr">
    <div>
      <div class="company-name">Transit Cars</div>
      <div class="company-sub">ترانزيت للسيارات · الكويت</div>
    </div>
    <div class="voucher-title">
      <h1>سند صرف شريك</h1>
      <div class="pay-id"># ${p.pay_id||payoutId}</div>
    </div>
  </div>

  ${dealBreakdown}

  <div class="info-grid">
    <div class="info-box">
      <div class="info-box-title">بيانات الشريك</div>
      <div class="info-row"><span class="info-label">اسم الشريك</span><span class="info-value">${p.partner||'—'}</span></div>
      <div class="info-row"><span class="info-label">رقم الملف</span><span class="info-value">${p.file_no||'—'}</span></div>
      ${deal ? `<div class="info-row"><span class="info-label">المورد</span><span class="info-value">${deal.supplier||'—'}</span></div>` : ''}
    </div>
    <div class="info-box">
      <div class="info-box-title">بيانات الدفع</div>
      <div class="info-row"><span class="info-label">التاريخ</span><span class="info-value">${p.pay_date||'—'}</span></div>
      <div class="info-row"><span class="info-label">طريقة الدفع</span><span class="info-value">${p.pay_method||'—'}</span></div>
      ${p.document ? `<div class="info-row"><span class="info-label">رقم المستند</span><span class="info-value">${p.document}</span></div>` : ''}
    </div>
  </div>

  <div class="amount-box">
    <div class="amount-label">المبلغ الإجمالي</div>
    <div class="amount-value">${(+p.amount).toLocaleString('en-US',{minimumFractionDigits:2})}</div>
    <div class="amount-currency">KWD — دينار كويتي</div>
    <div><span class="amount-type">${p.payout_type||'صرف'}</span></div>
  </div>

  ${splitRows.length > 1 ? `
  <table class="split-table">
    <tr style="background:#f8f9fa"><td colspan="2" style="padding:8px 14px;font-weight:700;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px">تفاصيل التوزيع</td></tr>
    ${splitRows.join('')}
  </table>` : ''}

  ${p.notes ? `
  <div class="notes-box">
    <div class="notes-label">ملاحظات</div>
    <div>${p.notes}</div>
  </div>` : ''}

  <div class="sig-grid">
    <div class="sig-box">
      <div class="sig-label">توقيع المستلم (الشريك)</div>
      <div style="font-size:12px;color:#1a1a1a;margin-top:4px">${p.partner||''}</div>
    </div>
    <div class="sig-box">
      <div class="sig-label">توقيع المُصدِر</div>
    </div>
  </div>

  <div class="footer">
    تم إنشاؤه بتاريخ ${new Date().toLocaleDateString('en-GB')} · Transit Cars System
  </div>

</div>
</body></html>`;

    openPrintOverlay(html);

  } catch(e) { toast('خطأ في الطباعة: '+e.message,'err'); }
}

// ════════════════════════════════════════════════════════════
// SECTION 6 — Accounting Reports (Purchase Order / Reports / TB / Vehicles / Partner)
// ════════════════════════════════════════════════════════════

async function printPurchaseOrder(fileNo) {
  try {
    const sys = state.system;
    const [poArr, vehicles, partners, payments, expenses] = await Promise.all([
      apiGetAll('purchase_orders', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGetAll('vehicles',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGetAll('partners_master', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGetAll('payments',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, order:'pay_date.asc' }),
      apiGetAll('expenses',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}`, order:'exp_date.asc' }),
    ]);
    const po         = poArr?.[0] || {};
    const totalPaid  = (payments||[]).reduce((s,p)=>s+(+p.amount||0),0);
    const totalExp   = (expenses||[]).reduce((s,e)=>s+(+e.amount||0),0);
    const remaining  = (+po.total_purchase||0) - totalPaid;
    const fmt2 = n => (+n||0).toLocaleString('en-US',{minimumFractionDigits:2});

    const vehicleRows = (vehicles||[]).map((v,i) => `<tr>
      <td style="text-align:center;font-weight:700">${i+1}</td>
      <td>${v.vehicle_type||'—'} ${v.model||''}</td>
      <td style="direction:ltr;font-family:monospace;font-size:11px;font-weight:700">${v.vin||'—'}</td>
      <td style="direction:ltr">${v.plate||'—'}</td>
      <td>${v.color||'—'}</td>
      <td style="text-align:center">${v.engine_size?v.engine_size+' L':'—'}</td>
      <td style="text-align:center">${v.year||'—'}</td>
      <td class="amber" style="text-align:left">${fmt2(v.purchase_price)}</td>
    </tr>`).join('');

    const paymentRows = (payments||[]).map(p => `<tr>
      <td style="font-size:10px;color:#2563eb;font-weight:700">${p.ref_no||'—'}</td>
      <td>${p.payer||'—'}</td>
      <td class="green" style="text-align:left">${fmt2(p.amount)}</td>
      <td>${p.pay_method||'—'}</td>
      <td style="direction:ltr">${p.document||'—'}</td>
      <td>${p.pay_date||'—'}</td>
    </tr>`).join('');

    const expenseRows = (expenses||[]).map(e => `<tr>
      <td style="font-size:10px;color:#dc2626;font-weight:700">${e.ref_no||'—'}</td>
      <td>${e.description||'—'}</td>
      <td>${e.exp_type||'—'}</td>
      <td class="red" style="text-align:left">${fmt2(e.amount)}</td>
      <td>${e.pay_method||'—'}</td>
      <td>${e.exp_date||e.expense_date||'—'}</td>
    </tr>`).join('');

    const partnerRows = (partners||[]).map(p => {
      const paid = (payments||[]).filter(pm=>pm.payer===p.partner).reduce((s,pm)=>s+(+pm.amount||0),0);
      const due  = (+po.total_purchase||0) * (+p.share_percent||0) / 100;
      return `<tr>
        <td style="font-weight:700">${p.partner}</td>
        <td style="text-align:center">${p.share_percent}%</td>
        <td class="blue" style="text-align:left">${fmt2(due)}</td>
        <td class="green" style="text-align:left">${fmt2(paid)}</td>
        <td class="${(due-paid)>0.01?'red':'green'}" style="text-align:left;font-weight:700">${fmt2(due-paid)}</td>
      </tr>`;
    }).join('');

    const html = `
      ${docHeader('سند شراء', 'Purchase Order', fileNo)}

      <div class="kpi-row" style="grid-template-columns:repeat(4,1fr)">
        <div class="kpi-box"><div class="kpi-label">قيمة الصفقة</div><div class="kpi-val amber">${fmt2(po.total_purchase)} KWD</div></div>
        <div class="kpi-box" style="border-color:#16a34a"><div class="kpi-label">المدفوع للمورد</div><div class="kpi-val green">${fmt2(totalPaid)} KWD</div></div>
        <div class="kpi-box" style="border-color:${remaining>0?'#dc2626':'#16a34a'}"><div class="kpi-label">المتبقي</div><div class="kpi-val ${remaining>0?'red':'green'}">${fmt2(remaining)} KWD</div></div>
        <div class="kpi-box" style="border-color:#7c3aed"><div class="kpi-label">المصاريف</div><div class="kpi-val" style="color:#7c3aed">${fmt2(totalExp)} KWD</div></div>
      </div>

      <div class="info-grid">
        <div class="info-box">
          <div class="info-row"><span class="info-label">رقم الملف</span><span class="info-val amber">${po.file_no||'—'}</span></div>
          <div class="info-row"><span class="info-label">المورد</span><span class="info-val">${po.supplier||'—'}</span></div>
          <div class="info-row"><span class="info-label">رقم PO</span><span class="info-val" style="direction:ltr">${po.po_no||'—'}</span></div>
          <div class="info-row"><span class="info-label">تاريخ الصفقة</span><span class="info-val">${po.po_date||'—'}</span></div>
          <div class="info-row"><span class="info-label">الحالة</span><span class="info-val">${po.status||'—'}</span></div>
        </div>
        <div class="info-box">
          <div class="info-row"><span class="info-label">عدد السيارات</span><span class="info-val">${(vehicles||[]).length} سيارة</span></div>
          <div class="info-row"><span class="info-label">عدد الشركاء</span><span class="info-val">${(partners||[]).length} شريك</span></div>
          <div class="info-row"><span class="info-label">عدد الدفعات</span><span class="info-val">${(payments||[]).length} دفعة</span></div>
          <div class="info-row"><span class="info-label">عدد المصاريف</span><span class="info-val">${(expenses||[]).length} بند</span></div>
          <div class="info-row"><span class="info-label">تاريخ الطباعة</span><span class="info-val">${new Date().toLocaleDateString('en-GB')}</span></div>
        </div>
      </div>

      <div class="section-title">📦 السيارات / Vehicles</div>
      <table>
        <thead><tr><th>#</th><th>النوع / الموديل</th><th>رقم الشاصي (VIN)</th><th>اللوحة</th><th>اللون</th><th>الحجم</th><th>السنة</th><th>سعر الشراء</th></tr></thead>
        <tbody>${vehicleRows}</tbody>
        <tfoot><tr>
          <td colspan="6" style="padding:8px 10px"><strong>إجمالي قيمة الشراء</strong></td>
          <td class="amber" style="text-align:left"><strong>${fmt2(po.total_purchase)} KWD</strong></td>
        </tr></tfoot>
      </table>

      ${partners?.length ? `
      <div class="section-title">👥 الشركاء / Partners</div>
      <table>
        <thead><tr><th>الشريك</th><th>الحصة %</th><th>المستحق</th><th>المدفوع</th><th>المتبقي</th></tr></thead>
        <tbody>${partnerRows}</tbody>
      </table>` : ''}

      ${payments?.length ? `
      <div class="section-title">💳 دفعات المورد / Payments</div>
      <table>
        <thead><tr><th>رقم الدفعة</th><th>الدافع</th><th>المبلغ</th><th>طريقة الدفع</th><th>المستند</th><th>التاريخ</th></tr></thead>
        <tbody>${paymentRows}</tbody>
        <tfoot><tr>
          <td colspan="2"><strong>الإجمالي المدفوع</strong></td>
          <td class="green" style="text-align:left"><strong>${fmt2(totalPaid)} KWD</strong></td>
          <td colspan="3"></td>
        </tr></tfoot>
      </table>` : ''}

      ${expenses?.length ? `
      <div class="section-title">💸 المصاريف / Expenses</div>
      <table>
        <thead><tr><th>رقم المصروف</th><th>البيان</th><th>النوع</th><th>المبلغ</th><th>طريقة الدفع</th><th>التاريخ</th></tr></thead>
        <tbody>${expenseRows}</tbody>
        <tfoot><tr>
          <td colspan="3"><strong>إجمالي المصاريف</strong></td>
          <td class="red" style="text-align:left"><strong>${fmt2(totalExp)} KWD</strong></td>
          <td colspan="2"></td>
        </tr></tfoot>
      </table>` : ''}

      ${po.notes ? `<div style="margin:12px 0;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px"><strong>ملاحظات:</strong> ${po.notes}</div>` : ''}

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:32px;margin-top:32px">
        <div style="text-align:center;padding-top:44px;border-top:1px solid #ccc">
          <div style="font-size:11px;color:#888">توقيع المورد</div>
          <div style="font-size:12px;font-weight:700;margin-top:4px">${po.supplier||''}</div>
        </div>
        <div style="text-align:center;padding-top:44px;border-top:1px solid #ccc">
          <div style="font-size:11px;color:#888">توقيع المدير</div>
        </div>
        <div style="text-align:center;padding-top:44px;border-top:1px solid #ccc">
          <div style="font-size:11px;color:#888">توقيع المحاسب</div>
        </div>
      </div>

      <div class="footer">Transit Cars · نظام ترانزيت لإدارة صفقات السيارات</div>`;

    printDocument(html, `سند شراء — ${fileNo}`);
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

async function printCurrentReport() {
  const type = reportState.type;
  const from = el('r-from').value;
  const to   = el('r-to').value;
  const data = reportState.data || [];
  if (!data.length) { toast('لا توجد بيانات للطباعة','err'); return; }

  const titles = { profit:'تقرير الأرباح والخسائر', sales:'تقرير المبيعات', expenses:'تقرير المصاريف', partners:'تقرير الشركاء' };
  let tableHtml = '';

  if (type === 'profit') {
    const rows = data.map(d=>`<tr>
      <td>${d.file}</td>
      <td class="green">${fmt(d.sales)}</td>
      <td class="red">${fmt(d.expenses)}</td>
      <td class="amber">${fmt(d.payments)}</td>
      <td class="${d.profit>=0?'green':'red'}">${fmt(d.profit)}</td>
    </tr>`).join('');
    const totProfit = data.reduce((s,d)=>s+d.profit,0);
    tableHtml = `<table>
      <thead><tr><th>الملف</th><th>مبيعات</th><th>مصاريف</th><th>دفعات مورد</th><th>صافي ربح</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td><strong>الإجمالي</strong></td><td></td><td></td><td></td><td class="${totProfit>=0?'green':'red'}"><strong>${fmt(totProfit)}</strong></td></tr></tfoot>
    </table>`;
  } else if (type === 'sales') {
    tableHtml = `<table>
      <thead><tr><th>التاريخ</th><th>الملف</th><th>VIN</th><th>العميل</th><th>السعر</th></tr></thead>
      <tbody>${data.map(s=>`<tr><td>${s.sale_date||''}</td><td>${s.file_no||''}</td><td style="direction:ltr">${s.vin||''}</td><td>${s.customer||''}</td><td class="green">${fmt(s.sale_price)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="4"><strong>الإجمالي</strong></td><td class="green"><strong>${fmt(data.reduce((s,r)=>s+(+r.sale_price||0),0))}</strong></td></tr></tfoot>
    </table>`;
  } else if (type === 'expenses') {
    tableHtml = `<table>
      <thead><tr><th>التاريخ</th><th>الملف</th><th>البيان</th><th>النوع</th><th>المبلغ</th></tr></thead>
      <tbody>${data.map(e=>`<tr><td>${e.exp_date||e.expense_date||e.created_at?.split('T')[0]||''}</td><td>${e.file_no||''}</td><td>${e.description||''}</td><td>${e.category||e.exp_type||''}</td><td class="red">${fmt(e.amount)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="4"><strong>الإجمالي</strong></td><td class="red"><strong>${fmt(data.reduce((s,r)=>s+(+r.amount||0),0))}</strong></td></tr></tfoot>
    </table>`;
  } else if (type === 'partners') {
    tableHtml = `<table>
      <thead><tr><th>التاريخ</th><th>الملف</th><th>الشريك</th><th>النوع</th><th>المبلغ</th></tr></thead>
      <tbody>${data.map(p=>`<tr><td>${p.pay_date||''}</td><td>${p.file_no||''}</td><td>${p.partner||''}</td><td>${p.payout_type||''}</td><td class="amber">${fmt(p.amount)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="4"><strong>الإجمالي</strong></td><td class="amber"><strong>${fmt(data.reduce((s,r)=>s+(+r.amount||0),0))}</strong></td></tr></tfoot>
    </table>`;
  }

  const html = `
    ${docHeader(titles[type], `من ${from} إلى ${to}`, '')}
    ${tableHtml}
    <div class="footer">Transit International · ${titles[type]} · ${from} — ${to}</div>`;
  printDocument(html, titles[type]);
}

function printTrialBalance() {
  const data = trialState.data || [];
  if (!data.length) { toast('لا توجد بيانات','err'); return; }
  // trialState.data fields: {code, name, type, dr, cr}
  const typeLabelsAr = {
    asset:'أصول', liability:'التزامات', equity:'حقوق ملكية',
    revenue:'إيرادات', cogs:'تكلفة', expense:'مصروفات', other:'أخرى',
    customer:'عميل', supplier:'مورد', partner:'شريك', custodian:'عهدة'
  };
  const rows = data.map(c => {
    const bal = c.dr - c.cr;
    return `<tr>
    <td class="mono" style="color:#e6930a;font-weight:700">${c.code||'—'}</td>
    <td>${c.name}</td>
    <td>${typeLabelsAr[c.type]||c.type}</td>
    <td class="green">${fmt(c.dr)}</td>
    <td class="red">${fmt(c.cr)}</td>
    <td class="${bal>=0?'green':'red'}">${fmt(Math.abs(bal))} ${bal>0?'مدين':bal<0?'دائن':'صفر'}</td>
  </tr>`;
  }).join('');
  const sumD = data.reduce((s,c)=>s+c.dr,0);
  const sumC = data.reduce((s,c)=>s+c.cr,0);
  const sumB = sumD - sumC;
  const html = `
    ${docHeader('ميزان المراجعة','Trial Balance','')}
    <table>
      <thead><tr><th>الكود</th><th>اسم الحساب</th><th>النوع</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="3"><strong>الإجمالي (${data.length} حساب)</strong></td>
        <td class="green"><strong>${fmt(sumD)}</strong></td>
        <td class="red"><strong>${fmt(sumC)}</strong></td>
        <td class="${sumB>=0?'green':'red'}"><strong>${fmt(Math.abs(sumB))} ${sumB>0?'مدين':sumB<0?'دائن':'✓ متوازن'}</strong></td>
      </tr></tfoot>
    </table>
    <div class="footer">Transit International · ميزان المراجعة · ${new Date().toLocaleDateString('en-GB')}</div>`;
  printDocument(html, 'ميزان المراجعة');
}

function printVehiclesReport() {
  const list = vrState.filtered || vrState.all;
  if (!list.length) { toast('لا توجد بيانات','err'); return; }
  const rows = list.map((v,i) => `<tr>
    <td>${v._code}</td><td>${v.file_no||'—'}</td><td>${v._supplier}</td>
    <td>${v.vehicle_type||'—'}</td><td>${v.model||'—'}</td><td>${v.year||'—'}</td>
    <td style="direction:ltr">${v.vin||'—'}</td><td style="direction:ltr">${v.plate||'—'}</td>
    <td>${v.color||'—'}</td><td>${v.engine_size||'—'}</td>
    <td>${(+v.purchase_price||0).toLocaleString('en-US',{minimumFractionDigits:2})}</td>
    <td>${v.license_expiry||'—'}</td>
    <td>${v._sold?'مباع':'في المخزن'}</td>
    <td>${v._warehouse||'—'}</td>
    <td>${v._saleInfo?.customer||'—'}</td>
  </tr>`).join('');
  const html = `
    ${docHeader('تقرير السيارات','Vehicles Report','')}
    <table>
      <thead><tr><th>الكود</th><th>الملف</th><th>المورد</th><th>النوع</th><th>الموديل</th>
      <th>السنة</th><th>VIN</th><th>اللوحة</th><th>اللون</th><th>الحجم</th>
      <th>السعر</th><th>انتهاء الرخصة</th><th>الحالة</th><th>المخزن</th><th>العميل</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="footer">Transit International · تقرير السيارات · ${new Date().toLocaleDateString('en-GB')}</div>`;
  printDocument(html, 'تقرير السيارات');
}

function printPartnerStatement() {
  const content = document.getElementById('partnerStatementContent');
  if (!content) return;
  openPrintOverlay(`<!DOCTYPE html><html dir="rtl"><head>    <meta charset="UTF-8">    <title>كشف حساب شريك</title>    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">    <style>      *{box-sizing:border-box;margin:0;padding:0}      body{font-family:'Cairo',sans-serif;direction:rtl;background:#fff;padding:20px;font-size:12px;color:#1a1a2e}      @media print{body{padding:10px}@page{margin:15mm;size:A4}}      table{border-collapse:collapse;width:100%}      th,td{padding:6px 8px}    </style>  </head><body>${content.outerHTML}<script>window.onload=()=>window.print()<\/script></body></html>`);

}

// ════════════════════════════════════════════════════════════
// SECTION 7 — Journal Voucher + Section Print + _jPrint helper
// ════════════════════════════════════════════════════════════

async function printJournalVoucher(entryNo, entryType, fileNo, amount, date, title) {
  try {
    // جلب كل أسطر هذا القيد
    const lines = entryNo
      ? await apiGet('journal_entries', {
          select: 'account_code,account_name,dr_amount,cr_amount,description',
          system_type: `eq.${state.system}`,
          entry_no: `eq.${entryNo}`,
          order: 'id.asc',
        })
      : [];

    const typeLabelsVoucher = {
      purchase:'سند شراء', sale:'سند بيع', collection:'سند تحصيل',
      expense:'سند مصروف', payment:'سند دفع', payout:'سند صرف شريك', journal:'قيد يومية'
    };
    const voucherTitle = typeLabelsVoucher[entryType] || 'سند قيد';
    const printDate    = new Date().toLocaleDateString('ar-EG', { year:'numeric', month:'long', day:'numeric' });
    const voucherDate  = date ? new Date(date).toLocaleDateString('ar-EG', { year:'numeric', month:'long', day:'numeric' }) : '—';

    const totalDr = (lines||[]).reduce((s,l)=>s+(+l.dr_amount||0),0);
    const totalCr = (lines||[]).reduce((s,l)=>s+(+l.cr_amount||0),0);

    const linesHtml = (lines||[]).map((l,i) => `
      <tr>
        <td style="text-align:center;color:#666;font-size:11px">${i+1}</td>
        <td style="font-family:monospace;font-weight:700;color:#1a1a1a">${l.account_code||'—'}</td>
        <td>${l.account_name||'—'}</td>
        <td style="font-size:11px;color:#666">${l.description||'—'}</td>
        <td style="text-align:left;font-weight:700;color:#16a34a">${+l.dr_amount>0 ? (+l.dr_amount).toLocaleString('en-US',{minimumFractionDigits:3}) : '—'}</td>
        <td style="text-align:left;font-weight:700;color:#dc2626">${+l.cr_amount>0 ? (+l.cr_amount).toLocaleString('en-US',{minimumFractionDigits:3}) : '—'}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>${voucherTitle} — ${entryNo}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Segoe UI',Arial,sans-serif; color:#1a1a1a; font-size:13px; background:#fff; }
  .page { max-width:780px; margin:0 auto; padding:32px 36px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px; padding-bottom:16px; border-bottom:2px solid #1a1a1a; }
  .company { font-size:20px; font-weight:800; }
  .company-sub { font-size:12px; color:#666; margin-top:4px; }
  .voucher-title { text-align:left; }
  .voucher-title h1 { font-size:22px; font-weight:800; color:#1a1a1a; }
  .voucher-no { font-size:14px; font-weight:700; color:#c47a00; margin-top:4px; font-family:monospace; }
  .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:20px; }
  .info-box { background:#f8f9fa; border-radius:8px; padding:12px 14px; }
  .info-row { display:flex; justify-content:space-between; padding:3px 0; font-size:12px; border-bottom:1px solid #eee; }
  .info-row:last-child { border:none; }
  .info-label { color:#888; }
  .info-val { font-weight:700; }
  table { width:100%; border-collapse:collapse; margin-bottom:16px; }
  thead tr { background:#1a1a1a; color:#fff; }
  thead th { padding:9px 10px; font-size:11px; font-weight:700; text-align:right; }
  tbody tr { border-bottom:1px solid #eee; }
  tbody tr:nth-child(even) { background:#fafafa; }
  tbody td { padding:9px 10px; vertical-align:middle; }
  tfoot tr { background:#f0f0f0; font-weight:700; }
  tfoot td { padding:9px 10px; border-top:2px solid #1a1a1a; }
  .total-box { display:flex; justify-content:flex-end; margin-bottom:20px; }
  .total-inner { background:#1a1a1a; color:#fff; border-radius:10px; padding:14px 20px; min-width:220px; }
  .total-label { font-size:11px; color:#aaa; margin-bottom:3px; }
  .total-amount { font-size:20px; font-weight:900; }
  .balanced { font-size:11px; color:#4ade80; margin-top:4px; }
  .sig-row { display:grid; grid-template-columns:1fr 1fr 1fr; gap:30px; margin-top:30px; }
  .sig-box { text-align:center; padding-top:36px; border-top:1px solid #ccc; font-size:11px; color:#888; }
  .footer { text-align:center; margin-top:20px; padding-top:12px; border-top:1px solid #eee; font-size:10px; color:#aaa; }
  .no-print { text-align:center; margin-bottom:20px; display:flex; gap:10px; justify-content:center; }
  @media print { .no-print { display:none!important; } body { print-color-adjust:exact; -webkit-print-color-adjust:exact; } }
</style>
</head>
<body>
<div class="page">
  <div class="no-print">
    <button onclick="window.print()" style="background:#1a1a1a;color:#fff;border:none;padding:9px 24px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">🖨️ طباعة</button>
    <button onclick="window.close()" style="background:#f1f1f1;color:#333;border:1px solid #ddd;padding:9px 18px;border-radius:8px;font-size:13px;cursor:pointer">✕ إغلاق</button>
  </div>

  <div class="header">
    <div>
      <div class="company">Transit Co. · ترانزيت</div>
      <div class="company-sub">Kuwait · الكويت</div>
    </div>
    <div class="voucher-title">
      <h1>${voucherTitle}</h1>
      <div class="voucher-no"># ${entryNo||'—'}</div>
    </div>
  </div>

  <div class="info-grid">
    <div class="info-box">
      <div class="info-row"><span class="info-label">رقم السند</span><span class="info-val" style="color:#c47a00;font-family:monospace">${entryNo||'—'}</span></div>
      <div class="info-row"><span class="info-label">نوع العملية</span><span class="info-val">${voucherTitle}</span></div>
      <div class="info-row"><span class="info-label">تاريخ العملية</span><span class="info-val">${voucherDate}</span></div>
    </div>
    <div class="info-box">
      <div class="info-row"><span class="info-label">رقم الملف</span><span class="info-val" style="font-family:monospace">${fileNo||'—'}</span></div>
      <div class="info-row"><span class="info-label">البيان</span><span class="info-val">${title||'—'}</span></div>
      <div class="info-row"><span class="info-label">تاريخ الطباعة</span><span class="info-val">${printDate}</span></div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:36px">#</th>
        <th style="width:80px">كود الحساب</th>
        <th>اسم الحساب</th>
        <th>البيان</th>
        <th style="text-align:left">مدين (Dr)</th>
        <th style="text-align:left">دائن (Cr)</th>
      </tr>
    </thead>
    <tbody>${linesHtml||`<tr><td colspan="6" style="text-align:center;color:#888;padding:20px">لا توجد تفاصيل — المبلغ الإجمالي: ${amount?.toLocaleString?.('en-US',{minimumFractionDigits:3})||'—'}</td></tr>`}</tbody>
    <tfoot>
      <tr>
        <td colspan="4" style="text-align:right;font-weight:700">الإجمالي</td>
        <td style="text-align:left;color:#16a34a">${totalDr.toLocaleString('en-US',{minimumFractionDigits:3})}</td>
        <td style="text-align:left;color:#dc2626">${totalCr.toLocaleString('en-US',{minimumFractionDigits:3})}</td>
      </tr>
    </tfoot>
  </table>

  <div class="total-box">
    <div class="total-inner">
      <div class="total-label">إجمالي القيد / Total</div>
      <div class="total-amount">${(totalDr||amount||0).toLocaleString('en-US',{minimumFractionDigits:3})}</div>
      <div class="total-currency" style="font-size:11px;color:#aaa">KWD / د.ك</div>
      ${Math.abs(totalDr-totalCr)<0.01 ? '<div class="balanced">✓ القيد متوازن</div>' : '<div style="color:#f87171;font-size:11px">⚠ القيد غير متوازن</div>'}
    </div>
  </div>

  <div class="sig-row">
    <div class="sig-box">المحاسب / Accountant</div>
    <div class="sig-box">المراجع / Reviewer</div>
    <div class="sig-box">المدير / Manager</div>
  </div>

  <div class="footer">Transit Cars System · ${printDate} · رقم السند: ${entryNo||'—'}</div>
</div>
</body>
</html>`;

    openPrintOverlay(html);
  } catch(e) {
    toast('خطأ في طباعة القيد: ' + e.message, 'err');
  }
}

function printSection(title, subtitle, tableHtml, summaryHtml='') {
  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Cairo',Arial,sans-serif;color:#1a1a1a;font-size:12px;background:#fff}
  .page{max-width:900px;margin:0 auto;padding:28px 32px}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1a1a1a;padding-bottom:16px;margin-bottom:20px}
  .co-name{font-size:20px;font-weight:900} .co-sub{font-size:11px;color:#888;margin-top:2px}
  .rep-title{text-align:left} .rep-title h1{font-size:22px;font-weight:900}
  .rep-title .sub{font-size:12px;color:#666;margin-top:4px}
  .summary{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}
  .s-box{background:#f8f9fa;border-radius:8px;padding:10px 16px;flex:1;min-width:120px}
  .s-box-label{font-size:10px;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
  .s-box-val{font-size:16px;font-weight:900;margin-top:3px}
  table{width:100%;border-collapse:collapse;margin-bottom:16px}
  thead tr{background:#1a1a1a;color:#fff}
  thead th{padding:9px 10px;font-size:11px;font-weight:700;text-align:right}
  tbody tr:nth-child(even){background:#fafafa}
  tbody td{padding:8px 10px;border-bottom:1px solid #eee;vertical-align:middle}
  tfoot td{padding:9px 10px;background:#f0f2f5;font-weight:700}
  .footer{text-align:center;padding-top:12px;border-top:1px solid #eee;color:#aaa;font-size:10px;margin-top:12px}
  .no-print{text-align:center;margin-bottom:16px;display:flex;gap:8px;justify-content:center}
  .no-print button{padding:9px 24px;border-radius:8px;font-family:'Cairo',sans-serif;font-size:13px;font-weight:700;cursor:pointer;border:none}
  @media print{.no-print{display:none!important}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
</style>
</head>
<body><div class="page">
  <div class="no-print">
    <button onclick="window.print()" style="background:#1a1a1a;color:#fff">🖨️ طباعة</button>
    <button onclick="window.close()" style="background:#f1f1f1;color:#333;border:1px solid #ddd">✕ إغلاق</button>
  </div>
  <div class="hdr">
    <div><div class="co-name">Transit Cars</div><div class="co-sub">ترانزيت للسيارات · الكويت</div></div>
    <div class="rep-title"><h1>${title}</h1><div class="sub">${subtitle}</div></div>
  </div>
  ${summaryHtml}
  ${tableHtml}
  <div class="footer">تم الإنشاء بتاريخ ${new Date().toLocaleDateString('en-GB')} · Transit Cars System</div>
</div></body></html>`;
  openPrintOverlay(html, title);
}

function _jPrint(btn) {
  const p = btn.closest('.j-entry-actions') || btn.parentElement;
  printJournalVoucher(
    p.dataset.eno   || '',
    p.dataset.etype || '',
    p.dataset.fno   || '',
    parseFloat(p.dataset.amt) || 0,
    p.dataset.date  || '',
    p.dataset.etitle|| ''
  );
}

// ════════════════════════════════════════════════════════════
// SECTION 8 — Contact Ledger Statement
// ════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════
// SECTION 9 — Deal Statement
// ════════════════════════════════════════════════════════════

async function printDealStatement(fileNo) {
  // لو فيه fileNo → جيب البيانات مباشرة
  // لو مفيش → استخدم _dealStatementData المحفوظ
  let d = window._dealStatementData;
  if (fileNo && (!d || d.fn !== fileNo)) {
    toast('⏳ جاري تحميل كشف الصفقة...', 'ok');
    try {
      await loadDealStatement(fileNo, state.system);
      d = window._dealStatementData;
    } catch(e) { toast('خطأ: ' + e.message, 'err'); return; }
  }
  if (!d) { toast('افتح كشف الصفقة أولاً', 'err'); return; }
  const { fn, deal, entries, totalPurchase, totalPaid, totalExp, totalSales, totalColl, profit } = d;
  let running = 0;
  const rows = entries.map(e => {
    if(e._pl) { if(e.debit>0) running+=e.debit; if(e.credit>0) running-=e.credit; }
    const infoNote = !e._pl ? ' *' : '';
    return `<tr><td>${e.date||'—'}</td><td>${e.type}${infoNote}</td><td><b>${e.desc}</b>${e.extra?'<br><small>'+e.extra+'</small>':''}</td>
    <td>${e.party}</td>
    <td style="text-align:left;color:green">${e.debit>0?e.debit.toLocaleString('en-US',{minimumFractionDigits:2}):'—'}</td>
    <td style="text-align:left;color:red">${e.credit>0?e.credit.toLocaleString('en-US',{minimumFractionDigits:2}):'—'}</td>
    <td style="text-align:left;font-weight:700;color:${e._pl?(running>=0?'green':'red'):'gray'}">${e._pl?Math.abs(running).toLocaleString('en-US',{minimumFractionDigits:2}):'—'}</td></tr>`;
  }).join('');
  const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>كشف الصفقة ${fn}</title>
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;padding:20px}
  h2{margin-bottom:4px}.sub{color:#666;margin-bottom:16px}
  .kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:16px}
  .kpi{border:1px solid #ddd;border-radius:6px;padding:8px;text-align:center}
  .kpi div:first-child{font-size:10px;color:#666}.kpi div:last-child{font-weight:700;font-size:13px}
  table{width:100%;border-collapse:collapse}th{background:#f0f0f0;padding:7px 10px;font-size:11px;border:1px solid #ddd;text-align:right}
  td{padding:6px 10px;border:1px solid #eee;font-size:11px}tr:nth-child(even){background:#fafafa}
  @media print{@page{size:A4 landscape}}</style></head><body>
  <div style="display:flex;justify-content:space-between;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #000">
    <div><h2>كشف الصفقة — ${fn}</h2><div class="sub">المورد: ${deal.supplier||'—'} · تاريخ: ${deal.po_date||'—'}</div></div>
    <div style="text-align:left;font-size:11px;color:#666">Transit Co.<br>${new Date().toLocaleDateString('en-GB')}</div>
  </div>
  <div class="kpis">
    <div class="kpi"><div>تكلفة الشراء</div><div style="color:#2563eb">${totalPurchase.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
    <div class="kpi"><div>المدفوع</div><div style="color:#0891b2">${totalPaid.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
    <div class="kpi"><div>المصاريف</div><div style="color:#dc2626">${totalExp.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
    <div class="kpi"><div>المبيعات</div><div style="color:#16a34a">${totalSales.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
    <div class="kpi"><div>المحصّل</div><div style="color:#16a34a">${totalColl.toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
    <div class="kpi"><div>صافي الربح</div><div style="color:${profit>=0?'#16a34a':'#dc2626'}">${Math.abs(profit).toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
  </div>
  <table><thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th>الطرف</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <scr` + `ipt>window.onload=()=>window.print()<` + `/scr` + `ipt></body></html>`;
  openPrintOverlay(html, 'كشف الصفقة');
}

// ════════════════════════════════════════════════════════════
// SECTION 10 — Contact Statement (Operations)
// ════════════════════════════════════════════════════════════

function printContactStatement() {
  const name    = csState.contactName;
  const content = el('cs-table')?.innerHTML || '';
  const kpis    = el('cs-kpis')?.innerHTML  || '';
  printSection(`كشف حساب — ${name}`, `نظام ${state.system}`, kpis + content);
}
