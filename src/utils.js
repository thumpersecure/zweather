export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function safeJsonParse(value, fallback) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function roundCoordinate(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

export function locationIdFromLatLon(lat, lon) {
  const safeLat = roundCoordinate(lat);
  const safeLon = roundCoordinate(lon);
  return `${safeLat},${safeLon}`;
}

export function cToF(valueC) {
  return (Number(valueC) * 9) / 5 + 32;
}

export function kphToMph(valueKph) {
  return Number(valueKph) * 0.621371;
}

export function formatTemperature(valueC, temperatureUnit) {
  if (valueC == null || Number.isNaN(Number(valueC))) {
    return "--";
  }
  const value = temperatureUnit === "fahrenheit" ? cToF(valueC) : Number(valueC);
  const symbol = temperatureUnit === "fahrenheit" ? "F" : "C";
  return `${Math.round(value)} ${symbol}`;
}

export function formatWind(valueKph, windUnit) {
  if (valueKph == null || Number.isNaN(Number(valueKph))) {
    return "--";
  }
  const value = windUnit === "mph" ? kphToMph(valueKph) : Number(valueKph);
  return `${Math.round(value)} ${windUnit}`;
}

export function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return "--";
  }
  return `${Math.round(Number(value))}%`;
}

export function formatMillimeters(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return "--";
  }
  return `${Number(value).toFixed(1)} mm`;
}

export function asIsoDate(input) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

export function formatDateTime(value, timeFormat = "24h") {
  if (!value) {
    return "Unknown";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  const options = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: timeFormat === "12h",
  };
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

export function formatClock(value, timeFormat = "24h") {
  if (!value) {
    return "Unknown";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: timeFormat === "12h",
  }).format(date);
}

export function formatDayLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown day";
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatRelativeForecastLabel(value, nowValue, timeFormat = "24h") {
  const target = new Date(value);
  const now = new Date(nowValue ?? Date.now());
  if (Number.isNaN(target.getTime()) || Number.isNaN(now.getTime())) {
    return "Forecast window";
  }
  const startOfTarget = new Date(target);
  startOfTarget.setHours(0, 0, 0, 0);
  const startOfNow = new Date(now);
  startOfNow.setHours(0, 0, 0, 0);
  const dayDelta = Math.round((startOfTarget - startOfNow) / 86400000);
  const clock = formatClock(target.toISOString(), timeFormat);
  if (dayDelta === 0) {
    return `Today ${clock}`;
  }
  if (dayDelta === 1) {
    return `Tomorrow ${clock}`;
  }
  if (dayDelta === -1) {
    return `Yesterday ${clock}`;
  }
  const day = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(target);
  return `${day} ${clock}`;
}

export function sanitizeText(text) {
  if (text == null) {
    return "";
  }
  return String(text).replace(/\s+/g, " ").trim();
}
