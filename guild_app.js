// guild_app.js
// ===================================================================
// ===== 便利タブの「冒険者協会」アプリ =====
// ===================================================================
// ★スマホのホーム画面のようなアイコン（convenience.js の CONVENIENCE_APPS）のひとつ。
//   （本当のスマホではないが、分かりやすくするために「アプリ」と呼んでいる）
//   アプリを開くと、項目の一覧が出る。今ある項目は「ガチャ」だけ。項目を増やす時は GUILD_APP_ITEMS に足す。
// ★ガチャの中身（抽選・天井・凸など）は gacha.js。ここは画面だけを持つ。
//   画面はメッセージ送りではなく、便利タブの他のアプリと同じ「パネル」（#guild-app-panel）で動くので、
//   場面を問わずいつでも開ける。ただし、戦闘中は技のセットだけ変えられない
// ★キー操作：上下＝ボタンの移動／決定キー＝押す／キャンセルキー＝ひとつ前の画面へ

// アプリの中の項目。label は呼び名が設定で変わるので関数にしている
const GUILD_APP_ITEMS = [
  { id: "gacha", label: () => gachaConfig().name, note: () => `${gachaStoneLabel()} ${gachaStonesHeld()}個`, view: "gacha" }
];

// 画面（view）と、「戻る」で行き先の対応表
const GUILD_APP_PARENT = { gacha: "home", info: "gacha", equip: "gacha", equipUnit: "equip", equipPick: "equipUnit" };

let guildAppView = "home";
let guildAppResults = null;      // 直前にガチャを引いた結果（文章の配列）。ガチャの画面を離れたら消す
let guildAppNotice = "";         // 画面の上に出す一言（引けなかった理由など）
let guildAppEquipMemberIndex = 0;
let guildAppEquipSlot = 0;

function guildAppIsInBattle() {
  return typeof battleState !== "undefined" && !!battleState;
}

// ===== 開く・閉じる =====
function openGuildAppPanel() {
  const grid = document.getElementById("convenience-icon-grid");
  if (grid) grid.classList.add("hidden");
  closeAllConvenienceSubPanels(); // convenience.js
  guildAppView = "home";
  guildAppResults = null;
  guildAppNotice = "";
  renderGuildAppPanel(0);
  window.removeEventListener("keydown", handleGuildAppKeyDown);
  window.addEventListener("keydown", handleGuildAppKeyDown);
}

function closeGuildAppPanel() {
  window.removeEventListener("keydown", handleGuildAppKeyDown);
  const panel = document.getElementById("guild-app-panel");
  if (panel) panel.classList.add("hidden");
  renderConvenienceIcons(); // convenience.js
}

// ひとつ前の画面へ。一番上（項目の一覧）なら、アプリを閉じる
function guildAppBack() {
  const parent = GUILD_APP_PARENT[guildAppView];
  if (!parent) { closeGuildAppPanel(); return; }
  if (guildAppView === "gacha") { guildAppResults = null; guildAppNotice = ""; }
  guildAppView = parent;
  renderGuildAppPanel(0);
}

function guildAppGo(view, focusIndex = 0) {
  guildAppView = view;
  guildAppNotice = "";
  renderGuildAppPanel(focusIndex);
}

function handleGuildAppKeyDown(event) {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // シナリオエディタ表示中は本編を操作させない
  if (controlFocus !== "sub") return;
  if (isGameDialogOpen) return;
  const activeTab = document.querySelector(".tab-content.active");
  if (!activeTab || activeTab.id !== "tab-convenience") return;
  const panel = document.getElementById("guild-app-panel");
  if (!panel || panel.classList.contains("hidden")) return;
  if (KEY_CONFIG.cancelKeys.includes(event.key)) {
    event.preventDefault();
    guildAppBack();
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
    event.preventDefault(); // Enterの標準の「押す」と二重にならないよう、こちらで1回だけ押す
    buttons[index].click();
  }
}

// ===== 部品 =====
function guildAppEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function guildAppButton(label, onClick, options = {}) {
  const btn = guildAppEl("button", "guild-app-btn" + (options.className ? " " + options.className : ""), label);
  if (options.disabled) btn.disabled = true;
  btn.onclick = (event) => { event.stopPropagation(); onClick(); };
  return btn;
}

// 画面を作り直す。focusIndex 番目のボタンにフォーカスを戻す（押した後も同じ位置から続けられるように）
function renderGuildAppPanel(focusIndex = 0) {
  const panel = document.getElementById("guild-app-panel");
  if (!panel) return;
  panel.classList.remove("hidden");
  panel.innerHTML = "";
  const renderers = { home: guildAppRenderHome, gacha: guildAppRenderGacha, info: guildAppRenderInfo, equip: guildAppRenderEquip, equipUnit: guildAppRenderEquipUnit, equipPick: guildAppRenderEquipPick };
  (renderers[guildAppView] || guildAppRenderHome)(panel);
  if (guildAppNotice) {
    const noticeEl = guildAppEl("p", "guild-app-notice", guildAppNotice);
    const title = panel.querySelector(".monster-codex-title");
    if (title && title.nextSibling) panel.insertBefore(noticeEl, title.nextSibling); else panel.appendChild(noticeEl);
  }
  const buttons = Array.from(panel.querySelectorAll("button:not([disabled])"));
  const target = buttons[Math.min(Math.max(0, focusIndex), buttons.length - 1)];
  if (target) target.focus();
}

function guildAppBackButton(panel, label = "◀ 戻る") {
  const back = guildAppEl("button", "monster-codex-back-btn", label);
  back.onclick = (event) => { event.stopPropagation(); guildAppBack(); };
  panel.appendChild(back);
}

// ===== 項目の一覧 =====
function guildAppRenderHome(panel) {
  panel.appendChild(guildAppEl("h3", "monster-codex-title", "冒険者協会"));
  GUILD_APP_ITEMS.forEach(item => {
    const btn = guildAppButton(item.label(), () => { guildAppResults = null; guildAppGo(item.view); });
    if (item.note) btn.appendChild(guildAppEl("span", "guild-app-btn-note", item.note()));
    panel.appendChild(btn);
  });
  guildAppBackButton(panel, "◀ 閉じる");
}

// ===== ガチャ =====
function guildAppRenderGacha(panel) {
  const cfg = gachaConfig();
  const st = gachaState();
  const period = gachaPeriodStatus();
  const open = period.state === "open";
  panel.appendChild(guildAppEl("h3", "monster-codex-title", cfg.name));

  const status = guildAppEl("div", "element-combo-item");
  status.appendChild(guildAppEl("div", "element-combo-name", `${gachaStoneLabel()}：${gachaStonesHeld()}個`));
  status.appendChild(guildAppEl("div", "element-combo-note", gachaPeriodText()));
  if (cfg.pity > 0) status.appendChild(guildAppEl("div", "element-combo-note", `${cfg.pityLabel}まであと${Math.max(1, cfg.pity - st.pity)}回`));
  panel.appendChild(status);

  const closedNote = open ? "" : (period.state === "before" ? "（開催前）" : "（開催終了）");
  [1, 10].forEach(count => {
    panel.appendChild(guildAppButton(`${count}回${cfg.pullLabel}（${gachaStoneLabel()}${cfg.cost * count}個）${closedNote}`, () => {
      const result = gachaTryPull(count);
      if (result.ok) { guildAppResults = result.lines; guildAppNotice = ""; }
      else { guildAppResults = null; guildAppNotice = result.message; }
      renderGuildAppPanel(count === 1 ? 0 : 1);
    }, { disabled: !open }));
  });

  if (guildAppResults && guildAppResults.length > 0) {
    const box = guildAppEl("div", "guild-app-results");
    box.appendChild(guildAppEl("div", "element-combo-name", "結果"));
    guildAppResults.forEach(line => {
      const cls = line.includes("【スーパーレア】") ? "guild-app-result-sr" : (line.includes("【レア】") ? "guild-app-result-r" : "");
      box.appendChild(guildAppEl("div", "guild-app-result-line " + cls, line));
    });
    panel.appendChild(box);
  }

  panel.appendChild(guildAppButton("排出内容を見る", () => guildAppGo("info")));
  panel.appendChild(guildAppButton("技をセットする", () => guildAppGo("equip")));
  guildAppBackButton(panel);
}

function guildAppRenderInfo(panel) {
  panel.appendChild(guildAppEl("h3", "monster-codex-title", `${gachaConfig().name}：排出内容`));
  gachaInfoLines().forEach(line => {
    const item = guildAppEl("div", "element-combo-item");
    item.appendChild(guildAppEl("div", "guild-app-info-line", line));
    panel.appendChild(item);
  });
  guildAppBackButton(panel);
}

// ----- 技のセット -----
function guildAppRenderEquip(panel) {
  panel.appendChild(guildAppEl("h3", "monster-codex-title", "技をセットする"));
  if (guildAppIsInBattle()) {
    panel.appendChild(guildAppEl("p", "guild-app-notice", "戦闘中は、技のセットを変えられません。"));
  }
  panel.appendChild(guildAppEl("p", "element-combo-note", `キャラ1人につき${GACHA_EQUIP_MAX}つまで。誰が使っても、職業に関係なく使えます。`));
  gachaMembers().forEach((member, index) => {
    const names = gachaEquipIds(member.unit).filter(Boolean).map(id => gachaSkillName(gachaEntryById(id)));
    const btn = guildAppButton(member.name, () => { guildAppEquipMemberIndex = index; guildAppGo("equipUnit"); }, { disabled: guildAppIsInBattle() });
    btn.appendChild(guildAppEl("span", "guild-app-btn-note", names.length ? names.join("／") : "（なし）"));
    panel.appendChild(btn);
  });
  guildAppBackButton(panel);
}

function guildAppEquipMember() {
  const members = gachaMembers();
  return members[Math.min(guildAppEquipMemberIndex, members.length - 1)];
}

function guildAppRenderEquipUnit(panel) {
  const member = guildAppEquipMember();
  panel.appendChild(guildAppEl("h3", "monster-codex-title", `${member.name}にセットする技`));
  const cfg = gachaConfig();
  gachaEquipIds(member.unit).forEach((id, slot) => {
    const entry = id ? gachaEntryById(id) : null;
    const btn = guildAppButton(`枠${slot + 1}`, () => { guildAppEquipSlot = slot; guildAppGo("equipPick"); });
    btn.appendChild(guildAppEl("span", "guild-app-btn-note", entry ? `${gachaSkillName(entry)}（${gachaOwnedBreak(id)}${cfg.breakLabel}・${gachaCostLabel(entry)}）` : "（空き）"));
    panel.appendChild(btn);
  });
  guildAppBackButton(panel);
}

function guildAppRenderEquipPick(panel) {
  const member = guildAppEquipMember();
  const cfg = gachaConfig();
  panel.appendChild(guildAppEl("h3", "monster-codex-title", `${member.name}：枠${guildAppEquipSlot + 1}`));
  const ids = gachaEquipIds(member.unit);
  const otherId = ids[guildAppEquipSlot === 0 ? 1 : 0];   // 同じキャラに、同じ技を2つはセットできない
  const owned = gachaOwnedEntries().filter(e => e.id !== otherId);
  if (owned.length === 0) panel.appendChild(guildAppEl("p", "element-combo-empty", "セットできる技を、まだ持っていません。"));
  owned.forEach(entry => {
    const rarity = gachaRarityOf(entry);
    const btn = guildAppButton(`【${gachaRarityLabel(rarity)}】${gachaSkillName(entry)}`, () => {
      setGachaEquip(member.unit, guildAppEquipSlot, entry.id);
      guildAppGo("equipUnit");
    }, { className: rarity === "SR" ? "guild-app-btn-sr" : (rarity === "R" ? "guild-app-btn-r" : "") });
    btn.appendChild(guildAppEl("span", "guild-app-btn-note", `${gachaOwnedBreak(entry.id)}${cfg.breakLabel}・${gachaCostLabel(entry)}${entry.description ? "｜" + stripRubyNotation(entry.description) : ""}`));
    panel.appendChild(btn);
  });
  if (ids[guildAppEquipSlot]) {
    panel.appendChild(guildAppButton("この枠の技を外す", () => {
      setGachaEquip(member.unit, guildAppEquipSlot, null);
      guildAppGo("equipUnit");
    }));
  }
  guildAppBackButton(panel);
}
