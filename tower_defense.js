// tower_defense.js
// ===================================================================
// ===== 冒険者協会「掃討作戦」迎撃モード（タワーディフェンス・最小版） =====
// ===================================================================
// ★施設編集タブで作れる「冒険者協会」タイプの施設（facility.type === "towerDefense"）の中身。
//   openCustomFacility（town.js）から openTowerDefenseFacility() が呼ばれる。
// ★今回は最小版：一本道・固定マス・ユニット4種・3ウェーブ・属性相性のみ。
//   （コンボ／中ボス／事前強化／出撃モード／ウェーブ数選択は、企画書の順に後から足す）
// ★ファイルの作り：
//   ・上半分＝ゲームの中身（状態の作成・1コマ進める処理）。画面に触れない作りなので単体で動作確認できる
//   ・下半分＝画面（オーバーレイ・描画・操作）と、施設のメニュー・報酬の受け渡し

let towerDefenseFacility = null;   // 今開いている冒険者協会のデータ（scenariobuild.jsのfacility）
let towerDefenseReturnTo = null;   // 「戻る」で呼ぶ関数

// ----- 調整用の数値（ここを書き換えるだけでバランスを変えられる） -----
const TD_WAVES = 3;                 // ウェーブ数（最小版は固定）
const TD_FIELD_W = 720;             // フィールドの広さ（内部座標）
const TD_FIELD_H = 400;
const TD_START_FUNDS = 160;         // 開始時の資金
const TD_WAVE_CLEAR_BONUS = 40;     // ウェーブをしのぐごとにもらえる資金
const TD_UNIT_MAX_LEVEL = 5;        // プレイ中のユニット強化の上限レベル
const TD_LEVEL_ATK_RATE = 0.2;      // レベルが1上がるごとに攻撃力＋20%
const TD_UPGRADE_COST_RATE = 0.7;   // 強化費用＝購入価格×この値×現在のレベル（レベルが上がるほど高くなる）
const TD_SPAWN_INTERVAL = 1.3;      // 敵が出てくる間隔（秒）
const TD_ENEMY_SPEED = 70;          // 敵の移動速度（内部座標/秒）
const TD_WAVE_HP_GROWTH = 0.5;      // ウェーブが進むごとの敵HPの増加率
const TD_BASE_HP_PER_ATK = 15;      // 拠点HP＝出てくる敵の平均攻撃力×この値（最低50）
const TD_CLEAR_GOLD_BASE = 100;     // クリア報酬（陳）の基本額
const TD_CLEAR_GOLD_PER_KILL = 5;   // 倒した数ごとの上乗せ

// 敵の通り道（左端から入って、右端がゴール＝拠点）
const TD_PATH = [[-30, 80], [620, 80], [620, 200], [100, 200], [100, 320], [750, 320]];
// ユニットを置ける固定マス（道の横）
const TD_SLOTS = [[200, 140], [420, 140], [680, 140], [40, 260], [250, 260], [470, 260], [360, 30], [560, 370]];
const TD_SLOT_RADIUS = 24;

// ----- 道の長さ・位置の計算 -----
const TD_PATH_INFO = (() => {
  const segs = [];
  let acc = 0;
  for (let i = 0; i < TD_PATH.length - 1; i++) {
    const [x1, y1] = TD_PATH[i];
    const [x2, y2] = TD_PATH[i + 1];
    const l = Math.hypot(x2 - x1, y2 - y1);
    segs.push({ x1, y1, x2, y2, l, start: acc });
    acc += l;
  }
  return { segs, total: acc };
})();

// 道の先頭からの距離 d にいる時の座標
function tdPathPosition(d) {
  const info = TD_PATH_INFO;
  if (d <= 0) return { x: info.segs[0].x1, y: info.segs[0].y1 };
  for (const seg of info.segs) {
    if (d <= seg.start + seg.l) {
      const t = (d - seg.start) / seg.l;
      return { x: seg.x1 + (seg.x2 - seg.x1) * t, y: seg.y1 + (seg.y2 - seg.y1) * t };
    }
  }
  const last = info.segs[info.segs.length - 1];
  return { x: last.x2, y: last.y2 };
}

// ===== 属性相性 =====
// ★本編（battle.js）と同じルール：特攻＝1.5倍、耐性＝0.5倍。敵の属性は複数持てるので、それぞれ掛け合わせる。
//   属性相性を無視する敵（ignoreElementalAffinity）や、属性なしの攻撃は等倍
function tdElementMultiplier(attackElementId, enemy) {
  if (!attackElementId || attackElementId === "無") return 1;
  if (!enemy || enemy.ignoreAffinity) return 1;
  const defs = Array.isArray(enemy.elements) ? enemy.elements : [];
  if (defs.length === 0) return 1;
  const matchups = (typeof scenarioProject !== "undefined" && scenarioProject && scenarioProject.elementMatchups) ? scenarioProject.elementMatchups : {};
  let multiplier = 1;
  defs.forEach(defId => {
    const relation = matchups[attackElementId + ">" + defId];
    if (relation === "advantage") multiplier *= 1.5;
    else if (relation === "resist") multiplier *= 0.5;
  });
  return multiplier;
}

// ===== ユニットの種類 =====
// ★属性は、シナリオエディタの「属性管理」にある属性を順番に割り当てる（属性が増えたら自動で反映される）。
//   与ダメージは「出てくる敵の平均HP」に対する割合で決めるので、敵のデータが変わってもバランスが崩れにくい
function tdBuildUnitTemplates() {
  const defs = (typeof scenarioProject !== "undefined" && scenarioProject && Array.isArray(scenarioProject.elementDefs) && scenarioProject.elementDefs.length > 0)
    ? scenarioProject.elementDefs
    : [{ id: "無", name: "無" }];
  const el = i => defs[i % defs.length];
  return [
    { key: "archer", label: `${el(0).name}の弓兵`, roleLabel: "単体", roleChar: "単", element: el(0).id, role: "single", dmgRatio: 0.22, range: 140, interval: 0.8, cost: 50 },
    { key: "mage",   label: `${el(1).name}の術師`, roleLabel: "範囲", roleChar: "範", element: el(1).id, role: "area",   dmgRatio: 0.16, range: 120, interval: 1.4, splash: 55, cost: 80 },
    { key: "frost",  label: `${el(2).name}の妨害師`, roleLabel: "遅延", roleChar: "遅", element: el(2).id, role: "slow", dmgRatio: 0.07, range: 120, interval: 1.0, slowRate: 0.5, slowSec: 1.5, cost: 70 },
    { key: "cannon", label: `${el(3).name}の砲手`, roleLabel: "単体", roleChar: "砲", element: el(3).id, role: "single", dmgRatio: 0.6, range: 190, interval: 2.4, cost: 120 }
  ];
}

// ===== 出てくる敵 =====
// ★本編の魔物（MONSTER_MASTER）をそのまま使う。ボスは除き、体力の低い順に数種類だけ使う（最小版）
function tdGetEnemyPool() {
  if (typeof MONSTER_MASTER === "undefined") return [];
  const bossIds = new Set();
  if (typeof BOSS_MASTER !== "undefined") Object.keys(BOSS_MASTER).forEach(k => bossIds.add(k));
  if (typeof scenarioProject !== "undefined" && scenarioProject && Array.isArray(scenarioProject.bosses)) scenarioProject.bosses.forEach(b => bossIds.add(b.id));
  const keys = Object.keys(MONSTER_MASTER).filter(k => {
    const m = MONSTER_MASTER[k];
    return m && Number(m.maxHp) > 0 && !bossIds.has(k) && k !== "trial_guardian";
  });
  keys.sort((a, b) => Number(MONSTER_MASTER[a].maxHp) - Number(MONSTER_MASTER[b].maxHp));
  return keys.slice(0, 5);
}

// ===== ゲームの状態 =====
function tdCreateState(pool) {
  const masters = pool.map(k => MONSTER_MASTER[k]);
  const avg = f => masters.reduce((s, m) => s + (Number(f(m)) || 0), 0) / Math.max(1, masters.length);
  const refHp = Math.max(1, avg(m => m.maxHp));
  const refAtk = Math.max(1, avg(m => m.atk));
  const baseMaxHp = Math.max(50, Math.round(refAtk * TD_BASE_HP_PER_ATK));
  return {
    pool, refHp,
    templates: tdBuildUnitTemplates(),
    phase: "prep",            // prep＝準備中／wave＝ウェーブ進行中／won／lost
    wave: 1, wavesTotal: TD_WAVES,
    funds: TD_START_FUNDS,
    baseMaxHp, baseHp: baseMaxHp,
    kills: 0, time: 0, speed: 1,
    units: [],                // { slot, tpl, level, cool }
    enemies: [],
    spawnQueue: [], spawnTimer: 0,
    fx: [], popups: []        // 画面に出す演出（撃った線・ダメージ数字）
  };
}

function tdSlotPos(slotIndex) { return { x: TD_SLOTS[slotIndex][0], y: TD_SLOTS[slotIndex][1] }; }

function tdUnitDamage(st, unit) {
  return unit.tpl.dmgRatio * st.refHp * (1 + TD_LEVEL_ATK_RATE * (unit.level - 1));
}

function tdUpgradeCost(unit) {
  return Math.round(unit.tpl.cost * TD_UPGRADE_COST_RATE * unit.level);
}

// ウェーブを始める（そのウェーブに出る敵を並べる）
function tdStartWave(st) {
  if (st.phase !== "prep") return false;
  const usable = st.pool.slice(0, Math.min(st.pool.length, 2 + st.wave));
  const count = 8 + 4 * (st.wave - 1);
  st.spawnQueue = [];
  for (let i = 0; i < count; i++) st.spawnQueue.push(usable[Math.floor(Math.random() * usable.length)]);
  st.spawnTimer = 0;
  st.phase = "wave";
  return true;
}

function tdPlaceUnit(st, slotIndex, templateKey) {
  if (st.units.some(u => u.slot === slotIndex)) return { ok: false, reason: "そこにはもう置いてある" };
  const tpl = st.templates.find(t => t.key === templateKey);
  if (!tpl) return { ok: false, reason: "ユニットが選ばれていない" };
  if (st.funds < tpl.cost) return { ok: false, reason: "資金が足りない" };
  st.funds -= tpl.cost;
  st.units.push({ slot: slotIndex, tpl, level: 1, cool: 0 });
  return { ok: true };
}

function tdUpgradeUnit(st, unit) {
  if (unit.level >= TD_UNIT_MAX_LEVEL) return { ok: false, reason: "これ以上強化できない" };
  const cost = tdUpgradeCost(unit);
  if (st.funds < cost) return { ok: false, reason: "資金が足りない" };
  st.funds -= cost;
  unit.level++;
  return { ok: true };
}

function tdSpawnEnemy(st, key) {
  const m = MONSTER_MASTER[key];
  const hp = Math.max(1, Math.round((Number(m.maxHp) || 10) * (1 + TD_WAVE_HP_GROWTH * (st.wave - 1))));
  const pos = tdPathPosition(0);
  st.enemies.push({
    key, name: m.name || key, hp, maxHp: hp,
    atk: Math.max(1, Number(m.atk) || 1),                      // ゴールした時に拠点HPが減る量（本編の攻撃力そのまま）
    elements: Array.isArray(m.elements) ? m.elements : [],
    ignoreAffinity: !!m.ignoreElementalAffinity,
    imagePath: m.imagePath || null,
    speed: TD_ENEMY_SPEED * (0.9 + Math.random() * 0.2),
    dist: 0, x: pos.x, y: pos.y,
    slowUntil: 0, slowRate: 1,
    reward: Math.max(6, Math.round((Number(m.exp) || 10) * 0.8)) // 倒した時にもらえる資金
  });
}

// 1コマ進める（dt＝経過秒。倍速の時は呼ぶ側で掛けておく）
function tdStep(st, dt) {
  st.time += dt;
  // 演出の寿命
  st.fx.forEach(f => { f.t -= dt; });
  st.fx = st.fx.filter(f => f.t > 0);
  st.popups.forEach(p => { p.t -= dt; });
  st.popups = st.popups.filter(p => p.t > 0);
  if (st.phase !== "wave") return;
  
  // 敵の出現
  if (st.spawnQueue.length > 0) {
    st.spawnTimer -= dt;
    if (st.spawnTimer <= 0) {
      tdSpawnEnemy(st, st.spawnQueue.shift());
      st.spawnTimer = TD_SPAWN_INTERVAL;
    }
  }
  
  // 敵の移動（ゴールしたら拠点HPが減る）
  st.enemies.forEach(e => {
    const slowed = e.slowUntil > st.time;
    e.dist += e.speed * (slowed ? e.slowRate : 1) * dt;
    if (e.dist >= TD_PATH_INFO.total) {
      e.reached = true;
      st.baseHp -= e.atk;
      st.popups.push({ x: 690, y: 300, text: `-${e.atk}`, color: "#ff5a5a", weak: false, t: 0.8 });
    } else {
      const pos = tdPathPosition(e.dist);
      e.x = pos.x; e.y = pos.y;
    }
  });
  st.enemies = st.enemies.filter(e => !e.reached);
  
  // ユニットの攻撃（ゴールに一番近い敵を狙う）
  st.units.forEach(u => {
    u.cool -= dt;
    if (u.cool > 0) return;
    const sp = tdSlotPos(u.slot);
    let target = null;
    st.enemies.forEach(e => {
      if (e.hp <= 0) return;
      if (Math.hypot(e.x - sp.x, e.y - sp.y) > u.tpl.range) return;
      if (!target || e.dist > target.dist) target = e;
    });
    if (!target) { u.cool = 0; return; }
    tdFire(st, u, target, sp);
    u.cool = u.tpl.interval;
  });
  
  // 倒した敵の処理
  const alive = [];
  st.enemies.forEach(e => {
    if (e.hp > 0) { alive.push(e); return; }
    st.funds += e.reward;
    st.kills++;
    st.popups.push({ x: e.x, y: e.y - 20, text: `+${e.reward}`, color: "#ffd23f", weak: false, t: 0.8 });
  });
  st.enemies = alive;
  
  // 勝ち負けの判定
  if (st.baseHp <= 0) {
    st.baseHp = 0;
    st.phase = "lost";
    return;
  }
  if (st.spawnQueue.length === 0 && st.enemies.length === 0) {
    if (st.wave >= st.wavesTotal) {
      st.phase = "won";
    } else {
      st.funds += TD_WAVE_CLEAR_BONUS;
      st.wave++;
      st.phase = "prep";
    }
  }
}

function tdFire(st, unit, target, from) {
  const tpl = unit.tpl;
  const base = tdUnitDamage(st, unit);
  const hits = tpl.role === "area"
    ? st.enemies.filter(e => e.hp > 0 && Math.hypot(e.x - target.x, e.y - target.y) <= tpl.splash)
    : [target];
  const color = (typeof getElementColor === "function") ? getElementColor(tpl.element) : "#ffffff";
  hits.forEach(e => {
    const mult = tdElementMultiplier(tpl.element, e);
    const dmg = Math.max(1, Math.round(base * mult));
    e.hp -= dmg;
    st.popups.push({ x: e.x + (Math.random() * 14 - 7), y: e.y - 16, text: String(dmg), color: mult > 1 ? "#ffffff" : (mult < 1 ? "#9aa4ad" : color), weak: mult > 1, resist: mult < 1, t: 0.6 });
    if (tpl.role === "slow") { e.slowUntil = st.time + tpl.slowSec; e.slowRate = tpl.slowRate; }
  });
  st.fx.push({ kind: "line", x1: from.x, y1: from.y, x2: target.x, y2: target.y, color, t: 0.12 });
  if (tpl.role === "area") st.fx.push({ kind: "ring", x1: target.x, y1: target.y, r: tpl.splash, color, t: 0.2 });
}

// ===================================================================
// ===== ここから下は画面（オーバーレイ・描画・操作）と施設のメニュー =====
// ===================================================================

const tdImageCache = {};
function tdGetImage(src) {
  if (!tdImageCache[src]) {
    const entry = { img: new Image(), ok: false };
    entry.img.onload = () => { entry.ok = true; };
    entry.img.onerror = () => { entry.ok = false; };
    entry.img.src = src;
    tdImageCache[src] = entry;
  }
  return tdImageCache[src];
}

function tdElementColor(elementId) {
  return (typeof getElementColor === "function") ? getElementColor(elementId) : "#ffffff";
}

// ミニゲーム本体。終わったら { result: "win" | "lose" | "quit", kills, wave } を返す
function runTowerDefenseBattle(pool) {
  return new Promise(resolve => {
    const st = tdCreateState(pool);
    let finished = false;
    let selectedType = null;   // 配置しようとしているユニットの種類（key）
    let selectedSlot = null;   // 選んでいる配置済みユニットのマス
    let infoNote = "";         // 一時的なお知らせ（資金不足など）
    let quitArmed = false, quitTimer = null;
    let rafId = null, lastTs = null;
    
    const overlay = document.createElement("div");
    overlay.className = "td-overlay";
    overlay.innerHTML = `
      <div class="td-panel">
        <div class="td-header">
          <span class="td-title">掃討作戦（迎撃）</span>
          <span class="td-wave"></span>
          <span class="td-funds"></span>
        </div>
        <div class="td-basehp"><div class="td-basehp-fill"></div><span class="td-basehp-text"></span></div>
        <canvas class="td-canvas" width="${TD_FIELD_W * 2}" height="${TD_FIELD_H * 2}"></canvas>
        <div class="td-info"></div>
        <div class="td-units"></div>
        <div class="td-controls">
          <button type="button" class="td-btn td-btn-start"></button>
          <button type="button" class="td-btn td-btn-speed"></button>
          <button type="button" class="td-btn td-btn-quit"></button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    
    const canvas = overlay.querySelector(".td-canvas");
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);
    const waveEl = overlay.querySelector(".td-wave");
    const fundsEl = overlay.querySelector(".td-funds");
    const baseFillEl = overlay.querySelector(".td-basehp-fill");
    const baseTextEl = overlay.querySelector(".td-basehp-text");
    const infoEl = overlay.querySelector(".td-info");
    const unitsEl = overlay.querySelector(".td-units");
    const startBtn = overlay.querySelector(".td-btn-start");
    const speedBtn = overlay.querySelector(".td-btn-speed");
    const quitBtn = overlay.querySelector(".td-btn-quit");
    
    // ユニット選択ボタン
    st.templates.forEach(tpl => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "td-unit-btn";
      btn.dataset.key = tpl.key;
      btn.style.borderColor = tdElementColor(tpl.element);
      btn.innerHTML = `<span class="td-unit-name">${tpl.label}</span><span class="td-unit-meta">${tpl.roleLabel}　${tpl.cost}</span>`;
      btn.onclick = () => {
        selectedType = (selectedType === tpl.key) ? null : tpl.key;
        selectedSlot = null; infoNote = "";
        refreshUI();
      };
      unitsEl.appendChild(btn);
    });
    
    function refreshUI() {
      waveEl.textContent = `WAVE ${st.wave}/${st.wavesTotal}`;
      fundsEl.textContent = `資金 ${st.funds}`;
      const ratio = Math.max(0, st.baseHp) / st.baseMaxHp;
      baseFillEl.style.width = `${Math.round(ratio * 100)}%`;
      baseTextEl.textContent = `拠点HP ${Math.max(0, Math.round(st.baseHp))}/${st.baseMaxHp}`;
      
      unitsEl.querySelectorAll(".td-unit-btn").forEach(btn => {
        const tpl = st.templates.find(t => t.key === btn.dataset.key);
        btn.classList.toggle("td-selected", selectedType === tpl.key);
        btn.classList.toggle("td-disabled", st.funds < tpl.cost);
      });
      
      startBtn.textContent = st.phase === "prep" ? `WAVE ${st.wave} 開始` : (st.phase === "wave" ? "迎撃中……" : "終了");
      startBtn.disabled = st.phase !== "prep";
      speedBtn.textContent = `速度 ×${st.speed}`;
      quitBtn.textContent = quitArmed ? "本当にやめる？" : "やめる";
      
      // 情報行
      const unit = selectedSlot !== null ? st.units.find(u => u.slot === selectedSlot) : null;
      if (infoNote) {
        infoEl.textContent = infoNote;
      } else if (unit) {
        const tpl = unit.tpl;
        const maxed = unit.level >= TD_UNIT_MAX_LEVEL;
        infoEl.innerHTML = "";
        const text = document.createElement("span");
        text.textContent = `${tpl.label} Lv${unit.level}　攻撃${Math.round(tdUnitDamage(st, unit))}　射程${tpl.range}`;
        infoEl.appendChild(text);
        const up = document.createElement("button");
        up.type = "button";
        up.className = "td-btn td-btn-upgrade";
        up.textContent = maxed ? "最大Lv" : `強化 ${tdUpgradeCost(unit)}`;
        up.disabled = maxed || st.funds < tdUpgradeCost(unit);
        up.onclick = () => {
          const r = tdUpgradeUnit(st, unit);
          infoNote = r.ok ? "" : r.reason;
          refreshUI();
        };
        infoEl.appendChild(up);
      } else if (selectedType) {
        const tpl = st.templates.find(t => t.key === selectedType);
        infoEl.textContent = `${tpl.label}（${tpl.roleLabel}）：置きたい白い枠をタップ`;
      } else {
        infoEl.textContent = "下から仲間を選んで、白い枠に配置しよう。黄色い数字＝弱点、灰色＝耐性。";
      }
    }
    
    // ----- 操作 -----
    function toField(ev) {
      const rect = canvas.getBoundingClientRect();
      return { x: (ev.clientX - rect.left) / rect.width * TD_FIELD_W, y: (ev.clientY - rect.top) / rect.height * TD_FIELD_H };
    }
    canvas.addEventListener("pointerdown", ev => {
      ev.preventDefault();
      if (finished || st.phase === "won" || st.phase === "lost") return;
      const p = toField(ev);
      const slotIndex = TD_SLOTS.findIndex(s => Math.hypot(p.x - s[0], p.y - s[1]) <= TD_SLOT_RADIUS + 8);
      infoNote = "";
      if (slotIndex < 0) { selectedSlot = null; selectedType = null; refreshUI(); return; }
      const existing = st.units.find(u => u.slot === slotIndex);
      if (existing) { selectedSlot = slotIndex; selectedType = null; refreshUI(); return; }
      if (selectedType) {
        const r = tdPlaceUnit(st, slotIndex, selectedType);
        if (!r.ok) infoNote = r.reason;
      } else {
        infoNote = "先に下から配置する仲間を選んでください";
      }
      refreshUI();
    });
    startBtn.onclick = () => { if (tdStartWave(st)) { infoNote = ""; refreshUI(); } };
    speedBtn.onclick = () => { st.speed = st.speed === 1 ? 2 : 1; refreshUI(); };
    quitBtn.onclick = () => {
      if (!quitArmed) {
        quitArmed = true;
        quitTimer = setTimeout(() => { quitArmed = false; refreshUI(); }, 3000);
        refreshUI();
        return;
      }
      finish("quit");
    };
    
    // ----- 描画 -----
    function draw() {
      ctx.clearRect(0, 0, TD_FIELD_W, TD_FIELD_H);
      ctx.fillStyle = "#10151c";
      ctx.fillRect(0, 0, TD_FIELD_W, TD_FIELD_H);
      
      // 道
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      TD_PATH.forEach((p, i) => i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]));
      ctx.strokeStyle = "#000"; ctx.lineWidth = 44; ctx.stroke();
      ctx.strokeStyle = "#d8c7a0"; ctx.lineWidth = 36; ctx.stroke();
      // ゴール（拠点）
      ctx.fillStyle = "#ff5a5a"; ctx.fillRect(TD_FIELD_W - 14, 296, 14, 48);
      ctx.fillStyle = "#fff"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "right";
      ctx.fillText("拠点", TD_FIELD_W - 18, 292);
      
      // 配置マス
      TD_SLOTS.forEach((s, i) => {
        const occupied = st.units.some(u => u.slot === i);
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = occupied ? "rgba(255,255,255,0.25)" : "#ffffff";
        ctx.lineWidth = 2;
        ctx.strokeRect(s[0] - TD_SLOT_RADIUS, s[1] - TD_SLOT_RADIUS, TD_SLOT_RADIUS * 2, TD_SLOT_RADIUS * 2);
        ctx.setLineDash([]);
      });
      
      // 選択中ユニットの射程
      if (selectedSlot !== null) {
        const u = st.units.find(x => x.slot === selectedSlot);
        if (u) {
          const sp = tdSlotPos(u.slot);
          ctx.beginPath(); ctx.arc(sp.x, sp.y, u.tpl.range, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.fill();
          ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();
        }
      }
      
      // ユニット
      st.units.forEach(u => {
        const sp = tdSlotPos(u.slot);
        const color = tdElementColor(u.tpl.element);
        ctx.beginPath(); ctx.arc(sp.x, sp.y, 19, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = (u.slot === selectedSlot) ? "#ffd23f" : "#fff"; ctx.stroke();
        ctx.fillStyle = "#111"; ctx.font = "bold 16px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(u.tpl.roleChar, sp.x, sp.y + 1);
        if (u.level > 1) {
          ctx.fillStyle = "#000"; ctx.fillRect(sp.x + 6, sp.y + 8, 22, 13);
          ctx.fillStyle = "#ffd23f"; ctx.font = "bold 10px sans-serif"; ctx.fillText(`Lv${u.level}`, sp.x + 17, sp.y + 15);
        }
      });
      
      // 撃った演出
      st.fx.forEach(f => {
        ctx.globalAlpha = Math.min(1, f.t / 0.12);
        ctx.strokeStyle = f.color; ctx.lineWidth = 3;
        if (f.kind === "line") { ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke(); }
        else { ctx.beginPath(); ctx.arc(f.x1, f.y1, f.r, 0, Math.PI * 2); ctx.stroke(); }
        ctx.globalAlpha = 1;
      });
      
      // 敵
      st.enemies.forEach(e => {
        const size = 34;
        const src = e.imagePath || `img/敵/${e.name}.png`;
        const entry = tdGetImage(src);
        const ringColor = e.elements.length > 0 ? tdElementColor(e.elements[0]) : "#ffffff";
        if (entry.ok) {
          ctx.drawImage(entry.img, e.x - size / 2, e.y - size / 2, size, size);
        } else {
          ctx.beginPath(); ctx.arc(e.x, e.y, size / 2 - 2, 0, Math.PI * 2);
          ctx.fillStyle = "#5b6b7a"; ctx.fill();
          ctx.fillStyle = "#fff"; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(String(e.name).charAt(0), e.x, e.y + 1);
        }
        ctx.beginPath(); ctx.arc(e.x, e.y, size / 2, 0, Math.PI * 2);
        ctx.strokeStyle = ringColor; ctx.lineWidth = 2.5; ctx.stroke();
        if (e.slowUntil > st.time) { ctx.fillStyle = "#9be8ff"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.fillText("遅", e.x, e.y + size / 2 + 10); }
        // HPバー
        ctx.fillStyle = "#000"; ctx.fillRect(e.x - 17, e.y - 28, 34, 6);
        ctx.fillStyle = "#59e07a"; ctx.fillRect(e.x - 16, e.y - 27, 32 * Math.max(0, e.hp / e.maxHp), 4);
      });
      
      // ダメージ数字
      st.popups.forEach(p => {
        const rise = (1 - Math.min(1, p.t / 0.8)) * 14;
        ctx.globalAlpha = Math.min(1, p.t / 0.3);
        ctx.font = p.weak ? "bold 16px sans-serif" : "bold 13px sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.lineWidth = 3; ctx.strokeStyle = "#000"; ctx.strokeText(p.text, p.x, p.y - rise);
        ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, p.y - rise);
        ctx.globalAlpha = 1;
      });
      
      // 準備中の案内
      if (st.phase === "prep") {
        ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, TD_FIELD_W, 34);
        ctx.fillStyle = "#ffd23f"; ctx.font = "bold 16px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(`WAVE ${st.wave} の準備中：仲間を配置して「開始」`, TD_FIELD_W / 2, 17);
      }
    }
    
    // ----- メインループ -----
    let uiAccum = 0;
    function frame(ts) {
      if (finished) return;
      if (lastTs === null) lastTs = ts;
      const realDt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;
      const prevPhase = st.phase;
      tdStep(st, realDt * st.speed);
      uiAccum += realDt;
      if (st.phase !== prevPhase || uiAccum > 0.15) { uiAccum = 0; refreshUI(); }
      draw();
      if (st.phase === "won" || st.phase === "lost") {
        setTimeout(() => finish(st.phase === "won" ? "win" : "lose"), 700);
        // 二重に呼ばれないよう、ループはここで止める（画面は最後の状態のまま）
        return;
      }
      rafId = requestAnimationFrame(frame);
    }
    
    function finish(result) {
      if (finished) return;
      finished = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (quitTimer) clearTimeout(quitTimer);
      overlay.remove();
      resolve({ result, kills: st.kills, wave: st.wave });
    }
    
    refreshUI();
    draw();
    rafId = requestAnimationFrame(frame);
  });
}

// ===== 施設のメニュー =====
// 冒険者協会の入り口。openCustomFacility（town.js）から呼ばれる
function openTowerDefenseFacility(facility, returnTo) {
  towerDefenseFacility = facility;
  towerDefenseReturnTo = typeof returnTo === "function" ? returnTo : openTownMenu;
  showTowerDefenseMainMenu();
}

// 協会のトップ。今後ほかの機能を足す時は、ここに項目を増やす
function showTowerDefenseMainMenu() {
  const options = [
    { label: "掃討作戦", action: () => showTowerDefenseModeMenu() },
    { label: "戻る", action: () => towerDefenseReturnTo() }
  ];
  showLocationMenu(options, (towerDefenseFacility && towerDefenseFacility.name) || "冒険者協会");
}

// 掃討作戦のモード選択（迎撃＝守る側／出撃＝攻める側）
function showTowerDefenseModeMenu() {
  const options = [
    { label: "迎撃モード（守る）", action: () => startTowerDefenseDefense() },
    { label: "出撃モード（攻める）※準備中", action: async () => {
        hideLocationMenu();
        changeSpeaker("");
        await displayMessage("出撃モードは、まだ準備中のようだ。");
        showTowerDefenseModeMenu();
      } },
    { label: "戻る", action: () => showTowerDefenseMainMenu() }
  ];
  showLocationMenu(options, "掃討作戦");
}

async function startTowerDefenseDefense() {
  hideLocationMenu();
  changeSpeaker("");
  const pool = tdGetEnemyPool();
  if (pool.length === 0) {
    await displayMessage("……掃討する魔物の情報が見当たらない。");
    showTowerDefenseModeMenu();
    return;
  }
  const outcome = await runTowerDefenseBattle(pool);
  changeSpeaker("");
  if (outcome.result === "win") {
    const reward = TD_CLEAR_GOLD_BASE + outcome.kills * TD_CLEAR_GOLD_PER_KILL;
    changeGold(reward);
    await displayMessage(`掃討作戦、成功！　${outcome.kills}体を討ち取り、報酬として${reward}陳を受け取った。`);
  } else if (outcome.result === "lose") {
    await displayMessage("拠点が陥落してしまった……。今回は報酬なしだ。");
  }
  showTowerDefenseModeMenu();
}
