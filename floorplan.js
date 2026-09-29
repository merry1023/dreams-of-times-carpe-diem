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

// ★要望対応：部屋の種類（間取り編集で選べる。今のところ「便所」のみ。トイレ家具は便所タイプの部屋にしか置けない）
const FLOORPLAN_ROOM_TYPE_DEFS = [
  { value: "", label: "（指定なし）" },
  { value: "toilet", label: "便所" }
];

function makeNewFloorPlanRoom(x, y) {
  return {
    id: generateId("room"), // scenariobuild.js
    x, y,
    width: 4, height: 4, // ★家具配置マス目のサイズ（フェーズ2で使用）
    name: "",
    roomType: "", // ★要望対応：部屋の種類（"" or "toilet"）
    brightness: 4, // ★要望対応：部屋の明るさ（0〜30。既定はかなり暗め）
    doors: { north: false, south: false, east: false, west: false },
    doorStyle: {}, // ★要望対応：ドアごとの表示位置・色（{ north: { position, color }, ... }、未設定なら中央・茶色）
    fixedItems: [] // ★要望対応：「さらに細かく編集する」で置く、間取り自体に含まれる固定設置物（階段・動かせない家具等）
  };
}

// ★要望対応：指定した部屋・方向のドアの表示設定（位置・色）を取得する。無ければ壁の中央・既定色で初期化する
function ensureFloorPlanDoorStyle(room, dirKey) {
  if (!room.doorStyle || typeof room.doorStyle !== "object") room.doorStyle = {};
  if (!room.doorStyle[dirKey] || typeof room.doorStyle[dirKey] !== "object") {
    const isHorizontalWall = dirKey === "north" || dirKey === "south";
    const maxPos = Math.max(0, (isHorizontalWall ? (room.width || 1) : (room.height || 1)) - 1);
    room.doorStyle[dirKey] = { position: Math.floor(maxPos / 2), color: "#6b4226" };
  }
  return room.doorStyle[dirKey];
}

// ★家エリアが間取りデータを持っていなければ、部屋1つ（原点）で初期化する。
//   startRoomIdは「家に入った時にどの部屋から始まるか」の明示的な記録（部屋を削除した時にずれないようにするため）
// ★要望対応：階段で行き来する「階」ごとの間取り。floor（0が基準の階、正の数で上の階、負の数で下の階）ごとに
//   別々の間取り（部屋一式）を持つ。以前は area.floorPlan（間取り1つだけ）だったため、古いセーブ・
//   シナリオデータはここで floor 0 として area.floorPlans に移行する
function ensureFloorPlan(area, floor) {
  floor = Number.isFinite(floor) ? floor : 0;
  if (!area.floorPlans || typeof area.floorPlans !== "object") {
    area.floorPlans = {};
    if (area.floorPlan && Array.isArray(area.floorPlan.rooms) && area.floorPlan.rooms.length > 0) {
      area.floorPlans["0"] = area.floorPlan; // ★移行
    }
  }
  const key = String(floor);
  if (!area.floorPlans[key] || !Array.isArray(area.floorPlans[key].rooms) || area.floorPlans[key].rooms.length === 0) {
    const firstRoom = makeNewFloorPlanRoom(0, 0);
    area.floorPlans[key] = { floor, rooms: [firstRoom], startRoomId: firstRoom.id };
  }
  const floorPlan = area.floorPlans[key];
  floorPlan.floor = floor;
  if (!floorPlan.startRoomId || !floorPlan.rooms.some(r => r.id === floorPlan.startRoomId)) {
    floorPlan.startRoomId = floorPlan.rooms[0].id;
  }
  return floorPlan;
}

// ★シナリオエディタの間取り編集で「他に何階まであるか」を一覧するための一覧（0階は常に含む）
function getExistingFloorNumbers(area) {
  ensureFloorPlan(area, 0);
  return Object.keys(area.floorPlans || {}).map(Number).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
}

function findFloorPlanRoomAt(floorPlan, x, y) {
  return floorPlan.rooms.find(r => r.x === x && r.y === y) || null;
}

// ★要望対応：部屋の「固定設置物」（間取り自体の一部として置く階段・動かせない家具等）まわりのヘルパー
function ensureRoomFixedItems(room) {
  if (!Array.isArray(room.fixedItems)) room.fixedItems = [];
  return room.fixedItems;
}

function findFixedItemAt(room, x, y) {
  return ensureRoomFixedItems(room).find(it => x >= it.x && x < it.x + (it.w || 1) && y >= it.y && y < it.y + (it.h || 1)) || null;
}

// ★要望対応：階段を置く。directionは"up"（上の階へ）または"down"（下の階へ）。
//   行き先の階がまだ無ければ、部屋1つだけの新しい階をここで自動的に作る
function placeStairsFixedItem(area, floorPlan, room, x, y, direction) {
  const targetFloor = floorPlan.floor + (direction === "up" ? 1 : -1);
  ensureFloorPlan(area, targetFloor);
  const item = { id: generateId("fixeditem"), kind: "stairs", x, y, w: 1, h: 1, direction, targetFloor };
  ensureRoomFixedItems(room).push(item);
  return item;
}

// ★選択中の部屋の指定方向に、新しい部屋を追加する（既にその方向に部屋があれば何もしない）
function addFloorPlanRoom(floorPlan, fromRoomId, direction) {
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
function deleteFloorPlanRoom(floorPlan, roomId) {
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
function toggleFloorPlanDoor(floorPlan, roomId, direction) {
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
  
  // ★要望対応：階段で行き来する「階」の切り替え（0が基準の階。scenariobuild.jsのscenarioBuildSelectedFloor）
  const floorPlan = ensureFloorPlan(area, scenarioBuildSelectedFloor);
  if (!floorPlan.rooms.some(r => r.id === scenarioBuildSelectedRoomId)) {
    scenarioBuildSelectedRoomId = floorPlan.rooms[0].id;
  }
  const selectedRoom = floorPlan.rooms.find(r => r.id === scenarioBuildSelectedRoomId);
  
  const titleEl = document.createElement("h3");
  titleEl.textContent = "間取り編集：" + (area.name || "（名前未設定）");
  container.appendChild(titleEl);
  
  // ★階の切り替えUI。既にある階（階段で作られた階）はボタンで一覧、無ければ「＋階段で作る」旨の案内のみ
  const floorRow = document.createElement("div");
  floorRow.className = "scenariobuild-condition-row";
  floorRow.appendChild(labelSpan("階："));
  getExistingFloorNumbers(area).forEach(floorNum => {
    const floorBtn = document.createElement("button");
    floorBtn.className = "devmode-btn";
    if (floorNum === scenarioBuildSelectedFloor) { floorBtn.style.backgroundColor = "#ffc107"; floorBtn.style.color = "#1a1a1a"; }
    floorBtn.textContent = floorNum === 0 ? "0階（基準）" : (floorNum > 0 ? `${floorNum}階` : `地下${-floorNum}階`);
    floorBtn.onclick = (event) => {
      event.stopPropagation();
      scenarioBuildSelectedFloor = floorNum;
      scenarioBuildSelectedRoomId = null; // ★階を切り替えたら、その階の最初の部屋を選び直す
      renderScenarioBuildPanel();
    };
    floorRow.appendChild(floorBtn);
  });
  container.appendChild(floorRow);
  const floorNote = document.createElement("p");
  floorNote.className = "devmode-note";
  floorNote.textContent = "他の階は、この部屋の「さらに細かく編集する」から階段を置くと自動的に作られます。";
  container.appendChild(floorNote);
  
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
          const newRoom = addFloorPlanRoom(floorPlan, selectedRoom.id, dirKey);
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
  
  // ★要望対応：部屋そのものの明るさ（0〜30）。部屋は元々かなり暗く、照明の家具を置くとその周りが明るくなる
  const brightnessRow = document.createElement("div");
  brightnessRow.className = "scenariobuild-condition-row";
  brightnessRow.appendChild(labelSpan("部屋の明るさ（0〜30）："));
  const brightnessInput = document.createElement("input");
  brightnessInput.type = "number";
  brightnessInput.min = "0";
  brightnessInput.max = "30";
  brightnessInput.className = "scenariobuild-condition-input";
  brightnessInput.value = Number.isFinite(room.brightness) ? room.brightness : ROOM_BRIGHTNESS_DEFAULT; // furniture.js
  brightnessInput.onchange = () => {
    const v = Number(brightnessInput.value);
    room.brightness = Math.max(0, Math.min(30, Number.isFinite(v) ? v : ROOM_BRIGHTNESS_DEFAULT));
    persist();
  };
  brightnessRow.appendChild(brightnessInput);
  infoEl.appendChild(brightnessRow);
  
  // ★要望対応：部屋の種類（トイレ等、特定の家具はここで指定した種類の部屋にしか置けない）
  const roomTypeRow = document.createElement("div");
  roomTypeRow.className = "scenariobuild-condition-row";
  roomTypeRow.appendChild(labelSpan("部屋の種類："));
  const roomTypeSelect = document.createElement("select");
  roomTypeSelect.className = "scenariobuild-title-input";
  FLOORPLAN_ROOM_TYPE_DEFS.forEach(opt => {
    const optionEl = document.createElement("option");
    optionEl.value = opt.value;
    optionEl.textContent = opt.label;
    roomTypeSelect.appendChild(optionEl);
  });
  roomTypeSelect.value = room.roomType || "";
  roomTypeSelect.onchange = () => { room.roomType = roomTypeSelect.value; persist(); };
  roomTypeRow.appendChild(roomTypeSelect);
  const roomTypeHint = document.createElement("p");
  roomTypeHint.className = "devmode-note";
  roomTypeHint.style.margin = "2px 0 0 0";
  roomTypeHint.textContent = "「便所」にすると、種類が「トイレ」の家具をこの部屋に置けるようになります。";
  infoEl.appendChild(roomTypeRow);
  infoEl.appendChild(roomTypeHint);
  
  const doorNote = document.createElement("p");
  doorNote.className = "devmode-note scenariobuild-condition";
  doorNote.textContent = "ドア（隣に部屋がある方向にだけ設置できます。設置した方向にのみ、隣の部屋へ移動できるようになります。位置・色は本編プレイ画面での見た目です）：";
  infoEl.appendChild(doorNote);
  
  Object.keys(FLOORPLAN_DIRECTIONS).forEach(dirKey => {
    const dir = FLOORPLAN_DIRECTIONS[dirKey];
    const neighbor = findFloorPlanRoomAt(floorPlan, room.x + dir.dx, room.y + dir.dy);
    const doorRow = document.createElement("div");
    doorRow.className = "scenariobuild-condition-row";
    const checkboxLabel = document.createElement("label");
    checkboxLabel.style.cursor = neighbor ? "pointer" : "default";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !!room.doors[dirKey];
    checkbox.disabled = !neighbor;
    checkbox.onchange = () => { toggleFloorPlanDoor(floorPlan, room.id, dirKey); persist(); };
    checkboxLabel.appendChild(checkbox);
    checkboxLabel.appendChild(document.createTextNode(` ${dir.label}のドア` + (neighbor ? `（${neighbor.name || "部屋"}へ）` : "（隣に部屋がありません）")));
    doorRow.appendChild(checkboxLabel);
    
    if (room.doors[dirKey]) {
      const isHorizontalWall = dirKey === "north" || dirKey === "south";
      const maxPos = Math.max(0, (isHorizontalWall ? (room.width || 1) : (room.height || 1)) - 1);
      const style = ensureFloorPlanDoorStyle(room, dirKey);
      if (style.position > maxPos) style.position = maxPos;
      
      doorRow.appendChild(labelSpan(" 位置："));
      const posInput = document.createElement("input");
      posInput.type = "number";
      posInput.min = "0";
      posInput.max = String(maxPos);
      posInput.className = "scenariobuild-condition-input";
      posInput.value = style.position;
      posInput.onchange = () => { style.position = Math.max(0, Math.min(maxPos, Math.floor(Number(posInput.value)) || 0)); persist(); };
      doorRow.appendChild(posInput);
      
      doorRow.appendChild(labelSpan(" 色："));
      const colorInput = document.createElement("input");
      colorInput.type = "color";
      colorInput.value = style.color || "#6b4226";
      colorInput.onchange = () => { style.color = colorInput.value; persist(); };
      doorRow.appendChild(colorInput);
    }
    
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
    if (deleteFloorPlanRoom(floorPlan, room.id)) {
      scenarioBuildSelectedRoomId = floorPlan.rooms[0].id;
      persist();
    }
  };
  buttonsEl.appendChild(deleteBtn);
  card.appendChild(buttonsEl);
  
  wrap.appendChild(card);
  wrap.appendChild(buildFixedItemEditorSection(area, floorPlan, room, persist));
  return wrap;
}
function buildFixedItemEditorSection(area, floorPlan, room, persist) {
  const wrap = document.createElement("div");
  wrap.className = "scenariobuild-condition";
  
  const toggleBtn = document.createElement("button");
  toggleBtn.className = "devmode-btn";
  toggleBtn.textContent = scenarioBuildFixedItemEditorOpen ? "さらに細かく編集する（閉じる）" : "さらに細かく編集する（階段・固定家具の設置）";
  toggleBtn.onclick = (event) => {
    event.stopPropagation();
    scenarioBuildFixedItemEditorOpen = !scenarioBuildFixedItemEditorOpen;
    scenarioBuildFixedItemSelectedCell = null;
    renderScenarioBuildPanel();
  };
  wrap.appendChild(toggleBtn);
  
  if (!scenarioBuildFixedItemEditorOpen) return wrap;
  
  const note = document.createElement("p");
  note.className = "devmode-note";
  note.textContent = "ここに置いたものは、プレイヤーの持ち物とは関係なく、この部屋に最初から固定で置かれます（間取り自体の一部）。マスを選ぶと、下に設置・編集欄が出ます。置けるのは今のところ「階段」と「家具（家具管理タブに登録済みのもの）」です。";
  wrap.appendChild(note);
  
  const roomW = room.width || 1, roomH = room.height || 1;
  const items = ensureRoomFixedItems(room);
  const grid = document.createElement("div");
  grid.className = "fixeditem-editor-grid";
  grid.style.gridTemplateColumns = `repeat(${roomW}, 30px)`;
  
  for (let y = 0; y < roomH; y++) {
    for (let x = 0; x < roomW; x++) {
      const item = findFixedItemAt(room, x, y);
      const cellBtn = document.createElement("button");
      cellBtn.type = "button";
      cellBtn.className = "fixeditem-editor-cell"
        + (item ? " fixeditem-editor-cell-filled" : "")
        + (item && item.kind === "stairs" ? " fixeditem-editor-cell-stairs" : "")
        + (item && item.kind === "furniture" && item.locked ? " fixeditem-editor-cell-locked" : "")
        + (scenarioBuildFixedItemSelectedCell && scenarioBuildFixedItemSelectedCell.x === x && scenarioBuildFixedItemSelectedCell.y === y ? " fixeditem-editor-cell-selected" : "");
      if (item) {
        cellBtn.textContent = item.kind === "stairs" ? "階段" : (findFurnitureDef(item.furnitureId) ? findFurnitureDef(item.furnitureId).name : "？");
      }
      cellBtn.onclick = (event) => {
        event.stopPropagation();
        scenarioBuildFixedItemSelectedCell = { x, y };
        renderScenarioBuildPanel();
      };
      grid.appendChild(cellBtn);
    }
  }
  wrap.appendChild(grid);
  
  if (scenarioBuildFixedItemSelectedCell) {
    wrap.appendChild(buildFixedItemCellDetail(area, floorPlan, room, scenarioBuildFixedItemSelectedCell, persist));
  }
  
  return wrap;
}

function buildFixedItemCellDetail(area, floorPlan, room, cell, persist) {
  const box = document.createElement("div");
  box.className = "scenariobuild-condition-row";
  box.style.flexDirection = "column";
  box.style.alignItems = "flex-start";
  const items = ensureRoomFixedItems(room);
  const existing = findFixedItemAt(room, cell.x, cell.y);
  
  const title = document.createElement("p");
  title.className = "devmode-note";
  title.textContent = `選択中のマス：(${cell.x}, ${cell.y})`;
  box.appendChild(title);
  
  if (existing) {
    if (existing.kind === "stairs") {
      const info = document.createElement("p");
      info.className = "devmode-note";
      info.textContent = `階段（${existing.direction === "up" ? "上" : "下"}の階（${existing.targetFloor}階）へ）`;
      box.appendChild(info);
    } else {
      const def = findFurnitureDef(existing.furnitureId);
      const info = document.createElement("p");
      info.className = "devmode-note";
      info.textContent = `家具：${def ? def.name : "（見つかりません。家具管理タブで削除された可能性があります）"}`;
      box.appendChild(info);
      
      const lockLabel = document.createElement("label");
      lockLabel.style.cursor = "pointer";
      const lockCheckbox = document.createElement("input");
      lockCheckbox.type = "checkbox";
      lockCheckbox.checked = !!existing.locked;
      lockCheckbox.onchange = () => { existing.locked = lockCheckbox.checked; persist(); };
      lockLabel.appendChild(lockCheckbox);
      lockLabel.appendChild(document.createTextNode(" プレイ中は動かせないようにロックする（外すと、プレイヤーがカーソルモードで移動できます）"));
      box.appendChild(lockLabel);
    }
    
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "devmode-btn devmode-btn-danger";
    deleteBtn.textContent = "このマスの設置物を削除";
    deleteBtn.onclick = (event) => {
      event.stopPropagation();
      room.fixedItems = items.filter(it => it.id !== existing.id);
      scenarioBuildFixedItemSelectedCell = null;
      persist();
    };
    box.appendChild(deleteBtn);
  } else {
    const addNote = document.createElement("p");
    addNote.className = "devmode-note";
    addNote.textContent = "このマスに置くものを選んでください：";
    box.appendChild(addNote);
    
    const stairsRow = document.createElement("div");
    stairsRow.className = "scenariobuild-chapter-buttons";
    const stairsUpBtn = document.createElement("button");
    stairsUpBtn.className = "devmode-btn";
    stairsUpBtn.textContent = "階段を置く（上の階へ）";
    stairsUpBtn.onclick = (event) => {
      event.stopPropagation();
      const newItem = placeStairsFixedItem(area, floorPlan, room, cell.x, cell.y, "up");
      scenarioBuildFixedItemSelectedCell = { x: newItem.x, y: newItem.y };
      persist();
    };
    stairsRow.appendChild(stairsUpBtn);
    
    const stairsDownBtn = document.createElement("button");
    stairsDownBtn.className = "devmode-btn";
    stairsDownBtn.textContent = "階段を置く（下の階へ）";
    stairsDownBtn.onclick = (event) => {
      event.stopPropagation();
      const newItem = placeStairsFixedItem(area, floorPlan, room, cell.x, cell.y, "down");
      scenarioBuildFixedItemSelectedCell = { x: newItem.x, y: newItem.y };
      persist();
    };
    stairsRow.appendChild(stairsDownBtn);
    box.appendChild(stairsRow);
    
    const furnitureNote = document.createElement("p");
    furnitureNote.className = "devmode-note";
    furnitureNote.textContent = "家具（家具管理タブに登録済みのもの）を置く：";
    box.appendChild(furnitureNote);
    
    const furnitureListWrap = document.createElement("div");
    furnitureListWrap.className = "fixeditem-furniture-picker";
    (scenarioProject.furniture || []).forEach(def => {
      const btn = document.createElement("button");
      btn.className = "devmode-btn";
      btn.textContent = def.name || "（無名の家具）";
      btn.onclick = (event) => {
        event.stopPropagation();
        items.push({ id: generateId("fixeditem"), kind: "furniture", furnitureId: def.id, x: cell.x, y: cell.y, w: 1, h: 1, locked: true });
        persist();
      };
      furnitureListWrap.appendChild(btn);
    });
    if ((scenarioProject.furniture || []).length === 0) {
      const emptyNote = document.createElement("p");
      emptyNote.className = "devmode-note";
      emptyNote.textContent = "（家具管理タブにまだ何も登録されていません）";
      furnitureListWrap.appendChild(emptyNote);
    }
    box.appendChild(furnitureListWrap);
  }
  
  return box;
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
        const valid = isFurniturePlacementFree(room, cursor.x, cursor.y, size.w, size.h, placing.instance ? placing.instance.instanceId : null, placing.fixedItem ? placing.fixedItem.id : null); // furniture.js
        return {
          mode: "placing",
          modeLabel: "移動・回転中の家具：「" + placing.def.name + "」",
          legend: placing.fixedItem ? ["↑↓←→：移動", "Z：ここに確定", "X：やめる（元に戻す）"] : ["↑↓←→：移動", "R：90度回転", "Z：ここに確定", "X：やめる（元に戻す）"],
          cursor,
          placing: { def: placing.def, rotation: placing.rotation, excludeInstanceId: placing.instance ? placing.instance.instanceId : null, excludeFixedItemId: placing.fixedItem ? placing.fixedItem.id : null, valid },
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
      if (typeof renderRoomView === "function") renderRoomView(room, currentUiState(), floorPlan); // furniture.js
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
      if (placing.fixedItem) return; // ★要望対応：固定設置物は今のところ回転に対応しない（1マスの階段・素の家具のみ）
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
      if (placing.fixedItem) {
        // ★要望対応：「さらに細かく編集する」で置いた、ロックされていない固定設置物をプレイ中に動かす
        if (!isFurniturePlacementFree(room, cursor.x, cursor.y, size.w, size.h, null, placing.fixedItem.id)) return; // furniture.js
        placing.fixedItem.x = cursor.x;
        placing.fixedItem.y = cursor.y;
        const placedDef = placing.def;
        placing = null;
        render();
        pauseKeys();
        if (typeof showMessageWindow === "function") showMessageWindow();
        changeSpeaker("");
        await displayMessage(`「${placedDef.name}」を移動した。`);
        resumeKeys();
        render();
        return;
      }
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
      if (placing.fixedItem) { placing = null; render(); return; } // ★固定設置物の移動中止（座標はまだ書き換えていないので何もしなくて良い）
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
    
    // ★要望対応：調理魔家電／照明／寝具の「使用する」効果。プレイヤー所有の家具（instance）でも、
    //   「さらに細かく編集する」で置いた固定家具（item）でも同じロジックで使えるよう共通化した
    async function performFurnitureUseEffect(def, statefulTarget) {
      if (def && def.type === "cookingAppliance" && typeof openCookingModal === "function") {
        await openCookingModal(def); // ★家電の大きさを渡す
      } else if (def && def.type === "lighting") {
        // ★要望対応：照明は使うたびにオン／オフが切り替わる（部屋の明るさに反映される）
        statefulTarget.lightOn = (statefulTarget.lightOn === false);
        changeSpeaker("");
        await displayMessage(statefulTarget.lightOn ? "照明をつけた。" : "照明を消した。");
      } else if (def && def.type === "bed") {
        // ★要望対応：寝具を使うと8時間経過し、HP・SP・眠気・疲労度が「半分まで」回復する。回復するのは主人公だけ（仲間は対象外）。
        //   HP・SPは現在値が最大の半分に届いていなければ半分まで引き上げ、眠気・疲労度は現在値が最大の半分を超えていれば半分まで下げる
        //   （既に半分より良い状態なら、悪化させないようそのまま）
        const g = player.gauges || {};
        if (g.hp) g.hp.current = Math.max(g.hp.current, Math.floor(g.hp.max / 2));
        if (g.sp) g.sp.current = Math.max(g.sp.current, Math.floor(g.sp.max / 2));
        if (g.fatigue) g.fatigue.current = Math.min(g.fatigue.current, Math.floor(g.fatigue.max / 2));
        if (g.sleepiness) g.sleepiness.current = Math.min(g.sleepiness.current, Math.floor(g.sleepiness.max / 2));
        if (typeof advanceGameTime === "function") advanceGameTime(8); // player.js
        if (typeof renderStatusHUD === "function") renderStatusHUD();
        changeSpeaker("");
        await displayMessage((def.useMessage) || "ぐっすりと眠った。8時間が経過し、体力も気力も半分ほどまで回復した。");
      } else {
        await displayMessage((def && def.useMessage) || "特に変わったことは無いようだ。");
      }
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
        await performFurnitureUseEffect(def, inst);
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
    
    // ★要望対応：「さらに細かく編集する」で置いた固定設置物（階段・固定家具）を、カーソルモードで選んだ時のメニュー
    async function openFixedItemActionMenu(item) {
      pauseKeys();
      if (typeof showMessageWindow === "function") showMessageWindow();
      changeSpeaker("");
      
      if (item.kind === "stairs") {
        const options = [];
        if (item.direction === "up") options.push({ text: "上の階へ行く", next: "go" });
        if (item.direction === "down") options.push({ text: "下の階へ行く", next: "go" });
        options.push({ text: "留まる", next: "cancel", isBack: true });
        await displayMessage("階段だ。");
        const sub = await displayChoices(options);
        if (sub.next === "go") {
          const targetFloorPlan = ensureFloorPlan(area, item.targetFloor);
          floorPlan = targetFloorPlan;
          room = targetFloorPlan.rooms.find(r => r.id === targetFloorPlan.startRoomId) || targetFloorPlan.rooms[0];
          cursor = { x: 0, y: 0 };
          mode = "cursor";
        }
        resumeKeys(); render();
        return;
      }
      
      // item.kind === "furniture"
      const def = findFurnitureDef(item.furnitureId);
      const pseudoInst = { instanceId: item.id, furnitureId: item.furnitureId }; // ★収納機能（player.furnitureStorage）を固定家具のidキーでそのまま流用する
      const options = [];
      if (isFurnitureStorageType(def)) options.push({ text: "収納を開ける", next: "storage" });
      else if (isFurnitureUsableType(def)) options.push({ text: "使用する", next: "use" });
      if (!item.locked) options.push({ text: "移動する", next: "move" }); // ★要望対応：ロックされていなければプレイ中でも動かせる
      options.push({ text: "やめる", next: "cancel", isBack: true });
      await displayMessage(`「${def ? def.name : "？"}」` + (item.locked ? "（固定されていて動かせないようだ）" : ""));
      const sub = await displayChoices(options);
      
      if (sub.next === "storage") {
        await manageFurnitureStorage(pseudoInst); // furniture.js
        resumeKeys(); render();
        return;
      }
      if (sub.next === "use") {
        await performFurnitureUseEffect(def, item);
        resumeKeys(); render();
        return;
      }
      if (sub.next === "move") {
        placing = { fixedItem: item, def, rotation: 0, isNew: false };
        resumeKeys(); render();
        return;
      }
      resumeKeys(); render();
    }
    
    async function openUnplacedFurniturePicker() {
      const allUnplaced = player.ownedFurniture.filter(inst => !inst.placement);
      // ★要望対応：トイレなど、部屋の種類によって置ける家具を絞り込む
      const unplaced = allUnplaced.filter(inst => isFurniturePlacementAllowedInRoom(findFurnitureDef(inst.furnitureId), room)); // scenariobuild.js
      pauseKeys();
      if (typeof showMessageWindow === "function") showMessageWindow();
      changeSpeaker("");
      if (unplaced.length === 0) {
        if (allUnplaced.length > 0) {
          await displayMessage("持っている未設置の家具の中に、この部屋（" + (room.name || "この部屋") + "）に置けるものが無いようだ。（例：トイレは「便所」タイプの部屋にしか置けません）");
        } else {
          await displayMessage("持っている未設置の家具が無いようだ。（家具屋で購入できます）");
        }
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
        const fixedAtCell = findFixedItemAt(room, cursor.x, cursor.y);
        const atCell = getFurnitureAtCell(room, cursor.x, cursor.y, null); // furniture.js
        if (fixedAtCell) openFixedItemActionMenu(fixedAtCell);
        else if (atCell) openFurnitureActionMenu(atCell);
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
