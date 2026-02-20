# DECISIONS.md

## zweather implementation decisions

## 1) API choice

### Primary forecast provider
- **Open-Meteo Forecast API** (`https://api.open-meteo.com/v1/forecast`)
- Why:
  - CORS-friendly for browser-only apps
  - No API key required (great for GitHub Pages static hosting)
  - Clear docs, stable endpoint, broad global coverage
  - Provides hourly and daily fields needed for honesty diffs

### Geocoding provider
- **Open-Meteo Geocoding API** (`https://geocoding-api.open-meteo.com/v1/search`)
- Supports city and ZIP-like queries via `name`.
- Manual `lat,lon` input is also supported directly.

### Alerts provider (best-effort)
- **US NWS Alerts API** (`https://api.weather.gov/alerts/active?point=lat,lon`)
- Used to track alert changes where available (primarily U.S. coordinates).
- Outside coverage or on provider errors, alerts gracefully degrade to empty.

### API key stance
- Core app works fully without secrets (Open-Meteo).
- No API keys are committed.
- A demo mode is naturally supported because the default path is keyless.

## 2) Normalized forecast schema

All snapshots store:

```json
{
  "id": "locationId:timestamp",
  "location": {
    "id": "lat,lon (rounded)",
    "name": "string",
    "latitude": 0,
    "longitude": 0
  },
  "fetchedAt": "ISO timestamp",
  "provider": {
    "forecast": { "name": "Open-Meteo", "endpoint": "/v1/forecast", "version": "v1" },
    "alerts": { "name": "NWS", "endpoint": "/alerts/active", "version": "v2" }
  },
  "units": {
    "displayTemperature": "celsius|fahrenheit",
    "displayWind": "kph|mph",
    "baseTemperature": "celsius",
    "baseWind": "kph"
  },
  "sourceMeta": {
    "timezone": "string",
    "generationtimeMs": 0,
    "modelRunTime": null,
    "alertsStatus": "ok|unavailable"
  },
  "raw": {
    "forecast": {},
    "alerts": {}
  },
  "normalized": {
    "current": {
      "time": "ISO",
      "temperatureC": 0,
      "windKph": 0,
      "precipProbability": 0,
      "precipMm": 0,
      "weatherCode": 0,
      "conditionLabel": "string",
      "conditionIcon": "string"
    },
    "hourly": [
      {
        "time": "ISO",
        "temperatureC": 0,
        "precipProbability": 0,
        "precipMm": 0,
        "windKph": 0,
        "windGustKph": 0,
        "weatherCode": 0,
        "conditionLabel": "string",
        "conditionIcon": "string"
      }
    ],
    "daily": [
      {
        "date": "YYYY-MM-DD",
        "tempMaxC": 0,
        "tempMinC": 0,
        "precipProbabilityMax": 0,
        "precipMm": 0,
        "windMaxKph": 0,
        "weatherCode": 0,
        "conditionLabel": "string",
        "conditionIcon": "string"
      }
    ],
    "alerts": [
      {
        "id": "string",
        "event": "string",
        "severity": "string",
        "certainty": "string",
        "urgency": "string",
        "headline": "string",
        "effective": "ISO|null",
        "expires": "ISO|null"
      }
    ]
  }
}
```

## 3) Diff output contract

`buildForecastDiff(previousSnapshot, currentSnapshot, mode)` returns:

- `hasChanges: boolean`
- `changes: ChangeItem[]`
- `summary: ChangeItem[]` (top-ranked human-facing rows)
- `unchangedMessage: string`
- `confidence: { label: "High|Medium|Low|Unknown", score: number, reason: string }`

Each `ChangeItem` includes:
- `type` (`temperature|precip_probability|precip_amount|wind|condition|alerts_added|alerts_removed|provider|units`)
- `granularity` (`hourly|daily|meta|alerts`)
- `key` (hour ISO/date or meta key)
- `label` (human-friendly time window)
- `from` / `to` values where applicable
- `delta`
- `message` (ready for UI)

## 4) Retention and storage

- Storage: `localStorage` with safe in-memory fallback.
- Snapshot retention: configurable by user (default **10** per location).
- On every new snapshot:
  1. prepend snapshot
  2. dedupe by snapshot ID
  3. trim to retention limit
- Timeline UI shows up to the latest 10 for quick auditing.

## 5) Added oversight agent (new)

## Agent 11: Orchestrator + Agent QA Auditor

Purpose:
- Validate each agent output against acceptance criteria.
- Detect drift (schema mismatch, API mismatch, UX wording mismatch).
- Trigger corrective updates to underperforming agents.

Checks:
1. **Contract checks**: Agent 2 + Agent 3 agree on schema and diff fields.
2. **UI checks**: Agent 4 matches Agent 1 wording and trust language.
3. **PWA checks**: Agent 5 confirms offline read-only snapshot behavior.
4. **Polish checks**: Agents 6-10 produce actionable fixes, not only notes.
5. **Exit gate**: no console errors, tests passing, docs complete.

Adjustment policy:
- If any agent output fails a gate, Agent 11 records a correction task and re-routes implementation priorities before merge.

## 6) Known compromises

- Global governmental alert feeds are not uniformly available keylessly.
- App uses NWS alerts when available; otherwise alerts are shown as unavailable/empty.
- Open-Meteo does not always expose explicit model run time in payload; UI shows that as "not provided" when absent.

## 7) Example data privacy decision

- No personal/user geodata is hardcoded anywhere in source examples.
- The quick-start and placeholder example location is **Los Angeles, California**.
