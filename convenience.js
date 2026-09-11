// convenience.js
// 「便利」タブに関するファイル。スマホのホーム画面のようにアイコンを並べて、
// そこから各種便利機能（今はセーブ/ロードのみ）を開けるようにする。
// 今後、便利タブに機能を増やす時は CONVENIENCE_APPS に追記していく想定。

const MAX_SAVE_SLOTS = 20;
const SAVE_KEY_PREFIX = "demoge_save_slot_"; // localStorageのキーの接頭辞

// ===== セーブ位置（現在地）の記録 =====
// 町の各場所（town.js）に入るたびに currentLocationKey を更新してもらい、
// セーブデータに含めることで、ロード時に同じ場所へ戻れるようにする。
let currentLocationKey = "town";

// 第一話（scenario.js）が完了しているかどうか。
// true になる前にセーブした場合は、ロード時にシナリオを最初から高速リプレイして
// セーブ地点まで一気に追いつかせることができる（true になった後は自由行動パートなので、
// 代わりに currentLocationKey を使って場所を開き直す）。
let chapter1Finished = false;

// キーと「その場所を開き直す関数」の対応表
const LOCATION_RESUMERS = {
  town: () => openTownMenu(),
  shop: () => openShopMenu(),
  tavern: () => { tavernReturnTo = null; currentLocationKey = "tavern"; openTavern(); },
  questBoard: () => openQuestBoard(),
  inn: () => openInn(), // town.js
  shop_buy: () => openBuyShop(), // town.js
  shop_weapon: () => openGenericBuyShop(category => category === "weapon", "shop_weapon", "武器屋の店主"), // town.js
  shop_armor: () => openGenericBuyShop(category => category === "armor", "shop_armor", "防具屋の店主"), // town.js
  shop_item: () => openGenericBuyShop(category => category === "herb" || category === "potion" || category === "tool", "shop_item", "道具屋の店主") // town.js
};

// ★施設編集タブで追加した独自施設は "facility_<施設id>" という形の現在地キーになる。
//   施設の数だけ静的に登録しておくのは大変なので、こちらはprefixで判定して動的に開き直す
function resumeLocationDynamic(locationKey) {
  if (locationKey && locationKey.startsWith("facility_")) {
    const facilityId = locationKey.slice("facility_".length);
    const facility = (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.facilities))
      ? scenarioProject.facilities.find(f => f.id === facilityId) : null;
    if (facility && typeof openCustomFacility === "function") {
      // ★この施設がどこかの街・国・村エリアにアタッチされていれば、そちらへの「戻る」を渡す。
      //   見つからなければ（カリの村にアタッチ、またはどこにも紐付いていない）今まで通り村に戻る
      const parentArea = (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.mapAreas))
        ? scenarioProject.mapAreas.find(a => Array.isArray(a.facilityIds) && a.facilityIds.includes(facilityId) && a.locationKey !== "village")
        : null;
      const returnTo = parentArea ? () => openCustomSettlementArea(parentArea) : undefined; // town.js
      openCustomFacility(facility, returnTo); // town.js
      return true;
    }
  }
  // ★街・国・村タイプの独自エリア（例：カデリクの街）は "settlement_<エリアid>" という形の現在地キーになる
  if (locationKey && locationKey.startsWith("settlement_")) {
    const areaId = locationKey.slice("settlement_".length);
    const area = (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.mapAreas))
      ? scenarioProject.mapAreas.find(a => a.id === areaId) : null;
    if (area && typeof openCustomSettlementArea === "function") { openCustomSettlementArea(area); return true; } // town.js
  }
  return false;
}

// ★話の進行度集計：「実装済み」チェック（chapter.enabled）がオフの話は、まだ編集中でプレイには
//   出てこないので、母数（全○話）にもクリア済み集計にも含めない。進行度パネルとアイコンのバッジの
//   両方から使う共通関数
function getChapterProgressSummary() {
  const chapters = ((typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.chapters)) ? scenarioProject.chapters : [])
    .filter(c => c.enabled !== false);
  return { cleared: chapters.filter(c => c.cleared).length, total: chapters.length };
}

// 便利タブのアイコン一覧
const CONVENIENCE_APPS = [
  { id: "saveload", label: "セーブ/ロード", icon: "💾", action: () => openSaveLoadPanel() },
  { id: "monsterCodex", label: "魔物図鑑", icon: "📖", action: () => openMonsterCodex() },
  { id: "progress", label: "進行度", icon: "📊", action: () => openProgressPanel() },
  { id: "tutorial", label: "チュートリアル", icon: "❓", action: () => openTutorialPanel() },
  { id: "credits", label: "クレジット", icon: "📜", action: () => openCredits() }
];

// ★クレジットのデフォルト文面（scenarioProject.creditsTextが空の時だけ使う）。
//   シナリオビルドの「データ管理」タブから、改行を含む自由な文章として編集できる
const DEFAULT_CREDITS_TEXT = "【クレジット】\n\n制作：（ここに製作者名を入れてください）\nシナリオ・企画：（ここに製作者名を入れてください）\nBGM・効果音：（使用した音源の配布元・作者名を入れてください）\n使用ツール：Claude（Anthropic）";

// アイコン一覧のグリッドの列数（6×7グリッド）
const CONVENIENCE_GRID_COLS = 6;

// JSONを介したシンプルなディープコピー（player・inventorySlotsは全てプレーンなデータのため問題ない）
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ===== アイコン一覧画面 =====

// 便利タブを開いた時（switchTabから呼ばれる）：常にアイコン一覧の状態に戻す
function renderConvenienceIcons() {
  const grid = document.getElementById("convenience-icon-grid");
  const panel = document.getElementById("saveload-panel");
  const codexPanel = document.getElementById("monster-codex-panel");
  const creditsPanel = document.getElementById("credits-panel");
  const progressPanel = document.getElementById("progress-panel");
  const tutorialPanel = document.getElementById("tutorial-panel");
  // ★バグ修正：各サブ画面（魔物図鑑・セーブロード・進行度・チュートリアル・クレジット）を
  //   「戻る」ボタン以外の方法（タブ切り替えなど）で離れた場合、そのままだとwindowのkeydown
  //   リスナーが残り続け、他の画面で矢印キーを押しただけで裏の画面が再描画されて勝手に
  //   開いたように見えるバグがあった（例：セーブ/ロード中に魔物図鑑が開いてしまう）。
  //   アイコン一覧に戻るタイミングで、全てのサブ画面のリスナーを必ずまとめて解除しておく。
  window.removeEventListener("keydown", handleSaveLoadKeyDown);
  window.removeEventListener("keydown", handleMonsterCodexKeyDown);
  window.removeEventListener("keydown", handleCreditsKeyDown);
  window.removeEventListener("keydown", handleProgressKeyDown);
  window.removeEventListener("keydown", handleTutorialKeyDown);
  if (panel) panel.classList.add("hidden");
  if (codexPanel) codexPanel.classList.add("hidden"); // ★これが抜けていて、図鑑を閉じても下半分に残り続けるバグの原因だった
  if (creditsPanel) creditsPanel.classList.add("hidden"); // ★クレジットも同様に、閉じ忘れると下半分に残ってしまう
  if (progressPanel) progressPanel.classList.add("hidden");
  if (tutorialPanel) tutorialPanel.classList.add("hidden");
  if (!grid) return;
  
  grid.classList.remove("hidden");
  grid.innerHTML = "";
  
  for (const app of CONVENIENCE_APPS) {
    const iconBtn = document.createElement("button");
    iconBtn.className = "convenience-icon";
    
    // ★このボタンを押している間は、テキスト送りなど他の反応を起こさせない
    iconBtn.onclick = (event) => {
      event.stopPropagation();
      app.action();
    };
    
    // ★矢印キーでグリッド上を移動、決定キーでアプリを開く（6列グリッドとして計算する）
    iconBtn.onkeydown = (event) => {
      if (controlFocus !== "sub") return;
      if (event.repeat) return;
      
      const allIcons = Array.from(document.querySelectorAll('#convenience-icon-grid .convenience-icon'));
      const index = allIcons.indexOf(iconBtn);
      if (index === -1) return;
      
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        
        const row = Math.floor(index / CONVENIENCE_GRID_COLS);
        const col = index % CONVENIENCE_GRID_COLS;
        let newRow = row;
        let newCol = col;
        
        if (event.key === "ArrowUp") newRow = Math.max(0, row - 1);
        else if (event.key === "ArrowDown") newRow = row + 1;
        else if (event.key === "ArrowLeft") newCol = Math.max(0, col - 1);
        else if (event.key === "ArrowRight") newCol = col + 1;
        
        let newIndex = newRow * CONVENIENCE_GRID_COLS + newCol;
        newIndex = Math.max(0, Math.min(allIcons.length - 1, newIndex));
        if (allIcons[newIndex]) allIcons[newIndex].focus();
        
      } else if (KEY_CONFIG.decideKeys.includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        app.action();
      }
    };
    
    const glyph = document.createElement("span");
    glyph.className = "convenience-icon-glyph";
    glyph.textContent = app.icon;
    
    // ★進行度アイコンだけ、アイコンの上に「クリア済み話数／全話数」の小さなバッジを重ねて表示する
    if (app.id === "progress" && typeof getChapterProgressSummary === "function") {
      const summary = getChapterProgressSummary();
      if (summary.total > 0) {
        const badge = document.createElement("span");
        badge.className = "convenience-icon-badge";
        badge.textContent = `${summary.cleared}/${summary.total}`;
        glyph.appendChild(badge);
      }
    }
    
    const label = document.createElement("span");
    label.className = "convenience-icon-label";
    label.textContent = app.label;
    
    iconBtn.appendChild(glyph);
    iconBtn.appendChild(label);
    grid.appendChild(iconBtn);
  }
  
  // ★キーボード操作のため、最初のアイコンに自動でフォーカスを当てておく
  const firstIcon = grid.querySelector(".convenience-icon");
  if (firstIcon) firstIcon.focus();
}

// ===== セーブ/ロード =====

let saveLoadMode = "save"; // "save" | "load"
let saveLoadHeaderIndex = 0; // 0=セーブ, 1=ロード, 2=戻る（左右キーで切り替えるカーソル位置）
let saveLoadSlotIndex = 0; // 0〜19（上下キーで切り替えるスロットのカーソル位置。No.1〜20に対応）

// アイコンをタップして、セーブ/ロード画面を開く
function openSaveLoadPanel() {
  const grid = document.getElementById("convenience-icon-grid");
  const codexPanel = document.getElementById("monster-codex-panel");
  const creditsPanel = document.getElementById("credits-panel");
  const progressPanel = document.getElementById("progress-panel");
  const tutorialPanel = document.getElementById("tutorial-panel");
  if (grid) grid.classList.add("hidden");
  if (codexPanel) codexPanel.classList.add("hidden"); // ★念のため、他のパネルは必ず隠しておく
  if (creditsPanel) creditsPanel.classList.add("hidden");
  if (progressPanel) progressPanel.classList.add("hidden");
  if (tutorialPanel) tutorialPanel.classList.add("hidden");
  saveLoadMode = "save";
  saveLoadHeaderIndex = 0;
  renderSaveLoadPanel();
}

// セーブ/ロード画面の「戻る」でアイコン一覧に戻る
function closeSaveLoadPanel() {
  window.removeEventListener("keydown", handleSaveLoadKeyDown);
  renderConvenienceIcons();
}

// 指定スロットのセーブデータを取得する（無ければnull）
// ★要望対応：ログイン中はクラウド(Firestore)、未ログイン時は今まで通りlocalStorageから取得する
function getSaveSlotData(slotIndex) {
  if (typeof isCloudSaveActive === "function" && isCloudSaveActive()) return cloudGetSaveSlotData(slotIndex); // cloudsave.js
  const raw = localStorage.getItem(SAVE_KEY_PREFIX + slotIndex);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("セーブデータの読み込みに失敗しました", e);
    return null;
  }
}

// ★「前回開いていたセーブデータ」の記録。タイトル画面でこのスロットを強調表示するために使う（titlescreen.js）
const LAST_USED_SLOT_KEY = "demoge_last_used_slot";
function setLastUsedSaveSlot(slotIndex) {
  try { localStorage.setItem(LAST_USED_SLOT_KEY, String(slotIndex)); } catch (e) { /* 保存できなくても致命的ではないので無視 */ }
}
function getLastUsedSaveSlot() {
  const raw = localStorage.getItem(LAST_USED_SLOT_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return (Number.isInteger(n) && n >= 1 && n <= MAX_SAVE_SLOTS) ? n : null;
}

// ★要望対応：セーブスロットへの書き込み処理を共通化。ログイン中はクラウド(Firestore)のみ、
//   未ログイン時はlocalStorageのみに保存する（両方には保存しない）。成功したかどうかをboolで返す
async function saveDataToSlot(slotIndex, data) {
  if (typeof isCloudSaveActive === "function" && isCloudSaveActive()) {
    return await cloudSetSaveSlotData(slotIndex, data); // cloudsave.js（成否をboolで返す）
  }
  try {
    localStorage.setItem(SAVE_KEY_PREFIX + slotIndex, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error("ローカルへのセーブに失敗しました", e);
    return false;
  }
}

// ★エンディングに到達した時、直前に使っていたスロットへ静かに自動保存する（無ければNo.1を使う）。
//   これが無いと、「エンディング直前に戻るか村に戻るか選べる」という記録がどこにも残らず、
//   次回タイトル画面から「つづきから」を選んでも再現できないため
async function autoSaveAfterEnding() {
  try {
    const slotIndex = getLastUsedSaveSlot() || 1;
    await saveDataToSlot(slotIndex, buildSaveData());
    setLastUsedSaveSlot(slotIndex);
  } catch (e) {
    console.error("エンディング時の自動保存に失敗しました", e);
  }
}

// ===== 魔物図鑑 =====

// 段階に応じた好感度の表示ラベル
function getAffectionLabel(tier) {
  return ["まだ知らない仲", "友好的", "とても友好的", "大好き♡"][tier] || "";
}

let codexCursorIndex = 0;
let codexViewMode = "list"; // "list"（一覧） | "detail"（選んだ魔物の詳細）

// アイコンをタップして、魔物図鑑を開く
async function openMonsterCodex() {
  // ★シナリオが落ち着くまでは、まだ魔物図鑑を見られないようにする
  if (!chapter1Finished) {
    changeSpeaker("");
    await displayMessage("今はまだそれどころではないようだ。");
    return;
  }
  
  const grid = document.getElementById("convenience-icon-grid");
  const saveloadPanel = document.getElementById("saveload-panel");
  const progressPanel = document.getElementById("progress-panel");
  const tutorialPanel = document.getElementById("tutorial-panel");
  if (grid) grid.classList.add("hidden");
  if (saveloadPanel) saveloadPanel.classList.add("hidden"); // ★念のため、他のパネルは必ず隠しておく
  if (progressPanel) progressPanel.classList.add("hidden");
  if (tutorialPanel) tutorialPanel.classList.add("hidden");
  codexCursorIndex = 0;
  codexViewMode = "list";
  renderMonsterCodex();
  window.removeEventListener("keydown", handleMonsterCodexKeyDown); // 二重登録防止
  window.addEventListener("keydown", handleMonsterCodexKeyDown);
}

function closeMonsterCodex() {
  window.removeEventListener("keydown", handleMonsterCodexKeyDown);
  renderConvenienceIcons();
}

// ===== クレジット画面 =====
// ★見るだけの画面なので、キーボードは戻るキーだけ拾えばよい
function openCredits() {
  const grid = document.getElementById("convenience-icon-grid");
  const saveloadPanel = document.getElementById("saveload-panel");
  const codexPanel = document.getElementById("monster-codex-panel");
  const progressPanel = document.getElementById("progress-panel");
  const tutorialPanel = document.getElementById("tutorial-panel");
  if (grid) grid.classList.add("hidden");
  if (saveloadPanel) saveloadPanel.classList.add("hidden"); // ★念のため、他のパネルは必ず隠しておく
  if (codexPanel) codexPanel.classList.add("hidden");
  if (progressPanel) progressPanel.classList.add("hidden");
  if (tutorialPanel) tutorialPanel.classList.add("hidden");
  renderCredits();
  window.removeEventListener("keydown", handleCreditsKeyDown); // 二重登録防止
  window.addEventListener("keydown", handleCreditsKeyDown);
}

function closeCredits() {
  window.removeEventListener("keydown", handleCreditsKeyDown);
  renderConvenienceIcons();
}

function renderCredits() {
  const panel = document.getElementById("credits-panel");
  if (!panel) return;
  panel.classList.remove("hidden");
  panel.innerHTML = "";
  
  const title = document.createElement("h3");
  title.className = "monster-codex-title";
  title.textContent = "クレジット";
  panel.appendChild(title);
  
  // ★シナリオビルドの「データ管理」タブで自由に編集できる、改行入りの単純なテキスト
  const text = (typeof scenarioProject !== "undefined" && scenarioProject.creditsText) || DEFAULT_CREDITS_TEXT;
  const textEl = document.createElement("p");
  textEl.className = "credits-text";
  textEl.textContent = text; // ★white-space: pre-wrap で改行がそのまま反映される（style.css参照）
  panel.appendChild(textEl);
  
  const backBtn = document.createElement("button");
  backBtn.className = "monster-codex-back-btn";
  backBtn.textContent = "◀ 戻る";
  backBtn.onclick = (event) => { event.stopPropagation(); closeCredits(); };
  panel.appendChild(backBtn);
}

function handleCreditsKeyDown(event) {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  if (controlFocus !== "sub") return;
  if (isGameDialogOpen) return;
  const activeTab = document.querySelector('.tab-content.active');
  if (!activeTab || activeTab.id !== 'tab-convenience') return;
  if (KEY_CONFIG.cancelKeys.includes(event.key)) {
    event.preventDefault();
    closeCredits();
  }
}

// ===== チュートリアル画面 =====
// ★シナリオビルドの「チュートリアル管理」タブで追加・削除できる、カテゴリ分けされたヘルプ一覧。
//   便利タブのアイコンから開くと、まず（カテゴリごとに見出しが付いた）一覧が出て、
//   項目を選ぶとその中身（本文）が全画面表示される
let tutorialCursorIndex = 0; // ★一覧でのカーソル位置（表示上の通し番号。カテゴリ見出しの行は数えない）
let tutorialDetailOpen = false;

// ★scenarioProject.tutorials（[{ id, category, title, body }, ...]）を、カテゴリごとにまとめて返す
function getGroupedTutorials() {
  const list = (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.tutorials)) ? scenarioProject.tutorials : [];
  const groups = [];
  list.forEach(entry => {
    const categoryName = entry.category || "その他";
    let group = groups.find(g => g.category === categoryName);
    if (!group) { group = { category: categoryName, items: [] }; groups.push(group); }
    group.items.push(entry);
  });
  return groups;
}

// ★カーソルのフラットなインデックス（カテゴリ見出しを飛ばした、選択可能な項目だけの通し番号）から、
//   実際のチュートリアル項目を1つ返す
function getFlatTutorialItems() {
  const flat = [];
  getGroupedTutorials().forEach(group => flat.push(...group.items));
  return flat;
}

function openTutorialPanel() {
  const grid = document.getElementById("convenience-icon-grid");
  const saveloadPanel = document.getElementById("saveload-panel");
  const codexPanel = document.getElementById("monster-codex-panel");
  const progressPanel = document.getElementById("progress-panel");
  const creditsPanel = document.getElementById("credits-panel");
  if (grid) grid.classList.add("hidden");
  if (saveloadPanel) saveloadPanel.classList.add("hidden"); // ★念のため、他のパネルは必ず隠しておく
  if (codexPanel) codexPanel.classList.add("hidden");
  if (progressPanel) progressPanel.classList.add("hidden");
  if (creditsPanel) creditsPanel.classList.add("hidden");
  tutorialCursorIndex = 0;
  tutorialDetailOpen = false;
  renderTutorialPanel();
  window.removeEventListener("keydown", handleTutorialKeyDown); // 二重登録防止
  window.addEventListener("keydown", handleTutorialKeyDown);
}

function closeTutorialPanel() {
  window.removeEventListener("keydown", handleTutorialKeyDown);
  renderConvenienceIcons();
}

function renderTutorialPanel() {
  const panel = document.getElementById("tutorial-panel");
  if (!panel) return;
  panel.classList.remove("hidden");
  panel.innerHTML = "";
  
  if (tutorialDetailOpen) {
    renderTutorialDetail(panel);
    return;
  }
  
  const title = document.createElement("h3");
  title.className = "monster-codex-title";
  title.textContent = "チュートリアル";
  panel.appendChild(title);
  
  const groups = getGroupedTutorials();
  const list = document.createElement("div");
  list.className = "progress-panel-chapter-list tutorial-panel-list";
  
  if (groups.length === 0) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "devmode-note";
    emptyEl.textContent = "まだチュートリアルが登録されていません。";
    list.appendChild(emptyEl);
  } else {
    let flatIndex = 0;
    groups.forEach(group => {
      const headerEl = document.createElement("p");
      headerEl.className = "tutorial-panel-category-header";
      headerEl.textContent = group.category;
      list.appendChild(headerEl);
      
      group.items.forEach(item => {
        const currentIndex = flatIndex;
        const row = document.createElement("div");
        row.className = "progress-panel-chapter-row" + (currentIndex === tutorialCursorIndex ? " cursor" : "");
        
        const titleEl = document.createElement("span");
        titleEl.className = "progress-panel-chapter-title";
        titleEl.textContent = item.title || "（無題）";
        row.appendChild(titleEl);
        
        row.onclick = (event) => {
          event.stopPropagation();
          tutorialCursorIndex = currentIndex;
          tutorialDetailOpen = true;
          renderTutorialPanel();
        };
        
        list.appendChild(row);
        if (currentIndex === tutorialCursorIndex) row.scrollIntoView({ block: "nearest" }); // ★カーソルに合わせて自動スクロール
        flatIndex++;
      });
    });
  }
  
  panel.appendChild(list);
  
  const backBtn = document.createElement("button");
  backBtn.className = "monster-codex-back-btn";
  backBtn.textContent = "◀ 戻る";
  backBtn.onclick = (event) => { event.stopPropagation(); closeTutorialPanel(); };
  panel.appendChild(backBtn);
}

function renderTutorialDetail(panel) {
  panel.innerHTML = "";
  const item = getFlatTutorialItems()[tutorialCursorIndex];
  if (!item) { tutorialDetailOpen = false; renderTutorialPanel(); return; }
  
  const title = document.createElement("h3");
  title.className = "monster-codex-title";
  title.textContent = item.title || "（無題）";
  panel.appendChild(title);
  
  const categoryEl = document.createElement("p");
  categoryEl.className = "progress-panel-row-value";
  categoryEl.textContent = `カテゴリ：${item.category || "その他"}`;
  panel.appendChild(categoryEl);
  
  const bodyEl = document.createElement("p");
  bodyEl.className = "progress-panel-synopsis-entry-text progress-panel-detail-text";
  bodyEl.textContent = item.body || "（本文は未設定です）";
  panel.appendChild(bodyEl);
  
  const backBtn = document.createElement("button");
  backBtn.className = "monster-codex-back-btn";
  backBtn.textContent = "◀ 一覧へ戻る";
  backBtn.onclick = (event) => { event.stopPropagation(); tutorialDetailOpen = false; renderTutorialPanel(); };
  panel.appendChild(backBtn);
}

function handleTutorialKeyDown(event) {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  if (controlFocus !== "sub") return;
  if (isGameDialogOpen) return;
  const activeTab = document.querySelector('.tab-content.active');
  if (!activeTab || activeTab.id !== 'tab-convenience') return;
  
  if (tutorialDetailOpen) {
    if (KEY_CONFIG.decideKeys.includes(event.key) || KEY_CONFIG.cancelKeys.includes(event.key)) {
      event.preventDefault();
      tutorialDetailOpen = false;
      renderTutorialPanel();
    }
    return;
  }
  
  if (KEY_CONFIG.cancelKeys.includes(event.key)) {
    event.preventDefault();
    closeTutorialPanel();
    return;
  }
  
  const flatItems = getFlatTutorialItems();
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (flatItems.length === 0) return;
    tutorialCursorIndex = Math.min(flatItems.length - 1, tutorialCursorIndex + 1);
    renderTutorialPanel();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    if (flatItems.length === 0) return;
    tutorialCursorIndex = Math.max(0, tutorialCursorIndex - 1);
    renderTutorialPanel();
  } else if (KEY_CONFIG.decideKeys.includes(event.key)) {
    event.preventDefault();
    if (flatItems.length === 0) return;
    tutorialDetailOpen = true;
    renderTutorialPanel();
  }
}

// ===== 進行度パネル =====
// ★今何話目まで進んでいるか（クリア済みの話数／全話数）と、名声度（隠しステータス）・現在のランク・
//   次のランクまでに必要な名声度を確認できる画面。名声度そのものはF〜Xランクの昇格に使う
//   隠しステータス（questboard.js）で、既存のFAME_RANK_THRESHOLDS／player.rank／player.fameをそのまま使う
// ★話一覧のカーソル位置。矢印キーで動かし、Zキー（決定）で詳細（あらすじ全画面表示）を開く
let progressChapterCursorIndex = 0;
// ★詳細表示中かどうか。trueの間は、決定キー/キャンセルキーで一覧に戻る動きに切り替わる
let progressDetailOpen = false;

function openProgressPanel() {
  const grid = document.getElementById("convenience-icon-grid");
  const saveloadPanel = document.getElementById("saveload-panel");
  const codexPanel = document.getElementById("monster-codex-panel");
  const creditsPanel = document.getElementById("credits-panel");
  const tutorialPanel = document.getElementById("tutorial-panel");
  if (grid) grid.classList.add("hidden");
  if (saveloadPanel) saveloadPanel.classList.add("hidden"); // ★念のため、他のパネルは必ず隠しておく
  if (codexPanel) codexPanel.classList.add("hidden");
  if (creditsPanel) creditsPanel.classList.add("hidden");
  if (tutorialPanel) tutorialPanel.classList.add("hidden");
  progressChapterCursorIndex = 0;
  progressDetailOpen = false;
  renderProgressPanel();
  window.removeEventListener("keydown", handleProgressKeyDown); // 二重登録防止
  window.addEventListener("keydown", handleProgressKeyDown);
}

function closeProgressPanel() {
  window.removeEventListener("keydown", handleProgressKeyDown);
  renderConvenienceIcons();
}

// ★進行度に使う話一覧（「実装済み」チェックがオフの話は含めない。母数集計と同じ考え方）
function getProgressChapterList() {
  return ((typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.chapters)) ? scenarioProject.chapters : [])
    .filter(c => c.enabled !== false);
}

// ★上部30%：話の進行、ランク、名声度、次のランクまでの名声度、進行度（player.progressPoints）
function renderProgressSummary(container) {
  container.innerHTML = "";
  container.className = "progress-panel-summary";
  
  const chapters = getProgressChapterList();
  const clearedCount = getChapterProgressSummary().cleared;
  const currentChapter = chapters.find(c => c.started && !c.cleared);
  container.appendChild(buildProgressRow("話の進行", `クリア済み ${clearedCount}話 ／ 全${chapters.length}話` + (currentChapter ? `（現在：「${currentChapter.title}」）` : "")));
  
  // ★ランク・名声度：questboard.jsのRANK_ORDER／FAME_RANK_THRESHOLDSをそのまま使う
  const rank = player.rank || "F";
  container.appendChild(buildProgressRow("現在のランク", rank));
  container.appendChild(buildProgressRow("名声度", `${player.fame || 0}`));
  
  if (typeof RANK_ORDER !== "undefined" && typeof FAME_RANK_THRESHOLDS !== "undefined") {
    const nextRank = RANK_ORDER[RANK_ORDER.indexOf(rank) + 1];
    if (nextRank) {
      const needed = Math.max(0, FAME_RANK_THRESHOLDS[nextRank] - (player.fame || 0));
      container.appendChild(buildProgressRow(`次のランク（${nextRank}）まで`, needed > 0 ? `名声度があと${needed}必要` : "条件は満たしている（試練が必要な場合があります）"));
    } else {
      container.appendChild(buildProgressRow("次のランクまで", "既に最高ランクです"));
    }
  }
  
  // ★「進行度」（player.progressPoints）：クエスト達成・ランクアップ・魔物討伐等で増える隠しステータス。第2話解放条件にも使われる
  container.appendChild(buildProgressRow("進行度", `${player.progressPoints || 0}`));
}

// ★下部70%：話のリスト。矢印キーでカーソルを動かし、Zキーで選んでいる話のあらすじを全画面表示する
function renderProgressChapterList(container) {
  container.innerHTML = "";
  container.className = "progress-panel-list progress-panel-chapter-list";
  
  const chapters = getProgressChapterList();
  if (progressChapterCursorIndex >= chapters.length) progressChapterCursorIndex = Math.max(0, chapters.length - 1);
  
  if (chapters.length === 0) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "devmode-note";
    emptyEl.textContent = "まだ話が登録されていません。";
    container.appendChild(emptyEl);
    return;
  }
  
  chapters.forEach((chapter, index) => {
    const row = document.createElement("div");
    row.className = "progress-panel-chapter-row" + (index === progressChapterCursorIndex ? " cursor" : "");
    
    const statusEl = document.createElement("span");
    statusEl.className = "progress-panel-chapter-status";
    statusEl.textContent = chapter.cleared ? "✓" : (chapter.started ? "…" : "");
    row.appendChild(statusEl);
    
    const titleEl = document.createElement("span");
    titleEl.className = "progress-panel-chapter-title";
    titleEl.textContent = chapter.isInterlude ? `閑話：${chapter.title}` : chapter.title;
    row.appendChild(titleEl);
    
    row.onclick = (event) => {
      event.stopPropagation();
      progressChapterCursorIndex = index;
      progressDetailOpen = true;
      renderProgressPanel();
    };
    
    container.appendChild(row);
    if (index === progressChapterCursorIndex) row.scrollIntoView({ block: "nearest" }); // ★カーソルに合わせて自動スクロール
  });
}

// ★話の詳細（あらすじ）を、サブ画面いっぱいに表示する
function renderProgressChapterDetail(panel) {
  panel.innerHTML = "";
  const chapters = getProgressChapterList();
  const chapter = chapters[progressChapterCursorIndex];
  if (!chapter) { progressDetailOpen = false; renderProgressPanel(); return; }
  
  const title = document.createElement("h3");
  title.className = "monster-codex-title";
  title.textContent = chapter.isInterlude ? `閑話：${chapter.title}` : chapter.title;
  panel.appendChild(title);
  
  const statusEl = document.createElement("p");
  statusEl.className = "progress-panel-row-value";
  statusEl.textContent = chapter.cleared ? "クリア済み" : (chapter.started ? "進行中" : "未着手");
  panel.appendChild(statusEl);
  
  const synopsisText = document.createElement("p");
  synopsisText.className = "progress-panel-synopsis-entry-text progress-panel-detail-text";
  synopsisText.textContent = chapter.cleared
    ? (chapter.synopsis || "（あらすじは未設定です）")
    : "（クリアするとあらすじが読めるようになります）";
  panel.appendChild(synopsisText);
  
  const backBtn = document.createElement("button");
  backBtn.className = "monster-codex-back-btn";
  backBtn.textContent = "◀ 話一覧へ戻る";
  backBtn.onclick = (event) => { event.stopPropagation(); progressDetailOpen = false; renderProgressPanel(); };
  panel.appendChild(backBtn);
}

function renderProgressPanel() {
  const panel = document.getElementById("progress-panel");
  if (!panel || !player) return;
  panel.classList.remove("hidden");
  panel.innerHTML = "";
  
  // ★話の詳細表示中は、サブ画面いっぱいに詳細だけを表示する（一覧・サマリーは隠す）
  if (progressDetailOpen) {
    renderProgressChapterDetail(panel);
    return;
  }
  
  const title = document.createElement("h3");
  title.className = "monster-codex-title";
  title.textContent = "進行度";
  panel.appendChild(title);
  
  // ★上部30%：サマリー
  const summaryEl = document.createElement("div");
  renderProgressSummary(summaryEl);
  panel.appendChild(summaryEl);
  
  // ★下部70%：話のリスト（矢印キーでカーソル、Zキーで詳細）
  const listEl = document.createElement("div");
  renderProgressChapterList(listEl);
  panel.appendChild(listEl);
  
  const backBtn = document.createElement("button");
  backBtn.className = "monster-codex-back-btn";
  backBtn.textContent = "◀ 戻る";
  backBtn.onclick = (event) => { event.stopPropagation(); closeProgressPanel(); };
  panel.appendChild(backBtn);
}

function buildProgressRow(label, value) {
  const row = document.createElement("div");
  row.className = "progress-panel-row";
  const labelEl = document.createElement("span");
  labelEl.className = "progress-panel-row-label";
  labelEl.textContent = label;
  const valueEl = document.createElement("span");
  valueEl.className = "progress-panel-row-value";
  valueEl.textContent = value;
  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

function handleProgressKeyDown(event) {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  if (controlFocus !== "sub") return;
  if (isGameDialogOpen) return;
  const activeTab = document.querySelector('.tab-content.active');
  if (!activeTab || activeTab.id !== 'tab-convenience') return;
  
  // ★詳細（あらすじ全画面表示）を開いている間は、決定キー・キャンセルキーどちらでも一覧に戻る
  if (progressDetailOpen) {
    if (KEY_CONFIG.decideKeys.includes(event.key) || KEY_CONFIG.cancelKeys.includes(event.key)) {
      event.preventDefault();
      progressDetailOpen = false;
      renderProgressPanel();
    }
    return;
  }
  
  if (KEY_CONFIG.cancelKeys.includes(event.key)) {
    event.preventDefault();
    closeProgressPanel();
    return;
  }
  
  const chapters = getProgressChapterList();
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (chapters.length === 0) return;
    progressChapterCursorIndex = Math.min(chapters.length - 1, progressChapterCursorIndex + 1);
    renderProgressChapterList(document.querySelector("#progress-panel .progress-panel-chapter-list"));
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    if (chapters.length === 0) return;
    progressChapterCursorIndex = Math.max(0, progressChapterCursorIndex - 1);
    renderProgressChapterList(document.querySelector("#progress-panel .progress-panel-chapter-list"));
  } else if (KEY_CONFIG.decideKeys.includes(event.key)) {
    event.preventDefault();
    if (chapters.length === 0) return;
    progressDetailOpen = true;
    renderProgressPanel();
  }
}

function renderMonsterCodex() {
  const panel = document.getElementById("monster-codex-panel");
  if (!panel) return;
  panel.classList.remove("hidden");
  panel.innerHTML = "";
  
  if (codexViewMode === "detail") {
    renderMonsterCodexDetail(panel);
    return;
  }
  
  const title = document.createElement("h3");
  title.className = "monster-codex-title";
  title.textContent = "魔物図鑑";
  panel.appendChild(title);
  
  const list = document.createElement("div");
  list.className = "monster-codex-list";
  
  SPAREABLE_KEYS.forEach((key, i) => {
    const discovered = discoveredMonsters[key];
    const master = MONSTER_MASTER[key];
    
    const row = document.createElement("div");
    row.className = "monster-codex-row" + (i === codexCursorIndex ? " cursor" : "") + (discovered ? "" : " monster-codex-row-unknown");
    row.onclick = (event) => {
      event.stopPropagation();
      codexCursorIndex = i;
      if (discovered) {
        codexViewMode = "detail";
      }
      renderMonsterCodex();
    };
    
    // ★カード上部に小さな肖像（未発見はCSSでグレー・シルエット寄りに沈める。画像が無ければ自然に隠す）
    if (discovered) {
      const thumbEl = document.createElement("img");
      thumbEl.className = "monster-codex-thumb";
      thumbEl.alt = master.name;
      thumbEl.onerror = () => { thumbEl.classList.add("hidden"); };
      thumbEl.src = master.imagePath || `img/敵/${master.name}.png`; // ★敵設定タブで指定した画像パスを、以前は無視して名前ベースのパスしか見ていなかった
      row.appendChild(thumbEl);
    }
    
    const nameEl = document.createElement("span");
    nameEl.className = "monster-codex-name";
    // ★倒した・見逃したことが一度もない魔物は「？？？」で伏せておく
    nameEl.textContent = discovered ? master.name : "？？？";
    row.appendChild(nameEl);
    
    if (discovered) {
      const value = getMonsterAffection(key);
      const tier = getAffectionTier(key);
      const barOuter = document.createElement("div");
      barOuter.className = "monster-codex-bar-outer";
      const barInner = document.createElement("div");
      barInner.className = "monster-codex-bar-inner";
      barInner.style.width = `${value}%`;
      barOuter.appendChild(barInner);
      row.appendChild(barOuter);
      
      const labelEl = document.createElement("span");
      labelEl.className = "monster-codex-label";
      labelEl.textContent = getAffectionLabel(tier);
      row.appendChild(labelEl);
    } else {
      const unknownEl = document.createElement("span");
      unknownEl.className = "monster-codex-unknown";
      unknownEl.textContent = "未発見";
      row.appendChild(unknownEl);
    }
    
    list.appendChild(row);
  });
  
  panel.appendChild(list);
  
  // ★バグ修正：以前はここがlist.appendChild(row)の直後（＝listがまだpanelに繋がっておらず、
  //   画面に描画される前）に呼ばれていたため、scrollIntoView()が実質何もしていなかった。
  //   実際にDOMへ挿入した後で呼び直すことで、カーソルの位置に追従してスクロールするようにする
  const cursorRow = list.children[codexCursorIndex];
  if (cursorRow) requestAnimationFrame(() => cursorRow.scrollIntoView({ block: "nearest" }));
  
  const hintEl = document.createElement("p");
  hintEl.className = "monster-codex-hint";
  hintEl.textContent = "Zキーで詳細を見る／Xキーで閉じる";
  panel.appendChild(hintEl);
  
  const backBtn = document.createElement("button");
  backBtn.className = "monster-codex-back-btn";
  backBtn.textContent = "戻る（Xキー）";
  backBtn.onclick = (event) => {
    event.stopPropagation();
    closeMonsterCodex();
  };
  panel.appendChild(backBtn);
}

// 図鑑で選んだ1体の詳細（画像・好感度・専用スキルボタンなど）
function renderMonsterCodexDetail(panel) {
  const key = SPAREABLE_KEYS[codexCursorIndex];
  const master = MONSTER_MASTER[key];
  const value = getMonsterAffection(key);
  const tier = getAffectionTier(key);
  
  const title = document.createElement("h3");
  title.className = "monster-codex-title";
  title.textContent = master.name;
  panel.appendChild(title);
  
  // ★画像がまだ用意されていない魔物では、エラー時に欄ごと隠して自然に見せる
  const imageEl = document.createElement("img");
  imageEl.className = "monster-codex-detail-image";
  imageEl.alt = master.name;
  imageEl.onerror = () => { imageEl.classList.add("hidden"); };
  imageEl.src = master.imagePath || `img/敵/${master.name}.png`; // ★敵設定タブで指定した画像パスを、以前は無視して名前ベースのパスしか見ていなかった
  panel.appendChild(imageEl);
  
  if (master.description) {
    const descEl = document.createElement("p");
    descEl.className = "monster-codex-description";
    descEl.textContent = master.description;
    panel.appendChild(descEl);
  }
  
  const barOuter = document.createElement("div");
  barOuter.className = "monster-codex-bar-outer monster-codex-detail-bar";
  const barInner = document.createElement("div");
  barInner.className = "monster-codex-bar-inner";
  barInner.style.width = `${value}%`;
  barOuter.appendChild(barInner);
  panel.appendChild(barOuter);
  
  const labelEl = document.createElement("p");
  labelEl.className = "monster-codex-detail-label";
  labelEl.textContent = `好感度：${getAffectionLabel(tier)}`;
  panel.appendChild(labelEl);
  
  // ★サキュバスだけ、好感度MAXになると専用スキルのボタンが出る
  if (key === "succubus" && tier >= 3 && master.restSkillName) {
    const restBtn = document.createElement("button");
    restBtn.className = "monster-codex-rest-btn";
    const usedToday = player && player.lastSuccubusRestDay === player.daysSinceTransfer;
    restBtn.textContent = usedToday ? `${master.restSkillName}（本日は使用済み）` : `${master.restSkillName}を使う`;
    restBtn.disabled = usedToday;
    restBtn.onclick = (event) => {
      event.stopPropagation();
      useSuccubusRestSkill();
    };
    panel.appendChild(restBtn);
  }
  
  const backBtn = document.createElement("button");
  backBtn.className = "monster-codex-back-btn";
  backBtn.textContent = "一覧に戻る（Xキー）";
  backBtn.onclick = (event) => {
    event.stopPropagation();
    codexViewMode = "list";
    renderMonsterCodex();
  };
  panel.appendChild(backBtn);
}

function handleMonsterCodexKeyDown(event) {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  if (controlFocus !== "sub") return;
  if (isGameDialogOpen || isTextDisplaying) return;
  if (event.repeat) return;
  
  if (KEY_CONFIG.cancelKeys.includes(event.key)) {
    event.preventDefault();
    if (codexViewMode === "detail") {
      codexViewMode = "list";
      renderMonsterCodex();
    } else {
      closeMonsterCodex();
    }
    return;
  }
  
  if (codexViewMode === "detail") return; // ★詳細画面ではカーソル移動はしない
  
  if (event.key === "ArrowDown") {
    event.preventDefault();
    codexCursorIndex = Math.min(SPAREABLE_KEYS.length - 1, codexCursorIndex + 1);
    renderMonsterCodex();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    codexCursorIndex = Math.max(0, codexCursorIndex - 1);
    renderMonsterCodex();
  } else if (KEY_CONFIG.decideKeys.includes(event.key)) {
    event.preventDefault();
    const key = SPAREABLE_KEYS[codexCursorIndex];
    if (discoveredMonsters[key]) {
      codexViewMode = "detail";
      renderMonsterCodex();
    }
  }
}

// サキュバスの固有スキル「サキュバスと休憩♡」：好感度MAX限定・1日1回。疲労度全回復＋HP大回復
async function useSuccubusRestSkill() {
  console.log("[好感度スキル] ボタンが押されました");
  try {
    const tier = getAffectionTier("succubus");
    console.log("[好感度スキル] 現在の好感度ランク:", tier, "（好感度値:", getMonsterAffection("succubus"), "）");
    if (tier < 3) {
      console.log("[好感度スキル] 好感度がランク3未満のため、ここで終了しました");
      return;
    }
    console.log("[好感度スキル] lastSuccubusRestDay:", player.lastSuccubusRestDay, " daysSinceTransfer:", player.daysSinceTransfer);
    if (player.lastSuccubusRestDay === player.daysSinceTransfer) {
      console.log("[好感度スキル] 本日は使用済みのため、メッセージだけ表示します");
      changeSpeaker("");
      await displayMessage("今日はもう十分癒やしてもらった。また明日にしよう。");
      return;
    }
    
    const master = MONSTER_MASTER["succubus"];
    console.log("[好感度スキル] MONSTER_MASTER['succubus']:", master ? "取得できました" : "取得できませんでした（undefined）",
      "restSkillBlocks件数:", master && Array.isArray(master.restSkillBlocks) ? master.restSkillBlocks.length : "配列ではない/無し",
      "runBlockSequence:", typeof window.runBlockSequence);
    if (master && Array.isArray(master.restSkillBlocks) && master.restSkillBlocks.length > 0 && typeof window.runBlockSequence === "function") {
      // ★要望対応：ブロック編集された演出を実行する
      console.log("[好感度スキル] ブロック演出を実行します");
      await window.runBlockSequence({ id: "restSkill_succubus", blocks: master.restSkillBlocks }, master.restSkillBlocks, []);
      console.log("[好感度スキル] ブロック演出が終了しました");
      player.lastSuccubusRestDay = player.daysSinceTransfer;
      renderMonsterCodex();
      return;
    }
    
    console.log("[好感度スキル] フォールバック（従来のハードコード済み演出）を実行します");
    // フォールバック：従来のハードコード済み演出
    changeSpeaker("サキュバス");
    await displayMessage("「ふふ、今日は特別に癒やしてあげる♡……フッ、バカねッ」");
    
    changeGauge("fatigue", -player.gauges.fatigue.max);
    changeGauge("hp", Math.round(player.gauges.hp.max * 0.6));
    player.lastSuccubusRestDay = player.daysSinceTransfer;
    renderStatusHUD();
    
    changeSpeaker("");
    await displayMessage("疲労度が全回復し、体力も大きく回復した。");
    
    renderMonsterCodex();
  } catch (e) {
    // ★バグ調査用：エラーが起きても画面上は「何も起きない」ように見えてしまっていたため、
    //   コンソールと画面上の両方にエラー内容を出すようにする
    console.error("[好感度スキル] エラーが発生しました", e);
    if (typeof showGameAlert === "function") showGameAlert("エラーが発生しました：" + (e && e.message ? e.message : e));
  }
}

// セーブ/ロード画面本体を描画する
function renderSaveLoadPanel() {
  const panel = document.getElementById("saveload-panel");
  if (!panel) return;
  panel.classList.remove("hidden");
  panel.innerHTML = "";
  
  // ---- 上部：セーブ/ロード切り替え + 戻るボタン ----
  const header = document.createElement("div");
  header.className = "saveload-header";
  
  const saveTabBtn = document.createElement("button");
  saveTabBtn.className = "saveload-mode-btn" + (saveLoadMode === "save" ? " active" : "");
  saveTabBtn.textContent = "セーブ";
  saveTabBtn.onclick = (event) => { event.stopPropagation(); saveLoadHeaderIndex = 0; saveLoadMode = "save"; renderSaveLoadPanel(); };
  
  const loadTabBtn = document.createElement("button");
  loadTabBtn.className = "saveload-mode-btn" + (saveLoadMode === "load" ? " active" : "");
  loadTabBtn.textContent = "ロード";
  loadTabBtn.onclick = (event) => { event.stopPropagation(); saveLoadHeaderIndex = 1; saveLoadMode = "load"; renderSaveLoadPanel(); };
  
  const backBtn = document.createElement("button");
  backBtn.className = "saveload-back-btn";
  backBtn.textContent = "← 戻る";
  backBtn.onclick = (event) => { event.stopPropagation(); closeSaveLoadPanel(); };
  
  const headerButtons = [saveTabBtn, loadTabBtn, backBtn];
  headerButtons.forEach((btn, i) => btn.classList.toggle("cursor", i === saveLoadHeaderIndex));
  
  header.appendChild(saveTabBtn);
  header.appendChild(loadTabBtn);
  header.appendChild(backBtn);
  panel.appendChild(header);
  
  // ---- 縦のセーブデータ一覧（No.1〜No.20） ----
  const list = document.createElement("div");
  list.className = "saveload-list";
  
  for (let i = 1; i <= MAX_SAVE_SLOTS; i++) {
    const data = getSaveSlotData(i);
    const row = document.createElement("button");
    row.className = "saveload-slot" + (data ? "" : " empty");
    if (i - 1 === saveLoadSlotIndex) row.classList.add("cursor");
    
    const slotNumber = document.createElement("span");
    slotNumber.className = "saveload-slot-number";
    slotNumber.textContent = `No.${i}`;
    
    const slotInfo = document.createElement("span");
    slotInfo.className = "saveload-slot-info";
    
    if (data) {
      slotInfo.innerHTML = `転移後 ${data.daysSinceTransfer}日目<br><span class="saveload-slot-time">${data.savedAt}</span>`;
    } else {
      slotInfo.textContent = "－ 空きデータ －";
    }
    
    row.appendChild(slotNumber);
    row.appendChild(slotInfo);
    
    row.onclick = (event) => {
      event.stopPropagation(); // ★このクリックが他の反応（テキスト送りなど）に伝わらないようにする
      saveLoadSlotIndex = i - 1;
      if (saveLoadMode === "save") {
        handleSaveToSlot(i, data);
      } else {
        handleLoadFromSlot(i, data);
      }
    };
    
    list.appendChild(row);
  }
  
  panel.appendChild(list);
  
  // ★左右キーで「セーブ/ロード/戻る」切り替え、上下キーでスロット移動、決定キーでスロットを実行、Xキーで戻る
  window.removeEventListener("keydown", handleSaveLoadKeyDown); // 二重登録防止
  window.addEventListener("keydown", handleSaveLoadKeyDown);
}

// セーブ/ロード画面のキー操作（DOMフォーカスではなく、JS側のインデックスで管理する）
function handleSaveLoadKeyDown(event) {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  if (controlFocus !== "sub") return;
  if (isGameDialogOpen) return; // ★確認ダイアログが開いている間は、そちら優先で反応しない
  if (event.repeat) return;
  
  const activeTab = document.querySelector('.tab-content.active');
  if (!activeTab || activeTab.id !== 'tab-convenience') return; // ★便利タブを離れたら反応しない
  
  const panel = document.getElementById("saveload-panel");
  if (!panel || panel.classList.contains("hidden")) return;
  
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    event.stopPropagation();
    saveLoadHeaderIndex = (saveLoadHeaderIndex - 1 + 3) % 3;
    applySaveLoadHeaderIndex();
    
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    event.stopPropagation();
    saveLoadHeaderIndex = (saveLoadHeaderIndex + 1) % 3;
    applySaveLoadHeaderIndex();
    
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    event.stopPropagation();
    saveLoadSlotIndex = Math.max(0, saveLoadSlotIndex - 1);
    renderSaveLoadPanel();
    
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    event.stopPropagation();
    saveLoadSlotIndex = Math.min(MAX_SAVE_SLOTS - 1, saveLoadSlotIndex + 1);
    renderSaveLoadPanel();
    
  } else if (KEY_CONFIG.decideKeys.includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    const slotNumber = saveLoadSlotIndex + 1;
    const data = getSaveSlotData(slotNumber);
    if (saveLoadMode === "save") {
      handleSaveToSlot(slotNumber, data);
    } else if (saveLoadMode === "load") {
      handleLoadFromSlot(slotNumber, data);
    }
    
  } else if (KEY_CONFIG.cancelKeys.includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    closeSaveLoadPanel();
  }
}

// 左右キーでの「セーブ/ロード/戻る」切り替えを実際に反映する
function applySaveLoadHeaderIndex() {
  if (saveLoadHeaderIndex === 0) {
    saveLoadMode = "save";
    renderSaveLoadPanel();
  } else if (saveLoadHeaderIndex === 1) {
    saveLoadMode = "load";
    renderSaveLoadPanel();
  } else {
    closeSaveLoadPanel();
  }
}

// ===== 選択肢チェックポイント（要望対応：「話をやり直す」機能の4枠目用） =====
// 通常セーブ(20枠)・オートセーブ(timer/prechapter/onclose)とは別に、
// 「クリアした話の、実際に通ったルート上の選択肢」を話ごとに記録しておく専用のデータ。
// 選択肢が表示される直前（runChoiceBlockWithOptions／scenariobuild.js）に、その時点の
// buildSaveData()をまるごと1件ずつ記録し、後から「あの選択肢の直前からやり直す」を可能にする。
const CHOICE_CHECKPOINT_KEY = "demoge_choice_checkpoints";
const CHOICE_CHECKPOINT_MAX_PER_CHAPTER = 40; // ★1つの話につき記録する選択肢の上限（localStorageの容量対策。古い順に切り捨てる）

function getChoiceCheckpointStore() {
  try {
    const raw = localStorage.getItem(CHOICE_CHECKPOINT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error("選択肢チェックポイントの読み込みに失敗しました", e);
    return {};
  }
}

// ★実際のプレイ（ログ再生中・シナリオのテストプレイ中を除く）で選択肢を表示する直前に呼ぶ。
//   同じ選択肢（choiceBlockId）を再び通った場合は、最新の状態で上書きする
//   （＝「実際のプレイで表示されていない、そのルートに入っていない選択肢はロード出来ない」を満たす）
function recordChoiceCheckpoint(chapterId, choiceBlockId, promptLabel) {
  if (!player || !chapterId || !choiceBlockId) return;
  try {
    const store = getChoiceCheckpointStore();
    if (!Array.isArray(store[chapterId])) store[chapterId] = [];
    const list = store[chapterId];
    const existingIndex = list.findIndex(entry => entry.choiceBlockId === choiceBlockId);
    const record = {
      choiceBlockId,
      prompt: (promptLabel || "").slice(0, 60),
      savedAt: new Date().toLocaleString("ja-JP"),
      order: existingIndex >= 0 ? list[existingIndex].order : list.length,
      savedData: buildSaveData()
    };
    if (existingIndex >= 0) {
      list[existingIndex] = record;
    } else {
      list.push(record);
      if (list.length > CHOICE_CHECKPOINT_MAX_PER_CHAPTER) list.splice(0, list.length - CHOICE_CHECKPOINT_MAX_PER_CHAPTER); // ★古い順に切り捨てる
    }
    localStorage.setItem(CHOICE_CHECKPOINT_KEY, JSON.stringify(store));
  } catch (e) {
    console.error("選択肢チェックポイントの保存に失敗しました", e);
  }
}

// ★指定した話で記録済みの選択肢チェックポイントを、通った順番で返す
function getChoiceCheckpointsForChapter(chapterId) {
  const store = getChoiceCheckpointStore();
  const list = Array.isArray(store[chapterId]) ? store[chapterId] : [];
  return list.slice().sort((a, b) => a.order - b.order);
}

// ★選択肢チェックポイントから復元する：通常のロードと同じくプレイヤー状態を丸ごと復元した上で、
//   村や施設ではなく、その話のその選択肢ブロックへ直接ジャンプして再開する（scenariobuild.jsの
//   runScenarioChapterBlocksForReal のstartBlockId機能を利用）
async function restoreGameFromChoiceCheckpoint(chapterId, choiceBlockId, data) {
  activeSessionToken++; // ★convenience.jsのrestoreGameFromSaveDataと同じ理由（宙ぶらりんの古い実行チェーンを無効化する）
  isTextDisplaying = false;
  isTyping = false;
  skipTypingRequested = false;
  currentChoiceList = [];
  choiceResolveFn = null;
  choiceCursorIndex = 0;
  choiceBox.innerHTML = "";
  
  gold = data.gold;
  currentLocationKey = data.currentLocationKey;
  chapter1Finished = data.chapter1Finished;
  player = sanitizeLoadedPlayer(deepClone(data.player)); // player.js
  inventorySlots = deepClone(data.inventorySlots);
  sanitizeInventoryInstanceIds(); // inventory.js
  migrateLegacyEquipmentReferences(); // player.js
  monsterAffection = data.monsterAffection ? deepClone(data.monsterAffection) : {};
  SPAREABLE_KEYS.forEach(key => { if (!(key in monsterAffection)) monsterAffection[key] = 0; });
  discoveredMonsters = data.discoveredMonsters ? deepClone(data.discoveredMonsters) : {};
  SPAREABLE_KEYS.forEach(key => { if (!(key in discoveredMonsters)) discoveredMonsters[key] = false; });
  messageLog = deepClone(data.messageLog || []);
  renderStatusHUD();
  applyBackground(data.background);
  
  if (typeof loadCustomScenarioData === "function") loadCustomScenarioData(); // scenariobuild.js（話の最新データを読み込む）
  if (Array.isArray(data.clearedChapterIds) && typeof scenarioProject !== "undefined") {
    scenarioProject.chapters.forEach(c => { c.cleared = data.clearedChapterIds.includes(c.id); });
  }
  const targetChapter = typeof scenarioProject !== "undefined" ? scenarioProject.chapters.find(c => c.id === chapterId) : null;
  if (!targetChapter) {
    await showGameAlert("この話のデータが見つからないため、やり直しを再開できないようだ。");
    return;
  }
  closeAutoSavePanel();
  await runScenarioChapterBlocksForReal(targetChapter, choiceBlockId); // scenariobuild.js
}

// ===== オートセーブ一覧パネル（要望対応：5分ごと／話直前／終了時の3枠＋「話をやり直す」） =====
let autoSaveView = "menu"; // "menu" | "chapterList" | "checkpointList"
let autoSaveCursorIndex = 0;
let autoSaveSelectedChapterId = null;

const AUTOSAVE_MENU_ROWS = [
  { key: "timer", label: "5分ごとのセーブ" },
  { key: "prechapter", label: "話が始まる直前のセーブ" },
  { key: "onclose", label: "ページを閉じた時のセーブ" },
  { key: "rewind", label: "話をやり直す" }
];

function openAutoSavePanel() {
  const panel = document.getElementById("autosave-panel");
  if (!panel) return;
  // ★バグ修正：設定一覧（settings-list-container）を隠していなかったため、オートセーブパネルが
  //   設定タブの下に並んで表示され、下の設定タブもそのまま操作できてしまっていた。
  //   他の同種パネル（進行状況・クレジット等がconvenience-icon-gridを隠すのと同じやり方）に合わせて、
  //   パネルを開いている間は下の一覧を隠す
  const settingsList = document.getElementById("settings-list-container");
  if (settingsList) settingsList.classList.add("hidden");
  autoSaveView = "menu";
  autoSaveCursorIndex = 0;
  autoSaveSelectedChapterId = null;
  panel.classList.remove("hidden");
  renderAutoSavePanel();
  window.removeEventListener("keydown", handleAutoSaveKeyDown); // 二重登録防止
  window.addEventListener("keydown", handleAutoSaveKeyDown);
}

function closeAutoSavePanel() {
  const panel = document.getElementById("autosave-panel");
  if (panel) panel.classList.add("hidden");
  const settingsList = document.getElementById("settings-list-container");
  if (settingsList) settingsList.classList.remove("hidden"); // ★バグ修正：隠していた設定一覧を、閉じる時に必ず元に戻す
  window.removeEventListener("keydown", handleAutoSaveKeyDown);
  renderSettingsTab(); // settings.js（設定タブへ戻る）
}

// ★クリアした話一覧（「話をやり直す」の1段目）。実際に選択肢チェックポイントが1つでも記録されている話だけを出す
function getRewindableChapters() {
  if (typeof scenarioProject === "undefined" || !Array.isArray(scenarioProject.chapters)) return [];
  return scenarioProject.chapters.filter(c => c.cleared && getChoiceCheckpointsForChapter(c.id).length > 0);
}

function renderAutoSavePanel() {
  const panel = document.getElementById("autosave-panel");
  if (!panel) return;
  panel.innerHTML = "";
  
  const title = document.createElement("h3");
  title.className = "monster-codex-title";
  title.textContent = autoSaveView === "menu" ? "オートセーブ" : (autoSaveView === "chapterList" ? "話をやり直す：話を選ぶ" : "話をやり直す：選択肢を選ぶ");
  panel.appendChild(title);
  
  const list = document.createElement("div");
  list.className = "progress-panel-list";
  
  if (autoSaveView === "menu") {
    AUTOSAVE_MENU_ROWS.forEach((row, index) => {
      const data = row.key === "rewind" ? null : getAutoSaveSlotData(row.key); // settings.js
      const rowEl = document.createElement("div");
      rowEl.className = "progress-panel-chapter-row" + (index === autoSaveCursorIndex ? " cursor" : "");
      const titleEl = document.createElement("span");
      titleEl.className = "progress-panel-chapter-title";
      if (row.key === "rewind") {
        titleEl.textContent = `${row.label}（${getRewindableChapters().length}話）`;
      } else {
        titleEl.textContent = data ? `${row.label} － ${data.savedAt}` : `${row.label} － データ無し`;
      }
      rowEl.appendChild(titleEl);
      rowEl.onclick = (event) => { event.stopPropagation(); autoSaveCursorIndex = index; handleAutoSaveDecide(); };
      list.appendChild(rowEl);
    });
  } else if (autoSaveView === "chapterList") {
    const chapters = getRewindableChapters();
    if (chapters.length === 0) {
      const emptyEl = document.createElement("p");
      emptyEl.className = "devmode-note";
      emptyEl.textContent = "まだやり直せる話が無いようだ。";
      list.appendChild(emptyEl);
    } else {
      if (autoSaveCursorIndex >= chapters.length) autoSaveCursorIndex = Math.max(0, chapters.length - 1);
      chapters.forEach((chapter, index) => {
        const rowEl = document.createElement("div");
        rowEl.className = "progress-panel-chapter-row" + (index === autoSaveCursorIndex ? " cursor" : "");
        const titleEl = document.createElement("span");
        titleEl.className = "progress-panel-chapter-title";
        titleEl.textContent = chapter.isInterlude ? `閑話：${chapter.title}` : chapter.title;
        rowEl.appendChild(titleEl);
        rowEl.onclick = (event) => { event.stopPropagation(); autoSaveCursorIndex = index; handleAutoSaveDecide(); };
        list.appendChild(rowEl);
      });
    }
  } else if (autoSaveView === "checkpointList") {
    const checkpoints = getChoiceCheckpointsForChapter(autoSaveSelectedChapterId);
    if (checkpoints.length === 0) {
      const emptyEl = document.createElement("p");
      emptyEl.className = "devmode-note";
      emptyEl.textContent = "この話では、まだ選択肢の記録が無いようだ。";
      list.appendChild(emptyEl);
    } else {
      if (autoSaveCursorIndex >= checkpoints.length) autoSaveCursorIndex = Math.max(0, checkpoints.length - 1);
      checkpoints.forEach((checkpoint, index) => {
        const rowEl = document.createElement("div");
        rowEl.className = "progress-panel-chapter-row" + (index === autoSaveCursorIndex ? " cursor" : "");
        const titleEl = document.createElement("span");
        titleEl.className = "progress-panel-chapter-title";
        titleEl.textContent = `${checkpoint.prompt || "（選択肢）"} － ${checkpoint.savedAt}`;
        rowEl.appendChild(titleEl);
        rowEl.onclick = (event) => { event.stopPropagation(); autoSaveCursorIndex = index; handleAutoSaveDecide(); };
        list.appendChild(rowEl);
      });
    }
  }
  
  panel.appendChild(list);
  
  const backBtn = document.createElement("button");
  backBtn.className = "monster-codex-back-btn";
  backBtn.textContent = "◀ 戻る";
  backBtn.onclick = (event) => { event.stopPropagation(); handleAutoSaveBack(); };
  panel.appendChild(backBtn);
}

function handleAutoSaveBack() {
  if (autoSaveView === "checkpointList") {
    autoSaveView = "chapterList";
    autoSaveCursorIndex = 0;
    renderAutoSavePanel();
  } else if (autoSaveView === "chapterList") {
    autoSaveView = "menu";
    autoSaveCursorIndex = 3; // ★「話をやり直す」の行に戻す
    renderAutoSavePanel();
  } else {
    closeAutoSavePanel();
  }
}

async function handleAutoSaveDecide() {
  if (autoSaveView === "menu") {
    const row = AUTOSAVE_MENU_ROWS[autoSaveCursorIndex];
    if (!row) return;
    if (row.key === "rewind") {
      autoSaveView = "chapterList";
      autoSaveCursorIndex = 0;
      renderAutoSavePanel();
      return;
    }
    const data = getAutoSaveSlotData(row.key); // settings.js
    if (!data) {
      await showGameAlert("このオートセーブにはまだデータが無いようだ。");
      return;
    }
    const ok = await showGameConfirm(`「${row.label}」（${data.savedAt}）からロードしますか？（現在の進行状況は失われます）`);
    if (!ok) return;
    closeAutoSavePanel();
    await restoreGameFromSaveData(data);
    
  } else if (autoSaveView === "chapterList") {
    const chapters = getRewindableChapters();
    const chapter = chapters[autoSaveCursorIndex];
    if (!chapter) return;
    autoSaveSelectedChapterId = chapter.id;
    autoSaveView = "checkpointList";
    autoSaveCursorIndex = 0;
    renderAutoSavePanel();
    
  } else if (autoSaveView === "checkpointList") {
    const checkpoints = getChoiceCheckpointsForChapter(autoSaveSelectedChapterId);
    const checkpoint = checkpoints[autoSaveCursorIndex];
    if (!checkpoint) return;
    const ok = await showGameConfirm(`「${checkpoint.prompt || "（選択肢）"}」（${checkpoint.savedAt}）の直前からやり直しますか？（現在の進行状況は失われます）`);
    if (!ok) return;
    await restoreGameFromChoiceCheckpoint(autoSaveSelectedChapterId, checkpoint.choiceBlockId, checkpoint.savedData);
  }
}

function handleAutoSaveKeyDown(event) {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  if (controlFocus !== "sub") return;
  if (isGameDialogOpen) return;
  if (event.repeat) return;
  const activeTab = document.querySelector('.tab-content.active');
  if (!activeTab || activeTab.id !== 'tab-setting') return;
  const panel = document.getElementById("autosave-panel");
  if (!panel || panel.classList.contains("hidden")) return;
  
  const rowCount = autoSaveView === "menu" ? AUTOSAVE_MENU_ROWS.length
    : autoSaveView === "chapterList" ? getRewindableChapters().length
    : getChoiceCheckpointsForChapter(autoSaveSelectedChapterId).length;
  
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (rowCount === 0) return;
    autoSaveCursorIndex = Math.min(rowCount - 1, autoSaveCursorIndex + 1);
    renderAutoSavePanel();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    if (rowCount === 0) return;
    autoSaveCursorIndex = Math.max(0, autoSaveCursorIndex - 1);
    renderAutoSavePanel();
  } else if (KEY_CONFIG.decideKeys.includes(event.key)) {
    event.preventDefault();
    if (rowCount === 0) return;
    handleAutoSaveDecide();
  } else if (KEY_CONFIG.cancelKeys.includes(event.key)) {
    event.preventDefault();
    handleAutoSaveBack();
  }
}


// ★現在のゲーム状態から、セーブデータのオブジェクトを組み立てる。
//   手動セーブ（handleSaveToSlot）・オートセーブ（settings.js）の両方から使う共通処理
function buildSaveData() {
  // ★話のクリア状況（scenarioProject.chapters[].cleared）は、シナリオエディタと共有のデータに
  //   乗っているため、そのままではセーブ枠をまたいで共有されてしまう（別のセーブでも同じ進行度になるバグ）。
  //   このセーブ枠専用に「どの話までクリアしたか」を記録し、ロード時にそれだけ反映し直す
  const clearedChapterIds = (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.chapters))
    ? scenarioProject.chapters.filter(c => c.cleared).map(c => c.id) : [];
  
  return {
    version: 4,
    savedAt: new Date().toLocaleString("ja-JP"), // セーブ時のリアルタイムの時間
    daysSinceTransfer: player.daysSinceTransfer, // 経過日数
    player: deepClone(player),
    inventorySlots: deepClone(inventorySlots),
    gold: gold,
    currentLocationKey: currentLocationKey, // ★自由行動パートでロードした時、この場所へ戻すための記録
    chapter1Finished: chapter1Finished, // ★第一話が終わっているかどうか
    scenarioStep: messageLog.length, // ★第一話の途中でロードする時、ここまで一気に再生するための記録
    messageLog: deepClone(messageLog), // ★ログタブの履歴＆選択肢の再生に使う
    background: deepClone(currentBackground), // ★セーブ時点の背景（色 or 画像）
    monsterAffection: deepClone(monsterAffection), // ★魔物図鑑の好感度
    discoveredMonsters: deepClone(discoveredMonsters), // ★魔物図鑑に載せるかどうかの判定用
    clearedChapterIds: clearedChapterIds // ★このセーブ枠でクリア済みの自作の話（シナリオエディタの話管理）
  };
}

// セーブ処理（既にデータがあれば上書き確認する。確認はゲーム内ダイアログを使う）
async function handleSaveToSlot(slotIndex, existingData) {
  // ★以前は「シナリオ中（chapter1未完）か、村の酒場・宿屋にいる時だけ」しかセーブできなかったが、
  //   LOCATION_RESUMERS／resumeLocationDynamicの整備により、町のどの場所・どの施設からでも
  //   正しく開き直せるようになったため、この制限は撤廃した（＝どこでもセーブ）。
  //   ただし戦闘中（battleStateがある間）は、戦闘の途中経過を保存する仕組みが無いため引き続き禁止する
  if (typeof battleState !== "undefined" && battleState) {
    await showGameAlert("戦闘中はセーブできないようだ。");
    return;
  }
  
  if (existingData) {
    const ok = await showGameConfirm(`No.${slotIndex} には既にセーブデータがあります。上書きしますか？`);
    if (!ok) return;
  }
  
  if (!player) {
    await showGameAlert("まだプレイヤー情報が無いため、セーブできません。");
    return;
  }
  
  const ok = await saveDataToSlot(slotIndex, buildSaveData());
  if (!ok) {
    await showGameAlert("セーブに失敗しました。通信状態を確認してもう一度お試しください。");
    return;
  }
  setLastUsedSaveSlot(slotIndex); // ★タイトル画面で「前回のデータ」として強調表示するための記録
  await showGameAlert(`No.${slotIndex} にセーブしました。`);
  renderSaveLoadPanel();
}

// ロード処理（確認はゲーム内ダイアログを使う）
async function handleLoadFromSlot(slotIndex, data) {
  if (!data) {
    await showGameAlert("このスロットにはセーブデータがありません。");
    return;
  }
  
  const ok = await showGameConfirm(`No.${slotIndex} のデータをロードしますか？（現在の進行状況は失われます）`);
  if (!ok) return;
  
  setLastUsedSaveSlot(slotIndex); // ★タイトル画面で「前回のデータ」として強調表示するための記録
  await restoreGameFromSaveData(data);
}

// ★実際にセーブデータをゲーム状態へ反映する処理本体。
//   手動ロード（handleLoadFromSlot）・オートセーブからの再開（settings.js）の両方から使う共通処理。
//   第一話（chapter1）の途中でセーブしたデータなら、シナリオを最初から高速リプレイして
//   セーブ地点まで一気に追いつかせてから、通常表示に戻して続きをプレイできるようにする。
//   第一話が完了した後（自由行動パート）のセーブなら、記録されていた場所を直接開き直す。
async function restoreGameFromSaveData(data) {
  // ★〈重要〉新しいセッションを開始し、ロード前に進行中だった古い表示待ちを凍結する。
  //   シナリオ再生中（ページ読み込み直後の自動再生など）に別のセーブをロードすると、
  //   古い再生処理がdisplayMessage/displayChoicesの内部でメッセージ表示中フラグ等を
  //   trueにしたまま宙ぶらりんになってしまい、ロード後に選択肢やスキル/装備の決定キーが
  //   一切反応しなくなる不具合があった（矢印キーやタブ送りは影響を受けないため、
  //   「一部のキーだけ効かない」という分かりにくい症状になっていた）。
  //   ここで表示関連のフラグを強制的に初期状態へ戻すことで、古い実行チェーンが
  //   何か悪さをしていても新しいセッションには影響しないようにする
  activeSessionToken++;
  isTextDisplaying = false;
  isTyping = false;
  skipTypingRequested = false;
  currentChoiceList = [];
  choiceResolveFn = null;
  choiceCursorIndex = 0;
  choiceBox.innerHTML = ""; // ★選択肢が表示された状態でロードすると、ボタンが画面に残ったままになるバグの修正
  
  gold = data.gold;
  currentLocationKey = data.currentLocationKey || "town";
  chapter1Finished = !!data.chapter1Finished;
  
  // ★話のクリア状況を、このセーブ枠に記録されていた内容に合わせ直す（古いセーブにclearedChapterIdsが
  //   無い場合は、シナリオエディタ側の現状をそのまま尊重し、何もしない＝従来通りの挙動を保つ）
  if (typeof loadCustomScenarioData === "function") loadCustomScenarioData(); // scenariobuild.js
  if (Array.isArray(data.clearedChapterIds) && typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.chapters)) {
    scenarioProject.chapters.forEach(c => { c.cleared = data.clearedChapterIds.includes(c.id); });
    if (typeof saveCustomScenarioData === "function") saveCustomScenarioData();
  }
  
  // ★〈重要〉ロード直前にサブ画面（便利タブ等）を操作していた場合、controlFocusが
  //   "sub"のまま引き継がれてしまい、シナリオ再生中にキー操作が噛み合わなくなる
  //   （選択肢がキーボードで選べないように見える）不具合があったため、ロード後は
  //   必ずメイン画面操作の状態に戻す
  controlFocus = "main";
  updateControlFocusIndicator();
  
  window.removeEventListener("keydown", handleSaveLoadKeyDown);
  renderConvenienceIcons();
  switchTab("tab-main");
  hideLocationMenu();
  changeSpeaker("");
  
  if (!chapter1Finished && typeof data.scenarioStep === "number" && data.messageLog) {
    // ★第一話の途中のセーブ：シナリオを最初から再実行し、セーブ地点まで一気に再生する
    player = sanitizeLoadedPlayer(deepClone(data.player)); // player.js（古いセーブの互換性維持）
    inventorySlots = deepClone(data.inventorySlots);
    sanitizeInventoryInstanceIds(); // inventory.js（古いセーブ互換：instanceIdが無いマスに振り直す）
    migrateLegacyEquipmentReferences(); // player.js（古いセーブ互換：装備欄のitemId参照をinstanceIdに変換）
    // ★好感度が無い古いセーブでも壊れないよう、無ければ空から作る
    monsterAffection = data.monsterAffection ? deepClone(data.monsterAffection) : {};
    SPAREABLE_KEYS.forEach(key => { if (!(key in monsterAffection)) monsterAffection[key] = 0; });
    discoveredMonsters = data.discoveredMonsters ? deepClone(data.discoveredMonsters) : {};
    SPAREABLE_KEYS.forEach(key => { if (!(key in discoveredMonsters)) discoveredMonsters[key] = false; });
    renderStatusHUD();
    applyBackground(data.background); // ★再生が追いつくまでの一瞬、それらしい背景にしておく
    
    messageLog = [];
    replayTargetStep = data.scenarioStep;
    replayChoiceQueue = data.messageLog
      .filter(entry => entry.type === "choice")
      .map(entry => entry.text);
    isReplayingLog = true;
    
    startScene(); // 最初から再実行するが、再生モード中は演出・入力待ちを飛ばして一気に追いつく
  } else {
    // ★自由行動パートに入ってからのセーブ：記録されていた場所を直接開き直す
    player = sanitizeLoadedPlayer(deepClone(data.player)); // player.js（古いセーブの互換性維持）
    inventorySlots = deepClone(data.inventorySlots);
    sanitizeInventoryInstanceIds(); // inventory.js（古いセーブ互換：instanceIdが無いマスに振り直す）
    migrateLegacyEquipmentReferences(); // player.js（古いセーブ互換：装備欄のitemId参照をinstanceIdに変換）
    // ★好感度が無い古いセーブでも壊れないよう、無ければ空から作る
    monsterAffection = data.monsterAffection ? deepClone(data.monsterAffection) : {};
    SPAREABLE_KEYS.forEach(key => { if (!(key in monsterAffection)) monsterAffection[key] = 0; });
    discoveredMonsters = data.discoveredMonsters ? deepClone(data.discoveredMonsters) : {};
    SPAREABLE_KEYS.forEach(key => { if (!(key in discoveredMonsters)) discoveredMonsters[key] = false; });
    messageLog = deepClone(data.messageLog || []);
    renderStatusHUD();
    applyBackground(data.background); // ★セーブ時点の背景を復元する
    
    const resumeLocation = LOCATION_RESUMERS[currentLocationKey] || null;
    
    // ★エンディングに到達した直後のデータなら、その続きをどこから始めるか選んでもらう
    if (player.pendingResumeOptions) {
      const options = player.pendingResumeOptions;
      player.pendingResumeOptions = null; // ★一度きりの選択にする（以後は普通にロードされる）
      if (typeof loadCustomScenarioData === "function") loadCustomScenarioData(); // scenariobuild.js（話の最新データを読み込んでおく）
      const targetChapter = typeof scenarioProject !== "undefined" ? scenarioProject.chapters.find(c => c.id === options.chapterId) : null;
      
      if (targetChapter && options.choiceBlockId) {
        changeSpeaker("");
        const choiceResult = await displayChoices([
          { text: "エンディング直前の選択肢から始める", next: "choice" },
          { text: "話が始まる前（村の広場）から始める", next: "plaza" }
        ]);
        if (choiceResult.next === "choice") {
          if (typeof runScenarioChapterBlocksForReal === "function") {
            await runScenarioChapterBlocksForReal(targetChapter, options.choiceBlockId); // scenariobuild.js
          }
          return;
        }
      }
    }
    
    // ★施設（facility_で始まるキー）はまず動的に開き直しを試す。それ以外はLOCATION_RESUMERSの表から。
    //   どちらにも該当しない（例：探索中にセーブしていた等）場合は、安全のため町の広場に戻す
    if (!resumeLocationDynamic(currentLocationKey)) {
      (resumeLocation || LOCATION_RESUMERS.town)();
    }
  }
}