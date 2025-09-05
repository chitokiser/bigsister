/* console.js — Admin/Agent Console (cards refined)
 * - 큰언니 심사신청, 관리자 심사목록/승인/반려, 신청 히스토리
 * - 이벤트 위임(중복 바인딩 방지) + 안전 폴백
 */
(function(){
  'use strict';

  /* =============================
   * 0) 안전 헬퍼 (App.* 폴백)
   * ============================= */
  const $  = (s, el=document)=> (window.App?.$ ? App.$(s, el) : el.querySelector(s));
  const $$ = (s, el=document)=> (window.App?.$$ ? App.$$(s, el) : Array.from(el.querySelectorAll(s)));
  const toast = (m,t)=> (window.App?.toast ? App.toast(m,t) : alert(m));
  const esc = (s)=> (window.App?.esc ? App.esc(s) : (s||"").replace(/[&<>'"`]/g, m=>({
    "&":"&amp;","<":"&lt;","​>":"&gt;","'":"&#39;","\"":"&quot;","`":"&#96;"
  }[m])));
  const short = (a)=> (window.App?.short ? App.short(a) : (a ? a.slice(0,6)+"…"+a.slice(-4) : ""));
  const routeTo = (name)=> (window.App?.routeTo ? App.routeTo(name) : (location.hash = name==="home"?"#/":`#/${name}`));

  function getState(){
    const S = (window.App?.State) || (window.State) || {};
    return { user: S.user || null, agentDoc: S.agentDoc || null, isAdmin: !!S.isAdmin };
  }
  function fmtDateTime(x){
    try{ const d=x?.toDate?.()||x||null; return d ? new Date(d).toLocaleString() : ""; }
    catch(_){ return ""; }
  }
  function getTS(x){
    if (!x) return 0;
    if (typeof x.toMillis === 'function') return x.toMillis();
    if (x?.toDate) { try{ return x.toDate().getTime(); }catch(_){} }
    if (x instanceof Date) return x.getTime();
    if (typeof x === 'number') return x;
    return 0;
  }
  async function getDB(){
    if (window.App?.db) return App.db;
    if (window.firebase?.firestore) return firebase.firestore();
    for (let i=0;i<10;i++){
      await new Promise(r=>setTimeout(r, 50));
      if (window.App?.db) return App.db;
      if (window.firebase?.firestore) return firebase.firestore();
    }
    throw new Error("Firebase db not ready. Make sure core.js loads before console.js");
  }
  function requireAdmin(){
    try{
      if (getState().isAdmin) return true;
      toast("운영자만 접근 가능합니다.","warn");
      routeTo("home");
      return false;
    }catch(_){
      alert("운영자만 접근 가능합니다.");
      return false;
    }
  }

  /* =============================
   * 1) 카드 템플릿/스켈레톤
   * ============================= */
  function skeletonItem(){ return `<div class="item" style="opacity:.6">
    <div class="row spread">
      <b style="background:rgba(255,255,255,.08);height:16px;width:40%;border-radius:6px;"></b>
      <span class="badge" style="background:rgba(255,255,255,.08);color:#9aa3b2"> </span>
    </div>
    <div class="small" style="margin-top:6px;background:rgba(255,255,255,.06);height:14px;border-radius:6px;width:90%"></div>
  </div>`; }
  function renderSkeletonList(el, n=4){
    if(!el) return;
    el.innerHTML = Array.from({length:n}, skeletonItem).join("");
  }

  function agentCardHTML(a, id){
    const rgn = esc(a.region||"-");
    const nm  = esc(a.name||"큰언니");
    const bio = esc(a.bio||"");
    const kyc = esc(a.kycStatus||"-");
    const updated = fmtDateTime(a.updatedAt);
    const wallet = a.wallet ? short(String(a.wallet)) : "-";
    const owner = a.ownerUid ? short(String(a.ownerUid)) : "-";
    return `<div class="item" data-agent-id="${id}">
      <div class="row spread">
        <b>${nm} (${rgn})</b>
        <span class="badge">${kyc}</span>
      </div>
      <div class="small">지갑: ${esc(wallet)} · 소유자: ${esc(owner)}${updated?` · 업데이트: ${updated}`:""}</div>
      <div class="small" style="margin-top:6px">${bio}</div>
      <div class="kit" style="margin-top:8px">
        <button class="btn" data-action="approve" data-id="${id}">승인</button>
        <button class="btn outline" data-action="reject" data-id="${id}">반려</button>
      </div>
    </div>`;
  }
  function appHistoryCardHTML(it){
    const when = it.createdAt?.toDate?.() || it.createdAt || null;
    const by   = it.actionByEmail ? ` · by ${esc(it.actionByEmail)}` : "";
    const idS  = it.agentId ? short(String(it.agentId)) : "-";
    const ownS = it.ownerUid ? short(String(it.ownerUid)) : "-";
    return `<div class="item">
      <div class="row spread">
        <b>${esc((it.action||"submitted").toUpperCase())}</b>
        <span class="badge">${esc(it.status||"-")}</span>
      </div>
      <div class="small">
        agentId: ${esc(idS)} · region: ${esc(it.region||"-")}<br/>
        ownerUid: ${esc(ownS)}${by}${when?` · ${new Date(when).toLocaleString()}`:""}
      </div>
    </div>`;
  }

  /* ====================================
   * 2) 큰언니 '승인가입 신청' 버튼
   * ==================================== */
  document.addEventListener('DOMContentLoaded', ()=>{
    const btn = $("#agent-apply");
    if(!btn) return;

    btn.addEventListener("click", async ()=>{
      const { user, agentDoc } = getState();
      if(!user){ toast("로그인이 필요합니다."); return; }
      if(!agentDoc){ toast("먼저 프로필을 저장하세요."); return; }

      try{
        const DB = await getDB();
        // 상태 업데이트
        await DB.collection("agents").doc(agentDoc.id).set({
          approved:false,
          kycStatus:"review",
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        },{ merge:true });

        // 히스토리
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

        toast("승인가입 신청이 접수되었습니다.","ok");
        if (typeof window.refreshAgentState === "function") await window.refreshAgentState();
      }catch(e){
        console.error("[agent-apply] failed:", e);
        toast("신청 실패: " + (e?.message||e?.code||e), "err");
      }
    });
  });

  /* ======================================================
   * 3) 운영자 콘솔 렌더 (심사/대기 + 신청 히스토리)
   * ====================================================== */
  async function _renderAdminInner(){
    const DB = await getDB();
    const MAX = 50;

    const elList = $("#admin-agents");
    const elApps = $("#admin-agent-apps");

    if (elList) renderSkeletonList(elList, 4);
    if (elApps) renderSkeletonList(elApps, 3);

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

    // 심사/대기 목록
    if (elList){
      elList.innerHTML =
        docs.map(d=> agentCardHTML(d.data(), d.id)).join("") ||
        `<div class="small">대기 중인 큰언니 없음</div>`;
    }

    // 신청 히스토리
    if (elApps){
      try{
        const snap = await DB.collection("agent_applications")
          .orderBy("createdAt","desc").limit(50).get();
        const apps = snap.docs.map(d=>({ id:d.id, ...d.data() }));
        elApps.innerHTML =
          (apps.map(appHistoryCardHTML).join("")) ||
          `<div class="small">신청 내역 없음</div>`;
      }catch(e){
        const snap = await DB.collection("agent_applications").limit(200).get();
        const apps = snap.docs.map(d=>({ id:d.id, ...d.data() }))
          .sort((a,b)=> getTS(b.createdAt)-getTS(a.createdAt))
          .slice(0,50);
        console.warn("agent_applications: local-sort fallback:", e?.message||e);
        elApps.innerHTML =
          (apps.map(appHistoryCardHTML).join("")) ||
          `<div class="small">신청 내역 없음</div>`;
      }
    }
  }

  // 외부에서 호출 가능한 렌더러
  window.renderAdmin = async function(){
    if(!requireAdmin()) return;
    try{ await _renderAdminInner(); }
    catch(e){ console.error(e); toast("운영자 데이터 로드 실패: " + (e?.message||e), "err"); }
  };

  /* ==========================================
   * 4) 승인/반려 액션 (이벤트 위임)
   * ========================================== */
  async function doApprove(agentId, btn){
    if(!requireAdmin()) return;
    try{
      const DB = await getDB();
      btn && (btn.disabled = true);
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
      toast("승인 완료","ok");
      await _renderAdminInner();
      // 홈 카드에도 즉시 반영
      if (typeof window.refreshHome === "function") window.refreshHome();
    }catch(e){
      console.error(e);
      toast("승인 실패: " + (e?.message||e?.code||e), "err");
    }finally{
      btn && (btn.disabled = false);
    }
  }
  async function doReject(agentId, btn){
    if(!requireAdmin()) return;
    try{
      const DB = await getDB();
      btn && (btn.disabled = true);
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
      toast("반려 처리","ok");
      await _renderAdminInner();
    }catch(e){
      console.error(e);
      toast("반려 실패: " + (e?.message||e?.code||e), "err");
    }finally{
      btn && (btn.disabled = false);
    }
  }

  // 이벤트 위임: 관리자 목록 버튼
  document.addEventListener("click", (ev)=>{
    const container = $("#admin-agents");
    if (!container) return;
    if (!container.contains(ev.target)) return;

    const btn = ev.target.closest("button[data-action]");
    if (!btn) return;

    const id = btn.getAttribute("data-id");
    const action = btn.getAttribute("data-action");
    if (!id || !action) return;

    if (action === "approve") doApprove(id, btn);
    else if (action === "reject") doReject(id, btn);
  });

  // 전역 함수 호환 유지(기존 템플릿 호출 대비)
  window.approveAgent = (id)=> doApprove(id);
  window.rejectAgent  = (id)=> doReject(id);

  /* ======================================================
   * 5) (옵션) 별도 컬렉션 bigSisterApplications 뷰
   * ====================================================== */
  document.addEventListener('DOMContentLoaded', ()=>{
    const btn = $('#btn-show-bigsister-applications');
    const wrap = $('#bigSisterApplicationsList');
    if(!btn || !wrap) return;

    function renderSkeleton(){ renderSkeletonList(wrap, 3); }

    btn.addEventListener('click', async ()=>{
      if(!requireAdmin()) return;

      try{
        const DB = await getDB();
        renderSkeleton();

        let items=[];
        try{
          const snap = await DB.collection('bigSisterApplications')
                       .orderBy('timestamp','desc').limit(100).get();
          items = snap.docs.map(d=>({ id:d.id, ...d.data() }));
        }catch(e){
          const snap = await DB.collection('bigSisterApplications').limit(200).get();
          items = snap.docs.map(d=>({ id:d.id, ...d.data() }))
                   .sort((a,b)=> getTS(b.timestamp)-getTS(a.timestamp));
          console.warn("bigSisterApplications: local-sort fallback:", e?.message||e);
        }

        if(!items.length){
          wrap.innerHTML = '<div class="small">신청 내역이 없습니다.</div>';
          return;
        }

        wrap.innerHTML = items.map(it=>{
          const ts = it.timestamp ? fmtDateTime(it.timestamp) : 'N/A';
          return `<div class="item" data-bsapp-id="${esc(it.id)}">
            <div class="row spread">
              <b>${esc(it.name || 'N/A')}</b>
              <span class="badge">${esc(it.status || 'N/A')}</span>
            </div>
            <div class="small">이메일: ${esc(it.email || 'N/A')} · 전화: ${esc(it.phone || 'N/A')} · 신청일: ${esc(ts)}</div>
            <div class="small">지역: ${esc(it.region || 'N/A')}</div>
            <div class="small">소개: ${esc(it.bio || 'N/A')}</div>
            <div class="kit" style="margin-top:8px">
              <button class="btn" data-bsapp-action="set" data-status="approved" data-id="${esc(it.id)}">승인</button>
              <button class="btn outline" data-bsapp-action="set" data-status="rejected" data-id="${esc(it.id)}">거절</button>
            </div>
          </div>`;
        }).join("");

      }catch(err){
        console.error("Error fetching bigSisterApplications:", err);
        wrap.innerHTML = '<div class="small">신청 내역을 불러오는 데 오류가 발생했습니다.</div>';
      }
    });

    // 상태 변경 위임
    document.addEventListener('click', async (ev)=>{
      if (!wrap.contains(ev.target)) return;
      const btnAct = ev.target.closest('button[data-bsapp-action="set"]');
      if(!btnAct) return;
      if(!requireAdmin()) return;

      try{
        btnAct.disabled = true;
        const id = btnAct.dataset.id;
        const status = btnAct.dataset.status;
        const DB = await getDB();
        await DB.collection('bigSisterApplications').doc(id).update({ status });
        toast(`신청 ID: ${id} 상태가 ${status}로 업데이트되었습니다.`,"ok");
        // 간단 새로고침
        $('#btn-show-bigsister-applications')?.click();
      }catch(e){
        console.error(e);
        toast("상태 변경 실패: " + (e?.message||e?.code||e), "err");
      }finally{
        btnAct.disabled = false;
      }
    });
  });

})();
