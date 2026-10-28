// tower_rewards.js
// ===================================================================
// ===== 冒険者協会「掃討作戦」のクリア報酬（迎撃モード・出撃モード共通） =====
// ===================================================================
// ★報酬の中身：陳（お金）／協会ポイント／ガチャ石（仮）／アイテム
//   ・陳・ガチャ石・追加アイテムは、エディタ「掃討作戦の報酬」タブで設定する（scenarioProject.guildRewards）
//   ・アイテムは、「倒した魔物に登録されているドロップ（dropItemId / dropRate）」も流用できる（標準でオン）
// ★ガチャ石（仮）：今後追加予定の「技ガチャ」で使う石。ガチャの中身はまだ決まっていないので、今は「手に入る・持てる」だけ。
//   所持数は player.gachaStones に持つ（セーブデータは player ごと保存されるので、自動でセーブされる）。
//   名前は、エディタの「ガチャ石の名前」で後から変えられる。
// ★ファイルの作り：上＝設定の読み出しと、報酬の計算／下＝実際に渡す処理とメッセージ。
//   tower_defense.js / tower_raid.js が、クリア時に tdComputeClearRewards → tdGrantClearRewards → tdDescribeRewards の順に呼ぶ。

// モードごとの標準の設定（エディタで何も設定しなければ、これで動く）
const TD_REWARD_DEFAULTS = {
  defense: { goldBase: 100, goldPerKill: 5, stageGrowth: 25, stonesBase: 1, stonesPerBoss: 1 },
  raid:    { goldBase: 100, goldPerKill: 5, stageGrowth: 25, stonesBase: 2, stonesPerBoss: 3 }
};
const TD_GACHA_STONE_DEFAULT_NAME = "ガチャ石";

function tdRewardRoot() {
  return (typeof scenarioProject !== "undefined" && scenarioProject && scenarioProject.guildRewards && typeof scenarioProject.guildRewards === "object")
    ? scenarioProject.guildRewards : {};
}

// ガチャ石の名前（仮）。エディタで変えられる
function tdGachaStoneName() {
  const n = tdRewardRoot().gachaStoneName;
  return (typeof n === "string" && n.trim()) ? n.trim() : TD_GACHA_STONE_DEFAULT_NAME;
}

// 倒した魔物に登録されているドロップを流用するか（標準でオン）
function tdUseMonsterDrops() { return tdRewardRoot().useMonsterDrops !== false; }

// モードごとの報酬設定（足りない項目は標準の値で補う）。mode は "defense" または "raid"
function tdGetRewardConfig(mode) {
  const def = TD_REWARD_DEFAULTS[mode] || TD_REWARD_DEFAULTS.defense;
  const saved = (tdRewardRoot()[mode] && typeof tdRewardRoot()[mode] === "object") ? tdRewardRoot()[mode] : {};
  const num = (key, min, max) => {
    const v = Number(saved[key]);
    return Math.min(max, Math.max(min, Number.isFinite(v) && saved[key] !== "" && saved[key] != null ? v : def[key]));
  };
  const items = (Array.isArray(saved.items) ? saved.items : []).filter(it => it && it.itemId).map(it => {
    const min = Math.max(1, Math.round(Number(it.min) || 1));
    return {
      itemId: it.itemId,
      chance: Math.min(100, Math.max(0, Number.isFinite(Number(it.chance)) ? Number(it.chance) : 100)),
      min, max: Math.max(min, Math.round(Number(it.max) || min)),
      perBoss: !!it.perBoss
    };
  });
  return {
    goldBase: num("goldBase", 0, 9999999), goldPerKill: num("goldPerKill", 0, 99999), stageGrowth: num("stageGrowth", 0, 1000),
    stonesBase: Math.round(num("stonesBase", 0, 99999)), stonesPerBoss: Math.round(num("stonesPerBoss", 0, 99999)),
    items
  };
}

// ガチャ石の所持数（player.gachaStones）
function tdGetGachaStones() {
  if (typeof player === "undefined" || !player) return 0;
  return Number.isFinite(player.gachaStones) ? player.gachaStones : 0;
}
function tdAddGachaStones(amount) {
  if (typeof player === "undefined" || !player || !(amount > 0)) return;
  player.gachaStones = tdGetGachaStones() + Math.round(amount);
}

// ===== 報酬の計算（クリア時だけ。まだ何も渡さない） =====
// result：{ kills, bossKills, stage, wavesTotal, killKeys }（killKeys＝倒した魔物の種類のID）
// 戻り値：{ gold, points, stones, items: [{ id, qty }] }
function tdComputeClearRewards(mode, result) {
  const cfg = tdGetRewardConfig(mode);
  const stage = Math.max(1, Number(result.stage) || 1);
  const kills = Number(result.kills) || 0;
  const bossKills = Number(result.bossKills) || 0;
  const growth = 1 + (cfg.stageGrowth / 100) * (stage - 1);
  const gold = Math.round((cfg.goldBase + kills * cfg.goldPerKill) * growth);
  const points = (Number(result.wavesTotal) || 0) * TD_POINTS_PER_WAVE + bossKills * TD_POINTS_PER_BOSS;
  const stones = Math.round((cfg.stonesBase + bossKills * cfg.stonesPerBoss) * growth);
  
  const got = {};   // アイテムID → 個数
  const addItemQty = (id, qty) => {
    if (typeof ITEM_MASTER !== "undefined" && !ITEM_MASTER[id]) return;   // 存在しないアイテムは出さない
    got[id] = (got[id] || 0) + qty;
  };
  // 1) 倒した魔物に登録されているドロップを流用（魔物ごとに、登録されている確率で判定）
  if (tdUseMonsterDrops() && typeof MONSTER_MASTER !== "undefined" && Array.isArray(result.killKeys)) {
    result.killKeys.forEach(key => {
      const m = MONSTER_MASTER[key];
      if (m && m.dropItemId && Math.random() < (Number(m.dropRate) || 0)) addItemQty(m.dropItemId, 1);
    });
  }
  // 2) エディタで設定した追加アイテム（確率・個数。「ボス撃破ごと」にすると、倒したボスの数だけ判定する）
  cfg.items.forEach(it => {
    const rolls = it.perBoss ? bossKills : 1;
    for (let i = 0; i < rolls; i++) {
      if (Math.random() * 100 < it.chance) addItemQty(it.itemId, it.min + Math.floor(Math.random() * (it.max - it.min + 1)));
    }
  });
  const items = Object.keys(got).map(id => ({ id, qty: got[id] }));
  return { gold, points, stones, items };
}

// ===== 報酬を実際に渡す =====
function tdGrantClearRewards(rewards) {
  if (rewards.gold > 0 && typeof changeGold === "function") changeGold(rewards.gold);
  if (rewards.points > 0) tdGuildState().points += rewards.points;
  if (rewards.stones > 0) tdAddGachaStones(rewards.stones);
  if (typeof addItem === "function") rewards.items.forEach(it => addItem(it.id, it.qty));
}

// 画面に出す報酬のメッセージ（1行目＝陳・ポイント・ガチャ石、2行目＝アイテム）
function tdDescribeRewards(rewards) {
  const lines = [`${rewards.gold}陳・協会ポイント${rewards.points}` + (rewards.stones > 0 ? `・${tdGachaStoneName()}${rewards.stones}` : "")];
  if (rewards.items.length > 0) {
    const names = rewards.items.map(it => {
      const master = (typeof ITEM_MASTER !== "undefined") ? ITEM_MASTER[it.id] : null;
      return `${master ? master.name : it.id}×${it.qty}`;
    });
    lines.push(`手に入れたアイテム：${names.join("、")}`);
  }
  return lines;
}
