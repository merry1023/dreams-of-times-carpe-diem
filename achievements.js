// achievements.js
// 実績システム。シナリオエディタの「実績管理」タブ（scenarioProject.achievements）で作った実績を
// 判定・報酬付与し、便利タブの「実績」アイコンから一覧・詳細を見られるようにする。

// ===== 判定 =====

// ★特定の実績の条件を満たしているか判定する（未達成のものだけ呼ばれる想定）
function isAchievementConditionMet(achievement) {
  if (!player || !achievement) return false;
  const need = Number(achievement.conditionValue) || 0;
  switch (achievement.conditionType) {
    case "classLevel": {
      // ★職業指定なしなら「今の職業」のレベル、指定ありならその職業の記録済みレベル（player.classLevels）
      if (achievement.classId) {
        const recorded = (player.classLevels && player.classLevels[achievement.classId]) || 0;
        const current = (player.class === achievement.classId) ? player.level : 0;
        return Math.max(recorded, current) >= need;
      }
      return player.level >= need;
    }
    case "chaptersCleared": {
      const chapters = (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.chapters))
        ? scenarioProject.chapters.filter(c => c.enabled !== false) : [];
      return chapters.filter(c => c.cleared).length >= need;
    }
    case "classUnlocked":
      return !!(achievement.classId && player.classLevels && (achievement.classId in player.classLevels));
    case "totalDamageDealt":
      return (player.totalDamageDealt || 0) >= need;
    case "totalHealingDone":
      return (player.totalHealingDone || 0) >= need;
    case "totalDamageTaken":
      return (player.totalDamageTaken || 0) >= need;
    case "enemyKillsSpecific":
      return ((player.enemyKillCounts && player.enemyKillCounts[achievement.monsterKey]) || 0) >= need;
    case "enemyKillsAllTypes": {
      // ★マップ設定タブに登録されている「敵（ボスは除く）」を、それぞれ指定数以上倒しているか
      const monsterKeys = (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.enemies))
        ? scenarioProject.enemies.map(e => e.id) : [];
      if (monsterKeys.length === 0) return false;
      return monsterKeys.every(key => ((player.enemyKillCounts && player.enemyKillCounts[key]) || 0) >= need);
    }
    case "totalKillCount":
      return (player.totalKillCount || 0) >= need;
    case "areaUnlocked": {
      const area = (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.mapAreas))
        ? scenarioProject.mapAreas.find(a => a.id === achievement.areaId) : null;
      return !!(area && typeof evaluateMapAreaUnlockConditions === "function" && evaluateMapAreaUnlockConditions(area));
    }
    case "flag":
      return !!(typeof scenarioFlags !== "undefined" && achievement.flagName && scenarioFlags[achievement.flagName]);
    case "variable":
      return (typeof getScenarioVariable === "function" ? getScenarioVariable(achievement.varName) : 0) >= need;
    default:
      return false;
  }
}

// ★実績の達成チェック本体。まだ未達成のものだけ判定し、新規に達成したら報酬を付与して通知する。
//   戦闘勝利後・話クリア後・レベルアップ後・マップ表示時など、進行に関わるタイミングで随時呼ぶ想定
async function checkAchievements() {
  if (!player) return;
  if (!Array.isArray(player.unlockedAchievementIds)) player.unlockedAchievementIds = [];
  const achievements = (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.achievements))
    ? scenarioProject.achievements : [];
  for (const achievement of achievements) {
    if (!achievement.id || player.unlockedAchievementIds.includes(achievement.id)) continue;
    if (!isAchievementConditionMet(achievement)) continue;
    player.unlockedAchievementIds.push(achievement.id);
    grantAchievementReward(achievement);
  }
}

// ★実績の報酬（経験値・お金・アイテム）を付与し、達成トーストを表示する
function grantAchievementReward(achievement) {
  const rewardLines = [];
  const exp = Number(achievement.rewardExp) || 0;
  if (exp > 0 && typeof addExp === "function") {
    addExp(exp);
    rewardLines.push(`経験値+${exp}`);
  }
  const gold = Number(achievement.rewardGold) || 0;
  if (gold > 0 && typeof changeGold === "function") {
    changeGold(gold);
    rewardLines.push(`お金+${gold}`);
  }
  if (achievement.rewardItemId) {
    const qty = Number(achievement.rewardItemQty) || 1;
    if (typeof addItem === "function") addItem(achievement.rewardItemId, qty);
    const master = (typeof ITEM_MASTER !== "undefined") ? ITEM_MASTER[achievement.rewardItemId] : null;
    rewardLines.push(`${(master && master.name) || achievement.rewardItemId}×${qty}`);
  }
  if (typeof renderStatusHUD === "function") renderStatusHUD();
  showAchievementToast(achievement, rewardLines);
}

// ===== 達成トースト通知（画面上部に数秒だけ出る簡易表示） =====
function showAchievementToast(achievement, rewardLines) {
  const toast = document.createElement("div");
  toast.className = "achievement-toast";
  
  const titleEl = document.createElement("div");
  titleEl.className = "achievement-toast-title";
  titleEl.textContent = "🏆 実績達成！";
  toast.appendChild(titleEl);
  
  const nameEl = document.createElement("div");
  nameEl.className = "achievement-toast-name";
  nameEl.textContent = achievement.name || "（名称未設定）";
  toast.appendChild(nameEl);
  
  if (rewardLines && rewardLines.length > 0) {
    const rewardEl = document.createElement("div");
    rewardEl.className = "achievement-toast-reward";
    rewardEl.textContent = rewardLines.join("　");
    toast.appendChild(rewardEl);
  }
  
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 500);
  }, 3500);
}

// ===== 便利タブ「実績」パネル（進行度パネルと同じ構成：サマリー＋一覧＋詳細） =====

let achievementsCursorIndex = 0;
let achievementsDetailOpen = false;

function getAchievementList() {
  return (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.achievements)) ? scenarioProject.achievements : [];
}

function isAchievementUnlocked(achievement) {
  return !!(player && Array.isArray(player.unlockedAchievementIds) && player.unlockedAchievementIds.includes(achievement.id));
}

// ★要望対応：「隠し実績」（hidden: true）は、達成するまで一覧に存在ごと出さない（？？？すら出さない）。
//   hidden: falseの実績は、達成するまで一覧には出すが、名前・説明を「？？？」にする。
function isAchievementVisible(achievement) {
  return isAchievementUnlocked(achievement) || !achievement.hidden;
}

function openAchievementsPanel() {
  const grid = document.getElementById("convenience-icon-grid");
  const saveloadPanel = document.getElementById("saveload-panel");
  const codexPanel = document.getElementById("monster-codex-panel");
  const creditsPanel = document.getElementById("credits-panel");
  const tutorialPanel = document.getElementById("tutorial-panel");
  const progressPanel = document.getElementById("progress-panel");
  if (grid) grid.classList.add("hidden");
  if (saveloadPanel) saveloadPanel.classList.add("hidden"); // ★念のため、他のパネルは必ず隠しておく
  if (codexPanel) codexPanel.classList.add("hidden");
  if (creditsPanel) creditsPanel.classList.add("hidden");
  if (tutorialPanel) tutorialPanel.classList.add("hidden");
  if (progressPanel) progressPanel.classList.add("hidden");
  achievementsCursorIndex = 0;
  achievementsDetailOpen = false;
  renderAchievementsPanel();
  window.removeEventListener("keydown", handleAchievementsKeyDown); // 二重登録防止
  window.addEventListener("keydown", handleAchievementsKeyDown);
}

function closeAchievementsPanel() {
  window.removeEventListener("keydown", handleAchievementsKeyDown);
  renderConvenienceIcons();
}

function renderAchievementsSummary(container) {
  container.innerHTML = "";
  container.className = "progress-panel-summary";
  // ★hidden（隠し実績）で未達成のものは、一覧に存在ごと出さないので、分母にも数えない
  const visibleList = getAchievementList().filter(isAchievementVisible);
  const unlockedCount = visibleList.filter(a => isAchievementUnlocked(a)).length;
  container.appendChild(buildProgressRow("達成済み", `${unlockedCount} ／ ${visibleList.length}`));
}

function renderAchievementsList(container) {
  container.innerHTML = "";
  container.className = "progress-panel-list progress-panel-chapter-list";
  
  // ★hidden（隠し実績）で未達成のものは一覧から除外する（？？？すら出さない）
  const list = getAchievementList().filter(isAchievementVisible);
  if (achievementsCursorIndex >= list.length) achievementsCursorIndex = Math.max(0, list.length - 1);
  
  if (list.length === 0) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "devmode-note";
    emptyEl.textContent = "まだ実績が登録されていません。";
    container.appendChild(emptyEl);
    return;
  }
  
  list.forEach((achievement, index) => {
    const unlocked = isAchievementUnlocked(achievement);
    const row = document.createElement("div");
    row.className = "progress-panel-chapter-row" + (index === achievementsCursorIndex ? " cursor" : "");
    
    const statusEl = document.createElement("span");
    statusEl.className = "progress-panel-chapter-status";
    statusEl.textContent = unlocked ? "🏆" : "🔒";
    row.appendChild(statusEl);
    
    const titleEl = document.createElement("span");
    titleEl.className = "progress-panel-chapter-title";
    // ★未達成のものは、hiddenがfalseでも（一覧に出す代わりに）名前を「？？？」にする
    titleEl.textContent = unlocked ? (achievement.name || "（名称未設定）") : "？？？";
    row.appendChild(titleEl);
    
    row.onclick = (event) => {
      event.stopPropagation();
      achievementsCursorIndex = index;
      achievementsDetailOpen = true;
      renderAchievementsPanel();
    };
    
    container.appendChild(row);
    if (index === achievementsCursorIndex) row.scrollIntoView({ block: "nearest" });
  });
}

function buildAchievementRewardLines(achievement) {
  const rewardLines = [];
  if (Number(achievement.rewardExp) > 0) rewardLines.push(`経験値+${achievement.rewardExp}`);
  if (Number(achievement.rewardGold) > 0) rewardLines.push(`お金+${achievement.rewardGold}`);
  if (achievement.rewardItemId) {
    const master = (typeof ITEM_MASTER !== "undefined") ? ITEM_MASTER[achievement.rewardItemId] : null;
    rewardLines.push(`${(master && master.name) || achievement.rewardItemId}×${achievement.rewardItemQty || 1}`);
  }
  return rewardLines;
}

function renderAchievementDetail(panel) {
  panel.innerHTML = "";
  // ★一覧側の表示（hidden実績は非表示、それ以外は未達成なら？？？）とインデックスを合わせる
  const list = getAchievementList().filter(isAchievementVisible);
  const achievement = list[achievementsCursorIndex];
  if (!achievement) { achievementsDetailOpen = false; renderAchievementsPanel(); return; }
  const unlocked = isAchievementUnlocked(achievement);
  // ★未達成の間は、hiddenがfalseでも（一覧同様）？？？のままにする
  const canReveal = unlocked;
  
  const title = document.createElement("h3");
  title.className = "monster-codex-title";
  title.textContent = canReveal ? (achievement.name || "（名称未設定）") : "？？？";
  panel.appendChild(title);
  
  const statusEl = document.createElement("p");
  statusEl.className = "progress-panel-row-value";
  statusEl.textContent = unlocked ? "達成済み" : "未達成";
  panel.appendChild(statusEl);
  
  const descText = document.createElement("p");
  descText.className = "progress-panel-synopsis-entry-text progress-panel-detail-text";
  descText.textContent = canReveal ? (achievement.description || "（説明は未設定です）") : "（達成すると詳しい内容が分かります）";
  panel.appendChild(descText);
  
  const rewardLines = buildAchievementRewardLines(achievement);
  if (rewardLines.length > 0 && canReveal) {
    const rewardText = document.createElement("p");
    rewardText.className = "progress-panel-row-value";
    rewardText.textContent = `報酬：${rewardLines.join("　")}`;
    panel.appendChild(rewardText);
  }
  
  const backBtn = document.createElement("button");
  backBtn.className = "monster-codex-back-btn";
  backBtn.textContent = "◀ 実績一覧へ戻る";
  backBtn.onclick = (event) => { event.stopPropagation(); achievementsDetailOpen = false; renderAchievementsPanel(); };
  panel.appendChild(backBtn);
}

function renderAchievementsPanel() {
  const panel = document.getElementById("achievements-panel");
  if (!panel || !player) return;
  panel.classList.remove("hidden");
  panel.innerHTML = "";
  
  if (achievementsDetailOpen) {
    renderAchievementDetail(panel);
    return;
  }
  
  const title = document.createElement("h3");
  title.className = "monster-codex-title";
  title.textContent = "実績";
  panel.appendChild(title);
  
  const summaryEl = document.createElement("div");
  renderAchievementsSummary(summaryEl);
  panel.appendChild(summaryEl);
  
  const listEl = document.createElement("div");
  renderAchievementsList(listEl);
  panel.appendChild(listEl);
  
  const backBtn = document.createElement("button");
  backBtn.className = "monster-codex-back-btn";
  backBtn.textContent = "◀ 戻る";
  backBtn.onclick = (event) => { event.stopPropagation(); closeAchievementsPanel(); };
  panel.appendChild(backBtn);
}

function handleAchievementsKeyDown(event) {
  if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★シナリオエディタ表示中は本編を操作させない
  if (controlFocus !== "sub") return;
  if (isGameDialogOpen) return;
  const activeTab = document.querySelector('.tab-content.active');
  if (!activeTab || activeTab.id !== 'tab-convenience') return;
  
  if (achievementsDetailOpen) {
    if (KEY_CONFIG.decideKeys.includes(event.key) || KEY_CONFIG.cancelKeys.includes(event.key)) {
      event.preventDefault();
      achievementsDetailOpen = false;
      renderAchievementsPanel();
    }
    return;
  }
  
  if (KEY_CONFIG.cancelKeys.includes(event.key)) {
    event.preventDefault();
    closeAchievementsPanel();
    return;
  }
  
  // ★一覧側の表示（hidden実績は非表示）とカーソルの範囲を合わせる
  const list = getAchievementList().filter(isAchievementVisible);
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (list.length === 0) return;
    achievementsCursorIndex = Math.min(list.length - 1, achievementsCursorIndex + 1);
    renderAchievementsList(document.querySelector("#achievements-panel .progress-panel-chapter-list"));
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    if (list.length === 0) return;
    achievementsCursorIndex = Math.max(0, achievementsCursorIndex - 1);
    renderAchievementsList(document.querySelector("#achievements-panel .progress-panel-chapter-list"));
  } else if (KEY_CONFIG.decideKeys.includes(event.key)) {
    event.preventDefault();
    if (list.length === 0) return;
    achievementsDetailOpen = true;
    renderAchievementsPanel();
  }
}
