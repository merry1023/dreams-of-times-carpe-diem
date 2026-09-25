// estateshop.js
// 不動産システム（フェーズ4）：不動産:店の中身。商品棚への陳列・値付け、バイト雇用、
// 開店/閉店モード、放置中の販売収入（バイトがいる時のみ）を実装する。
// ★対象はplayer.ownedProperties[key]（realestate.js）に「shop」というサブ状態を追加して管理する。

const ESTATE_SHOP_OVERPRICE_RATIO = 1.15; // ★真価のこの倍率を超える値付けは、基本的に売れにくくなる
const ESTATE_SHOP_MAX_SALES_PER_SLOT_PER_DAY = 5; // ★1日1商品あたりに売れる上限個数（暴走防止の目安値。調整可）

// ★店ごとの状態（棚・バイト・貯まった陳・開閉モード）を用意する。無ければ初期化
function ensureShopState(key) {
  ensurePlayerProperties(); // realestate.js
  const rec = player.ownedProperties[key];
  if (!rec) return null;
  if (!rec.shop || typeof rec.shop !== "object") {
    rec.shop = { mode: "closed", shelves: [], employees: [], accumulatedGold: 0 };
  }
  if (!Array.isArray(rec.shop.shelves)) rec.shop.shelves = [];
  if (!Array.isArray(rec.shop.employees)) rec.shop.employees = [];
  if (typeof rec.shop.accumulatedGold !== "number") rec.shop.accumulatedGold = 0;
  if (rec.shop.mode !== "open" && rec.shop.mode !== "closed") rec.shop.mode = "closed";
  return rec.shop;
}

// ★バイト代（1日あたりの賃金）＝物件価格 ×（2% ＋ グレード%÷2）が仕様書の式だが、
//   そのまま適用すると物件価格が高いほど日給が桁違いに跳ね上がり（例：230万の店で日給30万〜100万）、
//   商品の売上（真価は数百陳程度）では到底まかなえず、売っても手元に陳が残らなくなってしまっていた。
//   宿代(200陳)やサビ取り代(500陳)など他の物価と釣り合うよう、同じ式のまま100分の1のスケールに調整した
//   （調整前の式に戻したい場合は、下のSCALEを1に戻せばよい）
const ESTATE_SHOP_WAGE_SCALE = 0.01;
function calcEmployeeWage(area, grade) {
  const price = area.estatePrice || 0;
  const percent = 2 + grade / 2; // ★グレードは1〜100のランダム値
  return Math.max(1, Math.round(price * percent / 100 * ESTATE_SHOP_WAGE_SCALE));
}

// ===================================================================
// ===== 日次処理：開店モード＆バイトがいる店は、放置中でも1日分の売上を計算する =====
// ===================================================================
function processEstateShopDailyTick() {
  ensurePlayerProperties();
  if (!player) return;
  Object.keys(player.ownedProperties).forEach(key => {
    const rec = player.ownedProperties[key];
    if (!rec || rec.overdue || !rec.shop) return; // ★滞納中の店は営業できない
    if (rec.shop.mode !== "open" || rec.shop.employees.length === 0) return; // ★開店モード＋バイトがいる時だけ放置収入が発生する
    const area = findEstateAreaByKey(key); // realestate.js
    if (!area) return;
    runEstateShopSalesForOneDay(rec.shop, area);
  });
}

// ★1日分の販売シミュレーション（棚の商品ごとに、値付け・バイトの平均グレード・エリアの「客の来やすさ」から売れ行きを決める簡易モデル）
function runEstateShopSalesForOneDay(shop, area) {
  const avgGrade = shop.employees.reduce((sum, e) => sum + (e.grade || 0), 0) / shop.employees.length;
  const customerRate = (area && area.estateCustomerRate != null) ? area.estateCustomerRate : 500; // ★要望対応：1〜1000（基準500＝等倍）
  const customerFactor = customerRate / 500;
  let gross = 0;
  
  shop.shelves.forEach(slot => {
    if (slot.quantity <= 0) return;
    const master = typeof ITEM_MASTER !== "undefined" ? ITEM_MASTER[slot.itemId] : null;
    const trueValue = (master && master.trueValue) || 1;
    const isOverpriced = slot.price > trueValue * ESTATE_SHOP_OVERPRICE_RATIO;
    // ★真価+15%以内なら普通の客がよく買う。それを超えると、稀に来る富裕層の客だけが買う
    const baseChance = isOverpriced ? 0.08 : 0.5;
    const employeeBonus = (avgGrade / 100) * 0.2; // ★バイトのグレードが高いほど少し売れやすくなる
    const chance = Math.min(0.95, (baseChance + employeeBonus) * customerFactor);
    
    let soldToday = 0;
    const maxTries = Math.min(slot.quantity, ESTATE_SHOP_MAX_SALES_PER_SLOT_PER_DAY);
    for (let i = 0; i < maxTries; i++) {
      if (Math.random() < chance) soldToday++;
    }
    if (soldToday > 0) {
      slot.quantity -= soldToday;
      gross += soldToday * slot.price;
    }
  });
  
  shop.shelves = shop.shelves.filter(slot => slot.quantity > 0); // ★売り切れた棚は自動で片付く
  
  const wages = shop.employees.reduce((sum, e) => sum + (e.wage || 0), 0);
  shop.accumulatedGold = Math.max(0, shop.accumulatedGold + gross - wages);
}

// ===================================================================
// ===== プレイヤー側：店に入った時のメイン画面 =====
// ===================================================================
async function openShopManagement(area, goBack) {
  const key = getEstateAreaKey(area); // realestate.js
  await showShopMainMenu(area, key, goBack);
}

async function showShopMainMenu(area, key, goBack) {
  const shop = ensureShopState(key);
  changeSpeaker("");
  
  if (!shop) {
    // ★万一、所有記録が無い状態でここに来た場合（通常は起こらない）の保険
    await displayMessage("……この店にはまだ入れないようだ。");
    goBack();
    return;
  }
  
  const modeLabel = shop.mode === "open" ? "営業中（8時〜20時に自動で開閉）" : "閉店中";
  const choices = [
    { text: "商品を並べる／片付ける", next: "shelves" },
    { text: `バイトを雇う（現在${shop.employees.length}/${area.estateMaxEmployees != null ? area.estateMaxEmployees : 1}人）`, next: "hire" },
    { text: "バイトを解雇する", next: "fire" },
    { text: `貯まった陳を回収する（${shop.accumulatedGold}陳）`, next: "collect" },
    { text: shop.mode === "open" ? "閉店モードにする" : "開店モードにする", next: "toggleMode" },
    { text: "店を出る", next: "leave", isBack: true }
  ];
  
  await displayMessage(`「${area.name || "自分の店"}」（${modeLabel}）`);
  const picked = await displayChoices(choices);
  
  if (picked.next === "leave") { goBack(); return; }
  
  if (picked.next === "toggleMode") {
    shop.mode = shop.mode === "open" ? "closed" : "open";
    await displayMessage(shop.mode === "open" ? "開店モードにした。バイトがいれば、放置中でも売上が発生するようになる。" : "閉店モードにした。");
    await showShopMainMenu(area, key, goBack);
    return;
  }
  
  if (picked.next === "collect") {
    if (shop.accumulatedGold <= 0) {
      await displayMessage("まだ貯まった陳は無いようだ。");
    } else {
      changeGold(shop.accumulatedGold); // inventory.js
      if (typeof renderStatusHUD === "function") renderStatusHUD();
      await displayMessage(`${shop.accumulatedGold}陳を回収した！`);
      shop.accumulatedGold = 0;
    }
    await showShopMainMenu(area, key, goBack);
    return;
  }
  
  if (picked.next === "shelves") {
    await manageShopShelves(area, key, () => showShopMainMenu(area, key, goBack));
    return;
  }
  
  if (picked.next === "hire") {
    await hireShopEmployee(area, key, () => showShopMainMenu(area, key, goBack));
    return;
  }
  
  if (picked.next === "fire") {
    await fireShopEmployee(area, key, () => showShopMainMenu(area, key, goBack));
    return;
  }
}

// ===================================================================
// ===== 商品棚の管理 =====
// ===================================================================
async function manageShopShelves(area, key, goBack) {
  const shop = ensureShopState(key);
  const capacity = area.estateShelfCapacity != null ? area.estateShelfCapacity : 6;
  changeSpeaker("");
  
  const choices = shop.shelves.map(slot => {
    const master = typeof ITEM_MASTER !== "undefined" ? ITEM_MASTER[slot.itemId] : null;
    return { text: `${master ? master.name : slot.itemId} ×${slot.quantity}（${slot.price}陳／個）　片付ける`, next: "remove:" + slot.id };
  });
  if (shop.shelves.length < capacity) {
    choices.push({ text: `＋商品を並べる（棚：${shop.shelves.length}/${capacity}）`, next: "add" });
  }
  choices.push({ text: "戻る", next: "back", isBack: true });
  
  await displayMessage("商品棚の様子：" + (shop.shelves.length === 0 ? "（何も並んでいない）" : ""));
  const picked = await displayChoices(choices);
  
  if (picked.next === "back") { await goBack(); return; }
  
  if (picked.next === "add") {
    await addItemToShopShelf(area, key, goBack);
    return;
  }
  
  if (picked.next.startsWith("remove:")) {
    const slotId = picked.next.slice("remove:".length);
    const slot = shop.shelves.find(s => s.id === slotId);
    if (slot) {
      addItem(slot.itemId, slot.quantity); // inventory.js（インベントリへ戻す）
      shop.shelves = shop.shelves.filter(s => s.id !== slotId);
      if (typeof renderStatusHUD === "function") renderStatusHUD();
      await displayMessage("棚から片付けて、インベントリへ戻した。");
    }
    await manageShopShelves(area, key, goBack);
    return;
  }
}

// ★スタック可能なカテゴリ（薬草・素材など）だけを陳列対象にする（装備は対象外。furniture.jsの倉庫預け入れと同じ考え方）
async function addItemToShopShelf(area, key, goBack) {
  const shop = ensureShopState(key);
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
    await displayMessage("並べられる物（薬草・素材など）を持っていないようだ。");
    await manageShopShelves(area, key, goBack);
    return;
  }
  
  const choices = entries.map(e => ({ text: `${e.master.name} ×${e.totalQty}（真価：${e.master.trueValue || 0}陳）`, next: e.itemId }));
  choices.push({ text: "やめる", next: "cancel", isBack: true });
  await displayMessage("何を並べる？");
  const picked = await displayChoices(choices);
  if (picked.next === "cancel") { await manageShopShelves(area, key, goBack); return; }
  
  const entry = entries.find(e => e.itemId === picked.next);
  const qty = await pickQuantity(entry.totalQty, entry.master.name); // town.js
  if (!qty || qty <= 0) { await manageShopShelves(area, key, goBack); return; }
  
  const trueValue = entry.master.trueValue || 1;
  const suggestedMax = Math.max(trueValue * 3, trueValue + 10);
  const price = await pickQuantity(suggestedMax, entry.master.name, {
    min: 1,
    step: 1,
    stepOptions: [1, 10, 100],
    formatValue: v => `${v}陳`,
    formatLabel: max => `値段を決める（真価の目安：${trueValue}陳。${ESTATE_SHOP_OVERPRICE_RATIO * 100}%＝${Math.round(trueValue * ESTATE_SHOP_OVERPRICE_RATIO)}陳を超えると売れにくくなる）`
  });
  if (!price || price <= 0) { await manageShopShelves(area, key, goBack); return; }
  
  removeItem(entry.itemId, qty); // inventory.js
  shop.shelves.push({ id: generateId("shelf"), itemId: entry.itemId, quantity: qty, price });
  if (typeof renderStatusHUD === "function") renderStatusHUD();
  await displayMessage(`「${entry.master.name}」を${qty}個、${price}陳で棚に並べた。`);
  await manageShopShelves(area, key, goBack);
}

// ===================================================================
// ===== バイトの雇用・解雇 =====
// ===================================================================
async function hireShopEmployee(area, key, goBack) {
  const shop = ensureShopState(key);
  const maxEmployees = area.estateMaxEmployees != null ? area.estateMaxEmployees : 1;
  changeSpeaker("");
  
  if (shop.employees.length >= maxEmployees) {
    await displayMessage("これ以上バイトを雇うことはできないようだ。");
    await goBack();
    return;
  }
  
  const candidateCount = 3;
  const names = pickAuctionNpcNames(candidateCount); // auction.js（要望対応：オークションと同じ名前プール）
  const candidates = names.map(name => {
    const grade = 1 + Math.floor(Math.random() * 100); // ★グレードはランダム設定（1〜100）
    const wage = calcEmployeeWage(area, grade);
    return { name, grade, wage, hireCost: wage * 2 }; // ★雇用コスト＝バイト代の2倍
  });
  
  const choices = candidates.map((c, i) => ({ text: `${c.name}（グレード${c.grade}・日給目安${c.wage}陳・雇用費${c.hireCost}陳）`, next: String(i) }));
  choices.push({ text: "やめる", next: "cancel", isBack: true });
  await displayMessage("バイトの候補者：");
  const picked = await displayChoices(choices);
  if (picked.next === "cancel") { await goBack(); return; }
  
  const chosen = candidates[Number(picked.next)];
  const confirmed = await showGameConfirm(`「${chosen.name}」を雇用費${chosen.hireCost}陳で雇いますか？（以後、開店中は日給${chosen.wage}陳が売上から差し引かれます）`);
  if (!confirmed) { await hireShopEmployee(area, key, goBack); return; }
  
  if (typeof gold === "undefined" || gold < chosen.hireCost) {
    await displayMessage("すまないが、その持ち金では雇えないようだ……");
    await hireShopEmployee(area, key, goBack);
    return;
  }
  
  changeGold(-chosen.hireCost);
  shop.employees.push({ id: generateId("employee"), name: chosen.name, grade: chosen.grade, wage: chosen.wage });
  if (typeof renderStatusHUD === "function") renderStatusHUD();
  await displayMessage(`「${chosen.name}」を雇った！`);
  await goBack();
}

async function fireShopEmployee(area, key, goBack) {
  const shop = ensureShopState(key);
  changeSpeaker("");
  
  if (shop.employees.length === 0) {
    await displayMessage("今は誰も雇っていないようだ。");
    await goBack();
    return;
  }
  
  const choices = shop.employees.map(e => ({ text: `${e.name}（グレード${e.grade}・日給${e.wage}陳）`, next: e.id }));
  choices.push({ text: "やめる", next: "cancel", isBack: true });
  await displayMessage("誰を解雇する？");
  const picked = await displayChoices(choices);
  if (picked.next === "cancel") { await goBack(); return; }
  
  const employee = shop.employees.find(e => e.id === picked.next);
  const confirmed = await showGameConfirm(`「${employee.name}」を解雇しますか？`);
  if (confirmed) {
    shop.employees = shop.employees.filter(e => e.id !== picked.next);
    await displayMessage(`「${employee.name}」を解雇した。`);
  }
  await goBack();
}
