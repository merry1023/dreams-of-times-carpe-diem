// scenariobuild.js
// 開発者モードから入れる「シナリオビルド」モード。
// ・話の一覧／作成／削除／並び替え、開始条件（第N話クリア、固定値）
// ・話の中身をブロックで組み立てるエディタ（会話・地の文・BGM・戦闘・選択肢）＋テストプレイ
// ・サブ画面：キャラ管理／敵設定／ボス設定／アイテム設定／データ管理（JSON書き出し・読み込み）
//
// ★サブ画面で作った「カスタムの敵・ボス」は、実際にテストプレイで使えるように、
//   MONSTER_MASTER（battle.js）へその場で登録してから戦闘を始める（ensureCustomMonstersRegistered）。
//
// ★開始条件の考え方：条件は「第N話をクリアしていること」という数値をそのまま固定で保持する
//   （requiredChapterNumber）。話を並び替えても、この数値は一切変わらない。

const SCENARIOBUILD_SAVE_KEY = "demoge_custom_scenarios_v3";
const SCENARIOBUILD_SAVE_KEY_LEGACY = "demoge_custom_scenarios_v2"; // ★旧バージョン（話一覧のみ）からの移行用

// ★player.jsのCLASS_SKILLSは、スキル管理タブでカスタム技を追加すると ensureCustomSkillsRegistered() が
//   丸ごと組み直してしまう（カスタム技もCLASS_SKILLSに混ざる）。そのため、後から「本来の組み込み技」だけを
//   見分けたい時に、既に上書きされたCLASS_SKILLSを見ても区別できなくなってしまっていた
//   （＝カスタム技を追加すると、それが「まだ登録されていない組み込み技」と誤認され、二重に追加され続けるバグの原因）。
//   スクリプト読み込み直後、まだ何も上書きされていない状態のCLASS_SKILLSをここで複製して保存しておく
const ORIGINAL_CLASS_SKILLS = (typeof CLASS_SKILLS !== "undefined") ? JSON.parse(JSON.stringify(CLASS_SKILLS)) : {};
// ★組み込みの7職業（player.js）のスナップショット。職業削除機能で、組み込み職業を消した場合の
//   「削除済みID」判定に使う（これが無いと、ページを再読み込みするたびにplayer.js側の定義から復活してしまう）
const ORIGINAL_CLASS_MASTER_KEYS = (typeof CLASS_MASTER !== "undefined") ? Object.keys(CLASS_MASTER) : [];

let scenarioProject = {
  chapters: [],   // [{ id, title, cleared, builtin, requiredChapterNumber, requiredRank, requiredProgress, requiredDays, requiredFlag, blocks: [...] }, ...]
  characters: [], // [{ id, name, note, builtin }, ...]
  enemies: [],    // [{ id, name, maxHp, atk, exp, level }, ...] ★levelを設定すると、そのエリアではプレイヤーLvに関わらず固定の強さで出る
  bosses: [],     // [{ id, name, maxHp, atk, exp, level, bgmTrack, bgmFinalTrack, bgmCrisisTrack, invincibilityItemId }, ...]
  items: [],      // [{ id, name, category, description, rank, listedPrice, trueValue }, ...]
  skills: [],     // [{ id, className, skillId, name, description, type, element, spCost, unlockLevel, power, target, hitCount, statusEffectKind... }, ...]
                  // ★将来的に「特殊スキル編集」ボタンから、話のブロックエディタと同じ要領で技の動作を
                  //   ブロックで組めるようにする予定。その時はここに blocks:[...] を追加する想定
                  //  （JSファイル出力・取り込みは中身をそのままJSONで扱うので、フィールドが増えても対応不要）
  companions: [], // [{ id, name, description, class, initialWeaponId, baseStats:{...}, growthPerLevel:{...}, builtin }, ...]
  quests: [],     // [{ id, rank, title, description, type:"hunt"|"gather", targetMonsterKey, targetItemId, targetCount, rewardGold, rewardExp, rewardItemId, rewardItemQty, builtin }, ...] ★酒場のクエスト管理タブ
  achievements: [], // [{ id, name, description, hidden, conditionType, conditionValue, classId, monsterKey, areaId, flagName, varName, rewardExp, rewardGold, rewardItemId, rewardItemQty }, ...] ★実績管理タブ（要望対応）
  tutorials: [],  // [{ id, category, title, body }, ...] ★便利タブの「チュートリアル」アイコンから見られる、カテゴリ分けされたヘルプ項目
  classStats: {}, // { 職業名: { description, type:"normal"|"advanced"|"master", unlockFlagName, baseStats:{...}, maxSleepiness, maxFatigue, growthPerLevel:{...} }, ... } ★主人公の職業のステータス編集用（追加・削除可能）
  facilities: [], // [{ id, type:"inn"|"townhall"|"flavor", name, bgTrack, bgImage, ownerDialogue, price, sleepinessRecovery, fatigueRecovery, classChangeCost, allowedClassNames }, ...] ★村の「酒場/宿屋/店/冒険する」に追加できる施設
  bgmTracks: [],  // [{ id, name, path }, ...] ★名前とファイルパスを登録しておくと、曲名として選べるようになる
  mapAreas: [],   // [{ id, name, type, x, y, bgTrack, bgImage, bossId, enemyIds, items, examineMessages(配列。「調べる」で毎回ランダムに1つ選ぶ), battleVariations, builtin, locationKey }, ...]
  mapEdges: [],   // [[fromNodeId, toNodeId], ...] ★マップ画面でのエリア同士のつながり（村="village"、組み込みは"cave"等、自作エリアは"custom_"+id）
  loginBonusDays: [], // ★要望対応：ログインボーナス。7日分の配列 [{ gold, exp, items:[{itemId, qty}, ...] }, ...]（1日目〜7日目）
  companionChatSettings: { // ★要望対応：仲間との会話（Gemini API連携）の「会話AI設定」タブで編集する情報
    partyName: "",              // パーティ名
    protagonistEpithet: "",     // 主人公の二つ名
    protagonistPersonality: "", // 主人公の性格・口調の指針（会話AIが参考にする）
    companions: {}               // { [仲間のid]: { epithet: "", personality: "" }, ... }
  },
  scenarioBuildTabVisibility: {},
  // ★組み込み（builtin）のデータを削除した時、次回読み込み時に自動で復活してしまわないように記録しておく置き場所。
  //   「編集・削除できない」問題の多くは、実は削除できていたのに毎回ここでの記録が無く復活していたことが原因だった
  deletedBuiltinIds: { chapters: [], characters: [], enemies: [], bosses: [], items: [], bgmTracks: [], mapAreas: [], skills: [], companions: [] }
};

let scenarioBuildMainView = "list"; // "list" | "editor" | "maps" | "mapEditor" | "statuses" ★左（メイン）側
let scenarioBuildSubView = "characters"; // ★右（サブ）側。常時表示なので独立して切り替わる
let scenarioBuildEditingChapterId = null;
let scenarioBuildEditingMapAreaId = null; // ★マップ設定の専用全画面エディタで、今どのエリアを編集中か
let scenarioBuildEditingOptionRef = null; // ★選択肢の専用全画面エディタで、今どの選択肢を編集中か（{ chapterId, blockId, optionId }）
let scenarioBuildEditingIfRef = null; // ★ifブロックの専用全画面エディタで、今どのブロックを編集中か（{ chapterId, blockId }）
let scenarioBuildEditingSkillIfBlockId = null; // ★特殊技のifブロック専用全画面エディタで、今編集中のブロックid（対象の技はscenarioBuildEditingSkillIdから分かる）
let scenarioBuildEditingSkillIfBranch = null; // ★特殊技ifブロックの中身エディタで、今"true"/"false"のどちらの中身を編集中か
let scenarioBuildEditingEnemyFlavorRef = null; // ★見逃した/倒した時の演出専用全画面エディタで、今どの敵の何を編集中か（{ entityId, key, label }）
let scenarioBuildEditingBossEventRef = null; // ★要望対応：ボスの戦闘イベント（演出ブロック）専用全画面エディタで、今どのボスのどのイベントを編集中か（{ bossId, eventId }）
let scenarioBuildEditingBossFormRef = null; // ★要望対応：ボスの「形態」一覧の専用全画面エディタで、今どのボスを編集中か（{ bossId }）
let scenarioBuildInsertMenuIndex = null; // ★ブロック挿入用の「＋」を今どの位置で開いているか（nullなら閉じている）
let scenarioBuildEditingStatusRef = null; // ★状態管理の専用全画面エディタで、今どの状態異常/状態強化を編集中か（{ category: "statusAilments"|"statusBuffs", id }）
let scenarioBuildEditingSkillId = null; // ★特殊スキル編集（ブロック）の専用全画面エディタで、今どの技を編集中か
// ★バグ修正：この変数がどこにも宣言されておらず、特殊スキル編集を開いた瞬間に
//   buildSkillBlockInsertSlot内の読み取りでReferenceErrorが発生し、ブロック一覧と「＋」ボタンが
//   一切描画されなくなっていた（データ自体は保存されていても表示側で毎回落ちていた）
let scenarioBuildSkillInsertMenuTarget = null; // ★特殊スキルのブロック挿入用「＋」を今どの位置で開いているか（nullなら閉じている）
let scenarioBuildEditingItemSkillId = null; // ★武器・防具の「スキル編集」の専用全画面エディタで、今どのアイテムを編集中か（特殊スキル編集の画面をそのまま使い回す）
// ★潜在バグ予防：以前はどこにも宣言されないまま使われていた（代入が先に必ず起きるため実害は出ていなかったが、
//   特殊スキル編集の未宣言変数と同じ種類の危険なパターンだったため、ここで正式に宣言しておく）
let scenarioBuildEditingEntityRef = null; // ★敵/ボス/アイテムの詳細編集の専用全画面エディタで、今何を編集中か（{ category, id }）

// ★要望対応：話一覧の「テストプレイ用：クリア済み扱いにする」チェックは、実際のクリア状況
//   （chapter.cleared。エンディング/話クリアブロックの通過で本当にtrueになり、保存もされる）とは
//   完全に切り離した「今開いているだけの一時的な上書き」として持つ。scenarioProject本体には一切含めず、
//   ページの再読み込みやシナリオビルドの保存（💾）をしても絶対に残らない（＝保存されない）ようにする
let scenarioTestClearedChapterIds = new Set();
// ★バグ修正（要望対応）：chapter.cleared が本当にtrue（以前のテストプレイ漏れ等で実際にクリア済みに
//   なってしまっている話も含む）の場合、上のSetから外すだけではチェックを外せなかった
//   （isChapterEffectivelyClearedがchapter.clearedの方でtrueを返し続けるため）。
//   「本当はクリア済みだが、テストプレイ用に一時的に未クリア扱いで見たい」場合の上書きを別に持つことで、
//   実際のchapter.clearedには一切触れずに、チェックを確実にON/OFFできるようにする
let scenarioTestUnclearedChapterIds = new Set();
// ★話の開始条件などを判定する箇所は、実際にクリア済みか／テストプレイ用に一時的にクリア済み扱いにしているかを
//   区別せず「どちらか」で判定したいので、判定側は基本的に chapter.cleared を直接見ず、ここを通す
function isChapterEffectivelyCleared(chapter) {
  if (!chapter) return false;
  if (scenarioTestUnclearedChapterIds.has(chapter.id)) return false; // ★テストプレイ用「未クリア扱い」の上書きを最優先
  return !!(chapter.cleared || scenarioTestClearedChapterIds.has(chapter.id));
}

// ===== データの読み書き（自動保存） =====
// ★JSファイルとして書き出した「シナリオのみ」「ゲームの基本設定のみ」データを、
//   ブラウザ保存データより優先して取り込んだかどうかの記録（バージョン＝書き出した時刻）
const SCENARIOBUILD_SCENARIO_FILE_VERSION_KEY = "demoge_scenario_file_applied_version";
const SCENARIOBUILD_SETTINGS_FILE_VERSION_KEY = "demoge_settings_file_applied_version";
// ★ブラウザ側（localStorage）に今のscenarioProjectを最後に保存した日時。書き出しファイル（.js）の
//   バージョン（＝書き出した日時）と比較して、「実際にどちらが新しいか」を判定するために使う
const SCENARIOBUILD_LAST_EDITED_KEY = "demoge_scenario_last_edited_at";

function loadCustomScenarioData() {
  try {
    const raw = localStorage.getItem(SCENARIOBUILD_SAVE_KEY);
    if (raw) {
      scenarioProject = JSON.parse(raw);
    } else {
      // ★旧バージョン（話一覧だけの配列）が残っていれば、そのまま話一覧として引き継ぐ
      const legacyRaw = localStorage.getItem(SCENARIOBUILD_SAVE_KEY_LEGACY);
      scenarioProject = { chapters: legacyRaw ? JSON.parse(legacyRaw) : [], characters: [], enemies: [], bosses: [], items: [], skills: [], companions: [], bgmTracks: [], mapAreas: [] };
    }
  } catch (e) {
    console.error("シナリオビルドデータの読み込みに失敗しました", e);
    scenarioProject = { chapters: [], characters: [], enemies: [], bosses: [], items: [], skills: [], companions: [], bgmTracks: [], mapAreas: [] };
  }
  // ★以前はここから下を無防備に呼んでいたため、保存データのどこか1箇所でも想定外の形（古いバージョンの名残り等）に
  //   なっていると、途中の関数が例外を投げてloadCustomScenarioData自体が止まってしまっていた。
  //   このデータ管理データはシナリオビルドを開く時だけでなく、町・冒険画面などゲーム中の随所からも毎回呼ばれているため、
  //   1箇所のエラーが「シナリオエディタがボタンを押しても開かない」「特定の画面が真っ白になる」等の
  //   広範囲の不具合として現れてしまっていた。1ステップずつ独立してtry/catchし、
  //   どこかが失敗しても残りは実行を続け、必ず最後まで（＝エディタを開く処理まで）たどり着けるようにする
  runScenarioBuildStepSafely("normalizeScenarioProject", normalizeScenarioProject);
  runScenarioBuildStepSafely("applyImportedScenarioFileIfUpdated", applyImportedScenarioFileIfUpdated);
  runScenarioBuildStepSafely("applyImportedSettingsFileIfUpdated", applyImportedSettingsFileIfUpdated);
  runScenarioBuildStepSafely("ensureCustomMonstersRegistered", ensureCustomMonstersRegistered);
  runScenarioBuildStepSafely("ensureCustomBgmRegistered", ensureCustomBgmRegistered);
  runScenarioBuildStepSafely("ensureCustomItemsRegistered", ensureCustomItemsRegistered); // ★アイテム設定で追加・編集したアイテムを念のため最新の状態にしてから使う
  // ★バグ修正：魚管理タブで追加した魚（scenarioProject.fishItems）が、ここ（loadCustomScenarioData）から
  //   一切ITEM_MASTERへ登録されていなかった。ensureCustomFishRegistered自体は存在し、シナリオビルド画面の
  //   undo/redoからは呼ばれていたが、通常のゲーム進行中（町・釣り場を開く時など）に呼ばれるのはこの関数だけのため、
  //   ITEM_MASTER[spot.fishId]が常にundefinedになり、getMatchingFishSpots（fishing.js）の候補が毎回0件になって
  //   「今はこの餌に反応する魚がいないようだ……」としか出ず、エラーも出ないまま釣りが一切成立しない不具合の原因だった
  runScenarioBuildStepSafely("ensureCustomFishRegistered", ensureCustomFishRegistered); // ★魚管理で追加・編集した魚を念のため最新の状態にしてから使う
  runScenarioBuildStepSafely("ensureCustomSkillsRegistered", ensureCustomSkillsRegistered); // ★スキル管理で追加・編集した技を念のため最新の状態にしてから使う
  runScenarioBuildStepSafely("ensureCustomCompanionsRegistered", ensureCustomCompanionsRegistered); // ★仲間編集で追加・編集した仲間を念のため最新の状態にしてから使う
  runScenarioBuildStepSafely("ensureCustomClassStatsRegistered", ensureCustomClassStatsRegistered); // ★職業編集で編集した主人公の職業ステータスを念のため最新の状態にしてから使う
  runScenarioBuildStepSafely("ensureCustomFameThresholdsRegistered", ensureCustomFameThresholdsRegistered); // ★ランクアップに必要な名声度の指定を反映
  // ★バグ修正：クエスト管理タブで追加した依頼だけ、この起動時の再登録リストに入っておらず、
  //   ページ再読み込みや日付更新（resetDailyQuestBoardによるQUEST_BOARD_MASTERからの再構築）の
  //   タイミングでQUEST_BOARD_MASTERに反映されず、酒場の掲示板から消えてしまうバグがあった
  runScenarioBuildStepSafely("ensureCustomQuestsRegistered", ensureCustomQuestsRegistered);
  if (typeof applyBuiltinMapAreaOverrides === "function") runScenarioBuildStepSafely("applyBuiltinMapAreaOverrides", applyBuiltinMapAreaOverrides); // adventure.js（マップ設定タブでの編集内容を反映）
  runScenarioBuildStepSafely("loadScenarioFlags", loadScenarioFlags);
  runScenarioBuildStepSafely("loadScenarioVariables", loadScenarioVariables);
}

// ★loadCustomScenarioDataの各ステップを1つずつ安全に実行する。失敗しても他のステップやこの関数の
//   呼び出し元（＝シナリオエディタを開く処理そのもの）を止めないためのヘルパー
function runScenarioBuildStepSafely(stepName, fn) {
  try {
    fn();
  } catch (e) {
    console.error("シナリオビルドデータの初期化中にエラーが発生しました（" + stepName + "）。この項目は今回反映されていない可能性があります。", e);
  }
}

// ★「シナリオのみ」書き出しファイル（scenario_only_data.js）が読み込まれていて、まだ取り込んでいない
//   バージョンなら、話・キャラだけをそちらの内容で上書きする。それ以外（アイテムや技など）はそのまま。
//   一度取り込んだバージョンは記録しておき、次に新しいファイルを書き出して差し替えるまでは
//   ブラウザ側での編集をそのまま尊重する（毎回上書きされて編集内容が消えるのを防ぐ）
// ★「話・キャラのみ」書き出しファイル（scenario_only_data.js）を取り込む。
//   以前はここの判定が「このバージョン文字列をまだ取り込んでいないか」だけを見ていたため、
//   書き出しファイルの方が実は古い（＝ブラウザ側で既にそれより新しく編集済み）場合でも
//   問答無用で上書きしてしまい、ブラウザ側の新しい編集内容が消えてしまう不具合があった。
//   ★さらにその後は「書き出しファイルの方が新しい時だけ、確認なしで自動的に」取り込む形にしていたが、
//   ユーザーが意図せず古いファイルや別環境のファイルを開いてしまった時に、無言でデータが入れ替わって
//   しまうのは危険なため、new/oldを問わず「ブラウザに保存されている状態と異なるバージョンを検知したら、
//   必ず確認ダイアログを挟む」方式に変更した（実際の確認・強制取り込みはcheckDataFileVersionAndConfirm、
//   titlescreen.js側の起動時チェックから呼ばれる）。forceがtrueの時だけ、バージョンの新旧を問わず取り込む。
//   ブラウザに何もデータが無い最初の起動時（lastEditedAt===0）は、確認なしでそのまま取り込む
function applyImportedScenarioFileIfUpdated(force) {
  if (typeof window === "undefined") return;
  const data = window.SCENARIOBUILD_IMPORTED_SCENARIO_DATA;
  if (!data || data.version == null) return;
  const lastEditedAt = Number(localStorage.getItem(SCENARIOBUILD_LAST_EDITED_KEY)) || 0;
  if (!force) {
    if (lastEditedAt) return; // ★ブラウザに既にデータがある場合は、確認ダイアログ側（force呼び出し）に任せる
    if (Number(data.version) <= lastEditedAt) return;
  }
  
  scenarioProject.chapters = data.chapters || [];
  scenarioProject.chapterArcs = Array.isArray(data.chapterArcs) ? data.chapterArcs : []; // ★要望対応：話管理の章タブ分け用の章一覧
  scenarioProject.characters = data.characters || [];
  if (Array.isArray(data.flagDefs)) scenarioProject.flagDefs = data.flagDefs; // ★フラグは話の中でしか使わないため、シナリオ側のファイルに含める
  if (Array.isArray(data.variableDefs)) scenarioProject.variableDefs = data.variableDefs; // ★ゲーム変数の定義も同様にシナリオ側のファイルに含める
  if (!scenarioProject.deletedBuiltinIds) scenarioProject.deletedBuiltinIds = {};
  if (data.deletedBuiltinIds) {
    scenarioProject.deletedBuiltinIds.chapters = data.deletedBuiltinIds.chapters || [];
    scenarioProject.deletedBuiltinIds.characters = data.deletedBuiltinIds.characters || [];
  }
  localStorage.setItem(SCENARIOBUILD_SCENARIO_FILE_VERSION_KEY, String(data.version));
  // ★以前はここでsaveCustomScenarioData()を呼んで、取り込んだ瞬間にブラウザへ保存していたが、
  //   そうすると（何も編集していなくても）ページを開いただけでSCENARIOBUILD_LAST_EDITED_KEYが
  //   「今」に更新されてしまい、次に新しいJSファイルに差し替えても「ブラウザの方が新しい」と
  //   誤判定されて取り込まれなくなる不具合の原因になっていた。ここでは保存せず、メモリ上に
  //   反映するだけに留める（実際にブラウザへ残したい時は、これまで通り💾保存ボタンを押した時だけ保存される）
}

// ★「ゲームの基本設定のみ」書き出しファイル（game_settings_data.js）版。考え方は上と同じで、
//   対象は敵・ボス・アイテム・技・仲間・職業ステータス・施設・BGM・マップ
function applyImportedSettingsFileIfUpdated(force) {
  if (typeof window === "undefined") return;
  const data = window.SCENARIOBUILD_IMPORTED_SETTINGS_DATA;
  if (!data || data.version == null) return;
  const lastEditedAt = Number(localStorage.getItem(SCENARIOBUILD_LAST_EDITED_KEY)) || 0;
  if (!force) {
    if (lastEditedAt) return; // ★ブラウザに既にデータがある場合は、確認ダイアログ側（force呼び出し）に任せる
    if (Number(data.version) <= lastEditedAt) return;
  }
  
  scenarioProject.enemies = data.enemies || [];
  scenarioProject.bosses = data.bosses || [];
  scenarioProject.items = data.items || [];
  scenarioProject.fishItems = data.fishItems || []; // ★要望対応：魚管理タブ
  scenarioProject.skills = data.skills || [];
  dedupeBuiltinSkillEntries(); // ★取り込んだファイル自体が、過去のバージョンの不具合で重複を含んでいる場合があるので、取り込み直後にも掃除しておく
  // ★旧バージョンで書き出された設定ファイル（状態管理タブが存在しなかった頃のもの）を読み込んだ時は、
  //   統一異常・状態強化のデータが無いので、直前にnormalizeScenarioProjectが用意した組み込み定義を残す
  if (Array.isArray(data.statusAilments) && data.statusAilments.length > 0) scenarioProject.statusAilments = data.statusAilments;
  if (Array.isArray(data.statusBuffs) && data.statusBuffs.length > 0) scenarioProject.statusBuffs = data.statusBuffs;
  scenarioProject.companions = data.companions || [];
  scenarioProject.quests = data.quests || [];
  ensureCustomQuestsRegistered();
  scenarioProject.achievements = data.achievements || []; // ★実績管理タブ（要望対応）
  scenarioProject.tutorials = data.tutorials || [];
  scenarioProject.classStats = data.classStats || {};
  scenarioProject.facilities = data.facilities || [];
  scenarioProject.portraitCharacters = data.portraitCharacters || [];
  scenarioProject.recipes = data.recipes || [];
  if (Array.isArray(data.randomNamePool)) scenarioProject.randomNamePool = data.randomNamePool; // ★要望対応：ランダム名前管理タブ
  if (Array.isArray(data.elementDefs)) scenarioProject.elementDefs = data.elementDefs; // ★要望対応：属性管理タブ
  if (data.elementMatchups && typeof data.elementMatchups === "object") scenarioProject.elementMatchups = data.elementMatchups;
  scenarioProject.bgmTracks = data.bgmTracks || [];
  scenarioProject.mapAreas = data.mapAreas || [];
  scenarioProject.mapEdges = data.mapEdges || [];
  scenarioProject.trialGuardianOverrides = data.trialGuardianOverrides || {};
  scenarioProject.fameThresholds = data.fameThresholds || {};
  if (Array.isArray(data.loginBonusDays)) scenarioProject.loginBonusDays = data.loginBonusDays; // ★要望対応：ログインボーナス
  if (data.companionChatSettings && typeof data.companionChatSettings === "object") scenarioProject.companionChatSettings = data.companionChatSettings; // ★要望対応：会話AI設定
  if (typeof data.creditsText === "string") scenarioProject.creditsText = data.creditsText; // ★書き出し側に合わせてクレジットの文面も取り込む
  if (typeof data.introText === "string") scenarioProject.introText = data.introText; // ★オープニングの注意書きも同様に取り込む
  if (!scenarioProject.deletedBuiltinIds) scenarioProject.deletedBuiltinIds = {};
  if (data.deletedBuiltinIds) {
    ["enemies", "bosses", "items", "bgmTracks", "mapAreas", "skills", "companions", "quests", "classes"].forEach(key => {
      scenarioProject.deletedBuiltinIds[key] = data.deletedBuiltinIds[key] || [];
    });
  }
  localStorage.setItem(SCENARIOBUILD_SETTINGS_FILE_VERSION_KEY, String(data.version));
  // ★上のapplyImportedScenarioFileIfUpdatedと同じ理由で、ここでの自動保存もやめた
}

// ★new/oldを問わず、データファイルのバージョンがブラウザの保存データと異なる場合に確認ダイアログを出す。
//   起動時（タイトル画面表示前）に一度だけ呼ぶ想定。同じバージョンについて一度「読み込まない」を選んだら、
//   同じファイルのままでは毎回は聞き直さない（decidedバージョンとして記録する）
const SCENARIOBUILD_SCENARIO_DECIDED_VERSION_KEY = "demoge_scenario_file_decided_version";
const SCENARIOBUILD_SETTINGS_DECIDED_VERSION_KEY = "demoge_settings_file_decided_version";
async function checkDataFileVersionAndConfirm() {
  await checkOneDataFileVersionAndConfirm(
    (typeof window !== "undefined") ? window.SCENARIOBUILD_IMPORTED_SCENARIO_DATA : null,
    SCENARIOBUILD_SCENARIO_DECIDED_VERSION_KEY, "話・キャラクターのデータファイル",
    () => applyImportedScenarioFileIfUpdated(true)
  );
  await checkOneDataFileVersionAndConfirm(
    (typeof window !== "undefined") ? window.SCENARIOBUILD_IMPORTED_SETTINGS_DATA : null,
    SCENARIOBUILD_SETTINGS_DECIDED_VERSION_KEY, "ゲームの基本設定（敵・ボス・アイテム・技等）のデータファイル",
    () => applyImportedSettingsFileIfUpdated(true)
  );
}
async function checkOneDataFileVersionAndConfirm(data, decidedKey, label, forceApplyFn) {
  if (!data || data.version == null) return;
  const lastEditedAt = Number(localStorage.getItem(SCENARIOBUILD_LAST_EDITED_KEY)) || 0;
  if (!lastEditedAt) return; // ★ブラウザに何もデータが無い最初の起動時は、確認なしでそのまま取り込む（apply関数側で処理済み）
  if (Number(data.version) === lastEditedAt) return; // ★既に一致している（同じ内容）なら確認不要
  if (localStorage.getItem(decidedKey) === String(data.version)) return; // ★このバージョンについては既に確認済み
  
  const isNewer = Number(data.version) > lastEditedAt;
  
  // ★要望対応：管理者（開発者）アカウント以外は、確認なしで自動的に最新のデータを反映する
  //   （旧新は問わない。ゲーム設定・シナリオデータはファイルの内容を常に正として扱う）
  if (typeof authReadyPromise !== "undefined") await authReadyPromise; // auth.js：ログイン状態が確定するまで待つ
  if (typeof isDeveloperAccount !== "function" || !isDeveloperAccount()) { // auth.js
    localStorage.setItem(decidedKey, String(data.version));
    forceApplyFn();
    localStorage.setItem(SCENARIOBUILD_LAST_EDITED_KEY, String(data.version));
    if (typeof saveCustomScenarioData === "function") saveCustomScenarioData();
    return;
  }
  
  const message = `${label}が、今このブラウザに保存されている内容と異なっています（ファイルの方が${isNewer ? "新しい" : "古い"}バージョンです）。\nこのデータファイルを読み込みますか？\n（「いいえ」を選ぶと、今のブラウザのデータをそのまま使い続けます）`;
  const ok = (typeof showGameConfirm === "function") ? await showGameConfirm(message) : false; // mainfunc.js
  localStorage.setItem(decidedKey, String(data.version)); // ★読み込む/読み込まない、どちらを選んでも「このバージョンは確認済み」として記録する
  if (ok) {
    forceApplyFn();
    localStorage.setItem(SCENARIOBUILD_LAST_EDITED_KEY, String(data.version)); // ★取り込んだ内容を「今の状態」として記録する
    if (typeof saveCustomScenarioData === "function") saveCustomScenarioData();
  }
}

function saveCustomScenarioData() {
  try {
    localStorage.setItem(SCENARIOBUILD_SAVE_KEY, JSON.stringify(scenarioProject));
    localStorage.setItem(SCENARIOBUILD_LAST_EDITED_KEY, String(Date.now()));
  } catch (e) {
    console.error("シナリオビルドデータの保存に失敗しました", e);
  }
}

// ★編集欄（onchange等）から呼ぶ、「まだブラウザには保存していない変更がある」印を付けるだけの軽い関数。
//   以前はここでも毎回saveCustomScenarioData()を呼んで、キー入力のたびに本保存（オートセーブ）していたが、
//   万一データが空・壊れた状態になった瞬間にそのままブラウザの保存を上書きしてしまう事故のリスクがあるため、
//   実際にブラウザへ保存するのは「💾保存」ボタンを押した時（commitScenarioBuildSave）だけにした
let scenarioBuildHasUnsavedChanges = false;
function markScenarioBuildDirty() {
  scenarioBuildHasUnsavedChanges = true;
  updateScenarioBuildSaveButton();
}

function updateScenarioBuildSaveButton() {
  const btn = document.getElementById("scenariobuild-save-btn");
  if (!btn) return;
  if (scenarioBuildHasUnsavedChanges) {
    btn.textContent = "💾 保存する（未保存の変更あり）";
    btn.classList.add("scenariobuild-save-btn-dirty");
  } else {
    btn.textContent = "💾 保存済み";
    btn.classList.remove("scenariobuild-save-btn-dirty");
  }
}

// ★実際にブラウザ（localStorage）へ書き込む。今保存しようとしている内容が明らかに空なのに、
//   ブラウザに既にちゃんとしたデータが残っている場合は、うっかり空データで上書きしてしまわないよう
//   一言確認してから保存する
async function commitScenarioBuildSave() {
  const isSuspiciouslyEmpty = (scenarioProject.chapters || []).length === 0
    && (scenarioProject.characters || []).length === 0
    && (scenarioProject.enemies || []).length === 0
    && (scenarioProject.items || []).length === 0;
  if (isSuspiciouslyEmpty) {
    const existingRaw = localStorage.getItem(SCENARIOBUILD_SAVE_KEY);
    if (existingRaw && existingRaw.length > 200) {
      const ok = await showGameConfirm("保存しようとしている内容が空のようです。このまま保存すると、今までのデータが消えてしまいます。本当に保存しますか？");
      if (!ok) return;
    }
  }
  saveCustomScenarioData();
  scenarioBuildHasUnsavedChanges = false;
  updateScenarioBuildSaveButton();
}

// ★読み込んだデータに足りない項目があれば補い、第一話・第二話が無ければ差し込む
// ★以前、技の unlockLevel や id を修正するたびに「同じ技なのに識別用idが変わってしまい、
//   既存データと結び付けられず新規追加されてしまう」不具合があり、その結果ゲーム画面で
//   同じ技が2つ（まれに3つ）選べてしまう状態になっているデータが実際に見つかった。
//   同じ職業・同じ技名の組み込み技が複数あれば、後から見つかった方（＝より新しい内容）を残して統合する
function dedupeBuiltinSkillEntries() {
  const seenAt = new Map(); // key: "職業|技名" -> resultの中でのindex
  const result = [];
  scenarioProject.skills.forEach(s => {
    if (!s.builtin) { result.push(s); return; } // ★自作の技は同名でも別物として扱う（統合しない）
    const key = s.className + "|" + s.name;
    if (seenAt.has(key)) {
      result[seenAt.get(key)] = s; // ★後から見つかった方を正として差し替える
    } else {
      seenAt.set(key, result.length);
      result.push(s);
    }
  });
  scenarioProject.skills = result;
  removePhantomBuiltinSkillDuplicates();
}

// ★過去のバージョンでは、カスタムで追加した技（builtin:false）が、後日の読み込み時に
//   「まだ登録されていない組み込み技」と誤認され、同名のbuiltin:trueの技としてもう1件
//   差し込まれてしまうことがあった（＝技一覧に同じ技が2つ出て、しかもどちらを編集しても
//   もう片方が別データとして残り続けるため、変更が反映されないように見えるバグの原因）。
//   本来のCLASS_SKILLSの原本（ORIGINAL_CLASS_SKILLS）に存在しないbuiltin:trueの技は、
//   このパターンで生まれた「幻の複製」とみなし、自作の方だけ残して取り除く
function removePhantomBuiltinSkillDuplicates() {
  scenarioProject.skills = scenarioProject.skills.filter(s => {
    if (!s.builtin) return true;
    const originalList = ORIGINAL_CLASS_SKILLS[s.className] || [];
    const isGenuine = originalList.some(orig => (s.skillId && orig.id === s.skillId) || orig.name === s.name);
    if (isGenuine) return true;
    // ★同名の自作技が別に存在するなら、これは幻の複製と判断して除外する
    const hasCustomCounterpart = scenarioProject.skills.some(other => !other.builtin && other.className === s.className && other.name === s.name);
    return !hasCustomCounterpart;
  });
}

function normalizeScenarioProject() {
  // ★バグ修正：isDeletedBuiltin()はもっと後ろ（旧423行目付近）で定義されていたが、
  //   このさらに手前（旧391行目、CLASS_MASTERの削除済み判定）で先に使われてしまっており、
  //   constの初期化前アクセス（TDZ）でReferenceErrorになり、この関数全体が毎回失敗していた。
  //   関数の一番最初で定義するように移動する
  if (!scenarioProject.deletedBuiltinIds || typeof scenarioProject.deletedBuiltinIds !== "object") {
    scenarioProject.deletedBuiltinIds = { chapters: [], characters: [], enemies: [], bosses: [], items: [], bgmTracks: [], mapAreas: [], skills: [], quests: [], classes: [] };
  }
  ["chapters", "characters", "enemies", "bosses", "items", "bgmTracks", "mapAreas", "skills", "companions", "quests", "classes"].forEach(key => {
    if (!Array.isArray(scenarioProject.deletedBuiltinIds[key])) scenarioProject.deletedBuiltinIds[key] = [];
  });
  const isDeletedBuiltin = (category, id) => scenarioProject.deletedBuiltinIds[category].includes(id);
  
  if (!Array.isArray(scenarioProject.chapters)) scenarioProject.chapters = [];
  if (!Array.isArray(scenarioProject.chapterArcs)) scenarioProject.chapterArcs = []; // ★要望対応：話管理を章ごとにタブ分けするための章一覧（{id, name}）
  if (!Array.isArray(scenarioProject.characters)) scenarioProject.characters = [];
  if (!Array.isArray(scenarioProject.enemies)) scenarioProject.enemies = [];
  if (!Array.isArray(scenarioProject.bosses)) scenarioProject.bosses = [];
  if (!Array.isArray(scenarioProject.items)) scenarioProject.items = [];
  // ★要望対応：魚管理タブ用のデータ。中身自体はアイテムと同じ扱いでITEM_MASTERへ反映される（fishing.js／ensureCustomFishRegistered）
  if (!Array.isArray(scenarioProject.fishItems)) scenarioProject.fishItems = [];
  if (!Array.isArray(scenarioProject.skills)) scenarioProject.skills = [];
  scenarioProject.skills.forEach(skill => {
    if (!Array.isArray(skill.blocks)) skill.blocks = []; // ★特殊スキル編集（ブロック実行モード）。1件でもあれば固定フィールドは無視される
    if (!skill.variables || typeof skill.variables !== "object") skill.variables = {}; // ★このスキル専用の作業用変数の初期値
  });
  if (!Array.isArray(scenarioProject.statusAilments)) scenarioProject.statusAilments = [];
  if (!Array.isArray(scenarioProject.statusBuffs)) scenarioProject.statusBuffs = [];
  if (!Array.isArray(scenarioProject.flagDefs)) scenarioProject.flagDefs = []; // [{ name, description }, ...]（フラグ管理タブ）
  if (!Array.isArray(scenarioProject.variableDefs)) scenarioProject.variableDefs = []; // [{ name, description }, ...]（ゲーム変数管理タブ。値自体はscenarioVariablesに保存される）
  if (!Array.isArray(scenarioProject.recipes)) scenarioProject.recipes = []; // [{ id, name, shopType, mode, materials, baseItemId, resultItemId, resultCount, cost, description }, ...]（レシピ管理タブ）
  // ★要望対応：オークションNPC等で使うランダム名前プール（ランダム名前管理タブ）。未設定時は既定の名前一覧を入れておく
  if (!Array.isArray(scenarioProject.randomNamePool)) {
    scenarioProject.randomNamePool = [
      "ハルト", "ユウナ", "ソウマ", "アカリ", "リク", "サクラ", "ダイキ", "ミサキ",
      "ケンタ", "ナナミ", "ショウ", "ユイ", "カイ", "メグミ", "タクマ", "ヒナタ",
      "レオ", "アオイ", "シュン", "マナミ",
    ];
  }
  // ★要望対応：属性管理タブ。属性一覧（火・氷等）と、属性同士の相性表
  //   （scenarioProject.elementMatchups[攻撃側属性id + ">" + 受ける側属性id] = "advantage"|"resist"、
  //   未設定は通常扱い）
  if (!Array.isArray(scenarioProject.elementDefs)) scenarioProject.elementDefs = []; // [{ id, name }, ...]
  if (!scenarioProject.elementMatchups || typeof scenarioProject.elementMatchups !== "object") scenarioProject.elementMatchups = {};
  // ★要望対応：ログインボーナス。常に必ず7日分（1〜7日目）が揃った状態にしておく
  if (!Array.isArray(scenarioProject.loginBonusDays)) scenarioProject.loginBonusDays = [];
  for (let day = 0; day < 7; day++) {
    if (!scenarioProject.loginBonusDays[day] || typeof scenarioProject.loginBonusDays[day] !== "object") {
      scenarioProject.loginBonusDays[day] = { gold: 0, exp: 0, items: [] };
    }
    const dayData = scenarioProject.loginBonusDays[day];
    if (typeof dayData.gold !== "number") dayData.gold = 0;
    if (typeof dayData.exp !== "number") dayData.exp = 0;
    if (!Array.isArray(dayData.items)) dayData.items = [];
  }
  scenarioProject.loginBonusDays.length = 7; // ★万が一7件より多く保存されていても7件に切り詰める
  // ★要望対応：会話AI設定（無ければ初期値を用意し、仲間ごとの欄も仲間の数だけ揃える）
  if (!scenarioProject.companionChatSettings || typeof scenarioProject.companionChatSettings !== "object") {
    scenarioProject.companionChatSettings = { partyName: "", protagonistEpithet: "", protagonistPersonality: "", companions: {} };
  }
  const ccs = scenarioProject.companionChatSettings;
  if (typeof ccs.partyName !== "string") ccs.partyName = "";
  if (typeof ccs.protagonistEpithet !== "string") ccs.protagonistEpithet = "";
  if (typeof ccs.protagonistPersonality !== "string") ccs.protagonistPersonality = "";
  if (!ccs.companions || typeof ccs.companions !== "object") ccs.companions = {};
  (scenarioProject.companions || []).forEach(companion => {
    if (!ccs.companions[companion.id] || typeof ccs.companions[companion.id] !== "object") {
      ccs.companions[companion.id] = { epithet: "", personality: "" };
    }
    if (typeof ccs.companions[companion.id].epithet !== "string") ccs.companions[companion.id].epithet = "";
    if (typeof ccs.companions[companion.id].personality !== "string") ccs.companions[companion.id].personality = "";
  });
  // ★状態異常・状態強化の「種類」を、状態管理タブから追加・編集できるようにする。
  //   実際の動作（mechanic）は決まった仕組みの中からしか選べないが、id・表示名・説明・
  //   デフォルトの効果量／ターン数は自由に決められる（同じ仕組みを違う名前・数値で使い回せる）
  const BUILTIN_STATUS_AILMENTS = [
    { id: "stun", mechanic: "stun", label: "スタン", description: "その場で行動できなくなる。", defaultDuration: 1, defaultPower: 0, defaultChance: 1 },
    { id: "paralyze", mechanic: "paralyze", label: "麻痺", description: "行動が制限される。", defaultDuration: 2, defaultPower: 0, defaultChance: 1 },
    { id: "confuse", mechanic: "confuse", label: "混乱", description: "行動がおかしくなる。", defaultDuration: 3, defaultPower: 0, defaultChance: 1 },
    { id: "burn", mechanic: "burn", label: "火傷", description: "毎ターン継続ダメージを受ける。", defaultDuration: 3, defaultPower: 3, defaultChance: 1 },
    { id: "poison", mechanic: "poison", label: "毒", description: "毎ターン継続ダメージを受ける。", defaultDuration: 3, defaultPower: 3, defaultChance: 1 },
    // ★以前は「鈍痛」も毒(mechanic: poison)を使い回していたため、毒と鈍痛が同じ状態として扱われて
    //   しまっていた（メッセージも常に「毒」表記になる等）。別のmechanicとして分離した
    { id: "dullPain", mechanic: "dullPain", label: "鈍痛", description: "毎ターン継続ダメージを受ける（毒とは別枠で扱われる）。", defaultDuration: 3, defaultPower: 3, defaultChance: 1 },
    { id: "atkDown", mechanic: "atkDown", label: "攻撃力低下", description: "攻撃力が下がる。", defaultDuration: 3, defaultPower: 3, defaultChance: 1 },
    { id: "defDown", mechanic: "defDown", label: "防御力低下", description: "防御力が下がる。", defaultDuration: 3, defaultPower: 3, defaultChance: 1 },
    { id: "accDown", mechanic: "accDown", label: "命中率低下", description: "攻撃が外れやすくなる。", defaultDuration: 3, defaultPower: 15, defaultChance: 1 },
    // ★「大いなる」シリーズ：技表で名前付きの状態として説明されている組み合わせ技の状態異常を、
    //   ちゃんと専用の名前で登録しておく（中身の動作は既存の仕組みの使い回し）
    { id: "great_frost_stun", mechanic: "stun", label: "大いなる氷結状態（行動不能）", description: "エターナル・ブリザードで敵を凍りつかせ、行動不能にする。", defaultDuration: 3, defaultPower: 0, defaultChance: 1 },
    { id: "great_frost_dot", mechanic: "poison", label: "大いなる氷結状態（継続ダメージ）", description: "エターナル・ブリザードの凍傷による継続低ダメージ。", defaultDuration: 3, defaultPower: 4, defaultChance: 1 },
    { id: "great_darkness", mechanic: "defDown", label: "大いなる闇状態", description: "ジェノサイド・レッド・バーストで、ダメージが入りやすくなる。", defaultDuration: 4, defaultPower: 3, defaultChance: 1 },
    // ★要望対応：ヘイトを買う状態異常。効果中は敵の攻撃がこちらへ優先的に向くようになる（挑発）
    { id: "hate", mechanic: "hate", label: "ヘイト上昇", description: "敵の攻撃が優先的にこちらへ向くようになる（挑発）。", defaultDuration: 3, defaultPower: 0, defaultChance: 1 }
  ];
  const BUILTIN_STATUS_BUFFS = [
    { id: "atkUp", mechanic: "atkUp", label: "攻撃力上昇", description: "一定ターンの間、攻撃力が上がる。", defaultDuration: 3, defaultPower: 5 },
    { id: "critUp", mechanic: "critUp", label: "会心率上昇", description: "一定ターンの間、会心率が上がる。", defaultDuration: 3, defaultPower: 20 },
    { id: "defUp", mechanic: "defUp", label: "防御力変化", description: "一定ターンの間、被ダメージが変化する（マイナス値で自傷デバフにも使える）。", defaultDuration: 3, defaultPower: 30 },
    { id: "immune", mechanic: "immune", label: "無敵", description: "一定ターンの間、被ダメージを完全に無効化する。", defaultDuration: 2, defaultPower: 0 },
    { id: "statusImmune", mechanic: "statusImmune", label: "状態異常無効", description: "一定ターンの間、状態異常の付与だけを無効化する（ダメージは防がない）。", defaultDuration: 5, defaultPower: 0 },
    { id: "surviveLethal", mechanic: "surviveLethal", label: "不屈", description: "致命傷になる一撃だけHP1で耐える（無敵とは違い、それ以外の一撃は普通に食らう）。", defaultDuration: 3, defaultPower: 0 },
    { id: "delayedPower", mechanic: "delayedPower", label: "やる気なし", description: "すぐには発動せず、一定ターン後に自動で強力な攻撃力上昇が発動する。", defaultDuration: 2, defaultPower: 0 },
    { id: "hpBerserk", mechanic: "hpBerserk", label: "被虐の力", description: "次の1回の攻撃だけ、残りHPを力に変える（イクサガミの被虐趣向専用）。", defaultDuration: 1, defaultPower: 0 },
    { id: "chainAttack", mechanic: "chainAttack", label: "連鎖攻撃", description: "一定ターンの間、単体攻撃がもう一体の敵にも連鎖する。", defaultDuration: 10, defaultPower: 0 },
    { id: "regen", mechanic: "regen", label: "継続回復", description: "一定ターンの間、ラウンド終了ごとに少しHPが回復する。", defaultDuration: 5, defaultPower: 0 },
    { id: "heal_up", mechanic: "healUp", label: "回復力上昇", description: "一定ターンの間、回復技の効果量が上がる（攻撃力上昇とは別枠）。", defaultDuration: 3, defaultPower: 10 },
    { id: "great_light_immune", mechanic: "statusImmune", label: "大いなる光芒状態（状態異常無効）", description: "ハイ・ディスシプリナで、状態異常が付与されなくなる。", defaultDuration: 5, defaultPower: 0 },
    { id: "great_light_regen", mechanic: "regen", label: "大いなる光芒状態（継続回復）", description: "ハイ・ディスシプリナで、ラウンド終了ごとに少しHPが回復する。", defaultDuration: 5, defaultPower: 0 },
    { id: "blood_dance", mechanic: "bloodDance", label: "血華の演舞（ブラッド・ダンス）", description: "発動中は攻撃するたび攻撃力が積み上がり、代わりに自分も少しダメージを受ける。", defaultDuration: 10, defaultPower: 2 },
    { id: "all_stats_up", mechanic: "allStatsUp", label: "全ステータス上昇", description: "一定ターンの間、攻撃力・会心率・被ダメージ軽減がまとめて上がる。", defaultDuration: 3, defaultPower: 15 },
    // ★要望対応：ヘイトを買う状態異常。仲間（タンク役）が自分に使うと、敵の攻撃を引き受けられる
    { id: "hate", mechanic: "hate", label: "ヘイト上昇", description: "敵の攻撃が優先的にこちらへ向くようになる（挑発）。", defaultDuration: 3, defaultPower: 0 }
  ];
  BUILTIN_STATUS_AILMENTS.forEach(def => {
    if (!scenarioProject.statusAilments.some(d => d.id === def.id)) scenarioProject.statusAilments.push({ ...def, builtin: true });
  });
  BUILTIN_STATUS_BUFFS.forEach(def => {
    if (!scenarioProject.statusBuffs.some(d => d.id === def.id)) scenarioProject.statusBuffs.push({ ...def, builtin: true });
  });
  if (!Array.isArray(scenarioProject.companions)) scenarioProject.companions = [];
  if (!Array.isArray(scenarioProject.quests)) scenarioProject.quests = [];
  if (!Array.isArray(scenarioProject.achievements)) scenarioProject.achievements = []; // ★実績管理タブ（要望対応）
  if (!Array.isArray(scenarioProject.tutorials)) scenarioProject.tutorials = [];
  if (!Array.isArray(scenarioProject.facilities)) scenarioProject.facilities = [];
  if (!Array.isArray(scenarioProject.portraitCharacters)) scenarioProject.portraitCharacters = []; // ★立ち絵管理（キャラごとの通常時画像＋表情一覧）
  if (!scenarioProject.classStats || typeof scenarioProject.classStats !== "object") scenarioProject.classStats = {};
  if (typeof CLASS_MASTER !== "undefined") {
    Object.keys(CLASS_MASTER).forEach(className => {
      if (isDeletedBuiltin("classes", className)) { delete CLASS_MASTER[className]; return; } // ★削除済みの組み込み職業は復活させない
      const master = CLASS_MASTER[className];
      if (scenarioProject.classStats[className]) {
        // ★既に取り込み済みでも、growthPerLevel.maxSleepiness（眠気上限の成長値）・type・unlockFlagNameは
        //   後から追加した項目なので、無ければ最新の値を補ってあげる（他の項目はユーザーが
        //   編集している可能性があるため触れない）
        const existing = scenarioProject.classStats[className];
        const existingGrowth = existing.growthPerLevel;
        if (existingGrowth && existingGrowth.maxSleepiness == null && master.growthPerLevel && master.growthPerLevel.maxSleepiness != null) {
          existingGrowth.maxSleepiness = master.growthPerLevel.maxSleepiness;
        }
        if (existing.type == null) existing.type = "normal";
        if (existing.unlockFlagName == null) existing.unlockFlagName = "";
        return; // ★既に編集済みならそれ以外はそのまま
      }
      scenarioProject.classStats[className] = {
        description: master.description, type: "normal", unlockFlagName: "",
        baseStats: { ...master.baseStats },
        maxSleepiness: master.maxSleepiness, maxFatigue: master.maxFatigue,
        growthPerLevel: { ...master.growthPerLevel }
      };
    });
  }
  if (!Array.isArray(scenarioProject.bgmTracks)) scenarioProject.bgmTracks = [];
  if (!Array.isArray(scenarioProject.mapAreas)) scenarioProject.mapAreas = [];
  if (!Array.isArray(scenarioProject.mapEdges)) scenarioProject.mapEdges = [];
  if (!scenarioProject.trialGuardianOverrides || typeof scenarioProject.trialGuardianOverrides !== "object") scenarioProject.trialGuardianOverrides = {}; // ★試練の守護者のランク別ステータス指定
  if (!scenarioProject.fameThresholds || typeof scenarioProject.fameThresholds !== "object") scenarioProject.fameThresholds = {}; // ★ランクアップに必要な名声度の指定
  
  // ★組み込みのクエスト（questboard.jsのQUEST_BOARD_MASTER）を、クエスト管理タブで編集できるよう
  //   scenarioProject.questsへ取り込む。他の組み込みデータと同じく、削除済みのものは復活させない
  if (typeof QUEST_BOARD_MASTER !== "undefined") {
    QUEST_BOARD_MASTER.forEach(master => {
      if (scenarioProject.quests.some(q => q.id === master.id) || isDeletedBuiltin("quests", master.id)) return;
      scenarioProject.quests.push({ ...master, builtin: true });
    });
  }
  
  // ★戦闘ブロックの旧データ形式（monsterKey単体+count）を、新形式（enemies配列）に変換しておく
  scenarioProject.chapters.forEach(chapter => {
    (chapter.blocks || []).forEach(block => {
      if (block.type === "battle" && block.monsterKey !== undefined && !Array.isArray(block.enemies)) {
        block.enemies = Array(Math.max(1, Math.min(5, block.count || 1))).fill(block.monsterKey);
        delete block.monsterKey;
        delete block.count;
      }
    });
  });
  
  scenarioProject.mapAreas.forEach(area => {
    if (!Array.isArray(area.enemyIds)) area.enemyIds = [];
    if (!Array.isArray(area.items)) area.items = [];
    if (!Array.isArray(area.battleVariations)) area.battleVariations = [];
    if (typeof area.x !== "number") area.x = 50;
    if (typeof area.y !== "number") area.y = 50;
    if (!area.type) area.type = "village";
    if (typeof area.enemyLevel === "undefined") area.enemyLevel = null; // ★このエリアで出る敵の固定レベル（未設定なら主人公のレベル基準のまま）
    if (!Array.isArray(area.facilityIds)) area.facilityIds = []; // ★このエリア（拠点）に表示する施設編集タブの施設id一覧
    // ★「調べる」メッセージを複数パターン持たせて、毎回ランダムに1つ表示できるようにした。
    //   旧データ（examineMessageが1本の文字列）は、そのまま配列の1件目として引き継ぐ
    if (!Array.isArray(area.examineMessages)) {
      area.examineMessages = area.examineMessage ? [area.examineMessage] : [];
    }
  });
  
  // ★カリの村自体も、マップ設定タブから編集できるように差し込んでおく（名前・BGM・背景・そこに表示する施設のアタッチ）。
  //   一度だけ作る時に、村を「拠点」として扱う目印（locationKey==="village"）を付ける
  if (!scenarioProject.mapAreas.some(a => a.locationKey === "village") && !isDeletedBuiltin("mapAreas", "village")) {
    const villageNode = (typeof ADVENTURE_MAP_NODES !== "undefined") ? ADVENTURE_MAP_NODES.find(n => n.id === "village") : null;
    scenarioProject.mapAreas.push({
      id: generateId("builtinarea"), locationKey: "village", builtin: true,
      name: (villageNode && villageNode.label) || "カリの村", type: "village",
      x: (villageNode && villageNode.x) || 16, y: (villageNode && villageNode.y) || 78,
      bgTrack: "town", bgImage: "img/村.jpeg",
      bossId: "", enemyIds: [], items: [], examineMessage: "", examineMessages: [], battleVariations: [], enemyLevel: null,
      // ★これまでは施設編集で作った施設が全ての拠点に出てしまっていたので、
      //   これまで通りの見た目を保つために、既にある施設を最初から全て村にアタッチしておく
      facilityIds: scenarioProject.facilities.map(f => f.id)
    });
  }
  
  if (!scenarioProject.chapters.some(c => c.id === "builtin_chapter1") && !isDeletedBuiltin("chapters", "builtin_chapter1")) {
    scenarioProject.chapters.unshift({
      id: "builtin_chapter1", title: "第一話（異世界転生）", cleared: false,
      builtin: true, requiredChapterNumber: null,
      blocks: typeof buildChapter1SeedBlocks === "function" ? buildChapter1SeedBlocks() : []
    });
  }
  if (!scenarioProject.chapters.some(c => c.id === "builtin_chapter2") && !isDeletedBuiltin("chapters", "builtin_chapter2")) {
    const insertAt = scenarioProject.chapters.findIndex(c => c.id === "builtin_chapter1") + 1;
    scenarioProject.chapters.splice(Math.max(0, insertAt), 0, {
      id: "builtin_chapter2", title: "第二話（ホブゴブリンの群れ）", cleared: false,
      builtin: true, requiredChapterNumber: 1, requiredChapterId: "builtin_chapter1",
      requiredDays: 3, requiredProgress: 200, // ★以前はここが編集しても反映されないバグで、実際はscenario2.js側にハードコードされた「15日・進行度200」が使われていた
      blocks: typeof buildChapter2SeedBlocks === "function" ? buildChapter2SeedBlocks() : []
    });
  }
  // ★既にある（が空のままの）組み込み話にも、最初から本編の内容を書き込んでおく
  scenarioProject.chapters.forEach(c => {
    if (!c.builtin || (c.blocks && c.blocks.length > 0)) return;
    if (c.id === "builtin_chapter1" && typeof buildChapter1SeedBlocks === "function") c.blocks = buildChapter1SeedBlocks();
    if (c.id === "builtin_chapter2" && typeof buildChapter2SeedBlocks === "function") c.blocks = buildChapter2SeedBlocks();
  });
  // ★第一話・第二話は一度ブラウザに保存されると、以降builtin_chapters_seed.js側の中身を更新しても
  //   自動では再読み込みされない（↑のブロック補充は「空っぽの時だけ」なので、既にブロックがある話は対象外）。
  //   このため、話クリアを記録する clearchapter/ending ブロックを後から追加した場合、それより前に一度でも
  //   遊んで保存してしまったブラウザでは、いつまでも「話クリア」が記録されずcleared=falseのままになってしまう
  //   不具合があった。既存の中身（自分で編集した内容）は壊さず、終了を記録するブロックが1つも無い場合だけ
  //   末尾に補う形で救済する
  ["builtin_chapter1", "builtin_chapter2"].forEach(id => {
    const c = scenarioProject.chapters.find(ch => ch.id === id);
    if (!c || !Array.isArray(c.blocks) || c.blocks.length === 0) return;
    const hasClearOrEnding = c.blocks.some(b => b.type === "ending" || b.type === "clearchapter");
    if (!hasClearOrEnding && typeof createBlock === "function") {
      const clearBlock = createBlock("clearchapter");
      clearBlock.resetProgress = false;
      c.blocks.push(clearBlock);
    }
  });
  scenarioProject.chapters.forEach(c => {
    if (!Array.isArray(c.blocks)) c.blocks = [];
    if (typeof c.requiredChapterNumber === "undefined") c.requiredChapterNumber = null;
    if (typeof c.builtin !== "boolean") c.builtin = false;
    if (typeof c.requiredChapterId === "undefined") {
      // ★古いデータ（requiredChapterNumber）からの移行：話の並び順から該当する話を推測する（ベストエフォート）
      if (c.requiredChapterNumber && scenarioProject.chapters[c.requiredChapterNumber - 1]) {
        c.requiredChapterId = scenarioProject.chapters[c.requiredChapterNumber - 1].id;
      } else {
        c.requiredChapterId = null;
      }
    }
    if (typeof c.requiredRank === "undefined") c.requiredRank = null;
    if (typeof c.requiredProgress === "undefined") c.requiredProgress = null;
    if (typeof c.requiredDays === "undefined") c.requiredDays = null;
    if (typeof c.requiredFlag === "undefined") c.requiredFlag = null;
  });
  
  // ★既にいる敵・ボス（enemy.js/boss.js）も、敵設定・ボス設定タブから直接編集できるように差し込んでおく。
  //   一度削除すると（deletedBuiltinIdsに記録されるので）、次に開いた時も戻ってこない
  if (typeof ENEMY_MASTER !== "undefined") {
    Object.keys(ENEMY_MASTER).forEach(key => {
      const master = ENEMY_MASTER[key];
      const existing = scenarioProject.enemies.find(e => e.id === key);
      if (existing) {
        // ★データ移行：上のバグ修正より前に登録されていた敵は、restSkillName等が空のまま保存されてしまっている。
        //   ユーザーが意図的に空にした可能性より「まだ引き継がれていないだけ」の可能性の方が高いため、
        //   まだ空欄（未編集）の項目だけ、組み込みの元データから改めて補っておく
        if (!existing.restSkillName && master.restSkillName) existing.restSkillName = master.restSkillName;
        if (!Array.isArray(existing.affectionGainRange) && Array.isArray(master.affectionGainRange)) existing.affectionGainRange = [...master.affectionGainRange];
        if ((!Array.isArray(existing.killBlocks) || existing.killBlocks.length === 0) && Array.isArray(master.killBlocks) && master.killBlocks.length > 0) existing.killBlocks = master.killBlocks;
        if ((!Array.isArray(existing.spareBlocks) || existing.spareBlocks.length === 0) && Array.isArray(master.spareBlocks) && master.spareBlocks.length > 0) existing.spareBlocks = master.spareBlocks;
        return;
      }
      if (isDeletedBuiltin("enemies", key)) return;
      scenarioProject.enemies.push({
        id: key, name: master.name, description: master.description || "", maxHp: master.maxHp, atk: master.atk, exp: master.exp,
        dropItemId: master.dropItemId || null, dropRate: master.dropRate || 0,
        killFlavor: master.killFlavor || "", spareFlavor: master.spareFlavor || "", giftItemId: master.giftItemId || null,
        uniqueSkill: master.uniqueSkill ? { ...master.uniqueSkill } : null,
        // ★バグ修正：この2つがここで引き継がれていなかったため、シナリオデータの読み込みのたびに
        //   MONSTER_MASTERが再構築される際（ensureCustomMonstersRegistered）restSkillNameが消えてしまい、
        //   好感度MAXでも魔物図鑑から専用スキル（サキュバスの「サキュバスと休憩♡」等）が使えなくなっていた
        restSkillName: master.restSkillName || "",
        restSkillBlocks: Array.isArray(master.restSkillBlocks) ? master.restSkillBlocks : [],
        affectionGainRange: Array.isArray(master.affectionGainRange) ? [...master.affectionGainRange] : null,
        // ★要望対応：見逃した/倒した時のセリフを、単純な1行のテキストだけでなく、話のブロックと同じように
        //   複数のセリフ・分岐・フラグ操作などを組み合わせて演出できるようにする
        killBlocks: Array.isArray(master.killBlocks) ? master.killBlocks : [],
        spareBlocks: Array.isArray(master.spareBlocks) ? master.spareBlocks : [],
        builtin: true
      });
    });
  }
  if (typeof BOSS_MASTER !== "undefined") {
    Object.keys(BOSS_MASTER).forEach(key => {
      if (key === "trial_guardian") return; // ★試練の守護者はランクごとに別枠で強さを決めているので、通常のボス一覧には出さない
      const master = BOSS_MASTER[key];
      const existingBoss = scenarioProject.bosses.find(b => b.id === key);
      if (existingBoss) {
        // ★以前は「一度ブラウザに取り込んだら二度と触らない」だったため、boss.js側で後からBGMを
        //   設定・修正しても、既にブラウザにあるボスには永久に反映されなかった（ボスのBGMが
        //   いつまでも鳴らない/古いままになる不具合の原因）。ステータス等の他の項目はユーザーが
        //   編集している可能性があるため触れず、BGM欄だけ「ブラウザ側が空欄のまま」なら
        //   最新のboss.js側の値を拾うようにする
        if (!existingBoss.bgmTrack && master.bgmTrack) existingBoss.bgmTrack = master.bgmTrack;
        if (!existingBoss.bgmFinalTrack && master.bgmFinalTrack) existingBoss.bgmFinalTrack = master.bgmFinalTrack;
        if (!existingBoss.bgmCrisisTrack && master.bgmCrisisTrack) existingBoss.bgmCrisisTrack = master.bgmCrisisTrack;
        return;
      }
      if (isDeletedBuiltin("bosses", key)) return;
      scenarioProject.bosses.push({
        id: key, name: master.name, description: master.description || "", maxHp: master.maxHp, atk: master.atk, exp: master.exp,
        bgmTrack: master.bgmTrack || "", bgmFinalTrack: master.bgmFinalTrack || "", bgmCrisisTrack: master.bgmCrisisTrack || "",
        invincibilityBreakItemId: master.invincibilityBreakItemId || "",
        dropItemId: master.dropItemId || null, dropRate: master.dropRate || 0,
        killFlavor: master.killFlavor || "", spareFlavor: master.spareFlavor || "", giftItemId: master.giftItemId || null,
        uniqueSkill: master.uniqueSkill ? { ...master.uniqueSkill } : null,
        level: master.level || null, fixedStats: master.fixedStats ? "on" : "",
        builtin: true
      });
    });
  }
  
  // ★既にあるアイテム（items.js）も、アイテム設定タブから直接編集・削除できるように差し込んでおく
  if (typeof ITEM_MASTER !== "undefined") {
    Object.keys(ITEM_MASTER).forEach(key => {
      if (scenarioProject.items.some(i => i.id === key) || isDeletedBuiltin("items", key)) return;
      const master = ITEM_MASTER[key];
      scenarioProject.items.push({
        id: key, name: master.name, category: master.category, description: master.description,
        rank: master.rank, listedPrice: master.listedPrice, trueValue: master.trueValue, builtin: true
      });
    });
  }
  
  // ★既にある職業別の技（player.jsのCLASS_SKILLS、ここでは上書きされる前の原本 ORIGINAL_CLASS_SKILLS を使う）も、
  //   スキル管理タブから直接編集できるように差し込んでおく。
  //   statusEffect/statusEffect2/selfBuffは入れ子オブジェクトなので、編集しやすいようフラットな項目に開いて持つ
  // ★以前はここのidに unlockLevel を含めていたため、こちらの修正でレベル調整や技へのid付与を行うたびに
  //   「同じ技なのに違うidになる」→ 既存の技が見つからず二重に追加されてしまう不具合があった
  //  （ゲーム画面で同じ技が2つ選べてしまう現象の原因）。className+skillId（無ければ技名）だけで
  //   同一判定するようにし、既存のズレたidも一致すれば更新して吸収する
  // ★さらに以前は、CLASS_SKILLSそのもの（ensureCustomSkillsRegistered()でカスタム技も混ぜて上書きされたもの）を
  //   ここで見ていたため、カスタムで追加した技が「まだ登録されていない組み込み技」と誤認され、
  //   builtin:trueの別idでもう1件差し込まれてしまう不具合があった（技が2つ表示される・編集が保存されない原因）。
  //   上書きされる前の原本（ORIGINAL_CLASS_SKILLS）だけを見るようにして、これを解消する
  // ★さらに、技を「リネーム」した場合の不具合の後始末：スキル管理で技名を変更すると、以降はskillId（無い技も多い）
  //   でも旧名でも一致しなくなり、新しい名前で別のbuiltin技として新規に差し込まれてしまい、旧名の技がゴースト
  //   （亡霊）データとしてscenarioProject.skillsに残り続けてしまっていた（ゴーストは元の技のidや内容を引きずったまま
  //   なので、プレイ画面のスキルタブや戦闘中の選択肢に「新旧混ざった技が2つ」表示される不具合の原因になっていた）。
  //   ここでは「今回のマージで実際にORIGINAL_CLASS_SKILLSのどれかに紐付いた（＝生きている）builtin技」を記録しておき、
  //   ループの後で、紐付かなかったbuiltin技（＝ゴースト）をまとめて取り除く
  const claimedBuiltinSkillEntries = new Set();
  Object.keys(ORIGINAL_CLASS_SKILLS).forEach(className => {
    ORIGINAL_CLASS_SKILLS[className].forEach(skill => {
      const skillId = `${className}_${skill.id || skill.name}`;
      if (isDeletedBuiltin("skills", skillId)) return;
      // ★同一判定：まずskillId（player.js側のid）で探し、見つからなければ技名で探す
      //  （「技にidを新しく付けた」ことで、既存データのskillIdが空のまま一致しなくなるケースを拾うため）
      const existing = scenarioProject.skills.find(s => s.className === className && s.builtin && skill.id && s.skillId === skill.id)
        || scenarioProject.skills.find(s => s.className === className && s.builtin && s.name === skill.name);
      if (existing) {
        existing.id = skillId; // ★idのズレ（旧：レベル入り）を今の形に揃えておく
        if (skill.id) existing.skillId = skill.id; // ★新しく付いたidも取り込んでおく（次回からはskillId一致で見つかる）
        claimedBuiltinSkillEntries.add(existing);
        return;
      }
      const newBuiltinSkillEntry = {
        id: skillId, className, skillId: skill.id || "",
        name: skill.name, description: skill.description || "", type: skill.type,
        element: skill.element || "無", spCost: skill.spCost || 0, unlockLevel: skill.unlockLevel,
        power: skill.power || 0, target: skill.target === "all" ? "all" : "single",
        atkType: skill.atkType === "magical" ? "magical" : "physical", // ★スキルが参照する攻撃力（物理／魔法）
        hitCount: skill.hitCount || 1, gauge: skill.gauge || "", cleanse: !!skill.cleanse,
        passiveId: skill.passiveId || "",
        randomTarget: !!skill.randomTarget, wideVariance: !!skill.wideVariance,
        partyWide: !!skill.partyWide,
        lifestealRatio: skill.lifestealRatio || 0,
        revives: !!skill.revives,
        triggerChance: skill.triggerChance != null ? skill.triggerChance : 1,
        statusEffectKind: (skill.statusEffect && skill.statusEffect.kind) || "",
        statusEffectChance: (skill.statusEffect && skill.statusEffect.chance != null) ? skill.statusEffect.chance : 1,
          statusEffectDuration: (skill.statusEffect && skill.statusEffect.duration) || 1,
          statusEffectPower: (skill.statusEffect && skill.statusEffect.power) || 0,
          statusEffect2Kind: (skill.statusEffect2 && skill.statusEffect2.kind) || "",
          statusEffect2Chance: (skill.statusEffect2 && skill.statusEffect2.chance != null) ? skill.statusEffect2.chance : 1,
          statusEffect2Duration: (skill.statusEffect2 && skill.statusEffect2.duration) || 1,
          statusEffect2Power: (skill.statusEffect2 && skill.statusEffect2.power) || 0,
          selfBuffKind: (skill.selfBuff && skill.selfBuff.kind) || "",
          selfBuffDuration: (skill.selfBuff && skill.selfBuff.duration) || 1,
          selfBuffPower: (skill.selfBuff && skill.selfBuff.power) || 0,
          selfBuffMode: (skill.selfBuff && skill.selfBuff.mode === "multiply") ? "multiply" : "add",
          selfBuff2Kind: (skill.selfBuff2 && skill.selfBuff2.kind) || "",
          selfBuff2Duration: (skill.selfBuff2 && skill.selfBuff2.duration) || 1,
          selfBuff2Power: (skill.selfBuff2 && skill.selfBuff2.power) || 0,
          selfBuff2Mode: (skill.selfBuff2 && skill.selfBuff2.mode === "multiply") ? "multiply" : "add",
          builtin: true
      };
      scenarioProject.skills.push(newBuiltinSkillEntry);
      claimedBuiltinSkillEntries.add(newBuiltinSkillEntry);
    });
  });
  // ★上のループでORIGINAL_CLASS_SKILLSのどれにも紐付かなかったbuiltin技（＝リネームや削除で行き場を失った
  //   ゴーストデータ）を、ここでまとめて取り除く。カスタム技（builtin:false）には触れない。
  //   ★さらに、今まさに特殊技（ブロック）エディタで編集中の技（scenarioBuildEditingSkillId）は、
  //     リネームした直後などで一時的にORIGINAL_CLASS_SKILLSと一致しなくなっていても、絶対に
  //     取り除かない（以前はここで巻き添えになり、編集中に技が消えたり、少し前の状態に戻ったように
  //     見えたりする不具合の原因になっていた）
  scenarioProject.skills = scenarioProject.skills.filter(s =>
    !s.builtin || claimedBuiltinSkillEntries.has(s) || (typeof scenarioBuildEditingSkillId !== "undefined" && s.id === scenarioBuildEditingSkillId)
  );
  dedupeBuiltinSkillEntries(); // ★過去のバージョンで発生した「同じ技が2つ登録される」不具合の後始末（後述の関数）
  
  // ★仲間「ケツァナ」（第二話でパーティーに誘える、竜殺しの狂戦士）を、仲間編集タブから
  //   直接編集できるように差し込んでおく。ステータスは狂戦士の職業データと同じ値から始まる
  if (!scenarioProject.companions.some(c => c.id === "ketsuna") && !isDeletedBuiltin("companions", "ketsuna")) {
    const berserker = (typeof CLASS_MASTER !== "undefined" ? CLASS_MASTER["狂戦士"] : null) || {};
    scenarioProject.companions.push({
      id: "ketsuna", name: "ケツァナ", description: "竜殺しの二つ名を持つ、腕利きの狂戦士（バーサーカー）。第二話でパーティーに誘うと仲間になる。",
      class: "狂戦士", initialWeaponId: "",
      baseStats: { ...(berserker.baseStats || { maxHp: 44, maxSp: 35, atk: 6, agi: 7, skillPower: 5, luck: 8, charm: 8 }) },
      growthPerLevel: { ...(berserker.growthPerLevel || { maxHp: 5.5, maxSp: 3.5, atk: 1.0, agi: 0.4, skillPower: 0.4, luck: 0.2, charm: 0.2 }) },
      builtin: true
    });
  } else {
    // ★以前のバージョンで職業が正しく設定されないまま保存されてしまっていた場合の、一度きりの修復
    const existingKetsuna = scenarioProject.companions.find(c => c.id === "ketsuna" && c.builtin);
    if (existingKetsuna && existingKetsuna.class !== "狂戦士") {
      existingKetsuna.class = "狂戦士";
    }
  }
  
  // ★既に使われているBGM（bgm.jsのBGM_TRACK_PATHS。town・field_caveなど）も、BGM設定タブから直接編集・削除できるように差し込んでおく
  if (typeof BGM_TRACK_PATHS !== "undefined") {
    Object.keys(BGM_TRACK_PATHS).forEach(key => {
      if (scenarioProject.bgmTracks.some(b => b.id === key) || isDeletedBuiltin("bgmTracks", key)) return;
      scenarioProject.bgmTracks.push({ id: key, name: key, path: BGM_TRACK_PATHS[key], builtin: true });
    });
  }
  
  // ★既に本編に登場しているキャラ名も、キャラ管理タブから話者名の候補として使えるように差し込んでおく
  const BUILTIN_MAIN_CHARACTER_NAMES = ["田中治郎", "竜殺し"]; // ★複数の話をまたいで出てくる主要キャラ
  const BUILTIN_CHARACTER_NAMES = [
    "ゴブリン", "サキュバス", "ハーピー", "ビャンビャン", "ホブゴブリン",
    "囚われの女性", "囚われの女性たち", "女性冒険者", "宿の主人", "屈強な男",
    "店主", "治郎（男）", "田中治郎", "神様？", "竜殺し", "買取屋の主人",
    "錆取り屋の主人", "鑑定士", "青椒"
  ];
  BUILTIN_CHARACTER_NAMES.forEach(name => {
    if (scenarioProject.characters.some(c => c.id === name) || isDeletedBuiltin("characters", name)) return;
    scenarioProject.characters.push({ id: name, name, note: "", builtin: true, kind: BUILTIN_MAIN_CHARACTER_NAMES.includes(name) ? "main" : "chapter" });
  });
  scenarioProject.characters.forEach(c => { if (typeof c.kind === "undefined") c.kind = "chapter"; }); // ★古いデータの移行
  
  // ★既にあるマップ（森・草原・洞窟）も、マップ設定タブから直接編集・削除できるように差し込んでおく
  if (typeof ADVENTURE_LOCATIONS !== "undefined" && typeof BUILTIN_MAP_LOCATION_KEYS !== "undefined") {
    // ★元々のマップ画面（adventuremap.js）での位置を初期値として引き継ぐ
    const staticNodePositions = (typeof ADVENTURE_MAP_NODES !== "undefined")
      ? Object.fromEntries(ADVENTURE_MAP_NODES.filter(n => n.locationKey).map(n => [n.locationKey, { x: n.x, y: n.y }]))
      : {};
    BUILTIN_MAP_LOCATION_KEYS.forEach(key => {
      if (scenarioProject.mapAreas.some(a => a.locationKey === key) || isDeletedBuiltin("mapAreas", key)) return;
      const loc = ADVENTURE_LOCATIONS[key];
      if (!loc) return;
      const pos = staticNodePositions[key] || { x: 50, y: 50 };
      scenarioProject.mapAreas.push({
        id: generateId("builtinarea"), locationKey: key, builtin: true,
        name: loc.name, type: "enemy", x: pos.x, y: pos.y,
        bgTrack: (typeof BGM_TRACK_PATHS !== "undefined" && BGM_TRACK_PATHS["field_" + key]) || "",
        bgImage: (loc.background && loc.background.value) || "",
        bossId: "", enemyIds: Array.isArray(loc.monsterPool) ? loc.monsterPool.slice() : [],
        items: [], examineMessage: "", examineMessages: [], battleVariations: [], enemyLevel: loc.minMonsterLevel || 1
      });
    });
  }
  
  // ★「カデリクの街」（placeholder）や「？」（unknown）など、まだ本編未実装のマップノードも、
  //   マップ設定タブから名前・位置の編集や削除ができるように、また中身を作り込んで実際に入れる場所にも
  //   できるように差し込んでおく（今まではこのエディタの対象外になっていて、編集・削除が一切できなかった）
  if (typeof ADVENTURE_MAP_NODES !== "undefined") {
    ADVENTURE_MAP_NODES.forEach(node => {
      if (node.kind !== "placeholder" && node.kind !== "unknown") return;
      if (scenarioProject.mapAreas.some(a => a.locationKey === node.id) || isDeletedBuiltin("mapAreas", node.id)) return;
      scenarioProject.mapAreas.push({
        id: generateId("builtinarea"), locationKey: node.id, builtin: true, unimplemented: true,
        name: node.label || node.placeholderName || "？", type: node.kind, x: node.x, y: node.y,
        bgTrack: "", bgImage: "",
        bossId: "", enemyIds: [], items: [], examineMessage: "", examineMessages: [], battleVariations: [], enemyLevel: null
      });
    });
  }
  
  // ★エリア同士のつながり（線）の初期状態。まだ一度も初期化していない場合だけ、
  //   これまでの固定のつながり方（村↔各エリア、カデリクの街↔その先の「？」等）を一度だけ引き継ぐ
  //   （mapEdges.length===0で判定すると、全部の線を意図的に切った状態が再読み込みで復活してしまうため、
  //   専用のフラグで「初期化済みかどうか」を別に覚えておく）
  if (!scenarioProject.mapEdgesInitialized) {
    scenarioProject.mapEdgesInitialized = true;
    scenarioProject.mapEdgesKaderikuMerged = true; // ★新規プレイヤーはこの下でまとめて全部入るので、個別マージは不要
    if (typeof ADVENTURE_MAP_EDGES !== "undefined") {
      // ★村と各エリアだけでなく、カデリクの街やその先の「？」ノード同士のつながりも
      //   マップエディタ側でそのまま操作（つなぎ直す／切る）できるように、最初に一度だけ引き継いでおく
      ADVENTURE_MAP_EDGES.forEach(([fromId, toId]) => {
        if (!scenarioProject.mapEdges.some(([a, b]) => a === fromId && b === toId)) {
          scenarioProject.mapEdges.push([fromId, toId]);
        }
      });
    } else {
      BUILTIN_MAP_LOCATION_KEYS.forEach(key => {
        if (scenarioProject.mapAreas.some(a => a.locationKey === key)) {
          scenarioProject.mapEdges.push(["village", key]);
        }
      });
    }
  } else if (!scenarioProject.mapEdgesKaderikuMerged && typeof ADVENTURE_MAP_EDGES !== "undefined") {
    // ★この修正より前から遊んでいたセーブデータ向けの、一度きりの追加移行。
    //   「カデリクの街」「？」ノードはこれまで一切編集対象外だった＝ユーザーが意図的に線を切ったことは
    //   あり得ないので、その関連の線だけ安全に追加する（他のエリアの線は、切られていたら切られたままにする）
    scenarioProject.mapEdgesKaderikuMerged = true;
    ADVENTURE_MAP_EDGES.forEach(([fromId, toId]) => {
      const involvesUnimplementedNode = [fromId, toId].some(id => id === "kaderiku" || id.startsWith("kaderiku_") || id === "highway_beyond");
      if (!involvesUnimplementedNode) return;
      if (!scenarioProject.mapEdges.some(([a, b]) => a === fromId && b === toId)) {
        scenarioProject.mapEdges.push([fromId, toId]);
      }
    });
  }
}

let nextScenarioIdSeq = 1;
function generateId(prefix) {
  return `${prefix}_${Date.now()}_${nextScenarioIdSeq++}`;
}

// ===== undo/redo =====
// ★構造的な変更（話・ブロック・各種登録の追加/削除/並び替え）の前にスナップショットを1つ積む。
//   テキスト欄の1文字ごとの編集までは対象にしない（入力欄自体のブラウザ標準undoに任せる）
let scenarioUndoStack = [];
let scenarioRedoStack = [];
const SCENARIO_UNDO_LIMIT = 50;

function pushUndoSnapshot() {
  scenarioUndoStack.push(JSON.stringify(scenarioProject));
  if (scenarioUndoStack.length > SCENARIO_UNDO_LIMIT) scenarioUndoStack.shift();
  scenarioRedoStack = [];
  updateUndoRedoButtons();
}

function undoScenarioChange() {
  if (scenarioUndoStack.length === 0) return;
  scenarioRedoStack.push(JSON.stringify(scenarioProject));
  scenarioProject = JSON.parse(scenarioUndoStack.pop());
  normalizeScenarioProject();
  ensureCustomMonstersRegistered();
  ensureCustomBgmRegistered();
  ensureCustomItemsRegistered(); ensureCustomFishRegistered(); // ★アイテム設定・魚管理で追加・編集したものを念のため最新の状態にしてから使う
  ensureCustomSkillsRegistered(); // ★スキル管理で追加・編集した技を念のため最新の状態にしてから使う
  ensureCustomCompanionsRegistered(); // ★仲間編集で追加・編集した仲間を念のため最新の状態にしてから使う
  ensureCustomClassStatsRegistered(); // ★職業編集で編集した主人公の職業ステータスを念のため最新の状態にしてから使う
  if (typeof applyBuiltinMapAreaOverrides === "function") applyBuiltinMapAreaOverrides(); // adventure.js（マップ設定タブでの編集内容を反映）
  markScenarioBuildDirty();
  updateUndoRedoButtons();
  renderScenarioBuildPanel();
}

function redoScenarioChange() {
  if (scenarioRedoStack.length === 0) return;
  scenarioUndoStack.push(JSON.stringify(scenarioProject));
  scenarioProject = JSON.parse(scenarioRedoStack.pop());
  normalizeScenarioProject();
  ensureCustomMonstersRegistered();
  ensureCustomBgmRegistered();
  ensureCustomItemsRegistered(); ensureCustomFishRegistered(); // ★アイテム設定・魚管理で追加・編集したものを念のため最新の状態にしてから使う
  ensureCustomSkillsRegistered(); // ★スキル管理で追加・編集した技を念のため最新の状態にしてから使う
  ensureCustomCompanionsRegistered(); // ★仲間編集で追加・編集した仲間を念のため最新の状態にしてから使う
  ensureCustomClassStatsRegistered(); // ★職業編集で編集した主人公の職業ステータスを念のため最新の状態にしてから使う
  if (typeof applyBuiltinMapAreaOverrides === "function") applyBuiltinMapAreaOverrides(); // adventure.js（マップ設定タブでの編集内容を反映）
  markScenarioBuildDirty();
  updateUndoRedoButtons();
  renderScenarioBuildPanel();
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById("scenariobuild-undo-btn");
  const redoBtn = document.getElementById("scenariobuild-redo-btn");
  if (undoBtn) undoBtn.disabled = scenarioUndoStack.length === 0;
  if (redoBtn) redoBtn.disabled = scenarioRedoStack.length === 0;
}

// ★カスタムの敵・ボスを、実際に戦闘エンジン（battle.js）で使える形にしてMONSTER_MASTERへ登録する。
//   これをやっておかないと、サブ画面で作った敵をテストプレイの戦闘ブロックで呼び出せない
function ensureCustomMonstersRegistered() {
  if (typeof MONSTER_MASTER === "undefined") return; // ★battle.jsの読み込み前（通常は起きない）は何もしない
  
  scenarioProject.enemies.forEach(enemy => {
    MONSTER_MASTER[enemy.id] = {
      name: enemy.name || "名無しの魔物",
      description: enemy.description || "",
      maxHp: Number(enemy.maxHp) || 10,
      atk: Number(enemy.atk) || 5,
      exp: Number(enemy.exp) || 10,
      dropItemId: enemy.dropItemId || null,
      dropRate: Number(enemy.dropRate) || 0,
      killFlavor: enemy.killFlavor || undefined,
      spareFlavor: enemy.spareFlavor || undefined,
      giftItemId: enemy.giftItemId || undefined,
      uniqueSkill: (enemy.uniqueSkill && enemy.uniqueSkill.name) ? enemy.uniqueSkill : undefined,
      imagePath: enemy.imagePath || undefined,
      sizeMultiplier: (typeof enemy.sizeMultiplier === "number" && enemy.sizeMultiplier > 0) ? enemy.sizeMultiplier : undefined,
      statusInflictions: (Array.isArray(enemy.statusInflictions) && enemy.statusInflictions.length > 0) ? enemy.statusInflictions : undefined,
      // ★要望対応：通常攻撃命中時に付ける状態異常（専用スキル発動時のstatusInflictionsとは別設定）
      normalAttackStatusInflictions: (Array.isArray(enemy.normalAttackStatusInflictions) && enemy.normalAttackStatusInflictions.length > 0) ? enemy.normalAttackStatusInflictions : undefined,
      // ★要望対応：この魔物自身の状態異常耐性・無効
      statusImmunities: (Array.isArray(enemy.statusImmunities) && enemy.statusImmunities.length > 0) ? enemy.statusImmunities : undefined,
      statusResistances: (enemy.statusResistances && typeof enemy.statusResistances === "object" && Object.keys(enemy.statusResistances).length > 0) ? enemy.statusResistances : undefined,
      // ★バグ修正：ここに無かったせいで、好感度MAXで魔物図鑑から使える専用スキル（サキュバスの休憩等）が
      //   シナリオデータ読み込みのたびに消えてしまっていた
      restSkillName: enemy.restSkillName || undefined,
      affectionGainRange: Array.isArray(enemy.affectionGainRange) && enemy.affectionGainRange.length === 2 ? enemy.affectionGainRange : undefined,
      restSkillBlocks: (Array.isArray(enemy.restSkillBlocks) && enemy.restSkillBlocks.length > 0) ? enemy.restSkillBlocks : undefined,
      // ★要望対応：見逃した/倒した時の演出をブロックで組み立てられるようにする
      killBlocks: (Array.isArray(enemy.killBlocks) && enemy.killBlocks.length > 0) ? enemy.killBlocks : undefined,
      spareBlocks: (Array.isArray(enemy.spareBlocks) && enemy.spareBlocks.length > 0) ? enemy.spareBlocks : undefined,
      // ★要望対応：属性（複数選択可）と、属性相性を無視するかどうか
      elements: (Array.isArray(enemy.elements) && enemy.elements.length > 0) ? enemy.elements : undefined,
      ignoreElementalAffinity: enemy.ignoreElementalAffinity || undefined
    };
    // ★バグ修正：新しく追加した敵（ボスではない通常の魔物）が、SPAREABLE_KEYS（見逃す/倒すの対象、
    //   魔物図鑑に載る対象）に組み込みの魔物しか入っていなかったせいで、魔物図鑑に載らず、
    //   戦闘中に「見逃すか殺すか」を選ぶこともできなかった。登録のたびに、まだ入っていなければ追加する
    if (typeof SPAREABLE_KEYS !== "undefined" && !SPAREABLE_KEYS.includes(enemy.id)) {
      SPAREABLE_KEYS.push(enemy.id);
      if (typeof monsterAffection !== "undefined" && !(enemy.id in monsterAffection)) monsterAffection[enemy.id] = 0;
      if (typeof discoveredMonsters !== "undefined" && !(enemy.id in discoveredMonsters)) discoveredMonsters[enemy.id] = false;
    }
  });
  
  scenarioProject.bosses.forEach(boss => {
    MONSTER_MASTER[boss.id] = {
      name: boss.name || "名無しのボス",
      description: boss.description || "",
      maxHp: Number(boss.maxHp) || 50,
      atk: Number(boss.atk) || 10,
      exp: Number(boss.exp) || 50,
      dropItemId: boss.dropItemId || null,
      dropRate: Number(boss.dropRate) || 0,
      killFlavor: boss.killFlavor || undefined,
      spareFlavor: boss.spareFlavor || undefined,
      giftItemId: boss.giftItemId || undefined,
      uniqueSkill: (boss.uniqueSkill && boss.uniqueSkill.name) ? boss.uniqueSkill : undefined,
      imagePath: boss.imagePath || undefined,
      sizeMultiplier: (typeof boss.sizeMultiplier === "number" && boss.sizeMultiplier > 0) ? boss.sizeMultiplier : undefined,
      actionsPerTurn: (typeof boss.actionsPerTurn === "number" && boss.actionsPerTurn > 1) ? Math.floor(boss.actionsPerTurn) : undefined, // ★要望対応：1ターンの行動回数（battle.js参照）
      bgmTrack: boss.bgmTrack || undefined,
      bgmFinalTrack: boss.bgmFinalTrack || undefined,
      bgmCrisisTrack: boss.bgmCrisisTrack || undefined,
      invincibilityBreakItemId: boss.invincibilityBreakItemId || undefined, // ★空欄なら undefined＝最初からダメージが通る通常仕様
      level: (typeof boss.level === "number" && boss.level > 0) ? boss.level : undefined, // ★空欄ならundefined＝エリア設定 or 主人公基準のレベルになる（battle.js）
      fixedStats: boss.fixedStats === "on", // ★ONなら、レベルによる自動計算をせず上記のHP・攻撃力・経験値をそのまま使う（battle.js）
      statusInflictions: (Array.isArray(boss.statusInflictions) && boss.statusInflictions.length > 0) ? boss.statusInflictions : undefined,
      // ★要望対応：通常攻撃命中時に付ける状態異常（専用スキル発動時のstatusInflictionsとは別設定）
      normalAttackStatusInflictions: (Array.isArray(boss.normalAttackStatusInflictions) && boss.normalAttackStatusInflictions.length > 0) ? boss.normalAttackStatusInflictions : undefined,
      // ★要望対応：この魔物自身の状態異常耐性・無効
      statusImmunities: (Array.isArray(boss.statusImmunities) && boss.statusImmunities.length > 0) ? boss.statusImmunities : undefined,
      statusResistances: (boss.statusResistances && typeof boss.statusResistances === "object" && Object.keys(boss.statusResistances).length > 0) ? boss.statusResistances : undefined,
      battleEvents: (Array.isArray(boss.battleEvents) && boss.battleEvents.length > 0) ? boss.battleEvents : undefined, // ★ボス管理タブの戦闘イベント（battle.js参照）
      forms: (Array.isArray(boss.forms) && boss.forms.length > 0) ? boss.forms : undefined, // ★要望対応：ボス管理タブの「形態」一覧（battle.js参照）
      // ★要望対応：属性（複数選択可）と、属性相性を無視するかどうか
      elements: (Array.isArray(boss.elements) && boss.elements.length > 0) ? boss.elements : undefined,
      ignoreElementalAffinity: boss.ignoreElementalAffinity || undefined
    };
    if (typeof BOSS_MONSTER_KEYS !== "undefined" && !BOSS_MONSTER_KEYS.includes(boss.id)) {
      BOSS_MONSTER_KEYS.push(boss.id); // ★ボス扱い（BGM切り替え等）にする
      // ★要望対応：魔物図鑑にボスも載るように、まだ無ければ未発見状態を登録しておく
      if (typeof discoveredMonsters !== "undefined" && !(boss.id in discoveredMonsters)) discoveredMonsters[boss.id] = false;
    }
  });
}

// ★BGM設定で登録した「曲名→ファイルパス」を、実際にbgm.jsが曲を探す時に使う対応表(BGM_TRACK_PATHS)へ反映する。
//   これで、登録した曲名をBGMブロックやボス設定のBGM欄にそのまま入力すれば鳴らせるようになる
function ensureCustomBgmRegistered() {
  if (typeof BGM_TRACK_PATHS === "undefined") return;
  scenarioProject.bgmTracks.forEach(entry => {
    if (!entry.name || !entry.path) return;
    // ★バグ修正：ここでの正規化がBGM管理タブ経由の登録専用になっていたため、末尾の拡張子しか
    //   吸収できていなかった。resolveBgmTrackPath側（bgm.js）で直接貼り付けたパスにもかける
    //   正規化と同じ関数（先頭の"/"・"bgm/"・末尾".mp3"を除去）に統一する
    BGM_TRACK_PATHS[entry.name] = typeof normalizeBgmRelativePath === "function"
      ? normalizeBgmRelativePath(entry.path)
      : entry.path.replace(/\.mp3$/i, ""); // ★.mp3を付けて貼られても、付けずに貼られても対応する
    // ★バグ修正：登録が間に合う前に一度再生に失敗し「読み込めない曲」として覚えられてしまっていた場合、
    //   正しいパスが分かった今、その記録を消しておく（でないと二度と再生されないまま）
    if (typeof bgmFailedTracks !== "undefined") bgmFailedTracks.delete(entry.name);
  });
}

// ★ギヴブロックで実際にインベントリへ追加できるように、サブ画面で登録したアイテムをITEM_MASTERへ反映する
// ★アイテム設定で追加・編集したアイテムを ITEM_MASTER に反映する。
//   既存アイテム（items.js由来）を編集した場合は、回復量・薬効などの効果値(params)を消してしまわないよう、
//   既存のデータに「上書き分だけ」を重ねる形にする（丸ごと置き換えない。以前は毎回全部書き換えていたため、
//   既存アイテムを1つでも編集すると武器・防具・薬草などの効果値が全部壊れてしまう不具合があった）
function ensureCustomItemsRegistered() {
  if (typeof ITEM_MASTER === "undefined") return;
  scenarioProject.items.forEach(item => {
    const existing = ITEM_MASTER[item.id] || {};
    ITEM_MASTER[item.id] = {
      ...existing,
      name: item.name || existing.name || "名無しのアイテム",
      category: item.category || existing.category || "material",
      description: item.description != null ? item.description : (existing.description || ""),
      rank: item.rank || existing.rank || "F",
      listedPrice: Number(item.listedPrice) || existing.listedPrice || 0,
      trueValue: Number(item.trueValue) || existing.trueValue || 0,
      // ★詳細設定画面（効果パラメータ）で編集していればそれを優先し、無ければ既存の値を引き継ぐ
      params: (item.params && Object.keys(item.params).length > 0) ? item.params : (existing.params || { 希少度: 1 }),
      // ★武器・防具の「個体差の範囲」。以前はここで反映されておらず、編集しても実際のゲームに一切反映されないバグがあった
      statBonusRange: (item.statBonusRange && typeof item.statBonusRange.min === "number" && typeof item.statBonusRange.max === "number")
        ? item.statBonusRange : existing.statBonusRange,
      unsellable: !!item.unsellable, // ★アイテム管理の「売れない」チェック（town.jsの買取屋で参照する）
      // ★バグ修正：錆びたシリーズ設定（isRustySeries／appraisedName／rustyRankOutcomes）がここで一切
      //   ITEM_MASTERへコピーされておらず、アイテム管理タブで変化先を指定しても実際のサビ取りには反映されず、
      //   いつまでも「（手入れ済み）」への性能揺らぎ直しにフォールバックし続けてしまっていた
      isRustySeries: (typeof item.isRustySeries === "boolean") ? item.isRustySeries : !!existing.isRustySeries,
      appraisedName: item.appraisedName || existing.appraisedName,
      rustyRankOutcomes: (item.rustyRankOutcomes && Object.keys(item.rustyRankOutcomes).length > 0) ? item.rustyRankOutcomes : existing.rustyRankOutcomes,
      // ★要望対応：インベントリでのスタック可否（装備以外）。未指定ならカテゴリ既定値にお任せするため、
      //   明示的にtrue/falseが設定されている時だけ上書きする
      stackable: (typeof item.stackable === "boolean") ? item.stackable : existing.stackable,
      // ★要望対応：武器・防具に持たせる専用スキル（特殊スキル編集と同じブロック形式で組める）。
      //   scenarioProject.items側ではitem.blocks/item.variablesという名前（特殊スキル編集の画面をそのまま使い回すため）
      //   だが、battle.js側から見て紛らわしくないよう、ここでskillBlocks/skillVariablesという名前に変えて渡す。
      //   skillActivationMode："passive"＝常時発動（毎ターン自動）／それ以外＝任意発動（戦闘中に「武器スキル」を選んだ時だけ）
      skillBlocks: (Array.isArray(item.blocks) && item.blocks.length > 0) ? item.blocks : undefined,
      skillVariables: (item.variables && typeof item.variables === "object") ? item.variables : undefined,
      skillActivationMode: item.skillActivationMode === "passive" ? "passive" : "active",
      skillName: item.skillName || undefined,
      // ★要望対応：アイテム編集の（釣竿）（釣り餌）チェック。fishing.jsがこれらのフラグを見て、
      //   釣り施設の「釣竿を変える」「釣り餌を変える」の候補に出す
      isFishingRod: (typeof item.isFishingRod === "boolean") ? item.isFishingRod : !!existing.isFishingRod,
      rodDurability: item.isFishingRod ? (Number(item.rodDurability) || existing.rodDurability || 20) : existing.rodDurability,
      rodPower: item.isFishingRod ? (Number(item.rodPower) || existing.rodPower || 3) : existing.rodPower,
      isFishingBait: (typeof item.isFishingBait === "boolean") ? item.isFishingBait : !!existing.isFishingBait,
      // ★baitFishType（旧・単一文字列）からbaitFishTypes（複数選択の配列）へ移行。
      //   古いセーブ・古いアイテムデータにbaitFishTypeしか無い場合はそれを配列化して引き継ぐ
      baitFishTypes: item.isFishingBait ? normalizeBaitFishTypes(item.baitFishTypes, item.baitFishType, existing.baitFishTypes) : existing.baitFishTypes,
      baitBiteRate: item.isFishingBait ? (Number(item.baitBiteRate) || existing.baitBiteRate || 5) : existing.baitBiteRate
    };
  });
}

// ★釣り餌の「釣れる魚の種類」チェックボックスの選択肢を、登録済みの魚（ITEM_MASTER内のcategory:"fish"）
//   の「種類」から重複無しで集める。組み込みの魚（items.js）・魚管理タブで追加したカスタムの魚の両方が対象
function getRegisteredFishTypeOptions() {
  if (typeof ITEM_MASTER === "undefined") return [];
  const types = new Set();
  Object.values(ITEM_MASTER).forEach(master => {
    if (master && master.category === "fish" && master.fishType) types.add(master.fishType);
  });
  return Array.from(types).sort().map(type => ({ value: type, label: type }));
}

// ★baitFishTypes（配列・新形式）／baitFishType（文字列・旧形式）／既存値のどれから採用するかをまとめる
function normalizeBaitFishTypes(newArrayValue, legacyStringValue, fallbackArrayValue) {
  if (Array.isArray(newArrayValue)) return newArrayValue.filter(Boolean); // ★UI側は常に配列を渡してくるので、空配列（未選択＝全種類対象）もそのまま採用する
  if (typeof legacyStringValue === "string" && legacyStringValue) return [legacyStringValue];
  return Array.isArray(fallbackArrayValue) ? fallbackArrayValue : [];
}

// ★要望対応：魚管理タブ（scenarioProject.fishItems）で追加・編集した魚を ITEM_MASTER に反映する。
//   アイテムと同じ扱い（category:"fish"）でインベントリに入り、水色の文字色で表示される（mainfunc.js／style.css）。
//   fishPower/fishHp/fishSize/fishType は釣りミニゲーム（fishing.js）が直接参照する
function ensureCustomFishRegistered() {
  if (typeof ITEM_MASTER === "undefined") return;
  if (!Array.isArray(scenarioProject.fishItems)) scenarioProject.fishItems = [];
  scenarioProject.fishItems.forEach(fish => {
    const existing = ITEM_MASTER[fish.id] || {};
    ITEM_MASTER[fish.id] = {
      ...existing,
      name: fish.name || existing.name || "名無しの魚",
      category: "fish",
      description: fish.description != null ? fish.description : (existing.description || ""),
      rank: fish.rank || existing.rank || "F", // ★魚管理タブでは「レア度」として表示する
      listedPrice: Number(fish.listedPrice) || existing.listedPrice || 0,
      trueValue: Number(fish.trueValue) || existing.trueValue || 0,
      fishType: fish.fishType || existing.fishType || "", // ★釣り餌の「釣れる魚の種類」と突き合わせる文字列
      fishPower: Number(fish.power) || existing.fishPower || 3, // ★強さ（釣りミニゲームでの1秒ごとの攻撃力）
      fishHp: Number(fish.hp) || existing.fishHp || 15, // ★体力
      fishSize: Number(fish.size) || existing.fishSize || 10, // ★大きさ
      params: {
        種類: fish.fishType || "",
        強さ: Number(fish.power) || 3,
        大きさ: Number(fish.size) || 10,
        レア度: fish.rank || "F",
        体力: Number(fish.hp) || 15
      }
    };
  });
}

// ★スキル管理タブで追加・編集・並び替え・削除した技（scenarioProject.skills）を、
//   実際にゲームが参照するCLASS_SKILLSへ組み直す。フラットに持っている項目から
//   statusEffect/statusEffect2/selfBuffの入れ子オブジェクトを再構築する
function ensureCustomSkillsRegistered() {
  if (typeof CLASS_SKILLS === "undefined") return;
  Object.keys(CLASS_SKILLS).forEach(className => {
    const entries = scenarioProject.skills
      .filter(s => s.className === className)
      .sort((a, b) => a.unlockLevel - b.unlockLevel);
    
    CLASS_SKILLS[className] = entries.map(s => {
      const skill = {
        name: s.name || "名無しの技",
        description: s.description || "",
        type: s.type || "attack",
        element: s.element || "無",
        spCost: Number(s.spCost) || 0,
        unlockLevel: Number(s.unlockLevel) || 1,
        power: Number(s.power) || 0
      };
      if (s.type === "attack") skill.atkType = s.atkType === "magical" ? "magical" : "physical"; // ★参照する攻撃力（物理／魔法）
      if (s.skillId) skill.id = s.skillId;
      if (s.target === "all") skill.target = "all";
      if (Number(s.hitCount) > 1) skill.hitCount = Number(s.hitCount);
      if (s.gauge) skill.gauge = s.gauge;
      if (s.cleanse) skill.cleanse = true;
      if (s.passiveId) skill.passiveId = s.passiveId;
      if (s.randomTarget) skill.randomTarget = true; // ★狙う相手を選ばせず、生きている敵の中からランダムに選ぶ（例：ニート「一か八か」）
      if (s.wideVariance) skill.wideVariance = true; // ★ダメージの揺らぎ幅を大きくする「賭け」の技（例：ニート「一か八か」）
      if (s.partyWide) skill.partyWide = true; // ★回復技の対象を選ばせず、自分＋生きている仲間全員にする（例：ハイ・ディスシプリナ）
      if (s.lifestealRatio) skill.lifestealRatio = Number(s.lifestealRatio); // ★与えたダメージの一部をHPに変換する（例：血臭の宴）
      if (s.revives) skill.revives = true; // ★戦闘不能の仲間を選ぶと蘇生させられる（例：完全支援）
      if (s.triggerChance != null && Number(s.triggerChance) < 1) skill.triggerChance = Number(s.triggerChance); // ★自己バフ技が、指定した確率でしか発動しない（例：ニート「豹変」）
      if (s.statusEffectKind) {
        skill.statusEffect = { kind: s.statusEffectKind, chance: Number(s.statusEffectChance) || 1, duration: Number(s.statusEffectDuration) || 1, power: Number(s.statusEffectPower) || 0 };
      }
      if (s.statusEffect2Kind) {
        skill.statusEffect2 = { kind: s.statusEffect2Kind, chance: Number(s.statusEffect2Chance) || 1, duration: Number(s.statusEffect2Duration) || 1, power: Number(s.statusEffect2Power) || 0 };
      }
      if (s.selfBuffKind) {
        skill.selfBuff = { kind: s.selfBuffKind, duration: Number(s.selfBuffDuration) || 1, power: Number(s.selfBuffPower) || 0, mode: s.selfBuffMode === "multiply" ? "multiply" : "add" };
      }
      if (s.selfBuff2Kind) {
        skill.selfBuff2 = { kind: s.selfBuff2Kind, duration: Number(s.selfBuff2Duration) || 1, power: Number(s.selfBuff2Power) || 0, mode: s.selfBuff2Mode === "multiply" ? "multiply" : "add" };
      }
      // ★特殊スキル編集でブロックを組んだ技は、そのブロック列（と専用変数の初期値）をそのまま持たせる。
      //   battle.js側は skill.blocks.length > 0 を見て、固定フィールドの代わりにこちらを実行する。
      //   要望対応：以前はブロックを1件でも登録すると自動的にブロックモードへ切り替わり、固定フィールドへ
      //   二度と戻せなくなっていた。s.useBlocksで明示的にどちらを使うか選べるようにし、falseの時は
      //   ブロックが残っていても無視して固定フィールドの技として動くようにする（ブロック自体は消さずに
      //   保持するので、後でまた「ブロックで組む」に戻せば編集内容は失われない）
      const useBlockMode = s.useBlocks === true || (s.useBlocks == null && Array.isArray(s.blocks) && s.blocks.length > 0);
      if (useBlockMode && Array.isArray(s.blocks) && s.blocks.length > 0) {
        skill.blocks = s.blocks;
        skill.variables = (s.variables && typeof s.variables === "object") ? s.variables : {};
      }
      return skill;
    });
  });
}

// ★仲間編集タブで追加・編集した仲間（scenarioProject.companions）を、実際にゲームが参照するCOMPANION_MASTERへ組み直す
function ensureCustomCompanionsRegistered() {
  if (typeof COMPANION_MASTER === "undefined") return;
  Object.keys(COMPANION_MASTER).forEach(key => delete COMPANION_MASTER[key]); // ★削除された仲間を残さないよう、一旦空にしてから組み直す
  const statKeys = ["maxHp", "maxSp", "atk", "agi", "skillPower", "luck", "charm"];
  scenarioProject.companions.forEach(c => {
    const baseStats = {}, growthPerLevel = {};
    statKeys.forEach(key => {
      baseStats[key] = Number(c.baseStats && c.baseStats[key]) || 0;
      growthPerLevel[key] = Number(c.growthPerLevel && c.growthPerLevel[key]) || 0;
    });
    COMPANION_MASTER[c.id] = {
      name: c.name || "名無しの仲間", description: c.description || "",
      class: c.class || "全能士", initialWeaponId: c.initialWeaponId || "",
      // ★要望対応：武器だけでなく防具・盾も、加入時の初期装備として指定できるようにする
      initialArmorId: c.initialArmorId || "", initialShieldId: c.initialShieldId || "",
      baseStats, growthPerLevel,
      // ★装備できる武器の種類を制限する（空＝無制限）。equipItemForCompanion()（player.js）で参照する
      allowedWeaponTypes: Array.isArray(c.allowedWeaponTypes) ? c.allowedWeaponTypes.slice() : []
    };
  });
}

// ★職業編集タブで編集した主人公の職業別ステータス（scenarioProject.classStats）を、
//   実際にゲームが参照するCLASS_MASTERへ書き戻す
// ★以前は「既存の職業名にだけ反映する（職業自体は増減できない）」という制限があったが、
//   要望により職業の追加・削除ができるようにしたため、この制限を撤廃した
function ensureCustomClassStatsRegistered() {
  if (typeof CLASS_MASTER === "undefined") return;
  const statKeys = ["maxHp", "maxSp", "atk", "agi", "skillPower", "luck", "charm"];
  Object.keys(scenarioProject.classStats).forEach(className => {
    const c = scenarioProject.classStats[className];
    const baseStats = {}, growthPerLevel = {};
    statKeys.forEach(key => {
      baseStats[key] = Number(c.baseStats && c.baseStats[key]) || 0;
      growthPerLevel[key] = Number(c.growthPerLevel && c.growthPerLevel[key]) || 0;
    });
    growthPerLevel.maxFatigue = Number(c.growthPerLevel && c.growthPerLevel.maxFatigue) || 0;
    growthPerLevel.maxSleepiness = Number(c.growthPerLevel && c.growthPerLevel.maxSleepiness) || 0; // ★レベルアップで眠気上限も上がるようにする（要望対応）
    CLASS_MASTER[className] = {
      description: c.description || (CLASS_MASTER[className] && CLASS_MASTER[className].description) || "",
      type: c.type === "advanced" || c.type === "master" ? c.type : "normal", // ★通常職／上級職／天職（要望対応）
      unlockFlagName: c.unlockFlagName || "", // ★上級職・天職を役場に出すために必要な解放フラグ名
      baseStats, maxSleepiness: Number(c.maxSleepiness) || 100, maxFatigue: Number(c.maxFatigue) || 100,
      growthPerLevel,
      // ★装備できる武器の種類を制限する（空＝無制限）。equipItem()（player.js）で参照する
      allowedWeaponTypes: Array.isArray(c.allowedWeaponTypes) ? c.allowedWeaponTypes.slice() : []
    };
    // ★新しく追加した職業には、まだ技（CLASS_SKILLS）の枠が無いので、空配列を用意しておく
    //   （これが無いと、スキル管理タブにこの職業が出てこない）
    if (typeof CLASS_SKILLS !== "undefined" && !CLASS_SKILLS[className]) CLASS_SKILLS[className] = [];
  });
}

// ===== フラグ（scenariobuild.jsのフラグブロックで使う、簡易なon/off変数） =====
const SCENARIOBUILD_FLAGS_KEY = "demoge_scenario_flags";
let scenarioFlags = {};

function loadScenarioFlags() {
  try {
    const raw = localStorage.getItem(SCENARIOBUILD_FLAGS_KEY);
    scenarioFlags = raw ? JSON.parse(raw) : {};
  } catch (e) {
    scenarioFlags = {};
  }
}

function saveScenarioFlags() {
  try {
    localStorage.setItem(SCENARIOBUILD_FLAGS_KEY, JSON.stringify(scenarioFlags));
  } catch (e) {
    console.error("フラグの保存に失敗しました", e);
  }
}

function setScenarioFlag(name, value) {
  if (!name) return;
  scenarioFlags[name] = value;
  saveScenarioFlags();
}

// ===== ゲーム変数（要望対応：好感度スキル等の話ブロックで、フラグ（on/off）だけでなく
//   数値の「変数」も参照・比較・設定できるようにする。特殊スキル編集のskill.variablesとは別物で、
//   話の中でフラグと同じ感覚で自由な名前を付けて使える、話全体で共有の数値ストレージ） =====
const SCENARIOBUILD_VARIABLES_KEY = "demoge_scenario_variables";
let scenarioVariables = {};

function loadScenarioVariables() {
  try {
    const raw = localStorage.getItem(SCENARIOBUILD_VARIABLES_KEY);
    scenarioVariables = raw ? JSON.parse(raw) : {};
  } catch (e) {
    scenarioVariables = {};
  }
}

function saveScenarioVariables() {
  try {
    localStorage.setItem(SCENARIOBUILD_VARIABLES_KEY, JSON.stringify(scenarioVariables));
  } catch (e) {
    console.error("変数の保存に失敗しました", e);
  }
}

function getScenarioVariable(name) {
  if (!name) return 0;
  const v = scenarioVariables[name];
  return typeof v === "number" ? v : 0; // ★まだ一度も設定されていない変数は0扱い
}

function setScenarioVariable(name, value) {
  if (!name) return;
  scenarioVariables[name] = Number(value) || 0;
  saveScenarioVariables();
}

// ===== モードの開閉 =====
// ★要望対応：シナリオエディタを開いている間、裏で本編（広場の選択肢・マップ選択など）が
//   キー操作に反応して動いてしまわないようにするためのフラグ。
//   本編側の各キー操作ハンドラの先頭で、これがtrueなら何もせず抜けるようにしてある
let isScenarioBuildOverlayOpen = false;

function openScenarioBuildMode() {
  isScenarioBuildOverlayOpen = true;
  const overlay = document.getElementById("scenariobuild-overlay");
  if (!overlay) return;
  // ★先にオーバーレイ自体は必ず開いておく。これより後ろでどこか1箇所が例外を投げても、
  //   「ボタンを押しても画面が何も変わらない（＝開けていないように見える）」という一番わかりにくい
  //   状態にはならず、少なくとも枠は開いた上でエラー内容を画面内に表示できるようにする
  overlay.classList.remove("hidden");
  try {
    loadCustomScenarioData();
    scenarioBuildMainView = "list";
    scenarioBuildEditingChapterId = null;
    scenarioBuildEditingMapAreaId = null;
    scenarioBuildInsertMenuIndex = null;
    scenarioUndoStack = [];
    scenarioRedoStack = [];
    scenarioBuildHasUnsavedChanges = false; // ★開いた直後は「ブラウザに保存済みの状態」からスタートする
    updateUndoRedoButtons();
    updateScenarioBuildSaveButton();
    renderScenarioBuildPanel();
  } catch (e) {
    console.error("シナリオエディタの表示中にエラーが発生しました", e);
    const mainEl = document.getElementById("scenariobuild-main");
    if (mainEl) {
      mainEl.innerHTML = "";
      const errEl = document.createElement("p");
      errEl.className = "devmode-note";
      errEl.style.color = "#ff8080";
      errEl.textContent = "シナリオエディタの表示中にエラーが発生しました。ブラウザの開発者ツール（F12）のConsoleタブに詳細が出ています。内容: " + (e && e.message ? e.message : String(e));
      mainEl.appendChild(errEl);
    }
  }
}

function closeScenarioBuildMode() {
  isScenarioBuildOverlayOpen = false;
  const overlay = document.getElementById("scenariobuild-overlay");
  if (overlay) overlay.classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", () => {
  const closeBtn = document.getElementById("scenariobuild-close-btn");
  const undoBtn = document.getElementById("scenariobuild-undo-btn");
  const redoBtn = document.getElementById("scenariobuild-redo-btn");
  const saveBtn = document.getElementById("scenariobuild-save-btn");
  if (undoBtn) undoBtn.onclick = (event) => { event.stopPropagation(); undoScenarioChange(); };
  if (redoBtn) redoBtn.onclick = (event) => { event.stopPropagation(); redoScenarioChange(); };
  if (saveBtn) saveBtn.onclick = (event) => { event.stopPropagation(); commitScenarioBuildSave(); };
  // ★保存は手動（💾ボタン）のみ。「ゲームに戻る」を押した時に未保存の変更が残っていたら、
  //   保存し忘れたまま戻ってブラウザを閉じてしまう…という事故を防ぐため一言確認する
  if (closeBtn) closeBtn.onclick = async (event) => {
    event.stopPropagation();
    if (scenarioBuildHasUnsavedChanges) {
      const ok = await showGameConfirm("まだブラウザに保存していない変更があります。保存せずにゲームに戻りますか？\n（「いいえ」を選ぶと、保存せずに編集を続けられます）");
      if (!ok) return;
    }
    closeScenarioBuildMode();
  };
});

// ★シナリオビルドを開いたまま未保存の変更がある状態でタブを閉じよう/リロードしようとした時、
//   ブラウザ標準の確認ダイアログ（「このページを離れますか？」）を出す最後の砦
window.addEventListener("beforeunload", (event) => {
  const overlay = document.getElementById("scenariobuild-overlay");
  const isOpen = overlay && !overlay.classList.contains("hidden");
  if (isOpen && scenarioBuildHasUnsavedChanges) {
    event.preventDefault();
    event.returnValue = "";
  }
});

// ★左（メイン）＝話一覧／ブロックエディタ、右（サブ）＝キャラ・敵・ボス・アイテム・BGM・データ管理。
//   ゲームの画面構成（メイン画面／サブ画面）と同じ考え方で、常に両方が見えている状態にする。
//   これらエディタ自身のタブは常に全部表示される（非表示切替は無い）。「タブ管理」はこのエディタの
//   タブではなく、プレイヤーがこのシナリオを遊ぶ時の画面タブの方を管理する（バグ修正で変更）
const SCENARIOBUILD_SUB_TABS = [
  { view: "characters", label: "キャラ管理" },
  { view: "enemies", label: "敵設定" },
  { view: "bosses", label: "ボス設定" },
  { view: "items", label: "アイテム設定" },
  { view: "fishmgmt", label: "魚管理" }, // ★要望対応：釣り場で釣れる魚の追加・編集
  { view: "quests", label: "クエスト管理" },
  { view: "achievements", label: "実績管理" }, // ★要望対応：便利タブの「実績」アイコンから見られる実績の作成・編集
  { view: "tutorials", label: "チュートリアル管理" },
  { view: "skills", label: "スキル管理" },
  { view: "statuses", label: "状態管理" },
  { view: "flags", label: "フラグ管理" },
  { view: "gamevars", label: "ゲーム変数管理" }, // ★要望対応：話ブロックのifで参照できる数値変数の管理タブ（システム変数一覧の「変数一覧」とは別物）
  { view: "recipes", label: "レシピ管理" },
  { view: "randomnames", label: "ランダム名前管理" }, // ★要望対応：オークションNPC等のランダム名前バリエーション管理
  { view: "elements", label: "属性管理" }, // ★要望対応：属性一覧と属性相性表
  { view: "loginbonus", label: "ログボ報酬" }, // ★要望対応：ログインボーナス（7日分の報酬編集）
  { view: "companionchat", label: "会話AI設定" }, // ★要望対応：仲間との会話（Gemini API連携）の二つ名・パーティ名・性格編集
  { view: "companions", label: "仲間編集" },
  { view: "classes", label: "職業編集" },
  { view: "bgm", label: "BGM設定" },
  { view: "maps", label: "マップ設定" },
  { view: "facilities", label: "施設編集" },
  { view: "portraits", label: "立ち絵管理" },
  { view: "endings", label: "エンディング一覧" },
  { view: "variables", label: "変数一覧" }, // ★要望対応：式の中で使えるシステム変数の名前が分かるよう、サブ画面に一覧を出す
  { view: "data", label: "データ管理" },
  { view: "tabmanager", label: "タブ管理" } // ★バグ修正：中身はプレイ画面タブ（メイン/インベントリ/スキル…）の管理に変更した
];

// ★要望対応：以前はここでシナリオエディタ自身の右側タブ（キャラ管理・敵設定…）の表示/非表示を
//   管理していたが、本来やりたかったのは「このシナリオをプレイする時の画面タブ（メイン/インベントリ/
//   スキル…）」の方の管理だったため、PLAY_SCREEN_TAB_DEFS（settings.js）を対象にするよう修正した。
//   判定自体はisScenarioPlayTabEnabled()（settings.js）に一本化してあるので、ここでは編集用の
//   書き込みヘルパーだけ持つ
function setScenarioPlayTabEnabled(tabId, enabled) {
  if (!scenarioProject.scenarioBuildTabVisibility || typeof scenarioProject.scenarioBuildTabVisibility !== "object") {
    scenarioProject.scenarioBuildTabVisibility = {};
  }
  scenarioProject.scenarioBuildTabVisibility[tabId] = enabled;
}

function renderScenarioBuildPanel() {
  updateUndoRedoButtons();
  ensureSharedDatalistsInOverlay();
  renderScenarioBuildMain();
  renderScenarioBuildSub();
}

// ★曲名／魔物ID／アイテムID／キャラ名の入力候補（datalist）は、複数のブロックや左右のペインから
//   同時に参照される可能性があるため、id重複を避けてオーバーレイ直下に1セットだけ置き、
//   再描画のたびに中身だけ最新化する
function ensureSharedDatalistsInOverlay() {
  const overlay = document.getElementById("scenariobuild-overlay");
  if (!overlay) return;
  [buildBgmDatalist, buildBgmFileDatalist, buildMonsterDatalist, buildBossOnlyDatalist, buildItemDatalist, buildFishDatalist, buildCharacterDatalist].forEach(builder => {
    const fresh = builder();
    const existing = document.getElementById(fresh.id);
    if (existing) existing.remove();
    overlay.appendChild(fresh);
  });
}

function renderScenarioBuildMain() {
  const container = document.getElementById("scenariobuild-main");
  if (!container) return;
  container.innerHTML = "";
  if (scenarioBuildMainView === "editor") {
    renderScenarioBlockEditor(container);
  } else if (scenarioBuildMainView === "maps") {
    renderMapAreaFullList(container);
  } else if (scenarioBuildMainView === "mapEditor") {
    renderMapAreaEditor(container);
  } else if (scenarioBuildMainView === "optionEditor") {
    renderChoiceOptionEditor(container);
  } else if (scenarioBuildMainView === "ifEditor") {
    renderIfConditionsEditor(container);
  } else if (scenarioBuildMainView === "ifBranchEditor") {
    renderIfBranchEditor(container);
  } else if (scenarioBuildMainView === "skillIfEditor") {
    renderSkillIfEditor(container);
  } else if (scenarioBuildMainView === "skillIfBranchEditor") {
    renderSkillIfBranchEditor(container);
  } else if (scenarioBuildMainView === "enemyFlavorEditor") {
    renderEnemyFlavorEditor(container);
  } else if (scenarioBuildMainView === "bossEventListEditor") {
    renderBossEventListEditor(container);
  } else if (scenarioBuildMainView === "bossEventBlockEditor") {
    renderBossEventBlockEditor(container);
  } else if (scenarioBuildMainView === "bossFormListEditor") {
    renderBossFormListEditor(container);
  } else if (scenarioBuildMainView === "entityEditor") {
    renderEntityDetailEditor(container);
  } else if (scenarioBuildMainView === "statuses") {
    renderStatusMainList(container);
  } else if (scenarioBuildMainView === "skillBlockEditor") {
    renderSkillBlockEditor(container);
  } else {
    renderScenarioBuildList(container);
  }
}

function renderScenarioBuildSub() {
  const tabsEl = document.getElementById("scenariobuild-sub-tabs");
  const bodyEl = document.getElementById("scenariobuild-sub-content");
  if (!tabsEl || !bodyEl) return;
  const visibleTabs = SCENARIOBUILD_SUB_TABS; // ★エディタ自身のタブは常に全て表示する（非表示切替は廃止。「タブ管理」はプレイ画面タブの方を管理する）
  if (!visibleTabs.some(tab => tab.view === scenarioBuildSubView)) {
    scenarioBuildSubView = visibleTabs[0] ? visibleTabs[0].view : "characters";
  }
  
  tabsEl.innerHTML = "";
  visibleTabs.forEach(tab => {
    const btn = document.createElement("button");
    btn.className = "devmode-btn scenariobuild-tab-btn" + (scenarioBuildSubView === tab.view ? " scenariobuild-tab-btn-active" : "");
    btn.textContent = tab.label;
    btn.onclick = (event) => {
      event.stopPropagation();
      scenarioBuildSubView = tab.view;
      if (tab.view === "maps") {
        scenarioBuildMainView = "maps"; // ★マップ設定タブを開いたら、メイン側もインタラクティブな地図画面に切り替える
        renderScenarioBuildPanel();
      } else if (tab.view === "statuses") {
        scenarioBuildMainView = "statuses"; // ★状態管理タブを開いたら、メイン側に状態異常/強化の一覧を出す
        renderScenarioBuildPanel();
      } else {
        renderScenarioBuildSub();
      }
    };
    tabsEl.appendChild(btn);
  });
  
  bodyEl.innerHTML = "";
  
  if (scenarioBuildSubView === "characters") renderEntityManager(bodyEl, getCharacterManagerConfig());
  else if (scenarioBuildSubView === "enemies") renderEntityManager(bodyEl, getEnemyManagerConfig());
  else if (scenarioBuildSubView === "bosses") { renderTrialGuardianConfig(bodyEl); renderFameThresholdConfig(bodyEl); renderEntityManager(bodyEl, getBossManagerConfig()); }
  else if (scenarioBuildSubView === "items") renderEntityManager(bodyEl, getItemManagerConfig());
  else if (scenarioBuildSubView === "fishmgmt") renderEntityManager(bodyEl, getFishManagerConfig());
  else if (scenarioBuildSubView === "quests") renderEntityManager(bodyEl, getQuestManagerConfig());
  else if (scenarioBuildSubView === "loginbonus") renderLoginBonusManager(bodyEl); // ★要望対応：ログインボーナス
  else if (scenarioBuildSubView === "companionchat") renderCompanionChatSettingsManager(bodyEl); // ★要望対応：会話AI設定
  else if (scenarioBuildSubView === "achievements") renderEntityManager(bodyEl, getAchievementManagerConfig());
  else if (scenarioBuildSubView === "tutorials") renderEntityManager(bodyEl, getTutorialManagerConfig());
  else if (scenarioBuildSubView === "skills") renderSkillManager(bodyEl);
  else if (scenarioBuildSubView === "statuses") renderStatusManager(bodyEl);
  else if (scenarioBuildSubView === "flags") renderFlagManager(bodyEl);
  else if (scenarioBuildSubView === "gamevars") renderVariableManager(bodyEl);
  else if (scenarioBuildSubView === "recipes") renderRecipeManager(bodyEl);
  else if (scenarioBuildSubView === "randomnames") renderRandomNameManager(bodyEl);
  else if (scenarioBuildSubView === "elements") renderElementManager(bodyEl);
  else if (scenarioBuildSubView === "companions") renderCompanionManager(bodyEl);
  else if (scenarioBuildSubView === "classes") renderClassStatsManager(bodyEl);
  else if (scenarioBuildSubView === "bgm") renderEntityManager(bodyEl, getBgmManagerConfig());
  else if (scenarioBuildSubView === "maps") renderMapAreaManager(bodyEl);
  else if (scenarioBuildSubView === "facilities") renderFacilityManager(bodyEl);
  else if (scenarioBuildSubView === "portraits") renderPortraitManager(bodyEl);
  else if (scenarioBuildSubView === "endings") renderEndingListManager(bodyEl);
  else if (scenarioBuildSubView === "variables") renderSkillVariableReference(bodyEl); // ★要望対応
  else if (scenarioBuildSubView === "data") renderDataManager(bodyEl);
  else if (scenarioBuildSubView === "tabmanager") renderScenarioBuildTabManager(bodyEl);
}

// ===================================================================
// ===== 変数一覧（要望対応：式の中で使えるシステム変数の名前が分からないので一覧を出してほしい） =====
// ===================================================================
// ★要望対応：このシナリオをプレイする時の画面タブ（メイン/インベントリ/スキル/仲間/会話/強さ/装備/
//   便利/ログ/設定）を、タブごとに有効／無効にできる。ここでOFFにしたタブは、プレイヤー自身の
//   個人設定（設定タブの「プレイ画面のタブ管理」）でONにしていても表示されない（settings.js側で判定）
function renderScenarioBuildTabManager(container) {
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "このシナリオをプレイする時に、下部の「サブ画面」に出すタブを選べます（シナリオエディタ自身の右側タブとは無関係です）。ここでOFFにしたタブは、プレイヤーが自分の設定でONにしていても表示されません。「会話」タブは、会話AI設定でキャラクターを用意していない場合は意味が無いため、デフォルトではOFFにしています。";
  container.appendChild(introEl);
  
  const rows = document.createElement("div");
  rows.className = "scenariobuild-list";
  container.appendChild(rows);
  
  PLAY_SCREEN_TAB_DEFS.forEach(tab => {
    const row = document.createElement("label");
    row.className = "scenariobuild-condition-row";
    row.style.justifyContent = "space-between";
    row.style.gap = "12px";
    
    const label = document.createElement("span");
    label.textContent = tab.label;
    row.appendChild(label);
    
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isScenarioPlayTabEnabled(tab.id);
    checkbox.onchange = () => {
      setScenarioPlayTabEnabled(tab.id, checkbox.checked);
      if (typeof saveCustomScenarioData === "function") saveCustomScenarioData();
      renderScenarioBuildPanel();
    };
    row.appendChild(checkbox);
    rows.appendChild(row);
  });
}

function renderSkillVariableReference(container) {
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "技のブロック編集（if・ダメージ・回復・HP/SP増減・状態異常・変数を設定・くり返し回数など、式が入力できる場所ならどこでも）で使える名前の一覧です。";
  container.appendChild(introEl);
  
  const buildTable = (title, rows) => {
    const heading = document.createElement("h4");
    heading.textContent = title;
    container.appendChild(heading);
    rows.forEach(([name, desc]) => {
      const row = document.createElement("div");
      row.className = "scenariobuild-condition-row";
      const nameEl = document.createElement("code");
      nameEl.className = "scenariobuild-variable-name";
      nameEl.textContent = name;
      row.appendChild(nameEl);
      const descEl = document.createElement("span");
      descEl.textContent = desc;
      row.appendChild(descEl);
      container.appendChild(row);
    });
  };
  
  buildTable("読み書きどちらもできる変数（setVariableで代入すると、実際の値が書き換わります）", [
    ["自分HP割合", "主人公の現在HP ÷ 最大HP（0〜1の実数）"],
    ["自分SP割合", "主人公の現在SP ÷ 最大SP（0〜1の実数）"],
    ["敵HP割合", "対象の敵の現在HP ÷ 最大HP（ダメージ・状態異常ブロックなど、敵を対象にする場面でのみ使えます）"],
    ["眠気", "主人公の眠気ゲージの現在値"],
    ["疲労", "主人公の疲労ゲージの現在値"],
    ["所持金", "現在の所持金（陳）"],
    ["経過日数", "転移してから経過した日数"],
    ["ターン数", "今の戦闘の経過ターン数"]
  ]);
  
  buildTable("読み取り専用の変数（計算し直される値なので、代入はできません）", [
    ["自分レベル", "主人公の現在レベル"],
    ["自分攻撃力", "装備・強化込みの、今の攻撃力"],
    ["自分魔力", "装備・強化込みの、今の魔力"],
    ["技威力", "今使っている技自身の威力（skill.power）"],
    ["乱数", "0以上100未満のランダムな実数。式を評価するたびに新しく引き直されます"]
  ]);
  
  const funcHeading = document.createElement("h4");
  funcHeading.textContent = "使える関数";
  container.appendChild(funcHeading);
  const funcRandRow = document.createElement("div");
  funcRandRow.className = "scenariobuild-condition-row";
  const funcRandName = document.createElement("code");
  funcRandName.className = "scenariobuild-variable-name";
  funcRandName.textContent = "randbuild(最小,最大)";
  funcRandRow.appendChild(funcRandName);
  const funcRandDesc = document.createElement("span");
  funcRandDesc.textContent = "指定した範囲（両端を含む整数）のランダムな値を返す。例：randbuild(1,10)";
  funcRandRow.appendChild(funcRandDesc);
  container.appendChild(funcRandRow);
  const funcFlagRow = document.createElement("div");
  funcFlagRow.className = "scenariobuild-condition-row";
  const funcFlagName = document.createElement("code");
  funcFlagName.className = "scenariobuild-variable-name";
  funcFlagName.textContent = "flag(フラグ名)";
  funcFlagRow.appendChild(funcFlagName);
  const funcFlagDesc = document.createElement("span");
  funcFlagDesc.textContent = "そのフラグが立っていれば1、立っていなければ0を返す（フラグ名はカッコの中に、引用符なしでそのまま書く）";
  funcFlagRow.appendChild(funcFlagDesc);
  container.appendChild(funcFlagRow);
  
  // ★要望対応：仲間HP割合／仲間SP割合の説明を追加
  [["仲間HP割合(1 または 名前)", "パーティ内の仲間のHP割合。仲間HP割合(1)で1人目、仲間HP割合(レト)のように名前でも指定できる"],
   ["仲間SP割合(1 または 名前)", "同じくSP割合。書き方は仲間HP割合と同じ"]].forEach(([name, desc]) => {
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    const nameEl = document.createElement("code");
    nameEl.className = "scenariobuild-variable-name";
    nameEl.textContent = name;
    row.appendChild(nameEl);
    const descEl = document.createElement("span");
    descEl.textContent = desc;
    row.appendChild(descEl);
    container.appendChild(row);
  });
  
  // ★要望対応：仲間の最大 HP/SP、レベル、攻撃力、防御力を追加
  [["仲間最大 HP(1 または 名前)", "パーティ内の仲間の最大 HP。仲間最大 HP(1) で 1 人目、仲間最大 HP(レト) のように名前でも指定できる"],
   ["仲間最大 SP(1 または 名前)", "同じく最大 SP。書き方は仲間最大 HP と同じ"],
   ["仲間レベル (1 または 名前)", "仲間の現在レベル"],
   ["仲間攻撃力 (1 または 名前)", "仲間の攻撃力（装備・強化込み）"],
   ["仲間防御力 (1 または 名前)", "仲間の防御力（素早さパラメータ）"]].forEach(([name, desc]) => {
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    const nameEl = document.createElement("code");
    nameEl.className = "scenariobuild-variable-name";
    nameEl.textContent = name;
    row.appendChild(nameEl);
    const descEl = document.createElement("span");
    descEl.textContent = desc;
    row.appendChild(descEl);
    container.appendChild(row);
  });
  
  // ★実際に今のシナリオで登録されているフラグも、flag(フラグ名)にそのまま使える名前として一覧に出しておく
  if (Array.isArray(scenarioProject.flagDefs) && scenarioProject.flagDefs.length > 0) {
    buildTable("今のシナリオに登録されているフラグ（flag(フラグ名)にそのまま使えます）",
      scenarioProject.flagDefs.map(d => [d.name, d.description || "（説明未入力）"]));
  }
  
  const customNoteEl = document.createElement("p");
  customNoteEl.className = "devmode-note";
  customNoteEl.textContent = "上記以外の名前をsetVariableで指定した場合は、一時的な変数として扱われます（その技の実行中だけ使え、実行が終わると消えます。実際のゲームの値には影響しません）。";
  container.appendChild(customNoteEl);
}


// ===================================================================
// ===== 話の一覧 =====
// ===================================================================
function chapterMatchesSelectedArc(chapter) {
  if (scenarioBuildSelectedArcId === "__all__") return true;
  if (scenarioBuildSelectedArcId === "__none__") return !chapter.arcId;
  return chapter.arcId === scenarioBuildSelectedArcId;
}

// ★要望対応：話リストの一番上に章ごとのタブを出す。追加・削除・切り替えができる
function buildScenarioArcTabsBar() {
  const wrap = document.createElement("div");
  wrap.className = "scenariobuild-arc-tabs-wrap";
  
  const tabsRow = document.createElement("div");
  tabsRow.className = "scenariobuild-arc-tabs";
  
  const makeTab = (id, label, count) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "scenariobuild-arc-tab" + (scenarioBuildSelectedArcId === id ? " active" : "");
    btn.textContent = `${label}（${count}）`;
    btn.onclick = (event) => {
      event.stopPropagation();
      scenarioBuildSelectedArcId = id;
      renderScenarioBuildPanel();
    };
    return btn;
  };
  
  tabsRow.appendChild(makeTab("__all__", "全て", scenarioProject.chapters.length));
  const noneCount = scenarioProject.chapters.filter(c => !c.arcId).length;
  tabsRow.appendChild(makeTab("__none__", "未分類", noneCount));
  (scenarioProject.chapterArcs || []).forEach(arc => {
    const count = scenarioProject.chapters.filter(c => c.arcId === arc.id).length;
    tabsRow.appendChild(makeTab(arc.id, arc.name || "（名称未設定）", count));
  });
  
  const addArcBtn = document.createElement("button");
  addArcBtn.type = "button";
  addArcBtn.className = "scenariobuild-arc-tab scenariobuild-arc-tab-add";
  addArcBtn.textContent = "＋章を追加";
  addArcBtn.onclick = (event) => {
    event.stopPropagation();
    const name = window.prompt("新しい章の名前を入力してください", "");
    if (name === null) return; // ★キャンセル
    const trimmed = name.trim();
    if (!trimmed) return;
    pushUndoSnapshot();
    if (!Array.isArray(scenarioProject.chapterArcs)) scenarioProject.chapterArcs = [];
    const newArc = { id: generateId("arc"), name: trimmed };
    scenarioProject.chapterArcs.push(newArc);
    scenarioBuildSelectedArcId = newArc.id;
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  tabsRow.appendChild(addArcBtn);
  wrap.appendChild(tabsRow);
  
  // ★実際の章タブを選んでいる時だけ、その章の名前変更・削除を出す
  const selectedArc = (scenarioProject.chapterArcs || []).find(a => a.id === scenarioBuildSelectedArcId);
  if (selectedArc) {
    const manageRow = document.createElement("div");
    manageRow.className = "scenariobuild-arc-manage-row";
    
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "scenariobuild-title-input";
    nameInput.value = selectedArc.name;
    nameInput.onchange = () => {
      selectedArc.name = nameInput.value.trim() || selectedArc.name;
      markScenarioBuildDirty();
      renderScenarioBuildPanel();
    };
    manageRow.appendChild(nameInput);
    
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "devmode-btn devmode-btn-danger";
    deleteBtn.textContent = "この章を削除";
    deleteBtn.onclick = (event) => {
      event.stopPropagation();
      if (!window.confirm(`「${selectedArc.name}」を削除しますか？\n（中の話は削除されず、「未分類」に戻ります）`)) return;
      pushUndoSnapshot();
      scenarioProject.chapters.forEach(c => { if (c.arcId === selectedArc.id) c.arcId = null; });
      scenarioProject.chapterArcs = scenarioProject.chapterArcs.filter(a => a.id !== selectedArc.id);
      scenarioBuildSelectedArcId = "__all__";
      markScenarioBuildDirty();
      renderScenarioBuildPanel();
    };
    manageRow.appendChild(deleteBtn);
    wrap.appendChild(manageRow);
  }
  
  return wrap;
}

function renderScenarioBuildList(container) {
  const introEl = document.createElement("p");
  container.appendChild(introEl);
  
  container.appendChild(buildScenarioArcTabsBar());
  
  const addRow = document.createElement("div");
  addRow.className = "scenariobuild-add-row";
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.placeholder = "新しい話のタイトル";
  titleInput.className = "scenariobuild-title-input";
  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "話を追加";
  const submitNewChapter = () => {
    const title = titleInput.value.trim();
    if (!title) return;
    pushUndoSnapshot();
    const defaultRequired = scenarioProject.chapters.length > 0 ? scenarioProject.chapters.length : null;
    // ★要望対応：章タブを選んでいる状態で追加すると、その章に自動で入る
    const newArcId = (scenarioBuildSelectedArcId !== "__all__" && scenarioBuildSelectedArcId !== "__none__") ? scenarioBuildSelectedArcId : null;
    scenarioProject.chapters.push({
      id: generateId("custom"), title, cleared: false,
      builtin: false, requiredChapterNumber: defaultRequired, blocks: [], arcId: newArcId
    });
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  addBtn.onclick = (event) => { event.stopPropagation(); submitNewChapter(); };
  titleInput.addEventListener("keydown", (event) => { if (event.key === "Enter") submitNewChapter(); });
  addRow.appendChild(titleInput);
  addRow.appendChild(addBtn);
  container.appendChild(addRow);
  
  const listEl = document.createElement("div");
  listEl.className = "scenariobuild-list";
  let visibleCount = 0;
  scenarioProject.chapters.forEach((chapter, index) => {
    if (!chapterMatchesSelectedArc(chapter)) return;
    visibleCount++;
    listEl.appendChild(buildScenarioChapterRow(chapter, index));
  });
  if (visibleCount === 0) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "devmode-note";
    emptyEl.textContent = "この章にはまだ話がありません。上の「章：」欄で話を割り当てるか、新しく追加してください。";
    listEl.appendChild(emptyEl);
  }
  container.appendChild(listEl);
}

function buildScenarioChapterRow(chapter, index) {
  const row = document.createElement("div");
  row.className = "scenariobuild-chapter-row" + (chapter.builtin ? " scenariobuild-chapter-row-builtin" : "");
  
  const handleEl = document.createElement("span");
  handleEl.className = "scenariobuild-drag-handle";
  handleEl.textContent = "☰";
  if (!chapter.builtin) {
    // ★バグ修正：話タイトルの入力欄内の文字選択までドラッグ扱いになっていたのを、☰ハンドルだけに絞って直す
    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      row.classList.add("scenariobuild-drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("scenariobuild-drag-over"));
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      row.classList.remove("scenariobuild-drag-over");
      if (scenarioChapterDragFromIndex === null || scenarioChapterDragFromIndex === index) return;
      dropCustomScenarioChapter(scenarioChapterDragFromIndex, index);
      scenarioChapterDragFromIndex = null;
    });
    handleEl.draggable = true;
    handleEl.addEventListener("dragstart", (event) => {
      event.dataTransfer.effectAllowed = "move";
      if (event.dataTransfer.setDragImage) event.dataTransfer.setDragImage(row, 0, 0);
      row.classList.add("scenariobuild-dragging");
      scenarioChapterDragFromIndex = index;
    });
    handleEl.addEventListener("dragend", () => row.classList.remove("scenariobuild-dragging"));
  }
  
  const numberEl = document.createElement("span");
  numberEl.className = "scenariobuild-chapter-number";
  numberEl.textContent = chapter.isInterlude ? "閑話" : `第${index + 1}話`;
  
  const infoEl = document.createElement("div");
  infoEl.className = "scenariobuild-chapter-info";
  
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "scenariobuild-title-input";
  titleInput.value = chapter.title;
  titleInput.onchange = () => { chapter.title = titleInput.value.trim() || chapter.title; markScenarioBuildDirty(); };
  
  // ★あらすじ：進行度パネル（便利タブ）で、クリア済みの話を選ぶとここで書いた文章が読めるようにする。
  //   プレイには一切影響しない、メモ・振り返り用の項目
  const synopsisArea = document.createElement("textarea");
  synopsisArea.className = "scenariobuild-textarea scenariobuild-synopsis-textarea";
  synopsisArea.placeholder = "あらすじ（任意。進行度パネルで、この話をクリアした後に読めます）";
  synopsisArea.value = chapter.synopsis || "";
  synopsisArea.onchange = () => { chapter.synopsis = synopsisArea.value; markScenarioBuildDirty(); };
  
  // ★実装チェック：オフにすると、まだ編集中でも実際のプレイ（自動発生・目標表示・「今すぐ開始」ボタン）には出てこなくなる。
  //   シナリオエディタ内でのテストプレイ（下の「テストプレイ」ボタン）は、オフのままでも確認用に使える
  const enabledRow = document.createElement("label");
  enabledRow.className = "scenariobuild-condition-row";
  enabledRow.style.cursor = "pointer";
  const enabledCheckbox = document.createElement("input");
  enabledCheckbox.type = "checkbox";
  enabledCheckbox.checked = chapter.enabled !== false; // ★未設定（既存データ）は実装済み扱いにする
  enabledCheckbox.onchange = () => { chapter.enabled = enabledCheckbox.checked; markScenarioBuildDirty(); renderScenarioBuildPanel(); };
  enabledRow.appendChild(enabledCheckbox);
  enabledRow.appendChild(document.createTextNode(" 実装済み（オフ＝編集中。実際のプレイには出てこない）"));
  
  const conditionRow = document.createElement("div");
  conditionRow.className = "scenariobuild-condition-multi";
  
  // ① 前の話をクリアしていること
  const chapterCondRow = document.createElement("div");
  chapterCondRow.className = "scenariobuild-condition-row";
  chapterCondRow.appendChild(labelSpan("この話をクリア："));
  const chapterSelect = document.createElement("select");
  chapterSelect.className = "scenariobuild-jump-select";
  const noneOption = document.createElement("option");
  noneOption.value = "";
  noneOption.textContent = "（条件なし）";
  chapterSelect.appendChild(noneOption);
  scenarioProject.chapters.forEach(c => {
    if (c.id === chapter.id) return;
    const option = document.createElement("option");
    option.value = c.id;
    option.textContent = c.title;
    chapterSelect.appendChild(option);
  });
  chapterSelect.value = chapter.requiredChapterId || "";
  chapterSelect.onchange = () => { chapter.requiredChapterId = chapterSelect.value || null; markScenarioBuildDirty(); };
  chapterCondRow.appendChild(chapterSelect);
  conditionRow.appendChild(chapterCondRow);
  
  // ② ランクがn以上
  const rankCondRow = document.createElement("div");
  rankCondRow.className = "scenariobuild-condition-row";
  rankCondRow.appendChild(labelSpan("ランクが以上："));
  const rankSelect = document.createElement("select");
  rankSelect.className = "scenariobuild-jump-select";
  const rankNoneOption = document.createElement("option");
  rankNoneOption.value = "";
  rankNoneOption.textContent = "（条件なし）";
  rankSelect.appendChild(rankNoneOption);
  (typeof RANK_ORDER !== "undefined" ? RANK_ORDER : ["F", "E", "D", "C", "B", "A", "S"]).forEach(rank => {
    const option = document.createElement("option");
    option.value = rank;
    option.textContent = rank;
    rankSelect.appendChild(option);
  });
  rankSelect.value = chapter.requiredRank || "";
  rankSelect.onchange = () => { chapter.requiredRank = rankSelect.value || null; markScenarioBuildDirty(); };
  rankCondRow.appendChild(rankSelect);
  conditionRow.appendChild(rankCondRow);
  
  // ③ 進行度がn以上
  const progressCondRow = document.createElement("div");
  progressCondRow.className = "scenariobuild-condition-row";
  progressCondRow.appendChild(labelSpan("進行度が以上："));
  const progressInput = document.createElement("input");
  progressInput.type = "number";
  progressInput.min = "0";
  progressInput.className = "scenariobuild-condition-input";
  progressInput.placeholder = "なし";
  progressInput.value = chapter.requiredProgress || "";
  progressInput.onchange = () => {
    const value = parseInt(progressInput.value, 10);
    chapter.requiredProgress = (!value || value <= 0) ? null : value;
    markScenarioBuildDirty();
  };
  progressCondRow.appendChild(progressInput);
  conditionRow.appendChild(progressCondRow);
  
  // ④ 経過日数がn日以上
  const daysCondRow = document.createElement("div");
  daysCondRow.className = "scenariobuild-condition-row";
  daysCondRow.appendChild(labelSpan("経過日数が以上："));
  const daysInput = document.createElement("input");
  daysInput.type = "number";
  daysInput.min = "0";
  daysInput.className = "scenariobuild-condition-input";
  daysInput.placeholder = "なし";
  daysInput.value = chapter.requiredDays || "";
  daysInput.onchange = () => {
    const value = parseInt(daysInput.value, 10);
    chapter.requiredDays = (!value || value <= 0) ? null : value;
    markScenarioBuildDirty();
  };
  daysCondRow.appendChild(daysInput);
  conditionRow.appendChild(daysCondRow);
  
  // ⑤ 指定したフラグが立っていること
  const flagCondRow = document.createElement("div");
  flagCondRow.className = "scenariobuild-condition-row";
  flagCondRow.appendChild(labelSpan("フラグが立っている："));
  const flagInput = document.createElement("input");
  flagInput.type = "text";
  flagInput.className = "scenariobuild-title-input";
  flagInput.placeholder = "なし";
  flagInput.value = chapter.requiredFlag || "";
  flagInput.onchange = () => { chapter.requiredFlag = flagInput.value.trim() || null; markScenarioBuildDirty(); };
  flagCondRow.appendChild(flagInput);
  conditionRow.appendChild(flagCondRow);
  
  // ⑥ 開始トリガー（酒場の主人と話した時／指定したエリアのn回目に来た時）※第一話・第二話は専用の入口があるため対象外
  if (!chapter.builtin) {
    const triggerCondRow = document.createElement("div");
    triggerCondRow.className = "scenariobuild-condition-row";
    triggerCondRow.appendChild(labelSpan("始まるきっかけ："));
    const triggerSelect = document.createElement("select");
    triggerSelect.className = "scenariobuild-jump-select";
    [
      { value: "tavern", label: "酒場の主人と話した時" },
      { value: "areaVisit", label: "指定したエリアに来た時" }
    ].forEach(opt => {
      const option = document.createElement("option");
      option.value = opt.value;
      option.textContent = opt.label;
      triggerSelect.appendChild(option);
    });
    // ★旧データ（townArrival固定）は、選択肢としては「指定したエリアに来た時（カリの村・1回目）」に読み替える
    const normalizedTrigger = chapter.startTrigger === "townArrival" ? "areaVisit" : (chapter.startTrigger || "tavern");
    triggerSelect.value = normalizedTrigger;
    triggerSelect.onchange = () => {
      chapter.startTrigger = triggerSelect.value;
      if (triggerSelect.value === "areaVisit" && !chapter.startTriggerAreaKey) chapter.startTriggerAreaKey = "village";
      markScenarioBuildDirty();
      renderScenarioBuildPanel();
    };
    triggerCondRow.appendChild(triggerSelect);
    conditionRow.appendChild(triggerCondRow);
    
    if (normalizedTrigger === "tavern") {
      // ★要望対応：どの酒場施設で話しかけた時かを指定できるようにする（未設定＝どの酒場でもOK）
      const tavernRow = document.createElement("div");
      tavernRow.className = "scenariobuild-condition-row";
      tavernRow.appendChild(labelSpan("　対象の酒場："));
      const tavernSelect = document.createElement("select");
      tavernSelect.className = "scenariobuild-jump-select";
      const anyOpt = document.createElement("option");
      anyOpt.value = "";
      anyOpt.textContent = "（指定なし：どの酒場でもOK）";
      tavernSelect.appendChild(anyOpt);
      const villageOpt = document.createElement("option");
      villageOpt.value = "tavern";
      villageOpt.textContent = "村の酒場";
      tavernSelect.appendChild(villageOpt);
      scenarioProject.facilities.filter(f => f.type === "tavern").forEach(f => {
        const opt = document.createElement("option");
        opt.value = "facility_" + f.id;
        opt.textContent = f.name || "（名称未設定の酒場）";
        tavernSelect.appendChild(opt);
      });
      tavernSelect.value = chapter.startTriggerTavernKey || "";
      tavernSelect.onchange = () => { chapter.startTriggerTavernKey = tavernSelect.value || null; markScenarioBuildDirty(); };
      tavernRow.appendChild(tavernSelect);
      conditionRow.appendChild(tavernRow);
    }
    
    if (normalizedTrigger === "areaVisit") {
      const areaRow = document.createElement("div");
      areaRow.className = "scenariobuild-condition-row";
      areaRow.appendChild(labelSpan("　対象のエリア："));
      const areaSelect = document.createElement("select");
      areaSelect.className = "scenariobuild-jump-select";
      scenarioProject.mapAreas.forEach(a => {
        const option = document.createElement("option");
        // ★バグ修正：カスタム（拠点以外の自作）エリアは a.locationKey を持たないため、
        //   そのまま使うと全カスタムエリアの値が文字列"undefined"で衝突し、
        //   選び直しても保存・リロード後に必ず先頭のエリアに戻ってしまっていた。
        //   実際のゲーム側（adventure.jsのenterAdventureLocation）と同じフォールバック規則に合わせる
        const key = a.locationKey || ("custom_" + a.id);
        option.value = key;
        option.textContent = a.name || key;
        areaSelect.appendChild(option);
      });
      areaSelect.value = (chapter.startTrigger === "townArrival") ? "village" : (chapter.startTriggerAreaKey || "village");
      areaSelect.onchange = () => { chapter.startTrigger = "areaVisit"; chapter.startTriggerAreaKey = areaSelect.value; markScenarioBuildDirty(); };
      areaRow.appendChild(areaSelect);
      conditionRow.appendChild(areaRow);
      
      const visitNumRow = document.createElement("div");
      visitNumRow.className = "scenariobuild-condition-row";
      visitNumRow.appendChild(labelSpan("　何回目に来た時か："));
      const visitNumInput = document.createElement("input");
      visitNumInput.type = "number";
      visitNumInput.min = "1";
      visitNumInput.className = "scenariobuild-condition-input";
      visitNumInput.value = (chapter.startTrigger === "townArrival") ? 1 : (chapter.startTriggerVisitNumber || 1);
      visitNumInput.onchange = () => { chapter.startTrigger = "areaVisit"; chapter.startTriggerVisitNumber = Math.max(1, Number(visitNumInput.value) || 1); markScenarioBuildDirty(); };
      visitNumRow.appendChild(visitNumInput);
      visitNumRow.appendChild(labelSpan("回目"));
      conditionRow.appendChild(visitNumRow);
    }
  }
  
  // ★この話が始まるまで、画面に出しておく目標（タスク）表示。例：「酒場の店主に話しかけよう。」
  // ★以前は「始まるきっかけ」と同じ if (!chapter.builtin) の中にあったため、
  //   第一話・第二話（builtin: true）では目標表示の入力欄自体が出せず、書けなかった。
  //   目標表示は開始トリガーの有無に関係なく（専用の入口から始まる第一話・第二話でも）使うものなので、外に出す
  const objectiveRow = document.createElement("div");
  objectiveRow.className = "scenariobuild-condition-row";
  objectiveRow.appendChild(labelSpan("この話が始まるまでの目標表示（空欄なら何も表示しない）："));
  const objectiveInput = document.createElement("input");
  objectiveInput.type = "text";
  objectiveInput.className = "scenariobuild-title-input";
  objectiveInput.placeholder = "例：酒場の店主に話しかけよう。";
  objectiveInput.value = chapter.objectiveText || "";
  objectiveInput.onchange = () => { chapter.objectiveText = objectiveInput.value; markScenarioBuildDirty(); };
  objectiveRow.appendChild(objectiveInput);
  conditionRow.appendChild(objectiveRow);
  
  const conditionNote = document.createElement("p");
  conditionNote.className = "devmode-note scenariobuild-condition";
  conditionNote.textContent = "設定した条件は全て満たす必要があります（空欄の条件は無視されます）。条件を満たすと、上で選んだきっかけのタイミングで話が自動的に始まります（第一話・第二話は今まで通り専用の入口から始まります）。";
  conditionRow.appendChild(conditionNote);
  
  const clearedLabel = document.createElement("label");
  clearedLabel.className = "scenariobuild-cleared-label";
  const clearedCheckbox = document.createElement("input");
  clearedCheckbox.type = "checkbox";
  // ★要望対応：本当にクリア済み（chapter.cleared）か、テストプレイ用に一時的にクリア済み扱いにしているか
  //   （scenarioTestClearedChapterIds）のどちらかがtrueならチェックを入れて見せる
  //   （scenarioTestUnclearedChapterIdsに入っていれば、それより優先して外れた状態で見せる）
  clearedCheckbox.checked = isChapterEffectivelyCleared(chapter);
  clearedCheckbox.onchange = () => {
    // ★要望対応：ここでchapter.clearedそのものは一切書き換えない。あくまでこのタブを開いている間だけの
    //   一時的な上書き（scenarioTestClearedChapterIds／scenarioTestUnclearedChapterIds）を出し入れするだけ
    //   なので、markScenarioBuildDirty()も呼ばない＝「💾保存」しても、テストプレイ用のこのチェックは
    //   絶対に保存されない
    if (clearedCheckbox.checked) {
      scenarioTestUnclearedChapterIds.delete(chapter.id); // ★ONにする時は「未クリア扱い」の上書きを解除
      scenarioTestClearedChapterIds.add(chapter.id);
      // ★チェックを入れた話より前にある話は、普通にプレイしていれば当然クリア済みのはずなので、
      //   テストプレイ用にまとめてクリア済み扱いにする時は、それより前の話も一緒にクリア済みにする
      scenarioProject.chapters.slice(0, index).forEach(c => {
        scenarioTestUnclearedChapterIds.delete(c.id);
        scenarioTestClearedChapterIds.add(c.id);
      });
    } else {
      scenarioTestClearedChapterIds.delete(chapter.id);
      // ★バグ修正：chapter.cleared が本当にtrueの話は、Setから消すだけではチェックが外れなかった。
      //   本当のクリア状態には触れず、テストプレイ用に「未クリア扱い」として上書きしておく
      if (chapter.cleared) {
        scenarioTestUnclearedChapterIds.add(chapter.id);
      } else {
        scenarioTestUnclearedChapterIds.delete(chapter.id);
      }
    }
    renderScenarioBuildPanel(); // ★前の話のチェックボックスの見た目にも即座に反映する
  };
  clearedLabel.appendChild(clearedCheckbox);
  clearedLabel.append(" テストプレイ用：クリア済み扱いにする（一時的なもので保存はされません）");
  
  // ★「閑話」として、話数のカウントに含めず（一覧では「閑話」と表示）、他の話の間に挟み込めるようにする。
  //   挟む位置自体は、一覧のドラッグ＆ドロップ（☰）で自由に並び替えられる
  let interludeLabel = null;
  if (!chapter.builtin) {
    interludeLabel = document.createElement("label");
    interludeLabel.className = "scenariobuild-cleared-label";
    const interludeCheckbox = document.createElement("input");
    interludeCheckbox.type = "checkbox";
    interludeCheckbox.checked = !!chapter.isInterlude;
    interludeCheckbox.onchange = () => { chapter.isInterlude = interludeCheckbox.checked; markScenarioBuildDirty(); renderScenarioBuildPanel(); };
    interludeLabel.appendChild(interludeCheckbox);
    interludeLabel.append(" 閑話にする（第N話として数えず、一覧で「閑話」と表示。他の話の間には一覧のドラッグ＆ドロップで挟めます）");
  }
  
  infoEl.appendChild(titleInput);
  
  // ★要望対応：この話がどの章に属するかを、ここで直接切り替えられるようにする
  const arcRow = document.createElement("div");
  arcRow.className = "scenariobuild-condition-row";
  arcRow.appendChild(labelSpan("章："));
  const arcSelect = document.createElement("select");
  arcSelect.className = "scenariobuild-jump-select";
  const arcNoneOption = document.createElement("option");
  arcNoneOption.value = "";
  arcNoneOption.textContent = "（未分類）";
  arcSelect.appendChild(arcNoneOption);
  (scenarioProject.chapterArcs || []).forEach(arc => {
    const option = document.createElement("option");
    option.value = arc.id;
    option.textContent = arc.name || "（名称未設定）";
    arcSelect.appendChild(option);
  });
  arcSelect.value = chapter.arcId || "";
  arcSelect.onchange = () => {
    chapter.arcId = arcSelect.value || null;
    markScenarioBuildDirty();
    renderScenarioBuildPanel(); // ★今見ている章タブから外れたら一覧から消えるので、即座に再描画する
  };
  arcRow.appendChild(arcSelect);
  infoEl.appendChild(arcRow);
  
  infoEl.appendChild(synopsisArea);
  infoEl.appendChild(enabledRow);
  infoEl.appendChild(conditionRow);
  infoEl.appendChild(clearedLabel);
  if (interludeLabel) infoEl.appendChild(interludeLabel);
  const blockCountEl = document.createElement("p");
  blockCountEl.className = "devmode-note scenariobuild-condition";
  blockCountEl.textContent = `ブロック数：${chapter.blocks.length}` + (chapter.builtin && chapter.blocks.length === 0 ? "（0のままなら元のシナリオ本体がそのまま使われます）" : "");
  infoEl.appendChild(blockCountEl);
  
  const buttonsEl = document.createElement("div");
  buttonsEl.className = "scenariobuild-chapter-buttons";
  
  const upBtn = document.createElement("button");
  upBtn.className = "devmode-btn";
  upBtn.textContent = "▲";
  upBtn.disabled = chapter.builtin || index === 0 || scenarioProject.chapters[index - 1].builtin;
  upBtn.onclick = (event) => { event.stopPropagation(); moveCustomScenarioChapter(index, -1); };
  
  const downBtn = document.createElement("button");
  downBtn.className = "devmode-btn";
  downBtn.textContent = "▼";
  downBtn.disabled = chapter.builtin || index === scenarioProject.chapters.length - 1;
  downBtn.onclick = (event) => { event.stopPropagation(); moveCustomScenarioChapter(index, 1); };
  
  const editBtn = document.createElement("button");
  editBtn.className = "devmode-btn";
  editBtn.textContent = "編集";
  editBtn.title = chapter.builtin ? "ブロックを1つでも追加すると、実際のゲームでも元の本編の代わりにそちらが使われるようになります" : "";
  editBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildMainView = "editor";
    scenarioBuildEditingChapterId = chapter.id;
    scenarioBuildInsertMenuIndex = null;
    renderScenarioBuildPanel();
  };
  
  const seedBtn = document.createElement("button");
  seedBtn.className = "devmode-btn";
  seedBtn.textContent = "元の本編を書き起こす";
  seedBtn.title = "scenario.js/scenario2.jsの元のセリフを、そのままブロックとして書き込みます";
  const seedFn = chapter.id === "builtin_chapter1" ? (typeof buildChapter1SeedBlocks === "function" && buildChapter1SeedBlocks)
    : chapter.id === "builtin_chapter2" ? (typeof buildChapter2SeedBlocks === "function" && buildChapter2SeedBlocks)
    : null;
  const showSeedBtn = chapter.builtin && chapter.blocks.length === 0 && !!seedFn;
  seedBtn.onclick = async (event) => {
    event.stopPropagation();
    const ok = await showGameConfirm(`「${chapter.title}」の元のセリフを、ブロックとして書き起こします。よろしいですか？`);
    if (!ok || !seedFn) return;
    pushUndoSnapshot();
    chapter.blocks = seedFn();
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "devmode-btn devmode-btn-danger";
  deleteBtn.textContent = "削除";
  deleteBtn.onclick = async (event) => {
    event.stopPropagation();
    const ok = await showGameConfirm(`「${chapter.title}」を削除しますか？（元に戻せません）`);
    if (!ok) return;
    pushUndoSnapshot();
    if (chapter.builtin && !scenarioProject.deletedBuiltinIds.chapters.includes(chapter.id)) {
      scenarioProject.deletedBuiltinIds.chapters.push(chapter.id); // ★これが無いと、次回開いた時に自動で復活してしまう
    }
    scenarioProject.chapters.splice(index, 1);
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  
  // ★いまの進行状況で、この話の開始条件をもう満たしているかどうかを表示し、満たしていればその場ですぐ始められるボタンを出す
  //   （わざわざ酒場で話しかけたり街に着いたりし直さなくても、条件を満たした話をここから直接確認・開始できる）
  let startNowBtn = null;
  if (!isChapterEffectivelyCleared(chapter) && chapter.blocks.length > 0 && evaluateChapterUnlockConditions(chapter)) {
    startNowBtn = document.createElement("button");
    startNowBtn.className = "devmode-btn scenariobuild-condition-met-btn";
    startNowBtn.textContent = "✓ 条件達成中：今すぐ開始";
    startNowBtn.title = "現在の進行状況で、この話の開始条件をすでに満たしています。押すとすぐにこの話を開始します。";
    startNowBtn.onclick = (event) => { event.stopPropagation(); runScenarioChapterTestPlay(chapter); };
  }
  
  buttonsEl.appendChild(upBtn);
  buttonsEl.appendChild(downBtn);
  buttonsEl.appendChild(editBtn);
  if (showSeedBtn) buttonsEl.appendChild(seedBtn);
  if (startNowBtn) buttonsEl.appendChild(startNowBtn);
  buttonsEl.appendChild(deleteBtn);
  
  row.appendChild(handleEl);
  row.appendChild(numberEl);
  row.appendChild(infoEl);
  row.appendChild(buttonsEl);
  return row;
}

function moveCustomScenarioChapter(index, direction) {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= scenarioProject.chapters.length) return;
  if (scenarioProject.chapters[targetIndex].builtin) return;
  pushUndoSnapshot();
  const temp = scenarioProject.chapters[index];
  scenarioProject.chapters[index] = scenarioProject.chapters[targetIndex];
  scenarioProject.chapters[targetIndex] = temp;
  markScenarioBuildDirty();
  renderScenarioBuildPanel();
}

// ★三本線ハンドルのドラッグ&ドロップによる並び替え（組み込みの話をまたぐ移動は無視する）
let scenarioChapterDragFromIndex = null;
let scenarioBuildSelectedArcId = "__all__"; // ★話管理の章タブ："__all__"=全て、"__none__"=未分類、それ以外は章のid
let scenarioEntityDragFromIndex = null; // ★クエスト・アイテム等の一覧（renderEntityManager）の並び替え用
// ★要望対応：一覧の各項目を折りたためるようにする（config.collapsible === true の一覧のみ対象。実績管理タブなど）。
//   展開中のIDだけをここに記録する（＝ここに無いIDはデフォルトで折りたたみ状態として表示する）
let scenarioBuildExpandedEntityIds = new Set();
function dropCustomScenarioChapter(fromIndex, toIndex) {
  if (scenarioProject.chapters[fromIndex].builtin || scenarioProject.chapters[toIndex].builtin) return;
  pushUndoSnapshot();
  const [moved] = scenarioProject.chapters.splice(fromIndex, 1);
  scenarioProject.chapters.splice(toIndex, 0, moved);
  markScenarioBuildDirty();
  renderScenarioBuildPanel();
}

// ===================================================================
// ===== ブロックエディタ =====
// ===================================================================

const SCENARIO_BLOCK_TYPES = {
  dialogue: "会話",
  narration: "地の文",
  telop: "テロップ",
  bgm: "BGM切り替え",
  bgmstop: "BGMを止める",
  se: "効果音",
  flag: "フラグ",
  setvar: "変数を設定（数値）",
  changeparam: "パラメータ変更（HP/SP等）",
  bossRemoveInvincibility: "【ボス演出】無敵を解除する",
  bossSummonAlly: "【ボス演出】仲間を呼ぶ（魔物を1体増援参戦させる）",
  bossHeal: "【ボス演出】自分のHPを回復する（割合指定）",
  bossUseSkill: "【ボス演出】特定の技を撃つ",
  give: "ギヴ（アイテム付与）",
  takeitem: "アイテム消費",
  battle: "通常戦闘",
  bossbattle: "ボス戦闘",
  choice: "選択肢",
  effect: "演出",
  background: "背景変更",
  classselect: "職業選択（第一話専用）",
  setrank: "二つ名設定",
  gameover: "ゲームオーバー",
  ending: "エンディング",
  clearchapter: "話クリア設定",
  if: "IF（条件分岐）",
  jump: "指定ブロックへジャンプ",
  addcompanion: "仲間追加",
  removecompanion: "仲間離脱",
  portrait_show: "立ち絵表示/非表示",
  portrait_expression: "立ち絵：表情変更",
  portrait_move: "立ち絵：移動",
  portrait_motion: "立ち絵：動き",
  increment_area_visit: "エリア来訪回数を増やす"
};

function getEditingChapter() {
  return scenarioProject.chapters.find(c => c.id === scenarioBuildEditingChapterId) || null;
}

function renderScenarioBlockEditor(container) {
  const chapter = getEditingChapter();
  if (!chapter) {
    scenarioBuildMainView = "list";
    renderScenarioBuildPanel();
    return;
  }
  
  const backBtn = document.createElement("button");
  backBtn.className = "devmode-btn";
  backBtn.textContent = "← 話の一覧に戻る";
  backBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildMainView = "list";
    scenarioBuildEditingChapterId = null;
    renderScenarioBuildPanel();
  };
  container.appendChild(backBtn);
  
  const titleEl = document.createElement("h3");
  titleEl.textContent = `「${chapter.title}」のブロック`;
  container.appendChild(titleEl);
  
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "上から順番に実行されます。ブロックとブロックの間の「＋」から、その位置に新しいブロックを差し込めます。「選択肢」「戦闘」は分岐先ブロックを個別に指定できます（未指定なら次のブロックに進みます）。";
  container.appendChild(introEl);
  
  const listEl = document.createElement("div");
  listEl.className = "scenariobuild-block-list";
  
  listEl.appendChild(buildBlockInsertSlot(chapter, 0)); // ★一番上の挿入スロット（ブロックが0個の時はこれだけ表示される）
  chapter.blocks.forEach((block, index) => {
    listEl.appendChild(buildScenarioBlockRow(chapter, block, index));
    listEl.appendChild(buildBlockInsertSlot(chapter, index + 1));
  });
  
  container.appendChild(listEl);
}

// ===================================================================
// ===== メイン画面：選択肢の内容エディタ（専用全画面。scenarioBuildMainView === "optionEditor"） =====
// ===================================================================
// ★選択肢ブロックの各選択肢は、飛び先を指定するのではなく、それぞれが自分だけの内容（blocks）を持つ。
//   ここではその内容を、話のブロックエディタと全く同じ操作感で編集できる（実体はchapter.blocksではなく
//   option.blocksという別の配列だが、buildBlockInsertSlot等は「.blocksを持つ何か」しか見ていないので、
//   { blocks: option.blocks } という仮の器（fakeChapter）を渡すだけでそのまま使い回せる）
// ★選択肢の中（option.blocks）に、さらに選択肢が入れ子になっているケースも含めて、
//   話の中から指定IDのブロックを探し出す（話の直下だけでなく、何段ネストしていても見つけられる）
function findBlockDeepInChapter(chapter, blockId) {
  function search(blocksArray) {
    for (const b of blocksArray) {
      if (b.id === blockId) return b;
      if (b.type === "choice") {
        for (const opt of b.options) {
          if (Array.isArray(opt.blocks) && opt.blocks.length > 0) {
            const found = search(opt.blocks);
            if (found) return found;
          }
        }
      }
      if (b.type === "if") {
        if (Array.isArray(b.trueBlocks) && b.trueBlocks.length > 0) {
          const found = search(b.trueBlocks);
          if (found) return found;
        }
        if (Array.isArray(b.falseBlocks) && b.falseBlocks.length > 0) {
          const found = search(b.falseBlocks);
          if (found) return found;
        }
      }
    }
    return null;
  }
  return search(chapter.blocks);
}

// ★バグ修正：好感度スキル等（敵の演出ブロック。restSkillBlocks／killBlocks／spareBlocks）の中にあるifブロックの
//   「編集」を押しても、renderIfConditionsEditor／renderIfBranchEditorがscenarioProject.chaptersの中からしか
//   チャプターを探しておらず、敵の演出ブロックは仮のチャプターID（"enemyflavor_"+敵ID）を使っているため
//   見つからず、即座に画面が閉じてしまっていた（話の中のif・選択肢の中のifはチャプター本体のIDを使い回す
//   作りなので影響なし。敵の演出ブロックだけがこの抜け穴に該当していた）。
//   ここでscenarioBuildEditingIfRef.chapterIdから、話の本体だけでなく敵の演出ブロックも辿れるようにする
function resolveIfEditorContext(ref) {
  if (!ref || !ref.chapterId) return null;
  const realChapter = scenarioProject.chapters.find(c => c.id === ref.chapterId);
  if (realChapter) {
    const block = findBlockDeepInChapter(realChapter, ref.blockId);
    if (block) return { chapter: realChapter, block };
  }
  if (ref.chapterId.indexOf("enemyflavor_") === 0) {
    const entityId = ref.chapterId.slice("enemyflavor_".length);
    const entity = (scenarioProject.enemies || []).find(e => e.id === entityId);
    if (entity) {
      const flavorKeys = ["killBlocks", "spareBlocks", "restSkillBlocks"];
      for (const key of flavorKeys) {
        if (!Array.isArray(entity[key])) continue;
        const fakeChapter = { id: ref.chapterId, blocks: entity[key] };
        const block = findBlockDeepInChapter(fakeChapter, ref.blockId);
        if (block) return { chapter: fakeChapter, block };
      }
    }
  }
  if (ref.chapterId.indexOf("bossevent::") === 0) {
    // ★要望対応：ボスの戦闘イベント（演出ブロック）内のifブロックも、専用画面で編集できるようにする
    const parts = ref.chapterId.split("::");
    const boss = (scenarioProject.bosses || []).find(b => b.id === parts[1]);
    const event = boss && Array.isArray(boss.battleEvents) ? boss.battleEvents.find(e => e.id === parts[2]) : null;
    if (event) {
      if (!Array.isArray(event.blocks)) event.blocks = [];
      const fakeChapter = { id: ref.chapterId, blocks: event.blocks };
      const block = findBlockDeepInChapter(fakeChapter, ref.blockId);
      if (block) return { chapter: fakeChapter, block };
    }
  }
  return null;
}

// ★要望対応（ジャンプブロック用）：話が持つ全ブロックを、ネスト（ifの中身・選択肢の中身）の
//   深さに関わらずフラットな一覧にする。ifブロックの外や、別の分岐の中身へもジャンプできるようにするため
function collectScenarioBlocksFlat(blocks, depth) {
  depth = depth || 0;
  let list = [];
  (blocks || []).forEach(b => {
    list.push({ block: b, depth });
    if (b.type === "if") {
      list = list.concat(collectScenarioBlocksFlat(b.trueBlocks, depth + 1));
      list = list.concat(collectScenarioBlocksFlat(b.falseBlocks, depth + 1));
    } else if (b.type === "choice") {
      (b.options || []).forEach(opt => {
        list = list.concat(collectScenarioBlocksFlat(opt.blocks, depth + 1));
      });
    }
  });
  return list;
}

function buildScenarioJumpTargetSelect(chapter, excludeBlockId, selectedBlockId, onChange) {
  const select = document.createElement("select");
  select.className = "scenariobuild-jump-select";
  
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "（未設定）";
  select.appendChild(defaultOption);
  
  collectScenarioBlocksFlat(chapter.blocks).forEach(({ block, depth }) => {
    if (block.id === excludeBlockId) return;
    const option = document.createElement("option");
    option.value = block.id;
    const preview = blockPreviewText(block);
    option.textContent = `${"　".repeat(depth)}${SCENARIO_BLOCK_TYPES[block.type] || block.type}${preview ? "：" + preview : ""}`;
    select.appendChild(option);
  });
  
  select.value = selectedBlockId || "";
  select.onchange = () => onChange(select.value || null);
  return select;
}

function renderChoiceOptionEditor(container) {
  const ref = scenarioBuildEditingOptionRef;
  const chapter = ref && scenarioProject.chapters.find(c => c.id === ref.chapterId);
  const block = chapter && findBlockDeepInChapter(chapter, ref.blockId);
  const option = block && block.options.find(o => o.id === ref.optionId);
  
  const backBtn = document.createElement("button");
  backBtn.className = "devmode-btn";
  backBtn.textContent = "← ブロック一覧に戻る";
  backBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildMainView = "editor";
    scenarioBuildEditingOptionRef = null;
    renderScenarioBuildPanel();
  };
  container.appendChild(backBtn);
  
  if (!chapter || !block || !option) {
    scenarioBuildMainView = "editor";
    scenarioBuildEditingOptionRef = null;
    renderScenarioBuildPanel();
    return;
  }
  
  if (!Array.isArray(option.blocks)) option.blocks = [];
  
  const titleEl = document.createElement("h3");
  titleEl.textContent = `選択肢の内容：「${option.text || "（未入力）"}」`;
  container.appendChild(titleEl);
  
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "この選択肢を選んだ時だけ実行される内容です。話のブロックと同じように、会話・分岐・戦闘などを自由に組み立てられます。" +
    (option.loops
      ? "「↻ループ」がONなので、ここの内容を最後まで実行し終えると、自動的にまた同じ選択肢を出し直します。"
      : "内容を最後まで実行し終えると、選択肢ブロックの次に自然に進みます。");
  container.appendChild(introEl);
  
  const fakeChapter = { id: chapter.id, blocks: option.blocks }; // ★ブロック一覧描画系の関数をそのまま使い回すための仮の器
  
  const listEl = document.createElement("div");
  listEl.className = "scenariobuild-block-list";
  listEl.appendChild(buildBlockInsertSlot(fakeChapter, 0));
  option.blocks.forEach((b, index) => {
    listEl.appendChild(buildScenarioBlockRow(fakeChapter, b, index));
    listEl.appendChild(buildBlockInsertSlot(fakeChapter, index + 1));
  });
  container.appendChild(listEl);
}

// ===== メイン画面：ifブロックの条件エディタ（専用全画面。scenarioBuildMainView === "ifEditor"） =====
// ★選択肢の内容エディタと同じ考え方で、ifブロックの条件一覧をブロック一覧から切り離して編集できるようにする（要望対応）
function renderIfConditionsEditor(container) {
  const ref = scenarioBuildEditingIfRef;
  const resolved = resolveIfEditorContext(ref);
  const chapter = resolved && resolved.chapter;
  const block = resolved && resolved.block;
  
  const backBtn = document.createElement("button");
  backBtn.className = "devmode-btn";
  backBtn.textContent = "← ブロック一覧に戻る";
  backBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildMainView = "editor";
    scenarioBuildEditingIfRef = null;
    renderScenarioBuildPanel();
  };
  container.appendChild(backBtn);
  
  if (!chapter || !block || block.type !== "if") {
    scenarioBuildMainView = "editor";
    scenarioBuildEditingIfRef = null;
    renderScenarioBuildPanel();
    return;
  }
  
  const titleEl = document.createElement("h3");
  titleEl.textContent = "条件分岐（if）の編集";
  container.appendChild(titleEl);
  
  const wrap = document.createElement("div");
  wrap.className = "scenariobuild-block-fields";
  const persist = () => markScenarioBuildDirty();
  buildIfConditionEditorFields(chapter, block, wrap, persist);
  container.appendChild(wrap);
}

// ===== メイン画面：ifブロックの「条件を満たした時／満たさなかった時」の中身エディタ =====
// ★選択肢の内容エディタ（renderChoiceOptionEditor）と全く同じ考え方：この中身は話のブロックと同じように
//   会話・分岐・戦闘などを自由に組み立てられ、最後まで実行し終えるとifブロックの次へ自然に進む
function renderIfBranchEditor(container) {
  const ref = scenarioBuildEditingIfRef;
  const resolved = resolveIfEditorContext(ref);
  const chapter = resolved && resolved.chapter;
  const block = resolved && resolved.block;
  
  const backBtn = document.createElement("button");
  backBtn.className = "devmode-btn";
  backBtn.textContent = "← ifブロックの編集に戻る";
  backBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildMainView = "ifEditor";
    if (scenarioBuildEditingIfRef) scenarioBuildEditingIfRef.branch = null;
    renderScenarioBuildPanel();
  };
  container.appendChild(backBtn);
  
  if (!chapter || !block || block.type !== "if" || (ref.branch !== "true" && ref.branch !== "false")) {
    scenarioBuildMainView = "editor";
    scenarioBuildEditingIfRef = null;
    renderScenarioBuildPanel();
    return;
  }
  
  const key = ref.branch === "true" ? "trueBlocks" : "falseBlocks";
  if (!Array.isArray(block[key])) block[key] = [];
  
  const titleEl = document.createElement("h3");
  titleEl.textContent = ref.branch === "true" ? "条件を満たした時の内容" : "条件を満たさなかった時の内容";
  container.appendChild(titleEl);
  
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "話のブロックと同じように、会話・分岐・戦闘などを自由に組み立てられます。内容を最後まで実行し終えると、ifブロックの次に自然に進みます。";
  container.appendChild(introEl);
  
  const fakeChapter = { id: chapter.id, blocks: block[key] }; // ★ブロック一覧描画系の関数をそのまま使い回すための仮の器
  
  const listEl = document.createElement("div");
  listEl.className = "scenariobuild-block-list";
  listEl.appendChild(buildBlockInsertSlot(fakeChapter, 0));
  block[key].forEach((b, index) => {
    listEl.appendChild(buildScenarioBlockRow(fakeChapter, b, index));
    listEl.appendChild(buildBlockInsertSlot(fakeChapter, index + 1));
  });
  container.appendChild(listEl);
}

// ★要望対応：見逃した/倒した時の演出を、選択肢やifブロックの中身と同じように専用画面でブロック編集できるようにする
function buildEnemyFlavorBlockEditorRow(label, entity, key, persist) {
  if (!Array.isArray(entity[key])) entity[key] = [];
  const row = document.createElement("div");
  row.className = "scenariobuild-condition-row";
  const summaryEl = document.createElement("span");
  summaryEl.className = "devmode-note";
  summaryEl.textContent = entity[key].length > 0 ? `${label}：ブロック${entity[key].length}個を設定中` : `${label}：未設定`;
  row.appendChild(summaryEl);
  const editBtn = document.createElement("button");
  editBtn.className = "devmode-btn";
  editBtn.textContent = "編集";
  editBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildEditingEnemyFlavorRef = { entityId: entity.id, key, label };
    scenarioBuildMainView = "enemyFlavorEditor";
    renderScenarioBuildPanel();
  };
  row.appendChild(editBtn);
  return row;
}

// ===== メイン画面：見逃した/倒した時の演出エディタ（専用全画面。scenarioBuildMainView === "enemyFlavorEditor"） =====
function renderEnemyFlavorEditor(container) {
  const ref = scenarioBuildEditingEnemyFlavorRef;
  const entity = ref && scenarioProject.enemies.find(e => e.id === ref.entityId);
  
  const backBtn = document.createElement("button");
  backBtn.className = "devmode-btn";
  backBtn.textContent = "← 敵編集に戻る";
  backBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildMainView = "editor";
    scenarioBuildSubView = "enemies";
    scenarioBuildEditingEnemyFlavorRef = null;
    renderScenarioBuildPanel();
  };
  container.appendChild(backBtn);
  
  if (!entity || !ref.key) {
    scenarioBuildMainView = "editor";
    scenarioBuildSubView = "enemies";
    scenarioBuildEditingEnemyFlavorRef = null;
    renderScenarioBuildPanel();
    return;
  }
  if (!Array.isArray(entity[ref.key])) entity[ref.key] = [];
  
  const titleEl = document.createElement("h3");
  titleEl.textContent = `「${entity.name || "（名称未設定）"}」の${ref.label}`;
  container.appendChild(titleEl);
  
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "話のブロックと同じように、セリフ・分岐・フラグ操作などを自由に組み立てられます。ここに何も置かなければ、上の「セリフ（簡易）」欄がそのまま使われます。";
  container.appendChild(introEl);
  
  const fakeChapter = { id: "enemyflavor_" + entity.id, blocks: entity[ref.key] };
  
  const listEl = document.createElement("div");
  listEl.className = "scenariobuild-block-list";
  listEl.appendChild(buildBlockInsertSlot(fakeChapter, 0));
  entity[ref.key].forEach((b, index) => {
    listEl.appendChild(buildScenarioBlockRow(fakeChapter, b, index));
    listEl.appendChild(buildBlockInsertSlot(fakeChapter, index + 1));
  });
  container.appendChild(listEl);
}

// ===== メイン画面：特殊技のifブロックの条件エディタ（専用全画面。scenarioBuildMainView === "skillIfEditor"） =====
function renderSkillIfEditor(container) {
  const skill = getEditingSkill();
  const block = skill ? findSkillBlockDeep(skill, scenarioBuildEditingSkillIfBlockId) : null;
  
  const backBtn = document.createElement("button");
  backBtn.className = "devmode-btn";
  backBtn.textContent = "← 技のブロック一覧に戻る";
  backBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildMainView = "skillBlockEditor";
    scenarioBuildEditingSkillIfBlockId = null;
    renderScenarioBuildPanel();
  };
  container.appendChild(backBtn);
  
  if (!skill || !block || block.type !== "if") {
    scenarioBuildMainView = skill ? "skillBlockEditor" : "list";
    scenarioBuildEditingSkillIfBlockId = null;
    renderScenarioBuildPanel();
    return;
  }
  
  const titleEl = document.createElement("h3");
  titleEl.textContent = `「${skill.name}」の条件分岐（if）の編集`;
  container.appendChild(titleEl);
  
  const wrap = document.createElement("div");
  wrap.className = "scenariobuild-block-fields";
  const persist = () => markScenarioBuildDirty();
  buildSkillIfConditionEditorFields(skill.blocks, block, wrap, persist);
  container.appendChild(wrap);
}

// ===== メイン画面：特殊技ifブロックの「真/偽の時」の中身エディタ（専用全画面。scenarioBuildMainView === "skillIfBranchEditor"） =====
function renderSkillIfBranchEditor(container) {
  const skill = getEditingSkill();
  const block = skill ? findSkillBlockDeep(skill, scenarioBuildEditingSkillIfBlockId) : null;
  const branch = scenarioBuildEditingSkillIfBranch;
  
  const backBtn = document.createElement("button");
  backBtn.className = "devmode-btn";
  backBtn.textContent = "← ifブロックの編集に戻る";
  backBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildMainView = "skillIfEditor";
    scenarioBuildEditingSkillIfBranch = null;
    renderScenarioBuildPanel();
  };
  container.appendChild(backBtn);
  
  if (!skill || !block || block.type !== "if" || (branch !== "true" && branch !== "false")) {
    scenarioBuildMainView = skill ? "skillBlockEditor" : "list";
    scenarioBuildEditingSkillIfBlockId = null;
    scenarioBuildEditingSkillIfBranch = null;
    renderScenarioBuildPanel();
    return;
  }
  
  const key = branch === "true" ? "trueBlocks" : "falseBlocks";
  if (!Array.isArray(block[key])) block[key] = [];
  const persist = () => markScenarioBuildDirty();
  
  const titleEl = document.createElement("h3");
  titleEl.textContent = `「${skill.name}」の${branch === "true" ? "条件を満たした時" : "満たさなかった時"}の中身`;
  container.appendChild(titleEl);
  
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "技のブロックと同じように自由に組み立てられます。最後まで実行し終えると、ifブロックの次に自然に進みます。";
  container.appendChild(introEl);
  
  const listEl = document.createElement("div");
  listEl.className = "scenariobuild-block-list";
  listEl.appendChild(buildSkillBlockInsertSlot(block[key], 0, skill, persist));
  block[key].forEach((b, index) => {
    listEl.appendChild(buildSkillBlockRow(block[key], b, index, skill, persist));
    listEl.appendChild(buildSkillBlockInsertSlot(block[key], index + 1, skill, persist));
  });
  container.appendChild(listEl);
}

// ★ブロックとブロックの間に置く「＋」。押すと、その場でブロック種類を選ぶミニメニューが開く
function buildBlockInsertSlot(chapter, insertIndex) {
  const slot = document.createElement("div");
  slot.className = "scenariobuild-insert-slot";
  
  if (scenarioBuildInsertMenuIndex === insertIndex) {
    const menu = document.createElement("div");
    menu.className = "scenariobuild-insert-menu";
    Object.keys(SCENARIO_BLOCK_TYPES).forEach(type => {
      const btn = document.createElement("button");
      btn.className = "devmode-btn";
      btn.textContent = SCENARIO_BLOCK_TYPES[type];
      btn.onclick = (event) => {
        event.stopPropagation();
        pushUndoSnapshot();
        chapter.blocks.splice(insertIndex, 0, createBlock(type));
        markScenarioBuildDirty();
        scenarioBuildInsertMenuIndex = null;
        renderScenarioBuildPanel();
      };
      menu.appendChild(btn);
    });
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "devmode-btn";
    cancelBtn.textContent = "×";
    cancelBtn.onclick = (event) => {
      event.stopPropagation();
      scenarioBuildInsertMenuIndex = null;
      renderScenarioBuildPanel();
    };
    menu.appendChild(cancelBtn);
    slot.appendChild(menu);
  } else {
    const plusBtn = document.createElement("button");
    plusBtn.className = "scenariobuild-insert-plus";
    plusBtn.textContent = "＋";
    plusBtn.onclick = (event) => {
      event.stopPropagation();
      scenarioBuildInsertMenuIndex = insertIndex;
      renderScenarioBuildPanel();
    };
    slot.appendChild(plusBtn);
  }
  
  return slot;
}

function createBlock(type) {
  const base = { id: generateId("block"), type };
  if (type === "dialogue") return { ...base, speaker: "", text: "" };
  if (type === "narration") return { ...base, text: "" };
  if (type === "telop") return { ...base, text: "" };
  if (type === "bgm") return { ...base, track: "" };
  if (type === "bgmstop") return { ...base }; // ★BGMをフェードアウトして止める特殊ブロック（設定項目なし）
  if (type === "se") return { ...base, path: "" };
  if (type === "flag") return { ...base, flagName: "", mode: "on" }; // mode: "on" | "off" | "toggle"
  if (type === "setvar") return { ...base, varName: "", mode: "set", amount: 0 }; // mode: "set" | "add" | "subtract"
  if (type === "changeparam") return { ...base, target: "player", companionId: "", gauge: "hp", mode: "add", amount: 0 }; // target: "player"|"companion"|"allCompanions"／gauge: "hp"|"sp"|"sleepiness"|"fatigue"／mode: "add"|"set"|"full"|"empty"
  if (type === "bossRemoveInvincibility") return { ...base, messageText: "" };
  if (type === "bossSummonAlly") return { ...base, messageText: "", allyMonsterKey: "" };
  if (type === "bossHeal") return { ...base, messageText: "", healRatio: 0.3 };
  if (type === "bossUseSkill") return { ...base, skillName: "", skillMultiplier: 1.5 };
  if (type === "give") return { ...base, itemId: "", quantity: 1 };
  if (type === "takeitem") return { ...base, itemId: "", quantity: 1 };
  if (type === "battle") return { ...base, enemies: [], winJumpBlockId: null, defeatJumpBlockId: null, defeatMessage: "", level: null }; // enemies: 敵ID（重複可・最大5）の配列
  if (type === "bossbattle") return { ...base, bossKey: "", escorts: [], winJumpBlockId: null, defeatJumpBlockId: null, defeatMessage: "" }; // bossKey: ボス設定タブのID／escorts: 一緒に出す雑魚（任意）
  if (type === "choice") return { ...base, prompt: "", options: [{ id: generateId("opt"), text: "", blocks: [], jumpBlockId: null, loops: false, isCorrect: false }] };
  if (type === "effect") return { ...base, effectType: "shake" }; // effectType: "shake" | "flash"
  if (type === "background") return { ...base, path: "" }; // ★"#"で始まればsetBackgroundColor、それ以外はsetBackgroundImageとして扱う
  if (type === "classselect") return { ...base }; // ★第一話の職業選択〜初期化一式をまとめて行う特殊ブロック（フィールドなし）
  if (type === "setrank") return { ...base, nickname: "" };
  if (type === "gameover") return { ...base, message: "力尽きてしまった……", endingName: "", retryJumpBlockId: null }; // ★ゲームオーバーもバッドエンドの一種として扱う。retryJumpBlockIdを指定すると「リトライ」の戻り先を話の最初以外にできる
  if (type === "ending") return { ...base, endingType: "true", title: "END", endroll: "", endrollEnabled: true, endrollBgm: "", endrollBgmFadeSeconds: null }; // endingType: "bad" | "true" | "happy"
  if (type === "clearchapter") return { ...base, resetProgress: true, endrollEnabled: false, endroll: "", endrollBgm: "", endrollScrollSeconds: 20, endrollBgmFadeSeconds: null }; // ★「エンディング」と違い、タイトル画面には戻らず、そのまま話が続く。冒険が一区切りついたが完結はしない場面（パーティー加入など）向け
  if (type === "if") {
    return {
      ...base,
      conditions: [{ leftKind: "flag", leftValue: "", operator: "=", rightKind: "bool", rightValue: "t", negate: false }],
      combineMode: "AND", // "AND"（&＝全て満たす） | "OR"（Ⅱ＝いずれか満たす）
      trueBlocks: [], falseBlocks: [], // ★選択肢ブロック（option.blocks）と同じ考え方で、条件が真／偽の時の中身をここに直接書く
      trueJumpBlockId: null, falseJumpBlockId: null // ★後方互換用（中身が空の間だけ使われる旧方式）
    };
  }
  if (type === "addcompanion") return { ...base, companionId: "", initialLevel: 1 };
  if (type === "removecompanion") return { ...base, companionId: "", farewellMessage: "" };
  if (type === "portrait_show") return { ...base, mode: "show", instanceId: "", characterId: "", expressionId: "", position: 50, fadeMs: 300 }; // mode: "show" | "hide" | "hideAll"
  if (type === "portrait_expression") return { ...base, instanceId: "", expressionId: "" };
  if (type === "portrait_move") return { ...base, instanceId: "", position: 50, durationMs: 500 };
  if (type === "portrait_motion") return { ...base, instanceId: "", motionType: "jump" }; // motionType: "jump" | "shake"
  if (type === "increment_area_visit") return { ...base, areaKey: "" };
  if (type === "jump") return { ...base, targetBlockId: null }; // ★要望対応：ifの中/外を問わず、話の中のどのブロックへも直接ジャンプできる
  return base;
}

function buildBlockJumpSelect(chapter, currentBlockId, selectedBlockId, onChange) {
  const select = document.createElement("select");
  select.className = "scenariobuild-jump-select";
  
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "（次のブロックに進む）";
  select.appendChild(defaultOption);
  
  chapter.blocks.forEach((block, index) => {
    if (block.id === currentBlockId) return;
    const option = document.createElement("option");
    option.value = block.id;
    option.textContent = `${index + 1}. ${SCENARIO_BLOCK_TYPES[block.type] || block.type}${blockPreviewText(block) ? "：" + blockPreviewText(block) : ""}`;
    select.appendChild(option);
  });
  
  select.value = selectedBlockId || "";
  select.onchange = () => onChange(select.value || null);
  return select;
}

function blockPreviewText(block) {
  if (block.type === "dialogue") return block.text.slice(0, 12);
  if (block.type === "narration") return block.text.slice(0, 12);
  if (block.type === "telop") return block.text.slice(0, 12);
  if (block.type === "bgm") return block.track;
  if (block.type === "bgmstop") return "";
  if (block.type === "se") return block.path;
  if (block.type === "flag") return block.flagName;
  if (block.type === "setvar") {
    if (!block.varName) return "（未設定）";
    const modeLabel = block.mode === "add" ? `+${block.amount || 0}` : block.mode === "subtract" ? `-${block.amount || 0}` : `${block.amount || 0}にする`;
    return `${block.varName}を${modeLabel}`;
  }
  if (block.type === "changeparam") {
    const GAUGE_LABELS = { hp: "HP", sp: "SP", sleepiness: "眠気", fatigue: "疲労度" };
    const targetLabel = block.target === "companion"
      ? (((scenarioProject.companions || []).find(c => c.id === block.companionId) || {}).name || block.companionId || "（仲間未選択）")
      : block.target === "allCompanions" ? "仲間全員" : "主人公";
    const modeLabel = block.mode === "full" ? "全回復" : block.mode === "empty" ? "0にする" : block.mode === "set" ? `${block.amount || 0}にする` : `${(block.amount || 0) >= 0 ? "+" : ""}${block.amount || 0}`;
    return `${targetLabel}の${GAUGE_LABELS[block.gauge] || "HP"}を${modeLabel}`;
  }
  if (block.type === "bossRemoveInvincibility") return "ボスの無敵を解除する";
  if (block.type === "bossSummonAlly") return `仲間を呼ぶ：${block.allyMonsterKey || "（未指定）"}`;
  if (block.type === "bossHeal") return `ボスのHPを回復（最大HPの${Math.round((block.healRatio || 0) * 100)}%）`;
  if (block.type === "bossUseSkill") return `ボスが技を撃つ：${block.skillName || "（未指定）"}`;
  if (block.type === "give") return block.itemId;
  if (block.type === "takeitem") return block.itemId;
  if (block.type === "battle") return (block.enemies || []).filter(Boolean).join("＋");
  if (block.type === "bossbattle") return block.bossKey + ((block.escorts || []).length > 0 ? `＋雑魚${block.escorts.length}体` : "");
  if (block.type === "choice") return block.prompt.slice(0, 12);
  if (block.type === "effect") {
    const labels = {
      shake: "カメラシェイク",
      flash: "ヒットエフェクト",
      flashWhite: "白フラッシュ",
      monochromeOn: "モノクロ開始",
      monochromeOff: "モノクロ終了（回想終了）",
      sepiaOn: "セピア調開始",
      sepiaOff: "セピア調終了",
      invertOn: "色反転開始",
      invertOff: "色反転終了",
      blackoutOn: "暗転する",
      blackoutOff: "暗転を解除する",
      vignetteOn: "ヴィネット開始",
      vignetteOff: "ヴィネット終了",
      blurOn: "ぼかし開始",
      blurOff: "ぼかし終了",
      zoomIn: "ズームする",
      zoomOut: "ズームを戻す",
      weatherRainOn: "雨を降らせる",
      weatherSnowOn: "雪を降らせる",
      weatherSakuraOn: "桜吹雪を降らせる",
      weatherOff: "天候演出終了"
    };
    return labels[block.effectType] || "カメラシェイク";
  }
  if (block.type === "background") return block.path;
  if (block.type === "classselect") return "職業選択";
  if (block.type === "setrank") return block.nickname;
  if (block.type === "gameover") return block.endingName ? `ゲームオーバー（${block.endingName}）` : "ゲームオーバー";
  if (block.type === "ending") return block.title;
  if (block.type === "clearchapter") return "タイトルには戻らない";
  if (block.type === "if") return `条件${(block.conditions || []).length}個（${block.combineMode === "OR" ? "Ⅱ" : "&"}）`;
  if (block.type === "jump") return block.targetBlockId ? "→ 指定ブロックへ" : "（未設定）";
  if (block.type === "addcompanion") {
    const c = (scenarioProject.companions || []).find(c => c.id === block.companionId);
    return block.companionId ? `${c ? c.name : block.companionId}（Lv.${block.initialLevel || 1}）` : "（未選択）";
  }
  if (block.type === "removecompanion") {
    const c = (scenarioProject.companions || []).find(c => c.id === block.companionId);
    return block.companionId ? `${c ? c.name : block.companionId}が離脱` : "（未選択）";
  }
  if (block.type === "portrait_show") {
    if (block.mode === "hideAll") return "全員非表示";
    if (block.mode === "hide") return `非表示：${block.instanceId || "（未指定）"}`;
    const char = scenarioProject.portraitCharacters.find(c => c.id === block.characterId);
    return `表示：${char ? char.name : "（未選択）"}（位置${block.position != null ? block.position : 50}）`;
  }
  if (block.type === "portrait_expression") return `${block.instanceId || "（未指定）"}の表情変更`;
  if (block.type === "portrait_move") return `${block.instanceId || "（未指定）"}を位置${block.position != null ? block.position : 50}へ`;
  if (block.type === "portrait_motion") return `${block.instanceId || "（未指定）"}が${block.motionType === "shake" ? "震える" : "ジャンプ"}`;
  if (block.type === "increment_area_visit") {
    const area = scenarioProject.mapAreas.find(a => a.locationKey === block.areaKey);
    return `${area ? area.name : "（未選択）"}の来訪回数+1`;
  }
  return "";
}

function buildScenarioBlockRow(chapter, block, index) {
  const row = document.createElement("div");
  row.className = "scenariobuild-chapter-row";
  // ★バグ修正：以前はrow全体をdraggable=trueにしていたため、セリフ本文などのtextarea内で
  //   文字をドラッグして選択しようとしても、ブラウザがそれを「行の並び替えドラッグ」だと
  //   誤認してしまい、テキスト選択ができなかった。draggableは☰ハンドルだけに絞り、
  //   ドラッグ中の見た目だけsetDragImageで行全体を使うようにする
  row.addEventListener("dragover", (event) => {
    event.preventDefault();
    row.classList.add("scenariobuild-drag-over");
  });
  row.addEventListener("dragleave", () => row.classList.remove("scenariobuild-drag-over"));
  row.addEventListener("drop", (event) => {
    event.preventDefault();
    row.classList.remove("scenariobuild-drag-over");
    if (scenarioBlockDragFromIndex === null || scenarioBlockDragFromIndex === index) return;
    dropScenarioBlock(chapter, scenarioBlockDragFromIndex, index);
    scenarioBlockDragFromIndex = null;
  });
  
  const handleEl = document.createElement("span");
  handleEl.className = "scenariobuild-drag-handle";
  handleEl.textContent = "☰";
  handleEl.draggable = true;
  handleEl.addEventListener("dragstart", (event) => {
    event.dataTransfer.effectAllowed = "move";
    if (event.dataTransfer.setDragImage) event.dataTransfer.setDragImage(row, 0, 0);
    row.classList.add("scenariobuild-dragging");
    scenarioBlockDragFromIndex = index;
  });
  handleEl.addEventListener("dragend", () => row.classList.remove("scenariobuild-dragging"));
  
  const numberEl = document.createElement("span");
  numberEl.className = "scenariobuild-chapter-number";
  numberEl.style.whiteSpace = "pre-line";
  numberEl.textContent = `${index + 1}\n${SCENARIO_BLOCK_TYPES[block.type] || block.type}`;
  
  const infoEl = document.createElement("div");
  infoEl.className = "scenariobuild-chapter-info";
  infoEl.appendChild(buildBlockFormFields(chapter, block));
  
  const buttonsEl = document.createElement("div");
  buttonsEl.className = "scenariobuild-chapter-buttons";
  
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "devmode-btn devmode-btn-danger";
  deleteBtn.textContent = "削除";
  deleteBtn.onclick = async (event) => {
    event.stopPropagation();
    const ok = await showGameConfirm("このブロックを削除しますか？");
    if (!ok) return;
    pushUndoSnapshot();
    chapter.blocks.splice(index, 1);
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  buttonsEl.appendChild(deleteBtn);
  
  row.appendChild(handleEl);
  row.appendChild(numberEl);
  row.appendChild(infoEl);
  row.appendChild(buttonsEl);
  return row;
}

// ★ブロックのドラッグ&ドロップによる並び替え
let scenarioBlockDragFromIndex = null;
function dropScenarioBlock(chapter, fromIndex, toIndex) {
  pushUndoSnapshot();
  const [moved] = chapter.blocks.splice(fromIndex, 1);
  chapter.blocks.splice(toIndex, 0, moved);
  markScenarioBuildDirty();
  renderScenarioBuildPanel();
}

// ★シナリオifブロックの条件エディタ本体（要望対応：以前はブロック一覧に直接ずらっと表示されていて長くなりがちだったため、
//   選択肢ブロックの内容編集と同じように別画面（ifEditor）で編集できるようにした。
//   ここは中身の組み立てだけを行い、呼び出し側（ブロック一覧のインライン簡易表示 / 専用画面）の両方から使う
function buildIfConditionEditorFields(chapter, block, wrap, persist) {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note scenariobuild-condition";
    noteEl.textContent = "条件を左右で比較します。左右それぞれ「フラグ／変数（数値）／主人公のレベル／体力／SP／ボスの体力(%)／経過ターン数／職業／指定アイテムを持っているか／数字／文字列／t-f」から選べます。「&」は全ての条件を満たす、「Ⅱ」はいずれか1つでも満たせば成立にする、という切り替えです。各条件の「！」は、その条件だけを反転（満たさない時に成立）させます。「ボスの体力」「経過ターン数」は戦闘中（ボスの戦闘イベント演出ブロック）でのみ意味を持ち、戦闘外では0として扱われます。";
    wrap.appendChild(noteEl);
    
    if (!Array.isArray(block.conditions)) block.conditions = [];
    
    const combineRow = document.createElement("div");
    combineRow.className = "scenariobuild-condition-row";
    combineRow.appendChild(labelSpan("条件の結び方："));
    const combineSelect = document.createElement("select");
    combineSelect.className = "scenariobuild-jump-select";
    [{ value: "AND", label: "& （全て満たす）" }, { value: "OR", label: "Ⅱ （いずれか満たす）" }].forEach(opt => {
      const optionEl = document.createElement("option");
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      combineSelect.appendChild(optionEl);
    });
    combineSelect.value = block.combineMode || "AND";
    combineSelect.onchange = () => { block.combineMode = combineSelect.value; persist(); };
    combineRow.appendChild(combineSelect);
    wrap.appendChild(combineRow);
    
    const IF_VALUE_KINDS = {
      flag: "フラグ", variable: "変数（数値）", level: "主人公のレベル", hp: "主人公の体力", sp: "主人公のSP", class: "主人公の職業",
      bossHp: "ボスの体力（%、戦闘中のみ）", turnCount: "経過ターン数（戦闘中のみ）",
      hasItem: "指定アイテムを持っているか", random: "乱数（0〜100、判定のたびに引き直す）", number: "数字", string: "文字列", bool: "t/f"
    };
    const IF_OPERATORS = { "=": "=（等しい）", "!=": "≠（等しくない）", "<": "<", ">": ">", "<=": "<=", ">=": ">=" };
    
    const buildValueInputs = (cond, side) => {
      const kindKey = side + "Kind", valueKey = side + "Value";
      const frag = document.createDocumentFragment();
      const kindSelect = document.createElement("select");
      kindSelect.className = "scenariobuild-jump-select";
      Object.keys(IF_VALUE_KINDS).forEach(k => {
        const optionEl = document.createElement("option");
        optionEl.value = k;
        optionEl.textContent = IF_VALUE_KINDS[k];
        kindSelect.appendChild(optionEl);
      });
      kindSelect.value = cond[kindKey] || "flag";
      kindSelect.onchange = () => { cond[kindKey] = kindSelect.value; persist(); renderScenarioBuildPanel(); };
      frag.appendChild(kindSelect);
      
      if (cond[kindKey] === "level" || cond[kindKey] === "hp" || cond[kindKey] === "sp" || cond[kindKey] === "random" || cond[kindKey] === "bossHp" || cond[kindKey] === "turnCount") {
        // ★プレイヤー/ボスの今の値・乱数・ターン数を自動的に見に行くので、入力欄自体が不要（比較する側の数字だけ指定すればよい）
        const infoSpan = document.createElement("span");
        infoSpan.className = "devmode-note";
        infoSpan.textContent = cond[kindKey] === "random" ? "（毎回0〜100の乱数）" : "（現在値を自動参照）";
        frag.appendChild(infoSpan);
      } else if (cond[kindKey] === "class") {
        const classSelect = document.createElement("select");
        classSelect.className = "scenariobuild-jump-select";
        (typeof CLASS_MASTER !== "undefined" ? Object.keys(CLASS_MASTER) : []).forEach(className => {
          const optionEl = document.createElement("option");
          optionEl.value = className;
          optionEl.textContent = className;
          classSelect.appendChild(optionEl);
        });
        classSelect.value = cond[valueKey] || (typeof CLASS_MASTER !== "undefined" ? Object.keys(CLASS_MASTER)[0] : "");
        classSelect.onchange = () => { cond[valueKey] = classSelect.value; persist(); };
        frag.appendChild(classSelect);
      } else if (cond[kindKey] === "hasItem") {
        const itemInput = document.createElement("input");
        itemInput.type = "text";
        itemInput.className = "scenariobuild-title-input";
        itemInput.placeholder = "アイテムID";
        itemInput.setAttribute("list", "scenariobuild-item-datalist");
        itemInput.value = cond[valueKey] != null ? cond[valueKey] : "";
        itemInput.onchange = () => { cond[valueKey] = itemInput.value.trim(); persist(); };
        frag.appendChild(itemInput);
      } else if (cond[kindKey] === "bool") {
        const boolSelect = document.createElement("select");
        boolSelect.className = "scenariobuild-jump-select";
        ["t", "f"].forEach(v => {
          const optionEl = document.createElement("option");
          optionEl.value = v;
          optionEl.textContent = v;
          boolSelect.appendChild(optionEl);
        });
        boolSelect.value = cond[valueKey] === "f" ? "f" : "t";
        boolSelect.onchange = () => { cond[valueKey] = boolSelect.value; persist(); };
        frag.appendChild(boolSelect);
      } else {
        const valueInput = document.createElement("input");
        valueInput.type = cond[kindKey] === "number" ? "number" : "text";
        valueInput.className = "scenariobuild-condition-input";
        valueInput.placeholder = cond[kindKey] === "flag" ? "フラグ名" : (cond[kindKey] === "variable" ? "変数名" : (cond[kindKey] === "number" ? "数字" : "文字列"));
        valueInput.value = cond[valueKey] != null ? cond[valueKey] : "";
        valueInput.onchange = () => { cond[valueKey] = valueInput.value; persist(); };
        frag.appendChild(valueInput);
      }
      return frag;
    };
    
    block.conditions.forEach((cond, condIndex) => {
      const condRow = document.createElement("div");
      condRow.className = "scenariobuild-condition-row";
      
      const negLabel = document.createElement("label");
      const negCheckbox = document.createElement("input");
      negCheckbox.type = "checkbox";
      negCheckbox.checked = !!cond.negate;
      negCheckbox.onchange = () => { cond.negate = negCheckbox.checked; persist(); };
      negLabel.appendChild(negCheckbox);
      negLabel.append(" ！");
      condRow.appendChild(negLabel);
      
      condRow.appendChild(buildValueInputs(cond, "left"));
      
      const opSelect = document.createElement("select");
      opSelect.className = "scenariobuild-jump-select";
      Object.keys(IF_OPERATORS).forEach(op => {
        const optionEl = document.createElement("option");
        optionEl.value = op;
        optionEl.textContent = IF_OPERATORS[op];
        opSelect.appendChild(optionEl);
      });
      opSelect.value = cond.operator || "=";
      opSelect.onchange = () => { cond.operator = opSelect.value; persist(); };
      condRow.appendChild(opSelect);
      
      condRow.appendChild(buildValueInputs(cond, "right"));
      
      const removeBtn = document.createElement("button");
      removeBtn.className = "devmode-btn devmode-btn-danger";
      removeBtn.textContent = "×";
      removeBtn.onclick = (event) => {
        event.stopPropagation();
        block.conditions.splice(condIndex, 1);
        persist();
        renderScenarioBuildPanel();
      };
      condRow.appendChild(removeBtn);
      
      wrap.appendChild(condRow);
    });
    
    const addCondBtn = document.createElement("button");
    addCondBtn.className = "devmode-btn";
    addCondBtn.textContent = "＋条件を追加";
    addCondBtn.onclick = (event) => {
      event.stopPropagation();
      block.conditions.push({ leftKind: "flag", leftValue: "", operator: "=", rightKind: "bool", rightValue: "t", negate: false });
      persist();
      renderScenarioBuildPanel();
    };
    wrap.appendChild(addCondBtn);
    
    const trueRow = document.createElement("div");
    trueRow.className = "scenariobuild-condition-row";
    trueRow.appendChild(labelSpan("条件を満たした時："));
    if (!Array.isArray(block.trueBlocks)) block.trueBlocks = [];
    const trueSummary = document.createElement("span");
    trueSummary.className = "devmode-note";
    trueSummary.textContent = block.trueBlocks.length > 0 ? `内容：ブロック${block.trueBlocks.length}個` : "内容が未設定です";
    trueRow.appendChild(trueSummary);
    const trueEditBtn = document.createElement("button");
    trueEditBtn.className = "devmode-btn";
    trueEditBtn.textContent = "編集";
    trueEditBtn.onclick = (event) => {
      event.stopPropagation();
      scenarioBuildEditingIfRef = { chapterId: chapter.id, blockId: block.id, branch: "true" };
      scenarioBuildMainView = "ifBranchEditor";
      renderScenarioBuildPanel();
    };
    trueRow.appendChild(trueEditBtn);
    wrap.appendChild(trueRow);
    
    const falseRow = document.createElement("div");
    falseRow.className = "scenariobuild-condition-row";
    falseRow.appendChild(labelSpan("満たさなかった時："));
    if (!Array.isArray(block.falseBlocks)) block.falseBlocks = [];
    const falseSummary = document.createElement("span");
    falseSummary.className = "devmode-note";
    falseSummary.textContent = block.falseBlocks.length > 0 ? `内容：ブロック${block.falseBlocks.length}個` : "内容が未設定です（そのまま次のブロックへ進みます）";
    falseRow.appendChild(falseSummary);
    const falseEditBtn = document.createElement("button");
    falseEditBtn.className = "devmode-btn";
    falseEditBtn.textContent = "編集";
    falseEditBtn.onclick = (event) => {
      event.stopPropagation();
      scenarioBuildEditingIfRef = { chapterId: chapter.id, blockId: block.id, branch: "false" };
      scenarioBuildMainView = "ifBranchEditor";
      renderScenarioBuildPanel();
    };
    falseRow.appendChild(falseEditBtn);
    wrap.appendChild(falseRow);
}

function buildBlockFormFields(chapter, block) {
  const wrap = document.createElement("div");
  wrap.className = "scenariobuild-block-fields";
  const persist = () => markScenarioBuildDirty();
  
  if (block.type === "dialogue") {
    const speakerInput = document.createElement("input");
    speakerInput.type = "text";
    speakerInput.className = "scenariobuild-title-input";
    speakerInput.placeholder = "話者名（空欄＝ナレーション扱い）";
    speakerInput.value = block.speaker;
    speakerInput.setAttribute("list", "scenariobuild-character-datalist"); // ★キャラ管理に登録した名前を候補表示
    speakerInput.onchange = () => { block.speaker = speakerInput.value; persist(); };
    
    const textArea = document.createElement("textarea");
    textArea.className = "scenariobuild-textarea";
    textArea.placeholder = "セリフ";
    textArea.value = block.text;
    textArea.onchange = () => { block.text = textArea.value; persist(); };
    
    wrap.appendChild(speakerInput);
    wrap.appendChild(textArea);
    return wrap;
  }
  
  if (block.type === "narration") {
    const textArea = document.createElement("textarea");
    textArea.className = "scenariobuild-textarea";
    textArea.placeholder = "地の文";
    textArea.value = block.text;
    textArea.onchange = () => { block.text = textArea.value; persist(); };
    wrap.appendChild(textArea);
    return wrap;
  }
  
  if (block.type === "telop") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note scenariobuild-condition";
    noteEl.textContent = "黒背景に大きく表示される演出用の文字です（第二話のGAME OVER等と同じ仕組み）。";
    wrap.appendChild(noteEl);
    const textArea = document.createElement("textarea");
    textArea.className = "scenariobuild-textarea";
    textArea.placeholder = "テロップに表示する文字";
    textArea.value = block.text;
    textArea.onchange = () => { block.text = textArea.value; persist(); };
    wrap.appendChild(textArea);
    return wrap;
  }
  
  if (block.type === "bgm") {
    const trackInput = document.createElement("input");
    trackInput.type = "text";
    trackInput.className = "scenariobuild-title-input";
    trackInput.placeholder = "曲名（BGM設定タブ参照）またはファイルパスを直接貼り付け";
    trackInput.value = block.track;
    trackInput.setAttribute("list", "scenariobuild-bgm-datalist");
    trackInput.onchange = () => { block.track = trackInput.value.trim(); persist(); };
    wrap.appendChild(trackInput);
    return wrap;
  }
  
  if (block.type === "bgmstop") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note scenariobuild-condition";
    noteEl.textContent = "今鳴っているBGMをフェードアウトして止めます（無音になります）。設定項目はありません。別のBGMに切り替えたいだけの場合は「BGM切り替え」ブロックを使ってください。";
    wrap.appendChild(noteEl);
    return wrap;
  }
  
  if (block.type === "se") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note scenariobuild-condition";
    noteEl.textContent = "1回だけ再生される効果音です。ファイルパスをそのまま貼り付けてください（例：se/決定音.mp3）。";
    wrap.appendChild(noteEl);
    const pathInput = document.createElement("input");
    pathInput.type = "text";
    pathInput.className = "scenariobuild-title-input";
    pathInput.placeholder = "効果音ファイルのパス";
    pathInput.value = block.path;
    pathInput.onchange = () => { block.path = pathInput.value.trim(); persist(); };
    wrap.appendChild(pathInput);
    return wrap;
  }
  
  if (block.type === "flag") {
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "scenariobuild-title-input";
    nameInput.placeholder = "フラグ名（例：ハーピーと仲直りした）";
    nameInput.value = block.flagName;
    nameInput.onchange = () => { block.flagName = nameInput.value.trim(); persist(); };
    wrap.appendChild(nameInput);
    
    const modeRow = document.createElement("div");
    modeRow.className = "scenariobuild-condition-row";
    modeRow.appendChild(labelSpan("設定内容："));
    const modeSelect = document.createElement("select");
    modeSelect.className = "scenariobuild-jump-select";
    [["on", "ONにする"], ["off", "OFFにする"], ["toggle", "反転させる"]].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      modeSelect.appendChild(option);
    });
    modeSelect.value = block.mode;
    modeSelect.onchange = () => { block.mode = modeSelect.value; persist(); };
    modeRow.appendChild(modeSelect);
    wrap.appendChild(modeRow);
    return wrap;
  }
  
  if (block.type === "setvar") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note scenariobuild-condition";
    noteEl.textContent = "フラグと違い、数字を代入したり増減させたりできる変数です。IF条件の「変数（数値）」でこの名前を指定すれば、今の値を条件に使えます。";
    wrap.appendChild(noteEl);
    
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "scenariobuild-title-input";
    nameInput.placeholder = "変数名（例：ハーピーとの思い出）";
    nameInput.value = block.varName || "";
    nameInput.onchange = () => { block.varName = nameInput.value.trim(); persist(); };
    wrap.appendChild(nameInput);
    
    const modeRow = document.createElement("div");
    modeRow.className = "scenariobuild-condition-row";
    modeRow.appendChild(labelSpan("設定内容："));
    const modeSelect = document.createElement("select");
    modeSelect.className = "scenariobuild-jump-select";
    [["set", "指定した数にする"], ["add", "指定した数だけ加算する"], ["subtract", "指定した数だけ減算する"]].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      modeSelect.appendChild(option);
    });
    modeSelect.value = block.mode || "set";
    modeSelect.onchange = () => { block.mode = modeSelect.value; persist(); };
    modeRow.appendChild(modeSelect);
    wrap.appendChild(modeRow);
    
    const amountRow = document.createElement("div");
    amountRow.className = "scenariobuild-condition-row";
    amountRow.appendChild(labelSpan("数値："));
    const amountInput = document.createElement("input");
    amountInput.type = "number";
    amountInput.className = "scenariobuild-condition-input";
    amountInput.value = block.amount != null ? block.amount : 0;
    amountInput.onchange = () => { block.amount = Number(amountInput.value) || 0; persist(); };
    amountRow.appendChild(amountInput);
    wrap.appendChild(amountRow);
    return wrap;
  }
  
  if (block.type === "changeparam") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note scenariobuild-condition";
    noteEl.textContent = "主人公または仲間のHP・SP・眠気・疲労度を増減させます（0〜最大値の範囲でクランプされます）。";
    wrap.appendChild(noteEl);
    
    const targetRow = document.createElement("div");
    targetRow.className = "scenariobuild-condition-row";
    targetRow.appendChild(labelSpan("対象："));
    const targetSelect = document.createElement("select");
    targetSelect.className = "scenariobuild-jump-select";
    [["player", "主人公"], ["companion", "仲間（1人指定）"], ["allCompanions", "仲間全員"]].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      targetSelect.appendChild(option);
    });
    targetSelect.value = block.target || "player";
    targetSelect.onchange = () => { block.target = targetSelect.value; persist(); renderScenarioBuildPanel(); };
    targetRow.appendChild(targetSelect);
    wrap.appendChild(targetRow);
    
    if (block.target === "companion") {
      const companionRow = document.createElement("div");
      companionRow.className = "scenariobuild-condition-row";
      companionRow.appendChild(labelSpan("仲間："));
      const companionSelect = document.createElement("select");
      companionSelect.className = "scenariobuild-jump-select";
      const emptyOpt = document.createElement("option");
      emptyOpt.value = "";
      emptyOpt.textContent = "（選択してください）";
      companionSelect.appendChild(emptyOpt);
      (scenarioProject.companions || []).forEach(c => {
        const option = document.createElement("option");
        option.value = c.id;
        option.textContent = c.name || c.id;
        companionSelect.appendChild(option);
      });
      companionSelect.value = block.companionId || "";
      companionSelect.onchange = () => { block.companionId = companionSelect.value; persist(); };
      companionRow.appendChild(companionSelect);
      wrap.appendChild(companionRow);
    }
    
    const gaugeRow = document.createElement("div");
    gaugeRow.className = "scenariobuild-condition-row";
    gaugeRow.appendChild(labelSpan("パラメータ："));
    const gaugeSelect = document.createElement("select");
    gaugeSelect.className = "scenariobuild-jump-select";
    [["hp", "HP"], ["sp", "SP"], ["sleepiness", "眠気"], ["fatigue", "疲労度"]].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      gaugeSelect.appendChild(option);
    });
    gaugeSelect.value = block.gauge || "hp";
    gaugeSelect.onchange = () => { block.gauge = gaugeSelect.value; persist(); };
    gaugeRow.appendChild(gaugeSelect);
    wrap.appendChild(gaugeRow);
    
    const modeRow2 = document.createElement("div");
    modeRow2.className = "scenariobuild-condition-row";
    modeRow2.appendChild(labelSpan("増減方法："));
    const modeSelect2 = document.createElement("select");
    modeSelect2.className = "scenariobuild-jump-select";
    [["add", "指定した数だけ増減させる"], ["set", "指定した数にする"], ["full", "最大値まで全回復させる"], ["empty", "0にする"]].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      modeSelect2.appendChild(option);
    });
    modeSelect2.value = block.mode || "add";
    modeSelect2.onchange = () => { block.mode = modeSelect2.value; persist(); renderScenarioBuildPanel(); };
    modeRow2.appendChild(modeSelect2);
    wrap.appendChild(modeRow2);
    
    if (block.mode === "add" || block.mode === "set" || !block.mode) {
      const amountRow2 = document.createElement("div");
      amountRow2.className = "scenariobuild-condition-row";
      amountRow2.appendChild(labelSpan(block.mode === "set" ? "設定する値：" : "増減量（マイナスで減少）："));
      const amountInput2 = document.createElement("input");
      amountInput2.type = "number";
      amountInput2.className = "scenariobuild-condition-input";
      amountInput2.value = block.amount != null ? block.amount : 0;
      amountInput2.onchange = () => { block.amount = Number(amountInput2.value) || 0; persist(); };
      amountRow2.appendChild(amountInput2);
      wrap.appendChild(amountRow2);
    }
    return wrap;
  }
  
  if (block.type === "bossRemoveInvincibility") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note scenariobuild-condition";
    noteEl.textContent = "ボスの戦闘イベント（演出ブロック）実行中にのみ効果があります。ボスの無敵を解除します。";
    wrap.appendChild(noteEl);
    const msgRow = document.createElement("div");
    msgRow.className = "scenariobuild-condition-row";
    msgRow.appendChild(labelSpan("セリフ・メッセージ："));
    const msgInput = document.createElement("input");
    msgInput.type = "text";
    msgInput.className = "scenariobuild-title-input";
    msgInput.placeholder = "空欄でもOK（既定の文言が使われます）";
    msgInput.value = block.messageText || "";
    msgInput.onchange = () => { block.messageText = msgInput.value; persist(); };
    msgRow.appendChild(msgInput);
    wrap.appendChild(msgRow);
    return wrap;
  }
  
  if (block.type === "bossSummonAlly") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note scenariobuild-condition";
    noteEl.textContent = "ボスの戦闘イベント（演出ブロック）実行中にのみ効果があります。指定した魔物を1体、増援として参戦させます。";
    wrap.appendChild(noteEl);
    const msgRow = document.createElement("div");
    msgRow.className = "scenariobuild-condition-row";
    msgRow.appendChild(labelSpan("セリフ・メッセージ："));
    const msgInput = document.createElement("input");
    msgInput.type = "text";
    msgInput.className = "scenariobuild-title-input";
    msgInput.placeholder = "空欄でもOK（既定の文言が使われます）";
    msgInput.value = block.messageText || "";
    msgInput.onchange = () => { block.messageText = msgInput.value; persist(); };
    msgRow.appendChild(msgInput);
    wrap.appendChild(msgRow);
    const allyRow = document.createElement("div");
    allyRow.className = "scenariobuild-condition-row";
    allyRow.appendChild(labelSpan("呼び出す魔物ID："));
    const allyInput = document.createElement("input");
    allyInput.type = "text";
    allyInput.className = "scenariobuild-title-input";
    allyInput.placeholder = "例：goblin";
    allyInput.setAttribute("list", "scenariobuild-monster-datalist");
    allyInput.value = block.allyMonsterKey || "";
    allyInput.onchange = () => { block.allyMonsterKey = allyInput.value.trim(); persist(); };
    allyRow.appendChild(allyInput);
    wrap.appendChild(allyRow);
    return wrap;
  }
  
  if (block.type === "bossHeal") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note scenariobuild-condition";
    noteEl.textContent = "ボスの戦闘イベント（演出ブロック）実行中にのみ効果があります。ボス自身のHPを、最大HPに対する割合で回復させます。";
    wrap.appendChild(noteEl);
    const msgRow = document.createElement("div");
    msgRow.className = "scenariobuild-condition-row";
    msgRow.appendChild(labelSpan("セリフ・メッセージ："));
    const msgInput = document.createElement("input");
    msgInput.type = "text";
    msgInput.className = "scenariobuild-title-input";
    msgInput.placeholder = "空欄でもOK（既定の文言が使われます）";
    msgInput.value = block.messageText || "";
    msgInput.onchange = () => { block.messageText = msgInput.value; persist(); };
    msgRow.appendChild(msgInput);
    wrap.appendChild(msgRow);
    const healRow = document.createElement("div");
    healRow.className = "scenariobuild-condition-row";
    healRow.appendChild(labelSpan("回復割合（最大HPの、0〜1）："));
    const healInput = document.createElement("input");
    healInput.type = "number";
    healInput.min = "0"; healInput.max = "1"; healInput.step = "0.05";
    healInput.className = "scenariobuild-condition-input";
    healInput.value = block.healRatio != null ? block.healRatio : 0.3;
    healInput.onchange = () => { block.healRatio = Math.max(0, Math.min(1, Number(healInput.value) || 0)); persist(); };
    healRow.appendChild(healInput);
    wrap.appendChild(healRow);
    return wrap;
  }
  
  if (block.type === "bossUseSkill") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note scenariobuild-condition";
    noteEl.textContent = "ボスの戦闘イベント（演出ブロック）実行中にのみ効果があります。専用スキル（uniqueSkill）と同じ仕組みで技を撃たせます。";
    wrap.appendChild(noteEl);
    const skillRow = document.createElement("div");
    skillRow.className = "scenariobuild-condition-row";
    skillRow.style.flexWrap = "wrap";
    skillRow.appendChild(labelSpan("技名："));
    const skillNameInput = document.createElement("input");
    skillNameInput.type = "text";
    skillNameInput.className = "scenariobuild-title-input";
    skillNameInput.value = block.skillName || "";
    skillNameInput.onchange = () => { block.skillName = skillNameInput.value; persist(); };
    skillRow.appendChild(skillNameInput);
    skillRow.appendChild(labelSpan("威力倍率："));
    const skillMultInput = document.createElement("input");
    skillMultInput.type = "number";
    skillMultInput.step = "0.1";
    skillMultInput.className = "scenariobuild-condition-input";
    skillMultInput.value = block.skillMultiplier != null ? block.skillMultiplier : 1.5;
    skillMultInput.onchange = () => { block.skillMultiplier = Number(skillMultInput.value) || 1; persist(); };
    skillRow.appendChild(skillMultInput);
    wrap.appendChild(skillRow);
    return wrap;
  }
  
  if (block.type === "give") {
    const itemInput = document.createElement("input");
    itemInput.type = "text";
    itemInput.className = "scenariobuild-title-input";
    itemInput.placeholder = "アイテムID（items.jsのキー、またはアイテム設定で作ったID）";
    itemInput.value = block.itemId;
    itemInput.setAttribute("list", "scenariobuild-item-datalist");
    itemInput.onchange = () => { block.itemId = itemInput.value.trim(); persist(); };
    wrap.appendChild(itemInput);
    
    const qtyRow = document.createElement("div");
    qtyRow.className = "scenariobuild-condition-row";
    qtyRow.appendChild(labelSpan("個数："));
    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.min = "1";
    qtyInput.className = "scenariobuild-condition-input";
    qtyInput.value = block.quantity || 1;
    qtyInput.onchange = () => { block.quantity = Math.max(1, Number(qtyInput.value) || 1); persist(); };
    qtyRow.appendChild(qtyInput);
    wrap.appendChild(qtyRow);
    return wrap;
  }
  
  if (block.type === "takeitem") {
    const itemInput = document.createElement("input");
    itemInput.type = "text";
    itemInput.className = "scenariobuild-title-input";
    itemInput.placeholder = "消費するアイテムID";
    itemInput.value = block.itemId;
    itemInput.setAttribute("list", "scenariobuild-item-datalist");
    itemInput.onchange = () => { block.itemId = itemInput.value.trim(); persist(); };
    wrap.appendChild(itemInput);
    
    const qtyRow2 = document.createElement("div");
    qtyRow2.className = "scenariobuild-condition-row";
    qtyRow2.appendChild(labelSpan("個数："));
    const qtyInput2 = document.createElement("input");
    qtyInput2.type = "number";
    qtyInput2.min = "1";
    qtyInput2.className = "scenariobuild-condition-input";
    qtyInput2.value = block.quantity || 1;
    qtyInput2.onchange = () => { block.quantity = Math.max(1, Number(qtyInput2.value) || 1); persist(); };
    qtyRow2.appendChild(qtyInput2);
    wrap.appendChild(qtyRow2);
    return wrap;
  }
  
  if (block.type === "classselect") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note scenariobuild-condition";
    noteEl.textContent = "第一話の「神様と職業を選ぶ」場面一式（選択→確認→やり直し可→職業ごとの反応セリフ→ステータス初期化）を、まとめて実行する特殊ブロックです。設定項目はありません。";
    wrap.appendChild(noteEl);
    return wrap;
  }
  
  if (block.type === "setrank") {
    const nicknameInput = document.createElement("input");
    nicknameInput.type = "text";
    nicknameInput.className = "scenariobuild-title-input";
    nicknameInput.placeholder = "二つ名";
    nicknameInput.value = block.nickname;
    nicknameInput.onchange = () => { block.nickname = nicknameInput.value; persist(); };
    wrap.appendChild(labelSpan("二つ名："));
    wrap.appendChild(nicknameInput);
    return wrap;
  }
  
  if (block.type === "if") {
    if (!Array.isArray(block.conditions)) block.conditions = [];
    const summaryEl = document.createElement("p");
    summaryEl.className = "devmode-note scenariobuild-condition";
    const condCount = block.conditions.length;
    summaryEl.textContent = condCount > 0
      ? `条件${condCount}個（${block.combineMode === "OR" ? "Ⅱ：いずれか満たす" : "＆：全て満たす"}）を設定中`
      : "条件が未設定です";
    wrap.appendChild(summaryEl);
    
    const editBtn = document.createElement("button");
    editBtn.className = "devmode-btn";
    editBtn.textContent = "編集";
    editBtn.onclick = (event) => {
      event.stopPropagation();
      scenarioBuildEditingIfRef = { chapterId: chapter.id, blockId: block.id };
      scenarioBuildMainView = "ifEditor";
      renderScenarioBuildPanel();
    };
    wrap.appendChild(editBtn);
    return wrap;
  }
  
  if (block.type === "jump") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note scenariobuild-condition";
    noteEl.textContent = "指定したブロックへ直接ジャンプします。ifブロックの中からでも、外側や別の分岐のブロックを指定できます（このジャンプブロックより前のブロックを指定すると、ループになります）。";
    wrap.appendChild(noteEl);
    const realChapter = scenarioProject.chapters.find(c => c.id === chapter.id) || chapter; // ★要望対応：fakeChapter（ifの中身等）越しでも、話全体からジャンプ先を選べるようにする
    wrap.appendChild(buildScenarioJumpTargetSelect(realChapter, block.id, block.targetBlockId, (val) => {
      block.targetBlockId = val;
      markScenarioBuildDirty();
      renderScenarioBuildPanel();
    }));
    return wrap;
  }
  
  
  if (block.type === "addcompanion") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note scenariobuild-condition";
    noteEl.textContent = "指定した仲間を、指定したレベルでパーティーに加えます（仲間編集タブで先に登録しておく必要があります）。";
    wrap.appendChild(noteEl);
    
    const idRow = document.createElement("div");
    idRow.className = "scenariobuild-condition-row";
    idRow.appendChild(labelSpan("仲間："));
    const companionSelect = document.createElement("select");
    companionSelect.className = "scenariobuild-jump-select";
    const emptyOpt = document.createElement("option");
    emptyOpt.value = "";
    emptyOpt.textContent = "（選択してください）";
    companionSelect.appendChild(emptyOpt);
    (scenarioProject.companions || []).forEach(c => {
      const optionEl = document.createElement("option");
      optionEl.value = c.id;
      optionEl.textContent = c.name || c.id;
      companionSelect.appendChild(optionEl);
    });
    companionSelect.value = block.companionId || "";
    companionSelect.onchange = () => { block.companionId = companionSelect.value; persist(); };
    idRow.appendChild(companionSelect);
    wrap.appendChild(idRow);
    
    const levelRow = document.createElement("div");
    levelRow.className = "scenariobuild-condition-row";
    levelRow.appendChild(labelSpan("初期レベル："));
    const levelInput = document.createElement("input");
    levelInput.type = "number";
    levelInput.min = "1";
    levelInput.className = "scenariobuild-condition-input";
    levelInput.value = block.initialLevel || 1;
    levelInput.onchange = () => { block.initialLevel = Math.max(1, Number(levelInput.value) || 1); persist(); };
    levelRow.appendChild(levelInput);
    wrap.appendChild(levelRow);
    
    return wrap;
  }
  
  if (block.type === "removecompanion") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note scenariobuild-condition";
    noteEl.textContent = "指定した仲間を、パーティーから一旦外します（レベルや装備は保持され、「仲間追加」ブロックでまた同じ仲間を加えれば、その状態のまま戻ってきます）。";
    wrap.appendChild(noteEl);
    
    const idRow = document.createElement("div");
    idRow.className = "scenariobuild-condition-row";
    idRow.appendChild(labelSpan("仲間："));
    const companionSelect2 = document.createElement("select");
    companionSelect2.className = "scenariobuild-jump-select";
    const emptyOpt2 = document.createElement("option");
    emptyOpt2.value = "";
    emptyOpt2.textContent = "（選択してください）";
    companionSelect2.appendChild(emptyOpt2);
    (scenarioProject.companions || []).forEach(c => {
      const optionEl = document.createElement("option");
      optionEl.value = c.id;
      optionEl.textContent = c.name || c.id;
      companionSelect2.appendChild(optionEl);
    });
    companionSelect2.value = block.companionId || "";
    companionSelect2.onchange = () => { block.companionId = companionSelect2.value; persist(); };
    idRow.appendChild(companionSelect2);
    wrap.appendChild(idRow);
    
    const farewellRow = document.createElement("div");
    farewellRow.className = "scenariobuild-condition-row";
    farewellRow.appendChild(labelSpan("離脱時のメッセージ（空欄なら何も表示しない）："));
    const farewellInput = document.createElement("input");
    farewellInput.type = "text";
    farewellInput.className = "scenariobuild-title-input";
    farewellInput.value = block.farewellMessage || "";
    farewellInput.onchange = () => { block.farewellMessage = farewellInput.value; persist(); };
    farewellRow.appendChild(farewellInput);
    wrap.appendChild(farewellRow);
    
    return wrap;
  }
  
  if (block.type === "portrait_show") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note scenariobuild-condition";
    noteEl.textContent = "「表示ID」は、この立ち絵を後から（表情変更・移動・動き・非表示ブロックで）指し示すための名前です。同時に複数体出す場合は、それぞれ違う表示IDにしてください（同じ表示IDで表示し直すと、その立ち絵の見た目が差し替わります）。位置は0（左端）〜100（右端）、50が中央です。";
    wrap.appendChild(noteEl);
    
    const modeRow = document.createElement("div");
    modeRow.className = "scenariobuild-condition-row";
    modeRow.appendChild(labelSpan("動作："));
    const modeSelect = document.createElement("select");
    modeSelect.className = "scenariobuild-jump-select";
    [["show", "表示する"], ["hide", "非表示にする（指定した表示IDだけ）"], ["hideAll", "全員非表示にする"]].forEach(([value, label]) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      modeSelect.appendChild(opt);
    });
    modeSelect.value = block.mode || "show";
    modeSelect.onchange = () => { block.mode = modeSelect.value; persist(); renderScenarioBuildPanel(); };
    modeRow.appendChild(modeSelect);
    wrap.appendChild(modeRow);
    
    if (block.mode !== "hideAll") {
      const idRow = document.createElement("div");
      idRow.className = "scenariobuild-condition-row";
      idRow.appendChild(labelSpan("表示ID："));
      const idInput = document.createElement("input");
      idInput.type = "text";
      idInput.className = "scenariobuild-title-input";
      idInput.placeholder = "例：tanaka_left";
      idInput.value = block.instanceId || "";
      idInput.onchange = () => { block.instanceId = idInput.value.trim(); persist(); };
      idRow.appendChild(idInput);
      wrap.appendChild(idRow);
    }
    
    if (block.mode === "show") {
      const charRow = document.createElement("div");
      charRow.className = "scenariobuild-condition-row";
      charRow.appendChild(labelSpan("キャラ："));
      const charSelect = document.createElement("select");
      charSelect.className = "scenariobuild-jump-select";
      const emptyCharOpt = document.createElement("option");
      emptyCharOpt.value = "";
      emptyCharOpt.textContent = "（選択してください）";
      charSelect.appendChild(emptyCharOpt);
      scenarioProject.portraitCharacters.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.name || c.id;
        charSelect.appendChild(opt);
      });
      charSelect.value = block.characterId || "";
      charSelect.onchange = () => { block.characterId = charSelect.value; block.expressionId = ""; persist(); renderScenarioBuildPanel(); };
      charRow.appendChild(charSelect);
      wrap.appendChild(charRow);
      
      const exprRow = document.createElement("div");
      exprRow.className = "scenariobuild-condition-row";
      exprRow.appendChild(labelSpan("表情："));
      exprRow.appendChild(buildPortraitExpressionSelect(block.characterId, block.expressionId, (value) => { block.expressionId = value; persist(); }));
      wrap.appendChild(exprRow);
      
      const posRow = document.createElement("div");
      posRow.className = "scenariobuild-condition-row";
      posRow.appendChild(labelSpan("位置（0〜100）："));
      const posInput = document.createElement("input");
      posInput.type = "number";
      posInput.min = "0";
      posInput.max = "100";
      posInput.className = "scenariobuild-condition-input";
      posInput.value = block.position != null ? block.position : 50;
      posInput.onchange = () => { block.position = Math.min(100, Math.max(0, Number(posInput.value))); persist(); };
      posRow.appendChild(posInput);
      wrap.appendChild(posRow);
    }
    
    const fadeRow = document.createElement("div");
    fadeRow.className = "scenariobuild-condition-row";
    fadeRow.appendChild(labelSpan("フェード時間（ミリ秒）："));
    const fadeInput = document.createElement("input");
    fadeInput.type = "number";
    fadeInput.min = "0";
    fadeInput.className = "scenariobuild-condition-input";
    fadeInput.value = block.fadeMs != null ? block.fadeMs : 300;
    fadeInput.onchange = () => { block.fadeMs = Math.max(0, Number(fadeInput.value) || 0); persist(); };
    fadeRow.appendChild(fadeInput);
    wrap.appendChild(fadeRow);
    
    return wrap;
  }
  
  if (block.type === "portrait_expression") {
    const idRow = document.createElement("div");
    idRow.className = "scenariobuild-condition-row";
    idRow.appendChild(labelSpan("表示ID（対象の立ち絵）："));
    const idInput = document.createElement("input");
    idInput.type = "text";
    idInput.className = "scenariobuild-title-input";
    idInput.value = block.instanceId || "";
    idInput.onchange = () => { block.instanceId = idInput.value.trim(); persist(); };
    idRow.appendChild(idInput);
    wrap.appendChild(idRow);
    
    // ★対象の表示IDがどのキャラか分からないと表情候補を出せないため、直近の「立ち絵表示」ブロックから
    //   同じ表示IDでキャラを逆引きする（見つからない時は全キャラの表情を混ぜて候補に出す）
    const linkedShow = chapter.blocks.find(b => b.type === "portrait_show" && b.instanceId === block.instanceId && b.characterId);
    const exprRow = document.createElement("div");
    exprRow.className = "scenariobuild-condition-row";
    exprRow.appendChild(labelSpan("変更後の表情："));
    exprRow.appendChild(buildPortraitExpressionSelect(linkedShow ? linkedShow.characterId : "", block.expressionId, (value) => { block.expressionId = value; persist(); }));
    wrap.appendChild(exprRow);
    if (!linkedShow) {
      const warnEl = document.createElement("p");
      warnEl.className = "devmode-note scenariobuild-condition";
      warnEl.textContent = "同じ話の中に、この表示IDを使った「立ち絵表示」ブロックが見つからないため、表情の候補が表示できません（表示IDのつづりを確認してください）。";
      wrap.appendChild(warnEl);
    }
    
    return wrap;
  }
  
  if (block.type === "portrait_move") {
    const idRow = document.createElement("div");
    idRow.className = "scenariobuild-condition-row";
    idRow.appendChild(labelSpan("表示ID（対象の立ち絵）："));
    const idInput = document.createElement("input");
    idInput.type = "text";
    idInput.className = "scenariobuild-title-input";
    idInput.value = block.instanceId || "";
    idInput.onchange = () => { block.instanceId = idInput.value.trim(); persist(); };
    idRow.appendChild(idInput);
    wrap.appendChild(idRow);
    
    const posRow = document.createElement("div");
    posRow.className = "scenariobuild-condition-row";
    posRow.appendChild(labelSpan("移動先の位置（0〜100）："));
    const posInput = document.createElement("input");
    posInput.type = "number";
    posInput.min = "0";
    posInput.max = "100";
    posInput.className = "scenariobuild-condition-input";
    posInput.value = block.position != null ? block.position : 50;
    posInput.onchange = () => { block.position = Math.min(100, Math.max(0, Number(posInput.value))); persist(); };
    posRow.appendChild(posInput);
    wrap.appendChild(posRow);
    
    const durRow = document.createElement("div");
    durRow.className = "scenariobuild-condition-row";
    durRow.appendChild(labelSpan("移動にかける時間（ミリ秒）："));
    const durInput = document.createElement("input");
    durInput.type = "number";
    durInput.min = "0";
    durInput.className = "scenariobuild-condition-input";
    durInput.value = block.durationMs != null ? block.durationMs : 500;
    durInput.onchange = () => { block.durationMs = Math.max(0, Number(durInput.value) || 0); persist(); };
    durRow.appendChild(durInput);
    wrap.appendChild(durRow);
    
    return wrap;
  }
  
  if (block.type === "portrait_motion") {
    const idRow = document.createElement("div");
    idRow.className = "scenariobuild-condition-row";
    idRow.appendChild(labelSpan("表示ID（対象の立ち絵）："));
    const idInput = document.createElement("input");
    idInput.type = "text";
    idInput.className = "scenariobuild-title-input";
    idInput.value = block.instanceId || "";
    idInput.onchange = () => { block.instanceId = idInput.value.trim(); persist(); };
    idRow.appendChild(idInput);
    wrap.appendChild(idRow);
    
    const motionRow = document.createElement("div");
    motionRow.className = "scenariobuild-condition-row";
    motionRow.appendChild(labelSpan("動きの種類："));
    const motionSelect = document.createElement("select");
    motionSelect.className = "scenariobuild-jump-select";
    [["jump", "小さくジャンプ"], ["shake", "震える"]].forEach(([value, label]) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      motionSelect.appendChild(opt);
    });
    motionSelect.value = block.motionType || "jump";
    motionSelect.onchange = () => { block.motionType = motionSelect.value; persist(); };
    motionRow.appendChild(motionSelect);
    wrap.appendChild(motionRow);
    
    return wrap;
  }
  
  if (block.type === "increment_area_visit") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note scenariobuild-condition";
    noteEl.textContent = "選んだエリアの「来訪回数」を1増やします（マップ設定側で、そのエリアの「来訪回数の増やし方」が「手動」になっている場合の増やし方です）。";
    wrap.appendChild(noteEl);
    
    const areaRow = document.createElement("div");
    areaRow.className = "scenariobuild-condition-row";
    areaRow.appendChild(labelSpan("対象のエリア："));
    const areaSelect = document.createElement("select");
    areaSelect.className = "scenariobuild-jump-select";
    scenarioProject.mapAreas.forEach(a => {
      const option = document.createElement("option");
      // ★バグ修正：上の開始トリガーと同じ理由で、カスタムエリアのフォールバックキーに合わせる
      const key = a.locationKey || ("custom_" + a.id);
      option.value = key;
      option.textContent = a.name || key;
      areaSelect.appendChild(option);
    });
    areaSelect.value = block.areaKey || "";
    areaSelect.onchange = () => { block.areaKey = areaSelect.value; persist(); };
    areaRow.appendChild(areaSelect);
    wrap.appendChild(areaRow);
    
    return wrap;
  }
  
  if (block.type === "battle") {
    wrap.appendChild(buildTagListEditor({
      label: "敵ID（最大5体・同じIDを複数回追加すると同じ敵が複数体出ます。ボスIDを混ぜることも可能です）：",
      items: block.enemies,
      datalistId: "scenariobuild-monster-datalist",
      placeholder: "敵ID",
      onChange: persist,
      maxItems: 5
    }));
    
    // ★要望対応：敵のレベルを指定できるように（空欄なら今まで通り主人公のレベル±1で決まる）
    const levelRow = document.createElement("div");
    levelRow.className = "scenariobuild-condition-row";
    levelRow.appendChild(labelSpan("敵のレベル（空欄＝主人公のレベル±1で自動決定）："));
    const levelInput = document.createElement("input");
    levelInput.type = "number";
    levelInput.min = "1";
    levelInput.className = "scenariobuild-condition-input";
    levelInput.value = block.level != null ? block.level : "";
    levelInput.placeholder = "自動";
    levelInput.onchange = () => {
      const num = Number(levelInput.value);
      block.level = levelInput.value.trim() === "" ? null : Math.max(1, Math.floor(num) || 1);
      persist();
    };
    levelRow.appendChild(levelInput);
    wrap.appendChild(levelRow);
    
    const winRow = document.createElement("div");
    winRow.className = "scenariobuild-condition-row";
    winRow.appendChild(labelSpan("勝利時の分岐："));
    winRow.appendChild(buildBlockJumpSelect(chapter, block.id, block.winJumpBlockId, (value) => { block.winJumpBlockId = value; persist(); }));
    wrap.appendChild(winRow);
    
    const defeatRow = document.createElement("div");
    defeatRow.className = "scenariobuild-condition-row";
    defeatRow.appendChild(labelSpan("敗北時の分岐："));
    defeatRow.appendChild(buildBlockJumpSelect(chapter, block.id, block.defeatJumpBlockId, (value) => { block.defeatJumpBlockId = value; persist(); }));
    wrap.appendChild(defeatRow);
    return wrap;
  }
  
  if (block.type === "bossbattle") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note scenariobuild-condition";
    noteEl.textContent = "ボス設定タブに登録したボスとの戦闘専用ブロックです。専用BGM・無敵解除アイテムなど、ボスならではの設定はボス設定タブ側で行います。";
    wrap.appendChild(noteEl);
    
    const bossInput = document.createElement("input");
    bossInput.type = "text";
    bossInput.className = "scenariobuild-title-input";
    bossInput.placeholder = "ボスID（ボス設定タブ参照）";
    bossInput.value = block.bossKey;
    bossInput.setAttribute("list", "scenariobuild-boss-datalist");
    bossInput.onchange = () => { block.bossKey = bossInput.value.trim(); persist(); };
    wrap.appendChild(bossInput);
    
    wrap.appendChild(buildTagListEditor({
      label: "一緒に出す雑魚（任意・最大4体）：",
      items: block.escorts,
      datalistId: "scenariobuild-monster-datalist",
      placeholder: "敵ID",
      onChange: persist,
      maxItems: 4
    }));
    
    const winRow = document.createElement("div");
    winRow.className = "scenariobuild-condition-row";
    winRow.appendChild(labelSpan("勝利時の分岐："));
    winRow.appendChild(buildBlockJumpSelect(chapter, block.id, block.winJumpBlockId, (value) => { block.winJumpBlockId = value; persist(); }));
    wrap.appendChild(winRow);
    
    const defeatRow = document.createElement("div");
    defeatRow.className = "scenariobuild-condition-row";
    defeatRow.appendChild(labelSpan("敗北時の分岐："));
    defeatRow.appendChild(buildBlockJumpSelect(chapter, block.id, block.defeatJumpBlockId, (value) => { block.defeatJumpBlockId = value; persist(); }));
    wrap.appendChild(defeatRow);
    return wrap;
  }
  
  if (block.type === "choice") {
    const promptInput = document.createElement("input");
    promptInput.type = "text";
    promptInput.className = "scenariobuild-title-input";
    promptInput.placeholder = "選択肢を出す前に見せる一言（任意）";
    promptInput.value = block.prompt;
    promptInput.onchange = () => { block.prompt = promptInput.value; persist(); };
    wrap.appendChild(promptInput);
    
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note scenariobuild-condition";
    noteEl.textContent = "「ループ」：選んでも話が先に進まない（同じ場面に戻ってくる）選択肢の目印です。「正解」：話が先に進む方の選択肢の目印です。どちらも、設定タブの「正解の選択肢を表示」がONの時だけ実際に表示されます（OFFの時は、ループの目印だけ出ていると消去法で正解がバレてしまうため、両方とも表示されません）。見た目の目印だけで、実際の分岐先はジャンプ先の指定でそのまま動きます。";
    wrap.appendChild(noteEl);
    
    block.options.forEach((option, optIndex) => {
      const optRow = document.createElement("div");
      optRow.className = "scenariobuild-condition-row";
      
      const optInput = document.createElement("input");
      optInput.type = "text";
      optInput.className = "scenariobuild-title-input";
      optInput.placeholder = `選択肢${optIndex + 1}`;
      optInput.value = option.text;
      optInput.onchange = () => { option.text = optInput.value; persist(); };
      
      const jumpSelect = buildBlockJumpSelect(chapter, block.id, option.jumpBlockId, (value) => { option.jumpBlockId = value; persist(); });
      jumpSelect.title = "旧方式（上級者向け）：ブロック一覧内の特定の場所へ直接ジャンプします。「編集」で内容を書いた場合はこちらは使われません。";
      
      const statusEl = document.createElement("span");
      statusEl.className = "devmode-note scenariobuild-condition";
      const contentCount = Array.isArray(option.blocks) ? option.blocks.length : 0;
      statusEl.textContent = contentCount > 0 ? `（内容：${contentCount}ブロック）` : "（内容未設定）";
      
      const editContentBtn = document.createElement("button");
      editContentBtn.className = "devmode-btn";
      editContentBtn.textContent = "編集";
      editContentBtn.onclick = (event) => {
        event.stopPropagation();
        if (!Array.isArray(option.blocks)) option.blocks = [];
        persist();
        scenarioBuildEditingOptionRef = { chapterId: chapter.id, blockId: block.id, optionId: option.id };
        scenarioBuildMainView = "optionEditor";
        renderScenarioBuildPanel();
      };
      
      const loopLabel = document.createElement("label");
      loopLabel.className = "scenariobuild-inline-checkbox";
      const loopCheckbox = document.createElement("input");
      loopCheckbox.type = "checkbox";
      loopCheckbox.checked = !!option.loops;
      loopCheckbox.onchange = () => { option.loops = loopCheckbox.checked; persist(); };
      loopLabel.appendChild(loopCheckbox);
      loopLabel.appendChild(document.createTextNode("↻ループ"));
      
      const correctLabel = document.createElement("label");
      correctLabel.className = "scenariobuild-inline-checkbox";
      const correctCheckbox = document.createElement("input");
      correctCheckbox.type = "checkbox";
      correctCheckbox.checked = !!option.isCorrect;
      correctCheckbox.onchange = () => { option.isCorrect = correctCheckbox.checked; persist(); };
      correctLabel.appendChild(correctCheckbox);
      correctLabel.appendChild(document.createTextNode("★正解"));
      
      const removeOptBtn = document.createElement("button");
      removeOptBtn.className = "devmode-btn devmode-btn-danger";
      removeOptBtn.textContent = "×";
      removeOptBtn.disabled = block.options.length <= 1;
      removeOptBtn.onclick = (event) => {
        event.stopPropagation();
        block.options.splice(optIndex, 1);
        persist();
        renderScenarioBuildPanel();
      };
      
      optRow.appendChild(optInput);
      optRow.appendChild(editContentBtn);
      optRow.appendChild(statusEl);
      optRow.appendChild(loopLabel);
      optRow.appendChild(correctLabel);
      optRow.appendChild(removeOptBtn);
      
      const legacyRow = document.createElement("div");
      legacyRow.className = "scenariobuild-condition-row scenariobuild-legacy-jump-row";
      legacyRow.appendChild(labelSpan("（旧方式）直接ジャンプ先："));
      legacyRow.appendChild(jumpSelect);
      wrap.appendChild(optRow);
      wrap.appendChild(legacyRow);
    });
    
    const addOptBtn = document.createElement("button");
    addOptBtn.className = "devmode-btn";
    addOptBtn.textContent = "＋選択肢を追加";
    addOptBtn.onclick = (event) => {
      event.stopPropagation();
      block.options.push({ id: generateId("opt"), text: "", blocks: [], jumpBlockId: null, loops: false, isCorrect: false });
      persist();
      renderScenarioBuildPanel();
    };
    wrap.appendChild(addOptBtn);
    return wrap;
  }
  
  if (block.type === "effect") {
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    row.appendChild(labelSpan("種類："));
    const select = document.createElement("select");
    select.className = "scenariobuild-jump-select";
    const groups = [
      ["揺れ・フラッシュ", [
        ["shake", "カメラシェイク"],
        ["flash", "ヒットエフェクト（赤フラッシュ）"],
        ["flashWhite", "白フラッシュ（閃光・衝撃）"]
      ]],
      ["色調フィルター（回想・異常事態など）", [
        ["monochromeOn", "モノクロにする"],
        ["monochromeOff", "モノクロを解除する"],
        ["sepiaOn", "セピア調にする"],
        ["sepiaOff", "セピア調を解除する"],
        ["invertOn", "色反転にする"],
        ["invertOff", "色反転を解除する"],
        ["blurOn", "画面をぼかす（意識朦朧・夢の中）"],
        ["blurOff", "ぼかしを解除する"]
      ]],
      ["暗転・強調", [
        ["blackoutOn", "暗転する（画面を黒くフェードアウト）"],
        ["blackoutOff", "暗転を解除する（画面を元に戻す）"],
        ["vignetteOn", "画面端を暗くする（緊張感・集中演出）"],
        ["vignetteOff", "画面端の暗さを解除する"],
        ["zoomIn", "画面をズームする（強調）"],
        ["zoomOut", "ズームを戻す"]
      ]],
      ["天候演出", [
        ["weatherRainOn", "雨を降らせる"],
        ["weatherSnowOn", "雪を降らせる"],
        ["weatherSakuraOn", "桜吹雪を降らせる"],
        ["weatherOff", "天候演出をやめる"]
      ]]
    ];
    groups.forEach(([groupLabel, options]) => {
      const optgroup = document.createElement("optgroup");
      optgroup.label = groupLabel;
      options.forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        optgroup.appendChild(option);
      });
      select.appendChild(optgroup);
    });
    select.value = block.effectType;
    select.onchange = () => { block.effectType = select.value; persist(); };
    row.appendChild(select);
    wrap.appendChild(row);
    return wrap;
  }
  
  if (block.type === "background") {
    const pathInput = document.createElement("input");
    pathInput.type = "text";
    pathInput.className = "scenariobuild-title-input";
    pathInput.placeholder = "画像パス（例：img/村.jpeg）または色コード（例：#000000）";
    pathInput.value = block.path;
    pathInput.onchange = () => { block.path = pathInput.value.trim(); persist(); };
    wrap.appendChild(pathInput);
    return wrap;
  }
  
  if (block.type === "gameover") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note scenariobuild-condition";
    noteEl.textContent = "テロップとして表示され、この話の実行はここで終わります。ゲームオーバーは一種のバッドエンディングとして扱われるので、エンディング名も設定できます（エンディング一覧タブにも表示されます）。「リトライ」を選んだ時の戻り先も指定できます（未指定なら話の最初から）。";
    wrap.appendChild(noteEl);
    const textArea = document.createElement("textarea");
    textArea.className = "scenariobuild-textarea";
    textArea.placeholder = "表示するメッセージ";
    textArea.value = block.message;
    textArea.onchange = () => { block.message = textArea.value; persist(); };
    wrap.appendChild(textArea);
    
    const endingNameInput = document.createElement("input");
    endingNameInput.type = "text";
    endingNameInput.className = "scenariobuild-title-input";
    endingNameInput.placeholder = "エンディング名（任意。例：田中ソード）";
    endingNameInput.value = block.endingName || "";
    endingNameInput.onchange = () => { block.endingName = endingNameInput.value; persist(); };
    wrap.appendChild(labelSpan("エンディング名："));
    wrap.appendChild(endingNameInput);
    
    const retryRow = document.createElement("div");
    retryRow.className = "scenariobuild-condition-row";
    retryRow.appendChild(labelSpan("「リトライ」の戻り先："));
    const retrySelect = document.createElement("select");
    retrySelect.className = "scenariobuild-jump-select";
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "（話の最初から）";
    retrySelect.appendChild(defaultOption);
    chapter.blocks.forEach((b, index) => {
      if (b.id === block.id) return;
      const option = document.createElement("option");
      option.value = b.id;
      option.textContent = `${index + 1}. ${SCENARIO_BLOCK_TYPES[b.type] || b.type}${blockPreviewText(b) ? "：" + blockPreviewText(b) : ""}`;
      retrySelect.appendChild(option);
    });
    retrySelect.value = block.retryJumpBlockId || "";
    retrySelect.onchange = () => { block.retryJumpBlockId = retrySelect.value || null; persist(); };
    retryRow.appendChild(retrySelect);
    wrap.appendChild(retryRow);
    return wrap;
  }
  
  if (block.type === "ending") {
    const typeRow = document.createElement("div");
    typeRow.className = "scenariobuild-condition-row";
    typeRow.appendChild(labelSpan("種類："));
    const typeSelect = document.createElement("select");
    typeSelect.className = "scenariobuild-jump-select";
    [["bad", "バッドエンディング"], ["true", "トゥルーエンディング"], ["happy", "ハッピーエンディング"]].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      typeSelect.appendChild(option);
    });
    typeSelect.value = block.endingType;
    typeSelect.onchange = () => { block.endingType = typeSelect.value; persist(); };
    typeRow.appendChild(typeSelect);
    wrap.appendChild(typeRow);
    
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "scenariobuild-title-input";
    titleInput.placeholder = "エンディングタイトル（テロップ表示）";
    titleInput.value = block.title;
    titleInput.onchange = () => { block.title = titleInput.value; persist(); };
    wrap.appendChild(titleInput);
    
    // ★エンドロールを流すかどうかは、エンディングの種類に関わらず、ここで独立してON/OFFできる
    const endrollToggleRow = document.createElement("div");
    endrollToggleRow.className = "scenariobuild-condition-row";
    const endrollToggle = document.createElement("input");
    endrollToggle.type = "checkbox";
    endrollToggle.checked = block.endrollEnabled !== false;
    endrollToggle.onchange = () => { block.endrollEnabled = endrollToggle.checked; persist(); renderScenarioBuildPanel(); };
    endrollToggleRow.appendChild(endrollToggle);
    endrollToggleRow.appendChild(labelSpan("エンドロールを流す"));
    wrap.appendChild(endrollToggleRow);
    
    if (block.endrollEnabled !== false) {
      const endrollNote = document.createElement("p");
      endrollNote.className = "devmode-note scenariobuild-condition";
      endrollNote.textContent = "タイトル表示のあとにエンドロールが流れます（下から上へスクロール、スキップ可）。最後の行が画面上部まで来たところで3秒静止し、そのあと画面が白くフェードしてタイトル画面に戻ります。";
      wrap.appendChild(endrollNote);
      const endrollArea = document.createElement("textarea");
      endrollArea.className = "scenariobuild-textarea";
      endrollArea.style.minHeight = "100px";
      endrollArea.placeholder = "エンドロールに流す文章（改行OK）";
      endrollArea.value = block.endroll;
      endrollArea.onchange = () => { block.endroll = endrollArea.value; persist(); };
      wrap.appendChild(endrollArea);
      
      const endrollBgmInput = document.createElement("input");
      endrollBgmInput.type = "text";
      endrollBgmInput.className = "scenariobuild-title-input";
      endrollBgmInput.placeholder = "エンドロール中のBGM（曲名 or パス。任意）";
      endrollBgmInput.value = block.endrollBgm || "";
      endrollBgmInput.setAttribute("list", "scenariobuild-bgm-datalist");
      endrollBgmInput.onchange = () => { block.endrollBgm = endrollBgmInput.value.trim(); persist(); };
      wrap.appendChild(labelSpan("エンドロールBGM："));
      wrap.appendChild(endrollBgmInput);
      
      const endrollSpeedRow = document.createElement("div");
      endrollSpeedRow.className = "scenariobuild-condition-row";
      endrollSpeedRow.appendChild(labelSpan("スクロール秒数（長いほどゆっくり）："));
      const endrollSpeedInput = document.createElement("input");
      endrollSpeedInput.type = "number";
      endrollSpeedInput.min = "5";
      endrollSpeedInput.className = "scenariobuild-condition-input";
      endrollSpeedInput.value = block.endrollScrollSeconds || 20;
      endrollSpeedInput.onchange = () => { block.endrollScrollSeconds = Math.max(5, Number(endrollSpeedInput.value) || 20); persist(); };
      endrollSpeedRow.appendChild(endrollSpeedInput);
      wrap.appendChild(endrollSpeedRow);
      
      const endrollFadeRow = document.createElement("div");
      endrollFadeRow.className = "scenariobuild-condition-row";
      endrollFadeRow.appendChild(labelSpan("終了時のBGMフェードアウト秒数（空欄で4秒）："));
      const endrollFadeInput = document.createElement("input");
      endrollFadeInput.type = "number";
      endrollFadeInput.min = "0";
      endrollFadeInput.step = "0.5";
      endrollFadeInput.className = "scenariobuild-condition-input";
      endrollFadeInput.placeholder = "4";
      endrollFadeInput.value = block.endrollBgmFadeSeconds != null ? block.endrollBgmFadeSeconds : "";
      endrollFadeInput.onchange = () => {
        const raw = endrollFadeInput.value.trim();
        block.endrollBgmFadeSeconds = raw === "" ? null : Math.max(0, Number(raw) || 0);
        persist();
      };
      endrollFadeRow.appendChild(endrollFadeInput);
      wrap.appendChild(endrollFadeRow);
    }
    
    const clearNote = document.createElement("p");
    clearNote.className = "devmode-note scenariobuild-condition";
    clearNote.textContent = "このブロックに到達すると、この話は「クリア済み」扱いになり（進行度は0にリセットされます）、実行はここで終わってタイトル画面に戻ります。物語としてはまだ完結しない場面（冒険がそのまま続く等）には「話クリア設定」ブロックを使ってください。";
    wrap.appendChild(clearNote);
    return wrap;
  }
  
  if (block.type === "clearchapter") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note scenariobuild-condition";
    noteEl.textContent = "「エンディング」と違い、タイトル画面には戻らず、この後に続くブロックがあればそのまま実行を続けます（無ければ、いつも通り村に戻ります）。この話が終わったことにはしたいが、物語としてはまだ完結せず冒険が続く場面（新しい仲間が加わる、など）に使います。";
    wrap.appendChild(noteEl);
    
    const resetRow = document.createElement("div");
    resetRow.className = "scenariobuild-condition-row";
    const resetCheckbox = document.createElement("input");
    resetCheckbox.type = "checkbox";
    resetCheckbox.checked = block.resetProgress !== false;
    resetCheckbox.onchange = () => { block.resetProgress = resetCheckbox.checked; persist(); };
    resetRow.appendChild(resetCheckbox);
    resetRow.appendChild(labelSpan("進行度を0にリセットする"));
    wrap.appendChild(resetRow);
    
    // ★要望対応：エンディングでなくても、話クリアのタイミングでエンドロールを流せるようにする。
    //   タイトル画面には戻らないので、流し終わったらそのまま後続のブロックへ進む
    const endrollToggleRow = document.createElement("div");
    endrollToggleRow.className = "scenariobuild-condition-row";
    const endrollToggle = document.createElement("input");
    endrollToggle.type = "checkbox";
    endrollToggle.checked = block.endrollEnabled === true;
    endrollToggle.onchange = () => { block.endrollEnabled = endrollToggle.checked; persist(); renderScenarioBuildPanel(); };
    endrollToggleRow.appendChild(endrollToggle);
    endrollToggleRow.appendChild(labelSpan("この話クリアでもエンドロールを流す"));
    wrap.appendChild(endrollToggleRow);
    
    if (block.endrollEnabled === true) {
      const endrollNote = document.createElement("p");
      endrollNote.className = "devmode-note scenariobuild-condition";
      endrollNote.textContent = "この話クリアの時点でエンドロールが流れます（下から上へスクロール、早送り可）。流し終わったらタイトル画面には戻らず、そのまま続きのブロックを実行します。";
      wrap.appendChild(endrollNote);
      const endrollArea = document.createElement("textarea");
      endrollArea.className = "scenariobuild-textarea";
      endrollArea.style.minHeight = "100px";
      endrollArea.placeholder = "エンドロールに流す文章（改行OK）";
      endrollArea.value = block.endroll;
      endrollArea.onchange = () => { block.endroll = endrollArea.value; persist(); };
      wrap.appendChild(endrollArea);
      
      const endrollBgmInput = document.createElement("input");
      endrollBgmInput.type = "text";
      endrollBgmInput.className = "scenariobuild-title-input";
      endrollBgmInput.placeholder = "エンドロール中のBGM（曲名 or パス。任意）";
      endrollBgmInput.value = block.endrollBgm || "";
      endrollBgmInput.setAttribute("list", "scenariobuild-bgm-datalist");
      endrollBgmInput.onchange = () => { block.endrollBgm = endrollBgmInput.value.trim(); persist(); };
      wrap.appendChild(labelSpan("エンドロールBGM："));
      wrap.appendChild(endrollBgmInput);
      
      const endrollSpeedRow = document.createElement("div");
      endrollSpeedRow.className = "scenariobuild-condition-row";
      endrollSpeedRow.appendChild(labelSpan("スクロール秒数（長いほどゆっくり）："));
      const endrollSpeedInput = document.createElement("input");
      endrollSpeedInput.type = "number";
      endrollSpeedInput.min = "5";
      endrollSpeedInput.className = "scenariobuild-condition-input";
      endrollSpeedInput.value = block.endrollScrollSeconds || 20;
      endrollSpeedInput.onchange = () => { block.endrollScrollSeconds = Math.max(5, Number(endrollSpeedInput.value) || 20); persist(); };
      endrollSpeedRow.appendChild(endrollSpeedInput);
      wrap.appendChild(endrollSpeedRow);
      
      const endrollFadeRow = document.createElement("div");
      endrollFadeRow.className = "scenariobuild-condition-row";
      endrollFadeRow.appendChild(labelSpan("終了時のBGMフェードアウト秒数（空欄で4秒）："));
      const endrollFadeInput = document.createElement("input");
      endrollFadeInput.type = "number";
      endrollFadeInput.min = "0";
      endrollFadeInput.step = "0.5";
      endrollFadeInput.className = "scenariobuild-condition-input";
      endrollFadeInput.placeholder = "4";
      endrollFadeInput.value = block.endrollBgmFadeSeconds != null ? block.endrollBgmFadeSeconds : "";
      endrollFadeInput.onchange = () => {
        const raw = endrollFadeInput.value.trim();
        block.endrollBgmFadeSeconds = raw === "" ? null : Math.max(0, Number(raw) || 0);
        persist();
      };
      endrollFadeRow.appendChild(endrollFadeInput);
      wrap.appendChild(endrollFadeRow);
    }
    return wrap;
  }
  
  return wrap;
}

function labelSpan(text) {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

function buildCharacterDatalist() {
  const datalist = document.createElement("datalist");
  datalist.id = "scenariobuild-character-datalist";
  scenarioProject.characters.forEach(character => {
    const option = document.createElement("option");
    option.value = character.name;
    datalist.appendChild(option);
  });
  return datalist;
}

function buildMonsterDatalist() {
  const datalist = document.createElement("datalist");
  datalist.id = "scenariobuild-monster-datalist";
  scenarioProject.enemies.forEach(enemy => {
    const option = document.createElement("option");
    option.value = enemy.id;
    option.label = enemy.name;
    datalist.appendChild(option);
  });
  scenarioProject.bosses.forEach(boss => {
    const option = document.createElement("option");
    option.value = boss.id;
    option.label = boss.name;
    datalist.appendChild(option);
  });
  return datalist;
}

// ★ボス戦闘ブロックのボスID欄専用：ボス設定タブに登録されているものだけを候補に出す
function buildBossOnlyDatalist() {
  const datalist = document.createElement("datalist");
  datalist.id = "scenariobuild-boss-datalist";
  scenarioProject.bosses.forEach(boss => {
    const option = document.createElement("option");
    option.value = boss.id;
    option.label = boss.name;
    datalist.appendChild(option);
  });
  return datalist;
}

// ★組み込みの曲名（bgm.jsのBGM_TRACK_PATHS）＋BGM設定タブで登録した曲名に加えて、
//   実際に用意されているファイルのパスそのものも候補に出す（「town」等の内部名だけでなく、
//   ファイルパスを直接選べるようにしてほしいという要望への対応）
function buildBgmDatalist() {
  const datalist = document.createElement("datalist");
  datalist.id = "scenariobuild-bgm-datalist";
  const names = typeof BGM_TRACK_PATHS !== "undefined" ? Object.keys(BGM_TRACK_PATHS) : [];
  const seenPaths = new Set();
  names.forEach(name => {
    const option = document.createElement("option");
    option.value = name;
    option.label = typeof BGM_TRACK_PATHS !== "undefined" ? BGM_TRACK_PATHS[name] : "";
    datalist.appendChild(option);
    if (typeof BGM_TRACK_PATHS !== "undefined") seenPaths.add(BGM_TRACK_PATHS[name]);
  });
  const files = typeof BGM_LIBRARY_FILES !== "undefined" ? BGM_LIBRARY_FILES : [];
  files.forEach(path => {
    if (seenPaths.has(path)) return; // ★既に曲名（例：town）で候補に出ているファイルは、二重に出さない
    const option = document.createElement("option");
    option.value = path;
    datalist.appendChild(option);
  });
  return datalist;
}

// ★BGM設定タブの「ファイルパス」欄専用：実ファイルのパスのみを候補として出す
function buildBgmFileDatalist() {
  const datalist = document.createElement("datalist");
  datalist.id = "scenariobuild-bgmfile-datalist";
  const files = typeof BGM_LIBRARY_FILES !== "undefined" ? BGM_LIBRARY_FILES : [];
  files.forEach(path => {
    const option = document.createElement("option");
    option.value = path;
    datalist.appendChild(option);
  });
  return datalist;
}

function buildItemDatalist() {
  const datalist = document.createElement("datalist");
  datalist.id = "scenariobuild-item-datalist";
  scenarioProject.items.forEach(item => {
    const option = document.createElement("option");
    option.value = item.id;
    option.label = item.name;
    datalist.appendChild(option);
  });
  return datalist;
}

// ★要望対応：釣り場の「出現する魚」欄で、魚管理タブに登録した魚のIDを選びやすくするための入力候補
function buildFishDatalist() {
  const datalist = document.createElement("datalist");
  datalist.id = "scenariobuild-fish-datalist";
  (scenarioProject.fishItems || []).forEach(fish => {
    const option = document.createElement("option");
    option.value = fish.id;
    option.label = fish.name;
    datalist.appendChild(option);
  });
  return datalist;
}

// ===================================================================
// ===== サブ画面：キャラ／敵／ボス／アイテムの管理（共通パターン） =====
// ===================================================================
function getCharacterManagerConfig() {
  return {
    note: "会話ブロックの話者名の候補として使えます。既に本編で登場しているキャラ名も一覧に出ています（メモを追加したり、不要なら削除できます）。名前を変更すると、既存の会話ブロックの話者名も自動でまとめて変更されます。「分類」で、複数の話をまたいで出てくる「メインキャラ」か、特定の話にしか出てこない「話専用キャラ」かを分けて管理できます（あとから変更も可能）。",
    category: "characters",
    getList: () => scenarioProject.characters,
    fields: [
      { key: "name", label: "名前", type: "text", placeholder: "キャラ名" },
      { key: "kind", label: "分類", type: "select", options: [{ value: "main", label: "メインキャラ" }, { value: "chapter", label: "話専用キャラ" }] },
      { key: "note", label: "メモ", type: "text", placeholder: "見た目や設定など（任意）" }
    ],
    newEntity: () => ({ id: generateId("char"), name: "", note: "", kind: "chapter" }),
    cascadeRenameField: "name",
    onRename: (oldName, newName) => cascadeRenameInBlocks("character", oldName, newName),
    filterField: "kind",
    filterDefault: "chapter",
    filterOptions: [
      { value: "main", label: "メインキャラ" },
      { value: "chapter", label: "話専用キャラ" }
    ]
  };
}

// ★キャラ名・BGM名を変更した時に、既存の会話ブロック（話者名）・BGMブロック（曲名指定）を
//   まとめて追従させる。kindは"character"（dialogueブロックのspeaker）または"bgm"（bgmブロックのtrack）
function cascadeRenameInBlocks(kind, oldName, newName) {
  if (!oldName || oldName === newName) return;
  let changedCount = 0;
  scenarioProject.chapters.forEach(chapter => {
    (chapter.blocks || []).forEach(block => {
      if (kind === "character" && block.type === "dialogue" && block.speaker === oldName) {
        block.speaker = newName;
        changedCount++;
      }
      if (kind === "bgm" && block.type === "bgm" && block.track === oldName) {
        block.track = newName;
        changedCount++;
      }
    });
  });
  // ★マップ設定のBGM欄も、名前で指定していれば追従させる
  if (kind === "bgm" && Array.isArray(scenarioProject.mapAreas)) {
    scenarioProject.mapAreas.forEach(area => {
      if (area.bgTrack === oldName) { area.bgTrack = newName; changedCount++; }
    });
  }
  if (changedCount > 0) markScenarioBuildDirty();
}

function getEnemyManagerConfig() {
  return {
    note: "既にいる敵（enemy.js）も一覧に出ており、直接編集・削除できます（実際のゲームデータそのものが変わります）。ここで作った敵は、戦闘ブロックの魔物IDにこのIDを入れれば実際にテストプレイで戦えます。",
    category: "enemies",
    useDetailEditor: true,
    showLevelPreview: true,
    getList: () => scenarioProject.enemies,
    fields: [
      { key: "name", label: "名前", type: "text", placeholder: "敵の名前" },
      { key: "description", label: "説明", type: "text", placeholder: "（任意）" },
      { key: "maxHp", label: "HP", type: "number", placeholder: "10" },
      { key: "atk", label: "攻撃力", type: "number", placeholder: "5" },
      { key: "exp", label: "経験値", type: "number", placeholder: "10" },
      { key: "imagePath", label: "画像パス", type: "text", placeholder: "例：img/敵/goblin.png（空欄なら img/敵/名前.png を使う）" },
      { key: "sizeMultiplier", label: "大きさ倍率", type: "number", placeholder: "1.0（例：1.2で少し大きく、0.8で少し小さく）" }
    ],
    newEntity: () => ({ id: generateId("enemy"), name: "", description: "", maxHp: 10, atk: 5, exp: 10, imagePath: "", sizeMultiplier: 1, dropItemId: null, dropRate: 0, killFlavor: "", spareFlavor: "", giftItemId: null, uniqueSkill: null, statusInflictions: [], normalAttackStatusInflictions: [], statusImmunities: [], statusResistances: {}, restSkillName: "", restSkillBlocks: [], affectionGainRange: [5, 10], killBlocks: [], spareBlocks: [] }),
    onChange: ensureCustomMonstersRegistered,
    getDefaultFromMaster: (id) => {
      const master = typeof ENEMY_MASTER !== "undefined" ? ENEMY_MASTER[id] : null;
      if (!master) return null;
      return {
        name: master.name, description: master.description || "", maxHp: master.maxHp, atk: master.atk, exp: master.exp, imagePath: master.imagePath || "",
        sizeMultiplier: (typeof master.sizeMultiplier === "number" && master.sizeMultiplier > 0) ? master.sizeMultiplier : 1,
        dropItemId: master.dropItemId || null, dropRate: master.dropRate || 0,
        killFlavor: master.killFlavor || "", spareFlavor: master.spareFlavor || "", giftItemId: master.giftItemId || null,
        uniqueSkill: master.uniqueSkill ? { ...master.uniqueSkill } : null,
        // ★要望対応：statusInflictionsは専用スキル発動時の状態異常として使うため、既存データのみそのまま引き継ぐ。
        //   古いpoisonChanceだけのデータ（従来ずっと通常攻撃で毒になっていた）は、通常攻撃用の欄に引き継ぐ
        statusInflictions: Array.isArray(master.statusInflictions) ? master.statusInflictions.map(s => ({ ...s })) : [],
        normalAttackStatusInflictions: Array.isArray(master.normalAttackStatusInflictions) ? master.normalAttackStatusInflictions.map(s => ({ ...s }))
          : (master.poisonChance ? [{ kind: "poison", chance: master.poisonChance, duration: 3, power: 0 }] : []),
        // ★要望対応：この魔物自身の状態異常耐性・無効
        statusImmunities: Array.isArray(master.statusImmunities) ? [...master.statusImmunities] : [],
        statusResistances: master.statusResistances && typeof master.statusResistances === "object" ? { ...master.statusResistances } : {}
      };
    }
  };
}

// ★要望対応：試練の祭殿の「試練の守護者」の強さを、ランクごとに手動で指定できるようにする
//   （未指定のランクは今まで通り、挑むランクに応じた自動計算式で決まる）
function renderTrialGuardianConfig(container) {
  if (!scenarioProject.trialGuardianOverrides || typeof scenarioProject.trialGuardianOverrides !== "object") scenarioProject.trialGuardianOverrides = {};
  const persist = () => markScenarioBuildDirty();
  
  const wrap = document.createElement("div");
  wrap.className = "scenariobuild-list";
  const titleEl = document.createElement("h3");
  titleEl.textContent = "試練の守護者（試練の祭殿）のランク別設定";
  wrap.appendChild(titleEl);
  const noteEl = document.createElement("p");
  noteEl.className = "devmode-note";
  noteEl.textContent = "各項目を空欄のままにすると、今まで通り「挑むランクに応じた自動計算」で強さが決まります。数値を入れたランクだけ、その数値がそのまま使われます。";
  wrap.appendChild(noteEl);
  
  RANK_ORDER.forEach(rank => {
    if (!scenarioProject.trialGuardianOverrides[rank]) scenarioProject.trialGuardianOverrides[rank] = { level: null, maxHp: null, atk: null };
    const entry = scenarioProject.trialGuardianOverrides[rank];
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    row.appendChild(labelSpan(`${rank}ランク：`));
    [["level", "レベル"], ["maxHp", "最大HP"], ["atk", "攻撃力"]].forEach(([field, label]) => {
      row.appendChild(labelSpan(label + "："));
      const input = document.createElement("input");
      input.type = "number";
      input.min = "1";
      input.className = "scenariobuild-condition-input";
      input.placeholder = "自動";
      input.value = entry[field] != null ? entry[field] : "";
      input.onchange = () => {
        const num = Number(input.value);
        entry[field] = input.value.trim() === "" ? null : Math.max(1, Math.floor(num) || 1);
        persist();
      };
      row.appendChild(input);
    });
    wrap.appendChild(row);
  });
  container.appendChild(wrap);
}

// ★要望対応：各ランクへ上がるのに必要な名声度を指定できるようにする（questboard.jsのFAME_RANK_THRESHOLDSを上書きする）
function renderFameThresholdConfig(container) {
  if (!scenarioProject.fameThresholds || typeof scenarioProject.fameThresholds !== "object") scenarioProject.fameThresholds = {};
  const persist = () => { markScenarioBuildDirty(); ensureCustomFameThresholdsRegistered(); };
  
  const wrap = document.createElement("div");
  wrap.className = "scenariobuild-list";
  const titleEl = document.createElement("h3");
  titleEl.textContent = "ランクアップに必要な名声度";
  wrap.appendChild(titleEl);
  const noteEl = document.createElement("p");
  noteEl.className = "devmode-note";
  noteEl.textContent = "各ランクに上がるために必要な名声度の累計値です。空欄にすると初期値に戻ります。";
  wrap.appendChild(noteEl);
  
  RANK_ORDER.forEach(rank => {
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    row.appendChild(labelSpan(`${rank}ランク：`));
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.className = "scenariobuild-condition-input";
    input.placeholder = String(DEFAULT_FAME_RANK_THRESHOLDS[rank]);
    input.value = (typeof scenarioProject.fameThresholds[rank] === "number") ? scenarioProject.fameThresholds[rank] : "";
    input.onchange = () => {
      const num = Number(input.value);
      if (input.value.trim() === "") delete scenarioProject.fameThresholds[rank];
      else scenarioProject.fameThresholds[rank] = Math.max(0, Math.floor(num) || 0);
      persist();
    };
    row.appendChild(input);
    wrap.appendChild(row);
  });
  container.appendChild(wrap);
}

// ★上のUIで編集した名声度しきい値を、実際にゲームが参照するFAME_RANK_THRESHOLDS（questboard.js）へ反映する
function ensureCustomFameThresholdsRegistered() {
  if (typeof FAME_RANK_THRESHOLDS === "undefined" || typeof DEFAULT_FAME_RANK_THRESHOLDS === "undefined") return;
  RANK_ORDER.forEach(rank => {
    const override = scenarioProject.fameThresholds && scenarioProject.fameThresholds[rank];
    FAME_RANK_THRESHOLDS[rank] = (typeof override === "number") ? override : DEFAULT_FAME_RANK_THRESHOLDS[rank];
  });
}

function getBossManagerConfig() {
  return {
    note: "既にいるボス（boss.js）も一覧に出ており、直接編集・削除できます（実際のゲームデータそのものが変わります）。戦闘ブロックの魔物IDにこのIDを入れると、ボス扱い（専用BGM込み）でテストプレイできます。BGM欄はBGM設定タブで登録した曲名、または直接ファイルパスを貼り付けられます。「レベル」を設定すると、エリアの固定レベル設定や主人公のレベルに関わらず、必ずそのレベルで出現します（空欄ならエリア設定または主人公基準）。「ステータスを固定する」をONにすると、レベルによる自動計算はせず、HP・攻撃力・経験値をここで入力した数値そのままで戦えます（レベルは表示だけに使われます）。「1ターンの行動回数」を2以上にすると、このボスは1ターンに指定した回数だけ連続で行動します（途中で力尽きたら残りの行動はしません）。「無敵解除アイテムID」を指定すると、そのボスは最初ダメージが一切通らない無敵状態になり、戦闘中にプレイヤーがそのアイテムを実際に「使う」まで攻撃が効きません（空欄なら今まで通り最初からダメージが通ります。持っているだけでは解除されず、道具コマンドから使う必要があります）。詳細設定の「形態」欄の「編集」ボタンから開く専用画面では、好きな数だけ形態（第2形態以降）を追加・削除でき、形態ごとに名前・画像・大きさ・攻撃力倍率・移行直後のHP割合・専用BGM（「BGM引き継ぎ」ONなら曲を変えずそのまま流し続けます）を個別に設定できます。形態は「前の形態のHPが0になった瞬間」に自動的に次へ進み（発動条件の指定はできません）、その瞬間の演出（セリフ等）は「戦闘イベント」側で条件を「形態が◯になった瞬間」にすることで組み立てます。「戦闘イベント」欄の「編集」ボタンから開く専用画面では、ボスの体力/主人公のHP・SP/経過ターン数/形態の切り替わりを条件に、戦闘中セリフ・無敵解除・仲間を呼ぶ・回復・特定の技、または「演出ブロックで自由に組む」（if・変数操作・パラメータ変更なども使える、話のブロックと同じ仕組み）を組み合わせて演出できます（1つのイベントは戦闘中1回だけ発火します）。",
    category: "bosses",
    useDetailEditor: true,
    showLevelPreview: true,
    getList: () => scenarioProject.bosses,
    fields: [
      { key: "name", label: "名前", type: "text", placeholder: "ボスの名前" },
      { key: "description", label: "説明", type: "text", placeholder: "（任意）" },
      { key: "level", label: "レベル", type: "number", placeholder: "空欄＝エリア設定 or 主人公基準" },
      { key: "fixedStats", label: "ステータスを固定する", type: "select", options: [{ value: "", label: "OFF（レベルで自動計算）" }, { value: "on", label: "ON（下の数値をそのまま使う）" }] },
      { key: "maxHp", label: "HP", type: "number", placeholder: "50" },
      { key: "atk", label: "攻撃力", type: "number", placeholder: "10" },
      { key: "exp", label: "経験値", type: "number", placeholder: "50" },
      { key: "bgmTrack", label: "通常時BGM", type: "text", placeholder: "曲名 or パス", list: "scenariobuild-bgm-datalist" },
      { key: "bgmFinalTrack", label: "追い込み用BGM", type: "text", placeholder: "曲名 or パス（任意）", list: "scenariobuild-bgm-datalist" },
      { key: "bgmCrisisTrack", label: "緊迫用BGM", type: "text", placeholder: "曲名 or パス（任意）", list: "scenariobuild-bgm-datalist" },
      { key: "imagePath", label: "画像パス", type: "text", placeholder: "例：img/敵/hobgoblin.png（空欄なら img/敵/名前.png を使う）" },
      { key: "sizeMultiplier", label: "大きさ倍率", type: "number", placeholder: "1.0（例：1.5で大きく、ボスらしく強調できます）" },
      { key: "actionsPerTurn", label: "1ターンの行動回数", type: "number", placeholder: "1（例：2にすると1ターンに2回連続で行動します）" },
      { key: "invincibilityBreakItemId", label: "無敵解除アイテムID", type: "text", placeholder: "空欄＝最初からダメージが通る", list: "scenariobuild-item-datalist" }
    ],
    newEntity: () => ({ id: generateId("boss"), name: "", description: "", level: null, fixedStats: "", maxHp: 50, atk: 10, exp: 50, bgmTrack: "", bgmFinalTrack: "", bgmCrisisTrack: "", imagePath: "", sizeMultiplier: 1, actionsPerTurn: 1, invincibilityBreakItemId: "", dropItemId: null, dropRate: 0, killFlavor: "", spareFlavor: "", giftItemId: null, uniqueSkill: null, statusInflictions: [], normalAttackStatusInflictions: [], statusImmunities: [], statusResistances: {}, battleEvents: [], forms: [] }),
    onChange: ensureCustomMonstersRegistered,
    getDefaultFromMaster: (id) => {
      const master = typeof BOSS_MASTER !== "undefined" ? BOSS_MASTER[id] : null;
      if (!master) return null;
      return {
        name: master.name, description: master.description || "", level: master.level || null, fixedStats: master.fixedStats ? "on" : "", maxHp: master.maxHp, atk: master.atk, exp: master.exp,
        bgmTrack: master.bgmTrack || "", bgmFinalTrack: master.bgmFinalTrack || "", bgmCrisisTrack: master.bgmCrisisTrack || "",
        imagePath: master.imagePath || "", sizeMultiplier: (typeof master.sizeMultiplier === "number" && master.sizeMultiplier > 0) ? master.sizeMultiplier : 1,
        actionsPerTurn: (typeof master.actionsPerTurn === "number" && master.actionsPerTurn > 0) ? master.actionsPerTurn : 1, // ★要望対応：1ターンの行動回数
        invincibilityBreakItemId: master.invincibilityBreakItemId || "",
        dropItemId: master.dropItemId || null, dropRate: master.dropRate || 0,
        killFlavor: master.killFlavor || "", spareFlavor: master.spareFlavor || "", giftItemId: master.giftItemId || null,
        uniqueSkill: master.uniqueSkill ? { ...master.uniqueSkill } : null,
        // ★要望対応：statusInflictionsは専用スキル発動時の状態異常として使うため、既存データのみそのまま引き継ぐ。
        //   古いpoisonChanceだけのデータ（従来ずっと通常攻撃で毒になっていた）は、通常攻撃用の欄に引き継ぐ
        statusInflictions: Array.isArray(master.statusInflictions) ? master.statusInflictions.map(s => ({ ...s })) : [],
        normalAttackStatusInflictions: Array.isArray(master.normalAttackStatusInflictions) ? master.normalAttackStatusInflictions.map(s => ({ ...s }))
          : (master.poisonChance ? [{ kind: "poison", chance: master.poisonChance, duration: 3, power: 0 }] : []),
        // ★要望対応：この魔物自身の状態異常耐性・無効
        statusImmunities: Array.isArray(master.statusImmunities) ? [...master.statusImmunities] : [],
        statusResistances: master.statusResistances && typeof master.statusResistances === "object" ? { ...master.statusResistances } : {},
        battleEvents: Array.isArray(master.battleEvents) ? master.battleEvents.map(e => ({ ...e })) : [],
        forms: Array.isArray(master.forms) ? master.forms.map(f => ({ ...f })) : [] // ★要望対応：既存ボスの「形態」一覧も引き継ぐ
      };
    }
  };
}

// ★クエスト管理タブ（scenarioProject.quests）の内容を、実際にゲームが参照するQUEST_BOARD_MASTERへ
//   書き戻す。あわせて、今表示されている掲示板（QUEST_BOARD）にも反映する：
//   既に載っている依頼は内容を更新し、まだ載っていない新規の依頼は（受注中でなければ）追加する
function ensureCustomQuestsRegistered() {
  if (typeof QUEST_BOARD_MASTER === "undefined" || !Array.isArray(scenarioProject.quests)) return;
  scenarioProject.quests.forEach(q => {
    const entry = {
      id: q.id, rank: q.rank || "F", title: q.title || "無題の依頼", description: q.description || "",
      type: q.type === "gather" ? "gather" : "hunt",
      targetMonsterKey: q.targetMonsterKey || "", targetItemId: q.targetItemId || "",
      targetCount: Math.max(1, Number(q.targetCount) || 1),
      rewardGold: Number(q.rewardGold) || 0, rewardExp: Number(q.rewardExp) || 0,
      rewardItemId: q.rewardItemId || null, rewardItemQty: Math.max(1, Number(q.rewardItemQty) || 1)
    };
    const masterIdx = QUEST_BOARD_MASTER.findIndex(m => m.id === q.id);
    if (masterIdx !== -1) QUEST_BOARD_MASTER[masterIdx] = entry; else QUEST_BOARD_MASTER.push(entry);
    
    if (typeof QUEST_BOARD !== "undefined") {
      const boardIdx = QUEST_BOARD.findIndex(b => b.id === q.id);
      if (boardIdx !== -1) {
        QUEST_BOARD[boardIdx] = { ...entry };
      } else if (!(typeof activeQuest !== "undefined" && activeQuest && activeQuest.id === q.id) && !(typeof player !== "undefined" && player && Array.isArray(player.questsCompletedToday) && player.questsCompletedToday.includes(q.id))) {
        QUEST_BOARD.push({ ...entry }); // ★受注中でなく、今日まだ達成していなければ、新しく登録した依頼をその場で掲示板に追加する
      }
    }
  });
}

// ★便利タブの「チュートリアル」アイコンから見られる、カテゴリ分けされたヘルプ項目を編集する
function getTutorialManagerConfig() {
  return {
    note: "便利タブの「チュートリアル」アイコンから見られる項目を編集します。同じ「カテゴリ」を持つ項目は、一覧でまとめて表示されます。",
    category: "tutorials",
    getList: () => scenarioProject.tutorials,
    fields: [
      { key: "category", label: "カテゴリ", type: "text", placeholder: "例：戦闘の基本" },
      { key: "title", label: "項目名", type: "text", placeholder: "例：状態異常について" },
      { key: "body", label: "本文", type: "textarea", placeholder: "実際に表示される説明文（改行OK）" }
    ],
    newEntity: () => ({ id: generateId("tutorial"), category: "その他", title: "新しい項目", body: "" })
  };
}

// ★要望対応：便利タブの「実績」アイコンから見られる実績（達成条件・報酬）を編集するタブ
function getAchievementManagerConfig() {
  const classOptions = [{ value: "", label: "（指定なし＝今の職業）" }]
    .concat(Object.keys(scenarioProject.classStats || {}).map(name => ({ value: name, label: name })));
  const areaOptions = [{ value: "", label: "（未選択）" }]
    .concat((scenarioProject.mapAreas || []).map(a => ({ value: a.id, label: a.name || a.id })));
  return {
    note: "便利タブの「実績」アイコンから見られる実績を作成します。「隠し実績」をONにすると、達成するまで名前・説明が「？？？」になります。" +
      "条件の種類ごとに、下の欄のうち実際に使うものが変わります（使わない欄は空欄のままでOK）："
      + "職業レベル→対象の職業（空欄なら今の職業）＋必要な数値＝レベル／"
      + "クリア済みの話数→必要な数値＝話数／"
      + "職業解放→対象の職業／"
      + "累計ダメージ量・累計回復量・累計被ダメージ量・累計討伐数→必要な数値＝しきい値／"
      + "特定の敵を倒した→対象の魔物ID＋必要な数値＝討伐数／"
      + "全ての種類の敵を倒した→必要な数値＝敵1種類あたりの討伐数／"
      + "エリアを解放した→対象のエリア／"
      + "フラグ→対象のフラグ名／"
      + "変数→対象の変数名＋必要な数値",
    category: "achievements",
    collapsible: true, // ★要望対応：実績が増えても一覧が長くなりすぎないよう、項目ごとに編集欄を折りたためるようにする
    getEntitySummary: (entity) => (entity.hidden ? "🔒 " : "🏆 ") + (entity.name || "（名前未設定）"),
    getList: () => scenarioProject.achievements,
    fields: [
      { key: "name", label: "実績名", type: "text", placeholder: "例：はじめの一歩" },
      { key: "description", label: "説明文", type: "textarea", placeholder: "達成条件や内容の説明" },
      { key: "hidden", label: "隠し実績にする（達成まで名前・説明を？？？にする）", type: "checkbox" },
      { key: "conditionType", label: "条件の種類", type: "select", options: [
        { value: "classLevel", label: "職業レベルが指定値以上" },
        { value: "chaptersCleared", label: "クリア済みの話数が指定値以上" },
        { value: "classUnlocked", label: "特定の職業を解放した" },
        { value: "totalDamageDealt", label: "累計ダメージ量が指定値以上" },
        { value: "totalHealingDone", label: "累計回復量が指定値以上" },
        { value: "totalDamageTaken", label: "累計被ダメージ量が指定値以上" },
        { value: "enemyKillsSpecific", label: "特定の敵を指定数以上倒した" },
        { value: "enemyKillsAllTypes", label: "全ての種類の敵をそれぞれ指定数以上倒した" },
        { value: "totalKillCount", label: "累計討伐数が指定値以上" },
        { value: "areaUnlocked", label: "特定のエリアを解放した" },
        { value: "flag", label: "特定のフラグがONになっている" },
        { value: "variable", label: "特定の変数が指定値以上" }
      ] },
      { key: "conditionValue", label: "必要な数値（しきい値・レベル・話数など）", type: "number", placeholder: "1" },
      { key: "classId", label: "対象の職業（職業レベル／職業解放でのみ使用）", type: "select", options: classOptions },
      { key: "monsterKey", label: "対象の魔物ID（特定の敵を倒した、でのみ使用）", type: "text", placeholder: "例：slime", list: "scenariobuild-monster-datalist" },
      { key: "areaId", label: "対象のエリア（エリア解放でのみ使用）", type: "select", options: areaOptions },
      { key: "flagName", label: "対象のフラグ名（フラグでのみ使用）", type: "text", placeholder: "フラグ名" },
      { key: "varName", label: "対象の変数名（変数でのみ使用）", type: "text", placeholder: "変数名" },
      { key: "rewardExp", label: "報酬：経験値", type: "number", placeholder: "0" },
      { key: "rewardGold", label: "報酬：陳（お金）", type: "number", placeholder: "0" },
      { key: "rewardItemId", label: "報酬：アイテムID（任意）", type: "text", placeholder: "例：herb_001", list: "scenariobuild-item-datalist" },
      { key: "rewardItemQty", label: "報酬：アイテム個数", type: "number", placeholder: "1" }
    ],
    newEntity: () => ({
      id: generateId("achievement"), name: "新しい実績", description: "", hidden: false,
      conditionType: "classLevel", conditionValue: 1, classId: "", monsterKey: "", areaId: "",
      flagName: "", varName: "", rewardExp: 0, rewardGold: 0, rewardItemId: "", rewardItemQty: 1
    })
  };
}

function getQuestManagerConfig() {
  return {
    note: "酒場のクエスト掲示板に並ぶ依頼を編集します。「種類」が「討伐」の依頼は討伐対象の魔物ID、「納品」の依頼は納品するアイテムIDを指定してください。アイテム報酬は空欄でも構いません。",
    category: "quests",
    getList: () => scenarioProject.quests,
    filterField: "rank", // ★要望対応：ランクごとにタブ分けして見やすくする
    filterDefault: "F",
    filterOptions: RANK_ORDER.map(r => ({ value: r, label: r })),
    fields: [
      { key: "rank", label: "ランク", type: "select", options: RANK_ORDER.map(r => ({ value: r, label: r })) },
      { key: "title", label: "依頼名", type: "text", placeholder: "依頼のタイトル" },
      { key: "description", label: "内容説明", type: "text", placeholder: "依頼の説明文" },
      { key: "type", label: "種類", type: "select", options: [{ value: "hunt", label: "討伐" }, { value: "gather", label: "納品" }] },
      { key: "targetMonsterKey", label: "討伐対象の魔物ID", type: "text", placeholder: "例：slime", list: "scenariobuild-monster-datalist" },
      { key: "targetItemId", label: "納品対象のアイテムID", type: "text", placeholder: "例：herb_001", list: "scenariobuild-item-datalist" },
      { key: "targetCount", label: "クリア条件（必要数）", type: "number", placeholder: "1" },
      { key: "rewardGold", label: "報酬：陳（お金）", type: "number", placeholder: "0" },
      { key: "rewardExp", label: "報酬：経験値", type: "number", placeholder: "0" },
      { key: "rewardItemId", label: "報酬：アイテムID（任意）", type: "text", placeholder: "例：herb_001", list: "scenariobuild-item-datalist" },
      { key: "rewardItemQty", label: "報酬：アイテム個数", type: "number", placeholder: "1" }
    ],
    newEntity: () => ({
      id: generateId("quest"), rank: "F", title: "新しい依頼", description: "", type: "hunt",
      targetMonsterKey: "", targetItemId: "", targetCount: 1, rewardGold: 0, rewardExp: 0,
      rewardItemId: "", rewardItemQty: 1
    }),
    quickAddOptions: (typeof RANK_ORDER !== "undefined" ? RANK_ORDER : ["F", "E", "D", "C", "B", "A", "S"]).map(rank => ({
      label: `${rank}ランク`,
      build: () => ({
        id: generateId("quest"), rank, title: "新しい依頼", description: "", type: "hunt",
        targetMonsterKey: "", targetItemId: "", targetCount: 1, rewardGold: 0, rewardExp: 0,
        rewardItemId: "", rewardItemQty: 1
      })
    })),
    onChange: ensureCustomQuestsRegistered,
    onDelete: (entry) => {
      // ★削除した依頼が今の掲示板に載っていれば、そこからも取り除く（受注中でなければ）
      if (typeof QUEST_BOARD === "undefined") return;
      if (typeof activeQuest !== "undefined" && activeQuest && activeQuest.id === entry.id) return;
      const boardIdx = QUEST_BOARD.findIndex(b => b.id === entry.id);
      if (boardIdx !== -1) QUEST_BOARD.splice(boardIdx, 1);
    },
    getDefaultFromMaster: (id) => {
      const master = (typeof QUEST_BOARD_MASTER !== "undefined") ? QUEST_BOARD_MASTER.find(q => q.id === id) : null;
      if (!master) return null;
      return { ...master };
    }
  };
}

function getBgmManagerConfig() {
  return {
    note: "既に使われているBGM（town・field_caveなど）も一覧に出ており、直接ファイルパスを編集・削除できます。名前とファイルパス（bgmフォルダからの相対パス。拡張子.mp3は付けても付けなくてもOK）を登録すると、BGMブロックやボス設定のBGM欄で、名前を選ぶかパスを直接貼り付けるかのどちらでも指定できます。候補一覧には、実際に用意されている曲のファイルパスも出てきます。",
    category: "bgmTracks",
    getList: () => scenarioProject.bgmTracks,
    fields: [
      { key: "name", label: "曲名（呼び出し用）", type: "text", placeholder: "例：宿屋のテーマ" },
      { key: "path", label: "ファイルパス", type: "text", placeholder: "例：拠点/カリの村/Oak-Village.mp3", list: "scenariobuild-bgmfile-datalist" }
    ],
    newEntity: () => ({ id: generateId("bgmtrack"), name: "", path: "" }),
    onChange: ensureCustomBgmRegistered,
    cascadeRenameField: "name",
    onRename: (oldName, newName) => {
      if (typeof BGM_TRACK_PATHS !== "undefined" && oldName) delete BGM_TRACK_PATHS[oldName]; // ★古い名前の対応表エントリは消しておく（新しい名前は直後のonChangeで登録される）
      cascadeRenameInBlocks("bgm", oldName, newName);
    },
    onDelete: (entry) => {
      // ★組み込みのBGM（town等）を削除した場合、対応表(BGM_TRACK_PATHS)からも消しておく。
      //   ただしtown.js等が直接その名前を呼んでいる箇所は、パス解決に失敗して静かに鳴らないだけで、エラーにはならない
      if (entry.builtin && typeof BGM_TRACK_PATHS !== "undefined") delete BGM_TRACK_PATHS[entry.name];
    },
    getDefaultFromMaster: (id) => {
      if (typeof BGM_TRACK_PATHS === "undefined" || !(id in BGM_TRACK_PATHS)) return null;
      return { name: id, path: BGM_TRACK_PATHS[id] };
    }
  };
}

function getItemManagerConfig() {
  const categoryOptions = [
    { value: "herb", label: "薬草" }, { value: "potion", label: "ポーション" },
    { value: "material", label: "魔物素材" }, { value: "weapon", label: "武器" },
    { value: "armor", label: "防具" }, { value: "tool", label: "道具" },
    { value: "cookingTool", label: "料理道具" }, { value: "food", label: "料理" },
    { value: "misc", label: "その他" }
  ];
  return {
    note: "既にあるアイテム（items.js）も一覧に出ており、直接編集・削除できます（実際のゲームデータそのものが変わります）。ギヴ（アイテム付与）ブロックのアイテムIDにこのIDを入れれば付与できます。「編集」を押すと、回復量や薬効などの効果パラメータも含めて詳しく設定できます。武器・防具は個体差の範囲も設定できます。",
    category: "items",
    useDetailEditor: true,
    getList: () => scenarioProject.items,
    filterField: "category",
    filterDefault: "misc",
    filterOptions: [
      { key: "equipment", label: "装備", values: ["weapon", "armor"] },
      { key: "tools", label: "道具", values: ["herb", "potion", "material", "tool", "misc"] },
      { key: "cooking", label: "料理関連", values: ["cookingTool", "food"] }
    ],
    fields: [
      { key: "name", label: "名前", type: "text", placeholder: "アイテム名" },
      { key: "category", label: "種類", type: "select", options: categoryOptions },
      { key: "description", label: "説明", type: "text", placeholder: "効果の説明（任意）" },
      { key: "rank", label: "お宝ランク", type: "text", placeholder: "F〜S" },
      { key: "listedPrice", label: "定価", type: "number", placeholder: "0" },
      { key: "trueValue", label: "真価", type: "number", placeholder: "0" },
      { key: "unsellable", label: "売れない（買取屋の売却対象から外す）", type: "checkbox" },
      // ★要望対応：どのカテゴリのアイテムでも「釣竿」「釣り餌」として扱えるようにするチェック
      { key: "isFishingRod", label: "釣竿として扱う", type: "checkbox" },
      { key: "rodDurability", label: "（釣竿）耐久度", type: "number", placeholder: "20" },
      { key: "rodPower", label: "（釣竿）攻撃力", type: "number", placeholder: "3" },
      { key: "isFishingBait", label: "釣り餌として扱う", type: "checkbox" },
      // ★バグ修正：以前はフリーテキストで「魚管理タブの『種類』と同じ文字列」を手打ちする方式だったため、
      //   全角半角やスペース、ちょっとした表記ゆれで一致せず、魚が登録されているのに
      //   「今はこの餌に反応する魚がいないようだ……」になってしまうバグがあった。
      //   → 魚管理タブに登録済みの「種類」から選ぶチェックボックス方式（複数選択可）に変更（fishing.js参照）
      { key: "baitFishTypes", label: "（餌）釣れる魚の種類（複数選択可／未選択ならどの魚にも反応）", type: "multiselect", emptyText: "先に「魚管理」タブで魚を登録すると、ここに種類が選べるようになります", optionsFn: () => getRegisteredFishTypeOptions() },
      { key: "baitBiteRate", label: "（餌）食いつき度（高いほど早く食いつく／目安1〜10）", type: "number", placeholder: "5" },
      // ★要望対応：料理タブ用。種類を「料理道具」にした時だけ意味を持つ
      { key: "toolDurability", label: "（料理道具）耐久度", type: "number", placeholder: "30" },
      { key: "toolSlotCount", label: "（料理道具）材料スロット数", type: "number", placeholder: "3" },
      // ★要望対応：種類を「料理」にした時だけ意味を持つ、戦闘中だけの自己バフ（技の自己強化と同じ仕組みを流用）
      { key: "foodBuffKind", label: "（料理）戦闘中バフの種類", type: "select", options: getSkillSelfBuffKindOptions() },
      { key: "foodBuffDuration", label: "（料理）バフの持続ターン数", type: "number", placeholder: "3" },
      { key: "foodBuffPower", label: "（料理）バフの効果量", type: "number", placeholder: "5" },
      // ★要望対応：このアイテムを「使う」と、指定した料理レシピがレシピ帳に登録される（レシピ発見アイテム）
      { key: "isRecipeItem", label: "料理レシピとして扱う（使うとレシピ帳に登録）", type: "checkbox" },
      { key: "unlockRecipeId", label: "（レシピ）登録される料理レシピのID", type: "text", placeholder: "レシピ管理タブで確認できるID" }
    ],
    newEntity: () => ({ id: generateId("item"), name: "", category: "material", description: "", rank: "F", listedPrice: 0, trueValue: 0, unsellable: false }),
    quickAddOptions: categoryOptions.map(opt => ({
      label: opt.label,
      build: () => ({ id: generateId("item"), name: "", category: opt.value, description: "", rank: "F", listedPrice: 0, trueValue: 0, unsellable: false })
    })),
    onChange: ensureCustomItemsRegistered,
    getDefaultFromMaster: (id) => {
      const master = typeof ITEM_MASTER !== "undefined" ? ITEM_MASTER[id] : null;
      if (!master) return null;
      return {
        name: master.name, category: master.category, description: master.description,
        rank: master.rank, listedPrice: master.listedPrice, trueValue: master.trueValue, unsellable: !!master.unsellable,
        stackable: master.stackable
      };
    }
  };
}

// ===================================================================
// ===== サブ画面：魚管理（要望対応：釣り場で釣れる魚の追加・編集） =====
// ===================================================================
// ★魚も内部的にはアイテムと同じ扱いで、ensureCustomFishRegistered()を通じて
//   ITEM_MASTER（category:"fish"）に反映される。インベントリにも普通に入り、水色の文字色で表示される。
//   「種類」は釣り餌の「（餌）釣れる魚の種類」と同じ文字列を入れることで、その餌で狙えるようになる（fishing.js）
function getFishManagerConfig() {
  return {
    note: "釣り場で釣れる「魚」を登録します。魚も中身はアイテムと同じ扱いで、釣り上げるとインベントリに入ります（文字色は水色）。「種類」は釣り餌の「釣れる魚の種類」と同じ文字列にしておくと、その餌で狙えるようになります。「強さ」「体力」は釣りミニゲームでの魚側のステータスです。施設編集タブの「釣り場」で、どの魚をどの時間帯・天候に出すか設定してください。",
    category: "fish",
    useDetailEditor: true,
    getList: () => scenarioProject.fishItems,
    fields: [
      { key: "name", label: "名前", type: "text", placeholder: "魚の名前" },
      { key: "description", label: "説明", type: "text", placeholder: "説明（任意）" },
      { key: "fishType", label: "種類", type: "text", placeholder: "例：小物／大物 など自由に" },
      { key: "power", label: "強さ（釣りミニゲームでの攻撃力）", type: "number", placeholder: "3" },
      { key: "hp", label: "体力（釣りミニゲームでのHP）", type: "number", placeholder: "15" },
      { key: "size", label: "大きさ（cm）", type: "number", placeholder: "10" },
      { key: "rank", label: "レア度（F〜S目安）", type: "text", placeholder: "F〜S" },
      { key: "listedPrice", label: "定価（売却額の目安）", type: "number", placeholder: "0" },
      { key: "trueValue", label: "真価", type: "number", placeholder: "0" }
    ],
    newEntity: () => ({
      id: generateId("fish"), name: "", description: "", fishType: "", power: 3, hp: 15, size: 10,
      rank: "F", listedPrice: 0, trueValue: 0
    }),
    onChange: ensureCustomFishRegistered,
    getDefaultFromMaster: (id) => {
      const master = typeof ITEM_MASTER !== "undefined" ? ITEM_MASTER[id] : null;
      if (!master || master.category !== "fish") return null;
      return {
        name: master.name, description: master.description, fishType: master.fishType,
        power: master.fishPower, hp: master.fishHp, size: master.fishSize,
        rank: master.rank, listedPrice: master.listedPrice, trueValue: master.trueValue
      };
    }
  };
}

let scenarioBuildEntityFilterValue = {}; // ★カテゴリごとのフィルタ選択状態を覚えておく（例：{ characters: "main" }）

function renderEntityManager(container, config) {
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = config.note;
  container.appendChild(introEl);
  
  // ★種類ごとに直接追加できるボタン（quickAddOptions、要望対応）が設定されていればそちらを、
  //   無ければ今まで通りの汎用「＋新規追加」ボタンを出す
  if (Array.isArray(config.quickAddOptions) && config.quickAddOptions.length > 0) {
    const quickAddWrap = document.createElement("div");
    quickAddWrap.className = "scenariobuild-quick-add-row";
    config.quickAddOptions.forEach(opt => {
      const btn = document.createElement("button");
      btn.className = "devmode-btn";
      btn.textContent = `＋${opt.label}を追加`;
      btn.onclick = (event) => {
        event.stopPropagation();
        pushUndoSnapshot();
        const newEntity = opt.build();
        config.getList().push(newEntity);
        if (config.collapsible) scenarioBuildExpandedEntityIds.add(newEntity.id); // ★追加した項目はすぐ編集できるよう展開しておく
        markScenarioBuildDirty();
        if (config.onChange) config.onChange();
        renderScenarioBuildPanel();
      };
      quickAddWrap.appendChild(btn);
    });
    container.appendChild(quickAddWrap);
  } else {
    const addBtn = document.createElement("button");
    addBtn.className = "devmode-btn";
    addBtn.textContent = "＋新規追加";
    addBtn.onclick = (event) => {
      event.stopPropagation();
      pushUndoSnapshot();
      const newEntity = config.newEntity();
      config.getList().push(newEntity);
      if (config.collapsible) scenarioBuildExpandedEntityIds.add(newEntity.id); // ★追加した項目はすぐ編集できるよう展開しておく
      markScenarioBuildDirty();
      if (config.onChange) config.onChange();
      renderScenarioBuildPanel();
    };
    container.appendChild(addBtn);
  }
  
  let list = config.getList();
  
  if (config.filterField && config.filterOptions) {
    const filterRow = document.createElement("div");
    filterRow.className = "scenariobuild-filter-row";
    const currentFilter = scenarioBuildEntityFilterValue[config.category] || "all";
    
    const allBtn = document.createElement("button");
    allBtn.className = "devmode-btn" + (currentFilter === "all" ? " scenariobuild-filter-active" : "");
    allBtn.textContent = `すべて（${list.length}）`;
    allBtn.onclick = (event) => { event.stopPropagation(); scenarioBuildEntityFilterValue[config.category] = "all"; renderScenarioBuildPanel(); };
    filterRow.appendChild(allBtn);
    
    config.filterOptions.forEach(opt => {
      const matches = e => opt.values ? opt.values.includes(e[config.filterField] || config.filterDefault) : (e[config.filterField] || config.filterDefault) === opt.value;
      const count = list.filter(matches).length;
      const btn = document.createElement("button");
      btn.className = "devmode-btn" + (currentFilter === (opt.value || opt.key) ? " scenariobuild-filter-active" : "");
      btn.textContent = `${opt.label}（${count}）`;
      btn.onclick = (event) => { event.stopPropagation(); scenarioBuildEntityFilterValue[config.category] = opt.value || opt.key; renderScenarioBuildPanel(); };
      filterRow.appendChild(btn);
    });
    container.appendChild(filterRow);
    
    if (currentFilter !== "all") {
      const activeOpt = config.filterOptions.find(opt => (opt.value || opt.key) === currentFilter);
      list = activeOpt && activeOpt.values
        ? list.filter(e => activeOpt.values.includes(e[config.filterField] || config.filterDefault))
        : list.filter(e => (e[config.filterField] || config.filterDefault) === currentFilter);
    }
  }
  
  if (list.length === 0) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "devmode-note";
    emptyEl.textContent = "まだ何も登録されていません。";
    container.appendChild(emptyEl);
    return;
  }
  
  const listEl = document.createElement("div");
  listEl.className = "scenariobuild-list";
  list.forEach((entity) => {
    const realIndex = config.getList().indexOf(entity); // ★フィルタ後も、削除時などに元の配列の正しい位置を指せるようにする
    listEl.appendChild(buildEntityRow(config, entity, realIndex));
  });
  container.appendChild(listEl);
}

// ===================================================================
// ===== サブ画面：状態管理（状態異常・状態強化の種類の追加・編集） =====
// ===================================================================
// ★実際の動作（mechanic）は決まった仕組みの中からしか選べないが、id・表示名・説明・
//   デフォルトの効果量／ターン数／確率は自由に追加・編集できる。
//   組み込みの種類は削除できないが、表示名・説明・デフォルト値は変更できる
const STATUS_AILMENT_MECHANIC_OPTIONS = [
  { value: "stun", label: "スタン（行動不能）" }, { value: "paralyze", label: "麻痺（行動制限）" },
  { value: "confuse", label: "混乱" }, { value: "burn", label: "火傷（継続ダメージ）" },
  { value: "poison", label: "毒（継続ダメージ）" }, { value: "dullPain", label: "鈍痛（継続ダメージ・毒とは別枠）" }, { value: "atkDown", label: "攻撃力低下" },
  { value: "defDown", label: "防御力低下" }, { value: "accDown", label: "命中率低下" },
  { value: "hate", label: "ヘイト上昇（敵の攻撃が優先的にこちらへ向くようになる・挑発）" }
];
const STATUS_BUFF_MECHANIC_OPTIONS = [
  { value: "atkUp", label: "攻撃力上昇" }, { value: "critUp", label: "会心率上昇" },
  { value: "magicUp", label: "魔力上昇（魔法攻撃の威力に影響）" },
  { value: "defUp", label: "防御力変化（マイナス値で自傷デバフにも使える）" },
  { value: "immune", label: "無敵（被ダメージを完全無効化・仲間は非対応）" },
  { value: "statusImmune", label: "状態異常無効（ダメージは防がず、状態異常の付与だけを無効化）" },
  { value: "surviveLethal", label: "不屈（致命傷になる一撃だけHP1で耐える・仲間は非対応）" },
  { value: "delayedPower", label: "やる気なし（一定ターン後に自動で強力な攻撃力上昇・仲間は非対応）" },
  { value: "hpBerserk", label: "被虐の力（次の1回の攻撃だけ残りHPを力に変える・仲間は非対応）" },
  { value: "chainAttack", label: "連鎖攻撃（一定ターンの間、単体攻撃がもう一体の敵にも連鎖する）" },
  { value: "regen", label: "継続回復（ラウンド終了ごとに少しHPが回復する）" },
  { value: "healUp", label: "回復力上昇（攻撃力上昇とは別枠。回復技の効果量に上乗せする）" },
  { value: "bloodDance", label: "血華の演舞タイプ（発動中、攻撃するたび攻撃力が積み上がり、代わりに自分も少しダメージを受ける）" },
  { value: "allStatsUp", label: "全ステータス上昇（攻撃力・会心率・被ダメージ軽減をまとめて上げる）" },
  { value: "fatigueImmune", label: "疲労・眠気の影響を受けない（居眠りしなくなり、疲弊による攻撃力低下も無視する・仲間は非対応）" },
  { value: "hate", label: "ヘイト上昇（敵の攻撃が優先的にこちらへ向くようになる・挑発、仲間も対応）" }
];

// ===================================================================
// ===== サブ画面：フラグ管理（話の中で使うon/off変数を一覧・登録・手動操作） =====
// ===================================================================
// ★フラグ自体は「話のブロックエディタ」でどこでも自由な名前で参照できる、単なる文字列キーのon/off値。
//   これまでは一覧表示や説明を残す場所が無く、どんなフラグがどこで使われているか把握しづらかった。
//   ここでは①登録済みフラグの説明・現在値の確認/手動操作、②まだ登録されていないが
//   話の中で実際に使われているフラグの自動検出、の2つができるようにする

// ★全ての話のブロックを走査し、実際に参照されているフラグ名を集める
//   （フラグブロックのflagName／IF条件のflag種別／話の解放条件requiredFlag）
// ★バグ修正：以前はchapter.blocksの直下しか見ておらず、選択肢の中身（option.blocks）や
//   ifブロックの中身（trueBlocks/falseBlocks）で使われているフラグを見落としていた
function scanUsedFlagNames() {
  const names = new Set();
  const walk = (blocksArray) => {
    (blocksArray || []).forEach(block => {
      if (block.type === "flag" && block.flagName) names.add(block.flagName);
      if (block.type === "if" && Array.isArray(block.conditions)) {
        block.conditions.forEach(cond => {
          if (cond.leftKind === "flag" && cond.leftValue) names.add(cond.leftValue);
          if (cond.rightKind === "flag" && cond.rightValue) names.add(cond.rightValue);
        });
        walk(block.trueBlocks);
        walk(block.falseBlocks);
      }
      if (block.type === "choice" && Array.isArray(block.options)) {
        block.options.forEach(opt => walk(opt.blocks));
      }
    });
  };
  (scenarioProject.chapters || []).forEach(chapter => {
    if (chapter.requiredFlag) names.add(chapter.requiredFlag);
    walk(chapter.blocks);
  });
  return names;
}

// ===================================================================
// ===== サブ画面：ゲーム変数管理（話の中で使う数値の変数を一覧・登録・手動操作） =====
// ===================================================================
// ★要望対応：好感度スキル等の話ブロックのifで、特殊スキル編集と同じように「変数」を参照・比較できるように
//   してほしいという要望を受けて追加。フラグ（on/off）と全く同じ考え方で、名前を自由に付けられる数値の入れ物。
//   フラグ管理タブ（renderFlagManager）と同じ構成なので、変更する時はそちらも合わせて確認すること
function scanUsedVariableNames() {
  const names = new Set();
  const walk = (blocksArray) => {
    (blocksArray || []).forEach(block => {
      if (block.type === "setvar" && block.varName) names.add(block.varName);
      if (block.type === "if" && Array.isArray(block.conditions)) {
        block.conditions.forEach(cond => {
          if (cond.leftKind === "variable" && cond.leftValue) names.add(cond.leftValue);
          if (cond.rightKind === "variable" && cond.rightValue) names.add(cond.rightValue);
        });
        walk(block.trueBlocks);
        walk(block.falseBlocks);
      }
      if (block.type === "choice" && Array.isArray(block.options)) {
        block.options.forEach(opt => walk(opt.blocks));
      }
    });
  };
  (scenarioProject.chapters || []).forEach(chapter => walk(chapter.blocks));
  (scenarioProject.enemies || []).forEach(enemy => walk(enemy.restSkillBlocks)); // ★好感度MAX時スキルの中身も見る
  return names;
}

function renderVariableManager(container) {
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "話のブロックエディタ（変数を設定ブロック・IF条件）で使える数値の変数の一覧です。フラグ（on/off）と違い、数字を自由に増減・代入できます。説明を残しておいたり、現在値をここから直接テストで書き換えたりできます。";
  container.appendChild(introEl);
  
  const registeredNames = new Set(scenarioProject.variableDefs.map(d => d.name));
  
  scenarioProject.variableDefs.forEach((def) => {
    container.appendChild(buildVariableDefRow(def));
  });
  
  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋ 変数を新しく登録";
  addBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioProject.variableDefs.push({ name: "", description: "" });
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  container.appendChild(addBtn);
  
  const usedNames = scanUsedVariableNames();
  const unregistered = [...usedNames].filter(name => !registeredNames.has(name));
  if (unregistered.length > 0) {
    const header = document.createElement("h4");
    header.className = "scenariobuild-subheading";
    header.textContent = "話の中で使われているが、まだ登録されていない変数";
    container.appendChild(header);
    
    unregistered.forEach(name => {
      const row = document.createElement("div");
      row.className = "scenariobuild-chapter-row";
      const label = document.createElement("span");
      label.textContent = `「${name}」（現在値：${getScenarioVariable(name)}）`;
      row.appendChild(label);
      const registerBtn = document.createElement("button");
      registerBtn.className = "devmode-btn";
      registerBtn.textContent = "登録する";
      registerBtn.onclick = (event) => {
        event.stopPropagation();
        scenarioProject.variableDefs.push({ name, description: "" });
        markScenarioBuildDirty();
        renderScenarioBuildPanel();
      };
      row.appendChild(registerBtn);
      container.appendChild(row);
    });
  }
}

function buildVariableDefRow(def) {
  const row = document.createElement("div");
  row.className = "scenariobuild-chapter-row";
  
  const infoEl = document.createElement("div");
  infoEl.className = "scenariobuild-chapter-info";
  
  const nameRow = document.createElement("div");
  nameRow.className = "scenariobuild-condition-row";
  nameRow.appendChild(labelSpan("変数名（ブロックエディタで指定する名前と完全一致させること）："));
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "scenariobuild-title-input";
  nameInput.value = def.name || "";
  nameInput.onchange = () => { def.name = nameInput.value.trim(); markScenarioBuildDirty(); renderScenarioBuildPanel(); };
  nameRow.appendChild(nameInput);
  infoEl.appendChild(nameRow);
  
  const descRow = document.createElement("div");
  descRow.className = "scenariobuild-condition-row";
  descRow.appendChild(labelSpan("説明（どんな時に増減するか、メモしておく）："));
  const descInput = document.createElement("input");
  descInput.type = "text";
  descInput.className = "scenariobuild-title-input";
  descInput.value = def.description || "";
  descInput.onchange = () => { def.description = descInput.value; markScenarioBuildDirty(); };
  descRow.appendChild(descInput);
  infoEl.appendChild(descRow);
  
  const valueRow = document.createElement("div");
  valueRow.className = "scenariobuild-condition-row";
  valueRow.appendChild(labelSpan(`現在値：${def.name ? getScenarioVariable(def.name) : 0}（テスト用に手動で書き換えられます）：`));
  const valueInput = document.createElement("input");
  valueInput.type = "number";
  valueInput.className = "scenariobuild-condition-input";
  valueInput.value = def.name ? getScenarioVariable(def.name) : 0;
  valueInput.disabled = !def.name;
  valueInput.onchange = () => { setScenarioVariable(def.name, Number(valueInput.value) || 0); renderScenarioBuildPanel(); };
  valueRow.appendChild(valueInput);
  infoEl.appendChild(valueRow);
  
  row.appendChild(infoEl);
  
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "devmode-btn devmode-btn-danger";
  deleteBtn.textContent = "削除";
  deleteBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioProject.variableDefs.splice(scenarioProject.variableDefs.indexOf(def), 1);
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  row.appendChild(deleteBtn);
  
  return row;
}

// ===================================================================
// ===== サブ画面：レシピ管理（鍛冶屋・素材合成屋で使うレシピの追加・編集） =====
// ===================================================================
// ★鍛冶屋・素材合成屋は、どちらも「レシピ（材料→完成品）」という同じ仕組みで動く。
//   施設編集タブで施設の種類を「鍛冶屋系」「素材合成屋系」にすると、ここで登録した
//   レシピのうち対応するshopTypeのものが、その施設の店頭に一覧表示される
function renderRecipeManager(container) {
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "鍛冶屋・素材合成屋で扱うレシピを登録します。「作成」は材料を消費して新しいアイテムを1つ作ります。「強化」はそれに加えて、指定した装備（所持している必要があります）を1つ消費して、完成品に置き換えます（＝装備の強化・アップグレード）。";
  container.appendChild(introEl);
  
  // ★要望対応：種類ごとにタブ分けして見やすくする
  const RECIPE_FILTER_OPTIONS = [
    { key: "blacksmith", label: "鍛冶屋" },
    { key: "synthesis", label: "素材合成屋" },
    { key: "cooking", label: "料理" }
  ];
  const filterRow = document.createElement("div");
  filterRow.className = "scenariobuild-filter-row";
  const currentFilter = scenarioBuildEntityFilterValue["recipes"] || "all";
  const allBtn = document.createElement("button");
  allBtn.className = "devmode-btn" + (currentFilter === "all" ? " scenariobuild-filter-active" : "");
  allBtn.textContent = `すべて（${scenarioProject.recipes.length}）`;
  allBtn.onclick = (event) => { event.stopPropagation(); scenarioBuildEntityFilterValue["recipes"] = "all"; renderScenarioBuildPanel(); };
  filterRow.appendChild(allBtn);
  RECIPE_FILTER_OPTIONS.forEach(opt => {
    const count = scenarioProject.recipes.filter(r => r.shopType === opt.key).length;
    const btn = document.createElement("button");
    btn.className = "devmode-btn" + (currentFilter === opt.key ? " scenariobuild-filter-active" : "");
    btn.textContent = `${opt.label}（${count}）`;
    btn.onclick = (event) => { event.stopPropagation(); scenarioBuildEntityFilterValue["recipes"] = opt.key; renderScenarioBuildPanel(); };
    filterRow.appendChild(btn);
  });
  container.appendChild(filterRow);
  const recipesToShow = currentFilter === "all" ? scenarioProject.recipes : scenarioProject.recipes.filter(r => r.shopType === currentFilter);
  
  const listEl = document.createElement("div");
  listEl.className = "scenariobuild-list";
  recipesToShow.forEach(recipe => {
    listEl.appendChild(buildRecipeRow(recipe));
  });
  container.appendChild(listEl);
  
  const quickAddWrap = document.createElement("div");
  quickAddWrap.className = "scenariobuild-quick-add-row";
  [
    { label: "鍛冶屋の作成レシピ", shopType: "blacksmith", mode: "create" },
    { label: "鍛冶屋の強化レシピ", shopType: "blacksmith", mode: "upgrade" },
    { label: "素材合成屋の作成レシピ", shopType: "synthesis", mode: "create" },
    { label: "素材合成屋の強化レシピ", shopType: "synthesis", mode: "upgrade" },
    { label: "料理のレシピ", shopType: "cooking", mode: "create" }
  ].forEach(opt => {
    const btn = document.createElement("button");
    btn.className = "devmode-btn";
    btn.textContent = `＋${opt.label}を追加`;
    btn.onclick = (event) => {
      event.stopPropagation();
      pushUndoSnapshot();
      scenarioProject.recipes.push({
        id: generateId("recipe"), name: "新しいレシピ", shopType: opt.shopType, mode: opt.mode,
        materials: [], baseItemId: "", resultItemId: "", resultCount: 1, cost: 0, description: ""
      });
      markScenarioBuildDirty();
      renderScenarioBuildPanel();
    };
    quickAddWrap.appendChild(btn);
  });
  container.appendChild(quickAddWrap);
}

function buildRecipeRow(recipe) {
  const row = document.createElement("div");
  row.className = "scenariobuild-chapter-row";
  
  const infoEl = document.createElement("div");
  infoEl.className = "scenariobuild-chapter-info";
  
  const nameRow = document.createElement("div");
  nameRow.className = "scenariobuild-condition-row";
  nameRow.appendChild(labelSpan("名前："));
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "scenariobuild-title-input";
  nameInput.value = recipe.name || "";
  nameInput.onchange = () => { recipe.name = nameInput.value; markScenarioBuildDirty(); };
  nameRow.appendChild(nameInput);
  infoEl.appendChild(nameRow);
  
  const typeRow = document.createElement("div");
  typeRow.className = "scenariobuild-condition-row";
  typeRow.appendChild(labelSpan("扱う店："));
  const shopSelect = document.createElement("select");
  shopSelect.className = "scenariobuild-jump-select";
  [{ value: "blacksmith", label: "鍛冶屋" }, { value: "synthesis", label: "素材合成屋" }, { value: "cooking", label: "料理" }].forEach(opt => {
    const optionEl = document.createElement("option");
    optionEl.value = opt.value;
    optionEl.textContent = opt.label;
    shopSelect.appendChild(optionEl);
  });
  shopSelect.value = recipe.shopType || "blacksmith";
  shopSelect.onchange = () => { recipe.shopType = shopSelect.value; markScenarioBuildDirty(); renderScenarioBuildPanel(); };
  typeRow.appendChild(shopSelect);
  
  // ★要望対応：鍛冶屋・素材合成屋が複数ある時、このレシピをどの店で使えるようにするか指定できる。
  //   料理レシピの場合は「店」ではなく「どの料理道具（アイテム）を使うレシピか」を指定する
  if (recipe.shopType === "cooking") {
    typeRow.appendChild(labelSpan("対象の料理道具："));
    const toolSelect = document.createElement("select");
    toolSelect.className = "scenariobuild-jump-select";
    const noToolOpt = document.createElement("option");
    noToolOpt.value = "";
    noToolOpt.textContent = "（未選択：料理道具を選んでください）";
    toolSelect.appendChild(noToolOpt);
    scenarioProject.items.filter(it => it.category === "cookingTool").forEach(it => {
      const opt = document.createElement("option");
      opt.value = it.id;
      opt.textContent = it.name || "（名称未設定の料理道具）";
      toolSelect.appendChild(opt);
    });
    toolSelect.value = recipe.toolItemId || "";
    toolSelect.onchange = () => { recipe.toolItemId = toolSelect.value || ""; markScenarioBuildDirty(); };
    typeRow.appendChild(toolSelect);
    recipe.mode = "create"; // ★料理に強化モードは無いので、常に「作成」扱いで固定する
  } else {
    typeRow.appendChild(labelSpan("対象の店："));
    const facilitySelect = document.createElement("select");
    facilitySelect.className = "scenariobuild-jump-select";
    const anyFacilityOpt = document.createElement("option");
    anyFacilityOpt.value = "";
    anyFacilityOpt.textContent = "（指定なし：この種類の店なら全部で使える）";
    facilitySelect.appendChild(anyFacilityOpt);
    scenarioProject.facilities.filter(f => f.type === (recipe.shopType || "blacksmith")).forEach(f => {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.name || "（名称未設定の店）";
      facilitySelect.appendChild(opt);
    });
    facilitySelect.value = recipe.facilityId || "";
    facilitySelect.onchange = () => { recipe.facilityId = facilitySelect.value || null; markScenarioBuildDirty(); };
    typeRow.appendChild(facilitySelect);
    
    typeRow.appendChild(labelSpan("種別："));
    const modeSelect = document.createElement("select");
    modeSelect.className = "scenariobuild-jump-select";
    [{ value: "create", label: "作成（材料だけを消費）" }, { value: "upgrade", label: "強化（材料＋指定した装備1個を消費）" }].forEach(opt => {
      const optionEl = document.createElement("option");
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      modeSelect.appendChild(optionEl);
    });
    modeSelect.value = recipe.mode || "create";
    modeSelect.onchange = () => { recipe.mode = modeSelect.value; markScenarioBuildDirty(); renderScenarioBuildPanel(); };
    typeRow.appendChild(modeSelect);
  }
  infoEl.appendChild(typeRow);
  
  if (recipe.shopType === "cooking") {
    const cookingNoteEl = document.createElement("p");
    cookingNoteEl.className = "devmode-note";
    cookingNoteEl.textContent = "料理タブでは、下の「必要な材料」と個数まで完全に一致する材料を置いた時だけ成立します（多い分・少ない分・種類違いはすべて失敗＝材料ロスになります）。このレシピのIDは、種類「料理」のレシピ発見アイテム（アイテム管理タブの「（レシピ）登録される料理レシピのID」）に設定すると、そのアイテムを使った時にレシピ帳へ登録されます。IDはこの行の右下に表示されます。";
    infoEl.appendChild(cookingNoteEl);
  }
  
  if (recipe.mode === "upgrade") {
    const baseRow = document.createElement("div");
    baseRow.className = "scenariobuild-condition-row";
    baseRow.appendChild(labelSpan("強化元にする装備のアイテムID（所持している物だけ店頭に出せます）："));
    const baseInput = document.createElement("input");
    baseInput.type = "text";
    baseInput.className = "scenariobuild-title-input";
    baseInput.setAttribute("list", "scenariobuild-item-datalist");
    baseInput.value = recipe.baseItemId || "";
    baseInput.onchange = () => { recipe.baseItemId = baseInput.value.trim(); markScenarioBuildDirty(); };
    baseRow.appendChild(baseInput);
    infoEl.appendChild(baseRow);
  }
  
  // ★材料一覧（アイテムID＋個数の組を、好きなだけ追加できる）
  const materialsHeader = document.createElement("div");
  materialsHeader.className = "scenariobuild-condition-row";
  materialsHeader.appendChild(labelSpan("必要な材料："));
  infoEl.appendChild(materialsHeader);
  if (!Array.isArray(recipe.materials)) recipe.materials = [];
  recipe.materials.forEach((mat, mi) => {
    const matRow = document.createElement("div");
    matRow.className = "scenariobuild-condition-row";
    const itemInput = document.createElement("input");
    itemInput.type = "text";
    itemInput.className = "scenariobuild-title-input";
    itemInput.placeholder = "素材のアイテムID";
    itemInput.setAttribute("list", "scenariobuild-item-datalist");
    itemInput.value = mat.itemId || "";
    itemInput.onchange = () => { mat.itemId = itemInput.value.trim(); markScenarioBuildDirty(); };
    matRow.appendChild(itemInput);
    
    matRow.appendChild(labelSpan("個数："));
    const countInput = document.createElement("input");
    countInput.type = "number";
    countInput.min = "1";
    countInput.className = "scenariobuild-condition-input";
    countInput.value = mat.count != null ? mat.count : 1;
    countInput.onchange = () => { mat.count = Math.max(1, Number(countInput.value) || 1); markScenarioBuildDirty(); };
    matRow.appendChild(countInput);
    
    const removeMatBtn = document.createElement("button");
    removeMatBtn.className = "devmode-btn devmode-btn-danger";
    removeMatBtn.textContent = "×";
    removeMatBtn.onclick = (event) => {
      event.stopPropagation();
      recipe.materials.splice(mi, 1);
      markScenarioBuildDirty();
      renderScenarioBuildPanel();
    };
    matRow.appendChild(removeMatBtn);
    infoEl.appendChild(matRow);
  });
  const addMatBtn = document.createElement("button");
  addMatBtn.className = "devmode-btn";
  addMatBtn.textContent = "＋材料を追加";
  addMatBtn.onclick = (event) => {
    event.stopPropagation();
    recipe.materials.push({ itemId: "", count: 1 });
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  infoEl.appendChild(addMatBtn);
  
  const resultRow = document.createElement("div");
  resultRow.className = "scenariobuild-condition-row";
  resultRow.appendChild(labelSpan("完成品のアイテムID："));
  const resultInput = document.createElement("input");
  resultInput.type = "text";
  resultInput.className = "scenariobuild-title-input";
  resultInput.setAttribute("list", "scenariobuild-item-datalist");
  resultInput.value = recipe.resultItemId || "";
  resultInput.onchange = () => { recipe.resultItemId = resultInput.value.trim(); markScenarioBuildDirty(); };
  resultRow.appendChild(resultInput);
  
  resultRow.appendChild(labelSpan("個数："));
  const resultCountInput = document.createElement("input");
  resultCountInput.type = "number";
  resultCountInput.min = "1";
  resultCountInput.className = "scenariobuild-condition-input";
  resultCountInput.value = recipe.resultCount != null ? recipe.resultCount : 1;
  resultCountInput.onchange = () => { recipe.resultCount = Math.max(1, Number(resultCountInput.value) || 1); markScenarioBuildDirty(); };
  resultRow.appendChild(resultCountInput);
  infoEl.appendChild(resultRow);
  
  const costRow = document.createElement("div");
  costRow.className = "scenariobuild-condition-row";
  costRow.appendChild(labelSpan("追加費用（陳・0でも可）："));
  const costInput = document.createElement("input");
  costInput.type = "number";
  costInput.min = "0";
  costInput.className = "scenariobuild-condition-input";
  costInput.value = recipe.cost != null ? recipe.cost : 0;
  costInput.onchange = () => { recipe.cost = Math.max(0, Number(costInput.value) || 0); markScenarioBuildDirty(); };
  costRow.appendChild(costInput);
  infoEl.appendChild(costRow);
  
  const descRow = document.createElement("div");
  descRow.className = "scenariobuild-condition-row";
  descRow.appendChild(labelSpan("店頭での説明文："));
  const descInput = document.createElement("input");
  descInput.type = "text";
  descInput.className = "scenariobuild-title-input";
  descInput.value = recipe.description || "";
  descInput.onchange = () => { recipe.description = descInput.value; markScenarioBuildDirty(); };
  descRow.appendChild(descInput);
  infoEl.appendChild(descRow);
  
  row.appendChild(infoEl);
  
  const idEl = document.createElement("p");
  idEl.className = "devmode-note";
  idEl.style.margin = "0 0 4px";
  idEl.textContent = `ID：${recipe.id}`;
  row.appendChild(idEl);
  
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "devmode-btn devmode-btn-danger";
  deleteBtn.textContent = "削除";
  deleteBtn.onclick = (event) => {
    event.stopPropagation();
    if (!confirm(`「${recipe.name}」を削除しますか？`)) return;
    scenarioProject.recipes.splice(scenarioProject.recipes.indexOf(recipe), 1);
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  row.appendChild(deleteBtn);
  
  return row;
}

function renderFlagManager(container) {
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "話のブロックエディタ（フラグブロック・IF条件・話の解放条件）で使えるon/off変数の一覧です。説明を残しておいたり、現在の値をここから直接テストで切り替えたりできます。";
  container.appendChild(introEl);
  
  const registeredNames = new Set(scenarioProject.flagDefs.map(d => d.name));
  
  scenarioProject.flagDefs.forEach((def, i) => {
    container.appendChild(buildFlagDefRow(def));
  });
  
  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋ フラグを新しく登録";
  addBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioProject.flagDefs.push({ name: "", description: "" });
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  container.appendChild(addBtn);
  
  // ★話の中で実際に使われているのに、まだ登録されていないフラグを検出して教える
  const usedNames = scanUsedFlagNames();
  const unregistered = [...usedNames].filter(name => !registeredNames.has(name));
  if (unregistered.length > 0) {
    const header = document.createElement("h4");
    header.className = "scenariobuild-subheading";
    header.textContent = "話の中で使われているが、まだ登録されていないフラグ";
    container.appendChild(header);
    
    unregistered.forEach(name => {
      const row = document.createElement("div");
      row.className = "scenariobuild-chapter-row";
      const label = document.createElement("span");
      label.textContent = `「${name}」（現在値：${scenarioFlags[name] ? "ON" : "OFF"}）`;
      row.appendChild(label);
      const registerBtn = document.createElement("button");
      registerBtn.className = "devmode-btn";
      registerBtn.textContent = "登録する";
      registerBtn.onclick = (event) => {
        event.stopPropagation();
        scenarioProject.flagDefs.push({ name, description: "" });
        markScenarioBuildDirty();
        renderScenarioBuildPanel();
      };
      row.appendChild(registerBtn);
      container.appendChild(row);
    });
  }
}

function buildFlagDefRow(def) {
  const row = document.createElement("div");
  row.className = "scenariobuild-chapter-row";
  
  const infoEl = document.createElement("div");
  infoEl.className = "scenariobuild-chapter-info";
  
  const nameRow = document.createElement("div");
  nameRow.className = "scenariobuild-condition-row";
  nameRow.appendChild(labelSpan("フラグ名（ブロックエディタで指定する名前と完全一致させること）："));
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "scenariobuild-title-input";
  nameInput.value = def.name || "";
  nameInput.onchange = () => { def.name = nameInput.value.trim(); markScenarioBuildDirty(); renderScenarioBuildPanel(); };
  nameRow.appendChild(nameInput);
  infoEl.appendChild(nameRow);
  
  const descRow = document.createElement("div");
  descRow.className = "scenariobuild-condition-row";
  descRow.appendChild(labelSpan("説明（どんな時にON/OFFになるか、メモしておく）："));
  const descInput = document.createElement("input");
  descInput.type = "text";
  descInput.className = "scenariobuild-title-input";
  descInput.value = def.description || "";
  descInput.onchange = () => { def.description = descInput.value; markScenarioBuildDirty(); };
  descRow.appendChild(descInput);
  infoEl.appendChild(descRow);
  
  const valueRow = document.createElement("div");
  valueRow.className = "scenariobuild-condition-row";
  const currentValue = !!(def.name && scenarioFlags[def.name]);
  valueRow.appendChild(labelSpan(`現在値：${currentValue ? "ON" : "OFF"}（テスト用に手動で切り替えられます）`));
  const toggleBtn = document.createElement("button");
  toggleBtn.className = "devmode-btn";
  toggleBtn.textContent = currentValue ? "OFFにする" : "ONにする";
  toggleBtn.disabled = !def.name;
  toggleBtn.onclick = (event) => {
    event.stopPropagation();
    setScenarioFlag(def.name, !currentValue); // ★scenarioFlags専用の保存関数（フラグはscenarioProjectとは別の場所に保存される）
    renderScenarioBuildPanel();
  };
  valueRow.appendChild(toggleBtn);
  infoEl.appendChild(valueRow);
  
  row.appendChild(infoEl);
  
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "devmode-btn devmode-btn-danger";
  deleteBtn.textContent = "削除";
  deleteBtn.onclick = (event) => {
    event.stopPropagation();
    if (!confirm(`「${def.name || "（名前未設定）"}」の登録を削除しますか？（フラグそのものの値やブロックでの参照は残ります。登録の削除だけです）`)) return;
    scenarioProject.flagDefs.splice(scenarioProject.flagDefs.indexOf(def), 1);
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  row.appendChild(deleteBtn);
  
  return row;
}

// ===================================================================
// ===== 要望対応：ランダム名前管理（オークションNPC等の名前バリエーション） =====
// ===================================================================
function renderRandomNameManager(container) {
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "オークションのNPC入札者など、ゲーム内でランダムに名前が必要な場面で使うファーストネームの一覧です。多めに登録しておくと、同じ名前ばかりにならず多様になります。";
  container.appendChild(introEl);
  
  const list = document.createElement("div");
  list.className = "scenariobuild-list";
  container.appendChild(list);
  
  scenarioProject.randomNamePool.forEach((name, i) => {
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    row.style.justifyContent = "space-between";
    row.style.gap = "8px";
    
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "scenariobuild-title-input";
    nameInput.value = name || "";
    nameInput.placeholder = "例：ハルト";
    nameInput.onchange = () => {
      scenarioProject.randomNamePool[i] = nameInput.value.trim();
      markScenarioBuildDirty();
      if (typeof saveCustomScenarioData === "function") saveCustomScenarioData();
    };
    row.appendChild(nameInput);
    
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "devmode-btn devmode-btn-danger";
    deleteBtn.textContent = "削除";
    deleteBtn.onclick = (event) => {
      event.stopPropagation();
      scenarioProject.randomNamePool.splice(i, 1);
      markScenarioBuildDirty();
      renderScenarioBuildPanel();
    };
    row.appendChild(deleteBtn);
    
    list.appendChild(row);
  });
  
  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋ 名前を追加";
  addBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioProject.randomNamePool.push("");
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  container.appendChild(addBtn);
  
  // ★何件も手入力するのは大変なので、改行・読点区切りでまとめて貼り付けられる欄も用意する
  const bulkHeading = document.createElement("h4");
  bulkHeading.className = "scenariobuild-subheading";
  bulkHeading.textContent = "まとめて追加（改行または「、」「,」区切りで貼り付け）";
  container.appendChild(bulkHeading);
  
  const bulkTextarea = document.createElement("textarea");
  bulkTextarea.className = "scenariobuild-textarea";
  bulkTextarea.rows = 3;
  bulkTextarea.placeholder = "例：ハルト、ユウナ、ソウマ";
  container.appendChild(bulkTextarea);
  
  const bulkAddBtn = document.createElement("button");
  bulkAddBtn.className = "devmode-btn";
  bulkAddBtn.textContent = "まとめて追加する";
  bulkAddBtn.onclick = (event) => {
    event.stopPropagation();
    const names = bulkTextarea.value
      .split(/[\n,、]/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    if (names.length === 0) return;
    scenarioProject.randomNamePool.push(...names);
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  container.appendChild(bulkAddBtn);
}

// ===================================================================
// ===== 要望対応：属性管理（属性一覧と属性相性表） =====
// ===================================================================
function renderElementManager(container) {
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "スキルや敵に設定する「属性」（火・氷など）を登録し、属性同士の相性（特攻・耐性・通常）を決められます。特攻＝ダメージ増、耐性＝ダメージ減、通常＝変化なし。敵が複数の属性を持つ場合、各属性との相性が掛け合わさって最終的なダメージ倍率になります。";
  container.appendChild(introEl);
  
  const listHeading = document.createElement("h4");
  listHeading.className = "scenariobuild-subheading";
  listHeading.textContent = "属性一覧";
  container.appendChild(listHeading);
  
  const list = document.createElement("div");
  list.className = "scenariobuild-list";
  container.appendChild(list);
  
  scenarioProject.elementDefs.forEach((el, i) => {
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    row.style.justifyContent = "space-between";
    row.style.gap = "8px";
    
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "scenariobuild-title-input";
    nameInput.value = el.name || "";
    nameInput.placeholder = "例：火";
    nameInput.onchange = () => {
      el.name = nameInput.value.trim();
      markScenarioBuildDirty();
      if (typeof saveCustomScenarioData === "function") saveCustomScenarioData();
      renderScenarioBuildPanel(); // ★相性表・見出しの表示名にも反映する
    };
    row.appendChild(nameInput);
    
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "devmode-btn devmode-btn-danger";
    deleteBtn.textContent = "削除";
    deleteBtn.onclick = (event) => {
      event.stopPropagation();
      if (!confirm(`「${el.name || "（名前未設定）"}」を削除しますか？（この属性を使っているスキル・敵の設定は残りますが、削除後は「無」属性として扱われます）`)) return;
      scenarioProject.elementDefs.splice(i, 1);
      // ★この属性が絡む相性データも一緒に削除しておく
      Object.keys(scenarioProject.elementMatchups).forEach(key => {
        if (key.startsWith(el.id + ">") || key.endsWith(">" + el.id)) delete scenarioProject.elementMatchups[key];
      });
      markScenarioBuildDirty();
      renderScenarioBuildPanel();
    };
    row.appendChild(deleteBtn);
    
    list.appendChild(row);
  });
  
  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋ 属性を追加";
  addBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioProject.elementDefs.push({ id: generateId("element"), name: "" });
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  container.appendChild(addBtn);
  
  const matrixHeading = document.createElement("h4");
  matrixHeading.className = "scenariobuild-subheading";
  matrixHeading.textContent = "属性相性表（縦：攻撃する側の属性／横：受ける側の属性）";
  container.appendChild(matrixHeading);
  
  if (scenarioProject.elementDefs.length < 1) {
    const note = document.createElement("p");
    note.className = "devmode-note";
    note.textContent = "属性を1つ以上登録すると、ここに相性表が表示されます。";
    container.appendChild(note);
    return;
  }
  
  const tableWrap = document.createElement("div");
  tableWrap.className = "scenariobuild-element-matrix-wrap";
  const table = document.createElement("table");
  table.className = "scenariobuild-element-matrix";
  
  const headRow = document.createElement("tr");
  headRow.appendChild(document.createElement("th"));
  scenarioProject.elementDefs.forEach(defEl => {
    const th = document.createElement("th");
    th.textContent = defEl.name || "（無名）";
    headRow.appendChild(th);
  });
  table.appendChild(headRow);
  
  scenarioProject.elementDefs.forEach(atkEl => {
    const row = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = atkEl.name || "（無名）";
    row.appendChild(th);
    scenarioProject.elementDefs.forEach(defEl => {
      const td = document.createElement("td");
      const select = document.createElement("select");
      select.className = "scenariobuild-element-matrix-select";
      [["normal", "通常"], ["advantage", "特攻"], ["resist", "耐性"]].forEach(([v, label]) => {
        const opt = document.createElement("option");
        opt.value = v; opt.textContent = label;
        select.appendChild(opt);
      });
      const key = atkEl.id + ">" + defEl.id;
      select.value = scenarioProject.elementMatchups[key] || "normal";
      select.onchange = () => {
        if (select.value === "normal") delete scenarioProject.elementMatchups[key];
        else scenarioProject.elementMatchups[key] = select.value;
        markScenarioBuildDirty();
        if (typeof saveCustomScenarioData === "function") saveCustomScenarioData();
      };
      td.appendChild(select);
      row.appendChild(td);
    });
    table.appendChild(row);
  });
  
  tableWrap.appendChild(table);
  container.appendChild(tableWrap);
}

// ★状態管理タブは他のシナリオビルド画面と逆に、左のメイン画面に状態異常/状態強化の一覧を出し、
//   右のサブ画面で選んだ項目を編集する構成にしてある（メイン画面：renderStatusMainList／サブ画面：renderStatusManager）
function renderStatusMainList(container) {
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "技の「状態異常①②」「自己強化」で使える種類を管理します。左が状態異常、右が状態強化です。名前を押すと、右のサブ画面で表示名・説明・動作の種類・既定値を詳しく設定できます。";
  container.appendChild(introEl);
  
  const columnsEl = document.createElement("div");
  columnsEl.className = "scenariobuild-status-columns";
  
  const ailmentCol = document.createElement("div");
  ailmentCol.className = "scenariobuild-status-column";
  const ailmentHeader = document.createElement("h4");
  ailmentHeader.className = "scenariobuild-subheading";
  ailmentHeader.textContent = "状態異常（敵や自分にかける、不利な状態）";
  ailmentCol.appendChild(ailmentHeader);
  const ailmentList = document.createElement("div");
  ailmentList.className = "scenariobuild-list";
  scenarioProject.statusAilments.forEach((def) => {
    ailmentList.appendChild(buildStatusListRow(def, "statusAilments"));
  });
  ailmentCol.appendChild(ailmentList);
  const addAilmentBtn = document.createElement("button");
  addAilmentBtn.className = "devmode-btn";
  addAilmentBtn.textContent = "＋ 状態異常の種類を追加";
  addAilmentBtn.onclick = (event) => {
    event.stopPropagation();
    const def = { id: generateId("ailment"), mechanic: "poison", label: "新しい状態異常", description: "", defaultDuration: 3, defaultPower: 3, defaultChance: 1, builtin: false };
    scenarioProject.statusAilments.push(def);
    markScenarioBuildDirty();
    scenarioBuildEditingStatusRef = { category: "statusAilments", id: def.id }; // ★追加したその場でサブ画面に詳細編集を出す
    renderScenarioBuildPanel();
  };
  ailmentCol.appendChild(addAilmentBtn);
  columnsEl.appendChild(ailmentCol);
  
  const buffCol = document.createElement("div");
  buffCol.className = "scenariobuild-status-column";
  const buffHeader = document.createElement("h4");
  buffHeader.className = "scenariobuild-subheading";
  buffHeader.textContent = "状態強化（自分にかける、有利な状態）";
  buffCol.appendChild(buffHeader);
  const buffList = document.createElement("div");
  buffList.className = "scenariobuild-list";
  scenarioProject.statusBuffs.forEach((def) => {
    buffList.appendChild(buildStatusListRow(def, "statusBuffs"));
  });
  buffCol.appendChild(buffList);
  const addBuffBtn = document.createElement("button");
  addBuffBtn.className = "devmode-btn";
  addBuffBtn.textContent = "＋ 状態強化の種類を追加";
  addBuffBtn.onclick = (event) => {
    event.stopPropagation();
    const def = { id: generateId("buff"), mechanic: "atkUp", label: "新しい状態強化", description: "", defaultDuration: 3, defaultPower: 5, builtin: false };
    scenarioProject.statusBuffs.push(def);
    markScenarioBuildDirty();
    scenarioBuildEditingStatusRef = { category: "statusBuffs", id: def.id }; // ★追加したその場でサブ画面に詳細編集を出す
    renderScenarioBuildPanel();
  };
  buffCol.appendChild(addBuffBtn);
  columnsEl.appendChild(buffCol);
  
  container.appendChild(columnsEl);
}

// ★メイン画面（左）に出す1行分：名前を押すとサブ画面（右）にその項目の編集フォームが出る
function buildStatusListRow(def, category) {
  const row = document.createElement("div");
  const isSelected = scenarioBuildEditingStatusRef && scenarioBuildEditingStatusRef.category === category && scenarioBuildEditingStatusRef.id === def.id;
  row.className = "scenariobuild-chapter-row" + (def.builtin ? " scenariobuild-chapter-row-builtin" : "") + (isSelected ? " scenariobuild-tab-btn-active" : "");
  row.style.cursor = "pointer";
  row.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildEditingStatusRef = { category, id: def.id };
    renderScenarioBuildPanel(); // ★選択中の行を光らせるため、メイン側も出し直す
  };
  
  const infoEl = document.createElement("div");
  infoEl.className = "scenariobuild-chapter-info";
  const nameEl = document.createElement("p");
  nameEl.className = "scenariobuild-title-input";
  nameEl.style.background = "none";
  nameEl.style.border = "none";
  nameEl.textContent = (def.label || "（名前未設定）") + (def.builtin ? "（組み込み）" : "");
  infoEl.appendChild(nameEl);
  row.appendChild(infoEl);
  
  return row;
}

// ===== サブ画面（右）：状態異常/状態強化の詳細編集。scenarioBuildSubView === "statuses" =====
function renderStatusManager(container) {
  const ref = scenarioBuildEditingStatusRef;
  const category = ref && ref.category;
  const list = category && scenarioProject[category];
  const def = list && list.find(d => d.id === ref.id);
  
  if (!def) {
    const introEl = document.createElement("p");
    introEl.className = "devmode-note";
    introEl.textContent = "左の一覧から、編集したい状態異常／状態強化を選んでください。";
    container.appendChild(introEl);
    return;
  }
  
  const mechanicOptions = category === "statusAilments" ? STATUS_AILMENT_MECHANIC_OPTIONS : STATUS_BUFF_MECHANIC_OPTIONS;
  const hasChance = category === "statusAilments";
  
  const titleEl = document.createElement("h3");
  titleEl.textContent = `詳細設定：${def.label || def.id}` + (def.builtin ? "（組み込み）" : "");
  container.appendChild(titleEl);
  
  const formWrap = document.createElement("div");
  formWrap.className = "scenariobuild-list";
  const infoEl = document.createElement("div");
  infoEl.className = "scenariobuild-chapter-info";
  
  const nameRow = document.createElement("div");
  nameRow.className = "scenariobuild-condition-row";
  nameRow.appendChild(labelSpan("表示名："));
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "scenariobuild-title-input";
  nameInput.value = def.label || "";
  nameInput.onchange = () => { def.label = nameInput.value; markScenarioBuildDirty(); renderScenarioBuildMain(); }; // ★左の一覧の表示名も更新する
  nameRow.appendChild(nameInput);
  if (def.builtin) nameRow.appendChild(labelSpan("（組み込み・削除不可）"));
  infoEl.appendChild(nameRow);
  
  const descRow = document.createElement("div");
  descRow.className = "scenariobuild-condition-row";
  descRow.appendChild(labelSpan("説明："));
  const descInput = document.createElement("input");
  descInput.type = "text";
  descInput.className = "scenariobuild-title-input";
  descInput.value = def.description || "";
  descInput.onchange = () => { def.description = descInput.value; markScenarioBuildDirty(); };
  descRow.appendChild(descInput);
  infoEl.appendChild(descRow);
  
  const mechanicRow = document.createElement("div");
  mechanicRow.className = "scenariobuild-condition-row";
  mechanicRow.appendChild(labelSpan("動作の種類："));
  const mechanicSelect = document.createElement("select");
  mechanicSelect.className = "scenariobuild-jump-select";
  mechanicSelect.disabled = !!def.builtin; // ★組み込みは動作を変えると既存の技の見た目と噛み合わなくなるので固定
  mechanicOptions.forEach(opt => {
    const optionEl = document.createElement("option");
    optionEl.value = opt.value;
    optionEl.textContent = opt.label;
    mechanicSelect.appendChild(optionEl);
  });
  mechanicSelect.value = def.mechanic;
  mechanicSelect.onchange = () => { def.mechanic = mechanicSelect.value; markScenarioBuildDirty(); };
  mechanicRow.appendChild(mechanicSelect);
  infoEl.appendChild(mechanicRow);
  
  const valuesRow = document.createElement("div");
  valuesRow.className = "scenariobuild-condition-row";
  valuesRow.appendChild(labelSpan("既定のターン数："));
  const durationInput = document.createElement("input");
  durationInput.type = "number";
  durationInput.className = "scenariobuild-condition-input";
  durationInput.value = def.defaultDuration != null ? def.defaultDuration : 3;
  durationInput.onchange = () => { def.defaultDuration = Number(durationInput.value) || 1; markScenarioBuildDirty(); };
  valuesRow.appendChild(durationInput);
  valuesRow.appendChild(labelSpan("既定の効果量："));
  const powerInput = document.createElement("input");
  powerInput.type = "number";
  powerInput.className = "scenariobuild-condition-input";
  powerInput.value = def.defaultPower != null ? def.defaultPower : 0;
  powerInput.onchange = () => { def.defaultPower = Number(powerInput.value) || 0; markScenarioBuildDirty(); };
  valuesRow.appendChild(powerInput);
  if (hasChance) {
    valuesRow.appendChild(labelSpan("既定の確率(0〜1)："));
    const chanceInput = document.createElement("input");
    chanceInput.type = "number";
    chanceInput.step = "0.1";
    chanceInput.className = "scenariobuild-condition-input";
    chanceInput.value = def.defaultChance != null ? def.defaultChance : 1;
    chanceInput.onchange = () => { def.defaultChance = Number(chanceInput.value) || 1; markScenarioBuildDirty(); };
    valuesRow.appendChild(chanceInput);
  }
  infoEl.appendChild(valuesRow);
  
  formWrap.appendChild(infoEl);
  container.appendChild(formWrap);
  
  if (!def.builtin) {
    const buttonsRow = document.createElement("div");
    buttonsRow.className = "scenariobuild-chapter-buttons";
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "devmode-btn devmode-btn-danger";
    deleteBtn.textContent = "削除";
    deleteBtn.onclick = async (event) => {
      event.stopPropagation();
      const ok = await showGameConfirm(`「${def.label}」を削除しますか？ この種類を使っている技があると、効果が無くなります。`);
      if (!ok) return;
      list.splice(list.indexOf(def), 1);
      markScenarioBuildDirty();
      scenarioBuildEditingStatusRef = null;
      renderScenarioBuildPanel();
    };
    buttonsRow.appendChild(deleteBtn);
    container.appendChild(buttonsRow);
  }
}


// ★player.jsのCLASS_SKILLSは「職業ごとに、決まった25段階のレベルへ技を1つずつアタッチする」構造。
//   この画面ではその構造をそのまま見せて、枠ごとに技の追加／編集／アタッチ解除／並び替え（レベル入れ替え）ができるようにする
let scenarioBuildSkillClassView = null; // ★今選んでいる職業（未選択ならCLASS_MASTERの先頭）
// ★状態異常・状態強化の選択肢は、状態管理タブで追加・編集した内容がそのまま反映されるよう、
//   固定の配列ではなく毎回scenarioProjectから組み立てる関数にしてある
function getSkillStatusKindOptions() {
  const list = (scenarioProject.statusAilments || []).map(def => ({ value: def.id, label: `${def.label}${def.description ? "（" + def.description + "）" : ""}` }));
  return [{ value: "", label: "（なし）" }, ...list];
}
function getSkillSelfBuffKindOptions() {
  const list = (scenarioProject.statusBuffs || []).map(def => ({ value: def.id, label: `${def.label}${def.description ? "（" + def.description + "）" : ""}` }));
  return [{ value: "", label: "（なし）" }, ...list];
}

// ===================================================================
// ===== 特殊スキル・ブロック編集システム =====
// ===================================================================
// ★話のブロックエディタと同じ見た目・操作感で、技の動作を自由に組み立てられるようにする。
//   skill.blocksが1件以上あれば「ブロック実行モード」になり、固定フィールド（power等）は無視される（battle.js側）。
const SKILL_BLOCK_TYPES = {
  if: "条件分岐（if）",
  jump: "指定ブロックへジャンプ",
  flag: "フラグの読み書き",
  message: "セリフ・地の文",
  damage: "ダメージを与える",
  heal: "HP/SPを回復する",
  revive: "戦闘不能から蘇生させる", // ★要望対応：HP/SP回復ブロックとは別に、蘇生専用のブロックを追加
  adjustGauge: "HP/SPを増減する（マイナス指定で消費・減少にも使える）",
  selfDamage: "自分にダメージ（代償）",
  applyStatus: "状態異常/強化を付与",
  setVariable: "専用変数を書き換える",
  repeat: "くり返す（多段ヒット等）",
  checkTurnCount: "経過ターン数を変数に入れる",
  turnMeasureStart: "ターン経過計測：開始",
  turnMeasureEnd: "ターン経過計測：終了",
  choice: "選択肢",
  end: "ここで技の効果を終える"
};

function createSkillBlock(type) {
  const base = { id: generateId("skillblock"), type };
  if (type === "if") return { ...base, expression: "", trueBlocks: [], falseBlocks: [], trueJumpBlockId: null, falseJumpBlockId: null };
  if (type === "jump") return { ...base, targetBlockId: null }; // ★要望対応：ifの中/外を問わず、技の中のどのブロックへも直接ジャンプできる
  if (type === "flag") return { ...base, flagName: "", mode: "on" };
  if (type === "message") return { ...base, speaker: "", text: "" };
  if (type === "damage") return { ...base, target: "single", powerMultiplier: "1", atkType: "physical" };
  if (type === "heal") return { ...base, target: "self", gauge: "hp", amount: "0" };
  if (type === "revive") return { ...base, target: "self", companionId: "", amount: "50", amountIsPercent: true };
  if (type === "adjustGauge") return { ...base, target: "self", gauge: "sp", amount: "0" }; // ★amountの式がマイナスなら減少、プラスなら回復として扱う（敵は対象にできない）
  if (type === "selfDamage") return { ...base, amount: "0" };
  if (type === "applyStatus") return { ...base, targetSide: "enemy", target: "single", statusId: "", duration: "3", power: "0", chance: "1" };
  if (type === "setVariable") return { ...base, varName: "", expression: "0" };
  if (type === "repeat") return { ...base, countExpression: "1", bodyBlocks: [] };
  if (type === "checkTurnCount") return { ...base, varName: "", source: "sinceStart", measureName: "" }; // source: "sinceStart"（戦闘開始からの経過）｜"measured"（計測開始〜終了/現在の経過）
  if (type === "turnMeasureStart") return { ...base, measureName: "" };
  if (type === "turnMeasureEnd") return { ...base, measureName: "" };
  if (type === "choice") return { ...base, prompt: "", options: [{ id: generateId("skopt"), text: "選択肢1" }], varName: "choice" }; // ★選んだ選択肢の番号（0始まり）をvarNameの変数に入れる。分岐はこの後にifブロックを置いて振り分ける
  return base; // end
}

function skillBlockPreviewText(block) {
  if (block.type === "if") return block.expression || "（式未入力）";
  if (block.type === "jump") return block.targetBlockId ? "→ 指定ブロックへ" : "（未設定）";
  if (block.type === "flag") return block.flagName ? `${block.flagName}を${block.mode === "off" ? "OFF" : block.mode === "toggle" ? "反転" : "ON"}に` : "";
  if (block.type === "message") return (block.text || "").slice(0, 12);
  if (block.type === "damage") return `${block.target === "all" ? "全体" : block.target === "random" ? "ランダム" : "単体"}に威力${block.powerMultiplier}`;
  if (block.type === "heal") {
    const gaugeLabel = block.gauge === "sp" ? "SP" : block.gauge === "fatigue" ? "疲労度" : block.gauge === "sleepiness" ? "眠気" : "HP";
    return `${block.target === "all" ? "全員" : "自分"}の${gaugeLabel}を${block.amount}${block.amountIsPercent ? "%" : ""}回復`;
  }
  if (block.type === "adjustGauge") return `${block.target === "all" ? "全員" : "自分"}の${block.gauge === "sp" ? "SP" : "HP"}を${block.amount}増減`;
  if (block.type === "selfDamage") return `自分に${block.amount}ダメージ`;
  if (block.type === "applyStatus") {
    const list = block.targetSide === "self" || block.targetSide === "allies" ? scenarioProject.statusBuffs : scenarioProject.statusAilments;
    const def = (list || []).find(d => d.id === block.statusId);
    const sideLabel = block.targetSide === "self" ? "自分" : block.targetSide === "allies" ? "味方全体" : "敵";
    return `${sideLabel}に${def ? def.label : "（未選択）"}`;
  }
  if (block.type === "setVariable") return `${block.varName || "（未入力）"} ＝ ${block.expression}`;
  if (block.type === "repeat") return `${block.countExpression}回くり返す（中身${(block.bodyBlocks || []).length}件）`;
  if (block.type === "checkTurnCount") return block.varName ? `${block.varName}に代入（${block.source === "measured" ? "計測分" : "戦闘開始から"}）` : "（未入力）";
  if (block.type === "turnMeasureStart") return block.measureName || "（無名の計測）";
  if (block.type === "turnMeasureEnd") return block.measureName || "（無名の計測）";
  if (block.type === "choice") return (block.options || []).map(o => o.text).filter(Boolean).join(" / ") || "（未入力）";
  if (block.type === "end") return "";
  return "";
}

// ★指定した1つのブロック配列（skill.blocks、またはrepeatの中身bodyBlocks）の中だけで、ジャンプ先を選べるようにする
function buildSkillBlockJumpSelect(blocksArray, currentBlockId, selectedBlockId, onChange) {
  const select = document.createElement("select");
  select.className = "scenariobuild-jump-select";
  
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "（次のブロックに進む）";
  select.appendChild(defaultOption);
  
  blocksArray.forEach((block, index) => {
    if (block.id === currentBlockId) return;
    const option = document.createElement("option");
    option.value = block.id;
    const preview = skillBlockPreviewText(block);
    option.textContent = `${index + 1}. ${SKILL_BLOCK_TYPES[block.type] || block.type}${preview ? "：" + preview : ""}`;
    select.appendChild(option);
  });
  
  select.value = selectedBlockId || "";
  select.onchange = () => onChange(select.value || null);
  return select;
}

// ★要望対応（ジャンプブロック用）：技が持つ全ブロックを、ネスト（ifの中身・くり返しの中身）の
//   深さに関わらずフラットな一覧にする。ifブロックの外や、別の分岐の中身へもジャンプできるようにするため
// ★バグ修正：以前はskill.blocks.find(...)で直下しか探しておらず、ifブロックの中に
//   ネストしたifブロックの編集ボタンを押すと見つからず編集画面から弾かれてしまっていた（要望対応）。
//   ifの中身（trueBlocks/falseBlocks）・くり返しの中身（bodyBlocks）も、何段ネストしていても探し出す
function findSkillBlockDeep(skill, blockId) {
  const entry = collectSkillBlocksFlat(skill.blocks).find(e => e.block.id === blockId);
  return entry ? entry.block : null;
}

function collectSkillBlocksFlat(blocks, depth) {
  depth = depth || 0;
  let list = [];
  (blocks || []).forEach(b => {
    list.push({ block: b, depth });
    if (b.type === "if") {
      list = list.concat(collectSkillBlocksFlat(b.trueBlocks, depth + 1));
      list = list.concat(collectSkillBlocksFlat(b.falseBlocks, depth + 1));
    } else if (b.type === "repeat") {
      list = list.concat(collectSkillBlocksFlat(b.bodyBlocks, depth + 1));
    }
  });
  return list;
}

function buildSkillJumpTargetSelect(skill, excludeBlockId, selectedBlockId, onChange) {
  const select = document.createElement("select");
  select.className = "scenariobuild-jump-select";
  
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "（未設定）";
  select.appendChild(defaultOption);
  
  collectSkillBlocksFlat(skill.blocks).forEach(({ block, depth }) => {
    if (block.id === excludeBlockId) return;
    const option = document.createElement("option");
    option.value = block.id;
    const preview = skillBlockPreviewText(block);
    option.textContent = `${"　".repeat(depth)}${SKILL_BLOCK_TYPES[block.type] || block.type}${preview ? "：" + preview : ""}`;
    select.appendChild(option);
  });
  
  select.value = selectedBlockId || "";
  select.onchange = () => onChange(select.value || null);
  return select;
}

function buildSkillBlockInsertSlot(blocksArray, insertIndex, skill, persist) {
  const slot = document.createElement("div");
  slot.className = "scenariobuild-insert-slot";
  
  const isOpenHere = scenarioBuildSkillInsertMenuTarget
    && scenarioBuildSkillInsertMenuTarget.blocksArray === blocksArray
    && scenarioBuildSkillInsertMenuTarget.index === insertIndex;
  
  if (isOpenHere) {
    const menu = document.createElement("div");
    menu.className = "scenariobuild-insert-menu";
    Object.keys(SKILL_BLOCK_TYPES).forEach(type => {
      const btn = document.createElement("button");
      btn.className = "devmode-btn";
      btn.textContent = SKILL_BLOCK_TYPES[type];
      btn.onclick = (event) => {
        event.stopPropagation();
        blocksArray.splice(insertIndex, 0, createSkillBlock(type));
        persist();
        scenarioBuildSkillInsertMenuTarget = null;
        renderScenarioBuildPanel();
      };
      menu.appendChild(btn);
    });
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "devmode-btn";
    cancelBtn.textContent = "×";
    cancelBtn.onclick = (event) => {
      event.stopPropagation();
      scenarioBuildSkillInsertMenuTarget = null;
      renderScenarioBuildPanel();
    };
    menu.appendChild(cancelBtn);
    slot.appendChild(menu);
  } else {
    const plusBtn = document.createElement("button");
    plusBtn.className = "scenariobuild-insert-plus";
    plusBtn.textContent = "＋";
    plusBtn.onclick = (event) => {
      event.stopPropagation();
      scenarioBuildSkillInsertMenuTarget = { blocksArray, index: insertIndex };
      renderScenarioBuildPanel();
    };
    slot.appendChild(plusBtn);
  }
  
  return slot;
}

function buildSkillExpressionInput(block, field, placeholder, persist) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "scenariobuild-condition-input";
  input.placeholder = placeholder || "例：技威力 * (2 - 自分HP割合)";
  input.value = block[field] != null ? String(block[field]) : "";
  input.onchange = () => { block[field] = input.value; persist(); };
  return input;
}

// ★特殊技のifブロックの条件エディタ本体（要望対応：シナリオのifブロックと同じく、専用画面（skillIfEditor）で編集できるようにする）
function buildSkillIfConditionEditorFields(blocksArray, block, wrap, persist) {
  const row = document.createElement("div");
  row.className = "scenariobuild-condition-row";
  row.appendChild(labelSpan("条件式："));
  row.appendChild(buildSkillExpressionInput(block, "expression", "例：自分HP割合 < 0.3", persist));
  wrap.appendChild(row);
  const noteEl = document.createElement("p");
  noteEl.className = "devmode-note";
  noteEl.textContent = "結果が0以外（true）なら「真の時」、0（false）なら「偽の時」の中身が実行されます。中身を最後まで実行し終えたら、このifブロックの次へ進みます。";
  wrap.appendChild(noteEl);
  
  // ★要望対応：話のifブロックと同じく、真/偽それぞれの中身を直接ブロックとして書けるようにする
  if (!Array.isArray(block.trueBlocks)) block.trueBlocks = [];
  if (!Array.isArray(block.falseBlocks)) block.falseBlocks = [];
  const trueRow = document.createElement("div");
  trueRow.className = "scenariobuild-condition-row";
  trueRow.appendChild(labelSpan("真の時："));
  const trueSummary = document.createElement("span");
  trueSummary.className = "devmode-note";
  trueSummary.textContent = block.trueBlocks.length > 0 ? `ブロック${block.trueBlocks.length}個` : "未設定";
  trueRow.appendChild(trueSummary);
  const trueEditBtn = document.createElement("button");
  trueEditBtn.className = "devmode-btn";
  trueEditBtn.textContent = "編集";
  trueEditBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildEditingSkillIfBlockId = block.id;
    scenarioBuildEditingSkillIfBranch = "true";
    scenarioBuildMainView = "skillIfBranchEditor";
    renderScenarioBuildPanel();
  };
  trueRow.appendChild(trueEditBtn);
  wrap.appendChild(trueRow);
  
  const falseRow = document.createElement("div");
  falseRow.className = "scenariobuild-condition-row";
  falseRow.appendChild(labelSpan("偽の時："));
  const falseSummary = document.createElement("span");
  falseSummary.className = "devmode-note";
  falseSummary.textContent = block.falseBlocks.length > 0 ? `ブロック${block.falseBlocks.length}個` : "未設定（そのまま次のブロックへ進みます）";
  falseRow.appendChild(falseSummary);
  const falseEditBtn = document.createElement("button");
  falseEditBtn.className = "devmode-btn";
  falseEditBtn.textContent = "編集";
  falseEditBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildEditingSkillIfBlockId = block.id;
    scenarioBuildEditingSkillIfBranch = "false";
    scenarioBuildMainView = "skillIfBranchEditor";
    renderScenarioBuildPanel();
  };
  falseRow.appendChild(falseEditBtn);
  wrap.appendChild(falseRow);
}

function buildSkillBlockFormFields(blocksArray, block, skill, persist) {
  const wrap = document.createElement("div");
  wrap.className = "scenariobuild-block-fields";
  
  if (block.type === "message") {
    const speakerInput = document.createElement("input");
    speakerInput.type = "text";
    speakerInput.className = "scenariobuild-title-input";
    speakerInput.placeholder = "話者名（空なら地の文）";
    speakerInput.value = block.speaker || "";
    speakerInput.onchange = () => { block.speaker = speakerInput.value; persist(); };
    wrap.appendChild(speakerInput);
    
    const textArea = document.createElement("textarea");
    textArea.className = "scenariobuild-textarea";
    textArea.placeholder = "「渾身の一撃！」と叫んだ！";
    textArea.value = block.text || "";
    textArea.onchange = () => { block.text = textArea.value; persist(); };
    wrap.appendChild(textArea);
    
  } else if (block.type === "flag") {
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "scenariobuild-title-input";
    nameInput.placeholder = "フラグ名";
    nameInput.value = block.flagName || "";
    nameInput.onchange = () => { block.flagName = nameInput.value; persist(); };
    row.appendChild(nameInput);
    const modeSelect = document.createElement("select");
    modeSelect.className = "scenariobuild-jump-select";
    [["on", "ONにする"], ["off", "OFFにする"], ["toggle", "反転させる"]].forEach(([v, l]) => {
      const opt = document.createElement("option"); opt.value = v; opt.textContent = l; modeSelect.appendChild(opt);
    });
    modeSelect.value = block.mode || "on";
    modeSelect.onchange = () => { block.mode = modeSelect.value; persist(); };
    row.appendChild(modeSelect);
    wrap.appendChild(row);
    
  } else if (block.type === "if") {
    const summaryEl = document.createElement("p");
    summaryEl.className = "devmode-note scenariobuild-condition";
    summaryEl.textContent = block.expression ? `条件式：${block.expression}` : "条件式が未入力です";
    wrap.appendChild(summaryEl);
    const editBtn = document.createElement("button");
    editBtn.className = "devmode-btn";
    editBtn.textContent = "編集";
    editBtn.onclick = (event) => {
      event.stopPropagation();
      scenarioBuildEditingSkillIfBlockId = block.id;
      scenarioBuildMainView = "skillIfEditor";
      renderScenarioBuildPanel();
    };
    wrap.appendChild(editBtn);
    
  } else if (block.type === "jump") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note";
    noteEl.textContent = "指定したブロックへ直接ジャンプします。ifブロックの中からでも、外側や別の分岐のブロックを指定できます（このジャンプブロックより前のブロックを指定すると、ループになります）。";
    wrap.appendChild(noteEl);
    wrap.appendChild(buildSkillJumpTargetSelect(skill, block.id, block.targetBlockId, (val) => {
      block.targetBlockId = val;
      persist();
    }));
    
  } else if (block.type === "damage") {
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    row.appendChild(labelSpan("対象："));
    const targetSelect = document.createElement("select");
    targetSelect.className = "scenariobuild-jump-select";
    [["single", "選んだ相手"], ["all", "敵全体"], ["random", "ランダムな敵"]].forEach(([v, l]) => {
      const opt = document.createElement("option"); opt.value = v; opt.textContent = l; targetSelect.appendChild(opt);
    });
    targetSelect.value = block.target || "single";
    targetSelect.onchange = () => { block.target = targetSelect.value; persist(); };
    row.appendChild(targetSelect);
    const atkTypeSelect = document.createElement("select");
    atkTypeSelect.className = "scenariobuild-jump-select";
    [["physical", "物理攻撃力"], ["magical", "魔法攻撃力"]].forEach(([v, l]) => {
      const opt = document.createElement("option"); opt.value = v; opt.textContent = l; atkTypeSelect.appendChild(opt);
    });
    atkTypeSelect.value = block.atkType || "physical";
    atkTypeSelect.onchange = () => { block.atkType = atkTypeSelect.value; persist(); };
    row.appendChild(atkTypeSelect);
    wrap.appendChild(row);
    const multRow = document.createElement("div");
    multRow.className = "scenariobuild-condition-row";
    multRow.appendChild(labelSpan("技の威力（式）："));
    multRow.appendChild(buildSkillExpressionInput(block, "powerMultiplier", "例：45　／　30+自分レベル÷2", persist));
    wrap.appendChild(multRow);
    const hintEl = document.createElement("p");
    hintEl.className = "devmode-note";
    hintEl.style.margin = "4px 0 8px";
    hintEl.textContent = "★通常技の「威力」欄と同じ基準の数値をそのまま入れてください（倍率ではありません）";
    wrap.appendChild(hintEl);
    
  } else if (block.type === "heal") {
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    row.appendChild(labelSpan("対象："));
    const targetSelect = document.createElement("select");
    targetSelect.className = "scenariobuild-jump-select";
    [["self", "自分だけ"], ["all", "自分＋生きている仲間全員"]].forEach(([v, l]) => {
      const opt = document.createElement("option"); opt.value = v; opt.textContent = l; targetSelect.appendChild(opt);
    });
    targetSelect.value = block.target || "self";
    targetSelect.onchange = () => { block.target = targetSelect.value; persist(); };
    row.appendChild(targetSelect);
    const gaugeSelect = document.createElement("select");
    gaugeSelect.className = "scenariobuild-jump-select";
    [["hp", "HP"], ["sp", "SP"], ["fatigue", "疲労度を減らす（要望対応）"], ["sleepiness", "眠気を減らす（要望対応）"]].forEach(([v, l]) => {
      const opt = document.createElement("option"); opt.value = v; opt.textContent = l; gaugeSelect.appendChild(opt);
    });
    gaugeSelect.value = block.gauge || "hp";
    gaugeSelect.onchange = () => { block.gauge = gaugeSelect.value; persist(); };
    row.appendChild(gaugeSelect);
    wrap.appendChild(row);
    if (block.gauge === "fatigue" || block.gauge === "sleepiness") {
      const noteEl = document.createElement("p");
      noteEl.className = "devmode-note";
      noteEl.textContent = "疲労度・眠気は主人公だけが持つゲージなので、対象が「自分＋仲間全員」でも主人公にだけ適用されます。";
      wrap.appendChild(noteEl);
    }
    const amountRow = document.createElement("div");
    amountRow.className = "scenariobuild-condition-row";
    amountRow.appendChild(labelSpan("回復量（式）："));
    amountRow.appendChild(buildSkillExpressionInput(block, "amount", "例：技威力 * 1.5", persist));
    wrap.appendChild(amountRow);
    
    // ★要望対応：「50%回復」のように、最大値に対する割合で指定できるようにする
    //   （固定値のままだと、疲労度の最大値がクラスごとに違う場合などに数値合わせが面倒なため）
    const modeRow = document.createElement("div");
    modeRow.className = "scenariobuild-condition-row";
    const modeLabel = document.createElement("label");
    modeLabel.className = "scenariobuild-inline-checkbox";
    const modeCheckbox = document.createElement("input");
    modeCheckbox.type = "checkbox";
    modeCheckbox.checked = block.amountIsPercent === true;
    modeCheckbox.onchange = () => { block.amountIsPercent = modeCheckbox.checked; persist(); renderScenarioBuildPanel(); };
    modeLabel.appendChild(modeCheckbox);
    modeLabel.append(" 上の数値を「最大値に対する割合(%)」として扱う（例：50なら50%回復。対象ごとの最大値を見て計算します）");
    modeRow.appendChild(modeLabel);
    wrap.appendChild(modeRow);
    
  } else if (block.type === "revive") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note";
    noteEl.textContent = "戦闘不能になった仲間を、HPを回復させながら復活させます（回復ブロックと違い、戦闘不能状態でも効果があります）。生きている対象に使った場合は、通常の回復として働きます。";
    wrap.appendChild(noteEl);
    
    const targetRow = document.createElement("div");
    targetRow.className = "scenariobuild-condition-row";
    targetRow.appendChild(labelSpan("対象："));
    const targetSelect = document.createElement("select");
    targetSelect.className = "scenariobuild-jump-select";
    [["self", "自分だけ"], ["companion", "仲間（1人指定）"], ["all", "自分＋仲間全員"]].forEach(([v, l]) => {
      const opt = document.createElement("option"); opt.value = v; opt.textContent = l; targetSelect.appendChild(opt);
    });
    targetSelect.value = block.target || "self";
    targetSelect.onchange = () => { block.target = targetSelect.value; persist(); renderScenarioBuildPanel(); };
    targetRow.appendChild(targetSelect);
    wrap.appendChild(targetRow);
    
    if (block.target === "companion") {
      const companionRow = document.createElement("div");
      companionRow.className = "scenariobuild-condition-row";
      companionRow.appendChild(labelSpan("仲間："));
      const companionSelect = document.createElement("select");
      companionSelect.className = "scenariobuild-jump-select";
      const emptyOpt = document.createElement("option");
      emptyOpt.value = "";
      emptyOpt.textContent = "（選択してください）";
      companionSelect.appendChild(emptyOpt);
      (scenarioProject.companions || []).forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.name || c.id;
        companionSelect.appendChild(opt);
      });
      companionSelect.value = block.companionId || "";
      companionSelect.onchange = () => { block.companionId = companionSelect.value; persist(); };
      companionRow.appendChild(companionSelect);
      wrap.appendChild(companionRow);
    }
    
    const amountRow = document.createElement("div");
    amountRow.className = "scenariobuild-condition-row";
    amountRow.appendChild(labelSpan("復活後のHP（式）："));
    amountRow.appendChild(buildSkillExpressionInput(block, "amount", "例：50　／　自分レベル*2", persist));
    wrap.appendChild(amountRow);
    
    const percentLabel = document.createElement("label");
    percentLabel.className = "scenariobuild-inline-checkbox";
    const percentCheckbox = document.createElement("input");
    percentCheckbox.type = "checkbox";
    percentCheckbox.checked = block.amountIsPercent === true;
    percentCheckbox.onchange = () => { block.amountIsPercent = percentCheckbox.checked; persist(); };
    percentLabel.appendChild(percentCheckbox);
    percentLabel.append(" 上の数値を「最大HPに対する割合(%)」として扱う（例：50なら最大HPの50%で復活。対象ごとの最大HPを見て計算します）");
    wrap.appendChild(percentLabel);
    
  } else if (block.type === "adjustGauge") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note";
    noteEl.textContent = "回復ブロックと違い、マイナスの値も指定できます（例：SPを消費する技、代償として自分のHP/SPを減らす技など）。0未満・最大値超えにはならないよう自動で丸められます。";
    wrap.appendChild(noteEl);
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    row.appendChild(labelSpan("対象："));
    const targetSelect = document.createElement("select");
    targetSelect.className = "scenariobuild-jump-select";
    [["self", "自分だけ"], ["all", "自分＋生きている仲間全員"]].forEach(([v, l]) => {
      const opt = document.createElement("option"); opt.value = v; opt.textContent = l; targetSelect.appendChild(opt);
    });
    targetSelect.value = block.target || "self";
    targetSelect.onchange = () => { block.target = targetSelect.value; persist(); };
    row.appendChild(targetSelect);
    const gaugeSelect = document.createElement("select");
    gaugeSelect.className = "scenariobuild-jump-select";
    [["hp", "HP"], ["sp", "SP"]].forEach(([v, l]) => {
      const opt = document.createElement("option"); opt.value = v; opt.textContent = l; gaugeSelect.appendChild(opt);
    });
    gaugeSelect.value = block.gauge || "sp";
    gaugeSelect.onchange = () => { block.gauge = gaugeSelect.value; persist(); };
    row.appendChild(gaugeSelect);
    wrap.appendChild(row);
    const amountRow = document.createElement("div");
    amountRow.className = "scenariobuild-condition-row";
    amountRow.appendChild(labelSpan("増減量（式・マイナスで減少）："));
    amountRow.appendChild(buildSkillExpressionInput(block, "amount", "例：-10（SPを10消費）", persist));
    wrap.appendChild(amountRow);
    
  } else if (block.type === "selfDamage") {
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    row.appendChild(labelSpan("自分へのダメージ量（式）："));
    row.appendChild(buildSkillExpressionInput(block, "amount", "例：自分HP割合の最大値の20%なら 自分HP割合*0", persist));
    wrap.appendChild(row);
    
  } else if (block.type === "applyStatus") {
    const sideRow = document.createElement("div");
    sideRow.className = "scenariobuild-condition-row";
    sideRow.appendChild(labelSpan("誰に付与："));
    const sideSelect = document.createElement("select");
    sideSelect.className = "scenariobuild-jump-select";
    [["enemy", "敵に（状態異常）"], ["self", "自分に（状態強化）"], ["allies", "味方全体に（状態強化）"]].forEach(([v, l]) => {
      const opt = document.createElement("option"); opt.value = v; opt.textContent = l; sideSelect.appendChild(opt);
    });
    sideSelect.value = block.targetSide || "enemy";
    sideSelect.onchange = () => { block.targetSide = sideSelect.value; block.statusId = ""; persist(); renderScenarioBuildPanel(); };
    sideRow.appendChild(sideSelect);
    if (block.targetSide === "enemy") {
      const targetSelect = document.createElement("select");
      targetSelect.className = "scenariobuild-jump-select";
      [["single", "選んだ相手"], ["all", "敵全体"], ["random", "ランダムな敵"]].forEach(([v, l]) => {
        const opt = document.createElement("option"); opt.value = v; opt.textContent = l; targetSelect.appendChild(opt);
      });
      targetSelect.value = block.target || "single";
      targetSelect.onchange = () => { block.target = targetSelect.value; persist(); };
      sideRow.appendChild(targetSelect);
    }
    wrap.appendChild(sideRow);
    
    const kindRow = document.createElement("div");
    kindRow.className = "scenariobuild-condition-row";
    kindRow.appendChild(labelSpan("種類："));
    const kindSelect = document.createElement("select");
    kindSelect.className = "scenariobuild-jump-select";
    const kindOptions = block.targetSide === "self"
      ? [...getSkillStatusKindOptions().filter(o => o.value), ...getSkillSelfBuffKindOptions().filter(o => o.value)] // ★自分には状態異常・状態強化どちらも選べるようにする（要望対応）
      : (block.targetSide === "allies" ? getSkillSelfBuffKindOptions() : getSkillStatusKindOptions());
    if (block.targetSide === "self") kindOptions.unshift({ value: "", label: "（なし）" });
    kindOptions.forEach(opt => {
      const optionEl = document.createElement("option"); optionEl.value = opt.value; optionEl.textContent = opt.label; kindSelect.appendChild(optionEl);
    });
    kindSelect.value = block.statusId || "";
    kindSelect.onchange = () => { block.statusId = kindSelect.value; persist(); };
    kindRow.appendChild(kindSelect);
    wrap.appendChild(kindRow);
    
    const valuesRow = document.createElement("div");
    valuesRow.className = "scenariobuild-condition-row";
    valuesRow.appendChild(labelSpan("ターン数（式）："));
    valuesRow.appendChild(buildSkillExpressionInput(block, "duration", "3", persist));
    valuesRow.appendChild(labelSpan("効果量（式）："));
    valuesRow.appendChild(buildSkillExpressionInput(block, "power", "0", persist));
    if (block.targetSide === "enemy") {
      valuesRow.appendChild(labelSpan("確率（式・0〜1）："));
      valuesRow.appendChild(buildSkillExpressionInput(block, "chance", "1", persist));
    }
    wrap.appendChild(valuesRow);
    
  } else if (block.type === "setVariable") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note scenariobuild-condition";
    noteEl.textContent = "変数名に「眠気」「疲労」「所持金」「経過日数」「自分HP割合」「自分SP割合」「敵HP割合」「ターン数」のいずれかを指定すると、一時的な変数ではなく実際のその値へ書き込みます（例：所持金＝所持金+100 で所持金を100増やす）。式の中では、乱数の代わりにrandbuild(最小,最大)（両端を含む整数のランダム値）や、flag(フラグ名)（そのフラグが立っていれば1、そうでなければ0）も使えます。";
    wrap.appendChild(noteEl);
    
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    row.appendChild(labelSpan("変数名："));
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "scenariobuild-title-input";
    nameInput.placeholder = "例：hitBonus　／　所持金";
    nameInput.value = block.varName || "";
    nameInput.onchange = () => { block.varName = nameInput.value; persist(); };
    row.appendChild(nameInput);
    wrap.appendChild(row);
    const exprRow = document.createElement("div");
    exprRow.className = "scenariobuild-condition-row";
    exprRow.appendChild(labelSpan("＝（式）："));
    exprRow.appendChild(buildSkillExpressionInput(block, "expression", "例：hitBonus + 1　／　randbuild(1,10)", persist));
    wrap.appendChild(exprRow);
    
  } else if (block.type === "repeat") {
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    row.appendChild(labelSpan("くり返す回数（式）："));
    row.appendChild(buildSkillExpressionInput(block, "countExpression", "例：3", persist));
    wrap.appendChild(row);
    
    if (!Array.isArray(block.bodyBlocks)) block.bodyBlocks = [];
    const bodyWrap = document.createElement("div");
    bodyWrap.className = "scenariobuild-block-list scenariobuild-skill-repeat-body";
    bodyWrap.appendChild(buildSkillBlockInsertSlot(block.bodyBlocks, 0, skill, persist));
    block.bodyBlocks.forEach((childBlock, childIndex) => {
      bodyWrap.appendChild(buildSkillBlockRow(block.bodyBlocks, childBlock, childIndex, skill, persist));
      bodyWrap.appendChild(buildSkillBlockInsertSlot(block.bodyBlocks, childIndex + 1, skill, persist));
    });
    wrap.appendChild(bodyWrap);
    
  } else if (block.type === "checkTurnCount") {
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    row.appendChild(labelSpan("代入先の変数名："));
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "scenariobuild-title-input";
    nameInput.placeholder = "例：turn";
    nameInput.value = block.varName || "";
    nameInput.onchange = () => { block.varName = nameInput.value; persist(); };
    row.appendChild(nameInput);
    wrap.appendChild(row);
    
    const sourceRow = document.createElement("div");
    sourceRow.className = "scenariobuild-condition-row";
    sourceRow.appendChild(labelSpan("何からの経過ターン数か："));
    const sourceSelect = document.createElement("select");
    sourceSelect.className = "scenariobuild-jump-select";
    [["sinceStart", "戦闘開始からの経過"], ["measured", "「ターン経過計測：開始」からの経過"]].forEach(([v, l]) => {
      const opt = document.createElement("option"); opt.value = v; opt.textContent = l; sourceSelect.appendChild(opt);
    });
    sourceSelect.value = block.source || "sinceStart";
    sourceSelect.onchange = () => { block.source = sourceSelect.value; persist(); renderScenarioBuildPanel(); };
    sourceRow.appendChild(sourceSelect);
    wrap.appendChild(sourceRow);
    
    if (block.source === "measured") {
      const measureRow = document.createElement("div");
      measureRow.className = "scenariobuild-condition-row";
      measureRow.appendChild(labelSpan("計測名（「開始」ブロックと同じ名前）："));
      const measureInput = document.createElement("input");
      measureInput.type = "text";
      measureInput.className = "scenariobuild-title-input";
      measureInput.placeholder = "空欄でも可（無名の計測として扱う）";
      measureInput.value = block.measureName || "";
      measureInput.onchange = () => { block.measureName = measureInput.value; persist(); };
      measureRow.appendChild(measureInput);
      wrap.appendChild(measureRow);
    }
    
  } else if (block.type === "turnMeasureStart" || block.type === "turnMeasureEnd") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note";
    noteEl.textContent = block.type === "turnMeasureStart"
      ? "ここから経過ターン数のカウントを始めます。同じ計測名を「経過ターン数を変数に入れる」ブロック（計測分）で指定すると、ここからの経過ターン数が取得できます。"
      : "指定した計測名のカウントをここで止めます（止めた時点の経過ターン数はそのまま残るので、以降も「経過ターン数を変数に入れる」で読み出せます）。";
    wrap.appendChild(noteEl);
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    row.appendChild(labelSpan("計測名："));
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "scenariobuild-title-input";
    nameInput.placeholder = "空欄でも可（無名の計測として扱う）";
    nameInput.value = block.measureName || "";
    nameInput.onchange = () => { block.measureName = nameInput.value; persist(); };
    row.appendChild(nameInput);
    wrap.appendChild(row);
    
  } else if (block.type === "choice") {
    const promptRow = document.createElement("div");
    promptRow.className = "scenariobuild-condition-row";
    promptRow.appendChild(labelSpan("問いかけの文章（空欄可）："));
    const promptInput = document.createElement("input");
    promptInput.type = "text";
    promptInput.className = "scenariobuild-title-input";
    promptInput.value = block.prompt || "";
    promptInput.onchange = () => { block.prompt = promptInput.value; persist(); };
    promptRow.appendChild(promptInput);
    wrap.appendChild(promptRow);
    
    const varRow = document.createElement("div");
    varRow.className = "scenariobuild-condition-row";
    varRow.appendChild(labelSpan("選んだ番号（0始まり）を入れる変数名："));
    const varInput = document.createElement("input");
    varInput.type = "text";
    varInput.className = "scenariobuild-title-input";
    varInput.placeholder = "例：choice";
    varInput.value = block.varName || "";
    varInput.onchange = () => { block.varName = varInput.value; persist(); };
    varRow.appendChild(varInput);
    wrap.appendChild(varRow);
    
    const optNoteEl = document.createElement("p");
    optNoteEl.className = "devmode-note";
    optNoteEl.textContent = "選んだ選択肢の番号が変数に入るので、この後にifブロックを置いて番号ごとに処理を分けてください（例：choice == 0 なら◯◯、choice == 1 なら△△）。";
    wrap.appendChild(optNoteEl);
    
    if (!Array.isArray(block.options)) block.options = [];
    const optListEl = document.createElement("div");
    optListEl.className = "scenariobuild-list";
    block.options.forEach((opt, optIndex) => {
      const optRow = document.createElement("div");
      optRow.className = "scenariobuild-condition-row";
      optRow.appendChild(labelSpan(`${optIndex}：`));
      const optInput = document.createElement("input");
      optInput.type = "text";
      optInput.className = "scenariobuild-title-input";
      optInput.value = opt.text || "";
      optInput.onchange = () => { opt.text = optInput.value; persist(); };
      optRow.appendChild(optInput);
      const optDeleteBtn = document.createElement("button");
      optDeleteBtn.className = "devmode-btn scenariobuild-danger-btn";
      optDeleteBtn.textContent = "✕";
      optDeleteBtn.onclick = (event) => {
        event.stopPropagation();
        block.options = block.options.filter(o => o.id !== opt.id);
        persist();
        renderScenarioBuildPanel();
      };
      optRow.appendChild(optDeleteBtn);
      optListEl.appendChild(optRow);
    });
    wrap.appendChild(optListEl);
    
    const addOptBtn = document.createElement("button");
    addOptBtn.className = "devmode-btn";
    addOptBtn.textContent = "＋選択肢を追加";
    addOptBtn.onclick = (event) => {
      event.stopPropagation();
      block.options.push({ id: generateId("skopt"), text: `選択肢${block.options.length + 1}` });
      persist();
      renderScenarioBuildPanel();
    };
    wrap.appendChild(addOptBtn);
    
  } else if (block.type === "end") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note";
    noteEl.textContent = "ここまでで技の効果を終えます（以降のブロックは実行されません）。";
    wrap.appendChild(noteEl);
  }
  
  return wrap;
}

function buildSkillBlockRow(blocksArray, block, index, skill, persist) {
  const row = document.createElement("div");
  row.className = "scenariobuild-chapter-row";
  
  const numberEl = document.createElement("span");
  numberEl.className = "scenariobuild-chapter-number";
  numberEl.style.whiteSpace = "pre-line";
  numberEl.textContent = `${index + 1}\n${SKILL_BLOCK_TYPES[block.type] || block.type}`;
  row.appendChild(numberEl);
  
  const infoEl = document.createElement("div");
  infoEl.className = "scenariobuild-chapter-info";
  infoEl.appendChild(buildSkillBlockFormFields(blocksArray, block, skill, persist));
  row.appendChild(infoEl);
  
  const buttonsEl = document.createElement("div");
  buttonsEl.className = "scenariobuild-chapter-buttons";
  
  const upBtn = document.createElement("button");
  upBtn.className = "devmode-btn";
  upBtn.textContent = "↑";
  upBtn.disabled = index === 0;
  upBtn.onclick = (event) => {
    event.stopPropagation();
    [blocksArray[index - 1], blocksArray[index]] = [blocksArray[index], blocksArray[index - 1]];
    persist();
    renderScenarioBuildPanel();
  };
  buttonsEl.appendChild(upBtn);
  
  const downBtn = document.createElement("button");
  downBtn.className = "devmode-btn";
  downBtn.textContent = "↓";
  downBtn.disabled = index === blocksArray.length - 1;
  downBtn.onclick = (event) => {
    event.stopPropagation();
    [blocksArray[index], blocksArray[index + 1]] = [blocksArray[index + 1], blocksArray[index]];
    persist();
    renderScenarioBuildPanel();
  };
  buttonsEl.appendChild(downBtn);
  
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "devmode-btn devmode-btn-danger";
  deleteBtn.textContent = "削除";
  deleteBtn.onclick = async (event) => {
    event.stopPropagation();
    const ok = await showGameConfirm("このブロックを削除しますか？");
    if (!ok) return;
    blocksArray.splice(index, 1);
    persist();
    renderScenarioBuildPanel();
  };
  buttonsEl.appendChild(deleteBtn);
  
  row.appendChild(buttonsEl);
  return row;
}

function getEditingSkill() {
  // ★武器・防具のスキル編集中は、scenarioProject.itemsの中からそのアイテムを返す。
  //   これにより、ブロック一覧・if分岐編集・ジャンプ編集などの画面（.blocks/.variablesしか見ていない）を
  //   キャラクターの特殊スキルとまったく同じコードでそのまま使い回せる
  if (scenarioBuildEditingItemSkillId) {
    return scenarioProject.items.find(i => i.id === scenarioBuildEditingItemSkillId) || null;
  }
  return scenarioProject.skills.find(s => s.id === scenarioBuildEditingSkillId) || null;
}

// ===== メイン画面：特殊スキルのブロック編集（専用全画面。scenarioBuildMainView === "skillBlockEditor"） =====
function renderSkillBlockEditor(container) {
  const skill = getEditingSkill();
  const isItemSkill = !!scenarioBuildEditingItemSkillId; // ★武器・防具のスキル編集中かどうか
  if (!skill) {
    scenarioBuildMainView = "list";
    renderScenarioBuildPanel();
    return;
  }
  if (!Array.isArray(skill.blocks)) skill.blocks = [];
  if (!skill.variables || typeof skill.variables !== "object") skill.variables = {};
  
  const persist = () => markScenarioBuildDirty();
  
  const backBtn = document.createElement("button");
  backBtn.className = "devmode-btn";
  backBtn.textContent = isItemSkill ? "← アイテムの詳細設定に戻る" : "← スキル管理に戻る";
  backBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildSkillInsertMenuTarget = null;
    if (isItemSkill) {
      scenarioBuildMainView = "entityEditor";
      scenarioBuildEditingEntityRef = { category: "items", id: scenarioBuildEditingItemSkillId };
      scenarioBuildEditingItemSkillId = null;
    } else {
      scenarioBuildMainView = "list";
      scenarioBuildEditingSkillId = null;
      ensureCustomSkillsRegistered();
    }
    renderScenarioBuildPanel();
  };
  container.appendChild(backBtn);
  
  const titleEl = document.createElement("h3");
  titleEl.textContent = isItemSkill ? `「${skill.name}」の武器スキルを編集中` : `「${skill.name}」を編集中`;
  container.appendChild(titleEl);
  
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = isItemSkill
    ? "話のブロックエディタと同じ操作感で、この装備が持つスキルの動作を組み立てられます。上から順番に実行され、「＋」から好きな種類のブロックを差し込めます。発動タイミング（常時発動／任意発動）は、この装備の詳細設定画面（1つ前の画面）で設定できます。"
    : "話のブロックエディタと同じ操作感で、この技の詳細な動作を組み立てられます。上から順番に実行され、「＋」から好きな種類のブロックを差し込めます。ブロックを1つでも登録すると、この技は威力・種類などの固定フィールドを無視して、ここのブロックだけで動くようになります。";
  container.appendChild(introEl);
  
  // ★この技専用の作業用変数の初期値（setVariableで書き換えられる、この技を使うたびに毎回ここから始まる値）
  const varsDetails = document.createElement("details");
  varsDetails.className = "scenariobuild-skill-details";
  const varsSummary = document.createElement("summary");
  varsSummary.textContent = `この技専用の変数の初期値（${Object.keys(skill.variables).length}件）`;
  varsDetails.appendChild(varsSummary);
  const varsList = document.createElement("div");
  varsList.className = "scenariobuild-list";
  Object.keys(skill.variables).forEach(varName => {
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "scenariobuild-title-input";
    nameInput.value = varName;
    nameInput.onchange = () => {
      const val = skill.variables[varName];
      delete skill.variables[varName];
      if (nameInput.value) skill.variables[nameInput.value] = val;
      persist();
      renderScenarioBuildPanel();
    };
    row.appendChild(nameInput);
    const valueInput = document.createElement("input");
    valueInput.type = "number";
    valueInput.className = "scenariobuild-condition-input";
    valueInput.value = skill.variables[varName];
    valueInput.onchange = () => { skill.variables[varName] = Number(valueInput.value) || 0; persist(); };
    row.appendChild(valueInput);
    const removeBtn = document.createElement("button");
    removeBtn.className = "devmode-btn devmode-btn-danger";
    removeBtn.textContent = "×";
    removeBtn.onclick = (event) => {
      event.stopPropagation();
      delete skill.variables[varName];
      persist();
      renderScenarioBuildPanel();
    };
    row.appendChild(removeBtn);
    varsList.appendChild(row);
  });
  varsDetails.appendChild(varsList);
  const addVarBtn = document.createElement("button");
  addVarBtn.className = "devmode-btn";
  addVarBtn.textContent = "＋変数を追加";
  addVarBtn.onclick = (event) => {
    event.stopPropagation();
    let name = "変数1", n = 1;
    while (Object.prototype.hasOwnProperty.call(skill.variables, name)) { n++; name = `変数${n}`; }
    skill.variables[name] = 0;
    persist();
    renderScenarioBuildPanel();
  };
  varsDetails.appendChild(addVarBtn);
  container.appendChild(varsDetails);
  
  const listEl = document.createElement("div");
  listEl.className = "scenariobuild-block-list";
  listEl.appendChild(buildSkillBlockInsertSlot(skill.blocks, 0, skill, persist));
  skill.blocks.forEach((block, index) => {
    listEl.appendChild(buildSkillBlockRow(skill.blocks, block, index, skill, persist));
    listEl.appendChild(buildSkillBlockInsertSlot(skill.blocks, index + 1, skill, persist));
  });
  container.appendChild(listEl);
}

function renderSkillManager(container) {
  const introEl = document.createElement("p");

  introEl.className = "devmode-note";
  introEl.textContent = "職業ごとに、Lv.1〜100の技の枠（技表の25段階に対応）へ技をアタッチ／編集／解除できます。↑↓でレベル枠同士の技を入れ替えられます（並び替え）。ここでの変更は実際の戦闘・スキルタブにそのまま反映されます。";
  container.appendChild(introEl);
  
  const formulaNoteEl = document.createElement("p");
  formulaNoteEl.className = "devmode-note";
  formulaNoteEl.textContent = "ダメージ計算式：(1＋自分のレベル×0.1) × 技の威力 ＋ 自分の攻撃力（魔法技なら魔力）×0.7 。例：Lv5・攻撃力10で威力10の技なら 1.5×10 + 10×0.7 = 22。";
  container.appendChild(formulaNoteEl);
  
  // ★CLASS_MASTERは主人公が選べる6職業だけ（狂戦士はケツァナ専用のNPC職業でCLASS_MASTERには無い）。
  //   技表・スキル管理はCLASS_SKILLS基準で全7職業を見せる（そうしないと狂戦士の技が編集できない）
  const classNames = typeof CLASS_SKILLS !== "undefined" ? Object.keys(CLASS_SKILLS) : (typeof CLASS_MASTER !== "undefined" ? Object.keys(CLASS_MASTER) : []);
  if (!scenarioBuildSkillClassView || !classNames.includes(scenarioBuildSkillClassView)) {
    scenarioBuildSkillClassView = classNames[0] || null;
  }
  if (!scenarioBuildSkillClassView) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "devmode-note";
    emptyEl.textContent = "職業データが見つかりませんでした。";
    container.appendChild(emptyEl);
    return;
  }
  
  const classTabsEl = document.createElement("div");
  classTabsEl.className = "scenariobuild-filter-row";
  classNames.forEach(className => {
    const btn = document.createElement("button");
    btn.className = "devmode-btn" + (scenarioBuildSkillClassView === className ? " scenariobuild-filter-active" : "");
    btn.textContent = className;
    btn.onclick = (event) => {
      event.stopPropagation();
      scenarioBuildSkillClassView = className;
      renderScenarioBuildPanel();
    };
    classTabsEl.appendChild(btn);
  });
  container.appendChild(classTabsEl);
  
  const levels = typeof SKILL_UNLOCK_LEVELS !== "undefined" ? SKILL_UNLOCK_LEVELS : [1, 2, 4, 6, 7, 9, 11, 13, 15, 17, 19, 24, 28, 34, 35, 40, 47, 54, 65, 70, 78, 84, 90, 97, 100];
  
  const listEl = document.createElement("div");
  listEl.className = "scenariobuild-list";
  levels.forEach(level => {
    listEl.appendChild(buildSkillSlotRow(scenarioBuildSkillClassView, level, levels));
  });
  container.appendChild(listEl);
}

function buildSkillSlotRow(className, level, levels) {
  const entry = scenarioProject.skills.find(s => s.className === className && s.unlockLevel === level);
  
  const row = document.createElement("div");
  row.className = "scenariobuild-chapter-row" + (entry && entry.builtin ? " scenariobuild-chapter-row-builtin" : "");
  
  const idEl = document.createElement("span");
  idEl.className = "scenariobuild-chapter-number";
  idEl.textContent = `Lv.${level}`;
  row.appendChild(idEl);
  
  const infoEl = document.createElement("div");
  infoEl.className = "scenariobuild-chapter-info";
  
  if (!entry) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "devmode-note";
    emptyEl.style.margin = "0";
    emptyEl.textContent = "（空きスロット）";
    infoEl.appendChild(emptyEl);
    row.appendChild(infoEl);
    
    const buttonsEl = document.createElement("div");
    buttonsEl.className = "scenariobuild-chapter-buttons";
    const addBtn = document.createElement("button");
    addBtn.className = "devmode-btn";
    addBtn.textContent = "＋この枠に技を追加";
    addBtn.onclick = (event) => {
      event.stopPropagation();
      pushUndoSnapshot();
      scenarioProject.skills.push({
        id: generateId("skill"), className, skillId: "", name: "新しい技", description: "", type: "attack",
        element: "無", spCost: 5, unlockLevel: level, power: 10, target: "single", hitCount: 1, atkType: "physical",
        gauge: "", cleanse: false, passiveId: "",
        statusEffectKind: "", statusEffectChance: 1, statusEffectDuration: 1, statusEffectPower: 0,
        statusEffect2Kind: "", statusEffect2Chance: 1, statusEffect2Duration: 1, statusEffect2Power: 0,
        selfBuffKind: "", selfBuffDuration: 1, selfBuffPower: 0, selfBuffMode: "add",
        selfBuff2Kind: "", selfBuff2Duration: 1, selfBuff2Power: 0, selfBuff2Mode: "add",
        builtin: false
      });
      markScenarioBuildDirty();
      ensureCustomSkillsRegistered();
      renderScenarioBuildPanel();
    };
    buttonsEl.appendChild(addBtn);
    row.appendChild(buttonsEl);
    return row;
  }
  
  // ★基本項目
  const basicRow = document.createElement("div");
  basicRow.className = "scenariobuild-condition-row";
  buildSkillTextInput(entry, "name", "技名", basicRow);
  infoEl.appendChild(basicRow);
  
  const descRow = document.createElement("div");
  descRow.className = "scenariobuild-condition-row";
  buildSkillTextInput(entry, "description", "説明", descRow);
  infoEl.appendChild(descRow);
  
  // ★特殊スキル編集（ブロック実行モード）の入り口。要望対応：以前はブロックを1つでも登録すると
  //   自動的にブロックモードへ切り替わり、下の固定フィールドが二度と編集できなくなっていた。
  //   entry.useBlocksで「固定フィールド」と「ブロックで組む」のどちらを使うか明示的に選べるようにし、
  //   「固定フィールド」を選んだ時は、ブロックが残っていてもそれを無視して固定フィールド通りに動く
  //   （ブロックの中身自体は消さないので、後で「ブロックで組む」に戻せば編集内容はそのまま残っている）
  const hasBlocks = Array.isArray(entry.blocks) && entry.blocks.length > 0;
  const isBlockMode = entry.useBlocks === true || (entry.useBlocks == null && hasBlocks);
  
  const modeToggleRow = document.createElement("div");
  modeToggleRow.className = "scenariobuild-condition-row";
  modeToggleRow.appendChild(labelSpan("この技の動作："));
  const modeToggleSelect = document.createElement("select");
  modeToggleSelect.className = "scenariobuild-jump-select";
  [["fixed", "固定フィールド（下の威力・種類などの設定欄）"], ["blocks", "ブロックで組む（特殊スキル編集）"]].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    modeToggleSelect.appendChild(option);
  });
  modeToggleSelect.value = isBlockMode ? "blocks" : "fixed";
  modeToggleSelect.onchange = () => {
    entry.useBlocks = modeToggleSelect.value === "blocks";
    markScenarioBuildDirty();
    ensureCustomSkillsRegistered();
    renderScenarioBuildPanel();
  };
  modeToggleRow.appendChild(modeToggleSelect);
  infoEl.appendChild(modeToggleRow);
  
  const blockModeRow = document.createElement("div");
  blockModeRow.className = "scenariobuild-condition-row";
  const blockEditBtn = document.createElement("button");
  blockEditBtn.className = "devmode-btn";
  blockEditBtn.textContent = "⚡ 特殊スキル編集";
  blockEditBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildEditingSkillId = entry.id;
    scenarioBuildMainView = "skillBlockEditor";
    renderScenarioBuildPanel();
  };
  blockModeRow.appendChild(blockEditBtn);
  if (isBlockMode) {
    const badge = document.createElement("span");
    badge.className = "devmode-note";
    badge.style.margin = "0";
    badge.textContent = `⚡ブロックで動作中（${entry.blocks.length}件）：下の固定フィールドは無視されます`;
    blockModeRow.appendChild(badge);
  } else if (hasBlocks) {
    const badge = document.createElement("span");
    badge.className = "devmode-note";
    badge.style.margin = "0";
    badge.textContent = `固定フィールドで動作中（登録済みのブロック${entry.blocks.length}件は今は使われていません）`;
    blockModeRow.appendChild(badge);
  }
  infoEl.appendChild(blockModeRow);
  
  // ★SP消費（spCost）だけは、ブロックモードでも威力等とは違って「無視されない」（battle.jsのSP消費・
  //   不足判定は、通常技もブロック技も同じ skill.spCost を見ている）。以前は他の固定フィールドと
  //   一緒にグレーアウトされてしまい、ブロックで作った特殊技のSP消費量を設定できない不具合があった。
  //   ここだけ固定フィールドのグレーアウト枠の外に出し、常に編集できるようにする
  const spCostRow = document.createElement("div");
  spCostRow.className = "scenariobuild-condition-row";
  spCostRow.appendChild(buildSkillNumberInline(entry, "spCost", "SP消費", 0));
  infoEl.appendChild(spCostRow);
  
  const fixedFieldsWrap = document.createElement("div");
  fixedFieldsWrap.className = isBlockMode ? "scenariobuild-skill-fixed-fields-disabled" : "";
  
  const paramsRow = document.createElement("div");
  paramsRow.className = "scenariobuild-condition-row";
  paramsRow.style.flexWrap = "wrap";
  paramsRow.appendChild(buildSkillSelectInline(entry, "type", "種類", [
    { value: "attack", label: "攻撃" }, { value: "heal", label: "回復" }, { value: "buff", label: "自己強化" },
    { value: "passive", label: "常時発動" }, { value: "special", label: "特殊" }
  ]));
  // ★要望対応：属性を、属性管理タブで登録した一覧から選べるようにする（以前は数値入力欄だった）
  paramsRow.appendChild(buildSkillSelectInline(entry, "element", "属性", [
    { value: "無", label: "無" },
    ...scenarioProject.elementDefs.map(el => ({ value: el.id, label: el.name || "（無名）" })),
  ]));
  paramsRow.appendChild(buildSkillNumberInline(entry, "power", "威力", 0));
  paramsRow.appendChild(buildSkillSelectInline(entry, "target", "対象", [
    { value: "single", label: "単体" }, { value: "all", label: "全体" }
  ]));
  paramsRow.appendChild(buildSkillNumberInline(entry, "hitCount", "命中回数", 1));
  if (entry.type === "attack") {
    paramsRow.appendChild(buildSkillSelectInline(entry, "atkType", "参照する攻撃力", [
      { value: "physical", label: "物理攻撃力" }, { value: "magical", label: "魔法攻撃力" }
    ]));
  }
  fixedFieldsWrap.appendChild(paramsRow);
  
  // ★詳細（状態異常・自己バフ・パッシブID等）は折りたたみにして、普段は圧迫しないようにする
  const details = document.createElement("details");
  details.className = "scenariobuild-skill-details";
  const summary = document.createElement("summary");
  summary.textContent = "効果の詳細（状態異常・自己強化・常時発動ID など）";
  details.appendChild(summary);
  
  const passiveRow = document.createElement("div");
  passiveRow.className = "scenariobuild-condition-row";
  passiveRow.appendChild(buildSkillNumberInline(entry, "passiveId", "常時発動ID（passiveId）", null, true));
  passiveRow.appendChild(buildSkillNumberInline(entry, "skillId", "特殊スキルID（skillId）", null, true));
  passiveRow.appendChild(buildSkillCheckboxInline(entry, "cleanse", "状態異常を全解除"));
  if (entry.type === "attack") {
    passiveRow.appendChild(buildSkillCheckboxInline(entry, "randomTarget", "対象を自分で選ばせずランダムにする"));
    passiveRow.appendChild(buildSkillCheckboxInline(entry, "wideVariance", "ダメージの揺らぎを大きくする（一か八かタイプ）"));
    passiveRow.appendChild(buildSkillNumberInline(entry, "lifestealRatio", "与えたダメージのHP変換率(0〜1・血臭の宴タイプ)", 0));
  }
  if (entry.type === "heal") {
    passiveRow.appendChild(buildSkillCheckboxInline(entry, "partyWide", "対象を選ばせず自分＋生きている仲間全員にする（ハイ・ディスシプリナタイプ）"));
    passiveRow.appendChild(buildSkillCheckboxInline(entry, "revives", "戦闘不能の仲間を選ぶと蘇生させられる（完全支援タイプ）"));
  }
  details.appendChild(passiveRow);
  
  details.appendChild(buildSkillEffectGroup(entry, "状態異常①", "statusEffectKind", "statusEffectChance", "statusEffectDuration", "statusEffectPower", getSkillStatusKindOptions()));
  details.appendChild(buildSkillEffectGroup(entry, "状態異常②", "statusEffect2Kind", "statusEffect2Chance", "statusEffect2Duration", "statusEffect2Power", getSkillStatusKindOptions()));
  
  const selfBuffRow = document.createElement("div");
  selfBuffRow.className = "scenariobuild-condition-row";
  selfBuffRow.appendChild(labelSpan("自己強化①："));
  selfBuffRow.appendChild(buildSkillSelectInline(entry, "selfBuffKind", "", getSkillSelfBuffKindOptions()));
  selfBuffRow.appendChild(buildSkillNumberInline(entry, "selfBuffDuration", "ターン数", 1));
  selfBuffRow.appendChild(buildSkillSelectInline(entry, "selfBuffMode", "上昇方法", [
    { value: "add", label: "加算（効果量をそのまま足す）" }, { value: "multiply", label: "乗算（効果量%ぶん増やす）" }
  ]));
  selfBuffRow.appendChild(buildSkillNumberInline(entry, "selfBuffPower", "効果量", 0));
  selfBuffRow.appendChild(buildSkillNumberInline(entry, "triggerChance", "発動確率（1で必ず発動、豹変タイプは0.3など）", 1));
  details.appendChild(selfBuffRow);
  
  // ★ハイ・ディスシプリナ「大いなる光芒状態」のように、1つの技で自己強化を2つ同時に付与したい時に使う（任意）
  const selfBuff2Row = document.createElement("div");
  selfBuff2Row.className = "scenariobuild-condition-row";
  selfBuff2Row.appendChild(labelSpan("自己強化②（任意・大いなる光芒状態タイプ）："));
  selfBuff2Row.appendChild(buildSkillSelectInline(entry, "selfBuff2Kind", "", getSkillSelfBuffKindOptions()));
  selfBuff2Row.appendChild(buildSkillNumberInline(entry, "selfBuff2Duration", "ターン数", 1));
  selfBuff2Row.appendChild(buildSkillSelectInline(entry, "selfBuff2Mode", "上昇方法", [
    { value: "add", label: "加算（効果量をそのまま足す）" }, { value: "multiply", label: "乗算（効果量%ぶん増やす）" }
  ]));
  selfBuff2Row.appendChild(buildSkillNumberInline(entry, "selfBuff2Power", "効果量", 0));
  details.appendChild(selfBuff2Row);
  
  fixedFieldsWrap.appendChild(details);
  infoEl.appendChild(fixedFieldsWrap);
  row.appendChild(infoEl);
  
  // ★並び替え（↑↓）・アタッチ解除ボタン
  const buttonsEl = document.createElement("div");
  buttonsEl.className = "scenariobuild-chapter-buttons";
  
  const curIdx = levels.indexOf(level);
  const upBtn = document.createElement("button");
  upBtn.className = "devmode-btn";
  upBtn.textContent = "↑ 上のレベル枠と入替";
  upBtn.disabled = curIdx <= 0;
  upBtn.onclick = (event) => {
    event.stopPropagation();
    pushUndoSnapshot();
    swapSkillManagerLevels(className, level, levels[curIdx - 1]);
    markScenarioBuildDirty();
    ensureCustomSkillsRegistered();
    renderScenarioBuildPanel();
  };
  buttonsEl.appendChild(upBtn);
  
  const downBtn = document.createElement("button");
  downBtn.className = "devmode-btn";
  downBtn.textContent = "↓ 下のレベル枠と入替";
  downBtn.disabled = curIdx >= levels.length - 1;
  downBtn.onclick = (event) => {
    event.stopPropagation();
    pushUndoSnapshot();
    swapSkillManagerLevels(className, level, levels[curIdx + 1]);
    markScenarioBuildDirty();
    ensureCustomSkillsRegistered();
    renderScenarioBuildPanel();
  };
  buttonsEl.appendChild(downBtn);
  
  const detachBtn = document.createElement("button");
  detachBtn.className = "devmode-btn devmode-btn-danger";
  detachBtn.textContent = "アタッチ解除";
  detachBtn.onclick = async (event) => {
    event.stopPropagation();
    const ok = await showGameConfirm(`「${entry.name || "この技"}」をLv.${level}の枠から外しますか？（技自体が削除されます）`);
    if (!ok) return;
    pushUndoSnapshot();
    if (entry.builtin && !scenarioProject.deletedBuiltinIds.skills.includes(entry.id)) {
      scenarioProject.deletedBuiltinIds.skills.push(entry.id);
    }
    const idx = scenarioProject.skills.indexOf(entry);
    if (idx >= 0) scenarioProject.skills.splice(idx, 1);
    markScenarioBuildDirty();
    ensureCustomSkillsRegistered();
    renderScenarioBuildPanel();
  };
  buttonsEl.appendChild(detachBtn);
  
  row.appendChild(buttonsEl);
  return row;
}

// ★2つのレベル枠に付いている技（どちらかが空でもよい）のunlockLevelを入れ替える＝並び替え
function swapSkillManagerLevels(className, levelA, levelB) {
  const entryA = scenarioProject.skills.find(s => s.className === className && s.unlockLevel === levelA);
  const entryB = scenarioProject.skills.find(s => s.className === className && s.unlockLevel === levelB);
  if (entryA) entryA.unlockLevel = levelB;
  if (entryB) entryB.unlockLevel = levelA;
}

function buildSkillTextInput(entry, key, label, containerRow) {
  containerRow.appendChild(labelSpan(`${label}：`));
  const input = document.createElement("input");
  input.type = "text";
  input.className = "scenariobuild-title-input";
  input.value = entry[key] != null ? entry[key] : "";
  input.onchange = () => {
    entry[key] = input.value;
    markScenarioBuildDirty();
    ensureCustomSkillsRegistered();
  };
  containerRow.appendChild(input);
}

function buildSkillNumberInline(entry, key, label, defaultVal, isText = false) {
  const wrap = document.createElement("span");
  wrap.className = "scenariobuild-inline-field";
  wrap.appendChild(labelSpan(`${label}：`));
  const input = document.createElement("input");
  input.type = isText ? "text" : "number";
  input.className = "scenariobuild-condition-input";
  input.value = entry[key] != null ? entry[key] : (defaultVal != null ? defaultVal : "");
  input.onchange = () => {
    entry[key] = isText ? input.value : (Number(input.value) || 0);
    markScenarioBuildDirty();
    ensureCustomSkillsRegistered();
  };
  wrap.appendChild(input);
  return wrap;
}

function buildSkillSelectInline(entry, key, label, options) {
  const wrap = document.createElement("span");
  wrap.className = "scenariobuild-inline-field";
  if (label) wrap.appendChild(labelSpan(`${label}：`));
  const select = document.createElement("select");
  select.className = "scenariobuild-title-input";
  options.forEach(opt => {
    const optionEl = document.createElement("option");
    optionEl.value = opt.value;
    optionEl.textContent = opt.label;
    select.appendChild(optionEl);
  });
  select.value = entry[key] != null ? entry[key] : options[0].value;
  select.onchange = () => {
    entry[key] = select.value;
    markScenarioBuildDirty();
    ensureCustomSkillsRegistered();
  };
  wrap.appendChild(select);
  return wrap;
}

function buildSkillCheckboxInline(entry, key, label) {
  const wrap = document.createElement("span");
  wrap.className = "scenariobuild-inline-field";
  const checkboxLabel = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!entry[key];
  input.onchange = () => {
    entry[key] = input.checked;
    markScenarioBuildDirty();
    ensureCustomSkillsRegistered();
  };
  checkboxLabel.appendChild(input);
  checkboxLabel.appendChild(document.createTextNode(` ${label}`));
  wrap.appendChild(checkboxLabel);
  return wrap;
}

function buildSkillEffectGroup(entry, label, kindKey, chanceKey, durationKey, powerKey, kindOptions) {
  const row = document.createElement("div");
  row.className = "scenariobuild-condition-row";
  row.appendChild(labelSpan(`${label}：`));
  row.appendChild(buildSkillSelectInline(entry, kindKey, "", kindOptions));
  row.appendChild(buildSkillNumberInline(entry, chanceKey, "確率(0〜1)", 1));
  row.appendChild(buildSkillNumberInline(entry, durationKey, "ターン数", 1));
  row.appendChild(buildSkillNumberInline(entry, powerKey, "効果量", 0));
  return row;
}

// ===================================================================
// ===== サブ画面：仲間編集（初期ステータス・上がり値・職業・初期武器） =====
// ===================================================================
const COMPANION_STAT_LABELS = { maxHp: "最大HP", maxSp: "最大SP", atk: "攻撃力", agi: "素早さ", skillPower: "魔力", luck: "運", charm: "魅力" };

function renderCompanionManager(container) {
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "パーティーに加えられる仲間を編集します。ここで設定した初期ステータス・上がり値をもとに、シナリオエディタの「仲間追加」ブロックで指定したレベルの時点のステータスが自動計算されます。";
  container.appendChild(introEl);
  
  const listEl = document.createElement("div");
  listEl.className = "scenariobuild-list";
  scenarioProject.companions.forEach(companion => {
    listEl.appendChild(buildCompanionRow(companion));
  });
  container.appendChild(listEl);
  
  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋新しい仲間を追加";
  addBtn.onclick = (event) => {
    event.stopPropagation();
    pushUndoSnapshot();
    scenarioProject.companions.push({
      id: generateId("companion"), name: "新しい仲間", description: "", class: Object.keys(CLASS_MASTER)[0], initialWeaponId: "", initialArmorId: "", initialShieldId: "",
      baseStats: { maxHp: 30, maxSp: 30, atk: 5, agi: 5, skillPower: 5, luck: 5, charm: 5 },
      growthPerLevel: { maxHp: 4, maxSp: 3, atk: 0.8, agi: 0.3, skillPower: 0.3, luck: 0.2, charm: 0.2 },
      builtin: false
    });
    markScenarioBuildDirty();
    ensureCustomCompanionsRegistered();
    renderScenarioBuildPanel();
  };
  container.appendChild(addBtn);
}

function buildCompanionRow(companion) {
  const row = document.createElement("div");
  row.className = "scenariobuild-chapter-row" + (companion.builtin ? " scenariobuild-chapter-row-builtin" : "");
  
  const infoEl = document.createElement("div");
  infoEl.className = "scenariobuild-chapter-info";
  
  const nameRow = document.createElement("div");
  nameRow.className = "scenariobuild-condition-row";
  nameRow.appendChild(labelSpan("名前："));
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "scenariobuild-title-input";
  nameInput.value = companion.name || "";
  nameInput.onchange = () => { companion.name = nameInput.value; markScenarioBuildDirty(); ensureCustomCompanionsRegistered(); };
  nameRow.appendChild(nameInput);
  infoEl.appendChild(nameRow);
  
  const descRow = document.createElement("div");
  descRow.className = "scenariobuild-condition-row";
  descRow.appendChild(labelSpan("説明："));
  const descInput = document.createElement("input");
  descInput.type = "text";
  descInput.className = "scenariobuild-title-input";
  descInput.value = companion.description || "";
  descInput.onchange = () => { companion.description = descInput.value; markScenarioBuildDirty(); ensureCustomCompanionsRegistered(); };
  descRow.appendChild(descInput);
  infoEl.appendChild(descRow);
  
  const classRow = document.createElement("div");
  classRow.className = "scenariobuild-condition-row";
  classRow.appendChild(labelSpan("職業："));
  const classSelect = document.createElement("select");
  classSelect.className = "scenariobuild-jump-select";
  Object.keys(CLASS_MASTER).forEach(className => {
    const optionEl = document.createElement("option");
    optionEl.value = className;
    optionEl.textContent = className;
    classSelect.appendChild(optionEl);
  });
  classSelect.value = companion.class || Object.keys(CLASS_MASTER)[0];
  classSelect.onchange = () => { companion.class = classSelect.value; markScenarioBuildDirty(); ensureCustomCompanionsRegistered(); };
  classRow.appendChild(classSelect);
  
  classRow.appendChild(labelSpan("初期武器ID："));
  const weaponInput = document.createElement("input");
  weaponInput.type = "text";
  weaponInput.className = "scenariobuild-condition-input";
  weaponInput.placeholder = "空欄＝なし";
  weaponInput.setAttribute("list", "scenariobuild-item-datalist");
  weaponInput.value = companion.initialWeaponId || "";
  weaponInput.onchange = () => { companion.initialWeaponId = weaponInput.value.trim(); markScenarioBuildDirty(); ensureCustomCompanionsRegistered(); };
  classRow.appendChild(weaponInput);
  
  // ★要望対応：加入時点で持っている防具・盾も、そのままインベントリに追加＆装備させられるように
  classRow.appendChild(labelSpan("初期防具ID："));
  const armorInput = document.createElement("input");
  armorInput.type = "text";
  armorInput.className = "scenariobuild-condition-input";
  armorInput.placeholder = "空欄＝なし";
  armorInput.setAttribute("list", "scenariobuild-item-datalist");
  armorInput.value = companion.initialArmorId || "";
  armorInput.onchange = () => { companion.initialArmorId = armorInput.value.trim(); markScenarioBuildDirty(); ensureCustomCompanionsRegistered(); };
  classRow.appendChild(armorInput);
  
  classRow.appendChild(labelSpan("初期盾ID："));
  const shieldInput = document.createElement("input");
  shieldInput.type = "text";
  shieldInput.className = "scenariobuild-condition-input";
  shieldInput.placeholder = "空欄＝なし";
  shieldInput.setAttribute("list", "scenariobuild-item-datalist");
  shieldInput.value = companion.initialShieldId || "";
  shieldInput.onchange = () => { companion.initialShieldId = shieldInput.value.trim(); markScenarioBuildDirty(); ensureCustomCompanionsRegistered(); };
  classRow.appendChild(shieldInput);
  infoEl.appendChild(classRow);
  
  if (!Array.isArray(companion.allowedWeaponTypes)) companion.allowedWeaponTypes = [];
  infoEl.appendChild(buildWeaponTypeChecklist(companion.allowedWeaponTypes, () => { markScenarioBuildDirty(); ensureCustomCompanionsRegistered(); }));
  
  const statsNote = document.createElement("p");
  statsNote.className = "devmode-note";
  statsNote.style.margin = "6px 0 2px 0";
  statsNote.textContent = "初期ステータス（Lv.1の値）／上がり値（レベル1につきどれだけ増えるか）：";
  infoEl.appendChild(statsNote);
  
  if (!companion.baseStats) companion.baseStats = {};
  if (!companion.growthPerLevel) companion.growthPerLevel = {};
  Object.keys(COMPANION_STAT_LABELS).forEach(statKey => {
    const statRow = document.createElement("div");
    statRow.className = "scenariobuild-condition-row";
    statRow.appendChild(labelSpan(`${COMPANION_STAT_LABELS[statKey]}：`));
    
    const baseInput = document.createElement("input");
    baseInput.type = "number";
    baseInput.className = "scenariobuild-condition-input";
    baseInput.value = companion.baseStats[statKey] != null ? companion.baseStats[statKey] : 0;
    baseInput.onchange = () => { companion.baseStats[statKey] = Number(baseInput.value) || 0; markScenarioBuildDirty(); ensureCustomCompanionsRegistered(); };
    statRow.appendChild(baseInput);
    
    statRow.appendChild(labelSpan("上がり値："));
    const growthInput = document.createElement("input");
    growthInput.type = "number";
    growthInput.step = "0.1";
    growthInput.className = "scenariobuild-condition-input";
    growthInput.value = companion.growthPerLevel[statKey] != null ? companion.growthPerLevel[statKey] : 0;
    growthInput.onchange = () => { companion.growthPerLevel[statKey] = Number(growthInput.value) || 0; markScenarioBuildDirty(); ensureCustomCompanionsRegistered(); };
    statRow.appendChild(growthInput);
    
    infoEl.appendChild(statRow);
  });
  
  row.appendChild(infoEl);
  
  const buttonsEl = document.createElement("div");
  buttonsEl.className = "scenariobuild-chapter-buttons";
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "devmode-btn devmode-btn-danger";
  deleteBtn.textContent = "削除";
  deleteBtn.onclick = async (event) => {
    event.stopPropagation();
    const ok = await showGameConfirm(`「${companion.name || "この仲間"}」を削除しますか？`);
    if (!ok) return;
    pushUndoSnapshot();
    if (companion.builtin && !scenarioProject.deletedBuiltinIds.companions.includes(companion.id)) {
      scenarioProject.deletedBuiltinIds.companions.push(companion.id);
    }
    const idx = scenarioProject.companions.indexOf(companion);
    if (idx >= 0) scenarioProject.companions.splice(idx, 1);
    markScenarioBuildDirty();
    ensureCustomCompanionsRegistered();
    renderScenarioBuildPanel();
  };
  buttonsEl.appendChild(deleteBtn);
  row.appendChild(buttonsEl);
  
  return row;
}

// ===================================================================
// ===== サブ画面：全体設定（ゲーム全体に関わる数値の調整） =====
// ===================================================================
// ===================================================================
// ===== サブ画面：職業編集（主人公7職業の初期ステータス・上がり値） =====
// ===================================================================
// ★武器の「種類」の固定選択肢。アイテム編集の「武器種類」キー、職業編集・仲間編集の
//   「装備できる武器の種類」チェックリストの両方でこれを使う
const WEAPON_TYPE_OPTIONS = ["剣", "大剣", "斧", "槍", "弓", "杖", "拳", "鎌", "盾", "その他"];

// ★「装備できる武器の種類」チェックボックス一覧を作る共通部品。
//   list（配列）を直接書き換え、空＝無制限として扱う
function buildWeaponTypeChecklist(list, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "scenariobuild-condition-row";
  wrap.appendChild(labelSpan("装備できる武器の種類（空＝無制限）："));
  WEAPON_TYPE_OPTIONS.forEach(type => {
    const label = document.createElement("label");
    label.style.marginRight = "10px";
    label.style.fontSize = "12px";
    label.style.color = "#ccc";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = list.includes(type);
    checkbox.onchange = () => {
      const idx = list.indexOf(type);
      if (checkbox.checked && idx === -1) list.push(type);
      else if (!checkbox.checked && idx !== -1) list.splice(idx, 1);
      onChange();
    };
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(type));
    wrap.appendChild(label);
  });
  return wrap;
}

function renderClassStatsManager(container) {
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "主人公の職業ごとの初期ステータス・上がり値・説明文・種類を編集します。職業の追加・削除もできます。";
  container.appendChild(introEl);
  
  const listEl = document.createElement("div");
  listEl.className = "scenariobuild-list";
  Object.keys(scenarioProject.classStats).forEach(className => {
    listEl.appendChild(buildClassStatsRow(className));
  });
  container.appendChild(listEl);
  
  // ★職業の追加（要望対応）
  const addRow = document.createElement("div");
  addRow.className = "scenariobuild-condition-row";
  const addNameInput = document.createElement("input");
  addNameInput.type = "text";
  addNameInput.className = "scenariobuild-title-input";
  addNameInput.placeholder = "新しい職業の名前";
  addRow.appendChild(addNameInput);
  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋職業を追加";
  addBtn.onclick = () => {
    const newName = addNameInput.value.trim();
    if (!newName) return;
    if (scenarioProject.classStats[newName]) { alert("同じ名前の職業が既にあります。"); return; }
    pushUndoSnapshot();
    scenarioProject.classStats[newName] = {
      description: "", type: "normal", unlockFlagName: "",
      maxSleepiness: 100, maxFatigue: 100,
      baseStats: {}, growthPerLevel: {}, allowedWeaponTypes: []
    };
    markScenarioBuildDirty();
    ensureCustomClassStatsRegistered();
    renderScenarioBuildPanel();
  };
  addRow.appendChild(addBtn);
  container.appendChild(addRow);
}

// ★職業を削除する（要望対応）。CLASS_MASTER・CLASS_SKILLSからも取り除く。
//   既にその職業でプレイ中のセーブデータには影響しない（あくまで「今後選べなくなる」だけ）
function deleteClassStats(className) {
  pushUndoSnapshot();
  delete scenarioProject.classStats[className];
  if (typeof CLASS_MASTER !== "undefined") delete CLASS_MASTER[className];
  if (typeof CLASS_SKILLS !== "undefined") delete CLASS_SKILLS[className];
  // ★組み込みの職業（player.js由来）を削除した場合は、再読み込みしても復活しないよう記録しておく
  if (ORIGINAL_CLASS_MASTER_KEYS.includes(className)) {
    if (!scenarioProject.deletedBuiltinIds) scenarioProject.deletedBuiltinIds = {};
    if (!Array.isArray(scenarioProject.deletedBuiltinIds.classes)) scenarioProject.deletedBuiltinIds.classes = [];
    if (!scenarioProject.deletedBuiltinIds.classes.includes(className)) scenarioProject.deletedBuiltinIds.classes.push(className);
  }
  markScenarioBuildDirty();
  renderScenarioBuildPanel();
}

function buildClassStatsRow(className) {
  const data = scenarioProject.classStats[className];
  
  const row = document.createElement("div");
  row.className = "scenariobuild-chapter-row scenariobuild-chapter-row-builtin";
  
  const infoEl = document.createElement("div");
  infoEl.className = "scenariobuild-chapter-info";
  
  const nameEl = document.createElement("p");
  nameEl.className = "scenariobuild-title-input";
  nameEl.style.background = "none";
  nameEl.style.border = "none";
  nameEl.textContent = className;
  infoEl.appendChild(nameEl);
  
  // ★職業の「種類」：通常職／上級職／天職(マスター)（要望対応）。上級職・天職は、役場に表示するには
  //   解放フラグがONになっている必要がある（施設編集タブ・town.jsのuseTownhallClassChange参照）
  const typeRow = document.createElement("div");
  typeRow.className = "scenariobuild-condition-row";
  typeRow.appendChild(labelSpan("種類："));
  const typeSelect = document.createElement("select");
  typeSelect.className = "scenariobuild-jump-select";
  [["normal", "通常職"], ["advanced", "上級職"], ["master", "天職（マスター）"]].forEach(([value, label]) => {
    const optionEl = document.createElement("option");
    optionEl.value = value;
    optionEl.textContent = label;
    typeSelect.appendChild(optionEl);
  });
  typeSelect.value = data.type || "normal";
  typeSelect.onchange = () => { data.type = typeSelect.value; markScenarioBuildDirty(); ensureCustomClassStatsRegistered(); renderScenarioBuildPanel(); };
  typeRow.appendChild(typeSelect);
  infoEl.appendChild(typeRow);
  
  if (data.type === "advanced" || data.type === "master") {
    const flagRow = document.createElement("div");
    flagRow.className = "scenariobuild-condition-row";
    flagRow.appendChild(labelSpan("解放フラグ："));
    const flagInput = document.createElement("input");
    flagInput.type = "text";
    flagInput.className = "scenariobuild-title-input";
    flagInput.placeholder = "例：上級職解放（フラグブロックでONにできる）";
    flagInput.value = data.unlockFlagName || "";
    flagInput.onchange = () => { data.unlockFlagName = flagInput.value.trim(); markScenarioBuildDirty(); ensureCustomClassStatsRegistered(); };
    flagRow.appendChild(flagInput);
    infoEl.appendChild(flagRow);
    const flagNote = document.createElement("p");
    flagNote.className = "devmode-note";
    flagNote.style.margin = "0 0 6px";
    flagNote.textContent = "このフラグがONになるまで、役場（施設編集で対象にチェックした場合）に表示されません。話のブロックで「フラグ」ブロックを使ってONにできます。";
    infoEl.appendChild(flagNote);
  }
  
  const descRow = document.createElement("div");
  descRow.className = "scenariobuild-condition-row";
  descRow.appendChild(labelSpan("説明："));
  const descInput = document.createElement("input");
  descInput.type = "text";
  descInput.className = "scenariobuild-title-input";
  descInput.value = data.description || "";
  descInput.onchange = () => { data.description = descInput.value; markScenarioBuildDirty(); ensureCustomClassStatsRegistered(); };
  descRow.appendChild(descInput);
  infoEl.appendChild(descRow);
  
  const gaugeRow = document.createElement("div");
  gaugeRow.className = "scenariobuild-condition-row";
  gaugeRow.appendChild(labelSpan("最大眠気："));
  const sleepInput = document.createElement("input");
  sleepInput.type = "number";
  sleepInput.className = "scenariobuild-condition-input";
  sleepInput.value = data.maxSleepiness != null ? data.maxSleepiness : 100;
  sleepInput.onchange = () => { data.maxSleepiness = Number(sleepInput.value) || 100; markScenarioBuildDirty(); ensureCustomClassStatsRegistered(); };
  gaugeRow.appendChild(sleepInput);
  // ★眠気上限の「上がり値」（レベル1につきどれだけ増えるか）。要望により、レベルアップで眠気上限も
  //   上がるようにしたので、疲労度と同じくここで調整できるようにする
  gaugeRow.appendChild(labelSpan("上がり値："));
  if (!data.growthPerLevel) data.growthPerLevel = {};
  const sleepGrowthInput = document.createElement("input");
  sleepGrowthInput.type = "number";
  sleepGrowthInput.step = "0.1";
  sleepGrowthInput.className = "scenariobuild-condition-input";
  sleepGrowthInput.value = data.growthPerLevel.maxSleepiness != null ? data.growthPerLevel.maxSleepiness : 2;
  sleepGrowthInput.onchange = () => { data.growthPerLevel.maxSleepiness = Number(sleepGrowthInput.value) || 0; markScenarioBuildDirty(); ensureCustomClassStatsRegistered(); };
  gaugeRow.appendChild(sleepGrowthInput);
  gaugeRow.appendChild(labelSpan("最大疲労度："));
  const fatigueInput = document.createElement("input");
  fatigueInput.type = "number";
  fatigueInput.className = "scenariobuild-condition-input";
  fatigueInput.value = data.maxFatigue != null ? data.maxFatigue : 100;
  fatigueInput.onchange = () => { data.maxFatigue = Number(fatigueInput.value) || 100; markScenarioBuildDirty(); ensureCustomClassStatsRegistered(); };
  gaugeRow.appendChild(fatigueInput);
  infoEl.appendChild(gaugeRow);
  
  if (!Array.isArray(data.allowedWeaponTypes)) data.allowedWeaponTypes = [];
  infoEl.appendChild(buildWeaponTypeChecklist(data.allowedWeaponTypes, () => { markScenarioBuildDirty(); ensureCustomClassStatsRegistered(); }));
  
  const statsNote = document.createElement("p");
  statsNote.className = "devmode-note";
  statsNote.style.margin = "6px 0 2px 0";
  statsNote.textContent = "初期ステータス（Lv.1の値）／上がり値（レベル1につきどれだけ増えるか）：";
  infoEl.appendChild(statsNote);
  
  if (!data.baseStats) data.baseStats = {};
  if (!data.growthPerLevel) data.growthPerLevel = {};
  Object.keys(COMPANION_STAT_LABELS).forEach(statKey => {
    const statRow = document.createElement("div");
    statRow.className = "scenariobuild-condition-row";
    statRow.appendChild(labelSpan(`${COMPANION_STAT_LABELS[statKey]}：`));
    
    const baseInput = document.createElement("input");
    baseInput.type = "number";
    baseInput.className = "scenariobuild-condition-input";
    baseInput.value = data.baseStats[statKey] != null ? data.baseStats[statKey] : 0;
    baseInput.onchange = () => { data.baseStats[statKey] = Number(baseInput.value) || 0; markScenarioBuildDirty(); ensureCustomClassStatsRegistered(); };
    statRow.appendChild(baseInput);
    
    statRow.appendChild(labelSpan("上がり値："));
    const growthInput = document.createElement("input");
    growthInput.type = "number";
    growthInput.step = "0.1";
    growthInput.className = "scenariobuild-condition-input";
    growthInput.value = data.growthPerLevel[statKey] != null ? data.growthPerLevel[statKey] : 0;
    growthInput.onchange = () => { data.growthPerLevel[statKey] = Number(growthInput.value) || 0; markScenarioBuildDirty(); ensureCustomClassStatsRegistered(); };
    statRow.appendChild(growthInput);
    
    infoEl.appendChild(statRow);
  });
  
  row.appendChild(infoEl);
  
  const removeBtn = document.createElement("button");
  removeBtn.className = "devmode-btn devmode-btn-danger";
  removeBtn.textContent = "この職業を削除";
  removeBtn.onclick = async (event) => {
    event.stopPropagation();
    const confirmed = await showGameConfirm(`職業「${className}」を削除しますか？（元に戻すには編集内容の巻き戻し操作が必要です）`);
    if (confirmed) deleteClassStats(className);
  };
  row.appendChild(removeBtn);
  
  return row;
}

// ===================================================================
// ===== サブ画面：施設編集（村に追加できる「酒場/宿屋/店/冒険する」以外の施設） =====
// ===================================================================
const FACILITY_TYPE_LABELS = { inn: "宿系（睡眠・疲労回復）", townhall: "役場・役所系（職業変更）", blacksmith: "鍛冶屋系（装備の強化・作成）", synthesis: "素材合成屋系（レシピでアイテム作成）", shop: "店系（アイテムの売買）", tavern: "酒場系（世間話・クエスト掲示板）", casino: "カジノ系（賭け事・ギャンブル）", rustRemoval: "錆取り屋系（錆びたシリーズ装備のサビ取り）", auction: "オークション系（入札で希少品を競り落とす）", colosseum: "コロシアム系（アイテム使用禁止の連戦タワー）", fishing: "釣り場系（釣りミニゲームで魚を釣る）", flavor: "その他（セリフのみ）" };

function renderFacilityManager(container) {
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "村の「酒場・宿屋・店・冒険する」に加えて、独自の施設を追加・削除できます（例：酒場、店、寂れた宿、平凡な宿、街の宿、豪華なホテル、役場、役所……）。追加した施設は町メニューに一覧の下へそのまま並びます。";
  container.appendChild(introEl);
  
  // ★要望対応：種類ごとにタブ分けして見やすくする
  const filterRow = document.createElement("div");
  filterRow.className = "scenariobuild-filter-row";
  const currentFilter = scenarioBuildEntityFilterValue["facilities"] || "all";
  const allBtn = document.createElement("button");
  allBtn.className = "devmode-btn" + (currentFilter === "all" ? " scenariobuild-filter-active" : "");
  allBtn.textContent = `すべて（${scenarioProject.facilities.length}）`;
  allBtn.onclick = (event) => { event.stopPropagation(); scenarioBuildEntityFilterValue["facilities"] = "all"; renderScenarioBuildPanel(); };
  filterRow.appendChild(allBtn);
  Object.keys(FACILITY_TYPE_LABELS).forEach(type => {
    const count = scenarioProject.facilities.filter(f => f.type === type).length;
    const btn = document.createElement("button");
    btn.className = "devmode-btn" + (currentFilter === type ? " scenariobuild-filter-active" : "");
    btn.textContent = `${FACILITY_TYPE_LABELS[type]}（${count}）`;
    btn.onclick = (event) => { event.stopPropagation(); scenarioBuildEntityFilterValue["facilities"] = type; renderScenarioBuildPanel(); };
    filterRow.appendChild(btn);
  });
  container.appendChild(filterRow);
  const facilitiesToShow = currentFilter === "all" ? scenarioProject.facilities : scenarioProject.facilities.filter(f => f.type === currentFilter);
  
  const listEl = document.createElement("div");
  listEl.className = "scenariobuild-list";
  facilitiesToShow.forEach(facility => {
    listEl.appendChild(buildFacilityRow(facility));
  });
  container.appendChild(listEl);
  
  const quickAddWrap = document.createElement("div");
  quickAddWrap.className = "scenariobuild-quick-add-row";
  Object.keys(FACILITY_TYPE_LABELS).forEach(type => {
    const btn = document.createElement("button");
    btn.className = "devmode-btn";
    btn.textContent = `＋${FACILITY_TYPE_LABELS[type]}を追加`;
    btn.onclick = (event) => {
      event.stopPropagation();
      pushUndoSnapshot();
      const newFacility = {
        id: generateId("facility"), type, name: "新しい施設",
        bgTrack: "", bgImage: "", ownerDialogue: "",
        price: 20, sleepinessRecovery: 40, fatigueRecovery: 40,
        classChangeCost: 100,
        minBet: 10, maxBet: 1000, slotImages: {}, slotWeights: {}, // ★カジノ系で使う項目（他の種類では無視される）
        entryItemId: "", entryItemQty: 1, floors: [], regularEnemyPool: [], bossRoundConfig: {}, // ★コロシアム系で使う項目（他の種類では無視される）
        coinItemIdBlue: "", coinItemIdYellow: "", coinItemIdRed: "",
        milestone10CoinQty: 1, milestone20CoinQty: 1, milestone50CoinQty: 1,
        finalClearBlueCoinQty: 0, finalClearYellowCoinQty: 0, finalClearRedCoinQty: 0,
        finalClearGoldReward: 0, finalClearExpReward: 0, exchangeOffers: []
      };
      scenarioProject.facilities.push(newFacility);
      // ★以前はここで自動的に村へアタッチしていたが、他の拠点（カデリクの街など）にだけアタッチしたつもりでも
      //   村にも残ってしまうバグの原因だったため廃止。新しく作った施設はどこにも属さない状態で始まり、
      //   マップ編集の各拠点編集画面で、置きたい拠点にだけ明示的にアタッチする
      markScenarioBuildDirty();
      renderScenarioBuildPanel();
    };
    quickAddWrap.appendChild(btn);
  });
  container.appendChild(quickAddWrap);
}

// ★施設のセリフ（入った時／払った後／一夜明けた後）を、話者選択つきで複数行・追加/削除/並び替え
//   できるようにする簡易ブロックエディタ。話のブロックエディタと違い、分岐やジャンプは無く
//   上から順番に流れるだけのシンプルな作りにしてある（施設のちょっとした掛け合い向け）
let scenarioBuildExpandedFacilityDialogueKey = null; // ★どの施設のどの区分を開いているか（施設id+区分名）

function buildFacilityDialogueSection(facility, key, label) {
  const wrap = document.createElement("div");
  wrap.className = "scenariobuild-condition-row";
  
  const sectionKey = facility.id + ":" + key;
  const isOpen = scenarioBuildExpandedFacilityDialogueKey === sectionKey;
  const blocks = facility[key];
  
  const toggleBtn = document.createElement("button");
  toggleBtn.className = "devmode-btn";
  toggleBtn.textContent = `${label}をブロックで編集（${blocks.length}件）${isOpen ? " ▲" : " ▼"}`;
  toggleBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildExpandedFacilityDialogueKey = isOpen ? null : sectionKey;
    renderScenarioBuildPanel();
  };
  wrap.appendChild(toggleBtn);
  
  if (isOpen) {
    const listEl = document.createElement("div");
    listEl.className = "scenariobuild-list";
    blocks.forEach((block, i) => {
      listEl.appendChild(buildFacilityDialogueBlockRow(blocks, block, i));
    });
    wrap.appendChild(listEl);
    
    const addBtn = document.createElement("button");
    addBtn.className = "devmode-btn";
    addBtn.textContent = "＋セリフを追加";
    addBtn.onclick = (event) => {
      event.stopPropagation();
      blocks.push({ type: "dialogue", speaker: "", text: "" });
      markScenarioBuildDirty();
      renderScenarioBuildPanel();
    };
    wrap.appendChild(addBtn);
  }
  
  return wrap;
}

function buildFacilityDialogueBlockRow(blocks, block, index) {
  const row = document.createElement("div");
  row.className = "scenariobuild-chapter-row";
  
  const infoEl = document.createElement("div");
  infoEl.className = "scenariobuild-chapter-info";
  
  const typeRow = document.createElement("div");
  typeRow.className = "scenariobuild-condition-row";
  typeRow.appendChild(labelSpan("種類："));
  const typeSelect = document.createElement("select");
  typeSelect.className = "scenariobuild-jump-select";
  [{ value: "dialogue", label: "セリフ（話者あり）" }, { value: "narration", label: "地の文（話者なし）" }, { value: "telop", label: "テロップ（画面いっぱいに大きく表示）" }].forEach(opt => {
    const optionEl = document.createElement("option");
    optionEl.value = opt.value; optionEl.textContent = opt.label;
    typeSelect.appendChild(optionEl);
  });
  typeSelect.value = block.type || "dialogue";
  typeSelect.onchange = () => { block.type = typeSelect.value; markScenarioBuildDirty(); renderScenarioBuildPanel(); };
  typeRow.appendChild(typeSelect);
  infoEl.appendChild(typeRow);
  
  if (block.type === "dialogue") {
    const speakerRow = document.createElement("div");
    speakerRow.className = "scenariobuild-condition-row";
    speakerRow.appendChild(labelSpan("話者："));
    const speakerInput = document.createElement("input");
    speakerInput.type = "text";
    speakerInput.className = "scenariobuild-title-input";
    speakerInput.setAttribute("list", "scenariobuild-character-datalist"); // ★キャラ管理に登録した名前を候補表示
    speakerInput.placeholder = "空欄＝施設名で話す";
    speakerInput.value = block.speaker || "";
    speakerInput.onchange = () => { block.speaker = speakerInput.value; markScenarioBuildDirty(); };
    speakerRow.appendChild(speakerInput);
    infoEl.appendChild(speakerRow);
  }
  
  const textRow = document.createElement("div");
  textRow.className = "scenariobuild-condition-row";
  textRow.appendChild(labelSpan("セリフ："));
  const textInput = document.createElement("input");
  textInput.type = "text";
  textInput.className = "scenariobuild-title-input";
  textInput.value = block.text || "";
  textInput.onchange = () => { block.text = textInput.value; markScenarioBuildDirty(); };
  textRow.appendChild(textInput);
  infoEl.appendChild(textRow);
  
  row.appendChild(infoEl);
  
  const btnGroup = document.createElement("div");
  btnGroup.className = "scenariobuild-chapter-actions";
  
  const upBtn = document.createElement("button");
  upBtn.className = "devmode-btn";
  upBtn.textContent = "↑";
  upBtn.disabled = index === 0;
  upBtn.onclick = (event) => {
    event.stopPropagation();
    [blocks[index - 1], blocks[index]] = [blocks[index], blocks[index - 1]];
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  btnGroup.appendChild(upBtn);
  
  const downBtn = document.createElement("button");
  downBtn.className = "devmode-btn";
  downBtn.textContent = "↓";
  downBtn.disabled = index === blocks.length - 1;
  downBtn.onclick = (event) => {
    event.stopPropagation();
    [blocks[index + 1], blocks[index]] = [blocks[index], blocks[index + 1]];
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  btnGroup.appendChild(downBtn);
  
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "devmode-btn devmode-btn-danger";
  deleteBtn.textContent = "削除";
  deleteBtn.onclick = (event) => {
    event.stopPropagation();
    blocks.splice(index, 1);
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  btnGroup.appendChild(deleteBtn);
  
  row.appendChild(btnGroup);
  
  return row;
}

function buildFacilityRow(facility) {
  const row = document.createElement("div");
  row.className = "scenariobuild-chapter-row";
  
  const infoEl = document.createElement("div");
  infoEl.className = "scenariobuild-chapter-info";
  
  const nameRow = document.createElement("div");
  nameRow.className = "scenariobuild-condition-row";
  nameRow.appendChild(labelSpan("名前："));
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "scenariobuild-title-input";
  nameInput.value = facility.name || "";
  nameInput.onchange = () => { facility.name = nameInput.value; markScenarioBuildDirty(); };
  nameRow.appendChild(nameInput);
  infoEl.appendChild(nameRow);
  
  const typeRow = document.createElement("div");
  typeRow.className = "scenariobuild-condition-row";
  typeRow.appendChild(labelSpan("種類："));
  const typeSelect = document.createElement("select");
  typeSelect.className = "scenariobuild-jump-select";
  Object.keys(FACILITY_TYPE_LABELS).forEach(t => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = FACILITY_TYPE_LABELS[t];
    typeSelect.appendChild(opt);
  });
  typeSelect.value = facility.type || "flavor";
  typeSelect.onchange = () => { facility.type = typeSelect.value; markScenarioBuildDirty(); renderScenarioBuildPanel(); };
  typeRow.appendChild(typeSelect);
  infoEl.appendChild(typeRow);
  
  const dialogueRow = document.createElement("div");
  dialogueRow.className = "scenariobuild-condition-row";
  dialogueRow.appendChild(labelSpan("主人／オーナーのセリフ（下の「入った時」のセリフを1件も登録していない時だけ使われる簡易版）："));
  const dialogueInput = document.createElement("input");
  dialogueInput.type = "text";
  dialogueInput.className = "scenariobuild-title-input";
  dialogueInput.value = facility.ownerDialogue || "";
  dialogueInput.onchange = () => { facility.ownerDialogue = dialogueInput.value; markScenarioBuildDirty(); };
  dialogueRow.appendChild(dialogueInput);
  infoEl.appendChild(dialogueRow);
  
  if (!Array.isArray(facility.enterBlocks)) facility.enterBlocks = [];
  infoEl.appendChild(buildFacilityDialogueSection(facility, "enterBlocks", "入った時のセリフ"));
  
  if (facility.type === "inn") {
    if (!Array.isArray(facility.paidBlocks)) facility.paidBlocks = [];
    if (!Array.isArray(facility.morningBlocks)) facility.morningBlocks = [];
    infoEl.appendChild(buildFacilityDialogueSection(facility, "paidBlocks", "お金を払った後のセリフ"));
    infoEl.appendChild(buildFacilityDialogueSection(facility, "morningBlocks", "一夜明けた後のセリフ"));
  }
  
  if (facility.type === "inn") {
    const innRow = document.createElement("div");
    innRow.className = "scenariobuild-condition-row";
    innRow.appendChild(labelSpan("値段："));
    const priceInput = document.createElement("input");
    priceInput.type = "number";
    priceInput.min = "0";
    priceInput.className = "scenariobuild-condition-input";
    priceInput.value = facility.price != null ? facility.price : 20;
    priceInput.onchange = () => { facility.price = Math.max(0, Number(priceInput.value) || 0); markScenarioBuildDirty(); };
    innRow.appendChild(priceInput);
    
    innRow.appendChild(labelSpan("眠気回復量："));
    const sleepInput = document.createElement("input");
    sleepInput.type = "number";
    sleepInput.min = "0";
    sleepInput.className = "scenariobuild-condition-input";
    sleepInput.value = facility.sleepinessRecovery != null ? facility.sleepinessRecovery : 40;
    sleepInput.onchange = () => { facility.sleepinessRecovery = Math.max(0, Number(sleepInput.value) || 0); markScenarioBuildDirty(); };
    innRow.appendChild(sleepInput);
    
    innRow.appendChild(labelSpan("疲労回復量："));
    const fatigueInput = document.createElement("input");
    fatigueInput.type = "number";
    fatigueInput.min = "0";
    fatigueInput.className = "scenariobuild-condition-input";
    fatigueInput.value = facility.fatigueRecovery != null ? facility.fatigueRecovery : 40;
    fatigueInput.onchange = () => { facility.fatigueRecovery = Math.max(0, Number(fatigueInput.value) || 0); markScenarioBuildDirty(); };
    innRow.appendChild(fatigueInput);
    infoEl.appendChild(innRow);
  } else if (facility.type === "townhall") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note";
    noteEl.textContent = "職業変更の手続きができます（CLASS_MASTERに定義された職業から選べます）。";
    infoEl.appendChild(noteEl);
    const costRow = document.createElement("div");
    costRow.className = "scenariobuild-condition-row";
    costRow.appendChild(labelSpan("手続きの費用："));
    const costInput = document.createElement("input");
    costInput.type = "number";
    costInput.min = "0";
    costInput.className = "scenariobuild-condition-input";
    costInput.value = facility.classChangeCost != null ? facility.classChangeCost : 100;
    costInput.onchange = () => { facility.classChangeCost = Math.max(0, Number(costInput.value) || 0); markScenarioBuildDirty(); };
    costRow.appendChild(costInput);
    infoEl.appendChild(costRow);
    
    // ★この役場で選べる職業をチェックで指定できるようにする（要望対応）。
    //   1つもチェックが無ければ「今まで通り全職業」を対象にする（後方互換）
    const classNoteEl = document.createElement("p");
    classNoteEl.className = "devmode-note";
    classNoteEl.style.margin = "6px 0 2px";
    classNoteEl.textContent = "この役場で選べる職業（何もチェックしなければ、全職業が対象になります。上級職・天職は、さらに職業編集タブで設定した解放フラグがONの時だけ実際に選べます）：";
    infoEl.appendChild(classNoteEl);
    if (!Array.isArray(facility.allowedClassNames)) facility.allowedClassNames = [];
    const classListWrap = document.createElement("div");
    classListWrap.className = "mapareas-variations";
    Object.keys((typeof CLASS_MASTER !== "undefined") ? CLASS_MASTER : {}).forEach(className => {
      const classType = (CLASS_MASTER[className] && CLASS_MASTER[className].type) || "normal";
      const typeLabel = classType === "advanced" ? "（上級職）" : classType === "master" ? "（天職）" : "";
      const label = document.createElement("label");
      label.className = "scenariobuild-condition-row";
      label.style.cursor = "pointer";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = facility.allowedClassNames.includes(className);
      checkbox.onchange = () => {
        if (checkbox.checked) { if (!facility.allowedClassNames.includes(className)) facility.allowedClassNames.push(className); }
        else { facility.allowedClassNames = facility.allowedClassNames.filter(n => n !== className); }
        markScenarioBuildDirty();
      };
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(` ${className}${typeLabel}`));
      classListWrap.appendChild(label);
    });
    infoEl.appendChild(classListWrap);
  } else if (facility.type === "blacksmith" || facility.type === "synthesis") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note";
    noteEl.textContent = `この施設で扱うレシピは「レシピ管理」タブで登録してください（対象の店を「${facility.type === "blacksmith" ? "鍛冶屋" : "素材合成屋"}」に指定したレシピが、ここに一覧で表示されます。同じ種類の店が複数ある場合は、レシピ側の「対象の店」でこの施設を選べば、この施設だけの専用レシピにできます）。`;
    infoEl.appendChild(noteEl);
  } else if (facility.type === "casino") {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note";
    noteEl.textContent = "丁半博打・ルーレット・スロットの3種類で遊べます。賭け金の下限・上限をここで設定してください（丁半博打・スロットでは1回の賭け金の上限、ルーレットでは1マスあたりに置けるチップの上限になります。いずれも実際の上限は、この設定額とプレイヤーの所持金の低い方です）。";
    infoEl.appendChild(noteEl);
    
    const betRow = document.createElement("div");
    betRow.className = "scenariobuild-condition-row";
    betRow.appendChild(labelSpan("最低ベット額："));
    const minBetInput = document.createElement("input");
    minBetInput.type = "number";
    minBetInput.min = "1";
    minBetInput.className = "scenariobuild-condition-input";
    minBetInput.value = facility.minBet != null ? facility.minBet : 10;
    minBetInput.onchange = () => { facility.minBet = Math.max(1, Number(minBetInput.value) || 1); markScenarioBuildDirty(); };
    betRow.appendChild(minBetInput);
    
    betRow.appendChild(labelSpan("最高ベット額："));
    const maxBetInput = document.createElement("input");
    maxBetInput.type = "number";
    maxBetInput.min = "1";
    maxBetInput.className = "scenariobuild-condition-input";
    maxBetInput.value = facility.maxBet != null ? facility.maxBet : 1000;
    maxBetInput.onchange = () => { facility.maxBet = Math.max(1, Number(maxBetInput.value) || 1); markScenarioBuildDirty(); };
    betRow.appendChild(maxBetInput);
    infoEl.appendChild(betRow);
    
    // ★修正（バグ報告対応）：以前は「揃う確率」という表示のまま、実際には1マスあたりの
    //   出現しやすさ（重み、他の絵柄との相対比）を入力させていたため、表示と実態が食い違っていた。
    //   入力自体はこれまで通り「重み」（ゲームロジック側の抽選に使う値）のままとし、
    //   実際に3マス揃う確率（＝重み÷全絵柄の重み合計、の3乗）を別途その場で計算して表示するようにする。
    //   複数ライン同時揃いは各マスが独立抽選される仕組みから自然に生じるため、
    //   その確率は単純に「確率×確率」の掛け算で近似される（設計方針として確定済み）
    const slotNoteEl = document.createElement("p");
    slotNoteEl.className = "devmode-note";
    slotNoteEl.style.margin = "10px 0 2px";
    slotNoteEl.textContent = "スロットの絵柄（任意で施設ごとにカスタマイズ）。画像は空欄のままなら絵文字で表示されます。「出現しやすさ（重み）」は数値が大きいほどその絵柄が出やすくなります（他の絵柄との相対的な重み。空欄なら既定値のまま）。実際に1ラインが揃う確率は、その場で自動計算して表示します：";
    infoEl.appendChild(slotNoteEl);
    
    if (!facility.slotImages || typeof facility.slotImages !== "object") facility.slotImages = {};
    if (!facility.slotWeights || typeof facility.slotWeights !== "object") facility.slotWeights = {};
    const SLOT_SYMBOL_ROWS = [
      { key: "grape", label: "ぶどう（絵文字：🍇）", defaultWeight: 35 },
      { key: "bell", label: "鈴（絵文字：🔔）", defaultWeight: 25 },
      { key: "star", label: "星（絵文字：⭐）", defaultWeight: 20 },
      { key: "gem", label: "宝石（絵文字：💎）", defaultWeight: 12 },
      { key: "seven", label: "セブン（絵文字：7）", defaultWeight: 8 }
    ];
    const slotProbabilitySpans = {};
    let slotTotalProbabilityEl = null;
    // ★実際の「揃う確率」を再計算して表示を更新する。重みを1つ変えると全絵柄の割合が変わるため、毎回全行分を計算し直す
    function refreshSlotProbabilityDisplay() {
      const totalWeight = SLOT_SYMBOL_ROWS.reduce((sum, row) => {
        const override = facility.slotWeights[row.key];
        const w = (typeof override === "number" && override > 0) ? override : row.defaultWeight;
        return sum + w;
      }, 0);
      let anyLineTotal = 0;
      SLOT_SYMBOL_ROWS.forEach(row => {
        const override = facility.slotWeights[row.key];
        const w = (typeof override === "number" && override > 0) ? override : row.defaultWeight;
        const perCell = totalWeight > 0 ? w / totalWeight : 0;
        const lineProb = Math.pow(perCell, 3); // ★3マス（1ライン）とも同じ絵柄になる確率
        anyLineTotal += lineProb;
        const span = slotProbabilitySpans[row.key];
        if (span) span.textContent = `（1ラインが揃う確率：約${(lineProb * 100).toFixed(2)}%）`;
      });
      if (slotTotalProbabilityEl) {
        slotTotalProbabilityEl.textContent = `いずれかの絵柄で1ラインが揃う確率の合計：約${(anyLineTotal * 100).toFixed(2)}%（複数ラインの同時揃いは、これらの確率同士がさらに掛け算される形で自然に発生します）`;
      }
    }
    SLOT_SYMBOL_ROWS.forEach(({ key, label, defaultWeight }) => {
      const slotRow = document.createElement("div");
      slotRow.className = "scenariobuild-condition-row";
      slotRow.style.flexWrap = "wrap";
      slotRow.appendChild(labelSpan(`${label}："`));
      const pathInput = document.createElement("input");
      pathInput.type = "text";
      pathInput.placeholder = "画像URL（空欄なら絵文字）";
      pathInput.className = "scenariobuild-title-input";
      pathInput.value = facility.slotImages[key] || "";
      pathInput.onchange = () => {
        const value = pathInput.value.trim();
        if (value) facility.slotImages[key] = value; else delete facility.slotImages[key];
        markScenarioBuildDirty();
      };
      slotRow.appendChild(pathInput);
      slotRow.appendChild(labelSpan("出現しやすさ（重み）："));
      const weightInput = document.createElement("input");
      weightInput.type = "number";
      weightInput.min = "0";
      weightInput.step = "1";
      weightInput.className = "scenariobuild-condition-input";
      weightInput.placeholder = String(defaultWeight);
      weightInput.value = facility.slotWeights[key] != null ? facility.slotWeights[key] : "";
      weightInput.onchange = () => {
        const value = Number(weightInput.value);
        if (weightInput.value !== "" && value > 0) facility.slotWeights[key] = value; else delete facility.slotWeights[key];
        markScenarioBuildDirty();
        refreshSlotProbabilityDisplay();
      };
      slotRow.appendChild(weightInput);
      const probSpan = document.createElement("span");
      probSpan.className = "devmode-note";
      probSpan.style.marginLeft = "4px";
      slotProbabilitySpans[key] = probSpan;
      slotRow.appendChild(probSpan);
      infoEl.appendChild(slotRow);
    });
    slotTotalProbabilityEl = document.createElement("p");
    slotTotalProbabilityEl.className = "devmode-note";
    slotTotalProbabilityEl.style.margin = "4px 0 10px";
    infoEl.appendChild(slotTotalProbabilityEl);
    refreshSlotProbabilityDisplay();
  } else if (facility.type === "fishing") {
    // ★要望対応：釣り場施設。出現する魚を「時間帯」「天候」ごとに重み付きで登録する。
    //   時間帯はplayer.gameHour（player.js）、天候はcurrentWeatherType（mainfunc.js）を実際の釣りで参照する
    const fishingNote = document.createElement("p");
    fishingNote.className = "devmode-note";
    fishingNote.textContent = "この釣り場で釣れる魚を登録してください（魚IDは「魚管理」タブで作った魚から選べます）。時間帯・天候を「指定なし」にすると、いつでもその条件を満たします。重みが大きいほど釣れやすくなります。釣竿・釣り餌はここではなく、それらを扱う「店」タイプの施設で売ってください（アイテム設定で釣竿・釣り餌チェックを付けたアイテムです）。";
    infoEl.appendChild(fishingNote);
    
    if (!Array.isArray(facility.fishingSpots)) facility.fishingSpots = [];
    facility.fishingSpots.forEach((entry, i) => {
      const spotRow = document.createElement("div");
      spotRow.className = "scenariobuild-condition-row";
      
      spotRow.appendChild(labelSpan("魚ID："));
      const fishInput = document.createElement("input");
      fishInput.type = "text";
      fishInput.className = "scenariobuild-title-input";
      fishInput.placeholder = "魚ID";
      fishInput.setAttribute("list", "scenariobuild-fish-datalist");
      fishInput.value = entry.fishId || "";
      fishInput.onchange = () => { entry.fishId = fishInput.value.trim(); markScenarioBuildDirty(); };
      spotRow.appendChild(fishInput);
      
      spotRow.appendChild(labelSpan("重み："));
      const weightInput = document.createElement("input");
      weightInput.type = "number";
      weightInput.min = "1";
      weightInput.className = "scenariobuild-condition-input";
      weightInput.value = entry.weight != null ? entry.weight : 1;
      weightInput.onchange = () => { entry.weight = Math.max(1, Number(weightInput.value) || 1); markScenarioBuildDirty(); };
      spotRow.appendChild(weightInput);
      
      spotRow.appendChild(labelSpan("時間帯："));
      const timeSelect = document.createElement("select");
      timeSelect.className = "scenariobuild-jump-select";
      [["any", "指定なし"], ["morning", "朝（5〜10時）"], ["day", "昼（10〜16時）"], ["evening", "夕（16〜19時）"], ["night", "夜（19〜5時）"]].forEach(([v, label]) => {
        const opt = document.createElement("option");
        opt.value = v; opt.textContent = label;
        timeSelect.appendChild(opt);
      });
      timeSelect.value = entry.timeOfDay || "any";
      timeSelect.onchange = () => { entry.timeOfDay = timeSelect.value; markScenarioBuildDirty(); };
      spotRow.appendChild(timeSelect);
      
      spotRow.appendChild(labelSpan("天候："));
      const weatherSelect = document.createElement("select");
      weatherSelect.className = "scenariobuild-jump-select";
      [["any", "指定なし"], ["clear", "晴れ（演出無し）"], ["rain", "雨"], ["snow", "雪"], ["sakura", "桜吹雪"]].forEach(([v, label]) => {
        const opt = document.createElement("option");
        opt.value = v; opt.textContent = label;
        weatherSelect.appendChild(opt);
      });
      weatherSelect.value = entry.weather || "any";
      weatherSelect.onchange = () => { entry.weather = weatherSelect.value; markScenarioBuildDirty(); };
      spotRow.appendChild(weatherSelect);
      
      const removeSpotBtn = document.createElement("button");
      removeSpotBtn.className = "devmode-btn devmode-btn-danger";
      removeSpotBtn.textContent = "×";
      removeSpotBtn.onclick = (event) => {
        event.stopPropagation();
        facility.fishingSpots.splice(i, 1);
        markScenarioBuildDirty();
        renderScenarioBuildPanel();
      };
      spotRow.appendChild(removeSpotBtn);
      infoEl.appendChild(spotRow);
    });
    
    const addSpotBtn = document.createElement("button");
    addSpotBtn.className = "devmode-btn";
    addSpotBtn.textContent = "＋出現する魚を追加";
    addSpotBtn.onclick = (event) => {
      event.stopPropagation();
      facility.fishingSpots.push({ fishId: "", weight: 1, timeOfDay: "any", weather: "any" });
      markScenarioBuildDirty();
      renderScenarioBuildPanel();
    };
    infoEl.appendChild(addSpotBtn);
  } else if (facility.type === "shop") {
    const buyRow = document.createElement("div");
    buyRow.className = "scenariobuild-condition-row";
    const buyCheckbox = document.createElement("input");
    buyCheckbox.type = "checkbox";
    buyCheckbox.checked = !!facility.isBuyShop;
    buyCheckbox.onchange = () => { facility.isBuyShop = buyCheckbox.checked; markScenarioBuildDirty(); renderScenarioBuildPanel(); };
    buyRow.appendChild(buyCheckbox);
    buyRow.appendChild(labelSpan("買取屋にする（チェックすると、下の販売アイテム一覧は使わず、所持アイテムを何でも売れる買取屋になる）"));
    infoEl.appendChild(buyRow);
    
    if (!facility.isBuyShop) {
      const shopNote = document.createElement("p");
      shopNote.className = "devmode-note";
      shopNote.textContent = "この店で売っているアイテムと、その値段を登録してください。";
      infoEl.appendChild(shopNote);
      
      if (!Array.isArray(facility.shopItems)) facility.shopItems = [];
      facility.shopItems.forEach((entry, i) => {
        const itemRow = document.createElement("div");
        itemRow.className = "scenariobuild-condition-row";
        
        // ★要望対応：販売アイテムの並び順（＝ゲーム内の店頭での表示順）を▲▼ボタンで入れ替えられるようにする
        const upBtn = document.createElement("button");
        upBtn.type = "button";
        upBtn.className = "devmode-btn";
        upBtn.textContent = "▲";
        upBtn.disabled = i === 0;
        upBtn.onclick = (event) => {
          event.stopPropagation();
          if (i === 0) return;
          [facility.shopItems[i - 1], facility.shopItems[i]] = [facility.shopItems[i], facility.shopItems[i - 1]];
          markScenarioBuildDirty();
          renderScenarioBuildPanel();
        };
        itemRow.appendChild(upBtn);
        
        const downBtn = document.createElement("button");
        downBtn.type = "button";
        downBtn.className = "devmode-btn";
        downBtn.textContent = "▼";
        downBtn.disabled = i === facility.shopItems.length - 1;
        downBtn.onclick = (event) => {
          event.stopPropagation();
          if (i === facility.shopItems.length - 1) return;
          [facility.shopItems[i + 1], facility.shopItems[i]] = [facility.shopItems[i], facility.shopItems[i + 1]];
          markScenarioBuildDirty();
          renderScenarioBuildPanel();
        };
        itemRow.appendChild(downBtn);
        
        const itemInput = document.createElement("input");
        itemInput.type = "text";
        itemInput.className = "scenariobuild-title-input";
        itemInput.placeholder = "アイテムID";
        itemInput.setAttribute("list", "scenariobuild-item-datalist");
        itemInput.value = entry.itemId || "";
        itemInput.onchange = () => {
          entry.itemId = itemInput.value.trim();
          // ★値段が未入力（0のまま）の時だけ、アイテムの定価をデフォルト値として入れておく。
          //   既に金額を自分で決めていた場合は上書きしない
          if ((!entry.price || entry.price === 0) && typeof ITEM_MASTER !== "undefined" && ITEM_MASTER[entry.itemId]) {
            entry.price = ITEM_MASTER[entry.itemId].listedPrice || 0;
            priceInput.value = entry.price;
          }
          markScenarioBuildDirty();
        };
        itemRow.appendChild(itemInput);
        
        itemRow.appendChild(labelSpan("値段："));
        const priceInput = document.createElement("input");
        priceInput.type = "number";
        priceInput.min = "0";
        priceInput.className = "scenariobuild-condition-input";
        priceInput.value = entry.price != null ? entry.price : 0;
        priceInput.onchange = () => { entry.price = Math.max(0, Number(priceInput.value) || 0); markScenarioBuildDirty(); };
        itemRow.appendChild(priceInput);
        
        const removeBtn = document.createElement("button");
        removeBtn.className = "devmode-btn devmode-btn-danger";
        removeBtn.textContent = "×";
        removeBtn.onclick = (event) => {
          event.stopPropagation();
          facility.shopItems.splice(i, 1);
          markScenarioBuildDirty();
          renderScenarioBuildPanel();
        };
        itemRow.appendChild(removeBtn);
        infoEl.appendChild(itemRow);
      });
      
      const addItemBtn = document.createElement("button");
      addItemBtn.className = "devmode-btn";
      addItemBtn.textContent = "＋販売アイテムを追加";
      addItemBtn.onclick = (event) => {
        event.stopPropagation();
        facility.shopItems.push({ itemId: "", price: 0 });
        markScenarioBuildDirty();
        renderScenarioBuildPanel();
      };
      infoEl.appendChild(addItemBtn);
      
      // ★要望対応：特定のアイテムを持っていると、指定したアイテムが貰えたり、店の値段が割引されたりする特典
      const offersNote = document.createElement("p");
      offersNote.className = "devmode-note";
      offersNote.textContent = "特典：プレイヤーが指定したアイテムを持っている時、「アイテムが貰える」か「この店の値段が割引される」のどちらかを設定できます（お店に入るたびに判定します）。";
      infoEl.appendChild(offersNote);
      
      if (!Array.isArray(facility.shopOffers)) facility.shopOffers = [];
      facility.shopOffers.forEach((offer, i) => {
        const offerBox = document.createElement("div");
        offerBox.className = "scenariobuild-condition-row scenariobuild-shop-offer-row";
        
        offerBox.appendChild(labelSpan("持っていると："));
        const reqInput = document.createElement("input");
        reqInput.type = "text";
        reqInput.className = "scenariobuild-title-input";
        reqInput.placeholder = "必要なアイテムID";
        reqInput.setAttribute("list", "scenariobuild-item-datalist");
        reqInput.value = offer.requiredItemId || "";
        reqInput.onchange = () => { offer.requiredItemId = reqInput.value.trim(); markScenarioBuildDirty(); };
        offerBox.appendChild(reqInput);
        
        const modeSelect = document.createElement("select");
        modeSelect.className = "scenariobuild-jump-select";
        [["give", "アイテムが貰える"], ["discount", "値段が割引される"]].forEach(([value, label]) => {
          const opt = document.createElement("option");
          opt.value = value;
          opt.textContent = label;
          modeSelect.appendChild(opt);
        });
        modeSelect.value = offer.mode || "give";
        modeSelect.onchange = () => { offer.mode = modeSelect.value; markScenarioBuildDirty(); renderScenarioBuildPanel(); };
        offerBox.appendChild(modeSelect);
        infoEl.appendChild(offerBox);
        
        const detailRow = document.createElement("div");
        detailRow.className = "scenariobuild-condition-row scenariobuild-shop-offer-row";
        if ((offer.mode || "give") === "give") {
          detailRow.appendChild(labelSpan("貰えるアイテムID："));
          const giveInput = document.createElement("input");
          giveInput.type = "text";
          giveInput.className = "scenariobuild-title-input";
          giveInput.setAttribute("list", "scenariobuild-item-datalist");
          giveInput.value = offer.giveItemId || "";
          giveInput.onchange = () => { offer.giveItemId = giveInput.value.trim(); markScenarioBuildDirty(); };
          detailRow.appendChild(giveInput);
          
          detailRow.appendChild(labelSpan("個数："));
          const giveQtyInput = document.createElement("input");
          giveQtyInput.type = "number";
          giveQtyInput.min = "1";
          giveQtyInput.className = "scenariobuild-condition-input";
          giveQtyInput.value = offer.giveItemQty || 1;
          giveQtyInput.onchange = () => { offer.giveItemQty = Math.max(1, Number(giveQtyInput.value) || 1); markScenarioBuildDirty(); };
          detailRow.appendChild(giveQtyInput);
          
          const consumeLabel = document.createElement("label");
          consumeLabel.className = "scenariobuild-inline-checkbox";
          const consumeCheckbox = document.createElement("input");
          consumeCheckbox.type = "checkbox";
          consumeCheckbox.checked = !!offer.consumeRequiredItem;
          consumeCheckbox.onchange = () => { offer.consumeRequiredItem = consumeCheckbox.checked; markScenarioBuildDirty(); };
          consumeLabel.appendChild(consumeCheckbox);
          consumeLabel.append(" 必要なアイテムを消費する（交換にする）");
          detailRow.appendChild(consumeLabel);
        } else {
          detailRow.appendChild(labelSpan("割引率（％）："));
          const discountInput = document.createElement("input");
          discountInput.type = "number";
          discountInput.min = "1";
          discountInput.max = "90";
          discountInput.className = "scenariobuild-condition-input";
          discountInput.value = offer.discountPercent || 10;
          discountInput.onchange = () => { offer.discountPercent = Math.min(90, Math.max(1, Number(discountInput.value) || 10)); markScenarioBuildDirty(); };
          detailRow.appendChild(discountInput);
          const discountNote = document.createElement("span");
          discountNote.className = "devmode-note";
          discountNote.textContent = "（この店の全アイテムの値段から割引。必要なアイテムは消費されません）";
          detailRow.appendChild(discountNote);
        }
        const removeOfferBtn = document.createElement("button");
        removeOfferBtn.className = "devmode-btn devmode-btn-danger";
        removeOfferBtn.textContent = "×この特典を削除";
        removeOfferBtn.onclick = (event) => {
          event.stopPropagation();
          facility.shopOffers.splice(i, 1);
          markScenarioBuildDirty();
          renderScenarioBuildPanel();
        };
        detailRow.appendChild(removeOfferBtn);
        infoEl.appendChild(detailRow);
      });
      
      const addOfferBtn = document.createElement("button");
      addOfferBtn.className = "devmode-btn";
      addOfferBtn.textContent = "＋特典を追加";
      addOfferBtn.onclick = (event) => {
        event.stopPropagation();
        facility.shopOffers.push({ requiredItemId: "", mode: "give", giveItemId: "", giveItemQty: 1, consumeRequiredItem: false, discountPercent: 10 });
        markScenarioBuildDirty();
        renderScenarioBuildPanel();
      };
      infoEl.appendChild(addOfferBtn);
    }
  } else if (facility.type === "auction") {
    // ★新規：オークション施設。出品候補アイテム（重み付き抽選）・開催間隔・手数料を施設ごとに設定できる
    const intervalRow = document.createElement("div");
    intervalRow.className = "scenariobuild-condition-row";
    intervalRow.appendChild(labelSpan("開催間隔（日）："));
    const intervalInput = document.createElement("input");
    intervalInput.type = "number";
    intervalInput.min = "1";
    intervalInput.className = "scenariobuild-condition-input";
    intervalInput.value = facility.auctionIntervalDays || 4;
    intervalInput.onchange = () => { facility.auctionIntervalDays = Math.max(1, Number(intervalInput.value) || 4); markScenarioBuildDirty(); };
    intervalRow.appendChild(intervalInput);
    infoEl.appendChild(intervalRow);
    
    const feeRow = document.createElement("div");
    feeRow.className = "scenariobuild-condition-row";
    feeRow.appendChild(labelSpan("手数料（陳・開催日に最初の一回だけ徴収）："));
    const feeInput = document.createElement("input");
    feeInput.type = "number";
    feeInput.min = "0";
    feeInput.className = "scenariobuild-condition-input";
    feeInput.value = facility.auctionFee != null ? facility.auctionFee : 1000;
    feeInput.onchange = () => { facility.auctionFee = Math.max(0, Number(feeInput.value) || 0); markScenarioBuildDirty(); };
    feeRow.appendChild(feeInput);
    infoEl.appendChild(feeRow);
    
    const poolNote = document.createElement("p");
    poolNote.className = "devmode-note";
    poolNote.textContent = "出品候補アイテムです。開催日には、この中からランク帯ごとに重み付き抽選で1点ずつ出品されます（1回目：F～C、2回目：C～AAA、3回目：S～X。3回目は30%の確率でのみ開催）。ランク分けはアイテム自体の「ランク」設定を自動で使うので、ここでは登録するだけでOKです。重みは大きいほど選ばれやすくなります（未入力は1）。";
    infoEl.appendChild(poolNote);
    
    if (!Array.isArray(facility.auctionItemPool)) facility.auctionItemPool = [];
    facility.auctionItemPool.forEach((entry, i) => {
      const poolRow = document.createElement("div");
      poolRow.className = "scenariobuild-condition-row";
      
      const poolItemInput = document.createElement("input");
      poolItemInput.type = "text";
      poolItemInput.className = "scenariobuild-title-input";
      poolItemInput.placeholder = "アイテムID";
      poolItemInput.setAttribute("list", "scenariobuild-item-datalist");
      poolItemInput.value = entry.itemId || "";
      poolItemInput.onchange = () => { entry.itemId = poolItemInput.value.trim(); markScenarioBuildDirty(); };
      poolRow.appendChild(poolItemInput);
      
      poolRow.appendChild(labelSpan("重み："));
      const weightInput = document.createElement("input");
      weightInput.type = "number";
      weightInput.min = "1";
      weightInput.className = "scenariobuild-condition-input";
      weightInput.value = entry.weight || 1;
      weightInput.onchange = () => { entry.weight = Math.max(1, Number(weightInput.value) || 1); markScenarioBuildDirty(); };
      poolRow.appendChild(weightInput);
      
      const removePoolBtn = document.createElement("button");
      removePoolBtn.className = "devmode-btn devmode-btn-danger";
      removePoolBtn.textContent = "×";
      removePoolBtn.onclick = (event) => {
        event.stopPropagation();
        facility.auctionItemPool.splice(i, 1);
        markScenarioBuildDirty();
        renderScenarioBuildPanel();
      };
      poolRow.appendChild(removePoolBtn);
      infoEl.appendChild(poolRow);
    });
    
    const addPoolBtn = document.createElement("button");
    addPoolBtn.className = "devmode-btn";
    addPoolBtn.textContent = "＋出品候補アイテムを追加";
    addPoolBtn.onclick = (event) => {
      event.stopPropagation();
      facility.auctionItemPool.push({ itemId: "", weight: 1 });
      markScenarioBuildDirty();
      renderScenarioBuildPanel();
    };
    infoEl.appendChild(addPoolBtn);
    
  } else if (facility.type === "colosseum") {
    // ★要望対応：コロシアム施設。アイテム使用禁止の連戦タワー（実際はn回戦形式）。
    //   参加費・各回戦の敵編成（追加/削除可）・コインの種類と獲得数・99回戦クリア報酬・コインの引き換え屋を設定できる
    const entryNote = document.createElement("p");
    entryNote.className = "devmode-note";
    entryNote.textContent = "参加すると、指定したアイテムを指定した数だけ消費します（無ければ挑戦できません）。挑戦中はアイテムが一切使えません。1回でも負けたら1回戦目からやり直しになります。10の倍数の回戦をクリアすると全回復、5の倍数（10の倍数を除く）の回戦をクリアするとHP・SPが1/3回復します。各回戦に勝利するたびに、次の回戦へ進むかここでやめる（リタイア）かを選べます（リタイアしてもそこまでの自己ベスト・獲得済みコインはそのまま持ち帰れます）。";
    infoEl.appendChild(entryNote);
    
    const entryRow = document.createElement("div");
    entryRow.className = "scenariobuild-condition-row";
    entryRow.appendChild(labelSpan("参加アイテムID："));
    const entryItemInput = document.createElement("input");
    entryItemInput.type = "text";
    entryItemInput.className = "scenariobuild-title-input";
    entryItemInput.setAttribute("list", "scenariobuild-item-datalist");
    entryItemInput.value = facility.entryItemId || "";
    entryItemInput.onchange = () => { facility.entryItemId = entryItemInput.value.trim(); markScenarioBuildDirty(); };
    entryRow.appendChild(entryItemInput);
    entryRow.appendChild(labelSpan("必要数："));
    const entryQtyInput = document.createElement("input");
    entryQtyInput.type = "number";
    entryQtyInput.min = "1";
    entryQtyInput.className = "scenariobuild-condition-input";
    entryQtyInput.value = facility.entryItemQty || 1;
    entryQtyInput.onchange = () => { facility.entryItemQty = Math.max(1, Number(entryQtyInput.value) || 1); markScenarioBuildDirty(); };
    entryRow.appendChild(entryQtyInput);
    infoEl.appendChild(entryRow);
    
    // ===== 通常回戦の「様々な敵」プール（要望対応） =====
    const poolNote = document.createElement("p");
    poolNote.className = "devmode-note";
    poolNote.style.margin = "10px 0 2px";
    poolNote.textContent = "10の倍数（10・20・…・90）と、最後の節目となる99回戦目「以外」の回戦で使う、敵のプールです。回戦ごとに、この中からランダムに5体（重複あり）選ばれて出てきます。";
    infoEl.appendChild(poolNote);
    
    if (!Array.isArray(facility.regularEnemyPool)) facility.regularEnemyPool = [];
    infoEl.appendChild(buildTagListEditor({
      label: "敵ID（同じIDを複数回追加すると、その分ランダムで選ばれやすくなります）：",
      items: facility.regularEnemyPool,
      datalistId: "scenariobuild-monster-datalist",
      placeholder: "敵ID",
      onChange: () => markScenarioBuildDirty()
    }));
    
    // ===== 節目回戦（10の倍数＋99回戦目）の「指定した敵」（要望対応） =====
    const bossRoundsNote = document.createElement("p");
    bossRoundsNote.className = "devmode-note";
    bossRoundsNote.style.margin = "10px 0 2px";
    bossRoundsNote.textContent = "10の倍数の回戦と、100回戦が無いため最後の節目となる99回戦目は、ここで指定した「ボス的な」敵編成で固定されます（プールからのランダム抽選の対象外）。レベルを指定すると、ボスID以外（雑魚敵）はそのレベル×0.6の強さに弱まり、ボスはそのままのレベルで固定されます（0のままなら、通常通り主人公のレベル±1で決まります）。";
    infoEl.appendChild(bossRoundsNote);
    
    if (!facility.bossRoundConfig || typeof facility.bossRoundConfig !== "object") facility.bossRoundConfig = {};
    COLOSSEUM_BOSS_ROUND_NUMBERS.forEach(floorNumber => {
      if (!facility.bossRoundConfig[floorNumber] || typeof facility.bossRoundConfig[floorNumber] !== "object") {
        facility.bossRoundConfig[floorNumber] = { enemyMonsterKeys: [], level: 0 };
      }
      const config = facility.bossRoundConfig[floorNumber];
      if (!Array.isArray(config.enemyMonsterKeys)) config.enemyMonsterKeys = [];
      
      const bossBox = document.createElement("div");
      bossBox.className = "scenariobuild-skill-repeat-body";
      
      const bossHeader = document.createElement("p");
      bossHeader.className = "devmode-note";
      bossHeader.style.fontWeight = "bold";
      bossHeader.textContent = `${floorNumber}回戦目` + (floorNumber === 99 ? "（最終回戦）" : "");
      bossBox.appendChild(bossHeader);
      
      bossBox.appendChild(buildTagListEditor({
        label: "敵ID（最大5体・同じIDを複数回追加すると同じ敵が複数体出ます。ボスIDを混ぜることも可能です）：",
        items: config.enemyMonsterKeys,
        datalistId: "scenariobuild-monster-datalist",
        placeholder: "敵ID",
        onChange: () => markScenarioBuildDirty(),
        maxItems: 5
      }));
      
      const levelRow = document.createElement("div");
      levelRow.className = "scenariobuild-condition-row";
    levelRow.appendChild(labelSpan("ボスのレベル指定（0＝指定なし。指定すると雑魚敵はこのレベル×0.6に弱まる）："));
      const levelInput = document.createElement("input");
      levelInput.type = "number";
      levelInput.min = "0";
      levelInput.className = "scenariobuild-condition-input";
      levelInput.value = config.level || 0;
      levelInput.onchange = () => { config.level = Math.max(0, Number(levelInput.value) || 0); markScenarioBuildDirty(); };
      levelRow.appendChild(levelInput);
      bossBox.appendChild(levelRow);
      
      infoEl.appendChild(bossBox);
    });
    
    // ===== コインの種類・マイルストーン報酬 =====
    const coinNote = document.createElement("p");
    coinNote.className = "devmode-note";
    coinNote.style.margin = "10px 0 2px";
    coinNote.textContent = "10・20・50回戦をクリアすると、それぞれ「青」「黄」「赤」のコインを獲得します。ここではどのアイテムを各色のコインとして扱うか（あらかじめアイテム管理で作っておいたアイテムのIDを指定）と、何個獲得するかを設定します：";
    infoEl.appendChild(coinNote);
    
    const COIN_MILESTONES = [
      { color: "blue", label: "青コイン（10回戦クリアで獲得）", itemKey: "coinItemIdBlue", qtyKey: "milestone10CoinQty" },
      { color: "yellow", label: "黄コイン（20回戦クリアで獲得）", itemKey: "coinItemIdYellow", qtyKey: "milestone20CoinQty" },
      { color: "red", label: "赤コイン（50回戦クリアで獲得）", itemKey: "coinItemIdRed", qtyKey: "milestone50CoinQty" }
    ];
    COIN_MILESTONES.forEach(({ label, itemKey, qtyKey }) => {
      const coinRow = document.createElement("div");
      coinRow.className = "scenariobuild-condition-row";
      coinRow.style.flexWrap = "wrap";
      coinRow.appendChild(labelSpan(`${label}："`));
      const coinItemInput = document.createElement("input");
      coinItemInput.type = "text";
      coinItemInput.className = "scenariobuild-title-input";
      coinItemInput.placeholder = "アイテムID";
      coinItemInput.setAttribute("list", "scenariobuild-item-datalist");
      coinItemInput.value = facility[itemKey] || "";
      coinItemInput.onchange = () => { facility[itemKey] = coinItemInput.value.trim(); markScenarioBuildDirty(); };
      coinRow.appendChild(coinItemInput);
      coinRow.appendChild(labelSpan("獲得数："));
      const coinQtyInput = document.createElement("input");
      coinQtyInput.type = "number";
      coinQtyInput.min = "1";
      coinQtyInput.className = "scenariobuild-condition-input";
      coinQtyInput.value = facility[qtyKey] || 1;
      coinQtyInput.onchange = () => { facility[qtyKey] = Math.max(1, Number(coinQtyInput.value) || 1); markScenarioBuildDirty(); };
      coinRow.appendChild(coinQtyInput);
      infoEl.appendChild(coinRow);
    });
    
    // ===== 99回戦クリア報酬 =====
    const finalNote = document.createElement("p");
    finalNote.className = "devmode-note";
    finalNote.style.margin = "10px 0 2px";
    finalNote.textContent = "99回戦をクリアした時の特別報酬です（0のままなら、その報酬は渡しません）：";
    infoEl.appendChild(finalNote);
    
    const finalRow1 = document.createElement("div");
    finalRow1.className = "scenariobuild-condition-row";
    finalRow1.style.flexWrap = "wrap";
    [["blue", "finalClearBlueCoinQty", "青コイン"], ["yellow", "finalClearYellowCoinQty", "黄コイン"], ["red", "finalClearRedCoinQty", "赤コイン"]].forEach(([, key, label]) => {
      finalRow1.appendChild(labelSpan(`${label}："`));
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.className = "scenariobuild-condition-input";
      input.value = facility[key] || 0;
      input.onchange = () => { facility[key] = Math.max(0, Number(input.value) || 0); markScenarioBuildDirty(); };
      finalRow1.appendChild(input);
    });
    infoEl.appendChild(finalRow1);
    
    const finalRow2 = document.createElement("div");
    finalRow2.className = "scenariobuild-condition-row";
    finalRow2.appendChild(labelSpan("陳："));
    const finalGoldInput = document.createElement("input");
    finalGoldInput.type = "number";
    finalGoldInput.min = "0";
    finalGoldInput.className = "scenariobuild-condition-input";
    finalGoldInput.value = facility.finalClearGoldReward || 0;
    finalGoldInput.onchange = () => { facility.finalClearGoldReward = Math.max(0, Number(finalGoldInput.value) || 0); markScenarioBuildDirty(); };
    finalRow2.appendChild(finalGoldInput);
    finalRow2.appendChild(labelSpan("経験値："));
    const finalExpInput = document.createElement("input");
    finalExpInput.type = "number";
    finalExpInput.min = "0";
    finalExpInput.className = "scenariobuild-condition-input";
    finalExpInput.value = facility.finalClearExpReward || 0;
    finalExpInput.onchange = () => { facility.finalClearExpReward = Math.max(0, Number(finalExpInput.value) || 0); markScenarioBuildDirty(); };
    finalRow2.appendChild(finalExpInput);
    infoEl.appendChild(finalRow2);
    
    // ===== コインの引き換え屋 =====
    const exchangeNote = document.createElement("p");
    exchangeNote.className = "devmode-note";
    exchangeNote.style.margin = "10px 0 2px";
    exchangeNote.textContent = "コインの引き換え屋のラインナップです（コロシアム内の「コインを引き換える」から選べます）：";
    infoEl.appendChild(exchangeNote);
    
    if (!Array.isArray(facility.exchangeOffers)) facility.exchangeOffers = [];
    facility.exchangeOffers.forEach((offer, index) => {
      const offerRow = document.createElement("div");
      offerRow.className = "scenariobuild-condition-row";
      offerRow.style.flexWrap = "wrap";
      
      const colorSelect = document.createElement("select");
      colorSelect.className = "scenariobuild-jump-select";
      [["blue", "青コイン"], ["yellow", "黄コイン"], ["red", "赤コイン"]].forEach(([value, label]) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        colorSelect.appendChild(opt);
      });
      colorSelect.value = offer.coinColor || "blue";
      colorSelect.onchange = () => { offer.coinColor = colorSelect.value; markScenarioBuildDirty(); };
      offerRow.appendChild(colorSelect);
      
      offerRow.appendChild(labelSpan("×"));
      const coinQtyInput = document.createElement("input");
      coinQtyInput.type = "number";
      coinQtyInput.min = "1";
      coinQtyInput.className = "scenariobuild-condition-input";
      coinQtyInput.value = offer.coinQty || 1;
      coinQtyInput.onchange = () => { offer.coinQty = Math.max(1, Number(coinQtyInput.value) || 1); markScenarioBuildDirty(); };
      offerRow.appendChild(coinQtyInput);
      
      offerRow.appendChild(labelSpan("→ アイテムID："));
      const offerItemInput = document.createElement("input");
      offerItemInput.type = "text";
      offerItemInput.className = "scenariobuild-title-input";
      offerItemInput.setAttribute("list", "scenariobuild-item-datalist");
      offerItemInput.value = offer.itemId || "";
      offerItemInput.onchange = () => { offer.itemId = offerItemInput.value.trim(); markScenarioBuildDirty(); };
      offerRow.appendChild(offerItemInput);
      
      offerRow.appendChild(labelSpan("×"));
      const offerQtyInput = document.createElement("input");
      offerQtyInput.type = "number";
      offerQtyInput.min = "1";
      offerQtyInput.className = "scenariobuild-condition-input";
      offerQtyInput.value = offer.itemQty || 1;
      offerQtyInput.onchange = () => { offer.itemQty = Math.max(1, Number(offerQtyInput.value) || 1); markScenarioBuildDirty(); };
      offerRow.appendChild(offerQtyInput);
      
      const removeOfferBtn = document.createElement("button");
      removeOfferBtn.className = "devmode-btn devmode-btn-danger";
      removeOfferBtn.textContent = "×";
      removeOfferBtn.onclick = (event) => {
        event.stopPropagation();
        facility.exchangeOffers.splice(index, 1);
        markScenarioBuildDirty();
        renderScenarioBuildPanel();
      };
      offerRow.appendChild(removeOfferBtn);
      
      infoEl.appendChild(offerRow);
    });
    
    const addOfferBtn = document.createElement("button");
    addOfferBtn.className = "devmode-btn";
    addOfferBtn.textContent = "＋交換品を追加";
    addOfferBtn.onclick = (event) => {
      event.stopPropagation();
      facility.exchangeOffers.push({ coinColor: "blue", coinQty: 1, itemId: "", itemQty: 1 });
      markScenarioBuildDirty();
      renderScenarioBuildPanel();
    };
    infoEl.appendChild(addOfferBtn);
  }
  
  const bgRow = document.createElement("div");
  bgRow.className = "scenariobuild-condition-row";
  bgRow.appendChild(labelSpan("BGM（曲名 or パス）："));
  const bgTrackInput = document.createElement("input");
  bgTrackInput.type = "text";
  bgTrackInput.className = "scenariobuild-condition-input";
  bgTrackInput.setAttribute("list", "scenariobuild-bgm-datalist");
  bgTrackInput.value = facility.bgTrack || "";
  bgTrackInput.onchange = () => { facility.bgTrack = bgTrackInput.value.trim(); markScenarioBuildDirty(); };
  bgRow.appendChild(bgTrackInput);
  infoEl.appendChild(bgRow);
  
  const bgImgRow = document.createElement("div");
  bgImgRow.className = "scenariobuild-condition-row";
  bgImgRow.appendChild(labelSpan("背景画像パス："));
  const bgImageInput = document.createElement("input");
  bgImageInput.type = "text";
  bgImageInput.className = "scenariobuild-condition-input";
  bgImageInput.placeholder = "空欄なら村の背景のまま";
  bgImageInput.value = facility.bgImage || "";
  bgImageInput.onchange = () => { facility.bgImage = bgImageInput.value.trim(); markScenarioBuildDirty(); };
  bgImgRow.appendChild(bgImageInput);
  infoEl.appendChild(bgImgRow);
  
  row.appendChild(infoEl);
  
  const buttonsEl = document.createElement("div");
  buttonsEl.className = "scenariobuild-chapter-buttons";
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "devmode-btn devmode-btn-danger";
  deleteBtn.textContent = "削除";
  deleteBtn.onclick = async (event) => {
    event.stopPropagation();
    const ok = await showGameConfirm(`「${facility.name || "この施設"}」を削除しますか？`);
    if (!ok) return;
    pushUndoSnapshot();
    const idx = scenarioProject.facilities.indexOf(facility);
    if (idx >= 0) scenarioProject.facilities.splice(idx, 1);
    scenarioProject.mapAreas.forEach(a => { a.facilityIds = a.facilityIds.filter(id => id !== facility.id); }); // ★削除した施設は、全ての拠点のアタッチ一覧からも外す
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  buttonsEl.appendChild(deleteBtn);
  row.appendChild(buttonsEl);
  
  return row;
}

// ===================================================================
// ===== サブ画面：立ち絵管理（キャラごとの通常時画像＋表情一覧） =====
// ===================================================================
// ★ここで登録したキャラ・表情は、話のブロックエディタの「立ち絵表示/非表示」「表情変更」ブロックから
//   ドロップダウンで選べるようになる。画像そのものはまだ用意できていなくても、パスだけ先に決めておいて
//   後から差し替えることもできる（存在しないパスなら、ゲーム側では単に画像が表示されないだけで、テキストの
//   進行自体は止まらない）
let scenarioBuildExpandedPortraitCharId = null; // ★どのキャラの表情一覧を開いているか

function renderPortraitManager(container) {
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "キャラを追加すると、まず通常時の立ち絵画像を指定できます。表情を追加すると、その表情ごとに別の画像を指定できます（名前を付けておくと、話のブロックからその名前で呼び出せます）。";
  container.appendChild(introEl);
  
  const listEl = document.createElement("div");
  listEl.className = "scenariobuild-list";
  scenarioProject.portraitCharacters.forEach(char => {
    listEl.appendChild(buildPortraitCharacterRow(char));
  });
  container.appendChild(listEl);
  
  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋キャラを追加";
  addBtn.onclick = (event) => {
    event.stopPropagation();
    pushUndoSnapshot();
    scenarioProject.portraitCharacters.push({
      id: generateId("portraitchar"), name: "新しいキャラ", defaultImagePath: "", expressions: []
    });
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  container.appendChild(addBtn);
}

function buildPortraitCharacterRow(char) {
  const row = document.createElement("div");
  row.className = "scenariobuild-chapter-row";
  
  const infoEl = document.createElement("div");
  infoEl.className = "scenariobuild-chapter-info";
  
  const nameRow = document.createElement("div");
  nameRow.className = "scenariobuild-condition-row";
  nameRow.appendChild(labelSpan("名前："));
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "scenariobuild-title-input";
  nameInput.value = char.name || "";
  nameInput.onchange = () => { char.name = nameInput.value; markScenarioBuildDirty(); };
  nameRow.appendChild(nameInput);
  infoEl.appendChild(nameRow);
  
  const imgRow = document.createElement("div");
  imgRow.className = "scenariobuild-condition-row";
  imgRow.appendChild(labelSpan("通常時の画像パス："));
  const imgInput = document.createElement("input");
  imgInput.type = "text";
  imgInput.className = "scenariobuild-title-input";
  imgInput.placeholder = "例：img/立ち絵/tanaka_normal.png";
  imgInput.value = char.defaultImagePath || "";
  imgInput.onchange = () => { char.defaultImagePath = imgInput.value.trim(); markScenarioBuildDirty(); };
  imgRow.appendChild(imgInput);
  infoEl.appendChild(imgRow);
  
  if (!Array.isArray(char.expressions)) char.expressions = [];
  const isOpen = scenarioBuildExpandedPortraitCharId === char.id;
  const toggleBtn = document.createElement("button");
  toggleBtn.className = "devmode-btn";
  toggleBtn.textContent = `表情一覧（${char.expressions.length}件）${isOpen ? " ▲" : " ▼"}`;
  toggleBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildExpandedPortraitCharId = isOpen ? null : char.id;
    renderScenarioBuildPanel();
  };
  infoEl.appendChild(toggleBtn);
  
  if (isOpen) {
    const exprListEl = document.createElement("div");
    exprListEl.className = "scenariobuild-list";
    char.expressions.forEach(expr => {
      const exprRow = document.createElement("div");
      exprRow.className = "scenariobuild-condition-row";
      
      const exprNameInput = document.createElement("input");
      exprNameInput.type = "text";
      exprNameInput.className = "scenariobuild-title-input";
      exprNameInput.placeholder = "表情名（例：笑顔）";
      exprNameInput.value = expr.name || "";
      exprNameInput.onchange = () => { expr.name = exprNameInput.value; markScenarioBuildDirty(); };
      exprRow.appendChild(exprNameInput);
      
      const exprImgInput = document.createElement("input");
      exprImgInput.type = "text";
      exprImgInput.className = "scenariobuild-title-input";
      exprImgInput.placeholder = "画像パス";
      exprImgInput.value = expr.imagePath || "";
      exprImgInput.onchange = () => { expr.imagePath = exprImgInput.value.trim(); markScenarioBuildDirty(); };
      exprRow.appendChild(exprImgInput);
      
      const exprDeleteBtn = document.createElement("button");
      exprDeleteBtn.className = "devmode-btn scenariobuild-danger-btn";
      exprDeleteBtn.textContent = "✕";
      exprDeleteBtn.onclick = (event) => {
        event.stopPropagation();
        pushUndoSnapshot();
        char.expressions = char.expressions.filter(e => e.id !== expr.id);
        markScenarioBuildDirty();
        renderScenarioBuildPanel();
      };
      exprRow.appendChild(exprDeleteBtn);
      
      exprListEl.appendChild(exprRow);
    });
    infoEl.appendChild(exprListEl);
    
    const addExprBtn = document.createElement("button");
    addExprBtn.className = "devmode-btn";
    addExprBtn.textContent = "＋表情を追加";
    addExprBtn.onclick = (event) => {
      event.stopPropagation();
      pushUndoSnapshot();
      char.expressions.push({ id: generateId("portraitexpr"), name: "", imagePath: "" });
      markScenarioBuildDirty();
      renderScenarioBuildPanel();
    };
    infoEl.appendChild(addExprBtn);
  }
  
  row.appendChild(infoEl);
  
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "devmode-btn scenariobuild-danger-btn";
  deleteBtn.textContent = "削除";
  deleteBtn.onclick = (event) => {
    event.stopPropagation();
    pushUndoSnapshot();
    scenarioProject.portraitCharacters = scenarioProject.portraitCharacters.filter(c => c.id !== char.id);
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  row.appendChild(deleteBtn);
  
  return row;
}

// ★話のブロックエディタで、指定キャラの表情ドロップダウンを組み立てる共通ヘルパー
function buildPortraitExpressionSelect(characterId, selectedExpressionId, onChange) {
  const select = document.createElement("select");
  select.className = "scenariobuild-jump-select";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "（通常時の画像）";
  select.appendChild(defaultOption);
  const char = scenarioProject.portraitCharacters.find(c => c.id === characterId);
  (char ? char.expressions : []).forEach(expr => {
    const opt = document.createElement("option");
    opt.value = expr.id;
    opt.textContent = expr.name || "（名称未設定）";
    select.appendChild(opt);
  });
  select.value = selectedExpressionId || "";
  select.onchange = () => onChange(select.value || "");
  return select;
}

// ★立ち絵表示/表情変更ブロックの実行時に、指定キャラ・指定表情から実際の画像パスを解決する
function resolvePortraitImagePath(characterId, expressionId) {
  const char = scenarioProject.portraitCharacters.find(c => c.id === characterId);
  if (!char) return "";
  if (!expressionId) return char.defaultImagePath || "";
  const expr = char.expressions.find(e => e.id === expressionId);
  return (expr && expr.imagePath) || char.defaultImagePath || "";
}


//   威力(skill.power)がそのままダメージ量になる方式に変わったため廃止した

// ★HP・攻撃力・経験値（基礎値）を入力した状態で、指定したレベルなら実際どれくらいの強さになるかを
//   その場で確認できる小さな電卓。実際の戦闘で使われているscaleMonsterStatsForLevel()と全く同じ計算式を使う
function buildMonsterLevelPreview(entity) {
  const wrap = document.createElement("div");
  wrap.className = "scenariobuild-level-preview";
  
  const row = document.createElement("div");
  row.className = "scenariobuild-condition-row";
  row.appendChild(labelSpan("レベル別ステータス確認：Lv."));
  
  const levelInput = document.createElement("input");
  levelInput.type = "number";
  levelInput.min = "1";
  levelInput.className = "scenariobuild-condition-input";
  levelInput.value = entity.level || 1;
  row.appendChild(levelInput);
  wrap.appendChild(row);
  
  const resultEl = document.createElement("p");
  resultEl.className = "devmode-note scenariobuild-condition";
  wrap.appendChild(resultEl);
  
  const update = () => {
    const level = Math.max(1, Number(levelInput.value) || 1);
    if (typeof scaleMonsterStatsForLevel !== "function") {
      resultEl.textContent = "（プレビューは実際のゲーム画面からシナリオビルドを開いた時のみ使えます）";
      return;
    }
    const scaled = scaleMonsterStatsForLevel({ maxHp: Number(entity.maxHp) || 0, atk: Number(entity.atk) || 0, exp: Number(entity.exp) || 0 }, level);
    resultEl.textContent = `→ Lv.${level} 時：HP ${scaled.maxHp} ／ 攻撃力 ${scaled.atk} ／ 経験値 ${scaled.exp}`;
  };
  levelInput.oninput = update;
  update();
  
  return wrap;
}

// ★エンティティ（敵・ボス・アイテム・BGM等）の入力欄をまとめて作り、containerEl に追加する共通処理
function appendEntityFieldInputs(config, entity, containerEl) {
  config.fields.forEach(field => {
    const fieldRow = document.createElement("div");
    fieldRow.className = "scenariobuild-condition-row";
    fieldRow.appendChild(labelSpan(`${field.label}：`));
    
    let input;
    if (field.type === "checkbox") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!entity[field.key];
      input.onchange = () => {
        entity[field.key] = input.checked;
        markScenarioBuildDirty();
        if (config.onChange) config.onChange();
      };
      fieldRow.appendChild(input);
      containerEl.appendChild(fieldRow);
      return;
    }
    if (field.type === "textarea") {
      input = document.createElement("textarea");
      input.className = "scenariobuild-title-input scenariobuild-textarea";
      input.rows = 4;
      input.placeholder = field.placeholder || "";
      input.value = entity[field.key] != null ? entity[field.key] : "";
      input.onchange = () => {
        entity[field.key] = input.value;
        markScenarioBuildDirty();
        if (config.onChange) config.onChange();
      };
      fieldRow.appendChild(input);
      containerEl.appendChild(fieldRow);
      return;
    }
    // ★要望対応：複数選択可能なチェックボックスリスト（釣り餌の「釣れる魚の種類」など、
    //   フリーテキストの表記ゆれで一致しなくなるのを防ぐため、選択肢から選ぶ形式にする）
    if (field.type === "multiselect") {
      const wrap = document.createElement("div");
      wrap.className = "scenariobuild-multiselect";
      if (!Array.isArray(entity[field.key])) entity[field.key] = [];
      const options = typeof field.optionsFn === "function" ? field.optionsFn() : (field.options || []);
      if (options.length === 0) {
        const emptyNote = document.createElement("span");
        emptyNote.className = "devmode-note";
        emptyNote.textContent = field.emptyText || "（選択肢がありません）";
        wrap.appendChild(emptyNote);
      }
      options.forEach(opt => {
        const optLabel = document.createElement("label");
        optLabel.className = "scenariobuild-multiselect-option";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = entity[field.key].includes(opt.value);
        cb.onchange = () => {
          const list = Array.isArray(entity[field.key]) ? entity[field.key].slice() : [];
          const idx = list.indexOf(opt.value);
          if (cb.checked) {
            if (idx === -1) list.push(opt.value);
          } else if (idx !== -1) {
            list.splice(idx, 1);
          }
          entity[field.key] = list;
          markScenarioBuildDirty();
          if (config.onChange) config.onChange();
        };
        optLabel.appendChild(cb);
        optLabel.appendChild(document.createTextNode(opt.label));
        wrap.appendChild(optLabel);
      });
      fieldRow.appendChild(wrap);
      containerEl.appendChild(fieldRow);
      return;
    }
    if (field.type === "select") {
      input = document.createElement("select");
      input.className = "scenariobuild-title-input";
      (field.options || []).forEach(opt => {
        const optionEl = document.createElement("option");
        optionEl.value = opt.value;
        optionEl.textContent = opt.label;
        input.appendChild(optionEl);
      });
      input.value = entity[field.key] != null ? entity[field.key] : (field.options && field.options[0] ? field.options[0].value : "");
      input.onchange = () => {
        const oldValue = entity[field.key];
        entity[field.key] = input.value;
        if (config.cascadeRenameField === field.key && config.onRename && oldValue !== input.value) config.onRename(oldValue, input.value);
        markScenarioBuildDirty();
        if (config.onChange) config.onChange();
      };
    } else {
      input = document.createElement("input");
      input.type = field.type;
      input.className = field.type === "number" ? "scenariobuild-condition-input" : "scenariobuild-title-input";
      input.placeholder = field.placeholder || "";
      input.value = entity[field.key] != null ? entity[field.key] : "";
      if (field.list) input.setAttribute("list", field.list);
      input.onchange = () => {
        const oldValue = entity[field.key];
        entity[field.key] = field.type === "number" ? (Number(input.value) || 0) : input.value;
        if (config.cascadeRenameField === field.key && config.onRename && oldValue !== entity[field.key]) config.onRename(oldValue, entity[field.key]);
        markScenarioBuildDirty();
        if (config.onChange) config.onChange();
      };
    }
    fieldRow.appendChild(input);
    containerEl.appendChild(fieldRow);
  });
}

// ★アイテムの「効果パラメータ」（薬効・回復量・SP回復量・疲労回復量・眠気軽減割合・希少度・攻撃力・防御力など）を
//   キーと値の組み合わせで自由に追加・編集・削除できる小さなエディタ
// ★アイテムの効果パラメータでよく使うキーと、それぞれの入力欄の種類（数値／文字列／ON-OFF／選択式）
const ITEM_PARAM_KEY_OPTIONS = {
  "回復量": "number", "SP回復量": "number", "疲労回復量": "number", "眠気軽減割合": "number",
  "希少度": "number", "攻撃力": "number", "魔力": "number", "最大HP": "number", "薬効": "number",
  "HP自動回復": "number", "SP自動回復": "number",
  "装備部位": "slot", "武器種類": "weaponType", "帰還": "boolean", "蘇生": "boolean",
  "対象": "text", "用途": "text", "素材ランク": "text"
};

// ★アイテムの種類（category）によって、「効果パラメータ」に追加できるキーの候補を絞り込む。
//   以前はどの種類のアイテムでも全キーが選べてしまい、例えば薬草に「装備部位」を付けられてしまっていた
const ITEM_CATEGORY_PARAM_KEYS = {
  weapon: ["攻撃力", "魔力", "最大HP", "HP自動回復", "SP自動回復", "装備部位", "武器種類"],
  armor: ["攻撃力", "魔力", "最大HP", "HP自動回復", "SP自動回復", "装備部位"],
  // ★要望対応：戦闘不能の仲間を蘇生できる薬草・ポーション・道具を作れるように「蘇生」を追加
  herb: ["回復量", "SP回復量", "疲労回復量", "眠気軽減割合", "薬効", "対象", "蘇生"],
  potion: ["回復量", "SP回復量", "疲労回復量", "眠気軽減割合", "薬効", "対象", "蘇生"],
  material: ["希少度", "素材ランク", "用途"],
  tool: ["用途", "対象", "帰還", "薬効", "蘇生"],
  misc: ["対象", "用途", "希少度"]
};

function buildItemParamsEditor(item, persist) {
  const wrap = document.createElement("div");
  const noteEl = document.createElement("p");
  noteEl.className = "devmode-note scenariobuild-condition";
  noteEl.textContent = "効果パラメータ：追加する項目の種類を選ぶと、それに合った入力欄が出ます（「その他」を選べば好きなキー名で自由に追加できます）。";
  wrap.appendChild(noteEl);
  
  if (!item.params || typeof item.params !== "object" || Object.keys(item.params).length === 0) {
    // ★初めて開いた時は、今のITEM_MASTER側の値をコピーしてくる（既存の効果を消さずに追記・編集できるようにするため）
    const currentMaster = (typeof ITEM_MASTER !== "undefined" && ITEM_MASTER[item.id]) || null;
    item.params = currentMaster && currentMaster.params ? { ...currentMaster.params } : {};
  }
  
  // ★武器は「武器種類」が無いと選べる技（技表の武器種依存など）と噛み合わないため、
  //   毎回「＋」から手動で追加しなくても済むよう、武器カテゴリなら初めから自動で用意しておく
  if (item.category === "weapon" && item.params.武器種類 === undefined) {
    item.params.武器種類 = WEAPON_TYPE_OPTIONS[0];
    persist();
  }
  
  Object.keys(item.params).forEach(key => {
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    
    const keyLabel = document.createElement("span");
    keyLabel.textContent = key + "：";
    row.appendChild(keyLabel);
    
    const kind = ITEM_PARAM_KEY_OPTIONS[key] || "auto";
    
    if (kind === "boolean") {
      const boolSelect = document.createElement("select");
      boolSelect.className = "scenariobuild-jump-select";
      [["true", "ON"], ["false", "OFF"]].forEach(([v, label]) => {
        const opt = document.createElement("option");
        opt.value = v; opt.textContent = label;
        boolSelect.appendChild(opt);
      });
      boolSelect.value = item.params[key] ? "true" : "false";
      boolSelect.onchange = () => { item.params[key] = boolSelect.value === "true"; persist(); };
      row.appendChild(boolSelect);
    } else if (kind === "slot") {
      const slotSelect = document.createElement("select");
      slotSelect.className = "scenariobuild-jump-select";
      ["武器", "胴", "盾"].forEach(v => {
        const opt = document.createElement("option");
        opt.value = v; opt.textContent = v;
        slotSelect.appendChild(opt);
      });
      slotSelect.value = item.params[key] || "武器";
      slotSelect.onchange = () => { item.params[key] = slotSelect.value; persist(); };
      row.appendChild(slotSelect);
    } else if (kind === "weaponType") {
      const typeSelectExisting = document.createElement("select");
      typeSelectExisting.className = "scenariobuild-jump-select";
      WEAPON_TYPE_OPTIONS.forEach(v => {
        const opt = document.createElement("option");
        opt.value = v; opt.textContent = v;
        typeSelectExisting.appendChild(opt);
      });
      typeSelectExisting.value = item.params[key] || WEAPON_TYPE_OPTIONS[0];
      typeSelectExisting.onchange = () => { item.params[key] = typeSelectExisting.value; persist(); };
      row.appendChild(typeSelectExisting);
    } else {
      const valueInput = document.createElement("input");
      valueInput.type = (kind === "number") ? "number" : "text";
      valueInput.className = "scenariobuild-condition-input";
      valueInput.value = String(item.params[key]);
      valueInput.onchange = () => {
        const raw = valueInput.value.trim();
        if (kind === "number") item.params[key] = Number(raw) || 0;
        else if (raw === "true") item.params[key] = true;
        else if (raw === "false") item.params[key] = false;
        else if (raw !== "" && !isNaN(Number(raw))) item.params[key] = Number(raw);
        else item.params[key] = raw;
        persist();
      };
      row.appendChild(valueInput);
    }
    
    const delBtn = document.createElement("button");
    delBtn.className = "devmode-btn devmode-btn-danger";
    delBtn.textContent = "×";
    delBtn.onclick = (event) => {
      event.stopPropagation();
      delete item.params[key];
      persist();
      renderScenarioBuildPanel();
    };
    row.appendChild(delBtn);
    wrap.appendChild(row);
  });
  
  // ★追加行：まず「種類」を選ばせて、それに応じた入力欄を出す
  const addRow = document.createElement("div");
  addRow.className = "scenariobuild-condition-row";
  
  const typeSelect = document.createElement("select");
  typeSelect.className = "scenariobuild-jump-select";
  // ★アイテムの種類（category）に応じて候補を絞り込む。該当が無いカテゴリ（misc等）は一覧の全キーを出す
  const allowedKeys = ITEM_CATEGORY_PARAM_KEYS[item.category] || Object.keys(ITEM_PARAM_KEY_OPTIONS);
  Object.keys(ITEM_PARAM_KEY_OPTIONS).forEach(key => {
    if (item.params[key] !== undefined) return; // ★既に追加済みのキーは選べないようにする
    if (!allowedKeys.includes(key)) return; // ★このアイテムの種類には合わないキーは候補に出さない
    const opt = document.createElement("option");
    opt.value = key; opt.textContent = key;
    typeSelect.appendChild(opt);
  });
  const otherOpt = document.createElement("option");
  otherOpt.value = "__other__";
  otherOpt.textContent = "その他（自由入力）";
  typeSelect.appendChild(otherOpt);
  addRow.appendChild(typeSelect);
  
  const customKeyInput = document.createElement("input");
  customKeyInput.type = "text";
  customKeyInput.className = "scenariobuild-condition-input";
  customKeyInput.placeholder = "キー名";
  customKeyInput.style.display = typeSelect.value === "__other__" ? "" : "none";
  typeSelect.onchange = () => {
    customKeyInput.style.display = typeSelect.value === "__other__" ? "" : "none";
  };
  addRow.appendChild(customKeyInput);
  
  const valInput = document.createElement("input");
  valInput.type = "text";
  valInput.className = "scenariobuild-condition-input";
  valInput.placeholder = "値（例：10）";
  addRow.appendChild(valInput);
  
  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋";
  addBtn.onclick = (event) => {
    event.stopPropagation();
    const key = typeSelect.value === "__other__" ? customKeyInput.value.trim() : typeSelect.value;
    if (!key) return;
    const kind = ITEM_PARAM_KEY_OPTIONS[key] || "auto";
    const raw = valInput.value.trim();
    if (kind === "boolean") item.params[key] = raw === "true" || raw === "ON" || raw === "1";
    else if (kind === "number") item.params[key] = Number(raw) || 0;
    else if (kind === "slot") item.params[key] = ["武器", "胴", "盾"].includes(raw) ? raw : "武器";
    else if (kind === "weaponType") item.params[key] = WEAPON_TYPE_OPTIONS.includes(raw) ? raw : WEAPON_TYPE_OPTIONS[0];
    else if (raw === "true") item.params[key] = true;
    else if (raw === "false") item.params[key] = false;
    else if (raw !== "" && !isNaN(Number(raw))) item.params[key] = Number(raw);
    else item.params[key] = raw;
    persist();
    renderScenarioBuildPanel();
  };
  addRow.appendChild(addBtn);
  wrap.appendChild(addRow);
  
  return wrap;
}

// ★武器・防具が「拾った時」に個体ごとにつくランダムな性能変位（攻撃力 or 最大HP）の範囲を設定する。
//   「錆びたシリーズ」や専用スキル持ちの特別な装備（エクスカリバー等）は元々このシステムの対象外なので、
//   ここで範囲を設定しても効果は無い（inventory.jsのrollEquipmentStatBonus参照）
// ★appraisal.jsのRUSTY_COMMON_TIER_RANKS／RUSTY_HIGH_TIER_RANKSと同じランクの並び。
//   同名のconstをappraisal.js側でも宣言しているため、こちらは別名にして衝突を避ける
const RUSTY_EDITOR_COMMON_TIER_RANKS = ["F", "E", "D", "C", "B"]; // ★よくある結果（配列の先頭＝Fに近いほど出やすい）
const RUSTY_EDITOR_HIGH_TIER_RANKS = ["A", "AA", "AAA", "S", "SS", "SSS", "X"]; // ★低確率の大当たり（配列の先頭＝Aに近いほど出やすい）

// ★「錆びたシリーズ」設定：サビ取り屋で手入れすると、この武器/防具は必ず（100%）別のアイテムに変化する。
//   下の表でランクごとに変化先を指定しておく。ほとんどはF〜Bランクの「よくある結果」になり、
//   低確率（未鑑定なら1/20、鑑定して真の価値が判明済みなら1/15）でAランク以上の「大当たり」になる
function buildRustySeriesEditor(item, persist) {
  const wrap = document.createElement("div");
  
  const checkboxRow = document.createElement("label");
  checkboxRow.className = "scenariobuild-condition-row";
  checkboxRow.style.cursor = "pointer";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = !!item.isRustySeries;
  checkbox.onchange = () => { item.isRustySeries = checkbox.checked; persist(); renderScenarioBuildPanel(); };
  checkboxRow.appendChild(checkbox);
  checkboxRow.append(" 錆びたシリーズにする（「なんでも鑑定」で本当の性能が判明し、サビ取り屋で手入れすると必ず別のアイテムに変化する）");
  wrap.appendChild(checkboxRow);
  
  if (!item.isRustySeries) return wrap;
  
  const noteEl = document.createElement("p");
  noteEl.className = "devmode-note scenariobuild-condition";
  noteEl.textContent = "「なんでも鑑定」は、このアイテムの本当の性能を明らかにするだけです（武器そのものを変える力はありません）。武器を実際に変化させられるのはサビ取り屋だけで、手入れすると必ず下で指定したアイテムのどれかに変化します。ほとんどはF〜Bランクの「よくある結果」になり、低確率（未鑑定なら1/20、鑑定して真の価値が判明済みなら1/15）でAランク以上の「大当たり」になります。何も指定していないランクを引いた時は、その階層の中の別のランクが選び直されます（下の欄が1つも埋まっていない場合だけ、今まで通り性能の揺らぎ直しにフォールバックします）。";
  wrap.appendChild(noteEl);
  
  const nameRow = document.createElement("div");
  nameRow.className = "scenariobuild-condition-row";
  nameRow.appendChild(labelSpan("鑑定しただけで変わる名前（任意）："));
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "scenariobuild-title-input";
  nameInput.placeholder = "空なら名前は変わらない（性能の数値だけ判明する）";
  nameInput.value = item.appraisedName || "";
  nameInput.onchange = () => { item.appraisedName = nameInput.value; persist(); };
  nameRow.appendChild(nameInput);
  wrap.appendChild(nameRow);
  
  if (!item.rustyRankOutcomes || typeof item.rustyRankOutcomes !== "object") item.rustyRankOutcomes = {};
  
  const candidates = (scenarioProject.items || []).filter(other => other.id !== item.id && other.category === item.category);
  
  function buildRankOutcomeRow(rank) {
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    row.appendChild(labelSpan(`ランク${rank}：`));
    const select = document.createElement("select");
    select.className = "scenariobuild-jump-select";
    const noneOption = document.createElement("option");
    noneOption.value = "";
    noneOption.textContent = "（指定なし）";
    select.appendChild(noneOption);
    candidates.forEach(other => {
      const option = document.createElement("option");
      option.value = other.id;
      option.textContent = other.name || other.id;
      select.appendChild(option);
    });
    select.value = item.rustyRankOutcomes[rank] || "";
    select.onchange = () => {
      if (select.value) item.rustyRankOutcomes[rank] = select.value;
      else delete item.rustyRankOutcomes[rank];
      persist();
    };
    row.appendChild(select);
    return row;
  }
  
  const commonTitle = document.createElement("p");
  commonTitle.className = "devmode-note scenariobuild-condition";
  commonTitle.textContent = "よくある結果（F〜Bランク）：";
  wrap.appendChild(commonTitle);
  RUSTY_EDITOR_COMMON_TIER_RANKS.forEach(rank => wrap.appendChild(buildRankOutcomeRow(rank)));
  
  const highTitle = document.createElement("p");
  highTitle.className = "devmode-note scenariobuild-condition";
  highTitle.textContent = "低確率の大当たり（Aランク以上）：";
  wrap.appendChild(highTitle);
  RUSTY_EDITOR_HIGH_TIER_RANKS.forEach(rank => wrap.appendChild(buildRankOutcomeRow(rank)));
  
  return wrap;
}

// ★要望対応：インベントリで自動的にスタックしてまとめられるアイテムかどうか（装備以外）
//   未指定の場合は今まで通りカテゴリ既定値（薬草・ポーション・魔物素材・道具＝スタックする）に従う
function buildItemStackableEditor(item, persist) {
  const wrap = document.createElement("div");
  const row = document.createElement("div");
  row.className = "scenariobuild-condition-row";
  
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  const categoryDefault = ["herb", "potion", "material", "tool"].includes(item.category);
  checkbox.checked = (typeof item.stackable === "boolean") ? item.stackable : categoryDefault;
  checkbox.onchange = () => {
    item.stackable = checkbox.checked;
    persist();
  };
  row.appendChild(checkbox);
  row.appendChild(labelSpan("スタックできるアイテムにする（インベントリで自動的に同じアイテムをまとめる）"));
  wrap.appendChild(row);
  return wrap;
}

// ★要望対応：武器・防具に特殊スキルを持たせる。話のブロックエディタ・特殊スキル編集と同じ操作感で
//   ブロックを組める（item.blocks / item.variables を使い、getEditingSkill()経由でそのまま画面を使い回す）。
//   発動タイミングは「常時発動（装備者の番が来るたび自動で発動）」「任意発動（戦闘中に武器スキルとして選んで発動）」の2種類
function buildItemSkillEditor(item, persist) {
  const wrap = document.createElement("div");
  const noteEl = document.createElement("p");
  noteEl.className = "devmode-note scenariobuild-condition";
  noteEl.textContent = "スキル：この装備を身につけているメンバーに、専用のスキルを持たせられます。「任意発動」は戦闘中そのメンバーの番が来た時に「武器スキル」という選択肢が増え、選ぶと発動します。「常時発動」はそのメンバーの番が来るたびに自動で発動します（毎ターン）。";
  wrap.appendChild(noteEl);
  
  if (!Array.isArray(item.blocks)) item.blocks = [];
  if (!item.variables || typeof item.variables !== "object") item.variables = {};
  
  const nameRow = document.createElement("div");
  nameRow.className = "scenariobuild-condition-row";
  nameRow.appendChild(labelSpan("スキル名（武器スキルの選択肢や発動時に表示。空なら装備名を使う）："));
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "scenariobuild-title-input";
  nameInput.placeholder = item.name || "";
  nameInput.value = item.skillName || "";
  nameInput.onchange = () => { item.skillName = nameInput.value; persist(); };
  nameRow.appendChild(nameInput);
  wrap.appendChild(nameRow);
  
  const modeRow = document.createElement("div");
  modeRow.className = "scenariobuild-condition-row";
  modeRow.appendChild(labelSpan("発動タイミング："));
  const modeSelect = document.createElement("select");
  modeSelect.className = "scenariobuild-jump-select";
  [["active", "任意発動（戦闘中に「武器スキル」を選んだ時だけ）"], ["passive", "常時発動（装備者の番が来るたび自動で／毎ターン）"]].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    modeSelect.appendChild(option);
  });
  modeSelect.value = item.skillActivationMode === "passive" ? "passive" : "active"; // ★未設定時は任意発動（安全側）をデフォルトにする
  modeSelect.onchange = () => { item.skillActivationMode = modeSelect.value; persist(); };
  modeRow.appendChild(modeSelect);
  wrap.appendChild(modeRow);
  
  const blockModeRow = document.createElement("div");
  blockModeRow.className = "scenariobuild-condition-row";
  const blockEditBtn = document.createElement("button");
  blockEditBtn.className = "devmode-btn";
  blockEditBtn.textContent = "⚡ スキル編集";
  blockEditBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildEditingItemSkillId = item.id;
    scenarioBuildMainView = "skillBlockEditor";
    renderScenarioBuildPanel();
  };
  blockModeRow.appendChild(blockEditBtn);
  if (item.blocks.length > 0) {
    const badge = document.createElement("span");
    badge.className = "devmode-note";
    badge.style.margin = "0";
    badge.textContent = `ブロック数：${item.blocks.length}件`;
    blockModeRow.appendChild(badge);
  }
  wrap.appendChild(blockModeRow);
  
  return wrap;
}

function buildItemStatBonusRangeEditor(item, persist) {
  const wrap = document.createElement("div");
  const noteEl = document.createElement("p");
  noteEl.className = "devmode-note scenariobuild-condition";
  noteEl.textContent = "個体差の範囲：この武器・防具を拾った時に、攻撃力（or 最大HP）へランダムでつく変位の範囲。初期値は±0（個体差なし）です。必要なら数値を広げてください。「錆びたシリーズ」や専用スキル持ちの装備には効果がありません。店で購入した装備には個体差はつきません。";
  wrap.appendChild(noteEl);
  
  if (!item.statBonusRange || typeof item.statBonusRange.min !== "number" || typeof item.statBonusRange.max !== "number") {
    item.statBonusRange = { min: 0, max: 0 }; // ★以前は±20が初期値だったが、指定が無い装備にまで意図せず変位が付くのを避けるため±0にした
  }
  
  const row = document.createElement("div");
  row.className = "scenariobuild-condition-row";
  row.appendChild(labelSpan("下限："));
  const minInput = document.createElement("input");
  minInput.type = "number";
  minInput.className = "scenariobuild-condition-input";
  minInput.value = item.statBonusRange.min;
  minInput.onchange = () => {
    item.statBonusRange.min = Math.min(Number(minInput.value) || 0, item.statBonusRange.max);
    minInput.value = item.statBonusRange.min;
    persist();
  };
  row.appendChild(minInput);
  row.appendChild(labelSpan("上限："));
  const maxInput = document.createElement("input");
  maxInput.type = "number";
  maxInput.className = "scenariobuild-condition-input";
  maxInput.value = item.statBonusRange.max;
  maxInput.onchange = () => {
    item.statBonusRange.max = Math.max(Number(maxInput.value) || 0, item.statBonusRange.min);
    maxInput.value = item.statBonusRange.max;
    persist();
  };
  row.appendChild(maxInput);
  wrap.appendChild(row);
  
  return wrap;
}

// ★アイテムが使用時に治す状態異常（複数追加可）。「全ての状態異常を治す」も選べる
function buildItemCuresStatusEditor(item, persist) {
  const wrap = document.createElement("div");
  const noteEl = document.createElement("p");
  noteEl.className = "devmode-note scenariobuild-condition";
  noteEl.textContent = "使用した時に治す状態異常（複数追加可）：";
  wrap.appendChild(noteEl);
  
  if (!item.params || typeof item.params !== "object") item.params = {};
  // ★まだ何も設定されていないアイテムを開いただけで空の curesStatus:[] キーが params に
  //   書き込まれてしまっていた（「謎のキーが追加される」バグ）。表示用にはローカル変数を使い、
  //   実際にparamsへ書き込むのは、ユーザーが追加・変更・削除の操作をした時だけにする
  const existing = Array.isArray(item.params.curesStatus)
    ? item.params.curesStatus
    : (item.params.解毒 ? ["poison"] : []); // ★初めて開いた時は、古い「解毒」項目があればそのまま「毒」1件として引き継ぐ
  
  const CURE_STATUS_OPTIONS = {
    all: "全ての状態異常を治す", poison: "毒", dullPain: "鈍痛", stun: "スタン", paralyze: "麻痺",
    confuse: "混乱", burn: "火傷", atkDown: "攻撃力低下", defDown: "防御力低下", accDown: "命中率低下"
  };
  
  existing.forEach((kind, index) => {
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    
    const kindSelect = document.createElement("select");
    kindSelect.className = "scenariobuild-jump-select";
    Object.keys(CURE_STATUS_OPTIONS).forEach(k => {
      const optionEl = document.createElement("option");
      optionEl.value = k;
      optionEl.textContent = CURE_STATUS_OPTIONS[k];
      kindSelect.appendChild(optionEl);
    });
    kindSelect.value = kind || "poison";
    kindSelect.onchange = () => { item.params.curesStatus = existing; existing[index] = kindSelect.value; persist(); };
    row.appendChild(kindSelect);
    
    const removeBtn = document.createElement("button");
    removeBtn.className = "devmode-btn devmode-btn-danger";
    removeBtn.textContent = "×";
    removeBtn.onclick = (event) => {
      event.stopPropagation();
      existing.splice(index, 1);
      item.params.curesStatus = existing; // ★空になっても「治す状態異常なし」の設定として明示的に残す
      persist();
      renderScenarioBuildPanel();
    };
    row.appendChild(removeBtn);
    
    wrap.appendChild(row);
  });
  
  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋治す状態異常を追加";
  addBtn.onclick = (event) => {
    event.stopPropagation();
    existing.push("poison");
    item.params.curesStatus = existing;
    persist();
    renderScenarioBuildPanel();
  };
  wrap.appendChild(addBtn);
  
  return wrap;
}

// ★敵/ボスの「詳細設定」：ドロップアイテム・見逃した時の反応・専用スキルなど
function buildMonsterDetailEditor(entity, persist, category) {
  const wrap = document.createElement("div");
  const noteEl = document.createElement("p");
  noteEl.className = "devmode-note scenariobuild-condition";
  noteEl.textContent = "見逃し関連・ドロップ・専用スキルなど、より詳しい設定です。空欄のままでも問題ありません。";
  wrap.appendChild(noteEl);
  
  // ★要望対応：敵の属性（複数選択可）と、属性相性を無視するかどうか
  if (!Array.isArray(entity.elements)) entity.elements = [];
  const elementsRow = document.createElement("div");
  elementsRow.className = "scenariobuild-condition-row";
  elementsRow.style.flexWrap = "wrap";
  elementsRow.appendChild(labelSpan("属性（複数選択可）："));
  if (scenarioProject.elementDefs.length === 0) {
    const noneNote = document.createElement("span");
    noneNote.className = "devmode-note";
    noneNote.textContent = "（「属性管理」タブでまだ属性が登録されていません）";
    elementsRow.appendChild(noneNote);
  } else {
    scenarioProject.elementDefs.forEach(el => {
      const chipLabel = document.createElement("label");
      chipLabel.className = "scenariobuild-cleared-label";
      chipLabel.style.marginRight = "10px";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = entity.elements.includes(el.id);
      checkbox.onchange = () => {
        if (checkbox.checked) {
          if (!entity.elements.includes(el.id)) entity.elements.push(el.id);
        } else {
          entity.elements = entity.elements.filter(id => id !== el.id);
        }
        persist();
      };
      chipLabel.appendChild(checkbox);
      chipLabel.appendChild(document.createTextNode(el.name || "（無名）"));
      elementsRow.appendChild(chipLabel);
    });
  }
  wrap.appendChild(elementsRow);
  
  const ignoreAffinityRow = document.createElement("div");
  ignoreAffinityRow.className = "scenariobuild-condition-row";
  const ignoreLabel = document.createElement("label");
  ignoreLabel.className = "scenariobuild-cleared-label";
  const ignoreCheckbox = document.createElement("input");
  ignoreCheckbox.type = "checkbox";
  ignoreCheckbox.checked = !!entity.ignoreElementalAffinity;
  ignoreCheckbox.onchange = () => { entity.ignoreElementalAffinity = ignoreCheckbox.checked; persist(); };
  ignoreLabel.appendChild(ignoreCheckbox);
  ignoreLabel.appendChild(document.createTextNode(" 属性相性を無視する（特攻・耐性を計算せず、常に通常ダメージにする）"));
  ignoreAffinityRow.appendChild(ignoreLabel);
  wrap.appendChild(ignoreAffinityRow);
  
  const textField = (label, key, placeholder) => {
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    row.appendChild(labelSpan(`${label}：`));
    const input = document.createElement("input");
    input.type = "text";
    input.className = "scenariobuild-title-input";
    input.placeholder = placeholder || "";
    input.value = entity[key] || "";
    input.onchange = () => { entity[key] = input.value; persist(); };
    row.appendChild(input);
    wrap.appendChild(row);
  };
  
  textField("撃破時のセリフ（簡易・1行だけ。下の「編集」で複数行や分岐も可能）", "killFlavor", "例：「ぎゃああ！」");
  wrap.appendChild(buildEnemyFlavorBlockEditorRow("倒した時の演出", entity, "killBlocks", persist));
  textField("見逃した時のセリフ（簡易・1行だけ。下の「編集」で複数行や分岐も可能）", "spareFlavor", "例：「ウガ……ウガー……」");
  wrap.appendChild(buildEnemyFlavorBlockEditorRow("見逃した時の演出", entity, "spareBlocks", persist));
  
  const giftRow = document.createElement("div");
  giftRow.className = "scenariobuild-condition-row";
  giftRow.appendChild(labelSpan("見逃した時にくれるアイテムID："));
  const giftInput = document.createElement("input");
  giftInput.type = "text";
  giftInput.className = "scenariobuild-title-input";
  giftInput.setAttribute("list", "scenariobuild-item-datalist");
  giftInput.value = entity.giftItemId || "";
  giftInput.onchange = () => { entity.giftItemId = giftInput.value.trim() || null; persist(); };
  giftRow.appendChild(giftInput);
  wrap.appendChild(giftRow);
  
  // ★要望対応：好感度MAXの時に魔物図鑑から使える専用スキル名（サキュバスの「サキュバスと休憩♡」等）を
  //   敵編集タブから直接設定・確認できるようにする。効果自体（何が起きるか）はconvenience.jsの
  //   useSuccubusRestSkill()のようにモンスターIDで振り分けるコードが別途必要（今のところ汎用化はしていない）
  textField("好感度MAX時の専用スキル名（空欄なら無し）", "restSkillName", "例：サキュバスと休憩♡");
  
  wrap.appendChild(buildEnemyFlavorBlockEditorRow("好感度MAX時スキル演出", entity, "restSkillBlocks", persist));
  
  const affectionRow = document.createElement("div");
  affectionRow.className = "scenariobuild-condition-row";
  affectionRow.appendChild(labelSpan("見逃した時の好感度上昇量（最小～最大）："));
  if (!Array.isArray(entity.affectionGainRange) || entity.affectionGainRange.length !== 2) entity.affectionGainRange = [5, 10];
  const affMinInput = document.createElement("input");
  affMinInput.type = "number";
  affMinInput.className = "scenariobuild-condition-input";
  affMinInput.value = entity.affectionGainRange[0];
  affMinInput.onchange = () => { entity.affectionGainRange[0] = Math.max(0, Number(affMinInput.value) || 0); persist(); };
  affectionRow.appendChild(affMinInput);
  const affMaxInput = document.createElement("input");
  affMaxInput.type = "number";
  affMaxInput.className = "scenariobuild-condition-input";
  affMaxInput.value = entity.affectionGainRange[1];
  affMaxInput.onchange = () => { entity.affectionGainRange[1] = Math.max(0, Number(affMaxInput.value) || 0); persist(); };
  affectionRow.appendChild(affMaxInput);
  wrap.appendChild(affectionRow);
  
  const dropRow = document.createElement("div");
  dropRow.className = "scenariobuild-condition-row";
  dropRow.appendChild(labelSpan("撃破ドロップアイテムID："));
  const dropInput = document.createElement("input");
  dropInput.type = "text";
  dropInput.className = "scenariobuild-title-input";
  dropInput.setAttribute("list", "scenariobuild-item-datalist");
  dropInput.value = entity.dropItemId || "";
  dropInput.onchange = () => { entity.dropItemId = dropInput.value.trim() || null; persist(); };
  dropRow.appendChild(dropInput);
  dropRow.appendChild(labelSpan("確率(0〜1)："));
  const dropRateInput = document.createElement("input");
  dropRateInput.type = "number";
  dropRateInput.min = "0"; dropRateInput.max = "1"; dropRateInput.step = "0.01";
  dropRateInput.className = "scenariobuild-condition-input";
  dropRateInput.value = entity.dropRate != null ? entity.dropRate : 0;
  dropRateInput.onchange = () => { entity.dropRate = Math.max(0, Math.min(1, Number(dropRateInput.value) || 0)); persist(); };
  dropRow.appendChild(dropRateInput);
  wrap.appendChild(dropRow);
  
  const skillNote = document.createElement("p");
  skillNote.className = "devmode-note scenariobuild-condition";
  skillNote.textContent = "専用スキル（低確率で通常より強い一撃を繰り出す）：";
  wrap.appendChild(skillNote);
  
  if (!entity.uniqueSkill || typeof entity.uniqueSkill !== "object") entity.uniqueSkill = { name: "", chance: 0, multiplier: 1, flavor: "", kind: "normal", hpDrainRatio: 0, spDrain: 0, buffPower: 5, buffTurns: 3, classSkillClass: "", classSkillName: "" };
  
  const skillRow1 = document.createElement("div");
  skillRow1.className = "scenariobuild-condition-row";
  skillRow1.appendChild(labelSpan("スキル名："));
  const skillNameInput = document.createElement("input");
  skillNameInput.type = "text";
  skillNameInput.className = "scenariobuild-title-input";
  skillNameInput.value = entity.uniqueSkill.name || "";
  skillNameInput.onchange = () => { entity.uniqueSkill.name = skillNameInput.value; persist(); };
  skillRow1.appendChild(skillNameInput);
  wrap.appendChild(skillRow1);
  
  const skillRow2 = document.createElement("div");
  skillRow2.className = "scenariobuild-condition-row";
  skillRow2.appendChild(labelSpan("発動率(0〜1)："));
  const chanceInput = document.createElement("input");
  chanceInput.type = "number";
  chanceInput.min = "0"; chanceInput.max = "1"; chanceInput.step = "0.01";
  chanceInput.className = "scenariobuild-condition-input";
  chanceInput.value = entity.uniqueSkill.chance != null ? entity.uniqueSkill.chance : 0;
  chanceInput.onchange = () => { entity.uniqueSkill.chance = Math.max(0, Math.min(1, Number(chanceInput.value) || 0)); persist(); };
  skillRow2.appendChild(chanceInput);
  skillRow2.appendChild(labelSpan("威力倍率："));
  const multInput = document.createElement("input");
  multInput.type = "number";
  multInput.min = "0"; multInput.step = "0.1";
  multInput.className = "scenariobuild-condition-input";
  multInput.value = entity.uniqueSkill.multiplier != null ? entity.uniqueSkill.multiplier : 1;
  multInput.onchange = () => { entity.uniqueSkill.multiplier = Number(multInput.value) || 1; persist(); };
  skillRow2.appendChild(multInput);
  wrap.appendChild(skillRow2);
  
  const skillRow3 = document.createElement("div");
  skillRow3.className = "scenariobuild-condition-row";
  skillRow3.appendChild(labelSpan("発動時のセリフ："));
  const flavorInput = document.createElement("input");
  flavorInput.type = "text";
  flavorInput.className = "scenariobuild-title-input";
  flavorInput.value = entity.uniqueSkill.flavor || "";
  flavorInput.onchange = () => { entity.uniqueSkill.flavor = flavorInput.value; persist(); };
  skillRow3.appendChild(flavorInput);
  wrap.appendChild(skillRow3);
  
  // ★「パラメータ吸収」技：与えたダメージの一部を自分のHPとして吸収したり、プレイヤーのSPを吸い取ったりする
  const skillRow4 = document.createElement("div");
  skillRow4.className = "scenariobuild-condition-row";
  skillRow4.appendChild(labelSpan("種類："));
  const kindSelect = document.createElement("select");
  kindSelect.className = "scenariobuild-jump-select";
  [["normal", "通常（ダメージのみ）"], ["drain", "パラメータ吸収"], ["buff", "状態強化（自分の攻撃力を上げる）"], ["classSkill", "職業技を使う"]].forEach(([v, label]) => {
    const opt = document.createElement("option");
    opt.value = v; opt.textContent = label;
    kindSelect.appendChild(opt);
  });
  kindSelect.value = ["drain", "buff", "classSkill"].includes(entity.uniqueSkill.kind) ? entity.uniqueSkill.kind : "normal";
  kindSelect.onchange = () => { entity.uniqueSkill.kind = kindSelect.value; persist(); renderScenarioBuildPanel(); };
  skillRow4.appendChild(kindSelect);
  wrap.appendChild(skillRow4);
  
  // ★要望対応：職業技を使う敵。既存の職業技（scenarioProject.skills、攻撃技のみ）の中から
  //   撃たせたい技を選ぶ。発動時のセリフ・名前は上の欄ではなく選んだ技のものを自動で使う
  if (entity.uniqueSkill.kind === "classSkill") {
    const classRow = document.createElement("div");
    classRow.className = "scenariobuild-condition-row";
    classRow.appendChild(labelSpan("職業："));
    const classSelect = document.createElement("select");
    classSelect.className = "scenariobuild-jump-select";
    Object.keys(CLASS_MASTER).forEach(className => {
      const opt = document.createElement("option");
      opt.value = className; opt.textContent = className;
      classSelect.appendChild(opt);
    });
    classSelect.value = entity.uniqueSkill.classSkillClass || Object.keys(CLASS_MASTER)[0] || "";
    classRow.appendChild(classSelect);
    wrap.appendChild(classRow);
    
    const skillNameRow = document.createElement("div");
    skillNameRow.className = "scenariobuild-condition-row";
    skillNameRow.appendChild(labelSpan("技："));
    const skillNameSelect = document.createElement("select");
    skillNameSelect.className = "scenariobuild-jump-select";
    const attackSkillsOfClass = scenarioProject.skills.filter(s => s.className === classSelect.value && s.type === "attack");
    if (attackSkillsOfClass.length === 0) {
      const opt = document.createElement("option");
      opt.value = ""; opt.textContent = "（この職業に攻撃技がありません）";
      skillNameSelect.appendChild(opt);
    } else {
      attackSkillsOfClass.forEach(s => {
        const opt = document.createElement("option");
        opt.value = s.name; opt.textContent = s.name;
        skillNameSelect.appendChild(opt);
      });
    }
    skillNameSelect.value = entity.uniqueSkill.classSkillName || (attackSkillsOfClass[0] && attackSkillsOfClass[0].name) || "";
    skillNameSelect.onchange = () => { entity.uniqueSkill.classSkillName = skillNameSelect.value; persist(); };
    skillNameRow.appendChild(skillNameSelect);
    wrap.appendChild(skillNameRow);
    
    classSelect.onchange = () => {
      entity.uniqueSkill.classSkillClass = classSelect.value;
      entity.uniqueSkill.classSkillName = ""; // ★職業を変えたら技の選び直しにする
      persist();
      renderScenarioBuildPanel();
    };
    
    const classSkillNote = document.createElement("p");
    classSkillNote.className = "devmode-note";
    classSkillNote.textContent = "選んだ技の威力・命中回数・付与する状態異常がそのまま使われます（威力の基準はこの敵の攻撃力）。発動時のセリフは上の「発動時のセリフ」欄がそのまま使われます。";
    wrap.appendChild(classSkillNote);
  }
  
  // ★要望対応：状態強化スキル（自分の攻撃力を一定ターン上げる。ダメージは与えず行動を終える）
  if (entity.uniqueSkill.kind === "buff") {
    const skillRow7 = document.createElement("div");
    skillRow7.className = "scenariobuild-condition-row";
    skillRow7.appendChild(labelSpan("攻撃力上昇量："));
    const buffPowerInput = document.createElement("input");
    buffPowerInput.type = "number";
    buffPowerInput.min = "0";
    buffPowerInput.className = "scenariobuild-condition-input";
    buffPowerInput.value = entity.uniqueSkill.buffPower != null ? entity.uniqueSkill.buffPower : 5;
    buffPowerInput.onchange = () => { entity.uniqueSkill.buffPower = Math.max(0, Number(buffPowerInput.value) || 0); persist(); };
    skillRow7.appendChild(buffPowerInput);
    skillRow7.appendChild(labelSpan("持続ターン："));
    const buffTurnsInput = document.createElement("input");
    buffTurnsInput.type = "number";
    buffTurnsInput.min = "1";
    buffTurnsInput.className = "scenariobuild-condition-input";
    buffTurnsInput.value = entity.uniqueSkill.buffTurns != null ? entity.uniqueSkill.buffTurns : 3;
    buffTurnsInput.onchange = () => { entity.uniqueSkill.buffTurns = Math.max(1, Number(buffTurnsInput.value) || 1); persist(); };
    skillRow7.appendChild(buffTurnsInput);
    wrap.appendChild(skillRow7);
  }
  
  if (entity.uniqueSkill.kind === "drain") {
    const skillRow5 = document.createElement("div");
    skillRow5.className = "scenariobuild-condition-row";
    skillRow5.appendChild(labelSpan("HP吸収率(0〜1・与ダメの何割を自分のHPにするか)："));
    const hpDrainInput = document.createElement("input");
    hpDrainInput.type = "number";
    hpDrainInput.min = "0"; hpDrainInput.max = "1"; hpDrainInput.step = "0.05";
    hpDrainInput.className = "scenariobuild-condition-input";
    hpDrainInput.value = entity.uniqueSkill.hpDrainRatio != null ? entity.uniqueSkill.hpDrainRatio : 0;
    hpDrainInput.onchange = () => { entity.uniqueSkill.hpDrainRatio = Math.max(0, Math.min(1, Number(hpDrainInput.value) || 0)); persist(); };
    skillRow5.appendChild(hpDrainInput);
    wrap.appendChild(skillRow5);
    
    const skillRow6 = document.createElement("div");
    skillRow6.className = "scenariobuild-condition-row";
    skillRow6.appendChild(labelSpan("SP吸収量（固定値）："));
    const spDrainInput = document.createElement("input");
    spDrainInput.type = "number";
    spDrainInput.min = "0";
    spDrainInput.className = "scenariobuild-condition-input";
    spDrainInput.value = entity.uniqueSkill.spDrain != null ? entity.uniqueSkill.spDrain : 0;
    spDrainInput.onchange = () => { entity.uniqueSkill.spDrain = Math.max(0, Number(spDrainInput.value) || 0); persist(); };
    skillRow6.appendChild(spDrainInput);
    wrap.appendChild(skillRow6);
  }
  
  // ★要望対応：状態異常は「専用スキル発動時」と「通常攻撃命中時」を別々に設定できるようにした
  wrap.appendChild(buildStatusInflictionEditor(entity, persist, "statusInflictions",
    "専用スキル発動時にプレイヤーへ与える状態異常（複数設定可。既に同じ状態異常にかかっている間は上書きしません）："));
  wrap.appendChild(buildStatusInflictionEditor(entity, persist, "normalAttackStatusInflictions",
    "通常攻撃が命中した時にプレイヤーへ与える状態異常（複数設定可。既に同じ状態異常にかかっている間は上書きしません）："));
  wrap.appendChild(buildStatusResistanceEditor(entity, persist)); // ★要望対応：この魔物自身の、状態異常への耐性・無効
  
  // ★戦闘イベント（ifブロック的な演出・行動）は、ボス専用の機能（要望対応）
  if (category === "bosses") {
    const eventRow = document.createElement("div");
    eventRow.className = "scenariobuild-condition-row";
    if (!Array.isArray(entity.battleEvents)) entity.battleEvents = [];
    const summaryEl = document.createElement("span");
    summaryEl.className = "devmode-note";
    summaryEl.textContent = entity.battleEvents.length > 0 ? `戦闘イベント：${entity.battleEvents.length}件設定中` : "戦闘イベント：未設定";
    eventRow.appendChild(summaryEl);
    const eventEditBtn = document.createElement("button");
    eventEditBtn.className = "devmode-btn";
    eventEditBtn.textContent = "編集";
    eventEditBtn.onclick = (evt) => {
      evt.stopPropagation();
      scenarioBuildEditingBossEventRef = { bossId: entity.id };
      scenarioBuildMainView = "bossEventListEditor";
      renderScenarioBuildPanel();
    };
    eventRow.appendChild(eventEditBtn);
    wrap.appendChild(eventRow);
    
    // ★要望対応：ボスの「形態」（以前は演出ブロックの中で1回だけ第2形態に変身する仕組みだったのを廃止し、
    //   好きな数だけ形態を追加・削除できるようにした。各形態は名前・画像・大きさ・攻撃力倍率・
    //   出現時の回復割合・専用BGM・発動条件を個別に持つ）
    const formRow = document.createElement("div");
    formRow.className = "scenariobuild-condition-row";
    if (!Array.isArray(entity.forms)) entity.forms = [];
    const formSummaryEl = document.createElement("span");
    formSummaryEl.className = "devmode-note";
    formSummaryEl.textContent = entity.forms.length > 0 ? `形態：形態1(素の姿)＋追加${entity.forms.length}件` : "形態：形態1(素の姿)のみ";
    formRow.appendChild(formSummaryEl);
    const formEditBtn = document.createElement("button");
    formEditBtn.className = "devmode-btn";
    formEditBtn.textContent = "編集";
    formEditBtn.onclick = (evt) => {
      evt.stopPropagation();
      scenarioBuildEditingBossFormRef = { bossId: entity.id };
      scenarioBuildMainView = "bossFormListEditor";
      renderScenarioBuildPanel();
    };
    formRow.appendChild(formEditBtn);
    wrap.appendChild(formRow);
  }
  
  return wrap;
}

// ★要望対応：この魔物自身が、状態異常をどれだけ受けにくいか（プレイヤー側の技・状態異常タブで作った
//   どの状態異常にも適用される）。「無効」に入れた種類は判定すら行わず一切効かない。
//   「耐性」は、その種類の状態異常が命中する確率に(1-耐性)を掛けて下げる（1.0で実質無効と同じになる）
function buildStatusResistanceEditor(entity, persist) {
  const wrap = document.createElement("div");
  const titleEl = document.createElement("h4");
  titleEl.textContent = "状態異常耐性・無効（この魔物自身の受けやすさ）";
  wrap.appendChild(titleEl);
  const noteEl = document.createElement("p");
  noteEl.className = "devmode-note scenariobuild-condition";
  noteEl.textContent = "プレイヤーの技・状態異常タブで作った状態異常が、この魔物にどれだけ効くかを種類ごとに設定します。「無効」に入れた種類は一切効きません。「耐性」はチェックを付けた種類だけ、命中率に(1−割合)を掛けて下げます（例：0.5なら効く確率が半分になる）。";
  wrap.appendChild(noteEl);
  
  if (!Array.isArray(entity.statusImmunities)) entity.statusImmunities = [];
  if (!entity.statusResistances || typeof entity.statusResistances !== "object") entity.statusResistances = {};
  
  const mechanicOptions = STATUS_AILMENT_MECHANIC_OPTIONS.filter(opt => opt.value);
  mechanicOptions.forEach((opt) => {
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    row.appendChild(labelSpan(opt.label.split("（")[0] + "："));
    
    const immuneLabel = document.createElement("label");
    immuneLabel.className = "scenariobuild-inline-checkbox";
    const immuneCheckbox = document.createElement("input");
    immuneCheckbox.type = "checkbox";
    immuneCheckbox.checked = entity.statusImmunities.includes(opt.value);
    immuneCheckbox.onchange = () => {
      if (immuneCheckbox.checked) {
        if (!entity.statusImmunities.includes(opt.value)) entity.statusImmunities.push(opt.value);
        delete entity.statusResistances[opt.value]; // ★無効にした種類は、耐性の数値は不要になるので消しておく
        renderScenarioBuildPanel();
      } else {
        entity.statusImmunities = entity.statusImmunities.filter(k => k !== opt.value);
      }
      persist();
    };
    immuneLabel.appendChild(immuneCheckbox);
    immuneLabel.appendChild(document.createTextNode("無効"));
    row.appendChild(immuneLabel);
    
    const resistLabel = document.createElement("label");
    resistLabel.className = "scenariobuild-inline-checkbox";
    const resistCheckbox = document.createElement("input");
    resistCheckbox.type = "checkbox";
    resistCheckbox.checked = opt.value in entity.statusResistances;
    resistCheckbox.disabled = immuneCheckbox.checked; // ★無効の種類は、耐性の設定自体が意味を持たない
    const resistInput = document.createElement("input");
    resistInput.type = "number";
    resistInput.min = "0"; resistInput.max = "1"; resistInput.step = "0.05";
    resistInput.className = "scenariobuild-condition-input";
    resistInput.value = entity.statusResistances[opt.value] != null ? entity.statusResistances[opt.value] : 0.5;
    resistInput.disabled = !resistCheckbox.checked || immuneCheckbox.checked;
    resistCheckbox.onchange = () => {
      if (resistCheckbox.checked) {
        entity.statusResistances[opt.value] = Math.max(0, Math.min(1, Number(resistInput.value) || 0.5));
      } else {
        delete entity.statusResistances[opt.value];
      }
      persist();
      renderScenarioBuildPanel();
    };
    resistInput.onchange = () => {
      entity.statusResistances[opt.value] = Math.max(0, Math.min(1, Number(resistInput.value) || 0));
      persist();
    };
    resistLabel.appendChild(resistCheckbox);
    resistLabel.appendChild(document.createTextNode("耐性"));
    row.appendChild(resistLabel);
    row.appendChild(resistInput);
    
    wrap.appendChild(row);
  });
  
  return wrap;
}

// ★敵/ボスの攻撃が命中した時に、プレイヤーへ与える状態異常（複数追加可）。
//   スキルの状態異常編集と同じ考え方：種類・確率・ターン数・効果量を指定できる。
//   ★要望対応：以前は「通常攻撃が命中した時」専用だったが、通常攻撃と専用スキルとで別々に設定できるよう、
//   fieldName（entityのどのプロパティを使うか）とnoteText（説明文）を引数で受け取る形に汎用化した
function buildStatusInflictionEditor(entity, persist, fieldName, noteText) {
  const wrap = document.createElement("div");
  const noteEl = document.createElement("p");
  noteEl.className = "devmode-note scenariobuild-condition";
  noteEl.textContent = noteText;
  wrap.appendChild(noteEl);
  
  if (!Array.isArray(entity[fieldName])) entity[fieldName] = [];
  const list = entity[fieldName];
  
  list.forEach((infliction, index) => {
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    
    const kindSelect = document.createElement("select");
    kindSelect.className = "scenariobuild-jump-select";
    getSkillStatusKindOptions().filter(opt => opt.value).forEach(opt => {
      const optionEl = document.createElement("option");
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      kindSelect.appendChild(optionEl);
    });
    kindSelect.value = infliction.kind || "poison";
    kindSelect.onchange = () => { infliction.kind = kindSelect.value; persist(); };
    row.appendChild(kindSelect);
    
    row.appendChild(labelSpan("確率(0〜1)："));
    const chanceInput = document.createElement("input");
    chanceInput.type = "number";
    chanceInput.min = "0"; chanceInput.max = "1"; chanceInput.step = "0.05";
    chanceInput.className = "scenariobuild-condition-input";
    chanceInput.value = infliction.chance != null ? infliction.chance : 1;
    chanceInput.onchange = () => { infliction.chance = Math.max(0, Math.min(1, Number(chanceInput.value) || 0)); persist(); };
    row.appendChild(chanceInput);
    
    row.appendChild(labelSpan("ターン数："));
    const durationInput = document.createElement("input");
    durationInput.type = "number";
    durationInput.min = "1";
    durationInput.className = "scenariobuild-condition-input";
    durationInput.value = infliction.duration || 3;
    durationInput.onchange = () => { infliction.duration = Math.max(1, Number(durationInput.value) || 1); persist(); };
    row.appendChild(durationInput);
    
    row.appendChild(labelSpan("効果量："));
    const powerInput = document.createElement("input");
    powerInput.type = "number";
    powerInput.min = "0";
    powerInput.className = "scenariobuild-condition-input";
    powerInput.value = infliction.power || 0;
    powerInput.onchange = () => { infliction.power = Number(powerInput.value) || 0; persist(); };
    row.appendChild(powerInput);
    
    const removeBtn = document.createElement("button");
    removeBtn.className = "devmode-btn devmode-btn-danger";
    removeBtn.textContent = "×";
    removeBtn.onclick = (event) => {
      event.stopPropagation();
      list.splice(index, 1);
      persist();
      renderScenarioBuildPanel();
    };
    row.appendChild(removeBtn);
    
    wrap.appendChild(row);
  });
  
  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋状態異常を追加";
  addBtn.onclick = (event) => {
    event.stopPropagation();
    list.push({ kind: "poison", chance: 0.3, duration: 3, power: 0 });
    persist();
    renderScenarioBuildPanel();
  };
  wrap.appendChild(addBtn);
  
  return wrap;
}

const BOSS_EVENT_CONDITION_OPTIONS = [
  { value: "bossHpBelow", label: "ボスの体力が◯%以下になったら" },
  { value: "playerHpBelow", label: "主人公のHPが◯%以下になったら" },
  { value: "playerSpBelow", label: "主人公のSPが◯%以下になったら" },
  { value: "turnCount", label: "経過ターン数が◯以上になったら" },
  { value: "formBecomes", label: "形態が◯になった瞬間" } // ★要望対応：形態タブで設定した各形態への自動切り替わりに反応する専用の条件
];
const BOSS_EVENT_ACTION_OPTIONS = [
  { value: "message", label: "戦闘中セリフを言う（行動は消費しない）" },
  { value: "removeInvincibility", label: "無敵を解除する（行動は消費しない）" },
  { value: "summonAlly", label: "仲間を呼ぶ（指定した魔物が1体増援参戦する）" },
  { value: "heal", label: "自分のHPを回復する" },
  { value: "useSkill", label: "特定の技を撃つ" },
  { value: "blocks", label: "演出ブロックで自由に組む（セリフ・演出・if・変数操作・パラメータ変更など）" }
];

// ★ボスの「戦闘イベント」：ifブロック的に、ボス/主人公のHP割合・ターン数・形態の切り替わりを条件に、
//   セリフ・無敵解除・仲間を呼ぶ・回復・特定の技、のいずれかを発火させる（要望対応）。
//   1つのイベントは戦闘中1回だけ発火する（battle.jsのfindTriggerableBossBattleEvent/executeBossBattleEvent参照）
function buildBossBattleEventEditor(entity, persist) {
  const wrap = document.createElement("div");
  const noteEl = document.createElement("p");
  noteEl.className = "devmode-note scenariobuild-condition";
  noteEl.textContent = "戦闘イベント（ifブロック的な演出・行動）。条件を満たした時に1回だけ発火します。上にある項目ほど優先して判定されます：";
  wrap.appendChild(noteEl);
  
  if (!Array.isArray(entity.battleEvents)) entity.battleEvents = [];
  
  entity.battleEvents.forEach((event, index) => {
    const box = document.createElement("div");
    box.className = "scenariobuild-skill-repeat-body"; // ★1件ずつ枠で囲んで見やすくする（既存の枠デザインを流用）
    
    const condRow = document.createElement("div");
    condRow.className = "scenariobuild-condition-row";
    condRow.style.flexWrap = "wrap";
    condRow.appendChild(labelSpan("条件："));
    const condSelect = document.createElement("select");
    condSelect.className = "scenariobuild-jump-select";
    BOSS_EVENT_CONDITION_OPTIONS.forEach(opt => {
      const optionEl = document.createElement("option");
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      condSelect.appendChild(optionEl);
    });
    condSelect.value = event.conditionType || "bossHpBelow";
    condSelect.onchange = () => { event.conditionType = condSelect.value; persist(); };
    condRow.appendChild(condSelect);
    
    const condValueInput = document.createElement("input");
    condValueInput.type = "number";
    condValueInput.min = "0";
    condValueInput.className = "scenariobuild-condition-input";
    condValueInput.value = event.conditionValue != null ? event.conditionValue : 50;
    condValueInput.onchange = () => { event.conditionValue = Number(condValueInput.value) || 0; persist(); };
    condRow.appendChild(condValueInput);
    box.appendChild(condRow);
    
    const actionRow = document.createElement("div");
    actionRow.className = "scenariobuild-condition-row";
    actionRow.style.flexWrap = "wrap";
    actionRow.appendChild(labelSpan("行動："));
    const actionSelect = document.createElement("select");
    actionSelect.className = "scenariobuild-jump-select";
    BOSS_EVENT_ACTION_OPTIONS.forEach(opt => {
      const optionEl = document.createElement("option");
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      actionSelect.appendChild(optionEl);
    });
    actionSelect.value = event.action || "message";
    actionSelect.onchange = () => { event.action = actionSelect.value; persist(); renderScenarioBuildPanel(); }; // ★行動の種類で必要な追加欄が変わるので再描画する
    actionRow.appendChild(actionSelect);
    box.appendChild(actionRow);
    
    // ★セリフ／メッセージ（message以外の行動でも、演出のひとこととして使える。空欄なら既定文になる）
    const msgRow = document.createElement("div");
    msgRow.className = "scenariobuild-condition-row";
    msgRow.appendChild(labelSpan("セリフ・メッセージ："));
    const msgInput = document.createElement("input");
    msgInput.type = "text";
    msgInput.className = "scenariobuild-title-input";
    msgInput.placeholder = "空欄でもOK（行動に応じた既定の文言が使われます）";
    msgInput.value = event.messageText || "";
    msgInput.onchange = () => { event.messageText = msgInput.value; persist(); };
    msgRow.appendChild(msgInput);
    box.appendChild(msgRow);
    
    if (event.action === "summonAlly") {
      const allyRow = document.createElement("div");
      allyRow.className = "scenariobuild-condition-row";
      allyRow.appendChild(labelSpan("呼び出す魔物ID："));
      const allyInput = document.createElement("input");
      allyInput.type = "text";
      allyInput.className = "scenariobuild-title-input";
      allyInput.placeholder = "例：goblin";
      allyInput.setAttribute("list", "scenariobuild-monster-datalist");
      allyInput.value = event.allyMonsterKey || "";
      allyInput.onchange = () => { event.allyMonsterKey = allyInput.value.trim(); persist(); };
      allyRow.appendChild(allyInput);
      box.appendChild(allyRow);
      
    } else if (event.action === "heal") {
      const healRow = document.createElement("div");
      healRow.className = "scenariobuild-condition-row";
      healRow.appendChild(labelSpan("回復割合（最大HPの、0〜1）："));
      const healInput = document.createElement("input");
      healInput.type = "number";
      healInput.min = "0"; healInput.max = "1"; healInput.step = "0.05";
      healInput.className = "scenariobuild-condition-input";
      healInput.value = event.healRatio != null ? event.healRatio : 0.3;
      healInput.onchange = () => { event.healRatio = Math.max(0, Math.min(1, Number(healInput.value) || 0)); persist(); };
      healRow.appendChild(healInput);
      box.appendChild(healRow);
      
    } else if (event.action === "useSkill") {
      const skillRow = document.createElement("div");
      skillRow.className = "scenariobuild-condition-row";
      skillRow.style.flexWrap = "wrap";
      skillRow.appendChild(labelSpan("技名："));
      const skillNameInput = document.createElement("input");
      skillNameInput.type = "text";
      skillNameInput.className = "scenariobuild-title-input";
      skillNameInput.value = event.skillName || "";
      skillNameInput.onchange = () => { event.skillName = skillNameInput.value; persist(); };
      skillRow.appendChild(skillNameInput);
      skillRow.appendChild(labelSpan("威力倍率："));
      const skillMultInput = document.createElement("input");
      skillMultInput.type = "number";
      skillMultInput.step = "0.1";
      skillMultInput.className = "scenariobuild-condition-input";
      skillMultInput.value = event.skillMultiplier != null ? event.skillMultiplier : 1.5;
      skillMultInput.onchange = () => { event.skillMultiplier = Number(skillMultInput.value) || 1; persist(); };
      skillRow.appendChild(skillMultInput);
      box.appendChild(skillRow);
      
    } else if (event.action === "blocks") {
      // ★要望対応：ボスのHP割合・経過ターン数などをifブロックで参照しながら、話のブロックと同じ仕組みで
      //   セリフ・演出・変数操作・パラメータ変更などを自由に組み合わせられる
      if (!Array.isArray(event.blocks)) event.blocks = [];
      const blockSummaryRow = document.createElement("div");
      blockSummaryRow.className = "scenariobuild-condition-row";
      const blockSummary = document.createElement("span");
      blockSummary.className = "devmode-note";
      blockSummary.textContent = event.blocks.length > 0 ? `演出ブロック：${event.blocks.length}個を設定中` : "演出ブロック：未設定";
      blockSummaryRow.appendChild(blockSummary);
      const blockEditBtn = document.createElement("button");
      blockEditBtn.className = "devmode-btn";
      blockEditBtn.textContent = "編集";
      blockEditBtn.onclick = (evt) => {
        evt.stopPropagation();
        scenarioBuildEditingBossEventRef = { bossId: entity.id, eventId: event.id };
        scenarioBuildMainView = "bossEventBlockEditor";
        renderScenarioBuildPanel();
      };
      blockSummaryRow.appendChild(blockEditBtn);
      box.appendChild(blockSummaryRow);
      
      const consumeLabel = document.createElement("label");
      consumeLabel.className = "scenariobuild-inline-checkbox";
      const consumeCheckbox = document.createElement("input");
      consumeCheckbox.type = "checkbox";
      consumeCheckbox.checked = event.blocksConsumesTurn === true;
      consumeCheckbox.onchange = () => { event.blocksConsumesTurn = consumeCheckbox.checked; persist(); };
      consumeLabel.appendChild(consumeCheckbox);
      consumeLabel.append(" この演出の後、通常攻撃はしない（この演出だけでこのターンを終える）");
      box.appendChild(consumeLabel);
    }
    
    const removeBtn = document.createElement("button");
    removeBtn.className = "devmode-btn devmode-btn-danger";
    removeBtn.textContent = "この戦闘イベントを削除";
    removeBtn.onclick = (event2) => {
      event2.stopPropagation();
      entity.battleEvents.splice(index, 1);
      persist();
      renderScenarioBuildPanel();
    };
    box.appendChild(removeBtn);
    
    wrap.appendChild(box);
  });
  
  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋戦闘イベントを追加";
  addBtn.onclick = (event) => {
    event.stopPropagation();
    entity.battleEvents.push({
      id: generateId("bossevent"), conditionType: "bossHpBelow", conditionValue: 50,
      action: "message", messageText: ""
    });
    persist();
    renderScenarioBuildPanel();
  };
  wrap.appendChild(addBtn);
  
  return wrap;
}

// ===== ボスの「形態」一覧エディタ（要望対応） =====
// 以前は戦闘イベントの中の一アクション（changeForm）として、決め打ちで1回だけ「第2形態」に
// 変身する仕組みだったのを廃止し、好きな数だけ形態を追加・削除できるようにした。
// 形態1＝ボス本来の姿（詳細設定の名前・画像・攻撃力・BGMそのもの）。
// ここで追加する形態は「形態2」以降にあたり、配列の並び順どおりに切り替わっていく
// （forms[0]が形態2、forms[1]が形態3……）。各形態は名前・画像・大きさ・攻撃力倍率・
// 出現時の回復割合・専用BGMを個別に持ち、発動条件（ボスの体力/主人公のHP・SP/経過ターン数）を
// 満たした瞬間に自動で切り替わる。切り替わった瞬間の演出は、戦闘イベント側で
// 条件を「形態が◯になった瞬間」にすることで別途組み立てる（このエディタでは組まない）
function buildBossFormEditor(entity, persist) {
  const wrap = document.createElement("div");
  
  const noteEl = document.createElement("p");
  noteEl.className = "devmode-note scenariobuild-condition";
  noteEl.textContent = "形態1（素の姿）はボスの詳細設定（名前・画像・攻撃力・BGM）がそのまま使われます。ここでは形態2以降を、並び順どおりに追加します。形態は「前の形態のHPが0になった瞬間」に自動的に次へ進みます（発動条件は指定できません）。攻撃力倍率は形態1の攻撃力に対する倍率（複利にはなりません）。移行直後のHP割合は、そのまま新しいHPになります（空欄なら満タン）。この形態専用の演出をしたい場合は、戦闘イベント側で条件を「形態が◯になった瞬間」にして組んでください（◯には、この形態の番号を入れます）。";
  wrap.appendChild(noteEl);
  
  if (!Array.isArray(entity.forms)) entity.forms = [];
  
  entity.forms.forEach((form, index) => {
    const formNumber = index + 2; // ★forms[0]が形態2、forms[1]が形態3……
    const box = document.createElement("div");
    box.className = "scenariobuild-skill-repeat-body";
    
    const headerEl = document.createElement("p");
    headerEl.className = "devmode-note";
    headerEl.style.fontWeight = "bold";
    headerEl.textContent = `形態${formNumber}`;
    box.appendChild(headerEl);
    
    const nameRow = document.createElement("div");
    nameRow.className = "scenariobuild-condition-row";
    nameRow.appendChild(labelSpan("名前："));
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "scenariobuild-title-input";
    nameInput.placeholder = "空欄なら直前の形態の名前のまま";
    nameInput.value = form.name || "";
    nameInput.onchange = () => { form.name = nameInput.value; persist(); };
    nameRow.appendChild(nameInput);
    box.appendChild(nameRow);
    
    const imageRow = document.createElement("div");
    imageRow.className = "scenariobuild-condition-row";
    imageRow.appendChild(labelSpan("画像パス："));
    const imageInput = document.createElement("input");
    imageInput.type = "text";
    imageInput.className = "scenariobuild-title-input";
    imageInput.placeholder = "空欄なら直前の形態の画像のまま";
    imageInput.value = form.imagePath || "";
    imageInput.onchange = () => { form.imagePath = imageInput.value; persist(); };
    imageRow.appendChild(imageInput);
    box.appendChild(imageRow);
    
    const sizeRow = document.createElement("div");
    sizeRow.className = "scenariobuild-condition-row";
    sizeRow.appendChild(labelSpan("大きさ倍率："));
    const sizeInput = document.createElement("input");
    sizeInput.type = "number";
    sizeInput.step = "0.1";
    sizeInput.className = "scenariobuild-condition-input";
    sizeInput.placeholder = "空欄なら変えない";
    sizeInput.value = form.sizeMultiplier != null ? form.sizeMultiplier : "";
    sizeInput.onchange = () => { const v = Number(sizeInput.value); form.sizeMultiplier = (sizeInput.value !== "" && v > 0) ? v : null; persist(); };
    sizeRow.appendChild(sizeInput);
    box.appendChild(sizeRow);
    
    const statsRow = document.createElement("div");
    statsRow.className = "scenariobuild-condition-row";
    statsRow.appendChild(labelSpan("攻撃力倍率："));
    const atkInput = document.createElement("input");
    atkInput.type = "number";
    atkInput.step = "0.1";
    atkInput.className = "scenariobuild-condition-input";
    atkInput.value = form.atkMultiplier != null ? form.atkMultiplier : 1;
    atkInput.onchange = () => { atkInput.value = Number(atkInput.value) || 1; form.atkMultiplier = Number(atkInput.value); persist(); };
    statsRow.appendChild(atkInput);
    statsRow.appendChild(labelSpan("移行直後のHP割合(0〜1)："));
    const healInput = document.createElement("input");
    healInput.type = "number";
    healInput.min = "0"; healInput.max = "1"; healInput.step = "0.05";
    healInput.className = "scenariobuild-condition-input";
    healInput.placeholder = "空欄なら満タン";
    healInput.value = form.healRatioOnEnter != null ? form.healRatioOnEnter : "";
    healInput.onchange = () => { const v = Number(healInput.value); form.healRatioOnEnter = (healInput.value !== "" && v > 0) ? Math.min(1, v) : null; persist(); };
    statsRow.appendChild(healInput);
    box.appendChild(statsRow);
    
    const bgmRow = document.createElement("div");
    bgmRow.className = "scenariobuild-condition-row";
    bgmRow.appendChild(labelSpan("専用BGM："));
    const bgmInput = document.createElement("input");
    bgmInput.type = "text";
    bgmInput.className = "scenariobuild-title-input";
    bgmInput.placeholder = "空欄なら直前の曲のまま";
    bgmInput.setAttribute("list", "scenariobuild-bgm-datalist");
    bgmInput.value = form.bgmTrack || "";
    bgmInput.onchange = () => { form.bgmTrack = bgmInput.value; persist(); };
    bgmRow.appendChild(bgmInput);
    box.appendChild(bgmRow);
    
    // ★要望対応：BGM引き継ぎ。ONの場合、専用BGMを入力していてもBGMは一切切り替えず、
    //   この形態になる直前まで流れていた曲をそのまま流し続ける（既定でON）
    const inheritLabel = document.createElement("label");
    inheritLabel.className = "scenariobuild-cleared-label";
    const inheritCheckbox = document.createElement("input");
    inheritCheckbox.type = "checkbox";
    inheritCheckbox.checked = form.inheritBgm !== false; // ★未設定（既存データ含む）なら既定でON
    bgmInput.disabled = inheritCheckbox.checked;
    inheritCheckbox.onchange = () => {
      form.inheritBgm = inheritCheckbox.checked;
      bgmInput.disabled = inheritCheckbox.checked;
      persist();
    };
    inheritLabel.appendChild(inheritCheckbox);
    inheritLabel.append(" BGM引き継ぎ（ONだと専用BGMを設定していても切り替えず、直前の曲をそのまま流し続けます）");
    box.appendChild(inheritLabel);
    
    const removeBtn = document.createElement("button");
    removeBtn.className = "devmode-btn devmode-btn-danger";
    removeBtn.textContent = "この形態を削除";
    removeBtn.onclick = (evt) => {
      evt.stopPropagation();
      entity.forms.splice(index, 1);
      persist();
      renderScenarioBuildPanel();
    };
    box.appendChild(removeBtn);
    
    wrap.appendChild(box);
  });
  
  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋形態を追加";
  addBtn.onclick = (evt) => {
    evt.stopPropagation();
    entity.forms.push({
      id: generateId("bossform"), name: "", imagePath: "", sizeMultiplier: null,
      atkMultiplier: 1.3, healRatioOnEnter: null, bgmTrack: "", inheritBgm: true
    });
    persist();
    renderScenarioBuildPanel();
  };
  wrap.appendChild(addBtn);
  
  return wrap;
}

// ===== メイン画面：ボスの形態一覧エディタ（専用全画面。scenarioBuildMainView === "bossFormListEditor"） =====
function renderBossFormListEditor(container) {
  const ref = scenarioBuildEditingBossFormRef;
  const boss = ref && (scenarioProject.bosses || []).find(b => b.id === ref.bossId);
  
  const backBtn = document.createElement("button");
  backBtn.className = "devmode-btn";
  backBtn.textContent = "← ボス編集に戻る";
  backBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildMainView = "entityEditor";
    scenarioBuildEditingBossFormRef = null;
    renderScenarioBuildPanel();
  };
  container.appendChild(backBtn);
  
  if (!boss) {
    scenarioBuildMainView = "editor";
    scenarioBuildSubView = "bosses";
    scenarioBuildEditingBossFormRef = null;
    renderScenarioBuildPanel();
    return;
  }
  
  const titleEl = document.createElement("h3");
  titleEl.textContent = `「${boss.name || "（名称未設定）"}」の形態`;
  container.appendChild(titleEl);
  
  container.appendChild(buildBossFormEditor(boss, () => { markScenarioBuildDirty(); ensureCustomMonstersRegistered(); }));
}

// ===== メイン画面：ボスの戦闘イベント一覧エディタ（専用全画面。scenarioBuildMainView === "bossEventListEditor"） =====
// ★要望対応：以前はボスの詳細設定の中に直接ずらっと表示されていたが、話編集・特殊スキル編集と同じように
//   「編集」ボタンから専用の全画面に移動できるようにした
function renderBossEventListEditor(container) {
  const ref = scenarioBuildEditingBossEventRef;
  const boss = ref && (scenarioProject.bosses || []).find(b => b.id === ref.bossId);
  
  const backBtn = document.createElement("button");
  backBtn.className = "devmode-btn";
  backBtn.textContent = "← ボス編集に戻る";
  backBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildMainView = "entityEditor";
    scenarioBuildEditingBossEventRef = null;
    renderScenarioBuildPanel();
  };
  container.appendChild(backBtn);
  
  if (!boss) {
    scenarioBuildMainView = "editor";
    scenarioBuildSubView = "bosses";
    scenarioBuildEditingBossEventRef = null;
    renderScenarioBuildPanel();
    return;
  }
  
  const titleEl = document.createElement("h3");
  titleEl.textContent = `「${boss.name || "（名称未設定）"}」の戦闘イベント`;
  container.appendChild(titleEl);
  
  container.appendChild(buildBossBattleEventEditor(boss, () => { markScenarioBuildDirty(); ensureCustomMonstersRegistered(); }));
}

// ===== メイン画面：ボスの戦闘イベント演出ブロックエディタ（専用全画面。scenarioBuildMainView === "bossEventBlockEditor"） =====
function renderBossEventBlockEditor(container) {
  const ref = scenarioBuildEditingBossEventRef;
  const boss = ref && (scenarioProject.bosses || []).find(b => b.id === ref.bossId);
  const event = boss && Array.isArray(boss.battleEvents) ? boss.battleEvents.find(e => e.id === ref.eventId) : null;
  
  const backBtn = document.createElement("button");
  backBtn.className = "devmode-btn";
  backBtn.textContent = "← 戦闘イベント一覧に戻る";
  backBtn.onclick = (evt) => {
    evt.stopPropagation();
    scenarioBuildMainView = "bossEventListEditor";
    scenarioBuildEditingBossEventRef = { bossId: ref.bossId };
    renderScenarioBuildPanel();
  };
  container.appendChild(backBtn);
  
  if (!boss || !event) {
    scenarioBuildMainView = "editor";
    scenarioBuildSubView = "bosses";
    scenarioBuildEditingBossEventRef = null;
    renderScenarioBuildPanel();
    return;
  }
  if (!Array.isArray(event.blocks)) event.blocks = [];
  
  const titleEl = document.createElement("h3");
  titleEl.textContent = `「${boss.name || "（名称未設定）"}」の演出ブロック`;
  container.appendChild(titleEl);
  
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "話のブロックと同じように、セリフ・演出・if（ボスの体力％・経過ターン数・変数なども参照可）・変数操作・パラメータ変更などを自由に組み立てられます。";
  container.appendChild(introEl);
  
  const fakeChapter = { id: "bossevent::" + boss.id + "::" + event.id, blocks: event.blocks };
  
  const listEl = document.createElement("div");
  listEl.className = "scenariobuild-block-list";
  listEl.appendChild(buildBlockInsertSlot(fakeChapter, 0));
  event.blocks.forEach((b, index) => {
    listEl.appendChild(buildScenarioBlockRow(fakeChapter, b, index));
    listEl.appendChild(buildBlockInsertSlot(fakeChapter, index + 1));
  });
  container.appendChild(listEl);
}

// ★カテゴリ名から、対応するgetXManagerConfig()を呼び出す（詳細編集画面で使う）
function getEntityManagerConfigByCategory(category) {
  if (category === "characters") return getCharacterManagerConfig();
  if (category === "enemies") return getEnemyManagerConfig();
  if (category === "bosses") return getBossManagerConfig();
  if (category === "items") return getItemManagerConfig();
  if (category === "fish") return getFishManagerConfig();
  if (category === "bgmTracks") return getBgmManagerConfig();
  return null;
}

// ===================================================================
// ===== メイン画面：敵/ボス/アイテムの詳細編集（専用全画面。scenarioBuildMainView === "entityEditor"） =====
// ===================================================================
function renderEntityDetailEditor(container) {
  const ref = scenarioBuildEditingEntityRef;
  const config = ref && getEntityManagerConfigByCategory(ref.category);
  const entity = config && config.getList().find(e => e.id === ref.id);
  
  const backBtn = document.createElement("button");
  backBtn.className = "devmode-btn";
  backBtn.textContent = "← 一覧に戻る";
  backBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildMainView = "list";
    scenarioBuildEditingEntityRef = null;
    renderScenarioBuildPanel();
  };
  container.appendChild(backBtn);
  
  if (!config || !entity) {
    scenarioBuildMainView = "list";
    scenarioBuildEditingEntityRef = null;
    renderScenarioBuildPanel();
    return;
  }
  
  // ★保存すると同時に、必要ならconfig.onChange（例：アイテムならITEM_MASTERへの反映）も毎回呼ぶ。
  //   以前はここがundo/redo時にしか反映されない（一覧に戻るだけでは反映されない）バグの原因だった
  const persist = () => { markScenarioBuildDirty(); if (config.onChange) config.onChange(); };
  
  const titleEl = document.createElement("h3");
  titleEl.textContent = `詳細設定：${entity.name || entity.id}` + (entity.builtin ? "（組み込み）" : "");
  container.appendChild(titleEl);
  
  const formWrap = document.createElement("div");
  formWrap.className = "scenariobuild-list";
  const fieldsWrap = document.createElement("div");
  fieldsWrap.className = "scenariobuild-chapter-info";
  appendEntityFieldInputs(config, entity, fieldsWrap);
  if (config.showLevelPreview) fieldsWrap.appendChild(buildMonsterLevelPreview(entity));
  if (ref.category === "items") {
    fieldsWrap.appendChild(buildItemParamsEditor(entity, persist));
    // ★「治す状態異常」は使用して効果を発揮するアイテム（薬草・ポーション・道具）にしか意味が無いため、
    //   それ以外（武器・防具・魔物素材・その他）では出さない。以前は全カテゴリで表示していたため、
    //   武器などを開いただけで空の curesStatus:[] キーが params に紛れ込む不具合があった
    if (entity.category === "herb" || entity.category === "potion" || entity.category === "tool") {
      fieldsWrap.appendChild(buildItemCuresStatusEditor(entity, persist));
    }
    if (entity.category === "weapon" || entity.category === "armor") {
      fieldsWrap.appendChild(buildItemStatBonusRangeEditor(entity, persist));
      fieldsWrap.appendChild(buildRustySeriesEditor(entity, persist));
      fieldsWrap.appendChild(buildItemSkillEditor(entity, persist));
    } else {
      // ★要望対応：装備（武器・防具）以外のアイテムに、スタックできるかどうかのチェックを追加
      fieldsWrap.appendChild(buildItemStackableEditor(entity, persist));
    }
  }
  if (ref.category === "enemies" || ref.category === "bosses") fieldsWrap.appendChild(buildMonsterDetailEditor(entity, persist, ref.category));
  formWrap.appendChild(fieldsWrap);
  container.appendChild(formWrap);
  
  const buttonsRow = document.createElement("div");
  buttonsRow.className = "scenariobuild-chapter-buttons";
  
  if (entity.builtin && config.getDefaultFromMaster) {
    const resetBtn = document.createElement("button");
    resetBtn.className = "devmode-btn";
    resetBtn.textContent = "既定値に戻す";
    resetBtn.onclick = async (event) => {
      event.stopPropagation();
      const defaults = config.getDefaultFromMaster(entity.id);
      if (!defaults) return;
      const ok = await showGameConfirm(`「${entity.name || entity.id}」を元の設定に戻しますか？`);
      if (!ok) return;
      pushUndoSnapshot();
      Object.assign(entity, defaults);
      markScenarioBuildDirty();
      if (config.onChange) config.onChange();
      renderScenarioBuildPanel();
    };
    buttonsRow.appendChild(resetBtn);
  }
  
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "devmode-btn devmode-btn-danger";
  deleteBtn.textContent = "削除";
  deleteBtn.onclick = async (event) => {
    event.stopPropagation();
    const ok = await showGameConfirm(`「${entity.name || entity.id}」を削除しますか？`);
    if (!ok) return;
    pushUndoSnapshot();
    const index = config.getList().indexOf(entity);
    if (entity.builtin && config.category && !scenarioProject.deletedBuiltinIds[config.category].includes(entity.id)) {
      scenarioProject.deletedBuiltinIds[config.category].push(entity.id);
    }
    config.getList().splice(index, 1);
    if (config.onDelete) config.onDelete(entity);
    markScenarioBuildDirty();
    scenarioBuildMainView = "list";
    scenarioBuildEditingEntityRef = null;
    renderScenarioBuildPanel();
  };
  buttonsRow.appendChild(deleteBtn);
  container.appendChild(buttonsRow);
}

function buildEntityRow(config, entity, index) {
  const row = document.createElement("div");
  row.className = "scenariobuild-chapter-row" + (entity.builtin ? " scenariobuild-chapter-row-builtin" : "");
  
  // ★要望対応：クエスト・アイテム・店の並びなど、一覧の表示順（＝ゲーム内での表示順）を
  //   ☰ハンドルのドラッグで並び替えられるようにする（renderEntityManagerを使う一覧すべてに共通）
  row.addEventListener("dragover", (event) => {
    event.preventDefault();
    row.classList.add("scenariobuild-drag-over");
  });
  row.addEventListener("dragleave", () => row.classList.remove("scenariobuild-drag-over"));
  row.addEventListener("drop", (event) => {
    event.preventDefault();
    row.classList.remove("scenariobuild-drag-over");
    if (scenarioEntityDragFromIndex === null || scenarioEntityDragFromIndex === index) return;
    pushUndoSnapshot();
    const list = config.getList();
    const [moved] = list.splice(scenarioEntityDragFromIndex, 1);
    list.splice(index, 0, moved);
    scenarioEntityDragFromIndex = null;
    markScenarioBuildDirty();
    if (config.onChange) config.onChange();
    renderScenarioBuildPanel();
  });
  
  const handleEl = document.createElement("span");
  handleEl.className = "scenariobuild-drag-handle";
  handleEl.textContent = "☰";
  handleEl.draggable = true;
  handleEl.addEventListener("dragstart", (event) => {
    event.dataTransfer.effectAllowed = "move";
    if (event.dataTransfer.setDragImage) event.dataTransfer.setDragImage(row, 0, 0);
    row.classList.add("scenariobuild-dragging");
    scenarioEntityDragFromIndex = index;
  });
  handleEl.addEventListener("dragend", () => row.classList.remove("scenariobuild-dragging"));
  row.appendChild(handleEl);
  
  const idEl = document.createElement("span");
  idEl.className = "scenariobuild-chapter-number";
  idEl.style.fontSize = "10px";
  idEl.style.wordBreak = "break-all";
  idEl.style.whiteSpace = "pre-line";
  idEl.textContent = `ID:\n${entity.id}${entity.builtin ? "\n（組み込み）" : ""}`;
  
  const infoEl = document.createElement("div");
  infoEl.className = "scenariobuild-chapter-info";
  
  // ★詳細編集画面を使うカテゴリ（敵・ボス・アイテム）は、一覧では名前だけ出して、
  //   細かい項目は「編集」ボタンを押した先の専用画面にまとめる
  if (config.useDetailEditor) {
    const nameEl = document.createElement("p");
    nameEl.className = "scenariobuild-title-input";
    nameEl.style.background = "none";
    nameEl.style.border = "none";
    nameEl.textContent = entity.name || "（名前未設定）";
    infoEl.appendChild(nameEl);
    
    const buttonsEl = document.createElement("div");
    buttonsEl.className = "scenariobuild-chapter-buttons";
    const editBtn = document.createElement("button");
    editBtn.className = "devmode-btn";
    editBtn.textContent = "編集";
    editBtn.onclick = (event) => {
      event.stopPropagation();
      scenarioBuildEditingEntityRef = { category: config.category, id: entity.id };
      scenarioBuildMainView = "entityEditor";
      renderScenarioBuildPanel();
    };
    buttonsEl.appendChild(editBtn);
    
    row.appendChild(idEl);
    row.appendChild(infoEl);
    row.appendChild(buttonsEl);
    return row;
  }
  
  // ★要望対応：項目数が多くなりがちな一覧（実績管理など）で、config.collapsible === true が
  //   指定されていれば、名前だけの見出し行をクリックして編集欄を開閉できるようにする
  if (config.collapsible) {
    const isExpanded = scenarioBuildExpandedEntityIds.has(entity.id);
    const headerRow = document.createElement("div");
    headerRow.className = "scenariobuild-collapsible-header";
    const toggleIcon = document.createElement("span");
    toggleIcon.className = "scenariobuild-collapsible-toggle-icon";
    toggleIcon.textContent = isExpanded ? "▼" : "▶";
    headerRow.appendChild(toggleIcon);
    const summaryEl = document.createElement("span");
    summaryEl.className = "scenariobuild-collapsible-summary";
    summaryEl.textContent = config.getEntitySummary ? config.getEntitySummary(entity) : (entity.name || "（名前未設定）");
    headerRow.appendChild(summaryEl);
    headerRow.onclick = (event) => {
      event.stopPropagation();
      if (isExpanded) scenarioBuildExpandedEntityIds.delete(entity.id);
      else scenarioBuildExpandedEntityIds.add(entity.id);
      renderScenarioBuildPanel();
    };
    infoEl.appendChild(headerRow);
    if (isExpanded) appendEntityFieldInputs(config, entity, infoEl);
  } else {
    appendEntityFieldInputs(config, entity, infoEl);
  }
  
  if (config.showLevelPreview) {
    infoEl.appendChild(buildMonsterLevelPreview(entity));
  }
  
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "devmode-btn devmode-btn-danger";
  deleteBtn.textContent = "削除";
  deleteBtn.onclick = async (event) => {
    event.stopPropagation();
    const ok = await showGameConfirm(`「${entity.name || entity.id}」を削除しますか？`);
    if (!ok) return;
    pushUndoSnapshot();
    if (entity.builtin && config.category && !scenarioProject.deletedBuiltinIds[config.category].includes(entity.id)) {
      scenarioProject.deletedBuiltinIds[config.category].push(entity.id); // ★これが無いと、次回開いた時に自動で復活してしまう
    }
    config.getList().splice(index, 1);
    if (config.onDelete) config.onDelete(entity);
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  
  const buttonsEl = document.createElement("div");
  buttonsEl.className = "scenariobuild-chapter-buttons";
  
  if (entity.builtin && config.getDefaultFromMaster) {
    const resetBtn = document.createElement("button");
    resetBtn.className = "devmode-btn";
    resetBtn.textContent = "既定値に戻す";
    resetBtn.title = "enemy.js/boss.jsの元の値に戻します（BGM設定などが崩れてしまった時に）";
    resetBtn.onclick = async (event) => {
      event.stopPropagation();
      const defaults = config.getDefaultFromMaster(entity.id);
      if (!defaults) return;
      const ok = await showGameConfirm(`「${entity.name || entity.id}」を元の設定に戻しますか？`);
      if (!ok) return;
      pushUndoSnapshot();
      Object.assign(entity, defaults);
      markScenarioBuildDirty();
      if (config.onChange) config.onChange();
      renderScenarioBuildPanel();
    };
    buttonsEl.appendChild(resetBtn);
  }
  
  buttonsEl.appendChild(deleteBtn);
  
  row.appendChild(idEl);
  row.appendChild(infoEl);
  row.appendChild(buttonsEl);
  return row;
}

// ===================================================================
// ===== サブ画面：エンディング一覧（全チャプターのending／gameoverブロックを横断表示） =====
// ===================================================================
function renderEndingListManager(container) {
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "全ての話にある「エンディング」「ゲームオーバー」ブロックを、ここでまとめて確認・編集できます（ゲームオーバーも一種のバッドエンディングとして扱っています）。詳しい分岐設定はブロックエディタ側で行ってください。";
  container.appendChild(introEl);
  
  const entries = [];
  scenarioProject.chapters.forEach(chapter => {
    (chapter.blocks || []).forEach((block, blockIndex) => {
      if (block.type === "ending" || block.type === "gameover") {
        entries.push({ chapter, block, blockIndex });
      }
    });
  });
  
  if (entries.length === 0) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "devmode-note";
    emptyEl.textContent = "まだエンディング・ゲームオーバーのブロックがありません。";
    container.appendChild(emptyEl);
    return;
  }
  
  entries.forEach(entry => container.appendChild(buildEndingListCard(entry)));
}

function buildEndingListCard(entry) {
  const { chapter, block, blockIndex } = entry;
  const persist = () => markScenarioBuildDirty();
  
  const row = document.createElement("div");
  row.className = "scenariobuild-chapter-row";
  
  const numberEl = document.createElement("span");
  numberEl.className = "scenariobuild-chapter-number";
  numberEl.textContent = block.type === "gameover" ? "ゲームオーバー" : { bad: "バッドエンド", true: "トゥルーエンド", happy: "ハッピーエンド" }[block.endingType] || "エンディング";
  
  const infoEl = document.createElement("div");
  infoEl.className = "scenariobuild-chapter-info";
  
  const chapterLabel = document.createElement("p");
  chapterLabel.className = "devmode-note scenariobuild-condition";
  chapterLabel.textContent = `${chapter.title}（${blockIndex + 1}番目のブロック）`;
  infoEl.appendChild(chapterLabel);
  
  if (block.type === "gameover") {
    const textArea = document.createElement("textarea");
    textArea.className = "scenariobuild-textarea";
    textArea.placeholder = "表示するメッセージ";
    textArea.value = block.message;
    textArea.onchange = () => { block.message = textArea.value; persist(); };
    infoEl.appendChild(textArea);
    
    const endingNameInput = document.createElement("input");
    endingNameInput.type = "text";
    endingNameInput.className = "scenariobuild-title-input";
    endingNameInput.placeholder = "エンディング名（任意。例：田中ソード）";
    endingNameInput.value = block.endingName || "";
    endingNameInput.onchange = () => { block.endingName = endingNameInput.value; persist(); };
    infoEl.appendChild(endingNameInput);
  } else {
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "scenariobuild-title-input";
    titleInput.placeholder = "エンディングタイトル";
    titleInput.value = block.title;
    titleInput.onchange = () => { block.title = titleInput.value; persist(); };
    infoEl.appendChild(titleInput);
    
    const toggleRow = document.createElement("div");
    toggleRow.className = "scenariobuild-condition-row";
    const endrollToggle = document.createElement("input");
    endrollToggle.type = "checkbox";
    endrollToggle.checked = block.endrollEnabled !== false;
    endrollToggle.onchange = () => { block.endrollEnabled = endrollToggle.checked; persist(); };
    toggleRow.appendChild(endrollToggle);
    toggleRow.appendChild(labelSpan("エンドロールを流す"));
    infoEl.appendChild(toggleRow);
  }
  
  const buttonsEl = document.createElement("div");
  buttonsEl.className = "scenariobuild-chapter-buttons";
  
  const openBtn = document.createElement("button");
  openBtn.className = "devmode-btn";
  openBtn.textContent = "この話のエディタで開く";
  openBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildEditingChapterId = chapter.id;
    scenarioBuildMainView = "editor";
    renderScenarioBuildPanel();
  };
  buttonsEl.appendChild(openBtn);
  
  row.appendChild(numberEl);
  row.appendChild(infoEl);
  row.appendChild(buttonsEl);
  return row;
}

// ===================================================================
// ===== サブ画面：データ管理（JSON出力・読込） =====

// ★要望対応：メンテナンスモード。ここでのON/OFFだけは他の項目と違い、JSファイル書き出しを介さず
//   maintenance.jsを通じてFirestore（クラウド）へ直接保存し、切り替えた瞬間からサイト全体に反映される。
//   書き込みはFirestore側のセキュリティルールで開発者アカウントのみに制限する想定のため、
//   ここではisDeveloperAccount()でボタンの見た目を制御しているだけで、実際の安全性はルール側が担保する。
function renderMaintenanceModeManager(container) {
  const header = document.createElement("h4");
  header.className = "scenariobuild-subheading";
  header.textContent = "🚧 メンテナンスモード";
  container.appendChild(header);
  
  const note = document.createElement("p");
  note.className = "devmode-note";
  note.textContent = "ONの間にプレイヤーがセーブデータをロードすると、画面が真っ黒になり「ただ今メンテナンス中です」と表示されて操作できなくなります（ログインボーナスだけは黒画面の手前に表示され、通常通り受け取れます）。開発者アカウントでログイン中は対象外で、メンテナンス中でも通常通りプレイ・動作確認できます。JSファイルの書き出しは不要で、切り替えた瞬間からサイト全体に反映されます。";
  container.appendChild(note);
  
  const statusRow = document.createElement("div");
  statusRow.className = "scenariobuild-condition-row";
  statusRow.appendChild(labelSpan("現在の状態："));
  const statusValue = document.createElement("span");
  statusValue.textContent = "確認中…";
  statusRow.appendChild(statusValue);
  container.appendChild(statusRow);
  
  const toggleBtn = document.createElement("button");
  toggleBtn.className = "devmode-btn devmode-btn-danger";
  toggleBtn.textContent = "確認中…";
  toggleBtn.disabled = true;
  container.appendChild(toggleBtn);
  
  const permissionNote = document.createElement("p");
  permissionNote.className = "devmode-note";
  container.appendChild(permissionNote);
  
  // ★取得した状態に合わせて、状態表示・ボタンの文言・押せるかどうかを更新する
  const refreshUi = async (enabled) => {
    if (typeof authReadyPromise !== "undefined") await authReadyPromise; // auth.js：ログイン状態が確定してから表示を決める
    const currentEnabled = typeof enabled === "boolean" ? enabled : await fetchMaintenanceModeEnabled();
    const canToggle = typeof isDeveloperAccount === "function" && isDeveloperAccount(); // auth.js
    statusValue.textContent = currentEnabled ? "🔴 メンテナンス中（ON）" : "🟢 通常稼働中（OFF）";
    toggleBtn.disabled = !canToggle;
    toggleBtn.textContent = currentEnabled ? "メンテナンスモードをOFFにする" : "メンテナンスモードをONにする";
    permissionNote.textContent = canToggle ? "" : "※この切り替えはGoogleでログインした開発者アカウントのみ実行できます。";
    
    toggleBtn.onclick = async (event) => {
      event.stopPropagation();
      if (!canToggle) return;
      const nextEnabled = !currentEnabled;
      const confirmMessage = nextEnabled
        ? "メンテナンスモードをONにしますか？\n以後、セーブデータをロードした全プレイヤーの画面が真っ黒になり、操作できなくなります。"
        : "メンテナンスモードをOFFにしますか？";
      const ok = (typeof showGameConfirm === "function") ? await showGameConfirm(confirmMessage) : true; // mainfunc.js
      if (!ok) return;
      
      toggleBtn.disabled = true;
      toggleBtn.textContent = "更新中…";
      const success = (typeof setMaintenanceModeEnabled === "function") ? await setMaintenanceModeEnabled(nextEnabled) : false; // maintenance.js
      if (success) {
        if (typeof showGameAlert === "function") await showGameAlert(nextEnabled ? "メンテナンスモードをONにしました。" : "メンテナンスモードをOFFにしました。");
        refreshUi(nextEnabled);
      } else {
        if (typeof showGameAlert === "function") await showGameAlert("更新に失敗しました。通信状態やログイン状態（開発者アカウントか）を確認してもう一度お試しください。");
        refreshUi(currentEnabled); // ★失敗時は元の状態のまま表示し直す
      }
    };
  };
  
  window.refreshMaintenanceModeManagerUi = refreshUi;
  refreshUi(false); // ★Firestoreへの問い合わせが終わるまでの仮表示（OFF扱い）
  if (typeof fetchMaintenanceModeEnabled === "function") {
    fetchMaintenanceModeEnabled().then((enabled) => refreshUi(enabled)); // maintenance.js
  }
}
// ===================================================================
// ★要望対応：ログインボーナス。1〜7日目、それぞれの報酬（陳・経験値・アイテム複数可＋個数）を編集する
function renderLoginBonusManager(container) {
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "セーブデータをロードした日に応じて、1〜7日目の報酬をポップアップで受け取れます。前回ロードした日の翌日以降に開けば連続記録が進み、1日でも空くと1日目からやり直しになります。7日目の翌日はまた1日目に戻ってループします。";
  container.appendChild(introEl);
  
  if (!Array.isArray(scenarioProject.loginBonusDays)) scenarioProject.loginBonusDays = [];
  for (let day = 0; day < 7; day++) {
    if (!scenarioProject.loginBonusDays[day]) scenarioProject.loginBonusDays[day] = { gold: 0, exp: 0, items: [] };
  }
  
  scenarioProject.loginBonusDays.forEach((dayData, dayIndex) => {
    if (!Array.isArray(dayData.items)) dayData.items = [];
    
    const dayBox = document.createElement("div");
    dayBox.className = "scenariobuild-entity-card";
    
    const dayHeader = document.createElement("h4");
    dayHeader.className = "scenariobuild-subheading";
    dayHeader.textContent = `${dayIndex + 1}日目` + (dayIndex === 6 ? "（この後は1日目に戻ります）" : "");
    dayBox.appendChild(dayHeader);
    
    const goldRow = document.createElement("div");
    goldRow.className = "scenariobuild-condition-row";
    goldRow.appendChild(labelSpan("陳（お金）："));
    const goldInput = document.createElement("input");
    goldInput.type = "number";
    goldInput.min = "0";
    goldInput.className = "scenariobuild-condition-input";
    goldInput.value = dayData.gold || 0;
    goldInput.onchange = () => { dayData.gold = Math.max(0, Number(goldInput.value) || 0); markScenarioBuildDirty(); };
    goldRow.appendChild(goldInput);
    dayBox.appendChild(goldRow);
    
    const expRow = document.createElement("div");
    expRow.className = "scenariobuild-condition-row";
    expRow.appendChild(labelSpan("経験値："));
    const expInput = document.createElement("input");
    expInput.type = "number";
    expInput.min = "0";
    expInput.className = "scenariobuild-condition-input";
    expInput.value = dayData.exp || 0;
    expInput.onchange = () => { dayData.exp = Math.max(0, Number(expInput.value) || 0); markScenarioBuildDirty(); };
    expRow.appendChild(expInput);
    dayBox.appendChild(expRow);
    
    const itemsHeader = document.createElement("div");
    itemsHeader.className = "scenariobuild-condition-row";
    itemsHeader.appendChild(labelSpan("アイテム："));
    dayBox.appendChild(itemsHeader);
    
    dayData.items.forEach((itemEntry, itemIndex) => {
      const itemRow = document.createElement("div");
      itemRow.className = "scenariobuild-condition-row";
      
      const itemInput = document.createElement("input");
      itemInput.type = "text";
      itemInput.className = "scenariobuild-title-input";
      itemInput.placeholder = "アイテムID";
      itemInput.setAttribute("list", "scenariobuild-item-datalist");
      itemInput.value = itemEntry.itemId || "";
      itemInput.onchange = () => { itemEntry.itemId = itemInput.value.trim(); markScenarioBuildDirty(); };
      itemRow.appendChild(itemInput);
      
      itemRow.appendChild(labelSpan("個数："));
      const qtyInput = document.createElement("input");
      qtyInput.type = "number";
      qtyInput.min = "1";
      qtyInput.className = "scenariobuild-condition-input";
      qtyInput.value = itemEntry.qty != null ? itemEntry.qty : 1;
      qtyInput.onchange = () => { itemEntry.qty = Math.max(1, Number(qtyInput.value) || 1); markScenarioBuildDirty(); };
      itemRow.appendChild(qtyInput);
      
      const removeItemBtn = document.createElement("button");
      removeItemBtn.className = "devmode-btn devmode-btn-danger";
      removeItemBtn.textContent = "×";
      removeItemBtn.onclick = (event) => {
        event.stopPropagation();
        dayData.items.splice(itemIndex, 1);
        markScenarioBuildDirty();
        renderScenarioBuildPanel();
      };
      itemRow.appendChild(removeItemBtn);
      dayBox.appendChild(itemRow);
    });
    
    const addItemBtn = document.createElement("button");
    addItemBtn.className = "devmode-btn";
    addItemBtn.textContent = "＋アイテムを追加";
    addItemBtn.onclick = (event) => {
      event.stopPropagation();
      dayData.items.push({ itemId: "", qty: 1 });
      markScenarioBuildDirty();
      renderScenarioBuildPanel();
    };
    dayBox.appendChild(addItemBtn);
    
    container.appendChild(dayBox);
  });
}

// ★要望対応：会話AI設定。パーティ名・主人公の二つ名や性格、各仲間の二つ名や性格を編集する
//   （「仲間との会話」機能で、まとめAIが会話AIに渡す設定資料の材料になる）
function renderCompanionChatSettingsManager(container) {
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "「仲間との会話」機能で使う、パーティ名・二つ名・性格や口調の指針を設定します。ここで書いた内容は会話AIがキャラクターになりきる時の参考にされます（空欄でも動作しますが、埋めておくほどキャラクターらしい会話になります）。";
  container.appendChild(introEl);
  
  const ccs = scenarioProject.companionChatSettings;
  
  const partyCard = document.createElement("div");
  partyCard.className = "scenariobuild-entity-card";
  const partyHeader = document.createElement("h4");
  partyHeader.className = "scenariobuild-subheading";
  partyHeader.textContent = "パーティ全体";
  partyCard.appendChild(partyHeader);
  
  const partyNameRow = document.createElement("div");
  partyNameRow.className = "scenariobuild-condition-row";
  partyNameRow.appendChild(labelSpan("パーティ名："));
  const partyNameInput = document.createElement("input");
  partyNameInput.type = "text";
  partyNameInput.className = "scenariobuild-title-input";
  partyNameInput.placeholder = "例：夜明けの旅団";
  partyNameInput.value = ccs.partyName || "";
  partyNameInput.onchange = () => { ccs.partyName = partyNameInput.value.trim(); markScenarioBuildDirty(); };
  partyNameRow.appendChild(partyNameInput);
  partyCard.appendChild(partyNameRow);
  container.appendChild(partyCard);
  
  const protagonistCard = document.createElement("div");
  protagonistCard.className = "scenariobuild-entity-card";
  const protagonistHeader = document.createElement("h4");
  protagonistHeader.className = "scenariobuild-subheading";
  protagonistHeader.textContent = "主人公";
  protagonistCard.appendChild(protagonistHeader);
  
  const protagonistEpithetRow = document.createElement("div");
  protagonistEpithetRow.className = "scenariobuild-condition-row";
  protagonistEpithetRow.appendChild(labelSpan("二つ名："));
  const protagonistEpithetInput = document.createElement("input");
  protagonistEpithetInput.type = "text";
  protagonistEpithetInput.className = "scenariobuild-title-input";
  protagonistEpithetInput.value = ccs.protagonistEpithet || "";
  protagonistEpithetInput.onchange = () => { ccs.protagonistEpithet = protagonistEpithetInput.value.trim(); markScenarioBuildDirty(); };
  protagonistEpithetRow.appendChild(protagonistEpithetInput);
  protagonistCard.appendChild(protagonistEpithetRow);
  
  const protagonistPersonalityArea = document.createElement("textarea");
  protagonistPersonalityArea.className = "scenariobuild-textarea";
  protagonistPersonalityArea.placeholder = "性格・口調の指針（任意。例：普段は軽口を叩くが、仲間には誰よりも義理堅い）";
  protagonistPersonalityArea.value = ccs.protagonistPersonality || "";
  protagonistPersonalityArea.onchange = () => { ccs.protagonistPersonality = protagonistPersonalityArea.value; markScenarioBuildDirty(); };
  protagonistCard.appendChild(protagonistPersonalityArea);
  container.appendChild(protagonistCard);
  
  const companions = scenarioProject.companions || [];
  if (companions.length === 0) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "devmode-note";
    emptyEl.textContent = "「仲間編集」タブで仲間を登録すると、ここに一覧が表示されます。";
    container.appendChild(emptyEl);
    return;
  }
  
  companions.forEach(companion => {
    if (!ccs.companions[companion.id]) ccs.companions[companion.id] = { epithet: "", personality: "" };
    const entry = ccs.companions[companion.id];
    
    const card = document.createElement("div");
    card.className = "scenariobuild-entity-card";
    const header = document.createElement("h4");
    header.className = "scenariobuild-subheading";
    header.textContent = companion.name || "（名前未設定）";
    card.appendChild(header);
    
    const epithetRow = document.createElement("div");
    epithetRow.className = "scenariobuild-condition-row";
    epithetRow.appendChild(labelSpan("二つ名："));
    const epithetInput = document.createElement("input");
    epithetInput.type = "text";
    epithetInput.className = "scenariobuild-title-input";
    epithetInput.value = entry.epithet || "";
    epithetInput.onchange = () => { entry.epithet = epithetInput.value.trim(); markScenarioBuildDirty(); };
    epithetRow.appendChild(epithetInput);
    card.appendChild(epithetRow);
    
    const personalityArea = document.createElement("textarea");
    personalityArea.className = "scenariobuild-textarea";
    personalityArea.placeholder = "性格・口調の指針（任意）";
    personalityArea.value = entry.personality || "";
    personalityArea.onchange = () => { entry.personality = personalityArea.value; markScenarioBuildDirty(); };
    card.appendChild(personalityArea);
    
    container.appendChild(card);
  });
}

function renderDataManager(container) {
  renderMaintenanceModeManager(container); // ★要望対応：メンテナンスモード（Firestoreに直接反映）
  
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "シナリオデータ（話・キャラ・敵・ボス・アイテム）は、変更するたびにブラウザへ自動保存されています。他の端末に移したり、バックアップを取りたい時はJSONで書き出し・読み込みができます。";
  container.appendChild(introEl);
  
  const creditsHeader = document.createElement("h4");
  creditsHeader.className = "scenariobuild-subheading";
  creditsHeader.textContent = "クレジット（便利タブから見られる内容）";
  container.appendChild(creditsHeader);
  const creditsNote = document.createElement("p");
  creditsNote.className = "devmode-note";
  creditsNote.textContent = "改行を含む自由な文章として編集できます。空欄のままだと仮の文面が表示されます。";
  container.appendChild(creditsNote);
  const creditsTextarea = document.createElement("textarea");
  creditsTextarea.className = "scenariobuild-textarea";
  creditsTextarea.rows = 8;
  creditsTextarea.placeholder = DEFAULT_CREDITS_TEXT;
  creditsTextarea.value = scenarioProject.creditsText || "";
  creditsTextarea.onchange = () => { scenarioProject.creditsText = creditsTextarea.value; markScenarioBuildDirty(); };
  container.appendChild(creditsTextarea);
  
  const introHeader = document.createElement("h4");
  introHeader.className = "scenariobuild-subheading";
  introHeader.textContent = "オープニングの注意書き（「はじめから」を選んだ直後に出る文章）";
  container.appendChild(introHeader);
  const introNote = document.createElement("p");
  introNote.className = "devmode-note";
  introNote.textContent = "改行を含む自由な文章として編集できます。空欄のままだと仮の文面（「このゲームはクソゲーです…」）が表示されます。";
  container.appendChild(introNote);
  const introTextarea = document.createElement("textarea");
  introTextarea.className = "scenariobuild-textarea";
  introTextarea.rows = 6;
  introTextarea.placeholder = (typeof DEFAULT_INTRO_SPLASH_TEXT !== "undefined") ? DEFAULT_INTRO_SPLASH_TEXT : "";
  introTextarea.value = scenarioProject.introText || "";
  introTextarea.onchange = () => { scenarioProject.introText = introTextarea.value; markScenarioBuildDirty(); };
  container.appendChild(introTextarea);
  
  const exportBtn = document.createElement("button");
  exportBtn.className = "devmode-btn";
  exportBtn.textContent = "JSONを書き出す（ダウンロード）";
  exportBtn.onclick = (event) => {
    event.stopPropagation();
    exportScenarioProjectAsJson();
  };
  container.appendChild(exportBtn);
  
  const importLabel = document.createElement("label");
  importLabel.className = "devmode-btn";
  importLabel.style.display = "inline-block";
  importLabel.textContent = "JSONを読み込む";
  const importInput = document.createElement("input");
  importInput.type = "file";
  importInput.accept = "application/json";
  importInput.style.display = "none";
  importInput.onchange = (event) => {
    const file = event.target.files[0];
    if (file) importScenarioProjectFromFile(file);
    importInput.value = "";
  };
  importLabel.appendChild(importInput);
  container.appendChild(importLabel);
  
  const jsExportNote = document.createElement("p");
  jsExportNote.className = "devmode-note";
  jsExportNote.textContent = "ブラウザの保存データ（localStorage）に頼らず、いつでも同じ内容でゲームが動くようにしたい場合は、こちらでJSファイルとして書き出してください。「シナリオのみ」＝話・キャラ、「ゲームの基本設定のみ」＝敵・ボス・アイテム・技・仲間・職業ステータス・施設・BGM・マップ、の2つに分かれています。書き出したファイルを index.html の <script src=\"battle.js\"> より後ろに <script>タグで追加すると、そのファイルの内容が最初から組み込まれた状態でゲームが起動します。一度取り込んだファイルは、次にまた書き出し直して新しいファイルに差し替えるまで、ブラウザ側での編集がそのまま優先されます（毎回上書きされて編集内容が消えることはありません）。";
  container.appendChild(jsExportNote);
  
  const jsExportBtn = document.createElement("button");
  jsExportBtn.className = "devmode-btn";
  jsExportBtn.textContent = "シナリオのみ JSファイルで出力（話・キャラ）";
  jsExportBtn.onclick = (event) => {
    event.stopPropagation();
    exportScenarioOnlyAsJsFile();
  };
  container.appendChild(jsExportBtn);
  
  const jsExportSettingsBtn = document.createElement("button");
  jsExportSettingsBtn.className = "devmode-btn";
  jsExportSettingsBtn.textContent = "ゲームの基本設定のみ JSファイルで出力（敵・ボス・アイテム・技・仲間・職業・施設・BGM・マップ）";
  jsExportSettingsBtn.onclick = (event) => {
    event.stopPropagation();
    exportGameSettingsAsJsFile();
  };
  container.appendChild(jsExportSettingsBtn);
  
  const statsEl = document.createElement("p");
  statsEl.className = "devmode-note";
  statsEl.textContent = `現在：話${scenarioProject.chapters.length}件／キャラ${scenarioProject.characters.length}件／敵${scenarioProject.enemies.length}件／ボス${scenarioProject.bosses.length}件／アイテム${scenarioProject.items.length}件／魚${(scenarioProject.fishItems || []).length}件／技${scenarioProject.skills.length}件／仲間${scenarioProject.companions.length}件／マップ${scenarioProject.mapAreas.length}件／フラグ${scenarioProject.flagDefs.length}件／変数${scenarioProject.variableDefs.length}件／レシピ${scenarioProject.recipes.length}件／ランダム名前${scenarioProject.randomNamePool.length}件`;
  container.appendChild(statsEl);
}

// ★ダウンロード処理の共通部分（テキスト内容→ファイルとして書き出す）
function downloadScenarioBuildTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ★「シナリオのみ」（話・キャラ）を書き出す。中身はJSONそのままなので、
//   将来スキル同様「話のブロック」以外の要素が増えても、そのまま一緒に書き出される
function exportScenarioOnlyAsJsFile() {
  const data = {
    version: Date.now(), // ★書き出すたびに新しいバージョンとして扱われ、次に読み込んだ時に上書き取り込みされる
    chapters: scenarioProject.chapters,
    chapterArcs: scenarioProject.chapterArcs || [],
    characters: scenarioProject.characters,
    flagDefs: scenarioProject.flagDefs,
    variableDefs: scenarioProject.variableDefs,
    deletedBuiltinIds: {
      chapters: scenarioProject.deletedBuiltinIds.chapters || [],
      characters: scenarioProject.deletedBuiltinIds.characters || []
    }
  };
  const lines = [];
  lines.push("// scenario_only_data.js");
  lines.push("// ★シナリオビルドの「データ管理」タブから書き出された、シナリオ（話・キャラ）専用のファイルです。");
  lines.push("// index.html の <script src=\"battle.js\"> より後ろに");
  lines.push("// <script src=\"scenario_only_data.js\"></script> として追加してください。");
  lines.push("// ★書き出し直すたびに中のversionが更新されるので、差し替えれば自動的に新しい内容が反映されます。");
  lines.push(`window.SCENARIOBUILD_IMPORTED_SCENARIO_DATA = ${JSON.stringify(data, null, 2)};`);
  downloadScenarioBuildTextFile("scenario_only_data.js", lines.join("\n"));
}

// ★「ゲームの基本設定のみ」（敵・ボス・アイテム・技・仲間・職業ステータス・施設・BGM・マップ）を書き出す
function exportGameSettingsAsJsFile() {
  const data = {
    version: Date.now(),
    enemies: scenarioProject.enemies,
    bosses: scenarioProject.bosses,
    items: scenarioProject.items,
    fishItems: scenarioProject.fishItems, // ★要望対応：魚管理タブ
    skills: scenarioProject.skills,
    statusAilments: scenarioProject.statusAilments,
    statusBuffs: scenarioProject.statusBuffs,
    companions: scenarioProject.companions,
    quests: scenarioProject.quests,
    achievements: scenarioProject.achievements, // ★実績管理タブ（要望対応）
    tutorials: scenarioProject.tutorials,
    classStats: scenarioProject.classStats,
    facilities: scenarioProject.facilities,
    portraitCharacters: scenarioProject.portraitCharacters,
    recipes: scenarioProject.recipes,
    randomNamePool: scenarioProject.randomNamePool, // ★要望対応：ランダム名前管理タブ
    elementDefs: scenarioProject.elementDefs, // ★要望対応：属性管理タブ
    elementMatchups: scenarioProject.elementMatchups,
    bgmTracks: scenarioProject.bgmTracks,
    mapAreas: scenarioProject.mapAreas,
    mapEdges: scenarioProject.mapEdges,
    trialGuardianOverrides: scenarioProject.trialGuardianOverrides,
    fameThresholds: scenarioProject.fameThresholds,
    loginBonusDays: scenarioProject.loginBonusDays, // ★要望対応：ログインボーナス
    companionChatSettings: scenarioProject.companionChatSettings, // ★要望対応：会話AI設定
    creditsText: scenarioProject.creditsText || "", // ★以前はここに無く、JSファイル出力するとクレジットの文面だけ引き継がれない不具合があった
    introText: scenarioProject.introText || "", // ★オープニングの注意書き（titlescreen.jsのDEFAULT_INTRO_SPLASH_TEXT）
    deletedBuiltinIds: {
      enemies: scenarioProject.deletedBuiltinIds.enemies || [],
      bosses: scenarioProject.deletedBuiltinIds.bosses || [],
      items: scenarioProject.deletedBuiltinIds.items || [],
      bgmTracks: scenarioProject.deletedBuiltinIds.bgmTracks || [],
      mapAreas: scenarioProject.deletedBuiltinIds.mapAreas || [],
      skills: scenarioProject.deletedBuiltinIds.skills || [],
      companions: scenarioProject.deletedBuiltinIds.companions || [],
      quests: scenarioProject.deletedBuiltinIds.quests || [],
      classes: scenarioProject.deletedBuiltinIds.classes || []
    }
  };
  const lines = [];
  lines.push("// game_settings_data.js");
  lines.push("// ★シナリオビルドの「データ管理」タブから書き出された、ゲームの基本設定");
  lines.push("//   （敵・ボス・アイテム・技・仲間・職業ステータス・施設・BGM・マップ）専用のファイルです。");
  lines.push("// index.html の <script src=\"battle.js\"> より後ろに");
  lines.push("// <script src=\"game_settings_data.js\"></script> として追加してください。");
  lines.push("// ★書き出し直すたびに中のversionが更新されるので、差し替えれば自動的に新しい内容が反映されます。");
  lines.push(`window.SCENARIOBUILD_IMPORTED_SETTINGS_DATA = ${JSON.stringify(data, null, 2)};`);
  downloadScenarioBuildTextFile("game_settings_data.js", lines.join("\n"));
}

// ★以前は敵・ボス・アイテム・BGM・話だけを1つのファイルにまとめて出力していたが、
//   技・仲間・職業ステータス・施設・マップなどが含まれず、また話とその他が同じファイルに
//   混ざっていて使いづらかったため、exportScenarioOnlyAsJsFile / exportGameSettingsAsJsFile の
//   2つに分割した（データ管理タブのボタンもそちらに差し替え済み）。

function exportScenarioProjectAsJson() {
  const json = JSON.stringify(scenarioProject, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "scenario_data.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importScenarioProjectFromFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.chapters)) throw new Error("形式が正しくありません");
      const ok = await showGameConfirm("読み込むと、今のシナリオデータは上書きされます。よろしいですか？");
      if (!ok) return;
      scenarioProject = parsed;
      normalizeScenarioProject();
      markScenarioBuildDirty();
      ensureCustomMonstersRegistered();
      renderScenarioBuildPanel();
    } catch (e) {
      console.error("シナリオJSONの読み込みに失敗しました", e);
      await showGameAlert("読み込みに失敗しました。ファイルの形式を確認してください。"); // mainfunc.js
    }
  };
  reader.readAsText(file);
}

// ===================================================================
// ===== テストプレイ（実際のゲームエンジンでブロックを実行する） =====
// ===================================================================
// ===================================================================
// ===== 本編での上書き実行（第一話・第二話に独自のブロックがあれば、そちらを本編として実行する） =====
// ===================================================================

// ★指定した組み込み話（builtin_chapter1 / builtin_chapter2）にブロックが1つでもあれば、
//   そちらを実際のゲーム進行として実行してtrueを返す。無ければ何もせずfalseを返す
//   （呼び出し元のscript.js/town.jsは、falseの時だけ元の本編（scenario.js/scenario2.js）を実行する）
// ★話の解放条件（第N話クリア／ランク／進行度／経過日数／フラグ）を全て満たしているか判定する。
//   設定されていない条件は無視され、設定されている条件は全て満たす必要がある（AND）
// ★以前はここに「スキル全体の威力倍率(getSkillPowerScale)」があったが、
//   威力(skill.power)がそのままダメージ量になる方式に変わったため廃止した

// ★今、画面に出すべき「目標（タスク）」の文章を返す。一覧の順で見て、まだクリアしておらず、
//   まだ始まってもおらず、かつ「一つ前の話」をクリア済みである自作の話のうち、
//   目標テキストが設定されている一番手前のものを返す（無ければ null）。
//   ★以前は開始条件を見ずに返していたため、まだ前の話をクリアしていない段階でも
//     次の話の目標が表示されてしまっていた
//   ★さらに以前は「started」を見ていなかったため、次の話が始まった後もクリアするまでの間
//     ずっと目標表示が出たままになっていた（「一度消えてもまた出てくる」ように見える不具合の原因）
//   ★その後、判定にevaluateChapterUnlockConditions()（ランク・進行度・経過日数・フラグ等、
//     話が実際に始まる条件を全て含む）を流用していたため、前の話が終わった直後でも、
//     それらの数値条件を満たすまで目標が何も表示されなくなってしまっていた（今回の修正箇所）。
//     目標表示は「前の話（requiredChapterId）をクリアしているか」だけを見るようにし、
//     実際に話が自動的に始まるかどうかの判定とは切り離した
function getCurrentChapterObjectiveText() {
  if (typeof scenarioProject === "undefined" || !Array.isArray(scenarioProject.chapters)) return null;
  const chapter = scenarioProject.chapters.find(c => !isChapterEffectivelyCleared(c) && !c.started && c.objectiveText && chapterPrecedingChapterCleared(c));
  return chapter ? chapter.objectiveText : null;
}

// ★目標表示専用の軽い判定：「実装済み」チェックと、指定していれば「一つ前の話」がクリア済みかどうかだけを見る
function chapterPrecedingChapterCleared(chapter) {
  if (chapter.enabled === false) return false; // ★「実装済み」チェックがオフの話は、実際のプレイには一切出てこない（編集・テストプレイは可能）
  if (chapter.requiredChapterId) {
    const req = scenarioProject.chapters.find(c => c.id === chapter.requiredChapterId);
    if (!req || !isChapterEffectivelyCleared(req)) return false;
  }
  return true;
}

function evaluateChapterUnlockConditions(chapter) {
  if (chapter.enabled === false) return false; // ★「実装済み」チェックがオフの話は、実際のプレイには一切出てこない（編集・テストプレイは可能）
  if (chapter.requiredChapterId) {
    const req = scenarioProject.chapters.find(c => c.id === chapter.requiredChapterId);
    if (!req || !isChapterEffectivelyCleared(req)) return false;
  }
  if (chapter.requiredRank && typeof rankIndex === "function" && typeof player !== "undefined") {
    if (rankIndex(player.rank) < rankIndex(chapter.requiredRank)) return false;
  }
  if (typeof chapter.requiredProgress === "number" && chapter.requiredProgress > 0 && typeof player !== "undefined") {
    if ((player.progressPoints || 0) < chapter.requiredProgress) return false;
  }
  if (typeof chapter.requiredDays === "number" && chapter.requiredDays > 0 && typeof player !== "undefined") {
    if ((player.daysSinceTransfer || 0) < chapter.requiredDays) return false;
  }
  if (chapter.requiredFlag) {
    if (!(typeof scenarioFlags !== "undefined" && scenarioFlags[chapter.requiredFlag])) return false;
  }
  return true;
}

// ===== IFブロック：値の解決・比較・条件評価 =====
// ★kind: "flag"（フラグの値） | "level"（主人公のレベル） | "hp"（主人公の体力） | "class"（主人公の職業）
//   | "hasItem"（指定したアイテムを持っているか＝true/false） | "number" | "string" | "bool"（t/f）
function resolveIfBlockValue(kind, rawValue) {
  if (kind === "flag") {
    const v = (typeof scenarioFlags !== "undefined") ? scenarioFlags[rawValue] : undefined;
    return v === undefined ? false : v; // ★まだ一度も設定されていないフラグは false 扱い
  }
  if (kind === "variable") {
    return (typeof getScenarioVariable === "function") ? getScenarioVariable(rawValue) : 0;
  }
  if (kind === "level") return (typeof player !== "undefined" && player) ? player.level : 0;
  if (kind === "hp") return (typeof player !== "undefined" && player && player.gauges && player.gauges.hp) ? player.gauges.hp.current : 0;
  if (kind === "sp") return (typeof player !== "undefined" && player && player.gauges && player.gauges.sp) ? player.gauges.sp.current : 0;
  if (kind === "bossHp") {
    // ★要望対応：ボスの戦闘イベント演出ブロック（if）から、今のボスのHP割合を参照できるように。
    //   battle.js側でボスの戦闘イベントを実行する直前に currentBossEventEnemy を差し込んでおいてもらう
    const enemy = (typeof currentBossEventEnemy !== "undefined") ? currentBossEventEnemy : null;
    return (enemy && enemy.maxHp > 0) ? Math.round((enemy.hp / enemy.maxHp) * 100) : 0;
  }
  if (kind === "turnCount") {
    return (typeof battleState !== "undefined" && battleState) ? (battleState.turnCount || 0) : 0;
  }
  if (kind === "class") return (typeof player !== "undefined" && player) ? player.class : "";
  if (kind === "hasItem") return (typeof getTotalItemCount === "function" && rawValue) ? getTotalItemCount(rawValue) > 0 : false;
  if (kind === "random") return Math.random() * 100; // ★要望対応：0以上100未満の乱数。判定のたびに新しく引き直す（例：「乱数」<= 30 で30%判定）
  if (kind === "number") return Number(rawValue) || 0;
  if (kind === "bool") return rawValue === "t" || rawValue === true || rawValue === "true";
  return rawValue != null ? String(rawValue) : ""; // "string"
}

// ★演算子：< > = >= <= !=（等しくない）。=とその他はゆるい型変換（"5"と5は一致）で比較し、
//   大小比較は数値化して行う（真偽値はtrue=1/false=0として扱う）
function compareIfBlockValues(left, operator, right) {
  if (operator === "=") return left == right;
  if (operator === "!=") return left != right;
  const toNum = (v) => (typeof v === "boolean" ? (v ? 1 : 0) : Number(v));
  const l = toNum(left), r = toNum(right);
  if (operator === "<") return l < r;
  if (operator === ">") return l > r;
  if (operator === "<=") return l <= r;
  if (operator === ">=") return l >= r;
  return false;
}

// ★IFブロックの全条件を評価する。combineMode="AND"（&）なら全て、"OR"（Ⅱ）ならいずれかを満たせばtrue。
//   各条件のnegate（!）は、その条件1つだけを反転させる
function evaluateIfBlockConditions(block) {
  const conditions = Array.isArray(block.conditions) && block.conditions.length > 0
    ? block.conditions
    : [{ leftKind: "bool", leftValue: "t", operator: "=", rightKind: "bool", rightValue: "t", negate: false }];
  const results = conditions.map(cond => {
    const left = resolveIfBlockValue(cond.leftKind, cond.leftValue);
    const right = resolveIfBlockValue(cond.rightKind, cond.rightValue);
    let result = compareIfBlockValues(left, cond.operator || "=", right);
    if (cond.negate) result = !result;
    return result;
  });
  return block.combineMode === "OR" ? results.some(Boolean) : results.every(Boolean);
}

// ★村や各エリアに来た時などの節目で呼ぶ。まだクリアしていない自作の話（第一話・第二話は専用の入口があるので対象外）のうち、
//   指定した開始トリガー（酒場の主人と話した時／指定したエリアのn回目に来た時）に合っていて、
//   一番上にあって条件を満たしているものを自動的に開始する。
//   ★triggerType="areaVisit"の時は、locationKeyに今来たエリアのlocationKeyを渡す。話側の開始トリガーが
//     そのエリア・その来訪回数（startTriggerVisitNumber、未指定なら1回目）と一致した時だけ始まる。
//     以前の「townArrival」（初めて街に来た時固定）は、後方互換として「village・1回目」のareaVisitと同じ意味で扱う
async function checkAndAutoRunNextCustomChapter(triggerType = "tavern", locationKey) {
  loadCustomScenarioData(); // ★シナリオビルドを開いていなくても、保存済みの最新データを見に行く
  // ★調査用：「エリアに来た時」を開始条件にしている話が、なぜ始まらないのか原因を特定しやすくするため、
  //   該当する話ごとに判定理由をコンソールへ出しておく（プレイには影響しない）
  if (triggerType === "areaVisit" && typeof console !== "undefined") {
    scenarioProject.chapters.filter(c => (c.startTrigger || "tavern") === "areaVisit").forEach(c => {
      const reasons = [];
      if (isChapterEffectivelyCleared(c)) reasons.push("既にクリア済み");
      if (c.builtin) reasons.push("組み込みの話（対象外）");
      if (!c.blocks || c.blocks.length === 0) reasons.push("ブロックが1つも無い");
      if (c.enabled === false) reasons.push("「実装済み」チェックがOFF");
      if (c.requiredChapterId) {
        const req = scenarioProject.chapters.find(rc => rc.id === c.requiredChapterId);
        if (!req) reasons.push(`前の話の指定(requiredChapterId=${c.requiredChapterId})が見つからない`);
        else if (!isChapterEffectivelyCleared(req)) reasons.push(`前の話「${req.title}」が未クリア`);
      }
      if (c.startTriggerAreaKey !== locationKey) reasons.push(`対象エリア不一致（設定：${c.startTriggerAreaKey} / 今来た場所：${locationKey}）`);
      else {
        const visitNumber = c.startTriggerVisitNumber || 1;
        const current = typeof getAreaVisitCount === "function" ? getAreaVisitCount(locationKey) : 0;
        if (current < visitNumber) {
          // ★調査用：来訪回数がなぜ増えないのかを特定するため、該当エリアの「来訪回数の増やし方」設定も一緒に出す
          const areaForKey = (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.mapAreas))
            ? scenarioProject.mapAreas.find(a => a.locationKey === locationKey) : null;
          const modeText = areaForKey ? `area.visitCountMode="${areaForKey.visitCountMode || "(未設定＝自動扱い)"}" (area.id=${areaForKey.id})` : "該当エリアがscenarioProject.mapAreasに見つからない";
          reasons.push(`来訪回数不足（現在${current}回／必要${visitNumber}回）／${modeText}`);
        }
      }
      console.log(`[話の開始条件チェック] 「${c.title}」(id=${c.id})：` + (reasons.length > 0 ? "未達成 → " + reasons.join("、") : "条件は満たしているはず"));
    });
  }
  if (triggerType === "tavern" && typeof console !== "undefined") {
    scenarioProject.chapters.filter(c => (c.startTrigger || "tavern") === "tavern").forEach(c => {
      const reasons = [];
      if (isChapterEffectivelyCleared(c)) reasons.push("既にクリア済み");
      if (c.builtin) reasons.push("組み込みの話（対象外）");
      if (!c.blocks || c.blocks.length === 0) reasons.push("ブロックが1つも無い");
      if (c.enabled === false) reasons.push("「実装済み」チェックがOFF");
      if (c.requiredChapterId) {
        const req = scenarioProject.chapters.find(rc => rc.id === c.requiredChapterId);
        if (!req) reasons.push(`前の話の指定(requiredChapterId=${c.requiredChapterId})が見つからない`);
        else if (!isChapterEffectivelyCleared(req)) reasons.push(`前の話「${req.title}」が未クリア`);
      }
      if (c.startTriggerTavernKey && c.startTriggerTavernKey !== locationKey) {
        const tavernList = scenarioProject.facilities.filter(f => f.type === "tavern").map(f => `${f.name}(facility_${f.id})`).join("、");
        reasons.push(`対象酒場不一致（設定：${c.startTriggerTavernKey} / 今来た場所：${locationKey} / 現在登録されている酒場施設一覧：${tavernList || "無し"}）`);
      }
      console.log(`[話の開始条件チェック] 「${c.title}」(id=${c.id})：` + (reasons.length > 0 ? "未達成 → " + reasons.join("、") : "条件は満たしているはず"));
    });
  }
  const candidate = scenarioProject.chapters.find(c => {
    if (isChapterEffectivelyCleared(c) || c.builtin || !c.blocks || c.blocks.length === 0) return false;
    if (!evaluateChapterUnlockConditions(c)) return false;
    const trigger = c.startTrigger || "tavern";
    if (trigger === "areaVisit") {
      if (triggerType !== "areaVisit" || !c.startTriggerAreaKey || c.startTriggerAreaKey !== locationKey) return false;
      const visitNumber = c.startTriggerVisitNumber || 1;
      // ★バグ修正：以前は「===」（ちょうどn回目の時だけ）だったため、何らかの理由で
      //   ちょうどn回目のタイミングで始まらなかった場合（実装済みチェック忘れ・前の話が未クリア等）、
      //   来訪回数がn回を過ぎてしまい、その後は二度と条件を満たせず永久に始まらなくなってしまっていた。
      //   「n回目以降ならいつでも」に変更し、一度条件を満たすタイミングを逃しても次に来た時に始まるようにする
      return (typeof getAreaVisitCount === "function" ? getAreaVisitCount(locationKey) : 0) >= visitNumber;
    }
    if (trigger === "townArrival") { // ★旧データとの互換用
      return triggerType === "areaVisit" && locationKey === "village" && (typeof getAreaVisitCount === "function" ? getAreaVisitCount("village") : 0) >= 1;
    }
    if (trigger === "tavern") {
      if (triggerType !== "tavern") return false;
      // ★要望対応：どの酒場施設で話しかけた時かを指定できるようにする。
      //   未設定（従来データ）の場合は、どの酒場で話しかけても始まる（後方互換）
      if (!c.startTriggerTavernKey) return true;
      return c.startTriggerTavernKey === locationKey;
    }
    return trigger === triggerType;
  });
  if (!candidate) return false;
  await runScenarioChapterBlocksForReal(candidate);
  return true;
}

async function tryRunBuiltinChapterOverride(chapterId) {
  loadCustomScenarioData(); // ★シナリオビルドを開いていなくても、保存済みの最新データを見に行く
  const chapter = scenarioProject.chapters.find(c => c.id === chapterId);
  if (!chapter || chapter.blocks.length === 0) return false;
  if (chapter.enabled === false) return false; // ★「実装済み」チェックがオフなら、編集中の上書き内容ではなく元々の話を再生させる
  await runScenarioChapterBlocksForReal(chapter);
  return true;
}

async function runScenarioChapterBlocksForReal(chapter, startBlockId) {
  // ★要望対応：料理タブ等、「シナリオ再生中は使えない」機能の判定用フラグ。
  //   話の実行が始まってから終わるまでの間、ずっとtrueにしておく
  window.isScenarioChapterPlaying = true;
  // ★目標（タスク）表示は「クリア前」だけでなく「まだ始まっていない」間だけ出すためのフラグ。
  //   以前はclearedだけを見ていたため、この話を実際にプレイし始めた後もクリアするまでずっと
  //   目標表示が出続け（そのくせ「一回消えてもまた出てくる」ように見える不具合の原因になっていた）
  const isFirstEntry = !chapter.started; // ★この話に入るのが今回が初めてか（＝話のタイトル演出を出すかの判定にも使う）
  
  // ★要望対応：新しい話に「本当に初めて」入る直前（まだ何も状態が変わっていない、この一瞬）の状態を、
  //   オートセーブの専用2枠目（話直前）へ保存しておく。
  //   startBlockIdが指定されている時（＝「話をやり直す」等で途中の選択肢から再開する時）や、
  //   既に始まっている話への再入場の時は、"新しく話が始まる"わけではないので対象外
  if (isFirstEntry && !startBlockId && typeof autoSaveToSlot === "function") autoSaveToSlot("prechapter"); // settings.js
  
  chapter.started = true;
  markScenarioBuildDirty();
  
  // ★話の一番最初にだけ、フェードイン・アウトで話のタイトルを大きく表示する演出を挟む。
  //   セーブ/ロードでの途中再開や、エンディング選択肢からの再開時には出さない（isFirstEntryで判定）
  if (isFirstEntry && chapter.title && typeof showSpecialScene === "function") {
    await showSpecialScene(chapter.title); // mainfunc.js（黒背景に大きく文字を出す既存の演出をそのまま流用）
  }
  
  const choiceStack = [];
  let result;
  try {
    result = await runBlockSequence(chapter, chapter.blocks, choiceStack, startBlockId);
  } catch (e) {
    // ★以前はここで例外が起きると、途中の画面のまま操作不能になったり、cleared記録（クリア済みフラグ）
    //   まで到達できずに終わってしまったりしていた（＝話の途中で止まって「クリア扱いにならない」状態になる
    //   原因の一つ）。ここで捕まえて、せめて村へは帰れるようにしておく
    console.error(`話「${chapter.title || chapter.id}」の実行中にエラーが発生しました`, e);
    changeSpeaker("");
    await displayMessage("……何かがおかしい。いったん村へ戻ることにした。");
    result = null;
  }
  
  // ★バグ修正：以前はここで必ずopenTownMenu()（カリの村）を呼んでいたため、カデリクの街など
  //   村以外の拠点・施設にいる間に始まった話が終わると、強制的に村へ飛ばされてしまっていた。
  //   まずcurrentLocationKey（話が始まった時点のまま、話の中身では変わらない）を見て、
  //   拠点・施設ならそこへ戻す。該当しない（村・酒場・敵エリアなど）場合だけ、
  //   元の第一話・第二話と同じく村の行き先メニューに戻る（タイトルへ戻った場合は、そちらの画面のままにしておく）
  // ★要望対応：ジャンプブロックの行き先が話のどこにも見つからなかった場合（IDが不正など）、
  //   デバッグしやすいよう警告だけ出しておく。実行そのものは静かに終了として扱う
  if (typeof result === "string" && result.startsWith("JUMP:")) {
    console.warn(`ジャンプブロックの行き先ブロック（id: ${result.slice(5)}）が話「${chapter.title || chapter.id}」の中に見つかりませんでした`);
    result = undefined;
  }
  
  if (result !== "TITLE") {
    const returnedToSpecificLocation = typeof resumeLocationDynamic === "function" && resumeLocationDynamic(currentLocationKey); // convenience.js
    if (!returnedToSpecificLocation && typeof openTownMenu === "function") {
      openTownMenu(); // town.js
    }
  }
  window.isScenarioChapterPlaying = false; // ★話の実行がここで終わるので、料理タブ等を再び使えるようにする
}

// ★選択肢を選ぶと、その選択肢自身が持つ内容（option.blocks。専用の編集画面で書く）をその場で実行する。
//   ループがONで、内容の実行が最後まで自然に終わった場合は、また同じ選択肢を出し直す。
//   後方互換のため、option.blocksが無い（旧方式のデータ）場合は、従来通りjumpBlockIdへジャンプする
async function runChoiceBlockWithOptions(chapter, block, choiceStack) {
  choiceStack.push(block.id); // ★「エンディング直前の選択肢」として、あとで再開地点に使うために記録しておく
  try {
    while (true) {
      if (block.prompt) {
        changeSpeaker("");
        await displayMessage(block.prompt);
      }
      const validOptions = block.options.filter(o => o.text);
      if (validOptions.length === 0) return undefined;
      
      // ★要望対応：「話をやり直す」機能のために、選択肢を表示する直前の状態を記録しておく。
      //   ログ再生中（過去のセーブを読み込んだ直後の再生）や、シナリオビルドのテストプレイ中は、
      //   実際にプレイヤーが選んだ進行ではないので対象外
      if (!isReplayingLog && !isScenarioTestPlay && typeof recordChoiceCheckpoint === "function") {
        recordChoiceCheckpoint(chapter.id, block.id, block.prompt || validOptions.map(o => o.text).join(" / ")); // convenience.js
      }
      
      const picked = await displayChoices(validOptions.map(o => ({ text: o.text, next: o.id, loops: !!o.loops, isCorrect: !!o.isCorrect }))); // mainfunc.js（↻ループ・★正解ヒントの表示に対応）
      const selected = validOptions.find(o => o.id === picked.next);
      if (!selected) return undefined;
      
      if (Array.isArray(selected.blocks) && selected.blocks.length > 0) {
        const result = await runBlockSequence(chapter, selected.blocks, choiceStack);
        if (result === "TITLE") return "TITLE";
        // ★要望対応：選択肢の中身にあるジャンプブロックの行き先がこの選択肢の中に無かった場合、
        //   そのまま外側へジャンプ要求を伝える（選択肢の外や、他の分岐へもジャンプできる）
        if (typeof result === "string" && result.startsWith("JUMP:")) return result;
        if (selected.loops) continue; // ★内容を最後まで実行し終えたら、また同じ選択肢に戻る
        return undefined; // ★選択肢ブロックの次へ進む
      }
      
      if (selected.jumpBlockId) return "JUMP:" + selected.jumpBlockId; // ★旧方式：親のブロック配列内へ直接ジャンプ
      if (selected.loops) continue; // ★内容も旧ジャンプ先も無いのにループ指定なら、そのまま出し直す
      return undefined;
    }
  } finally {
    choiceStack.pop();
  }
}

// ★ブロック配列（話全体のchapter.blocks、または選択肢の中身であるoption.blocks）を、先頭から順番に実行する共通処理。
//   startBlockIdを指定すると、先頭からではなくそのブロックから再開する（エンディング後の再開地点選択に使う）。
//   "TITLE"を返した場合はタイトル画面へ遷移済み。それ以外（undefined）は最後まで実行し終えたことを示す
async function runBlockSequence(chapter, blocksArray, choiceStack, startBlockId) {
  choiceStack = choiceStack || [];
  let blockId = startBlockId || (blocksArray.length > 0 ? blocksArray[0].id : null);
  let safetyCounter = 0;
  
  while (blockId && safetyCounter < 1000) {
    safetyCounter++;
    const index = blocksArray.findIndex(b => b.id === blockId);
    if (index === -1) {
      // ★要望対応：ジャンプ先がこの配列の中に無い場合（ifブロックの外や、別の分岐の中身など）は、
      //   一段外側の呼び出し元へジャンプ要求をそのまま伝える。runSingleScenarioBlock側の
      //   「if」「choice」の処理が、この戻り値を見てさらに外側へ伝播させる
      return "JUMP:" + blockId;
    }
    const block = blocksArray[index];
    const nextDefaultId = blocksArray[index + 1] ? blocksArray[index + 1].id : null;
    if (chapter && chapter.id === "restSkill_succubus") console.log("[好感度スキル調査] ブロック実行開始:", block.type, block.id); // ★調査用
    const result = await runSingleScenarioBlock(chapter, block, nextDefaultId, choiceStack);
    if (chapter && chapter.id === "restSkill_succubus") console.log("[好感度スキル調査] ブロック実行完了:", block.type, block.id, "→", result); // ★調査用
    if (result === "TITLE") return "TITLE";
    if (typeof result === "string" && result.startsWith("JUMP:")) {
      const targetId = result.slice(5);
      if (blocksArray.some(b => b.id === targetId)) {
        blockId = targetId; // ★ジャンプ先がこの配列の中にあったので、そのままここで処理を続ける
        continue;
      }
      return result; // ★この配列の中には無いので、さらに外側へ伝える
    }
    blockId = result;
  }
  return undefined;
}

// ★要望対応：シナリオビルドの「テストプレイ」中かどうか。
//   テストプレイは実際のプレイ進行ではないため、この間は「話をやり直す」用の選択肢チェックポイントを
//   記録しない（runChoiceBlockWithOptions側で参照する）
let isScenarioTestPlay = false;

async function runScenarioChapterTestPlay(chapter) {
  closeScenarioBuildMode();
  changeSpeaker("");
  await displayMessage(`（テストプレイ開始：「${chapter.title}」）`);
  
  isScenarioTestPlay = true;
  let result;
  try {
    result = await runBlockSequence(chapter, chapter.blocks, []);
  } finally {
    isScenarioTestPlay = false;
  }
  
  if (result === "TITLE") return; // ★タイトルへ戻った場合、テストプレイ終了処理はせずここで抜ける
  if (typeof result === "string" && result.startsWith("JUMP:")) {
    console.warn(`ジャンプブロックの行き先ブロック（id: ${result.slice(5)}）が見つかりませんでした（テストプレイ）`);
  }
  
  changeSpeaker("");
  await displayMessage("（テストプレイ終了）");
  openScenarioBuildMode();
  scenarioBuildMainView = "editor";
  scenarioBuildEditingChapterId = chapter.id;
  renderScenarioBuildPanel();
}

// ★戦闘ブロック（通常戦闘／ボス戦闘）で敗北時の分岐先が指定されていない場合の既定の処理。
//   話を始める前の状態には戻さず、村の広場へ強制送還する（＝この話の実行はここで中断され、
//   村のtown.js側が持っている「話の解放条件」を満たしていればレベルを上げてから再挑戦できる）
//   customMessageを渡すと、既定の「気を失っている間に～」の代わりにそのメッセージを表示する
async function handleScriptedBattleDefeatReturnToTown(customMessage) {
  changeSpeaker("");
  await displayMessage(customMessage || "気を失っている間に、誰かに救助されたようだ……気づくと村の広場に横たわっていた。レベルを上げてから、また挑もう。");
  return null; // ★話の実行はここで終わる（呼び出し元が自動的に村の行き先メニューへ戻す）
}

async function runSingleScenarioBlock(chapter, block, nextDefaultId, choiceStack) {
  if (block.type === "dialogue") {
    changeSpeaker(block.speaker || "");
    await displayMessage(block.text || "（本文未入力）", { allowSubFocus: !!chapter.allowSubFocus }); // ★バグ修正：サブ画面（魔物図鑑等）から実行した時、サブ画面を見たままだと進められず止まってしまっていた
    return nextDefaultId;
  }
  
  if (block.type === "narration") {
    changeSpeaker("");
    await displayMessage(block.text || "（本文未入力）", { allowSubFocus: !!chapter.allowSubFocus });
    return nextDefaultId;
  }
  
  if (block.type === "telop") {
    await showSpecialScene(block.text || "", !!chapter.allowSubFocus); // mainfunc.js（黒背景に大きく文字を出す既存の演出）
    return nextDefaultId;
  }
  
  if (block.type === "bgm") {
    if (block.track && typeof switchScenarioBGM === "function") {
      switchScenarioBGM(block.track, { fadeMs: 600 });
    }
    return nextDefaultId;
  }
  
  if (block.type === "bgmstop") {
    if (typeof stopScenarioBGM === "function") {
      stopScenarioBGM({ fadeMs: 600 });
    }
    return nextDefaultId;
  }
  
  if (block.type === "se") {
    if (block.path) {
      try {
        const audio = new Audio(block.path);
        audio.volume = 0.6;
        audio.play().catch(() => {});
      } catch (e) {
        console.warn("効果音の再生に失敗しました", e);
      }
    }
    return nextDefaultId;
  }
  
  if (block.type === "flag") {
    if (block.flagName) {
      let nextValue;
      if (block.mode === "toggle") nextValue = !scenarioFlags[block.flagName];
      else nextValue = block.mode === "on";
      setScenarioFlag(block.flagName, nextValue);
    }
    return nextDefaultId;
  }
  
  if (block.type === "setvar") {
    if (block.varName) {
      const current = getScenarioVariable(block.varName);
      let nextValue;
      if (block.mode === "add") nextValue = current + (Number(block.amount) || 0);
      else if (block.mode === "subtract") nextValue = current - (Number(block.amount) || 0);
      else nextValue = Number(block.amount) || 0; // "set"
      setScenarioVariable(block.varName, nextValue);
    }
    return nextDefaultId;
  }
  
  if (block.type === "changeparam") {
    const gaugeName = block.gauge || "hp";
    const applyToGauge = (unit) => {
      if (!unit || !unit.gauges || !unit.gauges[gaugeName]) return;
      const gauge = unit.gauges[gaugeName];
      let next;
      if (block.mode === "full") next = gauge.max;
      else if (block.mode === "empty") next = 0;
      else if (block.mode === "set") next = Number(block.amount) || 0;
      else next = gauge.current + (Number(block.amount) || 0); // "add"
      gauge.current = Math.max(0, Math.min(gauge.max, next));
    };
    if (typeof player !== "undefined" && player) {
      if (block.target === "allCompanions") {
        (player.companions || []).forEach(applyToGauge);
      } else if (block.target === "companion") {
        if (block.companionId) {
          const c = (player.companions || []).find(cc => cc.companionId === block.companionId);
          applyToGauge(c);
        }
      } else {
        applyToGauge(player);
      }
    }
    if (typeof renderStatusHUD === "function") renderStatusHUD();
    return nextDefaultId;
  }
  
  if (block.type === "bossRemoveInvincibility") {
    // ★要望対応：ボスの戦闘イベント（演出ブロック）実行中だけセットされるcurrentBossEventEnemy（battle.js）を使う
    const enemy = (typeof currentBossEventEnemy !== "undefined") ? currentBossEventEnemy : null;
    if (enemy) {
      enemy.invincibilityBroken = true;
      changeSpeaker("");
      await displayMessage(block.messageText || `${enemy.displayName}の様子が変わった……！`);
      if (typeof updateBattleHud === "function") updateBattleHud();
    }
    return nextDefaultId;
  }
  
  if (block.type === "bossSummonAlly") {
    const enemy = (typeof currentBossEventEnemy !== "undefined") ? currentBossEventEnemy : null;
    if (enemy) {
      changeSpeaker(enemy.displayName);
      await displayMessage(block.messageText || "……仲間を呼んだ！");
      if (block.allyMonsterKey && typeof MONSTER_MASTER !== "undefined" && MONSTER_MASTER[block.allyMonsterKey] && typeof createEnemyUnit === "function" && typeof battleState !== "undefined" && battleState) {
        const ally = createEnemyUnit(block.allyMonsterKey, enemy.level || (typeof player !== "undefined" ? player.level : 1));
        battleState.enemies.push(ally);
        if (typeof assignDisplayNames === "function") assignDisplayNames(battleState.enemies);
        if (typeof updateBattleHud === "function") updateBattleHud();
      }
    }
    return nextDefaultId;
  }
  
  if (block.type === "bossHeal") {
    const enemy = (typeof currentBossEventEnemy !== "undefined") ? currentBossEventEnemy : null;
    if (enemy) {
      const healRatio = Number(block.healRatio) || 0.3;
      const healAmount = Math.round(enemy.maxHp * healRatio);
      enemy.hp = Math.min(enemy.maxHp, enemy.hp + healAmount);
      changeSpeaker(enemy.displayName);
      await displayMessage(block.messageText || `${enemy.displayName}は体力を回復した！（${healAmount}）`);
      if (typeof updateBattleHud === "function") updateBattleHud();
    }
    return nextDefaultId;
  }
  
  if (block.type === "bossUseSkill") {
    const enemy = (typeof currentBossEventEnemy !== "undefined") ? currentBossEventEnemy : null;
    if (enemy && typeof executeMonsterUniqueSkill === "function") {
      await executeMonsterUniqueSkill(enemy, {
        name: block.skillName || "強力な一撃",
        flavor: "",
        multiplier: Number(block.skillMultiplier) || 1.5,
        kind: block.skillKind || undefined
      });
    }
    return nextDefaultId;
  }
  
  if (block.type === "if") {
    const result = evaluateIfBlockConditions(block);
    // ★要望対応：選択肢ブロック（option.blocks）と同じ考え方で、trueの時／falseの時それぞれの
    //   「中身」を直接ブロックとして書けるようにした（以前はジャンプ先を選ぶだけの方式だった）。
    //   中身を最後まで実行し終えたら、ifブロックの次（nextDefaultId）へ進む
    const branchBlocks = result ? block.trueBlocks : block.falseBlocks;
    if (Array.isArray(branchBlocks) && branchBlocks.length > 0) {
      const seqResult = await runBlockSequence(chapter, branchBlocks, choiceStack);
      if (seqResult === "TITLE") return "TITLE";
      // ★要望対応：中身の中にジャンプブロックがあり、その行き先がこのif内（trueBlocks/falseBlocks）に
      //   無かった場合、そのままさらに外側へジャンプ要求を伝える（ifの外や別の分岐へもジャンプできる）
      if (typeof seqResult === "string" && seqResult.startsWith("JUMP:")) return seqResult;
      return nextDefaultId;
    }
    // ★後方互換：まだ中身が書かれていない（旧データのジャンプ先だけがある）場合は、従来通りジャンプする
    return (result ? block.trueJumpBlockId : block.falseJumpBlockId) || nextDefaultId;
  }
  
  if (block.type === "jump") {
    // ★要望対応：指定したブロックへ直接ジャンプする。行き先が見つかるまでrunBlockSequence側で
    //   外側の配列へ次々と伝播していくので、ifの中から外・別の分岐先など、話の中のどこへでも移動できる
    return block.targetBlockId ? ("JUMP:" + block.targetBlockId) : nextDefaultId;
  }
  
  if (block.type === "addcompanion") {
    if (block.companionId) {
      if (typeof ensureCustomCompanionsRegistered === "function") ensureCustomCompanionsRegistered();
      if (typeof addCompanionToParty === "function") addCompanionToParty(block.companionId, block.initialLevel || 1); // player.js
    }
    return nextDefaultId;
  }
  
  if (block.type === "removecompanion") {
    if (block.companionId && typeof benchCompanion === "function") { // player.js
      const left = benchCompanion(block.companionId);
      if (left) {
        if (block.farewellMessage) {
          changeSpeaker("");
          await displayMessage(block.farewellMessage);
        }
        if (typeof renderStatusHUD === "function") renderStatusHUD();
      }
    }
    return nextDefaultId;
  }
  
  if (block.type === "portrait_show") {
    if (block.mode === "hideAll") {
      if (typeof hideAllPortraits === "function") hideAllPortraits(block.fadeMs);
    } else if (block.mode === "hide") {
      if (block.instanceId && typeof hidePortrait === "function") hidePortrait(block.instanceId, block.fadeMs);
    } else if (block.instanceId && block.characterId && typeof showPortrait === "function") {
      const imagePath = resolvePortraitImagePath(block.characterId, block.expressionId);
      showPortrait(block.instanceId, imagePath, block.position != null ? block.position : 50, block.fadeMs);
    }
    return nextDefaultId;
  }
  
  if (block.type === "portrait_expression") {
    if (block.instanceId && typeof changePortraitExpression === "function") {
      const linkedShow = chapter.blocks.find(b => b.type === "portrait_show" && b.instanceId === block.instanceId && b.characterId);
      if (linkedShow) {
        const imagePath = resolvePortraitImagePath(linkedShow.characterId, block.expressionId);
        changePortraitExpression(block.instanceId, imagePath);
      }
    }
    return nextDefaultId;
  }
  
  if (block.type === "portrait_move") {
    if (block.instanceId && typeof movePortrait === "function") {
      movePortrait(block.instanceId, block.position != null ? block.position : 50, block.durationMs);
    }
    return nextDefaultId;
  }
  
  if (block.type === "portrait_motion") {
    if (block.instanceId && typeof playPortraitMotion === "function") {
      playPortraitMotion(block.instanceId, block.motionType);
    }
    return nextDefaultId;
  }
  
  if (block.type === "increment_area_visit") {
    if (block.areaKey && typeof incrementAreaVisitCount === "function") incrementAreaVisitCount(block.areaKey);
    return nextDefaultId;
  }
  
  if (block.type === "give") {
    ensureCustomItemsRegistered(); ensureCustomFishRegistered(); // ★アイテム設定・魚管理で追加したものを念のため最新の状態にしてから付与する
    if (block.itemId && typeof ITEM_MASTER !== "undefined" && ITEM_MASTER[block.itemId]) {
      addItem(block.itemId, Math.max(1, block.quantity || 1)); // inventory.js
      renderStatusHUD();
      changeSpeaker("");
      await displayMessage(`「${ITEM_MASTER[block.itemId].name}」を${block.quantity || 1}個手に入れた！`);
    } else {
      changeSpeaker("");
      await displayMessage(`（テストプレイ：アイテムID「${block.itemId}」が見つかりません）`);
    }
    return nextDefaultId;
  }
  
  if (block.type === "battle") {
    ensureCustomMonstersRegistered(); // ★サブ画面で追加した敵・ボスを念のため最新の状態にしてから開始する
    const keys = (block.enemies || []).filter(id => id && MONSTER_MASTER[id]).slice(0, 5);
    if (keys.length === 0) {
      changeSpeaker("");
      await displayMessage("（テストプレイ：戦闘に出す敵が設定されていません。戦闘をスキップします）");
      return nextDefaultId;
    }
    const outcome = await startBattle(keys, { isScripted: true, fixedLevel: (typeof block.level === "number" && block.level > 0) ? block.level : undefined }); // battle.js（複数種の敵と同時に戦える）
    if (outcome === "win") return block.winJumpBlockId || nextDefaultId;
    if (block.defeatJumpBlockId) return block.defeatJumpBlockId;
    return await handleScriptedBattleDefeatReturnToTown(block.defeatMessage); // ★分岐先が指定されていなければ、村の広場へ強制送還する（defeatMessageがあればそれを表示）
  }
  
  if (block.type === "bossbattle") {
    ensureCustomMonstersRegistered();
    if (!block.bossKey || !MONSTER_MASTER[block.bossKey]) {
      changeSpeaker("");
      await displayMessage(`（テストプレイ：ボスID「${block.bossKey}」が見つかりません。戦闘をスキップします）`);
      return nextDefaultId;
    }
    const escortKeys = (block.escorts || []).filter(id => id && MONSTER_MASTER[id]);
    const keys = [block.bossKey, ...escortKeys].slice(0, 5); // ★ボスを先頭にすることで、専用BGM等のボス扱いになる
    const outcome = await startBattle(keys, { isScripted: true });
    if (outcome === "win") return block.winJumpBlockId || nextDefaultId;
    if (block.defeatJumpBlockId) return block.defeatJumpBlockId;
    return await handleScriptedBattleDefeatReturnToTown(block.defeatMessage); // ★分岐先が指定されていなければ、村の広場へ強制送還する（defeatMessageがあればそれを表示）
  }
  
  if (block.type === "choice") {
    const result = await runChoiceBlockWithOptions(chapter, block, choiceStack || []);
    if (result === "TITLE") return "TITLE";
    if (typeof result === "string" && result.startsWith("JUMP:")) return result.slice(5);
    return nextDefaultId;
  }
  
  if (block.type === "effect") {
    if (block.effectType === "shake" && typeof triggerCameraShake === "function") {
      triggerCameraShake(); // mainfunc.js
      await wait(400);
    } else if (block.effectType === "flash" && typeof triggerHitFlash === "function") {
      triggerHitFlash(); // mainfunc.js
      await wait(200);
    } else if (block.effectType === "flashWhite" && typeof triggerWhiteFlash === "function") {
      triggerWhiteFlash(); // mainfunc.js（要望対応：白い閃光フラッシュ）
      await wait(300);
    } else if (block.effectType === "monochromeOn" && typeof setMonochromeEffect === "function") {
      setMonochromeEffect(true); // mainfunc.js（要望対応：回想演出などに使うモノクロ表示）
    } else if (block.effectType === "monochromeOff" && typeof setMonochromeEffect === "function") {
      setMonochromeEffect(false); // mainfunc.js
    } else if (block.effectType === "sepiaOn" && typeof setSepiaEffect === "function") {
      setSepiaEffect(true); // mainfunc.js（要望対応：セピア調の回想演出）
    } else if (block.effectType === "sepiaOff" && typeof setSepiaEffect === "function") {
      setSepiaEffect(false); // mainfunc.js
    } else if (block.effectType === "invertOn" && typeof setInvertEffect === "function") {
      setInvertEffect(true); // mainfunc.js（要望対応：色反転演出）
    } else if (block.effectType === "invertOff" && typeof setInvertEffect === "function") {
      setInvertEffect(false); // mainfunc.js
    } else if (block.effectType === "blurOn" && typeof setBlurEffect === "function") {
      setBlurEffect(true); // mainfunc.js（要望対応：ぼかし演出。意識朦朧・夢の中など）
    } else if (block.effectType === "blurOff" && typeof setBlurEffect === "function") {
      setBlurEffect(false); // mainfunc.js
    } else if (block.effectType === "blackoutOn" && typeof setBlackoutEffect === "function") {
      setBlackoutEffect(true); // mainfunc.js（要望対応：暗転演出。画面が黒くなるまで少し待つ）
      await wait(650);
    } else if (block.effectType === "blackoutOff" && typeof setBlackoutEffect === "function") {
      setBlackoutEffect(false); // mainfunc.js
      await wait(650);
    } else if (block.effectType === "vignetteOn" && typeof setVignetteEffect === "function") {
      setVignetteEffect(true); // mainfunc.js（要望対応：ヴィネット演出。緊張感・集中演出）
    } else if (block.effectType === "vignetteOff" && typeof setVignetteEffect === "function") {
      setVignetteEffect(false); // mainfunc.js
    } else if (block.effectType === "zoomIn" && typeof setZoomEffect === "function") {
      setZoomEffect(true); // mainfunc.js（要望対応：ズーム演出。盛り上がる場面の強調）
    } else if (block.effectType === "zoomOut" && typeof setZoomEffect === "function") {
      setZoomEffect(false); // mainfunc.js
    } else if (block.effectType === "weatherRainOn" && typeof setWeatherEffect === "function") {
      setWeatherEffect("rain"); // mainfunc.js（要望対応：天候演出）
    } else if (block.effectType === "weatherSnowOn" && typeof setWeatherEffect === "function") {
      setWeatherEffect("snow"); // mainfunc.js
    } else if (block.effectType === "weatherSakuraOn" && typeof setWeatherEffect === "function") {
      setWeatherEffect("sakura"); // mainfunc.js
    } else if (block.effectType === "weatherOff" && typeof setWeatherEffect === "function") {
      setWeatherEffect(null); // mainfunc.js
    }
    return nextDefaultId;
  }
  
  if (block.type === "background") {
    if (block.path && block.path.trim().startsWith("#") && typeof setBackgroundColor === "function") {
      setBackgroundColor(block.path.trim()); // mainfunc.js
    } else if (block.path && typeof setBackgroundImage === "function") {
      setBackgroundImage(block.path); // mainfunc.js
    }
    return nextDefaultId;
  }
  
  if (block.type === "takeitem") {
    if (block.itemId && typeof removeItem === "function") {
      removeItem(block.itemId, Math.max(1, block.quantity || 1)); // inventory.js
      renderStatusHUD();
    }
    return nextDefaultId;
  }
  
  if (block.type === "classselect") {
    const jobChoices = [
      { text: "全能士（オールラウンダー）", next: "全能士" },
      { text: "戦士", next: "戦士" },
      { text: "性騎士", next: "性騎士" },
      { text: "ニート", next: "ニート" },
      { text: "お宝鑑定団", next: "お宝鑑定団" },
      { text: "魔法少女（おっさん）", next: "魔法少女" }
    ];
    let jobName = null;
    while (!jobName) {
      const selectedJob = await displayChoices(jobChoices);
      const candidateJob = selectedJob.next;
      const classInfo = CLASS_MASTER[candidateJob];
      changeSpeaker("神様？");
      await displayMessage(`${candidateJob}か。それはね、${classInfo.description}`);
      const confirmChoices = [
        { text: `${candidateJob}にする`, next: "yes" },
        { text: "他の職業を選び直す", next: "no" }
      ];
      const confirmResult = await displayChoices(confirmChoices, 1);
      if (confirmResult.next === "yes") {
        jobName = candidateJob;
      } else {
        changeSpeaker("");
        await displayMessage("俺はもう一度、職業について考え直すことにした。");
      }
    }
    initPlayer(jobName); // player.js
    renderStatusHUD();
    
    changeSpeaker("田中治郎");
    if (jobName === "ニート") {
      await displayMessage("俺はもう働きたくないからな。ニートにする。");
      changeSpeaker("神様？");
      await displayMessage("いや、ニートも自宅を守るという大事な使命があるぞ。神様が警告するように言った。");
    } else if (jobName === "全能士") {
      await displayMessage("じゃあ、その『オールラウンダー』ってのにしとく。どうせなら色々できる方がいいや");
      changeSpeaker("神様？");
      await displayMessage("神様は軽く頷きながら言った。いい選択だ。だいたいの職業の基本的なスキルは取れるし、バランスの良い職業だ。まあ何とかなるよ。後悔しないよね？");
      changeSpeaker("田中治郎");
      await displayMessage("え、はい。");
    } else if (jobName === "戦士") {
      await displayMessage("いろいろあるがここはベーシックに戦士で！");
      changeSpeaker("神様？");
      await displayMessage("神様は少し驚いた顔をして、本当にそれでいいの？と念押しした。");
      changeSpeaker("田中治郎");
      await displayMessage("ああ、もちろんだ。ただのブラック企業勤務でも体力だけはあるからな！");
      changeSpeaker("神様？");
      await displayMessage("そっか、それなら大丈夫だろう。異世界生活楽しんで笑");
    } else if (jobName === "性騎士") {
      await displayMessage("全男子の夢みたいな職業だな。この性騎士ってので。");
      changeSpeaker("神様？");
      await displayMessage("神様は少し笑いながら答えた。けっこうキモがられるよwwwwそれwwwワシも一回それになって人間界に降りたことあるんだけどねww");
      changeSpeaker("田中治郎");
      await displayMessage("だって、女の子にモテそうだし...!");
    } else if (jobName === "お宝鑑定団") {
      await displayMessage("お宝鑑定団！？こんな職業もあるんだ！俺は思わず叫んだ。");
      changeSpeaker("神様？");
      await displayMessage("あるよ。お前みたいに見る目があるやつなら、その職業に向いてるかもね笑");
      changeSpeaker("田中治郎");
      await displayMessage("鑑定だけでいいのかよ");
      changeSpeaker("神様？");
      await displayMessage("まあ、なんでも◯定団みたいな感じのスキル使えるよ。");
    } else if (jobName === "魔法少女") {
      await displayMessage("ま、魔法少女……？俺、35のおっさんだったんですけど……大丈夫なんですかそれ");
      changeSpeaker("神様？");
      await displayMessage("細かいことは気にすんな。変身すれば魔法が使える、けっこう夢のある職業だぞ。ステッキとか似合うといいな");
      changeSpeaker("田中治郎");
      await displayMessage("絶対似合わねえだろ……");
      changeSpeaker("神様？");
      await displayMessage("まあ安心しろ、見た目は多少アレだが、変身すれば魔法が使えるのはお前だけの強みだ。");
    }
    return nextDefaultId;
  }
  
  if (block.type === "setrank") {
    if (typeof setNickname === "function" && block.nickname) setNickname(block.nickname); // player.js（ランク設定は廃止。ランクは試練クリアで自動的に上がる）
    renderStatusHUD();
    return nextDefaultId;
  }
  
  if (block.type === "gameover") {
    changeSpeaker("");
    const choice = await showGameOverScreen(block.message || "力尽きてしまった……", block.endingName || ""); // mainfunc.js（専用デザイン＋リトライ／タイトルへ戻るボタン。エンディング名があれば一緒に表示）
    if (choice === "retry") {
      if (block.retryJumpBlockId) return block.retryJumpBlockId; // ★指定があれば、話の最初からではなくそこへ戻る
      return chapter.blocks.length > 0 ? chapter.blocks[0].id : null; // ★未指定なら話の最初からやり直す
    }
    returnToTitleScreen(); // mainfunc.js
    return "TITLE";
  }
  
  if (block.type === "ending") {
    changeSpeaker("");
    await showSpecialScene(block.title || "END"); // mainfunc.js
    
    // ★バグ修正（要望対応）：テストプレイでエンディング/話クリアブロックに到達しても、
    //   本当にクリアした事にはしない。以前はテストプレイかどうかを見ておらず、chapter.cleared=trueを
    //   本当に保存し、実績解放やセーブデータの自動保存まで走っていたため、「テストプレイ用：クリア済み
    //   扱いにする」チェック（一時的なだけのはず）と、本編の本当のクリア状態が実質同じものになって
    //   しまっていた
    if (isScenarioTestPlay) {
      const testEndrollEnabled = block.endrollEnabled !== false;
      if (testEndrollEnabled && block.endroll && typeof playEndRoll === "function") {
        await playEndRoll(block.endroll, block.endrollBgm || null, block.endrollScrollSeconds || 20);
      }
      return "TITLE";
    }
    
    chapter.cleared = true;
    if (typeof player !== "undefined") player.progressPoints = 0; // ★話が終わるごとに進行度をリセットする
    
    // ★次に「つづきから」でこのデータを開いた時、エンディング直前の選択肢に戻るか、話が始まる前（村）に戻るかを
    //   選べるようにするための記録。次にセーブされた時にこの記録も一緒に保存される
    if (typeof player !== "undefined") {
      const lastChoiceId = (choiceStack && choiceStack.length > 0) ? choiceStack[choiceStack.length - 1] : null;
      player.pendingResumeOptions = { chapterId: chapter.id, choiceBlockId: lastChoiceId };
    }
    markScenarioBuildDirty();
    // ★markScenarioBuildDirty()はシナリオエディタの💾ボタンの見た目を更新するだけで、実際にブラウザへ
    //   保存するわけではない。以前はここにsaveCustomScenarioData()が無かったため、実際のプレイでここに到達して
    //   chapter.cleared=trueにしても、シナリオエディタを開いて明示的に保存し直さない限りブラウザには残らず、
    //   進行度アイコンや次の話の解放条件がいつまでも反映されない不具合の原因になっていた
    if (typeof saveCustomScenarioData === "function") saveCustomScenarioData();
    if (typeof autoSaveAfterEnding === "function") await autoSaveAfterEnding(); // convenience.js（直前のスロットへ自動保存し、上の記録を実際に残す）
    if (typeof checkAchievements === "function") await checkAchievements(); // ★実績システム（要望対応）：クリア済み話数などが更新された後にチェック
    
    const endrollEnabled = block.endrollEnabled !== false; // ★未指定（古いデータ）の場合はこれまで通りON扱い
    if (endrollEnabled && block.endroll && typeof playEndRoll === "function") {
      await playEndRoll(block.endroll, block.endrollBgm || null, block.endrollScrollSeconds || 20, block.endrollBgmFadeSeconds); // mainfunc.js
    }
    returnToTitleScreen(); // mainfunc.js ★エンドロールが終わったら（無ければそのまま）タイトル画面に戻る
    return "TITLE";
  }
  
  if (block.type === "clearchapter") {
    // ★バグ修正（要望対応）：上のendingブロックと同じ理由で、テストプレイ中は本当にクリア済みにしない
    if (isScenarioTestPlay) {
      if (block.endrollEnabled === true && block.endroll && typeof playEndRoll === "function") {
        await playEndRoll(block.endroll, block.endrollBgm || null, block.endrollScrollSeconds || 20);
      }
      return nextDefaultId;
    }
    
    chapter.cleared = true; // ★エンディングと違い、タイトル画面には戻らずそのまま続く
    if (block.resetProgress !== false && typeof player !== "undefined") player.progressPoints = 0;
    markScenarioBuildDirty();
    // ★上のendingブロックと同じ理由で、ここでも実際にブラウザへ保存しておく（markScenarioBuildDirtyだけでは
    //   保存されない）。これが無いと、第一話クリア直後に第二話の解放条件を確認する処理（loadCustomScenarioDataの
    //   再読み込み）で、まだ保存されていない今のcleared=trueが古いfalseで上書きされてしまう不具合があった
    if (typeof saveCustomScenarioData === "function") saveCustomScenarioData();
    if (typeof checkAchievements === "function") await checkAchievements(); // ★実績システム（要望対応）：クリア済み話数などが更新された後にチェック
    
    // ★要望対応：エンディングでなくても、話クリアのタイミングでエンドロールを流せるようにする。
    //   タイトル画面には戻らないので、流し終わったら普通にnextDefaultIdへ進む
    if (block.endrollEnabled === true && block.endroll && typeof playEndRoll === "function") {
      await playEndRoll(block.endroll, block.endrollBgm || null, block.endrollScrollSeconds || 20, block.endrollBgmFadeSeconds); // mainfunc.js
    }
    return nextDefaultId;
  }
  
  return nextDefaultId;
}

// ★要望対応：好感度 MAX 時の専用スキル（restSkillBlocks）を魔物図鑑から実行できるように、
//   runBlockSequence と runSingleScenarioBlock をグローバル公開する
if (typeof window !== "undefined") {
  window.runBlockSequence = runBlockSequence;
  window.runSingleScenarioBlock = runSingleScenarioBlock;
}