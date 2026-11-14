// onlinedict.js
// ===================================================================
// ===== 執筆ガイド：オンライン辞書（APIで引く辞書） =====
// ===================================================================
// ★簡易辞書（writingdict_data.js）に載っていない言葉を、ネットの辞書APIで引く。「執筆ガイド」タブの「🌐 オンライン辞書」から使う。
// ★使っているAPI（どれも無料・登録不要・ブラウザから直接呼べる Wikimedia のAPI）：
//   ・ウィクショナリー日本語版 … MediaWiki API（語釈・読み・用例などの文章）
//   ・ウィキペディア日本語版 … REST API の page/summary（固有名詞・事物の概要）
//   どちらの文章も CC BY-SA ライセンス。画面には必ず出典のリンクを付ける（シナリオに引用する時は出典の表記が要る）。
// ★ネットにつながらない／APIが落ちている時は、エラーの理由を画面に出す（ゲーム本体には影響しない）。
// ★APIの文章は textContent で表示する（HTMLとして解釈しない）。
// ★writingguide.js の部品（wgEl / wgAddNote / wgCopyText）を使う。どちらを先に読み込んでもよい（呼ぶのは画面を開いた時）。

const OD_TIMEOUT_MS = 8000;
const OD_TEXT_MAX_CHARS = 1600;   // 1件の表示の長さの上限（長い語は出典ページで読んでもらう）

let wgOnlineQuery = "";
let wgOnlineEnabled = { wiktionary: true, wikipedia: true };
let odSearchSerial = 0;            // 古い検索の結果が、新しい検索の画面を上書きしないようにする番号
const odCache = new Map();         // 同じ言葉を何度も引かないための、画面を開いている間だけのキャッシュ

// 他の辞書サイトを開くリンク（API ではなく、ブラウザの別タブで開くだけ）
const OD_LINKOUTS = [
  { label: "Weblio", url: w => "https://www.weblio.jp/content/" + encodeURIComponent(w) },
  { label: "goo辞書", url: w => "https://dictionary.goo.ne.jp/srch/all/" + encodeURIComponent(w) + "/m0u/" },
  { label: "コトバンク", url: w => "https://kotobank.jp/word/" + encodeURIComponent(w) }
];

// ===== API 呼び出し =====
async function odFetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.status === 404) return { notFound: true };
    if (!res.ok) throw new Error(`サーバーがエラーを返しました（HTTP ${res.status}）`);
    return await res.json();
  } catch (err) {
    if (err && err.name === "AbortError") throw new Error("時間内に応答がありませんでした");
    if (err instanceof TypeError) throw new Error("ネットワークにつながっていないか、接続が拒否されました");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function odTrimText(text) {
  let t = String(text || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (t.length > OD_TEXT_MAX_CHARS) t = t.slice(0, OD_TEXT_MAX_CHARS).replace(/\s+\S*$/, "") + "…\n（続きは出典のページで読めます）";
  return t;
}

// ウィクショナリーの本文から「== 日本語 ==」の節だけを取り出す（無ければ全体）
function odPickJapaneseSection(extract) {
  const parts = String(extract || "").split(/^==\s*([^=\n][^\n]*?)\s*==\s*$/m);
  // split の結果：[前文, 見出し1, 本文1, 見出し2, 本文2, ...]
  for (let i = 1; i + 1 < parts.length; i += 2) {
    if (parts[i].trim() === "日本語") return parts[i + 1];
  }
  return extract;
}

async function odFetchWiktionary(word) {
  const url = "https://ja.wiktionary.org/w/api.php?action=query&format=json&formatversion=2&origin=*&redirects=1&prop=extracts&explaintext=1&exsectionformat=wiki&titles=" + encodeURIComponent(word);
  const data = await odFetchJson(url);
  const page = data && data.query && data.query.pages && data.query.pages[0];
  if (!page || page.missing || !page.extract) return null;
  const text = odTrimText(odPickJapaneseSection(page.extract).replace(/^=+\s*(.*?)\s*=+\s*$/gm, "【$1】"));
  if (!text) return null;
  return { title: page.title || word, text, url: "https://ja.wiktionary.org/wiki/" + encodeURIComponent(page.title || word) };
}

async function odFetchWikipedia(word) {
  const url = "https://ja.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(word) + "?redirect=true";
  const data = await odFetchJson(url);
  if (!data || data.notFound || !data.extract) return null;
  const head = data.description ? `（${data.description}）\n` : "";
  const note = data.type === "disambiguation" ? "※同じ名前の別の項目がいくつかあります（曖昧さ回避のページ）。\n" : "";
  const pageUrl = (data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page) || ("https://ja.wikipedia.org/wiki/" + encodeURIComponent(data.title || word));
  return { title: data.title || word, text: odTrimText(note + head + data.extract), url: pageUrl };
}

// 見つからなかった時の「もしかして」候補（ウィクショナリーの前方一致検索）
async function odFetchSuggestions(word) {
  try {
    const data = await odFetchJson("https://ja.wiktionary.org/w/api.php?action=opensearch&format=json&origin=*&limit=6&namespace=0&search=" + encodeURIComponent(word));
    const titles = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
    return titles.filter(t => t && t !== word).slice(0, 6);
  } catch (e) { return []; }
}

const OD_SOURCES = [
  { id: "wiktionary", label: "ウィクショナリー（語釈・用例）", site: "ウィクショナリー日本語版", license: "CC BY-SA", fetch: odFetchWiktionary },
  { id: "wikipedia", label: "ウィキペディア（概要）", site: "ウィキペディア日本語版", license: "CC BY-SA", fetch: odFetchWikipedia }
];

// 1つの辞書を引く（キャッシュ付き）。成功＝{ ok, hit|null }、失敗＝{ ok:false, error }
async function odLookup(source, word) {
  const key = source.id + "\u0000" + word;
  if (odCache.has(key)) return odCache.get(key);
  try {
    const hit = await source.fetch(word);
    const result = { ok: true, hit };
    odCache.set(key, result);
    return result;
  } catch (err) {
    return { ok: false, error: (err && err.message) || "不明なエラー" };   // 失敗はキャッシュしない（次に引き直せるように）
  }
}

// ===== 画面 =====
function renderOnlineDictionaryPane(container) {
  wgAddNote(container, "簡易辞書にない言葉を、ネットの辞書（ウィクショナリー／ウィキペディアのAPI）で引きます。ネットにつながっている時だけ使えます。文章は CC BY-SA ライセンスなので、シナリオに引用する時は出典の表記が必要です。");

  const controls = wgEl("div", "wg-dict-controls");
  const input = document.createElement("input");
  input.type = "search";
  input.className = "scenariobuild-title-input wg-dict-search";
  input.placeholder = "調べたい言葉（例：蜃気楼　／　ひねもす　／　ケルベロス）";
  input.value = wgOnlineQuery;
  controls.appendChild(input);
  const goBtn = wgEl("button", "devmode-btn", "🔍 調べる");
  goBtn.type = "button";
  controls.appendChild(goBtn);
  container.appendChild(controls);

  const sourceRow = wgEl("div", "wg-dict-controls");
  OD_SOURCES.forEach(src => {
    const label = wgEl("label", "wg-online-source");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = wgOnlineEnabled[src.id] !== false;
    cb.onchange = () => { wgOnlineEnabled[src.id] = cb.checked; };
    label.appendChild(cb);
    label.appendChild(document.createTextNode(" " + src.label));
    sourceRow.appendChild(label);
  });
  container.appendChild(sourceRow);

  const statusEl = wgEl("p", "devmode-note wg-dict-count");
  container.appendChild(statusEl);
  const resultEl = wgEl("div", "wg-dict-list");
  container.appendChild(resultEl);
  const linkEl = wgEl("div", "wg-online-links");
  container.appendChild(linkEl);

  const search = async (wordRaw) => {
    const word = String(wordRaw || "").trim();
    wgOnlineQuery = word;
    input.value = word;
    resultEl.innerHTML = ""; linkEl.innerHTML = "";
    if (!word) { statusEl.textContent = "言葉を入力してください。"; return; }
    const sources = OD_SOURCES.filter(s => wgOnlineEnabled[s.id] !== false);
    if (sources.length === 0) { statusEl.textContent = "調べる辞書を1つ以上選んでください。"; return; }
    const serial = ++odSearchSerial;
    statusEl.textContent = "調べています…";
    goBtn.disabled = true;
    const results = await Promise.all(sources.map(s => odLookup(s, word)));
    if (serial !== odSearchSerial) return;   // もっと新しい検索が始まっていたら、この結果は捨てる
    goBtn.disabled = false;

    let hitCount = 0, errorCount = 0;
    results.forEach((r, i) => {
      const src = sources[i];
      if (!r.ok) {
        errorCount++;
        resultEl.appendChild(wgEl("div", "wg-dict-entry wg-online-error", `${src.site}：引けませんでした（${r.error}）`));
        return;
      }
      if (!r.hit) return;
      hitCount++;
      const item = wgEl("div", "wg-dict-entry");
      const head = wgEl("div", "wg-dict-head");
      head.appendChild(wgEl("b", "wg-dict-term", r.hit.title));
      head.appendChild(wgEl("span", "wg-dict-cat", src.site));
      const copyBtn = wgEl("button", "devmode-btn wg-dict-copy", "コピー");
      copyBtn.type = "button";
      copyBtn.onclick = (event) => { event.stopPropagation(); wgCopyText(r.hit.text, copyBtn); };
      head.appendChild(copyBtn);
      item.appendChild(head);
      item.appendChild(wgEl("div", "wg-dict-meaning wg-online-text", r.hit.text));
      const foot = wgEl("div", "wg-dict-note");
      const a = document.createElement("a");
      a.href = r.hit.url; a.target = "_blank"; a.rel = "noopener noreferrer";
      a.textContent = "出典：" + src.site + "「" + r.hit.title + "」";
      foot.appendChild(a);
      foot.appendChild(document.createTextNode(`（${src.license}）`));
      item.appendChild(foot);
      resultEl.appendChild(item);
    });

    statusEl.textContent = hitCount > 0 ? `${hitCount}件見つかりました。` : (errorCount === results.length ? "どの辞書にもつながりませんでした。" : "見つかりませんでした。");
    if (hitCount === 0 && errorCount < results.length) {
      const words = await odFetchSuggestions(word);
      if (serial === odSearchSerial && words.length > 0) {
        const box = wgEl("div", "wg-online-suggest");
        box.appendChild(wgEl("span", "devmode-note", "もしかして："));
        words.forEach(w => {
          const b = wgEl("button", "devmode-btn wg-online-chip", w);
          b.type = "button";
          b.onclick = () => search(w);
          box.appendChild(b);
        });
        resultEl.appendChild(box);
      }
    }
    // 別の辞書サイトで開くリンク（ブラウザの別タブ）
    linkEl.appendChild(wgEl("span", "devmode-note", "他の辞書で開く："));
    OD_LINKOUTS.forEach(l => {
      const a = document.createElement("a");
      a.className = "devmode-btn wg-online-link";
      a.href = l.url(word); a.target = "_blank"; a.rel = "noopener noreferrer";
      a.textContent = l.label;
      linkEl.appendChild(a);
    });
  };

  goBtn.onclick = () => search(input.value);
  input.onkeydown = (event) => {
    // 日本語入力の変換確定のEnterでは検索しない
    if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); search(input.value); }
  };
  if (wgOnlineQuery) search(wgOnlineQuery);
}
