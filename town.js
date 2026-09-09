// town.js
// カリの村での「行き先メニュー」。第一話クリア後、自由行動パートで使う。
// 中身が未実装の場所は、仮のメッセージを出してメニューに戻るだけのスタブにしてある。

// ★施設のセリフブロック（シナリオビルド「施設編集」で登録）を、上から順番に再生する。
//   1件も登録されていなければ、fallbackText（従来の単純な1行セリフ欄）があればそれを話す
async function runFacilityDialogueBlocks(facility, blocks, fallbackText) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    if (fallbackText) {
      changeSpeaker(facility.name || "");
      await displayMessage(fallbackText);
    }
    return;
  }
  for (const block of blocks) {
    if (!block.text) continue;
    if (block.type === "telop") {
      await showSpecialScene(block.text); // mainfunc.js（黒背景に大きく表示）
    } else if (block.type === "narration") {
      changeSpeaker("");
      await displayMessage(block.text);
    } else {
      changeSpeaker(block.speaker || facility.name || "");
      await displayMessage(block.text);
    }
  }
}

// ★マップ設定タブで作った「街／国／村」タイプのエリア（例：カデリクの街）に入った時のメニュー。
//   以前はエリアの種類（街／村／国／敵エリア）を見ずに、どのエリアも森・草原・洞窟と同じ
//   「前に進む/調べる」のダンジョン探索フロー（ランダムエンカウントあり）に入ってしまい、
//   設定した施設(facilityIds)に一切アクセスできず、敵エリアと変わらないように見える不具合の原因だった。
//   街／国／村タイプは、カリの村（openTownMenu）と同じように施設一覧から選ぶ平和な拠点として開く
async function openCustomSettlementArea(area) {
  currentLocationKey = "settlement_" + area.id; // ★セーブ/ロードで現在地を復元するための記録
  if (player) player.lastVisitedBaseKey = currentLocationKey; // ★要望対応：敗北時に「直前に立ち寄った拠点」へ戻すための記録
  // ★バグ修正：店の画像だけ指定してこの拠点自体の画像を指定していない場合、店から「戻る」で
  //   ここに戻ってきても背景画像が店のままになってしまっていた。画像が無指定の時は、
  //   種類に応じたそれっぽい既定の画像に戻すようにする
  setBackgroundImage(area.bgImage || (area.type === "village" ? "img/村.jpeg" : "img/街.jpg"));
  if (area.bgTrack && typeof switchScenarioBGM === "function") switchScenarioBGM(area.bgTrack, { fadeMs: 600 });
  
  if (typeof loadCustomScenarioData === "function") loadCustomScenarioData(); // scenariobuild.js
  
  const locations = [];
  if (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.facilities)) {
    const attachedIds = Array.isArray(area.facilityIds) ? area.facilityIds : null;
    const attachedFacilities = scenarioProject.facilities.filter(facility => !attachedIds || attachedIds.includes(facility.id));
    
    // ★店タイプの施設は、他の施設のようにここへ直接並べるのではなく、後述の「店」を選んだ時の
    //   一覧にまとめる（店が1件も無い拠点では「店」の選択肢自体を出さない）
    const shopFacilities = attachedFacilities.filter(f => f.type === "shop");
    attachedFacilities
      .filter(facility => facility.type !== "shop")
      .forEach(facility => {
        locations.push({ label: facility.name || "？", action: () => openCustomFacility(facility, () => openCustomSettlementArea(area)) });
      });
    if (shopFacilities.length > 0) {
      locations.push({ label: "店", action: () => openCustomShopList(shopFacilities, () => openCustomSettlementArea(area)) });
    }
  }
  
  // ★examineMessages（複数登録できる新形式）から選ぶ。旧データ（examineMessage単体）にも対応
  const examineVariants = Array.isArray(area.examineMessages) && area.examineMessages.length > 0
    ? area.examineMessages
    : (area.examineMessage ? [area.examineMessage] : []);
  if (examineVariants.length > 0) {
    locations.push({ label: "調べる", action: async () => {
      changeSpeaker("");
      await displayMessage(examineVariants[Math.floor(Math.random() * examineVariants.length)]);
      openCustomSettlementArea(area);
    } });
  }
  
  // ★以前はここに「立ち去る」ボタンがあり、どの拠点からでも強制的にカリの村（home）へ
  //   戻されてしまっていた。マップ画面から自由に次の行き先を選べるよう、ボタンを
  //   「冒険に出る」に変更し、マップ画面（adventuremap.js）を開くようにした。
  //   行き先を選ばずにマップを閉じた時は、村ではなく「今いたこの拠点」に戻るよう戻り先を明示的に渡す
  locations.push({ label: "冒険に出る", action: () => {
    hideLocationMenu();
    if (typeof openAdventureMap === "function") openAdventureMap(() => openCustomSettlementArea(area)); // adventuremap.js
  } });
  
  showLocationMenu(locations, area.name || "？？？");
}

// 町のトップメニュー（酒場・宿屋・店・冒険する）
async function openTownMenu() {
  // ★この関数は「村に初めて/改めて到着した時」だけでなく、店や施設から「戻る」で
  //   呼ばれる場合にも使い回されている。来訪回数はよそから村に来た時だけ数えたいので、
  //   直前の現在地が村以外だった時（＝実際に村へ来た時）だけ「到着」とみなす
  const isFreshArrival = currentLocationKey !== "town";
  currentLocationKey = "town"; // ★セーブ/ロードで現在地を復元するための記録
  if (player) player.lastVisitedBaseKey = "town"; // ★要望対応：敗北時に「直前に立ち寄った拠点」へ戻すための記録
  chapter1Finished = true; // ★ここに到達した時点で第一話は完了している
  // ★マップ編集でカリの村（拠点）に設定した背景画像があればそちらを使う。
  //   以前はここが常に固定で"img/村.jpeg"のままで、マップ編集で変更しても一切反映されないバグがあった
  if (typeof loadCustomScenarioData === "function") loadCustomScenarioData(); // scenariobuild.js
  const villageArea = (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.mapAreas))
    ? scenarioProject.mapAreas.find(a => a.locationKey === "village") : null;
  setBackgroundImage((villageArea && villageArea.bgImage) || "img/村.jpeg"); // ★冒険や戦闘で背景が変わっていても、村に戻ったら必ず村の背景に戻す
  if (typeof resetAllPortraits === "function") resetAllPortraits(); // mainfunc.js（村に戻ったら、話の中で出していた立ち絵は消しておく）
  if (typeof switchScenarioBGM === "function") switchScenarioBGM("town", { fadeMs: 600 }); // bgm.js（既に流れていれば何もしない。曲ファイルが無ければ静かに失敗するだけ）
  // ★要望対応：オートセーブは「5分ごと」「話直前」「終了時」の専用3枠に変わったため、
  //   ここ（村に戻るたび）での上書き保存は廃止した（5分ごとの枠を、5分間隔と無関係に
  //   頻繁に上書きしてしまうことになるため）
  
  if (isFreshArrival) {
    // ★開始トリガーを「エリアに来た時（カリの村・n回目）」にしている自作の話があれば、メニューを開く前にここで自動的に始める
    if (typeof maybeAutoIncrementAreaVisit === "function") maybeAutoIncrementAreaVisit("village");
    if (typeof checkAndAutoRunNextCustomChapter === "function" && await checkAndAutoRunNextCustomChapter("areaVisit", "village")) return;
  }
  
  const locations = [
    { label: "酒場", action: () => { tavernReturnTo = null; currentLocationKey = "tavern"; openTavern(); } },
    { label: "店", action: () => openShopMenu() },
    { label: "冒険する", action: () => openQuestMenu() },
    { label: "試練の祭殿", action: () => openTrialShrine() } // adventure.js（★以前はマップ画面から。広場から直接行けるように）
    // ★組み込みの「宿屋」はここから削除。施設編集タブで新しく作った宿を、マップ編集でカリの村にアタッチして使う想定
  ];
  
  // ★マップ設定タブの「施設編集」で追加した施設のうち、村にアタッチされているものだけを町メニューに追加する
  //   （以前は施設編集で作った施設が全ての拠点に出てしまっていたため、マップ編集の拠点編集画面でアタッチできるようにした）
  if (typeof loadCustomScenarioData === "function") loadCustomScenarioData(); // scenariobuild.js
  if (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.facilities)) {
    const villageArea = scenarioProject.mapAreas.find(a => a.locationKey === "village");
    const attachedIds = villageArea && Array.isArray(villageArea.facilityIds) ? villageArea.facilityIds : null;
    scenarioProject.facilities
      .filter(facility => !attachedIds || attachedIds.includes(facility.id))
      .filter(facility => facility.type !== "shop") // ★店タイプは「店」メニュー（openShopMenu）側に一覧で出すので、ここには並べない
      .forEach(facility => {
        locations.push({ label: facility.name || "？", action: () => openCustomFacility(facility) });
      });
  }
  
  showLocationMenu(locations, "カリの村");
}

// 「店」を選んだ時のサブメニュー（買取屋・武器屋・防具屋など＋施設編集で追加した独自の店）
// ★以前はここで組み込みの「武器屋・防具屋・道具屋・錆取り屋・買取屋」を必ず出しており、
//   ITEM_MASTERに登録されている該当カテゴリの全アイテムがカリの村で無条件に買えてしまっていた
//   （施設編集で個別の店を作っても、こちらの組み込み店とは別に存在するだけで、
//   本来売りたくないアイテムまで買えてしまう不具合の原因になっていた）。
//   他の拠点（openCustomSettlementArea）と同じく、施設編集タブでカリの村にアタッチした
//   「店」タイプの施設だけを一覧表示するように変更した
async function openShopMenu() {
  currentLocationKey = "shop"; // ★セーブ/ロードで現在地を復元するための記録
  if (typeof loadCustomScenarioData === "function") loadCustomScenarioData(); // scenariobuild.js
  
  const shopFacilities = [];
  if (typeof scenarioProject !== "undefined" && Array.isArray(scenarioProject.facilities)) {
    const villageArea = scenarioProject.mapAreas.find(a => a.locationKey === "village");
    const attachedIds = villageArea && Array.isArray(villageArea.facilityIds) ? villageArea.facilityIds : null;
    scenarioProject.facilities
      .filter(facility => facility.type === "shop" && (!attachedIds || attachedIds.includes(facility.id)))
      .forEach(facility => shopFacilities.push(facility));
  }
  
  if (shopFacilities.length === 0) {
    changeSpeaker("");
    await displayMessage("……この村には、まだ店が無いようだ。");
    openTownMenu();
    return;
  }
  
  const locations = shopFacilities.map(facility => ({
    label: facility.name || "？", action: () => openCustomShopFacility(facility, () => openShopMenu())
  }));
  locations.push({ label: "戻る", action: () => openTownMenu() });
  showLocationMenu(locations, "店");
}

// ★店タイプの施設が複数ある拠点（カリの村以外）で「店」を選んだ時に出す一覧
async function openCustomShopList(shopFacilities, returnTo) {
  const goBack = typeof returnTo === "function" ? returnTo : openTownMenu;
  const locations = shopFacilities.map(facility => ({
    label: facility.name || "？", action: () => openCustomShopFacility(facility, () => openCustomShopList(shopFacilities, goBack))
  }));
  locations.push({ label: "戻る", action: () => goBack() });
  showLocationMenu(locations, "店");
}

// ★店タイプの施設を実際に開く。買取屋チェックが付いていれば既存の汎用買取屋、
//   そうでなければfacility.shopItemsで指定した品揃え専用の店として売る
// ★以前は、お金不足やキャンセル・購入後の毎回、openCustomShopFacility()自身を呼び直していたため、
//   （宿・役場・鍛冶屋で見つかったのと同じ不具合で）入店セリフが毎回再生されてしまっていた。
//   入店セリフは最初の1回だけ流し、以降のメニュー出し直しは showCustomShopMenu() の方を使うようにした。
//   また、以前は必ず1個ずつしか買えなかったが、まとめ買いできるよう個数選択（pickQuantity）にも対応した
async function openCustomShopFacility(facility, returnTo) {
  const goBack = typeof returnTo === "function" ? returnTo : openShopMenu;
  currentLocationKey = "facility_" + facility.id; // ★セーブ/ロードで現在地を復元するための記録
  // ★バグ修正：店タイプの施設だけ、openCustomFacility()を経由しないため背景画像の指定が
  //   一切反映されていなかった（宿・役場・鍛冶屋・素材合成屋は反映されるのに店だけ変わらない不具合）
  if (facility.bgImage) setBackgroundImage(facility.bgImage);
  if (facility.bgTrack && typeof switchScenarioBGM === "function") switchScenarioBGM(facility.bgTrack, { fadeMs: 600 });
  hideLocationMenu();
  await runFacilityDialogueBlocks(facility, facility.enterBlocks, facility.ownerDialogue); // ★入った時のセリフ（ここでしか流さない）
  await processShopEntryOffers(facility); // ★要望対応：特定のアイテムを持っていたら貰える特典を、お店に入るたびに判定する
  
  if (facility.isBuyShop) {
    await openBuyShop(goBack); // ★所持アイテムを何でも売れる、既存の汎用買取屋をそのまま使う
    return;
  }
  
  await showCustomShopMenu(facility, goBack);
}

// ★要望対応：店の「特典」（特定のアイテムを持っていると貰える／割引される）のうち、
//   「貰える」タイプだけをここで処理する（割引タイプは値段計算側でその都度判定する）
async function processShopEntryOffers(facility) {
  if (!Array.isArray(facility.shopOffers)) return;
  for (const offer of facility.shopOffers) {
    if (offer.mode !== "give" || !offer.requiredItemId || !offer.giveItemId) continue;
    if (typeof getTotalItemCount !== "function" || getTotalItemCount(offer.requiredItemId) <= 0) continue; // questboard.js
    if (offer.consumeRequiredItem && typeof removeItem === "function") removeItem(offer.requiredItemId, 1); // inventory.js
    const qty = offer.giveItemQty || 1;
    if (typeof addItem === "function") addItem(offer.giveItemId, qty); // inventory.js
    renderStatusHUD();
    const master = (typeof ITEM_MASTER !== "undefined" && ITEM_MASTER[offer.giveItemId]) || null;
    changeSpeaker(facility.name || "");
    await displayMessage(`「これを持って来てくれたのか。お礼にこれをどうぞ」\n${master ? master.name : offer.giveItemId}を${qty}個受け取った！`);
  }
}

// ★要望対応：店の「特典」に割引タイプが設定されていて、かつ条件を満たしている場合、割引後の値段を返す
function getDiscountedShopPrice(facility, basePrice) {
  if (!Array.isArray(facility.shopOffers)) return basePrice;
  let price = basePrice;
  facility.shopOffers.forEach(offer => {
    if (offer.mode !== "discount" || !offer.requiredItemId) return;
    if (typeof getTotalItemCount !== "function" || getTotalItemCount(offer.requiredItemId) <= 0) return; // questboard.js
    const percent = Math.min(90, Math.max(0, offer.discountPercent || 0));
    price = Math.round(price * (1 - percent / 100));
  });
  return Math.max(0, price);
}

// ★店頭メニューの出し直し専用（入店セリフ facility.ownerDialogue は流さない）
async function showCustomShopMenu(facility, goBack) {
  const shopItems = Array.isArray(facility.shopItems) ? facility.shopItems.filter(e => e.itemId && ITEM_MASTER[e.itemId]) : [];
  if (shopItems.length === 0) {
    changeSpeaker(facility.name || "");
    await displayMessage("……今のところ、売れる品は無いようだ。");
    goBack();
    return;
  }
  
  changeSpeaker(facility.name || "");
  const choices = shopItems.map(entry => {
    const price = getDiscountedShopPrice(facility, entry.price);
    const priceLabel = price !== entry.price ? `${price}陳（割引前${entry.price}陳）` : `${price}陳`;
    return { text: `${ITEM_MASTER[entry.itemId].name}（${priceLabel}）`, next: entry.itemId };
  });
  choices.push({ text: "やめる", next: "cancel", isBack: true });
  await displayMessage("何を買う？");
  const picked = await displayChoices(choices);
  if (picked.next === "cancel") {
    goBack();
    return;
  }
  
  const entry = shopItems.find(e => e.itemId === picked.next);
  const unitPrice = getDiscountedShopPrice(facility, entry.price); // ★特典の割引を反映した実際の値段
  if (gold < unitPrice) {
    await displayMessage("すまないが、その持ち金では買えないようだ……");
    await showCustomShopMenu(facility, goBack);
    return;
  }
  
  // ★まとめて買えるように個数を選ばせる（持ち金で買える範囲・最大10個まで。汎用の店と同じ仕様に揃えた）
  const affordableMax = Math.min(10, Math.floor(gold / unitPrice));
  const qty = await pickQuantity(affordableMax, ITEM_MASTER[entry.itemId].name);
  if (qty <= 0) {
    await showCustomShopMenu(facility, goBack);
    return;
  }
  
  const totalPrice = unitPrice * qty;
  const confirmed = await showGameConfirm(`「${ITEM_MASTER[entry.itemId].name}」を${qty}個、${totalPrice}陳で買いますか？`); // mainfunc.js
  if (!confirmed) {
    await showCustomShopMenu(facility, goBack);
    return;
  }
  
  changeGold(-totalPrice); // inventory.js
  const added = addItem(entry.itemId, qty); // inventory.js
  renderStatusHUD();
  changeSpeaker(facility.name || "");
  if (added) {
    await displayMessage(`「${ITEM_MASTER[entry.itemId].name}」を${qty}個買った！`);
  } else {
    await displayMessage("持ち物がいっぱいで、受け取れなかったようだ……");
    changeGold(totalPrice); // ★受け取れなかった分は返す
    renderStatusHUD();
  }
  
  await showCustomShopMenu(facility, goBack);
}

// ===== 錆取り屋：「錆びたシリーズ」の武器・防具のサビを落として、ステータスを揺らし直してもらう =====
// ★実際の抽選・反映処理は appraisal.js（getRustRemovalCandidates / performRustRemoval）が持っている。
//   ここではお金のやり取りと画面遷移だけを担当する
async function openRustRemovalShop() {
  hideLocationMenu();
  
  const candidates = getRustRemovalCandidates(); // appraisal.js
  
  changeSpeaker("錆取り屋の主人");
  if (candidates.length === 0) {
    await displayMessage("「悪いが、うちで手入れできそうな錆びた品は持っていないようだな。」");
    openShopMenu();
    return;
  }
  
  await displayMessage(`「サビを落として、性能を洗い直してやろう。1回${RUST_REMOVAL_COST}陳だ。」`); // appraisal.js
  
  const choices = candidates.map((c, i) => ({ text: `${c.master.name}（ランク${c.master.rank}）${candidates.length > 1 ? ` #${i + 1}` : ""}`, next: String(c.slot.instanceId) }));
  choices.push({ text: "戻る", next: "back", isBack: true });
  
  const picked = await displayChoices(choices);
  if (picked.next === "back") {
    openShopMenu();
    return;
  }
  
  if (gold < RUST_REMOVAL_COST) {
    changeSpeaker("錆取り屋の主人");
    await displayMessage("「金が足りないようだな。」");
    openRustRemovalShop();
    return;
  }
  
  const target = candidates.find(c => String(c.slot.instanceId) === picked.next);
  const ok = await showGameConfirm(`${RUST_REMOVAL_COST}陳でサビ取りをしますか？（結果は運次第です）`);
  if (!ok) {
    openRustRemovalShop();
    return;
  }
  
  changeGold(-RUST_REMOVAL_COST); // inventory.js
  renderStatusHUD();
  
  const resultText = performRustRemoval(target.itemId, target.master, target.slot); // appraisal.js
  changeSpeaker("錆取り屋の主人");
  await displayMessage(resultText);
  
  openRustRemovalShop(); // ★続けて他の品も試せるよう、もう一度この画面に戻る
}

// ★ 以下、まだ中身が無い場所のスタブ。
//   実装が決まったらここを本来のシーン関数に差し替えていく。
async function goToPlaceholderScene(placeName) {
  hideLocationMenu();
  changeSpeaker("");
  await displayMessage(`（${placeName}はまだ準備中のようだ……）`);
  openTownMenu();
}

// ===== 酒場：店主と話す/クエスト掲示板を見る =====

// 店主との世間話（最近の情勢・噂・雑談など）のネタ一覧。呼ぶたびランダムに1つ選ぶ
const TAVERN_TOPICS = [
  "「最近、隣町までの街道に野盗が出るらしいから気をつけな。」",
  "「北の森で、変わった色の魔物を見たってやつがいてな……真偽のほどは知らんが。」",
  "「今年は収穫祭が例年より豪華になるらしいぞ。楽しみにしとくといい。」",
  "「王都の方じゃ、また税が上がるだの何だのって噂が流れてるらしいな。」",
  "「あの竜殺しの嬢ちゃん、また誰かと揉め事起こしてないといいけどな……」",
  "「隣村の宿屋、最近改装したとかで結構いい部屋になったって話だ。」",
  "「冒険者ギルドの本部で、また依頼のランク改定があったらしいぞ。」"
];

let tavernReturnTo = null; // ★酒場から「戻る」を押した時の戻り先。村の酒場ならnull（＝村の広場）、独自施設の酒場ならその拠点の広場を入れる

function openTavern() {
  // ★バグ修正：以前はここで「tavernReturnToが無ければ村扱い」という条件付きの上書きをしていたが、
  //   便利タブ経由やクエスト画面からの「戻る」等、tavernReturnToの状態が予期せず変わるケースがあり、
  //   結局まれに村以外の酒場でもcurrentLocationKeyが"tavern"に巻き戻ってしまうことがあった。
  //   確実性を優先し、currentLocationKeyはここでは一切触らない（呼び出し元で必ず設定済みにする）。
  
  const options = [
    { label: "主人と話をする", action: () => talkToTavernMaster() },
    { label: "クエストを見る", action: () => openQuestBoard() }
  ];
  
  // ★受注中の依頼が達成条件を満たしていたら、報告して報酬を受け取れるようにする
  if (typeof isActiveQuestReadyToTurnIn === "function" && isActiveQuestReadyToTurnIn()) {
    options.push({ label: "依頼の報告をする", action: () => turnInActiveQuest() });
  }
  
  options.push({ label: "戻る", action: () => (tavernReturnTo || openTownMenu)() });
  
  showLocationMenu(options, "酒場");
}

async function talkToTavernMaster() {
  hideLocationMenu();
  changeSpeaker("店主");
  
  // ★第2話の解放条件は、シナリオエディタの「話管理」で編集した内容（必要日数・進行度・ランク・フラグ・実装済みチェック）を
  //   そのまま使う。以前はここがscenario2.js側の isChapter2Unlockable()（15日・進行度200固定）だけを見ていたため、
  //   話管理で必要日数を変えても一切反映されないバグがあった
  if (typeof loadCustomScenarioData === "function") loadCustomScenarioData(); // scenariobuild.js
  const chapter2Entry = typeof scenarioProject !== "undefined" ? scenarioProject.chapters.find(c => c.id === "builtin_chapter2") : null;
  const chapter2Unlockable = !!(chapter2Entry && !chapter2Entry.cleared && typeof evaluateChapterUnlockConditions === "function" && evaluateChapterUnlockConditions(chapter2Entry));
  
  // ★第2話の解放条件を満たしていて、かつ中身が実装済みの場合だけ第2話へ進む
  //   （テンプレートのまま=中身が空の間は、うっかり真っ白な画面に飛ばないよう、
  //   下の通常の世間話にフォールバックする）
  if (chapter2Unlockable && typeof CHAPTER2_IMPLEMENTED !== "undefined" && CHAPTER2_IMPLEMENTED) {
    // ★シナリオビルドで第二話にブロックが追加されていれば、そちらを優先して本編として実行する
    const overridden = typeof tryRunBuiltinChapterOverride === "function" && await tryRunBuiltinChapterOverride("builtin_chapter2");
    if (overridden) return;
    if (typeof startScene2 === "function") {
      // ★ブロックが1つも無く、元のscenario2.jsをそのまま使う場合も、目標表示のON/OFF判定用に
      //   「始まった」ことを記録しておく（tryRunBuiltinChapterOverride側は内部で記録済み）
      if (chapter2Entry) { chapter2Entry.started = true; if (typeof saveCustomScenarioData === "function") saveCustomScenarioData(); }
      await startScene2(); // scenario2.js
      return;
    }
  }
  
  const topic = TAVERN_TOPICS[Math.floor(Math.random() * TAVERN_TOPICS.length)];
  
  // ★自作の話（第一話・第二話以外）で解放条件を満たしているものがあれば、世間話より優先して始める
  if (typeof checkAndAutoRunNextCustomChapter === "function" && await checkAndAutoRunNextCustomChapter("tavern", currentLocationKey)) return;
  
  await displayMessage(topic);
  openTavern();
}

// クエスト掲示板の中身（一覧・詳細・ランクフィルタ・受注処理）は questboard.js にまとめてある

// ===== 宿屋：お金を払って休む =====
const INN_STAY_COST = 200;

function openInn() {
  currentLocationKey = "inn"; // ★セーブ/ロードで現在地を復元するための記録
  showLocationMenu([
    { label: `泊まる（${INN_STAY_COST}陳）`, action: () => stayAtInn() },
    { label: "戻る", action: () => openTownMenu() }
  ], "宿屋");
}

async function stayAtInn() {
  hideLocationMenu();
  changeSpeaker("宿の主人");
  
  if (gold < INN_STAY_COST) {
    await displayMessage("「すまないね、その持ち金じゃ今日は泊めてやれないな……」");
    openInn();
    return;
  }
  
  changeGold(-INN_STAY_COST); // inventory.js
  await displayMessage(`「はいよ、${INN_STAY_COST}陳いただくよ。ゆっくり休んでいきな。」`);
  
  // ★HP・SP・疲労度・眠気を全て全回復する
  changeGauge("hp", player.gauges.hp.max);
  changeGauge("sp", player.gauges.sp.max);
  changeGauge("fatigue", -player.gauges.fatigue.max);
  changeGauge("sleepiness", -player.gauges.sleepiness.max);
  // ★仲間も一緒に泊まっているはずなので、主人公と同じくHP・SPを全回復する
  //   ★バグ修正：戦闘不能だった仲間のalive（戦闘不能状態）を戻していなかったため、
  //   HP・SPの数値は全回復するのに戦闘不能のままになってしまっていた
  (player.companions || []).forEach(companion => {
    companion.alive = true;
    companion.gauges.hp.current = companion.gauges.hp.max;
    companion.gauges.sp.current = companion.gauges.sp.max;
  });
  advanceGameTime(8); // ★ひと晩の睡眠で8時間進める
  renderStatusHUD();
  
  changeSpeaker("");
  await displayMessage("ぐっすりと眠り、目覚める頃にはすっかり体力も気力も回復していた。");
  
  openTownMenu();
}

// ===== 施設編集タブで追加した独自施設（宿系・役場系・その他） =====
// ★returnTo：この施設から「戻る」を選んだ時に呼ぶ関数。省略時は今まで通りカリの村（openTownMenu）に戻る。
//   ★以前は必ずopenTownMenuに固定だったため、カデリクの街など村以外の拠点にある施設に入ると、
//     「戻る」を押しても村に飛ばされてしまい、その拠点の施設一覧に戻れない不具合があった
async function openCustomFacility(facility, returnTo) {
  const goBack = typeof returnTo === "function" ? returnTo : openTownMenu;
  currentLocationKey = "facility_" + facility.id; // ★セーブ/ロードで現在地を復元するための記録
  if (facility.bgImage) setBackgroundImage(facility.bgImage);
  if (facility.bgTrack && typeof switchScenarioBGM === "function") switchScenarioBGM(facility.bgTrack, { fadeMs: 600 });
  
  if (facility.type === "inn" || facility.type === "townhall") {
    hideLocationMenu();
    await runFacilityDialogueBlocks(facility, facility.enterBlocks, facility.ownerDialogue); // ★入った時のセリフ（施設に入った最初の1回だけ流す）
    showCustomFacilityMenu(facility, goBack);
    return;
  }
  
  if (facility.type === "blacksmith") {
    hideLocationMenu();
    await runFacilityDialogueBlocks(facility, facility.enterBlocks, facility.ownerDialogue); // ★入った時のセリフ
    await openCraftingShop(facility, "blacksmith", goBack); // crafting.js
    return;
  }
  
  if (facility.type === "synthesis") {
    hideLocationMenu();
    await runFacilityDialogueBlocks(facility, facility.enterBlocks, facility.ownerDialogue); // ★入った時のセリフ
    await openCraftingShop(facility, "synthesis", goBack); // crafting.js
    return;
  }
  
  if (facility.type === "tavern") {
    hideLocationMenu();
    await runFacilityDialogueBlocks(facility, facility.enterBlocks, facility.ownerDialogue); // ★入った時のセリフ（施設に入った最初の1回だけ流す）
    tavernReturnTo = goBack;
    openTavern();
    return;
  }
  
  // ★バグ修正：店タイプの施設だけこの分岐が無く、「その他（flavor）」扱いになってしまっていた。
  //   拠点（村・街・国）にアタッチした店は、openCustomSettlementArea側で先に振り分けてから
  //   openCustomShopFacilityへ渡すため問題にならないが、敵エリアの「調べる」で見つかる店
  //   （area.facilitySpawns）は、そのままこの関数（openCustomFacility）へ渡されるため、
  //   店の入店セリフが流れるだけで実際の売買画面が開かず、戻ってしまう不具合の原因になっていた
  if (facility.type === "shop") {
    hideLocationMenu();
    await openCustomShopFacility(facility, goBack); // town.js（入店セリフ・特典判定・売買画面はこちらでまとめて行う）
    return;
  }
  
  // ★その他（flavor）：セリフを見せるだけ
  hideLocationMenu();
  await runFacilityDialogueBlocks(facility, facility.enterBlocks, facility.ownerDialogue || "……特に何も無いようだ。");
  goBack();
}

// ★施設の「行動選択メニュー」だけを出し直す（入った時のセリフ＝enterBlocksは再生しない）。
//   お金が足りない等でボタン操作をキャンセルして施設内に留まる時は、必ずこちらを使うこと。
//   以前はキャンセル時にopenCustomFacility()を呼び直していたため、そのたびにenterBlocksの
//   セリフ（宿なら入店セリフ、役場なら受付セリフ）が毎回流れてしまう不具合があった。
function showCustomFacilityMenu(facility, goBack) {
  hideLocationMenu();
  if (facility.type === "inn") {
    showLocationMenu([
      { label: `泊まる（${facility.price || 0}陳）`, action: () => stayAtCustomInn(facility, goBack) },
      { label: "戻る", action: () => goBack() }
    ], facility.name || "宿");
    return;
  }
  
  if (facility.type === "townhall") {
    showLocationMenu([
      { label: `職業を変更する（${facility.classChangeCost || 0}陳）`, action: () => useTownhallClassChange(facility, goBack) },
      { label: "戻る", action: () => goBack() }
    ], facility.name || "役場");
    return;
  }
}

async function stayAtCustomInn(facility, returnTo) {
  const goBack = typeof returnTo === "function" ? returnTo : openTownMenu;
  hideLocationMenu();
  changeSpeaker(facility.name || "宿の主人");
  
  const price = facility.price || 0;
  if (gold < price) {
    await displayMessage("すまないね、その持ち金じゃ今日は泊めてやれないな……");
    showCustomFacilityMenu(facility, goBack); // ★enterBlocksを再生しないメニュー再表示（入店セリフの重複再生バグ修正）
    return;
  }
  
  changeGold(-price); // inventory.js
  await runFacilityDialogueBlocks(facility, facility.paidBlocks, null); // ★お金を払った後のセリフ
  
  // ★宿である以上、組み込みの宿屋（stayAtInn）と同じくHP・SPも全回復する。
  //   以前はここが抜けており、施設編集で作った宿に泊まってもHP・SPが回復しない不具合があった。
  //   疲労度・眠気は、これまで通り施設ごとに設定した回復量ぶんだけ軽減する
  changeGauge("hp", player.gauges.hp.max);
  changeGauge("sp", player.gauges.sp.max);
  changeGauge("fatigue", -(facility.fatigueRecovery || 0));
  changeGauge("sleepiness", -(facility.sleepinessRecovery || 0));
  // ★仲間も一緒に泊まっているはずなので、主人公と同じくHP・SPを全回復する
  //   ★バグ修正：戦闘不能だった仲間のalive（戦闘不能状態）を戻していなかったため、
  //   HP・SPの数値は全回復するのに戦闘不能のままになってしまっていた
  (player.companions || []).forEach(companion => {
    companion.alive = true;
    companion.gauges.hp.current = companion.gauges.hp.max;
    companion.gauges.sp.current = companion.gauges.sp.max;
  });
  advanceGameTime(8); // ★ひと晩の睡眠で8時間進める
  renderStatusHUD();
  
  await runFacilityDialogueBlocks(facility, facility.morningBlocks, "ひと晩休み、いくらか体が軽くなった気がする。"); // ★一夜明けた後のセリフ
  
  goBack();
}

// ★役場での職業変更。以前は「元の職業（baseClass）に戻す」処理しか無く、
//   常にplayer.baseClassとしか比較・変更しなかったため、既にbaseClassの状態で
//   訪れると常に「もう〜のようだが」と言われて何もできなかった（class Change自体が事実上機能していなかった）。
//   ここでCLASS_MASTERに定義された職業から選ばせる、本来の「職業を変更する」処理に直す
async function useTownhallClassChange(facility, returnTo) {
  const goBack = typeof returnTo === "function" ? returnTo : openTownMenu;
  hideLocationMenu();
  changeSpeaker(facility.name || "役場の職員");
  
  const cost = facility.classChangeCost || 0;
  // ★施設編集タブでこの役場向けに職業をチェックしていれば、そこに絞り込む（要望対応）。
  //   何もチェックしていなければ、今まで通り全職業が対象
  const allowedNames = Array.isArray(facility.allowedClassNames) && facility.allowedClassNames.length > 0
    ? facility.allowedClassNames : null;
  const classNames = Object.keys(CLASS_MASTER).filter(name => {
    if (name === player.class) return false;
    if (allowedNames && !allowedNames.includes(name)) return false;
    // ★上級職・天職は、対応する解放フラグがONになっていないと選べない（要望対応）
    const cls = CLASS_MASTER[name];
    if (cls && (cls.type === "advanced" || cls.type === "master") && cls.unlockFlagName) {
      if (!(typeof scenarioFlags !== "undefined" && scenarioFlags[cls.unlockFlagName])) return false;
    }
    return true;
  });
  if (classNames.length === 0) {
    await displayMessage("今のところ、他に変更できる職業が無いようだ……");
    showCustomFacilityMenu(facility, goBack); // ★enterBlocksを再生しないメニュー再表示（受付セリフの重複再生バグ修正）
    return;
  }
  
  if (facility.ownerDialogue) await displayMessage(facility.ownerDialogue);
  
  changeSpeaker("");
  const choices = classNames.map(name => {
    const known = player.classLevels && (name in player.classLevels);
    return { text: known ? `${name}（Lv.${player.classLevels[name]}から再開）` : `${name}（はじめて）`, next: name };
  });
  choices.push({ text: "やめる", next: "cancel", isBack: true });
  await displayMessage(`どの職業に変わる？（費用：${cost}陳）`);
  const picked = await displayChoices(choices);
  if (picked.next === "cancel") {
    showCustomFacilityMenu(facility, goBack); // ★enterBlocksを再生しないメニュー再表示（受付セリフの重複再生バグ修正）
    return;
  }
  
  if (gold < cost) {
    await displayMessage("すまないが、その持ち金では手続きができないようだ……");
    showCustomFacilityMenu(facility, goBack); // ★enterBlocksを再生しないメニュー再表示（受付セリフの重複再生バグ修正）
    return;
  }
  
  const confirmed = await showGameConfirm(`${cost}陳を払って、職業を「${picked.next}」に変更しますか？`); // mainfunc.js
  if (!confirmed) {
    showCustomFacilityMenu(facility, goBack); // ★enterBlocksを再生しないメニュー再表示（受付セリフの重複再生バグ修正）
    return;
  }
  
  changeGold(-cost);
  const result = switchPlayerClass(picked.next); // player.js
  renderStatusHUD();
  
  changeSpeaker(facility.name || "役場の職員");
  if (result.success) {
    const levelNote = result.isNewClass ? "" : `（以前の続きで Lv.${result.newLevel} から再開だ）`;
    await displayMessage(`手続きが完了した。今日から「${player.class}」だ${levelNote}。`);
  } else {
    await displayMessage("手続きがうまくいかなかったようだ……");
  }
  
  goBack();
}

// 個数を選ばせる共通処理（買取・購入で共通利用）。専用のミニ画面（#quantity-picker）で±調整する。
// ★以前はdisplayChoices（文章の選択肢）を使い回していたため、＋1/－1のたびにメッセージが再表示されて
//   もっさりしていた上、←→キーがchoice-box共通のページ送りに取られてしまい、個数調整には使えなかった。
//   専用のポップアップに変更し、この間だけ←→キーを個数の増減に割り当てるようにした
function pickQuantity(maxQty, itemLabel) {
  if (maxQty <= 0) return Promise.resolve(0);
  if (maxQty === 1) return Promise.resolve(1); // 1個しか対象が無いなら、わざわざ選ばせない
  
  return new Promise((resolve) => {
    let qty = 1;
    const overlay = document.getElementById("quantity-picker");
    const labelEl = document.getElementById("quantity-picker-label");
    const valueEl = document.getElementById("quantity-picker-value");
    const decBtn = document.getElementById("quantity-picker-dec");
    const incBtn = document.getElementById("quantity-picker-inc");
    const confirmBtn = document.getElementById("quantity-picker-confirm");
    const cancelBtn = document.getElementById("quantity-picker-cancel");
    
    function render() {
      if (labelEl) labelEl.textContent = itemLabel ? `${itemLabel}（最大${maxQty}個）` : `個数（最大${maxQty}個）`;
      if (valueEl) valueEl.textContent = `${qty}個`;
      if (decBtn) decBtn.disabled = qty <= 1;
      if (incBtn) incBtn.disabled = qty >= maxQty;
    }
    
    function finish(result) {
      if (overlay) overlay.classList.add("hidden");
      window.removeEventListener("keydown", handleKey);
      resolve(result);
    }
    
    function handleKey(event) {
      if (typeof isScenarioBuildOverlayOpen !== "undefined" && isScenarioBuildOverlayOpen) return; // ★要望対応：シナリオエディタ表示中は本編を操作させない
      if (typeof isGameDialogOpen !== "undefined" && isGameDialogOpen) return;
      if (event.repeat) return;
      if (event.key === "ArrowRight") {
        event.preventDefault(); event.stopImmediatePropagation();
        qty = Math.min(maxQty, qty + 1); render();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault(); event.stopImmediatePropagation();
        qty = Math.max(1, qty - 1); render();
      } else if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.decideKeys.includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        finish(qty);
      } else if (typeof KEY_CONFIG !== "undefined" && KEY_CONFIG.cancelKeys.includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        finish(0);
      }
    }
    
    if (decBtn) decBtn.onclick = (event) => { event.stopPropagation(); qty = Math.max(1, qty - 1); render(); };
    if (incBtn) incBtn.onclick = (event) => { event.stopPropagation(); qty = Math.min(maxQty, qty + 1); render(); };
    if (confirmBtn) confirmBtn.onclick = (event) => { event.stopPropagation(); finish(qty); };
    if (cancelBtn) cancelBtn.onclick = (event) => { event.stopPropagation(); finish(0); };
    
    render();
    if (overlay) overlay.classList.remove("hidden");
    window.addEventListener("keydown", handleKey);
  });
}

// ===== 買取屋：所持アイテムを売ってお金にする =====
async function openBuyShop(returnTo) {
  const goBack = typeof returnTo === "function" ? returnTo : openShopMenu;
  currentLocationKey = "shop_buy"; // ★セーブ/ロードで現在地を復元するための記録
  hideLocationMenu();
  
  // ★同じアイテムIDはまとめて1つの選択肢にする。装備中のものと、売値が付いていないもの（お礼の品など）は除外
  const sellableEntries = [];
  const seenItemIds = new Set();
  const equippedInstanceIds = Object.values(player.equipment).filter(Boolean); // ★今は装備欄にinstanceIdが入っている
  
  inventorySlots.forEach((slot) => {
    if (!slot || seenItemIds.has(slot.itemId)) return;
    const master = ITEM_MASTER[slot.itemId];
    if (!master || !(master.listedPrice > 0) || master.unsellable) return; // ★アイテム管理で「売れない」チェックが付いているものは対象外にする
    if (equippedInstanceIds.includes(slot.instanceId)) return;
    seenItemIds.add(slot.itemId);
    
    const totalQty = inventorySlots
      .filter(s => s && s.itemId === slot.itemId)
      .reduce((sum, s) => sum + s.quantity, 0);
    const basePrice = slot.appraised ? master.trueValue : Math.round(master.listedPrice * 0.7); // ★鑑定済みなら真価、未鑑定なら定価の7割で売れる
    const sellBonus = (typeof hasPassiveSkill === "function" && hasPassiveSkill("sellBonus")) ? 1.15 : 1; // ★お宝鑑定団の「算盤高き目利き」（player.js）
    const price = Math.round(basePrice * sellBonus);
    sellableEntries.push({ itemId: slot.itemId, master, price, totalQty });
  });
  
  if (sellableEntries.length === 0) {
    changeSpeaker("買取屋の主人");
    await displayMessage("「悪いが、うちで買い取れそうな物は持っていないようだな。」");
    goBack();
    return;
  }
  
  const choices = sellableEntries.map(entry => ({
    text: `${entry.master.name} ×${entry.totalQty}（1個 ${entry.price}陳）`,
    next: entry.itemId
  }));
  choices.push({ text: "戻る", next: "back", isBack: true });
  
  changeSpeaker("買取屋の主人");
  // ★displayMessageを挟まずdisplayChoicesだけを呼ぶと、テキスト欄が前の場面の
  //   メッセージを表示したまま残ってしまう（残留バグ）ので、必ず一度ここで更新しておく
  await displayMessage("「さて、何を売ってくれるんだ？」");
  const picked = await displayChoices(choices);
  if (picked.next === "back") {
    goBack();
    return;
  }
  
  const entry = sellableEntries.find(e => e.itemId === picked.next);
  const qty = await pickQuantity(entry.totalQty, entry.master ? entry.master.name : entry.itemId); // ★まとめて売れるように個数を選ばせる
  if (qty <= 0) {
    openBuyShop(goBack);
    return;
  }
  
  removeItem(entry.itemId, qty); // inventory.js
  const totalPrice = entry.price * qty;
  changeGold(totalPrice); // inventory.js
  renderStatusHUD();
  await displayMessage(`「${entry.master.name}」を${qty}個、${totalPrice}陳で買い取った。`);
  
  openBuyShop(goBack); // ★続けて売れるように、一覧に戻る
}

// ===== 武器屋・防具屋・道具屋：新品のアイテムをお金で買う =====
// ★どの店もほぼ同じ処理なので共通化してある。categoryFilterで扱う品揃えを絞る
async function openGenericBuyShop(categoryFilter, locationKey, npcLabel) {
  currentLocationKey = locationKey; // ★セーブ/ロードで現在地を復元するための記録
  hideLocationMenu();
  
  // ★定価(listedPrice)が設定されているものだけを商品として扱う。アイテム編集タブで編集できる「定価」がそのまま店の値段になる
  const stockEntries = Object.keys(ITEM_MASTER)
    .filter(itemId => {
      const master = ITEM_MASTER[itemId];
      return categoryFilter(master.category) && master.listedPrice > 0;
    })
    .map(itemId => ({ itemId, master: ITEM_MASTER[itemId] }));
  
  if (stockEntries.length === 0) {
    changeSpeaker(npcLabel);
    await displayMessage("「すまないな、今は売り物を切らしているんだ。」");
    openShopMenu();
    return;
  }
  
  const choices = stockEntries.map(entry => ({
    text: `${entry.master.name}（${entry.master.listedPrice}陳）`,
    next: entry.itemId
  }));
  choices.push({ text: "戻る", next: "back", isBack: true });
  
  changeSpeaker(npcLabel);
  // ★displayMessageを挟まずdisplayChoicesだけを呼ぶと、テキスト欄が前の場面の
  //   メッセージを表示したまま残ってしまう（残留バグ）ので、必ず一度ここで更新しておく
  await displayMessage("「何か入り用かい？」");
  const picked = await displayChoices(choices);
  if (picked.next === "back") {
    openShopMenu();
    return;
  }
  
  const entry = stockEntries.find(e => e.itemId === picked.next);
  if (gold < entry.master.listedPrice) {
    await displayMessage("「持ち金が足りないようだな。」");
    openGenericBuyShop(categoryFilter, locationKey, npcLabel);
    return;
  }
  
  // ★まとめて買えるように個数を選ばせる（持ち金で買える範囲・最大10個まで）
  const affordableMax = Math.min(10, Math.floor(gold / entry.master.listedPrice));
  const qty = await pickQuantity(affordableMax, entry.master.name);
  if (qty <= 0) {
    openGenericBuyShop(categoryFilter, locationKey, npcLabel);
    return;
  }
  
  const totalPrice = entry.master.listedPrice * qty;
  changeGold(-totalPrice); // inventory.js
  addItem(entry.itemId, qty, { noStatBonus: true }); // inventory.js（★店で買った装備は個体差±0にする）
  renderStatusHUD();
  await displayMessage(`「${entry.master.name}」を${qty}個、${totalPrice}陳で買った。`);
  
  openGenericBuyShop(categoryFilter, locationKey, npcLabel); // ★続けて買えるように、一覧に戻る
}

function openWeaponShop() {
  openGenericBuyShop(category => category === "weapon", "shop_weapon", "武器屋の店主");
}

function openArmorShop() {
  openGenericBuyShop(category => category === "armor", "shop_armor", "防具屋の店主");
}

// ★道具屋は「薬草」「ポーション」のうち、buyPriceが設定された弱いサポートアイテムのみを扱う
function openItemShop() {
  openGenericBuyShop(category => category === "herb" || category === "potion" || category === "tool", "shop_item", "道具屋の店主");
}

// ★「冒険する」の中身（洞窟/草原の探索）は adventure.js に実装してある