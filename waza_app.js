// waza_app.js
// ===================================================================
// ===== 便利タブの「覚醒技能」アプリ =====
// ===================================================================
// ★「冒険者協会」アプリ（guild_app.js）の「覚醒の儀」で手に入れた技を、セットしたり、くわしく見たりするアプリ。
//   以前は冒険者協会アプリの中にあった「技をセットする」を、このアプリに移した（技のセットはここだけ）。
// ★できること
//   ・キャラごとに、技をセットする（1人につき GACHA_EQUIP_MAX 枠。同じキャラに同じ技は2つセットできない）
//   ・手に入れた技の一覧と、1つずつの詳細（種類・属性・威力・回数・消費・状態異常・自己強化・段階ごとの強化など）
//   ・戦闘中は、技のセットだけ変えられない（詳細は見られる）
// ★中身（技のデータ・段階の反映）は gacha.js。ここは画面だけを持つ。部品（guildAppEl / guildAppButton）は guild_app.js のものを使い回す
// ★キー操作：上下＝ボタンの移動／決定キー＝押す／キャンセルキー＝ひとつ前の画面へ

// 画面（view）と、「戻る」の行き先。detail だけは、どこから来たかで戻り先が変わる（wazaAppDetailFrom）
const WAZA_APP_PARENT = { equipUnit: "home", equipPick: "equipUnit", list: "home" };

let wazaAppView = "home";
let wazaAppNotice = "";
let wazaAppMemberIndex = 0;     // セット中のキャラ（gachaMembers の何番目か）
let wazaAppSlot = 0;            // セット中の枠
let wazaAppDetailId = "";       // 詳細を見ている技のid
let wazaAppDetailFrom = "list"; // 詳細画面の戻り先（"list"／"equipUnit"／"equipPick"）

function wazaAppIsInBattle() {
  return typeof battleState !== "undefined" && !!battleState;
}

// ===== 開く・閉じる =====
function openWazaAppPanel() {
  const grid = document.getElementById("convenience-icon-grid");
  if (grid) grid.classList.add("hidden");
  closeAllConvenienceSubPanels(); // convenience.js
  wazaAppView = "home";
  wazaAppNotice = "";
  renderWazaAppPanel(0);
  window.removeEventListener("keydown", handleWazaAppKeyDown);
  window.addEventListener("keydown", handleWazaAppKeyDown);
}

function closeWazaAppPanel() {
  window.removeEventListener("keydown", handleWazaAppKeyDown);
  const panel = document.getElementById("waza-app-panel");
  if (panel) panel.classList.add("hidden");
  renderConvenienceIcons(); // convenience.js
}

function wazaAppBack() {
  const parent = wazaAppView === "detail" ? wazaAppDetailFrom : WAZA_APP_PARENT[wazaAppView];
  if (!parent) { closeWazaAppPanel(); return; }
  wazaAppView = parent;
  wazaAppNotice = "";
  renderWazaAppPanel(0);
}

function wazaAppGo(view, focusIndex = 0) {
  wazaAppView = view;
  wazaAppNotice = "";
  renderWazaAppPanel(focusIndex);
}

function wazaAppOpenDetail(id, from) {
  wazaAppDetailId = id;
  wazaAppDetailFrom = from;
  wazaAppGo("detail");
}

function handleWazaAppKeyDown(event) {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return;
  if (controlFocus !== "sub") return;
  if (isGameDialogOpen) return;
  const activeTab = document.querySelector(".tab-content.active");
  if (!activeTab || activeTab.id !== "tab-convenience") return;
  const panel = document.getElementById("waza-app-panel");
  if (!panel || panel.classList.contains("hidden")) return;
  if (KEY_CONFIG.cancelKeys.includes(event.key)) {
    event.preventDefault();
    wazaAppBack();
    return;
  }
  const buttons = Array.from(panel.querySelectorAll("button:not([disabled])"));
  const index = buttons.indexOf(document.activeElement);
  if (wazaAppView === "detail" && guildAppDetailKeyScroll(panel, event, buttons, index)) return;   // 詳細画面は、上下キーでスクロール（guild_app.js）
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

// ===== 部品 =====
function renderWazaAppPanel(focusIndex = 0) {
  const panel = document.getElementById("waza-app-panel");
  if (!panel) return;
  panel.classList.remove("hidden");
  panel.innerHTML = "";
  const renderers = { home: wazaAppRenderHome, equipUnit: wazaAppRenderEquipUnit, equipPick: wazaAppRenderEquipPick, list: wazaAppRenderList, detail: wazaAppRenderDetail };
  (renderers[wazaAppView] || wazaAppRenderHome)(panel);
  if (wazaAppNotice) {
    const noticeEl = guildAppEl("p", "guild-app-notice", wazaAppNotice);   // guild_app.js の部品
    const title = panel.querySelector(".monster-codex-title");
    if (title && title.nextSibling) panel.insertBefore(noticeEl, title.nextSibling); else panel.appendChild(noticeEl);
  }
  const buttons = Array.from(panel.querySelectorAll("button:not([disabled])"));
  const target = buttons[Math.min(Math.max(0, focusIndex), buttons.length - 1)];
  if (target) target.focus({ preventScroll: wazaAppView === "detail" });   // 詳細画面は、一番上から読み始められるように、フォーカスでスクロールさせない
}

function wazaAppBackButton(panel, label = "◀ 戻る") {
  const back = guildAppEl("button", "monster-codex-back-btn", label);
  back.onclick = (event) => { event.stopPropagation(); wazaAppBack(); };
  panel.appendChild(back);
}

function wazaAppMember() {
  const members = gachaMembers();
  return members[Math.min(wazaAppMemberIndex, members.length - 1)];
}

// ===== 技の中身を、読みやすい文章にする =====
function wazaAppElementName(elementId) {
  if (!elementId || elementId === "無") return "無";
  const def = (typeof getElementDefById === "function") ? getElementDefById(elementId) : null;
  return def ? (def.name || "無") : "無";
}

function wazaAppStatusKindLabel(kind) {
  const def = (typeof resolveStatusAilmentDef === "function" ? resolveStatusAilmentDef(kind) : null)
    || (typeof resolveStatusBuffDef === "function" ? resolveStatusBuffDef(kind) : null);
  if (def && (def.label || def.name)) return def.label || def.name;
  return (typeof STATUS_EFFECT_LABELS !== "undefined" && STATUS_EFFECT_LABELS[kind]) || kind;
}

function wazaAppPercent(v) {
  return `${Math.round((Number(v) || 0) * 1000) / 10}%`;
}

function wazaAppTypeLabel(skill) {
  if (Array.isArray(skill.blocks) && skill.blocks.length > 0) return "特殊（いくつもの効果を組み合わせた技）";
  if (skill.type === "heal") return "回復";
  if (skill.type === "buff") return "自己強化";
  return `攻撃（${skill.atkType === "magical" ? "魔法" : "物理"}）`;
}

function wazaAppTargetLabel(skill) {
  if (skill.type === "heal") return skill.partyWide ? "自分と仲間全員" : "味方1人";
  if (skill.type === "buff") return "自分";
  if (skill.randomTarget) return "敵（ランダムに選ばれる）";
  return skill.target === "all" ? "敵全体" : "敵1体";
}

function wazaAppCostText(skill) {
  return skill.isUpper ? `焦力${Math.round(Number(skill.shouryokuCost) || 0)}` : `SP${Math.round(Number(skill.spCost) || 0)}`;
}

// 技のくわしい項目 [[名前, 値], …]。skill＝gachaBuildRuntimeSkill が返す、段階を反映した技
function wazaAppDetailRows(entry, breakCount) {
  const skill = gachaBuildRuntimeSkill(entry, breakCount);
  const rows = [];
  rows.push(["種類", wazaAppTypeLabel(skill)]);
  rows.push(["属性", wazaAppElementName(skill.element)]);
  rows.push(["対象", wazaAppTargetLabel(skill)]);
  rows.push(["消費", wazaAppCostText(skill)]);
  if (skill.type === "attack" || skill.type === "heal") rows.push(["威力", String(Math.round(Number(skill.power) || 0))]);
  if (skill.type === "attack") rows.push(["攻撃回数", `${Math.max(1, Math.round(Number(skill.hitCount) || 1))}回`]);
  [skill.statusEffect, skill.statusEffect2].filter(Boolean).forEach((s, i) => {
    rows.push([`状態異常${i + 1}`, `${wazaAppStatusKindLabel(s.kind)}（確率${wazaAppPercent(s.chance)}・${s.duration}ターン・効果量${s.power}）`]);
  });
  [skill.selfBuff, skill.selfBuff2].filter(Boolean).forEach((b, i) => {
    rows.push([`自己強化${i + 1}`, `${wazaAppStatusKindLabel(b.kind)}（${b.duration}ターン・効果量${b.power}${b.mode === "multiply" ? "・掛け算" : ""}）`]);
  });
  if (skill.lifestealRatio) rows.push(["HP吸収", `与えたダメージの${wazaAppPercent(skill.lifestealRatio)}を回復`]);
  if (skill.cleanse) rows.push(["追加効果", "状態異常を回復する"]);
  if (skill.revives) rows.push(["追加効果", "戦闘不能の仲間を蘇生できる"]);
  if (skill.triggerChance != null) rows.push(["発動率", wazaAppPercent(skill.triggerChance)]);
  return rows;
}

// 段階ごとの強化の文章（1段階ぶん）。例：「威力＋5／攻撃回数＋1」
function wazaAppBreakText(entry, index) {
  const table = Array.isArray(entry.limitBreaks) ? entry.limitBreaks : [];
  const parts = (Array.isArray(table[index]) ? table[index] : []).slice(0, 3).map(p => {
    const def = p && GACHA_BREAK_PARAMS.find(x => x.key === p.param);
    const v = Number(p && p.value) || 0;
    if (!def || !v) return null;
    const label = def.label.replace(/（.*）$/, "");
    return `${label}${v > 0 ? "＋" : "−"}${Math.abs(v)}`;
  }).filter(Boolean);
  return parts.length ? parts.join("／") : "（変化なし）";
}

// この技をセットしているキャラの名前
function wazaAppUsers(id) {
  return gachaMembers().filter(m => gachaEquipIds(m.unit).includes(id)).map(m => m.name);
}

// ===== 画面：最初 =====
function wazaAppRenderHome(panel) {
  panel.appendChild(guildAppEl("h3", "monster-codex-title", "覚醒技能"));
  if (wazaAppIsInBattle()) panel.appendChild(guildAppEl("p", "guild-app-notice", "戦闘中は、技のセットを変えられません。（詳細は見られます）"));
  panel.appendChild(guildAppEl("p", "element-combo-note", `覚醒した技を、キャラ1人につき${GACHA_EQUIP_MAX}つまでセットできます。誰が使っても、職業に関係なく使えます。技は、冒険者協会アプリの「${gachaConfig("skill").name}」で目覚めます。`));
  gachaMembers().forEach((member, index) => {
    const names = gachaEquipIds(member.unit).filter(Boolean).map(id => gachaSkillName(gachaEntryById(id)));
    const btn = guildAppButton(member.name, () => { wazaAppMemberIndex = index; wazaAppGo("equipUnit"); }, { disabled: wazaAppIsInBattle() });
    btn.appendChild(guildAppEl("span", "guild-app-btn-note", names.length ? names.join("／") : "（なし）"));
    panel.appendChild(btn);
  });
  const ownedCount = gachaOwnedEntries().length;
  const listBtn = guildAppButton("覚醒した技の一覧・詳細", () => wazaAppGo("list"));
  listBtn.appendChild(guildAppEl("span", "guild-app-btn-note", `${ownedCount}種`));
  panel.appendChild(listBtn);
  wazaAppBackButton(panel, "◀ 閉じる");
}

// ===== 画面：キャラの枠 =====
function wazaAppRenderEquipUnit(panel) {
  const member = wazaAppMember();
  const cfg = gachaConfig("skill");
  panel.appendChild(guildAppEl("h3", "monster-codex-title", `${member.name}にセットする技`));
  if (wazaAppIsInBattle()) panel.appendChild(guildAppEl("p", "guild-app-notice", "戦闘中は、技のセットを変えられません。"));
  gachaEquipIds(member.unit).forEach((id, slot) => {
    const entry = id ? gachaEntryById(id) : null;
    const btn = guildAppButton(`枠${slot + 1}`, () => { wazaAppSlot = slot; wazaAppGo("equipPick"); }, { disabled: wazaAppIsInBattle() });
    btn.appendChild(guildAppEl("span", "guild-app-btn-note", entry ? `${gachaSkillName(entry)}（${gachaOwnedBreak(id)}${cfg.breakLabel}・${gachaCostLabel(entry)}）` : "（空き）"));
    panel.appendChild(btn);
    if (entry) panel.appendChild(guildAppButton(`▶ 「${gachaSkillName(entry)}」の詳細`, () => wazaAppOpenDetail(id, "equipUnit")));
  });
  wazaAppBackButton(panel);
}

// ===== 画面：枠にセットする技を選ぶ =====
function wazaAppRenderEquipPick(panel) {
  const member = wazaAppMember();
  const cfg = gachaConfig("skill");
  panel.appendChild(guildAppEl("h3", "monster-codex-title", `${member.name}：枠${wazaAppSlot + 1}`));
  const ids = gachaEquipIds(member.unit);
  const otherId = ids[wazaAppSlot === 0 ? 1 : 0];   // 同じキャラに、同じ技を2つはセットできない
  const owned = gachaOwnedEntries().filter(e => e.id !== otherId);
  if (owned.length === 0) panel.appendChild(guildAppEl("p", "element-combo-empty", "セットできる技を、まだ持っていません。"));
  owned.forEach(entry => {
    const rarity = gachaRarityOf(entry);
    const btn = guildAppButton(`【${gachaRarityLabel(rarity)}】${gachaSkillName(entry)}${ids[wazaAppSlot] === entry.id ? "（セット中）" : ""}`, () => {
      setGachaEquip(member.unit, wazaAppSlot, entry.id);
      wazaAppGo("equipUnit");
    }, { className: rarity === "SR" ? "guild-app-btn-sr" : (rarity === "R" ? "guild-app-btn-r" : "") });
    btn.appendChild(guildAppEl("span", "guild-app-btn-note", `${gachaOwnedBreak(entry.id)}${cfg.breakLabel}・${gachaCostLabel(entry)}${entry.description ? "｜" + stripRubyNotation(entry.description) : ""}`));
    panel.appendChild(btn);
    panel.appendChild(guildAppButton(`▶ 詳細`, () => wazaAppOpenDetail(entry.id, "equipPick")));
  });
  if (ids[wazaAppSlot]) {
    panel.appendChild(guildAppButton("この枠の技を外す", () => {
      setGachaEquip(member.unit, wazaAppSlot, null);
      wazaAppGo("equipUnit");
    }));
  }
  wazaAppBackButton(panel);
}

// ===== 画面：覚醒した技の一覧 =====
function wazaAppRenderList(panel) {
  const cfg = gachaConfig("skill");
  panel.appendChild(guildAppEl("h3", "monster-codex-title", "覚醒した技の一覧"));
  const owned = gachaOwnedEntries();
  if (owned.length === 0) panel.appendChild(guildAppEl("p", "element-combo-empty", `まだ技が目覚めていません。冒険者協会アプリの「${cfg.name}」で手に入ります。`));
  owned.forEach(entry => {
    const rarity = gachaRarityOf(entry);
    const btn = guildAppButton(`【${gachaRarityLabel(rarity)}】${gachaSkillName(entry)}`, () => wazaAppOpenDetail(entry.id, "list"),
      { className: rarity === "SR" ? "guild-app-btn-sr" : (rarity === "R" ? "guild-app-btn-r" : "") });
    const users = wazaAppUsers(entry.id);
    btn.appendChild(guildAppEl("span", "guild-app-btn-note", `${gachaOwnedBreak(entry.id)}${cfg.breakLabel}・${gachaCostLabel(entry)}${users.length ? "｜セット中：" + users.join("、") : ""}`));
    panel.appendChild(btn);
  });
  wazaAppBackButton(panel);
}

// ===== 画面：技の詳細 =====
function wazaAppRenderDetail(panel) {
  const entry = gachaEntryById(wazaAppDetailId);
  if (!entry || gachaOwnedBreak(entry.id) < 0) {
    panel.appendChild(guildAppEl("h3", "monster-codex-title", "技の詳細"));
    panel.appendChild(guildAppEl("p", "element-combo-empty", "この技は見つかりませんでした。"));
    wazaAppBackButton(panel);
    return;
  }
  const cfg = gachaConfig("skill");
  const rarity = gachaRarityOf(entry);
  const breakCount = gachaOwnedBreak(entry.id);
  panel.appendChild(guildAppEl("h3", "monster-codex-title", gachaSkillName(entry)));

  const card = guildAppEl("div", "element-combo-item waza-detail-card");
  card.appendChild(guildAppEl("div", "element-combo-name", `【${gachaRarityLabel(rarity)}】${breakCount}${cfg.breakLabel}（最大${GACHA_MAX_BREAK}${cfg.breakLabel}）`));
  if (entry.description) card.appendChild(guildAppEl("div", "element-combo-note", stripRubyNotation(entry.description)));
  wazaAppDetailRows(entry, breakCount).forEach(([key, value]) => {
    const row = guildAppEl("div", "waza-detail-row");
    row.appendChild(guildAppEl("span", "waza-detail-key", key));
    row.appendChild(guildAppEl("span", "waza-detail-value", value));
    card.appendChild(row);
  });
  const users = wazaAppUsers(entry.id);
  const useRow = guildAppEl("div", "waza-detail-row");
  useRow.appendChild(guildAppEl("span", "waza-detail-key", "セット中"));
  useRow.appendChild(guildAppEl("span", "waza-detail-value", users.length ? users.join("、") : "（誰もセットしていません）"));
  card.appendChild(useRow);
  panel.appendChild(card);

  wazaAppBackButton(panel);
}
