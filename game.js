(() => {
  'use strict';

  const SAVE_KEY = 'vic3QuickIdleSave_v1';
  const COOKIE_KEY = 'vic3_quick_idle';
  const SAVE_VERSION = 1;
  const OFFLINE_CAP_SECONDS = 8 * 60 * 60;
  const AUTOSAVE_MS = 10_000;
  const HISTORY_SAMPLE_MS = 5_000;
  const HISTORY_MAX_POINTS = 240;
  const CHART_RENDER_MS = 300;

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
    gdpHistory: [],
    lastSeen: Date.now()
  });

  let state = defaultState();
  let lastTick = performance.now();
  let lastRender = 0;
  let lastChartRender = 0;
  let toastTimer = null;

  const els = {
    gdpValue: document.getElementById('gdpValue'),
    gdpPerSecond: document.getElementById('gdpPerSecond'),
    clickValue: document.getElementById('clickValue'),
    industryCount: document.getElementById('industryCount'),
    globalMultiplier: document.getElementById('globalMultiplier'),
    totalGdpValue: document.getElementById('totalGdpValue'),
    gdpChart: document.getElementById('gdpChart'),
    chartRange: document.getElementById('chartRange'),
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

  function formatChartMoney(value) {
    if (!Number.isFinite(value) || value <= 0) return '£0';
    const units = [[1e15, 'Q'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (const [size, suffix] of units) {
      if (value >= size) {
        const scaled = value / size;
        const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
        return `£${scaled.toFixed(digits)}${suffix}`;
      }
    }
    return `£${Math.round(value)}`;
  }

  function formatChartDuration(milliseconds) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours}h ${minutes % 60}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
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

  function recordHistory(force = false) {
    if (!Array.isArray(state.gdpHistory)) state.gdpHistory = [];
    const now = Date.now();
    const history = state.gdpHistory;
    const last = history[history.length - 1];

    if (!last) {
      history.push([now, state.totalGdp]);
      return;
    }

    if (!force && now - last[0] < HISTORY_SAMPLE_MS) return;

    if (force && now - last[0] < 750) {
      last[1] = state.totalGdp;
    } else {
      history.push([now, state.totalGdp]);
    }

    if (history.length > HISTORY_MAX_POINTS) {
      const compacted = [history[0]];
      for (let i = 2; i < history.length - 1; i += 2) compacted.push(history[i]);
      compacted.push(history[history.length - 1]);
      state.gdpHistory = compacted;
    }
  }

  function niceChartMax(value) {
    if (!Number.isFinite(value) || value <= 0) return 10;
    const exponent = Math.floor(Math.log10(value));
    const power = Math.pow(10, exponent);
    const fraction = value / power;
    const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    return niceFraction * power;
  }

  function drawGdpChart(force = false) {
    if (!els.gdpChart) return;
    const perfNow = performance.now();
    if (!force && perfNow - lastChartRender < CHART_RENDER_MS) return;
    lastChartRender = perfNow;

    const canvas = els.gdpChart;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
    const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const styles = getComputedStyle(document.documentElement);
    const lineColour = styles.getPropertyValue('--gold-2').trim() || '#f1dc9f';
    const gridColour = styles.getPropertyValue('--line-soft').trim() || '#273b32';
    const mutedColour = styles.getPropertyValue('--muted').trim() || '#9fb2a8';
    const fillColour = 'rgba(216, 189, 120, 0.10)';

    const stored = Array.isArray(state.gdpHistory) ? state.gdpHistory : [];
    const now = Date.now();
    const points = stored.map(point => [point[0], point[1]]);
    if (!points.length) points.push([now, state.totalGdp]);
    const last = points[points.length - 1];
    if (now > last[0]) points.push([now, state.totalGdp]);
    else last[1] = state.totalGdp;

    const pad = { left: 66, right: 14, top: 15, bottom: 30 };
    const plotW = Math.max(1, rect.width - pad.left - pad.right);
    const plotH = Math.max(1, rect.height - pad.top - pad.bottom);
    const firstTime = points[0][0];
    const lastTime = points[points.length - 1][0];
    const timeSpan = Math.max(HISTORY_SAMPLE_MS * 2, lastTime - firstTime);
    const xMin = lastTime - timeSpan;
    const maxObserved = Math.max(10, ...points.map(point => point[1]), state.totalGdp);
    const yMax = niceChartMax(maxObserved * 1.05);

    const xFor = t => pad.left + ((t - xMin) / timeSpan) * plotW;
    const yFor = v => pad.top + plotH - (Math.max(0, v) / yMax) * plotH;

    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = mutedColour;
    ctx.strokeStyle = gridColour;
    ctx.lineWidth = 1;
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= 4; i += 1) {
      const ratio = i / 4;
      const y = pad.top + plotH - ratio * plotH;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(rect.width - pad.right, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(formatChartMoney(yMax * ratio), pad.left - 8, y);
    }

    const elapsed = Math.max(0, lastTime - firstTime);
    const xTicks = [0, 0.5, 1];
    ctx.textBaseline = 'alphabetic';
    xTicks.forEach((ratio, index) => {
      const x = pad.left + ratio * plotW;
      ctx.textAlign = index === 0 ? 'left' : index === xTicks.length - 1 ? 'right' : 'center';
      ctx.fillText(formatChartDuration(Math.max(0, elapsed * ratio)), x, rect.height - 8);
    });

    if (points.length >= 2) {
      ctx.beginPath();
      points.forEach((point, index) => {
        const x = Math.max(pad.left, Math.min(rect.width - pad.right, xFor(point[0])));
        const y = yFor(point[1]);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      const endX = Math.max(pad.left, Math.min(rect.width - pad.right, xFor(points[points.length - 1][0])));
      ctx.lineTo(endX, pad.top + plotH);
      ctx.lineTo(Math.max(pad.left, Math.min(rect.width - pad.right, xFor(points[0][0]))), pad.top + plotH);
      ctx.closePath();
      ctx.fillStyle = fillColour;
      ctx.fill();

      ctx.beginPath();
      points.forEach((point, index) => {
        const x = Math.max(pad.left, Math.min(rect.width - pad.right, xFor(point[0])));
        const y = yFor(point[1]);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = lineColour;
      ctx.lineWidth = 2.25;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    } else {
      const x = rect.width - pad.right;
      const y = yFor(state.totalGdp);
      ctx.fillStyle = lineColour;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (els.chartRange) {
      els.chartRange.textContent = elapsed > 0 ? `${formatChartDuration(elapsed)} of recorded economic history` : 'Economic history begins now';
    }
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
    if (els.totalGdpValue) els.totalGdpValue.textContent = formatMoney(state.totalGdp);
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
    drawGdpChart(force);
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
    if (Array.isArray(data.gdpHistory)) {
      clean.gdpHistory = data.gdpHistory
        .filter(point => Array.isArray(point) && point.length >= 2)
        .map(point => [safeNumber(point[0]), safeNumber(point[1])])
        .filter(point => point[0] > 0)
        .sort((a, b) => a[0] - b[0])
        .slice(-HISTORY_MAX_POINTS);
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
    recordHistory(true);
    state.lastSeen = Date.now();
    const payload = encodeSave(state);
    let saved = false;
    try {
      localStorage.setItem(SAVE_KEY, payload);
      saved = true;
    } catch (_) {}

    // Cookies are deliberately kept small. Gameplay state is preserved in the
    // fallback, while detailed graph history remains in localStorage/export saves.
    const cookieState = { ...state, gdpHistory: [] };
    setCookie(COOKIE_KEY, encodeSave(cookieState));
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
    recordHistory(false);
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
  window.addEventListener('resize', () => drawGdpChart(true));

  loadGame();
  recordHistory(true);
  initBuildings();
  initAchievements();
  render(true);
  requestAnimationFrame(tick);
})();
