// guild_app.js
// ===================================================================
// ===== 便利タブの「冒険者協会」アプリ =====
// ===================================================================
// ★スマホのホーム画面のようなアイコン（convenience.js の CONVENIENCE_APPS）のひとつ。
//   （本当のスマホではないが、分かりやすくするために「アプリ」と呼んでいる）
//   アプリを開くと、項目の一覧が出る。今ある項目は「技ガチャ」と「魔獣召喚」。項目を増やす時は GUILD_APP_ITEMS に足す。
// ★ガチャの中身（抽選・天井・凸など）は gacha.js。ここは画面だけを持つ。
//   画面はメッセージ送りではなく、便利タブの他のアプリと同じ「パネル」（#guild-app-panel）で動くので、
//   場面を問わずいつでも開ける。ただし、戦闘中は技のセットだけ変えられない
// ★キー操作：上下＝ボタンの移動／決定キー＝押す／キャンセルキー＝ひとつ前の画面へ

// アプリの中の項目。label は呼び名が設定で変わるので関数にしている
// kind＝ガチャの種類（"skill"＝技ガチャ／"beast"＝魔獣召喚）。同じガチャの画面を、種類を切り替えて使う
const GUILD_APP_ITEMS = [
  { id: "gacha", kind: "skill", label: () => gachaConfig("skill").name, note: () => `${gachaStoneLabel()} ${gachaStonesHeld()}個`, view: "gacha" },
  { id: "summon", kind: "beast", label: () => gachaConfig("beast").name, note: () => `${gachaStoneLabel()} ${gachaStonesHeld()}個`, view: "gacha" }
];

// 画面（view）と、「戻る」で行き先の対応表
const GUILD_APP_PARENT = { gacha: "home", info: "gacha", equip: "gacha", equipUnit: "equip", equipPick: "equipUnit" };

let guildAppView = "home";
let guildAppResults = null;      // 直前にガチャを引いた結果（文章の配列）。ガチャの画面を離れたら消す
let guildAppNotice = "";         // 画面の上に出す一言（引けなかった理由など）
let guildAppKind = "skill";      // いま開いているガチャの種類（"skill"／"beast"）
let guildAppBusy = false;        // 魔獣召喚の演出の最中（この間は、決定・キャンセルキーで演出を飛ばす）
let guildAppSkipSummon = null;   // 演出を飛ばす関数
let guildAppSession = 0;         // アプリを開き直すたびに増やす（演出の終了後に、閉じたアプリを開き直してしまわないための印）
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
  guildAppSession += 1;
  guildAppBusy = false;
  guildAppView = "home";
  guildAppResults = null;
  guildAppNotice = "";
  renderGuildAppPanel(0);
  window.removeEventListener("keydown", handleGuildAppKeyDown);
  window.addEventListener("keydown", handleGuildAppKeyDown);
}

function closeGuildAppPanel() {
  guildAppSession += 1;
  guildAppBusy = false;
  window.removeEventListener("keydown", handleGuildAppKeyDown);
  const panel = document.getElementById("guild-app-panel");
  if (panel) panel.classList.add("hidden");
  renderConvenienceIcons(); // convenience.js
}

// 便利タブの他のアプリを開く時などに、このアプリを畳む（convenience.js の closeAllConvenienceSubPanels から呼ぶ）。
// 魔獣召喚の演出の最中でも、演出を止めて、あとから画面が復活しないようにする
function guildAppAbort() {
  guildAppSession += 1;   // 演出の終了を待っている処理が、画面を作り直さないための印
  const skip = guildAppSkipSummon;
  guildAppSkipSummon = null;
  if (skip) skip();
  guildAppBusy = false;
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
  if (guildAppBusy) {   // 魔獣召喚の演出の最中：決定・キャンセルキーで演出を飛ばす（他のキーは受け付けない）
    event.preventDefault();
    if ((KEY_CONFIG.decideKeys.includes(event.key) || KEY_CONFIG.cancelKeys.includes(event.key)) && guildAppSkipSummon) guildAppSkipSummon();
    return;
  }
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
    const btn = guildAppButton(item.label(), () => { guildAppResults = null; guildAppKind = item.kind || "skill"; guildAppGo(item.view); });
    if (item.note) btn.appendChild(guildAppEl("span", "guild-app-btn-note", item.note()));
    panel.appendChild(btn);
  });
  guildAppBackButton(panel, "◀ 閉じる");
}

// ===== ガチャ =====
// 引く。魔獣召喚は、結果を出す前に魔法陣の演出を流す（演出の最中に画面が切り替わらないよう、印で見張る）
async function guildAppDoPull(count, kind) {
  const session = guildAppSession;
  const result = gachaTryPull(count, kind);
  if (!result.ok) {
    guildAppResults = null;
    guildAppNotice = result.message;
    renderGuildAppPanel(count === 1 ? 0 : 1);
    return;
  }
  if (kind === "beast") {
    await guildAppPlaySummon(result.topRarity, count);
    if (session !== guildAppSession) return;   // 演出の間にアプリを閉じた・開き直した時は、画面を作り直さない
  }
  guildAppResults = result.lines;
  guildAppNotice = "";
  renderGuildAppPanel(count === 1 ? 0 : 1);
}

function guildAppRenderGacha(panel) {
  const kind = guildAppKind;
  const cfg = gachaConfig(kind);
  const st = gachaState(kind);
  const period = gachaPeriodStatus(kind);
  const open = period.state === "open";
  panel.appendChild(guildAppEl("h3", "monster-codex-title", cfg.name));

  const status = guildAppEl("div", "element-combo-item");
  status.appendChild(guildAppEl("div", "element-combo-name", `${gachaStoneLabel()}：${gachaStonesHeld()}個`));
  status.appendChild(guildAppEl("div", "element-combo-note", gachaPeriodText(kind)));
  if (cfg.pity > 0) status.appendChild(guildAppEl("div", "element-combo-note", `${cfg.pityLabel}まであと${Math.max(1, cfg.pity - st.pity)}回`));
  panel.appendChild(status);

  const closedNote = open ? "" : (period.state === "before" ? "（開催前）" : "（開催終了）");
  [1, 10].forEach(count => {
    panel.appendChild(guildAppButton(`${count}回${cfg.pullLabel}（${gachaStoneLabel()}${cfg.cost * count}個）${closedNote}`, () => {
      guildAppDoPull(count, kind);
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
  if (kind === "beast") {
    panel.appendChild(guildAppEl("p", "element-combo-note", "手に入れた魔獣は、アプリ「おとも魔獣」でセットできます。"));
  } else {
    panel.appendChild(guildAppButton("技をセットする", () => guildAppGo("equip")));
  }
  guildAppBackButton(panel);
}

function guildAppRenderInfo(panel) {
  panel.appendChild(guildAppEl("h3", "monster-codex-title", `${gachaConfig(guildAppKind).name}：排出内容`));
  gachaInfoLines(guildAppKind).forEach(line => {
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

// ===== 魔獣召喚の演出：魔法陣が妖しく光る =====
// 魔法陣が描かれ、紫と赤の光が脈打ち、最後に光が弾ける。結果のレア度が高いほど、光の色が変わる（スーパーレアは金に近い色）。
// 画像は使わず、SVG と CSS だけで描く（style.css の .summon-*）。クリック・決定キー・キャンセルキーで飛ばせる。
// 戻り値：演出が終わったら解決する Promise
function guildAppPlaySummon(topRarity, count) {
  return new Promise(resolve => {
    const panel = document.getElementById("guild-app-panel");
    if (!panel) { resolve(); return; }
    const reduce = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const palette = { N: ["#a46bff", "#4a1d8a"], R: ["#ff4fb0", "#7a1650"], SR: ["#ffd24a", "#d1243a"] }[topRarity] || ["#a46bff", "#4a1d8a"];
    const total = reduce ? 700 : Math.round((topRarity === "SR" ? 3300 : (topRarity === "R" ? 2700 : 2300)) * (count > 1 ? 0.8 : 1));

    const prevOverflow = panel.style.overflow, prevPosition = panel.style.position;
    panel.scrollTop = 0;
    panel.style.overflow = "hidden";
    if (!panel.style.position) panel.style.position = "relative";

    const overlay = document.createElement("div");
    overlay.className = "summon-overlay summon-" + (topRarity || "N");
    overlay.style.setProperty("--c1", palette[0]);
    overlay.style.setProperty("--c2", palette[1]);
    overlay.style.setProperty("--dur", total + "ms");
    overlay.innerHTML = `
      <div class="summon-mist"></div>
      <svg class="summon-circle" viewBox="0 0 200 200" aria-hidden="true">
        <g class="summon-ring summon-ring-a">
          <circle class="summon-draw" cx="100" cy="100" r="94" />
          <circle cx="100" cy="100" r="88" stroke-dasharray="2 6" />
        </g>
        <g class="summon-ring summon-ring-b">
          <circle class="summon-draw" cx="100" cy="100" r="76" />
          <circle cx="100" cy="100" r="70" stroke-dasharray="10 5 2 5" />
        </g>
        <g class="summon-ring summon-ring-c">
          <polygon class="summon-draw" points="100,28 162.4,136 37.6,136" />
          <polygon class="summon-draw" points="100,172 37.6,64 162.4,64" />
        </g>
        <circle class="summon-draw summon-core" cx="100" cy="100" r="22" />
        <circle class="summon-eye" cx="100" cy="100" r="6" />
      </svg>
      <div class="summon-caption">魔法陣が、妖しく光り始める……</div>`;
    panel.appendChild(overlay);

    const caption = overlay.querySelector(".summon-caption");
    let finished = false;
    const timers = [];
    const finish = () => {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      guildAppSkipSummon = null;
      overlay.classList.add("summon-fade");
      setTimeout(() => {
        overlay.remove();
        panel.style.overflow = prevOverflow;
        panel.style.position = prevPosition;
        guildAppBusy = false;
        resolve();
      }, 180);
    };
    overlay.onclick = (event) => { event.stopPropagation(); finish(); };
    guildAppBusy = true;
    guildAppSkipSummon = finish;
    timers.push(setTimeout(() => { caption.textContent = "何かが、こちらを覗いている……"; }, Math.round(total * 0.45)));
    timers.push(setTimeout(() => { overlay.classList.add("summon-burst"); caption.textContent = "……！"; }, Math.max(0, total - 600)));
    timers.push(setTimeout(finish, total));
  });
}
