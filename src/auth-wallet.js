import { $, toast, auth, db, State, CHAIN, ONCHAIN, short } from './utils.js';

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

  // These functions will be defined in features.js, so we'll need to import them or call them from there.
  // For now, I'll comment them out and address them when creating features.js
  // await refreshAgentState();
  // if(location.hash === "" || location.hash === "#/"){ routeTo("home"); }
  // refreshHome();
  // refreshMy();
  // if(hashRoute()==="agent") renderAgentPipes();
  // if(hashRoute()==="admin") renderAdmin();
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

export { connectWallet, getTier };