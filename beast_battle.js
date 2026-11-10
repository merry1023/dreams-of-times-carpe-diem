// beast_battle.js
// ===================================================================
// ===== 戦闘中のおとも魔獣（段階2：常時行動・狙われ方・倒れた時・戦闘画面の表示） =====
// ===================================================================
// ★仕様（企画の決定事項）
//   ・魔獣は、プレイヤーが指示せず自動で戦う。仲間とは別枠で、行動可能数には含めない
//   ・常時行動：1ターンに1回。主人公・仲間の行動がすべて終わったあと、敵のターンの前に動く（battleLoop から beastTakeTurn を呼ぶ）
//   ・行動の選び方：エディタで登録した「行動の候補」（最大3つ）のうち、クールタイムが明けていて、使える条件を満たすものから、
//     重みに応じてランダムに選ぶ。使える候補が無ければ通常攻撃
//   ・敵は魔獣も狙う。ただし、主人公・仲間よりも狙われにくい（狙われる重みが半分）
//   ・倒れると、常時行動はできない。戦闘が終われば、魔獣の状態は捨てるので、次の戦闘では全回復で始まる
//   ・能力は、主人公のレベル・その魔獣の凸数・今のパーティでの相性から決まる（beast.js）。相性は、戦闘の開始時に判定して固定する
// ★魔獣は「仲間のふりをした入れ物」（isBeast:true の unit）として battleState.beast に持つ。
//   gauges.hp・alive・level・displayName を持たせてあるので、既存の仲間用の計算（能力値・自己バフ・回復・ブロック技のダメージ）を
//   そのまま使える。player.companions には入れない（入れると行動可能数・仲間用メニューなどに巻き込まれるため）
// ★連動（段階3）：仲間・主人公が技を使うと、きっかけに合う連動が「ボタン」で出る。タップかCキーで魔獣が追加行動する（常時行動は別に動く）。
//   ifの変数「相性」（相性の良い仲間がいれば1）も、ここで決めた beast.affinityActive を buildSkillExprContext（battle.js）が読む

const BEAST_TARGET_WEIGHT = 0.5;   // 敵に狙われる重み（主人公・仲間は1）

// ===== 戦闘開始時：セット中の魔獣を、戦闘用の入れ物にする =====
function beastBattleInit() {
  if (typeof battleState === "undefined" || !battleState) return;
  battleState.beast = null;
  const equipped = (typeof getEquippedBeast === "function") ? getEquippedBeast() : null;   // beast.js
  if (!equipped) return;
  const entry = equipped.entry;
  const level = Math.max(1, (typeof player !== "undefined" && player) ? player.level : 1);
  const stats = beastStatsAt(entry, level, equipped.breakCount, true);   // 相性は、この時点のパーティで判定して固定する
  const bonus = beastBonusSums(entry, equipped.breakCount, true);
  const name = beastName(entry);
  battleState.beast = {
    isBeast: true,
    beastId: entry.id, entry, breakCount: equipped.breakCount, level,
    name, displayName: name,
    stats, bonus,
    gauges: { hp: { current: stats.maxHp, max: stats.maxHp }, sp: { current: 0, max: 0 } },
    alive: true,
    affinityActive: (typeof beastAffinityList === "function") && beastAffinityList(entry).some(a => a.active),   // 相性の良い仲間がいるか。戦闘の開始時に固定（変数「相性」）
    cooldowns: {},     // { 行動id: あと何回、自分のターンを休むか }
    equipment: {}
  };
  battleState.beastLink = null;
  battleState.beastLinkLastSkill = null;
  beastLinkRender();
}

function beastActive() {
  return typeof battleState !== "undefined" && !!battleState && !!battleState.beast && battleState.beast.alive;
}

// ===== 行動の候補（エディタの idleActions）を、戦闘用の技にする =====
// 行動の威力（％）の分だけ威力を上乗せする。クールタイムは、短縮ぶんを引く（0未満にはならない）
function beastBuildActionSkill(beast, action) {
  const e = JSON.parse(JSON.stringify(action));
  e.power = Math.max(0, Math.round((Number(e.power) || 0) * (1 + (beast.bonus.actionPower || 0) / 100)));
  e.spCost = 0;
  const skill = buildRuntimeSkillFromSkillEntry(e);   // scenariobuild.js
  skill.limitBreak = beast.breakCount;                // ifブロックの式で「凸数」を使える（battle.js の buildSkillExprContext）
  skill._action = action;
  skill._cooldown = Math.max(0, Math.round((Number(action.cooldown) || 0) - (beast.bonus.cooldownCut || 0)));
  skill._weight = (action.weight === "" || action.weight == null || !Number.isFinite(Number(action.weight))) ? 1 : Math.max(0, Number(action.weight));
  return skill;
}

// 「使える条件」の式を評価する。空なら常に使える。式の変数は、技のブロックと同じもの＋魔獣用のもの
function beastConditionMet(beast, skill) {
  const text = skill._action && typeof skill._action.condition === "string" ? skill._action.condition.trim() : "";
  if (!text) return true;
  try {
    const ctx = buildSkillExprContext(skill, { variables: {}, target: beastPickTarget(), caster: beast });   // battle.js
    // 「味方」には、魔獣自身も含める（回復技の対象に魔獣が入るのと、合わせる）
    const allies = [player].concat((player.companions || []).filter(c => c.alive)).concat(beast.alive ? [beast] : []);
    if (beast.gauges.hp.max > 0) ctx["魔獣HP割合"] = beast.gauges.hp.current / beast.gauges.hp.max;
    ctx["味方最低HP割合"] = Math.min.apply(null, allies.map(u => u.gauges.hp.max ? u.gauges.hp.current / u.gauges.hp.max : 1));
    ctx["味方人数"] = allies.length;
    ctx["敵数"] = getAliveEnemies().length;
    return !!evaluateSkillExpression(text, ctx);   // battle.js
  } catch (error) {
    console.warn(`おとも魔獣「${beast.name}」の行動「${skill.name}」の条件式が評価できませんでした`, error);
    return false;
  }
}

// この回に使う行動を選ぶ。戻り値：技 または null（＝通常攻撃）
function beastChooseAction(beast) {
  const actions = Array.isArray(beast.entry.idleActions) ? beast.entry.idleActions : [];
  const candidates = actions
    .filter(a => a && a.enabled !== false)
    .map(a => beastBuildActionSkill(beast, a))
    .filter(skill => skill._weight > 0 && !(beast.cooldowns[skill._action.id] > 0) && beastConditionMet(beast, skill));
  if (candidates.length === 0) return null;
  const total = candidates.reduce((sum, skill) => sum + skill._weight, 0);
  let roll = Math.random() * total;
  for (const skill of candidates) { roll -= skill._weight; if (roll < 0) return skill; }
  return candidates[candidates.length - 1];
}

// ===== 魔獣のターン =====
// 戻り値：何か行動した＝true／動けなかった＝false。戦闘が終わる可能性があるので、呼び出し側（battleLoop）が勝敗を確認する
async function beastTakeTurn() {
  if (!beastActive()) return false;
  const beast = battleState.beast;
  if (getAliveEnemies().length === 0) return false;
  // 自分のターンが来るたびに、クールタイムを1つ進める（「N回休んでから、また使える」）
  Object.keys(beast.cooldowns).forEach(id => { if (beast.cooldowns[id] > 0) beast.cooldowns[id]--; });
  changeSpeaker("");
  const skill = beastChooseAction(beast);
  if (!skill) {
    await beastNormalAttack(beast);
  } else {
    beast.cooldowns[skill._action.id] = skill._cooldown > 0 ? skill._cooldown + 1 : 0;   // 使った直後の自分のターンでも、1つ進むぶんを足しておく
    await beastExecuteSkill(beast, skill);
  }
  updateBattleHud();
  return true;
}

// 狙う敵：いま画面で狙っている敵（なければ、生きている先頭の敵）。魔獣は自動で動くので、狙う相手は選ばせない
function beastPickTarget() {
  const current = getCurrentTarget();
  if (current && current.hp > 0) return current;
  return getAliveEnemies()[0] || null;
}

async function beastNormalAttack(beast) {
  const target = beastPickTarget();
  if (!target) return;
  const variance = Math.floor(Math.random() * 7) - 3;
  const raw = Math.max(1, applyCompanionAtkBonus(beast, beast.stats.atk) + variance);   // 仲間の通常攻撃と同じ式（battle.js）
  const result = resolveDamageForTarget(target, raw, beast.entry.element && beast.entry.element !== "無" ? beast.entry.element : undefined);
  target.hp = Math.max(0, target.hp - result.damage);
  await displayMessage(`${beast.displayName}の攻撃！ ${target.displayName}に${result.damage}のダメージ！`);
  updateBattleHud();
}

async function beastExecuteSkill(beast, skill) {
  if (skill.blocks && skill.blocks.length > 0) { await beastRunBlocks(beast, skill); return; }
  if (skill.type === "attack") { await beastAttackSkill(beast, skill); return; }
  if (skill.type === "heal") { await beastHealSkill(beast, skill); return; }
  // 固定項目で作れるのは、攻撃と回復だけ。それ以外（支援など）はブロックで組む。組まれていなければ、通常攻撃で代用する
  console.warn(`おとも魔獣「${beast.name}」の行動「${skill.name}」は、固定項目では対応していない種類（${skill.type}）です。ブロックで組んでください。通常攻撃で代用します`);
  await beastNormalAttack(beast);
}

// ブロックで組んだ行動。狙う相手が必要でも、選ばせずに beastPickTarget の敵を使う
async function beastRunBlocks(beast, skill) {
  changeSpeaker("");
  await displayMessage(`${beast.displayName}の「${skill.name}」！`, { allowSubFocus: true });
  const target = skillBlocksNeedSingleTarget(skill.blocks) ? beastPickTarget() : null;   // battle.js
  const context = { variables: { ...(skill.variables || {}) }, target, caster: beast };
  const outcome = await runSkillBlockList(skill.blocks, skill, context);   // battle.js
  if (typeof outcome === "string" && outcome.startsWith("JUMP:")) console.warn(`ジャンプブロックの行き先（id: ${outcome.slice(5)}）が、魔獣の行動「${skill.name}」の中に見つかりませんでした`);
}

// 攻撃技（固定項目）。ダメージの式は、仲間の攻撃技と同じ：レベル倍率×威力＋攻撃力(または魔力)×0.7（命中回数で割る）
async function beastAttackSkill(beast, skill) {
  const aliveEnemies = getAliveEnemies();
  const targets = skill.target === "all" ? aliveEnemies : [beastPickTarget()];
  if (!targets[0]) return;
  const hitCount = skill.hitCount || 1;
  const stats = getCompanionEffectiveStats(beast);   // player.js（isBeast なら beast.stats を返す）
  const baseAtkRaw = skill.atkType === "magical" ? stats.skillPower : stats.atk;
  const baseAtk = applyCompanionAtkBonus(beast, baseAtkRaw, skill.atkType === "magical");
  const levelMultiplier = 1 + (beast.level || 1) * 0.05;
  const isMultiAction = targets.length > 1 || hitCount > 1;
  const showFn = isMultiAction ? displayMessageAutoAdvance : displayMessage;
  let isFirstHit = true;
  const perTargetTotals = [];
  for (const target of targets) {
    if (!target) continue;
    let subtotal = 0;
    for (let i = 0; i < hitCount; i++) {
      if (target.hp <= 0) break;
      const variance = Math.floor(Math.random() * 7) - 3;
      const raw = Math.max(1, Math.round(levelMultiplier * (skill.power || 0)) + Math.round(Math.round(baseAtk * 0.7) / Math.max(1, hitCount)) + variance);
      const result = resolveDamageForTarget(target, raw, skill.element);
      target.hp = Math.max(0, target.hp - result.damage);
      subtotal += result.damage;
      const prefix = isFirstHit ? `${beast.displayName}の「${skill.name}」！ ` : "";
      isFirstHit = false;
      await showFn(result.blocked ? `${prefix}しかし、${target.displayName}には効いていないようだッ！` : `${prefix}${target.displayName}に${result.damage}のダメージ！`);
      updateBattleHud();
    }
    perTargetTotals.push(subtotal);
    for (const effect of [skill.statusEffect, skill.statusEffect2]) {
      if (target.hp > 0 && effect && Math.random() < (effect.chance != null ? effect.chance : 1)) {
        const applied = applyEnemyStatusEffectFromSkill(target, effect);   // battle.js
        if (applied) await showFn(`${target.displayName}は${applied}状態になった！`);
      }
    }
  }
  if (targets.length > 1 && perTargetTotals.length > 0) {
    await displayMessage(`平均${Math.round(perTargetTotals.reduce((a, b) => a + b, 0) / perTargetTotals.length)}のダメージを与えた！`);
  } else if (hitCount > 1 && perTargetTotals.length > 0) {
    await displayMessage(`合計${perTargetTotals[0]}のダメージを与えた！`);
  }
  if (skill.selfBuff) {
    const kind = applyCompanionSelfBuff(beast, skill.selfBuff);   // battle.js
    if (kind) await displayMessage(`${beast.displayName}は${kind}状態になった！`);
  }
}

// 回復技（固定項目）。回復量は威力そのまま。対象は、全体指定なら「主人公・生きている仲間・魔獣」全員、
// 単体指定なら「HPの割合が一番低い味方」（魔獣は自動で動くので、対象は選ばせない）
async function beastHealSkill(beast, skill) {
  const allies = [player].concat((player.companions || []).filter(c => c.alive)).concat(beast.alive ? [beast] : []);
  const ratio = u => (u.gauges.hp.max ? u.gauges.hp.current / u.gauges.hp.max : 1);
  const targets = (skill.partyWide || skill.target === "all") ? allies : [allies.slice().sort((a, b) => ratio(a) - ratio(b))[0]];
  const gaugeKey = skill.gauge === "sp" ? "sp" : "hp";
  const parts = [];
  targets.forEach(unit => {
    const healed = applyHealToUnit(unit, gaugeKey, skill.power || 0, !!skill.cleanse, false);   // player.js
    const label = unit === player ? "あなた" : (unit === beast ? beast.displayName : getCompanionDisplayName(unit));
    if (healed > 0) parts.push(`${label}：${gaugeKey === "sp" ? "SP" : "HP"}が${healed}回復した`);
  });
  await displayMessage(`${beast.displayName}の「${skill.name}」！ ${parts.length > 0 ? parts.join(" ") : "特に変化は無かった。"}`);
  renderStatusHUD();
  updateBattleHud();
}

// ===== 敵から狙われた時 =====
// 魔獣は、ダメージを直接受ける（属性耐性・防具は無い）。倒れたら、この戦闘中は動けない
async function beastReceiveEnemyAttack(enemy, damage) {
  const beast = battleState.beast;
  if (!beast || !beast.alive) return;
  beast.gauges.hp.current = Math.max(0, beast.gauges.hp.current - damage);
  if (typeof triggerCameraShake === "function") triggerCameraShake();
  updateBattleHud();
  await displayMessage(`${enemy.displayName}の攻撃！ ${beast.displayName}は${damage}のダメージを受けた！`);
  if (beast.gauges.hp.current <= 0 && beast.alive) {
    beast.alive = false;
    updateBattleHud();
    await displayMessage(`${beast.displayName}は倒れてしまった……！`);
  }
}

// ===== 戦闘画面の表示（左上の小さなパネル：見た目・名前・HP） =====
function updateBattleBeastHud() {
  const el = document.getElementById("battle-beast");
  if (!el) return;
  const beast = (typeof battleState !== "undefined" && battleState) ? battleState.beast : null;
  if (!beast) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  el.classList.remove("hidden");
  el.classList.toggle("battle-beast-down", !beast.alive);
  const percent = beast.gauges.hp.max > 0 ? Math.max(0, beast.gauges.hp.current / beast.gauges.hp.max * 100) : 0;
  // 作り直しの回数を減らすため、見た目は最初の1回だけ作り、名前とHPだけを更新する
  if (!el.dataset.beastId || el.dataset.beastId !== beast.beastId) {
    el.innerHTML = "";
    el.dataset.beastId = beast.beastId;
    el.appendChild(beastAvatarElement(beast.entry, 36));   // beast.js
    const info = document.createElement("div");
    info.className = "battle-beast-info";
    const nameEl = document.createElement("div"); nameEl.className = "battle-beast-name";
    const bar = document.createElement("div"); bar.className = "battle-beast-bar";
    const fill = document.createElement("div"); fill.className = "battle-beast-fill";
    bar.appendChild(fill);
    const valueEl = document.createElement("div"); valueEl.className = "battle-beast-value";
    info.appendChild(nameEl); info.appendChild(bar); info.appendChild(valueEl);
    el.appendChild(info);
  }
  el.querySelector(".battle-beast-name").textContent = `${beast.displayName}${beast.alive ? "" : "（戦闘不能）"}`;
  el.querySelector(".battle-beast-fill").style.width = `${percent}%`;
  el.querySelector(".battle-beast-value").textContent = `${beast.gauges.hp.current} / ${beast.gauges.hp.max}`;
}

function hideBattleBeastHud() {
  const linkEl = document.getElementById("battle-beast-links");
  if (linkEl) { linkEl.classList.add("hidden"); linkEl.innerHTML = ""; }
  const el = document.getElementById("battle-beast");
  if (!el) return;
  el.classList.add("hidden");
  el.innerHTML = "";
  delete el.dataset.beastId;
}

// ===================================================================
// ===== 連動（段階3） =====
// ===================================================================
// links の1つ＝技のデータ（常時行動と同じ作り）＋ { trigger:{kind:"name"|"element"|"type", value}, userKind:"any"|"player"|"companion", userCompanion,
//   cooldown, unlockBreak, enabled }。1ターンの発動回数の上限は、魔獣ごと（entry.linkMaxPerTurn。標準1）
const BEAST_LINK_WAIT_MS = 3000;   // ターン最後の行動のあと、ボタンを出したまま待つ時間

function beastLinkState() {
  if (typeof battleState === "undefined" || !battleState) return null;
  if (!battleState.beastLink) battleState.beastLink = { pending: [], cooldownUntil: {}, turnUses: { turn: 0, count: 0 }, busy: false, menuOpen: false, waiting: false, selecting: false, selIndex: 0 };
  return battleState.beastLink;
}
function beastLinkSetMenu(open) { const st = beastLinkState(); if (st) st.menuOpen = !!open; }

// この技が、連動のきっかけ・使った人に合うか
function beastLinkMatches(link, actorId, skill) {
  if (!link || !skill) return false;
  const t = link.trigger || {};
  const value = t.value == null ? "" : String(t.value);
  if (!value) return false;
  if (t.kind === "name") { if (skill.name !== value) return false; }
  else if (t.kind === "element") { if ((skill.element || "無") !== value) return false; }
  else if (t.kind === "type") { if (skill.type !== value) return false; }
  else return false;
  if (link.userKind === "player") return actorId === "player";
  if (link.userKind === "companion") return actorId !== "player" && actorId === link.userCompanion;
  return true;
}

// 技が使われたあと、出せる連動（最大2つ）を集める
function beastLinkCollect(actorId, skill) {
  const beast = battleState.beast;
  if (!beast || !beast.alive) return [];
  const st = beastLinkState();
  const turn = battleState.turnCount || 1;
  const limit = Math.max(1, Math.round(Number(beast.entry.linkMaxPerTurn) || 1));
  if (st.turnUses.turn === turn && st.turnUses.count >= limit) return [];
  const links = Array.isArray(beast.entry.links) ? beast.entry.links : [];
  return links
    .filter(l => l && l.enabled !== false && beast.breakCount >= (Number(l.unlockBreak) || 0) && turn >= (st.cooldownUntil[l.id] || 0) && beastLinkMatches(l, actorId, skill))
    .slice(0, 2).map(l => ({ link: l, skillName: skill.name }));
}

// 主人公・仲間の行動が1つ終わるたびに呼ぶ（battleLoop）。前のボタンを消し、いま使われた技に合う連動があれば出す
function beastLinkAfterAction() {
  const st = beastLinkState();
  if (!st) return;
  const last = battleState.beastLinkLastSkill;
  battleState.beastLinkLastSkill = null;
  st.selecting = false;
  st.pending = (last && beastActive()) ? beastLinkCollect(last.actor, last.skill) : [];
  beastLinkRender();
}

function beastLinkRender() {
  const el = document.getElementById("battle-beast-links");
  if (!el) return;
  const st = (typeof battleState !== "undefined" && battleState) ? battleState.beastLink : null;
  el.innerHTML = "";
  if (!st || st.pending.length === 0) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  st.pending.forEach((item, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "battle-beast-link-btn" + (st.selecting && st.selIndex === i ? " selected" : "");
    b.textContent = `${item.link.name || battleState.beast.displayName}と連動！ 発動可能！` + (st.pending.length > 1 ? "" : "（C）");
    b.onclick = () => beastLinkActivate(i);
    el.appendChild(b);
  });
}

function beastLinkEnemiesGone() { return getAliveEnemies().length === 0; }

// 連動を発動する。コマンド選択中・ターン最後の待ちの間だけ受け付ける
async function beastLinkActivate(index) {
  const st = beastLinkState();
  if (!st || st.busy || !beastActive()) return;
  if (!(st.menuOpen || st.waiting)) return;
  if (typeof isTextDisplaying !== "undefined" && isTextDisplaying) return;
  const item = st.pending[index];
  if (!item || beastLinkEnemiesGone()) return;
  const beast = battleState.beast;
  const turn = battleState.turnCount || 1;
  st.busy = true; st.pending = []; st.selecting = false;
  beastLinkRender();
  st.cooldownUntil[item.link.id] = turn + Math.max(0, Math.round(Number(item.link.cooldown) || 0)) + 1;   // クールタイムN：N回休んでから、また使える
  st.turnUses = { turn, count: (st.turnUses.turn === turn ? st.turnUses.count : 0) + 1 };
  const savedText = textVar.innerHTML;
  try {
    changeSpeaker("");
    await displayMessage(`${item.skillName}の技に合わせて、${beast.displayName}が動いた！`);
    const skill = beastBuildActionSkill(beast, item.link);
    await beastExecuteSkill(beast, skill);   // 連動の行動は、さらに別の連動を起こさない（battleState.beastLinkLastSkill を触らない）
    updateBattleHud();
  } catch (error) {
    console.warn("おとも魔獣の連動でエラーが出ました", error);
  } finally {
    st.busy = false;
    if (beastLinkEnemiesGone()) {
      // 連動で最後の敵を倒した：開いているコマンド選択を閉じて、battleLoop に勝利処理へ進んでもらう
      if (st.menuOpen && typeof finishChoice === "function") finishChoice({ text: "（連動で決着）", next: "__beast_link_abort__", beastLinkAbort: true });
    } else {
      textVar.innerHTML = savedText;   // コマンド選択中なら、元の文章（「〇〇の番だ」など）に戻す
    }
  }
}

// ターン最後の行動のあと、ボタンが出ていたら数秒だけ待つ（決定キーですぐ進める）
async function beastLinkEndOfRoundWait() {
  const st = beastLinkState();
  if (!st) return;
  if (st.pending.length === 0 || !beastActive() || beastLinkEnemiesGone()) { st.pending = []; beastLinkRender(); return; }
  st.waiting = true;
  await new Promise(resolve => {
    let elapsed = 0;
    const onKey = (e) => {
      if (KEY_CONFIG.decideKeys.includes(e.key) && !st.busy && !st.selecting && !isTextDisplaying) { e.preventDefault(); e.stopImmediatePropagation(); done(); }
    };
    const timer = setInterval(() => {
      if (!battleState || beastLinkEnemiesGone() || (st.pending.length === 0 && !st.busy)) { done(); return; }
      if (!st.busy && !st.selecting && !isTextDisplaying) elapsed += 100;
      if (elapsed >= BEAST_LINK_WAIT_MS) done();
    }, 100);
    function done() { clearInterval(timer); window.removeEventListener("keydown", onKey, true); resolve(); }
    window.addEventListener("keydown", onKey, true);
  });
  st.waiting = false;
  st.pending = [];
  beastLinkRender();
}

// ===== Cキー：ボタン1つなら押すだけで発動。2つなら、押している間は選択モード（↑↓で選び、離すと発動） =====
function beastLinkKeyReady() {
  const st = (typeof battleState !== "undefined" && battleState) ? battleState.beastLink : null;
  return !!st && st.pending.length > 0 && !st.busy && (st.menuOpen || st.waiting) && !(typeof isTextDisplaying !== "undefined" && isTextDisplaying);
}
window.addEventListener("keydown", (e) => {
  if (typeof battleState === "undefined" || !battleState || !battleState.beastLink) return;
  const st = battleState.beastLink;
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return;
  if (st.selecting) {
    if (e.key.indexOf("Arrow") === 0) {   // 選択モードの間は、矢印キーを戦闘のコマンドメニューに渡さない
      e.preventDefault(); e.stopImmediatePropagation();
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.repeat) {
        const n = st.pending.length;
        st.selIndex = (st.selIndex + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
        beastLinkRender();
      }
    }
    return;
  }
  if ((e.key === "c" || e.key === "C") && !e.repeat && beastLinkKeyReady()) {
    e.preventDefault(); e.stopImmediatePropagation();
    if (st.pending.length === 1) { beastLinkActivate(0); }
    else { st.selecting = true; st.selIndex = 0; beastLinkRender(); }
  }
}, true);
window.addEventListener("keyup", (e) => {
  if (e.key !== "c" && e.key !== "C") return;
  const st = (typeof battleState !== "undefined" && battleState) ? battleState.beastLink : null;
  if (!st || !st.selecting) return;
  const i = st.selIndex;
  st.selecting = false;
  beastLinkRender();
  beastLinkActivate(i);
}, true);
window.addEventListener("blur", () => {
  const st = (typeof battleState !== "undefined" && battleState) ? battleState.beastLink : null;
  if (st && st.selecting) { st.selecting = false; beastLinkRender(); }
});
