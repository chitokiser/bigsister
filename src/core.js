/* /src/core.js — 공통: Firebase/지갑/헤더주입/권한/유틸 + 이메일 로그인 모달 */
'use strict';

// ===== 유틸 =====
export function $(sel, el){ return (el||document).querySelector(sel); }
export function $$(sel, el){ return Array.from((el||document).querySelectorAll(sel)); }
export function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]); }
export function toast(msg){
  try{
    let el = $('#app-toast');
    if(!el){
      el=document.createElement('div'); el.id='app-toast';
      el.style.cssText='position:fixed;left:50%;bottom:28px;transform:translateX(-50%);padding:.6rem .9rem;border:1px solid #334155;border-radius:10px;background:#111827;color:#fff;z-index:9999;opacity:0;transition:opacity .2s';
      document.body.appendChild(el);
    }
    el.textContent = msg; el.style.opacity='1';
    setTimeout(()=>{ el.style.opacity='0'; }, 2000);
  }catch(e){ console.log(msg); }
}

// ===== 설정/상태 =====
export const CONFIG = window.CONFIG || {};
export const State  = { user:null, isAdmin:false, wallet:null, signer:null, tier:0 };

if (typeof firebase==='undefined') throw new Error('Firebase SDK not loaded');
if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(CONFIG.firebase || {});
export const auth = firebase.auth();
export const db   = firebase.firestore();
export const st   = firebase.storage();
export const TS   = firebase.firestore.FieldValue.serverTimestamp;

// (선택) App Check 활성화
try {
  if (CONFIG.appCheck?.siteKey) {
    if (CONFIG.appCheck.debug === true) { self.FIREBASE_APPCHECK_DEBUG_TOKEN = true; }
    const appCheck = firebase.appCheck();
    appCheck.activate(CONFIG.appCheck.siteKey, CONFIG.appCheck.debug === true);
  }
} catch (e) { console.warn('App Check activate failed:', e); }

// ===== 권한 =====
export async function computeIsAdmin(user){
  if(!user) return false;
  try{ await user.getIdToken(true); }catch(e){}
  try{
    const t = await user.getIdTokenResult();
    if (t?.claims?.admin === true) return true;
  }catch(e){}
  try{
    const s = await db.collection('users').doc(user.uid).get();
    if (s.exists && (s.data()?.role === 'admin')) return true;
  }catch(e){}
  return false;
}

// ===== 헤더/푸터 include + 이벤트 바인딩 =====
let _authBound = false;
export async function ensureLayout(activePathName){
  // 1) include header/footer
  const headBox = document.getElementById('app-header');
  const footBox = document.getElementById('app-footer');
  try{
    if (headBox) headBox.innerHTML = await (await fetch('./partials/header.html')).text();
    if (footBox) footBox.innerHTML = await (await fetch('./partials/footer.html')).text();
  }catch(err){
    console.warn('header/footer include 실패:', err);
  }

  // 2) 모바일 내비 토글 (백드롭 + 스크롤잠금 + ESC)
  const openBtn  = document.getElementById('btn-open-nav');
  const panel    = document.getElementById('nav-links');
  const closeBtn = document.getElementById('btn-close-nav');
  const backdrop = document.getElementById('nav-backdrop');

  function setNav(opened){
    if (!panel) return;
    panel.classList.toggle('open', opened);
    panel.setAttribute('aria-hidden', opened ? 'false' : 'true');
    openBtn?.setAttribute('aria-expanded', opened ? 'true' : 'false');
    backdrop?.classList.toggle('open', opened);
    document.body.classList.toggle('no-scroll', opened);
    if (opened) panel.focus();
  }
  openBtn?.addEventListener('click', ()=> setNav(!panel.classList.contains('open')));
  closeBtn?.addEventListener('click', ()=> setNav(false));
  backdrop?.addEventListener('click', ()=> setNav(false));
  panel?.addEventListener('click', (e)=>{ if (e.target.closest('a')) setNav(false); });
  document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') setNav(false); });
  try{ window.matchMedia('(min-width: 960px)').addEventListener('change', ()=> setNav(false)); }catch(_){}

  // 3) 로그인/로그아웃/지갑/이메일 버튼 바인딩 + 이메일 모달 바인딩
  bindHeaderEvents();
  bindEmailModalEvents();

  // 4) 활성 메뉴 표시
  const current = activePathName || (location.pathname.split('/').pop() || 'index.html');
  $$('#nav-links a').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (href.endsWith(current)) a.classList.add('active'); else a.classList.remove('active');
  });

  // 5) 인증 상태 감시(한 번만 설치)
  if (!_authBound){
    _authBound = true;
    auth.onAuthStateChanged(async (user)=>{
      State.user = user || null;
      State.isAdmin = user ? (await computeIsAdmin(user)) : false;
      updateAuthUI();
    });
  }

  // 6) 리다이렉트 로그인 결과 처리(팝업 차단 폴백용)
  await handleRedirectResult();
}

export function updateAuthUI(){
  const g=$('#btn-google'), lo=$('#btn-logout'), up=$('#user-photo'), tp=$('#tier-pill'), em=$('#btn-email');
  if(State.user){
    g?.classList.add('hidden'); em?.classList.add('hidden');
    lo?.classList.remove('hidden');
    if(State.user.photoURL){ up && (up.src=State.user.photoURL) && up.classList.remove('hidden'); }
    tp && (tp.textContent='티어: '+(State.tier||1)) && tp.classList.remove('hidden');
  }else{
    g?.classList.remove('hidden'); em?.classList.remove('hidden');
    lo?.classList.add('hidden'); up?.classList.add('hidden'); tp?.classList.add('hidden');
  }
  // 관리자 메뉴 토글
  $$('[data-admin-only]').forEach(el => State.isAdmin ? el.classList.remove('hidden') : el.classList.add('hidden'));
}

export function bindHeaderEvents(){
  const lg=$('#btn-google'); if(lg && !lg._bound){ lg._bound=true; lg.addEventListener('click', loginGoogle); }
  const lo=$('#btn-logout'); if(lo && !lo._bound){ lo._bound=true; lo.addEventListener('click', logout); }
  const wc=$('#btn-wallet'); if(wc && !wc._bound){ wc._bound=true; wc.addEventListener('click', connectWallet); }
  const em=$('#btn-email');  if(em && !em._bound){ em._bound=true; em.addEventListener('click', openEmailModal); }
}

// ===== 이메일 로그인 모달 =====
function setEmailModal(opened){
  const m = $('#email-auth-modal'), b = $('#email-auth-backdrop');
  if (!m || !b) return;
  m.classList.toggle('open', opened);
  m.setAttribute('aria-hidden', opened?'false':'true');
  b.classList.toggle('open', opened);
  document.body.classList.toggle('no-scroll', opened);
  if (opened){ $('#email-login')?.focus(); $('#email-auth-error').textContent=''; }
}
export function openEmailModal(){ setEmailModal(true); }
export function closeEmailModal(){ setEmailModal(false); }

function bindEmailModalEvents(){
  const closeBtn = $('#email-auth-close');
  if (closeBtn && !closeBtn._bound){ closeBtn._bound=true; closeBtn.addEventListener('click', closeEmailModal); }
  const bd = $('#email-auth-backdrop');
  if (bd && !bd._bound){ bd._bound=true; bd.addEventListener('click', closeEmailModal); }
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') closeEmailModal(); });

  // 탭 전환
  $$('.tab-btn').forEach(btn=>{
    if (btn._bound) return; btn._bound=true;
    btn.addEventListener('click', ()=>{
      $$('.tab-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
      const tab = btn.getAttribute('data-tab');
      $$('.tab-pane').forEach(p=>p.classList.remove('active'));
      $('#tab-'+tab)?.classList.add('active');
      $('#email-auth-error').textContent='';
    });
  });

  // 동작 버튼
  const btnLogin = $('#email-login-btn');
  if (btnLogin && !btnLogin._bound){
    btnLogin._bound=true; btnLogin.addEventListener('click', loginWithEmailForm);
  }
  const btnSignup = $('#email-signup-btn');
  if (btnSignup && !btnSignup._bound){
    btnSignup._bound=true; btnSignup.addEventListener('click', signupWithEmailForm);
  }
  const btnReset = $('#email-reset-btn');
  if (btnReset && !btnReset._bound){
    btnReset._bound=true; btnReset.addEventListener('click', resetPasswordFromForm);
  }
}

function showEmailErr(msg){ const e=$('#email-auth-error'); if(e) e.textContent=msg||''; }
function mapAuthErr(e){
  const c=String(e?.code||''); switch(c){
    case 'auth/invalid-email': return '이메일 형식이 올바르지 않습니다.';
    case 'auth/missing-password':
    case 'auth/internal-error': return '비밀번호를 입력해 주세요.';
    case 'auth/wrong-password': return '이메일 또는 비밀번호가 올바르지 않습니다.';
    case 'auth/user-not-found': return '가입된 사용자가 없습니다. 회원가입을 진행해 주세요.';
    case 'auth/email-already-in-use': return '이미 가입된 이메일입니다.';
    case 'auth/weak-password': return '비밀번호는 최소 6자 이상이어야 합니다.';
    default: return e?.message || '요청을 처리할 수 없습니다.';
  }
}

async function loginWithEmailForm(){
  const email = $('#email-login')?.value.trim()||'';
  const pw    = $('#password-login')?.value||'';
  showEmailErr('');
  try{
    const { user } = await auth.signInWithEmailAndPassword(email, pw);
    if (user){
      await db.collection('users').doc(user.uid).set({
        uid:user.uid, email:user.email||'', displayName:user.displayName||'',
        photoURL:user.photoURL||'', lastLoginAt:Date.now(), updatedAt:TS()
      }, {merge:true});
      State.user = user;
      State.isAdmin = await computeIsAdmin(user);
      updateAuthUI();
      toast('로그인 성공');
      closeEmailModal();
    }
  }catch(e){ console.error(e); showEmailErr(mapAuthErr(e)); }
}

async function signupWithEmailForm(){
  const email = $('#email-signup')?.value.trim()||'';
  const pw    = $('#password-signup')?.value||'';
  showEmailErr('');
  try{
    const { user } = await auth.createUserWithEmailAndPassword(email, pw);
    if (user){
      await db.collection('users').doc(user.uid).set({
        uid:user.uid, email:user.email||'', displayName:user.displayName||'',
        photoURL:user.photoURL||'', createdAt:TS(), lastLoginAt:Date.now(), updatedAt:TS()
      }, {merge:true});
      State.user = user;
      State.isAdmin = await computeIsAdmin(user);
      updateAuthUI();
      toast('회원가입 완료, 로그인되었습니다.');
      closeEmailModal();
    }
  }catch(e){ console.error(e); showEmailErr(mapAuthErr(e)); }
}

async function resetPasswordFromForm(){
  const email = ($('#email-login')?.value || $('#email-signup')?.value || '').trim();
  if (!email){ showEmailErr('이메일을 먼저 입력해 주세요.'); return; }
  try{
    await auth.sendPasswordResetEmail(email);
    showEmailErr('재설정 메일을 보냈습니다. 받은 편지함을 확인하세요.');
  }catch(e){ console.error(e); showEmailErr(mapAuthErr(e)); }
}

// ===== Google 로그인(팝업 우선, 차단 시 리다이렉트 폴백) =====
let _loginBusy = false;
export async function loginGoogle(){
  if (_loginBusy) return; _loginBusy = true;
  const btn = $('#btn-google'); try{ if(btn) btn.disabled=true; }catch(_){}
  try{
    const provider = new firebase.auth.GoogleAuthProvider();
    const res = await auth.signInWithPopup(provider);
    const user = res?.user;
    if (user){
      await db.collection('users').doc(user.uid).set({
        uid:user.uid, email:user.email||'', displayName:user.displayName||'',
        photoURL:user.photoURL||'', lastLoginAt:Date.now(), updatedAt:TS()
      }, {merge:true});
      State.user = user;
      State.isAdmin = await computeIsAdmin(user);
      updateAuthUI();
      toast('로그인 성공');
    }
  }catch(e){
    const code=String(e?.code||''); const msg=String(e?.message||'');
    const needFallback = code==='auth/popup-blocked' || code==='auth/popup-closed-by-user' ||
                         code==='auth/cancelled-popup-request' || msg.includes('Opener-Policy') ||
                         msg.includes('COOP') || msg.includes('window.close');
    if (needFallback){
      toast('팝업이 차단되어 리다이렉트로 진행합니다…');
      const provider = new firebase.auth.GoogleAuthProvider();
      await auth.signInWithRedirect(provider);
    } else {
      console.error(e); toast('로그인 실패: '+(e?.message||e));
    }
  }finally{ _loginBusy=false; if(btn) btn.disabled=false; }
}

export async function handleRedirectResult(){
  try{
    const res = await auth.getRedirectResult();
    const user = res?.user;
    if (!user) return;
    await db.collection('users').doc(user.uid).set({
      uid:user.uid, email:user.email||'', displayName:user.displayName||'',
      photoURL:user.photoURL||'', lastLoginAt:Date.now(), updatedAt:TS()
    }, {merge:true});
    State.user = user;
    State.isAdmin = await computeIsAdmin(user);
    updateAuthUI();
    toast('로그인 성공');
  }catch(e){ console.warn('redirect result:', e?.code || e?.message || e); }
}

export async function logout(){
  try{
    await auth.signOut();
    State.user=null; State.isAdmin=false;
    updateAuthUI();
    toast('로그아웃 되었습니다.');
  }catch(e){
    console.error(e); toast('로그아웃 실패: '+(e?.message||e));
  }
}

// ===== 인증 가드 =====
export async function requireAuth(redirectTo='index.html'){
  if (State.user) return;
  await new Promise(r=>setTimeout(r, 50));
  if (!State.user){ toast('로그인 후 이용해 주세요.'); location.href = redirectTo; throw new Error('auth required'); }
}
export function requireAdmin(redirectTo='index.html'){
  if (State.isAdmin) return;
  toast('운영자 전용입니다.'); location.href = redirectTo; throw new Error('admin required');
}

// ===== 지갑 연결 =====
export async function connectWallet(){
  const CHAIN = CONFIG.chain || {};
  try{
    if(!window.ethereum){ toast('메타마스크 등 지갑을 설치해 주세요.'); return; }
    const accounts = await window.ethereum.request({method:'eth_requestAccounts'});
    const wallet = accounts?.[0]; if(!wallet){ toast('지갑 연결이 취소되었습니다.'); return; }

    const chainIdHex = CHAIN.chainIdHex || (CHAIN.chainId ? ('0x'+Number(CHAIN.chainId).toString(16)) : null);
    if (chainIdHex){
      const cur = await window.ethereum.request({method:'eth_chainId'});
      if (String(cur).toLowerCase() !== String(chainIdHex).toLowerCase()){
        try{
          await window.ethereum.request({method:'wallet_switchEthereumChain', params:[{ chainId: chainIdHex }]});
        }catch(e){
          if (e?.code === 4902){
            await window.ethereum.request({
              method:'wallet_addEthereumChain',
              params:[{
                chainId:chainIdHex,
                chainName: CHAIN.chainName || CHAIN.network || 'Custom',
                rpcUrls: CHAIN.rpcUrls || (CHAIN.rpcUrl ? [CHAIN.rpcUrl] : []),
                nativeCurrency: CHAIN.nativeCurrency || { name:'ETH', symbol:'ETH', decimals:18 },
                blockExplorerUrls: CHAIN.blockExplorerUrls || []
              }]
            });
          }else{
            throw e;
          }
        }
      }
    }

    if (!window.ethers){ toast('ethers 라이브러리를 찾을 수 없습니다.'); return; }
    const provider = new window.ethers.BrowserProvider(window.ethereum);
    State.signer = await provider.getSigner();
    State.wallet = wallet;
    const bw = $('#btn-wallet');
    if (bw) bw.textContent = '연결됨: '+wallet.slice(0,6)+'…'+wallet.slice(-4);
    toast('지갑 연결 성공');
  }catch(e){
    console.error(e);
    toast('지갑 연결 실패: '+(e?.message||e));
  }
}
