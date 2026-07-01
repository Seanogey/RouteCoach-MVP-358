# Session Log

## 2026-06-29

### Bugs Fixed

**BUG-001** — Turn direction showing "right" instead of "left"
Fixed. Turn directions now display correctly.

**BUG-002** — Street suffix showing "Ave" instead of "Avenue"
Fixed. Full street suffix now rendered.

---

### Diagnosed: Stale Service Worker Cache

Identified that a stale service worker cache was serving outdated assets after deploys. Noted as a known issue to address (e.g. cache versioning or `skipWaiting` strategy).

---

### Published to GitHub Pages

Created public repo `Seanogey/RouteCoach-MVP-358` and enabled GitHub Pages on `main` branch root.

Live URL: `https://seanogey.github.io/RouteCoach-MVP-358/`

---

### Proximity Walk Test — `test-stop.html`

Built a self-contained GPS proximity test for the Bourke St stop.

| Parameter | Value |
|---|---|
| File | `test-stop.html` |
| Query param shortcut | `?test=stop` |
| Target coordinates | -33.922497, 151.187241 |
| Trigger radius | 20 m (`TRIGGER_METRES` variable at top of file) |

**Behaviour:**
- On first GPS fix, sets baseline silently (no speech) to avoid false trigger if already near the stop
- Speaks *"Sean, you are approaching the 358 bus stop now"* once on crossing inside 20 m
- Speaks *"you are leaving the 358 bus stop"* once on crossing outside 20 m
- State machine re-arms only after a full boundary crossing — no repeat or stutter while hovering near the edge
- iOS audio unlocked via first tap (required by Safari)
- Screen wake lock held for the duration of the test

---

### Test Results

**iPhone 13 (live GPS) — PASSED**
Clean voice prompts on entry and exit. Distance readout accurate. State machine behaved correctly across multiple boundary crossings.

**Older iPhone — INCONCLUSIVE**
GPS signal was weak; distance to stop was miscalculated. Not a logic bug — device GPS accuracy is a real-world factor to handle in a future pass (e.g. ignore fixes with high `coords.accuracy`, or apply a hysteresis band wider than the accuracy radius).

---

### Architecture Decision

**AD-025** — Turn directions are derived from route geometry, not hand-authored.

Turn bearing and left/right classification must be computed from the geometry coordinates. Hand-authored turn direction fields in route data are not authoritative and should not be used for spoken instructions.
