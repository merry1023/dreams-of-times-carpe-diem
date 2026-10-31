// gacha_editor.js
// ===================================================================
// ===== シナリオエディタ「技ガチャ」タブ =====
// ===================================================================
// ★2つの部分で出来ている
//   1) ガチャの設定（scenarioProject.gachaConfig）：消費数・確率・天井・開催期間・ハズレ枠・5凸後の返却
//   2) ガチャ専用の技（scenarioProject.gachaSkills）：編集のしかたは「上位スキル」と同じ（固定フィールド or ブロック）。
//      それに加えて「レア度」「消費はSPか焦力か」「排出に含めるか」「凸ごとの強化」を決める
// ★中身を読んで動かすのは gacha.js。ブロックのifでは、式の変数「凸数」で凸による分岐ができる（battle.js）。
//   使う入力部品は tower_defense_editor.js の tdEditorFieldTools と、scenariobuild.js の buildUpperSkillRow を使い回している

// 設定の入れ物を用意する（足りない項目は、標準の値で埋めて、画面に見えるようにする）
function gachaEditorEnsureRoot() {
  if (!scenarioProject.gachaConfig || typeof scenarioProject.gachaConfig !== "object" || Array.isArray(scenarioProject.gachaConfig)) scenarioProject.gachaConfig = {};
  const root = scenarioProject.gachaConfig;
  const cfg = gachaConfig();   // gacha.js（標準の値で補った設定）
  const fill = (obj, key, value) => { if (obj[key] == null || obj[key] === "") obj[key] = value; };
  ["name", "cost", "missRate", "pity", "dupGoldPercent", "dupGoldMin", "dupGoldMax"].forEach(k => fill(root, k, cfg[k]));
  if (!root.rates || typeof root.rates !== "object") root.rates = {};
  if (!root.dupStones || typeof root.dupStones !== "object") root.dupStones = {};
  GACHA_RARITIES.forEach(r => { fill(root.rates, r.key, cfg.rates[r.key]); fill(root.dupStones, r.key, cfg.dupStones[r.key]); });
  if (typeof root.startAt !== "string") root.startAt = "";
  if (typeof root.endAt !== "string") root.endAt = "";
  if (!Array.isArray(root.missPool)) root.missPool = [];
  return root;
}

function createNewGachaSkill() {
  return {
    id: generateId("gacha"), name: "新しいガチャ技", description: "", enabled: true,
    rarity: "N", costType: "sp", spCost: 8, shouryokuCost: 30,
    type: "attack", element: "無", power: 20, target: "single", hitCount: 1, atkType: "physical",
    cleanse: false,
    statusEffectKind: "", statusEffectChance: 1, statusEffectDuration: 1, statusEffectPower: 0,
    statusEffect2Kind: "", statusEffect2Chance: 1, statusEffect2Duration: 1, statusEffect2Power: 0,
    selfBuffKind: "", selfBuffDuration: 1, selfBuffPower: 0, selfBuffMode: "add",
    selfBuff2Kind: "", selfBuff2Duration: 1, selfBuff2Power: 0, selfBuff2Mode: "add",
    limitBreaks: [[], [], [], [], []],
    useBlocks: false, blocks: [], variables: {}
  };
}

// 日時を選ぶ欄（空なら制限なし）。値は "YYYY-MM-DDTHH:mm" の文字列で保存する
function gachaEditorDateField(row, obj, key, label, persist) {
  const wrap = document.createElement("span");
  wrap.className = "scenariobuild-inline-field";
  wrap.appendChild(labelSpan(`${label}：`));
  const input = document.createElement("input");
  input.type = "datetime-local";
  input.className = "scenariobuild-condition-input";
  input.value = obj[key] || "";
  input.onchange = () => { obj[key] = input.value || ""; persist(); };
  wrap.appendChild(input);
  const clearBtn = document.createElement("button");
  clearBtn.className = "devmode-btn";
  clearBtn.textContent = "指定なし";
  clearBtn.onclick = () => { obj[key] = ""; input.value = ""; persist(); };
  wrap.appendChild(clearBtn);
  row.appendChild(wrap);
}

function renderGachaManager(container) {
  const root = gachaEditorEnsureRoot();
  if (!Array.isArray(scenarioProject.gachaSkills)) scenarioProject.gachaSkills = [];
  const persist = () => markScenarioBuildDirty();

  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "冒険者協会の「技ガチャ」の設定と、ガチャ専用の技を作ります。ガチャ石は「掃討作戦の報酬」タブで決めた石を使います。ガチャ専用の技は職業に関係なく使え、通常スキルと上位スキルのどちらの動きも作れます（SPで使うか、焦力で使うかは、技ごとに決めます）。キャラ1人につき2つまでセットできます。";
  container.appendChild(introEl);

  // ===== ガチャの設定 =====
  const cfgRow = document.createElement("div");
  cfgRow.className = "scenariobuild-chapter-row";
  const cfgId = document.createElement("span"); cfgId.className = "scenariobuild-chapter-number"; cfgId.textContent = "設定";
  cfgRow.appendChild(cfgId);
  const info = document.createElement("div"); info.className = "scenariobuild-chapter-info";
  const tools = tdEditorFieldTools(root, info, persist);
  const ratesTools = tdEditorFieldTools(root.rates, info, persist);
  const dupTools = tdEditorFieldTools(root.dupStones, info, persist);

  const r1 = tools.addRow();
  tools.textField(r1, "name", "ガチャの名前", "技ガチャ");
  tools.numberField(r1, "cost", "1回に使うガチャ石の数", 1, 99999, 1);
  tools.numberField(r1, "pity", "天井（この回数で、スーパーレア確定。0で天井なし）", 0, 9999, 1);

  const r2 = tools.addRow();
  GACHA_RARITIES.forEach(r => ratesTools.numberField(r2, r.key, `${r.label}の確率（%）`, 0, 100, 1));
  tools.numberField(r2, "missRate", "ハズレ枠の確率（%）", 0, 100, 1);
  const rateNote = document.createElement("span");
  rateNote.className = "devmode-note";
  rateNote.textContent = "確率は、3つの合計を100%とした割合として使われます（例：70／25／5）。ハズレ枠は、ノーマルの確率の中から割り当てられます（ノーマルより大きくはできません）。";
  r2.appendChild(rateNote);

  const r3 = tools.addRow();
  gachaEditorDateField(r3, root, "startAt", "開催の開始", persist);
  gachaEditorDateField(r3, root, "endAt", "開催の終了", persist);
  const periodNote = document.createElement("span");
  periodNote.className = "devmode-note";
  periodNote.textContent = "実際の日時で判定します。期間外はガチャを引けません（手に入れた技は、期間外でも使えます）。両方「指定なし」なら、いつでも引けます。";
  r3.appendChild(periodNote);

  const dupTitle = tools.addRow();
  const dupB = document.createElement("b"); dupB.textContent = "5凸のあとに同じ技が出た時の返却";
  dupTitle.appendChild(dupB);
  const r4 = tools.addRow();
  GACHA_RARITIES.forEach(r => dupTools.numberField(r4, r.key, `ガチャ石（${r.label}）`, 0, 99999, 1));
  const r5 = tools.addRow();
  tools.numberField(r5, "dupGoldPercent", "陳：所持陳の何%か", 0, 100, 1);
  tools.numberField(r5, "dupGoldMin", "最低（陳）", 0, 999999999, 1000);
  tools.numberField(r5, "dupGoldMax", "最大（陳）", 0, 999999999, 1000);

  // ----- ハズレ枠の中身 -----
  const missTitle = tools.addRow();
  const missB = document.createElement("b"); missB.textContent = "ハズレ枠の中身（アイテムまたは陳。重みの割合で、どれかが出る）";
  missTitle.appendChild(missB);
  const itemOptions = (scenarioProject.items || []).map(it => ({ value: it.id, label: `${it.name}（${it.id}）` }));
  root.missPool.forEach((m, index) => {
    const mt = tdEditorFieldTools(m, info, persist);
    const mr = mt.addRow();
    const noEl = document.createElement("span"); noEl.className = "scenariobuild-chapter-number"; noEl.textContent = `#${index + 1}`; mr.appendChild(noEl);
    if (m.kind !== "gold") m.kind = "item";
    mt.selectField(mr, "kind", "種類", [{ value: "item", label: "アイテム" }, { value: "gold", label: "陳" }], () => renderScenarioBuildPanel());
    if (m.kind === "gold") {
      mt.numberField(mr, "amount", "陳の額", 0, 999999999, 100);
    } else {
      if (itemOptions.length > 0) mt.selectField(mr, "itemId", "アイテム", itemOptions);
      else mt.textField(mr, "itemId", "アイテムID", "例：herb_001");
      mt.numberField(mr, "count", "個数", 1, 999, 1);
    }
    mt.numberField(mr, "weight", "重み", 0, 99999, 1);
    const delBtn = document.createElement("button"); delBtn.className = "devmode-btn devmode-btn-danger"; delBtn.textContent = "削除";
    delBtn.onclick = () => { pushUndoSnapshot(); root.missPool.splice(index, 1); persist(); renderScenarioBuildPanel(); };
    mr.appendChild(delBtn);
  });
  const missAddRow = tools.addRow();
  const missAddBtn = document.createElement("button"); missAddBtn.className = "devmode-btn"; missAddBtn.textContent = "＋ハズレ枠の中身を足す";
  missAddBtn.onclick = () => {
    pushUndoSnapshot();
    root.missPool.push({ kind: "gold", itemId: "", count: 1, amount: 1000, weight: 1 });
    persist(); renderScenarioBuildPanel();
  };
  missAddRow.appendChild(missAddBtn);
  const missNote = document.createElement("span");
  missNote.className = "devmode-note";
  missNote.textContent = "何も登録しなかった場合、ハズレは1000陳になります。";
  missAddRow.appendChild(missNote);

  cfgRow.appendChild(info);
  container.appendChild(cfgRow);

  // ===== ガチャ専用の技 =====
  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋ガチャ技を追加";
  addBtn.onclick = () => {
    pushUndoSnapshot();
    scenarioProject.gachaSkills.push(createNewGachaSkill());
    persist();
    renderScenarioBuildPanel();
  };
  container.appendChild(addBtn);
  const countNote = document.createElement("p");
  countNote.className = "devmode-note";
  const counts = GACHA_RARITIES.map(r => `${r.label}${scenarioProject.gachaSkills.filter(e => gachaRarityOf(e) === r.key).length}個`).join("／");
  countNote.textContent = `登録中：${counts}（排出されるのは、「排出に含める」がオンの技だけです）`;
  container.appendChild(countNote);
  const formulaNoteEl = document.createElement("p");
  formulaNoteEl.className = "devmode-note";
  formulaNoteEl.textContent = "ダメージ計算式：(1＋自分のレベル×0.1) × 技の威力 ＋ 自分の攻撃力（魔法技なら魔力）×0.7 。";
  container.appendChild(formulaNoteEl);

  const listEl = document.createElement("div");
  listEl.className = "scenariobuild-list";
  scenarioProject.gachaSkills.forEach((entry, index) => {
    if (!Array.isArray(entry.limitBreaks)) entry.limitBreaks = [];
    for (let i = 0; i < GACHA_MAX_BREAK; i++) if (!Array.isArray(entry.limitBreaks[i])) entry.limitBreaks[i] = [];
    listEl.appendChild(buildUpperSkillRow(entry, index, {   // scenariobuild.js（上位スキルの編集の作りを使い回す）
      list: scenarioProject.gachaSkills,
      hideSources: true,
      buildTopRow: (infoEl) => gachaBuildTopRow(infoEl, entry),
      buildCostRow: (infoEl) => gachaBuildCostRow(infoEl, entry),
      appendExtra: (infoEl) => gachaBuildBreakEditor(infoEl, entry),
      deleteMessage: (e) => `ガチャ技「${e.name || "名無し"}」を削除しますか？（すでに手に入れているプレイヤーのセーブデータでは、その技は使えなくなります）`
    }));
  });
  container.appendChild(listEl);
}

// レア度・排出に含めるか
function gachaBuildTopRow(infoEl, entry) {
  const row = document.createElement("div");
  row.className = "scenariobuild-condition-row";
  row.appendChild(buildSkillSelectInline(entry, "rarity", "レア度", GACHA_RARITIES.map(r => ({ value: r.key, label: r.label }))));
  if (entry.enabled == null) entry.enabled = true;
  row.appendChild(buildSkillCheckboxInline(entry, "enabled", "排出に含める"));
  infoEl.appendChild(row);
}

// 消費：SPか焦力か（ブロックモードでも無視されないので、固定フィールドの枠の外に置く）
function gachaBuildCostRow(infoEl, entry) {
  const t = tdEditorFieldTools(entry, infoEl, () => markScenarioBuildDirty());
  const row = t.addRow();
  if (entry.costType !== "shouryoku") entry.costType = "sp";
  t.selectField(row, "costType", "消費するもの", [
    { value: "sp", label: "SP（通常スキルと同じ）" },
    { value: "shouryoku", label: "焦力（上位スキルと同じ）" }
  ], () => renderScenarioBuildPanel());
  if (entry.costType === "shouryoku") t.numberField(row, "shouryokuCost", "消費焦力（0〜100）", 0, 100, 1);
  else t.numberField(row, "spCost", "消費SP", 0, 9999, 1);
}

// 凸ごとの強化：1凸ごとに、増えるパラメータを最大3つまで
function gachaBuildBreakEditor(infoEl, entry) {
  const details = document.createElement("details");
  details.className = "scenariobuild-skill-details";
  const summary = document.createElement("summary");
  summary.textContent = `凸の強化（1凸ごとに、増えるパラメータを最大3つまで／最大${GACHA_MAX_BREAK}凸）`;
  details.appendChild(summary);
  const note = document.createElement("p");
  note.className = "devmode-note";
  note.textContent = "凸は積み上がります（3凸なら、1〜3凸の強化がすべて加わります）。増加量はマイナスにもできます（例：消費SPを−2）。ブロックで組んだ技では、ifブロックの式で「凸数」を使うと、凸数による分岐ができます（例：凸数 >= 3）。威力を増やすと、式の「技威力」にも反映されます。";
  details.appendChild(note);
  const options = [{ value: "", label: "（なし）" }].concat(GACHA_BREAK_PARAMS.map(p => ({ value: p.key, label: p.label })));
  const persist = () => markScenarioBuildDirty();
  for (let i = 0; i < GACHA_MAX_BREAK; i++) {
    const slots = entry.limitBreaks[i];
    while (slots.length < 3) slots.push({ param: "", value: 0 });
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    row.style.flexWrap = "wrap";
    row.appendChild(labelSpan(`${i + 1}凸：`));
    slots.slice(0, 3).forEach((slot, j) => {
      if (!slot || typeof slot !== "object") { slots[j] = { param: "", value: 0 }; slot = slots[j]; }
      const st = tdEditorFieldTools(slot, details, persist);
      st.selectField(row, "param", `強化${j + 1}`, options);
      st.numberField(row, "value", "増加量", null, null, 0.1);
    });
    details.appendChild(row);
  }
  infoEl.appendChild(details);
}
