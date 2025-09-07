/* src/app.js — LocaMate 전체 수정보완본
 * - 로그인: 팝업 우선 + 차단/오류 시 자동 리다이렉트 폴백
 * - 운영자/메이트 콘솔: 권한·라우팅·UI 토글 보강
 * - 홈: 추천 로컬메이트 로딩 3단 폴백(반드시 보이게), 내 프로필 병합
 * - 카드: [상품 보기] / [블로그 보기] 버튼 → #/search?owner=<uid>&kind=product|post
 * - 검색: owner/kind 필터, 인덱스 없으면 클라이언트 정렬 폴백
 * - 지갑 연결: ethers v6 + 다양한 CHAIN 설정 지원(chainIdHex/chainId/rpcUrls)
 */

'use strict';

/* ========== 0) DOM/Toast 유틸 ========== */
function $(sel, el){ return (el||document).querySelector(sel); }
function $$(sel, el){ return Array.prototype.slice.call((el||document).querySelectorAll(sel)); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(m){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]; }); }
function toast(msg){
  try{
    var id='app-toast', el=document.getElementById(id);
    if(!el){ el=document.createElement('div'); el.id=id;
      el.style.cssText='position:fixed;left:50%;bottom:28px;transform:translateX(-50%);padding:.6rem .9rem;border:1px solid #334155;border-radius:10px;background:#111827;color:#fff;z-index:9999;opacity:0;transition:opacity .2s';
      document.body.appendChild(el);
    }
    el.textContent=msg; el.style.opacity='1';
    setTimeout(function(){ el.style.opacity='0'; }, 2000);
  }catch(e){ console.log(msg); }
}

/* ========== 1) 전역 상태/설정 ========== */
var State = { user:null, isAdmin:false, wallet:null, signer:null, tier:0 };
window.State = State; // 디버깅 편의

var CFG   = window.CONFIG || {};
var FIRE  = CFG.firebase || {};
var CHAIN = CFG.chain    || {};
var COL   = { agents:'agents', apps:'agentApplications', items:'items', notices:'notices' };

var _unsubRole = null;

/* ========== 2) Firebase 초기화(compat) ========== */
if (typeof firebase === 'undefined') throw new Error('Firebase SDK not loaded');
if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(FIRE);
var auth=firebase.auth(), db=firebase.firestore(), st=firebase.storage();
var TS=firebase.firestore.FieldValue.serverTimestamp;

/* ========== 3) 관리자 판별(커스텀클레임 또는 users.role=admin) ========== */
async function computeIsAdmin(user){
  if(!user) return false;
  try{ await user.getIdToken(true); }catch(e){}
  try{
    var tok=await user.getIdTokenResult();
    if(tok && tok.claims && tok.claims.admin===true) return true;
  }catch(e){}
  try{
    var snap=await db.collection('users').doc(user.uid).get();
    if(snap.exists && (snap.data()||{}).role==='admin') return true;
  }catch(e){}
  return false;
}

/* ========== 4) 로그인/로그아웃 — 팝업 우선 + 자동 폴백 ========== */
let _loginBusy = false;
async function loginGoogle(){
  if (_loginBusy) return;
  _loginBusy = true;
  var btn = $('#btn-google');
  try{
    if(btn) btn.disabled = true;

    var provider = new firebase.auth.GoogleAuthProvider();
    // 1) 팝업 시도
    var res = await auth.signInWithPopup(provider);
    var user = res && res.user ? res.user : null;
    if (user){
      await db.collection('users').doc(user.uid).set({
        uid:user.uid, email:user.email||'', displayName:user.displayName||'',
        photoURL:user.photoURL||'', lastLoginAt:Date.now(), updatedAt:TS()
      }, { merge:true });
      State.user = user;
      State.isAdmin = await computeIsAdmin(user);
      updateAuthUI();
      toast('로그인 성공');
      await afterLogin();
    }
  }catch(e){
    var code=String(e && e.code || '');
    var msg =String(e && e.message || '');
    var needFallback =
      code==='auth/popup-blocked' ||
      code==='auth/popup-closed-by-user' ||
      code==='auth/cancelled-popup-request' ||
      msg.includes('Opener-Policy') || msg.includes('COOP') || msg.includes('window.close');

    if (needFallback){
      try{
        toast('팝업이 차단되어 리다이렉트로 진행합니다…');
        var provider2 = new firebase.auth.GoogleAuthProvider();
        await auth.signInWithRedirect(provider2);
        return; // 리다이렉트로 이동
      }catch(e2){
        console.error('redirect fallback failed:', e2);
        toast('로그인 실패: ' + (e2 && e2.message ? e2.message : e2));
      }
    } else {
      console.error('popup login failed:', e);
      toast('로그인 실패: ' + (e && e.message ? e.message : e));
    }
  }finally{
    _loginBusy = false;
    if(btn) btn.disabled = false;
  }
}

async function handleRedirectResult(){
  try{
    var res = await auth.getRedirectResult();
    var user = res && res.user ? res.user : null;
    if (!user) return;
    await db.collection('users').doc(user.uid).set({
      uid:user.uid, email:user.email||'', displayName:user.displayName||'',
      photoURL:user.photoURL||'', lastLoginAt:Date.now(), updatedAt:TS()
    }, { merge:true });
    State.user = user;
    State.isAdmin = await computeIsAdmin(user);
    updateAuthUI();
    toast('로그인 성공');
    await afterLogin();
  }catch(e){
    console.warn('redirect result:', e && (e.code||e.message) || e);
  }
}

async function logout(){
  try{
    await auth.signOut();
    State.user=null; State.isAdmin=false; State.wallet=null; State.signer=null;
    updateAuthUI();
    toast('로그아웃 되었습니다.');
  }catch(e){
    console.error(e); toast('로그아웃 실패: ' + (e && e.message ? e.message : e));
  }
}

/* ========== 5) UI 토글(아바타·관리자 메뉴) ========== */
function updateAdminUI(){
  var els=$$('[data-admin-only]');
  for (var i=0;i<els.length;i++){
    if (State.isAdmin) els[i].classList.remove('hidden');
    else els[i].classList.add('hidden');
  }
}
function updateAuthUI(){
  var g=$('#btn-google'), lo=$('#btn-logout'), up=$('#user-photo'), tp=$('#tier-pill'), w=$('#btn-wallet');
  if(State.user){
    if(g) g.classList.add('hidden');
    if(lo) lo.classList.remove('hidden');
    if(up){
      if(State.user.photoURL){ up.src=State.user.photoURL; up.classList.remove('hidden'); }
      else up.classList.add('hidden');
    }
    if(tp){ tp.textContent='티어: '+(State.tier||1); tp.classList.remove('hidden'); }
  }else{
    if(g) g.classList.remove('hidden');
    if(lo) lo.classList.add('hidden');
    if(up) up.classList.add('hidden');
    if(tp) tp.classList.add('hidden');
    if(w) w.textContent='지갑 연결';
  }
  updateAdminUI();
}

/* ========== 6) 지갑 연결(안정/다양한 CHAIN 포맷 지원) ========== */
async function connectWallet(){
  try{
    if(!window.ethereum){ toast('메타마스크 등 지갑을 설치해 주세요.'); return; }
    var accounts=await window.ethereum.request({ method:'eth_requestAccounts' });
    var wallet=accounts && accounts[0] ? accounts[0] : null;
    if(!wallet){ toast('지갑 연결이 취소되었습니다.'); return; }

    var targetHex = CHAIN.chainIdHex || (CHAIN.chainId ? ('0x'+Number(CHAIN.chainId).toString(16)) : null);
    if (targetHex){
      try{
        var cur=await window.ethereum.request({ method:'eth_chainId' });
        if ((cur||'').toLowerCase() !== targetHex.toLowerCase()){
          try{
            await window.ethereum.request({ method:'wallet_switchEthereumChain', params:[{ chainId: targetHex }] });
          }catch(e){
            if (e && e.code===4902){
              await window.ethereum.request({
                method:'wallet_addEthereumChain',
                params:[{
                  chainId: targetHex,
                  chainName: CHAIN.chainName || CHAIN.network || 'Custom',
                  rpcUrls: CHAIN.rpcUrls || (CHAIN.rpcUrl ? [CHAIN.rpcUrl] : []),
                  nativeCurrency: CHAIN.nativeCurrency || { name:'ETH', symbol:'ETH', decimals:18 },
                  blockExplorerUrls: CHAIN.blockExplorerUrls || []
                }]
              });
            } else { throw e; }
          }
        }
      }catch(e){}
    }

    if(!window.ethers){ toast('ethers 라이브러리를 찾을 수 없습니다.'); return; }
    var provider=new window.ethers.BrowserProvider(window.ethereum);
    var signer=await provider.getSigner();
    State.wallet=wallet; State.signer=signer;

    var b=$('#btn-wallet'); if(b) b.textContent='연결됨: '+wallet.slice(0,6)+'…'+wallet.slice(-4);

    try{
      if(typeof window.ethereum.on==='function'){
        if(typeof window.ethereum.removeAllListeners==='function'){
          try{ window.ethereum.removeAllListeners('disconnect'); }catch(e){}
          try{ window.ethereum.removeAllListeners('chainChanged'); }catch(e){}
          try{ window.ethereum.removeAllListeners('accountsChanged'); }catch(e){}
        }
        window.ethereum.on('disconnect', function(){ try{toast('지갑 연결 해제됨 — 새로고침합니다.');}catch(e){} location.reload(); });
        window.ethereum.on('chainChanged', function(){ location.reload(); });
        window.ethereum.on('accountsChanged', function(){ location.reload(); });
      }
    }catch(e){}

    toast('지갑 연결 성공');
  }catch(e){
    console.error(e);
    if(e && e.code===4900) toast('지갑이 어떤 체인에도 연결되지 않았습니다. 네트워크 선택 후 다시 시도하세요.');
    else toast('지갑 연결 실패: ' + (e && e.message ? e.message : e));
  }
}

/* ========== 7) 라우팅 & 쿼리 파서 ========== */
function hashRoute(){ var s=(location.hash||'#').replace(/^#\/?/,''); return (s.split('?')[0]) || 'home'; }
function routeTo(name, query){
  var h = name==='home' ? '#/' : '#/'+name;
  if (query && typeof query==='object'){
    var qs = Object.keys(query).map(function(k){ return encodeURIComponent(k)+'='+encodeURIComponent(query[k]); }).join('&');
    if (qs) h += '?'+qs;
  }
  location.hash = h;
}
function parseHashQuery(){
  var h=location.hash||''; var i=h.indexOf('?'); if(i<0) return {};
  var q=h.slice(i+1), obj={};
  q.split('&').forEach(function(p){ var kv=p.split('='); var k=decodeURIComponent(kv[0]||''); var v=decodeURIComponent(kv[1]||''); if(k) obj[k]=v; });
  return obj;
}
window.addEventListener('hashchange', function(){ renderRoute().catch(console.error); });

/* ========== 8) 로그인 후 공통 ========== */
async function afterLogin(){ await renderRoute(); }

/* ========== 9) 로컬 메이트 콘솔(저장/로드/신청) ========== */
async function saveAgentProfile(user){
  if(!user){ toast('로그인 후 이용해 주세요.'); return; }
  var uid=user.uid;
  var name=$('#agent-name')?$('#agent-name').value.trim():'';
  var bio=$('#agent-bio')?$('#agent-bio').value.trim():'';
  var city=$('#agent-region')?$('#agent-region').value.trim():'';
  var contact=$('#agent-contact')?$('#agent-contact').value.trim():'';
  var messenger=$('#agent-messenger')?$('#agent-messenger').value.trim():'';
  var wallet=$('#agent-wallet')?$('#agent-wallet').value.trim():'';

  var photoURL=null;
  try{
    var fi=$('#agent-photo'); var f=fi && fi.files ? fi.files[0] : null;
    if(f){ var ref=st.ref().child('users/'+uid+'/profile/'+Date.now()+'_'+f.name); await ref.put(f); photoURL=await ref.getDownloadURL(); }
  }catch(e){ console.warn('photo upload skipped', e); }

  var data={ ownerUid:uid, displayName:name, bio:bio, city:city, contact:contact, messenger:messenger, wallet:wallet, updatedAt:TS() };
  if(photoURL) data.photoURL=photoURL;

  await db.collection(COL.agents).doc(uid).set(data, { merge:true });
  toast('프로필이 저장되었습니다.');
  await loadAgentProfile(user);
}
async function loadAgentProfile(user){
  if(!user) return;
  var uid=user.uid, ref=db.collection(COL.agents).doc(uid), snap=await ref.get(), statusEl=$('#agent-status');
  if(snap && snap.exists){
    var d=snap.data()||{};
    if($('#agent-name')) $('#agent-name').value=d.displayName||'';
    if($('#agent-bio')) $('#agent-bio').value=d.bio||'';
    if($('#agent-region')) $('#agent-region').value=d.city||'';
    if($('#agent-contact')) $('#agent-contact').value=d.contact||'';
    if($('#agent-messenger')) $('#agent-messenger').value=d.messenger||'';
    if($('#agent-wallet')) $('#agent-wallet').value=d.wallet||'';
    if(d.photoURL && $('#agent-photo-preview')){ var img=$('#agent-photo-preview'); img.src=d.photoURL; img.classList.remove('hidden'); }
    if(statusEl) statusEl.textContent='상태: '+labelStatus(d.status);
  }else{
    if(statusEl) statusEl.textContent='상태: 초안';
  }
  await updateApplyButton(uid);
}
function labelStatus(s){ return (s==='applied')?'신청':(s==='approved')?'승인':(s==='rejected')?'반려':'초안'; }
async function updateApplyButton(uid){
  var appRef=db.collection(COL.apps).doc(uid), appSnap=await appRef.get(), btn=$('#agent-apply');
  if(!btn) return;
  if(appSnap && appSnap.exists){ btn.disabled=true; btn.textContent='신청 완료(중복 신청 불가)'; }
  else { btn.disabled=false; btn.textContent='로컬 메이트 가입 신청'; }
}
async function applyForAgent(user){
  if(!user){ toast('로그인 후 이용해 주세요.'); return; }
  var uid=user.uid;
  await db.runTransaction(async function(tx){
    var appRef=db.collection(COL.apps).doc(uid), agRef=db.collection(COL.agents).doc(uid);
    var appSnap=await tx.get(appRef);
    if(appSnap && appSnap.exists) throw new Error('이미 신청되어 있습니다.');
    tx.set(appRef,{ uid:uid, email:user.email||'', status:'pending', appliedAt:TS() });
    tx.set(agRef,{ status:'applied', updatedAt:TS() },{ merge:true });
  });
  toast('가입 신청이 접수되었습니다.');
  await updateApplyButton(uid);
  var s=$('#agent-status'); if(s) s.textContent='상태: 신청';
}

/* ========== 10) 홈: 공지 + 추천 로컬메이트(강력 폴백) ========== */
async function renderHome(){ await Promise.all([renderNotices(), renderFeaturedAgents()]); }

async function renderNotices(){
  var nl=$('#notice-list'); if(!nl) return;
  try{
    var snap=await db.collection(COL.notices).orderBy('ts','desc').limit(10).get();
    if(!snap.empty){
      nl.innerHTML=snap.docs.map(function(d){ var x=d.data()||{}; return '<div class="row"><strong>'+esc(x.title||'')+'</strong><div class="muted small">'+esc(x.body||'')+'</div></div>'; }).join('');
    }else nl.innerHTML='<div class="muted small">등록된 공지가 없습니다.</div>';
  }catch(e){ nl.innerHTML='<div class="muted small">공지 불러오기 오류</div>'; }
}

function isIndexError(err){ if(!err) return false; var msg=String(err.message||''); return (err.code===9)||(msg.indexOf('requires an index')>=0)||(msg.indexOf('FAILED_PRECONDITION')>=0); }

function buildAgentCard(d, isMine, ownerId){
  var badge=isMine ? '<span class="pill" style="margin-left:6px">내 프로필</span>' : (d.status==='approved'?'':'<span class="pill" style="margin-left:6px">'+esc(labelStatus(d.status))+'</span>');
  var img=d.photoURL||'https://placehold.co/300x200?text=Local+Mate';
  var bio=(d.bio||'').split('\n')[0]; if(bio.length>80) bio=bio.slice(0,77)+'…';
  return ''+
  '<div class="card">'+
    '<img src="'+esc(img)+'" alt="" style="width:100%;height:160px;object-fit:cover;border-radius:12px"/>'+
    '<div class="col" style="gap:6px;margin-top:8px">'+
      '<div class="row" style="align-items:center"><strong>'+esc(d.displayName||'로컬 메이트')+'</strong>'+badge+'</div>'+
      '<div class="muted small">'+esc(d.city||'')+'</div>'+
      '<div class="muted small">'+esc(bio)+'</div>'+
      '<div class="row gap wrap" style="margin-top:8px">'+
        '<button class="btn outline small" data-action="view-items" data-owner="'+esc(ownerId)+'" data-kind="product">상품 보기</button>'+
        '<button class="btn subtle small"  data-action="view-items" data-owner="'+esc(ownerId)+'" data-kind="post">블로그 보기</button>'+
      '</div>'+
    '</div>'+
  '</div>';
}

async function renderFeaturedAgents(){
  var grid=$('#agent-grid'), rgrid=$('#region-grid');
  if(grid) grid.innerHTML='<div class="muted small">로딩 중…</div>';
  if(rgrid) rgrid.innerHTML='';

  var docs=[];

  // 1) 기본: 승인 + updatedAt desc
  try{
    var snap=await db.collection(COL.agents)
      .where('status','==','approved')
      .orderBy('updatedAt','desc')
      .limit(20)
      .get();
    docs = snap.empty ? [] : snap.docs.slice();
  }catch(e1){
    console.warn('[agents] primary failed → fallback-1', e1);
    // 2) 폴백1: 승인필터 제거 + updatedAt 정렬
    try{
      var snap2=await db.collection(COL.agents)
        .orderBy('updatedAt','desc')
        .limit(20)
        .get();
      docs = snap2.empty ? [] : snap2.docs.slice();
    }catch(e2){
      console.warn('[agents] fallback-1 failed → fallback-2', e2);
      // 3) 폴백2: 정렬 제거(최소 표시)
      try{
        var snap3=await db.collection(COL.agents).limit(20).get();
        docs = snap3.empty ? [] : snap3.docs.slice();
      }catch(e3){
        console.error('[agents] fallback-2 failed', e3);
      }
    }
  }

  // 로그인 중이면 내 프로필 병합
  if(State.user){
    try{
      var my=await db.collection(COL.agents).doc(State.user.uid).get();
      if(my && my.exists && !docs.some(function(d){ return d.id===my.id; })){
        docs.unshift(my);
      }
    }catch(e){}
  }

  // 카드 렌더 + 버튼 핸들러
  if(grid){
    if(!docs.length){
      grid.innerHTML='<div class="muted small">표시할 로컬 메이트가 아직 없습니다. "로컬 메이트 허브"에서 지역 소개 카드를 저장해 보세요.</div>';
    }else{
      grid.innerHTML=docs.map(function(doc){
        var d=doc.data()||{}; var isMine=(State.user && doc.id===State.user.uid);
        return buildAgentCard(d, isMine, doc.id);
      }).join('');
    }
    if(!grid._bound){
      grid._bound=true;
      grid.addEventListener('click', function(e){
        var btn=e.target.closest('[data-action="view-items"]'); if(!btn) return;
        routeTo('search', { owner: btn.getAttribute('data-owner'), kind: btn.getAttribute('data-kind') });
      });
    }
  }

  // 지역 그리드(도시별 집계)
  if(rgrid && docs.length){
    var map={};
    docs.forEach(function(doc){
      var d=doc.data()||{}; var key=(d.city||'기타').trim()||'기타';
      var cur=map[key]||{count:0,sample:d}; cur.count+=1; map[key]=cur;
    });
    var list=Object.keys(map).map(function(k){ return { city:k, count:map[k].count, sample:map[k].sample }; });
    list.sort(function(a,b){ return b.count-a.count; });
    var top=list.slice(0,6);
    rgrid.innerHTML=top.map(function(x){
      var img=(x.sample && x.sample.photoURL) || 'https://placehold.co/300x200?text='+encodeURIComponent(x.city);
      return '<div class="card"><img src="'+esc(img)+'" alt="" style="width:100%;height:120px;object-fit:cover;border-radius:12px"/><div class="row spread" style="margin-top:8px"><strong>'+esc(x.city)+'</strong><span class="pill">'+x.count+'</span></div></div>';
    }).join('');
  }
}

/* ========== 11) 검색 화면(작성자/종류 필터) ========== */
async function renderSearch(){
  var grid=$('#search-grid'); if(!grid) return;
  var qEl=$('#search-q');
  var params=parseHashQuery();
  var owner=params.owner||'', kind=params.kind||'';

  if(qEl){
    if(owner && kind) qEl.placeholder='필터: 작성자/종류로 검색 결과';
    else if(owner)   qEl.placeholder='필터: 작성자별 검색 결과';
    else if(kind)    qEl.placeholder='필터: 종류별 검색 결과';
    else             qEl.placeholder='지역/테마/태그';
  }

  grid.innerHTML='<div class="muted small">검색 중…</div>';

  var ref=db.collection(COL.items);
  if(owner) ref=ref.where('ownerUid','==', owner);
  if(kind)  ref=ref.where('kind','==', kind);
  ref=ref.orderBy('ts','desc').limit(60);

  try{
    var snap=await ref.get();
    renderItemsIntoGrid(snap.docs, grid);
  }catch(e){
    if(isIndexError(e)){
      try{
        var r=db.collection(COL.items); var q=r;
        if(owner) q=q.where('ownerUid','==', owner);
        if(kind)  q=q.where('kind','==', kind);
        var s2=await q.limit(200).get();
        var docs=s2.docs.slice().sort(function(a,b){ return (b.data().ts||0)-(a.data().ts||0); });
        renderItemsIntoGrid(docs, grid);
        toast('인덱스가 없어 임시 정렬로 표시합니다. Firestore 인덱스를 생성해 주세요.');
      }catch(e2){ console.error(e2); grid.innerHTML='<div class="muted small">검색 실패</div>'; }
    }else{ console.error(e); grid.innerHTML='<div class="muted small">검색 실패</div>'; }
  }

  var run=$('#search-run');
  if(run && !run._bound){
    run._bound=true;
    run.addEventListener('click', function(){
      toast('텍스트 검색은 추후 확장 예정입니다.');
    });
  }
}
function renderItemsIntoGrid(docs, grid){
  if(!docs || !docs.length){ grid.innerHTML='<div class="muted small">검색 결과가 없습니다.</div>'; return; }
  var html=docs.map(function(doc){
    var d=doc.data()||{};
    var img=(d.images && d.images[0]) || 'https://placehold.co/600x360?text=No+Image';
    var right=(d.kind==='product')?((d.price!=null?d.price:'-')+' PAW'):'포스트';
    var tag=(d.tags||[]).slice(0,3).join(', ');
    return ''+
      '<div class="card">'+
        '<img src="'+esc(img)+'" alt="" style="width:100%;height:160px;object-fit:cover;border-radius:12px"/>'+
        '<div class="col" style="gap:6px;margin-top:8px">'+
          '<div class="row spread"><strong>'+esc(d.title||'')+'</strong><small class="muted">'+esc(right)+'</small></div>'+
          '<div class="muted small">'+esc(tag)+'</div>'+
          '<div class="muted small">'+esc((d.body||'').split('\n')[0].slice(0,80))+'</div>'+
        '</div>'+
      '</div>';
  }).join('');
  grid.innerHTML=html;
}

/* ========== 12) 아이템 생성/목록(메이트 콘솔) ========== */
function resolveKind(){
  var kindEl=document.getElementById('post-kind');
  if(kindEl){ var v=(kindEl.value||'').toLowerCase(); if(v==='product'||v==='post') return v; }
  var raw=$('#post-price')?$('#post-price').value:''; return (raw===''||raw==null)?'post':'product';
}
async function createItem(user){
  if(!user){ toast('로그인 후 이용해 주세요.'); return; }
  var uid=user.uid;
  var title=$('#post-title')?$('#post-title').value.trim():'';
  var body=$('#post-body')?$('#post-body').value.trim():'';
  var raw=$('#post-price')?$('#post-price').value:''; var price=(raw===''||raw==null)?null:Number(raw);
  var tagsStr=$('#post-tags')?$('#post-tags').value:''; var tags=tagsStr.split(',').map(function(s){return s.trim();}).filter(Boolean);
  if(!title){ toast('제목을 입력해 주세요.'); return; }

  var kind=resolveKind();
  var docRef=db.collection(COL.items).doc();
  var images=[];
  try{
    var fi=document.getElementById('post-images');
    var list= fi && fi.files ? fi.files : [];
    for(var i=0;i<list.length;i++){
      var f=list[i], path='users/'+uid+'/posts/'+docRef.id+'/'+Date.now()+'_'+f.name;
      var ref=st.ref().child(path); await ref.put(f); images.push(await ref.getDownloadURL());
    }
  }catch(e){ console.warn('image upload skipped', e); }

  await docRef.set({ ownerUid:uid, kind:kind, title:title, body:body, price:price, tags:tags, images:images, ts:Date.now(), updatedAt:TS() });
  toast(kind==='product'?'상품이 등록되었습니다.':'포스트가 등록되었습니다.');
  await listMyItems(uid);
}
async function listMyItems(uid){
  var box=$('#agent-posts'); if(!box) return; box.innerHTML='<div class="muted">불러오는 중…</div>';
  try{
    var q=db.collection(COL.items).where('ownerUid','==', uid).orderBy('ts','desc').limit(50);
    var snap=await q.get(); await renderItemsSnap(snap, box);
  }catch(e){
    if(isIndexError(e)){
      var snap2=await db.collection(COL.items).where('ownerUid','==', uid).limit(50).get();
      var docs=snap2.docs.slice().sort(function(a,b){ return (b.data().ts||0)-(a.data().ts||0); });
      renderItemsDocs(docs, box);
      toast('인덱스가 없어 임시 정렬로 표시합니다. Firestore 인덱스를 생성해 주세요.');
    }else{ console.error(e); box.innerHTML='<div class="muted">목록 로드 오류</div>'; }
  }
}
async function renderItemsSnap(snap, box){ if(!snap||snap.empty){ box.innerHTML='<div class="muted">등록된 항목이 없습니다.</div>'; return; } renderItemsDocs(snap.docs, box); }
function renderItemsDocs(docs, box){
  var html=''; docs.forEach(function(doc){
    var d=doc.data()||{}, thumb=(d.images&&d.images.length)?d.images[0]:'https://placehold.co/600x360?text=No+Image';
    var right=(d.kind==='product')?((d.price!=null?d.price:'-')+' PAW'):'포스트';
    html+='<div class="row item-row"><img src="'+esc(thumb)+'" alt="" style="width:120px;height:72px;object-fit:cover;border-radius:8px"/><div class="col"><div class="row spread"><strong>'+esc(d.title||'')+'</strong><small class="muted">'+esc(right)+'</small></div><div class="muted small">'+esc((d.tags||[]).slice(0,5).join(', '))+'</div></div></div>';
  }); box.innerHTML=html;
}

/* ========== 13) 운영자 화면 ========== */
async function renderAdmin(){
  var box=$('#admin-agents'); if(box){
    try{
      var snap=await db.collection(COL.agents).orderBy('updatedAt','desc').limit(100).get();
      if(!snap.empty){
        box.innerHTML=snap.docs.map(function(doc){ var d=doc.data()||{}; return '<div class="row"><strong>'+esc(d.displayName||doc.id)+'</strong><span class="muted small">상태: '+esc(labelStatus(d.status))+'</span></div>'; }).join('');
      }else box.innerHTML='<div class="muted">대상 없음</div>';
    }catch(e){ box.innerHTML='<div class="muted">로드 오류</div>'; }
  }
  var btn=$('#btn-show-bigsister-applications');
  if(btn && !btn._bound){
    btn._bound=true;
    btn.addEventListener('click', async function(){
      var list=$('#bigSisterApplicationsList'); if(!list) return;
      try{
        var snap=await db.collection(COL.apps).orderBy('appliedAt','desc').limit(100).get();
        if(!snap.empty){
          list.innerHTML=snap.docs.map(function(doc){ var d=doc.data()||{}; return '<div class="row"><strong>'+esc(d.uid||doc.id)+'</strong><span class="muted small">상태: '+esc(d.status||'pending')+'</span></div>'; }).join('');
        }else list.innerHTML='<div class="muted">신청 내역이 없습니다.</div>';
      }catch(e){ list.innerHTML='<div class="muted">로드 오류</div>'; }
    });
  }
}

/* ========== 14) 라우트 렌더링 ========== */
async function renderRoute(){
  var r=hashRoute();
  $$('.view').forEach(function(v){ v.classList.add('hidden'); });

  var id = (r==='admin') ? 'view-admin' : ('view-'+r);
  var v=document.getElementById(id) || document.getElementById('view-home');
  if (v) v.classList.remove('hidden');

  if (r==='agent'){
    if (State.user){
      await loadAgentProfile(State.user);
      bindAgentConsoleEvents(State.user);
      await listMyItems(State.user.uid);
    } else {
      toast('로그인 후 이용해 주세요.');
    }
  } else if (r==='admin'){
    if (State.isAdmin) await renderAdmin();
    else { toast('운영자 전용입니다.'); routeTo('home'); }
  } else if (r==='home'){
    await renderHome();
  } else if (r==='search'){
    await renderSearch();
  }
}

/* ========== 15) 이벤트 바인딩 ========== */
function bindHeaderEvents(){
  var lg=$('#btn-google'); if(lg && !lg._bound){ lg._bound=true; lg.addEventListener('click', loginGoogle); }
  var lo=$('#btn-logout'); if(lo && !lo._bound){ lo._bound=true; lo.addEventListener('click', logout); }
  var wc=$('#btn-wallet'); if(wc && !wc._bound){ wc._bound=true; wc.addEventListener('click', connectWallet); }
}
function bindAgentConsoleEvents(user){
  var s=$('#agent-save'); if(s && !s._bound){ s._bound=true; s.addEventListener('click', function(){ saveAgentProfile(user); }); }
  var a=$('#agent-apply'); if(a && !a._bound){ a._bound=true; a.addEventListener('click', function(){ applyForAgent(user); }); }
  var c=$('#post-create'); if(c && !c._bound){ c._bound=true; c.addEventListener('click', function(){ createItem(user); }); }
  var l=$('#btn-list-posts'); if(l && !l._bound){ l._bound=true; l.addEventListener('click', function(){ listMyItems(user.uid); }); }
}

/* ========== 16) 인증 감시 → UI/권한/실시간 role 반영 ========== */
auth.onAuthStateChanged(async function(user){
  State.user=user||null;
  State.isAdmin=user ? (await computeIsAdmin(user)) : false;
  updateAuthUI();

  if (_unsubRole) { try { _unsubRole(); } catch(e){} _unsubRole=null; }
  if (user){
    _unsubRole = db.collection('users').doc(user.uid).onSnapshot(async function(){
      State.isAdmin = await computeIsAdmin(user);
      updateAuthUI();
      if (hashRoute()==='admin' && !State.isAdmin) routeTo('home');
    });
  }

  if (hashRoute()==='agent' && user){
    await loadAgentProfile(user);
    bindAgentConsoleEvents(user);
    await listMyItems(user.uid);
  }
});

/* ========== 17) 진입 ========== */
function ready(){
  bindHeaderEvents();
  handleRedirectResult().catch(console.warn); // 리다이렉트 폴백 결과 수신
  if (!location.hash) routeTo('home');
  renderRoute().catch(console.error);
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', ready); else ready();
