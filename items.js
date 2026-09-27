// items.js
// ゲーム内に存在する全アイテムの「マスターデータ」を管理するファイル。
// ここには「設計図」だけを置く。実際にプレイヤーが持つ在庫は inventory.js が管理する。

/*
  ITEM_MASTER の共通フィールド:
  - name        : アイテム名
  - category    : "herb"(薬草) / "potion"(ポーション) / "material"(魔物素材) / "weapon"(武器) / "armor"(防具) / "tool"(回復以外の特殊効果を持つ道具)
                  / "cookingTool"(料理道具。調理魔家電を使う料理画面で使う。耐久度・材料スロット数を持つ) / "food"(料理。料理の完成品。回復系params＋戦闘中だけの自己バフを持てる)
                  / "book"(本。使うとページをめくって読める。中身はpages配列にアイテム編集から書き込む)
  - description : アイテムの説明文
  - rank        : お宝ランク（鑑定結果に使う目安。F〜S等）
  - listedPrice : 定価。町の買取屋が普通につける価格。プレイヤーは鑑定しなくてもこの額は見える想定
  - trueValue   : 真価。本当の価値。「なんでも鑑定」で見抜くまでは隠しておく想定
  - params      : カテゴリごとに意味が変わる数値・効果のまとまり
  - bookGenre   : category:"book"の時だけ使う、本のジャンル分け（本棚での見た目の分類・雰囲気付け用。ゲーム性には影響しない）
*/

const ITEM_MASTER = {
  
  // ===== 薬草系 =====
  "herb_001": {
    name: "薬草",
    category: "herb",
    description: "野山にどこでも生えている、傷薬の材料になる草。",
    rank: "F",
    listedPrice: 10,
    trueValue: 10,
    buyPrice: 20, // ★道具屋で買う時の値段
    params: {
      薬効: 5, // ポーション作成時の回復量に影響
      回復量: 10, // ★生のまま戦闘中に使う場合の回復量。加工したポーションより少なめ
      希少度: 1
    }
  },
  "herb_002": {
    name: "毒消し草",
    category: "herb",
    description: "独特な匂いを持つ草。毒消しの材料として重宝される。",
    rank: "E",
    listedPrice: 30,
    trueValue: 30,
    params: {
      薬効: 8,
      解毒: true,
      希少度: 2
    }
  },
  "herb_003": {
    name: "月光草",
    category: "herb",
    description: "満月の夜にだけ薄く発光する珍しい草。実は高値で取引される。",
    rank: "D",
    listedPrice: 800, // 見た目通りの定価はそこそこ
    trueValue: 25000, // 実は貴重で、真価はずっと高い（鑑定団の見せ場）
    params: {
      薬効: 15,
      回復量: 20, // ★薬草よりは効果が高いが、加工したポーションよりは低め
      希少度: 4
    }
  },
  
  "herb_004": {
    name: "高級薬草",
    category: "herb",
    description: "幻魔の森の奥深くにだけ自生する、質の良い薬草。効き目が強く、薬師の間で重宝されている。",
    rank: "D",
    listedPrice: 150,
    trueValue: 150,
    buyPrice: 300, // ★道具屋では買えない想定なので参考価格（森でしか採取できない）
    params: {
      薬効: 20,
      回復量: 30, // ★普通の薬草より効果が高い
      希少度: 3
    }
  },
  
  // ===== ポーション系（薬草から作られる。素材の薬草より回復量が高くなるよう設定） =====
  "potion_001": {
    name: "ポーション",
    category: "potion",
    description: "薬草を煎じて作られた基本的な回復薬。生の薬草より効き目が強い。",
    rank: "F",
    listedPrice: 50,
    trueValue: 50,
    buyPrice: 100, // ★道具屋で買う時の値段
    params: {
      回復量: 30,
      対象: "HP"
    }
  },
  "potion_002": {
    name: "解毒ポーション",
    category: "potion",
    description: "毒消し草を主原料にした、状態異常回復用のポーション。",
    rank: "E",
    listedPrice: 90,
    trueValue: 90,
    buyPrice: 180, // ★道具屋で買う時の値段
    params: {
      回復量: 0,
      対象: "毒",
      解毒: true
    }
  },
  "potion_003": {
    name: "エーテル",
    category: "potion",
    description: "魔力を凝縮させて作られた青い薬液。飲むとSPが回復する。",
    rank: "E",
    listedPrice: 120,
    trueValue: 120,
    buyPrice: 220, // ★道具屋で買う時の値段
    params: {
      SP回復量: 25, // ★HPではなくSPを回復する
      対象: "SP"
    }
  },
  "potion_004": {
    name: "ハイポーション",
    category: "potion",
    description: "希少な薬草を贅沢に使った上級の回復薬。ポーションよりずっとよく効く。",
    rank: "D",
    listedPrice: 180,
    trueValue: 180,
    buyPrice: 350, // ★道具屋で買う時の値段
    params: {
      回復量: 70,
      対象: "HP"
    }
  },
  "potion_005": {
    name: "スタミナドリンク",
    category: "potion",
    description: "冒険者向けに調合された栄養剤。疲れを和らげ、少しだけ体力も戻る。",
    rank: "F",
    listedPrice: 60,
    trueValue: 60,
    buyPrice: 110, // ★道具屋で買う時の値段
    params: {
      回復量: 15,
      疲労回復量: 20, // ★軽めに疲労度も軽減する
      対象: "HP・疲労度"
    }
  },
  
  // ===== 道具（消耗品だが回復以外の特殊効果を持つもの） =====
  "tool_001": {
    name: "てめぇらのつばさ",
    category: "tool",
    description: "使うと、問答無用で村まで一瞬にして連れ戻してくれる不思議な羽根。冒険中の緊急脱出用。",
    rank: "D",
    listedPrice: 400,
    trueValue: 400,
    buyPrice: 800, // ★道具屋で買う時の値段（少し高め）
    params: {
      帰還: true
    }
  },
  
  // ===== 魔物素材 =====
  "material_001": {
    name: "ゴブリンの牙",
    category: "material",
    description: "ゴブリンの牙。武器や装飾品の素材として使われる。",
    rank: "E",
    listedPrice: 15,
    trueValue: 15,
    params: {
      素材ランク: "E",
      用途: "武器強化"
    }
  },
  "material_002": {
    name: "古びた竜の鱗",
    category: "material",
    description: "どこかの竜のものらしい鱗。ただの飾りに見えるが……。",
    rank: "C",
    listedPrice: 30000,
    trueValue: 650000, // 見た目より遥かに価値が高い、鑑定団向けの目玉アイテム
    params: {
      素材ランク: "A",
      用途: "防具強化"
    }
  },
  
  // ===== 武器 =====
  "weapon_001": {
    name: "錆びた剣",
    category: "weapon",
    description: "長年放置されていたのか、刃はぼろぼろに錆びついている。",
    rank: "D",
    listedPrice: 500,
    trueValue: 3000, // ★真価の基準額。実際に鑑定すると、ここから±15%ランダムに変動した額に確定する（appraisal.js）
    params: {
      攻撃力: 8,
      装備部位: "武器"
    },
    // ★「錆びたシリーズ」専用のフィールド（appraisal.jsのrevealRustySeriesEffectsが使う）：
    //   - isRustySeries    : このアイテムが錆びたシリーズかどうかの目印
    //   - appraisedName    : 鑑定すると変わる本当の名前
    //   - appraisedParamsBase / appraisedParamsVariance : 鑑定で明らかになる本当のステータス。
    //     baseを中心に ±variance の範囲でランダムに決まる（例: 25±5 → 20〜30）
    isRustySeries: true,
    appraisedName: "名工の剣",
    appraisedParamsBase: { 攻撃力: 25 },
    appraisedParamsVariance: { 攻撃力: 5 }
  },
  "weapon_002": {
    name: "鉄の剣",
    category: "weapon",
    description: "冒険者ギルドの支給品によくある標準的な鉄剣。",
    rank: "F",
    listedPrice: 200,
    trueValue: 200,
    buyPrice: 1500, // ★武器屋で新品を買う時の値段（序盤はしっかり貯めないと買えないくらい高め）
    params: {
      攻撃力: 6,
      装備部位: "武器"
    }
  },
  "weapon_003": {
    name: "こん棒",
    category: "weapon",
    description: "木を削っただけの粗末な棍棒。無いよりはマシ、という程度の武器。",
    rank: "F",
    listedPrice: 80,
    trueValue: 80,
    buyPrice: 300, // ★武器屋の中では一番安い、駆け出し向けの武器
    params: {
      攻撃力: 3,
      装備部位: "武器"
    }
  },
  "weapon_004": {
    name: "鋼の剣",
    category: "weapon",
    description: "鉄の剣より上質な鋼で鍛えられた一振り。腕に覚えのある冒険者向け。",
    rank: "D",
    listedPrice: 900,
    trueValue: 900,
    buyPrice: 3500, // ★鉄の剣の上位互換。しっかり貯めて買う装備
    params: {
      攻撃力: 11,
      装備部位: "武器"
    }
  },
  
  // ===== 防具 =====
  // ★防御力システムは廃止したので、防具は代わりに最大HPを底上げする効果に変更した
  "armor_001": {
    name: "革の鎧",
    category: "armor",
    description: "駆け出し冒険者がよく身につける軽装の鎧。",
    rank: "F",
    listedPrice: 200,
    trueValue: 200,
    buyPrice: 1400, // ★防具屋で新品を買う時の値段（序盤はしっかり貯めないと買えないくらい高め）
    params: {
      最大HP: 12,
      装備部位: "胴"
    }
  },
  "armor_002": {
    name: "鉄の盾",
    category: "armor",
    description: "無骨だが頑丈な鉄製の盾。",
    rank: "E",
    listedPrice: 350,
    trueValue: 350,
    buyPrice: 2200, // ★防具屋で新品を買う時の値段（序盤はしっかり貯めないと買えないくらい高め）
    params: {
      最大HP: 20,
      装備部位: "盾"
    }
  },
  "armor_003": {
    name: "木の盾",
    category: "armor",
    description: "木の板を組んだだけの簡素な盾。軽くて扱いやすいが、頼りなさは否めない。",
    rank: "F",
    listedPrice: 100,
    trueValue: 100,
    buyPrice: 450, // ★防具屋の中では一番安い、駆け出し向けの盾
    params: {
      最大HP: 8,
      装備部位: "盾"
    }
  },
  "armor_004": {
    name: "鎖帷子",
    category: "armor",
    description: "鎖を編み込んだ胴用の防具。革の鎧よりも頑丈にできている。",
    rank: "D",
    listedPrice: 800,
    trueValue: 800,
    buyPrice: 3200, // ★革の鎧の上位互換。しっかり貯めて買う装備
    params: {
      最大HP: 30,
      装備部位: "胴"
    }
  },
  
  // ===== 魔物からのお礼アイテム =====
  "harpy_water": {
    name: "ハーピーの魔聖水♡",
    category: "potion",
    description: "見逃してあげたハーピーが、お礼にとくれた不思議な水。芳醇な香りがして、飲むと体力がみるみる回復し、疲れも和らぐ。ハーピーが目の前で生成してくれたポーション（）",
    rank: "C",
    listedPrice: 0, // お礼の品なので売買想定なし
    trueValue: 0,
    params: {
      回復量: 80, // ★体力を大幅に回復
      疲労回復量: 40, // ★疲労度も軽減する
      眠気軽減割合: 0.2, // ★眠気ゲージの最大値の2割ぶんを軽減する
      対象: "HP・疲労度・眠気"
    }
  },
  
  // ===== ボスの宝箱でしか手に入らない特別な装備 =====
  "forest_shield": {
    name: "森の王の盾",
    category: "armor",
    description: "幻魔の森に棲む「森の主」が持っていた、蔦と樹皮で覆われた神秘の盾。森の主を倒した時にしか手に入らない。",
    rank: "S",
    listedPrice: 3000,
    trueValue: 3000,
    params: {
      最大HP: 45,
      装備部位: "盾"
    }
  },
  "excalibur": {
    name: "性剣エクスカリバー",
    category: "weapon",
    description: "伝説の聖剣が、なぜか妙な力に目覚めてしまった姿。生半可な使い手では逆に振り回される。洞窟の主を倒した時にしか手に入らない。",
    rank: "AAA",
    listedPrice: 5000,
    trueValue: 5000,
    restrictedClass: "性騎士", // ★この職業でないと装備できない
    params: {
      攻撃力: 25,
      装備部位: "武器"
    }
  },
  
  // ===== 第二話関連のアイテム（ゲーム性は薄いが、シナリオ上で使う小道具） =====
  "mystery_liquid": {
    name: "謎の液体入りの瓶",
    category: "misc",
    description: "マッドサイエンティスト「デッパ」が置いていったという、名前も書かれていない瓶。中身は不明。",
    rank: "F",
    listedPrice: 10,
    trueValue: 10,
    params: {}
  },
  "milking_machine": {
    name: "乳絞り機",
    category: "misc",
    description: "この村名産の「爆牛」のミルクを搾るための機械。青椒さん夫婦からのお礼の品。道具屋の主人が裏で営む牧場に持っていくと、搾りたてミルクがもらえるらしい。",
    rank: "F",
    listedPrice: 5,
    trueValue: 5,
    params: {}
  },
  
  // ===== 釣り関連（要望対応：釣り場・釣竿・釣り餌・魚） =====
  // ★釣竿・釣り餌は、既存のカテゴリ（tool等）のアイテムに isFishingRod / isFishingBait の
  //   フラグを立てたもの。シナリオエディタの「アイテム設定」でも同様にチェックを入れて作れる
  "fishrod_001": {
    name: "木の釣竿",
    category: "tool",
    description: "どこにでもありそうな、素朴な木の釣竿。駆け出しの釣り人向け。",
    rank: "F",
    listedPrice: 100,
    trueValue: 100,
    buyPrice: 200,
    isFishingRod: true,
    rodDurability: 30, // ★釣りミニゲームでの耐久度（1秒ごとに魚の攻撃力ぶん減る）
    rodPower: 4, // ★釣りミニゲームでの攻撃力（1秒ごとに魚の体力を削る量）
    params: { 希少度: 1 }
  },
  "fishrod_002": {
    name: "鋼の釣竿",
    category: "tool",
    description: "しなりが良く、大物相手でも粘れる上質な釣竿。",
    rank: "D",
    listedPrice: 600,
    trueValue: 600,
    buyPrice: 1200,
    isFishingRod: true,
    rodDurability: 60,
    rodPower: 9,
    params: { 希少度: 2 }
  },
  "fishbait_001": {
    name: "ミミズ",
    category: "material",
    description: "川辺で掘れば見つかる、ごく普通の釣り餌。小物がよく食いつく。",
    rank: "F",
    listedPrice: 5,
    trueValue: 5,
    buyPrice: 10,
    isFishingBait: true,
    baitFishType: "小物", // ★この種類の魚が食いつきやすい
    baitBiteRate: 6, // ★食いつき度（高いほど短い間隔で食いつく）
    params: { 希少度: 1 }
  },
  "fishbait_002": {
    name: "特製ルアー",
    category: "material",
    description: "職人が作った本物そっくりの疑似餌。大物ほど反応しやすい。",
    rank: "D",
    listedPrice: 200,
    trueValue: 200,
    buyPrice: 400,
    isFishingBait: true,
    baitFishType: "大物",
    baitBiteRate: 3,
    params: { 希少度: 3 }
  },
  // ★魚アイテム。category:"fish" で、インベントリでは水色の文字色になる（mainfunc.js）。
  //   fishType/fishPower/fishHp/fishSize は釣りミニゲーム（fishing.js）が参照するステータス
  "fish_001": {
    name: "ふなっこ",
    category: "fish",
    description: "どこの川にもいる、ありふれた小魚。",
    rank: "F",
    listedPrice: 10,
    trueValue: 10,
    fishType: "小物",
    fishPower: 2,
    fishHp: 10,
    fishSize: 12,
    params: { 種類: "小物", 強さ: 2, 大きさ: 12, レア度: "F", 体力: 10 }
  },
  "fish_002": {
    name: "銀鱗のアユ",
    category: "fish",
    description: "光を弾くような美しい銀色の鱗を持つアユ。塩焼きにすると絶品らしい。",
    rank: "D",
    listedPrice: 80,
    trueValue: 80,
    fishType: "小物",
    fishPower: 4,
    fishHp: 22,
    fishSize: 25,
    params: { 種類: "小物", 強さ: 4, 大きさ: 25, レア度: "D", 体力: 22 }
  },
  "fish_003": {
    name: "怪魚ヌシ",
    category: "fish",
    description: "川の主とも噂される、正体不明の巨大魚。生半可な釣竿ではすぐに糸を切られてしまう。",
    rank: "B",
    listedPrice: 1500,
    trueValue: 1500,
    fishType: "大物",
    fishPower: 10,
    fishHp: 70,
    fishSize: 180,
    params: { 種類: "大物", 強さ: 10, 大きさ: 180, レア度: "B", 体力: 70 }
  },
  
  // ===== 料理関連（要望対応：どのレシピにも一致しなかった時にできる失敗作） =====
  "food_cooking_fail": {
    name: "ゲロ以下のにおいがプンプンする料理",
    category: "food",
    description: "材料の組み合わせが噛み合わなかったのか、見た目も匂いもひどいことになってしまった一品。とても食べる気にはなれない。",
    rank: "F",
    listedPrice: 1,
    trueValue: 1,
    params: {}
  },

  // ===== 本系（要望対応：本のジャンルを増やしてほしい。世界観に合わせたラインナップ） =====
  "book_dragonslayer_saga": {
    name: "竜殺し英雄譚",
    category: "book",
    bookGenre: "冒険譚",
    description: "各地に伝わる「竜殺し」の武勇伝を集めた本。あちこちで話が盛られすぎていて、どこまで本当か怪しい。",
    rank: "E",
    listedPrice: 200,
    trueValue: 200,
    params: { 希少度: 2 },
    pages: [
      "――昔々、とある村を襲った竜を、たった一人で討ち取った剣士がいたという。\n\n村人たちはその剣士を「竜殺し」と呼び、以来この二つ名は最強の証として語り継がれることとなった。",
      "もっとも、この本に載っている「竜殺し」の武勇伝は十七話あるが、そのうち十五話は明らかに誇張、もしくは丸ごと作り話である。\n\n残り二話については、著者も真偽を確かめる勇気がなかったらしい。",
      "ちなみに実在する「竜殺し」を名乗る者に会ったという読者からの投書が編集部に届いているが、真偽は不明である。もし本当に会えたなら、酒の一杯でも奢ってもらうといい。"
    ]
  },
  "book_romance_novel": {
    name: "恋する行商人",
    category: "book",
    bookGenre: "恋愛小説",
    description: "旅から旅への行商人と、ある町の宿屋の娘との恋を描いた小説。町の女性たちの間でひそかに人気らしい。",
    rank: "E",
    listedPrice: 150,
    trueValue: 150,
    params: { 希少度: 1 },
    pages: [
      "行商人のロランは、今日もまたあの宿屋に立ち寄った。荷物を降ろす前に、まず宿の娘の顔を見に行くのがいつからかの習慣になっていた。",
      "「また来たの。懲りないわね」\n娘はそう言って笑うが、その日の夕食にはいつも一品多く料理が並ぶことに、ロランはまだ気づいていない。",
      "旅とは、いつか終わるものだ。ロランはそれを知っている。だからこそ、この宿に立ち寄るたび、少しだけ長く滞在する理由を、自分自身にもうまく説明できずにいた。"
    ]
  },
  "book_mystery_novel": {
    name: "消えた鑑定士",
    category: "book",
    bookGenre: "推理小説",
    description: "とある町で起きた鑑定士失踪事件を追う推理小説。犯人の動機が「なんでも鑑定」がらみだったというオチに賛否両論。",
    rank: "D",
    listedPrice: 250,
    trueValue: 250,
    params: { 希少度: 2 },
    pages: [
      "町一番の鑑定士が、ある朝忽然と姿を消した。残されたのは、ただ一枚の鑑定書と、意味深な走り書きだけだった。",
      "探偵役の青年は、鑑定書に記された「真価」の数字がどれも一桁だけ書き換えられていることに気づく。誰かが意図的に評価額を操作していたのだ。",
      "犯人は、鑑定士自身の弟子だった。師の目利きに頼らず、自分の力で真価を見抜けるようになりたい――そのねじれた想いが、事件の引き金だったという。\n\n読後、しばらく鑑定士という職業を見る目が変わってしまう一冊。"
    ]
  },
  "book_monster_encyclopedia": {
    name: "魔物図鑑（初級編）",
    category: "book",
    bookGenre: "図鑑",
    description: "冒険者ギルドが新人向けに配布している魔物図鑑。危険度の低い魔物を中心にまとめられている。",
    rank: "E",
    listedPrice: 180,
    trueValue: 180,
    params: { 希少度: 1 },
    pages: [
      "本書は、冒険者ギルドに登録したばかりの新人向けに編纂された図鑑である。まずは命を落とさないための最低限の知識として読んでほしい。",
      "第一項：スライム類\n見た目に反して、酸性の体液で装備を溶かしてくることがある。侮って裸手で触れるべからず。",
      "第二項：ゴブリン類\n単体ではさほど脅威ではないが、群れで行動する習性がある。一匹見かけたら、その背後に十匹いると思え。",
      "なお、上級の魔物・希少種については、続巻（中級編・上級編）が別途ギルドの資料室に保管されている。閲覧には相応の実績が必要となる。"
    ]
  },
  "book_magic_primer": {
    name: "初級魔法指南書",
    category: "book",
    bookGenre: "魔法書",
    description: "魔法の基礎理論をまとめた入門書。難しい術式の話は少なく、感覚的な説明が多いので独学者にも人気。",
    rank: "D",
    listedPrice: 400,
    trueValue: 400,
    params: { 希少度: 3 },
    pages: [
      "魔法とは、己の内にある力を、世界の理に橋渡しする技術である――と、賢者たちは小難しく説明したがるが、要は「イメージを力に変える」だけの話だ。",
      "初めて魔法を使おうとする者の多くは、力みすぎて逆に発動できない。肩の力を抜き、手のひらに小さな灯りを灯すところから始めるといい。",
      "本書の後半には簡単な自己流の訓練メニューを載せているが、我流のまま突き進むと妙な癖がついて後々苦労する。できれば、きちんとした師について学ぶことを勧める。"
    ]
  },
  "book_poetry_anthology": {
    name: "旅人の詩集",
    category: "book",
    bookGenre: "詩集",
    description: "名も無き旅人たちが道すがら詠んだ詩を集めた詩集。うまい詩もあれば、明らかに酔っ払いが書いたようなものも混ざっている。",
    rank: "E",
    listedPrice: 120,
    trueValue: 120,
    params: { 希少度: 1 },
    pages: [
      "「行く先は　風のみぞ知る　旅の道　\n　振り返れば　故郷は遠く」",
      "「宿の酒　安くて不味くて　最高だ　\n　明日の頭痛　知ったことかよ」\n\n――これは詩なのか、ただの酔っ払いの戯言なのか、編者にも判断がつかなかったが、一応そのまま掲載した。",
      "「異国より　落ちてきた男　笑い話　\n　されど今では　誰かの支え」\n\n作者不明。だが、なぜかこの一編だけは、読むたびに妙に胸に残ると評判である。"
    ]
  },
  "book_ghost_stories": {
    name: "夜宵の怪談集",
    category: "book",
    bookGenre: "怪談・ホラー",
    description: "各地の宿場町に伝わる怪談をまとめた一冊。読むと決まって誰かが「今夜眠れなくなった」と文句を言ってくる、と評判（悪評）の本。",
    rank: "D",
    listedPrice: 200,
    trueValue: 200,
    params: { 希少度: 2 },
    pages: [
      "――ある洞窟には、灯りを持たずに入ると、奥からすすり泣くような声が聞こえてくるという。\n\n実際にはただの風の音だと言われているが、確かめに行った者の多くが、途中で引き返してくる。",
      "宿屋の空き部屋に泊まると、深夜、誰も座っていないはずの椅子がきしむ音がするという噂がある。\n\n宿の主人いわく「古い建物だから床が鳴るだけ」とのことだが、その割には毎回同じ部屋でしか起きないらしい。",
      "本書の著者は、これらの怪談について「大半は説明のつく現象」としながらも、最後の一話――ある廃墟の井戸にまつわる話――についてだけは、あえて解説を付けなかった。\n\n気になる者は、自分の目で確かめに行くといい（責任は負いかねる）。"
    ]
  },
  "book_business_guide": {
    name: "町の商人心得",
    category: "book",
    bookGenre: "商売指南",
    description: "駆け出しの商人・店主向けの実用書。買取価格の付け方から客あしらいまで、実践的な内容が並ぶ。",
    rank: "E",
    listedPrice: 220,
    trueValue: 220,
    params: { 希少度: 1 },
    pages: [
      "商売の基本は「安く仕入れて高く売る」――これに尽きる。だが、それだけを露骨にやると客はすぐに離れていく。大事なのは、客に「損はしていない」と思わせる見せ方だ。",
      "オークションのような競り形式の売買では、相場より少し安い出品を混ぜておくと、客の間に「掘り出し物があるかもしれない」という期待感が生まれ、全体の熱気が上がる。",
      "不動産や店舗を持つ者への忠告：一番の資産は建物でも商品でもなく、常連客との信頼である。これだけは、どれだけ真価を鑑定する目を持っていても、金では買えない。"
    ]
  },
  "book_fairy_tale": {
    name: "月と籠の少女",
    category: "book",
    bookGenre: "童話",
    description: "子供向けの童話。籠に閉じ込められた少女が、旅人との出会いをきっかけに外の世界へ踏み出す話。",
    rank: "E",
    listedPrice: 100,
    trueValue: 100,
    params: { 希少度: 1 },
    pages: [
      "むかしむかし、ある屋敷の奥に、小さな籠に入れられたまま育った少女がいました。少女は外の世界を知らず、ただ月の光だけを友達だと思っていました。",
      "ある日、旅の途中で道に迷った一人の旅人が、偶然その屋敷にたどり着きます。旅人は籠の少女を見て、こう言いました。\n「その籠、鍵はかかっているのかい？」",
      "少女は答えます。「鍵なら、ずっと前からかかっていないの。ただ、出ていいのかどうかが、わからなかっただけ」\n\n旅人は少女の手を取り、籠の外へ連れ出しました。それから二人がどこへ向かったのかは、誰も知りません。ただ、少女はもう二度と月だけを友達とは呼ばなくなった、ということだけが伝わっています。"
    ]
  },
  "book_ancient_myth": {
    name: "古の神々と異界渡りの伝承",
    category: "book",
    bookGenre: "神話・歴史書",
    description: "この世界に伝わる古い神話をまとめた歴史書。中でも「異界から人を招く神」の逸話は、学者の間でも扱いが分かれる際どい話らしい。",
    rank: "C",
    listedPrice: 600,
    trueValue: 600,
    params: { 希少度: 4 },
    pages: [
      "この世界には、時折「異界より人を招く神」の伝承が残っている。曰く、その神は理由も告げず、ただ気まぐれに一人の人間をこの世界へ送り込むのだという。",
      "招かれた者の多くは、右も左もわからぬまま、この世界のどこかに放り出される。だが伝承は、そうした者たちの末路を「不幸だった」とは記していない。\n\n出会い、戦い、時に何かを失いながらも、多くは自分なりの居場所を見つけていった――と、どの写本にも共通してそう締めくくられている。",
      "この神を祀る社は、今のところどこにも見つかっていない。学者たちの間では「本当にただの伝承」と切り捨てる者と、「誰かがきっと今この瞬間も招かれている」と本気で信じる者とに、意見が分かれている。"
    ]
  },
  "book_slavery_records": {
    name: "ある解放記録",
    category: "book",
    bookGenre: "記録・手記",
    description: "とある地方で行われていた人身売買の実態と、それに立ち向かった者たちの記録をまとめた手記。読む者を選ぶ、重い内容の一冊。",
    rank: "C",
    listedPrice: 500,
    trueValue: 500,
    unsellable: true,
    params: { 希少度: 3 },
    pages: [
      "この記録は、表向きは「使用人の斡旋業」を名乗りながら、その裏で自由を奪われた者たちを商品として扱っていた者たちの実態と、それに気づき、声を上げた人々の足跡をまとめたものである。",
      "声を上げることは、決して簡単ではなかった。当時者たちの多くは、まず「自分たちの扱われ方がおかしい」と気づくことからして困難だったという。\n\n名も無い誰かが、誰かの手を取ったところから、少しずつ物事は動き始めた。",
      "著者はあとがきにこう記している。\n「この記録が、いつか誰かの過去の話で終わる日が来ることを願う。だが今はまだ、現在進行形の話として、これを書き残さねばならない」"
    ]
  }
  
};