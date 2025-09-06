/* auth-wallet.js — 구글 로그인/로그아웃 + 지갑 연결 + 티어 계산 (IIFE 전역 App.*) */
(function(){
  'use strict';

  const App   = window.App = window.App || {};
  const State = App.State  = App.State || {};
  const toast = App.toast || (m=>alert(m));

  // Firebase 핸들: 아직 초기화 전이면 null로 두고, 실제 사용 시점에만 접근
  function getAuth(){
    if (App.auth) return App.auth;
    if (window.firebase?.apps?.length) return firebase.auth();
    return null;
  }
  function getDB(){
    if (App.db) return App.db;
    if (window.firebase?.apps?.length) return firebase.firestore();
    return null;
  }

  const CONFIG  = App.CONFIG  || window.CONFIG  || {};
  const CHAIN   = App.CHAIN   || window.CHAIN   || { chainId: 1, rpcUrl: null, network: 'Ethereum' };
  const ONCHAIN = App.ONCHAIN || window.ONCHAIN || {};

  function getEthers(){
    const e = window.ethers;
    if(!e) throw new Error('ethers UMD가 로드되지 않았습니다.');
    return e;
  }

  function setTierPill(tier){
    State.tier = tier;
    const el = document.getElementById('tier-pill');
    if(!el) return;
    if(tier && tier>0){ el.textContent = `티어: ${tier}`; el.classList.remove('hidden'); }
    else { el.textContent = '티어: -'; el.classList.add('hidden'); }
  }

  async function computeIsAdmin(user){
    const db = getDB();
    if(!user) return false;
    try{
      const tok = await user.getIdTokenResult();
      if(tok?.claims?.admin === true) return true;
    }catch(_){}
    if(!db) return false;
    try{
      const u = await db.collection('users').doc(user.uid).get();
      return !!(u.exists && u.data()?.role === 'admin');
    }catch(_){ return false; }
  }

  /* ===== Google 로그인 ===== */
  async function loginGoogle(){
    const auth = getAuth();
    const db   = getDB();
    if(!auth){ toast('Auth 미초기화'); return; }
    const provider = new firebase.auth.GoogleAuthProvider();
    try{
      const { user } = await auth.signInWithPopup(provider);
      if(!user) return;

      if (db){
        await db.collection('users').doc(user.uid).set({
          uid: user.uid,
          email: user.email || null,
          displayName: user.displayName || null,
          photoURL: user.photoURL || null,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge:true });
      }

      State.user = user;
      State.isAdmin = await computeIsAdmin(user);

      document.querySelectorAll('[data-admin-only]').forEach(el=> el.classList.toggle('hidden', !State.isAdmin));
      document.getElementById('btn-google')?.classList.add('hidden');
      document.getElementById('btn-logout')?.classList.remove('hidden');
      const up = document.getElementById('user-photo');
      if (up && user.photoURL){ up.src = user.photoURL; up.classList.remove('hidden'); }

      toast('로그인되었습니다.');

      if (typeof App.refreshHome === 'function') App.refreshHome();
      if (typeof App.refreshMy === 'function') App.refreshMy();
      if (typeof App.refreshAgentState === 'function') App.refreshAgentState();
    }catch(e){
      console.error(e);
      toast('로그인 실패: ' + (e?.message || e));
    }
  }

  /* ===== 로그아웃 ===== */
  async function logout(){
    const auth = getAuth();
    if(!auth) return;
    try{
      await auth.signOut();
      State.user = null;
      State.isAdmin = false;
      setTierPill(0);
      document.querySelectorAll('[data-admin-only]').forEach(el=> el.classList.add('hidden'));
      document.getElementById('btn-google')?.classList.remove('hidden');
      document.getElementById('btn-logout')?.classList.add('hidden');
      document.getElementById('user-photo')?.classList.add('hidden');
      const btn = document.getElementById('btn-wallet'); if(btn) btn.textContent = '지갑 연결';
      toast('로그아웃 되었습니다.');
    }catch(e){
      console.error(e);
      toast('로그아웃 실패: ' + (e?.message || e));
    }
  }

  /* ===== 지갑 연결 ===== */
  async function connectWallet(){
    if(!window.ethereum){
      toast('메타마스크(또는 호환 지갑)를 설치해 주세요.');
      return;
    }
    try{
      const accounts = await window.ethereum.request({ method:'eth_requestAccounts' });
      const wallet = accounts?.[0] || null;
      if(!wallet){ toast('지갑 연결 취소'); return; }

      const targetIdHex = '0x' + Number(CHAIN.chainId||0).toString(16);
      try{
        const cur = await window.ethereum.request({ method:'eth_chainId' });
        if ((cur||'').toLowerCase() !== targetIdHex.toLowerCase()){
          await window.ethereum.request({ method:'wallet_switchEthereumChain', params:[{ chainId: targetIdHex }] });
        }
      }catch(switchErr){
        try{
          await window.ethereum.request({
            method:'wallet_addEthereumChain',
            params:[{
              chainId: targetIdHex,
              chainName: CHAIN.network || 'Custom',
              rpcUrls: [CHAIN.rpcUrl].filter(Boolean),
              nativeCurrency: { name:'ETH', symbol:'ETH', decimals:18 }
            }]
          });
        }catch(addErr){ console.warn(addErr); }
      }

      const { ethers } = getEthers();
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      State.wallet = wallet;
      State.signer = signer;

      const btn = document.getElementById('btn-wallet');
      if (btn) btn.textContent = `연결됨: ${wallet.slice(0,6)}…${wallet.slice(-4)}`;

      try{
        const t = await getTier(wallet);
        setTierPill(t);
      }catch(e){ console.warn('티어 계산 실패(무시):', e); }

      toast('지갑이 연결되었습니다.');
    }catch(e){
      if (e?.code === 4900){
        toast('지갑이 체인에 연결되지 않았습니다. 메타마스크에서 네트워크를 선택한 뒤 다시 시도하세요.');
      }else{
        console.error(e);
        toast('지갑 연결 실패: ' + (e?.message || e));
      }
    }
  }

  /* ===== 티어 계산 ===== */
  async function getTier(walletAddr){
    if (!walletAddr) return 0;
    const betAddr = ONCHAIN?.BET?.address;
    if (!betAddr) return 1; // 온체인 미구성 데모

    const { ethers } = getEthers();
    let provider = null;
    if (window.ethereum){
      try{ provider = new ethers.BrowserProvider(window.ethereum); }catch(_){}
    }
    if (!provider && (App.CHAIN?.rpcUrl || CHAIN.rpcUrl)){
      provider = new ethers.JsonRpcProvider(App.CHAIN?.rpcUrl || CHAIN.rpcUrl);
    }
    if (!provider) return 0;

    const ERC20_ABI = [
      'function balanceOf(address) view returns (uint256)',
      'function decimals() view returns (uint8)'
    ];
    const erc = new ethers.Contract(betAddr, ERC20_ABI, provider);

    let decimals = 18;
    try { decimals = Number(await erc.decimals()); } catch(_){}
    let balNum = 0;
    try{
      const raw = await erc.balanceOf(walletAddr);
      balNum = Number(ethers.formatUnits(raw, decimals)) || 0;
    }catch(e){ console.warn('BET balance 조회 실패:', e); }

    const th = CONFIG?.tierThresholds || { 1: 1, 2: 100, 3: 1000 };
    let tier = 0;
    if (balNum >= (th[3] ?? Infinity)) tier = 3;
    else if (balNum >= (th[2] ?? Infinity)) tier = 2;
    else if (balNum >= (th[1] ?? 1)) tier = 1;

    setTierPill(tier);
    return tier;
  }

  // 헤더 버튼 바인딩
  document.addEventListener('DOMContentLoaded', ()=>{
    const b1 = document.getElementById('btn-google');
    const b2 = document.getElementById('btn-logout');
    const b3 = document.getElementById('btn-wallet');
    b1 && !b1.dataset._bound && (b1.dataset._bound=1, b1.addEventListener('click', loginGoogle));
    b2 && !b2.dataset._bound && (b2.dataset._bound=1, b2.addEventListener('click', logout));
    b3 && !b3.dataset._bound && (b3.dataset._bound=1, b3.addEventListener('click', connectWallet));
  });

  // 전역 공개
  App.loginGoogle   = loginGoogle;
  App.logout        = logout;
  App.connectWallet = connectWallet;
  App.getTier       = getTier;
})();
