// furniture.js
// 不動産システム（フェーズ2）：家具屋での家具購入、倉庫（収納）、部屋への家具配置（重なり不可）。
// ★家具の「設計図」はscenarioProject.furniture（家具管理タブ・scenariobuild.js）。
//   プレイヤーが実際に持っている家具はplayer.ownedFurnitureに1個体ずつ記録する（購入するたびに増える）。

function ensurePlayerFurniture() {
  if (!player) return;
  if (!Array.isArray(player.ownedFurniture)) player.ownedFurniture = [];
  if (!player.furnitureStorage || typeof player.furnitureStorage !== "object") player.furnitureStorage = {};
}

function findFurnitureDef(furnitureId) {
  if (typeof scenarioProject === "undefined" || !Array.isArray(scenarioProject.furniture)) return null;
  return scenarioProject.furniture.find(f => f.id === furnitureId) || null;
}

// ★要望対応：家具はRキーで90度ずつ回転できる。rotationは0〜3（0/90/180/270度・右回り）で家具の設置情報(placement)に持つ。
//   90度・270度の時は見た目上のマス目の縦横が入れ替わる（配置の当たり判定・描画の両方でこの実寸を使う）
function getFurnitureEffectiveSize(def, rotation) {
  const w = def.width || 1, h = def.height || 1;
  const r = ((rotation || 0) % 4 + 4) % 4;
  return (r === 1 || r === 3) ? { w: h, h: w } : { w, h };
}

// ===================================================================
// ===== 家具屋（購入） =====
// ===================================================================
async function openFurnitureShop(facility, goBack) {
  ensurePlayerFurniture();
  const ids = Array.isArray(facility.furnitureIds) ? facility.furnitureIds : [];
  const catalog = ids.map(id => findFurnitureDef(id)).filter(Boolean);
  changeSpeaker(facility.name || "");
  if (catalog.length === 0) {
    await displayMessage("……今のところ、取り扱っている家具は無いようだ。");
    goBack();
    return;
  }
  await showFurnitureShopList(facility, catalog, goBack);
}

async function showFurnitureShopList(facility, catalog, goBack) {
  changeSpeaker(facility.name || "");
  const choices = catalog.map(f => ({
    text: `${f.name}（${f.price || 0}陳・${f.width || 1}×${f.height || 1}マス${isFurnitureStorageType(f) ? "・倉庫" : ""}）`,
    next: f.id
  }));
  choices.push({ text: "やめる", next: "cancel", isBack: true });
  await displayMessage("何を買う？");
  const picked = await displayChoices(choices);
  if (picked.next === "cancel") { goBack(); return; }
  
  const furniture = catalog.find(f => f.id === picked.next);
  const confirmed = await showGameConfirm(`「${furniture.name}」を${furniture.price || 0}陳で購入しますか？`);
  if (!confirmed) { await showFurnitureShopList(facility, catalog, goBack); return; }
  
  if (typeof gold === "undefined" || gold < (furniture.price || 0)) {
    await displayMessage("すまないが、その持ち金では買えないようだ……");
    await showFurnitureShopList(facility, catalog, goBack);
    return;
  }
  
  changeGold(-(furniture.price || 0));
  ensurePlayerFurniture();
  player.ownedFurniture.push({ instanceId: generateId("furn"), furnitureId: furniture.id, placement: null });
  if (typeof renderStatusHUD === "function") renderStatusHUD();
  await displayMessage(`「${furniture.name}」を購入した！ 自分の家の部屋に置くことができます。`);
  await showFurnitureShopList(facility, catalog, goBack);
}

// ===================================================================
// ===== 部屋への配置（自由な位置・重なり不可） =====
// ===================================================================
function getRoomPlacedFurniture(roomId) {
  ensurePlayerFurniture();
  return player.ownedFurniture.filter(inst => inst.placement && inst.placement.roomId === roomId);
}

// ★指定した位置(x,y)〜(x+w,y+h)が、部屋の範囲内かつ他の家具と重なっていないか。
//   他の家具側も、それぞれの設置時rotationに応じた実寸（縦横入れ替え済み）で判定する
function isFurniturePlacementFree(room, x, y, w, h, excludeInstanceId) {
  if (x < 0 || y < 0 || x + w > (room.width || 1) || y + h > (room.height || 1)) return false;
  return !getRoomPlacedFurniture(room.id).some(inst => {
    if (inst.instanceId === excludeInstanceId) return false;
    const def = findFurnitureDef(inst.furnitureId);
    if (!def) return false;
    const px = inst.placement.x, py = inst.placement.y;
    const size = getFurnitureEffectiveSize(def, inst.placement.rotation);
    const pw = size.w, ph = size.h;
    return x < px + pw && x + w > px && y < py + ph && y + h > py; // ★矩形同士の重なり判定
  });
}

// ★カーソル座標(x,y)の位置にある家具（1×1とは限らないので占有範囲で判定）を1つ返す。無ければnull
function getFurnitureAtCell(room, x, y, excludeInstanceId) {
  return getRoomPlacedFurniture(room.id).find(inst => {
    if (inst.instanceId === excludeInstanceId) return false;
    const def = findFurnitureDef(inst.furnitureId);
    if (!def) return false;
    const size = getFurnitureEffectiveSize(def, inst.placement.rotation);
    const px = inst.placement.x, py = inst.placement.y;
    return x >= px && x < px + size.w && y >= py && y < py + size.h;
  }) || null;
}

// ★家具1つを、画像があれば画像、無ければ縁取り付きの指定サイズのブロックとして描く
//   （グリッド上でwidth×heightマスぶんをまとめて1つのブロックとして占有させる。
//   room-view-panel（部屋のカーソル操作画面）から使う）
// cellPx: このグリッドの1マスの実際のpxサイズ（省略時は配置ミニ画面の26px相当）。
//   1×1のような小さいブロックでも名前がはみ出さないよう、ブロックの実サイズからフォントサイズを逆算する
// ★rotation（0〜3・右回りに90度単位）を渡すと、90度・270度の時は横幅と縦幅を入れ替えて占有マスを計算する。
//   画像そのものを回転させるわけではなく、あくまで占有マスの縦横を入れ替えるだけの簡易対応
function buildFurnitureBlockEl(def, x, y, extraClass, cellPx, rotation) {
  const size = getFurnitureEffectiveSize(def, rotation);
  const fw = size.w, fh = size.h;
  const px = cellPx || 26;
  const block = document.createElement("div");
  block.className = "furniture-placement-block " + extraClass;
  block.style.gridColumn = `${x + 1} / span ${fw}`;
  block.style.gridRow = `${y + 1} / span ${fh}`;
  block.title = def.name || "";
  if (def.imagePath) {
    const img = document.createElement("img");
    img.src = def.imagePath;
    img.alt = def.name || "";
    img.className = "furniture-placement-block-img";
    img.onerror = () => { img.remove(); block.classList.add("furniture-placement-block-outline"); block.style.backgroundColor = def.color || ""; }; // ★画像パスが不正な時も縁取りブロックにフォールバック
    block.appendChild(img);
  } else {
    block.classList.add("furniture-placement-block-outline");
    if (def.color) block.style.backgroundColor = def.color; // ★要望対応：家具管理タブで色を指定できる（未指定ならCSS既定色）
    const label = document.createElement("span");
    label.className = "furniture-placement-block-label";
    label.textContent = def.name || "";
    // ★ブロックの実サイズ（小さい方の辺）に応じてフォントサイズを自動で縮め、1×1マスでも必ず枠内に収める
    const shortSidePx = Math.min(fw, fh) * px;
    label.style.fontSize = Math.max(6, Math.min(11, Math.floor(shortSidePx / 3.2))) + "px";
    block.appendChild(label);
  }
  return block;
}

// ★要望対応：部屋にいる間、メイン画面（背景の手前）に部屋の間取りを視覚的に表示する。
//   部屋の「指定した幅」（room.width）に合わせて、画面に収まるようマス目1つぶんのpxサイズを自動調整する。
//   uiStateを渡すと、上部にモード切替・家を出るボタンのツールバーと、カーソル／移動中家具の表示を追加する
//   （uiStateの形：{ modeLabel, onToggleMode, onLeave, hint, cursor:{x,y}, placing:{def,rotation,excludeInstanceId,valid} }）
function renderRoomView(room, uiState) {
  const panel = document.getElementById("room-view-panel");
  if (!panel) return;
  panel.innerHTML = "";
  
  if (uiState) {
    const toolbar = document.createElement("div");
    toolbar.className = "room-view-toolbar";
    
    const modeLabel = document.createElement("span");
    modeLabel.className = "room-view-mode-label";
    modeLabel.textContent = uiState.modeLabel || "";
    toolbar.appendChild(modeLabel);
    
    if (uiState.onToggleMode) {
      const modeBtn = document.createElement("button");
      modeBtn.className = "devmode-btn room-view-toolbar-btn";
      modeBtn.textContent = "モード切替 [G]";
      modeBtn.onclick = (event) => { event.stopPropagation(); uiState.onToggleMode(); };
      toolbar.appendChild(modeBtn);
    }
    if (uiState.onLeave) {
      const leaveBtn = document.createElement("button");
      leaveBtn.className = "devmode-btn room-view-toolbar-btn";
      leaveBtn.textContent = "家を出る";
      leaveBtn.onclick = (event) => { event.stopPropagation(); uiState.onLeave(); };
      toolbar.appendChild(leaveBtn);
    }
    panel.appendChild(toolbar);
  }
  
  const roomW = room.width || 1, roomH = room.height || 1;
  const maxPanelWidthPx = Math.min(window.innerWidth * 0.7, 480);
  const cellPx = Math.max(14, Math.min(32, Math.floor(maxPanelWidthPx / roomW)));
  
  const grid = document.createElement("div");
  grid.className = "room-view-grid";
  grid.style.position = "relative";
  grid.style.gridTemplateColumns = `repeat(${roomW}, ${cellPx}px)`;
  grid.style.gridTemplateRows = `repeat(${roomH}, ${cellPx}px)`;
  
  const floorColor = room.floorColor || "#e8d5b0"; // ★要望対応：部屋ごとの床の色（間取り編集で設定。デフォルトはベージュ）
  for (let i = 0; i < roomW * roomH; i++) {
    const cell = document.createElement("div");
    cell.className = "room-view-cell";
    cell.style.backgroundColor = floorColor;
    grid.appendChild(cell);
  }
  
  const excludeInstanceId = uiState && uiState.placing ? uiState.placing.excludeInstanceId : null;
  getRoomPlacedFurniture(room.id).forEach(inst => {
    if (excludeInstanceId && inst.instanceId === excludeInstanceId) return; // ★移動・回転中の家具は、元の位置には描かず後でカーソル位置に描く
    const def = findFurnitureDef(inst.furnitureId);
    if (!def) return;
    grid.appendChild(buildFurnitureBlockEl(def, inst.placement.x, inst.placement.y, "furniture-placement-block-occupied", cellPx, inst.placement.rotation));
  });
  
  if (uiState && uiState.placing) {
    // ★要望対応：移動・回転モードは専用画面を出さず、このメイン画面のグリッド上でそのまま動かす
    const p = uiState.placing;
    const cls = p.valid ? "furniture-placement-block-cursor-ok" : "furniture-placement-block-cursor-bad";
    grid.appendChild(buildFurnitureBlockEl(p.def, uiState.cursor.x, uiState.cursor.y, cls, cellPx, p.rotation));
  } else if (uiState && uiState.cursor && uiState.mode === "cursor") {
    // ★カーソルモード：家具の無いマスにも、今どこを見ているか分かるよう枠だけのカーソルを出す
    const atCell = getFurnitureAtCell(room, uiState.cursor.x, uiState.cursor.y, null);
    if (!atCell) {
      const cursorEl = document.createElement("div");
      cursorEl.className = "room-view-cursor";
      cursorEl.style.gridColumn = `${uiState.cursor.x + 1} / span 1`;
      cursorEl.style.gridRow = `${uiState.cursor.y + 1} / span 1`;
      grid.appendChild(cursorEl);
    } else {
      // ★家具の上にカーソルがある時は、その家具ブロックごと光らせる
      const def = findFurnitureDef(atCell.furnitureId);
      if (def) grid.appendChild(buildFurnitureBlockEl(def, atCell.placement.x, atCell.placement.y, "room-view-cursor-on-furniture", cellPx, atCell.placement.rotation));
    }
  }
  
  panel.appendChild(grid);
  
  if (uiState && uiState.hint) {
    const hintEl = document.createElement("p");
    hintEl.className = "room-view-hint";
    hintEl.textContent = uiState.hint;
    panel.appendChild(hintEl);
  }
  
  panel.classList.remove("hidden");
}

function hideRoomView() {
  const panel = document.getElementById("room-view-panel");
  if (panel) panel.classList.add("hidden");
}

function findValidFurniturePositions(room, furnitureDef, excludeInstanceId, rotation) {
  const size = getFurnitureEffectiveSize(furnitureDef, rotation);
  const positions = [];
  for (let y = 0; y <= (room.height || 1) - size.h; y++) {
    for (let x = 0; x <= (room.width || 1) - size.w; x++) {
      if (isFurniturePlacementFree(room, x, y, size.w, size.h, excludeInstanceId)) positions.push({ x, y });
    }
  }
  return positions;
}

// ★グリッド上のカーソル移動（上下左右）を、行×列の位置計算で行う共通ヘルパー。
//   倉庫UIの2つのペイン（インベントリ画面の仕組みを流用）でも、部屋のカーソルモードと同じ考え方を使う
function computeGridMove(index, key, cols, count) {
  if (count <= 0) return 0;
  const rows = Math.max(1, Math.ceil(count / cols));
  let row = Math.floor(index / cols), col = index % cols;
  if (key === "ArrowUp") row = Math.max(0, row - 1);
  else if (key === "ArrowDown") row = Math.min(rows - 1, row + 1);
  else if (key === "ArrowLeft") col = Math.max(0, col - 1);
  else if (key === "ArrowRight") col = Math.min(cols - 1, col + 1);
  return Math.max(0, Math.min(count - 1, row * cols + col));
}

// ===================================================================
// ===== 倉庫（isFurnitureStorageTypeな家具に付く収納） =====
// ===================================================================
// ★要望対応：倉庫の中身とインベントリの間でアイテムをやり取りする画面。
//   サブ画面のインベントリタブと同じ見た目（inventory-slot等）の2つのグリッドを左右に並べ、
//   q/eキーで操作するペインを切り替え、矢印キーでカーソル移動、zキーで選択→個数の小メニュー、
//   Fキーでそれぞれのペインの並び替えを切り替えられる（右側は本編インベントリと共通のinventorySortMode）
function manageFurnitureStorage(instance) {
  return new Promise(resolve => {
    ensurePlayerFurniture();
    if (!Array.isArray(player.furnitureStorage[instance.instanceId])) player.furnitureStorage[instance.instanceId] = [];
    const storage = player.furnitureStorage[instance.instanceId];
    const def = findFurnitureDef(instance.furnitureId);
    
    const overlay = document.getElementById("furniture-storage-overlay");
    const titleEl = document.getElementById("furniture-storage-title");
    const leftGridEl = document.getElementById("furniture-storage-left-grid");
    const rightGridEl = document.getElementById("furniture-storage-right-grid");
    const leftLabelEl = document.getElementById("furniture-storage-left-label");
    const rightLabelEl = document.getElementById("furniture-storage-right-label");
    const closeBtn = document.getElementById("furniture-storage-close");
    
    if (!overlay || !leftGridEl || !rightGridEl) { resolve(); return; } // ★万一オーバーレイが見つからなければ何もしない
    
    const COLS = 4;
    let activePane = "left"; // "left"＝倉庫側、"right"＝インベントリ側
    let leftIndex = 0, rightIndex = 0;
    let storageSortMode = "added"; // "added"（預けた順）｜"name"（名前順）
    let listenerActive = false;
    
    function getLeftEntries() {
      const entries = storage.map(s => ({ itemId: s.itemId, quantity: s.quantity, master: (typeof ITEM_MASTER !== "undefined" ? ITEM_MASTER[s.itemId] : null) }));
      if (storageSortMode === "name") entries.sort((a, b) => (a.master ? a.master.name : a.itemId).localeCompare(b.master ? b.master.name : b.itemId, "ja"));
      return entries;
    }
    
    // ★倉庫に預けられるのは今まで通りスタック可能なカテゴリ（薬草・素材など）のみ。装備品は個体差・装備中の判定が絡むため対象外
    function getRightEntries() {
      if (typeof reorganizeInventory === "function") reorganizeInventory(); // mainfunc.js：本編インベントリと同じ並び順・スタックまとめを適用
      const seen = new Set();
      const entries = [];
      inventorySlots.forEach(slot => {
        if (!slot || seen.has(slot.itemId)) return;
        const master = ITEM_MASTER[slot.itemId];
        if (!master || !STACKABLE_CATEGORIES.includes(master.category)) return;
        seen.add(slot.itemId);
        const totalQty = inventorySlots.filter(s => s && s.itemId === slot.itemId).reduce((sum, s) => sum + s.quantity, 0);
        entries.push({ itemId: slot.itemId, quantity: totalQty, master });
      });
      return entries;
    }
    
    // ★見た目はサブ画面インベントリタブのスロット（inventory-slot／item-name／item-qty）をそのまま流用する
    function buildSlotEl(entry, isSelected) {
      const slotDiv = document.createElement("div");
      slotDiv.className = "inventory-slot furniture-storage-slot" + (isSelected ? " selected" : "");
      const nameSpan = document.createElement("span");
      nameSpan.className = "item-name";
      nameSpan.textContent = entry.master ? entry.master.name : entry.itemId;
      slotDiv.appendChild(nameSpan);
      if (entry.quantity > 1) {
        const qtySpan = document.createElement("span");
        qtySpan.className = "item-qty";
        qtySpan.textContent = entry.quantity;
        slotDiv.appendChild(qtySpan);
      }
      return slotDiv;
    }
    
    function renderPane(gridEl, entries, selectedIndex, isActive, emptyText) {
      gridEl.innerHTML = "";
      gridEl.classList.toggle("furniture-storage-grid-active", isActive);
      if (entries.length === 0) {
        const empty = document.createElement("p");
        empty.className = "devmode-note";
        empty.textContent = emptyText;
        gridEl.appendChild(empty);
        return;
      }
      entries.forEach((entry, i) => gridEl.appendChild(buildSlotEl(entry, isActive && i === selectedIndex)));
    }
    
    function render() {
      const leftEntries = getLeftEntries();
      const rightEntries = getRightEntries();
      if (leftIndex >= leftEntries.length) leftIndex = Math.max(0, leftEntries.length - 1);
      if (rightIndex >= rightEntries.length) rightIndex = Math.max(0, rightEntries.length - 1);
      
      if (titleEl) titleEl.textContent = `「${def ? def.name : "倉庫"}」の中身を整理する（Q/Eで操作するインベントリを切替）`;
      if (leftLabelEl) leftLabelEl.textContent = `倉庫${activePane === "left" ? "【操作中】" : ""}　並び替え：${storageSortMode === "name" ? "名前順" : "預けた順"}（Fキー）`;
      if (rightLabelEl) rightLabelEl.textContent = `インベントリ${activePane === "right" ? "【操作中】" : ""}　並び替え：${INVENTORY_SORT_MODE_LABELS[inventorySortMode]}（Fキー）`;
      
      renderPane(leftGridEl, leftEntries, leftIndex, activePane === "left", "（空っぽ）");
      renderPane(rightGridEl, rightEntries, rightIndex, activePane === "right", "（預けられる物が無いようだ）");
    }
    
    function switchPane() {
      activePane = activePane === "left" ? "right" : "left";
      render();
    }
    
    function moveCursor(key) {
      const entries = activePane === "left" ? getLeftEntries() : getRightEntries();
      const index = activePane === "left" ? leftIndex : rightIndex;
      const newIndex = computeGridMove(index, key, COLS, entries.length);
      if (activePane === "left") leftIndex = newIndex; else rightIndex = newIndex;
      render();
    }
    
    function cycleSort() {
      if (activePane === "left") storageSortMode = storageSortMode === "added" ? "name" : "added";
      else if (typeof cycleInventorySortMode === "function") cycleInventorySortMode(); // mainfunc.js（本編インベントリと共通）
      render();
    }
    
    function pauseKeys() { if (listenerActive) { window.removeEventListener("keydown", handleKeyDown); listenerActive = false; } }
    function resumeKeys() { if (!listenerActive) { window.addEventListener("keydown", handleKeyDown); listenerActive = true; } }
    
    function cleanupAndResolve() {
      pauseKeys();
      overlay.classList.add("hidden");
      closeBtn.onclick = null;
      resolve();
    }
    
    // ★スタック可能なアイテム1種類ぶんを、倉庫↔インベントリ間で指定した個数だけ移動する
    function transfer(direction, itemId, quantity) {
      if (!quantity || quantity <= 0) return;
      if (direction === "toStorage") {
        removeItem(itemId, quantity); // inventory.js
        const existing = storage.find(s => s.itemId === itemId);
        if (existing) existing.quantity += quantity; else storage.push({ itemId, quantity });
      } else {
        const existing = storage.find(s => s.itemId === itemId);
        if (!existing) return;
        const moveQty = Math.min(quantity, existing.quantity);
        existing.quantity -= moveQty;
        if (existing.quantity <= 0) storage.splice(storage.indexOf(existing), 1);
        addItem(itemId, moveQty); // inventory.js
      }
      if (typeof renderStatusHUD === "function") renderStatusHUD();
    }
    
    // ★要望対応：選んだアイテムに「全部／半分／個数を選択して／ひとつだけ／やめる」の小さい選択肢を出す。
    //   倉庫→インベントリ方向の時は、動詞を「収納する」ではなく「戻す」系に言い換える
    async function openTransferMenu(direction, itemId, master, totalQty) {
      pauseKeys();
      changeSpeaker("");
      const toStorage = direction === "toStorage";
      const choices = totalQty > 1 ? [
        { text: toStorage ? "全部収納する" : "全部戻す", next: "all" },
        { text: toStorage ? "半分収納する" : "半分戻す", next: "half" },
        { text: toStorage ? "個数を選択して収納する" : "個数を選択して戻す", next: "pick" },
        { text: toStorage ? "ひとつだけ収納する" : "ひとつだけ戻す", next: "one" },
        { text: "やめる", next: "cancel", isBack: true }
      ] : [
        { text: toStorage ? "収納する" : "インベントリに戻す", next: "all" },
        { text: "やめる", next: "cancel", isBack: true }
      ];
      await displayMessage(`${master ? master.name : itemId} ×${totalQty}`);
      const picked = await displayChoices(choices);
      if (picked.next !== "cancel") {
        let qty = 0;
        if (picked.next === "all") qty = totalQty;
        else if (picked.next === "half") qty = Math.max(1, Math.ceil(totalQty / 2));
        else if (picked.next === "one") qty = 1;
        else if (picked.next === "pick") qty = await pickQuantity(totalQty, master ? master.name : itemId); // town.js
        if (qty > 0) transfer(direction, itemId, qty);
      }
      resumeKeys();
      render();
    }
    
    function selectCurrent() {
      if (activePane === "left") {
        const entry = getLeftEntries()[leftIndex];
        if (entry) openTransferMenu("toInventory", entry.itemId, entry.master, entry.quantity);
      } else {
        const entry = getRightEntries()[rightIndex];
        if (entry) openTransferMenu("toStorage", entry.itemId, entry.master, entry.quantity);
      }
    }
    
    function handleKeyDown(event) {
      if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); moveCursor(event.key); }
      else if (event.key === "q" || event.key === "Q" || event.key === "e" || event.key === "E") { event.preventDefault(); switchPane(); }
      else if (event.key === "f" || event.key === "F") { event.preventDefault(); cycleSort(); }
      else if (event.key === "z" || event.key === "Z" || event.key === " ") { event.preventDefault(); selectCurrent(); }
      else if (event.key === "x" || event.key === "X" || event.key === "Escape") { event.preventDefault(); cleanupAndResolve(); }
    }
    
    closeBtn.onclick = (event) => { event.stopPropagation(); cleanupAndResolve(); };
    resumeKeys();
    overlay.classList.remove("hidden");
    render();
  });
}

