// records.js
// ★要望対応：魔物の討伐数・見逃し数、釣りの記録（魚ごとの釣った数・最大サイズ）。
//   記録は player の中（player.monsterRecords / player.fishRecords）に入れるので、
//   セーブ・ロードでは player ごと自動的に保存・復元される（古いセーブは記録なし＝0扱い）。
//   追憶の館での再体験中の記録は、終了時にスナップショットへ戻るため残らない。

function ensureMonsterRecords() {
  if (typeof player === "undefined" || !player) return null;
  if (!player.monsterRecords || typeof player.monsterRecords !== "object") player.monsterRecords = {};
  return player.monsterRecords;
}

// kind: "killed"（倒した）| "spared"（見逃した）／count：その戦闘で出た同種の体数
function recordMonsterEncounter(monsterKey, kind, count) {
  const records = ensureMonsterRecords();
  if (!records || !monsterKey) return;
  if (!records[monsterKey]) records[monsterKey] = { killed: 0, spared: 0 };
  records[monsterKey][kind] = (records[monsterKey][kind] || 0) + Math.max(1, Number(count) || 1);
}

function getMonsterRecord(monsterKey) {
  const records = ensureMonsterRecords();
  const r = records && records[monsterKey];
  return { killed: (r && r.killed) || 0, spared: (r && r.spared) || 0 };
}

function ensureFishRecords() {
  if (typeof player === "undefined" || !player) return null;
  if (!player.fishRecords || typeof player.fishRecords !== "object") player.fishRecords = {};
  return player.fishRecords;
}

// ★釣れた魚の大きさ：魚管理タブの「大きさ」を基準に、個体差として±30%の幅で毎回変わる（最低1）
function rollFishSize(fishMaster) {
  const base = Number(fishMaster && fishMaster.size);
  if (!isFinite(base) || base <= 0) return null;
  return Math.max(1, Math.round(base * (0.7 + Math.random() * 0.6)));
}

// 釣り上げた時に呼ぶ。戻り値：{ size, isNewRecord }
function recordFishCatch(fishId, size) {
  const records = ensureFishRecords();
  if (!records || !fishId) return { size, isNewRecord: false };
  const prev = records[fishId] || { count: 0, maxSize: 0 };
  const isNewRecord = size != null && size > (prev.maxSize || 0) && (prev.count || 0) > 0;
  records[fishId] = { count: (prev.count || 0) + 1, maxSize: size != null ? Math.max(prev.maxSize || 0, size) : (prev.maxSize || 0) };
  return { size, isNewRecord };
}

function getFishRecord(fishId) {
  const records = ensureFishRecords();
  const r = records && records[fishId];
  return { count: (r && r.count) || 0, maxSize: (r && r.maxSize) || 0 };
}
