// writingnotes.js
// ★要望対応：シナリオエディタ「進行・シナリオ」グループの「設定資料」タブ。執筆のためのメモ帳。
//   ① 世界観メモ：カード式のノート（タイトル・分類・タグ・本文）。検索・分類での絞り込みができる
//   ② プロット：全体の大まかな流れ／章ごと／話ごとの執筆メモと進み具合（予定・執筆中・完成）
//        ※話ごとのメモは、話のブロックエディタの上部にも折りたたみで出る（buildWritingPlotPanel）
//   ③ 時系列：出来事（日付・出来事・関連する話・関連キャラ・メモ）を登録して、
//        「年表」（手動の並び順。ドラッグ／▲▼で入れ替え）と「話ごと」（話の順にまとめて表示）を切り替えて見る
//   プレイには一切影響しない、書くためだけのデータ。保存先は scenarioProject の次の3つ：
//     writingNotes（世界観メモの配列）／timelineEvents（出来事の配列。配列の順＝年表の順）／plotNotes（プロット）
//   ★ネタバレ防止：これらは「プレイヤーへの公開」（publicdata.js）や JS ファイル書き出し
//     （scenario_only_data.js／game_settings_data.js）には含めない。
//     代わりに、クラウド同期・コミット履歴（datamerge系）と、このタブの「設定資料のバックアップ（JSON）」に含める。

const WN_CATEGORIES = ["世界観", "地理・場所", "勢力・組織", "魔法・技術・ルール", "人物・種族", "歴史", "その他"];
const WN_STATUSES = [
  { value: "", label: "（未設定）" },
  { value: "planned", label: "予定" },
  { value: "writing", label: "執筆中" },
  { value: "done", label: "完成" }
];

let wnSection = "world";          // "world"（世界観メモ）／"plot"（プロット）／"timeline"（時系列）
let wnTimelineView = "chronicle"; // "chronicle"（年表）／"chapters"（話ごと）
let wnNoteSearch = "";
let wnNoteCategory = "";
let wnTimelineSearch = "";
let wnOpenNoteIds = {};           // 開いているメモカードのid（再描画しても開いたままにする）
let wnDragEventId = null;
let wnPanelOpen = false;          // 話エディタ上部のパネルの開閉

// ===== データの下ごしらえ =====
function wnEnsure() {
  if (typeof scenarioProject === "undefined" || !scenarioProject) return;
  if (!Array.isArray(scenarioProject.writingNotes)) scenarioProject.writingNotes = [];
  if (!Array.isArray(scenarioProject.timelineEvents)) scenarioProject.timelineEvents = [];
  if (!scenarioProject.plotNotes || typeof scenarioProject.plotNotes !== "object" || Array.isArray(scenarioProject.plotNotes)) {
    scenarioProject.plotNotes = {};
  }
  scenarioProject.writingNotes.forEach(note => {
    if (!note || typeof note !== "object") return;
    if (!note.id) note.id = wnNewId();
    ["title", "category", "tags", "body"].forEach(k => { if (typeof note[k] !== "string") note[k] = ""; });
  });
  scenarioProject.timelineEvents.forEach(ev => {
    if (!ev || typeof ev !== "object") return;
    if (!ev.id) ev.id = wnNewId();
    ["date", "title", "characters", "note"].forEach(k => { if (typeof ev[k] !== "string") ev[k] = ""; });
    if (ev.chapterId != null && typeof ev.chapterId !== "string") ev.chapterId = null;
  });
}

function wnNewId() {
  return "wn_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
}

function wnDirty() {
  if (typeof markScenarioBuildDirty === "function") markScenarioBuildDirty();
}

function wnUndo() {
  if (typeof pushUndoSnapshot === "function") pushUndoSnapshot();
}

function wnRerender() {
  if (typeof renderScenarioBuildSub === "function") renderScenarioBuildSub();
}

// 話の一覧（表示名つき）。閑話には印を付ける
function wnChapterEntries() {
  return (scenarioProject.chapters || []).map(chapter => ({
    chapter,
    label: (chapter.isInterlude ? "【閑話】" : "") + (chapter.title || "（タイトル未設定）")
  }));
}

function wnChapterLabelById(id) {
  const found = wnChapterEntries().find(e => e.chapter.id === id);
  return found ? found.label : "";
}

// ===== プロット（plotNotes）の読み書き =====
//   "overall"：全体の流れ（文字列）／"arc:<章id>"：章のメモ（文字列）／"chapter:<話id>"：{ status, text }
function wnGetOverall() {
  return typeof scenarioProject.plotNotes.overall === "string" ? scenarioProject.plotNotes.overall : "";
}

function wnSetString(key, text) {
  if (text) scenarioProject.plotNotes[key] = text;
  else delete scenarioProject.plotNotes[key];
}

function wnGetArcPlot(arcId) {
  const v = scenarioProject.plotNotes["arc:" + arcId];
  return typeof v === "string" ? v : "";
}

function wnGetChapterPlot(chapterId) {
  const v = scenarioProject.plotNotes["chapter:" + chapterId];
  if (v && typeof v === "object") return { status: typeof v.status === "string" ? v.status : "", text: typeof v.text === "string" ? v.text : "" };
  return { status: "", text: "" };
}

function wnSetChapterPlot(chapterId, patch) {
  const next = Object.assign(wnGetChapterPlot(chapterId), patch);
  const key = "chapter:" + chapterId;
  if (!next.status && !next.text) delete scenarioProject.plotNotes[key];
  else scenarioProject.plotNotes[key] = next;
}

function wnStatusLabel(status) {
  const found = WN_STATUSES.find(s => s.value === status);
  return found && found.value ? found.label : "";
}

// ===== 小さな部品 =====
function wnEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function wnButton(label, onclick, extraClass) {
  const btn = wnEl("button", "devmode-btn" + (extraClass ? " " + extraClass : ""), label);
  btn.type = "button";
  btn.onclick = (event) => { event.stopPropagation(); onclick(event); };
  return btn;
}

function wnTextInput(value, placeholder, oninput, className) {
  const input = wnEl("input", className || "scenariobuild-title-input");
  input.type = "text";
  input.value = value || "";
  if (placeholder) input.placeholder = placeholder;
  input.oninput = () => oninput(input.value);
  return input;
}

function wnTextarea(value, placeholder, oninput, rows) {
  const area = wnEl("textarea", "scenariobuild-textarea wn-textarea");
  area.value = value || "";
  area.rows = rows || 4;
  if (placeholder) area.placeholder = placeholder;
  area.oninput = () => oninput(area.value);
  return area;
}

function wnSelect(options, value, onchange) {
  const select = wnEl("select", "scenariobuild-jump-select");
  options.forEach(opt => {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    select.appendChild(option);
  });
  select.value = value || "";
  select.onchange = () => onchange(select.value);
  return select;
}

function wnField(labelText, control) {
  const row = wnEl("div", "wn-field");
  row.appendChild(wnEl("span", "wn-field-label", labelText));
  row.appendChild(control);
  return row;
}

// arr の中で、visibleIds（今見えている並び）上の隣の要素と位置を入れ替える
function wnSwapWithNeighbor(arr, id, dir, visibleIds) {
  const pos = visibleIds.indexOf(id);
  const neighborId = visibleIds[pos + dir];
  if (pos < 0 || neighborId == null) return false;
  const a = arr.findIndex(x => x.id === id);
  const b = arr.findIndex(x => x.id === neighborId);
  if (a < 0 || b < 0) return false;
  const tmp = arr[a]; arr[a] = arr[b]; arr[b] = tmp;
  return true;
}

// ===== タブ本体 =====
function renderWritingNotesManager(container) {
  wnEnsure();
  const intro = wnEl("p", "devmode-note",
    "執筆のためのメモ帳です。世界観の設定・大まかな流れ（プロット）・時系列を書き留めておけます。ゲームのプレイには一切影響せず、" +
    "プレイヤー向けの公開データにも含まれません（クラウド同期・コミット履歴と、下のバックアップ（JSON）には含まれます）。");
  container.appendChild(intro);

  const nav = wnEl("div", "wn-nav");
  [["world", "世界観メモ"], ["plot", "プロット"], ["timeline", "時系列"]].forEach(pair => {
    const btn = wnButton(pair[1], () => { wnSection = pair[0]; wnRerender(); }, "scenariobuild-tab-btn" + (wnSection === pair[0] ? " scenariobuild-tab-btn-active" : ""));
    nav.appendChild(btn);
  });
  container.appendChild(nav);

  const body = wnEl("div", "wn-body");
  container.appendChild(body);
  if (wnSection === "plot") wnRenderPlot(body);
  else if (wnSection === "timeline") wnRenderTimeline(body);
  else wnRenderWorld(body);

  wnRenderBackup(container);
}

// ===== ① 世界観メモ =====
function wnRenderWorld(body) {
  const bar = wnEl("div", "wn-toolbar");
  const search = wnTextInput(wnNoteSearch, "検索（タイトル・本文・タグ）", (v) => { wnNoteSearch = v; wnRenderWorldList(list); }, "scenariobuild-title-input wn-search");
  bar.appendChild(search);
  const catOptions = [{ value: "", label: "すべての分類" }].concat(WN_CATEGORIES.map(c => ({ value: c, label: c })));
  bar.appendChild(wnSelect(catOptions, wnNoteCategory, (v) => { wnNoteCategory = v; wnRenderWorldList(list); }));
  bar.appendChild(wnButton("＋ メモを追加", () => {
    wnUndo();
    const note = { id: wnNewId(), title: "", category: wnNoteCategory || WN_CATEGORIES[0], tags: "", body: "" };
    scenarioProject.writingNotes.push(note);
    wnOpenNoteIds[note.id] = true;
    wnNoteSearch = "";
    wnDirty();
    wnRerender();
  }));
  body.appendChild(bar);
  const list = wnEl("div", "wn-list");
  body.appendChild(list);
  wnRenderWorldList(list);
}

function wnVisibleNotes() {
  const q = wnNoteSearch.trim().toLowerCase();
  return scenarioProject.writingNotes.filter(note => {
    if (wnNoteCategory && note.category !== wnNoteCategory) return false;
    if (!q) return true;
    return (note.title + "\n" + note.body + "\n" + note.tags).toLowerCase().includes(q);
  });
}

function wnRenderWorldList(list) {
  list.innerHTML = "";
  const visible = wnVisibleNotes();
  if (visible.length === 0) {
    list.appendChild(wnEl("p", "devmode-note", scenarioProject.writingNotes.length === 0
      ? "まだメモがありません。「＋ メモを追加」から、世界観や設定を書き留めてください。"
      : "条件に合うメモがありません。"));
    return;
  }
  const visibleIds = visible.map(n => n.id);
  visible.forEach(note => list.appendChild(wnBuildNoteCard(note, visibleIds)));
}

function wnNoteSummaryText(note) {
  return "【" + (note.category || "その他") + "】" + (note.title || "（タイトル未設定）");
}

function wnBuildNoteCard(note, visibleIds) {
  const card = wnEl("details", "wn-card");
  card.open = !!wnOpenNoteIds[note.id];
  card.ontoggle = () => { wnOpenNoteIds[note.id] = card.open; };
  const summary = wnEl("summary", "wn-card-summary", wnNoteSummaryText(note));
  card.appendChild(summary);

  const refreshSummary = () => { summary.textContent = wnNoteSummaryText(note); };
  card.appendChild(wnField("タイトル", wnTextInput(note.title, "例：王国の成り立ち", (v) => { note.title = v; refreshSummary(); wnDirty(); })));
  const catOptions = WN_CATEGORIES.map(c => ({ value: c, label: c }));
  if (note.category && !WN_CATEGORIES.includes(note.category)) catOptions.push({ value: note.category, label: note.category });
  card.appendChild(wnField("分類", wnSelect(catOptions, note.category, (v) => { note.category = v; refreshSummary(); wnDirty(); })));
  card.appendChild(wnField("タグ", wnTextInput(note.tags, "カンマ区切り（任意）", (v) => { note.tags = v; wnDirty(); })));
  card.appendChild(wnTextarea(note.body, "本文（設定・メモ）", (v) => { note.body = v; wnDirty(); }, 8));

  const buttons = wnEl("div", "wn-card-buttons");
  buttons.appendChild(wnButton("▲", () => { if (wnSwapWithNeighbor(scenarioProject.writingNotes, note.id, -1, visibleIds)) { wnUndo(); wnDirty(); wnRerender(); } }));
  buttons.appendChild(wnButton("▼", () => { if (wnSwapWithNeighbor(scenarioProject.writingNotes, note.id, 1, visibleIds)) { wnUndo(); wnDirty(); wnRerender(); } }));
  buttons.appendChild(wnButton("削除", async () => {
    const ok = await showGameConfirm("「" + (note.title || "（タイトル未設定）") + "」を削除しますか？");
    if (!ok) return;
    wnUndo();
    scenarioProject.writingNotes = scenarioProject.writingNotes.filter(n => n.id !== note.id);
    wnDirty();
    wnRerender();
  }, "devmode-btn-danger"));
  card.appendChild(buttons);
  return card;
}

// ===== ② プロット =====
function wnStatusSelect(chapterId, onAfter) {
  return wnSelect(WN_STATUSES, wnGetChapterPlot(chapterId).status, (v) => {
    wnSetChapterPlot(chapterId, { status: v });
    wnDirty();
    if (onAfter) onAfter();
  });
}

function wnRenderPlot(body) {
  body.appendChild(wnEl("h4", "scenariobuild-subheading", "全体の大まかな流れ"));
  body.appendChild(wnTextarea(wnGetOverall(), "物語全体の流れ・結末・テーマなど", (v) => { wnSetString("overall", v); wnDirty(); }, 8));

  const entries = wnChapterEntries();
  const arcs = scenarioProject.chapterArcs || [];
  const groups = arcs.map(arc => ({ arc, entries: entries.filter(e => e.chapter.arcId === arc.id) }));
  const noneEntries = entries.filter(e => !e.chapter.arcId || !arcs.some(a => a.id === e.chapter.arcId));
  if (noneEntries.length > 0) groups.push({ arc: null, entries: noneEntries });

  body.appendChild(wnEl("h4", "scenariobuild-subheading", "章ごと・話ごとの流れ"));
  if (groups.length === 0) {
    body.appendChild(wnEl("p", "devmode-note", "話がまだありません。「話管理」で話を作ると、ここに並びます。"));
    return;
  }
  groups.forEach(group => {
    const box = wnEl("details", "wn-card");
    box.open = true;
    const doneCount = group.entries.filter(e => wnGetChapterPlot(e.chapter.id).status === "done").length;
    box.appendChild(wnEl("summary", "wn-card-summary", (group.arc ? "章：" + (group.arc.name || "（名称未設定）") : "章：未分類") + "（完成 " + doneCount + "／" + group.entries.length + "話）"));
    if (group.arc) {
      box.appendChild(wnTextarea(wnGetArcPlot(group.arc.id), "この章の流れ・狙い", (v) => { wnSetString("arc:" + group.arc.id, v); wnDirty(); }, 4));
    }
    group.entries.forEach(entry => box.appendChild(wnBuildChapterPlotRow(entry)));
    body.appendChild(box);
  });
}

function wnChapterSummaryText(entry) {
  const status = wnStatusLabel(wnGetChapterPlot(entry.chapter.id).status);
  return entry.label + (status ? "［" + status + "］" : "");
}

function wnBuildChapterPlotRow(entry) {
  const row = wnEl("details", "wn-card wn-card-inner");
  const summary = wnEl("summary", "wn-card-summary", wnChapterSummaryText(entry));
  row.appendChild(summary);
  row.appendChild(wnField("進み具合", wnStatusSelect(entry.chapter.id, () => { summary.textContent = wnChapterSummaryText(entry); })));
  row.appendChild(wnTextarea(wnGetChapterPlot(entry.chapter.id).text, "この話の流れ・書きたいこと・伏線など", (v) => { wnSetChapterPlot(entry.chapter.id, { text: v }); wnDirty(); }, 5));
  return row;
}

// ★話のブロックエディタの上部に出す、この話の執筆メモ（折りたたみ）
function buildWritingPlotPanel(chapter) {
  wnEnsure();
  const panel = wnEl("details", "wn-card wn-panel");
  panel.open = wnPanelOpen;
  panel.ontoggle = () => { wnPanelOpen = panel.open; };
  const entry = { chapter, label: chapter.title || "（タイトル未設定）" };
  const summary = wnEl("summary", "wn-card-summary", "📝 この話の執筆メモ" + (wnStatusLabel(wnGetChapterPlot(chapter.id).status) ? "［" + wnStatusLabel(wnGetChapterPlot(chapter.id).status) + "］" : ""));
  panel.appendChild(summary);
  panel.appendChild(wnField("進み具合", wnStatusSelect(chapter.id, () => {
    const s = wnStatusLabel(wnGetChapterPlot(chapter.id).status);
    summary.textContent = "📝 この話の執筆メモ" + (s ? "［" + s + "］" : "");
  })));
  panel.appendChild(wnTextarea(wnGetChapterPlot(chapter.id).text, "この話の流れ・書きたいこと・伏線など（プレイには出ません）", (v) => { wnSetChapterPlot(chapter.id, { text: v }); wnDirty(); }, 5));

  const arcText = chapter.arcId ? wnGetArcPlot(chapter.arcId) : "";
  if (arcText) {
    const arc = (scenarioProject.chapterArcs || []).find(a => a.id === chapter.arcId);
    panel.appendChild(wnEl("p", "devmode-note", "章「" + (arc && arc.name ? arc.name : "") + "」の流れ：" + arcText));
  }
  const linked = scenarioProject.timelineEvents.filter(ev => ev.chapterId === chapter.id);
  if (linked.length > 0) {
    panel.appendChild(wnEl("h4", "scenariobuild-subheading", "この話に関連する出来事"));
    linked.forEach(ev => panel.appendChild(wnEl("p", "devmode-note", (ev.date ? ev.date + "：" : "") + (ev.title || "（無題）"))));
  }
  return panel;
}

// ===== ③ 時系列 =====
function wnRenderTimeline(body) {
  const bar = wnEl("div", "wn-toolbar");
  [["chronicle", "年表"], ["chapters", "話ごと"]].forEach(pair => {
    bar.appendChild(wnButton(pair[1], () => { wnTimelineView = pair[0]; wnRerender(); }, "scenariobuild-tab-btn" + (wnTimelineView === pair[0] ? " scenariobuild-tab-btn-active" : "")));
  });
  bar.appendChild(wnTextInput(wnTimelineSearch, "検索（日付・出来事・キャラ・メモ）", (v) => { wnTimelineSearch = v; wnRenderTimelineList(list); }, "scenariobuild-title-input wn-search"));
  if (wnTimelineView === "chronicle") bar.appendChild(wnButton("＋ 出来事を追加", () => wnAddEvent(null)));
  body.appendChild(bar);
  body.appendChild(wnEl("p", "devmode-note", wnTimelineView === "chronicle"
    ? "出来事を並べた年表です。左端の「☰」をドラッグするか、▲▼で順番を入れ替えます（検索中は入れ替えできません）。日付は「王国暦312年春」「ゲーム内3日目」のように自由に書けます。"
    : "話の順に、その話に関連する出来事をまとめて表示します。各話の「＋」でその話の出来事を追加できます。関連する話が未設定の出来事は「未割り当て」にまとまります。"));
  const list = wnEl("div", "wn-list");
  body.appendChild(list);
  wnRenderTimelineList(list);
}

function wnAddEvent(chapterId) {
  wnUndo();
  scenarioProject.timelineEvents.push({ id: wnNewId(), date: "", title: "", chapterId: chapterId || null, characters: "", note: "" });
  wnTimelineSearch = "";
  wnDirty();
  wnRerender();
}

function wnEventMatches(ev, q) {
  if (!q) return true;
  return (ev.date + "\n" + ev.title + "\n" + ev.characters + "\n" + ev.note + "\n" + wnChapterLabelById(ev.chapterId)).toLowerCase().includes(q);
}

function wnRenderTimelineList(list) {
  list.innerHTML = "";
  const q = wnTimelineSearch.trim().toLowerCase();
  const events = scenarioProject.timelineEvents;
  if (events.length === 0 && wnTimelineView === "chronicle") {
    list.appendChild(wnEl("p", "devmode-note", "まだ出来事がありません。「＋ 出来事を追加」から登録してください。"));
    return;
  }
  if (wnTimelineView === "chronicle") {
    const visible = events.filter(ev => wnEventMatches(ev, q));
    if (visible.length === 0) { list.appendChild(wnEl("p", "devmode-note", "条件に合う出来事がありません。")); return; }
    const ids = visible.map(ev => ev.id);
    visible.forEach(ev => list.appendChild(wnBuildEventCard(ev, ids, !q)));
    return;
  }
  // 話ごと：話の順に並べ、関連する話が無い（または存在しない話の）出来事は最後に「未割り当て」
  const entries = wnChapterEntries();
  const known = {};
  entries.forEach(e => { known[e.chapter.id] = true; });
  entries.forEach(entry => {
    const mine = events.filter(ev => ev.chapterId === entry.chapter.id && wnEventMatches(ev, q));
    if (q && mine.length === 0) return;
    list.appendChild(wnBuildChapterGroup(entry.label, mine, entry.chapter.id));
  });
  const orphans = events.filter(ev => (!ev.chapterId || !known[ev.chapterId]) && wnEventMatches(ev, q));
  if (orphans.length > 0) list.appendChild(wnBuildChapterGroup("未割り当て", orphans, null));
}

function wnBuildChapterGroup(label, evs, chapterId) {
  const box = wnEl("details", "wn-card");
  box.open = evs.length > 0;
  box.appendChild(wnEl("summary", "wn-card-summary", label + "（" + evs.length + "件）"));
  const ids = evs.map(ev => ev.id);
  evs.forEach(ev => box.appendChild(wnBuildEventCard(ev, ids, false)));
  if (chapterId) box.appendChild(wnButton("＋ この話に出来事を追加", () => wnAddEvent(chapterId)));
  return box;
}

function wnBuildEventCard(ev, visibleIds, allowDrag) {
  const card = wnEl("div", "wn-event");
  const head = wnEl("div", "wn-event-head");

  const handle = wnEl("span", "wn-handle", "☰");
  if (allowDrag) {
    handle.draggable = true;
    handle.title = "ドラッグで並べ替え";
    handle.ondragstart = (e) => {
      wnDragEventId = ev.id;
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", ev.id); e.dataTransfer.setDragImage(card, 10, 10); } catch (err) { /* 無視 */ } }
    };
    handle.ondragend = () => { wnDragEventId = null; card.classList.remove("wn-drop-target"); };
    card.ondragover = (e) => { if (wnDragEventId && wnDragEventId !== ev.id) { e.preventDefault(); card.classList.add("wn-drop-target"); } };
    card.ondragleave = () => card.classList.remove("wn-drop-target");
    card.ondrop = (e) => {
      e.preventDefault();
      card.classList.remove("wn-drop-target");
      const fromId = wnDragEventId;
      wnDragEventId = null;
      if (!fromId || fromId === ev.id) return;
      const arr = scenarioProject.timelineEvents;
      const from = arr.findIndex(x => x.id === fromId);
      if (from < 0) return;
      wnUndo();
      const moved = arr.splice(from, 1)[0];
      const to = arr.findIndex(x => x.id === ev.id);
      arr.splice(to < 0 ? arr.length : to, 0, moved);
      wnDirty();
      wnRerender();
    };
  } else {
    handle.classList.add("wn-handle-disabled");
  }
  head.appendChild(handle);
  head.appendChild(wnTextInput(ev.date, "日付（自由記述）", (v) => { ev.date = v; wnDirty(); }, "scenariobuild-title-input wn-event-date"));
  head.appendChild(wnTextInput(ev.title, "出来事", (v) => { ev.title = v; wnDirty(); }, "scenariobuild-title-input wn-event-title"));
  card.appendChild(head);

  const chapterOptions = [{ value: "", label: "（未設定）" }].concat(wnChapterEntries().map(e => ({ value: e.chapter.id, label: e.label })));
  card.appendChild(wnField("関連する話", wnSelect(chapterOptions, ev.chapterId || "", (v) => { ev.chapterId = v || null; wnDirty(); if (wnTimelineView === "chapters") wnRerender(); })));

  const charInput = wnTextInput(ev.characters, "関連キャラ（カンマ区切り）", (v) => { ev.characters = v; wnDirty(); });
  const listId = "wn-chara-list";
  charInput.setAttribute("list", listId);
  card.appendChild(wnField("関連キャラ", charInput));
  if (!document.getElementById(listId)) {
    const dl = document.createElement("datalist");
    dl.id = listId;
    (scenarioProject.characters || []).forEach(c => { if (c && c.name) { const o = document.createElement("option"); o.value = c.name; dl.appendChild(o); } });
    card.appendChild(dl);
  }
  card.appendChild(wnTextarea(ev.note, "メモ", (v) => { ev.note = v; wnDirty(); }, 3));

  const buttons = wnEl("div", "wn-card-buttons");
  buttons.appendChild(wnButton("▲", () => { if (wnSwapWithNeighbor(scenarioProject.timelineEvents, ev.id, -1, visibleIds)) { wnUndo(); wnDirty(); wnRerender(); } }));
  buttons.appendChild(wnButton("▼", () => { if (wnSwapWithNeighbor(scenarioProject.timelineEvents, ev.id, 1, visibleIds)) { wnUndo(); wnDirty(); wnRerender(); } }));
  buttons.appendChild(wnButton("削除", async () => {
    const ok = await showGameConfirm("この出来事を削除しますか？（" + (ev.title || "無題") + "）");
    if (!ok) return;
    wnUndo();
    scenarioProject.timelineEvents = scenarioProject.timelineEvents.filter(x => x.id !== ev.id);
    wnDirty();
    wnRerender();
  }, "devmode-btn-danger"));
  card.appendChild(buttons);
  return card;
}

// ===== バックアップ（JSON） =====
function wnRenderBackup(container) {
  container.appendChild(wnEl("h4", "scenariobuild-subheading", "設定資料のバックアップ（JSON）"));
  container.appendChild(wnEl("p", "devmode-note", "世界観メモ・プロット・時系列だけを、1つのファイルに書き出し／読み込みできます（読み込むと、今の設定資料はファイルの内容に置き換わります）。"));
  const row = wnEl("div", "wn-toolbar");
  row.appendChild(wnButton("書き出す", () => {
    const data = { type: "writingnotes", version: 1, exportedAt: Date.now(), writingNotes: scenarioProject.writingNotes, timelineEvents: scenarioProject.timelineEvents, plotNotes: scenarioProject.plotNotes };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "設定資料.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }));
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".json,application/json";
  fileInput.style.display = "none";
  fileInput.onchange = async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || data.type !== "writingnotes" || !Array.isArray(data.writingNotes) || !Array.isArray(data.timelineEvents) || !data.plotNotes || typeof data.plotNotes !== "object") {
        await showGameAlert("設定資料のバックアップファイルではないようです。");
        return;
      }
      const ok = await showGameConfirm("今の設定資料（世界観メモ" + scenarioProject.writingNotes.length + "件・出来事" + scenarioProject.timelineEvents.length + "件・プロット）を、ファイルの内容（世界観メモ" + data.writingNotes.length + "件・出来事" + data.timelineEvents.length + "件）に置き換えます。よろしいですか？");
      if (!ok) return;
      wnUndo();
      scenarioProject.writingNotes = data.writingNotes;
      scenarioProject.timelineEvents = data.timelineEvents;
      scenarioProject.plotNotes = data.plotNotes;
      wnEnsure();
      wnDirty();
      wnRerender();
    } catch (e) {
      console.error("設定資料の読み込みに失敗しました", e);
      await showGameAlert("ファイルを読み込めませんでした。");
    }
  };
  row.appendChild(wnButton("読み込む", () => fileInput.click()));
  row.appendChild(fileInput);
  container.appendChild(row);
}
