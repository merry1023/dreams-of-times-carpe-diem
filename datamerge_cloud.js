// datamerge_cloud.js
// ★要望対応：git風データ管理の段階2。Firestoreに、開発者アカウント専用の「最新データ（main）」を1つ置き、
//   エディタ内だけで Pull（取り込み＝3-wayマージ）／Push（反映）できるようにする。
//   ・保存先：コレクション devdata の  main（メタ情報：rev・更新日時・更新者・チャンク数）と  main_c0, main_c1…（データ本体を分割したもの）
//     1ドキュメント1MiBの上限があるので、JSON文字列を一定の長さで分割して持つ。更新チェックはメタ1件の読み取りだけで済む
//   ・Push：クラウドのrevが、このブラウザが最後に同期したrevと同じ時だけ可能（gitの「先にpullしてください」と同じ）
//   ・Pull：クラウドのデータを「相手」として、datamerge.js のマージ（自分｜共通の土台｜相手）にかける
//   ・エディタを開いた時に、クラウドに更新があれば画面下にお知らせを出す（取り込みは手動）
//
// ★Firestoreのセキュリティルールに、次の許可を追加してください（Firebaseコンソール→Firestore→ルール）。
//   追加しないと devdata は読み書きできません（他のデータには影響しません）。メールは auth.js の DEVELOPER_EMAILS と同じものにしてください。
//
//   match /devdata/{docId} {
//     allow read, write: if request.auth != null
//       && request.auth.token.email_verified == true
//       && request.auth.token.email in ["merrynyan1023@gmail.com", "2025043@buntoku-h.ed.jp"];
//   }

const DM_CLOUD_COLLECTION = "devdata";
const DM_CLOUD_CHUNK_CHARS = 250000; // 日本語は1文字最大3バイト＝約750KB。1MiBの上限に余裕を持たせる

function dmCloudDb() {
  return (typeof getFirestoreDb === "function") ? getFirestoreDb() : null; // cloudsave.js
}
async function dmCloudReady() {
  if (typeof authReadyPromise !== "undefined") await authReadyPromise; // auth.js
  if (typeof isDeveloperAccount !== "function" || !isDeveloperAccount()) return { ok: false, reason: "開発者アカウントでGoogleログインしている時だけ使えます。" };
  if (!dmCloudDb()) return { ok: false, reason: "Firestoreが利用できません。" };
  return { ok: true };
}
function dmCloudErrorText(e) {
  if (e && (e.code === "permission-denied" || /permission/i.test(String(e.message)))) {
    return "権限がありません。FirebaseコンソールのFirestoreルールに devdata の許可を追加してください（datamerge_cloud.js の冒頭にルールの例があります）。";
  }
  return "クラウドとの通信に失敗しました：" + (e && e.message ? e.message : e);
}
async function dmCloudGetLocalRev() { const r = await dmMetaGet("cloudrev"); return r ? Number(r.rev) || 0 : 0; }
async function dmCloudSetLocalRev(rev) { await dmMetaPut("cloudrev", { rev: Number(rev) || 0, ts: Date.now() }); }
async function dmCloudGetMeta() {
  const snap = await dmCloudDb().collection(DM_CLOUD_COLLECTION).doc("main").get();
  return snap.exists ? snap.data() : null;
}

// 今のscenarioProjectのうち、管理対象のキーだけを取り出したデータ（JSONで保存できる形）
function dmCloudBuildData(version) {
  const data = { version };
  DM_ALL_KEYS.forEach(k => { if (scenarioProject[k] !== undefined) data[k] = scenarioProject[k]; });
  return data;
}

// ===== Push =====
async function dmCloudPush() {
  const ready = await dmCloudReady();
  if (!ready.ok) { await showGameAlert(ready.reason); return false; }
  try {
    const localRev = await dmCloudGetLocalRev();
    const meta0 = await dmCloudGetMeta();
    if (meta0 && Number(meta0.rev) !== localRev) {
      await showGameAlert("クラウドに、このブラウザがまだ取り込んでいない更新があります（rev " + meta0.rev + "）。先に「Pull（クラウドから取り込む）」でマージしてからPushしてください。");
      return false;
    }
    const ok = await showGameConfirm("今のデータ（保存していない変更も含む、エディタ上の内容）をクラウドの最新データ（main）へ反映します。よろしいですか？");
    if (!ok) return false;
    await dmCommit("Push前の自動コミット", "auto");
    const ts = Date.now();
    const data = dmCloudBuildData(ts);
    const text = JSON.stringify(data);
    const chunks = [];
    for (let i = 0; i < text.length; i += DM_CLOUD_CHUNK_CHARS) chunks.push(text.slice(i, i + DM_CLOUD_CHUNK_CHARS));
    const db = dmCloudDb();
    const col = db.collection(DM_CLOUD_COLLECTION);
    const newRev = await db.runTransaction(async tx => {
      const snap = await tx.get(col.doc("main"));
      const cur = snap.exists ? snap.data() : null;
      if (cur && Number(cur.rev) !== localRev) throw new Error("REV_MISMATCH");
      const rev = (cur ? Number(cur.rev) : 0) + 1;
      chunks.forEach((c, i) => tx.set(col.doc("main_c" + i), { i, text: c }));
      const oldCount = cur ? Number(cur.chunks) || 0 : 0;
      for (let i = chunks.length; i < oldCount; i++) tx.delete(col.doc("main_c" + i));
      tx.set(col.doc("main"), {
        rev, ts, chunks: chunks.length, chars: text.length,
        by: (currentUser && currentUser.email) || "", // auth.js
        note: "Push"
      });
      return rev;
    });
    await dmCloudSetLocalRev(newRev);
    // クラウドの内容＝今の内容になったので、その時点を共通の土台にする（話・キャラ／基本設定の両方）
    await dmMarkSynced("cloud", "scenario", data);
    await dmMarkSynced("cloud", "settings", data);
    await dmCommit(`Push（クラウド rev ${newRev}）`, "push");
    await showGameAlert(`クラウドへ反映しました（rev ${newRev}）。`);
    dmCloudHideBanner();
    return true;
  } catch (e) {
    console.error("Pushに失敗しました", e);
    if (e && e.message === "REV_MISMATCH") await showGameAlert("Pushの直前にクラウドが更新されました。もう一度「Pull」でマージしてからPushしてください。");
    else await showGameAlert(dmCloudErrorText(e));
    return false;
  }
}

// ===== Pull =====
async function dmCloudFetchData() {
  const meta = await dmCloudGetMeta();
  if (!meta) return { meta: null, data: null };
  const col = dmCloudDb().collection(DM_CLOUD_COLLECTION);
  const snaps = await Promise.all(Array.from({ length: Number(meta.chunks) || 0 }, (_, i) => col.doc("main_c" + i).get()));
  if (snaps.some(s => !s.exists)) throw new Error("クラウドのデータが途中までしかありません（Pushの途中だった可能性があります。少し待ってからもう一度お試しください）");
  const text = snaps.sort((a, b) => a.data().i - b.data().i).map(s => s.data().text).join("");
  const data = JSON.parse(text);
  data.version = Number(meta.ts) || data.version;
  return { meta, data };
}
async function dmCloudPull() {
  const ready = await dmCloudReady();
  if (!ready.ok) { await showGameAlert(ready.reason); return false; }
  try {
    const { meta, data } = await dmCloudFetchData();
    if (!meta) { await showGameAlert("クラウドにはまだデータがありません。「Push」で最初のデータを置いてください。"); return false; }
    const label = `☁クラウド（rev ${meta.rev}）`;
    const r1 = await dmMergeExternal("scenario", data, "cloud", label, true);
    if (!r1) return false;
    const r2 = await dmMergeExternal("settings", data, "cloud", label, true);
    if (!r2) return false;
    await dmCloudSetLocalRev(meta.rev);
    dmCloudHideBanner();
    await showGameAlert(`${label}との同期が完了しました。`);
    return true;
  } catch (e) {
    console.error("Pullに失敗しました", e);
    await showGameAlert(dmCloudErrorText(e));
    return false;
  }
}

// ===== エディタを開いた時の更新お知らせ =====
function dmCloudHideBanner() { const el = document.getElementById("dm-cloud-banner"); if (el) el.remove(); }
async function dmCloudCheckOnOpen() {
  try {
    const ready = await dmCloudReady();
    if (!ready.ok) return;
    const meta = await dmCloudGetMeta(); // 読み取りはメタ1件だけ
    const localRev = await dmCloudGetLocalRev();
    if (!meta || Number(meta.rev) <= localRev) return;
    const ov = document.getElementById("scenariobuild-overlay");
    if (!ov || ov.classList.contains("hidden")) return;
    dmCloudHideBanner();
    const bar = document.createElement("div");
    bar.id = "dm-cloud-banner";
    bar.className = "dm-cloud-banner";
    const when = meta.ts ? dmFormatTs(meta.ts) : "";
    const msg = document.createElement("span");
    msg.textContent = `☁ クラウドに更新があります（rev ${meta.rev}${when ? "／" + when : ""}${meta.by ? "／" + meta.by : ""}）`;
    const pull = document.createElement("button");
    pull.type = "button"; pull.className = "dm-btn dm-btn-main"; pull.textContent = "Pull（マージして取り込む）";
    pull.onclick = async () => { pull.disabled = true; await dmCloudPull(); };
    const later = document.createElement("button");
    later.type = "button"; later.className = "dm-btn"; later.textContent = "あとで";
    later.onclick = dmCloudHideBanner;
    bar.appendChild(msg); bar.appendChild(pull); bar.appendChild(later);
    ov.appendChild(bar);
  } catch (e) {
    console.warn("クラウドの更新確認に失敗しました（無視して続行）", e);
  }
}

// ===== データ管理タブのクラウド欄 =====
function renderDataMergeCloudSection(container, onChanged) {
  const wrap = document.createElement("div");
  wrap.className = "dm-section";
  wrap.innerHTML = `<h4 class="scenariobuild-subheading">☁ クラウド（Firestore）で同期</h4>
    <p class="devmode-note">開発者アカウント専用の「最新データ（main）」へ、エディタ内だけで反映・取り込みができます（GitHubへの同期は不要）。Pullは「自分｜共通の土台｜相手」のマージ画面を通ります。</p>
    <div class="dm-row"><button type="button" class="devmode-btn dm-cloud-pull">☁ Pull（クラウドから取り込む）</button><button type="button" class="devmode-btn dm-cloud-push">☁ Push（クラウドへ反映）</button></div>
    <div class="devmode-note dm-cloud-status">状態を確認中…</div>`;
  container.appendChild(wrap);
  const status = wrap.querySelector(".dm-cloud-status");
  const btns = wrap.querySelectorAll("button");
  (async () => {
    const ready = await dmCloudReady();
    if (!ready.ok) { status.textContent = ready.reason; btns.forEach(b => { b.disabled = true; }); return; }
    try {
      const meta = await dmCloudGetMeta();
      const localRev = await dmCloudGetLocalRev();
      status.textContent = meta
        ? `クラウド：rev ${meta.rev}（${meta.ts ? dmFormatTs(meta.ts) : "?"}／${meta.by || "?"}）　このブラウザの同期済み：rev ${localRev}${Number(meta.rev) > localRev ? "　→ 取り込めていない更新があります" : ""}`
        : "クラウドにはまだデータがありません。「Push」で最初のデータを置いてください。";
    } catch (e) { status.textContent = dmCloudErrorText(e); }
  })();
  wrap.querySelector(".dm-cloud-pull").onclick = async () => { await dmCloudPull(); if (onChanged) onChanged(); };
  wrap.querySelector(".dm-cloud-push").onclick = async () => { await dmCloudPush(); if (onChanged) onChanged(); };
}
