// ===================================================================
// ===== カジノ（施設編集タブで追加できる「カジノ系」施設） =====
// ===== 丁半博打・ルーレット・スロットの3種類の賭け事で遊べる    =====
// ===================================================================

let casinoFacility = null;      // 今開いているカジノ施設のデータ（scenariobuild.jsのfacility）
let casinoReturnTo = null;      // 「戻る」で呼ぶ関数（村メニュー、または拠点の施設一覧）

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

// 賭けるマスを選んでチップを置いていく専用ポップアップ（#casino-roulette-board）。
// ★通常の行き先メニュー（location-menu）は縦一列・2列グリッドしか対応しておらず、
//   ルーレット卓のような「数字の升目＋幅の異なるアウトサイドベット」を矢印キーで
//   自然に行き来させるのには向かないため、専用の2次元カーソル移動を実装する。
//   （現在のマスの中心座標から見て、押した方向にある一番近いマスへジャンプする方式）
// 操作：矢印キーでマス移動／Zでチップを置く／Xで選択中のマスのチップを取り消す（空なら盤面から抜ける）／Cで確定
// 戻り値：{ セル.key: 賭け金 } のオブジェクト（何も置かずに抜けた場合はnull）
function runRouletteBettingBoard() {
  return new Promise((resolve) => {
    const cells = buildRouletteCells();
    let cursorIndex = Math.max(0, cells.findIndex(c => c.key === "red"));
    const bets = {}; // { セルキー: 賭け金 }
    
    const minBet = getCasinoMinBet();
    const facilityMax = casinoFacility.maxBet != null ? Math.max(minBet, casinoFacility.maxBet) : Infinity;
    // ★チップの額面は最低ベット額の倍数（1・5・10・50・100倍）から、1マスの上限を超えない範囲で用意する
    let chipDenoms = [1, 5, 10, 50, 100]
      .map(mult => minBet * mult)
      .filter(v => v <= facilityMax);
    if (chipDenoms.length === 0) chipDenoms = [minBet];
    let chipIndex = 0;
    
    let noticeText = "";
    let noticeTimer = null;
    
    const overlay = document.getElementById("casino-roulette-board");
    const gridEl = document.getElementById("casino-roulette-grid");
    const statusEl = document.getElementById("casino-roulette-status");
    const placeBtn = document.getElementById("casino-roulette-place");
    const clearBtn = document.getElementById("casino-roulette-clear");
    const confirmBtn = document.getElementById("casino-roulette-confirm");
    const chipDecBtn = document.getElementById("casino-roulette-chip-dec");
    const chipIncBtn = document.getElementById("casino-roulette-chip-inc");
    
    function totalBetPlaced() {
      return Object.values(bets).reduce((sum, v) => sum + v, 0);
    }
    
    function showNotice(text) {
      noticeText = text;
      renderStatus();
      clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => { noticeText = ""; renderStatus(); }, 1500);
    }
    
    function renderStatus() {
      if (!statusEl) return;
      statusEl.textContent = noticeText
        || `所持金：${gold}陳／チップ額：${chipDenoms[chipIndex]}陳／合計賭け金：${totalBetPlaced()}陳`;
    }
    
    function render() {
      gridEl.innerHTML = "";
      cells.forEach((cell, i) => {
        const el = document.createElement("div");
        const betAmount = bets[cell.key] || 0;
        el.className = "casino-roulette-cell " + cell.className
          + (i === cursorIndex ? " cursor" : "")
          + (betAmount > 0 ? " has-bet" : "");
        el.style.gridColumn = `${cell.colStart} / span ${cell.colSpan}`;
        el.style.gridRow = `${cell.row} / span ${cell.rowSpan}`;
        el.textContent = cell.label;
        if (betAmount > 0) {
          const chipEl = document.createElement("span");
          chipEl.className = "casino-chip-badge";
          chipEl.textContent = betAmount;
          el.appendChild(chipEl);
        }
        el.onclick = (event) => {
          event.stopPropagation();
          cursorIndex = i;
          placeChip();
        };
        gridEl.appendChild(el);
      });
      renderStatus();
    }
    
    function placeChip() {
      const cell = cells[cursorIndex];
      const amount = chipDenoms[chipIndex];
      const current = bets[cell.key] || 0;
      if (totalBetPlaced() + amount > gold) { showNotice("所持金が足りません"); return; }
      if (current + amount > facilityMax) { showNotice(`このマスは最大${facilityMax}陳までです`); return; }
      bets[cell.key] = current + amount;
      render();
    }
    
    // 選択中のマスのチップを取り消す。既に空なら false を返す（＝盤面から抜ける合図に使う）
    function clearCurrentCell() {
      const cell = cells[cursorIndex];
      if (bets[cell.key]) { delete bets[cell.key]; render(); return true; }
      return false;
    }
    
    function finish(result) {
      overlay.classList.add("hidden");
      window.removeEventListener("keydown", handleKey);
      clearTimeout(noticeTimer);
      resolve(result);
    }
    
    function confirmBets() {
      if (totalBetPlaced() <= 0) { showNotice("チップが置かれていません"); return; }
      finish({ ...bets });
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
      
      if (event.key === "ArrowRight") { event.preventDefault(); event.stopImmediatePropagation(); moveCursor(1, 0); return; }
      if (event.key === "ArrowLeft") { event.preventDefault(); event.stopImmediatePropagation(); moveCursor(-1, 0); return; }
      if (event.key === "ArrowDown") { event.preventDefault(); event.stopImmediatePropagation(); moveCursor(0, 1); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); event.stopImmediatePropagation(); moveCursor(0, -1); return; }
      
      if (event.key === "q" || event.key === "Q") {
        event.preventDefault(); event.stopImmediatePropagation();
        chipIndex = (chipIndex - 1 + chipDenoms.length) % chipDenoms.length; render(); return;
      }
      if (event.key === "e" || event.key === "E") {
        event.preventDefault(); event.stopImmediatePropagation();
        chipIndex = (chipIndex + 1) % chipDenoms.length; render(); return;
      }
      
      if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.decideKeys.includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        placeChip(); return;
      }
      if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.cancelKeys.includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!clearCurrentCell()) finish(null);
        return;
      }
      if (event.key === "c" || event.key === "C") {
        event.preventDefault(); event.stopImmediatePropagation();
        confirmBets(); return;
      }
    }
    
    if (placeBtn) placeBtn.onclick = (event) => { event.stopPropagation(); placeChip(); };
    if (clearBtn) clearBtn.onclick = (event) => { event.stopPropagation(); clearCurrentCell(); };
    if (confirmBtn) confirmBtn.onclick = (event) => { event.stopPropagation(); confirmBets(); };
    if (chipDecBtn) chipDecBtn.onclick = (event) => { event.stopPropagation(); chipIndex = (chipIndex - 1 + chipDenoms.length) % chipDenoms.length; render(); };
    if (chipIncBtn) chipIncBtn.onclick = (event) => { event.stopPropagation(); chipIndex = (chipIndex + 1) % chipDenoms.length; render(); };
    
    render();
    overlay.classList.remove("hidden");
    window.addEventListener("keydown", handleKey);
  });
}

// ===== ルーレットの回転演出（物理法則に沿った等角減速運動でホイールとボールを動かす） =====
// 実物のヨーロピアンルーレットの目の並び順（時計回りの物理配置）
const CASINO_WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];

// 角度は「真上(12時)を0度として時計回りに増える」向きで統一する
function casinoPolarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

function casinoDescribeWedge(cx, cy, innerR, outerR, a0, a1) {
  const p1 = casinoPolarToCartesian(cx, cy, outerR, a0);
  const p2 = casinoPolarToCartesian(cx, cy, outerR, a1);
  const p3 = casinoPolarToCartesian(cx, cy, innerR, a1);
  const p4 = casinoPolarToCartesian(cx, cy, innerR, a0);
  const largeArc = a1 - a0 > 180 ? 1 : 0;
  return `M ${p1.x} ${p1.y} A ${outerR} ${outerR} 0 ${largeArc} 1 ${p2.x} ${p2.y} L ${p3.x} ${p3.y} A ${innerR} ${innerR} 0 ${largeArc} 0 ${p4.x} ${p4.y} Z`;
}

// SVGでホイール（37分割の目＋外枠＋中心のハブ＋ポインター＋ボール）を組み立てる
function buildCasinoRouletteWheelSvg(svg) {
  const NS = "http://www.w3.org/2000/svg";
  svg.innerHTML = "";
  const cx = 150, cy = 150;
  const outerR = 140, innerR = 92, textR = 116;
  const anglePer = 360 / CASINO_WHEEL_ORDER.length;
  
  const rim = document.createElementNS(NS, "circle");
  rim.setAttribute("cx", cx); rim.setAttribute("cy", cy); rim.setAttribute("r", outerR + 4);
  rim.setAttribute("class", "casino-wheel-rim");
  svg.appendChild(rim);
  
  const pocketGroup = document.createElementNS(NS, "g"); // ★この<g>ごと回転させることで、目が並んだままホイールが回る
  CASINO_WHEEL_ORDER.forEach((num, i) => {
    const a0 = i * anglePer;
    const a1 = (i + 1) * anglePer;
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", casinoDescribeWedge(cx, cy, innerR, outerR, a0, a1));
    const colorClass = num === 0 ? "casino-wheel-zero" : (CASINO_ROULETTE_RED.has(num) ? "casino-wheel-red" : "casino-wheel-black");
    path.setAttribute("class", "casino-wheel-pocket " + colorClass);
    pocketGroup.appendChild(path);
    
    const mid = (a0 + a1) / 2;
    const pos = casinoPolarToCartesian(cx, cy, textR, mid);
    const text = document.createElementNS(NS, "text");
    text.setAttribute("x", pos.x); text.setAttribute("y", pos.y);
    text.setAttribute("class", "casino-wheel-number");
    text.setAttribute("transform", `rotate(${mid}, ${pos.x}, ${pos.y})`);
    text.textContent = num;
    pocketGroup.appendChild(text);
  });
  svg.appendChild(pocketGroup);
  
  const hub = document.createElementNS(NS, "circle");
  hub.setAttribute("cx", cx); hub.setAttribute("cy", cy); hub.setAttribute("r", innerR - 4);
  hub.setAttribute("class", "casino-wheel-hub");
  svg.appendChild(hub);
  
  const pointer = document.createElementNS(NS, "polygon"); // ホイールの外、真上に固定表示。止まった時にここへ来た目が結果
  pointer.setAttribute("points", `${cx - 8},${cy - outerR - 10} ${cx + 8},${cy - outerR - 10} ${cx},${cy - outerR + 6}`);
  pointer.setAttribute("class", "casino-wheel-pointer");
  svg.appendChild(pointer);
  
  const ball = document.createElementNS(NS, "circle"); // ★回転する<g>の外に置き、絶対座標を毎フレーム計算して動かす
  ball.setAttribute("r", 6);
  ball.setAttribute("class", "casino-wheel-ball");
  svg.appendChild(ball);
  
  return { pocketGroup, ball, cx, cy, outerR, innerR };
}

// 結果の目（resultNumber）を受け取り、ホイールとボールを回転させる演出を再生する。
// ★等角減速（角速度が時間に対して一定の割合で減っていく＝現実の摩擦による回転体の減速と同じ運動方程式）で
//   ホイールを回し、最終的にresultNumberの目がちょうどポインターの位置で止まるように、開始角速度を逆算する。
//   ボールはホイールと逆回転しながら外側の軌道から徐々に内側へ落ちていき（半径を時間で補間）、
//   軌道を降りきったタイミングでresultNumberの目の位置にちょうど重なるよう角度を合わせ、
//   以降はホイールにくっついて一緒に回転して止まる（＝現実のルーレットで球がポケットに収まる動き）。
// Zキー（決定キー）で演出を早送りできる。
function spinCasinoRouletteWheel(resultNumber) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("casino-roulette-wheel-overlay");
    const svg = document.getElementById("casino-roulette-wheel-svg");
    const { pocketGroup, ball, cx, cy, outerR, innerR } = buildCasinoRouletteWheelSvg(svg);
    
    const anglePer = 360 / CASINO_WHEEL_ORDER.length;
    const resultIndex = CASINO_WHEEL_ORDER.indexOf(resultNumber);
    const pocketLocalAngle = resultIndex * anglePer + anglePer / 2; // ホイール上でのその目の中心角度（未回転時）
    
    const spinDurationMs = 5200; // ホイールが完全に止まるまでの時間
    const ballDropDurationMs = 3000; // ボールが軌道を回っている時間（この後、目に収まる）
    const wheelTurns = 5 + Math.floor(Math.random() * 2); // ホイールの総回転数（5〜6周＋端数）
    const ballTurns = 9 + Math.floor(Math.random() * 2);  // ボールの総回転数（逆回転）
    
    // ホイールの角度(t)：等角減速の運動方程式 θ(t) = θfinal・(2p − p²)（p = t/T）。
    // これはθ'(0)=2θfinal/T（初速）、θ'(T)=0（等加速度で減速して止まる）を満たす、まさに摩擦による減速運動の式
    function wheelAngleAt(t) {
      const p = Math.min(1, t / spinDurationMs);
      return wheelThetaFinal * (2 * p - p * p);
    }
    
    // 「resultNumberの目が、止まった瞬間にポインター(角度0)に来る」ようにホイールの最終角度を逆算する
    const targetMod = ((-pocketLocalAngle % 360) + 360) % 360;
    const wheelThetaFinal = targetMod + 360 * wheelTurns;
    
    // 「ボールが軌道を降りきった瞬間、その時点のホイール上のresultNumberの目の位置にちょうど重なる」
    // ようにボールの最終角度を逆算する（ここで角度を合わせておくことで、軌道から目へ移る瞬間に見た目上の
    // 跳躍が起きない＝連続的な動きになる）
    const lockAbsoluteAngle = wheelAngleAt(ballDropDurationMs) + pocketLocalAngle;
    const lockTargetMod = ((lockAbsoluteAngle % 360) + 360) % 360;
    const ballThetaFinal = lockTargetMod - 360 * (ballTurns + 1); // 負方向（ホイールと逆回転）に大きく回す
    
    function ballAngleAt(t) {
      const p = Math.min(1, t / ballDropDurationMs);
      return ballThetaFinal * (2 * p - p * p);
    }
    
    // ボールの軌道半径：時間とともに外側→内側（目の高さ）へ落ちていく。摩擦で勢いを失うほど内側へ寄っていく
    // イメージで、二次関数的に加速しながら落とす（q²は「はじめゆっくり、後半で一気に」という自然落下の近似）
    function ballRadiusAt(t) {
      const p = Math.min(1, t / ballDropDurationMs);
      const eased = p * p;
      const outerTrackR = outerR - 14;
      const pocketR = innerR + 10;
      return outerTrackR - (outerTrackR - pocketR) * eased;
    }
    
    let skipRequested = false;
    function handleSkipKey(event) {
      if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.decideKeys.includes(event.key)) {
        event.preventDefault();
        skipRequested = true;
      }
    }
    window.addEventListener("keydown", handleSkipKey);
    
    overlay.classList.remove("hidden");
    const startTime = performance.now();
    
    function frame(now) {
      const elapsed = skipRequested ? spinDurationMs : now - startTime;
      
      const wheelAngle = wheelAngleAt(elapsed);
      pocketGroup.setAttribute("transform", `rotate(${wheelAngle}, ${cx}, ${cy})`);
      
      let ballAngle, ballRadius;
      if (elapsed < ballDropDurationMs) {
        ballAngle = ballAngleAt(elapsed);
        ballRadius = ballRadiusAt(elapsed);
      } else {
        // 軌道を降りきった後は、目に収まってホイールと一緒に回転する
        ballAngle = wheelAngle + pocketLocalAngle;
        ballRadius = innerR + 10;
      }
      const pos = casinoPolarToCartesian(cx, cy, ballRadius, ballAngle);
      ball.setAttribute("cx", pos.x);
      ball.setAttribute("cy", pos.y);
      
      if (elapsed >= spinDurationMs) {
        window.removeEventListener("keydown", handleSkipKey);
        setTimeout(() => { overlay.classList.add("hidden"); resolve(); }, 500);
        return;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}

async function startRouletteGame() {
  const minBet = getCasinoMinBet();
  if (gold < minBet) {
    changeSpeaker(casinoFacility.name || "ルーレット台");
    await displayMessage(`すまないが、最低${minBet}陳は無いと賭けられないよ……`);
    showCasinoMenu();
    return;
  }
  
  hideLocationMenu();
  const bets = await runRouletteBettingBoard();
  if (!bets || Object.keys(bets).length === 0) { showCasinoMenu(); return; }
  
  const cellsByKey = {};
  buildRouletteCells().forEach(c => { cellsByKey[c.key] = c; });
  
  changeSpeaker(casinoFacility.name || "ルーレット台");
  await displayMessage("さあ、賭けは締め切った。ルーレットが回るぞ……");
  
  const resultNumber = Math.floor(Math.random() * 37); // 0〜36
  await spinCasinoRouletteWheel(resultNumber); // ★物理法則（等角減速）に基づく回転演出。Zキーで早送り可
  
  const resultColorLabel = resultNumber === 0 ? "" : (CASINO_ROULETTE_RED.has(resultNumber) ? "・赤" : "・黒");
  await displayMessage(`球が止まった……「${resultNumber}${resultColorLabel}」だ！`);
  
  let totalProfit = 0;
  let totalLoss = 0;
  const resultLines = [];
  Object.keys(bets).forEach(key => {
    const cell = cellsByKey[key];
    const amount = bets[key];
    if (!cell) return;
    if (cell.matches(resultNumber)) {
      const profit = amount * cell.payoutMultiple;
      totalProfit += profit;
      resultLines.push(`「${cell.label}」に${amount}陳 → 的中！ +${profit}陳`);
    } else {
      totalLoss += amount;
      resultLines.push(`「${cell.label}」に${amount}陳 → 外れ`);
    }
  });
  changeGold(totalProfit - totalLoss);
  await displayMessage(resultLines.join("\n"));
  
  const net = totalProfit - totalLoss;
  if (net > 0) {
    await displayMessage(`差し引き${net}陳の儲けだ！`);
  } else if (net < 0) {
    await displayMessage(`差し引き${-net}陳の損だ……`);
  } else {
    await displayMessage("差し引きゼロ、トントンだったな。");
  }
  renderStatusHUD();
  showCasinoMenu();
}

