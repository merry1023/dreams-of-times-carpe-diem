// cooking.js
// ★要望対応：料理タブ。サブ画面のどこからでも開ける（施設は不要）。
//   流れ：所持している「料理道具」（cookingToolカテゴリ）を選ぶ → その道具のスロット数ぶん、材料を自由に置く
//   → 作る個数を指定 → 「作る」。材料が対象の道具向けのレシピ（scenarioProject.recipes、shopType:"cooking"）と
//   個数までぴったり一致すれば成功（完成品＝foodカテゴリのアイテムを獲得）、一致しなければ材料は消えてなくなる。
//   道具は使うたびに耐久度が減り（今回使った材料の個数ぶん×作る個数）、0になると壊れてインベントリから消える。
//   レシピは「使う」と登録される専用アイテム（items.js/scenariobuild.jsのisRecipeItem）で発見できるが、
//   未発見でも材料さえ合っていれば作成できる（player.knownCookingRecipeIdsはレシピ帳の表示にだけ使う）。
//   「作る」を押すとレシピごとに指定した秒数（recipe.cookTimeSeconds）ぶんゲージが溜まるまで待たされる。

let cookingSelectedToolInstanceId = null;
// ★選んだスロットの中身。[{ itemId, count }, ...]（未選択のスロットはitemId: ""）
let cookingSlotPicks = [];
let cookingBatchCount = 1;
// ★要望対応：キーボード操作用のカーソル。tool→slot→batch→cook の順に並んだ「操作対象一覧」の何番目にいるか
let cookingCursorIndex = 0;
// ★カーソルが今どの材料スロットの「個数調整モード」に入っているか（nullなら通常のカーソル移動モード）
let cookingSlotCountEditIndex = null;
// ★「作る」を押してからゲージが溜まるまでの間、trueにして他の操作を受け付けないようにする
let cookingGaugeActive = false;

// ★戦闘中・話（シナリオ）再生中は料理できない（要望対応）
function isCookingBlocked() {
  if (typeof battleState !== "undefined" && battleState) return "戦闘中は料理できないようだ……";
  if (window.isScenarioChapterPlaying) return "この話の途中では、落ち着いて料理はできなさそうだ……";
  return null;
}

// ★所持している料理道具の個体一覧（インベントリスロットそのものを返す。instanceId・durabilityを持つ）
function getOwnedCookingTools() {
  return inventorySlots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => slot && ITEM_MASTER[slot.itemId] && ITEM_MASTER[slot.itemId].category === "cookingTool")
    .map(({ slot }) => ({ slot, master: ITEM_MASTER[slot.itemId] }));
}

function getSelectedCookingTool() {
  return getOwnedCookingTools().find(t => t.slot.instanceId === cookingSelectedToolInstanceId) || null;
}

// ★今インベントリにある「材料になりうるアイテム」の一覧（アイテムIDごとに合計所持数をまとめる）。
//   料理道具・料理（完成品）そのものは材料選択肢からは除く
function getCookableMaterialOptions() {
  const counts = {};
  inventorySlots.forEach(slot => {
    if (!slot) return;
    const master = ITEM_MASTER[slot.itemId];
    if (!master || master.category === "cookingTool" || master.category === "food") return;
    counts[slot.itemId] = (counts[slot.itemId] || 0) + (slot.quantity || 1);
  });
  return Object.keys(counts).map(itemId => ({ itemId, name: ITEM_MASTER[itemId].name, count: counts[itemId] }));
}

function selectCookingTool(instanceId) {
  cookingSelectedToolInstanceId = instanceId;
  const tool = getSelectedCookingTool();
  // ★要望対応：スロット数を設定し忘れていても材料が1つしか選べなくならないよう、未設定時は既定値3を使う（アイテム編集欄のプレースホルダーと合わせる）
  const slotCount = tool ? Math.max(1, Number(tool.master.toolSlotCount) || 3) : 0;
  cookingSlotPicks = new Array(slotCount).fill(null).map(() => ({ itemId: "", count: 1 }));
  cookingSlotCountEditIndex = null;
  renderCookingTab();
}

// ★スロットに置いた材料の集合が、指定レシピの材料（itemId+count）と個数まで完全一致しているか判定
function doesRecipeMatchPicks(recipe, picks) {
  const filled = picks.filter(p => p.itemId && p.count > 0);
  const materials = recipe.materials || [];
  if (filled.length !== materials.length) return false;
  return materials.every(mat => filled.some(p => p.itemId === mat.itemId && Number(p.count) === Number(mat.count)));
}

// ★要望対応：キーボード操作用の「操作対象一覧」。上から順に、道具一覧→（道具選択済みなら）材料スロット→作る個数→作るボタン
function getCookingFocusList() {
  const tools = getOwnedCookingTools();
  const list = tools.map((entry, index) => ({ type: "tool", index, entry }));
  const tool = getSelectedCookingTool();
  if (tool) {
    cookingSlotPicks.forEach((pick, index) => list.push({ type: "slot", index, pick }));
    list.push({ type: "batch" });
    list.push({ type: "cook" });
  }
  return list;
}

// ★要望対応：「作る」を押してから、レシピごとに指定した秒数ぶんゲージが溜まるアニメーションを見せて待たせる
function waitForCookingGauge(durationSeconds) {
  return new Promise(resolve => {
    const root = document.getElementById("cooking-root");
    const durationMs = Math.max(150, (Number(durationSeconds) || 0) * 1000);
    const start = Date.now();
    
    function paint(fraction) {
      if (!root) return;
      root.innerHTML = "";
      const wrap = document.createElement("div");
      wrap.className = "cooking-gauge-wrap";
      const label = document.createElement("p");
      label.textContent = "調理中……";
      wrap.appendChild(label);
      const outer = document.createElement("div");
      outer.className = "gauge-bar cooking-gauge-outer";
      const inner = document.createElement("div");
      inner.className = "gauge-fill cooking-gauge-fill";
      inner.style.width = `${Math.min(100, Math.max(0, fraction * 100))}%`;
      outer.appendChild(inner);
      wrap.appendChild(outer);
      root.appendChild(wrap);
    }
    
    paint(0);
    const intervalId = setInterval(() => {
      const fraction = Math.min(1, (Date.now() - start) / durationMs);
      paint(fraction);
      if (fraction >= 1) {
        clearInterval(intervalId);
        resolve();
      }
    }, 80);
  });
}

async function attemptCook() {
  if (cookingGaugeActive) return; // ★ゲージが溜まっている間の二重実行を防ぐ
  
  const blockedReason = isCookingBlocked();
  if (blockedReason) {
    changeSpeaker("");
    await displayMessage(blockedReason, { allowSubFocus: true });
    return;
  }
  
  const tool = getSelectedCookingTool();
  if (!tool) return;
  
  const filled = cookingSlotPicks.filter(p => p.itemId && p.count > 0);
  if (filled.length === 0) {
    changeSpeaker("");
    await displayMessage("材料を何も置いていないようだ。", { allowSubFocus: true });
    return;
  }
  
  const batchCount = Math.max(1, Math.floor(Number(cookingBatchCount) || 1));
  
  // ★必要な個数（1回分×作る個数）が、実際に足りているか確認する
  for (const pick of filled) {
    const needed = pick.count * batchCount;
    if (getItemCount(pick.itemId) < needed) { // crafting.js
      changeSpeaker("");
      await displayMessage(`「${ITEM_MASTER[pick.itemId].name}」が足りないようだ（必要：${needed}個）。`, { allowSubFocus: true });
      return;
    }
  }
  
  // ★対象の道具向けレシピの中から、個数までぴったり一致するものを探す（ゲージの待ち時間はここで先に決める）
  const candidateRecipes = (scenarioProject.recipes || []).filter(r => r.shopType === "cooking" && r.toolItemId === tool.slot.itemId);
  const matchedRecipe = candidateRecipes.find(r => doesRecipeMatchPicks(r, cookingSlotPicks));
  
  // ★要望対応：レシピ管理タブで指定した秒数ぶん、ゲージが溜まるまで待たせる（一致しなかった時は既定の短い待ち時間）
  const waitSeconds = matchedRecipe && matchedRecipe.cookTimeSeconds != null ? Number(matchedRecipe.cookTimeSeconds) : (matchedRecipe ? 3 : 2);
  cookingGaugeActive = true;
  await waitForCookingGauge(waitSeconds);
  cookingGaugeActive = false;
  
  // ★材料を消費する（成功・失敗問わず、置いた分は無くなる）
  filled.forEach(pick => removeItem(pick.itemId, pick.count * batchCount));
  
  // ★道具の耐久度を、今回使った材料の総数×作る個数ぶん減らす
  const totalMaterialCount = filled.reduce((sum, p) => sum + p.count, 0) * batchCount;
  const durabilityResult = reduceCookingToolDurability(tool.slot.instanceId, totalMaterialCount); // inventory.js
  
  changeSpeaker("");
  if (matchedRecipe) {
    const resultCount = (matchedRecipe.resultCount || 1) * batchCount;
    const addOk = addItem(matchedRecipe.resultItemId, resultCount);
    const resultMaster = ITEM_MASTER[matchedRecipe.resultItemId];
    if (addOk) {
      await displayMessage(`「${resultMaster ? resultMaster.name : matchedRecipe.resultItemId}」が${resultCount}個出来上がった！`, { allowSubFocus: true });
    } else {
      await displayMessage("……持ち物がいっぱいで、出来上がった料理を持てなかった。もったいないことをした……", { allowSubFocus: true });
    }
  } else {
    await displayMessage("うまく組み合わさらなかったようだ……材料は失敗作になってしまった。", { allowSubFocus: true });
  }
  if (durabilityResult.broke) {
    await displayMessage(`「${tool.master.name}」は、ついに使い物にならなくなってしまった……`, { allowSubFocus: true });
    cookingSelectedToolInstanceId = null;
    cookingSlotPicks = [];
    cookingCursorIndex = 0;
  }
  
  renderStatusHUD();
  renderCookingTab();
}

// ★要望対応：料理タブのキーボード操作。↑↓でカーソル移動、←→で選択中の項目の値を変える、
//   Z（決定）でその項目を実行、X（キャンセル）で材料枠を空にする／個数調整モードを抜ける
function handleCookingKeyDown(event) {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★シナリオエディタ表示中は本編を操作させない
  if (typeof controlFocus !== "undefined" && controlFocus !== "sub") return; // ★サブ画面操作中のみ有効
  const activeTab = document.querySelector(".tab-content.active");
  if (!activeTab || activeTab.id !== "tab-cooking") return;
  if (typeof isGameDialogOpen !== "undefined" && isGameDialogOpen) return; // ★確認ダイアログ表示中は反応しない
  if (event.repeat) return;
  if (cookingGaugeActive) return; // ★ゲージが溜まっている間は操作させない
  if (isCookingBlocked()) return; // ★戦闘中・シナリオ再生中はここでも操作させない
  
  const focusList = getCookingFocusList();
  if (focusList.length === 0) return;
  if (cookingCursorIndex >= focusList.length) cookingCursorIndex = focusList.length - 1;
  if (cookingCursorIndex < 0) cookingCursorIndex = 0;
  const current = focusList[cookingCursorIndex];
  
  // ★材料スロットの「個数調整モード」中は、←→で個数のみを変え、Z/Xで通常モードへ戻る
  if (cookingSlotCountEditIndex !== null) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopImmediatePropagation();
      const pick = cookingSlotPicks[cookingSlotCountEditIndex];
      if (pick) {
        const dir = event.key === "ArrowRight" ? 1 : -1;
        pick.count = Math.max(1, (Number(pick.count) || 1) + dir);
        renderCookingTab();
      }
      return;
    }
    if (typeof KEY_CONFIG !== "undefined" && (KEY_CONFIG.decideKeys.includes(event.key) || KEY_CONFIG.cancelKeys.includes(event.key))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      cookingSlotCountEditIndex = null;
      renderCookingTab();
    }
    return;
  }
  
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    event.stopImmediatePropagation();
    const dir = event.key === "ArrowUp" ? -1 : 1;
    cookingCursorIndex = (cookingCursorIndex + dir + focusList.length) % focusList.length;
    renderCookingTab();
    return;
  }
  
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    if (current.type === "slot") {
      event.preventDefault();
      event.stopImmediatePropagation();
      const materialOptions = getCookableMaterialOptions();
      const choices = ["", ...materialOptions.map(o => o.itemId)];
      const pick = cookingSlotPicks[current.index];
      const currentPos = Math.max(0, choices.indexOf(pick.itemId || ""));
      const dir = event.key === "ArrowRight" ? 1 : -1;
      const nextPos = (currentPos + dir + choices.length) % choices.length;
      cookingSlotPicks[current.index] = { itemId: choices[nextPos], count: 1 };
      renderCookingTab();
    } else if (current.type === "batch") {
      event.preventDefault();
      event.stopImmediatePropagation();
      const dir = event.key === "ArrowRight" ? 1 : -1;
      cookingBatchCount = Math.max(1, (Number(cookingBatchCount) || 1) + dir);
      renderCookingTab();
    }
    return;
  }
  
  if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.decideKeys.includes(event.key)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (current.type === "tool") {
      selectCookingTool(current.entry.slot.instanceId);
      cookingCursorIndex = 0; // ★道具を選び直したら、新しいスロット構成の先頭（＝道具一覧の同じ位置）からになるので0に戻す
    } else if (current.type === "slot") {
      if (cookingSlotPicks[current.index].itemId) cookingSlotCountEditIndex = current.index;
      renderCookingTab();
    } else if (current.type === "cook") {
      attemptCook();
    }
    return;
  }
  
  if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.cancelKeys.includes(event.key)) {
    if (current.type === "slot" && cookingSlotPicks[current.index].itemId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      cookingSlotPicks[current.index] = { itemId: "", count: 1 };
      renderCookingTab();
    }
  }
}
window.addEventListener("keydown", handleCookingKeyDown);

function renderCookingTab() {
  const root = document.getElementById("cooking-root");
  if (!root) return;
  root.innerHTML = "";
  
  if (cookingGaugeActive) return; // ★ゲージ表示中はwaitForCookingGaugeが直接描画するので、ここでは何もしない
  
  const blockedReason = isCookingBlocked();
  if (blockedReason) {
    const note = document.createElement("p");
    note.className = "cooking-empty-note";
    note.textContent = blockedReason;
    root.appendChild(note);
    return;
  }
  
  const focusList = getCookingFocusList();
  if (cookingCursorIndex >= focusList.length) cookingCursorIndex = Math.max(0, focusList.length - 1);
  const currentFocus = focusList[cookingCursorIndex];
  
  const tools = getOwnedCookingTools();
  
  const toolSection = document.createElement("div");
  toolSection.className = "cooking-section";
  const toolTitle = document.createElement("h4");
  toolTitle.className = "cooking-section-title";
  toolTitle.textContent = "料理道具を選ぶ";
  toolSection.appendChild(toolTitle);
  
  const toolListEl = document.createElement("div");
  toolListEl.className = "cooking-tool-list";
  if (tools.length === 0) {
    const note = document.createElement("p");
    note.className = "cooking-empty-note";
    note.textContent = "料理道具を持っていないようだ。鍋やフライパンなどを手に入れよう。";
    toolListEl.appendChild(note);
  } else {
    tools.forEach(({ slot, master }, toolIndex) => {
      // ★要望対応：divのクリックだけだとキーボード操作できないので、実際の<button>にしてTab移動・Enter決定に対応させる
      const card = document.createElement("button");
      card.type = "button";
      const isCursorHere = currentFocus && currentFocus.type === "tool" && currentFocus.index === toolIndex;
      card.className = "cooking-tool-card" + (slot.instanceId === cookingSelectedToolInstanceId ? " selected" : "") + (isCursorHere ? " cooking-cursor" : "");
      const nameEl = document.createElement("span");
      nameEl.className = "cooking-tool-name";
      nameEl.textContent = `${master.name}（スロット${Math.max(1, Number(master.toolSlotCount) || 3)}）`;
      const maxDurability = Math.max(1, Number(master.toolDurability) || 30);
      const durEl = document.createElement("span");
      durEl.className = "cooking-tool-durability";
      durEl.textContent = `耐久 ${slot.durability != null ? slot.durability : maxDurability} / ${maxDurability}`;
      card.appendChild(nameEl);
      card.appendChild(durEl);
      card.onclick = () => { selectCookingTool(slot.instanceId); cookingCursorIndex = 0; };
      toolListEl.appendChild(card);
    });
  }
  toolSection.appendChild(toolListEl);
  root.appendChild(toolSection);
  
  const tool = getSelectedCookingTool();
  if (!tool) return;
  
  const materialOptions = getCookableMaterialOptions();
  const materialSection = document.createElement("div");
  materialSection.className = "cooking-section";
  const materialTitle = document.createElement("h4");
  materialTitle.className = "cooking-section-title";
  materialTitle.textContent = "材料を置く（←→キーでも材料・個数を変えられます）";
  materialSection.appendChild(materialTitle);
  
  const slotListEl = document.createElement("div");
  slotListEl.className = "cooking-slot-list";
  
  cookingSlotPicks.forEach((pick, slotIndex) => {
    const row = document.createElement("div");
    const isCursorHere = currentFocus && currentFocus.type === "slot" && currentFocus.index === slotIndex;
    const isEditingCount = cookingSlotCountEditIndex === slotIndex;
    row.className = "cooking-slot-row" + (isCursorHere ? " cooking-cursor" : "") + (isEditingCount ? " cooking-slot-row-editing" : "");
    
    const label = document.createElement("span");
    label.className = "cooking-slot-label";
    label.textContent = `材料${slotIndex + 1}`;
    row.appendChild(label);
    
    const select = document.createElement("select");
    const emptyOpt = document.createElement("option");
    emptyOpt.value = "";
    emptyOpt.textContent = "（材料を選ぶ）";
    select.appendChild(emptyOpt);
    materialOptions.forEach(opt => {
      const optionEl = document.createElement("option");
      optionEl.value = opt.itemId;
      optionEl.textContent = `${opt.name}（所持${opt.count}）`;
      select.appendChild(optionEl);
    });
    select.value = pick.itemId || "";
    select.onchange = () => {
      cookingSlotPicks[slotIndex] = { itemId: select.value, count: pick.count || 1 };
      renderCookingTab();
    };
    row.appendChild(select);
    
    const countInput = document.createElement("input");
    countInput.type = "number";
    countInput.min = "1";
    countInput.value = pick.count || 1;
    countInput.disabled = !pick.itemId;
    countInput.onchange = () => {
      const value = Math.max(1, Math.floor(Number(countInput.value) || 1));
      cookingSlotPicks[slotIndex] = { itemId: pick.itemId, count: value };
    };
    row.appendChild(countInput);
    
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "cooking-slot-clear-btn";
    clearBtn.textContent = "✕";
    clearBtn.title = "この材料枠を空にする";
    clearBtn.disabled = !pick.itemId;
    clearBtn.onclick = () => {
      cookingSlotPicks[slotIndex] = { itemId: "", count: 1 };
      renderCookingTab();
    };
    row.appendChild(clearBtn);
    
    if (isEditingCount) {
      const hint = document.createElement("span");
      hint.className = "cooking-slot-label";
      hint.textContent = "個数調整中（←→、Zで確定）";
      row.appendChild(hint);
    }
    
    slotListEl.appendChild(row);
  });
  materialSection.appendChild(slotListEl);
  
  const batchRow = document.createElement("div");
  const isBatchCursorHere = currentFocus && currentFocus.type === "batch";
  batchRow.className = "cooking-batch-row" + (isBatchCursorHere ? " cooking-cursor" : "");
  const batchLabel = document.createElement("span");
  batchLabel.textContent = "作る個数：";
  const batchInput = document.createElement("input");
  batchInput.type = "number";
  batchInput.min = "1";
  batchInput.value = cookingBatchCount;
  batchInput.onchange = () => { cookingBatchCount = Math.max(1, Math.floor(Number(batchInput.value) || 1)); };
  batchRow.appendChild(batchLabel);
  batchRow.appendChild(batchInput);
  materialSection.appendChild(batchRow);
  
  const hasAnyFilledSlot = cookingSlotPicks.some(p => p.itemId && p.count > 0);
  const isCookCursorHere = currentFocus && currentFocus.type === "cook";
  const cookBtn = document.createElement("button");
  cookBtn.className = "cooking-cook-btn" + (isCookCursorHere ? " cooking-cursor" : "");
  cookBtn.textContent = "作る";
  cookBtn.disabled = !hasAnyFilledSlot;
  cookBtn.onclick = () => attemptCook();
  materialSection.appendChild(cookBtn);
  root.appendChild(materialSection);
  
  // ★レシピ帳：この道具向けの、既に発見済みのレシピだけを一覧表示する
  const knownIds = (typeof player !== "undefined" && player && Array.isArray(player.knownCookingRecipeIds)) ? player.knownCookingRecipeIds : [];
  const toolRecipes = (scenarioProject.recipes || []).filter(r => r.shopType === "cooking" && r.toolItemId === tool.slot.itemId);
  const knownRecipes = toolRecipes.filter(r => knownIds.includes(r.id));
  const unknownCount = toolRecipes.length - knownRecipes.length;
  
  const bookSection = document.createElement("div");
  bookSection.className = "cooking-section";
  const bookTitle = document.createElement("h4");
  bookTitle.className = "cooking-section-title";
  bookTitle.textContent = "レシピ帳";
  bookSection.appendChild(bookTitle);
  
  const bookEl = document.createElement("div");
  bookEl.className = "cooking-recipe-book";
  if (knownRecipes.length === 0) {
    const note = document.createElement("p");
    note.className = "cooking-empty-note";
    note.textContent = "この道具で作れる、判明しているレシピはまだ無いようだ。";
    bookEl.appendChild(note);
  } else {
    knownRecipes.forEach(recipe => {
      const card = document.createElement("div");
      card.className = "cooking-recipe-card";
      const materialsText = (recipe.materials || []).map(mat => `${ITEM_MASTER[mat.itemId] ? ITEM_MASTER[mat.itemId].name : mat.itemId}×${mat.count}`).join("、");
      const resultMaster = ITEM_MASTER[recipe.resultItemId];
      card.textContent = `${recipe.name || "名称未設定"}：${materialsText} → ${resultMaster ? resultMaster.name : recipe.resultItemId}`;
      bookEl.appendChild(card);
    });
  }
  if (unknownCount > 0) {
    const note = document.createElement("p");
    note.className = "cooking-empty-note";
    note.textContent = `この道具にはまだ発見していないレシピが${unknownCount}件ある。材料さえ合っていれば、知らなくても作れる。`;
    bookEl.appendChild(note);
  }
  bookSection.appendChild(bookEl);
  root.appendChild(bookSection);
}
