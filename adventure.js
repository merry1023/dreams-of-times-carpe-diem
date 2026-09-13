// adventure.js
// 「冒険する」から入れる、洞窟・草原の探索パート。
// 前に進む/調べる/村へ戻る の3択で進行し、進むたびに一定確率で魔物と遭遇する（battle.jsのstartBattleへ）。
// 洞窟は稀に分かれ道が発生し、進む方向を選べる。

const ADVENTURE_LOCATIONS = {
  cave: {
    name: "アヌスの洞窟",
    background: { type: "image", value: "img/洞窟.jpg" },
    encounterRate: 0.4, // 「前に進む」1回あたりの魔物遭遇率
    forkRate: 0.25, // 「前に進む」1回あたりの分かれ道発生率
    monsterPool: ["goblin", "bat", "giant_rat", "skeleton", "succubus", "orc", "poison_zombie"],
    minMonsterLevel: 10, // ★推奨レベル10以上。ここではこれより低いレベルの魔物は出ない
    findPool: ["material_001", "herb_001", "herb_002"] // 「調べる」で見つかるアイテム候補
  },
  grassland: {
    name: "ガマジルの草原",
    background: { type: "image", value: "img/草原.jpg" },
    encounterRate: 0.35,
    forkRate: 0, // 草原に分かれ道は無し
    monsterPool: ["slime", "wolf", "forest_boar", "harpy", "treant"],
    // ★月光草(herb_003)は真価が高い希少品なので、他より出にくいよう重みを下げてある
    findPool: [
      { itemId: "herb_001", weight: 10 },
      { itemId: "material_001", weight: 10 },
      { itemId: "herb_003", weight: 1 }
    ]
  },
  forest: {
    name: "幻魔の森",
    background: { type: "image", value: "img/森.jpg" },
    encounterRate: 0.4,
    forkRate: 0.15, // 木々に紛れて分かれ道もある
    monsterPool: ["goblin", "forest_boar", "harpy", "treant", "wolf"],
    minMonsterLevel: 5, // ★推奨レベル5以上。ここではこれより低いレベルの魔物は出ない
    findPool: [
      { itemId: "herb_001", weight: 10 },
      { itemId: "material_001", weight: 8 },
      { itemId: "herb_003", weight: 2 },
      { itemId: "herb_004", weight: 6 } // ★高級薬草：幻魔の森でしか見つからない
    ]
  }
};

// ★マップ設定タブの「既存のマップ」欄で編集・削除できる組み込みロケーションの一覧
const BUILTIN_MAP_LOCATION_KEYS = ["cave", "grassland", "forest"];

// ★お宝鑑定団の「運否天賦の勘」（player.js）。習得していれば、探索で隠しアイテムを見つけやすくなる
function getExploreFindBonus() {
  return (typeof hasPassiveSkill === "function" && hasPassiveSkill("exploreBonus")) ? 0.1 : 0;
}


// ★マップ設定タブで編集した内容（名前・出現する敵・BGM）を、実際のADVENTURE_LOCATIONSに反映する。
//   削除されている（scenarioProject.mapAreasに存在しない）場合は何もしない＝元の値のまま
function applyBuiltinMapAreaOverrides() {
  if (typeof scenarioProject === "undefined" || !scenarioProject.mapAreas) return;
  BUILTIN_MAP_LOCATION_KEYS.forEach(key => {
    const area = scenarioProject.mapAreas.find(a => a.builtin && a.locationKey === key);
    const loc = ADVENTURE_LOCATIONS[key];
    if (!area || !loc) return;
    if (area.name) loc.name = area.name;
    if (area.bgImage) loc.background = { type: "image", value: area.bgImage };
    if (Array.isArray(area.enemyIds) && area.enemyIds.length > 0) loc.monsterPool = area.enemyIds.slice();
    loc.fixedMonsterLevel = (typeof area.enemyLevel === "number" && area.enemyLevel > 0) ? area.enemyLevel : null; // ★エリア設定の「出現する敵のレベル」（未設定なら今まで通り主人公基準）
    if (area.bgTrack && typeof BGM_TRACK_PATHS !== "undefined") {
      BGM_TRACK_PATHS["field_" + key] = area.bgTrack.replace(/\.mp3$/i, ""); // ★既存の呼び出し名(field_cave等)はそのまま、パスだけ差し替える
    }
  });
}

// ★重み付きで1つ選ぶ。配列の中身が文字列（itemIdそのもの）なら重み1として扱う
function pickWeightedItemId(pool) {
  const weighted = pool.map(entry => typeof entry === "string" ? { itemId: entry, weight: 1 } : entry);
  const total = weighted.reduce((sum, e) => sum + e.weight, 0);
  let roll = Math.random() * total;
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll < 0) return entry.itemId;
  }
  return weighted[weighted.length - 1].itemId;
}

let currentAdventureLocationKey = null;

// ===== 探索中の経過時間 =====
// ★「冒険に出たら時間が進む」用。1回の滞在（村を出てから戻るまで）ごとに、
//   最大12時間まで進む。村へ戻って再度冒険に出ると、またリセットされる。
const ADVENTURE_TRIP_MAX_HOURS = 12;
let adventureHoursThisTrip = 0;

// 経過時間を進める（滞在中の合計が ADVENTURE_TRIP_MAX_HOURS を超えないようにクランプする）
function advanceAdventureTime(hours) {
  const remaining = ADVENTURE_TRIP_MAX_HOURS - adventureHoursThisTrip;
  if (remaining <= 0) return;
  const applied = Math.min(hours, remaining);
  adventureHoursThisTrip += applied;
  if (typeof advanceGameTime === "function") advanceGameTime(applied); // player.js
  if (typeof renderStatusHUD === "function") renderStatusHUD();
}

// ===== 「調べる」の結果キャッシュ =====
// ★同じ場所（洞窟/草原）で何度も「調べる」を行っても、その滞在中は同じ結果が出るようにする。
//   ただしアイテムが見つかる結果だった場合、アイテムがもらえるのは最初の1回だけ。
// { roll: 0〜1の乱数, foundItemId?: string, itemGiven?: boolean } または null（まだ調べていない）
let adventureExamineCache = { cave: null, grassland: null, forest: null };
// ★マップ設定タブで作ったエリア（examineCustomArea）専用の「調べる」結果キャッシュ。area.idごとに、
//   その滞在中に一度調べたかどうかだけを覚えておく（true/false）
let customAreaExamineCache = {};

// ===== エリア来訪回数（話の始まるきっかけ「エリアに来た時」、シナリオ専用エリアのn回目判定に使う） =====
function getAreaVisitCount(locationKey) {
  if (!locationKey || typeof player === "undefined" || !player.areaVisitCounts) return 0;
  return player.areaVisitCounts[locationKey] || 0;
}

function incrementAreaVisitCount(locationKey) {
  if (!locationKey || typeof player === "undefined") return 0;
  if (!player.areaVisitCounts) player.areaVisitCounts = {};
  player.areaVisitCounts[locationKey] = (player.areaVisitCounts[locationKey] || 0) + 1;
  return player.areaVisitCounts[locationKey];
}

// ★マップ編集の「来訪回数の増やし方」が「自動（未指定含む）」の時だけ、ここで自動的に増やす。
//   「手動」に設定されているエリアは、専用ブロック（増やすブロック）でしか増えない
function maybeAutoIncrementAreaVisit(locationKey) {
  if (!locationKey) return;
  const area = (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.mapAreas))
    ? scenarioProject.mapAreas.find(a => a.locationKey === locationKey) : null;
  if (area && area.visitCountMode === "manual") return;
  incrementAreaVisitCount(locationKey);
}

// ★今いる場所の推奨最低レベル。この値より低いレベルの魔物は出ないようにする（generateMonsterLevelで参照）
let currentAdventureMinMonsterLevel = 1;

// ===== 洞窟・森の最奥イベント =====
// ★場所ごとの「何回進んだら最奥に着くか」「最奥のボス」「ボス撃破後の豪華な宝箱」の設定
const DEPTH_EVENT_CONFIG = {
  cave: { min: 10, max: 12, bossKey: "cave_boss", lootTable: "cave", flavorText: "気がつくと、洞窟のかなり奥まで来ていたようだ。空気が変わり、ひときわ大きな空洞に出た……" },
  forest: { min: 8, max: 10, bossKey: "forest_boss", lootTable: "forest", flavorText: "気がつくと、幻魔の森のかなり深くまで踏み込んでいたようだ。木々の隙間から差す光が、やけに幻想的に見える……" }
};
let depthCounter = 0; // 今の滞在で「前に進む」を選んだ回数
let depthThreshold = 0; // 今回の潜行・踏破で最奥に着くまでの回数（場所ごとの範囲でランダムに決まる）
let depthEventDone = false; // 今回の滞在で、既に最奥イベントを消化したか
let pendingBossReward = null; // ボス戦に勝ったら、後でより豪華な宝箱を出すためのフラグ（null / "cave" / "forest"）

// ★武器屋・防具屋で買えるようになった標準装備（鉄の剣・革の鎧・鉄の盾）は、
//   宝箱からは出さないようにしてある。装備は基本的にお金を貯めて買うものにし、
//   探索でしか手に入らないのは「錆びた」シリーズのような指定した特別な品だけにする
const CHEST_LOOT_NORMAL = [
  { itemId: "herb_003", gold: 200 },
  { itemId: "potion_002", gold: 150 },
  { itemId: "herb_001", gold: 80 },
  { itemId: "material_001", gold: 60 }
];

const CHEST_LOOT_RARE = [
  { itemId: "material_002", gold: 1000, weight: 10 }, // ★かなり希少なので出にくくしてある
  { itemId: "weapon_001", gold: 800, weight: 80 }, // ★「錆びた剣」は探索でしか手に入らない特別な一振り
  { itemId: "excalibur", gold: 2000, weight: 10 } // ★性剣エクスカリバー。10%だけ（性騎士専用）
];

// ★森の主を倒した後の宝箱。森の王の盾は3%だけ（かなり希少）
const CHEST_LOOT_FOREST_RARE = [
  { itemId: "forest_shield", gold: 900, weight: 3 },
  { itemId: "herb_003", gold: 200, weight: 97 }
];

const CHEST_LOOT_TABLES = { cave: CHEST_LOOT_RARE, forest: CHEST_LOOT_FOREST_RARE };

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ★重み付きで配列からエントリを1つ選ぶ（weightが無ければ1として扱うので、
//   これまで通りの均等抽選テーブルにそのまま使っても結果は変わらない）
function pickWeightedEntry(arr) {
  const total = arr.reduce((sum, e) => sum + (e.weight || 1), 0);
  let roll = Math.random() * total;
  for (const entry of arr) {
    roll -= (entry.weight || 1);
    if (roll < 0) return entry;
  }
  return arr[arr.length - 1];
}

// ★ニョードー街道は、まだ本編未実装の「？」相当の場所。マップ設定タブの「未実装」欄から
//   名前・解放条件・中身を編集して、実際に入れる場所に育てられる（adventuremap.js/mapareas.js参照）

// 町メニューの「冒険する」から呼ばれる：行き先をノードマップから選ばせる（adventuremap.js）
function openQuestMenu() {
  currentLocationKey = "town";
  openAdventureMap(); // adventuremap.js
}

// ★行き先メニューに「推奨Lv.◯〜」を添える（minMonsterLevelが無い場所＝グラスランド等は「Lv.1〜」扱い）
function adventureLocationLabel(locationKey) {
  const loc = ADVENTURE_LOCATIONS[locationKey];
  if (!loc) return locationKey;
  const recommendedLevel = loc.minMonsterLevel || 1;
  return `${loc.name}（推奨Lv.${recommendedLevel}〜）`;
}

// ===== 試練の祭殿：ランクC以上への昇格に必要な試練を受ける場所 =====
async function openTrialShrine() {
  hideLocationMenu();
  changeSpeaker("");
  
  const nextRank = getNextTrialRank(); // questboard.js
  
  if (!nextRank) {
    if (player && rankIndex(player.rank) + 1 >= RANK_ORDER.length) {
      await displayMessage("石碑は静まり返ったままだ。最高位まで上り詰めたあなたに、これ以上試すべきものは無いようだ……");
    } else {
      await displayMessage("石碑が静かに佇んでいる。まだあなたの実績では、試練の扉は開かないようだ。");
    }
    openTownMenu();
    return;
  }
  
  await displayMessage(`石碑が淡く輝き始めた。「${nextRank}ランクへの試練を受けるか？」`);
  
  const choice = await displayChoices([
    { text: "試練に挑む", next: "yes" },
    { text: "やめておく", next: "no", isBack: true }
  ]);
  
  if (choice.next === "no") {
    openTownMenu();
    return;
  }
  
  await startTrialBattle(nextRank); // battle.js
}

// 選んだ場所に入る
async function enterAdventureLocation(locationKey) {
  currentAdventureLocationKey = locationKey;
  const loc = ADVENTURE_LOCATIONS[locationKey];
  if (!loc) {
    // ★該当ロケーションが存在しない（マップ設定で削除された、または未定義）場合は、静かに町へ戻す
    if (typeof openTownMenu === "function") openTownMenu();
    return;
  }
  
  maybeAutoIncrementAreaVisit(locationKey);
  if (typeof checkAndAutoRunNextCustomChapter === "function" && await checkAndAutoRunNextCustomChapter("areaVisit", locationKey)) return; // ★「エリアに来た時」を始まるきっかけにしている話があれば、探索を始める前にここで始める
  currentAdventureMinMonsterLevel = loc.minMonsterLevel || 1; // ★この場所で出る魔物の最低レベル
  
  if (DEPTH_EVENT_CONFIG[locationKey]) {
    const config = DEPTH_EVENT_CONFIG[locationKey];
    depthCounter = 0;
    depthThreshold = config.min + Math.floor(Math.random() * (config.max - config.min + 1));
    depthEventDone = false;
  }
  
  // ★新しい滞在の開始：経過時間と「調べる」の結果キャッシュをリセットする
  adventureHoursThisTrip = 0;
  adventureExamineCache[locationKey] = null;
  if (loc.isCustomArea && loc.customAreaData) delete customAreaExamineCache[loc.customAreaData.id]; // ★カスタムエリアの「調べる」もこの滞在から改めて調べ直せるようにする
  
  hideLocationMenu();
  applyBackground(loc.background);
  if (typeof switchScenarioBGM === "function") switchScenarioBGM(`field_${locationKey}`, { fadeMs: 600 }); // bgm.js（既に流れていれば何もしない。曲ファイルが無ければ静かに失敗するだけ）
  changeSpeaker("");
  await displayMessage(`${loc.name}へとやってきた。`);
  
  openAdventureMenu();
}

// ★マップ設定タブ（scenariobuild.js/mapareas.js）で作ったエリアを、既存の探索の仕組み（前に進む／調べる／村へ戻る）に
//   そのまま乗せるため、ADVENTURE_LOCATIONSへその場で登録してしまう。BGMも同じ理屈でBGM_TRACK_PATHSへ登録する
//   ★explicitKeyを渡すと、"custom_"+idの代わりにそのキーで登録する
//     （「カデリクの街」など、マップ上の決まった場所に中身を作り込んだ場合、そのノードのidをそのまま使うため）
function registerCustomAreaAsLocation(area, explicitKey) {
  const locationKey = explicitKey || area.locationKey || ("custom_" + area.id);
  ADVENTURE_LOCATIONS[locationKey] = {
    name: area.name,
    background: area.bgImage ? { type: "image", value: area.bgImage } : { type: "color", value: "#000000" }, // ★以前はここが生の文字列のままで、applyBackground()が期待する{type,value}形式になっておらず、指定した画像が一切表示されないバグがあった
    encounterRate: 0.5,
    monsterPool: area.enemyIds && area.enemyIds.length > 0 ? area.enemyIds : [],
    minMonsterLevel: 1,
    fixedMonsterLevel: (typeof area.enemyLevel === "number" && area.enemyLevel > 0) ? area.enemyLevel : null, // ★エリア設定の「出現する敵のレベル」（未設定なら今まで通り主人公基準）
    isCustomArea: true,
    customAreaData: area
  };
  if (area.bgTrack && typeof BGM_TRACK_PATHS !== "undefined") {
    const resolved = BGM_TRACK_PATHS[area.bgTrack] || area.bgTrack.replace(/\.mp3$/i, "");
    BGM_TRACK_PATHS["field_" + locationKey] = resolved; // ★enterAdventureLocationが探しにいく曲名に合わせて登録しておく
  }
  return locationKey;
}

async function enterCustomMapArea(area, explicitKey) {
  if (typeof ensureCustomMonstersRegistered === "function") ensureCustomMonstersRegistered(); // scenariobuild.js
  customAreaForwardSteps = 0; // ★「敵エリア」で来た道を引き返す仕組み用のカウンタをリセットする
  const locationKey = registerCustomAreaAsLocation(area, explicitKey); // ★BGM/背景の登録も兼ねる。以後はこのlocationKeyで統一して扱う
  
  // ★シナリオ専用エリア：探索や施設一覧を出さず、来訪回数が指定回数に達していれば対応する話を始める。
  //   それ以外の来訪では、代わりに専用のメッセージだけ見せて村に戻す
  if (area.type === "scenario") {
    applyBackground(area.bgImage ? { type: "image", value: area.bgImage } : { type: "color", value: "#000000" });
    if (area.bgTrack && typeof switchScenarioBGM === "function") switchScenarioBGM("field_" + locationKey, { fadeMs: 600 });
    maybeAutoIncrementAreaVisit(locationKey);
    if (typeof checkAndAutoRunNextCustomChapter === "function" && await checkAndAutoRunNextCustomChapter("areaVisit", locationKey)) return;
    changeSpeaker("");
    await displayMessage(area.nonScenarioMessage || "特に何もないようだ。");
    if (typeof openTownMenu === "function") await openTownMenu();
    return;
  }
  
  // ★街・国・村タイプは、森・草原・洞窟のようなダンジョン探索ではなく、カリの村と同じ
  //   「施設一覧から選ぶ」平和な拠点として開く（以前はtypeを見ずに全部ダンジョン探索扱いになっていた）
  if (["city", "country", "village"].includes(area.type) && typeof openCustomSettlementArea === "function") {
    maybeAutoIncrementAreaVisit(locationKey);
    if (typeof checkAndAutoRunNextCustomChapter === "function" && await checkAndAutoRunNextCustomChapter("areaVisit", locationKey)) return;
    await openCustomSettlementArea(area); // town.js
    return;
  }
  await enterAdventureLocation(locationKey); // ★あとは通常の場所とまったく同じ仕組みで動く（来訪回数の加算・開始トリガー判定もここで行われる）
}

// ★「敵エリア」タイプのマップ設定エリアでは、進んだ分だけ同じ歩数を「引き返す」必要がある
let customAreaForwardSteps = 0;

// 探索中のメインメニュー（前に進む/調べる/村へ戻る、または敵エリアでは「引き返す」）
function openAdventureMenu() {
  const loc = ADVENTURE_LOCATIONS[currentAdventureLocationKey];
  // ★以前はisCustomArea（マップ編集で作ったエリア）限定だったため、森・草原・洞窟など既存の探索先では
  //   どれだけ奥まで進んでも「村へ戻る」で即座に戻れてしまっていた。
  //   村・街・国タイプの拠点（平和な場所）以外は、既存も新規も区別なく引き返しが必要になるよう統一した
  const isPeacefulBase = loc.isCustomArea && ["village", "city", "country"].includes(loc.customAreaData.type);
  const mustRetrace = !isPeacefulBase && customAreaForwardSteps > 0;
  
  const options = [
    { label: "前に進む", action: () => adventureMoveForward() },
    { label: "調べる", action: () => adventureExamine() }
  ];
  
  if (mustRetrace) {
    options.push({ label: `引き返す（残り${customAreaForwardSteps}歩）`, action: () => adventureRetreatStep() });
  } else {
    options.push({ label: "拠点へ戻る", action: () => leaveAdventure() });
  }
  
  showLocationMenu(options, loc.name);
}

// ★敵エリアの奥から、進んだのと同じ歩数だけ引き返す。戻る途中も普通に遭遇の危険がある
async function adventureRetreatStep() {
  hideLocationMenu();
  changeSpeaker("");
  
  const fatigueResult = applyActionFatigue(3); // player.js
  renderStatusHUD();
  if (fatigueResult.hpDrained > 0) {
    await displayMessage(`疲労のあまり、体力が${fatigueResult.hpDrained}削られた……`);
    if (await checkFatigueCollapse()) return;
  }
  
  const poisonResult = applyPoisonTick(); // player.js
  if (poisonResult.damage > 0) {
    renderStatusHUD();
    await displayMessage(`体が毒に蝕まれ、体力が${poisonResult.damage}削られた……`);
    if (await checkFatigueCollapse()) return;
  }
  
  advanceAdventureTime(0.5);
  // ★進む時は1歩ずつ増えるが、戻る時は2歩分ずつ戻れるようにする（要望対応）
  customAreaForwardSteps = Math.max(0, customAreaForwardSteps - 2);
  
  if (customAreaForwardSteps === 0) {
    await displayMessage("来た道を戻り、ようやく入り口が見えてきた……");
    await leaveAdventure();
    return;
  }
  
  await displayMessage("来た道を戻っていく……");
  await checkForEncounter(); // ★戻る途中も油断はできない
}

async function leaveAdventure() {
  hideLocationMenu();
  changeSpeaker("");
  await displayMessage("拠点へと戻ることにした。");
  // ★要望対応：以前は必ずカリの村（openTownMenu）へ戻していたが、直前に立ち寄った拠点
  //   （player.lastVisitedBaseKey。敗北時の強制送還と同じ記録）へ戻すように変更。
  //   記録が無い・見つからない場合だけ、従来通りカリの村へ戻す
  const returnedToBase = typeof resumeLocationDynamic === "function" && player.lastVisitedBaseKey
    && resumeLocationDynamic(player.lastVisitedBaseKey); // convenience.js
  if (!returnedToBase) openTownMenu();
}

// ★冒険中の行動で力尽きた（HPが0になった）場合の共通処理。true を返したら、
//   呼び出し元はそれ以上の処理を続けず即座に return すること
// ★以前はここでopenTownMenu()に飛ばすだけで、力尽きた本人のHPが0のまま・疲労度や眠気もそのまま・
//   敵エリアで進んでいた歩数（customAreaForwardSteps）もリセットされずに残ってしまっていた
//   （次にその敵エリアへ入ると、途中から進んでいた扱いになってしまうバグの原因）。
//   ここでHP・SPを全回復、疲労度・眠気を0に戻し、歩数カウンタもリセットしてから村へ送還する
async function checkFatigueCollapse() {
  if (player.gauges.hp.current > 0) return false;
  player.gauges.hp.current = player.gauges.hp.max;
  player.gauges.sp.current = player.gauges.sp.max;
  player.gauges.fatigue.current = 0;
  player.gauges.sleepiness.current = 0;
  customAreaForwardSteps = 0;
  renderStatusHUD();
  changeSpeaker("");
  await displayMessage("気を失っている間に、誰かに救助されたようだ……気づくと村の入り口に横たわっていた。");
  openTownMenu();
  return true;
}

// 「調べる」：場所ごとに内容が異なる
async function adventureExamine() {
  hideLocationMenu();
  changeSpeaker("");
  
  // ★調べるのも「行動」なので疲労度が溜まる。疲弊状態ならHPも少し削られる
  const fatigueResult = applyActionFatigue(2); // player.js
  renderStatusHUD();
  if (fatigueResult.hpDrained > 0) {
    await displayMessage(`疲労のあまり、体力が${fatigueResult.hpDrained}削られた……`);
    if (await checkFatigueCollapse()) return;
  }
  
  // ★毒状態なら、行動するたびにHPが少し削られる
  const poisonResult = applyPoisonTick(); // player.js
  if (poisonResult.damage > 0) {
    renderStatusHUD();
    await displayMessage(`体が毒に蝕まれ、体力が${poisonResult.damage}削られた……`);
    if (await checkFatigueCollapse()) return;
  }
  
  const loc = ADVENTURE_LOCATIONS[currentAdventureLocationKey];
  if (loc && loc.isCustomArea) {
    await examineCustomArea(loc.customAreaData);
  } else if (currentAdventureLocationKey === "cave") {
    await examineCave();
  } else if (currentAdventureLocationKey === "forest") {
    await examineForest();
  } else {
    await examineGrassland();
  }
}

// ★マップ設定タブで作ったエリア用の「調べる」。複数登録されたメッセージからランダムで1つ表示し、
//   さらに一定確率でメッセージの代わりに「特に何も見つからなかった。」を出す。その後、アイテムがあれば低確率で発見する。
//   ★以前はexamineMessage（1本の固定文）しか無かったが、examineMessages（配列）から選ぶように変更した
const EXAMINE_NOTHING_FOUND_CHANCE = 0.2; // ★何も見つからなかった扱いになる確率（20%）
async function examineCustomArea(area) {
  // ★以前はここでキャッシュを一切見ていなかったため、同じ場所を何度でも際限なく調べ直せてしまっていた。
  //   この滞在中に一度調べていたら、それ以上は「ここはもう調べた。」とだけ表示して終わる
  if (customAreaExamineCache[area.id]) {
    await displayMessage("ここはもう調べた。");
    openAdventureMenu();
    return;
  }
  customAreaExamineCache[area.id] = true;
  
  // ★「調べた時に出るボス」方式（area.bossTriggerTypesに"examine"が含まれる場合）。
  //   ガマジルの草原（examineGrassland）の組み込みミニボスと同じ考え方で、アイテム・お金より
  //   優先してこちらを先に判定する（ボスが出た場合は、そのまま戦闘に入りアイテム等の抽選はしない）
  if (area.bossId && Array.isArray(area.bossTriggerTypes) && area.bossTriggerTypes.includes("examine")) {
    const bossChance = Number(area.bossExamineChance) || 0;
    if (bossChance > 0 && Math.random() < bossChance) {
      if (typeof ensureCustomMonstersRegistered === "function") ensureCustomMonstersRegistered();
      changeSpeaker("");
      await displayMessage("……何か大きなものの気配がする！");
      await startBattle(area.bossId); // battle.js。戦闘後の処理はbattle.js側に任せる
      return;
    }
  }
  
  // ★「調べる」で指定した施設が現れることがあるようにする（要望対応）。マップ編集で登録した
  //   複数の候補（area.facilitySpawns、それぞれ確率chanceを持つ）を上から順に見て、最初に
  //   確率を引き当てた施設に、そのままその場で入る（アイテム・お金より優先する）
  if (Array.isArray(area.facilitySpawns)) {
    for (const spawn of area.facilitySpawns) {
      const chance = Number(spawn.chance) || 0;
      if (chance <= 0) continue;
      if (Math.random() < chance) {
        const facility = (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.facilities))
          ? scenarioProject.facilities.find(f => f.id === spawn.facilityId) : null;
        if (facility) {
          changeSpeaker("");
          await displayMessage(`「${facility.name || "？"}」があった。`);
          await openCustomFacility(facility, () => openAdventureMenu()); // town.js
          return;
        }
        break;
      }
    }
  }
  
  const variants = Array.isArray(area.examineMessages) && area.examineMessages.length > 0
    ? area.examineMessages
    : (area.examineMessage ? [area.examineMessage] : []); // ★旧データ（examineMessage単体）との互換
  
  // ★以前はメッセージの抽選（「特に何も見つからなかった」になるかどうか）と、アイテムが見つかるかどうかの
  //   抽選が完全に別々に行われていたため、「特に何も見つからなかった」と表示されたのにアイテムはもらえる、
  //   という食い違いが起きていた。アイテムが見つかった時は、必ずそれが分かるメッセージ（無ければアイテムを
  //   見つけた旨だけ）を表示し、「特に何も見つからなかった」を出す時はアイテムを渡さないようにする
  let foundItemId = null;
  if (area.items && area.items.length > 0 && Math.random() < 0.35) {
    const candidateId = area.items[Math.floor(Math.random() * area.items.length)];
    if (typeof ITEM_MASTER !== "undefined" && ITEM_MASTER[candidateId]) foundItemId = candidateId;
  }
  
  // ★追加したエリアでも「調べる」でお金（陳）を見つけられるようにする（要望対応）。
  //   マップ編集で複数の報酬候補（area.goldRewards、それぞれ確率chance・獲得量min〜maxを持つ）を
  //   登録でき、アイテムとは独立に抽選する（両方同時に見つかることもある）。上から順に見て、
  //   最初に確率を引き当てた候補の金額だけを渡す（1回の「調べる」で複数の候補が重複しないように）
  let foundGoldAmount = 0;
  if (Array.isArray(area.goldRewards)) {
    for (const reward of area.goldRewards) {
      const chance = Number(reward.chance) || 0;
      if (chance <= 0) continue;
      if (Math.random() < chance) {
        const min = Number(reward.min) || 0;
        const max = Math.max(min, Number(reward.max) || min);
        foundGoldAmount = min + Math.floor(Math.random() * (max - min + 1));
        break;
      }
    }
  }
  
  if (foundItemId || foundGoldAmount > 0) {
    if (variants.length > 0) await displayMessage(variants[Math.floor(Math.random() * variants.length)]);
    if (foundItemId) {
      addItem(foundItemId, 1);
      changeSpeaker("");
      await displayMessage(`「${ITEM_MASTER[foundItemId].name}」を見つけた！`);
    }
    if (foundGoldAmount > 0) {
      changeGold(foundGoldAmount); // inventory.js
      changeSpeaker("");
      await displayMessage(`${foundGoldAmount}陳を見つけた！`);
    }
    renderStatusHUD();
  } else if (variants.length > 0 && Math.random() >= EXAMINE_NOTHING_FOUND_CHANCE) {
    await displayMessage(variants[Math.floor(Math.random() * variants.length)]);
  } else {
    await displayMessage("特に何も見つからなかった。");
  }
  
  openAdventureMenu();
}

async function examineCave() {
  const loc = ADVENTURE_LOCATIONS.cave;
  
  // ★この滞在中、既に一度調べていれば同じ結果を再利用する（新しく乱数を引き直さない）
  let cache = adventureExamineCache.cave;
  if (!cache) {
    cache = { roll: Math.random() };
    if (cache.roll < 0.25 + getExploreFindBonus()) {
      cache.foundItemId = pickWeightedItemId(loc.findPool);
      cache.itemGiven = false;
    } else if (cache.roll < 0.55) {
      cache.foundGold = 15 + Math.floor(Math.random() * 26); // 15〜40陳
      cache.goldGiven = false;
    }
    adventureExamineCache.cave = cache;
  }
  
  const roll = cache.roll;
  advanceAdventureTime(0.5); // 調べるのにも少し時間がかかる（一手=30分）
  
  if (roll < 0.25) {
    const master = ITEM_MASTER[cache.foundItemId];
    if (!cache.itemGiven) {
      addItem(cache.foundItemId, 1);
      cache.itemGiven = true;
      await displayMessage(`あたりを調べてみると……「${master.name}」を見つけた！`);
    } else {
      await displayMessage(`さっき「${master.name}」を見つけた場所だ。もう他には何も残っていないようだ。`);
    }
    
  } else if (roll < 0.35) {
    await displayMessage("壁際に、やせ細った男性が横たわっている……微動だにしない。サキュバスに搾り尽くされたようだ...");
    await displayMessage("しかしまだ生きているようだ...むしろアソコ以外はまだある程度回復してきているみたい。");
    
  } else if (roll < 0.45) {
    await displayMessage("床には、ゴブリンの群れに滅多刺しにされたらしき冒険者の亡骸が散らばっていた……");
    
  } else if (roll < 0.55) {
    // ★調べていて偶然お金を見つけるケース（宝箱や魔物討伐以外の収入源）
    if (!cache.goldGiven) {
      changeGold(cache.foundGold); // inventory.js
      cache.goldGiven = true;
      renderStatusHUD();
      await displayMessage(`地面に落ちていた古い革袋を拾った。中には${cache.foundGold}陳が入っていた！`);
    } else {
      await displayMessage("さっきお金を見つけた場所だ。もう他には何も残っていないようだ。");
    }
    
  } else {
    await displayMessage("あたりを調べてみたが、特に何も見つからなかった。");
  }
  
  openAdventureMenu();
}

async function examineGrassland() {
  const loc = ADVENTURE_LOCATIONS.grassland;
  
  // ★この滞在中、既に一度調べていれば同じ結果を再利用する（新しく乱数を引き直さない）
  let cache = adventureExamineCache.grassland;
  if (!cache) {
    cache = { roll: Math.random() };
    if (cache.roll < 0.35 + getExploreFindBonus()) {
      cache.foundItemId = pickWeightedItemId(loc.findPool);
      cache.itemGiven = false;
    } else if (cache.roll >= 0.5 && cache.roll < 0.75) {
      cache.foundGold = 20 + Math.floor(Math.random() * 31); // 20〜50陳
      cache.goldGiven = false;
    }
    adventureExamineCache.grassland = cache;
  }
  
  const roll = cache.roll;
  advanceAdventureTime(0.5); // 調べるのにも少し時間がかかる（一手=30分）
  
  if (roll < 0.35) {
    const master = ITEM_MASTER[cache.foundItemId];
    if (!cache.itemGiven) {
      addItem(cache.foundItemId, 1);
      cache.itemGiven = true;
      await displayMessage(`草むらをかき分けてみると……「${master.name}」を見つけた！`);
    } else {
      await displayMessage(`さっき「${master.name}」を見つけた場所だ。もう他には何も残っていないようだ。`);
    }
    
  } else if (roll < 0.5) {
    // ★同じ地点をもう一度調べても、ミニボスとは戦闘済みなら再戦させない
    //   （これが無いと、調べるたびに何度でも同じミニボスと戦う羽目になっていた）
    if (!cache.battled) {
      cache.battled = true;
      await displayMessage("草むらの奥で、何か大きなものが動いた気配がする……！");
      await startBattle("grassland_miniboss"); // battle.js。戦闘後の処理はbattle.js側に任せる
      return;
    } else {
      await displayMessage("さっき何かがいた場所だ。今はもう気配が無いようだ。");
    }
    
  } else if (roll < 0.75) {
    // ★調べていて偶然お金を見つけるケース（宝箱や魔物討伐以外の収入源）
    if (!cache.goldGiven) {
      changeGold(cache.foundGold); // inventory.js
      cache.goldGiven = true;
      renderStatusHUD();
      await displayMessage(`草むらの中に、落とし物らしき小袋を見つけた。中には${cache.foundGold}陳が入っていた！`);
    } else {
      await displayMessage("さっきお金を見つけた場所だ。もう他には何も残っていないようだ。");
    }
    
  } else {
    await displayMessage("あたりを調べてみたが、特に何も見つからなかった。");
  }
  
  openAdventureMenu();
}

async function examineForest() {
  const loc = ADVENTURE_LOCATIONS.forest;
  
  // ★この滞在中、既に一度調べていれば同じ結果を再利用する（新しく乱数を引き直さない）
  let cache = adventureExamineCache.forest;
  if (!cache) {
    cache = { roll: Math.random() };
    if (cache.roll < 0.35 + getExploreFindBonus()) {
      cache.foundItemId = pickWeightedItemId(loc.findPool);
      cache.itemGiven = false;
    } else if (cache.roll >= 0.5 && cache.roll < 0.72) {
      cache.foundGold = 20 + Math.floor(Math.random() * 31); // 20〜50陳
      cache.goldGiven = false;
    }
    adventureExamineCache.forest = cache;
  }
  
  const roll = cache.roll;
  advanceAdventureTime(0.5); // 調べるのにも少し時間がかかる（一手=30分）
  
  if (roll < 0.35) {
    const master = ITEM_MASTER[cache.foundItemId];
    if (!cache.itemGiven) {
      addItem(cache.foundItemId, 1);
      cache.itemGiven = true;
      await displayMessage(`木々の根元を調べてみると……「${master.name}」を見つけた！`);
    } else {
      await displayMessage(`さっき「${master.name}」を見つけた場所だ。もう他には何も残っていないようだ。`);
    }
    
  } else if (roll < 0.5) {
    await displayMessage("木の幹に、獣の爪痕のようなものが深く刻まれている……この森に棲む何かのものだろうか。");
    
  } else if (roll < 0.72) {
    // ★調べていて偶然お金を見つけるケース（宝箱や魔物討伐以外の収入源）
    if (!cache.goldGiven) {
      changeGold(cache.foundGold); // inventory.js
      cache.goldGiven = true;
      renderStatusHUD();
      await displayMessage(`苔むした木の根元に、旅人が落としたらしき小袋を見つけた。中には${cache.foundGold}陳が入っていた！`);
    } else {
      await displayMessage("さっきお金を見つけた場所だ。もう他には何も残っていないようだ。");
    }
    
  } else {
    await displayMessage("あたりを調べてみたが、鬱蒼とした木々があるばかりで特に何も見つからなかった。");
  }
  
  openAdventureMenu();
}
async function adventureMoveForward() {
  hideLocationMenu();
  changeSpeaker("");
  const loc = ADVENTURE_LOCATIONS[currentAdventureLocationKey];
  
  // ★1歩進んだら「別の場所」に来たことになるので、「調べる」の結果キャッシュはリセットする。
  //   （これが無いと、進んだ後に調べても前の地点の「もう拾った」等の結果を使い回してしまっていた）
  adventureExamineCache[currentAdventureLocationKey] = null;
  // ★マップ編集で作ったカスタムエリアは、examineCustomArea()が別の専用キャッシュ
  //   （customAreaExamineCache、エリアid単位）を見ているため、上のadventureExamineCacheを
  //   クリアするだけでは反映されず、進んだ後に調べても「ここはもう調べた」と誤表示されてしまっていた。
  //   こちらも合わせてクリアする
  if (loc.isCustomArea && loc.customAreaData) delete customAreaExamineCache[loc.customAreaData.id];
  
  // ★進むのも「行動」なので疲労度が溜まる。疲弊状態ならHPも少し削られる。眠気の上昇量は要望により1.5に指定
  const fatigueResult = applyActionFatigue(3, 1.5); // player.js（調べるより負荷が大きいので少し多め）
  renderStatusHUD();
  if (fatigueResult.hpDrained > 0) {
    await displayMessage(`疲労のあまり、体力が${fatigueResult.hpDrained}削られた……`);
    if (await checkFatigueCollapse()) return;
  }
  
  // ★毒状態なら、行動するたびにHPが少し削られる
  const poisonResult = applyPoisonTick(); // player.js
  if (poisonResult.damage > 0) {
    renderStatusHUD();
    await displayMessage(`体が毒に蝕まれ、体力が${poisonResult.damage}削られた……`);
    if (await checkFatigueCollapse()) return;
  }
  
  // ★進むのも一手として扱い、30分ずつ経過させる（1回の滞在で最大12時間まで）
  advanceAdventureTime(0.5);
  
  // ★「敵エリア」（村・街・国タイプの拠点以外）では、進むたびに「引き返す」のに必要な歩数が増える。
  //   既存の森・草原・洞窟も含め、全ての探索先で共通の仕組みにした
  if (!(loc.isCustomArea && ["village", "city", "country"].includes(loc.customAreaData.type))) {
    customAreaForwardSteps++;
  }
  
  // ★洞窟・森など、最奥イベントがある場所だけ、進んだ回数をカウントして判定する
  const depthConfig = DEPTH_EVENT_CONFIG[currentAdventureLocationKey];
  if (depthConfig) {
    depthCounter++;
    
    if (!depthEventDone && depthCounter >= depthThreshold) {
      depthEventDone = true;
      await handleLocationDepthsEvent(currentAdventureLocationKey);
      return;
    }
  }
  
  // ★分かれ道（洞窟・森のみ）
  if (loc.forkRate > 0 && Math.random() < loc.forkRate) {
    await handleAdventureFork();
    return;
  }
  
  await displayMessage("奥へと進んでいく……");
  await checkForEncounter();
}

// 最奥イベント：運が良ければ宝箱、悪ければボスが出る（ボスを倒せばより豪華な宝箱になる）
async function handleLocationDepthsEvent(locationKey) {
  const config = DEPTH_EVENT_CONFIG[locationKey];
  await displayMessage(config.flavorText);
  
  const isLucky = Math.random() < 0.5;
  
  if (isLucky) {
    await displayMessage("奥には古びた宝箱が置かれていた！");
    await openTreasureChest(CHEST_LOOT_NORMAL);
    await returnFromLocationDepths(locationKey);
  } else {
    await displayMessage("奥に何かの気配がする……と思った瞬間、大きな影が立ちはだかった！");
    pendingBossReward = locationKey;
    const loc = ADVENTURE_LOCATIONS[locationKey];
    await startBattle(config.bossKey, { fixedLevel: loc ? loc.fixedMonsterLevel : null }); // battle.js。勝敗後の処理は returnToAdventureAfterBattle 側で分岐する
  }
}

// 宝箱を開ける共通処理
async function openTreasureChest(lootTable) {
  changeSpeaker("");
  const loot = pickWeightedEntry(lootTable);
  addItem(loot.itemId, 1);
  changeGold(loot.gold);
  renderStatusHUD();
  const master = ITEM_MASTER[loot.itemId];
  await displayMessage(`宝箱の中には「${master.name}」と、${loot.gold}陳が入っていた！`);
}

// 最奥イベントを終えたら、区切りとして村へ戻す
async function returnFromLocationDepths(locationKey) {
  changeSpeaker("");
  if (locationKey === "forest") {
    await displayMessage("満足のいく成果を得て、幻魔の森を後にすることにした。");
  } else {
    await displayMessage("満足のいく成果を得て、洞窟を後にすることにした。");
  }
  openTownMenu();
}

// 分かれ道：左右どちらに進むか選ばせてから、通常通り遭遇判定を行う
async function handleAdventureFork() {
  await displayMessage("道が二つに分かれている……どちらに進む？");
  
  const forkChoice = await displayChoices([
    { text: "左の道", next: "left" },
    { text: "右の道", next: "right" }
  ]);
  
  changeSpeaker("");
  await displayMessage(`${forkChoice.next === "left" ? "左" : "右"}の道を選んで進んだ。`);
  await checkForEncounter();
}

// 魔物との遭遇判定。遭遇したら戦闘（battle.js）へ、しなければ探索メニューに戻る
async function checkForEncounter() {
  const loc = ADVENTURE_LOCATIONS[currentAdventureLocationKey];
  const battleOptions = { fixedLevel: loc.fixedMonsterLevel || null }; // ★エリア固定レベルの指定があれば、それを最優先で使う（battle.js側）
  
  // ★マップ設定タブで作ったエリアにボスが設定されていれば、低確率で単独で現れる
  //   ★以前は「歩数進んだら確率で出る」方式に固定だったが、要望によりarea.bossTriggerTypesで
  //     出現方式を選べるようにした（["step"]＝歩数進んだら確率で、["examine"]＝調べた時に、
  //     両方選べば複数選択可）。未設定（旧データ）は従来通り["step"]扱いにする
  const bossTriggerTypes = (loc.isCustomArea && Array.isArray(loc.customAreaData.bossTriggerTypes) && loc.customAreaData.bossTriggerTypes.length > 0)
    ? loc.customAreaData.bossTriggerTypes : ["step"];
  if (loc.isCustomArea && loc.customAreaData.bossId && bossTriggerTypes.includes("step")
      && Math.random() < (Number(loc.customAreaData.bossStepChance) || 0.08)) {
    if (typeof ensureCustomMonstersRegistered === "function") ensureCustomMonstersRegistered();
    await startBattle(loc.customAreaData.bossId, battleOptions); // battle.js
    return;
  }
  
  const encounterAvoidBonus = (typeof hasPassiveSkill === "function" && hasPassiveSkill("encounterAvoid")) ? 0.08 : 0; // ★お宝鑑定団の「舌先三寸」（player.js）
  if (Math.random() < loc.encounterRate - encounterAvoidBonus) {
    // ★戦闘バリエーション（特定の敵の組み合わせ）が登録されていれば、そこから重み付きで選ぶ
    if (loc.isCustomArea && loc.customAreaData.battleVariations && loc.customAreaData.battleVariations.length > 0) {
      if (typeof ensureCustomMonstersRegistered === "function") ensureCustomMonstersRegistered();
      const keys = pickCustomAreaBattleVariation(loc.customAreaData.battleVariations);
      await startBattle(keys, battleOptions); // battle.js
      return;
    }
    
    if (loc.monsterPool.length === 0) {
      await displayMessage("特に何も起こらなかった。");
      openAdventureMenu();
      return;
    }
    
    const monsterKey = loc.monsterPool[Math.floor(Math.random() * loc.monsterPool.length)];
    const groupSize = rollEncounterGroupSize(); // ★通常は1体だが、たまに同じ魔物が群れで現れる（battle.jsが複数体に対応済み）
    await startBattle(Array(groupSize).fill(monsterKey), battleOptions); // battle.js
    return;
  }
  
  await displayMessage("特に何も起こらなかった。");
  openAdventureMenu();
}

// ★戦闘バリエーションの中から、重み(weight)に応じて1つを抽選する
function pickCustomAreaBattleVariation(variations) {
  const totalWeight = variations.reduce((sum, v) => sum + (Number(v.weight) || 1), 0);
  let roll = Math.random() * totalWeight;
  for (const variation of variations) {
    roll -= (Number(variation.weight) || 1);
    if (roll <= 0) return variation.enemyIds.slice(0, 5); // ★1戦闘の最大体数（battle.js）に合わせる
  }
  return variations[variations.length - 1].enemyIds.slice(0, 5);
}

// ★雑魚敵の遭遇1回あたりの体数を決める。ほとんどは1体だが、たまに2〜3体の群れになる
function rollEncounterGroupSize() {
  const roll = Math.random();
  if (roll < 0.15) return 3;
  if (roll < 0.40) return 2;
  return 1;
}

// 戦闘が終わった後、battle.js から呼ばれる。探索の続きに戻す
// outcome: "win"（勝利） / "flee"（逃走成功） / "defeat"（敗北） のいずれか
async function returnToAdventureAfterBattle(outcome) {
  const loc = ADVENTURE_LOCATIONS[currentAdventureLocationKey];
  applyBackground(loc.background); // ★戦闘中に変えていた背景を、探索中の背景に戻す
  
  if (outcome === "defeat") {
    pendingBossReward = null; // ★敗北した場合は豪華な宝箱は出さない
    // ★敗北（力尽きた）場合は直前に立ち寄った拠点へ強制送還する。checkFatigueCollapse()と同じく、
    //   SPを全回復、疲労度・眠気を0に戻し、敵エリアの歩数カウンタもリセットしてから送還する
    //   （以前はここもリセットされておらず、歩数も引き継がれたままになる不具合があった）
    //   ★要望対応：HPは全回復ではなく、handleBattleDefeat()で1割にしたままにしておく
    //   （パーティ全員、戦闘不能状態から1割HPで復活する仕様に変更したため）
    player.gauges.sp.current = player.gauges.sp.max;
    player.gauges.fatigue.current = 0;
    player.gauges.sleepiness.current = 0;
    customAreaForwardSteps = 0;
    renderStatusHUD();
    changeSpeaker("");
    const goldLostMessage = (typeof lastDefeatGoldLoss === "number" && lastDefeatGoldLoss > 0)
      ? `気を失っている間に、誰かに救助されたようだ……気づくと見覚えのある場所に横たわっていた。財布から${lastDefeatGoldLoss}陳が消えている。`
      : "気を失っている間に、誰かに救助されたようだ……気づくと見覚えのある場所に横たわっていた。";
    await displayMessage(goldLostMessage);
    // ★要望対応：直前に立ち寄った拠点（player.lastVisitedBaseKey）へ戻す。
    //   記録が無い・見つからない場合だけ、従来通りカリの村へ戻す
    const returnedToBase = typeof resumeLocationDynamic === "function" && player.lastVisitedBaseKey
      && resumeLocationDynamic(player.lastVisitedBaseKey); // convenience.js
    if (!returnedToBase) openTownMenu(); // ★ここでtown.js側が村のBGMに切り替える
    return;
  }
  
  // ★勝利・逃走どちらでも探索へ戻るので、戦闘用BGMからこの場所のフィールドBGMに戻す
  if (typeof switchScenarioBGM === "function") switchScenarioBGM(`field_${currentAdventureLocationKey}`, { fadeMs: 600 }); // bgm.js
  
  if (outcome === "flee") {
    // ★ボスから逃げただけなので、倒した時だけの豪華な宝箱は出さない
    //   （ここが「逃げたのに宝箱が手に入る」バグの原因だった：以前は勝利と同じ扱いにしていた）
    if (pendingBossReward) {
      pendingBossReward = null;
      changeSpeaker("");
      await displayMessage("結局、奥に潜んでいた何かの正体は確かめられなかった……");
    }
    openAdventureMenu();
    return;
  }
  
  // ★ここに来るのは outcome === "win"（実際に勝利した）時だけ
  // ボスに勝った直後なら、通常の探索には戻さず、より豪華な宝箱を出してから村へ戻す
  if (pendingBossReward) {
    const bossLocationKey = pendingBossReward;
    pendingBossReward = null;
    changeSpeaker("");
    await displayMessage("ボスを倒すと、その奥にひときわ豪華な宝箱が現れた！");
    await openTreasureChest(CHEST_LOOT_TABLES[bossLocationKey] || CHEST_LOOT_RARE);
    await returnFromLocationDepths(bossLocationKey);
    return;
  }
  
  openAdventureMenu();
}