// mapareas.js
// シナリオビルドの「マップ設定」タブ：冒険マップ（adventuremap.js）に出す独自エリアを作成・編集・削除する。
// ★作ったエリアは村を中心としたノードマップに自動で追加され、実際に入って探索できる
//   （adventuremap.js側でカリの村と結んで表示、adventure.js側でADVENTURE_LOCATIONSへ動的登録して
//   既存の「前に進む／調べる」の仕組みをそのまま使う）。

const MAP_AREA_TYPES = {
  city: "街",
  village: "村",
  country: "国",
  enemy: "敵エリア",
  scenario: "シナリオ専用エリア",
  placeholder: "未実装（表示のみ・「街」等に変更すると入れる場所になります）",
  unknown: "？（未発見・「街」等に変更すると入れる場所になります）"
};

// ★エリアを削除する時、そのエリアが関わっている線（つながり）もあわせて消しておく
function removeMapEdgesForNodeId(nodeId) {
  scenarioProject.mapEdges = scenarioProject.mapEdges.filter(([a, b]) => a !== nodeId && b !== nodeId);
}

function renderMapAreaManager(container) {
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "エリアをタップすると編集できます（左のマップ画面でタップしても同じです）。";
  container.appendChild(introEl);
  
  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋新しいエリアを追加";
  addBtn.onclick = (event) => {
    event.stopPropagation();
    createNewMapArea();
  };
  container.appendChild(addBtn);
  
  const countEl = document.createElement("p");
  countEl.className = "devmode-note scenariobuild-condition";
  const customCount = scenarioProject.mapAreas.filter(a => !a.builtin).length;
  const builtinCount = scenarioProject.mapAreas.filter(a => a.builtin).length;
  countEl.textContent = `現在：自作エリア${customCount}件／既存マップ${builtinCount}件`;
  container.appendChild(countEl);
  
  if (scenarioProject.mapAreas.length === 0) return;
  
  const listEl = document.createElement("div");
  listEl.className = "scenariobuild-list";
  const customAreas = [];
  const builtinAreas = [];
  scenarioProject.mapAreas.forEach((area, index) => (area.builtin ? builtinAreas : customAreas).push({ area, index }));
  customAreas.concat(builtinAreas).forEach(({ area, index }) => {
    listEl.appendChild(buildMapAreaSummaryRow(area, index));
  });
  container.appendChild(listEl);
}

function createNewMapArea() {
  pushUndoSnapshot();
  const newArea = {
    id: generateId("area"), name: "新しいエリア", type: "village",
    x: 50, y: 50, bgTrack: "", bgImage: "",
    bossId: "", bossTriggerTypes: ["step"], bossStepChance: 0.08, bossExamineChance: 0.15,
    enemyIds: [], items: [], goldRewards: [], facilitySpawns: [], examineMessage: "", examineMessages: [],
    battleVariations: [], enemyLevel: null
  };
  scenarioProject.mapAreas.push(newArea);
  scenarioProject.mapEdges.push(["village", "custom_" + newArea.id]); // ★作った直後は、ひとまず村とつなげておく（あとで自由に線を切ったりつなぎ直せる）
  markScenarioBuildDirty();
  scenarioBuildEditingMapAreaId = newArea.id; // ★作ってすぐ詳細設定に入れるようにする
  scenarioBuildMainView = "mapEditor";
  renderScenarioBuildPanel();
}

// ===================================================================
// ===== メイン画面：インタラクティブなマップ画面（専用全画面。scenarioBuildMainView === "maps"） =====
// ===== 「冒険する」画面と同じ見た目・操作感（丸＋線）で、タップ編集・線のつなぎ／切り・矢印キー操作に対応 =====
// ===================================================================
let mapEditorCamera = { x: 50, y: 50, zoom: 1 }; // ★カメラが今見ている中心座標とズーム
let mapEditorSelectedNodeId = null; // ★キーボード操作用のカーソル（丸いカーソル）が今どこにあるか
let mapEditorConnectMode = false; // ★ON中は、タップ2回で線をつなぐ／切る
let mapEditorConnectFirstId = null; // ★接続モードで1つ目に選んだノード
let mapEditorPointerState = null; // ★ドラッグ中の情報（パン操作用）
let mapEditorNodeDragState = null; // ★選択中のエリアをつまんでドラッグし、位置を動かしている間の情報

// ★村（village）＋マップ設定タブにあるエリア（組み込み・自作の両方、「カデリクの街」「？」等の未実装ノードも含む）を、
//   実際に操作できるノードとして返す
function getMapEditorNodes() {
  const nodes = [];
  ADVENTURE_MAP_NODES.forEach(node => {
    if (scenarioProject.deletedBuiltinIds.mapAreas.includes(node.id)) return; // ★削除済みなら出さない（村自体は通常削除できない）
    const area = scenarioProject.mapAreas.find(a => a.builtin && a.locationKey === node.id);
    if (node.kind === "hub") {
      // ★村（現在地）も、拠点用のエリアデータがあれば編集対象にする（施設のアタッチ・BGM・背景など）
      nodes.push({ id: node.id, label: (area && area.name) || node.label, x: (area && typeof area.x === "number") ? area.x : node.x, y: (area && typeof area.y === "number") ? area.y : node.y, kind: "hub", area });
      return;
    }
    if (!area) return;
    nodes.push({
      id: node.id, label: area.name || node.label,
      x: typeof area.x === "number" ? area.x : node.x,
      y: typeof area.y === "number" ? area.y : node.y,
      kind: "area", area
    });
  });
  scenarioProject.mapAreas.filter(a => !a.builtin).forEach(area => {
    nodes.push({ id: "custom_" + area.id, label: area.name, x: area.x, y: area.y, kind: "area", area });
  });
  return nodes;
}

// ★存在するノード同士の線だけを返す（削除されたエリアに繋がっていた線は自動的に無視される）
function getMapEditorEdges(nodes) {
  const nodeIds = new Set(nodes.map(n => n.id));
  return scenarioProject.mapEdges.filter(([a, b]) => nodeIds.has(a) && nodeIds.has(b));
}

function renderMapAreaFullList(container) {
  const backBtn = document.createElement("button");
  backBtn.className = "devmode-btn";
  backBtn.textContent = "← 話の一覧に戻る";
  backBtn.onclick = (event) => {
    event.stopPropagation();
    window.removeEventListener("keydown", handleMapEditorKeyDown);
    scenarioBuildMainView = "list";
    renderScenarioBuildPanel();
  };
  container.appendChild(backBtn);
  
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "「冒険する」画面と同じ地図です。エリアをタップすると選択され、もう一度タップすると編集画面に入ります。選択中のエリアはつまんでドラッグすると位置を動かせます。何もない場所をドラッグすると地図を見て回れます（マウスホイールでズーム）。矢印キーでも丸いカーソルを動かせ、カメラはカーソルの位置へ滑らかに移動します。";
  container.appendChild(introEl);
  
  const nodes = getMapEditorNodes();
  const edges = getMapEditorEdges(nodes);
  if (!mapEditorSelectedNodeId || !nodes.some(n => n.id === mapEditorSelectedNodeId)) {
    mapEditorSelectedNodeId = nodes.length > 0 ? nodes[0].id : null;
  }
  
  const toolbar = document.createElement("div");
  toolbar.className = "mapeditor-toolbar";
  
  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋新しいエリアを追加";
  addBtn.onclick = (event) => { event.stopPropagation(); createNewMapArea(); };
  toolbar.appendChild(addBtn);
  
  const connectBtn = document.createElement("button");
  connectBtn.className = "devmode-btn" + (mapEditorConnectMode ? " scenariobuild-filter-active" : "");
  connectBtn.textContent = mapEditorConnectMode ? "🔗 接続モード中（もう一度押すと終了）" : "🔗 線をつなぐ／切る";
  connectBtn.onclick = (event) => {
    event.stopPropagation();
    mapEditorConnectMode = !mapEditorConnectMode;
    mapEditorConnectFirstId = null;
    renderScenarioBuildPanel();
  };
  toolbar.appendChild(connectBtn);
  
  const resetViewBtn = document.createElement("button");
  resetViewBtn.className = "devmode-btn";
  resetViewBtn.textContent = "🎥 表示をリセット";
  resetViewBtn.onclick = (event) => {
    event.stopPropagation();
    mapEditorCamera = { x: 50, y: 50, zoom: 1 };
    updateMapEditorCameraTransform();
  };
  toolbar.appendChild(resetViewBtn);
  container.appendChild(toolbar);
  
  if (mapEditorConnectMode) {
    const note = document.createElement("p");
    note.className = "devmode-note scenariobuild-condition";
    note.textContent = "エリアを2つ順番にタップ（またはカーソルを合わせて決定キー）すると、その間の線をつなぐ／切るを切り替えます。";
    container.appendChild(note);
  }
  
  const svgWrap = document.createElement("div");
  svgWrap.className = "mapeditor-wrap";
  
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("class", "mapeditor-svg");
  svg.id = "mapeditor-svg";
  
  const camera = document.createElementNS(svg.namespaceURI, "g");
  camera.id = "mapeditor-camera";
  svg.appendChild(camera);
  
  edges.forEach(([fromId, toId]) => {
    const fromNode = nodes.find(n => n.id === fromId);
    const toNode = nodes.find(n => n.id === toId);
    if (!fromNode || !toNode) return;
    const line = document.createElementNS(svg.namespaceURI, "line");
    line.setAttribute("x1", fromNode.x);
    line.setAttribute("y1", fromNode.y);
    line.setAttribute("x2", toNode.x);
    line.setAttribute("y2", toNode.y);
    line.setAttribute("data-from", fromId); // ★ドラッグ中、このノードにつながる線だけをその場で追従させるための目印
    line.setAttribute("data-to", toId);
    line.setAttribute("class", "mapeditor-edge");
    camera.appendChild(line);
  });
  
  nodes.forEach(node => {
    const g = document.createElementNS(svg.namespaceURI, "g");
    g.setAttribute("data-node-id", node.id);
    g.setAttribute("class", "mapeditor-node" + (node.id === mapEditorSelectedNodeId ? " mapeditor-node-selected" : ""));
    g.style.cursor = (node.kind === "area" && node.id === mapEditorSelectedNodeId) ? "grab" : "pointer";
    
    if (mapEditorConnectMode && node.id === mapEditorConnectFirstId) {
      const ring2 = document.createElementNS(svg.namespaceURI, "circle");
      ring2.setAttribute("cx", node.x);
      ring2.setAttribute("cy", node.y);
      ring2.setAttribute("r", node.kind === "hub" ? 9 : 7.5);
      ring2.setAttribute("class", "mapeditor-connect-ring");
      camera.appendChild(ring2);
    }
    
    const circle = document.createElementNS(svg.namespaceURI, "circle");
    circle.setAttribute("cx", node.x);
    circle.setAttribute("cy", node.y);
    circle.setAttribute("r", node.kind === "hub" ? 6 : 4.5);
    circle.setAttribute("class", "mapeditor-node-circle mapeditor-node-" + node.kind);
    g.appendChild(circle);
    
    const label = document.createElementNS(svg.namespaceURI, "text");
    label.setAttribute("x", node.x);
    label.setAttribute("y", node.y - (node.kind === "hub" ? 8 : 6.5));
    label.setAttribute("class", "mapeditor-node-label");
    label.textContent = node.label || "";
    g.appendChild(label);
    
    g.addEventListener("click", (event) => {
      event.stopPropagation();
      if (mapEditorPointerState && mapEditorPointerState.moved) return; // ★パン操作の終わりのクリックは無視する
      if (mapEditorNodeDragState) return; // ★ノードをドラッグして動かした直後のクリックは無視する
      const wasAlreadySelected = node.id === mapEditorSelectedNodeId;
      mapEditorSelectedNodeId = node.id;
      if (wasAlreadySelected) {
        handleMapEditorNodeActivate(node);
      } else {
        // ★1回目のタップ／クリックでは「選択」だけする（すぐ編集画面に入らない）。
        //   これで、選んでからドラッグして動かす → もう一度タップして編集、という2段階の操作ができる
        renderScenarioBuildPanel();
      }
    });
    
    // ★既に選択中のエリアだけ、その場でつまんでドラッグすると位置を動かせる（村は動かせない）
    if (node.kind === "area") {
      g.addEventListener("pointerdown", (event) => {
        if (mapEditorConnectMode) return;
        if (node.id !== mapEditorSelectedNodeId) return;
        event.stopPropagation(); // ★SVG側の地図パン操作を始めさせない
        mapEditorNodeDragState = { node, moved: false };
        try { svg.setPointerCapture(event.pointerId); } catch (e) { /* 無視 */ }
      });
    }
    
    camera.appendChild(g);
  });
  
  // ★キーボード操作用の丸いカーソル（選択中のノードの上に重ねて表示）
  const selectedNode = nodes.find(n => n.id === mapEditorSelectedNodeId);
  const ring = document.createElementNS(svg.namespaceURI, "circle");
  ring.id = "mapeditor-cursor-ring";
  ring.setAttribute("cx", selectedNode ? selectedNode.x : 50);
  ring.setAttribute("cy", selectedNode ? selectedNode.y : 50);
  ring.setAttribute("r", selectedNode && selectedNode.kind === "hub" ? 8 : 6.5);
  ring.setAttribute("class", "mapeditor-cursor-ring");
  camera.appendChild(ring);
  
  svgWrap.appendChild(svg);
  container.appendChild(svgWrap);
  
  setupMapEditorPointerEvents(svg);
  updateMapEditorCameraTransform();
  
  window.removeEventListener("keydown", handleMapEditorKeyDown); // ★二重登録防止
  window.addEventListener("keydown", handleMapEditorKeyDown);
  // ★エリアの一覧は右のサブ画面（renderMapAreaManager）だけに出す。以前はここ（左のメイン画面）にも
  //   同じ一覧が重複して出てしまい見づらかったため、地図そのものの表示だけに絞った
}

// ★ノードを実際に「選んだ」時の処理（タップ／決定キー共通）
function handleMapEditorNodeActivate(node) {
  if (mapEditorConnectMode) {
    if (!mapEditorConnectFirstId) {
      mapEditorConnectFirstId = node.id;
      renderScenarioBuildPanel();
      return;
    }
    if (mapEditorConnectFirstId === node.id) {
      mapEditorConnectFirstId = null; // ★同じノードをもう一度選んだら選び直し
      renderScenarioBuildPanel();
      return;
    }
    toggleMapEdge(mapEditorConnectFirstId, node.id);
    mapEditorConnectFirstId = null;
    renderScenarioBuildPanel();
    return;
  }
  
  if (node.area) {
    scenarioBuildEditingMapAreaId = node.area.id;
    scenarioBuildMainView = "mapEditor";
    renderScenarioBuildPanel();
  }
  // ★拠点用のエリアデータが見つからない村（通常は無いはず）では、通常モードで何も起きない
}

// ★2つのノードの間の線を、あれば消し、なければつなぐ
function toggleMapEdge(idA, idB) {
  pushUndoSnapshot();
  const existingIndex = scenarioProject.mapEdges.findIndex(([a, b]) => (a === idA && b === idB) || (a === idB && b === idA));
  if (existingIndex !== -1) {
    scenarioProject.mapEdges.splice(existingIndex, 1);
  } else {
    scenarioProject.mapEdges.push([idA, idB]);
  }
  markScenarioBuildDirty();
}

// ★<g id="mapeditor-camera">のtransformを更新する。CSSのtransitionが付いているので、
//   既に画面にある要素に対して呼べば滑らかに移動する（矢印キー操作で使うのはこちらだけ＝再描画しない）
function updateMapEditorCameraTransform() {
  const camera = document.getElementById("mapeditor-camera");
  if (!camera) return;
  const { x, y, zoom } = mapEditorCamera;
  camera.setAttribute("transform", `translate(${50 - zoom * x}, ${50 - zoom * y}) scale(${zoom})`);
}

// ★矢印キーでカーソルを動かした時、再描画せずにカーソルの丸とカメラだけを直接動かす（滑らかなアニメーションのため）
function updateMapEditorCursorVisual(nextNode) {
  document.querySelectorAll(".mapeditor-node-selected").forEach(el => el.classList.remove("mapeditor-node-selected"));
  const svg = document.getElementById("mapeditor-svg");
  const targetG = svg && svg.querySelector(`[data-node-id="${CSS.escape(nextNode.id)}"]`);
  if (targetG) targetG.classList.add("mapeditor-node-selected");
  
  const ring = document.getElementById("mapeditor-cursor-ring");
  if (ring) {
    ring.setAttribute("cx", nextNode.x);
    ring.setAttribute("cy", nextNode.y);
    ring.setAttribute("r", nextNode.kind === "hub" ? 8 : 6.5);
  }
}

// ★指・マウスでのドラッグ＝地図のパン操作（ただし選択中のエリアをつまんだ時はノード移動が優先される）、マウスホイール＝ズーム
function setupMapEditorPointerEvents(svg) {
  const getSvgScale = () => {
    const rect = svg.getBoundingClientRect();
    return rect.width > 0 ? rect.width / 100 : 1; // ★100x100のviewBoxに対する実際の表示ピクセルサイズ
  };
  
  // ★画面上の座標を、カメラのパン・ズームを差し引いた「地図そのものの座標（0〜100）」に変換する
  const svgPointFromClient = (event) => {
    const rect = svg.getBoundingClientRect();
    const vbX = rect.width > 0 ? (event.clientX - rect.left) / rect.width * 100 : 50;
    const vbY = rect.height > 0 ? (event.clientY - rect.top) / rect.height * 100 : 50;
    const { x: camX, y: camY, zoom } = mapEditorCamera;
    return { x: (vbX - (50 - zoom * camX)) / zoom, y: (vbY - (50 - zoom * camY)) / zoom };
  };
  
  svg.addEventListener("pointerdown", (event) => {
    if (mapEditorNodeDragState) return; // ★ノード側のpointerdownで既に処理済み（そちらがstopPropagationしている）
    mapEditorPointerState = {
      startX: event.clientX, startY: event.clientY,
      startCamX: mapEditorCamera.x, startCamY: mapEditorCamera.y,
      moved: false, pointerId: event.pointerId
    };
    const camera = document.getElementById("mapeditor-camera");
    if (camera) camera.classList.add("mapeditor-no-transition"); // ★ドラッグ中はアニメーションを切って、指にピッタリ追従させる
    try { svg.setPointerCapture(event.pointerId); } catch (e) { /* 無視 */ }
  });
  
  svg.addEventListener("pointermove", (event) => {
    if (mapEditorNodeDragState) {
      mapEditorNodeDragState.moved = true;
      const pt = svgPointFromClient(event);
      const node = mapEditorNodeDragState.node;
      // ★要望対応：マップの端を無くして無限に広がるようにする。
      //   以前はここで座標を2〜98の範囲に強制していたため、それが実質的な「マップの端」になっていた。
      //   カメラのパン・ズームはもともと座標の範囲に制限されていないので、ここの制限を外すだけで
      //   どこまでもエリアを配置できるようになる（村（現在地）だけは動かせないので影響しない）
      node.x = pt.x;
      node.y = pt.y;
      if (node.area) { node.area.x = node.x; node.area.y = node.y; } // ★実際のエリアデータにも即反映（保存はpointerupで行う）
      updateMapEditorNodeDragVisual(node);
      return;
    }
    if (!mapEditorPointerState) return;
    const dx = event.clientX - mapEditorPointerState.startX;
    const dy = event.clientY - mapEditorPointerState.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) mapEditorPointerState.moved = true;
    const scale = getSvgScale() * mapEditorCamera.zoom;
    mapEditorCamera.x = mapEditorPointerState.startCamX - dx / scale;
    mapEditorCamera.y = mapEditorPointerState.startCamY - dy / scale;
    updateMapEditorCameraTransform();
  });
  
  const endDrag = () => {
    if (mapEditorNodeDragState) {
      const wasMoved = mapEditorNodeDragState.moved;
      mapEditorNodeDragState = null;
      if (wasMoved) {
        markScenarioBuildDirty();
        renderScenarioBuildPanel(); // ★位置を確定させ、下の一覧のX/Y表示なども合わせて更新する
      }
      return;
    }
    if (!mapEditorPointerState) return;
    mapEditorPointerState.moved = false; // ★次のクリックは邪魔しないよう、少し遅れてリセット
    setTimeout(() => { mapEditorPointerState = null; }, 50);
    const camera = document.getElementById("mapeditor-camera");
    if (camera) camera.classList.remove("mapeditor-no-transition");
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);
  
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.15 : 0.15;
    mapEditorCamera.zoom = Math.max(0.5, Math.min(3, mapEditorCamera.zoom + delta));
    updateMapEditorCameraTransform();
  }, { passive: false });
}

// ★ノードをドラッグしている最中、再描画せずにそのノード・つながる線・カーソルの丸を直接動かす（軽くて指に追従しやすい）
function updateMapEditorNodeDragVisual(node) {
  const svg = document.getElementById("mapeditor-svg");
  if (!svg) return;
  const g = svg.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`);
  if (g) {
    const circle = g.querySelector("circle");
    const label = g.querySelector("text");
    if (circle) { circle.setAttribute("cx", node.x); circle.setAttribute("cy", node.y); }
    if (label) { label.setAttribute("x", node.x); label.setAttribute("y", node.y - (node.kind === "hub" ? 8 : 6.5)); }
  }
  svg.querySelectorAll(`line[data-from="${CSS.escape(node.id)}"]`).forEach(line => {
    line.setAttribute("x1", node.x);
    line.setAttribute("y1", node.y);
  });
  svg.querySelectorAll(`line[data-to="${CSS.escape(node.id)}"]`).forEach(line => {
    line.setAttribute("x2", node.x);
    line.setAttribute("y2", node.y);
  });
  if (node.id === mapEditorSelectedNodeId) updateMapEditorCursorVisual(node);
}

// ★上下左右キーで、今のカーソル位置から見てその方向に一番近いノードへ移動する
function findNearestMapEditorNodeInDirection(current, nodes, key) {
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

function handleMapEditorKeyDown(event) {
  if (scenarioBuildMainView !== "maps") { window.removeEventListener("keydown", handleMapEditorKeyDown); return; }
  if (typeof isGameDialogOpen !== "undefined" && isGameDialogOpen) return;
  if (event.repeat) return;
  
  const nodes = getMapEditorNodes();
  const current = nodes.find(n => n.id === mapEditorSelectedNodeId);
  if (!current) return;
  
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    const next = findNearestMapEditorNodeInDirection(current, nodes, event.key);
    if (!next) return;
    mapEditorSelectedNodeId = next.id;
    mapEditorCamera.x = next.x;
    mapEditorCamera.y = next.y;
    updateMapEditorCameraTransform(); // ★カメラを滑らかに移動
    updateMapEditorCursorVisual(next); // ★カーソルの丸を該当ノードへ
  } else if (KEY_CONFIG.decideKeys.includes(event.key)) {
    event.preventDefault();
    handleMapEditorNodeActivate(current);
  } else if (KEY_CONFIG.cancelKeys.includes(event.key) && mapEditorConnectMode) {
    event.preventDefault();
    mapEditorConnectMode = false;
    mapEditorConnectFirstId = null;
    renderScenarioBuildPanel();
  }
}

// ★一覧では詳しい項目は出さず、名前・種類・編集/削除ボタンだけの簡潔な行にする（詳細は専用エディタ側で）
function buildMapAreaSummaryRow(area, index) {
  const row = document.createElement("div");
  row.className = "scenariobuild-chapter-row";
  
  const numberEl = document.createElement("span");
  numberEl.className = "scenariobuild-chapter-number";
  numberEl.textContent = area.builtin ? "組み込み" : (MAP_AREA_TYPES[area.type] || area.type);
  
  const infoEl = document.createElement("div");
  infoEl.className = "scenariobuild-chapter-info";
  const nameEl = document.createElement("p");
  nameEl.className = "scenariobuild-title-input";
  nameEl.style.background = "none";
  nameEl.style.border = "none";
  nameEl.textContent = (area.name || "（名前未設定）") + (area.unimplemented && (area.type === "placeholder" || area.type === "unknown") ? "　【未実装】" : "");
  infoEl.appendChild(nameEl);
  
  const buttonsEl = document.createElement("div");
  buttonsEl.className = "scenariobuild-chapter-buttons";
  
  const editBtn = document.createElement("button");
  editBtn.className = "devmode-btn";
  editBtn.textContent = "編集";
  editBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildEditingMapAreaId = area.id;
    scenarioBuildMainView = "mapEditor";
    renderScenarioBuildPanel();
  };
  buttonsEl.appendChild(editBtn);
  
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "devmode-btn devmode-btn-danger";
  deleteBtn.textContent = "削除";
  deleteBtn.onclick = async (event) => {
    event.stopPropagation();
    const ok = await showGameConfirm(`「${area.name}」を削除しますか？`);
    if (!ok) return;
    pushUndoSnapshot();
    if (area.builtin && area.locationKey && !scenarioProject.deletedBuiltinIds.mapAreas.includes(area.locationKey)) {
      scenarioProject.deletedBuiltinIds.mapAreas.push(area.locationKey); // ★これが無いと、次回開いた時に自動で復活してしまう
    }
    removeMapEdgesForNodeId(area.builtin ? area.locationKey : "custom_" + area.id); // ★このエリアにつながっていた線も一緒に消す
    scenarioProject.mapAreas.splice(index, 1);
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  buttonsEl.appendChild(deleteBtn);
  
  row.appendChild(numberEl);
  row.appendChild(infoEl);
  row.appendChild(buttonsEl);
  return row;
}

// ===================================================================
// ===== メイン画面：マップ詳細エディタ（専用全画面。scenarioBuildMainView === "mapEditor"） =====
// ===================================================================
function renderMapAreaEditor(container) {
  const index = scenarioProject.mapAreas.findIndex(a => a.id === scenarioBuildEditingMapAreaId);
  const area = scenarioProject.mapAreas[index];
  
  const backBtn = document.createElement("button");
  backBtn.className = "devmode-btn";
  backBtn.textContent = "← マップ一覧に戻る";
  backBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildMainView = "maps";
    scenarioBuildEditingMapAreaId = null;
    renderScenarioBuildPanel();
  };
  container.appendChild(backBtn);
  
  if (!area) {
    scenarioBuildMainView = "maps";
    renderScenarioBuildPanel();
    return;
  }
  
  const titleEl = document.createElement("h3");
  titleEl.textContent = (area.builtin ? "組み込みマップの編集：" : "エリアの編集：") + (area.name || "（名前未設定）");
  container.appendChild(titleEl);
  
  const formWrap = document.createElement("div");
  formWrap.className = "scenariobuild-list";
  formWrap.appendChild(buildMapAreaCard(area, index));
  container.appendChild(formWrap);
}

// ★配置イメージをつかむための簡易プレビュー（読み取り専用。ドラッグでの移動には対応していない）

function buildMapAreaCard(area, index) {
  const isHubArea = area.locationKey === "village"; // ★村（現在地）自体の拠点データ
  const isBaseArea = isHubArea || ["village", "city", "country"].includes(area.type); // ★施設をアタッチできる「拠点」扱いのエリア
  
  const row = document.createElement("div");
  row.className = "scenariobuild-chapter-row" + (area.builtin ? " scenariobuild-chapter-row-builtin" : "");
  
  const numberEl = document.createElement("span");
  numberEl.className = "scenariobuild-chapter-number";
  numberEl.textContent = isHubArea ? "現在地" : area.builtin ? "組み込み" : (MAP_AREA_TYPES[area.type] || area.type);
  
  const infoEl = document.createElement("div");
  infoEl.className = "scenariobuild-chapter-info";
  
  const persist = () => markScenarioBuildDirty();
  
  // 名前
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "scenariobuild-title-input";
  nameInput.placeholder = "エリア名";
  nameInput.value = area.name;
  nameInput.onchange = () => { area.name = nameInput.value.trim() || area.name; persist(); };
  infoEl.appendChild(nameInput);
  
  if (isHubArea) {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note scenariobuild-condition";
    noteEl.textContent = "プレイヤーの現在地（カリの村）です。名前・BGM・背景・ここに置く施設のアタッチが編集できます。";
    infoEl.appendChild(noteEl);
  } else if (area.builtin) {
    const noteEl = document.createElement("p");
    noteEl.className = "devmode-note scenariobuild-condition";
    noteEl.textContent = "既存のマップ（森・草原・洞窟）です。「種類」は見た目のアイコンには影響しません。位置はマップエディタでドラッグ／キーボードの代わりに、ここで数値でも調整できます。";
    infoEl.appendChild(noteEl);
  }
  if (!isHubArea) {
    // 種類（見た目のアイコン種別として使う）
    const typeRow = document.createElement("div");
    typeRow.className = "scenariobuild-condition-row";
    typeRow.appendChild(labelSpan("種類："));
    const typeSelect = document.createElement("select");
    typeSelect.className = "scenariobuild-jump-select";
    Object.keys(MAP_AREA_TYPES).forEach(key => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = MAP_AREA_TYPES[key];
      typeSelect.appendChild(option);
    });
    typeSelect.value = area.type;
    typeSelect.onchange = () => { area.type = typeSelect.value; persist(); renderScenarioBuildPanel(); };
    typeRow.appendChild(typeSelect);
    infoEl.appendChild(typeRow);
    
    if (area.type === "scenario") {
      const scenarioNoteEl = document.createElement("p");
      scenarioNoteEl.className = "devmode-note scenariobuild-condition";
      scenarioNoteEl.textContent = "探索や施設一覧を出さない、話の演出専用のエリアです。指定した回数目に来た時、話管理側で「始まるきっかけ：指定したエリアに来た時」をこのエリア・同じ回数に設定した話があれば自動的に始まります。それ以外の回に来た時は、下のメッセージだけ表示して村に戻ります。";
      infoEl.appendChild(scenarioNoteEl);
      
      const visitNumRow = document.createElement("div");
      visitNumRow.className = "scenariobuild-condition-row";
      visitNumRow.appendChild(labelSpan("話が始まるのは："));
      const visitNumInput = document.createElement("input");
      visitNumInput.type = "number";
      visitNumInput.min = "1";
      visitNumInput.className = "scenariobuild-condition-input";
      visitNumInput.value = area.scenarioVisitNumber || 1;
      visitNumInput.onchange = () => { area.scenarioVisitNumber = Math.max(1, Number(visitNumInput.value) || 1); persist(); };
      visitNumRow.appendChild(visitNumInput);
      visitNumRow.appendChild(labelSpan("回目に来た時（話管理側の設定と合わせてください）"));
      infoEl.appendChild(visitNumRow);
      
      const nonScenarioRow = document.createElement("div");
      nonScenarioRow.className = "scenariobuild-condition-row";
      nonScenarioRow.appendChild(labelSpan("それ以外の回に来た時のメッセージ："));
      const nonScenarioInput = document.createElement("input");
      nonScenarioInput.type = "text";
      nonScenarioInput.className = "scenariobuild-title-input";
      nonScenarioInput.placeholder = "例：特に何もないようだ。";
      nonScenarioInput.value = area.nonScenarioMessage || "";
      nonScenarioInput.onchange = () => { area.nonScenarioMessage = nonScenarioInput.value; persist(); };
      nonScenarioRow.appendChild(nonScenarioInput);
      infoEl.appendChild(nonScenarioRow);
    }
    
    // ★このエリアの「来た回数」を、マップから来るたびに自動で増やすか、専用ブロックでのみ増やすか
    const visitModeRow = document.createElement("div");
    visitModeRow.className = "scenariobuild-condition-row";
    visitModeRow.appendChild(labelSpan("来訪回数の増やし方："));
    const visitModeSelect = document.createElement("select");
    visitModeSelect.className = "scenariobuild-jump-select";
    [["auto", "自動（マップからこのエリアに来るたびに増える）"], ["manual", "手動（「エリアに来た回数を増やす」ブロックでのみ増える）"]].forEach(([value, label]) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      visitModeSelect.appendChild(opt);
    });
    visitModeSelect.value = area.visitCountMode === "manual" ? "manual" : "auto";
    visitModeSelect.onchange = () => { area.visitCountMode = visitModeSelect.value; persist(); };
    visitModeRow.appendChild(visitModeSelect);
    infoEl.appendChild(visitModeRow);
  }
  
  if (!isHubArea) {
    // 位置
    const posRow = document.createElement("div");
    posRow.className = "scenariobuild-condition-row";
    posRow.appendChild(labelSpan("位置 X："));
    const xInput = document.createElement("input");
    xInput.type = "number";
    xInput.className = "scenariobuild-condition-input";
    xInput.value = area.x;
    xInput.onchange = () => { area.x = Number(xInput.value) || 0; persist(); renderScenarioBuildPanel(); };
    posRow.appendChild(xInput);
    posRow.appendChild(labelSpan("Y："));
    const yInput = document.createElement("input");
    yInput.type = "number";
    yInput.className = "scenariobuild-condition-input";
    yInput.value = area.y;
    yInput.onchange = () => { area.y = Number(yInput.value) || 0; persist(); renderScenarioBuildPanel(); };
    posRow.appendChild(yInput);
    infoEl.appendChild(posRow);
  }
  
  // マップ上の大きさ（村も含め全エリアで表示）
  const sizeRow = document.createElement("div");
  sizeRow.className = "scenariobuild-condition-row";
  sizeRow.appendChild(labelSpan("マップ上の大きさ（空欄＝種類ごとの既定値）："));
  const sizeInput = document.createElement("input");
  sizeInput.type = "number";
  sizeInput.min = "3";
  sizeInput.max = "20";
  sizeInput.className = "scenariobuild-condition-input";
  sizeInput.placeholder = "既定";
  sizeInput.value = (typeof area.mapNodeSize === "number") ? area.mapNodeSize : "";
  sizeRow.appendChild(sizeInput);
  
  const defaultSize = area.type === "country" ? 12 : area.type === "city" ? 10 : area.type === "enemy" ? 7 : 9;
  const previewSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  previewSvg.setAttribute("viewBox", "0 0 44 44");
  previewSvg.setAttribute("class", "mapeditor-size-preview");
  const previewCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  previewCircle.setAttribute("cx", "22");
  previewCircle.setAttribute("cy", "22");
  previewCircle.setAttribute("fill", "var(--accent-color, #7ecbff)");
  const updateSizePreview = () => {
    const raw = sizeInput.value.trim();
    const size = raw === "" ? defaultSize : Math.max(3, Math.min(20, Math.floor(Number(raw)) || defaultSize));
    previewCircle.setAttribute("r", String(size));
  };
  updateSizePreview();
  previewSvg.appendChild(previewCircle);
  sizeRow.appendChild(previewSvg);
  
  sizeInput.oninput = () => {
    updateSizePreview();
    if (area.id && typeof renderAdventureMap === "function") {
      const nodeEl = document.querySelector(`[data-node-id="${area.id}"]`);
      if (nodeEl) {
        const raw = sizeInput.value.trim();
        const defaultSize = area.type === "country" ? 12 : area.type === "city" ? 10 : area.type === "enemy" ? 7 : 9;
        const size = raw === "" ? defaultSize : Math.max(3, Math.min(20, Math.floor(Number(raw)) || defaultSize));
        const circle = nodeEl.querySelector("circle");
        if (circle) circle.setAttribute("r", String(size));
      }
    }
  };
  sizeInput.onchange = () => {
    const num = Number(sizeInput.value);
    area.mapNodeSize = sizeInput.value.trim() === "" ? null : Math.max(3, Math.min(20, Math.floor(num) || 9));
    persist();
    updateSizePreview();
    if (typeof renderAdventureMap === "function") renderAdventureMap();
  };
  infoEl.appendChild(sizeRow);
  
  // BGM・背景
  if (!isHubArea) infoEl.appendChild(buildMapAreaUnlockConditionsEditor(area, persist));
  
  const bgTrackInput = document.createElement("input");
  bgTrackInput.type = "text";
  bgTrackInput.className = "scenariobuild-title-input";
  bgTrackInput.placeholder = "BGM（曲名 or ファイルパス）";
  bgTrackInput.value = area.bgTrack;
  bgTrackInput.setAttribute("list", "scenariobuild-bgm-datalist");
  bgTrackInput.onchange = () => { area.bgTrack = bgTrackInput.value.trim(); persist(); };
  infoEl.appendChild(bgTrackInput);
  
  const bgImageInput = document.createElement("input");
  bgImageInput.type = "text";
  bgImageInput.className = "scenariobuild-title-input";
  bgImageInput.placeholder = "背景画像のファイルパス（例：img/村.jpeg）";
  bgImageInput.value = area.bgImage;
  bgImageInput.onchange = () => { area.bgImage = bgImageInput.value.trim(); persist(); };
  infoEl.appendChild(bgImageInput);
  
  // ★拠点（村・街・国）には、施設編集タブで作った施設をアタッチできる（複数可）
  if (isBaseArea) {
    infoEl.appendChild(buildFacilityAttachEditor(area, persist));
  }
  
  if (!isHubArea) {
    // 出る敵（+ボタンで追加）
    infoEl.appendChild(buildTagListEditor({
      label: "出現する敵：",
      items: area.enemyIds,
      datalistId: "scenariobuild-monster-datalist",
      placeholder: "敵ID",
      onChange: persist
    }));
    
    // ★出現する敵のレベル：以前は主人公のレベルに合わせて敵も強くなっていたが、ここで固定できるようにする
    const levelRow = document.createElement("div");
    levelRow.className = "scenariobuild-condition-row";
    levelRow.appendChild(labelSpan("出現する敵のレベル（固定）："));
    const levelInput = document.createElement("input");
    levelInput.type = "number";
    levelInput.min = "1";
    levelInput.className = "scenariobuild-condition-input";
    levelInput.placeholder = "空欄＝主人公基準";
    levelInput.value = area.enemyLevel != null ? area.enemyLevel : "";
    levelInput.onchange = () => { area.enemyLevel = levelInput.value ? Math.max(1, Number(levelInput.value) || 1) : null; persist(); };
    levelRow.appendChild(levelInput);
    infoEl.appendChild(levelRow);
  }
  
  if (!isHubArea && (!area.builtin || area.unimplemented)) {
    // ボス
    const bossInput = document.createElement("input");
    bossInput.type = "text";
    bossInput.className = "scenariobuild-title-input";
    bossInput.placeholder = "このエリアのボスID（任意。ボス設定タブ参照）";
    bossInput.value = area.bossId;
    bossInput.setAttribute("list", "scenariobuild-monster-datalist");
    bossInput.onchange = () => { area.bossId = bossInput.value.trim(); persist(); };
    infoEl.appendChild(bossInput);
    
    // ★エリアボスの出現方式（歩数進んだら確率で／調べた時に、複数選択可）と、それぞれの確率。
    //   要望対応：アヌスの洞窟のような「歩数」方式と、ガマジルの草原のような「調べた時」方式を選べるようにする
    infoEl.appendChild(buildBossTriggerTypeEditor(area, persist));
    
    // 見つかるアイテム
    infoEl.appendChild(buildTagListEditor({
      label: "見つかるアイテム：",
      items: area.items,
      datalistId: "scenariobuild-item-datalist",
      placeholder: "アイテムID",
      onChange: persist
    }));
    
    // ★見つかるお金（陳）。要望対応：「調べる」でお金を獲得できるようにする
    infoEl.appendChild(buildGoldRewardListEditor(area, persist));
    
    // ★見つかる施設。要望対応：「調べる」で指定した施設が出せるように
    infoEl.appendChild(buildFacilitySpawnListEditor(area, persist));
    
    // 調べた時のメッセージ（複数登録すると毎回ランダムに1つ表示される）
    infoEl.appendChild(buildExamineMessageListEditor(area, persist));
    
    // 戦闘バリエーション
    infoEl.appendChild(buildBattleVariationEditor(area, persist));
  }
  
  const buttonsEl = document.createElement("div");
  buttonsEl.className = "scenariobuild-chapter-buttons";
  
  if (!isHubArea) {
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "devmode-btn devmode-btn-danger";
    deleteBtn.textContent = "削除";
    deleteBtn.onclick = async (event) => {
      event.stopPropagation();
      const ok = await showGameConfirm(`「${area.name}」を削除しますか？`);
      if (!ok) return;
      pushUndoSnapshot();
      if (area.builtin && area.locationKey && !scenarioProject.deletedBuiltinIds.mapAreas.includes(area.locationKey)) {
        scenarioProject.deletedBuiltinIds.mapAreas.push(area.locationKey); // ★これが無いと、次回開いた時に自動で復活してしまう
      }
      removeMapEdgesForNodeId(area.builtin ? area.locationKey : "custom_" + area.id); // ★このエリアにつながっていた線も一緒に消す
      scenarioProject.mapAreas.splice(index, 1);
      markScenarioBuildDirty();
      renderScenarioBuildPanel();
    };
    buttonsEl.appendChild(deleteBtn);
  }
  
  row.appendChild(numberEl);
  row.appendChild(infoEl);
  row.appendChild(buttonsEl);
  return row;
}

// ★拠点（村・街・国）に、施設編集タブで作った施設をチェックボックスでアタッチする（複数可）
function buildFacilityAttachEditor(area, persist) {
  const wrap = document.createElement("div");
  wrap.className = "scenariobuild-skill-details";
  wrap.style.display = "block";
  
  const heading = document.createElement("p");
  heading.className = "devmode-note";
  heading.style.margin = "0 0 6px 0";
  heading.textContent = "この拠点に置く施設（施設編集タブで作った施設から選択。複数選べます）：";
  wrap.appendChild(heading);
  
  if (!Array.isArray(area.facilityIds)) area.facilityIds = [];
  
  if (scenarioProject.facilities.length === 0) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "devmode-note scenariobuild-condition";
    emptyEl.textContent = "まだ施設がありません（施設編集タブから追加できます）。";
    wrap.appendChild(emptyEl);
    return wrap;
  }
  
  scenarioProject.facilities.forEach(facility => {
    const optionRow = document.createElement("label");
    optionRow.className = "scenariobuild-condition-row";
    optionRow.style.cursor = "pointer";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = area.facilityIds.includes(facility.id);
    checkbox.onchange = () => {
      if (checkbox.checked) {
        if (!area.facilityIds.includes(facility.id)) area.facilityIds.push(facility.id);
      } else {
        area.facilityIds = area.facilityIds.filter(id => id !== facility.id);
      }
      persist();
    };
    optionRow.appendChild(checkbox);
    optionRow.appendChild(document.createTextNode(` ${facility.name || "（名前未設定）"}（${FACILITY_TYPE_LABELS[facility.type] || facility.type}）`));
    wrap.appendChild(optionRow);
  });
  
  return wrap;
}

// ★「敵ID」「アイテムID」のような、複数件を+で追加していくタグリストの共通UI
// ★エリアの解放条件（unlockConditions）を編集するUI。条件は複数追加でき、全て満たすまで地図上で「？」表示になる
function buildMapAreaUnlockConditionsEditor(area, persist) {
  if (!Array.isArray(area.unlockConditions)) area.unlockConditions = [];
  
  const wrap = document.createElement("div");
  wrap.className = "scenariobuild-skill-details";
  wrap.style.display = "block"; // ★<details>ではなく常時表示のブロックなので、折りたたみ用のstyleを打ち消す
  
  const heading = document.createElement("p");
  heading.className = "devmode-note";
  heading.style.margin = "0 0 6px 0";
  heading.textContent = "解放条件（全て満たすまで、地図上で「？」になり入れません。条件が1つも無ければ最初から解放済みです）：";
  wrap.appendChild(heading);
  
  const CONDITION_TYPES = {
    chapterCleared: "指定した話をクリアした",
    flag: "指定したフラグが立った",
    enemyKills: "指定した／全ての敵をn体倒した",
    questCleared: "特定のクエストをクリアした",
    daysSinceTransfer: "転移してからn日経過した"
  };
  
  area.unlockConditions.forEach((cond, condIndex) => {
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    
    const typeSelect = document.createElement("select");
    typeSelect.className = "scenariobuild-jump-select";
    Object.keys(CONDITION_TYPES).forEach(t => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = CONDITION_TYPES[t];
      typeSelect.appendChild(opt);
    });
    typeSelect.value = cond.type || "flag";
    typeSelect.onchange = () => {
      const newType = typeSelect.value;
      area.unlockConditions[condIndex] = { type: newType }; // ★種類を変えたら、他の種類のフィールドは持ち越さずリセットする
      persist();
      renderScenarioBuildPanel();
    };
    row.appendChild(typeSelect);
    
    if (cond.type === "chapterCleared") {
      const chapterSelect = document.createElement("select");
      chapterSelect.className = "scenariobuild-jump-select";
      scenarioProject.chapters.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.title;
        chapterSelect.appendChild(opt);
      });
      chapterSelect.value = cond.chapterId || (scenarioProject.chapters[0] && scenarioProject.chapters[0].id) || "";
      chapterSelect.onchange = () => { cond.chapterId = chapterSelect.value; persist(); };
      row.appendChild(chapterSelect);
    } else if (cond.type === "flag") {
      const flagInput = document.createElement("input");
      flagInput.type = "text";
      flagInput.className = "scenariobuild-title-input";
      flagInput.placeholder = "フラグ名";
      flagInput.value = cond.flag || "";
      flagInput.onchange = () => { cond.flag = flagInput.value.trim(); persist(); };
      row.appendChild(flagInput);
    } else if (cond.type === "enemyKills") {
      const monsterInput = document.createElement("input");
      monsterInput.type = "text";
      monsterInput.className = "scenariobuild-title-input";
      monsterInput.placeholder = "敵ID（空欄＝全ての敵の合計）";
      monsterInput.value = cond.monsterKey || "";
      monsterInput.setAttribute("list", "scenariobuild-monster-datalist");
      monsterInput.onchange = () => { cond.monsterKey = monsterInput.value.trim(); persist(); };
      row.appendChild(monsterInput);
      row.appendChild(labelSpan("を"));
      const countInput = document.createElement("input");
      countInput.type = "number";
      countInput.min = "1";
      countInput.className = "scenariobuild-condition-input";
      countInput.value = cond.count || 1;
      countInput.onchange = () => { cond.count = Math.max(1, Number(countInput.value) || 1); persist(); };
      row.appendChild(countInput);
      row.appendChild(labelSpan("体倒した"));
    } else if (cond.type === "questCleared") {
      const questSelect = document.createElement("select");
      questSelect.className = "scenariobuild-jump-select";
      (typeof QUEST_BOARD_MASTER !== "undefined" ? QUEST_BOARD_MASTER : []).forEach(q => {
        const opt = document.createElement("option");
        opt.value = q.id;
        opt.textContent = q.title;
        questSelect.appendChild(opt);
      });
      questSelect.value = cond.questId || (typeof QUEST_BOARD_MASTER !== "undefined" && QUEST_BOARD_MASTER[0] && QUEST_BOARD_MASTER[0].id) || "";
      questSelect.onchange = () => { cond.questId = questSelect.value; persist(); };
      row.appendChild(questSelect);
    } else if (cond.type === "daysSinceTransfer") {
      row.appendChild(labelSpan("転移から："));
      const daysInput = document.createElement("input");
      daysInput.type = "number";
      daysInput.min = "1";
      daysInput.className = "scenariobuild-condition-input";
      daysInput.value = cond.days || 1;
      daysInput.onchange = () => { cond.days = Math.max(1, Math.floor(Number(daysInput.value)) || 1); persist(); };
      row.appendChild(daysInput);
      row.appendChild(document.createTextNode(" 日以上経過した"));
    }
    
    const removeBtn = document.createElement("button");
    removeBtn.className = "devmode-btn devmode-btn-danger";
    removeBtn.textContent = "×";
    removeBtn.onclick = (event) => {
      event.stopPropagation();
      area.unlockConditions.splice(condIndex, 1);
      persist();
      renderScenarioBuildPanel();
    };
    row.appendChild(removeBtn);
    
    wrap.appendChild(row);
  });
  
  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋解放条件を追加";
  addBtn.onclick = (event) => {
    event.stopPropagation();
    area.unlockConditions.push({ type: "flag", flag: "" });
    persist();
    renderScenarioBuildPanel();
  };
  wrap.appendChild(addBtn);
  
  return wrap;
}

// ★「調べる」メッセージのバリエーション編集。複数登録しておくと、実際の「調べる」のたびに
//   ランダムで1つ表示される（敵エリアの場合はさらに、これとは別に一定確率で「特に何も見つからなかった。」になる）
// ★「調べる」で見つかるお金（陳）の報酬候補一覧を編集する。獲得アイテムと同じく、複数登録・追加・削除ができる。
//   各候補は「確率(chance、0〜1)」と「獲得量（min〜max、ランダム）」を持つ。上から順に抽選し、
//   最初に確率を引き当てた候補の金額だけが渡される（adventure.jsのexamineCustomArea参照）
function buildGoldRewardListEditor(area, persist) {
  const wrap = document.createElement("div");
  wrap.className = "mapareas-variations";
  
  const labelEl = document.createElement("p");
  labelEl.className = "devmode-note scenariobuild-condition";
  labelEl.textContent = "「調べる」で見つかるお金（陳）の候補（獲得アイテムとは別に、それぞれ独立した確率で抽選されます。上から順に見て、最初に当たった候補の金額だけ渡ります）：";
  wrap.appendChild(labelEl);
  
  if (!Array.isArray(area.goldRewards)) area.goldRewards = [];
  
  area.goldRewards.forEach((reward, index) => {
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    row.style.flexWrap = "wrap";
    
    row.appendChild(labelSpan("確率："));
    const chanceInput = document.createElement("input");
    chanceInput.type = "number";
    chanceInput.step = "0.01";
    chanceInput.min = "0";
    chanceInput.max = "1";
    chanceInput.className = "scenariobuild-condition-input";
    chanceInput.value = reward.chance != null ? reward.chance : 0.2;
    chanceInput.onchange = () => { reward.chance = Math.max(0, Math.min(1, Number(chanceInput.value) || 0)); persist(); };
    row.appendChild(chanceInput);
    
    row.appendChild(labelSpan("最小："));
    const minInput = document.createElement("input");
    minInput.type = "number";
    minInput.className = "scenariobuild-condition-input";
    minInput.value = reward.min != null ? reward.min : 0;
    minInput.onchange = () => { reward.min = Number(minInput.value) || 0; persist(); };
    row.appendChild(minInput);
    
    row.appendChild(labelSpan("最大："));
    const maxInput = document.createElement("input");
    maxInput.type = "number";
    maxInput.className = "scenariobuild-condition-input";
    maxInput.value = reward.max != null ? reward.max : 0;
    maxInput.onchange = () => { reward.max = Number(maxInput.value) || 0; persist(); };
    row.appendChild(maxInput);
    
    const removeBtn = document.createElement("button");
    removeBtn.className = "devmode-btn devmode-btn-danger";
    removeBtn.textContent = "×";
    removeBtn.onclick = (event) => {
      event.stopPropagation();
      pushUndoSnapshot();
      area.goldRewards.splice(index, 1);
      persist();
      renderScenarioBuildPanel();
    };
    row.appendChild(removeBtn);
    
    wrap.appendChild(row);
  });
  
  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋ お金の候補を追加";
  addBtn.onclick = (event) => {
    event.stopPropagation();
    pushUndoSnapshot();
    area.goldRewards.push({ chance: 0.2, min: 10, max: 30 });
    persist();
    renderScenarioBuildPanel();
  };
  wrap.appendChild(addBtn);
  
  return wrap;
}

// ★エリアボスの出現方式（複数選択可）と、それぞれの確率を編集する
function buildBossTriggerTypeEditor(area, persist) {
  const wrap = document.createElement("div");
  wrap.className = "mapareas-variations";
  
  const labelEl = document.createElement("p");
  labelEl.className = "devmode-note scenariobuild-condition";
  labelEl.textContent = "↑のボスの出現方式（複数選択可。未設定の場合は「歩数」のみとして扱われます）：";
  wrap.appendChild(labelEl);
  
  if (!Array.isArray(area.bossTriggerTypes) || area.bossTriggerTypes.length === 0) area.bossTriggerTypes = ["step"];
  
  const stepRow = document.createElement("label");
  stepRow.className = "scenariobuild-condition-row";
  stepRow.style.cursor = "pointer";
  const stepCheckbox = document.createElement("input");
  stepCheckbox.type = "checkbox";
  stepCheckbox.checked = area.bossTriggerTypes.includes("step");
  stepCheckbox.onchange = () => {
    if (stepCheckbox.checked) { if (!area.bossTriggerTypes.includes("step")) area.bossTriggerTypes.push("step"); }
    else { area.bossTriggerTypes = area.bossTriggerTypes.filter(t => t !== "step"); }
    persist();
  };
  stepRow.appendChild(stepCheckbox);
  stepRow.appendChild(document.createTextNode(" 歩数を進んだら確率で（アヌスの洞窟方式）　確率："));
  const stepChanceInput = document.createElement("input");
  stepChanceInput.type = "number";
  stepChanceInput.step = "0.01";
  stepChanceInput.min = "0";
  stepChanceInput.max = "1";
  stepChanceInput.className = "scenariobuild-condition-input";
  stepChanceInput.value = area.bossStepChance != null ? area.bossStepChance : 0.08;
  stepChanceInput.onclick = (event) => event.stopPropagation(); // ★ラベル全体クリックでチェックボックスが誤反応しないようにする
  stepChanceInput.onchange = () => { area.bossStepChance = Math.max(0, Math.min(1, Number(stepChanceInput.value) || 0)); persist(); };
  stepRow.appendChild(stepChanceInput);
  wrap.appendChild(stepRow);
  
  const examineRow = document.createElement("label");
  examineRow.className = "scenariobuild-condition-row";
  examineRow.style.cursor = "pointer";
  const examineCheckbox = document.createElement("input");
  examineCheckbox.type = "checkbox";
  examineCheckbox.checked = area.bossTriggerTypes.includes("examine");
  examineCheckbox.onchange = () => {
    if (examineCheckbox.checked) { if (!area.bossTriggerTypes.includes("examine")) area.bossTriggerTypes.push("examine"); }
    else { area.bossTriggerTypes = area.bossTriggerTypes.filter(t => t !== "examine"); }
    persist();
  };
  examineRow.appendChild(examineCheckbox);
  examineRow.appendChild(document.createTextNode(" 調べた時に（ガマジルの草原方式）　確率："));
  const examineChanceInput = document.createElement("input");
  examineChanceInput.type = "number";
  examineChanceInput.step = "0.01";
  examineChanceInput.min = "0";
  examineChanceInput.max = "1";
  examineChanceInput.className = "scenariobuild-condition-input";
  examineChanceInput.value = area.bossExamineChance != null ? area.bossExamineChance : 0.15;
  examineChanceInput.onclick = (event) => event.stopPropagation();
  examineChanceInput.onchange = () => { area.bossExamineChance = Math.max(0, Math.min(1, Number(examineChanceInput.value) || 0)); persist(); };
  examineRow.appendChild(examineChanceInput);
  wrap.appendChild(examineRow);
  
  return wrap;
}

// ★「調べる」で見つかる施設の候補一覧を編集する。お金の候補と同じ形式（確率つき、複数登録・追加削除可）で、
//   施設は今シナリオに登録済みの施設一覧から選ぶ（要望対応）
function buildFacilitySpawnListEditor(area, persist) {
  const wrap = document.createElement("div");
  wrap.className = "mapareas-variations";
  
  const labelEl = document.createElement("p");
  labelEl.className = "devmode-note scenariobuild-condition";
  labelEl.textContent = "「調べる」で見つかる施設の候補（見つかるとその場で入店できます。上から順に見て、最初に当たった候補だけが現れます）：";
  wrap.appendChild(labelEl);
  
  if (!Array.isArray(area.facilitySpawns)) area.facilitySpawns = [];
  const facilities = (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.facilities)) ? scenarioProject.facilities : [];
  
  area.facilitySpawns.forEach((spawn, index) => {
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    row.style.flexWrap = "wrap";
    
    row.appendChild(labelSpan("施設："));
    const facilitySelect = document.createElement("select");
    facilitySelect.className = "scenariobuild-jump-select";
    if (facilities.length === 0) {
      const optionEl = document.createElement("option");
      optionEl.value = "";
      optionEl.textContent = "（まだ施設がありません。施設編集タブで先に作ってください）";
      facilitySelect.appendChild(optionEl);
    } else {
      facilities.forEach(facility => {
        const optionEl = document.createElement("option");
        optionEl.value = facility.id;
        optionEl.textContent = facility.name || "？";
        facilitySelect.appendChild(optionEl);
      });
    }
    facilitySelect.value = spawn.facilityId || (facilities[0] ? facilities[0].id : "");
    facilitySelect.onchange = () => { spawn.facilityId = facilitySelect.value; persist(); };
    row.appendChild(facilitySelect);
    
    row.appendChild(labelSpan("確率："));
    const chanceInput = document.createElement("input");
    chanceInput.type = "number";
    chanceInput.step = "0.01";
    chanceInput.min = "0";
    chanceInput.max = "1";
    chanceInput.className = "scenariobuild-condition-input";
    chanceInput.value = spawn.chance != null ? spawn.chance : 0.1;
    chanceInput.onchange = () => { spawn.chance = Math.max(0, Math.min(1, Number(chanceInput.value) || 0)); persist(); };
    row.appendChild(chanceInput);
    
    const removeBtn = document.createElement("button");
    removeBtn.className = "devmode-btn devmode-btn-danger";
    removeBtn.textContent = "×";
    removeBtn.onclick = (event) => {
      event.stopPropagation();
      pushUndoSnapshot();
      area.facilitySpawns.splice(index, 1);
      persist();
      renderScenarioBuildPanel();
    };
    row.appendChild(removeBtn);
    
    wrap.appendChild(row);
  });
  
  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋施設の候補を追加";
  addBtn.onclick = (event) => {
    event.stopPropagation();
    if (facilities.length === 0) { alert("先に施設編集タブで施設を作ってください。"); return; }
    pushUndoSnapshot();
    area.facilitySpawns.push({ facilityId: facilities[0].id, chance: 0.1 });
    persist();
    renderScenarioBuildPanel();
  };
  wrap.appendChild(addBtn);
  
  return wrap;
}

function buildExamineMessageListEditor(area, persist) {
  const wrap = document.createElement("div");
  wrap.className = "mapareas-variations";
  
  const labelEl = document.createElement("p");
  labelEl.className = "devmode-note scenariobuild-condition";
  labelEl.textContent = "「調べる」を選んだ時のメッセージ（複数登録すると、その中からランダムで1つ表示されます。敵エリアではこれとは別に、一定確率で「特に何も見つからなかった。」になります）：";
  wrap.appendChild(labelEl);
  
  if (!Array.isArray(area.examineMessages)) area.examineMessages = [];
  
  area.examineMessages.forEach((msg, index) => {
    const row = document.createElement("div");
    row.className = "scenariobuild-condition-row";
    const textarea = document.createElement("textarea");
    textarea.className = "scenariobuild-textarea";
    textarea.placeholder = `メッセージ ${index + 1}`;
    textarea.value = msg;
    textarea.onchange = () => { area.examineMessages[index] = textarea.value; persist(); };
    row.appendChild(textarea);
    
    const removeBtn = document.createElement("button");
    removeBtn.className = "devmode-btn devmode-btn-danger";
    removeBtn.textContent = "×";
    removeBtn.onclick = (event) => {
      event.stopPropagation();
      pushUndoSnapshot();
      area.examineMessages.splice(index, 1);
      persist();
      renderScenarioBuildPanel();
    };
    row.appendChild(removeBtn);
    
    wrap.appendChild(row);
  });
  
  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋ メッセージを追加";
  addBtn.onclick = (event) => {
    event.stopPropagation();
    pushUndoSnapshot();
    area.examineMessages.push("");
    persist();
    renderScenarioBuildPanel();
  };
  wrap.appendChild(addBtn);
  
  return wrap;
}

function buildTagListEditor(options) {
  const wrap = document.createElement("div");
  wrap.className = "mapareas-taglist";
  
  const labelEl = document.createElement("p");
  labelEl.className = "devmode-note scenariobuild-condition";
  labelEl.textContent = options.label;
  wrap.appendChild(labelEl);
  
  const chipsRow = document.createElement("div");
  chipsRow.className = "mapareas-taglist-chips";
  options.items.forEach((value, i) => {
    const chip = document.createElement("span");
    chip.className = "mapareas-taglist-chip";
    chip.textContent = value;
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "×";
    removeBtn.onclick = (event) => {
      event.stopPropagation();
      pushUndoSnapshot();
      options.items.splice(i, 1);
      options.onChange();
      renderScenarioBuildPanel();
    };
    chip.appendChild(removeBtn);
    chipsRow.appendChild(chip);
  });
  wrap.appendChild(chipsRow);
  
  const addRow = document.createElement("div");
  addRow.className = "scenariobuild-condition-row";
  const atMax = options.maxItems && options.items.length >= options.maxItems;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "scenariobuild-title-input";
  input.placeholder = atMax ? `最大${options.maxItems}件まで` : options.placeholder;
  input.disabled = !!atMax;
  input.setAttribute("list", options.datalistId);
  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋";
  addBtn.disabled = !!atMax;
  const submit = () => {
    if (options.maxItems && options.items.length >= options.maxItems) return;
    const value = input.value.trim();
    if (!value) return;
    pushUndoSnapshot();
    options.items.push(value);
    options.onChange();
    renderScenarioBuildPanel();
  };
  addBtn.onclick = (event) => { event.stopPropagation(); submit(); };
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") submit(); });
  addRow.appendChild(input);
  addRow.appendChild(addBtn);
  wrap.appendChild(addRow);
  
  return wrap;
}

// ★戦闘バリエーション：特定の敵の組み合わせ（例：ゴブリン2体＋コウモリ1体）を複数パターン登録し、
//   遭遇時にその中からランダム（重み付き）で選ばれる
function buildBattleVariationEditor(area, persist) {
  const wrap = document.createElement("div");
  wrap.className = "mapareas-variations";
  
  const labelEl = document.createElement("p");
  labelEl.className = "devmode-note scenariobuild-condition";
  labelEl.textContent = "戦闘バリエーション（特定の敵の組み合わせ。無ければ「出現する敵」から1種類だけがランダムに出ます）：";
  wrap.appendChild(labelEl);
  
  area.battleVariations.forEach((variation, vIndex) => {
    const card = document.createElement("div");
    card.className = "mapareas-variation-card";
    
    card.appendChild(buildTagListEditor({
      label: `パターン${vIndex + 1}：`,
      items: variation.enemyIds,
      datalistId: "scenariobuild-monster-datalist",
      placeholder: "敵ID",
      onChange: persist
    }));
    
    const weightRow = document.createElement("div");
    weightRow.className = "scenariobuild-condition-row";
    weightRow.appendChild(labelSpan("出やすさ（重み）："));
    const weightInput = document.createElement("input");
    weightInput.type = "number";
    weightInput.min = "1";
    weightInput.className = "scenariobuild-condition-input";
    weightInput.value = variation.weight || 1;
    weightInput.onchange = () => { variation.weight = Math.max(1, Number(weightInput.value) || 1); persist(); };
    weightRow.appendChild(weightInput);
    
    const removeBtn = document.createElement("button");
    removeBtn.className = "devmode-btn devmode-btn-danger";
    removeBtn.textContent = "このパターンを削除";
    removeBtn.onclick = async (event) => {
      event.stopPropagation();
      const ok = await showGameConfirm("このパターンを削除しますか？");
      if (!ok) return;
      pushUndoSnapshot();
      area.battleVariations.splice(vIndex, 1);
      persist();
      renderScenarioBuildPanel();
    };
    
    card.appendChild(weightRow);
    card.appendChild(removeBtn);
    wrap.appendChild(card);
  });
  
  const addVariationBtn = document.createElement("button");
  addVariationBtn.className = "devmode-btn";
  addVariationBtn.textContent = "＋戦闘パターンを追加";
  addVariationBtn.onclick = (event) => {
    event.stopPropagation();
    pushUndoSnapshot();
    area.battleVariations.push({ id: generateId("variation"), enemyIds: [], weight: 1 });
    persist();
    renderScenarioBuildPanel();
  };
  wrap.appendChild(addVariationBtn);
  
  return wrap;
}