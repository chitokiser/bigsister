// console.js — 일부 발췌: 아래 두 블록만 교체

// 0) 작은 유틸(파일 상단 아무 곳)
function getTS(x){
  if (!x) return 0;
  if (typeof x.toMillis === 'function') return x.toMillis();
  if (x instanceof Date) return x.getTime();
  if (typeof x === 'number') return x;
  return 0;
}

/* ---- 에이전트 신청 버튼 ---- */
$("#agent-apply") && ($("#agent-apply").onclick = async ()=>{
  if(!State.user){ toast("로그인이 필요합니다."); return; }
  if(!State.agentDoc){ toast("먼저 프로필을 저장하세요."); return; }
  await db.collection("agents").doc(State.agentDoc.id).set({
    approved:false,
    kycStatus:"review",
    updatedAt: firebase.firestore.FieldValue.serverTimestamp() // ✅ 목록 정렬 필드 보장
  },{merge:true});
  toast("승인가입 신청이 접수되었습니다.");
  await refreshAgentState();
});

/* ---- 운영자 콘솔: 심사/대기 목록 ---- */
async function renderAdmin(){
  const MAX = 50;

  // A. approved == false
  let listA = [];
  try {
    const q = await db.collection("agents")
      .where("approved","==",false)
      .orderBy("updatedAt","desc")
      .limit(MAX).get();
    listA = q.docs;
  } catch (e) {
    // 🔁 인덱스 없을 때 폴백: where만 하고 클라 정렬
    const q = await db.collection("agents")
      .where("approved","==",false)
      .limit(MAX).get();
    listA = q.docs.sort((a,b)=> getTS(b.data().updatedAt)-getTS(a.data().updatedAt));
    console.warn("agents(approved=false) local-sort fallback:", e?.message||e);
  }

  // B. kycStatus == "review" (혹시 approved 필드가 아직 없는 문서 커버)
  let listB = [];
  try {
    const q2 = await db.collection("agents")
      .where("kycStatus","==","review")
      .orderBy("updatedAt","desc")
      .limit(MAX).get();
    listB = q2.docs;
  } catch (e) {
    const q2 = await db.collection("agents")
      .where("kycStatus","==","review")
      .limit(MAX).get();
    listB = q2.docs.sort((a,b)=> getTS(b.data().updatedAt)-getTS(a.data().updatedAt));
    console.warn("agents(kycStatus=review) local-sort fallback:", e?.message||e);
  }

  // 합치고 중복 제거
  const uniq = new Map();
  [...listA, ...listB].forEach(d => uniq.set(d.id, d));
  const docs = [...uniq.values()];

  $("#admin-agents") && ($("#admin-agents").innerHTML =
    docs.map(d=>{
      const a = d.data();
      return `<div class="item">
        <div class="row spread"><b>${App.esc(a.name||"-")} (${App.esc(a.region||"-")})</b>
          <span class="badge">${App.esc(a.kycStatus||"-")}</span></div>
        <div class="small">${App.esc(a.bio||"")}</div>
        <div class="kit">
          <button class="btn" onclick="approveAgent('${d.id}')">승인</button>
          <button class="btn outline" onclick="rejectAgent('${d.id}')">반려</button>
        </div>
      </div>`;
    }).join("") || `<div class="small">대기 중인 큰언니 없음</div>`
  );
}
