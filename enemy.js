// enemy.js
// 通常の（ボスではない）魔物のデータをまとめたファイル。
// ボス格の魔物（洞窟の主・森の主など）と試練の守護者は boss.js 側にある。
// battle.js が ENEMY_MASTER と BOSS_MASTER を合体させて MONSTER_MASTER を作る。

const ENEMY_MASTER = {
  goblin: {
    name: "ゴブリン",
    description: "群れで行動する小柄な魔物。気は荒いが、単体ではそれほど強くない。",
    maxHp: 22,
    atk: 6,
    exp: 16, // ★もう少しレベルが上がりやすいよう引き上げ
    dropItemId: "material_001", // ゴブリンの牙
    dropRate: 0.5,
    killFlavor: "「ぎゃああ！」",
    spareFlavor: "「ウガ……ウガー……（見逃してくれるのか……？）」",
    giftItemId: "material_001",
    uniqueSkill: { name: "咆哮", chance: 0.25, multiplier: 1.4, flavor: "「ウガアアア！」" }
  },
  bat: {
    name: "洞窟コウモリ",
    description: "洞窟の暗闇を好む小さなコウモリ型の魔物。奇声で仲間を呼ぶことがある。",
    maxHp: 14,
    atk: 4,
    exp: 11,
    dropItemId: null,
    dropRate: 0,
    killFlavor: "「キィィ！」",
    spareFlavor: "「キキー……キキー……（見逃してくれるのか……）」",
    giftItemId: "herb_001",
    uniqueSkill: { name: "超音波", chance: 0.3, multiplier: 1.3, flavor: "耳障りな超音波が響く！" }
  },
  slime: {
    name: "スライム",
    description: "ぷるぷるとした半透明の体を持つ、もっとも基本的な魔物。見た目に反して意外と手強い。",
    maxHp: 17,
    atk: 3,
    exp: 9,
    dropItemId: "herb_001",
    dropRate: 0.4,
    killFlavor: "「ぷにゅ……」",
    spareFlavor: "「ぷるん……ぷるん……（ありがとう……）」",
    maxAffectionLine: "「ぷるぷる！ぷるぷるぷる！♡」",
    giftItemId: "herb_001",
    uniqueSkill: { name: "酸打", chance: 0.25, multiplier: 1.3, flavor: "「ぷるん！」体が酸を帯びて打ち付けてくる！" }
  },
  wolf: {
    name: "はぐれ狼",
    description: "群れからはぐれた狼が魔力を帯びた姿。牙による攻撃が鋭い。",
    maxHp: 27,
    atk: 8,
    exp: 20,
    dropItemId: "material_001",
    dropRate: 0.3,
    killFlavor: "「ガアッ！」",
    spareFlavor: "「クゥーン……（命拾いしたな……）」",
    giftItemId: "material_001",
    uniqueSkill: { name: "喉笛狙い", chance: 0.25, multiplier: 1.5, flavor: "鋭い牙で喉元を狙ってくる！" }
  },
  giant_rat: {
    name: "巨大ネズミ",
    description: "洞窟や下水に潜む巨大なネズミ。数で押してくることが多い。",
    maxHp: 11,
    atk: 3,
    exp: 6,
    dropItemId: "herb_002",
    dropRate: 0.3,
    killFlavor: "「チュー！」",
    spareFlavor: "「チューチュー……（見逃してくれるのね……）」",
    giftItemId: "herb_002",
    uniqueSkill: { name: "疫病の牙", chance: 0.25, multiplier: 1.3, flavor: "汚れた牙で噛みついてくる！" }
  },
  skeleton: {
    name: "スケルトン",
    description: "古い骨が魔力で動き出した不死の魔物。痛みを感じないため頑丈。",
    maxHp: 26,
    atk: 7,
    exp: 18,
    dropItemId: "material_001",
    dropRate: 0.35,
    killFlavor: "「ガラガラ……」",
    spareFlavor: "「カタカタ……（この骨に免じて……）」",
    giftItemId: "material_001",
    uniqueSkill: { name: "骨の乱舞", chance: 0.25, multiplier: 1.4, flavor: "骨をガタガタと鳴らしながら襲いかかってくる！" }
  },
  orc: {
    name: "オーク",
    description: "屈強な体を持つ、力自慢の魔物。集団の中でも上位の実力者。",
    maxHp: 31,
    atk: 11,
    exp: 32,
    dropItemId: "material_002",
    dropRate: 0.04, // ★かなり希少な鱗なので、出にくくしてある
    killFlavor: "「グボァッ！」",
    spareFlavor: "「グフ……グフ……（次会う時は敵とは限らんぞ……）」",
    giftItemId: "material_001",
    uniqueSkill: { name: "渾身の一撃", chance: 0.2, multiplier: 1.8, flavor: "大きく振りかぶり、渾身の一撃を放ってくる！" }
  },
  // ★倒す直前に、サキュバス自身がセリフを言う特殊演出がある（battleLoop参照）
  succubus: {
    name: "サキュバス",
    description: "人を誘惑する妖艶な魔物。戦闘中も甘い言葉で気を逸らしてくる。",
    maxHp: 24,
    atk: 9,
    exp: 24,
    dropItemId: null,
    dropRate: 0,
    killFlavor: "「ひ、ひどい！女の子にこんな事するなんて！うぅ……」",
    spareFlavor: "「ありがとうございます！優しいお兄さん♡（フッ、バカねッ……）」",
    affectionGainRange: [3, 7], // ★他の魔物より好感度が上がりにくい（一貫して性格が悪いという設定）
    restSkillName: "サキュバスと休憩♡", // ★好感度MAXで魔物図鑑から使えるようになる専用スキル
    uniqueSkill: { name: "誘惑", chance: 0.3, multiplier: 0.6, kind: "drain", spDrain: 8, flavor: "「うふふ、もっとこっちにおいでよ♡」" } // ★ダメージは控えめだが、代わりにSPを吸い取ってくる
  },
  forest_boar: {
    name: "森いのしし",
    description: "森に棲む大きな猪型の魔物。突進の勢いは侮れない。",
    maxHp: 20,
    atk: 6,
    exp: 12,
    dropItemId: "herb_003",
    dropRate: 0.3,
    killFlavor: "「ブモォォ！」",
    spareFlavor: "「ブヒ……ブヒ……（恩に着るぜ……）」",
    giftItemId: "herb_001",
    uniqueSkill: { name: "突進", chance: 0.3, multiplier: 1.4, flavor: "土煙を上げながら猛烈な勢いで突進してくる！" }
  },
  harpy: {
    name: "ハーピー",
    description: "翼を持つ鳥人型の魔物。空から奇襲を仕掛けてくる。",
    maxHp: 22,
    atk: 7,
    exp: 15,
    dropItemId: null,
    dropRate: 0,
    killFlavor: "「いやぁ！許してぇ……」",
    spareFlavor: "「う、嬉しい！ありがとうございます！」",
    maxAffectionLine: "「大好き！好きぃー！♡」",
    giftItemId: "harpy_water",
    uniqueSkill: { name: "強襲", chance: 0.3, multiplier: 1.4, flavor: "空高くから急降下して襲いかかってくる！" }
  },
  treant: {
    name: "森の樹人",
    description: "長い年月を経て魔力を宿した樹木の魔物。動きは遅いが打たれ強い。",
    maxHp: 35,
    atk: 10,
    exp: 34,
    dropItemId: "herb_003",
    dropRate: 0.4,
    killFlavor: "「ギギギ……（朽ちていく……）」",
    spareFlavor: "「ザザ……ザワ……（森の恵みを授けよう……）」",
    giftItemId: "herb_001",
    uniqueSkill: { name: "根絡み", chance: 0.25, multiplier: 1.3, flavor: "地面から根が伸び、絡みついてくる！" }
  },
  // ★毒矢による攻撃で、たまに毒状態を付与してくる（poisonChance参照）
  poison_zombie: {
    name: "毒弓ゾンビ",
    description: "弓矢に毒を塗って放ってくる不死の魔物。動きは鈍いが、毒矢を受けるとじわじわと体力を奪われる。",
    maxHp: 24,
    atk: 6,
    exp: 20,
    dropItemId: "potion_002", // ★皮肉にも、自分の毒を治す解毒ポーションを落とすことがある
    dropRate: 0.3,
    poisonChance: 0.4, // ★攻撃が命中した時、4割の確率で毒状態にしてくる
    killFlavor: "「ガアアア……」",
    spareFlavor: "「ア……ア……（ありがとう……）」",
    giftItemId: "potion_002"
  }
};