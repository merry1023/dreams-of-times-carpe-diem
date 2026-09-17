// auction.js
// ===================================================================
// ===== オークション（施設編集タブで追加できる「オークション系」施設） =====
// ===== 施設ごとの出品候補からランク帯抽選→NPCと競り合って入札で競り落とす =====
// ===================================================================
//
// 流れ：
//   ①施設の「オークションに参加する」を選ぶ（開催日でなければ「また次回お越しください」）
//   ②開催日の最初の参加時だけ、施設ごとに決めた手数料（既定1000陳）を払う
//   ③1回目（F～C）→2回目（C～AAA）→（30%の確率のみ）3回目（S～X）と、
//     ランク帯ごとに施設の出品候補（重み付き抽選）から1点出品される
//   ④各回、プレイヤーはテンキーで入札額を決める（「お宝鑑定団」ならヒントで価格帯が分かる）
//   ⑤NPC入札者（4～9人、各々に予算あり）と競り合い、勝てば購入・負ければ入札額の2割没収
//   ⑥競り落とせなかった出品は、その場では結果を明かさず「出品の結果を聞く」に一旦貯めておく
//     （後で聞くと、真価の±30%で誰かが落札した／流札で返却された、のどちらかが分かる）

// ===== 各種しきい値 =====
const AUCTION_ROUND_RANK_RANGES = [
  ["F", "C"],    // 1回目
  ["C", "AAA"],  // 2回目
  ["S", "X"],    // 3回目（下のAUCTION_ROUND3_CHANCEの確率でのみ開催）
];
const AUCTION_ROUND3_CHANCE = 0.3;            // ★3回目まで開催される確率
const AUCTION_NPC_MIN_COUNT = 4;              // ★NPC入札者の人数（下限）
const AUCTION_NPC_MAX_COUNT = 9;              // ★NPC入札者の人数（上限）
const AUCTION_NPC_BUDGET_MIN_RATIO = 0.8;     // ★NPCの予算＝真価×0.8～1.5倍
const AUCTION_NPC_BUDGET_MAX_RATIO = 1.5;
const AUCTION_NPC_RAISE_MIN_RATIO = 0.05;     // ★NPCが上乗せする額＝現在価格の5～20%
const AUCTION_NPC_RAISE_MAX_RATIO = 0.2;
const AUCTION_LOSE_PENALTY_RATIO = 0.2;       // ★負けたら、その回の最終入札額の2割没収
const AUCTION_APPRAISAL_HINT_RATIO = 0.3;     // ★なんでも鑑定で分かる価格帯（真価の±30%）
const AUCTION_DEFAULT_INTERVAL_DAYS = 4;      // ★施設で未設定の場合の既定の開催間隔
const AUCTION_DEFAULT_FEE = 1000;             // ★施設で未設定の場合の既定の手数料
const AUCTION_POST_SALE_VARIANCE = 0.3;       // ★競り落とせなかった品は真価の±30%で誰かに落札される
const AUCTION_UNSOLD_CHANCE_LOWRANK = 0.5;    // ★F・Eランクは「流札」（誰にも落札されず返却）になりやすい
const AUCTION_UNSOLD_CHANCE_NORMAL = 0.1;     // ★それ以外のランクでも、一定確率で「流札」になる

let auctionFacility = null; // 今開いているオークション施設のデータ（scenariobuild.jsのfacility）
let auctionReturnTo = null; // 「戻る」で呼ぶ関数（町メニュー、または拠点の施設一覧）

// ===== 入り口 =====
// openCustomFacility（town.js）から呼ばれる
async function openAuction(facility, returnTo) {
  auctionFacility = facility;
  auctionReturnTo = typeof returnTo === "function" ? returnTo : openTownMenu;
  ensureAuctionPlayerState(facility.id);
  showAuctionMenu();
}

// ★施設ごとの進行状況をplayerに保存する（セーブ/ロード対象。施設が複数あってもidで区別する）
function ensureAuctionPlayerState(facilityId) {
  if (!player) return null;
  if (!player.auctionState || typeof player.auctionState !== "object") player.auctionState = {};
  if (!player.auctionState[facilityId] || typeof player.auctionState[facilityId] !== "object") {
    player.auctionState[facilityId] = { session: null, pendingResults: [] };
  }
  return player.auctionState[facilityId];
}

function getAuctionState() {
  return ensureAuctionPlayerState(auctionFacility.id);
}

function getAuctionIntervalDays() {
  return auctionFacility.auctionIntervalDays || AUCTION_DEFAULT_INTERVAL_DAYS;
}

function getAuctionFee() {
  return auctionFacility.auctionFee != null ? auctionFacility.auctionFee : AUCTION_DEFAULT_FEE;
}

function getCurrentGameDay() {
  return (player && typeof player.daysSinceTransfer === "number") ? player.daysSinceTransfer : 0;
}

// ★「4日に1回」は、ゲーム内経過日数（daysSinceTransfer）が開催間隔で割り切れる日を開催日とする、
//   施設ごとに独立した固定スケジュール。逃すと本当に次の周期まで待つことになる
function isAuctionDayToday() {
  const interval = Math.max(1, getAuctionIntervalDays());
  return getCurrentGameDay() % interval === 0;
}

// ===== メインメニュー =====
function showAuctionMenu() {
  const state = getAuctionState();
  changeSpeaker(auctionFacility.name || "オークション会場");
  const resultCount = state.pendingResults.length;
  showLocationMenu([
    { label: "オークションに参加する", action: () => tryStartAuctionDay() },
    {
      label: resultCount > 0 ? `出品の結果を聞く（${resultCount}件）` : "出品の結果を聞く",
      action: () => hearAuctionResults(),
    },
    { label: "やめる", action: () => auctionReturnTo() },
  ]);
}

// ===== 1日分のセッション開始 =====
async function tryStartAuctionDay() {
  const state = getAuctionState();
  const today = getCurrentGameDay();
  
  // ★セッションが無い、または日付が変わっていたら、新しい開催日として作り直す
  if (!state.session || state.session.day !== today) {
    if (!isAuctionDayToday()) {
      changeSpeaker(auctionFacility.name || "オークション会場");
      await displayMessage("「本日は開催日ではないようだ。また次回お越しください。」", { allowSubFocus: true });
      showAuctionMenu();
      return;
    }
    const totalRounds = Math.random() < AUCTION_ROUND3_CHANCE ? 3 : 2;
    state.session = { day: today, feePaid: false, totalRounds, roundIndex: 0 };
  }
  
  if (state.session.roundIndex >= state.session.totalRounds) {
    changeSpeaker(auctionFacility.name || "オークション会場");
    await displayMessage("「本日の競りはもう全て終わってしまったようだ。また次回お越しください。」", { allowSubFocus: true });
    showAuctionMenu();
    return;
  }
  
  if (!state.session.feePaid) {
    const fee = getAuctionFee();
    if (fee > 0 && gold < fee) {
      changeSpeaker(auctionFacility.name || "オークション会場");
      await displayMessage(`「参加には手数料${fee}陳が必要だが、持ち金が足りないようだ。」`, { allowSubFocus: true });
      showAuctionMenu();
      return;
    }
    if (fee > 0) {
      changeGold(-fee);
      renderStatusHUD();
      changeSpeaker(auctionFacility.name || "オークション会場");
      await displayMessage(`手数料${fee}陳を支払った。`, { allowSubFocus: true });
    }
    state.session.feePaid = true;
  }
  
  await runAuctionRound();
}

// ===== ラウンド進行 =====
async function runAuctionRound() {
  const state = getAuctionState();
  const session = state.session;
  const [lowRank, highRank] = AUCTION_ROUND_RANK_RANGES[session.roundIndex];
  
  const candidates = (auctionFacility.auctionItemPool || [])
    .filter(entry => entry && entry.itemId && typeof ITEM_MASTER !== "undefined" && ITEM_MASTER[entry.itemId])
    .filter(entry => {
      const idx = rankIndex(ITEM_MASTER[entry.itemId].rank);
      return idx >= rankIndex(lowRank) && idx <= rankIndex(highRank);
    });
  
  if (candidates.length === 0) {
    changeSpeaker(auctionFacility.name || "オークション会場");
    await displayMessage("「今回の帯にふさわしい出品が用意できなかったようだ……。」", { allowSubFocus: true });
    session.roundIndex++;
    await proceedToNextRoundOrFinishDay();
    return;
  }
  
  const chosenEntry = pickWeightedAuctionItem(candidates);
  const item = ITEM_MASTER[chosenEntry.itemId];
  const trueValue = rollAuctionTrueValue(item);
  
  changeSpeaker(auctionFacility.name || "オークション会場");
  const roundLabel = session.roundIndex + 1;
  await displayMessage(
    `（${roundLabel}回目の競り／ランク${lowRank}～${highRank}）\n「${item.name}」（ランク：${item.rank}）が出品された。\n${item.description || ""}`,
    { allowSubFocus: true }
  );
  
  showAuctionRoundMenu(item, trueValue, null);
}

function pickWeightedAuctionItem(candidates) {
  const totalWeight = candidates.reduce((sum, c) => sum + (c.weight || 1), 0);
  let roll = Math.random() * totalWeight;
  for (const c of candidates) {
    roll -= (c.weight || 1);
    if (roll <= 0) return c;
  }
  return candidates[candidates.length - 1];
}

// ★アイテムマスターのtrueValueを直接書き換えず、appraisal.jsと同じ変動幅（±15%）で
//   「今回出品された1点」の真価をその場だけ算出する
function rollAuctionTrueValue(itemMaster) {
  const base = itemMaster.trueValue || itemMaster.listedPrice || 0;
  const varianceRatio = (typeof APPRAISAL_VALUE_VARIANCE_RATIO === "number") ? APPRAISAL_VALUE_VARIANCE_RATIO : 0.15;
  const variance = Math.round(base * varianceRatio);
  if (variance <= 0) return Math.max(1, base);
  const rolled = base + Math.floor(Math.random() * (variance * 2 + 1)) - variance;
  return Math.max(1, rolled);
}

// ===== 出品を見て、鑑定／入札／見送りを選ぶ画面 =====
function showAuctionRoundMenu(item, trueValue, hintRange) {
  changeSpeaker(auctionFacility.name || "オークション会場");
  const options = [];
  
  if (!hintRange && player && player.class === "お宝鑑定団") {
    options.push({
      label: "なんでも鑑定で価格帯を見る",
      action: () => useAuctionAppraisalHint(item, trueValue),
    });
  }
  
  options.push({ label: "入札する", action: () => startAuctionBidding(item, trueValue) });
  options.push({ label: "今回は見送る", action: () => resolveAuctionRoundAsSkipped(item, trueValue) });
  showLocationMenu(options);
}

async function useAuctionAppraisalHint(item, trueValue) {
  // ★通常の「なんでも鑑定」と同じく、自分の冒険者ランク+1までしか鑑定できない
  if (rankIndex(item.rank) > rankIndex(player.rank) + 1) {
    changeSpeaker("鑑定士");
    await displayMessage("「見た事ないアイテムすぎて鑑定できぬぞよ。」", { allowSubFocus: true });
    showAuctionRoundMenu(item, trueValue, null);
    return;
  }
  const lo = Math.max(1, Math.round(trueValue * (1 - AUCTION_APPRAISAL_HINT_RATIO)));
  const hi = Math.round(trueValue * (1 + AUCTION_APPRAISAL_HINT_RATIO));
  changeSpeaker("鑑定士");
  await displayMessage(`「うーむ……このあたりだと思うぞよ。${lo}陳～${hi}陳、といったところじゃな。」`, { allowSubFocus: true });
  showAuctionRoundMenu(item, trueValue, [lo, hi]);
}

// ===== 入札・競り合い =====
function generateAuctionNpcs(trueValue) {
  const count = AUCTION_NPC_MIN_COUNT + Math.floor(Math.random() * (AUCTION_NPC_MAX_COUNT - AUCTION_NPC_MIN_COUNT + 1));
  const npcs = [];
  for (let i = 0; i < count; i++) {
    const ratio = AUCTION_NPC_BUDGET_MIN_RATIO + Math.random() * (AUCTION_NPC_BUDGET_MAX_RATIO - AUCTION_NPC_BUDGET_MIN_RATIO);
    npcs.push({ budget: Math.max(1, Math.round(trueValue * ratio)), active: true });
  }
  return npcs;
}

async function startAuctionBidding(item, trueValue) {
  if (gold <= 0) {
    changeSpeaker(auctionFacility.name || "オークション会場");
    await displayMessage("「持ち金が無くては入札できないようだ。」", { allowSubFocus: true });
    showAuctionRoundMenu(item, trueValue, null);
    return;
  }
  
  const initialBid = await pickAuctionBidAmount({
    title: `「${item.name}」への入札額`,
    min: 1,
    max: gold,
  });
  if (initialBid === null) {
    showAuctionRoundMenu(item, trueValue, null); // ★入札額入力をキャンセル＝鑑定/見送りの選択画面に戻る
    return;
  }
  
  const npcs = generateAuctionNpcs(trueValue);
  await runAuctionBiddingWar(item, trueValue, npcs, initialBid);
}

async function runAuctionBiddingWar(item, trueValue, npcs, playerBid) {
  let currentPrice = playerBid;
  let lastPlayerBid = playerBid;
  
  for (;;) {
    // ★現在の価格を基準に、まだ生きているNPCそれぞれが「上乗せするか降りるか」を判定する
    let bestChallenge = null; // { amount }
    npcs.forEach(npc => {
      if (!npc.active) return;
      if (npc.budget <= currentPrice) { npc.active = false; return; } // ★既に予算オーバーなら黙って撤退
      const giveUpChance = Math.min(1, currentPrice / npc.budget); // ★価格が予算に近づくほど降りやすくなる
      if (Math.random() < giveUpChance) { npc.active = false; return; }
      const raiseRatio = AUCTION_NPC_RAISE_MIN_RATIO + Math.random() * (AUCTION_NPC_RAISE_MAX_RATIO - AUCTION_NPC_RAISE_MIN_RATIO);
      const raiseAmount = Math.max(1, Math.round(currentPrice * raiseRatio));
      const proposedAmount = Math.min(npc.budget, currentPrice + raiseAmount);
      if (proposedAmount <= currentPrice) { npc.active = false; return; }
      if (!bestChallenge || proposedAmount > bestChallenge.amount) bestChallenge = { amount: proposedAmount };
    });
    
    if (!bestChallenge) {
      await resolveAuctionRoundAsWon(item, currentPrice);
      return;
    }
    
    currentPrice = bestChallenge.amount;
    changeSpeaker(auctionFacility.name || "オークション会場");
    await displayMessage(`他の入札者が「${item.name}」に${currentPrice}陳まで値を付けてきた！`, { allowSubFocus: true });
    
    if (currentPrice >= gold) {
      changeSpeaker(auctionFacility.name || "オークション会場");
      await displayMessage("「これ以上の持ち金が無く、諦めるしかなさそうだ……。」", { allowSubFocus: true });
      await resolveAuctionRoundAsLost(item, trueValue, lastPlayerBid);
      return;
    }
    
    const choice = await askAuctionRaiseOrGiveUp(item, currentPrice);
    if (choice === "giveup") {
      await resolveAuctionRoundAsLost(item, trueValue, lastPlayerBid);
      return;
    }
    
    const nextBid = await pickAuctionBidAmount({
      title: `「${item.name}」への入札額（現在${currentPrice}陳）`,
      min: currentPrice + 1,
      max: gold,
    });
    if (nextBid === null) {
      await resolveAuctionRoundAsLost(item, trueValue, lastPlayerBid);
      return;
    }
    lastPlayerBid = nextBid;
    currentPrice = nextBid;
  }
}

function askAuctionRaiseOrGiveUp(item, currentPrice) {
  return new Promise(resolve => {
    changeSpeaker(auctionFacility.name || "オークション会場");
    showLocationMenu([
      { label: `さらに上乗せする（現在${currentPrice}陳）`, action: () => resolve("raise") },
      { label: "ここで諦める", action: () => resolve("giveup") },
    ]);
  });
}

// ===== ラウンドの決着 =====
async function resolveAuctionRoundAsWon(item, price) {
  changeGold(-price);
  addItem(item.id, 1);
  renderStatusHUD();
  changeSpeaker(auctionFacility.name || "オークション会場");
  await displayMessage(`${price}陳で「${item.name}」を競り落とした！`, { allowSubFocus: true });
  
  const state = getAuctionState();
  state.session.roundIndex++;
  await proceedToNextRoundOrFinishDay();
}

async function resolveAuctionRoundAsLost(item, trueValue, lastBid) {
  const penalty = Math.max(0, Math.round(lastBid * AUCTION_LOSE_PENALTY_RATIO));
  if (penalty > 0) changeGold(-penalty);
  renderStatusHUD();
  changeSpeaker(auctionFacility.name || "オークション会場");
  await displayMessage(`競り負けてしまった……。入札額の一部、${penalty}陳を手数料として支払った。`, { allowSubFocus: true });
  
  queueAuctionPendingResult(item, trueValue);
  const state = getAuctionState();
  state.session.roundIndex++;
  await proceedToNextRoundOrFinishDay();
}

async function resolveAuctionRoundAsSkipped(item, trueValue) {
  changeSpeaker(auctionFacility.name || "オークション会場");
  await displayMessage(`今回は見送ることにした。`, { allowSubFocus: true });
  
  queueAuctionPendingResult(item, trueValue);
  const state = getAuctionState();
  state.session.roundIndex++;
  await proceedToNextRoundOrFinishDay();
}

// ★負けた／見送った出品の行方を今すぐ決めておき、「出品の結果を聞く」で後から見られるように貯めておく
function queueAuctionPendingResult(item, trueValue) {
  const state = getAuctionState();
  const isLowRank = item.rank === "F" || item.rank === "E";
  const unsoldChance = isLowRank ? AUCTION_UNSOLD_CHANCE_LOWRANK : AUCTION_UNSOLD_CHANCE_NORMAL;
  
  if (Math.random() < unsoldChance) {
    state.pendingResults.push({ itemName: item.name, outcome: "unsold" });
  } else {
    const soldPrice = Math.max(1, Math.round(trueValue * (1 + (Math.random() * 2 - 1) * AUCTION_POST_SALE_VARIANCE)));
    state.pendingResults.push({ itemName: item.name, outcome: "sold", price: soldPrice });
  }
}

// ★1回分の決着がついたら、同じ日のうちに次の回があればすぐ続ける。無ければ本日終了のメッセージを出す
async function proceedToNextRoundOrFinishDay() {
  const state = getAuctionState();
  const session = state.session;
  if (session.roundIndex < session.totalRounds) {
    await runAuctionRound();
    return;
  }
  changeSpeaker(auctionFacility.name || "オークション会場");
  await displayMessage("「本日の競りはこれで全て終わりだ。また次回お越しください。」", { allowSubFocus: true });
  showAuctionMenu();
}

// ===== 出品の結果を聞く =====
async function hearAuctionResults() {
  const state = getAuctionState();
  if (state.pendingResults.length === 0) {
    changeSpeaker(auctionFacility.name || "オークション会場");
    await displayMessage("「特に報告することは無いようだ。」", { allowSubFocus: true });
    showAuctionMenu();
    return;
  }
  
  changeSpeaker(auctionFacility.name || "オークション会場");
  const lines = state.pendingResults.map(r => {
    return r.outcome === "sold"
      ? `・「${r.itemName}」は${r.price}陳で他の誰かに競り落とされたそうだ。`
      : `・「${r.itemName}」は結局誰にも競り落とされず、蔵に返されたそうだ。`;
  });
  await displayMessage(lines.join("\n"), { allowSubFocus: true });
  
  state.pendingResults = [];
  showAuctionMenu();
}

// ===================================================================
// ===== 入札額のテンキー入力 =====
// ===================================================================
// スマホはタップ、キーボードは矢印キーでボタンを選んでZ/スペースで入力、バックスペースもある。
// pickQuantity（town.js）と同じく、開いている間だけ専用のkeydownリスナーを追加する方式。
const AUCTION_KEYPAD_LAYOUT = [
  { type: "digit", value: "7" }, { type: "digit", value: "8" }, { type: "digit", value: "9" },
  { type: "digit", value: "4" }, { type: "digit", value: "5" }, { type: "digit", value: "6" },
  { type: "digit", value: "1" }, { type: "digit", value: "2" }, { type: "digit", value: "3" },
  { type: "backspace" },         { type: "digit", value: "0" }, { type: "confirm" },
];
const AUCTION_KEYPAD_COLS = 3;

let auctionKeypadButtonsBuilt = false;

function buildAuctionKeypadButtonsOnce() {
  if (auctionKeypadButtonsBuilt) return;
  const gridEl = document.getElementById("auction-bid-keypad-grid");
  if (!gridEl) return;
  gridEl.innerHTML = "";
  AUCTION_KEYPAD_LAYOUT.forEach((cell, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "auction-bid-keypad-btn";
    btn.dataset.index = String(index);
    if (cell.type === "digit") btn.textContent = cell.value;
    else if (cell.type === "backspace") btn.textContent = "←消す";
    else btn.textContent = "決定";
    if (cell.type === "confirm") btn.classList.add("auction-bid-keypad-btn-confirm");
    if (cell.type === "backspace") btn.classList.add("auction-bid-keypad-btn-backspace");
    gridEl.appendChild(btn);
  });
  auctionKeypadButtonsBuilt = true;
}

function pickAuctionBidAmount({ title, min, max }) {
  return new Promise((resolve) => {
    buildAuctionKeypadButtonsOnce();
    
    const overlay = document.getElementById("auction-bid-keypad");
    const labelEl = document.getElementById("auction-bid-keypad-label");
    const displayEl = document.getElementById("auction-bid-keypad-display");
    const errorEl = document.getElementById("auction-bid-keypad-error");
    const gridEl = document.getElementById("auction-bid-keypad-grid");
    const buttons = gridEl ? Array.from(gridEl.querySelectorAll(".auction-bid-keypad-btn")) : [];
    
    let valueStr = "";
    let cursorIndex = AUCTION_KEYPAD_LAYOUT.findIndex(c => c.type === "confirm");
    
    function currentValue() {
      return valueStr === "" ? 0 : parseInt(valueStr, 10);
    }
    
    function render() {
      if (labelEl) labelEl.textContent = `${title}（${min}～${max}陳）`;
      if (displayEl) displayEl.textContent = `${currentValue()}陳`;
      if (errorEl) errorEl.classList.add("hidden");
      buttons.forEach((btn, i) => btn.classList.toggle("cursor", i === cursorIndex));
    }
    
    function showError(message) {
      if (!errorEl) return;
      errorEl.textContent = message;
      errorEl.classList.remove("hidden");
    }
    
    function pressDigit(digit) {
      const next = valueStr + digit;
      // ★桁が増えすぎて上限を超える入力は、そのまま無視する（例：上限9999のところに"12345"は打てない）
      const nextNum = parseInt(next, 10);
      if (nextNum > max) { showError(`最大${max}陳までしか入札できない。`); return; }
      valueStr = next.replace(/^0+(?=\d)/, ""); // ★先頭の余計な0は詰める
      render();
    }
    
    function pressBackspace() {
      valueStr = valueStr.slice(0, -1);
      render();
    }
    
    function pressConfirm() {
      const value = currentValue();
      if (value < min) { showError(`最低${min}陳は必要。`); return; }
      if (value > max) { showError(`最大${max}陳までしか入札できない。`); return; }
      finish(value);
    }
    
    function pressCell(index) {
      const cell = AUCTION_KEYPAD_LAYOUT[index];
      if (!cell) return;
      if (cell.type === "digit") pressDigit(cell.value);
      else if (cell.type === "backspace") pressBackspace();
      else pressConfirm();
    }
    
    function finish(result) {
      if (overlay) overlay.classList.add("hidden");
      buttons.forEach(btn => { btn.onclick = null; });
      window.removeEventListener("keydown", handleKey);
      resolve(result);
    }
    
    function handleKey(event) {
      if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return;
      if (typeof isGameDialogOpen !== "undefined" && isGameDialogOpen) return;
      if (event.repeat) return;
      const rows = Math.ceil(AUCTION_KEYPAD_LAYOUT.length / AUCTION_KEYPAD_COLS);
      const row = Math.floor(cursorIndex / AUCTION_KEYPAD_COLS);
      const col = cursorIndex % AUCTION_KEYPAD_COLS;
      
      if (event.key === "ArrowRight") {
        event.preventDefault(); event.stopImmediatePropagation();
        cursorIndex = row * AUCTION_KEYPAD_COLS + ((col + 1) % AUCTION_KEYPAD_COLS);
        render();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault(); event.stopImmediatePropagation();
        cursorIndex = row * AUCTION_KEYPAD_COLS + ((col - 1 + AUCTION_KEYPAD_COLS) % AUCTION_KEYPAD_COLS);
        render();
      } else if (event.key === "ArrowDown") {
        event.preventDefault(); event.stopImmediatePropagation();
        cursorIndex = ((row + 1) % rows) * AUCTION_KEYPAD_COLS + col;
        if (cursorIndex >= AUCTION_KEYPAD_LAYOUT.length) cursorIndex -= AUCTION_KEYPAD_COLS;
        render();
      } else if (event.key === "ArrowUp") {
        event.preventDefault(); event.stopImmediatePropagation();
        let newRow = row - 1;
        if (newRow < 0) newRow = rows - 1;
        let candidate = newRow * AUCTION_KEYPAD_COLS + col;
        if (candidate >= AUCTION_KEYPAD_LAYOUT.length) candidate -= AUCTION_KEYPAD_COLS;
        cursorIndex = candidate;
        render();
      } else if (event.key === "Backspace") {
        event.preventDefault(); event.stopImmediatePropagation();
        pressBackspace();
      } else if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.decideKeys.includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        pressCell(cursorIndex);
      } else if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.cancelKeys.includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        finish(null);
      }
    }
    
    buttons.forEach((btn, i) => {
      btn.onclick = (event) => { event.stopPropagation(); cursorIndex = i; pressCell(i); };
    });
    
    render();
    if (overlay) overlay.classList.remove("hidden");
    window.addEventListener("keydown", handleKey);
  });
}
