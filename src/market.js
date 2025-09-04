// market.js — 홈/검색/상세/문의/예약/마이
(function () {
  const {
    $, $$, db, State, toast, fmt, esc, nl2br, cryptoRandomId,
    routeTo, connectWallet, getTier, ONCHAIN, firebase
  } = window.App;

  /* ---- 작은 유틸 ---- */
  function getTS(x){ // Firestore Timestamp/Date/number → millis
    if (!x) return 0;
    if (typeof x.toMillis === 'function') return x.toMillis();
    if (x instanceof Date) return x.getTime();
    if (typeof x === 'number') return x;
    return 0;
  }

  /* ---- 홈 ---- */
  async function refreshHome(){
    // Regions
    const regions = await db.collection("regions").orderBy("name").limit(6).get().catch(()=>({docs:[]}));
    $("#region-grid").innerHTML =
      regions.docs.map(doc=>cardRegion(doc.data())).join("") ||
      `<div class="small">지역이 없습니다. 운영자/큰언니 콘솔에서 생성하세요.</div>`;

    // Agents (승인된 상위 스코어)
    const ag = await db.collection("agents").where("approved","==",true).orderBy("score","desc").limit(6).get().catch(()=>({docs:[]}));
    $("#agent-grid").innerHTML =
      ag.docs.map(x=>cardAgent(x.data())).join("") ||
      `<div class="small">승인된 큰언니가 없습니다.</div>`;

    // Notices — Firestore는 range 필터를 한 필드에만 허용하므로
    // startAt <= now 로 정렬/조회 후 endAt >= now 는 클라이언트에서 필터
    const now = new Date();
    let nsDocs = [];
    try {
      const qs = await db.collection("notices")
        .where("startAt","<=", now)
        .orderBy("startAt","desc")
        .limit(20).get();
      nsDocs = qs.docs.filter(d => {
        const n = d.data();
        const end = n.endAt?.toDate?.() || n.endAt;
        return !end || end >= now;
      });
    } catch {
      // 인덱스 미구성 등 예외 시 단순 최신순으로 일부만 가져오기
      const qs = await db.collection("notices").orderBy("startAt","desc").limit(10).get().catch(()=>({docs:[]}));
      nsDocs = qs.docs;
    }
    $("#notice-list").innerHTML =
      nsDocs.map(n=>`<div class="item"><b>${esc(n.data().title)}</b><div class="small">${esc(n.data().body||"")}</div></div>`).join("") ||
      `<div class="small">현재 공지가 없습니다.</div>`;
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

  /* ---- 검색/상세/문의 ---- */
  $("#home-search") && ($("#home-search").onclick = ()=>{ $("#search-q").value = $("#home-q").value||""; routeTo("search"); });
  $("#search-run")   && ($("#search-run").onclick   = ()=> doSearch());

  async function doSearch(){
    const q = ($("#search-q").value||"").trim().toLowerCase();
    const snap = await db.collection("posts").where("status","==","open").limit(50).get().catch(()=>({docs:[]}));
    const items = snap.docs.map(d=>({ ...d.data(), id:d.id }))
      .filter(p => (p.title||"").toLowerCase().includes(q)
        || (p.body||"").toLowerCase().includes(q)
        || (p.tags||[]).join(",").toLowerCase().includes(q)
        || (p.region||"").toLowerCase().includes(q));
    $("#search-grid").innerHTML = items.map(p=>cardPost(p)).join("") || `<div class="small">검색 결과가 없습니다.</div>`;
  }
  function cardPost(p){
    return `<div class="card">
      <div class="row spread"><b>${esc(p.title)}</b><span class="price">${fmt(p.price||0)} BET</span></div>
      <div class="small">${esc((p.body||"").slice(0,120))}...</div>
      <div class="kit">${(p.tags||[]).slice(0,5).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>
      <div class="row gap" style="margin-top:8px">
        <button class="btn" onclick="openDetail('${p.id}')">자세히</button>
        <button class="btn outline" onclick="openInquiry('${p.id}')">문의</button>
      </div>
    </div>`;
  }
  async function openDetail(postId){
    const doc = await db.collection("posts").doc(postId).get();
    if(!doc.exists){ toast("존재하지 않는 상품입니다."); return; }
    const p = doc.data();
    $("#detail-wrap").innerHTML = `
      <div class="row spread">
        <h3>${esc(p.title)}</h3>
        <span class="price">${fmt(p.price||0)} BET</span>
      </div>
      <div class="small">${nl2br(esc(p.body||""))}</div>
      <div class="kit">${(p.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>
      <div class="row gap" style="margin-top:10px">
        <button class="btn" onclick="openInquiry('${p.id}')">문의하기</button>
        <button class="btn outline" onclick="bookDirect('${p.id}')">즉시 예약(데모)</button>
      </div>`;
    routeTo("detail");
  }
  async function openInquiry(postId){
    if(!State.user){ toast("먼저 로그인하세요."); return; }
    const post = await db.collection("posts").doc(postId).get();
    if(!post.exists){ toast("상품 없음"); return; }
    const p = post.data();
    const message = prompt(`[${p.title}] 큰언니에게 보낼 문의를 입력하세요:`,"안녕하세요! 일정/가격 문의드립니다.");
    if(!message) return;
    await db.collection("inquiries").add({
      postId, agentId:p.agentId, regionId:p.regionId||null,
      userUid:State.user.uid, message, status:"신규",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    toast("문의가 접수되었습니다.");
  }

  /* ---- 예약/결제 ---- */
  async function agentWalletById(agentId){
    if(!agentId) return null;
    const doc = await db.collection("agents").doc(agentId).get();
    return doc.exists ? (doc.data().wallet||null) : null;
  }
  async function bookDirect(postId){
    if(!State.user){ toast("먼저 로그인하세요."); return; }
    if(!State.wallet){ await connectWallet(); if(!State.wallet) return; }
    const tier = State.tier || await getTier(State.wallet);
    if(Number(tier) < 1){ toast("온체인 티어 1 이상만 결제가 가능합니다."); return; }

    const pdoc = await db.collection("posts").doc(postId).get();
    if(!pdoc.exists){ toast("상품 없음"); return; }
    const p = pdoc.data();

    const orderId = cryptoRandomId();
    const amount = Number(p.price||0);
    const agentWallet = p.agentWallet || (await agentWalletById(p.agentId)) || State.wallet;

    try{
      if(State.signer && ONCHAIN.TravelEscrow.address !== "0x0000000000000000000000000000000000000000"){
        const c = new ethers.Contract(ONCHAIN.TravelEscrow.address, ONCHAIN.TravelEscrow.abi, State.signer);
        const idBytes = ethers.id("order:"+orderId);
        const tokenAddr = ONCHAIN.BET?.address || ONCHAIN.PAW?.address || ethers.ZeroAddress;
        const tx = await c.book(idBytes, tokenAddr, ethers.parseUnits(String(amount),18), agentWallet);
        await tx.wait();
      } else {
        console.log("Escrow not configured. Skipping chain call for demo.");
      }
    }catch(e){ console.error(e); toast("온체인 결제 실패: " + (e?.shortMessage||e?.message||e)); return; }

    await db.collection("orders").doc(orderId).set({
      id:orderId, postId, agentId:p.agentId, userUid:State.user.uid,
      total:amount, token:"BET", status:"예치완료",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    const vId = "v_"+orderId;
    await db.collection("vouchers").doc(vId).set({
      id:vId, scope:"agent", userUid:State.user.uid, agentId:p.agentId,
      tokenId:"TBA-1155", faceValue:amount, rules:{ postId },
      expiry:new Date(Date.now()+1000*60*60*24*30),
      status:"issued", createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    toast("예약/결제가 완료되었습니다. '마이 > 바우처'에서 QR을 확인하세요.");
    routeTo("my"); refreshMy();
  }

  /* ---- 마이 ---- */
  async function refreshMy(){
    if(!State.user){ $("#my-orders").innerHTML = `<div class="small">로그인 필요</div>`; return; }

    // Orders: 인덱스 있으면 서버 정렬, 없으면 로컬 정렬 폴백
    let ordersArr = [];
    try {
      const snap = await db.collection("orders")
        .where("userUid","==",State.user.uid)
        .orderBy("createdAt","desc")
        .limit(20).get();
      ordersArr = snap.docs.map(d=>({id:d.id, ...d.data()}));
    } catch (e) {
      const msg = String(e?.message||e);
      if (msg.includes("create it here") || msg.includes("requires an index")) {
        const snap = await db.collection("orders")
          .where("userUid","==",State.user.uid)
          .limit(60).get();
        ordersArr = snap.docs.map(d=>({id:d.id, ...d.data()}));
        ordersArr.sort((a,b)=> getTS(b.createdAt) - getTS(a.createdAt));
        ordersArr = ordersArr.slice(0,20);
        console.warn('orders: local sort fallback (no composite index)');
      } else { throw e; }
    }

    // Vouchers: 동일 패턴
    let vouchersArr = [];
    try {
      const snap = await db.collection("vouchers")
        .where("userUid","==",State.user.uid)
        .orderBy("createdAt","desc")
        .limit(20).get();
      vouchersArr = snap.docs.map(d=>({id:d.id, ...d.data()}));
    } catch (e) {
      const msg = String(e?.message||e);
      if (msg.includes("create it here") || msg.includes("requires an index")) {
        const snap = await db.collection("vouchers")
          .where("userUid","==",State.user.uid)
          .limit(60).get();
        vouchersArr = snap.docs.map(d=>({id:d.id, ...d.data()}));
        vouchersArr.sort((a,b)=> getTS(b.createdAt) - getTS(a.createdAt));
        vouchersArr = vouchersArr.slice(0,20);
        console.warn('vouchers: local sort fallback (no composite index)');
      } else { throw e; }
    }

    // Reviews (단순)
    const reviewsSnap = await db.collection("reviews")
      .where("userUid","==",State.user.uid)
      .orderBy("createdAt","desc")
      .limit(20).get().catch(()=>({docs:[]}));
    const reviewsArr = reviewsSnap.docs.map(d=>({id:d.id, ...d.data()}));

    // 렌더
    $("#my-orders").innerHTML = ordersArr.map(o=>`
      <div class="item">
        <div class="row spread"><b>주문 #${esc(o.id)}</b><span class="badge">${esc(o.status || "-")}</span></div>
        <div class="small">총액 ${fmt(o.total || 0)} BET</div>
        <div class="kit"><button class="btn outline" onclick="openReview('${o.id}')">리뷰 작성</button></div>
      </div>`).join("") || `<div class="small">예약 내역 없음</div>`;

    $("#my-vouchers").innerHTML = vouchersArr.map(v=>{
      const elId = "qr_"+v.id;
      const expiry = v.expiry?.toDate?.() || v.expiry;
      const html = `
        <div class="card">
          <div class="row spread"><b>바우처 ${esc(v.id)}</b><span class="badge">${esc(v.status||"-")}</span></div>
          <div class="small">유효기간: ${expiry ? new Date(expiry).toLocaleDateString() : "-"}</div>
          <div id="${elId}" style="padding:8px;background:#fff;border-radius:12px;margin-top:8px"></div>
          <div class="kit"><button class="btn outline" onclick="markRedeemed('${v.id}')">사용완료 표시(데모)</button></div>
        </div>`;
      setTimeout(()=>{
        const payload = JSON.stringify({ id:v.id, tokenId:v.tokenId, proof:"DEMO-SIGNATURE" });
        QRCode.toCanvas(document.getElementById(elId), payload, { width:180 }, (err)=>err&&console.error(err));
      },0);
      return html;
    }).join("") || `<div class="small">보유 바우처 없음</div>`;

    $("#my-reviews").innerHTML = reviewsArr.map(r=>`
      <div class="item"><b>${"★".repeat(r.rating||0)}</b><div class="small">${esc(r.text||"")}</div></div>`
    ).join("") || `<div class="small">작성한 리뷰 없음</div>`;
  }
  async function markRedeemed(voucherId){
    const doc = db.collection("vouchers").doc(voucherId);
    await doc.set({ status:"redeemed", redeemedAt: firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
    toast("바우처를 사용 완료로 표시했습니다. (온체인 redeem 연동 지점)");
    refreshMy();
  }
  async function openReview(orderId){
    const rating = Number(prompt("평점을 입력하세요 (1~5):","5"));
    if(!(rating>=1 && rating<=5)) return;
    const text = prompt("리뷰 내용을 입력하세요:","좋은 서비스였습니다!");
    if(!text) return;
    await db.collection("reviews").add({
      orderId, userUid:State.user.uid, rating, text,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    toast("리뷰가 등록되었습니다.");
    refreshMy();
  }

  /* ---- 전역 export (onclick 용) ---- */
  window.openDetail   = openDetail;
  window.openInquiry  = openInquiry;
  window.bookDirect   = bookDirect;
  window.markRedeemed = markRedeemed;
  window.openReview   = openReview;

  /* ---- App 이벤트 ---- */
  window.addEventListener("app:auth", ()=>{ refreshHome(); refreshMy(); });
  window.addEventListener("app:route", ({detail:{route}})=>{ if(route==="search") doSearch(); });

  // 초기 렌더
  refreshHome();
})();
