// auth.js
// Firebaseを使ったGoogleアカウント認証。
// ・メインメニューにログインボタンを表示し、誰でもGoogleアカウントでログイン/ログアウトできる。
// ・ログインしたアカウントが開発者アカウント（DEVELOPER_EMAILSに含まれるメール）の場合だけ、
//   本体のJSファイルが更新された時に「読み込みますか？」のはい/いいえ確認が入る。
// ・開発者アカウントでない/未ログインの場合は、確認なしで自動的に最新のJSファイルを強制的に反映する。
//
// ★要望対応（修正、バグ.txt <最優先>）

// ★開発者として扱うGoogleアカウントのメールアドレス一覧。
//   自分のGoogleアカウントのメールアドレスをここに追加してください（複数可）。
//   例: const DEVELOPER_EMAILS = ["merry1023@gmail.com"];
const DEVELOPER_EMAILS = [
  // ここにメールアドレスを追加
];

// ★本体JSファイルの現在のバージョン。コードを更新してこの確認機能を働かせたい時は、
//   このバージョン文字列を（数字を1増やす、日付にする、など何でもいいので）書き換えてください。
//   これを書き換えない限り「更新された」とは判定されません。
const APP_JS_VERSION = "1";
const APP_JS_VERSION_SEEN_KEY = "demoge_app_js_version_seen"; // ★このブラウザが最後に確認・反映したバージョン

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAlvzIrzg8mpcVpser24-MxLFcfdDL5oGQ",
  authDomain: "dreams-of-times-carpe-diem.firebaseapp.com",
  projectId: "dreams-of-times-carpe-diem",
  storageBucket: "dreams-of-times-carpe-diem.firebasestorage.app",
  messagingSenderId: "1065096682508",
  appId: "1:1065096682508:web:e070ad590d0a11ac66a229",
  measurementId: "G-2N5YV9B0H3"
};

let currentUser = null; // ★ログイン中のFirebaseユーザー（未ログインならnull）

// ★ページを開いた直後、Firebaseがログイン状態を確認し終わるまでを待つためのPromise
let resolveAuthReady;
const authReadyPromise = new Promise(resolve => { resolveAuthReady = resolve; });
let authReadyResolved = false;

(function initFirebaseAuth() {
  if (typeof firebase === "undefined" || !firebase.initializeApp) {
    console.error("Firebase SDKが読み込まれていません（auth.jsより前にfirebase-app-compat.js / firebase-auth-compat.jsを読み込む必要があります）");
    resolveAuthReady();
    authReadyResolved = true;
    return;
  }
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
  } catch (e) {
    console.error("Firebaseの初期化に失敗しました", e);
  }
  firebase.auth().onAuthStateChanged(user => {
    currentUser = user;
    if (typeof updateTitleScreenLoginButton === "function") updateTitleScreenLoginButton();
    // ★今まさに設定タブを見ている場合だけ再描画する（他のタブを見ている時に勝手に切り替えないため）
    const activeTab = document.querySelector('.tab-content.active');
    if (activeTab && activeTab.id === 'tab-setting' && typeof renderSettingsTab === "function") renderSettingsTab();
    if (!authReadyResolved) { authReadyResolved = true; resolveAuthReady(); }
  });
})();

// ★現在ログイン中のアカウントが開発者アカウントかどうか
function isDeveloperAccount() {
  return !!(currentUser && currentUser.email && DEVELOPER_EMAILS.includes(currentUser.email));
}

// ★Googleアカウントでログイン（タイトル画面のボタン・設定タブの行、どちらからも呼ぶ）
async function signInWithGoogle() {
  if (typeof firebase === "undefined" || !firebase.auth) return;
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await firebase.auth().signInWithPopup(provider);
  } catch (e) {
    console.error("Googleログインに失敗しました", e);
    if (typeof showGameAlert === "function") showGameAlert("ログインに失敗しました。もう一度お試しください。"); // mainfunc.js
  }
}

async function signOutOfGoogle() {
  if (typeof firebase === "undefined" || !firebase.auth) return;
  try {
    await firebase.auth().signOut();
  } catch (e) {
    console.error("ログアウトに失敗しました", e);
  }
}

// ===== タイトル画面のログインボタン（index.html: #title-screen-login-btn） =====

function updateTitleScreenLoginButton() {
  const btn = document.getElementById("title-screen-login-btn");
  if (!btn) return;
  if (currentUser) {
    btn.textContent = `👤 ${currentUser.displayName || currentUser.email || "ログイン中"}`;
    btn.title = "タップでログアウト";
  } else {
    btn.textContent = "👤 Googleでログイン";
    btn.title = "タップでログイン";
  }
}

// ★titlescreen.jsのsetupTitleScreen()から呼ぶ
function setupTitleScreenLoginButton() {
  const btn = document.getElementById("title-screen-login-btn");
  if (!btn) return;
  btn.onclick = (event) => {
    event.stopPropagation();
    if (currentUser) {
      signOutOfGoogle();
    } else {
      signInWithGoogle();
    }
  };
  updateTitleScreenLoginButton();
}

// ===== 設定タブ：「Googleアカウント」行（settings.jsのrenderSettingsTabから参照） =====

function getGoogleAccountSettingsRow() {
  if (currentUser) {
    const label = isDeveloperAccount() ? "Googleアカウント（開発者）" : "Googleアカウント";
    return { label, value: currentUser.email || "ログイン中", hint: "決定でログアウト" };
  }
  return { label: "Googleアカウント", value: "未ログイン", hint: "決定でログイン" };
}

function handleGoogleAccountSettingsDecide() {
  if (currentUser) {
    signOutOfGoogle();
  } else {
    signInWithGoogle();
  }
}

// ===== 本体JSファイルの更新確認 =====
// 開発者アカウント：バージョンが変わっていたら、はい/いいえで確認してから反映する
// それ以外（非開発者・未ログイン）：確認なしで自動的に最新バージョンを強制的に反映する

async function checkAppJsVersionAndConfirm() {
  await authReadyPromise; // ★ログイン状態が確定するまで待つ
  const seen = localStorage.getItem(APP_JS_VERSION_SEEN_KEY);
  if (seen === APP_JS_VERSION) return; // ★既にこのバージョンを認識済み

  if (seen === null) {
    // ★このブラウザで初めて開いた時は、比較対象が無いので確認なしでそのまま記録する
    localStorage.setItem(APP_JS_VERSION_SEEN_KEY, APP_JS_VERSION);
    return;
  }

  if (!isDeveloperAccount()) {
    // ★開発者アカウントでない/未ログイン：確認なしで自動的に最新を強制反映する
    localStorage.setItem(APP_JS_VERSION_SEEN_KEY, APP_JS_VERSION);
    location.href = location.pathname + "?_v=" + Date.now(); // ★キャッシュを避けて確実に最新を取得し直す
    return;
  }

  // ★開発者アカウント：はい/いいえの確認を挟む
  const message = `本体のJSファイルが更新されています（バージョン ${seen} → ${APP_JS_VERSION}）。\n最新の内容を読み込みますか？\n（「いいえ」を選ぶと、今回はこのまま続けます）`;
  const ok = (typeof showGameConfirm === "function") ? await showGameConfirm(message) : false; // mainfunc.js
  localStorage.setItem(APP_JS_VERSION_SEEN_KEY, APP_JS_VERSION); // ★はい/いいえどちらでも「確認済み」として記録し、毎回聞かれないようにする
  if (ok) location.href = location.pathname + "?_v=" + Date.now();
}
