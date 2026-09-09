const nameVar = document.getElementById("speaker-name");
const textVar = document.getElementById("message-text");
const choiceBox = document.querySelector(".choice-box")
const messageWindow = document.querySelector(".message-window");
const mainScreen = document.querySelector(".main-screen");
const specialOverlay = document.getElementById('special-overlay');
const specialText = document.getElementById('special-text');


let textSpead = 50

// シナリオのテキストが表示中（＝プレイヤーの入力待ち含む）かどうか
let isTextDisplaying = false;

// 文字送り（1文字ずつのタイピング演出）が実行中かどうか
let isTyping = false;

// タイピング中に「今すぐ全部表示して」と要求されたかどうか
let skipTypingRequested = false;

// 早送りモード（ONの間はタイピングも即表示、メッセージも自動で進む）
let fastForwardMode = false;

// ===== セッション管理 =====
// ロードで「シナリオの途中から再開」する時に、古い（ロード前の）進行を安全に凍結するための仕組み。
// ロードするたびにこの値を+1する。既存の displayMessage/typeText/waitForAdvance/displayChoices は
// 「自分が始まった時のこの値」を覚えておき、値が変わっていたらそれ以上何もしない（フリーズする）。
let activeSessionToken = 0;

// ===== ログ再生（セーブ地点までの高速リプレイ） =====
// 第一話（scenario.js）はロード時に最初から再実行し、セーブされた地点までは
// 演出・入力待ちを省略して一気に追いつかせる。追いついたら通常表示に戻る。
let isReplayingLog = false; // 現在ログ再生中かどうか
let replayTargetStep = 0; // このログ件数まで一気に再生する
let replayChoiceQueue = []; // 再生中に自動選択する選択肢テキストの列（順番通り）

// ===== 操作フォーカス（メイン画面 / サブ画面） =====
// a キー：メイン画面（本文・行き先メニュー・選択肢）を操作
// d キー：サブ画面（インベントリ・スキル・便利タブなど）を操作
let controlFocus = "main"; // "main" | "sub"

// ===== 全画面表示（要望対応：設定タブ・タイトル画面の両方から使う共通処理） =====
// ★スマホブラウザでは、全画面化できるのは実際にユーザー操作（クリック/タップ）の中でのみのため、
//   必ずボタンのonclickなど、ユーザー操作のハンドラの中から直接呼ぶこと
function isFullscreenActive() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

async function toggleFullscreen() {
  try {
    if (isFullscreenActive()) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) await document.webkitExitFullscreen(); // ★iOS Safari等
    } else {
      const target = document.documentElement;
      if (target.requestFullscreen) await target.requestFullscreen();
      else if (target.webkitRequestFullscreen) await target.webkitRequestFullscreen(); // ★iOS Safari等
    }
  } catch (e) {
    console.error("全画面表示の切り替えに失敗しました（この端末・ブラウザでは対応していない可能性があります）", e);
  }
}

function updateControlFocusIndicator() {
  const main = document.querySelector('.main-screen');
  const sub = document.querySelector('.sub-screen');
  if (main) main.classList.toggle('focus-active', controlFocus === 'main');
  if (sub) sub.classList.toggle('focus-active', controlFocus === 'sub');
  // ★縦長の画面（レスポンシブ時）では、操作対象の切り替え（a/dキー、または下のボタン）が
  //   そのまま「今どちらの画面をまるごと表示するか」の切り替えにもなる
  const container = document.querySelector('.game-container');
  if (container) container.classList.toggle('portrait-show-sub', controlFocus === 'sub');
  const switchBtn = document.getElementById('portrait-switch-btn');
  if (switchBtn) {
    // ★textContentで書き換えるとキーバッジ（A/Dの小さな表示）ごと消えてしまうため、
    //   ラベル部分だけ別のspanに分けて、そちらだけ差し替える
    let labelEl = switchBtn.querySelector('.portrait-switch-label');
    if (!labelEl) {
      switchBtn.innerHTML = '';
      labelEl = document.createElement('span');
      labelEl.className = 'portrait-switch-label';
      switchBtn.appendChild(labelEl);
      const badge = document.createElement('span');
      badge.className = 'key-badge';
      badge.textContent = 'A/D';
      switchBtn.appendChild(badge);
    }
    labelEl.textContent = controlFocus === 'sub' ? '⇄ メイン画面へ' : '⇄ サブ画面へ';
  }
}

// ★縦画面の切り替えボタン用。横画面では使われない（a/dキーと同じ扱い）
function togglePortraitScreen() {
  controlFocus = controlFocus === 'main' ? 'sub' : 'main';
  updateControlFocusIndicator();
}

const KEY_CONFIG_FOCUS_MAIN = ["a", "A"];
const KEY_CONFIG_FOCUS_SUB = ["d", "D"];

window.addEventListener("keydown", (event) => {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  if (event.repeat) return; // ★キーを押しっぱなしにしても連続で切り替わらないようにする
  if (KEY_CONFIG_FOCUS_MAIN.includes(event.key)) {
    controlFocus = "main";
    updateControlFocusIndicator();
    // ★設定「メイン画面に移行する時、メインタブに切り替える」がONなら、Aキーでの移行時だけ
    //   サブ画面もメインタブ（tab-main）に戻す（要望対応。タップでの画面切り替えは対象外）
    if (typeof gameSettings !== "undefined" && gameSettings.focusMainSwitchesToMainTab) {
      const activeTab = document.querySelector(".tab-content.active");
      if (activeTab && activeTab.id !== "tab-main" && typeof switchTab === "function") {
        switchTab("tab-main");
      }
    }
  } else if (KEY_CONFIG_FOCUS_SUB.includes(event.key)) {
    controlFocus = "sub";
    updateControlFocusIndicator();
  }
});

// ★最初はメイン画面操作の状態でスタートするので、見た目を合わせておく
updateControlFocusIndicator();

// ===== ログ（会話・選択肢の履歴） =====
// { type: "message", speaker, text } または { type: "choice", text } の配列
let messageLog = [];
let MESSAGE_LOG_MAX = 100; // ★ログを溜め込みすぎると重くなるので、記憶するのは直近100件まで（デフォルト値。設定タブで変更可能）

// ★ログが上限を超えたら古い方から間引く。
//   第一話（chapter1）中はメッセージ数がここまで多くならない上、
//   messageLog.length はリプレイの進行度判定にも使われているため、
//   chapter1が終わった後だけ間引く（終わった後はリプレイ判定を使わないので安全）
function trimMessageLogIfNeeded() {
  if (chapter1Finished && messageLog.length > MESSAGE_LOG_MAX) {
    messageLog.splice(0, messageLog.length - MESSAGE_LOG_MAX);
  }
}

function logMessage(speaker, text) {
  messageLog.push({ type: "message", speaker: speaker || "", text: text });
  trimMessageLogIfNeeded();
  renderLogIfActive();
}

function logChoice(text) {
  messageLog.push({ type: "choice", text: text });
  trimMessageLogIfNeeded();
  renderLogIfActive();
}

// ログタブが今開いている時だけ再描画する（開いていない時に毎回描画するのは無駄なので）
function renderLogIfActive() {
  const activeTab = document.querySelector('.tab-content.active');
  if (activeTab && activeTab.id === 'tab-log') {
    renderLogTab();
  }
}

// ログタブ：これまでの会話・選択肢を一覧で描画する
function renderLogTab() {
  const container = document.getElementById("log-list");
  if (!container) return;
  
  container.innerHTML = "";
  
  if (messageLog.length === 0) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "log-empty";
    emptyEl.textContent = "まだログがありません。";
    container.appendChild(emptyEl);
    return;
  }
  
  for (const entry of messageLog) {
    const row = document.createElement("div");
    
    if (entry.type === "choice") {
      // ★選択した選択肢は、それとわかるように専用の見た目にする
      row.className = "log-entry log-entry-choice";
      
      const label = document.createElement("span");
      label.className = "log-choice-label";
      label.textContent = "▶選択";
      
      const textEl = document.createElement("span");
      textEl.className = "log-choice-text";
      textEl.innerHTML = entry.text;
      
      row.appendChild(label);
      row.appendChild(textEl);
    } else {
      row.className = "log-entry";
      
      if (entry.speaker) {
        const speakerEl = document.createElement("span");
        speakerEl.className = "log-speaker";
        speakerEl.textContent = entry.speaker;
        row.appendChild(speakerEl);
      }
      
      const textEl = document.createElement("span");
      textEl.className = "log-text";
      textEl.innerHTML = entry.text;
      row.appendChild(textEl);
    }
    
    container.appendChild(row);
  }
  
  // 最新のログが見えるよう一番下までスクロールしておく
  container.scrollTop = container.scrollHeight;
}


const KEY_CONFIG = {
  advanceKeys: [" ", "z", "ArrowDown"], // シナリオの文章送り専用（メッセージを進める）
  decideKeys: [" ", "z"], // 選択肢・インベントリの決定用
  cancelKeys: ["x", "X"], // インベントリなどでの「戻る」用
  tabLeftKey: ["q", "Q"], // 左タブ切り替え用
  tabRightKey: ["e", "E"], // 右タブ切り替え用
  fastForwardKey: ["h", "H"], // 早送りON/OFF切り替え用
  hideChoicesKey: ["v", "V"] // 選択肢の一時非表示ON/OFF切り替え用
};

// タイピング中にクリック・決定キーが押されたら、残りの文章を一気に表示させる
function requestSkipTyping() {
  if (isTyping) {
    skipTypingRequested = true;
  }
}

// ★今表示中のメッセージが「サブ画面（インベントリ・スキル等のタブ）からでも進行できる」例外扱いかどうか。
//   スキル・アイテムをサブ画面で使った時の結果メッセージなど、特別に許可された場合だけtrueになる
let currentMessageAllowsSubFocus = false;

window.addEventListener("keydown", (event) => {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  if (event.repeat) return; // ★押しっぱなしで連続スキップされないようにする
  if (!isTextDisplaying) return; // ★メッセージ表示中でなければ他のキー操作と競合させない
  if (controlFocus !== "main" && !currentMessageAllowsSubFocus) return; // ★サブ画面を開いている間は、原則、文字送りのスキップも発生させない（例外は上のフラグで許可）
  if (KEY_CONFIG.advanceKeys.includes(event.key)) {
    requestSkipTyping();
  }
});

document.addEventListener("click", () => {
  requestSkipTyping();
});

// 早送りモードのON/OFFを切り替える（ボタン・1キー共通）
function toggleFastForward() {
  fastForwardMode = !fastForwardMode;
  const btn = document.getElementById("fast-forward-btn");
  if (btn) btn.classList.toggle("active", fastForwardMode);
}

window.addEventListener("keydown", (event) => {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  if (event.repeat) return; // ★押しっぱなしで連続トグルされないようにする
  if (KEY_CONFIG.fastForwardKey.includes(event.key)) {
    toggleFastForward();
  }
});

// ★選択肢を一時的に隠す（ボタン・Vキー共通）。裏の背景や立ち絵をじっくり見たい時などに使う。
//   選択肢自体は消えておらず、あくまで見た目を隠すだけなので、もう一度押せば元の状態のまま戻ってくる
let choicesHiddenByUser = false;
function toggleHideChoices() {
  choicesHiddenByUser = !choicesHiddenByUser;
  choiceBox.classList.toggle("user-hidden", choicesHiddenByUser);
  const btn = document.getElementById("hide-choices-btn");
  if (btn) btn.classList.toggle("active", choicesHiddenByUser);
}

window.addEventListener("keydown", (event) => {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  if (event.repeat) return;
  if (KEY_CONFIG.hideChoicesKey.includes(event.key)) {
    toggleHideChoices();
  }
});

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ★演出ブロック（scenariobuild.js）から呼ばれる、画面全体を一瞬揺らす効果
function triggerCameraShake() {
  const target = document.querySelector(".main-screen");
  if (!target) return;
  target.classList.remove("camera-shake");
  void target.offsetWidth; // ★同じアニメーションを連続で出せるよう、一度リフローを挟んで強制的にやり直させる
  target.classList.add("camera-shake");
  setTimeout(() => target.classList.remove("camera-shake"), 400);
}

// ★演出ブロック（scenariobuild.js）から呼ばれる、被弾を示す赤い画面フラッシュ
function triggerHitFlash() {
  const flashEl = document.getElementById("hit-flash-overlay");
  if (!flashEl) return;
  flashEl.classList.remove("hit-flash-active");
  void flashEl.offsetWidth;
  flashEl.classList.add("hit-flash-active");
  setTimeout(() => flashEl.classList.remove("hit-flash-active"), 120);
}

// ★要望対応：回想シーンなどに使う「モノクロ」演出。effectブロックのeffectType
//   monochromeOn/monochromeOffから呼ばれる。画面全体（body）にモノクロフィルターをかけ、
//   回想終了ブロック（monochromeOff）を通るまでずっと維持される（タブ切り替え・戦闘に入っても継続）
let isMonochromeEffectActive = false;
function setMonochromeEffect(active) {
  isMonochromeEffectActive = !!active;
  document.body.classList.toggle("screen-monochrome", isMonochromeEffectActive);
}

// ★要望対応：「暗転」演出。画面全体を黒くフェードアウトさせる（シーン切り替え等に使う）。
//   effectブロックのeffectType blackoutOn/blackoutOffから呼ぶ。
//   モノクロと違い、切り替わり自体をCSSのopacityトランジションでゆっくり見せる（暗転らしい演出にするため）
let blackoutOverlayEl = null;
function setBlackoutEffect(active, fadeMs = 600) {
  if (!blackoutOverlayEl) {
    blackoutOverlayEl = document.createElement("div");
    blackoutOverlayEl.id = "screen-blackout-overlay";
    document.body.appendChild(blackoutOverlayEl);
  }
  blackoutOverlayEl.style.transition = `opacity ${fadeMs}ms ease`;
  blackoutOverlayEl.classList.toggle("active", !!active);
}

// ★エンディングブロック（scenariobuild.js）から呼ばれる、簡易エンドロール（下から上へ流れるスタッフロール風演出）。
//   最後の行が画面の一番上まで来たところで止まり、3秒静止したあと画面が白くフェードして終了する。
//   スキップボタンでも、いつでもすぐに終了できる
// ★endBgmTrackを指定すると、エンドロール開始と同時にそのBGMを鳴らし、終了時にフェードアウトする
// ★scrollSeconds：最後の行が上に到達するまでのスクロール秒数（長いほどゆっくり流れる。デフォルト20秒）
function playEndRoll(creditsText, endBgmTrack, scrollSeconds) {
  return new Promise(resolve => {
    if (endBgmTrack && typeof startScenarioBGM === "function") {
      startScenarioBGM(endBgmTrack); // bgm.js
    }
    
    const overlay = document.createElement("div");
    overlay.className = "endroll-overlay";
    
    const content = document.createElement("div");
    content.className = "endroll-content";
    content.textContent = creditsText || "";
    overlay.appendChild(content);
    
    const whiteout = document.createElement("div");
    whiteout.className = "endroll-whiteout";
    overlay.appendChild(whiteout);
    
    const skipBtn = document.createElement("button");
    skipBtn.className = "endroll-skip-btn";
    skipBtn.textContent = "早送り";
    overlay.appendChild(skipBtn);
    
    let finished = false;
    let speedMultiplier = 1; // ★要望対応：押すたびに 1倍→2倍→3倍→1倍 とループする
    let baseSpeedPxPerMs = 0; // 等倍(1倍速)の時の移動速度（px/ms）。実測後に確定する
    const timers = [];
    const finish = () => {
      if (finished) return;
      finished = true;
      timers.forEach(t => clearTimeout(t));
      overlay.remove();
      if (endBgmTrack && typeof fadeOutCurrentBgm === "function") fadeOutCurrentBgm(800); // bgm.js
      resolve();
    };
    
    // ★要望対応：以前は押すと即座に終了する「スキップ」だったが、演出を最後まで見せつつ、
    //   押すたびに1倍→2倍→3倍→1倍と速度が切り替わる「早送り」に変更。
    //   今スクロール中の位置を実測し、そこから新しい速度で終端まで動かし直す
    const applyPlaybackSpeed = () => {
      if (finished || !baseSpeedPxPerMs) return;
      const currentTop = parseFloat(window.getComputedStyle(content).top) || 0;
      content.style.transition = "none";
      content.style.top = currentTop + "px";
      void content.offsetHeight; // ★transitionを一旦切ってから位置を確定させるための強制リフロー
      const remainingPx = Math.abs(currentTop - endTop);
      const newDurationMs = Math.max(200, remainingPx / (baseSpeedPxPerMs * speedMultiplier));
      requestAnimationFrame(() => {
        content.style.transition = `top ${newDurationMs}ms linear`;
        content.style.top = endTop + "px";
      });
    };
    skipBtn.onclick = (event) => {
      event.stopPropagation();
      speedMultiplier = speedMultiplier >= 3 ? 1 : speedMultiplier + 1; // 1→2→3→1…
      skipBtn.textContent = speedMultiplier === 1 ? "早送り" : `早送り×${speedMultiplier}`;
      applyPlaybackSpeed();
    };
    document.body.appendChild(overlay);
    
    // ★実際の文章の高さを測ってから、「最後の行がちょうど画面の一番上に来る位置」までの距離を計算する。
    //   固定の%移動だと文章の長さによってズレるため、DOMに入れて実測してから動かす
    let endTop = 0;
    requestAnimationFrame(() => {
      const viewportHeight = overlay.clientHeight;
      const contentHeight = content.scrollHeight;
      const startTop = viewportHeight; // 画面の下からスタート（今までと同じ）
      endTop = -contentHeight; // 最後の行（＝文章の一番下）がちょうど画面上端に来る位置
      const duration = Math.max(5, scrollSeconds || 20) * 1000;
      baseSpeedPxPerMs = Math.abs(startTop - endTop) / duration;
      
      content.style.top = startTop + "px";
      // ★次のフレームでtopを変えることで、CSSのtransitionがちゃんと発火するようにする
      requestAnimationFrame(() => {
        content.style.transition = `top ${duration}ms linear`;
        content.style.top = endTop + "px";
      });
      
      content.addEventListener("transitionend", () => {
        if (finished) return;
        // ★最後の行が上に到達：静止してから、画面を白くフェードして終了する（早送り中は待ち時間を短縮）
        timers.push(setTimeout(() => {
          if (finished) return;
          whiteout.classList.add("endroll-whiteout-active");
          timers.push(setTimeout(finish, 1000)); // ★フェード（1秒）が終わったら締める
        }, speedMultiplier > 1 ? 500 : 3000));
      }, { once: true });
    });
  });
}



function waitForAdvance(myToken = activeSessionToken, allowSubFocus = false) {
  return new Promise(resolve => {
    let resolved = false;
    let fastForwardTimer = null;
    
    // 後片付けをしてロックを解除する共通の関数
    function cleanUp() {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("click", handleClick);
      if (fastForwardTimer) clearInterval(fastForwardTimer);
    }
    
    function finish() {
      if (resolved) return;
      resolved = true;
      cleanUp();
      resolve(); // ロック解除！次へ進む
    }
    
    // キーボードが押された時の処理
    const handleKeyDown = (event) => {
      if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
      if (activeSessionToken !== myToken) return; // ★ロードで新しいセッションが始まっていたら反応しない
      if (event.repeat) return; // ★押しっぱなしで連続進行しないようにする
      // ★サブ画面（インベントリ・スキル・強さ・装備等のタブ）を開いている間は、
      //   同じZ/↓/スペースキーでシナリオ本文が進んでしまわないようにする。
      //   サブ画面を閉じてメイン画面に戻っている時（controlFocus === "main"）だけ受け付ける。
      //   ただし、サブ画面での操作結果メッセージ（スキル・アイテム使用時の説明や効果）など、
      //   allowSubFocusで明示的に許可された場合はサブ画面のままでも進行できる
      if (!allowSubFocus && controlFocus !== "main") return;
      // 押されたキーが、設定した配列の中に含まれているかチェック
      if (KEY_CONFIG.advanceKeys.includes(event.key)) {
        finish();
      }
    };
    
    // マウスがクリックされた時の処理
    const handleClick = () => {
      if (activeSessionToken !== myToken) return; // ★ロードで新しいセッションが始まっていたら反応しない
      if (!allowSubFocus && controlFocus !== "main") return; // ★同上：サブ画面を開いている間はクリックでも進めない（例外はallowSubFocus）
      finish();
    };
    
    // イベント（待ち伏せ）を登録する
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("click", handleClick);
    
    // ★早送りモード中は、クリックやキー入力が無くても自動的に次へ進める
    fastForwardTimer = setInterval(() => {
      if (activeSessionToken !== myToken) return; // ★古いセッションのままなら何もせず止まる
      if (fastForwardMode) finish();
    }, 80);
  });
}

// メッセージウィンドウを完全に非表示にする関数
function hideMessageWindow() {
  messageWindow.style.display = "none"; // 画面から消す
  // ★中身も一緒に消しておかないと、次に選択肢だけの画面（行き先メニューなど）に切り替わった時に
  //   前のメッセージが裏に残ったままになり、その後うっかり再表示された時に古い文章が見えてしまう
  nameVar.textContent = "";
  textVar.innerHTML = "";
}

// メイン画面を再び表示する関数
function showMessageWindow() {
  messageWindow.style.display = "block"; // 画面に戻す
}

// 現在の背景の状態（セーブ/ロードで復元するために覚えておく）
let currentBackground = { type: "color", value: "#000000" };

// メイン画面の背景を画像にする（例: setBackgroundImage("img/村.jpeg")）
function setBackgroundImage(url) {
  currentBackground = { type: "image", value: url };
  mainScreen.style.backgroundImage = `url('${url}')`;
  mainScreen.style.backgroundSize = "cover";
  mainScreen.style.backgroundPosition = "center";
}

// メイン画面の背景を単色にする（例: setBackgroundColor("#000000")）
function setBackgroundColor(color) {
  currentBackground = { type: "color", value: color };
  mainScreen.style.backgroundImage = "none";
  mainScreen.style.backgroundColor = color;
}

// ===== 立ち絵（scenariobuild.jsの「立ち絵表示/非表示」「表情変更」「移動」「動き」ブロックから呼ばれる） =====
// ★instanceId（ブロックで指定する表示ID）ごとにDOM要素を1つ持つ。同じinstanceIdへの表示/移動/表情変更は
//   同じ要素を使い回すので、違うinstanceIdを使えば同時に何体でも表示できる
const activePortraitEls = {};

function getPortraitLayer() {
  return document.getElementById("portrait-layer");
}

// position：0〜100の数字（左端0、中央50、右端100）
function showPortrait(instanceId, imagePath, position, fadeMs) {
  const layer = getPortraitLayer();
  if (!layer || !instanceId) return;
  let el = activePortraitEls[instanceId];
  if (!el) {
    el = document.createElement("div");
    el.className = "portrait-instance";
    const img = document.createElement("img");
    el.appendChild(img);
    layer.appendChild(el);
    activePortraitEls[instanceId] = el;
  }
  el.style.transitionDuration = `${Math.max(0, fadeMs != null ? fadeMs : 300)}ms, 300ms`; // opacity, left の順
  el.style.left = `${Math.min(100, Math.max(0, position != null ? position : 50))}%`;
  const img = el.querySelector("img");
  if (img && imagePath) img.src = imagePath;
  requestAnimationFrame(() => el.classList.add("portrait-visible"));
}

function hidePortrait(instanceId, fadeMs) {
  const el = activePortraitEls[instanceId];
  if (!el) return;
  const duration = Math.max(0, fadeMs != null ? fadeMs : 300);
  el.style.transitionDuration = `${duration}ms, 300ms`;
  el.classList.remove("portrait-visible");
  setTimeout(() => {
    if (activePortraitEls[instanceId] === el) {
      el.remove();
      delete activePortraitEls[instanceId];
    }
  }, duration);
}

function hideAllPortraits(fadeMs) {
  Object.keys(activePortraitEls).forEach(id => hidePortrait(id, fadeMs));
}

function changePortraitExpression(instanceId, imagePath) {
  const el = activePortraitEls[instanceId];
  if (!el || !imagePath) return;
  const img = el.querySelector("img");
  if (img) img.src = imagePath;
}

// position：0〜100の数字。durationMsぶんかけて補間アニメーションしながら移動する
function movePortrait(instanceId, position, durationMs) {
  const el = activePortraitEls[instanceId];
  if (!el) return;
  const duration = Math.max(0, durationMs != null ? durationMs : 500);
  el.style.transitionDuration = `300ms, ${duration}ms`; // opacity, left の順
  el.style.left = `${Math.min(100, Math.max(0, position != null ? position : 50))}%`;
}

// motionType："jump"（小さくジャンプ） | "shake"（震える）
function playPortraitMotion(instanceId, motionType) {
  const el = activePortraitEls[instanceId];
  if (!el) return;
  const className = motionType === "shake" ? "portrait-motion-shake" : "portrait-motion-jump";
  el.classList.remove("portrait-motion-jump", "portrait-motion-shake");
  void el.offsetWidth; // ★同じ動きを連続で出せるよう、一度リフローを挟んで強制的にやり直させる
  el.classList.add(className);
}

// ★話の切り替わり時などに、表示中の立ち絵を全部消して次の場面をまっさらな状態から始める
function resetAllPortraits() {
  Object.values(activePortraitEls).forEach(el => el.remove());
  Object.keys(activePortraitEls).forEach(id => delete activePortraitEls[id]);
}

// セーブデータに入っている背景情報を、実際の画面に反映する
function applyBackground(bg) {
  if (!bg) return;
  if (bg.type === "image") {
    setBackgroundImage(bg.value);
  } else {
    setBackgroundColor(bg.value || "#000000");
  }
}

// ★共通ユーティリティ：指定パネル内のボタンを、上下矢印キー＋決定キー＋戻るキーで操作できるようにする
// panel: ボタンをまとめて探す親要素
// backSelector: 戻るキー（X）で押させたい「戻る」ボタンのセレクタ（無ければ戻るキーは無効）
// focusGroup: このパネルが「メイン画面(main)」「サブ画面(sub)」どちらの操作フォーカスに属するか
// autoFocusFirst: 呼び出し時に一番上のボタンへ自動でフォーカスするかどうか
function enableListKeyboardNav(panel, backSelector = null, focusGroup = "sub", autoFocusFirst = true, excludeSelector = null) {
  let buttons = Array.from(panel.querySelectorAll("button"));
  
  // ★ 除外指定があるボタン（例：クエストのランクフィルタ）は、矢印キーでの上下移動の対象から外す
  if (excludeSelector) {
    buttons = buttons.filter(btn => !btn.matches(excludeSelector));
  }
  
  if (buttons.length === 0) return;
  
  // ★ disabled（受注できない依頼のボタンなど）には.focus()しても実際にはフォーカスが移らず、
  //   その場で固まってしまうので、無効なボタンは飛ばして次/前の有効なボタンを探す
  const findEnabled = (startIndex, direction) => {
    let idx = startIndex + direction;
    while (idx >= 0 && idx < buttons.length) {
      if (!buttons[idx].disabled) return buttons[idx];
      idx += direction;
    }
    return null;
  };
  
  buttons.forEach((btn, i) => {
    btn.onkeydown = (event) => {
      if (controlFocus !== focusGroup) return;
      if (event.repeat) return;
      
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        const next = findEnabled(i, 1);
        if (next) next.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const prev = findEnabled(i, -1);
        if (prev) prev.focus();
      } else if (KEY_CONFIG.decideKeys.includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        btn.click();
      } else if (KEY_CONFIG.cancelKeys.includes(event.key) && backSelector) {
        event.preventDefault();
        event.stopPropagation();
        const backBtn = panel.querySelector(backSelector);
        if (backBtn) backBtn.click();
      }
    };
  });
  
  // ★ 一覧の再描画でボタンが作り直された時、フォーカスが外れて<body>に落ちると
  //   それ以降どのボタンも矢印キーを受け取れなくなる。
  //   フォーカスが今このパネルの外にある時だけ、「選択中」のものがあればそこへ、
  //   無ければ先頭（無効なら次の有効なもの）に戻す。
  const focusFallback = () => {
    const selected = panel.querySelector(".selected");
    if (selected && !selected.disabled && buttons.includes(selected)) return selected;
    return buttons[0].disabled ? findEnabled(0, 1) : buttons[0];
  };
  
  if (autoFocusFirst) {
    const target = focusFallback();
    if (target) target.focus();
  } else if (!panel.contains(document.activeElement)) {
    const target = focusFallback();
    if (target) target.focus();
  }
}

// 行き先メニュー（町の中で行ける場所のボタン一覧）を表示する
// locations: [{ label: "酒場", action: () => {...} }, ...] という形の配列
// 今表示中の行き先メニューの中身（{label, action}の配列）とタイトル、カーソル位置
// ★DOMフォーカスではなくこの状態で管理することで、サブ画面を操作した後に戻ってきても
//   カーソル（と矢印キー操作）が失われないようにする
let currentLocationMenuList = [];
let currentLocationMenuTitle = "";
let locationMenuCursorIndex = 0;

function showLocationMenu(locations, title = "") {
  currentLocationMenuList = locations;
  currentLocationMenuTitle = title;
  locationMenuCursorIndex = 0;
  renderLocationMenu();
  hideMessageWindow(); // メニュー表示中はテキストウィンドウを隠しておく
}

// ★選択肢が5つ以上ある時だけ、2列（左右キーで列移動、上下キーで選択）に切り替える。
//   4つ以下ならこれまで通り縦一列のまま
function getLocationMenuColumns() {
  return currentLocationMenuList.length >= 5 ? 2 : 1;
}

function renderLocationMenu() {
  const menu = document.getElementById("location-menu");
  if (!menu) return;
  
  menu.innerHTML = "";
  
  if (currentLocationMenuTitle) {
    const titleEl = document.createElement("p");
    titleEl.className = "location-menu-title";
    titleEl.textContent = currentLocationMenuTitle;
    menu.appendChild(titleEl);
  }
  
  const columns = getLocationMenuColumns();
  const listWrap = document.createElement("div");
  listWrap.className = columns === 2 ? "location-btn-grid" : "location-btn-list";
  
  currentLocationMenuList.forEach((loc, i) => {
    const btn = document.createElement("button");
    btn.className = "location-btn" + (i === locationMenuCursorIndex ? " cursor" : "");
    btn.textContent = loc.label;
    
    // ★このボタンを押している間は、テキスト送りなど他の反応を起こさせない
    // ★選択肢（choice-box、魔法少女のマジカル変身などで使用中）が表示されている間は、行き先メニューを反応させない
    //   （メイン画面の選択肢と行き先メニューが同時に動いてしまう「混合」バグを防ぐ）
    btn.onclick = (event) => {
      event.stopPropagation();
      if (currentChoiceList.length > 0) return;
      // ★サブ画面（インベントリ・スキルタブ等）を操作中でも、行き先メニューのボタンは
      //   マウスなら常にクリックできてしまう。そのままだとcontrolFocusが"sub"のまま
      //   action()が走り、そこから出るメッセージ（友好な魔物のサポートイベント等）が
      //   allowSubFocus無しのdisplayMessageだとwaitForAdvanceに弾かれて進められなくなる。
      //   行き先メニューの選択が実行される時点で、必ずメイン画面操作扱いに揃えておく
      controlFocus = "main";
      updateControlFocusIndicator();
      locationMenuCursorIndex = i;
      loc.action();
    };
    
    listWrap.appendChild(btn);
  });
  
  menu.appendChild(listWrap);
  menu.classList.remove("hidden");
}

// ★矢印キーでカーソル移動・決定キーで選択・戻るキーで「戻る」を選ぶ
//   DOMフォーカスを一切使わないので、サブ画面を操作した後にメイン画面へ戻ってきてもそのまま動く
window.addEventListener("keydown", (event) => {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  if (controlFocus !== "main") return;
  if (isGameDialogOpen) return; // ★確認ダイアログが開いている間は、そちら優先で反応しない
  if (event.repeat) return;
  // ★メッセージを表示・入力待ちしている間は、行き先メニュー側に反応させない。
  //   ここで弾かないと、メッセージ送りのキーを行き先メニューの決定として奪ってしまい、
  //   意図しない行動を引き起こす
  if (isTextDisplaying) return;
  
  const menu = document.getElementById("location-menu");
  if (!menu || menu.classList.contains("hidden")) return;
  if (currentLocationMenuList.length === 0) return;
  // ★選択肢（choice-box）が表示されている間は、行き先メニュー側は反応しない。
  //   常にどちらか一方だけが矢印キー・決定キーに反応するようにして「混合」を防ぐ
  if (currentChoiceList.length > 0) return;
  
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    event.stopImmediatePropagation();
    const columns = getLocationMenuColumns();
    const count = currentLocationMenuList.length;
    const row = Math.floor(locationMenuCursorIndex / columns);
    const col = locationMenuCursorIndex % columns;
    const rows = Math.ceil(count / columns);
    let newRow = row + (event.key === "ArrowDown" ? 1 : -1);
    newRow = Math.max(0, Math.min(rows - 1, newRow));
    let newIndex = newRow * columns + col;
    if (newIndex >= count) newIndex = count - 1; // ★最終行で列数が足りない場合は、存在する一番近いボタンへ
    locationMenuCursorIndex = newIndex;
    renderLocationMenu();
    
  } else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && getLocationMenuColumns() === 2) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const count = currentLocationMenuList.length;
    const row = Math.floor(locationMenuCursorIndex / 2);
    const col = locationMenuCursorIndex % 2;
    const newCol = event.key === "ArrowRight" ? 1 : 0;
    const candidate = row * 2 + newCol;
    if (candidate < count) locationMenuCursorIndex = candidate; // ★その列にボタンが無い（最終行が1個だけ等）場合は移動しない
    renderLocationMenu();
    
  } else if (KEY_CONFIG.decideKeys.includes(event.key)) {
    event.preventDefault();
    // ★ stopImmediatePropagation() が無いと、この決定キー1回分のイベントが
    //   同じフレーム内でクエスト掲示板など「今まさに開いたばかりのUI」の
    //   キー操作リスナーにも渡ってしまい、開いた瞬間に依頼を勝手に受注してしまうバグの原因になっていた
    event.stopImmediatePropagation();
    currentLocationMenuList[locationMenuCursorIndex].action();
    
  } else if (KEY_CONFIG.cancelKeys.includes(event.key)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const backEntry = currentLocationMenuList.find(loc => loc.label.includes("戻る"));
    if (backEntry) backEntry.action();
  }
});

// 行き先メニューを閉じて、メッセージウィンドウ表示に戻す
function hideLocationMenu() {
  const menu = document.getElementById("location-menu");
  if (menu) menu.classList.add("hidden");
  showMessageWindow();
}

// ★スキルタブ・装備タブ・インベントリタブからメッセージ/選択肢を出す処理をこれで包む。
//   行き先メニュー（自由行動中に画面下に出る「どこそこへ行く」ボタン一覧）が表示されていると
//   メッセージウィンドウは隠れている（showLocationMenu()が隠す仕様）ため、
//   そのままではサブ画面から出したメッセージや選択肢が画面上どこにも表示されず、
//   「装備を変えられない」「選択肢が出てこない」ように見えてしまっていた。
//   ここで一時的に行き先メニューを閉じてメッセージを見せ、終わったら元の状態に戻す
async function runWithLocationMenuHidden(action) {
  const menu = document.getElementById("location-menu");
  const wasLocationMenuVisible = !!menu && !menu.classList.contains("hidden");
  if (wasLocationMenuVisible) hideLocationMenu();
  try {
    await action();
  } finally {
    if (wasLocationMenuVisible) showLocationMenu(currentLocationMenuList, currentLocationMenuTitle);
  }
}

function changeSpeaker(name) {
  nameVar.textContent = name;
  
}

// ★第2引数に { allowSubFocus: true } を渡すと、サブ画面（インベントリ・スキルタブ等）を
//   開いたままでもこのメッセージだけは読み進められる（スキル・アイテム使用時の結果メッセージ等の例外用）
async function displayMessage(text, options = {}) {
  const allowSubFocus = !!options.allowSubFocus;
  isTextDisplaying = true;
  const myToken = activeSessionToken;
  
  // ★ログに残す（誰が喋ったかは今表示されている名前欄から取る）
  logMessage(nameVar.textContent, text);
  
  // ★ログ再生中（セーブ地点まで一気に追いつかせている間）は、演出・入力待ちを省略する
  if (isReplayingLog && messageLog.length < replayTargetStep) {
    textVar.innerHTML = convertLineBreaksForDisplay(text); // ★文中の改行(\n)をゲーム画面でも改行として反映させる
    isTextDisplaying = false;
    return;
  }
  if (isReplayingLog) {
    isReplayingLog = false; // ちょうど追いついたので、これ以降は通常表示に戻す
  }
  
  const previousAllowSubFocus = currentMessageAllowsSubFocus;
  currentMessageAllowsSubFocus = allowSubFocus;
  
  // 古い 1文字ずつ足す処理を削除し、タグ対応の typeText を呼び出す
  await typeText(textVar, text, myToken);
  
  // 読み終わったらクリック・キー入力を待つ
  await waitForAdvance(myToken, allowSubFocus);
  
  currentMessageAllowsSubFocus = previousAllowSubFocus;
  isTextDisplaying = false;
}

// ==== シナリオ・戦闘の選択肢（choice-box） ====
// ★以前はDOMフォーカス(.focus())に頼っていたが、サブ画面のタブを操作した後などに
//   フォーカスが失われて矢印キーが効かなくなる不具合があったため、
//   行き先メニューと同じ「JS側でカーソル位置を管理する」方式に統一した。
let currentChoiceList = [];
let choiceCursorIndex = 0;
let choiceResolveFn = null;
let choiceSessionToken = 0;
// ★この選択肢がどちらの画面向けか（表示を出した時点のcontrolFocusを記録）。
//   シナリオ中の選択肢は"main"、スキルタブの「マジカル変身」など、サブ画面の操作から
//   出た選択肢は"sub"になる。矢印キー・決定キーは、このフォーカスの時だけ反応させる
//   （でないと、サブ画面の操作から出した選択肢がメイン画面フォーカスでないと選べなかったり、
//   逆にメイン画面の選択肢中にサブ画面のタブ操作を誤って受け付けてしまったりする）
let currentChoiceListFocus = "main";
// ★displayChoicesに{ allowSubFocus: true }を渡した時だけtrueになる。
//   trueの間は、非tab-mainのサブタブ（インベントリ・スキル等）を見ていても、choice-boxを
//   メイン画面側へ強制移動・ロックせず、その場（サブ画面の下部）で操作できるようにする。
//   以前はこれが無く、サブ画面のタブから回復技を使うと選択肢がロックされ、
//   わざわざtab-mainに切り替えないと選べない問題があった
let choiceBoxAllowSubFocus = false;
let choiceBoxDisableArrowPaging = false; // ★戦闘の敵選択など、←→キーを他の用途（ターゲットカーソル移動）に使いたい時はtrueにする
// ★1ページに表示する選択肢の数。これを超えたらページ送りにする。
//   ★スマホの縦画面（CSSの@media (max-aspect-ratio: 4/5)と同じ判定条件）だけは、
//     ボタンが画面を圧迫しないよう1ページ3個までにする
function getChoicesPerPage() {
  return (typeof window.matchMedia === "function" && window.matchMedia("(max-aspect-ratio: 4/5)").matches) ? 3 : 4;
}

// ★選択肢に choice.description を持たせておくと、フォーカスが乗っている間だけ
//   メッセージウィンドウにその説明を表示する（バトル中のスキル選択などで使う）。
//   選択が終わったら、選択肢を出す前にメッセージウィンドウへ表示していた内容へ戻す
let choiceListDescriptionsActive = false;
let messageTextBeforeChoiceDescriptions = "";

function updateChoiceFocusDescription() {
  if (!choiceListDescriptionsActive) return;
  const choice = currentChoiceList[choiceCursorIndex];
  textVar.innerHTML = (choice && choice.description) ? choice.description : messageTextBeforeChoiceDescriptions;
}

function renderChoiceBox() {
  choiceBox.innerHTML = "";
  
  const totalPages = Math.max(1, Math.ceil(currentChoiceList.length / getChoicesPerPage()));
  const currentPage = Math.floor(choiceCursorIndex / getChoicesPerPage());
  const pageStart = currentPage * getChoicesPerPage();
  const pageEnd = Math.min(currentChoiceList.length, pageStart + getChoicesPerPage());
  
  for (let i = pageStart; i < pageEnd; i++) {
    const choice = currentChoiceList[i];
    const button = document.createElement("button");
    // ★choice.loops が付いている選択肢は「選んでも話が先に進まず、同じ場面に戻ってくる」ことが
    //   ひと目で分かるよう、アイコンを付けて見た目を変える（シナリオ中の寄り道選択肢などに使う）
    // ★設定で「正解の選択肢を表示」がONの時だけ、★（正解）・↻（ループ）どちらのヒントも表示する。
    //   ループの方だけ表示すると、正解でない側にだけ↻が付くケースなどで、消去法で正解がバレてしまうため、
    //   両方まとめて同じ設定でON/OFFする
    const showHints = typeof gameSettings !== "undefined" && gameSettings.showCorrectChoice;
    const showHint = showHints && choice.isCorrect;
    let label = choice.text;
    if (choice.loops && showHints) label = `↻ ${label}`;
    if (showHint) label = `★ ${label}`;
    button.textContent = label;
    button.className = (i === choiceCursorIndex ? "cursor" : "")
      + (choice.loops && showHints ? " choice-loop" : "")
      + (showHint ? " choice-correct-hint" : "");
    
    // ★このクリックが他の反応（テキスト送りなど）に伝わらないようにする
    button.onclick = (event) => {
      event.stopPropagation();
      choiceCursorIndex = i;
      finishChoice(choice);
    };
    
    // ★マウスホバー中だけ、その選択肢の説明をメッセージウィンドウにプレビュー表示する（choice.descriptionがある時のみ）
    if (choice.description) {
      button.onmouseenter = () => {
        if (choiceListDescriptionsActive) textVar.innerHTML = choice.description;
      };
      button.onmouseleave = () => {
        updateChoiceFocusDescription();
      };
    }
    
    choiceBox.appendChild(button);
  }
  
  // ★選択肢が5個以上あってページが複数ある時だけ、ページ送りのボタンを出す（タップでも切り替えられるように）
  if (totalPages > 1) {
    const pagerEl = document.createElement("div");
    pagerEl.className = "choice-pager";
    
    const prevBtn = document.createElement("button");
    prevBtn.className = "choice-pager-btn";
    prevBtn.textContent = "◀ 前へ（Q）";
    prevBtn.onclick = (event) => {
      event.stopPropagation();
      turnChoicePage(-1);
    };
    
    const pageLabel = document.createElement("span");
    pageLabel.className = "choice-pager-label";
    pageLabel.textContent = `${currentPage + 1} / ${totalPages}`;
    
    const nextBtn = document.createElement("button");
    nextBtn.className = "choice-pager-btn";
    nextBtn.textContent = "次へ（E） ▶";
    nextBtn.onclick = (event) => {
      event.stopPropagation();
      turnChoicePage(1);
    };
    
    pagerEl.appendChild(prevBtn);
    pagerEl.appendChild(pageLabel);
    pagerEl.appendChild(nextBtn);
    choiceBox.appendChild(pagerEl);
  }
  
  updateChoiceFocusDescription(); // ★カーソルが乗っている選択肢の説明を（あれば）メッセージウィンドウに反映する
}

// ★ページ送り（Q/E）。カーソルは移動先のページの先頭に合わせる
function turnChoicePage(direction) {
  const totalPages = Math.max(1, Math.ceil(currentChoiceList.length / getChoicesPerPage()));
  if (totalPages <= 1) return;
  const currentPage = Math.floor(choiceCursorIndex / getChoicesPerPage());
  const nextPage = (currentPage + direction + totalPages) % totalPages;
  choiceCursorIndex = Math.min(currentChoiceList.length - 1, nextPage * getChoicesPerPage());
  renderChoiceBox();
}

// ★選択肢（choice-box）を「選ばれた事」にはせず、プログラム側の都合で静かに閉じる。
//   例：戦闘の敵選択で、タップ／矢印キー側から先に対象が決まった時、並行して出していた
//   選択肢の方はログに残さず片付けたい場合に使う
function forceCloseChoiceBoxSilently() {
  if (!choiceResolveFn) return;
  choiceResolveFn = null;
  currentChoiceList = [];
  choiceBoxAllowSubFocus = false;
  choiceBoxDisableArrowPaging = false;
  if (choiceListDescriptionsActive) {
    textVar.innerHTML = messageTextBeforeChoiceDescriptions;
    choiceListDescriptionsActive = false;
  }
  if (choiceBox) choiceBox.innerHTML = "";
}

function finishChoice(choice) {
  if (!choiceResolveFn) return;
  if (activeSessionToken !== choiceSessionToken) return; // ★ロードで新しいセッションが始まっていたら反応しない
  
  const resolveFn = choiceResolveFn;
  choiceResolveFn = null;
  currentChoiceList = [];
  choiceBoxAllowSubFocus = false; // ★次に別の（オプション指定の無い）選択肢が出た時に、誤って引き継がれないようにする
  choiceBoxDisableArrowPaging = false;
  
  // ★説明プレビューを使っていた場合、選択肢を出す前の文章に戻しておく
  if (choiceListDescriptionsActive) {
    textVar.innerHTML = messageTextBeforeChoiceDescriptions;
    choiceListDescriptionsActive = false;
  }
  
  logChoice(choice.text); // ★選んだ選択肢をログに残す
  choiceBox.innerHTML = ""; // 大掃除
  resolveFn(choice); // ★ 選ばれた選択肢オブジェクトをそのまま返す（呼び出し側でchoice.nextなどを見て分岐できる）
}

// choices: 選択肢の配列
// initialIndex: 表示した時点でカーソルを乗せておく位置（省略時は先頭=0）。
//   例：職業選択の確認で「いいえ」側にカーソルを置いておきたい時などに使う
function displayChoices(choices, initialIndex = 0, options = {}) {
  // ★ Promise を返して、resolve() が呼ばれるまで処理をここで止める！
  return new Promise(resolve => {
    const myToken = activeSessionToken;
    
    // ★ログ再生中：あの時選んだ選択肢と同じものを自動で選ぶ
    if (isReplayingLog && messageLog.length < replayTargetStep) {
      const expectedText = replayChoiceQueue.shift();
      const matched = choices.find(c => c.text === expectedText) || choices[0];
      logChoice(matched.text);
      if (messageLog.length >= replayTargetStep) {
        isReplayingLog = false;
      }
      resolve(matched);
      return;
    }
    if (isReplayingLog) {
      isReplayingLog = false;
    }
    
    currentChoiceList = choices;
    choiceCursorIndex = Math.max(0, Math.min(choices.length - 1, initialIndex));
    choiceSessionToken = myToken;
    choiceResolveFn = resolve;
    currentChoiceListFocus = controlFocus; // ★呼び出された時点のフォーカス側でだけ選べるようにする
    choiceBoxAllowSubFocus = !!options.allowSubFocus;
    choiceBoxDisableArrowPaging = !!options.disableArrowPaging;
    
    // ★選択肢のどれかにdescriptionが付いていたら、選択が終わるまでメッセージウィンドウを
    //   「フォーカス中の説明プレビュー」に使う。終わったら元の文章に戻す（finishChoice側で処理）
    choiceListDescriptionsActive = choices.some(c => c.description);
    if (choiceListDescriptionsActive) {
      messageTextBeforeChoiceDescriptions = textVar.innerHTML;
    }
    
    renderChoiceBox();
    relocateChoiceBoxForActiveTab(); // ★今アクティブなタブに応じて、choice-boxの置き場所・押せる/押せないを合わせる
  });
}

// ★choice-box を、今アクティブなサブ画面タブに応じて適切な場所へ移動する。
//   メインタブを見ている時、またはallowSubFocus指定時：サブ画面側の通常位置（一番下）に置き、押せるようにする。
//   それ以外のタブ（インベントリ等）を見ている時：見やすいようメイン画面側のスロットに移動し、
//   誤操作防止のため押せなくする（switchTab側からも呼ばれる）
function relocateChoiceBoxForActiveTab() {
  const mainSlot = document.getElementById("choice-box-main-slot");
  const subScreen = document.querySelector(".sub-screen");
  const tabMainEl = document.getElementById("tab-main");
  if (!mainSlot || !subScreen || !tabMainEl) return;
  
  const isMainTabActive = tabMainEl.classList.contains("active");
  
  if (isMainTabActive || choiceBoxAllowSubFocus) {
    if (choiceBox.parentElement !== subScreen) subScreen.appendChild(choiceBox);
    choiceBox.classList.remove("choice-box-locked");
  } else {
    if (choiceBox.parentElement !== mainSlot) mainSlot.appendChild(choiceBox);
    choiceBox.classList.add("choice-box-locked");
  }
}

// ★矢印キーでカーソル移動・決定キーで選択。DOMフォーカスを一切使わないので、
//   サブ画面のタブを操作した後でもメイン画面へ戻ってきたら確実に矢印キーで選べる
window.addEventListener("keydown", (event) => {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  if (controlFocus !== currentChoiceListFocus) return; // ★選択肢を出した側の画面フォーカスの時だけ反応する
  if (isGameDialogOpen) return; // ★確認ダイアログが開いている間は、そちら優先で反応しない
  if (event.repeat) return;
  if (isTextDisplaying) return; // ★メッセージ表示・入力待ち中は、選択肢側もキーを奪わない
  if (currentChoiceList.length === 0) return;
  if (choiceBox.classList.contains("choice-box-locked")) return; // ★メインタブ以外を見ている間は、キー操作でも選べないようにする
  
  if (event.key === "ArrowDown") {
    event.preventDefault();
    // ★これが無いと、同じキー入力が裏でスキルタブのカーソル移動など、
    //   他のリストにも同時に伝わって一緒に動いてしまっていた
    event.stopImmediatePropagation();
    choiceCursorIndex = Math.min(currentChoiceList.length - 1, choiceCursorIndex + 1);
    renderChoiceBox();
    
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    event.stopImmediatePropagation();
    choiceCursorIndex = Math.max(0, choiceCursorIndex - 1);
    renderChoiceBox();
    
  } else if (KEY_CONFIG.decideKeys.includes(event.key)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    finishChoice(currentChoiceList[choiceCursorIndex]);
    
  } else if (!choiceBoxDisableArrowPaging && (KEY_CONFIG.tabLeftKey.includes(event.key) || event.key === "ArrowLeft")) {
    event.preventDefault();
    event.stopImmediatePropagation(); // ★裏でサブ画面のタブ送りが同時に反応しないようにする
    turnChoicePage(-1);
    
  } else if (!choiceBoxDisableArrowPaging && (KEY_CONFIG.tabRightKey.includes(event.key) || event.key === "ArrowRight")) {
    event.preventDefault();
    event.stopImmediatePropagation();
    turnChoicePage(1);
    
  } else if (KEY_CONFIG.cancelKeys.includes(event.key)) {
    // ★店・宿屋・戦闘のサブメニューなど、choice-box（displayChoices）で出している
    //   「戻る」「やめる」に対応する選択肢がある画面だけ、Xキーでもワンタッチで戻れるようにする。
    //   対象の選択肢には呼び出し側で isBack: true を付けておく約束（例: { text: "戻る", next: "back", isBack: true }）。
    //   isBack が無い選択肢一覧（職業選択など、後戻りさせたくない場面）では何も起きない
    const backChoice = currentChoiceList.find(c => c.isBack);
    if (backChoice) {
      event.preventDefault();
      event.stopImmediatePropagation();
      finishChoice(backChoice);
    }
  }
});

// ① タブを直接切り替える関数（クリック用）
// ★装備の基本ステータスに、拾った時の個体差（statBonus）を足した「表示用の合計値」を返す。
//   実際の戦闘で使われる値（player.js の getEquippedEffectiveParamFor）と同じく、最低1を保証する
//   （そうしないと、一覧では「-3」のようにマイナス表示になってしまうのに、戦闘では1として扱われて食い違う）
function getDisplayEquipmentStatTotal(baseValue, bonusAmount) {
  return Math.max(1, (baseValue || 0) + (bonusAmount || 0));
}

// ★設定「メインタブのパラメータ表示」に応じて、主人公・仲間のパラメータ本体（#status-hud-wrapper）を
//   置き場所ごと移動する。ON＝メインタブ内（#main-tab-params-slot）、OFF（デフォルト）＝常時左上
//   （#mini-status-hud）。DOM要素そのものを移動するので、idの重複が起きず、更新処理（renderStatusHUD）も
//   1箇所のままでよい
function applyMainTabParamsDisplayMode() {
  const wrapper = document.getElementById("status-hud-wrapper");
  const mainTabSlot = document.getElementById("main-tab-params-slot");
  const miniHud = document.getElementById("mini-status-hud");
  if (!wrapper || !mainTabSlot || !miniHud) return;
  
  if (typeof gameSettings !== "undefined" && gameSettings.showMainTabParams) {
    mainTabSlot.appendChild(wrapper);
    mainTabSlot.classList.remove("hidden");
  } else {
    miniHud.appendChild(wrapper);
    mainTabSlot.classList.add("hidden");
  }
  wrapper.classList.remove("hidden"); // ★初期状態の「移動前のちらつき防止」用hiddenを、正しい場所に置いた後に解除する
  // ★どちらの置き場所でも、今アクティブなタブに応じて表示/非表示を再計算する
  const activeTab = document.querySelector(".tab-content.active");
  if (activeTab) updateMiniStatusHudVisibility(activeTab.id);
}

// ★常時左上のステータス（mini-status-hud）を表示すべきかどうかを判定する。
//   設定がONの時：メインタブを開いている間だけ隠す（メインタブ内に表示されているので二重にならないように）
//   設定がOFF（デフォルト）の時：メインタブでも常に表示する（要望対応：メインタブにはパラメータを出さない代わりに、
//   常時左上に表示し続ける）
function updateMiniStatusHudVisibility(tabId) {
  const miniHud = document.getElementById("mini-status-hud");
  if (!miniHud) return;
  const showMainTabParams = typeof gameSettings !== "undefined" && gameSettings.showMainTabParams;
  const hidden = showMainTabParams && tabId === "tab-main";
  miniHud.classList.toggle("hidden", hidden);
}

function switchTab(tabId) {
  const contents = document.querySelectorAll('.tab-content');
  const buttons = document.querySelectorAll('.tab-btn');
  
  // 1. すべてのタブコンテンツとボタンから「active」クラスを一旦すべて外す
  contents.forEach(content => content.classList.remove('active'));
  buttons.forEach(btn => btn.classList.remove('active'));
  
  // 2. 指定されたIDのタブコンテンツをアクティブにする（表示する）
  const targetContent = document.getElementById(tabId);
  if (targetContent) {
    targetContent.classList.add('active');
  }
  
  // インベントリタブに切り替えたら、グリッドを最新の中身で描画し直す
  if (tabId === 'tab-inventory') {
    renderInventory();
  }
  
  // スキルタブに切り替えたら、職業の固有スキル一覧を描画し直す
  if (tabId === 'tab-skill') {
    skillCursorIndex = 0;
    renderSkills();
  }
  
  // 仲間タブに切り替えたら、パーティーの仲間一覧を描画し直す
  if (tabId === 'tab-companions') {
    companionCursorIndex = 0;
    renderCompanionsTab();
  }
  
  // 強さタブに切り替えたら、ステータス一覧を描画し直す
  if (tabId === 'tab-strength') {
    renderStrengthTab();
  }
  
  // 装備タブに切り替えたら、カーソルをリセットして描画し直す
  if (tabId === 'tab-equipment') {
    equipmentFocusRegion = "slots";
    equipmentSlotCursorIndex = 0;
    equipmentItemCursorIndex = 0;
    renderEquipmentTab();
  }
  
  // 便利タブに切り替えたら、アイコン一覧の画面に戻す（セーブ/ロード画面を開いたままにしない）
  if (tabId === 'tab-convenience') {
    renderConvenienceIcons();
  }
  
  // ログタブに切り替えたら、これまでの会話・選択肢の履歴を描画し直す
  if (tabId === 'tab-log') {
    renderLogTab();
  }
  
  // 設定タブに切り替えたら、カーソルをリセットして描画し直す
  if (tabId === 'tab-setting') {
    // ★バグ修正：オートセーブ一覧パネルを開いたまま他のタブへ切り替えて設定タブに戻ってくると、
    //   パネルが開きっぱなしのまま設定一覧の上に残ってしまうことがあったので、念のためここで閉じておく
    const autoSavePanel = document.getElementById("autosave-panel");
    if (autoSavePanel && !autoSavePanel.classList.contains("hidden")) {
      autoSavePanel.classList.add("hidden");
      const settingsList = document.getElementById("settings-list-container");
      if (settingsList) settingsList.classList.remove("hidden"); // ★バグ修正：隠していた設定一覧を、閉じる時に必ず元に戻す
      window.removeEventListener("keydown", handleAutoSaveKeyDown); // convenience.js
    }
    settingsCursorIndex = 0;
    renderSettingsTab();
  }
  
  // ★常時左上のステータス（設定OFFなら常に、ONならメインタブ以外の時だけ）の表示/非表示を更新する
  updateMiniStatusHudVisibility(tabId);
  if (tabId !== "tab-main" || (typeof gameSettings !== "undefined" && !gameSettings.showMainTabParams)) {
    renderStatusHUD(); // ★切り替えた瞬間の値で最新化しておく
  }
  
  // ★選択肢が出ている最中にタブを切り替えた時のために、置き場所と押せる/押せないを合わせ直す
  relocateChoiceBoxForActiveTab();
  
  // 3. クリック（または選択）されたボタンに「active」クラスをつけて光らせる
  // ボタンの onclick 属性に「tabId（例: tab-main）」が含まれているものを探して合致させます
  buttons.forEach(btn => {
    const onClickAttr = btn.getAttribute('onclick') || '';
    if (onClickAttr.includes(tabId)) {
      btn.classList.add('active');
    }
  });
}

// ② Qキー / Eキーでタブを左右に切り替える（キーボード用）
window.addEventListener("keydown", (event) => {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  if (controlFocus !== "sub") return; // ★サブ画面を操作している時だけ、タブ切り替えを有効にする
  
  const tabIds = ["tab-main", "tab-inventory", "tab-skill", "tab-companions", "tab-strength", "tab-equipment", "tab-convenience", "tab-log", "tab-setting"];
  
  // 現在アクティブになっているタブのIDを探す
  const currentActive = document.querySelector('.tab-content.active');
  if (!currentActive) return;
  
  let currentIndex = tabIds.indexOf(currentActive.id);
  
  // KEY_CONFIG に設定したキーが含まれているかで判定する
  if (KEY_CONFIG.tabLeftKey.includes(event.key)) {
    // 【左へ】
    currentIndex = (currentIndex - 1 + tabIds.length) % tabIds.length;
    switchTab(tabIds[currentIndex]);
  } else if (KEY_CONFIG.tabRightKey.includes(event.key)) {
    // 【右へ】
    currentIndex = (currentIndex + 1) % tabIds.length;
    switchTab(tabIds[currentIndex]);
  }
});


// ③ インベントリタブが開いていて、かつ選択肢が表示されていない時だけ、
//    矢印キーでカーソル移動・Zで決定・Xで戻る、を有効にする
window.addEventListener("keydown", (event) => {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  if (controlFocus !== "sub") return; // ★サブ画面操作中のみ有効にする
  if (event.repeat) return; // ★押しっぱなしで連続移動・連続決定しないようにする
  
  const activeTab = document.querySelector('.tab-content.active');
  const isInventoryTabActive = activeTab && activeTab.id === 'tab-inventory';
  const choicesAreVisible = choiceBox.children.length > 0;
  
  if (!isInventoryTabActive || choicesAreVisible) return;
  
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    event.stopImmediatePropagation(); // シナリオの文章送り(↓)などに割り込まれないようにする
    moveInventorySelection(event.key);
    return;
  }
  
  if (KEY_CONFIG.cancelKeys.includes(event.key)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    cancelInventorySelection();
    return;
  }
  
  if (KEY_CONFIG.decideKeys.includes(event.key)) {
    // ★ シナリオのテキストが表示中（進行待ち含む）の時は、アイテム詳細を開かず
    //   Zキーを素通りさせて、そちらのメッセージ送りを優先させる
    if (isTextDisplaying) return;
    
    event.preventDefault();
    event.stopImmediatePropagation();
    decideInventorySelection();
  }
});

// ④ サブ画面フォーカス中、スキル/強さ/ログのような一覧タブでは矢印キーでスクロールできるようにする
const SCROLL_TAB_TARGETS = {
  // ★スキルタブは専用のカーソル移動（skillCursorIndex）があるので、ここには含めない
  "tab-strength": "strength-list",
  "tab-log": "log-list"
};

window.addEventListener("keydown", (event) => {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  if (controlFocus !== "sub") return;
  if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
  
  const activeTab = document.querySelector('.tab-content.active');
  if (!activeTab || !SCROLL_TAB_TARGETS[activeTab.id]) return;
  
  const target = document.getElementById(SCROLL_TAB_TARGETS[activeTab.id]);
  if (!target) return;
  
  event.preventDefault();
  target.scrollBy({ top: event.key === "ArrowDown" ? 40 : -40, behavior: "smooth" });
});


// 演出画面を表示する関数
async function showSpecialScene(text) {
  return new Promise(async (resolve) => {
    isTextDisplaying = true;
    const myToken = activeSessionToken;
    
    // ★ログ再生中は演出をまるごとスキップする（ステップ数には数えない特殊演出のため）
    if (isReplayingLog && messageLog.length < replayTargetStep) {
      isTextDisplaying = false;
      resolve();
      return;
    }
    
    // 1. 演出画面を表示する
    specialOverlay.classList.remove('hidden');
    
    // 💡アニメーションを滑らかに動かすためのおまじない（1ミリ秒だけ待つ）
    await wait(10);
    
    // 2. 演出用の文字を1文字ずつ表示する
    await typeText(specialText, text, myToken);
    
    // 3. 決定キー（またはクリック）を待つ
    await waitForAdvance(myToken);
    
    // 4. キーが押されたら、文字を消して演出画面を隠す
    specialText.textContent = "";
    specialOverlay.classList.add('hidden');
    
    isTextDisplaying = false;
    
    // 5. 演出が完了したので、シナリオを次に進める
    resolve();
  });
}

// メイン画面左上のステータスHUD（レベル・経過日数・ゲージ・所持金）を今のplayerの中身で更新する
function renderStatusHUD() {
  if (!player) return;
  
  // ★パラメータ表示ブロック（#status-hud-wrapper）が、設定通りの場所（メインタブ内 or 常時左上）に
  //   ちゃんと置かれているか、呼ばれるたびに軽く確認しておく（既に正しい場所ならappendChildしても
  //   実質何も起きないので、毎回呼んでも問題ない）
  applyMainTabParamsDisplayMode();
  
  const levelEl = document.getElementById("player-level");
  const daysEl = document.getElementById("days-since-transfer");
  const timeEl = document.getElementById("game-time");
  if (levelEl) levelEl.textContent = `Lv.${player.level}`;
  if (daysEl) daysEl.textContent = `転移後 ${player.daysSinceTransfer}日`;
  if (timeEl) {
    // ★30分単位の時間経過（冒険の「一手」など）にも対応できるよう、時＋分で表示する
    const hourValue = typeof player.gameHour === "number" ? player.gameHour : 8;
    const wholeHour = Math.floor(hourValue);
    const minutes = Math.round((hourValue - wholeHour) * 60);
    timeEl.textContent = minutes === 0 ? `${wholeHour}時` : `${wholeHour}時${minutes}分`;
  }
  
  // 経験値ゲージ（addExpの昇格式に合わせて、次のレベルまでの必要量は「レベル×100」）
  const expToNextLevel = expNeededForLevel(player.level);
  updateGaugeFill("exp-fill", { current: player.exp, max: expToNextLevel });
  updateGaugeValue("exp-value", player.exp, expToNextLevel);
  
  updateGaugeFill("hp-fill", player.gauges.hp);
  updateGaugeValue("hp-value", player.gauges.hp.current, player.gauges.hp.max);
  // ★状態異常バッジ：かかっている状態異常が複数あれば「毒／スタン」のように並べて表示する
  const poisonBadge = document.getElementById("poison-badge");
  if (poisonBadge) {
    const activeKinds = (player.statusAilments ? Object.keys(player.statusAilments) : [])
      .filter(k => player.statusAilments[k] && player.statusAilments[k].turns > 0);
    if (activeKinds.length > 0) {
      poisonBadge.textContent = activeKinds.map(k => STATUS_AILMENT_LABELS_JA[k] || k).join("／");
      poisonBadge.classList.remove("hidden");
    } else {
      poisonBadge.classList.add("hidden");
    }
  }
  
  updateGaugeFill("sp-fill", player.gauges.sp);
  updateGaugeValue("sp-value", player.gauges.sp.current, player.gauges.sp.max);
  
  updateGaugeFill("sleep-fill", player.gauges.sleepiness);
  updateGaugeValue("sleep-value", Math.floor(player.gauges.sleepiness.current), player.gauges.sleepiness.max);
  
  updateGaugeFill("fatigue-fill", player.gauges.fatigue);
  updateGaugeValue("fatigue-value", player.gauges.fatigue.current, player.gauges.fatigue.max);
  
  // 所持金（inventory.js のグローバル変数 gold を参照）
  const goldEl = document.getElementById("gold-value");
  if (goldEl) goldEl.textContent = `${gold}陳`;
  
  // ★メインタブのアナログ/デジタル時計を、今のゲーム内時刻に合わせて描画する（要望対応）
  renderMainTabClock();
  
  renderMainTabCompanionParams();
  renderObjectiveBanner();
  renderRankUpBanner();
}

// ★メインタブのアナログ時計（時針・分針のみ）とデジタル時計を、player.gameHour（0〜24の小数）に合わせて描画する
function renderMainTabClock() {
  if (!player) return;
  const hourValue = typeof player.gameHour === "number" ? player.gameHour : 8;
  const hour24 = ((hourValue % 24) + 24) % 24; // ★念のため負数や24以上が来てもループさせる
  const wholeHour = Math.floor(hour24);
  const minutes = Math.floor((hour24 - wholeHour) * 60);
  const wholeHour12 = wholeHour % 12;
  
  // ★時針：1時間で30°、さらに分の経過ぶんも滑らかに進める（1分で0.5°）。
  //   ★以前はここでhour24（分の端数込みの時刻）をそのまま30倍した上に、さらにminutes*0.5を
  //     足していたため、分の進み具合が二重に計算され、例えば8時30分が本来の255°ではなく270°
  //     （実質9時の位置寄り）になってしまっていた。整数の「時」だけを使うよう修正した
  const hourAngle = wholeHour12 * 30 + minutes * 0.5;
  // ★分針：1分で6°
  const minuteAngle = minutes * 6;
  
  const hourHand = document.getElementById("main-tab-clock-hour-hand");
  const minuteHand = document.getElementById("main-tab-clock-minute-hand");
  if (hourHand) hourHand.style.transform = `rotate(${hourAngle}deg)`;
  if (minuteHand) minuteHand.style.transform = `rotate(${minuteAngle}deg)`;
  
  const digitalEl = document.getElementById("main-tab-digital-clock");
  if (digitalEl) digitalEl.textContent = `${wholeHour}:${String(minutes).padStart(2, "0")}`;
}

// ★「ランクアップ可能（試練に挑める）」状態を、どのサブ画面タブを開いていてもずっと分かるように表示する。
//   以前はランクアップ可能かどうかを知る手段が薄く、気づかないまま放置されがちだった
function renderRankUpBanner() {
  const banner = document.getElementById("rankup-banner");
  const textEl = document.getElementById("rankup-banner-text");
  if (!banner || !textEl) return;
  const nextRank = typeof getNextTrialRank === "function" ? getNextTrialRank() : null; // questboard.js
  if (nextRank) {
    textEl.textContent = `ランクアップ可能！ 広場の「試練の祭殿」でランク${nextRank}への昇格に挑戦できます`;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}

// ★シナリオエディタで話ごとに設定した「目標（タスク）」を、その話が始まるまでメインタブに表示する
function renderObjectiveBanner() {
  const banner = document.getElementById("objective-banner");
  const textEl = document.getElementById("objective-banner-text");
  if (!banner || !textEl) return;
  const objective = typeof getCurrentChapterObjectiveText === "function" ? getCurrentChapterObjectiveText() : null; // scenariobuild.js
  if (objective) {
    textEl.textContent = objective;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}

// ★メインタブの、主人公のパラメータのすぐ下に、仲間それぞれの簡易パラメータ（HP/SP/レベル）を並べる
function renderMainTabCompanionParams() {
  const container = document.getElementById("main-tab-companion-params");
  if (!container || !player) return;
  container.innerHTML = "";
  
  if (!player.companions || player.companions.length === 0) return;
  
  player.companions.forEach(companion => {
    const master = typeof getCompanionMaster === "function" ? getCompanionMaster(companion) : null; // player.js
    
    const row = document.createElement("div");
    row.className = "main-tab-companion-row" + (companion.alive ? "" : " main-tab-companion-row-down");
    
    const nameEl = document.createElement("div");
    nameEl.className = "main-tab-companion-name";
    nameEl.textContent = `${master ? master.name : companion.companionId}（Lv.${companion.level}）` + (companion.alive ? "" : "　【戦闘不能】");
    row.appendChild(nameEl);
    
    // ★仲間の経験値ゲージ（要望対応）
    const expRow = document.createElement("div");
    expRow.className = "gauge-row";
    const expLabel = document.createElement("span");
    expLabel.className = "gauge-label";
    expLabel.textContent = "EXP";
    expRow.appendChild(expLabel);
    const expBar = document.createElement("div");
    expBar.className = "gauge-bar";
    const expFill = document.createElement("div");
    expFill.className = "gauge-fill exp-fill";
    const companionExp = typeof companion.exp === "number" ? companion.exp : 0;
    const companionExpToNext = (typeof expNeededForLevel === "function") ? expNeededForLevel(companion.level) : 100;
    expFill.style.width = `${companionExpToNext > 0 ? (companionExp / companionExpToNext) * 100 : 0}%`;
    expBar.appendChild(expFill);
    expRow.appendChild(expBar);
    const expValue = document.createElement("span");
    expValue.className = "gauge-value";
    expValue.textContent = `${companionExp} / ${companionExpToNext}`;
    expRow.appendChild(expValue);
    row.appendChild(expRow);
    
    const hpRow = document.createElement("div");
    hpRow.className = "gauge-row";
    const hpLabel = document.createElement("span");
    hpLabel.className = "gauge-label";
    hpLabel.textContent = "体力";
    hpRow.appendChild(hpLabel);
    const hpBar = document.createElement("div");
    hpBar.className = "gauge-bar";
    const hpFill = document.createElement("div");
    hpFill.className = "gauge-fill hp-fill";
    hpFill.style.width = `${companion.gauges.hp.max > 0 ? (companion.gauges.hp.current / companion.gauges.hp.max) * 100 : 0}%`;
    hpBar.appendChild(hpFill);
    hpRow.appendChild(hpBar);
    const hpValue = document.createElement("span");
    hpValue.className = "gauge-value";
    hpValue.textContent = `${companion.gauges.hp.current} / ${companion.gauges.hp.max}`;
    hpRow.appendChild(hpValue);
    row.appendChild(hpRow);
    
    const spRow = document.createElement("div");
    spRow.className = "gauge-row";
    const spLabel = document.createElement("span");
    spLabel.className = "gauge-label";
    spLabel.textContent = "SP";
    spRow.appendChild(spLabel);
    const spBar = document.createElement("div");
    spBar.className = "gauge-bar";
    const spFill = document.createElement("div");
    spFill.className = "gauge-fill sp-fill";
    spFill.style.width = `${companion.gauges.sp.max > 0 ? (companion.gauges.sp.current / companion.gauges.sp.max) * 100 : 0}%`;
    spBar.appendChild(spFill);
    spRow.appendChild(spBar);
    const spValue = document.createElement("span");
    spValue.className = "gauge-value";
    spValue.textContent = `${companion.gauges.sp.current} / ${companion.gauges.sp.max}`;
    spRow.appendChild(spValue);
    row.appendChild(spRow);
    
    container.appendChild(row);
  });
}

// 1本のゲージの幅(%)を、current/maxの割合に合わせてセットする補助関数
function updateGaugeFill(elementId, gauge) {
  const fillEl = document.getElementById(elementId);
  if (!fillEl || !gauge) return;
  const percent = gauge.max > 0 ? (gauge.current / gauge.max) * 100 : 0;
  fillEl.style.width = `${percent}%`;
}

// ゲージの横に「現在値 / 最大値」を数字でも表示する補助関数（わかりやすさのため）
function updateGaugeValue(elementId, current, max) {
  const valueEl = document.getElementById(elementId);
  if (!valueEl) return;
  valueEl.textContent = `${current} / ${max}`;
}

// ==== 装備タブ ====
// ★「装備箇所（武器/胴/盾）を選ぶ→その部位に装備できるアイテムを選ぶ」の2段階形式。
//   矢印キーでカーソル移動、決定キーで次に進む/装備する。DOMフォーカスは使わない。
const EQUIPMENT_SLOT_KEYS = ["武器", "胴", "盾"];
let equipmentFocusRegion = "slots"; // "slots"（上の装備箇所一覧） | "items"（下のアイテム選択一覧）
let equipmentSlotCursorIndex = 0;
let equipmentItemCursorIndex = 0;

// 装備タブ全体を描画し直す
function renderEquipmentTab() {
  renderEquipmentSlots();
  renderEquipmentInventoryList();
}

// 上部：装備箇所一覧（武器/胴/盾）。ここではカーソル移動のみ行い、決定でその部位のアイテム選択へ進む
function renderEquipmentSlots() {
  const container = document.getElementById("equipment-slots");
  if (!container || !player) return;
  container.innerHTML = "";
  
  EQUIPMENT_SLOT_KEYS.forEach((slot, i) => {
    const equipped = getEquippedItemData(slot); // player.js（instanceId→実体の解決）
    const itemData = equipped ? equipped.master : null;
    
    const row = document.createElement("div");
    row.className = "equipment-slot-row" + (equipmentFocusRegion === "slots" && i === equipmentSlotCursorIndex ? " cursor" : "");
    // ★スロットを選んだら、まずそのスロットにカーソルを合わせるだけ。
    //   実際にアイテム一覧へ進むのは決定キー（またはこの後の enterEquipmentItemSelection）から。
    row.onclick = (event) => {
      event.stopPropagation();
      equipmentSlotCursorIndex = i;
      enterEquipmentItemSelection();
    };
    
    const labelEl = document.createElement("span");
    labelEl.className = "equipment-slot-label";
    labelEl.textContent = slot;
    
    const valueEl = document.createElement("span");
    valueEl.className = "equipment-slot-value";
    valueEl.textContent = itemData ? itemData.name : "（なし）";
    
    row.appendChild(labelEl);
    row.appendChild(valueEl);
    container.appendChild(row);
  });
}

// スロット一覧から、選択中の部位のアイテム選択画面へ進む共通処理
function enterEquipmentItemSelection() {
  equipmentFocusRegion = "items";
  equipmentItemCursorIndex = 0;
  renderEquipmentTab();
}

// 装備できるアイテムの一覧を、所持品(inventorySlots)から集める
// slotFilter を指定すると、その装備部位（武器/胴/盾）のアイテムだけに絞り込む
function getEquippableInventoryEntries(slotFilter = null) {
  // ★同じアイテムIDでも、1個1個ランダムな性能変位(statBonus)を持ちうるため、
  //   ここではまとめずに実体（instanceId）ごとに1つずつ選択肢として並べる
  const entries = [];
  inventorySlots.forEach((slot) => {
    if (!slot) return;
    const itemData = getEffectiveItemMaster(slot); // player.js（サビ取り等の個体ごとの上書きも反映）
    if (!itemData || !itemData.params || !itemData.params.装備部位) return;
    if (slotFilter && itemData.params.装備部位 !== slotFilter) return;
    
    entries.push({ instanceId: slot.instanceId, itemId: slot.itemId, itemData, statBonus: slot.statBonus });
  });
  return entries;
}

// 今選んでいる装備箇所について、アイテム選択一覧に並べる項目を返す。
// ★装備中なら先頭に「外す」という特別な項目を入れる（この一覧内だけで装備解除もできるように）
function getEquipmentSelectionEntries() {
  const slot = EQUIPMENT_SLOT_KEYS[equipmentSlotCursorIndex];
  const entries = getEquippableInventoryEntries(slot).map(e => ({ kind: "equip", instanceId: e.instanceId, itemId: e.itemId, itemData: e.itemData, statBonus: e.statBonus }));
  
  if (player.equipment[slot]) {
    entries.unshift({ kind: "unequip", slot });
  }
  
  return entries;
}

// 下部：選んでいる装備箇所に装備できるアイテムの選択一覧
// ★装備箇所（スロット）を選んで決定した後にだけ、その部位に合うアイテムを表示する形式に変更
function renderEquipmentInventoryList() {
  const container = document.getElementById("equipment-inventory-list");
  if (!container || !player) return;
  container.innerHTML = "";
  
  // ★まだ装備箇所を選んでいない（スロット一覧を見ている）間は、アイテム一覧を出さず案内だけ表示する
  if (equipmentFocusRegion !== "items") {
    const hintEl = document.createElement("p");
    hintEl.className = "equipment-empty";
    hintEl.textContent = "上の装備箇所を選んで決定すると、装備できるアイテムが一覧表示される。";
    container.appendChild(hintEl);
    return;
  }
  
  const currentSlot = EQUIPMENT_SLOT_KEYS[equipmentSlotCursorIndex];
  const entries = getEquipmentSelectionEntries();
  
  if (entries.length === 0) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "equipment-empty";
    emptyEl.textContent = `「${currentSlot}」に装備できるアイテムを持っていない。`;
    container.appendChild(emptyEl);
    return;
  }
  
  if (equipmentItemCursorIndex >= entries.length) equipmentItemCursorIndex = entries.length - 1;
  if (equipmentItemCursorIndex < 0) equipmentItemCursorIndex = 0;
  
  entries.forEach((entry, i) => {
    const item = document.createElement("button");
    
    if (entry.kind === "unequip") {
      item.className = "equipment-item equipment-item-unequip" + (i === equipmentItemCursorIndex ? " cursor" : "");
      
      const nameEl = document.createElement("span");
      nameEl.className = "equipment-item-name";
      nameEl.textContent = "（外す）";
      item.appendChild(nameEl);
      
      item.onclick = (event) => {
        event.stopPropagation();
        equipmentItemCursorIndex = i;
        handleUnequip(entry.slot);
      };
      
      container.appendChild(item);
      if (i === equipmentItemCursorIndex) item.scrollIntoView({ block: "nearest" });
      return;
    }
    
    const isEquipped = player.equipment[entry.itemData.params.装備部位] === entry.instanceId;
    // ★バグ修正（要望対応）：以前は「自分が今装備している物」しか分からず、既に仲間が装備している
    //   個体でも空き扱いに見えてしまい、誤って同じ個体を2人に装備させたような表示になっていた。
    //   誰か（自分／仲間）が装備中なら、その名前を出す
    const holderName = typeof describeInstanceHolderName === "function" ? describeInstanceHolderName(entry.instanceId) : (isEquipped ? "自分" : null); // player.js
    
    item.className = "equipment-item"
      + (isEquipped ? " equipped" : "")
      + (i === equipmentItemCursorIndex ? " cursor" : "");
    
    const nameEl = document.createElement("span");
    nameEl.className = "equipment-item-name";
    nameEl.textContent = entry.itemData.name;
    
    const bonusEl = document.createElement("span");
    bonusEl.className = "equipment-item-bonus";
    const bonusParts = [];
    // ★statBonusがあれば「基本値+個体差」の形でそのまま表示する（無ければ基本値のみ）
    const bonusKey = entry.statBonus ? entry.statBonus.statKey : null;
    if (entry.itemData.params.攻撃力 !== undefined) {
      const total = getDisplayEquipmentStatTotal(entry.itemData.params.攻撃力, bonusKey === "攻撃力" ? entry.statBonus.amount : 0);
      bonusParts.push(`攻撃+${total}` + (bonusKey === "攻撃力" ? `（変位${entry.statBonus.amount >= 0 ? "+" : ""}${entry.statBonus.amount}）` : ""));
    }
    if (entry.itemData.params.最大HP !== undefined) {
      const total = getDisplayEquipmentStatTotal(entry.itemData.params.最大HP, bonusKey === "最大HP" ? entry.statBonus.amount : 0);
      bonusParts.push(`最大HP+${total}` + (bonusKey === "最大HP" ? `（変位${entry.statBonus.amount >= 0 ? "+" : ""}${entry.statBonus.amount}）` : ""));
    }
    bonusEl.textContent = bonusParts.join("　");
    // ★この個体の変位が最大値（お宝鑑定団なら+40）を引いていたら黄文字にする
    if (entry.statBonus && entry.statBonus.amount === entry.statBonus.maxRange) {
      bonusEl.classList.add("item-stat-max");
    }
    
    item.appendChild(nameEl);
    item.appendChild(bonusEl);
    
    if (holderName) {
      const tagEl = document.createElement("span");
      tagEl.className = "equipment-equipped-tag";
      tagEl.textContent = `装備中（${holderName}）`;
      item.appendChild(tagEl);
    }
    
    item.onclick = (event) => {
      event.stopPropagation();
      equipmentItemCursorIndex = i;
      handleEquip(entry.instanceId);
    };
    
    container.appendChild(item);
    if (i === equipmentItemCursorIndex) item.scrollIntoView({ block: "nearest" });
  });
}

// アイテムを装備し、メッセージで結果を知らせる。装備箇所選択に戻す
async function handleEquip(instanceId) {
  // ★戦闘中はここから装備変更させない（戦闘側の選択肢待ちと衝突して固まるバグを防ぐ）
  if (typeof battleState !== "undefined" && battleState) {
    changeSpeaker("");
    await displayMessage("戦闘中は装備を変更できないようだ。", { allowSubFocus: true });
    return;
  }
  await runWithLocationMenuHidden(async () => {
    const result = equipItem(instanceId); // player.js
    changeSpeaker("");
    await displayMessage(result.message, { allowSubFocus: true });
    equipmentFocusRegion = "slots";
    renderStatusHUD();
    renderEquipmentTab();
  });
}

// 装備を外し、メッセージで結果を知らせる。装備箇所選択に戻す
async function handleUnequip(slot) {
  if (typeof battleState !== "undefined" && battleState) {
    changeSpeaker("");
    await displayMessage("戦闘中は装備を変更できないようだ。", { allowSubFocus: true });
    return;
  }
  await runWithLocationMenuHidden(async () => {
    const result = unequipItem(slot); // player.js
    changeSpeaker("");
    await displayMessage(result.message, { allowSubFocus: true });
    equipmentFocusRegion = "slots";
    renderStatusHUD();
    renderEquipmentTab();
  });
}

// ★装備タブが開いている間、矢印キーでカーソル移動・決定キーで次へ進む/装備解除
window.addEventListener("keydown", (event) => {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  if (controlFocus !== "sub") return;
  if (isGameDialogOpen) return;
  if (event.repeat) return;
  
  const activeTab = document.querySelector('.tab-content.active');
  if (!activeTab || activeTab.id !== 'tab-equipment') return;
  if (!player) return;
  
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (equipmentFocusRegion === "slots") {
      // ★スロット一覧の中だけで移動する（末尾でアイテム一覧へ自動で移ったりはしない）
      equipmentSlotCursorIndex = Math.min(EQUIPMENT_SLOT_KEYS.length - 1, equipmentSlotCursorIndex + 1);
    } else {
      const entries = getEquipmentSelectionEntries();
      equipmentItemCursorIndex = Math.min(entries.length - 1, equipmentItemCursorIndex + 1);
    }
    renderEquipmentTab();
    
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    if (equipmentFocusRegion === "slots") {
      equipmentSlotCursorIndex = Math.max(0, equipmentSlotCursorIndex - 1);
    } else {
      equipmentItemCursorIndex = Math.max(0, equipmentItemCursorIndex - 1);
    }
    renderEquipmentTab();
    
  } else if (KEY_CONFIG.decideKeys.includes(event.key)) {
    // ★装備結果のメッセージ表示中は、決定キーでの装備操作だけ受け付けない（二重発動防止）。
    //   カーソル移動（上のArrowUp/ArrowDown）まで止めてしまうと、メッセージが消えるまで
    //   装備タブが固まって見えてしまうため、ここでだけ絞ってガードする
    if (isTextDisplaying) return;
    
    event.preventDefault();
    if (equipmentFocusRegion === "slots") {
      // ★まず装備箇所を選ぶ→決定でその部位のアイテム選択（＋外す）一覧に進む
      enterEquipmentItemSelection();
    } else {
      const entries = getEquipmentSelectionEntries();
      const entry = entries[equipmentItemCursorIndex];
      if (!entry) return;
      if (entry.kind === "unequip") {
        handleUnequip(entry.slot);
      } else {
        handleEquip(entry.instanceId);
      }
    }
    
  } else if (KEY_CONFIG.cancelKeys.includes(event.key)) {
    event.preventDefault();
    if (equipmentFocusRegion === "items") {
      equipmentFocusRegion = "slots";
      renderEquipmentTab();
    }
  }
});
// ★矢印キーでカーソル移動、決定キーで選択中のスキルを使う（DOMフォーカスは使わない）
let skillCursorIndex = 0;

// ===== 仲間タブ =====
let companionsTabExpandedId = null; // ★詳細（スキル・装備）を開いている仲間のcompanionId
let companionsTabOpenEquipSlot = null; // ★装備アイテム一覧を展開中の { companionId, slot }（無ければnull）
let companionCursorIndex = 0; // ★キーボード操作用：仲間一覧の何番目にカーソルがあるか
let companionDetailCursorIndex = 0; // ★キーボード操作用：詳細を開いた仲間の中で、今どの項目（装備枠／個々のアイテム）にカーソルがあるか

function renderCompanionsTab() {
  const container = document.getElementById("companion-list");
  if (!container || !player) return;
  container.innerHTML = "";
  
  if (!player.companions || player.companions.length === 0) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "skill-empty";
    emptyEl.textContent = "まだ仲間がいないようだ。";
    container.appendChild(emptyEl);
    return;
  }
  
  if (companionCursorIndex >= player.companions.length) companionCursorIndex = player.companions.length - 1;
  if (companionCursorIndex < 0) companionCursorIndex = 0;
  
  player.companions.forEach((companion, i) => {
    const card = buildCompanionTabCard(companion, i === companionCursorIndex);
    container.appendChild(card);
    // ★キーボードでカーソルが画面外にはみ出したら、自動でスクロールして見えるようにする
    if (i === companionCursorIndex) {
      // ★詳細を開いている時は、カード全体ではなく「今フォーカスしている項目（装備枠やアイテム行）」を優先してスクロール対象にする。
      //   以前はカードの先頭にしかスクロールせず、下の方の装備枠やアイテム一覧が隠れたままになっていた
      const focusList = card.querySelectorAll("[data-cf-index]");
      const focusedEl = focusList[companionDetailCursorIndex];
      (focusedEl || card).scrollIntoView({ block: "nearest" });
    }
  });
}

function toggleCompanionExpanded(companion) {
  const isExpanded = companionsTabExpandedId === companion.companionId;
  companionsTabExpandedId = isExpanded ? null : companion.companionId;
  companionDetailCursorIndex = 0; // ★開閉するたびに、詳細内のカーソルは先頭に戻す
  if (!companionsTabExpandedId) companionsTabOpenEquipSlot = null; // ★畳んだら、開いていた装備選択も閉じておく
  renderCompanionsTab();
}

function buildCompanionTabCard(companion, isCursor) {
  const master = typeof getCompanionMaster === "function" ? getCompanionMaster(companion) : null; // player.js
  const stats = typeof getCompanionEffectiveStats === "function" ? getCompanionEffectiveStats(companion) : null; // player.js
  const isExpanded = companionsTabExpandedId === companion.companionId;
  
  const card = document.createElement("div");
  card.className = "companion-card" + (companion.alive ? "" : " companion-card-down") + (isCursor ? " cursor" : "");
  
  const headerRow = document.createElement("div");
  headerRow.className = "companion-card-header";
  headerRow.onclick = (event) => {
    event.stopPropagation();
    companionCursorIndex = player.companions.indexOf(companion);
    toggleCompanionExpanded(companion);
  };
  
  const nameEl = document.createElement("span");
  nameEl.className = "companion-name";
  nameEl.textContent = `${master ? master.name : companion.companionId}（${master ? master.class : "？"} Lv.${companion.level}）` + (companion.alive ? "" : "　【戦闘不能】");
  headerRow.appendChild(nameEl);
  
  const toggleEl = document.createElement("span");
  toggleEl.className = "companion-toggle-icon";
  toggleEl.textContent = isExpanded ? "▲" : "▼";
  headerRow.appendChild(toggleEl);
  card.appendChild(headerRow);
  
  // ★HP/SPバー（メインタブ・強さタブと違う専用の簡易ゲージ）
  const gaugeRow = document.createElement("div");
  gaugeRow.className = "companion-gauge-row";
  gaugeRow.appendChild(buildCompanionMiniGauge("HP", companion.gauges.hp.current, companion.gauges.hp.max, "companion-gauge-hp"));
  gaugeRow.appendChild(buildCompanionMiniGauge("SP", companion.gauges.sp.current, companion.gauges.sp.max, "companion-gauge-sp"));
  card.appendChild(gaugeRow);
  
  if (!isExpanded) return card;
  
  // ★詳細を開いている間、キーボードの↑↓で辿れる「フォーカス可能な項目」に通し番号を振っていく
  let cfCounter = 0;
  const isCursorCard = isCursor;
  
  // ★ステータス
  if (stats) {
    const statsRow = document.createElement("div");
    statsRow.className = "companion-stats-row";
    statsRow.textContent = `攻撃力${stats.atk}　素早さ${stats.agi}　魔力${stats.skillPower}　運${stats.luck}　魅力${stats.charm}`;
    card.appendChild(statsRow);
  }
  
  // ★装備
  const equipTitle = document.createElement("p");
  equipTitle.className = "companion-section-title";
  equipTitle.textContent = "装備";
  card.appendChild(equipTitle);
  
  const equipRow = document.createElement("div");
  equipRow.className = "companion-equipment-row";
  Object.keys(companion.equipment).forEach(slot => {
    const equipped = getEquippedItemDataFor(companion.equipment, slot); // player.js
    const isOpen = companionsTabOpenEquipSlot
      && companionsTabOpenEquipSlot.companionId === companion.companionId
      && companionsTabOpenEquipSlot.slot === slot;
    
    const btn = document.createElement("button");
    const btnIndex = cfCounter++;
    btn.dataset.cfIndex = String(btnIndex);
    btn.className = "companion-equip-btn" + (isOpen ? " companion-equip-btn-open" : "")
      + (isCursorCard && btnIndex === companionDetailCursorIndex ? " companion-focus-cursor" : "");
    btn.textContent = `${slot}：${equipped ? equipped.master.name : "（なし）"}`;
    btn.onclick = (event) => {
      event.stopPropagation();
      companionsTabOpenEquipSlot = isOpen ? null : { companionId: companion.companionId, slot };
      companionDetailCursorIndex = btnIndex; // ★クリックした項目をそのままキーボードのカーソル位置にも反映する
      renderCompanionsTab();
    };
    equipRow.appendChild(btn);
    
    if (isOpen) {
      const listResult = buildCompanionEquipmentItemList(companion, slot, cfCounter, isCursorCard, btnIndex);
      cfCounter = listResult.nextIndex;
      equipRow.appendChild(listResult.el);
    }
  });
  card.appendChild(equipRow);
  
  // ★スキル
  const skillTitle = document.createElement("p");
  skillTitle.className = "companion-section-title";
  skillTitle.textContent = "スキル";
  card.appendChild(skillTitle);
  
  const allSkills = (master && typeof CLASS_SKILLS !== "undefined") ? (CLASS_SKILLS[master.class] || []) : [];
  const skillListEl = document.createElement("div");
  skillListEl.className = "companion-skill-list";
  if (allSkills.length === 0) {
    const noneEl = document.createElement("p");
    noneEl.className = "skill-empty";
    noneEl.textContent = "スキルが無いようだ。";
    skillListEl.appendChild(noneEl);
  } else {
    allSkills.forEach(skill => {
      const unlocked = companion.level >= skill.unlockLevel;
      const itemEl = document.createElement("div");
      const skillIndex = cfCounter++;
      itemEl.dataset.cfIndex = String(skillIndex);
      itemEl.className = "skill-item" + (unlocked ? "" : " locked")
        + (isCursorCard && skillIndex === companionDetailCursorIndex ? " companion-focus-cursor" : "");
      
      const infoRow = document.createElement("div");
      infoRow.className = "skill-item-info";
      const nameEl2 = document.createElement("span");
      nameEl2.className = "skill-name";
      nameEl2.textContent = unlocked ? `${skill.name}${skill.spCost ? `（SP${skill.spCost}）` : ""}` : `？？？（Lv.${skill.unlockLevel}で習得）`;
      const descEl2 = document.createElement("span");
      descEl2.className = "skill-description";
      descEl2.textContent = unlocked ? skill.description : "まだ習得していない、未知のスキル。";
      infoRow.appendChild(nameEl2);
      infoRow.appendChild(descEl2);
      itemEl.appendChild(infoRow);
      skillListEl.appendChild(itemEl);
    });
  }
  card.appendChild(skillListEl);
  
  return card;
}

function buildCompanionMiniGauge(label, current, max, fillClass) {
  const wrap = document.createElement("div");
  wrap.className = "companion-mini-gauge";
  
  const labelEl = document.createElement("span");
  labelEl.className = "companion-mini-gauge-label";
  labelEl.textContent = `${label} ${current}/${max}`;
  wrap.appendChild(labelEl);
  
  const barEl = document.createElement("div");
  barEl.className = "companion-mini-gauge-bar";
  const fillEl = document.createElement("div");
  fillEl.className = "companion-mini-gauge-fill " + fillClass;
  fillEl.style.width = `${max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0}%`;
  barEl.appendChild(fillEl);
  wrap.appendChild(barEl);
  
  return wrap;
}

// ★仲間の装備部位をタップした時、装備タブと同じ見た目のアイテム一覧をその場に展開して選ばせる
// ★startIndex以降の連番をこのリスト内の各行に振っていき、{ el, nextIndex }で返す（キーボード操作の対象にするため）。
//   slotButtonIndexは、この一覧の元になった装備枠ボタン自身の番号。装備変更するとこの一覧は自動で閉じるため、
//   閉じた後のカーソルはアイテム側ではなく、その枠のボタンに戻しておく（無効な番号を指したまま見えなくなるのを防ぐ）
function buildCompanionEquipmentItemList(companion, slot, startIndex, isCursorCard, slotButtonIndex) {
  const listEl = document.createElement("div");
  listEl.className = "equipment-item-list companion-equipment-item-list";
  let cfIndex = startIndex;
  
  if (companion.equipment[slot]) {
    const unequipBtn = document.createElement("button");
    const myIndex = cfIndex++;
    unequipBtn.dataset.cfIndex = String(myIndex);
    unequipBtn.className = "equipment-item equipment-item-unequip" + (isCursorCard && myIndex === companionDetailCursorIndex ? " companion-focus-cursor" : "");
    const nameEl = document.createElement("span");
    nameEl.className = "equipment-item-name";
    nameEl.textContent = "（外す）";
    unequipBtn.appendChild(nameEl);
    unequipBtn.onclick = (event) => {
      event.stopPropagation();
      const result = unequipItemForCompanion(companion, slot); // player.js
      companionsTabOpenEquipSlot = null;
      companionDetailCursorIndex = slotButtonIndex;
      renderCompanionsTab();
      changeSpeaker("");
      displayMessage(result.message, { allowSubFocus: true });
    };
    listEl.appendChild(unequipBtn);
  }
  
  const entries = getEquippableInventoryEntries(slot); // mainfunc.js（既存の装備タブと共通）
  
  if (entries.length === 0) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "equipment-empty";
    emptyEl.textContent = `「${slot}」に装備できるアイテムを持っていない。`;
    listEl.appendChild(emptyEl);
    return { el: listEl, nextIndex: cfIndex };
  }
  
  entries.forEach(entry => {
    const isEquipped = companion.equipment[slot] === entry.instanceId;
    // ★要望対応：自分や他の仲間が既に装備している個体も、そうと分かるように名前付きで表示する
    const holderName = typeof describeInstanceHolderName === "function" ? describeInstanceHolderName(entry.instanceId) : (isEquipped ? getCompanionDisplayName(companion) : null); // player.js
    const item = document.createElement("button");
    const myIndex = cfIndex++;
    item.dataset.cfIndex = String(myIndex);
    item.className = "equipment-item" + (isEquipped ? " equipped" : "") + (isCursorCard && myIndex === companionDetailCursorIndex ? " companion-focus-cursor" : "");
    
    const nameEl = document.createElement("span");
    nameEl.className = "equipment-item-name";
    nameEl.textContent = entry.itemData.name;
    item.appendChild(nameEl);
    
    const bonusEl = document.createElement("span");
    bonusEl.className = "equipment-item-bonus";
    const bonusParts = [];
    const bonusKey = entry.statBonus ? entry.statBonus.statKey : null;
    if (entry.itemData.params.攻撃力 !== undefined) {
      const total = getDisplayEquipmentStatTotal(entry.itemData.params.攻撃力, bonusKey === "攻撃力" ? entry.statBonus.amount : 0);
      bonusParts.push(`攻撃+${total}`);
    }
    if (entry.itemData.params.最大HP !== undefined) {
      const total = getDisplayEquipmentStatTotal(entry.itemData.params.最大HP, bonusKey === "最大HP" ? entry.statBonus.amount : 0);
      bonusParts.push(`最大HP+${total}`);
    }
    bonusEl.textContent = bonusParts.join("　");
    item.appendChild(bonusEl);
    
    if (holderName) {
      const tagEl = document.createElement("span");
      tagEl.className = "equipment-equipped-tag";
      tagEl.textContent = `装備中（${holderName}）`;
      item.appendChild(tagEl);
    }
    
    item.onclick = (event) => {
      event.stopPropagation();
      const result = equipItemForCompanion(companion, entry.instanceId); // player.js
      companionsTabOpenEquipSlot = null;
      companionDetailCursorIndex = slotButtonIndex;
      renderCompanionsTab();
      changeSpeaker("");
      displayMessage(result.message, { allowSubFocus: true });
    };
    listEl.appendChild(item);
  });
  
  return { el: listEl, nextIndex: cfIndex };
}

// ★仲間タブが開いている間、矢印キーでカーソル移動・決定キーで詳細（装備・スキル）の開閉、
//   さらに詳細を開いた後は↑↓で装備枠→アイテム一覧の各項目まで辿って決定キーで装備変更できるようにする。
//   戻るキーで一段階ずつ閉じる（アイテム一覧→装備枠の選択解除→詳細を畳む→仲間一覧のカーソルへ）
window.addEventListener("keydown", (event) => {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  if (controlFocus !== "sub") return;
  if (isGameDialogOpen) return;
  if (event.repeat) return;
  if (isTextDisplaying) return; // ★装備変更などの結果メッセージ表示中は、二重操作を防ぐため待つ
  
  const activeTab = document.querySelector('.tab-content.active');
  if (!activeTab || activeTab.id !== 'tab-companions') return;
  if (!player || !player.companions || player.companions.length === 0) return;
  
  const expandedCompanion = player.companions[companionCursorIndex] && companionsTabExpandedId === player.companions[companionCursorIndex].companionId
    ? player.companions[companionCursorIndex] : null;
  
  if (expandedCompanion) {
    // ★詳細を開いている間は、↑↓で「装備枠→（開いていれば）その中のアイテム」を順番に辿る
    const container = document.getElementById("companion-list");
    const focusList = container ? container.querySelectorAll("[data-cf-index]") : [];
    
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (focusList.length === 0) return;
      event.preventDefault();
      const dir = event.key === "ArrowDown" ? 1 : -1;
      companionDetailCursorIndex = Math.max(0, Math.min(focusList.length - 1, companionDetailCursorIndex + dir));
      renderCompanionsTab();
      return;
    }
    
    if (KEY_CONFIG.decideKeys.includes(event.key)) {
      event.preventDefault();
      const targetEl = focusList[companionDetailCursorIndex];
      if (targetEl) targetEl.click(); // ★装備枠のボタン・「外す」・アイテム行、それぞれの既存のクリック処理をそのまま使う
      return;
    }
    
    if (KEY_CONFIG.cancelKeys.includes(event.key)) {
      event.preventDefault();
      if (companionsTabOpenEquipSlot && companionsTabOpenEquipSlot.companionId === expandedCompanion.companionId) {
        companionsTabOpenEquipSlot = null; // ★アイテム一覧を閉じるだけ（装備枠の選択自体は残す）
      } else {
        companionsTabExpandedId = null; // ★詳細ごと畳んで、仲間一覧のカーソルに戻る
      }
      renderCompanionsTab();
      return;
    }
    return;
  }
  
  if (event.key === "ArrowDown") {
    event.preventDefault();
    companionCursorIndex = Math.min(player.companions.length - 1, companionCursorIndex + 1);
    renderCompanionsTab();
    
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    companionCursorIndex = Math.max(0, companionCursorIndex - 1);
    renderCompanionsTab();
    
  } else if (KEY_CONFIG.decideKeys.includes(event.key)) {
    event.preventDefault();
    const companion = player.companions[companionCursorIndex];
    if (companion) toggleCompanionExpanded(companion);
  }
});

function renderSkills() {
  const container = document.getElementById("skill-list");
  if (!container || !player) return;
  
  container.innerHTML = "";
  
  const skills = getPlayerSkills(); // player.js
  
  if (skills.length === 0) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "skill-empty";
    emptyEl.textContent = "まだ習得しているスキルがありません。";
    container.appendChild(emptyEl);
    return;
  }
  
  if (skillCursorIndex >= skills.length) skillCursorIndex = skills.length - 1;
  if (skillCursorIndex < 0) skillCursorIndex = 0;
  
  skills.forEach((skill, i) => {
    const unlocked = player.level >= skill.unlockLevel;
    
    const item = document.createElement("div");
    item.className = "skill-item" + (unlocked ? "" : " locked") + (i === skillCursorIndex ? " cursor" : "");
    item.onclick = (event) => {
      event.stopPropagation();
      skillCursorIndex = i;
      renderSkills();
    };
    
    const infoRow = document.createElement("div");
    infoRow.className = "skill-item-info";
    
    const nameEl = document.createElement("span");
    nameEl.className = "skill-name";
    nameEl.textContent = unlocked ? `${skill.name}${skill.spCost ? `（SP${skill.spCost}）` : ""}` : `？？？（Lv.${skill.unlockLevel}で習得）`;
    
    const descEl = document.createElement("span");
    descEl.className = "skill-description";
    descEl.textContent = unlocked ? skill.description : "まだ習得していない、未知のスキル。";
    
    infoRow.appendChild(nameEl);
    infoRow.appendChild(descEl);
    
    if (unlocked && skill.element) {
      const elementEl = document.createElement("span");
      elementEl.className = "skill-element-tag";
      elementEl.textContent = `属性：${skill.element}`;
      infoRow.appendChild(elementEl);
    }
    
    item.appendChild(infoRow);
    
    if (unlocked) {
      const useBtn = document.createElement("button");
      // ★シナリオ中（第一話がまだ終わっていない間）はスキルを使わせない
      const isBattleOnly = skill.type === "attack" || skill.type === "buff"; // ★自己強化(buff)は戦闘中の駆け引きが前提なので、攻撃技と同じく戦闘専用にする
      const isPassive = skill.type === "passive"; // ★常時発動中で、使うボタンを押す必要が無いスキル
      const lockedByScenario = !chapter1Finished && skill.type !== "attack";
      
      if (isPassive) {
        // ★常時発動スキルは、使うのではなくON/OFFを切り替えるボタンにする
        const isOn = !(player.disabledPassives && player.disabledPassives.includes(skill.passiveId));
        useBtn.className = "skill-use-btn skill-passive-toggle-btn" + (isOn ? " skill-passive-on" : " skill-passive-off");
        useBtn.textContent = isOn ? "発動中（タップでOFF）" : "OFF（タップでON）";
        useBtn.onclick = (event) => {
          event.stopPropagation();
          skillCursorIndex = i;
          togglePassiveSkill(skill.passiveId); // player.js
          renderSkills();
        };
      } else {
        useBtn.className = "skill-use-btn" + (lockedByScenario ? " skill-use-btn-disabled" : "");
        useBtn.textContent = isBattleOnly ? "戦闘専用" : (lockedByScenario ? "シナリオ中" : "使う");
        useBtn.onclick = (event) => {
          event.stopPropagation();
          skillCursorIndex = i;
          useSkillFromTab(skill);
        };
      }
      item.appendChild(useBtn);
    }
    
    container.appendChild(item);
    
    // ★キーボードでカーソルが画面下（や画面上）にはみ出したら、自動でスクロールして見えるようにする
    if (i === skillCursorIndex) {
      item.scrollIntoView({ block: "nearest" });
    }
  });
}

// ★スキルタブが開いている間、矢印キーでカーソル移動・決定キーで選択中のスキルを使う
window.addEventListener("keydown", (event) => {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  if (controlFocus !== "sub") return;
  if (isGameDialogOpen) return;
  if (event.repeat) return;
  
  const activeTab = document.querySelector('.tab-content.active');
  if (!activeTab || activeTab.id !== 'tab-skill') return;
  
  const skills = getPlayerSkills();
  if (skills.length === 0) return;
  
  if (event.key === "ArrowDown") {
    event.preventDefault();
    skillCursorIndex = Math.min(skills.length - 1, skillCursorIndex + 1);
    renderSkills();
    
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    skillCursorIndex = Math.max(0, skillCursorIndex - 1);
    renderSkills();
    
  } else if (KEY_CONFIG.decideKeys.includes(event.key)) {
    // ★スキル使用結果のメッセージ表示中は、決定キーでのスキル発動だけ受け付けない（二重発動防止）。
    //   カーソル移動まで止めるとメッセージが消えるまでスキルタブが固まって見えるため、ここだけ絞る
    if (isTextDisplaying) return;
    
    event.preventDefault();
    const skill = skills[skillCursorIndex];
    if (player.level >= skill.unlockLevel) {
      if (skill.type === "passive") {
        togglePassiveSkill(skill.passiveId); // player.js
        renderSkills();
      } else {
        useSkillFromTab(skill);
      }
    } else {
      switchTab('tab-main');
      changeSpeaker("");
      displayMessage(`「${skill.type === "special" ? "？？？" : "？？？"}」はまだ習得していない。Lv.${skill.unlockLevel}になったら使えるようになるはずだ。`, { allowSubFocus: true });
    }
  }
});

// スキルタブの「使う」ボタンから、その場でスキルを発動する
// ★以前はここで switchToMainForMessage()/returnFocusToSub() を使い、結果メッセージを
//   見せている間だけ強制的にメイン画面（tab-main）へタブとフォーカスを切り替えていたが、
//   ・シナリオ中はどのみちスキルは使えないのでメイン画面に飛ぶ意味がない
//   ・タブを行ったり来たりする分、稀に元のタブへ戻り損ねる（別タブに飛んだままになる）
//   といった問題があったため廃止。メッセージウィンドウ(#message-text)はメイン画面・
//   サブ画面のどちらのタブが開いていても常に表示される要素なので、タブ切り替えは不要。
//   結果メッセージ表示中にキーボードで進めたり、他のタブ操作と誤って競合したりしないよう、
//   各タブのキー操作リスナー側で isTextDisplaying を見て待機するようにしている（後述）。

async function useSkillFromTab(skill) {
  if (!player) return;
  
  // ★〈緊急修正〉戦闘中にスキルタブから使うと、戦闘側が選択肢待ち（displayChoices）をしている
  //   ところへ、スキルタブ側からも displayMessage/displayChoices を呼んでしまい、
  //   進行が噛み合わなくなって固まる（進行不能になる）バグがあった。
  //   マジカル変身に限らず、戦闘中でも使えてしまう回復スキル等が無限に使えてしまう問題も同じ原因。
  //   戦闘中はここで止めて、専用の「たたかう→スキル」から使ってもらうようにする
  if (typeof battleState !== "undefined" && battleState) {
    changeSpeaker("");
    await displayMessage("戦闘中は、「たたかう」→「スキル」から使ってほしいようだ。", { allowSubFocus: true });
    return;
  }
  
  await runWithLocationMenuHidden(async () => {
  
  // ★シナリオ中（第一話がまだ終わっていない間）は、攻撃技以外のスキルも使わせない
  //   （攻撃技はこの下でどのみち「戦闘中にこそ真価を発揮する」という案内だけになる）
  if (!chapter1Finished && skill.type !== "attack") {
    changeSpeaker("");
    await displayMessage("シナリオの最中は、まだスキルを落ち着いて使える状況ではないようだ。", { allowSubFocus: true });
    renderSkills();
    return;
  }
  
  // ★なんでも鑑定（お宝鑑定団の固有スキル）も特別な処理（appraisal.js）。
  //   アイテム選択・予想額入力を挟むので、汎用のheal系スキル処理には乗せられないため
  if (skill.type === "special" && skill.id === "appraisal") {
    await useAppraisalSkill(skill);
    renderSkills();
    return;
  }
  
  // ★魔法少女の「マジカル変身」は戦闘中にこそ真価を発揮するので、タブからは案内だけする
  if (skill.type === "special" && skill.id === "magical_transform") {
    changeSpeaker("");
    await displayMessage(`「${skill.name}」は、戦闘中にこそ真価を発揮する技のようだ。`, { allowSubFocus: true });
    renderSkills();
    return;
  }
  
  // ★攻撃技・自己強化技は戦闘でこそ役立つので、タブからは発動せず案内だけする
  if (skill.type === "attack" || skill.type === "buff") {
    changeSpeaker("");
    await displayMessage(`「${skill.name}」は、戦闘中にこそ真価を発揮する技のようだ。`, { allowSubFocus: true });
    renderSkills();
    return;
  }
  
  // ★魔法少女は「マジカル変身」中でないと、回復の魔法技もタブから使えない
  if (player.class === "魔法少女" && skill.type === "heal" && !isMagicalGirlTransformed()) {
    changeSpeaker("");
    await displayMessage(`「${skill.name}」は魔法少女に変身しないと使えないようだ。`, { allowSubFocus: true });
    renderSkills();
    return;
  }
  
  // ★回復・軽減系のスキルは、その場で使える
  if (player.gauges.sp.current < skill.spCost) {
    changeSpeaker("");
    await displayMessage(`SPが足りず、「${skill.name}」は使えなかった。`, { allowSubFocus: true });
    renderSkills();
    return;
  }
  
  changeGauge("sp", -skill.spCost);
  renderStatusHUD();
  
  changeSpeaker("");
  const resultMessage = await performSkillHealWithTargetSelection(skill);
  if (resultMessage === null) {
    changeGauge("sp", skill.spCost); // ★「やめる」を選んだので、消費したSPを返す
    renderStatusHUD();
    renderSkills();
    return;
  }
  await displayMessage(`「${skill.name}」を使った！ ${resultMessage}`, { allowSubFocus: true });
  renderSkills();
  });
}

// healタイプのスキルの効果を、対象ゲージに適用する（mainfunc.js・battle.js共通で使う）
// ★スキルの実際の効果量を計算する。魔法少女は「マジカル変身」中、魔法の威力（回復量含む）が上がる
function getSkillPower(skill) {
  let power = skill.power;
  if (skill.gauge === "hp" && typeof isMagicalGirlTransformed === "function" && isMagicalGirlTransformed()) {
    power = Math.round(power * 1.3);
  }
  // ★回復力上昇：攻撃力上昇(atkUp)とは別枠のバフ。HP/SPを回復する技にだけ効果がある
  //  （疲労度・眠気を軽減する技には効かない＝「回復」ではなく「軽減」のため対象外）
  if ((skill.gauge === "hp" || skill.gauge === "sp") && typeof battleState !== "undefined" && battleState && battleState.playerHealBonusTurns > 0) {
    power += battleState.playerHealBonus;
  }
  return power;
}

function applySkillGaugeEffect(skill) {
  if (!skill.gauge) return;
  const power = getSkillPower(skill);
  if (skill.gauge === "hp") changeGauge("hp", power);
  else if (skill.gauge === "sp") changeGauge("sp", power);
  else if (skill.gauge === "sleepiness") changeGauge("sleepiness", -power);
  else if (skill.gauge === "fatigue") changeGauge("fatigue", -power);
}

// healタイプのスキルの効果メッセージを組み立てる（mainfunc.js・battle.js共通で使う）
function getSkillEffectMessage(skill) {
  const labels = { hp: "HPが", sp: "SPが", sleepiness: "眠気が", fatigue: "疲労度が" };
  const verb = (skill.gauge === "sleepiness" || skill.gauge === "fatigue") ? "軽減した" : "回復した";
  return `${labels[skill.gauge] || ""}${getSkillPower(skill)}${verb}。`;
}

// ★ランクアップ・試練解放・危険警告などを、進行を止めないトースト通知で知らせる共通処理。
//   displayMessageと違って入力待ちをせず、数秒後に自動で消える
let rankUpPopupHideTimer = null;
function showStatusPopup(title, message, variant = "positive") {
  const popup = document.getElementById("rank-up-popup");
  const titleEl = document.getElementById("rank-up-popup-title");
  const messageEl = document.getElementById("rank-up-popup-message");
  if (!popup || !titleEl || !messageEl) return;
  
  titleEl.textContent = title;
  messageEl.textContent = message;
  popup.classList.toggle("rank-up-popup-danger", variant === "danger"); // ★危険警告は赤系の見た目にする
  
  if (rankUpPopupHideTimer) clearTimeout(rankUpPopupHideTimer); // ★連続で出た時は前の非表示タイマーをキャンセルして出し直す
  popup.classList.remove("hidden");
  popup.classList.remove("rank-up-popup-show");
  void popup.offsetWidth; // ★同じ要素で連続再生しても毎回スライドインし直させるための強制リフロー
  popup.classList.add("rank-up-popup-show");
  
  rankUpPopupHideTimer = setTimeout(() => {
    popup.classList.remove("rank-up-popup-show");
    setTimeout(() => popup.classList.add("hidden"), 400); // ★スライドで隠れ切ってから display:none にする
  }, 3200);
}

// ランクアップ・試練解放（questboard.js・battle.jsから呼ばれる）
function showRankUpPopup(title, message) {
  showStatusPopup(title, message, "positive");
}

// 眠気・疲労度が限界に達した時の危険警告（player.jsから呼ばれる）
function showDangerPopup(title, message) {
  showStatusPopup(title, message, "danger");
}

// ★専用デザインのゲームオーバー画面を表示し、「リトライ」か「タイトルへ戻る」かをPromiseで返す
//   （シナリオビルドのゲームオーバーブロックから使用。battle.js通常の敗北処理とは別）
// ★ゲームオーバーは一種のバッドエンディングとして扱うため、endingNameを指定すると
//   「～ 田中ソード ～」のようにエンディング名も一緒に表示する（空欄なら何も表示しない）
function showGameOverScreen(message, endingName) {
  return new Promise(resolve => {
    const overlay = document.getElementById("gameover-overlay");
    const messageEl = document.getElementById("gameover-message");
    const endingNameEl = document.getElementById("gameover-ending-name");
    const retryBtn = document.getElementById("gameover-retry-btn");
    const titleBtn = document.getElementById("gameover-title-btn");
    if (!overlay || !messageEl || !retryBtn || !titleBtn) { resolve("title"); return; }
    
    messageEl.textContent = message || "";
    if (endingNameEl) {
      if (endingName) {
        endingNameEl.textContent = `～ ${endingName} ～`;
        endingNameEl.classList.remove("hidden");
      } else {
        endingNameEl.textContent = "";
        endingNameEl.classList.add("hidden");
      }
    }
    overlay.classList.remove("hidden");
    
    const cleanup = () => {
      overlay.classList.add("hidden");
      retryBtn.onclick = null;
      titleBtn.onclick = null;
    };
    
    retryBtn.onclick = (event) => { event.stopPropagation(); cleanup(); resolve("retry"); };
    titleBtn.onclick = (event) => { event.stopPropagation(); cleanup(); resolve("title"); };
  });
}

// ★進行中の戦闘・BGM・各種オーバーレイを片付けてから、タイトル画面を出す
function returnToTitleScreen() {
  if (typeof battleState !== "undefined" && battleState) {
    battleState = null;
    if (typeof hideBattleHud === "function") hideBattleHud();
  }
  if (typeof stopScenarioBGM === "function") stopScenarioBGM({ fadeMs: 300 });
  if (typeof closeScenarioBuildMode === "function") closeScenarioBuildMode();
  if (typeof closeAdventureMap === "function") closeAdventureMap();
  if (typeof showTitleScreen === "function") showTitleScreen(); // titlescreen.js
}

// レベルアップ・新スキル習得があれば、まとめてメッセージで知らせる（battle.js・questboard.jsから呼ばれる）
async function announceLevelUpIfAny(levelResult) {
  if (!levelResult || !levelResult.leveledUp) return;
  
  changeSpeaker("");
  await displayMessage(`レベルが上がった！ Lv.${levelResult.previousLevel} → Lv.${levelResult.newLevel}`);
  
  for (const skill of levelResult.newSkills) {
    await displayMessage(`新しいスキル「${skill.name}」を習得した！`);
  }
}

// 強さタブ：レベル・ランク・基本ステータス・魅力などを一覧で描画する
function renderStrengthTab() {
  const container = document.getElementById("strength-list");
  if (!container || !player) return;
  
  container.innerHTML = "";
  
  const effective = getEffectiveStats();
  const equipBonus = getEquipmentBonus();
  
  const rows = [
    { label: "職業", value: player.class },
    { label: "レベル", value: player.level },
    { label: "経験値", value: `${player.exp} / ${expNeededForLevel(player.level)}` },
    { label: "ランク", value: player.rank },
    { label: "HP", value: `${player.gauges.hp.current} / ${player.gauges.hp.max}` },
    { label: "SP", value: `${player.gauges.sp.current} / ${player.gauges.sp.max}` },
    { label: "攻撃力", value: equipBonus.atk > 0 ? `${effective.atk}（基礎${player.stats.atk}+装備${equipBonus.atk}）` : effective.atk },
    { label: "素早さ", value: player.stats.agi },
    { label: "スキルパワー", value: player.stats.skillPower },
    { label: "運", value: player.stats.luck },
    { label: "魅力", value: player.stats.charm },
    { label: "武器", value: getEquippedItemData("武器") ? getEquippedItemData("武器").master.name : "（なし）" },
    { label: "胴装備", value: getEquippedItemData("胴") ? getEquippedItemData("胴").master.name : "（なし）" },
    { label: "盾", value: getEquippedItemData("盾") ? getEquippedItemData("盾").master.name : "（なし）" }
  ];
  
  if (player.class === "魔法少女") {
    rows.splice(1, 0, { label: "変身状態", value: player.magicalGirlTransformed ? "変身中" : "未変身" });
  }
  
  for (let row of rows) {
    const rowEl = document.createElement("div");
    rowEl.className = "strength-row";
    
    const labelEl = document.createElement("span");
    labelEl.className = "strength-label";
    labelEl.textContent = row.label;
    
    const valueEl = document.createElement("span");
    valueEl.className = "strength-value";
    valueEl.textContent = row.value;
    
    rowEl.appendChild(labelEl);
    rowEl.appendChild(valueEl);
    container.appendChild(rowEl);
  }
}

// 現在カーソルが乗っているインベントリのマス番号
let selectedInventoryIndex = 0;

// カーソルを上下左右に移動する（グリッドの端では止まる）
function moveInventorySelection(key) {
  const row = Math.floor(selectedInventoryIndex / GRID_COLS);
  const col = selectedInventoryIndex % GRID_COLS;
  
  let newRow = row;
  let newCol = col;
  
  if (key === "ArrowUp") newRow = Math.max(0, row - 1);
  else if (key === "ArrowDown") newRow = Math.min(GRID_ROWS - 1, row + 1);
  else if (key === "ArrowLeft") newCol = Math.max(0, col - 1);
  else if (key === "ArrowRight") newCol = Math.min(GRID_COLS - 1, col + 1);
  
  selectedInventoryIndex = newRow * GRID_COLS + newCol;
  updateInventorySelectionHighlight();
  
  // ★カーソルを動かしたら詳細パネルはいったん閉じる。開いたままだと、パネルに表示されている
  //   アイテムと実際にZキーで操作される対象（カーソル位置のアイテム）がズレてしまうため
  if (isItemDetailOpen) closeItemDetail();
}

// 今カーソルが乗っているマスに「selected」クラスをつけて光らせる（他は外す）
function updateInventorySelectionHighlight() {
  const slotEls = document.querySelectorAll('#inventory-grid .inventory-slot');
  slotEls.forEach((el, i) => {
    el.classList.toggle('selected', i === selectedInventoryIndex);
  });
  // カーソルが画面外に出ないよう、必要な時だけスクロールする
  const currentEl = slotEls[selectedInventoryIndex];
  if (currentEl) currentEl.scrollIntoView({ block: "nearest" });
}

// 詳細パネルが今開いているかどうか
let isItemDetailOpen = false;

// カテゴリID→表示用の日本語名
const CATEGORY_LABELS = {
  herb: "薬草",
  potion: "ポーション",
  material: "魔物素材",
  weapon: "武器",
  armor: "防具",
  misc: "その他"
};

// Zキー（決定）：今カーソルが乗っているアイテムの詳細パネルを開く。
// ★詳細パネルが既に開いている状態でもう一度押すと、画面の「使う」ボタンと同じ動作をする
//   （moveInventorySelection側でカーソルを動かすたびに詳細パネルを閉じているので、
//   ここで開いている＝今表示中のアイテムがカーソル上のアイテムと必ず一致している）
function decideInventorySelection() {
  const slot = inventorySlots[selectedInventoryIndex];
  if (!slot) return; // 空きマスなら何もしない
  
  if (isItemDetailOpen) {
    const master = ITEM_MASTER[slot.itemId];
    const isUsable = master && master.params && (master.params.回復量 > 0 || master.params.SP回復量 > 0 || master.params.疲労回復量 > 0 || master.params.眠気軽減割合 > 0 || master.params.解毒 || master.params.帰還);
    const inBattle = typeof battleState !== "undefined" && !!battleState;
    if (isUsable && !inBattle) {
      useItemFromInventoryTab(slot.itemId, master);
    }
    return;
  }
  
  showItemDetail(slot);
}

// Xキー（戻る）：詳細パネルが開いていればそれを閉じる。開いていなければカーソルを先頭に戻す
function cancelInventorySelection() {
  if (isItemDetailOpen) {
    closeItemDetail();
    return;
  }
  selectedInventoryIndex = 0;
  updateInventorySelectionHighlight();
}

// アイテム詳細パネルを開いて中身を描画する
function showItemDetail(slot) {
  const panel = document.getElementById("item-detail-panel");
  if (!panel) return;
  
  const master = getEffectiveItemMaster(slot) || ITEM_MASTER[slot.itemId]; // player.js（サビ取り等の個体ごとの上書きも反映）
  if (!master) return;
  
  panel.innerHTML = "";
  
  const header = document.createElement("div");
  header.className = "item-detail-header";
  
  const nameEl = document.createElement("span");
  nameEl.className = "item-detail-name";
  nameEl.textContent = master.name;
  
  const rankEl = document.createElement("span");
  rankEl.className = "item-detail-rank";
  rankEl.textContent = `ランク: ${master.rank}`;
  
  header.appendChild(nameEl);
  header.appendChild(rankEl);
  panel.appendChild(header);
  
  const categoryEl = document.createElement("p");
  categoryEl.className = "item-detail-category";
  categoryEl.textContent = CATEGORY_LABELS[master.category] || master.category;
  panel.appendChild(categoryEl);
  
  const descEl = document.createElement("p");
  descEl.className = "item-detail-description";
  descEl.textContent = master.description;
  panel.appendChild(descEl);
  
  const pricesEl = document.createElement("div");
  pricesEl.className = "item-detail-prices";
  const listedEl = document.createElement("p");
  listedEl.textContent = `定価: ${master.listedPrice}陳`;
  const trueEl = document.createElement("p");
  // 鑑定済みでなければ真価は隠す（お宝鑑定団の「なんでも鑑定」で見抜くまでは？？？表示）
  trueEl.textContent = slot.appraised ? `真価: ${master.trueValue}陳` : "真価: ？？？（未鑑定）";
  pricesEl.appendChild(listedEl);
  pricesEl.appendChild(trueEl);
  panel.appendChild(pricesEl);
  
  if (slot.quantity > 1) {
    const qtyEl = document.createElement("p");
    qtyEl.className = "item-detail-quantity";
    qtyEl.textContent = `所持数: ${slot.quantity}`;
    panel.appendChild(qtyEl);
  }
  
  const paramsEl = document.createElement("div");
  paramsEl.className = "item-detail-params";
  for (const key in master.params) {
    const p = document.createElement("p");
    // ★このマスだけのランダム変位（statBonus）があれば、基本値に上乗せして「合計値」を表示する
    const hasBonus = slot.statBonus && slot.statBonus.statKey === key;
    // ★個体差(statBonus)が乗っている項目だけ、合計が0以下にならないようフロアをかける。
    //   それ以外の項目（装備部位や回復量など）はmaster.paramsの値をそのまま表示する
    const displayValue = hasBonus ? getDisplayEquipmentStatTotal(master.params[key], slot.statBonus.amount) : master.params[key];
    p.textContent = `${key}: ${displayValue}`;
    // ★この個体の変位が最大値（+20、お宝鑑定団なら+40）を引いていたら、そのステータス行を黄文字にする
    if (hasBonus && slot.statBonus.amount === slot.statBonus.maxRange) {
      p.classList.add("item-stat-max");
    }
    paramsEl.appendChild(p);
  }
  panel.appendChild(paramsEl);
  
  // ★回復量・疲労回復量のいずれかを持つアイテム（薬草・ポーションなど）は、戦闘中でなくてもここから使える
  const isUsable = master.params && (master.params.回復量 > 0 || master.params.SP回復量 > 0 || master.params.疲労回復量 > 0 || master.params.眠気軽減割合 > 0 || master.params.解毒 || master.params.帰還);
  if (isUsable) {
    const useBtn = document.createElement("button");
    const inBattle = typeof battleState !== "undefined" && !!battleState;
    useBtn.className = "item-detail-use-btn" + (inBattle ? " item-detail-use-btn-disabled" : "");
    useBtn.textContent = inBattle ? "戦闘中は「たたかう→道具」から" : "使う";
    useBtn.onclick = (event) => {
      event.stopPropagation();
      useItemFromInventoryTab(slot.itemId, master);
    };
    panel.appendChild(useBtn);
  }
  
  const hintEl = document.createElement("p");
  hintEl.className = "item-detail-hint";
  hintEl.textContent = isUsable ? "Zキーで使う／Xキーで閉じる" : "Xキーで閉じる";
  panel.appendChild(hintEl);
  
  panel.classList.add("active");
  isItemDetailOpen = true;
}

// アイテム詳細パネルの「使う」から、回復アイテムをその場で使う（戦闘中でなくても使える）
// ★戦闘中は、ターン消費やメッセージ進行がバトル側の処理と競合してしまうため、
//   代わりにバトルメニューの「たたかう→道具」を使ってもらう案内だけ出す
// 回復系アイテムの効果（HP回復・疲労度軽減）をまとめて適用し、結果メッセージの文言を組み立てる。
// ★インベントリタブの「使う」・戦闘中の「道具」の両方から共通で使う（battle.js からも呼ぶ）
// ★状態異常の種類ごとの日本語名（アイテムの効果メッセージ表示用）
const STATUS_AILMENT_LABELS_JA = {
  poison: "毒", dullPain: "鈍痛", stun: "スタン", paralyze: "麻痺", confuse: "混乱",
  burn: "火傷", atkDown: "攻撃力低下", defDown: "防御力低下", accDown: "命中率低下"
};

// ★divisor：全員に使った時、仲間の人数で回復量を割るための割り算係数（要望対応）。
//   1個の道具で全員がまるまる回復量ぶん治ってしまうと、人数が多いほど道具の価値が跳ね上がってしまうため、
//   「全員」を選んだ時だけ、HP/SP回復量を対象人数で割る（疲労・眠気軽減・状態異常治療は元々自分専用なので割らない）
function applyHealingItemEffect(master, targetUnit, divisor = 1) {
  const unit = targetUnit || player;
  const parts = [];
  const safeDivisor = Math.max(1, divisor);
  // ★バグ修正：「蘇生」パラメータを持つアイテムでも、ここでrevivesを常にfalseのままapplyHealToUnitへ
  //   渡していたため、戦闘不能の仲間を選んでも一切蘇生できなかった（HPが0のまま変化無し、と表示されていた）
  const revives = !!(master.params && master.params.蘇生);
  const wasDown = unit !== player && !unit.alive;
  const healAmount = Math.max(0, Math.round((master.params.回復量 || 0) / safeDivisor));
  if (healAmount > 0) {
    const healed = applyHealToUnit(unit, "hp", healAmount, false, revives); // player.js
    if (healed > 0) parts.push(`HPが${healed}回復した`);
  }
  const spAmount = Math.max(0, Math.round((master.params.SP回復量 || 0) / safeDivisor));
  if (spAmount > 0) {
    const healed = applyHealToUnit(unit, "sp", spAmount, false, revives); // player.js
    if (healed > 0) parts.push(`SPが${healed}回復した`);
  }
  if (revives && wasDown && unit.alive) parts.unshift("目を覚ました"); // ★要望対応：蘇生できた時は、他の回復メッセージより先に知らせる
  
  // ★疲労度・眠気は主人公だけが持つゲージなので、対象が自分の時だけ適用する
  if (unit === player) {
    const fatigueAmount = master.params.疲労回復量 || 0;
    if (fatigueAmount > 0) {
      changeGauge("fatigue", -fatigueAmount);
      parts.push(`疲労度が${fatigueAmount}下がった`);
    }
    const sleepinessRatio = master.params.眠気軽減割合 || 0;
    if (sleepinessRatio > 0 && player.gauges.sleepiness) {
      const sleepinessAmount = Math.round(player.gauges.sleepiness.max * sleepinessRatio);
      changeGauge("sleepiness", -sleepinessAmount);
      parts.push(`眠気が${Math.round(sleepinessRatio * 100)}%軽減した`);
    }
  }
  
  // ★状態異常を治す（複数指定可。"all"を含んでいれば、全ての状態異常を一度に治す）
  //   古い「解毒」だけのアイテムも、そのまま毒を治すものとして扱う（後方互換）
  //   ※状態異常システムは今のところ主人公だけが持つため、対象が自分の時だけ適用する
  if (unit === player) {
    const curesStatus = Array.isArray(master.params.curesStatus) ? master.params.curesStatus
      : (master.params.解毒 ? ["poison"] : []);
    if (curesStatus.includes("all")) {
      if (typeof cureStatusAilment === "function" && cureStatusAilment("all")) {
        parts.push("状態異常が全て治った");
      }
    } else {
      curesStatus.forEach(kind => {
        if (typeof cureStatusAilment === "function" && cureStatusAilment(kind)) {
          parts.push(`${STATUS_AILMENT_LABELS_JA[kind] || kind}が治った`);
        }
      });
    }
  }
  
  return { message: parts.length > 0 ? parts.join("。") + "。" : "" };
}

// ★回復技・回復アイテムを使う前に、対象（自分／仲間の誰か／全員）を選ばせる。
//   仲間が一人もいなければ、聞かずに自動的に自分を対象にする（従来通りの動作）
//   includeDownedInAll: 「完全支援」など蘇生技の時だけtrue。trueだと「全員」に戦闘不能の仲間も含める
// ★includeAllOption：「全員」の選択肢を出すかどうか（要望対応：単体指定の回復技では出さない）
async function pickHealTargetsInteractive(includeDownedInAll = false, includeAllOption = true) {
  const choices = getHealTargetChoices(undefined, includeAllOption); // player.js
  if (choices.length === 0) return resolveHealTargetUnits(undefined, includeDownedInAll); // player.js（仲間なし＝[player]を即返す）
  choices.push({ text: "やめる", next: "cancel", isBack: true });
  // ★allowSubFocus: 戦闘中（tab-main）だけでなく、タブ（インベントリ・スキル等）からその場で回復を使った時も、
  //   choice-boxがメイン画面側へロックされず、その場で選べるようにする
  const picked = await displayChoices(choices, 0, { allowSubFocus: true });
  if (picked.next === "cancel") return null;
  return resolveHealTargetUnits(picked.next, includeDownedInAll); // player.js
}

// ★回復アイテムを、対象を選んでから使う（結果メッセージは対象ごとにまとめて返す）
async function performItemHealWithTargetSelection(master) {
  // ★要望対応：「蘇生」パラメータを持つアイテムは、「全員」を選んだ時に戦闘不能の仲間も対象へ含める
  //   （そうでないアイテムは、今まで通り「全員」＝生きている仲間だけが対象）
  const revives = !!(master.params && master.params.蘇生);
  const targets = await pickHealTargetsInteractive(revives);
  if (!targets) return null; // ★「やめる」を選んだ
  // ★要望対応：「全員」を選んで複数人が対象になった時は、回復量を対象人数で割る
  //   （そうしないと、1個の道具で全員がまるまる回復量ぶん治ってしまい、人数が多いほど得になってしまう）
  const divisor = targets.length;
  const messageParts = [];
  targets.forEach(unit => {
    const effect = applyHealingItemEffect(master, unit, divisor);
    if (effect.message) messageParts.push(`${getHealTargetDisplayName(unit)}：${effect.message}`); // player.js
  });
  return messageParts.length > 0 ? messageParts.join(" ") : "特に変化は無かった。";
}

// ★回復技を、対象を選んでから使う（skill.gaugeが"sp"ならSP回復、それ以外はHP回復として扱う）
// ★skill.revivesがtrueの技（完全支援など）だけ、戦闘不能の仲間を選ぶと蘇生させられる
// ★skill.healBothGaugesがtrueの技（快感シェアリング、元気モリモリ♡フルコース）は、HP・SP両方を回復する
async function performSkillHealWithTargetSelection(skill) {
  // ★「味方全体」「パーティ全員」と説明にある回復技は、対象を選ばせず必ず自分＋生きている仲間全員が対象になる
  //   （例：ハイ・ディスシプリナ、フェアリーブレッシング）
  // ★要望対応：それ以外（単体指定）の回復技は、道具と違って「全員」を選べないようにする。
  //   道具は回復量を人数で割ることで全員選択に対応しているが、技はその仕組みが無いため、
  //   単体指定の技で「全員」を選べてしまうと全員が満額回復してしまい、技の設計（単体/全体）を無視した強さになってしまう
  const targets = skill.partyWide
    ? [player, ...(player.companions || []).filter(c => c.alive)]
    : await pickHealTargetsInteractive(!!skill.revives, false);
  if (!targets) return null;
  const power = getSkillPower(skill);
  const gaugeKey = skill.gauge === "sp" ? "sp" : "hp";
  const messageParts = [];
  targets.forEach(unit => {
    const parts = [];
    const wasDown = unit !== player && !unit.alive;
    const healed = applyHealToUnit(unit, gaugeKey, power, !!skill.cleanse, !!skill.revives); // player.js
    if (wasDown && unit.alive) parts.push("目を覚ました");
    if (healed > 0) parts.push(`${gaugeKey === "sp" ? "SP" : "HP"}が${healed}回復した`);
    if (skill.healBothGauges) {
      const otherKey = gaugeKey === "sp" ? "hp" : "sp";
      const healedOther = applyHealToUnit(unit, otherKey, power, false, false); // player.js
      if (healedOther > 0) parts.push(`${otherKey === "sp" ? "SP" : "HP"}が${healedOther}回復した`);
    }
    if (skill.cleanse && unit === player) parts.push("状態異常が全て治った");
    // ★回復技に自己バフが付いている場合は、実際に回復した相手（＝targets）にも同じバフをかける。
    //   以前はここが無く、パーティ全体を回復する技でもバフはプレイヤー自身にしか付かなかった。
    //   ハイ・ディスシプリナのように自己バフを2つ同時に持つ技もあるので、selfBuff2もあわせて適用する
    const appliedLabels = (unit === player) ? applyAllSelfBuffsToPlayer(skill) : applyAllSelfBuffsToCompanion(unit, skill); // battle.js
    if (appliedLabels.length > 0) parts.push(`${appliedLabels.join("・")}状態になった`);
    if (parts.length > 0) messageParts.push(`${getHealTargetDisplayName(unit)}：${parts.join("。")}`);
  });
  return messageParts.length > 0 ? messageParts.join(" ") : "特に変化は無かった。";
}

async function useItemFromInventoryTab(itemId, master) {
  await runWithLocationMenuHidden(async () => {
    if (typeof battleState !== "undefined" && battleState) {
      changeSpeaker("");
      await displayMessage("戦闘中は、「たたかう」→「道具」から使ってほしいようだ。", { allowSubFocus: true });
      return;
    }
    
    if (master.params && master.params.帰還) {
      removeItem(itemId, 1);
      closeItemDetail();
      renderInventory();
      changeSpeaker("");
      await displayMessage(`「${master.name}」を使った！ 一瞬の浮遊感とともに、気づけば村まで戻ってきていた。`);
      if (typeof battleState !== "undefined") battleState = null; // ★念のため（本来ここには戦闘中は来ない）
      if (typeof stopScenarioBGM === "function") stopScenarioBGM({ fadeMs: 300 }); // bgm.js
      openTownMenu(); // town.js
      return;
    }
    
    const resultMessage = await performItemHealWithTargetSelection(master);
    if (resultMessage === null) return; // ★対象選択で「やめる」を選んだ：何も消費しない
    removeItem(itemId, 1);
    renderStatusHUD();
    
    closeItemDetail();
    renderInventory();
    
    changeSpeaker("");
    await displayMessage(`「${master.name}」を使った！ ${resultMessage}`, { allowSubFocus: true });
    renderInventory();
  });
}

// アイテム詳細パネルを閉じる
function closeItemDetail() {
  const panel = document.getElementById("item-detail-panel");
  if (panel) panel.classList.remove("active");
  isItemDetailOpen = false;
}

// インベントリのグリッド（240マス）を、今のinventorySlotsの中身に合わせて描画する
function renderInventory() {
  const grid = document.getElementById("inventory-grid");
  if (!grid) return;
  
  grid.innerHTML = "";
  
  for (let i = 0; i < GRID_SIZE; i++) {
    const slot = inventorySlots[i];
    const slotDiv = document.createElement("div");
    slotDiv.className = "inventory-slot";
    
    if (slot) {
      const master = getEffectiveItemMaster(slot); // player.js（サビ取り等の個体ごとの上書きも反映）
      
      const nameSpan = document.createElement("span");
      nameSpan.className = "item-name";
      // 鑑定済みでなければ名前を「？」でぼかす、みたいな演出もここに足せる
      nameSpan.textContent = master ? master.name : "？？？";
      slotDiv.appendChild(nameSpan);
      
      // スタック数が2個以上の時だけ個数バッジを表示
      if (slot.quantity > 1) {
        const qtySpan = document.createElement("span");
        qtySpan.className = "item-qty";
        qtySpan.textContent = slot.quantity;
        slotDiv.appendChild(qtySpan);
      }
      
      // ★主人公や仲間が今まさに装備しているアイテムには、そうと分かるよう「誰が」まで含めてタグを出す（要望対応）
      if (typeof describeInstanceHolderName === "function") { // player.js
        const holderName = describeInstanceHolderName(slot.instanceId);
        if (holderName) {
          const equippedTag = document.createElement("span");
          equippedTag.className = "item-equipped-tag";
          equippedTag.textContent = `装備中（${holderName}）`;
          slotDiv.appendChild(equippedTag);
        }
      }
      
      // クリックでもカーソルをそのマスに合わせて詳細パネルを開く
      slotDiv.onclick = (event) => {
        event.stopPropagation(); // ★このクリックが他の反応（テキスト送りなど）に伝わらないようにする
        selectedInventoryIndex = i;
        updateInventorySelectionHighlight();
        showItemDetail(slot);
      };
    } else {
      slotDiv.classList.add("empty");
    }
    
    grid.appendChild(slotDiv);
  }
  
  updateInventorySelectionHighlight(); // 描画し直した後もカーソル位置を反映する
}

// HTMLタグに対応した、賢い1文字ずつ出力するタイピング関数
// ★クリック・決定キー（skipTypingRequested）や早送りモード（fastForwardMode）の時は、
//   残りの文章を一気に表示する
// ★myToken：ロードで新しいセッションが始まっていたら、途中で何もせず止まる（古い進行を凍結する）
// ★メッセージウィンドウに収まりきらない長い文章の場合、自動的に文字サイズを少しずつ縮めて
//   収まるようにする（要望対応）。表示を始める前に、完成後の文章の高さを一度測ってから決める
//   （タイピング中に縮んでガタつくのを防ぐため）
function fitMessageWindowText(element, text) {
  const windowEl = element.closest(".message-window");
  if (!windowEl) return;
  
  element.style.fontSize = ""; // ★まずCSS本来のサイズに戻してから測る（前回のメッセージで縮めた値を引きずらないように）
  element.style.maxHeight = ""; // ★バグ修正：前回の計測で付けたmaxHeight/overflowが残ったままだと、
  element.style.overflow = "";  //   2回目以降の測定がその制限に引っ張られて不正確になっていた
  const baseFontSize = parseFloat(window.getComputedStyle(element).fontSize) || 15;
  const minFontSize = 10; // ★これ以上は読みづらくなるので縮めない
  
  // ★メッセージウィンドウの中で、このテキスト要素が実際に使える高さを計算する
  //   （ウィンドウの高さ − 上下パディング − 話者名ぶんの高さ）
  const windowStyle = window.getComputedStyle(windowEl);
  const paddingV = parseFloat(windowStyle.paddingTop || 0) + parseFloat(windowStyle.paddingBottom || 0);
  const speakerEl = windowEl.querySelector("#speaker-name");
  // ★offsetHeightはmarginを含まないため、speakerEl・element自身の上下marginぶんも別途差し引く
  const speakerStyle = speakerEl ? window.getComputedStyle(speakerEl) : null;
  const speakerHeight = speakerEl ? speakerEl.offsetHeight + (speakerStyle ? parseFloat(speakerStyle.marginTop || 0) + parseFloat(speakerStyle.marginBottom || 0) : 0) : 0;
  const elementStyle = window.getComputedStyle(element);
  const elementMarginV = parseFloat(elementStyle.marginTop || 0) + parseFloat(elementStyle.marginBottom || 0);
  // ★スマホは機種・ブラウザによって行の実測高さに数px程度の誤差が出ることがあるため、
  //   ぎりぎりを攻めて「あと1px足りず見切れる」事態を避けるための安全マージン
  const SAFETY_MARGIN_PX = 6;
  const availableHeight = windowEl.clientHeight - paddingV - speakerHeight - elementMarginV - SAFETY_MARGIN_PX;
  if (!(availableHeight > 0)) return;
  
  const originalHTML = element.innerHTML;
  element.innerHTML = text; // ★完成後の文章をまるごと流し込んで、高さがはみ出すかどうかを判定する
  element.style.maxHeight = availableHeight + "px";
  element.style.overflow = "hidden"; // ★万一縮めても収まりきらなかった場合の保険（見た目が崩れるより見切れる方がまし）
  
  let fontSize = baseFontSize;
  element.style.fontSize = fontSize + "px";
  while (element.scrollHeight > availableHeight && fontSize > minFontSize) {
    fontSize -= 1;
    element.style.fontSize = fontSize + "px";
  }
  
  element.innerHTML = originalHTML; // ★判定用に流し込んだ内容を戻す（この後typeTextが1文字ずつ組み立てていく）
}

// ★話の文中に含まれる改行(\n)を<br>に変換する。
//   以前はここを素通しにしていたため、シナリオ編集で改行して書いた文章も、
//   ゲーム画面上ではHTMLの仕様で改行が無視されて1行につながってしまっていた。
function convertLineBreaksForDisplay(text) {
  if (typeof text !== "string") return text;
  return text.replace(/\r\n|\r|\n/g, "<br>");
}

async function typeText(element, text, myToken = activeSessionToken) {
  element.innerHTML = ""; // 一度中身を空にする
  isTyping = true;
  skipTypingRequested = false;
  
  text = convertLineBreaksForDisplay(text); // ★文中の改行(\n)をゲーム画面でも改行として反映させる
  
  fitMessageWindowText(element, text); // ★長文なら自動的に文字サイズを縮めて収める（要望対応）
  
  // 1. 一時的なコンテナを作って、HTMLとして解析させる
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = text;
  
  // 2. 解析した要素（文字やspanタグなど）を1つずつ取り出して処理する
  const nodes = Array.from(tempDiv.childNodes);
  
  // ★〈重要〉以前は画面側の element に直接「+=」で文字を継ぎ足していたが、これだと
  //   ロード直後などでまだ完全には止まっていない「古いセッションの文字送り」が
  //   タイマーの遅延で後から少しだけ動いてしまった時、今表示中の別のメッセージと
  //   文字単位で混ざって文字化けする不具合があった。
  //   ここでは自分専用の作業用コンテナ(build)にだけ組み立てて、都度その内容を
  //   まるごとelementに反映（＝置き換え）するようにする。こうすれば、たとえ他の
  //   typeText呼び出しが同時に同じelementへ書き込んでも、お互いの文字が入り乱れる
  //   ことはなく（片方の完全な内容で上書きされるだけになり）、次のチェックで
  //   古い方は確実に打ち切られる
  const build = document.createElement("div");
  
  for (let node of nodes) {
    if (activeSessionToken !== myToken) throw new Error("stale session: aborting orphaned scenario chain"); // ★古いセッションは即座に打ち切る（黙って続行すると新しいセッションと衝突するため）
    
    // ★既にスキップ・早送りが要求されていたら、このノードはまるごと即表示する
    if (skipTypingRequested || fastForwardMode) {
      build.appendChild(node.cloneNode(true));
      element.innerHTML = build.innerHTML;
      continue;
    }
    
    if (node.nodeType === Node.TEXT_NODE) {
      // ◆ 普通の文字の場合：1文字ずつ流す
      const full = node.textContent;
      const textNode = document.createTextNode("");
      build.appendChild(textNode);
      for (let i = 0; i < full.length; i++) {
        if (activeSessionToken !== myToken) throw new Error("stale session: aborting orphaned scenario chain");
        if (skipTypingRequested || fastForwardMode) {
          textNode.textContent += full.slice(i); // 残り全部を一気に流し込む
          element.innerHTML = build.innerHTML;
          break;
        }
        textNode.textContent += full[i];
        element.innerHTML = build.innerHTML;
        await wait(textSpead);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // ◆ HTMLタグ（spanなど）の場合：
      // まず空のタグを作業用コンテナ側に追加し、その中身を1文字ずつタイピングする
      const clonedElement = node.cloneNode(false); // タグとその属性（classなど）だけ複製
      clonedElement.innerHTML = ""; // 中身は空にしておく
      build.appendChild(clonedElement);
      
      const full = node.textContent;
      for (let i = 0; i < full.length; i++) {
        if (activeSessionToken !== myToken) throw new Error("stale session: aborting orphaned scenario chain");
        if (skipTypingRequested || fastForwardMode) {
          clonedElement.innerHTML += full.slice(i);
          element.innerHTML = build.innerHTML;
          break;
        }
        clonedElement.innerHTML += full[i];
        element.innerHTML = build.innerHTML;
        await wait(textSpead);
      }
    }
  }
  
  isTyping = false;
}
// ===== ゲーム内の確認/アラートダイアログ（window.confirm・window.alertの代わり） =====
// ★ブラウザ標準のconfirm/alertは見た目がゲームと合わず、キー操作にも組み込めないため、
//   同じ体裁のオーバーレイをこちらで用意する。

// ダイアログが今開いているかどうか（開いている間、他の画面のキー操作を止めるためのフラグ）
let isGameDialogOpen = false;

// 確認ダイアログを開く。「はい」ならtrue、「いいえ」ならfalseでresolveするPromiseを返す
function showGameConfirm(message) {
  return new Promise(resolve => {
    const overlay = document.getElementById("confirm-dialog-overlay");
    const msgEl = document.getElementById("confirm-dialog-message");
    const yesBtn = document.getElementById("confirm-dialog-yes");
    const noBtn = document.getElementById("confirm-dialog-no");
    if (!overlay || !msgEl || !yesBtn || !noBtn) {
      resolve(window.confirm(message)); // 万が一要素が無い時の保険
      return;
    }
    
    msgEl.textContent = message;
    overlay.classList.remove("hidden");
    isGameDialogOpen = true;
    
    let cursorIndex = 1; // ★デフォルトは「いいえ」側にカーソル（誤ってセーブ上書き/ロードしないよう安全側）
    const buttons = [yesBtn, noBtn];
    
    const applyCursor = () => {
      buttons.forEach((btn, i) => btn.classList.toggle("cursor", i === cursorIndex));
    };
    applyCursor();
    
    const cleanup = () => {
      overlay.classList.add("hidden");
      isGameDialogOpen = false;
      yesBtn.onclick = null;
      noBtn.onclick = null;
      window.removeEventListener("keydown", handleKey);
    };
    
    yesBtn.onclick = (event) => { event.stopPropagation(); cleanup(); resolve(true); };
    noBtn.onclick = (event) => { event.stopPropagation(); cleanup(); resolve(false); };
    
    const handleKey = (event) => {
      if (event.repeat) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        cursorIndex = cursorIndex === 0 ? 1 : 0;
        applyCursor();
      } else if (KEY_CONFIG.decideKeys.includes(event.key)) {
        event.preventDefault();
        const result = cursorIndex === 0;
        cleanup();
        resolve(result);
      } else if (KEY_CONFIG.cancelKeys.includes(event.key)) {
        event.preventDefault();
        cleanup();
        resolve(false); // ★Xキーは常に「いいえ」扱い（安全側に倒す）
      }
    };
    window.addEventListener("keydown", handleKey);
  });
}

// アラートダイアログを開く。OKが押されたらresolveするPromiseを返す
function showGameAlert(message) {
  return new Promise(resolve => {
    const overlay = document.getElementById("alert-dialog-overlay");
    const msgEl = document.getElementById("alert-dialog-message");
    const okBtn = document.getElementById("alert-dialog-ok");
    if (!overlay || !msgEl || !okBtn) {
      window.alert(message); // 万が一要素が無い時の保険
      resolve();
      return;
    }
    
    msgEl.textContent = message;
    overlay.classList.remove("hidden");
    isGameDialogOpen = true;
    
    const cleanup = () => {
      overlay.classList.add("hidden");
      isGameDialogOpen = false;
      okBtn.onclick = null;
      window.removeEventListener("keydown", handleKey);
    };
    
    okBtn.onclick = (event) => { event.stopPropagation(); cleanup(); resolve(); };
    
    const handleKey = (event) => {
      if (event.repeat) return;
      if (KEY_CONFIG.decideKeys.includes(event.key) || KEY_CONFIG.cancelKeys.includes(event.key)) {
        event.preventDefault();
        cleanup();
        resolve();
      }
    };
    window.addEventListener("keydown", handleKey);
  });
}