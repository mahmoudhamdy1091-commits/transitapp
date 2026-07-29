#!/usr/bin/env node
// فحص حي (قراءة فقط عبر مفتاح anon) لتسوية الشركاء لملف معيّن — يعيد إنتاج
// computePartnerSettlement (js/core.js) بالحرف، بدون فتح المتصفح.
//
// الاستخدام:
//   node scripts/audit-partner-settlement-live.js "<file_no>" <BOX|TM>
// مثال:
//   node scripts/audit-partner-settlement-live.js "LOT 3 NEW" BOX
//
// أُنشئ 2026-07-29 بعد استخدامه لتشخيص علة صيغة netDue القديمة (راجع
// project_full_cost_lifecycle_session_2026-07-28 في الذاكرة).

const SB_URL = 'https://tepaonhqszocyjsdcyoz.supabase.co';
const SB_KEY = 'sb_publishable_l24VhFauUbUD7GfAyEnyhQ_9F_PKHH3';
const TREASURY_ALIASES = new Set(['الصندوق', 'صندوق الترانزيت']);

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

// نفس computeFinancials (core.js) — الحقول اللي محتاجينها هنا بس
// ✅ الشراء بيُحدَّد عبر entry_no فيه سطر 2100 (مش ref_table='purchase_orders'
// وحدها) — يلتقط قيد العكس بعد تعديل/إلغاء سند شراء، اتصلح 2026-07-29
function computeFinancials(jeRows) {
  const purchaseEntryNos = new Set();
  (jeRows || []).forEach(r => { if (r.account_code === '2100' && r.entry_no) purchaseEntryNos.add(r.entry_no); });
  const byFile = {};
  const ensure = fn => { if (!byFile[fn]) byFile[fn] = { sales: 0, cogs: 0, dealExp: 0, purchase: 0, expenseAmount: 0 }; };
  (jeRows || []).forEach(r => {
    const acc = r.account_code || '';
    const dr = +r.dr_amount || 0, cr = +r.cr_amount || 0;
    const ref = r.ref_table || '';
    const fn = r.file_no || null;
    if (!fn) return;
    ensure(fn);
    if (acc.startsWith('4')) byFile[fn].sales += (cr - dr);
    if (acc.startsWith('5') && ref !== 'operating_expenses') byFile[fn].cogs += (dr - cr);
    if (acc === '1300' && purchaseEntryNos.has(r.entry_no)) byFile[fn].purchase += (dr - cr);
    if (acc.startsWith('6') && dr > 0 && ref === 'expenses') byFile[fn].dealExp += dr;
    if (ref === 'expenses') byFile[fn].expenseAmount += cr;
  });
  return { byFile };
}

// نفس computePartnerSettlement (core.js) بالحرف — بما فيها صيغة netDue
// الحالية (fairShareDiff + profitShare)، مُطبَّقة 2026-07-28
async function computePartnerSettlement(fileNo, sys) {
  const [partnersRaw, jeAll] = await Promise.all([
    apiGetAll('partners_master', { select: 'partner,share_percent', system_type: `eq.${sys}`, file_no: `eq.${fileNo}` }),
    apiGetAll('journal_entries', {
      select: 'account_code,contact_name,dr_amount,cr_amount,ref_table,file_no,entry_no',
      system_type: `eq.${sys}`, file_no: `eq.${fileNo}`, post_status: 'eq.posted',
    }),
  ]);
  const fin = computeFinancials(jeAll).byFile[fileNo] || { sales: 0, cogs: 0, dealExp: 0, purchase: 0, expenseAmount: 0 };
  const fullCost = fin.purchase + fin.expenseAmount;
  const profit = fin.sales - fin.cogs - fin.dealExp;

  const je2400 = jeAll.filter(r => r.account_code === '2400');
  const byContact = {};
  je2400.forEach(r => {
    const name = (r.contact_name || '').trim();
    if (!name) return;
    if (!byContact[name]) byContact[name] = { cr: 0, dr: 0, crByRef: { payments: 0, expenses: 0 } };
    const cr = +r.cr_amount || 0, dr = +r.dr_amount || 0;
    byContact[name].cr += cr; byContact[name].dr += dr;
    if (byContact[name].crByRef[r.ref_table] !== undefined) byContact[name].crByRef[r.ref_table] += cr;
  });
  const nonTreasurySum = Object.entries(byContact)
    .filter(([name]) => !TREASURY_ALIASES.has(name))
    .reduce((s, [, c]) => s + c.crByRef.payments + c.crByRef.expenses, 0);
  const treasuryActual = Math.max(0, fullCost - nonTreasurySum);

  const partners = (partnersRaw || []).map(p => {
    const name = (p.partner || '').trim();
    const share = (+p.share_percent || 0) / 100;
    const isTreasury = TREASURY_ALIASES.has(name);
    const c = byContact[name] || { cr: 0, dr: 0, crByRef: { payments: 0, expenses: 0 } };
    const actualContribution = isTreasury ? treasuryActual : (c.crByRef.payments + c.crByRef.expenses);
    const fairShare = fullCost * share;
    const fairShareDiff = actualContribution - fairShare;
    const profitShare = profit * share;
    const netDue = fairShareDiff + profitShare;
    return { name, sharePercent: +p.share_percent, isTreasury, actualContribution, fairShare, fairShareDiff, profitShare, netDue };
  });

  return { fullCost, profit, partners };
}

(async () => {
  const fileNo = process.argv[2];
  const sys = (process.argv[3] || 'BOX').toUpperCase();
  if (!fileNo) {
    console.error('الاستخدام: node scripts/audit-partner-settlement-live.js "<file_no>" <BOX|TM>');
    process.exit(1);
  }
  const result = await computePartnerSettlement(fileNo, sys);
  console.log(JSON.stringify(result, null, 2));
  const diffSum = result.partners.reduce((s, p) => s + p.fairShareDiff, 0);
  console.log(`\nتحقّق ذاتي: مجموع fairShareDiff = ${diffSum.toFixed(2)} (لازم يساوي صفر)`);
})().catch(e => { console.error(e); process.exit(1); });
