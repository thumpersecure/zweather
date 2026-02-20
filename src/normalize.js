import { getConditionInfo } from "./weather-codes.js";

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeHourly(rawForecast) {
  const hourly = rawForecast?.hourly ?? {};
  const times = Array.isArray(hourly.time) ? hourly.time : [];
  const rows = [];
  for (let index = 0; index < times.length; index += 1) {
    const weatherCode = numberOrNull(hourly.weather_code?.[index]);
    const condition = getConditionInfo(weatherCode);
    rows.push({
      time: times[index],
      temperatureC: numberOrNull(hourly.temperature_2m?.[index]),
      precipProbability: numberOrNull(hourly.precipitation_probability?.[index]),
      precipMm: numberOrNull(hourly.precipitation?.[index]),
      windKph: numberOrNull(hourly.wind_speed_10m?.[index]),
      windGustKph: numberOrNull(hourly.wind_gusts_10m?.[index]),
      weatherCode,
      conditionLabel: condition.label,
      conditionIcon: condition.icon,
    });
  }
  return rows;
}

function normalizeDaily(rawForecast) {
  const daily = rawForecast?.daily ?? {};
  const dates = Array.isArray(daily.time) ? daily.time : [];
  const rows = [];
  for (let index = 0; index < dates.length; index += 1) {
    const weatherCode = numberOrNull(daily.weather_code?.[index]);
    const condition = getConditionInfo(weatherCode);
    rows.push({
      date: dates[index],
      tempMaxC: numberOrNull(daily.temperature_2m_max?.[index]),
      tempMinC: numberOrNull(daily.temperature_2m_min?.[index]),
      precipProbabilityMax: numberOrNull(daily.precipitation_probability_max?.[index]),
      precipMm: numberOrNull(daily.precipitation_sum?.[index]),
      windMaxKph: numberOrNull(daily.wind_speed_10m_max?.[index]),
      weatherCode,
      conditionLabel: condition.label,
      conditionIcon: condition.icon,
    });
  }
  return rows;
}

function normalizeCurrent(rawForecast) {
  const current = rawForecast?.current ?? {};
  const weatherCode = numberOrNull(current.weather_code);
  const condition = getConditionInfo(weatherCode);
  return {
    time: current.time ?? null,
    temperatureC: numberOrNull(current.temperature_2m),
    windKph: numberOrNull(current.wind_speed_10m),
    precipProbability: numberOrNull(current.precipitation_probability),
    precipMm: numberOrNull(current.precipitation),
    weatherCode,
    conditionLabel: condition.label,
    conditionIcon: condition.icon,
  };
}

function normalizeAlerts(rawAlerts) {
  const features = Array.isArray(rawAlerts?.features) ? rawAlerts.features : [];
  return features.map((feature) => {
    const properties = feature?.properties ?? {};
    return {
      id: properties.id ?? feature?.id ?? "unknown-alert",
      event: properties.event ?? "Unknown event",
      severity: properties.severity ?? "Unknown",
      certainty: properties.certainty ?? "Unknown",
      urgency: properties.urgency ?? "Unknown",
      headline: properties.headline ?? properties.event ?? "No headline",
      effective: properties.effective ?? null,
      expires: properties.expires ?? null,
    };
  });
}

export function normalizeWeatherData(rawForecast, rawAlerts, alertsStatus = "ok") {
  const normalized = {
    current: normalizeCurrent(rawForecast),
    hourly: normalizeHourly(rawForecast),
    daily: normalizeDaily(rawForecast),
    alerts: normalizeAlerts(rawAlerts),
  };
  return {
    normalized,
    sourceMeta: {
      timezone: rawForecast?.timezone ?? null,
      generationtimeMs: numberOrNull(rawForecast?.generationtime_ms),
      modelRunTime: rawForecast?.model_run ?? null,
      alertsStatus,
    },
  };
}
