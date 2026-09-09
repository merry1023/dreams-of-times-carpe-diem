// battle.js
// ターン制の戦闘システム。adventure.js の魔物遭遇から startBattle(monsterKeys) で呼ばれる。
//
// ★複数戦闘対応：monsterKeysは文字列（敵1体）でも、配列（敵複数体・最大5体）でもよい。
//   battleState.enemies が敵ユニットの配列になっており、各ユニットが個別にHP・攻撃力・状態異常を持つ。
//   行動順は「主人公パーティ→敵パーティ」の繰り返し（今はプレイヤーが1人なので、実質「主人公→敵全員が順番に行動」）。
//
// プレイヤーの行動：
//   たたかう → 通常攻撃 / スキル / 道具（単体攻撃は←→キーでターゲットを選ぶ。全体攻撃(skill.target==="all")は自動で敵全体を対象にする）
//   こうどう → 挑発（敵全体の攻撃力UP・命中率DOWN） / 奇声をあげる（敵全体をドン引きさせ1ターン行動不能にする）
//   逃げる   → 成功すれば探索に戻る、失敗すれば相手のターンに移る

// ★魔物データは enemy.js（通常の魔物）と boss.js（ボス・試練の守護者）に分けてあり、ここで合体させる
const MONSTER_MASTER = Object.assign({}, ENEMY_MASTER, BOSS_MASTER);

// 今の戦闘の状態（戦闘中でなければ null）
let battleState = null;
let lastHitWasCritical = false; // ★直前の一撃がクリティカルだったかどうか（会心の一撃！のメッセージ用）

// ★敗北時にいくら所持金を失ったかを記録しておく（adventure.jsの帰還メッセージから参照する）
let lastDefeatGoldLoss = 0;

// ★敵の攻撃力を全体的に今までの半分にするための倍率。ここを変えるだけで全魔物・ボス・試練の守護者に一律で反映される
const ENEMY_ATK_MULTIPLIER = 0.5;

// ★1戦闘に同時に出せる敵の最大数
const MAX_BATTLE_ENEMIES = 5;

// ★シナリオ演出戦（isScripted）の勝敗結果を、呼び出し元（scenario.js/scenario2.js）に伝えるための一時置き場。
//   isScriptedな戦闘はhandleBattleVictory/handleBattleDefeatが呼び出し元へ結果を直接returnできない構造なので、
//   ここに書き込み、startBattle()側でawait battleLoop()の直後に読み出して返す
let scriptedBattleOutcome = null;

// ★好感度システム。「見逃す」を選べる魔物の種族ごとに0〜100で管理する
//   （倒しても魔力でいずれ生き返るという設定なので、個体ではなく種族で共有）
const SPAREABLE_KEYS = ["goblin", "bat", "slime", "wolf", "giant_rat", "skeleton", "orc", "succubus", "forest_boar", "harpy", "treant", "poison_zombie"];
const AFFECTION_MAX = 100;
let monsterAffection = {};
SPAREABLE_KEYS.forEach(key => { monsterAffection[key] = 0; });

// ★魔物図鑑に載せるかどうかの判定用。倒した・見逃したことが一度でもあればtrueにする
let discoveredMonsters = {};
SPAREABLE_KEYS.forEach(key => { discoveredMonsters[key] = false; });

function getMonsterAffection(monsterKey) {
  return monsterAffection[monsterKey] || 0;
}

function changeMonsterAffection(monsterKey, amount) {
  if (!(monsterKey in monsterAffection)) monsterAffection[monsterKey] = 0;
  monsterAffection[monsterKey] = Math.max(0, Math.min(AFFECTION_MAX, monsterAffection[monsterKey] + amount));
}

// 好感度の段階：0=まだ何とも思われていない／1=友好的／2=とても友好的／3=MAX（大好き）
function getAffectionTier(monsterKey) {
  const value = getMonsterAffection(monsterKey);
  if (value >= 100) return 3;
  if (value >= 60) return 2;
  if (value >= 20) return 1;
  return 0;
}

// ★魔物のレベルを、主人公の現在レベルの±1のレベル帯でランダムに決める（最低Lv.1）
function generateMonsterLevel() {
  if (!player) return 1;
  const offset = Math.floor(Math.random() * 3) - 1; // -1, 0, +1のいずれか
  // ★洞窟(Lv.10〜)・森(Lv.5〜)のように、場所によっては最低レベルが決まっている
  const minLevel = (typeof currentAdventureMinMonsterLevel === "number") ? currentAdventureMinMonsterLevel : 1;
  return Math.max(minLevel, player.level + offset);
}

// ★決まった個体レベルに応じて、MONSTER_MASTERの基礎ステータス（Lv.1相当）を底上げする。
//   以前はLv.表示だけが変わって強さ自体はマスターデータのまま固定だったため、
//   ここでHP・攻撃力も実際にレベルなりに強くなるようにする
const MONSTER_LEVEL_GROWTH = { hp: 0.20, atk: 0.16, exp: 0.18 }; // 1レベルごとの増加率

function scaleMonsterStatsForLevel(master, level) {
  const levelsAboveOne = Math.max(0, level - 1);
  return {
    maxHp: Math.round(master.maxHp * (1 + MONSTER_LEVEL_GROWTH.hp * levelsAboveOne)),
    atk: Math.round(master.atk * (1 + MONSTER_LEVEL_GROWTH.atk * levelsAboveOne) * ENEMY_ATK_MULTIPLIER),
    exp: Math.round(master.exp * (1 + MONSTER_LEVEL_GROWTH.exp * levelsAboveOne)) // ★レベルが高い個体ほど、もらえる経験値も多くなる
  };
}

// ★1体分の敵ユニットを作る（複数戦闘では、この形のオブジェクトがbattleState.enemiesに複数入る）
function createEnemyUnit(monsterKey, level) {
  const master = MONSTER_MASTER[monsterKey];
  // ★ボス設定で「ステータスを固定する」がONの場合、レベルによる自動計算はせず、設定した数値をそのまま使う
  //   （表示上のレベルだけは変わる。無指定なら今まで通りレベルに応じて自動計算される）
  const scaled = master.fixedStats
    ? { maxHp: master.maxHp, atk: master.atk, exp: master.exp }
    : scaleMonsterStatsForLevel(master, level);
  return {
    monsterKey: monsterKey, // ★クエストの討伐対象判定・画像パスなどに使う
    name: master.name,      // ★素の名前（imagePathが無い時、img/敵/(name).png の解決に使う。好感度判定などマスターデータ側の名前が必要な場面にも使う）
    imagePath: master.imagePath || null, // ★シナリオビルドの敵設定/ボス設定で指定できる、画像ファイルの直接パス（指定が無ければ従来通りimg/敵/(name).pngを使う）
    sizeMultiplier: (typeof master.sizeMultiplier === "number" && master.sizeMultiplier > 0) ? master.sizeMultiplier : 1, // ★敵設定/ボス設定で指定できる、この敵だけの表示サイズ倍率（例：1.2で少し大きく、0.8で少し小さく）
    displayName: master.name, // ★実際にメッセージ・HUDに出す名前。同じ魔物が複数いる時は①②…が付く（assignDisplayNamesで設定）
    level: level,
    hp: scaled.maxHp,
    maxHp: scaled.maxHp,
    atk: scaled.atk,
    exp: scaled.exp,
    dropItemId: master.dropItemId,
    dropRate: master.dropRate,
    // ステータス効果（こうどうコマンド・専用スキルなどで変化する。敵ごとに個別で持つ）
    enemyAtkBonus: 0,        // 挑発による攻撃力上昇
    enemyAccuracyPenalty: 0, // 挑発による命中率低下（％）
    enemyFlinched: false,    // 奇声による「ドン引き」で次の敵ターンを1回スキップ
    enemyStunnedTurns: 0,    // ★「約束された絶頂の剣♂」で付与する行動不能の残りターン数
    // ★技一覧（player.js CLASS_SKILLS）のstatusEffectで付与される、ターン制の状態異常
    status: { stun: 0, paralyze: 0, confuse: 0, burn: { turns: 0, power: 0 }, poison: { turns: 0, power: 0 }, dullPain: { turns: 0, power: 0 }, atkDown: { turns: 0, power: 0 }, defDown: { turns: 0, power: 0 }, accDown: { turns: 0, power: 0 } },
    // ★無敵解除アイテム：指定されている間は攻撃が一切効かず、戦闘中にプレイヤーがそのアイテムを実際に「使う」まで解除されない
    //   （空欄なら最初から無敵ではない＝今まで通り普通にダメージが通る）
    invincibilityBreakItemId: master.invincibilityBreakItemId || null,
    invincibilityBroken: !master.invincibilityBreakItemId,
    // ★ボス管理タブで組んだ「戦闘イベント」（ifブロック的な、HP割合やターン数で発火する演出・行動）のうち、
    //   もう発火したものをここに記録する（1つのイベントは戦闘中1回しか発火しない）
    triggeredBattleEventIds: []
  };
}

// ★同じ魔物が2体以上いる時だけ、①②③…を名前に付けて見分けられるようにする
const CIRCLED_NUMBERS = ["①", "②", "③", "④", "⑤"];
function assignDisplayNames(enemies) {
  const countByKey = {};
  enemies.forEach(e => { countByKey[e.monsterKey] = (countByKey[e.monsterKey] || 0) + 1; });
  const seenByKey = {};
  enemies.forEach(e => {
    if (countByKey[e.monsterKey] > 1) {
      seenByKey[e.monsterKey] = (seenByKey[e.monsterKey] || 0) + 1;
      e.displayName = `${e.name}${CIRCLED_NUMBERS[seenByKey[e.monsterKey] - 1] || ""}`;
    } else {
      e.displayName = e.name;
    }
  });
}

// ===== 戦闘開始 =====
// ★好感度が高い魔物と出会った時、たまに戦わずに手助け・贈り物をしてくれるイベント。
//   trueを返したら、この出会いは戦闘にならず終わる
async function tryMonsterSupportEncounter(monsterKey) {
  const tier = getAffectionTier(monsterKey);
  if (tier === 0) return false;
  
  const chanceByTier = { 1: 0.10, 2: 0.22, 3: 0.40 };
  if (Math.random() >= chanceByTier[tier]) return false;
  
  const master = MONSTER_MASTER[monsterKey];
  const line = (tier === 3 && master.maxAffectionLine) ? master.maxAffectionLine : null;
  
  changeSpeaker(master.name);
  
  // ★displayMessageに{allowSubFocus:true}を付けておくことで、万一controlFocusが
  //   "sub"のまま（サブ画面操作中に）このイベントへ入ってしまっても、メッセージが
  //   押せず先に進めなくなる事故を二重に防ぐ（本来の原因は行き先メニュー側で対処済み）
  const isGift = Math.random() < 0.5 && master.giftItemId;
  if (isGift) {
    await displayMessage(line || `${master.name}が、そっと近づいてきた。`, { allowSubFocus: true });
    addItem(master.giftItemId, 1);
    renderStatusHUD();
    changeSpeaker("");
    const itemMaster = ITEM_MASTER[master.giftItemId];
    await displayMessage(`「${itemMaster.name}」をお裾分けしてくれた！`, { allowSubFocus: true });
  } else {
    // ★好感度MAXの相手ほど、支援の回復量も大きい
    const healAmount = tier >= 3 ? 30 : 18;
    await displayMessage(line || `${master.name}が、そっと寄り添ってきた。`, { allowSubFocus: true });
    changeGauge("hp", healAmount);
    renderStatusHUD();
    changeSpeaker("");
    await displayMessage(`なんだか元気が出た。HPが${healAmount}回復した！`, { allowSubFocus: true });
  }
  
  // ★以前はここで何も呼ばずに関数が終わっていたため、戦闘にならずに終わったこのイベントの後、
  //   行き先メニュー（前に進む／調べる／戻る）が二度と出てこず、画面が実質フリーズしてしまっていた。
  //   戦闘をせずに探索へ戻るので、examineCustomArea等と同じくここで自分でメニューを出し直す必要がある
  openAdventureMenu(); // adventure.js
  return true;
}

// monsterKeys: 敵1体なら文字列、複数体（最大5体まで）なら配列。同じmonsterKeyを複数入れれば同種の群れになる。
// options.isScripted: シナリオ（scenario.js/scenario2.js）から直接呼ぶ、探索の外側にある演出用の戦闘の時にtrue。
//   通常の戦闘後処理（returnToAdventureAfterBattle）を呼ばず、勝敗・逃走のどれで終わっても
//   単に片付けて呼び出し元へ制御を返すだけにする（currentAdventureLocationKeyが無く、
//   探索中のつもりで処理すると背景解決などでエラーになるため）
async function startBattle(monsterKeys, options = {}) {
  const keys = (Array.isArray(monsterKeys) ? monsterKeys : [monsterKeys]).slice(0, MAX_BATTLE_ENEMIES);
  if (keys.length === 0) return;
  const primaryMaster = MONSTER_MASTER[keys[0]];
  if (!primaryMaster) return;
  
  // ★好感度が十分高い相手（見逃せる魔物のみ対象）だと、たまに戦わずに手助け・贈り物をしてくれる。
  //   複数体の群れ相手だと成立させづらいイベントなので、1体だけの遭遇の時に限る
  if (!options.isScripted && keys.length === 1 && SPAREABLE_KEYS.includes(keys[0]) && (await tryMonsterSupportEncounter(keys[0]))) {
    return;
  }
  
  // ★レベルの決め方の優先順位：①先頭の魔物（ボス想定）自身に「レベル」が設定されていればそれを最優先、
  //   ②無ければ呼び出し元が渡した固定レベル（エリア設定の「出現する敵のレベル」など）、
  //   ③どちらも無ければ、これまで通り主人公のレベル±1で決める
  const fixedLevel = (typeof primaryMaster.level === "number" && primaryMaster.level > 0)
    ? primaryMaster.level
    : (typeof options.fixedLevel === "number" && options.fixedLevel > 0 ? options.fixedLevel : null);
  const level = fixedLevel != null ? fixedLevel : generateMonsterLevel(); // ★主人公のレベル±1で決まる、この群れ全体のレベル（固定レベル指定が無い場合のみ）
  const enemies = keys.map(key => createEnemyUnit(key, level));
  assignDisplayNames(enemies);
  const isBoss = BOSS_MONSTER_KEYS.includes(keys[0]); // ★BGMの切り替えや演出の判定に使う（先頭＝ボス本体）
  
  // ★魔法少女の「マジカル変身」は戦闘ごとにリセットする（毎回、変身前から始まる）
  if (player && player.class === "魔法少女") player.magicalGirlTransformed = false;
  
  battleState = {
    enemies: enemies,
    targetIndex: 0, // ★今カーソルが乗っている（＝次に選ばれる）敵のenemies内インデックス
    isBoss: isBoss,
    isScripted: !!options.isScripted, // ★シナリオ演出用の戦闘かどうか
    isTrial: false,
    // ★プレイヤー側の状態効果（敵ごとではなく戦闘全体で1つ）
    playerDamageReductionTurns: 0, // ★「静かなる権威」の残りターン数
    playerDamageReductionRatio: 1,  // ★同上。1未満なら被ダメージを軽減する倍率
    // ★技一覧（player.js CLASS_SKILLS）の自己バフで使う、戦闘中だけのプレイヤー側状態
    playerAtkBonusTurns: 0, playerAtkBonus: 0,
    playerMagicBonusTurns: 0, playerMagicBonus: 0, playerMagicBonusMode: "add", // ★魔力上昇（攻撃力上昇とは別枠。魔法攻撃の時だけ上乗せする）
    playerFatigueImmuneTurns: 0, // ★「疲労・眠気の影響を受けない」バフ：有効な間、居眠り判定と疲弊による攻撃力低下を無視する
    playerCritBonusTurns: 0, playerCritBonus: 0,
    playerImmuneTurns: 0,
    playerStatusImmuneTurns: 0, // ★ハイ・ディスシプリナ「大いなる光芒状態」：状態異常の付与だけを無効化する（ダメージそのものは防がない）
    playerRegenTurns: 0, playerRegenAmount: 0, playerRegenLabel: "", // ★継続回復バフ：ラウンド終了ごとに少しHPが回復する。playerRegenLabelは実際に付与した状態の名前（表示用。要望対応）
    playerHealBonusTurns: 0, playerHealBonus: 0, // ★回復力上昇（攻撃力上昇とは別枠。回復技の効果量に上乗せする）
    playerSurviveLethalTurns: 0, // ★不屈の闘志・九死一生：致命傷になるはずの一撃だけHP1で耐える
    zetsurinUsesLeft: 3, // ★性騎士の「絶倫」：SPが2割を切ったら自動で8割まで回復（1戦闘3回まで）
    yaruKiNashiTurns: 0, // ★ニートの「後でやろう」：この数だけ自分のターンが来たら「本気状態」が自動発動する
    playerHpBerserkActive: false, // ★イクサガミの被虐趣向：次の1回の攻撃だけ、残りHPを力に変える（攻撃したら解除）
    playerAttackCount: 0, // ★血闘の刻印：戦闘中に自身が繰り出した攻撃（通常攻撃・攻撃技、命中回数ぶんそれぞれ）の回数
    playerChainAttackTurns: 0, // ★賊害の連鎖：発動中は単体攻撃がもう一体の敵にも連鎖する
    turnCount: 1, // ★特殊スキル（ブロック実行）のcheckTurnCountブロック用：この戦闘が何ターン目か（プレイヤーの手番が来るたびに増える）
    skillTurnMeasurements: {}, // ★特殊スキルの「ターン経過計測：開始/終了」ブロック用：{ 計測名: { startTurn, lastElapsed } }
    // ★bgm.js等、以前の「敵は常に1体」前提だったコードとの互換用。updateBattleHud側で先頭の敵の値を反映し続ける
    monsterKey: enemies[0].monsterKey,
    name: enemies[0].displayName,
    hp: enemies[0].hp,
    maxHp: enemies[0].maxHp
  };
  
  resetAllCompanionBattleBuffs(); // ★戦闘開始時に、仲間の自己バフ・攻撃回数カウント等をリセットしておく
  startBattleBGM(isBoss); // bgm.js
  showBattleHud();
  changeSpeaker("");
  if (enemies.length === 1) {
    await displayMessage(`${enemies[0].displayName}（Lv.${enemies[0].level}）が現れた！`);
  } else {
    await displayMessage(`${primaryMaster.name}が${enemies.length}体、群れで現れた！（Lv.${level}）`);
  }
  
  await battleLoop();
  
  // ★シナリオ演出戦だけは、勝敗（"win"/"defeat"）を呼び出し元に返す。
  //   通常の戦闘は returnToAdventureAfterBattle 側で後処理が完結するので、ここでは何も返さない
  if (options.isScripted) {
    const outcome = scriptedBattleOutcome;
    scriptedBattleOutcome = null;
    return outcome;
  }
}

// ★ボス格の魔物のmonsterKey一覧。BGMの切り替えなど、ボス戦かどうかの判定に使う（boss.js参照。試練の守護者は除く）
const BOSS_MONSTER_KEYS = Object.keys(BOSS_MASTER).filter(key => key !== "trial_guardian");

// ★試練の祭殿専用の戦闘（adventure.jsのopenTrialShrineから呼ぶ）。守護者は常に1体。
//   通常のエンカウントとは違い、試練の対象ランクに応じて守護者を強化し、
//   勝敗の後処理も専用（handleBattleVictory/handleBattleDefeat/attemptFlee内でisTrialを見て分岐）にしている
async function startTrialBattle(trialRank) {
  const master = MONSTER_MASTER["trial_guardian"];
  if (!master) return;
  
  // ★魔法少女の「マジカル変身」は戦闘ごとにリセットする（毎回、変身前から始まる）
  if (player && player.class === "魔法少女") player.magicalGirlTransformed = false;
  
  // ★挑む試練のランクが上がるほど、守護者も強くなる
  const tierMultiplier = 1 + rankIndex(trialRank) * 0.35; // questboard.js
  const level = Math.max(1, (player ? player.level : 1) + 3); // ★通常の遭遇より一段強い個体という扱い
  
  const guardianName = `${trialRank}ランクの${master.name}`;
  const unit = {
    monsterKey: "trial_guardian",
    name: guardianName,
    displayName: guardianName,
    level: level,
    hp: Math.round(master.maxHp * tierMultiplier),
    maxHp: Math.round(master.maxHp * tierMultiplier),
    atk: Math.round(master.atk * tierMultiplier * ENEMY_ATK_MULTIPLIER),
    exp: 0,
    dropItemId: null,
    dropRate: 0,
    enemyAtkBonus: 0,
    enemyAccuracyPenalty: 0,
    enemyFlinched: false,
    enemyStunnedTurns: 0
  };
  
  battleState = {
    enemies: [unit],
    targetIndex: 0,
    isBoss: true,           // ★試練戦は常にボス格として扱う（BGMの切り替えに使う）
    isScripted: false,
    isTrial: true,          // ★試練戦であることの目印。勝敗処理の分岐に使う
    trialRank: trialRank,   // ★クリアした時に、どのランクの試練だったかを記録する
    playerDamageReductionTurns: 0,
    playerDamageReductionRatio: 1,
    playerAtkBonusTurns: 0, playerAtkBonus: 0,
    playerMagicBonusTurns: 0, playerMagicBonus: 0, playerMagicBonusMode: "add", // ★魔力上昇（攻撃力上昇とは別枠。魔法攻撃の時だけ上乗せする）
    playerFatigueImmuneTurns: 0, // ★「疲労・眠気の影響を受けない」バフ：有効な間、居眠り判定と疲弊による攻撃力低下を無視する
    playerCritBonusTurns: 0, playerCritBonus: 0,
    playerImmuneTurns: 0,
    playerStatusImmuneTurns: 0, // ★ハイ・ディスシプリナ「大いなる光芒状態」：状態異常の付与だけを無効化する（ダメージそのものは防がない）
    playerRegenTurns: 0, playerRegenAmount: 0, playerRegenLabel: "", // ★継続回復バフ：ラウンド終了ごとに少しHPが回復する。playerRegenLabelは実際に付与した状態の名前（表示用。要望対応）
    playerHealBonusTurns: 0, playerHealBonus: 0, // ★回復力上昇（攻撃力上昇とは別枠。回復技の効果量に上乗せする）
    playerSurviveLethalTurns: 0, // ★不屈の闘志・九死一生：致命傷になるはずの一撃だけHP1で耐える
    zetsurinUsesLeft: 3, // ★性騎士の「絶倫」：SPが2割を切ったら自動で8割まで回復（1戦闘3回まで）
    yaruKiNashiTurns: 0, // ★ニートの「後でやろう」：この数だけ自分のターンが来たら「本気状態」が自動発動する
    playerHpBerserkActive: false, // ★イクサガミの被虐趣向：次の1回の攻撃だけ、残りHPを力に変える（攻撃したら解除）
    playerAttackCount: 0, // ★血闘の刻印：戦闘中に自身が繰り出した攻撃（通常攻撃・攻撃技、命中回数ぶんそれぞれ）の回数
    playerChainAttackTurns: 0, // ★賊害の連鎖：発動中は単体攻撃がもう一体の敵にも連鎖する
    monsterKey: unit.monsterKey,
    name: unit.displayName,
    hp: unit.hp,
    maxHp: unit.maxHp
  };
  
  resetAllCompanionBattleBuffs(); // ★戦闘開始時に、仲間の自己バフ・攻撃回数カウント等をリセットしておく
  startBattleBGM(true); // bgm.js
  showBattleHud();
  changeSpeaker("");
  await displayMessage(`${unit.displayName}が立ちはだかった！`);
  
  await battleLoop();
}

// ===== ターゲット選択まわり =====
function getAliveEnemies() {
  return battleState ? battleState.enemies.filter(e => e.hp > 0) : [];
}

// ★今カーソルが乗っている敵を返す。既に倒されていたら、生きている先頭の敵に自動で乗せ換える
function getCurrentTarget() {
  if (!battleState) return null;
  const current = battleState.enemies[battleState.targetIndex];
  if (current && current.hp > 0) return current;
  const alive = getAliveEnemies();
  if (alive.length === 0) return null;
  battleState.targetIndex = battleState.enemies.indexOf(alive[0]);
  return alive[0];
}

let isTargetingEnemy = false; // ★今、←→キーでのターゲット選択待ちかどうか
let targetSelectResolve = null;

// ★単体攻撃の対象を決める。生きている敵が1体しかいなければ選択を省略してそのまま対象にする。
//   2体以上いる時は、←→キー／タップに加えて、選択肢（choice-box）からも選べるようにする（要望対応）
async function selectEnemyTarget() {
  const alive = getAliveEnemies();
  if (alive.length === 0) return null;
  if (alive.length === 1) return alive[0];
  
  const current = getCurrentTarget();
  if (current) battleState.targetIndex = battleState.enemies.indexOf(current);
  
  isTargetingEnemy = true;
  renderBattleEnemies();
  
  // ★同名の敵が複数いる場合に区別できるよう、選択肢のラベルには連番を振る
  const nameCounts = {};
  alive.forEach(e => { nameCounts[e.name] = (nameCounts[e.name] || 0) + 1; });
  const seen = {};
  // ★要望対応：選択肢での対象選びは縦画面の時だけ出す。横画面では今まで通り左右キー操作を優先する
  //   （横長の画面では敵が横一列に並ぶため、左右キーでの直感的な選択の方が使いやすいため）
  const isPortraitScreen = window.innerWidth < window.innerHeight;
  const choiceListPromise = (isPortraitScreen && typeof displayChoices === "function")
    ? displayChoices(alive.map(enemy => {
        seen[enemy.name] = (seen[enemy.name] || 0) + 1;
        const label = nameCounts[enemy.name] > 1 ? `${enemy.name}（${seen[enemy.name]}）` : enemy.name;
        return { text: label, next: enemy };
      }), 0, { allowSubFocus: true, disableArrowPaging: true }) // ★←→キーは敵カーソル移動用に空けておく
    : null;
  
  return new Promise(resolve => {
    let settled = false;
    const settle = (enemy) => {
      if (settled) return;
      settled = true;
      isTargetingEnemy = false;
      targetSelectResolve = null;
      if (typeof forceCloseChoiceBoxSilently === "function") forceCloseChoiceBoxSilently(); // ★開いたままの選択肢の方を片付ける
      renderBattleEnemies();
      resolve(enemy);
    };
    targetSelectResolve = settle; // ★タップ／矢印キー側（confirmEnemyTarget・cancelEnemyTargetSelectionから呼ばれる）
    if (choiceListPromise) {
      choiceListPromise.then(choice => settle(choice && choice.next ? choice.next : null));
    }
  });
}

function moveEnemyTargetCursor(direction) {
  const alive = getAliveEnemies();
  if (alive.length === 0) return;
  const currentIndex = Math.max(0, alive.indexOf(getCurrentTarget()));
  const nextIndex = (currentIndex + direction + alive.length) % alive.length;
  battleState.targetIndex = battleState.enemies.indexOf(alive[nextIndex]);
  renderBattleEnemies();
  updateBattleHud();
}

function confirmEnemyTarget(enemy) {
  if (!isTargetingEnemy || !targetSelectResolve || !enemy) return;
  const fn = targetSelectResolve;
  targetSelectResolve = null;
  fn(enemy);
}

// ★ターゲット選択中だけ、←→キーでカーソル移動・決定キーで確定・キャンセルキーで選択自体を取り消す
window.addEventListener("keydown", (event) => {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  if (!isTargetingEnemy) return;
  if (event.repeat) return;
  
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    event.stopImmediatePropagation();
    moveEnemyTargetCursor(-1);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    event.stopImmediatePropagation();
    moveEnemyTargetCursor(1);
  } else if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.decideKeys.includes(event.key)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    confirmEnemyTarget(getCurrentTarget());
  } else if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.cancelKeys.includes(event.key)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    cancelEnemyTargetSelection();
  }
});

// ★狙う相手を選んでいる途中でやめる（技もアイテムもまだ発動していないので、そのまま選び直せる）
function cancelEnemyTargetSelection() {
  if (!isTargetingEnemy || !targetSelectResolve) return;
  const fn = targetSelectResolve;
  targetSelectResolve = null;
  fn(null);
}

// ===== 戦闘ループ（決着がつくまでメインコマンドを繰り返す） =====
// ===== 友好的な魔物の乱入サポート =====
// ★好感度がある（友好的になった）魔物が、戦闘中に稀にその魔物自身の技（uniqueSkill）を使って
//   敵をランダムに攻撃してくれる（要望対応）。今回の戦闘の相手そのものである必要はなく、
//   仲良くなった別の魔物が「助っ人」として一瞬だけ乱入してくるイメージ
async function tryFriendlyMonsterAssist() {
  if (typeof monsterAffection === "undefined") return;
  const aliveEnemies = getAliveEnemies();
  if (aliveEnemies.length === 0) return;
  
  // ★好感度がある（tier1以上）魔物のうち、実際に使える技（uniqueSkill）を持っているものだけを対象にする
  const candidates = Object.keys(monsterAffection).filter(key => {
    if (getAffectionTier(key) === 0) return false;
    const master = MONSTER_MASTER[key];
    return master && master.uniqueSkill && master.uniqueSkill.name;
  });
  if (candidates.length === 0) return;
  
  // ★好感度が高いほど乱入しやすくなる（1匹あたりの確率。複数いても乱入は1ターンに1匹まで）
  const chanceByTier = { 1: 0.05, 2: 0.09, 3: 0.14 };
  const monsterKey = candidates[Math.floor(Math.random() * candidates.length)];
  const tier = getAffectionTier(monsterKey);
  if (Math.random() >= (chanceByTier[tier] || 0)) return;
  
  const master = MONSTER_MASTER[monsterKey];
  const target = aliveEnemies[Math.floor(Math.random() * aliveEnemies.length)];
  
  // ★乱入してくる魔物自身のステータスは、今の主人公のレベル帯に合わせてスケーリングする
  //   （野生の助っ人という位置づけなので、専用の個体を用意せずMONSTER_MASTERの基礎値を流用する）
  const scaled = scaleMonsterStatsForLevel({ maxHp: master.maxHp || 10, atk: master.atk || 5, exp: 0 }, player.level);
  
  changeSpeaker("");
  await displayMessage(`「${master.name}」が仲間を助けようと乱入してきた！`);
  changeSpeaker(master.name);
  await displayMessage(`「${master.uniqueSkill.name}」！ ${master.uniqueSkill.flavor || ""}`);
  
  const damage = Math.max(1, Math.round(scaled.atk * (master.uniqueSkill.multiplier || 1)));
  target.hp = Math.max(0, target.hp - damage);
  if (typeof triggerCameraShake === "function") triggerCameraShake(); // mainfunc.js
  
  changeSpeaker("");
  await displayMessage(`${target.displayName}に${damage}のダメージを与えた！`);
  updateBattleHud();
  
  if (target.hp <= 0) {
    changeSpeaker("");
    await displayMessage(`${target.displayName}を倒した！`);
    updateBattleHud();
  }
}

async function battleLoop() {
  while (battleState) {
    updateBattleHud();
    
    // ★ニートの「後でやろう」：カウントダウンが0になったら、行動選択の前に自動で「本気状態」が発動する
    const yaruKiMessage = checkYaruKiNashiActivation();
    if (yaruKiMessage) {
      changeSpeaker("");
      await displayMessage(yaruKiMessage);
      renderStatusHUD();
    }
    
    let turnEnded = false;
    
    // ★バグ修正：主人公のHPが0でも、仲間が誰か生きていればパーティ全滅（isPartyDefeated）にはならず
    //   戦闘が続く仕様になった（要望対応）が、それに対応する「主人公自身は戦闘不能で動けない」処理が
    //   無かったため、HPが0のまま普通にコマンドを選んで行動できてしまっていた
    const playerIsDown = player.gauges.hp.current <= 0;
    
    // ★スタン・麻痺・混乱にかかっていると、コマンドを選ぶ前にその場で行動を潰されてしまう
    const statusBlockedBy = typeof checkPlayerStatusPreventsAction === "function" ? checkPlayerStatusPreventsAction() : null; // player.js
    if (playerIsDown) {
      changeSpeaker("");
      await displayMessage("倒れていて、動くことができない……");
      turnEnded = true;
    } else if (statusBlockedBy) {
      changeSpeaker("");
      const blockMessages = { stun: "スタンしてしまい、動けなかった！", paralyze: "麻痺していて、体が動かなかった！", confuse: "混乱していて、まともに行動できなかった！" };
      await displayMessage(blockMessages[statusBlockedBy] || "行動できなかった……");
      turnEnded = true;
    } else {
      const action = await displayChoices([
        { text: "たたかう", next: "fight" },
        { text: "こうどう", next: "action" },
        { text: "逃げる", next: "flee" }
      ]);
      
      if (action.next === "fight") {
        turnEnded = await handleFightMenu();
      } else if (action.next === "action") {
        turnEnded = await handleActionMenu();
      } else if (action.next === "flee") {
        const fled = await attemptFlee();
        if (fled) return; // 逃げ切った：戦闘終了
        turnEnded = true;  // 逃げ損なった：相手のターンへ
      }
    }
    
    if (!turnEnded) continue; // 「戻る」でサブメニューから抜けただけ：ターンを消費しない
    
    // ★要望対応：主人公が戦闘不能で動けなかったターンは、本人は何もしていないので、
    //   疲労の蓄積や毒・火傷のダメージ処理もスキップする（既に0のHPからさらに削れて変な表示になるのも防ぐ）
    if (!playerIsDown) {
      // ★戦闘で1ターン行動するたびに疲労度が溜まっていく。疲弊状態（7割超）だとHPも少し削られる
      const fatigueResult = applyActionFatigue(2); // player.js
      renderStatusHUD();
      if (fatigueResult.hpDrained > 0) {
        changeSpeaker("");
        if (typeof triggerCameraShake === "function") triggerCameraShake(); // mainfunc.js
        await displayMessage(`疲労のあまり、体力が${fatigueResult.hpDrained}削られた……`);
        if (isPartyDefeated()) {
          await handleBattleDefeat();
          return;
        }
      }
      
      // ★毒・火傷状態なら、行動するたびにHPが少し削られる
      const poisonResult = applyPoisonTick(); // player.js
      if (poisonResult.damage > 0) {
        renderStatusHUD();
        changeSpeaker("");
        if (typeof triggerCameraShake === "function") triggerCameraShake(); // mainfunc.js
        await displayMessage(`体を状態異常が蝕み、体力が${poisonResult.damage}削られた……`);
        if (isPartyDefeated()) {
          await handleBattleDefeat();
          return;
        }
      }
    }
    
    // ★魔法少女が変身中なら、毎ターンSPが少し回復する。SPが3割を切っていたら強制的に変身が解除される
    await tickMagicalGirlTransformState();
    if (checkMagicalGirlForcedDetransform()) {
      renderStatusHUD();
      changeSpeaker("");
      await displayMessage("SPが尽きかけ、変身が解除されてしまった……！");
    }
    
    updateBattleHud();
    
    // ★敵を全滅させた？
    if (getAliveEnemies().length === 0) {
      const spared = await handlePreVictoryFlavor(); // 倒す直前の専用セリフ（敵が1体だけの時、サキュバス・ハーピーは見逃すか選べる）
      if (spared) {
        await handleMonsterSpared();
      } else {
        await handleBattleVictory();
      }
      return;
    }
    
    // ★仲間のターン：主人公の直後、仲間1→仲間2……の順で、生きている仲間全員が行動する
    await companionTeamTurn();
    if (!battleState) return;
    if (getAliveEnemies().length === 0) {
      const spared = await handlePreVictoryFlavor();
      if (spared) {
        await handleMonsterSpared();
      } else {
        await handleBattleVictory();
      }
      return;
    }
    
    // ★友好的になった魔物が、稀に助っ人として乱入してくる（要望対応）
    await tryFriendlyMonsterAssist();
    if (!battleState) return;
    if (getAliveEnemies().length === 0) {
      const spared = await handlePreVictoryFlavor();
      if (spared) {
        await handleMonsterSpared();
      } else {
        await handleBattleVictory();
      }
      return;
    }
    
    // ★敵のターン：生きている敵全員が、主人公の後にまとめて順番に行動する
    await enemyTeamTurn();
    if (!battleState) return; // 逃走成功などで既に戦闘が終わっていたら何もしない
    
    // ★「一定ターンの間」と説明のある自己バフ（攻撃力上昇・会心率上昇）の残りターン数を、
    //   1ラウンド（主人公→仲間→敵、全員の行動）が終わるたびに1つ減らす。
    //   ★以前はここが無く、一度発動すると戦闘が終わるまでずっと効果が続いてしまっていた
    await tickPlayerTurnBasedBuffs();
    await tickAllCompanionTurnBasedBuffs();
    
    battleState.turnCount = (battleState.turnCount || 1) + 1; // ★1ラウンド終わるごとに、特殊スキル用のターン数を進める
    
    // ★力尽きた？
    if (isPartyDefeated()) {
      await handleBattleDefeat();
      return;
    }
  }
}

// ★「一定ターンの間」と説明のある自己バフ（攻撃力上昇・会心率上昇）の残りターン数を、
//   1ラウンド終了ごとに1つ減らす。0になったらボーナス値もリセットしておく（表示・計算の残留防止）
async function tickPlayerTurnBasedBuffs() {
  // ★武器・防具の「HP自動回復」「SP自動回復」パラメータぶん、ラウンド終了ごとに自動で回復する
  const equipBonus = getEquipmentBonus(); // player.js
  if (equipBonus.hpRegen > 0 && player.gauges.hp.current > 0) {
    const healed = applyHealToUnit(player, "hp", equipBonus.hpRegen, false, false); // player.js
    if (healed > 0) { changeSpeaker(""); await displayMessage(`装備の力で、HPが${healed}回復した。`); }
  }
  if (equipBonus.spRegen > 0) {
    const healedSp = applyHealToUnit(player, "sp", equipBonus.spRegen, false, false); // player.js
    if (healedSp > 0) { changeSpeaker(""); await displayMessage(`装備の力で、SPが${healedSp}回復した。`); }
  }
  if (!battleState) return;
  if (battleState.playerAtkBonusTurns > 0) {
    battleState.playerAtkBonusTurns--;
    if (battleState.playerAtkBonusTurns <= 0) { battleState.playerAtkBonus = 0; battleState.playerAtkBonusMode = "add"; }
  }
  if (battleState.playerMagicBonusTurns > 0) {
    battleState.playerMagicBonusTurns--;
    if (battleState.playerMagicBonusTurns <= 0) { battleState.playerMagicBonus = 0; battleState.playerMagicBonusMode = "add"; }
  }
  if (battleState.playerFatigueImmuneTurns > 0) battleState.playerFatigueImmuneTurns--;
  if (battleState.playerCritBonusTurns > 0) {
    battleState.playerCritBonusTurns--;
    if (battleState.playerCritBonusTurns <= 0) battleState.playerCritBonus = 0;
  }
  if (battleState.playerChainAttackTurns > 0) battleState.playerChainAttackTurns--;
  if (battleState.playerRegenTurns > 0) {
    battleState.playerRegenTurns--;
    const healed = applyHealToUnit(player, "hp", battleState.playerRegenAmount, false, false); // player.js
    if (healed > 0) {
      changeSpeaker("");
      // ★バグ修正：以前はここで「大いなる光芒に包まれ」と固定文言にしていたため、
      //   ハイ・ディスシプリナ以外の技（例：継続回復のみを付与する技）で継続回復状態になっても、
      //   全て「大いなる光芒」と表示されてしまっていた。実際に付与された時の名前
      //   （battleState.playerRegenLabel。無ければ汎用の「継続回復」）を使って表示する
      const label = battleState.playerRegenLabel || "継続回復";
      await displayMessage(`${label}の効果で、HPが${healed}回復した。`);
    }
    if (battleState.playerRegenTurns <= 0) { battleState.playerRegenAmount = 0; battleState.playerRegenLabel = ""; }
  }
  if (battleState.playerHealBonusTurns > 0) {
    battleState.playerHealBonusTurns--;
    if (battleState.playerHealBonusTurns <= 0) battleState.playerHealBonus = 0;
  }
}

// ===== たたかう =====
async function handleFightMenu() {
  const choice = await displayChoices([
    { text: "通常攻撃", next: "normal" },
    { text: "スキル", next: "skill" },
    { text: "道具", next: "item" },
    { text: "戻る", next: "back", isBack: true }
  ]);
  
  if (choice.next === "back") return false;
  
  if (choice.next === "normal") {
    return await playerNormalAttack();
  }
  
  if (choice.next === "skill") {
    return await handleSkillMenu();
  }
  
  if (choice.next === "item") {
    return await handleItemMenuInBattle();
  }
  
  return false;
}

// ★狂戦士「賊害の連鎖」：発動中、単体攻撃が命中した時にもう一体の敵にも連鎖してダメージを与える。
//   同じ計算式(damageFn)で改めてダメージを計算し、生きている敵の中から元の対象以外をランダムに選ぶ
async function maybeApplyChainAttack(primaryTarget, damageFn) {
  if (!battleState || !(battleState.playerChainAttackTurns > 0)) return;
  const candidates = getAliveEnemies().filter(e => e !== primaryTarget);
  if (candidates.length === 0) return;
  const chainTarget = candidates[Math.floor(Math.random() * candidates.length)];
  const raw = damageFn();
  const result = resolveDamageForTarget(chainTarget, raw);
  chainTarget.hp = Math.max(0, chainTarget.hp - result.damage);
  changeSpeaker("");
  if (result.blocked) {
    await displayMessage(`攻撃が${chainTarget.displayName}にも連鎖した！ しかし、効いていないようだッ！`);
  } else {
    await displayMessage(`攻撃が${chainTarget.displayName}にも連鎖した！ ${result.damage}のダメージ！`);
  }
  updateBattleHud();
}

async function playerNormalAttack() {
  // ★眠気が7割を超えていると、たまに動けずターンを無駄にしてしまう
  if (checkFallAsleep()) { // player.js
    changeSpeaker("");
    await displayMessage("しかし居眠りしてしまって動けなかった！");
    return true; // ★行動自体は失敗しても、ターンは消費する
  }
  
  const target = await selectEnemyTarget(); // ★敵が2体以上いる時は←→キー（クリックでも可）で狙う相手を選ばせる
  if (!target) return false; // ★狙う相手を選ぶ前にキャンセルした：ターンを消費せず選び直せる
  
  // ★状態異常「命中率低下」を受けていると、攻撃が外れることがある
  if (checkPlayerAttackMisses()) {
    changeSpeaker("");
    await displayMessage("攻撃した！ しかし外れてしまった！");
    return true;
  }
  
  const damage = calculatePlayerDamage();
  const result = resolveDamageForTarget(target, damage);
  target.hp = Math.max(0, target.hp - result.damage);
  changeSpeaker("");
  if (result.blocked) {
    await displayMessage(`攻撃した！ しかし、効いていないようだッ！`);
  } else if (lastHitWasCritical) {
    await displayMessage(`攻撃した！ 会心の一撃！ ${target.displayName}に${result.damage}のダメージ！`);
  } else {
    await displayMessage(`攻撃した！ ${target.displayName}に${result.damage}のダメージ！`);
  }
  updateBattleHud();
  await maybeApplyChainAttack(target, () => calculatePlayerDamage());
  return true;
}

// ★プレイヤーが状態異常「命中率低下」を受けている間、その分の確率で攻撃を外れさせる
function checkPlayerAttackMisses() {
  const accDown = player.statusAilments && player.statusAilments.accDown;
  if (!accDown || accDown.turns <= 0) return false;
  return Math.random() * 100 < (accDown.power || 15);
}

// ★自己強化「攻撃力上昇」の効果を、baseの攻撃力に反映する（mode:"add"なら+power、"multiply"ならpower%増し）。
//   isMagicalがtrueの時（魔法攻撃）は、これとは別枠の「魔力上昇」も追加で乗せる
function applyAtkBonusToStat(baseStat, isMagical) {
  let value = baseStat;
  if (battleState && battleState.playerAtkBonusTurns > 0) {
    value = battleState.playerAtkBonusMode === "multiply"
      ? Math.round(value * (1 + battleState.playerAtkBonus / 100))
      : value + battleState.playerAtkBonus;
  }
  if (isMagical && battleState && battleState.playerMagicBonusTurns > 0) {
    value = battleState.playerMagicBonusMode === "multiply"
      ? Math.round(value * (1 + battleState.playerMagicBonus / 100))
      : value + battleState.playerMagicBonus;
  }
  return value;
}

function calculatePlayerDamage() {
  if (battleState) battleState.playerAttackCount = (battleState.playerAttackCount || 0) + 1; // ★血闘の刻印用のカウント
  const variance = Math.floor(Math.random() * 7) - 3; // -3〜+3の揺らぎ
  const baseRaw = applyAtkBonusToStat(getEffectiveStats().atk) + variance; // ★被虐趣向の上限（元の威力の2.5倍まで）の基準にも使う
  // ★イクサガミの被虐趣向が発動中なら、通常攻撃は「(最大HP-現在HP) + 通常攻撃ダメージ」になる。攻撃したので効果は解除する。
  //   ★レベルが上がるほど無限に伸びてしまわないよう、素の攻撃力ダメージの2.5倍を上限にする
  if (battleState && battleState.playerHpBerserkActive) {
    battleState.playerHpBerserkActive = false;
    const missingHp = Math.max(0, player.gauges.hp.max - player.gauges.hp.current);
    const raw = Math.min(missingHp + baseRaw, Math.round(baseRaw * 2.5));
    return applyCriticalHit(Math.max(1, raw));
  }
  return applyCriticalHit(Math.max(1, baseRaw));
}

// ★技一覧の自己バフ（クリティカル率上昇）を反映した、簡易クリティカル判定。基本5%、命中したら1.5倍
function applyCriticalHit(damage) {
  const critChance = 5 + ((battleState && battleState.playerCritBonusTurns > 0) ? battleState.playerCritBonus : 0);
  if (Math.random() * 100 < critChance) {
    lastHitWasCritical = true;
    return Math.round(damage * 1.5);
  }
  lastHitWasCritical = false;
  return damage;
}

// ★「無敵解除アイテム」が設定された相手（主にボス）は、実際にそのアイテムを使うまでダメージが一切通らない。
//   指定が無い相手には何もせず、渡されたダメージをそのまま返す（今まで通りの挙動）
function resolveDamageForTarget(target, rawDamage) {
  if (target && target.invincibilityBreakItemId && !target.invincibilityBroken) {
    return { damage: 0, blocked: true };
  }
  // ★防御力低下（defDown）状態の相手には、少し多くダメージが通る
  let damage = rawDamage;
  if (target && target.status && target.status.defDown && target.status.defDown.turns > 0) {
    damage = Math.round(damage * 1.3);
  }
  return { damage, blocked: false };
}

// ★道具：インベントリの中から「回復量」または「疲労回復量」を持つアイテム（薬草・ポーションなど）に加えて、
//   今装備している武器・防具が専用の戦闘スキル(battleSkill)を持っていれば、それも選べるようにする
async function handleItemMenuInBattle() {
  const healableEntries = [];
  inventorySlots.forEach((slot) => {
    if (!slot) return;
    const master = ITEM_MASTER[slot.itemId];
    if (master && master.params && (master.params.回復量 > 0 || master.params.SP回復量 > 0 || master.params.疲労回復量 > 0 || master.params.眠気軽減割合 > 0 || master.params.解毒)) {
      healableEntries.push({ slot, master });
    }
  });
  
  const battleSkillEntries = [];
  Object.keys(player.equipment).forEach(slotKey => {
    const equipped = getEquippedItemData(slotKey); // player.js（instanceId→実体の解決）
    if (equipped && equipped.master.battleSkill) battleSkillEntries.push({ itemId: equipped.itemId, master: equipped.master });
  });
  
  // ★戦闘中の敵に「無敵解除アイテム」が設定されていて、まだ解除されておらず、かつ実際に持っているものだけを選択肢に出す
  const invincibilityBreakEntries = [];
  const seenBreakItemIds = new Set();
  getAliveEnemies().forEach(enemy => {
    const itemId = enemy.invincibilityBreakItemId;
    if (!itemId || enemy.invincibilityBroken || seenBreakItemIds.has(itemId)) return;
    const owned = inventorySlots.find(slot => slot && slot.itemId === itemId && slot.quantity > 0);
    if (!owned) return;
    const master = ITEM_MASTER[itemId];
    if (!master) return;
    seenBreakItemIds.add(itemId);
    invincibilityBreakEntries.push({ itemId, master });
  });
  
  if (healableEntries.length === 0 && battleSkillEntries.length === 0 && invincibilityBreakEntries.length === 0) {
    changeSpeaker("");
    await displayMessage("使える道具を持っていないようだ……");
    return false;
  }
  
  const itemChoices = [
    ...healableEntries.map(entry => ({ text: `${entry.master.name} ×${entry.slot.quantity}`, next: `heal:${entry.master.name}` })),
    ...battleSkillEntries.map(entry => ({ text: `${entry.master.name}【${entry.master.battleSkill.name}】`, next: `skill:${entry.master.name}` })),
    ...invincibilityBreakEntries.map(entry => ({ text: `${entry.master.name}を使う`, next: `break:${entry.itemId}` }))
  ];
  itemChoices.push({ text: "戻る", next: "back", isBack: true });
  
  const picked = await displayChoices(itemChoices);
  if (picked.next === "back") return false;
  
  const separatorIndex = picked.next.indexOf(":");
  const kind = picked.next.slice(0, separatorIndex);
  const name = picked.next.slice(separatorIndex + 1);
  
  if (kind === "skill") {
    const entry = battleSkillEntries.find(e => e.master.name === name);
    await useEquipmentBattleSkill(entry.master.battleSkill); // ★アイテム自体は消費しない（装備品なので）
    return true;
  }
  
  if (kind === "break") {
    const itemId = name; // ★このnextだけitemIdをそのまま入れているので、nameは実質itemId
    const entry = invincibilityBreakEntries.find(e => e.itemId === itemId);
    if (!entry) return false;
    removeItem(itemId, 1); // ★持っているだけでは解除されない。実際に「使う」ことで消費される
    getAliveEnemies().forEach(enemy => {
      if (enemy.invincibilityBreakItemId === itemId) enemy.invincibilityBroken = true;
    });
    renderStatusHUD();
    changeSpeaker("");
    await displayMessage(`「${entry.master.name}」を使った！ 相手の無敵が解けたようだ……！`);
    updateBattleHud();
    return true;
  }
  
  const entry = healableEntries.find(e => e.master.name === name);
  const resultMessage = await performItemHealWithTargetSelection(entry.master); // mainfunc.js（対象選択→回復適用）
  if (resultMessage === null) return false; // ★対象選択で「やめる」を選んだ：アイテムは消費せずやり直せる
  removeItem(entry.slot.itemId, 1);
  renderStatusHUD();
  
  changeSpeaker("");
  await displayMessage(`「${entry.master.name}」を使った！ ${resultMessage}`);
  return true;
}

// 装備品の専用戦闘スキル（性剣エクスカリバー「約束された絶頂の剣♂」、森の王の盾「静かなる権威」など）を発動する
async function useEquipmentBattleSkill(skill) {
  changeSpeaker("");
  await displayMessage(`「${skill.name}」を発動した！`);
  
  if (skill.effect === "stunChance") {
    const target = await selectEnemyTarget(); // ★行動不能にする相手を選ぶ
    if (target && Math.random() < skill.chance) {
      target.enemyStunnedTurns = skill.duration;
      await displayMessage(`${target.displayName}に強烈な一撃が突き刺さり、しばらく動けなくなった……！`);
    } else {
      await displayMessage("しかし、効果は発揮されなかったようだ……");
    }
  } else if (skill.effect === "damageReduction") {
    battleState.playerDamageReductionTurns = skill.duration;
    battleState.playerDamageReductionRatio = skill.reductionRatio;
    await displayMessage("静かな威圧感が場を包んだ。しばらくは攻撃が通りにくくなりそうだ。");
  }
  
  renderStatusHUD();
  updateBattleHud();
}

// ===== こうどう（挑発・奇声をあげる） =====
// ★どちらも「場に対して行う」演出のため、敵1体だけを選ばせるのではなく、生きている敵全員に効果を及ぼす
async function handleActionMenu() {
  const choice = await displayChoices([
    { text: "挑発", next: "taunt" },
    { text: "奇声をあげる", next: "scream" },
    { text: "戻る", next: "back", isBack: true }
  ]);
  
  if (choice.next === "back") return false;
  
  changeSpeaker("");
  const aliveEnemies = getAliveEnemies();
  
  if (choice.next === "taunt") {
    // ★相手の攻撃力を上げる代わりに、命中率を下げて「外しやすく」する
    aliveEnemies.forEach(enemy => {
      enemy.enemyAtkBonus += 4;
      enemy.enemyAccuracyPenalty += 25;
    });
    await displayMessage(aliveEnemies.length === 1
      ? `挑発した！ ${aliveEnemies[0].displayName}は攻撃的になったが、動きが雑になったようだ！`
      : "挑発した！ 敵全体が攻撃的になったが、動きが雑になったようだ！");
    updateBattleHud();
    return true;
  }
  
  if (choice.next === "scream") {
    // ★成功すれば「ドン引き」させて相手の次の行動を1回封じる
    const success = Math.random() < 0.6;
    if (success) {
      aliveEnemies.forEach(enemy => { enemy.enemyFlinched = true; });
      await displayMessage(aliveEnemies.length === 1
        ? `「うわあああぁぁぁ！！！」\n奇声をあげた！ ${aliveEnemies[0].displayName}は完全にドン引きしている……！`
        : "「うわあああぁぁぁ！！！」\n奇声をあげた！ 敵は全員完全にドン引きしている……！");
    } else {
      await displayMessage("「うわあああぁぁぁ！！！」\n奇声をあげたが、特に効いていないようだ。");
    }
    return true;
  }
  
  return false;
}

// ===== 逃げる =====
async function attemptFlee() {
  changeSpeaker("");
  
  // ★シナリオ演出戦（isScripted）は物語上ここで退けないボス戦なので、判定すらせず必ず失敗させる
  if (battleState.isScripted) {
    await displayMessage("この戦いから逃げることはできない……！");
    return false;
  }
  
  const fleeChance = 0.7;
  const success = Math.random() < fleeChance;
  
  if (success) {
    await displayMessage("うまく逃げ切った！");
    const wasTrial = battleState.isTrial;
    const wasScripted = battleState.isScripted;
    stopBattleBGM(); // bgm.js
    hideBattleHud();
    battleState = null;
    if (wasTrial) {
      changeSpeaker("");
      await displayMessage("石碑の輝きが静かに消えていった……試練はまたの機会に。");
      openTownMenu(); // town.js（試練は探索ループの外なので、村へ直接戻す）
    } else if (!wasScripted) {
      await returnToAdventureAfterBattle("flee"); // adventure.js ★勝利(win)とは区別し、報酬は渡さない
    }
    // ★シナリオ演出用の戦闘なら、ここで何もせず終わる（続きは呼び出し元に任せる）
    return true;
  }
  
  await displayMessage("逃げようとしたが、回り込まれてしまった！");
  return false;
}

// ===== 敵のターン =====
// ★性騎士の「絶倫」：SPが最大の2割を下回った瞬間、自動的に8割まで回復する（1戦闘につき3回まで）。
//   SPを消費する行動（技の使用、敵からのSP減少攻撃）の直後に毎回チェックする
function checkZetsurinAutoRecover() {
  if (!battleState || !player || !player.gauges || !player.gauges.sp) return;
  if (typeof hasPassiveSkill !== "function" || !hasPassiveSkill("spAutoRecover")) return;
  if (!(battleState.zetsurinUsesLeft > 0)) return;
  if (player.gauges.sp.current > player.gauges.sp.max * 0.2) return;
  const target = Math.round(player.gauges.sp.max * 0.8);
  if (player.gauges.sp.current >= target) return;
  battleState.zetsurinUsesLeft--;
  player.gauges.sp.current = target;
}

// ★「静かなる権威」（森の王の盾の専用スキル）が有効な間、受けるダメージを軽減する。
//   1ターン分の被弾ごとに残りターン数を1つ減らし、0になったら効果を解除する
// ★「不屈の闘志」「九死一生」等：本来なら戦闘不能になるはずの一撃だけを、HP1で耐え抜く。
//   「無敵(immune)」とは違い、致命傷にならない通常の一撃は普通に食らう
function applyPlayerDamageReduction(rawDamage) {
  if (battleState.playerImmuneTurns > 0) {
    battleState.playerImmuneTurns--;
    return 0; // ★完全無効化中
  }
  let damage = rawDamage;
  if (battleState.playerDamageReductionTurns > 0) {
    damage = Math.max(1, Math.round(damage * battleState.playerDamageReductionRatio));
    battleState.playerDamageReductionTurns--;
    if (battleState.playerDamageReductionTurns <= 0) battleState.playerDamageReductionRatio = 1;
  }
  if (battleState.playerSurviveLethalTurns > 0 && player && damage >= player.gauges.hp.current) {
    battleState.playerSurviveLethalTurns--; // ★致命傷を1回だけ肩代わりして消費する
    damage = Math.max(0, player.gauges.hp.current - 1);
  }
  return damage;
}

// ★生きている敵全員を、配置順に1体ずつ行動させる
// ===== 仲間のターン（主人公→仲間1→仲間2……→敵、の順の一部）=====
function getCompanionDisplayName(companion) {
  const master = typeof getCompanionMaster === "function" ? getCompanionMaster(companion) : null; // player.js
  return master ? master.name : "仲間";
}

async function companionTeamTurn() {
  if (!player || !player.companions || player.companions.length === 0) return;
  for (const companion of player.companions) {
    if (!battleState) return; // ★途中で戦闘が終わっていたら中断
    if (!companion.alive) continue;
    if (getAliveEnemies().length === 0) break; // ★既に全滅していたら、残りの仲間は行動させない
    await performCompanionAction(companion);
  }
}

// ★仲間の行動は、主人公と同じく「たたかう／スキル」から選んで、対象を選んで発動する
// ===== 仲間の自己バフ（狂戦士の技等）=====
// ★主人公のbattleStateと同じ考え方だが、仲間は複数人それぞれ独立に持てるよう、
//   仲間オブジェクト自身に一時的な戦闘用フィールド（_battleBuffs）を持たせる。
//   セーブデータには含めない想定のフィールドなので、戦闘開始のたびに必ずリセットする
function getCompanionBuffState(companion) {
  if (!companion._battleBuffs) {
    companion._battleBuffs = {
      atkBonusTurns: 0, atkBonus: 0, atkBonusMode: "add",
      magicBonusTurns: 0, magicBonus: 0, magicBonusMode: "add", // ★魔力上昇（攻撃力上昇とは別枠。魔法攻撃の時だけ上乗せする）
      critBonusTurns: 0, critBonus: 0,
      chainAttackTurns: 0,
      statusImmuneTurns: 0, // ★ハイ・ディスシプリナ「大いなる光芒状態」用
      regenTurns: 0, regenAmount: 0, // ★同上
      bloodDanceTurns: 0, bloodDanceAtkGain: 0, bloodDanceSelfDamageRatio: 0, bloodDanceBonus: 0, // ★血華の演舞（ブラッド・ダンス）用
      hateTurns: 0, // ★要望対応：ヘイトを買う状態異常。効果中は敵の攻撃が優先的にこの仲間に向く（pickEnemyAttackTarget参照）
      attackCount: 0
    };
  }
  return companion._battleBuffs;
}

function resetAllCompanionBattleBuffs() {
  if (!player || !player.companions) return;
  player.companions.forEach(c => { c._battleBuffs = null; });
}

// ★仲間版の自己強化発動。主人公のapplySelfBuffFromSkillと対応するkindだけ、仲間バフ状態に反映する
function applyCompanionSelfBuff(companion, effect) {
  if (!effect || !effect.kind) return null;
  const buffs = getCompanionBuffState(companion);
  const def = resolveStatusBuffDef(effect.kind);
  const mechanic = def ? def.mechanic : effect.kind;
  const duration = effect.duration || (def && def.defaultDuration) || 3;
  const power = effect.power != null && effect.power !== 0 ? effect.power : ((def && def.defaultPower) || 0);
  if (mechanic === "atkUp") { buffs.atkBonusTurns = duration; buffs.atkBonus = power || 5; buffs.atkBonusMode = effect.mode === "multiply" ? "multiply" : "add"; }
  else if (mechanic === "magicUp") { buffs.magicBonusTurns = duration; buffs.magicBonus = power || 5; buffs.magicBonusMode = effect.mode === "multiply" ? "multiply" : "add"; }
  else if (mechanic === "critUp") { buffs.critBonusTurns = duration; buffs.critBonus = power || 20; }
  else if (mechanic === "chainAttack") { buffs.chainAttackTurns = duration; }
  else if (mechanic === "statusImmune") { buffs.statusImmuneTurns = duration; }
  else if (mechanic === "regen") { buffs.regenTurns = duration; buffs.regenAmount = power || Math.round(companion.gauges.hp.max * 0.08); }
  // ★狂戦士「血華の演舞（ブラッド・ダンス）」：発動中(既定10ターン)は、攻撃するたびに攻撃力が積み上がり、
  //   代わりに攻撃するたび自分も少しダメージを受ける（maybeApplyBloodDanceOnAttack参照）
  else if (mechanic === "bloodDance") { buffs.bloodDanceTurns = duration; buffs.bloodDanceAtkGain = power || 2; buffs.bloodDanceSelfDamageRatio = 0.02; buffs.bloodDanceBonus = 0; }
  // ★ニート「豹変」等：atkUpとは違い、攻撃力・会心率・被ダメージ軽減をまとめて上げる「全ステータス上昇」
  else if (mechanic === "allStatsUp") { buffs.atkBonusTurns = duration; buffs.atkBonus = power || 15; buffs.atkBonusMode = "add"; buffs.critBonusTurns = duration; buffs.critBonus = Math.round((power || 15) * 0.6); }
  // ★要望対応：ヘイトを買う状態異常。効果中は敵の攻撃が優先的にこの仲間へ向くようになる（挑発・タンク役向け）
  else if (mechanic === "hate") { buffs.hateTurns = duration; }
  else return null; // ★immune/hpBerserk/surviveLethal/delayedPowerは、今のところ仲間には未対応
  return (def && def.label) || STATUS_EFFECT_LABELS[effect.kind] || effect.kind;
}

// ★血華の演舞（ブラッド・ダンス）発動中、仲間が攻撃を1回当てるたびに呼ぶ。
//   攻撃力が少しずつ積み上がり、代わりに自分も少しダメージを受ける
async function maybeApplyBloodDanceOnAttack(companion) {
  const buffs = getCompanionBuffState(companion);
  if (!(buffs.bloodDanceTurns > 0)) return;
  buffs.bloodDanceBonus += buffs.bloodDanceAtkGain;
  const selfDamage = Math.max(1, Math.round(companion.gauges.hp.max * buffs.bloodDanceSelfDamageRatio));
  companion.gauges.hp.current = Math.max(0, companion.gauges.hp.current - selfDamage);
  if (companion.gauges.hp.current <= 0 && companion.alive) {
    companion.alive = false;
    changeSpeaker("");
    await displayMessage(`${getCompanionDisplayName(companion)}は、血の代償に力尽きた……！`);
  }
  updateBattleHud();
}

// ★仲間の「攻撃力上昇」バフを、baseの攻撃力に反映する
// ★仲間の「攻撃力上昇」バフを、baseの攻撃力に反映する。血華の演舞は専用のターンカウンタ(bloodDanceTurns)を
//   持つが、積み上げた分は同じatkBonusに乗せているので、どちらかが有効なら加算する
// ★仲間の「攻撃力上昇」バフを、baseの攻撃力に反映する。血華の演舞は専用のターンカウンタ(bloodDanceTurns)を
//   持つが、積み上げた分は同じatkBonusに乗せているので、どちらかが有効なら加算する。
//   isMagicalがtrueの時（魔法攻撃）は、これとは別枠の「魔力上昇」も追加で乗せる
function applyCompanionAtkBonus(companion, baseStat, isMagical) {
  const buffs = getCompanionBuffState(companion);
  let result = baseStat;
  if (buffs.atkBonusTurns > 0) {
    result = buffs.atkBonusMode === "multiply" ? Math.round(result * (1 + buffs.atkBonus / 100)) : result + buffs.atkBonus;
  }
  if (buffs.bloodDanceTurns > 0) result += buffs.bloodDanceBonus; // ★血華の演舞で積み上がった分は常に加算
  if (isMagical && buffs.magicBonusTurns > 0) {
    result = buffs.magicBonusMode === "multiply" ? Math.round(result * (1 + buffs.magicBonus / 100)) : result + buffs.magicBonus;
  }
  return result;
}

// ★1ラウンド終了ごとに、生きている仲間全員のバフ残りターンを1つ減らす（継続回復もここで発動する）
async function tickAllCompanionTurnBasedBuffs() {
  if (!player || !player.companions) return;
  for (const c of player.companions) {
    if (!c._battleBuffs || !c.alive) continue;
    const buffs = c._battleBuffs;
    if (buffs.atkBonusTurns > 0) { buffs.atkBonusTurns--; if (buffs.atkBonusTurns <= 0) buffs.atkBonus = 0; }
    if (buffs.magicBonusTurns > 0) { buffs.magicBonusTurns--; if (buffs.magicBonusTurns <= 0) buffs.magicBonus = 0; }
    if (buffs.critBonusTurns > 0) { buffs.critBonusTurns--; if (buffs.critBonusTurns <= 0) buffs.critBonus = 0; }
    if (buffs.chainAttackTurns > 0) buffs.chainAttackTurns--;
    if (buffs.statusImmuneTurns > 0) buffs.statusImmuneTurns--;
    if (buffs.bloodDanceTurns > 0) { buffs.bloodDanceTurns--; if (buffs.bloodDanceTurns <= 0) buffs.bloodDanceBonus = 0; }
    if (buffs.hateTurns > 0) buffs.hateTurns--; // ★要望対応：ヘイトを買う状態異常の残りターンを減らす
    if (buffs.regenTurns > 0) {
      buffs.regenTurns--;
      const healed = applyHealToUnit(c, "hp", buffs.regenAmount, false, false); // player.js
      if (healed > 0) {
        changeSpeaker("");
        await displayMessage(`${getCompanionDisplayName(c)}が大いなる光芒に包まれ、HPが${healed}回復した。`);
      }
      if (buffs.regenTurns <= 0) buffs.regenAmount = 0;
    }
  }
}

// ★仲間版の連鎖攻撃（賊害の連鎖）。狙った相手以外の生きている敵をランダムに1体選び、同じ計算式で追撃する
async function maybeApplyCompanionChainAttack(companion, primaryTarget, damageFn) {
  const buffs = getCompanionBuffState(companion);
  if (!(buffs.chainAttackTurns > 0)) return;
  const candidates = getAliveEnemies().filter(e => e !== primaryTarget);
  if (candidates.length === 0) return;
  const chainTarget = candidates[Math.floor(Math.random() * candidates.length)];
  const raw = damageFn();
  const result = resolveDamageForTarget(chainTarget, raw);
  chainTarget.hp = Math.max(0, chainTarget.hp - result.damage);
  changeSpeaker("");
  const name = getCompanionDisplayName(companion);
  if (result.blocked) {
    await displayMessage(`${name}の攻撃が${chainTarget.displayName}にも連鎖した！ しかし、効いていないようだッ！`);
  } else {
    await displayMessage(`${name}の攻撃が${chainTarget.displayName}にも連鎖した！ ${result.damage}のダメージ！`);
  }
  updateBattleHud();
}

async function performCompanionAction(companion) {
  const aliveEnemies = getAliveEnemies();
  if (aliveEnemies.length === 0) return;
  
  const name = getCompanionDisplayName(companion);
  changeSpeaker("");
  await displayMessage(`${name}の番だ。行動を選ぼう。`);
  
  const action = await displayChoices([
    { text: "たたかう", next: "fight" },
    { text: "スキル", next: "skill" },
    { text: "道具", next: "item" } // ★要望対応：以前は主人公のターンでしか道具を使えなかったが、仲間の行動選択でも使えるようにする
  ]);
  
  if (action.next === "fight") {
    await performCompanionNormalAttack(companion);
  } else if (action.next === "item") {
    const used = await handleItemMenuInBattle(); // battle.js（対象は自分・他の仲間・全員から選べる。既存の道具選択と共通）
    if (!used) { await performCompanionAction(companion); return; } // ★何も使わず「戻る」を選んだ場合は、行動選択からやり直す
  } else {
    await performCompanionSkillMenu(companion);
  }
}

async function performCompanionNormalAttack(companion) {
  const target = await selectEnemyTarget();
  if (!target) {
    await performCompanionAction(companion); // ★狙う相手を選ぶ前にキャンセルしたので、行動選択からやり直す
    return;
  }
  
  const stats = getCompanionEffectiveStats(companion); // player.js
  const name = getCompanionDisplayName(companion);
  const variance = Math.floor(Math.random() * 7) - 3; // -3〜+3の揺らぎ（主人公の通常攻撃と統一）
  const raw = Math.max(1, applyCompanionAtkBonus(companion, stats.atk) + variance);
  getCompanionBuffState(companion).attackCount++; // ★血闘の刻印用のカウント（通常攻撃も数える）
  const result = resolveDamageForTarget(target, raw);
  target.hp = Math.max(0, target.hp - result.damage);
  
  changeSpeaker("");
  await displayMessage(`${name}の攻撃！ ${target.displayName}に${result.damage}のダメージ！`);
  renderStatusHUD();
  updateBattleHud();
  await maybeApplyBloodDanceOnAttack(companion); // ★血華の演舞：発動中なら攻撃力が積み上がり、代わりに少しダメージを受ける
  await maybeApplyCompanionChainAttack(companion, target, () => Math.max(1, applyCompanionAtkBonus(companion, stats.atk) + (Math.floor(Math.random() * 7) - 3)));
}

async function performCompanionSkillMenu(companion) {
  const name = getCompanionDisplayName(companion);
  // ★バグ修正：スキル管理タブでブロック編集した技は、以前の分類(type)がattack/heal/buff以外
  //   （passive等）のままだと、この絞り込みで弾かれて仲間の技一覧に一切出てこなかった
  //   （例：狂戦士の技をブロック編集してもケツァナが使えるようにならないバグ）。
  //   ブロックが1つでもある技は、type に関わらず使える技として扱う
  const skills = getCompanionSkills(companion).filter(s => s.type === "attack" || s.type === "heal" || s.type === "buff" || (Array.isArray(s.blocks) && s.blocks.length > 0)); // player.js
  
  if (skills.length === 0) {
    changeSpeaker("");
    await displayMessage(`${name}はまだ使えるスキルが無いようだ……通常攻撃で代わりに攻める。`);
    await performCompanionNormalAttack(companion);
    return;
  }
  
  const choices = skills.map(s => ({ text: `${s.name}（SP${s.spCost}）`, next: s.name, description: s.description }));
  choices.push({ text: "戻る", next: "back", isBack: true });
  const picked = await displayChoices(choices);
  if (picked.next === "back") {
    await performCompanionAction(companion); // ★行動選択からやり直す
    return;
  }
  
  const skill = skills.find(s => s.name === picked.next);
  if (companion.gauges.sp.current < skill.spCost) {
    changeSpeaker("");
    await displayMessage("SPが足りない！");
    await performCompanionSkillMenu(companion);
    return;
  }
  
  companion.gauges.sp.current -= skill.spCost;
  changeSpeaker("");
  
  // ★バグ修正：スキル管理タブでブロック編集した技（狂戦士の技など）は、主人公と同じく
  //   固定フィールド（type別分岐）を無視してブロック実行モードに切り替える
  if (Array.isArray(skill.blocks) && skill.blocks.length > 0) {
    const success = await runSkillBlocksForCompanionTurn(companion, skill);
    if (!success) {
      companion.gauges.sp.current += skill.spCost; // ★対象選択をキャンセルしたので、消費したSPを返す
      renderStatusHUD();
      await performCompanionSkillMenu(companion);
      return;
    }
    renderStatusHUD();
    updateBattleHud();
    return;
  }
  
  // ★HPを消費する代わりに威力が上がるタイプの技（selfDamageRatio）。以前は仲間側では未対応で、
  //   代償を払わず効果だけ得られてしまっていた
  if (skill.selfDamageRatio) {
    const selfDamage = Math.max(1, Math.round(companion.gauges.hp.max * skill.selfDamageRatio));
    companion.gauges.hp.current = Math.max(0, companion.gauges.hp.current - selfDamage);
    await displayMessage(`「${skill.name}」の代償として、${name}のHPが${selfDamage}減った……`);
    renderStatusHUD();
    updateBattleHud();
    if (companion.gauges.hp.current <= 0) {
      companion.alive = false;
      await displayMessage(`${name}は力尽きた……！`);
      return;
    }
  }
  
  if (skill.type === "buff") {
    // ★以前はメッセージを出すだけで、実際の効果（攻撃力上昇・連鎖攻撃等）が一切適用されていなかった
    const appliedLabels = applyAllSelfBuffsToCompanion(companion, skill);
    await displayMessage(`${name}の「${skill.name}」！` + (appliedLabels.length > 0 ? ` ${appliedLabels.join("・")}状態になった！` : ""));
    renderStatusHUD();
    updateBattleHud();
    return;
  }
  
  if (skill.type === "heal") {
    // ★要望対応：回復技は、道具と違って自由に対象を選べるのではなく、技ごとに指定された
    //   「単体」か「全体（partyWide）」かに従う。全体指定の技は選ばせず自分＋生きている仲間全員が対象、
    //   単体指定の技は自分／他の仲間／主人公から選ぶ（「全員」は選べない。回復量を割る仕組みが無いため）
    let targets;
    if (skill.partyWide) {
      targets = [player, ...(player.companions || []).filter(c => c.alive)];
    } else {
      // ★対象（自分／他の仲間／主人公）を選ばせる。パーティが1人（この仲間だけ）なら聞かずに自分を対象にする
      const choices = getHealTargetChoices(companion, false); // player.js
      if (choices.length === 0) {
        targets = [companion];
      } else {
        choices.push({ text: "やめる", next: "cancel", isBack: true });
        const picked = await displayChoices(choices);
        if (picked.next === "cancel") {
          companion.gauges.sp.current += skill.spCost; // ★やめたので、消費したSPを返す
          renderStatusHUD();
          await performCompanionSkillMenu(companion);
          return;
        }
        targets = resolveHealTargetUnits(picked.next, !!skill.revives, companion); // player.js
      }
    }
    
    const power = skill.power || 0;
    const gaugeKey = skill.gauge === "sp" ? "sp" : "hp";
    const messageParts = [];
    targets.forEach(unit => {
      const parts = [];
      const wasDown = unit !== player && !unit.alive;
      const healed = applyHealToUnit(unit, gaugeKey, power, !!skill.cleanse, !!skill.revives); // player.js
      if (wasDown && unit.alive) parts.push("目を覚ました");
      if (healed > 0) parts.push(`${gaugeKey === "sp" ? "SP" : "HP"}が${healed}回復した`);
      if (skill.healBothGauges) {
        const otherKey = gaugeKey === "sp" ? "hp" : "sp";
        const healedOther = applyHealToUnit(unit, otherKey, power, false, false); // player.js
        if (healedOther > 0) parts.push(`${otherKey === "sp" ? "SP" : "HP"}が${healedOther}回復した`);
      }
      if (skill.cleanse && unit === player) parts.push("状態異常が全て治った");
      if (parts.length > 0) messageParts.push(`${getHealTargetDisplayName(unit, companion)}：${parts.join("。")}`); // player.js
    });
    
    await displayMessage(`${name}の「${skill.name}」！ ${messageParts.length > 0 ? messageParts.join(" ") : "特に変化は無かった。"}`);
    renderStatusHUD();
    updateBattleHud();
    return;
  }
  
  // ★攻撃技：全体対象ならそのまま生きている敵全員、単体対象なら狙う相手を選ばせる
  const aliveEnemies = getAliveEnemies();
  const targets = skill.target === "all" ? aliveEnemies : [await selectEnemyTarget()];
  if (!targets[0]) {
    companion.gauges.sp.current += skill.spCost; // ★狙う相手を選ぶ前にキャンセルしたので、消費したSPを返す
    renderStatusHUD();
    await performCompanionSkillMenu(companion); // ★スキル選択からやり直す
    return;
  }
  
  const hitCount = skill.hitCount || 1;
  // ★以前はhitCount分のダメージを内部で合計してから最後に1行にまとめて表示していたため、
  //   「攻撃回数を増やしても反映されていないように見える」という誤解の元になっていた。
  //   主人公自身の技と同じく、1回ずつダメージを表示するように直す
  let totalDamage = 0;
  let lifestealTotal = 0; // ★血臭の宴：与えたダメージの合計（後でHP変換する）
  // ★ダメージ = レベル倍率 × 威力(skill.power) + 攻撃力(または魔力)×0.7（主人公と同じ計算式。player.js）
  const companionStats = getCompanionEffectiveStats(companion); // player.js
  const companionBaseAtkRaw = skill.atkType === "magical" ? companionStats.skillPower : companionStats.atk;
  const companionBaseAtk = applyCompanionAtkBonus(companion, companionBaseAtkRaw, skill.atkType === "magical"); // ★仲間版「攻撃力上昇」バフを反映
  const companionLevelMultiplier = 1 + (companion.level || 1) * 0.05; // ★プレイヤーの技威力計算式（レベル×0.05）と統一
  const companionBuffs = getCompanionBuffState(companion);
  
  changeSpeaker("");
  let isFirstHit = true;
  for (const target of targets) {
    if (!target) continue;
    for (let i = 0; i < hitCount; i++) {
      if (target.hp <= 0) break; // ★倒した後の残り命中回数は空撃ちしない（主人公側の全体攻撃と同じ挙動）
      companionBuffs.attackCount++; // ★血闘の刻印用のカウント
      const variance = Math.floor(Math.random() * 7) - 3; // -3〜+3の揺らぎ
      // ★バグ修正（バランス調整）：主人公側と同じく、攻撃力由来のダメージは命中回数で割って
      //   合計が1回分になるようにする（以前は命中回数のたびに攻撃力ぶんが丸ごと乗ってしまっていた）
      let raw = Math.max(1, Math.round(companionLevelMultiplier * (skill.power || 0)) + Math.round(Math.round(companionBaseAtk * 0.7) / Math.max(1, hitCount)) + variance);
      // ★狂戦士「血闘の刻印」：ここまでに繰り出した攻撃の回数に応じて威力が増加する（上限あり）
      if (skill.id === "kettou_no_kokuin") {
        const bonusRatio = Math.min(0.6, Math.max(0, companionBuffs.attackCount - 1) * 0.03);
        raw = Math.round(raw * (1 + bonusRatio));
      }
      const result = resolveDamageForTarget(target, raw);
      target.hp = Math.max(0, target.hp - result.damage);
      totalDamage += result.damage;
      if (skill.lifestealRatio) lifestealTotal += result.damage; // ★血臭の宴：与えたダメージの一部を後でHPに変換する
      // ★複数回攻撃・複数対象の技名は最初の1回だけ言い、以降はダメージ量だけ表示する
      const prefix = isFirstHit ? `${name}の「${skill.name}」！ ` : "";
      isFirstHit = false;
      if (result.blocked) {
        await displayMessage(`${prefix}しかし、${target.displayName}には効いていないようだッ！`);
      } else {
        await displayMessage(`${prefix}${target.displayName}に${result.damage}のダメージ！`);
      }
      updateBattleHud();
      await maybeApplyBloodDanceOnAttack(companion); // ★血華の演舞：発動中なら攻撃力が積み上がり、代わりに少しダメージを受ける
    }
    if (target.hp > 0 && skill.statusEffect && Math.random() < (skill.statusEffect.chance != null ? skill.statusEffect.chance : 1)) {
      const applied = applyEnemyStatusEffectFromSkill(target, skill.statusEffect);
      if (applied) await displayMessage(`${target.displayName}は${applied}状態になった！`);
    }
    if (target.hp > 0 && skill.statusEffect2 && Math.random() < (skill.statusEffect2.chance != null ? skill.statusEffect2.chance : 1)) {
      const applied2 = applyEnemyStatusEffectFromSkill(target, skill.statusEffect2);
      if (applied2) await displayMessage(`${target.displayName}は${applied2}状態になった！`);
    }
  }
  
  // ★血臭の宴：与えたダメージの一部を自身のHPに変換する
  if (skill.lifestealRatio && lifestealTotal > 0) {
    const healed = applyHealToUnit(companion, "hp", Math.round(lifestealTotal * skill.lifestealRatio), false, false); // player.js
    if (healed > 0) await displayMessage(`${name}はダメージの一部をHPに変換した！ HPが${healed}回復した！`);
  }
  
  // ★捨身乱撃のように、攻撃技自体に自己バフ／デバフ（防御力低下など）が付いているものもある
  if (skill.selfBuff) {
    const appliedKind = applyCompanionSelfBuff(companion, skill.selfBuff);
    if (appliedKind) {
      const label = (skill.selfBuff.kind === "defUp" && skill.selfBuff.power < 0) ? "防御力低下" : appliedKind;
      await displayMessage(`${name}は${label}状態になった！`);
    }
  }
  // ★狂戦士「賊害の連鎖」発動中は、単体攻撃技がもう一体の敵にも連鎖する（全体攻撃技は対象外）
  if (skill.target !== "all" && targets[0]) {
    await maybeApplyCompanionChainAttack(companion, targets[0], () => {
      const variance = Math.floor(Math.random() * 7) - 3;
      return Math.max(1, Math.round(companionLevelMultiplier * (skill.power || 0)) + Math.round(companionBaseAtk * 0.7) + variance);
    });
  }
  
  updateBattleHud();
}

async function enemyTeamTurn() {
  const alive = getAliveEnemies();
  for (const enemy of alive) {
    if (!battleState) return; // ★途中で戦闘が終わっていたら中断
    if (enemy.hp <= 0) continue; // ★このターン中に既に倒された相手は行動させない
    await runSingleEnemyTurn(enemy);
    if (!battleState) return;
    if (isPartyDefeated()) return; // ★力尽きたら、残りの敵は行動させず終了（battleLoop側で敗北処理する）
  }
}

// ★敵が攻撃する相手を、主人公＋生きている仲間の中からランダムに選ぶ
//   ★要望対応：「ヘイトを買う」状態異常/バフの効果中は、その相手が優先的に狙われる
//   （ヘイト中の相手が1人でもいれば、その中からランダムに選ぶ。誰もいなければ今まで通り全員から選ぶ）
function pickEnemyAttackTarget() {
  const candidates = [{ isPlayer: true, displayName: "あなた", hate: hasPlayerStatusAilment("hate") }];
  if (player && player.companions) {
    player.companions.forEach(c => {
      if (c.alive) candidates.push({ isPlayer: false, companion: c, displayName: getCompanionDisplayName(c), hate: !!(c._battleBuffs && c._battleBuffs.hateTurns > 0) });
    });
  }
  const hatedCandidates = candidates.filter(c => c.hate);
  const pool = hatedCandidates.length > 0 ? hatedCandidates : candidates;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ===== ボスの「戦闘イベント」（ボス管理タブで組む、ifっぽい条件付きの演出・行動） =====
// ★条件を満たしているかどうかを判定する
function checkBossBattleEventCondition(event, enemy) {
  const value = Number(event.conditionValue) || 0;
  if (event.conditionType === "bossHpBelow") {
    return enemy.maxHp > 0 && (enemy.hp / enemy.maxHp) * 100 <= value;
  }
  if (event.conditionType === "playerHpBelow") {
    return player.gauges.hp.max > 0 && (player.gauges.hp.current / player.gauges.hp.max) * 100 <= value;
  }
  if (event.conditionType === "playerSpBelow") {
    return player.gauges.sp.max > 0 && (player.gauges.sp.current / player.gauges.sp.max) * 100 <= value;
  }
  if (event.conditionType === "turnCount") {
    return (battleState.turnCount || 1) >= value;
  }
  return false;
}

// ★今のenemy（ボス）が、今まさに発火すべき戦闘イベントを持っていれば1つ返す（無ければnull）。
//   上から順に見て、まだ発火していない・条件を満たしている最初の1件だけを返す（1ターンに1件まで）
function findTriggerableBossBattleEvent(enemy) {
  const master = MONSTER_MASTER[enemy.monsterKey];
  if (!master || !Array.isArray(master.battleEvents)) return null;
  if (!Array.isArray(enemy.triggeredBattleEventIds)) enemy.triggeredBattleEventIds = [];
  return master.battleEvents.find(event =>
    !enemy.triggeredBattleEventIds.includes(event.id) && checkBossBattleEventCondition(event, enemy)
  ) || null;
}

// ★戦闘イベントを実行する。戻り値：trueなら「このターンの行動を使い切った」（通常攻撃はしない）、
//   falseなら「演出だけで、この後いつも通り通常攻撃に続く」
async function executeBossBattleEvent(enemy, event) {
  enemy.triggeredBattleEventIds.push(event.id); // ★1回発火したら、この戦闘中は二度と発火しない
  
  if (event.action === "message") {
    // ★戦闘中セリフを言うだけ。行動は消費しない（この後、通常攻撃に続く）
    changeSpeaker(enemy.displayName);
    await displayMessage(event.messageText || "……！");
    return false;
    
  } else if (event.action === "removeInvincibility") {
    // ★ボスの無敵を解除する。行動は消費しない
    enemy.invincibilityBroken = true;
    changeSpeaker("");
    await displayMessage(event.messageText || `${enemy.displayName}の様子が変わった……！`);
    return false;
    
  } else if (event.action === "changeForm") {
    // ★第2形態になる：名前を変え、攻撃力を上げ、HPを少し回復する。行動は消費する（変身で手一杯という演出）
    changeSpeaker("");
    await displayMessage(event.messageText || `${enemy.displayName}の様子が変わった……！`);
    if (event.formName) enemy.displayName = event.formName;
    const atkMultiplier = Number(event.formAtkMultiplier) || 1;
    enemy.atk = Math.round(enemy.atk * atkMultiplier);
    const healRatio = Number(event.formHealRatio) || 0;
    if (healRatio > 0) enemy.hp = Math.min(enemy.maxHp, enemy.hp + Math.round(enemy.maxHp * healRatio));
    updateBattleHud();
    return true;
    
  } else if (event.action === "summonAlly") {
    // ★仲間の魔物を呼ぶ。行動は消費する
    changeSpeaker(enemy.displayName);
    await displayMessage(event.messageText || "……仲間を呼んだ！");
    if (event.allyMonsterKey && MONSTER_MASTER[event.allyMonsterKey] && typeof createEnemyUnit === "function") {
      const ally = createEnemyUnit(event.allyMonsterKey, enemy.level || player.level);
      battleState.enemies.push(ally);
      if (typeof assignDisplayNames === "function") assignDisplayNames(battleState.enemies);
      updateBattleHud();
    }
    return true;
    
  } else if (event.action === "heal") {
    // ★自分のHPを回復する。行動は消費する
    const healRatio = Number(event.healRatio) || 0.3;
    const healAmount = Math.round(enemy.maxHp * healRatio);
    enemy.hp = Math.min(enemy.maxHp, enemy.hp + healAmount);
    changeSpeaker(enemy.displayName);
    await displayMessage(event.messageText || `${enemy.displayName}は体力を回復した！（${healAmount}）`);
    updateBattleHud();
    return true;
    
  } else if (event.action === "useSkill") {
    // ★特定の技を撃ってくる。専用スキル（uniqueSkill）と同じ仕組みで処理する。行動は消費する
    await executeMonsterUniqueSkill(enemy, {
      name: event.skillName || "強力な一撃",
      flavor: event.messageText || "",
      multiplier: Number(event.skillMultiplier) || 1.5,
      kind: event.skillKind || undefined
    });
    return true;
  }
  
  return false;
}

async function runSingleEnemyTurn(enemy) {
  changeSpeaker("");
  
  // ★毎ターン開始時：燃焼・毒のダメージ、状態異常の残りターン減少
  if (enemy.status) {
    if (enemy.status.burn && enemy.status.burn.turns > 0) {
      enemy.hp = Math.max(0, enemy.hp - enemy.status.burn.power);
      enemy.status.burn.turns--;
      await displayMessage(`${enemy.displayName}は火傷のダメージを受けた！（${enemy.status.burn.power}）`);
      updateBattleHud();
      if (enemy.hp <= 0) return;
    }
    if (enemy.status.poison && enemy.status.poison.turns > 0) {
      enemy.hp = Math.max(0, enemy.hp - enemy.status.poison.power);
      enemy.status.poison.turns--;
      await displayMessage(`${enemy.displayName}は毒のダメージを受けた！（${enemy.status.poison.power}）`);
      updateBattleHud();
      if (enemy.hp <= 0) return;
    }
    // ★以前は「鈍痛」も毒(status.poison)と同じ枠を使い回していたため、両方が同じ状態として
    //   扱われてしまっていた（メッセージも常に「毒のダメージ」表記になっていた）。別枠に分離した
    if (enemy.status.dullPain && enemy.status.dullPain.turns > 0) {
      enemy.hp = Math.max(0, enemy.hp - enemy.status.dullPain.power);
      enemy.status.dullPain.turns--;
      await displayMessage(`${enemy.displayName}は鈍痛のダメージを受けた！（${enemy.status.dullPain.power}）`);
      updateBattleHud();
      if (enemy.hp <= 0) return;
    }
    if (enemy.status.atkDown && enemy.status.atkDown.turns > 0) enemy.status.atkDown.turns--;
    if (enemy.status.defDown && enemy.status.defDown.turns > 0) enemy.status.defDown.turns--;
    if (enemy.status.accDown && enemy.status.accDown.turns > 0) enemy.status.accDown.turns--;
    
    if (enemy.status.stun > 0) {
      enemy.status.stun--;
      await displayMessage(`${enemy.displayName}はスタンして動けないようだ……`);
      return;
    }
    if (enemy.status.paralyze > 0) {
      enemy.status.paralyze--;
      if (Math.random() < 0.5) {
        await displayMessage(`${enemy.displayName}は麻痺していて動けないようだ……`);
        return;
      }
    }
    if (enemy.status.confuse > 0) {
      enemy.status.confuse--;
      const selfDamage = Math.max(1, Math.round(enemy.atk * 0.4));
      enemy.hp = Math.max(0, enemy.hp - selfDamage);
      await displayMessage(`${enemy.displayName}は混乱していて、自分を攻撃した！（${selfDamage}）`);
      updateBattleHud();
      return;
    }
  }
  
  // ★「約束された絶頂の剣♂」で行動不能にされている間は、何もできずターンが過ぎる
  if (enemy.enemyStunnedTurns > 0) {
    enemy.enemyStunnedTurns--;
    await displayMessage(`${enemy.displayName}はまだ余韻から立ち直れず、動けないようだ……`);
    return;
  }
  
  if (enemy.enemyFlinched) {
    await displayMessage(`${enemy.displayName}はまだドン引きしていて、動けないようだ……`);
    enemy.enemyFlinched = false; // 効果は1ターンのみ
    return;
  }
  
  const master = MONSTER_MASTER[enemy.monsterKey];
  
  // ★ボス管理タブで組んだ「戦闘イベント」（HP割合・ターン数などの条件で発火する演出・行動）を確認する。
  //   通常攻撃・専用スキルより優先する
  const triggerableEvent = findTriggerableBossBattleEvent(enemy);
  if (triggerableEvent) {
    const usedTurn = await executeBossBattleEvent(enemy, triggerableEvent);
    if (!battleState || enemy.hp <= 0) return; // ★演出の巻き添えで戦闘が終わっていたら、ここで打ち切る
    if (usedTurn) return; // ★行動を消費するイベントだった場合は、このターンはここで終わり（通常攻撃はしない）
    // ★行動を消費しないイベント（message・removeInvincibility）だった場合は、このままいつも通り下へ続く
  }
  
  // ★魔物ごとの固有スキル：一定確率で通常攻撃の代わりに繰り出してくる（今のところ常に主人公を狙う）
  if (master && master.uniqueSkill && Math.random() < master.uniqueSkill.chance) {
    await executeMonsterUniqueSkill(enemy, master.uniqueSkill);
    return;
  }
  
  // ★狙う相手を、主人公と生きている仲間の中からランダムに選ぶ
  const attackTarget = pickEnemyAttackTarget();
  
  const baseHitChance = 85;
  const accDownPenalty = (enemy.status && enemy.status.accDown && enemy.status.accDown.turns > 0) ? enemy.status.accDown.power : 0;
  const hitChance = Math.max(10, baseHitChance - enemy.enemyAccuracyPenalty - accDownPenalty);
  const hit = Math.random() * 100 < hitChance;
  
  if (!hit) {
    await displayMessage(`${enemy.displayName}の攻撃！ しかし外れた！`);
    return;
  }
  
  const atkDownPenalty = (enemy.status && enemy.status.atkDown && enemy.status.atkDown.turns > 0) ? enemy.status.atkDown.power : 0;
  const enemyAtk = Math.max(0, enemy.atk + enemy.enemyAtkBonus - atkDownPenalty);
  const variance = Math.floor(Math.random() * 3) - 1; // -1〜+1の揺らぎ
  
  if (!attackTarget.isPlayer) {
    // ★仲間を狙った場合：仲間のHPを直接削る（今のところ、被ダメ軽減バフ・状態異常の付与は主人公限定）
    const companion = attackTarget.companion;
    const damage = Math.max(1, enemyAtk + variance);
    companion.gauges.hp.current = Math.max(0, companion.gauges.hp.current - damage);
    renderStatusHUD();
    if (typeof triggerCameraShake === "function") triggerCameraShake(); // mainfunc.js
    await displayMessage(`${enemy.displayName}の攻撃！ ${attackTarget.displayName}は${damage}のダメージを受けた！`);
    if (companion.gauges.hp.current <= 0 && companion.alive) {
      companion.alive = false;
      await displayMessage(`${attackTarget.displayName}は倒れてしまった……！`);
    }
    return;
  }
  
  let damage = applyPlayerDamageReduction(Math.max(1, enemyAtk + variance)); // ★防御力システム廃止のため、こちらの防御力による減算は無し（代わりに最大HPで受け止める）＋「静かなる権威」の軽減を反映
  
  // ★状態異常「防御力低下」を受けている間は、受けるダメージが割増しになる
  const playerDefDown = player.statusAilments && player.statusAilments.defDown;
  if (playerDefDown && playerDefDown.turns > 0) {
    damage = Math.round(damage * (1 + (playerDefDown.power || 10) / 100));
  }
  
  changeGauge("hp", -damage);
  renderStatusHUD();
  if (typeof triggerCameraShake === "function") triggerCameraShake(); // mainfunc.js
  
  await displayMessage(`${enemy.displayName}の攻撃！ ${damage}のダメージを受けた！`);
  
  // ★魔物ごとに設定した状態異常（マップ設定タブの敵設定・ボス設定で編集可能）を、攻撃が当たった時に確率判定つきで付与する。
  //   古いpoisonChanceのみの魔物データも、そのまま毒として扱われる（後方互換）
  const inflictions = (master && Array.isArray(master.statusInflictions) && master.statusInflictions.length > 0)
    ? master.statusInflictions
    : (master && master.poisonChance ? [{ kind: "poison", chance: master.poisonChance, duration: 3, power: 0 }] : []);
  for (const infliction of inflictions) {
    if (!infliction.kind) continue;
    // ★バグ修正：状態異常タブで作ったカスタムの状態異常は、id（見た目上の種類）とmechanic（実際の動作）が
    //   別々の値になり得る（例：id="great_frost_stun"だがmechanicは"stun"）。ここでidのまま
    //   applyPlayerStatusAilmentへ渡してしまうと、他の場所（hasPlayerStatusAilment("stun")等）が
    //   決め打ちで見ているmechanic名と一致せず、主人公に付与された時だけ効果が発動しないバグがあった
    const def = resolveStatusAilmentDef(infliction.kind);
    const mechanic = def ? def.mechanic : infliction.kind;
    if (hasPlayerStatusAilment(mechanic)) continue; // ★既にかかっている状態異常は上書きしない
    if (Math.random() < (infliction.chance != null ? infliction.chance : 1)) {
      // ★ハイ・ディスシプリナ「大いなる光芒状態」中は、状態異常の付与そのものを無効化する
      if (battleState.playerStatusImmuneTurns > 0) continue;
      applyPlayerStatusAilment(mechanic, infliction.duration || 3, infliction.power || 0); // player.js
      changeSpeaker("");
      await displayMessage(`${(def && def.label) || STATUS_EFFECT_LABELS[infliction.kind] || infliction.kind}状態になってしまった……！`);
    }
  }
  
  // ★「大いなる光芒状態」は、ここまでで敵の攻撃を1回受け終えた＝1ターン経過とみなして消費する
  if (battleState.playerStatusImmuneTurns > 0) battleState.playerStatusImmuneTurns--;
}

// 魔物固有スキルの実行本体。通常攻撃より威力の倍率(multiplier)が高いものが多く、
// kind: "drain" のものはダメージに加えてプレイヤーのSPも吸い取ってくる（サキュバスの「誘惑」など）
async function executeMonsterUniqueSkill(enemy, skill) {
  changeSpeaker(enemy.displayName);
  await displayMessage(`「${skill.name}」！ ${skill.flavor || ""}`);
  
  const enemyAtk = enemy.atk + enemy.enemyAtkBonus;
  const damage = applyPlayerDamageReduction(Math.max(1, Math.round(enemyAtk * (skill.multiplier || 1))));
  changeGauge("hp", -damage);
  if (typeof triggerCameraShake === "function") triggerCameraShake(); // mainfunc.js
  
  changeSpeaker("");
  const messageParts = [`${damage}のダメージを受けた`];
  
  // ★「パラメータ吸収」技：与えたダメージの一部を自分のHPとして吸収したり、SPを吸い取ったりしてくる
  if (skill.kind === "drain") {
    if (skill.hpDrainRatio) {
      const healed = Math.max(1, Math.round(damage * skill.hpDrainRatio));
      const actualHealed = Math.min(healed, enemy.maxHp - enemy.hp);
      enemy.hp = Math.min(enemy.maxHp, enemy.hp + healed);
      if (actualHealed > 0) messageParts.push(`${enemy.displayName}はHPを${actualHealed}吸収した`);
    }
    if (skill.spDrain) {
      changeGauge("sp", -skill.spDrain);
      checkZetsurinAutoRecover(); // ★性騎士の「絶倫」：SP吸収でも2割を切れば発動しうる
      messageParts.push(`SPを${skill.spDrain}吸い取られてしまった`);
    }
  }
  
  await displayMessage(messageParts.join("、") + "……！");
  renderStatusHUD();
  updateBattleHud();
}

// ===== 特殊スキル・ブロックシステム（式パーサー） =====
// ★数値を入れる欄に「自分HP割合 * 2」のような簡単な式を書けるようにするための、専用の小さな評価器。
//   Function()やevalは使わず、四則演算・比較演算・&&/||・三項演算子・変数参照だけを解釈する（任意コード実行はできない）。
function tokenizeSkillExpression(src) {
  const tokens = [];
  let i = 0;
  const isSpace = c => c === " " || c === "\t" || c === "\n" || c === "　";
  const opChars = "+-*/%()?:<>=!&|,"; // ★要望対応：カンマを追加（randbuild(最小,最大)のような関数呼び出しの引数区切りに使う）
  while (i < src.length) {
    const c = src[i];
    if (isSpace(c)) { i++; continue; }
    if ((c >= "0" && c <= "9") || (c === "." && src[i + 1] >= "0" && src[i + 1] <= "9")) {
      let j = i;
      while (j < src.length && ((src[j] >= "0" && src[j] <= "9") || src[j] === ".")) j++;
      tokens.push({ type: "num", value: parseFloat(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (opChars.includes(c)) {
      const two = src.slice(i, i + 2);
      if (["==", "!=", "<=", ">=", "&&", "||"].includes(two)) {
        tokens.push({ type: "op", value: two });
        i += 2;
        continue;
      }
      tokens.push({ type: "op", value: c });
      i++;
      continue;
    }
    let j = i;
    while (j < src.length && !isSpace(src[j]) && !opChars.includes(src[j])) j++;
    if (j === i) { i++; continue; } // ★どの分岐にも当てはまらない文字は無視して読み飛ばす（安全側）
    tokens.push({ type: "id", value: src.slice(i, j) });
    i = j;
  }
  return tokens;
}

function parseSkillExpressionTokens(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const isOp = (t, val) => !!t && t.type === "op" && t.value === val;
  function expectOp(val) { const t = next(); if (!t || t.value !== val) throw new Error(`式が不正です（${val}が必要）`); }
  
  function parseTernary() {
    const cond = parseOr();
    if (isOp(peek(), "?")) {
      next();
      const whenTrue = parseTernary();
      expectOp(":");
      const whenFalse = parseTernary();
      return { type: "ternary", cond, whenTrue, whenFalse };
    }
    return cond;
  }
  function parseOr() {
    let left = parseAnd();
    while (isOp(peek(), "||")) { next(); left = { type: "or", left, right: parseAnd() }; }
    return left;
  }
  function parseAnd() {
    let left = parseEquality();
    while (isOp(peek(), "&&")) { next(); left = { type: "and", left, right: parseEquality() }; }
    return left;
  }
  function parseEquality() {
    let left = parseRelational();
    while (peek() && peek().type === "op" && ["==", "!="].includes(peek().value)) {
      const op = next().value;
      left = { type: "binop", op, left, right: parseRelational() };
    }
    return left;
  }
  function parseRelational() {
    let left = parseAdditive();
    while (peek() && peek().type === "op" && ["<", ">", "<=", ">="].includes(peek().value)) {
      const op = next().value;
      left = { type: "binop", op, left, right: parseAdditive() };
    }
    return left;
  }
  function parseAdditive() {
    let left = parseMultiplicative();
    while (peek() && peek().type === "op" && ["+", "-"].includes(peek().value)) {
      const op = next().value;
      left = { type: "binop", op, left, right: parseMultiplicative() };
    }
    return left;
  }
  function parseMultiplicative() {
    let left = parseUnary();
    while (peek() && peek().type === "op" && ["*", "/", "%"].includes(peek().value)) {
      const op = next().value;
      left = { type: "binop", op, left, right: parseUnary() };
    }
    return left;
  }
  function parseUnary() {
    if (isOp(peek(), "-") || isOp(peek(), "!")) {
      const op = next().value;
      return { type: "unary", op, operand: parseUnary() };
    }
    return parsePrimary();
  }
  function parsePrimary() {
    const t = peek();
    if (!t) throw new Error("式が不完全です");
    if (t.type === "num") { next(); return { type: "num", value: t.value }; }
    if (isOp(t, "(")) { next(); const expr = parseTernary(); expectOp(")"); return expr; }
    if (t.type === "id") {
      next();
      // ★要望対応：識別子の直後が「(」なら、変数ではなく関数呼び出し（例：randbuild(1,10)）として扱う
      if (isOp(peek(), "(")) {
        next(); // "(" を読み飛ばす
        const args = [];
        if (!isOp(peek(), ")")) {
          args.push(parseTernary());
          while (isOp(peek(), ",")) { next(); args.push(parseTernary()); }
        }
        expectOp(")");
        return { type: "funcall", name: t.value, args };
      }
      return { type: "var", name: t.value };
    }
    throw new Error("式を解析できませんでした");
  }
  
  return parseTernary();
}

function evalSkillExpressionNode(node, context) {
  switch (node.type) {
    case "num": return node.value;
    case "var": return Object.prototype.hasOwnProperty.call(context, node.name) ? (Number(context[node.name]) || 0) : 0; // ★未知の変数名は0扱い（式エラーで技全体を止めない安全側の挙動）
    case "unary":
      if (node.op === "-") return -evalSkillExpressionNode(node.operand, context);
      return evalSkillExpressionNode(node.operand, context) ? 0 : 1; // "!"
    case "binop": {
      const l = evalSkillExpressionNode(node.left, context);
      const r = evalSkillExpressionNode(node.right, context);
      switch (node.op) {
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "/": return r === 0 ? 0 : l / r;
        case "%": return r === 0 ? 0 : l % r;
        case "<": return l < r ? 1 : 0;
        case ">": return l > r ? 1 : 0;
        case "<=": return l <= r ? 1 : 0;
        case ">=": return l >= r ? 1 : 0;
        case "==": return l === r ? 1 : 0;
        case "!=": return l !== r ? 1 : 0;
      }
      return 0;
    }
    case "and": return (evalSkillExpressionNode(node.left, context) && evalSkillExpressionNode(node.right, context)) ? 1 : 0;
    case "or": return (evalSkillExpressionNode(node.left, context) || evalSkillExpressionNode(node.right, context)) ? 1 : 0;
    case "ternary": return evalSkillExpressionNode(node.cond, context) ? evalSkillExpressionNode(node.whenTrue, context) : evalSkillExpressionNode(node.whenFalse, context);
    // ★要望対応：式の中で使える関数。今のところrandbuild(最小,最大)のみ
    //   （ifブロック・ダメージを与えるブロックなど、式が使える場所ならどこでも使える）
    case "funcall": {
      const args = node.args.map(a => evalSkillExpressionNode(a, context));
      if (node.name === "randbuild") {
        // ★randbuild(最小,最大)：指定した範囲（両端を含む整数）でランダムな値を返す。
        //   最小と最大が逆に入っていても、大小を入れ替えて安全に扱う
        let min = Math.round(args[0] || 0);
        let max = Math.round(args[1] || 0);
        if (min > max) { const tmp = min; min = max; max = tmp; }
        return Math.floor(Math.random() * (max - min + 1)) + min;
      }
      if (node.name === "flag") {
        // ★要望対応：シナリオフラグ（flagブロックで立てた、話ごとに自由な名前のフラグ）を式から参照する。
        //   フラグの名前は話によって無数にあり得るので、変数一覧に個別に列挙するのではなく、
        //   flag("フラグ名") という関数呼び出しの形で、どんな名前のフラグでも参照できるようにする
        const flagName = node.args[0] && node.args[0].type === "var" ? node.args[0].name : null;
        return (typeof scenarioFlags !== "undefined" && flagName && scenarioFlags[flagName]) ? 1 : 0;
      }
      if (node.name === "仲間HP割合" || node.name === "仲間SP割合") {
        // ★要望対応：パーティ内の仲間それぞれのHP・SP割合を式から参照する。
        //   仲間HP割合(1) のように並び順（1人目・2人目…）で指定するか、
        //   仲間HP割合(名前) のように名前（引用符なし）で指定するかのどちらでもよい
        const companion = resolveSkillExprCompanionArg(node.args[0]);
        if (!companion) return 0;
        const gaugeKey = node.name === "仲間HP割合" ? "hp" : "sp";
        const gauge = companion.gauges && companion.gauges[gaugeKey];
        return (gauge && gauge.max) ? gauge.current / gauge.max : 0;
      }
      console.warn("未対応の関数です:", node.name); // ★未知の関数名は式エラーで技全体を止めない安全側の挙動として0を返す
      return 0;
    }
    default: return 0;
  }
}

// ★式（文字列）を実際に計算する入口。空文字や数値そのものが渡ってきた場合にも対応する
function evaluateSkillExpression(expr, context) {
  if (typeof expr === "number") return expr;
  if (!expr || typeof expr !== "string" || expr.trim() === "") return 0;
  try {
    const tokens = tokenizeSkillExpression(expr);
    if (tokens.length === 0) return 0;
    return evalSkillExpressionNode(parseSkillExpressionTokens(tokens), context);
  } catch (e) {
    console.warn("スキル式の評価に失敗しました:", expr, e);
    return 0;
  }
}

// ★要望対応：仲間HP割合(1)／仲間SP割合(名前) のような関数呼び出しの引数から、対象の仲間を1人探す。
//   引数が数値ならパーティ内の並び順（1人目・2人目…）、識別子（名前）ならその名前の仲間を探す。
//   見つからなければnullを返す
function resolveSkillExprCompanionArg(argNode) {
  if (!player || !Array.isArray(player.companions) || !argNode) return null;
  if (argNode.type === "num") {
    const index = Math.round(argNode.value) - 1; // ★1人目＝配列の0番目
    return player.companions[index] || null;
  }
  if (argNode.type === "var") {
    return player.companions.find(c => {
      const master = getCompanionMaster(c); // player.js
      return master && master.name === argNode.name;
    }) || null;
  }
  return null;
}

// ===== 特殊スキル・ブロックシステム（実行ランタイム） =====
// ★式の中で使える変数一式を作る。skill.variables／setVariableブロックで書き換えた分はcontext.variablesに入っている
function buildSkillExprContext(skill, context) {
  const stats = getEffectiveStats(); // player.js
  const hpRatio = (player && player.gauges.hp.max) ? player.gauges.hp.current / player.gauges.hp.max : 0;
  const spRatio = (player && player.gauges.sp.max) ? player.gauges.sp.current / player.gauges.sp.max : 0;
  const ctx = {
    "自分HP割合": hpRatio,
    "自分SP割合": spRatio,
    "自分レベル": player ? player.level : 1,
    "自分攻撃力": stats.atk,
    "自分魔力": stats.skillPower,
    "技威力": skill.power || 0,
    "ターン数": (battleState && battleState.turnCount) || 1,
    // ★要望対応：システム変数（プログラム側が持っている値）も式の中で参照できるようにする
    "眠気": (player && player.gauges && player.gauges.sleepiness) ? player.gauges.sleepiness.current : 0,
    "疲労": (player && player.gauges && player.gauges.fatigue) ? player.gauges.fatigue.current : 0,
    "所持金": (typeof gold === "number") ? gold : 0,
    "経過日数": (player && player.daysSinceTransfer) || 0,
    // ★要望対応：乱数（0以上100未満の実数）。式を評価するたびに新しく引き直される。
    //   例：「乱数 < 30」で30%の確率、のような使い方ができる
    "乱数": Math.random() * 100
  };
  if (context.target && context.target.maxHp) ctx["敵HP割合"] = context.target.hp / context.target.maxHp;
  Object.keys(context.variables || {}).forEach(k => { ctx[k] = context.variables[k]; });
  return ctx;
}

// ★要望対応：setVariableブロックの代入先が「システム変数」（buildSkillExprContextで参照できる、
//   プログラム側が持っている実際の値）の名前だった場合、実際にその値へ書き込む。
//   書き込めた（＝該当する名前だった）場合はtrue、該当しない（＝ただの一時変数）場合はfalseを返す。
//   ★自分攻撃力・自分魔力・技威力・乱数は、装備やレベルから毎回計算し直される値／評価するたびに
//   引き直される値なので、代入できる先が無く対象外（読み取り専用のまま）
function assignSkillSystemVariable(varName, value, context) {
  switch (varName) {
    case "眠気":
      if (player && player.gauges && player.gauges.sleepiness) {
        player.gauges.sleepiness.current = Math.max(0, Math.min(player.gauges.sleepiness.max, value));
        return true;
      }
      return false;
    case "疲労":
      if (player && player.gauges && player.gauges.fatigue) {
        player.gauges.fatigue.current = Math.max(0, Math.min(player.gauges.fatigue.max, value));
        return true;
      }
      return false;
    case "所持金":
      if (typeof gold === "number" && typeof changeGold === "function") {
        changeGold(Math.round(value) - gold); // inventory.js（差分で渡す仕組みなので、目標値との差分を渡す）
        return true;
      }
      return false;
    case "経過日数":
      if (player) { player.daysSinceTransfer = Math.max(0, Math.round(value)); return true; }
      return false;
    case "自分HP割合":
      if (player && player.gauges.hp.max) {
        player.gauges.hp.current = Math.max(0, Math.min(player.gauges.hp.max, Math.round(player.gauges.hp.max * value)));
        return true;
      }
      return false;
    case "自分SP割合":
      if (player && player.gauges.sp.max) {
        player.gauges.sp.current = Math.max(0, Math.min(player.gauges.sp.max, Math.round(player.gauges.sp.max * value)));
        return true;
      }
      return false;
    case "敵HP割合":
      if (context.target && context.target.maxHp) {
        context.target.hp = Math.max(0, Math.min(context.target.maxHp, Math.round(context.target.maxHp * value)));
        return true;
      }
      return false;
    case "ターン数":
      if (typeof battleState !== "undefined" && battleState) { battleState.turnCount = Math.max(1, Math.round(value)); return true; }
      return false;
    default:
      return false;
  }
}

// ★damage/applyStatusブロックの対象解決。"single"は呼び出し前に選んだ固定の相手、"random"はその都度抽選、"all"は生きている敵全員
function resolveSkillBlockEnemyTargets(targetMode, context) {
  if (targetMode === "all") return getAliveEnemies();
  if (targetMode === "random") {
    const pool = getAliveEnemies();
    return pool.length > 0 ? [pool[Math.floor(Math.random() * pool.length)]] : [];
  }
  return (context.target && context.target.hp > 0) ? [context.target] : [];
}

// ★特殊スキル（ブロック編集）のダメージ計算式。以前は威力(skill.power)に単純な倍率をかけるだけで、
//   通常技（calculateSkillDamage）が持っている各種の強化効果（イクサガミの被虐趣向、一か八かの大きな揺らぎ、
//   血闘の刻印の連撃ボーナス等）が一切反映されていなかった。通常技と同じ計算の流れに揃え、
//   同じ強化技がブロック技でも効くようにする
// ★さらに以前は、ここで「(隠れて残っている固定フィールドの威力skill.power) × ブロックの式」という
//   二重掛け算になっており、編集画面には「ブロックモードでは固定フィールドは無視されます」と表示されるのに
//   実際には無視されていなかった。この食い違いのせいで、例えば式の欄に威力のつもりで「45」と入れると、
//   隠れたskill.power（新規作成時は10）と掛け合わされて威力450相当という異常な値になり、
//   レベルが上がるほど（レベル倍率が乗る）どんどん現実離れしたダメージになってしまっていた。
//   ここでは編集画面の説明通り、ブロックの式の評価結果をそのまま威力として使う（skill.powerは一切使わない）
function calculateSkillBlockDamage(skill, block, multiplier, caster) {
  caster = caster || player;
  const isPlayerCaster = caster === player;
  if (isPlayerCaster && battleState) battleState.playerAttackCount = (battleState.playerAttackCount || 0) + 1;
  const variance = Math.floor(Math.random() * 7) - 3;
  // ★要望対応（仲間の特殊技バグ修正）：キャスターが仲間の場合は、主人公用のgetEffectiveStats()ではなく
  //   仲間自身のステータスを参照する。狂戦士専用の「血闘の刻印」「被虐趣向」等の主人公専用演出は仲間には適用しない
  const stats = isPlayerCaster ? getEffectiveStats() : getCompanionEffectiveStats(caster); // player.js
  const baseAtk = block.atkType === "magical" ? stats.skillPower : stats.atk;
  const level = caster ? caster.level : 1;
  const levelMultiplier = 1 + level * 0.05;
  const power = Number.isFinite(multiplier) ? multiplier : 0; // ★式の評価結果＝技の威力そのもの（skill.powerとは掛け合わせない）
  let raw = Math.round(levelMultiplier * power) + Math.round(applyAtkBonusToStat(baseAtk, block.atkType === "magical") * 0.7) + variance;
  // ★狂戦士「血闘の刻印」：ここまでに繰り出した攻撃の回数に応じて威力が増加する（上限あり）※主人公が使った場合のみ
  if (isPlayerCaster && skill.id === "kettou_no_kokuin" && battleState) {
    const bonusRatio = Math.min(0.6, Math.max(0, (battleState.playerAttackCount - 1)) * 0.03);
    raw = Math.round(raw * (1 + bonusRatio));
  }
  // ★「一か八か」等：wideVarianceの技は、通常の±3の揺らぎに加えて最終ダメージを大きくばらつかせる
  if (skill.wideVariance) raw = Math.round(raw * (0.5 + Math.random() * 1.3));
  if (isPlayerCaster && isMagicalGirlTransformed()) raw = Math.round(raw * 1.3);
  // ★イクサガミの被虐趣向：発動中なら「(最大HP-現在HP) + ダメージ×0.7」に組み替え、発動フラグを消費する。
  //   ★レベルが上がるほど無限に伸びてしまわないよう、素の技ダメージ（raw）の2.5倍を上限にする（主人公専用）
  if (isPlayerCaster && battleState && battleState.playerHpBerserkActive) {
    battleState.playerHpBerserkActive = false;
    const missingHp = Math.max(0, player.gauges.hp.max - player.gauges.hp.current);
    raw = Math.min(missingHp + Math.round(raw * 0.7), Math.round(raw * 2.5));
  }
  return applyCriticalHit(Math.max(1, raw));
}

// ★このスキルのブロック列（入れ子のrepeatの中も含む）に、「単体」指定のdamage/applyStatus(enemy)ブロックが
//   1つでもあるかどうか。あれば通常攻撃と同じく先に狙う相手を選ばせる必要がある
function skillBlocksNeedSingleTarget(blocks) {
  return (blocks || []).some(b => {
    if (b.type === "damage" && b.target === "single") return true;
    if (b.type === "applyStatus" && b.targetSide === "enemy" && b.target === "single") return true;
    if (b.type === "repeat" && skillBlocksNeedSingleTarget(b.bodyBlocks)) return true;
    return false;
  });
}

// ブロック1つぶんを実行する。戻り値：次に飛ぶブロックid（nullなら次のブロックへ普通に進む／"END"ならそこで技を打ち切る）
async function runSingleSkillBlock(block, skill, context) {
  if (block.type === "message") {
    if (block.speaker !== undefined) changeSpeaker(block.speaker || "");
    await displayMessage(block.text || "", { allowSubFocus: true });
    return null;
  }
  
  if (block.type === "flag") {
    if (typeof scenarioFlags !== "undefined" && block.flagName) {
      if (block.mode === "off") scenarioFlags[block.flagName] = false;
      else if (block.mode === "toggle") scenarioFlags[block.flagName] = !scenarioFlags[block.flagName];
      else scenarioFlags[block.flagName] = true;
    }
    return null;
  }
  
  if (block.type === "setVariable") {
    if (block.varName) {
      const value = evaluateSkillExpression(block.expression, buildSkillExprContext(skill, context));
      // ★要望対応：システム変数（プログラム側が持っている実際の値）の名前が指定された場合は、
      //   一時的な変数（context.variables。この技の実行が終わると消える）ではなく、
      //   実際のゲームの値そのものへ書き込む（代入）。以降のブロックの式で参照すると、書き込んだ後の値になる。
      //   それ以外の名前は、今まで通り一時的な変数として扱う
      const wroteToSystemVariable = assignSkillSystemVariable(block.varName, value, context);
      if (!wroteToSystemVariable) context.variables[block.varName] = value;
    }
    return null;
  }
  
  if (block.type === "checkTurnCount") {
    if (block.varName) {
      if (block.source === "measured") {
        const name = block.measureName || "";
        const entry = battleState.skillTurnMeasurements && battleState.skillTurnMeasurements[name];
        if (entry) context.variables[block.varName] = (typeof entry.startTurn === "number") ? ((battleState.turnCount || 1) - entry.startTurn) : (entry.lastElapsed || 0);
        else context.variables[block.varName] = 0; // ★まだ計測を開始していない場合は0
      } else {
        context.variables[block.varName] = (battleState && battleState.turnCount) || 1;
      }
    }
    return null;
  }
  
  if (block.type === "turnMeasureStart") {
    if (!battleState.skillTurnMeasurements) battleState.skillTurnMeasurements = {};
    battleState.skillTurnMeasurements[block.measureName || ""] = { startTurn: battleState.turnCount || 1, lastElapsed: 0 };
    return null;
  }
  
  if (block.type === "turnMeasureEnd") {
    if (battleState.skillTurnMeasurements) {
      const entry = battleState.skillTurnMeasurements[block.measureName || ""];
      if (entry && typeof entry.startTurn === "number") {
        entry.lastElapsed = (battleState.turnCount || 1) - entry.startTurn;
        delete entry.startTurn; // ★停止：以後はlastElapsedで固定値を返す
      }
    }
    return null;
  }
  
  if (block.type === "choice") {
    const validOptions = (block.options || []).filter(o => o.text);
    if (validOptions.length === 0) return null;
    if (block.prompt) {
      changeSpeaker("");
      await displayMessage(block.prompt, { allowSubFocus: true });
    }
    const picked = await displayChoices(validOptions.map((o, i) => ({ text: o.text, index: i })), 0, { allowSubFocus: true }); // mainfunc.js
    if (block.varName) context.variables[block.varName] = picked.index;
    return null;
  }
  
  if (block.type === "if") {
    const result = evaluateSkillExpression(block.expression, buildSkillExprContext(skill, context));
    // ★要望対応：話のifブロックと同じく、真/偽それぞれの中身を直接ブロックとして書けるようにした
    const branchBlocks = result ? block.trueBlocks : block.falseBlocks;
    if (Array.isArray(branchBlocks) && branchBlocks.length > 0) {
      const nested = await runSkillBlockList(branchBlocks, skill, context);
      if (nested === "END") return "END";
      return null;
    }
    // ★後方互換：中身が無い（旧データ）の間だけ、従来のジャンプ先方式を使う
    return result ? (block.trueJumpBlockId || null) : (block.falseJumpBlockId || null);
  }
  
  if (block.type === "damage") {
    const multiplier = evaluateSkillExpression(block.powerMultiplier, buildSkillExprContext(skill, context));
    for (const enemyTarget of resolveSkillBlockEnemyTargets(block.target, context)) {
      if (enemyTarget.hp <= 0) continue;
      const damage = calculateSkillBlockDamage(skill, block, multiplier, context.caster);
      const result = resolveDamageForTarget(enemyTarget, damage);
      enemyTarget.hp = Math.max(0, enemyTarget.hp - result.damage);
      if (result.blocked) await displayMessage(`${enemyTarget.displayName}には効いていないようだッ！`, { allowSubFocus: true });
      else if (lastHitWasCritical) await displayMessage(`会心の一撃！ ${enemyTarget.displayName}に${result.damage}のダメージ！`, { allowSubFocus: true });
      else await displayMessage(`${enemyTarget.displayName}に${result.damage}のダメージ！`, { allowSubFocus: true });
    }
    return null;
  }
  
  if (block.type === "heal") {
    const rawAmount = evaluateSkillExpression(block.amount, buildSkillExprContext(skill, context));
    // ★要望対応：疲労度・眠気の回復（主人公だけが持つゲージなので、対象指定に関わらず主人公にだけ適用する）
    if (block.gauge === "fatigue" || block.gauge === "sleepiness") {
      const gaugeMax = player.gauges[block.gauge].max;
      const amount = Math.max(0, Math.round(block.amountIsPercent ? gaugeMax * (rawAmount / 100) : rawAmount)); // ★割合(%)指定なら、疲労度・眠気それぞれの最大値から計算する
      if (amount > 0 && typeof changeGauge === "function") {
        const before = player.gauges[block.gauge].current;
        changeGauge(block.gauge, -amount); // player.js
        const reduced = before - player.gauges[block.gauge].current;
        if (reduced > 0) await displayMessage(`自分の${block.gauge === "fatigue" ? "疲労度" : "眠気"}が${reduced}下がった！`, { allowSubFocus: true });
      }
      return null;
    }
    const gauge = block.gauge === "sp" ? "sp" : "hp";
    const units = block.target === "all" ? [player, ...(player.companions || []).filter(c => c.alive)] : [context.caster || player];
    for (const unit of units) {
      // ★割合(%)指定の時は、対象1人1人の最大値から個別に計算する（仲間ごとに最大HPが違うため）
      const amount = Math.max(0, Math.round(block.amountIsPercent ? unit.gauges[gauge].max * (rawAmount / 100) : rawAmount));
      const healed = applyHealToUnit(unit, gauge, amount, false, false); // player.js
      if (healed > 0) {
        const who = unit === player ? "自分" : (getHealTargetDisplayName ? getHealTargetDisplayName(unit) : "仲間"); // player.js
        await displayMessage(`${who}の${gauge === "sp" ? "SP" : "HP"}が${healed}回復した！`, { allowSubFocus: true });
      }
    }
    return null;
  }
  
  if (block.type === "adjustGauge") {
    const delta = Math.round(evaluateSkillExpression(block.amount, buildSkillExprContext(skill, context)));
    const gauge = block.gauge === "sp" ? "sp" : "hp";
    const units = block.target === "all" ? [player, ...(player.companions || []).filter(c => c.alive)] : [context.caster || player];
    for (const unit of units) {
      const changed = applyGaugeDeltaToUnit(unit, gauge, delta); // player.js（回復と違いマイナスも扱える）
      if (changed !== 0) {
        const who = unit === player ? "自分" : (getHealTargetDisplayName ? getHealTargetDisplayName(unit) : "仲間"); // player.js
        const verb = changed > 0 ? "回復した" : "減った";
        await displayMessage(`${who}の${gauge === "sp" ? "SP" : "HP"}が${Math.abs(changed)}${verb}！`, { allowSubFocus: true });
      }
    }
    return null;
  }
  
  if (block.type === "selfDamage") {
    const amount = Math.max(0, Math.round(evaluateSkillExpression(block.amount, buildSkillExprContext(skill, context))));
    if (amount > 0) {
      const caster = context.caster || player;
      if (caster === player) {
        changeGauge("hp", -amount); // player.js
      } else {
        applyGaugeDeltaToUnit(caster, "hp", -amount); // player.js（仲間が代償ダメージを受ける場合）
      }
      if (typeof triggerCameraShake === "function") triggerCameraShake(); // mainfunc.js
      const who = caster === player ? "自分" : getCompanionDisplayName(caster);
      await displayMessage(`代償として、${who}のHPが${amount}減った……`, { allowSubFocus: true });
    }
    return null;
  }
  
  if (block.type === "applyStatus") {
    const duration = Math.max(1, Math.round(evaluateSkillExpression(block.duration, buildSkillExprContext(skill, context))));
    const power = Math.round(evaluateSkillExpression(block.power, buildSkillExprContext(skill, context)));
    const chance = evaluateSkillExpression(block.chance, buildSkillExprContext(skill, context));
    if (block.targetSide === "self" || block.targetSide === "allies") {
      const caster = context.caster || player;
      if (block.targetSide === "self" && caster !== player) {
        // ★要望対応（仲間の特殊技バグ修正）：キャスターが仲間の場合、「自分に」は主人公ではなくその仲間自身に適用する
        const companionApplied = applyCompanionSelfBuff(caster, { kind: block.statusId, duration, power, mode: "add" });
        if (companionApplied) await displayMessage(`${getCompanionDisplayName(caster)}は${companionApplied}状態になった！`, { allowSubFocus: true });
      } else {
        // ★要望対応：「自分に」の場合だけ、状態強化(statusBuffs)に加えて実際の状態異常(statusAilments)も選べる。
        //   statusIdがどちらの定義に該当するかで、適用先の仕組みを振り分ける
        const ailmentDef = block.targetSide === "self" ? resolveStatusAilmentDef(block.statusId) : null;
        const applied = ailmentDef
          ? applySelfStatusAilmentFromSkill({ kind: block.statusId, duration, power })
          : applySelfBuffFromSkill({ kind: block.statusId, duration, power, mode: "add" });
        if (applied) await displayMessage(`自分は${applied}状態になった！`, { allowSubFocus: true });
      }
      if (block.targetSide === "allies" && player && Array.isArray(player.companions)) {
        // ★味方全体：player.companionsには現在パーティーにいる（控えではない）仲間だけが入っている
        for (const c of player.companions) {
          if (!c.gauges || c.gauges.hp.current <= 0) continue; // ★戦闘不能の仲間には掛けない
          const companionApplied = applyCompanionSelfBuff(c, { kind: block.statusId, duration, power, mode: "add" });
          if (companionApplied) await displayMessage(`${getCompanionDisplayName(c)}は${companionApplied}状態になった！`, { allowSubFocus: true }); // ★バグ修正：c.nameは存在しないプロパティで常にundefinedになっていた
        }
      }
    } else {
      for (const enemyTarget of resolveSkillBlockEnemyTargets(block.target || "single", context)) {
        if (enemyTarget.hp <= 0) continue;
        const applied = applyEnemyStatusEffectFromSkill(enemyTarget, { kind: block.statusId, duration, power, chance });
        if (applied) await displayMessage(`${enemyTarget.displayName}は${applied}状態になった！`, { allowSubFocus: true });
      }
    }
    return null;
  }
  
  if (block.type === "repeat") {
    const count = Math.max(0, Math.round(evaluateSkillExpression(block.countExpression, buildSkillExprContext(skill, context))));
    for (let i = 0; i < count; i++) {
      const outcome = await runSkillBlockList(block.bodyBlocks || [], skill, context);
      if (outcome === "END") return "END"; // ★くり返しの中で「end」ブロックに達したら、技全体をそこで打ち切る
    }
    return null;
  }
  
  if (block.type === "end") return "END";
  
  return null;
}

// ブロック列を、指定された1つの配列の中で上から順に実行する（ジャンプ・条件分岐も含む）
async function runSkillBlockList(blocks, skill, context) {
  let index = 0;
  let guard = 0;
  while (index >= 0 && index < blocks.length) {
    if (++guard > 500) break; // ★万一ジャンプがループし続けても、強制的に打ち切る安全弁
    const block = blocks[index];
    const jumpId = await runSingleSkillBlock(block, skill, context);
    if (jumpId === "END") return "END";
    if (jumpId) {
      const jumpIndex = blocks.findIndex(b => b.id === jumpId);
      index = jumpIndex >= 0 ? jumpIndex : index + 1;
    } else {
      index++;
    }
  }
  return null;
}

// ★スキル管理タブの「特殊スキル編集」でブロックを1つでも登録した技は、固定フィールドの代わりにこちらで動く。
//   仲間の技は今回は対象外（引き続き従来の固定フィールド方式のまま）
async function runSkillBlocksForPlayerTurn(skill) {
  changeSpeaker("");
  await displayMessage(`「${skill.name}」を使った！`, { allowSubFocus: true });
  
  const needsTarget = skillBlocksNeedSingleTarget(skill.blocks);
  let target = null;
  if (needsTarget) {
    target = await selectEnemyTarget();
    if (!target) {
      changeGauge("sp", skill.spCost); // ★対象選択をキャンセルしたのでSPを返す
      renderStatusHUD();
      return false;
    }
  }
  
  const context = { variables: { ...(skill.variables || {}) }, target, caster: player };
  await runSkillBlockList(skill.blocks, skill, context);
  
  renderStatusHUD();
  updateBattleHud();
  return true;
}

// ★要望対応（バグ修正）：仲間がブロック編集済みの特殊技を使った時、以前は完全に対象外で
//   固定フィールド方式にすら乗らず何も起きなかった（例：狂戦士の技をブロックで組んでもケツァナが使えない）。
//   基本の流れはrunSkillBlocksForPlayerTurnと同じだが、context.casterに主人公ではなくその仲間自身を入れて、
//   ダメージ計算・自己バフ・自己ダメージ等が「使った本人（仲間）」を基準に働くようにする
async function runSkillBlocksForCompanionTurn(companion, skill) {
  const name = getCompanionDisplayName(companion);
  changeSpeaker(name);
  await displayMessage(`${name}の「${skill.name}」！`, { allowSubFocus: true });
  
  const needsTarget = skillBlocksNeedSingleTarget(skill.blocks);
  let target = null;
  if (needsTarget) {
    target = await selectEnemyTarget();
    if (!target) return false; // ★対象選択をキャンセルした場合はSPを消費せずターンだけ終える（呼び出し元でSP消費前に判定してもらう想定）
  }
  
  const context = { variables: { ...(skill.variables || {}) }, target, caster: companion };
  await runSkillBlockList(skill.blocks, skill, context);
  return true;
}

// ★習得済みのスキル（攻撃・回復・自己強化技に加え、魔法少女の「マジカル変身」だけは特殊技だが戦闘中に使うので一覧に含める）を表示し、実際に効果を発動する
async function handleSkillMenu() {
  const skills = (typeof getUnlockedSkills === "function" ? getUnlockedSkills() : [])
    .filter(s => s.type === "attack" || s.type === "heal" || s.type === "buff" || (s.type === "special" && s.id === "magical_transform"));
  
  if (skills.length === 0) {
    changeSpeaker("");
    await displayMessage("今は使えるスキルが無いようだ……");
    return false;
  }
  
  const skillChoices = skills.map(s => ({ text: `${s.name}（SP${s.spCost}）`, next: s.name, description: s.description }));
  skillChoices.push({ text: "戻る", next: "back", isBack: true });
  
  const picked = await displayChoices(skillChoices);
  if (picked.next === "back") return false;
  
  const skill = skills.find(s => s.name === picked.next);
  
  // ★魔法少女の「マジカル変身」：変身の実行だけは通常のスキル発動フローに乗せず、ここで専用処理する
  if (skill.type === "special" && skill.id === "magical_transform") {
    return await useMagicalTransformSkill(skill);
  }
  
  // ★魔法少女は「マジカル変身」中でないと、攻撃・回復の魔法技を使えない（通常攻撃は変身前でも可）
  if (player.class === "魔法少女" && !isMagicalGirlTransformed()) {
    changeSpeaker("");
    await displayMessage(`「${skill.name}」は魔法少女に変身しないと使えないようだ。まずは「ケアリー☆キューティー♡マジカル変身」を使おう。`);
    return false;
  }
  
  if (player.gauges.sp.current < skill.spCost) {
    changeSpeaker("");
    await displayMessage("SPが足りない！");
    return false;
  }
  
  // ★眠気が7割を超えていると、たまに動けずターンを無駄にしてしまう（SPは消費しない）
  if (checkFallAsleep()) { // player.js
    changeSpeaker("");
    await displayMessage("しかし居眠りしてしまって動けなかった！");
    return true; // ★行動自体は失敗しても、ターンは消費する
  }
  
  changeGauge("sp", -skill.spCost);
  checkZetsurinAutoRecover(); // ★性騎士の「絶倫」：SPが2割を切ったら自動回復（1戦闘3回まで）
  checkMagicalGirlForcedDetransform(); // ★SPが3割を切ったら変身が強制解除される
  changeSpeaker("");
  
  // ★スキル管理タブの「特殊スキル編集」でブロックを1つでも登録した技は、固定フィールド（power等）は無視して
  //   ここでブロック実行モードに切り替える（selfDamageRatio・randomEffect・type別分岐は一切見なくなる）
  if (skill.blocks && skill.blocks.length > 0) {
    return await runSkillBlocksForPlayerTurn(skill);
  }
  
  // ★HPを消費する代わりに威力が上がるタイプの技（selfDamageRatio）
  if (skill.selfDamageRatio) {
    const selfDamage = Math.max(1, Math.round(player.gauges.hp.max * skill.selfDamageRatio));
    changeGauge("hp", -selfDamage);
    if (typeof triggerCameraShake === "function") triggerCameraShake(); // mainfunc.js
    await displayMessage(`「${skill.name}」の代償として、自身のHPが${selfDamage}減った……`);
    if (player.gauges.hp.current <= 0) { renderStatusHUD(); updateBattleHud(); return true; } // ★力尽きた場合はここで終了（呼び出し元のbattleLoopが検知する）
  }
  
  // ★課金召喚専用：回復・攻撃・状態異常のいずれかがランダムに1つだけ発動する（skill.randomEffect）
  if (skill.randomEffect) {
    const roll = Math.random();
    if (roll < 1 / 3) {
      const healed = applyHealToUnit(player, "hp", getSkillPower(skill), false, false); // player.js
      await displayMessage(`「${skill.name}」……回復の力が出た！ HPが${healed}回復した！`);
    } else if (roll < 2 / 3) {
      const aliveEnemies = getAliveEnemies();
      const target = aliveEnemies[Math.floor(Math.random() * aliveEnemies.length)];
      if (target) {
        const damage = calculateSkillDamage(skill);
        const result = resolveDamageForTarget(target, damage);
        target.hp = Math.max(0, target.hp - result.damage);
        await displayMessage(`「${skill.name}」……攻撃の力が出た！ ${target.displayName}に${result.damage}のダメージ！`);
      } else {
        await displayMessage(`「${skill.name}」……しかし、敵はもういないようだ。`);
      }
    } else {
      const aliveEnemies = getAliveEnemies();
      const target = aliveEnemies[Math.floor(Math.random() * aliveEnemies.length)];
      const kinds = ["stun", "poison", "dullPain", "atkDown", "defDown", "accDown", "confuse"];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      if (target) {
        const applied = applyEnemyStatusEffectFromSkill(target, { kind, chance: 1, duration: 3, power: 4 });
        await displayMessage(`「${skill.name}」……状態異常の力が出た！ ${target.displayName}は${applied || STATUS_EFFECT_LABELS[kind] || kind}状態になった！`);
      } else {
        await displayMessage(`「${skill.name}」……しかし、敵はもういないようだ。`);
      }
    }
    renderStatusHUD();
    updateBattleHud();
    return true;
  }
  
  if (skill.type === "attack") {
    // ★全能士「阿吽の一閃」：攻撃回数を固定値ではなく「自分を含めた生きている仲間の数」にする
    let hitCount = skill.hitCount || 1;
    if (skill.id === "aun_no_issen") {
      const aliveCompanions = (player.companions || []).filter(c => c.alive).length;
      hitCount = 1 + aliveCompanions;
    }
    // ★戦士「修羅への渇望」：HPが瀕死に近いほど攻撃回数が増える（技表準拠）。
    //   HP満タンなら基本の2回、HPが減るほど最大5回まで増える
    if (skill.id === "shura_e_no_katsubou") {
      const missingRatio = 1 - (player.gauges.hp.current / player.gauges.hp.max);
      hitCount = 2 + Math.floor(missingRatio * 4); // ★HP0%に近いほど+3〜+4され、最大5〜6回
      hitCount = Math.min(6, hitCount);
    }
    // ★skill.target === "all" の全体攻撃スキルは、ターゲット選択をせず生きている敵全員に当てる
    if (skill.target === "all") {
      await displayMessage(`「${skill.name}」を放った！`);
      for (const enemy of getAliveEnemies()) {
        for (let hit = 0; hit < hitCount; hit++) {
          if (enemy.hp <= 0) break;
          const damage = calculateSkillDamage(skill, hitCount); // ★命中回数分だけ攻撃力の効果を均等に割る（バランス調整）
          const result = resolveDamageForTarget(enemy, damage);
          enemy.hp = Math.max(0, enemy.hp - result.damage);
          if (result.blocked) {
            await displayMessage(`${enemy.displayName}には効いていないようだッ！`);
          } else {
            await displayMessage(`${enemy.displayName}に${result.damage}のダメージ！`);
          }
        }
        if (enemy.hp > 0 && skill.statusEffect) {
          const applied = applyEnemyStatusEffectFromSkill(enemy, skill.statusEffect);
          if (applied) await displayMessage(`${enemy.displayName}は${applied}状態になった！`);
          if (skill.statusEffect2) {
            const applied2 = applyEnemyStatusEffectFromSkill(enemy, skill.statusEffect2);
            if (applied2) await displayMessage(`${enemy.displayName}は${applied2}状態になった！`);
          }
        }
      }
    } else {
      // ★「一か八か」等：randomTargetの技は、狙う相手を自分で選ばせず、生きている敵の中からランダムに選ぶ。
      //   命中回数が2以上ある場合は、1回ごとに毎回改めて抽選し直す（技表の「攻撃回数分それぞれランダムな敵に」準拠）
      let target = null;
      if (!skill.randomTarget) {
        target = await selectEnemyTarget();
        if (!target) {
          changeGauge("sp", skill.spCost); // ★狙う相手を選ぶ前にキャンセルしたので、消費したSPを返す
          renderStatusHUD();
          return false; // ★ターンを消費せず選び直せる
        }
      }
      for (let hit = 0; hit < hitCount; hit++) {
          if (skill.randomTarget) {
            const candidates = getAliveEnemies();
            if (candidates.length === 0) break; // ★全滅していたらそこで打ち止め
            target = candidates[Math.floor(Math.random() * candidates.length)];
          } else if (target.hp <= 0) break;
          const damage = calculateSkillDamage(skill, hitCount); // ★命中回数分だけ攻撃力の効果を均等に割る（バランス調整）
          const result = resolveDamageForTarget(target, damage);
          target.hp = Math.max(0, target.hp - result.damage);
          // ★命中回数が2以上の技は、技名を言うのは最初の1回のみにして、以降はダメージ量だけ表示する
          const prefix = hit === 0 ? `「${skill.name}」を放った！ ` : "";
          if (result.blocked) {
            await displayMessage(`${prefix}しかし、効いていないようだッ！`);
          } else if (lastHitWasCritical) {
            await displayMessage(`${prefix}会心の一撃！ ${target.displayName}に${result.damage}のダメージ！`);
          } else {
            await displayMessage(`${prefix}${target.displayName}に${result.damage}のダメージ！`);
          }
        }
        if (target && target.hp > 0 && skill.statusEffect) {
          const applied = applyEnemyStatusEffectFromSkill(target, skill.statusEffect);
          if (applied) await displayMessage(`${target.displayName}は${applied}状態になった！`);
          if (skill.statusEffect2) {
            const applied2 = applyEnemyStatusEffectFromSkill(target, skill.statusEffect2);
            if (applied2) await displayMessage(`${target.displayName}は${applied2}状態になった！`);
          }
        }
        // ★狂戦士「賊害の連鎖」発動中は、単体攻撃技がもう一体の敵にも連鎖する
        if (target) await maybeApplyChainAttack(target, () => calculateSkillDamage(skill));
    }
    // ★攻撃技でも「代償として自分の防御力が下がる」等、自己バフ/デバフを同時に持つものがある
    if (skill.selfBuff) {
      const appliedSelf = applySelfBuffFromSkill(skill.selfBuff);
      if (appliedSelf) {
        const label = (skill.selfBuff.kind === "defUp" && skill.selfBuff.power < 0) ? "防御力低下" : appliedSelf;
        await displayMessage(`自分は${label}状態になった！`);
      }
    }
  } else if (skill.type === "buff") {
    // ★「豹変」等：triggerChanceが設定されている技は、指定した確率でしか自己バフが発動しない（外れることがある「賭け」の技）
    if (skill.triggerChance != null && Math.random() >= skill.triggerChance) {
      await displayMessage(`「${skill.name}」を使った！ しかし、うまく発動しなかった……`);
    } else {
      const applied = applySelfBuffFromSkill(skill.selfBuff);
      await displayMessage(`「${skill.name}」を使った！` + (applied ? ` ${applied}状態になった！` : ""));
    }
  } else {
    const resultMessage = await performSkillHealWithTargetSelection(skill); // mainfunc.js（対象選択→回復適用）
    if (resultMessage === null) {
      changeGauge("sp", skill.spCost); // ★対象選択で「やめる」を選んだので、消費したSPを返す
      renderStatusHUD();
      return false; // ★ターンを消費せず選び直せる
    }
    await displayMessage(`「${skill.name}」を使った！ ${resultMessage}`);
  }
  
  renderStatusHUD();
  updateBattleHud();
  return true;
}

// スキルの攻撃ダメージを計算する。
// ★ダメージ = レベル倍率 × 威力(skill.power) + 攻撃力(または魔力)×0.7
//   レベル倍率は「1 + レベル×0.05」（例：Lv10→1.5倍、Lv20→2.0倍）。
//   ★以前はレベル×0.1だったが、レベルが上がるほど技の威力だけが加速度的に伸びすぎるため0.05に変更した
// ★バグ修正（バランス調整）：複数回命中(hitCount)の技は、以前は「攻撃力×0.7」の項もヒットのたびに
//   まるごと発生していたため、命中回数を増やすだけで威力(power)の差以上に極端に強くなってしまっていた
//   （例：威力1・命中5回の技が、威力5・命中1回の技よりずっと強くなる）。
//   攻撃力由来のダメージは技の合計として1回分ぶんだけ発生するように、命中回数で割ってから1回ごとに加える。
//   威力(power)の項は今まで通り1回ごとにそのまま加算されるので、命中回数の差を出したい場合は
//   威力(power)側で調整する（既存の大半の複数回命中技は元々そのように調整済み）
// ★魔法少女は「マジカル変身」中、魔法の威力が大きく上昇する（技表準拠）
// ★イクサガミの被虐趣向が発動中なら、攻撃技は「(最大HP-現在HP) + 技のダメージ(計算後)×0.7」になる。
//   攻撃したので効果は解除する
function calculateSkillDamage(skill, hitCountForBalance = 1) {
  if (battleState) battleState.playerAttackCount = (battleState.playerAttackCount || 0) + 1; // ★血闘の刻印用のカウント
  const variance = Math.floor(Math.random() * 7) - 3; // -3〜+3の揺らぎ
  const stats = getEffectiveStats();
  const baseAtk = skill.atkType === "magical" ? stats.skillPower : stats.atk;
  const level = (typeof player !== "undefined" && player) ? player.level : 1;
  const levelMultiplier = 1 + level * 0.05;
  const atkPerHit = Math.round(applyAtkBonusToStat(baseAtk, skill.atkType === "magical") * 0.7) / Math.max(1, hitCountForBalance);
  let raw = Math.round(levelMultiplier * (skill.power || 0)) + Math.round(atkPerHit) + variance;
  // ★狂戦士「血闘の刻印」：ここまでに繰り出した攻撃の回数に応じて威力が増加する（上限あり）。
  //   1回につき+3%、最大+60%（20回分）まで
  if (skill.id === "kettou_no_kokuin" && battleState) {
    const bonusRatio = Math.min(0.6, Math.max(0, (battleState.playerAttackCount - 1)) * 0.03);
    raw = Math.round(raw * (1 + bonusRatio));
  }
  // ★「一か八か」等：wideVarianceの技は、通常の±3の揺らぎに加えて、最終ダメージを0.5倍〜1.8倍の
  //   範囲で大きくばらつかせる（「当たり外れの大きい一撃」）
  if (skill.wideVariance) raw = Math.round(raw * (0.5 + Math.random() * 1.3));
  if (isMagicalGirlTransformed()) raw = Math.round(raw * 1.3); // ★変身中は魔法の威力が大きく上昇する
  if (battleState && battleState.playerHpBerserkActive) {
    battleState.playerHpBerserkActive = false;
    const missingHp = Math.max(0, player.gauges.hp.max - player.gauges.hp.current);
    // ★レベルが上がるほど無限に伸びてしまわないよう、素の技ダメージ（raw）の2.5倍を上限にする
    raw = Math.min(missingHp + Math.round(raw * 0.7), Math.round(raw * 2.5));
  }
  return applyCriticalHit(Math.max(1, raw));
}

// ★技一覧（player.js CLASS_SKILLS）のstatusEffectを、命中した敵に確率判定つきで適用する
// ★状態異常/状態強化タブで追加したカスタムの種類は、見た目の名前・数値は自由だが、
//   実際の動作（mechanic）は決まった仕組みの中から選ぶ。ここでkindからmechanicとデフォルト値を引く
function resolveStatusAilmentDef(kind) {
  const list = (typeof scenarioProject !== "undefined" && scenarioProject.statusAilments) || [];
  return list.find(d => d.id === kind) || null;
}
function resolveStatusBuffDef(kind) {
  const list = (typeof scenarioProject !== "undefined" && scenarioProject.statusBuffs) || [];
  return list.find(d => d.id === kind) || null;
}

function applyEnemyStatusEffectFromSkill(target, effect) {
  if (!effect || !target || !target.status) return null;
  const def = resolveStatusAilmentDef(effect.kind);
  const mechanic = def ? def.mechanic : effect.kind; // ★カスタムの種類は、登録された仕組み（mechanic）で動く
  
  // ★要望対応：敵（通常の魔物・ボスの両方）に設定した「状態異常耐性」「状態異常無効」を反映する。
  //   無効：その種類の状態異常が一切効かない（判定すら行わない）
  //   耐性：その種類の状態異常が効く確率を、設定した割合ぶんだけ下げる（例：0.5なら、命中率をそのまま半分にする）
  const master = MONSTER_MASTER[target.monsterKey];
  if (master && Array.isArray(master.statusImmunities) && master.statusImmunities.includes(mechanic)) return null;
  let chance = effect.chance != null ? effect.chance : 1;
  if (master && master.statusResistances && typeof master.statusResistances[mechanic] === "number") {
    chance *= Math.max(0, 1 - master.statusResistances[mechanic]);
  }
  if (Math.random() >= chance) return null;
  
  const duration = effect.duration || (def && def.defaultDuration) || 1;
  const power = effect.power || (def && def.defaultPower) || 0;
  if (mechanic === "stun") target.status.stun = Math.max(target.status.stun, duration);
  else if (mechanic === "paralyze") target.status.paralyze = Math.max(target.status.paralyze, duration);
  else if (mechanic === "confuse") target.status.confuse = Math.max(target.status.confuse, duration);
  else if (mechanic === "burn") target.status.burn = { turns: duration, power: power || 3 };
  else if (mechanic === "poison") target.status.poison = { turns: duration, power: power || 3 };
  else if (mechanic === "dullPain") target.status.dullPain = { turns: duration, power: power || 3 };
  else if (mechanic === "atkDown") target.status.atkDown = { turns: duration, power: power || 3 };
  else if (mechanic === "defDown") target.status.defDown = { turns: duration, power: power || 3 };
  else if (mechanic === "accDown") target.status.accDown = { turns: duration, power: power || 15 };
  else return null;
  return (def && def.label) || STATUS_EFFECT_LABELS[effect.kind] || effect.kind;
}

const STATUS_EFFECT_LABELS = {
  stun: "スタン", paralyze: "麻痺", confuse: "混乱", burn: "火傷",
  poison: "毒", dullPain: "鈍痛", atkDown: "攻撃力低下", defDown: "防御力低下", accDown: "命中率低下",
  atkUp: "攻撃力上昇", defUp: "防御力変化", critUp: "会心率上昇", immune: "無敵",
  statusImmune: "状態異常無効", hpBerserk: "被虐の力", surviveLethal: "不屈", delayedPower: "やる気なし",
  chainAttack: "連鎖攻撃", regen: "継続回復", magicUp: "魔力上昇", fatigueImmune: "疲労・眠気の影響を受けない",
  hate: "ヘイト上昇" // ★要望対応：ヘイトを買う状態異常。効果中は敵の攻撃が優先的にこちらへ向く
};

// ★ニートの「後でやろう」：カウントが0になった瞬間、自動的に「本気状態」（強力な攻撃力上昇）を発動させる。
//   battleLoopの、プレイヤーのターンが始まる先頭で毎回呼ぶ
function checkYaruKiNashiActivation() {
  if (!battleState || !(battleState.yaruKiNashiTurns > 0)) return null;
  battleState.yaruKiNashiTurns--;
  if (battleState.yaruKiNashiTurns > 0) return null;
  battleState.playerAtkBonusTurns = 5;
  battleState.playerAtkBonus = 30;
  battleState.playerAtkBonusMode = "add";
  return "「後でやろう」の効果が発動！ ついに本気を出し、攻撃力が大幅に上昇した！";
}

// ★技一覧の自己バフ（selfBuff）を、プレイヤー側の戦闘中だけの状態に適用する
// ★要望対応：自分に対しては「状態強化」だけでなく、実際の状態異常（毒・麻痺等）も付与できるようにする
function applySelfStatusAilmentFromSkill(effect) {
  if (!effect || typeof applyPlayerStatusAilment !== "function") return null;
  const def = resolveStatusAilmentDef(effect.kind);
  const mechanic = def ? def.mechanic : effect.kind;
  const duration = effect.duration || (def && def.defaultDuration) || 1;
  const power = effect.power || (def && def.defaultPower) || 0;
  applyPlayerStatusAilment(mechanic, duration, power); // player.js
  return (def && def.label) || STATUS_EFFECT_LABELS[effect.kind] || effect.kind;
}

function applySelfBuffFromSkill(effect) {
  if (!effect || !battleState) return null;
  const def = resolveStatusBuffDef(effect.kind);
  const mechanic = def ? def.mechanic : effect.kind;
  const duration = effect.duration || (def && def.defaultDuration) || 3;
  const power = effect.power != null && effect.power !== 0 ? effect.power : ((def && def.defaultPower) || 0);
  if (mechanic === "atkUp") { battleState.playerAtkBonusTurns = duration; battleState.playerAtkBonus = power || 5; battleState.playerAtkBonusMode = effect.mode === "multiply" ? "multiply" : "add"; }
  else if (mechanic === "magicUp") { battleState.playerMagicBonusTurns = duration; battleState.playerMagicBonus = power || 5; battleState.playerMagicBonusMode = effect.mode === "multiply" ? "multiply" : "add"; }
  else if (mechanic === "fatigueImmune") { battleState.playerFatigueImmuneTurns = duration; }
  else if (mechanic === "critUp") { battleState.playerCritBonusTurns = duration; battleState.playerCritBonus = power || 20; }
  else if (mechanic === "defUp") { battleState.playerDamageReductionTurns = duration; battleState.playerDamageReductionRatio = 1 - ((power || 30) / 100); }
  else if (mechanic === "immune") { battleState.playerImmuneTurns = duration; }
  // ★ハイ・ディスシプリナ「大いなる光芒状態」：immune（完全無敵）とは別物。
  //   ダメージそのものは防がず、状態異常が「付与されなくなる」だけの効果
  else if (mechanic === "statusImmune") { battleState.playerStatusImmuneTurns = duration; }
  // ★狂戦士「賊害の連鎖」：発動中、単体攻撃技・通常攻撃がもう一体の敵にも連鎖する
  else if (mechanic === "chainAttack") { battleState.playerChainAttackTurns = duration; }
  // ★ハイ・ディスシプリナ「大いなる光芒状態」：ラウンド終了ごとに少しHPが回復する（power未指定時は最大HPの8%）
  else if (mechanic === "regen") {
    battleState.playerRegenTurns = duration;
    battleState.playerRegenAmount = power || Math.round(player.gauges.hp.max * 0.08);
    // ★要望対応：ここで実際に付与した状態の名前を覚えておく。tickAllBattleStatesEnd（ラウンド終了処理）が、
    //   これを使って「〇〇の効果でHPが回復した」と正しい名前で表示できるようにする
    battleState.playerRegenLabel = (def && def.label) || STATUS_EFFECT_LABELS[effect.kind] || effect.kind;
  }
  // ★回復力上昇：攻撃力上昇(atkUp)とは別枠で、回復技の効果量にだけ上乗せする（getSkillPower参照）
  else if (mechanic === "healUp") { battleState.playerHealBonusTurns = duration; battleState.playerHealBonus = power || 10; }
  // ★「不屈の闘志」「九死一生」等：無敵(immune)とは違い、致命傷になる一撃だけをHP1で耐え抜く（それ以外の一撃は普通に食らう）
  else if (mechanic === "surviveLethal") { battleState.playerSurviveLethalTurns = duration; }
  // ★ニートの「後でやろう」：すぐには効果が出ず、指定ターン数が経過してから自動的に「本気状態」が発動する（checkYaruKiNashiActivation参照）
  else if (mechanic === "delayedPower") { battleState.yaruKiNashiTurns = duration || 2; }
  // ★イクサガミの被虐趣向：次の1回の攻撃（通常攻撃 or 攻撃技）だけ、残りHP(最大HP-現在HP)を力に変える。
  //   攻撃を行った瞬間に解除されるので、ターン数ではなく単純なフラグで管理する（calculatePlayerDamage/calculateSkillDamage参照）
  else if (mechanic === "hpBerserk") { battleState.playerHpBerserkActive = true; }
  // ★ニート「惰眠からの覚醒」「豹変」：atkUpとは違い、攻撃力・会心率・被ダメージ軽減をまとめて上げる「全ステータス上昇」
  else if (mechanic === "allStatsUp") {
    battleState.playerAtkBonusTurns = duration; battleState.playerAtkBonus = power || 15; battleState.playerAtkBonusMode = "add";
    battleState.playerCritBonusTurns = duration; battleState.playerCritBonus = Math.round((power || 15) * 0.6);
    battleState.playerDamageReductionTurns = duration; battleState.playerDamageReductionRatio = 1 - Math.min(0.5, (power || 15) / 100);
  }
  else return null;
  return (def && def.label) || STATUS_EFFECT_LABELS[effect.kind] || effect.kind;
}

// ★「大いなる光芒状態」のように、1つの技で自己強化を2つ同時に付与するもの用。
//   selfBuff・selfBuff2の両方を適用し、実際に発動したものだけのラベルを配列で返す（攻撃技の状態異常①②と同じ考え方）
function applyAllSelfBuffsToPlayer(skill) {
  const labels = [];
  if (skill.selfBuff) { const l = applySelfBuffFromSkill(skill.selfBuff); if (l) labels.push(l); }
  if (skill.selfBuff2) { const l = applySelfBuffFromSkill(skill.selfBuff2); if (l) labels.push(l); }
  return labels;
}
function applyAllSelfBuffsToCompanion(companion, skill) {
  const labels = [];
  if (skill.selfBuff) { const l = applyCompanionSelfBuff(companion, skill.selfBuff); if (l) labels.push(l); }
  if (skill.selfBuff2) { const l = applyCompanionSelfBuff(companion, skill.selfBuff2); if (l) labels.push(l); }
  return labels;
}

// ===== 魔法少女「マジカル変身」=====
// ★変身する／既に変身中なら案内だけしてターンは消費しない（戻ってやり直せる）
async function useMagicalTransformSkill(skill) {
  changeSpeaker("");
  
  if (isMagicalGirlTransformed()) {
    await displayMessage("すでに変身している！");
    return false;
  }
  
  if (player.gauges.sp.current < skill.spCost) {
    await displayMessage("SPが足りず、変身できなかった。");
    return false;
  }
  
  changeGauge("sp", -skill.spCost);
  checkZetsurinAutoRecover();
  player.magicalGirlTransformed = true;
  renderStatusHUD();
  await displayMessage("「ケアリー☆キューティー♡マジカル変身」！ 魔法少女に変身した！ 魔法の威力が上がり、毎ターンSPが少しずつ回復するようになった。");
  return true;
}

// ★SPが最大値の1割を切ったら、魔法少女の変身は強制的に解除される
//   （以前は3割で切れていたが、変身直後に少し攻撃を受けただけで解除されやすすぎたため1割に変更）
function checkMagicalGirlForcedDetransform() {
  if (!isMagicalGirlTransformed()) return false;
  if (!player.gauges.sp.max) return false;
  if (player.gauges.sp.current / player.gauges.sp.max >= 0.1) return false;
  player.magicalGirlTransformed = false;
  return true;
}

// ★変身中は毎ターン、最大SPの5%ぶんSPが自動回復する（battleLoopの毎ターン処理から呼ぶ）
async function tickMagicalGirlTransformState() {
  if (!isMagicalGirlTransformed()) return;
  const regen = Math.max(1, Math.round(player.gauges.sp.max * 0.05));
  changeGauge("sp", regen);
  renderStatusHUD();
  changeSpeaker("");
  await displayMessage(`変身の力でSPが${regen}回復した。`);
}

// ===== 勝敗処理 =====

// 倒す直前、見逃せる魔物（SPAREABLE_KEYS）だけ「見逃すか殺すか」選べるようにする。
// ★複数体との戦闘では「誰を見逃すか」が成立しづらいため、敵が1体だけだった時に限る。
// 戻り値は「見逃した(true)」かどうか。trueならこの後は handleMonsterSpared() を、
// falseなら通常通り handleBattleVictory() を呼ぶ
async function handlePreVictoryFlavor() {
  if (battleState.enemies.length !== 1) return false;
  const enemy = battleState.enemies[0];
  const master = MONSTER_MASTER[enemy.monsterKey];
  if (!SPAREABLE_KEYS.includes(enemy.monsterKey)) {
    return false; // ★対象外の魔物（ボス級）はそのまま通常の勝利処理へ
  }
  
  changeSpeaker("");
  await displayMessage("かわいそうだし逃がしていいかな！？！？！？！？");
  
  const choice = await displayChoices([
    { text: "逃がす", next: "spare" },
    { text: "殺す", next: "kill" }
  ]);
  
  if (choice.next === "kill") {
    changeMonsterAffection(enemy.monsterKey, -8); // ★殺すと好感度が下がる
    discoveredMonsters[enemy.monsterKey] = true; // ★倒したので図鑑に載る
    // ★要望対応：見逃した/倒した時の演出を、単なる1行のセリフだけでなくブロックで自由に組み立てられるようにする
    if (Array.isArray(master.killBlocks) && master.killBlocks.length > 0 && typeof runBlockSequence === "function") {
      await runBlockSequence({ id: "enemyflavor_" + enemy.monsterKey, blocks: master.killBlocks }, master.killBlocks, []); // scenariobuild.js
    } else if (master.killFlavor) {
      changeSpeaker(master.name);
      await displayMessage(master.killFlavor);
    }
    return false;
  }
  
  // ★見逃す（好感度が上がる。サキュバスだけ他より上がりにくい）
  const [gainMin, gainMax] = master.affectionGainRange || [5, 10];
  const affectionGain = gainMin + Math.floor(Math.random() * (gainMax - gainMin + 1));
  changeMonsterAffection(enemy.monsterKey, affectionGain);
  discoveredMonsters[enemy.monsterKey] = true; // ★見逃したので図鑑に載る
  if (Array.isArray(master.spareBlocks) && master.spareBlocks.length > 0 && typeof runBlockSequence === "function") {
    await runBlockSequence({ id: "enemyflavor_" + enemy.monsterKey, blocks: master.spareBlocks }, master.spareBlocks, []); // scenariobuild.js
  } else if (master.spareFlavor) {
    changeSpeaker(master.name);
    await displayMessage(master.spareFlavor);
  }
  if (enemy.monsterKey === "harpy") {
    changeSpeaker("ハーピー");
    await displayMessage("「ちょっとまっててくださいね……」");
    changeSpeaker("");
    await displayMessage("「チョロチョロチョロ…」");
    changeSpeaker("田中治郎");
    await displayMessage("「え！ちょっと！なにやってんの！」");
    changeSpeaker("ハーピー");
    await displayMessage("「お待たせしました！どうぞ見逃してくれたお礼です！」");
    addItem("harpy_water", 1); // inventory.js
  }
  return true;
}

// 見逃した場合の決着処理：とどめは刺していないので、経験値は半分・お金やドロップは無し
async function handleMonsterSpared() {
  const enemy = battleState.enemies[0];
  changeSpeaker("");
  stopBattleBGM(); // bgm.js
  const halvedExp = Math.floor(enemy.exp / 2); // ★見逃した魔物からは経験値が半分しか手に入らない
  const levelResult = addExp(halvedExp);
  addProgressPoints(1); // ★見逃しでも進行度+1（player.js）
  renderStatusHUD();
  await displayMessage(`${enemy.displayName}を見逃した。経験値${halvedExp}を獲得した。`);
  
  // ★レベルアップ・新スキル習得があれば知らせる
  if (typeof announceLevelUpIfAny === "function") {
    await announceLevelUpIfAny(levelResult);
  }
  
  const monsterKey = enemy.monsterKey;
  hideBattleHud();
  battleState = null;
  // ★受注中の討伐依頼の対象なら、見逃しでも進捗を進める（「被害が減る」という扱い）
  if (typeof progressHuntQuestIfMatching === "function") {
    await progressHuntQuestIfMatching(monsterKey, true);
  }
  await returnToAdventureAfterBattle("win"); // adventure.js（見逃しも探索続行という意味では勝利と同じ扱い）
}

async function handleBattleVictory() {
  changeSpeaker("");
  if (battleState.enemies.length === 1) {
    await displayMessage(`${battleState.enemies[0].displayName}を倒した！`);
  } else {
    await displayMessage("敵を全て倒した！");
  }
  stopBattleBGM(); // bgm.js
  
  // ★戦闘中に力尽きてしまった仲間は、勝利後にわずかなHPで目を覚ます（詰みを防ぐための簡易処置）
  if (player && player.companions) {
    for (const companion of player.companions) {
      if (!companion.alive) {
        companion.alive = true;
        companion.gauges.hp.current = Math.max(1, Math.round(companion.gauges.hp.max * 0.2));
        await displayMessage(`${getCompanionDisplayName(companion)}が意識を取り戻した……！`);
      }
    }
  }
  
  // ★試練の祭殿での戦闘は、通常の経験値・ドロップ・クエスト進捗とは別扱い
  if (battleState.isTrial) {
    await handleTrialVictory(battleState.trialRank);
    return;
  }
  
  // ★魔物を倒してもお金はもらえない仕様に変更（お金は物を売る・クエスト・宝箱・調べる等から得る）。
  //   複数体を倒した時は、全員分の経験値を合算する
  const totalExp = battleState.enemies.reduce((sum, e) => sum + e.exp, 0);
  const levelResult = addExp(totalExp);
  addProgressPoints(2); // ★討伐で進行度+2（player.js）
  renderStatusHUD();
  await displayMessage(`経験値${totalExp}を獲得した。`);
  
  // ★レベルアップ・新スキル習得があれば知らせる
  if (typeof announceLevelUpIfAny === "function") {
    await announceLevelUpIfAny(levelResult);
  }
  
  // ★倒した敵それぞれについて、ドロップ抽選とクエスト進捗を個別にチェックする
  const lootBonus = (typeof hasPassiveSkill === "function" && hasPassiveSkill("lootBonus")) ? 0.15 : 0; // ★お宝鑑定団の「掘り出し物」（player.js）
  for (const enemy of battleState.enemies) {
    // ★マップのエリア解放条件（「指定した敵をn体倒した」「全ての敵をn体倒した」）用に討伐数を記録する
    if (player && player.enemyKillCounts) {
      player.enemyKillCounts[enemy.monsterKey] = (player.enemyKillCounts[enemy.monsterKey] || 0) + 1;
      player.totalKillCount = (player.totalKillCount || 0) + 1;
    }
    if (enemy.dropItemId && Math.random() < enemy.dropRate + lootBonus) {
      addItem(enemy.dropItemId, 1);
      const master = ITEM_MASTER[enemy.dropItemId];
      await displayMessage(`「${master.name}」を手に入れた！`);
    }
    if (typeof progressHuntQuestIfMatching === "function") {
      await progressHuntQuestIfMatching(enemy.monsterKey);
    }
  }
  
  hideBattleHud();
  const wasScripted = battleState.isScripted;
  battleState = null;
  
  if (wasScripted) {
    scriptedBattleOutcome = "win"; // ★呼び出し元（scenario2.js等）がstartBattle()の戻り値で勝敗を判定できるようにする
    return;
  }
  
  await returnToAdventureAfterBattle("win"); // adventure.js
}

// ★要望対応：以前は主人公のHPが0になった時点で即敗北にしていたが、
//   パーティ全員（主人公＋生きている仲間全員）が力尽きた時だけ敗北とする
function isPartyDefeated() {
  if (!player || player.gauges.hp.current > 0) return false;
  const companions = player.companions || [];
  return companions.every(c => !c.alive || c.gauges.hp.current <= 0);
}

async function handleBattleDefeat() {
  changeSpeaker("");
  await displayMessage("目の前が真っ暗になった……");
  stopBattleBGM(); // bgm.js
  
  // ★要望対応：以前は主人公だけHPを全回復させていたが、パーティ全滅が敗北条件になったのに合わせて、
  //   主人公・仲間（戦闘不能だった仲間も含む）全員を、最大HPの1割で戦闘不能状態から回復させる
  //   （今はゲームオーバー演出を用意していないので、この状態で送還する）
  player.gauges.hp.current = Math.max(1, Math.round(player.gauges.hp.max * 0.1));
  (player.companions || []).forEach(companion => {
    companion.alive = true;
    companion.gauges.hp.current = Math.max(1, Math.round(companion.gauges.hp.max * 0.1));
  });
  
  // ★負けたペナルティとして、所持金を少し失う（今の所持金の1割、最低でも10陳）
  const goldLost = Math.min(gold, Math.max(10, Math.round(gold * 0.1)));
  if (goldLost > 0) {
    changeGold(-goldLost); // inventory.js
  }
  lastDefeatGoldLoss = goldLost; // ★adventure.js側の帰還メッセージで使う
  renderStatusHUD();
  
  const wasTrial = battleState.isTrial;
  const wasScripted = battleState.isScripted;
  hideBattleHud();
  battleState = null;
  
  if (wasTrial) {
    changeSpeaker("");
    await displayMessage(goldLost > 0
      ? `気づくと、村の入り口に運ばれていたようだ……財布から${goldLost}陳が消えている。試練はまたの機会に挑もう。`
      : "気づくと、村の入り口に運ばれていたようだ……試練はまたの機会に挑もう。");
    openTownMenu(); // town.js（試練は探索ループの外なので、村へ直接戻す）
    return;
  }
  
  if (wasScripted) {
    scriptedBattleOutcome = "defeat"; // ★呼び出し元（scenario2.js等）がstartBattle()の戻り値で勝敗を判定できるようにする
    return;
  }
  
  await returnToAdventureAfterBattle("defeat"); // adventure.js
}

// 試練の祭殿での勝利処理：経験値や戦利品は無く、代わりにその試練ランクをクリア済みにして、
// 名声度的には既に足りていたランクを正式に反映する
async function handleTrialVictory(trialRank) {
  if (!player.clearedTrialRanks) player.clearedTrialRanks = [];
  if (!player.clearedTrialRanks.includes(trialRank)) player.clearedTrialRanks.push(trialRank);
  
  await displayMessage(`${trialRank}ランクの試練を突破した！`);
  
  const rankResult = applyAttainableRank(); // questboard.js（名声度と試練クリア状況から、上げられるランクまで上げる）
  if (rankResult.rankUp) {
    await displayMessage(`冒険者ランクが${rankResult.newRank}に上がった！`);
    showRankUpPopup("ランクアップ！", `冒険者ランクが「${rankResult.newRank}」になった`); // mainfunc.js
  }
  renderStatusHUD();
  
  hideBattleHud();
  battleState = null;
  openTownMenu(); // town.js
}

// ===== 敵HP表示（main-screen） =====
function showBattleHud() {
  const hud = document.getElementById("battle-hud");
  if (hud) hud.classList.remove("hidden");
  renderBattleEnemies();
  updateBattleHud();
}

function hideBattleHud() {
  const hud = document.getElementById("battle-hud");
  if (hud) hud.classList.add("hidden");
  const container = document.getElementById("battle-enemies");
  if (container) container.innerHTML = "";
}

// ★メイン画面中央：敵を最大5体まで、左からジグザグに並べて表示する。体数が多いほど1体あたりの画像を小さくする。
//   ★体数に応じた基準サイズ（sizePx）に、敵1体ごとの「大きさ倍率」（sizeMultiplier、敵設定/ボス設定で指定）を
//     掛けて最終的な表示サイズにする。横並びのflexboxレイアウト（gap付き）なので、大きくした分は
//     自動的に隣の敵との間隔で吸収され、重なり合わない（ここで個別に位置調整をする必要がない）
//   ★ターゲット移動のたびにこの関数が呼ばれるが、DOM要素（特に<img>）を毎回作り直すと、
//     画像が用意されていない敵のimgがそのたびに再読み込みされ、失敗するまでの一瞬「壊れた画像」アイコンが
//     ちらついて見える不具合があった。そのため、敵の数が変わった時（＝新しい戦闘が始まった時）だけ
//     要素を作り直し、それ以外（ターゲット移動やHP変化）は既存の要素を使い回して見た目だけ更新する
function renderBattleEnemies() {
  const container = document.getElementById("battle-enemies");
  if (!container || !battleState) return;
  
  const count = battleState.enemies.length;
  const sizePx = Math.round(Math.max(90, 240 - (count - 1) * 32)); // ★体数に応じて画像サイズを縮小（以前より全体的に大きめに）
  const sizeForEnemy = (enemy) => {
    const multiplier = (typeof enemy.sizeMultiplier === "number" && enemy.sizeMultiplier > 0) ? enemy.sizeMultiplier : 1;
    return Math.round(Math.min(Math.max(sizePx * multiplier, 30), sizePx * 3)); // ★極端な値で表示が壊れないよう上下限を設ける
  };
  container.classList.toggle("battle-enemies-targeting", isTargetingEnemy);
  
  // ★選択中のヒント文言も、表示/非表示の切り替えだけにする（作り直さない）
  let hintEl = container.querySelector(".battle-target-hint");
  const showHint = isTargetingEnemy && getAliveEnemies().length > 1;
  if (showHint && !hintEl) {
    hintEl = document.createElement("div");
    hintEl.className = "battle-target-hint";
    hintEl.innerHTML = '← → で狙う相手を選択、決定キーで攻撃　<span class="battle-target-cancel">（Xキー／タップでやめる）</span>';
    hintEl.querySelector(".battle-target-cancel").onclick = (event) => {
      event.stopPropagation();
      cancelEnemyTargetSelection();
    };
    container.insertBefore(hintEl, container.firstChild);
  } else if (!showHint && hintEl) {
    hintEl.remove();
  }
  
  let unitEls = Array.from(container.querySelectorAll(".battle-enemy-unit"));
  const needsRebuild = unitEls.length !== count; // ★戦闘開始直後など、敵の数がDOM側と食い違っている時だけ作り直す
  
  if (needsRebuild) {
    unitEls.forEach(el => el.remove());
    unitEls = battleState.enemies.map((enemy, index) => {
      const unitEl = document.createElement("div");
      unitEl.className = "battle-enemy-unit";
      
      const cursorEl = document.createElement("div");
      cursorEl.className = "battle-enemy-unit-cursor";
      cursorEl.textContent = "▼";
      
      const imgEl = document.createElement("img");
      imgEl.className = "battle-enemy-unit-image";
      const initialSize = sizeForEnemy(enemy);
      imgEl.style.width = `${initialSize}px`;
      imgEl.style.height = `${initialSize}px`;
      imgEl.onerror = () => { imgEl.classList.add("hidden"); };
      imgEl.src = enemy.imagePath || `img/敵/${enemy.name}.png`;
      imgEl.alt = enemy.displayName;
      
      const nameEl = document.createElement("p");
      nameEl.className = "battle-enemy-unit-name";
      nameEl.textContent = enemy.displayName;
      
      const barEl = document.createElement("div");
      barEl.className = "battle-enemy-unit-hp-bar";
      const fillEl = document.createElement("div");
      fillEl.className = "battle-enemy-unit-hp-fill";
      barEl.appendChild(fillEl);
      
      unitEl.appendChild(cursorEl);
      unitEl.appendChild(imgEl);
      unitEl.appendChild(nameEl);
      unitEl.appendChild(barEl);
      
      // ★ターゲット選択中は、生きている相手をクリック（タップ）でも選べるようにする
      unitEl.onclick = (event) => {
        event.stopPropagation();
        if (!isTargetingEnemy || battleState.enemies[index].hp <= 0) return;
        battleState.targetIndex = index;
        confirmEnemyTarget(battleState.enemies[index]);
      };
      
      container.appendChild(unitEl);
      return unitEl;
    });
  }
  
  // ★見た目の更新（サイズ・HP・生死・選択中かどうか）は、作り直したかどうかに関わらず毎回ここで反映する
  battleState.enemies.forEach((enemy, index) => {
    const unitEl = unitEls[index];
    if (!unitEl) return;
    const isDefeated = enemy.hp <= 0;
    const isTargeted = !isDefeated && index === battleState.targetIndex;
    unitEl.classList.toggle("defeated", isDefeated);
    unitEl.classList.toggle("targeted", isTargeted);
    
    const imgEl = unitEl.querySelector(".battle-enemy-unit-image");
    if (imgEl) {
      const size = sizeForEnemy(enemy);
      imgEl.style.width = `${size}px`;
      imgEl.style.height = `${size}px`;
    }
    
    const fillEl = unitEl.querySelector(".battle-enemy-unit-hp-fill");
    if (fillEl) {
      const percent = enemy.maxHp > 0 ? Math.max(0, (enemy.hp / enemy.maxHp) * 100) : 0;
      fillEl.style.width = `${percent}%`;
    }
  });
}

function updateBattleHud() {
  if (!battleState) return;
  
  // ★bgm.js等、「敵は常に1体」前提だった既存コードとの互換用に、先頭の敵（ボス戦なら常にこれが本体）の値をここにも反映する
  const primary = battleState.enemies[0];
  battleState.monsterKey = primary.monsterKey;
  battleState.name = primary.displayName;
  battleState.hp = primary.hp;
  battleState.maxHp = primary.maxHp;
  
  // ★右上の簡易HUDは「今狙っている（次に狙うことになる）相手」の情報を表示する
  const target = getCurrentTarget() || primary;
  const nameEl = document.getElementById("battle-enemy-name");
  const valueEl = document.getElementById("enemy-hp-value");
  const fillEl = document.getElementById("enemy-hp-fill");
  
  if (nameEl) nameEl.textContent = target.level ? `${target.displayName}（Lv.${target.level}）` : target.displayName;
  if (valueEl) valueEl.textContent = `${target.hp} / ${target.maxHp}`;
  if (fillEl) {
    const percent = target.maxHp > 0 ? (target.hp / target.maxHp) * 100 : 0;
    fillEl.style.width = `${Math.max(0, percent)}%`;
  }
  
  renderBattleEnemies();
  notifyBattleBGMOfStateChange(!!battleState.isBoss); // bgm.js（HPの状況に応じてBGMを自動で切り替える）
}