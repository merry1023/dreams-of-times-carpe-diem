// layoutadjust.js
// ===================================================================
// ===== シナリオエディタ：レイアウト調整（左右の幅をつまみで変える） =====
// ===================================================================
// ★左（メイン：話一覧／ブロックエディタ）と右（サブ：キャラ・敵・各種タブ）の境目に「つまみ」を出し、ドラッグで幅を変える。
// ★誤操作を防ぐため、つまみは「データ・システム」グループの「レイアウト調整」タブを開いている間だけ出る。
//   他のタブへ移るとつまみは消えるが、決めた幅はそのまま残る（このブラウザの localStorage に保存。他の端末には反映されない）。
// ★幅は「左（メイン）が全体の何%か」で持つ。初期値は 60%（＝今までの 6:4）。
// ★使う側（scenariobuild.js）：
//   ・SCENARIOBUILD_SUB_TABS に { view: "layoutadjust" } を足してある
//   ・renderScenarioBuildSub() の頭で laSyncAdjustMode() を呼ぶ（このタブを開いている間だけつまみを出す）
//   ・タブの中身は renderLayoutAdjustPanel(container)

const LA_STORAGE_KEY = "scenariobuild_layout_v1";
const LA_DEFAULT_MAIN_PERCENT = 60;
const LA_MIN_PERCENT = 25;   // これより左を細くすると、ブロックの編集が窮屈になるので下限を決める
const LA_MAX_PERCENT = 80;   // これより右を細くすると、タブが読めなくなるので上限を決める
const LA_HANDLE_PX = 12;     // つまみの太さ（CSS の .scenariobuild-resizer と合わせる）

let laMainPercent = LA_DEFAULT_MAIN_PERCENT;
let laCustom = false;        // 一度でも幅を決めたか（false の間は CSS の既定＝6:4 のまま）
let laSliderSync = null;     // 開いているタブの中のスライダーを、つまみの動きに合わせて更新する関数

function laClamp(v) {
  const n = Number(v);
  return Math.min(LA_MAX_PERCENT, Math.max(LA_MIN_PERCENT, Number.isFinite(n) ? n : LA_DEFAULT_MAIN_PERCENT));
}

function laLoad() {
  try {
    const raw = localStorage.getItem(LA_STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data && Number.isFinite(Number(data.mainPercent))) {
      laMainPercent = laClamp(data.mainPercent);
      laCustom = true;
    }
  } catch (e) { /* 保存データが壊れていても、既定の幅で続ける */ }
}

function laSave() {
  try {
    if (laCustom) localStorage.setItem(LA_STORAGE_KEY, JSON.stringify({ mainPercent: Math.round(laMainPercent * 10) / 10 }));
    else localStorage.removeItem(LA_STORAGE_KEY);
  } catch (e) { /* 保存できない環境では、今回の画面だけ反映する */ }
}

function laGetSplit() { return document.querySelector(".scenariobuild-split"); }
function laGetHandle() { return document.getElementById("scenariobuild-resizer"); }

// 今の幅を画面に反映する（CSS 側は [data-layout-custom] の時だけ変数を使う）
function laApply() {
  const split = laGetSplit();
  if (!split) return;
  if (laCustom) {
    split.setAttribute("data-layout-custom", "1");
    split.style.setProperty("--sb-main-percent", laMainPercent + "%");
  } else {
    split.removeAttribute("data-layout-custom");
    split.style.removeProperty("--sb-main-percent");
  }
  const handle = laGetHandle();
  if (handle) {
    handle.setAttribute("aria-valuenow", String(Math.round(laMainPercent)));
    handle.title = `左 ${Math.round(laMainPercent)}% ／ 右 ${100 - Math.round(laMainPercent)}%（ドラッグで変更・ダブルクリックで初期値）`;
  }
  if (typeof laSliderSync === "function") laSliderSync();
}

function laSetPercent(percent, save) {
  laMainPercent = laClamp(percent);
  laCustom = true;
  laApply();
  if (save) laSave();
}

function laReset() {
  laMainPercent = LA_DEFAULT_MAIN_PERCENT;
  laCustom = false;
  laApply();
  laSave();
}

// つまみを作って、左右の間に差し込む（1回だけ）
function laInit() {
  const split = laGetSplit();
  if (!split || laGetHandle()) return;
  const sub = split.querySelector(".scenariobuild-sub");
  if (!sub) return;
  const handle = document.createElement("div");
  handle.id = "scenariobuild-resizer";
  handle.className = "scenariobuild-resizer";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-valuemin", String(LA_MIN_PERCENT));
  handle.setAttribute("aria-valuemax", String(LA_MAX_PERCENT));
  handle.tabIndex = 0;
  split.insertBefore(handle, sub);

  // ドラッグ（マウス・タッチ・ペン共通）
  let dragging = false;
  const percentFromPointer = (event) => {
    const rect = split.getBoundingClientRect();
    if (rect.width <= LA_HANDLE_PX) return laMainPercent;
    // つまみの中心がポインタに来るように、つまみの半分だけずらす
    return ((event.clientX - rect.left - LA_HANDLE_PX / 2) / (rect.width - LA_HANDLE_PX)) * 100;
  };
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button > 0) return;
    dragging = true;
    try { handle.setPointerCapture(event.pointerId); } catch (e) { /* 非対応環境は、そのまま動かす */ }
    split.classList.add("layout-dragging");
    event.preventDefault();
  });
  handle.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    laSetPercent(percentFromPointer(event), false);
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    split.classList.remove("layout-dragging");
    laSave();
  };
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
  handle.addEventListener("lostpointercapture", endDrag);
  handle.addEventListener("dblclick", laReset);
  // キーボード：←→で2%ずつ（Shiftで5%）、Home/Endで下限/上限、Escで初期値
  handle.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 5 : 2;
    let next = null;
    if (event.key === "ArrowLeft") next = laMainPercent - step;
    else if (event.key === "ArrowRight") next = laMainPercent + step;
    else if (event.key === "Home") next = LA_MIN_PERCENT;
    else if (event.key === "End") next = LA_MAX_PERCENT;
    else if (event.key === "Escape") { laReset(); event.preventDefault(); return; }
    if (next === null) return;
    event.preventDefault();
    laSetPercent(next, true);
  });

  laLoad();
  laApply();
}

// ★「レイアウト調整」タブを開いている間だけ、つまみを出す（renderScenarioBuildSub の頭から呼ばれる）
function laSyncAdjustMode() {
  const split = laGetSplit();
  if (!split) return;
  const on = (typeof scenarioBuildSubView !== "undefined" && scenarioBuildSubView === "layoutadjust");
  split.classList.toggle("layout-adjusting", on);
  if (!on) laSliderSync = null;
}

// ===== 「レイアウト調整」タブの中身 =====
function renderLayoutAdjustPanel(container) {
  laInit();
  const note = (text) => { const p = document.createElement("p"); p.className = "devmode-note"; p.textContent = text; container.appendChild(p); return p; };
  note("左（話の編集）と右（このパネル）の境目に、青い「つまみ」が出ています。ドラッグ（スマホは指でなぞる）すると、左右の幅を変えられます。つまみをクリックして選んでおけば、←→ キーでも動かせます（Shift で大きく、Home／End で最小／最大）。");
  note("つまみは、このタブを開いている間だけ表示されます。他のタブへ移るとつまみは消えますが、決めた幅はそのまま残ります。幅はこのブラウザに保存され、他の端末には反映されません。");

  const box = document.createElement("div");
  box.className = "scenariobuild-condition-row la-panel";
  const label = document.createElement("div");
  label.className = "la-label";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(LA_MIN_PERCENT); slider.max = String(LA_MAX_PERCENT); slider.step = "1";
  slider.className = "la-slider";
  slider.setAttribute("aria-label", "左（話の編集）の幅");
  const sync = () => {
    slider.value = String(Math.round(laMainPercent));
    label.textContent = `左（話の編集）${Math.round(laMainPercent)}% ／ 右（このパネル）${100 - Math.round(laMainPercent)}%`;
  };
  slider.oninput = () => laSetPercent(slider.value, false);
  slider.onchange = () => laSetPercent(slider.value, true);
  laSliderSync = sync;
  sync();
  box.appendChild(label);
  box.appendChild(slider);
  container.appendChild(box);

  const presets = document.createElement("div");
  presets.className = "scenariobuild-condition-row";
  [["左を広く（7:3）", 70], ["初期値（6:4）", null], ["半々（5:5）", 50], ["右を広く（4:6）", 40]].forEach(([text, value]) => {
    const btn = document.createElement("button");
    btn.className = "devmode-btn";
    btn.type = "button";
    btn.textContent = text;
    btn.onclick = () => { if (value === null) laReset(); else laSetPercent(value, true); };
    presets.appendChild(btn);
  });
  container.appendChild(presets);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", laInit);
else laInit();
