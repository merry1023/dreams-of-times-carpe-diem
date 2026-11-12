// writingguide.js
// ★要望対応：シナリオエディタの「分量表示」と「執筆ガイド（簡易辞書）」タブ。
//   ① 分量表示：シナリオの文章が「原稿用紙で何枚分か」「小説なら何ページ分か」「読み終えるのに何分かかるか」を表示する。
//      ・話のブロックエディタの上部（その話の分量）／話の一覧の上部（全話の合計）／話の一覧の各行（その話の分量）に出る
//      ・計算は、文章を実際に「1行の字数」で折り返して行数を数える方式（段落ごとの改行・段落頭の字下げ・
//        会話文の「」・行頭に句読点や閉じ括弧が来ない禁則処理・半角英数は2文字で1マス）を加味している
//      ・読了時間は「文字数 ÷ 1分あたりに読める字数」で計算（設定で変更可能）
//      ・設定（原稿用紙の種類／小説の判型／読む速さ等）は、ゲームデータではなくこのブラウザだけに保存する（localStorage）
//   ② 「執筆ガイド」タブ：分量・設定／文字数カウンタ（貼り付けて数える）／分量の目安表／簡易辞書（writingdict_data.js）
//   見るだけの機能で、シナリオのデータ（scenarioProject）は一切書き換えない。

// ===================================================================
// ===== 設定 =====
// ===================================================================
const WG_STORAGE_KEY = "carpeDiemWritingGuideSettings_v1";

const WG_PAPER_PRESETS = [
  { id: "400", label: "400字詰め原稿用紙（20字×20行）", short: "400字詰め", cols: 20, rows: 20 },
  { id: "200", label: "200字詰め原稿用紙（20字×10行）", short: "200字詰め", cols: 20, rows: 10 }
];

// ★判型ごとの字数・行数は出版社や本によって違うため、あくまで目安（「自分で指定」で好きな値にできる）
const WG_NOVEL_PRESETS = [
  { id: "lightnovel", label: "ライトノベル文庫（42字×17行）", short: "ライトノベル文庫", cols: 42, rows: 17 },
  { id: "bunko", label: "一般的な文庫本（39字×16行）", short: "文庫本", cols: 39, rows: 16 },
  { id: "tankobon", label: "単行本（40字×16行）", short: "単行本", cols: 40, rows: 16 },
  { id: "custom", label: "自分で指定", short: "指定判型", cols: 40, rows: 16 }
];

const WG_DEFAULT_SETTINGS = {
  paper: "400",          // 原稿用紙の種類（WG_PAPER_PRESETSのid）
  novel: "bunko",        // 小説の判型（WG_NOVEL_PRESETSのid）
  customCols: 40,        // 「自分で指定」の1行の字数
  customRows: 16,        // 「自分で指定」の1ページの行数
  readCpm: 500,          // 1分あたりに読める字数（一般的な読書速度の目安）
  route: "all",          // 分岐の数え方："all"＝全分岐を合算／"longest"＝分岐のうち一番長い道を1本通った場合
  includeChoice: true    // 選択肢の質問文・選択肢の文言を文章量に含めるか
};

let wgSettingsCache = null;

function wgClamp(value, min, max, fallback) {
  const n = Number(value);
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function wgSanitizeSettings(raw) {
  const s = Object.assign({}, WG_DEFAULT_SETTINGS, raw && typeof raw === "object" ? raw : {});
  s.readCpm = Math.round(wgClamp(s.readCpm, 50, 5000, WG_DEFAULT_SETTINGS.readCpm));
  s.customCols = Math.round(wgClamp(s.customCols, 5, 100, WG_DEFAULT_SETTINGS.customCols));
  s.customRows = Math.round(wgClamp(s.customRows, 3, 100, WG_DEFAULT_SETTINGS.customRows));
  if (!WG_PAPER_PRESETS.some(p => p.id === s.paper)) s.paper = WG_DEFAULT_SETTINGS.paper;
  if (!WG_NOVEL_PRESETS.some(p => p.id === s.novel)) s.novel = WG_DEFAULT_SETTINGS.novel;
  s.route = s.route === "longest" ? "longest" : "all";
  s.includeChoice = s.includeChoice !== false;
  return s;
}

function wgGetSettings() {
  if (wgSettingsCache) return wgSettingsCache;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(WG_STORAGE_KEY) || "null"); } catch (e) { saved = null; }
  wgSettingsCache = wgSanitizeSettings(saved);
  return wgSettingsCache;
}

function wgSaveSettings(patch) {
  wgSettingsCache = wgSanitizeSettings(Object.assign({}, wgGetSettings(), patch));
  try { localStorage.setItem(WG_STORAGE_KEY, JSON.stringify(wgSettingsCache)); } catch (e) { /* 保存できなくても今回の画面内では反映される */ }
  return wgSettingsCache;
}

function wgPaperConfig(settings) {
  return WG_PAPER_PRESETS.find(p => p.id === settings.paper) || WG_PAPER_PRESETS[0];
}

function wgNovelConfig(settings) {
  const preset = WG_NOVEL_PRESETS.find(p => p.id === settings.novel) || WG_NOVEL_PRESETS[1];
  if (preset.id === "custom") return Object.assign({}, preset, { cols: settings.customCols, rows: settings.customRows, label: `自分で指定（${settings.customCols}字×${settings.customRows}行）` });
  return preset;
}

// ===================================================================
// ===== 計算エンジン =====
// ===================================================================
const WG_OPENERS = "「『（〔［｛〈《【“‘";   // 開き括弧（段落頭なら字下げしない／行末に来たら次の行へ送る）
const WG_CLOSERS = "」』）〕］｝〉》】”’";   // 閉じ括弧
const WG_NO_LINE_START = new Set(Array.from("、。，．" + WG_CLOSERS)); // 行頭に来てはいけない文字（行末にぶら下げて処理する）
const WG_NO_LINE_END = new Set(Array.from(WG_OPENERS));              // 行末に来てはいけない文字

// 1文字が占めるマス数。半角の英数字・記号・半角カナは2文字で1マス、それ以外は1マス
function wgCharWidth(ch) {
  const c = ch.codePointAt(0);
  if ((c >= 0x20 && c <= 0x7e) || (c >= 0xff61 && c <= 0xff9f)) return 0.5;
  return 1;
}

function wgLength(text) {
  return Array.from(text).length;
}

// ★1つの段落を cols 字で折り返した時の行数。indent=trueなら先頭に1マスの字下げを入れる。
//   ・行頭に句読点・閉じ括弧が来てしまう場合は、前の行の末尾にぶら下げて、次の文字から新しい行にする
//   ・開き括弧が行末に来てしまう場合は、その括弧を次の行の頭に送る
//   ・空の段落（空行）は1行として数える
function wgWrapLines(text, cols, indent) {
  const chars = Array.from(text);
  if (chars.length === 0) return 1;
  const eps = 1e-9;
  let lines = 1;
  let used = indent ? 1 : 0;
  let closed = false; // ぶら下げた直後＝次の文字は必ず新しい行から
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const w = wgCharWidth(ch);
    if (closed) { lines++; used = 0; closed = false; }
    if (used + w > cols + eps) {
      if (WG_NO_LINE_START.has(ch)) { closed = true; continue; }
      lines++;
      used = 0;
    }
    used += w;
    if (WG_NO_LINE_END.has(ch) && used >= cols - eps && i < chars.length - 1) {
      lines++;
      used = w;
    }
  }
  return lines;
}

function wgStripRuby(text) {
  if (typeof stripRubyNotation === "function") return stripRubyNotation(text); // mainfunc.js（ルビ記法 {/漢字}={\かんじ} → 漢字）
  return text;
}

// ★本文1ブロック分を段落の配列にして out に積む。kind："dialogue"＝会話（「」で囲む・字下げなし）／"narration"＝地の文（字下げあり）
//   文中の改行（\n）は段落の区切りとして扱う。中身が空のブロックは数えない
function wgPushText(out, kind, raw) {
  if (typeof raw !== "string" || raw.trim() === "") return;
  const parts = wgStripRuby(raw).replace(/\r\n?/g, "\n").split("\n");
  parts.forEach((part, i) => {
    let t = part;
    if (kind === "dialogue") {
      if (i === 0 && !WG_OPENERS.includes(t.charAt(0) || " ")) t = "「" + t;
      if (i === parts.length - 1 && !WG_CLOSERS.includes(t.slice(-1) || " ")) t = t + "」";
      out.push({ text: t, indent: false });
    } else {
      const first = t.charAt(0);
      out.push({ text: t, indent: t !== "" && !WG_OPENERS.includes(first) && first !== "　" });
    }
  });
}

function wgParasChars(paras) {
  return paras.reduce((sum, p) => sum + wgLength(p.text), 0);
}

// ★ブロックの並びから、読者が読む文章（段落）を集める。ifの中・選択肢の中も辿る
function wgCollectParas(blocks, settings, out) {
  (Array.isArray(blocks) ? blocks : []).forEach(block => {
    if (!block || typeof block !== "object") return;
    if (block.type === "dialogue") wgPushText(out, "dialogue", block.text);
    else if (block.type === "narration" || block.type === "telop") wgPushText(out, "narration", block.text);
    else if (block.type === "choice") wgCollectChoice(block, settings, out);
    else if (block.type === "if") wgCollectIf(block, settings, out);
  });
  return out;
}

function wgPushPlain(out, raw) {
  if (typeof raw !== "string" || raw.trim() === "") return;
  out.push({ text: wgStripRuby(raw).replace(/\s*\n\s*/g, " "), indent: false });
}

function wgCollectChoice(block, settings, out) {
  if (settings.includeChoice) wgPushPlain(out, block.prompt);
  const branches = (Array.isArray(block.options) ? block.options : []).filter(Boolean).map(opt => {
    const list = [];
    if (settings.includeChoice) wgPushPlain(list, opt.text);
    wgCollectParas(opt.blocks, settings, list);
    return list;
  });
  wgPushBranches(branches, settings, out);
}

function wgCollectIf(block, settings, out) {
  const branches = [block.trueBlocks, block.falseBlocks].map(blocks => wgCollectParas(blocks, settings, []));
  wgPushBranches(branches, settings, out);
}

// ★分岐の数え方：全分岐を合算するか、一番長い道を1本だけ数えるか
function wgPushBranches(branches, settings, out) {
  if (settings.route === "longest") {
    let best = null;
    let bestChars = -1;
    branches.forEach(list => {
      const n = wgParasChars(list);
      if (n > bestChars) { best = list; bestChars = n; }
    });
    if (best) best.forEach(p => out.push(p));
  } else {
    branches.forEach(list => list.forEach(p => out.push(p)));
  }
}

// ★段落の配列から、文字数・原稿用紙の枚数・小説のページ数・読了時間を出す
function wgMeasure(paras, settings) {
  const paper = wgPaperConfig(settings);
  const novel = wgNovelConfig(settings);
  let chars = 0;
  let paperLines = 0;
  let novelLines = 0;
  paras.forEach(p => {
    chars += wgLength(p.text);
    paperLines += wgWrapLines(p.text, paper.cols, p.indent);
    novelLines += wgWrapLines(p.text, novel.cols, p.indent);
  });
  return {
    chars,
    paperLines, novelLines,
    sheets: paperLines / paper.rows,        // 原稿用紙の枚数（小数）
    pages: novelLines / novel.rows,         // 小説のページ数（小数）
    minutes: chars / settings.readCpm       // 読了時間（分）
  };
}

function wgMeasureChapters(chapters, settings) {
  const paras = [];
  chapters.forEach(chapter => wgCollectParas(chapter && chapter.blocks, settings, paras));
  return wgMeasure(paras, settings);
}

// ===== 表示用の整形 =====
function wgFmtNum(n) { return Number(n).toLocaleString("ja-JP"); }

function wgFmtSheets(m) {
  if (m.chars === 0) return "0枚";
  return `約${(Math.round(m.sheets * 10) / 10).toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}枚`;
}

function wgFmtPages(m) {
  if (m.chars === 0) return "0ページ";
  return `約${wgFmtNum(Math.max(1, Math.ceil(m.pages - 1e-9)))}ページ`;
}

function wgFmtMinutes(min, chars) {
  if (chars === 0) return "0分";
  if (min < 1) return `約${Math.max(1, Math.round(min * 60))}秒`;
  if (min < 60) return `約${Math.round(min)}分`;
  let h = Math.floor(min / 60);
  let m = Math.round(min - h * 60);
  if (m === 60) { h++; m = 0; }
  return m === 0 ? `約${h}時間` : `約${h}時間${m}分`;
}

// ===================================================================
// ===== 分量の表示パーツ（話のエディタ／話の一覧に埋め込む） =====
// ===================================================================
function wgEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function wgChip(label, value) {
  const chip = wgEl("span", "wg-chip");
  chip.appendChild(wgEl("b", "", label));
  chip.appendChild(document.createTextNode(value));
  return chip;
}

function wgSummaryChapters(scope) {
  const all = (typeof scenarioProject !== "undefined" && scenarioProject && Array.isArray(scenarioProject.chapters)) ? scenarioProject.chapters : [];
  if (scope === "all") return all;
  const hit = all.find(c => c && c.id === scope);
  return hit ? [hit] : [];
}

function wgFillSummary(el) {
  if (!el || !el.isConnected) return;
  const settings = wgGetSettings();
  const paper = wgPaperConfig(settings);
  const novel = wgNovelConfig(settings);
  const m = wgMeasureChapters(wgSummaryChapters(el.dataset.wgScope), settings);
  el.innerHTML = "";

  if (el.dataset.wgCompact === "1") {
    el.textContent = `📏 ${wgFmtNum(m.chars)}字 ／ 原稿用紙${wgFmtSheets(m)} ／ ${novel.short}${wgFmtPages(m)} ／ 読了${wgFmtMinutes(m.minutes, m.chars)}`;
    return;
  }

  el.appendChild(wgEl("div", "wg-summary-title", el.dataset.wgTitle || "分量"));
  const chips = wgEl("div", "wg-chips");
  chips.appendChild(wgChip("文字数", `${wgFmtNum(m.chars)}字`));
  chips.appendChild(wgChip(`原稿用紙（${paper.short}）`, wgFmtSheets(m)));
  chips.appendChild(wgChip(`小説（${novel.short}）`, wgFmtPages(m)));
  chips.appendChild(wgChip("読了", wgFmtMinutes(m.minutes, m.chars)));
  el.appendChild(chips);

  const foot = wgEl("div", "wg-summary-foot");
  foot.appendChild(wgEl("span", "", `${settings.route === "longest" ? "分岐は一番長い道を1本通った場合" : "分岐は全て合算"}／1分あたり${wgFmtNum(settings.readCpm)}字で計算（目安）`));
  const openBtn = wgEl("button", "devmode-btn wg-open-btn", "設定・辞書を開く");
  openBtn.type = "button";
  openBtn.onclick = (event) => {
    event.stopPropagation();
    wgOpenGuideTab();
  };
  foot.appendChild(openBtn);
  el.appendChild(foot);
}

// scope："all"（全話）または話のid／opts：{ compact（1行表示）, title }
function buildWritingGuideSummary(scope, opts) {
  const options = opts || {};
  const el = wgEl("div", "wg-summary" + (options.compact ? " wg-summary-compact" : ""));
  el.dataset.wgScope = scope;
  if (options.compact) el.dataset.wgCompact = "1";
  if (options.title) el.dataset.wgTitle = options.title;
  // ★要素がまだ画面に載る前なので、載った直後（次のタイミング）に中身を作る
  setTimeout(() => wgFillSummary(el), 0);
  return el;
}

function wgOpenGuideTab() {
  if (typeof scenarioBuildSubView === "undefined") return;
  scenarioBuildSubView = "writingguide";
  scenarioBuildTabGroupOpen = { __init: true, story: true }; // 「進行・シナリオ」グループを開いた状態にする
  if (typeof renderScenarioBuildSub === "function") renderScenarioBuildSub();
}

// ★データが変わるたび（markScenarioBuildDirty）に呼ばれる。連続して呼ばれても200msに1回だけ再計算する
let wgRefreshTimer = null;
function writingGuideScheduleRefresh() {
  if (wgRefreshTimer) return;
  wgRefreshTimer = setTimeout(() => {
    wgRefreshTimer = null;
    document.querySelectorAll(".wg-summary").forEach(wgFillSummary);
    if (typeof wgRefreshTabTable === "function") wgRefreshTabTable();
  }, 200);
}

// ===================================================================
// ===== 「執筆ガイド」タブ =====
// ===================================================================
let wgTabMode = "amount";      // "amount"（分量・目安）／"dict"（簡易辞書）
let wgDictQuery = "";
let wgDictCategory = "";
let wgTabTableRefresher = null; // 開いている「現在のシナリオの分量」表を最新にする関数

function wgRefreshTabTable() {
  if (typeof wgTabTableRefresher === "function") wgTabTableRefresher();
}

function wgAddTable(container, headers, rows, totalRowIndex) {
  const wrap = wgEl("div", "scenario-stats-wrap");
  const table = wgEl("table", "scenario-stats-table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headers.forEach(h => headRow.appendChild(wgEl("th", "", h)));
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  rows.forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    if (rowIndex === totalRowIndex) tr.className = "wg-total-row";
    // ★数値っぽい列（「約」「数字」で始まる）だけ右寄せ。文章の列（ジャンルの目安など）は左寄せのまま
    row.forEach((cell, i) => tr.appendChild(wgEl("td", i > 0 && /^[約0-9]/.test(String(cell)) ? "scenario-stats-num" : "", cell)));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  container.appendChild(wrap);
  return wrap;
}

function wgAddHeading(container, text) {
  container.appendChild(wgEl("h4", "scenariobuild-subheading", text));
}

function wgAddNote(container, text) {
  container.appendChild(wgEl("p", "devmode-note", text));
}

function wgFieldRow(labelText, control, hint) {
  const row = wgEl("label", "scenariobuild-condition-row wg-field-row");
  row.appendChild(wgEl("span", "wg-field-label", labelText));
  row.appendChild(control);
  if (hint) row.appendChild(wgEl("span", "wg-field-hint", hint));
  return row;
}

function renderWritingGuideManager(container) {
  const rerender = () => {
    container.innerHTML = "";
    renderWritingGuideManager(container);
    writingGuideScheduleRefresh();
  };

  const seg = wgEl("div", "wg-seg");
  [["amount", "📏 分量・目安"], ["dict", "📖 簡易辞書"]].forEach(([mode, label]) => {
    const btn = wgEl("button", "devmode-btn wg-seg-btn" + (wgTabMode === mode ? " wg-seg-btn-active" : ""), label);
    btn.type = "button";
    btn.onclick = (event) => {
      event.stopPropagation();
      wgTabMode = mode;
      rerender();
    };
    seg.appendChild(btn);
  });
  container.appendChild(seg);

  wgTabTableRefresher = null;
  if (wgTabMode === "dict") renderWritingDictionaryPane(container);
  else renderWritingAmountPane(container, rerender);
}

// ----- 分量・目安 -----
function renderWritingAmountPane(container, rerender) {
  const settings = wgGetSettings();

  // ===== 設定 =====
  wgAddHeading(container, "計算の設定");
  wgAddNote(container, "この設定は、このブラウザにだけ保存されます（ゲームのデータには含まれません）。話のエディタ上部の分量表示にも反映されます。");

  const paperSelect = document.createElement("select");
  WG_PAPER_PRESETS.forEach(p => {
    const opt = wgEl("option", "", p.label);
    opt.value = p.id;
    paperSelect.appendChild(opt);
  });
  paperSelect.value = settings.paper;
  paperSelect.onchange = () => { wgSaveSettings({ paper: paperSelect.value }); rerender(); };
  container.appendChild(wgFieldRow("原稿用紙", paperSelect));

  const novelSelect = document.createElement("select");
  WG_NOVEL_PRESETS.forEach(p => {
    const opt = wgEl("option", "", p.label);
    opt.value = p.id;
    novelSelect.appendChild(opt);
  });
  novelSelect.value = settings.novel;
  novelSelect.onchange = () => { wgSaveSettings({ novel: novelSelect.value }); rerender(); };
  container.appendChild(wgFieldRow("小説のページ", novelSelect, "※字数・行数は本によって違うため目安です"));

  if (settings.novel === "custom") {
    const colsInput = document.createElement("input");
    colsInput.type = "number"; colsInput.min = "5"; colsInput.max = "100"; colsInput.value = settings.customCols;
    colsInput.className = "wg-number-input";
    colsInput.onchange = () => { wgSaveSettings({ customCols: colsInput.value }); rerender(); };
    container.appendChild(wgFieldRow("1行の字数", colsInput, "字"));
    const rowsInput = document.createElement("input");
    rowsInput.type = "number"; rowsInput.min = "3"; rowsInput.max = "100"; rowsInput.value = settings.customRows;
    rowsInput.className = "wg-number-input";
    rowsInput.onchange = () => { wgSaveSettings({ customRows: rowsInput.value }); rerender(); };
    container.appendChild(wgFieldRow("1ページの行数", rowsInput, "行"));
  }

  const cpmInput = document.createElement("input");
  cpmInput.type = "number"; cpmInput.min = "50"; cpmInput.max = "5000"; cpmInput.step = "50"; cpmInput.value = settings.readCpm;
  cpmInput.className = "wg-number-input";
  cpmInput.onchange = () => { wgSaveSettings({ readCpm: cpmInput.value }); rerender(); };
  container.appendChild(wgFieldRow("読む速さ", cpmInput, "字／分（一般的には400〜600字ほどと言われます）"));

  const routeSelect = document.createElement("select");
  [["all", "全ての分岐を合算する"], ["longest", "分岐は一番長い道を1本通った場合"]].forEach(([value, label]) => {
    const opt = wgEl("option", "", label);
    opt.value = value;
    routeSelect.appendChild(opt);
  });
  routeSelect.value = settings.route;
  routeSelect.onchange = () => { wgSaveSettings({ route: routeSelect.value }); rerender(); };
  container.appendChild(wgFieldRow("分岐（if・選択肢）の数え方", routeSelect));

  const choiceCheck = document.createElement("input");
  choiceCheck.type = "checkbox";
  choiceCheck.checked = settings.includeChoice;
  choiceCheck.onchange = () => { wgSaveSettings({ includeChoice: choiceCheck.checked }); rerender(); };
  container.appendChild(wgFieldRow("選択肢の文言", choiceCheck, "質問文・選択肢の文章も分量に含める"));

  // ===== 現在のシナリオの分量 =====
  wgAddHeading(container, "現在のシナリオの分量");
  const tableHost = wgEl("div", "wg-table-host");
  container.appendChild(tableHost);
  const fillTable = () => {
    if (!tableHost.isConnected) return;
    const s = wgGetSettings();
    const chapters = (typeof scenarioProject !== "undefined" && scenarioProject && Array.isArray(scenarioProject.chapters)) ? scenarioProject.chapters : [];
    tableHost.innerHTML = "";
    if (chapters.length === 0) { wgAddNote(tableHost, "まだ話がありません。"); return; }
    const rows = chapters.map((chapter, i) => {
      const m = wgMeasureChapters([chapter], s);
      return [`${i + 1}. ${chapter.title || "（無題）"}`, `${wgFmtNum(m.chars)}字`, wgFmtSheets(m), wgFmtPages(m), wgFmtMinutes(m.minutes, m.chars)];
    });
    const total = wgMeasureChapters(chapters, s);
    rows.push(["全話の合計", `${wgFmtNum(total.chars)}字`, wgFmtSheets(total), wgFmtPages(total), wgFmtMinutes(total.minutes, total.chars)]);
    wgAddTable(tableHost, ["話", "文字数", `原稿用紙（${wgPaperConfig(s).short}）`, `小説（${wgNovelConfig(s).short}）`, "読了"], rows, rows.length - 1);
  };
  fillTable();
  wgTabTableRefresher = fillTable;
  wgAddNote(container, "計算のしかた：会話は「」で囲み、地の文は段落の頭を1字下げ、段落ごと（文中の改行ごと）に改行します。1行の字数で折り返し、句読点・閉じ括弧が行頭に来ないようにぶら下げ、半角の英数字は2文字で1マスと数えます。ルビは本文だけを数え、話者名・演出などの文章以外のブロックは数えません。全話の合計のページ数は、話ごとに改ページせず続けて数えています。");

  // ===== 文字数カウンタ =====
  wgAddHeading(container, "文字数カウンタ（貼り付けて数える）");
  wgAddNote(container, "書きかけの文章をここに貼ると、同じ計算で分量を調べられます。（行頭が「や『の行は会話文、それ以外は地の文として数えます。データには保存されません）");
  const area = wgEl("textarea", "scenariobuild-textarea wg-counter-area");
  area.placeholder = "ここに文章を貼り付け";
  container.appendChild(area);
  const counterOut = wgEl("div", "wg-summary");
  container.appendChild(counterOut);
  const updateCounter = () => {
    const s = wgGetSettings();
    const paras = [];
    const text = area.value.replace(/\r\n?/g, "\n");
    if (text.trim() !== "") {
      text.split("\n").forEach(line => {
        const t = wgStripRuby(line);
        const first = t.charAt(0);
        paras.push({ text: t, indent: t !== "" && !WG_OPENERS.includes(first) && first !== "　" });
      });
    }
    const m = wgMeasure(paras, s);
    counterOut.innerHTML = "";
    const chips = wgEl("div", "wg-chips");
    chips.appendChild(wgChip("文字数", `${wgFmtNum(m.chars)}字`));
    chips.appendChild(wgChip(`原稿用紙（${wgPaperConfig(s).short}）`, wgFmtSheets(m)));
    chips.appendChild(wgChip(`小説（${wgNovelConfig(s).short}）`, wgFmtPages(m)));
    chips.appendChild(wgChip("読了", wgFmtMinutes(m.minutes, m.chars)));
    counterOut.appendChild(chips);
  };
  area.oninput = updateCounter;
  updateCounter();

  // ===== 分量の目安表 =====
  wgAddHeading(container, "分量の目安表");
  wgAddNote(container, "文字数ごとの換算です（今の設定で計算）。ジャンルの線引きは媒体や賞・出版社によって異なるので、応募する場合は必ず応募先の規定を確認してください。");
  const guideRows = [
    [1000, "掌編（ごく短い読み切り）"],
    [2000, "掌編〜ショートショート"],
    [4000, "ショートショート"],
    [10000, "短編"],
    [20000, "短編（長め）"],
    [50000, "中編"],
    [100000, "文庫本1冊（ライトノベルで一般的な分量）"],
    [200000, "長編（分厚い1冊、または上下巻）"]
  ];
  const s0 = wgGetSettings();
  const rows = guideRows.map(([chars, note]) => {
    // 目安表は「1つの長い地の文」ではなく、会話と地の文が混ざった普通の小説に近づけるため、200字ごとの段落として数える
    const paras = [];
    for (let left = chars; left > 0; left -= 200) paras.push({ text: "あ".repeat(Math.min(200, left)), indent: true });
    const m = wgMeasure(paras, s0);
    return [`${wgFmtNum(chars)}字`, wgFmtSheets(m), wgFmtPages(m), wgFmtMinutes(m.minutes, m.chars), note];
  });
  wgAddTable(container, ["文字数", `原稿用紙（${wgPaperConfig(s0).short}）`, `小説（${wgNovelConfig(s0).short}）`, "読了", "ジャンルの目安"], rows);
  wgAddNote(container, "※実際の小説は会話文で改行が多く、同じ文字数でも行数・ページ数がこの表より増えるのが普通です（上の「現在のシナリオの分量」は改行を加味して数えています）。");
}

// ----- 簡易辞書 -----
let wgDictEntriesCache = null;

function wgNormalize(text) {
  return String(text == null ? "" : text).normalize("NFKC").toLowerCase()
    .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)); // カタカナ→ひらがな（どちらで検索しても当たる）
}

function wgDictEntries() {
  if (wgDictEntriesCache) return wgDictEntriesCache;
  const source = (typeof WRITING_DICTIONARY !== "undefined" && Array.isArray(WRITING_DICTIONARY)) ? WRITING_DICTIONARY : [];
  wgDictEntriesCache = source.map(row => {
    const entry = { category: row[0] || "", term: row[1] || "", reading: row[2] || "", meaning: row[3] || "", note: row[4] || "" };
    entry.haystack = wgNormalize([entry.term, entry.reading, entry.meaning, entry.note, entry.category].join(" "));
    return entry;
  });
  return wgDictEntriesCache;
}

function wgCopyText(text, button) {
  const done = () => {
    const old = button.textContent;
    button.textContent = "コピーしました";
    setTimeout(() => { button.textContent = old; }, 1200);
  };
  const fallback = () => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch (e) { /* コピーできない環境では何もしない */ }
    ta.remove();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
  else fallback();
}

const WG_DICT_MAX_SHOWN = 80;

function renderWritingDictionaryPane(container) {
  const entries = wgDictEntries();
  wgAddNote(container, "シナリオを書く時にすぐ引ける簡易辞書です（オノマトペ・感情表現・慣用句・誤用しやすい言葉・時間や天気の言い方・色の名前・敬語と呼称・戦闘用語・同音異義語の使い分け・表記ルール・物語の用語）。ひらがな／カタカナどちらでも検索でき、スペースで区切ると全部を含むものに絞れます。このゲーム専用の用語は「用語・語彙」タブで登録します。");

  const controls = wgEl("div", "wg-dict-controls");
  const input = document.createElement("input");
  input.type = "search";
  input.className = "scenariobuild-title-input wg-dict-search";
  input.placeholder = "言葉・読み・意味で検索（例：雨　／　ぞくぞく　／　謙譲）";
  input.value = wgDictQuery;
  controls.appendChild(input);

  const categories = [];
  entries.forEach(e => { if (e.category && !categories.includes(e.category)) categories.push(e.category); });
  const select = document.createElement("select");
  select.className = "wg-dict-category";
  const allOpt = wgEl("option", "", "すべての分類");
  allOpt.value = "";
  select.appendChild(allOpt);
  categories.forEach(c => {
    const opt = wgEl("option", "", c);
    opt.value = c;
    select.appendChild(opt);
  });
  select.value = categories.includes(wgDictCategory) ? wgDictCategory : "";
  wgDictCategory = select.value;
  controls.appendChild(select);
  container.appendChild(controls);

  const countEl = wgEl("p", "devmode-note wg-dict-count");
  container.appendChild(countEl);
  const list = wgEl("div", "wg-dict-list");
  container.appendChild(list);

  const render = () => {
    const words = wgNormalize(wgDictQuery).split(/\s+/).filter(Boolean);
    const hits = entries.filter(e => (!wgDictCategory || e.category === wgDictCategory) && words.every(w => e.haystack.includes(w)));
    countEl.textContent = hits.length > WG_DICT_MAX_SHOWN
      ? `${hits.length}件ヒット（先頭の${WG_DICT_MAX_SHOWN}件を表示。言葉を足すか分類を選ぶと絞れます）`
      : `${hits.length}件（全${entries.length}件）`;
    list.innerHTML = "";
    if (entries.length === 0) { list.appendChild(wgEl("p", "devmode-note", "辞書データ（writingdict_data.js）が読み込めていません。")); return; }
    if (hits.length === 0) { list.appendChild(wgEl("p", "devmode-note", "見つかりませんでした。")); return; }
    hits.slice(0, WG_DICT_MAX_SHOWN).forEach(e => {
      const item = wgEl("div", "wg-dict-entry");
      const head = wgEl("div", "wg-dict-head");
      head.appendChild(wgEl("b", "wg-dict-term", e.term));
      if (e.reading) head.appendChild(wgEl("span", "wg-dict-reading", `（${e.reading}）`));
      head.appendChild(wgEl("span", "wg-dict-cat", e.category));
      const copyBtn = wgEl("button", "devmode-btn wg-dict-copy", "コピー");
      copyBtn.type = "button";
      copyBtn.onclick = (event) => { event.stopPropagation(); wgCopyText(e.term, copyBtn); };
      head.appendChild(copyBtn);
      item.appendChild(head);
      item.appendChild(wgEl("div", "wg-dict-meaning", e.meaning));
      if (e.note) item.appendChild(wgEl("div", "wg-dict-note", e.note));
      list.appendChild(item);
    });
  };

  let timer = null;
  input.oninput = () => {
    wgDictQuery = input.value;
    clearTimeout(timer);
    timer = setTimeout(render, 120);
  };
  select.onchange = () => { wgDictCategory = select.value; render(); };
  render();
}
