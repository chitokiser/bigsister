import { ensureLayout, toast } from '../core.js';

"use strict";

if (!window.firebase || !window.firebaseConfig) {
  alert("Firebase 설정을 찾지 못했습니다. src/config.js → firebase-init.js 로드 순서를 확인하세요.");
  throw new Error("Firebase config not found");
}

// Firebase handles
const auth = () => firebase.auth();
const db   = () => firebase.firestore();

// 업로드 폴더 상수(스토리지 규칙과 정확히 일치!)
const PROFILE_FOLDER = "profile"; // users/<uid>/profile/...
const ITEM_FOLDER    = "products";   // users/<uid>/items/...

// DOM utils
const $    = (s, el=document) => el.querySelector(s);
const setv = (s, v="") => { const n=$(s); if(n) n.value = v ?? ""; };
const getv = (s) => { const n=$(s); return n ? (n.value ?? "").trim() : ""; };


// ⬇️ localmate.js 최상단 유틸 근처에 배치
const ensureAppCheck = () => (window.ensureAppCheck ? window.ensureAppCheck() : Promise.resolve(null));




function getBucketRef() {
  if (typeof window.getBucketRef === "function") return window.getBucketRef();
  const bucket = (firebase.app().options && firebase.app().options.storageBucket) || window.firebaseConfig?.storageBucket;
  return bucket ? firebase.storage().refFromURL(`gs://${bucket}`) : firebase.storage().ref();
}

// Dropdown data
const COUNTRIES = {
  Vietnam:["Hanoi","Da Nang","Ho Chi Minh City","Quang Binh • Dong Hoi"],
  Korea:["Seoul","Busan","Jeju"],
  Thailand:["Bangkok","Chiang Mai","Phuket"],
};
const TOPICS = ["레저","문화","교육","음악","미술","사업","로맨틱","음식","자연","액티비티"];

function populateCountryCity(selCountry, selCity){
  const $country = $('#agent-country');
  const $city = $('#agent-city');
  if (!$country || !$city) return;

  // 1차: 즉시 채우기
  $country.innerHTML = `<option value="">나라선택</option>` +
    Object.keys(COUNTRIES).map(c=>`<option ${c===selCountry?'selected':''} value="${c}">${c}</option>`).join('');

  const cities = COUNTRIES[selCountry] || [];
  $city.innerHTML = `<option value="">도시/지역 선택</option>` +
    cities.map(ct=>`<option ${ct===selCity?'selected':''} value="${ct}">${ct}</option>`).join('');

  // 변경 핸들러
  $country.onchange = ()=>{
    const list = COUNTRIES[$country.value] || [];
    $city.innerHTML = `<option value="">도시/지역 선택</option>` + list.map(ct=>`<option value="${ct}">${ct}</option>`).join('');
    $('#pv-city').textContent = `${$country.value||''} ${$city.value||''}`.trim();
  };
  $city.onchange = ()=>{
    $('#pv-city').textContent = `${$country.value||''} ${$city.value||''}`.trim();
  };
}
function populateTopics(selTopic){
  const $topic = $('#agent-topic'); if(!$topic) return;
  $topic.innerHTML = `<option value="">주제선택</option>` +
    TOPICS.map(t=>`<option ${t===selTopic?'selected':''} value="${t}">${t}</option>`).join('');
}

// ===== Auth overlay (로그인 보장) =====
function ensureAuthUI(){
  return new Promise(async (resolve, reject)=>{
    try{ await auth().getRedirectResult(); }catch(_){}
    if (auth().currentUser) return resolve(auth().currentUser);
    const u = await new Promise(r=>{ const un=auth().onAuthStateChanged(x=>{un(); r(x||null);});});
    if (u) return resolve(u);

    const wrap = document.createElement('div');
    Object.assign(wrap.style,{position:'fixed',inset:'0',background:'rgba(0,0,0,.6)',display:'grid',placeItems:'center',zIndex:99999});
    wrap.innerHTML = `
      <div style="background:#111;color:#eee;padding:24px;border-radius:16px;width:min(460px,92%);box-shadow:0 8px 30px rgba(0,0,0,.5)">
        <div style="font-size:18px;font-weight:700;margin-bottom:8px">로그인이 필요합니다</div>
        <div class="muted" style="margin-bottom:16px">Google 또는 이메일/비밀번호로 로그인 후 계속됩니다.</div>
        <div class="row" style="display:flex;gap:8px;justify-content:flex-end">
          <a id="btn-email" class="btn outline" style="background:#222;border:1px solid #333;color:#ddd;text-decoration:none">이메일 로그인</a>
          <button id="btn-goog" class="btn" style="background:#4f46e5;border:0;color:#fff;border-radius:8px">Google로 로그인</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const provider = new firebase.auth.GoogleAuthProvider();
    $('#btn-email').onclick = ()=>{
      sessionStorage.setItem('next_after_login', location.pathname + location.search);
      location.href = `login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    };
    $('#btn-goog').onclick = async ()=>{
      sessionStorage.setItem('next_after_login', location.pathname + location.search);
      try{ await auth().signInWithPopup(provider); }
      catch(_){ await auth().signInWithRedirect(provider); return; }
      const u2 = auth().currentUser || await new Promise(r=>{ const un=auth().onAuthStateChanged(x=>{un(); r(x||null);}); });
      if (u2){ document.body.removeChild(wrap); resolve(u2); } else reject(new Error('AUTH_FAILED'));
    };
  });
}

// ===== 공통 유틸 =====
const TIMEOUT_MS = 30000;
function withTimeout(p, ms=TIMEOUT_MS, label="작업"){
  let to; const guard = new Promise((_,rej)=>{ to=setTimeout(()=>rej(new Error(`${label} 타임아웃`)), ms); });
  return Promise.race([p.finally(()=>clearTimeout(to)), guard]);
}
const setBusy = (sel, on, txtOn="저장 중...") => { const b=$(sel); if(!b) return; b.disabled=!!on; b.textContent = on?txtOn:"저장"; };

// ===== 이미지 400x400 정사각 변환 (중앙 크롭) =====
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
    return file; // 실패 시 원본 업로드
  }
}

// ===== 업로드 (규칙과 정확히 일치: users/<uid>/<folder>/...) =====
async function uploadToStorage(uid, folder, file, progressEl, opt = {}) {
  // App Check 토큰은 호출하는 쪽(onSaveProfile 등)에서 이미 확보했으므로 중복 호출을 제거합니다.
  // await ensureAppCheck();

  if (!file) throw new Error("파일 없음");
  if (file.size > 50 * 1024 * 1024) throw new Error("파일이 50MB를 초과합니다");

  const { square400 = false } = opt;
  if (square400) {
    if (progressEl) progressEl.textContent = '이미지 400x400 최적화 중…';
    file = await toSquare400(file);
  }

  const clean = (file.name || "file").replace(/\s+/g, '_');
  const path  = `users/${uid}/${folder}/${Date.now()}_${clean}`; // 규칙과 동일

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
      hint = 'CORS처럼 보이는 403: App Check 미통과일 확률 높음 (콘솔 로그/설정 확인)';
    } else if (String(code).includes('storage/unauthorized') || String(code).includes('storage/forbidden')) {
      hint = 'Storage 규칙/경로 검증: users/<uid>/** 와 request.auth.uid 일치해야 함';
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

// ===== 페이지 로드 =====
async function loadPage(){
  await ensureLayout('agent.html');

  // 드롭다운은 즉시 1차 채우기 (로그인/네트워크 실패해도 선택 가능)
  populateCountryCity("", "");
  populateTopics("");

  auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(()=>{});

  // App Check 토큰 확보(읽기 전)
  await ensureAppCheck();

  const user = await ensureAuthUI();
  const uid  = user.uid;

  const status = $('#agent-status');
  if (status) status.textContent = `상태: 로그인 (${user.email || user.uid.slice(0,8)}…)`;

  // 미리보기 기본 값
  $('#pv-email').textContent = user.email || '';

  // 내 agent 문서 로드 (App Check 토큰 확보 후)
  let d = {};
  try {
    const snap = await db().collection('agents').doc(uid).get();
    d = snap.exists ? (snap.data() || {}) : {};
  } catch (e) {
    console.warn("[home] 에이전트 로드 실패:", e);
    toast("저장된 프로필을 불러오지 못했습니다. (App Check/권한 설정 확인)");
  }

  // 저장값 반영(2차 주입)
  populateCountryCity(d.country || "", d.city || "");
  populateTopics(d.topic || "");
  setv('#agent-name', d.displayName || d.name || '');
  setv('#agent-bio', d.bio || '');
  setv('#agent-contact', d.contact || '');
  setv('#agent-messenger', d.messenger || '');
  setv('#agent-wallet', d.wallet || '');
  setv('#agent-country', d.country || '');
  setv('#agent-city', d.city || '');
  setv('#agent-topic', d.topic || '');
  setv('#agent-blog-url', d.blogUrl || '');
  setv('#agent-youtube-url', d.youtubeUrl || '');

  // 미리보기 반영
  $('#pv-name').textContent    = d.name || d.displayName || user.displayName || '로컬 메이트';
  $('#pv-topic').textContent   = d.topic || '주제없음';
  $('#pv-city').textContent    = `${d.country||''} ${d.city||''}`.trim();
  $('#pv-bio').textContent     = d.bio || '';
  $('#pv-contact').textContent = d.contact || '';
  $('#pv-contact-row').classList.toggle('hidden', !d.contact);

  const badge = $('#agent-approve-badge');
  if (badge) badge.textContent = `승인 상태: ${d.status || 'pending'}`;

  if (d.photoURL){
    const img = $('#agent-photo-preview');
    if (img){ img.src=d.photoURL; img.classList.remove('hidden'); img.style.display='block'; }
    $('#pv-photo').src = d.photoURL;
  }

  // 사진 선택 시 미리보기
  const fileEl = $('#agent-photo');
  fileEl?.addEventListener('change', ()=>{
    const f = fileEl.files?.[0]; if (!f) return;
    const url = URL.createObjectURL(f);
    const img = $('#agent-photo-preview');
    if (img){ img.src = url; img.classList.remove('hidden'); img.style.display='block'; }
    $('#pv-photo').src = url;
  });

  // 블로그 URL 입력 시 YouTube 자동 감지 안내
  const blogUrlEl = $('#blog-url');
  blogUrlEl?.addEventListener('input', ()=>{
    const info = parseYouTube(getv('#blog-url'));
    if (info) toast('유튜브 링크로 인식했어요. 썸네일/임베드가 함께 저장됩니다.');
  });

  // 미리보기 버튼 링크 (내 소유 항목 필터링)
  $('#pv-btn-items').href   = `search.html?owner=${encodeURIComponent(uid)}&tab=items`;
  $('#pv-btn-blog').href    = `search.html?owner=${encodeURIComponent(uid)}&tab=blog`;
  $('#pv-btn-youtube').href = `search.html?owner=${encodeURIComponent(uid)}&tab=youtube`;

  // 상품 수정 모드
  const urlParams = new URLSearchParams(window.location.search);
  const editProductId = urlParams.get('productId');
  if (editProductId) {
    $('#product-form-title').textContent = '상품 수정';
    setv('#product-id', editProductId);
    try {
      const productSnap = await db().collection('products').doc(editProductId).get();
      if (productSnap.exists) {
        const p = productSnap.data();
        if (p.ownerUid !== uid) {
          toast('이 상품을 수정할 권한이 없습니다.');
          $('#product-form').style.display = 'none'; // Hide form if not owner
          return;
        }
        setv('#product-title', p.title || '');
        setv('#product-price', p.price || 0);
        setv('#product-tags', (p.tags || []).join(', '));
        setv('#product-body', p.body || '');
        // For thumb and images, we don't pre-fill file inputs for security
        // but we could show current image previews if needed.
      } else {
        toast('수정할 상품을 찾을 수 없습니다.');
        $('#product-form').style.display = 'none';
      }
    } catch (e) {
      console.error('상품 로드 실패:', e);
      toast('상품 로드 실패: ' + e.message);
      $('#product-form').style.display = 'none';
    }
  }
}

// ===== 저장 (프로필) =====
let savingProfile=false, savingProduct=false, savingBlog=false;

async function onSaveProfile(e){
  e?.preventDefault?.();
  if (savingProfile) return;
  const u = auth().currentUser || await ensureAuthUI();
  const uid = u.uid;

  const displayName = getv('#agent-name');
  const bio = getv('#agent-bio');
  const contact = getv('#agent-contact');
  const messenger = getv('#agent-messenger');
  const wallet = getv('#agent-wallet');
  const country = getv('#agent-country');
  const city = getv('#agent-city');
  const topic = getv('#agent-topic');
  const blogUrl = getv('#agent-blog-url');
  const youtubeUrl = getv('#agent-youtube-url');

  if(!displayName) return toast('이름은 필수입니다.');
  if(!country)     return toast('나라를 선택해주세요.');
  if(!city)        return toast('도시/지역을 선택해주세요.');
  if(!topic)       return toast('주제(카테고리)를 선택해주세요.');

  setBusy('#agent-save', true); savingProfile = true;

  try{
    // 업로드 전 App Check 토큰 확보
    await ensureAppCheck();

    let photoURL = null;
    const f = $('#agent-photo')?.files?.[0] || null;
    if (f) photoURL = await uploadToStorage(uid, PROFILE_FOLDER, f, $('#agent-photo-progress'), { square400:true });

    const ref = db().collection('agents').doc(uid);
    let existingStatus = null, exists=false;
    try{
      const snapCur = await ref.get();
      exists = snapCur.exists; existingStatus = exists ? (snapCur.data()?.status || null) : null;
    }catch(_){}

    const payload = {
      ownerUid: uid,
      displayName,
      name: displayName,
      bio, contact, messenger, wallet, country, city, topic,
      blogUrl, youtubeUrl,
      email: u.email || '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (!exists || !existingStatus){ payload.status = 'pending'; }
    if (photoURL) payload.photoURL = photoURL;

    await withTimeout(ref.set(payload,{merge:true}), TIMEOUT_MS, '프로필 저장');

    // 미리보기/배지 갱신
    $('#pv-name').textContent    = displayName || '로컬 메이트';
    $('#pv-topic').textContent   = topic || '주제없음';
    $('#pv-city').textContent    = `${country||''} ${city||''}`.trim();
    $('#pv-bio').textContent     = bio || '';
    $('#pv-contact').textContent = contact || '';
    $('#pv-contact-row').classList.toggle('hidden', !contact);
    if (photoURL){
      const img = $('#agent-photo-preview');
      if (img){ img.src = photoURL; img.classList.remove('hidden'); img.style.display='block'; }
      $('#pv-photo').src = photoURL;
    }
    $('#agent-approve-badge').textContent = `승인 상태: ${payload.status || 'pending'}`;

    toast('프로필 저장 완료');
    toast(`저장된 블로그 URL: ${blogUrl || '없음'}, 유튜브 URL: ${youtubeUrl || '없음'}`);
  } catch(err){
    console.error('onSaveProfile:', err);
    toast(`프로필 저장 실패: ${err?.code || ''} ${err?.message || err}`);
  } finally{
    savingProfile=false; setBusy('#agent-save', false);
  }
}

// ===== 저장 (상품) =====
async function onSaveProduct(e){
  e?.preventDefault?.();
  if (savingProduct) return;
  const u = auth().currentUser || await ensureAuthUI();
  const uid = u.uid;

  const title = getv('#product-title');
  const price = Number(getv('#product-price') || 0);
  const tags  = getv('#product-tags').split(',').map(s=>s.trim()).filter(Boolean);
  const body  = getv('#product-body');

  if (!title)      return toast('상품명은 필수입니다.');
  if (!(price >=0)) return toast('가격이 올바르지 않습니다.');

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
    const productId = getv('#product-id'); // Get product ID from hidden input
    const productRef = db().collection('products').doc(productId || undefined);

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
      images: imageURLs.length > 0 ? imageURLs : (existingProduct ? existingProduct.images : []), // 레거시 호환
      updatedAt: now,
    };
    if (!productId) { doc.createdAt = now; }

    await withTimeout(productRef.set(doc, {merge: true}), TIMEOUT_MS, '상품 저장');
    toast('상품 저장 완료');
    $('#product-form')?.reset();
    $('#product-thumb-progress').textContent = '';
    $('#product-images-progress').textContent = '';
  } catch(err){
    console.error(err);
    toast(`상품 저장 실패: ${err?.code || ''} ${err?.message || err}`);
  } finally{
    savingProduct=false; setBusy('#product-save', false);
  }
}

// ===== 저장 (블로그 URL/유튜브) =====
async function onSaveBlog(e){
  e?.preventDefault?.();
  if (savingBlog) return;
  const u = auth().currentUser || await ensureAuthUI();
  const uid = u.uid;

  const title = getv('#blog-title');
  const url   = getv('#blog-url');
  const tags  = getv('#blog-tags').split(',').map(s=>s.trim()).filter(Boolean);

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

// Entry
document.addEventListener('DOMContentLoaded', async ()=>{
  try{
    await loadPage();

    // 폼/버튼 이벤트
    $('#agent-form')?.addEventListener('submit', onSaveProfile);
    $('#agent-save')?.addEventListener('click', (e)=>{ e.preventDefault(); $('#agent-form')?.requestSubmit?.(); });

    $('#product-form')?.addEventListener('submit', onSaveProduct);
    $('#product-save')?.addEventListener('click', (e)=>{ e.preventDefault(); $('#product-form')?.requestSubmit?.(); });

    $('#blog-form')?.addEventListener('submit', onSaveBlog);
    $('#blog-save')?.addEventListener('click', (e)=>{ e.preventDefault(); $('#blog-form')?.requestSubmit?.(); });
  } catch(e){
    console.error(e);
  }
});
