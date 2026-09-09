// devmode.js
// 開発者モード：設定タブの「開発者ボタン」からパスワード認証すると使えるようになる、
// デバッグ用の左端パネル。レベル・職業・ランクの変更、進行度や名声度といった
// 非表示ステータスの閲覧・自由編集、物語の進行状況の操作、専用セーブ枠への保存/読込ができる。
//
// ★window.prompt等は使わない方針のため、パスワード入力だけは専用のオーバーレイ（HTML標準のinput）を
//   使っている。開発者モード自体もいち利用者向けの通常UIではなく管理者向けの特別な画面なので、
//   このパネルの中の数値入力も、他の画面と違ってinputタグを直接使うことを許容している。

const DEVMODE_PASSWORD = "merry_desu1023";
const DEVMODE_SAVE_KEY = "demoge_devsave"; // ★開発者モード専用のセーブ枠（手動20枠・オートセーブ枠とは別）

let isDevModePanelOpen = false;

// ===== パスワード認証 =====

// 設定タブの「開発者ボタン」から呼ぶ：パスワード入力欄を開く
function openDevModePasswordPrompt() {
  const overlay = document.getElementById("devmode-password-overlay");
  const input = document.getElementById("devmode-password-input");
  const errorEl = document.getElementById("devmode-password-error");
  if (!overlay || !input) return;
  
  input.value = "";
  errorEl.classList.add("hidden");
  overlay.classList.remove("hidden");
  input.focus();
}

function closeDevModePasswordPrompt() {
  const overlay = document.getElementById("devmode-password-overlay");
  if (overlay) overlay.classList.add("hidden");
}

// パスワード欄の「決定」ボタンから呼ぶ
function submitDevModePassword() {
  const input = document.getElementById("devmode-password-input");
  const errorEl = document.getElementById("devmode-password-error");
  if (!input) return;
  
  if (input.value === DEVMODE_PASSWORD) {
    closeDevModePasswordPrompt();
    unlockDevMode();
  } else {
    errorEl.classList.remove("hidden");
    input.value = "";
    input.focus();
  }
}

// ページ読み込み時に一度だけ、上のイベントを配線しておく（settings.jsのloadSettingsから呼ばれる想定でもよいが、
// DOM自体はどのタイミングでも存在するので、ここではDOMContentLoaded相当のタイミングで直接配線する）
document.addEventListener("DOMContentLoaded", () => {
  const confirmBtn = document.getElementById("devmode-password-confirm");
  const cancelBtn = document.getElementById("devmode-password-cancel");
  const input = document.getElementById("devmode-password-input");
  
  if (confirmBtn) confirmBtn.onclick = (event) => { event.stopPropagation(); submitDevModePassword(); };
  if (cancelBtn) cancelBtn.onclick = (event) => { event.stopPropagation(); closeDevModePasswordPrompt(); };
  if (input) input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submitDevModePassword();
    if (event.key === "Escape") closeDevModePasswordPrompt();
  });
});

// ===== 開発者モードの有効化・パネルの開閉 =====

function unlockDevMode() {
  gameSettings.developerModeUnlocked = true; // settings.js
  saveSettings(); // settings.js
  showDevModeToggleButton();
  renderSettingsTab(); // settings.js（開発者ボタンの表示を「解除済み」に更新）
}

function showDevModeToggleButton() {
  const toggle = document.getElementById("devmode-tab-toggle");
  if (toggle && gameSettings.developerModeUnlocked) toggle.classList.remove("hidden");
}

function toggleDevModePanel() {
  isDevModePanelOpen = !isDevModePanelOpen;
  const panel = document.getElementById("devmode-panel");
  if (!panel) return;
  panel.classList.toggle("hidden", !isDevModePanelOpen);
  if (isDevModePanelOpen) renderDevModePanel();
}

// ===== パネルの中身 =====

function renderDevModePanel() {
  const container = document.getElementById("devmode-panel-content");
  if (!container || !player) return;
  container.innerHTML = "";
  
  container.appendChild(buildDevModeHeading("表示ステータス"));
  container.appendChild(buildDevModeNumberRow("レベル", () => player.level, (v) => debugSetPlayerLevel(v)));
  container.appendChild(buildDevModeClassRow());
  container.appendChild(buildDevModeRankRow());
  container.appendChild(buildDevModeNumberRow("所持金(G)", () => gold, (v) => { gold = Math.max(0, Math.floor(v)); renderStatusHUD(); })); // inventory.js
  container.appendChild(buildDevModeNumberRow("HP(現在値)", () => player.gauges.hp.current, (v) => { player.gauges.hp.current = Math.max(0, Math.min(player.gauges.hp.max, Math.floor(v))); renderStatusHUD(); }));
  container.appendChild(buildDevModeNumberRow("HP(最大値)", () => player.gauges.hp.max, (v) => { player.gauges.hp.max = Math.max(1, Math.floor(v)); renderStatusHUD(); }));
  container.appendChild(buildDevModeNumberRow("SP(現在値)", () => player.gauges.sp.current, (v) => { player.gauges.sp.current = Math.max(0, Math.min(player.gauges.sp.max, Math.floor(v))); renderStatusHUD(); }));
  
  // ★要望対応：仲間のレベルを、開発者モードから直接変更できるようにする
  //   （パーティー内・一時離脱中の両方。ステータス・HP/SP上限も、変更後のレベルで作り直す）
  const partyCompanions = Array.isArray(player.companions) ? player.companions : [];
  const benchedCompanionsList = Array.isArray(player.benchedCompanions) ? player.benchedCompanions : [];
  if (partyCompanions.length > 0 || benchedCompanionsList.length > 0) {
    container.appendChild(buildDevModeHeading("仲間のレベル"));
    [...partyCompanions, ...benchedCompanionsList].forEach((companion) => {
      const master = getCompanionMaster(companion); // player.js
      const name = master ? master.name : companion.companionId;
      const inBench = benchedCompanionsList.includes(companion);
      const label = `${name}${inBench ? "（離脱中）" : ""}`;
      container.appendChild(buildDevModeNumberRow(label, () => companion.level, (v) => debugSetCompanionLevel(companion, v)));
    });
  }
  
  container.appendChild(buildDevModeHeading("非表示ステータス"));
  container.appendChild(buildDevModeNumberRow("進行度 (progressPoints)", () => player.progressPoints, (v) => { player.progressPoints = Math.max(0, Math.floor(v)); }));
  container.appendChild(buildDevModeNumberRow("名声度 (fame)", () => player.fame, (v) => { player.fame = Math.max(0, Math.floor(v)); }));
  container.appendChild(buildDevModeNumberRow("転移後の経過日数", () => player.daysSinceTransfer, (v) => { player.daysSinceTransfer = Math.max(0, Math.floor(v)); renderStatusHUD(); }));
  
  // ★要望対応：魔物図鑑の好感度調査用に、全ての魔物の好感度を一括で変更できるデバッグ機能
  container.appendChild(buildDevModeHeading("魔物図鑑（好感度）"));
  const affectionNote = document.createElement("p");
  affectionNote.className = "devmode-note";
  affectionNote.textContent = "「見逃す」対象の魔物（SPAREABLE_KEYS）全員の好感度を、指定した値に一括で変更します。あわせて魔物図鑑にも「発見済み」として載るようにします。";
  container.appendChild(affectionNote);
  const affectionInput = document.createElement("input");
  affectionInput.type = "number";
  affectionInput.min = "0";
  affectionInput.max = "100";
  affectionInput.value = "100";
  const affectionBtn = document.createElement("button");
  affectionBtn.className = "devmode-btn";
  affectionBtn.textContent = "全ての魔物に一括適用";
  affectionBtn.onclick = (event) => {
    event.stopPropagation();
    const num = Math.max(0, Math.min(100, Math.floor(Number(affectionInput.value) || 0)));
    if (typeof SPAREABLE_KEYS !== "undefined") {
      SPAREABLE_KEYS.forEach(key => {
        monsterAffection[key] = num; // battle.js
        discoveredMonsters[key] = true; // convenience.js
      });
    }
    renderDevModePanel();
  };
  const affectionRow = document.createElement("div");
  affectionRow.className = "devmode-row";
  affectionRow.appendChild(affectionInput);
  affectionRow.appendChild(affectionBtn);
  container.appendChild(affectionRow);
  
  container.appendChild(buildDevModeHeading("物語の進行"));
  const chapterInfoEl = document.createElement("p");
  chapterInfoEl.className = "devmode-note";
  // ★第2話の解放条件は話管理タブで編集した内容がそのまま使われるので、ここもその内容を見て表示する（固定値ではない）
  if (typeof loadCustomScenarioData === "function") loadCustomScenarioData(); // scenariobuild.js
  const chapter2DevEntry = (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.chapters))
    ? scenarioProject.chapters.find(c => c.id === "builtin_chapter2") : null;
  const chapter2DevUnlockable = !!(chapter2DevEntry && !chapter2DevEntry.cleared && typeof evaluateChapterUnlockConditions === "function" && evaluateChapterUnlockConditions(chapter2DevEntry));
  const chapter2DevConditionText = chapter2DevEntry
    ? `必要日数${chapter2DevEntry.requiredDays || "なし"}／必要進行度${chapter2DevEntry.requiredProgress || "なし"}（話管理タブで編集可）`
    : "（第二話データ未取得）";
  chapterInfoEl.textContent = `第一話クリア: ${chapter1Finished ? "済み" : "未"} ／ 第二話の解放条件（${chapter2DevConditionText}）: ${chapter2DevUnlockable ? "満たしている" : "未達"}`;
  container.appendChild(chapterInfoEl);
  
  const chapterBtn = document.createElement("button");
  chapterBtn.className = "devmode-btn";
  chapterBtn.textContent = "第一話をクリア済みにして村へ";
  chapterBtn.onclick = (event) => {
    event.stopPropagation();
    chapter1Finished = true; // convenience.js
    toggleDevModePanel();
    openTownMenu(); // town.js
  };
  container.appendChild(chapterBtn);
  
  const jumpBtn = document.createElement("button");
  jumpBtn.className = "devmode-btn";
  jumpBtn.textContent = "第二話の解放条件を満たす数値にする";
  jumpBtn.onclick = (event) => {
    event.stopPropagation();
    player.progressPoints = Math.max(player.progressPoints, 200);
    player.daysSinceTransfer = Math.max(player.daysSinceTransfer, 15);
    renderDevModePanel();
  };
  container.appendChild(jumpBtn);
  
  container.appendChild(buildDevModeHeading("開発者専用セーブ"));
  const saveBtn = document.createElement("button");
  saveBtn.className = "devmode-btn";
  saveBtn.textContent = "この状態を開発者セーブに保存";
  saveBtn.onclick = (event) => {
    event.stopPropagation();
    saveDevModeSlot();
  };
  container.appendChild(saveBtn);
  
  const loadBtn = document.createElement("button");
  loadBtn.className = "devmode-btn";
  loadBtn.textContent = "開発者セーブから読み込む";
  loadBtn.onclick = (event) => {
    event.stopPropagation();
    loadDevModeSlot();
  };
  container.appendChild(loadBtn);
  
  container.appendChild(buildDevModeHeading("シナリオビルド"));
  const scenarioBuildNote = document.createElement("p");
  scenarioBuildNote.className = "devmode-note";
  scenarioBuildNote.textContent = "話の作成・削除・並び替えができます（骨組み段階：中身を組み立てるエディタは今後追加予定）。";
  container.appendChild(scenarioBuildNote);
  const scenarioBuildBtn = document.createElement("button");
  scenarioBuildBtn.className = "devmode-btn";
  scenarioBuildBtn.textContent = "シナリオビルドを開く";
  scenarioBuildBtn.onclick = (event) => {
    event.stopPropagation();
    openScenarioBuildMode(); // scenariobuild.js
  };
  container.appendChild(scenarioBuildBtn);
  
  container.appendChild(buildDevModeHeading("開発者モードの終了"));
  const lockBtn = document.createElement("button");
  lockBtn.className = "devmode-btn devmode-btn-danger";
  lockBtn.textContent = "開発者モードをロックする";
  lockBtn.onclick = (event) => {
    event.stopPropagation();
    lockDevMode();
  };
  container.appendChild(lockBtn);
}

function buildDevModeHeading(text) {
  const h = document.createElement("h3");
  h.textContent = text;
  return h;
}

// 数値1つを表示・編集する行を作る共通部品
// getValue: 現在値を返す関数 / applyValue: 「反映」を押した時、入力値(number)を受け取って反映する関数
function buildDevModeNumberRow(label, getValue, applyValue) {
  const row = document.createElement("div");
  row.className = "devmode-row";
  
  const labelEl = document.createElement("span");
  labelEl.className = "devmode-row-label";
  labelEl.textContent = label;
  
  const input = document.createElement("input");
  input.type = "number";
  input.value = getValue();
  
  const applyBtn = document.createElement("button");
  applyBtn.className = "devmode-btn";
  applyBtn.textContent = "反映";
  applyBtn.onclick = (event) => {
    event.stopPropagation();
    const num = Number(input.value);
    if (!Number.isFinite(num)) return;
    applyValue(num);
    renderDevModePanel(); // ★他の項目に影響することがある（レベル変更でHP上限が動く等）ため、まるごと描画し直す
  };
  
  row.appendChild(labelEl);
  row.appendChild(input);
  row.appendChild(applyBtn);
  return row;
}

// 職業を切り替える行（プルダウン）
function buildDevModeClassRow() {
  const row = document.createElement("div");
  row.className = "devmode-row";
  
  const labelEl = document.createElement("span");
  labelEl.className = "devmode-row-label";
  labelEl.textContent = "職業";
  
  const select = document.createElement("select");
  Object.keys(CLASS_MASTER).forEach(className => { // player.js
    const option = document.createElement("option");
    option.value = className;
    option.textContent = className;
    if (className === player.class) option.selected = true;
    select.appendChild(option);
  });
  
  const applyBtn = document.createElement("button");
  applyBtn.className = "devmode-btn";
  applyBtn.textContent = "反映";
  applyBtn.onclick = (event) => {
    event.stopPropagation();
    debugSetPlayerClass(select.value);
    renderDevModePanel();
  };
  
  row.appendChild(labelEl);
  row.appendChild(select);
  row.appendChild(applyBtn);
  return row;
}

// ランクを切り替える行（プルダウン）
function buildDevModeRankRow() {
  const row = document.createElement("div");
  row.className = "devmode-row";
  
  const labelEl = document.createElement("span");
  labelEl.className = "devmode-row-label";
  labelEl.textContent = "ランク";
  
  const select = document.createElement("select");
  RANK_ORDER.forEach(rank => { // questboard.js
    const option = document.createElement("option");
    option.value = rank;
    option.textContent = rank;
    if (rank === player.rank) option.selected = true;
    select.appendChild(option);
  });
  
  const applyBtn = document.createElement("button");
  applyBtn.className = "devmode-btn";
  applyBtn.textContent = "反映";
  applyBtn.onclick = (event) => {
    event.stopPropagation();
    player.rank = select.value;
    renderStatusHUD();
    renderDevModePanel();
  };
  
  row.appendChild(labelEl);
  row.appendChild(select);
  row.appendChild(applyBtn);
  return row;
}

// ★職業を変更する。レベル・経験値・装備・所持品はそのまま、基礎ステータスと各ゲージの最大値を
//   「新しい職業のbaseStats + 今のレベルぶんの成長」で計算し直す（レベルの成長分を消さないようにする）
function debugSetPlayerClass(className) {
  const cls = CLASS_MASTER[className]; // player.js
  if (!cls || !player) return;
  
  player.class = className;
  applyStatsForCurrentLevel();
  
  // ★魔法少女(おっさん)だけが持つ「マジカル変身」状態。他の職業から切り替えた場合はここで初期化する
  player.magicalGirlTransformed = false;
  
  renderStatusHUD();
}

// ★仲間のレベルを直接指定する。ステータス・HP/SP上限を、新しいレベルの分で作り直す。
//   ★累計獲得経験値（companion.totalExp。player.js参照）も、変更後のレベルに合わせて作り直しておく。
//   ここを合わせておかないと、次にセーブ→ロードした時（sanitizeLoadedPlayerの再計算）に、
//   「デバッグで変えたレベル」と「古いtotalExpから逆算されるレベル」が食い違い、
//   ロードのたびに元のレベルへ引き戻されてしまう
function debugSetCompanionLevel(companion, newLevel) {
  const master = getCompanionMaster(companion); // player.js
  if (!master) return;
  companion.level = Math.max(1, Math.floor(newLevel));
  companion.exp = 0; // ★手動でレベルを変更した場合、経験値は0からにする（中途半端な値が残らないようにする）
  companion.totalExp = calcTotalExpForLevel(companion.level, expNeededForLevel); // player.js
  const stats = getCompanionStatsAtLevel(master, companion.level); // player.js
  companion.gauges.hp.max = stats.maxHp;
  companion.gauges.hp.current = Math.min(companion.gauges.hp.current, stats.maxHp);
  companion.gauges.sp.max = stats.maxSp;
  companion.gauges.sp.current = Math.min(companion.gauges.sp.current, stats.maxSp);
  renderStatusHUD();
}

// ★レベルを直接指定する。指定レベルぶんの成長（class.growthPerLevelの累計）を、
//   基礎ステータス(baseStats)に足し直す形で反映する（addExpの自然なレベルアップと同じ計算式を使う）
function debugSetPlayerLevel(newLevel) {
  if (!player) return;
  player.level = Math.max(1, Math.floor(newLevel));
  player.exp = 0; // ★手動でレベルを変更した場合、経験値は0からにする（中途半端な値が残らないようにする）
  applyStatsForCurrentLevel();
  renderStatusHUD();
}

// ★player.class / player.level の組み合わせから、ステータス・各ゲージの最大値を計算し直す共通処理。
//   HP/SPは、既存の残量比率をできるだけ保つのではなく「新しい最大値を超えないようにクランプ」だけする
//   （devmodeでの変更は現在値を厳密に追わなくても実用上問題ないため、シンプルさを優先している）
function applyStatsForCurrentLevel() {
  if (!player) return;
  const cls = CLASS_MASTER[player.class]; // player.js
  const growth = cls && cls.growthPerLevel;
  if (!cls || !growth) return;
  
  const statKeys = ["atk", "agi", "skillPower", "luck", "charm"];
  const newStats = {};
  statKeys.forEach(key => {
    newStats[key] = cls.baseStats[key] + getCumulativeGrowth(growth, player.level, key); // player.js
  });
  player.stats = newStats;
  
  player.gauges.hp.max = cls.baseStats.maxHp + getCumulativeGrowth(growth, player.level, "maxHp");
  player.gauges.hp.current = Math.min(player.gauges.hp.current, player.gauges.hp.max);
  player.gauges.sp.max = cls.baseStats.maxSp + getCumulativeGrowth(growth, player.level, "maxSp");
  player.gauges.sp.current = Math.min(player.gauges.sp.current, player.gauges.sp.max);
  player.gauges.sleepiness.max = cls.maxSleepiness;
  player.gauges.fatigue.max = cls.maxFatigue + getCumulativeGrowth(growth, player.level, "maxFatigue");
  player.gauges.fatigue.current = Math.min(player.gauges.fatigue.current, player.gauges.fatigue.max);
}

// ===== 開発者専用セーブ =====

function saveDevModeSlot() {
  if (!player) return;
  localStorage.setItem(DEVMODE_SAVE_KEY, JSON.stringify(buildSaveData())); // convenience.js
  renderDevModePanel();
}

async function loadDevModeSlot() {
  const raw = localStorage.getItem(DEVMODE_SAVE_KEY);
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    await restoreGameFromSaveData(data); // convenience.js
    toggleDevModePanel(); // ★ロード後は元のシーンが表示されるので、パネルは閉じておく
  } catch (e) {
    console.error("開発者セーブの読み込みに失敗しました", e);
  }
}

// ===== ロック =====

function lockDevMode() {
  gameSettings.developerModeUnlocked = false; // settings.js
  saveSettings(); // settings.js
  isDevModePanelOpen = false;
  const toggle = document.getElementById("devmode-tab-toggle");
  const panel = document.getElementById("devmode-panel");
  if (toggle) toggle.classList.add("hidden");
  if (panel) panel.classList.add("hidden");
  renderSettingsTab(); // settings.js
}