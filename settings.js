// settings.js
// 「設定」タブ：文字送り速度・ログの記憶件数・オートセーブのON/OFFを管理する。
// ここで変更した内容は demoge_settings というキーでセーブデータとは別にlocalStorageへ保存し、
// どのセーブ枠を使っていても（あるいはまだセーブしていなくても）維持されるようにしてある。

const SETTINGS_KEY = "demoge_settings";
// ★要望対応：通常セーブ(20枠)とは別に、オートセーブも「5分ごと」「話直前」「終了時」の
//   3つの専用スロットに分ける（以前は1枠だけだった）。4つ目の「話をやり直す」は
//   セーブスロットではなく、話ごとに記録した選択肢チェックポイント（後述）を選ぶ形式なので
//   ここには含まない
const AUTOSAVE_KEYS = {
  timer: "demoge_autosave_timer",       // ★1枠目：5分ごとの自動セーブ
  prechapter: "demoge_autosave_prechapter", // ★2枠目：新しい話が始まる直前の自動セーブ
  onclose: "demoge_autosave_onclose"    // ★3枠目：ページを閉じた（閉じようとした）時の自動セーブ
};
const AUTOSAVE_SLOT_LABELS = { timer: "5分ごとのセーブ", prechapter: "話が始まる直前のセーブ", onclose: "ページを閉じた時のセーブ" };
const LEGACY_AUTOSAVE_KEY = "demoge_autosave"; // ★旧・単一オートセーブ枠（互換のため、1枠目が空ならここから移行する）

// 文字送り速度の選択肢（表示ラベルと、実際にtypeText側で1文字ごとに待つms）
const TEXT_SPEED_LEVELS = [
  { id: "slow", label: "遅い", ms: 90 },
  { id: "normal", label: "普通", ms: 50 },
  { id: "fast", label: "速い", ms: 20 },
  { id: "instant", label: "瞬間", ms: 0 }
];

const PLAY_SCREEN_TAB_DEFS = [
  { id: "tab-main", label: "メイン", enabledByDefault: true },
  { id: "tab-inventory", label: "インベントリ", enabledByDefault: true },
  { id: "tab-skill", label: "スキル", enabledByDefault: true },
  { id: "tab-companions", label: "仲間", enabledByDefault: true },
  { id: "tab-companionchat", label: "会話", enabledByDefault: false },
  { id: "tab-strength", label: "強さ", enabledByDefault: true },
  { id: "tab-equipment", label: "装備", enabledByDefault: true },
  { id: "tab-convenience", label: "便利", enabledByDefault: true },
  { id: "tab-log", label: "ログ", enabledByDefault: true },
  { id: "tab-setting", label: "設定", enabledByDefault: true }
];

// ログの記憶件数の選択肢
const LOG_MAX_LEVELS = [50, 100, 200, 300];

let gameSettings = {
  autoSaveEnabled: false,
  textSpeedId: "normal",
  logMaxCount: 100,
  bgmVolumeLevel: 20, // ★要望対応：BGM音量（0〜20の20段階。既定値20＝これまで通りの音量）
  showCorrectChoice: false, // ★ONにすると、選択肢のうち「正解」（話が進む方）に印を付けて表示する
  developerModeUnlocked: false, // ★開発者モード（devmode.js）のロック状態
  focusMainSwitchesToMainTab: false, // ★ONの時、Aキーでメイン画面に移行すると、サブ画面もメインタブに戻る（要望対応）
  showMainTabParams: false, // ★ONにすると主人公・仲間のパラメータをメインタブ内に表示する。OFF（デフォルト）だと
                            //   メインタブには表示せず、常時左上に表示する（要望対応）
  playTabVisibility: {}
};

function getPlayTabVisibilityMap() {
  if (!gameSettings || typeof gameSettings !== "object") return {};
  if (!gameSettings.playTabVisibility || typeof gameSettings.playTabVisibility !== "object") {
    gameSettings.playTabVisibility = {};
  }
  PLAY_SCREEN_TAB_DEFS.forEach(tab => {
    if (typeof gameSettings.playTabVisibility[tab.id] !== "boolean") {
      // ★要望対応：「会話」タブは、シナリオエディタの「タブ管理」で会話AI設定が有効になっている
      //   シナリオでは、プレイヤー側も最初から表示された状態にする（無効なシナリオでは今まで通り非表示スタート）
      if (tab.id === "tab-companionchat" && isScenarioCompanionChatEnabled()) {
        gameSettings.playTabVisibility[tab.id] = true;
      } else {
        gameSettings.playTabVisibility[tab.id] = tab.enabledByDefault !== false;
      }
    }
  });
  return gameSettings.playTabVisibility;
}

// ★要望対応：シナリオエディタの「タブ管理」で会話AI設定（companionchat）を有効にしているかどうか。
//   scenariobuild.jsのscenarioProjectを参照する（未読み込み等で参照できない場合はfalse扱い）
function isScenarioCompanionChatEnabled() {
  return typeof scenarioProject !== "undefined" && !!scenarioProject
    && !!scenarioProject.scenarioBuildTabVisibility
    && scenarioProject.scenarioBuildTabVisibility.companionchat === true;
}

function isPlayTabEnabled(tabId) {
  if (!tabId) return false;
  // ★バグ修正：シナリオエディタのタブ管理で会話AI設定をONにしても、以前はプレイヤー側の「会話」タブが
  //   出てこなかった（プレイヤー自身の設定は、シナリオ側の有効/無効と一切連動していなかったため）。
  //   シナリオ側で無効なままの時は、プレイヤーが自分の設定でONにしていても表示しない
  //   （機能自体がこのシナリオに用意されていないため）
  if (tabId === "tab-companionchat" && !isScenarioCompanionChatEnabled()) return false;
  const map = getPlayTabVisibilityMap();
  return map[tabId] !== false;
}

function getVisiblePlayTabIds() {
  return PLAY_SCREEN_TAB_DEFS.filter(tab => isPlayTabEnabled(tab.id)).map(tab => tab.id);
}

function renderPlayTabVisibilityManagerPanel() {
  const container = document.getElementById("settings-list-container");
  if (!container) return;

  const panel = document.createElement("div");
  panel.className = "setting-list";
  panel.style.marginTop = "16px";
  panel.style.borderTop = "1px solid rgba(255,255,255,0.2)";
  panel.style.paddingTop = "12px";

  const title = document.createElement("div");
  title.className = "setting-label";
  title.style.marginBottom = "8px";
  title.textContent = "プレイ画面タブ管理";
  panel.appendChild(title);

  PLAY_SCREEN_TAB_DEFS.forEach(tab => {
    const row = document.createElement("label");
    row.style.display = "flex";
    row.style.justifyContent = "space-between";
    row.style.alignItems = "center";
    row.style.padding = "6px 0";
    row.style.color = "#fff";
    
    // ★要望対応：「会話」タブは、シナリオ側で会話AI設定が有効になっていないと表示できない機能なので、
    //   その場合はチェックを入れても意味が無いことが分かるよう、行自体を無効化して案内を添える
    const isCompanionChatLocked = tab.id === "tab-companionchat" && typeof isScenarioCompanionChatEnabled === "function" && !isScenarioCompanionChatEnabled();
    if (isCompanionChatLocked) row.style.opacity = "0.5";

    const label = document.createElement("span");
    label.textContent = isCompanionChatLocked ? `${tab.label}（このシナリオでは未対応）` : tab.label;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isPlayTabEnabled(tab.id);
    checkbox.disabled = isCompanionChatLocked;
    checkbox.onchange = () => {
      const map = getPlayTabVisibilityMap();
      map[tab.id] = checkbox.checked;
      saveSettings();
      if (typeof applyPlayTabVisibility === "function") applyPlayTabVisibility();
      if (document.querySelector('.tab-content.active') && !isPlayTabEnabled(document.querySelector('.tab-content.active').id)) {
        const fallbackTab = getVisiblePlayTabIds()[0] || "tab-main";
        if (typeof switchTab === "function") switchTab(fallbackTab);
      }
    };

    row.appendChild(label);
    row.appendChild(checkbox);
    panel.appendChild(row);
  });

  container.appendChild(panel);
}

// ★ページ読み込み時に一度だけ呼ぶ（script.js）。保存済みの設定があれば読み込み、無ければ初期値のまま
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      gameSettings = Object.assign({}, gameSettings, saved);
    }
  } catch (e) {
    console.error("設定の読み込みに失敗しました", e);
  }
  getPlayTabVisibilityMap();
  applySettings();
  if (typeof applyPlayTabVisibility === "function") applyPlayTabVisibility();
  if (typeof showDevModeToggleButton === "function") showDevModeToggleButton(); // devmode.js
  startAutoSaveTimer(); // ★要望対応：5分ごとの自動セーブを開始する（gameSettings.autoSaveEnabledがOFFなら中では何もしない）
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(gameSettings));
}

// ★設定の値を実際の動作（textSpead・MESSAGE_LOG_MAX）に反映する
function applySettings() {
  const level = TEXT_SPEED_LEVELS.find(l => l.id === gameSettings.textSpeedId) || TEXT_SPEED_LEVELS[1];
  textSpead = level.ms; // mainfunc.js（タイプ音演出の待ち時間）
  MESSAGE_LOG_MAX = gameSettings.logMaxCount; // mainfunc.js
  trimMessageLogIfNeeded(); // ★上限を下げた直後にログが超過していたら、その場で切り詰める
  // ★要望対応：保存データが壊れている/古い場合の保険として、0〜20の整数に収める
  if (typeof gameSettings.bgmVolumeLevel !== "number" || !isFinite(gameSettings.bgmVolumeLevel)) {
    gameSettings.bgmVolumeLevel = 20;
  }
  gameSettings.bgmVolumeLevel = Math.max(0, Math.min(20, Math.round(gameSettings.bgmVolumeLevel)));
  if (typeof applyBgmVolumeSettingToCurrentAudio === "function") applyBgmVolumeSettingToCurrentAudio(); // bgm.js（既に何か鳴っていれば音量を反映）
}

// ===== オートセーブ本体（3スロット：5分ごと／話直前／終了時） =====

// ★どのスロットも、戦闘中（途中経過を保存する仕組みが無い）だけは保存しない。
//   手動セーブと違い、プレイヤーの操作を止めるわけではないので、それ以外のタイミング制限は設けない
function canAutoSaveNow() {
  if (!gameSettings.autoSaveEnabled) return false;
  if (!player) return false;
  if (typeof battleState !== "undefined" && battleState) return false;
  return true;
}

// ★slotType: "timer" | "prechapter" | "onclose"
// ★要望対応：ログイン中はクラウド(Firestore)のみ、未ログイン時は今まで通りlocalStorageのみに保存する
async function autoSaveToSlot(slotType) {
  if (!canAutoSaveNow()) return;
  try {
    if (typeof isCloudSaveActive === "function" && isCloudSaveActive()) {
      await cloudSetAutoSaveSlotData(slotType, buildSaveData()); // cloudsave.js（convenience.jsのbuildSaveDataを使う）
    } else {
      localStorage.setItem(AUTOSAVE_KEYS[slotType], JSON.stringify(buildSaveData())); // convenience.js
    }
  } catch (e) {
    console.error(`オートセーブ（${AUTOSAVE_SLOT_LABELS[slotType] || slotType}）に失敗しました`, e);
  }
}

// ★要望対応（メンテナンスモード）：canAutoSaveNow()の判定（オートセーブON/OFF設定など）に関係なく、
//   現在の状態を強制的にこの枠へ上書きする。メンテナンス中にログインボーナスを付与した記録を、
//   通常プレイができないその場で確実に書き戻すための専用処理（通常のオートセーブ処理とは別物）
async function forceOverwriteAutoSaveSlot(slotType) {
  try {
    const data = buildSaveData(); // convenience.js
    if (typeof isCloudSaveActive === "function" && isCloudSaveActive()) {
      await cloudSetAutoSaveSlotData(slotType, data); // cloudsave.js
    } else {
      localStorage.setItem(AUTOSAVE_KEYS[slotType], JSON.stringify(data));
    }
  } catch (e) {
    console.error(`オートセーブ（${AUTOSAVE_SLOT_LABELS[slotType] || slotType}）への書き戻しに失敗しました`, e);
  }
}

function getAutoSaveSlotData(slotType) {
  // ★要望対応：ログイン中はクラウド(Firestore)から取得する（ローカルの旧データ移行は未ログイン時のみ考慮すればよい）
  if (typeof isCloudSaveActive === "function" && isCloudSaveActive()) return cloudGetAutoSaveSlotData(slotType); // cloudsave.js
  // ★1枠目（timer）がまだ無く、旧・単一オートセーブ枠にだけデータが残っている場合は、
  //   互換のためそちらを表示する（何もかも消えたように見えてしまうのを防ぐ）
  const key = (slotType === "timer" && !localStorage.getItem(AUTOSAVE_KEYS.timer) && localStorage.getItem(LEGACY_AUTOSAVE_KEY))
    ? LEGACY_AUTOSAVE_KEY
    : AUTOSAVE_KEYS[slotType];
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error("オートセーブデータの読み込みに失敗しました", e);
    return null;
  }
}

// ★要望対応：5分ごとに1枠目へ自動セーブする（ページを開いている間、ずっと動き続けるタイマー）
let autoSaveTimerHandle = null;
function startAutoSaveTimer() {
  if (autoSaveTimerHandle) return; // ★二重登録防止
  autoSaveTimerHandle = setInterval(() => autoSaveToSlot("timer"), 5 * 60 * 1000);
}

// ★要望対応：ページを閉じよう（リロード・タブを閉じるなど）とした瞬間に3枠目へ自動セーブする。
//   非同期処理はここでは完了を待てないため、buildSaveData/localStorage.setItemが同期処理であることを利用する
window.addEventListener("beforeunload", () => autoSaveToSlot("onclose"));

// ===== 設定タブの描画・操作 =====

let settingsCursorIndex = 0;
let isPlayTabVisibilityPanelOpen = false;
const SETTINGS_ROW_COUNT = 13; // 0:文字送り速度 1:ログ記憶数 2:BGM音量 3:オートセーブON/OFF 4:オートセーブから再開する
                               // 5:正解の選択肢を表示 6:Aキーでメインタブに戻す 7:メインタブのパラメータ表示
                               // 8:全画面表示 9:開発者ボタン 10:Googleアカウント（auth.js） 11:プレイ画面のタブ管理 12:メインメニューに戻る

// ★要望対応：BGM音量を「┃」を20本並べたバーで表示する。現在の音量までを塗り、それ以降は薄い色のままにする
function renderVolumeBarSegments(container, level, max) {
  container.innerHTML = "";
  container.classList.add("setting-volume-bar-wrap");
  const clampedLevel = Math.max(0, Math.min(max, level));
  const barsEl = document.createElement("span");
  barsEl.className = "setting-volume-bar";
  for (let i = 0; i < max; i++) {
    const seg = document.createElement("span");
    seg.className = "setting-volume-bar-segment" + (i < clampedLevel ? " filled" : "");
    seg.textContent = "┃";
    barsEl.appendChild(seg);
  }
  const numEl = document.createElement("span");
  numEl.className = "setting-volume-bar-number";
  numEl.textContent = ` ${clampedLevel}/${max}`;
  container.appendChild(barsEl);
  container.appendChild(numEl);
}

function renderSettingsTab() {
  // ★バグ修正：以前はtab-setting自体のinnerHTMLを毎回まるごと書き換えていたため、
  //   同じtab-setting内に置いたオートセーブ一覧パネル（autosave-panel）が、設定タブを
  //   再描画するたび（オートセーブパネルを閉じた時も含む）にDOMごと消えてしまっていた。
  //   設定項目の一覧だけを専用の子要素（settings-list-container）に描画するようにして、
  //   オートセーブパネルの方は巻き込まれないようにする
  const container = document.getElementById("settings-list-container");
  if (!container) return;
  container.innerHTML = "";
  
  const list = document.createElement("div");
  list.className = "setting-list";
  
  const textSpeedLevel = TEXT_SPEED_LEVELS.find(l => l.id === gameSettings.textSpeedId) || TEXT_SPEED_LEVELS[1];
  
  const rows = [
    { label: "文字送り速度", value: textSpeedLevel.label, hint: "◀／▶で変更" },
    { label: "ログの記憶件数", value: `直近${gameSettings.logMaxCount}件`, hint: "◀／▶で変更" },
    { label: "BGM音量", renderBar: true, hint: "◀／▶で変更（20段階）" },
    { label: "オートセーブ", value: gameSettings.autoSaveEnabled ? "ON" : "OFF", hint: "◀／▶／決定で切替" },
    { label: "オートセーブ一覧", value: "", hint: "決定で「5分ごと／話直前／終了時／話をやり直す」から選ぶ" },
    { label: "正解の選択肢を表示", value: gameSettings.showCorrectChoice ? "ON" : "OFF", hint: "◀／▶／決定で切替（選択肢のうち話が進む方に★が付く）" },
    { label: "メイン画面に移行する時、メインタブに切り替える", value: gameSettings.focusMainSwitchesToMainTab ? "ON" : "OFF", hint: "◀／▶／決定で切替（Aキーでメイン画面に移行した時だけ有効。タップでの切り替えは対象外）" },
    { label: "メインタブのパラメータ表示", value: gameSettings.showMainTabParams ? "ON" : "OFF", hint: "◀／▶／決定で切替（OFFだと、主人公・仲間のパラメータは常時左上に表示されます）" },
    { label: "全画面表示", value: isFullscreenActive() ? "ON" : "OFF", hint: "決定／タップで切替（対応していない端末・ブラウザでは反応しません）" },
    { label: "開発者ボタン", value: gameSettings.developerModeUnlocked ? "解除済み" : "未解除", hint: gameSettings.developerModeUnlocked ? "画面左端のタブから開発者モードを開けます" : "決定でパスワードを入力" },
    (typeof getGoogleAccountSettingsRow === "function") ? getGoogleAccountSettingsRow() : { label: "Googleアカウント", value: "未ログイン", hint: "決定でログイン" }, // auth.js（要望対応）
    { label: "プレイ画面のタブ管理", value: "開く", hint: "決定で表示／非表示を切り替える" },
    { label: "メインメニューに戻る", value: "", hint: "決定で実行（セーブしていない進行状況は失われます）" }
  ];
  
  // ★スマホ（タッチ操作）ではキーボードの←／→／決定キーが無く、行をタップしてカーソルを
  //   合わせるだけでは値を変更できなかったバグの修正。
  //   ・◀／▶キー相当のタップ用ボタンを、左右キーで値を変える行にだけ追加する。
  //   ・行本体（ラベル／値の部分）をタップした時は、カーソルをその行に合わせつつ、
  //     決定キーを押した時と同じ動作（ON/OFF切替や各種実行）もその場で行う。
  const ADJUSTABLE_ROW_INDEXES = [0, 1, 2]; // ◀▶ボタンで段階的に変える行（文字送り速度・ログ件数・BGM音量）
  
  rows.forEach((row, i) => {
    const rowEl = document.createElement("div");
    rowEl.className = "setting-row" + (i === settingsCursorIndex ? " cursor" : "");
    
    const mainEl = document.createElement("div");
    mainEl.className = "setting-row-main";
    mainEl.onclick = (event) => {
      event.stopPropagation();
      settingsCursorIndex = i;
      renderSettingsTab();
      executeSettingsDecideAction(i); // ★タップ操作でも決定キーと同じ動作を実行する（スマホ対応）
    };
    
    const labelEl = document.createElement("span");
    labelEl.className = "setting-label";
    labelEl.textContent = row.label;
    
    const valueEl = document.createElement("span");
    valueEl.className = "setting-value";
    if (row.renderBar) {
      renderVolumeBarSegments(valueEl, gameSettings.bgmVolumeLevel, 20); // ★要望対応：BGM音量を┃20本の色分けバーで表示
    } else {
      valueEl.textContent = row.value;
    }
    
    mainEl.appendChild(labelEl);
    mainEl.appendChild(valueEl);
    rowEl.appendChild(mainEl);
    
    if (ADJUSTABLE_ROW_INDEXES.includes(i)) {
      const arrowWrap = document.createElement("div");
      arrowWrap.className = "setting-row-arrows";
      
      const leftBtn = document.createElement("button");
      leftBtn.type = "button";
      leftBtn.className = "setting-arrow-btn";
      leftBtn.textContent = "◀";
      leftBtn.onclick = (event) => {
        event.stopPropagation();
        settingsCursorIndex = i;
        adjustCurrentSetting(-1);
      };
      
      const rightBtn = document.createElement("button");
      rightBtn.type = "button";
      rightBtn.className = "setting-arrow-btn";
      rightBtn.textContent = "▶";
      rightBtn.onclick = (event) => {
        event.stopPropagation();
        settingsCursorIndex = i;
        adjustCurrentSetting(1);
      };
      
      arrowWrap.appendChild(leftBtn);
      arrowWrap.appendChild(rightBtn);
      rowEl.appendChild(arrowWrap);
    }
    
    list.appendChild(rowEl);
  });
  
  container.appendChild(list);

  if (isPlayTabVisibilityPanelOpen) {
    renderPlayTabVisibilityManagerPanel();
  }
  
  const hintEl = document.createElement("p");
  hintEl.className = "setting-hint";
  hintEl.textContent = rows[settingsCursorIndex].hint;
  container.appendChild(hintEl);
}

// ★左右キーで、選んでいる行の値を変更する
function adjustCurrentSetting(direction) {
  if (settingsCursorIndex === 0) {
    // 文字送り速度
    const ids = TEXT_SPEED_LEVELS.map(l => l.id);
    let idx = ids.indexOf(gameSettings.textSpeedId);
    idx = Math.max(0, Math.min(ids.length - 1, idx + direction));
    gameSettings.textSpeedId = ids[idx];
    applySettings();
    saveSettings();
    renderSettingsTab();
    
  } else if (settingsCursorIndex === 1) {
    // ログの記憶件数
    let idx = LOG_MAX_LEVELS.indexOf(gameSettings.logMaxCount);
    if (idx === -1) idx = 1; // ★不正な値が入っていた場合の保険（100件相当の位置から始める）
    idx = Math.max(0, Math.min(LOG_MAX_LEVELS.length - 1, idx + direction));
    gameSettings.logMaxCount = LOG_MAX_LEVELS[idx];
    applySettings();
    saveSettings();
    renderSettingsTab();
    
  } else if (settingsCursorIndex === 2) {
    // ★要望対応：BGM音量（0〜20の20段階）
    const level = typeof gameSettings.bgmVolumeLevel === "number" ? gameSettings.bgmVolumeLevel : 20;
    gameSettings.bgmVolumeLevel = Math.max(0, Math.min(20, level + direction));
    saveSettings();
    if (typeof applyBgmVolumeSettingToCurrentAudio === "function") applyBgmVolumeSettingToCurrentAudio(); // bgm.js（今鳴っている曲にもすぐ反映する）
    renderSettingsTab();
    
  } else if (settingsCursorIndex === 3) {
    // オートセーブON/OFF（左右どちらでもトグルする）
    gameSettings.autoSaveEnabled = !gameSettings.autoSaveEnabled;
    saveSettings();
    renderSettingsTab();
    
  } else if (settingsCursorIndex === 5) {
    // 正解の選択肢を表示 ON/OFF（左右どちらでもトグルする）
    gameSettings.showCorrectChoice = !gameSettings.showCorrectChoice;
    saveSettings();
    renderSettingsTab();
    
  } else if (settingsCursorIndex === 6) {
    // メイン画面に移行する時、メインタブに切り替える ON/OFF（左右どちらでもトグルする）
    gameSettings.focusMainSwitchesToMainTab = !gameSettings.focusMainSwitchesToMainTab;
    saveSettings();
    renderSettingsTab();
    
  } else if (settingsCursorIndex === 7) {
    // メインタブのパラメータ表示 ON/OFF（左右どちらでもトグルする）
    gameSettings.showMainTabParams = !gameSettings.showMainTabParams;
    saveSettings();
    if (typeof applyMainTabParamsDisplayMode === "function") applyMainTabParamsDisplayMode(); // mainfunc.js
    renderSettingsTab();
  }
}

window.addEventListener("keydown", (event) => {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  if (controlFocus !== "sub") return;
  if (isGameDialogOpen) return;
  if (event.repeat) return;
  
  const activeTab = document.querySelector('.tab-content.active');
  if (!activeTab || activeTab.id !== 'tab-setting') return;
  
  if (event.key === "ArrowDown") {
    event.preventDefault();
    settingsCursorIndex = Math.min(SETTINGS_ROW_COUNT - 1, settingsCursorIndex + 1);
    renderSettingsTab();
    
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    settingsCursorIndex = Math.max(0, settingsCursorIndex - 1);
    renderSettingsTab();
    
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    adjustCurrentSetting(-1);
    
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    adjustCurrentSetting(1);
    
  } else if (KEY_CONFIG.decideKeys.includes(event.key)) {
    event.preventDefault();
    executeSettingsDecideAction(settingsCursorIndex);
  }
});

// ★決定キー操作／行タップ操作の共通処理（スマホでのタップ操作対応のため関数化）
function executeSettingsDecideAction(index) {
  if (index === 3) {
    adjustCurrentSetting(1); // ★オートセーブ行は決定でもトグルできるようにする
  } else if (index === 4) {
    openAutoSavePanel(); // convenience.js
  } else if (index === 5) {
    adjustCurrentSetting(1); // ★正解の選択肢を表示 行も決定でトグルできるようにする
  } else if (index === 6) {
    adjustCurrentSetting(1); // ★メイン画面に移行する時、メインタブに切り替える 行も決定でトグルできるようにする
  } else if (index === 7) {
    adjustCurrentSetting(1); // ★メインタブのパラメータ表示 行も決定でトグルできるようにする
  } else if (index === 8) {
    toggleFullscreen().then(() => renderSettingsTab()); // mainfunc.js（要望対応：設定から全画面表示）
  } else if (index === 9) {
    handleDevModeButtonDecide(); // ★未解除ならパスワード入力を開く。解除済みなら特に何もしない（左端タブから操作する）
  } else if (index === 10) {
    if (typeof handleGoogleAccountSettingsDecide === "function") handleGoogleAccountSettingsDecide(); // auth.js（要望対応：Googleアカウントログイン/ログアウト）
  } else if (index === 11) {
    isPlayTabVisibilityPanelOpen = !isPlayTabVisibilityPanelOpen;
    renderSettingsTab();
  } else if (index === 12) {
    handleReturnToMainMenuFromSettings();
  }
}

// 設定タブの「開発者ボタン」の決定キー・クリック共通の処理
function handleDevModeButtonDecide() {
  if (gameSettings.developerModeUnlocked) return; // ★既に解除済みなら、ここでは何もしない（画面左端のタブを使う）
  if (typeof openDevModePasswordPrompt === "function") openDevModePasswordPrompt(); // devmode.js
}

// 設定タブの「メインメニューに戻る」。セーブしていない進行状況が失われることを確認してから戻る
async function handleReturnToMainMenuFromSettings() {
  const ok = await showGameConfirm("メインメニューに戻りますか？（セーブしていない進行状況は失われます）"); // mainfunc.js
  if (!ok) return;
  returnToTitleScreen(); // mainfunc.js
}

// ★ブラウザの戻る操作やEscキーなど、設定画面の外から全画面表示が解除された時にも
//   表示（ON/OFF）を最新の状態に合わせておく
["fullscreenchange", "webkitfullscreenchange"].forEach(evt => {
  document.addEventListener(evt, () => {
    const activeTab = document.querySelector('.tab-content.active');
    if (activeTab && activeTab.id === 'tab-setting') renderSettingsTab();
    if (typeof updateTitleFullscreenButtonLabel === "function") updateTitleFullscreenButtonLabel(); // titlescreen.js
  });
});