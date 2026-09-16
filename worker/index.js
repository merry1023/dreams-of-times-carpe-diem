// worker/index.js
// ★要望対応：仲間との会話機能（Gemini API連携）
//
// 全体の流れ（1回のプレイヤー発言につき）：
//   1. FirebaseのIDトークンを検証し、誰がリクエストしたか(uid)を確認する
//   2. そのuidの「1日10回・週40回」の思考モデル利用回数を確認する
//      → 残っていれば会話AI(Talk)は思考モデル、無くなっていればflashモデルにそっと切り替える
//   3. まとめAI(Work・常にflash固定)に、あらすじ・パーティ情報などの生データを渡し、
//      会話AI向けの「設定資料（briefing）」を簡潔にまとめてもらう（既にある場合は作り直さない）
//   4. 会話AI(Talk)にキャラクターのペルソナ＋設定資料＋会話履歴を渡して返答を作らせる。
//      会話AIが「もっと詳しい設定資料が欲しい」とツール呼び出しをしてきたら、
//      その話題だけをまとめAIに聞きに行って、結果を会話AIに渡してもう一度答えさせる
//   5. 出来上がった返答をプレイヤーに返す（思考モデルを使った時だけ回数を1消費する）
//
// 必要な設定（Cloudflareダッシュボード or wrangler CLIで用意してください）：
//   ・シークレット環境変数 GEMINI_WORK_API_KEY  … まとめAI用のGeminiキー（"Gemini Work API Key"）
//   ・シークレット環境変数 GEMINI_TALK_API_KEY  … 会話AI用のGeminiキー（"Gemini Talk API Key"）
//   ・KVネームスペース COMPANION_CHAT_KV        … 回数制限のカウンター保存用（wrangler.jsoncにID設定が必要）
//   設定コマンドの例は README_COMPANION_CHAT.md を参照してください。

import { verifyFirebaseIdToken } from "./verifyFirebaseToken.js";

const TALK_MODEL_THINKING = "gemini-3.1-pro";  // ★会話AI：普段はこちら（思考モデル）
const TALK_MODEL_FLASH = "gemini-3.8-flash";   // ★会話AI：1日10回/週40回を使い切ったらこちらに切り替え
const WORK_MODEL = "gemini-3.8-flash";         // ★まとめAI：常にこちら固定（情報整形が仕事なので思考モデルは不要）
// ★Geminiのモデルは提供終了・切り替えが頻繁にあるため（例：2.5系は2026年10月に終了予定）、
//   将来エラーが出るようになったら https://ai.google.dev/gemini-api/docs/models で現行モデル名を確認してください。

const DAILY_LIMIT = 10;
const WEEKLY_LIMIT = 40;
const MAX_FUNCTION_CALL_LOOPS = 2; // ★会話AIが「設定資料をもっと見せて」を要求できる最大回数（無限ループ・コスト暴走の防止）

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/companion-chat") {
      if (request.method !== "POST") return jsonResponse({ error: "POSTのみ対応しています" }, 405);
      return handleCompanionChat(request, env);
    }
    if (url.pathname.startsWith("/api/")) return jsonResponse({ error: "not found" }, 404);

    // ★API以外は今まで通り静的ファイル（ゲーム本体）を返す
    return env.ASSETS.fetch(request);
  }
};

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

async function handleCompanionChat(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ error: "リクエストの形式が不正です" }, 400);
  }

  const authHeader = request.headers.get("Authorization") || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!idToken) return jsonResponse({ error: "ログインが必要です" }, 401);

  const verified = await verifyFirebaseIdToken(idToken);
  if (!verified) return jsonResponse({ error: "ログイン情報が確認できませんでした。再度ログインしてください" }, 401);
  const uid = verified.uid;

  const { companionId, talkHistory, userMessage, context, cachedBriefing } = body || {};
  if (!companionId || typeof userMessage !== "string" || !userMessage.trim() || !context) {
    return jsonResponse({ error: "パラメータが不足しています" }, 400);
  }
  if (userMessage.length > 500) {
    return jsonResponse({ error: "メッセージが長すぎます（500文字以内にしてください）" }, 400);
  }

  // ===== ①回数確認＆今回使うモデルを決定 =====
  let quota;
  try {
    quota = await getQuota(env, uid);
  } catch (e) {
    console.error("回数制限データの取得に失敗しました", e);
    return jsonResponse({ error: "回数制限の確認に失敗しました。時間をおいて試してください" }, 502);
  }
  const useThinkingModel = quota.dayCount < DAILY_LIMIT && quota.weekCount < WEEKLY_LIMIT;
  const talkModel = useThinkingModel ? TALK_MODEL_THINKING : TALK_MODEL_FLASH;

  try {
    // ===== ②設定資料（briefing）を用意。既に貰っていれば作り直さない =====
    let briefing = typeof cachedBriefing === "string" && cachedBriefing.trim() ? cachedBriefing : null;
    if (!briefing) {
      briefing = await callWorkAi(env, buildBriefingPrompt(context));
    }

    // ===== ③会話AI呼び出し（必要なら「設定資料をもっと見せて」のやり取りを挟む） =====
    const systemInstruction = buildTalkSystemInstruction(context, briefing);
    const tools = [{
      functionDeclarations: [{
        name: "request_reference_detail",
        description: "渡された設定資料の概要だけでは分からない、パーティ・仲間・これまでの話についての詳しい情報が会話の返答に必要な時にだけ呼び出す。",
        parameters: {
          type: "OBJECT",
          properties: {
            topic: { type: "STRING", description: "知りたい内容（例：〇〇の技の詳細、△△との過去の出来事、など）" }
          },
          required: ["topic"]
        }
      }]
    }];

    let contents = [
      ...(Array.isArray(talkHistory) ? talkHistory.slice(-20).map(turn => ({
        role: turn.role === "model" ? "model" : "user",
        parts: [{ text: String(turn.text || "") }]
      })) : []),
      { role: "user", parts: [{ text: userMessage }] }
    ];

    let finalText = null;
    for (let loop = 0; loop <= MAX_FUNCTION_CALL_LOOPS; loop++) {
      const result = await callGenerateContent(env.GEMINI_TALK_API_KEY, talkModel, contents, systemInstruction, tools);
      const parts = (result && result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts) || [];
      const functionCallPart = parts.find(p => p.functionCall);
      const textPart = parts.find(p => typeof p.text === "string" && p.text);

      if (functionCallPart && loop < MAX_FUNCTION_CALL_LOOPS) {
        const topic = (functionCallPart.functionCall.args && functionCallPart.functionCall.args.topic) || "";
        const detail = await callWorkAi(env, buildDetailPrompt(context, topic));
        contents = [...contents,
          { role: "model", parts: [functionCallPart] },
          { role: "user", parts: [{ functionResponse: { name: "request_reference_detail", response: { detail } } }] }
        ];
        continue; // ★もう一度会話AIに聞かせて、最終的な返答を作らせる
      }

      finalText = textPart ? textPart.text : "……（うまく言葉が出てこなかったみたい）";
      break;
    }

    // ===== ④思考モデルを使った時だけ回数を1消費する =====
    if (useThinkingModel) {
      try { await incrementQuota(env, uid, quota); } catch (e) { console.error("回数制限データの更新に失敗しました", e); }
    }

    return jsonResponse({
      reply: finalText,
      briefing, // ★次回以降のリクエストでcachedBriefingとして送り返してもらう（まとめAI呼び出しの節約用）
      usedModel: useThinkingModel ? "thinking" : "flash",
      quota: {
        dayCount: quota.dayCount + (useThinkingModel ? 1 : 0),
        dayLimit: DAILY_LIMIT,
        weekCount: quota.weekCount + (useThinkingModel ? 1 : 0),
        weekLimit: WEEKLY_LIMIT
      }
    });
  } catch (e) {
    console.error("仲間との会話処理でエラーが発生しました", e);
    return jsonResponse({ error: "AIとの通信に失敗しました。時間をおいて試してください" }, 502);
  }
}

// ===== まとめAI（Work）関連 =====

function buildBriefingPrompt(context) {
  return "あなたは物語設定の要約担当です。以下のゲーム内データ（JSON）を、キャラクター会話AIが内部で把握しておくための" +
    "簡潔な日本語の「設定資料」としてまとめてください。会話相手に読み上げる文章ではなく、あくまでAIが参照するメモです。" +
    "物語のあらすじ、パーティ名、パーティメンバーそれぞれの二つ名・レベル・職業を中心に、長くなりすぎないようにまとめてください。\n\n" +
    "---ゲーム内データ(JSON)---\n" + JSON.stringify(context);
}

function buildDetailPrompt(context, topic) {
  return "以下のゲーム内データ（JSON）の中から、次の話題に関係する部分だけを詳しく抜き出し、日本語の文章でまとめてください。" +
    "データの中に無い情報は絶対に創作せず「その点についての詳しい情報は見当たりません」と答えてください。\n\n" +
    "話題：" + topic + "\n\n---ゲーム内データ(JSON)---\n" + JSON.stringify(context);
}

async function callWorkAi(env, promptText) {
  const result = await callGenerateContent(env.GEMINI_WORK_API_KEY, WORK_MODEL, [{ role: "user", parts: [{ text: promptText }] }], null, null);
  const parts = (result && result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts) || [];
  const textPart = parts.find(p => typeof p.text === "string" && p.text);
  return textPart ? textPart.text : "";
}

// ===== 会話AI（Talk）関連 =====

function buildTalkSystemInstruction(context, briefing) {
  const persona = context.companionPersona || {};
  let instruction = `あなたは「${persona.name || "仲間"}」というキャラクターになりきって、プレイヤーと一対一の会話をしてください。`;
  if (persona.epithet) instruction += `二つ名は「${persona.epithet}」です。`;
  if (persona.personality) instruction += `性格・口調の指針：${persona.personality}`;
  instruction += "\n\n以下はこのキャラクターが把握している設定資料です。これをそのまま読み上げるのではなく、" +
    "キャラクターとして自然な言葉で会話に活かしてください。\n\n---設定資料---\n" + briefing +
    "\n\n設定資料だけでは答えに困る、より詳しい情報が必要な時だけrequest_reference_detail関数を呼び出してください。" +
    "毎回呼び出す必要はありません。";
  return instruction;
}

async function callGenerateContent(apiKey, model, contents, systemInstructionText, tools) {
  if (!apiKey) throw new Error(`APIキーが設定されていません（${model}）。Cloudflareのシークレット環境変数を確認してください`);
  const requestBody = { contents };
  if (systemInstructionText) requestBody.systemInstruction = { parts: [{ text: systemInstructionText }] };
  if (tools) requestBody.tools = tools;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(requestBody)
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API呼び出しに失敗しました（${model}, status ${res.status}）: ${errText.slice(0, 300)}`);
  }
  return res.json();
}

// ===== ★1日10回・週40回の回数管理（Cloudflare KVにFirebaseのuidごとに保存） =====

function getUtcDateString(date) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD（サーバー側はUTC固定。端末のタイムゾーンに依存させない）
}

function getUtcIsoWeekStart(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // ★月曜=1〜日曜=7に読み替え
  if (day !== 1) d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.toISOString().slice(0, 10);
}

async function getQuota(env, uid) {
  const raw = await env.COMPANION_CHAT_KV.get(`rl:${uid}`);
  const now = new Date();
  const todayStr = getUtcDateString(now);
  const weekStartStr = getUtcIsoWeekStart(now);

  let quota = raw ? JSON.parse(raw) : null;
  if (!quota || typeof quota !== "object") quota = { dayDate: todayStr, dayCount: 0, weekStart: weekStartStr, weekCount: 0 };
  if (quota.dayDate !== todayStr) { quota.dayDate = todayStr; quota.dayCount = 0; } // ★日付が変わっていたら1日分リセット
  if (quota.weekStart !== weekStartStr) { quota.weekStart = weekStartStr; quota.weekCount = 0; } // ★週が変わっていたら1週間分リセット
  return quota;
}

async function incrementQuota(env, uid, quota) {
  const updated = { dayDate: quota.dayDate, dayCount: quota.dayCount + 1, weekStart: quota.weekStart, weekCount: quota.weekCount + 1 };
  await env.COMPANION_CHAT_KV.put(`rl:${uid}`, JSON.stringify(updated), { expirationTtl: 60 * 60 * 24 * 14 }); // ★2週間で自動失効
}
