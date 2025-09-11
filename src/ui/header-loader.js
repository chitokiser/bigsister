// /src/ui/header-loader.js — header/footer를 지정 폴더(LM_PARTIALS_BASE)에서만 로드 + 404 없는 폴백
(function () {
  "use strict";

  const BASE = (typeof window.LM_PARTIALS_BASE === "string" && window.LM_PARTIALS_BASE.trim())
    ? window.LM_PARTIALS_BASE.trim()
    : "partials/"; // 기본값: 현재 페이지 기준 ./partials/

  // BASE 정규화 (끝에 / 보장)
  const PARTIALS = BASE.endsWith("/") ? BASE : (BASE + "/");
  const HEADER_URL = PARTIALS + "header.html";
  const FOOTER_URL = PARTIALS + "footer.html";

  function ensureMount(id, position /* 'start' | 'end' */) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("div");
      el.id = id;
      if (position === "start") document.body.prepend(el);
      else document.body.appendChild(el);
    }
    return el;
  }

  function fallbackHeader() {
    return `
      <header style="padding:12px 16px;border-bottom:1px solid #222;background:#0b0d12;color:#eee">
        <div style="display:flex;align-items:center;gap:12px;max-width:1080px;margin:0 auto">
          <a href="index.html" style="font-weight:800;color:#fff;text-decoration:none">LocaMate</a>
          <nav style="margin-left:auto;display:flex;gap:10px">
            <a href="index.html" style="color:#ddd;text-decoration:none">홈</a>
            <a href="localmate.html" style="color:#ddd;text-decoration:none">내 콘솔</a>
            <a href="search.html" style="color:#ddd;text-decoration:none">검색</a>
            <a href="admin.html" style="color:#ddd;text-decoration:none">운영자</a>
          </nav>
        </div>
      </header>`;
  }

  function fallbackFooter() {
    const y = new Date().getFullYear();
    return `
      <footer style="margin-top:40px;padding:20px 16px;border-top:1px solid #222;background:#0b0d12;color:#9aa0a6">
        <div style="max-width:1080px;margin:0 auto;display:flex;justify-content:space-between;align-items:center">
          <div>© ${y} LocaMate</div>
          <div style="font-size:12px">Made for travelers & local hosts</div>
        </div>
      </footer>`;
  }

  function highlightActiveNav(root) {
    try {
      const current = (location.pathname.split("/").pop() || "index.html");
      root.querySelectorAll("a[href]").forEach(a => {
        const href = (a.getAttribute("href") || "").split("/").pop();
        if (href === current) a.classList.add("active");
      });
    } catch (_) {}
  }

  async function fetchSafe(url) {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (res.ok) return await res.text();
    } catch(_) {}
    return null;
  }

  async function loadHeaderFooter() {
    const headerMount = ensureMount("app-header", "start");
    const footerMount = ensureMount("app-footer", "end");

    // 지정된 경로만 시도 (추가 경로 시도 없음 → 불필요한 404 콘솔 없음)
    const [headerHtml, footerHtml] = await Promise.all([
      fetchSafe(HEADER_URL),
      fetchSafe(FOOTER_URL),
    ]);

    headerMount.innerHTML = headerHtml || fallbackHeader();
    footerMount.innerHTML = footerHtml || fallbackFooter();
    highlightActiveNav(headerMount);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadHeaderFooter, { once: true });
  } else {
    loadHeaderFooter();
  }
})();
