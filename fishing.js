// fishing.js
// ===================================================================
// ===== 釣り場（要望対応：釣り施設・釣竿/釣り餌・釣りミニゲーム） =====
// ===================================================================
// ★施設編集タブで作れる「釣り場」タイプの施設（facility.type === "fishing"）の中身。
//   openCustomFacility（town.js）から openFishingFacility() が呼ばれる。
// ★釣竿・釣り餌は、アイテム設定タブで（釣竿）（釣り餌）にチェックを入れた普通のアイテム
//   （isFishingRod / isFishingBait、items.js・scenariobuild.js参照）。
// ★魚は「魚管理」タブで登録したもので、内部的には category:"fish" のアイテムとして
//   ITEM_MASTER に反映されている（ensureCustomFishRegistered、scenariobuild.js）。

let fishingFacility = null; // 今開いている釣り場施設のデータ
let fishingReturnTo = null; // 「戻る」で呼ぶ関数

// ★セーブデータが古く player.fishing が無い場合のための保険
function ensurePlayerFishingState() {
  if (!player.fishing || typeof player.fishing !== "object") {
    player.fishing = { rodItemId: null, baitItemId: null };
  }
  return player.fishing;
}

// 釣り場の入り口。openCustomFacility（town.js）から呼ばれる
function openFishingFacility(facility, returnTo) {
  fishingFacility = facility;
  fishingReturnTo = typeof returnTo === "function" ? returnTo : openTownMenu;
  ensurePlayerFishingState();
  showFishingMenu();
}

function showFishingMenu() {
  const state = ensurePlayerFishingState();
  const rodMaster = state.rodItemId ? ITEM_MASTER[state.rodItemId] : null;
  const baitMaster = state.baitItemId ? ITEM_MASTER[state.baitItemId] : null;
  const baitCount = state.baitItemId ? getTotalItemCount(state.baitItemId) : 0; // questboard.js
  
  const rodLabel = rodMaster ? `釣竿：${rodMaster.name}` : "釣竿：未装備";
  const baitLabel = baitMaster ? `釣り餌：${baitMaster.name}（残り${baitCount}個）` : "釣り餌：未装備";
  
  showLocationMenu([
    { label: `釣る（${rodLabel} / ${baitLabel}）`, action: () => startFishing() },
    { label: "釣竿を変える", action: () => chooseFishingRod() },
    { label: "釣り餌を変える", action: () => chooseFishingBait() },
    { label: "戻る", action: () => fishingReturnTo() }
  ], fishingFacility.name || "釣り場");
}

// ===== 釣竿・釣り餌の選択 =====

// ★インベントリの中から、isFishingRod / isFishingBait が立っているアイテムIDをユニークに集める
function collectOwnedFishingGear(flagKey) {
  const seen = new Set();
  const result = [];
  inventorySlots.forEach(slot => {
    if (!slot) return;
    const master = ITEM_MASTER[slot.itemId];
    if (!master || !master[flagKey]) return;
    if (seen.has(slot.itemId)) return;
    seen.add(slot.itemId);
    result.push(slot.itemId);
  });
  return result;
}

async function chooseFishingRod() {
  hideLocationMenu(); // ★バグ修正：行き先メニュー表示中はメッセージウィンドウが隠れており、そのままdisplayMessageを呼んでも何も表示されなかった
  const state = ensurePlayerFishingState();
  const rodIds = collectOwnedFishingGear("isFishingRod");
  if (rodIds.length === 0) {
    changeSpeaker("");
    await displayMessage("……釣竿を持っていないようだ。まずは道具屋などで手に入れよう。");
    showFishingMenu();
    return;
  }
  
  const choices = rodIds.map(id => {
    const master = ITEM_MASTER[id];
    const tag = state.rodItemId === id ? "（装備中）" : "";
    return { text: `${master.name}（耐久${master.rodDurability || 0}／攻撃${master.rodPower || 0}）${tag}`, next: id };
  });
  choices.push({ text: "やめる", next: "cancel", isBack: true });
  
  changeSpeaker("");
  await displayMessage("どの釣竿を使う？");
  const picked = await displayChoices(choices);
  if (picked.next !== "cancel") {
    state.rodItemId = picked.next;
    await displayMessage(`「${ITEM_MASTER[picked.next].name}」を釣竿にセットした。`);
  }
  showFishingMenu();
}

async function chooseFishingBait() {
  hideLocationMenu(); // ★バグ修正：同上
  const state = ensurePlayerFishingState();
  const baitIds = collectOwnedFishingGear("isFishingBait");
  if (baitIds.length === 0) {
    changeSpeaker("");
    await displayMessage("……釣り餌を持っていないようだ。まずは道具屋などで手に入れよう。");
    showFishingMenu();
    return;
  }
  
  const choices = baitIds.map(id => {
    const master = ITEM_MASTER[id];
    const count = getTotalItemCount(id); // questboard.js
    const tag = state.baitItemId === id ? "（セット中）" : "";
    return { text: `${master.name}（残り${count}個／食いつき度${master.baitBiteRate || 0}）${tag}`, next: id };
  });
  choices.push({ text: "やめる", next: "cancel", isBack: true });
  
  changeSpeaker("");
  await displayMessage("どの餌をセットする？");
  const picked = await displayChoices(choices);
  if (picked.next !== "cancel") {
    state.baitItemId = picked.next;
    await displayMessage(`「${ITEM_MASTER[picked.next].name}」を餌にセットした。`);
  }
  showFishingMenu();
}

// ===== 時間帯・天候の判定 =====

// player.gameHour（0〜24の小数、player.js）から時間帯の区分を出す
function getCurrentFishingTimeOfDay() {
  const hour = (player && typeof player.gameHour === "number") ? player.gameHour : 8;
  if (hour >= 5 && hour < 10) return "morning";
  if (hour >= 10 && hour < 16) return "day";
  if (hour >= 16 && hour < 19) return "evening";
  return "night";
}

// currentWeatherType（mainfunc.js）から天候キーを出す。null（演出無し）は"clear"扱い
function getCurrentFishingWeather() {
  if (typeof currentWeatherType === "undefined" || !currentWeatherType) return "clear";
  return currentWeatherType;
}

// ★餌の「釣れる魚の種類」を配列で取得する。
//   baitFishTypes（新・複数選択形式）が無ければbaitFishType（旧・単一文字列）から互換を取る
function getBaitFishTypes(baitMaster) {
  if (!baitMaster) return [];
  if (Array.isArray(baitMaster.baitFishTypes)) return baitMaster.baitFishTypes.filter(Boolean);
  if (baitMaster.baitFishType) return [baitMaster.baitFishType]; // ★旧データ互換
  return [];
}

// ★施設のfishingSpotsのうち、今の時間帯・天候・セットしている餌の「釣れる魚の種類」に合う魚の候補を絞り込む
function getMatchingFishSpots(facility, baitMaster) {
  const timeOfDay = getCurrentFishingTimeOfDay();
  const weather = getCurrentFishingWeather();
  const spots = Array.isArray(facility.fishingSpots) ? facility.fishingSpots : [];
  // ★バグ修正：以前は餌の「釣れる魚の種類」がフリーテキストの単一文字列で、魚側の「種類」と
  //   1文字でも表記が違う（全角半角・スペース・打ち間違いなど）と一致せず、魚を登録していても
  //   「今はこの餌に反応する魚がいないようだ……」になってしまっていた。
  //   → 魚管理タブに登録済みの「種類」一覧から選ぶ複数選択リストに変更し、表記ゆれで不一致になる余地を無くした
  const baitTypes = getBaitFishTypes(baitMaster);
  return spots.filter(spot => {
    if (!spot.fishId || !ITEM_MASTER[spot.fishId]) return false;
    if (spot.timeOfDay && spot.timeOfDay !== "any" && spot.timeOfDay !== timeOfDay) return false;
    if (spot.weather && spot.weather !== "any" && spot.weather !== weather) return false;
    // ★餌に「釣れる魚の種類」が1つ以上選ばれていれば、そのいずれかに一致する魚だけに絞る（未選択の餌ならどの魚にも使える）
    if (baitTypes.length > 0) {
      const fishMaster = ITEM_MASTER[spot.fishId];
      if (!baitTypes.includes(fishMaster.fishType || "")) return false;
    }
    return true;
  });
}

// ★重み付き抽選で1件選ぶ
function pickWeightedFishSpot(spots) {
  const totalWeight = spots.reduce((sum, s) => sum + Math.max(1, Number(s.weight) || 1), 0);
  let roll = Math.random() * totalWeight;
  for (const spot of spots) {
    roll -= Math.max(1, Number(spot.weight) || 1);
    if (roll <= 0) return spot;
  }
  return spots[spots.length - 1];
}

// ===== 釣る（糸を垂らす〜食いつき〜ミニゲーム） =====

async function startFishing() {
  hideLocationMenu(); // ★バグ修正：これが無かったため「釣る」を押しても行き先メニューが表示されたままメッセージウィンドウが隠れており、何も表示されないように見えていた
  const state = ensurePlayerFishingState();
  const rodMaster = state.rodItemId ? ITEM_MASTER[state.rodItemId] : null;
  const baitMaster = state.baitItemId ? ITEM_MASTER[state.baitItemId] : null;
  
  changeSpeaker("");
  if (!rodMaster) {
    await displayMessage("釣竿を持っていない……まずは「釣竿を変える」から装備しよう。");
    showFishingMenu();
    return;
  }
  
  // ★要望対応：セットしている餌が0の状態で釣り糸を垂らしたら何も食いつかない
  const baitCount = state.baitItemId ? getTotalItemCount(state.baitItemId) : 0;
  if (!baitMaster || baitCount <= 0) {
    await displayMessage("糸を垂らしてみたが……餌が無いせいか、何も食いつかなかった。");
    showFishingMenu();
    return;
  }
  
  const candidates = getMatchingFishSpots(fishingFacility, baitMaster);
  if (candidates.length === 0) {
    await displayMessage("糸を垂らしてみたが、今はこの餌に反応する魚がいないようだ……");
    showFishingMenu();
    return;
  }
  
  await displayMessage("そっと糸を垂らした……");
  
  // ★食いつき度が高いほど短い間隔で食いつく（目安1〜10。3000〜300ms程度の範囲に変換）
  const biteRate = Math.max(1, Math.min(10, Number(baitMaster.baitBiteRate) || 5));
  const waitMs = Math.max(300, 3300 - biteRate * 300) + Math.random() * 600;
  await new Promise(resolve => setTimeout(resolve, waitMs));
  
  const spot = pickWeightedFishSpot(candidates);
  const fishMaster = ITEM_MASTER[spot.fishId];
  
  // ★食いついた時点で餌を1つ消費する（要望対応）
  removeItem(state.baitItemId, 1); // inventory.js
  renderStatusHUD();
  
  await displayMessage(`グッ……！ 「${fishMaster.name}」が食いついた！`);
  
  const result = await runFishingMinigame(fishMaster, rodMaster, spot.fishId);
  
  changeSpeaker("");
  if (result.win) {
    const added = addItem(spot.fishId, 1); // inventory.js
    renderStatusHUD();
    if (added) {
      await displayMessage(`やった！ 「${fishMaster.name}」を釣り上げた！`);
    } else {
      await displayMessage(`「${fishMaster.name}」を釣り上げたが、持ち物がいっぱいで受け取れなかった……`);
    }
  } else {
    await displayMessage(`くっ……！ 糸を持ちこたえられず、「${fishMaster.name}」に逃げられてしまった……`);
  }
  
  showFishingMenu();
}

// ===== 釣りミニゲーム本体 =====
// ★横長のゲージ上で、魚が左右どちらかに引っ張ってくる。プレイヤーは魚と逆方向のキー/ボタンで
//   引っ張り返す必要がある。1秒ごとに：
//   ・逆方向に正しく引けていれば：釣竿の攻撃力ぶん魚の体力を削り、魚の攻撃力ぶん釣竿の耐久度が減る
//   ・逆方向に引けていなければ（同方向 or 無操作）：耐久度の減りが1.5倍になり、魚の体力は削れない
//   先に相手の耐久度／体力を0にした方が勝ち
function runFishingMinigame(fishMaster, rodMaster, fishId) {
  return new Promise(resolve => {
    const fishMaxHp = Math.max(1, Number(fishMaster.fishHp) || 15);
    const fishPower = Math.max(1, Number(fishMaster.fishPower) || 3);
    const rodMaxDurability = Math.max(1, Number(rodMaster.rodDurability) || 20);
    const rodPower = Math.max(1, Number(rodMaster.rodPower) || 3);
    
    let fishHp = fishMaxHp;
    let rodDurability = rodMaxDurability;
    let fishDirection = Math.random() < 0.5 ? "left" : "right";
    let finished = false;
    
    // ★現在押されている／触れられている方向（左右同時押しなら最後に押した方を優先）
    const heldDirections = new Set();
    let lastPressedDirection = null;
    
    // ----- オーバーレイDOMの構築 -----
    const overlay = document.createElement("div");
    overlay.id = "fishing-minigame-overlay";
    overlay.className = "fishing-minigame-overlay";
    overlay.innerHTML = `
      <div class="fishing-minigame-panel">
        <h3 class="fishing-minigame-title">${fishMaster.name} と格闘中！</h3>
        <div class="fishing-direction-row">
          <span class="fishing-direction-arrow fishing-direction-left">◀</span>
          <span class="fishing-direction-label">魚が引いている方向と<b>逆</b>を押し続けろ！</span>
          <span class="fishing-direction-arrow fishing-direction-right">▶</span>
        </div>
        <div class="fishing-gauge">
          <div class="fishing-gauge-fish-indicator"></div>
        </div>
        <div class="fishing-status-row">
          <div class="fishing-status-block">
            <span class="fishing-status-label">魚の体力</span>
            <div class="fishing-status-bar"><div class="fishing-status-bar-fill fishing-fish-hp-fill"></div></div>
          </div>
          <div class="fishing-status-block">
            <span class="fishing-status-label">釣竿の耐久度</span>
            <div class="fishing-status-bar"><div class="fishing-status-bar-fill fishing-rod-durability-fill"></div></div>
          </div>
        </div>
        <div class="fishing-control-row">
          <button type="button" class="devmode-btn fishing-control-btn" id="fishing-btn-left">◀ 引く（←キー）</button>
          <button type="button" class="devmode-btn fishing-control-btn" id="fishing-btn-right">引く（→キー） ▶</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    
    const fishIndicatorEl = overlay.querySelector(".fishing-gauge-fish-indicator");
    const fishHpFillEl = overlay.querySelector(".fishing-fish-hp-fill");
    const rodDurabilityFillEl = overlay.querySelector(".fishing-rod-durability-fill");
    const leftArrowEl = overlay.querySelector(".fishing-direction-left");
    const rightArrowEl = overlay.querySelector(".fishing-direction-right");
    const leftBtnEl = overlay.querySelector("#fishing-btn-left");
    const rightBtnEl = overlay.querySelector("#fishing-btn-right");
    
    function renderMinigameUI() {
      fishIndicatorEl.textContent = fishDirection === "left" ? "◀ ◀ ◀" : "▶ ▶ ▶";
      fishIndicatorEl.className = "fishing-gauge-fish-indicator " + (fishDirection === "left" ? "fishing-gauge-pull-left" : "fishing-gauge-pull-right");
      fishHpFillEl.style.width = `${Math.max(0, Math.round((fishHp / fishMaxHp) * 100))}%`;
      rodDurabilityFillEl.style.width = `${Math.max(0, Math.round((rodDurability / rodMaxDurability) * 100))}%`;
      const currentDir = getEffectivePlayerDirection();
      leftArrowEl.classList.toggle("fishing-direction-active", currentDir === "left");
      rightArrowEl.classList.toggle("fishing-direction-active", currentDir === "right");
    }
    
    function getEffectivePlayerDirection() {
      if (lastPressedDirection && heldDirections.has(lastPressedDirection)) return lastPressedDirection;
      if (heldDirections.size > 0) return [...heldDirections][0];
      return null;
    }
    
    function press(direction) {
      heldDirections.add(direction);
      lastPressedDirection = direction;
      renderMinigameUI();
    }
    function release(direction) {
      heldDirections.delete(direction);
      renderMinigameUI();
    }
    
    // ----- 入力：キーボード -----
    function handleKeyDown(e) {
      if (e.key === "ArrowLeft") { press("left"); e.preventDefault(); }
      else if (e.key === "ArrowRight") { press("right"); e.preventDefault(); }
    }
    function handleKeyUp(e) {
      if (e.key === "ArrowLeft") release("left");
      else if (e.key === "ArrowRight") release("right");
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    
    // ----- 入力：ボタン（マウス／タッチ両対応） -----
    function bindHoldButton(btnEl, direction) {
      const start = (e) => { e.preventDefault(); press(direction); };
      const end = (e) => { e.preventDefault(); release(direction); };
      btnEl.addEventListener("mousedown", start);
      btnEl.addEventListener("touchstart", start, { passive: false });
      btnEl.addEventListener("mouseup", end);
      btnEl.addEventListener("mouseleave", end);
      btnEl.addEventListener("touchend", end);
      btnEl.addEventListener("touchcancel", end);
    }
    bindHoldButton(leftBtnEl, "left");
    bindHoldButton(rightBtnEl, "right");
    
    // ----- 魚が引っ張る方向を、ランダムな間隔（1.5〜3.5秒）で切り替える -----
    let fishDirectionTimer = null;
    function scheduleFishDirectionChange() {
      const delay = 1500 + Math.random() * 2000;
      fishDirectionTimer = setTimeout(() => {
        if (finished) return;
        fishDirection = Math.random() < 0.5 ? "left" : "right";
        renderMinigameUI();
        scheduleFishDirectionChange();
      }, delay);
    }
    scheduleFishDirectionChange();
    
    // ----- 1秒ごとのダメージ判定ティック -----
    const tickInterval = setInterval(() => {
      if (finished) return;
      const opposite = fishDirection === "left" ? "right" : "left";
      const playerDirection = getEffectivePlayerDirection();
      
      if (playerDirection === opposite) {
        // ★正しく逆方向に引けている：魚の体力を削り、釣竿の耐久度も通常通り減る
        fishHp = Math.max(0, fishHp - rodPower);
        rodDurability = Math.max(0, rodDurability - fishPower);
      } else {
        // ★逆方向に引けていない（同方向 or 無操作）：耐久度の減りが1.5倍、魚へのダメージ無し
        rodDurability = Math.max(0, rodDurability - fishPower * 1.5);
      }
      
      renderMinigameUI();
      
      if (fishHp <= 0 || rodDurability <= 0) {
        finish(fishHp <= 0);
      }
    }, 1000);
    
    function finish(win) {
      if (finished) return;
      finished = true;
      clearInterval(tickInterval);
      if (fishDirectionTimer) clearTimeout(fishDirectionTimer);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      overlay.remove();
      resolve({ win, fishId });
    }
    
    renderMinigameUI();
  });
}
