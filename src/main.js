import { fetchWeatherBundle, lookupLocationLabel, parseLatLonInput, searchLocations } from "./api.js";
import {
  ALERTS_PROVIDER,
  APP_NAME,
  AUTO_REFRESH_MS,
  DEFAULT_COMPARISON_MODE,
  FORECAST_PROVIDER,
  LOS_ANGELES_EXAMPLE,
} from "./constants.js";
import { buildForecastDiff } from "./diff.js";
import { normalizeWeatherData } from "./normalize.js";
import {
  applyRetentionLimit,
  getA2hsDismissed,
  getLastLocation,
  getSettings,
  getSnapshotsForLocation,
  saveLastLocation,
  saveSettings,
  saveSnapshot,
  setA2hsDismissed,
} from "./storage.js";
import {
  cToF,
  formatClock,
  formatDateTime,
  formatDayLabel,
  formatMillimeters,
  formatPercent,
  formatRelativeForecastLabel,
  formatTemperature,
  formatWind,
  sanitizeText,
} from "./utils.js";

const elements = {
  mainContent: document.getElementById("main-content"),
  searchForm: document.getElementById("search-form"),
  locationInput: document.getElementById("location-input"),
  searchResults: document.getElementById("search-results"),
  geoButton: document.getElementById("geo-btn"),
  quickLaButton: document.getElementById("quick-la-btn"),
  quickRefreshButton: document.getElementById("quick-refresh-btn"),
  locationSummary: document.getElementById("location-summary"),
  refreshButton: document.getElementById("refresh-btn"),
  compareLatestButton: document.getElementById("compare-latest-btn"),
  openSettingsButton: document.getElementById("open-settings-btn"),
  errorBox: document.getElementById("error-box"),
  offlineBadge: document.getElementById("offline-badge"),
  confidenceBadge: document.getElementById("confidence-badge"),
  lastUpdated: document.getElementById("last-updated"),
  comparedTo: document.getElementById("compared-to"),
  dataSource: document.getElementById("data-source"),
  honestySummary: document.getElementById("honesty-summary"),
  stabilityScore: document.getElementById("stability-score"),
  stabilityReason: document.getElementById("stability-reason"),
  stabilityMeter: document.getElementById("stability-meter"),
  metricChanged: document.getElementById("metric-changed"),
  metricUnchanged: document.getElementById("metric-unchanged"),
  metricLargest: document.getElementById("metric-largest"),
  metricAlerts: document.getElementById("metric-alerts"),
  metricSnapshots: document.getElementById("metric-snapshots"),
  nowCard: document.getElementById("now-card"),
  tempTrend: document.getElementById("temp-trend"),
  trendSummary: document.getElementById("trend-summary"),
  trendEmpty: document.getElementById("trend-empty"),
  todayList: document.getElementById("today-list"),
  weekList: document.getElementById("week-list"),
  modeHourly: document.getElementById("mode-hourly"),
  modeDaily: document.getElementById("mode-daily"),
  changesIntro: document.getElementById("changes-intro"),
  changesList: document.getElementById("changes-list"),
  noChanges: document.getElementById("no-changes"),
  snapshotTimeline: document.getElementById("snapshot-timeline"),
  rawData: document.getElementById("raw-data"),
  whyButton: document.getElementById("why-btn"),
  whyDialog: document.getElementById("why-dialog"),
  settingsDialog: document.getElementById("settings-dialog"),
  settingsForm: document.getElementById("settings-form"),
  closeSettingsButton: document.getElementById("close-settings-btn"),
  temperatureUnit: document.getElementById("temperature-unit"),
  windUnit: document.getElementById("wind-unit"),
  timeFormat: document.getElementById("time-format"),
  autoRefresh: document.getElementById("auto-refresh"),
  retentionLimit: document.getElementById("retention-limit"),
  a2hsBanner: document.getElementById("a2hs-banner"),
  a2hsInstall: document.getElementById("a2hs-install-btn"),
  a2hsDismiss: document.getElementById("a2hs-dismiss-btn"),
};

const state = {
  settings: getSettings(),
  currentLocation: getLastLocation(),
  comparisonMode: DEFAULT_COMPARISON_MODE,
  snapshots: [],
  currentSnapshot: null,
  previousSnapshot: null,
  diff: null,
  searchResults: [],
  loading: false,
  autoRefreshTimer: null,
  deferredInstallPrompt: null,
};

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text != null) {
    element.textContent = String(text);
  }
  return element;
}

function clearChildren(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function showError(message) {
  const text = sanitizeText(message);
  if (!text) {
    elements.errorBox.classList.add("hidden");
    elements.errorBox.textContent = "";
    return;
  }
  elements.errorBox.textContent = text;
  elements.errorBox.classList.remove("hidden");
}

function setLoading(loading, label = "Refresh forecast") {
  state.loading = loading;
  elements.mainContent?.setAttribute("aria-busy", String(loading));
  elements.refreshButton.disabled = loading || !state.currentLocation;
  elements.quickRefreshButton.disabled = loading || !state.currentLocation;
  elements.compareLatestButton.disabled = loading || !state.currentLocation;
  elements.refreshButton.textContent = loading ? "Refreshing..." : label;
}

function updateOfflineBadge() {
  const isOffline = !navigator.onLine;
  elements.offlineBadge.classList.toggle("hidden", !isOffline);
  if (isOffline && state.currentSnapshot) {
    showError("Offline mode: showing last saved forecast snapshot.");
    elements.refreshButton.disabled = true;
    elements.quickRefreshButton.disabled = true;
  } else if (!state.loading) {
    elements.refreshButton.disabled = !state.currentLocation;
    elements.quickRefreshButton.disabled = !state.currentLocation;
  }
}

function renderLocationSummary() {
  if (!state.currentLocation) {
    elements.locationSummary.textContent = "No location selected.";
    return;
  }
  const { name, latitude, longitude } = state.currentLocation;
  elements.locationSummary.textContent = `${name} (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
}

function readSnapshotPair() {
  if (!state.currentLocation) {
    state.snapshots = [];
    state.currentSnapshot = null;
    state.previousSnapshot = null;
    return;
  }
  state.snapshots = getSnapshotsForLocation(state.currentLocation.id);
  state.currentSnapshot = state.snapshots[0] ?? null;
  state.previousSnapshot = state.snapshots[1] ?? null;
}

function renderNowCard() {
  clearChildren(elements.nowCard);
  if (!state.currentSnapshot) {
    elements.nowCard.append(createElement("p", "muted", "No forecast loaded."));
    return;
  }
  const now = state.currentSnapshot.normalized.current;
  const headline = createElement("p", "temp", formatTemperature(now.temperatureC, state.settings.temperatureUnit));
  const condition = createElement("p", "", `${now.conditionIcon} ${now.conditionLabel}`);
  const meta = createElement(
    "p",
    "muted",
    `Wind ${formatWind(now.windKph, state.settings.windUnit)} | Precip ${formatPercent(now.precipProbability)} | ${formatMillimeters(now.precipMm)}`
  );
  const stamp = createElement("p", "muted", `Observed at ${formatClock(now.time, state.settings.timeFormat)}`);
  elements.nowCard.append(headline, condition, meta, stamp);
}

function toDisplayTemperatureValue(valueC) {
  if (valueC == null || Number.isNaN(Number(valueC))) {
    return null;
  }
  if (state.settings.temperatureUnit === "fahrenheit") {
    return cToF(Number(valueC));
  }
  return Number(valueC);
}

function getLargestChangeLabel(metrics) {
  const largest = metrics?.largestChange;
  if (!largest) {
    return "No major shift";
  }
  if (largest.type === "temperature") {
    return `${formatTemperature(largest.from, state.settings.temperatureUnit)} -> ${formatTemperature(largest.to, state.settings.temperatureUnit)}`;
  }
  if (largest.type === "wind") {
    return `${formatWind(largest.from, state.settings.windUnit)} -> ${formatWind(largest.to, state.settings.windUnit)}`;
  }
  if (largest.type === "precip_probability") {
    return `${formatPercent(largest.from)} -> ${formatPercent(largest.to)}`;
  }
  if (largest.type === "precip_amount") {
    return `${formatMillimeters(largest.from)} -> ${formatMillimeters(largest.to)}`;
  }
  return "Shift detected";
}

function renderHonestyReport() {
  const diff = state.diff;
  const confidence = diff?.confidence ?? { label: "Unknown", score: 0, reason: "" };
  const metrics = diff?.metrics ?? {
    totalComparedWindows: 0,
    changedWindows: 0,
    unchangedWindows: 0,
    alertsChanges: 0,
  };
  const score =
    confidence.label === "Unknown" ? "--" : `${Math.max(0, Math.round(confidence.score))}/100`;
  elements.stabilityScore.textContent = score;
  elements.stabilityReason.textContent =
    confidence.reason || "Confidence is based on stability across snapshots.";
  elements.stabilityMeter.style.width =
    confidence.label === "Unknown" ? "4%" : `${Math.max(4, Math.round(confidence.score))}%`;
  elements.metricChanged.textContent = String(metrics.changedWindows ?? 0);
  elements.metricUnchanged.textContent = String(metrics.unchangedWindows ?? 0);
  elements.metricLargest.textContent = getLargestChangeLabel(metrics);
  elements.metricAlerts.textContent = String(metrics.alertsChanges ?? 0);
  elements.metricSnapshots.textContent = String(state.snapshots.length);
}

function renderTemperatureTrend() {
  if (!state.currentSnapshot) {
    elements.tempTrend.innerHTML = '<p id="trend-empty" class="muted">Load forecast data to view trend.</p>';
    elements.trendSummary.textContent = "No trend data yet.";
    return;
  }
  const currentTime = new Date(state.currentSnapshot.normalized.current.time ?? state.currentSnapshot.fetchedAt);
  const rows = (state.currentSnapshot.normalized.hourly ?? [])
    .filter((row) => new Date(row.time).getTime() >= currentTime.getTime())
    .slice(0, 24);
  if (rows.length < 2) {
    elements.tempTrend.innerHTML =
      '<p id="trend-empty" class="muted">Not enough hourly points to draw trend.</p>';
    elements.trendSummary.textContent = "Need at least two hourly points.";
    return;
  }
  const trendRows = rows
    .map((row) => ({
      row,
      value: toDisplayTemperatureValue(row.temperatureC),
    }))
    .filter((entry) => entry.value != null);
  if (trendRows.length < 2) {
    elements.tempTrend.innerHTML =
      '<p id="trend-empty" class="muted">Trend unavailable due to missing temperatures.</p>';
    elements.trendSummary.textContent = "Temperature data is incomplete.";
    return;
  }
  const validValues = trendRows.map((entry) => Number(entry.value));
  const minValue = Math.min(...validValues);
  const maxValue = Math.max(...validValues);
  const spread = Math.max(1, maxValue - minValue);
  const width = 320;
  const height = 138;
  const padding = 16;
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  const points = validValues.map((value, index) => {
    const x = padding + (index / (trendRows.length - 1)) * innerWidth;
    const y = padding + ((maxValue - value) / spread) * innerHeight;
    return [x, y];
  });
  const polyline = points.map((point) => `${point[0].toFixed(2)},${point[1].toFixed(2)}`).join(" ");
  const areaPath = [
    `M ${points[0][0].toFixed(2)} ${height - padding}`,
    ...points.map((point) => `L ${point[0].toFixed(2)} ${point[1].toFixed(2)}`),
    `L ${points[points.length - 1][0].toFixed(2)} ${height - padding}`,
    "Z",
  ].join(" ");
  const midY = padding + innerHeight / 2;
  const startLabel = formatClock(trendRows[0].row.time, state.settings.timeFormat);
  const endLabel = formatClock(trendRows[trendRows.length - 1].row.time, state.settings.timeFormat);
  const unitSymbol = state.settings.temperatureUnit === "fahrenheit" ? "F" : "C";
  elements.tempTrend.innerHTML = `
    <svg class="trend-svg" viewBox="0 0 ${width} ${height}" aria-label="Temperature trend chart">
      <g class="trend-grid">
        <line x1="${padding}" y1="${padding}" x2="${width - padding}" y2="${padding}" />
        <line x1="${padding}" y1="${midY}" x2="${width - padding}" y2="${midY}" />
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" />
      </g>
      <path class="trend-area" d="${areaPath}" />
      <polyline class="trend-line" points="${polyline}" />
      <circle class="trend-dot" cx="${points[0][0].toFixed(2)}" cy="${points[0][1].toFixed(2)}" r="3.2" />
      <circle class="trend-dot" cx="${points[points.length - 1][0].toFixed(2)}" cy="${points[points.length - 1][1].toFixed(2)}" r="3.2" />
      <text x="${padding}" y="${height - 3}" fill="currentColor" font-size="10">${startLabel}</text>
      <text x="${width - padding}" y="${height - 3}" fill="currentColor" font-size="10" text-anchor="end">${endLabel}</text>
    </svg>
  `;
  elements.trendSummary.textContent = `Range ${Math.round(minValue)} to ${Math.round(maxValue)} ${unitSymbol} across the next ${trendRows.length} hours.`;
}

function renderTodayList() {
  clearChildren(elements.todayList);
  if (!state.currentSnapshot) {
    elements.todayList.append(createElement("li", "muted", "No data available."));
    return;
  }
  const currentTime = new Date(state.currentSnapshot.normalized.current.time ?? state.currentSnapshot.fetchedAt);
  const nextHours = (state.currentSnapshot.normalized.hourly ?? [])
    .filter((row) => new Date(row.time).getTime() >= currentTime.getTime())
    .slice(0, 12);

  if (!nextHours.length) {
    elements.todayList.append(createElement("li", "muted", "No hourly rows available."));
    return;
  }

  for (const hour of nextHours) {
    const item = createElement("li", "forecast-row");
    const label = createElement(
      "strong",
      "",
      formatRelativeForecastLabel(hour.time, currentTime, state.settings.timeFormat)
    );
    const details = createElement("div", "forecast-meta");
    details.append(
      createElement("span", "", `${hour.conditionIcon} ${hour.conditionLabel}`),
      createElement("span", "", formatTemperature(hour.temperatureC, state.settings.temperatureUnit)),
      createElement("span", "", `Precip ${formatPercent(hour.precipProbability)}`),
      createElement("span", "", `Wind ${formatWind(hour.windKph, state.settings.windUnit)}`)
    );
    item.append(label, details);
    elements.todayList.append(item);
  }
}

function renderWeekList() {
  clearChildren(elements.weekList);
  if (!state.currentSnapshot) {
    elements.weekList.append(createElement("li", "muted", "No data available."));
    return;
  }
  const dailyRows = state.currentSnapshot.normalized.daily ?? [];
  if (!dailyRows.length) {
    elements.weekList.append(createElement("li", "muted", "No daily rows available."));
    return;
  }
  for (const day of dailyRows.slice(0, 7)) {
    const item = createElement("li", "forecast-row");
    const date = createElement("strong", "", formatDayLabel(day.date));
    const details = createElement("div", "forecast-meta");
    details.append(
      createElement("span", "", `${day.conditionIcon} ${day.conditionLabel}`),
      createElement(
        "span",
        "",
        `${formatTemperature(day.tempMinC, state.settings.temperatureUnit)} / ${formatTemperature(day.tempMaxC, state.settings.temperatureUnit)}`
      ),
      createElement("span", "", `Precip ${formatPercent(day.precipProbabilityMax)}`),
      createElement("span", "", `Wind ${formatWind(day.windMaxKph, state.settings.windUnit)}`)
    );
    item.append(date, details);
    elements.weekList.append(item);
  }
}

function formatDiffMessage(change) {
  const since = formatClock(state.diff?.comparedTo, state.settings.timeFormat);
  if (!change) {
    return "";
  }
  if (change.type === "temperature") {
    return `${change.label}: temperature changed ${formatTemperature(change.from, state.settings.temperatureUnit)} -> ${formatTemperature(change.to, state.settings.temperatureUnit)} since ${since}.`;
  }
  if (change.type === "wind") {
    return `${change.label}: wind changed ${formatWind(change.from, state.settings.windUnit)} -> ${formatWind(change.to, state.settings.windUnit)} since ${since}.`;
  }
  if (change.type === "precip_probability") {
    return `${change.label}: precip chance changed ${formatPercent(change.from)} -> ${formatPercent(change.to)} since ${since}.`;
  }
  if (change.type === "precip_amount") {
    return `${change.label}: precip amount changed ${formatMillimeters(change.from)} -> ${formatMillimeters(change.to)} since ${since}.`;
  }
  if (change.type === "condition") {
    return `${change.label}: condition changed "${change.from}" -> "${change.to}" since ${since}.`;
  }
  return change.message;
}

function formatChangeTag(changeType) {
  const labels = {
    temperature: "Temperature",
    precip_probability: "Precip chance",
    precip_amount: "Precip amount",
    wind: "Wind",
    condition: "Condition",
    alerts_added: "Alert added",
    alerts_removed: "Alert removed",
    alerts_updated: "Alert updated",
    provider: "Provider",
    units: "Units",
  };
  return labels[changeType] ?? "Change";
}

function renderChanges() {
  clearChildren(elements.changesList);
  elements.noChanges.classList.add("hidden");

  if (!state.currentSnapshot) {
    elements.changesIntro.textContent = "Fetch a forecast to start tracking changes.";
    return;
  }
  if (!state.previousSnapshot || !state.diff || !state.diff.hasBaseline) {
    elements.changesIntro.textContent = "Fetch again later to compare against a previous snapshot.";
    return;
  }

  elements.changesIntro.textContent = `Showing ${state.comparisonMode} changes since ${formatDateTime(state.previousSnapshot.fetchedAt, state.settings.timeFormat)}.`;
  if (!state.diff.hasChanges) {
    elements.noChanges.textContent = state.diff.unchangedMessage;
    elements.noChanges.classList.remove("hidden");
    return;
  }
  for (const change of state.diff.summary) {
    const item = createElement("li", `change-item ${change.type}`);
    const head = createElement("div", "change-head");
    head.append(
      createElement("span", "change-tag", formatChangeTag(change.type)),
      createElement("span", "muted", change.label ?? "")
    );
    item.append(head, createElement("p", "", formatDiffMessage(change)));
    elements.changesList.append(item);
  }
}

function renderTimeline() {
  clearChildren(elements.snapshotTimeline);
  if (!state.snapshots.length) {
    elements.snapshotTimeline.append(createElement("li", "muted", "No snapshots yet."));
    return;
  }
  for (const [index, snapshot] of state.snapshots.slice(0, 10).entries()) {
    const item = createElement("li", "");
    const prefix = index === 0 ? "Latest" : `Snapshot ${index + 1}`;
    const stamp = createElement("time", "", formatDateTime(snapshot.fetchedAt, state.settings.timeFormat));
    stamp.dateTime = snapshot.fetchedAt;
    const tempText = formatTemperature(
      snapshot.normalized?.current?.temperatureC ?? null,
      state.settings.temperatureUnit
    );
    item.append(
      createElement("span", "", `${prefix}: `),
      stamp,
      createElement("span", "muted", ` (${snapshot.normalized?.current?.conditionLabel ?? "Unknown"}, ${tempText})`)
    );
    elements.snapshotTimeline.append(item);
  }
}

function renderRawData() {
  if (!state.currentSnapshot) {
    elements.rawData.textContent = "No raw data loaded.";
    return;
  }
  elements.rawData.textContent = JSON.stringify(state.currentSnapshot.raw, null, 2);
}

function renderStatus() {
  elements.confidenceBadge.classList.remove("high", "medium", "low");
  if (!state.currentSnapshot) {
    elements.lastUpdated.textContent = "Never";
    elements.comparedTo.textContent = "No previous snapshot";
    elements.dataSource.textContent = "Data source: none loaded yet";
    elements.confidenceBadge.textContent = "Confidence: Unknown";
    elements.honestySummary.textContent =
      "Honesty summary: we need two snapshots for side-by-side comparison.";
    return;
  }
  const comparedToText = state.previousSnapshot
    ? formatDateTime(state.previousSnapshot.fetchedAt, state.settings.timeFormat)
    : "No previous snapshot";
  elements.lastUpdated.textContent = formatDateTime(
    state.currentSnapshot.fetchedAt,
    state.settings.timeFormat
  );
  elements.comparedTo.textContent = comparedToText;

  const modelRun = state.currentSnapshot.sourceMeta?.modelRunTime
    ? formatDateTime(state.currentSnapshot.sourceMeta.modelRunTime, state.settings.timeFormat)
    : "not provided";
  const alertsStatus = state.currentSnapshot.sourceMeta?.alertsStatus ?? "unknown";
  elements.dataSource.textContent = `Data source: ${FORECAST_PROVIDER.name} ${FORECAST_PROVIDER.version} + ${ALERTS_PROVIDER.name} (${alertsStatus}), model run ${modelRun}, fetched ${formatClock(state.currentSnapshot.fetchedAt, state.settings.timeFormat)}.`;

  const confidence = state.diff?.confidence ?? { label: "Unknown", reason: "" };
  elements.confidenceBadge.textContent = `Confidence: ${confidence.label}`;
  elements.confidenceBadge.title = confidence.reason || "";
  if (confidence.label === "High") {
    elements.confidenceBadge.classList.add("high");
  } else if (confidence.label === "Medium") {
    elements.confidenceBadge.classList.add("medium");
  } else if (confidence.label === "Low") {
    elements.confidenceBadge.classList.add("low");
  }
  const metrics = state.diff?.metrics;
  if (!state.diff?.hasBaseline || !metrics) {
    elements.honestySummary.textContent =
      "Honesty summary: capture another snapshot to compute real change rates.";
  } else {
    const rate = Math.round((metrics.changeRate ?? 0) * 100);
    elements.honestySummary.textContent = `Honesty summary: ${metrics.changedWindows}/${metrics.totalComparedWindows} windows changed (${rate}%).`;
  }
}

function applyWeatherTheme() {
  if (!state.currentSnapshot) {
    document.body.dataset.weatherTheme = "default";
    return;
  }
  const code = Number(state.currentSnapshot.normalized?.current?.weatherCode ?? -1);
  if ([0, 1].includes(code)) {
    document.body.dataset.weatherTheme = "clear";
    return;
  }
  if ([2, 3, 45, 48].includes(code)) {
    document.body.dataset.weatherTheme = "cloudy";
    return;
  }
  if ([95, 96, 99].includes(code)) {
    document.body.dataset.weatherTheme = "storm";
    return;
  }
  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    document.body.dataset.weatherTheme = "snow";
    return;
  }
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    document.body.dataset.weatherTheme = "rain";
    return;
  }
  document.body.dataset.weatherTheme = "default";
}

function renderSearchResults() {
  clearChildren(elements.searchResults);
  if (!state.searchResults.length) {
    return;
  }
  for (const [index, result] of state.searchResults.entries()) {
    const li = createElement("li", "");
    const button = createElement("button", "", result.name);
    button.type = "button";
    button.dataset.index = String(index);
    button.addEventListener("click", async () => {
      await selectLocation(result);
      state.searchResults = [];
      renderSearchResults();
    });
    li.append(button);
    elements.searchResults.append(li);
  }
}

function renderComparisonToggle() {
  const hourlyActive = state.comparisonMode === "hourly";
  elements.modeHourly.classList.toggle("active", hourlyActive);
  elements.modeDaily.classList.toggle("active", !hourlyActive);
  elements.modeHourly.setAttribute("aria-pressed", String(hourlyActive));
  elements.modeDaily.setAttribute("aria-pressed", String(!hourlyActive));
}

function renderAll() {
  applyWeatherTheme();
  renderLocationSummary();
  renderStatus();
  renderHonestyReport();
  renderNowCard();
  renderTemperatureTrend();
  renderTodayList();
  renderWeekList();
  renderChanges();
  renderTimeline();
  renderRawData();
  renderComparisonToggle();
  updateOfflineBadge();
  elements.compareLatestButton.disabled = !state.currentLocation || state.loading;
}

function recalculateDiff() {
  state.diff = buildForecastDiff(state.previousSnapshot, state.currentSnapshot, state.comparisonMode);
}

async function refreshForecast({ silent = false } = {}) {
  if (state.loading || !state.currentLocation) {
    return;
  }
  if (!navigator.onLine) {
    if (!silent) {
      showError("You are offline. Showing the latest saved snapshot.");
    }
    updateOfflineBadge();
    return;
  }
  if (!silent) {
    showError("");
  }
  setLoading(true);
  try {
    const { forecast, alerts } = await fetchWeatherBundle(
      state.currentLocation.latitude,
      state.currentLocation.longitude
    );
    const { normalized, sourceMeta } = normalizeWeatherData(
      forecast.payload,
      alerts.payload,
      alerts.status
    );
    const fetchedAt = new Date().toISOString();
    const snapshot = {
      id: `${state.currentLocation.id}:${fetchedAt}`,
      location: state.currentLocation,
      fetchedAt,
      provider: {
        forecast: forecast.provider,
        alerts: alerts.provider,
      },
      units: {
        displayTemperature: state.settings.temperatureUnit,
        displayWind: state.settings.windUnit,
        baseTemperature: "celsius",
        baseWind: "kph",
      },
      sourceMeta,
      raw: {
        forecast: forecast.payload,
        alerts: alerts.payload,
      },
      normalized,
    };

    saveSnapshot(state.currentLocation.id, snapshot, state.settings.retentionLimit);
    readSnapshotPair();
    recalculateDiff();
    renderAll();
  } catch (error) {
    readSnapshotPair();
    recalculateDiff();
    renderAll();
    showError(`Failed to refresh forecast. ${sanitizeText(error?.message ?? "")}`);
  } finally {
    setLoading(false);
  }
}

async function selectLocation(location) {
  state.currentLocation = {
    ...location,
    id: `${Number(location.latitude).toFixed(4)},${Number(location.longitude).toFixed(4)}`,
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
  };
  saveLastLocation(state.currentLocation);
  readSnapshotPair();
  recalculateDiff();
  renderAll();
  startAutoRefreshTimer();
  await refreshForecast({ silent: true });
}

async function handleSearchSubmit(event) {
  event.preventDefault();
  const query = sanitizeText(elements.locationInput.value);
  if (!query) {
    return;
  }
  showError("");
  const latLon = parseLatLonInput(query);
  if (latLon) {
    const label = await lookupLocationLabel(latLon.latitude, latLon.longitude);
    await selectLocation({
      name: label,
      latitude: latLon.latitude,
      longitude: latLon.longitude,
      source: "manual-latlon",
    });
    state.searchResults = [];
    renderSearchResults();
    return;
  }
  try {
    const results = await searchLocations(query);
    if (!results.length) {
      state.searchResults = [];
      renderSearchResults();
      showError("No matching locations found. Try a nearby city or exact latitude,longitude.");
      return;
    }
    state.searchResults = results;
    renderSearchResults();
    if (results.length === 1) {
      await selectLocation(results[0]);
      state.searchResults = [];
      renderSearchResults();
    } else {
      showError("Select one of the matching locations below.");
    }
  } catch (error) {
    showError(`Search failed. ${sanitizeText(error?.message ?? "")}`);
  }
}

function handleGeoLocate() {
  if (!navigator.geolocation) {
    showError("Geolocation is not supported by this browser.");
    return;
  }
  showError("");
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      const name = await lookupLocationLabel(latitude, longitude);
      await selectLocation({
        name,
        latitude,
        longitude,
        source: "geolocation",
      });
    },
    (error) => {
      const messageMap = {
        1: "Location access denied. Please allow location permissions.",
        2: "Location unavailable. Try manual search.",
        3: "Location request timed out. Try again.",
      };
      showError(messageMap[error.code] ?? "Could not get your location.");
    },
    { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 }
  );
}

function openDialog(dialog) {
  if (!dialog) {
    return;
  }
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

function closeDialog(dialog) {
  if (!dialog) {
    return;
  }
  if (typeof dialog.close === "function") {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
  }
}

function syncSettingsForm() {
  elements.temperatureUnit.value = state.settings.temperatureUnit;
  elements.windUnit.value = state.settings.windUnit;
  elements.timeFormat.value = state.settings.timeFormat;
  elements.autoRefresh.checked = Boolean(state.settings.autoRefresh);
  elements.retentionLimit.value = String(state.settings.retentionLimit);
}

function startAutoRefreshTimer() {
  if (state.autoRefreshTimer) {
    window.clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = null;
  }
  if (!state.settings.autoRefresh || !state.currentLocation) {
    return;
  }
  state.autoRefreshTimer = window.setInterval(() => {
    refreshForecast({ silent: true });
  }, AUTO_REFRESH_MS);
}

function handleSettingsSave(event) {
  event.preventDefault();
  state.settings = saveSettings({
    temperatureUnit: elements.temperatureUnit.value,
    windUnit: elements.windUnit.value,
    timeFormat: elements.timeFormat.value,
    autoRefresh: elements.autoRefresh.checked,
    retentionLimit: Number(elements.retentionLimit.value),
  });
  applyRetentionLimit(state.settings.retentionLimit);
  readSnapshotPair();
  recalculateDiff();
  renderAll();
  startAutoRefreshTimer();
  closeDialog(elements.settingsDialog);
}

function setupInstallPrompt() {
  if (getA2hsDismissed()) {
    return;
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    elements.a2hsBanner.classList.remove("hidden");
  });

  window.addEventListener("appinstalled", () => {
    state.deferredInstallPrompt = null;
    elements.a2hsBanner.classList.add("hidden");
    setA2hsDismissed(true);
  });

  elements.a2hsInstall.addEventListener("click", async () => {
    if (!state.deferredInstallPrompt) {
      elements.a2hsBanner.classList.add("hidden");
      return;
    }
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice.catch(() => null);
    state.deferredInstallPrompt = null;
    elements.a2hsBanner.classList.add("hidden");
  });

  elements.a2hsDismiss.addEventListener("click", () => {
    setA2hsDismissed(true);
    elements.a2hsBanner.classList.add("hidden");
  });
}

function setupServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      try {
        await navigator.serviceWorker.register("./service-worker.js");
      } catch {
        // Service worker registration failure should not break core app usage.
      }
    });
  }
}

function setupEventListeners() {
  elements.searchForm.addEventListener("submit", handleSearchSubmit);
  elements.geoButton.addEventListener("click", handleGeoLocate);
  elements.refreshButton.addEventListener("click", () => refreshForecast({ silent: false }));
  elements.quickRefreshButton.addEventListener("click", () => refreshForecast({ silent: false }));
  elements.compareLatestButton.addEventListener("click", () => {
    readSnapshotPair();
    recalculateDiff();
    renderAll();
  });
  elements.quickLaButton.addEventListener("click", async () => {
    await selectLocation(LOS_ANGELES_EXAMPLE);
  });
  elements.modeHourly.addEventListener("click", () => {
    state.comparisonMode = "hourly";
    recalculateDiff();
    renderAll();
  });
  elements.modeDaily.addEventListener("click", () => {
    state.comparisonMode = "daily";
    recalculateDiff();
    renderAll();
  });
  elements.whyButton.addEventListener("click", () => openDialog(elements.whyDialog));
  elements.openSettingsButton.addEventListener("click", () => {
    syncSettingsForm();
    openDialog(elements.settingsDialog);
  });
  elements.settingsForm.addEventListener("submit", handleSettingsSave);
  elements.closeSettingsButton.addEventListener("click", () => closeDialog(elements.settingsDialog));

  window.addEventListener("online", () => {
    updateOfflineBadge();
    showError("");
    if (state.currentLocation) {
      refreshForecast({ silent: true });
    }
  });
  window.addEventListener("offline", () => {
    updateOfflineBadge();
    if (state.currentSnapshot) {
      showError("Offline mode: showing last saved forecast snapshot.");
    }
  });
}

async function init() {
  syncSettingsForm();
  setupEventListeners();
  setupInstallPrompt();
  setupServiceWorker();

  if (state.currentLocation) {
    readSnapshotPair();
    recalculateDiff();
    renderAll();
    startAutoRefreshTimer();
    if (navigator.onLine) {
      await refreshForecast({ silent: true });
    }
  } else {
    readSnapshotPair();
    recalculateDiff();
    renderAll();
  }
}

init().catch((error) => {
  showError(`Initialization failed. ${sanitizeText(error?.message ?? "")}`);
});

document.title = `${APP_NAME} - honest weather forecast changes`;
