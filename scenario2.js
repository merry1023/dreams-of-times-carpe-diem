// scenario2.js
// 第二話：初めての〇〇(チュウではない)
//
// 酒場で店主と話した時、解放条件（進行度200・転移15日以上）を満たしていれば startScene2() が呼ばれる
// （呼び出し元は town.js の talkToTavernMaster）。

// ★第二話（builtin_chapter2）のクリア記録。ソロ／パーティー、どちらのエンディングに進んでも呼ぶ。
//   第一話と同じく、この手書きの第二話にはクリア記録処理が無く、便利タブの進行度アイコンが
//   進まない不具合の原因になっていた
function markChapter2Cleared() {
  if (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.chapters)) {
    const chapter2Entry = scenarioProject.chapters.find(c => c.id === "builtin_chapter2");
    if (chapter2Entry) chapter2Entry.cleared = true;
  }
  if (typeof player !== "undefined") player.progressPoints = 0; // ★話が終わるごとに進行度をリセットする（ブロック版と同じ挙動）
  if (typeof saveCustomScenarioData === "function") saveCustomScenarioData();
}
//
// 構成（読みやすいよう、場面ごとに関数を分けてある）：
//   startScene2()          … 全体の進行役。各パートを順番に呼び出す
//   scene2_TavernIntro()   … 酒場での導入。治郎と出会い、依頼を受けることを決める
//   scene2_Introductions() … 自己紹介〜ニョードー街道への移動
//   scene2_CaveApproach()  … 洞窟発見〜突入前の3択（外れるとバッドエンド）
//   scene2_CaveInfiltration() … 洞窟内の緊迫シーン〜突入方法の3択（外れるとバッドエンド）
//   scene2_BossBattle()    … 液体（実は硫酸）を投げつけてホブゴブリンの群れと戦う
//   scene2_Aftermath()     … 数日後のお礼〜竜殺し（ケツァナ）からのパーティー勧誘〜結末
//
// ★バッドエンドは「GAME OVER」演出を見せたあと、同じ選択肢まで自動的に巻き戻して再挑戦させる方式。
//   （タイトル画面や強制ロードの仕組みはまだ無いため、遊びやすさを優先してこの形にしてある）

const CHAPTER2_IMPLEMENTED = true;

// ★第2話の解放条件：進行度（クエスト達成・ランクアップ・魔物討伐で増える）が200以上、
//   かつ転移してから15日以上経っていること
function isChapter2Unlockable() {
  if (!player) return false;
  return player.progressPoints >= 200 && player.daysSinceTransfer >= 15;
}

// 酒場で主人と話した時、第2話が解放条件を満たしていて、かつ中身が実装済みなら
// こちらが呼ばれる（town.js の talkToTavernMaster から呼ぶ）
async function startScene2() {
  switchScenarioBGM("scene2_tavern", { fadeMs: 800 }); // bgm.js（曲ファイルが無ければ静かに失敗するだけ）
  
  await scene2_TavernIntro();
  await scene2_Introductions();
  await scene2_CaveApproach();
  await scene2_CaveInfiltration();
  await scene2_BossBattle();
  await scene2_Aftermath();
}

// ===== ①酒場での導入 =====
async function scene2_TavernIntro() {
  changeSpeaker("");
  await displayMessage("先日の一件から数日経った頃……俺は酒場で主人と話をしていた。");
  
  changeSpeaker("店主");
  await displayMessage("「あ、そうだ兄ちゃん。最近までこの村に来ていたマッドサイエンティストの「デッパ」というやつがなんかよくわからん液体の入った瓶を俺に無理やり渡して行きやがってな……よかったらやるよ。これ。」");
  
  changeSpeaker("");
  await displayMessage("主人はそのマッドサイエンティストとやらが置いていったという「よくわからん謎の液体入り瓶」を手渡してきた。");
  addItem("mystery_liquid", 1); // items.js
  
  changeSpeaker("田中治郎");
  await displayMessage("「....えぇ....？いや、別にいらないんですが.....」");
  
  changeSpeaker("店主");
  await displayMessage("「まぁまぁ！この瓶名前書いてないしきっと大事なやつじゃないんだろ！とりあえず持っとけ！なにか役に立つかもしれんしな！」");
  
  changeSpeaker("");
  await displayMessage("...ただ単にいらないから渡してきただけだよな.....");
  await displayMessage("そうしていると、聞き覚えのある声が聞こえてきた。");
  
  changeSpeaker("竜殺し");
  await displayMessage("「何このクエスト！なんでこんな低級依頼ばっかなのよ！」");
  
  changeSpeaker("");
  await displayMessage("俺は声のほうをちらりと見た。やはりあの時の女性だった……");
  await displayMessage("「うわ...またなんか言ってるよ...」");
  
  changeSpeaker("店主");
  await displayMessage("「竜殺しさん...すみませんが今日はこういう依頼ばっかりなんですよ...まあここは王国外れの村ですし、なかなかそういった依頼は来ませんね...」");
  
  changeSpeaker("");
  await displayMessage("主人も困っているようだ。");
  
  changeSpeaker("竜殺し");
  await displayMessage("「はぁ？最低でももう少しマシな依頼あるでしょ！」");
  
  changeSpeaker("");
  await displayMessage("すると、突如扉が開き男が飛び込んできた。");
  
  changeSpeaker("治郎（男）");
  await displayMessage("「うぅ...そんな...俺の𰻞𰻞が...」");
  
  changeSpeaker("竜殺し");
  await displayMessage("「ちょっとあんた、何があったの？」");
  
  changeSpeaker("");
  await displayMessage("竜殺しが振り返った。");
  
  changeSpeaker("治郎（男）");
  await displayMessage("「じ、実は僕の妻の𰻞𰻞が街で魔物に攫われてしまって……お願いします！助けてください！！」");
  
  changeSpeaker("竜殺し");
  await displayMessage("「何言ってんのよ。助けに行きたいのは山々だけど、私が依頼される側なの。あなたクエスト依頼出してないでしょ？やってほしいことがあったらちゃんと報酬と詳細を説明した紙をここに貼り出すことね...！」");
  
  changeSpeaker("");
  await displayMessage("竜殺しは腕を組みながら男を見下ろしていた。");
  
  changeSpeaker("治郎（男）");
  await displayMessage("「え、あ、そうですか……すみません。初めてなもので」");
  
  changeSpeaker("");
  await displayMessage("男は泣きそうになりながら頭を下げた。");
  
  changeSpeaker("店主");
  await displayMessage("「まあまあ落ち着けよ兄ちゃん……クエストを出すには依頼料がかかる。ここで依頼料を出してクエストを貼るか？ここでなんの報酬もなく助けてもらうのは無理なもんだ...」\n「ここにはそういう連中しかいねえ。」");
  
  changeSpeaker("");
  await displayMessage("男の人は奥さんがさらわれて本当に困っているようだ、こういうときは...");
  
  await scene2_TavernChoice();
}

// 「こういう時は…」の3択。A以外は選んでもその場に留まる（loops:true）
async function scene2_TavernChoice() {
  const picked = await displayChoices([
    { text: "「いや、僕が行きますよ！困ってる人がいて見て見ぬふりなんて出来ません！」", next: "A", isCorrect: true },
    { text: "「もしかして奥さんゴブリンにさらわれたんじゃないですか！？えっちなことされてる可能性も！？」", next: "B", loops: true },
    { text: "「ひぃいいい！人を攫うなんて！俺はそんな目に会いたくないっ！」", next: "C", loops: true }
  ]);
  
  if (picked.next === "A") {
    changeSpeaker("治郎（男）");
    await displayMessage("「おお！本当ですか！ありがとうございます！なんとお礼を言えばいいか...！」");
    changeSpeaker("店主");
    await displayMessage("「まじか兄ちゃん。驚いたよ。（色んな意味で）そういうことなら頼んだぞ。良い人がいて良かったな。」");
    changeSpeaker("竜殺し");
    await displayMessage("「本気なの？馬鹿じゃないの...」");
    return; // ★次に進む
  }
  
  if (picked.next === "B") {
    changeSpeaker("治郎（男）");
    await displayMessage("「....え...え！？や、やめてください！そんなことがあったら僕は...！！！！！！」");
    changeSpeaker("");
    await displayMessage("男は真っ青になって震えだした。");
    changeSpeaker("竜殺し");
    await displayMessage("「え、ちょ、あんた....」");
    changeSpeaker("");
    await displayMessage("周囲の視線が冷たくなった。俺は慌てて取り繕おうとした。");
    changeSpeaker("田中治郎");
    await displayMessage("「あ、いや！違うんだ！ただちょっと……その可能性もゼロじゃないなと思って！」");
    changeSpeaker("治郎（男）");
    await displayMessage("「そんな、嫌だ...！俺の𰻞𰻞がっ...！」");
    changeSpeaker("店主");
    await displayMessage("「まぁまぁ兄ちゃん、確かに否定はできないが、まだ慌てるときじゃないさ...」");
  } else {
    changeSpeaker("");
    await displayMessage("男の話を聞くだけでもう体が震えてしまう。");
    changeSpeaker("治郎（男）");
    await displayMessage("「あの……大丈夫ですか……？」");
    changeSpeaker("店主");
    await displayMessage("「あーあ、こりゃだめだな。兄ちゃん完全にビビっちゃってるよ……」");
    changeSpeaker("竜殺し");
    await displayMessage("「うわぁ...ダッサ...」");
    changeSpeaker("");
    await displayMessage("竜殺しは蔑むような目で俺の方を見た。そして男は困惑した顔でこちらを見つめている。");
    changeSpeaker("田中治郎");
    await displayMessage("「ち、違いますよ！？僕はただ……その、あの……怖いのはその……魔物じゃなくて、もし奥さんがその魔物と……つまり……その……いや！何言ってるんだ俺は！」");
    changeSpeaker("竜殺し");
    await displayMessage("「ちょっと、あんた落ち着きなさい！変な想像しないで！」");
    changeSpeaker("治郎（男）");
    await displayMessage("「あれ……兄ちゃん...なんか息荒くなってない？大丈夫？」");
    changeSpeaker("");
    await displayMessage("竜殺しと店主が呆れたような目でこちらを見ていた。");
  }
  
  // ★B・Cどちらでも、少し寄り道した後で同じ選択肢に戻ってくる
  await scene2_TavernChoice();
}

// ===== ②自己紹介〜ニョードー街道への移動 =====
async function scene2_Introductions() {
  changeSpeaker("竜殺し");
  await displayMessage("「...私はついていかないからね？何があっても知らないわよ！...まぁ、人を攫うなんて大体は低級ゴブリンの仕業。私はもっとランクの高いクエストを受けたいし...勝手にすれば？」");
  
  changeSpeaker("");
  await displayMessage("「(く、クソ野郎だ！あいつ性格終わってやがる...！)」\nと思いつつもとりあえずはこの人の奥さんをさらった魔物がどこにいったのか調べなくてはならない...");
  
  changeSpeaker("田中治郎");
  await displayMessage("「あの、まずお名前を聞いてもいいですか？」");
  
  changeSpeaker("治郎（男）");
  await displayMessage("「あ、はい...私は「青椒(チンジャオ)」と申します。妻は「𰻞𰻞(ビャンビャン)」で、まだ23なんです！お願いします、助けてやってください！なんでもしますから！」");
  
  changeSpeaker("田中治郎");
  await displayMessage("「ま、まぁまぁ落ち着いて...！....ん？というか、真名は明かしちゃいけないのでは...？」");
  
  changeSpeaker("青椒");
  await displayMessage("「あぁ、真名はたしかに教えてはいけないのですが、ファーストネーム。私で言う「青椒」などは別に良いんですよ。」");
  
  changeSpeaker("田中治郎");
  await displayMessage("「な、なるほど！たしかにファーストネームくらい言い合えないと生きづらいもんな...あ、そうだ。僕のほうが名乗るのを忘れていました！僕は治郎です。よろしくお願いします！とりあえず奥さんがどこでさらわれたか教えてくれますか？」");
  
  changeSpeaker("青椒");
  await displayMessage("「...はい、よろしくお願いします！妻はニョードー街道で集団でやってきたホブゴブリンたちにさらわれてしまい、どこにいるのかさっぱりです...」");
  
  changeSpeaker("田中治郎");
  await displayMessage("「ホブゴブリンだって...！？」");
  
  changeSpeaker("");
  await displayMessage("聞いたことがある。ゴブリンが突然変異で巨大化した上位種。しかも集団...！");
  
  changeSpeaker("田中治郎");
  await displayMessage("「まずいですね...とにかく急がないと大変なことになります！すぐに探しに行きましょう！」");
  
  changeSpeaker("青椒");
  await displayMessage("「お願いします……！妻の無事を確かめてください……！」");
  
  await showSpecialScene("やがて二人はニョードー街道へ着いた。");
  setBackgroundImage("img/街道.jpg");
  
  changeSpeaker("田中治郎");
  await displayMessage("「ここがニョードー街道...」");
  changeSpeaker("青椒");
  await displayMessage("「はい。ここで妻が...」");
  changeSpeaker("田中治郎");
  await displayMessage("「わかりました。まず近くに痕跡がないか確かめてみましょう。」");
  
  changeSpeaker("");
  await displayMessage("とりあえず今重要なのはゴブリンが青椒さんの奥さんを攫い持ち去った場所だな....まずは....");
  
  changeSpeaker("田中治郎");
  await displayMessage("「ホブゴブリンたちが通りそうなルートをいくつか考えてみますか……」");
  changeSpeaker("青椒");
  await displayMessage("「はい！ぜひお願いします！」");
  changeSpeaker("田中治郎");
  await displayMessage("「ホブゴブリンが住みそうなところといえば洞窟や廃墟が多いですよね？ここら辺に心当たりありませんか？」");
  
  changeSpeaker("青椒");
  await displayMessage("「洞窟……廃墟……？」");
  changeSpeaker("");
  await displayMessage("青椒さんはしばらく考え込み、");
  changeSpeaker("青椒");
  await displayMessage("「あ、そういえば最近村外れの丘に不審な穴が見つかったって噂がありました。もしかしたらそれが……！」");
  changeSpeaker("田中治郎");
  await displayMessage("「よし、そこを当たってみましょう！案内できますか？」");
  changeSpeaker("青椒");
  await displayMessage("「もちろんです！すぐ行きましょう！」");
  
  await showSpecialScene("急いでその穴に走る。");
  setBackgroundImage("img/洞窟.jpg");
  switchScenarioBGM("scene2_cave", { fadeMs: 800 }); // bgm.js
}

// ===== ③洞窟発見〜突入前の3択 =====
async function scene2_CaveApproach() {
  changeSpeaker("田中治郎");
  await displayMessage("「...ここが...」");
  
  changeSpeaker("");
  await displayMessage("辿り着いたのは、暗く湿っぽい雰囲気の洞窟だった。入り口から漂ってくる嫌な匂いに思わず顔をしかめる。");
  
  changeSpeaker("青椒");
  await displayMessage("「ここに奥さんがいるかもしれないんですね……」");
  changeSpeaker("田中治郎");
  await displayMessage("「はい……お願いします……！」\n「とりあえず罠とか注意しながら奥へ進みましょう。僕の後についてきてください」");
  
  changeSpeaker("");
  await displayMessage("俺は慎重に歩を進め、入り口付近の地面や壁を観察する。");
  changeSpeaker("田中治郎");
  await displayMessage("「足跡が複数あるな……これは間違いなくホブゴブリンたちが使っている通路だ。それに奥からはイカの匂いもする……」");
  changeSpeaker("青椒");
  await displayMessage("「...なんでイカの匂い...？」");
  
  changeSpeaker("");
  await displayMessage("青椒さんは怪訝な顔をしたが、奥へ進んでみる。");
  await displayMessage("「...なっ！！ここは...！！」");
  await displayMessage("奥へ進み、木の枠組みで作られた入口の一番奥の部屋を覗いてみると、ホブゴブリンがなんと4体もおり、その周りにゴブリンが30ほどいたのである。");
  await displayMessage("木で出来た檻の中に複数の女性が...！その中に青椒さんの奥さんもいるようだ……！");
  await displayMessage("「どうする……！？」");
  
  await scene2_CaveApproachChoice();
}

async function scene2_CaveApproachChoice() {
  const picked = await displayChoices([
    { text: "様子を見る", next: "A", isCorrect: true },
    { text: "突入する", next: "B" },
    { text: "助けを呼ぶ", next: "C" }
  ]);
  
  if (picked.next === "A") {
    changeSpeaker("田中治郎");
    await displayMessage("「青椒さん。ここはいったん様子を見ましょう...隙を伺うべきです。青椒さんは危ないのでいったん僕の後ろから動かないでください。」");
    changeSpeaker("青椒");
    await displayMessage("「わ、わかりました...」");
    return; // ★正解。次に進む
  }
  
  if (picked.next === "B") {
    changeSpeaker("田中治郎");
    await displayMessage("「おらぁぁぁぁぁああああ！ホブゴブリンがなんじゃ！我に敵無しィッッッ！」");
    changeSpeaker("");
    await displayMessage("勢いに身を任せ突入した。");
    changeSpeaker("青椒");
    await displayMessage("「え！？治郎さん！？」");
    changeSpeaker("");
    await displayMessage("一番近くのホブゴブリンめがけ思い切り力を込め、渾身の一撃を叩き込む...！！");
    await displayMessage("カキィーーーン！\n持っていた武器はホブゴブリンの硬い皮膚に弾かれ、いとも簡単に俺は武器を失った。");
    changeSpeaker("ホブゴブリン");
    await displayMessage("「フゴ、フゴフゴ(ん？なんかヒョロいおっさんが突撃してきたぞ？お前らどうする？)」\n「フゴ、フゴゴー(切り裂いて今晩の食料にしやしょ！アニキ！)」");
    changeSpeaker("");
    await displayMessage("..................そして気がついたときには俺はまるで輪切りのソ◯ベのような形で綺麗にスライスされ、異世界での一生を終えた.........");
    await showChapter2BadEnding("バッドエンディング1：ギャングスター");
    return await scene2_CaveApproachChoice(); // ★やり直し
  }
  
  // C: 助けを呼ぶ
  changeSpeaker("田中治郎");
  await displayMessage("「きゃぁぁぁぁぁぁああああああああ！だれか助けて！」");
  changeSpeaker("青椒");
  await displayMessage("「えええ！？治郎さんどうしてー！？」");
  changeSpeaker("田中治郎");
  await displayMessage("「死にたくねぇよぉォー！ホブゴブリンなんかに勝てるわけがねぇ！！！」");
  changeSpeaker("");
  await displayMessage("すると、ゴブリンたちがその声に気づいたようだ。");
  changeSpeaker("ゴブリン");
  await displayMessage("「フゴゴー？フゴフゴ(なんか人間の声聞こえね？あっちに誰かいるぞ。)」\n「フゴ？フゴッゴ、ゴゴッ(え？うわまじだ。だっる。殺そうぜ)」");
  changeSpeaker("");
  await displayMessage("ホブゴブリンたちは治郎を見つけるなり脚を掴み片手で軽々と持ち上げ、もう片方の手で頭蓋を掴み一気に引き抜いた。");
  await displayMessage("..........これが、田中治郎の第二の人生の終幕である........");
  await showChapter2BadEnding("バッドエンディング2：田中ソード");
  return await scene2_CaveApproachChoice(); // ★やり直し
}

// ===== ④洞窟内の緊迫シーン〜突入方法の3択 =====
async function scene2_CaveInfiltration() {
  changeSpeaker("");
  await displayMessage("青椒さんは不安そうな表情を浮かべながらも、小さくうなずき、治郎の後ろで様子をうかがっている。");
  await displayMessage("俺は岩陰に身を隠し、ホブゴブリン達の動きを観察することにした。彼らの群れは洞窟内で焚き火を囲み、談笑したり食事をしているようだった。その脇には囚われた女性たちの檻。時折彼女たちに向かって下品な笑い声が響き、恐怖におののく悲鳴が混じる。");
  
  changeSpeaker("囚われの女性");
  await displayMessage("「私たちもうここで一生を終えるんだ...終わった...」");
  changeSpeaker("ビャンビャン");
  await displayMessage("「ま、まだそうと決まったわけじゃないよ！抜け出す手があるかもしれない！\n...それまで耐えよう...？」");
  changeSpeaker("囚われの女性");
  await displayMessage("「嫌だよ！こんなの耐えられない！何をされるのかわからないし！」");
  changeSpeaker("ビャンビャン");
  await displayMessage("「うん、私も同じ気持ちだよ……でも今は……」\n「……あ、見て！人が入ってきてる！」");
  
  changeSpeaker("囚われの女性たち");
  await displayMessage("「た、たすけて...！」");
  changeSpeaker("");
  await displayMessage("女性たちが治郎に気づき、小声で助けを求める。");
  await displayMessage("その時、腰をヘコヘコさせながら檻の方へ近づいていくホブゴブリンがいた。奴らは今にも何かしでかしそうな様子だった。");
  await displayMessage("突入するならホブゴブリンたちがこっちを見ていない今か...！？\n考えろ、考えるんだ...何かないか...！");
  
  await scene2_CaveInfiltrationChoice();
}

async function scene2_CaveInfiltrationChoice() {
  const picked = await displayChoices([
    { text: "たいまつに火を付け投げ込み、おびき寄せ、満身創痍のゴブリンを迎え撃つ", next: "A" },
    { text: "青椒さんに声でゴブリンたちを誘導してもらい、その間に背後から攻撃する", next: "B" },
    { text: "ゴブリン達の正面に躍り出る", next: "C", isCorrect: true }
  ]);
  
  if (picked.next === "A") {
    changeSpeaker("");
    await displayMessage("...これだ....！でもやってたこの方法なら...！");
    await displayMessage("持っていたたいまつに火を付け、最奥の部屋の入口に放り投げた。木で出来た枠組みに引火し、ゴブリンたちが慌てて外へ出ようとする。");
    changeSpeaker("田中治郎");
    await displayMessage("「今だァッッッ！！！」");
    changeSpeaker("青椒");
    await displayMessage("「さすが治郎さん！頭いい！」");
    changeSpeaker("");
    await displayMessage("燃えながら逃げてきたゴブリンを一体、二体と葬る。そしてお目当ての....\"ホブゴブリン\"！");
    await displayMessage("カキィィィィィィイイイイーーーーン！\n渾身の力を込めて放った一撃は、ホブゴブリンの硬い皮膚に弾かれてしまった.....");
    changeSpeaker("田中治郎");
    await displayMessage("「ば、.....馬鹿なァッッッ！！！！」");
    changeSpeaker("ホブゴブリン");
    await displayMessage("「フゴ、フゴフゴゴォッッッ！(ワイの部屋に放火したんお前か！)\nフゴフゴフーッッッ！(ホンマ許さんでェーッ！)」");
    changeSpeaker("田中治郎");
    await displayMessage("「や、やめろぉぉぉぉぉおおお！来るなァーーーッ！」");
    changeSpeaker("");
    await displayMessage("田中治郎は、必死の抵抗も虚しくホブゴブリンの右手の一撃で脳髄が吹き飛び絶命した...");
    await showChapter2BadEnding("バッドエンディング3：脳漿炸裂おじさん");
    return await scene2_CaveInfiltrationChoice(); // ★やり直し
  }
  
  if (picked.next === "B") {
    changeSpeaker("田中治郎");
    await displayMessage("「青椒さん。頼みがあります...」");
    changeSpeaker("青椒");
    await displayMessage("「はい、なんでしょうか...」");
    changeSpeaker("田中治郎");
    await displayMessage("「青椒さんが声でゴブリンたちをここへ誘導して、青椒さんに気を取られた隙に僕が背後から攻撃します！お願いします...！」");
    changeSpeaker("");
    await displayMessage("この方法は青椒さんにも危険が及ぶが、敵の意表を突ける。頑張ってもらうしか方法はない...！");
    await displayMessage("青椒さんはすこし黙り込んだあと、静かに頷いた。");
    changeSpeaker("青椒");
    await displayMessage("「では三、二、一の合図で始めます....」");
    changeSpeaker("");
    await displayMessage("ホブゴブリン、ゴブリンがこちらの声が届く距離に来た...！");
    changeSpeaker("青椒");
    await displayMessage("「三、二.......一！」");
    changeSpeaker("");
    await displayMessage("合図とともに青椒さんが声を出す。「ﾋﾟｷﾞｬｰーーーー！」\n一瞬ゴブリンの鳴き声かと思うほどの奇声は、一気に敵のヘイトを買った。ぞろぞろとゴブリンたちが青椒さんの方向をめがけて駆けてくる。");
    await displayMessage("背後を取った！今だ！\nザクッ！ザクッ！グサッ！\n一体、二体、確実に仕留めていく。");
    await displayMessage("............\n.............しかし予想外なことにゴブリンが一気に来すぎた！このままでは殺しきれずに青椒さんが...ッ！");
    changeSpeaker("青椒");
    await displayMessage("「ひ、ひぃ！や、やめてくださいーー！」");
    changeSpeaker("田中治郎");
    await displayMessage("「青椒さんッッ！」");
    changeSpeaker("");
    await displayMessage("青椒さんの声に引き寄せられたゴブリンは、青椒さんを捕まえると、持っていた斧やナイフで滅多刺しにして殺してしまった,,,,,,");
    changeSpeaker("田中治郎");
    await displayMessage("「全部....俺のせいだ.....」");
    changeSpeaker("");
    await displayMessage("すると、一際大きな足音が目の前で停まる。");
    changeSpeaker("ホブゴブリン");
    await displayMessage("「フゴッゴ！フゴフゴー！(オデタチノナワバリヲアラシタノハオマエカ...！デッタイニユルサナイ！！)」");
    changeSpeaker("");
    await displayMessage("俺は、死を覚悟し、ゴブリンに殺される前に首を掻っ切った。");
    await showChapter2BadEnding("バッドエンディング4：漢の流儀");
    return await scene2_CaveInfiltrationChoice(); // ★やり直し
  }
  
  // C: 正面に躍り出る → 危機一髪だが、謎の液体が活躍して正解ルートに繋がる
  changeSpeaker("");
  await displayMessage("何を思ったのか治郎はゴブリンたちの正面に躍り出てしまった。");
  changeSpeaker("青椒");
  await displayMessage("「！！！なにやってるんですか治郎さん！！！」");
  changeSpeaker("田中治郎");
  await displayMessage("「.....しまった！咄嗟に飛び出てしまった！」");
  changeSpeaker("");
  await displayMessage("ゴブリン達は治郎を見るに、束になって襲いかかってきた。通常のゴブリンはちゃんと対応すれば一体ずつ殺せる。しかし-----------ホブゴブリンは違う...");
  await displayMessage("圧倒的な体格差。勝てるはずもない...振り下ろされた拳を防ぐために、咄嗟に手持ちの武器でガードを試みるが、その硬い皮膚には効かず、砕けてしまった。");
  changeSpeaker("田中治郎");
  await displayMessage("「ッッッ！クソ！なんてことだ！もう後はない....」");
  changeSpeaker("青椒");
  await displayMessage("「治郎さん！なんてことだ...もう終わりだぁ...」");
  changeSpeaker("田中治郎");
  await displayMessage("「.........ん？」");
  changeSpeaker("");
  await displayMessage("------------ふと、ポケットに違和感を感じた。最後の力でまさぐってみると、ついさっき手に入れた謎の液体入りの瓶があった。");
  await displayMessage("「....！」\nこれは！名前書いてないから大事なものじゃないやつ！！こうなったらもうヤケだ！");
  changeSpeaker("田中治郎");
  await displayMessage("「くらいやがれッ！俺の最強の切り札ァーーーーーーッ！」");
  changeSpeaker("");
  await displayMessage("瓶の蓋を開け、今残っている力のすべてを使い全力投球した。");
  await displayMessage("----------\n-----パシャリ......\n謎の液体がホブゴブリンに降りかかる。");
  changeSpeaker("ホブゴブリン");
  await displayMessage("「フガァァァァァァァァァアアア！(痛っっってぇぇぇぇぇぇぇ！)」");
  changeSpeaker("");
  await displayMessage("ゴブリンの集団に降りかかったそれは、みるみるホブゴブリンを弱体化させてゆく....");
  changeSpeaker("田中治郎");
  await displayMessage("「え？」");
  changeSpeaker("青椒");
  await displayMessage("「もしかしてあれは！プシ硫酸！」");
  changeSpeaker("");
  await displayMessage("硫酸....？\nそうか！硫酸がゴブリンたちの皮膚を溶かしてホブゴブリンの硬い皮膚を弱体化させたんだ！");
  changeSpeaker("田中治郎");
  await displayMessage("「今なら....！！！」");
  removeItem("mystery_liquid", 1); // inventory.js（使い切った）
}

// バッドエンドの短い演出：GAME OVERの見出しを出すだけの簡易版
async function showChapter2BadEnding(label) {
  await showSpecialScene("GAME OVER\n（" + label + "）"); // mainfunc.js
}

// ===== ⑤ボス戦：ホブゴブリンの群れ =====
async function scene2_BossBattle() {
  // ★ここでBGMを変えなくても、startBattle()の中でボス専用BGM（boss.jsのhobgoblin_packのbgmTrack）に
  //   自動で切り替わる。手前で別の曲を鳴らしてもすぐ上書きされてしまうので、ここでは鳴らさない
  await displayMessage("硫酸で弱体化したホブゴブリンたちに向け、渾身の力で挑む……！");
  
  const battleOutcome = await startBattle("hobgoblin_pack", { isScripted: true }); // battle.js（"win" か "defeat" が返る。シナリオボスなので途中で逃げることはできない）
  
  if (battleOutcome !== "win") {
    changeSpeaker("");
    await displayMessage("硫酸で弱っていたとはいえ、複数のホブゴブリン相手には力及ばず......意識が遠のいていく。");
    await showChapter2BadEnding("バッドエンディング：ホブゴブリンの群れ");
    return await scene2_BossBattle(); // ★やり直し
  }
  
  changeSpeaker("田中治郎");
  await displayMessage("「よし！勝てた...！勝てたんだ...！」");
  
  changeSpeaker("");
  await displayMessage("だが、治郎は忘れていた....ホブゴブリンは4体いることを......");
  
  changeSpeaker("ホブゴブリン");
  await displayMessage("「フゴォォォォオオオオオ！(マジ許さん死ねェーーーッ！)」");
  
  changeSpeaker("");
  await displayMessage("グチャッ......脳漿が飛び散る音。一瞬の油断により、田中治郎は絶命した。");
  await displayMessage("......かに思えた....\nしかし、飛び散ったそれは、治郎のものではなかった。");
  
  changeSpeaker("竜殺し");
  await displayMessage("「心配になって一応着いてきたら、ホブゴブリンの巣があったのね。油断したら負けよ。ヒョロガリ。」");
  
  changeSpeaker("田中治郎");
  await displayMessage("「お、お前は...！」");
  
  changeSpeaker("");
  await displayMessage("そこには、「竜殺し」と呼ばれる、狂戦士の姿があった.......");
  
  stopScenarioBGM({ fadeMs: 800 }); // bgm.js
}

// ===== ⑥数日後のお礼〜竜殺しからのパーティー勧誘〜結末 =====
async function scene2_Aftermath() {
  await showSpecialScene("数日後");
  setBackgroundImage("img/村.jpeg");
  switchScenarioBGM("scene2_tavern", { fadeMs: 800 }); // bgm.js
  
  changeSpeaker("青椒");
  await displayMessage("「いやぁ、先日の件は本当にありがとうございました！おかげで妻は軽い怪我で済み、他の女性たちも何もされずに助かったようです！」");
  
  changeSpeaker("ビャンビャン");
  await displayMessage("「本当に感謝してもしきれません！助けていただきありがとうございました！」");
  
  changeSpeaker("");
  await displayMessage("青椒さんと𰻞𰻞さんに先日の一件のお礼をされた。");
  
  changeSpeaker("青椒");
  await displayMessage("「あ、これ、あまりいいものは用意できなかったのですが、せめてものお礼です。」");
  
  changeSpeaker("");
  await displayMessage("青椒さんが何かを手渡してきた。なんだ、これ....変な形をしているな....でもどこかで見たような...");
  addItem("milking_machine", 1); // items.js
  
  changeSpeaker("青椒");
  await displayMessage("「あ、それは乳絞り機です！この村名産の「爆牛」のミルクを取るための機械です！この村の道具屋さんのご主人が裏で牧場を営んでいて、この機会を持って頼めば搾りたてミルクをくださると思います！」");
  
  changeSpeaker("");
  await displayMessage("は、はぁ.....正直に言うと、、、、、本当にいらないんだが.......");
  
  changeSpeaker("田中治郎");
  await displayMessage("「あ、ありがとうございます....」");
  
  changeSpeaker("");
  await displayMessage("そういって、青椒さん御夫婦と別れ、宿屋までの道のりを歩く。異世界に来てからいろいろなことがあった...やる気のない神様に適当にここへ送られるし、上位種のゴブリンに殺されかけるし...もうすでに何回か殺されたような気分だよ....");
  await displayMessage("そう考えながら歩いていると、見覚えのある人影があった。");
  
  changeSpeaker("竜殺し");
  await displayMessage("「久しぶりね。「一文無しの放浪者」さん。」");
  
  changeSpeaker("");
  await displayMessage("「.....ぇえ......」\nなんでこいつがいるんだ....ていうかその名前で呼ぶなよ...！");
  
  changeSpeaker("田中治郎");
  await displayMessage("「ど、どうしたんだ？」");
  
  changeSpeaker("竜殺し");
  await displayMessage("「提案があるの。私とパーティーを組まない...？」");
  
  changeSpeaker("");
  await displayMessage("「.....................................え？」\nそれは、唐突すぎる提案だった。");
  
  changeSpeaker("竜殺し");
  await displayMessage("「あなた、外見はヒョロガリで頼りなさそうなフニャチンに見えるけど、独りで巣のほぼすべてのゴブリン達を倒していて驚いたわ。」");
  
  changeSpeaker("田中治郎");
  await displayMessage("「へへ、ありがとうございます」");
  
  changeSpeaker("竜殺し");
  await displayMessage("「この付近の冒険者ではあなたが一番信頼できそうだし、私とパーティーを組んで効率的に強くなろうって話。」");
  
  changeSpeaker("");
  await displayMessage("意外だ。こいつは自分以外足元のアリほどにしか見えてないようなやつだと思ってたから、他人を少しでも信頼できそうと思うなんて思っても見なかった.......");
  
  changeSpeaker("田中治郎");
  await displayMessage("「..........こちらからすると、正直かなり魅力的な提案だ。」");
  
  changeSpeaker("竜殺し");
  await displayMessage("「..！......でしょ！」");
  
  changeSpeaker("");
  await displayMessage("ここは、どうする....？");
  
  const picked = await displayChoices([
    { text: "断ってみる", next: "A" },
    { text: "パーティーを組む", next: "B" }
  ]);
  
  if (picked.next === "A") {
    await scene2_SoloEnding();
  } else {
    await scene2_PartyEnding();
  }
}

// A: 断る →「トゥルーエンド」（一人旅を貫くルート。ゲームとしては引き続きプレイできる）
async function scene2_SoloEnding() {
  changeSpeaker("竜殺し");
  await displayMessage("「ああ、約束するわ。お互いの力で強くなる。ギブ アンド テイクよ。さあ、酒場にパーティー申請しに行きましょ。」");
  
  changeSpeaker("");
  await displayMessage("「..........」");
  changeSpeaker("田中治郎");
  await displayMessage("「だが断る」");
  
  changeSpeaker("竜殺し");
  await displayMessage("「ナニッ!!」");
  
  changeSpeaker("田中治郎");
  await displayMessage("「この田中治郎が最も好きな事のひとつは\n自分で強いと思ってるやつに\n『NO』と断ってやる事だ…」");
  
  changeSpeaker("竜殺し");
  await displayMessage("「あ、そ。」");
  
  changeSpeaker("");
  await displayMessage("こうして、田中治郎はこの世界でも天涯孤独で一生を終えたのである......");
  
  player.chapter2Ending = "solo"; // ★どちらのルートを選んだかの記録（今のところ演出以外には使っていない）
  markChapter2Cleared(); // ★第一話と同じく、この手書きの第二話でもクリア記録が抜けていたため追加
  await showSpecialScene("『完』\nトゥルーエンド「そして伝説()へ...」");
  
  changeSpeaker("");
  await displayMessage("……とはいえ、この村での暮らしはまだまだ続く。田中治郎は今日もひとり、冒険者としての日々を歩んでいく。");
  
  openTownMenu(); // town.js
}

// B: パーティーを組む → 竜殺し（ケツァナ）と正式に仲間になる
async function scene2_PartyEnding() {
  changeSpeaker("竜殺し");
  await displayMessage("「そりゃあもちろん。」");
  
  changeSpeaker("");
  await displayMessage("....");
  
  changeSpeaker("竜殺し");
  await displayMessage("「YES I AM!」\nバーン");
  
  changeSpeaker("田中治郎");
  await displayMessage("「...........そこは、YES I WILLじゃないの...？」");
  
  changeSpeaker("竜殺し");
  await displayMessage("「....このくだりにちゃんと反応してくれる人初めて見た.....」");
  
  changeSpeaker("竜殺し");
  await displayMessage("「ところであなた名前は？二つ名しか知らなかったし呼びやすいように一応言っておきましょう。私は「ケツァナ」よ。ツァナと呼んでくれていいわ。」");
  
  changeSpeaker("田中治郎");
  await displayMessage("「俺は治郎。これからよろしく。」");
  
  changeSpeaker("");
  await displayMessage("かくして治郎と竜殺しことケツァナは、冒険をともにするパーティーとなった。治郎にとっては初めての「仲間」である。");
  
  player.chapter2Ending = "party"; // ★どちらのルートを選んだかの記録
  player.hasPartner = true; // ★仲間ができたことの記録
  markChapter2Cleared(); // ★第一話と同じく、この手書きの第二話でもクリア記録が抜けていたため追加
  if (typeof ensureCustomCompanionsRegistered === "function") ensureCustomCompanionsRegistered(); // scenariobuild.js
  if (typeof addCompanionToParty === "function") addCompanionToParty("ketsuna", player.level); // player.js（主人公と同じレベルで仲間になる）
  
  await showSpecialScene("第二話、おしり。");
  
  openTownMenu(); // town.js
}