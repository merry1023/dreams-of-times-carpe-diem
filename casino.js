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

function pickWeightedSlotSymbol() {
  const total = CASINO_SLOT_SYMBOLS.reduce((sum, s) => sum + s.weight, 0);
  let r = Math.random() * total;
  for (const symbol of CASINO_SLOT_SYMBOLS) {
    if (r < symbol.weight) return symbol;
    r -= symbol.weight;
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
  note.textContent = "同じ絵柄が3つ揃うと掛け金×倍率、2つだけ揃うと掛け金の半分が戻ってくる";
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
  const minBet = getCasinoMinBet();
  const maxBet = getCasinoMaxBet();
  const step = maxBet >= 2000 ? 100 : (maxBet >= 200 ? 10 : 1);

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

  const updateBetDisplay = (nextBet) => {
    if (betDisplay) betDisplay.textContent = `${nextBet}陳`;
    if (betDecBtn) betDecBtn.disabled = nextBet <= minBet;
    if (betIncBtn) betIncBtn.disabled = nextBet >= maxBet;
    if (stopButton) {
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
      casinoSlotCancelResolver = null;
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
    // ★「やめる」ボタン・Xキーどちらでも、ここにいる間は即座に抜けられるようにしておく
    casinoSlotCancelResolver = () => resolveBet(null);
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
  const boardOverlay = document.getElementById("casino-roulette-board");
  const panel = boardOverlay ? boardOverlay.querySelector(".casino-roulette-panel") : null;
  const scene = document.getElementById("casino-roulette-wheel-scene");
  const wheel = document.getElementById("casino-roulette-wheel");
  const ball = document.getElementById("casino-roulette-ball");
  if (!boardOverlay || !scene || !wheel || !ball) return Promise.resolve();

  // ★バグ修正：賭けを確定した時点でpickRouletteBets()側が#casino-roulette-board自体を非表示にしていたため、
  //   その中にある#casino-roulette-wheel-sceneだけ表示クラスを付けても、親ごと隠れたままで演出が一切見えなかった。
  //   演出中だけ盤面の枠を再度表示し、グリッドなど不要な部分はCSSで隠す
  boardOverlay.classList.remove("hidden");
  if (panel) panel.classList.add("spin-only");
  setRouletteSpinSceneVisible(true);
  const duration = 1800;
  wheel.style.animation = `roulette-wheel-spin ${duration}ms linear infinite`;
  ball.style.animation = `roulette-ball-orbit ${duration}ms linear infinite`;

  return new Promise((resolve) => {
    setTimeout(() => {
      wheel.style.animation = "none";
      ball.style.animation = "none";
      setRouletteSpinSceneVisible(false);
      if (panel) panel.classList.remove("spin-only");
      boardOverlay.classList.add("hidden"); // ★演出が終わったらまた盤面ごと隠す
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
          const amount = await pickCasinoBet(`「${cell.label}」への賭け金`);
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
