// cloudsave.js
// Googleアカウントでログイン中は、セーブデータ（手動セーブ全20枠）とオートセーブデータ（全3枠）を
// localStorageではなくFirestoreへ保存・読み込みする。
// ・未ログイン時：今まで通りlocalStorageのみに保存（キャッシュ保存のみ）
// ・ログイン時　：Firestoreにのみ保存・読み込み（localStorageは使わない）
//
// Firestoreのドキュメント構成： users/{uid} という1つのドキュメントに、
//   saveSlots: { "1": {...}, "2": {...}, ..., "20": {...} }  … 手動セーブ20枠
//   autoSaves: { timer: {...}, prechapter: {...}, onclose: {...} } … オートセーブ3枠
// をまとめて持たせる。個別のスロットを更新する時は、他のスロットを巻き込まないよう
// ドット記法のフィールドパス（例："saveSlots.3"）を使ったupdate()で1枠だけ更新する。
//
// ★要望対応：Googleアカウントにセーブデータ(全スロット)とオートセーブデータ(全スロット)を常時保存

let cloudSaveCache = null;   // ★ログイン中のみ使う：{ saveSlots: {...}, autoSaves: {...} }
let cloudSaveReady = false;  // ★ログイン中の場合、上のキャッシュの読み込みが完了したかどうか

function isCloudSaveActive() {
  return !!(typeof currentUser !== "undefined" && currentUser); // auth.js（ログイン中はクラウドのみ、未ログインはローカルのみ）
}

function getFirestoreDb() {
  if (typeof firebase === "undefined" || !firebase.firestore) return null;
  try {
    return firebase.firestore();
  } catch (e) {
    console.error("Firestoreの初期化に失敗しました", e);
    return null;
  }
}

// ★ログイン状態が変わるたびに auth.js の onAuthStateChanged から呼ぶ（ログイン時は完了までawaitされる）
async function refreshCloudSaveCache() {
  cloudSaveReady = false;
  if (!currentUser) {
    cloudSaveCache = null; // ★ログアウト時はキャッシュを破棄（このブラウザ上に前のアカウントのデータを残さないため）
    cloudSaveReady = true;
    return;
  }
  const db = getFirestoreDb();
  if (!db) {
    console.error("Firestoreが利用できないため、クラウドセーブは動作しません");
    cloudSaveCache = { saveSlots: {}, autoSaves: {} };
    cloudSaveReady = true;
    return;
  }
  try {
    const doc = await db.collection("users").doc(currentUser.uid).get();
    if (doc.exists) {
      const d = doc.data() || {};
      cloudSaveCache = { saveSlots: d.saveSlots || {}, autoSaves: d.autoSaves || {} };
    } else {
      // ★このアカウントでのクラウド初回利用：ローカルに残っているセーブデータがあれば、
      //   消えてしまったように見えないよう一度だけそのままクラウドへコピーしておく
      cloudSaveCache = await migrateLocalSavesToCloud(db);
    }
  } catch (e) {
    console.error("クラウドセーブデータの読み込みに失敗しました", e);
    cloudSaveCache = { saveSlots: {}, autoSaves: {} };
    if (typeof showGameAlert === "function") showGameAlert("クラウドセーブの読み込みに失敗しました。通信状態を確認してください。（このまま進めることもできますが、セーブ/ロードが正しく動作しない可能性があります）");
  }
  cloudSaveReady = true;
}

// ★このアカウントでクラウドドキュメントが存在しなかった時、ローカル(localStorage)に残っている
//   手動セーブ・オートセーブをそのままFirestoreへコピーする（初回ログイン時の救済措置）
async function migrateLocalSavesToCloud(db) {
  const saveSlots = {};
  for (let i = 1; i <= MAX_SAVE_SLOTS; i++) { // convenience.js
    const raw = localStorage.getItem(SAVE_KEY_PREFIX + i); // convenience.js
    if (raw) { try { saveSlots[i] = JSON.parse(raw); } catch (e) { /* 壊れたデータは移行しない */ } }
  }
  const autoSaves = {};
  Object.keys(AUTOSAVE_KEYS).forEach(slotType => { // settings.js
    const raw = localStorage.getItem(AUTOSAVE_KEYS[slotType]); // settings.js
    if (raw) { try { autoSaves[slotType] = JSON.parse(raw); } catch (e) { /* 壊れたデータは移行しない */ } }
  });
  try {
    await db.collection("users").doc(currentUser.uid).set({ saveSlots, autoSaves });
  } catch (e) {
    console.error("ローカルセーブデータのクラウドへの移行に失敗しました", e);
  }
  return { saveSlots, autoSaves };
}

// ===== 手動セーブ（20枠）：convenience.jsから使う =====

function cloudGetSaveSlotData(slotIndex) {
  if (!cloudSaveCache) return null;
  return cloudSaveCache.saveSlots[slotIndex] || null;
}

async function cloudSetSaveSlotData(slotIndex, data) {
  if (!currentUser) return false;
  if (!cloudSaveCache) cloudSaveCache = { saveSlots: {}, autoSaves: {} };
  cloudSaveCache.saveSlots[slotIndex] = data; // ★表示の即時性のため、先にキャッシュへ反映しておく
  const db = getFirestoreDb();
  if (!db) return false;
  try {
    // ★ドット記法のフィールドパスで、このスロットだけをピンポイントに更新する（他のスロットは巻き込まない）
    await db.collection("users").doc(currentUser.uid).update({ [`saveSlots.${slotIndex}`]: data });
    return true;
  } catch (e) {
    console.error(`クラウドへのセーブ（No.${slotIndex}）に失敗しました`, e);
    return false;
  }
}

// ===== オートセーブ（3枠）：settings.jsから使う =====

function cloudGetAutoSaveSlotData(slotType) {
  if (!cloudSaveCache) return null;
  return cloudSaveCache.autoSaves[slotType] || null;
}

async function cloudSetAutoSaveSlotData(slotType, data) {
  if (!currentUser) return false;
  if (!cloudSaveCache) cloudSaveCache = { saveSlots: {}, autoSaves: {} };
  cloudSaveCache.autoSaves[slotType] = data;
  const db = getFirestoreDb();
  if (!db) return false;
  try {
    await db.collection("users").doc(currentUser.uid).update({ [`autoSaves.${slotType}`]: data });
    return true;
  } catch (e) {
    console.error(`クラウドへのオートセーブ（${slotType}）に失敗しました`, e);
    return false;
  }
}
