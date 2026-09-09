// appraisal.js
// 「お宝鑑定団」の固有スキル「なんでも鑑定」専用の処理をまとめたファイル。
//
// 流れ：
//   ①鑑定するアイテムを選ぶ（自身の冒険者ランク+1までしか鑑定できない）
//   ②予想額を決める（+-ボタン。増減幅は100陳/1000陳で切替できる）
//   ③鑑定タイム演出（電光表示ボードで桁数が2秒おきに増えつつスロットのように数字が回る）
//   ④結果発表（粗悪品／本物／なかなかの額、の3パターン。ランクも一緒に伝える）
//   ⑤「錆びたシリーズ」だけの追加効果（本当のステータス判明＋レアなランクアップ抽選）
//
// mainfunc.js の useSkillFromTab() から、skill.id === "appraisal" の時だけこちらが呼ばれる。
// ランクの強さ比較は questboard.js の RANK_ORDER / rankIndex() をそのまま使う。

// ===== 各種しきい値 =====
const APPRAISAL_STEP_OPTIONS = [10, 100, 1000]; // ★予想額を動かす1回あたりの増減幅（切替式）
const APPRAISAL_LOWVALUE_THRESHOLD = 10000;   // 「粗悪品」判定に使う上限（真価がこれ以下）
const APPRAISAL_GENUINE_THRESHOLD = 100000;   // 「本物」判定に使う下限（真価がこれ以上）
const APPRAISAL_VALUE_VARIANCE_RATIO = 0.15;  // 真価は基準額(trueValue)から±15%ランダムに変動する

// ===== メイン処理 =====
// skill: player.js の "お宝鑑定団" 固有スキル定義（{ id: "appraisal", spCost, ... }）
async function useAppraisalSkill(skill) {
  if (!player) return;
  
  // ★SPが足りなければ、アイテムを選ばせる前の時点で止める
  if (player.gauges.sp.current < skill.spCost) {
    changeSpeaker("");
    await displayMessage(`SPが足りず、「${skill.name}」は使えなかった。`, { allowSubFocus: true });
    return;
  }
  
  const target = await pickAppraisalTarget();
  if (!target) return; // ★「やめる」を選んだ、または鑑定できる物が無かった
  
  // ★自身の冒険者ランク+1までしか鑑定できない。それを超える見た事もない品だと、鑑定不能
  if (rankIndex(target.master.rank) > rankIndex(player.rank) + 1) {
    changeSpeaker("鑑定士");
    await displayMessage("「見た事ないアイテムすぎて鑑定できぬぞよ。」", { allowSubFocus: true });
    return;
  }
  
  const guessedPrice = await pickGuessedPrice(target.master);
  if (guessedPrice === null) return; // ★予想額を決める途中で「やめる」を選んだ
  
  // ★ここまで来て初めてSPを消費する（アイテム選び・金額決め直しではSPを使わせない）
  changeGauge("sp", -skill.spCost);
  renderStatusHUD();
  
  const trueValue = rollTrueValue(target.master); // ★このアイテムの真価をここで確定させる（以後ずっと固定）
  await playAppraisalSlotAnimation(trueValue);
  await revealAppraisalResult(target, guessedPrice, trueValue);
}

// ===== ①鑑定するアイテムを選ぶ =====
// 戻り値: { itemId, master } か、選べる物が無い／キャンセルした場合は null
async function pickAppraisalTarget() {
  // ★同じアイテムIDはまとめて1つの選択肢にする（真価・性能はアイテムIDごとに固定なので、
  //   1回鑑定すれば同じ物を何個持っていても全部まとめて鑑定済みになる）
  const candidates = [];
  const seenItemIds = new Set();
  
  inventorySlots.forEach((slot) => {
    if (!slot || slot.appraised) return; // ★空きマス・鑑定済みは対象外
    if (seenItemIds.has(slot.itemId)) return;
    const master = ITEM_MASTER[slot.itemId];
    if (!master) return;
    seenItemIds.add(slot.itemId);
    candidates.push({ itemId: slot.itemId, master });
  });
  
  changeSpeaker("");
  if (candidates.length === 0) {
    await displayMessage("持ち物の中に、まだ鑑定していない物は無いようだ。", { allowSubFocus: true });
    return null;
  }
  
  await displayMessage("何を鑑定する？", { allowSubFocus: true });
  
  const choices = candidates.map(c => ({
    text: `${c.master.name}（ランク${c.master.rank}）`,
    next: c.itemId
  }));
  choices.push({ text: "やめる", next: "cancel", isBack: true });
  
  const picked = await displayChoices(choices, 0, { allowSubFocus: true });
  if (picked.next === "cancel") return null;
  
  return candidates.find(c => c.itemId === picked.next);
}

// ===== ②予想額を決める =====
// 0陳を初期値に、選択肢で額を上下させながら決める（window.prompt等は使わない方針のため、
// 「直接入力」の代わりに+-ボタン＋増減幅切替で仕様を再現している）。
// 戻り値: 確定した予想額（陳）。「やめる」を選んだ場合は null
async function pickGuessedPrice(master) {
  let guess = 0;
  let stepIndex = 0; // APPRAISAL_STEP_OPTIONSのindex（0=10刻み、1=100刻み、2=1000刻み）
  
  while (true) {
    const step = APPRAISAL_STEP_OPTIONS[stepIndex];
    changeSpeaker("鑑定士");
    await displayMessage(`「${master.name}」の価値は、いくらだと思う？\n（現在の予想額：${guess}陳／増減幅：${step}陳）`, { allowSubFocus: true });
    
    const nextStepIndex = (stepIndex + 1) % APPRAISAL_STEP_OPTIONS.length;
    const nextStep = APPRAISAL_STEP_OPTIONS[nextStepIndex];
    const picked = await displayChoices([
      { text: `+${step}陳`, next: "add" },
      { text: `-${step}陳`, next: "sub" },
      { text: `増減幅を${nextStep}陳に切替`, next: "togglestep" },
      { text: "この額で鑑定する", next: "confirm" },
      { text: "やめる", next: "cancel", isBack: true }
    ], 0, { allowSubFocus: true });
    
    if (picked.next === "cancel") return null;
    if (picked.next === "confirm") return guess;
    if (picked.next === "togglestep") {
      stepIndex = nextStepIndex;
      continue;
    }
    guess = picked.next === "add" ? guess + step : Math.max(0, guess - step); // ★0陳未満にはしない
  }
}

// ===== 真価の確定 =====
// ★真価は基準額(trueValue)から±15%ランダムに変動する。一度確定させたら以後は固定し、
//   買取屋などで参照される真価もこの確定額に統一する（ITEM_MASTERを直接書き換える）
function rollTrueValue(master) {
  if (master.trueValueRolled) return master.trueValue; // ★既に鑑定済みなら再抽選しない
  const base = master.trueValue;
  const variance = Math.round(base * APPRAISAL_VALUE_VARIANCE_RATIO);
  const rolled = base + (variance > 0 ? Math.floor(Math.random() * (variance * 2 + 1)) - variance : 0);
  master.trueValue = Math.max(1, rolled);
  master.trueValueRolled = true;
  return master.trueValue;
}

// ===== ③鑑定タイム演出 =====
// ★「開運なんでも鑑定団」風の電光表示ボード（appraisal-board）を使う。
//   桁数がイチ→ジュウ→ヒャク……と2秒おきに1つずつ増えていき、その間は数字がスロットのように
//   ランダムに入れ替わり続ける。全桁そろったら最後にもう一段スピンしてから、実際の金額で確定する
const APPRAISAL_STAGE_MS = 2000; // ★桁が1つ増えるまでの間隔（イチ、ジュウ、ヒャク……のペース）
const APPRAISAL_SPIN_TICK_MS = 90; // ★スロットの数字が入れ替わる間隔

async function playAppraisalSlotAnimation(trueValue) {
  const myToken = activeSessionToken; // ★演出中にロード等で場面が切り替わったら、古い演出を打ち切るための目印
  const board = document.getElementById("appraisal-board");
  const digitsEl = document.getElementById("appraisal-board-digits");
  
  changeSpeaker("鑑定士");
  await displayMessage("集中して、対象の価値を読み取っていく……", { allowSubFocus: true });
  
  isTextDisplaying = true; // ★このアニメーション中は、他のキー操作と競合しないようにする
  board.classList.remove("hidden");
  
  const totalDigits = String(trueValue).length;
  
  // ★桁数を1→2→3……と2秒おきに増やしながら、その桁数ぶんの数字をスロットのように回し続ける
  for (let activeDigits = 1; activeDigits <= totalDigits; activeDigits++) {
    const spinResult = await spinAppraisalDigits(digitsEl, activeDigits, APPRAISAL_STAGE_MS, myToken);
    if (!spinResult) { // ★途中でロードされる等して打ち切られた場合
      board.classList.add("hidden");
      isTextDisplaying = false;
      return;
    }
  }
  
  // ★全桁そろった状態で、もう一段スピンしてから実際の金額に確定させる
  await spinAppraisalDigits(digitsEl, totalDigits, APPRAISAL_STAGE_MS, myToken);
  
  if (myToken === activeSessionToken) {
    digitsEl.textContent = `¥${trueValue.toLocaleString("ja-JP")}`;
    digitsEl.classList.add("settled");
    await wait(800);
    digitsEl.classList.remove("settled");
  }
  
  board.classList.add("hidden");
  isTextDisplaying = false;
}

// digitsEl に、activeDigits桁ぶんのランダムな数字をSPIN_TICK_MSおきに表示し続ける。
// durationMs経過したら止まる。戻り値：最後まで演出できたらtrue、途中で打ち切られたらfalse
async function spinAppraisalDigits(digitsEl, activeDigits, durationMs, myToken) {
  const endAt = Date.now() + durationMs;
  while (Date.now() < endAt) {
    if (myToken !== activeSessionToken) return false;
    digitsEl.textContent = formatAppraisalSpinDigits(activeDigits);
    await wait(APPRAISAL_SPIN_TICK_MS);
  }
  return true;
}

// activeDigits桁ぶんのランダムな数字を、実際の金額表示と同じ「¥」「,」付きの見た目で組み立てる
function formatAppraisalSpinDigits(activeDigits) {
  let digits = "";
  for (let i = 0; i < activeDigits; i++) {
    // ★先頭の桁だけは0にならないようにする（「¥0123」のような不自然な見た目を避けるため）
    digits += i === 0 ? String(Math.floor(Math.random() * 9) + 1) : String(Math.floor(Math.random() * 10));
  }
  return `¥${Number(digits).toLocaleString("ja-JP")}`;
}

// ===== ④結果発表 =====
// ★予想額を下回りかつ真価が1万以下＝粗悪品／予想額以上かつ真価が10万以上＝本物／それ以外＝なかなかの額、
//   の3パターン。どのパターンでも必ず「ナレーター1行→鑑定士のコメント1行」の順で見せる
async function revealAppraisalResult(target, guessedPrice, trueValue) {
  // ★この時点で、同じアイテムIDが入っている全マスをまとめて鑑定済みにする
  inventorySlots.forEach((slot, index) => {
    if (slot && slot.itemId === target.itemId) markSlotAsAppraised(index); // inventory.js
  });
  
  const rank = target.master.rank;
  const isExactGuess = guessedPrice === trueValue; // ★予想額ぴったりだった時だけの特別な一言（おまけ演出）
  
  let narratorLine;
  let appraiserLine;
  
  if (trueValue < guessedPrice && trueValue <= APPRAISAL_LOWVALUE_THRESHOLD) {
    // ★「粗悪品」パターン：予想額を下回り、真価そのものも安かった
    narratorLine = isExactGuess ? "おおー！ ぴったりーーーー！ ……だけど、これは……" : "残念！ 粗悪品です！";
    appraiserLine = `酷い品質ですね…ランクは${rank}です。`;
    
  } else if (trueValue >= guessedPrice && trueValue >= APPRAISAL_GENUINE_THRESHOLD) {
    // ★「本物」パターン：予想額以上で、真価そのものも高額だった
    narratorLine = isExactGuess ? "おおー！ ぴったりーーーー！ おみごと！" : `${trueValue}陳！ おめでとう！`;
    appraiserLine = `間違いなく本物ですね。ランクは${rank}です。大切になさってください。`;
    
  } else {
    // ★それ以外＝「なかなかの額」パターン
    narratorLine = isExactGuess ? "おおー！ ぴったりーーーー！ おみごと！" : `${trueValue}陳！ なかなかの額です！ おめでとうございます！`;
    appraiserLine = `なかなかの品ですね。ランクは${rank}です。`;
  }
  
  changeSpeaker("");
  await displayMessage(narratorLine, { allowSubFocus: true });
  changeSpeaker("鑑定士");
  await displayMessage(`「${target.master.name}」の真の価値は${trueValue}陳。${appraiserLine}`, { allowSubFocus: true });
  
  // ★「錆びたシリーズ」だけの追加効果。対象外のアイテムでは何も起きない
  if (target.master.isRustySeries) {
    await revealRustySeriesEffects(target);
  }
}

// ===== ⑤「錆びたシリーズ」専用の追加効果 =====

// ★サビ取りをすると、この武器/防具は必ず（100%）別の姿へ変化する。ほとんどはF〜Bランクの「よくある結果」になるが、
//   低確率でAランク以上の「大当たり」になる。鑑定して真の価値が判明済みだと、大当たりの確率が上がる
const RUSTY_HIGH_TIER_CHANCE = 1 / 20; // ★未鑑定の場合：Aランク以上になる確率
const RUSTY_HIGH_TIER_CHANCE_APPRAISED = 1 / 15; // ★鑑定済みの場合：Aランク以上になる確率が上がる
const RUSTY_HIGH_TIER_RANKS = ["A", "AA", "AAA", "S", "SS", "SSS", "X"]; // ★「大当たり」階層。Aに近いほど出やすい
const RUSTY_COMMON_TIER_RANKS = ["F", "E", "D", "C", "B"]; // ★「よくある結果」階層。Fに近いほど出やすい

// ★指定した階層（ランクの配列）の中から、シナリオエディタで実際に変化先アイテムが設定されている物だけを対象に、
//   配列の先頭に近いランクほど出やすいよう重み付けして1つ選ぶ
function pickWeightedRustyRankFrom(master, rankList) {
  const candidates = rankList.filter(r => master.rustyRankOutcomes && master.rustyRankOutcomes[r]);
  if (candidates.length === 0) return null;
  const weights = candidates.map((r, i) => candidates.length - i);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * totalWeight;
  for (let i = 0; i < candidates.length; i++) {
    if (roll < weights[i]) return candidates[i];
    roll -= weights[i];
  }
  return candidates[candidates.length - 1]; // ★丸め誤差の保険
}

// ★このアイテムが実際にサビ取りで変化する先のランクを1つ決める。必ずどちらかの階層から選ばれるようにし
//   （「確実に変わる」を成立させるため）、選んだ階層に変化先が1つも設定されていなければ、もう一方の階層から探す
function pickRustyTransformRank(master, isAppraised) {
  const highChance = isAppraised ? RUSTY_HIGH_TIER_CHANCE_APPRAISED : RUSTY_HIGH_TIER_CHANCE;
  const wantsHighTier = Math.random() < highChance;
  const primaryList = wantsHighTier ? RUSTY_HIGH_TIER_RANKS : RUSTY_COMMON_TIER_RANKS;
  const secondaryList = wantsHighTier ? RUSTY_COMMON_TIER_RANKS : RUSTY_HIGH_TIER_RANKS;
  return pickWeightedRustyRankFrom(master, primaryList) || pickWeightedRustyRankFrom(master, secondaryList);
}

// ★サビ取りで当たったランクに、シナリオエディタで指定した「変化先アイテム」が設定されていれば、
//   この個体（slot）そのものを、指定した別のアイテムへ変化させる。
//   slot.itemId自体を書き換えるので、名前・説明・ランク・性能は全て新しいアイテムのものにそのまま揃う。
//   他の同じ武器を持っていても、この個体だけが変化する（他の個体・共有のアイテムマスターには一切触れない）
function applyRustyRankTransformation(slot, master, newRank) {
  const targetItemId = master.rustyRankOutcomes && master.rustyRankOutcomes[newRank];
  if (!targetItemId) return null;
  const targetMaster = ITEM_MASTER[targetItemId];
  if (!targetMaster) return null;
  
  const oldHp = (slot.instanceOverrides && slot.instanceOverrides.params && slot.instanceOverrides.params.最大HP !== undefined)
    ? slot.instanceOverrides.params.最大HP
    : (master.params.最大HP || 0);
  const newHp = targetMaster.params.最大HP || 0;
  
  slot.itemId = targetItemId; // ★この個体そのものが、別のアイテムに変わる
  slot.instanceOverrides = {}; // ★元の武器に付いていた手入れ跡・個体差などは、もう別物になったのでリセットする
  
  return { name: targetMaster.name, rank: targetMaster.rank, oldHp, newHp };
}

async function revealRustySeriesEffects(target) {
  const master = target.master;
  
  changeSpeaker("");
  await displayMessage("……ん？ サビの下から、何かが見えてきた……", { allowSubFocus: true });
  
  // ★本当のステータスが判明する（appraisedParamsBaseを中心にランダムに変動）。
  //   鑑定はあくまで「今のこの武器の真の性能を明らかにする」だけで、武器そのものを変える力は無い。
  //   武器を実際に変化させられるのはサビ取り屋だけ（performRustRemoval側でランクアップ抽選を行う）
  if (master.appraisedParamsBase) {
    const statChangeText = applyRustyStatReveal(target.itemId, master);
    if (statChangeText) {
      changeSpeaker("");
      await displayMessage(statChangeText, { allowSubFocus: true });
    }
  }
}

// ★武器・防具のparamsを、appraisedParamsBase±appraisedParamsVarianceの範囲でランダムに書き換える。
//   装備中に鑑定した場合は、最大HPボーナス（防具）もその場で正しい値に付け替える
function applyRustyStatReveal(itemId, master) {
  const oldName = master.name;
  const oldParams = master.params;
  const oldHp = oldParams.最大HP || 0;
  
  const newParams = Object.assign({}, oldParams);
  Object.keys(master.appraisedParamsBase).forEach(key => {
    const base = master.appraisedParamsBase[key];
    const variance = (master.appraisedParamsVariance && master.appraisedParamsVariance[key]) || 0;
    const rolled = base + (variance > 0 ? Math.floor(Math.random() * (variance * 2 + 1)) - variance : 0);
    // ★baseが0より大きい（＝意味のあるステータス）場合は、運が悪くても最低1は残す
    newParams[key] = base > 0 ? Math.max(1, rolled) : Math.max(0, rolled);
  });
  master.params = newParams;
  if (master.appraisedName) master.name = master.appraisedName;
  
  const newHp = newParams.最大HP || 0;
  if (player && newHp !== oldHp) {
    Object.keys(player.equipment).forEach(slot => {
      const equipped = getEquippedItemData(slot); // player.js（instanceId→実体の解決）
      if (equipped && equipped.itemId === itemId) {
        player.gauges.hp.max = Math.max(1, player.gauges.hp.max - oldHp + newHp);
        player.gauges.hp.current = Math.min(player.gauges.hp.current, player.gauges.hp.max);
      }
    });
    renderStatusHUD();
  }
  
  const statParts = Object.keys(master.appraisedParamsBase).map(key => {
    const oldVal = oldParams[key] || 0;
    const newVal = newParams[key] || 0;
    return `${key} ${oldVal} → ${newVal}`;
  });
  const statText = statParts.length > 0 ? `（${statParts.join("、")}）` : "";
  
  return master.appraisedName
    ? `サビを払い落とすと、まるで別物のような輝きを取り戻した……！ 「${oldName}」は、実は「${master.appraisedName}」だったのだ！${statText}`
    : `「${oldName}」に秘められていた、本当の性能が明らかになった！${statText}`;
}

// ===== 錆取り屋（town.jsのopenRustRemovalShopから呼ばれる） =====
// ★「錆びたシリーズ」の武器・防具をお金を払って手入れし、ステータスを揺らし直せる場所。
//   なんでも鑑定で先に鑑定済み・かつランクAA以上になっている物ほど、良い結果が出やすい

const RUST_REMOVAL_COST = 500;

// このアイテムIDが、既に鑑定済みかどうか（インベントリのどれか1マスでもappraisedならtrue）
function isItemAppraised(itemId) {
  return inventorySlots.some(slot => slot && slot.itemId === itemId && slot.appraised);
}

// 錆取り屋で手入れできる（＝所持している「錆びたシリーズ」の）アイテム一覧を返す
// ★錆取り屋で選べる候補一覧。以前はアイテムIDでまとめて1つにしていたため、同じ「錆びた剣」を
//   2本持っていても片方しか選べず、しかも結果が両方に影響してしまっていた。
//   個体（instanceId）ごとに別々の候補として並べ、結果もその個体だけに反映されるようにする
// ★以前は一度手入れした個体でも表示名が「（手入れ済み）」に変わるだけで、何度でも同じ個体を
//   手入れに出せてしまっていた（お金を払うだけの無限リロールになっていた）。1個体につき1回きりにする
function getRustRemovalCandidates() {
  const candidates = [];
  inventorySlots.forEach(slot => {
    if (!slot || !slot.instanceId) return; // ★装備・貴重品以外（スタック品）は対象外
    if (slot.instanceOverrides && slot.instanceOverrides.rustTreated) return; // ★既に手入れ済みの個体は対象外
    const rawMaster = ITEM_MASTER[slot.itemId];
    if (!rawMaster || !rawMaster.isRustySeries) return;
    candidates.push({ itemId: slot.itemId, slot, master: getEffectiveItemMaster(slot) }); // player.js
  });
  return candidates;
}

// 実際にサビ取りを行い、結果を説明するセリフを返す
// ★「鑑定済み・かつランクAA以上」なら上振れ寄り、そうでなければ下振れ寄りで、
//   武器・防具が持っている数値パラメータ（装備部位以外）をランダムに書き換える。
//   ★以前は元の値の大きさに関わらず一律-10〜+15で揺らしていたため、
//     錆びた剣（攻撃力8）のような低ステータス武器が0近くまで落ちてしまい「攻撃力が実質マイナスになった」ように
//     感じられる問題があった。変動幅を元の値に比例させ、0より大きい値は最低でも1は残るようにした
// ★以前はここでmaster.params（ITEM_MASTER側、全個体共有）を直接書き換えていたため、
//   同じアイテムを何本持っていても結果が全部に及んでしまい、かつ持ち物欄の表示名も変わらないままだったので
//   「サビ取りしてもらったのに何も変わっていないように見える」不具合の原因になっていた。
//   ここではslot.instanceOverridesに結果を積み重ね、この1本だけに反映する。
//   また、サビ取りは「武器・防具そのものを変化させられる」唯一の手段（鑑定側は真の性能を教えるだけ）
function performRustRemoval(itemId, master, slot) {
  const favorable = isItemAppraised(itemId) && rankIndex(master.rank) >= rankIndex("AA");
  
  // ★サビ取りをすると必ず（100%）この武器/防具は変化する。ほとんどはF〜Bランクの「よくある結果」になり、
  //   低確率（未鑑定なら1/20、鑑定して真の価値が判明済みなら1/15）でAランク以上の「大当たり」になる
  if (master.isRustySeries) {
    const isAppraised = isItemAppraised(itemId);
    const pickedRank = pickRustyTransformRank(master, isAppraised);
    if (pickedRank) {
      const transformResult = applyRustyRankTransformation(slot, master, pickedRank);
      if (transformResult) {
        if (player && transformResult.newHp !== transformResult.oldHp && Object.values(player.equipment).includes(slot.instanceId)) {
          player.gauges.hp.max = Math.max(1, player.gauges.hp.max - transformResult.oldHp + transformResult.newHp);
          player.gauges.hp.current = Math.min(player.gauges.hp.current, player.gauges.hp.max);
          renderStatusHUD();
        }
        const isHighTier = RUSTY_HIGH_TIER_RANKS.includes(pickedRank);
        const flavor = isHighTier
          ? `「うおっ……！？」　サビを打ちおろした瞬間、まばゆい光とともに武器がまるごと姿を変えた……！ その正体は「${transformResult.name}」（ランク${transformResult.rank}）だった！`
          : `サビを打ちおろすと、武器の姿が変わった。「${transformResult.name}」（ランク${transformResult.rank}）になったようだ。`;
        return flavor;
      }
    }
    // ★変化先が1つも設定されていないアイテムだった場合だけ、今まで通り性能の揺らぎ直しにフォールバックする
  }
  
  const statKeys = Object.keys(master.params).filter(key => key !== "装備部位");
  if (statKeys.length === 0) return "「ん？ これはいじりようがない品だな。」";
  
  const oldHp = master.params.最大HP || 0;
  const changes = [];
  if (!slot.instanceOverrides) slot.instanceOverrides = {};
  if (!slot.instanceOverrides.params) slot.instanceOverrides.params = {};
  
  statKeys.forEach(key => {
    const oldVal = master.params[key]; // ★この個体の「今の」値（前回までのサビ取り結果込み）
    // ★変動幅は元の値の約3割（最低でも±1）を目安にする。これで低ステータスの武器・防具でも
    //   極端に振り回されすぎない
    const magnitude = Math.max(1, Math.round(Math.abs(oldVal) * 0.3));
    const roll = favorable
      ? Math.floor(Math.random() * (magnitude + 1))                              // 0 〜 +magnitude（上振れ寄り）
      : Math.floor(Math.random() * (magnitude + 1)) - Math.ceil(magnitude * 0.7); // -0.7magnitude 〜 +0.3magnitude（下振れ寄り）
    // ★元々0より大きい数値（＝意味のあるステータス）は、どれだけ運が悪くても最低1は残す
    const newVal = oldVal > 0 ? Math.max(1, oldVal + roll) : Math.max(0, oldVal + roll);
    slot.instanceOverrides.params[key] = newVal;
    if (newVal !== oldVal) changes.push(`${key} ${oldVal} → ${newVal}`);
  });
  
  // ★手入れした個体だと一目で分かるよう、表示名に印を付ける。また、この個体はこれで手入れ済み扱いにして、
  //   以後は錆取り屋の候補一覧（getRustRemovalCandidates）に出てこないようにする（何度でも掛け直せた不具合の修正）
  if (!slot.instanceOverrides.name) slot.instanceOverrides.name = `${master.name}（手入れ済み）`;
  slot.instanceOverrides.rustTreated = true;
  
  // ★装備中なら最大HPボーナスも付け替える
  const newHp = slot.instanceOverrides.params.最大HP;
  if (player && newHp !== undefined && newHp !== oldHp) {
    if (player.equipment && Object.values(player.equipment).includes(slot.instanceId)) {
      player.gauges.hp.max = Math.max(1, player.gauges.hp.max - oldHp + newHp);
      player.gauges.hp.current = Math.min(player.gauges.hp.current, player.gauges.hp.max);
    }
    renderStatusHUD();
  }
  
  if (changes.length === 0) return "「よし、サビ取り完了……と言いたいが、今回は特に変化無しだったな。」";
  return `「よし、サビ取り完了だ。」（${changes.join("、")}）`;
}