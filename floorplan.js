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
// ===== プレイヤー側：購入済みの家に入った時の部屋間移動 =====
// ===================================================================
async function openHouseInterior(area, goBack) {
  const floorPlan = ensureFloorPlan(area);
  await showFloorPlanRoomScreen(area, floorPlan, floorPlan.startRoomId, goBack);
}

async function showFloorPlanRoomScreen(area, floorPlan, roomId, goBack) {
  const room = floorPlan.rooms.find(r => r.id === roomId) || floorPlan.rooms[0];
  changeSpeaker("");
  
  // ★要望対応：部屋にいる間、間取り（指定した幅）と置いてある家具をメイン画面に視覚的に表示する
  if (typeof renderRoomView === "function") renderRoomView(room); // furniture.js
  
  const doorChoices = [];
  Object.keys(FLOORPLAN_DIRECTIONS).forEach(dirKey => {
    if (!room.doors[dirKey]) return;
    const dir = FLOORPLAN_DIRECTIONS[dirKey];
    const neighbor = findFloorPlanRoomAt(floorPlan, room.x + dir.dx, room.y + dir.dy);
    if (!neighbor) return;
    doorChoices.push({ text: `${dir.label}のドアへ進む（${neighbor.name || "部屋"}）`, next: neighbor.id });
  });
  const placedFurniture = (typeof getRoomPlacedFurniture === "function") ? getRoomPlacedFurniture(room.id) : []; // furniture.js
  const choices = doorChoices.concat([
    { text: "家具を置く／片付ける", next: "furniture" },
    { text: "家を出る", next: "leave", isBack: true }
  ]);
  
  const roomLabel = room.name || "部屋";
  const furnitureNote = placedFurniture.length === 0 ? "この部屋には何も置かれていないようだ。" : "";
  const doorNote = doorChoices.length === 0 ? "この部屋にはドアが無いようだ。" : "";
  await displayMessage(`${roomLabel}にいる。${furnitureNote}${doorNote ? "\n" + doorNote : ""}`);
  
  const picked = await displayChoices(choices);
  if (picked.next === "leave") {
    if (typeof hideRoomView === "function") hideRoomView(); // furniture.js
    goBack();
    return;
  }
  if (picked.next === "furniture") {
    await manageRoomFurniture(area, floorPlan, room, () => showFloorPlanRoomScreen(area, floorPlan, room.id, goBack)); // furniture.js
    return;
  }
  await showFloorPlanRoomScreen(area, floorPlan, picked.next, goBack);
}
