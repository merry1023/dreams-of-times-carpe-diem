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
  // ★金額なので1ずつだと選ぶのが大変。上限額の桁に応じて刻み幅を自動で大きくする
  const step = maxBet >= 2000 ? 100 : (maxBet >= 200 ? 10 : 1);
  
  const bet = await pickQuantity(maxBet, label, {
    min: minBet,
    step,
    formatValue: v => `${v}陳`,
    formatLabel: max => `${label}（所持金${gold}陳／最大${max}陳）`,
    cancelValue: 0
  });
  return bet;
}

async function waitForDecideKeyPresses(count, text) {
  if (text) {
    await displayMessage(text);
  }

  return new Promise((resolve) => {
    let pressed = 0;
    const listener = (event) => {
      if (event.repeat) return;
      if (typeof KEY_CONFIG === "undefined" || !KEY_CONFIG.decideKeys.includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      pressed += 1;
      if (pressed >= count) {
        window.removeEventListener("keydown", listener);
        resolve();
      }
    };
    window.addEventListener("keydown", listener);
  });
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

// ===== ②スロット（3×3の見た目付きジャグラー風UI） =====
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

function pickWeightedSlotSymbol() {
  const total = CASINO_SLOT_SYMBOLS.reduce((sum, s) => sum + s.weight, 0);
  let r = Math.random() * total;
  for (const symbol of CASINO_SLOT_SYMBOLS) {
    if (r < symbol.weight) return symbol;
    r -= symbol.weight;
  }
  return CASINO_SLOT_SYMBOLS[CASINO_SLOT_SYMBOLS.length - 1];
}

function getSlotSymbolMarkup(symbol) {
  const imagePath = casinoFacility && casinoFacility.slotImages && casinoFacility.slotImages[symbol.key];
  if (imagePath) {
    return `<img src="${imagePath}" class="casino-slot-symbol-img" alt="${symbol.key}">`;
  }
  return `<span class="casino-slot-symbol-emoji">${symbol.emoji}</span>`;
}

function getSlotSymbolDisplay(symbol) {
  if (!symbol) return "?";
  const imagePath = casinoFacility && casinoFacility.slotImages && casinoFacility.slotImages[symbol.key];
  if (imagePath) return `<img src="${imagePath}" class="casino-slot-symbol-img" alt="${symbol.key}">`;
  return symbol.emoji;
}

function renderSlotBoard(boardSymbols, winningIndexes = [], isSpinning = false) {
  const overlay = document.getElementById("casino-slot-board");
  const grid = document.getElementById("casino-slot-grid");
  const result = document.getElementById("casino-slot-result");
  if (!overlay || !grid) return;

  grid.innerHTML = "";
  boardSymbols.forEach((symbol, index) => {
    const cell = document.createElement("div");
    const classes = ["casino-slot-cell"];
    if (winningIndexes.includes(index)) classes.push("is-winning");
    if (isSpinning) classes.push("is-spinning");
    cell.className = classes.join(" ");
    cell.style.animationDelay = `${(index % 3) * 40}ms`;
    cell.innerHTML = getSlotSymbolDisplay(symbol);
    grid.appendChild(cell);
  });

  if (result) {
    result.classList.add("hidden");
    result.textContent = "";
  }
}

function getWinningSlotLineIndexes(boardSymbols) {
  for (const line of CASINO_SLOT_LINES) {
    const first = boardSymbols[line[0]];
    if (!first) continue;
    const allMatch = line.every(index => boardSymbols[index] && boardSymbols[index].key === first.key);
    if (allMatch) return line;
  }
  return null;
}

function getSlotBoardResult(boardSymbols) {
  const winningLine = getWinningSlotLineIndexes(boardSymbols);
  if (winningLine) {
    const symbol = boardSymbols[winningLine[0]];
    return {
      type: "win",
      symbol,
      line: winningLine,
      payout: symbol.payout,
      profit: symbol.payout
    };
  }

  const counts = {};
  boardSymbols.forEach(symbol => {
    if (!symbol) return;
    counts[symbol.key] = (counts[symbol.key] || 0) + 1;
  });
  const pairKey = Object.keys(counts).find(key => counts[key] >= 2);
  if (pairKey) {
    const symbol = CASINO_SLOT_SYMBOLS.find(s => s.key === pairKey) || CASINO_SLOT_SYMBOLS[0];
    return {
      type: "small",
      symbol,
      line: [],
      payout: 1,
      profit: 0.5
    };
  }

  return { type: "lose", symbol: null, line: [], payout: 0, profit: 0 };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function setSlotLeverPulled(pulled) {
  const lever = document.getElementById("casino-slot-lever");
  if (!lever) return;
  lever.classList.toggle("is-pulled", !!pulled);
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
      if (typeof KEY_CONFIG === "undefined" || !KEY_CONFIG.decideKeys.includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finalize();
    };

    window.addEventListener("keydown", handleKey);
    if (buttonEl) buttonEl.addEventListener("click", finalize);
  });
}

async function spinSlotBoard(finalBoard) {
  const overlay = document.getElementById("casino-slot-board");
  const grid = document.getElementById("casino-slot-grid");
  if (!overlay || !grid) return;

  overlay.classList.remove("hidden");

  for (let frame = 0; frame < 14; frame++) {
    const randomBoard = Array.from({ length: 9 }, () => pickWeightedSlotSymbol());
    renderSlotBoard(randomBoard, [], true);
    await sleep(70);
  }

  renderSlotBoard(finalBoard, [], false);
  await sleep(220);
}

async function startSlotGame() {
  prepareCasinoConversationFocus();

  const overlay = document.getElementById("casino-slot-board");
  const stopButton = document.getElementById("casino-slot-stop-btn");
  const resultEl = document.getElementById("casino-slot-result");
  const betDisplay = document.getElementById("casino-slot-bet-value");
  const betDecBtn = document.getElementById("casino-slot-bet-dec");
  const betIncBtn = document.getElementById("casino-slot-bet-inc");
  const minBet = getCasinoMinBet();
  const maxBet = getCasinoMaxBet();
  const step = maxBet >= 2000 ? 100 : (maxBet >= 200 ? 10 : 1);

  if (!overlay) return;
  overlay.classList.remove("hidden");

  const updateBetDisplay = (nextBet) => {
    if (betDisplay) betDisplay.textContent = `${nextBet}陳`;
    if (betDecBtn) betDecBtn.disabled = nextBet <= minBet;
    if (betIncBtn) betIncBtn.disabled = nextBet >= maxBet;
    if (stopButton) {
      stopButton.textContent = `開始（${nextBet}陳）`;
      stopButton.innerHTML = `開始（${nextBet}陳）<span class="key-badge">Z</span>`;
    }
  };

  const chooseBet = () => new Promise((resolve) => {
    let currentBet = Math.max(minBet, Math.min(maxBet, minBet));
    let settled = false;

    const cleanup = () => {
      if (betDecBtn) betDecBtn.removeEventListener("click", decClick);
      if (betIncBtn) betIncBtn.removeEventListener("click", incClick);
      if (stopButton) stopButton.removeEventListener("click", confirmClick);
      window.removeEventListener("keydown", handleKey);
    };

    const resolveBet = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
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

    const handleKey = (event) => {
      if (event.repeat) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault(); event.stopImmediatePropagation();
        decClick();
      } else if (event.key === "ArrowRight") {
        event.preventDefault(); event.stopImmediatePropagation();
        incClick();
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
    if (stopButton) stopButton.addEventListener("click", confirmClick);
    window.addEventListener("keydown", handleKey);
    updateBetDisplay(currentBet);
  });

  const runOneSlotRound = async (bet) => {
    changeGold(-bet);
    renderStatusHUD();

    const finalBoard = Array.from({ length: 9 }, () => pickWeightedSlotSymbol());
    const currentBoard = Array(9).fill(null);

    const startBoard = Array.from({ length: 9 }, () => pickWeightedSlotSymbol());
    renderSlotBoard(startBoard, [], false);
    setSlotLeverPulled(true);
    await sleep(160);
    setSlotLeverPulled(false);

    for (let reel = 0; reel < 3; reel++) {
      const stopIndexes = [reel, reel + 3, reel + 6];
      if (stopButton) {
        stopButton.textContent = `リール${reel + 1}を止める`;
        stopButton.innerHTML = `リール${reel + 1}を止める<span class="key-badge">Z</span>`;
      }
      await displayMessage(`リール${reel + 1}を止める`);
      await waitForSlotStopSignal(stopButton);

      for (let frame = 0; frame < 10; frame++) {
        const tempBoard = currentBoard.slice();
        for (let i = 0; i < 9; i++) {
          if (stopIndexes.includes(i)) {
            if (tempBoard[i] == null) tempBoard[i] = finalBoard[i];
            continue;
          }
          tempBoard[i] = pickWeightedSlotSymbol();
        }
        for (let i = 0; i < 9; i++) {
          if (tempBoard[i] == null) tempBoard[i] = finalBoard[i];
        }
        renderSlotBoard(tempBoard, [], true);
        await sleep(80);
      }

      for (const idx of stopIndexes) {
        currentBoard[idx] = finalBoard[idx];
      }
      renderSlotBoard(currentBoard, [], false);
      await sleep(180);
    }

    const result = getSlotBoardResult(finalBoard);
    const winningIndexes = result.line.length ? result.line : [];
    renderSlotBoard(finalBoard, winningIndexes);

    if (resultEl) {
      resultEl.classList.remove("hidden");
      if (result.type === "win") {
        resultEl.textContent = `大当たり！ ${result.symbol.emoji} が揃って${bet * result.payout}陳の儲けだ！`;
      } else if (result.type === "small") {
        resultEl.textContent = `惜しい、2つ揃った。${Math.ceil(bet * 0.5)}陳だけ戻ってきた。`;
      } else {
        resultEl.textContent = `残念、揃わなかった。${bet}陳は没収だな……`;
      }
    }

    if (result.type === "win") {
      changeGold(bet * result.payout);
    } else if (result.type === "small") {
      const refund = Math.ceil(bet * 0.5);
      changeGold(refund);
    }
    renderStatusHUD();

    await sleep(500);

    if (resultEl) {
      resultEl.classList.add("hidden");
      resultEl.textContent = "";
    }
  };

  while (true) {
    if (gold < minBet) {
      changeSpeaker(casinoFacility.name || "スロット台");
      await displayMessage(`所持金が足りない。最低${minBet}陳必要だ。`);
      overlay.classList.add("hidden");
      showCasinoMenu();
      return;
    }

    const bet = await chooseBet();
    if (bet == null) {
      overlay.classList.add("hidden");
      showCasinoMenu();
      return;
    }

    changeSpeaker(casinoFacility.name || "スロット台");
    await displayMessage(`掛け金${bet}陳。レバーを引いて、3回Zで各リールを止める`);
    await runOneSlotRound(bet);
    await displayMessage(`次は左右キーまたはボタンで掛金を調整して、Zで回す。`);
  }
}

// ===== ③ルーレット（複数の賭けをまとめて確定するまで追加できる） =====
const CASINO_ROULETTE_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

function updateRouletteSelectionSummary(bets) {
  const statusEl = document.getElementById("casino-roulette-status");
  if (!statusEl) return;
  const total = bets.reduce((sum, bet) => sum + bet.amount, 0);
  statusEl.textContent = `掛け済み: ${total}陳 / ${bets.length}箇所`;
}

function setRouletteSpinSceneVisible(visible) {
  const scene = document.getElementById("casino-roulette-wheel-scene");
  if (!scene) return;
  if (visible) scene.classList.remove("hidden");
  else scene.classList.add("hidden");
}

function animateRouletteSpin(resultNumber) {
  const scene = document.getElementById("casino-roulette-wheel-scene");
  const wheel = document.getElementById("casino-roulette-wheel");
  const ball = document.getElementById("casino-roulette-ball");
  if (!scene || !wheel || !ball) return Promise.resolve();

  setRouletteSpinSceneVisible(true);
  const duration = 1800;
  wheel.style.animation = `roulette-wheel-spin ${duration}ms linear infinite`;
  ball.style.animation = `roulette-ball-orbit ${duration}ms linear infinite`;

  return new Promise((resolve) => {
    setTimeout(() => {
      wheel.style.animation = "none";
      ball.style.animation = "none";
      setRouletteSpinSceneVisible(false);
      resolve();
    }, duration + 150);
  });
}

// 盤面のマス目データを組み立てる。座標(colStart, colSpan, row, rowSpan)はCSS Gridにそのまま使う
function buildRouletteCells() {
  const cells = [];
  
  cells.push({
    key: "num-0", label: "0", row: 1, colStart: 1, colSpan: 1, rowSpan: 3,
    className: "casino-cell-zero", matches: n => n === 0, payoutMultiple: 35
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
        matches: n2 => n2 === n, payoutMultiple: 35
      });
    });
  });
  
  // ダズンベット（12個区切り、配当2倍）
  cells.push({ key: "dozen-1", label: "1〜12", row: 4, colStart: 2, colSpan: 4, rowSpan: 1, className: "casino-cell-outside", matches: n => n >= 1 && n <= 12, payoutMultiple: 2 });
  cells.push({ key: "dozen-2", label: "13〜24", row: 4, colStart: 6, colSpan: 4, rowSpan: 1, className: "casino-cell-outside", matches: n => n >= 13 && n <= 24, payoutMultiple: 2 });
  cells.push({ key: "dozen-3", label: "25〜36", row: 4, colStart: 10, colSpan: 4, rowSpan: 1, className: "casino-cell-outside", matches: n => n >= 25 && n <= 36, payoutMultiple: 2 });
  
  // 等倍ベット（配当1倍＝賭け金と同額の儲け）
  cells.push({ key: "low",   label: "1〜18", row: 5, colStart: 2,  colSpan: 2, rowSpan: 1, className: "casino-cell-outside",               matches: n => n >= 1 && n <= 18,              payoutMultiple: 1 });
  cells.push({ key: "even",  label: "偶数",   row: 5, colStart: 4,  colSpan: 2, rowSpan: 1, className: "casino-cell-outside",               matches: n => n !== 0 && n % 2 === 0,          payoutMultiple: 1 });
  cells.push({ key: "red",   label: "赤",     row: 5, colStart: 6,  colSpan: 2, rowSpan: 1, className: "casino-cell-outside casino-cell-red",   matches: n => CASINO_ROULETTE_RED.has(n),      payoutMultiple: 1 });
  cells.push({ key: "black", label: "黒",     row: 5, colStart: 8,  colSpan: 2, rowSpan: 1, className: "casino-cell-outside casino-cell-black", matches: n => n !== 0 && !CASINO_ROULETTE_RED.has(n), payoutMultiple: 1 });
  cells.push({ key: "odd",   label: "奇数",   row: 5, colStart: 10, colSpan: 2, rowSpan: 1, className: "casino-cell-outside",               matches: n => n % 2 === 1,                     payoutMultiple: 1 });
  cells.push({ key: "high",  label: "19〜36", row: 5, colStart: 12, colSpan: 2, rowSpan: 1, className: "casino-cell-outside",               matches: n => n >= 19 && n <= 36,              payoutMultiple: 1 });
  
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
      cells.forEach((cell, i) => {
        const el = document.createElement("div");
        el.className = "casino-roulette-cell " + cell.className + (i === cursorIndex ? " cursor" : "");
        el.style.gridColumn = `${cell.colStart} / span ${cell.colSpan}`;
        el.style.gridRow = `${cell.row} / span ${cell.rowSpan}`;
        el.textContent = cell.label;
        el.onclick = async (event) => {
          event.stopPropagation();
          cursorIndex = i;
          const amount = await pickCasinoBet(`「${cell.label}」への賭け金`);
          if (amount > 0) {
            selections.push({ cell, amount });
            updateRouletteSelectionSummary(selections);
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

    function moveCursor(dx, dy) {
      const cur = cells[cursorIndex];
      if (!cur) return;

      const curX = cur.colStart + cur.colSpan / 2;
      const curY = cur.row + cur.rowSpan / 2;
      let bestIndex = -1;
      let bestDistance = Infinity;

      cells.forEach((cell, i) => {
        if (i === cursorIndex) return;
        const x = cell.colStart + cell.colSpan / 2;
        const y = cell.row + cell.rowSpan / 2;
        const relX = x - curX;
        const relY = y - curY;

        const dirX = dx !== 0 ? Math.sign(dx) : 0;
        const dirY = dy !== 0 ? Math.sign(dy) : 0;
        if (dirX !== 0 && relX * dirX <= 0) return;
        if (dirY !== 0 && relY * dirY <= 0) return;

        const distance = Math.abs(relX) + Math.abs(relY);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = i;
        }
      });

      if (bestIndex >= 0) {
        cursorIndex = bestIndex;
        render();
      }
    }

    async function addCurrentSelection() {
      const cell = cells[cursorIndex];
      if (!cell) return;
      const amount = await pickCasinoBet(`「${cell.label}」への賭け金`);
      if (amount > 0) {
        selections.push({ cell, amount });
        updateRouletteSelectionSummary(selections);
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
      } else if (event.key === "Enter" || event.key === "e" || event.key === "E") {
        event.preventDefault(); event.stopImmediatePropagation();
        if (selections.length > 0) {
          finish(selections);
        } else {
          await addCurrentSelection();
        }
      } else if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.decideKeys.includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (selections.length > 0) {
          finish(selections);
        } else {
          await addCurrentSelection();
        }
      } else if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.cancelKeys.includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        finish(selections.length ? selections : null);
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
  await displayMessage("賭けを確定した。ZかSpaceで続ける");
  await waitForDecideKeyPresses(1, "");
  await displayMessage("球を3回押して回す");
  await waitForDecideKeyPresses(3, "");

  const resultNumber = Math.floor(Math.random() * 37); // 0〜36
  const resultColorLabel = resultNumber === 0 ? "" : (CASINO_ROULETTE_RED.has(resultNumber) ? "・赤" : "・黒");
  await displayMessage("ルーレットの球が回る……");
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
