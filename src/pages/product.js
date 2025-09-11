// src/pages/product.js
(() => {
  'use strict';

  if (!window.firebase || !window.firebaseConfig) {
    console.error('[product] Firebase SDK 또는 firebaseConfig 누락');
    return;
  }
  const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(window.firebaseConfig);
  const db = firebase.firestore();
  const storage = firebase.storage();

  const $details = document.getElementById('product-details');
  const PLACEHOLDER = 'https://placehold.co/1200x800?text=LocalMate';

  // ===== Utils (copied from home.js/search.js) =====
  const toText = (v) => (v == null ? '' : String(v));
  const escapeHtml = (s='') => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

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

  // ===== Product Detail Rendering =====
  async function renderProductDetails() {
    const productId = qs('id');
    if (!productId) {
      $details.innerHTML = '<div class="muted" style="padding:12px;">상품 ID를 찾을 수 없습니다.</div>';
      return;
    }

    $details.innerHTML = '<div class="muted" style="padding:12px;">상품 정보를 불러오는 중…</div>';

    try {
      const productRef = db.collection('products').doc(productId);
      const productDoc = await productRef.get();

      if (!productDoc.exists) {
        $details.innerHTML = '<div class="muted" style="padding:12px;">상품을 찾을 수 없습니다.</div>';
        return;
      }

      const d = productDoc.data();
      const title = d.title || d.name || '상품';
      const desc = toText(d.body || d.desc || d.description || ''); // Full description
      const price = d.price ? d.price.toLocaleString() + '원' : '가격 미정';

      const ownerName = toText(d.ownerName || d.owner || d.agentName).trim();
      const ownerHtml = ownerName ? `<div class="owner" style="margin-top:8px;font-style:italic;">판매자: ${escapeHtml(ownerName)}</div>` : '';

      const mainImage = d.thumbURL || (d.imageURLs && d.imageURLs[0]) || PLACEHOLDER;
      const otherImages = (d.imageURLs || []).slice(1);
      const otherImagesHtml = await Promise.all(otherImages.map(async url => `<img src="${await toImageURL(url)}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;">`)).then(arr => arr.join(''));

      const html = `
        <div class="product-detail-card card" style="padding:20px;margin-top:20px;">
          <h2 style="margin-top:0;">${escapeHtml(title)}</h2>
          <div class="main-image" style="margin-bottom:15px;">
            <img src="${await toImageURL(mainImage)}" alt="${escapeHtml(title)}" style="max-width:100%;height:auto;border-radius:12px;">
          </div>
          <div class="other-images" style="display:flex;gap:10px;margin-bottom:15px;">
            ${otherImagesHtml}
          </div>
          <p style="margin-bottom:15px;line-height:1.6;">${desc}</p>
          <div class="price" style="font-size:1.5em;font-weight:bold;margin-bottom:15px;">${price}</div>
          ${ownerHtml}
          <a href="javascript:history.back()" class="lm-btn" style="margin-top:20px;">뒤로가기</a>
        </div>
      `;
      $details.innerHTML = html;

    } catch (err) {
      console.error('[product] 상품 상세 로드 실패:', err);
      $details.innerHTML = `<div class="muted" style="padding:12px;">상품 정보를 불러오지 못했습니다: ${err.message}</div>`;
    }
  }

  document.addEventListener('DOMContentLoaded', renderProductDetails);
})();
