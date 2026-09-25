(() => {
  'use strict';

  const SAVE_KEY = 'vic3QuickIdleSave_v1';
  const COOKIE_KEY = 'vic3_quick_idle';
  const SAVE_VERSION = 1;
  const OFFLINE_CAP_SECONDS = 8 * 60 * 60;
  const AUTOSAVE_MS = 10_000;

  const BUILDINGS = [
    { id: 'logging', name: 'Logging Camp', icon: '🌲', baseCost: 25, baseGps: 0.6, blurb: 'Timber, paperwork and the beginnings of an economy.' },
    { id: 'iron', name: 'Iron Mine', icon: '⛏', baseCost: 140, baseGps: 3.4, blurb: 'The rocks are now contributing to GDP.' },
    { id: 'coal', name: 'Coal Mine', icon: '◼', baseCost: 800, baseGps: 18, blurb: 'Productivity, smoke and absolutely no externalities.' },
    { id: 'tools', name: 'Tooling Workshop', icon: '⚙', baseCost: 4_600, baseGps: 95, blurb: 'Tools make tools make numbers go up.' },
    { id: 'steel', name: 'Steel Mill', icon: '▥', baseCost: 27_000, baseGps: 510, blurb: 'A proper industrial economy needs enormous furnaces.' },
    { id: 'glass', name: 'Glassworks', icon: '◇', baseCost: 160_000, baseGps: 2_800, blurb: 'Windows, bottles and suspiciously high margins.' },
    { id: 'autos', name: 'Automotive Industries', icon: '◆', baseCost: 950_000, baseGps: 15_500, blurb: 'Mass motorisation. What could possibly go wrong?' }
  ];

  const MILESTONES = [
    { gdp: 10_000, mult: 1.2, name: 'Early Industrialisation' },
    { gdp: 100_000, mult: 1.45, name: 'Railway Mania' },
    { gdp: 1_000_000, mult: 1.8, name: 'Second Industrial Revolution' },
    { gdp: 10_000_000, mult: 2.3, name: 'Mass Production' },
    { gdp: 100_000_000, mult: 3.0, name: 'Economic Miracle' },
    { gdp: 1_000_000_000, mult: 4.0, name: 'Line Goes Up' }
  ];

  const defaultState = () => ({
    version: SAVE_VERSION,
    gdp: 0,
    totalGdp: 0,
    totalClicks: 0,
    constructionLevel: 1,
    constructionXp: 0,
    buyMode: '1',
    buildings: Object.fromEntries(BUILDINGS.map(b => [b.id, 0])),
    lastSeen: Date.now()
  });

  let state = defaultState();
  let lastTick = performance.now();
  let lastRender = 0;
  let toastTimer = null;

  const els = {
    gdpValue: document.getElementById('gdpValue'),
    gdpPerSecond: document.getElementById('gdpPerSecond'),
    clickValue: document.getElementById('clickValue'),
    industryCount: document.getElementById('industryCount'),
    globalMultiplier: document.getElementById('globalMultiplier'),
    constructionLevel: document.getElementById('constructionLevel'),
    constructGain: document.getElementById('constructGain'),
    constructButton: document.getElementById('constructButton'),
    xpText: document.getElementById('xpText'),
    xpBar: document.getElementById('xpBar'),
    nextMilestone: document.getElementById('nextMilestone'),
    milestoneEffect: document.getElementById('milestoneEffect'),
    buildingList: document.getElementById('buildingList'),
    achievementList: document.getElementById('achievementList'),
    saveIndicator: document.getElementById('saveIndicator'),
    saveButton: document.getElementById('saveButton'),
    exportButton: document.getElementById('exportButton'),
    importButton: document.getElementById('importButton'),
    resetButton: document.getElementById('resetButton'),
    textDialog: document.getElementById('textDialog'),
    dialogTitle: document.getElementById('dialogTitle'),
    dialogHelp: document.getElementById('dialogHelp'),
    saveText: document.getElementById('saveText'),
    dialogConfirm: document.getElementById('dialogConfirm'),
    toast: document.getElementById('toast')
  };

  function formatMoney(value) {
    if (!Number.isFinite(value)) return '£0';
    const abs = Math.abs(value);
    const units = [
      [1e15, 'Q'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']
    ];
    for (const [size, suffix] of units) {
      if (abs >= size) {
        const scaled = value / size;
        const digits = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
        return `£${scaled.toFixed(digits)}${suffix}`;
      }
    }
    return `£${value.toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : 2)}`;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(Math.floor(value));
  }

  function xpNeeded(level = state.constructionLevel) {
    return Math.floor(25 * Math.pow(1.42, level - 1));
  }

  function clickPower() {
    return 1 * Math.pow(1.68, state.constructionLevel - 1) * milestoneMultiplier();
  }

  function milestoneMultiplier() {
    let mult = 1;
    for (const milestone of MILESTONES) {
      if (state.totalGdp >= milestone.gdp) mult = milestone.mult;
    }
    return mult;
  }

  function gps() {
    const raw = BUILDINGS.reduce((sum, b) => sum + (state.buildings[b.id] || 0) * b.baseGps, 0);
    return raw * milestoneMultiplier();
  }

  function buildingCost(building, owned = state.buildings[building.id]) {
    return building.baseCost * Math.pow(1.155, owned);
  }

  function totalCost(building, amount) {
    if (amount <= 0) return 0;
    const owned = state.buildings[building.id];
    const first = buildingCost(building, owned);
    return first * (1 - Math.pow(1.155, amount)) / (1 - 1.155);
  }

  function maxAffordable(building) {
    const owned = state.buildings[building.id];
    const first = buildingCost(building, owned);
    if (state.gdp < first) return 0;
    const ratio = 1.155;
    const estimate = Math.floor(Math.log(1 + state.gdp * (ratio - 1) / first) / Math.log(ratio));
    return Math.max(0, estimate);
  }

  function purchaseAmount(building) {
    if (state.buyMode === 'max') return maxAffordable(building);
    return Number(state.buyMode) || 1;
  }

  function addGdp(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    state.gdp += amount;
    state.totalGdp += amount;
  }

  function construct(event) {
    const gain = clickPower();
    addGdp(gain);
    state.totalClicks += 1;
    state.constructionXp += 1;
    while (state.constructionXp >= xpNeeded()) {
      state.constructionXp -= xpNeeded();
      state.constructionLevel += 1;
      showToast(`Construction Sector reached level ${state.constructionLevel}.`);
    }

    if (event && event.clientX) {
      const floater = document.createElement('span');
      floater.className = 'floating-gain';
      floater.textContent = `+${formatMoney(gain)}`;
      floater.style.left = `${event.clientX}px`;
      floater.style.top = `${event.clientY}px`;
      document.body.appendChild(floater);
      window.setTimeout(() => floater.remove(), 780);
    }
    render(true);
  }

  function buyBuilding(building) {
    const amount = purchaseAmount(building);
    if (amount < 1) return;
    const cost = totalCost(building, amount);
    if (state.gdp + 1e-9 < cost) return;
    state.gdp -= cost;
    state.buildings[building.id] += amount;
    render(true);
  }

  function unlocked(buildingIndex) {
    if (buildingIndex === 0) return true;
    const previous = BUILDINGS[buildingIndex - 1];
    return state.buildings[previous.id] > 0 || state.totalGdp >= BUILDINGS[buildingIndex].baseCost * 0.4;
  }

  const buildingUi = new Map();
  const achievementUi = [];

  function initBuildings() {
    const fragment = document.createDocumentFragment();
    BUILDINGS.forEach((building) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'building';
      btn.innerHTML = `
        <span class="building-icon" aria-hidden="true">${building.icon}</span>
        <span class="building-copy">
          <span class="building-title-row">
            <span class="building-name">${building.name}</span>
            <span class="building-owned"></span>
          </span>
          <span class="building-desc"></span>
        </span>
        <span class="building-price">
          <strong></strong>
          <small></small>
        </span>`;
      btn.addEventListener('click', () => buyBuilding(building));
      buildingUi.set(building.id, {
        btn,
        owned: btn.querySelector('.building-owned'),
        desc: btn.querySelector('.building-desc'),
        price: btn.querySelector('.building-price strong'),
        output: btn.querySelector('.building-price small')
      });
      fragment.appendChild(btn);
    });
    els.buildingList.replaceChildren(fragment);
  }

  function renderBuildings() {
    BUILDINGS.forEach((building, index) => {
      const ui = buildingUi.get(building.id);
      if (!ui) return;

      const open = unlocked(index);
      const amount = purchaseAmount(building);
      const displayAmount = Math.max(1, amount);
      const cost = amount > 0 ? totalCost(building, amount) : buildingCost(building);
      const owned = state.buildings[building.id];
      const eachOutput = building.baseGps * milestoneMultiplier();
      const contribution = owned * eachOutput;

      ui.btn.disabled = !open || amount < 1 || state.gdp + 1e-9 < cost;
      ui.btn.setAttribute('aria-label', open ? `Buy ${displayAmount} ${building.name}` : `${building.name} locked`);
      ui.owned.textContent = `Owned: ${formatNumber(owned)}`;
      ui.desc.textContent = open ? building.blurb : `Unlock by developing ${BUILDINGS[index - 1].name}.`;
      ui.price.textContent = open ? formatMoney(cost) : 'Locked';
      ui.output.textContent = open
        ? `+${formatMoney(eachOutput)}/s each${contribution > 0 ? ` · ${formatMoney(contribution)}/s total` : ''}`
        : '';
    });
  }

  function initAchievements() {
    const definitions = [
      ['Subsistence Escape Velocity', 'Own 10 buildings.'],
      ['Workshop of the World', 'Reach £1M total GDP.'],
      ['Construction Enjoyer', 'Click 500 times.'],
      ['Motorised Society', 'Own an Automotive Industries building.']
    ];
    const fragment = document.createDocumentFragment();
    definitions.forEach(([name, desc]) => {
      const row = document.createElement('div');
      row.className = 'achievement';
      const title = document.createElement('strong');
      const copy = document.createElement('span');
      copy.textContent = desc;
      row.append(title, copy);
      achievementUi.push({ row, title, name });
      fragment.appendChild(row);
    });
    els.achievementList.replaceChildren(fragment);
  }

  function renderAchievements() {
    const met = [
      totalBuildings() >= 10,
      state.totalGdp >= 1e6,
      state.totalClicks >= 500,
      state.buildings.autos >= 1
    ];
    achievementUi.forEach((ui, index) => {
      ui.row.classList.toggle('unlocked', met[index]);
      ui.title.textContent = `${met[index] ? '✓ ' : '○ '}${ui.name}`;
    });
  }

  function totalBuildings() {
    return Object.values(state.buildings).reduce((a, b) => a + b, 0);
  }

  function render(force = false) {
    const now = performance.now();
    if (!force && now - lastRender < 100) return;
    lastRender = now;

    const perSec = gps();
    const click = clickPower();
    els.gdpValue.textContent = formatMoney(state.gdp);
    els.gdpPerSecond.textContent = `+${formatMoney(perSec)} / sec`;
    els.clickValue.textContent = formatMoney(click);
    els.industryCount.textContent = formatNumber(totalBuildings());
    els.globalMultiplier.textContent = `×${milestoneMultiplier().toFixed(2)}`;
    els.constructionLevel.textContent = `Level ${state.constructionLevel}`;
    els.constructGain.textContent = `+${formatMoney(click)} GDP`;
    const needed = xpNeeded();
    els.xpText.textContent = `${formatNumber(state.constructionXp)} / ${formatNumber(needed)}`;
    els.xpBar.style.width = `${Math.max(0, Math.min(100, state.constructionXp / needed * 100))}%`;

    const next = MILESTONES.find(m => state.totalGdp < m.gdp);
    if (next) {
      els.nextMilestone.textContent = formatMoney(next.gdp);
      els.milestoneEffect.textContent = `Industrial output ×${next.mult.toFixed(2)}`;
    } else {
      els.nextMilestone.textContent = 'Achieved';
      els.milestoneEffect.textContent = 'The graph has become policy.';
    }

    document.querySelectorAll('.buy-mode').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === state.buyMode);
    });

    renderBuildings();
    renderAchievements();
  }

  function sanitizeSave(data) {
    const clean = defaultState();
    if (!data || typeof data !== 'object') return clean;
    clean.gdp = safeNumber(data.gdp);
    clean.totalGdp = Math.max(clean.gdp, safeNumber(data.totalGdp));
    clean.totalClicks = Math.floor(safeNumber(data.totalClicks));
    clean.constructionLevel = Math.max(1, Math.min(10_000, Math.floor(safeNumber(data.constructionLevel) || 1)));
    clean.constructionXp = Math.max(0, Math.floor(safeNumber(data.constructionXp)));
    clean.buyMode = ['1', '10', 'max'].includes(String(data.buyMode)) ? String(data.buyMode) : '1';
    clean.lastSeen = safeNumber(data.lastSeen) || Date.now();
    for (const building of BUILDINGS) {
      clean.buildings[building.id] = Math.max(0, Math.floor(safeNumber(data.buildings?.[building.id])));
    }
    return clean;
  }

  function safeNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  function encodeSave(obj) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  }

  function decodeSave(text) {
    return JSON.parse(decodeURIComponent(escape(atob(text.trim()))));
  }

  function setCookie(name, value, days = 3650) {
    try {
      const expires = new Date(Date.now() + days * 864e5).toUTCString();
      document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
    } catch (_) {}
  }

  function getCookie(name) {
    try {
      const prefix = `${name}=`;
      return document.cookie.split(';').map(v => v.trim()).find(v => v.startsWith(prefix))?.slice(prefix.length) || null;
    } catch (_) { return null; }
  }

  function saveGame(showMessage = false) {
    state.lastSeen = Date.now();
    const payload = encodeSave(state);
    let saved = false;
    try {
      localStorage.setItem(SAVE_KEY, payload);
      saved = true;
    } catch (_) {}
    setCookie(COOKIE_KEY, payload);
    els.saveIndicator.textContent = saved ? 'Saved' : 'Cookie save';
    if (showMessage) showToast('Economy saved. The bureaucracy approves.');
  }

  function loadGame() {
    let raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (_) {}
    if (!raw) {
      const cookie = getCookie(COOKIE_KEY);
      if (cookie) raw = decodeURIComponent(cookie);
    }
    if (!raw) return;
    try {
      const loaded = sanitizeSave(decodeSave(raw));
      const elapsed = Math.max(0, Math.min(OFFLINE_CAP_SECONDS, (Date.now() - loaded.lastSeen) / 1000));
      state = loaded;
      const offlineGain = gps() * elapsed;
      if (offlineGain > 0.01 && elapsed > 10) {
        addGdp(offlineGain);
        window.setTimeout(() => showToast(`While away: +${formatMoney(offlineGain)} GDP from ${formatDuration(elapsed)} of production.`), 300);
      }
    } catch (_) {
      state = defaultState();
      showToast('The previous save could not be read, so a fresh economy was started.');
    }
  }

  function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours) return `${hours}h ${mins}m`;
    return `${Math.max(1, mins)}m`;
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3000);
  }

  function openExport() {
    saveGame(false);
    els.dialogTitle.textContent = 'Export save';
    els.dialogHelp.textContent = 'Copy this text somewhere safe. You can import it later or on another browser.';
    els.saveText.value = encodeSave(state);
    els.saveText.readOnly = true;
    els.dialogConfirm.textContent = 'Close';
    els.dialogConfirm.onclick = () => els.textDialog.close();
    els.textDialog.showModal();
    els.saveText.select();
  }

  function openImport() {
    els.dialogTitle.textContent = 'Import save';
    els.dialogHelp.textContent = 'Paste a Victoria 3: Quick Idle save string below. Importing replaces the current economy.';
    els.saveText.value = '';
    els.saveText.readOnly = false;
    els.dialogConfirm.textContent = 'Import';
    els.dialogConfirm.onclick = () => {
      try {
        state = sanitizeSave(decodeSave(els.saveText.value));
        state.lastSeen = Date.now();
        saveGame(false);
        render(true);
        els.textDialog.close();
        showToast('Save imported successfully.');
      } catch (_) {
        showToast('That save string is not valid.');
      }
    };
    els.textDialog.showModal();
    els.saveText.focus();
  }

  function resetGame() {
    const confirmed = window.confirm('Reset the entire economy? This cannot be undone unless you exported your save first.');
    if (!confirmed) return;
    state = defaultState();
    try { localStorage.removeItem(SAVE_KEY); } catch (_) {}
    setCookie(COOKIE_KEY, '', -1);
    render(true);
    saveGame(false);
    showToast('The old regime has fallen. A new GDP of £0 begins.');
  }

  function tick(now) {
    const dt = Math.min(1, Math.max(0, (now - lastTick) / 1000));
    lastTick = now;
    const gain = gps() * dt;
    addGdp(gain);
    render(false);
    requestAnimationFrame(tick);
  }

  document.querySelectorAll('.buy-mode').forEach(btn => {
    btn.addEventListener('click', () => {
      state.buyMode = btn.dataset.mode;
      render(true);
    });
  });

  els.constructButton.addEventListener('click', construct);
  els.saveButton.addEventListener('click', () => saveGame(true));
  els.exportButton.addEventListener('click', openExport);
  els.importButton.addEventListener('click', openImport);
  els.resetButton.addEventListener('click', resetGame);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveGame(false);
  });
  window.addEventListener('beforeunload', () => saveGame(false));
  window.setInterval(() => saveGame(false), AUTOSAVE_MS);

  loadGame();
  initBuildings();
  initAchievements();
  render(true);
  requestAnimationFrame(tick);
})();
