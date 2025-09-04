/* ============================================================
 * NomadLocal MVP — Single JS (수정본)
 * - Fix: $/$$ 중복, firebase 오타, 공지 2중 range, 배열/선택자, esc 맵, 인덱스 폴백
 * ============================================================ */

/* ---------- 0) Helpers ---------- */
function getTS(x){
  if (!x) return 0;
  if (typeof x.toMillis === 'function') return x.toMillis();
  if (x instanceof Date) return x.getTime();
  if (typeof x === 'number') return x;
  return 0;
}

const $  = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => Array.from(el.querySelectorAll(s));
const toast = (m) => alert(m);
const fmt = (n) => new Intl.NumberFormat('ko-KR').format(n);
function esc(s){
  return (s||"").replace(/[&<>'"`]/g, m=>({
    "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;","`":"&#96;"
  }[m]));
}
function nl2br(s){ return (s||"").replace(/\n/g,"<br/>"); }
function cryptoRandomId(){ return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function short(a){ return a ? a.slice(0,6)+"…"+a.slice(-4) : ""; }

/* ---------- 1) Config ---------- */
// ★ 실제 프로젝트 설정
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCoeMQt7UZzNHFt22bnGv_-6g15BnwCEBA",
  authDomain: "puppi-d67a1.firebaseapp.com",
  projectId: "puppi-d67a1",
  storageBucket: "puppi-d67a1.appspot.com",
  messagingSenderId: "552900371836",
  appId: "1:552900371836:web:88fb6c6a7d3ca3c84530f9",
  measurementId: "G-9TZ81RW0PL"
};

const CHAIN = {
  chainIdHex: "0xCC", // 204
  chainName: "opBNB Mainnet",
  rpcUrls: ["https://opbnb-mainnet-rpc.bnbchain.org"],
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  blockExplorerUrls: ["https://opbnbscan.com/"]
};

// 온체인 주소/ABI 스텁 (연결 시 교체)
const ONCHAIN = {
  TierRegistry: {
    address: "0x0000000000000000000000000000000000000000",
    abi: [{ "inputs":[{"internalType":"address","name":"user","type":"address"}],
            "name":"levelOf","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],
            "stateMutability":"view","type":"function"}]
  },
  TravelEscrow: {
    address: "0x0000000000000000000000000000000000000000",
    abi: [
      {"anonymous":false,"inputs":[{"indexed":false,"internalType":"bytes32","name":"orderId","type":"bytes32"},{"indexed":false,"internalType":"address","name":"payer","type":"address"},{"indexed":false,"internalType":"address","name":"agent","type":"address"},{"indexed":false,"internalType":"address","name":"token","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"Book","type":"event"},
      {"inputs":[{"internalType":"bytes32","name":"orderId","type":"bytes32"},{"internalType":"address","name":"token","type":"address"},{"internalType":"uint256","name":"amount","type":"uint256"},{"internalType":"address","name":"agent","type":"address"}],"name":"book","outputs":[],"stateMutability":"nonpayable","type":"function"}
    ]
  },
  BET: { address: "0x0000000000000000000000000000000000000000" }
};

/* ---------- 2) Firebase Init ---------- */
firebase.initializeApp(FIREBASE_CONFIG); // ← 오타 수정(febase→firebase)
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

/* ---------- 3) State ---------- */
const State = {
  user: null,
  wallet: null,
  tier: 0,
  agentDoc: null,
  provider: null, signer: null,
};

/* ---------- 4) Auth ---------- */
$("#btn-google")?.addEventListener("click", async ()=>{
  try{
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const res = await auth.signInWithPopup(provider);
    const u = res.user;
    await db.collection("users").doc(u.uid).set({
      uid: u.uid,
      email: u.email || null,
      displayName: u.displayName || null,
      photo: u.photoURL || null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge:true });
  }catch(e){ console.error(e); if(e.code!=='auth/cancelled-popup-request') toast("로그인 실패: " + (e.message||e.code)); }
});
$("#btn-logout")?.addEventListener("click", ()=> auth.signOut());

auth.onAuthStateChanged(async (u)=>{
  State.user = u || null;
  $("#btn-google")?.classList.toggle("hidden", !!u);
  $("#btn-logout")?.classList.toggle("hidden", !u);
  $("#user-photo")?.classList.toggle("hidden", !u);
  if(u?.photoURL){ $("#user-photo").src = u.photoURL; }

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
    try{
      await window.ethereum.request({ method:"wallet_switchEthereumChain", params:[{ chainId: CHAIN.chainIdHex }]});
    }catch(switchErr){
      await window.ethereum.request({ method:"wallet_addEthereumChain", params:[{
        chainId: CHAIN.chainIdHex, chainName: CHAIN.chainName, rpcUrls: CHAIN.rpcUrls,
        nativeCurrency: CHAIN.nativeCurrency, blockExplorerUrls: CHAIN.blockExplorerUrls
      }]});
    }
  }
  await State.provider.send("eth_requestAccounts", []);
  State.signer = await State.provider.getSigner();
  State.wallet = await State.signer.getAddress();
  $("#btn-wallet") && ($("#btn-wallet").textContent = short(State.wallet));

  if(State.user){
    await db.collection("users").doc(State.user.uid).set({ wallet: State.wallet },{merge:true});
  }

  State.tier = await getTier(State.wallet);
  const pill = $("#tier-pill");
  if(pill){ pill.textContent = `티어: ${State.tier}`; pill.classList.remove("hidden"); }
}
$("#btn-wallet")?.addEventListener("click", connectWallet);

async function getTier(addr){
  try{
    if(!ONCHAIN.TierRegistry.address || ONCHAIN.TierRegistry.address==="0x0000000000000000000000000000000000000000") return 0;
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
  $$(".view").forEach(v=>v.classList.remove("active")); // ← $$ 로 수정
  if(r==="") { $("#view-home")?.classList.add("active"); return; }
  $("#view-"+r)?.classList.add("active");
  if(r==="search") doSearch();
  if(r==="agent") renderAgentPipes();
  if(r==="admin") renderAdmin();
}
renderRoute();

/* ---------- 7) Home / Search / Detail ---------- */
$("#home-search")?.addEventListener("click", ()=>{
  const q = $("#home-q")?.value || "";
  const target = $("#search-q"); if (target) target.value = q;
  routeTo("search");
});
$("#search-run")?.addEventListener("click", ()=> doSearch());

async function refreshHome(){
  // 지역
  const regions = await db.collection("regions").orderBy("name").limit(6).get().catch(()=>({docs:[]}));
  $("#region-grid").innerHTML = regions.docs.map(doc=> cardRegion(doc.data())).join("")
    || `<div class="small">지역이 없습니다. 운영자/큰언니 콘솔에서 생성하세요.</div>`;

  // 인기 큰언니 (인덱스 필요할 수 있음 → 실패 시 폴백: 승인만 필터)
  let agDocs = [];
  try{
    const ag = await db.collection("agents").where("approved","==",true).orderBy("score","desc").limit(6).get();
    agDocs = ag.docs;
  }catch(_){
    const ag = await db.collection("agents").where("approved","==",true).limit(6).get().catch(()=>({docs:[]}));
    agDocs = ag.docs;
  }
  $("#agent-grid").innerHTML = agDocs.map(x=> cardAgent(x.data())).join("") || `<div class="small">승인된 큰언니가 없습니다.</div>`;

  // 공지: startAt <= now 만 서버에서, endAt는 클라 필터 (다중 range 회피)
  const now = new Date();
  let nsDocs = [];
  try{
    const ns = await db.collection("notices").where("startAt","<=", now).orderBy("startAt","desc").limit(20).get();
    nsDocs = ns.docs.filter(d=>{
      const n = d.data();
      const end = n.endAt?.toDate?.() || n.endAt;
      return !end || end >= now;
    });
  }catch(_){
    const ns = await db.collection("notices").orderBy("startAt","desc").limit(10).get().catch(()=>({docs:[]}));
    nsDocs = ns.docs;
  }
  $("#notice-list").innerHTML =
    nsDocs.map(n=> `<div class="item"><b>${esc(n.data().title)}</b><div class="small">${esc(n.data().body||"")}</div></div>`).join("")
    || `<div class="small">현재 공지가 없습니다.</div>`;
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
  const q = ($("#search-q")?.value||"").trim().toLowerCase();
  const snap = await db.collection("posts").where("status","==","open").limit(50).get().catch(()=>({docs:[]}));
  const items = snap.docs.map(d=>({...d.data(), id:d.id}))
    .filter(p => (p.title||"").toLowerCase().includes(q)
      || (p.body||"").toLowerCase().includes(q)
      || (p.tags||[]).join(",").toLowerCase().includes(q)
      || (p.region||"").toLowerCase().includes(q));
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
};

/* ---------- 8) Booking (Tier Gate + Escrow book 스텁) ---------- */
window.bookDirect = async function(postId){
  if(!State.user){ toast("먼저 로그인하세요."); return; }
  if(!State.wallet){ await connectWallet(); if(!State.wallet) return; }
  const tier = State.tier || await getTier(State.wallet);
  if(Number(tier) < 1){ toast("온체인 티어 1 이상만 결제가 가능합니다."); return; }

  const pdoc = await db.collection("posts").doc(postId).get();
  if(!pdoc.exists){ toast("상품 없음"); return; }
  const p = pdoc.data();

  const orderId = cryptoRandomId();
  const amount = Number(p.price||0);
  const agentWallet = p.agentWallet || (await agentWalletById(p.agentId)) || State.wallet;

  try{
    if(State.signer && ONCHAIN.TravelEscrow.address !== "0x0000000000000000000000000000000000000000"){
      const c = new ethers.Contract(ONCHAIN.TravelEscrow.address, ONCHAIN.TravelEscrow.abi, State.signer);
      const idBytes = ethers.id("order:"+orderId); // bytes32
      const tokenAddr = ONCHAIN.BET?.address || ethers.ZeroAddress;
      const tx = await c.book(idBytes, tokenAddr, ethers.parseUnits(String(amount), 18), agentWallet);
      await tx.wait();
    }else{
      console.log("Escrow not configured. Skipping chain call for demo.");
    }
  }catch(e){ console.error(e); toast("온체인 결제 실패: " + (e?.shortMessage||e?.message||e)); return; }

  await db.collection("orders").doc(orderId).set({
    id: orderId, postId, agentId: p.agentId, userUid: State.user.uid,
    total: amount, token: "BET", status: "예치완료",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  const vId = "v_"+orderId;
  await db.collection("vouchers").doc(vId).set({
    id: vId, scope:"agent", userUid: State.user.uid, agentId: p.agentId,
    tokenId: "TBA-1155", faceValue: amount, rules: { postId },
    expiry: new Date(Date.now()+1000*60*60*24*30),
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

  // Orders: 인덱스가 없으면 로컬 정렬 폴백
  let ordersArr = [];
  try{
    const snap = await db.collection("orders")
      .where("userUid","==",State.user.uid)
      .orderBy("createdAt","desc").limit(20).get();
    ordersArr = snap.docs.map(d=>({id:d.id, ...d.data()}));
  }catch(e){
    const snap = await db.collection("orders").where("userUid","==",State.user.uid).limit(60).get();
    ordersArr = snap.docs.map(d=>({id:d.id, ...d.data()}));
    ordersArr.sort((a,b)=> getTS(b.createdAt) - getTS(a.createdAt));
    ordersArr = ordersArr.slice(0,20);
    console.warn('orders: local sort fallback (no composite index)');
  }

  // Vouchers: 동일
  let vouchersArr = [];
  try{
    const snap = await db.collection("vouchers")
      .where("userUid","==",State.user.uid)
      .orderBy("createdAt","desc").limit(20).get();
    vouchersArr = snap.docs.map(d=>({id:d.id, ...d.data()}));
  }catch(e){
    const snap = await db.collection("vouchers").where("userUid","==",State.user.uid).limit(60).get();
    vouchersArr = snap.docs.map(d=>({id:d.id, ...d.data()}));
    vouchersArr.sort((a,b)=> getTS(b.createdAt) - getTS(a.createdAt));
    vouchersArr = vouchersArr.slice(0,20);
    console.warn('vouchers: local sort fallback (no composite index)');
  }

  const reviewsSnap = await db.collection("reviews")
    .where("userUid","==",State.user.uid)
    .orderBy("createdAt","desc").limit(20).get().catch(()=>({docs:[]}));
  const reviewsArr = reviewsSnap.docs.map(d=>({id:d.id, ...d.data()}));

  $("#my-orders").innerHTML = ordersArr.map(o=>`
    <div class="item">
      <div class="row spread"><b>주문 #${esc(o.id)}</b><span class="badge">${esc(o.status||"-")}</span></div>
      <div class="small">총액 ${fmt(o.total||0)} BET</div>
      <div class="kit"><button class="btn outline" onclick="openReview('${o.id}')">리뷰 작성</button></div>
    </div>`).join("") || `<div class="small">예약 내역 없음</div>`;

  $("#my-vouchers").innerHTML = vouchersArr.map(v=>{
    const elId = "qr_"+v.id;
    const expiry = v.expiry?.toDate?.() || v.expiry;
    const html = `
      <div class="card">
        <div class="row spread"><b>바우처 ${esc(v.id)}</b><span class="badge">${esc(v.status||"-")}</span></div>
        <div class="small">유효기간: ${expiry ? new Date(expiry).toLocaleDateString() : "-"}</div>
        <div id="${elId}" style="padding:8px;background:#fff;border-radius:12px;margin-top:8px"></div>
        <div class="kit"><button class="btn outline" onclick="markRedeemed('${v.id}')">사용완료 표시(데모)</button></div>
      </div>`;
    setTimeout(()=>{
      const payload = JSON.stringify({ id:v.id, tokenId:v.tokenId, proof:"DEMO-SIGNATURE" });
      QRCode.toCanvas(document.getElementById(elId), payload, { width:180 }, (err)=>err&&console.error(err));
    },0);
    return html;
  }).join("") || `<div class="small">보유 바우처 없음</div>`;

  $("#my-reviews").innerHTML = reviewsArr.map(r=>`
    <div class="item"><b>${"★".repeat(r.rating||0)}</b><div class="small">${esc(r.text||"")}</div></div>`
  ).join("") || `<div class="small">작성한 리뷰 없음</div>`;
}

window.markRedeemed = async function(voucherId){
  const doc = db.collection("vouchers").doc(voucherId);
  await doc.set({ status:"redeemed", redeemedAt: firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
  toast("바우처를 사용 완료로 표시했습니다. (온체인 redeem 연동 지점)");
  refreshMy();
};

window.openReview = async function(orderId){
  const rating = Number(prompt("평점을 입력하세요 (1~5):","5"));
  if(!(rating>=1 && rating<=5)) return;
  const text = prompt("리뷰 내용을 입력하세요:","좋은 서비스였습니다!");
  if(!text) return;
  await db.collection("reviews").add({
    orderId, userUid: State.user.uid, rating, text,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  toast("리뷰가 등록되었습니다.");
  refreshMy();
};

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

$("#agent-save")?.addEventListener("click", async ()=>{
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

$("#agent-apply")?.addEventListener("click", async ()=>{
  if(!State.user){ toast("로그인이 필요합니다."); return; }
  if(!State.agentDoc){ toast("먼저 프로필을 저장하세요."); return; }
  await db.collection("agents").doc(State.agentDoc.id).set({
    approved:false, kycStatus:"review",
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  },{merge:true});
  toast("승인가입 신청이 접수되었습니다.");
  await refreshAgentState();
});

$("#post-create")?.addEventListener("click", async ()=>{
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
    db.collection("inquiries").where("agentId","==",State.agentDoc.id).orderBy("createdAt","desc").limit(20).get().catch(async e=>{
      const qs = await db.collection("inquiries").where("agentId","==",State.agentDoc.id).limit(60).get();
      return { docs: qs.docs.sort((a,b)=>getTS(b.data().createdAt)-getTS(a.data().createdAt)).slice(0,20) };
    }),
    db.collection("orders").where("agentId","==",State.agentDoc.id).orderBy("createdAt","desc").limit(20).get().catch(async e=>{
      const qs = await db.collection("orders").where("agentId","==",State.agentDoc.id).limit(60).get();
      return { docs: qs.docs.sort((a,b)=>getTS(b.data().createdAt)-getTS(a.data().createdAt)).slice(0,20) };
    }),
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
};

/* ---------- 11) Admin Console ---------- */
async function renderAdmin(){
  const MAX = 50;

  // A. approved == false
  let listA = [];
  try {
    const q = await db.collection("agents")
      .where("approved","==",false)
      .orderBy("updatedAt","desc")
      .limit(MAX).get();
    listA = q.docs;
  } catch (e) {
    const q = await db.collection("agents")
      .where("approved","==",false)
      .limit(MAX).get();
    listA = q.docs.sort((a,b)=> getTS(b.data().updatedAt)-getTS(a.data().updatedAt));
    console.warn("agents(approved=false) local-sort fallback:", e?.message||e);
  }

  // B. kycStatus == "review"
  let listB = [];
  try {
    const q2 = await db.collection("agents")
      .where("kycStatus","==","review")
      .orderBy("updatedAt","desc")
      .limit(MAX).get();
    listB = q2.docs;
  } catch (e) {
    const q2 = await db.collection("agents")
      .where("kycStatus","==","review")
      .limit(MAX).get();
    listB = q2.docs.sort((a,b)=> getTS(b.data().updatedAt)-getTS(a.data().updatedAt));
    console.warn("agents(kycStatus=review) local-sort fallback:", e?.message||e);
  }

  const uniq = new Map();
  [...listA, ...listB].forEach(d => uniq.set(d.id, d));
  const docs = [...uniq.values()];

  $("#admin-agents") && ($("#admin-agents").innerHTML =
    docs.map(d=>{
      const a = d.data();
      return `<div class="item">
        <div class="row spread"><b>${esc(a.name||"-")} (${esc(a.region||"-")})</b>
          <span class="badge">${esc(a.kycStatus||"-")}</span></div>
        <div class="small">${esc(a.bio||"")}</div>
        <div class="kit">
          <button class="btn" onclick="approveAgent('${d.id}')">승인</button>
          <button class="btn outline" onclick="rejectAgent('${d.id}')">반려</button>
        </div>
      </div>`;
    }).join("") || `<div class="small">대기 중인 큰언니 없음</div>`
  );

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
};
window.rejectAgent = async function(agentId){
  await db.collection("agents").doc(agentId).set({ approved:false, kycStatus:"rejected" },{merge:true});
  toast("반려 처리");
  renderAdmin();
};

// 바우처 발행
$("#v-issue")?.addEventListener("click", async ()=>{
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
$("#n-publish")?.addEventListener("click", async ()=>{
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
$("#seed-demo")?.addEventListener("click", async ()=>{
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

$("#purge-demo")?.addEventListener("click", async ()=>{
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

/* ---------- 13) Nav link handling ---------- */
$$("a[data-link]").forEach(a=>a.addEventListener("click",(e)=>{
  e.preventDefault();
  const href = a.getAttribute("href");
  location.hash = href?.replace("#/","#/") || "#/";
}));

/* First draw */
refreshHome();
