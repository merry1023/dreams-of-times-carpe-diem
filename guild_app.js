// guild_app.js
// ===================================================================
// ===== 便利タブの「冒険者協会」アプリ =====
// ===================================================================
// ★スマホのホーム画面のようなアイコン（convenience.js の CONVENIENCE_APPS）のひとつ。
//   （本当のスマホではないが、分かりやすくするために「アプリ」と呼んでいる）
//   アプリを開くと、項目の一覧が出る。今ある項目は「覚醒の儀（技）」と「魔獣召喚」。項目を増やす時は GUILD_APP_ITEMS に足す。
// ★手に入れた技のセット・詳細は、別アプリ「覚醒技能」（waza_app.js）に移した。ここは技を手に入れるところだけ
// ★ガチャの中身（抽選・天井・凸など）は gacha.js。ここは画面だけを持つ。
//   画面はメッセージ送りではなく、便利タブの他のアプリと同じ「パネル」（#guild-app-panel）で動くので、
//   場面を問わずいつでも開ける
// ★キー操作：上下＝ボタンの移動／決定キー＝押す／キャンセルキー＝ひとつ前の画面へ

// アプリの中の項目。label は呼び名が設定で変わるので関数にしている
// kind＝ガチャの種類（"skill"＝覚醒の儀（技）／"beast"＝魔獣召喚）。同じガチャの画面を、種類を切り替えて使う
const GUILD_APP_ITEMS = [
  { id: "gacha", kind: "skill", label: () => gachaConfig("skill").name, note: () => `${gachaStoneLabel()} ${gachaStonesHeld()}個`, view: "gacha" },
  { id: "summon", kind: "beast", label: () => gachaConfig("beast").name, note: () => `${gachaStoneLabel()} ${gachaStonesHeld()}個`, view: "gacha" }
];

// 画面（view）と、「戻る」で行き先の対応表
const GUILD_APP_PARENT = { gacha: "home", info: "gacha" };

let guildAppView = "home";
let guildAppResults = null;      // 直前にガチャを引いた結果（文章の配列）。ガチャの画面を離れたら消す
let guildAppNotice = "";         // 画面の上に出す一言（引けなかった理由など）
let guildAppKind = "skill";      // いま開いているガチャの種類（"skill"／"beast"）
let guildAppBusy = false;        // ガチャの演出の最中（この間は、決定キー＝次へ／Hキー・キャンセルキー＝スキップ）
let guildAppFxAdvance = null;    // いまの演出を1段進める関数（決定キー・画面タップ）。演出の最中だけ入る
let guildAppFxSkipAll = null;    // 残りの演出を全部飛ばして結果一覧へ進む関数（スキップボタン・Hキー・キャンセルキー）
let guildAppSkipRequested = false; // 今回のガチャで「スキップ」が押された（以降の演出を出さない）
let guildAppSession = 0;         // アプリを開き直すたびに増やす（演出の終了後に、閉じたアプリを開き直してしまわないための印）

// 演出のスキップに使うキー。メッセージの早送り（mainfunc.js の fastForwardKey＝同じHキー）とは混ぜない：
// 演出の最中は、こちらが先にHキーを受け取り、早送りのON/OFFには届かせない
const GUILD_APP_SKIP_KEYS = ["h", "H"];
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
  guildAppSkipRequested = false;
  renderGuildAppPanel(0);
  window.removeEventListener("keydown", handleGuildAppKeyDown);
  window.addEventListener("keydown", handleGuildAppKeyDown);
  window.removeEventListener("keydown", handleGuildAppSkipKey, true);
  window.addEventListener("keydown", handleGuildAppSkipKey, true);   // true＝他のキー処理より先に受け取る（Hキーの早送りと混ぜないため）
}

function closeGuildAppPanel() {
  guildAppSession += 1;
  guildAppBusy = false;
  guildAppFxAdvance = null;
  guildAppFxSkipAll = null;
  window.removeEventListener("keydown", handleGuildAppKeyDown);
  window.removeEventListener("keydown", handleGuildAppSkipKey, true);
  const panel = document.getElementById("guild-app-panel");
  if (panel) panel.classList.add("hidden");
  renderConvenienceIcons(); // convenience.js
}

// 便利タブの他のアプリを開く時などに、このアプリを畳む（convenience.js の closeAllConvenienceSubPanels から呼ぶ）。
// ガチャの演出の最中でも、演出を止めて、あとから画面が復活しないようにする
function guildAppAbort() {
  guildAppSession += 1;   // 演出の終了を待っている処理が、画面を作り直さないための印
  const skip = guildAppFxSkipAll;
  guildAppFxAdvance = null;
  guildAppFxSkipAll = null;
  if (skip) skip();
  guildAppBusy = false;
}

// 演出の最中のHキー：残りの演出を全部飛ばす。メッセージの早送り（同じHキー）には届かせない
function handleGuildAppSkipKey(event) {
  if (!guildAppBusy) return;
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return;
  const panel = document.getElementById("guild-app-panel");
  if (!panel || panel.classList.contains("hidden")) return;
  if (!GUILD_APP_SKIP_KEYS.includes(event.key)) return;
  event.preventDefault();
  event.stopImmediatePropagation();   // 早送りのON/OFF（mainfunc.js）が反応しないようにする
  if (event.repeat) return;
  if (guildAppFxSkipAll) guildAppFxSkipAll();
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
  if (guildAppBusy) {   // ガチャの演出の最中：決定キー＝次へ／キャンセルキー（とHキー）＝全部スキップ。他のキーは受け付けない
    event.preventDefault();
    if (event.repeat) return;   // 押しっぱなしで、1連ずつの結果が一気に飛ばされないように
    if (KEY_CONFIG.decideKeys.includes(event.key) && guildAppFxAdvance) guildAppFxAdvance();
    else if (KEY_CONFIG.cancelKeys.includes(event.key) && guildAppFxSkipAll) guildAppFxSkipAll();
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
// ★詳細画面（おとも魔獣・覚醒技）をキーボードでスクロールする。上下キーで、まず画面をスクロールし、
//   一番下まで来たらボタン（セット・戻る）の間を移動する。戻り値：キーを処理した＝true
function guildAppDetailKeyScroll(panel, event, buttons, index) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return false;
  event.preventDefault();
  const step = Math.max(40, Math.round(panel.clientHeight * 0.4));
  const atBottom = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 2;
  if (event.key === "ArrowDown") {
    if (!atBottom) { panel.scrollBy({ top: step }); return true; }
    if (buttons.length > 0) buttons[Math.min(buttons.length - 1, index + 1)].focus();
  } else {
    if (atBottom && index > 0) { buttons[index - 1].focus(); return true; }
    panel.scrollBy({ top: -step });
  }
  return true;
}

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
  const renderers = { home: guildAppRenderHome, gacha: guildAppRenderGacha, info: guildAppRenderInfo };
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
// 引く。結果の一覧を出す前に、次の順で演出を流す（演出の最中に画面が切り替わらないよう、印で見張る）
//   ① 導入の演出：魔獣召喚＝魔法陣が妖しく光る／技ガチャ＝覚醒（力が目覚める）
//   ② 1連ずつ、何が当たったのかをポップアップ（タップ・決定キーで次へ）
//   ※スキップ（ボタン・Hキー・キャンセルキー）を押すと、残りの演出を全部飛ばして結果一覧へ進む
async function guildAppDoPull(count, kind) {
  const session = guildAppSession;
  const result = gachaTryPull(count, kind);
  if (!result.ok) {
    guildAppResults = null;
    guildAppNotice = result.message;
    renderGuildAppPanel(count === 1 ? 0 : 1);
    return;
  }
  guildAppSkipRequested = false;
  if (kind === "beast") await guildAppPlaySummon(result.topRarity, count);
  else await guildAppPlayAwaken(result.topRarity, count);
  if (session !== guildAppSession) return;   // 演出の間にアプリを閉じた・開き直した時は、画面を作り直さない
  if (!guildAppSkipRequested && result.pulls && result.pulls.length > 0) {
    await guildAppPlayReveals(result.pulls, kind);
    if (session !== guildAppSession) return;
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

  const closedNote = open ? "" : (period.state === "before" ? "（まだ行えません）" : "（受付終了）");
  [1, 10].forEach(count => {
    panel.appendChild(guildAppButton(`${count}回${cfg.pullLabel}（${gachaStoneLabel()}${cfg.cost * count}個）${closedNote}`, () => {
      guildAppDoPull(count, kind);
    }, { disabled: !open }));
  });

  if (guildAppResults && guildAppResults.length > 0) {
    const box = guildAppEl("div", "guild-app-results");
    box.appendChild(guildAppEl("div", "element-combo-name", "結果"));
    guildAppResults.forEach(line => {
      const cls = line.includes(`【${gachaRarityLabel("SR")}】`) ? "guild-app-result-sr" : (line.includes(`【${gachaRarityLabel("R")}】`) ? "guild-app-result-r" : "");
      box.appendChild(guildAppEl("div", "guild-app-result-line " + cls, line));
    });
    panel.appendChild(box);
  }

  panel.appendChild(guildAppButton("授かる力の一覧を見る", () => guildAppGo("info")));
  if (kind === "beast") {
    panel.appendChild(guildAppEl("p", "element-combo-note", "手に入れた魔獣は、アプリ「おとも魔獣」でセットできます。"));
  } else {
    panel.appendChild(guildAppEl("p", "element-combo-note", "目覚めた技は、アプリ「覚醒技能」でセットできます。"));
  }
  guildAppBackButton(panel);
}

function guildAppRenderInfo(panel) {
  panel.appendChild(guildAppEl("h3", "monster-codex-title", `${gachaConfig(guildAppKind).name}：授かる力の一覧`));
  gachaInfoLines(guildAppKind).forEach(line => {
    const item = guildAppEl("div", "element-combo-item");
    item.appendChild(guildAppEl("div", "guild-app-info-line", line));
    panel.appendChild(item);
  });
  guildAppBackButton(panel);
}

// ===================================================================
// ===== ガチャの演出（共通の部品） =====
// ===================================================================
// 演出はどれも、パネル（#guild-app-panel）の上に重ねる全画面のオーバーレイ。画像は使わず、CSS と SVG だけで描く（style.css）。
//   ・画面タップ／決定キー＝いまの演出を1段進める（導入ならそこで終わり、1連ずつのポップアップなら次の1連へ）
//   ・スキップボタン／Hキー／キャンセルキー＝残りの演出を全部飛ばして、結果一覧へ進む
//   ・演出の最中は guildAppBusy が true（キー操作は handleGuildAppKeyDown / handleGuildAppSkipKey が受け持つ）

function guildAppReduceMotion() {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// 演出の開始：パネルのスクロールを止めて、押す直前のボタンからフォーカスを外す
// （フォーカスが残っていると、決定キー［スペース］で裏のボタンがもう一度押されてしまうため）
// 戻り値：演出の終了時に、元の状態へ戻す関数
function guildAppFxBegin(panel) {
  const prevOverflow = panel.style.overflow, prevPosition = panel.style.position;
  panel.scrollTop = 0;
  panel.style.overflow = "hidden";
  if (!panel.style.position) panel.style.position = "relative";
  if (document.activeElement && typeof document.activeElement.blur === "function") document.activeElement.blur();
  guildAppBusy = true;
  return () => {
    panel.style.overflow = prevOverflow;
    panel.style.position = prevPosition;
  };
}

// 右上の「スキップ」ボタン
function guildAppSkipButton(onSkip) {
  const btn = guildAppEl("button", "gacha-skip-btn");
  btn.type = "button";
  btn.appendChild(guildAppEl("span", "", "スキップ ▶▶"));
  btn.appendChild(guildAppEl("span", "gacha-skip-key", "H"));
  btn.onclick = (event) => { event.stopPropagation(); onSkip(); };
  return btn;
}

// 演出ひとつぶんの土台を作る。
//   build(overlay, api)：オーバーレイの中身を作る。api.finish() で演出を終わらせられる
//   戻り値：演出が終わったら解決する Promise
// advance は「画面タップ／決定キー」で呼ばれる関数（省略すると、その場で演出を終わらせる）
function guildAppRunFx(overlayClass, vars, build, advanceFactory) {
  return new Promise(resolve => {
    const panel = document.getElementById("guild-app-panel");
    if (!panel) { resolve(); return; }
    const session = guildAppSession;
    const restore = guildAppFxBegin(panel);
    const overlay = document.createElement("div");
    overlay.className = overlayClass;
    Object.keys(vars || {}).forEach(k => overlay.style.setProperty(k, vars[k]));
    panel.appendChild(overlay);

    let finished = false;
    const timers = [];
    const later = (fn, ms) => { timers.push(setTimeout(fn, ms)); };
    const finish = () => {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      if (session === guildAppSession) { guildAppFxAdvance = null; guildAppFxSkipAll = null; }
      overlay.classList.add("gacha-fx-fade");
      setTimeout(() => {
        overlay.remove();
        restore();
        if (session === guildAppSession) guildAppBusy = false;   // 演出の間にアプリを閉じた・開き直した時は、触らない
        resolve();
      }, 180);
    };
    const skipAll = () => { guildAppSkipRequested = true; finish(); };
    const api = { overlay, later, finish, skipAll, isFinished: () => finished };
    const advance = (advanceFactory ? advanceFactory(api) : null) || finish;

    overlay.onclick = (event) => { event.stopPropagation(); advance(); };
    guildAppFxAdvance = advance;
    guildAppFxSkipAll = skipAll;
    build(overlay, api);
    overlay.appendChild(guildAppSkipButton(skipAll));
  });
}

// ===================================================================
// ===== 魔獣召喚の演出：魔法陣が妖しく光る =====
// ===================================================================
// 魔法陣が描かれ、紫と赤の光が脈打ち、最後に光が弾ける。結果のレア度が高いほど、光の色が変わる（スーパーレアは金に近い色）。
// style.css の .summon-*。戻り値：演出が終わったら解決する Promise
function guildAppPlaySummon(topRarity, count) {
  const reduce = guildAppReduceMotion();
  const palette = { N: ["#a46bff", "#4a1d8a"], R: ["#ff4fb0", "#7a1650"], SR: ["#ffd24a", "#d1243a"] }[topRarity] || ["#a46bff", "#4a1d8a"];
  const total = reduce ? 700 : Math.round((topRarity === "SR" ? 3300 : (topRarity === "R" ? 2700 : 2300)) * (count > 1 ? 0.8 : 1));
  return guildAppRunFx("summon-overlay summon-" + (topRarity || "N"), { "--c1": palette[0], "--c2": palette[1], "--dur": total + "ms" }, (overlay, api) => {
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
    const caption = overlay.querySelector(".summon-caption");
    api.later(() => { caption.textContent = "何かが、こちらを覗いている……"; }, Math.round(total * 0.45));
    api.later(() => { overlay.classList.add("summon-burst"); caption.textContent = "……！"; }, Math.max(0, total - 600));
    api.later(api.finish, total);
  });
}

// ===================================================================
// ===== 技ガチャの演出：覚醒 =====
// ===================================================================
// 暗がりの中で、四方から光の粒が中心へ集まり、核が脈打ちながら膨らむ。光の柱と放射状の光線が立ちのぼり、
// 最後に「覚醒──！」と閃光が弾けて画面が揺れる。結果のレア度が高いほど、色が変わって長く・激しくなる
// （ノーマル＝蒼／レア＝橙の炎／スーパーレア＝金と紅、光線は虹色）。style.css の .awaken-*。
// 戻り値：演出が終わったら解決する Promise
function guildAppPlayAwaken(topRarity, count) {
  const rarity = (topRarity === "SR" || topRarity === "R") ? topRarity : "N";
  const reduce = guildAppReduceMotion();
  const palette = { N: ["#7fd0ff", "#1d4f9c"], R: ["#ffa94d", "#b23a10"], SR: ["#fff0a0", "#ff3d6e"] }[rarity];
  const total = reduce ? 700 : Math.round((rarity === "SR" ? 3400 : (rarity === "R" ? 2800 : 2300)) * (count > 1 ? 0.85 : 1));
  const sparkCount = reduce ? 0 : (rarity === "SR" ? 26 : (rarity === "R" ? 20 : 14));
  return guildAppRunFx("awaken-overlay awaken-" + rarity, { "--c1": palette[0], "--c2": palette[1], "--dur": total + "ms" }, (overlay, api) => {
    let sparks = "";
    for (let i = 0; i < sparkCount; i++) {
      const angle = Math.round((360 / sparkCount) * i + Math.random() * 14);
      const dist = 120 + Math.round(Math.random() * 90);
      const delay = Math.round(Math.random() * total * 0.35);
      sparks += `<span class="awaken-spark" style="--a:${angle}deg;--r:${dist}px;--delay:${delay}ms"></span>`;
    }
    overlay.innerHTML = `
      <div class="awaken-bg"></div>
      <div class="awaken-rays"></div>
      <div class="awaken-pillar"></div>
      <div class="awaken-ring awaken-ring-1"></div>
      <div class="awaken-ring awaken-ring-2"></div>
      <div class="awaken-sparks">${sparks}</div>
      <div class="awaken-core"></div>
      <div class="awaken-caption">体の奥で、何かが脈打つ……</div>`;
    const caption = overlay.querySelector(".awaken-caption");
    api.later(() => { caption.textContent = "封じられていた力が、目を覚ます……"; }, Math.round(total * 0.4));
    api.later(() => { caption.textContent = "力が、あふれ出す……！"; }, Math.round(total * 0.7));
    api.later(() => { overlay.classList.add("awaken-burst"); caption.textContent = "覚醒──！"; }, Math.max(0, total - 700));
    api.later(api.finish, total);
  });
}

// ===================================================================
// ===== 1連ずつの結果ポップアップ（技ガチャ・魔獣召喚の共通） =====
// ===================================================================
// 何が当たったのかを、1連ずつカードで出す。タップ／決定キーで次の1連へ、最後の1連の次は結果一覧へ。
// スキップ（ボタン・Hキー・キャンセルキー）で、残りを全部飛ばして結果一覧へ。
// pulls：gachaTryPull が返す1連ごとの結果（gacha.js の gachaPullOnce の info）
function guildAppPlayReveals(pulls, kind) {
  if (!Array.isArray(pulls) || pulls.length === 0) return Promise.resolve();
  const cfg = gachaConfig(kind);
  const reduce = guildAppReduceMotion();
  return guildAppRunFx("gacha-reveal-overlay gacha-reveal-" + kind, {}, (overlay, api) => {
    overlay.innerHTML = `
      <div class="gacha-reveal-count"></div>
      <div class="gacha-reveal-stage"></div>
      <div class="gacha-reveal-hint"></div>`;
    api.render = (index) => {
      const info = pulls[index];
      overlay.querySelector(".gacha-reveal-count").textContent = pulls.length > 1 ? `${index + 1} / ${pulls.length}` : "";
      const stage = overlay.querySelector(".gacha-reveal-stage");
      stage.innerHTML = "";
      stage.appendChild(guildAppBuildRevealCard(info, kind, cfg));
      overlay.querySelector(".gacha-reveal-hint").textContent = index >= pulls.length - 1 ? "タップ／決定キーで、結果一覧へ" : "タップ／決定キーで、次へ";
    };
    api.state = { index: 0, lockUntil: 0 };
    api.render(0);
    api.state.lockUntil = Date.now() + (reduce ? 0 : 350);
  }, (api) => {
    // 決定キー・画面タップ：次の1連へ。カードが現れる最中（約0.35秒）は受け付けない（押しっぱなし・連打で飛ばさないため）
    return () => {
      if (api.isFinished()) return;
      const st = api.state;
      if (!st || Date.now() < st.lockUntil) return;
      if (st.index >= pulls.length - 1) { api.finish(); return; }
      st.index += 1;
      api.render(st.index);
      st.lockUntil = Date.now() + (reduce ? 0 : 350);
    };
  });
}

// 1連ぶんのカードを作る（レア度で色と光が変わる。レア以上は、カードの後ろから光線が放射する。スーパーレアは虹色で輝く）
// 戻り値：光線とカードをまとめた要素（光線をカードの外まで広げるため、カードとは別の要素にしてある）
function guildAppBuildRevealCard(info, kind, cfg) {
  const rarity = (info && (info.rarity === "SR" || info.rarity === "R")) ? info.rarity : "N";
  const type = info ? info.type : "miss";
  const wrap = guildAppEl("div", "gacha-card-wrap");
  if (type !== "miss" && rarity !== "N") wrap.appendChild(guildAppEl("div", `gacha-card-rays gacha-card-rays-${rarity}`));
  const card = guildAppEl("div", `gacha-card gacha-card-${rarity} gacha-card-${type}`);
  wrap.appendChild(card);
  const inner = guildAppEl("div", "gacha-card-inner");
  card.appendChild(inner);

  if (info && info.pityText) inner.appendChild(guildAppEl("div", "gacha-card-pity", info.pityText));

  if (type === "miss") {
    inner.appendChild(guildAppEl("div", "gacha-card-badge", "空振り"));
    inner.appendChild(guildAppEl("div", "gacha-card-miss-text", info && info.text ? info.text : "今回は何も目覚めなかった……"));
    return wrap;
  }

  const entry = gachaEntryById(info.entryId, kind);
  let badgeText = "新たな力！";
  if (type === "up") badgeText = `${info.breakCount}${cfg.breakLabel}${info.isMax ? "（最大）" : ""}`;
  else if (type === "dup") badgeText = `すでに${info.breakCount}${cfg.breakLabel}`;
  inner.appendChild(guildAppEl("div", "gacha-card-badge gacha-card-badge-" + type, badgeText));
  inner.appendChild(guildAppEl("div", "gacha-card-rarity", `★ ${gachaRarityLabel(rarity)}`));

  if (kind === "beast" && typeof beastAvatarElement === "function" && entry) {
    const avatar = guildAppEl("div", "gacha-card-avatar");
    avatar.appendChild(beastAvatarElement(entry, 76));
    inner.appendChild(avatar);
  }

  inner.appendChild(guildAppEl("div", "gacha-card-name", info.name));
  const desc = entry && typeof entry.description === "string" ? entry.description.trim() : "";
  if (desc) inner.appendChild(guildAppEl("div", "gacha-card-desc", (typeof stripRubyNotation === "function") ? stripRubyNotation(desc) : desc));
  if (kind === "skill" && entry) inner.appendChild(guildAppEl("div", "gacha-card-sub", `消費：${gachaCostLabel(entry)}`));

  if (type === "up") {
    inner.appendChild(guildAppEl("div", "gacha-card-note", `${info.breakCount}${cfg.breakLabel}に深まった！`));
  } else if (type === "dup") {
    const parts = [];
    if (info.stones > 0) parts.push(`${gachaStoneLabel()}×${info.stones}`);
    if (info.gold > 0) parts.push(`${info.gold}陳`);
    inner.appendChild(guildAppEl("div", "gacha-card-note", `代わりに${parts.length ? parts.join("と") : "何も"}手に入れた`));
  }
  return wrap;
}
