import { ALERTS_PROVIDER, FORECAST_PROVIDER } from "./constants.js";
import { roundCoordinate, sanitizeText } from "./utils.js";

const OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_GEOCODING = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_GOV_ALERTS = "https://api.weather.gov/alerts/active";
const WEATHER_GOV_POINTS = "https://api.weather.gov/points";

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Request failed (${response.status}): ${text || response.statusText}`);
  }
  return response.json();
}

export function parseLatLonInput(input) {
  if (!input) {
    return null;
  }
  const match = String(input)
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (
    Number.isNaN(latitude) ||
    Number.isNaN(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  return { latitude, longitude };
}

export async function searchLocations(query) {
  const clean = sanitizeText(query);
  if (!clean) {
    return [];
  }
  const params = new URLSearchParams({
    name: clean,
    count: "7",
    language: "en",
    format: "json",
  });
  const url = `${OPEN_METEO_GEOCODING}?${params.toString()}`;
  const payload = await fetchJson(url);
  const results = Array.isArray(payload.results) ? payload.results : [];
  return results.map((item) => {
    const parts = [item.name, item.admin1, item.country].filter(Boolean);
    return {
      name: parts.join(", "),
      latitude: Number(item.latitude),
      longitude: Number(item.longitude),
      timezone: item.timezone ?? null,
      source: "open-meteo-geocoding",
    };
  });
}

export async function lookupLocationLabel(latitude, longitude) {
  const lat = roundCoordinate(latitude);
  const lon = roundCoordinate(longitude);
  try {
    const url = `${WEATHER_GOV_POINTS}/${lat},${lon}`;
    const payload = await fetchJson(url, {
      headers: {
        Accept: "application/geo+json",
      },
    });
    const city = payload?.properties?.relativeLocation?.properties?.city;
    const state = payload?.properties?.relativeLocation?.properties?.state;
    if (city && state) {
      return `${city}, ${state}`;
    }
  } catch {
    // best effort only
  }
  return `Lat ${lat}, Lon ${lon}`;
}

export async function fetchForecast(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current:
      "temperature_2m,weather_code,wind_speed_10m,precipitation_probability,precipitation",
    hourly:
      "temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max",
    forecast_days: "7",
    timezone: "auto",
    temperature_unit: "celsius",
    wind_speed_unit: "kmh",
    precipitation_unit: "mm",
  });
  const url = `${OPEN_METEO_FORECAST}?${params.toString()}`;
  const payload = await fetchJson(url, {
    headers: {
      Accept: "application/json",
    },
  });
  return {
    payload,
    provider: FORECAST_PROVIDER,
  };
}

export async function fetchAlerts(latitude, longitude) {
  const params = new URLSearchParams({
    point: `${latitude},${longitude}`,
  });
  const url = `${WEATHER_GOV_ALERTS}?${params.toString()}`;
  try {
    const payload = await fetchJson(url, {
      headers: {
        Accept: "application/geo+json",
      },
    });
    return {
      payload,
      provider: ALERTS_PROVIDER,
      status: "ok",
    };
  } catch (error) {
    return {
      payload: { features: [] },
      provider: ALERTS_PROVIDER,
      status: "unavailable",
      error: String(error?.message ?? error),
    };
  }
}

export async function fetchWeatherBundle(latitude, longitude) {
  const [forecast, alerts] = await Promise.all([
    fetchForecast(latitude, longitude),
    fetchAlerts(latitude, longitude),
  ]);
  return {
    forecast,
    alerts,
  };
}
