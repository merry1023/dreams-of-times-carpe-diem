// tower_defense_editor.js
// ===================================================================
// ===== シナリオエディタ「タワーユニット」タブ（冒険者協会・迎撃モードのユニット登録） =====
// ===================================================================
// ★登録したユニットは scenarioProject.towerUnits に入り、tower_defense.js の迎撃モードで使われる。
//   1つも登録しない（または全部「無効」にする）と、これまで通り「属性ごとに1ユニット」を自動で作る。
// ★scenariobuild.js の共通部品（scenarioProject / pushUndoSnapshot / markScenarioBuildDirty / renderScenarioBuildPanel /
//   labelSpan / generateId / showGameConfirm）をそのまま使う。

const TD_EDITOR_ROLE_OPTIONS = [
  { value: "single",  label: "単体（1体ずつ攻撃）" },
  { value: "area",    label: "範囲（まとめて攻撃）" },
  { value: "slow",    label: "遅延（攻撃して足を遅くする）" },
  { value: "support", label: "サポート（近くの味方の攻撃力を上げる）" }
];
const TD_EDITOR_TARGETING_OPTIONS = [
  { value: "near", label: "射程内で一番近い敵" },
  { value: "far",  label: "射程内で一番遠い敵" },
  { value: "all",  label: "射程内の全ての敵" }
];

function createNewTowerUnit() {
  const firstElement = (scenarioProject.elementDefs && scenarioProject.elementDefs[0]) ? scenarioProject.elementDefs[0].id : "無";
  return {
    id: generateId("towerunit"), name: "新しいユニット", enabled: true,
    element: firstElement, role: "single", targeting: "near",
    power: 22, range: 140, interval: 0.8, cost: 50,
    slowPercent: 50, slowSec: 1.5,   // 遅延：足の速さを何%下げるか／何秒続けるか
    supportPercent: 25,              // サポート：近くの味方の攻撃力を何%上げるか
    imagePath: ""
  };
}

function renderTowerUnitManager(container) {
  if (!Array.isArray(scenarioProject.towerUnits)) scenarioProject.towerUnits = [];
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "冒険者協会「掃討作戦」の迎撃モードで、プレイヤーが購入して配置するユニットを登録します。1つも登録しない（または全部「無効」にする）と、属性管理の属性ごとに1ユニットを自動で作ります。攻撃力は「出てくる敵の平均HPに対する割合（%）」で、敵のデータが変わってもバランスが崩れにくくなっています。";
  container.appendChild(introEl);

  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋ユニットを追加";
  addBtn.onclick = () => {
    pushUndoSnapshot();
    scenarioProject.towerUnits.push(createNewTowerUnit());
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  container.appendChild(addBtn);

  // ★最初の叩き台：今の自動生成と同じユニットをそのまま登録する（そこから名前・数値を直していける）
  const seedBtn = document.createElement("button");
  seedBtn.className = "devmode-btn";
  seedBtn.textContent = "標準のユニットを登録する（属性ごとに1つ＋サポート1つ）";
  seedBtn.disabled = scenarioProject.towerUnits.length > 0 || typeof tdBuildDefaultUnitData !== "function";
  seedBtn.title = scenarioProject.towerUnits.length > 0 ? "すでに登録があるため使えません（先に全部削除してください）" : "";
  seedBtn.onclick = () => {
    pushUndoSnapshot();
    scenarioProject.towerUnits = tdBuildDefaultUnitData();
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  container.appendChild(seedBtn);

  if (scenarioProject.towerUnits.length === 0) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "devmode-note";
    emptyEl.textContent = "まだ登録がありません（このままだと、属性ごとに1ユニットを自動で作ります）。";
    container.appendChild(emptyEl);
  }
  scenarioProject.towerUnits.forEach((unit, index) => container.appendChild(buildTowerUnitRow(unit, index)));
}

// 入力欄の部品（名前・数値・選択）。unit のキーに直接書き込み、変更したら persist を呼ぶ
function tdEditorFieldTools(unit, infoEl, persist) {
  const addRow = () => { const r = document.createElement("div"); r.className = "scenariobuild-condition-row"; infoEl.appendChild(r); return r; };
  const textField = (r, key, label, placeholder) => {
    const wrap = document.createElement("span");
    wrap.className = "scenariobuild-inline-field";
    wrap.appendChild(labelSpan(`${label}：`));
    const input = document.createElement("input");
    input.type = "text"; input.className = "scenariobuild-title-input";
    input.value = unit[key] != null ? unit[key] : "";
    if (placeholder) input.placeholder = placeholder;
    input.onchange = () => { unit[key] = input.value; persist(); };
    wrap.appendChild(input);
    r.appendChild(wrap);
  };
  const numberField = (r, key, label, min, max, step) => {
    const wrap = document.createElement("span");
    wrap.className = "scenariobuild-inline-field";
    wrap.appendChild(labelSpan(`${label}：`));
    const input = document.createElement("input");
    input.type = "number"; input.className = "scenariobuild-condition-input";
    if (min != null) input.min = min;
    if (max != null) input.max = max;
    if (step != null) input.step = step;
    input.value = unit[key] != null ? unit[key] : "";
    input.onchange = () => {
      let v = Number(input.value);
      if (!Number.isFinite(v)) v = 0;
      if (min != null) v = Math.max(min, v);
      if (max != null) v = Math.min(max, v);
      unit[key] = v; input.value = v; persist();
    };
    wrap.appendChild(input);
    r.appendChild(wrap);
  };
  const selectField = (r, key, label, options, onAfter) => {
    const wrap = document.createElement("span");
    wrap.className = "scenariobuild-inline-field";
    wrap.appendChild(labelSpan(`${label}：`));
    const select = document.createElement("select");
    select.className = "scenariobuild-title-input";
    options.forEach(opt => {
      const o = document.createElement("option");
      o.value = opt.value; o.textContent = opt.label;
      select.appendChild(o);
    });
    select.value = unit[key] != null ? unit[key] : options[0].value;
    select.onchange = () => { unit[key] = select.value; persist(); if (onAfter) onAfter(); };
    wrap.appendChild(select);
    r.appendChild(wrap);
  };
  return { addRow, textField, numberField, selectField };
}

function buildTowerUnitRow(unit, index) {
  const list = scenarioProject.towerUnits;
  const persist = () => markScenarioBuildDirty();
  const row = document.createElement("div");
  row.className = "scenariobuild-chapter-row";
  const idEl = document.createElement("span");
  idEl.className = "scenariobuild-chapter-number";
  idEl.textContent = `#${index + 1}`;
  row.appendChild(idEl);
  const infoEl = document.createElement("div");
  infoEl.className = "scenariobuild-chapter-info";

  const { addRow, textField, numberField, selectField } = tdEditorFieldTools(unit, infoEl, persist);

  const r1 = addRow();
  textField(r1, "name", "名前", "例：炎の弓兵");
  const enabledLabel = document.createElement("label");
  enabledLabel.style.cursor = "pointer";
  const enabledCheckbox = document.createElement("input");
  enabledCheckbox.type = "checkbox";
  enabledCheckbox.checked = unit.enabled !== false;
  enabledCheckbox.onchange = () => { unit.enabled = enabledCheckbox.checked; persist(); };
  enabledLabel.appendChild(enabledCheckbox);
  enabledLabel.appendChild(document.createTextNode(" 有効（オフ＝迎撃モードに出さない）"));
  r1.appendChild(enabledLabel);

  const r2 = addRow();
  const elementOptions = [{ value: "無", label: "（属性なし）" }].concat((scenarioProject.elementDefs || []).map(el => ({ value: el.id, label: el.name || "（無名）" })));
  selectField(r2, "element", "属性", elementOptions);
  selectField(r2, "role", "役割", TD_EDITOR_ROLE_OPTIONS, () => renderScenarioBuildPanel());

  if (unit.role !== "support") {
    const r3 = addRow();
    if (unit.role === "area") {
      const fixedNote = document.createElement("span");
      fixedNote.className = "devmode-note";
      fixedNote.textContent = "攻撃対象：射程内の全ての敵（範囲は固定）";
      r3.appendChild(fixedNote);
    } else {
      selectField(r3, "targeting", "攻撃対象", TD_EDITOR_TARGETING_OPTIONS);
    }
    numberField(r3, "power", "攻撃力（敵の平均HPに対する%）", 1, 500, 1);
  }
  const r4 = addRow();
  numberField(r4, "range", "射程", 20, 400, 5);
  if (unit.role !== "support") numberField(r4, "interval", "攻撃間隔（秒）", 0.2, 10, 0.1);
  numberField(r4, "cost", "購入価格", 1, 99999, 1);

  if (unit.role === "slow") {
    const r5 = addRow();
    numberField(r5, "slowPercent", "足の速さを下げる（%）", 1, 95, 1);
    numberField(r5, "slowSec", "続く時間（秒）", 0.2, 10, 0.1);
  }
  if (unit.role === "support") {
    const r5 = addRow();
    numberField(r5, "supportPercent", "近くの味方の攻撃力を上げる（%）", 1, 300, 1);
    const noteEl = document.createElement("span");
    noteEl.className = "devmode-note";
    noteEl.textContent = "射程の中にいる味方ユニットが対象です。サポート自身は攻撃せず、コンボの履歴にも入りません。";
    r5.appendChild(noteEl);
  }
  const r6 = addRow();
  textField(r6, "imagePath", "画像のパス（空なら役割の文字で表示）", "例：img/ユニット/弓兵.png");
  row.appendChild(infoEl);

  const buttonsEl = document.createElement("div");
  buttonsEl.className = "scenariobuild-chapter-buttons";
  const moveBtn = (text, disabled, delta) => {
    const b = document.createElement("button");
    b.className = "devmode-btn";
    b.textContent = text; b.disabled = disabled;
    b.onclick = (event) => {
      event.stopPropagation();
      pushUndoSnapshot();
      [list[index + delta], list[index]] = [list[index], list[index + delta]];
      persist(); renderScenarioBuildPanel();
    };
    buttonsEl.appendChild(b);
  };
  moveBtn("↑ 上へ", index === 0, -1);
  moveBtn("↓ 下へ", index === list.length - 1, 1);
  const delBtn = document.createElement("button");
  delBtn.className = "devmode-btn devmode-btn-danger";
  delBtn.textContent = "削除";
  delBtn.onclick = async (event) => {
    event.stopPropagation();
    const ok = await showGameConfirm(`タワーユニット「${unit.name || "名無し"}」を削除しますか？`);
    if (!ok) return;
    pushUndoSnapshot();
    list.splice(index, 1);
    persist(); renderScenarioBuildPanel();
  };
  buttonsEl.appendChild(delBtn);
  row.appendChild(buttonsEl);
  return row;
}

// ===================================================================
// ===== 「出撃キャラ」タブ（冒険者協会・出撃モード＝攻める側で送り込むキャラの登録） =====
// ===================================================================
// ★登録したキャラは scenarioProject.raidUnits に入り、tower_raid.js の出撃モードで使われる。
//   1つも登録しない（または全部「無効」にする）と、本編のキャラ（主人公・仲間など）から自動で編成を作る。
//   出撃に連れていけるのは最大8体。8体より多く登録すると、出撃前に選べる。
const TR_EDITOR_SKILL_KIND_OPTIONS = [
  { value: "single", label: "単体攻撃（一番近い敵に大ダメージ）" },
  { value: "all",    label: "全体攻撃（近くの敵全員にダメージ）" },
  { value: "heal",   label: "味方全員を回復" }
];

function createNewRaidUnit() {
  const firstElement = (scenarioProject.elementDefs && scenarioProject.elementDefs[0]) ? scenarioProject.elementDefs[0].id : "無";
  return {
    id: generateId("raidunit"), name: "新しいキャラ", enabled: true, baseType: "custom", baseId: "",
    element: firstElement, hp: 50, atk: 12, range: 80, interval: 1, speed: 45,
    skillKind: "single", skillName: "必殺技", skillElement: firstElement, skillPower: 250, skillCooldown: 8,
    cost: { funds: 100, food: 0, exp: 0, stone: 0, drink: 0 },   // 出撃に必要なリソース（0＝使わない）
    imagePath: ""
  };
}

function renderRaidUnitManager(container) {
  if (!Array.isArray(scenarioProject.raidUnits)) scenarioProject.raidUnits = [];
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "冒険者協会「掃討作戦」の出撃モード（攻める側）で、プレイヤーが送り込むキャラ（手札のカード）を登録します。カードごとに「出撃コスト」を、5種類のリソース（出撃資金・食料・出撃経験値・魔力石・赤まむしドリンク♂）の組み合わせで自由に決められます。本編のキャラ（仲間・登場キャラ）を元にしても、自由に作っても構いません（仲間以外のキャラも追加できます）。ここで決めるステータスは出撃モード専用で、本編の強さには影響しません。1つも登録しない（または全部「無効」にする）と、主人公・仲間などから自動で編成します。出撃の手札は最大8枚です（8枚より多く登録すると、出撃前に選べます）。";
  container.appendChild(introEl);

  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋キャラを追加";
  addBtn.onclick = () => {
    pushUndoSnapshot();
    scenarioProject.raidUnits.push(createNewRaidUnit());
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  container.appendChild(addBtn);

  const seedBtn = document.createElement("button");
  seedBtn.className = "devmode-btn";
  seedBtn.textContent = "標準の編成を登録する（主人公・仲間などから自動で作る）";
  seedBtn.disabled = scenarioProject.raidUnits.length > 0 || typeof trBuildDefaultRaidData !== "function";
  seedBtn.title = scenarioProject.raidUnits.length > 0 ? "すでに登録があるため使えません（先に全部削除してください）" : "";
  seedBtn.onclick = () => {
    pushUndoSnapshot();
    scenarioProject.raidUnits = trBuildDefaultRaidData();
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  container.appendChild(seedBtn);

  if (scenarioProject.raidUnits.length === 0) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "devmode-note";
    emptyEl.textContent = "まだ登録がありません（このままだと、主人公・仲間などから自動で編成します）。";
    container.appendChild(emptyEl);
  }
  scenarioProject.raidUnits.forEach((unit, index) => container.appendChild(buildRaidUnitRow(unit, index)));
}

// 「元にするキャラ」の選択肢：自由入力／仲間／本編の登場キャラ
function tdRaidBaseOptions() {
  const options = [{ value: "custom:", label: "（自由に作る）" }];
  (scenarioProject.companions || []).forEach(c => options.push({ value: `companion:${c.id}`, label: `仲間：${c.name}` }));
  (scenarioProject.characters || []).forEach(c => options.push({ value: `character:${c.id}`, label: `登場キャラ：${c.name}` }));
  return options;
}

function buildRaidUnitRow(unit, index) {
  const list = scenarioProject.raidUnits;
  const persist = () => markScenarioBuildDirty();
  const row = document.createElement("div");
  row.className = "scenariobuild-chapter-row";
  const idEl = document.createElement("span");
  idEl.className = "scenariobuild-chapter-number";
  idEl.textContent = `#${index + 1}`;
  row.appendChild(idEl);
  const infoEl = document.createElement("div");
  infoEl.className = "scenariobuild-chapter-info";
  const { addRow, textField, numberField, selectField } = tdEditorFieldTools(unit, infoEl, persist);

  // 元にするキャラ：選ぶと、名前（空か、前の元キャラの名前のままなら）と、仲間ならHP・攻撃力を入れる
  const r0 = addRow();
  const baseWrap = document.createElement("span");
  baseWrap.className = "scenariobuild-inline-field";
  baseWrap.appendChild(labelSpan("元にするキャラ："));
  const baseSelect = document.createElement("select");
  baseSelect.className = "scenariobuild-title-input";
  const baseOptions = tdRaidBaseOptions();
  baseOptions.forEach(opt => { const o = document.createElement("option"); o.value = opt.value; o.textContent = opt.label; baseSelect.appendChild(o); });
  baseSelect.value = `${unit.baseType || "custom"}:${unit.baseId || ""}`;
  if (!baseOptions.some(o => o.value === baseSelect.value)) baseSelect.value = "custom:";
  baseSelect.onchange = () => {
    const [type, ...rest] = baseSelect.value.split(":");
    const id = rest.join(":");
    const prevList = unit.baseType === "companion" ? (scenarioProject.companions || []) : (unit.baseType === "character" ? (scenarioProject.characters || []) : []);
    const prev = prevList.find(c => c.id === unit.baseId);
    unit.baseType = type; unit.baseId = id;
    const nextList = type === "companion" ? (scenarioProject.companions || []) : (type === "character" ? (scenarioProject.characters || []) : []);
    const next = nextList.find(c => c.id === id);
    if (next && (!unit.name || unit.name === "新しいキャラ" || (prev && unit.name === prev.name))) unit.name = next.name;
    if (type === "companion" && next && next.baseStats) {
      unit.hp = Number(next.baseStats.maxHp) || unit.hp;
      unit.atk = Number(next.baseStats.atk) || unit.atk;
    }
    persist(); renderScenarioBuildPanel();
  };
  baseWrap.appendChild(baseSelect);
  r0.appendChild(baseWrap);

  const r1 = addRow();
  textField(r1, "name", "名前", "例：ケツァナ");
  const enabledLabel = document.createElement("label");
  enabledLabel.style.cursor = "pointer";
  const enabledCheckbox = document.createElement("input");
  enabledCheckbox.type = "checkbox";
  enabledCheckbox.checked = unit.enabled !== false;
  enabledCheckbox.onchange = () => { unit.enabled = enabledCheckbox.checked; persist(); };
  enabledLabel.appendChild(enabledCheckbox);
  enabledLabel.appendChild(document.createTextNode(" 有効（オフ＝出撃メンバーに出さない）"));
  r1.appendChild(enabledLabel);

  const elementOptions = [{ value: "無", label: "（属性なし）" }].concat((scenarioProject.elementDefs || []).map(el => ({ value: el.id, label: el.name || "（無名）" })));
  const r2 = addRow();
  selectField(r2, "element", "属性", elementOptions);
  numberField(r2, "hp", "HP", 1, 99999, 1);
  numberField(r2, "atk", "攻撃力", 0, 99999, 1);

  const r3 = addRow();
  numberField(r3, "range", "射程（70以上）", 70, 400, 5);
  numberField(r3, "interval", "攻撃間隔（秒）", 0.2, 10, 0.1);
  numberField(r3, "speed", "移動速度", 5, 200, 1);

  const r4 = addRow();
  selectField(r4, "skillKind", "スキル", TR_EDITOR_SKILL_KIND_OPTIONS);
  textField(r4, "skillName", "スキル名", "例：渾身の一撃");
  const r5 = addRow();
  selectField(r5, "skillElement", "スキルの属性", elementOptions);
  numberField(r5, "skillPower", unit.skillKind === "heal" ? "威力（味方の最大HPに対する%）" : "威力（攻撃力に対する%）", 1, 2000, 1);
  numberField(r5, "skillCooldown", "クールタイム（秒）", 1, 120, 1);

  // 出撃コスト：5種類のリソースを自由に組み合わせられる（0＝そのリソースは使わない）
  if (!unit.cost || typeof unit.cost !== "object") unit.cost = { funds: 100 };
  const rc = addRow();
  rc.appendChild(labelSpan("出撃コスト（0＝使わない）："));
  (typeof TR_RESOURCES !== "undefined" ? TR_RESOURCES : []).forEach(res => {
    const wrap = document.createElement("span");
    wrap.className = "scenariobuild-inline-field";
    wrap.appendChild(labelSpan(`${res.label}：`));
    const input = document.createElement("input");
    input.type = "number"; input.className = "scenariobuild-condition-input"; input.min = 0; input.max = 9999; input.step = 1;
    input.value = unit.cost[res.key] != null ? unit.cost[res.key] : 0;
    input.onchange = () => {
      let v = Math.round(Number(input.value));
      if (!Number.isFinite(v) || v < 0) v = 0;
      unit.cost[res.key] = Math.min(9999, v); input.value = unit.cost[res.key]; persist();
    };
    wrap.appendChild(input);
    rc.appendChild(wrap);
  });

  const r6 = addRow();
  textField(r6, "imagePath", "画像のパス（空なら名前の1文字で表示）", "例：img/キャラ/ケツァナ.png");
  row.appendChild(infoEl);

  const buttonsEl = document.createElement("div");
  buttonsEl.className = "scenariobuild-chapter-buttons";
  const moveBtn = (text, disabled, delta) => {
    const b = document.createElement("button");
    b.className = "devmode-btn";
    b.textContent = text; b.disabled = disabled;
    b.onclick = (event) => {
      event.stopPropagation();
      pushUndoSnapshot();
      [list[index + delta], list[index]] = [list[index], list[index + delta]];
      persist(); renderScenarioBuildPanel();
    };
    buttonsEl.appendChild(b);
  };
  moveBtn("↑ 上へ", index === 0, -1);
  moveBtn("↓ 下へ", index === list.length - 1, 1);
  const delBtn = document.createElement("button");
  delBtn.className = "devmode-btn devmode-btn-danger";
  delBtn.textContent = "削除";
  delBtn.onclick = async (event) => {
    event.stopPropagation();
    const ok = await showGameConfirm(`出撃キャラ「${unit.name || "名無し"}」を削除しますか？`);
    if (!ok) return;
    pushUndoSnapshot();
    list.splice(index, 1);
    persist(); renderScenarioBuildPanel();
  };
  buttonsEl.appendChild(delBtn);
  row.appendChild(buttonsEl);
  return row;
}

// ===================================================================
// ===== 「掃討作戦の報酬」タブ（クリア報酬の陳・ガチャ石・アイテムの設定） =====
// ===================================================================
// ★設定は scenarioProject.guildRewards に入り、tower_rewards.js がクリア時の報酬の計算に使う。
//   何も設定しなければ、標準の値（tower_rewards.js の TD_REWARD_DEFAULTS）で動く。
//   倒した魔物にもともと登録されているドロップ（アイテムと確率）は、標準で報酬に加わる（下のチェックでオフにできる）。
const TD_REWARD_MODES = [
  { key: "defense", label: "迎撃モード（守る側）" },
  { key: "raid",    label: "出撃モード（攻める側）" }
];

// 設定の入れ物を用意する（足りない数値は、標準の値で埋めて見えるようにする）
function tdEnsureRewardRoot() {
  if (!scenarioProject.guildRewards || typeof scenarioProject.guildRewards !== "object") scenarioProject.guildRewards = {};
  const root = scenarioProject.guildRewards;
  TD_REWARD_MODES.forEach(m => {
    if (!root[m.key] || typeof root[m.key] !== "object") root[m.key] = {};
    if (!Array.isArray(root[m.key].items)) root[m.key].items = [];
    const cfg = tdGetRewardConfig(m.key);
    ["goldBase", "goldPerKill", "stageGrowth", "stonesBase", "stonesPerBoss"].forEach(k => {
      if (!Number.isFinite(Number(root[m.key][k])) || root[m.key][k] === "" || root[m.key][k] == null) root[m.key][k] = cfg[k];
    });
  });
  return root;
}

function renderGuildRewardManager(container) {
  const root = tdEnsureRewardRoot();
  const persist = () => markScenarioBuildDirty();
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "冒険者協会「掃討作戦」をクリアした時にもらえる報酬を設定します。陳（お金）・ガチャ石（仮）・アイテムを、迎撃モードと出撃モードで別々に決められます。協会ポイント（事前強化に使う）は、ウェーブ数と中ボスの数で決まります。";
  container.appendChild(introEl);

  // ----- 全体の設定 -----
  const common = document.createElement("div");
  common.className = "scenariobuild-chapter-row";
  const commonId = document.createElement("span"); commonId.className = "scenariobuild-chapter-number"; commonId.textContent = "全体";
  common.appendChild(commonId);
  const commonInfo = document.createElement("div"); commonInfo.className = "scenariobuild-chapter-info";
  const ct = tdEditorFieldTools(root, commonInfo, persist);
  const cr1 = ct.addRow();
  const dropLabel = document.createElement("label");
  dropLabel.style.cursor = "pointer";
  const dropCheck = document.createElement("input");
  dropCheck.type = "checkbox";
  dropCheck.checked = root.useMonsterDrops !== false;
  dropCheck.onchange = () => { root.useMonsterDrops = dropCheck.checked; persist(); };
  dropLabel.appendChild(dropCheck);
  dropLabel.appendChild(document.createTextNode(" 倒した魔物に登録されているドロップ（アイテムと確率）も、報酬に加える"));
  cr1.appendChild(dropLabel);
  const cr2 = ct.addRow();
  ct.textField(cr2, "gachaStoneName", "ガチャ石の名前（仮）", "ガチャ石");
  const stoneNote = document.createElement("span");
  stoneNote.className = "devmode-note";
  stoneNote.textContent = "今後追加予定の「技ガチャ」で使う石です。今は、手に入れて持っておけるだけです（所持数は player.gachaStones）。";
  cr2.appendChild(stoneNote);
  common.appendChild(commonInfo);
  container.appendChild(common);

  // ----- モードごとの設定 -----
  TD_REWARD_MODES.forEach(mode => {
    const cfg = root[mode.key];
    const row = document.createElement("div");
    row.className = "scenariobuild-chapter-row";
    const idEl = document.createElement("span"); idEl.className = "scenariobuild-chapter-number"; idEl.textContent = mode.key === "defense" ? "迎撃" : "出撃";
    row.appendChild(idEl);
    const info = document.createElement("div"); info.className = "scenariobuild-chapter-info";
    const tools = tdEditorFieldTools(cfg, info, persist);
    const titleRow = tools.addRow();
    const title = document.createElement("b"); title.textContent = `${mode.label}のクリア報酬`;
    titleRow.appendChild(title);
    const r1 = tools.addRow();
    tools.numberField(r1, "goldBase", "基本の陳", 0, 9999999, 10);
    tools.numberField(r1, "goldPerKill", "倒した敵1体ごとの陳", 0, 99999, 1);
    tools.numberField(r1, "stageGrowth", "次のステージごとの増加（%）", 0, 1000, 1);
    const r2 = tools.addRow();
    tools.numberField(r2, "stonesBase", `${tdGachaStoneName()}（クリア時）`, 0, 99999, 1);
    tools.numberField(r2, "stonesPerBoss", `${tdGachaStoneName()}（ボスを倒すごとに追加）`, 0, 99999, 1);

    const itemsTitleRow = tools.addRow();
    const itemsTitle = document.createElement("b"); itemsTitle.textContent = "追加アイテム（クリア時に、確率で判定して渡す）";
    itemsTitleRow.appendChild(itemsTitle);
    const itemOptions = (scenarioProject.items || []).map(it => ({ value: it.id, label: `${it.name}（${it.id}）` }));
    cfg.items.forEach((item, index) => {
      const it = tdEditorFieldTools(item, info, persist);
      const ir = it.addRow();
      const noEl = document.createElement("span"); noEl.className = "scenariobuild-chapter-number"; noEl.textContent = `#${index + 1}`; ir.appendChild(noEl);
      if (itemOptions.length > 0) it.selectField(ir, "itemId", "アイテム", itemOptions);
      else it.textField(ir, "itemId", "アイテムID", "例：herb_001");
      it.numberField(ir, "chance", "確率（%）", 0, 100, 1);
      it.numberField(ir, "min", "最小個数", 1, 999, 1);
      it.numberField(ir, "max", "最大個数", 1, 999, 1);
      const bossLabel = document.createElement("label"); bossLabel.style.cursor = "pointer";
      const bossCheck = document.createElement("input"); bossCheck.type = "checkbox"; bossCheck.checked = !!item.perBoss;
      bossCheck.onchange = () => { item.perBoss = bossCheck.checked; persist(); };
      bossLabel.appendChild(bossCheck); bossLabel.appendChild(document.createTextNode(" ボスを倒した数だけ判定"));
      ir.appendChild(bossLabel);
      const delBtn = document.createElement("button"); delBtn.className = "devmode-btn devmode-btn-danger"; delBtn.textContent = "削除";
      delBtn.onclick = () => { pushUndoSnapshot(); cfg.items.splice(index, 1); persist(); renderScenarioBuildPanel(); };
      ir.appendChild(delBtn);
    });
    const addRow = tools.addRow();
    const addBtn = document.createElement("button"); addBtn.className = "devmode-btn"; addBtn.textContent = "＋追加アイテムを足す";
    addBtn.onclick = () => {
      pushUndoSnapshot();
      cfg.items.push({ itemId: itemOptions.length > 0 ? itemOptions[0].value : "", chance: 100, min: 1, max: 1, perBoss: false });
      persist(); renderScenarioBuildPanel();
    };
    addRow.appendChild(addBtn);
    row.appendChild(info);
    container.appendChild(row);
  });
}
