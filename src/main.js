import { fetchWeatherBundle, lookupLocationLabel, parseLatLonInput, searchLocations } from "./api.js";
import {
  ALERTS_PROVIDER,
  APP_NAME,
  AUTO_REFRESH_MS,
  DEFAULT_COMPARISON_MODE,
  FORECAST_PROVIDER,
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
  formatClock,
  formatDateTime,
  formatMillimeters,
  formatPercent,
  formatRelativeForecastLabel,
  formatTemperature,
  formatWind,
  sanitizeText,
} from "./utils.js";

const elements = {
  searchForm: document.getElementById("search-form"),
  locationInput: document.getElementById("location-input"),
  searchResults: document.getElementById("search-results"),
  geoButton: document.getElementById("geo-btn"),
  locationSummary: document.getElementById("location-summary"),
  refreshButton: document.getElementById("refresh-btn"),
  openSettingsButton: document.getElementById("open-settings-btn"),
  errorBox: document.getElementById("error-box"),
  offlineBadge: document.getElementById("offline-badge"),
  confidenceBadge: document.getElementById("confidence-badge"),
  lastUpdated: document.getElementById("last-updated"),
  comparedTo: document.getElementById("compared-to"),
  dataSource: document.getElementById("data-source"),
  nowCard: document.getElementById("now-card"),
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
  elements.refreshButton.disabled = loading || !state.currentLocation;
  elements.refreshButton.textContent = loading ? "Refreshing..." : label;
}

function updateOfflineBadge() {
  const isOffline = !navigator.onLine;
  elements.offlineBadge.classList.toggle("hidden", !isOffline);
  if (isOffline && state.currentSnapshot) {
    showError("Offline mode: showing last saved forecast snapshot.");
    elements.refreshButton.disabled = true;
  } else if (!state.loading) {
    elements.refreshButton.disabled = !state.currentLocation;
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
    const date = createElement("strong", "", day.date);
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
    const item = createElement("li", "", formatDiffMessage(change));
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
  if (!state.currentSnapshot) {
    elements.lastUpdated.textContent = "Never";
    elements.comparedTo.textContent = "No previous snapshot";
    elements.dataSource.textContent = "Data source: none loaded yet";
    elements.confidenceBadge.textContent = "Confidence: Unknown";
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
  renderLocationSummary();
  renderStatus();
  renderNowCard();
  renderTodayList();
  renderWeekList();
  renderChanges();
  renderTimeline();
  renderRawData();
  renderComparisonToggle();
  updateOfflineBadge();
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
