// ===================================================================
// ===== コロシアム（施設編集タブで追加できる「コロシアム系」施設） =====
// ===== アイテム使用禁止のバトルタワー。指定したアイテムを消費して参加し、  =====
// ===== 各階層（n回戦目）に設定した敵と連戦する。1回負けたら最初から。      =====
// ===================================================================

let colosseumFacility = null;   // 今開いているコロシアム施設のデータ（scenariobuild.jsのfacility）
let colosseumReturnTo = null;   // 「やめる」で呼ぶ関数（村メニュー、または拠点の施設一覧）
let colosseumCurrentFloor = 1;  // 今の周回で挑戦中の階層（n回戦目。1から始まる）

// コロシアムの入り口。openCustomFacility（town.js）から呼ばれる
function openColosseum(facility, returnTo) {
  colosseumFacility = facility;
  colosseumReturnTo = typeof returnTo === "function" ? returnTo : openTownMenu;
  showColosseumLobbyMenu();
}

function itemNameOfColosseum(itemId) {
  return (typeof ITEM_MASTER !== "undefined" && ITEM_MASTER[itemId] && ITEM_MASTER[itemId].name) || itemId || "（未設定）";
}

function colosseumCoinItemId(color) {
  if (!colosseumFacility) return null;
  if (color === "blue") return colosseumFacility.coinItemIdBlue;
  if (color === "yellow") return colosseumFacility.coinItemIdYellow;
  if (color === "red") return colosseumFacility.coinItemIdRed;
  return null;
}

function colosseumCoinLabel(color) {
  return color === "blue" ? "青" : color === "yellow" ? "黄" : "赤";
}

// ★要望対応：自己ベスト（一番深く到達した回戦）を施設ごとに記録しておく（ロビー表示用。報酬とは無関係）
function getColosseumBestFloor() {
  if (!player.colosseumBestFloors || typeof player.colosseumBestFloors !== "object") player.colosseumBestFloors = {};
  return player.colosseumBestFloors[colosseumFacility.id] || 0;
}

function setColosseumBestFloorIfHigher(floor) {
  if (!player.colosseumBestFloors || typeof player.colosseumBestFloors !== "object") player.colosseumBestFloors = {};
  if (floor > (player.colosseumBestFloors[colosseumFacility.id] || 0)) {
    player.colosseumBestFloors[colosseumFacility.id] = floor;
  }
}

// ★要望対応：10の倍数（10・20・…・90）と、100回戦が無いため最後の節目となる99回戦目を「ボス的な」回戦とする。
//   それ以外の回戦は、施設側で登録した「様々な敵」のプールからランダムに5体選んで出す
const COLOSSEUM_BOSS_ROUND_NUMBERS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 99];

function isColosseumBossRound(floorNumber) {
  return COLOSSEUM_BOSS_ROUND_NUMBERS.includes(floorNumber);
}

// ★n回戦目に出す敵編成と、指定されていればそのレベル（節目の回戦のみ指定可能）を返す
function getColosseumFloorEncounter(facility, floorNumber) {
  if (isColosseumBossRound(floorNumber)) {
    // ★節目の回戦：施設編集で回戦ごとに個別登録した「指定した敵」を使う
    const config = (facility.bossRoundConfig && facility.bossRoundConfig[floorNumber]) || {};
    const enemyMonsterKeys = Array.isArray(config.enemyMonsterKeys)
      ? config.enemyMonsterKeys.filter(id => id && MONSTER_MASTER[id])
      : [];
    const fixedLevel = (Number(config.level) > 0) ? Number(config.level) : null;
    // ★要望対応：レベルを指定した節目回戦は、ボスID以外（雑魚敵）を指定レベル×0.6の強さに弱める
    //   （ボス本体は指定レベルのまま）。startBattleのoptions.perEnemyLevelsに渡す配列を組み立てる
    const perEnemyLevels = fixedLevel != null
      ? enemyMonsterKeys.map(id => (typeof BOSS_MONSTER_KEYS !== "undefined" && BOSS_MONSTER_KEYS.includes(id)) ? fixedLevel : Math.max(1, Math.round(fixedLevel * 0.6)))
      : null;
    return { enemyMonsterKeys, fixedLevel, perEnemyLevels };
  }
  // ★それ以外の回戦：施設編集で登録した「様々な敵」のプールから、重複ありで5体ランダムに選ぶ
  const pool = Array.isArray(facility.regularEnemyPool)
    ? facility.regularEnemyPool.filter(id => id && MONSTER_MASTER[id])
    : [];
  if (pool.length === 0) return { enemyMonsterKeys: [], fixedLevel: null, perEnemyLevels: null };
  const enemyMonsterKeys = [];
  for (let i = 0; i < 5; i++) {
    enemyMonsterKeys.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return { enemyMonsterKeys, fixedLevel: null, perEnemyLevels: null };
}

function showColosseumLobbyMenu() {
  changeSpeaker(colosseumFacility.name || "コロシアム");
  const best = getColosseumBestFloor();
  const entryItemId = colosseumFacility.entryItemId;
  const entryQty = Math.max(1, colosseumFacility.entryItemQty || 1);
  const entryLabel = entryItemId ? `${itemNameOfColosseum(entryItemId)}×${entryQty}を消費` : "参加アイテム未設定";
  const coinSummary = ["blue", "yellow", "red"].map(color => {
    const id = colosseumCoinItemId(color);
    return id ? `${colosseumCoinLabel(color)}:${getTotalItemCount(id)}` : null;
  }).filter(Boolean).join(" ");
  
  showLocationMenu([
    { label: `挑戦する（${entryLabel}／自己ベスト：${best}回戦）`, action: () => tryStartColosseumRun() },
    { label: `コインを引き換える${coinSummary ? `（${coinSummary}）` : ""}`, action: () => showColosseumExchangeMenu() },
    { label: "やめる", action: () => colosseumReturnTo() }
  ], colosseumFacility.name || "コロシアム");
}

async function tryStartColosseumRun() {
  const itemId = colosseumFacility.entryItemId;
  const qty = Math.max(1, colosseumFacility.entryItemQty || 1);
  
  if (!itemId) {
    hideLocationMenu();
    changeSpeaker(colosseumFacility.name || "コロシアム");
    await displayMessage("（参加に必要なアイテムがまだ設定されていないようだ）");
    showColosseumLobbyMenu();
    return;
  }
  if (getColosseumFloorEncounter(colosseumFacility, 1).enemyMonsterKeys.length === 0) {
    hideLocationMenu();
    changeSpeaker(colosseumFacility.name || "コロシアム");
    await displayMessage("（1回戦目に配置する敵がまだ設定されていないようだ）");
    showColosseumLobbyMenu();
    return;
  }
  if (getTotalItemCount(itemId) < qty) {
    hideLocationMenu();
    changeSpeaker(colosseumFacility.name || "コロシアム");
    await displayMessage(`「${itemNameOfColosseum(itemId)}」が${qty}個無いと参加できないようだ。`);
    showColosseumLobbyMenu();
    return;
  }
  
  removeItem(itemId, qty);
  renderStatusHUD();
  colosseumCurrentFloor = 1;
  
  hideLocationMenu();
  changeSpeaker(colosseumFacility.name || "コロシアム");
  await displayMessage("コロシアムへの挑戦が始まった！（アイテムは使用できない。持ち物は封じられている）");
  await runColosseumFloor();
}

// ★要望対応：この階層の戦闘を開始する。勝敗後の続き（次の階層へ進む/最初からやり直す）は
//   battle.js側のresolveBattleVictory/handleBattleDefeatからhandleColosseumVictory/handleColosseumDefeatが
//   呼ばれる形で、そちらから再びここへ戻ってくる（非同期の連鎖で、n回戦を順につないでいく）
async function runColosseumFloor() {
  const encounter = getColosseumFloorEncounter(colosseumFacility, colosseumCurrentFloor);
  if (encounter.enemyMonsterKeys.length === 0) {
    changeSpeaker(colosseumFacility.name || "コロシアム");
    await displayMessage("（この階層に配置する敵がまだ設定されていないようだ。挑戦はここまでにしておこう）");
    showColosseumLobbyMenu();
    return;
  }
  changeSpeaker("");
  await displayMessage(`${colosseumCurrentFloor}回戦目！` + (isColosseumBossRound(colosseumCurrentFloor) ? "\n強大な気配を感じる……！" : ""));
  const battleOptions = { isColosseum: true };
  if (encounter.fixedLevel != null) battleOptions.fixedLevel = encounter.fixedLevel; // ★節目の回戦で指定されていれば、そのレベルで固定する
  if (encounter.perEnemyLevels) battleOptions.perEnemyLevels = encounter.perEnemyLevels; // ★節目の回戦：雑魚敵だけ指定レベル×0.6に弱める
  await startBattle(encounter.enemyMonsterKeys, battleOptions); // battle.js
}

// ★battle.jsのresolveBattleVictoryから、コロシアム戦に勝った時だけ呼ばれる
async function handleColosseumVictory() {
  const floor = colosseumCurrentFloor;
  setColosseumBestFloorIfHigher(floor);
  
  changeSpeaker("");
  await displayMessage(`${floor}回戦、勝利！`);
  
  // ★要望対応：10の倍数（10・20・30…）の回戦をクリアしたら全回復、
  //   5の倍数だが10の倍数ではない回戦（5・15・25…）をクリアしたらHP・SPを1/3回復する
  if (floor % 10 === 0) {
    player.gauges.hp.current = player.gauges.hp.max;
    player.gauges.sp.current = player.gauges.sp.max;
    (player.companions || []).forEach(c => {
      if (!c.alive) return;
      c.gauges.hp.current = c.gauges.hp.max;
      c.gauges.sp.current = c.gauges.sp.max;
    });
    changeSpeaker(colosseumFacility.name || "コロシアム");
    await displayMessage("休憩所があった。体力が全回復した！");
  } else if (floor % 5 === 0) {
    const healOneThird = (unit) => {
      unit.gauges.hp.current = Math.min(unit.gauges.hp.max, unit.gauges.hp.current + Math.ceil(unit.gauges.hp.max / 3));
      unit.gauges.sp.current = Math.min(unit.gauges.sp.max, unit.gauges.sp.current + Math.ceil(unit.gauges.sp.max / 3));
    };
    healOneThird(player);
    (player.companions || []).forEach(c => { if (c.alive) healOneThird(c); });
    changeSpeaker(colosseumFacility.name || "コロシアム");
    await displayMessage("小休止できた。HP・SPが少し回復した！");
  }
  renderStatusHUD();
  
  // ★要望対応：10・20・50回戦をクリアした時だけ、それぞれ専用のコインを手に入れる
  const milestoneInfo = floor === 10 ? { color: "blue", qty: colosseumFacility.milestone10CoinQty }
    : floor === 20 ? { color: "yellow", qty: colosseumFacility.milestone20CoinQty }
    : floor === 50 ? { color: "red", qty: colosseumFacility.milestone50CoinQty }
    : null;
  if (milestoneInfo) {
    const coinItemId = colosseumCoinItemId(milestoneInfo.color);
    const qty = Math.max(1, milestoneInfo.qty || 1);
    if (coinItemId) {
      addItem(coinItemId, qty);
      renderStatusHUD();
      changeSpeaker(colosseumFacility.name || "コロシアム");
      await displayMessage(`「${itemNameOfColosseum(coinItemId)}」を${qty}個手に入れた！`);
    }
  }
  
  if (floor >= 99) {
    await handleColosseumFinalClear();
    return;
  }
  
  // ★要望対応：1回戦ごとに、次の回戦へ進むか、ここでやめる（リタイア）か選べるようにする。
  //   ここまでの自己ベスト・獲得済みのコインは、リタイアしてもそのまま持ち帰れる
  changeSpeaker(colosseumFacility.name || "コロシアム");
  showLocationMenu([
    { label: `次（${floor + 1}回戦目）に挑む`, action: () => advanceColosseumRun(floor) },
    { label: "ここでやめておく（リタイア）", action: () => retireColosseumRun(floor) }
  ], colosseumFacility.name || "コロシアム");
}

function advanceColosseumRun(clearedFloor) {
  hideLocationMenu();
  colosseumCurrentFloor = clearedFloor + 1;
  runColosseumFloor();
}

// ★battle.jsのhandleBattleDefeatとは違い、負けたわけではないので1回戦目に戻すだけで
//   ペナルティは無い（自己ベスト・コインなどの報酬はhandleColosseumVictory側で既に確定済み）
async function retireColosseumRun(clearedFloor) {
  hideLocationMenu();
  changeSpeaker(colosseumFacility.name || "コロシアム");
  await displayMessage(`${clearedFloor}回戦でリタイアした。ここまでの記録と報酬はそのまま持ち帰れる。`);
  colosseumCurrentFloor = 1;
  showColosseumLobbyMenu();
}

// ★要望対応：99回戦をクリアした時の特別報酬（コロシアムコイン各色・陳・経験値をそれぞれ指定数ずつ）
async function handleColosseumFinalClear() {
  changeSpeaker(colosseumFacility.name || "コロシアム");
  await displayMessage("ついに99回戦、全ての戦いを制した……！コロシアムの頂点に立った証を授けよう。");
  
  const rewardTexts = [];
  ["blue", "yellow", "red"].forEach(color => {
    const qty = Math.max(0, Number(colosseumFacility[`finalClear${color[0].toUpperCase()}${color.slice(1)}CoinQty`]) || 0);
    const coinItemId = colosseumCoinItemId(color);
    if (qty > 0 && coinItemId) {
      addItem(coinItemId, qty);
      rewardTexts.push(`${itemNameOfColosseum(coinItemId)}×${qty}`);
    }
  });
  const goldReward = Math.max(0, Number(colosseumFacility.finalClearGoldReward) || 0);
  if (goldReward > 0) {
    changeGold(goldReward);
    rewardTexts.push(`${goldReward}陳`);
  }
  let levelResult = null;
  const expReward = Math.max(0, Number(colosseumFacility.finalClearExpReward) || 0);
  if (expReward > 0) {
    levelResult = addExp(expReward);
    rewardTexts.push(`経験値${expReward}`);
  }
  renderStatusHUD();
  
  if (rewardTexts.length > 0) {
    await displayMessage(`${rewardTexts.join("、")}を手に入れた！`);
  }
  if (levelResult && typeof announceLevelUpIfAny === "function") {
    await announceLevelUpIfAny(levelResult);
  }
  
  colosseumCurrentFloor = 1;
  showColosseumLobbyMenu();
}

// ★battle.jsのhandleBattleDefeatから、コロシアム戦に負けた時だけ呼ばれる。1回負けたら最初から
async function handleColosseumDefeat() {
  changeSpeaker(colosseumFacility.name || "コロシアム");
  await displayMessage(`${colosseumCurrentFloor}回戦で敗れてしまった……最初からやり直しだ。`);
  colosseumCurrentFloor = 1;
  showColosseumLobbyMenu();
}

// ===== コインの引き換え屋 =====
function showColosseumExchangeMenu() {
  const offers = Array.isArray(colosseumFacility.exchangeOffers) ? colosseumFacility.exchangeOffers : [];
  changeSpeaker(colosseumFacility.name || "コロシアム");
  if (offers.length === 0) {
    displayMessage("（まだ何も並んでいないようだ）").then(() => showColosseumLobbyMenu());
    return;
  }
  
  const options = offers.map(offer => {
    const coinItemId = colosseumCoinItemId(offer.coinColor);
    const coinLabel = coinItemId ? itemNameOfColosseum(coinItemId) : `${colosseumCoinLabel(offer.coinColor)}コイン（未設定）`;
    const itemLabel = itemNameOfColosseum(offer.itemId);
    return {
      label: `${coinLabel}×${offer.coinQty || 1} → ${itemLabel}×${offer.itemQty || 1}`,
      action: () => tryColosseumExchange(offer)
    };
  });
  options.push({ label: "戻る", action: () => showColosseumLobbyMenu() });
  showLocationMenu(options, colosseumFacility.name || "コロシアム");
}

async function tryColosseumExchange(offer) {
  const coinItemId = colosseumCoinItemId(offer.coinColor);
  const coinQty = Math.max(1, offer.coinQty || 1);
  if (!coinItemId || !offer.itemId) {
    hideLocationMenu();
    changeSpeaker(colosseumFacility.name || "コロシアム");
    await displayMessage("（この交換の設定がまだ揃っていないようだ）");
    showColosseumExchangeMenu();
    return;
  }
  
  const have = getTotalItemCount(coinItemId);
  const maxTimes = Math.floor(have / coinQty);
  if (maxTimes <= 0) {
    hideLocationMenu();
    changeSpeaker(colosseumFacility.name || "コロシアム");
    await displayMessage(`「${itemNameOfColosseum(coinItemId)}」が足りないようだ。`);
    showColosseumExchangeMenu();
    return;
  }
  
  const itemQtyEach = Math.max(1, offer.itemQty || 1);
  const times = await pickQuantity(maxTimes, "交換する回数", {
    min: 1,
    formatValue: v => `${v}回（${itemNameOfColosseum(offer.itemId)}×${itemQtyEach * v}）`,
    formatLabel: max => `何回交換する？（最大${max}回）`,
    cancelValue: 0
  });
  if (!times || times <= 0) {
    showColosseumExchangeMenu();
    return;
  }
  
  removeItem(coinItemId, coinQty * times);
  addItem(offer.itemId, itemQtyEach * times);
  renderStatusHUD();
  changeSpeaker(colosseumFacility.name || "コロシアム");
  await displayMessage(`「${itemNameOfColosseum(offer.itemId)}」を${itemQtyEach * times}個手に入れた！`);
  showColosseumExchangeMenu();
}
