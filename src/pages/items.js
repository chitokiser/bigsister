// src/pages/items.js
(() => {
  'use strict';

  if (!window.firebase || !window.firebaseConfig) {
    console.error('[items] Firebase SDK 또는 firebaseConfig 누락');
    return;
  }
  const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(window.firebaseConfig);
  const db = firebase.firestore();
  const storage = firebase.storage();

  const $grid = document.getElementById('items-grid');
  const PLACEHOLDER = 'https://placehold.co/1200x800?text=LocalMate';

  const toText = (v) => (v == null ? '' : String(v));
  const truncate = (s, n=120) => (s && s.length > n ? s.slice(0, n-1) + '…' : s);
  const escapeHtml = (s='') => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  async function toImageURL(raw){
    try{
      const s = toText(raw).trim();
      if (!s) return PLACEHOLDER;
      if (/^https?:\/\//i.test(s) || /^data:image\//i.test(s)) return s;
      if (/^gs:\//i.test(s)) return await storage.refFromURL(s).getDownloadURL();
      return await storage.ref(s).getDownloadURL();
    }catch{ return PLACEHOLDER; }
  }

  async function renderAllItems() {
    if (!$grid) return;

    $grid.innerHTML = '<div class="muted" style="padding:12px">상품을 불러오는 중…</div>';

    const auth = firebase.auth();
    const currentUser = auth.currentUser;
    const currentUid = currentUser ? currentUser.uid : null;

    try {
      const snap = await db.collection('products').orderBy('createdAt', 'desc').limit(100).get();

      if (snap.empty) {
        $grid.innerHTML = '<div class="muted" style="padding:12px">등록된 상품이 없습니다.</div>';
        return;
      }

      const items = [];
      snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));

      const html = items.map(d => itemCard(d, currentUid)).join('');
      $grid.innerHTML = html;

      // Add event listeners for read more buttons
      $grid.querySelectorAll('.read-more-btn').forEach(button => {
        button.addEventListener('click', () => {
          const card = button.closest('.item-card');
          const truncated = card.querySelector('.truncated-desc');
          const full = card.querySelector('.full-desc');

          if (truncated.style.display !== 'none') {
            truncated.style.display = 'none';
            full.style.display = 'block';
            button.textContent = '간략히';
          } else {
            full.style.display = 'none';
            truncated.style.display = 'block';
            button.textContent = '더보기';
          }
        });
      });

    } catch (err) {
      console.error('[items] 상품 로드 실패:', err);
      $grid.innerHTML = `<div class="muted" style="padding:12px">상품을 불러오지 못했습니다: ${err.message}</div>`;
    }
  }

  document.addEventListener('DOMContentLoaded', renderAllItems);
})();

function itemCard(d, currentUid){
  const title = d.title || d.name || '상품';
  const sub   = [d.city || '', d.category || ''].filter(Boolean).join(' · ');
  const desc  = toText(d.body || d.desc || d.description || '');
  const truncatedDesc = truncate(desc, 120);
  const showReadMore = desc.length > 120;
  const price = d.price ? d.price.toLocaleString() + '원' : '가격 미정'; // Re-added definition

  const mainImage = d.thumbURL || (d.imageURLs && d.imageURLs[0]) || PLACEHOLDER;
  const otherImages = (d.imageURLs || []).slice(1);
  const otherImagesHtml = otherImages.map(url => `<img src="${url}" style="width:50px;height:50px;object-fit:cover;border-radius:8px;">`).join('');

  // 판매자(있을 때만 노출)
  const ownerName = toText(d.ownerName || d.owner || d.agentName).trim();
  const ownerHtml = ownerName ? `<div class="owner" style="margin-top:8px;font-style:italic;">판매자: ${escapeHtml(ownerName)}</div>` : '';

  // 링크 버튼들 (값 있을 때만 보임)
  const actions = [
    d.blogUrl    ? `<a href="${escapeHtml(d.blogUrl)}" target="_blank" rel="noopener" class="lm-btn">블로그</a>` : '',
    d.youtubeUrl ? `<a href="${escapeHtml(d.youtubeUrl)}" target="_blank" rel="noopener" class="lm-btn">YouTube</a>` : '',
    `<a href="product.html?id=${encodeURIComponent(d.id)}" class="lm-btn primary">상품상세보기</a>`
  ];

  // Edit button (only for owner)
  if (currentUid && d.ownerUid === currentUid) {
    actions.push(`<a href="agent.html?productId=${encodeURIComponent(d.id)}" class="lm-btn lm-btn-subtle">수정</a>`);
  }

  const linkHtml = `<div class="actions" style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:10px;">${actions.join('')}</div>`;

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
        `<p class="truncated-desc" style="margin-top:8px;">${truncatedDesc}</p>` +
        `<p class="full-desc" style="margin-top:8px; display:none;">${desc}</p>` +
        (showReadMore ? `<button class="lm-btn lm-btn-subtle read-more-btn" data-product-id="${d.id}">더보기</button>` : '') +
        `<div class="price" style="margin-top:8px;font-weight:bold;">${price}</div>` +
        linkHtml +
      '</div>' +
    '</article>'
  );
}
