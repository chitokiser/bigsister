/* app.js — 단일 진입점(ESM)
 * - Firebase 초기화(compat)
 * - 로그인/지갑/티어
 * - 라우터 + 홈/검색/마이/큰언니/운영자
 * - 승인 흐름(신청→운영자 승인→홈 카드 노출)
 */
'use strict';

/* =========================
 * 0) 전역 도우미
 * ========================= */
// 단일/복수 셀렉터 분리
const $  = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

/** 재귀 없는 안전 토스트 */
function toast(message){
  const text = String(message ?? '');
  try{
    if (window.Toastify){ window.Toastify({ text, duration: 2500 }).showToast(); return; }
    if (window.M && window.M.toast){ window.M.toast({ html: text }); return; }
    if (window.Notyf){ (new window.Notyf()).open({ message: text }); return; }
  }catch(_){} // 무시
  alert(text);
}

// 안전 이스케이프
const ESC_MAP = { "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;", "`":"&#96;" };
const esc = (s)=> String(s ?? "").replace(/[&<>'"`]/g, ch => ESC_MAP[ch]);

const nl2br = (s)=> (s||"").replace(/\n/g,"<br/>");
const fmt   = (n)=> new Intl.NumberFormat().format(Number(n||0));
const cryptoRandomId = ()=> Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
function getTS(x){
  if (!x) return 0;
  if (typeof x.toMillis === 'function') return x.toMillis();
  if (x?.toDate) { try{ return x.toDate().getTime(); }catch(_){ } }
  if (x instanceof Date) return x.getTime();
  if (typeof x === 'number') return x;
  return 0;
}
// EVM 주소 검증
const isValidAddress = (addr) => /^0x[a-fA-F0-9]{40}$/.test(addr || "");

/* 공유 상태 */
const State = {
  user: null,
  isAdmin: false,
  wallet: null,
  signer: null,
  tier: 0,
  agentDoc: null,
};

/* =========================
 * 1) Firebase 초기화 (compat)
 * ========================= */
const FB = window.firebase;
const CFG = window.CONFIG || {};
if (!FB) throw new Error('Firebase compat SDK가 로드되지 않았습니다.');
if (!CFG.firebase || !CFG.firebase.apiKey) {
  console.error('[app] window.CONFIG.firebase 누락: src/config.js에 실제 키 입력 필요');
}
const app   = (FB.apps && FB.apps.length) ? FB.app() : FB.initializeApp(CFG.firebase);
const auth  = FB.auth();
const db    = FB.firestore();
const store = FB.storage?.();

/* 필요 시 전역 노출(다른 플러그인 대비) */
window.App = window.App || {};
Object.assign(window.App, { auth, db, storage: store, State, toast, esc, $, $$, nl2br, fmt });

/* =========================
 * 2) 체인/티어/지갑
 * ========================= */
const CHAIN   = window.CHAIN   || (CFG.chain||{chainId:1, rpcUrl:""});
const ONCHAIN = window.ONCHAIN || (CFG.onchain||{ BET:{address:""}, TravelEscrow:{address:"0x0000", abi:[]} });
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)'
];

function setTierPill(tier) {
  State.tier = tier||0;
  const el = $('#tier-pill');
  if (!el) return;
  if (State.tier > 0) { el.textContent = `티어: ${State.tier}`; el.classList.remove('hidden'); } 
  else { el.textContent = '티어: -'; el.classList.add('hidden'); }
}

async function getTier(walletAddr){
  if (!walletAddr) return 0;
  const betAddr = ONCHAIN?.BET?.address || "";
  if (!isValidAddress(betAddr)) { setTierPill(1); return 1; } // 유효 BET 주소 없으면 데모 정책: Tier 1

  const { ethers } = window;
  if (!ethers) return 0;
  const provider = window.ethereum
    ? new ethers.BrowserProvider(window.ethereum)
    : (CHAIN.rpcUrl ? new ethers.JsonRpcProvider(CHAIN.rpcUrl) : null);
  if (!provider) return 0;

  const erc = new ethers.Contract(betAddr, ERC20_ABI, provider);
  let decimals = 18;
  try { decimals = Number(await erc.decimals()); } catch(_) {}

  let bal = 0;
  try {
    const raw = await erc.balanceOf(walletAddr);
    bal = Number(window.ethers.formatUnits(raw, decimals));
  } catch(e) { console.warn('BET balance 조회 실패:', e); }

  const th = (CFG.tierThresholds)||{1:1,2:100,3:1000};
  let tier = 0;
  if (bal >= (th[3]??Infinity)) tier = 3;
  else if (bal >= (th[2]??Infinity)) tier = 2;
  else if (bal >= (th[1]??1)) tier = 1;

  setTierPill(tier);
  return tier;
}

async function connectWallet(){
  if (!window.ethereum){ toast('메타마스크 등 지갑을 설치해 주세요.'); return; }
  try{
    const accounts = await window.ethereum.request({ method:'eth_requestAccounts' });
    const wallet = accounts?.[0];
    if (!wallet) { toast('지갑 연결 취소'); return; }

    // 체인 스위치
    const targetHex = '0x'+Number(CHAIN.chainId||0).toString(16);
    try{
      const cur = await window.ethereum.request({ method:'eth_chainId' });
      if (cur?.toLowerCase() !== targetHex.toLowerCase()){
        await window.ethereum.request({ method:'wallet_switchEthereumChain', params:[{chainId: targetHex}] });
      }
    }catch(e){
      try{
        await window.ethereum.request({
          method:'wallet_addEthereumChain',
          params:[{ 
            chainId: targetHex, 
            chainName: CHAIN.network||'Custom', 
            rpcUrls:[CHAIN.rpcUrl].filter(Boolean),
            nativeCurrency:{ name:'ETH', symbol:'ETH', decimals:18 } 
          }]
        });
      }catch(_){/* 무시 */}
    }

    // signer
    const { ethers } = window;
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();

    State.wallet = wallet;
    State.signer = signer;
    const btn = $('#btn-wallet'); if (btn) btn.textContent = `연결됨: ${wallet.slice(0,6)}…${wallet.slice(-4)}`;

    try { await getTier(wallet); } catch(_) {}
    toast('지갑 연결 완료');
  }catch(e){
    console.error(e);
    toast('지갑 연결 실패: ' + (e?.message||e));
  }
}

/* =========================
 * 3) 인증 (구글)
 * ========================= */
async function computeIsAdmin(user){
  try {
    const tok = await user.getIdTokenResult?.();
    if (tok?.claims?.admin === true) return true;
  } catch(_) {}

  try {
    const udoc = await db.collection('users').doc(user.uid).get();
    if (udoc.exists && (udoc.data().role === 'admin')) return true;
  } catch(_) {}
  return false;
}

async function loginGoogle(){
  const provider = new firebase.auth.GoogleAuthProvider();
  try{
    const { user } = await auth.signInWithPopup(provider);
    if (!user) return;

    await db.collection('users').doc(user.uid).set({
      uid: user.uid, email: user.email||null, displayName: user.displayName||null, photoURL: user.photoURL||null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge:true });

    State.user = user;
    State.isAdmin = await computeIsAdmin(user);

    // 헤더/내비 반영
    $$('[data-admin-only]').forEach(el=> el.classList.toggle('hidden', !State.isAdmin));
    const btnGoogle = $('#btn-google'); if (btnGoogle) btnGoogle.classList.add('hidden');
    const btnLogout = $('#btn-logout'); if (btnLogout) btnLogout.classList.remove('hidden');
    const up = $('#user-photo'); if (up && user.photoURL){ up.src = user.photoURL; up.classList.remove('hidden'); }

    toast('로그인되었습니다.');
    await afterAuthRender();
  }catch(e){
    console.error(e);
    toast('로그인 실패: ' + (e?.message || e));
  }
}

async function logout(){
  try{
    await auth.signOut();
    State.user = null;
    State.isAdmin = false;
    State.wallet = null; State.signer = null;
    setTierPill(0);

    $$('[data-admin-only]').forEach(el=> el.classList.add('hidden'));
    const btnGoogle = $('#btn-google'); if (btnGoogle) btnGoogle.classList.remove('hidden');
    const btnLogout = $('#btn-logout'); if (btnLogout) btnLogout.classList.add('hidden');
    const up = $('#user-photo'); if (up) up.classList.add('hidden');
    const wbtn = $('#btn-wallet'); if (wbtn) wbtn.textContent = '지갑 연결';

    toast('로그아웃 되었습니다.');
    await afterAuthRender();
  }catch(e){
    console.error(e);
    toast('로그아웃 실패: ' + (e?.message || e));
  }
}

/* =========================
 * 4) 라우터
 * ========================= */
function hashRoute(){ return (location.hash||"#").replace("#/", "") || "home"; }
function routeTo(name){ location.hash = name==="home" ? "#/" : `#/${name}` }
window.addEventListener('hashchange', renderRoute);

async function renderRoute(){
  const r = hashRoute();
  $$('.view').forEach(v=> v.classList.remove('active'));
  const viewId = r === 'admin' ? 'view-admin' : `view-${r}`;
  const el = $('#'+viewId);
  if (el) el.classList.add('active');

  if (r === 'search') await doSearch();
  if (r === 'agent')  await renderAgentPipes();
  if (r === 'admin')  await renderAdmin();
}

/* =========================
 * 5) 홈/검색/상세
 * ========================= */
const homeSearchBtn = $('#home-search');
if (homeSearchBtn) homeSearchBtn.addEventListener('click', ()=>{
  const q = $('#home-q')?.value || '';
  const target = $('#search-q'); if (target) target.value = q;
  routeTo('search');
});
const searchRunBtn = $('#search-run');
if (searchRunBtn) searchRunBtn.addEventListener('click', ()=> doSearch());

async function refreshHome(){
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
      .where('approved','==',true).orderBy('score','desc').limit(6).get();
    agDocs = snap.docs;
  }catch(e){
    console.warn('agents(approved=true) local-sort fallback:', e?.message||e);
    const snap = await db.collection('agents').where('approved','==',true).limit(30).get().catch(()=>({docs:[]}));
    agDocs = snap.docs.sort((a,b)=> (b.data().score||0)-(a.data().score||0)).slice(0,6);
  }
  {
    const el = $('#agent-grid');
    const html = (agDocs||[]).map(x=> cardAgent(x.data())).join("") || `<div class="small">승인된 큰언니가 없습니다.</div>`;
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
  return `<div class="card">
    <div class="row spread"><b>${esc(r.name)}</b><span class="badge">${esc((r.country||"").toUpperCase())}</span></div>
    <div class="small">${esc(r.desc||"")}</div>
  </div>`;
}
function cardAgent(a){
  return `<div class="card">
    <div class="row spread">
      <b>${esc(a.name||"큰언니")}</b>
      <span class="badge">평점 ${Math.round((a.rating||0)*10)/10} · 스코어 ${a.score||0}</span>
    </div>
    ${a.photoURL ? `<div class="thumb" style="margin:.5rem 0"><img src="${esc(a.photoURL)}" style="width:100%;max-height:160px;object-fit:cover;border-radius:12px"/></div>` : ``}
    <div class="small">${esc(a.bio||"")}</div>
    <div class="kit"><span class="tag">${esc(a.region||"-")}</span>${(a.badges||[]).slice(0,3).map(x=>`<span class="tag">${esc(x)}</span>`).join("")}</div>
  </div>`;
}

async function doSearch(){
  const q = ($('#search-q')?.value||"").trim().toLowerCase();
  const snap = await db.collection('posts').where('status','==','open').limit(50).get().catch(()=>({docs:[]}));
  const items = snap.docs.map(d=> ({id:d.id, ...d.data()})).filter(p=>
    (p.title||"").toLowerCase().includes(q) ||
    (p.body||"").toLowerCase().includes(q) ||
    (p.tags||[]).join(',').toLowerCase().includes(q) ||
    (p.region||"").toLowerCase().includes(q)
  );
  const el = $('#search-grid');
  if (el) el.innerHTML = items.map(cardPost).join("") || `<div class="small">검색 결과가 없습니다.</div>`;
}
function cardPost(p){
  return `<div class="card">
    <div class="row spread"><b>${esc(p.title)}</b>${p.price?`<span class="price">${fmt(p.price)} PAW</span>`:''}</div>
    <div class="small">${esc((p.body||"").slice(0,120))}...</div>
    <div class="kit">${(p.tags||[]).slice(0,5).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>
    <div class="row gap" style="margin-top:8px">
      <button class="btn" onclick="openDetail('${p.id}')">자세히</button>
      <button class="btn outline" onclick="openInquiry('${p.id}')">문의</button>
    </div>
  </div>`;
}

async function openDetail(postId){
  const doc = await db.collection('posts').doc(postId).get();
  if(!doc.exists){ toast('존재하지 않는 상품입니다.'); return; }
  const p = doc.data();
  const el = $('#detail-wrap');
  if (el) {
    el.innerHTML = `
      <div class="row spread">
        <h3>${esc(p.title)}</h3>
        ${p.price? `<span class="price">${fmt(p.price)} PAW</span>`:''}
      </div>
      <div class="small">${nl2br(esc(p.body||""))}</div>
      <div class="kit">${(p.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>
      <div class="row gap" style="margin-top:10px">
        <button class="btn" onclick="openInquiry('${postId}')">문의하기</button>
        <button class="btn outline" onclick="bookDirect('${postId}')">즉시 예약(데모)</button>
      </div>
    `;
  }
  routeTo('detail');
}
window.openDetail = openDetail;

/* 문의 */
window.openInquiry = async function(postId){
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
};

/* 예약(데모) */
window.bookDirect = async function(postId){
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

  // 온체인 생략(데모) — 주소/ABI 유효성 체크
  try{
    const okAddr = isValidAddress(ONCHAIN?.TravelEscrow?.address);
    const okAbi  = Array.isArray(ONCHAIN?.TravelEscrow?.abi) && ONCHAIN.TravelEscrow.abi.length > 0;
    if (State.signer && okAddr && okAbi){
      const { ethers } = window;
      const c = new ethers.Contract(ONCHAIN.TravelEscrow.address, ONCHAIN.TravelEscrow.abi, State.signer);
      const idBytes = ethers.id('order:'+orderId);
      const tokenAddr = isValidAddress(ONCHAIN?.BET?.address) ? ONCHAIN.BET.address : ethers.ZeroAddress;
      const tx = await c.book(idBytes, tokenAddr, ethers.parseUnits(String(amount), 18), agentWallet);
      await tx.wait();
    }
  }catch(e){ console.warn('온체인 결제 실패(데모 계속):', e?.shortMessage||e?.message||e); }

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
  routeTo('my');
  refreshMy();
};

async function agentWalletById(agentId){
  if(!agentId) return null;
  const doc = await db.collection('agents').doc(agentId).get();
  return doc.exists ? (doc.data().wallet || null) : null;
}

/* =========================
 * 6) 마이
 * ========================= */
async function refreshMy(){
  if(!State.user){
    const o = $('#my-orders');   if (o) o.innerHTML   = `<div class="small">로그인 필요</div>`;
    const v = $('#my-vouchers'); if (v) v.innerHTML   = `<div class="small">로그인 필요</div>`;
    const r = $('#my-reviews');  if (r) r.innerHTML   = `<div class="small">로그인 필요</div>`;
    return;
  }

  // orders
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

  // vouchers
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
        <div class="row spread"><b>주문 #${esc(o.id)}</b><span class="badge">${esc(o.status||'-')}</span></div>
        <div class="small">총액 ${fmt(o.total||0)} PAW</div>
        <div class="kit"><button class="btn outline" onclick="openReview('${o.id}')">리뷰 작성</button></div>
      </div>
    `).join("") || `<div class="small">예약 내역 없음</div>`;
  }

  {
    const el = $('#my-vouchers');
    if (el) el.innerHTML = vouchersArr.map(v=>{
      const elId = 'qr_'+v.id;
      const expiry = v.expiry?.toDate?.() || v.expiry;
      const html = `
        <div class="card">
          <div class="row spread"><b>바우처 ${esc(v.id)}</b><span class="badge">${esc(v.status||'-')}</span></div>
          <div class="small">유효기간: ${expiry ? new Date(expiry).toLocaleDateString() : "-"}</div>
          <div id="${elId}" style="padding:8px;background:#fff;border-radius:12px;margin-top:8px"></div>
          <div class="kit"><button class="btn outline" onclick="markRedeemed('${v.id}')">사용완료 표시(데모)</button></div>
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

window.markRedeemed = async function(voucherId){
  await db.collection('vouchers').doc(voucherId).set({
    status:'redeemed', redeemedAt: firebase.firestore.FieldValue.serverTimestamp()
  },{merge:true});
  toast('바우처 사용완료(데모)');
  refreshMy();
};
window.openReview = async function(orderId){
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
};

/* =========================
 * 7) 큰언니 콘솔
 * ========================= */
async function refreshAgentState(){
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
      if (img) { img.src = doc.photoURL; img.classList.remove('hidden'); }
    }
  }else{
    ['#agent-name','#agent-bio','#agent-region','#agent-wallet','#agent-contact','#agent-messenger'].forEach(s=> { const el=$(s); if (el) el.value=""; });
    const pv = $('#agent-photo-preview'); if (pv) pv.classList.add('hidden');
  }
}

const agentPhotoInput = $('#agent-photo');
if (agentPhotoInput) agentPhotoInput.addEventListener('change', async (ev)=>{
  const file = ev.target.files?.[0];
  if (!file){ return; }
  const url = URL.createObjectURL(file);
  const img = $('#agent-photo-preview');
  if (img){ img.src = url; img.classList.remove('hidden'); }
});

const agentSaveBtn = $('#agent-save');
if (agentSaveBtn) agentSaveBtn.addEventListener('click', async ()=>{
  if(!State.user){ toast('로그인이 필요합니다.'); return; }

  // 사진 업로드 (선택)
  let photoURL = State.agentDoc?.photoURL || null;
  const file = $('#agent-photo')?.files?.[0] || null;
  if (file && store){
    try{
      const ref = store.ref().child(`agents/${State.user.uid}/profile_${Date.now()}.jpg`);
      await ref.put(file);
      photoURL = await ref.getDownloadURL();
    }catch(e){ console.warn('사진 업로드 실패(무시):', e); }
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
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
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
      <div class="row spread"><b>${esc(p.title)}</b>${p.price?`<span class="price">${fmt(p.price)} PAW</span>`:''}</div>
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

  // 이미지 업로드
  const files = $('#post-images')?.files || [];
  const urls = [];
  if (files.length && store){
    for (const f of files){
      try{
        const ref = store.ref().child(`posts/${State.agentDoc.id}/${Date.now()}_${f.name}`);
        await ref.put(f);
        urls.push(await ref.getDownloadURL());
      }catch(e){ console.warn('이미지 업로드 실패(무시):', e); }
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
async function renderAgentPipes(){
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
        <div class="row spread"><b>${esc(i.message)}</b><span class="badge">${i.status||'-'}</span></div>
        <div class="kit">
          <button class="btn outline" onclick="sendQuote('${d.id}')">견적 제시</button>
        </div>
      </div>`;
    }).join("") || `<div class="small">문의 없음</div>`;
  }

  {
    const el = $('#pipe-orders');
    if (el) el.innerHTML = ord.docs.map(d=>{
      const o=d.data();
      return `<div class="item">
        <div class="row spread"><b>주문 #${esc(o.id)}</b><span class="badge">${esc(o.status||'-')}</span></div>
        <div class="small">총액 ${fmt(o.total||0)} PAW</div>
        <div class="kit"><button class="btn outline" onclick="confirmOrder('${o.id}')">체크아웃/정산(데모)</button></div>
      </div>`;
    }).join("") || `<div class="small">예약 없음</div>`;
  }
}
window.sendQuote = async function(inquiryId){
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
};
window.confirmOrder = async function(orderId){
  await db.collection('orders').doc(orderId).set({ status:'완료' },{merge:true});
  toast('체크아웃 처리(데모).');
  renderAgentPipes();
};

/* =========================
 * 8) 운영자 콘솔
 * ========================= */
async function requireAdmin(){ if (State.isAdmin) return true; toast('운영자만 접근 가능합니다.'); routeTo('home'); return false; }

async function renderAdmin(){
  if(!(await requireAdmin())) return;

  const MAX = 50;
  // approved=false
  let listA=[];
  try{
    const q = await db.collection('agents').where('approved','==',false).orderBy('updatedAt','desc').limit(MAX).get();
    listA = q.docs;
  }catch(e){
    console.warn('agents(approved=false) local-sort fallback:', e?.message||e);
    const q = await db.collection('agents').where('approved','==',false).limit(MAX).get();
    listA = q.docs.sort((a,b)=> getTS(b.data().updatedAt)-getTS(a.data().updatedAt));
  }
  // kycStatus=review
  let listB=[];
  try{
    const q2 = await db.collection('agents').where('kycStatus','==','review').orderBy('updatedAt','desc').limit(MAX).get();
    listB = q2.docs;
  }catch(e){
    console.warn('agents(kycStatus=review) local-sort fallback:', e?.message||e);
    const q2 = await db.collection('agents').where('kycStatus','==','review').limit(MAX).get();
    listB = q2.docs.sort((a,b)=> getTS(b.data().updatedAt)-getTS(a.data().updatedAt));
  }

  const uniq = new Map();
  [...listA,...listB].forEach(d=> uniq.set(d.id,d));
  const docs = [...uniq.values()];

  {
    const el = $('#admin-agents');
    if (el) el.innerHTML =
      docs.map(d=>{
        const a=d.data();
        return `<div class="item">
          <div class="row spread"><b>${esc(a.name||'-')} (${esc(a.region||'-')})</b>
            <span class="badge">${esc(a.kycStatus||'-')}</span></div>
          <div class="small">${esc(a.bio||'')}</div>
          <div class="kit">
            <button class="btn" onclick="approveAgent('${d.id}')">승인</button>
            <button class="btn outline" onclick="rejectAgent('${d.id}')">반려</button>
          </div>
        </div>`;
      }).join("") || `<div class="small">대기 중인 큰언니 없음</div>`;
  }

  // 신청 히스토리
  let apps=[];
  try{
    const snap = await db.collection('agent_applications').orderBy('createdAt','desc').limit(50).get();
    apps = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
  }catch(e){
    const snap = await db.collection('agent_applications').limit(200).get();
    apps = snap.docs.map(d=> ({ id:d.id, ...d.data() }))
      .sort((a,b)=> getTS(b.createdAt)-getTS(a.createdAt)).slice(0,50);
  }
  {
    const el = $('#admin-agent-apps');
    if (el) el.innerHTML =
      (apps.map(it=>{
        const when = it.createdAt?.toDate?.() || it.createdAt || null;
        return `<div class="item">
          <div class="row spread"><b>${esc((it.action||'submitted').toUpperCase())}</b>
            <span class="badge">${esc(it.status||'-')}</span></div>
          <div class="small">
            agentId: ${esc(it.agentId||'-')} · region: ${esc(it.region||'-')}<br/>
            ownerUid: ${esc(it.ownerUid||'-')}
            ${it.actionByEmail? ` · by ${esc(it.actionByEmail)}`:''}
            ${when? ` · ${new Date(when).toLocaleString()}`:''}
          </div>
        </div>`;
      }).join("") || `<div class="small">신청 내역 없음</div>`);
  }

  // 바우처/공지 렌더
  const vs = await db.collection('vouchers').orderBy('createdAt','desc').limit(20).get().catch(()=>({docs:[]}));
  {
    const el = $('#v-issued');
    if (el) el.innerHTML = vs.docs.map(d=>{
      const v=d.data();
      return `<div class="item">
        <div class="row spread"><b>${esc(v.id)}</b><span class="badge">${esc(v.status||'-')}</span></div>
        <div class="small">scope: ${esc(v.scope||"-")} · face: ${esc(v.faceValue||0)} · expiry: ${new Date(v.expiry?.toDate?.()||v.expiry).toLocaleDateString()}</div>
      </div>`;
    }).join("") || `<div class="small">발행 없음</div>`;
  }

  const ns = await db.collection('notices').orderBy('startAt','desc').limit(20).get().catch(()=>({docs:[]}));
  {
    const el = $('#n-list');
    if (el) el.innerHTML = ns.docs.map(d=>{
      const n=d.data();
      return `<div class="item"><b>${esc(n.title)}</b><div class="small">${esc(n.body||"")}</div></div>`;
    }).join("") || `<div class="small">공지 없음</div>`;
  }
}

window.approveAgent = async function(agentId){
  if(!(await requireAdmin())) return;
  await db.collection('agents').doc(agentId).set({
    approved:true, kycStatus:'approved',
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  },{merge:true});

  const ag = await db.collection('agents').doc(agentId).get();
  await db.collection('agent_applications').add({
    agentId,
    ownerUid: ag.exists ? (ag.data().ownerUid||null) : null,
    action:'approved', status:'approved',
    actionByUid: State.user?.uid||null, actionByEmail: State.user?.email||null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  toast('승인 완료');
  await refreshHome();
  await renderAdmin();
};
window.rejectAgent = async function(agentId){
  if(!(await requireAdmin())) return;
  await db.collection('agents').doc(agentId).set({
    approved:false, kycStatus:'rejected',
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  },{merge:true});

  const ag = await db.collection('agents').doc(agentId).get();
  await db.collection('agent_applications').add({
    agentId,
    ownerUid: ag.exists ? (ag.data().ownerUid||null) : null,
    action:'rejected', status:'rejected',
    actionByUid: State.user?.uid||null, actionByEmail: State.user?.email||null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  toast('반려 처리');
  await renderAdmin();
};

/* bigSisterApplications (옵션) */
const showBigSisterBtn = $('#btn-show-bigsister-applications');
if (showBigSisterBtn) showBigSisterBtn.addEventListener('click', async ()=>{
  if(!(await requireAdmin())) return;
  const wrap = $('#bigSisterApplicationsList');
  if (!wrap) return;
  wrap.innerHTML = '<h3>큰언니 심사 신청 내역</h3>';
  try{
    let items=[];
    try{
      const snap = await db.collection('bigSisterApplications').orderBy('timestamp','desc').limit(100).get();
      items = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
    }catch(e){
      const snap = await db.collection('bigSisterApplications').limit(200).get();
      items = snap.docs.map(d=> ({ id:d.id, ...d.data() }))
        .sort((a,b)=> getTS(b.timestamp)-getTS(a.timestamp));
    }
    if (!items.length){ wrap.innerHTML += '<p>신청 내역이 없습니다.</p>'; return; }
    items.forEach(it=>{
      const when = it.timestamp?.toDate?.() || it.timestamp || null;
      const div = document.createElement('div');
      div.className = 'card application-item';
      div.innerHTML = `
        <h4>신청자: ${esc(it.name||'N/A')}</h4>
        <p>이메일: ${esc(it.email||'N/A')}</p>
        <p>전화번호: ${esc(it.phone||'N/A')}</p>
        <p>상태: ${esc(it.status||'N/A')}</p>
        <p>신청일: ${when? new Date(when).toLocaleString() : 'N/A'}</p>
        <p>소개: ${esc(it.bio||'N/A')}</p>
        <p>지역: ${esc(it.region||'N/A')}</p>
        <button class="btn approve-btn" data-id="${it.id}" data-status="approved">승인</button>
        <button class="btn subtle reject-btn" data-id="${it.id}" data-status="rejected">거절</button>`;
      wrap.appendChild(div);
    });
    wrap.querySelectorAll('.approve-btn,.reject-btn').forEach(btn=>{
      btn.addEventListener('click', async (ev)=>{
        if(!(await requireAdmin())) return;
        const id = ev.currentTarget.dataset.id;
        const st = ev.currentTarget.dataset.status;
        await db.collection('bigSisterApplications').doc(id).set({ status: st },{merge:true});
        toast(`신청 ${id} → ${st}`);
        const reBtn = $('#btn-show-bigsister-applications');
        if (reBtn) reBtn.click();
      });
    });
  }catch(e){ console.error('Error fetching bigSisterApplications:', e); wrap.innerHTML += '<p>신청 내역을 불러오는 데 오류가 발생했습니다.</p>'; }
});

/* 바우처/공지 */
const vIssueBtn = $('#v-issue');
if (vIssueBtn) vIssueBtn.addEventListener('click', async ()=>{
  if(!(await requireAdmin())) return;
  const scope = $('#v-region')?.value||"global";
  const face  = Number($('#v-face')?.value||"0");
  const exp   = $('#v-exp')?.value ? new Date($('#v-exp').value) : new Date(Date.now()+1000*60*60*24*30);
  const id = 'V' + Math.random().toString(36).slice(2,9);
  await db.collection('vouchers').doc(id).set({
    id, scope, faceValue: face, rules:{}, expiry: exp, supply:1, claimed:0, redeemed:0, status:'issued',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  toast('바우처 발행 완료');
  renderAdmin();
});
const nPublishBtn = $('#n-publish');
if (nPublishBtn) nPublishBtn.addEventListener('click', async ()=>{
  if(!(await requireAdmin())) return;
  const title = $('#n-title')?.value||"";
  const body  = $('#n-body')?.value||"";
  if(!title){ toast('제목을 입력하세요.'); return; }
  await db.collection('notices').add({
    title, body, pinned:false,
    startAt: new Date(Date.now()-60000),
    endAt: new Date(Date.now()+1000*60*60*24*7),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  const t = $('#n-title'); if (t) t.value = '';
  const b = $('#n-body');  if (b) b.value  = '';
  toast('공지 발행됨');
  renderAdmin();
});

/* 데모 시드/퍼지 */
const seedDemoBtn  = $('#seed-demo');
if (seedDemoBtn)  seedDemoBtn.addEventListener('click', seedDemo);
const purgeDemoBtn = $('#purge-demo');
if (purgeDemoBtn) purgeDemoBtn.addEventListener('click', purgeDemo);
const seedDemoFooterBtn  = $('#seed-demo-footer');
if (seedDemoFooterBtn)  seedDemoFooterBtn.addEventListener('click', ()=> { const x=$('#seed-demo'); if (x) x.click(); });
const purgeDemoFooterBtn = $('#purge-demo-footer');
if (purgeDemoFooterBtn) purgeDemoFooterBtn.addEventListener('click', ()=> { const x=$('#purge-demo'); if (x) x.click(); });

async function seedDemo(){
  await db.collection('regions').add({ name:'다낭', country:'VN', lang:['ko','en','vi'], desc:'해양/미식/액티비티 허브', createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  await db.collection('regions').add({ name:'동호이', country:'VN', lang:['ko','en','vi'], desc:'동굴/자연/로컬', createdAt: firebase.firestore.FieldValue.serverTimestamp() });

  const ownerUid = State.user?.uid || 'demo';
  const agentRef = await db.collection('agents').add({
    ownerUid,
    name:'KE 다낭팀', bio:'공항픽업/투어/생활지원', region:'다낭', wallet:null,
    rating:4.9, score:88, badges:['행정지원','교통지원'], kycStatus:'approved', approved:true,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await db.collection('posts').add({
    agentId: agentRef.id, region:'다낭', regionId: null,
    type:'product', title:'다낭 시내 투어 (4h)', body:'전용차량+가이드 포함. 일정 커스텀 가능.', price:120, tags:['다낭','투어','교통'], status:'open',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await db.collection('notices').add({
    title:'파일럿 운영 중', body:'문의/예약은 데모 흐름을 통해 시험해보세요.',
    startAt:new Date(Date.now()-3600_000), endAt:new Date(Date.now()+3600_000*24*30),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  toast('데모 데이터 시드 완료');
  refreshHome();
}

async function purgeDemo(){
  const colls = ['regions','agents','posts','inquiries','quotes','orders','vouchers','reviews','notices','agent_applications'];
  for(const c of colls){
    const qs = await db.collection(c).limit(50).get();
    const batch = db.batch();
    qs.forEach(d=> batch.delete(d.ref));
    await batch.commit();
  }
  toast('데모 데이터 삭제 완료');
  refreshHome(); refreshMy(); renderAdmin(); renderAgentPipes();
}

/* =========================
 * 9) 헤더 버튼 바인딩 & 인증 상태
 * ========================= */
const btnGoogle = $('#btn-google'); if (btnGoogle) btnGoogle.addEventListener('click', loginGoogle);
const btnLogout = $('#btn-logout'); if (btnLogout) btnLogout.addEventListener('click', logout);
const btnWallet = $('#btn-wallet'); if (btnWallet) btnWallet.addEventListener('click', connectWallet);

$$('a[data-link]').forEach(a=>{
  a.addEventListener('click',(e)=>{
    e.preventDefault();
    const href = a.getAttribute('href') || '#/';
    location.hash = href.replace('#/','') ? href : '#/';
  });
});

auth.onAuthStateChanged(async (user)=>{
  State.user = user || null;
  State.isAdmin = user ? (await computeIsAdmin(user)) : false;
  $$('[data-admin-only]').forEach(el=> el.classList.toggle('hidden', !State.isAdmin));
  if (user){
    const g = $('#btn-google'); if (g) g.classList.add('hidden');
    const l = $('#btn-logout'); if (l) l.classList.remove('hidden');
    const up=$('#user-photo'); if (up && user.photoURL){ up.src=user.photoURL; up.classList.remove('hidden'); }
  }else{
    const g = $('#btn-google'); if (g) g.classList.remove('hidden');
    const l = $('#btn-logout'); if (l) l.classList.add('hidden');
    const up=$('#user-photo'); if (up) up.classList.add('hidden');
  }
  await afterAuthRender();
});

/* =========================
 * 10) 초기 진입
 * ========================= */
async function afterAuthRender(){
  await refreshHome();
  await refreshMy();
  await refreshAgentState();

  // 홈이 기본
  if (!location.hash) routeTo('home');
  await renderRoute();
}

// 첫 렌더
afterAuthRender().catch(console.error);
