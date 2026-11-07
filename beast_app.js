// beast_app.js
// ===================================================================
// ===== 便利タブの「おとも魔獣」アプリ =====
// ===================================================================
// ★「冒険者協会」アプリ（guild_app.js）と同じ作りの、便利タブのアプリ。項目は今のところ「おとも魔獣をセット」だけ。
//   項目を増やす時は BEAST_APP_ITEMS に足す。
// ★魔獣を手に入れるのは、冒険者協会アプリの「魔獣召喚」。ここは、手に入れた魔獣から1体を選んでセットする画面
//   （パーティの編成とは別枠。仲間が入れ替わっても、魔獣だけ付け替えられる）
// ★一覧には、役割・属性・凸数・今の能力値と、相性（今のパーティで効いているものは◎）を出す。戦闘中はセットを変えられない
// ★キー操作：上下＝ボタンの移動／決定キー＝押す／キャンセルキー＝ひとつ前の画面へ

const BEAST_APP_ITEMS = [
  {
    id: "equip", view: "equip",
    label: () => "おとも魔獣をセット",
    note: () => { const cur = getEquippedBeast(); return cur ? `セット中：${beastName(cur.entry)}（${cur.breakCount}${gachaConfig("beast").breakLabel}）` : "セット中：なし"; }
  }
];
const BEAST_APP_PARENT = { equip: "home" };
let beastAppView = "home";
let beastAppNotice = "";

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
  const parent = BEAST_APP_PARENT[beastAppView];
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
  (beastAppView === "equip" ? beastAppRenderEquip : beastAppRenderHome)(panel);
  if (beastAppNotice) {
    const noticeEl = guildAppEl("p", "guild-app-notice", beastAppNotice);   // guild_app.js の部品
    const title = panel.querySelector(".monster-codex-title");
    if (title && title.nextSibling) panel.insertBefore(noticeEl, title.nextSibling); else panel.appendChild(noticeEl);
  }
  const buttons = Array.from(panel.querySelectorAll("button:not([disabled])"));
  const target = buttons[Math.min(Math.max(0, focusIndex), buttons.length - 1)];
  if (target) target.focus();
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
  panel.appendChild(guildAppEl("p", "element-combo-note", "魔獣は1体までセットできます。パーティの編成とは別で、いつでも付け替えられます。◎は、今のパーティで相性の効果が出ているものです。"));
  const owned = gachaOwnedEntries("beast");
  const equippedId = getEquippedBeastId();
  if (owned.length === 0) {
    panel.appendChild(guildAppEl("p", "element-combo-empty", `まだ魔獣を持っていません。冒険者協会アプリの「${cfg.name}」で手に入ります。`));
  }
  owned.forEach(entry => {
    panel.appendChild(beastAppEntryButton(entry, entry.id === equippedId, () => {
      setEquippedBeast(entry.id);
      beastAppNotice = `「${beastName(entry)}」をセットした。`;
      renderBeastAppPanel(owned.indexOf(entry));
    }, inBattle));
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
