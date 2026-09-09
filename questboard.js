// questboard.js
// 酒場の「クエストを見る」から開く、クエスト掲示板の画面。
// メイン画面いっぱいに、左に依頼の一覧（ランクフィルタ付き）、右に選んだ依頼の詳細を表示する。
// ★以前はデータ部分を quest.js という別ファイルに分けていたが、
//   読み込み忘れ（404）で動かなくなるのを防ぐため、このファイル1つにまとめてある。

// ランクは F → E → D → C → B → A → AA → AAA → S → SS → SSS → X の順で強くなる想定。
// ★序盤のため、掲示板には F〜B ランクの依頼までしか貼り出されていない。
//   （Aランク以上の依頼はまだ準備中。ストーリーが進んだらQUEST_BOARDに追加していく）
const RANK_ORDER = ["F", "E", "D", "C", "B", "A", "AA", "AAA", "S", "SS", "SSS", "X"];

function rankIndex(rank) {
  const index = RANK_ORDER.indexOf(rank);
  return index === -1 ? 0 : index;
}

// ===== 名声度（隠しステータス）とランクアップ =====
// ★名声度はクエストをクリアした時だけ増える隠しステータス。一定量たまるとランクが上がる。
const FAME_RANK_THRESHOLDS = {
  F: 0,
  E: 40,
  D: 100,
  C: 200,
  B: 350,
  A: 550,
  AA: 800,
  AAA: 1150,
  S: 1600,
  SS: 2200,
  SSS: 3000,
  X: 4000
};
// ★シナリオ設定で名声度のしきい値を上書きできるようにするための、初期値の控え（スキル管理タブ側で参照する）
const DEFAULT_FAME_RANK_THRESHOLDS = { ...FAME_RANK_THRESHOLDS };

// ★名声度の値だけから、単純に「今の名声度なら本来到達しているはずのランク」を求める
//   （試練の有無は見ない。C以上でも試練未クリアなら実際のランクには反映されないので、
//   別途 computeAttainableRank() 側でその調整をする）
function computeFameEarnedRank() {
  if (!player) return "F";
  if (typeof player.fame !== "number") player.fame = 0;
  
  let earnedRank = "F";
  for (const rank of RANK_ORDER) {
    if (player.fame >= FAME_RANK_THRESHOLDS[rank]) earnedRank = rank;
  }
  return earnedRank;
}

// ★名声度としては到達しているが、ランクC以上は「試練の祭殿」で該当ランクの試練をクリアしていないと
//   実際のランクには反映されない（player.clearedTrialRanksに記録される）
function computeAttainableRank() {
  if (!player) return "F";
  
  const earnedRank = computeFameEarnedRank();
  if (rankIndex(earnedRank) < rankIndex("C")) return earnedRank; // ★C未満は試練不要でそのまま反映
  
  let attainable = "F";
  for (const rank of RANK_ORDER) {
    if (rankIndex(rank) > rankIndex(earnedRank)) break;
    if (rankIndex(rank) < rankIndex("C") || (player.clearedTrialRanks || []).includes(rank)) {
      attainable = rank;
    }
  }
  return attainable;
}

// 名声度・試練クリア状況から、今上げられるところまでランクを上げる（rankUpとnewRankを返す）
function applyAttainableRank() {
  if (!player) return { rankUp: false, newRank: "F" };
  const newRank = computeAttainableRank();
  const rankUp = rankIndex(newRank) > rankIndex(player.rank);
  if (rankUp) {
    setRank(newRank); // player.js
    addProgressPoints(30); // ★ランクアップで進行度+30（player.js）
  }
  return { rankUp, newRank };
}

// 名声度を加算し、必要ならランクを引き上げる
// @returns {{rankUp: boolean, newRank: string, trialReadyRank: string|null}}
//   trialReadyRank … 今回名声度が伸びたことで新たに「試練に挑めるランク」が解放された場合、そのランク名
//   （C未満は試練不要でrankUp側にそのまま出るので、trialReadyRankが立つのはC以上だけ）
function addFameAndCheckRankUp(amount) {
  if (!player || !amount || amount <= 0) return { rankUp: false, newRank: player ? player.rank : "F", trialReadyRank: null };
  if (typeof player.fame !== "number") player.fame = 0;
  if (!Array.isArray(player.notifiedTrialRanks)) player.notifiedTrialRanks = [];
  
  player.fame += amount;
  const result = applyAttainableRank();
  
  // ★getNextTrialRank()は「player.rankのすぐ次・C以上・名声度は足りている・試練は未クリア」の時だけランクを返す。
  //   まだポップアップで知らせていないランクなら、ここで知らせた扱いにして二度と出さないようにする
  let trialReadyRank = getNextTrialRank();
  if (!trialReadyRank || player.notifiedTrialRanks.includes(trialReadyRank)) {
    trialReadyRank = null;
  } else {
    player.notifiedTrialRanks.push(trialReadyRank);
  }
  
  return { ...result, trialReadyRank };
}

// ★試練の祭殿から呼ぶ：今挑める試練のランクを返す（無ければnull）。
//   「次のランクぴったり」だけを対象にする（飛び級はさせない）
function getNextTrialRank() {
  if (!player) return null;
  const nextRank = RANK_ORDER[rankIndex(player.rank) + 1];
  if (!nextRank) return null; // ★既に最高ランク
  if (rankIndex(nextRank) < rankIndex("C")) return null; // ★C未満は試練不要（名声度だけで上がる）
  if ((player.clearedTrialRanks || []).includes(nextRank)) return null; // ★既にクリア済み
  
  let earnedRank = "F";
  for (const rank of RANK_ORDER) {
    if (player.fame >= FAME_RANK_THRESHOLDS[rank]) earnedRank = rank;
  }
  if (rankIndex(earnedRank) < rankIndex(nextRank)) return null; // ★まだ名声度が足りていない
  
  return nextRank;
}

// プレイヤーが指定ランクの依頼を受けられるかどうか
// （プレイヤーのランクが依頼の要求ランク以上であれば受注可能、という想定）
function isQuestAcceptable(quest) {
  if (!player) return false;
  return rankIndex(player.rank) >= rankIndex(quest.rank);
}

// クエスト掲示板に貼り出されている依頼一覧の「元データ」（マスター）。
// ★ここは書き換えない。実際に画面で使うのは、これを毎日0時に複製し直す QUEST_BOARD の方。
// rewardExp はモンスターを直接倒すよりもかなり多めに設定してある
// type: "hunt"（指定の魔物を倒す） / "gather"（指定のアイテムを規定数集めて納品する）
const QUEST_BOARD_MASTER = [
  {
    id: "quest_001",
    rank: "F",
    title: "村周辺のスライム討伐",
    description: "村の畑を荒らすスライムを何匹か間引いてほしい、という簡単な依頼。ガマジルの草原に出るスライムを3匹倒せば達成だ。",
    rewardGold: 40,
    rewardExp: 80,
    type: "hunt",
    targetMonsterKey: "slime",
    targetCount: 3
  },
  {
    id: "quest_002",
    rank: "F",
    title: "薬草採取の手伝い",
    description: "薬師のために、薬草を3つ集めてきてほしいという依頼。冒険先で「調べる」と見つかることがある。",
    rewardGold: 30,
    rewardExp: 60,
    type: "gather",
    targetItemId: "herb_001",
    targetCount: 3
  },
  {
    id: "quest_003",
    rank: "E",
    title: "行方不明の山羊探し",
    description: "牧場から逃げ出した山羊が、狼に襲われているらしいという噂がある。ガマジルの草原で、はぐれ狼を2匹討伐してほしいという依頼。",
    rewardGold: 50,
    rewardExp: 120,
    type: "hunt",
    targetMonsterKey: "wolf",
    targetCount: 2
  },
  {
    id: "quest_004",
    rank: "E",
    title: "森のゴブリン間引き",
    description: "アヌスの洞窟に住み着いたゴブリンの数を減らしてほしいという依頼。ゴブリンを3匹討伐すれば達成だ。",
    rewardGold: 70,
    rewardExp: 180,
    type: "hunt",
    targetMonsterKey: "goblin",
    targetCount: 3
  },
  {
    id: "quest_005",
    rank: "D",
    title: "洞窟の魔物調査",
    description: "アヌスの洞窟で、最近コウモリの魔物が増えているらしい。様子を見て、3匹ほど討伐してきてほしいという依頼。",
    rewardGold: 120,
    rewardExp: 300,
    type: "hunt",
    targetMonsterKey: "bat",
    targetCount: 3
  },
  {
    id: "quest_006",
    rank: "D",
    title: "野盗退治",
    description: "街道に出没するようになったゴブリンの野盗まがいの群れを追い払ってほしいという依頼。ゴブリンを5匹討伐すれば達成だ。",
    rewardGold: 140,
    rewardExp: 350,
    type: "hunt",
    targetMonsterKey: "goblin",
    targetCount: 5
  },
  {
    id: "quest_007",
    rank: "C",
    title: "希少な魔物素材の採取",
    description: "商人から依頼された、洞窟の奥に生息する魔物の素材を採ってきてほしいという依頼。「古びた竜の鱗」を1つ納品すれば達成だ。",
    rewardGold: 210,
    rewardExp: 550,
    type: "gather",
    targetItemId: "material_002",
    targetCount: 1
  },
  {
    id: "quest_008",
    rank: "C",
    title: "廃屋に出る怪異の調査",
    description: "村外れの廃屋で怪異が出ると噂されている。正体はどうやら洞窟コウモリの群れらしい。5匹討伐して噂を鎮めてほしいという依頼。",
    rewardGold: 230,
    rewardExp: 600,
    type: "hunt",
    targetMonsterKey: "bat",
    targetCount: 5
  },
  {
    id: "quest_009",
    rank: "B",
    title: "凶暴化した魔物の討伐",
    description: "ガマジルの草原で、普段より凶暴化した狼の主が目撃されている。討伐してほしいという、それなりに危険な依頼。",
    rewardGold: 350,
    rewardExp: 900,
    type: "hunt",
    targetMonsterKey: "grassland_miniboss",
    targetCount: 1
  },
  {
    id: "quest_010",
    rank: "E",
    title: "ネズミ駆除",
    description: "アヌスの洞窟の入り口付近で、巨大ネズミが大量発生しているらしい。4匹ほど駆除してほしいという依頼。",
    rewardGold: 50,
    rewardExp: 100,
    type: "hunt",
    targetMonsterKey: "giant_rat",
    targetCount: 4
  },
  {
    id: "quest_011",
    rank: "D",
    title: "亡霊騒ぎの真相",
    description: "洞窟の奥から物音がするという噂の正体は、どうやらスケルトンの群れらしい。3体討伐して騒ぎを鎮めてほしいという依頼。",
    rewardGold: 130,
    rewardExp: 320,
    type: "hunt",
    targetMonsterKey: "skeleton",
    targetCount: 3
  },
  {
    id: "quest_012",
    rank: "D",
    title: "森いのしし退治",
    description: "ガマジルの草原の畑を荒らす森いのししを、3匹ほど間引いてほしいという依頼。",
    rewardGold: 100,
    rewardExp: 260,
    type: "hunt",
    targetMonsterKey: "forest_boar",
    targetCount: 3
  },
  {
    id: "quest_013",
    rank: "C",
    title: "オークの偵察隊排除",
    description: "洞窟の浅い場所にオークの偵察隊が現れるようになった。本隊が来る前に2体討伐してほしいという依頼。",
    rewardGold: 250,
    rewardExp: 650,
    type: "hunt",
    targetMonsterKey: "orc",
    targetCount: 2
  },
  {
    id: "quest_014",
    rank: "C",
    title: "大量発生したネズミの一掃",
    description: "洞窟の奥で巨大ネズミが異常発生しているらしい。6匹まとめて一掃してほしいという依頼。",
    rewardGold: 220,
    rewardExp: 560,
    type: "hunt",
    targetMonsterKey: "giant_rat",
    targetCount: 6
  },
  {
    id: "quest_015",
    rank: "C",
    title: "空から来る厄介者",
    description: "ガマジルの草原の上空を飛び回るハーピーが、旅人を襲っているらしい。3羽討伐してほしいという依頼。",
    rewardGold: 240,
    rewardExp: 620,
    type: "hunt",
    targetMonsterKey: "harpy",
    targetCount: 3
  },
  {
    id: "quest_016",
    rank: "B",
    title: "薬草の大量納品",
    description: "薬師のために、質の良い薬草を大量に集めてきてほしいという依頼。「高級薬草」を5つ納品すれば達成だ。幻魔の森でしか採れないらしい。",
    rewardGold: 300,
    rewardExp: 780,
    type: "gather",
    targetItemId: "herb_004",
    targetCount: 5
  },
  {
    id: "quest_017",
    rank: "B",
    title: "洞窟に潜む妖艶な魔物",
    description: "アヌスの洞窟にサキュバスが住み着き、冒険者たちが被害に遭っているらしい。討伐してほしいという依頼。",
    rewardGold: 380,
    rewardExp: 950,
    type: "hunt",
    targetMonsterKey: "succubus",
    targetCount: 1
  },
  {
    id: "quest_018",
    rank: "A",
    title: "凶暴なオークの討伐",
    description: "アヌスの洞窟の深部に、力自慢のオークの群れが住み着いている。3体討伐してほしいという、危険な依頼。",
    rewardGold: 630,
    rewardExp: 1600,
    type: "hunt",
    targetMonsterKey: "orc",
    targetCount: 3
  },
  {
    id: "quest_019",
    rank: "A",
    title: "森の樹人討伐",
    description: "ガマジルの草原の奥で、巨大な樹人が暴れているという緊急の依頼。2体討伐してほしい。",
    rewardGold: 700,
    rewardExp: 1800,
    type: "hunt",
    targetMonsterKey: "treant",
    targetCount: 2
  }
];

// 実際に画面で使う、今日の掲示板の中身。QUEST_BOARD_MASTERのコピーから始まり、
// 依頼を受注/報告するとここから削除される。毎日0時になると resetDailyQuestBoard() で作り直される。
let QUEST_BOARD = QUEST_BOARD_MASTER.map(quest => ({ ...quest }));

// ★毎日0時にクエスト掲示板をリセットする（player.jsのadvanceGameTimeから呼ばれる）。
//   受注中の依頼（activeQuest）はそのまま進行を続けられるよう、掲示板の中身だけを作り直す。
function resetDailyQuestBoard() {
  QUEST_BOARD = QUEST_BOARD_MASTER.map(quest => ({ ...quest }));
  if (player) player.questsCompletedToday = []; // ★バグ修正：日付が変わったら「今日達成済み」の記録をリセットする
  
  // ★今、掲示板の画面を開いたままなら、中身が変わったことを一覧に反映する
  const overlay = document.getElementById("quest-board-overlay");
  if (overlay && !overlay.classList.contains("hidden")) {
    renderQuestList();
  }
}

// 今受注しているクエスト（一度に受けられるのは1つまで）。中身が無ければ null
let activeQuest = null;

// 指定アイテムを、インベントリ全体で何個持っているか合計する
function getTotalItemCount(itemId) {
  return inventorySlots.reduce((sum, slot) => (slot && slot.itemId === itemId ? sum + slot.quantity : sum), 0);
}

// 今受けているクエストが、報告（達成）できる状態かどうか
function isActiveQuestReadyToTurnIn() {
  if (!activeQuest) return false;
  if (activeQuest.type === "hunt") return activeQuest.readyToTurnIn;
  if (activeQuest.type === "gather") return getTotalItemCount(activeQuest.targetItemId) >= activeQuest.targetCount;
  return false;
}

// ===== ここから、クエスト掲示板の画面(UI)部分 =====

let currentQuestFilter = "すべて"; // 現在選ばれているランクフィルタ
let selectedQuestId = null; // 詳細パネルに表示中の依頼ID
let questListCursorIndex = 0; // ★矢印キーで動かす、一覧内のカーソル位置(DOMフォーカスは使わない)

// 現在のランクフィルタを適用した後の依頼一覧を返す
// ★以前は受注中の依頼を一覧から隠していたが、途中で破棄できるようにするため、
//   今は隠さずに表示する（renderQuestListで「受注中」の印を付けて見分けられるようにしてある）
function getFilteredQuests() {
  return currentQuestFilter === "すべて"
    ? QUEST_BOARD
    : QUEST_BOARD.filter(quest => quest.rank === currentQuestFilter);
}

// クエスト掲示板を開く（酒場の「クエストを見る」から呼ばれる）
function openQuestBoard() {
  const overlay = document.getElementById("quest-board-overlay");
  
  // ★index.html が最新版に差し替えられていないと、この要素が無くて何も表示されなくなる。
  //   その場合はサイレントに失敗させず、原因が分かるメッセージを出す。
  if (!overlay) {
    hideLocationMenu();
    changeSpeaker("");
    displayMessage("（クエスト掲示板の表示に必要なHTML要素が見つからない。index.htmlが最新版になっているか確認してほしい。）")
      .then(() => openTavern());
    return;
  }
  
  currentLocationKey = "questBoard"; // ★セーブ/ロードで現在地を復元するための記録
  
  hideLocationMenu();
  hideMessageWindow();
  
  currentQuestFilter = "すべて";
  questListCursorIndex = 0;
  selectedQuestId = QUEST_BOARD.length > 0 ? QUEST_BOARD[0].id : null;
  
  renderQuestFilter();
  renderQuestList(); // ★この中でrenderQuestDetail()も連動して呼ばれる
  
  overlay.classList.remove("hidden");
  
  const closeBtn = document.getElementById("quest-board-close-btn");
  if (closeBtn) {
    closeBtn.onclick = (event) => {
      event.stopPropagation();
      closeQuestBoard();
    };
  }
}

// クエスト掲示板を閉じて酒場に戻る
function closeQuestBoard() {
  const overlay = document.getElementById("quest-board-overlay");
  if (overlay) overlay.classList.add("hidden");
  showMessageWindow();
  openTavern();
}

// ランクフィルタのボタン列を描画する
function renderQuestFilter() {
  const container = document.getElementById("quest-rank-filter");
  if (!container) return;
  container.innerHTML = "";
  
  const ranks = ["すべて", ...RANK_ORDER]; // ★依頼がまだ無いランク（A以上）もボタン自体は常に出す
  
  for (const rank of ranks) {
    const btn = document.createElement("button");
    btn.className = "quest-filter-btn" + (currentQuestFilter === rank ? " active" : "");
    btn.textContent = rank;
    btn.onclick = (event) => {
      event.stopPropagation();
      currentQuestFilter = rank;
      renderQuestFilter();
      renderQuestList();
    };
    container.appendChild(btn);
  }
}

// 依頼一覧（フィルタ適用後）を描画する
// ★矢印キーで動かすカーソル(questListCursorIndex)に応じて、選択中の依頼・詳細パネルも連動して切り替わる
function renderQuestList() {
  const container = document.getElementById("quest-list");
  if (!container) return;
  container.innerHTML = "";
  
  const filteredQuests = getFilteredQuests();
  
  if (filteredQuests.length === 0) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "quest-list-empty";
    emptyEl.textContent = "該当する依頼が見当たらない。";
    container.appendChild(emptyEl);
    selectedQuestId = null;
    renderQuestDetail();
    return;
  }
  
  if (questListCursorIndex >= filteredQuests.length) questListCursorIndex = filteredQuests.length - 1;
  if (questListCursorIndex < 0) questListCursorIndex = 0;
  
  selectedQuestId = filteredQuests[questListCursorIndex].id;
  
  filteredQuests.forEach((quest, i) => {
    const item = document.createElement("button");
    item.className = "quest-list-item"
      + (quest.id === selectedQuestId ? " selected" : "")
      + (i === questListCursorIndex ? " cursor" : "");
    
    const rankBadge = document.createElement("span");
    rankBadge.className = "quest-rank-badge" + (isQuestAcceptable(quest) ? "" : " locked");
    rankBadge.textContent = quest.rank;
    
    const titleEl = document.createElement("span");
    titleEl.className = "quest-list-title";
    // ★受注中の依頼だけ、タイトルの前に印を付けて一覧上で見分けられるようにする
    titleEl.textContent = (activeQuest && quest.id === activeQuest.id) ? `【受注中】${quest.title}` : quest.title;
    
    item.appendChild(rankBadge);
    item.appendChild(titleEl);
    
    item.onclick = (event) => {
      event.stopPropagation();
      questListCursorIndex = i;
      selectedQuestId = quest.id;
      renderQuestList();
    };
    
    container.appendChild(item);
    // ★要望対応：カーソルが乗っている項目が一覧の外にはみ出している時、自動的にスクロールして追従させる
    if (i === questListCursorIndex) {
      requestAnimationFrame(() => item.scrollIntoView({ block: "nearest" }));
    }
  });
  
  renderQuestDetail();
}

// 選択中の依頼の詳細（内容・報酬・受注ボタン）を描画する
function renderQuestDetail() {
  const container = document.getElementById("quest-detail");
  if (!container) return;
  container.innerHTML = "";
  
  const quest = QUEST_BOARD.find(q => q.id === selectedQuestId);
  
  if (!quest) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "quest-detail-empty";
    emptyEl.textContent = "左の一覧から依頼を選んでください。";
    container.appendChild(emptyEl);
    return;
  }
  
  const header = document.createElement("div");
  header.className = "quest-detail-header";
  
  const titleEl = document.createElement("h3");
  titleEl.className = "quest-detail-title";
  titleEl.textContent = quest.title;
  
  const rankEl = document.createElement("span");
  rankEl.className = "quest-detail-rank";
  rankEl.textContent = `要求ランク：${quest.rank}`;
  
  header.appendChild(titleEl);
  header.appendChild(rankEl);
  container.appendChild(header);
  
  const descEl = document.createElement("p");
  descEl.className = "quest-detail-description";
  descEl.textContent = quest.description;
  container.appendChild(descEl);
  
  const rewardEl = document.createElement("p");
  rewardEl.className = "quest-detail-reward";
  let rewardText = `報酬：${quest.rewardGold}陳 ／ 経験値 ${quest.rewardExp}`;
  if (quest.rewardItemId && typeof ITEM_MASTER !== "undefined" && ITEM_MASTER[quest.rewardItemId]) {
    rewardText += ` ／ 「${ITEM_MASTER[quest.rewardItemId].name}」×${Math.max(1, Number(quest.rewardItemQty) || 1)}`;
  }
  rewardEl.textContent = rewardText;
  container.appendChild(rewardEl);
  
  // ★選んでいるのが「今受注中の依頼」自身なら、進捗＋破棄ボタンを出す（受注ボタンは出さない）
  if (activeQuest && quest.id === activeQuest.id) {
    const progressEl = document.createElement("p");
    progressEl.className = "quest-detail-reward";
    progressEl.textContent = quest.type === "hunt"
      ? `進捗：${activeQuest.progress} / ${activeQuest.targetCount}`
      : `進捗：${getTotalItemCount(activeQuest.targetItemId)} / ${activeQuest.targetCount}`;
    container.appendChild(progressEl);
    
    const abandonBtn = document.createElement("button");
    abandonBtn.className = "quest-accept-btn quest-abandon-btn";
    abandonBtn.textContent = "この依頼を破棄する";
    abandonBtn.onclick = (event) => {
      event.stopPropagation();
      abandonActiveQuest();
    };
    container.appendChild(abandonBtn);
    return;
  }
  
  const acceptBtn = document.createElement("button");
  acceptBtn.className = "quest-accept-btn";
  
  if (activeQuest) {
    acceptBtn.textContent = "他の依頼を受注中";
    acceptBtn.disabled = true;
    acceptBtn.classList.add("disabled");
  } else if (isQuestAcceptable(quest)) {
    acceptBtn.textContent = "この依頼を受注する";
    acceptBtn.onclick = (event) => {
      event.stopPropagation();
      acceptQuest(quest);
    };
  } else {
    acceptBtn.textContent = "ランク不足で受注できない";
    acceptBtn.disabled = true;
    acceptBtn.classList.add("disabled");
  }
  container.appendChild(acceptBtn);
}

// ※以前はここでenableListKeyboardNav（DOMフォーカス方式）を使っていたが、
//   一覧のカーソル(questListCursorIndex)と下の矢印キーリスナーによる方式に統一したため不要になった。

// 依頼を受注する（この関数が呼ばれる時点でランクは足りていることが確定している）
// ★実際に冒険へ出て、指定の魔物を倒す・アイテムを集めることで達成する。
//   受注してすぐ完了するわけではなく、activeQuest として進行状況を追跡する。
async function acceptQuest(quest) {
  const overlay = document.getElementById("quest-board-overlay");
  if (overlay) overlay.classList.add("hidden");
  showMessageWindow();
  
  changeSpeaker("店主");
  await displayMessage(`「よし、「${quest.title}」の依頼、受注だ。気をつけて行ってきな。」`);
  
  activeQuest = { ...quest, progress: 0, readyToTurnIn: false };
  
  changeSpeaker("");
  if (quest.type === "hunt") {
    await displayMessage(`「${quest.title}」の依頼を受注した。目当ての魔物を倒しに、冒険に出よう。`);
  } else {
    await displayMessage(`「${quest.title}」の依頼を受注した。必要な物を集めに、冒険に出よう。`);
  }
  
  openTownMenu(); // ★ここでは完了させず、実際に冒険に出てもらうため町に戻すだけ
}

// 冒険中に対象の魔物を倒した時、battle.js から呼ばれる（進捗を1つ進める）
async function progressHuntQuestIfMatching(monsterKey, spared = false) {
  if (!activeQuest || activeQuest.type !== "hunt" || activeQuest.readyToTurnIn) return;
  if (activeQuest.targetMonsterKey !== monsterKey) return;
  
  activeQuest.progress++;
  changeSpeaker("");
  
  // ★逃がした場合も討伐依頼の進捗としてカウントする（「被害が減った」という扱い）
  if (spared) {
    await displayMessage("「これで被害も減るだろう」");
  }
  
  if (activeQuest.progress >= activeQuest.targetCount) {
    activeQuest.readyToTurnIn = true;
    await displayMessage(`（「${activeQuest.title}」の目標を達成した。酒場の主人に報告しよう）`);
  } else {
    await displayMessage(`（「${activeQuest.title}」の進捗：${activeQuest.progress} / ${activeQuest.targetCount}）`);
  }
}

// 酒場で依頼を報告する（達成報酬を受け取り、依頼を掲示板から完全に取り除く）
async function turnInActiveQuest() {
  hideLocationMenu();
  const quest = activeQuest;
  if (!quest) return;
  
  if (quest.type === "gather") {
    removeItem(quest.targetItemId, quest.targetCount); // 納品物を消費する
  }
  
  changeSpeaker("店主");
  await displayMessage(`「おお、「${quest.title}」、もう終わったのか。仕事が早いな。」`);
  await displayMessage(`「報酬の${quest.rewardGold}陳と、経験値${quest.rewardExp}分だ。ちゃんと受け取っときな。」`);
  
  const levelResult = addExp(quest.rewardExp);
  changeGold(quest.rewardGold);
  addProgressPoints(10); // ★クエスト達成で進行度+10（player.js）
  
  // ★クエスト管理タブでアイテム報酬を設定していれば、そちらも渡す（要望対応）
  if (quest.rewardItemId && typeof ITEM_MASTER !== "undefined" && ITEM_MASTER[quest.rewardItemId]) {
    const rewardQty = Math.max(1, Number(quest.rewardItemQty) || 1);
    addItem(quest.rewardItemId, rewardQty);
    changeSpeaker("");
    await displayMessage(`「あと、これも一緒に持っていきな。」「${ITEM_MASTER[quest.rewardItemId].name}」を${rewardQty}個受け取った！`);
  }
  
  // ★名声度（隠しステータス）はクエストクリア時だけ増える。報酬経験値に応じた量を加算する
  const fameGain = Math.max(1, Math.round(quest.rewardExp / 10));
  const fameResult = addFameAndCheckRankUp(fameGain);
  
  renderStatusHUD();
  
  if (typeof announceLevelUpIfAny === "function") {
    await announceLevelUpIfAny(levelResult);
  }
  
  if (fameResult.rankUp) {
    changeSpeaker("");
    await displayMessage(`気づけば、周囲からの評判が良くなっているようだ……冒険者ランクが「${fameResult.newRank}」に上がった！`);
    showRankUpPopup("ランクアップ！", `冒険者ランクが「${fameResult.newRank}」になった`); // mainfunc.js
  } else if (fameResult.trialReadyRank) {
    changeSpeaker("");
    await displayMessage(`名声が高まり、「${fameResult.trialReadyRank}」ランクへの挑戦権を得たようだ……試練の祭殿で試練を突破すれば、正式にランクが上がる。`);
    showRankUpPopup("試練に挑めます！", `「${fameResult.trialReadyRank}」ランクの試練が解放された`); // mainfunc.js
  }
  
  // ★達成した依頼は掲示板から完全に取り除く（再受注させない）
  const index = QUEST_BOARD.findIndex(q => q.id === quest.id);
  if (index !== -1) QUEST_BOARD.splice(index, 1);
  // ★バグ修正：ここで「今日達成済み」も記録しておく。以前はactiveQuest（受注中かどうか）だけを見て
  //   再登録をガードしていたため、達成後（activeQuestがnullに戻った後）に酒場で話す等して
  //   ensureCustomQuestsRegistered()が再度走ると、達成済みの依頼が同じ日にまた掲示板に出てきてしまっていた
  if (player) {
    if (!Array.isArray(player.questsCompletedToday)) player.questsCompletedToday = [];
    if (!player.questsCompletedToday.includes(quest.id)) player.questsCompletedToday.push(quest.id);
  }
  
  // ★マップのエリア解放条件（「特定のクエストをクリアした」）用に記録する
  if (player && player.completedQuestIds && !player.completedQuestIds.includes(quest.id)) {
    player.completedQuestIds.push(quest.id);
  }
  
  activeQuest = null;
  openTavern();
}

// 受注中の依頼を途中で破棄する（掲示板画面のquest-detailから呼ばれる）。
// ★達成報酬は一切もらえず、集めた納品物もそのまま手元に残る（没収はしない）
async function abandonActiveQuest() {
  if (!activeQuest) return;
  
  const ok = await showGameConfirm(`「${activeQuest.title}」を破棄しますか？（達成報酬は受け取れなくなります）`);
  if (!ok) return;
  
  activeQuest = null;
  selectedQuestId = null;
  questListCursorIndex = 0;
  renderQuestList(); // ★一覧・詳細パネルの両方を、破棄後の状態で描画し直す
}
// ★ クエスト掲示板が開いている間だけ、Q/Eキーでランクフィルタを左右に切り替える
//   （矢印キーは依頼一覧のカーソル移動専用にしたいので、フィルタ切り替えはQ/Eに分離してある）
window.addEventListener("keydown", (event) => {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  const overlay = document.getElementById("quest-board-overlay");
  if (!overlay || overlay.classList.contains("hidden")) return;
  if (controlFocus !== "main") return;
  if (event.repeat) return;
  
  const ranks = ["すべて", ...RANK_ORDER];
  const currentIndex = ranks.indexOf(currentQuestFilter);
  
  if (KEY_CONFIG.tabLeftKey.includes(event.key)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    currentQuestFilter = ranks[(currentIndex - 1 + ranks.length) % ranks.length];
    questListCursorIndex = 0;
    renderQuestFilter();
    renderQuestList();
  } else if (KEY_CONFIG.tabRightKey.includes(event.key)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    currentQuestFilter = ranks[(currentIndex + 1) % ranks.length];
    questListCursorIndex = 0;
    renderQuestFilter();
    renderQuestList();
  }
});

// ★依頼一覧の矢印キー移動・決定キーでの受注・戻るキーでの退出
// DOMフォーカスを一切使わないので、サブ画面のタブを操作した後でも確実に動く
window.addEventListener("keydown", (event) => {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  const overlay = document.getElementById("quest-board-overlay");
  if (!overlay || overlay.classList.contains("hidden")) return;
  if (controlFocus !== "main") return;
  if (isGameDialogOpen) return;
  if (event.repeat) return;
  
  const filteredQuests = getFilteredQuests();
  
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (filteredQuests.length === 0) return;
    questListCursorIndex = Math.min(filteredQuests.length - 1, questListCursorIndex + 1);
    renderQuestList();
    
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    if (filteredQuests.length === 0) return;
    questListCursorIndex = Math.max(0, questListCursorIndex - 1);
    renderQuestList();
    
  } else if (KEY_CONFIG.decideKeys.includes(event.key)) {
    event.preventDefault();
    const quest = filteredQuests[questListCursorIndex];
    if (!quest) return;
    
    // ★選んでいるのが今受注中の依頼自身なら、決定キーで破棄を試みる
    if (activeQuest && quest.id === activeQuest.id) {
      abandonActiveQuest();
      return;
    }
    
    if (activeQuest) return; // ★他の依頼を受注中なら、決定キーでは何も起きない（ボタンが無効化されているのと同じ扱い）
    if (!isQuestAcceptable(quest)) return; // ★ランク不足の依頼は決定キーでは受注できない
    
    acceptQuest(quest);
    
  } else if (KEY_CONFIG.cancelKeys.includes(event.key)) {
    event.preventDefault();
    closeQuestBoard();
  }
});