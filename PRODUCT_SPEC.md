# zweather Product Spec

## Product vision

**zweather** is a weather app that prioritizes forecast honesty over false certainty.  
It makes forecast revisions visible so people can answer:
- "What did it say before?"
- "What changed?"
- "How confident should I be now?"

## Core UX principles

1. **Truth over polish**: changes are explicit, timestamped, and easy to scan.
2. **Local-first privacy**: locations and history stay on-device.
3. **Fast and resilient**: static, installable, and useful offline with saved data.
4. **Low friction**: geolocation + manual search + one-tap refresh.

## Key screens

## 1) Home
- Location picker (city / ZIP / `lat,lon` + geolocation button)
- Status row:
  - Offline badge
  - Last updated
  - Compared-to timestamp
  - Confidence badge (High/Medium/Low/Unknown)
- Forecast blocks:
  - **Now**
  - **Today** (next hours)
  - **Next 7 days**

## 2) Forecast Changes
- Toggle: **Per hour** / **Per day**
- Human-readable change feed (examples):
  - "Tomorrow 3:00 PM: precip chance changed 20% -> 55% since 9:12 AM."
  - "Sunday: max wind changed 22 -> 31 kph."
- Explicit unchanged state:
  - "No forecast changes since last fetch."
- Snapshot timeline (latest entries with fetch times and confidence context)

## 3) Settings
- Temperature units: C/F
- Wind units: kph/mph
- Time format: 12h/24h
- Auto-refresh: on/off
- Snapshot retention limit (per location)

## 4) Trust/Transparency affordances
- "Why forecasts change" modal (short factual explanation)
- Data source line:
  - provider names
  - endpoint version
  - model run time when available
  - fetch timestamp
- Raw data section (collapsed by default)
- Privacy note:
  - "Your locations and forecast history are stored only on this device."

## User flows

## A) First-time user
1. Opens app, sees quick explanation and location controls.
2. Taps "Use my location" or enters city/ZIP/lat-lon.
3. Forecast loads and first snapshot is saved.
4. App shows "Compared to: No previous snapshot yet."

## B) Repeat user (honesty loop)
1. Returns later and taps Refresh.
2. New snapshot is compared to previous.
3. Changes feed highlights differences with old vs new values.
4. Timeline shows fetch history and supports auditability.

## C) Offline user
1. Opens app without network.
2. Sees Offline badge.
3. Last saved snapshot renders in read-only mode.
4. Refresh is disabled or fails gracefully with clear messaging.

## Confidence model

Confidence is derived from change volatility between snapshots:
- **High**: little/no change
- **Medium**: moderate revision count/magnitude
- **Low**: large or numerous revisions (including alert shifts)
- **Unknown**: no comparison baseline yet

This reflects **forecast stability**, not meteorological certainty.

## Accessibility requirements

- Keyboard-accessible controls and modals
- Focus-visible states
- High-contrast color system
- Legible text sizing and spacing
- ARIA labels for dynamic status and errors
- Minimal motion; respect `prefers-reduced-motion`

## Copy guide (trust tone)

- Clear, factual, non-dramatic language
- Never imply certainty where none exists
- Prefer "changed since last fetch" over absolute claims

## Agent execution plan (updated)

1. Agent 1: Product + UX spec
2. Agent 2: API research + selection
3. Agent 3: Data model + diff algorithm
4. Agent 4: Front-end UI
5. Agent 5: PWA + offline
6. Agent 6: Accessibility + design polish
7. Agent 7: QA bug bash
8. Agent 8: Performance
9. Agent 9: Documentation + deploy
10. Agent 10: Security + privacy
11. **Agent 11: Orchestrator + Agent QA Auditor**  
   - verifies all outputs align with acceptance criteria  
   - detects and corrects gaps before final delivery
