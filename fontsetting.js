// fontsetting.js
// ===================================================================
// ===== ゲーム内フォントの切り替え（設定タブの「フォント」行） =====
// ===================================================================
// ★「𰻞」など、端末の標準フォントに無い文字を出せるように、font/ フォルダのフォントを同梱している。
// ★フォントの実体は style.css の @font-face で登録してある（GameFontNoto など）。@font-face は「使われた時」にだけ
//   ダウンロードされるので、選ばなかったフォント（スキマゴシックの約20MBなど）は読み込まれない。
// ★選んだフォントは CSS変数 --game-font に入れ、body・ボタン・入力欄まで同じフォントになる（style.css）。
//   Canvas（タワーディフェンス）の文字は CSS変数が使えないので、gameCanvasFontFamily() の文字列を使う。
// ★選んだフォントに無い文字（Hangyaku は約5千字）は、次の候補＝Noto Sans JP、最後に端末標準の順で自動的に補われる。
// ★選択は gameSettings.fontId に入り、設定と一緒に localStorage（demoge_settings）へ保存される（settings.js）。
// ★フォントを増やす時は、font/ にファイルを置き、style.css に @font-face を足し、下の GAME_FONT_OPTIONS に1行足す。

const GAME_FONT_DEFAULT_ID = "noto";

// family＝style.css の @font-face で付けた名前（端末標準は null）／file＝読み込み状況の確認に使うファイル（任意）
const GAME_FONT_OPTIONS = [
  { id: "noto",     label: "Noto Sans JP（標準）", family: "GameFontNoto" },
  { id: "sukima",   label: "スキマゴシック",       family: "GameFontSukima" },
  { id: "hangyaku", label: "叛逆明朝",     family: "GameFontHangyaku" },
  { id: "corporatemincho", label: "コーポレート明朝",       family: "GameFontCorporateMincho" },
  { id: "keifont",        label: "けいふぉんと",           family: "GameFontKeifont" },
  // ★はらませにゃんこは一旦使えないようにしてある（font/ のファイルと style.css の @font-face は残している）。
  //   復活させたい時は、下の2行の「//」を外すだけでよい。保存済みの選択がここに無い時は自動で Noto Sans JP に戻る。
  // { id: "haranyan",       label: "はらませにゃんこ",       family: "GameFontHaranyan" },
  // { id: "haranyanmarumi", label: "はらませにゃんこ まるみ", family: "GameFontHaranyanMarumi" },
  { id: "system",   label: "端末の標準フォント",   family: null }
];

// 選んだフォントに無い文字の補い先（端末標準は、これまで通り sans-serif だけ。𰻞 を出せない端末もある）
const GAME_FONT_FALLBACK_NOTO = '"GameFontNoto", "Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif';
const GAME_FONT_FALLBACK_SYSTEM = "sans-serif";

// 読み込み状況（"loading" / "ready" / "error"）。端末標準は読み込み不要
const gameFontLoadState = {};

function getGameFontOption(id) {
  return GAME_FONT_OPTIONS.find(o => o.id === id) || GAME_FONT_OPTIONS.find(o => o.id === GAME_FONT_DEFAULT_ID);
}

function getCurrentGameFontOption() {
  return getGameFontOption(typeof gameSettings !== "undefined" ? gameSettings.fontId : GAME_FONT_DEFAULT_ID);
}

// font-family に入れる文字列（CSS変数にも、Canvas の ctx.font にもそのまま使える）
function gameFontFamilyStack(option) {
  const opt = option || getCurrentGameFontOption();
  if (!opt.family) return GAME_FONT_FALLBACK_SYSTEM;
  if (opt.id === GAME_FONT_DEFAULT_ID) return GAME_FONT_FALLBACK_NOTO;
  return `"${opt.family}", ${GAME_FONT_FALLBACK_NOTO}`;
}

// Canvas の ctx.font 用（例：ctx.font = `bold 12px ${gameCanvasFontFamily()}`）
function gameCanvasFontFamily() {
  return gameFontFamilyStack();
}

// 選んだフォントを画面に反映する（settings.js の applySettings から呼ばれる）。ダウンロードもここで始める
function applyGameFont() {
  const opt = getCurrentGameFontOption();
  document.documentElement.style.setProperty("--game-font", gameFontFamilyStack(opt));
  if (!opt.family || gameFontLoadState[opt.id] === "ready" || gameFontLoadState[opt.id] === "loading") return;
  if (!document.fonts || typeof document.fonts.load !== "function") return;   // 古いブラウザは、使われた時に自動で読み込まれる
  gameFontLoadState[opt.id] = "loading";
  // 「𰻞」を含む文字で読み込み、ファイルが壊れている／無い場合は error になる
  document.fonts.load(`16px "${opt.family}"`, "𰻞あ漢").then(faces => {
    gameFontLoadState[opt.id] = faces && faces.length > 0 ? "ready" : "error";
  }).catch(() => {
    gameFontLoadState[opt.id] = "error";
  }).then(() => {
    // 設定タブを開いている時は、表示（読み込み中…→完了）を更新する
    const tab = document.getElementById("tab-setting");
    if (tab && tab.classList.contains("active") && typeof renderSettingsTab === "function") renderSettingsTab();
  });
}

// 設定タブに出す文言
function gameFontSettingValueText() {
  const opt = getCurrentGameFontOption();
  const state = opt.family ? gameFontLoadState[opt.id] : null;
  if (state === "loading") return `${opt.label}（読み込み中…）`;
  if (state === "error") return `${opt.label}（読み込めませんでした）`;
  return opt.label;
}

// ◀▶で順番に切り替える（wrap が true の時だけ、端まで行ったら反対側に戻る。決定／タップ用）
function changeGameFont(direction, wrap) {
  const ids = GAME_FONT_OPTIONS.map(o => o.id);
  let idx = ids.indexOf(getCurrentGameFontOption().id);
  idx += direction;
  idx = wrap ? (idx + ids.length) % ids.length : Math.max(0, Math.min(ids.length - 1, idx));
  gameSettings.fontId = ids[idx];
  applyGameFont();
  saveSettings();   // settings.js
  renderSettingsTab();
}
