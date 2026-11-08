// glossary_app.js
// ===================================================================
// ===== 便利タブの「用語・語彙」アプリ =====
// ===================================================================
// ★このゲーム専用の用語と、ことわざ・熟語などの語彙を、ルビ（ふりがな）と意味の解説つきで一覧できるアプリ。
//   データは scenarioProject.glossary（エディタの「用語・語彙」タブで編集）：
//   [{ id, term, reading, category, meaning, aliases, example }, ...]
//     term＝見出しの言葉／reading＝読み（ルビ）／category＝分類／meaning＝意味の解説（ルビ記法 {/漢字}={\かんじ} も使える）
//     aliases＝同じ言葉として扱う別の書き方（「、」「,」区切り。例：月刊魔法記事の「月間魔法記事」）／example＝用例（任意）
// ★メッセージ表示中に、解説のある言葉をタップ（クリック）すると、このアプリの解説ページへ飛ぶ。
//   リンクのしかたは2つ：①話編集のブロックで、文字を選んで言葉にリンクさせる（{/文字}={@用語ID}。ルビとよく似た書き方）
//   ②リンクが無い場所は、「言葉」「別の書き方」と同じ文字を自動で探す（autoLink が false の言葉は自動の対象外）
//   言葉の見た目は変えない（色も変わらない）。解説のある言葉以外をタップした時は、今まで通りメッセージが進む。
//   解説を見終わったら「メッセージに戻る」（またはキャンセルキー）で、元の画面に戻ってメッセージの続きを読める。
// ★キー操作：上下＝ボタンの移動／決定キー＝押す／キャンセルキー＝ひとつ前の画面へ

const GLOSSARY_CATEGORIES = ["ゲーム用語", "熟語", "慣用句・ことわざ", "一般語彙", "ネット・俗語"];

let glossaryView = "home";            // "home"（分類の一覧）／"list"（その分類の言葉の一覧）／"detail"（解説）
let glossaryCategoryFilter = "all";   // list で見ている分類（"all"＝すべて）
let glossaryDetailId = "";
let glossaryFromMessage = false;      // メッセージのタップから来たか（来たなら、戻る＝メッセージに戻る）
let glossaryReturnTabId = "";         // メッセージのタップから来た時、元いたタブ

// ===== データの読み出し =====
function glossaryEntries() {
  const list = (typeof scenarioProject !== "undefined" && scenarioProject && Array.isArray(scenarioProject.glossary)) ? scenarioProject.glossary : [];
  return list.filter(e => e && typeof e.term === "string" && e.term.trim());
}

function glossaryEntryById(id) {
  return glossaryEntries().find(e => e.id === id) || null;
}

function glossarySortKey(entry) {
  return (entry.reading || entry.term || "").trim();
}

function glossarySortedEntries(list) {
  return list.slice().sort((a, b) => glossarySortKey(a).localeCompare(glossarySortKey(b), "ja"));
}

// 見出し＋別の書き方（aliases）。長い順に並べて返す（長い言葉を先に探すため）
function glossaryKeysOf(entry) {
  const keys = [entry.term.trim()];
  String(entry.aliases || "").split(/[、,，\n]/).map(s => s.trim()).filter(Boolean).forEach(a => keys.push(a));
  return Array.from(new Set(keys)).filter(k => k.length >= 2);
}

// ===== 見た目の部品 =====
// 言葉の表示（読みがあれば、ルビを振る）
function glossaryTermElement(entry, className) {
  const wrap = guildAppEl("span", className || "");   // guild_app.js の部品
  const reading = (entry.reading || "").trim();
  if (reading && reading !== entry.term.trim()) {
    const ruby = document.createElement("ruby");
    ruby.appendChild(document.createTextNode(entry.term.trim()));
    const rt = document.createElement("rt");
    rt.textContent = reading;
    ruby.appendChild(rt);
    wrap.appendChild(ruby);
  } else {
    wrap.textContent = entry.term.trim();
  }
  return wrap;
}

// ===== 開く・閉じる =====
function openGlossaryAppPanel(options = {}) {
  const grid = document.getElementById("convenience-icon-grid");
  if (grid) grid.classList.add("hidden");
  closeAllConvenienceSubPanels(); // convenience.js
  glossaryFromMessage = !!options.fromMessage;
  glossaryCategoryFilter = "all";
  if (options.termId && glossaryEntryById(options.termId)) {
    glossaryDetailId = options.termId;
    glossaryView = "detail";
  } else {
    glossaryView = "home";
  }
  renderGlossaryAppPanel(0);
  window.removeEventListener("keydown", handleGlossaryAppKeyDown);
  window.addEventListener("keydown", handleGlossaryAppKeyDown);
}

function closeGlossaryAppPanel() {
  window.removeEventListener("keydown", handleGlossaryAppKeyDown);
  const panel = document.getElementById("glossary-app-panel");
  if (panel) panel.classList.add("hidden");
  renderConvenienceIcons(); // convenience.js
}

// メッセージのタップから来た時：アプリを閉じて、元のタブとメッセージの操作に戻す
function glossaryReturnToMessage() {
  const tabId = glossaryReturnTabId;
  glossaryFromMessage = false;
  closeGlossaryAppPanel();
  controlFocus = "main";
  if (typeof updateControlFocusIndicator === "function") updateControlFocusIndicator();
  if (tabId && tabId !== "tab-convenience" && typeof switchTab === "function") switchTab(tabId);
}

function glossaryBack() {
  if (glossaryView === "detail") {
    if (glossaryFromMessage) { glossaryReturnToMessage(); return; }
    glossaryView = "list";
  } else if (glossaryView === "list") {
    glossaryView = "home";
  } else {
    if (glossaryFromMessage) { glossaryReturnToMessage(); return; }
    closeGlossaryAppPanel();
    return;
  }
  renderGlossaryAppPanel(0);
}

function glossaryGo(view, focusIndex = 0) {
  glossaryView = view;
  renderGlossaryAppPanel(focusIndex);
}

function handleGlossaryAppKeyDown(event) {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return;
  if (controlFocus !== "sub") return;
  if (isGameDialogOpen) return;
  const activeTab = document.querySelector(".tab-content.active");
  if (!activeTab || activeTab.id !== "tab-convenience") return;
  const panel = document.getElementById("glossary-app-panel");
  if (!panel || panel.classList.contains("hidden")) return;
  if (KEY_CONFIG.cancelKeys.includes(event.key)) {
    event.preventDefault();
    glossaryBack();
    return;
  }
  const buttons = Array.from(panel.querySelectorAll("button:not([disabled])"));
  const index = buttons.indexOf(document.activeElement);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (buttons.length === 0) return;
    const next = event.key === "ArrowDown" ? (index + 1) % buttons.length : (index <= 0 ? buttons.length - 1 : index - 1);
    buttons[next].focus();
  } else if (KEY_CONFIG.decideKeys.includes(event.key) && index >= 0) {
    event.preventDefault();
    buttons[index].click();
  }
}

// ===== 画面 =====
function renderGlossaryAppPanel(focusIndex = 0) {
  const panel = document.getElementById("glossary-app-panel");
  if (!panel) return;
  panel.classList.remove("hidden");
  panel.innerHTML = "";
  const renderers = { home: glossaryRenderHome, list: glossaryRenderList, detail: glossaryRenderDetail };
  (renderers[glossaryView] || glossaryRenderHome)(panel);
  const buttons = Array.from(panel.querySelectorAll("button:not([disabled])"));
  const target = buttons[Math.min(Math.max(0, focusIndex), buttons.length - 1)];
  if (target) target.focus();
}

function glossaryBackButton(panel, label) {
  const back = guildAppEl("button", "monster-codex-back-btn", label || "◀ 戻る");
  back.onclick = (event) => { event.stopPropagation(); glossaryBack(); };
  panel.appendChild(back);
}

// 分類の一覧（登録されている分類だけ。決まった順で、その他の分類は後ろに）
function glossaryRenderHome(panel) {
  panel.appendChild(guildAppEl("h3", "monster-codex-title", "用語・語彙"));
  const entries = glossaryEntries();
  if (entries.length === 0) {
    panel.appendChild(guildAppEl("p", "element-combo-empty", "まだ言葉が登録されていません。"));
    glossaryBackButton(panel, glossaryFromMessage ? "◀ メッセージに戻る" : "◀ 閉じる");
    return;
  }
  panel.appendChild(guildAppEl("p", "element-combo-note", "このゲームの用語や、ことわざ・熟語などの意味を調べられます。メッセージの中の言葉をタップしても、ここに解説が出ます。"));
  const allBtn = guildAppButton("すべて", () => { glossaryCategoryFilter = "all"; glossaryGo("list"); });
  allBtn.appendChild(guildAppEl("span", "guild-app-btn-note", `${entries.length}語`));
  panel.appendChild(allBtn);
  const cats = [];
  GLOSSARY_CATEGORIES.concat(entries.map(e => e.category || "")).forEach(c => { if (c && !cats.includes(c) && entries.some(e => e.category === c)) cats.push(c); });
  if (entries.some(e => !e.category)) cats.push("その他");
  cats.forEach(cat => {
    const count = entries.filter(e => (e.category || "その他") === cat).length;
    const btn = guildAppButton(cat, () => { glossaryCategoryFilter = cat; glossaryGo("list"); });
    btn.appendChild(guildAppEl("span", "guild-app-btn-note", `${count}語`));
    panel.appendChild(btn);
  });
  glossaryBackButton(panel, glossaryFromMessage ? "◀ メッセージに戻る" : "◀ 閉じる");
}

// 言葉の一覧（読み順）
function glossaryRenderList(panel) {
  panel.appendChild(guildAppEl("h3", "monster-codex-title", glossaryCategoryFilter === "all" ? "用語・語彙：すべて" : `用語・語彙：${glossaryCategoryFilter}`));
  const list = glossarySortedEntries(glossaryEntries().filter(e => glossaryCategoryFilter === "all" || (e.category || "その他") === glossaryCategoryFilter));
  if (list.length === 0) panel.appendChild(guildAppEl("p", "element-combo-empty", "この分類の言葉は、まだありません。"));
  list.forEach(entry => {
    const btn = guildAppButton("", () => { glossaryDetailId = entry.id; glossaryGo("detail"); });
    btn.appendChild(glossaryTermElement(entry, "glossary-list-term"));
    const meaning = String(entry.meaning || "").replace(/\s+/g, " ");
    btn.appendChild(guildAppEl("span", "guild-app-btn-note", `${glossaryCategoryFilter === "all" ? (entry.category || "その他") + "｜" : ""}${stripRubyNotation(meaning).slice(0, 40)}${meaning.length > 40 ? "…" : ""}`));
    panel.appendChild(btn);
  });
  glossaryBackButton(panel);
}

// 解説
function glossaryRenderDetail(panel) {
  const entry = glossaryEntryById(glossaryDetailId);
  if (!entry) {
    panel.appendChild(guildAppEl("h3", "monster-codex-title", "用語・語彙"));
    panel.appendChild(guildAppEl("p", "element-combo-empty", "この言葉は見つかりませんでした。"));
    glossaryBackButton(panel);
    return;
  }
  const card = guildAppEl("div", "element-combo-item waza-detail-card glossary-detail-card");
  card.appendChild(glossaryTermElement(entry, "glossary-detail-term"));
  const sub = [entry.category || "その他"];
  if (entry.reading) sub.push(`読み：${entry.reading}`);
  card.appendChild(guildAppEl("div", "element-combo-note", sub.join("｜")));
  const meaning = guildAppEl("div", "glossary-detail-meaning");
  setTextWithRuby(meaning, String(entry.meaning || "（解説は、まだありません）"));   // mainfunc.js（ルビ記法も使える）
  meaning.style.whiteSpace = "pre-wrap";
  card.appendChild(meaning);
  const aliases = glossaryKeysOf(entry).filter(k => k !== entry.term.trim());
  if (aliases.length > 0) {
    const row = guildAppEl("div", "waza-detail-row");
    row.appendChild(guildAppEl("span", "waza-detail-key", "別の書き方"));
    row.appendChild(guildAppEl("span", "waza-detail-value", aliases.join("、")));
    card.appendChild(row);
  }
  if (entry.example && String(entry.example).trim()) {
    const row = guildAppEl("div", "waza-detail-row");
    row.appendChild(guildAppEl("span", "waza-detail-key", "用例"));
    const val = guildAppEl("span", "waza-detail-value");
    setTextWithRuby(val, String(entry.example));
    row.appendChild(val);
    card.appendChild(row);
  }
  panel.appendChild(card);
  if (glossaryFromMessage) {
    panel.appendChild(guildAppButton("用語・語彙の一覧を見る", () => { glossaryFromMessage = true; glossaryGo("home"); }));
    glossaryBackButton(panel, "◀ メッセージに戻る");
  } else {
    glossaryBackButton(panel);
  }
}

// ===================================================================
// ===== メッセージ中の言葉をタップ → 解説へ =====
// ===================================================================
// タップした場所の文字を調べ、その文字が「解説のある言葉」の一部なら、アプリを開く（メッセージは進めない）。
// ★メッセージ欄（#message-text）の文字だけが対象。ルビ（読み）の文字は数えず、ルビ付きの言葉も本文で照合する。
// ★言葉の見た目は変えない。解説のある言葉以外のタップは、何もせず今まで通りに通す。

// メッセージ欄の文字（ルビを除く）と、各文字の位置の対応表を作る
function glossaryMessageTextMap(textEl) {
  const nodes = [];
  let plain = "";
  const walker = document.createTreeWalker(textEl, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (n.parentElement && n.parentElement.closest("rt, rp")) continue;
    nodes.push({ node: n, start: plain.length });
    plain += n.nodeValue;
  }
  return { plain, nodes };
}

// タップした位置にある文字（plain の何文字目か）。文字の外側をタップしていたら -1
function glossaryCharIndexAtPoint(textEl, map, x, y) {
  let hitNode = null, hitOffset = 0;
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (p) { hitNode = p.offsetNode; hitOffset = p.offset; }
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r) { hitNode = r.startContainer; hitOffset = r.startOffset; }
  }
  if (!hitNode || hitNode.nodeType !== 3 || !textEl.contains(hitNode)) return -1;
  const entry = map.nodes.find(e => e.node === hitNode);
  if (!entry) return -1;
  // カーソル位置は文字と文字の間なので、前後の文字のうち、実際に点を含んでいる方を選ぶ
  for (const off of [hitOffset - 1, hitOffset]) {
    if (off < 0 || off >= hitNode.nodeValue.length) continue;
    const range = document.createRange();
    range.setStart(hitNode, off);
    range.setEnd(hitNode, off + 1);
    const hit = Array.from(range.getClientRects()).some(r => x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1);
    if (hit) return entry.start + off;
  }
  return -1;
}

// 指定の文字を含む「解説のある言葉」を探す（複数あれば、いちばん長い言葉）
function glossaryFindEntryAt(plain, index) {
  let best = null, bestLen = 0;
  glossaryEntries().forEach(entry => {
    if (entry.autoLink === false) return;   // 「自動でリンクする」をオフにした言葉は、ブロックで指定したリンクだけ
    glossaryKeysOf(entry).forEach(key => {
      if (key.length <= bestLen) return;
      let from = Math.max(0, index - key.length + 1);
      while (true) {
        const at = plain.indexOf(key, from);
        if (at < 0 || at > index) break;
        if (index < at + key.length) { best = entry; bestLen = key.length; break; }
        from = at + 1;
      }
    });
  });
  return best;
}

function glossaryHandleMessageClick(event) {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return;
  if (typeof isGameDialogOpen !== "undefined" && isGameDialogOpen) return;
  const textEl = document.getElementById("message-text");
  if (!textEl || !event.target || !textEl.contains(event.target)) return;
  if (typeof isReplayingLog !== "undefined" && isReplayingLog) return;
  if (glossaryEntries().length === 0) return;
  if (typeof isPlayTabEnabled === "function" && !isPlayTabEnabled("tab-convenience")) return;   // 便利タブが無いシナリオでは、アプリに飛べない
  // ① 話編集のブロックで、{/文字}={@用語ID} とリンクさせた文字（見た目は変わらない）
  let entry = null;
  const linkEl = event.target.closest ? event.target.closest("[data-glossary-id]") : null;
  if (linkEl && textEl.contains(linkEl)) entry = glossaryEntryById(linkEl.getAttribute("data-glossary-id"));
  // ② リンクが無い場所は、「言葉」「別の書き方」と同じ文字を自動で探す（言葉ごとに「自動でリンクする」をオフにできる）
  if (!entry) {
    const map = glossaryMessageTextMap(textEl);
    if (!map.plain) return;
    const index = glossaryCharIndexAtPoint(textEl, map, event.clientX, event.clientY);
    if (index < 0) return;
    entry = glossaryFindEntryAt(map.plain, index);
  }
  if (!entry) return;
  // 解説を開く（メッセージを進めてしまわないよう、他のクリック処理へは届かせない）
  event.stopPropagation();
  event.preventDefault();
  const activeTab = document.querySelector(".tab-content.active");
  glossaryReturnTabId = activeTab ? activeTab.id : "tab-main";
  if (typeof switchTab === "function") switchTab("tab-convenience");
  controlFocus = "sub";
  if (typeof updateControlFocusIndicator === "function") updateControlFocusIndicator();
  openGlossaryAppPanel({ termId: entry.id, fromMessage: true });
}

// 他のクリック処理（メッセージ送りなど）より先に受け取る（true＝キャプチャ段階）
document.addEventListener("click", glossaryHandleMessageClick, true);
