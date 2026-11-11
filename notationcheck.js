// notationcheck.js
// ★要望対応：シナリオエディタの「表記ゆれチェック」タブ。
//   全ての話（ifの中・選択肢の中も含む）と、敵の見逃し/撃破演出などのブロックから、表記のゆれを探して一覧にし、
//   ボタンで一括置換できる。
//   ① 話者名のゆれ（「神様？」と「神様」、1文字違いの名前など）
//   ② カタカナ語のゆれ（長音「ー」・中黒「・」の有無：パーティー／パーティ など）
//   ③ 全角の英数字・記号（＝・＋・Ａ・１ など）→ 半角
//   ④ 自由な置換（検索語 → 置換語。件数を確認してから置換）
//   置換は元に戻せないので、実行前に必ず確認ダイアログを出す。置換後はシナリオの「未保存の変更」扱いになる

// ★本文として置換の対象にする項目（speaker は話者名のゆれ専用なので、本文の置換には含めない）
const NOTATION_TEXT_KEYS = ["text", "prompt", "message", "defeatMessage", "farewellMessage", "messageText", "title", "endingName", "endroll", "nickname"];

// ★全ての「ブロック1件」に対して fn(block) を呼ぶ（if・選択肢の中まで再帰）
function notationWalkBlocks(blocks, fn) {
  (blocks || []).forEach(block => {
    if (!block || typeof block !== "object") return;
    fn(block);
    if (block.type === "if") {
      notationWalkBlocks(block.trueBlocks, fn);
      notationWalkBlocks(block.falseBlocks, fn);
    }
    if (block.type === "choice") {
      (block.options || []).forEach(opt => {
        if (opt && typeof opt.text === "string") fn({ type: "__choiceOption", text: opt.text, __owner: opt });
        notationWalkBlocks(opt && opt.blocks, fn);
      });
    }
  });
}

// ★調べる対象のブロック配列を全て集める（話＋敵・ボスの演出ブロック）
function notationCollectBlockLists() {
  const lists = [];
  (scenarioProject.chapters || []).forEach(chapter => lists.push({ label: chapter.title || "（無題の話）", blocks: chapter.blocks }));
  ["enemies", "bosses"].forEach(listName => {
    (scenarioProject[listName] || []).forEach(entity => {
      if (!entity) return;
      Object.keys(entity).forEach(key => {
        if (/Blocks$/.test(key) && Array.isArray(entity[key])) lists.push({ label: entity.name || entity.id || listName, blocks: entity[key] });
      });
    });
  });
  return lists;
}

// ★本文の文字列項目を全部 fn(getter, setter, blockLabel) で巡回する
function notationWalkTexts(fn) {
  notationCollectBlockLists().forEach(list => {
    notationWalkBlocks(list.blocks, block => {
      if (block.type === "__choiceOption") {
        fn(() => block.__owner.text, (v) => { block.__owner.text = v; }, list.label);
        return;
      }
      NOTATION_TEXT_KEYS.forEach(key => {
        if (typeof block[key] === "string" && block[key]) fn(() => block[key], (v) => { block[key] = v; }, list.label);
      });
    });
  });
}

function notationWalkSpeakers(fn) {
  notationCollectBlockLists().forEach(list => {
    notationWalkBlocks(list.blocks, block => {
      if (block.type === "dialogue" && typeof block.speaker === "string" && block.speaker) {
        fn(() => block.speaker, (v) => { block.speaker = v; });
      }
    });
  });
}

function notationEditDistance(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 1) return 2;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// ===== ① 話者名のゆれ =====
// 「神様？」と「神様」のように、末尾の記号・空白・中黒だけが違うものを同じ名前とみなして候補にする。
// それに加えて、3文字以上で1文字だけ違う名前（打ち間違いの疑い）も候補に出す
function notationFindSpeakerCandidates() {
  const counts = {};
  notationWalkSpeakers((get) => { const name = get(); counts[name] = (counts[name] || 0) + 1; });
  const names = Object.keys(counts);
  const normalize = (name) => name.normalize("NFKC").replace(/[\s・･·]/g, "").replace(/[?？!！…。、.]+$/g, "");
  const candidates = [];
  const seenPair = new Set();
  const addPair = (a, b, reason) => {
    const id = [a, b].sort().join("\u0000");
    if (seenPair.has(id)) return;
    seenPair.add(id);
    // 回数が多い方を「たぶん正しい方」として先に置く
    const [main, other] = counts[a] >= counts[b] ? [a, b] : [b, a];
    candidates.push({ main, other, mainCount: counts[main], otherCount: counts[other], reason });
  };
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i], b = names[j];
      const na = normalize(a), nb = normalize(b);
      if (na && na === nb) addPair(a, b, "記号・空白・中黒の違い");
      else if (na.length >= 3 && nb.length >= 3 && notationEditDistance(na, nb) === 1) addPair(a, b, "1文字違い（打ち間違いの疑い）");
    }
  }
  return candidates;
}

function notationReplaceSpeaker(from, to) {
  let n = 0;
  notationWalkSpeakers((get, set) => { if (get() === from) { set(to); n++; } });
  return n;
}

// ===== ② カタカナ語のゆれ =====
const NOTATION_KATAKANA_RE = /[ァ-ヴヵヶー・]{3,}/g;

function notationFindKatakanaCandidates() {
  const groups = {}; // キー（長音・中黒を除いたもの） -> { 表記: 回数 }
  notationWalkTexts((get) => {
    (get().match(NOTATION_KATAKANA_RE) || []).forEach(word => {
      const trimmed = word.replace(/^[ー・]+/, "").replace(/[・]+$/, "");
      if (trimmed.length < 3) return;
      if (/^[ァィゥェォッャュョヮ]/.test(trimmed) || /ー{2,}/.test(trimmed)) return; // 叫び声・伸ばし棒の強調（「ァーーーッ」など）は表記ゆれではないので除く
      const key = trimmed.replace(/[ー・]/g, "");
      if (key.length < 2) return;
      if (!groups[key]) groups[key] = {};
      groups[key][trimmed] = (groups[key][trimmed] || 0) + 1;
    });
  });
  const result = [];
  Object.keys(groups).forEach(key => {
    const variants = Object.keys(groups[key]);
    if (variants.length < 2) return;
    variants.sort((a, b) => groups[key][b] - groups[key][a]);
    result.push({ variants: variants.map(v => ({ word: v, count: groups[key][v] })) });
  });
  return result;
}

// ===== 置換の共通処理 =====
function notationCountText(search) {
  if (!search) return 0;
  let n = 0;
  notationWalkTexts((get) => { n += get().split(search).length - 1; });
  return n;
}

function notationReplaceText(search, replacement) {
  if (!search) return 0;
  let n = 0;
  notationWalkTexts((get, set) => {
    const text = get();
    const hits = text.split(search).length - 1;
    if (hits > 0) { set(text.split(search).join(replacement)); n += hits; }
  });
  return n;
}

// ===== ③ 全角の英数字・記号 =====
// 「！」「？」「（）」「、」「。」「～」「：」などは、日本語の文章では全角が普通なので対象にしない。
// 対象：全角の英数字（Ａ-Ｚ ａ-ｚ ０-９）と、＝ ＋ － ＊ ／ ＜ ＞ ％ ＆ ＃ ＄ ＠ ＾ ＿ ｜ ＼ ｀ ｛ ｝ ［ ］ の記号
const NOTATION_FULLWIDTH_RE = /[Ａ-Ｚａ-ｚ０-９＝＋－＊／＜＞％＆＃＄＠＾＿｜＼｀｛｝［］]/g;

function notationFindFullwidth() {
  const counts = {};
  notationWalkTexts((get) => {
    (get().match(NOTATION_FULLWIDTH_RE) || []).forEach(ch => { counts[ch] = (counts[ch] || 0) + 1; });
  });
  return counts;
}

function notationReplaceFullwidth() {
  let n = 0;
  notationWalkTexts((get, set) => {
    const text = get();
    const next = text.replace(NOTATION_FULLWIDTH_RE, ch => { n++; return ch.normalize("NFKC"); });
    if (next !== text) set(next);
  });
  return n;
}

// ===== 画面 =====
function notationAfterReplace(message) {
  if (typeof markScenarioBuildDirty === "function") markScenarioBuildDirty();
  if (typeof showGameAlert === "function") showGameAlert(message);
  renderScenarioBuildPanel();
}

async function notationConfirmAndRun(confirmMessage, runFn, resultLabel) {
  const ok = (typeof showGameConfirm === "function") ? await showGameConfirm(confirmMessage) : window.confirm(confirmMessage);
  if (!ok) return;
  const n = runFn();
  notationAfterReplace(`${n}件を${resultLabel}しました。`);
}

function notationAddHeading(container, text) {
  const h = document.createElement("h4");
  h.className = "scenariobuild-subheading";
  h.textContent = text;
  container.appendChild(h);
}

function notationAddNote(container, text) {
  const p = document.createElement("p");
  p.className = "devmode-note";
  p.textContent = text;
  container.appendChild(p);
  return p;
}

function notationAddButton(container, label, onClick) {
  const btn = document.createElement("button");
  btn.className = "devmode-btn";
  btn.textContent = label;
  btn.onclick = (event) => { event.stopPropagation(); onClick(); };
  container.appendChild(btn);
  return btn;
}

function renderNotationCheckManager(container) {
  notationAddNote(container, "全ての話（ifの中・選択肢の中も含む）と、敵の撃破・見逃し演出などの文章から、表記のゆれを探します。置換は元に戻せないので、実行前に確認が出ます。置換したあとは、通常どおり「保存」を忘れずに。");
  
  // ① 話者名
  notationAddHeading(container, "① 話者名のゆれ");
  const speakerCandidates = notationFindSpeakerCandidates();
  if (speakerCandidates.length === 0) {
    notationAddNote(container, "ゆれの疑いがある話者名は見つかりませんでした。");
  } else {
    notationAddNote(container, "あくまで「疑い」です（別人の場合もあります）。回数が多い方を、たぶん正しい方として左に出しています。");
    speakerCandidates.forEach(c => {
      const row = document.createElement("div");
      row.className = "scenariobuild-chapter-row";
      const label = document.createElement("span");
      label.textContent = `「${c.main}」（${c.mainCount}回） と 「${c.other}」（${c.otherCount}回）　［${c.reason}］`;
      row.appendChild(label);
      notationAddButton(row, `「${c.other}」→「${c.main}」に統一`, () => notationConfirmAndRun(
        `話者名「${c.other}」（${c.otherCount}回）を、全て「${c.main}」に置換します。よろしいですか？`,
        () => notationReplaceSpeaker(c.other, c.main), "置換"));
      notationAddButton(row, `「${c.main}」→「${c.other}」に統一`, () => notationConfirmAndRun(
        `話者名「${c.main}」（${c.mainCount}回）を、全て「${c.other}」に置換します。よろしいですか？`,
        () => notationReplaceSpeaker(c.main, c.other), "置換"));
      container.appendChild(row);
    });
  }
  
  // ② カタカナ語
  notationAddHeading(container, "② カタカナ語のゆれ（長音「ー」・中黒「・」の有無）");
  const kataCandidates = notationFindKatakanaCandidates();
  if (kataCandidates.length === 0) {
    notationAddNote(container, "ゆれの疑いがあるカタカナ語は見つかりませんでした。");
  } else {
    notationAddNote(container, "本文中のカタカナ語のうち、長音や中黒の有無だけが違うものです。統一したい表記のボタンを押すと、他の表記が全てそれに置き換わります。");
    kataCandidates.forEach(group => {
      const row = document.createElement("div");
      row.className = "scenariobuild-chapter-row";
      const label = document.createElement("span");
      label.textContent = group.variants.map(v => `「${v.word}」${v.count}回`).join(" ／ ");
      row.appendChild(label);
      group.variants.forEach(target => {
        const others = group.variants.filter(v => v.word !== target.word);
        notationAddButton(row, `「${target.word}」に統一`, () => notationConfirmAndRun(
          `${others.map(o => `「${o.word}」`).join("・")}を、全て「${target.word}」に置換します。よろしいですか？\n（他の単語の一部になっている場合も置換されます）`,
          () => others.reduce((sum, o) => sum + notationReplaceText(o.word, target.word), 0), "置換"));
      });
      container.appendChild(row);
    });
  }
  
  // ③ 全角→半角
  notationAddHeading(container, "③ 全角の英数字・記号 → 半角");
  const fullCounts = notationFindFullwidth();
  const fullKeys = Object.keys(fullCounts);
  if (fullKeys.length === 0) {
    notationAddNote(container, "全角の英数字・記号は見つかりませんでした。");
  } else {
    notationAddNote(container, `見つかったもの：${fullKeys.map(ch => `${ch}（${fullCounts[ch]}回）`).join("　")}\n（「！」「？」「（）」「、」「。」「：」は日本語では全角が普通なので対象外です）`);
    const total = fullKeys.reduce((sum, ch) => sum + fullCounts[ch], 0);
    notationAddButton(container, `全て半角にする（${total}件）`, () => notationConfirmAndRun(
      `全角の英数字・記号 ${total}件を、半角に置換します。よろしいですか？`, () => notationReplaceFullwidth(), "置換"));
  }
  
  // ④ 自由置換
  notationAddHeading(container, "④ 自由な置換");
  notationAddNote(container, "検索語を入れると、見つかった件数が出ます。（話者名は対象外。本文・選択肢・テロップなどが対象です）");
  const form = document.createElement("div");
  form.className = "scenariobuild-chapter-row";
  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "検索語（例：パーティー）";
  const replaceInput = document.createElement("input");
  replaceInput.type = "text";
  replaceInput.placeholder = "置換語（例：パーティ）";
  const countEl = document.createElement("span");
  countEl.textContent = "";
  searchInput.oninput = () => {
    countEl.textContent = searchInput.value ? `　${notationCountText(searchInput.value)}件見つかりました` : "";
  };
  form.appendChild(searchInput);
  form.appendChild(document.createTextNode(" → "));
  form.appendChild(replaceInput);
  notationAddButton(form, "置換する", () => {
    const search = searchInput.value;
    if (!search) return;
    const hits = notationCountText(search);
    if (hits === 0) { if (typeof showGameAlert === "function") showGameAlert("見つかりませんでした。"); return; }
    notationConfirmAndRun(`「${search}」（${hits}件）を、全て「${replaceInput.value}」に置換します。よろしいですか？`,
      () => notationReplaceText(search, replaceInput.value), "置換");
  });
  form.appendChild(countEl);
  container.appendChild(form);
}
