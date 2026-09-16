// maintenance.js
// ★要望対応：メンテナンスモード
//
// シナリオビルドの「データ管理」タブにあるON/OFFの切り替えだけは、他の設定と違って
// JSファイル書き出し→index.htmlへの読み込みという手順を挟まず、Firestore（クラウド）の
// 設定ドキュメントに直接書き込む。これにより、切り替えた瞬間からサイト全体（全プレイヤー）に
// 反映される。
//
// 挙動：
// ・ONの間にセーブデータをロードすると、画面が真っ黒になり「ただ今メンテナンス中です。
//   メンテナンスが終わるまでお待ちください。」と表示され、操作できなくなる
// ・ただしログインボーナスだけは黒画面より手前に表示され、通常通り受け取れる
//   （受け取った記録は、その場でロードしたセーブデータへ自動的に上書き保存される。
//   通常プレイができないため、次回また同じ日に開いた時に二重に受け取れてしまわないよう）
//
// ・開発者アカウント（DEVELOPER_EMAILS）でログイン中は対象外。メンテナンス中でも
//   通常通りプレイでき、自分で動作確認ができる
//
// ★Firebaseコンソール側で以下のFirestoreセキュリティルールを設定してください
//  （Firebaseコンソール → Firestore Database → ルール）。
//  auth.jsのDEVELOPER_EMAILSと同じメールアドレスを並べてください：
//
//   match /siteConfig/{docId} {
//     allow read: if true; // ★誰でも状態を確認できるようにする（メンテナンス判定に必要）
//     allow write: if request.auth != null && request.auth.token.email in [
//       "merrynyan1023@gmail.com",
//       "2025043@buntoku-h.ed.jp"
//     ];
//   }

const MAINTENANCE_CONFIG_COLLECTION = "siteConfig";
const MAINTENANCE_CONFIG_DOC = "main";

// 現在のメンテナンス状態をFirestoreから取得する。
// ★通信障害・Firestore未初期化などで取得できなかった場合は「メンテナンス中ではない」として扱う
//   （判定に失敗しただけでプレイヤー全員を締め出してしまわないためのフェイルセーフ）
async function fetchMaintenanceModeEnabled() {
  try {
    if (typeof firebase === "undefined" || !firebase.firestore) return false;
    const doc = await firebase.firestore().collection(MAINTENANCE_CONFIG_COLLECTION).doc(MAINTENANCE_CONFIG_DOC).get();
    return !!(doc.exists && doc.data() && doc.data().maintenanceMode);
  } catch (e) {
    console.error("メンテナンス状態の確認に失敗しました", e);
    return false;
  }
}

// シナリオビルドの「データ管理」タブから呼ぶ：ON/OFFをFirestoreに書き込む。成否をboolで返す
// ★書き込みの可否自体はFirestore側のセキュリティルール（開発者アカウントのメールアドレスのみ許可）で守る想定。
//   ここでのcurrentUserチェックは、未ログイン時に無駄な通信を発生させないための事前チェック
async function setMaintenanceModeEnabled(enabled) {
  try {
    if (typeof firebase === "undefined" || !firebase.firestore) return false;
    if (typeof currentUser === "undefined" || !currentUser) return false; // auth.js
    await firebase.firestore().collection(MAINTENANCE_CONFIG_COLLECTION).doc(MAINTENANCE_CONFIG_DOC).set({
      maintenanceMode: !!enabled,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedByEmail: currentUser.email || null
    }, { merge: true });
    return true;
  } catch (e) {
    console.error("メンテナンス状態の更新に失敗しました", e);
    return false;
  }
}

// ===== 黒画面オーバーレイ（index.html: #maintenance-mode-overlay） =====

function showMaintenanceOverlay() {
  const overlay = document.getElementById("maintenance-mode-overlay");
  if (overlay) overlay.classList.remove("hidden");
}

// ★セーブデータをロードした時（convenience.jsのrestoreGameFromSaveData）に呼ぶ共通処理。
//   メンテナンス中なら黒画面を表示し、キー操作もロックした上でtrueを返す。
//   ただし開発者アカウント（auth.js DEVELOPER_EMAILS）でログイン中は、メンテナンス中でも
//   自分の動作確認ができるよう、黒画面にはせず通常通りプレイできるようにする
async function applyMaintenanceOverlayIfNeeded() {
  if (typeof authReadyPromise !== "undefined") await authReadyPromise; // auth.js：ログイン状態が確定してから判定する
  if (typeof isDeveloperAccount === "function" && isDeveloperAccount()) return false; // auth.js
  const enabled = await fetchMaintenanceModeEnabled();
  if (enabled) {
    showMaintenanceOverlay();
    isGameDialogOpen = true; // mainfunc.js（各種キー操作の入り口で共通チェックされているフラグを流用してロックする）
  }
  return enabled;
}
