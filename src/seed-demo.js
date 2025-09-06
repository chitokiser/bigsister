/* features.js — 라우터/홈/검색/마이/에이전트/운영자 (IIFE + 전역 App 의존) */
(function(){
  'use strict';

  /* ============== 공통 / 전역 핸들 ============== */
  const App     = window.App = window.App || {};
  const State   = App.State = App.State || {};
  const db      = App.db    || (window.firebase?.firestore ? firebase.firestore() : null);
  const storage = App.storage|| (window.firebase?.storage   ? firebase.storage()   : null);
  const toast   = App.toast || (m=>alert(m));

  // 로컬 헬퍼 (전역 오염 방지)
  const $  = (s, el=document)=> el.querySelector(s);
  const $$ = (s, el=document)=> Array.from(el.querySelectorAll(s));

  const ESC_MAP = { "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;", "`":"&#96;" };
  const esc   = (s)=> String(s ?? "").replace(/[&<>'"`]/g, ch => ESC_MAP[ch]);
  const fmt   = App.fmt   || (n=> new Intl.NumberFormat().format(Number(n||0)));
  const nl2br = App.nl2br || (s=> String(s||"").replace(/\n/g,"<br/>"));
  function getTS(x){
    if (!x) return 0;
    if (typeof x.toMillis === 'function') return x.toMillis();
    if (x?.toDate) { try{ return x.toDate().getTime(); }catch(_){ } }
    if (x instanceof Date) return x.getTime();
    if (typeof x === 'number') return x;
    return 0;
  }

  /* ============== 라우터 ============== */
  function hashRoute(){ return (location.hash||"#/").replace("#/", "") || "home"; }
  function routeTo(name){ location.hash = name==="home" ? "#/" : `#/${name}` }
  function activate(id){
    $$(".view").forEach(v=>v.classList.remove("active"));
    $(id)?.classList.add("active");
  }
  async function renderRoute(){
    const r = hashRoute();
    if (r==="home")       { activate("#view-home"); await refreshHome(); }
    else if (r==="search"){ activate("#view-search"); await doSearch(); }
    else if (r==="my")    { activate("#view-my"); await refreshMy(); }
    else if (r==="agent") { activate("#view-agent"); await refreshAgentState(); await renderAgentPipes(); }
    else if (r==="admin") { activate("#view-home"); await renderAdmin(); } // 관리자 UI는 홈 아래 카드들로 렌더
    else                  { activate("#view-home"); await refreshHome(); }
  }
  window.addEventListener("hashchange", renderRoute);

  // 내비 링크 기본 동작 막고 hash만 갱신
  document.addEventListener('DOMContentLoaded', ()=>{
    $$("a[data-link]").forEach(a=>{
      a.addEventListener("click",(e)=>{
        e.preventDefault();
        const href = a.getAttribute("href") || "#/";
        location.hash = href;
      });
    });
  });

  /* ============== 홈 ============== */
  $("#home-search")?.addEventListener("click", ()=>{
    const q = $("#home-q")?.value || "";
    const target = $("#search-q"); if (target) target.value = q;
    routeTo("search");
  });

  async function refreshHome(){
    if (!db) return;

    // 지역
    try{
      const regions = await db.collection("regions").orderBy("name").limit(6).get();
      $("#region-grid")?.innerHTML =
        regions.docs.map(d=>cardRegion(d.data())).join("") ||
        `<div class="small">지역이 없습니다. 운영자/큰언니 콘솔에서 생성하세요.</div>`;
    }catch{
      $("#region-grid")?.innerHTML = `<div class="small">지역 로드 실패</div>`;
    }

    // 승인된 큰언니: score desc (인덱스 없을 때 로컬 소트)
    try{
      const ag = await db.collection("agents")
        .where("approved","==",true).orderBy("score","desc").limit(6).get();
      $("#agent-grid")?.innerHTML =
        ag.docs.map(x=> cardAgent(x.data())).join("") ||
        `<div class="small">승인된 큰언니가 없습니다.</div>`;
    }catch(e){
      console.warn("agents(approved=true) local-sort fallback:", e?.message||e);
      try{
        const ag2 = await db.collection("agents").where("approved","==",true).limit(24).get();
        const arr = ag2.docs.map(d=>d.data()).sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,6);
        $("#agent-grid")?.innerHTML =
          arr.map(x=> cardAgent(x)).join("") || `<div class="small">승인된 큰언니가 없습니다.</div>`;
      }catch{
        $("#agent-grid")?.innerHTML = `<div class="small">큰언니 로드 실패</div>`;
      }
    }

    // 공지: startAt<=now, endAt는 클라 필터
    const now = new Date();
    try{
      const ns = await db.collection("notices").where("startAt","<=", now).orderBy("startAt","desc").limit(20).get();
      const list = ns.docs.filter(d=>{
        const n = d.data();
        const end = n.endAt?.toDate?.() || n.endAt;
        return !end || end >= now;
      });
      $("#notice-list")?.innerHTML =
        list.map(doc=> {
          const n = doc.data();
          return `<div class="item"><b>${esc(n.title)}</b><div class="small">${esc(n.body||"")}</div></div>`;
        }).join("")
        || `<div class="small">현재 공지가 없습니다.</div>`;
    }catch{
      $("#notice-list")?.innerHTML = `<div class="small">공지 로드 실패</div>`;
    }
  }

  function cardRegion(r){
    return `<div class="card">
      <div class="row spread"><b>${esc(r.name)}</b><span class="badge">${esc((r.country||"").toUpperCase())}</span></div>
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

  /* ============== 검색/상세 ============== */
  $("#search-run")?.addEventListener("click", ()=> doSearch());

  async function doSearch(){
    if (!db) return;
    const q = ($("#search-q")?.value||"").trim().toLowerCase();
    try{
      const snap = await db.collection("posts").where("status","==","open").limit(50).get();
      const items = snap.docs.map(d=>({id:d.id, ...d.data()}))
        .filter(p => (p.title||"").toLowerCase().includes(q)
          || (p.body||"").toLowerCase().includes(q)
          || (p.tags||[]).join(",").toLowerCase().includes(q)
          || (p.region||"").toLowerCase().includes(q));
      $("#search-grid")?.innerHTML = items.map(cardPost).join("") || `<div class="small">검색 결과가 없습니다.</div>`;
    }catch{
      $("#search-grid")?.innerHTML = `<div class="small">검색 실패</div>`;
    }
  }
  function cardPost(p){
    const hasLong = (typeof p.body === 'string' && p.body.length > 120);
    return `<div class="card">
      <div class="row spread"><b>${esc(p.title)}</b>${p.price!=null?`<span class="price">${fmt(p.price||0)} BET</span>`:''}</div>
      <div class="small">${esc((p.body||"").slice(0,120))}${hasLong?'…':''}</div>
      <div class="kit">${(p.tags||[]).slice(0,5).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>
      <div class="row gap" style="margin-top:8px">
        <button class="btn" onclick="openDetail('${p.id}')">자세히</button>
        <button class="btn outline" onclick="openInquiry('${p.id}')">문의</button>
      </div>
    </div>`;
  }

  window.openDetail = async function(postId){
    if (!db) return;
    const doc = await db.collection("posts").doc(postId).get();
    if(!doc.exists){ toast("존재하지 않는 상품입니다."); return; }
    const p = doc.data();
    $("#detail-wrap")?.innerHTML = `
      <div class="row spread">
        <h3>${esc(p.title)}</h3>
        ${p.price!=null? `<span class="price">${fmt(p.price||0)} BET</span>` : ``}
      </div>
      <div class="small">${nl2br(esc(p.body||""))}</div>
      <div class="kit">${(p.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>
      <div class="row gap" style="margin-top:10px">
        <button class="btn" onclick="openInquiry('${postId}')">문의하기</button>
        <button class="btn outline" onclick="bookDirect('${postId}')">즉시 예약(데모)</button>
      </div>
    `;
    routeTo("detail");
  };

  window.openInquiry = async function(postId){
    if (!db) return;
    if(!State.user){ toast("먼저 로그인하세요."); return; }
    const post = await db.collection("posts").doc(postId).get();
    if(!post.exists){ toast("상품 없음"); return; }
    const p = post.data();
    const message = prompt(`[${p.title}] 큰언니에게 보낼 문의를 입력하세요:`,`안녕하세요! 일정/가격 문의드립니다.`);
    if(!message) return;
    await db.collection("inquiries").add({
      postId, agentId: p.agentId, regionId: p.regionId || null,
      userUid: State.user.uid, message, status:"신규",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    toast("문의가 접수되었습니다.");
  };

  /* ============== 예약(데모) ============== */
  async function ensureWallet(){
    if (State.wallet) return true;
    if (typeof App.connectWallet === 'function'){
      await App.connectWallet();
      return !!State.wallet;
    }
    // 최소 폴백: 메타마스크 직접 요청
    if (window.ethereum){
      try{
        const accts = await window.ethereum.request({ method:'eth_requestAccounts' });
        State.wallet = accts?.[0] || null;
        return !!State.wallet;
      }catch(_){}
    }
    toast('지갑 연결이 필요합니다.');
    return false;
  }

  async function ensureTier(){
    let tier = Number(State.tier||0);
    if (tier>0) return tier;
    if (typeof App.getTier === 'function'){
      try{ tier = await App.getTier(State.wallet); }catch(_){}
    }
    if (!tier) tier = 1; // 폴백: 데모 정책
    State.tier = tier;
    return tier;
  }

  window.bookDirect = async function(postId){
    if (!db) return;
    if(!State.user){ toast("먼저 로그인하세요."); return; }
    if(!(await ensureWallet())) return;
    const tier = await ensureTier();
    if(Number(tier) < 1){ toast("온체인 티어 1 이상만 결제가 가능합니다."); return; }

    const pdoc = await db.collection("posts").doc(postId).get();
    if(!pdoc.exists){ toast("상품 없음"); return; }
    const p = pdoc.data();

    // 온체인 escrow는 생략(데모)
    const orderId = "o_"+Math.random().toString(36).slice(2,10);
    const amount = Number(p.price||0);

    await db.collection("orders").doc(orderId).set({
      id: orderId, postId, agentId: p.agentId, userUid: State.user.uid,
      total: amount, token: "BET", status: "예치완료",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    const vId = "v_"+orderId;
    await db.collection("vouchers").doc(vId).set({
      id: vId, scope:"agent", userUid: State.user.uid, agentId: p.agentId,
      tokenId: "DEMO-1155", faceValue: amount, rules: { postId },
      expiry: new Date(Date.now()+1000*60*60*24*30),
      status: "issued", createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    toast("예약/결제가 완료되었습니다. '마이 > 바우처'에서 QR을 확인하세요.");
    routeTo("my");
    refreshMy();
  };

  /* ============== 마이 ============== */
  async function refreshMy(){
    if (!db) return;
    if(!State.user){
      $("#my-orders")?.innerHTML   = `<div class="small">로그인 필요</div>`;
      $("#my-vouchers")?.innerHTML = `<div class="small">로그인 필요</div>`;
      $("#my-reviews")?.innerHTML  = `<div class="small">로그인 필요</div>`;
      return;
    }

    // Orders (인덱스 없어도 동작)
    let ordersArr=[];
    try{
      const snap = await db.collection("orders")
        .where("userUid","==",State.user.uid)
        .orderBy("createdAt","desc").limit(20).get();
      ordersArr = snap.docs.map(d=>({id:d.id, ...d.data()}));
    }catch(e){
      const snap = await db.collection("orders").where("userUid","==",State.user.uid).limit(60).get();
      ordersArr = snap.docs.map(d=>({id:d.id, ...d.data()}));
      ordersArr.sort((a,b)=> getTS(b.createdAt) - getTS(a.createdAt));
      ordersArr = ordersArr.slice(0,20);
      console.warn('orders: local sort fallback (no composite index)');
    }

    // Vouchers
    let vouchersArr=[];
    try{
      const snap = await db.collection("vouchers")
        .where("userUid","==",State.user.uid)
        .orderBy("createdAt","desc").limit(20).get();
      vouchersArr = snap.docs.map(d=>({id:d.id, ...d.data()}));
    }catch(e){
      const snap = await db.collection("vouchers").where("userUid","==",State.user.uid).limit(60).get();
      vouchersArr = snap.docs.map(d=>({id:d.id, ...d.data()}));
      vouchersArr.sort((a,b)=> getTS(b.createdAt) - getTS(a.createdAt));
      vouchersArr = vouchersArr.slice(0,20);
      console.warn('vouchers: local sort fallback (no composite index)');
    }

    const reviewsSnap = await db.collection("reviews")
      .where("userUid","==",State.user.uid)
      .orderBy("createdAt","desc").limit(20).get().catch(()=>({docs:[]}));
    const reviewsArr = reviewsSnap.docs.map(d=>({id:d.id, ...d.data()}));

    $("#my-orders")?.innerHTML = ordersArr.map(o=>`
      <div class="item">
        <div class="row spread"><b>주문 #${esc(o.id)}</b><span class="badge">${esc(o.status||"-")}</span></div>
        <div class="small">총액 ${fmt(o.total||0)} BET</div>
        <div class="kit"><button class="btn outline" onclick="openReview('${o.id}')">리뷰 작성</button></div>
      </div>`).join("") || `<div class="small">예약 내역 없음</div>`;

    $("#my-vouchers")?.innerHTML = vouchersArr.map(v=>{
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
        try{
          const payload = JSON.stringify({ id:v.id, tokenId:v.tokenId, proof:"DEMO-SIGNATURE" });
          window.QRCode?.toCanvas(document.getElementById(elId), payload, { width:180 }, (err)=>err&&console.error(err));
        }catch(e){ console.warn(e); }
      },0);
      return html;
    }).join("") || `<div class="small">보유 바우처 없음</div>`;

    $("#my-reviews")?.innerHTML = reviewsArr.map(r=>`
      <div class="item"><b>${"★".repeat(r.rating||0)}</b><div class="small">${esc(r.text||"")}</div></div>`
    ).join("") || `<div class="small">작성한 리뷰 없음</div>`;
  }

  window.markRedeemed = async function(voucherId){
    if (!db) return;
    await db.collection("vouchers").doc(voucherId).set({
      status:"redeemed", redeemedAt: firebase.firestore.FieldValue.serverTimestamp()
    },{merge:true});
    toast("바우처를 사용 완료로 표시했습니다.");
    refreshMy();
  };

  window.openReview = async function(orderId){
    if (!db) return;
    const rating = Number(prompt("평점을 입력하세요 (1~5):","5"));
    if(!(rating>=1 && rating<=5)) return;
    const text = prompt("리뷰 내용을 입력하세요:","좋은 서비스였습니다!");
    if(!text) return;
    await db.collection("reviews").add({
      orderId, userUid: State.user.uid, rating, text,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    toast("리뷰가 등록되었습니다.");
    refreshMy();
  };

  /* ============== 에이전트 콘솔 ============== */
  async function refreshAgentState(){
    if (!db) return;
    if(!State.user){ $("#agent-status") && ($("#agent-status").textContent="상태: 로그인 필요"); return; }
    const q = await db.collection("agents").where("ownerUid","==",State.user.uid).limit(1).get();
    State.agentDoc = q.docs[0] ? { id:q.docs[0].id, ...q.docs[0].data() } : null;
    const statusText = "상태: " + (State.agentDoc ? (State.agentDoc.approved?"승인됨":(State.agentDoc.kycStatus||"심사중")) : "미가입");
    $("#agent-status") && ($("#agent-status").textContent = statusText);
    if(State.agentDoc){
      $("#agent-name")      && ($("#agent-name").value     = State.agentDoc.name||"");
      $("#agent-bio")       && ($("#agent-bio").value      = State.agentDoc.bio||"");
      $("#agent-region")    && ($("#agent-region").value   = State.agentDoc.region||"");
      $("#agent-wallet")    && ($("#agent-wallet").value   = State.agentDoc.wallet||"");
      $("#agent-contact")   && ($("#agent-contact").value  = State.agentDoc.contact||"");
      $("#agent-messenger") && ($("#agent-messenger").value= State.agentDoc.messenger||"");
      if (State.agentDoc.photoURL){
        const pv = $("#agent-photo-preview");
        if (pv){ pv.src=State.agentDoc.photoURL; pv.classList.remove('hidden'); }
      }
    }else{
      ["#agent-name","#agent-bio","#agent-region","#agent-wallet","#agent-contact","#agent-messenger"].forEach(id=>{
        const el = $(id); if (el) el.value = "";
      });
      $("#agent-photo-preview")?.classList.add('hidden');
    }
  }

  // 사진 미리보기
  $("#agent-photo")?.addEventListener("change",(e)=>{
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const pv = $("#agent-photo-preview");
    if (pv){ pv.src = url; pv.classList.remove('hidden'); }
  });

  // 저장
  $("#agent-save")?.addEventListener("click", async ()=>{
    if (!db) return;
    if(!State.user){ toast("로그인이 필요합니다."); return; }

    const payload = {
      ownerUid: State.user.uid,
      name: $("#agent-name")?.value||"큰언니",
      bio: $("#agent-bio")?.value||"",
      region: $("#agent-region")?.value||"",
      wallet: $("#agent-wallet")?.value||State.wallet||null,
      contact: $("#agent-contact")?.value||"",
      messenger: $("#agent-messenger")?.value||"",
      rating: State.agentDoc?.rating || 5.0,
      score:  State.agentDoc?.score  || 50,
      kycStatus: State.agentDoc?.kycStatus || "pending",
      approved:  State.agentDoc?.approved  || false,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    // 사진 업로드 (선택)
    const file = $("#agent-photo")?.files?.[0] || null;
    if (file && storage){
      try{
        const ref = storage.ref().child(`agents/${State.user.uid}/${Date.now()}_${file.name}`);
        await ref.put(file);
        payload.photoURL = await ref.getDownloadURL();
      }catch(e){ console.warn("photo upload fail:", e); }
    }

    let id = State.agentDoc?.id;
    if(id){
      await db.collection("agents").doc(id).set(payload,{merge:true});
    }else{
      const ref = await db.collection("agents").add(payload);
      id = ref.id;
    }
    toast("큰언니 프로필이 저장되었습니다.");
    await refreshAgentState();
  });

  // 상품/포스트 등록
  $("#post-create")?.addEventListener("click", async ()=>{
    if (!db) return;
    if(!State.user || !State.agentDoc){ toast("큰언니 프로필 필요"); return; }
    const title = $("#post-title")?.value||"";
    const body  = $("#post-body")?.value||"";
    const price = Number($("#post-price")?.value||"0")||0;
    const tags  = ($("#post-tags")?.value||"").split(",").map(s=>s.trim()).filter(Boolean);
    if(!title){ toast("제목을 입력하세요."); return; }
    const regionId = await ensureRegion(State.agentDoc.region);
    await db.collection("posts").add({
      agentId: State.agentDoc.id, agentWallet: State.agentDoc.wallet||"",
      regionId, region: State.agentDoc.region||"",
      type: price>0 ? "product" : "post",
      title, body, images:[], price, tags, status:"open",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    toast("상품/포스트가 등록되었습니다.");
  });

  async function ensureRegion(name){
    if (!db) return null;
    if(!name) return null;
    const q = await db.collection("regions").where("name","==",name).limit(1).get();
    if(q.docs[0]) return q.docs[0].id;
    const ref = await db.collection("regions").add({
      name, country:"VN", lang:["ko","en","vi"],
      desc:`${name} 지역 소개`, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return ref.id;
  }

  async function renderAgentPipes(){
    if (!db) return;
    if(!State.user || !State.agentDoc){
      $("#pipe-inquiries")?.innerHTML = `<div class="small">큰언니 프로필 저장 후 사용 가능합니다.</div>`;
      $("#pipe-orders")?.innerHTML    = `<div class="small">큰언니 프로필 저장 후 사용 가능합니다.</div>`;
      return;
    }
    const [inq, ord] = await Promise.all([
      db.collection("inquiries").where("agentId","==",State.agentDoc.id)
        .orderBy("createdAt","desc").limit(20).get().catch(async _=>{
          const qs = await db.collection("inquiries").where("agentId","==",State.agentDoc.id).limit(60).get();
          return { docs: qs.docs.sort((a,b)=>getTS(b.data().createdAt)-getTS(a.data().createdAt)).slice(0,20) };
        }),
      db.collection("orders").where("agentId","==",State.agentDoc.id)
        .orderBy("createdAt","desc").limit(20).get().catch(async _=>{
          const qs = await db.collection("orders").where("agentId","==",State.agentDoc.id).limit(60).get();
          return { docs: qs.docs.sort((a,b)=>getTS(b.data().createdAt)-getTS(a.data().createdAt)).slice(0,20) };
        }),
    ]);
    $("#pipe-inquiries")?.innerHTML = inq.docs.map(d=>{
      const i=d.data();
      return `<div class="item">
        <div class="row spread"><b>${esc(i.message)}</b><span class="badge">${i.status||"-"}</span></div>
        <div class="kit"><button class="btn outline" onclick="sendQuote('${d.id}')">견적 제시</button></div>
      </div>`;
    }).join("") || `<div class="small">문의 없음</div>`;

    $("#pipe-orders")?.innerHTML = ord.docs.map(d=>{
      const o=d.data();
      return `<div class="item">
        <div class="row spread"><b>주문 #${esc(o.id)}</b><span class="badge">${esc(o.status||"-")}</span></div>
        <div class="small">총액 ${fmt(o.total||0)} BET</div>
        <div class="kit"><button class="btn outline" onclick="confirmOrder('${o.id}')">체크아웃/정산(데모)</button></div>
      </div>`;
    }).join("") || `<div class="small">예약 없음</div>`;
  }

  window.sendQuote = async function(inquiryId){
    if (!db) return;
    if(!State.agentDoc){ toast("큰언니 프로필 필요"); return; }
    const amount = Number(prompt("견적 금액(BET):","100"));
    if(!(amount>0)) return;
    await db.collection("quotes").add({
      inquiryId, agentId: State.agentDoc.id, items:[], total: amount, currency:"BET",
      terms:"기본 약관", expiresAt: new Date(Date.now()+1000*60*60*24*3),
      status:"제출", createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection("inquiries").doc(inquiryId).set({ status:"견적" },{merge:true});
    toast("견적이 제출되었습니다.");
  };

  window.confirmOrder = async function(orderId){
    if (!db) return;
    await db.collection("orders").doc(orderId).set({ status:"완료" },{merge:true});
    toast("체크아웃 처리(데모).");
    renderAgentPipes();
  };

  /* ============== 운영자 콘솔(홈 섹션 안에 렌더) ============== */
  async function renderAdmin(){
    if (!db) return;
    if(!State.isAdmin){ toast("운영자만 접근 가능합니다."); return; }
    const MAX = 50;

    // 심사/대기
    let listA = [], listB = [];
    try{
      const q = await db.collection("agents").where("approved","==",false).orderBy("updatedAt","desc").limit(MAX).get();
      listA = q.docs;
    }catch(e){
      const q = await db.collection("agents").where("approved","==",false).limit(MAX).get();
      listA = q.docs.sort((a,b)=> getTS(b.data().updatedAt)-getTS(a.data().updatedAt));
      console.warn("agents(approved=false) local-sort fallback:", e?.message||e);
    }
    try{
      const q2 = await db.collection("agents").where("kycStatus","==","review").orderBy("updatedAt","desc").limit(MAX).get();
      listB = q2.docs;
    }catch(e){
      const q2 = await db.collection("agents").where("kycStatus","==","review").limit(MAX).get();
      listB = q2.docs.sort((a,b)=> getTS(b.data().updatedAt)-getTS(a.data().updatedAt));
      console.warn("agents(kycStatus=review) local-sort fallback:", e?.message||e);
    }

    // 렌더 위치: #admin-agents
    const uniq = new Map();
    [...listA, ...listB].forEach(d => uniq.set(d.id, d));
    const docs = [...uniq.values()];
    const el = $("#admin-agents");
    if (el){
      el.innerHTML = `<h3 style="margin:12px 0">승인 대기/심사 목록</h3>` +
        (docs.map(d=>{
          const a = d.data();
          return `<div class="item">
            <div class="row spread">
              <b>${esc(a.name||"-")} (${esc(a.region||"-")})</b>
              <span class="badge">${esc(a.kycStatus||"-")}</span>
            </div>
            <div class="small">${esc(a.bio||"")}</div>
            <div class="kit">
              <button class="btn" onclick="approveAgent('${d.id}')">승인</button>
              <button class="btn outline" onclick="rejectAgent('${d.id}')">반려</button>
            </div>
          </div>`;
        }).join("") || `<div class="small">대기 중인 큰언니 없음</div>`);
    }
  }

  window.approveAgent = async function(agentId){
    if (!db) return;
    if(!State.isAdmin){ toast("운영자만 접근 가능합니다."); return; }
    await db.collection("agents").doc(agentId).set({
      approved:true, kycStatus:"approved",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    },{ merge:true });
    await db.collection("agent_applications").add({
      agentId, action:"approved", status:"approved",
      actionByUid: State.user?.uid||null, actionByEmail: State.user?.email||null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    toast("승인 완료");
    renderAdmin();           // 목록 갱신
    refreshHome();           // 홈 카드 노출
  };

  window.rejectAgent = async function(agentId){
    if (!db) return;
    if(!State.isAdmin){ toast("운영자만 접근 가능합니다."); return; }
    await db.collection("agents").doc(agentId).set({
      approved:false, kycStatus:"rejected",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    },{ merge:true });
    await db.collection("agent_applications").add({
      agentId, action:"rejected", status:"rejected",
      actionByUid: State.user?.uid||null, actionByEmail: State.user?.email||null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    toast("반려 처리");
    renderAdmin();
  };

  /* ============== 초기 진입 ============== */
  document.addEventListener('DOMContentLoaded', ()=>{
    renderRoute();   // 현재 해시 기준으로 뷰 렌더
  });

  /* ============== 전역 공개 ============== */
  App.renderRoute        = renderRoute;
  App.refreshHome        = refreshHome;
  App.refreshMy          = refreshMy;
  App.refreshAgentState  = refreshAgentState;
  App.renderAgentPipes   = renderAgentPipes;
  App.renderAdmin        = renderAdmin;

})();
