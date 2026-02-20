import { formatClock, formatDayLabel, formatRelativeForecastLabel } from "./utils.js";

function numericChanged(before, after, threshold = 0.01) {
  if (before == null && after == null) {
    return false;
  }
  if (before == null || after == null) {
    return true;
  }
  return Math.abs(Number(after) - Number(before)) > threshold;
}

function buildMapByKey(list, key) {
  const map = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    const value = item?.[key];
    if (value != null) {
      map.set(value, item);
    }
  }
  return map;
}

function formatNumeric(value, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) {
    return "--";
  }
  return Number(value).toFixed(digits);
}

function buildTimeLabel(granularity, key, nowReference) {
  if (granularity === "hourly") {
    return formatRelativeForecastLabel(key, nowReference, "12h");
  }
  if (granularity === "daily") {
    return formatDayLabel(key);
  }
  return String(key);
}

function appendNumericChange({
  changes,
  granularity,
  key,
  nowReference,
  comparedClock,
  type,
  from,
  to,
  unit,
  messageLabel,
}) {
  const label = buildTimeLabel(granularity, key, nowReference);
  const change = {
    type,
    granularity,
    key,
    label,
    from,
    to,
    delta: (to ?? 0) - (from ?? 0),
    message: `${label}: ${messageLabel} changed ${formatNumeric(from)}${unit} -> ${formatNumeric(to)}${unit} since ${comparedClock}.`,
  };
  changes.push(change);
}

function compareSeries(previousList, currentList, options) {
  const {
    granularity,
    keyName,
    numericMetrics,
    weatherCodeKey,
    nowReference,
    comparedClock,
    changes,
  } = options;

  const previousMap = buildMapByKey(previousList, keyName);
  const currentMap = buildMapByKey(currentList, keyName);

  for (const [key, current] of currentMap.entries()) {
    const previous = previousMap.get(key);
    if (!previous) {
      continue;
    }

    for (const metric of numericMetrics) {
      const before = previous[metric.field];
      const after = current[metric.field];
      if (numericChanged(before, after, metric.threshold ?? 0.01)) {
        appendNumericChange({
          changes,
          granularity,
          key,
          nowReference,
          comparedClock,
          type: metric.type,
          from: before,
          to: after,
          unit: metric.unit,
          messageLabel: metric.label,
        });
      }
    }

    const previousCode = previous[weatherCodeKey];
    const currentCode = current[weatherCodeKey];
    if (previousCode !== currentCode) {
      const label = buildTimeLabel(granularity, key, nowReference);
      changes.push({
        type: "condition",
        granularity,
        key,
        label,
        from: previous.conditionLabel ?? `Code ${previousCode}`,
        to: current.conditionLabel ?? `Code ${currentCode}`,
        delta: previousCode === currentCode ? 0 : 1,
        message: `${label}: condition changed "${previous.conditionLabel ?? previousCode}" -> "${current.conditionLabel ?? currentCode}" since ${comparedClock}.`,
      });
    }
  }
}

function compareAlerts(previousAlerts, currentAlerts, comparedClock) {
  const changes = [];
  const previousMap = buildMapByKey(previousAlerts, "id");
  const currentMap = buildMapByKey(currentAlerts, "id");

  for (const [id, current] of currentMap.entries()) {
    if (!previousMap.has(id)) {
      changes.push({
        type: "alerts_added",
        granularity: "alerts",
        key: id,
        label: current.event ?? "Alert",
        from: 0,
        to: 1,
        delta: 1,
        message: `Alert added: ${current.event ?? "Unknown"} (${current.severity ?? "Unknown"}) since ${comparedClock}.`,
      });
      continue;
    }
    const previous = previousMap.get(id);
    if (
      previous?.severity !== current?.severity ||
      previous?.certainty !== current?.certainty ||
      previous?.urgency !== current?.urgency ||
      previous?.headline !== current?.headline
    ) {
      changes.push({
        type: "alerts_updated",
        granularity: "alerts",
        key: id,
        label: current.event ?? "Alert",
        from: previous?.severity ?? "Unknown",
        to: current?.severity ?? "Unknown",
        delta: 1,
        message: `Alert updated: ${current.event ?? "Unknown"} changed severity/context since ${comparedClock}.`,
      });
    }
  }

  for (const [id, previous] of previousMap.entries()) {
    if (!currentMap.has(id)) {
      changes.push({
        type: "alerts_removed",
        granularity: "alerts",
        key: id,
        label: previous.event ?? "Alert",
        from: 1,
        to: 0,
        delta: -1,
        message: `Alert cleared: ${previous.event ?? "Unknown"} since ${comparedClock}.`,
      });
    }
  }
  return changes;
}

function getChangeImpact(change) {
  switch (change.type) {
    case "temperature":
      return Math.min(4, Math.abs(Number(change.delta ?? 0)) / 2);
    case "precip_probability":
      return Math.min(4, Math.abs(Number(change.delta ?? 0)) / 15);
    case "precip_amount":
      return Math.min(4, Math.abs(Number(change.delta ?? 0)) / 2);
    case "wind":
      return Math.min(4, Math.abs(Number(change.delta ?? 0)) / 8);
    case "condition":
      return 2.3;
    case "alerts_added":
    case "alerts_removed":
    case "alerts_updated":
      return 3;
    case "provider":
    case "units":
      return 1.5;
    default:
      return 1;
  }
}

export function calculateConfidence(changes, hasBaseline) {
  if (!hasBaseline) {
    return {
      label: "Unknown",
      score: 0,
      reason: "Need at least two snapshots to assess stability.",
    };
  }
  if (!changes.length) {
    return {
      label: "High",
      score: 100,
      reason: "Forecast has remained stable since the previous snapshot.",
    };
  }
  const impact = changes.reduce((sum, change) => sum + getChangeImpact(change), 0);
  const weightedScore = Math.max(0, 100 - impact * 8 - changes.length * 2);
  if (impact < 5 && changes.length <= 5) {
    return {
      label: "High",
      score: weightedScore,
      reason: "Only minor forecast movement since the previous snapshot.",
    };
  }
  if (impact < 14 && changes.length <= 18) {
    return {
      label: "Medium",
      score: weightedScore,
      reason: "Moderate forecast movement since the previous snapshot.",
    };
  }
  return {
    label: "Low",
    score: weightedScore,
    reason: "Large or frequent forecast revisions detected.",
  };
}

function compareMeta(previousSnapshot, currentSnapshot, comparedClock) {
  const changes = [];
  const previousProvider = previousSnapshot?.provider?.forecast?.name ?? "Unknown";
  const currentProvider = currentSnapshot?.provider?.forecast?.name ?? "Unknown";
  if (previousProvider !== currentProvider) {
    changes.push({
      type: "provider",
      granularity: "meta",
      key: "provider",
      label: "Data provider",
      from: previousProvider,
      to: currentProvider,
      delta: 1,
      message: `Data provider changed ${previousProvider} -> ${currentProvider} since ${comparedClock}.`,
    });
  }
  const previousTempUnit = previousSnapshot?.units?.displayTemperature ?? "celsius";
  const currentTempUnit = currentSnapshot?.units?.displayTemperature ?? "celsius";
  const previousWindUnit = previousSnapshot?.units?.displayWind ?? "kph";
  const currentWindUnit = currentSnapshot?.units?.displayWind ?? "kph";
  if (previousTempUnit !== currentTempUnit || previousWindUnit !== currentWindUnit) {
    changes.push({
      type: "units",
      granularity: "meta",
      key: "units",
      label: "Display units",
      from: `${previousTempUnit}/${previousWindUnit}`,
      to: `${currentTempUnit}/${currentWindUnit}`,
      delta: 1,
      message: `Display units changed ${previousTempUnit}/${previousWindUnit} -> ${currentTempUnit}/${currentWindUnit} since ${comparedClock}.`,
    });
  }
  return changes;
}

function sortChangesByImpact(changes) {
  return changes
    .slice()
    .sort((a, b) => getChangeImpact(b) - getChangeImpact(a))
    .sort((a, b) => {
      const aTime = Date.parse(a.key) || 0;
      const bTime = Date.parse(b.key) || 0;
      return aTime - bTime;
    });
}

function buildMetrics(previousModel, currentModel, mode, changes) {
  const seriesKey = mode === "hourly" ? "hourly" : "daily";
  const keyName = mode === "hourly" ? "time" : "date";
  const previousMap = buildMapByKey(previousModel?.[seriesKey], keyName);
  const currentMap = buildMapByKey(currentModel?.[seriesKey], keyName);
  const comparedKeys = [];
  for (const key of currentMap.keys()) {
    if (previousMap.has(key)) {
      comparedKeys.push(key);
    }
  }
  const comparedSet = new Set(comparedKeys);
  const changedWindowKeys = new Set(
    changes
      .filter((change) => change.granularity === mode && comparedSet.has(change.key))
      .map((change) => change.key)
  );
  const numericCandidates = changes.filter(
    (change) =>
      change.granularity === mode &&
      ["temperature", "precip_probability", "precip_amount", "wind"].includes(change.type) &&
      Number.isFinite(Number(change.delta))
  );
  const largestChange = numericCandidates
    .slice()
    .sort((a, b) => Math.abs(Number(b.delta)) - Math.abs(Number(a.delta)))[0];
  const alertsChanges = changes.filter((change) => change.granularity === "alerts").length;
  const metaChanges = changes.filter((change) => change.granularity === "meta").length;
  const categories = changes.reduce((accumulator, change) => {
    accumulator[change.type] = (accumulator[change.type] ?? 0) + 1;
    return accumulator;
  }, {});
  const totalComparedWindows = comparedKeys.length;
  const changedWindows = changedWindowKeys.size;
  const unchangedWindows = Math.max(0, totalComparedWindows - changedWindows);
  return {
    totalComparedWindows,
    changedWindows,
    unchangedWindows,
    changeRate: totalComparedWindows > 0 ? changedWindows / totalComparedWindows : 0,
    largestChange: largestChange
      ? {
          type: largestChange.type,
          label: largestChange.label,
          from: largestChange.from,
          to: largestChange.to,
          delta: largestChange.delta,
        }
      : null,
    alertsChanges,
    metaChanges,
    categories,
  };
}

function emptyDiffResult(mode, message) {
  return {
    mode,
    hasBaseline: false,
    hasChanges: false,
    changes: [],
    summary: [],
    unchangedMessage: message,
    comparedTo: null,
    confidence: calculateConfidence([], false),
    metrics: {
      totalComparedWindows: 0,
      changedWindows: 0,
      unchangedWindows: 0,
      changeRate: 0,
      largestChange: null,
      alertsChanges: 0,
      metaChanges: 0,
      categories: {},
    },
  };
}

export function buildForecastDiff(previousSnapshot, currentSnapshot, mode = "hourly") {
  if (!currentSnapshot) {
    return emptyDiffResult(mode, "No current snapshot loaded.");
  }
  if (!previousSnapshot) {
    return emptyDiffResult(mode, "No previous snapshot to compare yet.");
  }

  const comparedClock = formatClock(previousSnapshot.fetchedAt, "12h");
  const nowReference = currentSnapshot.fetchedAt ?? Date.now();
  const changes = [];

  const previousModel = previousSnapshot.normalized ?? {};
  const currentModel = currentSnapshot.normalized ?? {};

  if (mode === "hourly") {
    compareSeries(previousModel.hourly, currentModel.hourly, {
      granularity: "hourly",
      keyName: "time",
      numericMetrics: [
        { field: "temperatureC", type: "temperature", label: "temperature", unit: "C" },
        {
          field: "precipProbability",
          type: "precip_probability",
          label: "precip chance",
          unit: "%",
        },
        { field: "precipMm", type: "precip_amount", label: "precip amount", unit: "mm" },
        { field: "windKph", type: "wind", label: "wind", unit: "kph" },
      ],
      weatherCodeKey: "weatherCode",
      nowReference,
      comparedClock,
      changes,
    });
  } else {
    compareSeries(previousModel.daily, currentModel.daily, {
      granularity: "daily",
      keyName: "date",
      numericMetrics: [
        { field: "tempMaxC", type: "temperature", label: "max temp", unit: "C" },
        {
          field: "precipProbabilityMax",
          type: "precip_probability",
          label: "max precip chance",
          unit: "%",
        },
        { field: "precipMm", type: "precip_amount", label: "precip amount", unit: "mm" },
        { field: "windMaxKph", type: "wind", label: "max wind", unit: "kph" },
      ],
      weatherCodeKey: "weatherCode",
      nowReference,
      comparedClock,
      changes,
    });
  }

  changes.push(...compareAlerts(previousModel.alerts, currentModel.alerts, comparedClock));
  changes.push(...compareMeta(previousSnapshot, currentSnapshot, comparedClock));

  const sorted = sortChangesByImpact(changes);
  const summary = sorted.slice(0, 12);
  const hasChanges = changes.length > 0;
  const metrics = buildMetrics(previousModel, currentModel, mode, sorted);
  return {
    mode,
    hasBaseline: true,
    hasChanges,
    changes: sorted,
    summary,
    unchangedMessage: hasChanges
      ? ""
      : `No forecast changes since ${formatClock(previousSnapshot.fetchedAt, "12h")}.`,
    comparedTo: previousSnapshot.fetchedAt ?? null,
    confidence: calculateConfidence(changes, true),
    metrics,
  };
}
