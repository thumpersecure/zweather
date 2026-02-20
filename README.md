# zweather

zweather is a static, installable weather web app focused on **forecast honesty**:

- it stores forecast snapshots over time,
- compares new vs previous forecasts for the same location,
- and clearly tells users what changed, when, and by how much.

All location/history data stays on the device (localStorage).

## Live architecture

- Static site (GitHub Pages compatible)
- Vanilla HTML/CSS/JS modules (no framework)
- Service worker for offline shell caching
- Local snapshot history (no server database)

## Data providers

- Forecast + hourly/daily weather: **Open-Meteo** (`/v1/forecast`)
- Geocoding (city/ZIP-like search): **Open-Meteo Geocoding** (`/v1/search`)
- Alerts (best effort, mostly US): **NWS Alerts API** (`api.weather.gov`)

## API key instructions

No API key is required for the default app flow (demo mode is effectively the default mode).

- You can run and deploy directly with no secrets.
- Do not commit secrets to the repo.
- If you later extend the app with a key-based provider, keep the key in local-only config and document the public-client exposure tradeoff.

## Features

- Geolocation + manual search (city / ZIP-like text / `lat,lon`)
- Quick-start example button: **Los Angeles, California**
- Home forecast:
  - Now
  - 24h temperature trend chart
  - Today (next hours)
  - Next 7 days
- Honest changes view:
  - per-hour / per-day toggle
  - diff summaries with previous -> current values + timestamps
  - explicit unchanged state
  - snapshot timeline (latest 10)
- Honesty report:
  - stability score (0-100)
  - changed vs stable compared windows
  - largest shift highlight
  - alert-change count
- Settings:
  - C/F
  - kph/mph
  - 12h/24h time
  - auto-refresh toggle (30 min)
  - retention limit
- Trust UX:
  - why forecasts change modal
  - data source transparency line
  - raw data expandable panel
  - privacy note
- PWA:
  - manifest
  - service worker
  - Add to Home Screen helper (dismissible, non-nag)
  - offline badge + read-only cached snapshots

## Project structure

```text
.
├── AGENT_EXECUTION_REPORT.md
├── DECISIONS.md
├── LICENSE
├── PRODUCT_SPEC.md
├── README.md
├── icons/
│   ├── icon-192.svg
│   └── icon-512.svg
├── index.html
├── manifest.json
├── media/
│   └── honesty-radar.svg
├── package.json
├── service-worker.js
├── src/
│   ├── api.js
│   ├── constants.js
│   ├── diff.js
│   ├── main.js
│   ├── normalize.js
│   ├── storage.js
│   ├── utils.js
│   └── weather-codes.js
├── styles.css
└── tests/
    └── diff.test.js
```

## Local development

Serve statically from repo root:

```bash
python3 -m http.server 4173
```

Open: `http://localhost:4173`

## Run tests

```bash
npm test
```

Tests cover core diff logic (hourly/daily deltas, unchanged handling, alert/meta changes).

## Deploy to GitHub Pages

1. Push the repository to GitHub.
2. Go to **Settings -> Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select your branch (for example `main`) and root folder (`/`).
5. Save and wait for Pages to publish.

No server steps are required.

## iOS install notes

iOS Safari uses a different install flow:

1. Open the deployed site in Safari.
2. Tap the Share button.
3. Tap **Add to Home Screen**.

iOS may not show `beforeinstallprompt`, so the app includes docs and avoids aggressive prompts.

## Troubleshooting

- **No forecast changes shown**: fetch at least two snapshots for the same location.
- **Alerts empty**: alerts feed coverage varies by region; non-US areas may show none.
- **Offline mode**: app shell + previously saved snapshots are available; refresh needs network.
- **Geolocation denied**: use manual city/ZIP-like query or `lat,lon`.
- **Try a known location quickly**: click "Try Los Angeles, California."

## Security and privacy notes

- CSP is set in `index.html` to reduce XSS/injection risk.
- No secrets are committed.
- App is client-only; weather history and locations are stored only on-device.
- Service worker caches only app shell assets, not third-party API payloads.
- No personal geodata is hardcoded in examples; Los Angeles is used for sample UX.

## Limitations

- Forecast confidence reflects **forecast stability between snapshots**, not absolute meteorological certainty.
- Model run time may be unavailable from upstream payloads and is shown as "not provided".
- Weather alerts depend on external public coverage and may be unavailable for some locations.
