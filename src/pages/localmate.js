// /src/pages/localmate.js — 프로필(사진 업로드) + 상품 등록 + 블로그 URL(+YouTube 인식)
(() => {
  "use strict";

  // Firebase handles
  const auth = () => firebase.auth();
  const db = () => firebase.firestore();
  const storage = () => firebase.storage();

  // DOM utils
  const $ = (s, el=document) => el.querySelector(s);
  const setv = (s, v="") => { const n=$(s); if(n) n.value = v ?? ""; };
  const getv = (s) => { const n=$(s); return n ? (n.value ?? "").trim() : ""; };

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

    $country.innerHTML = `<option value="">나라선택</option>` +
      Object.keys(COUNTRIES).map(c=>`<option ${c===selCountry?'selected':''}>${c}</option>`).join('');
    const cities = COUNTRIES[selCountry] || [];
    $city.innerHTML = `<option value="">도시/지역 선택</option>` +
      cities.map(ct=>`<option ${ct===selCity?'selected':''}>${ct}</option>`).join('');

    $country.addEventListener('change', ()=>{
      const list = COUNTRIES[$country.value] || [];
      $city.innerHTML = `<option value="">도시/지역 선택</option>` + list.map(ct=>`<option>${ct}</option>`).join('');
    });
  }
  function populateTopics(selTopic){
    const $topic = $('#agent-topic'); if(!$topic) return;
    $topic.innerHTML = `<option value="">주제선택</option>` +
      TOPICS.map(t=>`<option ${t===selTopic?'selected':''}>${t}</option>`).join('');
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
        <div style="background:#111;color:#eee;padding:24px;border-radius:16px;width:min(420px,92%);box-shadow:0 8px 30px rgba(0,0,0,.5)">
          <div style="font-size:18px;font-weight:700;margin-bottom:8px">로그인이 필요합니다</div>
          <div class="muted" style="margin-bottom:16px">Google 계정으로 로그인 후 계속 진행됩니다.</div>
          <div class="row" style="display:flex;gap:8px;justify-content:flex-end">
            <button id="btn-cancel" class="btn outline" style="background:#222;border:1px solid #333;color:#ddd">닫기</button>
            <button id="btn-goog" class="btn" style="background:#4f46e5;border:0;color:#fff;border-radius:8px">Google로 로그인</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);
      const provider = new firebase.auth.GoogleAuthProvider();
      $('#btn-cancel').addEventListener('click', ()=>{ document.body.removeChild(wrap); reject(new Error('AUTH_CANCELLED')); });
      $('#btn-goog').addEventListener('click', async ()=>{
        sessionStorage.setItem('next_after_login', location.pathname + location.search);
        try{ await auth().signInWithPopup(provider); }
        catch(_){ await auth().signInWithRedirect(provider); return; }
        const u2 = auth().currentUser || await new Promise(r=>{ const un=auth().onAuthStateChanged(x=>{un(); r(x||null);}); });
        if (u2){ document.body.removeChild(wrap); resolve(u2); } else reject(new Error('AUTH_FAILED'));
      });
    });
  }

  // ===== 공통 유틸 =====
  const TIMEOUT_MS = 30000;
  function withTimeout(p, ms=TIMEOUT_MS, label="작업"){
    let t; const guard = new Promise((_,rej)=>{ t=setTimeout(()=>rej(new Error(`${label} 타임아웃`)), ms); });
    return Promise.race([p.finally(()=>clearTimeout(t)), guard]);
  }
  function toast(msg){
    let el = $('#toast');
    if(!el){
      el = document.createElement('div'); el.id='toast';
      Object.assign(el.style,{position:'fixed',left:'50%',bottom:'36px',transform:'translateX(-50%)',
        padding:'10px 14px',borderRadius:'10px',background:'rgba(0,0,0,.8)',color:'#fff',zIndex:9999,fontSize:'14px'});
      document.body.appendChild(el);
    }
    el.textContent = msg; el.style.opacity = 1; setTimeout(()=>{ el.style.opacity = 0; }, 2200);
  }
  const setBusy = (sel, on, txtOn="저장 중...") => { const b=$(sel); if(!b) return; b.disabled=!!on; b.textContent = on?txtOn:"저장"; };

  async function uploadToStorage(uid, folder, file, progressEl){
    if (!file) throw new Error("파일 없음");
    if (file.size > 20*1024*1024) throw new Error("파일이 20MB를 초과합니다");

    const clean = (file.name||"file").replace(/\s+/g,'_');
    const path  = `users/${uid}/${folder}/${Date.now()}_${clean}`;
    const ref   = storage().ref().child(path);
    const meta  = { contentType: file.type || 'application/octet-stream', cacheControl:'public,max-age=86400' };

    await withTimeout(new Promise((res, rej)=>{
      const task = ref.put(file, meta);
      task.on('state_changed', snap=>{
        if (progressEl && snap.totalBytes) {
          const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
          progressEl.textContent = `업로드 ${pct}%`;
        }
      }, rej, res);
    }), TIMEOUT_MS, '파일 업로드');

    const url = await withTimeout(ref.getDownloadURL(), 10000, '다운로드URL');
    if (progressEl) progressEl.textContent = '완료';
    return url;
  }

  // ===== YouTube 파서 =====
  function parseYouTube(urlStr){
    try{
      const u = new URL(urlStr);
      const host = u.hostname.replace(/^www\./,'');
      let vid = null;

      if (host === 'youtu.be') {
        // https://youtu.be/VIDEO_ID
        vid = u.pathname.split('/').filter(Boolean)[0] || null;
      } else if (host.endsWith('youtube.com')) {
        const p = u.pathname.replace(/\/+$/,'');
        if (p === '/watch') {
          vid = u.searchParams.get('v');
        } else if (p.startsWith('/shorts/')) {
          vid = p.split('/')[2];
        } else if (p.startsWith('/live/')) {
          vid = p.split('/')[2];
        } else if (p.startsWith('/embed/')) {
          vid = p.split('/')[2];
        }
        if (!vid) vid = u.searchParams.get('v');
      }
      if (!vid) return null;

      // 보편적 11자 패턴 확인(느슨 검증)
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
    auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(()=>{});
    const user = await ensureAuthUI();
    const uid  = user.uid;

    const status = $('#agent-status');
    if (status) status.textContent = `상태: 로그인 (${user.email || user.uid.slice(0,8)}…)`;

    // 내 agent 문서 로드
    const snap = await db().collection('agents').doc(uid).get();
    const d = snap.exists ? (snap.data() || {}) : {};

    populateCountryCity(d.country, d.city);
    populateTopics(d.topic);
    setv('#agent-name', d.displayName);
    setv('#agent-bio', d.bio);
    setv('#agent-contact', d.contact);
    setv('#agent-messenger', d.messenger);
    setv('#agent-wallet', d.wallet);
    setv('#agent-country', d.country);
    setv('#agent-city', d.city);
    setv('#agent-topic', d.topic);

    if (d.photoURL){
      const img = $('#agent-photo-preview');
      if (img){ img.src=d.photoURL; img.classList.remove('hidden'); img.style.display='block'; }
    }

    // 사진 선택 시 미리보기
    const fileEl = $('#agent-photo');
    fileEl?.addEventListener('change', ()=>{
      const f = fileEl.files?.[0]; if (!f) return;
      const url = URL.createObjectURL(f);
      const img = $('#agent-photo-preview');
      if (img){ img.src = url; img.classList.remove('hidden'); img.style.display='block'; }
    });

    // 블로그 URL 입력 시 YouTube 자동 감지 안내
    const blogUrlEl = $('#blog-url');
    blogUrlEl?.addEventListener('input', ()=>{
      const info = parseYouTube(getv('#blog-url'));
      if (info) {
        toast('유튜브 링크로 인식했어요. 썸네일/임베드가 함께 저장됩니다.');
      }
    });
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

    if(!displayName) return toast('이름은 필수입니다.');
    if(!country) return toast('나라를 선택해주세요.');
    if(!city) return toast('도시/지역을 선택해주세요.');
    if(!topic) return toast('주제(카테고리)를 선택해주세요.');

    setBusy('#agent-save', true); savingProfile = true;
    try{
      let photoURL = null;
      const f = $('#agent-photo')?.files?.[0] || null;
      if (f) photoURL = await uploadToStorage(uid, 'profile', f, $('#agent-photo-progress'));

      const ref = db().collection('agents').doc(uid);
      let existingStatus = null, exists=false;
      try{
        const snapCur = await ref.get();
        exists = snapCur.exists; existingStatus = exists ? (snapCur.data()?.status || null) : null;
      }catch(_){}

      const payload = {
        ownerUid: uid,
        displayName,bio,contact,messenger,wallet,country,city,topic,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      // 첫 저장이거나 status가 없으면 대기중으로 설정
      if (!exists || !existingStatus){ payload.status = 'pending'; }
      if (photoURL) payload.photoURL = photoURL;

      await withTimeout(ref.set(payload,{merge:true}), TIMEOUT_MS, '프로필 저장');

      if (photoURL){
        const img = $('#agent-photo-preview');
        if (img){ img.src = photoURL; img.classList.remove('hidden'); img.style.display='block'; }
      }
      toast('프로필 저장 완료');
    } catch(err){
      console.error(err);
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

    if (!title) return toast('상품명은 필수입니다.');
    if (!(price >= 0)) return toast('가격이 올바르지 않습니다.');

    const fThumb  = $('#product-thumb')?.files?.[0] || null;
    const fImages = Array.from($('#product-images')?.files || []);

    savingProduct = true; setBusy('#product-save', true, '상품 저장 중...');
    try{
      let thumbURL = null;
      const images = [];
      if (fThumb) thumbURL = await uploadToStorage(uid, 'items', fThumb, $('#product-thumb-progress'));
      for (const f of fImages){
        const url = await uploadToStorage(uid, 'items', f, $('#product-images-progress'));
        images.push(url);
      }

      const doc = {
        ownerUid: uid, title, body, tags, price,
        status: 'active',
        thumbURL: thumbURL || null,
        images,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };

      await withTimeout(db().collection('items').doc().set(doc), TIMEOUT_MS, '상품 저장');
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
    let parsed;
    try { new URL(url); parsed = parseYouTube(url); }
    catch { return toast('URL 형식이 올바르지 않습니다.'); }

    savingBlog = true; setBusy('#blog-save', true, '링크 저장 중...');
    try{
      const base = {
        ownerUid: uid,
        title, url, tags,
        status: 'published',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };

      let doc;
      if (parsed) {
        // YouTube로 저장
        doc = {
          ...base,
          type: 'youtube',
          provider: parsed.provider,
          videoId: parsed.videoId,
          embedURL: parsed.embedURL,
          thumbnailURL: parsed.thumbnailURL,
        };
      } else {
        // 일반 링크로 저장
        doc = { ...base, type: 'link' };
      }

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
      $('#agent-form')?.addEventListener('submit', onSaveProfile);
      $('#agent-save')?.addEventListener('click', (e)=>{ e.preventDefault(); $('#agent-form')?.requestSubmit?.(); });

      $('#product-form')?.addEventListener('submit', onSaveProduct);
      $('#product-save')?.addEventListener('click', (e)=>{ e.preventDefault(); $('#product-form')?.requestSubmit?.(); });

      $('#blog-form')?.addEventListener('submit', onSaveBlog);
      $('#blog-save')?.addEventListener('click', (e)=>{ e.preventDefault(); $('#blog-form')?.requestSubmit?.(); });
    } catch(e){
      if (String(e?.message||e).includes('AUTH_CANCELLED')) return;
      console.error(e);
    }
  });
})();
