// ===== ステータスパネル（要望対応） =====
//   職業ごと（主人公）・仲間ごとに用意された9×9のマス目の盤。中心の「基本パネル」から、斜めを含む8方向に
//   隣接したマスだけを、コスト（アイテム・経験値）を払って順に解放していく。
//   マスの効果＝ステータスの割合/固定値アップ・新しい技の習得・状態異常耐性。
//   ★経験値をコストにすると経験値が減り、それに応じてレベル・ステータスも下がる。
//     解放したマスの効果は解放した瞬間から有効で、同じレベルに戻ると、その分だけ上乗せされた状態になる。
//   盤の中身は、シナリオエディタの「ステータスパネル」タブ（scenarioProject.statusPanels）で作る：
//     { classes: { "職業名": { cells: { "行,列": cell } } }, companions: { "仲間id": { cells: {...} } } }
//     cell = { label?, effects: [{ kind: "stat", stat, mode: "flat"|"percent", value } | { kind: "skill", className, skillName }
//                              | { kind: "statusResist", value }], costExp, costItems: [{ itemId, count }] }
//   進行（解放済みマス）は、主人公は player.panelUnlocked[職業名]、仲間は companion.panelUnlocked に["行,列", ...]で持つ
const STATUS_PANEL_SIZE = 9;
const STATUS_PANEL_CENTER = 4; // 中心マス（行・列とも4）＝基本パネル。最初から解放済み
const STATUS_PANEL_CENTER_KEY = `${STATUS_PANEL_CENTER},${STATUS_PANEL_CENTER}`;
const STATUS_PANEL_STAT_DEFS = [
  { key: "atk", label: "物理攻撃力", short: "物攻" },
  { key: "skillPower", label: "魔法攻撃力", short: "魔攻" },
  { key: "agi", label: "素早さ", short: "素早" },
  { key: "luck", label: "運", short: "運" },
  { key: "charm", label: "魅力", short: "魅力" },
  { key: "maxHp", label: "最大HP", short: "HP" },
  { key: "maxSp", label: "最大SP", short: "SP" }
];

// ===== データ参照 =====
function getStatusPanelDefFor(unit, ownerType) {
  if (!unit || typeof scenarioProject === "undefined" || !scenarioProject.statusPanels) return null;
  const root = scenarioProject.statusPanels;
  if (ownerType === "class") return (root.classes && root.classes[unit.class]) || null;
  return (root.companions && root.companions[unit.companionId]) || null;
}

function getPanelUnlockedListFor(unit, ownerType) {
  if (!unit) return [];
  if (ownerType === "class") return (unit.panelUnlocked && unit.panelUnlocked[unit.class]) || [];
  return Array.isArray(unit.panelUnlocked) ? unit.panelUnlocked : [];
}

function ensurePanelUnlockedListFor(unit, ownerType) {
  if (ownerType === "class") {
    if (!unit.panelUnlocked || typeof unit.panelUnlocked !== "object" || Array.isArray(unit.panelUnlocked)) unit.panelUnlocked = {};
    if (!Array.isArray(unit.panelUnlocked[unit.class])) unit.panelUnlocked[unit.class] = [];
    return unit.panelUnlocked[unit.class];
  }
  if (!Array.isArray(unit.panelUnlocked)) unit.panelUnlocked = [];
  return unit.panelUnlocked;
}

// ★解放済みのマス全部の効果を合計する（中心の基本パネルは常に解放済み扱い）
function computePanelTotalsFor(unit, ownerType) {
  const totals = { flat: {}, pct: {}, skillRefs: [], statusResist: 0 };
  const def = getStatusPanelDefFor(unit, ownerType);
  if (!def || !def.cells) return totals;
  const keys = new Set(getPanelUnlockedListFor(unit, ownerType));
  keys.add(STATUS_PANEL_CENTER_KEY);
  keys.forEach(key => {
    const cell = def.cells[key];
    if (!cell || !Array.isArray(cell.effects)) return;
    cell.effects.forEach(effect => {
      if (!effect) return;
      if (effect.kind === "stat" && effect.stat) {
        const bucket = effect.mode === "percent" ? totals.pct : totals.flat;
        bucket[effect.stat] = (bucket[effect.stat] || 0) + (Number(effect.value) || 0);
      } else if (effect.kind === "skill" && effect.skillName) {
        totals.skillRefs.push({ className: effect.className, skillName: effect.skillName });
      } else if (effect.kind === "statusResist") {
        totals.statusResist += Number(effect.value) || 0;
      }
    });
  });
  return totals;
}

// ★ステータスへの上乗せ量。割合アップは「基礎値（レベルで決まる素の値）の％を加算」
function getPanelBonusFor(unit, ownerType) {
  const result = { atk: 0, agi: 0, skillPower: 0, luck: 0, charm: 0, maxHp: 0, maxSp: 0 };
  if (!unit) return result;
  const totals = computePanelTotalsFor(unit, ownerType);
  const hasAny = Object.keys(totals.flat).length > 0 || Object.keys(totals.pct).length > 0;
  if (!hasAny) return result;
  let base = {};
  if (ownerType === "class") {
    const cls = (typeof CLASS_MASTER !== "undefined") ? CLASS_MASTER[unit.class] : null;
    const growth = (cls && cls.growthPerLevel) || {};
    base = {
      atk: unit.stats.atk, agi: unit.stats.agi, skillPower: unit.stats.skillPower, luck: unit.stats.luck, charm: unit.stats.charm,
      maxHp: ((cls && cls.baseStats.maxHp) || 0) + getCumulativeGrowth(growth, unit.level, "maxHp"),
      maxSp: ((cls && cls.baseStats.maxSp) || 0) + getCumulativeGrowth(growth, unit.level, "maxSp")
    };
  } else {
    const master = getCompanionMaster(unit);
    base = master ? getCompanionStatsAtLevel(master, unit.level) : {};
  }
  STATUS_PANEL_STAT_DEFS.forEach(def => {
    const key = def.key;
    result[key] = (totals.flat[key] || 0) + Math.round((base[key] || 0) * (totals.pct[key] || 0) / 100);
  });
  return result;
}

function getPlayerPanelStatusResist() {
  if (typeof player === "undefined" || !player) return 0;
  return Math.min(100, computePanelTotalsFor(player, "class").statusResist);
}

// ★最大HP・最大SPは、他の最大値と同じくgaugesの中に直接入っているので、前回上乗せした量（panelGaugeApplied）との
//   差分だけを反映する。何度呼んでも結果は同じになる（レベル変動・職業変更・ロードの後に呼ぶ）
function syncPanelGauges(unit, ownerType) {
  if (!unit || !unit.gauges) return;
  const bonus = getPanelBonusFor(unit, ownerType);
  const applied = unit.panelGaugeApplied || { maxHp: 0, maxSp: 0 };
  [["maxHp", "hp"], ["maxSp", "sp"]].forEach(([bonusKey, gaugeKey]) => {
    const gauge = unit.gauges[gaugeKey];
    if (!gauge) return;
    const delta = (bonus[bonusKey] || 0) - (applied[bonusKey] || 0);
    if (!delta) return;
    gauge.max = Math.max(gaugeKey === "hp" ? 1 : 0, gauge.max + delta);
    if (delta > 0) gauge.current += delta; // 増えた分は現在値も一緒に増やす（レベルアップと同じ）
    gauge.current = Math.min(gauge.current, gauge.max);
  });
  unit.panelGaugeApplied = { maxHp: bonus.maxHp || 0, maxSp: bonus.maxSp || 0 };
}

function syncAllPanelGauges() {
  if (typeof player === "undefined" || !player) return;
  syncPanelGauges(player, "class");
  (player.companions || []).forEach(c => syncPanelGauges(c, "companion"));
}

// ===== 新しい技 =====
function getPanelGrantedSkills(unit, ownerType) {
  if (typeof CLASS_SKILLS === "undefined") return [];
  const totals = computePanelTotalsFor(unit, ownerType);
  const result = [];
  totals.skillRefs.forEach(ref => {
    const list = CLASS_SKILLS[ref.className] || [];
    const skill = list.find(s => s.name === ref.skillName);
    if (skill && !result.includes(skill)) result.push(skill);
  });
  return result;
}

function isPanelGrantedSkill(unit, ownerType, skill) {
  return getPanelGrantedSkills(unit, ownerType).includes(skill);
}

// ===== コスト =====
function getPanelCellCost(cell) {
  const exp = Math.max(0, Math.floor(Number(cell && cell.costExp) || 0));
  const items = ((cell && cell.costItems) || []).filter(i => i && i.itemId && Number(i.count) > 0)
    .map(i => ({ itemId: i.itemId, count: Math.floor(Number(i.count)) }));
  return { exp, items };
}

function getPanelItemName(itemId) {
  const data = (typeof ITEM_MASTER !== "undefined") ? ITEM_MASTER[itemId] : null;
  return (data && data.name) || itemId;
}

// ★経験値を払った後のレベル・経験値を計算する（払えなければnull）。レベル上限があればそれを超えない
function calcPanelExpSpendResult(unit, cost) {
  const effective = calcTotalExpForLevel(unit.level, expNeededForLevel) + Math.max(0, Number(unit.exp) || 0);
  if (effective < cost) return null;
  const remaining = effective - cost;
  let result = calcLevelFromTotalExp(remaining, expNeededForLevel);
  if (player && player.levelCap && result.level > player.levelCap) {
    result = { level: player.levelCap, exp: remaining - calcTotalExpForLevel(player.levelCap, expNeededForLevel) };
  }
  return { level: result.level, exp: Math.max(0, result.exp), effective };
}

function clampUnitGaugesAfterLevelChange(unit) {
  if (!unit || !unit.gauges) return;
  Object.keys(unit.gauges).forEach(key => {
    const gauge = unit.gauges[key];
    if (!gauge) return;
    gauge.max = Math.max(key === "hp" ? 1 : 0, gauge.max);
    const floor = (key === "hp" && gauge.current > 0) ? 1 : 0; // 生きている人は、レベルが下がってもHPが0にならないようにする
    gauge.current = Math.max(floor, Math.min(gauge.current, gauge.max));
  });
}

function applyPanelExpSpend(unit, ownerType, cost, result) {
  const previousLevel = unit.level;
  if (ownerType === "class") {
    unit.level = result.level;
    unit.exp = result.exp;
    if (!unit.classTotalExp) unit.classTotalExp = {};
    unit.classTotalExp[unit.class] = Math.max(0, (unit.classTotalExp[unit.class] || 0) - cost);
    if (!unit.classLevels) unit.classLevels = {};
    unit.classLevels[unit.class] = result.level;
    if (result.level !== previousLevel) applyLevelUpGrowth(previousLevel, result.level); // ★下がる方向でも、累計の差分で減らせる
  } else {
    const master = getCompanionMaster(unit);
    if (master && result.level !== previousLevel) {
      const oldStats = getCompanionStatsAtLevel(master, previousLevel);
      const newStats = getCompanionStatsAtLevel(master, result.level);
      unit.gauges.hp.max += newStats.maxHp - oldStats.maxHp;
      unit.gauges.sp.max += newStats.maxSp - oldStats.maxSp;
      unit.gauges.hp.current += newStats.maxHp - oldStats.maxHp;
      unit.gauges.sp.current += newStats.maxSp - oldStats.maxSp;
    }
    unit.level = result.level;
    unit.exp = result.exp;
    unit.totalExp = Math.max(0, (unit.totalExp || 0) - cost);
  }
  clampUnitGaugesAfterLevelChange(unit);
}

// ===== 解放 =====
function isPanelCellUnlocked(unit, ownerType, key) {
  return key === STATUS_PANEL_CENTER_KEY || getPanelUnlockedListFor(unit, ownerType).includes(key);
}

// ★解放済みマス（中心含む）のどれかに、斜めを含む8方向で隣接していれば、解放できる位置にある
function isPanelCellAdjacentToUnlocked(unit, ownerType, row, col) {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr, c = col + dc;
      if (r < 0 || c < 0 || r >= STATUS_PANEL_SIZE || c >= STATUS_PANEL_SIZE) continue;
      if (isPanelCellUnlocked(unit, ownerType, `${r},${c}`)) return true;
    }
  }
  return false;
}

// @returns {{ok:boolean, reason?:string}}
function checkPanelCellUnlockable(unit, ownerType, row, col) {
  const def = getStatusPanelDefFor(unit, ownerType);
  const key = `${row},${col}`;
  const cell = def && def.cells && def.cells[key];
  if (!cell) return { ok: false, reason: "ここにはマスがない" };
  if (isPanelCellUnlocked(unit, ownerType, key)) return { ok: false, reason: "解放済み" };
  if (!isPanelCellAdjacentToUnlocked(unit, ownerType, row, col)) return { ok: false, reason: "解放済みのマスに隣接していない" };
  const cost = getPanelCellCost(cell);
  for (const item of cost.items) {
    if (getItemCount(item.itemId) < item.count) return { ok: false, reason: `${getPanelItemName(item.itemId)}が足りない` };
  }
  if (cost.exp > 0 && !calcPanelExpSpendResult(unit, cost.exp)) return { ok: false, reason: "経験値が足りない" };
  return { ok: true };
}

// @returns {{success:boolean, message:string}}
function unlockPanelCell(unit, ownerType, row, col) {
  const check = checkPanelCellUnlockable(unit, ownerType, row, col);
  if (!check.ok) return { success: false, message: check.reason };
  const key = `${row},${col}`;
  const cell = getStatusPanelDefFor(unit, ownerType).cells[key];
  const cost = getPanelCellCost(cell);
  cost.items.forEach(item => removeItem(item.itemId, item.count));
  if (cost.exp > 0) applyPanelExpSpend(unit, ownerType, cost.exp, calcPanelExpSpendResult(unit, cost.exp));
  ensurePanelUnlockedListFor(unit, ownerType).push(key);
  syncPanelGauges(unit, ownerType); // 最大HP/SPの上乗せ（レベルが下がった時の割合分の変化も含めて）
  if (typeof renderStatusHUD === "function") renderStatusHUD();
  return { success: true, message: "パネルを解放した！" };
}

// ===== 表示用の文章 =====
function describePanelEffect(effect) {
  if (!effect) return "";
  if (effect.kind === "stat") {
    const def = STATUS_PANEL_STAT_DEFS.find(d => d.key === effect.stat);
    const name = def ? def.label : effect.stat;
    return effect.mode === "percent" ? `${name} +${effect.value}%（基礎値に対して）` : `${name} +${effect.value}`;
  }
  if (effect.kind === "skill") return `新しい技「${effect.skillName}」を習得`;
  if (effect.kind === "statusResist") return `状態異常耐性 +${effect.value}%（かかる確率が下がる）`;
  return "";
}

function summarizePanelCell(cell) {
  if (cell.label) return { top: cell.label, bottom: "" };
  const effects = cell.effects || [];
  if (effects.length === 0) return { top: "−", bottom: "" };
  const first = effects[0];
  let top = "", bottom = "";
  if (first.kind === "stat") {
    const def = STATUS_PANEL_STAT_DEFS.find(d => d.key === first.stat);
    top = def ? def.short : first.stat;
    bottom = first.mode === "percent" ? `+${first.value}%` : `+${first.value}`;
  } else if (first.kind === "skill") {
    top = "技"; bottom = "";
  } else if (first.kind === "statusResist") {
    top = "耐性"; bottom = `+${first.value}%`;
  }
  if (effects.length > 1) bottom = bottom ? `${bottom}…` : "…";
  return { top, bottom };
}

// ===== プレイ画面のタブ =====
let statusPanelOwnerIndex = 0; // 0＝主人公、1以降＝パーティーの仲間
let statusPanelCursorRow = STATUS_PANEL_CENTER;
let statusPanelCursorCol = STATUS_PANEL_CENTER;

function getStatusPanelOwners() {
  if (typeof player === "undefined" || !player) return [];
  const owners = [{ type: "class", unit: player, name: `主人公（${player.class}）` }];
  (player.companions || []).forEach(c => {
    const master = getCompanionMaster(c);
    owners.push({ type: "companion", unit: c, name: master ? master.name : "仲間" });
  });
  return owners;
}

function renderStatusPanelTab() {
  const root = document.getElementById("statuspanel-root");
  if (!root) return;
  root.innerHTML = "";
  const owners = getStatusPanelOwners();
  if (owners.length === 0) return;
  if (statusPanelOwnerIndex >= owners.length) statusPanelOwnerIndex = 0;
  const owner = owners[statusPanelOwnerIndex];
  const unit = owner.unit;
  const def = getStatusPanelDefFor(unit, owner.type);

  // 誰のパネルかを切り替えるボタン
  const ownerRow = document.createElement("div");
  ownerRow.className = "statuspanel-owner-row";
  owners.forEach((o, i) => {
    const btn = document.createElement("button");
    btn.className = "statuspanel-owner-btn" + (i === statusPanelOwnerIndex ? " active" : "");
    btn.textContent = o.name;
    btn.onclick = (event) => {
      event.stopPropagation();
      statusPanelOwnerIndex = i;
      statusPanelCursorRow = STATUS_PANEL_CENTER;
      statusPanelCursorCol = STATUS_PANEL_CENTER;
      renderStatusPanelTab();
    };
    ownerRow.appendChild(btn);
  });
  root.appendChild(ownerRow);

  const effectiveExp = calcTotalExpForLevel(unit.level, expNeededForLevel) + Math.max(0, Number(unit.exp) || 0);
  const infoEl = document.createElement("div");
  infoEl.className = "statuspanel-info";
  infoEl.textContent = `Lv.${unit.level} ／ 使える経験値：${effectiveExp}`;
  root.appendChild(infoEl);

  if (!def || !def.cells || Object.keys(def.cells).length === 0) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "statuspanel-empty";
    emptyEl.textContent = "このパネルはまだ用意されていない。";
    root.appendChild(emptyEl);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "statuspanel-grid";
  for (let r = 0; r < STATUS_PANEL_SIZE; r++) {
    for (let c = 0; c < STATUS_PANEL_SIZE; c++) {
      const key = `${r},${c}`;
      const cell = def.cells[key];
      const el = document.createElement("button");
      let cls = "statuspanel-cell";
      if (!cell) {
        cls += " empty";
      } else {
        const unlocked = isPanelCellUnlocked(unit, owner.type, key);
        const adjacent = isPanelCellAdjacentToUnlocked(unit, owner.type, r, c);
        cls += unlocked ? " unlocked" : (adjacent ? " available" : " locked");
        if (key === STATUS_PANEL_CENTER_KEY) cls += " center";
        const summary = summarizePanelCell(cell);
        const topEl = document.createElement("span");
        topEl.className = "statuspanel-cell-top";
        topEl.textContent = (key === STATUS_PANEL_CENTER_KEY && !cell.label && (cell.effects || []).length === 0) ? "基本" : summary.top;
        el.appendChild(topEl);
        if (summary.bottom) {
          const bottomEl = document.createElement("span");
          bottomEl.className = "statuspanel-cell-bottom";
          bottomEl.textContent = summary.bottom;
          el.appendChild(bottomEl);
        }
      }
      if (r === statusPanelCursorRow && c === statusPanelCursorCol) cls += " cursor";
      el.className = cls;
      el.onclick = (event) => {
        event.stopPropagation();
        statusPanelCursorRow = r;
        statusPanelCursorCol = c;
        renderStatusPanelTab();
      };
      grid.appendChild(el);
    }
  }
  root.appendChild(grid);

  root.appendChild(buildStatusPanelDetail(owner, def));
}

function buildStatusPanelDetail(owner, def) {
  const unit = owner.unit;
  const key = `${statusPanelCursorRow},${statusPanelCursorCol}`;
  const cell = def.cells[key];
  const box = document.createElement("div");
  box.className = "statuspanel-detail";
  if (!cell) {
    box.textContent = "（マスなし）";
    return box;
  }
  const isCenter = key === STATUS_PANEL_CENTER_KEY;
  const unlocked = isPanelCellUnlocked(unit, owner.type, key);

  const titleEl = document.createElement("div");
  titleEl.className = "statuspanel-detail-title";
  titleEl.textContent = (isCenter ? "基本パネル" : "パネル") + (unlocked ? "（解放済み）" : "");
  box.appendChild(titleEl);

  const effects = cell.effects || [];
  if (effects.length === 0) {
    const noneEl = document.createElement("div");
    noneEl.textContent = "効果：なし（つなぎのマス）";
    box.appendChild(noneEl);
  }
  effects.forEach(effect => {
    const line = document.createElement("div");
    line.className = "statuspanel-detail-effect";
    line.textContent = "・" + describePanelEffect(effect);
    box.appendChild(line);
  });

  if (!unlocked) {
    const cost = getPanelCellCost(cell);
    const costEl = document.createElement("div");
    costEl.className = "statuspanel-detail-cost";
    const parts = [];
    if (cost.exp > 0) parts.push(`経験値 ${cost.exp}`);
    cost.items.forEach(i => parts.push(`${getPanelItemName(i.itemId)} ×${i.count}（所持${getItemCount(i.itemId)}）`));
    costEl.textContent = "コスト：" + (parts.length ? parts.join("、") : "なし");
    box.appendChild(costEl);

    const check = checkPanelCellUnlockable(unit, owner.type, statusPanelCursorRow, statusPanelCursorCol);
    const btn = document.createElement("button");
    btn.className = "statuspanel-unlock-btn";
    btn.textContent = check.ok ? "解放する" : `解放できない（${check.reason}）`;
    btn.disabled = !check.ok;
    btn.onclick = (event) => { event.stopPropagation(); tryUnlockStatusPanelCellWithConfirm(); };
    box.appendChild(btn);
  }
  return box;
}

async function tryUnlockStatusPanelCellWithConfirm() {
  const owners = getStatusPanelOwners();
  const owner = owners[statusPanelOwnerIndex];
  if (!owner) return;
  const check = checkPanelCellUnlockable(owner.unit, owner.type, statusPanelCursorRow, statusPanelCursorCol);
  if (!check.ok) return;
  const cell = getStatusPanelDefFor(owner.unit, owner.type).cells[`${statusPanelCursorRow},${statusPanelCursorCol}`];
  const cost = getPanelCellCost(cell);
  // ★経験値を払うとレベルが下がるので、実行前に必ず確認する（解放は元に戻せない）
  let message = "このパネルを解放しますか？（解放は元に戻せません）";
  if (cost.exp > 0) {
    const result = calcPanelExpSpendResult(owner.unit, cost.exp);
    message = `経験値${cost.exp}を消費して解放します。` + (result && result.level !== owner.unit.level ? `レベルが${owner.unit.level}から${result.level}に下がります。` : "") + "（解放は元に戻せません）よろしいですか？";
  }
  const ok = (typeof showGameConfirm === "function") ? await showGameConfirm(message) : true;
  if (!ok) return;
  const result = unlockPanelCell(owner.unit, owner.type, statusPanelCursorRow, statusPanelCursorCol);
  if (!result.success && typeof displayMessage === "function") await displayMessage(result.message, { allowSubFocus: true });
  renderStatusPanelTab();
}

window.addEventListener("keydown", (event) => {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return;
  if (typeof isGameDialogOpen !== "undefined" && isGameDialogOpen) return;
  if (typeof controlFocus !== "undefined" && controlFocus !== "sub") return;
  const activeTab = document.querySelector(".tab-content.active");
  if (!activeTab || activeTab.id !== "tab-statuspanel") return;
  const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  if (moves[event.key]) {
    event.preventDefault();
    event.stopImmediatePropagation();
    statusPanelCursorRow = Math.max(0, Math.min(STATUS_PANEL_SIZE - 1, statusPanelCursorRow + moves[event.key][0]));
    statusPanelCursorCol = Math.max(0, Math.min(STATUS_PANEL_SIZE - 1, statusPanelCursorCol + moves[event.key][1]));
    renderStatusPanelTab();
  } else if (KEY_CONFIG.decideKeys.includes(event.key)) {
    if (typeof isTextDisplaying !== "undefined" && isTextDisplaying) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    tryUnlockStatusPanelCellWithConfirm();
  }
});
