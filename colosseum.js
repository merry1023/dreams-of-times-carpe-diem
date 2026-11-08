// ===================================================================
// ===== コロシアム（施設編集タブで追加できる「コロシアム系」施設） =====
// ===== アイテム使用禁止のバトルタワー。指定したアイテムを消費して参加し、  =====
// ===== 各階層（n回戦目）に設定した敵と連戦する。1回負けたら最初から。      =====
// ===================================================================

let colosseumFacility = null;   // 今開いているコロシアム施設のデータ（scenariobuild.jsのfacility）
let colosseumReturnTo = null;   // 「やめる」で呼ぶ関数（村メニュー、または拠点の施設一覧）
let colosseumCurrentFloor = 1;  // 今の周回で挑戦中の階層（n回戦目。1から始まる）
let colosseumActiveHandicapIds = []; // ★今の周回で有効な「縛り」のID（挑戦を始めた時点で確定。受付で変えても、挑戦中の周回には影響しない）

// ===== 縛り（要望対応） =====
// ★受付で「縛り」を追加してから挑戦すると、その重さ（weight）の合計に応じて、報酬のコインが増える。
//   報酬倍率 ＝ 1 ＋ 選んだ縛りの重さの合計（最大3倍）。コインの獲得数（10・20・50回戦の記念コイン／99回戦の特別報酬）に掛かる
//   （陳・経験値の特別報酬には掛からない）。
//   ・group が同じ縛りは、どれか1つしか選べない（選び直すと入れ替わる）。重い方ほど重さが大きい
//   ・重さ・内容は、この表を書き換えるだけで調整できる
const COLOSSEUM_HANDICAP_MAX_MULTIPLIER = 3; // ★報酬倍率の上限（最大3倍）
const COLOSSEUM_HANDICAPS = [
  { id: "noRest", label: "休憩なし", weight: 0.3, description: "5回戦・10回戦ごとの回復（小休止・休憩所）が無くなる。" },
  { id: "halfHp", label: "満身創痍", weight: 0.3, description: "挑戦を始める時、全員のHPが半分になる。" },
  { id: "noRetire", label: "退路なし", weight: 0.3, description: "途中でリタイアできない。負けるか、99回戦をクリアするまで続く。" },
  { id: "noWeaponSkill", label: "武器スキル禁止", weight: 0.2, description: "装備の武器スキルが使えない。" },
  { id: "noUpper", label: "上位スキル禁止", weight: 0.3, description: "上位スキルが使えない。" },
  { id: "noNormal", label: "通常攻撃禁止", weight: 0.4, group: "action", description: "通常攻撃（仲間の「たたかう」）が使えない。スキルは使える。" },
  { id: "noSkill", label: "スキル禁止", weight: 0.5, group: "action", description: "スキルが使えない（上位スキル・武器スキルは別）。通常攻撃は使える。" },
  { id: "enemyHp15", label: "敵の体力1.5倍", weight: 0.4, group: "enemyHp", enemyHpMultiplier: 1.5, description: "出てくる敵の最大HPが1.5倍になる。" },
  { id: "enemyHp20", label: "敵の体力2倍", weight: 0.8, group: "enemyHp", enemyHpMultiplier: 2, description: "出てくる敵の最大HPが2倍になる。" },
  { id: "enemyAtk13", label: "敵の攻撃力1.3倍", weight: 0.5, group: "enemyAtk", enemyAtkMultiplier: 1.3, description: "出てくる敵の攻撃力が1.3倍になる。" },
  { id: "enemyAtk16", label: "敵の攻撃力1.6倍", weight: 1.0, group: "enemyAtk", enemyAtkMultiplier: 1.6, description: "出てくる敵の攻撃力が1.6倍になる。" }
];

function findColosseumHandicap(id) {
  return COLOSSEUM_HANDICAPS.find(h => h.id === id) || null;
}

// ★この施設で選んでいる縛り（受付の設定。セーブデータに残る）
function getColosseumSelectedHandicapIds() {
  if (!colosseumFacility || !player || !player.colosseumHandicaps || typeof player.colosseumHandicaps !== "object") return [];
  const ids = player.colosseumHandicaps[colosseumFacility.id];
  return Array.isArray(ids) ? ids.filter(id => findColosseumHandicap(id)) : [];
}

function setColosseumSelectedHandicapIds(ids) {
  if (!player.colosseumHandicaps || typeof player.colosseumHandicaps !== "object") player.colosseumHandicaps = {};
  player.colosseumHandicaps[colosseumFacility.id] = ids;
}

// ★縛りの重さの合計と、そこから決まる報酬倍率（1＋重さの合計。最大3倍）
function getColosseumHandicapTotalWeight(ids) {
  const total = ids.reduce((sum, id) => sum + ((findColosseumHandicap(id) || {}).weight || 0), 0);
  return Math.round(total * 100) / 100;
}

function getColosseumRewardMultiplier(ids) {
  const mult = Math.min(COLOSSEUM_HANDICAP_MAX_MULTIPLIER, 1 + getColosseumHandicapTotalWeight(ids));
  return Math.round(mult * 100) / 100;
}

function formatColosseumMultiplier(mult) {
  return `×${Number(mult.toFixed(2))}`;
}

function describeColosseumHandicaps(ids) {
  if (ids.length === 0) return "縛りなし（報酬×1）";
  const names = ids.map(id => (findColosseumHandicap(id) || {}).label).filter(Boolean).join("・");
  const total = getColosseumHandicapTotalWeight(ids);
  const mult = getColosseumRewardMultiplier(ids);
  return `${names}（重さ合計+${total}→報酬${formatColosseumMultiplier(mult)}${1 + total > COLOSSEUM_HANDICAP_MAX_MULTIPLIER ? "・上限" : ""}）`;
}

// ★選んだ縛りを、戦闘側（battle.js）に渡す形にまとめる
function getColosseumRestrictions(ids) {
  const r = { noNormal: false, noSkill: false, noUpper: false, noWeaponSkill: false, enemyHpMultiplier: 1, enemyAtkMultiplier: 1 };
  ids.forEach(id => {
    if (id === "noNormal") r.noNormal = true;
    if (id === "noSkill") r.noSkill = true;
    if (id === "noUpper") r.noUpper = true;
    if (id === "noWeaponSkill") r.noWeaponSkill = true;
    const h = findColosseumHandicap(id);
    if (h && h.enemyHpMultiplier) r.enemyHpMultiplier = h.enemyHpMultiplier;
    if (h && h.enemyAtkMultiplier) r.enemyAtkMultiplier = h.enemyAtkMultiplier;
  });
  return r;
}

function colosseumHasActiveHandicap(id) {
  return colosseumActiveHandicapIds.includes(id);
}

// ★受付の「縛りを追加する」メニュー。選ぶたびに付ける／外すを切り替えて、同じ画面に戻る
async function showColosseumHandicapMenu(initialIndex = 0) {
  hideLocationMenu();
  changeSpeaker(colosseumFacility.name || "コロシアム");
  const selected = getColosseumSelectedHandicapIds();
  const choices = COLOSSEUM_HANDICAPS.map((h, index) => ({
    text: `${selected.includes(h.id) ? "☑" : "☐"} ${h.label}（重さ+${h.weight}）`,
    next: String(index),
    description: h.description + (h.group ? "（同じ種類の縛りは、どれか1つだけ）" : "")
  }));
  choices.push({ text: "全ての縛りを外す", next: "clear" });
  choices.push({ text: "決定して戻る", next: "done", isBack: true });
  await displayMessage(`縛りを選ぼう。重いほど、報酬のコインが増える。\n現在：${describeColosseumHandicaps(selected)}\n（最大${formatColosseumMultiplier(COLOSSEUM_HANDICAP_MAX_MULTIPLIER)}）`);
  const picked = await displayChoices(choices, initialIndex);
  if (picked.next === "done") {
    showColosseumLobbyMenu();
    return;
  }
  if (picked.next === "clear") {
    setColosseumSelectedHandicapIds([]);
    showColosseumHandicapMenu(COLOSSEUM_HANDICAPS.length);
    return;
  }
  const index = Number(picked.next);
  setColosseumSelectedHandicapIds(toggleColosseumHandicapId(selected, COLOSSEUM_HANDICAPS[index].id));
  showColosseumHandicapMenu(index);
}

// ★縛りを1つ付ける／外す（もう一度選ぶと外れる。同じ種類（group）の縛りは入れ替える）
function toggleColosseumHandicapId(selected, handicapId) {
  const handicap = findColosseumHandicap(handicapId);
  if (!handicap) return selected;
  if (selected.includes(handicapId)) return selected.filter(id => id !== handicapId);
  const next = selected.filter(id => !handicap.group || (findColosseumHandicap(id) || {}).group !== handicap.group);
  next.push(handicapId);
  return next;
}

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

const COLOSSEUM_TEN_MULTIPLE_ROUND_NUMBERS = [10, 20, 30, 40, 50, 60, 70, 80, 90]; // ★「10の倍数回戦」＝節目の回戦のうち、99回戦目（最終回）を除いたもの

// ★n回戦目に出す敵編成と、指定されていればそのレベル（節目の回戦のみ指定可能）を返す
function getColosseumFloorEncounter(facility, floorNumber) {
  if (isColosseumBossRound(floorNumber)) {
    // ★節目の回戦：施設編集で回戦ごとに個別登録した「指定した敵」を使う
    const config = (facility.bossRoundConfig && facility.bossRoundConfig[floorNumber]) || {};
    const enemyMonsterKeys = Array.isArray(config.enemyMonsterKeys)
      ? config.enemyMonsterKeys.filter(id => id && MONSTER_MASTER[id])
      : [];
    const fixedLevel = (Number(config.level) > 0) ? Number(config.level) : null;
    return { enemyMonsterKeys, fixedLevel };
  }
  // ★それ以外の回戦（雑魚敵＝10の倍数回戦以外でランダムに出る敵）：
  //   施設編集で登録した「様々な敵」のプールから、重複ありで5体ランダムに選ぶ
  const pool = Array.isArray(facility.regularEnemyPool)
    ? facility.regularEnemyPool.filter(id => id && MONSTER_MASTER[id])
    : [];
  if (pool.length === 0) return { enemyMonsterKeys: [], fixedLevel: null };
  const enemyMonsterKeys = [];
  for (let i = 0; i < 5; i++) {
    enemyMonsterKeys.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  // ★要望対応：雑魚敵（10の倍数回戦以外でランダムに出る敵）のレベルは、
  //   一番回戦が近くて強い10の倍数回戦目（＝直後に控えている10の倍数回戦。無ければ直前のもの）に
  //   指定してあるレベル×0.6にする（ステータスを直接0.6倍にするのではなく、レベルを0.6倍にした値を
  //   新しいレベルとして扱い、通常のレベル別ステータス計算式にそのまま乗せる）
  const nearestTenMultipleLevel = getColosseumNearestTenMultipleLevel(facility, floorNumber);
  const fixedLevel = nearestTenMultipleLevel != null ? Math.max(1, Math.round(nearestTenMultipleLevel * 0.6)) : null;
  return { enemyMonsterKeys, fixedLevel };
}

// ★floorNumberから見て、一番近くて強い（＝この先すぐに迫ってくる）10の倍数回戦のレベルを返す。
//   90回戦より後（91〜98回戦）など、この先に10の倍数回戦が無い場合は、直前の10の倍数回戦にフォールバックする。
//   該当するレベルが指定されていない（0のまま）場合はnull＝今まで通り自動決定
function getColosseumNearestTenMultipleLevel(facility, floorNumber) {
  const upcoming = COLOSSEUM_TEN_MULTIPLE_ROUND_NUMBERS.find(n => n >= floorNumber);
  const candidate = upcoming != null ? upcoming : COLOSSEUM_TEN_MULTIPLE_ROUND_NUMBERS[COLOSSEUM_TEN_MULTIPLE_ROUND_NUMBERS.length - 1];
  const config = facility.bossRoundConfig && facility.bossRoundConfig[candidate];
  return (config && Number(config.level) > 0) ? Number(config.level) : null;
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
  
  const handicapIds = getColosseumSelectedHandicapIds();
  showLocationMenu([
    { label: `挑戦する（${entryLabel}／自己ベスト：${best}回戦）`, action: () => tryStartColosseumRun() },
    { label: `縛りを追加する（${handicapIds.length === 0 ? "なし／報酬×1" : `${handicapIds.length}個／報酬${formatColosseumMultiplier(getColosseumRewardMultiplier(handicapIds))}`}）`, action: () => showColosseumHandicapMenu() },
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
  colosseumActiveHandicapIds = getColosseumSelectedHandicapIds(); // ★この周回の縛りをここで確定する
  
  hideLocationMenu();
  changeSpeaker(colosseumFacility.name || "コロシアム");
  await displayMessage("コロシアムへの挑戦が始まった！（アイテムは使用できない。持ち物は封じられている）");
  if (colosseumActiveHandicapIds.length > 0) {
    await displayMessage(`【縛り】${describeColosseumHandicaps(colosseumActiveHandicapIds)}`);
    if (colosseumHasActiveHandicap("halfHp")) {
      const halve = (unit) => { unit.gauges.hp.current = Math.min(unit.gauges.hp.current, Math.max(1, Math.ceil(unit.gauges.hp.max / 2))); };
      halve(player);
      (player.companions || []).forEach(c => { if (c.alive) halve(c); });
      renderStatusHUD();
      await displayMessage("満身創痍のまま、戦いに臨む……（全員のHPが半分になった）");
    }
  }
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
  const battleOptions = { isColosseum: true, colosseumRestrictions: getColosseumRestrictions(colosseumActiveHandicapIds) }; // ★縛りの制限・敵の強化を戦闘側へ渡す
  if (encounter.fixedLevel != null) battleOptions.fixedLevel = encounter.fixedLevel; // ★節目の回戦の指定レベル、または雑魚敵回戦なら直近の節目回戦レベル×0.6で固定する
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
  if (colosseumHasActiveHandicap("noRest")) {
    // ★縛り「休憩なし」：回復は一切無い
  } else if (floor % 10 === 0) {
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
    const rewardMult = getColosseumRewardMultiplier(colosseumActiveHandicapIds); // ★縛りによる報酬倍率（縛りが無ければ1）
    const qty = Math.max(1, Math.round(Math.max(1, milestoneInfo.qty || 1) * rewardMult));
    if (coinItemId) {
      addItem(coinItemId, qty);
      renderStatusHUD();
      changeSpeaker(colosseumFacility.name || "コロシアム");
      await displayMessage(`「${itemNameOfColosseum(coinItemId)}」を${qty}個手に入れた！` + (rewardMult > 1 ? `（縛りボーナス${formatColosseumMultiplier(rewardMult)}）` : ""));
    }
  }
  
  if (floor >= 99) {
    await handleColosseumFinalClear();
    return;
  }
  
  // ★要望対応：1回戦ごとに、次の回戦へ進むか、ここでやめる（リタイア）か選べるようにする。
  //   ここまでの自己ベスト・獲得済みのコインは、リタイアしてもそのまま持ち帰れる
  changeSpeaker(colosseumFacility.name || "コロシアム");
  const afterVictoryMenu = [{ label: `次（${floor + 1}回戦目）に挑む`, action: () => advanceColosseumRun(floor) }];
  if (!colosseumHasActiveHandicap("noRetire")) afterVictoryMenu.push({ label: "ここでやめておく（リタイア）", action: () => retireColosseumRun(floor) }); // ★縛り「退路なし」ではリタイアできない
  showLocationMenu(afterVictoryMenu, colosseumFacility.name || "コロシアム");
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
  colosseumActiveHandicapIds = [];
  showColosseumLobbyMenu();
}

// ★要望対応：99回戦をクリアした時の特別報酬（コロシアムコイン各色・陳・経験値をそれぞれ指定数ずつ）
async function handleColosseumFinalClear() {
  changeSpeaker(colosseumFacility.name || "コロシアム");
  await displayMessage("ついに99回戦、全ての戦いを制した……！コロシアムの頂点に立った証を授けよう。");
  
  const rewardTexts = [];
  const finalRewardMult = getColosseumRewardMultiplier(colosseumActiveHandicapIds); // ★縛りによる報酬倍率（コインの数だけに掛かる）
  ["blue", "yellow", "red"].forEach(color => {
    const baseQty = Math.max(0, Number(colosseumFacility[`finalClear${color[0].toUpperCase()}${color.slice(1)}CoinQty`]) || 0);
    const qty = baseQty > 0 ? Math.max(1, Math.round(baseQty * finalRewardMult)) : 0;
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
    await displayMessage(`${rewardTexts.join("、")}を手に入れた！` + (finalRewardMult > 1 ? `（縛りボーナス${formatColosseumMultiplier(finalRewardMult)}がコインに適用された）` : ""));
  }
  if (levelResult && typeof announceLevelUpIfAny === "function") {
    await announceLevelUpIfAny(levelResult);
  }
  
  colosseumCurrentFloor = 1;
  colosseumActiveHandicapIds = [];
  showColosseumLobbyMenu();
}

// ★battle.jsのhandleBattleDefeatから、コロシアム戦に負けた時だけ呼ばれる。1回負けたら最初から
async function handleColosseumDefeat() {
  changeSpeaker(colosseumFacility.name || "コロシアム");
  await displayMessage(`${colosseumCurrentFloor}回戦で敗れてしまった……最初からやり直しだ。`);
  colosseumCurrentFloor = 1;
  colosseumActiveHandicapIds = [];
  showColosseumLobbyMenu();
}

// ===== コインの引き換え屋 =====
// ★要望対応：店（showCustomShopMenu）と同じ、セリフの選択肢（displayChoices）で選ぶ形式にした
async function showColosseumExchangeMenu() {
  const offers = Array.isArray(colosseumFacility.exchangeOffers) ? colosseumFacility.exchangeOffers : [];
  changeSpeaker(colosseumFacility.name || "コロシアム");
  if (offers.length === 0) {
    await displayMessage("（まだ何も並んでいないようだ）");
    showColosseumLobbyMenu();
    return;
  }
  
  const choices = offers.map((offer, index) => {
    const coinItemId = colosseumCoinItemId(offer.coinColor);
    const coinLabel = coinItemId ? itemNameOfColosseum(coinItemId) : `${colosseumCoinLabel(offer.coinColor)}コイン（未設定）`;
    const itemLabel = itemNameOfColosseum(offer.itemId);
    return { text: `${coinLabel}×${offer.coinQty || 1} → ${itemLabel}×${offer.itemQty || 1}`, next: String(index) };
  });
  choices.push({ text: "やめる", next: "cancel", isBack: true });
  await displayMessage("何と交換する？");
  const picked = await displayChoices(choices);
  if (picked.next === "cancel") {
    showColosseumLobbyMenu();
    return;
  }
  
  await tryColosseumExchange(offers[Number(picked.next)]);
}

async function tryColosseumExchange(offer) {
  const coinItemId = colosseumCoinItemId(offer.coinColor);
  const coinQty = Math.max(1, offer.coinQty || 1);
  if (!coinItemId || !offer.itemId) {
    changeSpeaker(colosseumFacility.name || "コロシアム");
    await displayMessage("（この交換の設定がまだ揃っていないようだ）");
    showColosseumExchangeMenu();
    return;
  }
  
  const have = getTotalItemCount(coinItemId);
  const maxTimes = Math.floor(have / coinQty);
  if (maxTimes <= 0) {
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
  
  // ★要望対応：店と同じように、実際に交換する前に確認ダイアログを挟む
  const confirmed = await showGameConfirm(`「${itemNameOfColosseum(coinItemId)}」×${coinQty * times}を「${itemNameOfColosseum(offer.itemId)}」×${itemQtyEach * times}と交換しますか？`); // mainfunc.js
  if (!confirmed) {
    showColosseumExchangeMenu();
    return;
  }
  
  removeItem(coinItemId, coinQty * times);
  const added = addItem(offer.itemId, itemQtyEach * times);
  renderStatusHUD();
  changeSpeaker(colosseumFacility.name || "コロシアム");
  if (added) {
    await displayMessage(`「${itemNameOfColosseum(offer.itemId)}」を${itemQtyEach * times}個手に入れた！`);
  } else {
    await displayMessage("持ち物がいっぱいで、受け取れなかったようだ……");
    addItem(coinItemId, coinQty * times); // ★受け取れなかった分はコインを返す
    renderStatusHUD();
  }
  showColosseumExchangeMenu();
}
