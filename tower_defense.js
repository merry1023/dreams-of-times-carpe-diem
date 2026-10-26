// tower_defense.js
// ===================================================================
// ===== 冒険者協会「掃討作戦」迎撃モード（タワーディフェンス・最小版） =====
// ===================================================================
// ★施設編集タブで作れる「冒険者協会」タイプの施設（facility.type === "towerDefense"）の中身。
//   openCustomFacility（town.js）から openTowerDefenseFacility() が呼ばれる。
// ★現状：一本道・固定マス・属性ごとに1ユニット・属性相性・属性コンボ・ユニットごとの攻撃対象・
//   ウェーブ数の選択・中ボス・クリア後に次のステージへ進む周回・事前強化（協会ポイント）。
//   （出撃モード／ユニットのエディタ登録／素材・レア報酬は、企画書の順に後から足す）
// ★ファイルの作り：
//   ・上半分＝ゲームの中身（状態の作成・1コマ進める処理）。画面に触れない作りなので単体で動作確認できる
//   ・下半分＝画面（オーバーレイ・描画・操作）と、施設のメニュー・報酬の受け渡し

let towerDefenseFacility = null;   // 今開いている冒険者協会のデータ（scenariobuild.jsのfacility）
let towerDefenseReturnTo = null;   // 「戻る」で呼ぶ関数

// ----- 調整用の数値（ここを書き換えるだけでバランスを変えられる） -----
const TD_WAVE_OPTIONS = [3, 5, 10, 15]; // 選べるウェーブ数（3はお試し用）
const TD_FIELD_W = 720;             // フィールドの広さ（内部座標）
const TD_FIELD_H = 400;
const TD_START_FUNDS = 160;         // 開始時の資金
const TD_WAVE_CLEAR_BONUS = 40;     // ウェーブをしのぐごとにもらえる資金
const TD_UNIT_MAX_LEVEL = 8;        // プレイ中のユニット強化の上限レベル
const TD_LEVEL_ATK_RATE = 0.2;      // レベルが1上がるごとに攻撃力＋20%
const TD_UPGRADE_COST_RATE = 0.7;   // 強化費用＝購入価格×この値×現在のレベル（レベルが上がるほど高くなる）
const TD_SPAWN_INTERVAL = 1.3;      // 敵が出てくる間隔（秒）
const TD_ENEMY_SPEED = 70;          // 敵の移動速度（内部座標/秒）
const TD_WAVE_HP_GROWTH = 0.40;     // ウェーブが進むごとの敵HPの増加率
const TD_BASE_HP_PER_ATK = 15;      // 拠点HP＝出てくる敵の平均攻撃力×この値（最低50）
const TD_CLEAR_GOLD_BASE = 100;     // クリア報酬（陳）の基本額
const TD_CLEAR_GOLD_PER_KILL = 5;   // 倒した数ごとの上乗せ
// ----- 中ボス・周回（次のステージ）・協会ポイント・事前強化 -----
const TD_BOSS_EVERY = 5;            // 何ウェーブごとに中ボスが出るか（そのウェーブの最後に1体）
const TD_BOSS_HP_RATE = 2.5;        // 中ボスのHP＝本編のHP×この値（さらにウェーブ・ステージで増える）
const TD_BOSS_SPEED_RATE = 0.6;     // 中ボスの移動の遅さ
const TD_BOSS_ATK_RATE = 2;         // 中ボスがゴールした時の拠点ダメージ倍率
const TD_STAGE_HP_GROWTH = 0.35;    // 次のステージへ進むごとの敵HPの増加率
const TD_STAGE_ATK_GROWTH = 0.15;   // 同・拠点ダメージの増加率
const TD_STAGE_REWARD_GROWTH = 0.25; // 同・クリア報酬の増加率
const TD_POINTS_PER_WAVE = 1;       // クリア時にもらえる協会ポイント（ウェーブ数×この値＋倒した中ボス×下の値）
const TD_POINTS_PER_BOSS = 3;
const TD_UPGRADE_MAX = 10;          // 事前強化の上限レベル
const TD_UPGRADE_POINT_BASE = 10;   // 事前強化の費用＝この値×（現在のレベル＋1）ポイント
const TD_UPG_HP_RATE = 0.10;        // 拠点HP：1レベルごとに＋10%
const TD_UPG_FUNDS = 25;            // 開始時の資金：1レベルごとに＋25
const TD_UPG_INCOME = 0.05;         // 資金の稼ぎやすさ：1レベルごとに、敵を倒した時の資金＋5%
// ----- コンボ（本編のコンボスキル定義をそのまま使う） -----
const TD_COMBO_HISTORY_MAX = 8;     // 属性の履歴の上限（本編と同じ。発動した時だけリセット）
const TD_COMBO_LOCK = 2.0;          // コンボ発動後、履歴を取らない秒数（連発しすぎないようにする）
const TD_COMBO_BASE = 0.12;         // コンボ1発のダメージ＝敵の平均HP×（この値＋威力×下の値）
const TD_COMBO_POWER_RATE = 0.01;
// ----- 状態異常（コンボに付くもの。本編の「1ターン」を、こちらでは下の秒数に置き換える） -----
const TD_STATUS_SEC_PER_TURN = 1.0;
const TD_DOT_RATE = 0.04;           // 毒・火傷などの1秒あたりのダメージ＝敵の平均HP×威力×この値
const TD_DEFDOWN_RATE = 1.3;        // 防御力低下中の敵が受けるダメージ倍率
const TD_ATKDOWN_RATE = 0.6;        // 攻撃力低下中の敵がゴールした時に減らす拠点HPの倍率

// 敵の通り道（左端から入って、右端がゴール＝拠点）
const TD_PATH = [[-30, 80], [620, 80], [620, 200], [100, 200], [100, 320], [750, 320]];
// ユニットを置ける固定マス（道の横）
const TD_SLOTS = [[200, 140], [420, 140], [680, 140], [40, 260], [250, 260], [470, 260], [360, 30], [560, 370]];
const TD_SLOT_RADIUS = 24;

// ----- 道の長さ・位置の計算 -----
const TD_PATH_INFO = (() => {
  const segs = [];
  let acc = 0;
  for (let i = 0; i < TD_PATH.length - 1; i++) {
    const [x1, y1] = TD_PATH[i];
    const [x2, y2] = TD_PATH[i + 1];
    const l = Math.hypot(x2 - x1, y2 - y1);
    segs.push({ x1, y1, x2, y2, l, start: acc });
    acc += l;
  }
  return { segs, total: acc };
})();

// 道の先頭からの距離 d にいる時の座標
function tdPathPosition(d) {
  const info = TD_PATH_INFO;
  if (d <= 0) return { x: info.segs[0].x1, y: info.segs[0].y1 };
  for (const seg of info.segs) {
    if (d <= seg.start + seg.l) {
      const t = (d - seg.start) / seg.l;
      return { x: seg.x1 + (seg.x2 - seg.x1) * t, y: seg.y1 + (seg.y2 - seg.y1) * t };
    }
  }
  const last = info.segs[info.segs.length - 1];
  return { x: last.x2, y: last.y2 };
}

// ===== 属性相性 =====
// ★本編（battle.js）と同じルール：特攻＝1.5倍、耐性＝0.5倍。敵の属性は複数持てるので、それぞれ掛け合わせる。
//   属性相性を無視する敵（ignoreElementalAffinity）や、属性なしの攻撃は等倍
function tdElementMultiplier(attackElementId, enemy) {
  if (!attackElementId || attackElementId === "無") return 1;
  if (!enemy || enemy.ignoreAffinity) return 1;
  const defs = Array.isArray(enemy.elements) ? enemy.elements : [];
  if (defs.length === 0) return 1;
  const matchups = (typeof scenarioProject !== "undefined" && scenarioProject && scenarioProject.elementMatchups) ? scenarioProject.elementMatchups : {};
  let multiplier = 1;
  defs.forEach(defId => {
    const relation = matchups[attackElementId + ">" + defId];
    if (relation === "advantage") multiplier *= 1.5;
    else if (relation === "resist") multiplier *= 0.5;
  });
  return multiplier;
}

// ===== ユニットの種類 =====
// ★属性管理にある属性ごとに1ユニットを自動で作る（属性が増えたら自動で反映される）。役割は下の4種類を順番に割り当てる。
//   狙い方（targeting）：near＝射程内でユニットから一番近い敵／far＝射程内で一番遠い敵／all＝射程内の全ての敵
//   与ダメージは「出てくる敵の平均HP」に対する割合で決めるので、敵のデータが変わってもバランスが崩れにくい
const TD_TARGETING_LABELS = { near: "近い敵", far: "遠い敵", all: "全体", none: "味方を強化" };
const TD_SUPPORT_BONUS_MAX = 1.5;   // サポートによる攻撃力アップの合計の上限（＋150%）
const TD_ROLE_ARCHETYPES = [
  { name: "弓兵",   role: "single", roleLabel: "単体", roleChar: "単", targeting: "near", dmgRatio: 0.22, range: 140, interval: 0.8, cost: 50 },
  { name: "術師",   role: "area",   roleLabel: "範囲", roleChar: "範", targeting: "all",  dmgRatio: 0.09, range: 115, interval: 1.4, cost: 80 },
  { name: "妨害師", role: "slow",   roleLabel: "遅延", roleChar: "遅", targeting: "far",  dmgRatio: 0.07, range: 120, interval: 1.0, cost: 70, slowRate: 0.5, slowSec: 1.5 },
  { name: "砲手",   role: "single", roleLabel: "単体", roleChar: "砲", targeting: "far",  dmgRatio: 0.6,  range: 190, interval: 2.4, cost: 120 }
];
// 属性ごとに1ユニットを自動で作る（エディタで何も登録していない時に使う）
function tdAutoUnitTemplates() {
  const defs = (typeof scenarioProject !== "undefined" && scenarioProject && Array.isArray(scenarioProject.elementDefs) && scenarioProject.elementDefs.length > 0)
    ? scenarioProject.elementDefs
    : [{ id: "無", name: "無" }];
  return defs.slice(0, 12).map((def, i) => {
    const arch = TD_ROLE_ARCHETYPES[i % TD_ROLE_ARCHETYPES.length];
    return Object.assign({}, arch, { key: "u" + i, label: `${def.name}の${arch.name}`, element: def.id });
  });
}

// エディタ「タワーユニット」タブで登録されたユニット（有効なものだけ）
const TD_ROLE_INFO = {
  single:  { roleLabel: "単体",     roleChar: "単" },
  area:    { roleLabel: "範囲",     roleChar: "範" },
  slow:    { roleLabel: "遅延",     roleChar: "遅" },
  support: { roleLabel: "サポート", roleChar: "援" }
};
function tdClamp(v, min, max, fallback) {
  const n = Number(v);
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : fallback));
}
function tdCustomUnitTemplates() {
  const list = (typeof scenarioProject !== "undefined" && scenarioProject && Array.isArray(scenarioProject.towerUnits)) ? scenarioProject.towerUnits : [];
  return list.filter(u => u && u.enabled !== false).slice(0, 24).map((u, i) => {
    const role = TD_ROLE_INFO[u.role] ? u.role : "single";
    const targeting = role === "support" ? "none" : (role === "area" ? "all" : (TD_TARGETING_LABELS[u.targeting] && u.targeting !== "none" ? u.targeting : "near")); // 範囲は常に「射程内の全て」
    return {
      key: "c" + i, label: u.name || "名無しのユニット", element: u.element || "無",
      role, roleLabel: TD_ROLE_INFO[role].roleLabel, roleChar: TD_ROLE_INFO[role].roleChar, targeting,
      dmgRatio: tdClamp(u.power, 1, 500, 20) / 100,
      range: tdClamp(u.range, 20, 400, 140), interval: tdClamp(u.interval, 0.2, 10, 1),
      cost: Math.round(tdClamp(u.cost, 1, 99999, 50)),
      slowRate: 1 - tdClamp(u.slowPercent, 1, 95, 50) / 100, slowSec: tdClamp(u.slowSec, 0.2, 10, 1.5),
      supportRate: tdClamp(u.supportPercent, 1, 300, 25) / 100,
      imagePath: u.imagePath || ""
    };
  });
}

function tdBuildUnitTemplates() {
  const custom = tdCustomUnitTemplates();
  return custom.length > 0 ? custom : tdAutoUnitTemplates();
}

// エディタの「標準のユニットを登録する」ボタン用：自動生成と同じ内容を、編集できる形で返す（サポートの見本を1つ足す）
function tdBuildDefaultUnitData() {
  const idOf = i => (typeof generateId === "function") ? generateId("towerunit") : "towerunit_" + i;
  const list = tdAutoUnitTemplates().map((t, i) => ({
    id: idOf(i), name: t.label, enabled: true, element: t.element, role: t.role, targeting: t.targeting,
    power: Math.round(t.dmgRatio * 100), range: t.range, interval: t.interval, cost: t.cost,
    slowPercent: t.slowRate != null ? Math.round((1 - t.slowRate) * 100) : 50, slowSec: t.slowSec || 1.5,
    supportPercent: 25, imagePath: ""
  }));
  const firstElement = list.length > 0 ? list[0].element : "無";
  list.push({ id: idOf(list.length), name: "支援兵", enabled: true, element: firstElement, role: "support", targeting: "near",
    power: 0, range: 130, interval: 1, cost: 90, slowPercent: 50, slowSec: 1.5, supportPercent: 25, imagePath: "" });
  return list;
}

// ===== コンボ =====
// ★本編（battle.js）のコンボスキル定義をそのまま使う。ユニットが攻撃するたびに、そのユニットの属性が履歴に積まれ、
//   履歴の末尾が手順と一致するとコンボが発動する（同じ敵に当てなくてもよい）。本編と同じく、解禁済みのコンボだけが対象
function tdGetUsableCombos() {
  const list = (typeof scenarioProject !== "undefined" && scenarioProject && Array.isArray(scenarioProject.comboSkills)) ? scenarioProject.comboSkills : [];
  return list.filter(c => {
    if (!c || c.enabled === false) return false;
    if ((c.elements || []).filter(Boolean).length < 2) return false;
    if (typeof isComboSkillUnlocked === "function") return isComboSkillUnlocked(c);
    return true;
  });
}

function tdFindCombo(st) {
  let best = null;
  st.combos.forEach(combo => {
    const seq = (combo.elements || []).filter(Boolean);
    if (seq.length > st.history.length) return;
    const tail = st.history.slice(st.history.length - seq.length);
    if (!seq.every((el, i) => el === tail[i])) return;
    if (!best || seq.length > best.len) best = { combo, len: seq.length }; // 複数一致したら、長い手順のコンボを優先
  });
  return best ? best.combo : null;
}

// ===== 出てくる敵 =====
// ★本編の魔物（MONSTER_MASTER）をそのまま使う。ボスは除き、体力の低い順に数種類だけ使う（最小版）
function tdGetEnemyPool() {
  if (typeof MONSTER_MASTER === "undefined") return [];
  const bossIds = new Set();
  if (typeof BOSS_MASTER !== "undefined") Object.keys(BOSS_MASTER).forEach(k => bossIds.add(k));
  if (typeof scenarioProject !== "undefined" && scenarioProject && Array.isArray(scenarioProject.bosses)) scenarioProject.bosses.forEach(b => bossIds.add(b.id));
  const keys = Object.keys(MONSTER_MASTER).filter(k => {
    const m = MONSTER_MASTER[k];
    return m && Number(m.maxHp) > 0 && !bossIds.has(k) && k !== "trial_guardian";
  });
  keys.sort((a, b) => Number(MONSTER_MASTER[a].maxHp) - Number(MONSTER_MASTER[b].maxHp));
  return keys.slice(0, 5);
}

// ★中ボスは本編のボスから選ぶ。物語用の桁違いに強いボス（HPや攻撃力が敵の平均より極端に高いもの）は除き、体力の低い順に使う
function tdGetBossPool(refHp, refAtk) {
  if (typeof MONSTER_MASTER === "undefined") return [];
  const ids = new Set();
  if (typeof BOSS_MASTER !== "undefined") Object.keys(BOSS_MASTER).forEach(k => ids.add(k));
  if (typeof scenarioProject !== "undefined" && scenarioProject && Array.isArray(scenarioProject.bosses)) scenarioProject.bosses.forEach(b => ids.add(b.id));
  const keys = [...ids].filter(k => {
    const m = MONSTER_MASTER[k];
    return m && Number(m.maxHp) > 0 && Number(m.maxHp) <= refHp * 10 && (Number(m.atk) || 1) <= refAtk * 5;
  });
  keys.sort((a, b) => Number(MONSTER_MASTER[a].maxHp) - Number(MONSTER_MASTER[b].maxHp));
  return keys;
}

// ===== 協会ポイントと事前強化 =====
// ★セーブデータは player をそのまま保存する作りなので、player に持たせれば自動でセーブされる
const TD_UPGRADE_DEFS = [
  { key: "baseHp", label: "拠点HP",       describe: lv => `最大HP +${Math.round(lv * TD_UPG_HP_RATE * 100)}%` },
  { key: "funds",  label: "開始時の資金", describe: lv => `開始資金 +${lv * TD_UPG_FUNDS}` },
  { key: "income", label: "資金の稼ぎやすさ", describe: lv => `敵を倒した時の資金 +${Math.round(lv * TD_UPG_INCOME * 100)}%` }
];
function tdGuildState() {
  if (typeof player === "undefined" || !player) return { points: 0, upgrades: { baseHp: 0, funds: 0, income: 0 } };
  if (!player.adventurerGuild || typeof player.adventurerGuild !== "object") player.adventurerGuild = {};
  const g = player.adventurerGuild;
  if (!Number.isFinite(g.points)) g.points = 0;
  if (!g.upgrades || typeof g.upgrades !== "object") g.upgrades = {};
  TD_UPGRADE_DEFS.forEach(d => { if (!Number.isFinite(g.upgrades[d.key])) g.upgrades[d.key] = 0; });
  return g;
}
function tdUpgradeCostPoints(level) { return TD_UPGRADE_POINT_BASE * (level + 1); }
// ポイントで事前強化を1段階上げる。結果は { ok, reason }
function tdBuyGuildUpgrade(key) {
  const g = tdGuildState();
  const def = TD_UPGRADE_DEFS.find(d => d.key === key);
  if (!def) return { ok: false, reason: "その強化は存在しない" };
  const lv = g.upgrades[key];
  if (lv >= TD_UPGRADE_MAX) return { ok: false, reason: "これ以上強化できない" };
  const cost = tdUpgradeCostPoints(lv);
  if (g.points < cost) return { ok: false, reason: "協会ポイントが足りない" };
  g.points -= cost;
  g.upgrades[key] = lv + 1;
  return { ok: true };
}

// ===== ゲームの状態 =====
function tdCreateState(pool, opts) {
  opts = opts || {};
  const up = opts.upgrades || {};
  const masters = pool.map(k => MONSTER_MASTER[k]);
  const avg = f => masters.reduce((s, m) => s + (Number(f(m)) || 0), 0) / Math.max(1, masters.length);
  const refHp = Math.max(1, avg(m => m.maxHp));
  const refAtk = Math.max(1, avg(m => m.atk));
  const baseMaxHp = Math.round(Math.max(50, Math.round(refAtk * TD_BASE_HP_PER_ATK)) * (1 + TD_UPG_HP_RATE * (up.baseHp || 0)));
  return {
    pool, refHp,
    bossPool: tdGetBossPool(refHp, refAtk),
    stage: Math.max(1, Number(opts.stage) || 1),
    incomeRate: 1 + TD_UPG_INCOME * (up.income || 0),   // 敵を倒した時にもらえる資金の倍率（事前強化）
    bossKills: 0,
    templates: tdBuildUnitTemplates(),
    phase: "prep",            // prep＝準備中／wave＝ウェーブ進行中／won／lost
    wave: 1, wavesTotal: Math.max(1, Number(opts.wavesTotal) || TD_WAVE_OPTIONS[0]),
    funds: TD_START_FUNDS + TD_UPG_FUNDS * (up.funds || 0),
    baseMaxHp, baseHp: baseMaxHp,
    kills: 0, time: 0, speed: 1,
    units: [],                // { slot, tpl, level, cool }
    enemies: [],
    spawnQueue: [], spawnTimer: 0,
    fx: [], popups: [],       // 画面に出す演出（撃った線・ダメージ数字）
    combos: tdGetUsableCombos(),   // 今回使えるコンボ（本編で解禁済みのもの）
    history: [],                   // 攻撃した属性の履歴（コンボを発動した時だけリセット）
    comboLockUntil: 0, comboCount: 0,
    banners: []                    // コンボ発動の帯（{ text, t }）
  };
}

function tdSlotPos(slotIndex) { return { x: TD_SLOTS[slotIndex][0], y: TD_SLOTS[slotIndex][1] }; }

// サポートの効果：射程の中にいるサポートの強化率を足し合わせる（上限あり）
function tdSupportBonus(st, unit) {
  if (unit.tpl.role === "support") return 0;
  const sp = tdSlotPos(unit.slot);
  let bonus = 0;
  st.units.forEach(other => {
    if (other === unit || other.tpl.role !== "support") return;
    const op = tdSlotPos(other.slot);
    if (Math.hypot(op.x - sp.x, op.y - sp.y) <= other.tpl.range) bonus += other.tpl.supportRate * (1 + TD_LEVEL_ATK_RATE * (other.level - 1));
  });
  return Math.min(TD_SUPPORT_BONUS_MAX, bonus);
}

function tdUnitDamage(st, unit) {
  return unit.tpl.dmgRatio * st.refHp * (1 + TD_LEVEL_ATK_RATE * (unit.level - 1)) * (1 + tdSupportBonus(st, unit));
}

function tdUpgradeCost(unit) {
  return Math.round(unit.tpl.cost * TD_UPGRADE_COST_RATE * unit.level);
}

// ウェーブを始める（そのウェーブに出る敵を並べる）
function tdStartWave(st) {
  if (st.phase !== "prep") return false;
  const usable = st.pool.slice(0, Math.min(st.pool.length, 2 + st.wave + (st.stage - 1)));
  const count = Math.min(30, 8 + 3 * (st.wave - 1));
  st.spawnQueue = [];
  for (let i = 0; i < count; i++) st.spawnQueue.push(usable[Math.floor(Math.random() * usable.length)]);
  // ★中ボス：TD_BOSS_EVERYウェーブごとに、最後に1体出てくる（本編のボスを、弱い順に使っていく）
  if (tdIsBossWave(st, st.wave) && st.bossPool.length > 0) {
    const idx = Math.min(st.bossPool.length - 1, Math.floor(st.wave / TD_BOSS_EVERY) - 1 + (st.stage - 1));
    st.spawnQueue.push({ key: st.bossPool[Math.max(0, idx)], boss: true });
  }
  st.spawnTimer = 0;
  st.phase = "wave";
  return true;
}

function tdIsBossWave(st, wave) { return wave % TD_BOSS_EVERY === 0; }

function tdPlaceUnit(st, slotIndex, templateKey) {
  if (st.units.some(u => u.slot === slotIndex)) return { ok: false, reason: "そこにはもう置いてある" };
  const tpl = st.templates.find(t => t.key === templateKey);
  if (!tpl) return { ok: false, reason: "ユニットが選ばれていない" };
  if (st.funds < tpl.cost) return { ok: false, reason: "資金が足りない" };
  st.funds -= tpl.cost;
  st.units.push({ slot: slotIndex, tpl, level: 1, cool: 0 });
  return { ok: true };
}

function tdUpgradeUnit(st, unit) {
  if (unit.level >= TD_UNIT_MAX_LEVEL) return { ok: false, reason: "これ以上強化できない" };
  const cost = tdUpgradeCost(unit);
  if (st.funds < cost) return { ok: false, reason: "資金が足りない" };
  st.funds -= cost;
  unit.level++;
  return { ok: true };
}

function tdSpawnEnemy(st, entry) {
  const isBoss = typeof entry === "object" && entry.boss === true;
  const key = isBoss ? entry.key : entry;
  const m = MONSTER_MASTER[key];
  const growth = (1 + TD_WAVE_HP_GROWTH * (st.wave - 1)) * (1 + TD_STAGE_HP_GROWTH * (st.stage - 1));
  const hp = Math.max(1, Math.round((Number(m.maxHp) || 10) * growth * (isBoss ? TD_BOSS_HP_RATE : 1)));
  const atk = Math.max(1, Math.round((Number(m.atk) || 1) * (1 + TD_STAGE_ATK_GROWTH * (st.stage - 1)) * (isBoss ? TD_BOSS_ATK_RATE : 1)));
  const pos = tdPathPosition(0);
  st.enemies.push({
    key, name: m.name || key, hp, maxHp: hp, isBoss,
    atk,                                                       // ゴールした時に拠点HPが減る量（本編の攻撃力が元）
    elements: Array.isArray(m.elements) ? m.elements : [],
    ignoreAffinity: !!m.ignoreElementalAffinity,
    imagePath: m.imagePath || null,
    speed: TD_ENEMY_SPEED * (0.9 + Math.random() * 0.2) * (isBoss ? TD_BOSS_SPEED_RATE : 1),
    dist: 0, x: pos.x, y: pos.y,
    slowUntil: 0, slowRate: 1,
    stunUntil: 0, dot: null, defDownUntil: 0, atkDownUntil: 0,   // 状態異常（足止め・継続ダメージ・防御低下・攻撃低下）
    reward: Math.max(6, Math.round((Number(m.exp) || 10) * 0.8 * st.incomeRate)) // 倒した時にもらえる資金（事前強化で増える）
  });
}

// ===== ダメージと状態異常 =====
// 敵にダメージを与える共通処理（属性相性・防御力低下を反映し、ダメージ数字を出す）
function tdDealDamage(st, enemy, base, elementId, color) {
  let mult = tdElementMultiplier(elementId, enemy);
  const weakMult = mult;
  if (enemy.defDownUntil > st.time) mult *= TD_DEFDOWN_RATE;
  const dmg = Math.max(1, Math.round(base * mult));
  enemy.hp -= dmg;
  st.popups.push({
    x: enemy.x + (Math.random() * 14 - 7), y: enemy.y - 16, text: String(dmg),
    color: weakMult > 1 ? "#ffffff" : (weakMult < 1 ? "#9aa4ad" : (color || "#ffffff")),
    weak: weakMult > 1, resist: weakMult < 1, t: 0.6
  });
  return dmg;
}

// 状態異常の種類→仕組み（本編のカスタム状態異常も、登録された仕組みで動く）
function tdStatusMechanic(kind) {
  if (!kind) return null;
  if (typeof resolveStatusAilmentDef === "function") {
    const def = resolveStatusAilmentDef(kind);
    if (def && def.mechanic) return def.mechanic;
  }
  return kind;
}

// コンボに付く状態異常を敵に与える。与えられたら表示用のラベルを返す
// ★本編と同じく、敵ごとの「状態異常無効／耐性」を反映する。仕組みが分かるものだけ動かす：
//   スタン・麻痺・混乱＝足止め／毒・火傷・鈍痛＝継続ダメージ／防御力低下＝受けるダメージ増／攻撃力低下＝ゴールした時の拠点ダメージ減
function tdApplyStatus(st, enemy, effect) {
  if (!effect || !effect.kind) return null;
  const mech = tdStatusMechanic(effect.kind);
  const master = (typeof MONSTER_MASTER !== "undefined") ? MONSTER_MASTER[enemy.key] : null;
  if (master && Array.isArray(master.statusImmunities) && master.statusImmunities.includes(mech)) return null;
  let chance = effect.chance != null ? Number(effect.chance) : 1;
  if (master && master.statusResistances && typeof master.statusResistances[mech] === "number") chance *= Math.max(0, 1 - master.statusResistances[mech]);
  if (Math.random() >= chance) return null;
  const secs = Math.max(1, Number(effect.duration) || 1) * TD_STATUS_SEC_PER_TURN;
  const power = Number(effect.power) || 3;
  if (mech === "stun" || mech === "paralyze" || mech === "confuse") enemy.stunUntil = Math.max(enemy.stunUntil, st.time + secs);
  else if (mech === "burn" || mech === "poison" || mech === "dullPain") enemy.dot = { until: st.time + secs, next: st.time + 1, dmg: Math.max(1, Math.round(st.refHp * power * TD_DOT_RATE)) };
  else if (mech === "defDown") enemy.defDownUntil = Math.max(enemy.defDownUntil, st.time + secs);
  else if (mech === "atkDown") enemy.atkDownUntil = Math.max(enemy.atkDownUntil, st.time + secs);
  else return null;
  let label = null;
  if (typeof resolveStatusAilmentDef === "function") { const d = resolveStatusAilmentDef(effect.kind); if (d && d.label) label = d.label; }
  if (!label && typeof STATUS_EFFECT_LABELS !== "undefined") label = STATUS_EFFECT_LABELS[effect.kind];
  return label || effect.kind;
}

// ===== 攻撃対象の選び方 =====
// ★ユニットごとの設定：near＝射程内で一番近い敵／far＝射程内で一番遠い敵／all＝射程内の全ての敵
//   「近い・遠い」は、そのユニットから見た距離（ゴールまでの距離ではない）
function tdPickTargets(st, unit, from, limitRange) {
  const mode = unit.tpl.targeting;
  const range = limitRange ? unit.tpl.range : Infinity;
  const cands = st.enemies.filter(e => e.hp > 0 && Math.hypot(e.x - from.x, e.y - from.y) <= range);
  if (cands.length === 0) return [];
  if (mode === "all" && limitRange) return cands;
  const distTo = e => Math.hypot(e.x - from.x, e.y - from.y);
  let pick = cands[0];
  cands.forEach(e => {
    if (mode === "far" ? distTo(e) > distTo(pick) : distTo(e) < distTo(pick)) pick = e;   // allのコンボ単体は「近い敵」で代用
  });
  return [pick];
}

// 1コマ進める（dt＝経過秒。倍速の時は呼ぶ側で掛けておく）
function tdStep(st, dt) {
  st.time += dt;
  // 演出の寿命
  st.fx.forEach(f => { f.t -= dt; });
  st.fx = st.fx.filter(f => f.t > 0);
  st.popups.forEach(p => { p.t -= dt; });
  st.popups = st.popups.filter(p => p.t > 0);
  st.banners.forEach(b => { b.t -= dt; });
  st.banners = st.banners.filter(b => b.t > 0);
  if (st.phase !== "wave") return;
  
  // 敵の出現
  if (st.spawnQueue.length > 0) {
    st.spawnTimer -= dt;
    if (st.spawnTimer <= 0) {
      tdSpawnEnemy(st, st.spawnQueue.shift());
      st.spawnTimer = TD_SPAWN_INTERVAL;
    }
  }
  
  // 敵の移動（足止め中は動かない／継続ダメージ／ゴールしたら拠点HPが減る）
  st.enemies.forEach(e => {
    if (e.dot) {
      while (e.dot && st.time >= e.dot.next) {
        e.hp -= e.dot.dmg;
        st.popups.push({ x: e.x, y: e.y - 16, text: String(e.dot.dmg), color: "#ff9a3c", weak: false, t: 0.5 });
        e.dot.next += 1;
        if (e.dot.next > e.dot.until + 0.0001) e.dot = null;
      }
    }
    if (e.stunUntil > st.time) return;
    const slowed = e.slowUntil > st.time;
    e.dist += e.speed * (slowed ? e.slowRate : 1) * dt;
    if (e.dist >= TD_PATH_INFO.total) {
      e.reached = true;
      const leak = Math.max(1, Math.round(e.atk * (e.atkDownUntil > st.time ? TD_ATKDOWN_RATE : 1)));
      st.baseHp -= leak;
      st.popups.push({ x: 690, y: 300, text: `-${leak}`, color: "#ff5a5a", weak: false, t: 0.8 });
    } else {
      const pos = tdPathPosition(e.dist);
      e.x = pos.x; e.y = pos.y;
    }
  });
  st.enemies = st.enemies.filter(e => !e.reached);
  
  // ユニットの攻撃（狙い方はユニットごとの設定に従う）
  st.units.forEach(u => {
    if (u.tpl.role === "support") return;           // サポートは攻撃しない
    u.cool -= dt;
    if (u.cool > 0) return;
    const sp = tdSlotPos(u.slot);
    const targets = tdPickTargets(st, u, sp, true);
    if (targets.length === 0) { u.cool = 0; return; }
    tdFire(st, u, targets, sp);
    u.cool = u.tpl.interval;
  });
  
  // 倒した敵の処理
  const alive = [];
  st.enemies.forEach(e => {
    if (e.hp > 0) { alive.push(e); return; }
    st.funds += e.reward;
    st.kills++;
    if (e.isBoss) st.bossKills++;
    st.popups.push({ x: e.x, y: e.y - 20, text: `+${e.reward}`, color: "#ffd23f", weak: false, t: 0.8 });
  });
  st.enemies = alive;
  
  // 勝ち負けの判定
  if (st.baseHp <= 0) {
    st.baseHp = 0;
    st.phase = "lost";
    return;
  }
  if (st.spawnQueue.length === 0 && st.enemies.length === 0) {
    if (st.wave >= st.wavesTotal) {
      st.phase = "won";
    } else {
      st.funds += TD_WAVE_CLEAR_BONUS;
      st.wave++;
      st.phase = "prep";
    }
  }
}

function tdFire(st, unit, targets, from) {
  const tpl = unit.tpl;
  const base = tdUnitDamage(st, unit);
  const color = (typeof getElementColor === "function") ? getElementColor(tpl.element) : "#ffffff";
  targets.forEach(e => {
    tdDealDamage(st, e, base, tpl.element, color);
    if (tpl.role === "slow") { e.slowUntil = st.time + tpl.slowSec; e.slowRate = tpl.slowRate; }
    st.fx.push({ kind: "line", x1: from.x, y1: from.y, x2: e.x, y2: e.y, color, t: 0.12 });
  });
  if (tpl.targeting === "all") st.fx.push({ kind: "ring", x1: from.x, y1: from.y, r: tpl.range, color, t: 0.18 });
  tdRecordCombo(st, unit, from);
}

// ===== コンボ =====
// ユニットが攻撃したら、その属性を履歴に積む。履歴の末尾がコンボの手順と一致したら発動する
function tdRecordCombo(st, unit, from) {
  if (st.combos.length === 0) return;
  if (st.time < st.comboLockUntil) return;       // 発動直後は履歴を取らない
  const el = unit.tpl.element;
  if (!el) return;
  st.history.push(el);
  if (st.history.length > TD_COMBO_HISTORY_MAX) st.history.shift();
  const combo = tdFindCombo(st);
  if (!combo) return;
  st.history = [];                                // ★発動した時だけ、履歴を空に戻す
  st.comboLockUntil = st.time + TD_COMBO_LOCK;
  tdExecuteCombo(st, combo, unit, from);
}

// コンボの効果を出す（ダメージ・状態異常・回復）。本編のコンボ定義（威力・全体/単体・連続回数・状態異常）をそのまま使う
// ★ブロック式のコンボも、基本項目（威力・対象・連続回数・状態異常）の部分だけで動かす／自己強化は使わない（タワーには自分がいないため）
function tdExecuteCombo(st, combo, unit, from) {
  const name = combo.name || "名無しのコンボ";
  const element = combo.element || "無";
  const color = (typeof getElementColor === "function") ? getElementColor(element) : "#ffffff";
  st.comboCount++;
  st.banners.push({ text: combo.cutInText || name, t: 1.4 });
  if ((combo.type || "attack") === "heal") {
    if (typeof st.onComboHeal === "function") { st.onComboHeal(); return; }   // 出撃モード（tower_raid.js）：味方を回復する
    const healed = Math.round(st.baseMaxHp * 0.1);
    st.baseHp = Math.min(st.baseMaxHp, st.baseHp + healed);
    st.popups.push({ x: 690, y: 300, text: `+${healed}`, color: "#59e07a", weak: false, t: 0.9 });
    return;
  }
  const power = Number(combo.power) || 0;
  const hitCount = Math.max(1, Number(combo.hitCount) || 1);
  const base = st.refHp * (TD_COMBO_BASE + power * TD_COMBO_POWER_RATE);
  const targets = combo.target === "all"
    ? st.enemies.filter(e => e.hp > 0)
    : tdPickTargets(st, unit, from, false);       // 単体：コンボを完成させたユニットの狙い方に従う（射程は問わない）
  targets.forEach(e => {
    for (let h = 0; h < hitCount; h++) {
      if (e.hp <= 0) break;
      tdDealDamage(st, e, base, element, color);
    }
    [
      { kind: combo.statusEffectKind, chance: combo.statusEffectChance, duration: combo.statusEffectDuration, power: combo.statusEffectPower },
      { kind: combo.statusEffect2Kind, chance: combo.statusEffect2Chance, duration: combo.statusEffect2Duration, power: combo.statusEffect2Power }
    ].forEach(effect => {
      if (e.hp <= 0) return;
      const label = tdApplyStatus(st, e, effect);
      if (label) st.popups.push({ x: e.x, y: e.y - 30, text: label, color: "#ffd23f", weak: false, t: 0.9 });
    });
    st.fx.push({ kind: "line", x1: from.x, y1: from.y, x2: e.x, y2: e.y, color, t: 0.3 });
    st.fx.push({ kind: "ring", x1: e.x, y1: e.y, r: 26, color, t: 0.3 });
  });
}

// ===================================================================
// ===== ここから下は画面（オーバーレイ・描画・操作）と施設のメニュー =====
// ===================================================================

const tdImageCache = {};
function tdGetImage(src) {
  if (!tdImageCache[src]) {
    const entry = { img: new Image(), ok: false };
    entry.img.onload = () => { entry.ok = true; };
    entry.img.onerror = () => { entry.ok = false; };
    entry.img.src = src;
    tdImageCache[src] = entry;
  }
  return tdImageCache[src];
}

// ユニットの役割・狙い・効果を1行で表す（ボタンや案内に使う）
function tdUnitSummary(tpl) {
  if (tpl.role === "support") return `サポート・攻撃+${Math.round(tpl.supportRate * 100)}%`;
  return `${tpl.roleLabel}・${TD_TARGETING_LABELS[tpl.targeting]}`;
}

function tdElementName(elementId) {
  const defs = (typeof scenarioProject !== "undefined" && scenarioProject && Array.isArray(scenarioProject.elementDefs)) ? scenarioProject.elementDefs : [];
  const def = defs.find(d => d.id === elementId);
  return def ? def.name : String(elementId);
}
function tdElementChipHtml(elementId) {
  const color = (typeof getElementColor === "function") ? getElementColor(elementId) : "#fff";
  return `<span class="td-chip" style="border-color:${color}">${tdElementName(elementId)}</span>`;
}

function tdElementColor(elementId) {
  return (typeof getElementColor === "function") ? getElementColor(elementId) : "#ffffff";
}

// ミニゲーム本体。終わったら { result: "win" | "lose" | "quit", kills, wave } を返す
function runTowerDefenseBattle(pool, opts) {
  return new Promise(resolve => {
    const st = tdCreateState(pool, opts);
    let finished = false;
    let selectedType = null;   // 配置しようとしているユニットの種類（key）
    let selectedSlot = null;   // 選んでいる配置済みユニットのマス
    let infoNote = "";         // 一時的なお知らせ（資金不足など）
    let quitArmed = false, quitTimer = null;
    let rafId = null, lastTs = null;
    
    const overlay = document.createElement("div");
    overlay.className = "td-overlay";
    overlay.innerHTML = `
      <div class="td-panel">
        <div class="td-header">
          <span class="td-title">掃討作戦（迎撃） STAGE ${st.stage}</span>
          <span class="td-wave"></span>
          <span class="td-funds"></span>
        </div>
        <div class="td-basehp"><div class="td-basehp-fill"></div><span class="td-basehp-text"></span></div>
        <canvas class="td-canvas" width="${TD_FIELD_W * 2}" height="${TD_FIELD_H * 2}"></canvas>
        <div class="td-info"></div>
        <div class="td-combo"></div>
        <div class="td-units"></div>
        <div class="td-controls">
          <button type="button" class="td-btn td-btn-start"></button>
          <button type="button" class="td-btn td-btn-speed"></button>
          <button type="button" class="td-btn td-btn-quit"></button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    
    const canvas = overlay.querySelector(".td-canvas");
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);
    const waveEl = overlay.querySelector(".td-wave");
    const fundsEl = overlay.querySelector(".td-funds");
    const baseFillEl = overlay.querySelector(".td-basehp-fill");
    const baseTextEl = overlay.querySelector(".td-basehp-text");
    const infoEl = overlay.querySelector(".td-info");
    const comboEl = overlay.querySelector(".td-combo");
    const unitsEl = overlay.querySelector(".td-units");
    const startBtn = overlay.querySelector(".td-btn-start");
    const speedBtn = overlay.querySelector(".td-btn-speed");
    const quitBtn = overlay.querySelector(".td-btn-quit");
    
    // ユニット選択ボタン
    st.templates.forEach(tpl => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "td-unit-btn";
      btn.dataset.key = tpl.key;
      btn.style.borderColor = tdElementColor(tpl.element);
      btn.innerHTML = `<span class="td-unit-name">${tpl.label}</span><span class="td-unit-meta">${tdUnitSummary(tpl)}　${tpl.cost}</span>`;
      btn.onclick = () => {
        selectedType = (selectedType === tpl.key) ? null : tpl.key;
        selectedSlot = null; infoNote = "";
        refreshUI();
      };
      unitsEl.appendChild(btn);
    });
    
    function refreshUI() {
      waveEl.textContent = `WAVE ${st.wave}/${st.wavesTotal}` + (tdIsBossWave(st, st.wave) && st.bossPool.length > 0 ? " ★BOSS" : "");
      fundsEl.textContent = `資金 ${st.funds}`;
      const ratio = Math.max(0, st.baseHp) / st.baseMaxHp;
      baseFillEl.style.width = `${Math.round(ratio * 100)}%`;
      baseTextEl.textContent = `拠点HP ${Math.max(0, Math.round(st.baseHp))}/${st.baseMaxHp}`;
      
      unitsEl.querySelectorAll(".td-unit-btn").forEach(btn => {
        const tpl = st.templates.find(t => t.key === btn.dataset.key);
        btn.classList.toggle("td-selected", selectedType === tpl.key);
        btn.classList.toggle("td-disabled", st.funds < tpl.cost);
      });
      
      startBtn.textContent = st.phase === "prep" ? `WAVE ${st.wave} 開始` : (st.phase === "wave" ? "迎撃中……" : "終了");
      startBtn.disabled = st.phase !== "prep";
      speedBtn.textContent = `速度 ×${st.speed}`;
      quitBtn.textContent = quitArmed ? "本当にやめる？" : "やめる";
      
      // コンボ欄：今の履歴と、使えるコンボの一覧
      if (st.combos.length === 0) {
        comboEl.innerHTML = `<span class="td-combo-label">COMBO</span><span class="td-combo-none">使えるコンボはまだない（本編でコンボを解禁すると使える）</span>`;
      } else {
        const hist = st.history.length > 0 ? st.history.map(tdElementChipHtml).join('<span class="td-arrow">→</span>') : '<span class="td-combo-none">なし</span>';
        const list = st.combos.map(c => `<div class="td-combo-item"><b>${c.name || "名無しのコンボ"}</b> ${(c.elements || []).filter(Boolean).map(tdElementChipHtml).join('<span class="td-arrow">→</span>')}</div>`).join("");
        comboEl.innerHTML = `<div class="td-combo-row"><span class="td-combo-label">履歴</span>${hist}</div>${list}`;
      }
      
      // 情報行
      const unit = selectedSlot !== null ? st.units.find(u => u.slot === selectedSlot) : null;
      if (infoNote) {
        infoEl.textContent = infoNote;
      } else if (unit) {
        const tpl = unit.tpl;
        const maxed = unit.level >= TD_UNIT_MAX_LEVEL;
        infoEl.innerHTML = "";
        const text = document.createElement("span");
        text.textContent = tpl.role === "support"
          ? `${tpl.label} Lv${unit.level}　味方の攻撃+${Math.round(tpl.supportRate * (1 + TD_LEVEL_ATK_RATE * (unit.level - 1)) * 100)}%　射程${tpl.range}`
          : `${tpl.label} Lv${unit.level}　攻撃${Math.round(tdUnitDamage(st, unit))}　射程${tpl.range}　狙い:${TD_TARGETING_LABELS[tpl.targeting]}` + (tdSupportBonus(st, unit) > 0 ? `　サポート+${Math.round(tdSupportBonus(st, unit) * 100)}%` : "");
        infoEl.appendChild(text);
        const up = document.createElement("button");
        up.type = "button";
        up.className = "td-btn td-btn-upgrade";
        up.textContent = maxed ? "最大Lv" : `強化 ${tdUpgradeCost(unit)}`;
        up.disabled = maxed || st.funds < tdUpgradeCost(unit);
        up.onclick = () => {
          const r = tdUpgradeUnit(st, unit);
          infoNote = r.ok ? "" : r.reason;
          refreshUI();
        };
        infoEl.appendChild(up);
      } else if (selectedType) {
        const tpl = st.templates.find(t => t.key === selectedType);
        infoEl.textContent = `${tpl.label}（${tdUnitSummary(tpl)}）：置きたい白い枠をタップ`;
      } else {
        infoEl.textContent = "下から仲間を選んで、白い枠に配置しよう。白い数字＝弱点、灰色＝耐性。";
      }
    }
    
    // ----- 操作 -----
    function toField(ev) {
      const rect = canvas.getBoundingClientRect();
      return { x: (ev.clientX - rect.left) / rect.width * TD_FIELD_W, y: (ev.clientY - rect.top) / rect.height * TD_FIELD_H };
    }
    canvas.addEventListener("pointerdown", ev => {
      ev.preventDefault();
      if (finished || st.phase === "won" || st.phase === "lost") return;
      const p = toField(ev);
      const slotIndex = TD_SLOTS.findIndex(s => Math.hypot(p.x - s[0], p.y - s[1]) <= TD_SLOT_RADIUS + 8);
      infoNote = "";
      if (slotIndex < 0) { selectedSlot = null; selectedType = null; refreshUI(); return; }
      const existing = st.units.find(u => u.slot === slotIndex);
      if (existing) { selectedSlot = slotIndex; selectedType = null; refreshUI(); return; }
      if (selectedType) {
        const r = tdPlaceUnit(st, slotIndex, selectedType);
        if (!r.ok) infoNote = r.reason;
      } else {
        infoNote = "先に下から配置する仲間を選んでください";
      }
      refreshUI();
    });
    startBtn.onclick = () => { if (tdStartWave(st)) { infoNote = ""; refreshUI(); } };
    speedBtn.onclick = () => { st.speed = st.speed === 1 ? 2 : 1; refreshUI(); };
    quitBtn.onclick = () => {
      if (!quitArmed) {
        quitArmed = true;
        quitTimer = setTimeout(() => { quitArmed = false; refreshUI(); }, 3000);
        refreshUI();
        return;
      }
      finish("quit");
    };
    
    // ----- 描画 -----
    function draw() {
      ctx.clearRect(0, 0, TD_FIELD_W, TD_FIELD_H);
      ctx.fillStyle = "#10151c";
      ctx.fillRect(0, 0, TD_FIELD_W, TD_FIELD_H);
      
      // 道
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      TD_PATH.forEach((p, i) => i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]));
      ctx.strokeStyle = "#000"; ctx.lineWidth = 44; ctx.stroke();
      ctx.strokeStyle = "#d8c7a0"; ctx.lineWidth = 36; ctx.stroke();
      // ゴール（拠点）
      ctx.fillStyle = "#ff5a5a"; ctx.fillRect(TD_FIELD_W - 14, 296, 14, 48);
      ctx.fillStyle = "#fff"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "right";
      ctx.fillText("拠点", TD_FIELD_W - 18, 292);
      
      // 配置マス
      TD_SLOTS.forEach((s, i) => {
        const occupied = st.units.some(u => u.slot === i);
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = occupied ? "rgba(255,255,255,0.25)" : "#ffffff";
        ctx.lineWidth = 2;
        ctx.strokeRect(s[0] - TD_SLOT_RADIUS, s[1] - TD_SLOT_RADIUS, TD_SLOT_RADIUS * 2, TD_SLOT_RADIUS * 2);
        ctx.setLineDash([]);
      });
      
      // 選択中ユニットの射程
      if (selectedSlot !== null) {
        const u = st.units.find(x => x.slot === selectedSlot);
        if (u) {
          const sp = tdSlotPos(u.slot);
          ctx.beginPath(); ctx.arc(sp.x, sp.y, u.tpl.range, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.fill();
          ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();
        }
      }
      
      // ユニット
      st.units.forEach(u => {
        const sp = tdSlotPos(u.slot);
        const color = tdElementColor(u.tpl.element);
        ctx.beginPath(); ctx.arc(sp.x, sp.y, 19, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = (u.slot === selectedSlot) ? "#ffd23f" : "#fff"; ctx.stroke();
        const unitImg = u.tpl.imagePath ? tdGetImage(u.tpl.imagePath) : null;
        if (unitImg && unitImg.ok) {
          ctx.save();
          ctx.beginPath(); ctx.arc(sp.x, sp.y, 17, 0, Math.PI * 2); ctx.clip();
          ctx.drawImage(unitImg.img, sp.x - 17, sp.y - 17, 34, 34);
          ctx.restore();
        } else {
          ctx.fillStyle = "#111"; ctx.font = "bold 16px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(u.tpl.roleChar, sp.x, sp.y + 1);
        }
        if (u.level > 1) {
          ctx.fillStyle = "#000"; ctx.fillRect(sp.x + 6, sp.y + 8, 22, 13);
          ctx.fillStyle = "#ffd23f"; ctx.font = "bold 10px sans-serif"; ctx.fillText(`Lv${u.level}`, sp.x + 17, sp.y + 15);
        }
      });
      
      // 撃った演出
      st.fx.forEach(f => {
        ctx.globalAlpha = Math.min(1, f.t / 0.12);
        ctx.strokeStyle = f.color; ctx.lineWidth = 3;
        if (f.kind === "line") { ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke(); }
        else { ctx.beginPath(); ctx.arc(f.x1, f.y1, f.r, 0, Math.PI * 2); ctx.stroke(); }
        ctx.globalAlpha = 1;
      });
      
      // 敵
      st.enemies.forEach(e => {
        const size = e.isBoss ? 54 : 34;
        const src = e.imagePath || `img/敵/${e.name}.png`;
        const entry = tdGetImage(src);
        const ringColor = e.elements.length > 0 ? tdElementColor(e.elements[0]) : "#ffffff";
        if (entry.ok) {
          ctx.drawImage(entry.img, e.x - size / 2, e.y - size / 2, size, size);
        } else {
          ctx.beginPath(); ctx.arc(e.x, e.y, size / 2 - 2, 0, Math.PI * 2);
          ctx.fillStyle = "#5b6b7a"; ctx.fill();
          ctx.fillStyle = "#fff"; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(String(e.name).charAt(0), e.x, e.y + 1);
        }
        ctx.beginPath(); ctx.arc(e.x, e.y, size / 2, 0, Math.PI * 2);
        ctx.strokeStyle = e.isBoss ? "#ff3b3b" : ringColor; ctx.lineWidth = e.isBoss ? 4 : 2.5; ctx.stroke();
        if (e.isBoss) {
          ctx.fillStyle = "#ff3b3b"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.lineWidth = 3; ctx.strokeStyle = "#000"; ctx.strokeText("BOSS " + e.name, e.x, e.y - size / 2 - 16); ctx.fillText("BOSS " + e.name, e.x, e.y - size / 2 - 16);
        }
        if (e.slowUntil > st.time) { ctx.fillStyle = "#9be8ff"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.fillText("遅", e.x, e.y + size / 2 + 10); }
        // 状態マーク（止＝足止め／継＝継続ダメージ／弱＝防御低下／攻↓＝攻撃低下）
        const marks = [];
        if (e.stunUntil > st.time) marks.push("止");
        if (e.dot) marks.push("継");
        if (e.defDownUntil > st.time) marks.push("弱");
        if (e.atkDownUntil > st.time) marks.push("攻↓");
        if (marks.length > 0) {
          ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.lineWidth = 3; ctx.strokeStyle = "#000"; ctx.strokeText(marks.join(" "), e.x, e.y + size / 2 + 20);
          ctx.fillStyle = "#ffd23f"; ctx.fillText(marks.join(" "), e.x, e.y + size / 2 + 20);
        }
        // HPバー
        const barW = e.isBoss ? 54 : 34, barY = e.y - size / 2 - 11;
        ctx.fillStyle = "#000"; ctx.fillRect(e.x - barW / 2 - 1, barY, barW + 2, 6);
        ctx.fillStyle = "#59e07a"; ctx.fillRect(e.x - barW / 2, barY + 1, barW * Math.max(0, e.hp / e.maxHp), 4);
      });
      
      // ダメージ数字
      st.popups.forEach(p => {
        const rise = (1 - Math.min(1, p.t / 0.8)) * 14;
        ctx.globalAlpha = Math.min(1, p.t / 0.3);
        ctx.font = p.weak ? "bold 16px sans-serif" : "bold 13px sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.lineWidth = 3; ctx.strokeStyle = "#000"; ctx.strokeText(p.text, p.x, p.y - rise);
        ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, p.y - rise);
        ctx.globalAlpha = 1;
      });
      
      // コンボ発動の帯
      st.banners.forEach(b => {
        ctx.globalAlpha = Math.min(1, b.t / 0.4);
        ctx.fillStyle = "rgba(0,0,0,0.8)"; ctx.fillRect(0, 150, TD_FIELD_W, 56);
        ctx.fillStyle = "#ffd23f"; ctx.fillRect(0, 150, TD_FIELD_W, 4); ctx.fillRect(0, 202, TD_FIELD_W, 4);
        ctx.fillStyle = "#ffd23f"; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText("COMBO", 24, 178);
        ctx.fillStyle = "#fff"; ctx.font = "bold 26px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(b.text, TD_FIELD_W / 2, 179);
        ctx.globalAlpha = 1;
      });
      
      // 準備中の案内
      if (st.phase === "prep") {
        ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, TD_FIELD_W, 34);
        ctx.fillStyle = "#ffd23f"; ctx.font = "bold 16px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(`WAVE ${st.wave} の準備中：仲間を配置して「開始」` + (tdIsBossWave(st, st.wave) && st.bossPool.length > 0 ? "（中ボス出現！）" : ""), TD_FIELD_W / 2, 17);
      }
    }
    
    // ----- メインループ -----
    let uiAccum = 0;
    function frame(ts) {
      if (finished) return;
      if (lastTs === null) lastTs = ts;
      const realDt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;
      const prevPhase = st.phase;
      tdStep(st, realDt * st.speed);
      uiAccum += realDt;
      if (st.phase !== prevPhase || uiAccum > 0.15) { uiAccum = 0; refreshUI(); }
      draw();
      if (st.phase === "won" || st.phase === "lost") {
        setTimeout(() => finish(st.phase === "won" ? "win" : "lose"), 700);
        // 二重に呼ばれないよう、ループはここで止める（画面は最後の状態のまま）
        return;
      }
      rafId = requestAnimationFrame(frame);
    }
    
    function finish(result) {
      if (finished) return;
      finished = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (quitTimer) clearTimeout(quitTimer);
      overlay.remove();
      resolve({ result, kills: st.kills, wave: st.wave, bossKills: st.bossKills, stage: st.stage, wavesTotal: st.wavesTotal });
    }
    
    refreshUI();
    draw();
    rafId = requestAnimationFrame(frame);
  });
}

// ===== 施設のメニュー =====
// 冒険者協会の入り口。openCustomFacility（town.js）から呼ばれる
function openTowerDefenseFacility(facility, returnTo) {
  towerDefenseFacility = facility;
  towerDefenseReturnTo = typeof returnTo === "function" ? returnTo : openTownMenu;
  showTowerDefenseMainMenu();
}

// 協会のトップ。今後ほかの機能を足す時は、ここに項目を増やす
function showTowerDefenseMainMenu() {
  const options = [
    { label: "掃討作戦", action: () => showTowerDefenseModeMenu() },
    { label: "戻る", action: () => towerDefenseReturnTo() }
  ];
  showLocationMenu(options, (towerDefenseFacility && towerDefenseFacility.name) || "冒険者協会");
}

// 掃討作戦のモード選択（迎撃＝守る側／出撃＝攻める側）と、協会ポイントでの事前強化
function showTowerDefenseModeMenu() {
  const g = tdGuildState();
  const options = [
    { label: "迎撃モード（守る）", action: () => showTowerDefenseWaveMenu() },
    { label: "出撃モード（攻める）", action: async () => {
        if (typeof startTowerRaid === "function") { startTowerRaid(1); return; }   // tower_raid.js
        hideLocationMenu();
        changeSpeaker("");
        await displayMessage("出撃モードは、まだ準備中のようだ。");
        showTowerDefenseModeMenu();
      } },
    { label: `事前強化（協会ポイント ${g.points}）`, action: () => showTowerDefenseUpgradeMenu() },
    { label: "戻る", action: () => showTowerDefenseMainMenu() }
  ];
  showLocationMenu(options, "掃討作戦");
}

// 迎撃のウェーブ数の選択
function showTowerDefenseWaveMenu() {
  const options = TD_WAVE_OPTIONS.map(n => {
    const bosses = Math.floor(n / TD_BOSS_EVERY);
    const note = n === TD_WAVE_OPTIONS[0] ? "（お試し）" : (bosses > 0 ? `（中ボス${bosses}体）` : "");
    return { label: `${n}ウェーブ${note}`, action: () => startTowerDefenseDefense(n, 1) };
  });
  options.push({ label: "戻る", action: () => showTowerDefenseModeMenu() });
  showLocationMenu(options, "迎撃モード：ウェーブ数を選ぶ");
}

// 事前強化（協会ポイントを使う）。買うたびにメニューを開き直して、最新のレベルと費用を見せる
function showTowerDefenseUpgradeMenu() {
  const g = tdGuildState();
  const options = TD_UPGRADE_DEFS.map(def => {
    const lv = g.upgrades[def.key];
    const maxed = lv >= TD_UPGRADE_MAX;
    const label = maxed ? `${def.label} Lv${lv}（最大）` : `${def.label} Lv${lv}→${lv + 1}（${tdUpgradeCostPoints(lv)}pt）`;
    return { label, action: async () => {
        hideLocationMenu();
        changeSpeaker("");
        const r = tdBuyGuildUpgrade(def.key);
        if (r.ok) await displayMessage(`${def.label}を強化した！（${def.describe(g.upgrades[def.key])}）`);
        else await displayMessage(`${r.reason}。`);
        showTowerDefenseUpgradeMenu();
      } };
  });
  options.push({ label: "戻る", action: () => showTowerDefenseModeMenu() });
  showLocationMenu(options, `事前強化（協会ポイント ${g.points}）`);
}

// 迎撃モードを1ステージ遊ぶ。クリアしたら報酬を渡し、次のステージ（難易度が上がる）へ進むか選べる
async function startTowerDefenseDefense(wavesTotal, stage) {
  hideLocationMenu();
  changeSpeaker("");
  const pool = tdGetEnemyPool();
  if (pool.length === 0) {
    await displayMessage("……掃討する魔物の情報が見当たらない。");
    showTowerDefenseModeMenu();
    return;
  }
  const g = tdGuildState();
  const outcome = await runTowerDefenseBattle(pool, { wavesTotal, stage, upgrades: Object.assign({}, g.upgrades) });
  changeSpeaker("");
  if (outcome.result === "win") {
    const reward = Math.round((TD_CLEAR_GOLD_BASE + outcome.kills * TD_CLEAR_GOLD_PER_KILL) * (1 + TD_STAGE_REWARD_GROWTH * (stage - 1)));
    const points = wavesTotal * TD_POINTS_PER_WAVE + outcome.bossKills * TD_POINTS_PER_BOSS;
    changeGold(reward);
    g.points += points;
    await displayMessage(`掃討作戦、成功！　${outcome.kills}体を討ち取り、報酬として${reward}陳と協会ポイント${points}を受け取った。`);
    showLocationMenu([
      { label: `次のステージへ進む（STAGE ${stage + 1}・敵が強くなる）`, action: () => startTowerDefenseDefense(wavesTotal, stage + 1) },
      { label: "協会に戻る", action: () => showTowerDefenseModeMenu() }
    ], `STAGE ${stage} クリア`);
    return;
  } else if (outcome.result === "lose") {
    await displayMessage("拠点が陥落してしまった……。今回は報酬なしだ。");
  }
  showTowerDefenseModeMenu();
}
