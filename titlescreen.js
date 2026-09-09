// titlescreen.js
// ページを開いた直後に必ず表示されるタイトル画面。「はじめから」「つづきから」を選べる。
// ★実際にゲームを開始する処理（旧script.jsの中身）はstartNewGame()（script.js）に切り出してある。
// ★キーボード操作（↑↓で移動、決定キーで選択、Xキーでスロット一覧から戻る）に対応。
// ★セーブデータは常に全20個表示し、前回開いていた（最後にセーブ/ロードした）スロットを強調表示する。
// ★セーブデータを開く時・はじめからを選ぶ時は、必ずゲーム内ダイアログで確認を挟む。

let titleScreenView = "menu"; // "menu"（はじめから/つづきから） | "slots"（セーブデータ一覧）
let titleScreenMenuIndex = 0; // 0=はじめから, 1=つづきから
let titleScreenSlotIndex = 0; // 0〜19（No.1〜No.20に対応）

function setupTitleScreen() {
  titleScreenView = "menu";
  titleScreenMenuIndex = 0;
  titleScreenSlotIndex = 0;
  renderTitleScreenMenuCursor();
  setupTitleScreenFullscreenButton(); // ★要望対応：タイトル画面からも全画面表示に切り替えられるようにする
  
  const newBtn = document.getElementById("title-screen-new-btn");
  const continueBtn = document.getElementById("title-screen-continue-btn");
  
  if (newBtn) newBtn.onclick = (event) => {
    event.stopPropagation();
    handleTitleScreenNewGame();
  };
  
  if (continueBtn) continueBtn.onclick = (event) => {
    event.stopPropagation();
    openTitleScreenSlotList();
  };
  
  window.removeEventListener("keydown", handleTitleScreenKeyDown); // 二重登録防止
  window.addEventListener("keydown", handleTitleScreenKeyDown);
}

// ★タイトル画面右上の全画面表示ボタン（要望対応）。setupTitleScreenから毎回呼ぶ（onclickの二重登録は上書きなので問題ない）
function setupTitleScreenFullscreenButton() {
  const btn = document.getElementById("title-screen-fullscreen-btn");
  if (!btn) return;
  btn.onclick = (event) => {
    event.stopPropagation();
    if (typeof toggleFullscreen === "function") toggleFullscreen().then(updateTitleFullscreenButtonLabel); // mainfunc.js
  };
  updateTitleFullscreenButtonLabel();
}

// ★全画面のON/OFF状態に合わせて、タイトル画面のボタン表示を更新する
//   （settings.jsのfullscreenchangeイベントからも呼ばれる：Escキー等で解除された時の同期用）
function updateTitleFullscreenButtonLabel() {
  const btn = document.getElementById("title-screen-fullscreen-btn");
  if (!btn) return;
  const active = typeof isFullscreenActive === "function" && isFullscreenActive(); // mainfunc.js
  btn.textContent = active ? "⛶ 全画面終了" : "⛶ 全画面";
}

// ★「はじめから」：上書きの心配は無いが、誤タップ防止のため必ず確認してからオープニング演出へ
async function handleTitleScreenNewGame() {
  const ok = await showGameConfirm("はじめから始めますか？"); // mainfunc.js
  if (!ok) return;
  hideTitleScreen();
  startIntroSplashThenNewGame();
}

// ★「つづきから」：メニューを隠してセーブデータ一覧（No.1〜No.20）を表示する
function openTitleScreenSlotList() {
  titleScreenView = "slots";
  const lastUsed = typeof getLastUsedSaveSlot === "function" ? getLastUsedSaveSlot() : null; // convenience.js
  titleScreenSlotIndex = lastUsed ? lastUsed - 1 : 0; // ★前回開いていたスロットにカーソルを合わせておく
  renderTitleScreenSlots();
}

// ★セーブデータ一覧からXキー（cancelKeys）で「はじめから/つづきから」メニューへ戻る
function backToTitleScreenMenu() {
  titleScreenView = "menu";
  const slotsEl = document.getElementById("title-screen-slots");
  const menuEl = document.getElementById("title-screen-menu");
  if (slotsEl) slotsEl.classList.add("hidden");
  if (menuEl) menuEl.classList.remove("hidden");
  renderTitleScreenMenuCursor();
}

function renderTitleScreenMenuCursor() {
  const newBtn = document.getElementById("title-screen-new-btn");
  const continueBtn = document.getElementById("title-screen-continue-btn");
  if (newBtn) newBtn.classList.toggle("cursor", titleScreenMenuIndex === 0);
  if (continueBtn) continueBtn.classList.toggle("cursor", titleScreenMenuIndex === 1);
}

// ★セーブデータがあるスロットだけでなく、No.1〜No.20を必ず全て表示する
//   （データが無いスロットも「空きデータ」として表示し、押すと「はじめから」の確認になる）
function renderTitleScreenSlots() {
  const slotsEl = document.getElementById("title-screen-slots");
  const menuEl = document.getElementById("title-screen-menu");
  if (!slotsEl) return;
  
  slotsEl.innerHTML = "";
  const lastUsed = typeof getLastUsedSaveSlot === "function" ? getLastUsedSaveSlot() : null; // convenience.js
  
  for (let i = 1; i <= MAX_SAVE_SLOTS; i++) { // convenience.js
    const data = getSaveSlotData(i); // convenience.js
    const isLastUsed = i === lastUsed;
    
    const btn = document.createElement("button");
    btn.className = "title-screen-slot-btn" + (data ? "" : " empty") + (isLastUsed ? " last-used" : "");
    if (i - 1 === titleScreenSlotIndex) btn.classList.add("cursor");
    
    if (data) {
      const level = data.player ? data.player.level : "?";
      btn.textContent = `No.${i}　Lv.${level}　${data.savedAt || ""}` + (isLastUsed ? "　★前回のデータ" : "");
    } else {
      btn.textContent = `No.${i}　－ 空きデータ －`;
    }
    
    btn.onclick = (event) => {
      event.stopPropagation();
      titleScreenSlotIndex = i - 1;
      handleTitleScreenSlotChosen(i, data);
    };
    
    slotsEl.appendChild(btn);
    if (i - 1 === titleScreenSlotIndex) btn.scrollIntoView({ block: "nearest" });
  }
  
  slotsEl.classList.remove("hidden");
  if (menuEl) menuEl.classList.add("hidden");
}

// ★スロットを選んだ時の共通処理。データがあれば「開きますか？」、無ければ「はじめから始めますか？」を必ず確認する
async function handleTitleScreenSlotChosen(slotIndex, data) {
  if (!data) {
    const ok = await showGameConfirm("このデータは空です。はじめから始めますか？"); // mainfunc.js
    if (!ok) return;
    hideTitleScreen();
    startIntroSplashThenNewGame();
    return;
  }
  
  const ok = await showGameConfirm(`No.${slotIndex} のデータを開きますか？`); // mainfunc.js
  if (!ok) return;
  
  if (typeof setLastUsedSaveSlot === "function") setLastUsedSaveSlot(slotIndex); // convenience.js
  hideTitleScreen();
  await restoreGameFromSaveData(data); // convenience.js
}

function hideTitleScreen() {
  const overlay = document.getElementById("title-screen-overlay");
  if (overlay) overlay.classList.add("hidden");
}

// ★ゲーム中から呼ばれた場合（returnToTitleScreen経由）は、メニューを最初の状態に戻してから表示する
function showTitleScreen() {
  const overlay = document.getElementById("title-screen-overlay");
  const slotsEl = document.getElementById("title-screen-slots");
  const menuEl = document.getElementById("title-screen-menu");
  titleScreenView = "menu";
  titleScreenMenuIndex = 0;
  if (slotsEl) slotsEl.classList.add("hidden");
  if (menuEl) menuEl.classList.remove("hidden");
  if (overlay) overlay.classList.remove("hidden");
  renderTitleScreenMenuCursor();
  
  window.removeEventListener("keydown", handleTitleScreenKeyDown); // 二重登録防止
  window.addEventListener("keydown", handleTitleScreenKeyDown);
}

// ★タイトル画面のキー操作本体。↑↓でカーソル移動、決定キー（Z/Space）で選択、Xキーで一覧からメニューへ戻る
function handleTitleScreenKeyDown(event) {
  const overlay = document.getElementById("title-screen-overlay");
  if (!overlay || overlay.classList.contains("hidden")) return; // ★タイトル画面が表示されていない時は反応しない
  if (typeof isGameDialogOpen !== "undefined" && isGameDialogOpen) return; // ★確認ダイアログが開いている間は、そちら優先
  if (event.repeat) return;
  
  if (titleScreenView === "menu") {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      titleScreenMenuIndex = titleScreenMenuIndex === 0 ? 1 : 0; // ★選択肢は2つだけなので、上下どちらでもトグルする
      renderTitleScreenMenuCursor();
    } else if (KEY_CONFIG.decideKeys.includes(event.key)) { // mainfunc.js
      event.preventDefault();
      if (titleScreenMenuIndex === 0) {
        handleTitleScreenNewGame();
      } else {
        openTitleScreenSlotList();
      }
    }
  } else if (titleScreenView === "slots") {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      titleScreenSlotIndex = Math.max(0, titleScreenSlotIndex - 1);
      renderTitleScreenSlots();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      titleScreenSlotIndex = Math.min(MAX_SAVE_SLOTS - 1, titleScreenSlotIndex + 1); // convenience.js
      renderTitleScreenSlots();
    } else if (KEY_CONFIG.decideKeys.includes(event.key)) {
      event.preventDefault();
      const slotNumber = titleScreenSlotIndex + 1;
      handleTitleScreenSlotChosen(slotNumber, getSaveSlotData(slotNumber)); // convenience.js
    } else if (KEY_CONFIG.cancelKeys.includes(event.key)) {
      event.preventDefault();
      backToTitleScreenMenu();
    }
  }
}

// ===================================================================
// ===== オープニング演出（コンテンツ注意書き→クレジット→アイコン→本編開始） =====
// ===================================================================
// ★「はじめから」を選んだ時（新規スロットも含む）は、必ずこの一連の演出を挟んでから startNewGame() を呼ぶ。
//   クリック、または決定キー・文章送りキー・Xキーのいずれでも次へ進められる。
const DEFAULT_INTRO_SPLASH_TEXT = "これから始める方へ。\nこのゲームはクソゲーです。\n開発者がノリで作ったしょうもないシナリオで、\n場が凍りつく会話や一部下ネタが含まれます。\n苦手な方はこの場でブラウザバァッックすることをおすすめしマスカット。";

// ★シナリオビルドの「データ管理」タブで編集できるよう、固定の配列ではなく毎回組み立てる関数にしてある
function getIntroSplashSteps() {
  const text = (typeof scenarioProject !== "undefined" && scenarioProject.introText) || DEFAULT_INTRO_SPLASH_TEXT;
  return [
    { type: "text", text },
    { type: "text", text: "Made By merry_desu" },
    { type: "image", src: "img/icon.png" } // ★後日差し替え予定のアイコン画像。まだ用意されていなければ自動で読み飛ばす
  ];
}
let introSplashStepIndex = 0;
let currentIntroSplashSteps = []; // ★開始時にgetIntroSplashSteps()で組み立てる（scenarioProject.introTextを反映するため）

function startIntroSplashThenNewGame() {
  const overlay = document.getElementById("intro-splash-overlay");
  if (!overlay) { startNewGame(); return; } // script.js（万が一要素が無ければ、そのまま本編を開始する）
  
  if (typeof loadCustomScenarioData === "function") loadCustomScenarioData(); // scenariobuild.js（編集済みのオープニング文言を確実に読み込む）
  currentIntroSplashSteps = getIntroSplashSteps();
  introSplashStepIndex = 0;
  overlay.classList.remove("hidden");
  renderIntroSplashStep();
  
  window.removeEventListener("keydown", handleIntroSplashKeyDown); // 二重登録防止
  window.addEventListener("keydown", handleIntroSplashKeyDown);
}

function renderIntroSplashStep() {
  const contentEl = document.getElementById("intro-splash-content");
  if (!contentEl) return;
  contentEl.innerHTML = "";
  
  const step = currentIntroSplashSteps[introSplashStepIndex];
  if (!step) return;
  
  if (step.type === "text") {
    const p = document.createElement("p");
    p.className = "intro-splash-text";
    p.textContent = step.text;
    contentEl.appendChild(p);
  } else if (step.type === "image") {
    const img = document.createElement("img");
    img.className = "intro-splash-image";
    img.src = step.src;
    img.alt = "";
    img.onerror = () => { advanceIntroSplash(); }; // ★アイコン画像がまだ用意されていない場合は、静かに次へ進める（壊れた画像アイコンを見せない）
    contentEl.appendChild(img);
  }
}

function advanceIntroSplash() {
  introSplashStepIndex++;
  if (introSplashStepIndex >= currentIntroSplashSteps.length) {
    finishIntroSplash();
    return;
  }
  renderIntroSplashStep();
}

function finishIntroSplash() {
  const overlay = document.getElementById("intro-splash-overlay");
  if (overlay) overlay.classList.add("hidden");
  window.removeEventListener("keydown", handleIntroSplashKeyDown);
  startNewGame(); // script.js
}

function handleIntroSplashKeyDown(event) {
  if (event.repeat) return;
  if (KEY_CONFIG.decideKeys.includes(event.key) || KEY_CONFIG.advanceKeys.includes(event.key) || KEY_CONFIG.cancelKeys.includes(event.key)) {
    event.preventDefault();
    advanceIntroSplash();
  }
}