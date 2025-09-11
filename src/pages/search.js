// src/pages/search.js
(() => {
  'use strict';

  if (!window.firebase || !window.firebaseConfig) {
    console.error('[search] Firebase SDK 또는 firebaseConfig 누락');
    return;
  }
  const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(window.firebaseConfig);
  const db = firebase.firestore();
  const storage = firebase.storage();

  const $grid = document.getElementById('search-grid') || document.getElementById('agent-grid') || document.body;
  const PLACEHOLDER = 'https://placehold.co/1200x800?text=LocalMate';

  const toText = (v) => (v == null ? '' : String(v));
  const truncate = (s, n=120) => (s && s.length > n ? s.slice(0, n-1) + '…' : s);
  const escapeHtml = (s='') => String(s).replace(/[&<>"\']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  async function toImageURL(raw){
    try{
      const s = toText(raw).trim();
      if (!s) return PLACEHOLDER;
      if (/^https?:\/\//i.test(s) || /^data:image\//i.test(s)) return s;
      if (/^gs:\/\//i.test(s)) return await storage.refFromURL(s).getDownloadURL();
      return await storage.ref(s).getDownloadURL();
    }catch{ return PLACEHOLDER; }
  }

  function qs(name){
    const u = new URL(location.href);
    return u.searchParams.get(name) || '';
  }

  function itemCard(d){
    const title = d.title || d.name || '상품';
    const sub   = [d.city || '', d.category || ''].filter(Boolean).join(' · ');
    const desc  = toText(d.body || d.desc || d.description || '');
    const price = d.price ? d.price.toLocaleString() + '원' : '가격 미정';

    // 판매자(있을 때만 노출)
    const ownerName = toText(d.ownerName || d.owner || d.agentName).trim();
    const ownerHtml = ownerName ? `<div class="owner" style="margin-top:8px;font-style:italic;">판매자: ${escapeHtml(ownerName)}</div>` : '';

    // 블로그/유튜브 URL 스키마 변동 대응
    const blogUrl    = toText(d.blogUrl || (d.links && (d.links.blog || d.links.blogUrl))).trim();
    const youtubeUrl = toText(d.youtubeUrl || (d.links && (d.links.youtube || d.links.youtubeUrl))).trim();

    // 버튼: 상품보기 · 블로그 · YouTube (※ 결제하기는 상세(product.html)에서)
  const actions = [
  `<a href="product.html?id=${encodeURIComponent(d.id)}" class="lm-btn">상품보기</a>`,
  d.blogUrl ? `<a href="${escapeHtml(d.blogUrl)}" target="_blank" rel="noopener" class="lm-btn">블로그</a>` : '',
  d.youtubeUrl ? `<a href="${escapeHtml(d.youtubeUrl)}" target="_blank" rel="noopener" class="lm-btn">YouTube</a>` : ''
].filter(Boolean).join('');
const linkHtml = `<div class="actions" style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:10px;">${actions}</div>`;



    // 이미지
    const mainImage = d.thumbURL || (d.imageURLs && d.imageURLs[0]) || PLACEHOLDER;
    const otherImages = (d.imageURLs || []).slice(1);
    const otherImagesHtml = otherImages.map(url => `<img src="${url}" style="width:50px;height:50px;object-fit:cover;border-radius:8px;">`).join('');

    return (
      '<article class="card item-card">' +
        '<div class="media" style="background:#13161f;overflow:hidden;border-top-left-radius:16px;border-top-right-radius:16px;width:200px;height:200px;">' +
          `<img src="${mainImage}" alt="${escapeHtml(title)}" onerror="this.src='${PLACEHOLDER}'" ` +
          'style="width:100%;height:100%;display:block;object-fit:cover;object-position:center;" />' +
        '</div>' +
        '<div class="content">' +
          `<h3>${escapeHtml(title)}</h3>` +
          `<div class="muted" style="margin-top:2px">${escapeHtml(sub)}</div>` +
          ownerHtml +
          `<div class="sub-images" style="display:flex;gap:.5rem;margin-top:8px;">${otherImagesHtml}</div>` +
          `<p style="margin-top:8px">${escapeHtml(truncate(desc, 120))}</p>` +
          `<div class="price" style="margin-top:8px;font-weight:bold;">${price}</div>` +
          linkHtml +
        '</div>' +
      '</article>'
    );
  }

  async function render(){
    const agent = qs('agent');           // ⭐ home에서 넘겨준 uid
    const q     = qs('q');

    let html = '<div class="muted" style="padding:12px">불러오는 중…</div>';
    $grid.innerHTML = html;

    // 에이전트별 상품 보기 우선
    if (agent) {
      // 스키마 다양성 대비: agentId / ownerUid / uid
      let snap = await db.collection('products').where('agentId','==',agent).limit(60).get()
        .catch(()=>null);
      if (!snap || snap.empty) {
        snap = await db.collection('products').where('ownerUid','==',agent).limit(60).get()
          .catch(()=>null);
      }
      if (!snap || snap.empty) {
        snap = await db.collection('products').where('uid','==',agent).limit(60).get()
          .catch(()=>null);
      }
      if (!snap || snap.empty) {
        $grid.innerHTML = '<div class="muted" style="padding:12px">이 메이트가 등록한 상품이 없습니다.</div>';
        return;
      }
      const items = []; snap.forEach(doc=>items.push({ id: doc.id, ...doc.data() }));
      html = items.map(d => itemCard(d)).join('');
      $grid.innerHTML = html;
      return;
    }

    // 일반 검색
    if (q) {
      let snap = await db.collection('products').where('keywords','array-contains', q.toLowerCase()).limit(60).get()
        .catch(()=>null);
      if (!snap || snap.empty) {
        // 최신순 60개
        snap = await db.collection('products').orderBy('createdAt','desc').limit(60).get()
          .catch(()=>null);
      }
      if (!snap || snap.empty) {
        $grid.innerHTML = '<div class="muted" style="padding:12px">검색 결과가 없습니다.</div>';
        return;
      }
      const items = []; snap.forEach(doc=>items.push({ id: doc.id, ...doc.data() }));
      html = items.map(d => itemCard(d)).join('');
      $grid.innerHTML = html;
      return;
    }

    // 파라미터 없음: 최신 상품
    let snap = await db.collection('products').orderBy('createdAt','desc').limit(60).get()
      .catch(()=>null);
    if (!snap || snap.empty) {
      $grid.innerHTML = '<div class="muted" style="padding:12px">표시할 상품이 없습니다.</div>';
      return;
    }
    const items = []; snap.forEach(doc=>items.push({ id: doc.id, ...doc.data() }));
    html = items.map(d => itemCard(d)).join('');
    $grid.innerHTML = html;
  }

  document.addEventListener('DOMContentLoaded', render);
})();
