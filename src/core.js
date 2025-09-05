// core.js — 공통 헬퍼, Firebase 초기화, 전역 상태, 라우터, 로그인/지갑
(function () {
  /* ---- 0. Config & Guard ---- */
  if (!window.AppConfig) {
    alert("config.js가 먼저 로드되어야 합니다.");
    throw new Error("Missing AppConfig");
  }
  const { FIREBASE_CONFIG, CHAIN, ONCHAIN } = window.AppConfig;

  /* ---- 1. Helpers ---- */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const toast = (m) => alert(m);
  const fmt = (n) => new Intl.NumberFormat("ko-KR").format(n);
  const esc = (s) => (s || "").replace(/[&<>\"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m]));
  const nl2br = (s) => (s || "").replace(/\n/g, "<br/>");
  const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
  const cryptoRandomId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

  /* ---- 2. Firebase Init ---- */
  firebase.initializeApp(FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const storage = firebase.storage();

  /* ---- 3. Global State ---- */
  const State = { user:null, wallet:null, tier:0, agentDoc:null, provider:null, signer:null };


  /* ---- 3.1 Admin Gate ---- */
const ADMIN_EMAILS = new Set(["daguri75@gmail.com"]); // 운영자 화이트리스트
State.isAdmin = false;

async function computeAdmin(u){
  if(!u) return false;

  // 1) 이메일 화이트리스트
  const email = (u.email||"").toLowerCase();
  if (ADMIN_EMAILS.has(email)) return true;

  // 2) users/{uid}.role === 'admin'
  try {
    const ud = await db.collection('users').doc(u.uid).get();
    if (ud?.exists && String((ud.data().role||"").toLowerCase()) === 'admin') return true;
  } catch(e) {}

  // 3) 커스텀 클레임 admin:true
  try {
    const tok = await u.getIdTokenResult(true);
    if (tok?.claims?.admin === true) return true;
  } catch(e) {}

  return false;
}

function isAdminUser(){ return !!State.isAdmin; }
function guardAdmin(){
  if (!isAdminUser()){
    toast("운영자만 접근 가능합니다.");
    routeTo("home");
    return false;
  }
  return true;
}

  /* ---- 4. Router ---- */
  function hashRoute(){ return (location.hash || "#/").replace("#/","") || "home"; }
  function routeTo(name){ location.hash = name === "home" ? "#/" : `#/${name}`; }
 function renderRoute(){
  const r = hashRoute();

  // 🔒 admin 라우트 가드
  if (r === 'admin' && !isAdminUser()) {
    toast('운영자만 접근 가능합니다.');
    routeTo('home');
    return;
  }

  $$(".view").forEach(v=>v.classList.remove("active"));
  $("#view-"+r)?.classList.add("active");

  // (옵션) 라우트 이벤트 유지
  window.dispatchEvent(new CustomEvent("app:route", { detail:{ route:r } }));
}

  window.addEventListener("hashchange", renderRoute);

  /* ---- 5. Auth (중복 팝업 가드 + 리다이렉트 폴백) ---- */
  let loginJob = null;
  $("#btn-google") && ($("#btn-google").onclick = async () => {
    if (loginJob) return;
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      $("#btn-google").disabled = true;
      loginJob = auth.signInWithPopup(provider);
      const res = await loginJob;
      const u = res.user;
      await db.collection("users").doc(u.uid).set({
        uid:u.uid, email:u.email||null, displayName:u.displayName||null, photo:u.photoURL||null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge:true });
    } catch (e) {
      if (e.code === "auth/cancelled-popup-request") return;
      if (e.code === "auth/popup-blocked") { await auth.signInWithRedirect(provider); return; }
      console.error(e); toast("로그인 실패: " + (e.code||"") + " " + (e.message||""));
    } finally {
      $("#btn-google").disabled = false;
      loginJob = null;
    }
  });
  $("#btn-logout") && ($("#btn-logout").onclick = () => auth.signOut());

  auth.getRedirectResult().then((res)=>{
    if (res?.user) {
      const u = res.user;
      return db.collection("users").doc(u.uid).set({
        uid:u.uid, email:u.email||null, displayName:u.displayName||null, photo:u.photoURL||null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge:true });
    }
  }).catch(err=>console.warn("redirect result:", err?.code||err?.message));

  auth.onAuthStateChanged(async (u)=>{
    State.user = u || null;
    // 🔒 Admin 계산 & 운영자 전용 메뉴 토글
State.isAdmin = await computeAdmin(u);
document.querySelectorAll('[data-admin-only]').forEach(el => el.classList.toggle('hidden', !State.isAdmin));

    $("#btn-google")?.classList.toggle("hidden", !!u);
    $("#btn-logout")?.classList.toggle("hidden", !u);
    $("#user-photo")?.classList.toggle("hidden", !u);
    if (u?.photoURL) $("#user-photo").src = u.photoURL;
    window.dispatchEvent(new CustomEvent("app:auth", { detail:{ user:u } }));
    if (location.hash === "" || location.hash === "#/") routeTo("home");
    renderRoute();
  });

  /* ---- 6. Wallet / Tier ---- */
  async function connectWallet(){
    if(!window.ethereum){ toast("지갑이 없습니다. MetaMask 등을 설치하세요."); return; }
    State.provider = new ethers.BrowserProvider(window.ethereum);
    const net = await State.provider.getNetwork().catch(()=>null);
    if(!net || Number(net.chainId)!==204){
      try{
        await window.ethereum.request({ method:"wallet_switchEthereumChain", params:[{ chainId: CHAIN.chainIdHex }]});
      }catch(e){
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
    if(State.user) await db.collection("users").doc(State.user.uid).set({ wallet: State.wallet }, { merge:true });
    State.tier = await getTier(State.wallet);
    const pill = $("#tier-pill");
    if (pill){ pill.textContent = `티어: ${State.tier}`; pill.classList.remove("hidden"); }
  }
  $("#btn-wallet") && ($("#btn-wallet").onclick = connectWallet);

  async function getTier(addr){
    try{
      if(!ONCHAIN.TierRegistry.address || ONCHAIN.TierRegistry.address==="0x0000000000000000000000000000000000000000") return 0;
      const c = new ethers.Contract(ONCHAIN.TierRegistry.address, ONCHAIN.TierRegistry.abi, State.signer||State.provider);
      const lv = await c.levelOf(addr);
      return Number(lv);
    }catch(e){ console.warn("tier error", e); return 0; }
  }

  /* ---- 7. Nav link ---- */
  $$("a[data-link]").forEach(a=>a.addEventListener("click",(e)=>{
    e.preventDefault();
    const href = a.getAttribute("href");
    location.hash = href?.replace("#/","#/") || "#/";
  }));

  /* ---- 8. Expose App namespace ---- */
  window.App = {
    
    // config
    FIREBASE_CONFIG, CHAIN, ONCHAIN, AppConfig: window.AppConfig,
    // libs
    firebase, auth, db, storage, ethers,
    // state & helpers
    State, $, $$, toast, fmt, esc, nl2br, short, cryptoRandomId,
    // router & chain
    routeTo, hashRoute, renderRoute, connectWallet, getTier,
  };
  // core.js 마지막 줄 근처
window.dispatchEvent(new CustomEvent("app:ready"));
window.App.guardAdmin = guardAdmin;
window.App.isAdminUser = isAdminUser;

  renderRoute();
})();
