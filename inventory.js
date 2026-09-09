// inventory.js
// プレイヤーが実際に持っている在庫（インベントリ）をグリッド形式で管理するファイル。
// アイテムの「設計図」は items.js の ITEM_MASTER を参照する。
// ※ items.js より後に読み込むこと。

// ===== グリッド設定 =====
const GRID_COLS = 4;
const GRID_ROWS = 60;
const GRID_SIZE = GRID_COLS * GRID_ROWS; // 240マス

// スタック（積み重ね）できるカテゴリ。ここに無いカテゴリ（武器・防具など）は
// 装備・貴重品扱いで、1マスに1個しか置けない。
const STACKABLE_CATEGORIES = ["herb", "potion", "material", "tool"];
const MAX_STACK = 100;

// inventorySlots[i] は null（空きマス）か { itemId, quantity, appraised } のオブジェクト
let inventorySlots = new Array(GRID_SIZE).fill(null);

let gold = 0; // 所持金（陳）（初期所持金は0。序盤はクエスト報酬や買取で稼いでいく想定）

// ★装備品ごとの個体識別ID。武器・防具・貴重品を1個拾うたびに、これをインクリメントして払い出す
let nextEquipmentInstanceId = 1;

function isStackable(category) {
  return STACKABLE_CATEGORIES.includes(category);
}

// ★古いセーブデータ（instanceId導入前）を読み込んだ時のため：
//   instanceIdが無い装備・貴重品マスに、その場でIDを振り直す。
//   あわせて、ロードしたデータの中の最大instanceIdより後ろから採番を再開させる
//   （そうしないと、ロード後に新しく拾ったアイテムのIDが、セーブ内の既存IDと衝突してしまう）
function sanitizeInventoryInstanceIds() {
  let maxSeenId = 0;
  inventorySlots.forEach(slot => {
    if (slot && slot.instanceId !== undefined) {
      maxSeenId = Math.max(maxSeenId, slot.instanceId);
    }
  });
  if (nextEquipmentInstanceId <= maxSeenId) {
    nextEquipmentInstanceId = maxSeenId + 1;
  }
  inventorySlots.forEach(slot => {
    if (slot && slot.instanceId === undefined) {
      slot.instanceId = nextEquipmentInstanceId++;
    }
  });
}

/**
 * インベントリにアイテムを追加する
 * @param {string} itemId - ITEM_MASTER のキー
 * @param {number} quantity - 追加する個数（デフォルト1）
 * @returns {boolean} 全部入りきったら true、途中で満杯になったら false
 */
function addItem(itemId, quantity = 1, options = {}) {
  const master = ITEM_MASTER[itemId];
  if (!master) {
    console.error(`アイテムID「${itemId}」が ITEM_MASTER に存在しません`);
    return false;
  }
  
  if (isStackable(master.category)) {
    let remaining = quantity;
    
    // 1. 既存のスタックに空きがあれば、そこから埋めていく
    for (let i = 0; i < GRID_SIZE && remaining > 0; i++) {
      const slot = inventorySlots[i];
      if (slot && slot.itemId === itemId && slot.quantity < MAX_STACK) {
        const space = MAX_STACK - slot.quantity;
        const add = Math.min(space, remaining);
        slot.quantity += add;
        remaining -= add;
      }
    }
    
    // 2. まだ余っていたら、空きマスに新しいスタックを作る（100個ごとに区切る）
    while (remaining > 0) {
      const emptyIndex = inventorySlots.findIndex(s => s === null);
      if (emptyIndex === -1) {
        console.warn("インベントリが満杯です（これ以上入りません）");
        return false;
      }
      const add = Math.min(MAX_STACK, remaining);
      inventorySlots[emptyIndex] = { itemId, quantity: add, appraised: false };
      remaining -= add;
    }
    return true;
    
  } else {
    // 装備・貴重品などスタックしないアイテムは1マスに1個ずつ。
    // ★同じアイテムIDでも「どの1個か」を区別できるよう、それぞれにinstanceIdを振る
    //   （武器・防具の装備先も、これ以降はitemIdではなくinstanceIdで管理する）
    for (let i = 0; i < quantity; i++) {
      const emptyIndex = inventorySlots.findIndex(s => s === null);
      if (emptyIndex === -1) {
        console.warn("インベントリが満杯です（これ以上入りません）");
        return false;
      }
      inventorySlots[emptyIndex] = {
        itemId,
        quantity: 1,
        appraised: false,
        instanceId: nextEquipmentInstanceId++,
        // ★店で「買った」装備は、個体差の当たり外れが無いよう±0にする（options.noStatBonus）。
        //   冒険で拾った・敵が落とした装備だけ、掘り出し物のランダムな個体差がつく
        statBonus: options.noStatBonus ? null : rollEquipmentStatBonus(master)
      };
    }
    return true;
  }
}

// ★装備のステータスランダム変位：武器・防具は、拾うたびに（同じアイテムIDのものを何個持っていても
//   1個ずつ別々に）基本ステータス（攻撃力 or 最大HP）へランダムな変位が乗る。
//   変位の範囲はアイテム編集タブの「個体差の範囲」（master.statBonusRange）で指定でき、未指定なら従来通り±20。
//   お宝鑑定団は目利きが良いので、その範囲がさらに2倍に広がる（従来のお宝鑑定団±40相当）。
//   「錆びたシリーズ」（鑑定で性能が変わる）・専用スキル持ちの特別な装備（エクスカリバー等）は、
//   既に別のステータス変動システムを持っているので対象外（nullを返す＝ボーナス無し）
function rollEquipmentStatBonus(master) {
  if (master.category !== "weapon" && master.category !== "armor") return null;
  if (master.isRustySeries || master.battleSkill) return null;
  
  const statKey = master.params.攻撃力 !== undefined ? "攻撃力" : (master.params.最大HP !== undefined ? "最大HP" : null);
  if (!statKey) return null;
  
  const baseRange = (master.statBonusRange && typeof master.statBonusRange.min === "number" && typeof master.statBonusRange.max === "number") ?
    master.statBonusRange : { min: -20, max: 20 };
  const treasureMultiplier = (player && player.class === "お宝鑑定団") ? 2 : 1;
  const min = baseRange.min * treasureMultiplier;
  const max = baseRange.max * treasureMultiplier;
  const amount = min + Math.floor(Math.random() * (max - min + 1)); // min 〜 max
  
  return { statKey, amount, maxRange: max }; // ★maxRangeは「範囲の最大値を引いたかどうか」の判定（黄文字表示）に使う
}

/**
 * インベントリから指定した個数のアイテムを取り除く
 * @param {string} itemId
 * @param {number} quantity - 取り除く個数（デフォルト1）
 * @returns {boolean} 全部取り除けたら true
 */
function removeItem(itemId, quantity = 1) {
  let remaining = quantity;
  
  for (let i = 0; i < GRID_SIZE && remaining > 0; i++) {
    const slot = inventorySlots[i];
    if (slot && slot.itemId === itemId) {
      const remove = Math.min(slot.quantity, remaining);
      slot.quantity -= remove;
      remaining -= remove;
      if (slot.quantity <= 0) {
        inventorySlots[i] = null; // マスを空ける
      }
    }
  }
  
  return remaining === 0;
}

/**
 * 指定したinstanceIdの装備・貴重品を1個だけ取り除く（鍛冶屋・素材合成屋で「どの個体を消費するか」
 * ユーザーに選んでもらった時に使う。removeItem(itemId, quantity)と違い、狙った1個だけを確実に消費できる）
 * @param {number} instanceId
 * @returns {boolean} 取り除けたら true
 */
function removeItemInstance(instanceId) {
  const index = inventorySlots.findIndex(s => s && s.instanceId === instanceId);
  if (index === -1) return false;
  inventorySlots[index] = null;
  return true;
}

/**
 * 指定したマス番号の中身を取得する
 */
function getSlot(index) {
  return inventorySlots[index];
}

/**
 * 特定のアイテムが入っているマス番号を全部探す
 */
function findSlotsByItemId(itemId) {
  const result = [];
  inventorySlots.forEach((slot, index) => {
    if (slot && slot.itemId === itemId) result.push(index);
  });
  return result;
}

/**
 * 指定したマスのアイテムを鑑定済みにする（「なんでも鑑定」で使用予定）
 */
function markSlotAsAppraised(index) {
  const slot = inventorySlots[index];
  if (slot) slot.appraised = true;
}

/**
 * 所持金（陳）を増減させる
 * @param {number} amount - 正で加算、負で減算
 */
function changeGold(amount) {
  gold += amount;
  if (gold < 0) gold = 0;
}