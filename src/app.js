/* ============================================================
 * NomadLocal MVP — HTML/JS/CSS 3파일 버전
 * - Firebase: Auth/Firestore/Storage
 * - 지갑 연결(opBNB), 티어 게이트(Registry 스텁)
 * - 문의→견적→예약(book) 흐름(에스크로 컨트랙트 스텁 호출)
 * - 바우처 문서 발행 + QR 생성/표시 (온체인 redeem 연동 지점 표시)
 * ============================================================ */

/* ---------- 0) Helpers ---------- */
const $ = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));
const toast = (m) => alert(m);
const fmt = (n) => new Intl.NumberFormat('ko-KR').format(n);

/* ---------- 1) Config ---------- */
const FIREBASE_CONFIG = {
  // ⬇️ Firebase 콘솔 > 프로젝트 설정 > SDK 설정에 있는 값으로 교체
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_ID.firebaseapp.com",
  projectId: "YOUR_ID",
  storageBucket: "YOUR_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

const CHAIN = {
  // opBNB Mainnet (chainId 204 = 0xCC)
  chainIdHex: "0xCC",
  chainName: "opBNB Mainnet",
  rpcUrls: ["https://opbnb-mainnet-rpc.bnbchain.org"],
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  blockExplorerUrls: ["https://opbnbscan.com/"]
};

// 온체인 주소/ABI 스텁 (연결 시 교체)
const ONCHAIN = {
  TierRegistry: {
    address: "0x0000000000000000000000000000000000000000", // 교체
    abi: [{ "inputs":[{"internalType":"address","name":"user","type":"address"}],
            "name":"levelOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],
            "stateMutability":"view","type":"function"}]
  },
  TravelEscrow: {
    address: "0x0000000000000000000000000000000000000000", // 교체
    abi: [
      {"anonymous":false,"inputs":[{"indexed":false,"internalType":"bytes32","name":"orderId","type":"bytes32"},{"indexed":false,"internalType":"address","name":"payer","type":"address"},{"indexed":false,"internalType":"address","name":"agent","type":"address"},{"indexed":false,"internalType":"address","name":"token","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"Book","type":"event"},
      {"inputs":[{"internalType":"bytes32","name":"orderId","type":"bytes32"},{"internalType":"address","name":"token","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"address","name":"agent","type":"address"}],"name":"book","outputs":[],"stateMutability":"nonpayable","type":"function"}
    ]
  },
  BET: { address: "0x0000000000000000000000000000000000000000" } // 결제 스테이블 토큰(ERC-20) 주소
};

/* ---------- 2) Firebase Init ---------- */
firebase.initializeApp(FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

/* ---------- 3) State ---------- */
const State = {
  user: null,              // Firebase User
  wallet: null,            // 지갑 주소
  tier: 0,                 // 온체인 티어
  agentDoc: null,          // 내 큰언니 문서
  provider: null, signer: null,
};

/* ---------- 4) Auth ---------- */
$("#btn-google").addEventListener("click", async ()=>{
  try{
    const provider = new firebase.auth.GoogleAuthProvider();
    const res = await auth.signInWithPopup(provider);
    // 프로필 문서 upsert
    const u = res.user;
    await db.collection("users").doc(u.uid).set({
      uid: u.uid,
      email: u.email || null,
      displayName: u.displayName || null,
      photo: u.photoURL || null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge:true });
  }catch(e){ console.error(e); toast("로그인 실패: " + e.message); }
});
$("#btn-logout").addEventListener("click", ()=> auth.signOut());

auth.onAuthStateChanged(async (u)=>{
  State.user = u || null;
  $("#btn-google").classList.toggle("hidden", !!u);
  $("#btn-logout").classList.toggle("hidden", !u);
  $("#user-photo").classList.toggle("hidden", !u);
  if(u && u.photoURL){ $("#user-photo").src = u.photoURL; }

  await refreshAgentState();
  if(location.hash === "" || location.hash === "#/"){ routeTo("home"); }
  refreshHome();
  refreshMy();
  if(hashRoute()==="agent") renderAgentPipes();
  if(hashRoute()==="admin") renderAdmin();
});

/* ---------- 5) Wallet / Chain / Tier ---------- */
async function connectWallet(){
  if(!window.ethereum){ toast("지갑이 없습니다. MetaMask 등을 설치하세요."); return; }
  State.provider = new ethers.BrowserProvider(window.ethereum);
  const net = await State.provider.getNetwork().catch(()=>null);
  if(!net || Number(net.chainId) !== 204){
    // 네트워크 스위치/추가
    try{
      await window.ethereum.request({ method:"wallet_switchEthereumChain", params:[{ chainId: CHAIN.chainIdHex }]});
    }catch(switchErr){
      // 체인 추가 시도
      await window.ethereum.request({ method:"wallet_addEthereumChain", params:[{
        chainId: CHAIN.chainIdHex, chainName: CHAIN.chainName, rpcUrls: CHAIN.rpcUrls,
        nativeCurrency: CHAIN.nativeCurrency, blockExplorerUrls: CHAIN.blockExplorerUrls
      }]});
    }
  }
  await State.provider.send("eth_requestAccounts", []);
  State.signer = await State.provider.getSigner();
  State.wallet = await State.signer.getAddress();
  $("#btn-wallet").textContent = short(State.wallet);

  // 유저 문서에 지갑 저장
  if(State.user){
    await db.collection("users").doc(State.user.uid).set({ wallet: State.wallet },{merge:true});
  }

  // 티어 조회 (컨트랙트 주소가 설정된 경우)
  State.tier = await getTier(State.wallet);
  const pill = $("#tier-pill");
  pill.textContent = `티어: ${State.tier}`;
  pill.classList.remove("hidden");
}
$("#btn-wallet").addEventListener("click", connectWallet);

function short(a){ return a ? a.slice(0,6)+"…"+a.slice(-4) : ""; }

async function getTier(addr){
  try{
    if(!ONCHAIN.TierRegistry.address || ONCHAIN.TierRegistry.address==="0x0000000000000000000000000000000000000000") return 0; // 미설정
    const c = new ethers.Contract(ONCHAIN.TierRegistry.address, ONCHAIN.TierRegistry.abi, State.signer||State.provider);
    const lv = await c.levelOf(addr);
    return Number(lv);
  }catch(e){ console.warn("tier error", e); return 0; }
}

/* ---------- 6) Router ---------- */
function hashRoute(){ return (location.hash||"#/").replace("#/","")||"home"; }
function routeTo(name){ location.hash = name==="home" ? "#/" : `#/${name}`; }
window.addEventListener("hashchange", ()=> renderRoute());
function renderRoute(){
  const r = hashRoute();
  $$(".view").forEach(v=>v.classList.remove("active"));
  if(r==="") return $("#view-home").classList.add("active");
  $("#view-"+r).classList.add("active");
  if(r==="search") doSearch();
  if(r==="agent") renderAgentPipes();
  if(r==="admin") renderAdmin();
}
renderRoute();

/* ---------- 7) Home / Search / Detail ---------- */
$("#home-search").addEventListener("click", ()=>{ $("#search-q").value = $("#home-q").value||""; routeTo("search"); });
$("#search-run").addEventListener("click", ()=> doSearch());

async function refreshHome(){
  // 지역
  const regions = await db.collection("regions").orderBy("name").limit(6).get();
  $("#region-grid").innerHTML = regions.docs.map(doc=>{
    const d = doc.data();
    return cardRegion(d);
  }).join("") || `<div class="small">지역이 없습니다. 운영자/큰언니 콘솔에서 생성하세요.</div>`;

  // 인기 큰언니
  const ag = await db.collection("agents").where("approved","==",true).orderBy("score","desc").limit(6).get().catch(()=>({docs:[]}));
  $("#agent-grid").innerHTML = ag.docs.map(x=> cardAgent(x.data())).join("") || `<div class="small">승인된 큰언니가 없습니다.</div>`;

  // 공지
  const now = new Date();
  const ns = await db.collection("notices")
    .where("startAt","<=", now).where("endAt",">=", now)
    .orderBy("startAt","desc").limit(5).get().catch(()=>({docs:[]}));
  $("#notice-list").innerHTML = ns.docs.map(n=> `<div class="item"><b>${esc(n.data().title)}</b><div class="small">${esc(n.data().body||"")}</div></div>`).join("") || `<div class="small">현재 공지가 없습니다.</div>`;
}

function cardRegion(r){
  return `<div class="card">
    <div class="row spread"><b>${esc(r.name)}</b><span class="badge">${(r.country||"").toUpperCase()}</span></div>
    <div class="small">${esc(r.desc||"")}</div>
  </div>`;
}
function cardAgent(a){
  return `<div class="card">
    <div class="row spread">
      <b>${esc(a.name||"큰언니")}</b>
      <span class="badge">평점 ${Math.round((a.rating||0)*10)/10} · 스코어 ${a.score||0}</span>
    </div>
    <div class="small">${esc(a.bio||"")}</div>
    <div class="kit"><span class="tag">${esc(a.region||"-")}</span>${(a.badges||[]).slice(0,3).map(x=>`<span class="tag">${esc(x)}</span>`).join("")}</div>
  </div>`;
}

async function doSearch(){
  const q = ($("#search-q").value||"").trim().toLowerCase();
  const snap = await db.collection("posts").where("status","==","open").limit(30).get();
  const items = snap.docs.map(d=>({...d.data(), id:d.id}))
    .filter(p => (p.title||"").toLowerCase().includes(q) || (p.body||"").toLowerCase().includes(q) || (p.tags||[]).join(",").toLowerCase().includes(q) || (p.region||"").toLowerCase().includes(q));
  $("#search-grid").innerHTML = items.map(p=> cardPost(p)).join("") || `<div class="small">검색 결과가 없습니다.</div>`;
}

function cardPost(p){
  return `<div class="card">
    <div class="row spread"><b>${esc(p.title)}</b><span class="price">${fmt(p.price||0)} BET</span></div>
    <div class="small">${esc((p.body||"").slice(0,120))}...</div>
    <div class="kit">${(p.tags||[]).slice(0,5).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>
    <div class="row gap" style="margin-top:8px">
      <button class="btn" onclick="openDetail('${p.id}')">자세히</button>
      <button class="btn outline" onclick="openInquiry('${p.id}')">문의</button>
    </div>
  </div>`;
}

async function openDetail(postId){
  const doc = await db.collection("posts").doc(postId).get();
  if(!doc.exists){ toast("존재하지 않는 상품입니다."); return; }
  const p = doc.data();
  $("#detail-wrap").innerHTML = `
    <div class="row spread">
      <h3>${esc(p.title)}</h3>
      <span class="price">${fmt(p.price||0)} BET</span>
    </div>
    <div class="small">${nl2br(esc(p.body||""))}</div>
    <div class="kit">${(p.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>
    <div class="row gap" style="margin-top:10px">
      <button class="btn" onclick="openInquiry('${p.id}')">문의하기</button>
      <button class="btn outline" onclick="bookDirect('${p.id}')">즉시 예약(데모)</button>
    </div>
  `;
  routeTo("detail");
}

window.openInquiry = async function(postId){
  if(!State.user){ toast("먼저 로그인하세요."); return; }
  const post = await db.collection("posts").doc(postId).get();
  if(!post.exists){ toast("상품 없음"); return; }
  const p = post.data();

  const message = prompt(`[${p.title}] 큰언니에게 보낼 문의를 입력하세요:`,"안녕하세요! 일정/가격 문의드립니다.");
  if(!message) return;
  await db.collection("inquiries").add({
    postId, agentId: p.agentId, regionId: p.regionId || null,
    userUid: State.user.uid, message, status:"신규", createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  toast("문의가 접수되었습니다.");
}

/* ---------- 8) Booking (Tier Gate + Escrow book 스텁) ---------- */
window.bookDirect = async function(postId){
  if(!State.user){ toast("먼저 로그인하세요."); return; }
  if(!State.wallet){ await connectWallet(); if(!State.wallet) return; }
  // 티어 체크
  const tier = State.tier || await getTier(State.wallet);
  if(Number(tier) < 1){ toast("온체인 티어 1 이상만 결제가 가능합니다."); return; }

  const pdoc = await db.collection("posts").doc(postId).get();
  if(!pdoc.exists){ toast("상품 없음"); return; }
  const p = pdoc.data();

  // 임시 order 생성
  const orderId = cryptoRandomId();
  const amount = Number(p.price||0);
  const agentWallet = p.agentWallet || (await agentWalletById(p.agentId)) || State.wallet;

  // 온체인 book 호출 (컨트랙트 연결 전까지는 스킵 가능한 데모)
  try{
    if(State.signer && ONCHAIN.TravelEscrow.address !== "0x0000000000000000000000000000000000000000"){
      const c = new ethers.Contract(ONCHAIN.TravelEscrow.address, ONCHAIN.TravelEscrow.abi, State.signer);
      const idBytes = ethers.id("order:"+orderId); // bytes32
      const tx = await c.book(idBytes, ONCHAIN.BET.address, ethers.parseUnits(String(amount), 18), agentWallet);
      await tx.wait();
    }else{
      console.log("Escrow not configured. Skipping chain call for demo.");
    }
  }catch(e){ console.error(e); toast("온체인 결제 실패: " + (e?.shortMessage||e?.message||e)); return; }

  // Firestore에 주문 기록
  await db.collection("orders").doc(orderId).set({
    id: orderId, postId, agentId: p.agentId, userUid: State.user.uid,
    total: amount, token: "BET", status: "예치완료",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  // 바우처(오프체인) 발급 예시
  const vId = "v_"+orderId;
  await db.collection("vouchers").doc(vId).set({
    id: vId, scope:"agent", userUid: State.user.uid, agentId: p.agentId,
    tokenId: "TBA-1155", faceValue: amount, rules: { postId },
    expiry: new Date(Date.now()+1000*60*60*24*30), // 30일
    status: "issued", createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  toast("예약/결제가 완료되었습니다. '마이 > 바우처'에서 QR을 확인하세요.");
  routeTo("my");
  refreshMy();
}

async function agentWalletById(agentId){
  if(!agentId) return null;
  const doc = await db.collection("agents").doc(agentId).get();
  return doc.exists ? (doc.data().wallet || null) : null;
}

/* ---------- 9) My (Orders/Vouchers/Reviews) ---------- */
async function refreshMy(){
  if(!State.user){ $("#my-orders").innerHTML = `<div class="small">로그인 필요</div>`; return; }

  const [orders, vouchers, reviews] = await Promise.all([
    db.collection("orders").where("userUid","==",State.user.uid).orderBy("createdAt","desc").limit(20).get(),
    db.collection("vouchers").where("userUid","==",State.user.uid).orderBy("createdAt","desc").limit(20).get(),
    db.collection("reviews").where("userUid","==",State.user.uid).orderBy("createdAt","desc").limit(20).get().catch(()=>({docs:[]}))
  ]);

  $("#my-orders").innerHTML = orders.docs.map(d=>{
    const o=d.data();
    return `<div class="item">
      <div class="row spread"><b>주문 #${esc(o.id)}</b><span class="badge">${esc(o.status)}</span></div>
      <div class="small">총액 ${fmt(o.total)} BET</div>
      <div class="kit">
        <button class="btn outline" onclick="openReview('${o.id}')">리뷰 작성</button>
      </div>
    </div>`;
  }).join("") || `<div class="small">예약 내역 없음</div>`;

  $("#my-vouchers").innerHTML = vouchers.docs.map(d=>{
    const v=d.data();
    const elId = "qr_"+v.id;
    // 카드 및 QR 자리
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="row spread"><b>바우처 ${esc(v.id)}</b><span class="badge">${esc(v.status||"-")}</span></div>
      <div class="small">유효기간: ${new Date(v.expiry?.toDate?.()||v.expiry).toLocaleDateString()}</div>
      <div id="${elId}" style="padding:8px;background:#fff;border-radius:12px;margin-top:8px"></div>
      <div class="kit"><button class="btn outline" onclick="markRedeemed('${v.id}')">사용완료 표시(데모)</button></div>
    `;
    // QR 생성
    setTimeout(()=>{
      const payload = JSON.stringify({ id:v.id, tokenId:v.tokenId, proof:"DEMO-SIGNATURE" });
      QRCode.toCanvas(document.getElementById(elId), payload, { width:180 }, (err)=>err&&console.error(err));
    }, 0);
    return card.outerHTML;
  }).join("") || `<div class="small">보유 바우처 없음</div>`;

  $("#my-reviews").innerHTML = reviews.docs.map(d=>{
    const r=d.data();
    return `<div class="item"><b>${"★".repeat(r.rating||0)}</b><div class="small">${esc(r.text||"")}</div></div>`;
  }).join("") || `<div class="small">작성한 리뷰 없음</div>`;
}

window.markRedeemed = async function(voucherId){
  const doc = db.collection("vouchers").doc(voucherId);
  await doc.set({ status:"redeemed", redeemedAt: firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
  toast("바우처를 사용 완료로 표시했습니다. (온체인 redeem 연동 지점)");
  refreshMy();
}

window.openReview = async function(orderId){
  const rating = Number(prompt("평점을 입력하세요 (1~5):","5"));
  if(!(rating>=1 && rating<=5)) return;
  const text = prompt("리뷰 내용을 입력하세요:","좋은 서비스였습니다!");
  if(!text) return;
  await db.collection("reviews").add({
    orderId, userUid: State.user.uid, rating, text, createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  toast("리뷰가 등록되었습니다.");
  refreshMy();
}

/* ---------- 10) Agent Console ---------- */
async function refreshAgentState(){
  if(!State.user){ $("#agent-status").textContent="상태: 로그인 필요"; return; }
  const q = await db.collection("agents").where("ownerUid","==",State.user.uid).limit(1).get();
  State.agentDoc = q.docs[0] ? { id:q.docs[0].id, ...q.docs[0].data() } : null;
  $("#agent-status").textContent = "상태: " + (State.agentDoc ? (State.agentDoc.approved?"승인됨":"심사중") : "미가입");
  if(State.agentDoc){
    $("#agent-name").value = State.agentDoc.name||"";
    $("#agent-bio").value = State.agentDoc.bio||"";
    $("#agent-region").value = State.agentDoc.region||"";
    $("#agent-wallet").value = State.agentDoc.wallet||"";
  }else{
    $("#agent-name").value = $("#agent-bio").value = $("#agent-region").value = $("#agent-wallet").value = "";
  }
}

$("#agent-save").addEventListener("click", async ()=>{
  if(!State.user){ toast("로그인이 필요합니다."); return; }
  const payload = {
    ownerUid: State.user.uid,
    name: $("#agent-name").value||"큰언니",
    bio: $("#agent-bio").value||"",
    region: $("#agent-region").value||"",
    wallet: $("#agent-wallet").value||State.wallet||null,
    rating: State.agentDoc?.rating || 5.0,
    score: State.agentDoc?.score || 50,
    kycStatus: State.agentDoc?.kycStatus || "pending",
    approved: State.agentDoc?.approved || false,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  let id = State.agentDoc?.id;
  if(id){
    await db.collection("agents").doc(id).set(payload,{merge:true});
  }else{
    const ref = await db.collection("agents").add(payload);
    id = ref.id;
  }
  toast("큰언니 프로필이 저장되었습니다.");
  await refreshAgentState();
});

$("#agent-apply").addEventListener("click", async ()=>{
  if(!State.user){ toast("로그인이 필요합니다."); return; }
  if(!State.agentDoc){ toast("먼저 프로필을 저장하세요."); return; }
  await db.collection("agents").doc(State.agentDoc.id).set({ approved:false, kycStatus:"review" },{merge:true});
  toast("승인가입 신청이 접수되었습니다.");
  await refreshAgentState();
});

$("#post-create").addEventListener("click", async ()=>{
  if(!State.user || !State.agentDoc){ toast("큰언니 프로필 필요"); return; }
  const title = $("#post-title").value||"";
  const body  = $("#post-body").value||"";
  const price = Number($("#post-price").value||0);
  const tags  = ($("#post-tags").value||"").split(",").map(s=>s.trim()).filter(Boolean);
  if(!title){ toast("제목을 입력하세요."); return; }
  const regionId = await ensureRegion(State.agentDoc.region);
  await db.collection("posts").add({
    agentId: State.agentDoc.id, agentWallet: State.agentDoc.wallet||null,
    regionId, region: State.agentDoc.region||"",
    type:"product", title, body, images:[], price, tags, status:"open",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  toast("상품/포스트가 등록되었습니다.");
});

async function ensureRegion(name){
  if(!name) return null;
  const q = await db.collection("regions").where("name","==",name).limit(1).get();
  if(q.docs[0]) return q.docs[0].id;
  const ref = await db.collection("regions").add({
    name, country:"VN", lang:["ko","en","vi"],
    desc:`${name} 지역 소개`, createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  return ref.id;
}

async function renderAgentPipes(){
  if(!State.user || !State.agentDoc){
    $("#pipe-inquiries").innerHTML = `<div class="small">큰언니 프로필 저장 후 사용 가능합니다.</div>`;
    $("#pipe-orders").innerHTML = `<div class="small">큰언니 프로필 저장 후 사용 가능합니다.</div>`;
    return;
  }
  const [inq, ord] = await Promise.all([
    db.collection("inquiries").where("agentId","==",State.agentDoc.id).orderBy("createdAt","desc").limit(20).get(),
    db.collection("orders").where("agentId","==",State.agentDoc.id).orderBy("createdAt","desc").limit(20).get(),
  ]);
  $("#pipe-inquiries").innerHTML = inq.docs.map(d=>{
    const i=d.data();
    return `<div class="item">
      <div class="row spread"><b>${esc(i.message)}</b><span class="badge">${i.status||"-"}</span></div>
      <div class="kit">
        <button class="btn outline" onclick="sendQuote('${d.id}', ${i.postId?1:0})">견적 제시</button>
      </div>
    </div>`;
  }).join("") || `<div class="small">문의 없음</div>`;

  $("#pipe-orders").innerHTML = ord.docs.map(d=>{
    const o=d.data();
    return `<div class="item">
      <div class="row spread"><b>주문 #${esc(o.id)}</b><span class="badge">${esc(o.status)}</span></div>
      <div class="small">총액 ${fmt(o.total)} BET</div>
      <div class="kit">
        <button class="btn outline" onclick="confirmOrder('${o.id}')">체크아웃/정산(데모)</button>
      </div>
    </div>`;
  }).join("") || `<div class="small">예약 없음</div>`;
}

window.sendQuote = async function(inquiryId){
  const amount = Number(prompt("견적 금액(BET):","100"));
  if(!(amount>0)) return;
  await db.collection("quotes").add({
    inquiryId, agentId: State.agentDoc.id, items:[], total: amount, currency:"BET",
    terms:"기본 약관", expiresAt: new Date(Date.now()+1000*60*60*24*3),
    status:"제출", createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await db.collection("inquiries").doc(inquiryId).set({ status:"견적" },{merge:true});
  toast("견적이 제출되었습니다.");
};

window.confirmOrder = async function(orderId){
  await db.collection("orders").doc(orderId).set({ status:"완료" },{merge:true});
  toast("체크아웃 처리(데모). (온체인 정산/릴리즈 연동 지점)");
  renderAgentPipes();
}

/* ---------- 11) Admin Console ---------- */
async function renderAdmin(){
  // 큰언니 승인 대기
  const q = await db.collection("agents").where("approved","==",false).orderBy("updatedAt","desc").limit(20).get().catch(()=>({docs:[]}));
  $("#admin-agents").innerHTML = q.docs.map(d=>{
    const a=d.data();
    return `<div class="item">
      <div class="row spread"><b>${esc(a.name||"-")} (${esc(a.region||"-")})</b><span class="badge">${esc(a.kycStatus||"-")}</span></div>
      <div class="small">${esc(a.bio||"")}</div>
      <div class="kit">
        <button class="btn" onclick="approveAgent('${d.id}')">승인</button>
        <button class="btn outline" onclick="rejectAgent('${d.id}')">반려</button>
      </div>
    </div>`;
  }).join("") || `<div class="small">대기 중인 큰언니 없음</div>`;

  // 발행된 바우처
  const vs = await db.collection("vouchers").orderBy("createdAt","desc").limit(20).get().catch(()=>({docs:[]}));
  $("#v-issued").innerHTML = vs.docs.map(d=>{
    const v=d.data();
    return `<div class="item">
      <div class="row spread"><b>${esc(v.id)}</b><span class="badge">${esc(v.status||"-")}</span></div>
      <div class="small">scope: ${esc(v.scope||"-")} · face: ${esc(v.faceValue||0)} · expiry: ${new Date(v.expiry?.toDate?.()||v.expiry).toLocaleDateString()}</div>
    </div>`;
  }).join("") || `<div class="small">발행 없음</div>`;

  // 공지 리스트
  const now = new Date();
  const ns = await db.collection("notices").orderBy("startAt","desc").limit(20).get().catch(()=>({docs:[]}));
  $("#n-list").innerHTML = ns.docs.map(d=>{
    const n=d.data();
    return `<div class="item"><b>${esc(n.title)}</b><div class="small">${esc(n.body||"")}</div></div>`;
  }).join("") || `<div class="small">공지 없음</div>`;
}

window.approveAgent = async function(agentId){
  await db.collection("agents").doc(agentId).set({ approved:true, kycStatus:"approved" },{merge:true});
  toast("승인 완료");
  renderAdmin();
}
window.rejectAgent = async function(agentId){
  await db.collection("agents").doc(agentId).set({ approved:false, kycStatus:"rejected" },{merge:true});
  toast("반려 처리");
  renderAdmin();
}

// 바우처 발행(오프체인 문서; 온체인 mint 트리거는 Functions 등에서 확장)
$("#v-issue").addEventListener("click", async ()=>{
  const scope = $("#v-region").value || "global";
  const face  = Number($("#v-face").value||0);
  const exp   = $("#v-exp").value ? new Date($("#v-exp").value) : new Date(Date.now()+1000*60*60*24*30);
  const id = "V" + Math.random().toString(36).slice(2,9);
  await db.collection("vouchers").doc(id).set({
    id, scope, faceValue: face, rules:{}, expiry: exp, supply:1, claimed:0, redeemed:0, status:"issued",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  toast("바우처가 발행되었습니다.");
  renderAdmin();
});

// 공지 발행
$("#n-publish").addEventListener("click", async ()=>{
  const title = $("#n-title").value||"";
  const body  = $("#n-body").value||"";
  if(!title){ toast("제목을 입력하세요."); return; }
  await db.collection("notices").add({
    title, body, pinned:false,
    startAt: new Date(Date.now()-60000),
    endAt: new Date(Date.now()+1000*60*60*24*7),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  $("#n-title").value = $("#n-body").value = "";
  toast("공지 발행됨");
  renderAdmin();
});

/* ---------- 12) Demo Seed / Purge ---------- */
$("#seed-demo").addEventListener("click", async ()=>{
  await db.collection("regions").add({ name:"다낭", country:"VN", lang:["ko","en","vi"], desc:"해양/미식/액티비티 허브", createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  await db.collection("regions").add({ name:"동호이", country:"VN", lang:["ko","en","vi"], desc:"동굴/자연/로컬", createdAt: firebase.firestore.FieldValue.serverTimestamp() });

  const agentRef = await db.collection("agents").add({
    ownerUid: State.user?.uid || "demo",
    name:"KE 다낭팀", bio:"공항픽업/투어/생활지원", region:"다낭", wallet:null,
    rating:4.9, score:88, badges:["행정지원","교통지원"], kycStatus:"approved", approved:true,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await db.collection("posts").add({
    agentId: agentRef.id, region:"다낭", regionId: null,
    type:"product", title:"다낭 시내 투어 (4h)", body:"전용차량+가이드 포함. 일정 커스텀 가능.", price:120, tags:["다낭","투어","교통"], status:"open",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await db.collection("notices").add({
    title:"파일럿 운영 중", body:"문의/예약은 데모 흐름을 통해 시험해보세요.",
    startAt:new Date(Date.now()-3600_000), endAt:new Date(Date.now()+3600_000*24*30),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  toast("데모 데이터가 시드되었습니다.");
  refreshHome();
});

$("#purge-demo").addEventListener("click", async ()=>{
  const colls = ["regions","agents","posts","inquiries","quotes","orders","vouchers","reviews","notices"];
  for(const c of colls){
    const qs = await db.collection(c).limit(50).get();
    const batch = db.batch();
    qs.forEach(d=> batch.delete(d.ref));
    await batch.commit();
  }
  toast("데모 데이터가 삭제되었습니다.");
  refreshHome(); refreshMy(); renderAdmin(); renderAgentPipes();
});

/* ---------- 13) Small Utils ---------- */
function esc(s){ return (s||"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m])); }
function nl2br(s){ return (s||"").replace(/\n/g,"<br/>"); }
function cryptoRandomId(){ return Math.random().toString(36).slice(2) + Date.now().toString(36); }

/* ---------- 14) Nav link handling ---------- */
$$("a[data-link]").forEach(a=>a.addEventListener("click",(e)=>{
  e.preventDefault();
  const href = a.getAttribute("href");
  location.hash = href.replace("#/","#/") || "#/";
}));

/* First draw */
refreshHome();
