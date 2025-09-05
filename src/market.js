/* market.js — 홈/검색/상세/마이 (승인된 큰언니 카드 노출 보장)
 * - 홈: approved == true 에이전트만 카드로 표기 (인덱스 없으면 폴백 정렬)
 * - 검색/상세/문의/예약(데모)/QR 바우처/리뷰
 * - 에러 내성: DOM 존재/로그인 여부/인덱스 미생성 처리
 */
(function(){
  'use strict';

  /* ========= 안전 헬퍼 (App.* 폴백) ========= */
  const $  = (s, el=document)=> (window.App?.$ ? App.$(s, el) : el.querySelector(s));
  const $$ = (s, el=document)=> (window.App?.$$ ? App.$$(s, el) : Array.from(el.querySelectorAll(s)));
  const toast = (m,t)=> (window.App?.toast ? App.toast(m,t) : alert(m));
  const esc = (s)=> (window.App?.esc ? App.esc(s) : (s||"").replace(/[&<>'"`]/g, m=>({
    "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;","`":"&#96;"
  }[m])));
  const nl2br = (s)=> (window.App?.nl2br ? App.nl2br(s) : (s||"").replace(/\n/g,"<br/>"));
  const fmt = (n)=> (window.App?.fmt ? App.fmt(n) : new Intl.NumberFormat('ko-KR').format(Number(n||0)));
  const short = (a)=> (window.App?.short ? App.short(a) : (a ? a.slice(0,6)+"…"+a.slice(-4) : ""));
  const routeTo = (name)=> (window.App?.routeTo ? App.routeTo(name) : (location.hash = name==="home"?"#/":`#/${name}`));

  function getState(){
    const S = (window.App?.State) || (window.State) || {};
    return {
      user: S.user || null,
      wallet: S.wallet || null,
      tier: Number(S.tier || 0),
      signer: S.signer || null
    };
  }
  function getTS(x){
    if (!x) return 0;
    if (typeof x.toMillis === 'function') return x.toMillis();
    if (x?.toDate) { try{ return x.toDate().getTime(); }catch(_){} }
    if (x instanceof Date) return x.getTime();
    if (typeof x === 'number') return x;
    return 0;
  }

  /* =================================================
   * 1) 홈: 지역/승인된 큰언니/공지
   * ================================================= */
  async function refreshHome(){
    if (!window.db) return;

    // 지역
    try{
      const regions = await db.collection("regions").orderBy("name").limit(6).get().catch(()=>({docs:[]}));
      const grid = $("#region-grid");
      if (grid) {
        grid.innerHTML =
          regions.docs.map(d=> cardRegion(d.data())).join("") ||
          `<div class="small">지역이 없습니다. 운영자 콘솔에서 생성하세요.</div>`;
      }
    }catch(e){ console.warn("regions load:", e?.message||e); }

    // ✅ 승인된 큰언니만 카드로
    try{
      const grid = $("#agent-grid");
      if (grid){
        let agDocs = [];
        try{
          const ag = await db.collection("agents")
            .where("approved","==",true)
            .orderBy("score","desc")
            .limit(6).get();
          agDocs = ag.docs;
        }catch(e){
          // 인덱스 미생성 시 폴백
          const ag = await db.collection("agents")
            .where("approved","==",true)
            .limit(20).get().catch(()=>({docs:[]}));
          agDocs = ag.docs
            .sort((a,b)=> (b.data().score||0) - (a.data().score||0))
            .slice(0,6);
          console.warn("agents(approved=true) local-sort fallback:", e?.message||e);
        }
        grid.innerHTML =
          agDocs.map(x=> cardAgent(x.data())).join("") ||
          `<div class="small">승인된 큰언니가 없습니다.</div>`;
      }
    }catch(e){ console.warn("agents load:", e?.message||e); }

    // 공지: startAt <= now, endAt는 클라 필터
    try{
      const list = $("#notice-list");
      if (list){
        const now = new Date();
        let nsDocs = [];
        try{
          const ns = await db.collection("notices")
            .where("startAt","<=", now)
            .orderBy("startAt","desc")
            .limit(20).get();
          nsDocs = ns.docs.filter(d=>{
            const n = d.data();
            const end = n.endAt?.toDate?.() || n.endAt;
            return !end || end >= now;
          });
        }catch(e){
          const ns = await db.collection("notices")
            .orderBy("startAt","desc").limit(10).get().catch(()=>({docs:[]}));
          nsDocs = ns.docs;
          console.warn("notices local fallback:", e?.message||e);
        }
        list.innerHTML =
          nsDocs.map(n=> `<div class="item"><b>${esc(n.data().title)}</b><div class="small">${esc(n.data().body||"")}</div></div>`).join("") ||
          `<div class="small">현재 공지가 없습니다.</div>`;
      }
    }catch(e){ console.warn("notices load:", e?.message||e); }
  }
  function cardRegion(r){
    return `<div class="card">
      <div class="row spread"><b>${esc(r.name)}</b><span class="badge">${(r.country||"").toUpperCase()}</span></div>
      <div class="small">${esc(r.desc||"")}</div>
    </div>`;
  }
  function cardAgent(a){
    return `<div class="card">
      <div class="row spread">
        <b>${esc(a.name||"큰언니")}</b>
        <span class="badge">평점 ${Math.round((a.rating||0)*10)/10} · 스코어 ${a.score||0}</span>
      </div>
      <div class="small">${esc(a.bio||"")}</div>
      <div class="kit"><span class="tag">${esc(a.region||"-")}</span>${(a.badges||[]).slice(0,3).map(x=>`<span class="tag">${esc(x)}</span>`).join("")}</div>
    </div>`;
  }

  /* =================================================
   * 2) 검색/상세/문의
   * ================================================= */
  $("#home-search")?.addEventListener("click", ()=>{
    const q = $("#home-q")?.value || "";
    const target = $("#search-q"); if (target) target.value = q;
    routeTo("search");
  });
  $("#search-run")?.addEventListener("click", ()=> doSearch());

  async function doSearch(){
    if (!window.db) return;
    const q = ($("#search-q")?.value||"").trim().toLowerCase();
    const snap = await db.collection("posts").where("status","==","open").limit(50).get().catch(()=>({docs:[]}));
    const items = snap.docs.map(d=>({...d.data(), id:d.id}))
      .filter(p => (p.title||"").toLowerCase().includes(q)
        || (p.body||"").toLowerCase().includes(q)
        || (p.tags||[]).join(",").toLowerCase().includes(q)
        || (p.region||"").toLowerCase().includes(q));
    const grid = $("#search-grid");
    if (grid){
      grid.innerHTML = items.map(p=> cardPost(p)).join("") || `<div class="small">검색 결과가 없습니다.</div>`;
    }
  }
  function cardPost(p){
    return `<div class="card">
      <div class="row spread"><b>${esc(p.title)}</b><span class="price">${fmt(p.price||0)} BET</span></div>
      <div class="small">${esc((p.body||"").slice(0,120))}...</div>
      <div class="kit">${(p.tags||[]).slice(0,5).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>
      <div class="row gap" style="margin-top:8px">
        <button class="btn" data-open-detail="${p.id}">자세히</button>
        <button class="btn outline" data-open-inquiry="${p.id}">문의</button>
      </div>
    </div>`;
  }

  // 상세 열기
  async function openDetail(postId){
    if (!window.db) return;
    const doc = await db.collection("posts").doc(postId).get().catch(()=>null);
    if(!doc || !doc.exists){ toast("존재하지 않는 상품입니다."); return; }
    const p = doc.data();
    const wrap = $("#detail-wrap");
    if (wrap){
      wrap.innerHTML = `
        <div class="row spread">
          <h3>${esc(p.title)}</h3>
          <span class="price">${fmt(p.price||0)} BET</span>
        </div>
        <div class="small">${nl2br(esc(p.body||""))}</div>
        <div class="kit">${(p.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>
        <div class="row gap" style="margin-top:10px">
          <button class="btn" data-open-inquiry="${esc(postId)}">문의하기</button>
          <button class="btn outline" data-book-direct="${esc(postId)}">즉시 예약(데모)</button>
        </div>
      `;
    }
    routeTo("detail");
  }

  // 이벤트 위임(검색/상세 카드 버튼)
  document.addEventListener("click", (ev)=>{
    const btn1 = ev.target.closest("[data-open-detail]");
    if (btn1){ openDetail(btn1.getAttribute("data-open-detail")); return; }

    const btn2 = ev.target.closest("[data-open-inquiry]");
    if (btn2){ window.openInquiry(btn2.getAttribute("data-open-inquiry")); return; }

    const btn3 = ev.target.closest("[data-book-direct]");
    if (btn3){ window.bookDirect(btn3.getAttribute("data-book-direct")); return; }
  });

  // 문의
  window.openInquiry = async function(postId){
    const { user } = getState();
    if(!user){ toast("먼저 로그인하세요."); return; }
    const post = await db.collection("posts").doc(postId).get();
    if(!post.exists){ toast("상품 없음"); return; }
    const p = post.data();
    const message = prompt(`[${p.title}] 큰언니에게 보낼 문의를 입력하세요:`,"안녕하세요! 일정/가격 문의드립니다.");
    if(!message) return;
    await db.collection("inquiries").add({
      postId, agentId: p.agentId, regionId: p.regionId || null,
      userUid: user.uid, message, status:"신규",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    toast("문의가 접수되었습니다.");
  };

  /* =================================================
   * 3) 예약(데모) / 바우처
   * ================================================= */
  // 온체인 예치 스텁 포함
  window.bookDirect = async function(postId){
    const S = getState();
    if(!S.user){ toast("먼저 로그인하세요."); return; }

    // Tier 1 이상만
    const tier = Number(S.tier || 0);
    if(tier < 1){ toast("온체인 티어 1 이상만 결제가 가능합니다."); return; }

    const pdoc = await db.collection("posts").doc(postId).get();
    if(!pdoc.exists){ toast("상품 없음"); return; }
    const p = pdoc.data();

    // 데모용 주문/바우처 발행 (온체인 호출은 스킵 가능)
    try{
      // (선택) 온체인 escrow book 스텁
      if (S.signer && window.ONCHAIN?.TravelEscrow?.address && ONCHAIN.TravelEscrow.address !== "0x0000000000000000000000000000000000000000"){
        try{
          const c = new ethers.Contract(ONCHAIN.TravelEscrow.address, ONCHAIN.TravelEscrow.abi, S.signer);
          const orderId = cryptoRandomId();
          const idBytes = ethers.id("order:"+orderId);
          const tokenAddr = window.ONCHAIN?.BET?.address || ethers.ZeroAddress;
          const amount = ethers.parseUnits(String(p.price||0), 18);
          const agentWallet = p.agentWallet || (await agentWalletById(p.agentId)) || S.wallet || ethers.ZeroAddress;
          const tx = await c.book(idBytes, tokenAddr, amount, agentWallet);
          await tx.wait();
        }catch(chainErr){
          console.warn("Escrow call skipped/failed:", chainErr?.shortMessage||chainErr?.message||chainErr);
        }
      }

      // 오프체인 주문/바우처
      const orderId = cryptoRandomId();
      const amount = Number(p.price||0);

      await db.collection("orders").doc(orderId).set({
        id: orderId, postId, agentId: p.agentId, userUid: S.user.uid,
        total: amount, token: "BET", status: "예치완료",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      const vId = "v_"+orderId;
      await db.collection("vouchers").doc(vId).set({
        id: vId, scope:"agent", userUid: S.user.uid, agentId: p.agentId,
        tokenId: "TBA-1155", faceValue: amount, rules: { postId },
        expiry: new Date(Date.now()+1000*60*60*24*30),
        status: "issued", createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      toast("예약/결제가 완료되었습니다. '마이 > 바우처'에서 QR을 확인하세요.","ok");
      routeTo("my");
      refreshMy();
    }catch(e){
      console.error(e);
      toast("예약 처리 실패: " + (e?.message||e), "err");
    }
  };

  async function agentWalletById(agentId){
    if(!agentId) return null;
    const doc = await db.collection("agents").doc(agentId).get();
    return doc.exists ? (doc.data().wallet || null) : null;
  }

  /* =================================================
   * 4) 마이(orders/vouchers/reviews)
   * ================================================= */
  async function refreshMy(){
    const S = getState();
    const elOrders = $("#my-orders");
    const elVchs   = $("#my-vouchers");
    const elRevs   = $("#my-reviews");

    if(!S.user){
      if (elOrders) elOrders.innerHTML = `<div class="small">로그인 필요</div>`;
      if (elVchs)   elVchs.innerHTML   = ``;
      if (elRevs)   elRevs.innerHTML   = ``;
      return;
    }

    // Orders
    let ordersArr = [];
    try{
      const snap = await db.collection("orders")
        .where("userUid","==",S.user.uid)
        .orderBy("createdAt","desc").limit(20).get();
      ordersArr = snap.docs.map(d=>({id:d.id, ...d.data()}));
    }catch(e){
      const snap = await db.collection("orders").where("userUid","==",S.user.uid).limit(60).get();
      ordersArr = snap.docs.map(d=>({id:d.id, ...d.data()}));
      ordersArr.sort((a,b)=> getTS(b.createdAt) - getTS(a.createdAt));
      ordersArr = ordersArr.slice(0,20);
      console.warn('orders: local sort fallback (no composite index)');
    }
    if (elOrders){
      elOrders.innerHTML = ordersArr.map(o=>`
        <div class="item">
          <div class="row spread"><b>주문 #${esc(o.id)}</b><span class="badge">${esc(o.status||"-")}</span></div>
          <div class="small">총액 ${fmt(o.total||0)} BET</div>
          <div class="kit"><button class="btn outline" data-open-review="${esc(o.id)}">리뷰 작성</button></div>
        </div>`).join("") || `<div class="small">예약 내역 없음</div>`;
    }

    // Vouchers
    let vouchersArr = [];
    try{
      const snap = await db.collection("vouchers")
        .where("userUid","==",S.user.uid)
        .orderBy("createdAt","desc").limit(20).get();
      vouchersArr = snap.docs.map(d=>({id:d.id, ...d.data()}));
    }catch(e){
      const snap = await db.collection("vouchers").where("userUid","==",S.user.uid).limit(60).get();
      vouchersArr = snap.docs.map(d=>({id:d.id, ...d.data()}));
      vouchersArr.sort((a,b)=> getTS(b.createdAt) - getTS(a.createdAt));
      vouchersArr = vouchersArr.slice(0,20);
      console.warn('vouchers: local sort fallback (no composite index)');
    }
    if (elVchs){
      elVchs.innerHTML = vouchersArr.map(v=>{
        const elId = "qr_"+v.id;
        const expiry = v.expiry?.toDate?.() || v.expiry;
        const html = `
          <div class="card">
            <div class="row spread"><b>바우처 ${esc(v.id)}</b><span class="badge">${esc(v.status||"-")}</span></div>
            <div class="small">유효기간: ${expiry ? new Date(expiry).toLocaleDateString() : "-"}</div>
            <div id="${elId}" style="padding:8px;background:#fff;border-radius:12px;margin-top:8px"></div>
            <div class="kit"><button class="btn outline" data-mark-redeemed="${esc(v.id)}">사용완료 표시(데모)</button></div>
          </div>`;
        // QR은 다음 tick에 렌더
        setTimeout(()=>{
          try{
            const payload = JSON.stringify({ id:v.id, tokenId:v.tokenId, proof:"DEMO-SIGNATURE" });
            const canvasEl = document.getElementById(elId);
            if (canvasEl) QRCode.toCanvas(canvasEl, payload, { width:180 }, (err)=>err&&console.error(err));
          }catch(e){}
        },0);
        return html;
      }).join("") || `<div class="small">보유 바우처 없음</div>`;
    }

    // Reviews
    const reviewsSnap = await db.collection("reviews")
      .where("userUid","==",S.user.uid)
      .orderBy("createdAt","desc").limit(20).get().catch(()=>({docs:[]}));
    const reviewsArr = reviewsSnap.docs.map(d=>({id:d.id, ...d.data()}));
    if (elRevs){
      elRevs.innerHTML = reviewsArr.map(r=>`
        <div class="item"><b>${"★".repeat(r.rating||0)}</b><div class="small">${esc(r.text||"")}</div></div>`
      ).join("") || `<div class="small">작성한 리뷰 없음</div>`;
    }
  }

  // 마이 영역 버튼 이벤트 위임
  document.addEventListener("click", async (ev)=>{
    const btn1 = ev.target.closest("[data-mark-redeemed]");
    if (btn1){
      const voucherId = btn1.getAttribute("data-mark-redeemed");
      await window.markRedeemed(voucherId);
      return;
    }
    const btn2 = ev.target.closest("[data-open-review]");
    if (btn2){
      const orderId = btn2.getAttribute("data-open-review");
      await window.openReview(orderId);
      return;
    }
  });

  window.markRedeemed = async function(voucherId){
    await db.collection("vouchers").doc(voucherId).set({
      status:"redeemed",
      redeemedAt: firebase.firestore.FieldValue.serverTimestamp()
    },{merge:true});
    toast("바우처를 사용 완료로 표시했습니다. (온체인 redeem 연동 지점)","ok");
    refreshMy();
  };

  window.openReview = async function(orderId){
    const S = getState();
    if(!S.user){ toast("로그인이 필요합니다."); return; }
    const rating = Number(prompt("평점을 입력하세요 (1~5):","5"));
    if(!(rating>=1 && rating<=5)) return;
    const text = prompt("리뷰 내용을 입력하세요:","좋은 서비스였습니다!");
    if(!text) return;
    await db.collection("reviews").add({
      orderId, userUid: S.user.uid, rating, text,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    toast("리뷰가 등록되었습니다.","ok");
    refreshMy();
  };

  /* =================================================
   * 5) 전역 노출 + 초기 호출
   * ================================================= */
  window.refreshHome = refreshHome;
  window.doSearch = doSearch;
  window.openDetail = openDetail;
  window.refreshMy = refreshMy;

  // 첫 그리기(페이지 로드 시)
  try{ refreshHome(); }catch(_){}
})();
