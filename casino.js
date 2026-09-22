// ===================================================================
// ===== カジノ（施設編集タブで追加できる「カジノ系」施設） =====
// ===== 丁半博打・ルーレット・スロットの3種類の賭け事で遊べる    =====
// ===================================================================

let casinoFacility = null;      // 今開いているカジノ施設のデータ（scenariobuild.jsのfacility）
let casinoReturnTo = null;      // 「戻る」で呼ぶ関数（村メニュー、または拠点の施設一覧）

function prepareCasinoConversationFocus() {
  controlFocus = "main";
  if (typeof updateControlFocusIndicator === "function") updateControlFocusIndicator();
  hideLocationMenu();
}

// カジノの入り口。openCustomFacility（town.js）から呼ばれる
function openCasino(facility, returnTo) {
  casinoFacility = facility;
  casinoReturnTo = typeof returnTo === "function" ? returnTo : openTownMenu;
  showCasinoMenu();
}

function showCasinoMenu() {
  changeSpeaker(casinoFacility.name || "カジノ");
  showLocationMenu([
    { label: "丁半博打で遊ぶ", action: () => startDiceGame() },
    { label: "ルーレットで遊ぶ", action: () => startRouletteGame() },
    { label: "スロットで遊ぶ", action: () => startSlotGame() },
    { label: "戻る", action: () => casinoReturnTo() }
  ], casinoFacility.name || "カジノ");
}

// ===== 賭け金選択（共通） =====
// pickQuantity（town.js）の±UIをそのまま流用し、「◯個」ではなく「◯陳」の金額選択にする
function getCasinoMinBet() {
  return Math.max(1, casinoFacility.minBet != null ? casinoFacility.minBet : 10);
}

function getCasinoMaxBet() {
  const facilityMax = Math.max(getCasinoMinBet(), casinoFacility.maxBet != null ? casinoFacility.maxBet : 1000);
  return Math.min(facilityMax, gold); // 所持金以上は賭けられない
}

async function pickCasinoBet(label) {
  const minBet = getCasinoMinBet();
  if (gold < minBet) {
    changeSpeaker(casinoFacility.name || "カジノ");
    await displayMessage(`すまないが、最低${minBet}陳は無いと賭けられないよ……`);
    return 0;
  }
  
  const maxBet = getCasinoMaxBet();
  // ★要望対応：以前は上限額の桁に応じて刻み幅を自動でひとつ選ぶだけで、その場で変更できなかった。
  //   Q/Eキーまたは専用ボタンで、1回の±で増減する額（1／10／100／1000）をその場で切り替えられるようにした
  const defaultStep = maxBet >= 2000 ? 100 : (maxBet >= 200 ? 10 : 1);
  const stepOptions = [1, 10, 100, 1000].filter(s => s <= maxBet);
  
  const bet = await pickQuantity(maxBet, label, {
    min: minBet,
    step: defaultStep,
    stepOptions,
    formatValue: v => `${v}陳`,
    formatLabel: max => `${label}（所持金${gold}陳／最大${max}陳）`,
    cancelValue: 0
  });
  return bet;
}

// ===== ①丁半博打（サイコロ2つの合計が偶数＝丁／奇数＝半） =====
async function startDiceGame() {
  prepareCasinoConversationFocus();
  const bet = await pickCasinoBet("丁半博打の賭け金");
  if (bet <= 0) { showCasinoMenu(); return; }
  
  changeSpeaker(casinoFacility.name || "壺振り");
  await displayMessage("さあ張った張った！ 丁と半、どちらに賭ける？");
  
  changeSpeaker("");
  const picked = await displayChoices([
    { text: "丁（合計が偶数）に賭ける", next: "even" },
    { text: "半（合計が奇数）に賭ける", next: "odd" },
    { text: "やめる", next: "cancel", isBack: true }
  ]);
  if (picked.next === "cancel") { showCasinoMenu(); return; }
  
  changeSpeaker(casinoFacility.name || "壺振り");
  await displayMessage("勝負だ……");
  
  const dice1 = 1 + Math.floor(Math.random() * 6);
  const dice2 = 1 + Math.floor(Math.random() * 6);
  const total = dice1 + dice2;
  const resultKey = total % 2 === 0 ? "even" : "odd";
  const resultLabel = resultKey === "even" ? "丁" : "半";
  await displayMessage(`サイコロの目は「${dice1}」と「${dice2}」……合計${total}で「${resultLabel}」だ！`);
  
  if (picked.next === resultKey) {
    changeGold(bet); // 等倍配当：賭け金と同額をそのまま儲けとして獲得
    await displayMessage(`大当たりだ！ ${bet}陳の儲けだ！`);
  } else {
    changeGold(-bet);
    await displayMessage(`残念、外れだ。${bet}陳は没収だな……`);
  }
  renderStatusHUD(); // mainfunc.js
  showCasinoMenu();
}

// ===== ②スロット（3リール・滑らかに回り続けるジャグラー風UI） =====
const CASINO_SLOT_SYMBOLS = [
  { key: "grape", emoji: "🍇", weight: 35, payout: 2 },
  { key: "bell",  emoji: "🔔", weight: 25, payout: 4 },
  { key: "star",  emoji: "⭐", weight: 20, payout: 6 },
  { key: "gem",   emoji: "💎", weight: 12, payout: 10 },
  { key: "seven", emoji: "7",  weight: 8,  payout: 20 }
];

const CASINO_SLOT_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
];

// ★リール演出まわりの定数。CELL_HEIGHTはstyle.cssの.casino-slot-reel-cellの高さと必ず合わせる
const CASINO_SLOT_CELL_HEIGHT = 76;
const CASINO_SLOT_SPIN_SPEED = 0.55;        // px/ms（1マス=76pxを約138msで通過する速さ）
const CASINO_SLOT_BUFFER_CELLS = 8;         // ★見えている範囲より、常にこの数ぶん先まで帯を伸ばしておく
const CASINO_SLOT_STOP_TRANSITION_MS = 550; // ★止める時の「滑らかに減速して着地する」アニメーションの長さ

// ★要望対応：各絵柄の「出現しやすさ」（重み。1マスあたりの抽選比率）を施設ごとに変えられるようにする。
//   施設側でfacility.slotWeights[key]に数値が指定されていればそれを使い、無指定ならCASINO_SLOT_SYMBOLSの既定値を使う。
//   実際に1ライン（3マス）が揃う確率は (重み÷全絵柄の重み合計)^3 になる。管理画面（scenariobuild.js）側で
//   この計算結果を「揃う確率」として別途表示している（以前は重みの数値をそのまま「揃う確率」と誤表示していたための修正）
function getSlotSymbolWeight(symbol) {
  const override = casinoFacility && casinoFacility.slotWeights && casinoFacility.slotWeights[symbol.key];
  return (typeof override === "number" && override > 0) ? override : symbol.weight;
}

function pickWeightedSlotSymbol() {
  const weights = CASINO_SLOT_SYMBOLS.map(s => getSlotSymbolWeight(s));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < CASINO_SLOT_SYMBOLS.length; i++) {
    if (r < weights[i]) return CASINO_SLOT_SYMBOLS[i];
    r -= weights[i];
  }
  return CASINO_SLOT_SYMBOLS[CASINO_SLOT_SYMBOLS.length - 1];
}

// ★要望対応：「？」は使わず、万一symbolが渡されなかった場合も必ず何かしらの絵柄を出す
function getSlotSymbolDisplay(symbol) {
  const s = symbol || CASINO_SLOT_SYMBOLS[0];
  const imagePath = casinoFacility && casinoFacility.slotImages && casinoFacility.slotImages[s.key];
  if (imagePath) return `<img src="${imagePath}" class="casino-slot-symbol-img" alt="${s.key}">`;
  return s.emoji;
}

// ★修正：以前は最初に見つかった1本だけを返していたので、2列同時に揃っても1列分しか
//   判定されなかった。揃っている列を全部集めて返すようにする
function getWinningSlotLines(boardSymbols) {
  const winners = [];
  for (const line of CASINO_SLOT_LINES) {
    const first = boardSymbols[line[0]];
    if (!first) continue;
    const allMatch = line.every(index => boardSymbols[index] && boardSymbols[index].key === first.key);
    if (allMatch) winners.push({ line, symbol: first });
  }
  return winners;
}

// ★要望対応：以前は「2つだけ揃うと掛け金の半分が戻ってくる」小当たりがあったが、廃止する。
//   ライン揃い以外は素直にハズレ扱いにする
function getSlotBoardResult(boardSymbols) {
  const winningLines = getWinningSlotLines(boardSymbols);
  if (winningLines.length > 0) {
    const totalPayout = winningLines.reduce((sum, w) => sum + w.symbol.payout, 0);
    const winningIndexes = Array.from(new Set(winningLines.flatMap(w => w.line)));
    return {
      type: "win",
      symbol: winningLines[0].symbol, // ★1列だけ揃った時の従来の表示に使う
      symbols: winningLines.map(w => w.symbol),
      lineCount: winningLines.length,
      line: winningIndexes,
      payout: totalPayout,
      profit: totalPayout
    };
  }

  return { type: "lose", symbol: null, line: [], payout: 0, profit: 0 };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ★要望対応：揃った際の報酬（配当）を常に一覧で確認できるようにする
function renderCasinoSlotPayoutTable() {
  const container = document.getElementById("casino-slot-payout-table");
  if (!container) return;
  container.innerHTML = "";
  
  const chipRow = document.createElement("div");
  chipRow.className = "casino-slot-payout-chip-row";
  // ★配当の高い絵柄から並べて見やすくする
  const sortedSymbols = [...CASINO_SLOT_SYMBOLS].sort((a, b) => b.payout - a.payout);
  sortedSymbols.forEach(symbol => {
    const chip = document.createElement("div");
    chip.className = "casino-slot-payout-chip";
    const symbolEl = document.createElement("span");
    symbolEl.className = "casino-slot-payout-chip-symbol";
    symbolEl.innerHTML = getSlotSymbolDisplay(symbol);
    chip.appendChild(symbolEl);
    const multiplierEl = document.createElement("span");
    multiplierEl.textContent = `×${symbol.payout}`;
    chip.appendChild(multiplierEl);
    chipRow.appendChild(chip);
  });
  container.appendChild(chipRow);
  
  const note = document.createElement("div");
  note.className = "casino-slot-payout-note";
  note.textContent = "同じ絵柄が3つ揃うと掛け金×倍率が戻ってくる";
  container.appendChild(note);
}

function setSlotLeverPulled(pulled) {
  const lever = document.getElementById("casino-slot-lever");
  if (!lever) return;
  lever.classList.toggle("is-pulled", !!pulled);
}

// ===================================================================
// ===== リール（1列ぶん）を「途切れず滑らかに回り続ける帯」として扱う =====
// ===================================================================
// 帯（strip）は下方向に伸び続けるだけで、ループも巻き戻しもしない。
// 止める時は、帯の一番先に「本当の結果」を3マスぶん追加して、そこにピタッと着地させる。
// ラウンドの最初（renderCasinoSlotIdleBoard）で帯を作り直すので、DOMが際限なく増え続けることはない。
let casinoSlotReels = []; // [{ stripEl, cellCount, offset, spinning }] ×3

function createCasinoSlotReelCell(symbol) {
  const cell = document.createElement("div");
  cell.className = "casino-slot-reel-cell";
  cell.innerHTML = getSlotSymbolDisplay(symbol);
  return cell;
}

// ★見えている範囲＋バッファぶんまで、帯の先に絵柄を継ぎ足しておく
function ensureCasinoSlotReelStripAhead(reel) {
  const neededCells = Math.ceil(reel.offset / CASINO_SLOT_CELL_HEIGHT) + 3 + CASINO_SLOT_BUFFER_CELLS;
  while (reel.cellCount < neededCells) {
    reel.stripEl.appendChild(createCasinoSlotReelCell(pickWeightedSlotSymbol()));
    reel.cellCount++;
  }
}

function renderCasinoSlotIdleBoard() {
  casinoSlotReels.forEach(reel => {
    reel.stripEl.innerHTML = "";
    reel.cellCount = 0;
    reel.offset = 0;
    reel.spinning = false;
    reel.stripEl.style.transition = "none";
    reel.stripEl.style.transform = "translateY(0px)";
    for (let row = 0; row < 3; row++) {
      reel.stripEl.appendChild(createCasinoSlotReelCell(pickWeightedSlotSymbol()));
      reel.cellCount++;
    }
  });
}

function initCasinoSlotReels() {
  casinoSlotReels = [0, 1, 2].map(i => ({
    stripEl: document.getElementById(`casino-slot-reel-strip-${i}`),
    cellCount: 0,
    offset: 0,
    spinning: false
  }));
  renderCasinoSlotIdleBoard();
}

let casinoSlotAnimationRunning = false;
function casinoSlotAnimationLoop(lastTimestamp) {
  return (timestamp) => {
    const dt = lastTimestamp == null ? 0 : (timestamp - lastTimestamp);
    let anySpinning = false;
    casinoSlotReels.forEach(reel => {
      if (!reel.spinning) return;
      anySpinning = true;
      reel.offset += CASINO_SLOT_SPIN_SPEED * dt;
      ensureCasinoSlotReelStripAhead(reel);
      reel.stripEl.style.transform = `translateY(-${reel.offset}px)`;
    });
    if (anySpinning) {
      requestAnimationFrame(casinoSlotAnimationLoop(timestamp));
    } else {
      casinoSlotAnimationRunning = false;
    }
  };
}

function startAllCasinoSlotReelsSpinning() {
  casinoSlotReels.forEach(reel => {
    reel.spinning = true;
    reel.stripEl.style.transition = "none";
  });
  if (!casinoSlotAnimationRunning) {
    casinoSlotAnimationRunning = true;
    requestAnimationFrame(casinoSlotAnimationLoop(null));
  }
}

// ★指定したリールを、finalSymbols=[上段,中段,下段]がぴったり窓に収まるよう滑らかに減速させて止める
function stopCasinoSlotReel(reelIndex, finalSymbols) {
  return new Promise((resolve) => {
    const reel = casinoSlotReels[reelIndex];
    if (!reel) { resolve(); return; }

    // ★帯の一番先に「本当の結果」を3マスぶん追加し、そこへ着地させる
    //   （既に回転中に継ぎ足されているダミーの絵柄ぶんを通り過ぎてから止まるので、自然な減速に見える）
    finalSymbols.forEach(symbol => {
      reel.stripEl.appendChild(createCasinoSlotReelCell(symbol));
      reel.cellCount++;
    });
    const targetOffset = (reel.cellCount - 3) * CASINO_SLOT_CELL_HEIGHT;

    reel.spinning = false; // ★以後はRAFループの対象から外れ、CSSトランジションに任せる

    requestAnimationFrame(() => {
      reel.stripEl.style.transition = `transform ${CASINO_SLOT_STOP_TRANSITION_MS}ms cubic-bezier(0.15, 0.7, 0.3, 1.15)`;
      requestAnimationFrame(() => {
        reel.stripEl.style.transform = `translateY(-${targetOffset}px)`;
      });
    });

    setTimeout(() => {
      reel.offset = targetOffset;
      reel.stripEl.style.transition = "none";
      resolve();
    }, CASINO_SLOT_STOP_TRANSITION_MS + 30);
  });
}

// ★止まった後の盤面（3リール×3段）に対して、揃った列だけ光らせる
function highlightCasinoSlotWinningLine(winningIndexes) {
  casinoSlotReels.forEach((reel, reelIndex) => {
    const cells = Array.from(reel.stripEl.children).slice(-3); // ★今見えている3マス（帯の一番先）
    cells.forEach((cell, row) => {
      const boardIndex = row * 3 + reelIndex; // 0-8のマス番号（CASINO_SLOT_LINESと同じ並び）
      cell.classList.toggle("is-winning", winningIndexes.includes(boardIndex));
    });
  });
}

// ★「やめる」ボタン／Xキーで、いつでも抜け出せるようにする。
//   賭け金選択中（casinoSlotCancelResolver登録中）ならその場で即終了、
//   リールが回っている最中に押した場合は、区切りの良い所（今の掛けの決着後）まで来たら終了する予約フラグを立てる
let casinoSlotCancelResolver = null;
let casinoSlotQuitRequested = false;
let casinoSlotLastBet = null; // ★要望対応：直前に使った掛け金を覚えておき、次回の初期値にする（毎回リセットしない）

function requestCasinoSlotQuit() {
  casinoSlotQuitRequested = true;
  if (casinoSlotCancelResolver) {
    const resolver = casinoSlotCancelResolver;
    casinoSlotCancelResolver = null;
    resolver();
    return;
  }
  // ★回っている最中に押された場合、即座には抜けられないので「予約された」ことだけ分かるようにする
  const quitButton = document.getElementById("casino-slot-quit-btn");
  if (quitButton) {
    quitButton.textContent = "区切りが来次第退店";
    quitButton.disabled = true;
  }
}

async function waitForSlotStopSignal(buttonEl) {
  return new Promise((resolve) => {
    let settled = false;

    const finalize = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("keydown", handleKey);
      if (buttonEl) buttonEl.removeEventListener("click", finalize);
      resolve();
    };

    const handleKey = (event) => {
      if (event.repeat) return;
      if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.cancelKeys.includes(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        requestCasinoSlotQuit(); // ★回っている最中でもXキーで退店予約できるようにする
        return;
      }
      if (typeof KEY_CONFIG === "undefined" || !KEY_CONFIG.decideKeys.includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finalize();
    };

    window.addEventListener("keydown", handleKey);
    if (buttonEl) buttonEl.addEventListener("click", finalize);
  });
}

async function startSlotGame() {
  prepareCasinoConversationFocus();

  const overlay = document.getElementById("casino-slot-board");
  const stopButton = document.getElementById("casino-slot-stop-btn");
  const quitButton = document.getElementById("casino-slot-quit-btn");
  const resultEl = document.getElementById("casino-slot-result");
  const betDisplay = document.getElementById("casino-slot-bet-value");
  const betDecBtn = document.getElementById("casino-slot-bet-dec");
  const betIncBtn = document.getElementById("casino-slot-bet-inc");
  const betMinBtn = document.getElementById("casino-slot-bet-min");
  const betMaxBtn = document.getElementById("casino-slot-bet-max");
  const betStepDisplay = document.getElementById("casino-slot-bet-step-value");
  const betStepDecBtn = document.getElementById("casino-slot-bet-step-dec");
  const betStepIncBtn = document.getElementById("casino-slot-bet-step-inc");
  const minBet = getCasinoMinBet();
  const maxBet = getCasinoMaxBet();
  // ★要望対応：以前は上限額の桁に応じて刻み幅（1回の±で増減する額）を自動でひとつ選ぶだけだったが、
  //   Q/Eキーまたは専用ボタンでその場で切り替えられるようにした
  const defaultStep = maxBet >= 2000 ? 100 : (maxBet >= 200 ? 10 : 1);
  const stepOptions = [1, 10, 100, 1000].filter(s => s <= maxBet);
  let stepIndex = Math.max(0, stepOptions.indexOf(defaultStep));
  let step = stepOptions[stepIndex] || defaultStep;

  if (!overlay) return;
  overlay.classList.remove("hidden");
  casinoSlotQuitRequested = false;
  initCasinoSlotReels();
  renderCasinoSlotPayoutTable(); // ★要望対応：配当表を毎回最新の状態で描画（施設ごとの絵柄差し替えに追従）

  if (quitButton) {
    quitButton.disabled = false;
    quitButton.innerHTML = `やめる<span class="key-badge">X</span>`;
    quitButton.onclick = () => requestCasinoSlotQuit();
  }

  const updateBetStepDisplay = () => {
    if (betStepDisplay) betStepDisplay.textContent = `刻み幅：${step}陳`;
    if (betStepDecBtn) betStepDecBtn.disabled = stepIndex <= 0;
    if (betStepIncBtn) betStepIncBtn.disabled = stepIndex >= stepOptions.length - 1;
  };

  const updateBetDisplay = (nextBet) => {
    if (betDisplay) betDisplay.textContent = `${nextBet}陳`;
    if (betDecBtn) betDecBtn.disabled = nextBet <= minBet;
    if (betIncBtn) betIncBtn.disabled = nextBet >= maxBet;
    if (betMinBtn) betMinBtn.disabled = nextBet <= minBet;
    if (betMaxBtn) betMaxBtn.disabled = nextBet >= maxBet;
    if (stopButton) {
      stopButton.innerHTML = `開始（${nextBet}陳）<span class="key-badge">Z</span>`;
    }
  };

  const chooseBet = () => new Promise((resolve) => {
    // ★要望対応：初回や前回の掛け金があればそれを初期値にする（無ければ最低額）。
    //   施設が変わってmin/maxが変化していても範囲内に収まるようclampする
    let currentBet = Math.max(minBet, Math.min(maxBet, casinoSlotLastBet !== null ? casinoSlotLastBet : minBet));
    let settled = false;
    
    const changeStep = (delta) => {
      stepIndex = Math.max(0, Math.min(stepOptions.length - 1, stepIndex + delta));
      step = stepOptions[stepIndex];
      updateBetStepDisplay();
    };

    const cleanup = () => {
      if (betDecBtn) betDecBtn.removeEventListener("click", decClick);
      if (betIncBtn) betIncBtn.removeEventListener("click", incClick);
      if (betMinBtn) betMinBtn.removeEventListener("click", minClick);
      if (betMaxBtn) betMaxBtn.removeEventListener("click", maxClick);
      if (betStepDecBtn) betStepDecBtn.removeEventListener("click", stepDecClick);
      if (betStepIncBtn) betStepIncBtn.removeEventListener("click", stepIncClick);
      if (stopButton) stopButton.removeEventListener("click", confirmClick);
      window.removeEventListener("keydown", handleKey);
      casinoSlotCancelResolver = null;
    };

    const resolveBet = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (value !== null) casinoSlotLastBet = value; // ★要望対応：確定した掛け金を次回の初期値として覚えておく
      resolve(value);
    };

    const confirmClick = () => {
      resolveBet(currentBet);
    };

    const decClick = () => {
      currentBet = Math.max(minBet, currentBet - step);
      updateBetDisplay(currentBet);
    };
    const incClick = () => {
      currentBet = Math.min(maxBet, currentBet + step);
      updateBetDisplay(currentBet);
    };
    const minClick = () => {
      currentBet = minBet;
      updateBetDisplay(currentBet);
    };
    const maxClick = () => {
      currentBet = maxBet;
      updateBetDisplay(currentBet);
    };
    const stepDecClick = () => changeStep(-1);
    const stepIncClick = () => changeStep(1);

    const handleKey = (event) => {
      if (event.repeat) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault(); event.stopImmediatePropagation();
        decClick();
      } else if (event.key === "ArrowRight") {
        event.preventDefault(); event.stopImmediatePropagation();
        incClick();
      } else if (event.key === "o" || event.key === "O") {
        event.preventDefault(); event.stopImmediatePropagation();
        minClick();
      } else if (event.key === "p" || event.key === "P") {
        event.preventDefault(); event.stopImmediatePropagation();
        maxClick();
      } else if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.tabLeftKey.includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        changeStep(-1);
      } else if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.tabRightKey.includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        changeStep(1);
      } else if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.decideKeys.includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        resolveBet(currentBet);
      } else if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.cancelKeys.includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        resolveBet(null);
      }
    };

    if (betDecBtn) betDecBtn.addEventListener("click", decClick);
    if (betIncBtn) betIncBtn.addEventListener("click", incClick);
    if (betMinBtn) betMinBtn.addEventListener("click", minClick);
    if (betMaxBtn) betMaxBtn.addEventListener("click", maxClick);
    if (betStepDecBtn) betStepDecBtn.addEventListener("click", stepDecClick);
    if (betStepIncBtn) betStepIncBtn.addEventListener("click", stepIncClick);
    if (stopButton) stopButton.addEventListener("click", confirmClick);
    window.addEventListener("keydown", handleKey);
    // ★「やめる」ボタン・Xキーどちらでも、ここにいる間は即座に抜けられるようにしておく
    casinoSlotCancelResolver = () => resolveBet(null);
    updateBetStepDisplay();
    updateBetDisplay(currentBet);
  });

  const runOneSlotRound = async (bet) => {
    changeGold(-bet);
    renderStatusHUD();

    const finalBoard = Array.from({ length: 9 }, () => pickWeightedSlotSymbol());

    renderCasinoSlotIdleBoard();
    setSlotLeverPulled(true);
    await sleep(160);
    setSlotLeverPulled(false);
    startAllCasinoSlotReelsSpinning();

    for (let reel = 0; reel < 3; reel++) {
      if (stopButton) {
        // ★スロット画面のみで完結させたいので、通常のメッセージウィンドウは出さず
        //   ボタン自体のテキストで「リールNを止める」を伝える
        stopButton.innerHTML = `${reel + 1}列目を止める<span class="key-badge">Z</span>`;
      }
      await waitForSlotStopSignal(stopButton);

      const finalSymbols = [finalBoard[reel], finalBoard[reel + 3], finalBoard[reel + 6]];
      await stopCasinoSlotReel(reel, finalSymbols);
    }

    const result = getSlotBoardResult(finalBoard);
    const winningIndexes = result.line.length ? result.line : [];
    highlightCasinoSlotWinningLine(winningIndexes);

    if (resultEl) {
      resultEl.classList.remove("hidden");
      if (result.type === "win") {
        if (result.lineCount > 1) {
          const emojiList = result.symbols.map(s => s.emoji).join("、");
          resultEl.textContent = `大当たり！ ${result.lineCount}列同時に揃った！（${emojiList}）合計${bet * result.payout}陳の儲けだ！`;
        } else {
          resultEl.textContent = `大当たり！ ${result.symbol.emoji} が揃って${bet * result.payout}陳の儲けだ！`;
        }
      } else {
        resultEl.textContent = `残念、揃わなかった。${bet}陳は没収だな……`;
      }
    }

    if (result.type === "win") {
      changeGold(bet * result.payout);
    }
    renderStatusHUD();

    // ★要望対応：結果メッセージが一瞬（0.9秒）で消えてしまい読めない問題を修正。
    //   自動で消すのではなく、プレイヤーが確認してから自分でボタン/Zキーで次に進める形にする
    if (stopButton) {
      stopButton.innerHTML = `つづける<span class="key-badge">Z</span>`;
    }
    await waitForSlotStopSignal(stopButton);

    if (resultEl) {
      resultEl.classList.add("hidden");
      resultEl.textContent = "";
    }
  };

  while (true) {
    if (casinoSlotQuitRequested || gold < minBet) {
      // ★スロット画面のみで完結させるため、通常のメッセージウィンドウではなく
      //   スロット画面内の結果表示欄を使って一瞬伝えてから閉じる
      if (gold < minBet && !casinoSlotQuitRequested && resultEl) {
        resultEl.classList.remove("hidden");
        resultEl.textContent = `所持金が足りない。最低${minBet}陳必要だ。`;
        await sleep(1400);
      }
      if (quitButton) quitButton.onclick = null;
      overlay.classList.add("hidden");
      showCasinoMenu();
      return;
    }

    const bet = await chooseBet();
    if (bet == null) {
      if (quitButton) quitButton.onclick = null;
      overlay.classList.add("hidden");
      showCasinoMenu();
      return;
    }

    // ★要望対応：掛け金・操作方法は掛金表示欄／ボタン文言／固定ヒント文で既に伝わっているので、
    //   ここで重ねてメッセージウィンドウを出すのはやめる（スロット画面のみで完結させる）
    await runOneSlotRound(bet);
  }
}

// ===== ③ルーレット（複数の賭けをまとめて確定するまで追加できる） =====
const CASINO_ROULETTE_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

// ★本物のヨーロピアンルーレットと同じ、盤面に並んでいる順番（時計回り）。0から始まる37マス
const CASINO_ROULETTE_WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23,
  10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

function updateRouletteSelectionSummary(bets) {
  const statusEl = document.getElementById("casino-roulette-status");
  if (!statusEl) return;
  const total = bets.reduce((sum, bet) => sum + bet.amount, 0);
  statusEl.textContent = `掛け済み: ${total}陳 / ${bets.length}箇所`;
}

// ★要望対応：同じマスへの二重掛け（1回のルーレットで同じマスに何度も賭けてしまうこと）を防ぐ際、
//   却下した理由を一瞬だけステータス欄に表示してから、通常の集計表示に戻す
function flashRouletteNotice(text, bets) {
  const statusEl = document.getElementById("casino-roulette-status");
  if (!statusEl) return;
  statusEl.textContent = text;
  clearTimeout(flashRouletteNotice._timer);
  flashRouletteNotice._timer = setTimeout(() => updateRouletteSelectionSummary(bets), 1400);
}

function setRouletteSpinSceneVisible(visible) {
  const scene = document.getElementById("casino-roulette-wheel-scene");
  if (!scene) return;
  if (visible) scene.classList.remove("hidden");
  else scene.classList.add("hidden");
}

// ★色帯（本物と同じ配色）と、外周ぞいの数字ラベルを一度だけ組み立てる
let casinoRouletteWheelBuilt = false;
function buildCasinoRouletteWheelOnce() {
  if (casinoRouletteWheelBuilt) return;
  const wheelEl = document.getElementById("casino-roulette-wheel");
  if (!wheelEl) return;

  const segmentDeg = 360 / CASINO_ROULETTE_WHEEL_ORDER.length;
  const stops = CASINO_ROULETTE_WHEEL_ORDER.map((num, i) => {
    const color = num === 0 ? "#1c7a3d" : (CASINO_ROULETTE_RED.has(num) ? "#9d1c1c" : "#1d1d1d");
    const from = i * segmentDeg;
    const to = from + segmentDeg;
    return `${color} ${from}deg ${to}deg`;
  }).join(", ");
  wheelEl.style.background = `conic-gradient(${stops})`;

  wheelEl.innerHTML = "";
  CASINO_ROULETTE_WHEEL_ORDER.forEach((num, i) => {
    const wrap = document.createElement("div");
    wrap.className = "roulette-wheel-number-wrap";
    wrap.style.transform = `rotate(${i * segmentDeg + segmentDeg / 2}deg)`;
    const label = document.createElement("span");
    label.className = "roulette-wheel-number";
    label.textContent = String(num);
    wrap.appendChild(label);
    wheelEl.appendChild(wrap);
  });

  casinoRouletteWheelBuilt = true;
}

// ★resultNumberのマスが、真上の固定ポインターに来るのに必要な回転角（セグメント中心基準）
function getCasinoRouletteTargetSegmentAngle(resultNumber) {
  const index = CASINO_ROULETTE_WHEEL_ORDER.indexOf(resultNumber);
  const segmentDeg = 360 / CASINO_ROULETTE_WHEEL_ORDER.length;
  return (index >= 0 ? index : 0) * segmentDeg + segmentDeg / 2;
}

// ★玉が転がって、だんだん減速しながら当たりの数字へピタッと収まる演出。
//   盤（ホイール）と玉は別々に、逆回りで何周かしてから、同時に止まるように角度を合わせておく
function animateRouletteSpin(resultNumber) {
  const boardOverlay = document.getElementById("casino-roulette-board");
  const panel = boardOverlay ? boardOverlay.querySelector(".casino-roulette-panel") : null;
  const scene = document.getElementById("casino-roulette-wheel-scene");
  const wheel = document.getElementById("casino-roulette-wheel");
  const ball = document.getElementById("casino-roulette-ball");
  const resultLabelEl = document.getElementById("casino-roulette-spin-result");
  if (!boardOverlay || !scene || !wheel || !ball) return Promise.resolve();

  buildCasinoRouletteWheelOnce();

  // ★バグ修正：賭けを確定した時点でpickRouletteBets()側が#casino-roulette-board自体を非表示にしていたため、
  //   その中にある#casino-roulette-wheel-sceneだけ表示クラスを付けても、親ごと隠れたままで演出が一切見えなかった。
  //   演出中だけ盤面の枠を再度表示し、グリッドなど不要な部分はCSSで隠す
  boardOverlay.classList.remove("hidden");
  if (panel) panel.classList.add("spin-only");
  setRouletteSpinSceneVisible(true);
  if (resultLabelEl) resultLabelEl.textContent = "";

  const SPIN_DURATION_MS = 4200;
  const WHEEL_EXTRA_TURNS = 5;
  const BALL_EXTRA_TURNS = 9;
  const BALL_RADIUS = 112;

  const targetSegmentAngle = getCasinoRouletteTargetSegmentAngle(resultNumber);
  const wheelFinalRotation = WHEEL_EXTRA_TURNS * 360 - targetSegmentAngle;
  const ballFinalRotation = -(BALL_EXTRA_TURNS * 360); // ★玉の軌道自体は数字と無関係な固定トラックなので、真上（ポインター）に戻ってくればOK

  wheel.style.transition = "none";
  ball.style.transition = "none";
  wheel.style.transform = "rotate(0deg)";
  ball.style.transform = `rotate(0deg) translateY(-${BALL_RADIUS}px)`;

  requestAnimationFrame(() => {
    wheel.style.transition = `transform ${SPIN_DURATION_MS}ms cubic-bezier(0.11, 0.62, 0.16, 1)`;
    ball.style.transition = `transform ${SPIN_DURATION_MS - 200}ms cubic-bezier(0.08, 0.55, 0.12, 1)`;
    requestAnimationFrame(() => {
      wheel.style.transform = `rotate(${wheelFinalRotation}deg)`;
      ball.style.transform = `rotate(${ballFinalRotation}deg) translateY(-${BALL_RADIUS}px)`;
    });
  });

  return new Promise((resolve) => {
    setTimeout(() => {
      // ★止まる瞬間、玉が数字のマスに弾かれて少し沈み込むような、小さな着地の揺れを付ける
      ball.style.transition = "transform 260ms ease-out";
      ball.style.transform = `rotate(${ballFinalRotation}deg) translateY(-${BALL_RADIUS - 8}px)`;
      requestAnimationFrame(() => {
        setTimeout(() => {
          ball.style.transition = "transform 200ms ease-in-out";
          ball.style.transform = `rotate(${ballFinalRotation}deg) translateY(-${BALL_RADIUS}px)`;
        }, 260);
      });

      if (resultLabelEl) {
        const colorLabel = resultNumber === 0 ? "緑" : (CASINO_ROULETTE_RED.has(resultNumber) ? "赤" : "黒");
        resultLabelEl.textContent = `${resultNumber}・${colorLabel}`;
      }

      setTimeout(() => {
        wheel.style.transition = "none";
        ball.style.transition = "none";
        setRouletteSpinSceneVisible(false);
        if (panel) panel.classList.remove("spin-only");
        boardOverlay.classList.add("hidden"); // ★演出が終わったらまた盤面ごと隠す
        resolve();
      }, 950);
    }, SPIN_DURATION_MS);
  });
}

// 盤面のマス目データを組み立てる。座標(colStart, colSpan, row, rowSpan)はCSS Gridにそのまま使う
function buildRouletteCells() {
  const cells = [];
  
  cells.push({
    key: "num-0", label: "0", row: 1, colStart: 1, colSpan: 1, rowSpan: 3,
    className: "casino-cell-zero", matches: n => n === 0, payoutMultiple: 35 // ★0の倍率は検討中のため今回は変更しない
  });
  
  // 実物のルーレット卓と同じ並び（一番奥の列が3,6,9…36、真ん中が2,5,8…35、手前が1,4,7…34）
  const numberRows = [
    [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36],
    [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35],
    [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34]
  ];
  numberRows.forEach((numbersInRow, rowIndex) => {
    numbersInRow.forEach((n, colIndex) => {
      cells.push({
        key: "num-" + n, label: String(n), row: rowIndex + 1, colStart: colIndex + 2, colSpan: 1, rowSpan: 1,
        className: CASINO_ROULETTE_RED.has(n) ? "casino-cell-red" : "casino-cell-black",
        matches: n2 => n2 === n, payoutMultiple: 20 // ★要望対応：単マス（0以外）は20倍
      });
    });
  });
  
  // ダズンベット（12個区切り、配当3倍） // ★要望対応：2倍→3倍
  cells.push({ key: "dozen-1", label: "1〜12", row: 4, colStart: 2, colSpan: 4, rowSpan: 1, className: "casino-cell-outside", matches: n => n >= 1 && n <= 12, payoutMultiple: 3 });
  cells.push({ key: "dozen-2", label: "13〜24", row: 4, colStart: 6, colSpan: 4, rowSpan: 1, className: "casino-cell-outside", matches: n => n >= 13 && n <= 24, payoutMultiple: 3 });
  cells.push({ key: "dozen-3", label: "25〜36", row: 4, colStart: 10, colSpan: 4, rowSpan: 1, className: "casino-cell-outside", matches: n => n >= 25 && n <= 36, payoutMultiple: 3 });
  
  // 一番下の等倍ベット（配当2倍） // ★要望対応：1倍→2倍
  cells.push({ key: "low",   label: "1〜18", row: 5, colStart: 2,  colSpan: 2, rowSpan: 1, className: "casino-cell-outside",               matches: n => n >= 1 && n <= 18,              payoutMultiple: 2 });
  cells.push({ key: "even",  label: "偶数",   row: 5, colStart: 4,  colSpan: 2, rowSpan: 1, className: "casino-cell-outside",               matches: n => n !== 0 && n % 2 === 0,          payoutMultiple: 2 });
  cells.push({ key: "red",   label: "赤",     row: 5, colStart: 6,  colSpan: 2, rowSpan: 1, className: "casino-cell-outside casino-cell-red",   matches: n => CASINO_ROULETTE_RED.has(n),      payoutMultiple: 2 });
  cells.push({ key: "black", label: "黒",     row: 5, colStart: 8,  colSpan: 2, rowSpan: 1, className: "casino-cell-outside casino-cell-black", matches: n => n !== 0 && !CASINO_ROULETTE_RED.has(n), payoutMultiple: 2 });
  cells.push({ key: "odd",   label: "奇数",   row: 5, colStart: 10, colSpan: 2, rowSpan: 1, className: "casino-cell-outside",               matches: n => n % 2 === 1,                     payoutMultiple: 2 });
  cells.push({ key: "high",  label: "19〜36", row: 5, colStart: 12, colSpan: 2, rowSpan: 1, className: "casino-cell-outside",               matches: n => n >= 19 && n <= 36,              payoutMultiple: 2 });
  
  return cells;
}

// 賭けるマスを選ばせる専用ポップアップ（#casino-roulette-board）。
// ★通常の行き先メニュー（location-menu）は縦一列・2列グリッドしか対応しておらず、
//   ルーレット卓のような「数字の升目＋幅の異なるアウトサイドベット」を矢印キーで
//   自然に行き来させるのには向かないため、専用の2次元カーソル移動を実装する。
//   今回は「確定するまで何箇所でも掛けられる」ようにし、決定キーでその場に追加していく
async function pickRouletteBets() {
  return new Promise((resolve) => {
    const cells = buildRouletteCells();
    let cursorIndex = Math.max(0, cells.findIndex(c => c.key === "red"));
    const selections = [];

    const overlay = document.getElementById("casino-roulette-board");
    const gridEl = document.getElementById("casino-roulette-grid");
    const confirmBtn = document.getElementById("casino-roulette-confirm");
    const cancelBtn = document.getElementById("casino-roulette-cancel");

    if (!overlay || !gridEl) {
      console.error("ルーレット盤のDOM要素が見つかりません。casino-roulette-board / casino-roulette-grid が index.html に存在するか確認してください。");
      resolve(null);
      return;
    }

    function render() {
      gridEl.innerHTML = "";
      const chipTotals = new Map();
      selections.forEach(({ cell }) => {
        const subtotal = chipTotals.get(cell.key) || 0;
        chipTotals.set(cell.key, subtotal + 1);
      });

      cells.forEach((cell, i) => {
        const el = document.createElement("div");
        el.className = "casino-roulette-cell " + cell.className + (i === cursorIndex ? " cursor" : "");
        el.style.gridColumn = `${cell.colStart} / span ${cell.colSpan}`;
        el.style.gridRow = `${cell.row} / span ${cell.rowSpan}`;

        const labelEl = document.createElement("span");
        labelEl.className = "casino-roulette-cell-label";
        labelEl.textContent = cell.label;
        el.appendChild(labelEl);
        
        // ★要望対応：配当が何倍かひと目で分かるよう、全てのマスに倍率バッジを表示する
        //   （数字マス単体は面積が小さいので、右上に小さく添える形にする）
        const payoutEl = document.createElement("span");
        payoutEl.textContent = `${cell.payoutMultiple}倍`;
        if (cell.colSpan >= 2) {
          payoutEl.className = "casino-roulette-cell-payout";
        } else {
          payoutEl.className = "casino-roulette-cell-payout casino-roulette-cell-payout-corner";
        }
        el.appendChild(payoutEl);

        const chipTotal = chipTotals.get(cell.key) || 0;
        if (chipTotal > 0) {
          const stackEl = document.createElement("div");
          stackEl.className = "roulette-chip-stack";
          stackEl.title = `賭け中: ${chipTotal}枚`;

          const chip = document.createElement("span");
          chip.className = "roulette-chip";
          chip.textContent = `${chipTotal}`;
          stackEl.appendChild(chip);
          el.appendChild(stackEl);
        }

        el.onclick = async (event) => {
          event.stopPropagation();
          cursorIndex = i;
          // ★要望対応：同じマスへの二重掛けを防ぐ（既に賭けているマスをもう一度選んでも追加しない）
          if (selections.some(s => s.cell.key === cell.key)) {
            flashRouletteNotice(`「${cell.label}」には既に賭けています`, selections);
            render();
            return;
          }
          const amount = await pickCasinoBet(`「${cell.label}」（配当${cell.payoutMultiple}倍）への賭け金`);
          if (amount > 0) {
            selections.push({ cell, amount });
            updateRouletteSelectionSummary(selections);
            render();
          }
        };
        gridEl.appendChild(el);
      });
      updateRouletteSelectionSummary(selections);
    }

    function finish(result) {
      overlay.classList.add("hidden");
      window.removeEventListener("keydown", handleKey);
      resolve(result);
    }

    // ★バグ修正：直角方向の距離が小さいマスを最優先にしていたため、押した向きにあるマスのうち
    //   実際には「今のマスと同じ行／列で隣り合っている」マスより、斜め方向にあるだけの遠いマスの方が
    //   中心同士の距離が近いという理由で選ばれてしまうことがあった
    //   （例：「赤」から上へ→本来は「13〜24」のはずが、さらに奥の数字マス「13」へ飛ぶ／
    //   数字の並びの端から下へ→本来は「1〜12」等のはずが、さらに奥の「1〜18」等へ直接飛ぶ）。
    //   まず「押した向きと垂直な方向の範囲が今のマスと実際に重なっている（＝同じ行/列を移動している）」
    //   マスだけに絞り込み、その中で押した向きの距離が一番近いものを選ぶようにする。
    //   該当が無い場合（0のマスなど、他のどのマスとも列が重ならない場合）だけ、これまで通りの
    //   「一番近そうなマス」を保険として選ぶ
    function moveCursor(dx, dy) {
      const cur = cells[cursorIndex];
      if (!cur) return;

      const curX = cur.colStart + cur.colSpan / 2;
      const curY = cur.row + cur.rowSpan / 2;
      const curColStart = cur.colStart, curColEnd = cur.colStart + cur.colSpan;
      const curRowStart = cur.row, curRowEnd = cur.row + cur.rowSpan;
      const dirX = dx !== 0 ? Math.sign(dx) : 0;
      const dirY = dy !== 0 ? Math.sign(dy) : 0;

      let bestOverlapIndex = -1;
      let bestOverlapScore = Infinity;
      let bestFallbackIndex = -1;
      let bestFallbackScore = Infinity;

      cells.forEach((cell, i) => {
        if (i === cursorIndex) return;
        const x = cell.colStart + cell.colSpan / 2;
        const y = cell.row + cell.rowSpan / 2;
        const relX = x - curX;
        const relY = y - curY;

        if (dirX !== 0 && relX * dirX <= 0) return;
        if (dirY !== 0 && relY * dirY <= 0) return;

        const primaryDist = dx !== 0 ? Math.abs(relX) : Math.abs(relY);
        const perpDist = dx !== 0 ? Math.abs(relY) : Math.abs(relX);

        // 横移動なら「行の範囲」が、縦移動なら「列の範囲」が、今のマスと実際に重なっているか
        const overlaps = dx !== 0
          ? cell.row < curRowEnd && curRowStart < cell.row + cell.rowSpan
          : cell.colStart < curColEnd && curColStart < cell.colStart + cell.colSpan;

        if (overlaps) {
          const score = primaryDist * 1000 + perpDist; // 重なりがある中では、押した向きへの近さを最優先にする
          if (score < bestOverlapScore) { bestOverlapScore = score; bestOverlapIndex = i; }
        } else {
          const score = perpDist * 1000 + primaryDist; // 保険：重なりが無い時だけ、これまで通りの近さ優先
          if (score < bestFallbackScore) { bestFallbackScore = score; bestFallbackIndex = i; }
        }
      });

      const targetIndex = bestOverlapIndex >= 0 ? bestOverlapIndex : bestFallbackIndex;
      if (targetIndex >= 0) {
        cursorIndex = targetIndex;
        render();
      }
    }

    async function addCurrentSelection() {
      const cell = cells[cursorIndex];
      if (!cell) return;
      // ★要望対応：同じマスへの二重掛けを防ぐ（既に賭けているマスをもう一度選んでも追加しない）
      if (selections.some(s => s.cell.key === cell.key)) {
        flashRouletteNotice(`「${cell.label}」には既に賭けています`, selections);
        return;
      }
      const amount = await pickCasinoBet(`「${cell.label}」（配当${cell.payoutMultiple}倍）への賭け金`);
      if (amount > 0) {
        selections.push({ cell, amount });
        updateRouletteSelectionSummary(selections);
        render();
      }
    }

    async function handleKey(event) {
      if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return;
      if (typeof isGameDialogOpen !== "undefined" && isGameDialogOpen) return;
      const quantityPicker = document.getElementById("quantity-picker");
      if (quantityPicker && !quantityPicker.classList.contains("hidden")) return;
      if (event.repeat) return;
      if (event.key === "ArrowRight") {
        event.preventDefault(); event.stopImmediatePropagation(); moveCursor(1, 0);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault(); event.stopImmediatePropagation(); moveCursor(-1, 0);
      } else if (event.key === "ArrowDown") {
        event.preventDefault(); event.stopImmediatePropagation(); moveCursor(0, 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault(); event.stopImmediatePropagation(); moveCursor(0, -1);
      } else if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.decideKeys.includes(event.key)) {
        // ★要望対応：チップを置くのはZキー（決定キー）に統一。Cキーは確定専用にする
        event.preventDefault(); event.stopImmediatePropagation();
        await addCurrentSelection();
      } else if (event.key === "c" || event.key === "C") {
        // ★要望対応：Cキーは「置き終えたマスをまとめて確定する」専用。置く操作はここでは行わない
        event.preventDefault(); event.stopImmediatePropagation();
        finish(selections.length ? selections : null);
      } else if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.cancelKeys.includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        finish(null);
      }
    }

    if (confirmBtn) confirmBtn.onclick = (event) => {
      event.stopPropagation();
      finish(selections.length ? selections : null);
    };
    if (cancelBtn) cancelBtn.onclick = (event) => {
      event.stopPropagation();
      finish(null);
    };

    render();
    overlay.classList.remove("hidden");
    window.addEventListener("keydown", handleKey);
  });
}

async function startRouletteGame() {
  prepareCasinoConversationFocus();
  const minBet = getCasinoMinBet();
  if (gold < minBet) {
    changeSpeaker(casinoFacility.name || "ルーレット台");
    await displayMessage(`すまないが、最低${minBet}陳は無いと賭けられないよ……`);
    showCasinoMenu();
    return;
  }

  const bets = await pickRouletteBets();
  if (!bets || bets.length === 0) { showCasinoMenu(); return; }

  const totalBet = bets.reduce((sum, bet) => sum + bet.amount, 0);
  if (totalBet <= 0) { showCasinoMenu(); return; }

  changeSpeaker(casinoFacility.name || "ルーレット台");
  await displayMessage("賭けを確定した。ルーレットの球が回る……");
  
  const resultNumber = Math.floor(Math.random() * 37); // 0〜36
  const resultColorLabel = resultNumber === 0 ? "" : (CASINO_ROULETTE_RED.has(resultNumber) ? "・赤" : "・黒");
  await animateRouletteSpin(resultNumber);
  await displayMessage(`球が止まった……「${resultNumber}${resultColorLabel}」だ！`);

  let netResult = 0;
  for (const bet of bets) {
    if (bet.cell.matches(resultNumber)) {
      const profit = bet.amount * bet.cell.payoutMultiple;
      netResult += profit;
      await displayMessage(`「${bet.cell.label}」に当たった！ ${profit}陳の儲けだ！`);
    } else {
      netResult -= bet.amount;
    }
  }

  if (netResult > 0) {
    changeGold(netResult);
    await displayMessage(`合計で${netResult}陳の儲けだ！`);
  } else {
    const loss = Math.abs(netResult);
    changeGold(-loss);
    await displayMessage(`残念、外れが多かった。合計${loss}陳は没収だな……`);
  }

  renderStatusHUD();
  showCasinoMenu();
}
