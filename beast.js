// beast.js
// ===================================================================
// ===== おとも魔獣（魔獣召喚で手に入れ、戦闘で一緒に戦う魔獣）のデータ処理 =====
// ===================================================================
// ★仕様（企画の決定事項）
//   ・戦闘中に一緒に戦う。仲間とは別枠で、1体だけセットできる。パーティの編成とは関係なく、いつでも付け替えられる
//   ・凸できる（最大5凸）。5凸で、パーティメンバーと同じか少し下の強さが目安
//   ・能力：エディタには「5凸（完成）のときの基本値と、1レベルごとの成長値」を登録する。
//     実際の能力＝（基本値＋成長値×(主人公のレベル−1)）×凸ごとの倍率（標準：60%→100%）×（1＋凸の強化・相性の効果の％）
//   ・相性：魔獣ごとに、相性の良い仲間（主人公も可）を登録する。その仲間がパーティにいると、効果が付く
//   ・おとも魔獣は自動で戦う（常時行動／連動）。★戦闘への組み込みは次の段階で、ここは「持つ・セットする・能力を計算する」まで
// ★データ
//   ・景品：scenarioProject.beasts（beast_editor.js）／設定：scenarioProject.summonConfig（魔獣召喚の設定）
//   ・プレイヤーの状態：player.summonGacha = { owned:{魔獣id:凸数}, pity, pulls }（gacha.js が管理）、player.beastEquip = セット中の魔獣id
//   ・魔獣1体の形：{ id, name, description, enabled, rarity, role, element, image,
//       baseStats:{maxHp,atk,skillPower,agi}, growthPerLevel:{...}, limitBreaks:[[{param,value}x3]x5],
//       affinities:[{ target:"player"|仲間id, bonuses:[{param,value}x3] }],
//       idleActions:[]（常時行動：次の段階）, links:[]（連動：次の段階） }

const BEAST_ROLES = [
  { key: "attack", label: "攻撃" },
  { key: "heal", label: "回復" },
  { key: "support", label: "支援" }
];
const BEAST_STATS = [
  { key: "maxHp", label: "HP" },
  { key: "atk", label: "攻撃" },
  { key: "skillPower", label: "魔力" },
  { key: "agi", label: "素早さ" }
];
// 凸の強化・相性で増やせるもの。value は「％」（その能力が何％増えるか。マイナスで減らせる）
// ★常時行動・連動の強化（威力・クールタイムなど）は、戦闘に組み込む次の段階で足す
const BEAST_PARAMS = BEAST_STATS.map(s => ({ key: s.key, label: `${s.label}（％）` }));
// 凸ごとの能力の倍率（％）。0凸〜5凸。設定「魔獣召喚」で変えられる
const BEAST_DEFAULT_MULTIPLIERS = [60, 68, 76, 84, 92, 100];

function beastEntries() { return gachaAllEntries("beast"); }
function beastEntryById(id) { return gachaEntryById(id, "beast"); }
function beastOwnedBreak(id) { return gachaOwnedBreak(id, "beast"); }
function beastRoleLabel(key) { const r = BEAST_ROLES.find(x => x.key === key); return r ? r.label : "攻撃"; }
function beastName(entry) { return gachaSkillName(entry); }

// 属性の名前（属性の登録が消えていたら「無」）
function beastElementName(entry) {
  if (!entry || !entry.element || entry.element === "無") return "無";
  const el = (typeof scenarioProject !== "undefined" && scenarioProject && Array.isArray(scenarioProject.elementDefs))
    ? scenarioProject.elementDefs.find(e => e.id === entry.element) : null;
  return el ? (el.name || "無") : "無";
}
function beastElementIcon(entry) {
  const el = (typeof scenarioProject !== "undefined" && scenarioProject && Array.isArray(scenarioProject.elementDefs) && entry)
    ? scenarioProject.elementDefs.find(e => e.id === entry.element) : null;
  return el && el.iconPath ? el.iconPath : "";
}

// 凸ごとの倍率（％）の6つ。設定が足りなければ標準の値で補う
function beastBreakMultipliers() {
  const saved = (typeof scenarioProject !== "undefined" && scenarioProject && scenarioProject.summonConfig && Array.isArray(scenarioProject.summonConfig.breakMultipliers))
    ? scenarioProject.summonConfig.breakMultipliers : [];
  return BEAST_DEFAULT_MULTIPLIERS.map((d, i) => {
    const n = Number(saved[i]);
    return (saved[i] === "" || saved[i] == null || !Number.isFinite(n)) ? d : Math.max(1, Math.min(1000, n));
  });
}

// ===== セット（1体だけ） =====
function getEquippedBeastId() {
  if (typeof player === "undefined" || !player || !player.beastEquip) return null;
  const id = player.beastEquip;
  return (beastEntryById(id) && beastOwnedBreak(id) >= 0) ? id : null;   // 登録が消えた・持っていない魔獣は外す
}
// セット中の魔獣。無ければ null。{ entry, breakCount }
function getEquippedBeast() {
  const id = getEquippedBeastId();
  return id ? { entry: beastEntryById(id), breakCount: beastOwnedBreak(id) } : null;
}
function setEquippedBeast(id) {
  if (typeof player === "undefined" || !player) return;
  player.beastEquip = id || null;
}

// ===== 相性 =====
// 魔獣の相性のうち、今のパーティで効くもの。target が "player" なら主人公（常に効く）、仲間のidなら、その仲間がパーティにいる時
function beastPartyHasMember(target) {
  if (target === "player") return true;
  if (typeof player === "undefined" || !player) return false;
  return (player.companions || []).some(c => c && c.companionId === target);
}
function beastTargetName(target) {
  if (target === "player") return "主人公";
  const master = (typeof COMPANION_MASTER !== "undefined" && COMPANION_MASTER) ? COMPANION_MASTER[target] : null;
  if (master && master.name) return master.name;
  const fromProject = (typeof scenarioProject !== "undefined" && scenarioProject && Array.isArray(scenarioProject.companions))
    ? scenarioProject.companions.find(c => c.id === target) : null;
  return fromProject ? (fromProject.name || target) : (target || "？");
}
// 相性の効果の文章：「攻撃＋10％／HP＋5％」
function beastBonusText(bonuses) {
  const parts = (Array.isArray(bonuses) ? bonuses : []).filter(b => b && BEAST_PARAMS.some(p => p.key === b.param) && Number(b.value))
    .map(b => {
      const def = BEAST_PARAMS.find(p => p.key === b.param);
      const v = Number(b.value);
      return `${def.label.replace("（％）", "")}${v > 0 ? "＋" : "−"}${Math.abs(v)}％`;
    });
  return parts.join("／");
}
// 相性の一覧。active＝今のパーティで効いているか
function beastAffinityList(entry) {
  return (Array.isArray(entry && entry.affinities) ? entry.affinities : []).filter(a => a && a.target).map(a => ({
    target: a.target, name: beastTargetName(a.target), active: beastPartyHasMember(a.target), text: beastBonusText(a.bonuses), bonuses: a.bonuses || []
  }));
}

// ===== 能力値 =====
// ％の足し合わせ（stat ごと）。凸の強化は「今の凸数まで」、相性は「今のパーティで効いているもの」
function beastBonusPercents(entry, breakCount, partyAffinities = true) {
  const pct = {};
  BEAST_STATS.forEach(s => { pct[s.key] = 0; });
  const add = (list) => (Array.isArray(list) ? list : []).slice(0, 3).forEach(b => {
    if (b && pct[b.param] != null) pct[b.param] += Number(b.value) || 0;
  });
  const table = Array.isArray(entry && entry.limitBreaks) ? entry.limitBreaks : [];
  for (let i = 0; i < Math.min(GACHA_MAX_BREAK, Math.max(0, breakCount)); i++) add(table[i]);
  if (partyAffinities) beastAffinityList(entry).filter(a => a.active).forEach(a => add(a.bonuses));
  return pct;
}
// 能力値。level＝主人公のレベル、breakCount＝凸数。戻り値：{ maxHp, atk, skillPower, agi }
function beastStatsAt(entry, level, breakCount, partyAffinities = true) {
  const base = (entry && entry.baseStats) || {}, growth = (entry && entry.growthPerLevel) || {};
  const n = Math.min(GACHA_MAX_BREAK, Math.max(0, Math.round(breakCount) || 0));
  const mult = beastBreakMultipliers()[n] / 100;
  const pct = beastBonusPercents(entry, n, partyAffinities);
  const lv = Math.max(1, Number(level) || 1);
  const stats = {};
  BEAST_STATS.forEach(s => {
    const raw = (Number(base[s.key]) || 0) + (Number(growth[s.key]) || 0) * (lv - 1);
    stats[s.key] = Math.max(s.key === "maxHp" ? 1 : 0, Math.round(raw * mult * (1 + pct[s.key] / 100)));
  });
  return stats;
}
// いまの主人公のレベル・その魔獣の凸数・今のパーティでの相性を反映した能力値
function beastCurrentStats(entry) {
  const lv = (typeof player !== "undefined" && player) ? player.level : 1;
  return beastStatsAt(entry, lv, Math.max(0, beastOwnedBreak(entry.id)), true);
}
function beastStatsText(stats) {
  return BEAST_STATS.map(s => `${s.label}${stats[s.key]}`).join("　");
}

// ===== 仮の見た目（画像は後から設定する。未設定の間は、属性マークとレア度の色の円＋名前の頭文字） =====
const BEAST_RARITY_COLORS = { N: "#8e5bd6", R: "#d04aa8", SR: "#ffc24a" };
function beastAvatarElement(entry, size = 48) {
  const wrap = document.createElement("span");
  wrap.className = "beast-avatar";
  wrap.style.width = wrap.style.height = `${size}px`;
  if (entry && entry.image) {
    const img = document.createElement("img");
    img.src = entry.image;
    img.alt = beastName(entry);
    img.onerror = () => { img.remove(); beastFillPlaceholder(wrap, entry, size); };
    wrap.appendChild(img);
  } else {
    beastFillPlaceholder(wrap, entry, size);
  }
  return wrap;
}
function beastFillPlaceholder(wrap, entry, size) {
  const color = BEAST_RARITY_COLORS[gachaRarityOf(entry)] || BEAST_RARITY_COLORS.N;
  wrap.classList.add("beast-avatar-placeholder");
  wrap.style.background = `radial-gradient(circle at 35% 30%, ${color}, #1a1024)`;
  wrap.style.borderColor = color;
  const initial = document.createElement("span");
  initial.className = "beast-avatar-initial";
  initial.style.fontSize = `${Math.round(size * 0.46)}px`;
  initial.textContent = (beastName(entry) || "？").replace(/^【[^】]*】/, "").charAt(0) || "？";
  wrap.appendChild(initial);
  const icon = beastElementIcon(entry);
  if (icon) {
    const mark = document.createElement("img");
    mark.className = "beast-avatar-element";
    mark.src = icon;
    mark.alt = "";
    mark.style.width = mark.style.height = `${Math.round(size * 0.36)}px`;
    mark.onerror = () => mark.remove();
    wrap.appendChild(mark);
  }
}
