// datamerge.js
// ★要望対応：ゲームの基本設定・シナリオデータ（game_settings_data.js / scenario_only_data.js 相当）の
//   「git風」バージョン管理。段階1＝ブラウザ内だけで完結する部分。
//   ・コミット履歴（変更のあった項目だけを差分として IndexedDB に保存。古い履歴は日／週の代表に間引く）
//   ・項目単位の3-wayマージ（自分＝今のブラウザ／共通の土台＝前回同期した時点／相手＝JSファイルや書き出しファイル）
//     両方が変えた項目だけ、フィールド単位で「自分｜共通の土台｜相手」の3列表示で解消する
//   ・過去のコミットの状態へ戻す
// ★scenariobuild.js の scenarioProject を読み書きする。段階2（Firestore連携）はここに「相手」を1つ足すだけで済む形にしてある。

// ===== 項目の切り分け方（キーごと） =====
//   idArray：配列。要素の id（無ければ name）で1項目として扱う／dict：オブジェクト。サブキーごとに1項目／whole：丸ごと1項目
const DM_ID_ARRAYS = [
  "enemies", "bosses", "items", "furniture", "fishItems", "skills", "statusAilments", "statusBuffs",
  "companions", "quests", "achievements", "tutorials", "glossary", "facilities", "portraitCharacters", "recipes",
  "elementDefs", "comboSkills", "effectMixes", "towerUnits", "raidUnits", "upperSkills", "gachaSkills", "beasts", "bgmTracks", "mapAreas",
  "chapters", "chapterArcs", "characters", "flagDefs", "variableDefs"
];
const DM_DICTS = [
  "classStats", "elementMatchups", "statusPanels", "trialGuardianOverrides", "fameThresholds",
  "companionChatSettings", "scenarioBuildTabVisibility", "guildRewards", "gachaConfig", "summonConfig", "deletedBuiltinIds"
];
const DM_WHOLES = ["randomNamePool", "mapEdges", "loginBonusDays", "creditsText", "introText"];
const DM_SCENARIO_KEYS = ["chapters", "chapterArcs", "characters", "flagDefs", "variableDefs"];
const DM_SCENARIO_DELETED_SUBS = ["chapters", "characters"]; // deletedBuiltinIds のうちシナリオ側のサブキー
const DM_ALL_KEYS = DM_ID_ARRAYS.concat(DM_DICTS, DM_WHOLES);

const DM_LABELS = {
  enemies: "敵", bosses: "ボス", items: "アイテム", furniture: "家具", fishItems: "魚", skills: "技",
  statusAilments: "状態異常", statusBuffs: "状態強化", companions: "仲間", quests: "クエスト", achievements: "実績",
  tutorials: "チュートリアル", glossary: "用語・語彙", facilities: "施設", portraitCharacters: "立ち絵キャラ", recipes: "レシピ",
  elementDefs: "属性", comboSkills: "コンボ", effectMixes: "エフェクト", towerUnits: "タワーユニット", raidUnits: "出撃キャラ", upperSkills: "上位スキル",
  gachaSkills: "ガチャ技", beasts: "おとも魔獣", bgmTracks: "BGM", mapAreas: "マップ", chapters: "話", chapterArcs: "章", characters: "キャラ",
  flagDefs: "フラグ", variableDefs: "変数", classStats: "職業ステータス", elementMatchups: "属性相性", statusPanels: "ステータスパネル",
  trialGuardianOverrides: "試練の守護者", fameThresholds: "名声しきい値", companionChatSettings: "会話AI設定",
  scenarioBuildTabVisibility: "タブ表示設定", guildRewards: "協会報酬", gachaConfig: "ガチャ設定", summonConfig: "魔獣召喚設定", deletedBuiltinIds: "削除済み組み込み",
  randomNamePool: "ランダム名前", mapEdges: "マップ接続", loginBonusDays: "ログインボーナス", creditsText: "クレジット文面", introText: "注意書き文面"
};

// ===== 基本の道具 =====
function dmClone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
function dmIsObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function dmHas(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
// キーの並び順に左右されない比較用の文字列
function dmStable(v) {
  if (v === undefined) return "\u0000absent";
  if (Array.isArray(v)) return "[" + v.map(dmStable).join(",") + "]";
  if (dmIsObj(v)) return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + dmStable(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
function dmKeyOf(ik) { const i = ik.indexOf("|"); return i < 0 ? ik : ik.slice(0, i); }
function dmSubOf(ik) { const i = ik.indexOf("|"); return i < 0 ? "" : ik.slice(i + 1); }

// domain: "scenario"（話・キャラ）／"settings"（ゲームの基本設定）／"all"
function dmInDomain(domain, ik) {
  if (domain === "all") return true;
  const key = dmKeyOf(ik);
  if (key === "deletedBuiltinIds") {
    const inScenario = DM_SCENARIO_DELETED_SUBS.includes(dmSubOf(ik));
    return domain === "scenario" ? inScenario : !inScenario;
  }
  return domain === "scenario" ? DM_SCENARIO_KEYS.includes(key) : !DM_SCENARIO_KEYS.includes(key);
}

// 状態（state）＝ { items: { 項目キー: 値 }, order: { キー: [項目キー…] }, present: [このデータに含まれていたキー] }
//   項目キーは「キー|ID」（丸ごと扱いのキーは「キー」だけ）
function dmExtractState(src, domain) {
  const items = {}, order = {}, present = [];
  src = src || {};
  DM_ALL_KEYS.forEach(key => {
    const v = src[key];
    if (v === undefined) return;
    present.push(key);
    order[key] = [];
    if (DM_ID_ARRAYS.includes(key)) {
      const seen = {};
      (Array.isArray(v) ? v : []).forEach((el, i) => {
        let id = dmIsObj(el) ? (el.id != null ? el.id : el.name) : null;
        id = id == null ? "#" + i : String(id);
        if (seen[id]) { seen[id]++; id = id + "#" + seen[id]; } else seen[id] = 1;
        const ik = key + "|" + id;
        if (!dmInDomain(domain, ik)) return;
        items[ik] = dmClone(el); order[key].push(ik);
      });
    } else if (DM_DICTS.includes(key)) {
      Object.keys(dmIsObj(v) ? v : {}).forEach(sub => {
        const ik = key + "|" + sub;
        if (!dmInDomain(domain, ik)) return;
        items[ik] = dmClone(v[sub]); order[key].push(ik);
      });
    } else {
      if (!dmInDomain(domain, key)) return;
      items[key] = dmClone(v); order[key].push(key);
    }
  });
  return { items, order, present };
}

// 状態を scenarioProject（project）へ書き戻す。state に含まれるキーだけ触る
function dmApplyState(project, state, domain) {
  Object.keys(state.order).forEach(key => {
    const list = state.order[key];
    if (DM_ID_ARRAYS.includes(key)) {
      project[key] = list.filter(ik => dmHas(state.items, ik)).map(ik => dmClone(state.items[ik]));
    } else if (DM_DICTS.includes(key)) {
      const out = {};
      if (key === "deletedBuiltinIds" && dmIsObj(project[key])) {
        Object.keys(project[key]).forEach(sub => { if (!dmInDomain(domain, key + "|" + sub)) out[sub] = project[key][sub]; });
      }
      list.forEach(ik => { if (dmHas(state.items, ik)) out[dmSubOf(ik)] = dmClone(state.items[ik]); });
      project[key] = out;
    } else if (list.length && dmHas(state.items, list[0])) {
      project[key] = dmClone(state.items[list[0]]);
    }
  });
}

// 2つの状態の差（変更のあった項目だけ）。{ 項目キー: { op: "add"|"del"|"mod", a: 変更前, b: 変更後 } }
function dmDiffStates(from, to) {
  const changes = {};
  const keys = {};
  Object.keys(from.items).forEach(k => { keys[k] = 1; });
  Object.keys(to.items).forEach(k => { keys[k] = 1; });
  Object.keys(keys).forEach(ik => {
    const ha = dmHas(from.items, ik), hb = dmHas(to.items, ik);
    if (ha && hb) {
      if (dmStable(from.items[ik]) !== dmStable(to.items[ik])) changes[ik] = { op: "mod", a: from.items[ik], b: to.items[ik] };
    } else if (hb) changes[ik] = { op: "add", b: to.items[ik] };
    else changes[ik] = { op: "del", a: from.items[ik] };
  });
  return changes;
}

// 項目の見出し（画面表示用）
function dmItemTitle(ik, value) {
  const key = dmKeyOf(ik);
  const label = DM_LABELS[key] || key;
  const sub = dmSubOf(ik);
  let name = sub;
  if (dmIsObj(value)) name = value.name || value.title || value.label || sub;
  return sub ? `【${label}】${name}${name !== sub ? `（${sub.length > 24 ? sub.slice(0, 24) + "…" : sub}）` : ""}` : `【${label}】`;
}

// ===== 3-wayマージ =====
// base/mine/theirs はいずれも dmExtractState の結果（同じ範囲に絞り込み済み）
function dmMerge3(base, mine, theirs) {
  const result = { items: {}, auto: [], conflicts: [], unchanged: 0, keptMine: 0 };
  const seenKeys = {}, keyList = [];
  [mine, theirs, base].forEach(s => Object.keys(s.order).forEach(k => s.order[k].forEach(ik => { if (!seenKeys[ik]) { seenKeys[ik] = 1; keyList.push(ik); } })));
  keyList.forEach(ik => {
    const hb = dmHas(base.items, ik), hm = dmHas(mine.items, ik), ht = dmHas(theirs.items, ik);
    if (!hm && !ht) return; // 両方とも無い（両方で削除済み／最初から無い）
    const sb = hb ? dmStable(base.items[ik]) : null;
    const sm = hm ? dmStable(mine.items[ik]) : null;
    const st = ht ? dmStable(theirs.items[ik]) : null;
    if (hm && ht && sm === st) { result.items[ik] = mine.items[ik]; result.unchanged++; return; }
    const mineUnchanged = hm === hb && sm === sb;
    const theirsUnchanged = ht === hb && st === sb;
    if (mineUnchanged) { // 自分は変えていない → 相手の変更をそのまま取り込む
      if (ht) result.items[ik] = theirs.items[ik];
      result.auto.push({ ik, side: "theirs", op: ht ? (hb ? "mod" : "add") : "del", title: dmItemTitle(ik, ht ? theirs.items[ik] : base.items[ik]) });
      return;
    }
    if (theirsUnchanged) { // 相手は変えていない → 自分の状態を維持
      if (hm) result.items[ik] = mine.items[ik];
      result.keptMine++;
      return;
    }
    // 両方が変えた
    if (hm && ht && dmIsObj(mine.items[ik]) && dmIsObj(theirs.items[ik])) {
      const fb = hb && dmIsObj(base.items[ik]) ? base.items[ik] : {};
      const fm = mine.items[ik], ft = theirs.items[ik];
      const fieldNames = [];
      [fm, ft, fb].forEach(o => Object.keys(o).forEach(f => { if (!fieldNames.includes(f)) fieldNames.push(f); }));
      const merged = {}, bad = [];
      fieldNames.forEach(f => {
        const vm = dmHas(fm, f) ? fm[f] : undefined, vt = dmHas(ft, f) ? ft[f] : undefined, vb = dmHas(fb, f) ? fb[f] : undefined;
        const a = dmStable(vm), b = dmStable(vt), c = dmStable(vb);
        let pick;
        if (a === b) pick = vm;
        else if (a === c) pick = vt;
        else if (b === c) pick = vm;
        else { bad.push({ name: f, mine: vm, base: vb, theirs: vt, choice: null }); return; }
        if (pick !== undefined) merged[f] = pick;
      });
      if (bad.length === 0) {
        result.items[ik] = merged;
        result.auto.push({ ik, side: "both", op: "mod", title: dmItemTitle(ik, merged) });
      } else {
        result.conflicts.push({ ik, kind: "fields", title: dmItemTitle(ik, fm), merged, fields: bad });
      }
      return;
    }
    result.conflicts.push({
      ik, kind: "whole", title: dmItemTitle(ik, hm ? mine.items[ik] : (ht ? theirs.items[ik] : base.items[ik])),
      mine: hm ? mine.items[ik] : undefined, base: hb ? base.items[ik] : undefined, theirs: ht ? theirs.items[ik] : undefined,
      hasMine: hm, hasBase: hb, hasTheirs: ht, choice: null
    });
  });
  return result;
}

function dmConflictResolved(c) {
  return c.kind === "whole" ? c.choice !== null : c.fields.every(f => f.choice !== null);
}

// 競合の選択を反映して、最終的な状態（order付き）を作る
function dmFinalize(res, mine, theirs) {
  const items = Object.assign({}, res.items);
  res.conflicts.forEach(c => {
    if (c.kind === "whole") {
      const useMine = c.choice === "mine";
      const has = useMine ? c.hasMine : c.hasTheirs;
      if (has) items[c.ik] = useMine ? c.mine : c.theirs; else delete items[c.ik];
    } else {
      const out = Object.assign({}, c.merged);
      c.fields.forEach(f => {
        const v = f.choice === "theirs" ? f.theirs : f.mine;
        if (v === undefined) delete out[f.name]; else out[f.name] = v;
      });
      items[c.ik] = out;
    }
  });
  const order = {};
  const keys = Object.keys(mine.order);
  Object.keys(theirs.order).forEach(k => { if (!keys.includes(k)) keys.push(k); });
  keys.forEach(k => {
    const list = [];
    (mine.order[k] || []).concat(theirs.order[k] || []).forEach(ik => { if (dmHas(items, ik) && !list.includes(ik)) list.push(ik); });
    order[k] = list;
  });
  return { items, order };
}

// ===== IndexedDB（コミット履歴・土台） =====
let dmDbPromise = null;
function dmOpenDb() {
  if (dmDbPromise) return dmDbPromise;
  dmDbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDBが使えません")); return; }
    const req = indexedDB.open("demoge_datamerge", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("commits", { keyPath: "id" });
      db.createObjectStore("meta", { keyPath: "k" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dmDbPromise;
}
async function dmDo(storeName, mode, fn) {
  const db = await dmOpenDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let out;
    try { out = fn(store); } catch (e) { reject(e); return; }
    tx.oncomplete = () => resolve(out && typeof out === "object" && "result" in out ? out.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
function dmReq(store, method, arg) { return store[method](arg); }
async function dmMetaGet(k) { const r = await dmDo("meta", "readonly", s => dmReq(s, "get", k)); return r || null; }
async function dmMetaPut(k, value) { await dmDo("meta", "readwrite", s => s.put(Object.assign({ k }, value))); }
async function dmCommitsAll() {
  const list = await dmDo("commits", "readonly", s => dmReq(s, "getAll"));
  return (list || []).slice().sort((a, b) => a.ts - b.ts);
}

// ===== コミット =====
function dmCountText(changes) {
  const c = { add: 0, mod: 0, del: 0 };
  Object.keys(changes).forEach(ik => { c[changes[ik].op]++; });
  return c;
}
// 今のscenarioProjectを1コミットとして記録する。変更が無ければ何もしない（nullを返す）
async function dmCommit(message, kind) {
  try {
    const cur = dmExtractState(scenarioProject, "all");
    const head = await dmMetaGet("head");
    const prev = head ? head.state : { items: {}, order: {} };
    const changes = dmDiffStates(prev, cur);
    const n = Object.keys(changes).length;
    if (n === 0 && head) { await dmMetaPut("head", { state: cur, ts: Date.now() }); return null; }
    const commit = {
      id: String(Date.now()) + "_" + Math.random().toString(36).slice(2, 6),
      ts: Date.now(), message: message || (head ? "保存" : "初回スナップショット"), kind: kind || "save", changes, n
    };
    await dmDo("commits", "readwrite", s => s.put(commit));
    await dmMetaPut("head", { state: cur, ts: commit.ts });
    await dmCompactHistory();
    return commit;
  } catch (e) {
    console.error("コミット履歴の記録に失敗しました（ゲームの動作には影響しません）", e);
    return null;
  }
}
// （以前は💾保存の直後に自動で呼んでいたが、専用ボタン「コミット＆同期」に変えたため、今は呼ばれていない）
function dmAutoCommitAfterSave() { dmCommit("保存", "save"); }

// 複数のコミットを1つにまとめる（変更の合成：変更前は一番古いもの、変更後は一番新しいもの）
function dmComposeCommits(list) {
  const first = list[0], last = list[list.length - 1];
  const merged = {};
  list.forEach(c => {
    Object.keys(c.changes).forEach(ik => {
      const ch = c.changes[ik];
      if (!merged[ik]) merged[ik] = { hasA: ch.op !== "add", a: ch.a, hasB: ch.op !== "del", b: ch.b };
      else { merged[ik].hasB = ch.op !== "del"; merged[ik].b = ch.b; }
    });
  });
  const changes = {};
  Object.keys(merged).forEach(ik => {
    const m = merged[ik];
    if (m.hasA && m.hasB) { if (dmStable(m.a) !== dmStable(m.b)) changes[ik] = { op: "mod", a: m.a, b: m.b }; }
    else if (m.hasB) changes[ik] = { op: "add", b: m.b };
    else if (m.hasA) changes[ik] = { op: "del", a: m.a };
  });
  return {
    id: last.id, ts: last.ts, kind: "digest", changes, n: Object.keys(changes).length,
    message: `（まとめ）${list.length}件：${first.message}${list.length > 1 ? " ～ " + last.message : ""}`
  };
}
// 古い履歴の間引き：2日より前は1日1件、1週間より前は1週1件にまとめる（直近は細かいまま）
async function dmCompactHistory() {
  const all = await dmCommitsAll();
  const now = Date.now(), DAY = 86400000;
  const groups = {};
  all.forEach(c => {
    const age = now - c.ts;
    if (age <= 2 * DAY) return;
    const d = new Date(c.ts);
    let gk;
    if (age > 7 * DAY) { const w = Math.floor((c.ts - new Date(2020, 0, 6).getTime()) / (7 * DAY)); gk = "w" + w; }
    else gk = "d" + d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
    (groups[gk] = groups[gk] || []).push(c);
  });
  const todo = Object.keys(groups).map(k => groups[k]).filter(g => g.length > 1);
  for (const g of todo) {
    const digest = dmComposeCommits(g);
    await dmDo("commits", "readwrite", s => { g.forEach(c => s.delete(c.id)); s.put(digest); });
  }
}
// 指定コミットの時点の状態を復元する（今のheadから新しい順に巻き戻す）
async function dmStateAtCommit(commitId) {
  const head = await dmMetaGet("head");
  if (!head) return null;
  const all = await dmCommitsAll();
  const target = all.find(c => c.id === commitId);
  if (!target) return null;
  const items = Object.assign({}, head.state.items);
  all.slice(all.indexOf(target) + 1).reverse().forEach(c => {
    Object.keys(c.changes).forEach(ik => {
      const ch = c.changes[ik];
      if (ch.op === "add") delete items[ik]; else items[ik] = ch.a;
    });
  });
  return { items, order: head.state.order };
}
async function dmRevertTo(commitId) {
  const target = (await dmCommitsAll()).find(c => c.id === commitId);
  if (!target) return false;
  await dmCommit("戻す前の自動コミット", "auto");
  const restored = await dmStateAtCommit(commitId);
  if (!restored) return false;
  // 並び順：今の並びのうち残る項目＋復元された項目を後ろに足す
  const cur = dmExtractState(scenarioProject, "all");
  const order = {};
  DM_ALL_KEYS.forEach(k => {
    const list = [];
    (cur.order[k] || []).concat(restored.order[k] || []).forEach(ik => { if (dmHas(restored.items, ik) && !list.includes(ik)) list.push(ik); });
    Object.keys(restored.items).forEach(ik => { if (dmKeyOf(ik) === k && !list.includes(ik)) list.push(ik); });
    order[k] = list;
  });
  dmApplyState(scenarioProject, { items: restored.items, order }, "all");
  dmFinishApply();
  await dmCommit(`${dmFormatTs(target.ts)} の時点に戻す`, "revert");
  return true;
}

// 反映後の共通処理：保存→登録し直し→画面更新
function dmFinishApply() {
  if (typeof normalizeScenarioProject === "function") { try { normalizeScenarioProject(); } catch (e) { console.error(e); } }
  if (typeof saveCustomScenarioData === "function") saveCustomScenarioData();
  if (typeof scenarioBuildHasUnsavedChanges !== "undefined") { scenarioBuildHasUnsavedChanges = false; if (typeof updateScenarioBuildSaveButton === "function") updateScenarioBuildSaveButton(); }
  if (typeof loadCustomScenarioData === "function") { try { loadCustomScenarioData(); } catch (e) { console.error(e); } }
  const ov = document.getElementById("scenariobuild-overlay");
  if (typeof renderScenarioBuildPanel === "function" && ov && !ov.classList.contains("hidden")) { try { renderScenarioBuildPanel(); } catch (e) { console.error(e); } }
}
function dmFormatTs(ts) {
  const d = new Date(ts), p = n => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ===== 外部データ（JS／書き出しファイル）とのマージ =====
// source："repo"（リポジトリのJS）／"import"（持ち込んだ書き出しファイル）。土台は source×domain ごとに持つ
async function dmGetSyncBase(source, domain) { return await dmMetaGet(`sync:${source}:${domain}`); }
// 外部データ（data）と同じ内容になった時点を、土台として記録する
async function dmMarkSynced(source, domain, data) {
  try {
    const st = dmExtractState(data, domain);
    await dmMetaPut(`sync:${source}:${domain}`, { version: Number(data.version) || Date.now(), state: { items: st.items, order: st.order }, ts: Date.now() });
  } catch (e) { console.error("同期の土台の記録に失敗しました", e); }
}
function dmDomainLabel(domain) { return domain === "scenario" ? "話・キャラクター" : "ゲームの基本設定"; }

// 戻り値：true＝マージして反映した／false＝キャンセル・失敗
async function dmMergeExternal(domain, data, source, sourceLabel, quiet) {
  try {
    if (!data || typeof data !== "object") throw new Error("データがありません");
    const theirsFull = dmExtractState(data, domain);
    const present = theirsFull.present;
    const filterTo = st => {
      const items = {}, order = {};
      present.forEach(k => { order[k] = (st.order[k] || []).slice(); order[k].forEach(ik => { items[ik] = st.items[ik]; }); });
      return { items, order };
    };
    const theirs = filterTo(theirsFull);
    const mine = filterTo(dmExtractState(scenarioProject, domain));
    const baseRec = await dmGetSyncBase(source, domain);
    const base = baseRec ? filterTo(baseRec.state) : { items: {}, order: {} };
    if (baseRec && Number(data.version) && Number(data.version) < Number(baseRec.version)) {
      const ok = await showGameConfirm("このデータは、前回同期した（取り込み・書き出しした）データより古いバージョンです。このままマージすると、前回以降の変更が取り消される場合があります。それでも続けますか？");
      if (!ok) return false;
    }
    const res = dmMerge3(base, mine, theirs);
    if (res.conflicts.length === 0 && res.auto.length === 0) {
      await dmMarkSynced(source, domain, data);
      if (!quiet) await showGameAlert(`${dmDomainLabel(domain)}：マージするものはありませんでした（相手との差分なし／自分だけの変更のみ）。`);
      return true;
    }
    const ok = await dmShowMergeUI(res, `${sourceLabel}｜${dmDomainLabel(domain)}`, !baseRec);
    if (!ok) return false;
    const finalState = dmFinalize(res, mine, theirs);
    await dmCommit("マージ前の自動コミット", "auto");
    dmApplyState(scenarioProject, finalState, domain);
    dmFinishApply();
    await dmMarkSynced(source, domain, data);
    try { localStorage.setItem(domain === "scenario" ? SCENARIOBUILD_SCENARIO_FILE_VERSION_KEY : SCENARIOBUILD_SETTINGS_FILE_VERSION_KEY, String(data.version)); } catch (e) { /* 記録できなくても続行 */ }
    await dmCommit(`マージ：${sourceLabel}｜${dmDomainLabel(domain)}（自動${res.auto.length}件／競合${res.conflicts.length}件）`, "merge");
    return true;
  } catch (e) {
    console.error("マージに失敗しました", e);
    if (typeof showGameAlert === "function") await showGameAlert("マージに失敗しました。ファイルの形式を確認してください。");
    return false;
  }
}

// 書き出しファイル（.js）の文字列から、ドメインとデータを取り出す
function dmParseExportedJs(text) {
  const m = /window\.(SCENARIOBUILD_IMPORTED_(SCENARIO|SETTINGS)_DATA)\s*=\s*([\s\S]*?);?\s*$/.exec(text.trim());
  if (!m) throw new Error("書き出しファイルの形式ではありません");
  return { domain: m[2] === "SCENARIO" ? "scenario" : "settings", data: JSON.parse(m[3].replace(/;\s*$/, "")) };
}

// 起動時の確認ダイアログ：「読み込む（上書き）」「マージして取り込む」「読み込まない」
function dmAskLoadChoice(message) {
  return new Promise(resolve => {
    const ov = document.createElement("div");
    ov.className = "dm-overlay";
    ov.innerHTML = `<div class="dm-dialog"><div class="dm-dialog-msg"></div><div class="dm-dialog-btns">
      <button type="button" class="dm-btn dm-btn-main" data-v="merge">マージして取り込む</button>
      <button type="button" class="dm-btn" data-v="load">読み込む（全部上書き）</button>
      <button type="button" class="dm-btn" data-v="skip">読み込まない</button></div></div>`;
    ov.querySelector(".dm-dialog-msg").textContent = message.replace(/\nこのデータファイルを読み込みますか？[\s\S]*$/, "\nどうしますか？\n・マージ：自分の変更と相手の変更を項目ごとに合わせます（競合した所だけ選びます）\n・読み込む：ファイルの内容で全部上書きします\n・読み込まない：今のブラウザのデータを使い続けます");
    ov.querySelectorAll("button").forEach(b => { b.onclick = () => { ov.remove(); resolve(b.dataset.v); }; });
    document.body.appendChild(ov);
  });
}

// ===== マージ画面（自分｜共通の土台｜相手） =====
function dmValueText(v, max) {
  if (v === undefined) return "（なし）";
  let s = typeof v === "string" ? v : JSON.stringify(v, null, 1);
  if (s.length > max) s = s.slice(0, max) + "…";
  return s;
}
// ===== マージ画面の表示部品（ブロックをコードではなくブロックの形で見せる／違う所を赤枠で囲む） =====
// ブロック（id と type を持つオブジェクト）が1つ以上並んだ配列かどうか
function dmIsBlockList(v) {
  return Array.isArray(v) && v.length > 0 && v.every(x => dmIsObj(x) && x.type !== undefined && x.id != null);
}
// 「id を持つオブジェクトの配列」（子ブロックや選択肢）かどうか
function dmIsIdObjList(v) {
  return Array.isArray(v) && v.length > 0 && v.every(x => dmIsObj(x) && x.id != null);
}
// 子ブロック・選択肢の中身を除いた、そのブロック自身だけの比較用文字列
function dmOwnStable(o) {
  const c = {};
  Object.keys(o).forEach(k => { if (!dmIsIdObjList(o[k])) c[k] = o[k]; });
  return dmStable(c);
}
function dmFindById(list, id) {
  return Array.isArray(list) ? list.find(x => dmIsObj(x) && x.id === id) : undefined;
}
function dmBlockLabel(type) {
  try { if (typeof SCENARIO_BLOCK_TYPES !== "undefined" && SCENARIO_BLOCK_TYPES[type]) return SCENARIO_BLOCK_TYPES[type]; } catch (e) { /* 表示だけなので無視 */ }
  return type;
}
function dmBlockSummary(b) {
  if (b.type === "dialogue") return (b.speaker ? b.speaker + "：" : "") + (b.text || "");
  if (b.type === "narration" || b.type === "telop") return b.text || "";
  if (b.type === "choice") return b.prompt || "";
  try { if (typeof blockPreviewText === "function") return blockPreviewText(b) || ""; } catch (e) { /* 表示だけなので無視 */ }
  return "";
}
// ブロック1つを、エディタのブロックのように表示する（読み取り専用）。
//   other：比べる相手側の同じidのブロック（無ければundefined＝この側にだけある）。plain=trueなら赤枠をつけない（土台の列用）
//   違う所（このブロック自身の中身が違う／相手側に無い）だけを赤枠で囲む。子ブロック・選択肢の中身は、それぞれ個別に比べる
function dmBlockCard(b, other, plain, labelOverride) {
  const el = document.createElement("div");
  el.className = "dm-block";
  const diff = !plain && (other === undefined || dmOwnStable(b) !== dmOwnStable(other));
  if (diff) el.classList.add("dm-diff");
  const head = document.createElement("div");
  head.className = "dm-block-head";
  head.textContent = (labelOverride || dmBlockLabel(b.type)) + (!plain && other === undefined ? "（こちら側にだけある）" : "");
  el.appendChild(head);
  const sm = labelOverride ? (b.text || "") : dmBlockSummary(b);
  if (sm) { const t = document.createElement("div"); t.className = "dm-block-text"; t.textContent = sm; el.appendChild(t); }
  Object.keys(b).forEach(k => {
    if (!dmIsIdObjList(b[k])) return;
    const ol = dmIsObj(other) ? other[k] : undefined;
    const nest = document.createElement("div");
    nest.className = "dm-block-nested";
    b[k].forEach(x => {
      const ox = dmFindById(ol, x.id);
      if (x.type === undefined) { // 選択肢など（typeを持たない）
        const opt = dmBlockCard(x, plain ? undefined : ox, plain, k === "options" ? "選択肢" : k);
        nest.appendChild(opt);
      } else nest.appendChild(dmBlockCard(x, ox, plain));
    });
    el.appendChild(nest);
  });
  return el;
}
// 値1つを表示する部品。other：比べる相手側の値（nullなら赤枠なし＝土台の列）
function dmValueEl(v, other) {
  const wrap = document.createElement("div");
  if (v === undefined) { wrap.className = "dm-none"; wrap.textContent = "（なし）"; return wrap; }
  const plain = other === null;
  if (dmIsBlockList(v)) {
    v.forEach(b => wrap.appendChild(dmBlockCard(b, plain ? undefined : dmFindById(other, b.id), plain)));
    return wrap;
  }
  if (dmIsObj(v)) {
    Object.keys(v).forEach(k => {
      const row = document.createElement("div");
      row.className = "dm-kv";
      const ov = !plain && dmIsObj(other) ? other[k] : undefined;
      if (!plain && dmStable(v[k]) !== dmStable(ov)) row.classList.add("dm-diff");
      const kk = document.createElement("div"); kk.className = "dm-kv-key"; kk.textContent = k;
      const vv = document.createElement("div"); vv.className = "dm-kv-val";
      if (dmIsBlockList(v[k])) v[k].forEach(b => vv.appendChild(dmBlockCard(b, plain ? undefined : dmFindById(ov, b.id), plain)));
      else vv.textContent = dmValueText(v[k], 400);
      row.appendChild(kk); row.appendChild(vv);
      wrap.appendChild(row);
    });
    return wrap;
  }
  wrap.textContent = dmValueText(v, 400);
  return wrap;
}
// 複数の並び（idの配列）を、できるだけ順番を保ったまま1本にそろえる（片方にしか無いものも拾う）
function dmAlignIds(lists) {
  let order = lists[0].slice();
  for (let n = 1; n < lists.length; n++) {
    const L = lists[n], inO = new Set(order), inL = new Set(L), out = [];
    const push = id => { if (!out.includes(id)) out.push(id); };
    let i = 0, j = 0;
    while (i < order.length || j < L.length) {
      if (i < order.length && j < L.length && order[i] === L[j]) { push(order[i]); i++; j++; }
      else if (i < order.length && !inL.has(order[i])) push(order[i++]);
      else if (j < L.length && !inO.has(L[j])) push(L[j++]);
      else if (i < order.length) push(order[i++]);
      else push(L[j++]);
    }
    order = out;
  }
  return order;
}
// ブロックの並び（話の中身）を、1ブロックずつ「自分｜土台｜相手」を横に並べて見せる。
//   selKey：選択用のdata-sel（"競合番号:フィールド番号:"）。onPick(side)：どちらかを選んだ時に呼ぶ
function dmBuildBlockField(label, vm, vb, vt, selKey, onPick) {
  const ml = Array.isArray(vm) ? vm : [], bl = Array.isArray(vb) ? vb : [], tl = Array.isArray(vt) ? vt : [];
  const mm = new Map(ml.map(b => [b.id, b])), bm = new Map(bl.map(b => [b.id, b])), tm = new Map(tl.map(b => [b.id, b]));
  const ids = dmAlignIds([ml.map(b => b.id), tl.map(b => b.id), bl.map(b => b.id)]).filter(id => mm.has(id) || tm.has(id));
  const rows = ids.map(id => ({ id, m: mm.get(id), b: bm.get(id), t: tm.get(id) }));
  const isSame = r => r.m && r.t && dmStable(r.m) === dmStable(r.t);
  const root = document.createElement("div");
  root.className = "dm-blockfield";

  const head = document.createElement("div");
  head.className = "dm-grid";
  const hl = document.createElement("div"); hl.className = "dm-cell dm-cell-label"; hl.textContent = `${label}（ブロック）`; head.appendChild(hl);
  const mkHead = (text, side) => {
    const h = document.createElement("div");
    h.className = "dm-cell dm-bhead" + (side ? " dm-pick" : "");
    h.textContent = side ? `${text}を採用` : text;
    if (side) { h.dataset.sel = selKey + side; h.onclick = () => onPick(side); }
    return h;
  };
  head.appendChild(mkHead("自分", "mine")); head.appendChild(mkHead("共通の土台", null)); head.appendChild(mkHead("相手", "theirs"));
  root.appendChild(head);

  const addRow = (r, host) => {
    const row = document.createElement("div");
    row.className = "dm-grid";
    const lab = document.createElement("div");
    lab.className = "dm-cell dm-cell-label dm-blabel";
    lab.textContent = dmBlockLabel((r.m || r.t).type);
    row.appendChild(lab);
    const cell = (card, side) => {
      const d = document.createElement("div");
      d.className = "dm-bcell" + (side ? " dm-bpick" : "");
      if (card) d.appendChild(card);
      if (side) { d.dataset.sel = selKey + side; d.onclick = () => onPick(side); }
      return d;
    };
    const missing = text => { const x = document.createElement("div"); x.className = "dm-missing"; x.textContent = text; return x; };
    row.appendChild(cell(r.m ? dmBlockCard(r.m, r.t) : missing("（自分側には無い）"), "mine"));
    row.appendChild(cell(r.b ? dmBlockCard(r.b, undefined, true) : (r.m || r.t ? (() => { const x = document.createElement("div"); x.className = "dm-none"; x.textContent = "（土台には無い）"; return x; })() : null), null));
    row.appendChild(cell(r.t ? dmBlockCard(r.t, r.m) : missing("（相手側には無い）"), "theirs"));
    host.appendChild(row);
  };
  // 自分と相手で同じブロックが3つ以上続く所は、たたんでおく
  let i = 0;
  while (i < rows.length) {
    if (!isSame(rows[i])) { addRow(rows[i], root); i++; continue; }
    let j = i;
    while (j < rows.length && isSame(rows[j])) j++;
    const n = j - i;
    if (n <= 2) { for (let k = i; k < j; k++) addRow(rows[k], root); }
    else {
      const det = document.createElement("details");
      det.className = "dm-same";
      const sm = document.createElement("summary");
      sm.textContent = `違いのないブロック ${n}件（押すと表示）`;
      det.appendChild(sm);
      for (let k = i; k < j; k++) addRow(rows[k], det);
      root.appendChild(det);
    }
    i = j;
  }
  return root;
}

function dmShowMergeUI(res, title, noBase) {
  return new Promise(resolve => {
    const ov = document.createElement("div");
    ov.className = "dm-overlay";
    const panel = document.createElement("div");
    panel.className = "dm-panel";
    ov.appendChild(panel);
    const head = document.createElement("div");
    head.className = "dm-head";
    head.textContent = `マージ：${title}`;
    panel.appendChild(head);
    const body = document.createElement("div");
    body.className = "dm-body";
    panel.appendChild(body);

    const sum = document.createElement("div");
    sum.className = "dm-summary";
    const takenTheirs = res.auto.filter(a => a.side === "theirs").length;
    const mergedBoth = res.auto.filter(a => a.side === "both").length;
    sum.innerHTML = `<span class="dm-chip">相手の変更を取り込み <b>${takenTheirs}</b>件</span><span class="dm-chip">両方の変更を自動で合成 <b>${mergedBoth}</b>件</span><span class="dm-chip">自分の変更を維持 <b>${res.keptMine}</b>件</span><span class="dm-chip dm-chip-warn">競合 <b>${res.conflicts.length}</b>件</span>`;
    body.appendChild(sum);
    if (noBase) {
      const nb = document.createElement("div");
      nb.className = "dm-note";
      nb.textContent = "このデータとの同期は初めてなので、共通の土台がありません。自分と相手で内容が違う項目は、競合として表示されます（土台の列は空になります）。";
      body.appendChild(nb);
    }
    if (res.auto.length > 0) {
      const det = document.createElement("details");
      det.className = "dm-auto";
      const sm = document.createElement("summary");
      sm.textContent = `自動で反映される項目（${res.auto.length}件）を見る`;
      det.appendChild(sm);
      const opText = { add: "追加", mod: "変更", del: "削除" };
      res.auto.slice(0, 300).forEach(a => {
        const row = document.createElement("div");
        row.className = "dm-auto-row";
        row.textContent = `${a.side === "both" ? "合成" : "相手の" + opText[a.op]}：${a.title}`;
        det.appendChild(row);
      });
      if (res.auto.length > 300) { const more = document.createElement("div"); more.className = "dm-auto-row"; more.textContent = `…ほか${res.auto.length - 300}件`; det.appendChild(more); }
      body.appendChild(det);
    }

    const okBtn = document.createElement("button");
    const refresh = () => {
      const left = res.conflicts.filter(c => !dmConflictResolved(c)).length;
      okBtn.disabled = left > 0;
      okBtn.textContent = left > 0 ? `未解決の競合が${left}件あります` : "マージを確定する";
      ov.querySelectorAll("[data-sel]").forEach(el => {
        const [ci, fi, side] = el.dataset.sel.split(":");
        const c = res.conflicts[Number(ci)];
        const cur = c.kind === "whole" ? c.choice : c.fields[Number(fi)].choice;
        el.classList.toggle("dm-selected", cur === side);
      });
    };

    if (res.conflicts.length > 0) {
      const bulk = document.createElement("div");
      bulk.className = "dm-bulk";
      [["競合を全て自分側にする", "mine"], ["競合を全て相手側にする", "theirs"]].forEach(([label, side]) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "dm-btn"; b.textContent = label;
        b.onclick = () => { res.conflicts.forEach(c => { if (c.kind === "whole") c.choice = side; else c.fields.forEach(f => { f.choice = side; }); }); refresh(); };
        bulk.appendChild(b);
      });
      body.appendChild(bulk);
      const colHead = document.createElement("div");
      colHead.className = "dm-grid dm-grid-head";
      colHead.innerHTML = "<div>項目</div><div>自分（今のブラウザ）</div><div>共通の土台</div><div>相手</div>";
      body.appendChild(colHead);
    }
    res.conflicts.forEach((c, ci) => {
      const box = document.createElement("div");
      box.className = "dm-conflict";
      const t = document.createElement("div");
      t.className = "dm-conflict-title";
      t.textContent = `${c.title}${c.kind === "fields" ? "（フィールドごとに選ぶ）" : ""}`;
      box.appendChild(t);
      const addRow = (label, vm, vb, vt, fi, selectable) => {
        const pick = side => { if (c.kind === "whole") c.choice = side; else c.fields[fi].choice = side; refresh(); };
        const listOrNone = x => x === undefined || Array.isArray(x);
        if (c.kind === "fields" && (dmIsBlockList(vm) || dmIsBlockList(vt)) && listOrNone(vm) && listOrNone(vt) && listOrNone(vb)) {
          box.appendChild(dmBuildBlockField(label, vm, vb, vt, `${ci}:${fi}:`, pick));
          return;
        }
        const row = document.createElement("div");
        row.className = "dm-grid";
        const l = document.createElement("div"); l.className = "dm-cell dm-cell-label"; l.textContent = label; row.appendChild(l);
        const mk = (v, side, other) => {
          const cell = document.createElement("div");
          cell.className = "dm-cell" + (side ? " dm-pick" : "");
          cell.appendChild(dmValueEl(v, other));
          // 中身を分けて見せられない値（文字・数字など）は、相手と違うことをセル全体の赤枠で示す
          if (other !== null && v !== undefined && !dmIsObj(v) && !dmIsBlockList(v) && dmStable(v) !== dmStable(other)) cell.classList.add("dm-diff");
          cell.title = dmValueText(v, 4000);
          if (side) {
            cell.dataset.sel = `${ci}:${fi}:${side}`;
            cell.onclick = () => pick(side);
          }
          return cell;
        };
        row.appendChild(mk(vm, selectable ? "mine" : null, vt));
        row.appendChild(mk(vb, null, null));
        row.appendChild(mk(vt, selectable ? "theirs" : null, vm));
        box.appendChild(row);
      };
      if (c.kind === "whole") addRow(c.hasMine && c.hasTheirs ? "全体" : (c.hasMine ? "全体（相手は削除）" : "全体（自分は削除）"), c.mine, c.base, c.theirs, 0, true);
      else c.fields.forEach((f, fi) => addRow(f.name, f.mine, f.base, f.theirs, fi, true));
      body.appendChild(box);
    });

    const foot = document.createElement("div");
    foot.className = "dm-foot";
    okBtn.type = "button"; okBtn.className = "dm-btn dm-btn-main";
    okBtn.onclick = () => { ov.remove(); resolve(true); };
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.className = "dm-btn"; cancel.textContent = "キャンセル（何も変えない）";
    cancel.onclick = () => { ov.remove(); resolve(false); };
    foot.appendChild(okBtn); foot.appendChild(cancel);
    panel.appendChild(foot);
    document.body.appendChild(ov);
    refresh();
  });
}

// ===== データ管理タブに出すパネル（履歴・ファイルとマージ） =====
function renderDataMergeSection(container) {
  const wrap = document.createElement("div");
  wrap.className = "dm-section";
  wrap.innerHTML = `<h4 class="scenariobuild-subheading">📚 バージョン管理（git風）</h4>
    <p class="devmode-note">💾保存はブラウザへの保存だけです。履歴（コミット）は、ヘッダーの「🔄 コミット＆同期」か、下の「今の状態をコミット」を押した時に、変更のあった項目だけが記録されます。古い履歴は日・週ごとにまとめられます。他のデータ（リポジトリのJSや、別の端末で書き出したファイル）とは、項目ごとに自動で合わせ、両方が変えた所だけ「自分｜共通の土台｜相手」で選べます。</p>
    <div class="dm-row"><input type="text" class="dm-msg" placeholder="コミットメッセージ（任意）"><button type="button" class="devmode-btn dm-commit-btn">今の状態をコミット</button></div>
    <div class="dm-row">
      <button type="button" class="devmode-btn dm-repo-btn">読み込み済みのJS（リポジトリ）とマージ</button>
      <label class="devmode-btn" style="display:inline-block;">書き出しファイル（.js）とマージ<input type="file" accept=".js,text/javascript" class="dm-file" style="display:none;"></label>
    </div>
    <div class="dm-history"></div>`;
  container.appendChild(wrap);
  const hist = wrap.querySelector(".dm-history");
  async function refreshHistory() {
    hist.textContent = "履歴を読み込み中…";
    let list = [];
    try { list = (await dmCommitsAll()).reverse(); } catch (e) { hist.textContent = "履歴を利用できません（ブラウザの設定でIndexedDBが無効の可能性があります）。"; return; }
    hist.textContent = "";
    if (list.length === 0) { hist.textContent = "まだ履歴がありません。ヘッダーの「🔄 コミット＆同期」か、上のボタンでコミットすると記録されます。"; return; }
    list.slice(0, 40).forEach((c, i) => {
      const row = document.createElement("div");
      row.className = "dm-hist-row";
      const cnt = dmCountText(c.changes);
      const info = document.createElement("div");
      info.className = "dm-hist-info";
      info.textContent = `${dmFormatTs(c.ts)}　${c.message}　（追加${cnt.add}／変更${cnt.mod}／削除${cnt.del}）`;
      const detail = document.createElement("details");
      const sm = document.createElement("summary"); sm.textContent = "変更した項目";
      detail.appendChild(sm);
      Object.keys(c.changes).slice(0, 200).forEach(ik => {
        const ch = c.changes[ik];
        const line = document.createElement("div");
        line.className = "dm-auto-row";
        line.textContent = `${{ add: "追加", mod: "変更", del: "削除" }[ch.op]}：${dmItemTitle(ik, ch.b !== undefined ? ch.b : ch.a)}`;
        detail.appendChild(line);
      });
      const revert = document.createElement("button");
      revert.type = "button"; revert.className = "devmode-btn"; revert.textContent = i === 0 ? "（最新）" : "この時点に戻す";
      revert.disabled = i === 0;
      revert.onclick = async () => {
        const ok = await showGameConfirm(`${dmFormatTs(c.ts)} の時点に戻します。今の状態は先に自動コミットされるので、あとで戻せます。よろしいですか？`);
        if (!ok) return;
        const done = await dmRevertTo(c.id);
        await showGameAlert(done ? "戻しました。" : "戻せませんでした。");
        refreshHistory();
      };
      row.appendChild(info); row.appendChild(detail); row.appendChild(revert);
      hist.appendChild(row);
    });
    if (list.length > 40) { const more = document.createElement("div"); more.className = "devmode-note"; more.textContent = `…ほか${list.length - 40}件（古い履歴）`; hist.appendChild(more); }
  }
  wrap.querySelector(".dm-commit-btn").onclick = async () => {
    const msgEl = wrap.querySelector(".dm-msg");
    const c = await dmCommit(msgEl.value.trim() || "手動コミット", "manual");
    msgEl.value = "";
    await showGameAlert(c ? `コミットしました（${c.n}件の変更）。` : "前回のコミットから変更はありません。");
    refreshHistory();
  };
  wrap.querySelector(".dm-repo-btn").onclick = async () => {
    const s = (typeof window !== "undefined") ? window.SCENARIOBUILD_IMPORTED_SETTINGS_DATA : null;
    const c = (typeof window !== "undefined") ? window.SCENARIOBUILD_IMPORTED_SCENARIO_DATA : null;
    if (!s && !c) { await showGameAlert("読み込み済みのJSファイルがありません。"); return; }
    if (c) await dmMergeExternal("scenario", c, "repo", "リポジトリのJS");
    if (s) await dmMergeExternal("settings", s, "repo", "リポジトリのJS");
    refreshHistory();
  };
  wrap.querySelector(".dm-file").onchange = (ev) => {
    const file = ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      let parsed;
      try { parsed = dmParseExportedJs(String(reader.result)); } catch (e) { await showGameAlert("書き出しファイル（scenario_only_data.js／game_settings_data.js）の形式ではありません。"); return; }
      await dmMergeExternal(parsed.domain, parsed.data, "import", `ファイル「${file.name}」`);
      refreshHistory();
    };
    reader.readAsText(file);
  };
  // ☁ クラウド欄（datamerge_cloud.js。段階2）
  if (typeof renderDataMergeCloudSection === "function") {
    const cloudHost = document.createElement("div");
    renderDataMergeCloudSection(cloudHost, refreshHistory);
    wrap.insertBefore(cloudHost, hist);
  }
  refreshHistory();
}
