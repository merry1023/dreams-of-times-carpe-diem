// book.js
// ★要望対応：種類が「本」のアイテムをインベントリ等で「使う」と、実際にページをめくって読める。
//   本の中身（ページごとの本文）は、アイテム編集（シナリオビルド）側でmaster.pagesとして設定する。
//   本自体は消費しない（読んでもインベントリからは無くならない）。

let bookReadingPageIndex = 0;
let bookReadingResolve = null;
let bookReadingListenerActive = false;

// ★開いている間はisGameDialogOpenを立てて、裏の画面（部屋の中・町など）が矢印キー等で
//   動いてしまわないようにする（要望対応：収納・本棚と同じ考え方で背景を止める）
function openBookReadingModal(master) {
  return new Promise(resolve => {
    const overlay = document.getElementById("book-reading-overlay");
    const titleEl = document.getElementById("book-reading-title");
    const bodyEl = document.getElementById("book-reading-body");
    const pageEl = document.getElementById("book-reading-page-indicator");
    const prevBtn = document.getElementById("book-reading-prev");
    const nextBtn = document.getElementById("book-reading-next");
    const closeBtn = document.getElementById("book-reading-close");
    if (!overlay || !bodyEl) { resolve(); return; }
    
    const pages = (master && Array.isArray(master.pages) && master.pages.length > 0)
      ? master.pages
      : ["（この本には何も書かれていないようだ……）"];
    bookReadingPageIndex = 0;
    bookReadingResolve = resolve;
    
    if (titleEl) titleEl.textContent = (master && master.name) || "本";
    
    function render() {
      if (bookReadingPageIndex < 0) bookReadingPageIndex = 0;
      if (bookReadingPageIndex > pages.length - 1) bookReadingPageIndex = pages.length - 1;
      bodyEl.textContent = pages[bookReadingPageIndex] || "（このページは白紙のようだ……）";
      if (pageEl) pageEl.textContent = `${bookReadingPageIndex + 1} / ${pages.length}`;
      if (prevBtn) prevBtn.disabled = bookReadingPageIndex <= 0;
      if (nextBtn) nextBtn.disabled = bookReadingPageIndex >= pages.length - 1;
    }
    
    function goPrev() { if (bookReadingPageIndex > 0) { bookReadingPageIndex--; render(); } }
    function goNext() { if (bookReadingPageIndex < pages.length - 1) { bookReadingPageIndex++; render(); } }
    
    function cleanup() {
      overlay.classList.add("hidden");
      isGameDialogOpen = false; // mainfunc.js（背景をロックしていたフラグを解除する）
      if (bookReadingListenerActive) { window.removeEventListener("keydown", handleKeyDown); bookReadingListenerActive = false; }
      if (prevBtn) prevBtn.onclick = null;
      if (nextBtn) nextBtn.onclick = null;
      if (closeBtn) closeBtn.onclick = null;
      const doResolve = bookReadingResolve;
      bookReadingResolve = null;
      if (doResolve) doResolve();
    }
    
    function handleKeyDown(event) {
      if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★シナリオエディタ表示中は本編を操作させない
      if (event.repeat) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); goPrev(); }
      else if (event.key === "ArrowRight") { event.preventDefault(); goNext(); }
      else if (event.key === "x" || event.key === "X" || event.key === "Escape" || event.key === "z" || event.key === "Z" || event.key === " ") {
        event.preventDefault();
        cleanup();
      }
    }
    
    if (prevBtn) prevBtn.onclick = (event) => { event.stopPropagation(); goPrev(); };
    if (nextBtn) nextBtn.onclick = (event) => { event.stopPropagation(); goNext(); };
    if (closeBtn) closeBtn.onclick = (event) => { event.stopPropagation(); cleanup(); };
    
    window.addEventListener("keydown", handleKeyDown);
    bookReadingListenerActive = true;
    isGameDialogOpen = true; // mainfunc.js（他画面のキー操作を止める共通フラグを流用して背景をロックする）
    overlay.classList.remove("hidden");
    render();
  });
}
