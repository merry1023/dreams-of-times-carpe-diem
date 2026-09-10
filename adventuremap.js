// adventuremap.js
// 町の「冒険する」から開く、行き先をノードマップ（丸＋線でつながった地図）から選ぶ画面。
// ★まだ発見していない場所（未実装の行き先の先など）は名前を出さず「？」の丸として表示する。
//   実際の移動は adventure.js の enterAdventureLocation() / openTrialShrine() に委譲する。
//
// ノードの種類 (kind):
//   "hub"         … 現在地（カリの村）。クリックしても何も起きない
//   "location"    … 実際に探索できる場所。クリックで adventure.js の enterAdventureLocation(locationKey) へ
//   "placeholder" … 名前は判明しているが中身はまだ準備中の場所（カデリクの街）
//   "unknown"     … まだ何も分かっていない場所。「？」として表示し、クリックしてもフレーバーテキストのみ

const ADVENTURE_MAP_NODES = [
  { id: "village", label: "カリの村", x: 16, y: 78, radius: 11, kind: "hub" },
  { id: "highway", label: "ニョードー街道", x: 16, y: 50, radius: 9, kind: "placeholder", placeholderName: "ニョードー街道" },
  { id: "highway_beyond", label: null, x: 19, y: 20, radius: 7, kind: "unknown" },
  { id: "forest", label: "幻魔の森", x: 28, y: 58, radius: 8, kind: "location", locationKey: "forest" },
  { id: "grassland", label: "ガマジルの草原", x: 40, y: 70, radius: 8, kind: "location", locationKey: "grassland" },
  { id: "cave", label: "アヌスの洞窟", x: 40, y: 86, radius: 8, kind: "location", locationKey: "cave" },
  { id: "kaderiku", label: "カデリクの街", x: 68, y: 48, radius: 13, kind: "placeholder", placeholderName: "カデリクの街" },
  { id: "kaderiku_n1", label: null, x: 64, y: 20, radius: 6, kind: "unknown" },
  { id: "kaderiku_n2", label: null, x: 86, y: 26, radius: 6, kind: "unknown" },
  { id: "kaderiku_n3", label: null, x: 93, y: 55, radius: 6, kind: "unknown" },
  { id: "kaderiku_n4", label: null, x: 80, y: 80, radius: 6, kind: "unknown" }
];

const ADVENTURE_MAP_EDGES = [
  ["village", "highway"], ["village", "forest"], ["village", "grassland"], ["village", "cave"],
  ["highway", "highway_beyond"],
  ["village", "kaderiku"],
  ["kaderiku", "kaderiku_n1"], ["kaderiku", "kaderiku_n2"], ["kaderiku", "kaderiku_n3"], ["kaderiku", "kaderiku_n4"]
];

// ★マップ画面を「行き先を選ばずに閉じた」時にどこへ戻るか。以前は常にopenTownMenu（カリの村）固定だったため、
//   カデリクの街など村以外の拠点の広場から開いた場合でも、閉じると強制的に村へ飛ばされてしまっていた。
//   openAdventureMap()を呼ぶ側が「戻り先」の関数を渡せるようにし、渡されなければ従来通り村に戻る
let adventureMapReturnTo = null;

function openAdventureMap(returnTo) {
  adventureMapReturnTo = typeof returnTo === "function" ? returnTo : openTownMenu;
  currentLocationKey = "town"; // adventure.js/town.js側のセーブ用記録に合わせる
  if (typeof loadCustomScenarioData === "function") loadCustomScenarioData(); // scenariobuild.js（マップ設定タブで作ったエリアを反映するため）
  if (typeof hideLocationMenu === "function") hideLocationMenu(); // mainfunc.js（★これを閉じないと、裏で行き先メニューの矢印キー/決定キー処理が先に反応し、地図側のキー操作が一切効かなくなる不具合の原因だった）
  const overlay = document.getElementById("adventure-map-overlay");
  if (!overlay) return;
  overlay.classList.remove("hidden");
  renderAdventureMap();
  
  // ★キーボードでのカーソル位置。前回開いていた場所が今も存在すればそこから、無ければ村（現在地）から始める
  const nodes = getCombinedAdventureMapNodes();
  if (!nodes.some(n => n.id === adventureMapFocusedNodeId)) {
    const hub = nodes.find(n => n.kind === "hub");
    adventureMapFocusedNodeId = hub ? hub.id : (nodes[0] ? nodes[0].id : null);
  }
  updateAdventureMapFocusVisual(adventureMapFocusedNodeId);
  adventureMapCamera.zoom = 1; // ★開くたびにズームはリセットする
  centerAdventureMapCameraOnNode(nodes.find(n => n.id === adventureMapFocusedNodeId));
  window.addEventListener("keydown", handleAdventureMapKeyDown);
}

function closeAdventureMap() {
  const overlay = document.getElementById("adventure-map-overlay");
  if (overlay) overlay.classList.add("hidden");
  window.removeEventListener("keydown", handleAdventureMapKeyDown);
}

// ★今フォーカスしているエリアの丸を光らせる
function updateAdventureMapFocusVisual(nodeId) {
  const svg = document.getElementById("adventure-map-svg");
  if (!svg) return;
  svg.querySelectorAll(".adventure-map-node-focused").forEach(el => el.classList.remove("adventure-map-node-focused"));
  if (!nodeId) return;
  const g = svg.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`);
  if (g) g.classList.add("adventure-map-node-focused");
}

// ★今フォーカスしているエリアの座標から、上下左右それぞれの方向に一番近いエリアを探す
function findNearestAdventureMapNodeInDirection(current, nodes, key) {
  const candidates = nodes.filter(n => n.id !== current.id).map(n => {
    const dx = n.x - current.x;
    const dy = n.y - current.y;
    return { node: n, dx, dy, dist: Math.sqrt(dx * dx + dy * dy) };
  });
  
  let filtered;
  if (key === "ArrowUp") filtered = candidates.filter(c => c.dy < -1);
  else if (key === "ArrowDown") filtered = candidates.filter(c => c.dy > 1);
  else if (key === "ArrowLeft") filtered = candidates.filter(c => c.dx < -1);
  else filtered = candidates.filter(c => c.dx > 1);
  
  if (filtered.length === 0) filtered = candidates; // ★その方向に何も無ければ、一番近いものを選ぶ
  if (filtered.length === 0) return null;
  filtered.sort((a, b) => a.dist - b.dist);
  return filtered[0].node;
}

// ★矢印キーでエリア間を移動→Zキーで選択→「はい」で確定、という一連の操作
async function handleAdventureMapKeyDown(event) {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  const overlay = document.getElementById("adventure-map-overlay");
  if (!overlay || overlay.classList.contains("hidden")) return;
  if (typeof isGameDialogOpen !== "undefined" && isGameDialogOpen) return; // ★確認ダイアログ表示中は、下の地図が矢印キーに反応しないようにする
  if (event.repeat) return;
  
  const nodes = getCombinedAdventureMapNodes();
  let current = nodes.find(n => n.id === adventureMapFocusedNodeId);
  if (!current) {
    current = nodes.find(n => n.kind === "hub") || nodes[0];
    adventureMapFocusedNodeId = current ? current.id : null;
  }
  if (!current) return;
  
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    const next = findNearestAdventureMapNodeInDirection(current, nodes, event.key);
    if (!next) return;
    adventureMapFocusedNodeId = next.id;
    updateAdventureMapFocusVisual(next.id);
    centerAdventureMapCameraOnNode(next); // ★フォーカスしたエリアが画面中央に来るようカメラを移動
  } else if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.decideKeys.includes(event.key)) {
    event.preventDefault();
    await confirmAndActivateAdventureMapNode(current);
    
  } else if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.cancelKeys.includes(event.key)) {
    // ★xキーで、開いた時の場所（無指定なら村メニュー）に戻る
    event.preventDefault();
    closeAdventureMap();
    (typeof adventureMapReturnTo === "function" ? adventureMapReturnTo : openTownMenu)();
  }
}

// ★Zキーで選んだエリアについて「〜へ行きますか？」で確認し、「はい」なら実際に向かう
async function confirmAndActivateAdventureMapNode(node) {
  const { isLocked, isConditionLocked, backingArea } = computeAdventureMapNodeLockState(node);
  const isFilledIn = backingArea && backingArea.type !== "placeholder" && backingArea.type !== "unknown";
  const showAsUnknown = (node.kind === "unknown" && !isFilledIn) || isConditionLocked;
  const displayLabel = node.kind === "hub" ? "カリの村" : (showAsUnknown ? "この場所" : (node.label || "この場所"));
  
  const confirmed = await showGameConfirm(`${displayLabel}へ行きますか？`); // mainfunc.js
  if (!confirmed) return;
  
  await handleAdventureMapNodeClick(node, isLocked, isConditionLocked);
}

document.addEventListener("DOMContentLoaded", () => {
  const closeBtn = document.getElementById("adventure-map-close-btn");
  if (closeBtn) closeBtn.onclick = (event) => {
    event.stopPropagation();
    closeAdventureMap();
    (typeof adventureMapReturnTo === "function" ? adventureMapReturnTo : openTownMenu)(); // town.js
  };
});

const ADVENTURE_MAP_SVG_NS = "http://www.w3.org/2000/svg";
let adventureMapFocusedNodeId = null; // ★矢印キーで動かす、今フォーカスしているエリアのid
let adventureMapCamera = { x: 50, y: 50, zoom: 1 }; // ★カメラが今見ている中心座標とズーム
let adventureMapPointerState = null; // ★ドラッグ中の情報（パン操作用）
let adventureMapPointerSetup = false; // ★イベント登録の二重登録防止

// ★<g id="adventure-map-camera">のtransformを更新する。CSSのtransitionが付いているので、
//   既に画面にある要素に対して呼べば滑らかに移動する
function updateAdventureMapCameraTransform() {
  const camera = document.getElementById("adventure-map-camera");
  if (!camera) return;
  const { x, y, zoom } = adventureMapCamera;
  camera.setAttribute("transform", `translate(${50 - zoom * x}, ${50 - zoom * y}) scale(${zoom})`);
}

// ★今フォーカスしているエリアが画面の中央に来るよう、カメラを滑らかに移動する
function centerAdventureMapCameraOnNode(node) {
  if (!node) return;
  adventureMapCamera.x = node.x;
  adventureMapCamera.y = node.y;
  updateAdventureMapCameraTransform();
}

// ★指・マウスでのドラッグ＝地図のパン操作、マウスホイール＝ズーム
function setupAdventureMapPointerEvents(svg) {
  if (adventureMapPointerSetup) return;
  adventureMapPointerSetup = true;
  
  const getSvgScale = () => {
    const rect = svg.getBoundingClientRect();
    return rect.width > 0 ? rect.width / 100 : 1; // ★100x100のviewBoxに対する実際の表示ピクセルサイズ
  };
  
  svg.addEventListener("pointerdown", (event) => {
    adventureMapPointerState = {
      startX: event.clientX, startY: event.clientY,
      startCamX: adventureMapCamera.x, startCamY: adventureMapCamera.y,
      moved: false, pointerId: event.pointerId
    };
    const camera = document.getElementById("adventure-map-camera");
    if (camera) camera.classList.add("adventure-map-no-transition"); // ★ドラッグ中はアニメーションを切って、指にピッタリ追従させる
    try { svg.setPointerCapture(event.pointerId); } catch (e) { /* 無視 */ }
  });
  
  svg.addEventListener("pointermove", (event) => {
    if (!adventureMapPointerState) return;
    const dx = event.clientX - adventureMapPointerState.startX;
    const dy = event.clientY - adventureMapPointerState.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) adventureMapPointerState.moved = true;
    const scale = getSvgScale() * adventureMapCamera.zoom;
    adventureMapCamera.x = adventureMapPointerState.startCamX - dx / scale;
    adventureMapCamera.y = adventureMapPointerState.startCamY - dy / scale;
    updateAdventureMapCameraTransform();
  });
  
  const endDrag = () => {
    if (!adventureMapPointerState) return;
    adventureMapPointerState.moved = false; // ★次のクリックは邪魔しないよう、少し遅れてリセット
    setTimeout(() => { adventureMapPointerState = null; }, 50);
    const camera = document.getElementById("adventure-map-camera");
    if (camera) camera.classList.remove("adventure-map-no-transition");
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);
  
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.15 : 0.15;
    adventureMapCamera.zoom = Math.max(0.5, Math.min(3, adventureMapCamera.zoom + delta));
    updateAdventureMapCameraTransform();
  }, { passive: false });
}

// ★マップ設定タブで作ったエリアを、村とつながるノードとして追加する。
//   既存のマップ（森・草原・洞窟）がマップ設定タブで削除されている場合は、そのノードも表示から外す。
//   名前が編集されている場合は、ノードのラベルにも反映する。
function getCombinedAdventureMapNodes() {
  const customAreas = (typeof scenarioProject !== "undefined" && scenarioProject.mapAreas) ? scenarioProject.mapAreas : [];
  const deletedKeys = (typeof scenarioProject !== "undefined" && scenarioProject.deletedBuiltinIds) ? scenarioProject.deletedBuiltinIds.mapAreas : [];
  
  const builtinNodes = ADVENTURE_MAP_NODES
    .filter(node => !(deletedKeys && deletedKeys.includes(node.id)))
    .map(node => {
      const override = customAreas.find(a => a.builtin && a.locationKey === node.id);
      if (!override) return node;
      return {
        ...node,
        label: override.name || node.label, // ★編集された名前をノードのラベルに反映
        x: typeof override.x === "number" ? override.x : node.x, // ★マップエディタで動かした位置も反映
        y: typeof override.y === "number" ? override.y : node.y,
        radius: (typeof override.mapNodeSize === "number" && override.mapNodeSize > 0) ? override.mapNodeSize : node.radius, // ★要望対応：マップ上の見た目の大きさを指定できるように
        area: override // ★「カデリクの街」「？」ノードのクリック処理側で、中身が作り込まれたかどうかの判定に使う
      };
    });
  
  const customNodes = customAreas.filter(area => !area.builtin).map(area => ({
    id: "custom_" + area.id,
    label: area.name,
    x: area.x, y: area.y,
    radius: (typeof area.mapNodeSize === "number" && area.mapNodeSize > 0) ? area.mapNodeSize : (area.type === "country" ? 12 : area.type === "city" ? 10 : area.type === "enemy" ? 7 : 9), // ★要望対応：マップ上の見た目の大きさを指定できるように（未指定なら今まで通り種類ごとの既定値）
    kind: "customArea",
    customArea: area
  }));
  return builtinNodes.concat(customNodes);
}

function getCombinedAdventureMapEdges() {
  const nodes = getCombinedAdventureMapNodes();
  const nodeIds = new Set(nodes.map(n => n.id));
  
  // ビルトインエッジ（デフォルト幅 5px を付与）
  const builtinEdges = ADVENTURE_MAP_EDGES
    .filter(([fromId, toId]) => nodeIds.has(fromId) && nodeIds.has(toId))
    .map(([fromId, toId]) => [fromId, toId, 5]);
  
  // カスタムエッジ（マップ設定タブで作成・編集されたもの）
  const customEdges = (typeof scenarioProject !== "undefined" && scenarioProject.mapEdges) ? scenarioProject.mapEdges : [];
  
  // カスタムエッジで上書き：fromId+toId の組み合わせが重複していたらカスタム側を優先
  const edgeMap = new Map();
  builtinEdges.forEach(([fromId, toId, width]) => {
    const key = fromId < toId ? fromId + "|" + toId : toId + "|" + fromId;
    edgeMap.set(key, [fromId, toId, width]);
  });
  customEdges.forEach(([fromId, toId, width]) => {
    const key = fromId < toId ? fromId + "|" + toId : toId + "|" + fromId;
    edgeMap.set(key, [fromId, toId, width || 5]);
  });
  
  return Array.from(edgeMap.values());
}

// ★マップ設定タブで指定した、エリアの解放条件（unlockConditions）を全て満たしているか判定する。
//   条件が1つも無ければ、常に解放済み扱いにする（今まで通り）
function evaluateMapAreaUnlockConditions(area) {
  if (!area || !Array.isArray(area.unlockConditions) || area.unlockConditions.length === 0) return true;
  return area.unlockConditions.every(cond => {
    if (cond.type === "chapterCleared") {
      const chapter = (typeof scenarioProject !== "undefined" ? scenarioProject.chapters : []).find(c => c.id === cond.chapterId);
      return !!(chapter && chapter.cleared);
    }
    if (cond.type === "flag") {
      return !!(typeof scenarioFlags !== "undefined" && cond.flag && scenarioFlags[cond.flag]);
    }
    if (cond.type === "enemyKills") {
      if (!player) return false;
      if (cond.monsterKey) return (player.enemyKillCounts[cond.monsterKey] || 0) >= (cond.count || 1);
      return (player.totalKillCount || 0) >= (cond.count || 1); // ★モンスター指定なし＝全ての敵を合わせてn体
    }
    if (cond.type === "questCleared") {
      return !!(player && player.completedQuestIds && player.completedQuestIds.includes(cond.questId));
    }
    if (cond.type === "daysSinceTransfer") {
      return !!(player && player.daysSinceTransfer >= (cond.days || 1)); // ★要望対応：経過日数による解放条件
    }
    if (cond.type === "playerRank") {
      return !!(player && player.rank >= (cond.rank || 1)); // ★要望対応：ランクによる解放条件
    }
    if (cond.type === "playerLevel") {
      return !!(player && player.level >= (cond.level || 1)); // ★要望対応：レベルによる解放条件
    }
    return true;
  });
}

function renderAdventureMap() {
  const svg = document.getElementById("adventure-map-svg");
  if (!svg) return;
  svg.innerHTML = "";
  const nodes = getCombinedAdventureMapNodes();
  const edges = getCombinedAdventureMapEdges();
  
  const camera = document.createElementNS(ADVENTURE_MAP_SVG_NS, "g");
  camera.id = "adventure-map-camera";
  svg.appendChild(camera);
  
  // ★先に線を描いてから丸を描く（丸が線の上に重なって見えるように）
  edges.forEach(([fromId, toId, edgeWidth]) => {
    const from = nodes.find(n => n.id === fromId);
    const to = nodes.find(n => n.id === toId);
    if (!from || !to) return;
    
    const line = document.createElementNS(ADVENTURE_MAP_SVG_NS, "line");
    line.setAttribute("x1", from.x);
    line.setAttribute("y1", from.y);
    line.setAttribute("x2", to.x);
    line.setAttribute("y2", to.y);
    line.setAttribute("class", "adventure-map-edge");
    line.setAttribute("stroke-width", edgeWidth || 5); // ★エディタで設定した線の幅を反映（デフォルト 5px）
    camera.appendChild(line);
  });
  
  nodes.forEach(node => {
    camera.appendChild(buildAdventureMapNodeElement(node));
  });
  
  setupAdventureMapPointerEvents(svg);
  updateAdventureMapCameraTransform();
}

// ★村・ハブ以外で、まだ条件を満たしていない／道が開通していないエリアかどうかをまとめて判定する
//   （見た目の「？」表示と、実際に入れるかどうかの判定の両方で使う共通ロジック）
//   ★以前はここでkind==="unknown"（？ノード）を判定から除外していたため、マップ設定タブで
//     中身を作り込んだ「？」ノードに解放条件（unlockConditions）を付けても、条件を満たす前から
//     普通に入れてしまう不具合があった。「？」の見た目自体はnode.kind==="unknown"だけで
//     もう決まる（showAsUnknown = isUnknown || isConditionLocked）ので、ここで除外する必要は無い
function computeAdventureMapNodeLockState(node) {
  const backingArea = node.area || node.customArea;
  const isConditionLocked = node.kind !== "hub"
    && !!(backingArea && Array.isArray(backingArea.unlockConditions) && backingArea.unlockConditions.length > 0)
    && !evaluateMapAreaUnlockConditions(backingArea);
  return { isLocked: isConditionLocked, isConditionLocked, backingArea };
}

function buildAdventureMapNodeElement(node) {
  const { isLocked, isConditionLocked, backingArea } = computeAdventureMapNodeLockState(node);
  // ★以前はここで「node.kind==="unknown"なら常に？表示」としていたため、マップ設定タブで中身を
  //   作り込んで（area.typeを変更して）解放条件も満たした後も、見た目だけはずっと「？」のまま
  //   残ってしまい、実際に入れるようになったことがプレイヤーに伝わらない不具合があった。
  //   「まだ中身が作り込まれていない」場合だけ？表示にするよう修正した（クリック時の判定と揃えた）
  const isFilledIn = backingArea && backingArea.type !== "placeholder" && backingArea.type !== "unknown";
  const showAsUnknown = (node.kind === "unknown" && !isFilledIn) || isConditionLocked;
  
  const group = document.createElementNS(ADVENTURE_MAP_SVG_NS, "g");
  group.setAttribute("data-node-id", node.id); // ★矢印キーでのフォーカス移動時に、このノードを見つけて丸を光らせるための目印
  group.setAttribute("class", "adventure-map-node"
    + (showAsUnknown ? " adventure-map-node-unknown" : "")
    + (isLocked ? " adventure-map-node-locked" : "")
    + (node.kind === "hub" ? " adventure-map-node-hub" : "")
    + (node.kind === "placeholder" ? " adventure-map-node-placeholder" : "")
    + (node.kind === "customArea" ? " adventure-map-node-custom-" + node.customArea.type : "")
    + (node.id === adventureMapFocusedNodeId ? " adventure-map-node-focused" : ""));
  
  const circle = document.createElementNS(ADVENTURE_MAP_SVG_NS, "circle");
  circle.setAttribute("cx", node.x);
  circle.setAttribute("cy", node.y);
  circle.setAttribute("r", node.radius);
  circle.setAttribute("class", "adventure-map-node-circle");
  group.appendChild(circle);
  
  const text = document.createElementNS(ADVENTURE_MAP_SVG_NS, "text");
  text.setAttribute("x", node.x);
  text.setAttribute("y", node.y);
  text.setAttribute("class", "adventure-map-node-label");
  
  if (showAsUnknown) {
    text.textContent = "？";
  } else {
    // ★長い地名は3〜4文字ごとに折り返す（tspanを使って複数行にする）
    const chars = node.label.split("");
    const charsPerLine = Math.max(3, Math.ceil(node.label.length / 2));
    const lines = [];
    for (let i = 0; i < chars.length; i += charsPerLine) {
      lines.push(chars.slice(i, i + charsPerLine).join(""));
    }
    const lineHeight = 3.6;
    const startDy = -((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, index) => {
      const tspan = document.createElementNS(ADVENTURE_MAP_SVG_NS, "tspan");
      tspan.setAttribute("x", node.x);
      tspan.setAttribute("dy", index === 0 ? startDy : lineHeight);
      tspan.textContent = line;
      text.appendChild(tspan);
    });
  }
  
  group.appendChild(text);
  
  if (node.kind === "location" && !showAsUnknown) {
    const loc = ADVENTURE_LOCATIONS[node.locationKey]; // adventure.js
    const recommendedLevel = (loc && loc.minMonsterLevel) || 1;
    const subtitle = document.createElementNS(ADVENTURE_MAP_SVG_NS, "text");
    subtitle.setAttribute("x", node.x);
    subtitle.setAttribute("y", node.y + node.radius + 4);
    subtitle.setAttribute("class", "adventure-map-node-sublabel");
    subtitle.textContent = `推奨Lv.${recommendedLevel}〜`;
    group.appendChild(subtitle);
  }
  
  group.onclick = (event) => {
    event.stopPropagation();
    if (adventureMapPointerState && adventureMapPointerState.moved) return; // ★パン操作の終わりのクリックは無視する
    adventureMapFocusedNodeId = node.id; // ★マウスで選んだ場所にも、キーボードのカーソルを合わせておく
    updateAdventureMapFocusVisual(node.id);
    centerAdventureMapCameraOnNode(node); // ★フォーカスしたエリアが画面中央に来るようカメラを移動
    handleAdventureMapNodeClick(node, isLocked, isConditionLocked);
  };
  
  return group;
}

async function handleAdventureMapNodeClick(node, isLocked, isConditionLocked) {
  // ★「カデリクの街」「？」ノードでも、マップ設定タブで種類（街／村／国／敵エリア）まで
  //   作り込まれていれば、もう「未実装」ではなく実際に入れる場所として扱う
  const isFilledIn = node.area && node.area.type !== "placeholder" && node.area.type !== "unknown";
  
  if (isFilledIn && (node.kind === "unknown" || node.kind === "placeholder") && isLocked) {
    changeSpeaker("");
    await displayMessage("まだ何も分かっていない場所のようだ……");
    return;
  }
  
  if (isFilledIn && (node.kind === "unknown" || node.kind === "placeholder")) {
    closeAdventureMap();
    await enterCustomMapArea(node.area, node.id); // adventure.js（この場所固有のidで登録して入る）
    return;
  }
  
  if (node.kind === "unknown" || isConditionLocked) {
    changeSpeaker(""); // mainfunc.js
    await displayMessage("まだ何も分かっていない場所のようだ……");
    return;
  }
  
  if (node.kind === "hub") {
    // ★以前はここが「現在地なので何もしない」という決め打ちだったが、これはマップを必ずカリの村から
    //   開く前提の実装だった。拠点広場の「冒険に出る」からもマップを開けるようになった今は、
    //   カリの村以外の拠点にいる時にこのノード（カリの村）を選んでも何も起きず、村へ戻れない不具合になっていた。
    //   実際にカリの村へ戻る処理に変更する（すでにカリの村にいる時に選んでも実害はない）
    closeAdventureMap();
    await openTownMenu(); // town.js
    return;
  }
  
  if (isLocked) {
    changeSpeaker("");
    await displayMessage("まだ道が開通していないようだ……");
    return;
  }
  
  if (node.kind === "placeholder") {
    closeAdventureMap();
    await goToPlaceholderScene(node.placeholderName); // town.js
    return;
  }
  
  if (node.kind === "location") {
    closeAdventureMap();
    await enterAdventureLocation(node.locationKey); // adventure.js
    return;
  }
  
  if (node.kind === "customArea") {
    closeAdventureMap();
    await enterCustomMapArea(node.customArea); // adventure.js
  }
}