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
