// ╔══════════════════════════════════════════════════════════╗
// ║  accounting.js — Trial Balance · Ledger · COA           ║
// ║  Transit Management System — نقل حرفي، لا تعديل منطق   ║
// ╚══════════════════════════════════════════════════════════╝

// ── خرائط تسميات وألوان مصادر القيود (موحّدة — كانت مكررة في عدة دوال) ──
const SOURCE_LABELS = {purchase_orders:'شراء',sales:'بيع',collections:'تحصيل',payments:'دفعة مورد',expenses:'مصروف',partner_payouts:'صرف شريك',operating_expenses:'مصروف تشغيلي',manual:'يدوي',reversal:'🔄 قيد عكسي'};
const SOURCE_COLORS = {purchase_orders:'var(--accent)',sales:'var(--green)',collections:'var(--blue)',payments:'var(--cyan)',expenses:'var(--red)',partner_payouts:'var(--purple)',operating_expenses:'var(--purple)',manual:'var(--text)',reversal:'var(--text2)'};

// ── State objects ──
const trialState  = { data:[], typeFilter:'all', from:null, to:null, period:'year' };
const ledgerState = { accountCode:null, accountName:null, from:null, to:null, period:'year' };

function _getPeriodDates(period) {
  const now = new Date();
  const yr  = now.getFullYear();
  const pad = n => String(n).padStart(2,'0');
  if (period==='today')   return {from:now.toISOString().split('T')[0], to:now.toISOString().split('T')[0]};
  if (period==='week') {
    const day=now.getDay(), sat=new Date(now); sat.setDate(now.getDate()-((day+1)%7));
    const fri=new Date(sat); fri.setDate(sat.getDate()+6);
    return {from:sat.toISOString().split('T')[0], to:fri.toISOString().split('T')[0]};
  }
  if (period==='month') {
    const last=new Date(yr, now.getMonth()+1, 0);
    return {from:`${yr}-${pad(now.getMonth()+1)}-01`,to:`${last.getFullYear()}-${pad(last.getMonth()+1)}-${pad(last.getDate())}`};
  }
  if (period==='lastmonth') {
    const lm=new Date(yr,now.getMonth()-1,1),lme=new Date(yr,now.getMonth(),0);
    return {from:`${lm.getFullYear()}-${pad(lm.getMonth()+1)}-01`,to:`${lme.getFullYear()}-${pad(lme.getMonth()+1)}-${pad(lme.getDate())}`};
  }
  if (period==='year')     return {from:`${yr}-01-01`,to:`${yr}-12-31`};
  if (period==='lastyear') return {from:`${yr-1}-01-01`,to:`${yr-1}-12-31`};
  return {from:null,to:null};
}
function _setPeriodBtns(prefix,period) {
  document.querySelectorAll(`[id^="${prefix}-period-"]`).forEach(b=>b.classList.remove('active'));
  el(`${prefix}-period-${period}`)?.classList.add('active');
  const cw=el(`${prefix}-custom-dates`);
  if(cw) cw.style.display=period==='custom'?'flex':'none';
}

// ══ ميزان المراجعة ══
function showTrialBalance() {
  hideAllViews();
  el('trialView').style.display='block';
  el('topBarTitle').textContent='⚖️ ميزان المراجعة';
  el('topBarSub').textContent=`نظام ${state.system}`;
  navActive('nav-trial');
  setTrialPeriod(trialState.period||'all');
}

function setTrialPeriod(period) {
  trialState.period=period;
  _setPeriodBtns('tb',period);
  if(period==='custom') return;
  const {from,to}=_getPeriodDates(period);
  trialState.from=from; trialState.to=to;
  if(el('tb-from')) el('tb-from').value=from||'';
  if(el('tb-to'))   el('tb-to').value=to||'';
  loadTrialBalance();
}

async function loadTrialBalance() {
  el('trialTable').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري تحميل ميزان المراجعة...</div>';
  const from  = el('tb-from')?.value || trialState.from || null;
  const to    = el('tb-to')?.value   || trialState.to   || null;
  const postF = el('tb-post-filter')?.value || 'posted';
  trialState.from = from; trialState.to = to;
  try {
    const sys = state.system;

    // بناء URL مع Range header لتجاوز حد 1000 صف الافتراضي في Supabase
    const buildUrl = (sysParam) => {
      let u = `${SB_URL}/rest/v1/journal_entries?${sysParam}`
            + `&select=id,account_code,account_name,dr_amount,cr_amount,post_status&limit=49999`;
      if (from) u += `&entry_date=gte.${encodeURIComponent(from)}`;
      if (to)   u += `&entry_date=lte.${encodeURIComponent(to + 'T23:59:59')}`;
      if (postF === 'posted') u += `&post_status=eq.posted`;
      if (postF === 'draft')  u += `&post_status=eq.draft`;
      return u;
    };

    const h = headers({ 'Range': '0-49999', 'Range-Unit': 'items' });

    // جلب بيانات النظام الحالي
    let res1 = await fetch(buildUrl(`system_type=eq.${encodeURIComponent(sys)}`), { headers: h });
    if (res1.status === 401) {
      const ok = await refreshAccessToken();
      if (!ok) { el('trialTable').innerHTML = errHTML('انتهت الجلسة'); return; }
      res1 = await fetch(buildUrl(`system_type=eq.${encodeURIComponent(sys)}`), { headers: h });
    }
    if (!res1.ok && res1.status !== 206) throw new Error(await res1.text());
    const rows1 = await res1.json();

    // جلب البيانات ذات system_type=null (بيانات قديمة)
    let rows2 = [];
    try {
      const res2 = await fetch(buildUrl('system_type=is.null'), { headers: h });
      if (res2.ok || res2.status === 206) rows2 = await res2.json();
    } catch(_) {}

    // دمج مع إزالة المكررات
    const seen = new Set();
    const rows = [];
    [...(rows1||[]), ...(rows2||[])].forEach(r => {
      const k = r.id ?? JSON.stringify(r);
      if (!seen.has(k)) { seen.add(k); rows.push(r); }
    });

    // لو لا توجد بيانات — أظهر رسالة واضحة مع زر الترحيل
    if (!rows.length) {
      el('trialKpis').innerHTML = [
        ['مجموع المدين','0.00','var(--green)'],['مجموع الدائن','0.00','var(--red)'],
        ['الفرق','لا توجد قيود','var(--text2)'],['عدد الحسابات','0','var(--blue)'],
      ].map(([l,v,c])=>`<div class="j-kpi"><div class="j-kpi-label">${l}</div><div class="j-kpi-val" style="color:${c}">${v}</div></div>`).join('');
      el('trialTable').innerHTML = `
        <div style="text-align:center;padding:32px;color:var(--text2)">
          <div style="font-size:32px;margin-bottom:10px">⚖️</div>
          <div style="font-size:14px;font-weight:700;margin-bottom:6px">لا توجد قيود محاسبية في النظام</div>
          <div style="font-size:12px;margin-bottom:16px">يجب تشغيل الترحيل أولاً لتوليد القيود من البيانات الموجودة</div>
          <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" onclick="showJEManager();setTimeout(openMigrationModal,300)">⚡ ترحيل البيانات التاريخية</button>
            <button class="btn btn-secondary btn-sm" onclick="el('tb-post-filter').value='all';loadTrialBalance()">👁 عرض كل القيود بما فيها المسودات</button>
          </div>
        </div>`;
      return;
    }

    // جلب شجرة الحسابات
    const coaData = await apiGetAll('chart_of_accounts', {
      select: 'account_code,account_name,account_type',
      system_type: `eq.${sys}`, is_active: 'eq.true'
    });
    const coaMap = {};
    (coaData||[]).forEach(a => { coaMap[a.account_code] = a; });

    // تجميع القيود بالحساب
    const accMap = {};
    rows.forEach(r => {
      const code = r.account_code || 'XXX';
      if (!accMap[code]) {
        const coa = coaMap[code] || {};
        accMap[code] = { code, name: coa.account_name || r.account_name || code, type: coa.account_type || getAccountType(code), dr: 0, cr: 0 };
      }
      accMap[code].dr += (+r.dr_amount || 0);
      accMap[code].cr += (+r.cr_amount || 0);
    });

    trialState.data = Object.values(accMap).filter(a => a.dr > 0 || a.cr > 0).sort((a,b) => (a.code||'').localeCompare(b.code||''));
    filterTrial(trialState.typeFilter || 'all');
  } catch(e) { el('trialTable').innerHTML = errHTML('خطأ: ' + e.message); console.error('loadTrialBalance:', e); }
}

function filterTrial(type) {
  trialState.typeFilter=type;
  document.querySelectorAll('[id^="ttype-"]').forEach(b=>b.classList.remove('active'));
  el('ttype-'+type)?.classList.add('active');
  renderTrialBalance();
}

function renderTrialBalance() {
  let list=trialState.data;
  if(trialState.typeFilter&&trialState.typeFilter!=='all') list=list.filter(c=>c.type===trialState.typeFilter);
  const sumDr=list.reduce((s,c)=>s+c.dr,0), sumCr=list.reduce((s,c)=>s+c.cr,0), diff=Math.abs(sumDr-sumCr);
  const TAL={asset:'أصول',liability:'التزامات',equity:'حقوق ملكية',revenue:'إيرادات',cogs:'تكلفة',expense:'مصروفات',other:'أخرى'};
  const TC={asset:'var(--blue)',liability:'var(--red)',equity:'var(--purple)',revenue:'var(--green)',cogs:'var(--accent)',expense:'var(--red)',other:'var(--text2)'};
  el('trialKpis').innerHTML=[
    ['مجموع المدين',fmt(sumDr),'var(--green)'],
    ['مجموع الدائن',fmt(sumCr),'var(--red)'],
    ['الفرق',diff<0.01?'✅ متوازن':fmt(diff),diff<0.01?'var(--green)':'var(--red)'],
    ['عدد الحسابات',list.length,'var(--blue)'],
  ].map(([l,v,c])=>`<div class="j-kpi"><div class="j-kpi-label">${l}</div><div class="j-kpi-val" style="color:${c}">${v}</div></div>`).join('');
  if(!list.length){el('trialTable').innerHTML=emptyHTML('⚖️','لا توجد بيانات');return;}
  const rows=list.map(c=>{
    const bal=c.dr-c.cr, bc=bal>0?'var(--green)':bal<0?'var(--red)':'var(--text2)';
    return `<tr style="cursor:pointer" onclick="showAccountLedger('${c.code}','${c.name.replace(/'/g,"\\'")}','${c.type}')"
      onmouseover="this.style.background='var(--card2)'" onmouseout="this.style.background=''">
      <td class="mono" style="color:var(--accent);font-weight:700">${c.code}</td>
      <td style="font-weight:600">${c.name}</td>
      <td><span style="font-size:13px;font-weight:700;padding:2px 8px;border-radius:10px;background:${TC[c.type]||'var(--card2)'}22;color:${TC[c.type]||'var(--text2)'}">${TAL[c.type]||c.type}</span></td>
      <td class="mono text-green" style="text-align:left">${fmt(c.dr)}</td>
      <td class="mono text-red"   style="text-align:left">${fmt(c.cr)}</td>
      <td style="text-align:left"><span class="mono" style="font-weight:900;color:${bc}">${fmt(Math.abs(bal))}</span> <span style="font-size:12px;color:${bc}">${bal>0?'مدين':bal<0?'دائن':'صفر'}</span></td>
    </tr>`;
  }).join('');
  el('trialTable').innerHTML=`<div style="font-size:13px;color:var(--text2);margin-bottom:6px">اضغط على أي حساب لعرض حركاته في دفتر الأستاذ</div>
    <table class="data-table">
    <thead><tr><th>الكود</th><th>اسم الحساب</th><th>النوع</th>
    <th style="color:var(--green);text-align:left">مدين</th><th style="color:var(--red);text-align:left">دائن</th><th style="text-align:left">الرصيد</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot style="background:var(--card2)"><tr>
      <td colspan="3" style="padding:10px 16px;font-weight:700">الإجمالي (${list.length})</td>
      <td class="mono text-green" style="padding:10px 16px;font-weight:900;text-align:left">${fmt(sumDr)}</td>
      <td class="mono text-red"   style="padding:10px 16px;font-weight:900;text-align:left">${fmt(sumCr)}</td>
      <td style="padding:10px 16px;font-weight:900;color:${diff<0.01?'var(--green)':'var(--red)'};text-align:left">${diff<0.01?'✅ متوازن':fmt(diff)+' فرق'}</td>
    </tr></tfoot></table>`;
}

// ══ دفتر الأستاذ (بالكود — من ميزان المراجعة) ══
function setLedgerPeriod(period) {
  ledgerState.period=period;
  _setPeriodBtns('ldg',period);
  if(period==='custom') return;
  const {from,to}=_getPeriodDates(period);
  ledgerState.from=from; ledgerState.to=to;
  if(el('ldg-from')) el('ldg-from').value=from||'';
  if(el('ldg-to'))   el('ldg-to').value=to||'';
  renderLedgerTable();
}

async function showAccountLedger(accountCode, accountName, accountType) {
  hideAllViews();
  el('ledgerView').style.display='block';
  el('topBarTitle').textContent='📖 دفتر الأستاذ';
  el('topBarSub').textContent=`${accountCode} — ${accountName}`;
  navActive('nav-trial');
  ledgerState.accountCode=accountCode; ledgerState.accountName=accountName;
  if(el('ledger-back-btn')) el('ledger-back-btn').onclick=()=>showTrialBalance();
  el('ledger-contact-badge').innerHTML=`
    <span style="color:var(--text2);font-size:12px">ميزان المراجعة /</span>
    <span class="mono" style="color:var(--accent);font-weight:900;margin-right:8px">${accountCode}</span>
    <span style="font-weight:700">${accountName}</span>`;
  el('ledgerTable').innerHTML='<div class="loading"><div class="spinner"></div></div>';
  // ✅ ورِّث فترة ميزان المراجعة للدفتر لو كانت مضبوطة
  if (trialState.from && el('ldg-from')) {
    el('ldg-from').value = trialState.from;
    el('ldg-to').value   = trialState.to || '';
    ledgerState.period   = 'custom';
    _setPeriodBtns('ldg', 'custom');
    if (el('ldg-custom-dates')) el('ldg-custom-dates').style.display = 'flex';
  } else {
    _setPeriodBtns('ldg', ledgerState.period || 'all');
  }

  try {
    const sys=state.system;
    const h = headers({ 'Range': '0-49999', 'Range-Unit': 'items' });
    const url=`${SB_URL}/rest/v1/journal_entries?system_type=eq.${encodeURIComponent(sys)}&account_code=eq.${encodeURIComponent(accountCode)}&select=*&order=entry_date.asc,id.asc&limit=49999`;
    let res=await fetch(url,{headers:h,cache:'no-store'});
    if(res.status===401){const ok=await refreshAccessToken();if(!ok){el('ledgerTable').innerHTML=errHTML('انتهت الجلسة');return;}res=await fetch(url,{headers:h,cache:'no-store'});}
    const rows=res.ok?await res.json():[];
    window._ledgerAllEntries=(rows||[]).map(r=>({
      id:r.id,date:(r.entry_date||'').split('T')[0],type:r.ref_table||'manual',
      desc:r.description||'—',ref:r.entry_no||'',debit:+r.dr_amount||0,
      credit:+r.cr_amount||0,file_no:r.file_no||'',contact:r.contact_name||'',status:r.post_status||'posted',
    }));
    window._ledgerOpening=0;
    // فلتر الصفقات
    const fileNos=[...new Set((rows||[]).map(r=>r.file_no).filter(Boolean))].sort();
    const sel=el('ledger-file-filter');
    if(sel) sel.innerHTML='<option value="">كل الصفقات</option>'+fileNos.map(f=>`<option value="${f}">${f}</option>`).join('');
    // ── Dropdown العملاء/الموردين — من contact_name الموجودة في هذا الحساب ──
    const contacts=[...new Set((rows||[]).map(r=>r.contact_name).filter(Boolean))].sort();
    const csel=el('ledger-contact-filter');
    if(csel) {
      csel.innerHTML='<option value="">كل العملاء / الموردين</option>'+contacts.map(c=>`<option value="${c}">${c}</option>`).join('');
      csel.onchange=()=>renderLedgerTable();
    }
    el('ledgerView').dataset.contactName=accountName;
    el('ledgerView').dataset.accountCode=accountCode;
    renderLedgerTable();
  } catch(e){el('ledgerTable').innerHTML=errHTML('خطأ: '+e.message);}
}

// ضغط على اسم عميل/مورد في الجدول → اختياره في الـ dropdown
function filterLedgerByContact(name) {
  const sel = el('ledger-contact-filter');
  if (!sel) return;
  if (![...sel.options].some(o => o.value === name)) sel.add(new Option(name, name));
  sel.value = name;
  renderLedgerTable();
  sel.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

// ── كشف حساب PDF (طباعة) ──
function printAccountStatement() {
  const list    = JSON.parse(el('ledgerView').dataset.entries || '[]');
  const accCode = el('ledgerView').dataset.accountCode || '';
  const contact = el('ledger-contact-filter')?.value || '';
  const accName = el('ledgerView').dataset.contactName || accCode;
  const title   = contact ? `كشف حساب — ${contact}` : `دفتر الأستاذ — ${accCode} ${accName}`;
  const from    = el('ldg-from')?.value || '';
  const to      = el('ldg-to')?.value   || '';
  const period  = (from||to) ? `${from||''}  —  ${to||''}` : 'كل الفترات';
  const co      = (state.systems||[]).find(s=>s.id===state.system)?.name || state.system || '';

  let running = 0;
  const rows = list.map((e,i) => {
    running += e.debit - e.credit;
    const bal = Math.abs(running);
    const dir = running > 0 ? 'مدين' : running < 0 ? 'دائن' : '—';
    const f = v => v > 0 ? v.toLocaleString('en-US',{minimumFractionDigits:2}) : '—';
    return `<tr style="background:${i%2?'#f8fafc':'#fff'}">
      <td>${e.date||'—'}</td>
      <td>${e.desc||'—'}</td>
      <td style="font-size:11px;color:#64748b">${e.file_no||'—'}</td>
      <td style="text-align:left;color:#16a34a;font-weight:600">${f(e.debit)}</td>
      <td style="text-align:left;color:#dc2626;font-weight:600">${f(e.credit)}</td>
      <td style="text-align:left;font-weight:700">${bal.toLocaleString('en-US',{minimumFractionDigits:2})} <span style="font-size:10px;color:#64748b">${dir}</span></td>
    </tr>`;
  }).join('');

  const totalDr  = list.reduce((s,e)=>s+e.debit,0);
  const totalCr  = list.reduce((s,e)=>s+e.credit,0);
  const finalBal = totalDr - totalCr;
  const fmtN = v => v.toLocaleString('en-US',{minimumFractionDigits:2});

  const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
  <title>${title}</title>
  <style>
    *{box-sizing:border-box} body{font-family:Cairo,Arial,sans-serif;font-size:12px;margin:24px;color:#1e293b}
    .hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #1e293b}
    .hdr h2{margin:0 0 4px;font-size:17px;font-weight:900} .hdr .sub{font-size:11px;color:#64748b}
    .kpis{display:flex;gap:12px;margin-bottom:16px}
    .kpi{flex:1;background:#f1f5f9;border-radius:8px;padding:10px 14px;text-align:center}
    .kpi .v{font-size:15px;font-weight:900} .kpi .l{font-size:11px;color:#64748b;margin-top:2px}
    table{width:100%;border-collapse:collapse}
    th{background:#1e293b;color:#fff;padding:8px 10px;text-align:right;font-size:12px;font-weight:700}
    td{padding:7px 10px;border-bottom:1px solid #e2e8f0;font-size:12px}
    tfoot td{background:#f8fafc;font-weight:700;border-top:2px solid #1e293b;padding:9px 10px}
    @media print{body{margin:8px}.no-print{display:none}}
  </style></head><body>
  <div class="hdr">
    <div>
      <h2>${title}</h2>
      <div class="sub">الحساب: ${accCode} — ${accName}</div>
      <div class="sub">الفترة: ${period}</div>
    </div>
    <div style="text-align:left">
      <div style="font-weight:700;font-size:13px">${co}</div>
      <div class="sub">${new Date().toLocaleDateString('ar-EG',{year:'numeric',month:'long',day:'numeric'})}</div>
    </div>
  </div>
  <div class="kpis">
    <div class="kpi"><div class="v" style="color:#16a34a">${fmtN(totalDr)}</div><div class="l">إجمالي المدين</div></div>
    <div class="kpi"><div class="v" style="color:#dc2626">${fmtN(totalCr)}</div><div class="l">إجمالي الدائن</div></div>
    <div class="kpi"><div class="v" style="color:${finalBal>=0?'#16a34a':'#dc2626'}">${fmtN(Math.abs(finalBal))}</div><div class="l">الرصيد ${finalBal>=0?'مدين':'دائن'}</div></div>
    <div class="kpi"><div class="v">${list.length}</div><div class="l">عدد الحركات</div></div>
  </div>
  <table>
    <thead><tr><th>التاريخ</th><th>البيان</th><th>الملف</th>
    <th style="text-align:left">مدين</th><th style="text-align:left">دائن</th><th style="text-align:left">الرصيد</th></tr></thead>
    <tbody>${rows||'<tr><td colspan="6" style="text-align:center;padding:20px;color:#94a3b8">لا توجد حركات</td></tr>'}</tbody>
    <tfoot><tr>
      <td colspan="3" style="text-align:right">الإجمالي — ${list.length} حركة</td>
      <td style="text-align:left;color:#16a34a">${fmtN(totalDr)}</td>
      <td style="text-align:left;color:#dc2626">${fmtN(totalCr)}</td>
      <td style="text-align:left;color:${finalBal>=0?'#16a34a':'#dc2626'}">${fmtN(Math.abs(finalBal))} ${finalBal>=0?'مدين':'دائن'}</td>
    </tr></tfoot>
  </table>
  <script>window.onload=()=>window.print();<\/script>
  </body></html>`;

  const w = window.open('','_blank','width=960,height=720');
  if (w) { w.document.write(html); w.document.close(); }
}

// ── تصدير Excel لدفتر الأستاذ / كشف الحساب ──
function exportLedgerExcel() {
  const list    = JSON.parse(el('ledgerView').dataset.entries || '[]');
  const accCode = el('ledgerView').dataset.accountCode || '';
  const contact = el('ledger-contact-filter')?.value || '';
  const accName = el('ledgerView').dataset.contactName || accCode;
  const sheet   = (contact || `${accCode} ${accName}`).slice(0, 31);

  let running = 0;
  const data = list.map(e => {
    running += e.debit - e.credit;
    return [e.date||'', e.desc||'', e.contact||'', e.file_no||'', e.debit||0, e.credit||0,
            Math.abs(running), running>=0?'مدين':'دائن'];
  });

  exportToExcel([{
    name: sheet,
    headers: ['التاريخ','البيان','العميل/المورد','الملف','مدين','دائن','الرصيد','اتجاه'],
    data,
  }], `كشف-حساب-${contact||accCode}`);
}

function renderLedgerTable() {
  const fileFilter=el('ledger-file-filter')?.value||'';
  const postFilter=el('ledger-post-filter')?.value||'posted';
  const contactQ=(el('ledger-contact-filter')?.value||'').trim();
  const from=el('ldg-from')?.value||null;
  const to=el('ldg-to')?.value||null;
  let list=window._ledgerAllEntries||[];
  const opening=window._ledgerOpening||0;
  if(fileFilter)  list=list.filter(e=>e.file_no===fileFilter);
  if(postFilter==='posted') list=list.filter(e=>e.status==='posted');
  if(postFilter==='draft')  list=list.filter(e=>e.status==='draft');
  if(from) list=list.filter(e=>e.date>=from);
  if(to)   list=list.filter(e=>e.date<=to);
  if(contactQ)    list=list.filter(e=>e.contact===contactQ);
  const totalDr=list.reduce((s,e)=>s+(+e.debit||0),0);
  const totalCr=list.reduce((s,e)=>s+(+e.credit||0),0);
  const finalBal=opening+totalDr-totalCr;
  el('ledgerKpis').innerHTML=[
    ['مجموع المدين',fmt(totalDr),'var(--green)'],
    ['مجموع الدائن',fmt(totalCr),'var(--red)'],
    ['الرصيد الختامي',fmt(Math.abs(finalBal))+' '+(finalBal>0?'مدين':finalBal<0?'دائن':'صفر'),finalBal>=0?'var(--green)':'var(--red)'],
    ['عدد الحركات',list.length,'var(--blue)'],
  ].map(([l,v,c])=>`<div class="j-kpi"><div class="j-kpi-label">${l}</div><div class="j-kpi-val" style="color:${c}">${v}</div></div>`).join('');
  if(!list.length&&!opening){el('ledgerTable').innerHTML=emptyHTML('📖','لا توجد حركات');return;}
  const SL=SOURCE_LABELS, SC=SOURCE_COLORS;
  let running=opening, rows='';
  if(opening&&!fileFilter) rows+=`<tr style="background:var(--card2)">
    <td colspan="4" style="padding:8px 14px;font-weight:700;color:var(--text2)">رصيد افتتاحي</td>
    <td class="mono text-green" style="padding:8px 14px;text-align:left">${opening>0?fmt(opening):'—'}</td>
    <td class="mono text-red"   style="padding:8px 14px;text-align:left">${opening<0?fmt(Math.abs(opening)):'—'}</td>
    <td class="mono" style="padding:8px 14px;font-weight:700;text-align:left">${fmt(Math.abs(opening))}</td><td></td></tr>`;
  rows+=list.map((e,i)=>{
    running+=e.debit-e.credit;
    const rc=running>=0?'var(--green)':'var(--red)';
    const src=SL[e.type]||e.type||'قيد', sc=SC[e.type]||'var(--text2)';
    const sb=e.status==='draft'?`<span style="font-size:13px;background:#fef3c7;color:#92400e;padding:1px 5px;border-radius:6px;font-weight:700">مسودة</span>`:'';
    return `<tr style="${i%2?'background:var(--card2)':''}"
      onmouseover="this.style.background='var(--accent-dim)'" onmouseout="this.style.background='${i%2?'var(--card2)':''}'"
      onclick="openJEDetail('${e.ref}')">
      <td class="mono" style="padding:8px 12px;font-size:13px;color:var(--text2);white-space:nowrap;cursor:default">${e.date||'—'}</td>
      <td style="padding:8px 12px;cursor:default">
        <span style="font-size:12px;font-weight:700;padding:1px 7px;border-radius:10px;background:${sc}22;color:${sc}">${src}</span> ${sb}
      </td>
      <td style="padding:8px 12px">
        <div style="font-size:12px">${e.desc}</div>
        ${e.file_no?`<div style="font-size:12px;color:var(--accent);font-family:monospace;cursor:pointer" onclick="event.stopPropagation();openViewer('${e.file_no}')">${e.file_no}</div>`:''}
        ${e.contact?`<div style="font-size:12px;color:var(--blue);cursor:pointer;text-decoration:underline dotted"
          onclick="event.stopPropagation();filterLedgerByContact('${e.contact.replace(/'/g,"\\'")}')">👤 ${e.contact}</div>`:''}
      </td>
      <td class="mono" style="padding:8px 12px;font-size:13px;color:var(--text2)">${e.ref||'—'}</td>
      <td class="mono text-green" style="padding:8px 12px;font-weight:700;text-align:left">${e.debit>0?fmt(e.debit):'—'}</td>
      <td class="mono text-red"   style="padding:8px 12px;font-weight:700;text-align:left">${e.credit>0?fmt(e.credit):'—'}</td>
      <td class="mono" style="padding:8px 12px;font-weight:900;color:${rc};text-align:left">${fmt(Math.abs(running))}</td>
      <td style="padding:8px 12px;text-align:center"><button class="btn btn-sm" onclick="event.stopPropagation();openJEDetail('${e.ref}')" title="تفاصيل القيد" style="padding:2px 7px;font-size:13px">🔍</button></td>
    </tr>`;
  }).join('');
  el('ledgerTable').innerHTML=`
    <div style="font-size:13px;color:var(--text2);margin-bottom:6px">اضغط على أي حركة لعرض تفاصيل القيد والمرفقات</div>
    <table class="data-table" style="min-width:700px">
    <thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th>رقم القيد</th>
    <th style="color:var(--green);text-align:left">مدين</th>
    <th style="color:var(--red);text-align:left">دائن</th>
    <th style="text-align:left">الرصيد</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot style="background:var(--card2)"><tr>
      <td colspan="4" style="padding:10px 16px;font-weight:700">الإجمالي</td>
      <td class="mono text-green" style="padding:10px 16px;font-weight:900;text-align:left">${fmt(totalDr)}</td>
      <td class="mono text-red"   style="padding:10px 16px;font-weight:900;text-align:left">${fmt(totalCr)}</td>
      <td style="padding:10px 16px;font-weight:900;color:${finalBal>=0?'var(--green)':'var(--red)'};text-align:left">${fmt(Math.abs(finalBal))} ${finalBal>0?'مدين':finalBal<0?'دائن':'✓'}</td>
      <td></td>
    </tr></tfoot></table>`;
  el('ledgerView').dataset.entries=JSON.stringify(list);
}

// ══ تفاصيل القيد + المرفقات ══
async function openJEDetail(entryNo) {
  if(!entryNo) return;
  el('je-detail-title').textContent=`قيد رقم: ${entryNo}`;
  el('je-detail-info').innerHTML='<div class="loading"><div class="spinner"></div></div>';
  el('je-detail-lines').innerHTML='';
  el('je-detail-attachments').innerHTML='';
  openModal('jeDetailModal');
  try {
    const sys=state.system;
    const [lines,attachments]=await Promise.all([
      apiGetAll('journal_entries',{select:'*',system_type:`eq.${sys}`,entry_no:`eq.${entryNo}`}),
      apiGetAll('journal_attachments',{select:'*',system_type:`eq.${sys}`,entry_no:`eq.${entryNo}`}),
    ]);
    if(!lines?.length){el('je-detail-info').innerHTML=errHTML('لم يُعثر على القيد');return;}
    const first=lines[0];
    const totalDr=lines.reduce((s,l)=>s+(+l.dr_amount||0),0);
    const totalCr=lines.reduce((s,l)=>s+(+l.cr_amount||0),0);
    const balanced=Math.abs(totalDr-totalCr)<0.01;
    const statusC=first.post_status==='posted'?'var(--green)':'var(--accent)';
    const SL=SOURCE_LABELS;
    el('je-detail-info').innerHTML=`
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px">
        <div class="j-kpi"><div class="j-kpi-label">التاريخ</div><div class="j-kpi-val" style="font-size:14px">${(first.entry_date||'').split('T')[0]}</div></div>
        <div class="j-kpi"><div class="j-kpi-label">المصدر</div><div class="j-kpi-val" style="font-size:13px">${SL[first.ref_table]||first.ref_table||'يدوي'}</div></div>
        <div class="j-kpi"><div class="j-kpi-label">الحالة</div><div class="j-kpi-val" style="font-size:13px;color:${statusC}">${first.post_status==='posted'?'✅ مرحّل':'⏳ مسودة'}</div></div>
      </div>
      <div style="background:var(--card2);border-radius:var(--radius-sm);padding:8px 12px;font-size:12px;margin-bottom:8px">
        <strong>البيان:</strong> ${first.description||'—'}
        ${first.file_no?`&nbsp;·&nbsp;<span style="color:var(--accent);cursor:pointer" onclick="closeModal('jeDetailModal');openViewer('${first.file_no}')">📂 ${first.file_no}</span>`:''}
      </div>`;
    const lineRows=lines.map(l=>`<tr>
      <td class="mono" style="color:var(--accent)">${l.account_code||'—'}</td>
      <td>${l.account_name||'—'}</td>
      <td style="font-size:13px;color:var(--text2)">${l.contact_name||'—'}</td>
      <td class="mono text-green" style="text-align:left">${+l.dr_amount>0?fmt(l.dr_amount):'—'}</td>
      <td class="mono text-red"   style="text-align:left">${+l.cr_amount>0?fmt(l.cr_amount):'—'}</td>
    </tr>`).join('');
    el('je-detail-lines').innerHTML=`
      <table class="data-table" style="margin-bottom:6px">
        <thead><tr><th>الكود</th><th>الحساب</th><th>الطرف</th>
        <th style="color:var(--green);text-align:left">مدين</th><th style="color:var(--red);text-align:left">دائن</th></tr></thead>
        <tbody>${lineRows}</tbody>
        <tfoot style="background:var(--card2)"><tr>
          <td colspan="3" style="padding:7px 12px;font-weight:700">الإجمالي</td>
          <td class="mono text-green" style="text-align:left;font-weight:900;padding:7px 12px">${fmt(totalDr)}</td>
          <td class="mono text-red"   style="text-align:left;font-weight:900;padding:7px 12px">${fmt(totalCr)}</td>
        </tr></tfoot>
      </table>
      <div style="font-size:13px;font-weight:700;color:${balanced?'var(--green)':'var(--red)'};padding:4px 0">${balanced?'✅ القيد متوازن':'❌ القيد غير متوازن!'}</div>`;
    renderJEAttachments(attachments||[],entryNo);
    window._currentJEEntryNo=entryNo;
  } catch(e){el('je-detail-info').innerHTML=errHTML('خطأ: '+e.message);}
}

function renderJEAttachments(attachments,entryNo) {
  const wrap=el('je-detail-attachments'); if(!wrap) return;
  const DI={invoice:'🧾',receipt:'🧾',payment:'💳',contract:'📄',other:'📎'};
  if(!attachments.length){wrap.innerHTML=`<div style="color:var(--text2);font-size:12px;padding:8px 0">لا توجد مرفقات بعد</div>`;return;}
  wrap.innerHTML=attachments.map(a=>`
    <div style="display:flex;align-items:center;gap:10px;padding:7px 10px;background:var(--card2);border-radius:var(--radius-sm);margin-bottom:5px;border:1px solid var(--border)">
      <span style="font-size:18px">${DI[a.doc_type]||'📎'}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700">${a.file_name||'—'}</div>
        <div style="font-size:12px;color:var(--text2)">${a.doc_type||'—'} · ${(a.created_at||'').split('T')[0]}</div>
        ${a.notes?`<div style="font-size:12px;color:var(--text2);font-style:italic">${a.notes}</div>`:''}
      </div>
      ${a.file_url?`<a href="${a.file_url}" target="_blank" class="btn btn-secondary btn-sm" style="font-size:13px;padding:3px 8px">🔗 فتح</a>`:''}
      <button class="btn btn-sm" onclick="deleteJEAttachment(${a.id},'${entryNo}')" style="background:var(--red-dim);color:var(--red);border:1px solid var(--red);padding:2px 7px;font-size:13px">🗑</button>
    </div>`).join('');
}

async function addJEAttachment() {
  const entryNo=window._currentJEEntryNo;
  const name=el('je-att-name')?.value?.trim();
  const url=el('je-att-url')?.value?.trim();
  const type=el('je-att-type')?.value;
  if(!name||!entryNo){toast('أدخل اسم المرفق','warn');return;}
  try {
    await apiPost('journal_attachments',{system_type:state.system,entry_no:entryNo,file_name:name,file_url:url||null,doc_type:type,created_by:state.user?.email||null});
    if(el('je-att-name')) el('je-att-name').value='';
    if(el('je-att-url'))  el('je-att-url').value='';
    const updated=await apiGetAll('journal_attachments',{select:'*',system_type:`eq.${state.system}`,entry_no:`eq.${entryNo}`});
    renderJEAttachments(updated||[],entryNo);
    toast('✅ تم إضافة المرفق','ok');
  } catch(e){toast('خطأ: '+e.message,'err');}
}

async function deleteJEAttachment(id,entryNo) {
  try {
    await apiDelete('journal_attachments',{id:`eq.${id}`});
    const updated=await apiGetAll('journal_attachments',{select:'*',system_type:`eq.${state.system}`,entry_no:`eq.${entryNo}`});
    renderJEAttachments(updated||[],entryNo);
    toast('✅ تم حذف المرفق','ok');
  } catch(e){toast('خطأ: '+e.message,'err');}
}

// ══ شجرة الحسابات ══
const DEFAULT_ACCOUNTS=[
  {code:'1000',name:'الأصول',type:'asset',parent:null},
  {code:'1100',name:'الأصول المتداولة',type:'asset',parent:'1000'},
  {code:'1110',name:'النقد',type:'asset',parent:'1100'},
  {code:'1120',name:'البنك',type:'asset',parent:'1100'},
  {code:'1200',name:'ذمم العملاء',type:'asset',parent:'1100'},
  {code:'1300',name:'المخزون — سيارات',type:'asset',parent:'1100'},
  {code:'1400',name:'مصاريف مدفوعة مقدماً',type:'asset',parent:'1100'},
  {code:'2000',name:'الالتزامات',type:'liability',parent:null},
  {code:'2100',name:'ذمم الموردين',type:'liability',parent:'2000'},
  {code:'2200',name:'مصاريف مستحقة',type:'liability',parent:'2000'},
  {code:'2400',name:'حسابات الشركاء',type:'liability',parent:'2000'},
  {code:'3000',name:'حقوق الملكية',type:'equity',parent:null},
  {code:'3100',name:'رأس المال',type:'equity',parent:'3000'},
  {code:'3200',name:'الأرباح المبقاة',type:'equity',parent:'3000'},
  {code:'4000',name:'الإيرادات',type:'revenue',parent:null},
  {code:'4100',name:'إيرادات المبيعات',type:'revenue',parent:'4000'},
  {code:'4200',name:'إيرادات أخرى',type:'revenue',parent:'4000'},
  {code:'5000',name:'تكلفة المبيعات',type:'cogs',parent:null},
  {code:'5100',name:'تكلفة المخزون المباع',type:'cogs',parent:'5000'},
  {code:'5200',name:'مصاريف شحن ونقل',type:'cogs',parent:'5000'},
  {code:'6000',name:'المصروفات التشغيلية',type:'expense',parent:null},
  {code:'6100',name:'مصروف رواتب',type:'expense',parent:'6000'},
  {code:'6200',name:'مصروف إيجارات',type:'expense',parent:'6000'},
  {code:'6300',name:'مصروف عمولات',type:'expense',parent:'6000'},
  {code:'6400',name:'مصروف نظافة',type:'expense',parent:'6000'},
  {code:'6500',name:'مصروف ضيافة',type:'expense',parent:'6000'},
  {code:'6600',name:'مصروفات حكومية',type:'expense',parent:'6000'},
  {code:'6700',name:'مصروفات أخرى',type:'expense',parent:'6000'},
];

function showChartOfAccounts() {
  hideAllViews();
  el('chartOfAccountsView').style.display='block';
  el('topBarTitle').textContent='🗂️ شجرة الحسابات';
  el('topBarSub').textContent=`نظام ${state.system}`;
  navActive('nav-coa');
  loadChartOfAccountsView();
}

async function loadChartOfAccountsView() {
  const wrap=el('coa-tree'); if(!wrap) return;
  wrap.innerHTML='<div class="loading"><div class="spinner"></div></div>';
  try {
    const sys=state.system;
    const data=await apiGetAll('chart_of_accounts',{select:'*',system_type:`eq.${sys}`,order:'account_code.asc'});
    if(!data?.length){
      wrap.innerHTML=`<div style="text-align:center;padding:48px 20px;color:var(--text2)">
        <div style="font-size:48px;margin-bottom:12px">🗂️</div>
        <div style="font-size:14px;font-weight:700;margin-bottom:8px">لا توجد حسابات بعد</div>
        <button class="btn btn-primary" onclick="seedDefaultAccounts()">🌱 تحميل الحسابات الافتراضية</button>
      </div>`;return;
    }
    const byParent={};
    (data||[]).forEach(a=>{const p=a.parent_code||'root';if(!byParent[p])byParent[p]=[];byParent[p].push(a);});
    const TAL={asset:'أصول',liability:'التزامات',equity:'حقوق ملكية',revenue:'إيرادات',cogs:'تكلفة',expense:'مصروفات'};
    const TC={asset:'var(--blue)',liability:'var(--red)',equity:'var(--purple)',revenue:'var(--green)',cogs:'var(--accent)',expense:'var(--red)'};
    function renderNode(code,depth=0){
      const children=byParent[code]||[];
      if(!children.length&&depth>0) return '';
      return children.map(a=>{
        const hasC=!!(byParent[a.account_code]?.length);
        const tc=TC[a.account_type]||'var(--text2)',tl=TAL[a.account_type]||a.account_type||'—';
        return `<div style="margin-right:${depth*20}px;margin-bottom:4px">
          <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-sm)"
            onmouseover="this.style.background='var(--card2)'" onmouseout="this.style.background='var(--card)'">
            <span style="font-size:12px">${hasC?'📂':'📄'}</span>
            <span class="mono" style="color:var(--accent);font-weight:700;font-size:12px">${a.account_code}</span>
            <span style="font-weight:${hasC?700:600};flex:1;cursor:pointer" onclick="showAccountLedger('${a.account_code}','${a.account_name.replace(/'/g,"\\'")}','${a.account_type}')">${a.account_name}</span>
            <span style="font-size:12px;font-weight:700;padding:2px 7px;border-radius:10px;background:${tc}22;color:${tc}">${tl}</span>
            <button class="btn btn-sm" onclick="showAccountLedger('${a.account_code}','${a.account_name.replace(/'/g,"\\'")}','${a.account_type}')" style="padding:2px 7px;font-size:12px;color:var(--blue)">📖</button>
            <button class="btn btn-sm" onclick="openEditAccountModal(${a.id})" style="padding:2px 7px;font-size:12px">✏️</button>
            <button class="btn btn-sm" onclick="deleteAccount(${a.id},'${a.account_code}')" style="padding:2px 7px;font-size:12px;background:var(--red-dim);color:var(--red);border:1px solid var(--red)">🗑</button>
          </div>
          ${hasC?renderNode(a.account_code,depth+1):''}
        </div>`;
      }).join('');
    }
    wrap.innerHTML=`<div style="font-size:13px;color:var(--text2);margin-bottom:10px">اضغط على اسم الحساب أو 📖 لفتح دفتر الأستاذ</div>${renderNode('root')}`;
  } catch(e){wrap.innerHTML=errHTML('خطأ: '+e.message);}
}

async function seedDefaultAccounts() {
  const sys=state.system;
  toast('⏳ جاري تحميل الحسابات...','ok');
  try {
    const existing=await apiGetAll('chart_of_accounts',{select:'account_code',system_type:`eq.${sys}`});
    const existSet=new Set((existing||[]).map(a=>a.account_code));
    const toInsert=DEFAULT_ACCOUNTS.filter(a=>!existSet.has(a.code)).map(a=>({system_type:sys,account_code:a.code,account_name:a.name,account_type:a.type,parent_code:a.parent||null,is_active:true}));
    if(!toInsert.length){toast('✅ الحسابات موجودة','ok');loadChartOfAccountsView();return;}
    const res=await fetch(`${SB_URL}/rest/v1/chart_of_accounts`,{method:'POST',headers:{...headers(),'Prefer':'return=minimal'},body:JSON.stringify(toInsert)});
    if(!res.ok) throw new Error(await res.text());
    toast(`✅ تم إضافة ${toInsert.length} حساب`,'ok');
    loadChartOfAccountsView();
  } catch(e){toast('خطأ: '+e.message,'err');}
}

function openNewAccountModal() {
  el('acc-id').value='';el('acc-code').value='';el('acc-name').value='';el('acc-parent').value='';
  el('acc-modal-title').textContent='حساب جديد';el('accError').style.display='none';
  openModal('accountModal');
}
async function openEditAccountModal(id) {
  const data=await apiGetAll('chart_of_accounts',{select:'*',id:`eq.${id}`});
  const a=data?.[0];if(!a)return;
  el('acc-id').value=a.id;el('acc-code').value=a.account_code||'';el('acc-name').value=a.account_name||'';
  el('acc-type').value=a.account_type||'asset';el('acc-parent').value=a.parent_code||'';
  el('acc-modal-title').textContent='تعديل حساب';el('accError').style.display='none';
  openModal('accountModal');
}
async function submitAccount() {
  const id=el('acc-id').value,code=el('acc-code').value.trim(),name=el('acc-name').value.trim();
  const type=el('acc-type').value,parent=el('acc-parent').value.trim();
  if(!code||!name){showFieldErr('accError','الكود والاسم مطلوبان');return;}
  try {
    const payload={system_type:state.system,account_code:code,account_name:name,account_type:type,parent_code:parent||null,is_active:true};
    if(id) await apiPatch('chart_of_accounts',{id:`eq.${id}`},payload);
    else   await apiPost('chart_of_accounts',payload);
    closeModal('accountModal');toast(`✅ تم ${id?'تعديل':'إضافة'} الحساب ${code}`,'ok');
    loadChartOfAccountsView();
  } catch(e){showFieldErr('accError','خطأ: '+e.message);}
}
async function deleteAccount(id,code) {
  showConfirm(`حذف حساب ${code}`,`هل تريد حذف الحساب ${code}؟ لن تُحذف القيود المرتبطة به.`,async()=>{
    try {await apiDelete('chart_of_accounts',{id:`eq.${id}`});toast(`✅ تم حذف ${code}`,'ok');loadChartOfAccountsView();}
    catch(e){toast('خطأ: '+e.message,'err');}
  });
}

function exportTrialCSV() {
  const rows=[['الكود','اسم الحساب','النوع','مدين','دائن','الرصيد']];
  trialState.data.forEach(c=>rows.push([c.code,c.name,c.type,c.dr,c.cr,c.dr-c.cr]));
  downloadCSV(rows,'ميزان_المراجعة.csv');
}

function exportLedgerCSV() {
  const name=el('ledgerView').dataset.contactName||'ledger';
  const entries=JSON.parse(el('ledgerView').dataset.entries||'[]');
  const rows=[['التاريخ','النوع','البيان','المرجع','الملف','مدين','دائن']];
  entries.forEach(e=>rows.push([e.date||'',e.type||'',e.desc||'',e.ref||'',e.file_no||'',+e.debit||0,+e.credit||0]));
  downloadCSV(rows,`دفتر_الأستاذ_${name}.csv`);
}

function getAccountType(code) {
  if(!code) return 'other';
  const c=String(code);
  if(c.startsWith('1')) return 'asset';
  if(c.startsWith('2')) return 'liability';
  if(c.startsWith('3')) return 'equity';
  if(c.startsWith('4')) return 'revenue';
  if(c.startsWith('5')) return 'cogs';
  if(c.startsWith('6')) return 'expense';
  return 'other';
}
function downloadCSV(rows, filename) {
  const bom = '\uFEFF';
  const csv = bom + rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8;' }));
  a.download = filename;
  a.click();
}

// ════════════════════════════════════════
// CONTACT MODAL (add/edit)
// ════════════════════════════════════════
function openContactModal(contact = null) {
  el('contactModalTitle').textContent = contact ? 'تعديل جهة الاتصال' : 'جهة اتصال جديدة';
  el('cm-name').value    = contact?.name    || '';
  el('cm-type').value    = contact?.type    || 'customer';
  el('cm-phone').value   = contact?.phone   || '';
  el('cm-email').value   = contact?.email   || '';
  el('cm-opening').value = contact?.opening_balance || '';
  el('cm-notes').value   = contact?.notes   || '';
  el('cmError').style.display = 'none';
  el('contactModal').dataset.editId = contact?.id || '';
  openModal('contactModal');
}

async function submitContact() {
  const name    = el('cm-name').value.trim();
  const type    = el('cm-type').value;
  const phone   = el('cm-phone').value.trim();
  const email   = el('cm-email').value.trim();
  const opening = parseFloat(el('cm-opening').value) || 0;
  const notes   = el('cm-notes').value.trim();

  if (!name) { showFieldErr('cmError','يرجى إدخال الاسم'); return; }

  const btn = el('cmSubmitBtn');
  btn.disabled = true; btn.textContent = 'جاري الحفظ...';
  try {
    const data = { system_type:state.system, name, type, phone:phone||null, email:email||null, opening_balance:opening, notes:notes||null };
    const editId = el('contactModal').dataset.editId;
    if (editId) {
      await apiPatch('contacts', { id:`eq.${editId}` }, data);
    } else {
      await apiPost('contacts', data);
    }
    Object.keys(_acCache).forEach(k => { if(k.startsWith(state.system)) delete _acCache[k]; });
    markSaving('contactModal'); closeModal('contactModal');
    toast('✅ تم حفظ جهة الاتصال','ok');
    await loadContacts();
  } catch(e) { showFieldErr('cmError','خطأ: '+e.message); }
  btn.disabled = false; btn.textContent = '💾 حفظ';
}

async function deleteContact(id, name) {
  showConfirm(`حذف ${name}`, 'سيتم حذف جهة الاتصال نهائياً. هذا الإجراء لا يمكن التراجع عنه.', async () => {
    try {
      await apiDelete('contacts', { id:`eq.${id}` });
      Object.keys(_acCache).forEach(k => delete _acCache[k]);
      toast('✅ تم الحذف','ok');
      await loadContacts();
    } catch(e) { toast('خطأ: '+e.message,'err'); }
  });
}

// Invalidate cache when new contact is saved
const _origSubmitContact = typeof submitContact !== 'undefined' ? submitContact : null;

// ════════════════════════════════════════
// EDIT VEHICLE
// ════════════════════════════════════════
let _editVehicleId = null;

async function openEditVehicleModal(vehicleId) {
  let v = state.currentVehicles?.find(v=>String(v.id)===String(vehicleId));
  if (!v) {
    // fallback: جيب من Supabase مباشرة
    try {
      const rows = await apiGetAll('vehicles', { select:'*', id:`eq.${vehicleId}` });
      v = rows?.[0];
    } catch(e) {}
  }
  if (!v) { toast('لم يُعثر على بيانات السيارة', 'err'); return; }
  _editVehicleId = vehicleId;
  el('ev-type').value   = v.vehicle_type   || '';
  el('ev-model').value  = v.model           || '';
  el('ev-year').value   = v.year            || '';
  el('ev-engine').value = v.engine_size     || '';
  el('ev-vin').value    = v.vin             || '';
  el('ev-plate').value  = v.plate           || '';
  el('ev-color').value  = v.color           || '';
  el('ev-price').value  = v.purchase_price  || '';
  el('ev-expiry').value = v.license_expiry  || '';
  el('ev-licnum').value = v.license_number  || '';
  el('ev-notes').value  = v.notes           || '';
  el('evError').style.display = 'none';
  openModal('editVehicleModal');
}

async function submitEditVehicle() {
  const data = {
    vehicle_type:    el('ev-type').value.trim()   || null,
    model:           el('ev-model').value.trim()  || null,
    year:            parseInt(el('ev-year').value)|| null,
    engine_size:     el('ev-engine').value.trim() || null,
    vin:             el('ev-vin').value.trim()     || null,
    plate:           el('ev-plate').value.trim()  || null,
    color:           el('ev-color').value.trim()  || null,
    purchase_price:  parseFloat(el('ev-price').value)||0,
    license_expiry:  el('ev-expiry').value        || null,
    license_number:  el('ev-licnum').value.trim() || null,
    notes:           el('ev-notes').value.trim()  || null,
  };
  try {
    await apiPatch('vehicles', { id:`eq.${_editVehicleId}` }, data);
    markSaving('editVehicleModal'); closeModal('editVehicleModal');
    toast('✅ تم تعديل بيانات السيارة','ok');
    loadVehiclesTab(state.currentFileNo, state.system);
  } catch(e) { showFieldErr('evError','خطأ: '+e.message); }
}


// apiDelete helper — includes permission guard + auto audit log
const apiDelete = async function(table, matchParams) {
  const protectedTables = ['purchase_orders','vehicles','sales','expenses','payments','collections','partner_payouts','contacts'];
  if (protectedTables.includes(table) && !can('delete')) {
    toast('🔒 ليس لديك صلاحية الحذف', 'err');
    throw new Error('غير مصرح بالحذف');
  }
  // Log the delete action
  try {
    const fileNo = matchParams?.file_no?.replace('eq.','') || matchParams?.id?.replace('eq.','') || null;
    logAudit('DELETE', table, fileNo, null, matchParams, `حذف من جدول ${table}`);
  } catch(e) { console.warn('logAudit DELETE:', e.message); }

  let url = `${SB_URL}/rest/v1/${table}?`;
  for (const [k,v] of Object.entries(matchParams)) url += `${k}=${encodeURIComponent(v)}&`;
  let res = await fetch(url, { method:'DELETE', headers: headers({'Prefer':'return=representation'}) });
  if (res.status === 401) { const ok = await refreshAccessToken(); if(!ok) throw new Error('انتهت الجلسة'); res = await fetch(url,{method:'DELETE',headers:headers()}); }
  return res;
}

// ════════════════════════════════════════
// DELETE ORPHAN DEAL (no file_no)
// ════════════════════════════════════════
async function deleteOrphanDeal(dealId) {
  if (!confirm('هل تريد حذف هذا الملف نهائياً؟ لا يمكن التراجع.')) return;
  try {
    // Delete by id (works even with null file_no)
    await apiDelete('purchase_orders', { id:`eq.${dealId}` });
    toast('✅ تم الحذف','ok');
    await loadDashboard();
  } catch(e) { alert('خطأ: ' + e.message); }
}

// ════════════════════════════════════════
// EXPORT ENGINE — Excel + PDF/Print
// ════════════════════════════════════════

// ── EXCEL EXPORT ──
function exportToExcel(sheets, filename) {
  if (typeof XLSX === 'undefined') {
    toast('مكتبة Excel غير محملة — تحقق من الاتصال بالإنترنت', 'err');
    return;
  }
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name, data, headers }) => {
    const wsData = [headers, ...data];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    // Style header row
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({r:0, c})];
      if (cell) cell.s = { font:{bold:true}, fill:{fgColor:{rgb:'E6930A'}} };
    }
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  XLSX.writeFile(wb, filename + '.xlsx');
}

// PRINT_STYLES و print helpers → js/print.js

// docHeader → js/print.js


// ════════════════════════════════════════
// 1. PURCHASE ORDER PRINT / EXPORT
// ════════════════════════════════════════
// printPurchaseOrder → js/print.js


async function exportPurchaseOrderExcel(fileNo) {
  try {
    const sys = state.system;
    const [poArr, vehicles, payments] = await Promise.all([
      apiGetAll('purchase_orders', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGetAll('vehicles',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGetAll('payments',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
    ]);
    const po = poArr?.[0] || {};
    exportToExcel([
      {
        name: 'بيانات الصفقة',
        headers: ['البند','القيمة'],
        data: [
          ['رقم الملف', po.file_no||''], ['المورد', po.supplier||''],
          ['التاريخ', po.po_date||''], ['قيمة الصفقة', +po.total_purchase||0],
          ['عدد السيارات', (vehicles||[]).length], ['الحالة', po.status||''],
        ]
      },
      {
        name: 'السيارات',
        headers: ['#','النوع','الموديل','VIN','اللوحة','اللون','سعر الشراء'],
        data: (vehicles||[]).map((v,i) => [i+1, v.vehicle_type||'', v.model||'', v.vin||'', v.plate||'', v.color||'', +v.purchase_price||0])
      },
      {
        name: 'دفعات المورد',
        headers: ['التاريخ','الدافع','المبلغ','طريقة الدفع','المستند','ملاحظات'],
        data: (payments||[]).map(p => [p.pay_date||'', p.payer||'', +p.amount||0, p.pay_method||'', p.document||'', p.notes||''])
      }
    ], `سند-شراء-${fileNo}`);
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

// ════════════════════════════════════════
// 2. DEAL STATEMENT PRINT / EXPORT
// ════════════════════════════════════════

async function exportDealExcel(fileNo) {
  try {
    const sys = state.system;
    const [sales, expenses, payments, collections, payouts] = await Promise.all([
      apiGetAll('sales',           { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGetAll('expenses',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGetAll('payments',        { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGetAll('collections',     { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
      apiGetAll('partner_payouts', { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fileNo}` }),
    ]);
    exportToExcel([
      { name:'مبيعات', headers:['التاريخ','الفاتورة','VIN','العميل','السعر','ملاحظات'],
        data:(sales||[]).map(s=>[s.sale_date,s.inv_no,s.vin,s.customer,+s.sale_price||0,s.notes||'']) },
      { name:'مصاريف', headers:['التاريخ','البيان','النوع','المبلغ','طريقة الدفع'],
        data:(expenses||[]).map(e=>[e.exp_date||e.expense_date,e.description,e.category,+e.amount||0,e.pay_method||'']) },
      { name:'دفعات المورد', headers:['التاريخ','الدافع','المبلغ','طريقة الدفع','المستند'],
        data:(payments||[]).map(p=>[p.pay_date,p.payer,+p.amount||0,p.pay_method||'',p.document||'']) },
      { name:'تحصيلات', headers:['التاريخ','العميل','المبلغ','طريقة الدفع'],
        data:(collections||[]).map(c=>[c.paid_date,c.customer,+c.amount||0,c.pay_method||'']) },
      { name:'صرف شركاء', headers:['التاريخ','الشريك','النوع','رأس مال','أرباح','إجمالي'],
        data:(payouts||[]).map(p=>[p.pay_date,p.partner,p.payout_type,+p.capital_amount||0,+p.profit_amount||0,+p.amount||0]) },
    ], `كشف-حساب-${fileNo}`);
  } catch(e) { toast('خطأ: '+e.message,'err'); }
}

// ════════════════════════════════════════
// 3. REPORTS PRINT / EXPORT
// ════════════════════════════════════════
// printCurrentReport → js/print.js


async function exportCurrentReportExcel() {
  const type = reportState.type;
  const data = reportState.data || [];
  if (!data.length) { toast('لا توجد بيانات للتصدير','err'); return; }
  const titles = { profit:'تقرير-الأرباح', sales:'تقرير-المبيعات', expenses:'تقرير-المصاريف', partners:'تقرير-الشركاء' };
  const headers = {
    profit:   ['الملف','مبيعات','مصاريف','دفعات مورد','صافي ربح'],
    sales:    ['التاريخ','الملف','VIN','العميل','السعر'],
    expenses: ['التاريخ','الملف','البيان','النوع','المبلغ'],
    partners: ['التاريخ','الملف','الشريك','النوع','المبلغ'],
  };
  const rows = {
    profit:   data.map(d=>[d.file, d.sales, d.expenses, d.payments, d.profit]),
    sales:    data.map(s=>[s.sale_date, s.file_no, s.vin, s.customer, +s.sale_price||0]),
    expenses: data.map(e=>[e.exp_date||e.expense_date, e.file_no, e.description, e.category||e.exp_type||'', +e.amount||0]),
    partners: data.map(p=>[p.pay_date, p.file_no, p.partner, p.payout_type, +p.amount||0]),
  };
  exportToExcel([{ name: titles[type], headers: headers[type], data: rows[type] }], titles[type]);
}

// ════════════════════════════════════════
// 4. TRIAL BALANCE PRINT / EXPORT
// ════════════════════════════════════════
// printTrialBalance → js/print.js


function exportTrialBalanceExcel() {
  const data = trialState.data || [];
  if (!data.length) { toast('لا توجد بيانات','err'); return; }
  const typeLabelsAr = {
    asset:'أصول', liability:'التزامات', equity:'حقوق ملكية',
    revenue:'إيرادات', cogs:'تكلفة', expense:'مصروفات', other:'أخرى',
  };
  exportToExcel([{
    name: 'ميزان المراجعة',
    headers: ['الكود','اسم الحساب','النوع','مدين','دائن','الرصيد','طبيعة الرصيد'],
    data: data.map(c => {
      const bal = c.dr - c.cr;
      return [c.code, c.name, typeLabelsAr[c.type]||c.type, c.dr, c.cr, Math.abs(bal), bal>=0?'مدين':'دائن'];
    })
  }], 'ميزان-المراجعة');
}

// ════════════════════════════════════════
// LICENSE OCR — Claude API
// ════════════════════════════════════════
function uploadLicenseForRow(row) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    if (files.length === 1) {
      await readLicenseIntoRow(files[0], row);
    } else {
      await readMultipleLicenses(files, row);
    }
  };
  input.click();
}

function uploadMultipleLicenses() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    // Get current rows count
    const container = el('vehiclesContainer');
    await readMultipleLicenses(files, null);
  };
  input.click();
}

async function readLicenseIntoRow(file, row) {
  const btn = row.querySelector('[title="رفع رخصة"]');
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  try {
    const data = await extractLicenseData(file);
    fillRowFromLicense(row, data);
    toast('✅ تم قراءة الرخصة', 'ok');
  } catch(e) {
    toast('خطأ في قراءة الرخصة: ' + e.message, 'err');
  }
  if (btn) { btn.textContent = '📷'; btn.disabled = false; }
}

async function readMultipleLicenses(files, startRow) {
  toast(`⏳ جاري قراءة ${files.length} رخصة...`, 'ok');
  const container = el('vehiclesContainer');

  for (let i = 0; i < files.length; i++) {
    // Add new row if needed
    if (i > 0 || !startRow) addVehicleRow();
    const rows = container.querySelectorAll('tr.v-row');
    const row = startRow && i === 0 ? startRow : rows[rows.length - 1];

    try {
      const data = await extractLicenseData(files[i]);
      fillRowFromLicense(row, data);
    } catch(e) {
      console.warn(`خطأ في الرخصة ${i+1}:`, e.message);
    }
  }
  toast(`✅ تم قراءة ${files.length} رخصة`, 'ok');
  checkPriceTotal();
}

async function extractLicenseData(file) {
  // Get API key from settings
  const apiKey = localStorage.getItem('tm_anthropic_key') || '';
  if (!apiKey) {
    throw new Error('يرجى إدخال مفتاح Anthropic API في ⚙️ الإعدادات ← معلومات النظام');
  }

  // Convert image to base64
  const base64 = await new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result.split(',')[1]);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });

  const mediaType = file.type || 'image/jpeg';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 }
          },
          {
            type: 'text',
            text: `استخرج بيانات السيارة من هذه الوثيقة (رخصة مركبة أو استمارة تسجيل).
أرجع JSON فقط بدون أي نص إضافي:
{
  "vehicle_type": "نوع المركبة (مثال: سيدان، بيكاب، SUV)",
  "model": "الماركة والموديل (مثال: Toyota Hilux)",
  "year": 2024,
  "vin": "رقم الشاصي كاملاً",
  "plate": "رقم اللوحة",
  "color": "اللون بالعربي",
  "engine_size": "سعة المحرك (مثال: 2.7)",
  "license_expiry": "تاريخ انتهاء الرخصة بصيغة YYYY-MM-DD"
}
إذا لم تجد قيمة اجعلها null.`
          }
        ]
      }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `خطأ ${response.status}`);
  }

  const result = await response.json();
  const text = result.content?.[0]?.text || '{}';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('لم يتم التعرف على البيانات من الصورة');
  return JSON.parse(match[0]);
}

function fillRowFromLicense(row, data) {
  if (!row || !data) return;
  const setVal = (name, val) => {
    const inp = row.querySelector(`[name="${name}"]`);
    if (inp && val) inp.value = val;
  };
  setVal('v-type',   data.vehicle_type);
  setVal('v-model',  data.model);
  setVal('v-year',   data.year);
  setVal('v-vin',    data.vin);
  setVal('v-plate',  data.plate);
  setVal('v-color',  data.color);
  setVal('v-engine', data.engine_size);
  setVal('v-expiry', data.license_expiry);
  // Highlight row briefly
  row.style.background = 'var(--green-dim)';
  setTimeout(() => row.style.background = '', 2000);
}

// ════════════════════════════════════════
// DRAFT / POST SYSTEM
// ════════════════════════════════════════

// Save any operation as Draft first, then Post

// ── ENTRY STATUS: نُقلت isAdminUser/adminPostsImmediately/entryStatus/
//    toggleAdminPostSetting/updateAdminPostToggleUI إلى engine.js (Phase 1)
//    لكسر التبعية العكسية: engine.js كان يستدعي entryStatus() المعرّفة هنا ──

async function saveDraft(entryType, fileNo, description, amount, refTable, refId) {
  try {
    const entry = await apiPost('journal_entries', {
      system_type: state.system,
      entry_date:  today(),
      entry_type:  entryType,
      file_no:     fileNo   || null,
      description: description,
      amount:      amount   || 0,
      post_status:entryStatus(),
      ref_table:   refTable || null,
      ref_id:      refId    || null,
    });
    return Array.isArray(entry) ? entry[0] : entry;
  } catch(e) { console.warn('saveDraft error:', e.message); return null; }
}

async function postEntry(journalId) {
  try {
    await apiPatch('journal_entries', { id:`eq.${journalId}` }, {
      post_status: 'posted',
      posted_at: new Date().toISOString()
    });
  } catch(e) { console.error('postEntry error:', e.message); toast('⚠️ فشل ترحيل القيد: ' + e.message, 'warn'); }
}

// Load drafts for journal
async function loadJournalDrafts() {
  try {
    const drafts = await apiGet('journal_entries', {
      select: '*',
      system_type: `eq.${state.system}`,
      post_status: 'eq.draft',
      order: 'created_at.desc'
    });

    const section = el('journal-drafts-section');
    const list    = el('journal-drafts-list');
    const count   = el('drafts-count');

    if (!drafts?.length) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';
    count.textContent = drafts.length;

    const typeConfig = {
      purchase:   { icon:'📋', label:'شراء',       color:'var(--accent)'  },
      sale:       { icon:'🧾', label:'بيع',         color:'var(--green)'   },
      collection: { icon:'💰', label:'تحصيل',       color:'var(--blue)'    },
      expense:    { icon:'💸', label:'مصروف',       color:'var(--red)'     },
      payment:    { icon:'💳', label:'دفعة مورد',   color:'var(--cyan)'    },
      payout:     { icon:'👥', label:'صرف شريك',   color:'var(--purple)'  },
    };

    list.innerHTML = drafts.map(d => {
      const cfg = typeConfig[d.entry_type] || { icon:'📌', label:d.entry_type, color:'var(--text2)' };
      return `<div class="draft-card">
        <span style="font-size:18px">${cfg.icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600">${d.description || d.entry_type}</div>
          <div style="font-size:13px;color:var(--text2);margin-top:2px">
            ${d.file_no ? `ملف: ${d.file_no} · ` : ''}${fmtDate(d.entry_date)} · ${fmt(d.amount)}
          </div>
        </div>
        <span class="draft-badge">مسودة</span>
        <button class="btn btn-sm" onclick="postDraftEntry(${d.id},'${d.entry_type}','${d.file_no||''}')"
          style="background:var(--green-dim);border:1px solid var(--green);color:var(--green)">✓ Post</button>
        <button class="btn-ctx-menu" onclick="event.stopPropagation();_ctxDraft(this)" data-id="${d.id}" title="إجراءات">⋮</button>
      </div>`;
    }).join('');
  } catch(e) { console.warn('loadJournalDrafts error:', e.message); }
}

async function postDraftEntry(id, type, fileNo) {
  await postEntry(id);
  toast(`✅ تم ترحيل القيد`,'ok');
  loadJournal();
}

async function deleteDraftEntry(id) {
  if (!confirm('حذف المسودة؟')) return;
  await apiDelete('journal_entries', { id:`eq.${id}` });
  toast('تم الحذف','ok');
  loadJournal();
}

// ════════════════════════════════════════
// JOURNAL EDIT — edit any entry
// ════════════════════════════════════════
async function editJournalEntry(type, sourceId, fileNo) {
  // Open the appropriate modal in edit mode based on type
  state.currentFileNo = fileNo || state.currentFileNo;
  switch(type) {
    case 'sale':       openSaleModal(); break;
    case 'collection': openCollectionModal(); break;
    case 'expense':    openExpenseModal(); break;
    case 'payment':    openPaymentModal(); break;
    case 'payout':     openPayoutModal(); break;
    default: toast('لا يمكن تعديل هذا النوع مباشرة — ادخل الملف وعدّل من هناك','err');
  }
}

// ════════════════════════════════════════
// JOURNAL REPORT
// ════════════════════════════════════════
function showJournalReport() {
  // ✅ استخدام نطاق التاريخ المحفوظ مع journalState.entries نفسها (وقت تحميلها)
  // وليس getJournalDateRange() الحالي — لتجنّب تعارض الفترة المعروضة مع البيانات
  // إذا تغيّر فلتر الفترة بعد التحميل أو قبل اكتماله
  const from = journalState.loadedFrom || today();
  const to   = journalState.loadedTo   || today();
  const entries = journalState.entries || [];

  if (!entries.length) { toast('لا توجد بيانات للتقرير','err'); return; }

  const typeLabels = {
    sale:'مبيعات', collection:'تحصيلات', expense:'مصاريف',
    payment:'دفعات مورد', payout:'صرف شركاء', purchase:'مشتريات'
  };

  // Group by type
  const groups = {};
  entries.forEach(e => {
    const t = e.type || 'أخرى';
    if (!groups[t]) groups[t] = { count:0, total:0 };
    groups[t].count++;
    groups[t].total += e.amount || 0;
  });

  const totalIn  = entries.filter(e=>e.sign>0).reduce((s,e)=>s+e.amount,0);
  const totalOut = entries.filter(e=>e.sign<0).reduce((s,e)=>s+e.amount,0);
  const net      = totalIn - totalOut;

  const summaryRows = Object.entries(groups).map(([type,g]) =>
    `<tr><td>${typeLabels[type]||type}</td><td style="text-align:center">${g.count}</td>
     <td style="text-align:left">${g.total.toLocaleString('en-US',{minimumFractionDigits:2})}</td></tr>`
  ).join('');

  const detailRows = entries.map(e => `<tr>
    <td>${fmtDate(e.date)}</td>
    <td>${typeLabels[e.type]||e.type||'—'}</td>
    <td>${e.title||e.description||'—'}</td>
    <td>${e.fileNo||'—'}</td>
    <td style="text-align:left;color:${e.sign>0?'#16a34a':'#dc2626'}">${e.sign>0?'+':'−'}${fmt(e.amount)}</td>
  </tr>`).join('');

  const html = `
    ${docHeader('التقرير اليومي','Daily Report','')}
    <div style="font-size:13px;color:#666;margin-bottom:16px">الفترة: ${from} — ${to}</div>

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">
      <div class="kpi-box"><div class="kpi-label">إجمالي الداخل</div><div class="kpi-val green">${fmt(totalIn)}</div></div>
      <div class="kpi-box"><div class="kpi-label">إجمالي الخارج</div><div class="kpi-val red">${fmt(totalOut)}</div></div>
      <div class="kpi-box"><div class="kpi-label">صافي الحركة</div><div class="kpi-val ${net>=0?'green':'red'}">${fmt(net)}</div></div>
    </div>

    <div class="section-title">ملخص بالنوع</div>
    <table>
      <thead><tr><th>النوع</th><th>العدد</th><th>الإجمالي</th></tr></thead>
      <tbody>${summaryRows}</tbody>
    </table>

    <div class="section-title" style="margin-top:16px">التفاصيل</div>
    <table>
      <thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th>الملف</th><th>المبلغ</th></tr></thead>
      <tbody>${detailRows}</tbody>
    </table>
    <div class="footer">Transit International Company · التقرير اليومي · ${new Date().toLocaleDateString('en-GB')}</div>`;

  printDocument(html, 'التقرير اليومي');
}

// ════════════════════════════════════════
// UPDATE loadJournal to show drafts + edit buttons
// ════════════════════════════════════════
// ════════════════════════════════════════
// VEHICLES REPORT
// ════════════════════════════════════════
const vrState = { all: [], filter: 'all' };

async function showVehiclesReport() {
  hideAllViews();
  el('vehiclesReportView').style.display = 'block';
  el('topBarTitle').textContent = 'تقرير السيارات';
  navActive('');
  await loadVehiclesReport();
}

async function loadVehiclesReport() {
  el('vr-table').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري التحميل...</div>';
  try {
    const sys = state.system;
    const [vehicles, sales, deals, locations] = await Promise.all([
      apiGetAll('vehicles',        { select:'*',                               system_type:`eq.${sys}`, order:'file_no.asc,created_at.asc' }),
      apiGetAll('sales',           { select:'vin,sale_price,customer,sale_date,inv_no', system_type:`eq.${sys}` }),
      apiGetAll('purchase_orders', { select:'file_no,supplier',               system_type:`eq.${sys}` }),
      // ✅ جلب المخازن لإظهار عمود المخزن في تقرير السيارات
      apiGetAll('stock_locations', { select:'vin,location_name',              system_type:`eq.${sys}`, order:'transfer_date.desc,id.desc' }),
    ]);

    const soldMap = {};
    (sales||[]).forEach(s => { soldMap[s.vin] = s; });

    const dealMap = {};
    (deals||[]).forEach(d => { dealMap[d.file_no] = d.supplier; });

    // آخر موقع لكل VIN
    const vinWhMap = {};
    (locations||[]).forEach(t => {
      if (t.vin && !vinWhMap[t.vin]) vinWhMap[t.vin] = t.location_name || 'غير محدد';
    });

    // Enrich vehicles with sold info, internal code, and warehouse
    const fileNums = {};
    vrState.all = (vehicles||[]).map(v => {
      if (!fileNums[v.file_no]) fileNums[v.file_no] = 0;
      fileNums[v.file_no]++;
      const code     = `${v.file_no}-V${String(fileNums[v.file_no]).padStart(2,'0')}`;
      const saleInfo = v.vin ? soldMap[v.vin] : null;
      const warehouse = v.vin ? (vinWhMap[v.vin] || '') : '';
      return { ...v, _code: code, _sold: !!saleInfo, _saleInfo: saleInfo,
               _supplier: dealMap[v.file_no]||'', _warehouse: warehouse };
    });

    // Populate file filter
    const files = [...new Set((vehicles||[]).map(v=>v.file_no).filter(Boolean))].sort();
    el('vr-file').innerHTML = '<option value="">كل الملفات</option>' +
      files.map(f=>`<option value="${f}">${f}</option>`).join('');

    // Populate warehouse filter
    const warehouses = [...new Set(Object.values(vinWhMap))].sort();
    const whSel = el('vr-warehouse');
    if (whSel) {
      whSel.innerHTML = '<option value="">كل المخازن</option>' +
        warehouses.map(w=>`<option value="${w}">${w}</option>`).join('');
    }

    filterVehiclesReport();
  } catch(e) { el('vr-table').innerHTML = errHTML(e.message); }
}

function filterVehiclesReport(status) {
  if (status) {
    vrState.filter = status;
    document.querySelectorAll('[id^="vr-"]').forEach(b => { if(b.tagName==='BUTTON') b.classList.remove('active'); });
    el('vr-' + status)?.classList.add('active');
  }

  const fileFilter      = el('vr-file')?.value      || '';
  const warehouseFilter = el('vr-warehouse')?.value || '';
  const searchFilter    = (el('vr-search')?.value || '').toLowerCase();
  const statusFilter    = vrState.filter;

  let list = vrState.all;
  if (statusFilter === 'stock') list = list.filter(v => !v._sold);
  if (statusFilter === 'sold')  list = list.filter(v =>  v._sold);
  if (fileFilter)      list = list.filter(v => v.file_no === fileFilter);
  // ✅ فلتر المخزن
  if (warehouseFilter) list = list.filter(v => v._warehouse === warehouseFilter);
  if (searchFilter)    list = list.filter(v =>
    (v.vin||'').toLowerCase().includes(searchFilter) ||
    (v.plate||'').toLowerCase().includes(searchFilter) ||
    (v.model||'').toLowerCase().includes(searchFilter) ||
    (v.vehicle_type||'').toLowerCase().includes(searchFilter) ||
    (v._warehouse||'').toLowerCase().includes(searchFilter)
  );

  // KPIs
  const totalV   = list.length;
  const soldV    = list.filter(v=>v._sold).length;
  const stockV   = totalV - soldV;
  const totalCost = list.reduce((s,v)=>s+(+v.purchase_price||0),0);
  const totalSales = list.filter(v=>v._sold).reduce((s,v)=>s+(+v._saleInfo?.sale_price||0),0);
  const expiring  = list.filter(v => {
    if (!v.license_expiry) return false;
    const days = (new Date(v.license_expiry) - new Date()) / 86400000;
    return days < 30 && days > 0;
  }).length;

  const inWarehouseV = list.filter(v => !v._sold && v._warehouse).length;
  el('vr-kpis').innerHTML = `
    <div class="j-kpi"><div class="j-kpi-label">إجمالي السيارات</div><div class="j-kpi-val">${totalV}</div></div>
    <div class="j-kpi"><div class="j-kpi-label">في المخزن</div><div class="j-kpi-val text-amber">${stockV}</div></div>
    <div class="j-kpi"><div class="j-kpi-label">🏪 في مخازن</div><div class="j-kpi-val text-purple">${inWarehouseV}</div></div>
    <div class="j-kpi"><div class="j-kpi-label">مباعة</div><div class="j-kpi-val text-green">${soldV}</div></div>
    <div class="j-kpi"><div class="j-kpi-label">${expiring?'⚠️ رخص تنتهي قريباً':'تكلفة الشراء'}</div>
      <div class="j-kpi-val ${expiring?'text-red':''}">${expiring ? expiring+' سيارة' : fmt(totalCost)}</div></div>`;

  if (!list.length) { el('vr-table').innerHTML = emptyHTML('🚗','لا توجد سيارات'); return; }

  const rows = list.map(v => {
    const expired = v.license_expiry && new Date(v.license_expiry) < new Date();
    const expiringSoon = v.license_expiry && !expired && (new Date(v.license_expiry)-new Date())/86400000 < 30;
    const whDisplay = v._warehouse
      ? `<span style="background:var(--purple-dim,#f3e8ff);color:var(--purple,#7c3aed);padding:2px 8px;border-radius:10px;font-size:12px;font-weight:700">🏪 ${v._warehouse}</span>`
      : '—';
    return `<tr ${v._sold?'style="opacity:.7"':''}>
      <td><span class="mono text-amber" style="font-size:13px">${v._code}</span></td>
      <td><span class="mono text-amber" style="font-size:13px">${v.file_no||'—'}</span></td>
      <td style="font-size:13px;color:var(--text2)">${v._supplier}</td>
      <td>${v.vehicle_type||'—'}</td>
      <td>${v.model||'—'}</td>
      <td>${v.year||'—'}</td>
      <td><span class="mono" style="direction:ltr;font-size:13px">${v.vin||'—'}</span></td>
      <td><span class="mono" style="direction:ltr;font-size:13px">${v.plate||'—'}</span></td>
      <td>${v.color||'—'}</td>
      <td>${v.engine_size||'—'}</td>
      <td class="mono text-blue">${fmt(v.purchase_price)}</td>
      <td class="${expired?'text-red':expiringSoon?'text-amber':''}" style="font-size:13px">${v.license_expiry||'—'}</td>
      <td>
        ${v._sold
          ? `<span class="badge badge-closed">مباع</span>`
          : `<span class="badge badge-open">في المخزن</span>`}
      </td>
      <td>${whDisplay}</td>
      ${v._sold ? `<td style="font-size:13px;color:var(--text2)">${v._saleInfo?.customer||''}</td>` : '<td></td>'}
    </tr>`;
  }).join('');

  el('vr-table').innerHTML = `<table class="data-table">
    <thead><tr>
      <th>الكود</th><th>الملف</th><th>المورد</th><th>النوع</th><th>الموديل</th>
      <th>السنة</th><th>VIN</th><th>اللوحة</th><th>اللون</th><th>الحجم</th>
      <th>سعر الشراء</th><th>انتهاء الرخصة</th><th>الحالة</th><th>المخزن</th><th>العميل</th>
    </tr></thead>
    <tbody>${rows}</tbody>
    <tfoot style="background:var(--card2)"><tr>
      <td colspan="10" style="padding:10px 16px;font-weight:700">الإجمالي (${list.length} سيارة)</td>
      <td class="mono text-blue" style="padding:10px 16px;font-weight:700">${fmt(list.reduce((s,v)=>s+(+v.purchase_price||0),0))}</td>
      <td colspan="3"></td>
    </tr></tfoot>
  </table>`;

  vrState.filtered = list;
}

// printVehiclesReport → js/print.js


function exportVehiclesExcel() {
  const list = vrState.filtered || vrState.all;
  if (!list.length) { toast('لا توجد بيانات','err'); return; }
  exportToExcel([{
    name: 'السيارات',
    headers: ['الكود','الملف','المورد','النوع','الموديل','السنة','VIN','اللوحة','اللون','الحجم','سعر الشراء','انتهاء الرخصة','الحالة','المخزن','العميل'],
    data: list.map(v => [v._code, v.file_no, v._supplier, v.vehicle_type, v.model, v.year, v.vin, v.plate, v.color, v.engine_size, +v.purchase_price||0, v.license_expiry||'', v._sold?'مباع':'في المخزن', v._warehouse||'', v._saleInfo?.customer||''])
  }], 'تقرير-السيارات');
}

// ════════════════════════════════════════
// VIEWER KPI STRIP
// ════════════════════════════════════════
async function loadViewerKpis(fn, sys) {
  try {
    const [po, vehicles, sales, expenses, collections, payments] = await Promise.all([
      apiGetAll('purchase_orders', { select:'total_purchase,status',      system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGetAll('vehicles',        { select:'purchase_price,vin',         system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGetAll('sales',           { select:'sale_price,vin,post_status', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGetAll('expenses',        { select:'amount,post_status',         system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGetAll('collections',     { select:'amount,post_status',         system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      apiGetAll('payments',        { select:'amount,post_status',         system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
    ]);

    const totalCost    = +(po?.[0]?.total_purchase) || (vehicles||[]).reduce((s,v)=>s+(+v.purchase_price||0),0);
    const totalExp     = (expenses||[]).filter(isPosted).reduce((s,e)=>s+(+e.amount||0),0);
    const fullCost     = totalCost + totalExp;
    const totalSales   = (sales||[]).filter(isPosted).reduce((s,s2)=>s+(+s2.sale_price||0),0);
    const totalColl    = (collections||[]).filter(isPosted).reduce((s,c)=>s+(+c.amount||0),0);
    // ✅ pending_edit = مرحّلة في طور التعديل → تُحسب كمدفوع
    const totalPaid    = (payments||[]).filter(isEffective).reduce((s,p)=>s+(+p.amount||0),0);
    const profit       = totalSales - fullCost;
    const soldVins     = new Set((sales||[]).filter(isPosted).map(s=>s.vin).filter(Boolean));
    const unsold       = (vehicles||[]).filter(v=>!soldVins.has(v.vin)).length;
    const uncollected  = totalSales - totalColl;
    const supplierLeft = totalCost - totalPaid;

    // ✅ viewer-kpis مُخفاة — الـ KPIs موجودة في تاب الملخص
    if(el('viewer-kpis')) el('viewer-kpis').innerHTML = '';
  } catch(e) { console.warn('KPI strip error:', e.message); if(el('viewer-kpis')) el('viewer-kpis').innerHTML=''; }
}

// ════════════════════════════════════════
// PARTNER DEAL STATEMENT (popup)
// ════════════════════════════════════════
// ════════════════════════════════════════
// كشف حساب الشريك — شامل أو لصفقة محددة
// ════════════════════════════════════════
async function showPartnerStatement(partnerName, fileNoFilter = null) {
  // Show loading overlay first
  const overlay = document.createElement('div');
  overlay.id = 'partnerStatementOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';
  overlay.innerHTML = `<div style="background:var(--card);border-radius:16px;padding:32px;text-align:center;color:var(--text)"><div class="spinner"></div><br>جاري إعداد الكشف...</div>`;
  document.body.appendChild(overlay);
  overlay.onclick = e => { if(e.target===overlay) overlay.remove(); };

  try {
    const sys = state.system;

    // ── 1. جلب كل الصفقات التي الشريك فيها ──
    const allPartnerDeals = await apiGetAll('partners_master', {
      select:'*', system_type:`eq.${sys}`, partner:`eq.${partnerName}`
    });
    if (!allPartnerDeals?.length) { overlay.remove(); toast('لا توجد صفقات لهذا الشريك','err'); return; }

    const deals = fileNoFilter
      ? allPartnerDeals.filter(d => d.file_no === fileNoFilter)
      : allPartnerDeals;

    // ── 2. جلب بيانات كل صفقة بالتوازي ──
    const dealDetails = await Promise.all(deals.map(async pm => {
      const fn    = pm.file_no;
      const share = (pm.share_percent||0) / 100;

      // ── أ. بيانات العرض (سيارات، مصاريف، مبيعات، شركاء) من الجداول المصدرية ──
      const [po, vehicles, expenses, sales, allPartners, allPartnersPayments, payouts, collections, saleCharges] = await Promise.all([
        apiGetAll('purchase_orders',  { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
        apiGetAll('vehicles',         { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
        apiGetAll('expenses',         { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
        apiGetAll('sales',            { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
        apiGetAll('partners_master',  { select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
        apiGetAll('payments',         { select:'payer,amount,post_status', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
        apiGetAll('partner_payouts',  { select:'partner,amount,capital_amount,profit_amount,advance_amount,post_status', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
        apiGetAll('collections',      { select:'amount,received_by,post_status,paid_date', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
        apiGetAll('sale_charges',     { select:'amount', system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
      ]);

      // ── ب. القيود المحاسبية من journal_entries — المصدر الموثوق ──
      // حساب 2400 (حسابات الشركاء) مع contact_name = الشريك في هذا الملف
      const jePartner = await apiGetAll('journal_entries', {
        select: 'entry_date,account_code,dr_amount,cr_amount,description,entry_no,post_status',
        system_type:  `eq.${sys}`,
        file_no:      `eq.${fn}`,
        account_code: `eq.2400`,
        contact_name: `eq.${partnerName}`,
        post_status:  `eq.posted`,
        order: 'entry_date.asc,id.asc',
      });

      // ── ج. أرقام الربح من القيود (P&L من journal_entries) ──
      const jeAll = await apiGetAll('journal_entries', {
        select: 'account_code,dr_amount,cr_amount',
        system_type: `eq.${sys}`,
        file_no:     `eq.${fn}`,
        post_status: `eq.posted`,
      });

      // إيراد (4xxx دائن) — تكلفة (5xxx مدين) — مصاريف صفقة (6xxx مدين)
      let jeSales=0, jeCOGS=0, jeDealExp=0;
      (jeAll||[]).forEach(r => {
        const acc=r.account_code||'';
        if (acc.startsWith('4') && (+r.cr_amount||0)>0) jeSales   += +r.cr_amount;
        if (acc.startsWith('5') && (+r.dr_amount||0)>0) jeCOGS    += +r.dr_amount;
        if (acc.startsWith('6') && (+r.dr_amount||0)>0) jeDealExp += +r.dr_amount;
      });
      const jeDealProfit = jeSales - jeCOGS - jeDealExp;

      // ── د. حساب الأرقام المالية — من القيود أولاً، fallback للجداول ──
      const poData       = po?.[0] || {};
      const totalPurchase= +poData.total_purchase || (vehicles||[]).reduce((s,v)=>s+(+v.purchase_price||0),0);
      const totalExp     = (expenses||[]).filter(isPosted).reduce((s,e)=>s+(+e.amount||0),0);
      const totalSales   = (sales||[]).filter(isPosted).reduce((s,s2)=>s+(+s2.sale_price||0),0)
        + (saleCharges||[]).reduce((s,c)=>s+(+c.amount||0),0);

      // الربح: من القيود لو موجودة، وإلا من الجداول
      const hasJEData    = (jeAll||[]).length > 0;
      const dealProfit   = hasJEData ? jeDealProfit : (totalSales - totalPurchase - totalExp);
      const myProfit     = dealProfit * share;
      const myPurchase   = totalPurchase * share;
      const myExpenses   = totalExp * share;
      const myFullCost   = (totalPurchase + totalExp) * share;
      const mySales      = totalSales * share;

      // ما دفعه / استرده الشريك — من القيود (2400) أولاً
      const hasJEPartner = (jePartner||[]).length > 0;

      // مصروفات دفعها هذا الشريك من جيبه (الصندوق: paid_by=null؛ غيره: paid_by=اسمه)
      const expPaidByHere = (expenses||[]).filter(isPosted).filter(e =>
        partnerName === TREASURY_PARTNER
          ? (!e.paid_by || e.paid_by.trim() === TREASURY_PARTNER)
          : (e.paid_by && e.paid_by.trim() === partnerName)
      );
      const expCapital = expPaidByHere.reduce((s,e) => s + (+e.amount||0), 0);
      const expMovements = expPaidByHere.map(e => ({
        date:   (e.exp_date||e.expense_date||'').split('T')[0] || '—',
        desc:   `مصروف — ${e.description||e.exp_type||'—'}`,
        ref:    e.ref_no||'',
        debit:  0,
        credit: +e.amount||0,
        isExp:  true,
      }));

      let capitalPaid, totalWithdrawn, capitalRet=0, profitTaken=0, advances=0;
      let jeMovements = []; // للعرض في جدول الحركات

      if (hasJEPartner) {
        // ✅ مصدر موثوق: من journal_entries حساب 2400
        capitalPaid    = (jePartner||[]).reduce((s,r)=>s+(+r.cr_amount||0),0); // CR = الشريك دفع
        capitalPaid   += expCapital; // مصروفات دفعها من جيبه (لا تمرّ بحساب 2400)
        totalWithdrawn = (jePartner||[]).reduce((s,r)=>s+(+r.dr_amount||0),0); // DR = الشريك استرد
        jeMovements    = [...(jePartner||[]).map(r=>({
          date:   (r.entry_date||'').split('T')[0],
          desc:   r.description||'—',
          ref:    r.entry_no||'',
          debit:  +r.dr_amount||0,
          credit: +r.cr_amount||0,
        })), ...expMovements].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
        // توزيع المسحوبات من payouts للعرض فقط (مفلتر للشريك الحالي)
        const myPayouts = (payouts||[]).filter(py => py.partner === partnerName);
        capitalRet  = myPayouts.reduce((s,p)=>s+(+p.capital_amount||0),0);
        profitTaken = myPayouts.reduce((s,p)=>s+(+p.profit_amount||0),0);
        advances    = myPayouts.reduce((s,p)=>s+(+p.advance_amount||0),0);
      } else {
        // ⚠️ Fallback: بيانات قديمة — من الجداول المصدرية
        const allPartnersCount = (allPartners||[]).length;
        const partnerPayments  = await apiGetAll('payments', {
          select:'*', system_type:`eq.${sys}`, file_no:`eq.${fn}`, payer:`eq.${partnerName}`
        });
        capitalPaid    = (partnerPayments||[]).filter(isEffective)
          .filter(p => allPartnersCount <= 1 || p.payer === partnerName)
          .reduce((s,p)=>s+(+p.amount||0), 0);
        capitalPaid   += expCapital; // مصروفات دفعها من جيبه
        const myPayoutsFb = (payouts||[]).filter(py => py.partner === partnerName);
        capitalRet     = myPayoutsFb.reduce((s,p)=>s+(+p.capital_amount||0),0);
        profitTaken    = myPayoutsFb.reduce((s,p)=>s+(+p.profit_amount||0),0);
        advances       = myPayoutsFb.reduce((s,p)=>s+(+p.advance_amount||0),0);
        totalWithdrawn = capitalRet + profitTaken + advances;
        jeMovements    = [...(partnerPayments||[]).filter(isEffective).map(p=>({
          date:   (p.pay_date||'').split('T')[0],
          desc:   'دفع رأس مال (بيانات قديمة)',
          ref:    p.ref_no||'',
          debit:  0,
          credit: +p.amount||0,
        })), ...expMovements].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
      }

      const netDue = capitalPaid + myProfit - totalWithdrawn;

      // ── هـ. تسوية شاملة لكل الشركاء ──
      const postedExpAll = (expenses||[]).filter(isPosted);
      const partnerSettlement = (allPartners||[]).map(p => {
        const pName  = p.partner;
        const pShare = (+p.share_percent||0) / 100;
        const pCapitalPaid = (allPartnersPayments||[]).filter(isEffective)
          .filter(py => py.payer === pName)
          .reduce((s,py) => s + (+py.amount||0), 0);
        const pExpPaid = postedExpAll
          .filter(e => pName === TREASURY_PARTNER
            ? (!e.paid_by || e.paid_by.trim() === TREASURY_PARTNER)
            : (e.paid_by && e.paid_by.trim() === pName))
          .reduce((s,e) => s + (+e.amount||0), 0);
        const pExpShould = totalExp * pShare;
        const pExpDiff   = pExpPaid - pExpShould; // موجب=دفع زيادة، سالب=عليه دين
        const pWithdrawn = (payouts||[])
          .filter(py => py.partner === pName && isActive(py))
          .reduce((s,py) => s + (+py.amount||0), 0);
        const pCollectedDirect = pName === TREASURY_PARTNER ? 0 :
          (collections||[]).filter(isPosted)
            .filter(c => c.received_by && c.received_by.trim() === pName)
            .reduce((s,c) => s + (+c.amount||0), 0);
        const pProfit     = dealProfit * pShare;
        const pNetDue     = pCapitalPaid + pExpPaid + pProfit - pWithdrawn - pCollectedDirect;
        const pSalesShare = jeSales    * pShare;
        const pCOGSShare  = jeCOGS     * pShare;
        const pExpShare   = jeDealExp  * pShare;
        return {
          name: pName, share: pShare, sharePercent: +p.share_percent,
          capitalPaid: pCapitalPaid, capitalShould: totalPurchase * pShare,
          expPaid: pExpPaid, expShould: pExpShould, expDiff: pExpDiff,
          profit: pProfit, withdrawn: pWithdrawn, collectedDirect: pCollectedDirect, netDue: pNetDue,
          pSalesShare, pCOGSShare, pExpShare,
        };
      });

      // ── و. تتبع النقدية ──
      const totalColl = (collections||[]).filter(c => isPosted(c) && !!c.paid_date).reduce((s,c)=>s+(+c.amount||0),0);
      const uncollected = totalSales - totalColl;
      const collPct = totalSales > 0 ? (totalColl / totalSales) * 100 : 0;
      const collByReceiver = Object.entries(
        (collections||[]).filter(c => isPosted(c) && !!c.paid_date).reduce((acc,c) => {
          const name = (c.received_by && c.received_by.trim()) || TREASURY_PARTNER;
          acc[name] = (acc[name]||0) + (+c.amount||0);
          return acc;
        }, {})
      ).map(([name,amount])=>({name,amount})).sort((a,b)=>b.amount-a.amount);

      // للتوافق مع الكود القديم
      const paidByPartner = {};
      (allPartnersPayments||[]).filter(isEffective).forEach(p => {
        paidByPartner[p.payer] = (paidByPartner[p.payer]||0) + (+p.amount||0);
      });
      const shouldPayMap = {};
      (allPartners||[]).forEach(p => { shouldPayMap[p.partner] = totalPurchase * ((+p.share_percent||0)/100); });
      const partnerDebts = [];
      (allPartners||[]).forEach(p => {
        const diff = (paidByPartner[p.partner]||0) - (shouldPayMap[p.partner]||0);
        if (Math.abs(diff) > 0.001) partnerDebts.push({ name:p.partner, shouldPay:shouldPayMap[p.partner]||0, didPay:paidByPartner[p.partner]||0, diff });
      });

      return {
        fn, share, poData, vehicles: vehicles||[], expenses: expenses||[],
        sales: sales||[], allPartners: allPartners||[], payouts: payouts||[],
        totalPurchase, totalExp, totalSales,
        fullCost: totalPurchase+totalExp, dealProfit,
        myPurchase, myExpenses, myFullCost, mySales, myProfit,
        capitalPaid, expCapital, capitalRet, profitTaken, advances, totalWithdrawn, netDue,
        status: poData.status || '—', supplier: poData.supplier || '—',
        poDate: poData.po_date || poData.created_at || '',
        partnerDebts, paidByPartner, shouldPayMap, partnerSettlement,
        hasJEPartner, hasJEData, jeMovements,
        totalColl, uncollected, collPct, collByReceiver,
      };
    }));

    // ── 3. الإجماليات الشاملة ──
    const grandCapital    = dealDetails.reduce((s,d)=>s+d.capitalPaid,   0);
    const grandMyProfit   = dealDetails.reduce((s,d)=>s+d.myProfit,      0);
    const grandWithdrawn  = dealDetails.reduce((s,d)=>s+d.totalWithdrawn,0);
    const grandNetDue     = dealDetails.reduce((s,d)=>s+d.netDue,        0);
    const grandDealProfit = dealDetails.reduce((s,d)=>s+d.dealProfit,    0);
    const grandTransferable = dealDetails.reduce((sum, d) => {
      const ps2 = (d.partnerSettlement||[]).find(p => p.name === partnerName);
      if (!ps2) return sum;
      if (d.status === 'CLOSED') return sum + ps2.netDue;
      if (d.totalSales < 0.01) return sum;
      return sum + Math.max(0, (d.totalColl * ps2.share) - ps2.withdrawn - ps2.collectedDirect);
    }, 0);

    // ── 4. بناء الـ HTML ──
    const fmt2 = n => (+n||0).toLocaleString('en-US',{minimumFractionDigits:3,maximumFractionDigits:3});
    const fmtP = n => ((+n||0)*100).toFixed(1)+'%';
    const statusColor = s => s==='CLOSED'?'#16a34a':s==='IN PROGRESS'?'#d97706':'#2563eb';
    const statusLabel = s => s==='CLOSED'?'مغلقة':s==='IN PROGRESS'?'جارية':s==='OPEN'?'مفتوحة':s;

    const dealBlocks = dealDetails.map(d => `
      <!-- ══ صفقة ${d.fn} ══ -->
      <div style="border:1.5px solid #e5e7eb;border-radius:12px;overflow:hidden;margin-bottom:24px;page-break-inside:avoid">

        <!-- رأس الصفقة -->
        <div style="background:#1a1a2e;color:#fff;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div style="display:flex;align-items:center;gap:12px">
            <span style="font-size:16px;font-weight:900;font-family:monospace">${d.fn}</span>
            <span style="background:#ffffff22;padding:2px 10px;border-radius:20px;font-size:13px">${d.supplier}</span>
            <span style="background:${statusColor(d.status)}33;color:${statusColor(d.status)};border:1px solid ${statusColor(d.status)}55;padding:2px 10px;border-radius:20px;font-size:13px;font-weight:700">${statusLabel(d.status)}</span>
          </div>
          <div style="font-size:12px;opacity:.7">${d.poDate ? 'تاريخ الصفقة: '+d.poDate.split('T')[0] : ''}</div>
        </div>

        <div style="padding:16px">

          <!-- شركاء الصفقة -->
          <div style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">شركاء الصفقة</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${d.allPartners.map(p=>`
                <div style="background:${p.partner===partnerName?'#fef3c7':'#f1f5f9'};border:1px solid ${p.partner===partnerName?'#f59e0b':'#e2e8f0'};border-radius:8px;padding:6px 12px;font-size:12px">
                  <span style="font-weight:700;color:${p.partner===partnerName?'#92400e':'#475569'}">${p.partner}</span>
                  <span style="color:#94a3b8;margin-right:6px">${p.share_percent}%</span>
                </div>`).join('')}
            </div>
          </div>

          <!-- السيارات -->
          <div style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
              السيارات (${d.vehicles.length} سيارة)
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr style="background:#f8fafc">
                  <th style="padding:7px 10px;text-align:right;border-bottom:1px solid #e2e8f0;color:#64748b">#</th>
                  <th style="padding:7px 10px;text-align:right;border-bottom:1px solid #e2e8f0;color:#64748b">الموديل</th>
                  <th style="padding:7px 10px;text-align:right;border-bottom:1px solid #e2e8f0;color:#64748b">رقم الشاصي</th>
                  <th style="padding:7px 10px;text-align:right;border-bottom:1px solid #e2e8f0;color:#64748b">سعر الشراء</th>
                  <th style="padding:7px 10px;text-align:right;border-bottom:1px solid #e2e8f0;color:#64748b">حصة الشريك (${fmtP(d.share)})</th>
                  <th style="padding:7px 10px;text-align:right;border-bottom:1px solid #e2e8f0;color:#64748b">الحالة</th>
                </tr>
              </thead>
              <tbody>
                ${d.vehicles.map((v,i)=>{
                  const sold = d.sales.find(s=>s.vin===v.vin);
                  return `<tr style="border-bottom:1px solid #f1f5f9">
                    <td style="padding:7px 10px;color:#94a3b8">${i+1}</td>
                    <td style="padding:7px 10px;font-weight:600">${v.model||v.make||'—'} ${v.year||''}</td>
                    <td style="padding:7px 10px;font-family:monospace;color:#2563eb;font-size:13px">${v.vin||'—'}</td>
                    <td style="padding:7px 10px;font-family:monospace;font-weight:600">${fmt2(v.purchase_price)}</td>
                    <td style="padding:7px 10px;font-family:monospace;color:#d97706">${fmt2((+v.purchase_price||0)*d.share)}</td>
                    <td style="padding:7px 10px">
                      ${sold
                        ? `<span style="background:#f0fdf4;color:#16a34a;border:1px solid #86efac;padding:2px 8px;border-radius:20px;font-size:12px;font-weight:700">✓ مباع — ${fmt2(sold.sale_price)}</span>`
                        : `<span style="background:#fef9ec;color:#d97706;border:1px solid #fcd34d;padding:2px 8px;border-radius:20px;font-size:12px;font-weight:700">في المخزن</span>`}
                    </td>
                  </tr>`;
                }).join('')}
                <tr style="background:#f8fafc;font-weight:700">
                  <td colspan="3" style="padding:8px 10px;color:#64748b">الإجمالي</td>
                  <td style="padding:8px 10px;font-family:monospace">${fmt2(d.totalPurchase)}</td>
                  <td style="padding:8px 10px;font-family:monospace;color:#d97706">${fmt2(d.myPurchase)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- المصاريف — فقط الفعّالة (بدون الملغية) -->
          ${d.expenses.filter(isEffective).length ? (() => { const effExp = d.expenses.filter(isEffective); return `
          <div style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
              المصاريف (${effExp.length} بند)
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr style="background:#fff1f2">
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #fecaca;color:#dc2626">البيان</th>
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #fecaca;color:#dc2626">النوع</th>
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #fecaca;color:#dc2626">التاريخ</th>
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #fecaca;color:#dc2626">دفعها</th>
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #fecaca;color:#dc2626">المبلغ</th>
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #fecaca;color:#dc2626">حصة الشريك</th>
                </tr>
              </thead>
              <tbody>
                ${effExp.map(e=>`
                <tr style="border-bottom:1px solid #fff1f2">
                  <td style="padding:6px 10px">${e.description||'—'}</td>
                  <td style="padding:6px 10px"><span style="background:#fef2f2;color:#dc2626;padding:1px 6px;border-radius:10px;font-size:12px">${e.exp_type||e.category||'—'}</span></td>
                  <td style="padding:6px 10px;color:#94a3b8">${(e.exp_date||e.expense_date||'').split('T')[0]||'—'}</td>
                  <td style="padding:6px 10px"><span style="background:${(!e.paid_by||e.paid_by.trim()===TREASURY_PARTNER)?'#eff6ff':'#fef3c7'};color:${(!e.paid_by||e.paid_by.trim()===TREASURY_PARTNER)?'#1d4ed8':'#92400e'};padding:1px 6px;border-radius:10px;font-size:11px;font-weight:700">${e.paid_by||TREASURY_PARTNER}</span></td>
                  <td style="padding:6px 10px;font-family:monospace;color:#dc2626">${fmt2(e.amount)}</td>
                  <td style="padding:6px 10px;font-family:monospace;color:#dc2626">${fmt2((+e.amount||0)*d.share)}</td>
                </tr>`).join('')}
                <tr style="background:#fff1f2;font-weight:700">
                  <td colspan="4" style="padding:7px 10px;color:#dc2626">إجمالي المصاريف</td>
                  <td style="padding:7px 10px;font-family:monospace;color:#dc2626">${fmt2(effExp.reduce((s,e)=>s+(+e.amount||0),0))}</td>
                  <td style="padding:7px 10px;font-family:monospace;color:#dc2626">${fmt2(effExp.reduce((s,e)=>s+(+e.amount||0),0)*d.share)}</td>
                </tr>
              </tbody>
            </table>
          </div>`; })() : ''}

          <!-- المبيعات — فقط الفعّالة -->
          ${d.sales.filter(isEffective).length ? (() => { const effSales = d.sales.filter(isEffective); return `
          <div style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
              المبيعات (${effSales.length} فاتورة)
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr style="background:#f0fdf4">
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #86efac;color:#16a34a">الشاصي</th>
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #86efac;color:#16a34a">العميل</th>
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #86efac;color:#16a34a">التاريخ</th>
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #86efac;color:#16a34a">سعر البيع</th>
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #86efac;color:#16a34a">حصة الشريك</th>
                </tr>
              </thead>
              <tbody>
                ${effSales.map(s=>`
                <tr style="border-bottom:1px solid #f0fdf4">
                  <td style="padding:6px 10px;font-family:monospace;color:#2563eb;font-size:13px">${s.vin||'—'}</td>
                  <td style="padding:6px 10px">${s.customer||'—'}</td>
                  <td style="padding:6px 10px;color:#94a3b8">${(s.sale_date||'').split('T')[0]||'—'}</td>
                  <td style="padding:6px 10px;font-family:monospace;color:#16a34a;font-weight:700">${fmt2(s.sale_price)}</td>
                  <td style="padding:6px 10px;font-family:monospace;color:#16a34a">${fmt2((+s.sale_price||0)*d.share)}</td>
                </tr>`).join('')}
                <tr style="background:#f0fdf4;font-weight:700">
                  <td colspan="3" style="padding:7px 10px;color:#16a34a">إجمالي المبيعات</td>
                  <td style="padding:7px 10px;font-family:monospace;color:#16a34a">${fmt2(effSales.reduce((s,x)=>s+(+x.sale_price||0),0))}</td>
                  <td style="padding:7px 10px;font-family:monospace;color:#16a34a">${fmt2(effSales.reduce((s,x)=>s+(+x.sale_price||0),0)*d.share)}</td>
                </tr>
              </tbody>
            </table>
          </div>`; })() : ''}

          <!-- ⚖️ تسوية شاملة بين الشركاء -->
          ${(d.partnerSettlement||[]).length >= 1 ? `
          <div style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">⚖️ تسوية شاملة بين الشركاء</div>
            <!-- بطاقة لكل شريك -->
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:12px">
              ${(d.partnerSettlement||[]).map(ps => {
                const isMe  = ps.name === partnerName;
                const bdr   = isMe ? '2px solid #f59e0b' : '1px solid #e2e8f0';
                const maleTotal = ps.capitalPaid + ps.expPaid;   // ما له (بدون نتيجة)
                const got   = ps.withdrawn + ps.collectedDirect; // ما استلمه
                const row = (label, val, color) =>
                  `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:3px 0">
                    <span style="color:#64748b">${label}</span>
                    <span style="font-family:monospace;font-weight:600;color:${color||'var(--text)'}">${fmt2(val)}</span>
                  </div>`;
                const divider = `<div style="border-top:1px dashed #e2e8f0;margin:5px 0"></div>`;
                const totalRow = (label, val, color) =>
                  `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:4px 0">
                    <span style="font-weight:700;color:${color}">${label}</span>
                    <span style="font-family:monospace;font-weight:800;color:${color}">${fmt2(val)}</span>
                  </div>`;
                return `
                <div style="border:${bdr};border-radius:10px;overflow:hidden;background:#fff">
                  <!-- رأس البطاقة -->
                  <div style="background:${isMe?'#fef3c7':'#1e293b'};color:${isMe?'#92400e':'#fff'};padding:8px 14px;font-weight:700;font-size:13px;display:flex;justify-content:space-between;align-items:center">
                    <span>${ps.name}${isMe?' ★':''}</span>
                    <span style="font-size:12px;opacity:.85">${ps.sharePercent}%</span>
                  </div>
                  <div style="padding:10px 14px;font-size:12px">

                    <!-- ما له -->
                    <div style="background:#f0fdf4;border-radius:7px;padding:8px 10px;margin-bottom:6px">
                      <div style="font-weight:700;color:#15803d;margin-bottom:4px">✅ ما له</div>
                      ${row('رأس المال المدفوع', ps.capitalPaid, '#15803d')}
                      ${ps.expPaid > 0 ? row('مصروفات دفعها من جيبه', ps.expPaid, '#15803d') : ''}
                      ${maleTotal !== ps.capitalPaid ? `${divider}${totalRow('الإجمالي', maleTotal, '#15803d')}` : ''}
                    </div>

                    <!-- نتيجة الصفقة — تفاصيل طريقة الحساب -->
                    <div style="background:${ps.profit>=0?'#f0fdf4':'#fff1f2'};border:1px dashed ${ps.profit>=0?'#86efac':'#fca5a5'};border-radius:7px;padding:8px 10px;margin-bottom:6px">
                      <div style="font-weight:700;color:${ps.profit>=0?'#15803d':'#dc2626'};margin-bottom:6px;font-size:12px">📊 حصة الربح / الخسارة (${ps.sharePercent}%)</div>
                      ${d.hasJEData ? `
                      <div style="display:flex;justify-content:space-between;padding:2px 0">
                        <span style="color:#64748b">إيرادات المبيعات &nbsp;${ps.sharePercent}% × ${fmt2(d.mySales/ps.share||0)}</span>
                        <span style="font-family:monospace;font-weight:600;color:#15803d">+ ${fmt2(ps.pSalesShare)}</span>
                      </div>
                      <div style="display:flex;justify-content:space-between;padding:2px 0">
                        <span style="color:#64748b">تكلفة البضاعة المباعة &nbsp;${ps.sharePercent}% × ${fmt2(ps.pCOGSShare/ps.share||0)}</span>
                        <span style="font-family:monospace;font-weight:600;color:#dc2626">− ${fmt2(ps.pCOGSShare)}</span>
                      </div>
                      <div style="display:flex;justify-content:space-between;padding:2px 0">
                        <span style="color:#64748b">مصروفات الصفقة &nbsp;${ps.sharePercent}% × ${fmt2(ps.pExpShare/ps.share||0)}</span>
                        <span style="font-family:monospace;font-weight:600;color:#dc2626">− ${fmt2(ps.pExpShare)}</span>
                      </div>
                      <div style="border-top:1px dashed #cbd5e1;margin-top:5px;padding-top:5px;display:flex;justify-content:space-between;align-items:center">
                        <span style="font-weight:700;color:#64748b">= ${ps.profit>=0?'حصة الربح':'حصة الخسارة'}</span>
                        <span style="font-family:monospace;font-weight:800;font-size:13px;color:${ps.profit>=0?'#15803d':'#dc2626'}">${ps.profit>=0?'+':''}${fmt2(ps.profit)}</span>
                      </div>` : `
                      <div style="display:flex;justify-content:space-between;align-items:center">
                        <span style="color:#64748b">${ps.profit>=0?'حصة الربح':'حصة الخسارة'}</span>
                        <span style="font-family:monospace;font-weight:700;font-size:13px;color:${ps.profit>=0?'#15803d':'#dc2626'}">${ps.profit>=0?'+':''}${fmt2(ps.profit)}</span>
                      </div>`}
                    </div>

                    <!-- ما عليه -->
                    <div style="background:#fff1f2;border-radius:7px;padding:8px 10px;margin-bottom:6px">
                      <div style="font-weight:700;color:#b91c1c;margin-bottom:4px">❌ ما استلمه</div>
                      ${ps.withdrawn > 0 ? row('مسحوبات رسمية', ps.withdrawn, '#b91c1c') : ''}
                      ${ps.collectedDirect > 0 ? row('تحصيلات مبيعات مباشرة', ps.collectedDirect, '#b91c1c') : ''}
                      ${got === 0 ? `<div style="color:#94a3b8;font-size:11px">لم يستلم شيئاً بعد</div>` : `${divider}${totalRow('الإجمالي', got, '#b91c1c')}`}
                    </div>

                    <!-- الرصيد النهائي -->
                    <div style="background:${ps.netDue>=0?'#dbeafe':'#fef2f2'};border-radius:8px;padding:10px;display:flex;justify-content:space-between;align-items:center">
                      <div>
                        <div style="font-weight:700;font-size:12px;color:${ps.netDue>=0?'#1d4ed8':'#dc2626'}">${ps.netDue>=0?'🔵 الرصيد المستحق له':'🔴 الرصيد المدين عليه'}</div>
                        <div style="font-size:10px;color:#94a3b8;margin-top:2px">ما له ${fmt2(maleTotal)} ${ps.profit>=0?'+ ربح':'− خسارة'} ${fmt2(Math.abs(ps.profit))} − ما استلمه ${fmt2(got)}</div>
                      </div>
                      <div style="font-family:monospace;font-weight:900;font-size:20px;color:${ps.netDue>=0?'#1d4ed8':'#dc2626'}">${ps.netDue>=0?'+':''}${fmt2(ps.netDue)}</div>
                    </div>

                    <!-- تنبيهات الفروق -->
                    ${(() => {
                      const capDiff = ps.capitalPaid - ps.capitalShould;
                      const notes = [];
                      if (Math.abs(capDiff) > 0.001)
                        notes.push({ positive: capDiff > 0,
                          text: capDiff > 0 ? '⬆ دفع رأس مال زيادة' : '⬇ باقي من حصته في رأس المال',
                          val: Math.abs(capDiff) });
                      if (Math.abs(ps.expDiff) > 0.001)
                        notes.push({ positive: ps.expDiff > 0,
                          text: ps.expDiff > 0 ? '⬆ دفع مصروفات زيادة' : '⬇ لم يدفع حصته من المصروفات',
                          val: Math.abs(ps.expDiff) });
                      return notes.length ? `<div style="margin-top:6px;display:flex;flex-direction:column;gap:3px">${notes.map(n => `
                        <div style="padding:3px 8px;border-radius:6px;background:${n.positive?'#f0fdf4':'#fef2f2'};font-size:11px;display:flex;justify-content:space-between;gap:6px">
                          <span style="color:${n.positive?'#15803d':'#dc2626'}">${n.text}</span>
                          <span style="font-family:monospace;font-weight:700;color:${n.positive?'#15803d':'#dc2626'}">${fmt2(n.val)}</span>
                        </div>`).join('')}</div>` : '';
                    })()}

                    <!-- الإجراء المطلوب — للشريك الحالي فقط -->
                    ${isMe ? (() => {
                      const noSales  = d.totalSales < 0.01;
                      const isClosed = d.status === 'CLOSED';
                      if (noSales && !isClosed) {
                        return '<div style="margin-top:10px;border:2px solid #94a3b8;border-radius:8px;padding:10px 12px;text-align:center;background:#f8fafc">'
                          + '<div style="font-size:10px;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px">الإجراء المطلوب</div>'
                          + '<div style="font-size:14px;font-weight:700;color:#64748b">⏳ الصفقة لم تبدأ — لا يوجد مبلغ للتحويل</div></div>';
                      }
                      if (!isClosed) {
                        const tNow = (d.totalColl * ps.share) - ps.withdrawn - ps.collectedDirect;
                        if (tNow > 0.01) {
                          return '<div style="margin-top:10px;border:2px solid #3b82f6;border-radius:8px;padding:10px 12px;text-align:center;background:#eff6ff">'
                            + '<div style="font-size:10px;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px">الإجراء المطلوب — صفقة جارية</div>'
                            + '<div style="font-size:15px;font-weight:800;color:#1d4ed8">💸 القابل للتحويل الآن: ' + fmt2(tNow) + '</div>'
                            + '<div style="font-size:11px;color:#64748b;margin-top:5px">المستحق الإجمالي (تقديري): ' + fmt2(ps.netDue) + '</div></div>';
                        } else {
                          return '<div style="margin-top:10px;border:2px solid #e2e8f0;border-radius:8px;padding:10px 12px;text-align:center;background:#f8fafc">'
                            + '<div style="font-size:10px;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px">الإجراء المطلوب — صفقة جارية</div>'
                            + '<div style="font-size:14px;font-weight:700;color:#64748b">✅ لا يوجد مبلغ إضافي للتحويل حالياً</div>'
                            + '<div style="font-size:11px;color:#64748b;margin-top:5px">المستحق الإجمالي (تقديري): ' + fmt2(ps.netDue) + '</div></div>';
                        }
                      }
                      const bc  = ps.netDue>0.01?'#3b82f6':ps.netDue<-0.01?'#ef4444':'#22c55e';
                      const bg  = ps.netDue>0.01?'#eff6ff':ps.netDue<-0.01?'#fef2f2':'#f0fdf4';
                      const tc  = ps.netDue>0.01?'#1d4ed8':ps.netDue<-0.01?'#dc2626':'#16a34a';
                      const lbl = ps.netDue>0.01?'💸 يُحوَّل له '+fmt2(ps.netDue):ps.netDue<-0.01?'⚠️ مدين للشركة بـ '+fmt2(Math.abs(ps.netDue)):'✅ حساب متوازن';
                      return '<div style="margin-top:10px;border:2px solid '+bc+';border-radius:8px;padding:10px 12px;text-align:center;background:'+bg+'">'
                        + '<div style="font-size:10px;color:#94a3b8;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px">الإجراء المطلوب</div>'
                        + '<div style="font-size:15px;font-weight:800;color:'+tc+'">'+lbl+'</div></div>';
                    })() : ''}

                  </div>
                </div>`;
              }).join('')}
            </div>
            <!-- تسوية المصروفات بين الشركاء -->
            ${(() => {
              const expDebts = (d.partnerSettlement||[]).filter(ps=>ps.expDiff<-0.001);
              const expCreditors = (d.partnerSettlement||[]).filter(ps=>ps.expDiff>0.001);
              if (!expDebts.length || !expCreditors.length) return '';
              return `<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:10px 12px;font-size:12px">
                <div style="font-weight:700;color:#92400e;margin-bottom:6px">💡 تسوية المصروفات بين الشركاء</div>
                ${expDebts.map(debtor => expCreditors.map(creditor => `
                  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                    <span style="background:#fef2f2;color:#dc2626;padding:2px 8px;border-radius:10px;font-weight:700">${debtor.name}</span>
                    <span style="color:#64748b">مدين لـ</span>
                    <span style="background:#f0fdf4;color:#16a34a;padding:2px 8px;border-radius:10px;font-weight:700">${creditor.name}</span>
                    <span style="color:#64748b">بمبلغ</span>
                    <span style="font-family:monospace;font-weight:700;color:#1d4ed8">${fmt2(Math.min(Math.abs(debtor.expDiff),creditor.expDiff))}</span>
                    <span style="color:#94a3b8;font-size:11px">(حصته ${debtor.sharePercent}% من المصروفات دفعها ${creditor.name})</span>
                  </div>`).join('')).join('')}
              </div>`;
            })()}
          </div>` : ''}

          <!-- 💵 تتبع النقدية -->
          ${d.totalSales > 0 ? `
          <div style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">💵 تتبع النقدية</div>
            <div style="background:#f8fafc;border-radius:10px;padding:14px 16px;border:1px solid #e2e8f0">
              <!-- الأرقام الرئيسية الثلاثة -->
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px;text-align:center">
                <div>
                  <div style="font-size:11px;color:#64748b;margin-bottom:3px">إجمالي المبيعات</div>
                  <div style="font-family:monospace;font-weight:700;font-size:15px">${fmt2(d.totalSales)}</div>
                </div>
                <div>
                  <div style="font-size:11px;color:#16a34a;margin-bottom:3px">تم تحصيله</div>
                  <div style="font-family:monospace;font-weight:700;font-size:15px;color:#16a34a">${fmt2(d.totalColl)}</div>
                </div>
                <div>
                  <div style="font-size:11px;color:${d.uncollected>0.001?'#dc2626':'#16a34a'};margin-bottom:3px">${d.uncollected>0.001?'باقي من العملاء':'تحصيل كامل ✓'}</div>
                  <div style="font-family:monospace;font-weight:700;font-size:15px;color:${d.uncollected>0.001?'#dc2626':'#16a34a'}">${fmt2(Math.abs(d.uncollected))}</div>
                </div>
              </div>
              <!-- شريط التقدم -->
              <div style="margin-bottom:${d.collByReceiver.length>1?'12':'0'}px">
                <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:11px">
                  <span style="color:#64748b">نسبة التحصيل</span>
                  <span style="font-weight:700;color:${d.collPct>=100?'#16a34a':d.collPct>=50?'#d97706':'#dc2626'}">${d.collPct.toFixed(1)}%</span>
                </div>
                <div style="background:#e2e8f0;border-radius:10px;height:7px;overflow:hidden">
                  <div style="background:${d.collPct>=100?'#16a34a':'#22c55e'};height:100%;width:${Math.min(100,d.collPct).toFixed(1)}%;border-radius:10px"></div>
                </div>
              </div>
              <!-- توزيع التحصيل حسب المستلم — فقط لو أكثر من مستلم -->
              ${d.collByReceiver.length > 1 ? `
              <div style="border-top:1px solid #e2e8f0;padding-top:10px">
                <div style="font-size:11px;color:#94a3b8;margin-bottom:6px">توزيع التحصيل</div>
                ${d.collByReceiver.map(r => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;font-size:12px">
                  <span style="color:#475569">${r.name}</span>
                  <div style="display:flex;align-items:center;gap:8px">
                    <span style="font-family:monospace;font-weight:600;color:#16a34a">${fmt2(r.amount)}</span>
                    <span style="font-size:10px;color:#94a3b8">${d.totalColl>0?((r.amount/d.totalColl)*100).toFixed(0)+'%':''}</span>
                  </div>
                </div>`).join('')}
              </div>` : ''}
            </div>
          </div>` : ''}

          <!-- الحركات المالية للشريك -->
          <div>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
              <div style="font-size:13px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px">الحركات المالية</div>
              ${d.hasJEPartner
                ? `<span style="font-size:11px;background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:20px;font-weight:700">✅ من القيود المحاسبية</span>`
                : `<span style="font-size:11px;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:20px;font-weight:700">⚠️ بيانات قديمة — الجداول المصدرية</span>`
              }
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr style="background:#1e293b;color:#fff">
                  <th style="padding:8px 10px;text-align:right">التاريخ</th>
                  <th style="padding:8px 10px;text-align:right">البيان</th>
                  <th style="padding:8px 10px;text-align:right">رقم القيد</th>
                  <th style="padding:8px 10px;text-align:center">مدين (سحب)</th>
                  <th style="padding:8px 10px;text-align:center">دائن (إضافة)</th>
                </tr>
              </thead>
              <tbody>
                ${d.jeMovements.length ? d.jeMovements.map(m=>`
                <tr style="border-bottom:1px solid #f1f5f9;background:${m.credit>0?'#eff6ff':'#fff7ed'}">
                  <td style="padding:7px 10px;color:#64748b">${m.date||'—'}</td>
                  <td style="padding:7px 10px;font-weight:600">${m.desc}</td>
                  <td style="padding:7px 10px;font-family:monospace;font-size:11px;color:#94a3b8">${m.ref||'—'}</td>
                  <td style="padding:7px 10px;text-align:center;font-family:monospace;color:${m.debit>0?'#dc2626':'#94a3b8'}">${m.debit>0?fmt2(m.debit):'—'}</td>
                  <td style="padding:7px 10px;text-align:center;font-family:monospace;color:${m.credit>0?'#2563eb':'#94a3b8'};font-weight:${m.credit>0?'700':'400'}">${m.credit>0?fmt2(m.credit):'—'}</td>
                </tr>`).join('')
                : `<tr><td colspan="5" style="padding:12px;text-align:center;color:#94a3b8">لا توجد حركات مسجّلة</td></tr>`}
              </tbody>
              <tfoot>
                <tr style="background:#1e293b;color:#fff;font-weight:700">
                  <td colspan="3" style="padding:8px 10px">الإجمالي</td>
                  <td style="padding:8px 10px;text-align:center;font-family:monospace;color:#fbbf24">${fmt2(d.totalWithdrawn)}</td>
                  <td style="padding:8px 10px;text-align:center;font-family:monospace;color:#60a5fa">${fmt2(d.capitalPaid)}</td>
                </tr>
              </tfoot>
            </table>

          </div>

        </div>
      </div>`).join('');

    // حساب إجمالي الديون للشريك المطلوب عبر كل الصفقات
    const totalOverpaid  = dealDetails.reduce((s,d) => {
      const diff = (d.paidByPartner?.[partnerName]||0) - (d.shouldPayMap?.[partnerName]||0);
      return s + (diff > 0 ? diff : 0);
    }, 0);
    const totalUnderpaid = dealDetails.reduce((s,d) => {
      const diff = (d.paidByPartner?.[partnerName]||0) - (d.shouldPayMap?.[partnerName]||0);
      return s + (diff < 0 ? Math.abs(diff) : 0);
    }, 0);

    // ── الملخص الشامل (لو أكثر من صفقة) ──
    const summaryBlock = dealDetails.length > 1 ? `
      <div style="background:#1a1a2e;color:#fff;border-radius:12px;padding:20px;margin-bottom:24px">
        <div style="font-size:13px;font-weight:700;margin-bottom:14px;opacity:.7;letter-spacing:.5px">الملخص الشامل — كل الصفقات</div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:14px">
          ${dealDetails.map(d=>`
          <div style="background:#ffffff11;border-radius:8px;padding:10px;border-right:3px solid ${d.netDue>=0?'#4ade80':'#f87171'}">
            <div style="font-size:13px;opacity:.7;margin-bottom:4px">${d.fn} — ${d.supplier}</div>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:13px;opacity:.6">حصة ${fmtP(d.share)}</span>
              <span style="font-family:monospace;font-weight:700;color:${d.netDue>=0?'#4ade80':'#f87171'}">${d.netDue>=0?'+':''}${fmt2(d.netDue)}</span>
            </div>
          </div>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;border-top:1px solid #ffffff22;padding-top:14px">
          <div style="text-align:center">
            <div style="font-size:12px;opacity:.6;margin-bottom:4px">إجمالي رأس المال</div>
            <div style="font-family:monospace;font-size:16px;font-weight:700;color:#60a5fa">${fmt2(grandCapital)}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:12px;opacity:.6;margin-bottom:4px">إجمالي الأرباح</div>
            <div style="font-family:monospace;font-size:16px;font-weight:700;color:${grandMyProfit>=0?'#4ade80':'#f87171'}">${fmt2(grandMyProfit)}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:12px;opacity:.6;margin-bottom:4px">إجمالي المسحوبات</div>
            <div style="font-family:monospace;font-size:16px;font-weight:700;color:#fbbf24">${fmt2(grandWithdrawn)}</div>
          </div>
          <div style="text-align:center;background:${grandNetDue>=0?'#16a34a33':'#dc262633'};border-radius:8px;padding:8px">
            <div style="font-size:12px;opacity:.8;margin-bottom:4px">الرصيد الكلي المستحق</div>
            <div style="font-family:monospace;font-size:20px;font-weight:900;color:${grandNetDue>=0?'#4ade80':'#f87171'}">${grandNetDue>=0?'+':''}${fmt2(grandNetDue)}</div>
          </div>
        </div>
        ${(totalOverpaid > 0.001 || totalUnderpaid > 0.001) ? `
        <div style="margin-top:12px;border-top:1px solid #ffffff22;padding-top:12px">
          <div style="font-size:13px;opacity:.7;margin-bottom:8px">⚖️ وضع التسوية مع الشركاء</div>
          ${totalOverpaid > 0.001 ? `
          <div style="background:#16a34a22;border-radius:6px;padding:8px 12px;font-size:12px;margin-bottom:6px">
            <span style="color:#4ade80;font-weight:700">${partnerName}</span>
            <span style="opacity:.8"> دفع زيادة عن حصته بإجمالي </span>
            <span style="font-family:monospace;font-weight:900;color:#4ade80">+${fmt2(totalOverpaid)}</span>
            <span style="opacity:.8"> — يستحق استردادها من الشركاء</span>
          </div>` : ''}
          ${totalUnderpaid > 0.001 ? `
          <div style="background:#dc262622;border-radius:6px;padding:8px 12px;font-size:12px">
            <span style="color:#f87171;font-weight:700">${partnerName}</span>
            <span style="opacity:.8"> لم يدفع كامل حصته — متبقي عليه </span>
            <span style="font-family:monospace;font-weight:900;color:#f87171">${fmt2(totalUnderpaid)}</span>
          </div>` : ''}
        </div>` : `
        <div style="margin-top:10px;border-top:1px solid #ffffff22;padding-top:10px;text-align:center;font-size:13px;opacity:.6">
          ✓ التسوية مع الشركاء مكتملة
        </div>`}

        <!-- الإجراء الإجمالي النهائي -->
        <div style="margin-top:16px;border-top:2px solid #ffffff22;padding-top:16px;text-align:center">
          <div style="font-size:11px;opacity:.5;margin-bottom:6px;letter-spacing:.5px;text-transform:uppercase">الإجراء الإجمالي — كل الصفقات</div>
          <div style="font-size:20px;font-weight:900;color:${grandTransferable>0.01?'#4ade80':grandNetDue<-0.01?'#f87171':'#a3e635'}">
            ${grandTransferable > 0.01
              ? `💸 القابل للتحويل الآن لـ ${partnerName}: ${fmt2(grandTransferable)}`
              : grandNetDue < -0.01
              ? `⚠️ ${partnerName} مدين بـ: ${fmt2(Math.abs(grandNetDue))}`
              : '✅ الحساب متوازن تماماً — لا يوجد تحويل'}
          </div>
          ${Math.abs(grandNetDue - grandTransferable) > 0.01 ? `<div style="font-size:12px;opacity:.6;margin-top:6px">المستحق الإجمالي (عند إغلاق كل الصفقات): ${fmt2(grandNetDue)}</div>` : ''}
        </div>
      </div>` : '';

    // ── التجميع الكامل ──
    const fullHTML = `
      <div id="partnerStatementContent" style="background:var(--bg,#f8fafc);min-width:min(800px,95vw);max-width:900px;font-family:'Cairo',sans-serif;direction:rtl">

        <!-- هيدر الكشف -->
        <div style="background:#1a1a2e;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div style="font-size:22px;font-weight:900;margin-bottom:4px">${partnerName}</div>
            <div style="font-size:13px;opacity:.7">كشف حساب شامل — نظام ${sys}</div>
            <div style="font-size:12px;opacity:.5;margin-top:2px">${fileNoFilter ? 'صفقة: '+fileNoFilter : dealDetails.length+' صفقة'} · ${new Date().toLocaleDateString('en-GB')}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button id="partnerPdfBtn" onclick="exportPartnerStatementPDF()" style="background:#e6930a;color:#000;border:none;border-radius:8px;padding:8px 16px;font-family:'Cairo',sans-serif;font-size:12px;font-weight:700;cursor:pointer">📥 تصدير PDF</button>
            <button onclick="printPartnerStatement()" style="background:#ffffff22;color:#fff;border:1px solid #ffffff44;border-radius:8px;padding:8px 16px;font-family:'Cairo',sans-serif;font-size:12px;cursor:pointer">🖨️ طباعة</button>
            <button onclick="document.getElementById('partnerStatementOverlay').remove()" style="background:#ffffff11;color:#fff;border:none;border-radius:8px;padding:8px 16px;font-family:'Cairo',sans-serif;font-size:12px;cursor:pointer">✕ إغلاق</button>
          </div>
        </div>

        <div style="padding:20px;max-height:75vh;overflow-y:auto">
          ${summaryBlock}
          ${dealBlocks}
        </div>

      </div>`;

    overlay.innerHTML = `<div style="max-height:90vh;overflow:hidden;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.5)">${fullHTML}</div>`;

  } catch(e) {
    overlay.remove();
    toast('خطأ في إعداد الكشف: '+e.message,'err');
    console.error(e);
  }
}

// ── تصدير كشف الشريك PDF ──
async function exportPartnerStatementPDF() {
  const content = document.getElementById('partnerStatementContent');
  if (!content) return;

  const btn = document.getElementById('partnerPdfBtn');
  if (btn) { btn.textContent = '⏳ جاري التصدير...'; btn.disabled = true; }

  try {
    if (!window.html2canvas) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    }
    if (!window.jspdf) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    }

    const { jsPDF } = window.jspdf;

    // ① إخفاء شريط الأزرار أثناء التصدير
    const btnBar = content.querySelector('div[style*="display:flex;gap:8px"]');
    if (btnBar) btnBar.style.visibility = 'hidden';

    // ② فتح الـ inner scrollDiv (max-height:75vh)
    const innerScroll = content.querySelector('div[style*="max-height:75vh"]');
    const origInnerStyle = innerScroll ? innerScroll.style.cssText : null;
    if (innerScroll) { innerScroll.style.maxHeight = 'none'; innerScroll.style.overflow = 'visible'; }

    // ③ فتح الـ outer wrapper (max-height:90vh overflow:hidden)
    const scrollEl = content.closest('[style*="overflow"]');
    const origMaxH    = scrollEl ? scrollEl.style.maxHeight : null;
    const origOverflow = scrollEl ? scrollEl.style.overflow  : null;
    if (scrollEl) { scrollEl.style.maxHeight = 'none'; scrollEl.style.overflow = 'visible'; }

    const canvas = await html2canvas(content, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#1a1a2e',
      logging: false,
      scrollX: 0,
      scrollY: -window.scrollY,
    });

    // ④ إعادة الحالة الأصلية
    if (btnBar)       btnBar.style.visibility = '';
    if (innerScroll && origInnerStyle !== null) innerScroll.style.cssText = origInnerStyle;
    if (scrollEl) { scrollEl.style.maxHeight = origMaxH; scrollEl.style.overflow = origOverflow; }

    const imgData  = canvas.toDataURL('image/jpeg', 0.92);
    const pdf      = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const pageW    = pdf.internal.pageSize.getWidth();
    const pageH    = pdf.internal.pageSize.getHeight();
    const margin   = 10;
    const imgW     = pageW - margin * 2;
    const imgH     = (canvas.height * imgW) / canvas.width;
    const totalPages = Math.ceil(imgH / (pageH - margin * 2));

    for (let i = 0; i < totalPages; i++) {
      if (i > 0) pdf.addPage();
      const srcY  = i * (pageH - margin * 2) * (canvas.width / imgW);
      const sliceH = Math.min((pageH - margin * 2) * (canvas.width / imgW), canvas.height - srcY);
      const sliceCanvas  = document.createElement('canvas');
      sliceCanvas.width  = canvas.width;
      sliceCanvas.height = sliceH;
      sliceCanvas.getContext('2d').drawImage(canvas, 0, srcY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
      const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.92);
      pdf.addImage(sliceData, 'JPEG', margin, margin, imgW, sliceH * (imgW / canvas.width));
    }

    // Build filename
    const partnerName = content.querySelector('[style*="font-size:22px"]')?.textContent?.trim() || 'شريك';
    const dateStr = new Date().toISOString().split('T')[0];
    pdf.save(`كشف_حساب_${partnerName}_${dateStr}.pdf`);
    toast('✅ تم تصدير PDF بنجاح', 'ok');

  } catch(e) {
    toast('خطأ في التصدير: ' + e.message, 'err');
    console.error(e);
  } finally {
    if (btn) { btn.textContent = '📥 تصدير PDF'; btn.disabled = false; }
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// للطباعة
// printPartnerStatement → js/print.js


function openPartnerStatementFromReport() {
  const partner = el('report-partner-select')?.value;
  if (!partner) { toast('اختر شريكاً أولاً','err'); return; }
  showPartnerStatement(partner);
}

// Backward compat
async function showPartnerDealStatement(fileNo, partner, sys) {
  await showPartnerStatement(partner, fileNo);
}

// ════════════════════════════════════════
// CONTACTS BY TYPE SHORTCUT
// ════════════════════════════════════════
function showContactsByType(type) {
  showContacts(type);
}

// ════════════════════════════════════════
// ALL SALES VIEW
// ════════════════════════════════════════
async function showAllSales() {
  hideAllViews();
  el('allSalesView').style.display = 'block';
  el('topBarTitle').textContent = 'كل المبيعات';
  navActive('');
  await loadAllSales();
}

async function loadAllSales() {
  el('allSalesTable').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري التحميل...</div>';
  try {
    await ensureCache();
    const data = [...state.allSales].sort((a,b)=>(b.sale_date||'').localeCompare(a.sale_date||''));
    if (!data?.length) { el('allSalesTable').innerHTML = emptyHTML('🤝','لا توجد مبيعات'); return; }
    const total = data.reduce((s,r)=>s+(+r.sale_price||0),0);
    const rows = data.map(s=>`<tr onclick="openViewer('${s.file_no}')" style="cursor:pointer">
      <td class="mono text-muted">${fmtDate(s.sale_date)}</td>
      <td><span class="mono text-amber">${s.file_no||'—'}</span></td>
      <td class="mono" style="direction:ltr">${s.vin||'—'}</td>
      <td>${s.customer||'—'}</td>
      <td class="mono text-muted">${s.inv_no||'—'}</td>
      <td class="mono text-green">${fmt(s.sale_price)}</td>
    </tr>`).join('');
    el('allSalesTable').innerHTML = `<table class="data-table">
      <thead><tr><th>التاريخ</th><th>الملف</th><th>VIN</th><th>العميل</th><th>الفاتورة</th><th>السعر</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot style="background:var(--card2)"><tr>
        <td colspan="5" style="padding:10px 16px;font-weight:700">الإجمالي (${data.length})</td>
        <td class="mono text-green" style="padding:10px 16px;font-weight:700">${fmt(total)}</td>
      </tr></tfoot></table>`;
  } catch(e) { el('allSalesTable').innerHTML = errHTML(e.message); }
}

// ════════════════════════════════════════
// ALL COLLECTIONS VIEW
// ════════════════════════════════════════
async function showAllCollections() {
  hideAllViews();
  el('allCollectionsView').style.display = 'block';
  el('topBarTitle').textContent = 'كل التحصيلات';
  navActive('');
  await loadAllCollections();
}

async function loadAllCollections() {
  el('allCollectionsTable').innerHTML = '<div class="loading"><div class="spinner"></div><br>جاري التحميل...</div>';
  try {
    await ensureCache();
    // ترتيب: غير محصّل أولاً، ثم حسب تاريخ الاستحقاق
    const data = [...state.allCollections].sort((a,b) => {
      if (!a.paid_date && b.paid_date) return -1;
      if (a.paid_date && !b.paid_date) return 1;
      return (b.due_date||b.paid_date||'').localeCompare(a.due_date||a.paid_date||'');
    });
    if (!data?.length) { el('allCollectionsTable').innerHTML = emptyHTML('💰','لا توجد تحصيلات'); return; }
    const total         = data.reduce((s,r)=>s+(+r.amount||0),0);
    const collectedAmt  = data.filter(r=>r.paid_date).reduce((s,r)=>s+(+r.amount||0),0);
    const pendingAmt    = total - collectedAmt;
    const rows = data.map(r=>{
      const statusBadge = r.paid_date
        ? `<span style="background:var(--green-dim);color:var(--green);padding:1px 7px;border-radius:10px;font-size:12px;font-weight:700">✅ محصّل</span>`
        : `<span style="background:#fef3c7;color:#92400e;padding:1px 7px;border-radius:10px;font-size:12px;font-weight:700">⏳ مستحق</span>`;
      return `<tr onclick="openViewer('${r.file_no}')" style="cursor:pointer">
        <td class="mono text-muted">${fmtDate(r.due_date||'—')}</td>
        <td class="mono text-muted">${r.paid_date ? fmtDate(r.paid_date) : '—'}</td>
        <td><span class="mono text-amber">${r.file_no||'—'}</span></td>
        <td>${r.customer||'—'}</td>
        <td class="mono text-muted">${r.inv_no||'—'}</td>
        <td>${r.pay_method||'—'}</td>
        <td class="mono text-blue">${fmt(r.amount)}</td>
        <td>${statusBadge}</td>
      </tr>`;
    }).join('');
    el('allCollectionsTable').innerHTML = `
      <div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap">
        <div class="j-kpi" style="border-right:3px solid var(--blue)"><div class="j-kpi-label">إجمالي</div><div class="j-kpi-val text-blue">${fmt(total)}</div></div>
        <div class="j-kpi" style="border-right:3px solid var(--green)"><div class="j-kpi-label">✅ محصّل</div><div class="j-kpi-val text-green">${fmt(collectedAmt)}</div></div>
        <div class="j-kpi" style="border-right:3px solid var(--accent)"><div class="j-kpi-label">⏳ مستحق</div><div class="j-kpi-val" style="color:${pendingAmt>0?'var(--accent)':'var(--green)'}">${fmt(pendingAmt)}</div></div>
      </div>
      <table class="data-table">
        <thead><tr><th>الاستحقاق</th><th>تاريخ الدفع</th><th>الملف</th><th>العميل</th><th>الفاتورة</th><th>الطريقة</th><th>المبلغ</th><th>الحالة</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot style="background:var(--card2)"><tr>
          <td colspan="6" style="padding:10px 16px;font-weight:700">الإجمالي (${data.length})</td>
          <td class="mono text-blue" style="padding:10px 16px;font-weight:700">${fmt(total)}</td>
          <td></td>
        </tr></tfoot>
      </table>`;
  } catch(e) { el('allCollectionsTable').innerHTML = errHTML(e.message); }
}

// ════════════════════════════════════════
// REPORTS
// ════════════════════════════════════════
const reportState = { type:'profit', data:[] };

async function apiGetDateRange(table, dateCol, from, to, extra={}) {
  const sys = state.system;
  const baseParams = `${dateCol}=gte.${encodeURIComponent(from)}&${dateCol}=lte.${encodeURIComponent(to)}`;
  const extraStr = Object.entries(extra).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');
  const makeUrl = (sysParam) => {
    return `${SB_URL}/rest/v1/${table}?system_type=${sysParam}&${baseParams}${extraStr?'&'+extraStr:''}`;
  };
  try {
    const [r1, r2] = await Promise.all([
      fetch(makeUrl(`eq.${sys}`),  { headers: headers({'Range':'0-49999','Range-Unit':'items'}) }),
      fetch(makeUrl('is.null'),    { headers: headers({'Range':'0-49999','Range-Unit':'items'}) }),
    ]);
    const [d1, d2] = await Promise.all([r1.ok?r1.json():[], r2.ok?r2.json():[]]);
    const seen = new Set();
    const out  = [];
    [...(d1||[]),...(d2||[])].forEach(r => {
      const k = r.id ?? JSON.stringify(r);
      if (!seen.has(k)) { seen.add(k); out.push(r); }
    });
    return out;
  } catch(e) { console.error('apiGetDateRange error:', e); return []; }
}

// REPORTS ENGINE: setReportPeriod / setReportType / runReport — تعريفاتها في reports.js


// ── Inventory table renderer ──────────────────────────────
function _renderInventoryTable(list) {
  const tableEl = el('reportTable');
  if (!tableEl) return;
  const rows = list.map(v=>`<tr>
    <td><span class="file-badge">${v.file_no||'—'}</span></td><td>${v._supplier}</td>
    <td>${v.vehicle_type||'—'}</td><td>${v.model||'—'} ${v.year||''}</td>
    <td style="direction:ltr;font-family:monospace;font-size:13px">${v.vin||'—'}</td>
    <td>${v.color||'—'}</td><td class="mono">${fmt(v.purchase_price)}</td>
    <td>${v._warehouse}</td>
    <td><span class="status-badge ${v._sold?'closed':'open'}">${v._sold?'مباع':'في المخزن'}</span></td>
    <td>${v._saleInfo?.customer||'—'}</td>
  </tr>`).join('');
  const total  = list.length;
  const sold   = list.filter(v=>v._sold).length;
  const invVal = list.filter(v=>!v._sold).reduce((s,v)=>s+(+v.purchase_price||0),0);
  tableEl.innerHTML = `<table class="data-table">
    <thead><tr><th>الملف</th><th>المورد</th><th>النوع</th><th>الموديل</th><th>VIN</th><th>اللون</th><th>سعر الشراء</th><th>المخزن</th><th>الحالة</th><th>العميل</th></tr></thead>
    <tbody>${rows||_noData(10)}</tbody>
    <tfoot><tr>
      <td colspan="6" style="padding:10px 16px;font-weight:700">الإجمالي: ${total} سيارة — ${sold} مباعة — ${total-sold} في المخزن</td>
      <td class="mono" style="font-weight:700">${fmt(invVal)}</td><td colspan="3"></td>
    </tr></tfoot>
  </table>`;
}

// filterInventoryByWarehouse — النسخة الصح في ملف آخر


// ── مساعد لجلب تواريخ التقرير الحالية ──────────────────
function _reportDates() {
  const from = el('r-from')?.value || '';
  const to   = el('r-to')?.value   || '';
  return { from, to };
}

// ── CSV export ────────────────────────────────────────────
// exportReportCSV — النسخة الصح في ملف آخر


// ── print current report ──────────────────────────────────
// (overrides the stub in printCurrentReport that used reportState.data)
// printCurrentReport already defined above — it reads reportState.data which is now populated ✅

// ── Helper ────────────────────────────────────────────────
function _noData(cols) {
  return `<tr><td colspan="${cols}" style="text-align:center;padding:32px;color:var(--text2)">لا توجد بيانات في هذه الفترة</td></tr>`;
}
