// boss.js
// ボス格の魔物（フィールドの主・ミニボス）と、試練の祭殿専用の「試練の守護者」のデータをまとめたファイル。
// 通常の魔物は enemy.js 側にある。battle.js が ENEMY_MASTER と BOSS_MASTER を合体させて
// MONSTER_MASTER を作る。
//
// ★ボスは通常の魔物と違って、それぞれ専用のBGMを持たせている：
//   bgmTrack       … 通常フェーズ（登場〜）のBGM
//   bgmFinalTrack  … 敵の残りHPが少なくなった「追い込み」フェーズのBGM
//   bgmCrisisTrack … 逆に自分のHPが少なくなった「絶体絶命」フェーズのBGM（省略時は共通曲にフォールバック）
//   実際の切り替えロジックは bgm.js の notifyBattleBGMOfStateChange が担当する。
//   曲ファイルはまだ無い前提の仮の名前なので、bgm/フォルダに同名で用意すればそのまま鳴る。

const BOSS_MASTER = {
  cave_boss: {
    name: "洞窟の主",
    maxHp: 39,
    atk: 12,
    exp: 65,
    dropItemId: "material_002", // 古びた竜の鱗
    dropRate: 0.15, // ★ボスでも確定ではなく、かなり希少な扱いにしてある
    uniqueSkill: { name: "地割れ", chance: 0.3, multiplier: 1.6, flavor: "拳を地面に叩きつけると、足元が大きく割れた！" },
    bgmTrack: "battle_boss_cave",
    bgmFinalTrack: "battle_boss_cave_final",
    bgmCrisisTrack: "battle_boss_cave_crisis"
  },
  grassland_miniboss: {
    name: "縄張り持ちの大狼",
    maxHp: 33,
    atk: 9,
    exp: 40,
    dropItemId: "herb_003",
    dropRate: 0.6,
    uniqueSkill: { name: "遠吠え", chance: 0.3, multiplier: 1.5, flavor: "月に向かって不気味に遠吠えすると、目つきが変わった！" },
    bgmTrack: "battle_boss_grassland",
    bgmFinalTrack: "battle_boss_grassland_final",
    bgmCrisisTrack: "battle_boss_grassland_crisis"
  },
  // ★幻魔の森の最奥に棲むボス。洞窟の主より強い
  forest_boss: {
    name: "森の主",
    maxHp: 48,
    atk: 15,
    exp: 85,
    dropItemId: null,
    dropRate: 0,
    uniqueSkill: { name: "森の怒り", chance: 0.3, multiplier: 1.7, flavor: "周囲の木々がざわめき、森そのものが牙を剥いたようだ！" },
    bgmTrack: "battle_boss_forest",
    bgmFinalTrack: "battle_boss_forest_final",
    bgmCrisisTrack: "battle_boss_forest_crisis"
  },
  // ★試練の祭殿だけに現れる特別な魔物。強さはbattle.jsのstartTrialBattle側で挑む試練のランクに応じて底上げする。
  //   BGMもランクごとに変えたいため、bgmTrack等はここに固定で置かず、
  //   bgm.jsのgetBattleBgmTracks()がbattleState.trialRankから "battle_trial_<ランク>" 系の名前を組み立てる
  trial_guardian: {
    name: "試練の守護者",
    description: "試練の祭殿に現れる、幻の守護者。挑む者の実力を試すために立ちはだかる。",
    maxHp: 40,
    atk: 10,
    exp: 0,
    dropItemId: null,
    dropRate: 0
  },
  // ★第二話クライマックスのグループボス。3体のホブゴブリンをまとめて1体の強敵として表現している
  hobgoblin_pack: {
    name: "ホブゴブリンの群れ",
    description: "洞窟に巣食う、ゴブリンの上位種。硬い皮膚を持つが、硫酸で弱体化した今なら勝機がある。",
    maxHp: 55,
    atk: 13,
    exp: 90,
    dropItemId: null,
    dropRate: 0,
    uniqueSkill: { name: "三体同時強襲", chance: 0.3, multiplier: 1.6, flavor: "3体のホブゴブリンが同時に襲いかかってくる！" },
    bgmTrack: "battle_boss_hobgoblin",
    bgmFinalTrack: "battle_boss_hobgoblin_final",
    bgmCrisisTrack: "battle_boss_hobgoblin_crisis"
  }
};