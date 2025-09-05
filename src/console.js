/* console.js — drop-in replacement */
(function(){
  'use strict';

  /* =============================
   * 0) 안전 헬퍼 (App.* 폴백 처리)
   * ============================= */
  const $  = (s, el=document)=> (window.App?.$ ? App.$(s, el) : el.querySelector(s));
  const $$ = (s, el=document)=> (window.App?.$$ ? App.$$(s, el) : Array.from(el.querySelectorAll(s)));
  const toast = (m)=> (window.App?.toast ? App.toast(m) : alert(m));
  const esc = (s)=> (window.App?.esc ? App.esc(s) : (s||"").replace(/[&<>'"`]/g, m=>({
    "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;","`":"&#96;"
  }[m])));

  function getState(){
    // core.js에서 window.App.State를 노출하고 있음
    const S = (window.App?.State) || (window.State) || {};
    return {
      user: S.user || null,
      agentDoc: S.agentDoc || null,
      isAdmin: !!S.isAdmin
    };
  }

  function fmtDateTime(x){
    try{
      const d = x?.toDate?.() || x || null;
      return d ? new Date(d).toLocaleString() : "";
    }catch(_){ return ""; }
  }

  function getTS(x){
    if (!x) return 0;
    if (typeof x.toMillis === 'function') return x.toMillis();  // Firestore Timestamp
    if (x?.toDate) { try{ return x.toDate().getTime(); }catch(_){} }
    if (x instanceof Date) return x.getTime();
    if (typeof x === 'number') return x;
    return 0;
  }

  // Firebase db 안전 참조 (로드 순서 이슈 방지)
  async function getDB(){
    if (window.App?.db) return App.db;
    if (window.firebase?.firestore) return firebase.firestore();
    // 짧은 재시도
    for (let i=0;i<10;i++){
      await new Promise(r=>setTimeout(r, 50));
      if (window.App?.db) return App.db;
      if (window.firebase?.firestore) return firebase.firestore();
    }
    throw new Error("Firebase db not ready. Make sure core.js loads before console.js");
  }

  // 운영자 가드(라우팅까지)
  function requireAdmin(){
    try{
      if (getState().isAdmin) return true;
      toast("운영자만 접근 가능합니다.");
      window.App?.routeTo && App.routeTo("home");
      return false;
    }catch(_){
      alert("운영자만 접근 가능합니다.");
      return false;
    }
  }

  /* ====================================
   * 1) 큰언니 '승인가입 신청' 버튼 (#agent-apply)
   * ==================================== */
  document.addEventListener('DOMContentLoaded', ()=>{
    const btn = $("#agent-apply");
    if(!btn) return;
    btn.addEventListener("click", async ()=>{
      const { user, agentDoc } = getState();
      if(!user){ toast("로그인이 필요합니다."); return; }
      if(!agentDoc){ toast("먼저 프로필을 저장하세요."); return; }

      const DB = await getDB();

      // agents 문서 상태 업데이트
      await DB.collection("agents").doc(agentDoc.id).set({
        approved:false,
        kycStatus:"review",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      },{ merge:true });

      // 신청 로그 기록 (히스토리)
      await DB.collection("agent_applications").add({
        agentId: agentDoc.id,
        ownerUid: user.uid,
        name: $("#agent-name")?.value || agentDoc.name || "큰언니",
        region: $("#agent-region")?.value || agentDoc.region || "",
        wallet: $("#agent-wallet")?.value || agentDoc.wallet || null,
        bio: $("#agent-bio")?.value || agentDoc.bio || "",
        action: "submitted",
        status: "review",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      toast("승인가입 신청이 접수되었습니다.");
      if (typeof window.refreshAgentState === "function") {
        await window.refreshAgentState();
      }
    });
  });

  /* ======================================================
   * 2) 운영자 콘솔: 심사/대기 목록 + 신청 히스토리 렌더
   *    - #admin-agents       : 대기/심사 목록
   *    - #admin-agent-apps   : 신청 히스토리
   * ====================================================== */
  async function _renderAdminInner(){
    const DB = await getDB();
    const MAX = 50;

    // A. approved == false
    let listA = [];
    try {
      const q = await DB.collection("agents")
        .where("approved","==",false)
        .orderBy("updatedAt","desc")
        .limit(MAX).get();
      listA = q.docs;
    } catch (e) {
      const q = await DB.collection("agents")
        .where("approved","==",false)
        .limit(MAX).get();
      listA = q.docs.sort((a,b)=> getTS(b.data().updatedAt)-getTS(a.data().updatedAt));
      console.warn("agents(approved=false) local-sort fallback:", e?.message||e);
    }

    // B. kycStatus == "review"
    let listB = [];
    try {
      const q2 = await DB.collection("agents")
        .where("kycStatus","==","review")
        .orderBy("updatedAt","desc")
        .limit(MAX).get();
      listB = q2.docs;
    } catch (e) {
      const q2 = await DB.collection("agents")
        .where("kycStatus","==","review")
        .limit(MAX).get();
      listB = q2.docs.sort((a,b)=> getTS(b.data().updatedAt)-getTS(a.data().updatedAt));
      console.warn("agents(kycStatus=review) local-sort fallback:", e?.message||e);
    }

    // 합치고 중복 제거
    const uniq = new Map();
    [...listA, ...listB].forEach(d => uniq.set(d.id, d));
    const docs = [...uniq.values()];

    // 심사/대기 목록 렌더
    const elA = $("#admin-agents");
    if (elA){
      elA.innerHTML =
        docs.map(d=>{
          const a = d.data();
          return `<div class="item">
            <div class="row spread"><b>${esc(a.name||"-")} (${esc(a.region||"-")})</b>
              <span class="badge">${esc(a.kycStatus||"-")}</span></div>
            <div class="small">${esc(a.bio||"")}</div>
            <div class="kit">
              <button class="btn" onclick="approveAgent('${d.id}')">승인</button>
              <button class="btn outline" onclick="rejectAgent('${d.id}')">반려</button>
            </div>
          </div>`;
        }).join("") || `<div class="small">대기 중인 큰언니 없음</div>`;
    }

    // 신청 히스토리 렌더 (agent_applications)
    const elApps = $("#admin-agent-apps");
    if (elApps){
      let apps = [];
      try{
        const snap = await DB.collection("agent_applications")
          .orderBy("createdAt","desc").limit(50).get();
        apps = snap.docs.map(d=>({ id:d.id, ...d.data() }));
      }catch(e){
        const snap = await DB.collection("agent_applications").limit(200).get();
        apps = snap.docs.map(d=>({ id:d.id, ...d.data() }))
          .sort((a,b)=> getTS(b.createdAt)-getTS(a.createdAt))
          .slice(0,50);
        console.warn("agent_applications: local-sort fallback:", e?.message||e);
      }

      elApps.innerHTML =
        (apps.map(it=>{
          const when = it.createdAt?.toDate?.() || it.createdAt || null;
          return `<div class="item">
            <div class="row spread">
              <b>${esc((it.action||"submitted").toUpperCase())}</b>
              <span class="badge">${esc(it.status||"-")}</span>
            </div>
            <div class="small">
              agentId: ${esc(it.agentId||"-")} · region: ${esc(it.region||"-")}<br/>
              ownerUid: ${esc(it.ownerUid||"-")}
              ${it.actionByEmail? ` · by ${esc(it.actionByEmail)}`:""}
              ${when? ` · ${new Date(when).toLocaleString()}`:""}
            </div>
          </div>`;
        }).join("")) || `<div class="small">신청 내역 없음</div>`;
    }
  }

  // 외부에서 호출 가능한 렌더러 (관리자 가드 포함)
  window.renderAdmin = async function(){
    if(!requireAdmin()) return;
    await _renderAdminInner();
  };

  /* ==========================================
   * 3) 승인/반려 액션 (관리자 가드 + 히스토리 기록)
   * ========================================== */
  window.approveAgent = async function(agentId){
    if(!requireAdmin()) return;
    const DB = await getDB();

    await DB.collection("agents").doc(agentId).set({
      approved:true, kycStatus:"approved",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    },{ merge:true });

    const ag = await DB.collection("agents").doc(agentId).get();
    await DB.collection("agent_applications").add({
      agentId,
      ownerUid: ag.exists ? (ag.data().ownerUid || null) : null,
      action: "approved",
      status: "approved",
      actionByUid: (window.App?.State?.user?.uid)||null,
      actionByEmail: (window.App?.State?.user?.email)||null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    toast("승인 완료");
    await _renderAdminInner();
  };

  window.rejectAgent = async function(agentId){
    if(!requireAdmin()) return;
    const DB = await getDB();

    await DB.collection("agents").doc(agentId).set({
      approved:false, kycStatus:"rejected",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    },{ merge:true });

    const ag = await DB.collection("agents").doc(agentId).get();
    await DB.collection("agent_applications").add({
      agentId,
      ownerUid: ag.exists ? (ag.data().ownerUid || null) : null,
      action: "rejected",
      status: "rejected",
      actionByUid: (window.App?.State?.user?.uid)||null,
      actionByEmail: (window.App?.State?.user?.email)||null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    toast("반려 처리");
    await _renderAdminInner();
  };

  /* ======================================================
   * 4) 별도 버튼으로 'bigSisterApplications' 컬렉션 보기 (옵션)
   *    - HTML에 아래 요소가 있을 때만 동작:
   *      #btn-show-bigsister-applications, #bigSisterApplicationsList
   * ====================================================== */
  document.addEventListener('DOMContentLoaded', ()=>{
    const btn = $('#btn-show-bigsister-applications');
    if(!btn) return;

    btn.addEventListener('click', async ()=>{
      if(!requireAdmin()) return;

      const DB = await getDB();
      const wrap = $('#bigSisterApplicationsList');
      if (!wrap) return;

      wrap.innerHTML = '<h3>큰언니 심사 신청 내역</h3>';

      try{
        let snap, items=[];
        try{
          snap = await DB.collection('bigSisterApplications')
                   .orderBy('timestamp','desc').limit(100).get();
          items = snap.docs.map(d=>({ id:d.id, ...d.data() }));
        }catch(e){
          snap = await DB.collection('bigSisterApplications').limit(200).get();
          items = snap.docs.map(d=>({ id:d.id, ...d.data() }))
                   .sort((a,b)=> getTS(b.timestamp)-getTS(a.timestamp));
          console.warn("bigSisterApplications: local-sort fallback:", e?.message||e);
        }

        if(!items.length){
          wrap.innerHTML += '<p>신청 내역이 없습니다.</p>';
          return;
        }

        items.forEach(it=>{
          const timestamp = it.timestamp ? fmtDateTime(it.timestamp) : 'N/A';
          const div = document.createElement('div');
          div.className = 'card application-item';
          div.innerHTML = `
            <h4>신청자: ${esc(it.name || 'N/A')}</h4>
            <p>이메일: ${esc(it.email || 'N/A')}</p>
            <p>전화번호: ${esc(it.phone || 'N/A')}</p>
            <p>상태: ${esc(it.status || 'N/A')}</p>
            <p>신청일: ${esc(timestamp)}</p>
            <p>소개: ${esc(it.bio || 'N/A')}</p>
            <p>지역: ${esc(it.region || 'N/A')}</p>
            <button class="btn approve-btn" data-id="${it.id}" data-status="approved">승인</button>
            <button class="btn subtle reject-btn" data-id="${it.id}" data-status="rejected">거절</button>
          `;
          wrap.appendChild(div);
        });

        // 승인/거절 버튼 이벤트
        wrap.querySelectorAll('.approve-btn, .reject-btn').forEach(button=>{
          button.addEventListener('click', async (ev)=>{
            if(!requireAdmin()) return;
            const appId = ev.currentTarget.dataset.id;
            const newStatus = ev.currentTarget.dataset.status;
            const DB2 = await getDB();
            await DB2.collection('bigSisterApplications').doc(appId).update({ status: newStatus });
            toast(`신청 ID: ${appId} 상태가 ${newStatus}로 업데이트되었습니다.`);
            btn.click(); // 새로고침
          });
        });

      }catch(err){
        console.error("Error fetching bigSisterApplications:", err);
        wrap.innerHTML += '<p>신청 내역을 불러오는 데 오류가 발생했습니다.</p>';
      }
    });
  });

  /* ======================================================
   * 5) 팝업 로그인 에러 핸들링 (옵션: core.js의 버튼 핸들러 참고)
   *    - COOP 경고는 서버 헤더 same-origin-allow-popups로 완화 가능
   * ====================================================== */
  // 이 파일에서는 로그인 핸들러를 만들지 않습니다. (core.js에 이미 존재한다고 가정)

})();
