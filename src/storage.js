import { DEFAULT_SETTINGS, STORAGE_KEYS } from "./constants.js";
import { clamp, safeJsonParse } from "./utils.js";

const memoryStore = new Map();

function readStorageKey(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memoryStore.get(key) ?? null;
  }
}

function writeStorageKey(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    memoryStore.set(key, value);
  }
}

function removeStorageKey(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    memoryStore.delete(key);
  }
}

export function getSettings() {
  const raw = readStorageKey(STORAGE_KEYS.settings);
  const parsed = safeJsonParse(raw, {});
  return {
    ...DEFAULT_SETTINGS,
    ...parsed,
    retentionLimit: clamp(Number(parsed.retentionLimit ?? DEFAULT_SETTINGS.retentionLimit), 3, 50),
    autoRefresh: Boolean(parsed.autoRefresh),
  };
}

export function saveSettings(settings) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...settings,
    retentionLimit: clamp(Number(settings.retentionLimit ?? DEFAULT_SETTINGS.retentionLimit), 3, 50),
    autoRefresh: Boolean(settings.autoRefresh),
  };
  writeStorageKey(STORAGE_KEYS.settings, JSON.stringify(merged));
  return merged;
}

export function getLastLocation() {
  return safeJsonParse(readStorageKey(STORAGE_KEYS.lastLocation), null);
}

export function saveLastLocation(location) {
  if (!location) {
    removeStorageKey(STORAGE_KEYS.lastLocation);
    return;
  }
  writeStorageKey(STORAGE_KEYS.lastLocation, JSON.stringify(location));
}

export function getAllSnapshots() {
  return safeJsonParse(readStorageKey(STORAGE_KEYS.snapshots), {});
}

function writeAllSnapshots(snapshotMap) {
  writeStorageKey(STORAGE_KEYS.snapshots, JSON.stringify(snapshotMap));
}

export function getSnapshotsForLocation(locationId) {
  if (!locationId) {
    return [];
  }
  const map = getAllSnapshots();
  const list = Array.isArray(map[locationId]) ? map[locationId] : [];
  return list
    .slice()
    .sort((a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime());
}

export function saveSnapshot(locationId, snapshot, retentionLimit) {
  const map = getAllSnapshots();
  const existing = Array.isArray(map[locationId]) ? map[locationId] : [];
  const deduped = [snapshot, ...existing.filter((item) => item.id !== snapshot.id)];
  deduped.sort((a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime());
  map[locationId] = deduped.slice(0, clamp(Number(retentionLimit), 3, 50));
  writeAllSnapshots(map);
  return map[locationId];
}

export function applyRetentionLimit(retentionLimit) {
  const limit = clamp(Number(retentionLimit), 3, 50);
  const map = getAllSnapshots();
  for (const key of Object.keys(map)) {
    if (Array.isArray(map[key])) {
      map[key] = map[key]
        .slice()
        .sort((a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime())
        .slice(0, limit);
    } else {
      map[key] = [];
    }
  }
  writeAllSnapshots(map);
  return map;
}

export function getA2hsDismissed() {
  return readStorageKey(STORAGE_KEYS.a2hsDismissed) === "1";
}

export function setA2hsDismissed(value) {
  if (value) {
    writeStorageKey(STORAGE_KEYS.a2hsDismissed, "1");
    return;
  }
  removeStorageKey(STORAGE_KEYS.a2hsDismissed);
}
