// tower_rewards.js
// ===================================================================
// ===== 冒険者協会「掃討作戦」のクリア報酬（迎撃モード・出撃モード共通） =====
// ===================================================================
// ★報酬の中身：陳（お金）／協会ポイント／ガチャ石（仮）／アイテム
//   ・陳・ガチャ石・追加アイテムは、エディタ「掃討作戦の報酬」タブで設定する（scenarioProject.guildRewards）
//   ・アイテムは、「倒した魔物に登録されているドロップ（dropItemId / dropRate）」も流用できる（標準でオン）
// ★ガチャ石（仮）：便利タブの「冒険者協会」アプリのガチャ（gacha.js / guild_app.js）で使う石。
//   所持数は player.gachaStones に持つ（セーブデータは player ごと保存されるので、自動でセーブされる）。
//   名前は、エディタの「ガチャ石の名前」で後から変えられる。
// ★ファイルの作り：上＝設定の読み出しと、報酬の計算／下＝実際に渡す処理とメッセージ。
//   tower_defense.js / tower_raid.js が、クリア時に tdComputeClearRewards → tdGrantClearRewards → tdDescribeRewards の順に呼ぶ。

// モードごとの標準の設定（エディタで何も設定しなければ、これで動く）
const TD_REWARD_DEFAULTS = {
  defense: { goldBase: 100, goldPerKill: 5, stageGrowth: 25, stonesBase: 1, stonesPerBoss: 1 },
  raid:    { goldBase: 100, goldPerKill: 5, stageGrowth: 25, stonesBase: 2, stonesPerBoss: 3 }
};
const TD_GACHA_STONE_DEFAULT_NAME = "魔晶石";

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

// ===== 魔力結晶のボーナス（話クリア・実績・図鑑・ビンゴ） =====
// ★要望対応：掃討作戦のクリア報酬のほかに、遊んでいて達成したことでも魔力結晶（ガチャ石）がもらえる。
//   ・話を1話クリア＝10個　・実績を1つ解放＝3個　・図鑑を1つ埋める（発見する）＝1個
//   ・ビンゴ：図鑑の一覧（2列）で、隣り合う2行ぶん（4つ）が全部解放されたら10個（組み合わせごとに1回ずつ。何回でももらえる）
//   もらった分は player.crystalPaid に記録するので、二重には付与されない。この仕組みを入れる前に
//   達成・発見済みだった分も、最初のチェックでさかのぼってまとめて付与する
const CRYSTAL_BONUS = { chapter: 10, achievement: 3, codex: 1, bingo: 10 };
const CRYSTAL_CODEX_TABS = ["monster", "fish", "dish", "item", "furniture"];
function crystalPaidState() {
  if (!player.crystalPaid || typeof player.crystalPaid !== "object") player.crystalPaid = {};
  const paid = player.crystalPaid;
  ["chapter", "achievement", "codex", "bingo"].forEach(k => {
    if (!paid[k] || typeof paid[k] !== "object" || Array.isArray(paid[k])) paid[k] = {};
  });
  return paid;
}
// 図鑑の分類ごとの「並び順どおりの { id, discovered }」（魔物は一覧と同じ、通常の魔物→ボスの順）
function crystalCodexCells(tab) {
  if (tab === "monster") {
    const keys = [...(typeof SPAREABLE_KEYS !== "undefined" ? SPAREABLE_KEYS : []), ...(typeof BOSS_MONSTER_KEYS !== "undefined" ? BOSS_MONSTER_KEYS : [])];
    return keys.map(k => ({ id: k, discovered: !!(typeof discoveredMonsters !== "undefined" && discoveredMonsters[k]) }));
  }
  if (typeof getCodexEntries !== "function") return [];
  return getCodexEntries(tab).map(e => ({ id: e.id, discovered: !!e.discovered }));
}
// 新しく達成した分の魔力結晶を付与して、付与した個数を返す
function checkCrystalRewards() {
  if (typeof player === "undefined" || !player) return 0;
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return 0;   // エディタのテストプレイ中は付与しない
  const paid = crystalPaidState();
  const gain = { chapter: 0, achievement: 0, codex: 0, bingo: 0 };
  const chapters = (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.chapters)) ? scenarioProject.chapters : [];
  chapters.forEach(c => {
    if (!c || !c.id || c.enabled === false || !c.cleared || paid.chapter[c.id]) return;
    paid.chapter[c.id] = 1; gain.chapter++;
  });
  (Array.isArray(player.unlockedAchievementIds) ? player.unlockedAchievementIds : []).forEach(id => {
    if (!id || paid.achievement[id]) return;
    paid.achievement[id] = 1; gain.achievement++;
  });
  CRYSTAL_CODEX_TABS.forEach(tab => {
    const cells = crystalCodexCells(tab);
    cells.forEach(c => {
      if (!c.discovered || paid.codex[tab + ":" + c.id]) return;
      paid.codex[tab + ":" + c.id] = 1; gain.codex++;
    });
    // ビンゴ：2列の一覧で、隣り合う2行（4つ）がそろった組み合わせごとに1回
    for (let r = 0; r * 2 + 3 < cells.length; r++) {
      const four = cells.slice(r * 2, r * 2 + 4);
      const key = tab + ":" + four.map(c => c.id).join("|");
      if (paid.bingo[key] || !four.every(c => c.discovered)) continue;
      paid.bingo[key] = 1; gain.bingo++;
    }
  });
  const total = gain.chapter * CRYSTAL_BONUS.chapter + gain.achievement * CRYSTAL_BONUS.achievement + gain.codex * CRYSTAL_BONUS.codex + gain.bingo * CRYSTAL_BONUS.bingo;
  if (total <= 0) return 0;
  tdAddGachaStones(total);
  const lines = [];
  if (gain.chapter) lines.push(`話クリア ${gain.chapter}話`);
  if (gain.achievement) lines.push(`実績 ${gain.achievement}個`);
  if (gain.codex) lines.push(`図鑑 ${gain.codex}件`);
  if (gain.bingo) lines.push(`ビンゴ ${gain.bingo}回`);
  showCrystalToast(total, lines);
  return total;
}
// 魔力結晶をもらった時の通知（実績のトーストと同じ見た目。実績の通知と重ならないよう少し遅らせて出す）
function showCrystalToast(total, lines) {
  setTimeout(() => {
    const toast = document.createElement("div");
    toast.className = "achievement-toast";
    const titleEl = document.createElement("div");
    titleEl.className = "achievement-toast-title";
    titleEl.textContent = `💎 ${tdGachaStoneName()}を手に入れた！`;
    toast.appendChild(titleEl);
    const nameEl = document.createElement("div");
    nameEl.className = "achievement-toast-name";
    nameEl.textContent = `+${total}個`;
    toast.appendChild(nameEl);
    const rewardEl = document.createElement("div");
    rewardEl.className = "achievement-toast-reward";
    rewardEl.textContent = lines.join("　");
    toast.appendChild(rewardEl);
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 500); }, 3500);
  }, 1500);
}
