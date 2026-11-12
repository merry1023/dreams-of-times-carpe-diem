// effectmix.js
// ===================================================================
// ===== エフェクトミックス（ベースエフェクトを混ぜ合わせて作る演出） =====
// ===================================================================
// ★考え方
//   ・「ベースエフェクト」＝コードで描く基本の演出パーツ（弾・光線・爆発・リング・火花・光柱・渦・稲妻）。
//   ・「ミックス」＝ベースエフェクトを何枚か重ねたもの（レイヤー）。各レイヤーに、色・大きさ・開始のずれ・長さ・数・濃さを決められる。
//   ・ミックスは scenarioProject.effectMixes に入る（シナリオエディタの「エフェクトミックス」タブで作る）。
//   ・技などへのアタッチ：技のデータに effectMixId を持たせる（今は タワーユニット／スキルカード・出撃キャラ・コンボスキル）。
//     通常戦闘（battle.js）に付ける時も、下の efxSpawn / efxDraw をそのまま使える（描画先は Canvas 2D）。
// ★使い方（ゲーム側）
//   efxSpawn(list, mixId, from, to, color)  … list（st.fx など）に演出を1つ足す。ミックスが無い／無効なら false を返す（呼ぶ側は元の演出に戻す）
//   efxDraw(ctx, f)                         … list の要素 f（kind === "mix"）を描く。寿命 f.t を呼ぶ側が毎フレーム減らす（tdStep と同じ）
//   efxIsMix(f)                             … f がミックスの演出かどうか
// ★from＝撃った側の位置、to＝当たった側の位置（{x, y}）。色は color（属性色）。レイヤーの色が「属性色」なら color が使われる

const EFX_BASE_DEFS = [
  { id: "bolt",      label: "弾（飛んでいく光）",   note: "撃った位置から当たる位置へ飛ぶ。数を増やすと連射になる" },
  { id: "beam",      label: "光線",                 note: "撃った位置から当たる位置へ、一瞬で伸びて細くなる" },
  { id: "lightning", label: "稲妻",                 note: "ギザギザの線が、撃った位置から当たる位置へ走る" },
  { id: "burst",     label: "爆発（広がる光）",     note: "丸い光がふくらんで消える" },
  { id: "ring",      label: "衝撃波リング",         note: "輪が広がって消える" },
  { id: "sparks",    label: "火花（散る粒）",       note: "細かい粒が放射状に散る。数で量を決める" },
  { id: "pillar",    label: "光柱",                 note: "地面から縦に光が立ち上がる" },
  { id: "swirl",     label: "渦",                   note: "回りながら広がる弧" }
];
// 位置の基準（飛ぶ系の弾・光線・稲妻は、常に「撃った位置→当たる位置」なので、この指定は使わない）
const EFX_ANCHOR_OPTIONS = [
  { value: "to",   label: "当たった位置" },
  { value: "from", label: "撃った位置" }
];
const EFX_TRAVEL_BASES = ["bolt", "beam", "lightning"];
const EFX_LAYER_MAX = 8;       // 1つのミックスに重ねられる数
const EFX_MIX_MAX_SEC = 3;     // 1つのミックスの最大の長さ（秒）

function efxBaseDef(id) { return EFX_BASE_DEFS.find(d => d.id === id) || null; }

function efxClamp(v, min, max, fallback) {
  const n = Number(v);
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : fallback));
}

// レイヤーの初期値
function efxNewLayer(base) {
  return { base: base || "burst", anchor: "to", color: "element", customColor: "#ffffff", size: 1, delay: 0, duration: 0.4, count: 6, alpha: 1, glow: true };
}

// ミックスの初期値（generateId は scenariobuild.js のもの。無い時は簡易id）
function efxNewMix(name) {
  const id = (typeof generateId === "function") ? generateId("effectmix") : ("effectmix_" + Date.now());
  return { id, name: name || "新しいエフェクト", enabled: true, layers: [efxNewLayer("burst")] };
}

// 標準のミックス（エディタの「標準のエフェクトを登録する」ボタン用）。名前で重複判定する
function efxBuildDefaultMixes() {
  const L = (base, o) => Object.assign(efxNewLayer(base), o || {});
  const defs = [
    { name: "炎の爆発", layers: [L("bolt", { duration: 0.25, size: 1.1 }), L("burst", { delay: 0.2, duration: 0.45, size: 1.3 }), L("sparks", { delay: 0.2, duration: 0.5, count: 12 }), L("ring", { delay: 0.22, duration: 0.4 })] },
    { name: "雷撃", layers: [L("lightning", { duration: 0.3, size: 1.2, color: "custom", customColor: "#fff27a" }), L("burst", { delay: 0.1, duration: 0.3, size: 0.8 }), L("sparks", { delay: 0.1, duration: 0.35, count: 10, color: "custom", customColor: "#ffffff" })] },
    { name: "氷の槍", layers: [L("bolt", { duration: 0.22, count: 3, size: 0.9 }), L("ring", { delay: 0.2, duration: 0.45, size: 1.1 }), L("sparks", { delay: 0.2, duration: 0.5, count: 8 })] },
    { name: "聖なる光", layers: [L("pillar", { duration: 0.6, size: 1.2 }), L("ring", { delay: 0.1, duration: 0.5, size: 1.4 }), L("sparks", { delay: 0.15, duration: 0.7, count: 14 })] },
    { name: "風の渦", layers: [L("swirl", { duration: 0.6, size: 1.2 }), L("ring", { delay: 0.3, duration: 0.35, size: 0.9 })] },
    { name: "光線砲", layers: [L("beam", { duration: 0.35, size: 1.2 }), L("burst", { delay: 0.12, duration: 0.35, size: 1 })] }
  ];
  return defs.map(d => {
    const mix = efxNewMix(d.name);
    mix.layers = d.layers;
    return mix;
  });
}

// ===== ミックスの取り出し =====
function efxGetMixList() {
  return (typeof scenarioProject !== "undefined" && scenarioProject && Array.isArray(scenarioProject.effectMixes)) ? scenarioProject.effectMixes : [];
}
function efxFindMix(id) {
  if (!id) return null;
  const mix = efxGetMixList().find(m => m && m.id === id);
  return (mix && mix.enabled !== false && Array.isArray(mix.layers) && mix.layers.length > 0) ? mix : null;
}

// 1つのレイヤーを「描く用の数値」に整える（入力の不正・範囲外を丸める）
function efxNormalizeLayer(l) {
  const base = efxBaseDef(l && l.base) ? l.base : "burst";
  return {
    base, anchor: l && l.anchor === "from" ? "from" : "to",
    color: l && l.color === "custom" ? "custom" : "element",
    customColor: (l && typeof l.customColor === "string" && /^#[0-9a-fA-F]{3,8}$/.test(l.customColor)) ? l.customColor : "#ffffff",
    size: efxClamp(l && l.size, 0.2, 4, 1),
    delay: efxClamp(l && l.delay, 0, 2, 0),
    duration: efxClamp(l && l.duration, 0.1, 2, 0.4),
    count: Math.round(efxClamp(l && l.count, 1, 30, 6)),
    alpha: efxClamp(l && l.alpha, 0.1, 1, 1),
    glow: !l || l.glow !== false
  };
}
function efxNormalizeLayers(mix) {
  return (mix.layers || []).slice(0, EFX_LAYER_MAX).map(efxNormalizeLayer);
}
function efxMixDuration(layers) {
  let end = 0.1;
  layers.forEach(l => { end = Math.max(end, l.delay + l.duration); });
  return Math.min(EFX_MIX_MAX_SEC, end);
}

// ===== 出す／描く =====
function efxIsMix(f) { return !!f && f.kind === "mix"; }

// list（st.fx など）にミックスの演出を足す。from / to は {x, y}。足せたら true
function efxSpawn(list, mixId, from, to, color) {
  const mix = efxFindMix(mixId);
  if (!mix || !Array.isArray(list)) return false;
  const layers = efxNormalizeLayers(mix);
  const dur = efxMixDuration(layers);
  const t = to || from;
  list.push({
    kind: "mix", layers, color: color || "#ffffff",
    x1: from.x, y1: from.y, x2: t.x, y2: t.y,
    t: dur, dur, seed: Math.floor(Math.random() * 1e9)
  });
  return true;
}

// 乱数（同じシードなら同じ並び。粒の向きなどが、フレームごとに揺れないようにする）
function efxRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const efxEaseOut = p => 1 - Math.pow(1 - p, 3);

// 1つの演出（kind === "mix"）を描く。f.t（残り秒）と f.dur（全体の秒）から、経過時間を出す
function efxDraw(ctx, f) {
  const elapsed = Math.max(0, f.dur - f.t);
  ctx.save();
  f.layers.forEach((l, li) => {
    const local = elapsed - l.delay;
    if (local < 0 || local > l.duration) return;
    const p = Math.min(1, local / l.duration);
    const color = l.color === "custom" ? l.customColor : f.color;
    const anchorX = l.anchor === "from" ? f.x1 : f.x2;
    const anchorY = l.anchor === "from" ? f.y1 : f.y2;
    ctx.globalCompositeOperation = l.glow ? "lighter" : "source-over";
    ctx.globalAlpha = l.alpha;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const rng = efxRng(f.seed + li * 7919);
    const draw = EFX_DRAWERS[l.base];
    if (draw) draw(ctx, l, p, f, color, anchorX, anchorY, rng);
  });
  ctx.restore();
}

// ===== ベースエフェクトの描き方 =====
// p＝そのレイヤーの進み具合（0〜1）。size＝大きさの倍率。どれも「始めは強く、終わりは消える」ようにしてある
const EFX_DRAWERS = {
  bolt(ctx, l, p, f, color, ax, ay, rng) {
    // count 個の弾が、少しずつずれて飛ぶ。1個の飛ぶ時間は全体の6割（残りは出発のずれ）
    const dx = f.x2 - f.x1, dy = f.y2 - f.y1, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    for (let i = 0; i < l.count; i++) {
      const start = l.count === 1 ? 0 : (i / l.count) * 0.4;
      const q = Math.min(1, Math.max(0, (p - start) / 0.6));
      if (q <= 0 || q >= 1) continue;
      const spread = l.count === 1 ? 0 : (i - (l.count - 1) / 2) * 7 * l.size;
      const e = q * q * (3 - 2 * q);
      const x = f.x1 + dx * e + nx * spread, y = f.y1 + dy * e + ny * spread;
      const tailE = Math.max(0, e - 0.18);
      const tx = f.x1 + dx * tailE + nx * spread, ty = f.y1 + dy * tailE + ny * spread;
      ctx.lineWidth = 5 * l.size; ctx.globalAlpha = l.alpha * 0.5;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
      ctx.globalAlpha = l.alpha;
      ctx.beginPath(); ctx.arc(x, y, 5 * l.size, 0, Math.PI * 2); ctx.fill();
    }
  },
  beam(ctx, l, p, f, color) {
    const w = Math.max(0.5, 14 * l.size * (1 - p));
    ctx.globalAlpha = l.alpha * (1 - p * 0.6);
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke();
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = w * 0.35;   // 芯は白
    ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke();
  },
  lightning(ctx, l, p, f, color) {
    // 線が揺れるように、20コマ/秒でシードを変える
    const rng = efxRng(f.seed + Math.floor(p * l.duration * 20) * 104729);
    const dx = f.x2 - f.x1, dy = f.y2 - f.y1, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const segs = Math.max(4, Math.min(14, Math.round(len / 22)));
    const pts = [{ x: f.x1, y: f.y1 }];
    for (let i = 1; i < segs; i++) {
      const jit = (rng() - 0.5) * 2 * 16 * l.size;
      pts.push({ x: f.x1 + dx * i / segs + nx * jit, y: f.y1 + dy * i / segs + ny * jit });
    }
    pts.push({ x: f.x2, y: f.y2 });
    ctx.globalAlpha = l.alpha * (1 - p * 0.7);
    [[5 * l.size, color], [1.8 * l.size, "#ffffff"]].forEach(([w, c]) => {
      ctx.lineWidth = w; ctx.strokeStyle = c;
      ctx.beginPath(); pts.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y))); ctx.stroke();
    });
  },
  burst(ctx, l, p, f, color, ax, ay) {
    const r = 12 + 46 * l.size * efxEaseOut(p);
    const g = ctx.createRadialGradient(ax, ay, 0, ax, ay, r);
    g.addColorStop(0, "#ffffff"); g.addColorStop(0.35, color); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = l.alpha * (1 - p);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(ax, ay, r, 0, Math.PI * 2); ctx.fill();
  },
  ring(ctx, l, p, f, color, ax, ay) {
    ctx.globalAlpha = l.alpha * (1 - p);
    ctx.lineWidth = 1 + 5 * l.size * (1 - p);
    ctx.beginPath(); ctx.arc(ax, ay, 8 + 62 * l.size * efxEaseOut(p), 0, Math.PI * 2); ctx.stroke();
  },
  sparks(ctx, l, p, f, color, ax, ay, rng) {
    ctx.globalAlpha = l.alpha * (1 - p);
    for (let i = 0; i < l.count; i++) {
      const ang = rng() * Math.PI * 2, spd = 0.5 + rng() * 0.5;
      const d = 52 * l.size * spd * efxEaseOut(p);
      const s = Math.max(0.8, (3.5 - 2.5 * p) * l.size);
      ctx.beginPath(); ctx.arc(ax + Math.cos(ang) * d, ay + Math.sin(ang) * d, s, 0, Math.PI * 2); ctx.fill();
    }
  },
  pillar(ctx, l, p, f, color, ax, ay) {
    const h = 150 * l.size * Math.min(1, p / 0.3 + 0.15);   // 始めの3割で一気に立ち上がる
    const w = 26 * l.size * (1 - p * 0.5);
    const g = ctx.createLinearGradient(0, ay - h, 0, ay);
    g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.6, color); g.addColorStop(1, "#ffffff");
    ctx.globalAlpha = l.alpha * (1 - p * p);
    ctx.fillStyle = g;
    ctx.fillRect(ax - w / 2, ay - h, w, h);
  },
  swirl(ctx, l, p, f, color, ax, ay) {
    ctx.globalAlpha = l.alpha * (1 - p);
    ctx.lineWidth = 3 * l.size * (1 - p * 0.5);
    const r = (18 + 34 * efxEaseOut(p)) * l.size;
    for (let k = 0; k < 3; k++) {
      const a0 = p * 7 + k * (Math.PI * 2 / 3);
      ctx.beginPath(); ctx.arc(ax, ay, r, a0, a0 + 1.4); ctx.stroke();
    }
  }
};
