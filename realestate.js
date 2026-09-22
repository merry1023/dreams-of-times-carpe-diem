// realestate.js
// 不動産システム（フェーズ1）：不動産屋系施設での家・店の購入（一括／ローン）・賃貸契約、
// 7日ごとの請求（ローン／家賃）、滞納時の入場不可＆請求停止、不動産屋での滞納分の返済手続き。
// ★対象エリアは、マップ設定タブでarea.typeを「estateHouse」「不動産：家」または
//   「estateShop」「不動産：店」にしたもの（mapareas.js）。購入するまでは自動で付与される
//   解放条件「propertyOwned」（adventuremap.js）によって地図上「？」表示・入場不可になる。

const REAL_ESTATE_BILLING_INTERVAL_DAYS = 7; // ★ローン・家賃とも、7日ごとに請求
const REAL_ESTATE_LOAN_INSTALLMENT_OPTIONS = [2, 3, 5, 10, 20]; // ★選べる分割回数

// ★利息率(%) = 分割回数 × 2.5%（上限50%）
function realEstateInterestRatePercent(installments) {
  return Math.min(50, installments * 2.5);
}

// ★ローンの合計支払額（利息込み）
function realEstateLoanTotalWithInterest(principal, installments) {
  const rate = realEstateInterestRatePercent(installments);
  return Math.round(principal * (1 + rate / 100));
}

// ★1回あたりの支払額（端数切り上げ。最終回は端数調整して帳尻を合わせる）
function realEstatePerInstallmentAmount(principal, installments) {
  return Math.ceil(realEstateLoanTotalWithInterest(principal, installments) / installments);
}

// ★エリアオブジェクトから、ownedPropertiesのキーに使う一意なlocationKeyを得る
function getEstateAreaKey(area) {
  return area.builtin ? area.locationKey : ("custom_" + area.id);
}

function findEstateAreaByKey(key) {
  if (typeof scenarioProject === "undefined" || !Array.isArray(scenarioProject.mapAreas)) return null;
  return scenarioProject.mapAreas.find(a => getEstateAreaKey(a) === key) || null;
}

function ensurePlayerProperties() {
  if (!player) return;
  if (!player.ownedProperties || typeof player.ownedProperties !== "object") player.ownedProperties = {};
  if (!Array.isArray(player.pendingRealEstateNotices)) player.pendingRealEstateNotices = [];
}

function isPropertyOwned(key) {
  ensurePlayerProperties();
  return !!(player && player.ownedProperties[key]);
}

function isPropertyOverdue(key) {
  ensurePlayerProperties();
  const rec = player && player.ownedProperties[key];
  return !!(rec && rec.overdue);
}

// ★このエリアに実際に入れるか（＝購入・契約済み、かつ滞納中でない）。adventuremap.jsのpropertyOwned条件から呼ばれる
function isPropertyAccessible(key) {
  return isPropertyOwned(key) && !isPropertyOverdue(key);
}

// ===================================================================
// ===== 日次処理：ゲーム内で日付が変わるたびにplayer.jsから呼ばれる =====
// ===================================================================
function processRealEstateDailyTick() {
  ensurePlayerProperties();
  if (!player) return;
  Object.keys(player.ownedProperties).forEach(key => {
    const rec = player.ownedProperties[key];
    if (!rec || rec.overdue) return; // ★滞納中は新たな請求が来ない（それ以上借金が増えない）
    
    if (rec.loan && rec.loan.remainingInstallments > 0 && player.daysSinceTransfer >= rec.loan.nextDueDay) {
      billRealEstateLoanInstallment(key, rec);
    }
    if (rec.rent && player.daysSinceTransfer >= rec.rent.nextDueDay) {
      billRealEstateRent(key, rec);
    }
  });
}

function billRealEstateLoanInstallment(key, rec) {
  const area = findEstateAreaByKey(key);
  const areaName = (area && area.name) || "物件";
  // ★最終回は端数調整して、支払い残額ぴったりで完済できるようにする
  const isLastInstallment = rec.loan.remainingInstallments <= 1;
  const amount = isLastInstallment ? rec.loan.remainingTotal : rec.loan.perInstallmentAmount;
  
  if (typeof gold !== "undefined" && gold >= amount) {
    changeGold(-amount); // inventory.js
    rec.loan.remainingTotal = Math.max(0, (rec.loan.remainingTotal || amount) - amount);
    rec.loan.remainingInstallments -= 1;
    if (rec.loan.remainingInstallments <= 0) {
      rec.loan = null; // ★完済
      player.pendingRealEstateNotices.push(`「${areaName}」のローンを完済した！`);
    } else {
      rec.loan.nextDueDay = player.daysSinceTransfer + REAL_ESTATE_BILLING_INTERVAL_DAYS;
    }
    if (typeof renderStatusHUD === "function") renderStatusHUD();
  } else {
    rec.overdue = true;
    rec.loan.overdueAmount = amount;
    player.pendingRealEstateNotices.push(`「${areaName}」のローンの支払い（${amount}陳）が滞り、入れなくなってしまった……`);
  }
}

function billRealEstateRent(key, rec) {
  const area = findEstateAreaByKey(key);
  const areaName = (area && area.name) || "物件";
  const amount = rec.rent.amount || 0;
  
  if (typeof gold !== "undefined" && gold >= amount) {
    changeGold(-amount); // inventory.js
    rec.rent.nextDueDay = player.daysSinceTransfer + REAL_ESTATE_BILLING_INTERVAL_DAYS;
    if (typeof renderStatusHUD === "function") renderStatusHUD();
  } else {
    rec.overdue = true;
    rec.rent.overdueAmount = amount;
    player.pendingRealEstateNotices.push(`「${areaName}」の家賃（${amount}陳）が滞り、入れなくなってしまった……`);
  }
}

// ★村に戻った時などに呼ばれ、溜まった滞納通知をまとめて見せる（town.js openTownMenuから呼ぶ）
async function flushRealEstateNotices() {
  ensurePlayerProperties();
  if (!player || !player.pendingRealEstateNotices || player.pendingRealEstateNotices.length === 0) return;
  const notices = player.pendingRealEstateNotices.slice();
  player.pendingRealEstateNotices = [];
  changeSpeaker("");
  for (const text of notices) {
    await displayMessage(text);
  }
}

// ===================================================================
// ===== 不動産屋の店頭UI =====
// ===================================================================
async function openRealEstateFacility(facility, goBack) {
  ensurePlayerProperties();
  const propertyKeys = Array.isArray(facility.propertyAreaIds) ? facility.propertyAreaIds : [];
  const areas = propertyKeys.map(key => ({ key, area: findEstateAreaByKey(key) })).filter(e => e.area);
  
  if (areas.length === 0) {
    changeSpeaker(facility.name || "");
    await displayMessage("……今のところ、取り扱っている物件は無いようだ。");
    goBack();
    return;
  }
  
  await showRealEstatePropertyList(facility, areas, goBack);
}

async function showRealEstatePropertyList(facility, areas, goBack) {
  changeSpeaker(facility.name || "");
  const choices = areas.map(({ key, area }) => {
    const rec = player.ownedProperties[key];
    let statusLabel;
    if (rec && rec.overdue) {
      statusLabel = "【滞納中】";
    } else if (rec) {
      statusLabel = "【契約済み】";
    } else if (area.type === "estateShop" && area.estateMode === "rent") {
      statusLabel = `（賃貸・家賃${area.estateRentAmount || 0}陳/7日）`;
    } else {
      statusLabel = `（${area.estatePrice || 0}陳）`;
    }
    return { text: `${area.name || "（名前未設定）"}　${statusLabel}`, next: key };
  });
  choices.push({ text: "やめる", next: "cancel", isBack: true });
  
  await displayMessage("どの物件について話を聞く？");
  const picked = await displayChoices(choices);
  if (picked.next === "cancel") {
    goBack();
    return;
  }
  
  const entry = areas.find(e => e.key === picked.next);
  await openRealEstatePropertyDetail(facility, areas, entry.key, entry.area, goBack);
}

async function openRealEstatePropertyDetail(facility, areas, key, area, goBack) {
  const backToList = () => showRealEstatePropertyList(facility, areas, goBack);
  ensurePlayerProperties();
  const rec = player.ownedProperties[key];
  changeSpeaker(facility.name || "");
  
  // ★滞納中：滞納分だけ払えば再開できる（ローン自体の残額はそのまま）
  if (rec && rec.overdue) {
    const overdueAmount = (rec.loan && rec.loan.overdueAmount) || (rec.rent && rec.rent.overdueAmount) || 0;
    const confirmed = await showGameConfirm(`「${area.name}」は滞納中です。滞納分の${overdueAmount}陳を支払って再開しますか？（ローン・家賃自体の残りはそのままです）`);
    if (!confirmed) {
      await backToList();
      return;
    }
    if (typeof gold === "undefined" || gold < overdueAmount) {
      await displayMessage("すまないが、その持ち金では払いきれないようだ……");
      await openRealEstatePropertyDetail(facility, areas, key, area, goBack);
      return;
    }
    changeGold(-overdueAmount);
    rec.overdue = false;
    if (rec.loan) { rec.loan.overdueAmount = 0; rec.loan.nextDueDay = player.daysSinceTransfer + REAL_ESTATE_BILLING_INTERVAL_DAYS; }
    if (rec.rent) { rec.rent.overdueAmount = 0; rec.rent.nextDueDay = player.daysSinceTransfer + REAL_ESTATE_BILLING_INTERVAL_DAYS; }
    if (typeof renderStatusHUD === "function") renderStatusHUD();
    await displayMessage(`滞納分を支払った。「${area.name}」にまた入れるようになった。`);
    await backToList();
    return;
  }
  
  // ★契約済み（滞納なし）：状況を見せるだけ
  if (rec) {
    let statusText = `「${area.name}」は契約済みです。`;
    if (rec.loan) statusText += `\nローン残り：${rec.loan.remainingInstallments}回（次回請求：転移${rec.loan.nextDueDay}日目、${Math.min(rec.loan.perInstallmentAmount, rec.loan.remainingTotal)}陳）`;
    else if (rec.rent) statusText += `\n家賃：7日ごとに${rec.rent.amount}陳（次回請求：転移${rec.rent.nextDueDay}日目）`;
    else statusText += "\n支払いは完了しています。";
    await displayMessage(statusText);
    await backToList();
    return;
  }
  
  // ★未購入：賃貸 or 一括／ローン
  const isRentShop = area.type === "estateShop" && area.estateMode === "rent";
  if (isRentShop) {
    const confirmed = await showGameConfirm(`「${area.name}」を賃貸契約しますか？（家賃：7日ごとに${area.estateRentAmount || 0}陳。滞納すると入れなくなります）`);
    if (!confirmed) { await backToList(); return; }
    player.ownedProperties[key] = {
      areaId: key,
      paymentType: "rent",
      purchasedDay: player.daysSinceTransfer,
      loan: null,
      rent: { amount: area.estateRentAmount || 0, nextDueDay: player.daysSinceTransfer + REAL_ESTATE_BILLING_INTERVAL_DAYS, overdueAmount: 0 },
      overdue: false
    };
    if (typeof renderAdventureMap === "function") renderAdventureMap();
    await displayMessage(`「${area.name}」を賃貸契約した。`);
    await backToList();
    return;
  }
  
  const price = area.estatePrice || 0;
  const choices = [
    { text: `一括で購入する（${price}陳）`, next: "lump" },
    { text: "ローンで購入する", next: "loan" },
    { text: "やめる", next: "cancel", isBack: true }
  ];
  await displayMessage(`「${area.name}」の価格は${price}陳です。どう購入しますか？`);
  const picked = await displayChoices(choices);
  
  if (picked.next === "cancel") { await backToList(); return; }
  
  if (picked.next === "lump") {
    if (typeof gold === "undefined" || gold < price) {
      await displayMessage("すまないが、その持ち金では買えないようだ……");
      await openRealEstatePropertyDetail(facility, areas, key, area, goBack);
      return;
    }
    const confirmed = await showGameConfirm(`「${area.name}」を${price}陳で一括購入しますか？（売却はできません）`);
    if (!confirmed) { await openRealEstatePropertyDetail(facility, areas, key, area, goBack); return; }
    changeGold(-price);
    player.ownedProperties[key] = { areaId: key, paymentType: "lump", purchasedDay: player.daysSinceTransfer, loan: null, rent: null, overdue: false };
    if (typeof renderStatusHUD === "function") renderStatusHUD();
    if (typeof renderAdventureMap === "function") renderAdventureMap();
    await displayMessage(`「${area.name}」を購入した！`);
    await backToList();
    return;
  }
  
  // ★ローン：分割回数を選ばせる
  const loanChoices = REAL_ESTATE_LOAN_INSTALLMENT_OPTIONS.map(n => {
    const rate = realEstateInterestRatePercent(n);
    const total = realEstateLoanTotalWithInterest(price, n);
    const perPay = realEstatePerInstallmentAmount(price, n);
    return { text: `${n}回払い（利率${rate}%・合計${total}陳・1回${perPay}陳）`, next: String(n) };
  });
  loanChoices.push({ text: "やめる", next: "cancel", isBack: true });
  await displayMessage("分割回数を選んでください（回数が多いほど利率が上がります）：");
  const loanPicked = await displayChoices(loanChoices);
  if (loanPicked.next === "cancel") { await openRealEstatePropertyDetail(facility, areas, key, area, goBack); return; }
  
  const installments = Number(loanPicked.next);
  const total = realEstateLoanTotalWithInterest(price, installments);
  const perPay = realEstatePerInstallmentAmount(price, installments);
  const confirmed = await showGameConfirm(`${installments}回払いで契約しますか？（合計${total}陳、7日ごとに${perPay}陳ずつ請求されます。頭金は不要です）`);
  if (!confirmed) { await openRealEstatePropertyDetail(facility, areas, key, area, goBack); return; }
  
  player.ownedProperties[key] = {
    areaId: key,
    paymentType: "loan",
    purchasedDay: player.daysSinceTransfer,
    loan: {
      principal: price,
      installments,
      interestRatePercent: realEstateInterestRatePercent(installments),
      remainingInstallments: installments,
      remainingTotal: total,
      perInstallmentAmount: perPay,
      nextDueDay: player.daysSinceTransfer + REAL_ESTATE_BILLING_INTERVAL_DAYS,
      overdueAmount: 0
    },
    rent: null,
    overdue: false
  };
  if (typeof renderAdventureMap === "function") renderAdventureMap();
  await displayMessage(`「${area.name}」をローンで購入した。7日後から支払いが始まります。`);
  await backToList();
}
