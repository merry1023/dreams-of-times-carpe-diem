// memoryHall.js
// ===================================================================
// ===== 追憶の館（要望対応：クリア済みの話を再体験できる施設） =====
// ===================================================================
// ★施設編集タブで作れる「追憶の館」タイプの施設（facility.type === "memoryHall"）の中身。
//   openCustomFacility（town.js）から openMemoryHallFacility() が呼ばれる。
// ★「あくまで再体験だけ」の要望通り、再体験の間に起きたこと（戦闘の経験値・入手アイテム・
//   所持金の増減・フラグ/変数の変化・図鑑登録・好感度の変化など）は、再体験が終わったら
//   全て元の状態に巻き戻す。やり方としては、再体験の直前に主要なゲーム状態をまるごと
//   コピーしておき、再体験後にそのコピーで丸ごと上書きする（スナップショット方式）。
//   これにより、話ブロック側（scenariobuild.jsのrunSingleScenarioBlock等）を
//   1つ1つ「これは再体験中だから付与しない」と個別対応する必要が無く、実装の漏れも防げる

let memoryHallFacility = null; // 今開いている追憶の館のデータ
let memoryHallReturnTo = null; // 「戻る」で呼ぶ関数

// 追憶の館の入り口。openCustomFacility（town.js）から呼ばれる
function openMemoryHallFacility(facility, returnTo) {
  memoryHallFacility = facility;
  memoryHallReturnTo = typeof returnTo === "function" ? returnTo : openTownMenu;
  showMemoryHallMenu();
}

async function showMemoryHallMenu() {
  const clearedChapters = (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.chapters))
    ? scenarioProject.chapters.filter(c => c.cleared)
    : [];
  
  if (clearedChapters.length === 0) {
    hideLocationMenu();
    changeSpeaker("");
    await displayMessage("……まだ再体験できる話が無いようだ。話をクリアすると、ここで選べるようになる。");
    memoryHallReturnTo();
    return;
  }
  
  const options = clearedChapters.map(chapter => ({
    label: chapter.title || "（無題の話）",
    action: () => confirmAndReplayChapter(chapter)
  }));
  options.push({ label: "戻る", action: () => memoryHallReturnTo() });
  
  showLocationMenu(options, memoryHallFacility.name || "追憶の館");
}

async function confirmAndReplayChapter(chapter) {
  hideLocationMenu();
  changeSpeaker("");
  const ok = await showGameConfirm(`「${chapter.title || "（無題の話）"}」を再体験しますか？（戦闘の経験値やアイテムの入手など、この中で起きたことは終わったら全て元通りになります）`);
  if (!ok) {
    showMemoryHallMenu();
    return;
  }
  await runMemoryHallReplay(chapter);
  showMemoryHallMenu();
}

// JSONを介したシンプルなディープコピー（deepClone、convenience.js と同じ考え方。
//   ここで扱う値は全てプレーンなデータなので問題ない）
function memoryHallDeepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function runMemoryHallReplay(chapter) {
  // ★再体験の直前に、巻き戻したい主要なゲーム状態をまるごとスナップショットしておく
  const snapshot = {
    player: memoryHallDeepClone(player), // player.js（レベル・経験値・所持スキル・状態異常・仲間など全部含む）
    inventorySlots: memoryHallDeepClone(inventorySlots), // inventory.js
    gold: gold, // inventory.js
    scenarioFlags: memoryHallDeepClone(scenarioFlags), // scenariobuild.js
    scenarioVariables: memoryHallDeepClone(scenarioVariables), // scenariobuild.js
    discoveredMonsters: memoryHallDeepClone(discoveredMonsters), // battle.js（魔物図鑑）
    monsterAffection: memoryHallDeepClone(monsterAffection), // battle.js（好感度）
    activeQuest: (typeof activeQuest !== "undefined" && activeQuest) ? memoryHallDeepClone(activeQuest) : null // questboard.js
  };
  
  changeSpeaker("");
  await displayMessage(`（追憶の館：「${chapter.title || "（無題の話）"}」を再体験しています……）`);
  
  // ★scenariobuild.jsのisScenarioTestPlayフラグを流用する。これがtrueの間は、
  //   エンディング／話クリアブロックに到達しても「本当にクリアした」ことにはならず、
  //   実績チェックや自動セーブも走らない（このシナリオエディタのテストプレイと全く同じ仕組み）
  isScenarioTestPlay = true;
  try {
    await runBlockSequence(chapter, chapter.blocks, []); // scenariobuild.js
  } catch (e) {
    console.warn("追憶の館での再体験中にエラーが発生しました", e);
  } finally {
    isScenarioTestPlay = false;
    
    // ★再体験中に何が起きていても関係なく、スナップショットの状態にまるごと巻き戻す
    player = snapshot.player; // player.js
    inventorySlots = snapshot.inventorySlots; // inventory.js
    gold = snapshot.gold; // inventory.js
    scenarioFlags = snapshot.scenarioFlags; // scenariobuild.js
    scenarioVariables = snapshot.scenarioVariables; // scenariobuild.js
    discoveredMonsters = snapshot.discoveredMonsters; // battle.js
    monsterAffection = snapshot.monsterAffection; // battle.js
    if (typeof activeQuest !== "undefined") activeQuest = snapshot.activeQuest; // questboard.js
    
    // ★フラグ/変数はlocalStorageにも自動保存される仕組みなので、そちらも元に戻しておく
    if (typeof saveScenarioFlags === "function") saveScenarioFlags(); // scenariobuild.js
    if (typeof saveScenarioVariables === "function") saveScenarioVariables(); // scenariobuild.js
    
    renderStatusHUD(); // mainfunc.js
  }
  
  changeSpeaker("");
  await displayMessage("（再体験終了。元の状態に戻りました）");
}
