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
    text: `${f.name}（${f.price || 0}陳・${f.width || 1}×${f.height || 1}マス${f.isStorage ? "・倉庫" : ""}）`,
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

// ★指定した位置(x,y)〜(x+w,y+h)が、部屋の範囲内かつ他の家具と重なっていないか
function isFurniturePlacementFree(room, x, y, w, h, excludeInstanceId) {
  if (x < 0 || y < 0 || x + w > (room.width || 1) || y + h > (room.height || 1)) return false;
  return !getRoomPlacedFurniture(room.id).some(inst => {
    if (inst.instanceId === excludeInstanceId) return false;
    const def = findFurnitureDef(inst.furnitureId);
    if (!def) return false;
    const px = inst.placement.x, py = inst.placement.y;
    const pw = def.width || 1, ph = def.height || 1;
    return x < px + pw && x + w > px && y < py + ph && y + h > py; // ★矩形同士の重なり判定
  });
}

function findValidFurniturePositions(room, furnitureDef, excludeInstanceId) {
  const w = furnitureDef.width || 1, h = furnitureDef.height || 1;
  const positions = [];
  for (let y = 0; y <= (room.height || 1) - h; y++) {
    for (let x = 0; x <= (room.width || 1) - w; x++) {
      if (isFurniturePlacementFree(room, x, y, w, h, excludeInstanceId)) positions.push({ x, y });
    }
  }
  return positions;
}

// ★部屋にいる時、その部屋の家具（設置済み・未設置とも）を管理する画面。floorplan.jsの部屋画面から呼ばれる
async function manageRoomFurniture(area, floorPlan, room, goBackToRoom) {
  ensurePlayerFurniture();
  const areaKey = getEstateAreaKey(area); // realestate.js
  const placedHere = getRoomPlacedFurniture(room.id);
  const unplaced = player.ownedFurniture.filter(inst => !inst.placement);
  
  changeSpeaker("");
  const choices = [];
  placedHere.forEach(inst => {
    const def = findFurnitureDef(inst.furnitureId);
    choices.push({ text: `${def ? def.name : "？"}（設置済み）`, next: "placed:" + inst.instanceId });
  });
  unplaced.forEach(inst => {
    const def = findFurnitureDef(inst.furnitureId);
    if (!def) return;
    choices.push({ text: `${def.name}をここに置く`, next: "unplaced:" + inst.instanceId });
  });
  choices.push({ text: "戻る", next: "back", isBack: true });
  
  const emptyNote = (placedHere.length === 0 && unplaced.length === 0) ? "持っている家具が無いようだ。（家具屋で購入できます）" : "家具を選んでください。";
  await displayMessage(emptyNote);
  const picked = await displayChoices(choices);
  if (picked.next === "back") { await goBackToRoom(); return; }
  
  if (picked.next.startsWith("placed:")) {
    const instanceId = picked.next.slice("placed:".length);
    const inst = player.ownedFurniture.find(f => f.instanceId === instanceId);
    const def = inst && findFurnitureDef(inst.furnitureId);
    const options = [];
    if (def && def.isStorage) options.push({ text: "収納を開ける", next: "storage" });
    options.push({ text: "片付ける（未設置に戻す）", next: "unplace" });
    options.push({ text: "やめる", next: "cancel", isBack: true });
    await displayMessage(`「${def ? def.name : "？"}」`);
    const sub = await displayChoices(options);
    if (sub.next === "storage") {
      await manageFurnitureStorage(inst, () => manageRoomFurniture(area, floorPlan, room, goBackToRoom));
      return;
    }
    if (sub.next === "unplace") {
      inst.placement = null;
      await displayMessage(`「${def ? def.name : "？"}」を片付けた。`);
    }
    await manageRoomFurniture(area, floorPlan, room, goBackToRoom);
    return;
  }
  
  if (picked.next.startsWith("unplaced:")) {
    const instanceId = picked.next.slice("unplaced:".length);
    const inst = player.ownedFurniture.find(f => f.instanceId === instanceId);
    const def = inst && findFurnitureDef(inst.furnitureId);
    if (!def) { await manageRoomFurniture(area, floorPlan, room, goBackToRoom); return; }
    
    const positions = findValidFurniturePositions(room, def, null);
    if (positions.length === 0) {
      await displayMessage("この部屋には、もう置ける場所が無いようだ。");
      await manageRoomFurniture(area, floorPlan, room, goBackToRoom);
      return;
    }
    const posChoices = positions.map(p => ({ text: `(${p.x + 1}, ${p.y + 1})に置く`, next: `${p.x},${p.y}` }));
    posChoices.push({ text: "やめる", next: "cancel", isBack: true });
    await displayMessage(`「${def.name}」をどこに置く？（部屋の左上を(1,1)として、横${room.width}×縦${room.height}マス）`);
    const posPicked = await displayChoices(posChoices);
    if (posPicked.next !== "cancel") {
      const [px, py] = posPicked.next.split(",").map(Number);
      inst.placement = { areaKey, roomId: room.id, x: px, y: py };
      await displayMessage(`「${def.name}」を置いた。`);
    }
    await manageRoomFurniture(area, floorPlan, room, goBackToRoom);
    return;
  }
}

// ===================================================================
// ===== 倉庫（isStorageな家具に付く収納） =====
// ===================================================================
async function manageFurnitureStorage(instance, goBack) {
  ensurePlayerFurniture();
  if (!Array.isArray(player.furnitureStorage[instance.instanceId])) player.furnitureStorage[instance.instanceId] = [];
  const storage = player.furnitureStorage[instance.instanceId];
  const def = findFurnitureDef(instance.furnitureId);
  
  changeSpeaker("");
  const choices = storage.map((entry, i) => {
    const master = typeof ITEM_MASTER !== "undefined" ? ITEM_MASTER[entry.itemId] : null;
    return { text: `${master ? master.name : entry.itemId} ×${entry.quantity}　（取り出す）`, next: "take:" + i };
  });
  choices.push({ text: "アイテムを預ける", next: "deposit" });
  choices.push({ text: "閉じる", next: "close", isBack: true });
  
  await displayMessage(`「${def ? def.name : "倉庫"}」の中身：` + (storage.length === 0 ? "（空っぽ）" : ""));
  const picked = await displayChoices(choices);
  
  if (picked.next === "close") { await goBack(); return; }
  
  if (picked.next === "deposit") {
    await depositItemToFurnitureStorage(instance, goBack);
    return;
  }
  
  if (picked.next.startsWith("take:")) {
    const i = Number(picked.next.slice("take:".length));
    const entry = storage[i];
    if (entry) {
      addItem(entry.itemId, entry.quantity); // inventory.js
      storage.splice(i, 1);
      if (typeof renderStatusHUD === "function") renderStatusHUD();
      await displayMessage("取り出した。");
    }
    await manageFurnitureStorage(instance, goBack);
    return;
  }
}

// ★倉庫に預けられるのは、スタック可能なカテゴリ（薬草・素材など）のみ。装備品は対象外（個体差・装備中の判定が絡むため）
async function depositItemToFurnitureStorage(instance, goBack) {
  const storage = player.furnitureStorage[instance.instanceId];
  const seenItemIds = new Set();
  const entries = [];
  inventorySlots.forEach(slot => {
    if (!slot || seenItemIds.has(slot.itemId)) return;
    const master = ITEM_MASTER[slot.itemId];
    if (!master || !STACKABLE_CATEGORIES.includes(master.category)) return;
    seenItemIds.add(slot.itemId);
    const totalQty = inventorySlots.filter(s => s && s.itemId === slot.itemId).reduce((sum, s) => sum + s.quantity, 0);
    entries.push({ itemId: slot.itemId, master, totalQty });
  });
  
  changeSpeaker("");
  if (entries.length === 0) {
    await displayMessage("預けられる物（薬草・素材など）を持っていないようだ。");
    await manageFurnitureStorage(instance, goBack);
    return;
  }
  
  const choices = entries.map(e => ({ text: `${e.master.name} ×${e.totalQty}`, next: e.itemId }));
  choices.push({ text: "やめる", next: "cancel", isBack: true });
  await displayMessage("何を預ける？");
  const picked = await displayChoices(choices);
  if (picked.next === "cancel") { await manageFurnitureStorage(instance, goBack); return; }
  
  const entry = entries.find(e => e.itemId === picked.next);
  const qty = await pickQuantity(entry.totalQty, entry.master.name); // town.js
  if (!qty || qty <= 0) { await manageFurnitureStorage(instance, goBack); return; }
  
  removeItem(entry.itemId, qty); // inventory.js
  const existing = storage.find(s => s.itemId === entry.itemId);
  if (existing) existing.quantity += qty; else storage.push({ itemId: entry.itemId, quantity: qty });
  if (typeof renderStatusHUD === "function") renderStatusHUD();
  await displayMessage(`${qty}個を預けた。`);
  await manageFurnitureStorage(instance, goBack);
}
