# 仲間との会話機能：デプロイ前に必要な設定

このリポジトリに「仲間との会話」機能（`worker/index.js`）を追加しました。
セキュリティ上、APIキーの登録とKVネームスペースの作成だけはこちら側では出来ないため、
以下の手順をご自身の端末で（npmとwranglerが使える状態で）実行してください。

## 1. KVネームスペースを作る（回数制限のカウンター保存用）

```
npx wrangler kv namespace create COMPANION_CHAT_KV
```

実行すると `id = "xxxxxxxx..."` のような行が表示されるので、そのidを
`wrangler.jsonc` の `kv_namespaces[0].id` の `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` と
書き換えてください。

## 2. Geminiのキーを2つ、シークレットとして登録する

すでに作成済みの「Gemini Work API Key」「Gemini Talk API Key」を、
**チャットに貼らず**、以下のコマンドでそれぞれ登録してください（対話式で入力を求められます）。

```
npx wrangler secret put GEMINI_WORK_API_KEY
npx wrangler secret put GEMINI_TALK_API_KEY
```

- `GEMINI_WORK_API_KEY` … まとめAI（情報整形担当・常にflashモデル）用
- `GEMINI_TALK_API_KEY` … 会話AI（キャラクター本人担当・普段は思考モデル）用

## 3. デプロイ

```
npx wrangler deploy
```

（GitHub連携で自動デプロイしている場合も、上記1・2はデプロイ前に一度だけ実行しておけば、
以降のpushでは自動デプロイに引き継がれます）

## 使用モデルについて

- 会話AI：`gemini-3.1-pro-preview`（思考モデル、1日10回・週40回まで）→ 枠を使い切ったら `gemini-3.8-flash` に自動で切り替え
- まとめAI：`gemini-3.1-flash-lite` 固定

Geminiはモデルの提供終了・切り替えが度々あるため、今後エラーが出るようになった場合は
`worker/index.js` 先頭の `TALK_MODEL_THINKING` / `TALK_MODEL_FLASH` / `WORK_MODEL` を
[現行モデル一覧](https://ai.google.dev/gemini-api/docs/models) を見て書き換えてください。
