// console.js — 큰언니 콘솔(프로필/파이프라인) + 운영자 콘솔(승인/바우처/공지/시드)
(function () {
  const { $, db, State, toast, fmt, esc } = window.App;

  /* ---- 큰언니 상태 ---- */
  async function refreshAgentState(){
    if(!State.user){ $("#agent-status") && ($("#agent-status").textContent="상태: 로그인 필요"); return; }
    const q = await db.collection("agents").where("ownerUid","==",State.user.uid).limit(1).get();
    State.agentDoc = q.docs[0] ? { id:q.docs[0].id, ...q.docs[0].data() } : null;
    $("#agent-status") && ($("#agent-status").textContent = "상태: " + (State.agentDoc ? (State.agentDoc.approved?"승인됨":"심사중") : "미가입"));
    if(State.agentDoc){
      $("#agent-name") && ($("#agent-name").value = State.agentDoc.name||"");
      $("#agent-bio") && ($("#agent-bio").value = State.agentDoc.bio||"");
      $("#agent-region") && ($("#agent-region").value = State.agentDoc.region||"");
      $("#agent-wallet") && ($("#agent-wallet").value = State.agentDoc.wallet||"");
    }else{
      $("#agent-name") && ($("#agent-name").value = "");
      $("#agent-bio") && ($("#agent-bio").value = "");
      $("#agent-region") && ($("#agent-region").value = "");
      $("#agent-wallet") && ($("#agent-wallet").value = "");
    }
  }

  $("#agent-save") && ($("#agent-save").onclick = async ()=>{
    if(!State.user){ toast("로그인이 필요합니다."); return; }
    const payload = {
      ownerUid: State.user.uid,
      name: $("#agent-name").value||"큰언니",
      bio: $("#agent-bio").value||"",
      region: $("#agent-region").value||"",
      wallet: $("#agent-wallet").value||State.wallet||null,
      rating: State.agentDoc?.rating || 5.0,
      score: State.agentDoc?.score || 50,
      kycStatus: State.agentDoc?.kycStatus || "pending",
      approved: State.agentDoc?.approved || false,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    let id = State.agentDoc?.id;
    if(id){ await db.collection("agents").doc(id).set(payload,{merge:true}); }
    else  { const ref = await db.collection("agents").add(payload); id = ref.id; }
    toast("큰언니 프로필이 저장되었습니다."); await refreshAgentState();
  });

  $("#agent-apply") && ($("#agent-apply").onclick = async ()=>{
    if(!State.user){ toast("로그인이 필요합니다."); return; }
    if(!State.agentDoc){ toast("먼저 프로필을 저장하세요."); return; }
    await db.collection("agents").doc(State.agentDoc.id).set({ approved:false, kycStatus:"review" },{merge:true});
    toast("승인가입 신청이 접수되었습니다."); await refreshAgentState();
  });

  $("#post-create") && ($("#post-create").onclick = async ()=>{
    if(!State.user || !State.agentDoc){ toast("큰언니 프로필 필요"); return; }
    const title = $("#post-title").value||"";
    const body  = $("#post-body").value||"";
    const price = Number($("#post-price").value||0);
    const tags  = ($("#post-tags").value||"").split(",").map(s=>s.trim()).filter(Boolean);
    if(!title){ toast("제목을 입력하세요."); return; }
    const regionId = await ensureRegion(State.agentDoc.region);
    await db.collection("posts").add({
      agentId: State.agentDoc.id, agentWallet: State.agentDoc.wallet||null,
      regionId, region: State.agentDoc.region||"",
      type:"product", title, body, images:[], price, tags, status:"open",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    toast("상품/포스트가 등록되었습니다.");
  });

  async function ensureRegion(name){
    if(!name) return null;
    const q = await db.collection("regions").where("name","==",name).limit(1).get();
    if(q.docs[0]) return q.docs[0].id;
    const ref = await db.collection("regions").add({
      name, country:"VN", lang:["ko","en","vi"],
      desc:`${name} 지역 소개`, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return ref.id;
  }

  async function renderAgentPipes(){
    if(!State.user || !State.agentDoc){
      $("#pipe-inquiries") && ($("#pipe-inquiries").innerHTML = `<div class="small">큰언니 프로필 저장 후 사용 가능합니다.</div>`);
      $("#pipe-orders") && ($("#pipe-orders").innerHTML = `<div class="small">큰언니 프로필 저장 후 사용 가능합니다.</div>`);
      return;
    }
    const [inq, ord] = await Promise.all([
      db.collection("inquiries").where("agentId","==",State.agentDoc.id).orderBy("createdAt","desc").limit(20).get(),
      db.collection("orders").where("agentId","==",State.agentDoc.id).orderBy("createdAt","desc").limit(20).get(),
    ]);
    $("#pipe-inquiries") && ($("#pipe-inquiries").innerHTML = inq.docs.map(d=>{
      const i=d.data();
      return `<div class="item">
        <div class="row spread"><b>${esc(i.message)}</b><span class="badge">${i.status||"-"}</span></div>
        <div class="kit"><button class="btn outline" onclick="sendQuote('${d.id}')">견적 제시</button></div>
      </div>`;
    }).join("") || `<div class="small">문의 없음</div>`);

    $("#pipe-orders") && ($("#pipe-orders").innerHTML = ord.docs.map(d=>{
      const o=d.data();
      return `<div class="item">
        <div class="row spread"><b>주문 #${esc(o.id)}</b><span class="badge">${esc(o.status)}</span></div>
        <div class="small">총액 ${fmt(o.total)} BET</div>
        <div class="kit"><button class="btn outline" onclick="confirmOrder('${o.id}')">체크아웃/정산(데모)</button></div>
      </div>`;
    }).join("") || `<div class="small">예약 없음</div>`);
  }

  async function sendQuote(inquiryId){
    const amount = Number(prompt("견적 금액(BET):","100"));
    if(!(amount>0)) return;
    await db.collection("quotes").add({
      inquiryId, agentId: State.agentDoc.id, items:[], total: amount, currency:"BET",
      terms:"기본 약관", expiresAt: new Date(Date.now()+1000*60*60*24*3),
      status:"제출", createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await db.collection("inquiries").doc(inquiryId).set({ status:"견적" },{merge:true});
    toast("견적이 제출되었습니다.");
  }

  async function confirmOrder(orderId){
    await db.collection("orders").doc(orderId).set({ status:"완료" },{merge:true});
    toast("체크아웃 처리(데모). (온체인 정산/릴리즈 연동 지점)");
    renderAgentPipes();
  }

  /* ---- 운영자 콘솔 ---- */
  async function renderAdmin(){
    const q = await db.collection("agents").where("approved","==",false).orderBy("updatedAt","desc").limit(20).get().catch(()=>({docs:[]}));
    $("#admin-agents") && ($("#admin-agents").innerHTML = q.docs.map(d=>{
      const a=d.data();
      return `<div class="item">
        <div class="row spread"><b>${esc(a.name||"-")} (${esc(a.region||"-")})</b><span class="badge">${esc(a.kycStatus||"-")}</span></div>
        <div class="small">${esc(a.bio||"")}</div>
        <div class="kit">
          <button class="btn" onclick="approveAgent('${d.id}')">승인</button>
          <button class="btn outline" onclick="rejectAgent('${d.id}')">반려</button>
        </div>
      </div>`;
    }).join("") || `<div class="small">대기 중인 큰언니 없음</div>`);

    const vs = await db.collection("vouchers").orderBy("createdAt","desc").limit(20).get().catch(()=>({docs:[]}));
    $("#v-issued") && ($("#v-issued").innerHTML = vs.docs.map(d=>{
      const v=d.data();
      return `<div class="item">
        <div class="row spread"><b>${esc(v.id)}</b><span class="badge">${esc(v.status||"-")}</span></div>
        <div class="small">scope: ${esc(v.scope||"-")} · face: ${esc(v.faceValue||0)} · expiry: ${new Date(v.expiry?.toDate?.()||v.expiry).toLocaleDateString()}</div>
      </div>`;
    }).join("") || `<div class="small">발행 없음</div>`);

    const ns = await db.collection("notices").orderBy("startAt","desc").limit(20).get().catch(()=>({docs:[]}));
    $("#n-list") && ($("#n-list").innerHTML = ns.docs.map(d=>{
      const n=d.data();
      return `<div class="item"><b>${esc(n.title)}</b><div class="small">${esc(n.body||"")}</div></div>`;
    }).join("") || `<div class="small">공지 없음</div>`);
  }

  async function approveAgent(agentId){
    await db.collection("agents").doc(agentId).set({ approved:true, kycStatus:"approved" },{merge:true});
    toast("승인 완료"); renderAdmin();
  }
  async function rejectAgent(agentId){
    await db.collection("agents").doc(agentId).set({ approved:false, kycStatus:"rejected" },{merge:true});
    toast("반려 처리"); renderAdmin();
  }

  /* ---- 바우처/공지 ---- */
  $("#v-issue") && ($("#v-issue").onclick = async ()=>{
    const scope = $("#v-region").value || "global";
    const face  = Number($("#v-face").value||0);
    const exp   = $("#v-exp").value ? new Date($("#v-exp").value) : new Date(Date.now()+1000*60*60*24*30);
    const id = "V"+Math.random().toString(36).slice(2,9);
    await db.collection("vouchers").doc(id).set({
      id, scope, faceValue:face, rules:{}, expiry:exp, supply:1, claimed:0, redeemed:0, status:"issued",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    toast("바우처가 발행되었습니다."); renderAdmin();
  });

  $("#n-publish") && ($("#n-publish").onclick = async ()=>{
    const title = $("#n-title").value||"";
    const body  = $("#n-body").value||"";
    if(!title){ toast("제목을 입력하세요."); return; }
    await db.collection("notices").add({
      title, body, pinned:false,
      startAt:new Date(Date.now()-60000),
      endAt:new Date(Date.now()+1000*60*60*24*7),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    $("#n-title").value = $("#n-body").value = "";
    toast("공지 발행됨"); renderAdmin();
  });

  /* ---- 데모 데이터 ---- */
  $("#seed-demo") && ($("#seed-demo").onclick = async ()=>{
    await db.collection("regions").add({ name:"다낭", country:"VN", lang:["ko","en","vi"], desc:"해양/미식/액티비티 허브", createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    await db.collection("regions").add({ name:"동호이", country:"VN", lang:["ko","en","vi"], desc:"동굴/자연/로컬", createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    const agentRef = await db.collection("agents").add({
      ownerUid: State.user?.uid || "demo",
      name:"KE 다낭팀", bio:"공항픽업/투어/생활지원", region:"다낭", wallet:null,
      rating:4.9, score:88, badges:["행정지원","교통지원"], kycStatus:"approved", approved:true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await db.collection("posts").add({
      agentId: agentRef.id, region:"다낭", regionId:null,
      type:"product", title:"다낭 시내 투어 (4h)", body:"전용차량+가이드 포함. 일정 커스텀 가능.", price:120, tags:["다낭","투어","교통"], status:"open",
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    await db.collection("notices").add({
      title:"파일럿 운영 중", body:"문의/예약은 데모 흐름을 통해 시험해보세요.",
      startAt:new Date(Date.now()-3600_000), endAt:new Date(Date.now()+3600_000*24*30),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    toast("데모 데이터가 시드되었습니다."); renderAdmin();
  });

  $("#purge-demo") && ($("#purge-demo").onclick = async ()=>{
    const colls = ["regions","agents","posts","inquiries","quotes","orders","vouchers","reviews","notices"];
    for(const c of colls){
      const qs = await db.collection(c).limit(50).get();
      const batch = db.batch(); qs.forEach(d=>batch.delete(d.ref)); await batch.commit();
    }
    toast("데모 데이터가 삭제되었습니다."); renderAdmin(); refreshAgentState();
  });

  /* ---- 전역 export ---- */
  window.sendQuote   = sendQuote;
  window.confirmOrder= confirmOrder;
  window.approveAgent= approveAgent;
  window.rejectAgent = rejectAgent;

  /* ---- App 이벤트 ---- */
  window.addEventListener("app:auth", ()=> refreshAgentState());
  window.addEventListener("app:route", ({detail:{route}})=>{
    if(route==="agent") renderAgentPipes();
    if(route==="admin") renderAdmin();
  });

  refreshAgentState();
})();
