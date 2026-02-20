import test from "node:test";
import assert from "node:assert/strict";
import { buildForecastDiff } from "../src/diff.js";

function makeSnapshot({
  fetchedAt,
  providerName = "Open-Meteo",
  displayTemperature = "celsius",
  displayWind = "kph",
  hourly = [],
  daily = [],
  alerts = [],
}) {
  return {
    id: `loc:${fetchedAt}`,
    fetchedAt,
    provider: {
      forecast: { name: providerName, endpoint: "/v1/forecast", version: "v1" },
      alerts: { name: "NWS Alerts", endpoint: "/alerts/active", version: "v1" },
    },
    units: {
      displayTemperature,
      displayWind,
      baseTemperature: "celsius",
      baseWind: "kph",
    },
    normalized: {
      current: {
        time: fetchedAt,
        temperatureC: hourly[0]?.temperatureC ?? 10,
        windKph: hourly[0]?.windKph ?? 8,
        precipProbability: hourly[0]?.precipProbability ?? 20,
        precipMm: hourly[0]?.precipMm ?? 0.2,
        weatherCode: hourly[0]?.weatherCode ?? 1,
        conditionLabel: hourly[0]?.conditionLabel ?? "Mainly clear",
        conditionIcon: hourly[0]?.conditionIcon ?? "🌤️",
      },
      hourly,
      daily,
      alerts,
    },
  };
}

test("returns no baseline when previous snapshot is missing", () => {
  const current = makeSnapshot({
    fetchedAt: "2026-02-20T09:30:00.000Z",
    hourly: [
      {
        time: "2026-02-20T10:00:00.000Z",
        temperatureC: 8,
        precipProbability: 10,
        precipMm: 0,
        windKph: 15,
        weatherCode: 1,
        conditionLabel: "Mainly clear",
      },
    ],
    daily: [],
  });
  const diff = buildForecastDiff(null, current, "hourly");
  assert.equal(diff.hasBaseline, false);
  assert.equal(diff.hasChanges, false);
  assert.equal(diff.summary.length, 0);
  assert.equal(diff.confidence.label, "Unknown");
});

test("detects hourly temperature, precip, wind, and condition changes", () => {
  const previous = makeSnapshot({
    fetchedAt: "2026-02-20T09:12:00.000Z",
    hourly: [
      {
        time: "2026-02-21T15:00:00.000Z",
        temperatureC: 10,
        precipProbability: 20,
        precipMm: 0.2,
        windKph: 12,
        weatherCode: 2,
        conditionLabel: "Partly cloudy",
      },
    ],
    daily: [],
  });
  const current = makeSnapshot({
    fetchedAt: "2026-02-20T10:30:00.000Z",
    hourly: [
      {
        time: "2026-02-21T15:00:00.000Z",
        temperatureC: 7,
        precipProbability: 55,
        precipMm: 1.7,
        windKph: 24,
        weatherCode: 61,
        conditionLabel: "Slight rain",
      },
    ],
    daily: [],
  });
  const diff = buildForecastDiff(previous, current, "hourly");
  assert.equal(diff.hasBaseline, true);
  assert.equal(diff.hasChanges, true);
  const types = new Set(diff.changes.map((item) => item.type));
  assert.equal(types.has("temperature"), true);
  assert.equal(types.has("precip_probability"), true);
  assert.equal(types.has("precip_amount"), true);
  assert.equal(types.has("wind"), true);
  assert.equal(types.has("condition"), true);
});

test("detects daily changes in daily mode", () => {
  const previous = makeSnapshot({
    fetchedAt: "2026-02-20T09:12:00.000Z",
    hourly: [],
    daily: [
      {
        date: "2026-02-22",
        tempMaxC: 5,
        precipProbabilityMax: 30,
        precipMm: 0.4,
        windMaxKph: 14,
        weatherCode: 3,
        conditionLabel: "Overcast",
      },
    ],
  });
  const current = makeSnapshot({
    fetchedAt: "2026-02-20T10:30:00.000Z",
    hourly: [],
    daily: [
      {
        date: "2026-02-22",
        tempMaxC: 9,
        precipProbabilityMax: 70,
        precipMm: 4.5,
        windMaxKph: 28,
        weatherCode: 82,
        conditionLabel: "Violent rain showers",
      },
    ],
  });
  const diff = buildForecastDiff(previous, current, "daily");
  assert.equal(diff.hasChanges, true);
  const dailyOnly = diff.changes.filter((item) => item.granularity === "daily");
  assert.ok(dailyOnly.length >= 4);
});

test("marks unchanged forecasts explicitly", () => {
  const hourly = [
    {
      time: "2026-02-21T15:00:00.000Z",
      temperatureC: 7,
      precipProbability: 55,
      precipMm: 1.7,
      windKph: 24,
      weatherCode: 61,
      conditionLabel: "Slight rain",
    },
  ];
  const daily = [
    {
      date: "2026-02-22",
      tempMaxC: 9,
      precipProbabilityMax: 70,
      precipMm: 4.5,
      windMaxKph: 28,
      weatherCode: 82,
      conditionLabel: "Violent rain showers",
    },
  ];
  const previous = makeSnapshot({
    fetchedAt: "2026-02-20T09:12:00.000Z",
    hourly,
    daily,
  });
  const current = makeSnapshot({
    fetchedAt: "2026-02-20T10:30:00.000Z",
    hourly,
    daily,
  });
  const diff = buildForecastDiff(previous, current, "hourly");
  assert.equal(diff.hasChanges, false);
  assert.match(diff.unchangedMessage, /No forecast changes/i);
  assert.equal(diff.confidence.label, "High");
});

test("captures alert and metadata changes", () => {
  const previous = makeSnapshot({
    fetchedAt: "2026-02-20T09:12:00.000Z",
    providerName: "Open-Meteo",
    displayTemperature: "celsius",
    displayWind: "kph",
    hourly: [],
    daily: [],
    alerts: [
      {
        id: "alert-a",
        event: "Wind Advisory",
        severity: "Moderate",
        certainty: "Likely",
        urgency: "Expected",
        headline: "Wind Advisory in effect",
      },
    ],
  });
  const current = makeSnapshot({
    fetchedAt: "2026-02-20T10:30:00.000Z",
    providerName: "Different Provider",
    displayTemperature: "fahrenheit",
    displayWind: "mph",
    hourly: [],
    daily: [],
    alerts: [
      {
        id: "alert-b",
        event: "Winter Storm Watch",
        severity: "Severe",
        certainty: "Possible",
        urgency: "Future",
        headline: "Winter Storm Watch in effect",
      },
    ],
  });
  const diff = buildForecastDiff(previous, current, "hourly");
  const types = new Set(diff.changes.map((item) => item.type));
  assert.equal(types.has("alerts_removed"), true);
  assert.equal(types.has("alerts_added"), true);
  assert.equal(types.has("provider"), true);
  assert.equal(types.has("units"), true);
});

test("provides honesty metrics for compared windows", () => {
  const previous = makeSnapshot({
    fetchedAt: "2026-02-20T09:12:00.000Z",
    hourly: [
      {
        time: "2026-02-21T15:00:00.000Z",
        temperatureC: 10,
        precipProbability: 20,
        precipMm: 0.2,
        windKph: 12,
        weatherCode: 2,
        conditionLabel: "Partly cloudy",
      },
      {
        time: "2026-02-21T16:00:00.000Z",
        temperatureC: 10,
        precipProbability: 20,
        precipMm: 0.2,
        windKph: 12,
        weatherCode: 2,
        conditionLabel: "Partly cloudy",
      },
    ],
    daily: [],
  });
  const current = makeSnapshot({
    fetchedAt: "2026-02-20T10:30:00.000Z",
    hourly: [
      {
        time: "2026-02-21T15:00:00.000Z",
        temperatureC: 13,
        precipProbability: 40,
        precipMm: 1.0,
        windKph: 20,
        weatherCode: 61,
        conditionLabel: "Slight rain",
      },
      {
        time: "2026-02-21T16:00:00.000Z",
        temperatureC: 10,
        precipProbability: 20,
        precipMm: 0.2,
        windKph: 12,
        weatherCode: 2,
        conditionLabel: "Partly cloudy",
      },
    ],
    daily: [],
  });
  const diff = buildForecastDiff(previous, current, "hourly");
  assert.equal(diff.metrics.totalComparedWindows, 2);
  assert.equal(diff.metrics.changedWindows, 1);
  assert.equal(diff.metrics.unchangedWindows, 1);
  assert.equal(diff.metrics.changeRate, 0.5);
  assert.ok(diff.metrics.largestChange);
});

test("summary ranks higher-impact changes before lower-impact ones", () => {
  const time1 = "2026-02-21T01:00:00.000Z";
  const time2 = "2026-02-21T02:00:00.000Z";
  const previous = makeSnapshot({
    fetchedAt: "2026-02-20T09:12:00.000Z",
    hourly: [
      {
        time: time1,
        temperatureC: 10,
        precipProbability: 10,
        precipMm: 0,
        windKph: 10,
        weatherCode: 1,
        conditionLabel: "Mainly clear",
      },
      {
        time: time2,
        temperatureC: 10,
        precipProbability: 10,
        precipMm: 0,
        windKph: 10,
        weatherCode: 1,
        conditionLabel: "Mainly clear",
      },
    ],
    daily: [],
  });
  const current = makeSnapshot({
    fetchedAt: "2026-02-20T10:30:00.000Z",
    hourly: [
      {
        time: time1,
        temperatureC: 10,
        precipProbability: 40,
        precipMm: 0,
        windKph: 10,
        weatherCode: 1,
        conditionLabel: "Mainly clear",
      },
      {
        time: time2,
        temperatureC: 0,
        precipProbability: 10,
        precipMm: 0,
        windKph: 10,
        weatherCode: 1,
        conditionLabel: "Mainly clear",
      },
    ],
    daily: [],
  });

  const diff = buildForecastDiff(previous, current, "hourly");
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.summary[0].type, "temperature");
  assert.equal(diff.summary[0].key, time2);
});
