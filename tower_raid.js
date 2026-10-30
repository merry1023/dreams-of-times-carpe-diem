// tower_raid.js
// ===================================================================
// ===== 冒険者協会「掃討作戦」出撃モード（攻める側のタワーディフェンス） =====
// ===================================================================
// ★「手札」（最大8枚のキャラカード）から、リソースが足りる分を選んで出撃させ、縦に長いフィールドを下から上へ進みながら、防衛側（防衛タワー＋
//   迎撃モンスター）を突破して、10ウェーブ目（最後のウェーブ）に現れる敵の拠点を壊すとクリア（拠点があるのは最後のウェーブだけ）。
//   出撃したキャラが全員倒れたら失敗。画面は迎撃モードと同じく横長（スマホは縦長）で、カメラが敵と味方の中心を追いかける。
//   手札は運に左右されない（毎回同じ手札）。ウェーブの合間に、その時点のリソースで「追加で出撃」「レベルアップ」ができる（継ぎ足していく）。
// ★リソース（出撃資金・食料・出撃経験値・魔力石・赤まむしドリンク♂）は、戦闘中に時間や撃破で貯まる。カードごとのコストは、エディタで自由に決める。
// ★操作：準備中に出撃・強化して「進軍開始」／進軍中は自動で進む（「停止」で止まる）／射程に敵が入ると自動で止まって攻撃／スキルは手動で発動。
// ★迎撃モード（tower_defense.js）の部品をそのまま使う：道・属性相性・コンボ・状態異常・報酬・協会ポイント。
//   （tdElementMultiplier / tdGetUsableCombos / tdRecordCombo / tdDealDamage / tdApplyStatus / tdGuildState / 窓の大きさ・カメラの速さ など）
// ★ファイルの作り：上半分＝ゲームの中身（画面に触れない。単体で動作確認できる）／下半分＝画面と施設メニューからの流れ

// ----- 調整用の数値 -----
const TR_WAVES = 10;                // ウェーブ数（10ウェーブ目＝最後。敵の拠点とボスが現れる）
const TR_PARTY_MAX = 8;             // 手札の枚数（出撃に連れていける編成数）
// ----- フィールド（縦に長い世界。下＝味方の出撃地点、上＝敵の拠点）。窓の大きさ・スマホの判定・カメラの速さは迎撃モードと同じ -----
const TR_WORLD_W = 720;
const TR_WORLD_H = 2200;
const TR_START_Y = 2100;            // 味方の出撃地点
const TR_FIRST_ENCOUNTER_Y = 1750;  // 最初のウェーブの場所
const TR_LAST_NORMAL_Y = 600;       // 9ウェーブ目の場所
const TR_FINAL_Y = 340;             // 最後のウェーブ（ボス）の場所
const TR_BASE_Y = 130;              // 敵の拠点の位置（最後のウェーブだけ現れる）
const TR_BASE_W = 380;              // 同・大きさ
const TR_BASE_H = 70;
const TR_TRIGGER_DIST = 420;        // 先頭がウェーブの場所のこの距離まで近づくと、そのウェーブが現れる
const TR_SIGHT_BONUS = 160;         // 味方は、射程＋この距離の中にいる敵に向かっていく（射程の外を素通りしないため）
const TR_BASE_HP_RATE = 10;         // 敵の拠点のHP＝敵の平均HP×この値（ウェーブ・ステージで増える）
const TR_BASE_RANGE = 170;          // 敵の拠点の射程
const TR_BASE_INTERVAL = 2;         // 敵の拠点の攻撃間隔（秒）
const TR_BASE_DMG_RATE = 0.12;      // 敵の拠点の1発＝味方の平均HP×この値
// ----- リソース（戦闘中に時間や撃破で貯まる。使い道はカードの出撃コストとレベルアップ） -----
const TR_RESOURCES = [
  { key: "funds", label: "出撃資金" },
  { key: "food",  label: "食料" },
  { key: "exp",   label: "出撃経験値" },
  { key: "stone", label: "魔力石" },
  { key: "drink", label: "赤まむしドリンク♂" }
];
const TR_START_RES = { funds: 200, food: 4, exp: 0, stone: 2, drink: 1 };   // 出撃前に持っている量
const TR_FUNDS_PER_SEC = 4;         // 進軍中、時間でたまる出撃資金（1秒あたり）
const TR_FOOD_PER_SEC = 0.4;        // 同・食料
const TR_FUNDS_PER_KILL = 2;        // 迎撃モンスターを倒すと増える出撃資金
const TR_EXP_PER_KILL_RATE = 1;     // 倒した敵の経験値×この値だけ、出撃経験値が増える
const TR_STONE_PER_TOWER = 1;       // 防衛タワーを壊すと増える魔力石
const TR_STONE_PER_BOSS = 3;        // ボス・敵の拠点を倒すと増える魔力石
const TR_WAVE_CLEAR_FUNDS = 20;     // ウェーブを突破するごとに増える出撃資金
const TR_WAVE_CLEAR_STONE = 1;      // 同・魔力石
const TR_DRINK_EVERY = 3;           // このウェーブ数を突破するごとに、赤まむしドリンク♂が1つ増える
const TR_LEVEL_MAX = 5;             // キャラのレベルの上限
const TR_LEVEL_EXP_BASE = 60;       // レベルアップに使う出撃経験値＝この値×現在のレベル
const TR_LEVEL_STAT_RATE = 0.15;    // レベルが1上がるごとに、HPと攻撃力が＋15%
const TR_MONSTER_SPEED = 38;        // 迎撃モンスターの移動速度
const TR_MONSTER_RANGE = 42;        // 迎撃モンスターの攻撃距離
const TR_MONSTER_INTERVAL = 1.2;    // 迎撃モンスターの攻撃間隔（秒）
const TR_MONSTER_ATK_RATE = 2;    // 迎撃モンスターの攻撃力倍率（本編の攻撃力に掛ける）
const TR_TOWER_RANGE = 130;         // 防衛タワーの射程
const TR_TOWER_INTERVAL = 1.6;      // 防衛タワーの攻撃間隔（秒）
const TR_TOWER_HP_RATE = 3;         // 防衛タワーのHP＝敵の平均HP×この値
const TR_TOWER_DMG_RATE = 0.12;     // 防衛タワーの1発＝味方の平均HP×この値
const TR_BOSS_HP_RATE = 6;          // ボスのHP＝本編のHP×この値
const TR_BOSS_ATK_RATE = 2;         // ボスの攻撃力倍率
const TR_BOSS_RANGE = 70;           // ボスの攻撃距離
const TR_WAVE_GROWTH = 0.15;         // ウェーブが進むごとの敵の強さの増加
const TR_STAGE_HP_GROWTH = 0.15;    // 次のステージへ進むごとの敵HPの増加（出撃モード用。迎撃モードより緩やか）
const TR_STAGE_ATK_GROWTH = 0.06;   // 同・敵の攻撃力の増加
const TR_SKILL_ALL_RANGE = 300;     // 全体スキルが届く距離

// ===== 手札（出撃キャラのカード）の定義 =====
// ★エディタ「出撃キャラ」タブで登録したもの（有効なものだけ）。1つも無ければ、本編のキャラ（主人公・仲間など）から自動で作る
const TR_AUTO_ROLES = [
  { range: 80,  interval: 1.0, skillKind: "single", skillName: "渾身の一撃", skillPower: 250, skillCooldown: 8,  cost: { funds: 0 } },
  { range: 150, interval: 1.4, skillKind: "all",    skillName: "一斉射撃",   skillPower: 150, skillCooldown: 12, cost: { funds: 90, food: 1 } },
  { range: 110, interval: 1.1, skillKind: "single", skillName: "必殺の一閃", skillPower: 300, skillCooldown: 10, cost: { funds: 120 } },
  { range: 100, interval: 1.2, skillKind: "heal",   skillName: "癒しの祈り", skillPower: 30,  skillCooldown: 14, cost: { funds: 80, stone: 1 } },
  { range: 80,  interval: 1.0, skillKind: "single", skillName: "渾身の一撃", skillPower: 250, skillCooldown: 8,  cost: { funds: 100, food: 2 } },
  { range: 150, interval: 1.4, skillKind: "all",    skillName: "一斉射撃",   skillPower: 150, skillCooldown: 12, cost: { funds: 110, stone: 1 } },
  { range: 110, interval: 1.1, skillKind: "single", skillName: "必殺の一閃", skillPower: 300, skillCooldown: 10, cost: { funds: 130, food: 2 } },
  { range: 100, interval: 1.2, skillKind: "heal",   skillName: "癒しの祈り", skillPower: 30,  skillCooldown: 14, cost: { funds: 100, drink: 1 } }
];

function trAutoPartyDefs() {
  const sp = (typeof scenarioProject !== "undefined" && scenarioProject) ? scenarioProject : {};
  const elements = (Array.isArray(sp.elementDefs) && sp.elementDefs.length > 0) ? sp.elementDefs : [{ id: "無", name: "無" }];
  const members = [{ name: "田中治郎", hp: 60, atk: 12 }];   // 主人公
  (Array.isArray(sp.companions) ? sp.companions : []).forEach(c => {
    if (c && c.name) members.push({ name: c.name, hp: Number(c.baseStats && c.baseStats.maxHp) || 50, atk: Number(c.baseStats && c.baseStats.atk) || 12 });
  });
  (Array.isArray(sp.characters) ? sp.characters : []).forEach(c => {
    if (c && c.kind === "main" && c.name && !members.some(m => m.name === c.name)) members.push({ name: c.name, hp: 50, atk: 12 });
  });
  return members.slice(0, TR_PARTY_MAX).map((m, i) => {
    const role = TR_AUTO_ROLES[i % TR_AUTO_ROLES.length];
    const el = elements[i % elements.length];
    return {
      key: "a" + i, name: m.name, element: el.id, hp: m.hp, atk: m.atk, range: role.range, interval: role.interval, speed: 45,
      skillKind: role.skillKind, skillName: role.skillName, skillElement: el.id, skillPower: role.skillPower, skillCooldown: role.skillCooldown,
      cost: Object.assign({}, role.cost), imagePath: ""
    };
  });
}

// エディタの「標準の編成を登録する」ボタン用：自動で作る編成を、編集できる形で返す
function trBuildDefaultRaidData() {
  const idOf = i => (typeof generateId === "function") ? generateId("raidunit") : "raidunit_" + i;
  return trAutoPartyDefs().map((d, i) => ({
    id: idOf(i), name: d.name, enabled: true, baseType: "custom", baseId: "", element: d.element,
    hp: d.hp, atk: d.atk, range: d.range, interval: d.interval, speed: d.speed,
    skillKind: d.skillKind, skillName: d.skillName, skillElement: d.skillElement, skillPower: d.skillPower, skillCooldown: d.skillCooldown,
    cost: Object.assign({}, d.cost), imagePath: ""
  }));
}

function trClamp(v, min, max, fallback) {
  const n = Number(v);
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : fallback));
}

// カードの出撃コスト（5種類のリソースの組み合わせ。0＝使わない）
function trNormalizeCost(cost) {
  const out = {};
  TR_RESOURCES.forEach(r => { out[r.key] = Math.max(0, Math.round(Number(cost && cost[r.key]) || 0)); });
  return out;
}

// 出撃できるキャラの一覧（登録があればそれ、なければ自動）
function trGetRosterDefs() {
  const list = (typeof scenarioProject !== "undefined" && scenarioProject && Array.isArray(scenarioProject.raidUnits)) ? scenarioProject.raidUnits : [];
  const custom = list.filter(u => u && u.enabled !== false).slice(0, 30).map((u, i) => ({
    key: "r" + i, name: u.name || "名無しのキャラ", element: u.element || "無",
    hp: trClamp(u.hp, 1, 99999, 50), atk: trClamp(u.atk, 0, 99999, 12),
    range: trClamp(u.range, 70, 400, 80), interval: trClamp(u.interval, 0.2, 10, 1), speed: trClamp(u.speed, 5, 200, 45),
    skillKind: ["single", "all", "heal"].includes(u.skillKind) ? u.skillKind : "single",
    skillName: u.skillName || "スキル", skillElement: u.skillElement || u.element || "無",
    skillPower: trClamp(u.skillPower, 1, 2000, 200), skillCooldown: trClamp(u.skillCooldown, 1, 120, 8),
    cost: u.cost ? trNormalizeCost(u.cost) : trNormalizeCost({ funds: 100 }),
    imagePath: u.imagePath || ""
  }));
  return custom.length > 0 ? custom : trAutoPartyDefs();
}

// ----- リソースの出し入れ -----
function trCanAfford(res, cost) { return TR_RESOURCES.every(r => res[r.key] + 1e-9 >= (cost[r.key] || 0)); }
function trPay(res, cost) { TR_RESOURCES.forEach(r => { res[r.key] -= (cost[r.key] || 0); }); }
function trCostText(cost) {
  const parts = TR_RESOURCES.filter(r => (cost[r.key] || 0) > 0).map(r => `${r.label}${cost[r.key]}`);
  return parts.length > 0 ? parts.join("＋") : "無料";
}

// ===== 道の上の位置・防衛タワーの置き場所 =====
// ウェーブの場所（世界の縦位置）。最初は下のほうで、ウェーブが進むほど上へ。最後のウェーブは、敵の拠点の手前
function trEncounterY(wave) {
  if (wave >= TR_WAVES) return TR_FINAL_Y;
  return TR_FIRST_ENCOUNTER_Y - (wave - 1) * (TR_FIRST_ENCOUNTER_Y - TR_LAST_NORMAL_Y) / (TR_WAVES - 2);
}

// 手札のカードごとの、進軍する横位置（隊列）
function trLaneX(cardIndex) {
  return 80 + cardIndex * (TR_WORLD_W - 160) / Math.max(1, TR_PARTY_MAX - 1);
}

// 防衛側の e と、点 (x, y) との距離。敵の拠点だけは大きさがあるので、四角形の外側までの距離にする
function trDist(e, x, y) {
  if (e.kind === "base") {
    const dx = Math.max(Math.abs(x - e.x) - e.w / 2, 0), dy = Math.max(Math.abs(y - e.y) - e.h / 2, 0);
    return Math.hypot(dx, dy);
  }
  return Math.hypot(e.x - x, e.y - y);
}

// 味方が向かう点（拠点は、いちばん近い四角形の縁）
function trApproachPoint(e, x, y) {
  if (e.kind === "base") return { x: Math.max(e.x - e.w / 2, Math.min(e.x + e.w / 2, x)), y: Math.max(e.y - e.h / 2, Math.min(e.y + e.h / 2, y)) };
  return { x: e.x, y: e.y };
}

// カメラが見る縦位置の目標（窓の上端）：味方の中心と、近くの敵の中心の、中間を映す。敵がいなければ、少し先を映す
function trCameraTarget(st, view) {
  const alive = st.party.filter(u => u.alive);
  const partyY = alive.length > 0 ? alive.reduce((sum, u) => sum + u.y, 0) / alive.length : TR_START_Y;
  let focus = partyY - 70;
  const near = st.defenders.filter(e => e.hp > 0 && Math.abs(e.y - partyY) < 700);
  if (near.length > 0) focus = (partyY + near.reduce((sum, e) => sum + e.y, 0) / near.length) / 2;
  return Math.max(0, Math.min(TR_WORLD_H - view.h, focus - view.h / 2));
}

// ===== ゲームの状態 =====
// phase：prep＝準備中（出撃・強化ができる）／play＝進軍・戦闘中／won／lost
function trCreateState(rosterDefs, opts) {
  opts = opts || {};
  const pool = tdGetEnemyPool();
  const masters = pool.map(k => MONSTER_MASTER[k]);
  const avg = f => masters.reduce((s, m) => s + (Number(f(m)) || 0), 0) / Math.max(1, masters.length);
  const refHp = Math.max(1, avg(m => m.maxHp));
  const refAtk = Math.max(1, avg(m => m.atk));
  const refExp = Math.max(1, avg(m => m.exp));
  // ★事前強化の「拠点HP」は、出撃モードでは味方全員の最大HPに掛かる（出撃モードには守る拠点が無いため）
  const hpRate = 1 + TD_UPG_HP_RATE * ((opts.upgrades && opts.upgrades.baseHp) || 0);
  const defs = rosterDefs.slice(0, TR_PARTY_MAX);
  const partyAvgHp = Math.max(1, defs.reduce((s, d) => s + d.hp, 0) / Math.max(1, defs.length)) * hpRate;
  const st = {
    mode: "raid", phase: "prep", stage: Math.max(1, Number(opts.stage) || 1),
    time: 0, speed: 1, hold: false, hpRate,
    hand: defs.map(d => ({ def: d, level: 1, unit: null })),    // 手札（毎回同じ。運に左右されない）
    party: [],                                                  // 出撃したキャラ（倒れたものも、再出撃するまで残る）
    res: Object.assign({}, TR_START_RES),
    defenders: [], enemies: [],                                 // enemies は defenders と同じもの（迎撃モードの部品が enemies を見るため）
    currentWave: 1, waveActive: false, kills: 0, bossKills: 0, killKeys: [],   // killKeys＝倒した魔物の種類のID（クリア時のドロップ判定に使う）
    pool, bossPool: tdGetBossPool(refHp, refAtk), refHp, refAtk, refExp, partyAvgHp, wavesTotal: TR_WAVES,
    combos: tdGetUsableCombos(), history: [], comboLockUntil: 0, comboCount: 0,
    fx: [], popups: [], banners: []
  };
  // 回復コンボは、味方を回復させる
  st.onComboHeal = () => {
    st.party.forEach(u => { if (u.alive) u.hp = Math.min(u.maxHp, u.hp + Math.round(u.maxHp * 0.1)); });
  };
  return st;
}

function trLevelRate(level) { return 1 + TR_LEVEL_STAT_RATE * (level - 1); }
function trLevelUpCost(card) { return { exp: TR_LEVEL_EXP_BASE * card.level }; }

// カードから、戦場に出るキャラを作る（レベルに応じてHP・攻撃力が上がる）
function trMakeUnit(st, card, x, y) {
  const d = card.def;
  const maxHp = Math.round(d.hp * st.hpRate * trLevelRate(card.level));
  return {
    card, def: d, name: d.name, element: d.element, hp: maxHp, maxHp, atk: d.atk * trLevelRate(card.level),
    range: d.range, interval: d.interval, speed: d.speed, imagePath: d.imagePath,
    x, y, laneX: trLaneX(st.hand.indexOf(card)), cool: 0, alive: true,
    skill: { kind: d.skillKind, name: d.skillName, element: d.skillElement, power: d.skillPower, cooldown: d.skillCooldown, left: 0 },
    // コンボ（迎撃モードの部品）が参照する形：属性・狙い方・射程
    tpl: { element: d.element, targeting: "near", range: d.range, role: "single" }
  };
}

// 出撃する（準備中のみ）。手札のカードを、リソースが足りる分だけ出せる。倒れたキャラは、コストを払い直して再出撃できる
function trDeploy(st, cardIndex) {
  const card = st.hand[cardIndex];
  if (st.phase !== "prep" || !card) return { ok: false, reason: "今は出撃できない" };
  if (card.unit && card.unit.alive) return { ok: false, reason: "もう出撃している" };
  if (!trCanAfford(st.res, card.def.cost)) return { ok: false, reason: "リソースが足りない" };
  trPay(st.res, card.def.cost);
  if (card.unit) st.party = st.party.filter(u => u !== card.unit);   // 倒れていた分は入れ替える
  const alive = st.party.filter(u => u.alive);
  // 味方がいれば、その後ろ（いちばん下の味方のすぐ後ろ）に合流する。いなければ、出撃地点から
  const y = alive.length > 0 ? Math.min(TR_WORLD_H - 30, alive.reduce((m, u) => Math.max(m, u.y), 0) + 26) : TR_START_Y;
  const unit = trMakeUnit(st, card, trLaneX(cardIndex), y);
  st.party.push(unit);
  card.unit = unit;
  return { ok: true };
}

// レベルアップ（準備中のみ・出撃中のキャラ）。出撃経験値を使う
function trLevelUp(st, cardIndex) {
  const card = st.hand[cardIndex];
  if (st.phase !== "prep" || !card) return { ok: false, reason: "今は強化できない" };
  if (!card.unit || !card.unit.alive) return { ok: false, reason: "出撃していないキャラは強化できない" };
  if (card.level >= TR_LEVEL_MAX) return { ok: false, reason: "これ以上強化できない" };
  const cost = trLevelUpCost(card);
  if (!trCanAfford(st.res, cost)) return { ok: false, reason: "出撃経験値が足りない" };
  trPay(st.res, cost);
  const u = card.unit;
  card.level++;
  const newMax = Math.round(card.def.hp * st.hpRate * trLevelRate(card.level));
  u.hp += newMax - u.maxHp;           // 増えた分のHPは、その場で回復する
  u.maxHp = newMax;
  u.atk = card.def.atk * trLevelRate(card.level);
  return { ok: true };
}

// 進軍開始（準備中のみ。出撃しているキャラが1体以上必要）
function trStartMarch(st) {
  if (st.phase !== "prep") return { ok: false, reason: "今は進軍できない" };
  if (!st.party.some(u => u.alive)) return { ok: false, reason: "出撃しているキャラがいない" };
  st.phase = "play";
  return { ok: true };
}

// 準備中に出撃できるキャラも残っていなければ、失敗
function trIsStuck(st) {
  if (st.party.some(u => u.alive)) return false;
  return !st.hand.some(c => trCanAfford(st.res, c.def.cost));
}

function trStageGrowth(st, wave) {
  return (1 + TR_STAGE_HP_GROWTH * (st.stage - 1)) * (1 + TR_WAVE_GROWTH * (wave - 1));
}

// ウェーブの敵を出す：迎撃モンスター（味方に向かって下りてくる）＋防衛タワー（その場から撃ってくる）。
// 最後のウェーブだけ、ボスと「敵の拠点」（壊すとクリア）が現れる
function trSpawnWave(st, wave) {
  const encY = trEncounterY(wave);
  const growth = trStageGrowth(st, wave);
  const atkGrowth = 1 + TR_STAGE_ATK_GROWTH * (st.stage - 1);
  const usable = st.pool.slice(0, Math.min(st.pool.length, 2 + wave + (st.stage - 1)));
  const isFinal = wave >= TR_WAVES;
  const monsterCount = isFinal ? 4 : 3 + wave;
  const towerCount = isFinal ? 2 : Math.floor((wave + 1) / 3);
  const common = { stunUntil: 0, dot: null, defDownUntil: 0, atkDownUntil: 0, slowUntil: 0, slowRate: 1 };
  for (let i = 0; i < monsterCount; i++) {
    const key = usable[Math.floor(Math.random() * usable.length)];
    const m = MONSTER_MASTER[key];
    const hp = Math.max(1, Math.round((Number(m.maxHp) || 10) * growth));
    st.defenders.push(Object.assign({
      kind: "monster", key, name: m.name || key, hp, maxHp: hp,
      atk: Math.max(1, (Number(m.atk) || 1) * TR_MONSTER_ATK_RATE * atkGrowth), range: TR_MONSTER_RANGE, interval: TR_MONSTER_INTERVAL, speed: TR_MONSTER_SPEED,
      elements: Array.isArray(m.elements) ? m.elements : [], ignoreAffinity: !!m.ignoreElementalAffinity, imagePath: m.imagePath || null,
      x: 70 + Math.random() * (TR_WORLD_W - 140), y: encY - 40 - i * 26, cool: Math.random() * TR_MONSTER_INTERVAL,
      exp: Number(m.exp) || 5
    }, common));
  }
  const attackTemplates = tdAutoUnitTemplates().filter(t => t.role !== "support");
  for (let i = 0; i < towerCount; i++) {
    const tpl = attackTemplates[(wave + i) % attackTemplates.length];
    const hp = Math.max(1, Math.round(st.refHp * TR_TOWER_HP_RATE * growth));
    st.defenders.push(Object.assign({
      kind: "tower", key: null, name: `${tdElementName(tpl.element)}の防衛塔`, hp, maxHp: hp,
      atk: Math.max(1, st.partyAvgHp * TR_TOWER_DMG_RATE * growth * atkGrowth), range: TR_TOWER_RANGE, interval: TR_TOWER_INTERVAL, speed: 0,
      elements: [tpl.element], ignoreAffinity: false, imagePath: null,
      x: 90 + (i + 0.5) * (TR_WORLD_W - 180) / towerCount, y: encY - 120, cool: Math.random() * TR_TOWER_INTERVAL,
      exp: Math.round(st.refExp * 1.5)
    }, common));
  }
  if (isFinal) {
    const idx = Math.min(st.bossPool.length - 1, Math.max(0, st.stage - 1));
    const key = st.bossPool.length > 0 ? st.bossPool[idx] : st.pool[st.pool.length - 1];   // ボス候補がいなければ、いちばん強い通常の魔物
    const m = MONSTER_MASTER[key];
    const hp = Math.max(1, Math.round((Number(m.maxHp) || 50) * TR_BOSS_HP_RATE * growth));
    st.defenders.push(Object.assign({
      kind: "boss", isBoss: true, key, name: m.name || key, hp, maxHp: hp,
      atk: Math.max(1, (Number(m.atk) || 5) * TR_BOSS_ATK_RATE * atkGrowth), range: TR_BOSS_RANGE, interval: 1.5, speed: 0,
      elements: Array.isArray(m.elements) ? m.elements : [], ignoreAffinity: !!m.ignoreElementalAffinity, imagePath: m.imagePath || null,
      x: TR_WORLD_W / 2, y: encY - 120, cool: 0.8,
      exp: Math.round((Number(m.exp) || 20) * 4)
    }, common));
    // 敵の拠点（最後のウェーブだけ）：壊すとクリア。近づく味方を、射程内から撃ってくる
    const baseHp = Math.max(1, Math.round(st.refHp * TR_BASE_HP_RATE * growth));
    st.defenders.push(Object.assign({
      kind: "base", key: null, name: "敵の拠点", hp: baseHp, maxHp: baseHp,
      atk: Math.max(1, st.partyAvgHp * TR_BASE_DMG_RATE * growth * atkGrowth), range: TR_BASE_RANGE, interval: TR_BASE_INTERVAL, speed: 0,
      elements: [], ignoreAffinity: true, imagePath: null,
      x: TR_WORLD_W / 2, y: TR_BASE_Y, w: TR_BASE_W, h: TR_BASE_H, cool: 1.5,
      exp: Math.round(st.refExp * 5)
    }, common));
  }
  st.enemies = st.defenders;
  st.banners.push({ text: isFinal ? "敵の拠点が見えた！" : `WAVE ${wave}`, t: 1.2 });
}

// ===== 味方のスキル（手動） =====
function trUseSkill(st, index) {
  const u = st.party[index];
  if (!u || !u.alive || st.phase !== "play") return { ok: false, reason: "使えない" };
  if (u.skill.left > 0) return { ok: false, reason: "まだ使えない" };
  const sk = u.skill;
  const color = (typeof getElementColor === "function") ? getElementColor(sk.element) : "#ffffff";
  if (sk.kind === "heal") {
    st.party.forEach(a => {
      if (!a.alive) return;
      const healed = Math.max(1, Math.round(a.maxHp * sk.power / 100));
      a.hp = Math.min(a.maxHp, a.hp + healed);
      st.popups.push({ x: a.x, y: a.y - 18, text: `+${healed}`, color: "#59e07a", weak: false, t: 0.8 });
    });
    st.banners.push({ text: sk.name, t: 0.9 });
  } else {
    const alive = st.defenders.filter(e => e.hp > 0);
    let targets = [];
    if (sk.kind === "all") targets = alive.filter(e => trDist(e, u.x, u.y) <= TR_SKILL_ALL_RANGE);
    else {
      let pick = null;
      alive.forEach(e => { const d = trDist(e, u.x, u.y); if (d <= TR_SKILL_ALL_RANGE && (!pick || d < pick.d)) pick = { e, d }; });
      if (pick) targets = [pick.e];
    }
    if (targets.length === 0) return { ok: false, reason: "届く敵がいない" };
    const base = Math.max(1, u.atk * sk.power / 100);
    targets.forEach(e => {
      tdDealDamage(st, e, base, sk.element, color);
      st.fx.push({ kind: "line", x1: u.x, y1: u.y, x2: e.x, y2: e.y, color, t: 0.25 });
    });
    st.banners.push({ text: sk.name, t: 0.9 });
    // スキルの属性も、コンボの履歴に積む（積まれる属性はスキルの属性。単体コンボの標的は、使った味方から一番近い敵）
    tdRecordCombo(st, { tpl: { element: sk.element, targeting: "near", range: TR_SKILL_ALL_RANGE, role: "single" } }, { x: u.x, y: u.y });
  }
  sk.left = sk.cooldown;
  return { ok: true };
}

// ===== 1コマ進める =====
function trStep(st, dt) {
  st.time += dt;
  st.fx.forEach(f => { f.t -= dt; });
  st.fx = st.fx.filter(f => f.t > 0);
  st.popups.forEach(p => { p.t -= dt; });
  st.popups = st.popups.filter(p => p.t > 0);
  st.banners.forEach(b => { b.t -= dt; });
  st.banners = st.banners.filter(b => b.t > 0);
  if (st.phase !== "play") return;
  
  const aliveParty = () => st.party.filter(u => u.alive);
  
  // 時間でたまるリソース（進軍中だけ。準備中は止まっている）
  st.res.funds += TR_FUNDS_PER_SEC * dt;
  st.res.food += TR_FOOD_PER_SEC * dt;
  
  // ウェーブの出現（先頭の味方が、そのウェーブの場所に近づいたら。上へ進むほど縦位置の数字は小さくなる）
  const front = aliveParty().reduce((m, u) => Math.min(m, u.y), Infinity);
  if (!st.waveActive && st.currentWave <= TR_WAVES && front <= trEncounterY(st.currentWave) + TR_TRIGGER_DIST) {
    trSpawnWave(st, st.currentWave);
    st.waveActive = true;
  }
  
  // 味方：射程に敵がいれば止まって攻撃／射程の外でも近くにいれば、その敵に向かう／敵がいなければ、上へ進軍する
  st.party.forEach(u => {
    if (!u.alive) return;
    u.cool -= dt;
    if (u.skill.left > 0) u.skill.left = Math.max(0, u.skill.left - dt);
    let target = null, sight = null;
    st.defenders.forEach(e => {
      if (e.hp <= 0) return;
      const d = trDist(e, u.x, u.y);
      if (d <= u.range && (!target || d < target.d)) target = { e, d };
      if (d <= u.range + TR_SIGHT_BONUS && (!sight || d < sight.d)) sight = { e, d };
    });
    if (target) {
      if (u.cool <= 0) {
        const color = (typeof getElementColor === "function") ? getElementColor(u.element) : "#ffffff";
        tdDealDamage(st, target.e, Math.max(1, u.atk), u.element, color);
        st.fx.push({ kind: "line", x1: u.x, y1: u.y, x2: target.e.x, y2: target.e.y, color, t: 0.1 });
        u.cool = u.interval;
        tdRecordCombo(st, u, { x: u.x, y: u.y });
      }
      return;                                     // 射程に敵がいる間は、止まって戦う
    }
    if (st.hold) return;
    if (sight) {                                  // 射程の外の敵に向かって歩く（素通りしない）
      const pt = trApproachPoint(sight.e, u.x, u.y);
      const dx = pt.x - u.x, dy = pt.y - u.y, len = Math.hypot(dx, dy) || 1, step = Math.min(len, u.speed * dt);
      u.x += dx / len * step; u.y += dy / len * step;
    } else {
      u.y -= u.speed * dt;                        // 上へ進軍
      u.x += (u.laneX - u.x) * Math.min(1, dt * 2);   // 戦闘でずれた横位置を、隊列に戻す
    }
    u.x = Math.max(20, Math.min(TR_WORLD_W - 20, u.x));
    u.y = Math.max(TR_BASE_Y + TR_BASE_H, Math.min(TR_WORLD_H - 20, u.y));
  });
  
  // 防衛側：状態異常／攻撃／迎撃モンスターは、いちばん近い味方に向かって歩く
  st.defenders.forEach(e => {
    if (e.dot) {
      while (e.dot && st.time >= e.dot.next) {
        e.hp -= e.dot.dmg;
        st.popups.push({ x: e.x, y: e.y - 16, text: String(e.dot.dmg), color: "#ff9a3c", weak: false, t: 0.5 });
        e.dot.next += 1;
        if (e.dot.next > e.dot.until + 0.0001) e.dot = null;
      }
    }
    if (e.hp <= 0 || e.stunUntil > st.time) return;
    e.cool -= dt;
    let target = null, nearest = null;
    aliveParty().forEach(u => {
      const d = trDist(e, u.x, u.y);
      if (d <= e.range && (!target || d < target.d)) target = { u, d };
      if (!nearest || d < nearest.d) nearest = { u, d };
    });
    if (target) {
      if (e.cool <= 0) {
        const attackEl = (e.elements && e.elements.length > 0) ? e.elements[0] : "無";
        const mult = tdElementMultiplier(attackEl, { elements: [target.u.element] });
        const dmg = Math.max(1, Math.round(e.atk * mult * (e.atkDownUntil > st.time ? TD_ATKDOWN_RATE : 1)));
        target.u.hp -= dmg;
        e.cool = e.interval;
        st.popups.push({ x: target.u.x, y: target.u.y - 18, text: String(dmg), color: "#ff6b6b", weak: false, t: 0.5 });
        if (e.kind === "tower" || e.kind === "base") st.fx.push({ kind: "line", x1: e.x, y1: e.y, x2: target.u.x, y2: target.u.y, color: "#ff6b6b", t: 0.1 });
        if (target.u.hp <= 0) {
          target.u.hp = 0; target.u.alive = false;
          st.popups.push({ x: target.u.x, y: target.u.y - 26, text: "戦闘不能", color: "#9aa4ad", weak: false, t: 1.0 });
        }
      }
      return;
    }
    if (e.kind === "monster" && nearest) {         // 迎撃モンスターは、いちばん近い味方に向かって歩く
      const dx = nearest.u.x - e.x, dy = nearest.u.y - e.y, len = Math.hypot(dx, dy) || 1, step = Math.min(len, e.speed * dt);
      e.x += dx / len * step; e.y += dy / len * step;
    }
  });
  
  // 倒した防衛側の処理（撃破でたまるリソース：出撃経験値・出撃資金・魔力石）
  const alive = [];
  let baseDown = false;
  st.defenders.forEach(e => {
    if (e.hp > 0) { alive.push(e); return; }
    st.kills++;
    if (e.key) st.killKeys.push(e.key);
    st.res.exp += (e.exp || 0) * TR_EXP_PER_KILL_RATE;
    if (e.kind === "monster") st.res.funds += TR_FUNDS_PER_KILL;
    if (e.kind === "tower") st.res.stone += TR_STONE_PER_TOWER;
    if (e.isBoss) { st.bossKills++; st.res.stone += TR_STONE_PER_BOSS; }
    if (e.kind === "base") { baseDown = true; st.res.stone += TR_STONE_PER_BOSS; }
    st.popups.push({ x: e.x, y: e.y - 20, text: e.kind === "base" ? "拠点を撃破！" : "撃破", color: "#ffd23f", weak: false, t: 0.8 });
  });
  st.defenders = alive; st.enemies = alive;
  
  // 勝ち負け：敵の拠点を壊したらクリア。出撃した味方が全員倒れたら失敗
  if (baseDown) { st.phase = "won"; return; }
  if (aliveParty().length === 0) { st.phase = "lost"; return; }
  
  // ウェーブを突破したら、準備中に戻る（出撃・レベルアップを継ぎ足せる）。最後のウェーブは、拠点を壊すまで続く
  if (st.waveActive && st.defenders.length === 0) {
    st.waveActive = false;
    st.res.funds += TR_WAVE_CLEAR_FUNDS;
    st.res.stone += TR_WAVE_CLEAR_STONE;
    if (st.currentWave % TR_DRINK_EVERY === 0) st.res.drink += 1;
    st.banners.push({ text: `WAVE ${st.currentWave} 突破！`, t: 1.4 });
    st.currentWave++;
    st.phase = "prep";
    if (trIsStuck(st)) st.phase = "lost";
  }
}

// ===================================================================
// ===== ここから下は画面（オーバーレイ・描画・操作）と施設メニューからの流れ =====
// ===================================================================

// 出撃するキャラを選ぶ（登録が8体より多い時だけ使う）。選んだ定義の配列を返す。やめたら null
function trSelectParty(roster) {
  return new Promise(resolve => {
    const chosen = new Set(roster.slice(0, TR_PARTY_MAX).map(d => d.key));
    const overlay = document.createElement("div");
    overlay.className = "td-overlay";
    overlay.innerHTML = `
      <div class="td-panel">
        <div class="td-header"><span class="td-title">手札にするキャラを選ぶ</span><span class="td-wave"></span></div>
        <div class="td-info"></div>
        <div class="td-units"></div>
        <div class="td-controls">
          <button type="button" class="td-btn td-btn-start">出撃！</button>
          <button type="button" class="td-btn td-btn-quit">やめる</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const countEl = overlay.querySelector(".td-wave");
    const infoEl = overlay.querySelector(".td-info");
    const gridEl = overlay.querySelector(".td-units");
    const goBtn = overlay.querySelector(".td-btn-start");
    function refresh() {
      countEl.textContent = `${chosen.size}/${TR_PARTY_MAX}`;
      goBtn.disabled = chosen.size === 0;
      gridEl.querySelectorAll(".td-unit-btn").forEach(btn => btn.classList.toggle("td-selected", chosen.has(btn.dataset.key)));
    }
    infoEl.textContent = `最大${TR_PARTY_MAX}枚まで選べます（出撃の手札になります）。タップで選ぶ／外す。`;
    roster.forEach(d => {
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "td-unit-btn"; btn.dataset.key = d.key;
      btn.style.borderColor = tdElementColor(d.element);
      btn.innerHTML = `<span class="td-unit-name">${d.name}</span><span class="td-unit-meta">HP${d.hp} 攻${d.atk}・${trCostText(d.cost)}</span>`;
      btn.onclick = () => {
        if (chosen.has(d.key)) chosen.delete(d.key);
        else if (chosen.size < TR_PARTY_MAX) chosen.add(d.key);
        else infoEl.textContent = `手札は最大${TR_PARTY_MAX}枚までです。`;
        refresh();
      };
      gridEl.appendChild(btn);
    });
    goBtn.onclick = () => { overlay.remove(); resolve(roster.filter(d => chosen.has(d.key))); };
    overlay.querySelector(".td-btn-quit").onclick = () => { overlay.remove(); resolve(null); };
    refresh();
  });
}

// ミニゲーム本体。終わったら { result: "win" | "lose" | "quit", kills, bossKills, stage } を返す
function runTowerRaidBattle(rosterDefs, opts) {
  return new Promise(resolve => {
    const st = trCreateState(rosterDefs, opts);
    const view = tdIsPhone() ? TD_VIEW_PORTRAIT : TD_VIEW_LANDSCAPE;   // 横長の窓（スマホだけ縦長）。迎撃モードと同じ
    let cam = trCameraTarget(st, view);                                // カメラ（窓の上端の位置）
    let finished = false, rafId = null, lastTs = null, uiAccum = 0;
    let quitArmed = false, quitTimer = null;
    let infoNote = "", infoNoteUntil = 0;
    
    const overlay = document.createElement("div");
    overlay.className = "td-overlay";
    overlay.innerHTML = `
      <div class="td-panel">
        <div class="td-header">
          <span class="td-title">掃討作戦（出撃） STAGE ${st.stage}</span>
          <span class="td-wave"></span>
          <span class="td-funds"></span>
        </div>
        <div class="td-res"></div>
        <div class="td-basehp"><div class="td-basehp-fill td-party-fill"></div><span class="td-basehp-text"></span></div>
        <canvas class="td-canvas" width="${view.w * 2}" height="${view.h * 2}" style="aspect-ratio: ${view.w} / ${view.h};"></canvas>
        <div class="td-info"></div>
        <div class="td-hand"></div>
        <div class="td-combo"></div>
        <div class="td-controls">
          <button type="button" class="td-btn td-btn-start"></button>
          <button type="button" class="td-btn td-btn-speed"></button>
          <button type="button" class="td-btn td-btn-quit"></button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const canvas = overlay.querySelector(".td-canvas");
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);
    const waveEl = overlay.querySelector(".td-wave");
    const phaseEl = overlay.querySelector(".td-funds");
    const resEl = overlay.querySelector(".td-res");
    const fillEl = overlay.querySelector(".td-party-fill");
    const hpTextEl = overlay.querySelector(".td-basehp-text");
    const infoEl = overlay.querySelector(".td-info");
    const handEl = overlay.querySelector(".td-hand");
    const comboEl = overlay.querySelector(".td-combo");
    const mainBtn = overlay.querySelector(".td-btn-start");
    const speedBtn = overlay.querySelector(".td-btn-speed");
    const quitBtn = overlay.querySelector(".td-btn-quit");
    
    // リソース表示（5種類）
    const resChips = TR_RESOURCES.map(r => {
      const chip = document.createElement("span");
      chip.className = "td-res-chip";
      chip.innerHTML = `${r.label} <b>0</b>`;
      resEl.appendChild(chip);
      return chip.querySelector("b");
    });
    
    function note(text) { infoNote = text; infoNoteUntil = performance.now() + 2500; refreshUI(); }
    
    // 手札（カード）。ボタンは作りっぱなしにして、文字と有効／無効だけを更新する（タップ中に作り直さないため）
    const cardEls = st.hand.map((card, i) => {
      const el = document.createElement("div");
      el.className = "td-card";
      el.style.borderColor = tdElementColor(card.def.element);
      el.innerHTML = `
        <div class="td-card-head"><span class="td-card-name"></span><span class="td-card-lv"></span></div>
        <div class="td-card-cost"></div>
        <div class="td-card-btns">
          <button type="button" class="td-btn td-card-act1"></button>
          <button type="button" class="td-btn td-card-act2"></button>
        </div>`;
      const act1 = el.querySelector(".td-card-act1"), act2 = el.querySelector(".td-card-act2");
      act1.onclick = () => {
        let r;
        if (st.phase === "prep") r = trDeploy(st, i);
        else r = trUseSkill(st, st.party.indexOf(card.unit));
        if (!r.ok) note(r.reason); else refreshUI();
      };
      act2.onclick = () => { const r = trLevelUp(st, i); if (!r.ok) note(r.reason); else refreshUI(); };
      handEl.appendChild(el);
      return { el, card, name: el.querySelector(".td-card-name"), lv: el.querySelector(".td-card-lv"), cost: el.querySelector(".td-card-cost"), act1, act2 };
    });
    
    function refreshUI() {
      const bossWave = st.currentWave >= TR_WAVES;
      waveEl.textContent = `WAVE ${Math.min(st.currentWave, TR_WAVES)}/${TR_WAVES}` + (bossWave ? " ★最後" : "");
      phaseEl.textContent = st.phase === "prep" ? "準備中" : (st.phase === "play" ? "進軍中" : "終了");
      TR_RESOURCES.forEach((r, i) => { resChips[i].textContent = String(Math.floor(st.res[r.key] + 1e-9)); });
      const alive = st.party.filter(u => u.alive);
      const hp = alive.reduce((sum, u) => sum + u.hp, 0), maxHp = alive.reduce((sum, u) => sum + u.maxHp, 0);
      fillEl.style.width = `${Math.round(hp / Math.max(1, maxHp) * 100)}%`;
      hpTextEl.textContent = `出撃中 ${alive.length}体　HP合計 ${Math.round(hp)}/${maxHp}`;
      mainBtn.textContent = st.phase === "prep" ? `進軍開始（WAVE ${Math.min(st.currentWave, TR_WAVES)}）` : (st.hold ? "進軍する" : "停止する");
      mainBtn.disabled = st.phase === "won" || st.phase === "lost" || (st.phase === "prep" && alive.length === 0);
      speedBtn.textContent = `速度 ×${st.speed}`;
      quitBtn.textContent = quitArmed ? "本当にやめる？" : "やめる";
      
      cardEls.forEach(ce => {
        const card = ce.card, unit = card.unit, d = card.def;
        const isAlive = !!(unit && unit.alive);
        ce.name.textContent = d.name;
        ce.lv.textContent = `Lv${card.level}` + (isAlive ? "" : (unit ? "　戦闘不能" : ""));
        ce.cost.innerHTML = TR_RESOURCES.filter(r => (d.cost[r.key] || 0) > 0).map(r => `<span class="${st.res[r.key] + 1e-9 >= d.cost[r.key] ? "" : "td-short"}">${r.label}${d.cost[r.key]}</span>`).join(" ") || "<span>無料</span>";
        ce.el.classList.toggle("td-card-out", isAlive);
        ce.el.classList.toggle("td-card-dead", !!unit && !unit.alive);
        if (st.phase === "prep") {
          ce.act1.hidden = false;
          ce.act1.textContent = isAlive ? "出撃中" : (unit ? "再出撃" : "出撃");
          ce.act1.disabled = isAlive || !trCanAfford(st.res, d.cost);
          ce.act2.hidden = false;
          const lvCost = trLevelUpCost(card).exp;
          ce.act2.textContent = card.level >= TR_LEVEL_MAX ? "最大Lv" : `Lv↑ 経験値${lvCost}`;
          ce.act2.disabled = !isAlive || card.level >= TR_LEVEL_MAX || st.res.exp + 1e-9 < lvCost;
        } else {
          ce.act2.hidden = true;
          ce.act1.hidden = false;
          const ready = isAlive && unit.skill.left <= 0;
          ce.act1.textContent = !unit ? "（未出撃）" : (isAlive ? `${unit.skill.name}${ready ? "" : `　あと${Math.ceil(unit.skill.left)}秒`}` : "戦闘不能");
          ce.act1.disabled = !ready || st.phase !== "play";
        }
      });
      
      if (infoNote && performance.now() < infoNoteUntil) infoEl.textContent = infoNote;
      else if (st.phase === "prep") infoEl.textContent = `準備中：手札から「出撃」「Lv↑」を選んで、「進軍開始」。リソースは進軍中に時間と撃破で貯まります。`;
      else if (st.phase === "play") infoEl.textContent = "進軍中：自動で進みます。スキルは各キャラのボタンで発動。ウェーブを突破すると準備中に戻ります。";
      else infoEl.textContent = "";
      
      if (st.combos.length === 0) {
        comboEl.innerHTML = `<span class="td-combo-label">COMBO</span><span class="td-combo-none">使えるコンボはまだない（本編でコンボを解禁すると使える）</span>`;
      } else {
        const hist = st.history.length > 0 ? st.history.map(tdElementChipHtml).join('<span class="td-arrow">→</span>') : '<span class="td-combo-none">なし</span>';
        const list = st.combos.map(c => `<div class="td-combo-item"><b>${c.name || "名無しのコンボ"}</b> ${(c.elements || []).filter(Boolean).map(tdElementChipHtml).join('<span class="td-arrow">→</span>')}</div>`).join("");
        comboEl.innerHTML = `<div class="td-combo-row"><span class="td-combo-label">履歴</span>${hist}</div>${list}`;
      }
    }
    mainBtn.onclick = () => {
      if (st.phase === "prep") { const r = trStartMarch(st); if (!r.ok) note(r.reason); else refreshUI(); }
      else if (st.phase === "play") { st.hold = !st.hold; refreshUI(); }
    };
    speedBtn.onclick = () => { st.speed = st.speed === 1 ? 2 : 1; refreshUI(); };
    quitBtn.onclick = () => {
      if (!quitArmed) { quitArmed = true; quitTimer = setTimeout(() => { quitArmed = false; refreshUI(); }, 3000); refreshUI(); return; }
      finish("quit");
    };
    
    // ----- 描画（世界をカメラの位置だけずらして描き、そのあと画面に固定の表示を重ねる） -----
    function drawBar(x, y, w, ratio, color) {
      ctx.fillStyle = "#000"; ctx.fillRect(x - 1, y, w + 2, 6);
      ctx.fillStyle = color; ctx.fillRect(x, y + 1, w * Math.max(0, ratio), 4);
    }
    function draw() {
      ctx.clearRect(0, 0, view.w, view.h);
      ctx.save();
      ctx.translate(0, -cam);
      // 地面：上（敵の拠点）から下（味方の出撃地点）へ。横線で、カメラが動いたことが分かるようにする
      const grad = ctx.createLinearGradient(0, 0, 0, TR_WORLD_H);
      grad.addColorStop(0, "#241420"); grad.addColorStop(0.5, "#14202a"); grad.addColorStop(1, "#0f2a1e");
      ctx.fillStyle = grad; ctx.fillRect(0, 0, TR_WORLD_W, TR_WORLD_H);
      ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 1;
      for (let y = 40; y < TR_WORLD_H; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(TR_WORLD_W, y); ctx.stroke(); }
      // ウェーブの場所の目印（薄い線と番号）。進み具合が分かる
      for (let w = 1; w <= TR_WAVES; w++) {
        const y = trEncounterY(w);
        ctx.strokeStyle = w < st.currentWave ? "rgba(89,224,122,0.35)" : "rgba(255,210,63,0.35)"; ctx.setLineDash([8, 6]); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(TR_WORLD_W, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = w < st.currentWave ? "rgba(89,224,122,0.8)" : "rgba(255,210,63,0.8)"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
        ctx.fillText(w >= TR_WAVES ? "最後のウェーブ" : `WAVE ${w}`, 8, y - 3);
      }
      // 味方の出撃地点
      ctx.fillStyle = "rgba(89,224,122,0.18)"; ctx.fillRect(0, TR_START_Y - 40, TR_WORLD_W, TR_WORLD_H - TR_START_Y + 40);
      ctx.fillStyle = "#fff"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("▲ 出撃地点（ここから上へ進む） ▲", TR_WORLD_W / 2, TR_START_Y + 40);
      // 最後のウェーブの予告（敵の拠点は、最後のウェーブになってから現れる）
      if (!st.defenders.some(e => e.kind === "base")) {
        ctx.fillStyle = "rgba(229,72,77,0.25)"; ctx.fillRect(0, 0, TR_WORLD_W, 60);
        ctx.fillStyle = "#fff"; ctx.fillText("▲ この先に敵の拠点（最後のウェーブで現れる） ▲", TR_WORLD_W / 2, 30);
      }
      
      // 防衛側
      st.defenders.forEach(e => {
        const ringColor = e.elements.length > 0 ? tdElementColor(e.elements[0]) : "#ffffff";
        if (e.kind === "base") {
          const g = ctx.createLinearGradient(0, e.y - e.h / 2, 0, e.y + e.h / 2);
          g.addColorStop(0, "#5a2a3a"); g.addColorStop(1, "#2a1220");
          ctx.fillStyle = g; ctx.fillRect(e.x - e.w / 2, e.y - e.h / 2, e.w, e.h);
          ctx.lineWidth = 4; ctx.strokeStyle = "#ff3b3b"; ctx.strokeRect(e.x - e.w / 2, e.y - e.h / 2, e.w, e.h);
          ctx.fillStyle = "#fff"; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(`敵の拠点　HP ${Math.max(0, Math.round(e.hp))}/${e.maxHp}`, e.x, e.y - 10);
          drawBar(e.x - 150, e.y + 8, 300, e.hp / e.maxHp, "#e5484d");
          return;
        }
        if (e.kind === "tower") {
          ctx.fillStyle = "#1b222c"; ctx.fillRect(e.x - 16, e.y - 16, 32, 32);
          ctx.lineWidth = 3; ctx.strokeStyle = ringColor; ctx.strokeRect(e.x - 16, e.y - 16, 32, 32);
          ctx.fillStyle = "#fff"; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText("塔", e.x, e.y + 1);
          drawBar(e.x - 17, e.y - 28, 34, e.hp / e.maxHp, "#e5484d");
          return;
        }
        const size = e.isBoss ? 54 : 34;
        const entry = tdGetImage(e.imagePath || `img/敵/${e.name}.png`);
        if (entry.ok) ctx.drawImage(entry.img, e.x - size / 2, e.y - size / 2, size, size);
        else {
          ctx.beginPath(); ctx.arc(e.x, e.y, size / 2 - 2, 0, Math.PI * 2); ctx.fillStyle = "#5b6b7a"; ctx.fill();
          ctx.fillStyle = "#fff"; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(String(e.name).charAt(0), e.x, e.y + 1);
        }
        ctx.beginPath(); ctx.arc(e.x, e.y, size / 2, 0, Math.PI * 2);
        ctx.strokeStyle = e.isBoss ? "#ff3b3b" : ringColor; ctx.lineWidth = e.isBoss ? 4 : 2.5; ctx.stroke();
        if (e.isBoss) {
          ctx.fillStyle = "#ff3b3b"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.lineWidth = 3; ctx.strokeStyle = "#000"; ctx.strokeText("BOSS " + e.name, e.x, e.y - size / 2 - 16); ctx.fillText("BOSS " + e.name, e.x, e.y - size / 2 - 16);
        }
        const marks = [];
        if (e.stunUntil > st.time) marks.push("止");
        if (e.dot) marks.push("継");
        if (e.defDownUntil > st.time) marks.push("弱");
        if (e.atkDownUntil > st.time) marks.push("攻↓");
        if (marks.length > 0) {
          ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.lineWidth = 3; ctx.strokeStyle = "#000"; ctx.strokeText(marks.join(" "), e.x, e.y + size / 2 + 12);
          ctx.fillStyle = "#ffd23f"; ctx.fillText(marks.join(" "), e.x, e.y + size / 2 + 12);
        }
        drawBar(e.x - size / 2, e.y - size / 2 - 11, size, e.hp / e.maxHp, "#e5484d");
      });
      
      // 味方
      st.party.forEach(u => {
        const x = u.x, y = u.y;
        const color = tdElementColor(u.element);
        ctx.globalAlpha = u.alive ? 1 : 0.3;
        ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke();
        const img = u.imagePath ? tdGetImage(u.imagePath) : null;
        if (img && img.ok) {
          ctx.save(); ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.clip();
          ctx.drawImage(img.img, x - 14, y - 14, 28, 28); ctx.restore();
        } else {
          ctx.fillStyle = "#111"; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(String(u.name).charAt(0), x, y + 1);
        }
        if (u.alive) drawBar(x - 14, y - 27, 28, u.hp / u.maxHp, "#59e07a");
        ctx.globalAlpha = 1;
      });
      
      // 演出
      st.fx.forEach(f => {
        ctx.globalAlpha = Math.min(1, f.t / 0.1);
        ctx.strokeStyle = f.color; ctx.lineWidth = 3;
        if (f.kind === "line") { ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke(); }
        else { ctx.beginPath(); ctx.arc(f.x1, f.y1, f.r, 0, Math.PI * 2); ctx.stroke(); }
        ctx.globalAlpha = 1;
      });
      st.popups.forEach(p => {
        const rise = (1 - Math.min(1, p.t / 0.8)) * 14;
        ctx.globalAlpha = Math.min(1, p.t / 0.3);
        ctx.font = p.weak ? "bold 16px sans-serif" : "bold 13px sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.lineWidth = 3; ctx.strokeStyle = "#000"; ctx.strokeText(p.text, p.x, p.y - rise);
        ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, p.y - rise);
        ctx.globalAlpha = 1;
      });
      ctx.restore();
      
      // ここから画面に固定の表示
      // 右端の小さな全体図：世界の縦の長さに対して、今の窓の位置と、敵（赤）・味方（緑）の位置、出撃地点・敵の拠点を示す
      const mapX = view.w - 14, mapY = 40, mapH = view.h - 54, k = mapH / TR_WORLD_H;
      ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(mapX - 2, mapY - 2, 12, mapH + 4);
      ctx.fillStyle = "rgba(255,210,63,0.35)"; ctx.fillRect(mapX - 2, mapY + cam * k, 12, view.h * k);
      ctx.fillStyle = "#59e07a"; st.party.forEach(u => { if (u.alive) ctx.fillRect(mapX + 2, mapY + u.y * k - 1, 4, 2); });
      ctx.fillStyle = "#ff6b6b"; st.defenders.forEach(e => { ctx.fillRect(mapX + 1, mapY + e.y * k - 1, 6, 2); });
      ctx.fillStyle = "#ffd23f"; ctx.fillRect(mapX - 2, mapY + TR_BASE_Y * k, 12, 3);
      
      st.banners.forEach(b => {
        ctx.globalAlpha = Math.min(1, b.t / 0.4);
        ctx.fillStyle = "rgba(0,0,0,0.8)"; ctx.fillRect(0, view.h / 2 - 28, view.w, 56);
        ctx.fillStyle = "#ffd23f"; ctx.fillRect(0, view.h / 2 - 28, view.w, 4); ctx.fillRect(0, view.h / 2 + 24, view.w, 4);
        ctx.fillStyle = "#fff"; ctx.font = "bold 26px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(b.text, view.w / 2, view.h / 2 + 1);
        ctx.globalAlpha = 1;
      });
      if (st.phase === "prep") {
        ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, view.w, 34);
        ctx.fillStyle = "#ffd23f"; ctx.font = "bold 16px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(`WAVE ${Math.min(st.currentWave, TR_WAVES)} の準備中：手札から出撃・レベルアップして「進軍開始」` + (st.currentWave >= TR_WAVES ? "（最後のウェーブ！）" : ""), view.w / 2, 17);
      } else if (st.hold && st.phase === "play") {
        ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, view.w, 30);
        ctx.fillStyle = "#ffd23f"; ctx.font = "bold 15px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("停止中：「進軍する」で再開", view.w / 2, 15);
      }
    }
    
    function frame(ts) {
      if (finished) return;
      if (lastTs === null) lastTs = ts;
      const realDt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;
      const prevPhase = st.phase;
      trStep(st, realDt * st.speed);
      cam += (trCameraTarget(st, view) - cam) * Math.min(1, realDt * TD_CAMERA_SPEED);   // カメラ：目標の位置へ、なめらかに近づく
      uiAccum += realDt;
      if (st.phase !== prevPhase || uiAccum > 0.15) { uiAccum = 0; refreshUI(); }
      draw();
      if (st.phase === "won" || st.phase === "lost") {
        setTimeout(() => finish(st.phase === "won" ? "win" : "lose"), 800);
        return;                                   // ループはここで止める（画面は最後の状態のまま）
      }
      rafId = requestAnimationFrame(frame);
    }
    function finish(result) {
      if (finished) return;
      finished = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (quitTimer) clearTimeout(quitTimer);
      overlay.remove();
      resolve({ result, kills: st.kills, bossKills: st.bossKills, stage: st.stage, wavesTotal: TR_WAVES, killKeys: st.killKeys });
    }
    refreshUI();
    draw();
    rafId = requestAnimationFrame(frame);
  });
}

// ===== 施設メニューからの流れ =====
// 出撃モードを1ステージ遊ぶ。クリアしたら報酬を渡し、次のステージ（敵が強くなる）へ進むか選べる
async function startTowerRaid(stage) {
  hideLocationMenu();
  changeSpeaker("");
  if (tdGetEnemyPool().length === 0) {
    await displayMessage("……攻め込む先の魔物の情報が見当たらない。");
    showTowerDefenseModeMenu();
    return;
  }
  const roster = trGetRosterDefs();
  let party = roster;
  if (roster.length > TR_PARTY_MAX) {
    party = await trSelectParty(roster);
    if (!party) { showTowerDefenseModeMenu(); return; }
  }
  const g = tdGuildState();
  const outcome = await runTowerRaidBattle(party, { stage, upgrades: Object.assign({}, g.upgrades) });   // party＝手札になるキャラ（最大8枚）
  changeSpeaker("");
  if (outcome.result === "win") {
    // ★報酬（陳・協会ポイント・ガチャ石・アイテム）は tower_rewards.js の共通の仕組みで計算して渡す
    const rewards = tdComputeClearRewards("raid", outcome);
    tdGrantClearRewards(rewards);
    const lines = tdDescribeRewards(rewards);
    await displayMessage(`出撃成功！　${outcome.kills}体を討ち倒し、報酬として${lines[0]}を受け取った。`);
    if (lines[1]) await displayMessage(lines[1]);
    showLocationMenu([
      { label: `次のステージへ進む（STAGE ${stage + 1}・敵が強くなる）`, action: () => startTowerRaid(stage + 1) },
      { label: "協会に戻る", action: () => showTowerDefenseModeMenu() }
    ], `STAGE ${stage} クリア`);
    return;
  } else if (outcome.result === "lose") {
    await displayMessage("出撃したメンバーが全滅してしまった……。今回は報酬なしだ。");
  }
  showTowerDefenseModeMenu();
}
