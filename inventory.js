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
const STACKABLE_CATEGORIES = ["herb", "potion", "material", "tool", "fish", "food"]; // ★要望対応：釣った魚・料理タブで作った料理もスタック可能
const MAX_STACK = 100;

// inventorySlots[i] は null（空きマス）か { itemId, quantity, appraised } のオブジェクト
let inventorySlots = new Array(GRID_SIZE).fill(null);

let gold = 0; // 所持金（陳）（初期所持金は0。序盤はクエスト報酬や買取で稼いでいく想定）

// ★装備品ごとの個体識別ID。武器・防具・貴重品を1個拾うたびに、これをインクリメントして払い出す
let nextEquipmentInstanceId = 1;

// ★要望対応：インベントリの「入手順」並び替え用の連番。addItemで新しいスタック/個体ができるたびに払い出す
let nextInventoryAcquiredSeq = 1;

function isStackable(master) {
  if (!master) return false;
  if (master.category === "weapon" || master.category === "armor") return false; // ★装備は常にスタックしない
  // ★要望対応：アイテム管理で個別に指定されていればそれを優先し、無指定ならカテゴリの既定値に従う
  if (typeof master.stackable === "boolean") return master.stackable;
  return STACKABLE_CATEGORIES.includes(master.category);
}

// ★古いセーブデータ（instanceId導入前）を読み込んだ時のため：
//   instanceIdが無い装備・貴重品マスに、その場でIDを振り直す。
//   あわせて、ロードしたデータの中の最大instanceIdより後ろから採番を再開させる
//   （そうしないと、ロード後に新しく拾ったアイテムのIDが、セーブ内の既存IDと衝突してしまう）
function sanitizeInventoryInstanceIds() {
  let maxSeenId = 0;
  let maxSeenSeq = 0;
  inventorySlots.forEach(slot => {
    if (slot && slot.instanceId !== undefined) {
      maxSeenId = Math.max(maxSeenId, slot.instanceId);
    }
    if (slot && typeof slot.acquiredSeq === "number") {
      maxSeenSeq = Math.max(maxSeenSeq, slot.acquiredSeq);
    }
  });
  if (nextEquipmentInstanceId <= maxSeenId) {
    nextEquipmentInstanceId = maxSeenId + 1;
  }
  if (nextInventoryAcquiredSeq <= maxSeenSeq) {
    nextInventoryAcquiredSeq = maxSeenSeq + 1;
  }
  inventorySlots.forEach(slot => {
    if (slot && slot.instanceId === undefined) {
      slot.instanceId = nextEquipmentInstanceId++;
    }
    // ★要望対応：古いセーブデータ（acquiredSeq導入前）には、今並んでいる順番のまま連番を振っておく
    if (slot && typeof slot.acquiredSeq !== "number") {
      slot.acquiredSeq = nextInventoryAcquiredSeq++;
    }
    // ★要望対応：料理道具導入前のセーブデータには耐久度が無いので、アイテムマスターの初期値で補う（未設定なら既定値30）
    if (slot && slot.durability === undefined && ITEM_MASTER[slot.itemId] && ITEM_MASTER[slot.itemId].category === "cookingTool") {
      slot.durability = Math.max(1, Number(ITEM_MASTER[slot.itemId].toolDurability) || 30);
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
  
  if (isStackable(master)) {
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
      inventorySlots[emptyIndex] = { itemId, quantity: add, appraised: false, acquiredSeq: nextInventoryAcquiredSeq++ }; // ★要望対応：入手順並び替え用
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
        acquiredSeq: nextInventoryAcquiredSeq++, // ★要望対応：入手順並び替え用
        // ★店で「買った」装備は、個体差の当たり外れが無いよう±0にする（options.noStatBonus）。
        //   冒険で拾った・敵が落とした装備だけ、掘り出し物のランダムな個体差がつく
        statBonus: options.noStatBonus ? null : rollEquipmentStatBonus(master),
        // ★要望対応：料理道具は個体ごとに耐久度を持ち、使うたびに減っていき、0になると壊れて消える。
        //   耐久度を設定し忘れていても一瞬で壊れてしまわないよう、未設定時は既定値30を使う（アイテム編集欄のプレースホルダーと合わせる）
        durability: master.category === "cookingTool" ? Math.max(1, Number(master.toolDurability) || 30) : undefined
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
 * ★要望対応：料理道具の耐久度を指定した分だけ減らす（cooking.js から呼ぶ）。
 *   0以下になったら、その道具（個体）は壊れてインベントリから消える
 * @param {number} instanceId
 * @param {number} amount - 減らす量（0以下なら何もしない）
 * @returns {{ broke: boolean, remaining: number }} 壊れたかどうかと、壊れなかった場合の残り耐久度
 */
function reduceCookingToolDurability(instanceId, amount) {
  const index = inventorySlots.findIndex(s => s && s.instanceId === instanceId);
  if (index === -1 || amount <= 0) return { broke: false, remaining: 0 };
  const slot = inventorySlots[index];
  const remaining = Math.max(0, (Number(slot.durability) || 0) - amount);
  if (remaining <= 0) {
    inventorySlots[index] = null; // ★壊れて消える
    return { broke: true, remaining: 0 };
  }
  slot.durability = remaining;
  return { broke: false, remaining };
}

/**
 * 所持金（陳）を増減させる
 * @param {number} amount - 正で加算、負で減算
 */
function changeGold(amount) {
  gold += amount;
  if (gold < 0) gold = 0;
}