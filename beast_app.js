// beast_app.js
// ===================================================================
// ===== 便利タブの「おとも魔獣」アプリ =====
// ===================================================================
// ★「冒険者協会」アプリ（guild_app.js）と同じ作りの、便利タブのアプリ。項目は今のところ「おとも魔獣をセット」だけ。
//   項目を増やす時は BEAST_APP_ITEMS に足す。
// ★魔獣を手に入れるのは、冒険者協会アプリの「魔獣召喚」。ここは、手に入れた魔獣から1体を選んでセットする画面
//   （パーティの編成とは別枠。仲間が入れ替わっても、魔獣だけ付け替えられる）
// ★一覧には、役割・属性・段階・今の能力値と、相性（今のパーティで効いているものは◎）を出す。戦闘中はセットを変えられない
// ★「ステータス詳細」：能力値の内訳（基本値・レベルごとの成長・段階の倍率・段階の強化・相性）、レベル別の能力値、段階ごとの倍率と強化を見られる
// ★キー操作：上下＝ボタンの移動／決定キー＝押す／キャンセルキー＝ひとつ前の画面へ

const BEAST_APP_ITEMS = [
  {
    id: "equip", view: "equip",
    label: () => "おとも魔獣をセット",
    note: () => { const cur = getEquippedBeast(); return cur ? `セット中：${beastName(cur.entry)}（${cur.breakCount}${gachaConfig("beast").breakLabel}）` : "セット中：なし"; }
  },
  {
    id: "list", view: "list",
    label: () => "魔獣のステータス詳細",
    note: () => `${gachaOwnedEntries("beast").length}体`
  }
];
const BEAST_APP_PARENT = { equip: "home", list: "home" };   // detail の戻り先は beastAppDetailFrom で決まる
let beastAppView = "home";
let beastAppNotice = "";
let beastAppDetailId = "";        // 詳細を見ている魔獣のid
let beastAppDetailFrom = "list";  // 詳細画面の戻り先（"list"／"equip"）

function beastAppIsInBattle() {
  return typeof battleState !== "undefined" && !!battleState;
}

// ===== 開く・閉じる =====
function openBeastAppPanel() {
  const grid = document.getElementById("convenience-icon-grid");
  if (grid) grid.classList.add("hidden");
  closeAllConvenienceSubPanels(); // convenience.js
  beastAppView = "home";
  beastAppNotice = "";
  renderBeastAppPanel(0);
  window.removeEventListener("keydown", handleBeastAppKeyDown);
  window.addEventListener("keydown", handleBeastAppKeyDown);
}

function closeBeastAppPanel() {
  window.removeEventListener("keydown", handleBeastAppKeyDown);
  const panel = document.getElementById("beast-app-panel");
  if (panel) panel.classList.add("hidden");
  renderConvenienceIcons(); // convenience.js
}

function beastAppBack() {
  const parent = beastAppView === "detail" ? beastAppDetailFrom : BEAST_APP_PARENT[beastAppView];
  if (!parent) { closeBeastAppPanel(); return; }
  beastAppView = parent;
  beastAppNotice = "";
  renderBeastAppPanel(0);
}

function beastAppGo(view, focusIndex = 0) {
  beastAppView = view;
  beastAppNotice = "";
  renderBeastAppPanel(focusIndex);
}

function beastAppOpenDetail(id, from) {
  beastAppDetailId = id;
  beastAppDetailFrom = from;
  beastAppGo("detail");
}

function handleBeastAppKeyDown(event) {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return;
  if (controlFocus !== "sub") return;
  if (isGameDialogOpen) return;
  const activeTab = document.querySelector(".tab-content.active");
  if (!activeTab || activeTab.id !== "tab-convenience") return;
  const panel = document.getElementById("beast-app-panel");
  if (!panel || panel.classList.contains("hidden")) return;
  if (KEY_CONFIG.cancelKeys.includes(event.key)) {
    event.preventDefault();
    beastAppBack();
    return;
  }
  const buttons = Array.from(panel.querySelectorAll("button:not([disabled])"));
  const index = buttons.indexOf(document.activeElement);
  if (beastAppView === "detail" && guildAppDetailKeyScroll(panel, event, buttons, index)) return;   // 詳細画面は、上下キーでスクロール
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
function renderBeastAppPanel(focusIndex = 0) {
  const panel = document.getElementById("beast-app-panel");
  if (!panel) return;
  panel.classList.remove("hidden");
  panel.innerHTML = "";
  const renderers = { home: beastAppRenderHome, equip: beastAppRenderEquip, list: beastAppRenderList, detail: beastAppRenderDetail };
  (renderers[beastAppView] || beastAppRenderHome)(panel);
  if (beastAppNotice) {
    const noticeEl = guildAppEl("p", "guild-app-notice", beastAppNotice);   // guild_app.js の部品
    const title = panel.querySelector(".monster-codex-title");
    if (title && title.nextSibling) panel.insertBefore(noticeEl, title.nextSibling); else panel.appendChild(noticeEl);
  }
  const buttons = Array.from(panel.querySelectorAll("button:not([disabled])"));
  const target = buttons[Math.min(Math.max(0, focusIndex), buttons.length - 1)];
  if (target) target.focus({ preventScroll: beastAppView === "detail" });   // 詳細画面は、一番上から読み始められるように、フォーカスでスクロールさせない
}

function beastAppBackButton(panel, label = "◀ 戻る") {
  const back = guildAppEl("button", "monster-codex-back-btn", label);
  back.onclick = (event) => { event.stopPropagation(); beastAppBack(); };
  panel.appendChild(back);
}

function beastAppRenderHome(panel) {
  panel.appendChild(guildAppEl("h3", "monster-codex-title", "おとも魔獣"));
  BEAST_APP_ITEMS.forEach(item => {
    const btn = guildAppButton(item.label(), () => beastAppGo(item.view));
    if (item.note) btn.appendChild(guildAppEl("span", "guild-app-btn-note", item.note()));
    panel.appendChild(btn);
  });
  beastAppBackButton(panel, "◀ 閉じる");
}

// 魔獣1体ぶんのボタン（見た目＋名前＋役割・属性・凸数＋能力値＋相性）
function beastAppEntryButton(entry, selected, onClick, disabled) {
  const cfg = gachaConfig("beast");
  const rarity = gachaRarityOf(entry);
  const btn = guildAppButton("", onClick, { disabled, className: "beast-entry-btn" + (rarity === "SR" ? " guild-app-btn-sr" : (rarity === "R" ? " guild-app-btn-r" : "")) });
  btn.textContent = "";
  btn.appendChild(beastAvatarElement(entry, 52));
  const info = guildAppEl("span", "beast-entry-info");
  info.appendChild(guildAppEl("span", "beast-entry-name", `${selected ? "【セット中】" : ""}【${gachaRarityLabel(rarity)}】${beastName(entry)}`));
  info.appendChild(guildAppEl("span", "guild-app-btn-note", `${beastRoleLabel(entry.role)}｜${beastElementName(entry)}属性｜${beastOwnedBreak(entry.id)}${cfg.breakLabel}`));
  info.appendChild(guildAppEl("span", "guild-app-btn-note", beastStatsText(beastCurrentStats(entry))));
  const affinities = beastAffinityList(entry);
  affinities.forEach(a => {
    const line = guildAppEl("span", "guild-app-btn-note beast-affinity" + (a.active ? " beast-affinity-on" : ""),
      `${a.active ? "◎" : "○"} ${a.name}と相性が良い${a.text ? `（${a.text}）` : ""}${a.active ? "" : "　※今のパーティにいません"}`);
    info.appendChild(line);
  });
  if (entry.description) info.appendChild(guildAppEl("span", "guild-app-btn-note", stripRubyNotation(entry.description)));
  btn.appendChild(info);
  return btn;
}

function beastAppRenderEquip(panel) {
  const cfg = gachaConfig("beast");
  panel.appendChild(guildAppEl("h3", "monster-codex-title", "おとも魔獣をセット"));
  const inBattle = beastAppIsInBattle();
  if (inBattle) panel.appendChild(guildAppEl("p", "guild-app-notice", "戦闘中は、おとも魔獣のセットを変えられません。"));
  panel.appendChild(guildAppEl("p", "element-combo-note", "魔獣は1体までセットできます。パーティの編成とは別で、いつでも付け替えられます。◎は、今のパーティで相性の効果が出ているものです。くわしい能力は「ステータス詳細」で見られます。"));
  const owned = gachaOwnedEntries("beast");
  const equippedId = getEquippedBeastId();
  if (owned.length === 0) {
    panel.appendChild(guildAppEl("p", "element-combo-empty", `まだ魔獣を持っていません。冒険者協会アプリの「${cfg.name}」で手に入ります。`));
  }
  owned.forEach(entry => {
    panel.appendChild(beastAppEntryButton(entry, entry.id === equippedId, () => {
      setEquippedBeast(entry.id);
      beastAppNotice = `「${beastName(entry)}」をセットした。`;
      renderBeastAppPanel(owned.indexOf(entry) * 2);   // 魔獣ごとに「セット」「詳細」の2つのボタンがあるので、×2
    }, inBattle));
    panel.appendChild(guildAppButton("▶ ステータス詳細", () => beastAppOpenDetail(entry.id, "equip")));
  });
  if (equippedId) {
    panel.appendChild(guildAppButton("セットを外す", () => {
      setEquippedBeast(null);
      beastAppNotice = "おとも魔獣を外した。";
      renderBeastAppPanel(0);
    }, { disabled: inBattle }));
  }
  beastAppBackButton(panel);
}

// ===== 画面：持っている魔獣の一覧（ステータス詳細へ） =====
function beastAppRenderList(panel) {
  const cfg = gachaConfig("beast");
  panel.appendChild(guildAppEl("h3", "monster-codex-title", "魔獣のステータス詳細"));
  const owned = gachaOwnedEntries("beast");
  const equippedId = getEquippedBeastId();
  if (owned.length === 0) {
    panel.appendChild(guildAppEl("p", "element-combo-empty", `まだ魔獣を持っていません。冒険者協会アプリの「${cfg.name}」で手に入ります。`));
  }
  owned.forEach(entry => {
    panel.appendChild(beastAppEntryButton(entry, entry.id === equippedId, () => beastAppOpenDetail(entry.id, "list"), false));
  });
  beastAppBackButton(panel);
}

// ===== 画面：魔獣1体の詳細 =====
// 能力値の計算（beast.js の beastStatsAt）：(基本値＋レベルごとの成長×(Lv−1)) × 段階の倍率 × (1＋段階の強化％＋相性％)
function beastAppDetailRow(card, key, value, cls) {
  const row = guildAppEl("div", "waza-detail-row" + (cls ? " " + cls : ""));
  row.appendChild(guildAppEl("span", "waza-detail-key", key));
  row.appendChild(guildAppEl("span", "waza-detail-value", value));
  card.appendChild(row);
}

function beastAppSigned(v) {
  const n = Math.round(v * 10) / 10;
  return `${n >= 0 ? "＋" : "−"}${Math.abs(n)}％`;
}

function beastAppRenderDetail(panel) {
  const entry = beastEntryById(beastAppDetailId);
  if (!entry || beastOwnedBreak(entry.id) < 0) {
    panel.appendChild(guildAppEl("h3", "monster-codex-title", "魔獣の詳細"));
    panel.appendChild(guildAppEl("p", "element-combo-empty", "この魔獣は見つかりませんでした。"));
    beastAppBackButton(panel);
    return;
  }
  const cfg = gachaConfig("beast");
  const rarity = gachaRarityOf(entry);
  const brk = Math.max(0, beastOwnedBreak(entry.id));
  const level = (typeof player !== "undefined" && player) ? Math.max(1, Number(player.level) || 1) : 1;
  const equippedId = getEquippedBeastId();
  const inBattle = beastAppIsInBattle();

  panel.appendChild(guildAppEl("h3", "monster-codex-title", beastName(entry)));

  // --- 基本情報 ---
  const head = guildAppEl("div", "element-combo-item waza-detail-card");
  const top = guildAppEl("div", "beast-entry-btn-like");
  top.style.display = "flex"; top.style.alignItems = "center"; top.style.gap = "10px";
  top.appendChild(beastAvatarElement(entry, 52));
  top.appendChild(guildAppEl("div", "element-combo-name", `【${gachaRarityLabel(rarity)}】${beastName(entry)}${entry.id === equippedId ? "（セット中）" : ""}`));
  head.appendChild(top);
  if (entry.description) head.appendChild(guildAppEl("div", "element-combo-note", stripRubyNotation(entry.description)));
  beastAppDetailRow(head, "役割", beastRoleLabel(entry.role));
  beastAppDetailRow(head, "属性", `${beastElementName(entry)}属性`);
  beastAppDetailRow(head, cfg.breakLabel, `${brk}${cfg.breakLabel}（最大${GACHA_MAX_BREAK}${cfg.breakLabel}）`);
  panel.appendChild(head);

  // --- いまの能力値と内訳 ---
  const base = entry.baseStats || {}, growth = entry.growthPerLevel || {};
  const mult = beastBreakMultipliers()[Math.min(GACHA_MAX_BREAK, brk)];
  const pctAll = beastBonusPercents(entry, brk, true);
  const pctBreak = beastBonusPercents(entry, brk, false);
  const now = beastStatsAt(entry, level, brk, true);
  const stat = guildAppEl("div", "element-combo-item waza-detail-card");
  stat.appendChild(guildAppEl("div", "element-combo-name", `いまの能力値（主人公Lv${level}・${brk}${cfg.breakLabel}）`));
  BEAST_STATS.forEach(s => {
    const b0 = Number(base[s.key]) || 0, g0 = Number(growth[s.key]) || 0;
    const raw = b0 + g0 * (level - 1);
    const breakPct = pctBreak[s.key] || 0, affPct = (pctAll[s.key] || 0) - breakPct;
    beastAppDetailRow(stat, s.label, `${now[s.key]}`, "waza-detail-total");
    beastAppDetailRow(stat, "　内訳", `基本${b0}＋成長${g0}×${level - 1}＝${Math.round(raw * 10) / 10}　×${cfg.breakLabel}の倍率${mult}％　${cfg.breakLabel}の強化${beastAppSigned(breakPct)}　相性${beastAppSigned(affPct)}`);
  });
  panel.appendChild(stat);

  // --- レベル別・段階別の能力値 ---
  const lvCard = guildAppEl("div", "element-combo-item waza-detail-card");
  lvCard.appendChild(guildAppEl("div", "element-combo-name", `レベル別の能力値（いまの${cfg.breakLabel}・相性込み）`));
  const levels = Array.from(new Set([1, 10, 20, 30, 50, 100, level])).sort((a, c) => a - c);
  const table = document.createElement("table");
  table.className = "waza-detail-table";
  const headRow = document.createElement("tr");
  ["Lv", ...BEAST_STATS.map(s => s.label)].forEach(t => { const th = document.createElement("th"); th.textContent = t; headRow.appendChild(th); });
  table.appendChild(headRow);
  levels.forEach(lv => {
    const st = beastStatsAt(entry, lv, brk, true);
    const tr = document.createElement("tr");
    if (lv === level) tr.className = "waza-detail-total";
    [`${lv}${lv === level ? "（いま）" : ""}`, ...BEAST_STATS.map(s => String(st[s.key]))].forEach(t => { const td = document.createElement("td"); td.textContent = t; tr.appendChild(td); });
    table.appendChild(tr);
  });
  lvCard.appendChild(table);
  if (brk < GACHA_MAX_BREAK) {
    const maxSt = beastStatsAt(entry, level, GACHA_MAX_BREAK, true);
    beastAppDetailRow(lvCard, `最大${cfg.breakLabel}時`, `Lv${level}で ${beastStatsText(maxSt)}`);
  }
  panel.appendChild(lvCard);

  // --- 段階ごとの倍率と強化 ---
  const breakCard = guildAppEl("div", "element-combo-item waza-detail-card");
  breakCard.appendChild(guildAppEl("div", "element-combo-name", `${cfg.breakLabel}ごとの強化`));
  const limitBreaks = Array.isArray(entry.limitBreaks) ? entry.limitBreaks : [];
  const mults = beastBreakMultipliers();
  for (let i = 0; i <= GACHA_MAX_BREAK; i++) {
    const text = i === 0 ? "" : beastBonusText(limitBreaks[i - 1]);
    beastAppDetailRow(breakCard, `${i <= brk ? "✔ " : ""}${i}${cfg.breakLabel}`, `能力値の倍率${mults[i]}％${text ? "／" + text : ""}`, i <= brk ? "waza-detail-done" : "");
  }
  panel.appendChild(breakCard);

  // --- 相性 ---
  const affinities = beastAffinityList(entry);
  const affCard = guildAppEl("div", "element-combo-item waza-detail-card");
  affCard.appendChild(guildAppEl("div", "element-combo-name", "相性"));
  if (affinities.length === 0) {
    affCard.appendChild(guildAppEl("div", "element-combo-note", "相性のよい仲間は、いません。"));
  } else {
    affinities.forEach(a => {
      beastAppDetailRow(affCard, `${a.active ? "◎" : "○"} ${a.name}`, `${a.text || "（変化なし）"}${a.active ? "（いま効いています）" : "（今のパーティにいません）"}`, a.active ? "waza-detail-done" : "");
    });
  }
  panel.appendChild(affCard);

  // --- 連動 ---
  const links = (Array.isArray(entry.links) ? entry.links : []).filter(l => l && l.enabled !== false);
  const linkCard = guildAppEl("div", "element-combo-item waza-detail-card");
  linkCard.appendChild(guildAppEl("div", "element-combo-name", "連動"));
  if (links.length === 0) {
    linkCard.appendChild(guildAppEl("div", "element-combo-note", "連動は、ありません。"));
  } else {
    linkCard.appendChild(guildAppEl("div", "element-combo-note", "仲間の技に合わせて、戦闘画面の左に出るボタン（タップかCキー）で発動します。"));
    links.forEach(l => {
      const unlocked = brk >= (Number(l.unlockBreak) || 0);
      const t = l.trigger || {};
      const kindLabel = { name: "技の名前", element: "技の属性", type: "技の種類" }[t.kind] || "？";
      const typeLabel = { attack: "攻撃", heal: "回復", buff: "自己強化" };
      let valueLabel = t.value || "？";
      if (t.kind === "type") valueLabel = typeLabel[t.value] || valueLabel;
      if (t.kind === "element" && t.value !== "無") {
        const el = (scenarioProject.elementDefs || []).find(e => e.id === t.value);
        valueLabel = el ? (el.name || t.value) : valueLabel;
      }
      const who = l.userKind === "player" ? "主人公" : (l.userKind === "companion" ? beastTargetName(l.userCompanion) : "誰でも");
      const cd = Math.max(0, Math.round(Number(l.cooldown) || 0));
      beastAppDetailRow(linkCard, `${unlocked ? "✔ " : "🔒 "}${l.name || "連動"}`,
        `きっかけ：${kindLabel}が「${valueLabel}」／使った人：${who}／クールタイム${cd}ターン` + (unlocked ? "" : `（${l.unlockBreak}${cfg.breakLabel}で解放）`),
        unlocked ? "waza-detail-done" : "");
    });
    const limit = Math.max(1, Math.round(Number(entry.linkMaxPerTurn) || 1));
    beastAppDetailRow(linkCard, "1ターンの上限", `${limit}回`);
  }
  panel.appendChild(linkCard);

  // --- セット／外す ---
  if (entry.id === equippedId) {
    panel.appendChild(guildAppButton("セットを外す", () => {
      setEquippedBeast(null);
      beastAppNotice = "おとも魔獣を外した。";
      renderBeastAppPanel(0);
    }, { disabled: inBattle }));
  } else {
    panel.appendChild(guildAppButton("この魔獣をセットする", () => {
      setEquippedBeast(entry.id);
      beastAppNotice = `「${beastName(entry)}」をセットした。`;
      renderBeastAppPanel(0);
    }, { disabled: inBattle }));
  }
  beastAppBackButton(panel);
}
