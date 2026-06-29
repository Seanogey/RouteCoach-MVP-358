# BusCraft RouteCoach - Prototype Build Brief (Browser PWA)

## Goal
A mobile web prototype of RouteCoach that loads one bundled route (route358.json),
follows the phone's GPS, and speaks each Location Note aloud at the right point along
the route, including approach notes that play early. The job of this prototype is to
prove that the GPS-triggered voice coaching feels right. Nothing else.

## Hard scope
IN:
  - Load route358.json (bundled, no network needed once loaded).
  - Show the route objects in driving sequence as a list.
  - Track GPS position (browser Geolocation API).
  - Speak each published Location Note via the Web Speech API (text-to-speech).
  - A SIMULATE button that plays a virtual drive along the geometry for desk testing.
  - Runs in Safari on iPhone, installable via Add to Home Screen.
OUT (do not build):
  - No authoring, no editing, no creating notes.
  - No login, accounts, server, or sync.
  - No review workflow.
  - Map is optional (see stretch).

## Tech
  - Plain HTML, CSS and vanilla JavaScript. No framework. Keep it to a handful of files.
  - Web Speech API (speechSynthesis) for voice.
  - Geolocation API (watchPosition) for live position.
  - Must be served over HTTPS (Geolocation and installability require it).

## Files
  - index.html        UI shell and buttons
  - app.js            all logic
  - styles.css        minimal styling, large touch targets
  - route358.json     the bundled route (provided)
  - manifest.webmanifest  for Add to Home Screen
  - sw.js             optional service worker to cache files for offline

## Data model (matches BusCraft Route Object Model v0.2)
Route > Direction > routeObjects[] and locationNotes[].
  - A route object has: objectId, type, sequence, location {lat,lng}, parameters.
  - A location note has: noteId, category, title, location {lat,lng},
    triggerOffsetMetres (signed), relatedObjectId (optional), text.authoredText,
    approvalState. Only notes with approvalState == "published" are used.
  - The Direction also declares shape (the 358 is "loop"). The MVP slice is treated as
    a simple forward path; full loop handling is the final section of this brief.

## The five components

1. Loader
   Fetch route358.json, parse, hold the first direction in memory.

2. Distance model (derive, do not trust seed numbers)
   - Use the haversine formula for metres between two lat/lng points.
   - Precompute cumulative distance along geometry[] (point 0 = 0 m).
   - For any lat/lng, find its distance-along-route by projecting it onto the nearest
     geometry segment and returning that segment's cumulative distance plus the
     projection along it. A simple nearest-vertex approximation is acceptable for v1.
   - Compute, for every object and note, its distanceAlongRouteMetres this way.
   - For each note, triggerDistanceMetres = its projected distance + triggerOffsetMetres.

3. GPS service
   - navigator.geolocation.watchPosition with enableHighAccuracy true.
   - On each fix, project the position to a current distance-along-route.
   - Guard against going backwards from GPS noise: only advance the "progress"
     distance, never let it jump backwards by more than a small tolerance.

4. Trigger engine (forward-only, loop-safe)
   - Build a list of published notes sorted by triggerDistanceMetres.
   - Keep an index of the next un-fired note.
   - Each time progress distance increases past the next note's triggerDistanceMetres,
     fire that note and advance the index. This fires notes in order and never fires
     the same note twice, which is what makes a loop safe.

5. Voice service
   - Speak note.text.authoredText with speechSynthesis.
   - Queue utterances so two notes never overlap; speak them in order.
   - IMPORTANT iOS rule: speech will not start until the user has tapped something.
     So the first audio must follow the Start tap (fire a short silent or welcome
     utterance on Start to unlock audio).

## Simulate mode
  - A SIMULATE button steps a virtual position from the start of geometry to the end,
    advancing about 40 km/h, updating every 500 ms, feeding the same trigger engine.
  - This lets the whole thing be tested at a desk with no GPS. Build this first.

## UI
  - Top: route name and direction name.
  - Middle: ordered list of route objects (sequence, type, stop name). Highlight the
    one nearest the current progress.
  - A NOW PLAYING banner showing the note currently being spoken.
  - Buttons: START (begin live GPS), STOP, SIMULATE, RESET.
  - Large, high-contrast, glanceable. This is used while driving.

## iPhone notes
  - Test in Safari on iPhone. Add to Home Screen for an app-like full-screen feel.
  - Geolocation will prompt for permission and needs HTTPS.
  - Background GPS and audio are unreliable in a browser; keep the app in the
    foreground. That limitation is expected and acceptable for this prototype.

## Definition of Done
  - Loads route358.json and lists the objects in driving sequence.
  - On SIMULATE, the virtual drive runs start to finish and all five notes fire once,
    in order, at roughly the right place.
  - note-2 (Princes Highway, offset -120) audibly fires BEFORE the turn object.
  - note-5 (Mascot, offset -80) audibly fires BEFORE the Mascot stop.
  - On START, live GPS fires notes as you move along a real or walked path.
  - After the page has loaded once, it still runs with the network off.

## How to run
  Easiest path to HTTPS for free:
  - Put all files in a GitHub repo and turn on GitHub Pages, then open the Pages URL
    on the iPhone; or
  - Drag the folder onto Netlify (netlify drop) for an instant HTTPS link.
  Open the link in Safari on the iPhone, allow location, tap START or SIMULATE.

-----

## Data verification (REQUIRED before a route moves to Test)

Route data must be derived and checked, never authored from memory. This exists because
the prototype shipped a wrong turn (BUG-001) that was guessed rather than derived.

### Sourcing
  - Geometry comes from a real source: the NSW GTFS shape for the route, or a recorded
    GPS drive. Not hand-drawn from memory.
  - Stop positions and sequence come from the same source.

### Derivation
  - Turn direction is COMPUTED from geometry: take the bearing just before and just after
    each junction; the sign of the bearing change gives left or right. Do not type turn
    directions by hand.
  - If a turn direction is ever entered manually, the build compares it to the
    geometry-derived value and flags any mismatch instead of accepting it silently.

### Independent verification (human pass)
  - Every turn is eyeballed against a second, independent map (CityMapper or Google
    Street View at the junction) before the Direction's lifecycleState moves to Test.
  - The domain expert (the route author who knows these roads) signs off the ordered
    turn list. This pass is quick because the turns are already laid out in sequence.

### Note cross-checks
  - Any lane or turn note near a turn object is checked against that object's direction,
    so lane advice never contradicts the turn (e.g. "left lane" for a left turn).

### Rule of thumb
  - The skeleton is derived and verified; only expert judgement (the notes) is authored.
    If a structural value cannot be traced to geometry or a map, it is not ready for Test.

-----

## Loop, self-overlap and segment anchoring (FULL-LOOP BUILD ONLY)

The Sydenham-to-Mascot MVP slice needs none of this. Build it when extending to the
full loop.

### Positioning is held two ways at once
  - Coarse anchor (segment): which segment you are in, between object N and object N+1,
    indexed by each object's sequence. Hard to corrupt. Used for display, coaching
    language, and as a guard rail.
  - Fine detail (metres): distance along geometry within the segment. Used to fire notes.

### Rules
  1. Forward-only progress. Never jump backwards more than ~25 m (GPS noise).
  2. Reject segment skips. A fix advancing more than one or two segments per update is
     treated as noise; hold the last good segment.
  3. Windowed projection. Match the live position only within +/- ~150 m of last known
     progress, not the globally nearest point on the line.
  4. Heading gate. Reject candidate points whose route direction of travel is more than
     ~90 deg from the phone's heading, when moving faster than ~2 m/s. This separates
     the two legs of a loop.
  5. No-wrap. Do not reset progress to zero until the final object is passed or progress
     exceeds ~95% of total length (the 358 starts and ends at Sydenham).

### Notes carry afterObjectSequence
Every published note is pinned between two objects via afterObjectSequence, so even an
unlinked mid-block note has a coarse position and can be fired relative to the segment.

### Direction declares its shape
pointToPoint | loop | outAndBack | lollipop. The 358 is loop. outAndBack and lollipop
also set reversalPointMetres.

### Deferred (do not build): 1D Kalman filter (smoothing and dead reckoning across GPS
dropouts) and a multi-hypothesis particle filter. Sequence anchoring is a guard rail and
fallback, not a position source across a true blackout.

### Testing: use Simulate with full-loop geometry; test the Sydenham start/end pinch
point and any shared streets; confirm no note fires on the wrong leg and the route does
not complete early.
