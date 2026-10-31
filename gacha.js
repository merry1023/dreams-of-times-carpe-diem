// gacha.js
// ===================================================================
// ===== 技ガチャ（冒険者協会の機能。ガチャ石を使って、ガチャ専用の技を引く） =====
// ===================================================================
// ★仕様（企画書の決定事項）
//   ・ガチャ石（仮）を1回10個で引く。排出されるのは「ガチャ専用の技」（エディタ「技ガチャ」タブで登録）
//   ・レア度は3段階（ノーマル・レア・スーパーレア）。ハズレ枠（アイテムまたは陳）も作れる
//   ・50連引いてもスーパーレアが出なかった時は、50回目でスーパーレア確定（天井）
//   ・ガチャ期間を設定でき、期間外はガチャを引けない（引いた技は、期間外でも使える）
//   ・同じ技が出ると「凸」（最大5凸）。5凸のあとに出た時は、ガチャ石と陳（所持陳の10%。最低10万・最大500万）に変わる
//   ・技はキャラ1人につき2つまでセットできる。通常スキル・上位スキルのどちらの動きも、職業に関係なく使える
//     （消費はSPか焦力か、技ごとに決める）
// ★データ
//   ・設定と技：scenarioProject.gachaConfig / scenarioProject.gachaSkills（gacha_editor.js）
//   ・プレイヤーの状態：player.wazaGacha = { owned:{技id:凸数}, pity, pulls }（セーブは player ごとに自動）
//   ・セット中の技：主人公・仲間それぞれの gachaEquip（技idの配列。最大2つ）
// ★戦闘との連携：getPlayerGachaSkills() / getCompanionGachaSkills(c) が、凸を反映した技を返す（battle.js が使う）

const GACHA_RARITIES = [
  { key: "N", label: "ノーマル" },
  { key: "R", label: "レア" },
  { key: "SR", label: "スーパーレア" }
];
const GACHA_MAX_BREAK = 5;      // 最大の凸数
const GACHA_EQUIP_MAX = 2;      // キャラ1人にセットできる数

// 標準の設定（エディタで何も設定しなければ、これで動く）
const GACHA_DEFAULTS = {
  name: "技ガチャ",
  cost: 10,                                  // 1回あたりのガチャ石の数
  rates: { N: 70, R: 25, SR: 5 },            // レア度ごとの確率（%）
  missRate: 20,                              // ハズレ枠の確率（%）。ノーマルの確率の中から割り当てる
  pity: 50,                                  // 天井（0なら天井なし）
  startAt: "", endAt: "",                    // 開催期間（空なら、その側は制限なし）
  dupStones: { N: 2, R: 5, SR: 10 },         // 5凸のあとに同じ技が出た時に返るガチャ石の数
  dupGoldPercent: 10, dupGoldMin: 100000, dupGoldMax: 5000000,   // 同じ時に返る陳（所持陳の%、最低、最大）
  missPool: []                               // ハズレ枠の中身 [{ kind:"item"|"gold", itemId, count, amount, weight }]
};

// 凸で増やせるパラメータ（1凸ごとに、技ごとに最大3つ選ぶ）。value は足し算（マイナスで減らせる）
const GACHA_BREAK_PARAMS = [
  { key: "power", label: "威力", min: 0 },
  { key: "hitCount", label: "命中回数", min: 1, base: 1 },
  { key: "spCost", label: "消費SP", min: 0 },
  { key: "shouryokuCost", label: "消費焦力", min: 0, max: 100 },
  { key: "statusEffectChance", label: "状態異常①の確率（0〜1）", min: 0, max: 1 },
  { key: "statusEffectDuration", label: "状態異常①のターン数", min: 1, base: 1 },
  { key: "statusEffectPower", label: "状態異常①の効果量", min: 0 },
  { key: "selfBuffDuration", label: "自己強化①のターン数", min: 1, base: 1 },
  { key: "selfBuffPower", label: "自己強化①の効果量", min: 0 },
  { key: "lifestealRatio", label: "与ダメージのHP変換率（0〜1）", min: 0, max: 1 }
];

// ===== 設定・データの読み出し =====
function gachaNum(v, fallback, min, max) {
  const n = Number(v);
  const x = (v === "" || v == null || !Number.isFinite(n)) ? fallback : n;
  return Math.min(max, Math.max(min, x));
}

// 設定（足りない項目は標準の値で補う）
function gachaConfig() {
  const saved = (typeof scenarioProject !== "undefined" && scenarioProject && scenarioProject.gachaConfig && typeof scenarioProject.gachaConfig === "object")
    ? scenarioProject.gachaConfig : {};
  const d = GACHA_DEFAULTS;
  const rates = saved.rates || {}, dupStones = saved.dupStones || {};
  return {
    name: (typeof saved.name === "string" && saved.name.trim()) ? saved.name.trim() : d.name,
    cost: Math.round(gachaNum(saved.cost, d.cost, 1, 99999)),
    rates: {
      N: gachaNum(rates.N, d.rates.N, 0, 100), R: gachaNum(rates.R, d.rates.R, 0, 100), SR: gachaNum(rates.SR, d.rates.SR, 0, 100)
    },
    missRate: gachaNum(saved.missRate, d.missRate, 0, 100),
    pity: Math.round(gachaNum(saved.pity, d.pity, 0, 9999)),
    startAt: typeof saved.startAt === "string" ? saved.startAt : "",
    endAt: typeof saved.endAt === "string" ? saved.endAt : "",
    dupStones: {
      N: Math.round(gachaNum(dupStones.N, d.dupStones.N, 0, 99999)),
      R: Math.round(gachaNum(dupStones.R, d.dupStones.R, 0, 99999)),
      SR: Math.round(gachaNum(dupStones.SR, d.dupStones.SR, 0, 99999))
    },
    dupGoldPercent: gachaNum(saved.dupGoldPercent, d.dupGoldPercent, 0, 100),
    dupGoldMin: Math.round(gachaNum(saved.dupGoldMin, d.dupGoldMin, 0, 999999999)),
    dupGoldMax: Math.round(gachaNum(saved.dupGoldMax, d.dupGoldMax, 0, 999999999)),
    missPool: (Array.isArray(saved.missPool) ? saved.missPool : []).filter(m => m && (m.kind === "gold" ? Number(m.amount) > 0 : m.itemId)).map(m => ({
      kind: m.kind === "gold" ? "gold" : "item",
      itemId: m.itemId || "",
      count: Math.max(1, Math.round(Number(m.count) || 1)),
      amount: Math.max(0, Math.round(Number(m.amount) || 0)),
      weight: Math.max(0, Number(m.weight) > 0 ? Number(m.weight) : (m.weight === 0 ? 0 : 1))
    }))
  };
}

// 登録されているガチャ専用の技
function gachaAllEntries() {
  return (typeof scenarioProject !== "undefined" && scenarioProject && Array.isArray(scenarioProject.gachaSkills)) ? scenarioProject.gachaSkills : [];
}
function gachaEntryById(id) { return gachaAllEntries().find(e => e && e.id === id) || null; }
function gachaRarityOf(entry) { return (entry && (entry.rarity === "R" || entry.rarity === "SR")) ? entry.rarity : "N"; }
function gachaRarityLabel(key) { const r = GACHA_RARITIES.find(x => x.key === key); return r ? r.label : "ノーマル"; }
// そのレア度で排出される技（「排出に含める」がオフのものは除く）
function gachaPoolFor(rarity) {
  return gachaAllEntries().filter(e => e && e.enabled !== false && gachaRarityOf(e) === rarity);
}

// プレイヤーの状態（無ければ作る）
function gachaState() {
  if (typeof player === "undefined" || !player) return { owned: {}, pity: 0, pulls: 0 };
  if (!player.wazaGacha || typeof player.wazaGacha !== "object") player.wazaGacha = {};
  const g = player.wazaGacha;
  if (!g.owned || typeof g.owned !== "object") g.owned = {};
  if (!Number.isFinite(g.pity)) g.pity = 0;
  if (!Number.isFinite(g.pulls)) g.pulls = 0;
  return g;
}
// 手に入れている技の凸数（持っていなければ -1）
function gachaOwnedBreak(id) {
  const g = gachaState();
  return Number.isFinite(g.owned[id]) ? Math.min(GACHA_MAX_BREAK, Math.max(0, g.owned[id])) : -1;
}

// ===== 開催期間 =====
// 戻り値：{ state:"open"|"before"|"ended", start, end }（startAt / endAt は日時の文字列。空なら制限なし）
function gachaPeriodStatus(now) {
  const cfg = gachaConfig();
  const t = (now instanceof Date ? now : new Date()).getTime();
  const start = cfg.startAt ? new Date(cfg.startAt) : null;
  const end = cfg.endAt ? new Date(cfg.endAt) : null;
  const validStart = start && !isNaN(start.getTime()) ? start : null;
  const validEnd = end && !isNaN(end.getTime()) ? end : null;
  let state = "open";
  if (validStart && t < validStart.getTime()) state = "before";
  else if (validEnd && t > validEnd.getTime()) state = "ended";
  return { state, start: validStart, end: validEnd };
}
function gachaFormatDate(d) {
  if (!d) return "";
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// 画面に出す期間の文章
function gachaPeriodText() {
  const st = gachaPeriodStatus();
  if (!st.start && !st.end) return "開催期間：なし（いつでも引ける）";
  const range = `${st.start ? gachaFormatDate(st.start) : "（指定なし）"} ～ ${st.end ? gachaFormatDate(st.end) : "（指定なし）"}`;
  if (st.state === "before") return `開催前：${range}`;
  if (st.state === "ended") return `開催終了：${range}`;
  return `開催中：${range}`;
}

// ===== 凸を反映した、戦闘で使う技の作成 =====
// entry（エディタで登録した技）に、凸数ぶんのパラメータ増加を足してから、戦闘が参照する技のオブジェクトにする。
// ifブロックから「凸数」で分岐できるよう、skill.limitBreak に凸数を持たせる（battle.js の buildSkillExprContext）
function gachaBuildRuntimeSkill(entry, breakCount) {
  const e = JSON.parse(JSON.stringify(entry));
  const n = Math.min(GACHA_MAX_BREAK, Math.max(0, Math.round(breakCount) || 0));
  const table = Array.isArray(e.limitBreaks) ? e.limitBreaks : [];
  for (let i = 0; i < n; i++) {
    (Array.isArray(table[i]) ? table[i] : []).slice(0, 3).forEach(p => {
      const def = p && GACHA_BREAK_PARAMS.find(x => x.key === p.param);
      if (!def) return;
      const cur = Number(e[def.key]);
      const base = Number.isFinite(cur) && e[def.key] !== "" && e[def.key] != null ? cur : (def.base != null ? def.base : 0);
      let v = base + (Number(p.value) || 0);
      if (def.min != null) v = Math.max(def.min, v);
      if (def.max != null) v = Math.min(def.max, v);
      e[def.key] = Math.round(v * 1000) / 1000;
    });
  }
  const skill = buildRuntimeSkillFromSkillEntry(e);   // scenariobuild.js
  skill.gachaId = entry.id;
  skill.isGacha = true;
  skill.limitBreak = n;
  skill.rarity = gachaRarityOf(entry);
  // 消費はSPか焦力か、技ごとに決める（焦力の技は、上位スキルと同じ扱い＝SPを消費しない）
  const useShouryoku = entry.costType === "shouryoku";
  skill.isUpper = useShouryoku;
  if (useShouryoku) skill.shouryokuCost = Math.max(0, Math.min(100, e.shouryokuCost != null ? (Number(e.shouryokuCost) || 0) : 30));
  return skill;
}

// 戦闘で使えるか（攻撃・回復・自己強化、またはブロックで組んだ技）
function gachaIsUsable(skill) {
  return skill.type === "attack" || skill.type === "heal" || skill.type === "buff" || (Array.isArray(skill.blocks) && skill.blocks.length > 0);
}

// ===== セット中の技 =====
function gachaEquipIds(unit) {
  if (!unit) return [];
  if (!Array.isArray(unit.gachaEquip)) unit.gachaEquip = [];
  // 登録が消えた技・持っていない技は外す
  const ids = unit.gachaEquip.slice(0, GACHA_EQUIP_MAX).map(id => (id && gachaEntryById(id) && gachaOwnedBreak(id) >= 0) ? id : null);
  while (ids.length < GACHA_EQUIP_MAX) ids.push(null);
  return ids;
}
function getUnitGachaSkills(unit) {
  return gachaEquipIds(unit).filter(Boolean).map(id => gachaBuildRuntimeSkill(gachaEntryById(id), gachaOwnedBreak(id))).filter(gachaIsUsable);
}
function getPlayerGachaSkills() {
  if (typeof player === "undefined" || !player) return [];
  return getUnitGachaSkills(player);
}
function getCompanionGachaSkills(companion) {
  return getUnitGachaSkills(companion);
}

// ===== 抽選 =====
// レア度を決める。天井（pity 回目まで SR が出ていなければ SR 確定）も、ここで判定する
// 戻り値：{ rarity:"N"|"R"|"SR", miss:boolean }
function gachaRollRarity(cfg, state) {
  if (cfg.pity > 0 && state.pity + 1 >= cfg.pity) return { rarity: "SR", miss: false, pityHit: true };
  const total = cfg.rates.N + cfg.rates.R + cfg.rates.SR;
  const r = total > 0 ? cfg.rates : GACHA_DEFAULTS.rates;
  const sum = total > 0 ? total : 100;
  const pSR = r.SR / sum, pR = r.R / sum, pN = r.N / sum;
  const missP = Math.min(pN, cfg.missRate / 100);   // ハズレは、ノーマルの確率の中から割り当てる
  const u = Math.random();
  if (u < pSR) return { rarity: "SR", miss: false };
  if (u < pSR + pR) return { rarity: "R", miss: false };
  return { rarity: "N", miss: (u - pSR - pR) < missP };
}

// そのレア度の技を1つ選ぶ。空なら、1つ下のレア度から探す。全部空ならnull
function gachaPickEntry(rarity) {
  const order = rarity === "SR" ? ["SR", "R", "N"] : (rarity === "R" ? ["R", "N"] : ["N"]);
  for (const key of order) {
    const pool = gachaPoolFor(key);
    if (pool.length > 0) return pool[Math.floor(Math.random() * pool.length)];
  }
  return null;
}

// ハズレ枠の中身を1つ選んで、実際に渡す。戻り値は表示用の文章
function gachaGrantMiss(cfg) {
  const pool = cfg.missPool.filter(m => m.weight > 0 && (m.kind === "gold" || (typeof ITEM_MASTER === "undefined" || ITEM_MASTER[m.itemId])));
  if (pool.length === 0) {
    // 中身が未設定の時の保険（何も出ないよりは、少しの陳を渡す）
    if (typeof changeGold === "function") changeGold(1000);
    return "ハズレ…… 1000陳を手に入れた。";
  }
  const total = pool.reduce((a, m) => a + m.weight, 0);
  let roll = Math.random() * total, picked = pool[pool.length - 1];
  for (const m of pool) { roll -= m.weight; if (roll < 0) { picked = m; break; } }
  if (picked.kind === "gold") {
    if (typeof changeGold === "function") changeGold(picked.amount);
    return `ハズレ…… ${picked.amount}陳を手に入れた。`;
  }
  if (typeof addItem === "function") addItem(picked.itemId, picked.count);
  const master = (typeof ITEM_MASTER !== "undefined") ? ITEM_MASTER[picked.itemId] : null;
  return `ハズレ…… ${master ? master.name : picked.itemId}×${picked.count}を手に入れた。`;
}

// 5凸のあとに同じ技が出た時の返却（ガチャ石＋所持陳の%）。戻り値：{ stones, gold }
function gachaGrantDuplicate(cfg, rarity) {
  const stones = cfg.dupStones[rarity] || 0;
  if (stones > 0 && typeof tdAddGachaStones === "function") tdAddGachaStones(stones);
  const have = (typeof gold === "number") ? gold : 0;
  const lo = Math.min(cfg.dupGoldMin, cfg.dupGoldMax), hi = Math.max(cfg.dupGoldMin, cfg.dupGoldMax);
  const goldGain = Math.min(hi, Math.max(lo, Math.floor(have * cfg.dupGoldPercent / 100)));
  if (goldGain > 0 && typeof changeGold === "function") changeGold(goldGain);
  return { stones, gold: goldGain };
}

// 1回引く。ガチャ石の消費は呼び出し側で済ませておく。戻り値：結果の文章の配列
function gachaPullOnce(cfg) {
  const st = gachaState();
  const roll = gachaRollRarity(cfg, st);
  st.pulls += 1;
  st.pity = (roll.rarity === "SR") ? 0 : st.pity + 1;   // スーパーレアが出たら、天井のカウントをリセット
  if (roll.miss) return [gachaGrantMiss(cfg)];
  const entry = gachaPickEntry(roll.rarity);
  if (!entry) return [gachaGrantMiss(cfg)];   // 技が1つも登録されていない時の保険
  const rarity = gachaRarityOf(entry);        // 該当のレア度が空で、1つ下から選んだ場合も、実際の技のレア度で表示する
  const tag = `【${gachaRarityLabel(rarity)}】`;
  const name = (typeof stripRubyNotation === "function") ? stripRubyNotation(entry.name || "名無しの技") : (entry.name || "名無しの技");
  const before = gachaOwnedBreak(entry.id);
  const lines = [];
  if (roll.pityHit) lines.push(`${cfg.pity}連目！ 天井でスーパーレアが確定した！`);
  if (before < 0) {
    st.owned[entry.id] = 0;
    lines.push(`${tag}「${name}」を手に入れた！（NEW）`);
  } else if (before < GACHA_MAX_BREAK) {
    st.owned[entry.id] = before + 1;
    lines.push(`${tag}「${name}」がもう1つ出た！ ${before + 1}凸になった！${before + 1 >= GACHA_MAX_BREAK ? "（最大）" : ""}`);
  } else {
    const back = gachaGrantDuplicate(cfg, rarity);
    const parts = [];
    if (back.stones > 0) parts.push(`${(typeof tdGachaStoneName === "function") ? tdGachaStoneName() : "ガチャ石"}×${back.stones}`);
    if (back.gold > 0) parts.push(`${back.gold}陳`);
    lines.push(`${tag}「${name}」は、すでに${GACHA_MAX_BREAK}凸。代わりに${parts.length ? parts.join("と") : "何も"}手に入れた。`);
  }
  return lines;
}

// ===== 画面（冒険者協会の「技ガチャ」） =====
let gachaReturnTo = null;   // 協会のトップへ戻る関数

function gachaStoneLabel() { return (typeof tdGachaStoneName === "function") ? tdGachaStoneName() : "ガチャ石"; }
function gachaStonesHeld() { return (typeof tdGetGachaStones === "function") ? tdGetGachaStones() : 0; }
function gachaSkillName(entry) {
  const raw = entry && entry.name ? entry.name : "名無しの技";
  return (typeof stripRubyNotation === "function") ? stripRubyNotation(raw) : raw;
}

// 協会のトップから呼ぶ入口
function openGachaMenu(returnTo) {
  gachaReturnTo = typeof returnTo === "function" ? returnTo : null;
  showGachaMenu();
}

async function gachaSay(text) {
  hideLocationMenu();
  changeSpeaker("");
  await displayMessage(text);
}

function showGachaMenu() {
  const cfg = gachaConfig();
  const st = gachaState();
  const period = gachaPeriodStatus();
  const open = period.state === "open";
  const pityLeft = cfg.pity > 0 ? Math.max(1, cfg.pity - st.pity) : 0;
  const suffix = open ? "" : (period.state === "before" ? "（開催前）" : "（開催終了）");
  const options = [
    { label: `1回引く（${gachaStoneLabel()}${cfg.cost}個）${suffix}`, action: () => gachaPullFlow(1) },
    { label: `10回引く（${gachaStoneLabel()}${cfg.cost * 10}個）${suffix}`, action: () => gachaPullFlow(10) },
    { label: "排出内容を見る", action: () => showGachaInfo() },
    { label: "技をセットする", action: () => showGachaEquipMenu() },
    { label: "戻る", action: () => { if (gachaReturnTo) gachaReturnTo(); else hideLocationMenu(); } }
  ];
  const pityNote = cfg.pity > 0 ? `／天井まであと${pityLeft}回` : "";
  showLocationMenu(options, `${cfg.name}（${gachaStoneLabel()} ${gachaStonesHeld()}${pityNote}）`);
}

async function gachaPullFlow(count) {
  const cfg = gachaConfig();
  const period = gachaPeriodStatus();
  if (period.state !== "open") {
    await gachaSay(period.state === "before" ? "このガチャは、まだ開催前のようだ。" : "このガチャは、開催期間が終わってしまったようだ。");
    showGachaMenu();
    return;
  }
  if (gachaAllEntries().filter(e => e && e.enabled !== false).length === 0) {
    await gachaSay("ガチャの景品は、まだ準備中のようだ。");
    showGachaMenu();
    return;
  }
  const need = cfg.cost * count;
  if (gachaStonesHeld() < need) {
    await gachaSay(`${gachaStoneLabel()}が足りない！（必要${need}個／所持${gachaStonesHeld()}個）`);
    showGachaMenu();
    return;
  }
  // ガチャ石を消費してから、引く（tdAddGachaStones は増やす専用なので、直接減らす）
  player.gachaStones = gachaStonesHeld() - need;
  hideLocationMenu();
  changeSpeaker("");
  await displayMessage(count === 1 ? "ガチャを引いた……！" : `${count}回、続けてガチャを引いた……！`);
  const showFn = count > 1 && typeof displayMessageAutoAdvance === "function" ? displayMessageAutoAdvance : displayMessage;
  for (let i = 0; i < count; i++) {
    const lines = gachaPullOnce(cfg);
    for (const line of lines) await showFn(count > 1 ? `${i + 1}回目：${line}` : line);
  }
  showGachaMenu();
}

// 排出の確率・ラインナップ・ルールの説明
async function showGachaInfo() {
  const cfg = gachaConfig();
  const total = (cfg.rates.N + cfg.rates.R + cfg.rates.SR) || 100;
  const pct = v => `${Math.round(v / total * 1000) / 10}%`;
  const missP = Math.min(cfg.rates.N, cfg.missRate / 100 * total);
  await gachaSay(gachaPeriodText());
  await displayMessage(`確率：スーパーレア${pct(cfg.rates.SR)}／レア${pct(cfg.rates.R)}／ノーマル${pct(cfg.rates.N - missP)}／ハズレ${pct(missP)}` + (cfg.pity > 0 ? `。${cfg.pity}連目までスーパーレアが出なければ、${cfg.pity}連目で確定。` : "。"));
  const lineup = GACHA_RARITIES.slice().reverse().map(r => {
    const names = gachaPoolFor(r.key).map(gachaSkillName);
    return `${r.label}：${names.length ? names.join("、") : "（なし）"}`;
  });
  for (const line of lineup) await displayMessage(line);
  await displayMessage(`同じ技が出ると凸が増える（最大${GACHA_MAX_BREAK}凸）。${GACHA_MAX_BREAK}凸のあとに出ると、${gachaStoneLabel()}と陳に変わる。`);
  showGachaMenu();
}

// ----- セット画面 -----
function gachaMembers() {
  const list = [{ name: "主人公", unit: player }];
  (player.companions || []).forEach(c => list.push({ name: (typeof getCompanionDisplayName === "function") ? getCompanionDisplayName(c) : (c.name || "仲間"), unit: c }));
  return list;
}

function showGachaEquipMenu() {
  const options = gachaMembers().map(m => {
    const names = gachaEquipIds(m.unit).filter(Boolean).map(id => gachaSkillName(gachaEntryById(id)));
    return { label: `${m.name}：${names.length ? names.join("／") : "（なし）"}`, action: () => showGachaEquipUnitMenu(m) };
  });
  options.push({ label: "戻る", action: () => showGachaMenu() });
  showLocationMenu(options, "技をセットする：誰にセットする？");
}

function showGachaEquipUnitMenu(member) {
  const ids = gachaEquipIds(member.unit);
  const options = ids.map((id, i) => {
    const entry = id ? gachaEntryById(id) : null;
    const label = entry ? `${gachaSkillName(entry)}（${gachaOwnedBreak(id)}凸）` : "（空き）";
    return { label: `枠${i + 1}：${label}`, action: () => showGachaEquipPickMenu(member, i) };
  });
  options.push({ label: "戻る", action: () => showGachaEquipMenu() });
  showLocationMenu(options, `${member.name}にセットする技（最大${GACHA_EQUIP_MAX}つ）`);
}

function showGachaEquipPickMenu(member, slot) {
  const g = gachaState();
  const ids = gachaEquipIds(member.unit);
  const otherId = ids[slot === 0 ? 1 : 0];
  const owned = Object.keys(g.owned).map(gachaEntryById).filter(e => e && e.id !== otherId);
  const options = owned.map(entry => {
    const costLabel = entry.costType === "shouryoku" ? `焦力${Math.round(Number(entry.shouryokuCost) || 0)}` : `SP${Math.round(Number(entry.spCost) || 0)}`;
    return {
      label: `【${gachaRarityLabel(gachaRarityOf(entry))}】${gachaSkillName(entry)}（${gachaOwnedBreak(entry.id)}凸・${costLabel}）`,
      action: () => { setGachaEquip(member.unit, slot, entry.id); showGachaEquipUnitMenu(member); }
    };
  });
  if (ids[slot]) options.push({ label: "この枠の技を外す", action: () => { setGachaEquip(member.unit, slot, null); showGachaEquipUnitMenu(member); } });
  options.push({ label: "戻る", action: () => showGachaEquipUnitMenu(member) });
  showLocationMenu(options, owned.length ? `枠${slot + 1}にセットする技を選ぶ` : "まだセットできる技を持っていない");
}

function setGachaEquip(unit, slot, id) {
  const ids = gachaEquipIds(unit);
  ids[slot] = id;
  unit.gachaEquip = ids;
}
