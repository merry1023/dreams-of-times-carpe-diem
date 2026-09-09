// HTMLの準備ができたら自動的に実行される
document.addEventListener('DOMContentLoaded', async () => {
  loadSettings(); // settings.js（文字送り速度・ログ記憶件数・オートセーブ設定を反映）
  // ★話・キャラ／ゲームの基本設定の書き出しファイルが、今ブラウザに保存されているデータと
  //   異なるバージョンだった場合、新旧を問わず「読み込みますか？」の確認を挟む（scenariobuild.js）。
  //   ここで読み込むと決めた内容は、この後のloadCustomScenarioData()（setupTitleScreen等から呼ばれる）
  //   で使われる
  if (typeof loadCustomScenarioData === "function") loadCustomScenarioData(); // ★確認の判定に使うSCENARIOBUILD_LAST_EDITED_KEY等を最新化しておく
  if (typeof checkDataFileVersionAndConfirm === "function") await checkDataFileVersionAndConfirm(); // scenariobuild.js
  // ★要望対応：本体JSファイルが更新されていた場合の確認（開発者アカウントのみ、はい/いいえ。それ以外は自動で最新を反映）
  if (typeof checkAppJsVersionAndConfirm === "function") await checkAppJsVersionAndConfirm(); // auth.js
  setupTitleScreen(); // titlescreen.js（「はじめから」「つづきから」の選択を待つ。ゲーム本編はまだ始めない）
});

// ★タイトル画面の「はじめから」から呼ばれる、実際にゲームを開始する処理
async function startNewGame() {
  // ★話のクリア状況（scenarioProject.chapters[].cleared）は、セーブデータではなく
  //   シナリオエディタと共有のデータに乗っているため、はじめから始める時は必ずリセットしておく。
  //   これをしないと、前のプレイで進めた話が新しいプレイでも最初からクリア済み扱いになってしまう
  if (typeof loadCustomScenarioData === "function") loadCustomScenarioData(); // scenariobuild.js
  if (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.chapters)) {
    scenarioProject.chapters.forEach(c => { c.cleared = false; c.started = false; });
    if (typeof saveCustomScenarioData === "function") saveCustomScenarioData();
  }
  
  // ★テスト用の初期アイテムをいくつか持たせておく
  addItem("herb_001", 3); // 薬草 x3
  addItem("potion_001", 2); // ポーション x2
  addItem("weapon_002", 1); // 鉄の剣 x1
  addItem("material_001", 1); // ゴブリンの牙 x1
  
  // ★シナリオビルドで第一話にブロックが追加されていれば、そちらを優先して本編として実行する
  const overridden = typeof tryRunBuiltinChapterOverride === "function" && await tryRunBuiltinChapterOverride("builtin_chapter1");
  if (overridden) return;
  
  // ★ブロックが1つも無く、元のscenario.jsをそのまま使う場合も、目標表示のON/OFF判定用に
  //   「始まった」ことを記録しておく（tryRunBuiltinChapterOverride側は内部で記録済み）
  if (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.chapters)) {
    const chapter1Entry = scenarioProject.chapters.find(c => c.id === "builtin_chapter1");
    if (chapter1Entry) { chapter1Entry.started = true; if (typeof saveCustomScenarioData === "function") saveCustomScenarioData(); }
  }
  
  startScene(); // ここで最初の関数を呼び出す！（職業選択後にrenderStatusHUD()が呼ばれる）
}