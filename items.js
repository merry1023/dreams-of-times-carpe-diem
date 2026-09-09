// items.js
// ゲーム内に存在する全アイテムの「マスターデータ」を管理するファイル。
// ここには「設計図」だけを置く。実際にプレイヤーが持つ在庫は inventory.js が管理する。

/*
  ITEM_MASTER の共通フィールド:
  - name        : アイテム名
  - category    : "herb"(薬草) / "potion"(ポーション) / "material"(魔物素材) / "weapon"(武器) / "armor"(防具) / "tool"(回復以外の特殊効果を持つ道具)
  - description : アイテムの説明文
  - rank        : お宝ランク（鑑定結果に使う目安。F〜S等）
  - listedPrice : 定価。町の買取屋が普通につける価格。プレイヤーは鑑定しなくてもこの額は見える想定
  - trueValue   : 真価。本当の価値。「なんでも鑑定」で見抜くまでは隠しておく想定
  - params      : カテゴリごとに意味が変わる数値・効果のまとまり
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
    // ★専用スキル「静かなる権威」：装備中に道具コマンドから発動できる。効果はbattle.jsのuseEquipmentBattleSkillが処理する
    battleSkill: {
      name: "静かなる権威",
      description: "2ターンの間、相手の攻撃によるダメージを1/3にする。",
      effect: "damageReduction",
      duration: 2,
      reductionRatio: 1 / 3
    },
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
    // ★専用スキル「約束された絶頂の剣♂」：装備中に道具コマンドから発動できる
    battleSkill: {
      name: "約束された絶頂の剣♂",
      description: "1/3の確率で、相手に絶頂による行動不能を3ターン付与する。",
      effect: "stunChance",
      chance: 1 / 3,
      duration: 3
    },
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
  }
  
};