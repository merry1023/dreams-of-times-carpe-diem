// floorplan.js
// 不動産システム（フェーズ3）：家の間取り（部屋・ドア）。
// ★構造の編集（部屋の追加・削除・サイズ・ドア設置）はシナリオエディタ側（開発者専用・renderFloorPlanEditor）。
//   実際の部屋間移動（・将来の家具配置）はゲームプレイ側（プレイヤー操作・openHouseInterior）。
// ★対象はarea.type === "estateHouse"のエリアのみ（不動産:店の中身はフェーズ4で別途実装）。

// ★部屋は「グリッド座標(x,y)に1部屋」というシンプルなマス目で管理する（見た目の大きさはwidth/height欄で
//   別途持つが、これは将来の家具配置マス目用。マップ上の隣接関係はグリッド座標だけで決まる）
const FLOORPLAN_DIRECTIONS = {
  north: { dx: 0, dy: -1, opposite: "south", label: "北" },
  south: { dx: 0, dy: 1, opposite: "north", label: "南" },
  east: { dx: 1, dy: 0, opposite: "west", label: "東" },
  west: { dx: -1, dy: 0, opposite: "east", label: "西" }
};

function makeNewFloorPlanRoom(x, y) {
  return {
    id: generateId("room"), // scenariobuild.js
    x, y,
    width: 4, height: 4, // ★家具配置マス目のサイズ（フェーズ2で使用）
    name: "",
    doors: { north: false, south: false, east: false, west: false }
  };
}

// ★家エリアが間取りデータを持っていなければ、部屋1つ（原点）で初期化する。
//   startRoomIdは「家に入った時にどの部屋から始まるか」の明示的な記録（部屋を削除した時にずれないようにするため）
function ensureFloorPlan(area) {
  if (!area.floorPlan || !Array.isArray(area.floorPlan.rooms) || area.floorPlan.rooms.length === 0) {
    const firstRoom = makeNewFloorPlanRoom(0, 0);
    area.floorPlan = { rooms: [firstRoom], startRoomId: firstRoom.id };
  }
  if (!area.floorPlan.startRoomId || !area.floorPlan.rooms.some(r => r.id === area.floorPlan.startRoomId)) {
    area.floorPlan.startRoomId = area.floorPlan.rooms[0].id;
  }
  return area.floorPlan;
}

function findFloorPlanRoomAt(floorPlan, x, y) {
  return floorPlan.rooms.find(r => r.x === x && r.y === y) || null;
}

// ★選択中の部屋の指定方向に、新しい部屋を追加する（既にその方向に部屋があれば何もしない）
function addFloorPlanRoom(area, fromRoomId, direction) {
  const floorPlan = ensureFloorPlan(area);
  const fromRoom = floorPlan.rooms.find(r => r.id === fromRoomId);
  const dir = FLOORPLAN_DIRECTIONS[direction];
  if (!fromRoom || !dir) return null;
  const nx = fromRoom.x + dir.dx, ny = fromRoom.y + dir.dy;
  if (findFloorPlanRoomAt(floorPlan, nx, ny)) return null;
  const newRoom = makeNewFloorPlanRoom(nx, ny);
  floorPlan.rooms.push(newRoom);
  return newRoom;
}

// ★部屋を削除する（最後の1部屋は削除不可）。隣接部屋側のドアも一緒にOFFにしておく。
//   削除した部屋が「開始部屋（startRoomId）」だった場合は、残った部屋のどれかへ付け替える
function deleteFloorPlanRoom(area, roomId) {
  const floorPlan = ensureFloorPlan(area);
  if (floorPlan.rooms.length <= 1) return false;
  const room = floorPlan.rooms.find(r => r.id === roomId);
  if (!room) return false;
  Object.keys(FLOORPLAN_DIRECTIONS).forEach(dir => {
    const { dx, dy, opposite } = FLOORPLAN_DIRECTIONS[dir];
    const neighbor = findFloorPlanRoomAt(floorPlan, room.x + dx, room.y + dy);
    if (neighbor) neighbor.doors[opposite] = false;
  });
  floorPlan.rooms = floorPlan.rooms.filter(r => r.id !== roomId);
  if (floorPlan.startRoomId === roomId) {
    floorPlan.startRoomId = floorPlan.rooms[0].id;
  }
  return true;
}

// ★ドアは両部屋で対になる1枚の壁の扉として扱う（片方の部屋からは見えるが反対側からは見えない、ということは無い）。
//   隣に部屋が無い方向へは設置できない
function toggleFloorPlanDoor(area, roomId, direction) {
  const floorPlan = ensureFloorPlan(area);
  const room = floorPlan.rooms.find(r => r.id === roomId);
  const dir = FLOORPLAN_DIRECTIONS[direction];
  if (!room || !dir) return;
  const neighbor = findFloorPlanRoomAt(floorPlan, room.x + dir.dx, room.y + dir.dy);
  if (!neighbor) return;
  const newState = !room.doors[direction];
  room.doors[direction] = newState;
  neighbor.doors[dir.opposite] = newState;
}

// ===================================================================
// ===== 開発者側：間取りエディタ（scenarioBuildMainView === "floorPlanEditor"） =====
// ===================================================================
function renderFloorPlanEditor(container) {
  const area = scenarioProject.mapAreas.find(a => a.id === scenarioBuildEditingMapAreaId);
  
  const backBtn = document.createElement("button");
  backBtn.className = "devmode-btn";
  backBtn.textContent = "← エリア編集に戻る";
  backBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildMainView = "mapEditor";
    renderScenarioBuildPanel();
  };
  container.appendChild(backBtn);
  
  if (!area) {
    scenarioBuildMainView = "maps";
    renderScenarioBuildPanel();
    return;
  }
  
  const floorPlan = ensureFloorPlan(area);
  if (!floorPlan.rooms.some(r => r.id === scenarioBuildSelectedRoomId)) {
    scenarioBuildSelectedRoomId = floorPlan.rooms[0].id;
  }
  const selectedRoom = floorPlan.rooms.find(r => r.id === scenarioBuildSelectedRoomId);
  
  const titleEl = document.createElement("h3");
  titleEl.textContent = "間取り編集：" + (area.name || "（名前未設定）");
  container.appendChild(titleEl);
  
  const noteEl = document.createElement("p");
  noteEl.className = "devmode-note";
  noteEl.textContent = "部屋をクリックして選択。選択した部屋の上下左右に「＋」で新しい部屋を追加できます。実際の部屋間移動・家具配置はプレイヤー側の操作です。";
  container.appendChild(noteEl);
  
  container.appendChild(buildFloorPlanGrid(area, floorPlan, selectedRoom, () => { markScenarioBuildDirty(); renderScenarioBuildPanel(); }));
  container.appendChild(buildFloorPlanRoomDetail(area, floorPlan, selectedRoom, () => { markScenarioBuildDirty(); renderScenarioBuildPanel(); }));
}

// ★グリッド一覧：部屋があるマスはボタン（クリックで選択）、選択中の部屋に隣接する空マスは「＋」ボタン
function buildFloorPlanGrid(area, floorPlan, selectedRoom, persist) {
  const wrap = document.createElement("div");
  wrap.className = "floorplan-grid-wrap";
  
  const xs = floorPlan.rooms.map(r => r.x);
  const ys = floorPlan.rooms.map(r => r.y);
  let minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  // ★選択中の部屋の周り1マス分は、まだ部屋が無くても「＋」を出せるよう表示範囲に含める
  if (selectedRoom) {
    minX = Math.min(minX, selectedRoom.x - 1);
    maxX = Math.max(maxX, selectedRoom.x + 1);
    minY = Math.min(minY, selectedRoom.y - 1);
    maxY = Math.max(maxY, selectedRoom.y + 1);
  }
  
  const grid = document.createElement("div");
  grid.className = "floorplan-grid";
  grid.style.gridTemplateColumns = `repeat(${maxX - minX + 1}, 64px)`;
  
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const room = findFloorPlanRoomAt(floorPlan, x, y);
      const cell = document.createElement("div");
      cell.className = "floorplan-cell";
      
      if (room) {
        const btn = document.createElement("button");
        btn.className = "floorplan-room-btn" + (selectedRoom && room.id === selectedRoom.id ? " floorplan-room-btn-selected" : "");
        btn.textContent = room.name || "部屋";
        btn.onclick = (event) => {
          event.stopPropagation();
          scenarioBuildSelectedRoomId = room.id;
          renderScenarioBuildPanel();
        };
        cell.appendChild(btn);
      } else if (selectedRoom && Math.abs(selectedRoom.x - x) + Math.abs(selectedRoom.y - y) === 1) {
        // ★選択中の部屋の上下左右の空マスにだけ「＋」を出す
        const dirKey = Object.keys(FLOORPLAN_DIRECTIONS).find(k => {
          const d = FLOORPLAN_DIRECTIONS[k];
          return selectedRoom.x + d.dx === x && selectedRoom.y + d.dy === y;
        });
        const addBtn = document.createElement("button");
        addBtn.className = "floorplan-add-btn";
        addBtn.textContent = "＋";
        addBtn.title = `${FLOORPLAN_DIRECTIONS[dirKey].label}に部屋を追加`;
        addBtn.onclick = (event) => {
          event.stopPropagation();
          const newRoom = addFloorPlanRoom(area, selectedRoom.id, dirKey);
          if (newRoom) scenarioBuildSelectedRoomId = newRoom.id;
          persist();
        };
        cell.appendChild(addBtn);
      }
      
      grid.appendChild(cell);
    }
  }
  
  wrap.appendChild(grid);
  return wrap;
}

// ★選択中の部屋の詳細：名前・サイズ・削除・四方のドア設置
function buildFloorPlanRoomDetail(area, floorPlan, room, persist) {
  const wrap = document.createElement("div");
  wrap.className = "scenariobuild-list";
  if (!room) return wrap;
  
  const card = document.createElement("div");
  card.className = "scenariobuild-chapter-row";
  const infoEl = document.createElement("div");
  infoEl.className = "scenariobuild-chapter-info";
  
  const nameRow = document.createElement("div");
  nameRow.className = "scenariobuild-condition-row";
  nameRow.appendChild(labelSpan("部屋の名前（任意）："));
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "scenariobuild-title-input";
  nameInput.placeholder = "例：リビング";
  nameInput.value = room.name || "";
  nameInput.onchange = () => { room.name = nameInput.value.trim(); persist(); };
  nameRow.appendChild(nameInput);
  infoEl.appendChild(nameRow);
  
  const sizeRow = document.createElement("div");
  sizeRow.className = "scenariobuild-condition-row";
  sizeRow.appendChild(labelSpan("広さ（家具配置マス目）　縦："));
  const heightInput = document.createElement("input");
  heightInput.type = "number";
  heightInput.min = "1";
  heightInput.className = "scenariobuild-condition-input";
  heightInput.value = room.height || 4;
  heightInput.onchange = () => { room.height = Math.max(1, Math.floor(Number(heightInput.value)) || 4); persist(); };
  sizeRow.appendChild(heightInput);
  sizeRow.appendChild(labelSpan("横："));
  const widthInput = document.createElement("input");
  widthInput.type = "number";
  widthInput.min = "1";
  widthInput.className = "scenariobuild-condition-input";
  widthInput.value = room.width || 4;
  widthInput.onchange = () => { room.width = Math.max(1, Math.floor(Number(widthInput.value)) || 4); persist(); };
  sizeRow.appendChild(widthInput);
  infoEl.appendChild(sizeRow);
  
  // ★要望対応：床の色を部屋ごとに設定できる（メイン画面の部屋表示に反映。デフォルトはベージュ）
  const floorColorRow = document.createElement("div");
  floorColorRow.className = "scenariobuild-condition-row";
  floorColorRow.appendChild(labelSpan("床の色："));
  const floorColorInput = document.createElement("input");
  floorColorInput.type = "color";
  floorColorInput.value = room.floorColor || "#e8d5b0";
  floorColorInput.onchange = () => { room.floorColor = floorColorInput.value; persist(); };
  floorColorRow.appendChild(floorColorInput);
  infoEl.appendChild(floorColorRow);
  
  const doorNote = document.createElement("p");
  doorNote.className = "devmode-note scenariobuild-condition";
  doorNote.textContent = "ドア（隣に部屋がある方向にだけ設置できます。設置した方向にのみ、隣の部屋へ移動できるようになります）：";
  infoEl.appendChild(doorNote);
  
  Object.keys(FLOORPLAN_DIRECTIONS).forEach(dirKey => {
    const dir = FLOORPLAN_DIRECTIONS[dirKey];
    const neighbor = findFloorPlanRoomAt(floorPlan, room.x + dir.dx, room.y + dir.dy);
    const doorRow = document.createElement("label");
    doorRow.className = "scenariobuild-condition-row";
    doorRow.style.cursor = neighbor ? "pointer" : "default";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !!room.doors[dirKey];
    checkbox.disabled = !neighbor;
    checkbox.onchange = () => { toggleFloorPlanDoor(area, room.id, dirKey); persist(); };
    doorRow.appendChild(checkbox);
    doorRow.appendChild(document.createTextNode(` ${dir.label}のドア` + (neighbor ? `（${neighbor.name || "部屋"}へ）` : "（隣に部屋がありません）")));
    infoEl.appendChild(doorRow);
  });
  
  card.appendChild(infoEl);
  
  const buttonsEl = document.createElement("div");
  buttonsEl.className = "scenariobuild-chapter-buttons";
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "devmode-btn devmode-btn-danger";
  deleteBtn.textContent = "この部屋を削除";
  deleteBtn.disabled = floorPlan.rooms.length <= 1;
  deleteBtn.onclick = async (event) => {
    event.stopPropagation();
    const ok = await showGameConfirm(`「${room.name || "部屋"}」を削除しますか？`);
    if (!ok) return;
    if (deleteFloorPlanRoom(area, room.id)) {
      scenarioBuildSelectedRoomId = floorPlan.rooms[0].id;
      persist();
    }
  };
  buttonsEl.appendChild(deleteBtn);
  card.appendChild(buttonsEl);
  
  wrap.appendChild(card);
  return wrap;
}

// ===================================================================
// ===== プレイヤー側：購入済みの家に入った時の部屋間移動・家具操作 =====
// ===================================================================
// ★要望対応：以前は選択肢（displayChoices）でドアや家具を選んでいたが分かりづらいため、
//   メイン画面上のカーソル操作に一新した。g（またはボタン）で「部屋移動モード」⇔「カーソルモード」を切替。
//   ・部屋移動モード：矢印キーでドアのある方向の部屋へ移動する
//   ・カーソルモード：矢印キーでマス目のカーソルを動かし、zキーで家具を選ぶと
//     「移動・回転」「使用」「片付ける」などを選べる。「移動・回転」は専用の編集画面を出さず、
//     このメイン画面のグリッド上でそのまま矢印キーで動かし、Rキーで90度ずつ回転できる
async function openHouseInterior(area, goBack) {
  const floorPlan = ensureFloorPlan(area);
  await showFloorPlanRoomScreen(area, floorPlan, floorPlan.startRoomId, goBack);
}

async function showFloorPlanRoomScreen(area, floorPlan, roomId, goBack) {
  changeSpeaker("");
  await runRoomInteraction(area, floorPlan, roomId, goBack); // furniture.jsの家具操作もここから呼ばれる
}

function runRoomInteraction(area, floorPlan, startRoomId, goBack) {
  return new Promise(resolve => {
    ensurePlayerFurniture(); // furniture.js
    const areaKey = getEstateAreaKey(area); // realestate.js
    let room = floorPlan.rooms.find(r => r.id === startRoomId) || floorPlan.rooms[0];
    let mode = "move"; // "move"＝部屋移動モード／"cursor"＝カーソルモード
    let cursor = { x: 0, y: 0 };
    let placing = null; // 移動・回転中の家具： { instance, def, rotation, isNew, originalPlacement }
    let listenerActive = false;
    
    function describeDoorHint() {
      const openDirs = Object.keys(FLOORPLAN_DIRECTIONS).filter(d => room.doors[d]);
      if (openDirs.length === 0) return "この部屋にはドアが無いようだ。";
      return "ドア：" + openDirs.map(d => FLOORPLAN_DIRECTIONS[d].label).join("・");
    }
    
    function currentUiState() {
      if (placing) {
        const size = getFurnitureEffectiveSize(placing.def, placing.rotation); // furniture.js
        const valid = isFurniturePlacementFree(room, cursor.x, cursor.y, size.w, size.h, placing.instance.instanceId); // furniture.js
        return {
          mode: "placing",
          modeLabel: "移動・回転中の家具：「" + placing.def.name + "」",
          legend: ["↑↓←→：移動", "R：90度回転", "Z：ここに確定", "X：やめる（元に戻す）"],
          cursor,
          placing: { def: placing.def, rotation: placing.rotation, excludeInstanceId: placing.instance.instanceId, valid },
          hint: `横${size.w}×縦${size.h}マス${valid ? "" : "（この位置には置けません）"}`
        };
      }
      if (mode === "cursor") {
        return {
          mode: "cursor",
          modeLabel: "カーソルモード",
          legend: ["↑↓←→：カーソル移動", "Z：家具を選ぶ／空きマスなら新しく置く", "G：部屋移動モードに切替", "X：家を出る"],
          cursor,
          onToggleMode: toggleMode,
          onLeave: leaveHouse,
          hint: `${room.name || "部屋"}にいる。`
        };
      }
      return {
        mode: "move",
        modeLabel: "部屋移動モード",
        legend: ["↑↓←→：ドアの方向へ移動", "G：カーソルモードに切替（家具を操作）", "X：家を出る"],
        onToggleMode: toggleMode,
        onLeave: leaveHouse,
        hint: `${room.name || "部屋"}にいる。${describeDoorHint()}`
      };
    }
    
    function render() {
      if (typeof hideMessageWindow === "function") hideMessageWindow(); // ★要望対応：カーソル操作中はメッセージウィンドウが邪魔なので隠す
      if (typeof renderRoomView === "function") renderRoomView(room, currentUiState()); // furniture.js
    }
    
    function toggleMode() {
      mode = mode === "move" ? "cursor" : "move";
      if (mode === "cursor") clampCursorToRoom();
      render();
    }
    
    function clampCursorToRoom() {
      cursor.x = Math.max(0, Math.min((room.width || 1) - 1, cursor.x));
      cursor.y = Math.max(0, Math.min((room.height || 1) - 1, cursor.y));
    }
    
    function moveDoorDirection(dirKey) {
      if (!room.doors[dirKey]) return;
      const dir = FLOORPLAN_DIRECTIONS[dirKey];
      const neighbor = findFloorPlanRoomAt(floorPlan, room.x + dir.dx, room.y + dir.dy);
      if (!neighbor) return;
      room = neighbor;
      render();
    }
    
    function moveCursor(dx, dy) {
      cursor.x = Math.max(0, Math.min((room.width || 1) - 1, cursor.x + dx));
      cursor.y = Math.max(0, Math.min((room.height || 1) - 1, cursor.y + dy));
      render();
    }
    
    function movePlacing(dx, dy) {
      const size = getFurnitureEffectiveSize(placing.def, placing.rotation); // furniture.js
      cursor.x = Math.max(0, Math.min((room.width || 1) - size.w, cursor.x + dx));
      cursor.y = Math.max(0, Math.min((room.height || 1) - size.h, cursor.y + dy));
      render();
    }
    
    // ★要望対応：Rキーで右回りに90度ずつ回転。部屋自体に入らないサイズになる場合は回転を諦め、
    //   入る場合は座標がはみ出さないよう寄せてから回転を確定する（他の家具と重なっても、確定操作(z)の時に弾かれる）
    function rotatePlacing() {
      const newRotation = (placing.rotation + 1) % 4;
      const size = getFurnitureEffectiveSize(placing.def, newRotation); // furniture.js
      if (size.w > (room.width || 1) || size.h > (room.height || 1)) return;
      cursor.x = Math.min(cursor.x, Math.max(0, (room.width || 1) - size.w));
      cursor.y = Math.min(cursor.y, Math.max(0, (room.height || 1) - size.h));
      placing.rotation = newRotation;
      render();
    }
    
    async function confirmPlacing() {
      const size = getFurnitureEffectiveSize(placing.def, placing.rotation); // furniture.js
      if (!isFurniturePlacementFree(room, cursor.x, cursor.y, size.w, size.h, placing.instance.instanceId)) return; // furniture.js
      placing.instance.placement = { areaKey, roomId: room.id, x: cursor.x, y: cursor.y, rotation: placing.rotation };
      const wasNew = placing.isNew;
      const placedDef = placing.def;
      placing = null;
      render();
      pauseKeys();
      if (typeof showMessageWindow === "function") showMessageWindow(); // ★確定メッセージを出す間だけメッセージウィンドウを戻す
      changeSpeaker("");
      await displayMessage(wasNew ? `「${placedDef.name}」を置いた。` : `「${placedDef.name}」を移動した。`);
      resumeKeys();
      render();
    }
    
    function cancelPlacing() {
      if (placing.isNew) placing.instance.placement = null; // ★新規に置こうとしていた家具は未設置のまま戻す
      else if (placing.originalPlacement) placing.instance.placement = placing.originalPlacement; // ★移動中だった家具は元の位置に戻す
      placing = null;
      render();
    }
    
    function pauseKeys() { if (listenerActive) { window.removeEventListener("keydown", handleKeyDown); listenerActive = false; } }
    function resumeKeys() { if (!listenerActive) { window.addEventListener("keydown", handleKeyDown); listenerActive = true; } }
    
    function leaveHouse() {
      pauseKeys();
      if (typeof hideRoomView === "function") hideRoomView(); // furniture.js
      if (typeof showMessageWindow === "function") showMessageWindow(); // ★家を出た後は通常のシナリオ表示に戻すので、隠していたメッセージウィンドウを戻す
      resolve();
      goBack();
    }
    
    async function openFurnitureActionMenu(inst) {
      pauseKeys();
      const def = findFurnitureDef(inst.furnitureId); // furniture.js
      if (typeof showMessageWindow === "function") showMessageWindow(); // ★選択肢を出す間だけメッセージウィンドウを戻す
      changeSpeaker("");
      const options = [];
      if (isFurnitureStorageType(def)) options.push({ text: "収納を開ける", next: "storage" }); // scenariobuild.js
      else if (isFurnitureUsableType(def)) options.push({ text: "使用する", next: "use" }); // scenariobuild.js
      options.push({ text: "移動・回転する", next: "move" });
      options.push({ text: "片付ける（未設置に戻す）", next: "unplace" });
      options.push({ text: "やめる", next: "cancel", isBack: true });
      await displayMessage(`「${def ? def.name : "？"}」`);
      const sub = await displayChoices(options);
      
      if (sub.next === "storage") {
        await manageFurnitureStorage(inst); // furniture.js（倉庫⇔インベントリのデュアルペインUI）
        resumeKeys(); render();
        return;
      }
      if (sub.next === "use") {
        await displayMessage((def && def.useMessage) || "特に変わったことは無いようだ。");
        resumeKeys(); render();
        return;
      }
      if (sub.next === "move") {
        placing = { instance: inst, def, rotation: inst.placement.rotation || 0, isNew: false, originalPlacement: { ...inst.placement } };
        resumeKeys(); render();
        return;
      }
      if (sub.next === "unplace") {
        inst.placement = null;
        await displayMessage(`「${def ? def.name : "？"}」を片付けた。`);
        resumeKeys(); render();
        return;
      }
      resumeKeys(); render();
    }
    
    async function openUnplacedFurniturePicker() {
      const unplaced = player.ownedFurniture.filter(inst => !inst.placement);
      pauseKeys();
      if (typeof showMessageWindow === "function") showMessageWindow();
      changeSpeaker("");
      if (unplaced.length === 0) {
        await displayMessage("持っている未設置の家具が無いようだ。（家具屋で購入できます）");
        resumeKeys(); render();
        return;
      }
      const choices = unplaced.map(inst => {
        const def = findFurnitureDef(inst.furnitureId);
        return { text: def ? def.name : "？", next: inst.instanceId };
      });
      choices.push({ text: "やめる", next: "cancel", isBack: true });
      await displayMessage("ここに置く家具を選んでください。");
      const picked = await displayChoices(choices);
      if (picked.next === "cancel") { resumeKeys(); render(); return; }
      
      const inst = unplaced.find(i => i.instanceId === picked.next);
      const def = findFurnitureDef(inst.furnitureId);
      const positions = findValidFurniturePositions(room, def, null, 0); // furniture.js
      if (positions.length === 0) {
        await displayMessage("この部屋には、もう置ける場所が無いようだ。");
        resumeKeys(); render();
        return;
      }
      cursor = { x: positions[0].x, y: positions[0].y };
      placing = { instance: inst, def, rotation: 0, isNew: true, originalPlacement: null };
      resumeKeys(); render();
    }
    
    function handleKeyDown(event) {
      if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return;
      
      if (placing) {
        if (event.key === "ArrowUp") { event.preventDefault(); movePlacing(0, -1); }
        else if (event.key === "ArrowDown") { event.preventDefault(); movePlacing(0, 1); }
        else if (event.key === "ArrowLeft") { event.preventDefault(); movePlacing(-1, 0); }
        else if (event.key === "ArrowRight") { event.preventDefault(); movePlacing(1, 0); }
        else if (event.key === "r" || event.key === "R") { event.preventDefault(); rotatePlacing(); }
        else if (event.key === "z" || event.key === "Z" || event.key === " ") { event.preventDefault(); confirmPlacing(); }
        else if (event.key === "x" || event.key === "X" || event.key === "Escape") { event.preventDefault(); cancelPlacing(); }
        return;
      }
      
      if (event.key === "g" || event.key === "G") { event.preventDefault(); toggleMode(); return; }
      
      if (mode === "move") {
        if (event.key === "ArrowUp") { event.preventDefault(); moveDoorDirection("north"); }
        else if (event.key === "ArrowDown") { event.preventDefault(); moveDoorDirection("south"); }
        else if (event.key === "ArrowLeft") { event.preventDefault(); moveDoorDirection("west"); }
        else if (event.key === "ArrowRight") { event.preventDefault(); moveDoorDirection("east"); }
        return;
      }
      
      // mode === "cursor"
      if (event.key === "ArrowUp") { event.preventDefault(); moveCursor(0, -1); }
      else if (event.key === "ArrowDown") { event.preventDefault(); moveCursor(0, 1); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); moveCursor(-1, 0); }
      else if (event.key === "ArrowRight") { event.preventDefault(); moveCursor(1, 0); }
      else if (event.key === "z" || event.key === "Z" || event.key === " ") {
        event.preventDefault();
        const atCell = getFurnitureAtCell(room, cursor.x, cursor.y, null); // furniture.js
        if (atCell) openFurnitureActionMenu(atCell);
        else openUnplacedFurniturePicker();
      } else if (event.key === "x" || event.key === "X" || event.key === "Escape") {
        event.preventDefault();
        leaveHouse();
      }
    }
    
    resumeKeys();
    render();
  });
}
