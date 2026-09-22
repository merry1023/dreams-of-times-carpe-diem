// ★要望対応：画像データと音楽データをキャッシュに保存し、次回以降は一瞬で開けるようにする
// サービスワーカーによるキャッシュファースト戦略。img/・bgm/ 以下や画像・音声の拡張子を持つ
// リクエストだけをキャッシュ対象にし、それ以外（JS・HTML本体など、更新頻度が高いファイル）は
// 通常通りネットワークから取得する（バージョン更新時に古いコードのまま固まってしまわないように）。

const CACHE_NAME = "carpe-diem-assets-v1";

// ★このキャッシュ対象にする拡張子（画像・音声）
const CACHEABLE_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg",
  ".mp3", ".ogg", ".wav", ".m4a",
];

function isCacheableRequest(request) {
  if (request.method !== "GET") return false;
  let pathname;
  try {
    pathname = new URL(request.url).pathname;
  } catch (e) {
    return false;
  }
  const lower = pathname.toLowerCase();
  // ★img/・bgm/ フォルダ以下、またはキャッシュ対象拡張子に一致するものだけを対象にする
  if (lower.includes("/img/") || lower.includes("/bgm/")) return true;
  return CACHEABLE_EXTENSIONS.some(ext => lower.endsWith(ext));
}

self.addEventListener("install", (event) => {
  self.skipWaiting(); // ★新しいサービスワーカーをすぐに有効化する
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // ★古いバージョンのキャッシュ（CACHE_NAMEを変えた場合）を掃除する
      const keys = await caches.keys();
      await Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!isCacheableRequest(request)) return; // ★対象外はそのままネットワークへ（何もしない）

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached; // ★キャッシュ済みなら即座に返す（次回以降が一瞬で開ける部分）

      try {
        const response = await fetch(request);
        // ★成功したレスポンスだけをキャッシュに保存する（エラー応答をキャッシュしてしまうと直せなくなる）
        if (response && response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      } catch (err) {
        // ★オフライン等でネットワークも失敗した場合、キャッシュにも無ければそのままエラーにする
        throw err;
      }
    })()
  );
});
