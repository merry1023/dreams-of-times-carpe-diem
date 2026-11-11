// scenariotext.js
// ★要望対応：シナリオデータを「純粋なシナリオ文章のみ」のtxt／mdファイルとして書き出す。
//   ・会話文      → 話者名:｢ 文章｣
//   ・地の文      → そのまま文字
//   ・テロップ・演出・その他のゲーム処理ブロック → 〈種類名〉「内容」
//   ・IF条件分岐／選択肢 → if(条件){ 内容 }elif(条件){ 内容 }else{ 内容 }
//   （選択肢は、1つ目を if(選択肢「質問文」:「選択肢文」){ 内容 }、2つ目以降を }elif(選択肢「質問文」:「選択肢文」){ 内容 } と繋げて書き出す。
//     IFの「偽の時」の中身がIFブロック1つだけの場合も、}elif(条件){ として繋げる）
//   ・各ブロックの行頭に、話ごとの通し番号（入れ子の中も含め、上から順に1,2,3…）を [番号] の形で付ける
//   ・ジャンプ系ブロックは、ジャンプ先のブロック番号を →[番号] の形で書く
//   データ管理タブ（scenariobuild.js）のボタンから exportScenarioAsTextFile("txt" | "md") を呼ぶ。
//   書き出し専用で、ゲームデータ（scenarioProject）は一切書き換えない。

const SCENARIO_TEXT_EFFECT_LABELS = {
  shake: "カメラシェイク",
  flash: "ヒットエフェクト",
  flashWhite: "白フラッシュ",
  monochromeOn: "モノクロ開始",
  monochromeOff: "モノクロ終了",
  sepiaOn: "セピア調開始",
  sepiaOff: "セピア調終了",
  invertOn: "色反転開始",
  invertOff: "色反転終了",
  blackoutOn: "暗転",
  blackoutOff: "暗転解除",
  vignetteOn: "ヴィネット開始",
  vignetteOff: "ヴィネット終了",
  blurOn: "ぼかし開始",
  blurOff: "ぼかし終了",
  zoomIn: "ズーム",
  zoomOut: "ズーム解除",
  weatherRainOn: "雨",
  weatherSnowOn: "雪",
  weatherSakuraOn: "桜吹雪",
  weatherThunderstormOn: "雷雨",
  weatherHailOn: "雹",
  weatherOff: "天候演出終了"
};

// ★ID → 表示名の引き当て。プロジェクト上の一覧 → ゲーム本体のマスターの順に探し、無ければIDのまま出す
function scTxtFindName(listName, id) {
  if (id == null || id === "") return "（未指定）";
  const project = (typeof scenarioProject !== "undefined" && scenarioProject) ? scenarioProject : {};
  const list = Array.isArray(project[listName]) ? project[listName] : [];
  const hit = list.find(e => e && (e.id === id || e.key === id));
  if (hit && hit.name) return hit.name;
  if (listName === "items" || listName === "fishItems") {
    const fish = (project.fishItems || []).find(e => e && e.id === id);
    if (fish && fish.name) return fish.name;
    if (typeof ITEM_MASTER !== "undefined" && ITEM_MASTER[id] && ITEM_MASTER[id].name) return ITEM_MASTER[id].name;
  }
  return String(id);
}

function scTxtQuote(text) {
  return `「${text == null ? "" : text}」`;
}

// ★ジャンプ先（ブロックID）の説明。話の中（入れ子の中も含む）から探して「種類：冒頭の文章」で表す
function scTxtCollectBlocks(blocks, out) {
  (blocks || []).forEach(block => {
    if (!block) return;
    out[block.id] = block;
    if (block.type === "if") {
      scTxtCollectBlocks(block.trueBlocks, out);
      scTxtCollectBlocks(block.falseBlocks, out);
    }
    if (block.type === "choice") (block.options || []).forEach(opt => scTxtCollectBlocks(opt.blocks, out));
  });
  return out;
}

// ★ブロック番号を振る。書き出す順（上から下、入れ子の中も含む：IFは真→偽、選択肢は選択肢1→2…）と同じ順で1から数える
function scTxtNumberBlocks(blocks, ctx) {
  (blocks || []).forEach(block => {
    if (!block) return;
    ctx.counter += 1;
    ctx.numberOf.set(block, ctx.counter);
    if (block.type === "if") {
      scTxtNumberBlocks(block.trueBlocks, ctx);
      scTxtNumberBlocks(block.falseBlocks, ctx);
    }
    if (block.type === "choice") (block.options || []).forEach(opt => scTxtNumberBlocks(opt.blocks, ctx));
  });
}

// ★番号を桁をそろえた文字にする（例：総数120件なら 007 → [007]）
function scTxtNumberText(ctx, block) {
  const n = ctx.numberOf.get(block);
  if (n == null) return "";
  return `[${String(n).padStart(ctx.width, "0")}]`;
}

// ★行頭に付けるブロック番号（後ろに半角スペース1つ）
function scTxtLabel(ctx, block) {
  const text = scTxtNumberText(ctx, block);
  return text ? `${text} ` : "";
}

function scTxtBlockTypeLabel(type) {
  if (typeof SCENARIO_BLOCK_TYPES !== "undefined" && SCENARIO_BLOCK_TYPES[type]) return SCENARIO_BLOCK_TYPES[type];
  return type;
}

function scTxtJumpTarget(ctx, targetId) {
  if (!targetId) return "（次のブロック）";
  const block = ctx.blockMap[targetId];
  if (!block) return "（不明なブロック）";
  let head = "";
  if (typeof block.text === "string") head = block.text;
  else if (block.type === "choice") head = block.prompt || "";
  else if (block.type === "bgm") head = block.track || "";
  else if (block.type === "background") head = block.path || "";
  head = head.replace(/\s+/g, " ").slice(0, 16);
  const num = scTxtNumberText(ctx, block);
  const arrow = num ? `→${num} ` : "";
  return head ? `${arrow}${scTxtBlockTypeLabel(block.type)}：${head}` : `${arrow}${scTxtBlockTypeLabel(block.type)}`;
}

// ★IF条件1件を文字にする（例：echichi=ON／主人公のレベル>=10／薬草を持っている）
function scTxtConditionSide(kind, value) {
  switch (kind) {
    case "flag": return value || "（フラグ未指定）";
    case "variable": return value || "（変数未指定）";
    case "level": return "主人公のレベル";
    case "hp": return "主人公の体力";
    case "sp": return "主人公のSP";
    case "class": return "主人公の職業";
    case "bossHp": return "ボスの体力(%)";
    case "turnCount": return "経過ターン数";
    case "hasItem": return `${scTxtFindName("items", value)}を持っている`;
    case "random": return "乱数(0〜100)";
    case "bool": return (value === "t" || value === true || value === "true") ? "ON" : "OFF";
    case "number":
    case "string":
    default: return value == null ? "" : String(value);
  }
}

function scTxtCondition(cond) {
  const left = scTxtConditionSide(cond.leftKind, cond.leftValue);
  let text;
  if (cond.leftKind === "hasItem" && (cond.rightKind === "bool" || cond.rightKind == null)) {
    // 「アイテムを持っているか」は t/f と比較する形なので、読みやすく言い換える
    const isTrue = (cond.operator === "!=") ? !(cond.rightValue === "t") : (cond.rightValue === "t");
    text = isTrue ? left : left.replace("を持っている", "を持っていない");
  } else {
    const right = scTxtConditionSide(cond.rightKind, cond.rightValue);
    text = `${left}${cond.operator || "="}${right}`;
  }
  return cond.negate ? `!(${text})` : text;
}

function scTxtConditions(block) {
  const conds = Array.isArray(block.conditions) ? block.conditions : [];
  if (conds.length === 0) return "（条件なし）";
  return conds.map(scTxtCondition).join(block.combineMode === "OR" ? " OR " : " AND ");
}

// ★パラメータ変更ブロックの説明（scenariobuild.js の blockPreviewText と同じ言い回し）
function scTxtChangeParam(block) {
  const GAUGE = { hp: "HP", sp: "SP", sleepiness: "眠気", fatigue: "疲労度" };
  const project = (typeof scenarioProject !== "undefined" && scenarioProject) ? scenarioProject : {};
  const target = block.target === "companion"
    ? scTxtFindName("companions", block.companionId)
    : block.target === "allCompanions" ? "仲間全員" : "主人公";
  const amount = block.amount || 0;
  const mode = block.mode === "full" ? "全回復"
    : block.mode === "empty" ? "0にする"
    : block.mode === "set" ? `${amount}にする`
    : `${amount >= 0 ? "+" : ""}${amount}`;
  return `${target}の${GAUGE[block.gauge] || "HP"}を${mode}`;
}

function scTxtEndingTypeLabel(type) {
  return type === "bad" ? "バッド" : type === "happy" ? "ハッピー" : "トゥルー";
}

// ★ブロック1件 → 行の配列。入れ子（if・選択肢の中身）は再帰で書き出す
function scTxtRenderBlock(ctx, block) {
  const lines = [];
  const tag = (name, content) => (content === undefined ? `〈${name}〉` : `〈${name}〉${scTxtQuote(content)}`);
  const jumpLine = (name, id) => { if (id) lines.push(tag(name, scTxtJumpTarget(ctx, id))); };

  switch (block.type) {
    case "dialogue":
      lines.push(`${block.speaker || ""}:｢ ${block.text || ""}｣`);
      break;
    case "narration":
      lines.push(block.text || "");
      break;
    case "telop":
      lines.push(tag("テロップ", block.text || ""));
      break;
    case "effect":
      lines.push(tag(SCENARIO_TEXT_EFFECT_LABELS[block.effectType] || block.effectType || "演出"));
      break;
    case "background":
      lines.push(tag("背景変更", block.path || ""));
      break;
    case "bgm":
      lines.push(tag("BGM切り替え", block.track || ""));
      break;
    case "bgmstop":
      lines.push(tag("BGMを止める"));
      break;
    case "se":
      lines.push(tag("効果音", block.path || ""));
      break;
    case "flag": {
      const mode = block.mode === "off" ? "OFFにする" : block.mode === "toggle" ? "ON/OFFを切り替える" : "ONにする";
      lines.push(tag("フラグ", `${block.flagName || "（未指定）"}を${mode}`));
      break;
    }
    case "setvar": {
      const amount = block.amount || 0;
      const mode = block.mode === "add" ? `+${amount}` : block.mode === "subtract" ? `-${amount}` : `${amount}にする`;
      lines.push(tag("変数", `${block.varName || "（未指定）"}を${mode}`));
      break;
    }
    case "changeparam":
      lines.push(tag("パラメータ変更", scTxtChangeParam(block)));
      break;
    case "give":
      lines.push(tag("アイテム付与", `${scTxtFindName("items", block.itemId)}×${block.quantity || 1}`));
      break;
    case "takeitem":
      lines.push(tag("アイテム消費", `${scTxtFindName("items", block.itemId)}×${block.quantity || 1}`));
      break;
    case "battle": {
      const enemies = (block.enemies || []).filter(Boolean).map(id => scTxtFindName("enemies", id)).join("＋");
      lines.push(tag("通常戦闘", enemies + (block.level != null ? `（Lv.${block.level}）` : "")));
      jumpLine("勝利時ジャンプ", block.winJumpBlockId);
      jumpLine("敗北時ジャンプ", block.defeatJumpBlockId);
      if (block.defeatMessage) lines.push(tag("敗北時メッセージ", block.defeatMessage));
      break;
    }
    case "bossbattle": {
      const boss = scTxtFindName("bosses", block.bossKey);
      const escorts = (block.escorts || []).filter(Boolean).map(id => scTxtFindName("enemies", id));
      lines.push(tag("ボス戦闘", boss + (escorts.length ? `＋${escorts.join("＋")}` : "")));
      jumpLine("勝利時ジャンプ", block.winJumpBlockId);
      jumpLine("敗北時ジャンプ", block.defeatJumpBlockId);
      if (block.defeatMessage) lines.push(tag("敗北時メッセージ", block.defeatMessage));
      break;
    }
    case "classselect":
      lines.push(tag("職業選択"));
      break;
    case "setrank":
      lines.push(tag("二つ名設定", block.nickname || ""));
      break;
    case "gameover":
      lines.push(tag("ゲームオーバー", block.message || ""));
      if (block.endingName) lines.push(tag("エンディング名", block.endingName));
      jumpLine("リトライ位置", block.retryJumpBlockId);
      break;
    case "ending":
      lines.push(tag(`エンディング（${scTxtEndingTypeLabel(block.endingType)}）`, block.title || ""));
      if (block.endrollEnabled !== false && block.endroll) lines.push(tag("エンドロール", block.endroll));
      break;
    case "clearchapter":
      lines.push(tag("話クリア", block.resetProgress ? "冒険の進行をリセット" : undefined));
      if (block.endrollEnabled && block.endroll) lines.push(tag("エンドロール", block.endroll));
      break;
    case "addcompanion":
      lines.push(tag("仲間追加", `${scTxtFindName("companions", block.companionId)}（Lv.${block.initialLevel || 1}）`));
      break;
    case "removecompanion":
      lines.push(tag("仲間離脱", scTxtFindName("companions", block.companionId)));
      if (block.farewellMessage) lines.push(tag("別れのメッセージ", block.farewellMessage));
      break;
    case "portrait_show": {
      if (block.mode === "hideAll") { lines.push(tag("立ち絵全員非表示")); break; }
      if (block.mode === "hide") { lines.push(tag("立ち絵非表示", block.instanceId || "（未指定）")); break; }
      const project = (typeof scenarioProject !== "undefined" && scenarioProject) ? scenarioProject : {};
      const ch = (project.portraitCharacters || []).find(c => c.id === block.characterId);
      lines.push(tag("立ち絵表示", `${ch ? ch.name : "（未選択）"}（位置${block.position != null ? block.position : 50}）`));
      break;
    }
    case "portrait_expression":
      lines.push(tag("立ち絵表情変更", block.instanceId || "（未指定）"));
      break;
    case "portrait_move":
      lines.push(tag("立ち絵移動", `${block.instanceId || "（未指定）"}を位置${block.position != null ? block.position : 50}へ`));
      break;
    case "portrait_motion":
      lines.push(tag("立ち絵の動き", `${block.instanceId || "（未指定）"}が${block.motionType === "shake" ? "震える" : "ジャンプ"}`));
      break;
    case "increment_area_visit": {
      const project = (typeof scenarioProject !== "undefined" && scenarioProject) ? scenarioProject : {};
      const area = (project.mapAreas || []).find(a => a.locationKey === block.areaKey);
      lines.push(tag("エリア来訪回数+1", area ? area.name : (block.areaKey || "（未選択）")));
      break;
    }
    case "jump":
      lines.push(tag("ジャンプ", scTxtJumpTarget(ctx, block.targetBlockId)));
      break;
    case "levelcap":
      lines.push(tag("レベル上限", String(block.level != null ? block.level : 1)));
      break;
    case "bossRemoveInvincibility":
      lines.push(tag("ボス演出：無敵解除", block.messageText || ""));
      break;
    case "bossSummonAlly":
      lines.push(tag("ボス演出：仲間を呼ぶ", scTxtFindName("enemies", block.allyMonsterKey)));
      if (block.messageText) lines.push(tag("ボス演出メッセージ", block.messageText));
      break;
    case "bossHeal":
      lines.push(tag("ボス演出：HP回復", `最大HPの${Math.round((block.healRatio || 0) * 100)}%`));
      if (block.messageText) lines.push(tag("ボス演出メッセージ", block.messageText));
      break;
    case "bossUseSkill":
      lines.push(tag("ボス演出：技を撃つ", block.skillName || "（未指定）"));
      break;
    case "if": {
      // 「偽の時」の中身がIFブロック1つだけなら、else{ if… } ではなく }elif(条件){ と繋げて書く（何段続いても同じ）
      let cur = block;
      let head = `${scTxtLabel(ctx, cur)}if(${scTxtConditions(cur)}){`;
      while (cur) {
        lines.push(head);
        lines.push("");
        const trueLines = scTxtRenderBlocks(ctx, cur.trueBlocks);
        if (trueLines.length) lines.push(...trueLines, "");
        else if (cur.trueJumpBlockId) lines.push(tag("ジャンプ", scTxtJumpTarget(ctx, cur.trueJumpBlockId)), "");
        const falseBlocks = cur.falseBlocks || [];
        const onlyIf = falseBlocks.length === 1 && falseBlocks[0] && falseBlocks[0].type === "if" && !cur.falseJumpBlockId;
        if (onlyIf) {
          cur = falseBlocks[0];
          head = `${scTxtLabel(ctx, cur)}}elif(${scTxtConditions(cur)}){`;
          continue;
        }
        const hasElse = falseBlocks.length > 0 || !!cur.falseJumpBlockId; // 偽の時の中身がある時だけelseを付ける
        if (hasElse) {
          lines.push("}else{");
          lines.push("");
          const falseLines = scTxtRenderBlocks(ctx, cur.falseBlocks);
          if (falseLines.length) lines.push(...falseLines, "");
          else if (cur.falseJumpBlockId) lines.push(tag("ジャンプ", scTxtJumpTarget(ctx, cur.falseJumpBlockId)), "");
        }
        lines.push("}");
        cur = null;
      }
      break;
    }
    case "choice": {
      // 選択肢は、1つ目を if(…){、2つ目以降を }elif(…){ と繋げて書き出す
      const options = block.options || [];
      options.forEach((opt, i) => {
        const cond = `選択肢${scTxtQuote(block.prompt || "")}:${scTxtQuote(opt.text || "")}`;
        lines.push(i === 0 ? `${scTxtLabel(ctx, block)}if(${cond}){` : `}elif(${cond}){`);
        lines.push("");
        const inner = scTxtRenderBlocks(ctx, opt.blocks);
        if (inner.length) lines.push(...inner, "");
        if (opt.isCorrect) lines.push(tag("正解"), "");
        if (opt.jumpBlockId) lines.push(tag("ジャンプ", scTxtJumpTarget(ctx, opt.jumpBlockId)), "");
        if (opt.loops) lines.push(tag("選択肢に戻る"), "");
      });
      if (options.length) lines.push("}");
      else lines.push(`${scTxtLabel(ctx, block)}${tag("選択肢", block.prompt || "")}`); // 選択肢が0件の時は、せめて質問文だけ出す
      break;
    }
    default: {
      // 戦闘中の演出ブロックなど、ここに書いていない種類も、種類名＋文章があればそのまま出す
      const content = [block.text, block.messageText, block.message].find(v => typeof v === "string" && v);
      lines.push(content !== undefined ? tag(scTxtBlockTypeLabel(block.type), content) : tag(scTxtBlockTypeLabel(block.type)));
    }
  }
  // 行頭にブロック番号を付ける（IF・選択肢は、上の処理の中で「if(」の行にだけ付けてある）。
  // 複数行になるブロック（戦闘のジャンプ行など）は、1行目だけに付け、続きの行は番号なしで直後に並べる
  if (block.type !== "if" && block.type !== "choice" && lines.length) lines[0] = scTxtLabel(ctx, block) + lines[0];
  return lines;
}

// ★ブロック配列 → 行の配列（1ブロックにつき1行〜数行。純粋な文章として読めるよう、ブロック間に空行は入れない）
function scTxtRenderBlocks(ctx, blocks) {
  const lines = [];
  (blocks || []).forEach(block => {
    if (!block) return;
    lines.push(...scTxtRenderBlock(ctx, block));
  });
  return lines;
}

// ★話1件 → 行の配列
function scTxtRenderChapter(chapter) {
  const ctx = { blockMap: scTxtCollectBlocks(chapter.blocks, {}), numberOf: new Map(), counter: 0, width: 1 };
  scTxtNumberBlocks(chapter.blocks, ctx);
  ctx.width = String(ctx.counter).length; // 番号の桁数（総数に合わせてゼロ埋めする）
  return scTxtRenderBlocks(ctx, chapter.blocks);
}

// ★全話のテキストを作る。format: "txt"（■見出し）／"md"（#見出し）
function buildScenarioText(format) {
  const project = (typeof scenarioProject !== "undefined" && scenarioProject) ? scenarioProject : { chapters: [], chapterArcs: [] };
  const isMd = format === "md";
  const arcs = Array.isArray(project.chapterArcs) ? project.chapterArcs : [];
  const out = [];
  let lastArcId = Symbol("none");
  (project.chapters || []).forEach(chapter => {
    const arcId = chapter.arcId || null;
    if (arcId !== lastArcId) {
      lastArcId = arcId;
      const arc = arcs.find(a => a.id === arcId);
      if (arc && arc.name) {
        out.push(isMd ? `# ${arc.name}` : `◆◆ ${arc.name} ◆◆`, "");
      }
    }
    out.push(isMd ? `## ${chapter.title || ""}` : `■ ${chapter.title || ""}`, "");
    const body = scTxtRenderChapter(chapter);
    out.push(...body, "", "");
  });
  return out.join("\n").replace(/\n{4,}/g, "\n\n\n").trimEnd() + "\n";
}

function exportScenarioAsTextFile(format) {
  const ext = format === "md" ? "md" : "txt";
  const text = buildScenarioText(ext);
  const blob = new Blob([text], { type: ext === "md" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `scenario_text.${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
