// player.js
// プレイヤーの状態（職業、レベル、ゲージ、基本ステータス、スキル）を管理するファイル。
// items.js / inventory.js とは独立しているので読み込み順はどこでもいいが、
// mainfunc.js より前に読み込むこと（表示関数から参照されるため）。

/*
  CLASS_MASTER の中身:
  - description : 職業の説明
  - baseStats   : 初期ステータス（HP/SPの最大値、攻撃力、素早さ、魔力、運、魅力）
  - maxSleepiness / maxFatigue : 眠気・疲労度ゲージの最大値（職業ごとの耐性の違いを表現）
  ★防御力システムは廃止した。バランス調整が難しかったため、防御の役割は
    「最大HPの高さ」に統合している（旧・防御力が高かった職業ほど、その分HPが多めになっている）
*/
const CLASS_MASTER = {
  "全能士": {
    description: "だいたいの職業の基本スキルが使える、バランス型。",
    baseStats: { maxHp: 35, maxSp: 55, atk: 4, agi: 8, skillPower: 10, luck: 10, charm: 10 },
    maxSleepiness: 100,
    maxFatigue: 100,
    // ★レベルアップ1回ごとの成長量（累積を毎回四捨五入するとズレるので、
    //   使う時は「目標レベルまでの合計」から「1つ前のレベルまでの合計」を引いて差分を出す）
    growthPerLevel: { maxHp: 4.5, maxSp: 5.5, atk: 0.7, agi: 0.5, skillPower: 1, luck: 0.4, charm: 0.4, maxFatigue: 2.5, maxSleepiness: 2 }
  },
  "戦士": {
    description: "前線でひたすら殴る、シンプルな脳筋タイプ。他の職業より打たれ強く、少しだけ攻撃力も高い。",
    baseStats: { maxHp: 44, maxSp: 35, atk: 6, agi: 7, skillPower: 5, luck: 8, charm: 8 },
    maxSleepiness: 100,
    maxFatigue: 120,
    growthPerLevel: { maxHp: 5.5, maxSp: 3.5, atk: 1.0, agi: 0.4, skillPower: 0.4, luck: 0.2, charm: 0.2, maxFatigue: 3, maxSleepiness: 2 }
  },
  "性騎士": {
    description: "そこそこ戦えるが、それ以上に「魅力」に特化した職業。",
    baseStats: { maxHp: 36, maxSp: 45, atk: 4, agi: 8, skillPower: 8, luck: 12, charm: 25 },
    maxSleepiness: 100,
    maxFatigue: 100,
    growthPerLevel: { maxHp: 4.3, maxSp: 4.5, atk: 0.7, agi: 0.5, skillPower: 0.6, luck: 0.4, charm: 1.2, maxFatigue: 2.5, maxSleepiness: 2 }
  },
  "ニート": {
    description: "戦闘力はほぼ皆無。だが謎の悪運と、眠気への耐性だけは高い。",
    baseStats: { maxHp: 24, maxSp: 65, atk: 2, agi: 5, skillPower: 8, luck: 15, charm: 5 },
    maxSleepiness: 150,
    maxFatigue: 60,
    growthPerLevel: { maxHp: 3, maxSp: 6.5, atk: 0.4, agi: 0.3, skillPower: 0.6, luck: 0.8, charm: 0.2, maxFatigue: 1.5, maxSleepiness: 3 }
  },
  "お宝鑑定団": {
    description: "戦闘は不得意だが、物の価値を見抜く目に長けている。",
    baseStats: { maxHp: 27, maxSp: 50, atk: 3, agi: 9, skillPower: 16, luck: 20, charm: 10 },
    maxSleepiness: 100,
    maxFatigue: 90,
    growthPerLevel: { maxHp: 3.5, maxSp: 5.5, atk: 0.5, agi: 0.4, skillPower: 1.2, luck: 1, charm: 0.3, maxFatigue: 2, maxSleepiness: 2 }
  },
  "魔法少女": {
    description: "見た目はただの冴えないおっさんだが、なぜか魔法少女の力に目覚めてしまった謎の存在。「マジカル変身」で魔法少女に変身している間だけ魔法を扱える。SPが豊富で、変身中は魔法の威力が上がり、毎ターンSPも少しずつ回復する。",
    baseStats: { maxHp: 29, maxSp: 85, atk: 3, agi: 9, skillPower: 18, luck: 12, charm: 6 },
    maxSleepiness: 100,
    maxFatigue: 90,
    growthPerLevel: { maxHp: 3.8, maxSp: 8.5, atk: 0.5, agi: 0.4, skillPower: 1.5, luck: 0.4, charm: 0.2, maxFatigue: 2, maxSleepiness: 2 }
  }
};

// スキルを新たに習得できるレベルの一覧（職業共通）。25段階の技表に対応。
const SKILL_UNLOCK_LEVELS = [1, 2, 4, 6, 7, 9, 11, 13, 15, 17, 19, 24, 28, 34, 35, 40, 47, 54, 65, 70, 78, 84, 90, 97, 100];

/*
  CLASS_SKILLS の中身（1スキルあたり）：25段階技表（職業別）を反映
  - name/description : 表示名・説明
  - type        : "attack"（敵への攻撃） / "heal"（HP等の回復） / "buff"（自分への強化） / "special"（固有処理）
  - unlockLevel : このレベルになった時点で習得する（SKILL_UNLOCK_LEVELSのいずれか）
  - power       : attackなら威力、healなら回復量
  - target      : "all" なら敵全体（attackのみ。無指定は単体）
  - hitCount    : 攻撃の連続回数（無指定は1回）
  - statusEffect: 命中した敵に確率で付与する状態異常 { kind, chance, duration, power }
  - selfBuff    : 自分に付与する強化 { kind, duration, power }（kind: atkUp/defUp/critUp/immune）
  - selfDamageRatio : 使用時に自分の最大HPの何%を消費するか
  - spCost      : 使用に必要なSP
  - gauge       : healタイプの対象ゲージ
  - element     : 技の属性（フレーバー。魔法少女は現在の属性が動的に入る）
*/
const CLASS_SKILLS = {
  // 戦士
  "戦士": [
    { name: "イクサガミの被虐趣向", description: "自身の残りHPを力に変え、次に使用する攻撃を強化する。残りHPが少ないほど威力が大きく上昇する。攻撃を行うと効果は解除される。", type: "buff", element: "無", spCost: 6, unlockLevel: 1, selfBuff: { kind: "hpBerserk", duration: 1 } },
    { name: "剛腕一閃", description: "全身の筋力を一点に集中させて叩き込む重厚な剣撃。敵単体に物理ダメージを与え、低確率でスタンを付与する。", type: "attack", atkType: "physical", element: "物理", spCost: 4, unlockLevel: 2, power: 8, statusEffect: { kind: "stun", chance: 0.25, duration: 1, power: 3 } },
    { name: "弧月斬（こげつざん）", description: "素早く円を描くように得物を振り抜き、敵全体に物理ダメージを与える。", type: "attack", atkType: "physical", target: "all", element: "物理", spCost: 4, unlockLevel: 4, power: 10 },
    { name: "爆炎の舞(ディオニス・ディウム)", description: "刀身に高熱の炎を纏わせて敵を焼き払う範囲攻撃。敵全体に炎属性ダメージを与え、火傷を負わせる。", type: "attack", atkType: "magical", target: "all", element: "炎", spCost: 8, unlockLevel: 6, power: 11, statusEffect: { kind: "burn", chance: 1, duration: 3, power: 3 } },
    { name: "金城鉄壁の構え", description: "盾や得物を構えて防御姿勢を取り、一定ターンの間、自身の被ダメージを軽減する。", type: "buff", element: "物理", spCost: 5, unlockLevel: 7, selfBuff: { kind: "defUp", duration: 2, power: 30 } },
    { name: "疾風迅雷突き", description: "電流を纏った鋭い突きを繰り出し、敵単体に雷属性ダメージを与える。低確率で麻痺を付与する。", type: "attack", atkType: "magical", element: "雷", spCost: 9, unlockLevel: 9, power: 14, statusEffect: { kind: "paralyze", chance: 0.2, duration: 1, power: 3 } },
    { name: "猪武者の豪突（いのししむしゃのごうとつ）", description: "全力で敵陣に突撃し、敵全体に物理ダメージを与える。", type: "attack", atkType: "physical", target: "all", element: "物理", spCost: 10, unlockLevel: 11, power: 16 },
    { name: "月光、夕刻の終わり。", description: "敵に鈍い一撃をはなつ。敵を鈍痛状態にし、継続ダメージを与える。", type: "attack", atkType: "physical", element: "物理", spCost: 11, unlockLevel: 13, power: 18, statusEffect: { kind: "dullPain", chance: 1, duration: 3, power: 4 } },
    { name: "甲殻穿孔（こうかくせんこう）", description: "敵の防御力の一部を無視する強打を放ち、敵単体に確実なダメージを与える。", type: "attack", atkType: "physical", element: "物理", spCost: 16, unlockLevel: 17, power: 21 },
    { name: "獣王無尽(レックス・ブレイク)", description: "自身に獣の心を宿し、極めて高いダメージを敵全体に与える。", type: "attack", atkType: "physical", target: "all", element: "物理", spCost: 17, unlockLevel: 19, power: 23 },
    { name: "破軍双刃（はぐんそうじん）", description: "得物を両手で操り、敵単体へ5回の連続斬撃を浴びせる。", type: "attack", atkType: "physical", element: "物理", spCost: 18, unlockLevel: 24, power: 28, hitCount: 5 },
    { name: "唐竹割り（からたけわり）", description: "得物を頭上から真っ二つに振り下ろし、敵単体に大きな物理ダメージを与える。", type: "attack", atkType: "physical", element: "物理", spCost: 16, unlockLevel: 28, power: 31 },
    { name: "大地一擘（だいちいっぱく）", description: "地面を叩き割って衝撃波を発生させ、敵全体に自然属性ダメージを与える。", type: "attack", atkType: "magical", target: "all", element: "自然", spCost: 22, unlockLevel: 34, power: 37 },
    { name: "不屈の闘志", description: "一定ターンの間、致命的なダメージを受けてもHP1で耐え抜く。", type: "buff", element: "物理", spCost: 20, unlockLevel: 40, selfBuff: { kind: "surviveLethal", duration: 3, power: 0 } },
    { id: "shura_e_no_katsubou", name: "修羅への渇望（しゅらへのかつぼう）", description: "自身のHPが瀕死に近いほど攻撃回数が増える連続攻撃を敵単体に行う。", type: "attack", atkType: "physical", element: "物理", spCost: 26, unlockLevel: 47, power: 48, hitCount: 2 },
    { name: "一期一振（いちごいちふり）", description: "己の限界を超えた渾身の一撃を放ち、敵単体に大ダメージを与える。使用後、自身も反動ダメージを受ける。", type: "attack", atkType: "physical", element: "物理", spCost: 29, unlockLevel: 54, power: 55, selfDamageRatio: 0.05 },
    { name: "雷鳴一閃（らいめいいっせん）", description: "雷鳴を纏った一閃を放ち、敵単体に雷属性の大ダメージを与える。低確率で麻痺を付与する。", type: "attack", atkType: "magical", element: "雷", spCost: 33, unlockLevel: 65, power: 64, statusEffect: { kind: "paralyze", chance: 0.2, duration: 1, power: 3 } },
    { name: "万鈞の穿（ばんきんのうがち）", description: "得物を槍のように連続で突き出し、敵単体に4回の貫通ダメージを与える。", type: "attack", atkType: "physical", element: "物理", spCost: 34, unlockLevel: 70, power: 69, hitCount: 4 },
    { name: "青天の霹靂剣（せいてんのへきれきけん）", description: "己の得物に天より雷を呼び込み、敵全体に強力な雷属性ダメージを与える。", type: "attack", atkType: "magical", target: "all", element: "雷", spCost: 39, unlockLevel: 84, power: 82 }
  ],

  // 全能士
  "全能士": [
    { name: "幻想の贈り物（イマジン・ベネディクション）", description: "一定ターンの間、使用するスキルの効果が強化される（攻撃は威力上昇、回復は回復量増加）。", type: "buff", element: "光", spCost: 10, unlockLevel: 1, selfBuff: { kind: "atkUp", duration: 4, power: 8 } },
    { name: "マッスル・アタック", description: "筋肉によるゴリ押しで2回殴る。", type: "attack", atkType: "physical", element: "物理", spCost: 4, unlockLevel: 2, power: 8, hitCount: 2 },
    { name: "臨機応変", description: "状況を見極め、次に繰り出す通常攻撃の威力を高める。", type: "buff", element: "無", spCost: 4, unlockLevel: 4, selfBuff: { kind: "atkUp", duration: 1, power: 6 } },
    { id: "aun_no_issen", name: "阿吽の一閃（あうんのいっせん）", description: "味方と息を合わせて連携攻撃を行い、敵単体に追加ダメージを与える。生きている仲間の数（自分を含む）だけ連続で攻撃する。", type: "attack", atkType: "physical", element: "物理", spCost: 5, unlockLevel: 6, power: 11 },
    { name: "ロー・ディスシプリナ", description: "温かい聖なる光で包み込む回復魔法。HPを少し回復する。", type: "heal", element: "光", spCost: 5, unlockLevel: 7, power: 14, gauge: "hp" },
    { name: "気付け薬", description: "カンフル剤を打ち、SPを少量回復させる。", type: "heal", element: "光", spCost: 6, unlockLevel: 9, power: 16, gauge: "sp" },
    { name: "明鏡止水（めいきょうしすい）", description: "敵の隙を見抜き、次に自身が行う攻撃のクリティカル率を上昇させる。", type: "buff", element: "物理", spCost: 10, unlockLevel: 11, selfBuff: { kind: "critUp", duration: 2, power: 25 } },
    { name: "千変万化の一撃（せんぺんばんかのいちげき）", description: "敵単体にランダムな属性で中程度のダメージを与える。", type: "attack", atkType: "magical", element: "自然", spCost: 11, unlockLevel: 13, power: 18 },
    { name: "インター・ディスシプリナ", description: "大きな光が体を包み、中程度の傷を癒やし状態異常を治癒する。", type: "heal", element: "光", spCost: 12, unlockLevel: 17, power: 23, gauge: "hp", cleanse: true },
    { name: "斬打両断（ざんだりょうだん）", description: "得物の刃と柄を巧みに使い分け、敵単体に物理ダメージを与える。", type: "attack", atkType: "physical", element: "物理", spCost: 10, unlockLevel: 19, power: 23 },
    { name: "変幻自在の采配（へんげんじざいのさいはい）", description: "次に使用するスキルの効果を強化する。", type: "buff", element: "混沌", spCost: 14, unlockLevel: 24, selfBuff: { kind: "atkUp", duration: 2, power: 10 } },
    { name: "呉越同舟の号令（ごえつどうしゅうのごうれい）", description: "一定ターンの間、自身のステータスを強化する。", type: "buff", element: "光", spCost: 22, unlockLevel: 34, selfBuff: { kind: "atkUp", duration: 3, power: 14 } },
    { name: "二天一流（にてんいちりゅう）", description: "二つの得物を巧みに使い分け、敵単体に4連続攻撃を行う。", type: "attack", atkType: "physical", element: "物理", spCost: 24, unlockLevel: 40, power: 42, hitCount: 4 },
    { name: "業火一閃（ごうかいっせん）", description: "得物に炎を纏わせて斬りつけ、敵単体に炎属性ダメージを与える。低確率で火傷を付与する。", type: "attack", atkType: "magical", element: "炎", spCost: 22, unlockLevel: 47, power: 48, statusEffect: { kind: "burn", chance: 0.3, duration: 3, power: 3 } },
    { name: "適応進化", description: "一定ターンの間、自身が受けるダメージを軽減する。", type: "buff", element: "無", spCost: 25, unlockLevel: 54, selfBuff: { kind: "defUp", duration: 3, power: 25 } },
    { id: "high_discipline", name: "ハイ・ディスシプリナ", description: "大いなる光芒が周りを囲み、パーティ全員が大回復し状態異常が治る。さらにパーティ全員に「大いなる光芒状態」を付与し、5ターンの間、中程度の継続回復と状態異常無効が続く。", type: "heal", element: "光", spCost: 33, unlockLevel: 65, power: 71, gauge: "hp", cleanse: true, partyWide: true, selfBuff: { kind: "great_light_immune", duration: 5, power: 0 }, selfBuff2: { kind: "great_light_regen", duration: 5, power: 0 } },
    { name: "八面六臂（はちめんろっぴ）", description: "八方に得物を薙ぎ払い、敵全体に物理ダメージを与える。", type: "attack", atkType: "physical", target: "all", element: "物理", spCost: 34, unlockLevel: 70, power: 69 },
    { name: "完全支援", description: "戦闘不能になった味方を蘇生させ、同時に自身も回復する。", type: "heal", element: "光", spCost: 39, unlockLevel: 84, power: 90, gauge: "hp", revives: true }
  ],

  // 狂戦士
  "狂戦士": [
    { name: "血華の演舞（ブラッド・ダンス）", description: "自身の血を力に変え、攻撃力を強化する。効果中は、攻撃するたびに自身の攻撃力が上昇する。また、攻撃時に自身も少しダメージを受ける。(効果時間：10ターン)", type: "buff", element: "裂", spCost: 6, unlockLevel: 1, selfBuff: { kind: "blood_dance", duration: 10, power: 2 } },
    { name: "痛快の一太刀（つうかいのひとたち）", description: "自らの体を軽く傷つけて怒りを高め、次に繰り出す攻撃の威力を上昇させる。", type: "buff", element: "裂", spCost: 4, unlockLevel: 2, selfBuff: { kind: "atkUp", duration: 1, power: 8 }, selfDamageRatio: 0.02 },
    { name: "獅子吼（ししく）", description: "雄叫びを上げて自身を鼓舞し、一定ターンの間、攻撃力を上昇させる。", type: "buff", element: "物理", spCost: 5, unlockLevel: 6, selfBuff: { kind: "atkUp", duration: 3, power: 10 } },
    { name: "血振るい（ちぶるい）", description: "血に濡れた得物を振るい、敵単体に裂属性ダメージを与える。", type: "attack", atkType: "magical", element: "裂", spCost: 5, unlockLevel: 7, power: 12 },
    { name: "怒濤乱撃（どとうらんげき）", description: "怒涛の勢いで斬りつける3連撃。命中するたびに敵の防御力を低下させる。", type: "attack", atkType: "magical", element: "裂", spCost: 6, unlockLevel: 9, power: 14, hitCount: 3, statusEffect: { kind: "defDown", chance: 1, duration: 3, power: 3 } },
    { name: "紅蓮の代価（ぐれんのだいか）", description: "自身のHPを大きく消費する代わりに、敵単体へ甚大なダメージを与える。", type: "attack", atkType: "magical", element: "裂", spCost: 7, unlockLevel: 11, power: 16, selfDamageRatio: 0.1 },
    { name: "狂騒曲（きょうそうきょく）", description: "一定ターンの間、攻撃力が大幅に上昇する狂乱状態になる。", type: "buff", element: "混沌", spCost: 11, unlockLevel: 13, selfBuff: { kind: "atkUp", duration: 3, power: 16 } },
    { id: "zokugai_no_rensa", name: "賊害の連鎖(アナザー・ワン・バイツ・ザ・ダスト)", description: "10ターンの間、自分のあらゆる攻撃が別の敵にも連鎖するようになる。", type: "buff", element: "混沌", spCost: 12, unlockLevel: 17, selfBuff: { kind: "chainAttack", duration: 10, power: 0 } },
    { id: "kettou_no_kokuin", name: "血闘の刻印（けっとうのこくいん）", description: "戦闘中に自身が繰り出した攻撃の回数に応じて威力が増加する一撃を放つ（上昇量には上限がある）。", type: "attack", atkType: "physical", element: "物理", spCost: 18, unlockLevel: 24, power: 28 },
    { name: "阿鼻叫喚（あびきょうかん）", description: "阿鼻地獄の如き絶叫を撒き散らし、敵全体に混沌属性ダメージを与える。低確率で混乱を付与する。", type: "attack", atkType: "magical", target: "all", element: "混沌", spCost: 20, unlockLevel: 28, power: 31, statusEffect: { kind: "confuse", chance: 0.2, duration: 2, power: 3 } },
    { name: "業苦の悦（ごうくのえつ）", description: "自らに鈍痛を刻み、その代償として一定ターンの間、攻撃力を大きく上昇させる。", type: "buff", element: "混沌", spCost: 22, unlockLevel: 34, selfBuff: { kind: "atkUp", duration: 3, power: 20 }, selfDamageRatio: 0.03 },
    { name: "捨身乱撃（しゃしんらんげき）", description: "防御を顧みず得物を振り回し、自身の防御力を一定ターン低下させる代わりに、敵全体へ大ダメージを与える。", type: "attack", atkType: "magical", target: "all", element: "裂", spCost: 20, unlockLevel: 40, power: 42, selfBuff: { kind: "defUp", duration: 3, power: -25 } },
    { name: "怨嗟の号哭（えんさのごうこく）", description: "断末魔じみた咆哮を上げ、敵全体を混乱状態にする。", type: "attack", atkType: "magical", target: "all", element: "混沌", spCost: 25, unlockLevel: 54, power: 55, statusEffect: { kind: "confuse", chance: 1, duration: 3, power: 3 } },
    { id: "kesshu_no_utage", name: "血臭の宴（けっしゅうのうたげ）", description: "敵全体を巻き込む乱舞を行い、与えたダメージの一部を自身のHPに変換する。", type: "attack", atkType: "magical", target: "all", element: "混沌", spCost: 34, unlockLevel: 70, power: 69, lifestealRatio: 0.3 },
    { name: "終焉の血華（しゅうえんのけっか）", description: "自身のHPを大きく犠牲にして、敵単体へ致命的なダメージを与える。", type: "attack", atkType: "magical", element: "裂", spCost: 35, unlockLevel: 84, power: 82, selfDamageRatio: 0.15 }
  ],

  // 魔法少女
  // ★「属性変更」固有スキルは廃止した。代わりにLv1「マジカル変身」で変身している間だけ
  //   魔法（type: attack/heal）が使える特殊職に変更（技表準拠）。各スキルの属性は固定。
  //   変身中の判定・威力上昇・SP自動回復・強制解除はbattle.js側（isMagicalGirlTransformed等）で処理する。
  "魔法少女": [
    { id: "magical_transform", name: "ケアリー☆キューティー♡マジカル変身", description: "魔法少女へ変身する。変身中のみ魔法が使え、威力が大きく上昇し、毎ターンSPが少しずつ回復する。SPが3割を切ると強制的に解除される。", type: "special", element: "光", spCost: 8, unlockLevel: 1 },
    { name: "キュアラクル・ホーリーライト", description: "祈りを込めた光の一撃を放ち、敵単体に光属性ダメージを与える。", type: "attack", atkType: "magical", element: "光", spCost: 8, unlockLevel: 1, power: 7 },
    { name: "プリティー♡ダービー・ショット", description: "ありあまる可愛さを一発に込めて放つ攻撃。", type: "attack", atkType: "magical", element: "光", spCost: 7, unlockLevel: 2, power: 8 },
    { name: "プチ・ブロッサム", description: "敵単体に自然属性の小ダメージを与え、命中率を低下させる。", type: "attack", atkType: "magical", element: "自然", spCost: 8, unlockLevel: 4, power: 10, statusEffect: { kind: "accDown", chance: 1, duration: 2, power: 15 } },
    { name: "シャイニングアロー", description: "光の矢を放ち、敵単体に光属性ダメージを与える。", type: "attack", atkType: "magical", element: "光", spCost: 9, unlockLevel: 6, power: 11 },
    { name: "キューティクル・マシンガン☆", description: "小さな魔法弾を連続で撃ち込む連撃。ひとつひとつのダメージは少ないがすべて当たると強い。", type: "attack", atkType: "magical", element: "物理", spCost: 9, unlockLevel: 7, power: 7, hitCount: 5 },
    { name: "スパークルフレイム", description: "敵単体に炎属性ダメージを与え、軽度の火傷状態を付与する。", type: "attack", atkType: "magical", element: "炎", spCost: 15, unlockLevel: 9, power: 14, statusEffect: { kind: "burn", chance: 1, duration: 2, power: 3 } },
    { name: "マジカル・キュア・ラブ・ショット", description: "愛の力を込めた高純度の熱光線を敵全体に浴びせる。火傷状態にする。", type: "attack", atkType: "magical", element: "光", target: "all", spCost: 17, unlockLevel: 11, power: 16, statusEffect: { kind: "burn", chance: 1, duration: 2, power: 3 } },
    { name: "ツインクルサンダー", description: "敵単体に雷属性ダメージを与え、低確率で行動封じを付与する。", type: "attack", atkType: "magical", element: "雷", spCost: 18, unlockLevel: 13, power: 18, statusEffect: { kind: "stun", chance: 0.2, duration: 1, power: 3 } },
    { name: "影縛りの呪(シャドウバインド)", description: "敵単体を闇の力で拘束し、一定ターンの間、行動を制限する。", type: "attack", atkType: "magical", element: "闇", spCost: 26, unlockLevel: 17, power: 21, statusEffect: { kind: "paralyze", chance: 1, duration: 2, power: 3 } },
    { name: "ラブリーレイ", description: "愛らしい光線を放ち、敵単体に光属性ダメージを与える。", type: "attack", atkType: "magical", element: "光", spCost: 17, unlockLevel: 19, power: 23 },
    { name: "スターダストシャワー", description: "降り注ぐ光の粒で敵全体に光属性の範囲ダメージを与える。", type: "attack", atkType: "magical", element: "光", target: "all", spCost: 28, unlockLevel: 24, power: 28 },
    { name: "ギャラクシーボルト", description: "星屑を纏った雷撃を放ち、敵全体に雷属性ダメージを与える。", type: "attack", atkType: "magical", element: "雷", target: "all", spCost: 26, unlockLevel: 28, power: 31 },
    { name: "混沌の渦(カオスヴォルテックス)", description: "敵全体にランダムな属性のダメージを連続して与える。", type: "attack", atkType: "magical", element: "混沌", target: "all", spCost: 34, unlockLevel: 34, power: 37, hitCount: 2 },
    { name: "エターナル・ブリザード", description: "敵の周りに永遠なる氷河を創造し大ダメージを与え、大いなる氷結状態にする。3ターンの間行動不能にし、継続ダメージを与える。", type: "attack", atkType: "magical", element: "自然", spCost: 28, unlockLevel: 35, power: 38, statusEffect: { kind: "great_frost_stun", chance: 1, duration: 3, power: 0 }, statusEffect2: { kind: "great_frost_dot", chance: 1, duration: 3, power: 4 } },
    { name: "フェアリーブレッシング", description: "味方全体を回復させつつ、一定ターンの間、攻撃力を上昇させる。", type: "heal", element: "自然", spCost: 36, unlockLevel: 40, power: 46, gauge: "hp", partyWide: true, selfBuff: { kind: "atkUp", duration: 3, power: 8 } },
    { name: "フレイムサンダーストーム", description: "敵全体に強力な炎属性ダメージを与え、火傷状態を付与する。", type: "attack", atkType: "magical", element: "炎", target: "all", spCost: 44, unlockLevel: 54, power: 55, statusEffect: { kind: "burn", chance: 1, duration: 3, power: 3 } },
    { name: "深淵の一撃(アビスストライク)", description: "敵単体に闇属性の大ダメージを与え、防御力を低下させる。", type: "attack", atkType: "magical", element: "闇", spCost: 50, unlockLevel: 65, power: 64, statusEffect: { kind: "defDown", chance: 1, duration: 3, power: 3 } },
    { name: "ジェノサイド・レッド・バースト", description: "敵全体にすさまじいダメージを与え、大いなる闇状態にさせる。4ターンの間、ダメージが入りやすくなる。", type: "attack", atkType: "magical", element: "闇", target: "all", spCost: 51, unlockLevel: 70, power: 69, statusEffect: { kind: "great_darkness", chance: 1, duration: 4, power: 3 } },
    { name: "ホーリーサンクチュアリ", description: "味方全体のHPを大きく回復し、状態異常を全て解除する。", type: "heal", element: "光", spCost: 58, unlockLevel: 84, power: 90, gauge: "hp", cleanse: true, partyWide: true }
  ],

  // 性騎士
  "性騎士": [
    { name: "絶倫", description: "SPが2割を下回った時、自動的にSPが8割まで回復する（1戦闘につき3回まで）。", type: "passive", passiveId: "spAutoRecover", element: "性", spCost: 0, unlockLevel: 1 },
    { name: "フェロモン・オーバードライブ", description: "敵単体を見つめて魅了し、低確率で行動を封じる。", type: "attack", atkType: "magical", element: "性", spCost: 7, unlockLevel: 2, power: 8, statusEffect: { kind: "stun", chance: 0.25, duration: 1, power: 3 } },
    { name: "ハートブレイク・パンチ", description: "情熱を込めた拳を叩き込み、敵単体にダメージを与える。", type: "attack", atkType: "magical", element: "性", spCost: 4, unlockLevel: 4, power: 10 },
    { name: "情熱注入", description: "味方単体の士気を高め、一定ターンの間、攻撃力を上昇させる。", type: "buff", element: "性", spCost: 5, unlockLevel: 6, selfBuff: { kind: "atkUp", duration: 3, power: 10 } },
    { name: "チャームレーザー", description: "謎の魅惑光線を放ち、敵単体にダメージを与える。低確率で魅了を付与する。", type: "attack", atkType: "magical", element: "性", spCost: 5, unlockLevel: 7, power: 12, statusEffect: { kind: "confuse", chance: 0.2, duration: 2, power: 3 } },
    { name: "禁断のシュガートラップ", description: "敵単体を誘惑し、一定ターンの間、防御力を低下させる。", type: "attack", atkType: "magical", element: "性", spCost: 9, unlockLevel: 9, power: 14, statusEffect: { kind: "defDown", chance: 1, duration: 3, power: 3 } },
    { name: "快感シェアリング", description: "HPとSPを少量ずつ回復する。", type: "heal", element: "性", spCost: 8, unlockLevel: 13, power: 19, gauge: "hp", healBothGauges: true },
    { name: "幻惑ミラージュ", description: "妖艶な舞を披露し、敵全体の命中率を低下させる。", type: "attack", atkType: "magical", target: "all", element: "性", spCost: 12, unlockLevel: 17, power: 21, statusEffect: { kind: "accDown", chance: 1, duration: 2, power: 15 } },
    { name: "魅惑のハーレムフィールド", description: "敵全体を魅了し、一定確率で行動を封じる。", type: "attack", atkType: "magical", target: "all", element: "性", spCost: 17, unlockLevel: 19, power: 23, statusEffect: { kind: "stun", chance: 0.3, duration: 1, power: 3 } },
    { name: "絶頂なるクライマックス", description: "敵単体に大ダメージを与え、その反動で自身のSPを一部回復する。", type: "attack", atkType: "magical", element: "性", spCost: 18, unlockLevel: 24, power: 28 },
    { name: "大爆発射(スペルマティック・シンドローム)", description: "かなりのSPを消費する代わりに中程度のダメージを与え、行動不能+火傷を負わせる。", type: "attack", atkType: "magical", element: "性", spCost: 22, unlockLevel: 34, power: 37, statusEffect: { kind: "burn", chance: 1, duration: 3, power: 3 }, statusEffect2: { kind: "stun", chance: 1, duration: 3, power: 0 } },
    { name: "ラブエナジー献上", description: "自身のHPを消費し、その分を強化に還元する。", type: "buff", element: "性", spCost: 24, unlockLevel: 40, selfBuff: { kind: "atkUp", duration: 3, power: 14 }, selfDamageRatio: 0.08 },
    { name: "快楽のスパイラル", description: "敵単体に連続ダメージを与えるたびに、自身のHPがわずかに回復する。", type: "attack", atkType: "magical", element: "性", spCost: 29, unlockLevel: 54, power: 55, hitCount: 2 },
    { name: "背徳のドミネーション", description: "敵単体を支配下に置き、一定ターンの間、攻撃力と防御力を低下させる。", type: "attack", atkType: "magical", element: "性", spCost: 34, unlockLevel: 70, power: 69, statusEffect: { kind: "defDown", chance: 1, duration: 3, power: 3 }, statusEffect2: { kind: "atkDown", chance: 1, duration: 3, power: 3 } },
    { name: "元気モリモリ♡フルコース", description: "味方全体のHPとSPを大きく回復させる。", type: "heal", element: "性", spCost: 39, unlockLevel: 84, power: 90, gauge: "hp", healBothGauges: true }
  ],

  // お宝鑑定団
  "お宝鑑定団": [
    { name: "なんでも鑑定", description: "対象を鑑定し、アイテムの真のステータスや真価を見定める。戦闘中は敵の情報を表示する。", type: "special", id: "appraisal", element: "無", spCost: 0, unlockLevel: 1 },
    { name: "目利き", description: "対象のアイテムや敵の弱点を素早く見抜く。", type: "buff", element: "無", spCost: 0, unlockLevel: 2, selfBuff: { kind: "critUp", duration: 2, power: 15 } },
    { name: "闇討ち（やみうち）", description: "敵の不意を突いて斬りつけ、物理ダメージを与える。", type: "attack", atkType: "physical", element: "物理", spCost: 5, unlockLevel: 6, power: 11 },
    { name: "掘り出し物", description: "常時発動：戦闘終了後、敵がアイテムを落とす確率がわずかに上昇する。", type: "passive", passiveId: "lootBonus", element: "無", spCost: 0, unlockLevel: 9 },
    { name: "峰打ち（みねうち）", description: "得物の峰で打ち据え、敵単体に物理ダメージを与える。低確率でスタンを付与する。", type: "attack", atkType: "physical", element: "物理", spCost: 7, unlockLevel: 11, power: 16, statusEffect: { kind: "stun", chance: 0.25, duration: 1, power: 3 } },
    { name: "真贋看破（しんがんかんぱ）", description: "敵の使用する技を見切り、次に受けるダメージを軽減する。", type: "buff", element: "光", spCost: 11, unlockLevel: 13, selfBuff: { kind: "defUp", duration: 2, power: 25 } },
    { name: "算盤高き目利き（そろばんだかきめきき）", description: "常時発動：アイテムを売却する時の買取価格が上昇する。", type: "passive", passiveId: "sellBonus", element: "無", spCost: 0, unlockLevel: 17 },
    { name: "山猫の一閃（やまねこのいっせん）", description: "隙を突いた素早い一閃で、敵単体に物理ダメージを与える。", type: "attack", atkType: "physical", element: "物理", spCost: 13, unlockLevel: 19, power: 23 },
    { name: "百発百中の采配（ひゃっぱつひゃくちゅうのさいはい）", description: "敵全体の急所を解析し、味方全員の命中率とクリティカル率を上昇させる。", type: "buff", element: "無", spCost: 14, unlockLevel: 24, selfBuff: { kind: "critUp", duration: 3, power: 20 } },
    { name: "運否天賦の勘（うんぷてんぷのかん）", description: "常時発動：「調べる」で隠しアイテムを発見できる確率が上昇する。", type: "passive", passiveId: "exploreBonus", element: "無", spCost: 0, unlockLevel: 34 },
    { name: "眼光紙背の鑑定（がんこうしはいのかんてい）", description: "敵単体の全ステータスと弱点を完全に見抜き、一定ターンの間、その敵への与ダメージを上昇させる。", type: "attack", atkType: "magical", element: "光", spCost: 24, unlockLevel: 40, power: 42, statusEffect: { kind: "defDown", chance: 1, duration: 3, power: 3 } },
    { name: "舌先三寸（したさきさんずん）", description: "常時発動：魔物とのエンカウント率がわずかに下がる。", type: "passive", passiveId: "encounterAvoid", element: "無", spCost: 0, unlockLevel: 54 },
    { name: "千里眼", description: "戦闘中、敵の次の行動をあらかじめ察知できるようになる。", type: "buff", element: "無", spCost: 30, unlockLevel: 70, selfBuff: { kind: "critUp", duration: 5, power: 15 } },
    { name: "九死一生（きゅうしいっしょう）", description: "一定ターンの間、戦闘不能になるはずの一撃をHP1で耐える幸運を得る。", type: "buff", element: "無", spCost: 39, unlockLevel: 84, selfBuff: { kind: "surviveLethal", duration: 3, power: 0 } }
  ],

  // ニート
  "ニート": [
    { name: "後でやろう（ばかやろう）", description: "自身を「やる気なし状態」にする。一定ターン経過後、能力が大幅強化される「本気状態」になる。", type: "buff", element: "混沌", spCost: 0, unlockLevel: 1, selfBuff: { kind: "delayedPower", duration: 2, power: 0 } },
    { name: "二度寝", description: "少しだけHPを回復するが、次のターンの行動が遅れる。", type: "heal", element: "混沌", spCost: 0, unlockLevel: 2, power: 9, gauge: "hp" },
    { name: "八つ当たり", description: "苛立ちに任せて得物を振り回し、敵単体にダメージを与える。", type: "attack", atkType: "magical", element: "混沌", spCost: 4, unlockLevel: 4, power: 10 },
    { name: "無為徒食（むいとしょく）", description: "自身の防御力を下げる代わりに、敵の攻撃対象を自分に集中させる。", type: "buff", element: "混沌", spCost: 0, unlockLevel: 6, selfBuff: { kind: "defUp", duration: 2, power: -10 } },
    { name: "生半可な一撃（なまはんかないちげき）", description: "気の抜けた様子で得物を振るうが、思わぬ形で敵単体にダメージを与える。低確率で麻痺を付与する。", type: "attack", atkType: "magical", element: "混沌", spCost: 6, unlockLevel: 9, power: 14, statusEffect: { kind: "paralyze", chance: 0.2, duration: 1, power: 3 } },
    { name: "三十六計（さんじゅうろっけい）", description: "一定確率で敵の攻撃を回避しつつ、その場から距離を取る。", type: "buff", element: "混沌", spCost: 8, unlockLevel: 13, selfBuff: { kind: "defUp", duration: 2, power: 20 } },
    { name: "籠城の策（ろうじょうのさく）", description: "一定ターンの間、受けるダメージを大幅に軽減する代わりに反撃できなくなる。", type: "buff", element: "混沌", spCost: 12, unlockLevel: 17, selfBuff: { kind: "defUp", duration: 3, power: 50 } },
    { name: "捨て鉢", description: "やけくそになって暴れ回り、敵全体にダメージを与える。", type: "attack", atkType: "magical", target: "all", element: "混沌", spCost: 13, unlockLevel: 19, power: 23 },
    { name: "五里霧中", description: "敵単体のやる気を削ぎ、一定ターンの間、攻撃力を低下させる。", type: "attack", atkType: "magical", element: "混沌", spCost: 14, unlockLevel: 24, power: 28, statusEffect: { kind: "atkDown", chance: 1, duration: 3, power: 3 } },
    { name: "課金召喚", description: "回復・攻撃・状態異常のいずれかがランダムに発動する。", type: "attack", atkType: "magical", element: "混沌", spCost: 15, unlockLevel: 34, power: 37, randomEffect: true },
    { name: "惰眠からの覚醒", description: "長い眠りから覚め、一定ターンの間、全ステータスが大幅に上昇する。", type: "buff", element: "混沌", spCost: 24, unlockLevel: 40, selfBuff: { kind: "all_stats_up", duration: 4, power: 18 } },
    { id: "ichikabachika", name: "一か八か（いちかばちか）", description: "ランダムな敵単体に中〜大ダメージを与える、当たり外れの大きい一撃。", type: "attack", atkType: "magical", element: "混沌", spCost: 29, unlockLevel: 54, power: 55, randomTarget: true, wideVariance: true },
    { name: "混沌なるカオス", description: "世界に矛盾を発生させ、敵を混乱させる。", type: "attack", atkType: "magical", target: "all", element: "混沌", spCost: 29, unlockLevel: 65, power: 64, statusEffect: { kind: "confuse", chance: 0.8, duration: 3, power: 3 } },
    { name: "難攻不落（なんこうふらく）", description: "一定ターンの間、自身への被ダメージを完全に無効化する。", type: "buff", element: "混沌", spCost: 34, unlockLevel: 70, selfBuff: { kind: "immune", duration: 2, power: 0 } },
    { id: "hyouhen", name: "豹変", description: "低確率で全ステータスが極端に上昇する「本気モード」に突入する。", type: "buff", element: "混沌", spCost: 39, unlockLevel: 84, selfBuff: { kind: "all_stats_up", duration: 3, power: 35 }, triggerChance: 0.3 }
  ]
};

// ===== 仲間（コンパニオン）=====
// ★仲間の「マスターデータ」。シナリオビルドの「仲間編集」タブで追加・編集した内容が、
//   ensureCustomCompanionsRegistered()（scenariobuild.js）を通じてここに反映される。
//   { name, description, class, baseStats: {maxHp,maxSp,atk,agi,skillPower,luck,charm},
//     growthPerLevel: {同上}, initialWeaponId }
const COMPANION_MASTER = {};

// プレイヤー本体（初期化前は null）
let player = null;

/**
 * プレイヤーを指定した職業で初期化する
 * @param {string} className - CLASS_MASTER のキー
 */
// ★〈重要〉アップデートでステータス項目やゲージが増えても、古いセーブデータ（それらの項目を
//   持っていないもの）を読み込んだ時にエラーにならないよう、足りない項目をクラスの基本値で
//   補完する安全策。ロード処理（convenience.js）から必ずこれを通してからplayerに代入すること
function sanitizeLoadedPlayer(loadedPlayer) {
  if (!loadedPlayer || !loadedPlayer.class) return loadedPlayer;
  const cls = CLASS_MASTER[loadedPlayer.class];
  if (!cls) return loadedPlayer;
  
  if (!loadedPlayer.stats) loadedPlayer.stats = {};
  ["atk", "agi", "skillPower", "luck", "charm"].forEach((key) => {
    if (typeof loadedPlayer.stats[key] !== "number") {
      loadedPlayer.stats[key] = cls.baseStats[key] || 0;
    }
  });
  
  // ★要望対応：ロード時に「累計獲得経験値」と、それに応じたレベルが今の計算式と合っているかを確認し、
  //   ズレていればレベル・経験値・ステータスを補正する。
  //   ★バグ修正：以前は「今の残り経験値だけでもう1レベル上がれるか」しか見ておらず、
  //   必要経験値量を"増やした"場合（例：1.7倍化）に本来レベルが下がるべきケースを検出できず、
  //   古いセーブが高すぎるレベルのままロードされてしまっていた。
  //   累計獲得経験値（classTotalExp）を職業ごとに別途記録しておき、ロードのたびにそこから
  //   現在の計算式で正しいレベルを算出し直すことで、必要量がどちらの方向に変わっても正しく補正できる
  if (!loadedPlayer.classLevels || typeof loadedPlayer.classLevels !== "object") {
    loadedPlayer.classLevels = {};
  }
  // ★バグ修正：classLevelsは「職業を切り替えた瞬間」にしか同期されないため、ずっと同じ職業のまま
  //   プレイし続けていると、今アクティブな職業の欄だけ加入時の古い値（例：1）が残ったままになる。
  //   今の実際のレベルは常にloadedPlayer.levelの方が正しいので、移行計算の前に必ずこちらで上書きする。
  //   （これを見落としていたため、ずっと同じ職業で遊んでいたセーブほど「稼いだ経験値がほぼ無い」
  //   　扱いになり、レベルが大幅に下がりすぎるバグがあった）
  loadedPlayer.classLevels[loadedPlayer.class] = loadedPlayer.level;
  if (!loadedPlayer.classTotalExp || typeof loadedPlayer.classTotalExp !== "object") {
    // ★classTotalExpをまだ持たない古いセーブ：1.7倍化される前の計算式(legacyExpNeededForLevel)で
    //   稼いだであろう累計経験値を、記録されているレベルから逆算して補ってから移行する
    loadedPlayer.classTotalExp = {};
    Object.keys(loadedPlayer.classLevels).forEach((className) => {
      const lv = Math.max(1, Math.floor(loadedPlayer.classLevels[className]) || 1);
      const leftoverExp = (className === loadedPlayer.class) ? Math.max(0, Number(loadedPlayer.exp) || 0) : 0;
      loadedPlayer.classTotalExp[className] = calcTotalExpForLevel(lv, legacyExpNeededForLevel) + leftoverExp;
    });
  }
  if (!(loadedPlayer.class in loadedPlayer.classTotalExp)) {
    const lv = Math.max(1, Math.floor(loadedPlayer.level) || 1);
    loadedPlayer.classTotalExp[loadedPlayer.class] = calcTotalExpForLevel(lv, legacyExpNeededForLevel) + Math.max(0, Number(loadedPlayer.exp) || 0);
  }
  
  // ★記録している職業ごとの累計経験値から、今の計算式で正しいレベルへ補正する。
  //   今プレイ中でない職業は、classLevelsの記録だけ直しておけば、次にswitchPlayerClass()で
  //   切り替えた時に正しいレベルからステータスが組み直される
  Object.keys(loadedPlayer.classTotalExp).forEach((className) => {
    loadedPlayer.classLevels[className] = calcLevelFromTotalExp(loadedPlayer.classTotalExp[className], expNeededForLevel).level;
  });
  
  {
    const growth = cls.growthPerLevel || {};
    const { level, exp } = calcLevelFromTotalExp(loadedPlayer.classTotalExp[loadedPlayer.class], expNeededForLevel);
    const mismatch = (level !== loadedPlayer.level) || (Math.round(exp) !== Math.round(Number(loadedPlayer.exp) || 0));
    if (mismatch) {
      loadedPlayer.level = level;
      loadedPlayer.exp = exp;
      loadedPlayer.classLevels[loadedPlayer.class] = level;
      ["atk", "agi", "skillPower", "luck", "charm"].forEach((key) => {
        loadedPlayer.stats[key] = (cls.baseStats[key] || 0) + getCumulativeGrowth(growth, level, key);
      });
      // ★バグ修正：装備の「最大HP」ボーナスは基本値と別枠で直接gauges.hp.maxに乗っているため、
      //   ここで公式からmaxを作り直す時も、装備ボーナス分を消さずに乗せ直す
      const equippedHpBonus = getEquippedMaxHpBonusFor(loadedPlayer.equipment);
      if (loadedPlayer.gauges && loadedPlayer.gauges.hp) {
        const correctMaxHp = (cls.baseStats.maxHp || 0) + getCumulativeGrowth(growth, level, "maxHp") + equippedHpBonus;
        loadedPlayer.gauges.hp.max = correctMaxHp;
        loadedPlayer.gauges.hp.current = Math.min(loadedPlayer.gauges.hp.current, correctMaxHp);
      }
      if (loadedPlayer.gauges && loadedPlayer.gauges.sp) {
        const correctMaxSp = (cls.baseStats.maxSp || 0) + getCumulativeGrowth(growth, level, "maxSp");
        loadedPlayer.gauges.sp.max = correctMaxSp;
        loadedPlayer.gauges.sp.current = Math.min(loadedPlayer.gauges.sp.current, correctMaxSp);
      }
    }
  }
  
  if (!loadedPlayer.gauges) loadedPlayer.gauges = {};
  const gaugeMaxDefaults = {
    hp: cls.baseStats.maxHp,
    sp: cls.baseStats.maxSp,
    sleepiness: cls.maxSleepiness,
    fatigue: cls.maxFatigue
  };
  Object.keys(gaugeMaxDefaults).forEach((key) => {
    if (!loadedPlayer.gauges[key]) {
      loadedPlayer.gauges[key] = { current: gaugeMaxDefaults[key], max: gaugeMaxDefaults[key] };
    } else {
      if (typeof loadedPlayer.gauges[key].max !== "number") loadedPlayer.gauges[key].max = gaugeMaxDefaults[key];
      if (typeof loadedPlayer.gauges[key].current !== "number") loadedPlayer.gauges[key].current = loadedPlayer.gauges[key].max;
    }
  });
  
  if (typeof loadedPlayer.fame !== "number") loadedPlayer.fame = 0;
  if (typeof loadedPlayer.rank !== "string") loadedPlayer.rank = "F";
  if (!Array.isArray(loadedPlayer.clearedTrialRanks)) loadedPlayer.clearedTrialRanks = []; // ★ランクC以上への昇格試練のクリア記録
  if (!Array.isArray(loadedPlayer.notifiedTrialRanks)) loadedPlayer.notifiedTrialRanks = []; // ★「試練に挑めます」ポップアップを既に見せたランクの記録
  if (typeof loadedPlayer.daysSinceTransfer !== "number") loadedPlayer.daysSinceTransfer = 0;
  if (typeof loadedPlayer.progressPoints !== "number") loadedPlayer.progressPoints = 0;
  if (!loadedPlayer.equipment) loadedPlayer.equipment = { 武器: null, 胴: null, 盾: null };
  if (typeof loadedPlayer.magicalGirlTransformed !== "boolean") loadedPlayer.magicalGirlTransformed = false; // ★旧セーブ（属性変更システム時代）との互換用
  if (!Array.isArray(loadedPlayer.disabledPassives)) loadedPlayer.disabledPassives = [];
  if (!loadedPlayer.enemyKillCounts || typeof loadedPlayer.enemyKillCounts !== "object") loadedPlayer.enemyKillCounts = {};
  if (typeof loadedPlayer.totalKillCount !== "number") loadedPlayer.totalKillCount = 0;
  if (!loadedPlayer.areaVisitCounts || typeof loadedPlayer.areaVisitCounts !== "object") loadedPlayer.areaVisitCounts = {}; // ★旧セーブとの互換用
  if (!Array.isArray(loadedPlayer.completedQuestIds)) loadedPlayer.completedQuestIds = [];
  if (!Array.isArray(loadedPlayer.questsCompletedToday)) loadedPlayer.questsCompletedToday = []; // ★旧セーブとの互換用
  if (!loadedPlayer.statusAilments || typeof loadedPlayer.statusAilments !== "object") loadedPlayer.statusAilments = {};
  if (!Array.isArray(loadedPlayer.companions)) loadedPlayer.companions = [];
  if (!Array.isArray(loadedPlayer.benchedCompanions)) loadedPlayer.benchedCompanions = [];
  
  // ★要望対応：主人公と同様、仲間（パーティー内・一時離脱中の両方）も、ロード時に
  //   「累計獲得経験値」と、それに応じたレベルが今の計算式と合っているかを確認し、
  //   ズレていればレベル・経験値・ステータス・HP/SP上限を補正する。
  //   ★バグ修正：主人公と同じく「残り経験値だけでもう1レベル上がれるか」しか見ていなかったため、
  //   必要経験値量を増やした時にレベルが下がるべきケースを検出できていなかった。
  //   仲間ごとの累計獲得経験値（totalExp）を別途保持し、そこから毎回正しいレベルを算出し直す
  [...loadedPlayer.companions, ...loadedPlayer.benchedCompanions].forEach((companion) => {
    if (!companion || !companion.companionId) return;
    const master = COMPANION_MASTER[companion.companionId];
    if (!master) return; // ★シナリオ側で削除済みの仲間データなどは、そのまま何もしない
    if (typeof companion.exp !== "number") companion.exp = 0; // ★古いセーブデータ（exp導入前）にも対応する
    
    if (typeof companion.totalExp !== "number") {
      // ★totalExpをまだ持たない古いセーブ：1.7倍化される前の計算式で稼いだであろう累計経験値を、
      //   記録されているレベルから逆算して補ってから移行する
      const lv = Math.max(1, Math.floor(companion.level) || 1);
      companion.totalExp = calcTotalExpForLevel(lv, legacyExpNeededForLevel) + Math.max(0, Number(companion.exp) || 0);
    }
    
    const { level, exp } = calcLevelFromTotalExp(companion.totalExp, expNeededForLevel);
    const mismatch = (level !== companion.level) || (Math.round(exp) !== Math.round(Number(companion.exp) || 0));
    if (!mismatch) return;
    
    companion.level = level;
    companion.exp = exp;
    const correctStats = getCompanionStatsAtLevel(master, level);
    // ★バグ修正：装備の「最大HP」ボーナスは基本値と別枠で直接gauges.hp.maxに乗っているため、
    //   ここで公式からmaxを作り直す時も、装備ボーナス分を消さずに乗せ直す
    const equippedHpBonus = getEquippedMaxHpBonusFor(companion.equipment);
    if (companion.gauges && companion.gauges.hp) {
      companion.gauges.hp.max = correctStats.maxHp + equippedHpBonus;
      companion.gauges.hp.current = Math.min(companion.gauges.hp.current, companion.gauges.hp.max);
    }
    if (companion.gauges && companion.gauges.sp) {
      companion.gauges.sp.max = correctStats.maxSp;
      companion.gauges.sp.current = Math.min(companion.gauges.sp.current, correctStats.maxSp);
    }
  });
  if (!loadedPlayer.baseClass) loadedPlayer.baseClass = loadedPlayer.class; // ★旧セーブとの互換用（基本職の記録が無ければ今の職業を基本職とみなす）
  // ★要望対応：古いセーブデータ（lastVisitedBaseKey導入前）には、今の現在地（拠点にいるはず）から補う。
  //   拠点以外（施設の中など）にいた場合は、無理に推測せず村を既定値にしておく
  if (!loadedPlayer.lastVisitedBaseKey) {
    const currentKey = typeof currentLocationKey !== "undefined" ? currentLocationKey : "";
    loadedPlayer.lastVisitedBaseKey = (currentKey === "town" || currentKey.startsWith("settlement_")) ? currentKey : "town";
  }
  if (loadedPlayer.poisoned && !loadedPlayer.statusAilments.poison) {
    loadedPlayer.statusAilments.poison = { turns: 3, power: 0 }; // ★旧セーブ（毒だけのboolean管理だった頃）からの引き継ぎ
  }
  delete loadedPlayer.poisoned;
  delete loadedPlayer.magicalElement; // ★旧セーブに残っている場合があるので、使われなくなったフィールドは掃除しておく
  
  return loadedPlayer;
}

// ★古いセーブデータ（instanceId導入前、player.equipmentにitemIdの文字列を直接入れていた形式）を
//   読み込んだ時のため：inventorySlotsから一致する実体を探して、instanceId参照に変換する。
//   convenience.jsのrestoreGameFromSaveDataで、inventorySlotsを読み込んだ直後に呼ぶこと
function migrateLegacyEquipmentReferences() {
  if (!player || !player.equipment) return;
  Object.keys(player.equipment).forEach(slotKey => {
    const value = player.equipment[slotKey];
    if (typeof value !== "string") return; // ★既にinstanceId（数値）ならそのままでよい
    const match = inventorySlots.find(s => s && s.itemId === value);
    player.equipment[slotKey] = match ? match.instanceId : null;
  });
}

function initPlayer(className) {
  const cls = CLASS_MASTER[className];
  if (!cls) {
    console.error(`職業「${className}」が CLASS_MASTER に存在しません`);
    return;
  }
  
  player = {
    class: className,
    baseClass: className, // ★神様に最初に選ばされた「基本職」。役場/役所での職業変更で戻れる先
    level: 1,
    exp: 0,
    classLevels: { [className]: 1 }, // ★職業ごとのレベルの記録。役場/役所で職業を変えても、前になったことがある職業ならそのレベルから再開できる
    classTotalExp: { [className]: 0 }, // ★職業ごとの累計獲得経験値（ロード時のレベル再計算に使う。要望対応）
    lastVisitedBaseKey: "town", // ★要望対応：敗北時に「直前に立ち寄った拠点」へ戻すための記録
    daysSinceTransfer: 0, // 転移してからの経過日数
    gameHour: 8, // ★現在時刻（0〜23時）。転移した日の朝8時からスタート
    fame: 0, // ★隠しステータス「名声度」。クエストをクリアすると増え、一定量たまるとランクが上がる
    rank: "F", // 冒険者ランク（クエスト受注の条件に使う想定）
    clearedTrialRanks: [], // ★ランクC以上への昇格試練のクリア記録（questboard.js参照）
    notifiedTrialRanks: [], // ★「試練に挑めます」ポップアップを既に見せたランクの記録（questboard.js参照。同じランクで何度も出さないため）
    // ★第2話の解放条件に使う「進行度」。クエスト達成・ランクアップ・魔物討伐で増える
    progressPoints: 0,
    nickname: null, // 二つ名（冒険者登録時に他人からつけてもらう）
    
    // 魔法少女(おっさん)だけが使う、「マジカル変身」中かどうか（変身中のみ魔法を使える）
    magicalGirlTransformed: false,
    // ★常時発動スキルのうち、プレイヤーが手動でOFFにしているもののpassiveId一覧（お宝鑑定団用）
    disabledPassives: [],
    // ★マップのエリア解放条件（「指定した敵をn体倒した」「全ての敵をn体倒した」）の判定用の記録
    enemyKillCounts: {}, // { モンスターキー: 討伐数 }
    totalKillCount: 0,
    // ★話の始まるきっかけ（「エリアに来た時」）やシナリオ専用エリアのn回目判定に使う、拠点ごとの来訪回数
    areaVisitCounts: {}, // { locationKey: 来訪回数 }
    // ★マップのエリア解放条件（「特定のクエストをクリアした」）の判定用の記録
    completedQuestIds: [],
    questsCompletedToday: [], // ★その日のうちに達成した依頼のID（日付が変わるとresetDailyQuestBoardでリセットされる）
    // ★プレイヤーが受けている状態異常。毒・スタン・麻痺・混乱・火傷・攻撃力低下・防御力低下・命中率低下に対応
    statusAilments: {},
    // ★冒険をともにする仲間の一覧。[{ companionId, level, gauges:{hp,sp}, equipment:{武器,胴,盾}, alive }, ...]
    companions: [],
    benchedCompanions: [], // ★「仲間離脱」ブロックで一時的にパーティーから外れている仲間（形は上のcompanionsと同じ）
    
    gauges: {
      hp: { current: cls.baseStats.maxHp, max: cls.baseStats.maxHp },
      sp: { current: cls.baseStats.maxSp, max: cls.baseStats.maxSp },
      // 眠気・疲労度は「たまっていく」ゲージ（0=万全、maxに近いほど限界）想定
      sleepiness: { current: 0, max: cls.maxSleepiness },
      fatigue: { current: 0, max: cls.maxFatigue }
    },
    
    stats: {
      atk: cls.baseStats.atk,
      agi: cls.baseStats.agi,
      skillPower: cls.baseStats.skillPower,
      luck: cls.baseStats.luck,
      charm: cls.baseStats.charm
    },
    
    // 装備欄（"武器" "胴" "盾" の3部位。値はITEM_MASTERのアイテムID、未装備はnull）
    equipment: {
      "武器": null,
      "胴": null,
      "盾": null
    }
  };
}

/**
 * 装備欄（equipmentObj[slotKey]）に入っているinstanceIdから、
 * 実際のインベントリのマス（itemId・statBonusなどを持つ）を探して返す。
 * ★装備は「どのアイテムIDか」ではなく「どの1個の実体か」で管理しているので、
 *   このinstanceId→実体の解決は、装備関連の処理のあちこちで共通して必要になる
 * @param {object} equipmentObj - player.equipment、または仲間のequipment
 * @returns {{itemId: string, master: object, slot: object} | null}
 */
// ★アイテムの「今の本当の姿」を、そのインベントリの実体（slot）とマスターデータ（ITEM_MASTER）から合成して返す。
//   錆取り屋でのサビ取り結果など、個体ごとの上書き（slot.instanceOverrides）はここで重ねる。
//   ★以前はサビ取りの結果をITEM_MASTER側（全個体で共有）に直接書き込んでいたため、
//     同じアイテムIDを複数持っていると全部まとめて変わってしまい、かつ表示名も変わらないので
//     「サビ取りしてもらったのに何も変わっていないように見える」不具合の原因になっていた
function getEffectiveItemMaster(slot) {
  if (!slot) return null;
  const master = (typeof ITEM_MASTER !== "undefined") ? ITEM_MASTER[slot.itemId] : null;
  if (!master) return null;
  if (!slot.instanceOverrides) return master;
  const ov = slot.instanceOverrides;
  return {
    ...master,
    name: ov.name || master.name,
    rank: ov.rank || master.rank,
    params: ov.params ? { ...master.params, ...ov.params } : master.params
  };
}

function getEquippedItemDataFor(equipmentObj, slotKey) {
  if (!equipmentObj) return null;
  const instanceId = equipmentObj[slotKey];
  if (!instanceId) return null;
  const slot = (typeof inventorySlots !== "undefined") ? inventorySlots.find(s => s && s.instanceId === instanceId) : null;
  if (!slot) return null;
  const master = getEffectiveItemMaster(slot);
  if (!master) return null;
  return { itemId: slot.itemId, master, slot };
}

// ★主人公の装備を見る、今まで通りの呼び方（後方互換用の薄いラッパー）
function getEquippedItemData(slotKey) {
  return getEquippedItemDataFor(player ? player.equipment : null, slotKey);
}

/**
 * 装備1個ぶんの、指定パラメータ（攻撃力・最大HPなど）の実効値を返す。
 * 基本ステータス（master.params）に、その個体だけのランダム変位（slot.statBonus）を上乗せする
 */
function getEquippedEffectiveParamFor(equipmentObj, slotKey, paramKey) {
  const data = getEquippedItemDataFor(equipmentObj, slotKey);
  if (!data) return 0;
  if (data.master.params[paramKey] === undefined) return 0; // ★この装備がそもそも持っていないステータスは0のまま（フロアをかけない）
  let value = data.master.params[paramKey];
  if (data.slot.statBonus && data.slot.statBonus.statKey === paramKey) {
    value += data.slot.statBonus.amount;
  }
  // ★拾った時のランダムな個体差（statBonus）で実効ステータスが0以下（実質マイナス）にならないよう、最低1を保証する
  return Math.max(1, value);
}

function getEquippedEffectiveParam(slotKey, paramKey) {
  return getEquippedEffectiveParamFor(player ? player.equipment : null, slotKey, paramKey);
}

// ★装備一式（武器・胴・盾）ぶんの「最大HP」上乗せ合計。equipItem/unequipItemで直接gauges.hp.maxに
//   足し引きしているぶんを、ロード時の再計算などで消さずに保持し直すために使う
function getEquippedMaxHpBonusFor(equipmentObj) {
  if (!equipmentObj) return 0;
  return Object.keys(equipmentObj).reduce((sum, slotKey) => sum + getEquippedEffectiveParamFor(equipmentObj, slotKey, "最大HP"), 0);
}

/**
 * 現在装備している武器による、攻撃力の上乗せ分を計算する
 * ★防具の「最大HP」ボーナスは装備/解除のタイミングで直接 gauges.hp.max に
 *   反映しているので、ここでは扱わない（equipItem/unequipItem参照）
 * @returns {{atk: number}}
 */
function getEquipmentBonusFor(equipmentObj) {
  const bonus = { atk: 0, skillPower: 0, hpRegen: 0, spRegen: 0 };
  if (!equipmentObj) return bonus;
  for (const slotKey of Object.keys(equipmentObj)) {
    bonus.atk += getEquippedEffectiveParamFor(equipmentObj, slotKey, "攻撃力");
    bonus.skillPower += getEquippedEffectiveParamFor(equipmentObj, slotKey, "魔力"); // ★武器・防具の「魔力」パラメータぶん、魔法攻撃力(skillPower)が上がる
    bonus.hpRegen += getEquippedEffectiveParamFor(equipmentObj, slotKey, "HP自動回復"); // ★毎ターン、この分だけHPが自動回復する
    bonus.spRegen += getEquippedEffectiveParamFor(equipmentObj, slotKey, "SP自動回復"); // ★毎ターン、この分だけSPが自動回復する
  }
  return bonus;
}

function getEquipmentBonus() {
  return getEquipmentBonusFor(player ? player.equipment : null);
}

// ★疲労度が上限の7割を超えている「疲弊状態」かどうか
const FATIGUE_EXHAUSTED_RATIO = 0.7;
function isPlayerExhausted() {
  if (typeof battleState !== "undefined" && battleState && battleState.playerFatigueImmuneTurns > 0) return false; // ★「疲労・眠気の影響を受けない」バフが有効な間は、疲弊状態そのものを無視する
  if (!player) return false;
  const fatigue = player.gauges.fatigue;
  if (!fatigue || fatigue.max <= 0) return false;
  return fatigue.current / fatigue.max >= FATIGUE_EXHAUSTED_RATIO;
}

/**
 * 装備品の上乗せ込みの、実際に戦闘で使うステータスを返す
 * ★防御力システムは廃止した（防具の効果は最大HPに統合済み）
 * @returns {{atk:number, agi:number, skillPower:number, luck:number, charm:number}}
 */
function getEffectiveStats() {
  if (!player) return { atk: 0, agi: 0, skillPower: 0, luck: 0, charm: 0 };
  const bonus = getEquipmentBonus();
  let atk = player.stats.atk + bonus.atk; // ★物理攻撃力
  let skillPower = player.stats.skillPower + bonus.skillPower; // ★魔法攻撃力（武器・防具の「魔力」ぶんも上乗せ）
  
  // ★疲労度7割超え（疲弊状態）だと、物理・魔法どちらの攻撃力も少し下がる
  if (isPlayerExhausted()) {
    atk = Math.max(1, Math.round(atk * 0.85));
    skillPower = Math.max(1, Math.round(skillPower * 0.85));
  }
  
  // ★状態異常「攻撃力低下」を受けている間は、その分さらに下がる（物理・魔法どちらも）
  const atkDown = player.statusAilments && player.statusAilments.atkDown;
  if (atkDown && atkDown.turns > 0) {
    atk = Math.max(1, atk - (atkDown.power || 0));
    skillPower = Math.max(1, skillPower - (atkDown.power || 0));
  }
  
  return {
    atk: atk,
    agi: player.stats.agi,
    skillPower: skillPower,
    luck: player.stats.luck,
    charm: player.stats.charm
  };
}

/**
 * アイテムを装備する。同じアイテムIDでも1個1個ステータスが違いうるため、
 * 「どのアイテムIDか」ではなく「インベントリのどの実体（instanceId）か」を指定して装備する。
 * @param {number} instanceId - 装備したいインベントリのマスのinstanceId
 * @returns {{success: boolean, message: string}}
 */
function equipItem(instanceId) {
  if (!player) return { success: false, message: "プレイヤー情報が無い。" };
  const targetSlot = (typeof inventorySlots !== "undefined") ? inventorySlots.find(s => s && s.instanceId === instanceId) : null;
  if (!targetSlot) return { success: false, message: "そのアイテムはもう持っていないようだ。" };
  
  const itemId = targetSlot.itemId;
  const itemData = (typeof ITEM_MASTER !== "undefined") ? ITEM_MASTER[itemId] : null;
  if (!itemData || !itemData.params || !itemData.params.装備部位) {
    return { success: false, message: "これは装備できるアイテムではないようだ。" };
  }
  
  const slot = itemData.params.装備部位;
  if (!(slot in player.equipment)) {
    return { success: false, message: "対応する装備枠が無いようだ。" };
  }
  
  // ★同じ実体（instanceId）の装備は、主人公と仲間で同時に着けられないようにする
  //   （今まではinventorySlotsに残っているかしか見ていなかったため、仲間が装備中の物を主人公も
  //   同時に装備できてしまっていた。逆に主人公が装備中の物を仲間にも装備できてしまうのも同じ原因）
  if (player.equipment[slot] !== instanceId && isInstanceEquippedByAnyone(instanceId)) {
    return { success: false, message: `そのアイテムは既に${describeInstanceHolderName(instanceId) || "誰か"}が装備しているようだ。` };
  }
  
  // ★「性剣エクスカリバー」のように、特定の職業でないと装備できないアイテムがある
  if (itemData.restrictedClass && player.class !== itemData.restrictedClass) {
    return { success: false, message: `「${itemData.name}」は、${itemData.restrictedClass}でなければ装備できないようだ。` };
  }
  
  // ★職業ごとに「装備できる武器の種類」が決められていることがある（例：狂戦士は斧・剣のみ）。
  //   武器種類が設定されていないアイテムや、制限リストが空（未設定＝無制限）の職業には影響しない
  if (slot === "武器" && itemData.params.武器種類) {
    const classData = (typeof CLASS_MASTER !== "undefined") ? CLASS_MASTER[player.class] : null;
    const allowed = classData && Array.isArray(classData.allowedWeaponTypes) ? classData.allowedWeaponTypes : [];
    if (allowed.length > 0 && !allowed.includes(itemData.params.武器種類)) {
      return { success: false, message: `「${itemData.name}」（${itemData.params.武器種類}）は、${player.class}では装備できないようだ。` };
    }
  }
  
  // ★もし同じ部位に既に何か装備していたら、まず先にそちらの最大HPボーナス（個体差込み）を外しておく
  const previousHpBonus = getEquippedEffectiveParam(slot, "最大HP");
  if (previousHpBonus) {
    player.gauges.hp.max = Math.max(1, player.gauges.hp.max - previousHpBonus);
    player.gauges.hp.current = Math.min(player.gauges.hp.current, player.gauges.hp.max);
  }
  
  player.equipment[slot] = instanceId;
  
  // ★防具の「最大HP」ボーナス（この個体だけのランダム変位込み）を装備時に直接反映する
  const hpBonus = getEquippedEffectiveParam(slot, "最大HP");
  if (hpBonus) {
    player.gauges.hp.max += hpBonus;
    player.gauges.hp.current += hpBonus; // ★装備した瞬間、増えた分だけ現在値も増える
  }
  
  return { success: true, message: `「${itemData.name}」を${slot}に装備した。` };
}

/**
 * 指定した部位の装備を外す
 * @param {string} slot - "武器" | "胴" | "盾"
 * @returns {{success: boolean, message: string}}
 */
function unequipItem(slot) {
  if (!player) return { success: false, message: "プレイヤー情報が無い。" };
  if (!player.equipment[slot]) return { success: false, message: "もともと何も装備していない。" };
  
  const data = getEquippedItemData(slot);
  
  // ★防具の「最大HP」ボーナス（個体差込み）を外した分、最大HPも元に戻す
  const hpBonus = getEquippedEffectiveParam(slot, "最大HP");
  if (hpBonus) {
    player.gauges.hp.max = Math.max(1, player.gauges.hp.max - hpBonus);
    player.gauges.hp.current = Math.min(player.gauges.hp.current, player.gauges.hp.max);
  }
  
  player.equipment[slot] = null;
  return { success: true, message: `「${data ? data.master.name : "装備"}」を外した。` };
}

// ===== 仲間（コンパニオン）関連 =====

// ★仲間のマスターデータ（名前・職業・初期ステータス・成長値など）を返す
function getCompanionMaster(companion) {
  return companion ? COMPANION_MASTER[companion.companionId] : null;
}

/**
 * 仲間をパーティーに加える（シナリオの「仲間追加」ブロックから呼ぶ）。
 * ★以前「仲間離脱」ブロックで一時的に外れていた仲間なら、その時のレベル・装備・HP/SPのまま復帰する。
 *   一度も加入したことが無い仲間なら、指定したレベルで新規に加入する
 * @param {string} companionId - COMPANION_MASTER のキー
 * @param {number} level - （新規加入の場合のみ使う）加入時のレベル
 */
function addCompanionToParty(companionId, level) {
  if (!player) return null;
  const master = COMPANION_MASTER[companionId];
  if (!master) return null;
  if (player.companions.some(c => c.companionId === companionId)) return null; // ★同じ仲間を二重に加えない
  
  // ★一時離脱していた仲間なら、その時のレベル・装備・HP/SPのまま呼び戻す
  if (!player.benchedCompanions) player.benchedCompanions = [];
  const benchedIndex = player.benchedCompanions.findIndex(c => c.companionId === companionId);
  if (benchedIndex >= 0) {
    const [returning] = player.benchedCompanions.splice(benchedIndex, 1);
    player.companions.push(returning);
    return returning;
  }
  
  const lv = Math.max(1, level || 1);
  const stats = getCompanionStatsAtLevel(master, lv);
  const companion = {
    companionId,
    level: lv,
    exp: 0, // ★仲間の経験値（メインタブの経験値ゲージ表示・成長に使う。要望対応）
    totalExp: calcTotalExpForLevel(lv, expNeededForLevel), // ★累計獲得経験値（ロード時のレベル再計算に使う。要望対応）
    gauges: { hp: { current: stats.maxHp, max: stats.maxHp }, sp: { current: stats.maxSp, max: stats.maxSp } },
    equipment: { 武器: null, 胴: null, 盾: null },
    alive: true
  };
  player.companions.push(companion);
  
  // ★要望対応：初期武器・防具・盾が指定されていれば、それぞれインベントリに1つ加えたうえでそのまま装備させておく
  [["initialWeaponId", "武器"], ["initialArmorId", "胴"], ["initialShieldId", "盾"]].forEach(([field, slot]) => {
    const itemId = master[field];
    if (!itemId || typeof addItem !== "function") return;
    addItem(itemId, 1);
    const newSlot = (typeof inventorySlots !== "undefined")
      ? [...inventorySlots].reverse().find(s => s && s.itemId === itemId && !isInstanceEquippedByAnyone(s.instanceId))
      : null;
    if (newSlot) equipItemForCompanion(companion, newSlot.instanceId);
  });
  
  return companion;
}

// ★そのインベントリの実体（instanceId）が、主人公または誰か仲間に、もう装備されていないか確認する
function isInstanceEquippedByAnyone(instanceId) {
  if (!player) return false;
  if (Object.values(player.equipment).includes(instanceId)) return true;
  return player.companions.some(c => Object.values(c.equipment).includes(instanceId))
    || (player.benchedCompanions || []).some(c => Object.values(c.equipment).includes(instanceId));
}

// ★その実体（instanceId）を今、誰が装備しているかの表示名（自分／仲間名）。誰も装備していなければnull
function describeInstanceHolderName(instanceId) {
  if (!player) return null;
  if (Object.values(player.equipment).includes(instanceId)) return "自分";
  const wearer = player.companions.find(c => Object.values(c.equipment).includes(instanceId))
    || (player.benchedCompanions || []).find(c => Object.values(c.equipment).includes(instanceId));
  return wearer ? getCompanionDisplayName(wearer) : null;
}

/**
 * 仲間を一時的にパーティーから外す（シナリオの「仲間離脱」ブロックから呼ぶ）。
 * レベル・装備・HP/SPはそのまま保持され、「仲間追加」ブロックで同じ仲間をまた加えれば、
 * その状態のまま復帰する
 * @param {string} companionId
 * @returns {boolean} 実際に外れたらtrue（もともとパーティーにいなければfalse）
 */
function benchCompanion(companionId) {
  if (!player || !player.companions) return false;
  const index = player.companions.findIndex(c => c.companionId === companionId);
  if (index < 0) return false;
  const [leaving] = player.companions.splice(index, 1);
  if (!player.benchedCompanions) player.benchedCompanions = [];
  player.benchedCompanions.push(leaving);
  return true;
}

// ★基本ステータス＋(レベル-1)ぶんの成長値から、指定レベル時点のステータスを計算する
function getCompanionStatsAtLevel(master, level) {
  const base = master.baseStats || {};
  const growth = master.growthPerLevel || {};
  const keys = ["maxHp", "maxSp", "atk", "agi", "skillPower", "luck", "charm"];
  const stats = {};
  keys.forEach(key => {
    stats[key] = Math.round((base[key] || 0) + (growth[key] || 0) * (level - 1));
  });
  return stats;
}

/**
 * 仲間の、装備込みの実効ステータスを返す
 * @returns {{atk:number, agi:number, skillPower:number, luck:number, charm:number, maxHp:number, maxSp:number}}
 */
function getCompanionEffectiveStats(companion) {
  const master = getCompanionMaster(companion);
  if (!master) return { atk: 0, agi: 0, skillPower: 0, luck: 0, charm: 0, maxHp: 1, maxSp: 0 };
  const base = getCompanionStatsAtLevel(master, companion.level);
  const bonus = getEquipmentBonusFor(companion.equipment);
  return {
    atk: base.atk + bonus.atk,
    agi: base.agi, skillPower: base.skillPower, luck: base.luck, charm: base.charm,
    maxHp: base.maxHp, maxSp: base.maxSp
  };
}

// ★仲間の職業（COMPANION_MASTER.class）のスキルのうち、今のレベルで使えるものだけを返す
function getCompanionSkills(companion) {
  const master = getCompanionMaster(companion);
  if (!master || typeof CLASS_SKILLS === "undefined") return [];
  const skills = CLASS_SKILLS[master.class] || [];
  return skills.filter(s => companion.level >= s.unlockLevel);
}

// ★仲間に装備させる（主人公のequipItem()と同じロジックだが、対象がcompanion.equipmentになる）
function equipItemForCompanion(companion, instanceId) {
  if (!companion) return { success: false, message: "仲間が見つからない。" };
  const targetSlot = (typeof inventorySlots !== "undefined") ? inventorySlots.find(s => s && s.instanceId === instanceId) : null;
  if (!targetSlot) return { success: false, message: "そのアイテムはもう持っていないようだ。" };
  
  const itemId = targetSlot.itemId;
  const itemData = (typeof ITEM_MASTER !== "undefined") ? ITEM_MASTER[itemId] : null;
  if (!itemData || !itemData.params || !itemData.params.装備部位) {
    return { success: false, message: "これは装備できるアイテムではないようだ。" };
  }
  
  const slot = itemData.params.装備部位;
  if (!(slot in companion.equipment)) return { success: false, message: "対応する装備枠が無いようだ。" };
  
  // ★主人公または他の仲間が同じ実体（instanceId）を既に装備していないか確認する（player.jsのequipItem()と同様）
  if (companion.equipment[slot] !== instanceId && isInstanceEquippedByAnyone(instanceId)) {
    return { success: false, message: `そのアイテムは既に${describeInstanceHolderName(instanceId) || "誰か"}が装備しているようだ。` };
  }
  
  const master = getCompanionMaster(companion);
  if (itemData.restrictedClass && master && master.class !== itemData.restrictedClass) {
    return { success: false, message: `「${itemData.name}」は、${itemData.restrictedClass}でなければ装備できないようだ。` };
  }
  
  // ★仲間ごとに「装備できる武器の種類」が決められていることがある（仲間編集タブで設定）
  if (slot === "武器" && itemData.params.武器種類 && master && Array.isArray(master.allowedWeaponTypes) && master.allowedWeaponTypes.length > 0) {
    if (!master.allowedWeaponTypes.includes(itemData.params.武器種類)) {
      return { success: false, message: `「${itemData.name}」（${itemData.params.武器種類}）は、${getCompanionDisplayName(companion)}では装備できないようだ。` };
    }
  }
  
  const previousHpBonus = getEquippedEffectiveParamFor(companion.equipment, slot, "最大HP");
  if (previousHpBonus) {
    companion.gauges.hp.max = Math.max(1, companion.gauges.hp.max - previousHpBonus);
    companion.gauges.hp.current = Math.min(companion.gauges.hp.current, companion.gauges.hp.max);
  }
  
  companion.equipment[slot] = instanceId;
  
  const hpBonus = getEquippedEffectiveParamFor(companion.equipment, slot, "最大HP");
  if (hpBonus) {
    companion.gauges.hp.max += hpBonus;
    companion.gauges.hp.current += hpBonus;
  }
  
  return { success: true, message: `「${itemData.name}」を${slot}に装備した。` };
}

// ★仲間の装備を外す（主人公のunequipItem()と同じロジック）
function unequipItemForCompanion(companion, slot) {
  if (!companion) return { success: false, message: "仲間が見つからない。" };
  if (!companion.equipment[slot]) return { success: false, message: "もともと何も装備していない。" };
  
  const data = getEquippedItemDataFor(companion.equipment, slot);
  const hpBonus = getEquippedEffectiveParamFor(companion.equipment, slot, "最大HP");
  if (hpBonus) {
    companion.gauges.hp.max = Math.max(1, companion.gauges.hp.max - hpBonus);
    companion.gauges.hp.current = Math.min(companion.gauges.hp.current, companion.gauges.hp.max);
  }
  
  companion.equipment[slot] = null;
  return { success: true, message: `「${data ? data.master.name : "装備"}」を外した。` };
}

/**
 * ゲージを増減させる（0〜maxの範囲でクランプする）
 * @param {string} gaugeName - "hp" | "sp" | "sleepiness" | "fatigue"
 * @param {number} amount - 正で加算、負で減算
 */
function changeGauge(gaugeName, amount) {
  if (!player || !player.gauges[gaugeName]) return;
  const gauge = player.gauges[gaugeName];
  gauge.current = Math.max(0, Math.min(gauge.max, gauge.current + amount));
}

/**
 * 眠気の自然蓄積：行動するたびに眠気がたまっていく。
 * ★以前はここで引数を無視して常に固定+4を加算していたため、行動ごとに眠気の増え方を
 *   変えたくても（例：「進む」だけ増加量を変える）一切反映されない不具合があった。
 *   実際に渡された増加量をそのまま使うようにする
 * @param {number} amount - 今回の行動で溜まる眠気の量
 */
function accumulateSleepiness(amount) {
  if (!player || !player.gauges.sleepiness) return;
  changeGauge("sleepiness", amount);
}

/**
 * 眠気による「居眠り」判定：眠気が7割を超えていると、たまに行動そのものに失敗するようになる。
 * 発生確率は7割で0%、満タン(10割)で50%になるよう線形に上がっていく（眠気が高いほど眠りやすい）。
 * @returns {boolean} trueなら今回は居眠りしてしまって動けない
 */
function checkFallAsleep() {
  if (typeof battleState !== "undefined" && battleState && battleState.playerFatigueImmuneTurns > 0) return false; // ★「疲労・眠気の影響を受けない」バフが有効な間は居眠りしない
  if (!player || !player.gauges.sleepiness) return false;
  const gauge = player.gauges.sleepiness;
  const ratio = gauge.current / gauge.max;
  if (ratio <= 0.7) return false;
  const chance = ((ratio - 0.7) / 0.3) * 0.5;
  return Math.random() < chance;
}

/**
 * 「何か行動する」たびに呼ぶ、疲労度加算の共通処理。
 * ★疲労度が7割を超えている（疲弊状態の）時は、行動するたびにHPも少し削られる
 *   （攻撃力ダウンは getEffectiveStats() 側で自動的に反映される）
 * @param {number} fatigueAmount - 今回の行動で溜まる疲労度
 * @param {number} [sleepinessAmount=4] - 今回の行動で溜まる眠気（省略時は従来通り+4。「進む」だけ増加量を変える、等に使う）
 * @returns {{hpDrained: number}} 疲弊状態でHPが削られた量（0なら削られていない）
 */
function applyActionFatigue(fatigueAmount, sleepinessAmount) {
  if (!player) return { hpDrained: 0 };
  changeGauge("fatigue", fatigueAmount);
  accumulateSleepiness(sleepinessAmount != null ? sleepinessAmount : 4); // ★行動するたびに眠気も少しずつたまっていく
  
  if (!isPlayerExhausted()) return { hpDrained: 0 };
  
  const hpDrain = Math.max(1, Math.round(player.gauges.hp.max * 0.04)); // 最大HPの約4%
  changeGauge("hp", -hpDrain);
  return { hpDrained: hpDrain };
}

/**
 * 状態異常（毒・火傷など、行動のたびにHPが削れるもの）があれば、その分だけHPを減らす。
 * また、スタン・麻痺・混乱の残りターンもここで一緒に数えて減らす
 * @returns {{damage: number}} 削れたHP（無ければ0）
 */
function applyPoisonTick() {
  if (!player || !player.statusAilments) return { damage: 0 };
  let damage = 0;
  Object.keys(player.statusAilments).forEach(kind => {
    const ailment = player.statusAilments[kind];
    if (!ailment || ailment.turns <= 0) return;
    if (kind === "poison" || kind === "burn" || kind === "dullPain") {
      const tickDamage = Math.max(1, Math.round(player.gauges.hp.max * 0.05)); // 最大HPの約5%
      changeGauge("hp", -tickDamage);
      damage += tickDamage;
    }
    ailment.turns--;
    if (ailment.turns <= 0) delete player.statusAilments[kind];
  });
  return { damage };
}

// ★プレイヤーが今、指定した状態異常にかかっているか
function hasPlayerStatusAilment(kind) {
  return !!(player && player.statusAilments && player.statusAilments[kind] && player.statusAilments[kind].turns > 0);
}

// ★敵の攻撃などで、プレイヤーに状態異常を付与する（battle.jsから呼ぶ）
function applyPlayerStatusAilment(kind, duration, power) {
  if (!player) return;
  if (!player.statusAilments) player.statusAilments = {};
  player.statusAilments[kind] = { turns: duration || 1, power: power || 0 };
}

// ★スタン・麻痺・混乱のいずれかにかかっていて、この行動をふいにしてしまうかどうか
function checkPlayerStatusPreventsAction() {
  if (!player || !player.statusAilments) return null;
  if (hasPlayerStatusAilment("stun")) return "stun";
  if (hasPlayerStatusAilment("paralyze")) return "paralyze";
  if (hasPlayerStatusAilment("confuse")) return "confuse";
  return null;
}

// ★状態異常を治す。kindを指定すればそれだけ、"all"を渡せば全ての状態異常を一度に治す
//   （params.解毒だったアイテムは、後方互換のためkind="poison"として扱われる）
function cureStatusAilment(kind) {  if (!player || !player.statusAilments) return false;
  if (kind === "all") {
    const had = Object.keys(player.statusAilments).length > 0;
    player.statusAilments = {};
    return had;
  }
  if (player.statusAilments[kind]) {
    delete player.statusAilments[kind];
    return true;
  }
  return false;
}

// ★毒を治す（旧仕様との互換のために残してある。curePoison() === cureStatusAilment("poison")）
function curePoison() {
  return cureStatusAilment("poison");
}

// ===== 回復の対象選択（自分／仲間の誰か／全員） =====

// ★回復技・回復アイテムを使う時に見せる、対象の選択肢。パーティが自分1人だけなら聞くまでもないので空配列を返す
//   （呼び出し側は、空配列なら「唯一いる本人」を対象にそのまま進めればよい）
//   caster: 実際に技を使っている本人（主人公 or 仲間）。省略時は主人公。casterには「自分」ラベルを付ける
// ★includeAllOption：「全員」の選択肢を出すかどうか。
//   道具は自由に選べるのでtrue、単体指定の回復技はfalseにして自分/味方だけに絞る（要望対応）
function getHealTargetChoices(caster, includeAllOption = true) {
  if (!player) return [];
  caster = caster || player;
  const units = [player, ...player.companions];
  if (units.length <= 1) return [];
  const choices = units.map(u => {
    const isCaster = u === caster;
    let label;
    if (u === player) {
      label = isCaster ? "自分" : "主人公"; // ★仲間が回復技を使う時、主人公自身は「主人公」と表示する（casterではないので「自分」ではない）
    } else {
      const m = getCompanionMaster(u);
      const name = m ? m.name : u.companionId;
      label = isCaster ? `${name}（自分）` : name;
    }
    const downSuffix = (u !== player && !u.alive) ? "（戦闘不能）" : "";
    return { text: label + downSuffix, next: "heal_unit_" + (u === player ? "player" : u.companionId) };
  });
  if (includeAllOption) choices.push({ text: "全員", next: "heal_all" });
  return choices;
}

// ★上の選択肢で選ばれたnextの値から、実際に回復させるユニット（player本体 or 仲間オブジェクト）の配列を返す
//   includeDownedInAll: trueだと「全員」に戦闘不能の仲間も含める（完全支援など蘇生技専用）
//   caster: 選択肢を出さなかった（パーティが1人だけの）時に、その唯一の本人を返すために使う
function resolveHealTargetUnits(choiceNext, includeDownedInAll = false, caster) {
  if (!player) return [];
  if (!choiceNext) return [caster || player];
  if (choiceNext === "heal_all") return [player, ...player.companions.filter(c => includeDownedInAll || c.alive)];
  if (choiceNext === "heal_unit_player") return [player];
  if (choiceNext.startsWith("heal_unit_")) {
    const id = choiceNext.replace("heal_unit_", "");
    const companion = player.companions.find(c => c.companionId === id);
    return companion ? [companion] : [player];
  }
  return [caster || player];
}

// ★1体ぶん、対象のゲージ（hp/sp）を回復させる。実際に回復した量を返す（満タンなら0）
//   cleanseがtrueなら状態異常も一緒に治す（今のところ状態異常システムがあるのは主人公だけ）
//   revivesがtrueで、対象が戦闘不能の仲間なら、回復の前にまず蘇生させる（完全支援など専用）
function applyHealToUnit(unit, gaugeKey, amount, cleanse, revives = false) {
  if (!unit || !unit.gauges || !unit.gauges[gaugeKey]) return 0;
  if (revives && unit !== player && !unit.alive) unit.alive = true; // ★蘇生：まずは戦闘不能状態を解除してから回復させる
  // ★バグ修正：蘇生効果を持たない通常の回復を、戦闘不能の仲間に使った時、
  //   戦闘不能状態(alive=false)は解除されないのに、HPの数値（表記）だけ回復してしまっていた。
  //   蘇生技・道具でなければ、戦闘不能の仲間には一切効果が無いようにする
  if (!revives && unit !== player && !unit.alive) return 0;
  const gauge = unit.gauges[gaugeKey];
  const before = gauge.current;
  gauge.current = Math.min(gauge.max, gauge.current + Math.max(0, amount));
  if (cleanse && unit === player) cureStatusAilment("all");
  return gauge.current - before;
}

// ★applyHealToUnitと違い、プラス（回復）だけでなくマイナス（消費・減少）も指定できる汎用版。
//   スキル編集の「HP/SP増減」ブロック用（例：SPを直接消費する技、代償として少しHPを失う技、など）
function applyGaugeDeltaToUnit(unit, gaugeKey, delta) {
  if (!unit || !unit.gauges || !unit.gauges[gaugeKey]) return 0;
  const gauge = unit.gauges[gaugeKey];
  const before = gauge.current;
  gauge.current = Math.max(0, Math.min(gauge.max, gauge.current + delta));
  return gauge.current - before;
}

// ★ユニットから表示名を引く（player.jsからも呼べるよう、battle.js/mainfunc.jsの同名関数と別に持っておく）
//   caster: これがunitと同じなら「自分」を付ける（仲間が自分を回復した時などに使う）
function getHealTargetDisplayName(unit, caster) {
  if (unit === player) return (caster && caster !== player) ? "主人公" : "自分";
  const master = getCompanionMaster(unit);
  const name = master ? master.name : "仲間";
  return (caster && unit === caster) ? `${name}（自分）` : name;
}

/**
 * 経過日数を進める
 * @param {number} days - 進める日数（デフォルト1日）
 */
function advanceDay(days = 1) {
  if (!player) return;
  player.daysSinceTransfer += days;
}

/**
 * ゲーム内の時刻を進める（冒険中の行動などから呼ばれる）。
 * 0時をまたぐたびに daysSinceTransfer を1日進め、クエスト掲示板を日替わりでリセットする。
 * @param {number} hours - 進める時間（時間単位）
 */
function advanceGameTime(hours) {
  if (!player || !hours || hours <= 0) return;
  if (typeof player.gameHour !== "number") player.gameHour = 8;
  
  player.gameHour += hours;
  while (player.gameHour >= 24) {
    player.gameHour -= 24;
    advanceDay(1);
    // ★日付が変わった瞬間に、クエスト掲示板を毎日0時でリセットする（questboard.js）
    if (typeof resetDailyQuestBoard === "function") resetDailyQuestBoard();
  }
}

/**
 * 今の職業のスキル一覧を返す（各スキルは固定の名前・説明・属性を持つ）。
 * レベルで習得済みかどうかは見ず、その職業の全スキルを返す（表示側でロック状態を判断する）
 */
function getPlayerSkills() {
  if (!player) return [];
  return CLASS_SKILLS[player.class] || [];
}

/**
 * 魔法少女が今「マジカル変身」中かどうか（変身中のみ魔法＝attack/heal技を使用できる）
 */
function isMagicalGirlTransformed() {
  return !!(player && player.class === "魔法少女" && player.magicalGirlTransformed);
}

/**
 * 今のレベルで習得済みのスキルだけを返す
 */
function getUnlockedSkills() {
  if (!player) return [];
  return getPlayerSkills().filter(skill => player.level >= skill.unlockLevel);
}

// ★常に発動している「パッシブ」スキル（掘り出し物・算盤高き目利き 等）を、そのidで習得済みか判定する。
//   これらはSPを使って発動するものではなく、該当レベルに達しているだけで効果が続く。
//   ただし、プレイヤーがスキルタブでオフに切り替えている間は発動しない（togglePassiveSkill参照）
function hasPassiveSkill(passiveId) {
  if (player && player.disabledPassives && player.disabledPassives.includes(passiveId)) return false;
  return getUnlockedSkills().some(skill => skill.type === "passive" && skill.passiveId === passiveId);
}

// ★常時発動スキルのON/OFFを切り替える（スキルタブのボタンから呼ぶ）
function togglePassiveSkill(passiveId) {
  if (!player) return;
  if (!player.disabledPassives) player.disabledPassives = [];
  const idx = player.disabledPassives.indexOf(passiveId);
  if (idx >= 0) {
    player.disabledPassives.splice(idx, 1); // ONに戻す
  } else {
    player.disabledPassives.push(passiveId); // OFFにする
  }
}

/**
 * 指定レベルから次のレベルに上がるために必要な経験値を返す（共通関数）
 * ★以前は level*100 だったが、レベルが上がりやすいように level*60 に緩和した
 * @param {number} level
 */
function expNeededForLevel(level) {
  return Math.round(level * 60 * 1.7); // ★要望対応：レベルアップに必要な経験値を1.7倍にする
}

// ★上記の1.7倍化より前に使われていた（旧）計算式。classTotalExp/totalExpをまだ持たない
//   古いセーブデータから、これまでに稼いだであろう累計経験値を逆算する時だけに使う互換用の関数。
//   通常のプレイ中の計算には使わないこと
function legacyExpNeededForLevel(level) {
  return Math.round(level * 60);
}

/**
 * レベル1から指定レベルに到達するまでに必要な累計経験値（そのレベルの手前まで＝端数無し）を返す
 */
function calcTotalExpForLevel(level, expFn) {
  let total = 0;
  for (let l = 1; l < level; l++) total += expFn(l);
  return total;
}

/**
 * 累計経験値の総量から、今の計算式で本来あるべきレベルと、そのレベル内の残り経験値を算出する
 * @returns {{level:number, exp:number}}
 */
function calcLevelFromTotalExp(totalExp, expFn) {
  let level = 1;
  let exp = Math.max(0, Number(totalExp) || 0);
  while (exp >= expFn(level)) {
    exp -= expFn(level);
    level += 1;
  }
  return { level, exp };
}

/**
 * 指定レベルまでの、成長分の累計値を返す（レベル1が基準＝0）
 * ★1レベルごとの増分をその都度四捨五入すると誤差が積み重なるため、
 *   「目標レベルまでの累計」を四捨五入してから差分を取る方式にしている
 */
function getCumulativeGrowth(growthPerLevel, level, key) {
  const rate = (growthPerLevel && growthPerLevel[key]) || 0;
  return Math.round(rate * Math.max(0, level - 1));
}

/**
 * レベルが previousLevel → newLevel に上がった分だけ、ステータス・最大HP/SP・
 * 疲労度上限を底上げする。HP/SPは、増えた分だけ現在値も一緒に増やす（不利益にならないように）
 */
function applyLevelUpGrowth(previousLevel, newLevel) {
  if (!player) return;
  const cls = CLASS_MASTER[player.class];
  const growth = cls && cls.growthPerLevel;
  if (!growth) return;
  
  const statKeys = ["atk", "agi", "skillPower", "luck", "charm"];
  statKeys.forEach((key) => {
    const before = getCumulativeGrowth(growth, previousLevel, key);
    const after = getCumulativeGrowth(growth, newLevel, key);
    player.stats[key] += (after - before);
  });
  
  const maxHpBefore = getCumulativeGrowth(growth, previousLevel, "maxHp");
  const maxHpAfter = getCumulativeGrowth(growth, newLevel, "maxHp");
  const maxHpGain = maxHpAfter - maxHpBefore;
  player.gauges.hp.max += maxHpGain;
  player.gauges.hp.current += maxHpGain; // ★最大値が増えた分は、現在値も一緒に増やす
  
  const maxSpBefore = getCumulativeGrowth(growth, previousLevel, "maxSp");
  const maxSpAfter = getCumulativeGrowth(growth, newLevel, "maxSp");
  const maxSpGain = maxSpAfter - maxSpBefore;
  player.gauges.sp.max += maxSpGain;
  player.gauges.sp.current += maxSpGain;
  
  // ★疲労度の上限も少しずつ上がっていく＝レベルが上がるほど疲れにくくなる
  const maxFatigueBefore = getCumulativeGrowth(growth, previousLevel, "maxFatigue");
  const maxFatigueAfter = getCumulativeGrowth(growth, newLevel, "maxFatigue");
  player.gauges.fatigue.max += (maxFatigueAfter - maxFatigueBefore);
  
  // ★眠気の上限も同様に、レベルが上がるほど少しずつ上がっていく（要望対応）
  const maxSleepinessBefore = getCumulativeGrowth(growth, previousLevel, "maxSleepiness");
  const maxSleepinessAfter = getCumulativeGrowth(growth, newLevel, "maxSleepiness");
  player.gauges.sleepiness.max += (maxSleepinessAfter - maxSleepinessBefore);
}

/**
 * 役場・役所で職業を変更する。今の職業のレベルは記録しておき、次にまたその職業に変えた時は
 * そのレベルから再開できる。今までなったことのない職業ならレベル1から始まる
 * @param {string} newClassName
 * @returns {{success: boolean, isNewClass: boolean, newLevel: number}}
 */
function switchPlayerClass(newClassName) {
  if (!player || !CLASS_MASTER[newClassName]) return { success: false, isNewClass: false, newLevel: 0 };
  if (newClassName === player.class) return { success: false, isNewClass: false, newLevel: player.level };
  
  if (!player.classLevels) player.classLevels = {};
  player.classLevels[player.class] = player.level; // ★今の職業のレベルを記録してから切り替える
  
  if (!player.classTotalExp) player.classTotalExp = {};
  const isNewClass = !(newClassName in player.classLevels);
  if (!(newClassName in player.classTotalExp)) player.classTotalExp[newClassName] = 0; // ★初めてなる職業なら累計経験値も0から
  const targetLevel = isNewClass ? 1 : player.classLevels[newClassName];
  
  const cls = CLASS_MASTER[newClassName];
  const growth = cls.growthPerLevel || {};
  const statKeys = ["atk", "agi", "skillPower", "luck", "charm"];
  const newStats = {};
  statKeys.forEach(key => {
    newStats[key] = (cls.baseStats[key] || 0) + getCumulativeGrowth(growth, targetLevel, key);
  });
  const newMaxHp = (cls.baseStats.maxHp || 1) + getCumulativeGrowth(growth, targetLevel, "maxHp");
  const newMaxSp = (cls.baseStats.maxSp || 0) + getCumulativeGrowth(growth, targetLevel, "maxSp");
  const newMaxFatigue = (cls.maxFatigue || 100) + getCumulativeGrowth(growth, targetLevel, "maxFatigue");
  
  player.class = newClassName;
  player.level = targetLevel;
  player.exp = 0; // ★経験値は職業ごとには持たない簡易仕様。切り替えるたびにリセットする
  player.stats = newStats;
  player.gauges.hp = { current: newMaxHp, max: newMaxHp }; // ★切り替え直後は全回復した状態で始める
  player.gauges.sp = { current: newMaxSp, max: newMaxSp };
  player.gauges.sleepiness.max = cls.maxSleepiness || 100;
  player.gauges.fatigue = { current: 0, max: newMaxFatigue };
  player.classLevels[newClassName] = targetLevel;
  
  return { success: true, isNewClass, newLevel: targetLevel };
}

/**
 * 経験値を加算する。
 * @param {number} amount
 * @returns {{leveledUp: boolean, previousLevel: number, newLevel: number, newSkills: object[]}}
 *   呼び出し側はこれを見て、レベルアップ・新スキル習得のメッセージを出せる
 */
// ★第2話の解放条件に使う「進行度」を加算する。クエスト達成・ランクアップ・魔物討伐で呼ぶ
function addProgressPoints(amount) {
  if (!player) return;
  player.progressPoints += amount;
}

function addExp(amount) {
  if (!player) return { leveledUp: false, previousLevel: 0, newLevel: 0, newSkills: [] };
  
  const previousLevel = player.level;
  player.exp += amount;
  
  // ★要望対応：職業ごとの「累計獲得経験値」を、ロード時のレベル再計算のために別途積み上げておく
  //   （player.expは職業を切り替えるたびに0へリセットされる簡易仕様のため、切り替えても消えない記録として使う）
  if (!player.classTotalExp || typeof player.classTotalExp !== "object") player.classTotalExp = {};
  player.classTotalExp[player.class] = (player.classTotalExp[player.class] || 0) + amount;
  
  let expToNextLevel = expNeededForLevel(player.level);
  while (player.exp >= expToNextLevel) {
    player.exp -= expToNextLevel;
    player.level += 1;
    expToNextLevel = expNeededForLevel(player.level);
  }
  
  const leveledUp = player.level > previousLevel;
  if (leveledUp) {
    applyLevelUpGrowth(previousLevel, player.level); // ★レベルが上がった分、ステータス等を成長させる
  }
  const newSkills = leveledUp
    ? getPlayerSkills().filter(skill => skill.unlockLevel > previousLevel && skill.unlockLevel <= player.level)
    : [];
  
  // ★仲間も、生きている間は主人公と同じだけ経験値を得て、必要ならレベルアップする（要望対応）
  (player.companions || []).forEach(companion => {
    if (!companion.alive) return;
    if (typeof companion.exp !== "number") companion.exp = 0; // ★古いセーブデータ（exp導入前）にも対応する
    companion.exp += amount;
    companion.totalExp = (typeof companion.totalExp === "number" ? companion.totalExp : 0) + amount; // ★累計獲得経験値も併せて記録する
    let companionExpToNext = expNeededForLevel(companion.level);
    while (companion.exp >= companionExpToNext) {
      companion.exp -= companionExpToNext;
      companion.level += 1;
      companionExpToNext = expNeededForLevel(companion.level);
      // ★レベルが上がった分だけ、HP・SPの上限を伸ばす（現在値も同じ量だけ底上げする）
      const master = getCompanionMaster(companion);
      if (master) {
        const newStats = getCompanionStatsAtLevel(master, companion.level);
        const oldStats = getCompanionStatsAtLevel(master, companion.level - 1);
        companion.gauges.hp.max += Math.max(0, newStats.maxHp - oldStats.maxHp);
        companion.gauges.hp.current += Math.max(0, newStats.maxHp - oldStats.maxHp);
        companion.gauges.sp.max += Math.max(0, newStats.maxSp - oldStats.maxSp);
        companion.gauges.sp.current += Math.max(0, newStats.maxSp - oldStats.maxSp);
      }
    }
  });
  
  return { leveledUp, previousLevel, newLevel: player.level, newSkills };
}

/**
 * 冒険者ランクを設定する（クエストクリアなどのタイミングで呼ぶ想定）
 * @param {string} rank - "F" | "E" | "D" | "C" | "B" | "A" | "S" など
 */
function setRank(rank) {
  if (!player) return;
  player.rank = rank;
}

/**
 * 二つ名を設定する（冒険者登録などのタイミングで呼ぶ想定）
 * @param {string} nickname
 */
function setNickname(nickname) {
  if (!player) return;
  player.nickname = nickname;
}