// src/pages/localmate.js — admin이 해시(#agentId)로 연 에이전트 프로필도 로딩/표시

import { $, ensureLayout, toast } from '../core.js';

"use strict";

if (!window.firebase || !window.firebaseConfig) {
  alert("Firebase 설정을 찾지 못했습니다. src/config.js → firebase-init.js 로드 순서를 확인하세요.");
  throw new Error("Firebase config not found");
}

// Firebase handles
const auth = () => firebase.auth();
const db   = () => firebase.firestore();

// 업로드 폴더 상수(스토리지 규칙과 정확히 일치!)
const PROFILE_FOLDER = "profile";   // users/<uid>/profile/...
const ITEM_FOLDER    = "products";  // users/<uid>/products/...

// App Check 확보 도우미
const ensureAppCheck = () => (window.ensureAppCheck ? window.ensureAppCheck() : Promise.resolve(null));

function getBucketRef() {
  if (typeof window.getBucketRef === "function") return window.getBucketRef();
  const bucket = (firebase.app().options && firebase.app().options.storageBucket) || window.firebaseConfig?.storageBucket;
  return bucket ? firebase.storage().refFromURL(`gs://${bucket}`) : firebase.storage().ref();
}

// ===== 해시 파싱 / 관리자 판별 =====
function getHashAgentId(){
  const h = (location.hash || "").replace(/^#/, '').trim();
  return h ? decodeURIComponent(h) : null;
}

async function isAdminUser(user){
  if (!user) return false;
  try {
    const t = await user.getIdTokenResult(true);
    if (t?.claims?.admin === true) return true;
  } catch(_) {}
  try {
    const s = await db().collection('users').doc(user.uid).get();
    if (s.exists && (s.data()?.role === 'admin')) return true;
  } catch(_) {}
  return false;
}

// ===== Dropdown data =====
const COUNTRIES = {
  Vietnam:  ["Hanoi","Da Nang","Ho Chi Minh City","Quang Binh • Dong Hoi"],
  Korea:    ["Seoul","Busan","Jeju"],
  Thailand: ["Bangkok","Chiang Mai","Phuket"],
};
const TOPICS = ["레저","문화","교육","음악","미술","사업","로맨틱","음식","자연","액티비티"];

function populateCountryCity(selCountry, selCity){
  const $country = $('#agent-country');
  const $city = $('#agent-city');
  if (!$country || !$city) return;

  // 1차 옵션 채우기
  $country.innerHTML = `<option value="">나라선택</option>` +
    Object.keys(COUNTRIES).map(c=>`<option ${c===selCountry?'selected':''} value="${c}">${c}</option>`).join('');

  const cities = COUNTRIES[selCountry] || [];
  $city.innerHTML = `<option value="">도시/지역 선택</option>` +
    cities.map(ct=>`<option ${ct===selCity?'selected':''} value="${ct}">${ct}</option>`).join('');

  // 변경 핸들러
  $country.onchange = ()=>{
    const list = COUNTRIES[$country.value] || [];
    $city.innerHTML = `<option value="">도시/지역 선택</option>` + list.map(ct=>`<option value="${ct}">${ct}</option>`).join('');
    const pv = $('#pv-city'); if (pv) pv.textContent = `${$country.value||''} ${$city.value||''}`.trim();
  };
  $city.onchange = ()=>{
    const pv = $('#pv-city'); if (pv) pv.textContent = `${$country.value||''} ${$city.value||''}`.trim();
  };
}

function populateTopics(selTopic){
  const $topic = $('#agent-topic'); if(!$topic) return;
  $topic.innerHTML = `<option value="">주제선택</option>` +
    TOPICS.map(t=>`<option ${t===selTopic?'selected':''} value="${t}">${t}</option>`).join('');
}

// ===== 공통 유틸 =====
const TIMEOUT_MS = 30000;
function withTimeout(p, ms=TIMEOUT_MS, label="작업"){
  let to; const guard = new Promise((_,rej)=>{ to=setTimeout(()=>rej(new Error(`${label} 타임아웃`)), ms); });
  return Promise.race([p.finally(()=>clearTimeout(to)), guard]);
}
const setBusy = (sel, on, txtOn="저장 중...") => { const b=$(sel); if(!b) return; b.disabled=!!on; b.textContent = on?txtOn:"저장"; };

// 로그인 대기(최대 15초). 로그인 UI는 프로젝트 공통 흐름에 맡김.
async function ensureAuthUI(timeoutMs = 15000) {
  const u0 = auth().currentUser;
  if (u0) return u0;
  return new Promise((res, rej) => {
    const started = Date.now();
    const off = auth().onAuthStateChanged((u) => {
      if (u) { off(); res(u); }
      else if (Date.now() - started > timeoutMs) { off(); rej(new Error('로그인이 필요합니다.')); }
    });
  });
}

// ===== 이미지 400x400 정사각 변환 =====
async function toSquare400(file){
  try{
    if (!file || !file.type || !file.type.startsWith('image/')) return file;
    const img = await new Promise((res, rej)=>{
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = ()=>{ URL.revokeObjectURL(url); res(im); };
      im.onerror = (e)=>{ URL.revokeObjectURL(url); rej(e); };
      im.src = url;
    });
    const side = 400;
    const canvas = document.createElement('canvas');
    canvas.width = side; canvas.height = side;
    const ctx = canvas.getContext('2d');

    const scale = Math.min(side / img.width, side / img.height);
    const nw = img.width * scale;
    const nh = img.height * scale;
    const nx = (side - nw) / 2;
    const ny = (side - nh) / 2;
    ctx.drawImage(img, nx, ny, nw, nh);

    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
    if (!blob) return file;
    return new File([blob], `sq400_${(file.name||'image').replace(/\.[^.]+$/,'')}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  }catch{
    return file;
  }
}

// ===== 업로드 =====
async function uploadToStorage(uid, folder, file, progressEl, opt = {}) {
  if (!file) throw new Error("파일 없음");
  if (file.size > 50 * 1024 * 1024) throw new Error("파일이 50MB를 초과합니다");

  const { square400 = false } = opt;
  if (square400) {
    if (progressEl) progressEl.textContent = '이미지 400x400 최적화 중…';
    file = await toSquare400(file);
  }

  const clean = (file.name || "file").replace(/\s+/g, '_');
  const path  = `users/${uid}/${folder}/${Date.now()}_${clean}`;

  const rootRef = getBucketRef();
  const ref = rootRef.child(path);

  // contentType 보정
  let ct = file.type;
  if (!ct || ct === 'application/octet-stream') {
    const lower = clean.toLowerCase();
    if (/\.(jpe?g)$/.test(lower)) ct = 'image/jpeg';
    else if (/\.png$/.test(lower)) ct = 'image/png';
    else if (/\.webp$/.test(lower)) ct = 'image/webp';
    else if (/\.gif$/.test(lower)) ct = 'image/gif';
    else if (/\.heic$/.test(lower) || /\.heif$/.test(lower)) ct = 'image/heic';
    else ct = 'image/jpeg';
  }
  const meta = { contentType: ct, cacheControl: 'public,max-age=604800' };

  try {
    await withTimeout(new Promise((res, rej) => {
      const task = ref.put(file, meta);
      task.on('state_changed', snap => {
        if (progressEl && snap.totalBytes) {
          const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
          progressEl.textContent = `업로드 ${pct}%`;
        }
      }, rej, res);
    }), TIMEOUT_MS, '파일 업로드');

    const url = await withTimeout(ref.getDownloadURL(), 12000, '다운로드URL');
    if (progressEl) progressEl.textContent = '완료';
    return url;
  } catch (e) {
    let hint = '';
    const code = e && (e.code || e.message || String(e));
    if (String(code).includes('appCheck') || String(code).includes('app-check')) {
      hint = 'App Check 토큰: firebase-init.js 활성화 + Allowed domains + 디버그 토큰 등록 확인';
    } else if (String(code).includes('CORS') || String(code).includes('net::ERR_FAILED')) {
      hint = 'CORS처럼 보이는 403: App Check 미통과일 확률 높음';
    } else if (String(code).includes('storage/unauthorized') || String(code).includes('storage/forbidden')) {
      hint = 'Storage 규칙/경로 검증: users/<uid>/** 와 request.auth.uid 일치 여부 확인';
    }
    if (progressEl) progressEl.textContent = '실패';
    console.error('uploadToStorage error:', e);
    throw new Error(`${code}${hint ? ' · ' + hint : ''}`);
  }
}

// ===== YouTube 파서 =====
function parseYouTube(urlStr){
  try{
    const u = new URL(urlStr);
    const host = u.hostname.replace(/^www\./,'');
    let vid = null;

    if (host === 'youtu.be') {
      vid = u.pathname.split('/').filter(Boolean)[0] || null;
    } else if (host.endsWith('youtube.com')) {
      const p = u.pathname.replace(/\/+$/,'');
      if (p === '/watch') vid = u.searchParams.get('v');
      else if (p.startsWith('/shorts/')) vid = p.split('/')[2];
      else if (p.startsWith('/live/'))   vid = p.split('/')[2];
      else if (p.startsWith('/embed/'))  vid = p.split('/')[2];
      if (!vid) vid = u.searchParams.get('v');
    }
    if (!vid) return null;
    if (!/^[a-zA-Z0-9_-]{6,}$/.test(vid)) return null;

    const embedURL = `https://www.youtube.com/embed/${vid}`;
    const thumbnailURL = `https://img.youtube.com/vi/${vid}/hqdefault.jpg`;
    return { provider:'youtube', videoId: vid, embedURL, thumbnailURL };
  } catch {
    return null;
  }
}

// ===== 저장 (프로필/상품/블로그) =====
let savingProfile=false, savingProduct=false, savingBlog=false;

// users/{uid}.walletAddress 동기화
async function syncWalletToUsers(uid, wallet) {
  try {
    if (!wallet) return;
    await db().collection('users').doc(uid).set(
      { walletAddress: wallet, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
  } catch (e) {
    console.warn('[localmate] syncWalletToUsers fail:', e);
  }
}

async function onSaveProfile(e){
  e?.preventDefault?.();
  if (savingProfile) return;
  const u = auth().currentUser || await ensureAuthUI();
  const uid = u.uid;

  const displayName = $('#agent-name')?.value?.trim() || '';
  const bio         = $('#agent-bio')?.value?.trim() || '';
  const contact     = $('#agent-contact')?.value?.trim() || '';
  const messenger   = $('#agent-messenger')?.value?.trim() || '';
  const wallet      = $('#agent-wallet')?.value?.trim() || '';
  const country     = $('#agent-country')?.value || '';
  const city        = $('#agent-city')?.value || '';
  const topic       = $('#agent-topic')?.value || '';
  const blogUrl     = $('#agent-blog-url')?.value?.trim() || '';
  const youtubeUrl  = $('#agent-youtube-url')?.value?.trim() || '';

  if(!displayName) return toast('이름은 필수입니다.');
  if(!country)     return toast('나라를 선택해주세요.');
  if(!city)        return toast('도시/지역을 선택해주세요.');
  if(!topic)       return toast('주제(카테고리)를 선택해주세요.');

  setBusy('#agent-save', true); savingProfile = true;

  try{
    await ensureAppCheck();

    const ref = db().collection('agents').doc(uid);
    const doc = await ref.get();

    let photoURL = null;
    const f = $('#agent-photo')?.files?.[0] || null;
    if (f) {
      try {
        photoURL = await uploadToStorage(uid, PROFILE_FOLDER, f, $('#agent-photo-progress'), { square400: true });
      } catch (e) {
        console.warn('사진 업로드 실패, 텍스트만 저장 진행:', e);
      }
    }

    const payload = {
      ownerUid: uid,
      displayName,
      name: displayName,
      bio, contact, messenger, wallet, country, city, topic,
      blogUrl, youtubeUrl,
      email: u.email || '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (!doc.exists) { payload.status = 'pending'; }
    if (photoURL) payload.photoURL = photoURL;

    await withTimeout(ref.set(payload,{merge:true}), TIMEOUT_MS, '프로필 저장');

    // 🔁 admin 화면 호환을 위해 users/{uid}.walletAddress 도 동기화
    if (wallet) { await syncWalletToUsers(uid, wallet); }

    // 안전 로컬 저장 (선택)
    try {
      if (typeof window.saveProfileToLocalStorage === 'function') {
        window.saveProfileToLocalStorage(payload);
      } else {
        localStorage.setItem('lm_agent_profile', JSON.stringify({
          displayName, bio, contact, messenger, wallet, country, city, topic,
          blogUrl, youtubeUrl,
          photoURL: photoURL || (doc.exists ? doc.data().photoURL : null),
          updatedAt: Date.now()
        }));
      }
    } catch (_) {}

    // 미리보기/배지 갱신
    $('#pv-name').textContent    = displayName || '로컬 메이트';
    $('#pv-topic').textContent   = topic || '주제없음';
    $('#pv-city').textContent    = `${country||''} ${city||''}`.trim();
    $('#pv-bio').textContent     = bio || '';
    $('#pv-contact').textContent = contact || '';
    $('#pv-contact-row')?.classList?.toggle('hidden', !contact);
    if (photoURL){
      const img = $('#agent-photo-preview');
      if (img){ img.src = photoURL; img.classList.remove('hidden'); img.style.display='block'; }
      const pv = $('#pv-photo'); if (pv) pv.src = photoURL;
    }
    $('#agent-approve-badge').textContent = `승인 상태: ${payload.status || doc.data()?.status || 'pending'}`;

    toast('프로필 저장 완료');
  } catch(err){
    console.error('onSaveProfile:', err);
    toast(`프로필 저장 실패: ${err?.code || ''} ${err?.message || err}`);
  } finally{
    savingProfile=false; setBusy('#agent-save', false);
  }
}

async function onSaveProduct(e){
  e?.preventDefault?.();
  if (savingProduct) return;
  const u = auth().currentUser || await ensureAuthUI();
  const uid = u.uid;

  const title = $('#product-title')?.value?.trim() || '';
  // 폼에 price 입력이 없는 경우를 대비해 0으로
  const priceInput = document.querySelector('#product-price');
  const price = priceInput ? Number(priceInput.value || 0) : 0;
  const tags  = ($('#product-tags')?.value || '').split(',').map(s=>s.trim()).filter(Boolean);
  const body  = $('#product-body')?.value || '';

  if (!title)       return toast('상품명은 필수입니다.');
  if (!(price >= 0)) return toast('가격이 올바르지 않습니다.');

  const fThumb  = $('#product-thumb')?.files?.[0] || null;
  const fImages = Array.from($('#product-images')?.files || []);

  savingProduct = true; setBusy('#product-save', true, '상품 저장 중...');
  try{
    await ensureAppCheck();

    let thumbURL = null;
    const imageURLs = [];
    if (fThumb) {
      thumbURL = await uploadToStorage(uid, ITEM_FOLDER, fThumb, $('#product-thumb-progress'));
    }
    for (const f of fImages){
      const url = await uploadToStorage(uid, ITEM_FOLDER, f, $('#product-images-progress'));
      imageURLs.push(url);
    }

    const now = firebase.firestore.FieldValue.serverTimestamp();
    const productId = $('#product-id')?.value || '';
    const productRef = productId
      ? db().collection('products').doc(productId)
      : db().collection('products').doc();

    let existingProduct = null;
    if (productId) {
      existingProduct = (await productRef.get()).data();
      if (existingProduct && existingProduct.ownerUid !== uid) {
        throw new Error('이 상품을 수정할 권한이 없습니다.');
      }
    }

    const doc = {
      ownerUid: uid,
      ownerName: u.displayName || '',
      title, body, tags, price,
      status: 'active',
      thumbURL: thumbURL || (existingProduct ? existingProduct.thumbURL : null),
      imageURLs: imageURLs.length > 0 ? imageURLs : (existingProduct ? existingProduct.imageURLs : []),
      images: imageURLs.length > 0 ? imageURLs : (existingProduct ? existingProduct.images : []),
      updatedAt: now,
    };
    if (!productId) { doc.createdAt = now; }

    await withTimeout(productRef.set(doc, {merge: true}), TIMEOUT_MS, '상품 저장');
    toast('상품 저장 완료');
    $('#product-form')?.reset();
    const p1 = $('#product-thumb-progress'); if (p1) p1.textContent = '';
    const p2 = $('#product-images-progress'); if (p2) p2.textContent = '';
  } catch(err){
    console.error(err);
    toast(`상품 저장 실패: ${err?.code || ''} ${err?.message || err}`);
  } finally{
    savingProduct=false; setBusy('#product-save', false);
  }
}

async function onSaveBlog(e){
  e?.preventDefault?.();
  if (savingBlog) return;
  const u = auth().currentUser || await ensureAuthUI();
  const uid = u.uid;

  const title = $('#blog-title')?.value?.trim() || '';
  const url   = $('#blog-url')?.value?.trim() || '';
  const tags  = ($('#blog-tags')?.value || '').split(',').map(s=>s.trim()).filter(Boolean);

  if (!title) return toast('제목은 필수입니다.');
  try { new URL(url); } catch { return toast('URL 형식이 올바르지 않습니다.'); }
  const parsed = parseYouTube(url);

  savingBlog = true; setBusy('#blog-save', true, '링크 저장 중...');
  try{
    await ensureAppCheck();

    const now = firebase.firestore.FieldValue.serverTimestamp();
    const base = {
      ownerUid: uid, title, url, tags,
      status: 'published',
      createdAt: now, updatedAt: now,
    };

    const doc = parsed ? {
      ...base,
      type: 'youtube',
      platform: 'youtube',
      youtubeId: parsed.videoId,
      embedURL: parsed.embedURL,
      thumbnailURL: parsed.thumbnailURL,
    } : {
      ...base,
      type: 'link',
      platform: 'blog'
    };

    await withTimeout(db().collection('blogLinks').doc().set(doc), TIMEOUT_MS, '링크 저장');
    toast(parsed ? '유튜브 링크 저장 완료' : '링크 저장 완료');
    $('#blog-form')?.reset();
  } catch(err){
    console.error(err);
    toast(`링크 저장 실패: ${err?.code || ''} ${err?.message || err}`);
  } finally{
    savingBlog=false; setBusy('#blog-save', false);
  }
}

// ===== Entry =====
async function loadPage() {
  try {
    await ensureLayout('localmate.html');

    const u = auth().currentUser || await ensureAuthUI();
    const uid = u.uid;

    const hashId = getHashAgentId();
    const admin  = await isAdminUser(u);
    const targetId = (hashId && admin) ? hashId : uid;   // 관리자 + 해시 → 해당 에이전트, 아니면 본인
    const isSelf = (targetId === uid);
    const canEdit = isSelf || admin;

    // Firestore에서 최신 데이터 로드
    let agentData = null;
    try {
      const snap = await db().collection('agents').doc(targetId).get();
      if (snap.exists) agentData = snap.data();
    } catch (error) {
      console.error('Error fetching agent info from Firebase:', error);
    }

    // 폼/프리뷰 채우기
    const setv = (sel, v="")=>{ const n=$(sel); if(n) n.value = v ?? ""; };
    if (agentData) {
      setv('#agent-name',        agentData.displayName);
      setv('#agent-bio',         agentData.bio);
      setv('#agent-contact',     agentData.contact);
      setv('#agent-messenger',   agentData.messenger);
      setv('#agent-wallet',      agentData.wallet);
      setv('#agent-blog-url',    agentData.blogUrl);
      setv('#agent-youtube-url', agentData.youtubeUrl);

      if (agentData.photoURL) {
        const img = $('#agent-photo-preview');
        if (img) { img.src = agentData.photoURL; img.classList.remove('hidden'); img.style.display = 'block'; }
        const pv = $('#pv-photo'); if (pv) pv.src = agentData.photoURL;
      }
      const badge = $('#agent-approve-badge');
      if (badge) badge.textContent = `승인 상태: ${agentData.status || 'pending'}`;

      populateCountryCity(agentData.country, agentData.city);
      populateTopics(agentData.topic);

      // 프리뷰 텍스트
      const pvName = $('#pv-name'); if (pvName) pvName.textContent = agentData.displayName || '로컬 메이트';
      const pvTopic = $('#pv-topic'); if (pvTopic) pvTopic.textContent = agentData.topic || '주제없음';
      const pvCity = $('#pv-city'); if (pvCity) pvCity.textContent = `${agentData.country||''} ${agentData.city||''}`.trim();
      const pvBio = $('#pv-bio'); if (pvBio) pvBio.textContent = agentData.bio || '';
      const pvContact = $('#pv-contact'); if (pvContact) pvContact.textContent = agentData.contact || '';
      $('#pv-contact-row')?.classList?.toggle('hidden', !agentData.contact);
    } else {
      // 데이터가 없더라도 드롭다운은 표시
      populateCountryCity('', '');
      populateTopics('');
    }

    // 타인 프로필 열람 시 편집 제어
    if (!canEdit) {
      // 입력/업로드/저장 비활성
      ['#agent-form input','#agent-form textarea','#agent-form select'].forEach(sel=>{
        document.querySelectorAll(sel).forEach(el=>el.disabled = true);
      });
      $('#agent-save')?.setAttribute('disabled','disabled');
      toast('읽기 전용 모드로 열람 중입니다.');
    } else if (!isSelf && admin) {
      toast('관리자 권한으로 편집 가능합니다.');
    }

    // 이벤트 바인딩
    $('#agent-form')?.addEventListener('submit', onSaveProfile);
    $('#agent-save')?.addEventListener('click', (e)=>{ e.preventDefault(); $('#agent-form')?.requestSubmit?.(); });

    $('#product-form')?.addEventListener('submit', onSaveProduct);
    $('#product-save')?.addEventListener('click', (e)=>{ e.preventDefault(); $('#product-form')?.requestSubmit?.(); });

    $('#blog-form')?.addEventListener('submit', onSaveBlog);
    $('#blog-save')?.addEventListener('click', (e)=>{ e.preventDefault(); $('#blog-form')?.requestSubmit?.(); });
  } catch (e) {
    console.error(e);
  }
}

document.addEventListener('DOMContentLoaded', loadPage);
