// bgm.js
// BGM再生をまとめて管理するファイル。
// ★曲ファイル本体（bgm/フォルダの中身）はまだ用意されていない前提で作ってある。
//   再生に失敗しても（ファイルが無くても）ゲームの進行を止めないよう、必ずcatchで握りつぶす。
//   後で bgm/曲名.mp3 の形でファイルを置けば、そのままちゃんと鳴るようになる。
//
// シナリオ側から使う関数（scenario.js・scenario2.jsなど、好きな場面から呼んでよい）：
//   startScenarioBGM(曲名, options)  … 新しく曲を再生する（今何か鳴っていれば、フェード無しで切り替える）
//   switchScenarioBGM(曲名, options) … 今の曲をフェードアウトしてから、次の曲を再生する
//   stopScenarioBGM(options)         … フェードアウトしながら曲を止める
// options（省略可）: { loop: true/false（既定true）, volume: 0〜1（既定0.5）, fadeMs: フェードの長さms（既定800） }
//
// バトル側は battle.js から startBattleBGM() / notifyBattleBGMOfStateChange() を呼んで自動で切り替える。

const BGM_BASE_PATH = "bgm/"; // ★曲ファイルはここに置く想定（bgm/フォルダの中に、元のファイル名・フォルダ構成のまま配置する）
const BGM_DEFAULT_VOLUME = 0.5;
const BGM_DEFAULT_FADE_MS = 800;

// ★コード内部で使う曲名（"town"や"field_cave"など）と、実際に配置されているファイルの相対パス（拡張子抜き）の対応表。
//   ここに無い曲名は、そのまま `bgm/曲名.mp3` を探しにいく（今後ボスBGM等を追加する時のデフォルトの置き場所）
const BGM_TRACK_PATHS = {
  town: "拠点/カリの村/Oak-Village",
  field_cave: "冒険/洞窟/宵露洞窟",
  field_grassland: "冒険/草原/月明かりの草原ループ",
  field_forest: "冒険/森/The_Murmuring_Forest",
  field_highway: "冒険/街道/森へ",
  battle_normal: "battleBgm/nomalenemy/haptime",
  battle_boss_hobgoblin: "battleBgm/boss/ホブゴブリン/GOODRUSH"
};

function resolveBgmTrackPath(trackName) {
  // ★バグ修正：シナリオ設定で追加したBGMの名前解決（BGM_TRACK_PATHSへの登録）は本来loadCustomScenarioData()の
  //   タイミングで行われるが、エンディングなど呼ばれるタイミングが早い/特殊な画面から再生しようとすると、
  //   登録が間に合わずファイルが見つからず失敗→bgmFailedTracksに載って以後ずっと再生されなくなっていた。
  //   曲を探す直前に必ず登録し直すことで、タイミングに関わらず常に最新のパスで解決できるようにする
  if (typeof ensureCustomBgmRegistered === "function") ensureCustomBgmRegistered();
  const relativePath = BGM_TRACK_PATHS[trackName] || trackName;
  return `${BGM_BASE_PATH}${relativePath}.mp3`;
}

// ★実際にbgmフォルダに用意されているファイルの一覧（拡張子抜きの相対パス）。
//   シナリオエディタのBGM入力欄で「town」のような内部名ではなく、実ファイルのパスを候補として出すために使う。
//   曲ファイルを追加した時は、ここにも追記しておくとエディタの候補に出てくるようになる。
const BGM_LIBRARY_FILES = [
  "拠点/カリの村/Oak-Village",
  "冒険/森/The_Murmuring_Forest",
  "冒険/洞窟/宵露洞窟",
  "冒険/草原/月明かりの草原ループ",
  "冒険/街道/森へ",
  "battleBgm/nomalenemy/haptime",
  "battleBgm/boss/ホブゴブリン/GOODRUSH"
];

let currentBgmAudio = null; // 今再生中の Audio インスタンス（無ければnull）
let currentBgmName = null; // 今再生中の曲名（重複再生を避けるための判定に使う）
const bgmFailedTracks = new Set(); // ★一度読み込みに失敗した（＝ファイルが無い）曲名。毎ターン無駄に再挑戦しないための記録

// ★ブラウザの自動再生ポリシーにより、ページ読み込み直後などユーザーが一度も操作していない状態で
//   audio.play()を呼んでも再生がブロックされてしまう（曲ファイル自体は正しく置けていても鳴らない）。
//   ブロックされた再生はここに控えておき、最初のクリック・キー入力・タップがあった瞬間に再試行する
let pendingAutoplayRetryAudio = null;
function retryPendingAutoplayBgm() {
  if (pendingAutoplayRetryAudio && pendingAutoplayRetryAudio === currentBgmAudio) {
    pendingAutoplayRetryAudio.play().catch(() => {});
  }
  pendingAutoplayRetryAudio = null;
}
["click", "keydown", "touchstart"].forEach(eventName => {
  // ★捕捉フェーズ(capture)で登録することで、選択肢ボタン等のstopPropagation()に関係なく必ず先に反応させる
  document.addEventListener(eventName, retryPendingAutoplayBgm, { capture: true });
});

// ===== シナリオ用の公開関数 =====

// 新しく曲を再生する。既に何か鳴っていれば、フェード無しで即座に切り替える
function startScenarioBGM(trackName, options = {}) {
  playBgmTrack(trackName, options);
}

// 今の曲をフェードアウトしてから、次の曲をフェードインで再生する
async function switchScenarioBGM(trackName, options = {}) {
  if (trackName === currentBgmName) return; // ★同じ曲ならやり直さない（ぶつ切りにならないように）
  // ★過去に読み込みに失敗した（ファイルが無い）曲は、フェード演出だけ空振りさせないよう、
  //   ここで諦めて今の曲をそのまま鳴らし続ける（例：ボスの追い込み用・緊迫用BGMがまだ無い場合）
  if (bgmFailedTracks.has(trackName)) return;
  const fadeMs = options.fadeMs !== undefined ? options.fadeMs : BGM_DEFAULT_FADE_MS;
  await fadeOutCurrentBgm(fadeMs);
  playBgmTrack(trackName, options);
}

// 今の曲をフェードアウトしながら止める
async function stopScenarioBGM(options = {}) {
  const fadeMs = options.fadeMs !== undefined ? options.fadeMs : BGM_DEFAULT_FADE_MS;
  await fadeOutCurrentBgm(fadeMs);
  currentBgmAudio = null;
  currentBgmName = null;
}

// ===== 内部処理 =====

// 曲を（フェード無しで）即座に再生し始める。
// ★指定した曲のファイルが読み込めなかった場合（bgm/曲名.mp3 が無い）は、無音になったり止まったりせず、
//   それまで鳴っていた曲があればそのまま鳴らし続ける（例：ボスの追い込み用・緊迫用BGMがまだ無い時）
function playBgmTrack(trackName, options = {}) {
  const fallbackAudio = currentBgmAudio; // ★この曲の読み込みに失敗した時に戻す、直前の再生状態
  const fallbackName = currentBgmName;
  const volume = options.volume !== undefined ? options.volume : BGM_DEFAULT_VOLUME;
  
  const audio = new Audio(resolveBgmTrackPath(trackName));
  audio.loop = options.loop !== undefined ? options.loop : true;
  audio.volume = volume;
  
  let failHandled = false;
  audio.addEventListener("error", () => {
    if (failHandled) return;
    failHandled = true;
    bgmFailedTracks.add(trackName); // ★次回以降、この曲名へは最初から切り替えを試みない
    console.warn(`BGM「${trackName}」の再生に失敗しました（${resolveBgmTrackPath(trackName)} が無い可能性があります）。直前の曲があれば継続します。`);
    
    if (currentBgmAudio !== audio) return; // ★既に別の曲へ切り替わっていたら、ここでは何もしない
    if (fallbackAudio) {
      fallbackAudio.volume = volume; // ★フェードアウト済みで音量が0になっている場合があるので戻す
      fallbackAudio.play().catch(() => {});
      currentBgmAudio = fallbackAudio;
      currentBgmName = fallbackName;
    } else {
      currentBgmAudio = null;
      currentBgmName = null;
    }
  }, { once: true });
  
  if (fallbackAudio && fallbackAudio !== audio) {
    fallbackAudio.pause();
  }
  
  // ★曲ファイルがまだ配置されていない環境でも、エラーで止まらないようにする
  audio.play().catch(() => {
    console.warn(`BGM「${trackName}」の再生に失敗しました（自動再生がブロックされたか、${resolveBgmTrackPath(trackName)} が無い可能性があります）。次のクリック・キー操作で再試行します。`);
    pendingAutoplayRetryAudio = audio; // ★自動再生ブロックが原因のことが多いので、次のユーザー操作で再生を試みる
  });
  
  currentBgmAudio = audio;
  currentBgmName = trackName;
}

// 今鳴っている曲を、durationMsかけて音量0までフェードアウトさせてから止める
function fadeOutCurrentBgm(durationMs) {
  return new Promise(resolve => {
    if (!currentBgmAudio) {
      resolve();
      return;
    }
    const audio = currentBgmAudio;
    const startVolume = audio.volume;
    const steps = 20;
    const stepMs = Math.max(1, durationMs / steps);
    let step = 0;
    
    if (durationMs <= 0) {
      audio.pause();
      resolve();
      return;
    }
    
    const timer = setInterval(() => {
      step++;
      audio.volume = Math.max(0, startVolume * (1 - step / steps));
      if (step >= steps) {
        clearInterval(timer);
        audio.pause();
        resolve();
      }
    }, stepMs);
  });
}

// ===== 戦闘用BGM（battle.jsから呼ぶ） =====
// ★雑魚戦は共通の2曲（通常／緊迫）のみ。ボス・試練戦は、それぞれ専用のBGMを持てるようにしてある：
//   - ボス（cave_boss等）: boss.jsのBOSS_MASTER各エントリの bgmTrack / bgmFinalTrack / bgmCrisisTrack を使う
//   - 試練（trial_guardian）: ランクごとに "battle_trial_<ランク>" 系の名前を自動で組み立てる（getBattleBgmTracks参照）
//   曲名はどれも仮の命名なので、実際のファイルを用意する時はこの名前でbgm/フォルダに置けばよい

const BATTLE_BGM_TRACKS = {
  normal: "battle_normal", // 雑魚戦（共通）
  crisis: "battle_crisis", // 自分のHPが残りわずかな時（ボス・試練が専用曲を持たない場合のフォールバックにも使う）
  boss: "battle_boss", // ボス用のデフォルト（bgmTrack未設定のボスがいた場合の保険）
  bossFinal: "battle_boss_final" // 同上（bgmFinalTrack未設定時の保険）
};

// ★このしきい値を境に、専用のBGMへ切り替わる
const BATTLE_BGM_CRISIS_HP_RATIO = 0.3; // 自分のHPがこの割合以下で「crisis」系に切り替わる
const BATTLE_BGM_BOSS_FINAL_HP_RATIO = 0.2; // （ボス・試練限定）敵のHPがこの割合以下で「final」系に切り替わる

// 今の battleState から、このボス（または試練）専用のBGM3種（通常/追い込み/緊迫）を組み立てて返す。
// ★雑魚戦から呼ばれることは無い想定（呼び出し側でisBossの時だけ使う）
function getBattleBgmTracks() {
  if (!battleState) {
    return { normal: BATTLE_BGM_TRACKS.boss, final: BATTLE_BGM_TRACKS.bossFinal, crisis: BATTLE_BGM_TRACKS.crisis };
  }
  
  // ★試練の祭殿：挑んでいるランクごとに曲名を変える（trial_guardianは1体しかいないため、ここで動的に組み立てる）
  if (battleState.isTrial) {
    const rank = battleState.trialRank;
    return {
      normal: `battle_trial_${rank}`,
      final: `battle_trial_${rank}_final`,
      crisis: `battle_trial_${rank}_crisis`
    };
  }
  
  // ★通常のボス：boss.js（BOSS_MASTER）側で個別に指定した曲名を使う。
  //   final/crisisが空欄の場合は「切り替えない＝直前の曲をそのまま続ける」という意味にする
  //   （nullを返し、呼び出し側でnullなら曲を変えないようにする）
  const master = (typeof MONSTER_MASTER !== "undefined") ? MONSTER_MASTER[battleState.monsterKey] : null;
  return {
    normal: (master && master.bgmTrack) || BATTLE_BGM_TRACKS.boss,
    final: (master && master.bgmFinalTrack) ? master.bgmFinalTrack : null,
    crisis: (master && master.bgmCrisisTrack) ? master.bgmCrisisTrack : null
  };
}

// 戦闘開始時に呼ぶ。isBossがtrueならボス（試練を含む）専用の曲から始める
function startBattleBGM(isBoss) {
  if (!isBoss) {
    playBgmTrack(BATTLE_BGM_TRACKS.normal, { loop: true });
    return;
  }
  const tracks = getBattleBgmTracks();
  playBgmTrack(tracks.normal, { loop: true });
}

// ★毎ターン（battle.jsのupdateBattleHudから）呼ぶ想定。
//   自分のHPが少ない「crisis」系を最優先し、次にボス・試練戦での「敵の残りHPが少ない＝もう少しで勝てる」演出、
//   どちらでもなければ通常の戦闘曲に戻す……という優先順位で自動的に切り替える
function notifyBattleBGMOfStateChange(isBoss) {
  if (!player || typeof battleState === "undefined" || !battleState) return;
  
  const playerHpRatio = player.gauges.hp.current / player.gauges.hp.max;
  const enemyHpRatio = battleState.hp / battleState.maxHp;
  
  if (!isBoss) {
    const targetTrack = playerHpRatio <= BATTLE_BGM_CRISIS_HP_RATIO ? BATTLE_BGM_TRACKS.crisis : BATTLE_BGM_TRACKS.normal;
    if (targetTrack !== currentBgmName) switchScenarioBGM(targetTrack, { fadeMs: 600 });
    return;
  }
  
  const tracks = getBattleBgmTracks();
  let targetTrack;
  if (playerHpRatio <= BATTLE_BGM_CRISIS_HP_RATIO && tracks.crisis) {
    targetTrack = tracks.crisis; // ★劣勢からの「逆転」を演出する場面なので最優先（空欄なら発動させず、下の分岐に進む）
  } else if (enemyHpRatio <= BATTLE_BGM_BOSS_FINAL_HP_RATIO && tracks.final) {
    targetTrack = tracks.final;
  } else {
    targetTrack = tracks.normal;
  }
  
  if (targetTrack && targetTrack !== currentBgmName) {
    switchScenarioBGM(targetTrack, { fadeMs: 600 });
  }
}

// 戦闘終了時（勝利・敗北・逃走・試練終了のいずれでも）に呼ぶ
function stopBattleBGM() {
  stopScenarioBGM({ fadeMs: 500 });
}