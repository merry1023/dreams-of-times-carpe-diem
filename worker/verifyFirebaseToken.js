// worker/verifyFirebaseToken.js
// ★要望対応：仲間との会話（Gemini API連携）の回数制限をFirebaseアカウント単位で管理するため、
//   クライアントから送られてきたFirebase IDトークン（JWT）をサーバー側で検証してuidを取り出す。
//   （クライアントが自己申告するuidをそのまま信用すると、誰でも他人のふりをして回数制限を
//   すり抜けたり、逆に他人の回数を消費させたりできてしまうため、署名検証が必須）

const FIREBASE_PROJECT_ID = "dreams-of-times-carpe-diem"; // ★auth.js内のFIREBASE_CONFIG.projectIdと同じ値
const JWK_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let cachedJwks = null;
let cachedJwksExpiresAt = 0;

async function getGoogleJwks() {
  const now = Date.now();
  if (cachedJwks && now < cachedJwksExpiresAt) return cachedJwks;
  const res = await fetch(JWK_URL);
  if (!res.ok) throw new Error("Googleの公開鍵の取得に失敗しました");
  const data = await res.json();
  cachedJwks = data.keys || [];
  cachedJwksExpiresAt = now + 60 * 60 * 1000; // ★1時間キャッシュ（鍵はそう頻繁には変わらない）
  return cachedJwks;
}

function base64UrlToUint8Array(base64Url) {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "===".slice((base64.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeJson(base64Url) {
  const bytes = base64UrlToUint8Array(base64Url);
  return JSON.parse(new TextDecoder().decode(bytes));
}

// FirebaseのIDトークンを検証する。成功したら { uid } を返し、失敗したらnullを返す
export async function verifyFirebaseIdToken(idToken) {
  try {
    if (!idToken || typeof idToken !== "string") return null;
    const parts = idToken.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;
    const header = base64UrlDecodeJson(headerB64);
    const payload = base64UrlDecodeJson(payloadB64);

    const now = Math.floor(Date.now() / 1000);
    if (payload.aud !== FIREBASE_PROJECT_ID) return null;
    if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) return null;
    if (typeof payload.exp !== "number" || payload.exp < now) return null; // ★期限切れ
    if (typeof payload.iat !== "number" || payload.iat > now + 60) return null; // ★発行時刻が未来（改ざん対策）
    if (!payload.sub) return null;
    if (header.alg !== "RS256") return null;

    const jwks = await getGoogleJwks();
    const jwk = jwks.find(k => k.kid === header.kid);
    if (!jwk) return null;

    const cryptoKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signature = base64UrlToUint8Array(signatureB64);
    const isValid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, signature, signedData);
    if (!isValid) return null;

    return { uid: payload.sub };
  } catch (e) {
    console.error("Firebase IDトークンの検証に失敗しました", e);
    return null;
  }
}
