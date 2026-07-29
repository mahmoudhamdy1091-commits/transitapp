#!/usr/bin/env node
// فحص حي (قراءة فقط عبر مفتاح anon) لتناسق تكلفة المخزون المباع (COGS) عبر
// كل ملفات نظام معيّن — أو النظامين معًا لو معملتش تحديد. بيعيد إنتاج نفس منطق
// checkCOGSInvariant/auditAllFilesCOGS (js/engine.js) بالضبط، بدون الحاجة لفتح
// المتصفح والدخول على الكونسول.
//
// الاستخدام:
//   node scripts/audit-cogs-live.js          — يفحص BOX وTM معًا
//   node scripts/audit-cogs-live.js BOX      — يفحص BOX بس
//
// أُنشئ 2026-07-29 بعد استخدامه يدويًا مرتين لاكتشاف انحراف حقيقي (BOX-138،
// LOT 3 NEW) — راجع project_full_cost_lifecycle_session_2026-07-28 في الذاكرة.

const SB_URL = 'https://tepaonhqszocyjsdcyoz.supabase.co';
const SB_KEY = 'sb_publishable_l24VhFauUbUD7GfAyEnyhQ_9F_PKHH3';

async function apiGetAll(table, params) {
  let out = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const res = await fetch(`${SB_URL}/rest/v1/${table}?${qs}`, {
      headers: { apikey: SB_KEY, Range: `${offset}-${offset + pageSize - 1}` },
    });
    if (!res.ok && res.status !== 206) throw new Error(`${table}: ${res.status} ${await res.text()}`);
    const page = await res.json();
    out = out.concat(page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

// نفس computeFinancials (core.js) بالحرف — بس المفيد لحساب COGS/dealExp هنا
function computeFinancials(jeRows) {
  const byFile = {};
  const ensure = fn => { if (!byFile[fn]) byFile[fn] = { cogs: 0, dealExp: 0 }; };
  (jeRows || []).forEach(r => {
    const acc = r.account_code || '';
    const dr = +r.dr_amount || 0, cr = +r.cr_amount || 0;
    const ref = r.ref_table || '';
    const fn = r.file_no || null;
    if (acc.startsWith('5') && ref !== 'operating_expenses') {
      if (fn) { ensure(fn); byFile[fn].cogs += (dr - cr); }
    }
    if (acc.startsWith('6') && dr > 0 && ref === 'expenses') {
      if (fn) { ensure(fn); byFile[fn].dealExp += dr; }
    }
  });
  return { byFile };
}

// نفس checkCOGSInvariant (engine.js) بالحرف
function checkCOGSInvariant({ vehicles, soldVins, totalPurchase, totalExp, actualRemaining }) {
  const isPart = vin => (vin || '').startsWith('PART-');
  const allVeh = vehicles || [];
  const sold = soldVins || new Set();
  const fullCost = (+totalPurchase || 0) + (+totalExp || 0);
  const partsCost = allVeh.filter(v => isPart(v.vin)).reduce((s, v) => s + (+v.purchase_price || 0), 0);
  const truckCount = allVeh.filter(v => !isPart(v.vin)).length;
  const truckCost = Math.max(fullCost - partsCost, 0);
  const unsoldPartsCost = allVeh.filter(v => isPart(v.vin) && !sold.has(v.vin)).reduce((s, v) => s + (+v.purchase_price || 0), 0);
  const unsoldTrucks = allVeh.filter(v => !isPart(v.vin) && !sold.has(v.vin)).length;
  const expectedTruckRemaining = truckCount > 0 ? truckCost * (unsoldTrucks / truckCount) : 0;
  const expectedRemaining = Math.round((unsoldPartsCost + expectedTruckRemaining) * 100) / 100;
  const actual = Math.round((+actualRemaining || 0) * 100) / 100;
  const drift = Math.round((actual - expectedRemaining) * 100) / 100;
  const epsilon = Math.max(1, fullCost * 0.005);
  return {
    expectedRemaining, actualRemaining: actual, drift, hasDrift: Math.abs(drift) > epsilon,
    direction: drift > 0 ? 'مخزون زيادة (COGS ناقص)' : 'مخزون ناقص (COGS زيادة)', fullCost,
  };
}

// ✅ isActive الحقيقية (core.js): posted (أو null قديم) أو pending_edit —
// draft/cancelled/pending_void/voided مش مباعة فعليًا
function isActive(r) {
  return !r.post_status || r.post_status === 'posted' || r.post_status === 'pending_edit';
}

async function auditSystem(sys) {
  const poRows = await apiGetAll('purchase_orders', { select: 'file_no,total_purchase', system_type: `eq.${sys}` });
  const files = (poRows || []).map(p => p.file_no).filter(Boolean);
  const results = [];
  for (const fileNo of files) {
    try {
      const [vehRows, expRows, salesRows, jeRows] = await Promise.all([
        apiGetAll('vehicles', { select: 'vin,purchase_price', system_type: `eq.${sys}`, file_no: `eq.${fileNo}` }),
        apiGetAll('expenses', { select: 'amount', system_type: `eq.${sys}`, file_no: `eq.${fileNo}`, post_status: 'eq.posted' }),
        apiGetAll('sales', { select: 'vin,post_status', system_type: `eq.${sys}`, file_no: `eq.${fileNo}` }),
        apiGetAll('journal_entries', { select: 'account_code,dr_amount,cr_amount,ref_table,file_no', system_type: `eq.${sys}`, file_no: `eq.${fileNo}`, post_status: 'eq.posted' }),
      ]);
      const totalPurchase = +((poRows || []).find(p => p.file_no === fileNo)?.total_purchase || 0);
      const totalExp = (expRows || []).reduce((s, e) => s + (+e.amount || 0), 0);
      const soldVins = new Set((salesRows || []).filter(isActive).map(s => s.vin).filter(Boolean));
      const fin = computeFinancials(jeRows || []).byFile[fileNo] || { cogs: 0, dealExp: 0 };
      const fullCost = totalPurchase + totalExp;
      const actualRemaining = Math.max(fullCost - fin.cogs - fin.dealExp, 0);
      const check = checkCOGSInvariant({ vehicles: vehRows, soldVins, totalPurchase, totalExp, actualRemaining });
      results.push({ file_no: fileNo, ...check });
    } catch (e) {
      results.push({ file_no: fileNo, error: e.message });
    }
  }
  const drifted = results.filter(r => r.hasDrift);
  console.log(`\n=== ${sys}: ${results.length} ملف — ${drifted.length} فيه انحراف ===`);
  drifted.forEach(r => console.log(JSON.stringify(r)));
  if (!drifted.length) console.log('لا انحراف في أي ملف.');
  return { results, drifted };
}

(async () => {
  const arg = process.argv[2];
  const systems = arg ? [arg.toUpperCase()] : ['BOX', 'TM'];
  for (const sys of systems) await auditSystem(sys);
})().catch(e => { console.error(e); process.exit(1); });
