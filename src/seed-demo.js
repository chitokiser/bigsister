/* src/seed-demo.js — 데모 데이터 시드 & 제거 (Firebase compat 전제) */
(function(){
  'use strict';

  // Firebase Firestore 핸들 안전 확보
  async function getDB(){
    if (window.App?.db) return App.db;
    if (window.firebase?.firestore) return firebase.firestore();
    // 아주 짧게 재시도
    for (let i=0;i<10;i++){
      await new Promise(r=>setTimeout(r, 50));
      if (window.App?.db) return App.db;
      if (window.firebase?.firestore) return firebase.firestore();
    }
    throw new Error("Firebase db not ready. Make sure Firebase is loaded before seed-demo.js");
  }

  // 지역 문서가 없으면 생성하고 id 반환
  async function ensureRegion(DB, name){
    if(!name) return null;
    const q = await DB.collection('regions').where('name','==',name).limit(1).get();
    if(q.docs[0]) return q.docs[0].id;
    const ref = await DB.collection('regions').add({
      name,
      country: "VN",
      lang: ["ko","en","vi"],
      desc: `${name} 지역 소개`,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return ref.id;
  }

  // 데모 시드: 지역 2개, 승인된 큰언니 1명(+상품), 심사대기 큰언니 1명, 공지 1개
  async function seedDemo(){
    const DB = await getDB();
    const user = (window.App?.State?.user)||null;
    const ownerUid = user?.uid || "demo";

    // 지역 확보
    const danangId  = await ensureRegion(DB, "다낭");
    const dongHoiId = await ensureRegion(DB, "동호이");

    // 승인된 큰언니 + 상품
    const agApprovedRef = await DB.collection("agents").add({
      ownerUid,
      name: "KE 다낭팀",
      bio: "공항픽업/투어/생활지원",
      region: "다낭",
      wallet: null,
      rating: 4.9,
      score: 88,
      badges: ["행정지원","교통지원"],
      kycStatus: "approved",
      approved: true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await DB.collection("posts").add({
      agentId: agApprovedRef.id,
      region: "다낭",
      regionId: danangId,
      type: "product",
      title: "다낭 시내 투어 (4h)",
      body: "전용차량+가이드 포함. 일정 커스텀 가능.",
      price: 120,
      tags: ["다낭","투어","교통"],
      status: "open",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // 심사 대기 큰언니 (홈에는 안나옴, 운영자 콘솔에서 승인 테스트용)
    await DB.collection("agents").add({
      ownerUid,
      name: "신규 큰언니(검토중)",
      bio: "심사 대기 예시",
      region: "동호이",
      wallet: null,
      rating: 5.0,
      score: 50,
      badges: ["로컬가이드"],
      kycStatus: "review",
      approved: false,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // 공지
    await DB.collection("notices").add({
      title: "파일럿 운영 중",
      body: "문의/예약은 데모 흐름을 통해 시험해보세요.",
      startAt: new Date(Date.now() - 3600_000),
      endAt: new Date(Date.now() + 3600_000 * 24 * 30),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  // 데모 제거(모든 주요 컬렉션)
  async function purgeDemo(){
    const DB = await getDB();
    const colls = [
      "regions","agents","posts","inquiries","quotes",
      "orders","vouchers","reviews","notices","agent_applications"
    ];
    for(const c of colls){
      // 대량일 수 있으니 반복 삭제
      /* eslint-disable no-constant-condition */
      while(true){
        const qs = await DB.collection(c).limit(200).get();
        if(qs.empty) break;
        const batch = DB.batch();
        qs.forEach(d=> batch.delete(d.ref));
        await batch.commit();
      }
    }
  }

  // 전역 노출 + 버튼 연결
  window.seedDemo  = seedDemo;
  window.purgeDemo = purgeDemo;

  document.addEventListener('DOMContentLoaded', ()=>{
    const toast = (m)=> (window.App?.toast ? App.toast(m) : alert(m));

    const seedBtn  = document.getElementById('seed-demo');
    const purgeBtn = document.getElementById('purge-demo');

    if(seedBtn){
      seedBtn.addEventListener('click', async ()=>{
        await seedDemo();
        toast("데모 데이터가 시드되었습니다.");
        if(window.refreshHome) await window.refreshHome();
      });
    }

    if(purgeBtn){
      purgeBtn.addEventListener('click', async ()=>{
        await purgeDemo();
        toast("데모 데이터가 삭제되었습니다.");
        if(window.refreshHome) await window.refreshHome();
      });
    }
  });

})();
