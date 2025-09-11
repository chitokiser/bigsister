// src/pages/home.js
(() => {
  'use strict';

  if (!window.firebase || !window.firebaseConfig) {
    console.error('[home] Firebase SDK 또는 firebaseConfig 누락. src/config.js 확인하세요.');
    return;
  }
  const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(window.firebaseConfig);
  const db = firebase.firestore();
  const storage = firebase.storage();

  // ===== DOM =====
  const $q = document.getElementById('home-q');
  const $qLink = document.getElementById('home-q-link');
  const $agentGrid  = document.getElementById('agent-grid');
  const $agentEmpty = document.getElementById('agent-empty');
  const $agentError = document.getElementById('agent-error');
  const $regionGrid  = document.getElementById('region-grid');
  const $regionEmpty = document.getElementById('region-empty');
  const $regionError = document.getElementById('region-error');
  const $noticeList  = document.getElementById('notice-list');
  const $noticeEmpty = document.getElementById('notice-empty');
  const $noticeError = document.getElementById('notice-error');

  // Rating Modal HTML
  const RATING_MODAL_HTML = `
    <div id="rating-modal-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;place-items:center;z-index:99999;">
      <div style="background:#111;color:#eee;padding:24px;border-radius:16px;width:min(460px,92%);box-shadow:0 8px 30px rgba(0,0,0,.5);">
        <h3 style="margin:0 0 10px 0;">메이트 평점 남기기</h3>
        <div id="modal-agent-name" style="font-weight:bold;margin-bottom:10px;"></div>
        <div id="modal-star-rating" style="display:flex;gap:5px;font-size:2em;justify-content:center;margin-bottom:15px;">
          <span class="modal-star" data-value="1">★</span>
          <span class="modal-star" data-value="2">★</span>
          <span class="modal-star" data-value="3">★</span>
          <span class="modal-star" data-value="4">★</span>
          <span class="modal-star" data-value="5">★</span>
        </div>
        <button id="modal-submit-rating" class="btn" style="width:100%;">평점 제출</button>
        <button id="modal-close-rating" class="btn subtle" style="width:100%;margin-top:10px;">닫기</button>
      </div>
    </div>
  `;

  // Contact Modal HTML
  const CONTACT_MODAL_HTML = `
    <div id="contact-modal-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;place-items:center;z-index:99999;">
      <div style="background:#111;color:#eee;padding:24px;border-radius:16px;width:min(460px,92%);box-shadow:0 8px 30px rgba(0,0,0,.5);">
        <h3 style="margin:0 0 10px 0;">메이트 연락처 정보</h3>
        <div style="margin-bottom:10px;">
          <div style="font-weight:bold;">이름: <span id="contact-modal-name"></span></div>
          <div style="margin-top:5px;">전화번호: <span id="contact-modal-phone"></span></div>
          <div style="margin-top:5px;">messenger: <span id="contact-modal-sns"></span></div>
          <div style="margin-top:5px;">이메일: <span id="contact-modal-email"></span></div>
        </div>
        <button id="contact-modal-close" class="btn subtle" style="width:100%;">닫기</button>
      </div>
    </div>
  `;

  // Append modals to body once
  document.addEventListener('DOMContentLoaded', () => {
    document.body.insertAdjacentHTML('beforeend', RATING_MODAL_HTML);
    document.body.insertAdjacentHTML('beforeend', CONTACT_MODAL_HTML);
  });

  // ===== Utils =====
  const PLACEHOLDER = 'https://placehold.co/1200x800?text=LocalMate';
  const toText = (v) => (v == null ? '' : String(v));
  const truncate = (s, n=120) => (s && s.length > n ? s.slice(0, n-1) + '…' : s);
  const escapeHtml = (s='') => String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  const normalizeUrl = (u) => {
    const s = toText(u).trim();
    if (!s) return '';
    return /^https?:\/\//i.test(s) ? s : `https://${s}`;
  };
  const isValidHttpUrl = (u) => {
    if (!u) return false;
    try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:'; }
    catch { return false; }
  };

  async function toImageURL(raw) {
    try {
      const s = toText(raw).trim();
      if (!s) return PLACEHOLDER;
      if (/^https?:\/\//i.test(s) || /^data:image\//i.test(s)) return s;
      if (/^gs:\/\//i.test(s)) return await storage.refFromURL(s).getDownloadURL();
      return await storage.ref(s).getDownloadURL(); // storage 상대경로
    } catch (err) {
      console.warn('[home] 이미지 URL 변환 실패:', raw, err);
      return PLACEHOLDER;
    }
  }

  // Firestore -> 화면에서 쓰기 좋은 에이전트 객체로 정규화
  function normAgent(doc) {
    const d = doc.data();
    const blogUrlRaw    = d.blogUrl ?? d.blog ?? d.links?.blog ?? d.links?.blogUrl ?? '';
    const youtubeUrlRaw = d.youtubeUrl ?? d.youtube ?? d.links?.youtube ?? d.links?.youtubeUrl ?? '';
    const blogUrl    = normalizeUrl(blogUrlRaw);
    const youtubeUrl = normalizeUrl(youtubeUrlRaw);

    return {
      id: doc.id, // ⭐ 상품보기 링크에 필요
      name: d.displayName || d.name || d.title || '이름 미정',
      city: d.city || d.region || (d.location && (d.location.city || d.location.name)) || '',
      topic: d.topic || d.category || '',
      bio:  toText(d.bio || d.description || ''),
      photoRaw: d.photoURL || d.photo || d.imageUrl || d.photoPath || d.image || '',
      blogUrl: isValidHttpUrl(blogUrl) ? blogUrl : '',
      youtubeUrl: isValidHttpUrl(youtubeUrl) ? youtubeUrl : '',
      avgRating: d.avgRating || 0,
      numRatings: d.numRatings || 0,
      updatedAt: d.updatedAt || d.createdAt || null
    };
  }

  // ===== 카드 컴포넌트 =====
  function agentCard(a, img) {
    const subtitle = [a.city, a.topic].filter(Boolean).join(' · ');

    // 버튼: 상품보기 · 블로그 · YouTube (값 없으면 숨김)
    const actions = [
      a.id ? `<a href="search.html?agent=${encodeURIComponent(a.id)}" class="lm-btn">상품보기</a>` : '',
      `<a href="${a.blogUrl ? escapeHtml(a.blogUrl) : '#'}" target="_blank" rel="noopener" class="lm-btn">블로그</a>`,
      `<a href="${a.youtubeUrl ? escapeHtml(a.youtubeUrl) : '#'}" target="_blank" rel="noopener" class="lm-btn">YouTube</a>`,
      `<button class="lm-btn lm-btn-subtle contact-btn" data-agent-id="${a.id}">메이트 컨텍</button>`
    ].join('');

    return (
      '<article class="card agent-card">' +
        // ▶ 이미지 잘림 수정: 고정 높이 + cover + top 정렬
        '<div class="media" style="background:#13161f;overflow:hidden;border-top-left-radius:16px;border-top-right-radius:16px;">' +
          `<img src="${img}" alt="${escapeHtml(a.name)}" onerror="this.src='${PLACEHOLDER}'" ` +
          'style="width:100%;height:100%;display:block;object-fit:contain;object-position:center;" />' +
        '</div>' +
        '<div class="content">' +
          `<h3>${escapeHtml(a.name)}</h3>` +
          `<div class="muted" style="margin-top:2px">${escapeHtml(subtitle)}</div>` +
          `<div class="rating" style="margin-top:4px; display:flex; align-items:center; gap:8px;">` +
            `<span>평점: ${a.avgRating.toFixed(1)} (${a.numRatings}명)</span>` +
            `<button class="lm-btn lm-btn-subtle rate-btn" data-agent-id="${a.id}">평점 주기</button>` +
          `</div>` +
          `<p style="margin-top:8px">${escapeHtml(truncate(a.bio, 120))}</p>` +
          `<div class="actions" style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:10px;">${actions}</div>` +
        '</div>' +
      '</article>'
    );
  }

  // ===== 데이터 로드 =====
  async function fetchApprovedAgentsSnap() {
    try {
      return await db.collection('agents')
        .where('status', '==', 'approved')
        .orderBy('updatedAt', 'desc')
        .limit(60).get();
    } catch (e) {
      if (e.code === 'failed-precondition' || /requires an index/i.test(e.message || '')) {
        console.warn('[home] 인덱스 없음 → 정렬 없이 폴백');
        return await db.collection('agents')
          .where('status', '==', 'approved')
          .limit(60).get();
      }
      throw e;
    }
  }

  async function renderAgents() {
    try {
      if ($agentError) $agentError.style.display = 'none';
      if ($agentEmpty) $agentEmpty.style.display = 'none';
      if ($agentGrid)  $agentGrid.innerHTML = '<div class="muted" style="padding:12px">불러오는 중…</div>';

      const snap = await fetchApprovedAgentsSnap();
      if (snap.empty) {
        if ($agentGrid) $agentGrid.innerHTML = '';
        if ($agentEmpty) $agentEmpty.style.display = 'block';
        return [];
      }

      const agents = [];
      snap.forEach((doc) => agents.push(normAgent(doc)));

      const urls = await Promise.all(agents.map((a) => toImageURL(a.photoRaw)));
      const html = agents.map((a, i) => agentCard(a, urls[i])).join('');
      if ($agentGrid) $agentGrid.innerHTML = html;
      return agents;
    } catch (err) {
      console.error('[home] 에이전트 렌더 실패:', err);
      if ($agentGrid) $agentGrid.innerHTML = '';
      if ($agentError) {
        $agentError.textContent = `목록을 불러오지 못했습니다: ${err.message || err}`;
        $agentError.style.display = 'block';
      }
      return [];
    }
  }

  function topRegionsByCount(agents, limit = 6) {
    const map = new Map();
    for (const a of agents) {
      const key = toText(a.city).trim();
      if (!key) continue;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit);
  }

  async function renderRegions(agents) {
    try {
      if ($regionError) $regionError.style.display = 'none';
      if ($regionEmpty) $regionEmpty.style.display = 'none';

      if (!agents || agents.length === 0) {
        if ($regionGrid) $regionGrid.innerHTML = '';
        if ($regionEmpty) $regionEmpty.style.display = 'block';
        return;
      }

      const regions = topRegionsByCount(agents, 6);
      if (regions.length === 0) {
        if ($regionGrid) $regionGrid.innerHTML = '';
        if ($regionEmpty) $regionEmpty.style.display = 'block';
        return;
      }

      const html = regions.map(([name, count]) => (
        `<a class="card link" href="search.html?q=${encodeURIComponent(name)}">` +
          '<div class="content">' +
            `<h3>${escapeHtml(name)}</h3>` +
            `<div class="muted">${count}명의 로컬 메이트</div>` +
          '</div>' +
        '</a>'
      )).join('');
      if ($regionGrid) $regionGrid.innerHTML = html;
    } catch (err) {
      console.error('[home] 지역 렌더 실패:', err);
      if ($regionGrid) $regionGrid.innerHTML = '';
      if ($regionError) {
        $regionError.textContent = `지역을 불러오지 못했습니다: ${err.message || err}`;
        $regionError.style.display = 'block';
      }
    }
  }

  async function renderNotices() {
    try {
      if ($noticeError) $noticeError.style.display = 'none';
      if ($noticeEmpty) $noticeEmpty.style.display = 'none';
      if ($noticeList)  $noticeList.innerHTML = '<div class="muted" style="padding:12px">불러오는 중…</div>';

      let snap;
      try {
        snap = await db.collection('notices').orderBy('createdAt', 'desc').limit(10).get();
      } catch (e) {
        if (e.code === 'failed-precondition' || /requires an index/i.test(e.message || '')) {
          console.warn('[home] notices 인덱스 없음 → 정렬 없이 폴백');
          snap = await db.collection('notices').limit(10).get();
        } else {
          throw e;
        }
      }

      if (snap.empty) {
        if ($noticeList) $noticeList.innerHTML = '';
        if ($noticeEmpty) $noticeEmpty.style.display = 'block';
        return;
      }

      const html = [];
      snap.forEach((doc) => {
        const d = doc.data();
        const title = d.title || '공지';
        const text  = d.text  || d.content || '';
        html.push(
          '<div class="list-item">' +
            `<div class="title">${escapeHtml(title)}</div>` +
            `<div class="muted">${escapeHtml(truncate(toText(text), 140))}</div>` +
          '</div>'
        );
      });
      if ($noticeList) $noticeList.innerHTML = html.join('');
    } catch (err) {
      console.error('[home] 공지 렌더 실패:', err);
      if ($noticeList) $noticeList.innerHTML = '';
      if ($noticeError) {
        $noticeError.textContent = `공지를 불러오지 못했습니다: ${err.message || err}`;
        $noticeError.style.display = 'block';
      }
    }
  }

  function wireSearch() {
    if (!$q || !$qLink) return;
    function applyLink() {
      const v = ($q.value || '').trim();
      $qLink.setAttribute('href', v ? `search.html?q=${encodeURIComponent(v)}` : 'search.html');
    }
    $q.addEventListener('input', applyLink);
    applyLink();
  }

  async function init() {
    wireSearch();
    const agents = await renderAgents();
    await renderRegions(agents);
    await renderNotices();
    requestAnimationFrame(() => window.scrollTo(0, 0));

    // Rating Modal Logic
    const $ratingModalOverlay = document.getElementById('rating-modal-overlay');
    const $modalStars = document.querySelectorAll('#modal-star-rating .modal-star');
    const $modalSubmitBtn = document.getElementById('modal-submit-rating');
    const $modalCloseBtn = document.getElementById('modal-close-rating');
    const $modalAgentName = document.getElementById('modal-agent-name');
    let currentAgentId = null;
    let selectedModalRating = 0;

    // Contact Modal Logic
    const $contactModalOverlay = document.getElementById('contact-modal-overlay');
    const $contactModalName = document.getElementById('contact-modal-name');
    const $contactModalPhone = document.getElementById('contact-modal-phone');
    const $contactModalSns = document.getElementById('contact-modal-sns');
    const $contactModalEmail = document.getElementById('contact-modal-email');
    const $contactModalCloseBtn = document.getElementById('contact-modal-close');

    // Delegate click event for rate buttons
    $agentGrid.addEventListener('click', (event) => {
      const rateBtn = event.target.closest('.rate-btn');
      const contactBtn = event.target.closest('.contact-btn');

      if (rateBtn) {
        currentAgentId = rateBtn.dataset.agentId;
        const agentName = rateBtn.closest('.agent-card').querySelector('h3').textContent;
        $modalAgentName.textContent = agentName;
        selectedModalRating = 0; // Reset rating
        $modalStars.forEach(s => s.style.color = 'gray');
        $ratingModalOverlay.style.display = 'grid';
      } else if (contactBtn) {
        const agentId = contactBtn.dataset.agentId;
        const agent = agents.find(a => a.id === agentId); // Find agent from the rendered list
        if (agent) {
          $contactModalName.textContent = agent.name;
          $contactModalPhone.textContent = agent.contact || '정보 없음';
          $contactModalSns.textContent = agent.messenger || '정보 없음';
          $contactModalEmail.textContent = agent.email || '정보 없음';
          $contactModalOverlay.style.display = 'grid';
        }
      }
    });

    // Modal star hover and click effects
    $modalStars.forEach(star => {
      star.addEventListener('mouseover', () => {
        const value = parseInt(star.dataset.value);
        $modalStars.forEach((s, i) => {
          s.style.color = i < value ? 'gold' : 'gray';
        });
      });

      star.addEventListener('mouseout', () => {
        $modalStars.forEach((s, i) => {
          s.style.color = i < selectedModalRating ? 'gold' : 'gray';
        });
      });

      star.addEventListener('click', () => {
        selectedModalRating = parseInt(star.dataset.value);
        $modalStars.forEach((s, i) => {
          s.style.color = i < selectedModalRating ? 'gold' : 'gray';
        });
      });
    });

    // Modal close button
    $modalCloseBtn.addEventListener('click', () => {
      $ratingModalOverlay.style.display = 'none';
    });

    // Contact Modal close button
    $contactModalCloseBtn.addEventListener('click', () => {
      $contactModalOverlay.style.display = 'none';
    });

    // Modal submit rating
    $modalSubmitBtn.addEventListener('click', async () => {
      if (selectedModalRating === 0) {
        alert('평점을 선택해주세요.');
        return;
      }
      if (!currentAgentId) {
        alert('메이트 ID를 찾을 수 없습니다.');
        return;
      }

      const user = firebase.auth().currentUser;
      if (!user) {
        alert('로그인 후 평점을 남길 수 있습니다.');
        return;
      }

      try {
        await db.runTransaction(async (transaction) => {
          const agentRef = db.collection('agents').doc(currentAgentId);
          const agentDoc = await transaction.get(agentRef);

          if (!agentDoc.exists) {
            throw new Error('메이트를 찾을 수 없습니다.');
          }

          const currentAvgRating = agentDoc.data().avgRating || 0;
          const currentNumRatings = agentDoc.data().numRatings || 0;

          const userRatingRef = agentRef.collection('ratings').doc(user.uid);
          const userRatingDoc = await transaction.get(userRatingRef);

          let newNumRatings = currentNumRatings;
          let newTotalRating = currentAvgRating * currentNumRatings;

          if (userRatingDoc.exists) {
            const oldRating = userRatingDoc.data().rating;
            newTotalRating = newTotalRating - oldRating + selectedModalRating;
          } else {
            newNumRatings = currentNumRatings + 1;
            newTotalRating = newTotalRating + selectedModalRating;
          }

          const newAvgRating = newTotalRating / newNumRatings;

          transaction.update(agentRef, {
            avgRating: newAvgRating,
            numRatings: newNumRatings
          });
          transaction.set(userRatingRef, { rating: selectedModalRating, userId: user.uid, timestamp: firebase.firestore.FieldValue.serverTimestamp() });
        });
        alert('평점이 성공적으로 제출되었습니다!');
        $ratingModalOverlay.style.display = 'none';

        // Update the rating display on the specific card
        const cardElement = document.querySelector(`.agent-card .rate-btn[data-agent-id="${currentAgentId}"]`).closest('.agent-card');
        if (cardElement) {
          const ratingDisplay = cardElement.querySelector('.rating');
          if (ratingDisplay) {
            // Re-fetch agent data to get updated rating, or calculate locally
            // For simplicity, let's re-render all agents for now.
            // A more optimized approach would be to update just this card.
            renderAgents(); // Re-render all agents to update ratings
          }
        }

      } catch (error) {
        console.error('평점 제출 오류:', error);
        alert(`평점 제출에 실패했습니다: ${error.message}`);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
