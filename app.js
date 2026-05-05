(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const state = { user: null, route: 'home', authMode: 'login', dashboard: null, chatTarget: null, friends: null, chatTimer: 0 };
  const page = $('#page');
  const toastEl = $('#toast');

  function toast(msg, ms = 3200) { toastEl.textContent = msg; toastEl.classList.remove('hidden'); clearTimeout(toastEl._t); toastEl._t = setTimeout(() => toastEl.classList.add('hidden'), ms); }
  async function api(path, options = {}) {
    const res = await fetch(path, { credentials: 'same-origin', headers: options.body instanceof FormData ? undefined : { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error((data && data.error) || data || 'Request failed');
    return data;
  }
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dateShort = v => v ? new Date(v).toLocaleString('th-TH') : '-';
  const roleLabel = u => (u && u.role === 'owner') ? 'Owner' : (u && u.role === 'admin') ? 'Admin' : 'Member';
  function requireLogin() { if (!state.user) { openAuth('login'); return false; } return true; }
  function isAdmin() { return state.user && ['owner', 'admin'].includes(state.user.role); }

  function userChip() {
    if (!state.user) return `<button class="soft" id="btn-login">เข้าสู่ระบบ</button><button class="primary" id="btn-register">สมัครฟรี</button>`;
    return `<a href="#dashboard" class="soft">${esc(state.user.name)} · ${Number(state.user.credits || 0)} เครดิต</a><button class="ghost" id="btn-logout">ออก</button>`;
  }
  function renderNav() {
    const nav = $('#nav-links');
    nav.innerHTML = `
      <a href="#services">บริการ</a><a href="#marketplace">หาคนทำมีเดีย</a><a href="#ai">AI Studio</a><a href="#sponsors">Sponsor Hub</a><a href="/editor.html">Cloud Editor</a><a href="#credits">เครดิต</a>${isAdmin() ? '<a href="#admin">Admin</a>' : ''}`;
    $('#nav-actions').innerHTML = `<button class="ghost" id="btn-open-chat">แชท</button>${userChip()}`;
  }

  function hero() {
    return `<section class="hero page-wrap" id="home">
      <div>
        <span class="eyebrow">Sowwan Studio Platform</span>
        <h1>เว็บหลักที่พร้อมต่อยอดเป็น <span class="grad">ธุรกิจมีเดียครบวงจร V4</span></h1>
        <p class="muted">รวม Cloud Video Editor Version 4, ระบบเครดิตเรนเดอร์, งานวิดีโอ/เสียง/พากย์/ดนตรี/ภาพนิ่ง, AI Video/Voice Studio, Sponsor Hub, Admin Workspace และแชทในระบบเดียว</p>
        <div class="hero-actions">
          <a class="primary" href="/editor.html">เปิด Cloud Editor</a>
          <a class="gold" href="#marketplace">จ้างคนตัดต่อ</a>
          <a class="soft" href="#credits">ดูระบบเครดิต</a>
        </div>
        <div class="tabs-inline"><span class="badge green">480p ฟรี + ลายน้ำ</span><span class="badge gold">1080p = 5 เครดิต</span><span class="badge">งานผ่าน Marketplace ไม่คิดเครดิต Render</span></div>
      </div>
      <div class="hero-card glass"><div class="mini-editor"><div class="mini-top"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div><div class="preview-mock"></div><div class="timeline-mock"><div class="track"><span class="clip gold" style="left:12%;width:36%"></span></div><div class="track"><span class="clip" style="left:4%;width:68%"></span></div><div class="track"><span class="clip green" style="left:0;width:84%"></span></div></div><div class="callout" style="margin-top:18px">ระบบนี้เป็น Pure Node.js 100% ไม่มี Express/React/Next พร้อมรันทดสอบทันที</div></div></div>
    </section>`;
  }
  function services() {
    return `<section class="section page-wrap" id="services"><div class="section-head"><div><span class="eyebrow">Business Modules</span><h2>แบ่งครบทุกส่วนที่ต้องใช้จริง</h2></div><p class="muted">แต่ละการ์ดไม่ได้เป็นแค่ปุ่มลอย ๆ แต่เชื่อมไปยังหน้าที่มี API และฐานข้อมูล JSON ฝั่ง Node ให้ทดสอบได้จริง</p></div><div class="cards">
      ${card('🎬','Cloud Video Editor','ตัดต่อออนไลน์ Multi-track, autosave, render ผ่าน FFmpeg','เปิดตัวตัดต่อ','/editor.html',['ฟรี 480p มีลายน้ำ','1080p 5 เครดิต','งานผ่าน marketplace render ฟรี'])}
      ${card('🧑‍💻','Creator & Media Marketplace','คนเก่งงานตัดต่อ/มีเดียสมัครเป็น freelancer เพื่อรับงานจากลูกค้า','ไป Marketplace','#marketplace',['โปรไฟล์คนทำงาน','ลูกค้าลงบรีฟงาน','ระบบสมัคร/มอบหมายงาน'])}
      ${card('🤖','AI Studio','หน้าเตรียมเชื่อม API เจนสคริปต์ ภาพ วิดีโอ และ prompt','เปิด AI Studio','#ai',['เชื่อม OpenAI ได้ด้วย .env','เตรียม connector ภาพ/วิดีโอ','เก็บประวัติ AI jobs'])}
      ${card('💎','Sponsor Hub','ตัวกลางระหว่างแบรนด์/สปอนเซอร์กับอินฟลูเอนเซอร์','เปิด Sponsor Hub','#sponsors',['ลงแคมเปญ','อินฟลูสมัครงาน','แอดมินติดตามได้'])}
      ${card('💳','Credit Billing','คิดค่าเรนเดอร์รายครั้ง รองรับคำขอเติมเครดิต และหลังบ้านอนุมัติ','จัดการเครดิต','#credits',['ledger เครดิต','คำขอเติมเครดิต','admin ปรับยอดได้'])}
      ${card('💬','Popup Chat','ผู้ใช้ค้นหาเพื่อน เพิ่มเพื่อน และแชทกันในเว็บ','เปิดแชท','#chat',['friend request','ข้อความ real-time แบบ polling','ใช้ได้บนมือถือ'])}
    </div></section>`;
  }
  function card(icon, title, text, cta, href, items) { return `<article class="card"><div class="icon">${icon}</div><h3>${esc(title)}</h3><p>${esc(text)}</p><ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p style="margin-top:20px"><a class="soft" href="${href}">${esc(cta)}</a></p></article>`; }

  async function renderHome() { page.innerHTML = hero() + services() + `<section class="section page-wrap"><div class="section-head"><div><span class="eyebrow">Launch Plan</span><h2>แนวคิดธุรกิจที่วางไว้</h2></div></div><div class="split"><div class="panel glass"><h3>รายได้หลัก</h3><p class="muted">1) ขายเครดิตเรนเดอร์ 1080p/4K 2) หักเปอร์เซ็นต์งาน marketplace 3) ระบบ sponsor hub 4) AI tools รายครั้งหรือแพ็กเกจ</p></div><div class="panel glass"><h3>กติกาเรนเดอร์</h3><p class="muted">ผู้ใช้ทั่วไปใช้ฟรีได้ 480p พร้อมลายน้ำ ส่วน 1080p ช่วงทดลองใช้คิด 5 เครดิต แต่งานที่เข้ามาผ่านระบบตัวกลางของเรา ไม่คิดเครดิตเรนเดอร์กับคนทำงาน เพราะเราไปหักเปอร์เซ็นต์จากงานนั้นแทน</p></div></div></section>`; }

  async function renderDashboard() {
    if (!requireLogin()) return renderHome();
    const data = await api('/api/dashboard'); state.dashboard = data; state.user = data.user; renderNav();
    page.innerHTML = `<section class="section page-wrap"><div class="section-head"><div><span class="eyebrow">Dashboard</span><h2>สวัสดี ${esc(data.user.name)}</h2></div><p class="muted">โปรเจกต์ เครดิต และงานของคุณจะไม่หายเมื่อ refresh เพราะเก็บแยกตามบัญชีผู้ใช้</p></div>
    <div class="stat-grid"><div class="stat"><b>${Number(data.user.credits||0)}</b><span>เครดิตคงเหลือ</span></div><div class="stat"><b>${data.projects.length}</b><span>โปรเจกต์ตัดต่อ</span></div><div class="stat"><b>${data.stats.jobs}</b><span>งาน marketplace</span></div><div class="stat"><b>${data.stats.campaigns}</b><span>แคมเปญ sponsor</span></div></div>
    <div class="dash-grid" style="margin-top:18px"><div class="panel glass"><h3>ทางลัด</h3><div class="hero-actions"><a class="primary" href="/editor.html">เปิด Editor</a><a class="soft" href="#marketplace">ลงงาน/รับงาน</a><a class="soft" href="#ai">ใช้ AI Studio</a><a class="gold" href="#credits">เติมเครดิต</a></div></div><div class="panel glass"><h3>โปรไฟล์รับงาน</h3>${profileForm(data.profile)}</div></div>
    <div class="panel glass" style="margin-top:18px"><h3>โปรเจกต์ล่าสุด</h3>${data.projects.length ? `<div class="item-list">${data.projects.slice(0,8).map(p => `<div class="list-item"><div><h4>${esc(p.name)}</h4><p>แก้ไขล่าสุด ${dateShort(p.updatedAt)}</p></div><a class="soft" href="/editor.html">เปิด</a></div>`).join('')}</div>` : '<div class="empty">ยังไม่มีโปรเจกต์ กดเปิด Editor เพื่อสร้างงานแรก</div>'}</div>
    </section>`;
  }
  function profileForm(p={}) { return `<form id="profile-form" class="form-stack"><label>ชื่อแสดง<input name="displayName" value="${esc(p.displayName||'')}"></label><label>บทบาท<select name="roles" multiple size="4"><option value="freelancer" ${(p.roles||[]).includes('freelancer')?'selected':''}>Freelancer / คนตัดต่อ</option><option value="client" ${(p.roles||[]).includes('client')?'selected':''}>Client / ลูกค้า</option><option value="influencer" ${(p.roles||[]).includes('influencer')?'selected':''}>Influencer</option><option value="sponsor" ${(p.roles||[]).includes('sponsor')?'selected':''}>Sponsor / Brand</option></select></label><label>ทักษะ คั่นด้วย comma<input name="skills" value="${esc((p.skills||[]).join(', '))}" placeholder="ตัดต่อ Reels, Color, Motion"></label><label>Portfolio URL<input name="portfolioUrl" value="${esc(p.portfolioUrl||'')}"></label><label>เรตราคา/หมายเหตุ<input name="rateText" value="${esc(p.rateText||'')}"></label><label>แนะนำตัว<textarea name="bio">${esc(p.bio||'')}</textarea></label><button class="primary">บันทึกโปรไฟล์</button><p class="tiny">สถานะคนทำงาน: ${esc(p.freelancerStatus||'not_applied')} · แอดมินอนุมัติได้ในหลังบ้าน</p></form>`; }

  async function renderCredits() {
    if (!requireLogin()) return renderHome();
    const data = await api('/api/credits'); state.user = data.user; renderNav();
    page.innerHTML = `<section class="section page-wrap"><div class="section-head"><div><span class="eyebrow">Credit Billing</span><h2>เครดิตเรนเดอร์</h2></div><p class="muted">ใช้ฟรีได้ที่ 480p พร้อมลายน้ำ ส่วน 1080p ช่วงทดลองใช้คิด 5 เครดิตต่อครั้ง</p></div><div class="stat-grid"><div class="stat"><b>${Number(data.user.credits||0)}</b><span>เครดิตคงเหลือ</span></div><div class="stat"><b>0</b><span>480p + watermark</span></div><div class="stat"><b>5</b><span>1080p credits</span></div><div class="stat"><b>0</b><span>งานผ่าน marketplace</span></div></div><div class="pricing" style="margin-top:18px">${data.packages.map(p => `<div class="price-card ${p.highlight?'highlight':''}"><b>${esc(p.name)}</b><div class="credits">${Number(p.credits)}<small> cr</small></div><p class="muted">${esc(p.priceText||'ตั้งราคาในหลังบ้าน')}</p><button class="primary wide" data-topup="${esc(p.id)}" data-credits="${Number(p.credits)}">ขอเติมเครดิต</button></div>`).join('')}</div><div class="split" style="margin-top:18px"><div class="panel glass"><h3>แจ้งโอน / ขอเติมเครดิต</h3><form id="topup-form" class="form-stack"><label>จำนวนเครดิต<input name="credits" type="number" value="5"></label><label>หมายเหตุหรือเลขอ้างอิง<textarea name="proofText" placeholder="เช่น โอนแล้ว เวลา... / แนบสลิปผ่านช่องทางแอดมิน"></textarea></label><button class="gold">ส่งคำขอให้แอดมินอนุมัติ</button></form></div><div class="panel glass"><h3>ประวัติ</h3>${data.transactions.length?`<div class="item-list">${data.transactions.map(t=>`<div class="list-item"><div><h4>${t.amount>0?'+':''}${t.amount} เครดิต</h4><p>${esc(t.note)} · ${dateShort(t.createdAt)}</p></div><span class="badge">คงเหลือ ${t.balanceAfter}</span></div>`).join('')}</div>`:'<div class="empty">ยังไม่มีรายการเครดิต</div>'}</div></div></section>`;
  }

  async function renderMarketplace() {
    const [freelancers, jobs] = await Promise.all([api('/api/marketplace/freelancers').catch(()=>({freelancers:[]})), state.user ? api('/api/marketplace/jobs').catch(()=>({jobs:[]})) : Promise.resolve({jobs:[]})]);
    page.innerHTML = `<section class="section page-wrap"><div class="section-head"><div><span class="eyebrow">Creator & Media Marketplace</span><h2>ตัวกลางรับงานวิดีโอ เสียง ภาพนิ่ง และงานครีเอเตอร์</h2></div><p class="muted">ลูกค้าลงบรีฟ คนทำงานสมัครรับงานผ่านระบบเรา งานที่ได้ผ่านระบบนี้สามารถ render ฟรี เพราะเราคิดหักเปอร์เซ็นต์จากงานแทน</p></div><div class="split"><div class="panel glass"><h3>ลงบรีฟงานใหม่</h3>${state.user?jobForm():'<div class="empty">เข้าสู่ระบบก่อนลงงานหรือสมัครรับงาน</div>'}</div><div class="panel glass"><h3>คนทำงานที่อนุมัติแล้ว</h3>${freelancers.freelancers.length?`<div class="item-list">${freelancers.freelancers.map(f=>`<div class="list-item"><div><h4>${esc(f.displayName||f.user?.name)}</h4><p>${esc(f.bio||'')}<br>${(f.skills||[]).map(s=>`<span class="badge">${esc(s)}</span>`).join('')}</p></div><button class="soft" data-friend="${esc(f.userId)}">เพิ่มเพื่อน</button></div>`).join('')}</div>`:'<div class="empty">ยังไม่มี freelancer ที่แอดมินอนุมัติ</div>'}</div></div><div class="panel glass" style="margin-top:18px"><h3>งานในระบบ</h3>${jobs.jobs.length?`<div class="item-list">${jobs.jobs.map(j=>`<div class="list-item"><div><h4>${esc(j.title)} <span class="badge gold">${esc(j.status)}</span></h4><p>${esc(j.brief)}<br>งบ: ${esc(j.budgetText||'-')} · ส่ง: ${esc(j.deadline||'-')} · ค่าระบบ ${j.commissionPercent}%</p></div><div style="display:grid;gap:8px"><button class="soft" data-apply-job="${esc(j.id)}">สมัครรับงาน</button>${j.clientId===state.user?.id?'<button class="gold" data-job-done="'+esc(j.id)+'">ปิดงาน</button>':''}</div></div>`).join('')}</div>`:'<div class="empty">ยังไม่มีงาน เปิดรับงานแรกได้เลย</div>'}</div></section>`;
  }
  function jobForm(){return `<form id="job-form" class="form-stack"><label>ชื่องาน<input name="title" placeholder="ตัดต่อ Reels / ลงเสียง / ทำเพลง / ทำ thumbnail"></label><label>งบประมาณ<input name="budgetText" placeholder="เช่น 1,500-3,000 บาท"></label><label>กำหนดส่ง<input name="deadline" placeholder="เช่น 3 วัน"></label><label>รายละเอียดบรีฟ<textarea name="brief" placeholder="แนบสไตล์, ความยาว, mood, ไฟล์อยู่ที่ไหน"></textarea></label><button class="primary">ลงงาน</button></form>`}

  async function renderAi() {
    const data = state.user ? await api('/api/ai/models').catch(e=>({models:{},jobs:[],error:e.message})) : {models:{},jobs:[]};
    page.innerHTML = `<section class="section page-wrap"><div class="section-head"><div><span class="eyebrow">AI Studio</span><h2>หน้าเตรียมเชื่อม API เจน AI</h2></div><p class="muted">ตอนนี้ต่อ text/script กับ OpenAI ได้เมื่อใส่ OPENAI_API_KEY ใน .env ส่วนภาพ/วิดีโอเตรียม connector ให้เสียบ API ภายนอกต่อได้</p></div><div class="split"><div class="panel glass"><h3>สร้างสคริปต์ / caption / prompt</h3>${state.user?`<form id="ai-form" class="form-stack"><label>ประเภท<select name="type"><option value="script">Script</option><option value="caption">Caption</option><option value="text">Text</option><option value="video">AI Video connector</option><option value="voice">AI Voice connector</option></select></label><label>โมเดล<input name="model" value="${esc((data.models.text&&data.models.text[0]&&data.models.text[0].model)||'gpt-5.4-mini')}"></label><label>Prompt<textarea name="prompt" placeholder="เช่น เขียนสคริปต์ reels ร้านอาหาร 30 วิ โทนสนุก..."></textarea></label><button class="primary">ส่งให้ AI</button></form>`:'<div class="empty">เข้าสู่ระบบก่อนใช้ AI Studio</div>'}</div><div class="panel glass"><h3>วิธีหาโมเดล AI แบบภาษาคน</h3><p class="muted">ให้เลือกจาก 3 อย่าง: งานของเราเป็นข้อความ/ภาพ/วิดีโอ, ต้องการคุณภาพหรือประหยัด, และ API นั้นมีราคา/เงื่อนไข commercial ชัดไหม จากนั้นเอา API key มาใส่ใน .env แล้วเขียน connector ใน <span class="kbd">lib/ai-provider.js</span></p><div class="callout">เริ่มง่ายสุด: ใช้ OpenAI สำหรับข้อความ/บรีฟ/prompt ก่อน แล้วค่อยต่อ image/video provider ภายหลัง</div></div></div><div class="panel glass" style="margin-top:18px"><h3>AI Jobs</h3><div id="ai-jobs">${aiJobsHtml(data.jobs||[])}</div></div></section>`;
  }
  function aiJobsHtml(jobs){return jobs.length?`<div class="item-list">${jobs.map(j=>`<div class="list-item"><div><h4>${esc(j.type)} · ${esc(j.model||'')}</h4><p>${esc(j.prompt||'').slice(0,220)}<br>${j.result&&j.result.text?esc(j.result.text).slice(0,500):esc(j.error||'')}</p></div><span class="badge ${j.status==='done'?'green':j.status==='error'?'red':'gold'}">${esc(j.status)}</span></div>`).join('')}</div>`:'<div class="empty">ยังไม่มี AI job</div>'}

  async function renderSponsors() {
    const data = state.user ? await api('/api/sponsor/campaigns').catch(()=>({campaigns:[]})) : {campaigns:[]};
    page.innerHTML = `<section class="section page-wrap"><div class="section-head"><div><span class="eyebrow">Sponsor Hub</span><h2>จับคู่สปอนเซอร์กับอินฟลูเอนเซอร์</h2></div><p class="muted">แบรนด์ลงแคมเปญ อินฟลูสมัครรับงาน แอดมินดูแลหลังบ้านเพื่อให้ดีลเกิดในระบบ</p></div><div class="split"><div class="panel glass"><h3>ลงแคมเปญ</h3>${state.user?campaignForm():'<div class="empty">เข้าสู่ระบบก่อนลงแคมเปญ</div>'}</div><div class="panel glass"><h3>กติกาที่แนะนำ</h3><p class="muted">ให้ influencer สมัครและสร้างโปรไฟล์ก่อน แอดมินอนุมัติ จากนั้นแบรนด์เปิด campaign และเลือกคนที่เหมาะสม ระบบ chat ช่วยคุยบรีฟในแพลตฟอร์มเดียว</p></div></div><div class="panel glass" style="margin-top:18px"><h3>แคมเปญเปิดรับ</h3>${data.campaigns.length?`<div class="item-list">${data.campaigns.map(c=>`<div class="list-item"><div><h4>${esc(c.title)} <span class="badge gold">${esc(c.status)}</span></h4><p>${esc(c.brief)}<br>งบ: ${esc(c.budgetText||'-')} · ช่องทาง: ${esc(c.platform||'-')}</p></div><button class="soft" data-apply-campaign="${esc(c.id)}">สมัครแคมเปญ</button></div>`).join('')}</div>`:'<div class="empty">ยังไม่มีแคมเปญ</div>'}</div></section>`;
  }
  function campaignForm(){return `<form id="campaign-form" class="form-stack"><label>ชื่อแคมเปญ<input name="title" placeholder="โปรโมทร้าน / สินค้า / ท่องเที่ยว"></label><label>งบประมาณ<input name="budgetText" placeholder="เช่น 5,000 บาท + สินค้า"></label><label>ช่องทาง<input name="platform" placeholder="TikTok, Reels, YouTube Shorts"></label><label>รายละเอียด<textarea name="brief"></textarea></label><button class="gold">เปิดแคมเปญ</button></form>`}

  async function renderAdmin() {
    if (!requireLogin()) return renderHome(); if (!isAdmin()) { page.innerHTML = `<section class="section page-wrap"><div class="empty">หน้านี้สำหรับแอดมินเท่านั้น</div></section>`; return; }
    const [sum, users, topups, jobs, campaigns, renders, ai] = await Promise.all([api('/api/admin/summary'), api('/api/admin/users'), api('/api/admin/topups'), api('/api/admin/jobs'), api('/api/admin/campaigns'), api('/api/admin/renders'), api('/api/admin/ai-jobs')]);
    page.innerHTML = `<section class="section page-wrap"><div class="section-head"><div><span class="eyebrow">Admin Backoffice</span><h2>หลังบ้านจัดการระบบ</h2></div><p class="muted">จัดการผู้ใช้ เครดิต คำขอเติมเครดิต โปรไฟล์คนทำงาน งาน marketplace sponsor และ render jobs</p></div><div class="stat-grid"><div class="stat"><b>${sum.summary.users}</b><span>ผู้ใช้</span></div><div class="stat"><b>${sum.summary.totalCredits}</b><span>เครดิตทั้งหมด</span></div><div class="stat"><b>${sum.summary.pendingTopups}</b><span>คำขอเติมเครดิต</span></div><div class="stat"><b>${sum.summary.renders}</b><span>Render jobs</span></div></div><div class="admin-grid" style="margin-top:18px"><div class="panel glass"><h3>คำขอเติมเครดิต</h3>${adminTopups(topups.topups)}</div><div class="panel glass"><h3>ผู้ใช้</h3>${adminUsers(users.users)}</div><div class="panel glass"><h3>โปรไฟล์รออนุมัติ</h3>${adminProfiles(users.profiles, users.users)}</div><div class="panel glass"><h3>Render ล่าสุด</h3>${adminRenders(renders.renders)}</div></div><div class="panel glass" style="margin-top:18px"><h3>Jobs / Campaigns / AI</h3><div class="split"><div>${adminSimpleList(jobs.jobs,'งาน')}</div><div>${adminSimpleList(campaigns.campaigns,'แคมเปญ')}</div></div><h3>AI Jobs</h3>${aiJobsHtml(ai.jobs)}</div></section>`;
  }
  function adminTopups(rows){return rows.length?`<div class="item-list">${rows.slice(0,10).map(t=>`<div class="list-item"><div><h4>${t.credits} เครดิต <span class="badge ${t.status==='pending'?'gold':t.status==='approved'?'green':'red'}">${t.status}</span></h4><p>${esc(t.proofText||t.note||'')}<br>${dateShort(t.createdAt)}</p></div>${t.status==='pending'?`<div style="display:grid;gap:8px"><button class="gold" data-topup-approve="${esc(t.id)}">อนุมัติ</button><button class="danger" data-topup-reject="${esc(t.id)}">ปฏิเสธ</button></div>`:''}</div>`).join('')}</div>`:'<div class="empty">ไม่มีคำขอ</div>'}
  function adminUsers(users){return `<div class="item-list">${users.slice(0,12).map(u=>`<div class="list-item"><div><h4>${esc(u.name)} <span class="badge">${esc(u.role)}</span></h4><p>${esc(u.email)} · ${u.credits} เครดิต</p></div><div style="display:grid;gap:8px"><button class="soft" data-credit-user="${esc(u.id)}">+เครดิต</button>${u.role==='member'?`<button class="soft" data-make-admin="${esc(u.id)}">ตั้ง admin</button>`:''}</div></div>`).join('')}</div>`}
  function adminProfiles(profiles, users){const items=Object.values(profiles||{}).filter(p=>['pending','rejected'].includes(p.freelancerStatus)||['pending','rejected'].includes(p.influencerStatus)||['pending','rejected'].includes(p.sponsorStatus));return items.length?`<div class="item-list">${items.map(p=>{const u=users.find(x=>x.id===p.userId)||{};return `<div class="list-item"><div><h4>${esc(p.displayName||u.name)}</h4><p>${esc((p.roles||[]).join(', '))}<br>freelancer: ${esc(p.freelancerStatus)} influencer: ${esc(p.influencerStatus)}</p></div><div style="display:grid;gap:8px"><button class="gold" data-approve-profile="${esc(p.userId)}" data-kind="freelancer">อนุมัติ worker</button><button class="gold" data-approve-influencer="${esc(p.userId)}">อนุมัติ influencer</button></div></div>`}).join('')}</div>`:'<div class="empty">ไม่มีโปรไฟล์รออนุมัติ</div>'}
  function adminRenders(rows){return rows.length?`<div class="item-list">${rows.slice(0,10).map(r=>`<div class="list-item"><div><h4>${esc(r.projectName||r.projectId)} <span class="badge ${r.status==='done'?'green':r.status==='error'?'red':'gold'}">${esc(r.status)}</span></h4><p>${esc(r.quality)} · ${r.costCredits} เครดิต · ${dateShort(r.createdAt)}</p></div>${r.result&&r.result.url?`<a class="soft" href="${r.result.url}" target="_blank">โหลด</a>`:''}</div>`).join('')}</div>`:'<div class="empty">ยังไม่มี render</div>'}
  function adminSimpleList(rows,label){return rows.length?`<h4>${label}</h4><div class="item-list">${rows.slice(0,8).map(x=>`<div class="list-item"><div><h4>${esc(x.title)} <span class="badge">${esc(x.status)}</span></h4><p>${esc(x.brief||'').slice(0,160)}</p></div></div>`).join('')}</div>`:`<h4>${label}</h4><div class="empty">ไม่มี</div>`}

  async function route() {
    const h = (location.hash || '#home').replace('#','') || 'home'; state.route = h; renderNav(); $('#nav-links').classList.remove('open');
    try {
      if (h === 'home' || h === 'services') await renderHome();
      else if (h === 'dashboard') await renderDashboard();
      else if (h === 'credits') await renderCredits();
      else if (h === 'marketplace') await renderMarketplace();
      else if (h === 'ai') await renderAi();
      else if (h === 'sponsors') await renderSponsors();
      else if (h === 'admin') await renderAdmin();
      else if (h === 'chat') { await renderHome(); openChat(); }
      else await renderHome();
      if (h === 'services') document.getElementById('services')?.scrollIntoView();
    } catch (err) { page.innerHTML = `<section class="section page-wrap"><div class="empty">${esc(err.message)}</div></section>`; }
  }

  function openAuth(mode='login') { state.authMode = mode; $('#auth-modal').classList.remove('hidden'); $('#auth-title').textContent = mode==='login'?'เข้าสู่ระบบ':'สมัครบัญชี'; $('#auth-submit').textContent = mode==='login'?'เข้าสู่ระบบ':'สมัครบัญชี'; $('#auth-login-tab').classList.toggle('active', mode==='login'); $('#auth-register-tab').classList.toggle('active', mode==='register'); $$('.register-only').forEach(e=>e.classList.toggle('hidden', mode==='login')); $('#auth-error').textContent=''; }
  function closeAuth(){ $('#auth-modal').classList.add('hidden'); }

  async function initMe() { try { const data = await api('/api/me'); state.user = data.user; } catch (_) { state.user = null; } renderNav(); }

  async function openChat() { $('#chat-panel').classList.remove('hidden'); if (!state.user) { $('#chat-auth-hint').classList.remove('hidden'); $('#chat-body').classList.add('hidden'); return; } $('#chat-auth-hint').classList.add('hidden'); $('#chat-body').classList.remove('hidden'); await loadFriends(); if (!state.chatTimer) state.chatTimer = setInterval(() => { if (!$('#chat-panel').classList.contains('hidden') && state.chatTarget) loadMessages(state.chatTarget.id).catch(()=>{}); }, 2500); }
  function closeChat(){ $('#chat-panel').classList.add('hidden'); }
  async function loadFriends(){ const data = await api('/api/friends'); state.friends = data; $('#friend-list').innerHTML = `<b class="tiny">เพื่อน</b>${data.friends.map(f=>`<div class="friend-pill"><span>${esc(f.name)}<br><small>${esc(f.email)}</small></span><button data-chat-user="${esc(f.id)}">คุย</button></div>`).join('') || '<div class="tiny">ยังไม่มีเพื่อน</div>'}<b class="tiny">คำขอ</b>${data.requestsIn.map(r=>`<div class="friend-pill"><span>${esc(r.fromUser.name)}</span><button data-friend-accept="${esc(r.id)}">รับ</button></div>`).join('')}`; }
  async function loadMessages(userId){ const data = await api('/api/chat/messages?userId='+encodeURIComponent(userId)); $('#chat-messages').innerHTML = data.messages.map(m=>`<div class="msg ${m.from===state.user.id?'me':''}">${esc(m.text)}<br><small>${dateShort(m.createdAt)}</small></div>`).join(''); $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight; }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button,a'); if (!t) return;
    if (t.id === 'mobile-menu') $('#nav-links').classList.toggle('open');
    if (t.id === 'btn-login') openAuth('login');
    if (t.id === 'btn-register') openAuth('register');
    if (t.matches('[data-close-auth]')) closeAuth();
    if (t.id === 'auth-login-tab') openAuth('login');
    if (t.id === 'auth-register-tab') openAuth('register');
    if (t.id === 'btn-logout') { await api('/api/auth/logout',{method:'POST'}); state.user=null; renderNav(); route(); toast('ออกจากระบบแล้ว'); }
    if (t.id === 'btn-open-chat' || t.getAttribute('href')==='#chat') { e.preventDefault(); openChat(); }
    if (t.id === 'chat-close') closeChat();
    if (t.dataset.topup) { e.preventDefault(); if(!requireLogin()) return; await api('/api/credits/topups',{method:'POST',body:JSON.stringify({packageId:t.dataset.topup,credits:Number(t.dataset.credits),note:'ขอเติมจากหน้าแพ็กเกจ'})}); toast('ส่งคำขอเติมเครดิตแล้ว รอแอดมินอนุมัติ'); route(); }
    if (t.dataset.applyJob) { if(!requireLogin()) return; const msg = prompt('ข้อความสมัครงานนี้'); if (msg!=null) { await api(`/api/marketplace/jobs/${t.dataset.applyJob}/apply`,{method:'POST',body:JSON.stringify({message:msg})}); toast('สมัครรับงานแล้ว'); route(); } }
    if (t.dataset.jobDone) { await api(`/api/marketplace/jobs/${t.dataset.jobDone}/status`,{method:'POST',body:JSON.stringify({status:'completed'})}); toast('ปิดงานแล้ว'); route(); }
    if (t.dataset.applyCampaign) { if(!requireLogin()) return; const msg = prompt('ข้อความสมัครแคมเปญ'); if (msg!=null) { await api(`/api/sponsor/campaigns/${t.dataset.applyCampaign}/apply`,{method:'POST',body:JSON.stringify({message:msg})}); toast('สมัครแคมเปญแล้ว'); route(); } }
    if (t.dataset.friend) { if(!requireLogin()) return; await api('/api/friends/request',{method:'POST',body:JSON.stringify({userId:t.dataset.friend})}); toast('ส่งคำขอเป็นเพื่อนแล้ว'); }
    if (t.id === 'friend-search-btn') { const q=$('#friend-query').value; const data=await api('/api/users/search?q='+encodeURIComponent(q)); $('#friend-results').innerHTML=data.users.map(u=>`<div class="friend-pill"><span>${esc(u.name)}<br><small>${esc(u.email)}</small></span><button data-friend="${esc(u.id)}">เพิ่ม</button></div>`).join('') || '<div class="tiny">ไม่พบผู้ใช้</div>'; }
    if (t.dataset.chatUser) { const u = state.friends.friends.find(f=>f.id===t.dataset.chatUser); state.chatTarget = u; $('#chat-target').textContent = u.name; await loadMessages(u.id); }
    if (t.dataset.friendAccept) { await api('/api/friends/respond',{method:'POST',body:JSON.stringify({requestId:t.dataset.friendAccept,accept:true})}); await loadFriends(); toast('รับเพื่อนแล้ว'); }
    if (t.dataset.topupApprove) { await api(`/api/admin/topups/${t.dataset.topupApprove}/approve`,{method:'POST'}); toast('อนุมัติแล้ว'); route(); }
    if (t.dataset.topupReject) { await api(`/api/admin/topups/${t.dataset.topupReject}/reject`,{method:'POST'}); toast('ปฏิเสธแล้ว'); route(); }
    if (t.dataset.creditUser) { const amount = Number(prompt('เพิ่ม/ลดเครดิต เช่น 10 หรือ -5','10')); if(Number.isFinite(amount)) { await api(`/api/admin/users/${t.dataset.creditUser}/credits`,{method:'POST',body:JSON.stringify({amount,note:'ปรับเครดิตโดยแอดมิน'})}); toast('ปรับเครดิตแล้ว'); route(); } }
    if (t.dataset.makeAdmin) { await api(`/api/admin/users/${t.dataset.makeAdmin}`,{method:'POST',body:JSON.stringify({role:'admin'})}); toast('ตั้งเป็น admin แล้ว'); route(); }
    if (t.dataset.approveProfile) { await api(`/api/admin/profiles/${t.dataset.approveProfile}/approve`,{method:'POST',body:JSON.stringify({kind:'freelancer',status:'approve'})}); toast('อนุมัติ freelancer แล้ว'); route(); }
    if (t.dataset.approveInfluencer) { await api(`/api/admin/profiles/${t.dataset.approveInfluencer}/approve`,{method:'POST',body:JSON.stringify({kind:'influencer',status:'approve'})}); toast('อนุมัติ influencer แล้ว'); route(); }
  });

  document.addEventListener('submit', async (e) => {
    const form = e.target; e.preventDefault();
    try {
      if (form.id === 'auth-form') { const fd = new FormData(form); const body = Object.fromEntries(fd.entries()); const data = await api(state.authMode==='login'?'/api/auth/login':'/api/auth/register',{method:'POST',body:JSON.stringify(body)}); state.user=data.user; closeAuth(); toast('เข้าสู่ระบบแล้ว'); renderNav(); route(); }
      if (form.id === 'profile-form') { const fd = new FormData(form); const body = Object.fromEntries(fd.entries()); body.roles = Array.from(form.elements.roles.selectedOptions).map(o=>o.value); body.skills = String(body.skills||'').split(',').map(s=>s.trim()).filter(Boolean); await api('/api/profile',{method:'PUT',body:JSON.stringify(body)}); toast('บันทึกโปรไฟล์แล้ว'); route(); }
      if (form.id === 'topup-form') { const fd = new FormData(form); const body = Object.fromEntries(fd.entries()); body.credits = Number(body.credits||5); await api('/api/credits/topups',{method:'POST',body:JSON.stringify(body)}); toast('ส่งคำขอเติมเครดิตแล้ว'); route(); }
      if (form.id === 'job-form') { const body = Object.fromEntries(new FormData(form).entries()); await api('/api/marketplace/jobs',{method:'POST',body:JSON.stringify(body)}); toast('ลงงานแล้ว'); route(); }
      if (form.id === 'campaign-form') { const body = Object.fromEntries(new FormData(form).entries()); await api('/api/sponsor/campaigns',{method:'POST',body:JSON.stringify(body)}); toast('เปิดแคมเปญแล้ว'); route(); }
      if (form.id === 'ai-form') { const body = Object.fromEntries(new FormData(form).entries()); await api('/api/ai/jobs',{method:'POST',body:JSON.stringify(body)}); toast('ส่ง AI job แล้ว'); setTimeout(route, 800); }
      if (form.id === 'chat-form') { if(!state.chatTarget) return; const input=$('#chat-input'); await api('/api/chat/messages',{method:'POST',body:JSON.stringify({userId:state.chatTarget.id,text:input.value})}); input.value=''; await loadMessages(state.chatTarget.id); }
    } catch (err) { toast(err.message, 6000); const ae=$('#auth-error'); if(ae) ae.textContent=err.message; }
  });

  window.addEventListener('hashchange', route);
  initMe().then(route);
})();
