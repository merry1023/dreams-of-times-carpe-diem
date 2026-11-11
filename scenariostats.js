// scenariostats.js
// ★要望対応：シナリオエディタ「データ・システム」グループの「統計」タブ。
//   全話・各話の文字数、キャラごとの発言回数、総ブロック数、演出の数、ブロック種類ごとの使用回数などを一覧する。
//   ifブロック・選択肢の中に入れ子になっているブロックも全て数える。見るだけのタブで、データは一切書き換えない。
//   ・文字数は、改行と空白を除いた文字数（絵文字などは1文字として数える）
//   ・「演出ブロック」＝ 演出効果・テロップ・背景変更・BGM／BGM停止・効果音・立ち絵の各ブロック

// ★「演出ブロック」として数える種類
const STATS_PRODUCTION_TYPES = ["effect", "telop", "background", "bgm", "bgmstop", "se", "portrait_show", "portrait_expression", "portrait_move", "portrait_motion"];

let scenarioStatsSelectedChapter = "all"; // "all"（全話）または話のid

function statsCountChars(text) {
  if (typeof text !== "string") return 0;
  return Array.from(text.replace(/\s+/g, "")).length;
}

function statsNewBucket() {
  return {
    blockTotal: 0,
    byType: {},          // ブロック種類 -> 使用回数
    effectTypes: {},     // 演出効果の種類 -> 回数
    speakers: {},        // 話者名 -> { lines, chars }
    chars: { dialogue: 0, narration: 0, telop: 0, choice: 0 },
    productionTotal: 0,
    ifCount: 0,
    choiceCount: 0,
    optionCount: 0,
    maxDepth: 0
  };
}

// ★ブロック配列を数える（depth：今の入れ子の深さ。話の直下が1）
function statsCountBlocks(blocks, bucket, depth) {
  (blocks || []).forEach(block => {
    if (!block || typeof block !== "object") return;
    bucket.blockTotal++;
    bucket.maxDepth = Math.max(bucket.maxDepth, depth);
    const type = block.type || "(不明)";
    bucket.byType[type] = (bucket.byType[type] || 0) + 1;
    if (STATS_PRODUCTION_TYPES.includes(type)) bucket.productionTotal++;
    
    if (type === "dialogue") {
      const name = block.speaker || "（話者なし）";
      if (!bucket.speakers[name]) bucket.speakers[name] = { lines: 0, chars: 0 };
      const n = statsCountChars(block.text);
      bucket.speakers[name].lines++;
      bucket.speakers[name].chars += n;
      bucket.chars.dialogue += n;
    } else if (type === "narration") {
      bucket.chars.narration += statsCountChars(block.text);
    } else if (type === "telop") {
      bucket.chars.telop += statsCountChars(block.text);
    } else if (type === "effect") {
      const key = block.effectType || "(不明)";
      bucket.effectTypes[key] = (bucket.effectTypes[key] || 0) + 1;
    } else if (type === "if") {
      bucket.ifCount++;
      statsCountBlocks(block.trueBlocks, bucket, depth + 1);
      statsCountBlocks(block.falseBlocks, bucket, depth + 1);
    } else if (type === "choice") {
      bucket.choiceCount++;
      bucket.chars.choice += statsCountChars(block.prompt);
      (block.options || []).forEach(opt => {
        if (!opt) return;
        bucket.optionCount++;
        bucket.chars.choice += statsCountChars(opt.text);
        statsCountBlocks(opt.blocks, bucket, depth + 1);
      });
    }
  });
}

function statsComputeChapter(chapter) {
  const bucket = statsNewBucket();
  statsCountBlocks(chapter && chapter.blocks, bucket, 1);
  return bucket;
}

function statsMerge(buckets) {
  const total = statsNewBucket();
  const addMap = (target, source) => Object.keys(source).forEach(k => { target[k] = (target[k] || 0) + source[k]; });
  buckets.forEach(b => {
    total.blockTotal += b.blockTotal;
    addMap(total.byType, b.byType);
    addMap(total.effectTypes, b.effectTypes);
    Object.keys(b.speakers).forEach(name => {
      if (!total.speakers[name]) total.speakers[name] = { lines: 0, chars: 0 };
      total.speakers[name].lines += b.speakers[name].lines;
      total.speakers[name].chars += b.speakers[name].chars;
    });
    Object.keys(b.chars).forEach(k => { total.chars[k] += b.chars[k]; });
    total.productionTotal += b.productionTotal;
    total.ifCount += b.ifCount;
    total.choiceCount += b.choiceCount;
    total.optionCount += b.optionCount;
    total.maxDepth = Math.max(total.maxDepth, b.maxDepth);
  });
  return total;
}

function statsTotalChars(b) {
  return b.chars.dialogue + b.chars.narration + b.chars.telop + b.chars.choice;
}

function statsTypeLabel(type) {
  if (typeof SCENARIO_BLOCK_TYPES !== "undefined" && SCENARIO_BLOCK_TYPES[type]) return SCENARIO_BLOCK_TYPES[type];
  return type;
}

function statsEffectLabel(type) {
  if (typeof SCENARIO_TEXT_EFFECT_LABELS !== "undefined" && SCENARIO_TEXT_EFFECT_LABELS[type]) return SCENARIO_TEXT_EFFECT_LABELS[type];
  return type;
}

function statsFormat(n) {
  return Number(n).toLocaleString("ja-JP");
}

// ===== 画面 =====
function statsAddHeading(container, text) {
  const h = document.createElement("h4");
  h.className = "scenariobuild-subheading";
  h.textContent = text;
  container.appendChild(h);
}

function statsAddNote(container, text) {
  const p = document.createElement("p");
  p.className = "devmode-note";
  p.textContent = text;
  container.appendChild(p);
}

// ★表を作る。headers：見出し行、rows：行の配列（各行は文字列/数値の配列）。横に長い時は横スクロール
function statsAddTable(container, headers, rows) {
  const wrap = document.createElement("div");
  wrap.className = "scenario-stats-wrap";
  const table = document.createElement("table");
  table.className = "scenario-stats-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headers.forEach(h => { const th = document.createElement("th"); th.textContent = h; headRow.appendChild(th); });
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  rows.forEach(row => {
    const tr = document.createElement("tr");
    row.forEach((cell, i) => {
      const td = document.createElement("td");
      td.textContent = typeof cell === "number" ? statsFormat(cell) : cell;
      if (typeof cell === "number" || i > 0) td.className = "scenario-stats-num";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  container.appendChild(wrap);
}

function renderScenarioStatsManager(container) {
  const chapters = Array.isArray(scenarioProject.chapters) ? scenarioProject.chapters : [];
  statsAddNote(container, "全ての話の文章量・ブロック数・演出数などを集計します。ifブロック・選択肢の中に入れ子になっているブロックも全て数えます。（文字数は改行・空白を除いた数です。見るだけのタブで、データは書き換えません）");
  
  if (chapters.length === 0) {
    statsAddNote(container, "まだ話がありません。");
    return;
  }
  
  const perChapter = chapters.map(chapter => ({ chapter, stats: statsComputeChapter(chapter) }));
  const allStats = statsMerge(perChapter.map(e => e.stats));
  
  // ===== 話ごとの一覧（全話の合計つき） =====
  statsAddHeading(container, "話ごとの一覧");
  const overviewRows = perChapter.map(({ chapter, stats }, i) => [
    `${i + 1}. ${chapter.title || "（無題）"}`, statsTotalChars(stats), stats.chars.dialogue, stats.chars.narration,
    stats.blockTotal, stats.productionTotal, stats.choiceCount, stats.ifCount, stats.maxDepth
  ]);
  overviewRows.push(["全話の合計", statsTotalChars(allStats), allStats.chars.dialogue, allStats.chars.narration,
    allStats.blockTotal, allStats.productionTotal, allStats.choiceCount, allStats.ifCount, allStats.maxDepth]);
  statsAddTable(container, ["話", "総文字数", "会話", "地の文", "ブロック数", "演出", "選択肢", "if", "最大の入れ子"], overviewRows);
  
  // ===== 詳細（全話／話を選んで見る） =====
  statsAddHeading(container, "詳細");
  const selectRow = document.createElement("div");
  selectRow.className = "scenariobuild-chapter-row";
  const select = document.createElement("select");
  const allOpt = document.createElement("option");
  allOpt.value = "all";
  allOpt.textContent = "全話の合計";
  select.appendChild(allOpt);
  chapters.forEach((chapter, i) => {
    const opt = document.createElement("option");
    opt.value = chapter.id;
    opt.textContent = `${i + 1}. ${chapter.title || "（無題）"}`;
    select.appendChild(opt);
  });
  if (scenarioStatsSelectedChapter !== "all" && !chapters.some(c => c.id === scenarioStatsSelectedChapter)) scenarioStatsSelectedChapter = "all";
  select.value = scenarioStatsSelectedChapter;
  select.onchange = () => { scenarioStatsSelectedChapter = select.value; renderScenarioBuildPanel(); };
  selectRow.appendChild(select);
  container.appendChild(selectRow);
  
  const stats = scenarioStatsSelectedChapter === "all" ? allStats : (perChapter.find(e => e.chapter.id === scenarioStatsSelectedChapter) || { stats: allStats }).stats;
  
  // 文章量
  statsAddTable(container, ["項目", "数"], [
    ["総文字数（会話＋地の文＋テロップ＋選択肢）", statsTotalChars(stats)],
    ["　会話の文字数", stats.chars.dialogue],
    ["　地の文の文字数", stats.chars.narration],
    ["　テロップの文字数", stats.chars.telop],
    ["　選択肢（質問文・選択肢文）の文字数", stats.chars.choice],
    ["総ブロック数（入れ子の中も含む）", stats.blockTotal],
    ["会話ブロック数（発言の総数）", stats.byType.dialogue || 0],
    ["地の文ブロック数", stats.byType.narration || 0],
    ["演出ブロック数（効果・テロップ・背景・BGM・効果音・立ち絵）", stats.productionTotal],
    ["選択肢ブロック数（選択肢の項目の総数）", `${statsFormat(stats.choiceCount)}（項目 ${statsFormat(stats.optionCount)}）`],
    ["ifブロック数", stats.ifCount],
    ["最大の入れ子の深さ", stats.maxDepth]
  ]);
  
  // キャラごとの発言
  statsAddHeading(container, "キャラごとの発言");
  const speakerNames = Object.keys(stats.speakers).sort((a, b) => stats.speakers[b].lines - stats.speakers[a].lines);
  if (speakerNames.length === 0) {
    statsAddNote(container, "会話ブロックがありません。");
  } else {
    const totalLines = speakerNames.reduce((sum, n) => sum + stats.speakers[n].lines, 0);
    statsAddTable(container, ["話者", "発言回数", "割合", "文字数", "1回あたり"], speakerNames.map(name => {
      const s = stats.speakers[name];
      return [name, s.lines, `${(s.lines / totalLines * 100).toFixed(1)}%`, s.chars, (s.chars / s.lines).toFixed(1)];
    }));
  }
  
  // 演出効果の内訳
  statsAddHeading(container, "演出の内訳");
  const effectKeys = Object.keys(stats.effectTypes).sort((a, b) => stats.effectTypes[b] - stats.effectTypes[a]);
  const productionRows = STATS_PRODUCTION_TYPES.filter(t => (stats.byType[t] || 0) > 0).map(t => [statsTypeLabel(t), stats.byType[t]]);
  if (productionRows.length === 0) {
    statsAddNote(container, "演出ブロックがありません。");
  } else {
    statsAddTable(container, ["演出ブロックの種類", "回数"], productionRows);
  }
  if (effectKeys.length > 0) {
    statsAddNote(container, "演出効果（シェイク・暗転・天候など）の種類ごとの回数");
    statsAddTable(container, ["演出効果", "回数"], effectKeys.map(k => [statsEffectLabel(k), stats.effectTypes[k]]));
  }
  
  // ブロック種類ごとの使用回数
  statsAddHeading(container, "ブロックの使用回数");
  const typeKeys = Object.keys(stats.byType).sort((a, b) => stats.byType[b] - stats.byType[a]);
  statsAddTable(container, ["ブロックの種類", "使用回数", "割合"], typeKeys.map(t => [statsTypeLabel(t), stats.byType[t], `${(stats.byType[t] / stats.blockTotal * 100).toFixed(1)}%`]));
  if (typeof SCENARIO_BLOCK_TYPES !== "undefined") {
    const unused = Object.keys(SCENARIO_BLOCK_TYPES).filter(t => !stats.byType[t]).map(statsTypeLabel);
    if (unused.length > 0) statsAddNote(container, `まだ使っていないブロック：${unused.join("、")}`);
  }
}
