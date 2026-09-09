// scenario.js
// 第一話：転生〜職業選択〜カリの村〜酒場〜冒険者登録まで

async function startScene() {
  
  // ===== 導入：田中治郎、死亡（黒背景） =====
  setBackgroundColor("#000000");
  changeSpeaker("");
  await displayMessage("俺は35歳のDT、田中治郎。ブラック企業に勤めて早13年、毎日が死んだような生活をしていた……");
  await displayMessage("そんなある日、横断歩道を歩いていると、信号無視をした異世界トラックが突っ込んできて、俺はそのまま死んだんだ……");
  
  await showSpecialScene("目が覚めたら……");
  
  // ===== 神様との対話・職業選択（白背景の部屋） =====
  setBackgroundColor("#ffffff");
  changeSpeaker("");
  await displayMessage("そこには神様？がいた。");
  
  changeSpeaker("神様？");
  await displayMessage("あー、ワシ、神様だから。君、死んで違う世界に行くことになったんで。とりあえず説明だけするね。");
  
  changeSpeaker("");
  await displayMessage("神様？は鼻をほじりながら口を開いた。");
  
  changeSpeaker("神様？");
  await displayMessage("実はね、君が死んだあと、今の日本では人手不足がすごくてね。本当は向こうの世界に適した魂を持ってた人が選ばれるんだけど、君は仕方なく選ばれたの。だからこのまま他の世界に転生するんだけど……何か質問ある？");
  
  changeSpeaker("田中治郎");
  await displayMessage("あのー、俺みたいなブラック企業で働いてる社畜でも異世界に転生できるんですか？あとチートは貰えますか？");
  
  changeSpeaker("神様？");
  await displayMessage("あー、大丈夫大丈夫。ちゃんとチートはあげるし、異世界には魔王とかも居ないから...たぶん。ま、とりあえず職業選んで。ちなみに職業ごとに固有スキルがあるから。");
  
  changeSpeaker("");
  await displayMessage("もちろん俺は……");
  
  const jobChoices = [
    { text: "全能士（オールラウンダー）", next: "全能士" },
    { text: "戦士", next: "戦士" },
    { text: "性騎士", next: "性騎士" },
    { text: "ニート", next: "ニート" },
    { text: "お宝鑑定団", next: "お宝鑑定団" },
    { text: "魔法少女（おっさん）", next: "魔法少女" }
  ];
  
  // ★職業を選んだら、まず説明を見せてから「本当にこれでいいか」を確認する。
  //   「他の職業を選び直す」を選んだ場合は、もう一度職業選択に戻る。
  let jobName = null;
  while (!jobName) {
    const selectedJob = await displayChoices(jobChoices);
    const candidateJob = selectedJob.next;
    const classInfo = CLASS_MASTER[candidateJob];
    
    changeSpeaker("神様？");
    await displayMessage(`${candidateJob}か。それはね、${classInfo.description}`);
    
    const confirmChoices = [
      { text: `${candidateJob}にする`, next: "yes" },
      { text: "他の職業を選び直す", next: "no" }
    ];
    // ★勢いで即決してしまわないよう、カーソルの初期位置は「他の職業を選び直す」側にしておく
    const confirmResult = await displayChoices(confirmChoices, 1);
    
    if (confirmResult.next === "yes") {
      jobName = candidateJob;
    } else {
      changeSpeaker("");
      await displayMessage("俺はもう一度、職業について考え直すことにした。");
    }
  }
  
  // ★ 選ばれた職業でプレイヤーを初期化し、HUDに反映する
  initPlayer(jobName);
  renderStatusHUD();
  
  // 職業ごとの神様とのやり取り
  changeSpeaker("田中治郎");
  if (jobName === "ニート") {
    await displayMessage("俺はもう働きたくないからな。ニートにする。");
    changeSpeaker("神様？");
    await displayMessage("いや、ニートも自宅を守るという大事な使命があるぞ。神様が警告するように言った。");
    
  } else if (jobName === "全能士") {
    await displayMessage("じゃあ、その『オールラウンダー』ってのにしとく。どうせなら色々できる方がいいや");
    changeSpeaker("神様？");
    await displayMessage("神様は軽く頷きながら言った。いい選択だ。だいたいの職業の基本的なスキルは取れるし、バランスの良い職業だ。まあ何とかなるよ。後悔しないよね？");
    changeSpeaker("田中治郎");
    await displayMessage("え、はい。");
    
  } else if (jobName === "戦士") {
    await displayMessage("いろいろあるがここはベーシックに戦士で！");
    changeSpeaker("神様？");
    await displayMessage("神様は少し驚いた顔をして、本当にそれでいいの？と念押しした。");
    changeSpeaker("田中治郎");
    await displayMessage("ああ、もちろんだ。ただのブラック企業勤務でも体力だけはあるからな！");
    changeSpeaker("神様？");
    await displayMessage("そっか、それなら大丈夫だろう。異世界生活楽しんで笑");
    
  } else if (jobName === "性騎士") {
    await displayMessage("全男子の夢みたいな職業だな。この性騎士ってので。");
    changeSpeaker("神様？");
    await displayMessage("神様は少し笑いながら答えた。けっこうキモがられるよwwwwそれwwwワシも一回それになって人間界に降りたことあるんだけどねww");
    changeSpeaker("田中治郎");
    await displayMessage("だって、女の子にモテそうだし...!");
    
  } else if (jobName === "お宝鑑定団") {
    await displayMessage("お宝鑑定団！？こんな職業もあるんだ！俺は思わず叫んだ。");
    changeSpeaker("神様？");
    await displayMessage("あるよ。お前みたいに見る目があるやつなら、その職業に向いてるかもね笑");
    changeSpeaker("田中治郎");
    await displayMessage("鑑定だけでいいのかよ");
    changeSpeaker("神様？");
    await displayMessage("まあ、なんでも◯定団みたいな感じのスキル使えるよ。");
    
  } else if (jobName === "魔法少女") {
    await displayMessage("ま、魔法少女……？俺、35のおっさんだったんですけど……大丈夫なんですかそれ");
    changeSpeaker("神様？");
    await displayMessage("細かいことは気にすんな。変身すれば魔法が使える、けっこう夢のある職業だぞ。ステッキとか似合うといいな");
    changeSpeaker("田中治郎");
    await displayMessage("絶対似合わねえだろ……");
    changeSpeaker("神様？");
    await displayMessage("まあ安心しろ、見た目は多少アレだが、変身すれば魔法が使えるのはお前だけの強みだ。");
  }
  
  changeSpeaker("");
  await displayMessage("職業を選び終えたあと、神様がほじり出した鼻くそを口に運び最後にこう伝えた...");
  
  changeSpeaker("神様？");
  await displayMessage("じゃあ、異世界満喫してね。ワシは次の転移者の対応しなきゃだから、ばいばい。あー忙し...だりぃなこれ...");
  
  changeSpeaker("田中治郎");
  await displayMessage("なんだこの神！");
  
  await showSpecialScene("そして、目が覚めると……そこは森の中だった……");
  
  // ===== 森の中〜カリの村 =====
  // ★ 森の背景画像は未用意のため、暫定で単色にしておく（画像ができたら setBackgroundImage("img/森.jpg") 等に差し替え）
  setBackgroundColor("#0d1f13");
  
  changeSpeaker("田中治郎");
  await displayMessage("まずはギルドに行ってみようかな？");
  await displayMessage("てゆーかギルドってものがこの世界にあるのかしら？");
  
  changeSpeaker("");
  await displayMessage("考えても仕方がない、おもいきり丸腰の状態で魔物なんかにあってしまったらひとたまりもないからな...");
  await displayMessage("てかあの神チートスキル渡し忘れてるじゃねーか！！！");
  await displayMessage("俺は渋々立ち上がり周囲を見渡した。");
  
  changeSpeaker("田中治郎");
  await displayMessage("さて……これからどうするか……");
  
  changeSpeaker("");
  await displayMessage("考えているうちに木々の間にぼんやりと建物のような影が見えてきた。おそらく村か町かもしれない。");
  
  changeSpeaker("田中治郎");
  await displayMessage("とりあえず行ってみるしかねぇな……");
  
  // ===== カリの村に到着（村の背景画像に切り替え） =====
  changeSpeaker("");
  setBackgroundImage("img/村.jpeg");
  await displayMessage("森を抜けるとそこには小さな村があった。看板を見るに、「カリの村」というらしい。ここではどうやら農作物や牧畜が盛んに行われており、村人たちも穏やかに暮らしているようだ。");
  await displayMessage("ふと、酒場らしき看板が見えた。");
  
  changeSpeaker("田中治郎");
  await displayMessage("とりあえず、酒場に行ってみるか...");
  
  // ===== 酒場：もめ事の場面 =====
  changeSpeaker("");
  await displayMessage("酒場に着くと、争うような声が聞こえた。");
  
  changeSpeaker("女性冒険者");
  await displayMessage("今、私の金盗んだよね？返しなさいよ！");
  
  changeSpeaker("屈強な男");
  await displayMessage("わ、悪かった...!金は返すよ...だから勘弁してくれ!");
  
  changeSpeaker("");
  await displayMessage("そこには若い女と屈強な男がいた。女の方は...格好からして戦士系か...?");
  await displayMessage("あまり関わりたくはないな...絡まれるのはゴメンだ..。さて……どうする？");
  
  const barChoices = [
    { text: "女性に近づき仲裁に入る", next: "A", isCorrect: true },
    { text: "静かに店の外へ出て別の情報収集を試みる", next: "B", loops: true },
    { text: "店主に事情を聞いて情報を集める", next: "C", loops: true }
  ];
  
  let barChoice;
  do {
    barChoice = await displayChoices(barChoices);
    
    if (barChoice.next === "B") {
      changeSpeaker("");
      await displayMessage("俺は黙って踵を返し、酒場からそっと抜け出そうとした。外へ出ると空気がひんやりとして気持ち良かった。");
      await displayMessage("しかし情報収集が必要だと改めて思う。近くにいる村人に話しかけてみることにした。");
      await displayMessage("……そうこうしているうちに、酒場の中からはまだ言い争う声が聞こえてくる。結局、気になって酒場に引き返すことにした。");
      
    } else if (barChoice.next === "C") {
      changeSpeaker("");
      await displayMessage("カウンター席へ座るとすぐに主人が注文を聞きに来た。");
      
      changeSpeaker("田中治郎");
      await displayMessage("エールひとつお願いします");
      
      changeSpeaker("");
      await displayMessage("エールを受け取り一口飲むと冷たい泡と共に苦味と旨味が広がった。");
      
      changeSpeaker("田中治郎");
      await displayMessage("あそこの女性はだれなんですか？とりあえず今の状況を把握したいので聞いてみる。");
      
      changeSpeaker("店主");
      await displayMessage("あぁ、あいつはな、ここらへんではそこそこ有名なソロ冒険者だ、職業は狂戦士(バーサーカー)で、「竜殺し」という二つ名で呼ばれているよ。");
      
      changeSpeaker("田中治郎");
      await displayMessage("本名はわかりますか？");
      
      changeSpeaker("");
      await displayMessage("店主は少し顔をしかめたあと、笑って言った。");
      
      changeSpeaker("店主");
      await displayMessage("あんた本気で言ってるのかい？ここでは本名を言うことはすなわち服従を意味するんだよ。誰も本名は自分から言ったりしないさ。ハッハッハ");
      
      changeSpeaker("");
      await displayMessage("なるほど、そういうものなのか……確かに自分の正体を相手に悟らせないようにするために偽名を使うのは当然のことか..");
      await displayMessage("エールを飲み終えた頃、まだあの二人の言い争いは続いていた。仕方なく、様子を見に戻ることにした。");
    }
  } while (barChoice.next !== "A");
  
  changeSpeaker("田中治郎");
  await displayMessage("私は警戒しながらも静かに近づき、喧嘩をしている二人組へ声をかけた。");
  await displayMessage("ちょっと待ってくれ。ここで揉めていても解決にはならないだろう？お互い冷静になって話し合わないか？");
  
  changeSpeaker("");
  await displayMessage("女性は鋭い目つきで俺を見据える。");
  
  changeSpeaker("女性冒険者");
  await displayMessage("あんた誰？部外者は引っ込んでなさいよ");
  // ===== 分岐合流：もめ事の結末〜冒険者登録 =====
  changeSpeaker("女性冒険者");
  await displayMessage("ごめんけどこれはこっちの問題なの");
  
  changeSpeaker("");
  await displayMessage("その隙に男が逃げ出してしまった。");
  
  changeSpeaker("女性冒険者");
  await displayMessage("ああっ！ちょっと！逃げられたじゃないの！！どうしてくれるのよ！");
  
  changeSpeaker("");
  await displayMessage("彼女はとてつもなく怒りながら酒場を出ていってしまった。仕方がないので店主に冒険者登録出来ないか聞いてみることにした。");
  
  changeSpeaker("田中治郎");
  await displayMessage("あの、冒険者になるにはどうすればいいですか？");
  
  changeSpeaker("店主");
  await displayMessage("なるほど冒険者になりに来たわけか。それならここで出来るぞ。クエストもここで受注できるから。ちなみに二つ名は自分以外の人から決めてもらう必要があるから、俺が決めてやろう....");
  await displayMessage("うーん...今日からあんたは「一文無しの放浪者」だ。");
  
  changeSpeaker("");
  await displayMessage("...なんてひどい二つ名だろう...しかしこれじゃないと冒険者になれないわけか...");
  
  changeSpeaker("店主");
  await displayMessage("わかってると思うが、真名だけは絶対に誰にも言うんじゃないぞ。真名を言うことは奴隷になるようなものだからな。");
  
  changeSpeaker("田中治郎");
  await displayMessage("わ、わかりました...");
  
  changeSpeaker("");
  await displayMessage("苦笑いで酒場を後にし、やっと冒険の始まりである.......");
  
  // ===== 第一話 終了処理 =====
  setRank("F");
  setNickname("一文無しの放浪者");
  renderStatusHUD();
  
  // ★第一話クリアの記録。シナリオビルドの「ending/clearchapter」ブロックはここで自動的にcleared=trueに
  //   しているが、この手書きの第一話ではその処理が無く、便利タブの進行度アイコンがいつまでも「0話」の
  //   ままだったり、第二話の解放条件（第一話クリア必須）が永久に満たされなかったりする不具合の原因になっていた
  if (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.chapters)) {
    const chapter1Entry = scenarioProject.chapters.find(c => c.id === "builtin_chapter1");
    if (chapter1Entry) chapter1Entry.cleared = true;
  }
  if (typeof player !== "undefined") player.progressPoints = 0; // ★話が終わるごとに進行度をリセットする（ブロック版と同じ挙動）
  if (typeof saveCustomScenarioData === "function") saveCustomScenarioData();
  
  await showSpecialScene("第一話 完");
  
  // ここから自由行動パート：村の行き先メニューを表示する
  openTownMenu();
}