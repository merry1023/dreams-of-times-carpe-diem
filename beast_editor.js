// beast_editor.js
// ===================================================================
// ===== シナリオエディタ「おとも魔獣」タブ =====
// ===================================================================
// ★2つの部分で出来ている
//   1) 魔獣召喚の設定（scenarioProject.summonConfig）：技ガチャと同じ項目（消費数・確率・天井・開催期間・ハズレ枠・5凸後の返却）
//      ＋「凸ごとの能力の倍率」。設定の部分は gacha_editor.js の gachaEditorBuildConfig を使い回している
//   2) おとも魔獣のデータ（scenarioProject.beasts）：名前・レア度・役割・属性・画像・能力（5凸＝完成時の値）・凸の強化・相性
// ★常時行動・連動の設定は、魔獣を戦闘に組み込む次の段階で足す（データの入れ物 idleActions / links は、すでに用意してある）
// ★中身を読んで動かすのは beast.js。画像は後から設定できる（未設定の間は、属性マークと名前の頭文字の円で代用）

function createNewBeast() {
  return {
    id: generateId("beast"), name: "新しい魔獣", description: "", enabled: true,
    rarity: "N", role: "attack", element: "無", image: "",
    baseStats: { maxHp: 40, atk: 10, skillPower: 8, agi: 6 },
    growthPerLevel: { maxHp: 5, atk: 0.9, skillPower: 0.8, agi: 0.3 },
    limitBreaks: [[], [], [], [], []],
    affinities: [],
    idleActions: [], links: []   // ★常時行動・連動（次の段階で、編集画面を足す）
  };
}

// 凸ごとの倍率の入れ物を用意する（足りない所は標準の値）
function beastEditorEnsureMultipliers(root) {
  if (!Array.isArray(root.breakMultipliers)) root.breakMultipliers = [];
  BEAST_DEFAULT_MULTIPLIERS.forEach((d, i) => { if (root.breakMultipliers[i] == null || root.breakMultipliers[i] === "") root.breakMultipliers[i] = d; });
}

function renderBeastManager(container) {
  if (!Array.isArray(scenarioProject.beasts)) scenarioProject.beasts = [];
  const persist = () => markScenarioBuildDirty();

  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "便利タブの「冒険者協会」アプリにある「魔獣召喚」の設定と、おとも魔獣のデータを作ります。おとも魔獣は、戦闘中に自動で一緒に戦います（仲間とは別枠で、1体だけセットできます）。手に入れた魔獣は、便利タブのアプリ「おとも魔獣」でセットします。ガチャ石は、技ガチャと同じ石を使います。";
  container.appendChild(introEl);

  // ===== 魔獣召喚の設定（技ガチャと共通の項目＋凸ごとの能力の倍率） =====
  gachaEditorBuildConfig(container, "beast", {
    showSkillLabel: false,
    extra: (info, root, tools) => {
      beastEditorEnsureMultipliers(root);
      const title = tools.addRow();
      const b = document.createElement("b");
      b.textContent = "凸ごとの能力の倍率（％）";
      title.appendChild(b);
      const row = tools.addRow();
      const multTools = tdEditorFieldTools(root.breakMultipliers, info, persist);
      for (let i = 0; i <= GACHA_MAX_BREAK; i++) multTools.numberField(row, i, `${i}凸`, 1, 1000, 1);
      const note = document.createElement("span");
      note.className = "devmode-note";
      note.textContent = "魔獣の能力は、「登録した値（5凸＝完成時）」にこの倍率をかけて決まります。標準は 60→68→76→84→92→100。5凸でパーティメンバーと同じか、少し下の強さになるよう、魔獣の能力を登録してください。";
      row.appendChild(note);
    }
  });

  // ===== おとも魔獣のデータ =====
  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋おとも魔獣を追加";
  addBtn.onclick = () => {
    pushUndoSnapshot();
    scenarioProject.beasts.push(createNewBeast());
    persist();
    renderScenarioBuildPanel();
  };
  container.appendChild(addBtn);
  const countNote = document.createElement("p");
  countNote.className = "devmode-note";
  const counts = GACHA_RARITIES.map(r => `${r.label}${scenarioProject.beasts.filter(e => gachaRarityOf(e) === r.key).length}体`).join("／");
  countNote.textContent = `登録中：${counts}（魔獣召喚で出るのは、「排出に含める」がオンの魔獣だけです）`;
  container.appendChild(countNote);

  const listEl = document.createElement("div");
  listEl.className = "scenariobuild-list";
  scenarioProject.beasts.forEach((entry, index) => listEl.appendChild(buildBeastRow(entry, index)));
  container.appendChild(listEl);
}

function buildBeastRow(entry, index) {
  const list = scenarioProject.beasts;
  const persist = () => markScenarioBuildDirty();
  // 足りない項目を埋める（古いデータや、手で書いたデータでも編集できるように）
  if (!entry.baseStats || typeof entry.baseStats !== "object") entry.baseStats = {};
  if (!entry.growthPerLevel || typeof entry.growthPerLevel !== "object") entry.growthPerLevel = {};
  if (!Array.isArray(entry.limitBreaks)) entry.limitBreaks = [];
  for (let i = 0; i < GACHA_MAX_BREAK; i++) if (!Array.isArray(entry.limitBreaks[i])) entry.limitBreaks[i] = [];
  if (!Array.isArray(entry.affinities)) entry.affinities = [];
  if (entry.enabled == null) entry.enabled = true;

  const row = document.createElement("div");
  row.className = "scenariobuild-chapter-row";
  const idEl = document.createElement("span");
  idEl.className = "scenariobuild-chapter-number";
  idEl.textContent = `#${index + 1}`;
  row.appendChild(idEl);
  const infoEl = document.createElement("div");
  infoEl.className = "scenariobuild-chapter-info";

  // --- 基本 ---
  const basicRow = document.createElement("div");
  basicRow.className = "scenariobuild-condition-row";
  buildSkillTextInput(entry, "name", "魔獣名", basicRow);
  infoEl.appendChild(basicRow);
  const descRow = document.createElement("div");
  descRow.className = "scenariobuild-condition-row";
  buildSkillTextInput(entry, "description", "説明", descRow);
  infoEl.appendChild(descRow);

  const tools = tdEditorFieldTools(entry, infoEl, persist);   // tower_defense_editor.js
  const r1 = tools.addRow();
  tools.selectField(r1, "rarity", "レア度", GACHA_RARITIES.map(r => ({ value: r.key, label: r.label })));
  tools.selectField(r1, "role", "役割", BEAST_ROLES.map(r => ({ value: r.key, label: r.label })));
  tools.selectField(r1, "element", "属性", [{ value: "無", label: "無" }].concat((scenarioProject.elementDefs || []).map(el => ({ value: el.id, label: el.name || "（無名）" }))));
  r1.appendChild(buildSkillCheckboxInline(entry, "enabled", "排出に含める"));
  const r2 = tools.addRow();
  tools.textField(r2, "image", "画像のパス（後から設定でOK）", "例：img/おとも魔獣/○○.png");
  const imgNote = document.createElement("span");
  imgNote.className = "devmode-note";
  imgNote.textContent = "未設定の間は、属性マークと名前の頭文字の円で代用します。";
  r2.appendChild(imgNote);

  // --- 能力 ---
  const statsDetails = document.createElement("details");
  statsDetails.className = "scenariobuild-skill-details";
  const statsSummary = document.createElement("summary");
  statsSummary.textContent = "能力（5凸＝完成時の値。実際の能力は、凸ごとの倍率がかかります）";
  statsDetails.appendChild(statsSummary);
  const baseTools = tdEditorFieldTools(entry.baseStats, statsDetails, persist);
  const growthTools = tdEditorFieldTools(entry.growthPerLevel, statsDetails, persist);
  const baseRow = baseTools.addRow();
  baseRow.appendChild(labelSpan("基本値（Lv1）："));
  BEAST_STATS.forEach(s => baseTools.numberField(baseRow, s.key, s.label, 0, 99999, 1));
  const growthRow = growthTools.addRow();
  growthRow.appendChild(labelSpan("1レベルごとの成長："));
  BEAST_STATS.forEach(s => growthTools.numberField(growthRow, s.key, s.label, 0, 9999, 0.1));
  // 目安：主人公のレベルごとの能力（0凸と5凸）。入力のたびに更新する
  const previewEl = document.createElement("p");
  previewEl.className = "devmode-note";
  previewEl.style.whiteSpace = "pre-wrap";
  const refreshPreview = () => {
    const lines = [1, 10, 20, 30].map(lv => {
      const s0 = beastStatsAt(entry, lv, 0, false), s5 = beastStatsAt(entry, lv, GACHA_MAX_BREAK, false);
      return `Lv${lv}：0凸 ${beastStatsText(s0)}　→　5凸 ${beastStatsText(s5)}`;
    });
    previewEl.textContent = `目安（凸の強化・相性は含まない。仲間と見比べて調整してください）\n${lines.join("\n")}`;
  };
  refreshPreview();
  statsDetails.appendChild(previewEl);
  statsDetails.addEventListener("change", refreshPreview);
  infoEl.appendChild(statsDetails);

  // --- 凸の強化 ---
  infoEl.appendChild(buildBeastBreakEditor(entry));
  // --- 相性 ---
  infoEl.appendChild(buildBeastAffinityEditor(entry));

  const laterNote = document.createElement("p");
  laterNote.className = "devmode-note";
  laterNote.style.margin = "4px 0 0";
  laterNote.textContent = "常時行動（毎ターンの自動行動）と連動（仲間の技に合わせて発動するボタン）の設定は、魔獣を戦闘に組み込む次の段階で追加します。";
  infoEl.appendChild(laterNote);
  row.appendChild(infoEl);

  // --- 並べ替え・削除 ---
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
      markScenarioBuildDirty(); renderScenarioBuildPanel();
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
    const ok = await showGameConfirm(`おとも魔獣「${entry.name || "名無し"}」を削除しますか？（すでに手に入れているプレイヤーのセーブデータでは、その魔獣は使えなくなります）`);
    if (!ok) return;
    pushUndoSnapshot();
    list.splice(index, 1);
    markScenarioBuildDirty(); renderScenarioBuildPanel();
  };
  buttonsEl.appendChild(delBtn);
  row.appendChild(buttonsEl);
  return row;
}

// 凸ごとの強化：1〜5凸ごとに、増えるパラメータを最大3つまで（値は％）
function buildBeastBreakEditor(entry) {
  const details = document.createElement("details");
  details.className = "scenariobuild-skill-details";
  const summary = document.createElement("summary");
  summary.textContent = `凸の強化（1凸ごとに、増えるパラメータを最大3つまで／最大${GACHA_MAX_BREAK}凸）`;
  details.appendChild(summary);
  const note = document.createElement("p");
  note.className = "devmode-note";
  note.textContent = "凸は積み上がります（3凸なら、1〜3凸の強化がすべて加わります）。値は「％」で、その能力が何％増えるかです（マイナスにもできます）。凸ごとの倍率（設定）とは別に、かかります。常時行動・連動の強化は、次の段階で選べるようになります。";
  details.appendChild(note);
  const options = [{ value: "", label: "（なし）" }].concat(BEAST_PARAMS.map(p => ({ value: p.key, label: p.label })));
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
      st.numberField(row, "value", "増加（％）", null, null, 1);
    });
    details.appendChild(row);
  }
  return details;
}

// 相性：相性の良い仲間（主人公も可）ごとに、その仲間がパーティにいる時の効果を最大3つまで
function buildBeastAffinityEditor(entry) {
  const details = document.createElement("details");
  details.className = "scenariobuild-skill-details";
  const summary = document.createElement("summary");
  summary.textContent = `相性（相性の良い仲間：${entry.affinities.length}人）`;
  details.appendChild(summary);
  const note = document.createElement("p");
  note.className = "devmode-note";
  note.textContent = "相性の良い仲間がパーティにいる戦闘で、効果が付きます（戦闘の開始時に判定し、その戦闘の間は固定）。「おとも魔獣をセット」の一覧に「◎ ○○と相性が良い」と出ます。ifブロックで使う変数「相性」は、連動の段階で追加します。";
  details.appendChild(note);
  const persist = () => markScenarioBuildDirty();
  const targetOptions = [{ value: "player", label: "主人公" }].concat((scenarioProject.companions || []).map(c => ({ value: c.id, label: c.name || c.id })));
  const options = [{ value: "", label: "（なし）" }].concat(BEAST_PARAMS.map(p => ({ value: p.key, label: p.label })));
  entry.affinities.forEach((aff, index) => {
    if (!Array.isArray(aff.bonuses)) aff.bonuses = [];
    while (aff.bonuses.length < 3) aff.bonuses.push({ param: "", value: 0 });
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    row.style.flexWrap = "wrap";
    const at = tdEditorFieldTools(aff, details, persist);
    at.selectField(row, "target", "相性の良い仲間", targetOptions);
    aff.bonuses.slice(0, 3).forEach((slot, j) => {
      if (!slot || typeof slot !== "object") { aff.bonuses[j] = { param: "", value: 0 }; slot = aff.bonuses[j]; }
      const st = tdEditorFieldTools(slot, details, persist);
      st.selectField(row, "param", `効果${j + 1}`, options);
      st.numberField(row, "value", "増加（％）", null, null, 1);
    });
    const del = document.createElement("button");
    del.className = "devmode-btn devmode-btn-danger";
    del.textContent = "削除";
    del.onclick = () => { pushUndoSnapshot(); entry.affinities.splice(index, 1); persist(); renderScenarioBuildPanel(); };
    row.appendChild(del);
    details.appendChild(row);
  });
  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋相性の良い仲間を足す";
  addBtn.onclick = () => {
    pushUndoSnapshot();
    entry.affinities.push({ target: "player", bonuses: [{ param: "", value: 0 }, { param: "", value: 0 }, { param: "", value: 0 }] });
    persist(); renderScenarioBuildPanel();
  };
  details.appendChild(addBtn);
  return details;
}
