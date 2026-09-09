// builtin_chapters_seed.js
// ★第一話（scenario.js）・第二話（scenario2.js）の内容を、シナリオビルドのブロック形式に変換したもの。
//   scenariobuild.jsのnormalizeScenarioProject()が、初回読み込み時にこれを使って
//   builtin_chapter1 / builtin_chapter2 の中身（blocks）を組み立てる。
//   ここでのブロックは全て通常のブロックと同じ扱いなので、シナリオビルド画面から自由に
//   編集・削除・並び替えができる（元のscenario.js/scenario2.js自体は変更していない。
//   ブロックが1つも無い状態まで削除すると、tryRunBuiltinChapterOverride()がfalseを返し、
//   フォールバックとして元のscenario.js/scenario2.jsがそのまま動く仕組みになっている）。
//
// ★ヘルパー：createBlock(type)はscenariobuild.js側の関数（idを自動採番してくれる）をそのまま使う。

// 会話ブロックを1つ作る小さなヘルパー（このファイル内だけで使う）
function _seedDialogue(speaker, text) {
  const b = createBlock("dialogue");
  b.speaker = speaker;
  b.text = text;
  return b;
}
function _seedNarration(text) {
  const b = createBlock("narration");
  b.text = text;
  return b;
}
function _seedTelop(text) {
  const b = createBlock("telop");
  b.text = text;
  return b;
}
function _seedBackground(path) {
  const b = createBlock("background");
  b.path = path;
  return b;
}
function _seedBgm(track) {
  const b = createBlock("bgm");
  b.track = track;
  return b;
}
function _seedFlag(flagName, mode) {
  const b = createBlock("flag");
  b.flagName = flagName;
  b.mode = mode || "on";
  return b;
}
function _seedGive(itemId, quantity) {
  const b = createBlock("give");
  b.itemId = itemId;
  b.quantity = quantity || 1;
  return b;
}
function _seedTakeItem(itemId, quantity) {
  const b = createBlock("takeitem");
  b.itemId = itemId;
  b.quantity = quantity || 1;
  return b;
}
// ★このエンジンには汎用の「goto」ブロックが無いため、選択肢が1つだけの choice ブロックを
//   「続ける」ボタンとして使い、任意のブロックへジャンプする代用にしている
//   （バッドエンド後に同じ選択肢へ戻る、等のループ表現に使う）
function _seedGoto(targetId, label) {
  const b = createBlock("choice");
  b.prompt = "";
  b.options = [{ id: generateId("opt"), text: label || "……", jumpBlockId: targetId }];
  return b;
}

// ===================================================================
// ===== 第一話：転生〜職業選択〜カリの村〜酒場〜冒険者登録まで（scenario.js） =====
// ===================================================================
function buildChapter1SeedBlocks() {
  const blocks = [];
  const push = (b) => { blocks.push(b); return b; };
  
  // ===== 導入：田中治郎、死亡（黒背景） =====
  push(_seedBackground("#000000"));
  push(_seedNarration("俺は35歳のDT、田中治郎。ブラック企業に勤めて早13年、毎日が死んだような生活をしていた……"));
  push(_seedNarration("そんなある日、横断歩道を歩いていると、信号無視をした異世界トラックが突っ込んできて、俺はそのまま死んだんだ……"));
  push(_seedTelop("目が覚めたら……"));
  
  // ===== 神様との対話・職業選択（白背景の部屋） =====
  push(_seedBackground("#ffffff"));
  push(_seedNarration("そこには神様？がいた。"));
  push(_seedDialogue("神様？", "あー、ワシ、神様だから。君、死んで違う世界に行くことになったんで。とりあえず説明だけするね。"));
  push(_seedNarration("神様？は鼻をほじりながら口を開いた。"));
  push(_seedDialogue("神様？", "実はね、君が死んだあと、今の日本では人手不足がすごくてね。本当は向こうの世界に適した魂を持ってた人が選ばれるんだけど、君は仕方なく選ばれたの。だからこのまま他の世界に転生するんだけど……何か質問ある？"));
  push(_seedDialogue("田中治郎", "あのー、俺みたいなブラック企業で働いてる社畜でも異世界に転生できるんですか？あとチートは貰えますか？"));
  push(_seedDialogue("神様？", "あー、大丈夫大丈夫。ちゃんとチートはあげるし、異世界には魔王とかも居ないから...たぶん。ま、とりあえず職業選んで。ちなみに職業ごとに固有スキルがあるから。"));
  push(_seedNarration("もちろん俺は……"));
  
  // ★職業選択〜職業ごとの神様との掛け合いまで、まるごとこの専用ブロックが担当する（scenario.jsの37〜133行目相当）
  push(createBlock("classselect"));
  
  push(_seedNarration("職業を選び終えたあと、神様がほじり出した鼻くそを口に運び最後にこう伝えた..."));
  push(_seedDialogue("神様？", "じゃあ、異世界満喫してね。ワシは次の転移者の対応しなきゃだから、ばいばい。あー忙し...だりぃなこれ..."));
  push(_seedDialogue("田中治郎", "なんだこの神！"));
  push(_seedTelop("そして、目が覚めると……そこは森の中だった……"));
  
  // ===== 森の中〜カリの村 =====
  push(_seedBackground("#0d1f13"));
  push(_seedDialogue("田中治郎", "まずはギルドに行ってみようかな？"));
  push(_seedDialogue("田中治郎", "てゆーかギルドってものがこの世界にあるのかしら？"));
  push(_seedNarration("考えても仕方がない、おもいきり丸腰の状態で魔物なんかにあってしまったらひとたまりもないからな..."));
  push(_seedNarration("てかあの神チートスキル渡し忘れてるじゃねーか！！！"));
  push(_seedNarration("俺は渋々立ち上がり周囲を見渡した。"));
  push(_seedDialogue("田中治郎", "さて……これからどうするか……"));
  push(_seedNarration("考えているうちに木々の間にぼんやりと建物のような影が見えてきた。おそらく村か町かもしれない。"));
  push(_seedDialogue("田中治郎", "とりあえず行ってみるしかねぇな……"));
  
  // ===== カリの村に到着 =====
  push(_seedBackground("img/村.jpeg"));
  push(_seedNarration("森を抜けるとそこには小さな村があった。看板を見るに、「カリの村」というらしい。ここではどうやら農作物や牧畜が盛んに行われており、村人たちも穏やかに暮らしているようだ。"));
  push(_seedNarration("ふと、酒場らしき看板が見えた。"));
  push(_seedDialogue("田中治郎", "とりあえず、酒場に行ってみるか..."));
  
  // ===== 酒場：もめ事の場面 =====
  push(_seedNarration("酒場に着くと、争うような声が聞こえた。"));
  push(_seedDialogue("女性冒険者", "今、私の金盗んだよね？返しなさいよ！"));
  push(_seedDialogue("屈強な男", "わ、悪かった...!金は返すよ...だから勘弁してくれ!"));
  push(_seedNarration("そこには若い女と屈強な男がいた。女の方は...格好からして戦士系か...?"));
  push(_seedNarration("あまり関わりたくはないな...絡まれるのはゴメンだ..。さて……どうする？"));
  
  // ★3択（B・Cは寄り道して同じ選択肢に戻ってくるループ。scenario.jsのdo-whileに相当）
  const barChoice = createBlock("choice");
  barChoice.prompt = "";
  const optA = { id: generateId("opt"), text: "女性に近づき仲裁に入る", jumpBlockId: null }; // ★falseなので下に続けて配置する通常進行にする
  const optB = { id: generateId("opt"), text: "静かに店の外へ出て別の情報収集を試みる", jumpBlockId: null };
  const optC = { id: generateId("opt"), text: "店主に事情を聞いて情報を集める", jumpBlockId: null };
  barChoice.options = [optA, optB, optC];
  push(barChoice);
  
  // B：情報収集せず抜け出す→また戻ってくる
  const pathB1 = push(_seedNarration("俺は黙って踵を返し、酒場からそっと抜け出そうとした。外へ出ると空気がひんやりとして気持ち良かった。"));
  optB.jumpBlockId = pathB1.id;
  push(_seedNarration("しかし情報収集が必要だと改めて思う。近くにいる村人に話しかけてみることにした。"));
  push(_seedNarration("……そうこうしているうちに、酒場の中からはまだ言い争う声が聞こえてくる。結局、気になって酒場に引き返すことにした。"));
  push(_seedGoto(barChoice.id, "（酒場に戻る）"));
  
  // C：店主に話を聞く→また戻ってくる
  const pathC1 = push(_seedNarration("カウンター席へ座るとすぐに主人が注文を聞きに来た。"));
  optC.jumpBlockId = pathC1.id;
  push(_seedDialogue("田中治郎", "エールひとつお願いします"));
  push(_seedNarration("エールを受け取り一口飲むと冷たい泡と共に苦味と旨味が広がった。"));
  push(_seedDialogue("田中治郎", "あそこの女性はだれなんですか？とりあえず今の状況を把握したいので聞いてみる。"));
  push(_seedDialogue("店主", "あぁ、あいつはな、ここらへんではそこそこ有名なソロ冒険者だ、職業は狂戦士(バーサーカー)で、「竜殺し」という二つ名で呼ばれているよ。"));
  push(_seedDialogue("田中治郎", "本名はわかりますか？"));
  push(_seedNarration("店主は少し顔をしかめたあと、笑って言った。"));
  push(_seedDialogue("店主", "あんた本気で言ってるのかい？ここでは本名を言うことはすなわち服従を意味するんだよ。誰も本名は自分から言ったりしないさ。ハッハッハ"));
  push(_seedNarration("なるほど、そういうものなのか……確かに自分の正体を相手に悟らせないようにするために偽名を使うのは当然のことか.."));
  push(_seedNarration("エールを飲み終えた頃、まだあの二人の言い争いは続いていた。仕方なく、様子を見に戻ることにした。"));
  push(_seedGoto(barChoice.id, "（酒場に戻る）"));
  
  // A：仲裁に入る→分岐合流
  const pathA1 = push(_seedDialogue("田中治郎", "私は警戒しながらも静かに近づき、喧嘩をしている二人組へ声をかけた。"));
  optA.jumpBlockId = pathA1.id;
  push(_seedDialogue("田中治郎", "ちょっと待ってくれ。ここで揉めていても解決にはならないだろう？お互い冷静になって話し合わないか？"));
  push(_seedNarration("女性は鋭い目つきで俺を見据える。"));
  push(_seedDialogue("女性冒険者", "あんた誰？部外者は引っ込んでなさいよ"));
  push(_seedDialogue("女性冒険者", "ごめんけどこれはこっちの問題なの"));
  push(_seedNarration("その隙に男が逃げ出してしまった。"));
  push(_seedDialogue("女性冒険者", "ああっ！ちょっと！逃げられたじゃないの！！どうしてくれるのよ！"));
  push(_seedNarration("彼女はとてつもなく怒りながら酒場を出ていってしまった。仕方がないので店主に冒険者登録出来ないか聞いてみることにした。"));
  push(_seedDialogue("田中治郎", "あの、冒険者になるにはどうすればいいですか？"));
  push(_seedDialogue("店主", "なるほど冒険者になりに来たわけか。それならここで出来るぞ。クエストもここで受注できるから。ちなみに二つ名は自分以外の人から決めてもらう必要があるから、俺が決めてやろう...."));
  push(_seedDialogue("店主", "うーん...今日からあんたは「一文無しの放浪者」だ。"));
  push(_seedNarration("...なんてひどい二つ名だろう...しかしこれじゃないと冒険者になれないわけか..."));
  push(_seedDialogue("店主", "わかってると思うが、真名だけは絶対に誰にも言うんじゃないぞ。真名を言うことは奴隷になるようなものだからな。"));
  push(_seedDialogue("田中治郎", "わ、わかりました..."));
  push(_seedNarration("苦笑いで酒場を後にし、やっと冒険の始まりである......."));
  
  // ===== 第一話 終了処理 =====
  const setrankBlock = createBlock("setrank");
  setrankBlock.nickname = "一文無しの放浪者";
  push(setrankBlock);
  
  push(_seedTelop("第一話 完"));
  
  // ★第二話の解放条件（requiredChapterId: "builtin_chapter1"）は、この話が
  //   「クリア済み」になっていることを前提にしている。以前はここにclearchapterブロックが
  //   無く、ブロック実行版の第一話をプレイするといつまでもchapter.clearedがfalseのままになり、
  //   条件（日数・進行度）を満たしていても第二話が絶対に始まらないバグの原因になっていた。
  //   元のscenario.js（ブロック未使用時のフォールバック）は進行度をリセットしないので、
  //   ここでも合わせてresetProgress: falseにしておく
  const clearBlock = createBlock("clearchapter");
  clearBlock.resetProgress = false;
  push(clearBlock);
  
  return blocks;
}

// ===================================================================
// ===== 第二話：初めての〇〇(チュウではない)（scenario2.js） =====
// ===================================================================
// ===================================================================
// ===== 第二話：初めての〇〇(チュウではない)（scenario2.js） =====
// ===== ★2026-08-08 に、シナリオビルド画面で大幅加筆されたデータを取り込み済み（バッドエンド5「ホブゴブ堕ち」追加、ホブゴブリンの護衛2体追加など） =====
// ===================================================================
// ★このデータはJSON形式のブロック配列をそのまま貼り付けたもの（シナリオビルドの「データ管理」からの書き出しデータを変換）。
//   構造は他の話と同じで、シナリオビルド画面から通常通り編集・削除できる。
function buildChapter2SeedBlocks() {
  return [
  {
    "id": "block_1786183133327_77",
    "type": "bgm",
    "track": "town"
  },
  {
    "id": "block_1786183133327_78",
    "type": "narration",
    "text": "先日の一件から数日経った頃……俺は酒場で主人と話をしていた。"
  },
  {
    "id": "block_1786183133327_79",
    "type": "dialogue",
    "speaker": "店主",
    "text": "あ、そうだ兄ちゃん。最近までこの村に来ていたマッドサイエンティストの「デッパ」というやつがなんかよくわからん液体の入った瓶を俺に無理やり渡して行きやがってな……よかったらやるよ。これ。"
  },
  {
    "id": "block_1786183133327_80",
    "type": "narration",
    "text": "主人はそのマッドサイエンティストとやらが置いていったという「よくわからん謎の液体入り瓶」を手渡してきた。"
  },
  {
    "id": "block_1786183133327_81",
    "type": "give",
    "itemId": "mystery_liquid",
    "quantity": 1
  },
  {
    "id": "block_1786183133327_82",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "....えぇ....？いや、別にいらないんですが....."
  },
  {
    "id": "block_1786183133327_83",
    "type": "dialogue",
    "speaker": "店主",
    "text": "まぁまぁ！この瓶名前書いてないしきっと大事なやつじゃないんだろ！とりあえず持っとけ！なにか役に立つかもしれんしな！"
  },
  {
    "id": "block_1786183133327_84",
    "type": "narration",
    "text": "...ただ単にいらないから渡してきただけだよな....."
  },
  {
    "id": "block_1786183133327_85",
    "type": "narration",
    "text": "そうしていると、聞き覚えのある声が聞こえてきた。"
  },
  {
    "id": "block_1786183133327_86",
    "type": "dialogue",
    "speaker": "竜殺し",
    "text": "何このクエスト！なんでこんな低級依頼ばっかなのよ！"
  },
  {
    "id": "block_1786183133327_87",
    "type": "narration",
    "text": "俺は声のほうをちらりと見た。やはりあの時の女性だった……"
  },
  {
    "id": "block_1786183133327_88",
    "type": "narration",
    "text": "うわ...またなんか言ってるよ..."
  },
  {
    "id": "block_1786183133327_89",
    "type": "dialogue",
    "speaker": "店主",
    "text": "竜殺しさん...すみませんが今日はこういう依頼ばっかりなんですよ...まあここは王国外れの村ですし、なかなかそういった依頼は来ませんね..."
  },
  {
    "id": "block_1786183133327_90",
    "type": "narration",
    "text": "主人も困っているようだ。"
  },
  {
    "id": "block_1786183133327_91",
    "type": "dialogue",
    "speaker": "竜殺し",
    "text": "はぁ？最低でももう少しマシな依頼あるでしょ！"
  },
  {
    "id": "block_1786183133327_92",
    "type": "narration",
    "text": "すると、突如扉が開き男が飛び込んできた。"
  },
  {
    "id": "block_1786183133327_93",
    "type": "dialogue",
    "speaker": "男",
    "text": "うぅ...そんな...俺の𰻞𰻞が..."
  },
  {
    "id": "block_1786183133327_94",
    "type": "dialogue",
    "speaker": "竜殺し",
    "text": "ちょっとあんた、何があったの？"
  },
  {
    "id": "block_1786183133327_95",
    "type": "narration",
    "text": "竜殺しが振り返った。"
  },
  {
    "id": "block_1786183133327_96",
    "type": "dialogue",
    "speaker": "男",
    "text": "じ、実は僕の妻の𰻞𰻞が街で魔物に攫われてしまって……お願いします！助けてください！！"
  },
  {
    "id": "block_1786183133327_97",
    "type": "dialogue",
    "speaker": "竜殺し",
    "text": "何言ってんのよ。助けに行きたいのは山々だけど、私は依頼される側なの。"
  },
  {
    "id": "block_1786186622632_393",
    "type": "dialogue",
    "speaker": "竜殺し",
    "text": "あなたクエスト依頼出してないでしょ？やってほしいことがあったらちゃんと報酬と詳細を説明した紙をここに貼り出すことね...！"
  },
  {
    "id": "block_1786183133327_98",
    "type": "narration",
    "text": "竜殺しは腕を組みながら男を見下ろしていた。"
  },
  {
    "id": "block_1786183133327_99",
    "type": "dialogue",
    "speaker": "男",
    "text": "え、あ、そうですか……すみません。初めてなもので"
  },
  {
    "id": "block_1786183133327_100",
    "type": "narration",
    "text": "男は泣きそうになりながら頭を下げた。"
  },
  {
    "id": "block_1786183133327_101",
    "type": "dialogue",
    "speaker": "店主",
    "text": "まあまあ落ち着けよ兄ちゃん……クエストを出すには依頼料がかかる。"
  },
  {
    "id": "block_1786186650968_394",
    "type": "dialogue",
    "speaker": "店主",
    "text": "ここで依頼料を出してクエストを貼るか？ここでなんの報酬もなく助けてもらうのは無理なもんだ...\nここにはそういう連中しかいねえ。"
  },
  {
    "id": "block_1786183133327_103",
    "type": "choice",
    "prompt": "男の人は奥さんがさらわれて本当に困っているようだ、こういうときは...",
    "options": [
      {
        "id": "opt_1786183133328_105",
        "text": "いや、僕が行きますよ！困ってる人がいて見て見ぬふりなんて出来ません！",
        "jumpBlockId": "block_1786183133328_130"
      },
      {
        "id": "opt_1786183133328_106",
        "text": "もしかして奥さんゴブリンにさらわれたんじゃないですか！？えっちなことされてる可能性も！？",
        "jumpBlockId": "block_1786183133328_108"
      },
      {
        "id": "opt_1786183133328_107",
        "text": "ひぃいいい！人を攫うなんて！俺はそんな目に会いたくないっ！",
        "jumpBlockId": "block_1786183133328_118"
      }
    ]
  },
  {
    "id": "block_1786183133328_108",
    "type": "dialogue",
    "speaker": "男",
    "text": "....え...え！？や、やめてください！そんなことがあったら僕は...！！！！！！"
  },
  {
    "id": "block_1786183133328_109",
    "type": "narration",
    "text": "男は真っ青になって震えだした。"
  },
  {
    "id": "block_1786183133328_110",
    "type": "dialogue",
    "speaker": "竜殺し",
    "text": "え、ちょ、あんた...."
  },
  {
    "id": "block_1786183133328_111",
    "type": "narration",
    "text": "周囲の視線が冷たくなった。俺は慌てて取り繕おうとした。"
  },
  {
    "id": "block_1786183133328_112",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "あ、いや！違うんだ！ただちょっと……その可能性もゼロじゃないなと思って！"
  },
  {
    "id": "block_1786183133328_113",
    "type": "dialogue",
    "speaker": "男",
    "text": "そんな、嫌だ...！俺の𰻞𰻞がっ...！"
  },
  {
    "id": "block_1786183133328_114",
    "type": "dialogue",
    "speaker": "店主",
    "text": "まぁまぁ兄ちゃん、確かに否定はできないが、まだ慌てるときじゃないさ..."
  },
  {
    "id": "block_1786183133328_115",
    "type": "choice",
    "prompt": "",
    "options": [
      {
        "id": "opt_1786183133328_117",
        "text": "（続ける）",
        "jumpBlockId": "block_1786183133327_103"
      }
    ]
  },
  {
    "id": "block_1786183133328_118",
    "type": "narration",
    "text": "男の話を聞くだけでもう体が震えてしまう。"
  },
  {
    "id": "block_1786183133328_119",
    "type": "dialogue",
    "speaker": "男",
    "text": "あの……大丈夫ですか……？"
  },
  {
    "id": "block_1786183133328_120",
    "type": "dialogue",
    "speaker": "店主",
    "text": "あーあ、こりゃだめだな。兄ちゃん完全にビビっちゃってるよ……"
  },
  {
    "id": "block_1786183133328_121",
    "type": "dialogue",
    "speaker": "竜殺し",
    "text": "うわぁ...ダッサ..."
  },
  {
    "id": "block_1786183133328_122",
    "type": "narration",
    "text": "竜殺しは蔑むような目で俺の方を見た。そして男は困惑した顔でこちらを見つめている。"
  },
  {
    "id": "block_1786183133328_123",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "ち、違いますよ！？僕はただ……その、あの……怖いのはその……魔物じゃなくて、もし奥さんがその魔物と……つまり……その……いや！何言ってるんだ俺は！"
  },
  {
    "id": "block_1786183133328_124",
    "type": "dialogue",
    "speaker": "竜殺し",
    "text": "ちょっと、あんた落ち着きなさい！変な想像しないで！"
  },
  {
    "id": "block_1786183133328_125",
    "type": "dialogue",
    "speaker": "店主",
    "text": "あれ……兄ちゃん...なんか息荒くなってない？大丈夫？"
  },
  {
    "id": "block_1786183133328_126",
    "type": "narration",
    "text": "竜殺しと店主が呆れたような目でこちらを見ていた。"
  },
  {
    "id": "block_1786183133328_127",
    "type": "choice",
    "prompt": "",
    "options": [
      {
        "id": "opt_1786183133328_129",
        "text": "（続ける）",
        "jumpBlockId": "block_1786183133327_103"
      }
    ]
  },
  {
    "id": "block_1786183133328_130",
    "type": "dialogue",
    "speaker": "男",
    "text": "おお！本当ですか！ありがとうございます！なんとお礼を言えばいいか...！"
  },
  {
    "id": "block_1786183133328_131",
    "type": "dialogue",
    "speaker": "店主",
    "text": "まじか兄ちゃん。驚いたよ。（色んな意味で）そういうことなら頼んだぞ。良い人がいて良かったな。"
  },
  {
    "id": "block_1786183133328_132",
    "type": "dialogue",
    "speaker": "竜殺し",
    "text": "本気なの？馬鹿じゃないの..."
  },
  {
    "id": "block_1786183133328_133",
    "type": "dialogue",
    "speaker": "竜殺し",
    "text": "...私はついていかないからね？何があっても知らないわよ！"
  },
  {
    "id": "block_1786186760598_395",
    "type": "dialogue",
    "speaker": "竜殺し",
    "text": "...まぁ、人を攫うなんて大体は低級ゴブリンの仕業。私はもっとランクの高いクエストを受けたいし...勝手にすれば？"
  },
  {
    "id": "block_1786183567350_343",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "(く、クソ野郎だ！あいつ性格終わってやがる...！)"
  },
  {
    "id": "block_1786183133328_134",
    "type": "narration",
    "text": "と思いつつもとりあえずはこの人の奥さんをさらった魔物がどこにいったのか調べなくてはならない..."
  },
  {
    "id": "block_1786183133328_135",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "あの、まずお名前を聞いてもいいですか？"
  },
  {
    "id": "block_1786183133328_136",
    "type": "dialogue",
    "speaker": "男",
    "text": "あ、はい...私は「青椒(チンジャオ)」と申します。妻は「𰻞𰻞(ビャンビャン)」で、まだ23なんです！お願いします、助けてやってください！なんでもしますから！"
  },
  {
    "id": "block_1786183133328_137",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "ま、まぁまぁ落ち着いて...！....ん？というか、真名は明かしちゃいけないのでは...？"
  },
  {
    "id": "block_1786183133328_138",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "あぁ、真名はたしかに教えてはいけないのですが、ファーストネーム。私で言う「青椒」などは別に良いんですよ。"
  },
  {
    "id": "block_1786183133328_139",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "な、なるほど！たしかにファーストネームくらい言い合えないと生きづらいもんな..."
  },
  {
    "id": "block_1786186798986_396",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "あ、そうだ。僕のほうが名乗るのを忘れていました！僕は治郎です。\nよろしくお願いします！とりあえず奥さんがどこでさらわれたか教えてくれますか？"
  },
  {
    "id": "block_1786183133328_140",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "...はい、よろしくお願いします！妻はニョードー街道で集団でやってきたホブゴブリンたちにさらわれてしまい、どこにいるのかさっぱりです..."
  },
  {
    "id": "block_1786183133328_141",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "ホブゴブリンだって...！？"
  },
  {
    "id": "block_1786183133328_142",
    "type": "narration",
    "text": "聞いたことがある。ゴブリンが突然変異で巨大化した上位種。しかも集団...！"
  },
  {
    "id": "block_1786183133328_143",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "まずいですね...ゴブリン自体もともと同人誌でも大活躍の魔物...しかもホブゴブリンとなると奥さんの奥さんは裂けてしまうでしょう..."
  },
  {
    "id": "block_1786183679904_344",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "....え？同人....誌？ってなんのことです...？"
  },
  {
    "id": "block_1786183701649_345",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "い、いえ！こっちの話です...！"
  },
  {
    "id": "block_1786183721597_346",
    "type": "narration",
    "text": "俺は慌てて首を振った。"
  },
  {
    "id": "block_1786183762809_347",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "とにかく急がないと大変なことになります！すぐに探しに行きましょう！"
  },
  {
    "id": "block_1786183133328_144",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "お願いします……！妻の無事を確かめてください……！"
  },
  {
    "id": "block_1786183133328_145",
    "type": "telop",
    "text": "やがて二人はニョードー街道へ着いた。"
  },
  {
    "id": "block_1786183133328_146",
    "type": "background",
    "path": "img/街道.jpg"
  },
  {
    "id": "block_1786183810871_348",
    "type": "bgm",
    "track": "field_highway"
  },
  {
    "id": "block_1786183133328_147",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "ここがニョードー街道..."
  },
  {
    "id": "block_1786183133328_148",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "はい。ここで妻が..."
  },
  {
    "id": "block_1786183133328_149",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "わかりました。まず近くに痕跡がないか確かめてみましょう。"
  },
  {
    "id": "block_1786183133328_150",
    "type": "narration",
    "text": "とりあえず今重要なのはゴブリンが青椒さんの奥さんを攫い持ち去った場所だな....まずは...."
  },
  {
    "id": "block_1786183133328_151",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "ホブゴブリンたちが通りそうなルートをいくつか考えてみますか……"
  },
  {
    "id": "block_1786183133328_152",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "はい！ぜひお願いします！"
  },
  {
    "id": "block_1786183133328_153",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "ホブゴブリンが住みそうなところといえば洞窟や廃墟が多いですよね？ここら辺に心当たりありませんか？"
  },
  {
    "id": "block_1786183133328_154",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "洞窟……廃墟……？"
  },
  {
    "id": "block_1786183133328_155",
    "type": "narration",
    "text": "青椒さんはしばらく考え込み、"
  },
  {
    "id": "block_1786183133328_156",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "あ、そういえば最近村外れの丘に不審な穴が見つかったって噂がありました。もしかしたらそれが……！"
  },
  {
    "id": "block_1786183133328_157",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "よし、そこを当たってみましょう！案内できますか？"
  },
  {
    "id": "block_1786183133328_158",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "もちろんです！すぐ行きましょう！"
  },
  {
    "id": "block_1786183133328_159",
    "type": "telop",
    "text": "急いでその穴に走る。"
  },
  {
    "id": "block_1786183133328_160",
    "type": "background",
    "path": "img/洞窟.jpg"
  },
  {
    "id": "block_1786183133328_161",
    "type": "bgm",
    "track": "field_cave"
  },
  {
    "id": "block_1786183133328_162",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "...ここが..."
  },
  {
    "id": "block_1786183133328_163",
    "type": "narration",
    "text": "辿り着いたのは、暗く湿っぽい雰囲気の洞窟だった。入り口から漂ってくる嫌な匂いに思わず顔をしかめる。"
  },
  {
    "id": "block_1786183133328_164",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "ここに奥さんがいるかもしれないんですね……"
  },
  {
    "id": "block_1786183133328_165",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "とりあえず罠とか注意しながら奥へ進みましょう。僕の後についてきてください"
  },
  {
    "id": "block_1786183977437_349",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "はい……お願いします……！"
  },
  {
    "id": "block_1786183133328_166",
    "type": "narration",
    "text": "俺は慎重に歩を進め、入り口付近の地面や壁を観察する。"
  },
  {
    "id": "block_1786183133328_167",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "足跡が複数あるな……これは間違いなくホブゴブリンたちが使っている通路だ。それに奥からはイカの匂いもする……"
  },
  {
    "id": "block_1786183133328_168",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "...なんでイカの匂い...？"
  },
  {
    "id": "block_1786183133328_169",
    "type": "narration",
    "text": "青椒さんは怪訝な顔をしたが、奥へ進んでみる。"
  },
  {
    "id": "block_1786183133328_170",
    "type": "narration",
    "text": "...なっ！！ここは...！！"
  },
  {
    "id": "block_1786183133328_171",
    "type": "narration",
    "text": "奥へ進み、木の枠組みで作られた入口の一番奥の部屋を覗いてみると、ホブゴブリンがなんと4体もおり、その周りにゴブリンが30ほどいたのである。"
  },
  {
    "id": "block_1786183133328_172",
    "type": "narration",
    "text": "木で出来た檻の中に複数の女性が...！その中に青椒さんの奥さんもいるようだ……！"
  },
  {
    "id": "block_1786183133328_174",
    "type": "choice",
    "prompt": "どうする……！？",
    "options": [
      {
        "id": "opt_1786183133328_176",
        "text": "様子を見る",
        "jumpBlockId": "block_1786183133328_201"
      },
      {
        "id": "opt_1786183133328_177",
        "text": "突入する",
        "jumpBlockId": "block_1786183133328_179"
      },
      {
        "id": "opt_1786183133328_178",
        "text": "助けを呼ぶ",
        "jumpBlockId": "block_1786183133328_190"
      }
    ]
  },
  {
    "id": "block_1786183133328_179",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "おらぁぁぁぁぁああああ！ホブゴブリンがなんじゃ！我に敵無しィッッッ！"
  },
  {
    "id": "block_1786183133328_180",
    "type": "narration",
    "text": "勢いに身を任せ突入した。"
  },
  {
    "id": "block_1786183133328_181",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "え！？治郎さん！？"
  },
  {
    "id": "block_1786183133328_182",
    "type": "narration",
    "text": "一番近くのホブゴブリンめがけ思い切り力を込め、渾身の一撃を叩き込む...！！"
  },
  {
    "id": "block_1786183133328_183",
    "type": "narration",
    "text": "カキィーーーン！\n持っていた武器はホブゴブリンの硬い皮膚に弾かれ、いとも簡単に俺は武器を失った。"
  },
  {
    "id": "block_1786183133328_184",
    "type": "dialogue",
    "speaker": "ホブゴブリン",
    "text": "フゴ、フゴフゴ(ん？なんかヒョロいおっさんが突撃してきたぞ？お前らどうする？)"
  },
  {
    "id": "block_1786184044823_350",
    "type": "dialogue",
    "speaker": "ホブゴブリン",
    "text": "フゴ、フゴゴー(切り裂いて今晩の食料にしやしょ！アニキ！)"
  },
  {
    "id": "block_1786183133328_185",
    "type": "narration",
    "text": "..................そして気がついたときには俺はまるで輪切りのソ◯ベのような形で綺麗にスライスされ、異世界での一生を終えた........."
  },
  {
    "id": "block_1786183133328_186",
    "type": "gameover",
    "message": "",
    "endingName": "バッドエンディング1：アリーヴェデルチ(さよな◯ンチャ)",
    "retryJumpBlockId": "block_1786183133328_174"
  },
  {
    "id": "block_1786183133328_190",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "きゃぁぁぁぁぁぁああああああああ！だれか助けて！"
  },
  {
    "id": "block_1786183133328_191",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "えええ！？治郎さんどうしてー！？"
  },
  {
    "id": "block_1786183133328_192",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "死にたくねぇよぉォー！ホブゴブリンなんかに勝てるわけがねぇ！！！"
  },
  {
    "id": "block_1786183133328_193",
    "type": "narration",
    "text": "すると、ゴブリンたちがその声に気づいたようだ。"
  },
  {
    "id": "block_1786183133328_194",
    "type": "dialogue",
    "speaker": "ホブゴブリン",
    "text": "フゴゴー？フゴフゴ(なんか人間の声聞こえね？あっちに誰かいるぞ。)"
  },
  {
    "id": "block_1786184110187_351",
    "type": "dialogue",
    "speaker": "ホブゴブリン",
    "text": "フゴ？フゴッゴ、ゴゴッ(え？うわまじだ。だっる。殺そうぜ)"
  },
  {
    "id": "block_1786183133328_195",
    "type": "narration",
    "text": "ホブゴブリンたちは治郎を見つけるなり脚を掴み片手で軽々と持ち上げ、もう片方の手で頭蓋を掴み一気に引き抜いた。"
  },
  {
    "id": "block_1786183133328_196",
    "type": "narration",
    "text": "..........これが、田中治郎の第二の人生の終幕である........"
  },
  {
    "id": "block_1786183133328_197",
    "type": "gameover",
    "message": "",
    "endingName": "バッドエンディング2：田中ソードは容赦をしない",
    "retryJumpBlockId": "block_1786183133328_174"
  },
  {
    "id": "block_1786183133328_201",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "青椒さん。ここはいったん様子を見ましょう...隙を伺うべきです。青椒さんは危ないのでいったん僕の後ろから動かないでください。"
  },
  {
    "id": "block_1786183133328_202",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "わ、わかりました..."
  },
  {
    "id": "block_1786183133328_203",
    "type": "narration",
    "text": "青椒さんは不安そうな表情を浮かべながらも、小さくうなずき、治郎の後ろで様子をうかがっている。"
  },
  {
    "id": "block_1786183133328_204",
    "type": "narration",
    "text": "俺は岩陰に身を隠し、ホブゴブリン達の動きを観察することにした。"
  },
  {
    "id": "block_1786184225627_352",
    "type": "narration",
    "text": "彼らの群れは洞窟内で焚き火を囲み、談笑したり食事をしているようだった。"
  },
  {
    "id": "block_1786184237432_353",
    "type": "narration",
    "text": "その脇には囚われた女性たちの檻。時折彼女たちに向かって下品な笑い声が響き、恐怖におののく悲鳴が混じる。"
  },
  {
    "id": "block_1786183133328_205",
    "type": "dialogue",
    "speaker": "囚われの女性",
    "text": "私たちもうここで一生を終えるんだ...終わった..."
  },
  {
    "id": "block_1786183133328_206",
    "type": "dialogue",
    "speaker": "𰻞𰻞",
    "text": "ま、まだそうと決まったわけじゃないよ！抜け出す手があるかもしれない！\n...それまで耐えよう...？"
  },
  {
    "id": "block_1786183133328_207",
    "type": "dialogue",
    "speaker": "囚われの女性",
    "text": "嫌だよ！こんなの耐えられない！何をされるのかわからないし！"
  },
  {
    "id": "block_1786183133328_208",
    "type": "dialogue",
    "speaker": "𰻞𰻞",
    "text": "うん、私も同じ気持ちだよ……でも今は……"
  },
  {
    "id": "block_1786184308381_354",
    "type": "dialogue",
    "speaker": "囚われの女性",
    "text": "……あ、見て！人が入ってきてる！"
  },
  {
    "id": "block_1786183133328_209",
    "type": "dialogue",
    "speaker": "囚われの女性たち",
    "text": "た、たすけて...！"
  },
  {
    "id": "block_1786183133328_210",
    "type": "narration",
    "text": "女性たちが治郎に気づき、小声で助けを求める。"
  },
  {
    "id": "block_1786183133328_211",
    "type": "narration",
    "text": "その時、腰をヘコヘコさせながら檻の方へ近づいていくホブゴブリンがいた。奴らは今にも何かしでかしそうな様子だった。"
  },
  {
    "id": "block_1786183133328_212",
    "type": "narration",
    "text": "突入するならホブゴブリンたちがこっちを見ていない今か...！？\n考えろ、考えるんだ...何かないか...！"
  },
  {
    "id": "block_1786183133328_213",
    "type": "choice",
    "prompt": "",
    "options": [
      {
        "id": "opt_1786183133328_215",
        "text": "たいまつに火を付け投げ込み、おびき寄せ、満身創痍のゴブリンを迎え撃つ",
        "jumpBlockId": "block_1786183133328_218"
      },
      {
        "id": "opt_1786183133328_216",
        "text": "青椒さんに声でゴブリンたちを誘導してもらい、その間に背後から攻撃する",
        "jumpBlockId": "block_1786183133328_232"
      },
      {
        "id": "opt_1786183133328_217",
        "text": "ゴブリン達の正面に躍り出る",
        "jumpBlockId": "block_1786183133328_254"
      }
    ]
  },
  {
    "id": "block_1786183133328_218",
    "type": "narration",
    "text": "...これだ....！ゴブリン◯レイヤーでもやってたこの方法なら...！"
  },
  {
    "id": "block_1786183133328_219",
    "type": "narration",
    "text": "持っていたたいまつに火を付け、最奥の部屋の入口に放り投げた。木で出来た枠組みに引火し、ゴブリンたちが慌てて外へ出ようとする。"
  },
  {
    "id": "block_1786183133328_220",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "今だァッッッ！！！"
  },
  {
    "id": "block_1786183133328_221",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "さすが治郎さん！頭いい！"
  },
  {
    "id": "block_1786183133328_222",
    "type": "narration",
    "text": "燃えながら逃げてきたゴブリンを一体、二体と葬る。そしてお目当ての....\"ホブゴブリン\"！"
  },
  {
    "id": "block_1786183133328_223",
    "type": "narration",
    "text": "カキィィィィィィイイイイーーーーン！"
  },
  {
    "id": "block_1786184736245_355",
    "type": "narration",
    "text": "渾身の力を込めて放った一撃は、ホブゴブリンの硬い皮膚に弾かれてしまった....."
  },
  {
    "id": "block_1786183133328_224",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "ば、.....馬鹿なァッッッ！！！！"
  },
  {
    "id": "block_1786183133328_225",
    "type": "dialogue",
    "speaker": "ホブゴブリン",
    "text": "フゴ、フゴフゴゴォッッッ！(ワイの部屋に放火したんお前か！)"
  },
  {
    "id": "block_1786184770761_356",
    "type": "dialogue",
    "speaker": "ホブゴブリン",
    "text": "フゴフゴフーッッッ！(ホンマ許さんでェーッ！)"
  },
  {
    "id": "block_1786183133328_226",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "や、やめろぉぉぉぉぉおおお！来るなァーーーッ！"
  },
  {
    "id": "block_1786183133328_227",
    "type": "narration",
    "text": "田中治郎は、必死の抵抗も虚しくホブゴブリンの右手の一撃で脳髄が吹き飛び絶命した..."
  },
  {
    "id": "block_1786183133328_228",
    "type": "gameover",
    "message": "",
    "endingName": "バッドエンディング3：脳漿炸裂おじさん",
    "retryJumpBlockId": "block_1786183133328_213"
  },
  {
    "id": "block_1786183133328_232",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "青椒さん。頼みがあります..."
  },
  {
    "id": "block_1786183133328_233",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "はい、なんでしょうか..."
  },
  {
    "id": "block_1786183133328_234",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "青椒さんが声でゴブリンたちをここへ誘導して、青椒さんに気を取られた隙に僕が背後から攻撃します！お願いします...！"
  },
  {
    "id": "block_1786183133328_235",
    "type": "narration",
    "text": "この方法は青椒さんにも危険が及ぶが、敵の意表を突ける。頑張ってもらうしか方法はない...！"
  },
  {
    "id": "block_1786183133328_236",
    "type": "narration",
    "text": "青椒さんはすこし黙り込んだあと、静かに頷いた。"
  },
  {
    "id": "block_1786183133328_237",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "では三、二、一の合図で始めます...."
  },
  {
    "id": "block_1786183133328_238",
    "type": "narration",
    "text": "ホブゴブリン、ゴブリンがこちらの声が届く距離に来た...！"
  },
  {
    "id": "block_1786183133328_239",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "三、"
  },
  {
    "id": "block_1786184892332_357",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "二......."
  },
  {
    "id": "block_1786184919831_358",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "一！"
  },
  {
    "id": "block_1786183133328_240",
    "type": "narration",
    "text": "合図とともに青椒さんが声を出す。"
  },
  {
    "id": "block_1786184947331_359",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "ﾋﾟｷﾞｬｰーーーー！"
  },
  {
    "id": "block_1786184968478_360",
    "type": "narration",
    "text": "一瞬ゴブリンの鳴き声かと思うほどの奇声は、一気に敵のヘイトを買った。ぞろぞろとゴブリンたちが青椒さんの方向をめがけて駆けてくる。"
  },
  {
    "id": "block_1786183133328_241",
    "type": "narration",
    "text": "背後を取った！今だ！"
  },
  {
    "id": "block_1786184983029_361",
    "type": "narration",
    "text": "ザクッ！"
  },
  {
    "id": "block_1786184992253_362",
    "type": "narration",
    "text": "ザクッ！"
  },
  {
    "id": "block_1786185000714_363",
    "type": "narration",
    "text": "グサッ！"
  },
  {
    "id": "block_1786185016555_364",
    "type": "narration",
    "text": "一体、二体、確実に仕留めていく。"
  },
  {
    "id": "block_1786183133328_242",
    "type": "narration",
    "text": "............"
  },
  {
    "id": "block_1786185031160_365",
    "type": "narration",
    "text": ".............しかし予想外なことにゴブリンが一気に来すぎた！\nこのままでは殺しきれずに青椒さんが...ッ！"
  },
  {
    "id": "block_1786183133328_243",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "ひ、ひぃ！や、やめてくださいーー！"
  },
  {
    "id": "block_1786183133328_244",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "青椒さんッッ！"
  },
  {
    "id": "block_1786183133328_245",
    "type": "narration",
    "text": "青椒さんの声に引き寄せられたゴブリンは、青椒さんを捕まえると、持っていた斧やナイフで滅多刺しにして殺してしまった,,,,,,"
  },
  {
    "id": "block_1786183133328_246",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "全部....俺のせいだ....."
  },
  {
    "id": "block_1786183133328_247",
    "type": "narration",
    "text": "すると、一際大きな足音が目の前で停まる。"
  },
  {
    "id": "block_1786183133328_248",
    "type": "dialogue",
    "speaker": "ホブゴブリン",
    "text": "フゴッゴ！フゴフゴー！(オデタチノナワバリヲアラシタノハオマエカ...！デッタイニユドゥサナイ！！)"
  },
  {
    "id": "block_1786183133328_249",
    "type": "narration",
    "text": "俺は、死を覚悟し、ゴブリンに殺される前に首を掻っ切った。"
  },
  {
    "id": "block_1786183133328_250",
    "type": "gameover",
    "message": "",
    "endingName": "バッドエンディング4：漢の流儀",
    "retryJumpBlockId": "block_1786183133328_213"
  },
  {
    "id": "block_1786183133328_254",
    "type": "narration",
    "text": "何を思ったのか治郎はゴブリンたちの正面に躍り出てしまった。"
  },
  {
    "id": "block_1786183133328_255",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "！！！なにやってるんですか治郎さん！！！"
  },
  {
    "id": "block_1786183133328_256",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": ".....しまった！咄嗟に飛び出てしまった！"
  },
  {
    "id": "block_1786183133328_257",
    "type": "narration",
    "text": "ゴブリン達は治郎を見るに、束になって襲いかかってきた。"
  },
  {
    "id": "block_1786185105940_366",
    "type": "narration",
    "text": "通常のゴブリンはちゃんと対応すれば一体ずつ殺せる。"
  },
  {
    "id": "block_1786185115294_367",
    "type": "narration",
    "text": "しかし-----------ホブゴブリンは違う..."
  },
  {
    "id": "block_1786183133328_258",
    "type": "narration",
    "text": "圧倒的な体格差。勝てるはずもない..."
  },
  {
    "id": "block_1786185132686_368",
    "type": "narration",
    "text": "振り下ろされた拳を防ぐために、咄嗟に手持ちの武器でガードを試みるが、その硬い皮膚には効かず、砕けてしまった。"
  },
  {
    "id": "block_1786183133328_259",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "ッッッ！クソ！なんてことだ！もう後はない...."
  },
  {
    "id": "block_1786183133328_260",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "治郎さん！なんてことだ...もう終わりだぁ..."
  },
  {
    "id": "block_1786183133328_261",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "........ん？"
  },
  {
    "id": "block_1786183133328_262",
    "type": "narration",
    "text": "------------ふと、ポケットに違和感を感じた。"
  },
  {
    "id": "block_1786185177556_369",
    "type": "narration",
    "text": "最後の力でまさぐってみると、ついさっき店主にもらった謎の液体入りの瓶があった。"
  },
  {
    "id": "block_1786185196295_370",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "....！"
  },
  {
    "id": "block_1786183133328_263",
    "type": "narration",
    "text": "これは！名前書いてないから大事なものじゃないやつ！！こうなったらもうヤケだ！"
  },
  {
    "id": "block_1786183133328_264",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "くらいやがれッ！俺の最強の切り札ァーーーーーーッ！"
  },
  {
    "id": "block_1786183133328_265",
    "type": "narration",
    "text": "瓶の蓋を開け、今残っている力のすべてを使い全力投球した。"
  },
  {
    "id": "block_1786183133328_266",
    "type": "narration",
    "text": "----------"
  },
  {
    "id": "block_1786185250743_371",
    "type": "narration",
    "text": "-----パシャリ......"
  },
  {
    "id": "block_1786185262163_372",
    "type": "narration",
    "text": "謎の液体がホブゴブリンに降りかかる。"
  },
  {
    "id": "block_1786183133328_267",
    "type": "dialogue",
    "speaker": "ホブゴブリン",
    "text": "フガァァァァァァァァァアアア！(痛っっってぇぇぇぇぇぇぇ！)"
  },
  {
    "id": "block_1786183133328_268",
    "type": "narration",
    "text": "ゴブリンの集団に降りかかったそれは、みるみるホブゴブリンを弱体化させてゆく...."
  },
  {
    "id": "block_1786183133328_269",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "え？"
  },
  {
    "id": "block_1786185358662_373",
    "type": "narration",
    "text": "すると青椒さんが声を上げた。"
  },
  {
    "id": "block_1786183133328_270",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "もしかしてあれは！プシ硫酸！\n聞いたことがあります！とある科学者が造り出したという対魔物用の便利グッズ！"
  },
  {
    "id": "block_1786183133328_271",
    "type": "narration",
    "text": "硫酸....？"
  },
  {
    "id": "block_1786185374772_374",
    "type": "narration",
    "text": "そうか！硫酸がゴブリンたちの皮膚を溶かしてホブゴブリンの硬い皮膚を弱体化させたんだ！"
  },
  {
    "id": "block_1786183133328_272",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "今なら....！！！"
  },
  {
    "id": "block_1786183133328_273",
    "type": "takeitem",
    "itemId": "mystery_liquid",
    "quantity": 1
  },
  {
    "id": "block_1786183133328_275",
    "type": "bossbattle",
    "bossKey": "hobgoblin_pack",
    "escorts": [
      "hobgoblin_pack",
      "hobgoblin_pack"
    ],
    "winJumpBlockId": "block_1786183133328_281",
    "defeatJumpBlockId": null,
    "defeatMessage": "硫酸で弱っていたとはいえ、複数のホブゴブリン相手には力及ばず......意識が遠のいていく。\n\n気を失っている間に、誰かに救助されたようだ……気づくと村の広場に横たわっていた。レベルを上げてから、また挑もう。"
  },
  {
    "id": "block_1786183133328_281",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "よし！勝てた...！勝てたんだ...！"
  },
  {
    "id": "block_1786183133328_282",
    "type": "narration",
    "text": "だが、治郎は忘れていた....ホブゴブリンは4体いることを......"
  },
  {
    "id": "block_1786183133328_283",
    "type": "dialogue",
    "speaker": "ホブゴブリン",
    "text": "フゴォォォォオオオオオ！(マジ許さん死ねェーーーッ！)"
  },
  {
    "id": "block_1786183133328_284",
    "type": "narration",
    "text": "グチャッ......"
  },
  {
    "id": "block_1786185661743_375",
    "type": "narration",
    "text": "脳漿が飛び散る音。一瞬の油断により、田中治郎は絶命した。"
  },
  {
    "id": "block_1786183133328_285",
    "type": "narration",
    "text": "......かに思えた....\nしかし、飛び散ったそれは、治郎のものではなかった。"
  },
  {
    "id": "block_1786183133328_286",
    "type": "dialogue",
    "speaker": "竜殺し",
    "text": "心配になって一応着いてきたらホブゴブリンの巣があったのね。\n油断したら負けよ。\nヒョロガリ。"
  },
  {
    "id": "block_1786183133328_287",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "お、お前は...！"
  },
  {
    "id": "block_1786183133328_288",
    "type": "narration",
    "text": "そこには、「竜殺し」と呼ばれる、狂戦士の姿があった......."
  },
  {
    "id": "block_1786183133328_289",
    "type": "telop",
    "text": "----数日後----"
  },
  {
    "id": "block_1786183133328_290",
    "type": "background",
    "path": "img/村.jpeg"
  },
  {
    "id": "block_1786183133328_291",
    "type": "bgm",
    "track": "town"
  },
  {
    "id": "block_1786183133328_292",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "いやぁ、先日の件は本当にありがとうございました！おかげで妻は軽い怪我で済み、他の女性たちも何もされずに助かったようです！"
  },
  {
    "id": "block_1786183133328_293",
    "type": "dialogue",
    "speaker": "𰻞𰻞",
    "text": "本当に感謝してもしきれません！助けていただきありがとうございました！"
  },
  {
    "id": "block_1786183133328_294",
    "type": "narration",
    "text": "青椒さんと𰻞𰻞さんに先日の一件のお礼をされた。"
  },
  {
    "id": "block_1786183133328_295",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "あ、これ、あまりいいものは用意できなかったのですが、せめてものお礼です。"
  },
  {
    "id": "block_1786183133328_296",
    "type": "narration",
    "text": "青椒さんが何かを手渡してきた。なんだ、これ....変な形をしているな....でもどこかで見たような..."
  },
  {
    "id": "block_1786183133328_297",
    "type": "give",
    "itemId": "milking_machine",
    "quantity": 1
  },
  {
    "id": "block_1786183133328_298",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "あ、それは乳絞り機です！この村名産の「爆牛」のミルクを取るための機械です！"
  },
  {
    "id": "block_1786185827578_376",
    "type": "dialogue",
    "speaker": "青椒",
    "text": "この村の道具屋さんのご主人が裏で牧場を営んでいて、この機会を持って頼めば搾りたてミルクをくださると思います！"
  },
  {
    "id": "block_1786183133328_299",
    "type": "narration",
    "text": "は、はぁ....."
  },
  {
    "id": "block_1786185848186_377",
    "type": "narration",
    "text": "正直に言うと、、、、、"
  },
  {
    "id": "block_1786185861198_378",
    "type": "narration",
    "text": "本当にいらないんだが......."
  },
  {
    "id": "block_1786183133328_300",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "あ、ありがとうございます...."
  },
  {
    "id": "block_1786183133328_301",
    "type": "narration",
    "text": "そういって、青椒さん御夫婦と別れ、宿屋までの道のりを歩く。"
  },
  {
    "id": "block_1786185880034_379",
    "type": "narration",
    "text": "異世界に来てからいろいろなことがあった..."
  },
  {
    "id": "block_1786185906915_380",
    "type": "narration",
    "text": "やる気のない神様に適当にここへ送られるし、上位種のゴブリンに殺されかけるし..."
  },
  {
    "id": "block_1786185916106_381",
    "type": "narration",
    "text": "もうすでに何回か殺されたような気分だよ...."
  },
  {
    "id": "block_1786183133328_302",
    "type": "narration",
    "text": "そう考えながら歩いていると、見覚えのある人影があった。"
  },
  {
    "id": "block_1786183133328_303",
    "type": "dialogue",
    "speaker": "竜殺し",
    "text": "久しぶりね。「一文無しの放浪者」さん。"
  },
  {
    "id": "block_1786185948505_382",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": ".....ぇえ......"
  },
  {
    "id": "block_1786183133328_304",
    "type": "narration",
    "text": "なんでこいつがいるんだ....ていうかその名前で呼ぶなよ...！"
  },
  {
    "id": "block_1786183133328_305",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "ど、どうしたんだ？"
  },
  {
    "id": "block_1786183133328_306",
    "type": "dialogue",
    "speaker": "竜殺し",
    "text": "提案があるの。私とパーティーを組まない...？"
  },
  {
    "id": "block_1786185978356_383",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": ".....................................え？"
  },
  {
    "id": "block_1786183133328_307",
    "type": "narration",
    "text": "それは、唐突すぎる提案だった。"
  },
  {
    "id": "block_1786183133328_308",
    "type": "dialogue",
    "speaker": "竜殺し",
    "text": "あなた、外見はヒョロガリで頼りなさそうなフニャチンのヤニカスDTに見えるけど、独りで巣のほぼすべてのゴブリン達を倒していて驚いたわ。"
  },
  {
    "id": "block_1786183133328_309",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "へへ、ありがとうございます(タバコなんて吸ったことないんだがな...てかこの世界タバコあるの...?)"
  },
  {
    "id": "block_1786183133328_310",
    "type": "dialogue",
    "speaker": "竜殺し",
    "text": "この付近の冒険者ではあなたが一番信頼できそうだし、私とパーティーを組んで効率的に強くなろうって話。"
  },
  {
    "id": "block_1786183133328_311",
    "type": "narration",
    "text": "意外だ。こいつは自分以外足元のアリほどにしか見えてないようなやつだと思ってたから、他人を少しでも信頼できそうと思うなんて思っても見なかった......."
  },
  {
    "id": "block_1786183133328_312",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "..........こちらからすると、正直かなり魅力的な提案だ。"
  },
  {
    "id": "block_1786183133328_313",
    "type": "dialogue",
    "speaker": "竜殺し",
    "text": "..！......でしょ！"
  },
  {
    "id": "block_1786183133328_314",
    "type": "narration",
    "text": "ここは、どうする....？"
  },
  {
    "id": "block_1786183133328_315",
    "type": "choice",
    "prompt": "",
    "options": [
      {
        "id": "opt_1786183133328_317",
        "text": "断ってみる",
        "jumpBlockId": "block_1786186146639_384"
      },
      {
        "id": "opt_1786183133329_318",
        "text": "パーティーを組む",
        "jumpBlockId": "block_1786183133329_329"
      }
    ]
  },
  {
    "id": "block_1786186146639_384",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "ほ...ほんとに...ぼくと「パーティー」...に...なってくれるのか？"
  },
  {
    "id": "block_1786186172271_385",
    "type": "narration",
    "text": "竜殺しは一瞬にまっと笑い、"
  },
  {
    "id": "block_1786183133329_319",
    "type": "dialogue",
    "speaker": "竜殺し",
    "text": "ああ、約束するわ。お互いの力で強くなる。ギブ アンド テイクよ。さあ、酒場にパーティー申請しに行きましょ。"
  },
  {
    "id": "block_1786183133329_320",
    "type": "narration",
    "text": ".........."
  },
  {
    "id": "block_1786183133329_321",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "だが断る"
  },
  {
    "id": "block_1786183133329_322",
    "type": "dialogue",
    "speaker": "竜殺し",
    "text": "ナニッ!!"
  },
  {
    "id": "block_1786183133329_323",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "この田中治郎が最も好きな事のひとつは"
  },
  {
    "id": "block_1786186232945_386",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "自分で強いと思ってるやつに\n『NO』と断ってやる事だ…"
  },
  {
    "id": "block_1786183133329_324",
    "type": "dialogue",
    "speaker": "竜殺し",
    "text": "あ、そ。"
  },
  {
    "id": "block_1786183133329_325",
    "type": "narration",
    "text": "こうして、田中治郎はこの世界でも天涯孤独で一生を終えたのである......"
  },
  {
    "id": "block_1786186379731_388",
    "type": "narration",
    "text": "『完』"
  },
  {
    "id": "block_1786183133329_328",
    "type": "ending",
    "endingType": "true",
    "title": "トゥルーエンド1：「そして伝説()へ...」",
    "endroll": "",
    "endrollEnabled": true
  },
  {
    "id": "block_1786183133329_329",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "そりゃあもちろん。"
  },
  {
    "id": "block_1786183133329_330",
    "type": "narration",
    "text": "...."
  },
  {
    "id": "block_1786183133329_331",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "YES I AM!"
  },
  {
    "id": "block_1786186441155_389",
    "type": "narration",
    "text": "バーン"
  },
  {
    "id": "block_1786183133329_332",
    "type": "dialogue",
    "speaker": "竜殺し",
    "text": "...........そこは、YES I WILLじゃないの...？"
  },
  {
    "id": "block_1786183133329_333",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "....このくだりにちゃんと反応してくれる人初めて見た....."
  },
  {
    "id": "block_1786183133329_334",
    "type": "dialogue",
    "speaker": "竜殺し",
    "text": "ところであなた名前は？二つ名しか知らなかったし呼びやすいように一応言っておきましょう。私は「ケツァナ」よ。ツァナと呼んでくれていいわ。"
  },
  {
    "id": "block_1786183133329_335",
    "type": "dialogue",
    "speaker": "田中治郎",
    "text": "俺は治郎。これからよろしく。"
  },
  {
    "id": "block_1786183133329_336",
    "type": "narration",
    "text": "かくして治郎と竜殺しことケツァナは、冒険をともにするパーティーとなった"
  },
  {
    "id": "block_1786186494125_390",
    "type": "narration",
    "text": "治郎にとっては初めての「仲間」である。"
  },
  {
    "id": "block_1786183133329_337",
    "type": "flag",
    "flagName": "chapter2_ending_party",
    "mode": "on"
  },
  {
    "id": "block_1786183133329_338",
    "type": "flag",
    "flagName": "has_partner",
    "mode": "on"
  },
  {
    "id": "block_1786186517266_391",
    "type": "clearchapter",
    "resetProgress": true
  },
  {
    "id": "block_1786186554617_392",
    "type": "telop",
    "text": "ーー第二話 初めての〇〇(チュウではない)ーー"
  },
  {
    "id": "block_1786186554617_393",
    "type": "telop",
    "text": "おしり。"
  }
];
}