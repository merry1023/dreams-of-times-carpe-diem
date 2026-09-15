// companionchat.js
// ★要望対応：仲間との会話（Gemini API連携）
//
// ・現在パーティーに参加している仲間（player.companions。一時離脱中のbenchedCompanionsは対象外）とだけ話せる
// ・会話の中身はサーバー側（worker/index.js）でGeminiに投げる。ここでは
//   　①パーティー一覧／チャット画面の描画　②送信するcontext（あらすじ・パーティ情報）の組み立て
//   　③ /api/companion-chat の呼び出し　だけを行う
// ・思考モデルの利用回数（1日10回・週40回）はサーバー側で管理されるが、直近の結果はここでも表示する

let companionChatActiveId = null; // ★今開いている会話相手のcompanionId（nullならパーティー一覧画面）
let companionChatSessions = {};   // ★{ [companionId]: { talkHistory:[{role,text}], cachedBriefing:string|null, lastQuota:{...}|null } }（ページを開いている間だけ保持。リロードで消える）
let companionChatSending = false; // ★二重送信防止

function renderCompanionChatTab() {
  companionChatActiveId = null; // ★タブを開き直したら、必ずパーティー一覧から
  renderCompanionChatRoot();
}

function renderCompanionChatRoot() {
  const root = document.getElementById("companionchat-root");
  if (!root) return;
  root.innerHTML = "";
  
  if (companionChatActiveId) {
    renderCompanionChatConversation(root, companionChatActiveId);
  } else {
    renderCompanionChatPicker(root);
  }
}

function renderCompanionChatPicker(container) {
  if (typeof currentUser === "undefined" || !currentUser) {
    const notice = document.createElement("div");
    notice.className = "companionchat-login-notice";
    const msg = document.createElement("p");
    msg.textContent = "仲間との会話は、Googleアカウントでログインしている人だけが使えます。";
    notice.appendChild(msg);
    const loginBtn = document.createElement("button");
    loginBtn.className = "devmode-btn";
    loginBtn.textContent = "Googleアカウントでログイン";
    loginBtn.onclick = () => { if (typeof signInWithGoogle === "function") signInWithGoogle(); }; // auth.js
    notice.appendChild(loginBtn);
    container.appendChild(notice);
    return;
  }
  
  if (!player || !player.companions || player.companions.length === 0) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "skill-empty";
    emptyEl.textContent = "今パーティーにいる仲間がいないようだ。";
    container.appendChild(emptyEl);
    return;
  }
  
  const listEl = document.createElement("div");
  listEl.className = "companionchat-picker-list";
  player.companions.forEach(companion => {
    const master = typeof getCompanionMaster === "function" ? getCompanionMaster(companion) : null; // player.js
    if (!companion.alive) return; // ★戦闘不能中の仲間とは話せない
    
    const card = document.createElement("button");
    card.className = "companionchat-companion-card";
    
    const nameEl = document.createElement("span");
    nameEl.className = "companionchat-companion-name";
    nameEl.textContent = master ? master.name : companion.companionId;
    card.appendChild(nameEl);
    
    const subEl = document.createElement("span");
    subEl.className = "companionchat-companion-sub";
    subEl.textContent = `${master ? master.class : "？"} Lv.${companion.level}`;
    card.appendChild(subEl);
    
    card.onclick = () => openCompanionChatSession(companion.companionId);
    listEl.appendChild(card);
  });
  container.appendChild(listEl);
}

function openCompanionChatSession(companionId) {
  if (!companionChatSessions[companionId]) {
    companionChatSessions[companionId] = { talkHistory: [], cachedBriefing: null, lastQuota: null };
  }
  companionChatActiveId = companionId;
  renderCompanionChatRoot();
}

function closeCompanionChatSession() {
  companionChatActiveId = null;
  renderCompanionChatRoot();
}

function renderCompanionChatConversation(container, companionId) {
  const master = typeof COMPANION_MASTER !== "undefined" ? COMPANION_MASTER[companionId] : null;
  const session = companionChatSessions[companionId];
  
  const header = document.createElement("div");
  header.className = "companionchat-header";
  const backBtn = document.createElement("button");
  backBtn.className = "companionchat-back-btn";
  backBtn.textContent = "＜ パーティー一覧";
  backBtn.onclick = closeCompanionChatSession;
  header.appendChild(backBtn);
  const nameEl = document.createElement("span");
  nameEl.className = "companionchat-header-name";
  nameEl.textContent = master ? master.name : companionId;
  header.appendChild(nameEl);
  container.appendChild(header);
  
  const messagesEl = document.createElement("div");
  messagesEl.className = "companionchat-messages";
  messagesEl.id = "companionchat-messages";
  if (session.talkHistory.length === 0) {
    const hintEl = document.createElement("p");
    hintEl.className = "companionchat-hint";
    hintEl.textContent = `${master ? master.name : "仲間"}に話しかけてみよう。`;
    messagesEl.appendChild(hintEl);
  }
  session.talkHistory.forEach(turn => {
    const bubble = document.createElement("div");
    bubble.className = "companionchat-bubble " + (turn.role === "model" ? "companionchat-bubble-model" : "companionchat-bubble-user");
    bubble.textContent = turn.text;
    messagesEl.appendChild(bubble);
  });
  container.appendChild(messagesEl);
  
  const quotaEl = document.createElement("p");
  quotaEl.className = "companionchat-quota-note";
  quotaEl.id = "companionchat-quota-note";
  quotaEl.textContent = buildQuotaNoteText(session.lastQuota);
  container.appendChild(quotaEl);
  
  const inputRow = document.createElement("div");
  inputRow.className = "companionchat-input-row";
  const textInput = document.createElement("input");
  textInput.type = "text";
  textInput.className = "companionchat-input";
  textInput.placeholder = "話しかける内容を入力…";
  textInput.maxLength = 500;
  textInput.id = "companionchat-input";
  textInput.onkeydown = (event) => {
    if (event.key === "Enter") { event.preventDefault(); handleCompanionChatSend(companionId); }
  };
  inputRow.appendChild(textInput);
  
  const sendBtn = document.createElement("button");
  sendBtn.className = "companionchat-send-btn";
  sendBtn.textContent = companionChatSending ? "…" : "送信";
  sendBtn.disabled = companionChatSending;
  sendBtn.onclick = () => handleCompanionChatSend(companionId);
  inputRow.appendChild(sendBtn);
  container.appendChild(inputRow);
  
  // ★送信直後は一番下（最新のメッセージ）が見えるようにする
  requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });
}

function buildQuotaNoteText(quota) {
  if (!quota) return "思考モデル：1日10回・週40回まで（無くなると簡易モードに切り替わります）";
  const modelLabel = quota.usedModel === "thinking" ? "思考モデル" : "簡易モード（flash）";
  return `今の返答：${modelLabel}　思考モデル残り　本日 ${Math.max(0, quota.dayLimit - quota.dayCount)}/${quota.dayLimit}　今週 ${Math.max(0, quota.weekLimit - quota.weekCount)}/${quota.weekLimit}`;
}

async function handleCompanionChatSend(companionId) {
  if (companionChatSending) return;
  const input = document.getElementById("companionchat-input");
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  
  const session = companionChatSessions[companionId];
  if (!session) return;
  
  session.talkHistory.push({ role: "user", text });
  input.value = "";
  companionChatSending = true;
  renderCompanionChatRoot();
  
  try {
    if (typeof currentUser === "undefined" || !currentUser) throw new Error("ログインしていません");
    const idToken = await currentUser.getIdToken();
    const context = buildCompanionChatContext(companionId);
    
    const res = await fetch("/api/companion-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
      body: JSON.stringify({
        companionId,
        talkHistory: session.talkHistory.slice(0, -1), // ★今送った分より前の履歴（今回のuserMessageは別欄で送る）
        userMessage: text,
        context,
        cachedBriefing: session.cachedBriefing
      })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new Error((data && data.error) || `通信に失敗しました（status ${res.status}）`);
    
    session.talkHistory.push({ role: "model", text: data.reply || "……" });
    session.cachedBriefing = data.briefing || session.cachedBriefing;
    session.lastQuota = data.quota ? { ...data.quota, usedModel: data.usedModel } : session.lastQuota;
  } catch (e) {
    console.error("仲間との会話に失敗しました", e);
    session.talkHistory.push({ role: "model", text: `（うまく通信できなかったみたい……：${e.message}）` });
  } finally {
    companionChatSending = false;
    renderCompanionChatRoot();
  }
}

// ★まとめAI・会話AIに渡す「ゲーム内の生データ」をまとめる
function buildCompanionChatContext(companionId) {
  const ccs = (typeof scenarioProject !== "undefined" && scenarioProject.companionChatSettings) || {};
  const master = typeof COMPANION_MASTER !== "undefined" ? COMPANION_MASTER[companionId] : null;
  const companion = player.companions.find(c => c.companionId === companionId);
  const companionSettings = (ccs.companions && ccs.companions[companionId]) || {};
  
  // ★クリア済みの話のあらすじだけを集める（シナリオビルドの各話「あらすじ」欄）
  const storySummary = (typeof scenarioProject !== "undefined" ? (scenarioProject.chapters || []) : [])
    .filter(c => c.cleared && c.synopsis)
    .map(c => c.synopsis)
    .join("\n");
  
  const members = [];
  members.push({
    name: "主人公（プレイヤー本人）",
    epithet: ccs.protagonistEpithet || "",
    level: player.level,
    className: player.class,
    skills: (typeof getPlayerSkills === "function" ? getPlayerSkills() : []).filter(s => player.level >= (s.unlockLevel || 1)).map(s => ({ name: s.name, description: s.description || "" }))
  });
  player.companions.forEach(c => {
    const m = typeof getCompanionMaster === "function" ? getCompanionMaster(c) : null;
    const cs = (ccs.companions && ccs.companions[c.companionId]) || {};
    members.push({
      name: m ? m.name : c.companionId,
      epithet: cs.epithet || "",
      level: c.level,
      className: m ? m.class : "",
      skills: (typeof getCompanionSkills === "function" ? getCompanionSkills(c) : []).map(s => ({ name: s.name, description: s.description || "" }))
    });
  });
  
  return {
    storySummary,
    partyName: ccs.partyName || "",
    members,
    companionPersona: {
      name: master ? master.name : companionId,
      epithet: companionSettings.epithet || "",
      personality: companionSettings.personality || ""
    }
  };
}
