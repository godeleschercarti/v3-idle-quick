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
  const COMPANY_DIVIDEND_RATE = 0.40;
  const COMPANY_PROFIT_SHARE = 0.65;
  const COMPANY_BUILD_COST_FACTOR = 0.55;
  const SPECIALIST_BUILD_COST_FACTOR = 0.35;
  const SPECIALIST_PROFIT_MULTIPLIER = 1.25;
  const COMPANY_QUEUE_SIZE = 5;
  const COMPANY_SLOT_COSTS = [500_000, 10_000_000, 100_000_000];

  const BUILDINGS = [
    { id: 'logging', name: 'Logging Camp', icon: '🌲', baseCost: 25, baseGps: 0.6, blurb: 'Timber, paperwork and the beginnings of an economy.' },
    { id: 'iron', name: 'Iron Mine', icon: '⛏', baseCost: 140, baseGps: 3.4, blurb: 'The rocks are now contributing to GDP.' },
    { id: 'coal', name: 'Coal Mine', icon: '◼', baseCost: 800, baseGps: 18, blurb: 'Productivity, smoke and absolutely no externalities.' },
    { id: 'tools', name: 'Tooling Workshop', icon: '⚙', baseCost: 4_600, baseGps: 95, blurb: 'Tools make tools make numbers go up.' },
    { id: 'steel', name: 'Steel Mill', icon: '▥', baseCost: 27_000, baseGps: 510, blurb: 'A proper industrial economy needs enormous furnaces.' },
    { id: 'glass', name: 'Glassworks', icon: '◇', baseCost: 160_000, baseGps: 2_800, blurb: 'Windows, bottles and suspiciously high margins.' },
    { id: 'autos', name: 'Automotive Industries', icon: '◆', baseCost: 950_000, baseGps: 15_500, blurb: 'Mass motorisation. What could possibly go wrong?' }
  ];

  const BUILDING_BY_ID = Object.fromEntries(BUILDINGS.map(building => [building.id, building]));

  // These are Victoria 3 flavored-company names, adapted to this game's reduced
  // seven-industry economy rather than trying to reproduce every in-game charter.
  const COMPANIES = [
    {
      id: 'klabin',
      name: 'Klabin Irmãos & Cia.',
      country: '🇧🇷 Brazil',
      minSlot: 0,
      note: 'Forestry concern. Cheap expansion, many trees, no questions.',
      start: { logging: 5 },
      queue: ['logging', 'logging', 'logging', 'logging']
    },
    {
      id: 'new-russia',
      name: 'New Russia Company Ltd.',
      country: '🇷🇺 Russia',
      minSlot: 0,
      note: 'Integrated iron, coal and steel. The construction loop acquires a board of directors.',
      start: { iron: 2, coal: 2, steel: 1 },
      queue: ['iron', 'coal', 'iron', 'coal', 'steel']
    },
    {
      id: 'cockerill',
      name: 'Société anonyme John Cockerill',
      country: '🇧🇪 Belgium',
      minSlot: 0,
      note: 'Tools and steel. Industrial machinery with an unnecessarily distinguished name.',
      start: { tools: 2, steel: 1 },
      queue: ['tools', 'tools', 'steel', 'tools']
    },
    {
      id: 'moser',
      name: 'Glasfabrik Ludwig Moser & Söhne',
      country: '🇦🇹 Austria-Hungary',
      minSlot: 1,
      note: 'Glassworks specialist. Turns silica into balance-sheet prestige.',
      start: { glass: 1 },
      queue: ['glass', 'glass', 'glass']
    },
    {
      id: 'carnegie',
      name: 'Carnegie Steel Co.',
      country: '🇺🇸 United States',
      minSlot: 1,
      note: 'Coal, iron and steel. Vertical integration, horizontally enormous furnaces.',
      start: { iron: 1, coal: 1, steel: 2 },
      queue: ['steel', 'iron', 'coal', 'steel', 'steel']
    },
    {
      id: 'ford',
      name: 'Ford Motor Company',
      country: '🇺🇸 United States',
      minSlot: 2,
      note: 'Automobiles, tools and steel. The line is now literally an assembly line.',
      start: { tools: 1, steel: 1, autos: 1 },
      queue: ['autos', 'tools', 'steel', 'autos', 'tools']
    }
  ];

  const COMPANY_BY_ID = Object.fromEntries(COMPANIES.map(company => [company.id, company]));

  const MILESTONES = [
    { gdp: 10_000, mult: 1.2, name: 'Early Industrialisation' },
    { gdp: 100_000, mult: 1.45, name: 'Railway Mania' },
    { gdp: 1_000_000, mult: 1.8, name: 'Second Industrial Revolution' },
    { gdp: 10_000_000, mult: 2.3, name: 'Mass Production' },
    { gdp: 100_000_000, mult: 3.0, name: 'Economic Miracle' },
    { gdp: 1_000_000_000, mult: 4.0, name: 'Line Goes Up' }
  ];

  function emptyCompanySlot() {
    return {
      unlocked: false,
      companyId: null,
      cash: 0,
      buildings: Object.fromEntries(BUILDINGS.map(building => [building.id, 0])),
      queue: [],
      queueCursor: 0
    };
  }

  const defaultState = () => ({
    version: SAVE_VERSION,
    gdp: 0,
    totalGdp: 0,
    totalClicks: 0,
    constructionLevel: 1,
    constructionXp: 0,
    buyMode: '1',
    buildings: Object.fromEntries(BUILDINGS.map(building => [building.id, 0])),
    companies: COMPANY_SLOT_COSTS.map(() => emptyCompanySlot()),
    gdpHistory: [],
    lastSeen: Date.now()
  });

  let state = defaultState();
  let lastTick = performance.now();
  let lastRender = 0;
  let lastChartRender = 0;
  let toastTimer = null;
  let companyPickerSlot = null;

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
    companySlots: document.getElementById('companySlots'),
    companyDividendValue: document.getElementById('companyDividendValue'),
    companyDialog: document.getElementById('companyDialog'),
    companyDialogTitle: document.getElementById('companyDialogTitle'),
    companyChoices: document.getElementById('companyChoices'),
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
    const units = [[1e15, 'Q'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
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

  function milestoneMultiplier() {
    let mult = 1;
    for (const milestone of MILESTONES) {
      if (state.totalGdp >= milestone.gdp) mult = milestone.mult;
    }
    return mult;
  }

  function clickPower() {
    return Math.pow(1.68, state.constructionLevel - 1) * milestoneMultiplier();
  }

  function playerIndustrialGps() {
    const raw = BUILDINGS.reduce((sum, building) => sum + (state.buildings[building.id] || 0) * building.baseGps, 0);
    return raw * milestoneMultiplier();
  }

  function companyIndustryIds(company) {
    if (!company) return [];
    return [...new Set([
      ...Object.keys(company.start || {}).filter(id => (company.start[id] || 0) > 0),
      ...(company.queue || [])
    ])].filter(id => BUILDING_BY_ID[id]);
  }

  function companyIsSpecialist(company) {
    return companyIndustryIds(company).length === 1;
  }

  function companyBuildCostFactor(company) {
    return companyIsSpecialist(company) ? SPECIALIST_BUILD_COST_FACTOR : COMPANY_BUILD_COST_FACTOR;
  }

  function companyIndustrialOutputPerSecond(slot) {
    if (!slot?.companyId) return 0;
    const raw = BUILDINGS.reduce((sum, building) => sum + (slot.buildings?.[building.id] || 0) * building.baseGps, 0);
    return raw * milestoneMultiplier();
  }

  function companyProfitPerSecond(slot) {
    if (!slot?.companyId) return 0;
    const company = COMPANY_BY_ID[slot.companyId];
    if (!company) return 0;
    const specialistMultiplier = companyIsSpecialist(company) ? SPECIALIST_PROFIT_MULTIPLIER : 1;
    return companyIndustrialOutputPerSecond(slot) * COMPANY_PROFIT_SHARE * specialistMultiplier;
  }

  function companyDividendsPerSecond() {
    return state.companies.reduce((sum, slot) => sum + companyProfitPerSecond(slot) * COMPANY_DIVIDEND_RATE, 0);
  }

  function gps() {
    return playerIndustrialGps() + companyDividendsPerSecond();
  }

  function companyOwned(buildingId) {
    return state.companies.reduce((sum, slot) => sum + (slot.buildings?.[buildingId] || 0), 0);
  }

  function marketOwned(buildingId) {
    return (state.buildings[buildingId] || 0) + companyOwned(buildingId);
  }

  function totalMarketBuildings() {
    return BUILDINGS.reduce((sum, building) => sum + marketOwned(building.id), 0);
  }

  function buildingCost(building, marketCount = marketOwned(building.id)) {
    return building.baseCost * Math.pow(1.155, marketCount);
  }

  function totalCost(building, amount) {
    if (amount <= 0) return 0;
    const first = buildingCost(building);
    const ratio = 1.155;
    return first * (1 - Math.pow(ratio, amount)) / (1 - ratio);
  }

  function maxAffordable(building) {
    const first = buildingCost(building);
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
    if (force && now - last[0] < 750) last[1] = state.totalGdp;
    else history.push([now, state.totalGdp]);

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
    const lineColour = styles.getPropertyValue('--gold-2').trim() || '#e4c77d';
    const gridColour = styles.getPropertyValue('--line-soft').trim() || '#483522';
    const mutedColour = styles.getPropertyValue('--muted').trim() || '#ad9b80';
    const fillColour = 'rgba(196, 154, 80, 0.12)';

    const stored = Array.isArray(state.gdpHistory) ? state.gdpHistory : [];
    const now = Date.now();
    const points = stored.map(point => [point[0], point[1]]);
    if (!points.length) points.push([now, state.totalGdp]);
    const last = points[points.length - 1];
    if (now > last[0]) points.push([now, state.totalGdp]);
    else last[1] = state.totalGdp;

    const pad = { left: 58, right: 10, top: 10, bottom: 24 };
    const plotW = Math.max(1, rect.width - pad.left - pad.right);
    const plotH = Math.max(1, rect.height - pad.top - pad.bottom);
    const firstTime = points[0][0];
    const lastTime = points[points.length - 1][0];
    const timeSpan = Math.max(HISTORY_SAMPLE_MS * 2, lastTime - firstTime);
    const xMin = lastTime - timeSpan;
    const maxObserved = Math.max(10, ...points.map(point => point[1]), state.totalGdp);
    const yMax = niceChartMax(maxObserved * 1.05);

    const xFor = time => pad.left + ((time - xMin) / timeSpan) * plotW;
    const yFor = value => pad.top + plotH - (Math.max(0, value) / yMax) * plotH;

    ctx.font = '10px system-ui, sans-serif';
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
      ctx.fillText(formatChartMoney(yMax * ratio), pad.left - 7, y);
    }

    const elapsed = Math.max(0, lastTime - firstTime);
    [0, 0.5, 1].forEach((ratio, index) => {
      const x = pad.left + ratio * plotW;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = index === 0 ? 'left' : index === 2 ? 'right' : 'center';
      ctx.fillText(formatChartDuration(Math.max(0, elapsed * ratio)), x, rect.height - 6);
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
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    if (els.chartRange) {
      els.chartRange.textContent = elapsed > 0 ? `${formatChartDuration(elapsed)} recorded` : 'Economic history begins now';
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
    return marketOwned(previous.id) > 0 || state.totalGdp >= BUILDINGS[buildingIndex].baseCost * 0.4;
  }

  function makeQueue(company, startCursor = 0) {
    const queue = [];
    for (let i = 0; i < COMPANY_QUEUE_SIZE; i += 1) {
      queue.push(company.queue[(startCursor + i) % company.queue.length]);
    }
    return queue;
  }

  function ensureCompanyQueue(slot) {
    const company = COMPANY_BY_ID[slot.companyId];
    if (!company) return;
    if (!Array.isArray(slot.queue)) slot.queue = [];
    while (slot.queue.length < COMPANY_QUEUE_SIZE) {
      const id = company.queue[slot.queueCursor % company.queue.length];
      slot.queue.push(id);
      slot.queueCursor += 1;
    }
  }

  function unlockCompanySlot(index) {
    const slot = state.companies[index];
    if (!slot || slot.unlocked) return;
    if (index > 0 && !state.companies[index - 1].unlocked) return;
    const cost = COMPANY_SLOT_COSTS[index];
    if (state.gdp + 1e-9 < cost) return;
    state.gdp -= cost;
    slot.unlocked = true;
    showToast(`Company slot ${index + 1} chartered for ${formatMoney(cost)}.`);
    render(true);
    openCompanyPicker(index);
  }

  function openCompanyPicker(index) {
    const slot = state.companies[index];
    if (!slot?.unlocked || slot.companyId) return;
    companyPickerSlot = index;
    els.companyDialogTitle.textContent = `Establish company in Slot ${index + 1}`;
    renderCompanyChoices(index);
    els.companyDialog.showModal();
  }

  function companyPortfolioText(slot) {
    const parts = BUILDINGS
      .filter(building => (slot.buildings?.[building.id] || 0) > 0)
      .map(building => `${building.icon} ${formatNumber(slot.buildings[building.id])} ${building.name}`);
    return parts.join(' · ') || 'No buildings';
  }

  function companyStartingPortfolioText(company) {
    return BUILDINGS
      .filter(building => (company.start[building.id] || 0) > 0)
      .map(building => `${building.icon} ${company.start[building.id]} ${building.name}`)
      .join(' · ');
  }

  function renderCompanyChoices(slotIndex) {
    const used = new Set(state.companies.map(slot => slot.companyId).filter(Boolean));
    const fragment = document.createDocumentFragment();
    COMPANIES.forEach(company => {
      const availableByTier = company.minSlot <= slotIndex;
      const alreadyUsed = used.has(company.id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'company-choice';
      button.disabled = !availableByTier || alreadyUsed;

      const unavailableText = alreadyUsed
        ? 'Already chartered'
        : !availableByTier
          ? `Available from Company Slot ${company.minSlot + 1}`
          : 'Establish company';

      button.innerHTML = `
        <span class="company-choice-head"><strong>${company.name}</strong><span>${company.country}</span></span>
        <p>${company.note}</p>
        <small>${companyStartingPortfolioText(company)}</small>
        <span class="company-perk">${companyIsSpecialist(company) ? 'Specialist: +25% profit · builds at 35% of market price' : 'Builds at 55% of market price'}</span>
        ${button.disabled ? `<p class="unavailable">${unavailableText}</p>` : ''}`;

      if (!button.disabled) {
        button.addEventListener('click', () => establishCompany(slotIndex, company.id));
      }
      fragment.appendChild(button);
    });
    els.companyChoices.replaceChildren(fragment);
  }

  function establishCompany(slotIndex, companyId) {
    const slot = state.companies[slotIndex];
    const company = COMPANY_BY_ID[companyId];
    if (!slot?.unlocked || slot.companyId || !company || company.minSlot > slotIndex) return;
    if (state.companies.some(other => other.companyId === companyId)) return;

    slot.companyId = companyId;
    slot.cash = 0;
    slot.buildings = Object.fromEntries(BUILDINGS.map(building => [building.id, Math.max(0, Math.floor(company.start[building.id] || 0))]));
    slot.queueCursor = COMPANY_QUEUE_SIZE;
    slot.queue = makeQueue(company, 0);
    els.companyDialog.close();
    companyPickerSlot = null;
    showToast(`${company.name} established. Private capital has opinions now.`);
    render(true);
  }

  function disbandCompany(slotIndex) {
    const slot = state.companies[slotIndex];
    const company = COMPANY_BY_ID[slot?.companyId];
    if (!slot?.unlocked || !company) return;

    const profit = companyProfitPerSecond(slot);
    const payout = profit * 10;
    const confirmed = window.confirm(
      `Disband ${company.name}?\n\nYou will receive ${formatMoney(payout)} (10 seconds of current company profit). The company's cash and buildings will be lost, but the company slot stays unlocked.`
    );
    if (!confirmed) return;

    if (payout > 0) addGdp(payout);
    slot.companyId = null;
    slot.cash = 0;
    slot.buildings = Object.fromEntries(BUILDINGS.map(building => [building.id, 0]));
    slot.queue = [];
    slot.queueCursor = 0;
    showToast(`${company.name} disbanded. Liquidation returned ${formatMoney(payout)}.`);
    saveGame(false);
    render(true);
  }

  function companyBuildingCost(slot, building) {
    if (!slot?.companyId || !building) return 0;
    const company = COMPANY_BY_ID[slot.companyId];
    if (!company) return buildingCost(building);
    return buildingCost(building) * companyBuildCostFactor(company);
  }

  function companyNextCost(slot) {
    ensureCompanyQueue(slot);
    const building = BUILDING_BY_ID[slot.queue[0]];
    return building ? companyBuildingCost(slot, building) : 0;
  }

  function processCompanyPurchases(slot, purchaseLimit = 20) {
    if (!slot?.companyId) return 0;
    const company = COMPANY_BY_ID[slot.companyId];
    if (!company) return 0;
    ensureCompanyQueue(slot);
    let purchases = 0;

    while (purchases < purchaseLimit && slot.queue.length) {
      const buildingId = slot.queue[0];
      const building = BUILDING_BY_ID[buildingId];
      if (!building) {
        slot.queue.shift();
        ensureCompanyQueue(slot);
        continue;
      }
      const cost = companyBuildingCost(slot, building);
      if (slot.cash + 1e-9 < cost) break;
      slot.cash -= cost;
      slot.buildings[buildingId] = (slot.buildings[buildingId] || 0) + 1;
      slot.queue.shift();
      const next = company.queue[slot.queueCursor % company.queue.length];
      slot.queue.push(next);
      slot.queueCursor += 1;
      purchases += 1;
    }
    return purchases;
  }

  function advanceEconomy(dt, purchaseLimit = 20) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const playerGain = playerIndustrialGps() * dt;
    let dividendGain = 0;

    for (const slot of state.companies) {
      if (!slot.companyId) continue;
      const profit = companyProfitPerSecond(slot);
      const dividends = profit * COMPANY_DIVIDEND_RATE;
      const retained = profit - dividends;
      dividendGain += dividends * dt;
      slot.cash += retained * dt;
      processCompanyPurchases(slot, purchaseLimit);
    }

    addGdp(playerGain + dividendGain);
  }

  const buildingUi = new Map();
  const achievementUi = [];
  const companyUi = [];

  function initBuildings() {
    const fragment = document.createDocumentFragment();
    BUILDINGS.forEach(building => {
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
        <span class="building-price"><strong></strong><small></small></span>`;
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
      const companyCount = companyOwned(building.id);
      const eachOutput = building.baseGps * milestoneMultiplier();
      const contribution = owned * eachOutput;

      ui.btn.disabled = !open || amount < 1 || state.gdp + 1e-9 < cost;
      ui.btn.setAttribute('aria-label', open ? `Buy ${displayAmount} ${building.name}` : `${building.name} locked`);
      ui.owned.textContent = companyCount > 0 ? `State ${formatNumber(owned)} · Co. ${formatNumber(companyCount)}` : `Owned ${formatNumber(owned)}`;
      ui.desc.textContent = open ? building.blurb : `Unlock by developing ${BUILDINGS[index - 1].name}.`;
      ui.price.textContent = open ? formatMoney(cost) : 'Locked';
      ui.output.textContent = open
        ? `+${formatMoney(eachOutput)}/s each${contribution > 0 ? ` · ${formatMoney(contribution)}/s` : ''}`
        : '';
    });
  }

  function initAchievements() {
    const definitions = [
      ['Subsistence Escape Velocity', '10 buildings'],
      ['Workshop of the World', '£1M produced'],
      ['Construction Enjoyer', '500 clicks'],
      ['Motorised Society', 'Automobiles']
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
      totalMarketBuildings() >= 10,
      state.totalGdp >= 1e6,
      state.totalClicks >= 500,
      marketOwned('autos') >= 1
    ];
    achievementUi.forEach((ui, index) => {
      ui.row.classList.toggle('unlocked', met[index]);
      ui.title.textContent = `${met[index] ? '✓ ' : '○ '}${ui.name}`;
    });
  }

  function initCompanySlots() {
    const fragment = document.createDocumentFragment();
    COMPANY_SLOT_COSTS.forEach((cost, index) => {
      const root = document.createElement('article');
      root.className = 'company-slot';

      const locked = document.createElement('div');
      locked.className = 'company-empty';
      locked.innerHTML = `
        <div><span class="company-slot-title">Company Slot ${index + 1}</span><span class="company-slot-sub"></span></div>
        <button class="slot-button" type="button"></button>`;
      const lockedSub = locked.querySelector('.company-slot-sub');
      const unlockButton = locked.querySelector('.slot-button');
      unlockButton.addEventListener('click', () => unlockCompanySlot(index));

      const empty = document.createElement('div');
      empty.className = 'company-empty';
      empty.hidden = true;
      empty.innerHTML = `
        <div><span class="company-slot-title">Company Slot ${index + 1}</span><span class="company-slot-sub">Charter available. Select a firm.</span></div>
        <button class="establish-button" type="button">Establish</button>`;
      empty.querySelector('.establish-button').addEventListener('click', () => openCompanyPicker(index));

      const active = document.createElement('div');
      active.hidden = true;
      active.innerHTML = `
        <div class="company-card-head"><strong class="company-name"></strong><span class="company-country"></span></div>
        <div class="company-metrics">
          <div class="company-metric"><span>Cash</span><strong class="company-cash"></strong></div>
          <div class="company-metric"><span>Profit/s</span><strong class="company-profit"></strong></div>
          <div class="company-metric"><span>Dividend/s</span><strong class="company-dividend"></strong></div>
        </div>
        <div class="company-portfolio"><strong>Portfolio:</strong> <span></span></div>
        <div class="queue-row">
          <span class="queue-label">Build</span>
          <div class="build-queue"></div>
          <span class="queue-cost"></span>
        </div>
        <div class="company-actions">
          <button class="disband-company" type="button">Disband</button>
          <span class="disband-refund"></span>
        </div>`;

      const queueContainer = active.querySelector('.build-queue');
      const queueTiles = [];
      for (let i = 0; i < COMPANY_QUEUE_SIZE; i += 1) {
        const tile = document.createElement('span');
        tile.className = `queue-tile${i === 0 ? ' next' : ''}`;
        queueContainer.appendChild(tile);
        queueTiles.push(tile);
      }

      active.querySelector('.disband-company').addEventListener('click', () => disbandCompany(index));

      root.append(locked, empty, active);
      fragment.appendChild(root);
      companyUi.push({
        root,
        locked,
        lockedSub,
        unlockButton,
        empty,
        active,
        name: active.querySelector('.company-name'),
        country: active.querySelector('.company-country'),
        cash: active.querySelector('.company-cash'),
        profit: active.querySelector('.company-profit'),
        dividend: active.querySelector('.company-dividend'),
        portfolio: active.querySelector('.company-portfolio span'),
        queueTiles,
        queueCost: active.querySelector('.queue-cost'),
        disbandRefund: active.querySelector('.disband-refund')
      });
    });
    els.companySlots.replaceChildren(fragment);
  }

  function renderCompanies() {
    companyUi.forEach((ui, index) => {
      const slot = state.companies[index];
      const cost = COMPANY_SLOT_COSTS[index];
      const previousReady = index === 0 || state.companies[index - 1].unlocked;
      const isLocked = !slot.unlocked;
      const isEmpty = slot.unlocked && !slot.companyId;
      const isActive = Boolean(slot.companyId);

      ui.root.classList.toggle('locked', isLocked);
      ui.locked.hidden = !isLocked;
      ui.empty.hidden = !isEmpty;
      ui.active.hidden = !isActive;

      if (isLocked) {
        ui.lockedSub.textContent = previousReady ? `Charter cost: ${formatMoney(cost)}` : `Unlock Company Slot ${index} first.`;
        ui.unlockButton.textContent = formatMoney(cost);
        ui.unlockButton.disabled = !previousReady || state.gdp + 1e-9 < cost;
      }

      if (isActive) {
        const company = COMPANY_BY_ID[slot.companyId];
        if (!company) return;
        ensureCompanyQueue(slot);
        const profit = companyProfitPerSecond(slot);
        const dividend = profit * COMPANY_DIVIDEND_RATE;
        ui.name.textContent = company.name;
        ui.country.textContent = company.country;
        ui.cash.textContent = formatMoney(slot.cash);
        ui.profit.textContent = formatMoney(profit);
        ui.dividend.textContent = `+${formatMoney(dividend)}`;
        ui.disbandRefund.textContent = `Refund: ${formatMoney(profit * 10)}`;
        ui.portfolio.textContent = companyPortfolioText(slot);
        ui.queueTiles.forEach((tile, tileIndex) => {
          const building = BUILDING_BY_ID[slot.queue[tileIndex]];
          tile.textContent = building?.icon || '·';
          tile.title = building?.name || '';
        });
        const nextBuilding = BUILDING_BY_ID[slot.queue[0]];
        if (nextBuilding) {
          const factor = companyBuildCostFactor(company);
          ui.queueCost.textContent = `${formatMoney(companyNextCost(slot))} @ ${Math.round(factor * 100)}%`;
          ui.queueCost.title = `Company construction discount: pays ${Math.round(factor * 100)}% of current market price`;
        } else {
          ui.queueCost.textContent = '';
          ui.queueCost.title = '';
        }
      }
    });

    els.companyDividendValue.textContent = `+${formatMoney(companyDividendsPerSecond())}/s`;
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
    els.industryCount.textContent = formatNumber(totalMarketBuildings());
    els.globalMultiplier.textContent = `×${milestoneMultiplier().toFixed(2)}`;
    els.totalGdpValue.textContent = formatMoney(state.totalGdp);
    els.constructionLevel.textContent = `Level ${state.constructionLevel}`;
    els.constructGain.textContent = `+${formatMoney(click)} GDP`;

    const needed = xpNeeded();
    els.xpText.textContent = `${formatNumber(state.constructionXp)} / ${formatNumber(needed)}`;
    els.xpBar.style.width = `${Math.max(0, Math.min(100, state.constructionXp / needed * 100))}%`;

    const next = MILESTONES.find(milestone => state.totalGdp < milestone.gdp);
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
    renderCompanies();
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

    if (Array.isArray(data.companies)) {
      for (let i = 0; i < COMPANY_SLOT_COSTS.length; i += 1) {
        const source = data.companies[i];
        if (!source || typeof source !== 'object') continue;
        const target = clean.companies[i];
        target.unlocked = Boolean(source.unlocked);
        target.cash = safeNumber(source.cash);
        target.companyId = COMPANY_BY_ID[source.companyId] ? source.companyId : null;
        if (target.companyId) target.unlocked = true;
        for (const building of BUILDINGS) {
          target.buildings[building.id] = Math.max(0, Math.floor(safeNumber(source.buildings?.[building.id])));
        }
        const company = COMPANY_BY_ID[target.companyId];
        if (company) {
          target.queue = Array.isArray(source.queue)
            ? source.queue.filter(id => company.queue.includes(id)).slice(0, COMPANY_QUEUE_SIZE)
            : [];
          target.queueCursor = Math.max(0, Math.floor(safeNumber(source.queueCursor)));
          ensureCompanyQueueFor(target, company);
        }
      }
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

  function ensureCompanyQueueFor(slot, company) {
    if (!Array.isArray(slot.queue)) slot.queue = [];
    while (slot.queue.length < COMPANY_QUEUE_SIZE) {
      const id = company.queue[slot.queueCursor % company.queue.length];
      slot.queue.push(id);
      slot.queueCursor += 1;
    }
  }

  function safeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
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
      return document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(prefix))?.slice(prefix.length) || null;
    } catch (_) {
      return null;
    }
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

    const cookieState = { ...state, gdpHistory: [] };
    setCookie(COOKIE_KEY, encodeSave(cookieState));
    els.saveIndicator.textContent = saved ? 'Saved' : 'Cookie save';
    if (showMessage) showToast('Economy saved. The bureaucracy approves.');
  }

  function applyOfflineProduction(elapsed) {
    let remaining = elapsed;
    let totalGain = 0;
    while (remaining > 0) {
      const step = Math.min(30, remaining);
      const before = state.totalGdp;
      advanceEconomy(step, 200);
      totalGain += state.totalGdp - before;
      remaining -= step;
    }
    return totalGain;
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
      const offlineGain = elapsed > 0 ? applyOfflineProduction(elapsed) : 0;
      if (offlineGain > 0.01 && elapsed > 10) {
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
    advanceEconomy(dt, 20);
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
  els.companyDialog.addEventListener('close', () => { companyPickerSlot = null; });

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
  initCompanySlots();
  render(true);
  requestAnimationFrame(tick);
})();
