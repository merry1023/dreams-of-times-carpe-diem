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

// ===== ②スロット（3リール。絵柄はシナリオエディタで画像を指定していればそちらを優先、無ければ絵文字） =====
const CASINO_SLOT_SYMBOLS = [
  { key: "grape", emoji: "🍇", weight: 35, payout: 2 },
  { key: "bell",  emoji: "🔔", weight: 25, payout: 4 },
  { key: "star",  emoji: "⭐", weight: 20, payout: 6 },
  { key: "gem",   emoji: "💎", weight: 12, payout: 10 },
  { key: "seven", emoji: "7",  weight: 8,  payout: 20 }
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

// ★施設編集タブ（scenariobuild.js）でfacility.slotImages[symbol.key]に画像パスが登録されていれば、
//   絵文字の代わりにその画像を表示する。displayMessageの中身はtypeText側でHTMLタグとして解釈されるので、
//   ここではメッセージ文中に埋め込む用のHTML文字列を組み立てる
function getSlotSymbolMarkup(symbol) {
  const imagePath = casinoFacility && casinoFacility.slotImages && casinoFacility.slotImages[symbol.key];
  if (imagePath) {
    return `<img src="${imagePath}" class="casino-slot-symbol-img" alt="${symbol.key}">`;
  }
  return `<span class="casino-slot-symbol-emoji">${symbol.emoji}</span>`;
}

async function startSlotGame() {
  prepareCasinoConversationFocus();
  const bet = await pickCasinoBet("スロットの賭け金");
  if (bet <= 0) { showCasinoMenu(); return; }
  
  changeSpeaker(casinoFacility.name || "スロット台");
  await displayMessage("レバーを引いた……カラカラカラ……");
  
  const reels = [pickWeightedSlotSymbol(), pickWeightedSlotSymbol(), pickWeightedSlotSymbol()];
  const reelMarkup = reels.map(getSlotSymbolMarkup).join("　");
  await displayMessage(reelMarkup);
  
  const allMatch = reels[0].key === reels[1].key && reels[1].key === reels[2].key;
  const twoMatch = !allMatch && (reels[0].key === reels[1].key || reels[1].key === reels[2].key || reels[0].key === reels[2].key);
  
  if (allMatch) {
    const profit = bet * reels[0].payout;
    changeGold(profit);
    await displayMessage(`大当たりだ！ 絵柄が3つ揃って${profit}陳の儲けだ！`);
  } else if (twoMatch) {
    const refund = Math.ceil(bet * 0.5);
    changeGold(refund - bet); // 賭け金の半分だけ戻ってくる（小当たり＝実質は半損）
    await displayMessage(`惜しい、2つだけ揃った。賭け金の半分、${refund}陳だけ戻ってきた。`);
  } else {
    changeGold(-bet);
    await displayMessage(`残念、揃わなかった。${bet}陳は没収だな……`);
  }
  renderStatusHUD();
  showCasinoMenu();
}

// ===== ③ルーレット（矢印キー/タップでマスを選んでから賭け金を決める） =====
const CASINO_ROULETTE_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

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
//   （現在のマスの中心座標から見て、押した方向にある一番近いマスへジャンプする方式）
function pickRouletteBet() {
  return new Promise((resolve) => {
    const cells = buildRouletteCells();
    let cursorIndex = Math.max(0, cells.findIndex(c => c.key === "red"));
    
    const overlay = document.getElementById("casino-roulette-board");
    const gridEl = document.getElementById("casino-roulette-grid");
    const confirmBtn = document.getElementById("casino-roulette-confirm");
    const cancelBtn = document.getElementById("casino-roulette-cancel");
    
    function render() {
      gridEl.innerHTML = "";
      cells.forEach((cell, i) => {
        const el = document.createElement("div");
        el.className = "casino-roulette-cell " + cell.className + (i === cursorIndex ? " cursor" : "");
        el.style.gridColumn = `${cell.colStart} / span ${cell.colSpan}`;
        el.style.gridRow = `${cell.row} / span ${cell.rowSpan}`;
        el.textContent = cell.label;
        el.onclick = (event) => {
          event.stopPropagation();
          cursorIndex = i;
          finish(cell);
        };
        gridEl.appendChild(el);
      });
    }
    
    function finish(result) {
      overlay.classList.add("hidden");
      window.removeEventListener("keydown", handleKey);
      resolve(result);
    }
    
    // 現在のマスの中心座標から見て、指定方向(dx, dy)にある一番近いマスへカーソルを移す
    function moveCursor(dx, dy) {
      const cur = cells[cursorIndex];
      const curX = cur.colStart + cur.colSpan / 2;
      const curY = cur.row + cur.rowSpan / 2;
      let bestIndex = -1;
      let bestScore = Infinity;
      cells.forEach((c, i) => {
        if (i === cursorIndex) return;
        const x = c.colStart + c.colSpan / 2;
        const y = c.row + c.rowSpan / 2;
        const relX = x - curX;
        const relY = y - curY;
        const primary = dx !== 0 ? relX * dx : relY * dy;
        if (primary <= 0.05) return; // 押した方向と逆・真横のマスは候補にしない
        const secondary = dx !== 0 ? Math.abs(relY) : Math.abs(relX);
        const score = primary + secondary * 3; // 方向がまっすぐ揃っているマスを優先
        if (score < bestScore) { bestScore = score; bestIndex = i; }
      });
      if (bestIndex >= 0) { cursorIndex = bestIndex; render(); }
    }
    
    function handleKey(event) {
      if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return;
      if (typeof isGameDialogOpen !== "undefined" && isGameDialogOpen) return;
      if (event.repeat) return;
      if (event.key === "ArrowRight") { event.preventDefault(); event.stopImmediatePropagation(); moveCursor(1, 0); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); event.stopImmediatePropagation(); moveCursor(-1, 0); }
      else if (event.key === "ArrowDown") { event.preventDefault(); event.stopImmediatePropagation(); moveCursor(0, 1); }
      else if (event.key === "ArrowUp") { event.preventDefault(); event.stopImmediatePropagation(); moveCursor(0, -1); }
      else if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.decideKeys.includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        finish(cells[cursorIndex]);
      } else if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.cancelKeys.includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        finish(null);
      }
    }
    
    if (confirmBtn) confirmBtn.onclick = (event) => { event.stopPropagation(); finish(cells[cursorIndex]); };
    if (cancelBtn) cancelBtn.onclick = (event) => { event.stopPropagation(); finish(null); };
    
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
  
  const cell = await pickRouletteBet();
  if (!cell) { showCasinoMenu(); return; }
  
  const bet = await pickCasinoBet(`「${cell.label}」への賭け金`);
  if (bet <= 0) { showCasinoMenu(); return; }
  
  changeSpeaker(casinoFacility.name || "ルーレット台");
  await displayMessage("ルーレットの球が回る……");
  
  const resultNumber = Math.floor(Math.random() * 37); // 0〜36
  const resultColorLabel = resultNumber === 0 ? "" : (CASINO_ROULETTE_RED.has(resultNumber) ? "・赤" : "・黒");
  await displayMessage(`球が止まった……「${resultNumber}${resultColorLabel}」だ！`);
  
  if (cell.matches(resultNumber)) {
    const profit = bet * cell.payoutMultiple;
    changeGold(profit);
    await displayMessage(`大当たりだ！ ${profit}陳の儲けだ！`);
  } else {
    changeGold(-bet);
    await displayMessage(`残念、外れだ。${bet}陳は没収だな……`);
  }
  renderStatusHUD();
  showCasinoMenu();
}
