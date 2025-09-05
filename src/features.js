/* features.js — 화면 기능(홈/검색/마이/에이전트/운영자) */
'use strict';

import {
  $, $$, toast, fmt, esc, nl2br, cryptoRandomId, getTS, routeTo, ONCHAIN
} from './utils.js';
import { connectWallet, getTier } from './auth-wallet.js';

/* 안전 접근자 */
function getState() {
  const S = (window.App?.State) || (window.State) || {};
  return {
    user: S.user || null,
    wallet: S.wallet || null,
    tier: Number(S.tier || 0),
    signer: S.signer || null,
    agentDoc: S.agentDoc || null,
    isAdmin: !!S.isAdmin
  };
}
async function getDB() {
  if (window.App?.db) return window.App.db;
  if (window.firebase?.firestore) return firebase.firestore();
  for (let i = 0; i < 20; i++) {            // 1초까지 대기 (20*50ms)
    await new Promise(r => setTimeout(r, 50));
    if (window.App?.db) return window.App.db;
    if (window.firebase?.firestore) return firebase.firestore();
  }
  throw new Error("Firebase db not ready. Make sure app.js initializes App.db first.");
}

/* 라우터 */
function hashRoute() {
  const h = (location.hash || "#/").replace(/^#\//, "");
  return h || "home";
}
function renderRoute() {
  const r = hashRoute();
  $$(".view").forEach(v => v.classList.remove("active"));
  if (r === "home") { $("#view-home")?.classList.add("active"); return; }
  $("#view-" + r)?.classList.add("active");
  if (r === "search") doSearch();
  if (r === "agent") renderAgentPipes();
  if (r === "admin") renderAdmin();
}
window.addEventListener("hashchange", renderRoute);

/* 홈/검색/상세 */
$("#home-search")?.addEventListener("click", () => {
  const q = $("#home-q")?.value || "";
  const target = $("#search-q"); if (target) target.value = q;
  routeTo("search");
});
$("#search-run")?.addEventListener("click", () => doSearch());

async function refreshHome() {
  const db = await getDB();

  // 지역
  try {
    const regions = await db.collection("regions").orderBy("name").limit(6).get().catch(() => ({ docs: [] }));
    const grid = $("#region-grid");
    if (grid) {
      grid.innerHTML = regions.docs.map(doc => cardRegion(doc.data())).join("")
        || `<div class="small">지역이 없습니다. 운영자/큰언니 콘솔에서 생성하세요.</div>`;
    }
  } catch (e) { console.warn("regions load:", e?.message || e); }

  // 승인된 큰언니
  try {
    const grid = $("#agent-grid");
    if (grid) {
      let agDocs = [];
      try {
        const ag = await db.collection("agents").where("approved", "==", true).orderBy("score", "desc").limit(6).get();
        agDocs = ag.docs;
      } catch (e) {
        const ag = await db.collection("agents").where("approved", "==", true).limit(20).get().catch(() => ({ docs: [] }));
        agDocs = ag.docs.sort((a, b) => (b.data().score || 0) - (a.data().score || 0)).slice(0, 6);
        console.warn("agents(approved=true) local-sort fallback:", e?.message || e);
      }
      grid.innerHTML = agDocs.map(x => cardAgent(x.data())).join("") || `<div class="small">승인된 큰언니가 없습니다.</div>`;
    }
  } catch (e) { console.warn("agents load:", e?.message || e); }

  // 공지
  try {
    const list = $("#notice-list");
    if (list) {
      const now = new Date();
      let nsDocs = [];
      try {
        const ns = await db.collection("notices").where("startAt", "<=", now).orderBy("startAt", "desc").limit(20).get();
        nsDocs = ns.docs.filter(d => {
          const n = d.data();
          const end = n.endAt?.toDate?.() || n.endAt;
          return !end || end >= now;
        });
      } catch (e) {
        const ns = await db.collection("notices").orderBy("startAt", "desc").limit(10).get().catch(() => ({ docs: [] }));
        nsDocs = ns.docs;
        console.warn("notices local fallback:", e?.message || e);
      }
      list.innerHTML =
        nsDocs.map(n => `<div class="item"><b>${esc(n.data().title)}</b><div class="small">${esc(n.data().body || "")}</div></div>`).join("")
        || `<div class="small">현재 공지가 없습니다.</div>`;
    }
  } catch (e) { console.warn("notices load:", e?.message || e); }
}
function cardRegion(r) {
  return `<div class="card">
    <div class="row spread"><b>${esc(r.name)}</b><span class="badge">${(r.country || "").toUpperCase()}</span></div>
    <div class="small">${esc(r.desc || "")}</div>
  </div>`;
}
function cardAgent(a) {
  return `<div class="card">
    <div class="row spread">
      <b>${esc(a.name || "큰언니")}</b>
      <span class="badge">평점 ${Math.round((a.rating || 0) * 10) / 10} · 스코어 ${a.score || 0}</span>
    </div>
    <div class="small">${esc(a.bio || "")}</div>
    <div class="kit"><span class="tag">${esc(a.region || "-")}</span>${(a.badges || []).slice(0, 3).map(x => `<span class="tag">${esc(x)}</span>`).join("")}</div>
  </div>`;
}

async function doSearch() {
  const db = await getDB();
  const q = ($("#search-q")?.value || "").trim().toLowerCase();
  const snap = await db.collection("posts").where("status", "==", "open").limit(50).get().catch(() => ({ docs: [] }));
  const items = snap.docs.map(d => ({ ...d.data(), id: d.id }))
    .filter(p => (p.title || "").toLowerCase().includes(q)
      || (p.body || "").toLowerCase().includes(q)
      || (p.tags || []).join(",").toLowerCase().includes(q)
      || (p.region || "").toLowerCase().includes(q));
  const grid = $("#search-grid");
  if (grid) {
    grid.innerHTML = items.map(p => cardPost(p)).join("") || `<div class="small">검색 결과가 없습니다.</div>`;
  }
}
function cardPost(p) {
  return `<div class="card">
    <div class="row spread"><b>${esc(p.title)}</b><span class="price">${fmt(p.price || 0)} BET</span></div>
    <div class="small">${esc((p.body || "").slice(0, 120))}...</div>
    <div class="kit">${(p.tags || []).slice(0, 5).map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>
    <div class="row gap" style="margin-top:8px">
      <button class="btn" data-open-detail="${p.id}">자세히</button>
      <button class="btn outline" data-open-inquiry="${p.id}">문의</button>
    </div>
  </div>`;
}

async function openDetail(postId) {
  const db = await getDB();
  const doc = await db.collection("posts").doc(postId).get();
  if (!doc.exists) { toast("존재하지 않는 상품입니다."); return; }
  const p = doc.data();
  const wrap = $("#detail-wrap");
  if (wrap) {
    wrap.innerHTML = `
      <div class="row spread">
        <h3>${esc(p.title)}</h3>
        <span class="price">${fmt(p.price || 0)} BET</span>
      </div>
      <div class="small">${nl2br(esc(p.body || ""))}</div>
      <div class="kit">${(p.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>
      <div class="row gap" style="margin-top:10px">
        <button class="btn" data-open-inquiry="${esc(postId)}">문의하기</button>
        <button class="btn outline" data-book-direct="${esc(postId)}">즉시 예약(데모)</button>
      </div>
    `;
  }
  routeTo("detail");
}

// 카드/상세 버튼 위임
document.addEventListener("click", (ev) => {
  const btn1 = ev.target.closest("[data-open-detail]");
  if (btn1) { openDetail(btn1.getAttribute("data-open-detail")); return; }
  const btn2 = ev.target.closest("[data-open-inquiry]");
  if (btn2) { openInquiry(btn2.getAttribute("data-open-inquiry")); return; }
  const btn3 = ev.target.closest("[data-book-direct]");
  if (btn3) { bookDirect(btn3.getAttribute("data-book-direct")); return; }
});

/* 문의 */
async function openInquiry(postId) {
  const db = await getDB();
  const { user } = getState();
  if (!user) { toast("먼저 로그인하세요."); return; }
  const post = await db.collection("posts").doc(postId).get();
  if (!post.exists) { toast("상품 없음"); return; }
  const p = post.data();
  const message = prompt(`[${p.title}] 큰언니에게 보낼 문의를 입력하세요:`, "안녕하세요! 일정/가격 문의드립니다.");
  if (!message) return;
  await db.collection("inquiries").add({
    postId, agentId: p.agentId, regionId: p.regionId || null,
    userUid: user.uid, message, status: "신규",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  toast("문의가 접수되었습니다.");
}

/* 예약(데모)/바우처 */
async function bookDirect(postId) {
  const db = await getDB();
  const S = getState();
  if (!S.user) { toast("먼저 로그인하세요."); return; }
  if (!S.wallet) { await connectWallet(); if (!getState().wallet) return; }
  const tier = S.tier || await getTier(getState().wallet);
  if (Number(tier) < 1) { toast("온체인 티어 1 이상만 결제가 가능합니다."); return; }

  const pdoc = await db.collection("posts").doc(postId).get();
  if (!pdoc.exists) { toast("상품 없음"); return; }
  const p = pdoc.data();

  const orderId = cryptoRandomId();
  const amount = Number(p.price || 0);
  const agentWallet = p.agentWallet || (await agentWalletById(p.agentId)) || getState().wallet;

  try {
    if (getState().signer && ONCHAIN.TravelEscrow.address !== "0x0000000000000000000000000000000000000000") {
      const c = new ethers.Contract(ONCHAIN.TravelEscrow.address, ONCHAIN.TravelEscrow.abi, getState().signer);
      const idBytes = ethers.id("order:" + orderId);
      const tokenAddr = ONCHAIN.BET?.address || ethers.ZeroAddress;
      const tx = await c.book(idBytes, tokenAddr, ethers.parseUnits(String(amount), 18), agentWallet);
      await tx.wait();
    } else {
      console.log("Escrow not configured. Skipping chain call for demo.");
    }
  } catch (e) { console.error(e); toast("온체인 결제 실패: " + (e?.shortMessage || e?.message || e)); return; }

  await db.collection("orders").doc(orderId).set({
    id: orderId, postId, agentId: p.agentId, userUid: getState().user.uid,
    total: amount, token: "BET", status: "예치완료",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  const vId = "v_" + orderId;
  await db.collection("vouchers").doc(vId).set({
    id: vId, scope: "agent", userUid: getState().user.uid, agentId: p.agentId,
    tokenId: "TBA-1155", faceValue: amount, rules: { postId },
    expiry: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    status: "issued", createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  toast("예약/결제가 완료되었습니다. '마이 > 바우처'에서 QR을 확인하세요.");
  routeTo("my");
  refreshMy();
}

async function agentWalletById(agentId) {
  if (!agentId) return null;
  const db = await getDB();
  const doc = await db.collection("agents").doc(agentId).get();
  return doc.exists ? (doc.data().wallet || null) : null;
}

/* 마이 */
async function refreshMy() {
  const db = await getDB();
  const S = getState();

  const elOrders = $("#my-orders");
  const elVchs = $("#my-vouchers");
  const elRevs = $("#my-reviews");

  if (!S.user) {
    elOrders && (elOrders.innerHTML = `<div class="small">로그인 필요</div>`);
    elVchs && (elVchs.innerHTML = ``);
    elRevs && (elRevs.innerHTML = ``);
    return;
  }

  // Orders
  let ordersArr = [];
  try {
    const snap = await db.collection("orders")
      .where("userUid", "==", S.user.uid)
      .orderBy("createdAt", "desc").limit(20).get();
    ordersArr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    const snap = await db.collection("orders").where("userUid", "==", S.user.uid).limit(60).get();
    ordersArr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    ordersArr.sort((a, b) => getTS(b.createdAt) - getTS(a.createdAt));
    ordersArr = ordersArr.slice(0, 20);
    console.warn('orders: local sort fallback (no composite index)');
  }
  elOrders && (elOrders.innerHTML = ordersArr.map(o => `
    <div class="item">
      <div class="row spread"><b>주문 #${esc(o.id)}</b><span class="badge">${esc(o.status || "-")}</span></div>
      <div class="small">총액 ${fmt(o.total || 0)} BET</div>
      <div class="kit"><button class="btn outline" data-open-review="${esc(o.id)}">리뷰 작성</button></div>
    </div>`).join("") || `<div class="small">예약 내역 없음</div>`);

  // Vouchers
  let vouchersArr = [];
  try {
    const snap = await db.collection("vouchers")
      .where("userUid", "==", S.user.uid)
      .orderBy("createdAt", "desc").limit(20).get();
    vouchersArr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    const snap = await db.collection("vouchers").where("userUid", "==", S.user.uid).limit(60).get();
    vouchersArr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    vouchersArr.sort((a, b) => getTS(b.createdAt) - getTS(a.createdAt));
    vouchersArr = vouchersArr.slice(0, 20);
    console.warn('vouchers: local sort fallback (no composite index)');
  }
  if (elVchs) {
    elVchs.innerHTML = vouchersArr.map(v => {
      const elId = "qr_" + v.id;
      const expiry = v.expiry?.toDate?.() || v.expiry;
      const html = `
        <div class="card">
          <div class="row spread"><b>바우처 ${esc(v.id)}</b><span class="badge">${esc(v.status || "-")}</span></div>
          <div class="small">유효기간: ${expiry ? new Date(expiry).toLocaleDateString() : "-"}</div>
          <div id="${elId}" style="padding:8px;background:#fff;border-radius:12px;margin-top:8px"></div>
          <div class="kit"><button class="btn outline" data-mark-redeemed="${esc(v.id)}">사용완료 표시(데모)</button></div>
        </div>`;
      setTimeout(() => {
        try {
          const payload = JSON.stringify({ id: v.id, tokenId: v.tokenId, proof: "DEMO-SIGNATURE" });
          const canvasEl = document.getElementById(elId);
          if (canvasEl) QRCode.toCanvas(canvasEl, payload, { width: 180 }, (err) => err && console.error(err));
        } catch (_) {}
      }, 0);
      return html;
    }).join("") || `<div class="small">보유 바우처 없음</div>`;
  }

  // Reviews
  const reviewsSnap = await db.collection("reviews")
    .where("userUid", "==", S.user.uid)
    .orderBy("createdAt", "desc").limit(20).get().catch(() => ({ docs: [] }));
  const reviewsArr = reviewsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  elRevs && (elRevs.innerHTML = reviewsArr.map(r => `
    <div class="item"><b>${"★".repeat(r.rating || 0)}</b><div class="small">${esc(r.text || "")}</div></div>`
  ).join("") || `<div class="small">작성한 리뷰 없음</div>`);
}

// 마이: 버튼 위임
document.addEventListener("click", async (ev) => {
  const btn1 = ev.target.closest("[data-mark-redeemed]");
  if (btn1) { await markRedeemed(btn1.getAttribute("data-mark-redeemed")); return; }
  const btn2 = ev.target.closest("[data-open-review]");
  if (btn2) { await openReview(btn2.getAttribute("data-open-review")); return; }
});
async function markRedeemed(voucherId) {
  const db = await getDB();
  const doc = db.collection("vouchers").doc(voucherId);
  await doc.set({ status: "redeemed", redeemedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  toast("바우처를 사용 완료로 표시했습니다. (온체인 redeem 연동 지점)");
  refreshMy();
}
async function openReview(orderId) {
  const S = getState();
  if (!S.user) { toast("로그인이 필요합니다."); return; }
  const rating = Number(prompt("평점을 입력하세요 (1~5):", "5"));
  if (!(rating >= 1 && rating <= 5)) return;
  const text = prompt("리뷰 내용을 입력하세요:", "좋은 서비스였습니다!");
  if (!text) return;
  const db = await getDB();
  await db.collection("reviews").add({
    orderId, userUid: S.user.uid, rating, text,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  toast("리뷰가 등록되었습니다.");
  refreshMy();
}

/* 에이전트 콘솔 */
async function refreshAgentState() {
  const db = await getDB();
  const S = getState();
  const stSpan = $("#agent-status");

  if (!S.user) { stSpan && (stSpan.textContent = "상태: 로그인 필요"); return; }

  const q = await db.collection("agents").where("ownerUid", "==", S.user.uid).limit(1).get();
  const agentDoc = q.docs[0] ? { id: q.docs[0].id, ...q.docs[0].data() } : null;

  if (window.App?.State) window.App.State.agentDoc = agentDoc;
  else window.State = { ...(window.State || {}), agentDoc };

  stSpan && (stSpan.textContent = "상태: " + (agentDoc ? (agentDoc.approved ? "승인됨" : "심사중") : "미가입"));
  if (agentDoc) {
    $("#agent-name") && ($("#agent-name").value = agentDoc.name || "");
    $("#agent-bio") && ($("#agent-bio").value = agentDoc.bio || "");
    $("#agent-region") && ($("#agent-region").value = agentDoc.region || "");
    $("#agent-wallet") && ($("#agent-wallet").value = agentDoc.wallet || "");
  } else {
    $("#agent-name") && ($("#agent-name").value = "");
    $("#agent-bio") && ($("#agent-bio").value = "");
    $("#agent-region") && ($("#agent-region").value = "");
    $("#agent-wallet") && ($("#agent-wallet").value = "");
  }
}

$("#agent-save")?.addEventListener("click", async () => {
  const db = await getDB();
  const S = getState();
  if (!S.user) { toast("로그인이 필요합니다."); return; }

  const payload = {
    ownerUid: S.user.uid,
    name: $("#agent-name")?.value || "큰언니",
    bio: $("#agent-bio")?.value || "",
    region: $("#agent-region")?.value || "",
    wallet: $("#agent-wallet")?.value || S.wallet || null,
    rating: S.agentDoc?.rating ?? 5.0,
    score: S.agentDoc?.score ?? 50,
    kycStatus: S.agentDoc?.kycStatus ?? "pending",
    approved: S.agentDoc?.approved ?? false,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  let id = S.agentDoc?.id;
  if (id) {
    await db.collection("agents").doc(id).set(payload, { merge: true });
  } else {
    const ref = await db.collection("agents").add({
      ...payload,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    id = ref.id;
  }
  toast("큰언니 프로필이 저장되었습니다.");
  await refreshAgentState();
});

$("#post-create")?.addEventListener("click", async () => {
  const db = await getDB();
  const S = getState();
  if (!S.user || !S.agentDoc) { toast("큰언니 프로필 필요"); return; }
  const title = $("#post-title")?.value || "";
  const body = $("#post-body")?.value || "";
  const price = Number($("#post-price")?.value || 0);
  const tags = ($("#post-tags")?.value || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!title) { toast("제목을 입력하세요."); return; }
  const regionId = await ensureRegion(S.agentDoc.region);
  await db.collection("posts").add({
    agentId: S.agentDoc.id, agentWallet: S.agentDoc.wallet || null,
    regionId, region: S.agentDoc.region || "",
    type: "product", title, body, images: [], price, tags, status: "open",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  toast("상품/포스트가 등록되었습니다.");
});
async function ensureRegion(name) {
  const db = await getDB();
  if (!name) return null;
  const q = await db.collection("regions").where("name", "==", name).limit(1).get();
  if (q.docs[0]) return q.docs[0].id;
  const ref = await db.collection("regions").add({
    name, country: "VN", lang: ["ko", "en", "vi"],
    desc: `${name} 지역 소개`, createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  return ref.id;
}

async function renderAgentPipes() {
  const db = await getDB();
  const S = getState();
  if (!S.user || !S.agentDoc) {
    $("#pipe-inquiries") && ($("#pipe-inquiries").innerHTML = `<div class="small">큰언니 프로필 저장 후 사용 가능합니다.</div>`);
    $("#pipe-orders") && ($("#pipe-orders").innerHTML = `<div class="small">큰언니 프로필 저장 후 사용 가능합니다.</div>`);
    return;
  }
  const [inq, ord] = await Promise.all([
    db.collection("inquiries").where("agentId", "==", S.agentDoc.id).orderBy("createdAt", "desc").limit(20).get().catch(async e => {
      const qs = await db.collection("inquiries").where("agentId", "==", S.agentDoc.id).limit(60).get();
      return { docs: qs.docs.sort((a, b) => getTS(b.data().createdAt) - getTS(a.data().createdAt)).slice(0, 20) };
    }),
    db.collection("orders").where("agentId", "==", S.agentDoc.id).orderBy("createdAt", "desc").limit(20).get().catch(async e => {
      const qs = await db.collection("orders").where("agentId", "==", S.agentDoc.id).limit(60).get();
      return { docs: qs.docs.sort((a, b) => getTS(b.data().createdAt) - getTS(a.data().createdAt)).slice(0, 20) };
    }),
  ]);
  $("#pipe-inquiries") && ($("#pipe-inquiries").innerHTML = inq.docs.map(d => {
    const i = d.data();
    return `<div class="item">
      <div class="row spread"><b>${esc(i.message)}</b><span class="badge">${i.status || "-"}</span></div>
      <div class="kit">
        <button class="btn outline" onclick="sendQuote('${d.id}', ${i.postId ? 1 : 0})">견적 제시</button>
      </div>
    </div>`;
  }).join("") || `<div class="small">문의 없음</div>`);

  $("#pipe-orders") && ($("#pipe-orders").innerHTML = ord.docs.map(d => {
    const o = d.data();
    return `<div class="item">
      <div class="row spread"><b>주문 #${esc(o.id)}</b><span class="badge">${esc(o.status)}</span></div>
      <div class="small">총액 ${fmt(o.total)} BET</div>
      <div class="kit">
        <button class="btn outline" onclick="confirmOrder('${d.id}')">체크아웃/정산(데모)</button>
      </div>
    </div>`;
  }).join("") || `<div class="small">예약 없음</div>`);
}
window.sendQuote = async function (inquiryId) {
  const db = await getDB();
  const S = getState();
  const amount = Number(prompt("견적 금액(BET):", "100"));
  if (!(amount > 0)) return;
  await db.collection("quotes").add({
    inquiryId, agentId: S.agentDoc.id, items: [], total: amount, currency: "BET",
    terms: "기본 약관", expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 3),
    status: "제출", createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await db.collection("inquiries").doc(inquiryId).set({ status: "견적" }, { merge: true });
  toast("견적이 제출되었습니다.");
};
window.confirmOrder = async function (orderId) {
  const db = await getDB();
  await db.collection("orders").doc(orderId).set({ status: "완료" }, { merge: true });
  toast("체크아웃 처리(데모). (온체인 정산/릴리즈 연동 지점)");
  renderAgentPipes();
};

/* 운영자 콘솔 */
async function renderAdmin() {
  const db = await getDB();
  const S = getState();
  if (!S.isAdmin && !window.App?.State?.isAdmin) {
    toast("운영자만 접근 가능합니다.");
    routeTo("home");
    return;
  }

  const MAX = 50;
  // 심사/대기 목록
  let listA = [];
  try {
    const q = await db.collection("agents").where("approved", "==", false).orderBy("updatedAt", "desc").limit(MAX).get();
    listA = q.docs;
  } catch (e) {
    const q = await db.collection("agents").where("approved", "==", false).limit(MAX).get();
    listA = q.docs.sort((a, b) => getTS(b.data().updatedAt) - getTS(a.data().updatedAt));
    console.warn("agents(approved=false) local-sort fallback:", e?.message || e);
  }
  let listB = [];
  try {
    const q2 = await db.collection("agents").where("kycStatus", "==", "review").orderBy("updatedAt", "desc").limit(MAX).get();
    listB = q2.docs;
  } catch (e) {
    const q2 = await db.collection("agents").where("kycStatus", "==", "review").limit(MAX).get();
    listB = q2.docs.sort((a, b) => getTS(b.data().updatedAt) - getTS(a.data().updatedAt));
    console.warn("agents(kycStatus=review) local-sort fallback:", e?.message || e);
  }

  const uniq = new Map();
  [...listA, ...listB].forEach(d => uniq.set(d.id, d));
  const docs = [...uniq.values()];

  $("#admin-agents") && ($("#admin-agents").innerHTML =
    docs.map(d => {
      const a = d.data();
      return `<div class="item">
        <div class="row spread"><b>${esc(a.name || "-")} (${esc(a.region || "-")})</b>
          <span class="badge">${esc(a.kycStatus || "-")}</span></div>
        <div class="small">${esc(a.bio || "")}</div>
        <div class="kit">
          <button class="btn" onclick="approveAgent('${d.id}')">승인</button>
          <button class="btn outline" onclick="rejectAgent('${d.id}')">반려</button>
        </div>
      </div>`;
    }).join("") || `<div class="small">대기 중인 큰언니 없음</div>`
  );

  // 바우처/공지 목록
  const vs = await db.collection("vouchers").orderBy("createdAt", "desc").limit(20).get().catch(() => ({ docs: [] }));
  $("#v-issued") && ($("#v-issued").innerHTML = vs.docs.map(d => {
    const v = d.data();
    return `<div class="item">
      <div class="row spread"><b>${esc(v.id)}</b><span class="badge">${esc(v.status || "-")}</span></div>
      <div class="small">scope: ${esc(v.scope || "-")} · face: ${esc(v.faceValue || 0)} · expiry: ${new Date(v.expiry?.toDate?.() || v.expiry).toLocaleDateString()}</div>
    </div>`;
  }).join("") || `<div class="small">발행 없음</div>`);

  const ns = await db.collection("notices").orderBy("startAt", "desc").limit(20).get().catch(() => ({ docs: [] }));
  $("#n-list") && ($("#n-list").innerHTML = ns.docs.map(d => {
    const n = d.data();
    return `<div class="item"><b>${esc(n.title)}</b><div class="small">${esc(n.body || "")}</div></div>`;
  }).join("") || `<div class="small">공지 없음</div>`);
}
window.approveAgent = async function (agentId) {
  const db = await getDB();
  await db.collection("agents").doc(agentId).set({ approved: true, kycStatus: "approved", updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  toast("승인 완료");
  renderAdmin();
  refreshHome(); // 홈 카드 즉시 반영
};
window.rejectAgent = async function (agentId) {
  const db = await getDB();
  await db.collection("agents").doc(agentId).set({ approved: false, kycStatus: "rejected", updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  toast("반려 처리");
  renderAdmin();
};

/* Admin의 바우처/공지 액션 */
$("#v-issue")?.addEventListener("click", async () => {
  const db = await getDB();
  const scope = $("#v-region")?.value || "global";
  const face = Number($("#v-face")?.value || 0);
  const exp = $("#v-exp")?.value ? new Date($("#v-exp").value) : new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  const id = "V" + Math.random().toString(36).slice(2, 9);
  await db.collection("vouchers").doc(id).set({
    id, scope, faceValue: face, rules: {}, expiry: exp, supply: 1, claimed: 0, redeemed: 0, status: "issued",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  toast("바우처가 발행되었습니다.");
  renderAdmin();
});
$("#n-publish")?.addEventListener("click", async () => {
  const db = await getDB();
  const title = $("#n-title")?.value || "";
  const body = $("#n-body")?.value || "";
  if (!title) { toast("제목을 입력하세요."); return; }
  await db.collection("notices").add({
    title, body, pinned: false,
    startAt: new Date(Date.now() - 60000),
    endAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  if ($("#n-title")) $("#n-title").value = "";
  if ($("#n-body")) $("#n-body").value = "";
  toast("공지 발행됨");
  renderAdmin();
});

/* Nav 링크 */
$$("a[data-link]").forEach(a => {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    const href = a.getAttribute("href");
    if (!href) return;
    if (href.startsWith("#/")) location.hash = href;
    else location.hash = "#/" + href.replace(/^#?\/?/, "");
  });
});

/* export */
export {
  renderRoute, refreshHome, doSearch, openDetail, openInquiry,
  bookDirect, refreshMy, refreshAgentState, renderAgentPipes, renderAdmin
};
