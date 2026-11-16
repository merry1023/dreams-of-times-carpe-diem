// effectmix_editor.js
// ===================================================================
// ===== シナリオエディタ「エフェクトミックス」タブ =====
// ===================================================================
// ★ベースエフェクト（弾・光線・爆発・リング…）を重ねて、1つの演出（ミックス）を作る。中身は scenarioProject.effectMixes。
//   作ったミックスは、タワーユニット／出撃キャラ／コンボスキルの「エフェクト」欄で選んで付ける（描く側は effectmix.js）。
// ★scenariobuild.js の共通部品（scenarioProject / pushUndoSnapshot / markScenarioBuildDirty / renderScenarioBuildPanel /
//   labelSpan / buildCollapsedEntryRow / showGameConfirm）と、tower_defense_editor.js の入力欄の部品（tdEditorFieldTools）を使う。

// 他のタブの「エフェクト」選択欄に出す選択肢（先頭＝付けない）
function efxEditorMixOptions() {
  const list = Array.isArray(scenarioProject.effectMixes) ? scenarioProject.effectMixes : [];
  return [{ value: "", label: "（標準の線・輪）" }].concat(list.filter(m => m).map(m => ({
    value: m.id, label: (m.name || "名無しのエフェクト") + (m.enabled === false ? "（無効）" : "")
  })));
}

function renderEffectMixManager(container) {
  if (!Array.isArray(scenarioProject.effectMixes)) scenarioProject.effectMixes = [];
  const introEl = document.createElement("p");
  introEl.className = "devmode-note";
  introEl.textContent = "ベースエフェクト（弾・光線・稲妻・爆発・リング・火花・光柱・渦）を重ねて、技の演出を作ります。レイヤーごとに、色・大きさ・開始のずれ・長さ・数・濃さを決められます。作ったエフェクトは、「タワーユニット」「出撃キャラ」「コンボスキル」のエフェクト欄で選ぶと、その技の演出になります（選ばなければ今まで通りの線と輪）。";
  container.appendChild(introEl);

  const addBtn = document.createElement("button");
  addBtn.className = "devmode-btn";
  addBtn.textContent = "＋エフェクトを追加";
  addBtn.onclick = () => {
    pushUndoSnapshot();
    scenarioProject.effectMixes.push(efxNewMix());
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  container.appendChild(addBtn);

  // ★最初の叩き台：標準のミックスのうち、同じ名前がまだ無いものを足す
  const missing = efxBuildDefaultMixes().filter(d => !scenarioProject.effectMixes.some(m => m && m.name === d.name));
  const seedBtn = document.createElement("button");
  seedBtn.className = "devmode-btn";
  seedBtn.textContent = scenarioProject.effectMixes.length === 0 ? "標準のエフェクトを登録する（炎・雷・氷・光・風・光線）" : `標準のエフェクトのうち、足りない分を追加する（${missing.length}件）`;
  seedBtn.disabled = missing.length === 0;
  seedBtn.title = missing.length === 0 ? "標準のエフェクトは、すべて登録済みです（名前で判定します）" : "同じ名前がまだ無い標準のエフェクトだけを、末尾に追加します";
  seedBtn.onclick = () => {
    pushUndoSnapshot();
    scenarioProject.effectMixes = scenarioProject.effectMixes.concat(missing);
    markScenarioBuildDirty();
    renderScenarioBuildPanel();
  };
  container.appendChild(seedBtn);

  if (scenarioProject.effectMixes.length === 0) {
    const emptyEl = document.createElement("p");
    emptyEl.className = "devmode-note";
    emptyEl.textContent = "まだ登録がありません。";
    container.appendChild(emptyEl);
  }
  scenarioProject.effectMixes.forEach((mix, index) => container.appendChild(buildCollapsedEntryRow({
    number: `#${index + 1}`,
    title: () => (scenarioProject.effectMixes[index] || {}).name,
    isValid: () => !!scenarioProject.effectMixes[index],
    build: () => buildEffectMixRow(scenarioProject.effectMixes[index], index)
  })));
}

function buildEffectMixRow(mix, index) {
  const list = scenarioProject.effectMixes;
  const persist = () => markScenarioBuildDirty();
  if (!Array.isArray(mix.layers)) mix.layers = [];
  const row = document.createElement("div");
  row.className = "scenariobuild-chapter-row";
  const idEl = document.createElement("span");
  idEl.className = "scenariobuild-chapter-number";
  idEl.textContent = `#${index + 1}`;
  row.appendChild(idEl);
  const infoEl = document.createElement("div");
  infoEl.className = "scenariobuild-chapter-info";
  const { addRow, textField, numberField, selectField } = tdEditorFieldTools(mix, infoEl, persist);

  const r1 = addRow();
  textField(r1, "name", "名前", "例：炎の爆発");
  const enabledLabel = document.createElement("label");
  enabledLabel.style.cursor = "pointer";
  const enabledCheckbox = document.createElement("input");
  enabledCheckbox.type = "checkbox";
  enabledCheckbox.checked = mix.enabled !== false;
  enabledCheckbox.onchange = () => { mix.enabled = enabledCheckbox.checked; persist(); };
  enabledLabel.appendChild(enabledCheckbox);
  enabledLabel.appendChild(document.createTextNode(" 有効（オフ＝付けていても、標準の線・輪になる）"));
  r1.appendChild(enabledLabel);

  // ===== プレビュー =====
  const previewBox = document.createElement("div");
  previewBox.className = "scenariobuild-condition-row";
  const canvas = document.createElement("canvas");
  canvas.width = 480; canvas.height = 240;
  canvas.style.cssText = "width:100%;max-width:480px;background:#10151c;border:1px solid #445;border-radius:6px;";
  previewBox.appendChild(canvas);
  infoEl.appendChild(previewBox);
  const pvRow = addRow();
  const elementOptions = [{ value: "", label: "（白）" }].concat((scenarioProject.elementDefs || []).map(el => ({ value: el.id, label: el.name || "（無名）" })));
  const pvState = { element: elementOptions.length > 1 ? elementOptions[1].value : "", loop: true };
  const pvTools = tdEditorFieldTools(pvState, infoEl, () => restart());   // プレビュー用の設定（mix のデータには書かない）
  pvTools.selectField(pvRow, "element", "プレビューの属性色", elementOptions);
  const loopLabel = document.createElement("label");
  loopLabel.style.cursor = "pointer";
  const loopCheckbox = document.createElement("input");
  loopCheckbox.type = "checkbox"; loopCheckbox.checked = true;
  loopCheckbox.onchange = () => { pvState.loop = loopCheckbox.checked; };
  loopLabel.appendChild(loopCheckbox);
  loopLabel.appendChild(document.createTextNode(" くり返し再生"));
  pvRow.appendChild(loopLabel);
  const playBtn = document.createElement("button");
  playBtn.className = "devmode-btn";
  playBtn.textContent = "▶ もう一度再生";
  pvRow.appendChild(playBtn);

  const FROM = { x: 70, y: 180 }, TO = { x: 390, y: 90 };
  let fx = null, last = 0, rafId = 0, idleUntil = 0;
  const start = () => {
    const layers = efxNormalizeLayers(mix);
    const dur = efxMixDuration(layers);
    const color = pvState.element && typeof getElementColor === "function" ? getElementColor(pvState.element) : "#ffffff";
    fx = { kind: "mix", layers, color, x1: FROM.x, y1: FROM.y, x2: TO.x, y2: TO.y, t: dur, dur, seed: Math.floor(Math.random() * 1e9) };
  };
  const frame = (now) => {
    if (!canvas.isConnected) { rafId = 0; return; }   // 画面から消えたら止める
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 撃つ側と当たる側の目印
    ctx.fillStyle = "#3b6ea8"; ctx.beginPath(); ctx.arc(FROM.x, FROM.y, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#a84a4a"; ctx.beginPath(); ctx.arc(TO.x, TO.y, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#cfd8e3"; ctx.font = "11px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("撃つ側", FROM.x, FROM.y + 26); ctx.fillText("当たる側", TO.x, TO.y + 30);
    if (fx) {
      fx.t -= dt;
      if (fx.t > 0) efxDraw(ctx, fx);
      else { fx = null; idleUntil = now + 500; }
    } else if (pvState.loop && now >= idleUntil) start();
    rafId = requestAnimationFrame(frame);
  };
  const restart = () => { start(); if (!rafId) { last = 0; rafId = requestAnimationFrame(frame); } };
  playBtn.onclick = restart;
  restart();

  // ===== レイヤー =====
  const layerTitle = document.createElement("div");
  layerTitle.className = "devmode-note";
  layerTitle.textContent = `レイヤー（上から順に重ねて描きます／最大${EFX_LAYER_MAX}枚）`;
  infoEl.appendChild(layerTitle);
  mix.layers.forEach((layer, li) => infoEl.appendChild(buildEffectLayerEditor(mix, layer, li, persist, restart)));
  const addLayerBtn = document.createElement("button");
  addLayerBtn.className = "devmode-btn";
  addLayerBtn.textContent = "＋レイヤーを追加";
  addLayerBtn.disabled = mix.layers.length >= EFX_LAYER_MAX;
  addLayerBtn.onclick = () => {
    pushUndoSnapshot();
    mix.layers.push(efxNewLayer("burst"));
    persist(); renderScenarioBuildPanel();
  };
  infoEl.appendChild(addLayerBtn);
  row.appendChild(infoEl);

  // ===== 右側のボタン（並べ替え・複製・削除） =====
  const buttonsEl = document.createElement("div");
  buttonsEl.className = "scenariobuild-chapter-buttons";
  const mkBtn = (text, disabled, onClick, danger) => {
    const b = document.createElement("button");
    b.className = "devmode-btn" + (danger ? " devmode-btn-danger" : "");
    b.textContent = text; b.disabled = !!disabled;
    b.onclick = (event) => { event.stopPropagation(); onClick(); };
    buttonsEl.appendChild(b);
  };
  mkBtn("↑ 上へ", index === 0, () => { pushUndoSnapshot(); [list[index - 1], list[index]] = [list[index], list[index - 1]]; persist(); renderScenarioBuildPanel(); });
  mkBtn("↓ 下へ", index === list.length - 1, () => { pushUndoSnapshot(); [list[index + 1], list[index]] = [list[index], list[index + 1]]; persist(); renderScenarioBuildPanel(); });
  mkBtn("複製", false, () => {
    pushUndoSnapshot();
    const copy = JSON.parse(JSON.stringify(mix));
    copy.id = (typeof generateId === "function") ? generateId("effectmix") : ("effectmix_" + Date.now());
    copy.name = (mix.name || "名無しのエフェクト") + "のコピー";
    list.splice(index + 1, 0, copy);
    persist(); renderScenarioBuildPanel();
  });
  mkBtn("削除", false, async () => {
    const used = efxCountUsers(mix.id);
    const msg = `エフェクト「${mix.name || "名無し"}」を削除しますか？` + (used > 0 ? `\n（${used}件の技に付いています。削除すると、その技は標準の線・輪に戻ります）` : "");
    const ok = await showGameConfirm(msg);
    if (!ok) return;
    pushUndoSnapshot();
    list.splice(index, 1);
    persist(); renderScenarioBuildPanel();
  }, true);
  row.appendChild(buttonsEl);
  return row;
}

// このエフェクトを付けている技の数（削除の確認用）
function efxCountUsers(mixId) {
  const n = (arr) => (Array.isArray(arr) ? arr : []).filter(x => x && (x.effectMixId === mixId || x.skillEffectMixId === mixId)).length;
  return n(scenarioProject.towerUnits) + n(scenarioProject.raidUnits) + n(scenarioProject.comboSkills);
}

function buildEffectLayerEditor(mix, layer, li, persist, restartPreview) {
  const box = document.createElement("div");
  box.style.cssText = "border:1px solid #556;border-radius:6px;padding:6px 8px;margin:6px 0;";
  const after = () => restartPreview();
  const { addRow, numberField, selectField } = tdEditorFieldTools(layer, box, () => { persist(); after(); });

  const r1 = addRow();
  const head = labelSpan(`レイヤー${li + 1}`);
  head.style.fontWeight = "bold";
  r1.appendChild(head);
  selectField(r1, "base", "ベース", EFX_BASE_DEFS.map(d => ({ value: d.id, label: d.label })), () => renderScenarioBuildPanel());
  const base = efxBaseDef(layer.base) || EFX_BASE_DEFS[0];
  const travel = EFX_TRAVEL_BASES.includes(base.id);
  if (!travel) selectField(r1, "anchor", "出す位置", EFX_ANCHOR_OPTIONS);
  const note = document.createElement("span");
  note.className = "devmode-note";
  note.textContent = base.note;
  r1.appendChild(note);

  const r2 = addRow();
  selectField(r2, "color", "色", [{ value: "element", label: "技の属性色" }, { value: "custom", label: "色を指定" }], () => renderScenarioBuildPanel());
  if (layer.color === "custom") {
    const wrap = document.createElement("span");
    wrap.className = "scenariobuild-inline-field";
    wrap.appendChild(labelSpan("指定色："));
    const input = document.createElement("input");
    input.type = "color";
    input.value = /^#[0-9a-fA-F]{6}$/.test(layer.customColor || "") ? layer.customColor : "#ffffff";
    input.onchange = () => { layer.customColor = input.value; persist(); after(); };
    wrap.appendChild(input);
    r2.appendChild(wrap);
  }
  const glowLabel = document.createElement("label");
  glowLabel.style.cursor = "pointer";
  const glowCheckbox = document.createElement("input");
  glowCheckbox.type = "checkbox"; glowCheckbox.checked = layer.glow !== false;
  glowCheckbox.onchange = () => { layer.glow = glowCheckbox.checked; persist(); after(); };
  glowLabel.appendChild(glowCheckbox);
  glowLabel.appendChild(document.createTextNode(" 光らせる（重ねると明るくなる）"));
  r2.appendChild(glowLabel);

  const r3 = addRow();
  numberField(r3, "size", "大きさ（倍）", 0.2, 4, 0.1);
  numberField(r3, "alpha", "濃さ（0.1〜1）", 0.1, 1, 0.1);
  if (["bolt", "sparks"].includes(base.id)) numberField(r3, "count", "数", 1, 30, 1);
  const r4 = addRow();
  numberField(r4, "delay", "開始のずれ（秒）", 0, 2, 0.05);
  numberField(r4, "duration", "続く時間（秒）", 0.1, 2, 0.05);

  const r5 = addRow();
  const mk = (text, disabled, fn, danger) => {
    const b = document.createElement("button");
    b.className = "devmode-btn" + (danger ? " devmode-btn-danger" : "");
    b.textContent = text; b.disabled = !!disabled;
    b.onclick = () => { pushUndoSnapshot(); fn(); persist(); renderScenarioBuildPanel(); };
    r5.appendChild(b);
  };
  mk("↑", li === 0, () => { [mix.layers[li - 1], mix.layers[li]] = [mix.layers[li], mix.layers[li - 1]]; });
  mk("↓", li === mix.layers.length - 1, () => { [mix.layers[li + 1], mix.layers[li]] = [mix.layers[li], mix.layers[li + 1]]; });
  mk("このレイヤーを複製", mix.layers.length >= EFX_LAYER_MAX, () => { mix.layers.splice(li + 1, 0, JSON.parse(JSON.stringify(layer))); });
  mk("レイヤーを削除", mix.layers.length <= 1, () => { mix.layers.splice(li, 1); }, true);
  return box;
}
