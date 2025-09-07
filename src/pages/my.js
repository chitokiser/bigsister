import { ensureLayout, requireAuth, toast } from '../core.js';
(async function(){
  await ensureLayout('my.html');
  await requireAuth('index.html');
  // TODO: 주문/바우처/리뷰 로딩 구현
  toast('마이 페이지는 곧 연결됩니다.');
})();
