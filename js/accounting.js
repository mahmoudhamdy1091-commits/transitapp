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
            + `&select=account_code,account_name,dr_amount,cr_amount,post_status&limit=49999`;
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
  try {
    const sys=state.system;
    const url=`${SB_URL}/rest/v1/journal_entries?system_type=eq.${encodeURIComponent(sys)}&account_code=eq.${encodeURIComponent(accountCode)}&select=*&order=entry_date.asc,id.asc&limit=5000`;
    let res=await fetch(url,{headers:headers()});
    if(res.status===401){const ok=await refreshAccessToken();if(!ok){el('ledgerTable').innerHTML=errHTML('انتهت الجلسة');return;}res=await fetch(url,{headers:headers()});}
    const rows=res.ok?await res.json():[];
    window._ledgerAllEntries=(rows||[]).map(r=>({
      id:r.id,date:(r.entry_date||'').split('T')[0],type:r.ref_table||'manual',
      desc:r.description||'—',ref:r.entry_no||'',debit:+r.dr_amount||0,
      credit:+r.cr_amount||0,file_no:r.file_no||'',contact:r.contact_name||'',status:r.post_status||'posted',
    }));
    window._ledgerOpening=0;
    const fileNos=[...new Set((rows||[]).map(r=>r.file_no).filter(Boolean))].sort();
    const sel=el('ledger-file-filter');
    if(sel) sel.innerHTML='<option value="">كل الصفقات</option>'+fileNos.map(f=>`<option value="${f}">${f}</option>`).join('');
    el('ledgerView').dataset.contactName=accountName;
    el('ledgerView').dataset.accountCode=accountCode;
    _setPeriodBtns('ldg',ledgerState.period||'all');
    renderLedgerTable();
  } catch(e){el('ledgerTable').innerHTML=errHTML('خطأ: '+e.message);}
}

function renderLedgerTable() {
  const fileFilter=el('ledger-file-filter')?.value||'';
  const postFilter=el('ledger-post-filter')?.value||'posted';
  const from=el('ldg-from')?.value||null;
  const to=el('ldg-to')?.value||null;
  let list=window._ledgerAllEntries||[];
  const opening=window._ledgerOpening||0;
  if(fileFilter) list=list.filter(e=>e.file_no===fileFilter);
  if(postFilter==='posted') list=list.filter(e=>e.status==='posted');
  if(postFilter==='draft')  list=list.filter(e=>e.status==='draft');
  if(from) list=list.filter(e=>e.date>=from);
  if(to)   list=list.filter(e=>e.date<=to);
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
        ${e.contact?`<div style="font-size:12px;color:var(--text2)">${e.contact}</div>`:''}
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

// ════ ENTRY STATUS ════
function isAdminUser() { return _currentRole === 'admin'; }
function adminPostsImmediately() { return localStorage.getItem('tm_admin_post') === 'posted'; }
function entryStatus() { return (isAdminUser() && adminPostsImmediately()) ? 'posted' : 'draft'; }
function toggleAdminPostSetting() {
  const v = adminPostsImmediately() ? 'draft' : 'posted';
  localStorage.setItem('tm_admin_post', v);
  updateAdminPostToggleUI();
  toast(v==='draft'?'✅ إدخالات المدير ستحتاج موافقة':'✅ إدخالات المدير ستُرحَّل فوراً','ok');
}
function updateAdminPostToggleUI() {
  const im=adminPostsImmediately(),t=document.getElementById('adminPostToggle'),k=document.getElementById('adminPostKnob'),l=document.getElementById('adminPostLabel');
  if(!t)return; t.style.background=im?'var(--green)':'var(--border2)';
  if(k)k.style.transform=im?'translateX(0)':'translateX(-18px)';
  if(l)l.textContent=im?'ترحيل فوري ✓':'يحتاج موافقة';
}

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
  const from = el('jDateFrom')?.value || today();
  const to   = el('jDateTo')?.value   || today();
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
    const soldVins     = new Set((sales||[]).filter(isPosted).map(s=>s.vin));
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
      const fn = pm.file_no;
      const share = (pm.share_percent||0) / 100;

      const [po, vehicles, expenses, sales, allPartners, payments, payouts] = await Promise.all([
        apiGetAll('purchase_orders', { select:'*',       system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
        apiGetAll('vehicles', { select:'*',       system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
        apiGetAll('expenses', { select:'*',       system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
        apiGetAll('sales', { select:'*',       system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
        apiGetAll('partners_master', { select:'*',       system_type:`eq.${sys}`, file_no:`eq.${fn}` }),
        apiGetAll('payments', { select:'*',       system_type:`eq.${sys}`, file_no:`eq.${fn}`, payer:`eq.${partnerName}` }),
        apiGetAll('partner_payouts', { select:'*',       system_type:`eq.${sys}`, file_no:`eq.${fn}`, partner:`eq.${partnerName}` }),
      ]);

      const poData       = po?.[0] || {};
      const totalPurchase= +poData.total_purchase || (vehicles||[]).reduce((s,v)=>s+(+v.purchase_price||0),0);
      const totalExp     = (expenses||[]).filter(isPosted).reduce((s,e)=>s+(+e.amount||0),0);
      const totalSales   = (sales||[]).filter(isPosted).reduce((s,s2)=>s+(+s2.sale_price||0),0);
      const fullCost     = totalPurchase + totalExp;
      const dealProfit   = totalSales - fullCost;

      // حصة الشريك
      const myPurchase   = totalPurchase * share;
      const myExpenses   = totalExp * share;
      const myFullCost   = fullCost * share;
      const mySales      = totalSales * share;
      const myProfit     = dealProfit * share;

      // ما دفعه الشريك — استثناء الملغية
      // لو شريك واحد بحصة 100% → كل دفعات الملف تخصه
      // لو أكثر من شريك → نفلتر بالاسم
      const allPartnersCount = (allPartners||[]).length;
      // ✅ pending_edit = مرحّلة في طور التعديل → تُحسب
      const capitalPaid  = (payments||[])
        .filter(isEffective)
        .filter(p => allPartnersCount <= 1 || p.payer === partnerName)
        .reduce((s,p)=>s+(+p.amount||0),0);

      // ما استرده
      const capitalRet   = (payouts||[]).reduce((s,p)=>s+(+p.capital_amount||0),0);
      const profitTaken  = (payouts||[]).reduce((s,p)=>s+(+p.profit_amount||0),0);
      const advances     = (payouts||[]).reduce((s,p)=>s+(+p.advance_amount||0),0);
      const totalWithdrawn = capitalRet + profitTaken + advances;

      // الرصيد المستحق
      const netDue = capitalPaid + myProfit - totalWithdrawn;

      // ما دفعه كل شركاء الصفقة (مش بس الشريك المطلوب)
      const allPartnersPayments = await apiGetAll('payments', {
        select:'payer,amount,post_status', system_type:`eq.${sys}`, file_no:`eq.${fn}`
      });

      // احسب ما دفعه كل شريك فعلاً — استثناء الملغية
      const paidByPartner = {};
      (allPartnersPayments||[]).filter(isEffective).forEach(p => {
        paidByPartner[p.payer] = (paidByPartner[p.payer]||0) + (+p.amount||0);
      });

      // حصة كل شريك المفروض يدفعها
      const shouldPayMap = {};
      (allPartners||[]).forEach(p => {
        shouldPayMap[p.partner] = totalPurchase * ((+p.share_percent||0)/100);
      });

      // الديون بين الشركاء
      const partnerDebts = [];
      (allPartners||[]).forEach(p => {
        const name      = p.partner;
        const shouldPay = shouldPayMap[name] || 0;
        const didPay    = paidByPartner[name] || 0;
        const diff      = didPay - shouldPay; // موجب = دفع زيادة، سالب = دفع أقل
        if (Math.abs(diff) > 0.001) {
          partnerDebts.push({ name, shouldPay, didPay, diff });
        }
      });

      return {
        fn, share, poData, vehicles: vehicles||[], expenses: expenses||[],
        sales: sales||[], allPartners: allPartners||[],
        payments: payments||[], payouts: payouts||[],
        totalPurchase, totalExp, totalSales, fullCost, dealProfit,
        myPurchase, myExpenses, myFullCost, mySales, myProfit,
        capitalPaid, capitalRet, profitTaken, advances, totalWithdrawn, netDue,
        status: poData.status || '—', supplier: poData.supplier || '—',
        poDate: poData.po_date || poData.created_at || '',
        partnerDebts, paidByPartner, shouldPayMap,
      };
    }));

    // ── 3. الإجماليات الشاملة ──
    const grandCapital    = dealDetails.reduce((s,d)=>s+d.capitalPaid,   0);
    const grandMyProfit   = dealDetails.reduce((s,d)=>s+d.myProfit,      0);
    const grandWithdrawn  = dealDetails.reduce((s,d)=>s+d.totalWithdrawn,0);
    const grandNetDue     = dealDetails.reduce((s,d)=>s+d.netDue,        0);
    const grandDealProfit = dealDetails.reduce((s,d)=>s+d.dealProfit,    0);

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

          <!-- المصاريف -->
          ${d.expenses.length ? `
          <div style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
              المصاريف (${d.expenses.length} بند)
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr style="background:#fff1f2">
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #fecaca;color:#dc2626">البيان</th>
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #fecaca;color:#dc2626">النوع</th>
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #fecaca;color:#dc2626">التاريخ</th>
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #fecaca;color:#dc2626">المبلغ</th>
                  <th style="padding:6px 10px;text-align:right;border-bottom:1px solid #fecaca;color:#dc2626">حصة الشريك</th>
                </tr>
              </thead>
              <tbody>
                ${d.expenses.map(e=>`
                <tr style="border-bottom:1px solid #fff1f2">
                  <td style="padding:6px 10px">${e.description||'—'}</td>
                  <td style="padding:6px 10px"><span style="background:#fef2f2;color:#dc2626;padding:1px 6px;border-radius:10px;font-size:12px">${e.exp_type||e.category||'—'}</span></td>
                  <td style="padding:6px 10px;color:#94a3b8">${(e.expense_date||e.exp_date||'').split('T')[0]||'—'}</td>
                  <td style="padding:6px 10px;font-family:monospace;color:#dc2626">${fmt2(e.amount)}</td>
                  <td style="padding:6px 10px;font-family:monospace;color:#dc2626">${fmt2((+e.amount||0)*d.share)}</td>
                </tr>`).join('')}
                <tr style="background:#fff1f2;font-weight:700">
                  <td colspan="3" style="padding:7px 10px;color:#dc2626">إجمالي المصاريف</td>
                  <td style="padding:7px 10px;font-family:monospace;color:#dc2626">${fmt2(d.totalExp)}</td>
                  <td style="padding:7px 10px;font-family:monospace;color:#dc2626">${fmt2(d.myExpenses)}</td>
                </tr>
              </tbody>
            </table>
          </div>` : ''}

          <!-- المبيعات -->
          ${d.sales.length ? `
          <div style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
              المبيعات (${d.sales.length} فاتورة)
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
                ${d.sales.map(s=>`
                <tr style="border-bottom:1px solid #f0fdf4">
                  <td style="padding:6px 10px;font-family:monospace;color:#2563eb;font-size:13px">${s.vin||'—'}</td>
                  <td style="padding:6px 10px">${s.customer||'—'}</td>
                  <td style="padding:6px 10px;color:#94a3b8">${(s.sale_date||'').split('T')[0]||'—'}</td>
                  <td style="padding:6px 10px;font-family:monospace;color:#16a34a;font-weight:700">${fmt2(s.sale_price)}</td>
                  <td style="padding:6px 10px;font-family:monospace;color:#16a34a">${fmt2((+s.sale_price||0)*d.share)}</td>
                </tr>`).join('')}
                <tr style="background:#f0fdf4;font-weight:700">
                  <td colspan="3" style="padding:7px 10px;color:#16a34a">إجمالي المبيعات</td>
                  <td style="padding:7px 10px;font-family:monospace;color:#16a34a">${fmt2(d.totalSales)}</td>
                  <td style="padding:7px 10px;font-family:monospace;color:#16a34a">${fmt2(d.mySales)}</td>
                </tr>
              </tbody>
            </table>
          </div>` : ''}

          <!-- ملخص الصفقة للشريك -->
          <div style="background:#f8fafc;border-radius:10px;padding:14px;margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#888;margin-bottom:10px">ملخص الصفقة — حصة ${partnerName} (${fmtP(d.share)})</div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
              <div style="background:#fff;border-radius:8px;padding:10px;text-align:center;border:1px solid #e2e8f0">
                <div style="font-size:12px;color:#888;margin-bottom:4px">حصته من تكلفة الشراء</div>
                <div style="font-family:monospace;font-weight:700;color:#2563eb">${fmt2(d.myPurchase)}</div>
              </div>
              <div style="background:#fff;border-radius:8px;padding:10px;text-align:center;border:1px solid #e2e8f0">
                <div style="font-size:12px;color:#888;margin-bottom:4px">حصته من المصاريف</div>
                <div style="font-family:monospace;font-weight:700;color:#dc2626">${fmt2(d.myExpenses)}</div>
              </div>
              <div style="background:#fff;border-radius:8px;padding:10px;text-align:center;border:1px solid #e2e8f0">
                <div style="font-size:12px;color:#888;margin-bottom:4px">حصته من المبيعات</div>
                <div style="font-family:monospace;font-weight:700;color:#16a34a">${fmt2(d.mySales)}</div>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
              <div style="background:${d.myProfit>=0?'#f0fdf4':'#fff1f2'};border-radius:8px;padding:10px;text-align:center;border:1px solid ${d.myProfit>=0?'#86efac':'#fca5a5'}">
                <div style="font-size:12px;color:#888;margin-bottom:4px">ربح / خسارة الشريك</div>
                <div style="font-family:monospace;font-weight:900;font-size:16px;color:${d.myProfit>=0?'#16a34a':'#dc2626'}">${d.myProfit>=0?'+':''}${fmt2(d.myProfit)}</div>
              </div>
              <div style="background:#f0fdf4;border-radius:8px;padding:10px;text-align:center;border:1px solid #86efac">
                <div style="font-size:12px;color:#888;margin-bottom:4px">ربح الصفقة الكلي</div>
                <div style="font-family:monospace;font-weight:700;color:${d.dealProfit>=0?'#16a34a':'#dc2626'}">${fmt2(d.dealProfit)}</div>
              </div>
            </div>
          </div>

          <!-- ديون بين الشركاء -->
          ${d.partnerDebts && d.partnerDebts.length ? `
          <div style="margin-bottom:14px">
            <div style="font-size:13px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">⚖️ تسوية بين الشركاء</div>
            <div style="background:#f8fafc;border-radius:8px;padding:12px;border:1px solid #e2e8f0">
              <table style="width:100%;border-collapse:collapse;font-size:12px">
                <thead>
                  <tr style="background:#f1f5f9">
                    <th style="padding:7px 10px;text-align:right;color:#64748b">الشريك</th>
                    <th style="padding:7px 10px;text-align:right;color:#64748b">حصته المفروض</th>
                    <th style="padding:7px 10px;text-align:right;color:#64748b">دفع فعلاً</th>
                    <th style="padding:7px 10px;text-align:right;color:#64748b">الفرق</th>
                    <th style="padding:7px 10px;text-align:right;color:#64748b">الوضع</th>
                  </tr>
                </thead>
                <tbody>
                  ${(d.allPartners||[]).map(p => {
                    const should = d.shouldPayMap[p.partner] || 0;
                    const did    = d.paidByPartner[p.partner] || 0;
                    const diff   = did - should;
                    const isMe   = p.partner === partnerName;
                    return `<tr style="border-bottom:1px solid #f1f5f9;${isMe?'background:#fef9ec;font-weight:700':''}">
                      <td style="padding:7px 10px">${p.partner}${isMe?' ★':''}</td>
                      <td style="padding:7px 10px;font-family:monospace">${fmt2(should)}</td>
                      <td style="padding:7px 10px;font-family:monospace">${fmt2(did)}</td>
                      <td style="padding:7px 10px;font-family:monospace;color:${diff>0?'#16a34a':diff<0?'#dc2626':'#64748b'};font-weight:700">
                        ${diff>0?'+':''}${fmt2(diff)}
                      </td>
                      <td style="padding:7px 10px">
                        ${diff > 0.001 
                          ? `<span style="background:#f0fdf4;color:#16a34a;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:700">دفع زيادة — يستحق ${fmt2(diff)}</span>`
                          : diff < -0.001
                          ? `<span style="background:#fef2f2;color:#dc2626;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:700">مدين بـ ${fmt2(Math.abs(diff))}</span>`
                          : `<span style="background:#f0fdf4;color:#16a34a;padding:2px 8px;border-radius:10px;font-size:12px;font-weight:700">✓ مسوّى</span>`}
                      </td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
              ${d.partnerDebts.length ? `
              <div style="margin-top:10px;padding:10px;background:#fff;border-radius:6px;border:1px solid #e2e8f0;font-size:12px">
                ${d.partnerDebts.filter(x=>x.diff>0).map(creditor => {
                  const debtors = d.partnerDebts.filter(x=>x.diff<0);
                  return debtors.map(debtor => `
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                      <span style="color:#dc2626;font-weight:700">${debtor.name}</span>
                      <span style="color:#64748b">مدين لـ</span>
                      <span style="color:#16a34a;font-weight:700">${creditor.name}</span>
                      <span style="color:#64748b">بمبلغ</span>
                      <span style="font-family:monospace;font-weight:700;color:#1d4ed8">${fmt2(Math.min(Math.abs(debtor.diff), creditor.diff))}</span>
                    </div>`).join('');
                }).join('')}
              </div>` : ''}
            </div>
          </div>` : ''}

          <!-- الحركات المالية للشريك -->
          <div>
            <div style="font-size:13px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">الحركات المالية</div>
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr style="background:#1e293b;color:#fff">
                  <th style="padding:8px 10px;text-align:right">التاريخ</th>
                  <th style="padding:8px 10px;text-align:right">البيان</th>
                  <th style="padding:8px 10px;text-align:center">رأس مال دفع</th>
                  <th style="padding:8px 10px;text-align:center">رأس مال استرد</th>
                  <th style="padding:8px 10px;text-align:center">أرباح</th>
                  <th style="padding:8px 10px;text-align:center">سلف</th>
                  <th style="padding:8px 10px;text-align:right">مستند</th>
                </tr>
              </thead>
              <tbody>
                ${d.payments.map(p=>`
                <tr style="background:#eff6ff;border-bottom:1px solid #dbeafe">
                  <td style="padding:7px 10px;color:#64748b">${(p.pay_date||'').split('T')[0]||'—'}</td>
                  <td style="padding:7px 10px;font-weight:600;color:#1d4ed8">دفع رأس مال</td>
                  <td style="padding:7px 10px;text-align:center;font-family:monospace;color:#2563eb;font-weight:700">${fmt2(p.amount)}</td>
                  <td style="padding:7px 10px;text-align:center;color:#94a3b8">—</td>
                  <td style="padding:7px 10px;text-align:center;color:#94a3b8">—</td>
                  <td style="padding:7px 10px;text-align:center;color:#94a3b8">—</td>
                  <td style="padding:7px 10px;font-family:monospace;font-size:13px;color:#94a3b8">${p.document||p.ref_no||'—'}</td>
                </tr>`).join('')}
                ${d.payouts.map(p=>`
                <tr style="border-bottom:1px solid #f1f5f9">
                  <td style="padding:7px 10px;color:#64748b">${(p.pay_date||'').split('T')[0]||'—'}</td>
                  <td style="padding:7px 10px;font-weight:600">${p.payout_type||'صرف'}</td>
                  <td style="padding:7px 10px;text-align:center;color:#94a3b8">—</td>
                  <td style="padding:7px 10px;text-align:center;font-family:monospace;color:${+p.capital_amount?'#d97706':'#94a3b8'}">${+p.capital_amount?fmt2(p.capital_amount):'—'}</td>
                  <td style="padding:7px 10px;text-align:center;font-family:monospace;color:${+p.profit_amount?'#16a34a':'#94a3b8'}">${+p.profit_amount?fmt2(p.profit_amount):'—'}</td>
                  <td style="padding:7px 10px;text-align:center;font-family:monospace;color:${+p.advance_amount?'#dc2626':'#94a3b8'}">${+p.advance_amount?fmt2(p.advance_amount):'—'}</td>
                  <td style="padding:7px 10px;font-family:monospace;font-size:13px;color:#94a3b8">${p.document||p.pay_id||'—'}</td>
                </tr>`).join('')}
              </tbody>
              <tfoot>
                <tr style="background:#1e293b;color:#fff;font-weight:700">
                  <td colspan="2" style="padding:8px 10px">الإجمالي</td>
                  <td style="padding:8px 10px;text-align:center;font-family:monospace;color:#60a5fa">${fmt2(d.capitalPaid)}</td>
                  <td style="padding:8px 10px;text-align:center;font-family:monospace;color:#fbbf24">${fmt2(d.capitalRet)}</td>
                  <td style="padding:8px 10px;text-align:center;font-family:monospace;color:#4ade80">${fmt2(d.profitTaken)}</td>
                  <td style="padding:8px 10px;text-align:center;font-family:monospace;color:#f87171">${fmt2(d.advances)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>

            <!-- الرصيد النهائي للصفقة -->
            <div style="margin-top:10px;background:${d.netDue>=0?'#f0fdf4':'#fff1f2'};border:2px solid ${d.netDue>=0?'#86efac':'#fca5a5'};border-radius:10px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center">
              <div>
                <div style="font-size:12px;color:#64748b;margin-bottom:2px">الرصيد المستحق للشريك من هذه الصفقة</div>
                <div style="font-size:12px;color:#94a3b8">رأس مال مدفوع + أرباح - إجمالي المسحوبات</div>
                <div style="font-size:12px;color:#94a3b8">${fmt2(d.capitalPaid)} + ${fmt2(d.myProfit)} - ${fmt2(d.totalWithdrawn)}</div>
              </div>
              <div style="font-size:24px;font-weight:900;font-family:monospace;color:${d.netDue>=0?'#16a34a':'#dc2626'}">${d.netDue>=0?'+':''}${fmt2(d.netDue)}</div>
            </div>
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
    // Load libraries if not loaded
    if (!window.html2canvas) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    }
    if (!window.jspdf) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    }

    const { jsPDF } = window.jspdf;

    // Temporarily expand content for capture
    const scrollEl = content.closest('[style*="overflow"]');
    const origMaxH = scrollEl ? scrollEl.style.maxHeight : null;
    const origOverflow = scrollEl ? scrollEl.style.overflow : null;
    if (scrollEl) { scrollEl.style.maxHeight = 'none'; scrollEl.style.overflow = 'visible'; }

    const canvas = await html2canvas(content, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#f8fafc',
      logging: false,
      scrollX: 0,
      scrollY: -window.scrollY,
    });

    // Restore
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
