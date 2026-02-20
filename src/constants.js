export const APP_NAME = "zweather";
export const FORECAST_PROVIDER = {
  name: "Open-Meteo",
  endpoint: "/v1/forecast",
  version: "v1",
};

export const ALERTS_PROVIDER = {
  name: "NWS Alerts",
  endpoint: "/alerts/active",
  version: "v1",
};

export const STORAGE_KEYS = {
  settings: "zweather:settings",
  snapshots: "zweather:snapshots",
  lastLocation: "zweather:last-location",
  a2hsDismissed: "zweather:a2hs-dismissed",
};

export const DEFAULT_SETTINGS = {
  temperatureUnit: "celsius",
  windUnit: "kph",
  timeFormat: "24h",
  autoRefresh: false,
  retentionLimit: 10,
};

export const DEFAULT_COMPARISON_MODE = "hourly";
export const AUTO_REFRESH_MS = 30 * 60 * 1000;
