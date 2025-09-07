/* views.js — 홈/검색/상세/마이/큰언니 콘솔 (ESM) */
'use strict';
import { db, storage, State, $, $$, toast, esc, nl2br, fmt, getTS, cryptoRandomId } from './utils.js';
import { connectWallet, getTier, agentWalletById } from './chain.js';

/* ===== 내부: 검색 에이전트 필터 ===== */
let AGENT_FILTER = null;

/* ===== 내장 플레이스홀더 (16:9, 이미지 없거나 404일 때) ===== */
const PH_16x9 = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#121621"/><stop offset="1" stop-color="#0b0d14"/>
      </linearGradient>
    </defs>
    <rect width="160" height="90" fill="url(#g)"/>
    <g fill="#2a2f3f">
      <circle cx="80" cy="45" r="28"/>
      <rect x="35" y="62" width="90" height="10" rx="5"/>
    </g>
  </svg>
`);

/* ===== 5) 홈/검색/상세 ===== */
const homeSearchBtn = $('#home-search');
if (homeSearchBtn) homeSearchBtn.addEventListener('click', ()=>{
  const q = $('#home-q')?.value || '';
  const target = $('#search-q'); if (target) target.value = q;
  AGENT_FILTER = null;
  location.hash = '#/search';
});
const searchRunBtn = $('#search-run');
if (searchRunBtn) searchRunBtn.addEventListener('click', ()=> { AGENT_FILTER = null; doSearch(); });

export async function refreshHome(){
  // 지역
  const regions = await db.collection('regions').orderBy('name').limit(6).get().catch(()=>({docs:[]}));
  {
    const el = $('#region-grid');
    const html = regions.docs.map(d => cardRegion(d.data())).join("") ||
      `<div class="small">지역이 없습니다. 운영자/큰언니 콘솔에서 생성하세요.</div>`;
    if (el) el.innerHTML = html;
  }

  // 승인된 큰언니
  let agDocs=[];
  try{
    const snap = await db.collection('agents')
      .where('approved','==',true).orderBy('score','desc').limit(12).get();
    agDocs = snap.docs;
  }catch(e){
    console.warn('agents(approved=true) local-sort fallback:', e?.message||e);
    const snap = await db.collection('agents').where('approved','==',true).limit(30).get().catch(()=>({docs:[]}));
    agDocs = snap.docs.sort((a,b)=> (b.data().score||0)-(a.data().score||0)).slice(0,12);
  }
  {
    const el = $('#agent-grid');
    const html = (agDocs||[]).map(d=> cardAgent(d.data(), d.id)).join("") || `<div class="small">승인된 큰언니가 없습니다.</div>`;
    if (el) el.innerHTML = html;
  }

  // 공지
  const now = new Date();
  let nsDocs=[];
  try{
    const ns = await db.collection('notices').where('startAt','<=', now).orderBy('startAt','desc').limit(20).get();
    nsDocs = ns.docs.filter(d=>{
      const n=d.data(); const end=n.endAt?.toDate?.()||n.endAt;
      return !end || end>=now;
    });
  }catch(_){ 
    const ns = await db.collection('notices').orderBy('startAt','desc').limit(10).get().catch(()=>({docs:[]}));
    nsDocs = ns.docs;
  }
  {
    const el = $('#notice-list');
    const html =
      nsDocs.map(n=> `<div class="item"><b>${esc(n.data().title)}</b><div class="small">${esc(n.data().body||"")}</div></div>`).join("")
      || `<div class="small">현재 공지가 없습니다.</div>`;
    if (el) el.innerHTML = html;
  }
}

function cardRegion(r){
  return `<div class="col-12 col-sm-6 col-lg-4">
    <div class="card surface h-100">
      <div class="d-flex justify-content-between align-items-center mb-1">
        <b class="fs-5">${esc(r.name)}</b>
        <span class="badge rounded-pill text-bg-secondary">${esc((r.country||"").toUpperCase())}</span>
      </div>
      <div class="small">${esc(r.desc||"")}</div>
    </div>
  </div>`;
}

function cardAgent(a, id){
  const img = a.photoURL ? esc(a.photoURL) : PH_16x9;
  return `
  <div class="col-12 col-sm-6 col-lg-4 col-xl-3">
    <div class="card surface agent-card h-100">
      <div class="d-flex justify-content-between align-items-start">
        <h5 class="fw-bold mb-2">${esc(a.name||"큰언니")}</h5>
        <span class="badge rounded-pill text-bg-secondary">평점 ${Math.round((a.rating||0)*10)/10} · 스코어 ${a.score||0}</span>
      </div>

      <div class="thumb mb-2"><img src="${img}" alt="${esc(a.name||'agent')}" loading="lazy" onerror="this.src='${PH_16x9}'"></div>

      <div class="small mb-2">${esc(a.bio||"")}</div>

      <div class="d-flex flex-wrap gap-2 mb-3">
        ${a.region ? `<span class="badge rounded-pill bg-dark-subtle text-light">${esc(a.region)}</span>` : ``}
        ${(a.badges||[]).slice(0,3).map(x=>`<span class="badge bg-secondary-subtle text-light">${esc(x)}</span>`).join("")}
      </div>

      <div class="d-grid gap-2 d-sm-flex">
        <a href="#/search" class="btn btn-outline-secondary btn-sm"
           onclick="window.showAgentProducts('${id}');return false;">등록상품</a>
        ${a.storyUrl
          ? `<a class="btn btn-outline-light btn-sm" href="${esc(a.storyUrl)}" target="_blank" rel="noopener">스토리</a>`
          : `<button class="btn btn-outline-light btn-sm" disabled>스토리</button>`}
      </div>
    </div>
  </div>`;
}

export function showAgentProducts(agentId){
  AGENT_FILTER = agentId || null;
  location.hash = '#/search';
  setTimeout(()=>doSearch(), 0);
}
window.showAgentProducts = showAgentProducts;

export async function doSearch(){
  const q = ($('#search-q')?.value||"").trim().toLowerCase();
  let snap;
  try{
    if (AGENT_FILTER){
      snap = await db.collection('posts').where('agentId','==',AGENT_FILTER).limit(50).get();
    }else{
      snap = await db.collection('posts').where('status','==','open').limit(50).get();
    }
  }catch(e){
    console.warn('search query fallback:', e?.message||e);
    snap = await db.collection('posts').limit(100).get().catch(()=>({docs:[]}));
  }
  let items = snap.docs.map(d=> ({id:d.id, ...d.data()}));
  if (!AGENT_FILTER && q){
    items = items.filter(p=>
      (p.title||"").toLowerCase().includes(q) ||
      (p.body||"").toLowerCase().includes(q) ||
      (p.tags||[]).join(',').toLowerCase().includes(q) ||
      (p.region||"").toLowerCase().includes(q)
    );
  }
  const el = $('#search-grid');
  if (!el){ return; }
  el.innerHTML = items.map(cardPost).join("") || `<div class="small">검색 결과가 없습니다.</div>`;
}

function cardPost(p){
  const img = (Array.isArray(p.images) && p.images[0]) ? esc(p.images[0]) : PH_16x9;
  return `<div class="col-12 col-sm-6 col-lg-4">
    <div class="card surface h-100">
      <div class="d-flex justify-content-between align-items-center">
        <b class="me-2">${esc(p.title)}</b>
        ${p.price?`<span class="price">${fmt(p.price)} PAW</span>`:''}
      </div>
      <div class="thumb my-2"><img src="${img}" alt="${esc(p.title)}" loading="lazy" onerror="this.src='${PH_16x9}'"/></div>
      <div class="small">${esc((p.body||"").slice(0,120))}...</div>
      <div class="kit">${(p.tags||[]).slice(0,5).map(t=>`<span class="badge bg-secondary-subtle text-light">${esc(t)}</span>`).join("")}</div>
      <div class="d-grid gap-2 d-sm-flex mt-2">
        <button class="btn btn-accent btn-sm" onclick="openDetail('${p.id}')">자세히</button>
        <button class="btn btn-outline-light btn-sm" onclick="openInquiry('${p.id}')">문의</button>
      </div>
    </div>
  </div>`;
}

export async function openDetail(postId){
  const doc = await db.collection('posts').doc(postId).get();
  if(!doc.exists){ toast('존재하지 않는 상품입니다.'); return; }
  const p = doc.data();
  const el = $('#detail-wrap');
  if (el) {
    const img = (Array.isArray(p.images)&&p.images[0]) ? esc(p.images[0]) : PH_16x9;
    el.innerHTML = `
      <div class="d-flex justify-content-between align-items-center">
        <h3 class="mb-2">${esc(p.title)}</h3>
        ${p.price? `<span class="price">${fmt(p.price)} PAW</span>`:''}
      </div>
      <div class="thumb mb-2"><img src="${img}" alt="${esc(p.title)}" onerror="this.src='${PH_16x9}'"></div>
      <div class="small">${nl2br(p.body||"")}</div>
      <div class="kit my-2">${(p.tags||[]).map(t=>`<span class="badge bg-secondary-subtle text-light">${esc(t)}</span>`).join("")}</div>
      <div class="d-grid gap-2 d-sm-flex">
        <button class="btn btn-accent" onclick="openInquiry('${postId}')">문의하기</button>
        <button class="btn btn-outline-light" onclick="bookDirect('${postId}')">즉시 예약(데모)</button>
      </div>
    `;
  }
  location.hash = '#/detail';
}
window.openDetail = openDetail;

/* 문의 */
export async function openInquiry(postId){
  if(!State.user){ toast('먼저 로그인하세요.'); return; }
  const post = await db.collection('posts').doc(postId).get();
  if(!post.exists){ toast('상품 없음'); return; }
  const p = post.data();
  const message = prompt(`[${p.title}] 큰언니에게 보낼 문의를 입력하세요:`,"안녕하세요! 일정/가격 문의드립니다.");
  if(!message) return;
  await db.collection('inquiries').add({
    postId, agentId: p.agentId, regionId: p.regionId || null,
    userUid: State.user.uid, message, status:'신규',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  toast('문의가 접수되었습니다.');
}
window.openInquiry = openInquiry;

/* 예약(데모) */
export async function bookDirect(postId){
  if(!State.user){ toast('먼저 로그인하세요.'); return; }
  if(!State.wallet){ await connectWallet(); if(!State.wallet) return; }
  const tier = State.tier || await getTier(State.wallet);
  if (Number(tier) < 1){ toast('온체인 티어 1 이상만 결제가 가능합니다.'); return; }

  const pdoc = await db.collection('posts').doc(postId).get();
  if(!pdoc.exists){ toast('상품 없음'); return; }
  const p = pdoc.data();

  const orderId = cryptoRandomId();
  const amount = Number(p.price||0);
  const agentWallet = p.agentWallet || (await agentWalletById(p.agentId)) || State.wallet;
  try{ void(agentWallet); }catch(_){}

  await db.collection('orders').doc(orderId).set({
    id: orderId, postId, agentId: p.agentId, userUid: State.user.uid,
    total: amount, token: 'PAW', status: '예치완료',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  const vId = 'v_'+orderId;
  await db.collection('vouchers').doc(vId).set({
    id: vId, scope:'agent', userUid: State.user.uid, agentId: p.agentId,
    tokenId: 'DEMO-1155', faceValue: amount, rules:{ postId },
    expiry: new Date(Date.now()+1000*60*60*24*30),
    status:'issued', createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  toast("예약/결제가 완료되었습니다. '마이 > 바우처'에서 QR을 확인하세요.");
  location.hash = '#/my';
  refreshMy();
}
window.bookDirect = bookDirect;

/* ===== 6) 마이 ===== */
export async function refreshMy(){
  if(!State.user){
    const o = $('#my-orders');   if (o) o.innerHTML   = `<div class="small">로그인 필요</div>`;
    const v = $('#my-vouchers'); if (v) v.innerHTML   = `<div class="small">로그인 필요</div>`;
    const r = $('#my-reviews');  if (r) r.innerHTML   = `<div class="small">로그인 필요</div>`;
    return;
  }

  let ordersArr=[];
  try{
    const qs = await db.collection('orders').where('userUid','==',State.user.uid)
      .orderBy('createdAt','desc').limit(20).get();
    ordersArr = qs.docs.map(d=> ({id:d.id, ...d.data()}));
  }catch(e){
    const qs = await db.collection('orders').where('userUid','==',State.user.uid).limit(60).get();
    ordersArr = qs.docs.map(d=> ({id:d.id, ...d.data()}));
    ordersArr.sort((a,b)=> getTS(b.createdAt)-getTS(a.createdAt));
    ordersArr = ordersArr.slice(0,20);
    console.warn('orders: local sort fallback (no index)');
  }

  let vouchersArr=[];
  try{
    const qs = await db.collection('vouchers').where('userUid','==',State.user.uid)
      .orderBy('createdAt','desc').limit(20).get();
    vouchersArr = qs.docs.map(d=> ({id:d.id, ...d.data()}));
  }catch(e){
    const qs = await db.collection('vouchers').where('userUid','==',State.user.uid).limit(60).get();
    vouchersArr = qs.docs.map(d=> ({id:d.id, ...d.data()}));
    vouchersArr.sort((a,b)=> getTS(b.createdAt)-getTS(a.createdAt));
    vouchersArr = vouchersArr.slice(0,20);
    console.warn('vouchers: local sort fallback (no index)');
  }

  const reviewsSnap = await db.collection('reviews').where('userUid','==',State.user.uid)
    .orderBy('createdAt','desc').limit(20).get().catch(()=>({docs:[]}));
  const reviewsArr = reviewsSnap.docs.map(d=> ({id:d.id, ...d.data()}));

  {
    const el = $('#my-orders');
    if (el) el.innerHTML = ordersArr.map(o=>`
      <div class="item">
        <div class="d-flex justify-content-between align-items-center">
          <b>주문 #${esc(o.id)}</b><span class="badge text-bg-secondary">${esc(o.status||'-')}</span>
        </div>
        <div class="small">총액 ${fmt(o.total||0)} PAW</div>
        <div class="mt-2"><button class="btn btn-outline-secondary btn-sm" onclick="openReview('${o.id}')">리뷰 작성</button></div>
      </div>
    `).join("") || `<div class="small">예약 내역 없음</div>`;
  }

  {
    const el = $('#my-vouchers');
    if (el) el.innerHTML = vouchersArr.map(v=>{
      const elId = 'qr_'+v.id;
      const expiry = v.expiry?.toDate?.() || v.expiry;
      const html = `
        <div class="col-12 col-sm-6">
          <div class="card surface h-100 p-2">
            <div class="d-flex justify-content-between align-items-center">
              <b>바우처 ${esc(v.id)}</b><span class="badge text-bg-secondary">${esc(v.status||'-')}</span>
            </div>
            <div class="small">유효기간: ${expiry ? new Date(expiry).toLocaleDateString() : "-"}</div>
            <div id="${elId}" class="bg-white rounded-3 p-2 my-2 d-inline-block"></div>
            <button class="btn btn-outline-secondary btn-sm" onclick="markRedeemed('${v.id}')">사용완료 표시(데모)</button>
          </div>
        </div>`;
      setTimeout(()=>{
        const payload = JSON.stringify({ id:v.id, tokenId:v.tokenId, proof:'DEMO-SIGN' });
        window.QRCode?.toCanvas(document.getElementById(elId), payload, { width:180 }, (err)=> err && console.error(err));
      },0);
      return html;
    }).join("") || `<div class="small">보유 바우처 없음</div>`;
  }

  {
    const el = $('#my-reviews');
    if (el) el.innerHTML = reviewsArr.map(r=>`
      <div class="item"><b>${"★".repeat(r.rating||0)}</b><div class="small">${esc(r.text||"")}</div></div>
    `).join("") || `<div class="small">작성한 리뷰 없음</div>`;
  }
}

export async function markRedeemed(voucherId){
  await db.collection('vouchers').doc(voucherId).set({
    status:'redeemed', redeemedAt: firebase.firestore.FieldValue.serverTimestamp()
  },{merge:true});
  toast('바우처 사용완료(데모)');
  refreshMy();
}
window.markRedeemed = markRedeemed;

export async function openReview(orderId){
  const rating = Number(prompt('평점 (1~5):','5'));
  if(!(rating>=1 && rating<=5)) return;
  const text = prompt('리뷰 내용을 입력하세요:','좋은 서비스였습니다!');
  if(!text) return;
  await db.collection('reviews').add({
    orderId, userUid: State.user.uid, rating, text,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  toast('리뷰 등록됨');
  refreshMy();
}
window.openReview = openReview;

/* ===== 7) 큰언니 콘솔 ===== */
export async function refreshAgentState(){
  if(!State.user){
    const s = $('#agent-status'); if (s) s.textContent = '상태: 로그인 필요';
    return;
  }
  const q = await db.collection('agents').where('ownerUid','==',State.user.uid).limit(1).get();
  State.agentDoc = q.docs[0] ? { id:q.docs[0].id, ...q.docs[0].data() } : null;
  const st = State.agentDoc ? (State.agentDoc.approved?'승인됨':(State.agentDoc.kycStatus||'심사중')) : '미가입';
  const stEl = $('#agent-status'); if (stEl) stEl.textContent = '상태: ' + st;
  if(State.agentDoc){
    const doc = State.agentDoc;
    const setv = (sel, v) => { const el=$(sel); if (el) el.value = v||""; };
    setv('#agent-name', doc.name);
    setv('#agent-bio', doc.bio);
    setv('#agent-region', doc.region);
    setv('#agent-wallet', doc.wallet);
    setv('#agent-contact', doc.contact);
    setv('#agent-messenger', doc.messenger);
    if (doc.photoURL){
      const img = $('#agent-photo-preview');
      if (img) { img.src = doc.photoURL; img.classList.remove('d-none'); }
    }
  }else{
    ['#agent-name','#agent-bio','#agent-region','#agent-wallet','#agent-contact','#agent-messenger'].forEach(s=> { const el=$(s); if (el) el.value=""; });
    const pv = $('#agent-photo-preview'); if (pv) pv.classList.add('d-none');
  }
}

const agentPhotoInput = $('#agent-photo');
if (agentPhotoInput) agentPhotoInput.addEventListener('change', async (ev)=>{
  const file = ev.target.files?.[0];
  if (!file){ return; }
  const url = URL.createObjectURL(file);
  const img = $('#agent-photo-preview');
  if (img){ img.src = url; img.classList.remove('d-none'); }
});

const agentSaveBtn = $('#agent-save');
if (agentSaveBtn) agentSaveBtn.addEventListener('click', async ()=>{
  if(!State.user){ toast('로그인이 필요합니다.'); return; }

  let photoURL = State.agentDoc?.photoURL || null;
  const file = $('#agent-photo')?.files?.[0] || null;
  if (file && storage){
    try{
      const ref = storage.ref().child(`agents/${State.user.uid}/profile_${Date.now()}.jpg`);
      await ref.put(file);
      photoURL = await ref.getDownloadURL();
    }catch(e){
      console.warn('사진 업로드 실패:', e?.message||e);
      toast('사진 업로드 권한 오류: 로그인/Storage 규칙/App Check 설정을 확인하세요.');
    }
  }

  const payload = {
    ownerUid: State.user.uid,
    name: $('#agent-name')?.value||"큰언니",
    bio: $('#agent-bio')?.value||"",
    region: $('#agent-region')?.value||"",
    wallet: $('#agent-wallet')?.value||State.wallet||null,
    contact: $('#agent-contact')?.value||"",
    messenger: $('#agent-messenger')?.value||"",
    photoURL,
    rating: State.agentDoc?.rating || 5.0,
    score: State.agentDoc?.score || 50,
    kycStatus: State.agentDoc?.kycStatus || 'pending',
    approved: State.agentDoc?.approved || false,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    storyUrl: State.agentDoc?.storyUrl || ''
  };

  let id = State.agentDoc?.id;
  if (id) await db.collection('agents').doc(id).set(payload,{merge:true});
  else { const ref = await db.collection('agents').add(payload); id = ref.id; }
  toast('큰언니 프로필이 저장되었습니다.');
  await refreshAgentState();
});

/* 나의 상품/포스트 간단 리스트 */
const listPostsBtn = $('#btn-list-posts');
if (listPostsBtn) listPostsBtn.addEventListener('click', async ()=>{
  if(!State.user || !State.agentDoc){ toast('큰언니 프로필 필요'); return; }
  const qs = await db.collection('posts').where('agentId','==',State.agentDoc.id).orderBy('createdAt','desc').limit(50).get().catch(async e=>{
    const q2 = await db.collection('posts').where('agentId','==',State.agentDoc.id).limit(100).get();
    return { docs: q2.docs.sort((a,b)=> getTS(b.data().createdAt)-getTS(a.data().createdAt)) };
  });
  const el = $('#agent-posts');
  if (el) el.innerHTML = qs.docs.map(d=>{
    const p=d.data();
    return `<div class="item">
      <div class="d-flex justify-content-between align-items-center">
        <b>${esc(p.title)}</b>${p.price?`<span class="price">${fmt(p.price)} PAW</span>`:''}
      </div>
      <div class="small">${esc((p.body||"").slice(0,120))}...</div>
    </div>`;
  }).join("") || `<div class="small">작성한 상품/포스트 없음</div>`;
});

/* 상품/포스트 등록 */
const postCreateBtn = $('#post-create');
if (postCreateBtn) postCreateBtn.addEventListener('click', async ()=>{
  if(!State.user || !State.agentDoc){ toast('큰언니 프로필 필요'); return; }
  const title = $('#post-title')?.value||"";
  const body  = $('#post-body')?.value||"";
  const price = Number($('#post-price')?.value||"0") || null;
  const tags  = ($('#post-tags')?.value||"").split(',').map(s=>s.trim()).filter(Boolean);
  if(!title){ toast('제목을 입력하세요.'); return; }
  const regionId = await ensureRegion(State.agentDoc.region);

  const files = $('#post-images')?.files || [];
  const urls = [];
  if (files.length && storage){
    for (const f of files){
      try{
        const ref = storage.ref().child(`posts/${State.agentDoc.id}/${Date.now()}_${f.name}`);
        await ref.put(f);
        urls.push(await ref.getDownloadURL());
      }catch(e){
        console.warn('이미지 업로드 실패:', e?.message||e);
        toast('이미지 업로드 권한 오류: 로그인/Storage 규칙/App Check 설정을 확인하세요.');
      }
    }
  }

  await db.collection('posts').add({
    agentId: State.agentDoc.id, agentWallet: State.agentDoc.wallet||null,
    regionId, region: State.agentDoc.region||"",
    type: price ? 'product' : 'post',
    title, body, images: urls, price, tags,
    status:'open',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  toast('상품/포스트가 등록되었습니다.');
});

async function ensureRegion(name){
  if(!name) return null;
  const q = await db.collection('regions').where('name','==',name).limit(1).get();
  if (q.docs[0]) return q.docs[0].id;
  const ref = await db.collection('regions').add({
    name, country:'VN', lang:['ko','en','vi'],
    desc:`${name} 지역 소개`, createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  return ref.id;
}

/* 파이프라인 */
export async function renderAgentPipes(){
  if(!State.user || !State.agentDoc){
    const pi = $('#pipe-inquiries'); if (pi) pi.innerHTML = `<div class="small">큰언니 프로필 저장 후 사용 가능합니다.</div>`;
    const po = $('#pipe-orders');    if (po) po.innerHTML = `<div class="small">큰언니 프로필 저장 후 사용 가능합니다.</div>`;
    return;
  }
  const [inq, ord] = await Promise.all([
    db.collection('inquiries').where('agentId','==',State.agentDoc.id).orderBy('createdAt','desc').limit(20).get().catch(async _=>{
      const qs = await db.collection('inquiries').where('agentId','==',State.agentDoc.id).limit(60).get();
      return { docs: qs.docs.sort((a,b)=> getTS(b.data().createdAt)-getTS(a.data().createdAt)).slice(0,20) };
    }),
    db.collection('orders').where('agentId','==',State.agentDoc.id).orderBy('createdAt','desc').limit(20).get().catch(async _=>{
      const qs = await db.collection('orders').where('agentId','==',State.agentDoc.id).limit(60).get();
      return { docs: qs.docs.sort((a,b)=> getTS(b.data().createdAt)-getTS(a.data().createdAt)).slice(0,20) };
    }),
  ]);
  {
    const el = $('#pipe-inquiries');
    if (el) el.innerHTML = inq.docs.map(d=>{
      const i=d.data();
      return `<div class="item">
        <div class="d-flex justify-content-between align-items-center">
          <b>${esc(i.message)}</b><span class="badge text-bg-secondary">${i.status||'-'}</span>
        </div>
        <div class="mt-2">
          <button class="btn btn-outline-secondary btn-sm" onclick="sendQuote('${d.id}')">견적 제시</button>
        </div>
      </div>`;
    }).join("") || `<div class="small">문의 없음</div>`;
  }

  {
    const el = $('#pipe-orders');
    if (el) el.innerHTML = ord.docs.map(d=>{
      const o=d.data();
      return `<div class="item">
        <div class="d-flex justify-content-between align-items-center">
          <b>주문 #${esc(o.id)}</b><span class="badge text-bg-secondary">${esc(o.status||'-')}</span>
        </div>
        <div class="small">총액 ${fmt(o.total||0)} PAW</div>
        <div class="mt-2"><button class="btn btn-outline-secondary btn-sm" onclick="confirmOrder('${o.id}')">체크아웃/정산(데모)</button></div>
      </div>`;
    }).join("") || `<div class="small">예약 없음</div>`;
  }
}
export async function sendQuote(inquiryId){
  if(!State.user || !State.agentDoc) return;
  const amount = Number(prompt('견적 금액(PAW):','100'));
  if(!(amount>0)) return;
  await db.collection('quotes').add({
    inquiryId, agentId: State.agentDoc.id, items:[], total: amount, currency:'PAW',
    terms:'기본 약관', expiresAt: new Date(Date.now()+1000*60*60*24*3),
    status:'제출', createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await db.collection('inquiries').doc(inquiryId).set({ status:'견적' },{merge:true});
  toast('견적이 제출되었습니다.');
}
window.sendQuote = sendQuote;

export async function confirmOrder(orderId){
  await db.collection('orders').doc(orderId).set({ status:'완료' },{merge:true});
  toast('체크아웃 처리(데모).');
  renderAgentPipes();
}
window.confirmOrder = confirmOrder;
