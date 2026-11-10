// beast_editor.js
// ===================================================================
// ===== シナリオエディタ「おとも魔獣」タブ =====
// ===================================================================
// ★2つの部分で出来ている
//   1) 魔獣召喚の設定（scenarioProject.summonConfig）：技ガチャと同じ項目（消費数・確率・天井・開催期間・ハズレ枠・5凸後の返却）
//      ＋「凸ごとの能力の倍率」。設定の部分は gacha_editor.js の gachaEditorBuildConfig を使い回している
//   2) おとも魔獣のデータ（scenarioProject.beasts）：名前・レア度・役割・属性・画像・能力（5凸＝完成時の値）・凸の強化・相性
// ★常時行動（idleActions）は、技の編集画面（固定項目／ブロック）を使い回して作る。連動（links）も同じ作り
// ★中身を読んで動かすのは beast.js。画像は後から設定できる（未設定の間は、属性マークと名前の頭文字の円で代用）

function createNewBeast() {
  return {
    id: generateId("beast"), name: "新しい魔獣", description: "", enabled: true,
    rarity: "N", role: "attack", element: "無", image: "",
    baseStats: { maxHp: 40, atk: 10, skillPower: 8, agi: 6 },
    growthPerLevel: { maxHp: 5, atk: 0.9, skillPower: 0.8, agi: 0.3 },
    limitBreaks: [[], [], [], [], []],
    affinities: [],
    idleActions: [],   // 常時行動の候補（最大3つ）。それぞれが「技のデータ＋重み・クールタイム・使える条件」
    links: [],         // 連動（最大3つ）。技のデータ＋きっかけ・使った人・クールタイム・解放される凸
    linkMaxPerTurn: 1  // 1ターンの連動の発動回数の上限
  };
}

const BEAST_IDLE_ACTION_MAX = 3;
const BEAST_LINK_MAX = 3;

// 常時行動の候補を1つ新しく作る（技の入れ物は、ガチャ技と同じ。ガチャ専用の項目だけ外す）
function createNewBeastIdleAction() {
  const base = createNewGachaSkill();   // gacha_editor.js
  ["rarity", "costType", "spCost", "shouryokuCost", "limitBreaks"].forEach(k => delete base[k]);
  return Object.assign(base, {
    id: generateId("beastact"), name: "新しい行動", description: "",
    weight: 1, cooldown: 0, condition: "",
    type: "attack", element: "無", power: 15, target: "single", hitCount: 1, atkType: "physical"
  });
}

// ブロックエディタ（技の編集画面）が、編集中の技を探す時に使う（scenariobuild.js の getEditingSkill から呼ぶ）
function beastEditorFindIdleAction(id) {
  for (const beast of (scenarioProject.beasts || [])) {
    const found = (beast.idleActions || []).find(a => a && a.id === id) || (beast.links || []).find(a => a && a.id === id);
    if (found) return found;
  }
  return null;
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
    scenarioBuildGroupOpenState[scenarioBuildGroupKey("beasts", "N")] = true; // ★追加した魔獣（初期は「通常」）がすぐ見えるよう、そのカーテンを開く
    persist();
    renderScenarioBuildPanel();
  };
  container.appendChild(addBtn);
  const countNote = document.createElement("p");
  countNote.className = "devmode-note";
  const counts = GACHA_RARITIES.map(r => `${r.label}${scenarioProject.beasts.filter(e => gachaRarityOf(e) === r.key).length}体`).join("／");
  countNote.textContent = `登録中：${counts}（魔獣召喚で出るのは、「排出に含める」がオンの魔獣だけです）`;
  container.appendChild(countNote);

  // ★要望対応：レア度（通常／希少／伝説）ごとのカーテンに分けて表示する
  const rarityGroups = GACHA_RARITIES.map(r => ({
    key: r.key, label: r.label, showEmpty: true,
    entries: scenarioProject.beasts.map((item, index) => ({ item, index })).filter(e => gachaRarityOf(e.item) === r.key)
  }));
  container.appendChild(buildGroupedCurtainList("beasts", rarityGroups, (entry, index) => buildCollapsedEntryRow({
    number: `#${index + 1}`,
    title: () => (scenarioProject.beasts[index] || {}).name,
    isValid: () => !!scenarioProject.beasts[index],
    build: () => buildBeastRow(scenarioProject.beasts[index], index)
  })));
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

  // --- 常時行動 ---
  infoEl.appendChild(buildBeastIdleActionEditor(entry));
  infoEl.appendChild(buildBeastLinkEditor(entry));
  // --- 凸の強化 ---
  infoEl.appendChild(buildBeastBreakEditor(entry));
  // --- 相性 ---
  infoEl.appendChild(buildBeastAffinityEditor(entry));

  const laterNote = document.createElement("p");
  laterNote.className = "devmode-note";
  laterNote.style.margin = "4px 0 0";
  laterNote.textContent = "連動（仲間の技に合わせて発動するボタン）の設定は、次の段階で追加します。";
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
  note.textContent = "相性の良い仲間がパーティにいる戦闘で、効果が付きます（戦闘の開始時に判定し、その戦闘の間は固定）。「おとも魔獣をセット」の一覧に「◎ ○○と相性が良い」と出ます。ifブロックでは、変数「相性」（相性の良い仲間がパーティにいれば1、いなければ0）が使えます。";
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

// 常時行動：魔獣が毎ターン（主人公・仲間の行動がすべて終わったあと、敵のターンの前に）1回、自動で行動する。
// 行動の候補を最大3つ登録し、クールタイムが明けていて「使える条件」を満たす候補から、重みに応じてランダムに選ぶ。
// 使える候補が無ければ通常攻撃。1つ1つの候補は、技の編集画面（固定項目／ブロック）で作る
function buildBeastIdleActionEditor(entry) {
  if (!Array.isArray(entry.idleActions)) entry.idleActions = [];
  const details = document.createElement("details");
  details.className = "scenariobuild-skill-details";
  const summary = document.createElement("summary");
  summary.textContent = `常時行動（毎ターンの自動行動：${entry.idleActions.length}／${BEAST_IDLE_ACTION_MAX}）`;
  details.appendChild(summary);
  const note = document.createElement("p");
  note.className = "devmode-note";
  note.style.whiteSpace = "pre-wrap";
  note.textContent = [
    "魔獣は、毎ターン、主人公・仲間の行動がすべて終わったあと（敵のターンの前）に1回、自動で行動します。",
    "行動の候補のうち、「クールタイムが明けていて」「使える条件を満たす」ものから、重みの割合でランダムに選びます。使える候補が無ければ通常攻撃です。",
    "固定項目で作れるのは、攻撃と回復だけです（回復は、単体なら一番HPの割合が低い味方を、全体なら全員を回復します）。支援などは「ブロックで組む」で作ってください。SP・焦力は使いません。",
    "使える条件の式で使える変数：魔獣HP割合／味方最低HP割合（主人公・生きている仲間・魔獣のうち一番低い割合）／味方人数／敵数／敵HP割合（狙う敵）／自分HP割合（主人公）／ターン数／乱数／凸数／相性 など（例：味方最低HP割合 < 0.7）"
  ].join("\n");
  details.appendChild(note);

  const listEl = document.createElement("div");
  listEl.className = "scenariobuild-list";
  const persist = () => markScenarioBuildDirty();
  entry.idleActions.forEach((action, index) => {
    if (action.enabled == null) action.enabled = true;
    listEl.appendChild(buildUpperSkillRow(action, index, {   // scenariobuild.js（上位スキルの編集の作りを使い回す）
      list: entry.idleActions,
      hideSources: true,
      buildTopRow: (infoEl) => {
        const t = tdEditorFieldTools(action, infoEl, persist);
        const r1 = t.addRow();
        t.numberField(r1, "weight", "選ばれやすさ（重み）", 0, 9999, 1);
        t.numberField(r1, "cooldown", "クールタイム（ターン）", 0, 99, 1);
        r1.appendChild(buildSkillCheckboxInline(action, "enabled", "使う"));
        const r2 = t.addRow();
        t.textField(r2, "condition", "使える条件（式。空なら常に）", "例：味方最低HP割合 < 0.7");
      },
      buildCostRow: (infoEl) => {
        const costNote = document.createElement("div");
        costNote.className = "devmode-note";
        costNote.textContent = "魔獣の行動は、SP・焦力を使いません（代わりに、クールタイムで使う間隔を調整します）。";
        infoEl.appendChild(costNote);
      },
      deleteMessage: (a) => `常時行動「${a.name || "名無し"}」を削除しますか？`
    }));
  });
  details.appendChild(listEl);

  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋行動の候補を足す";
  addBtn.disabled = entry.idleActions.length >= BEAST_IDLE_ACTION_MAX;
  addBtn.onclick = () => {
    pushUndoSnapshot();
    entry.idleActions.push(createNewBeastIdleAction());
    persist();
    renderScenarioBuildPanel();
  };
  details.appendChild(addBtn);
  return details;
}

// 連動：主人公・仲間が特定の技を使った時、戦闘画面の左に「連動！」ボタンが出る。タップかCキーで、魔獣が追加で行動する
// （常時行動は、連動のあとも通常どおり動く）。1つ1つの動きは、技の編集画面（固定項目／ブロック）で作る
function createNewBeastLink() {
  const base = createNewBeastIdleAction();
  ["weight", "condition"].forEach(k => delete base[k]);
  return Object.assign(base, {
    id: generateId("beastlink"), name: "新しい連動", enabled: true,
    trigger: { kind: "type", value: "attack" }, userKind: "any", userCompanion: "", cooldown: 1, unlockBreak: 0
  });
}

function buildBeastLinkEditor(entry) {
  if (!Array.isArray(entry.links)) entry.links = [];
  if (entry.linkMaxPerTurn == null) entry.linkMaxPerTurn = 1;
  const details = document.createElement("details");
  details.className = "scenariobuild-skill-details";
  const summary = document.createElement("summary");
  summary.textContent = `連動（仲間の技に合わせて発動：${entry.links.length}／${BEAST_LINK_MAX}）`;
  details.appendChild(summary);
  const note = document.createElement("p");
  note.className = "devmode-note";
  note.style.whiteSpace = "pre-wrap";
  note.textContent = [
    "主人公・仲間が、「きっかけ」に合う技を使うと、画面の左から「連動！ 発動可能！」のボタンが出ます（最大2つ）。タップかCキー（2つ出ている時は、Cを押したまま↑↓で選び、離すと発動）で、魔獣がその場で行動します。\n連動しても、そのターンの常時行動は動きます。連動は行動可能数を消費せず、連動が別の連動を起こすことはありません。確率は使いません。\n解放される凸：その凸になるまで、ボタンは出ません（0＝最初から）。"
  ].join("\n");
  details.appendChild(note);
  const persist = () => markScenarioBuildDirty();
  const topTools = tdEditorFieldTools(entry, details, persist);
  topTools.numberField(topTools.addRow(), "linkMaxPerTurn", "1ターンの連動の発動回数の上限（魔獣ごと）", 1, 9, 1);

  const kindOptions = [{ value: "name", label: "技の名前" }, { value: "element", label: "技の属性" }, { value: "type", label: "技の種類" }];
  const typeOptions = [{ value: "attack", label: "攻撃" }, { value: "heal", label: "回復" }, { value: "buff", label: "自己強化" }];
  const elementOptions = [{ value: "無", label: "無" }].concat((scenarioProject.elementDefs || []).map(el => ({ value: el.id, label: el.name || el.id })));
  const companionOptions = [{ value: "", label: "（選んでください）" }].concat((scenarioProject.companions || []).map(c => ({ value: c.id, label: c.name || c.id })));

  const listEl = document.createElement("div");
  listEl.className = "scenariobuild-list";
  entry.links.forEach((link, index) => {
    if (link.enabled == null) link.enabled = true;
    if (!link.trigger || typeof link.trigger !== "object") link.trigger = { kind: "type", value: "attack" };
    listEl.appendChild(buildUpperSkillRow(link, index, {
      list: entry.links,
      hideSources: true,
      buildTopRow: (infoEl) => {
        const t = tdEditorFieldTools(link, infoEl, persist);
        const tt = tdEditorFieldTools(link.trigger, infoEl, persist);
        const r1 = t.addRow();
        tt.selectField(r1, "kind", "きっかけ", kindOptions, () => { link.trigger.value = ""; renderScenarioBuildPanel(); });
        if (link.trigger.kind === "type") tt.selectField(r1, "value", "種類", typeOptions);
        else if (link.trigger.kind === "element") tt.selectField(r1, "value", "属性", elementOptions);
        else tt.textField(r1, "value", "技の名前", "例：ファイアボール");
        const r2 = t.addRow();
        t.selectField(r2, "userKind", "使った人", [{ value: "any", label: "誰でも" }, { value: "player", label: "主人公だけ" }, { value: "companion", label: "特定の仲間だけ" }], () => renderScenarioBuildPanel());
        if (link.userKind === "companion") t.selectField(r2, "userCompanion", "仲間", companionOptions);
        const r3 = t.addRow();
        t.numberField(r3, "cooldown", "クールタイム（ターン）", 0, 99, 1);
        t.numberField(r3, "unlockBreak", "解放される凸", 0, 5, 1);
        r3.appendChild(buildSkillCheckboxInline(link, "enabled", "使う"));
      },
      buildCostRow: (infoEl) => {
        const costNote = document.createElement("div");
        costNote.className = "devmode-note";
        costNote.textContent = "魔獣の行動は、SP・焦力を使いません。";
        infoEl.appendChild(costNote);
      },
      deleteMessage: (a) => `連動「${a.name || "名無し"}」を削除しますか？`
    }));
  });
  details.appendChild(listEl);

  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋連動を足す";
  addBtn.disabled = entry.links.length >= BEAST_LINK_MAX;
  addBtn.onclick = () => {
    pushUndoSnapshot();
    entry.links.push(createNewBeastLink());
    persist();
    renderScenarioBuildPanel();
  };
  details.appendChild(addBtn);
  return details;
}
