// publicdata.js
// ★要望対応：開発者が「公開」ボタンを押すと、最新のゲームデータがクラウド（Firestore）に置かれ、
//   プレイヤーは何も操作せず、自動的にそれを受け取って遊べるようにする。
//   （JSファイルの書き出し→GitHubへコミット→デプロイ、の手順が要らなくなる）
//
// ■ 全体の流れ
//   ［開発者］データ管理タブの「🚀 プレイヤーに公開」
//        → コレクション publicdata の main（メタ情報：rev・日時・更新者・分割数）と
//          main_c0, main_c1…（データ本体のJSONを分割したもの）へ書き込む
//          ※中身は、JSファイルの書き出し（scenario_only_data.js／game_settings_data.js）と同じデータ
//   ［プレイヤー］ゲームを起動するたびに、裏で（待たずに）メタ1件だけを読んで、更新があれば本体を取得し、
//        この端末のIndexedDBに保存しておく。そして、取得したデータを使うのは「次回の起動から」。
//        （プレイ中に内容が変わらない／起動を待たせない）
//        → 起動時に、保存してあるデータを window.SCENARIOBUILD_IMPORTED_*_DATA に差し込む。
//          その後は、これまでのJSファイルと同じ取り込みの仕組み（scenariobuild.js の
//          checkDataFileVersionAndConfirm など）が、開発者以外には確認なしで自動的に反映する
//   ［保険］クラウドが読めない時（オフライン・障害・まだ一度も公開していない）は、
//        index.html に読み込んであるJS（scenario_only_data.js／game_settings_data.js）のまま動く。
//        クラウドのデータがある時は、JSよりクラウドを優先する
//   ［対象外］開発者アカウントでログイン中は、プレイヤー向けの取得・差し替えをしない（自分の編集データを守るため）
//
// ■ Firestoreのセキュリティルールに、次の許可を追加してください（Firebaseコンソール→Firestore→ルール）。
//   追加しないと、公開もプレイヤーの取得もできません（他のデータには影響しません）。
//   メールは auth.js の DEVELOPER_EMAILS と同じものにしてください。
//   ※ゲームのデータはもともとJSファイルとして誰でも読める形で配信されているので、読み取りを全員に許可しても、
//     新しく公開される情報はありません。書き込みだけは、開発者のメールに限ります。
//
//   match /publicdata/{docId} {
//     allow read: if true;
//     allow write: if request.auth != null
//       && request.auth.token.email_verified == true
//       && request.auth.token.email in ["merrynyan1023@gmail.com", "2025043@buntoku-h.ed.jp"];
//   }

const PUBLIC_DATA_COLLECTION = "publicdata";
const PUBLIC_DATA_HISTORY_DOC = "history";   // ★公開の履歴（バージョン番号・日時・コメント）を置くドキュメント
const PUBLIC_DATA_HISTORY_MAX = 50;          // ★履歴に残す件数（古いものから消える）
const PUBLIC_DATA_NOTE_MAX = 200;            // ★コメントの最大文字数
const PUBLIC_DATA_CHUNK_CHARS = 250000; // 日本語は1文字最大3バイト＝約750KB。1MiBの上限に余裕を持たせる（devdataと同じ）
const PUBLIC_DATA_IDB_NAME = "demoge_publicdata";
const PUBLIC_DATA_IDB_STORE = "kv";
const PUBLIC_DATA_CACHE_KEY = "cache";

function publicDataDb() {
  return (typeof getFirestoreDb === "function") ? getFirestoreDb() : null; // cloudsave.js
}
async function publicDataAuthReady() {
  if (typeof authReadyPromise !== "undefined") await authReadyPromise; // auth.js：ログイン状態が確定するまで待つ
}
function publicDataIsDeveloper() {
  return (typeof isDeveloperAccount === "function") && isDeveloperAccount(); // auth.js
}
function publicDataErrorText(e) {
  if (e && (e.code === "permission-denied" || /permission/i.test(String(e.message)))) {
    return "権限がありません。FirebaseコンソールのFirestoreルールに publicdata の許可を追加してください（publicdata.js の冒頭にルールの例があります）。";
  }
  return "クラウドとの通信に失敗しました：" + (e && e.message ? e.message : e);
}

// ===================================================================
// ===== 開発者側：プレイヤーに公開 =====
// ===================================================================

// 公開するデータ。JSファイルの書き出しと同じ中身を、「話・キャラ」「基本設定」の2つに分けて持つ
// （プレイヤー側は、それぞれ今までのJSファイルと同じ形で取り込む）
function publicDataBuildPayload(ts) {
  const scenario = buildScenarioOnlyExportData();   // scenariobuild.js
  const settings = buildGameSettingsExportData();   // scenariobuild.js
  scenario.version = ts;
  settings.version = ts;
  return { version: ts, scenario, settings };
}

// 中身がほぼ空のデータを公開してしまい、全プレイヤーのデータが消える事故を防ぐための確認
function publicDataLooksEmpty(payload) {
  const n = (a) => (Array.isArray(a) ? a.length : 0);
  return n(payload.scenario.chapters) === 0 && n(payload.scenario.characters) === 0
    && n(payload.settings.enemies) === 0 && n(payload.settings.items) === 0;
}

async function publicDataGetMeta() {
  const snap = await publicDataDb().collection(PUBLIC_DATA_COLLECTION).doc("main").get();
  return snap.exists ? snap.data() : null;
}

async function publicDataGetHistory() {
  const snap = await publicDataDb().collection(PUBLIC_DATA_COLLECTION).doc(PUBLIC_DATA_HISTORY_DOC).get();
  return snap.exists && Array.isArray(snap.data().list) ? snap.data().list : [];
}

async function publicDataPublish(note) {
  note = String(note || "").trim().slice(0, PUBLIC_DATA_NOTE_MAX); // ★管理者向けのコメント（任意）
  await publicDataAuthReady();
  if (!publicDataIsDeveloper()) { await showGameAlert("開発者アカウントでGoogleログインしている時だけ使えます。"); return false; }
  const db = publicDataDb();
  if (!db) { await showGameAlert("Firestoreが利用できません。"); return false; }
  try {
    const ts = Date.now();
    const payload = publicDataBuildPayload(ts);
    if (publicDataLooksEmpty(payload)) {
      await showGameAlert("話・キャラ・敵・アイテムがすべて空のため、公開しません（全プレイヤーのデータが空になってしまうのを防ぐためです）。");
      return false;
    }
    const text = JSON.stringify(payload);
    const counts = `話${payload.scenario.chapters.length}／キャラ${payload.scenario.characters.length}／敵${(payload.settings.enemies || []).length}／アイテム${(payload.settings.items || []).length}／技${(payload.settings.skills || []).length}`;
    const ok = await showGameConfirm(`今のデータ（保存していない変更も含む、エディタ上の内容）を、全プレイヤーに公開します。\n（${counts}／約${Math.round(text.length / 1000)}KB）\nコメント：${note || "（なし）"}\nプレイヤーには、次にゲームを起動した時から反映されます。よろしいですか？`);
    if (!ok) return false;

    const chunks = [];
    for (let i = 0; i < text.length; i += PUBLIC_DATA_CHUNK_CHARS) chunks.push(text.slice(i, i + PUBLIC_DATA_CHUNK_CHARS));
    const col = db.collection(PUBLIC_DATA_COLLECTION);
    // 1つのトランザクションで書く＝プレイヤーが「半分だけ新しい」データを読むことがない。
    // 各チャンクにもrevを持たせ、プレイヤー側で、メタと同じrevのチャンクだけが揃っているかを確かめる
    const by = (typeof currentUser !== "undefined" && currentUser && currentUser.email) || ""; // auth.js
    const newRev = await db.runTransaction(async tx => {
      const snap = await tx.get(col.doc("main"));
      const histSnap = await tx.get(col.doc(PUBLIC_DATA_HISTORY_DOC));
      const cur = snap.exists ? snap.data() : null;
      const rev = (cur ? Number(cur.rev) || 0 : 0) + 1;   // ★バージョン番号は、公開するたびに自動で+1される
      chunks.forEach((c, i) => tx.set(col.doc("main_c" + i), { i, rev, text: c }));
      const oldCount = cur ? Number(cur.chunks) || 0 : 0;
      for (let i = chunks.length; i < oldCount; i++) tx.delete(col.doc("main_c" + i));
      tx.set(col.doc("main"), { rev, ts, chunks: chunks.length, chars: text.length, by, note });
      // ★公開の履歴（新しい順）。バージョン・日時・更新者・コメント・中身の件数を残す
      const oldList = histSnap.exists && Array.isArray(histSnap.data().list) ? histSnap.data().list : [];
      const entry = { rev, ts, by, note, counts };
      tx.set(col.doc(PUBLIC_DATA_HISTORY_DOC), { list: [entry].concat(oldList).slice(0, PUBLIC_DATA_HISTORY_MAX) });
      return rev;
    });
    await showGameAlert(`プレイヤーに公開しました（バージョン ${newRev}）。次にゲームを起動した時から反映されます。`);
    return true;
  } catch (e) {
    console.error("公開に失敗しました", e);
    await showGameAlert(publicDataErrorText(e));
    return false;
  }
}

// データ管理タブに出す欄
function renderPublicDataSection(container) {
  const wrap = document.createElement("div");
  wrap.className = "dm-section";
  wrap.innerHTML = `<h4 class="scenariobuild-subheading">🚀 プレイヤーへの公開（自動配信）</h4>
    <p class="devmode-note">押すと、今のデータ（話・キャラ・敵・アイテムなど、JSファイルの書き出しと同じ内容）が全プレイヤーに公開されます。プレイヤーは何も操作せず、<b>次にゲームを起動した時</b>から最新のデータで遊べます（JSファイルの書き出し・デプロイは不要です。クラウドが読めない時は、これまでどおりJSファイルのデータで動きます）。上の「☁ クラウドで同期」（開発者どうしの作業用）とは別の場所に置かれます。</p>
    <div class="dm-row"><input type="text" class="dm-msg dm-public-note" maxlength="${PUBLIC_DATA_NOTE_MAX}" placeholder="公開コメント（任意。例：第六話追加・戦闘バランス調整）"></div>
    <div class="dm-row"><button type="button" class="devmode-btn dm-public-btn">🚀 プレイヤーに公開</button></div>
    <div class="devmode-note dm-public-status">状態を確認中…</div>
    <div class="dm-public-history"></div>`;
  container.appendChild(wrap);
  const status = wrap.querySelector(".dm-public-status");
  const btn = wrap.querySelector(".dm-public-btn");
  const noteInput = wrap.querySelector(".dm-public-note");
  const histEl = wrap.querySelector(".dm-public-history");
  const fmtTime = (ts) => ts ? new Date(Number(ts)).toLocaleString("ja-JP") : "?";
  async function refreshStatus() {
    await publicDataAuthReady();
    if (!publicDataIsDeveloper()) { status.textContent = "開発者アカウントでGoogleログインしている時だけ使えます。"; btn.disabled = true; noteInput.disabled = true; return; }
    if (!publicDataDb()) { status.textContent = "Firestoreが利用できません。"; btn.disabled = true; noteInput.disabled = true; return; }
    try {
      const meta = await publicDataGetMeta();
      status.textContent = meta
        ? `現在公開中：バージョン ${meta.rev}（${fmtTime(meta.ts)}／${meta.by || "?"}）　コメント：${meta.note || "（なし）"}`
        : "まだ一度も公開していません。";
    } catch (e) { status.textContent = publicDataErrorText(e); }
    try {
      const list = await publicDataGetHistory();
      histEl.innerHTML = "";
      if (list.length === 0) return;
      const det = document.createElement("details");
      const sum = document.createElement("summary");
      sum.textContent = `公開の履歴（直近${list.length}件）`;
      det.appendChild(sum);
      list.forEach(h => {
        const row = document.createElement("div");
        row.className = "dm-hist-row";
        const info = document.createElement("div");
        info.className = "dm-hist-info";
        info.textContent = `バージョン ${h.rev}｜${fmtTime(h.ts)}｜${h.by || "?"}\n${h.note || "（コメントなし）"}${h.counts ? "\n" + h.counts : ""}`;
        info.style.whiteSpace = "pre-wrap";
        row.appendChild(info);
        det.appendChild(row);
      });
      histEl.appendChild(det);
    } catch (e) { /* 履歴が読めなくても、公開自体には影響しない */ }
  }
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const done = await publicDataPublish(noteInput.value);
      if (done) noteInput.value = "";
    } finally { btn.disabled = false; }
    refreshStatus();
  };
  refreshStatus();
}

// ===================================================================
// ===== プレイヤー側：裏で取得して端末に保存 → 次回の起動から使う =====
// ===================================================================
// 保存先はIndexedDB（ゲームのデータはlocalStorageにも同じ規模で入っているため、容量の上限に余裕のある方へ置く）

function publicDataIdbOpen() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDBが使えません")); return; }
    const req = indexedDB.open(PUBLIC_DATA_IDB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(PUBLIC_DATA_IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function publicDataIdb(mode, fn) {
  const db = await publicDataIdbOpen();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(PUBLIC_DATA_IDB_STORE, mode);
      const req = fn(tx.objectStore(PUBLIC_DATA_IDB_STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
const publicDataCacheGet = () => publicDataIdb("readonly", s => s.get(PUBLIC_DATA_CACHE_KEY));
const publicDataCachePut = (value) => publicDataIdb("readwrite", s => s.put(value, PUBLIC_DATA_CACHE_KEY));
const publicDataCacheDelete = () => publicDataIdb("readwrite", s => s.delete(PUBLIC_DATA_CACHE_KEY));

// 取得したデータの形が、取り込める形か（壊れたデータ・途中までのデータを保存しないため）
function publicDataIsValidPayload(p) {
  return !!(p && typeof p === "object"
    && p.scenario && Array.isArray(p.scenario.chapters) && Array.isArray(p.scenario.characters) && p.scenario.version != null
    && p.settings && Array.isArray(p.settings.enemies) && Array.isArray(p.settings.items) && p.settings.version != null);
}

// 起動の最初（最初のloadCustomScenarioDataより前）に呼ぶ：保存してあるクラウドのデータがあれば、
// JSファイルの代わりに差し込む（＝クラウド優先）。開発者アカウントのときは何もしない
async function publicDataApplyCachedOverride() {
  try {
    const cached = await publicDataCacheGet();
    if (!cached || !publicDataIsValidPayload(cached.data)) return false;   // 保存が無い・壊れている→JSのまま（保険）
    await publicDataAuthReady();
    if (publicDataIsDeveloper()) return false;
    window.SCENARIOBUILD_IMPORTED_SCENARIO_DATA = cached.data.scenario;
    window.SCENARIOBUILD_IMPORTED_SETTINGS_DATA = cached.data.settings;
    return true;
  } catch (e) {
    console.warn("保存してある公開データの読み込みに失敗しました（JSファイルのデータで続行します）", e);
    return false;
  }
}

// 起動したあと、待たずに裏で呼ぶ：クラウドに新しい公開があれば取得して、端末に保存する（反映は次回の起動から）
// 通信できない・権限が無い・途中までしか無い等の時は、何も表示せず、今のデータのまま続ける
async function publicDataRefreshInBackground() {
  try {
    await publicDataAuthReady();
    if (publicDataIsDeveloper()) { await publicDataCacheDelete().catch(() => {}); return false; }   // 開発者には、プレイヤー向けの保存を残さない
    const db = publicDataDb();
    if (!db) return false;
    const col = db.collection(PUBLIC_DATA_COLLECTION);
    const metaSnap = await col.doc("main").get();   // 毎回の読み取りは、これ1件だけ
    if (!metaSnap.exists) return false;
    const meta = metaSnap.data();
    const rev = Number(meta.rev) || 0;
    const cached = await publicDataCacheGet().catch(() => null);
    if (cached && Number(cached.rev) === rev) return false;   // 取得済みと同じ→何もしない
    const count = Number(meta.chunks) || 0;
    if (count <= 0) return false;
    const snaps = await Promise.all(Array.from({ length: count }, (_, i) => col.doc("main_c" + i).get()));
    if (snaps.some(s => !s.exists || Number(s.data().rev) !== rev)) {
      console.warn("公開データが更新の途中でした。次回の起動時にもう一度取得します。");
      return false;
    }
    const text = snaps.sort((a, b) => a.data().i - b.data().i).map(s => s.data().text).join("");
    const data = JSON.parse(text);
    if (!publicDataIsValidPayload(data)) { console.warn("公開データの形式が正しくないため、保存しませんでした。"); return false; }
    await publicDataCachePut({ rev, ts: Number(meta.ts) || data.version, data, savedAt: Date.now() });
    return true;
  } catch (e) {
    console.warn("公開データの確認に失敗しました（今のデータのまま続行します）", e);
    return false;
  }
}
