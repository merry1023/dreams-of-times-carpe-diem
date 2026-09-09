// crafting.js
// 鍛冶屋（装備の作成・強化）・素材合成屋（幅広いレシピでのアイテム作成）を扱う。
// どちらも中身は同じ「レシピ（材料→完成品）」の仕組みで動く（scenarioProject.recipes、レシピ管理タブで登録）。

// ★所持している対象アイテムの合計個数を数える（スタック品・装備品どちらでも、複数マスに分かれていても正しく数える）
function getItemCount(itemId) {
  if (!itemId) return 0;
  return inventorySlots.reduce((sum, slot) => (slot && slot.itemId === itemId) ? sum + (slot.quantity || 1) : sum, 0);
}

// ★このレシピで「装備を消費する」箇所（強化元、および装備カテゴリの材料）を列挙する。
//   お気に入りの装備を誤って消費しないよう、これらは自動選択せず、ユーザーに個体を選んでもらう（要望対応）
function getEquipmentConsumptionSpecs(recipe) {
  const specs = [];
  if (recipe.mode === "upgrade" && recipe.baseItemId) {
    const master = ITEM_MASTER[recipe.baseItemId];
    if (master && !isStackable(master.category)) specs.push({ itemId: recipe.baseItemId, count: 1, label: "強化元" });
  }
  (recipe.materials || []).forEach(mat => {
    const master = ITEM_MASTER[mat.itemId];
    if (master && !isStackable(master.category)) specs.push({ itemId: mat.itemId, count: mat.count, label: "材料" });
  });
  return specs;
}

// ★1つの消費枠（itemId × count個）について、実際にどの個体（instanceId）を消費するかを
//   グリッド画面で選んでもらう。選び終わるまでこのPromiseは解決しない
function pickEquipmentInstances(spec) {
  return new Promise(resolve => {
    const candidates = inventorySlots
      .map((slot, index) => ({ slot, index }))
      .filter(entry => entry.slot && entry.slot.itemId === spec.itemId);
    
    // ★候補が必要数ぴったりしか無ければ、選ぶ余地が無いのでそのまま自動で確定する
    if (candidates.length <= spec.count) {
      resolve(candidates.map(c => c.slot.instanceId));
      return;
    }
    
    const picker = document.getElementById("crafting-instance-picker");
    const labelEl = document.getElementById("crafting-instance-picker-label");
    const gridEl = document.getElementById("crafting-instance-picker-grid");
    if (!picker || !labelEl || !gridEl) { resolve(candidates.slice(0, spec.count).map(c => c.slot.instanceId)); return; }
    
    const master = ITEM_MASTER[spec.itemId];
    const selected = [];
    labelEl.textContent = `${spec.label}：「${master ? master.name : spec.itemId}」をどれを使う？（${selected.length}/${spec.count}）`;
    document.querySelectorAll("#crafting-overlay .crafting-body").forEach(el => el.classList.add("hidden"));
    picker.classList.remove("hidden");
    gridEl.innerHTML = "";
    
    candidates.forEach(({ slot }) => {
      const cell = document.createElement("div");
      cell.className = "inventory-slot";
      
      const nameEl = document.createElement("span");
      nameEl.className = "item-name";
      nameEl.textContent = master ? master.name : spec.itemId;
      cell.appendChild(nameEl);
      
      if (slot.statBonus) {
        const bonusEl = document.createElement("span");
        bonusEl.className = "crafting-instance-picker-bonus";
        bonusEl.textContent = `変位${slot.statBonus.amount >= 0 ? "+" : ""}${slot.statBonus.amount}`;
        cell.appendChild(bonusEl);
      }
      if (typeof isInstanceEquippedByAnyone === "function" && isInstanceEquippedByAnyone(slot.instanceId)) {
        const equippedTag = document.createElement("span");
        equippedTag.className = "item-equipped-tag";
        equippedTag.textContent = "装備中";
        cell.appendChild(equippedTag);
      }
      
      cell.onclick = (event) => {
        event.stopPropagation();
        if (cell.classList.contains("selected")) {
          cell.classList.remove("selected");
          const i = selected.indexOf(slot.instanceId);
          if (i !== -1) selected.splice(i, 1);
        } else {
          if (selected.length >= spec.count) return; // ★必要数を超えては選べない
          cell.classList.add("selected");
          selected.push(slot.instanceId);
        }
        labelEl.textContent = `${spec.label}：「${master ? master.name : spec.itemId}」をどれを使う？（${selected.length}/${spec.count}）`;
        if (selected.length === spec.count) {
          picker.classList.add("hidden");
          document.querySelectorAll("#crafting-overlay .crafting-body").forEach(el => el.classList.remove("hidden"));
          resolve(selected.slice());
        }
      };
      
      gridEl.appendChild(cell);
    });
  });
}

// ★強化レシピで、完成品と同じアイテムIDの装備が既に（主人公か仲間の）どこかに装備されていた場合、
//   ステータスの変位値が「今装備している物」より必ず上になるようにする（要望対応）。
//   既に変位が個体差の最大値に達していたら、これ以上は伸ばせないので専用メッセージを出す
function findEquippedInstanceByItemId(itemId) {
  const holders = [player, ...((player && player.companions) || [])];
  for (const holder of holders) {
    if (!holder || !holder.equipment) continue;
    for (const slotKey of Object.keys(holder.equipment)) {
      const instanceId = holder.equipment[slotKey];
      if (instanceId == null) continue;
      const slot = inventorySlots.find(s => s && s.instanceId === instanceId);
      if (slot && slot.itemId === itemId) return slot;
    }
  }
  return null;
}

// ★applyUpgradeStatBonusGuaranteeの戻り値：{ maxedOut: bool }
function applyUpgradeStatBonusGuarantee(recipe) {
  const equippedSlot = findEquippedInstanceByItemId(recipe.resultItemId);
  if (!equippedSlot || !equippedSlot.statBonus) return { maxedOut: false };
  
  const master = ITEM_MASTER[recipe.resultItemId];
  const range = (master && master.statBonusRange && typeof master.statBonusRange.min === "number" && typeof master.statBonusRange.max === "number")
    ? master.statBonusRange : { min: -20, max: 20 };
  
  if (equippedSlot.statBonus.amount >= range.max) return { maxedOut: true }; // ★既に個体差の上限に達している
  
  // ★今作ったばかりの新しい個体（instanceIdが一番大きいもの）を見つけて、変位を今装備している物より上に上書きする
  const newSlot = inventorySlots
    .filter(s => s && s.itemId === recipe.resultItemId && s.statBonus)
    .sort((a, b) => b.instanceId - a.instanceId)[0];
  if (!newSlot) return { maxedOut: false };
  
  newSlot.statBonus.amount = Math.min(range.max, equippedSlot.statBonus.amount + 1 + Math.floor(Math.random() * 3));
  newSlot.statBonus.maxRange = range.max;
  return { maxedOut: false };
}

// ★このレシピが今すぐ作れる状態か判定する。材料の不足・強化元の有無・所持金をまとめて返す
function checkRecipeRequirements(recipe) {
  const missingMaterials = (recipe.materials || []).filter(mat => getItemCount(mat.itemId) < mat.count);
  const hasBaseItem = recipe.mode !== "upgrade" || getItemCount(recipe.baseItemId) > 0;
  const hasGold = gold >= (recipe.cost || 0);
  return {
    canCraft: missingMaterials.length === 0 && hasBaseItem && hasGold,
    missingMaterials, hasBaseItem, hasGold
  };
}

// ★実際にレシピを実行する（呼ぶ前に checkRecipeRequirements で作れることを確認しておくこと）
// @param {Object} pickedInstances - { [itemId]: [instanceId, ...] } ピッカーで選んだ、消費する装備の個体
function performCraftRecipe(recipe, pickedInstances) {
  pickedInstances = pickedInstances || {};
  (recipe.materials || []).forEach(mat => {
    const picks = pickedInstances[mat.itemId];
    if (picks && picks.length > 0) {
      // ★装備カテゴリの材料：ピッカーで選んだ個体だけを狙って消費する（お気に入りを誤って消費しないように）
      picks.forEach(instanceId => removeItemInstance(instanceId)); // inventory.js
    } else {
      removeItem(mat.itemId, mat.count); // inventory.js（スタック可能な材料は、今まで通り個体を問わず消費する）
    }
  });
  if (recipe.mode === "upgrade") {
    const basePicks = pickedInstances[recipe.baseItemId];
    if (basePicks && basePicks.length > 0) removeItemInstance(basePicks[0]);
    else removeItem(recipe.baseItemId, 1);
  }
  if (recipe.cost) changeGold(-recipe.cost); // inventory.js
  const added = addItem(recipe.resultItemId, recipe.resultCount || 1); // inventory.js
  // ★強化レシピで、完成品と同じ装備が既にどこかに装備されていたら、変位値がそれより上になるようにする（要望対応）
  const upgradeResult = (added && recipe.mode === "upgrade") ? applyUpgradeStatBonusGuarantee(recipe) : { maxedOut: false };
  renderStatusHUD();
  return { added, maxedOut: upgradeResult.maxedOut };
}

// ★レシピ1件ぶんの、店頭での説明テキスト（必要な物を一覧で見せる）
function buildRecipeRequirementText(recipe) {
  const parts = [];
  (recipe.materials || []).forEach(mat => {
    const master = ITEM_MASTER[mat.itemId];
    const have = getItemCount(mat.itemId);
    parts.push(`${master ? master.name : mat.itemId}×${mat.count}（所持${have}）`);
  });
  if (recipe.mode === "upgrade") {
    const baseMaster = ITEM_MASTER[recipe.baseItemId];
    parts.push(`${baseMaster ? baseMaster.name : recipe.baseItemId}×1（強化元・所持${getItemCount(recipe.baseItemId)}）`);
  }
  if (recipe.cost) parts.push(`${recipe.cost}陳`);
  return parts.length > 0 ? parts.join("、") : "（材料不要）";
}

// ★鍛冶屋・素材合成屋、共通の店頭処理。実際の一覧・詳細・作成ボタンは専用画面（下のopenCraftingShopScreen、
//   #crafting-overlay）で表示する。以前は選択肢だけの簡素な画面だったのを、専用のレイアウトに作り直した
async function openCraftingShop(facility, shopType, returnTo) {
  const goBack = typeof returnTo === "function" ? returnTo : openTownMenu; // town.js
  currentLocationKey = "facility_" + facility.id; // ★セーブ/ロードで現在地を復元するための記録
  
  const recipes = (scenarioProject.recipes || []).filter(r => (r.shopType || "blacksmith") === shopType && (!r.facilityId || r.facilityId === facility.id)); // ★要望対応：facilityIdを指定したレシピは、その施設だけで使える
  
  if (recipes.length === 0) {
    hideLocationMenu();
    changeSpeaker(facility.name || "");
    await displayMessage("……今のところ、ここで頼めることは無いようだ。");
    goBack();
    return;
  }
  
  // ★入店セリフ（facility.ownerDialogue）は、ここに来る前に town.js の openCustomFacility() 側で
  //   runFacilityDialogueBlocks() として既に1回流されている（ここではもう表示しない＝二重読み対策）
  openCraftingShopScreen(facility, shopType, goBack);
}

// ===== 鍛冶屋・素材合成屋の専用画面（#crafting-overlay） =====
let craftingOverlayState = null; // { facility, shopType, goBack, recipes, selectedIndex }

function openCraftingShopScreen(facility, shopType, goBack) {
  const recipes = (scenarioProject.recipes || []).filter(r => (r.shopType || "blacksmith") === shopType && (!r.facilityId || r.facilityId === facility.id)); // ★要望対応：facilityIdを指定したレシピは、その施設だけで使える
  craftingOverlayState = { facility, shopType, goBack, recipes, selectedIndex: recipes.length > 0 ? 0 : -1 };
  
  const overlay = document.getElementById("crafting-overlay");
  if (!overlay) return;
  if (typeof hideLocationMenu === "function") hideLocationMenu(); // mainfunc.js（★裏の行き先メニューがキー操作を横取りしないように）
  overlay.classList.remove("hidden");
  
  const titleEl = document.getElementById("crafting-title");
  if (titleEl) {
    const verb = shopType === "blacksmith" ? "何を打つ（強化する）？" : "何を作る？";
    titleEl.textContent = `${facility.name || (shopType === "blacksmith" ? "鍛冶屋" : "素材合成屋")}　${verb}`;
  }
  
  renderCraftingShopScreen();
  window.addEventListener("keydown", handleCraftingShopKeyDown);
}

function closeCraftingShopScreen() {
  const overlay = document.getElementById("crafting-overlay");
  if (overlay) overlay.classList.add("hidden");
  window.removeEventListener("keydown", handleCraftingShopKeyDown);
  const goBack = craftingOverlayState && craftingOverlayState.goBack;
  craftingOverlayState = null;
  if (typeof goBack === "function") goBack();
}

function renderCraftingShopScreen() {
  const state = craftingOverlayState;
  if (!state) return;
  const listEl = document.getElementById("crafting-recipe-list");
  const detailEl = document.getElementById("crafting-detail-panel");
  if (!listEl || !detailEl) return;
  
  listEl.innerHTML = "";
  state.recipes.forEach((recipe, index) => {
    const req = checkRecipeRequirements(recipe);
    const row = document.createElement("button");
    row.className = "crafting-recipe-row"
      + (index === state.selectedIndex ? " crafting-recipe-row-selected" : "")
      + (!req.canCraft ? " crafting-recipe-row-disabled" : "");
    const nameEl = document.createElement("span");
    nameEl.className = "crafting-recipe-row-name";
    nameEl.textContent = recipe.name;
    row.appendChild(nameEl);
    if (!req.canCraft) {
      const statusEl = document.createElement("span");
      statusEl.className = "crafting-recipe-row-status";
      statusEl.textContent = "材料不足";
      row.appendChild(statusEl);
    }
    row.onclick = (event) => {
      event.stopPropagation();
      state.selectedIndex = index;
      renderCraftingShopScreen();
    };
    listEl.appendChild(row);
  });
  
  detailEl.innerHTML = "";
  const recipe = state.recipes[state.selectedIndex];
  if (!recipe) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "crafting-detail-empty";
    emptyEl.textContent = "左の一覧からレシピを選んでください。";
    detailEl.appendChild(emptyEl);
    return;
  }
  
  const req = checkRecipeRequirements(recipe);
  
  const nameEl = document.createElement("h3");
  nameEl.className = "crafting-detail-name";
  nameEl.textContent = recipe.name;
  detailEl.appendChild(nameEl);
  
  if (recipe.description) {
    const descEl = document.createElement("p");
    descEl.className = "crafting-detail-desc";
    descEl.textContent = recipe.description;
    detailEl.appendChild(descEl);
  }
  
  const materialsEl = document.createElement("ul");
  materialsEl.className = "crafting-detail-materials";
  (recipe.materials || []).forEach(mat => {
    const master = ITEM_MASTER[mat.itemId];
    const have = getItemCount(mat.itemId);
    const li = document.createElement("li");
    if (have < mat.count) li.className = "crafting-material-missing";
    li.textContent = `${master ? master.name : mat.itemId}×${mat.count}（所持${have}）`;
    materialsEl.appendChild(li);
  });
  if (recipe.mode === "upgrade") {
    const baseMaster = ITEM_MASTER[recipe.baseItemId];
    const have = getItemCount(recipe.baseItemId);
    const li = document.createElement("li");
    if (have < 1) li.className = "crafting-material-missing";
    li.textContent = `${baseMaster ? baseMaster.name : recipe.baseItemId}×1（強化元・所持${have}）`;
    materialsEl.appendChild(li);
  }
  if (recipe.cost) {
    const li = document.createElement("li");
    if (!req.hasGold) li.className = "crafting-material-missing";
    li.textContent = `${recipe.cost}陳`;
    materialsEl.appendChild(li);
  }
  if (materialsEl.children.length === 0) {
    const li = document.createElement("li");
    li.textContent = "（材料不要）";
    materialsEl.appendChild(li);
  }
  detailEl.appendChild(materialsEl);
  
  const craftBtn = document.createElement("button");
  craftBtn.className = "crafting-craft-btn";
  craftBtn.textContent = recipe.mode === "upgrade" ? "強化する" : "作成する";
  craftBtn.disabled = !req.canCraft;
  craftBtn.onclick = (event) => {
    event.stopPropagation();
    attemptCraftSelectedRecipe();
  };
  detailEl.appendChild(craftBtn);
}

// ★確認・結果メッセージは通常の会話ウィンドウ（displayMessage/showGameConfirm）を使い回す。
//   専用画面は主画面全体を覆っているため、表示している間は一旦隠してから会話を進める
async function attemptCraftSelectedRecipe() {
  const state = craftingOverlayState;
  if (!state) return;
  const recipe = state.recipes[state.selectedIndex];
  if (!recipe) return;
  const req = checkRecipeRequirements(recipe);
  if (!req.canCraft) return;
  
  const overlay = document.getElementById("crafting-overlay");
  if (overlay) overlay.classList.add("hidden");
  
  changeSpeaker(state.facility.name || "");
  const confirmed = await showGameConfirm(`「${recipe.name}」を${recipe.mode === "upgrade" ? "強化" : "作成"}しますか？`); // mainfunc.js
  if (!confirmed) {
    if (overlay) overlay.classList.remove("hidden");
    renderCraftingShopScreen();
    return;
  }
  
  // ★装備を消費する箇所があれば、お気に入りを誤って消費しないよう「どの個体を使うか」を先に選んでもらう
  if (overlay) overlay.classList.remove("hidden"); // ★ピッカーはcrafting-overlay内に表示するので、隠したままにしない
  const specs = getEquipmentConsumptionSpecs(recipe);
  const pickedInstances = {};
  for (const spec of specs) {
    pickedInstances[spec.itemId] = await pickEquipmentInstances(spec);
  }
  if (overlay) overlay.classList.add("hidden");
  
  const { added, maxedOut } = performCraftRecipe(recipe, pickedInstances);
  changeSpeaker(state.facility.name || "");
  if (added) {
    const resultMaster = ITEM_MASTER[recipe.resultItemId];
    await displayMessage(`「${resultMaster ? resultMaster.name : recipe.resultItemId}」が出来上がった！`);
    if (maxedOut) {
      await displayMessage("「この装備はこれ以上強くならないだろう。」"); // ★変位が既に個体差の上限に達していた場合（要望対応）
    }
  } else {
    await displayMessage("……持ち物がいっぱいで、渡せなかったようだ。材料は無事に返しておく。");
    // ★渡せなかった場合は、消費した材料・強化元・お金を全部返す（addItemの失敗＝インベントリ満杯のケースのみ想定）
    (recipe.materials || []).forEach(mat => addItem(mat.itemId, mat.count));
    if (recipe.mode === "upgrade") addItem(recipe.baseItemId, 1, { noStatBonus: true });
    if (recipe.cost) changeGold(recipe.cost);
    renderStatusHUD();
  }
  
  if (!craftingOverlayState) return; // ★万一メッセージ表示中に画面外から閉じられていたら何もしない
  if (overlay) overlay.classList.remove("hidden");
  renderCraftingShopScreen();
}

// ★↑↓でレシピ選択、決定キーで作成、キャンセルキーで戻る（話のブロックエディタ等と同じキー割り当て）
function handleCraftingShopKeyDown(event) {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
  const overlay = document.getElementById("crafting-overlay");
  if (!overlay || overlay.classList.contains("hidden")) return;
  const picker = document.getElementById("crafting-instance-picker");
  if (picker && !picker.classList.contains("hidden")) return; // ★装備選択ピッカー表示中は、マウス操作のみで選んでもらう
  if (typeof isGameDialogOpen !== "undefined" && isGameDialogOpen) return; // ★確認ダイアログ表示中はここでは反応しない
  if (event.repeat) return;
  const state = craftingOverlayState;
  if (!state) return;
  
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    if (state.recipes.length === 0) return;
    event.preventDefault();
    const dir = event.key === "ArrowUp" ? -1 : 1;
    state.selectedIndex = (state.selectedIndex + dir + state.recipes.length) % state.recipes.length;
    renderCraftingShopScreen();
    // ★選択が一覧の端で見切れていたら、自動でスクロールして見えるようにする
    const listEl = document.getElementById("crafting-recipe-list");
    const selectedRow = listEl && listEl.children[state.selectedIndex];
    if (selectedRow && selectedRow.scrollIntoView) selectedRow.scrollIntoView({ block: "nearest" });
  } else if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.decideKeys.includes(event.key)) {
    event.preventDefault();
    attemptCraftSelectedRecipe();
  } else if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.cancelKeys.includes(event.key)) {
    event.preventDefault();
    closeCraftingShopScreen();
  }
}
// ★閉じるボタン（マウス操作用）。キーボードのキャンセルキーと同じ扱いで、専用画面を閉じて戻り先へ戻る
document.addEventListener("DOMContentLoaded", () => {
  const closeBtn = document.getElementById("crafting-close-btn");
  if (closeBtn) closeBtn.onclick = (event) => {
    event.stopPropagation();
    closeCraftingShopScreen();
  };
});
