# BusCraft v0.1 Design Specification

Product: BusCraft RouteCoach (native iPhone + optional Apple Watch)
Version: 0.1
Status: Design signed off 30 June 2026
Owner: Jemeris Consulting
Related canon: Route Object Model v0.2, Application Architecture v1.1, Persona 2 (Trainee Driver v0.2), ADL v0.4, Project State v0.3

-----

## Overview

RouteCoach is a headless, voice-first coaching app. Once a session is started, there is no screen to look at and no map. The driver watches the road, phone in a pocket or bag, and listens. The app's entire job is to know where the bus is from GPS and speak the right coaching cue at the right moment.

v0.1 is a personal prototype, built and tested by the author, not a release to trainee drivers.

-----

## Section 1 - Scope and Platform

### In scope for v0.1
- RouteCoach, native, iPhone, with an optional Apple Watch companion on one shared engine. iPad may come along but is not a focus.
- Headless, voice-first coaching: no map, no screen to read while driving.
- The phone is the brain: it holds the route, reads GPS, runs the trigger engine, and is the default speaker.
- The Apple Watch, when present, is a local speaker and haptic surface only (no GPS, no logic). Microphone voice commands are deferred. If there is no Watch, sound comes from the phone.
- Automatic spoken cues are the whole v0.1 product. Voice-command control (pause/play/stop/repeat) is deferred to the next version.
- Offline operation, a loop-capable positioning engine, consumes Route Object Model v0.2, turns derived from geometry (AD-025).
- Coaching modes: the engine is built mode-aware (every cue tagged structure or note); v0.1 defaults to "Both"; the three-mode selector is a fast-follow.
- A personal RouteStudio-lite editor so the author stops hand-editing JSON.
- Tester mode (behind a build flag, observe-only).

### Out of scope / deferred
- Voice-command control (next version).
- RouteExpert field capture; the review/approve/publish workflow.
- Cloud sync.
- Apple Watch microphone commands; iPad as a priority; Desktop replay; VR/Simulator.
- Trainee personal notes and feedback.
- Operational Notices (designed for later; see Section 10).

-----

## Section 2 - Start Flow and Controls

### Principle
The screen exists only to start and stop a session before driving. Once coaching is running, the phone is pocketed and the screen is irrelevant. No map, nothing to read while driving.

### Start flow (all before the bus moves)
1. Pick a route from the routes on the device.
2. Pick a direction (for the 358 loop, the single loop direction; otherwise inbound/outbound).
3. Tap Start. The app speaks a short confirmation, e.g. "Route 358, Sydenham to Randwick, coaching started", and the driver pockets the phone.

The spoken Start confirmation also serves as the iOS first-tap gesture that unlocks audio.

### Behaviour decisions (agreed)
- Start means ARM. After Start the engine stays silent until the bus reaches the route's start point, then begins cueing. This supports pocketing the phone early.
- At the end of the route the app speaks "Route complete" and stops itself.

### Screens
- Selection screen: list of routes; selecting one shows its directions. Large, high-contrast, thumb-friendly.
- Running state: a minimal "Coaching running - Route 358" line and a Stop button, so a glance before setting off confirms it is live. Not intended to be viewed while moving.

### Controls (pre-drive or while safely stopped only; no use while moving)
- Start (arm and begin), Stop / End, Repeat last cue, Pause / Resume.
- Voice-command control of these is deferred to the next version.

### Tester Mode (cross-cutting; NOT in the trainee build)
Separated from the trainee build by a BUILD FLAG, so tester features are physically absent from the version trainees receive. Observe-only for v0.1 (no live test controls yet).

Readouts shown on the phone in tester mode:
- Current position: object N of total, and which segment we are between (e.g. "Object 9 of 64 - Coward St").
- Distance along route and distance to the next cue.
- Next-cue preview: the text about to be spoken and at what distance.
- Live GPS health: reported accuracy in metres.
- Heading and speed.
- A scrolling, timestamped log of cues as they fire, for post-drive review.

Tester Mode is observe-only and additive: it displays engine state but must not change engine behaviour. Usage rule: tester readouts are for use parked, as a passenger, or with a second person, never while driving solo.

-----

## Section 3 - The Cue Model

### What a cue is
A cue is one spoken utterance triggered at one point along the route. The spoken stream is the product.

### Sources of cues
1. Structural announcements - generated automatically from the route skeleton: "Bus stop ahead, Sydenham Green", "Left turn into Princes Highway", "Roundabout ahead". Turn directions are generated from geometry (AD-025), so left/right is always derived from the road.
2. Expert Location Notes - the human coaching: "Watch the left mirror here", "this stretch banks up".
3. Session cues - the Start confirmation and "Route complete".

### Coaching modes (engine mode-aware now; v0.1 defaults to "Both")
Every cue is tagged "structure" or "note". Modes are a filter on the stream:
1. Structure only - lefts, rights, stops; no notes.
2. Notes only - expert coaching; no structural narration.
3. Both - structure plus notes layered together.
v0.1 ships defaulted to "Both". The three-mode selector is a fast-follow; the engine supports all three from the start.

### Phrasing for the ear
- Spell words out for speech: "Avenue" not "Ave", "Road" not "Rd". Applies to stop names as well as notes.
- Lead with the action, then the detail.
- Keep each cue to roughly one breath; trim long notes for speech.
- Fire early enough to act on, via the note's trigger offset.

### Pacing rules
- One cue at a time, never two voices (a queue).
- A minimum gap between cues so they do not machine-gun (tuned on the road).
- If two cues collide, the higher-priority cue speaks first; the lower one speaks after the gap only if still relevant, otherwise it is dropped.
- Drop if overtaken: a cue whose point has passed is dropped, never spoken late.

### Priority order (highest to lowest)
1. hazard
2. turn
3. lane / roadPosition
4. stop
5. mirror
6. timing
7. braking / acceleration
8. passenger
9. general

### Spoken-form text
v0.1 keeps abbreviations expanded by hand (in notes and stop names). A separate "spoken form" field (FEAT-001) is deferred to RouteStudio-lite.

-----

## Section 4 - Positioning and the Trigger Engine

### Purpose
From a stream of GPS fixes, always know how far along the route the bus is, and fire the right cue at the right moment - reliably, on a loop, with imperfect GPS.

### Position = coarse anchor + fine detail (AD-024)
- Coarse: which segment the bus is in, between object N and object N+1. Hard to corrupt; also feeds tester mode.
- Fine: metres along the route within that segment. Used to fire cues.

### Core rules (AD-016, AD-023)
- Forward-only progress: never jump backwards more than a small tolerance (GPS noise).
- Windowed projection: match each fix only to the stretch just ahead of the last known position, not the globally nearest point on the line. Stops wrong-strand snapping where the 358 passes near itself.
- Heading gate: where the route runs near itself in opposite directions, use heading to pick the correct leg (reject candidates more than ~90 deg off, when moving faster than walking pace).
- No-wrap: do not reset progress to zero until the route is genuinely complete (the 358 starts and ends at Sydenham).
- Firing: cues sorted by trigger distance; fire the next pending cue as progress passes it; advance; never fire twice. Then apply Section 3 pacing and priority.

### GPS-accuracy handling
Each fix reports an accuracy figure (metres):
- Good accuracy (under ~15 m): trust the fix, fire cues normally.
- Poor accuracy (over ~35 m): do not make sharp decisions on an untrusted fix. Hold the last good position, lean on the coarse segment anchor, ride speed and heading until accuracy recovers.
- Thresholds are starting values, tuned on the road. Surfaced in tester mode.
Principle: the engine knows when not to trust its own eyes.

### True GPS dropout (e.g. tunnel), v0.1
Hold the last position and stay silent until GPS returns, rather than guessing.

### Deferred (AD-023)
- 1D Kalman filter / dead reckoning to coast through a full blackout.
- Multi-hypothesis (particle) filter.

-----

## Section 5 - Voice and Audio

### Speech production
On-device text-to-speech (AVSpeechSynthesizer). Works offline (required). v0.1 speaks cue text only; recorded human audio is deferred.

### iOS audio unlock
iOS will not speak until the user has tapped something. The spoken Start confirmation serves as that unlock and primes the voice layer for the session.

### Audio routing
- Default: phone speaker.
- Watch mode (user-selected): cues go to the Watch as a wrist haptic tap plus speech. In a bus cab there is no car audio, so the Watch speaker is the actual output. Every Watch cue is paired with a haptic tap as the "listen now" signal.
- Bluetooth / earpiece: if paired, cues play through it.

### Mixing with other audio
- Duck: briefly lower other audio (music, radio), speak the cue, restore.
- During a live phone call: hold non-hazard cues and resume after the call. HAZARD cues speak through the call regardless (hazard outranks a conversation). Note: a hazard spoken during a call may be audible to the other party.

### Volume
v0.1 rides the system/device volume. No separate in-app volume control.

### Open risk to validate (Watch mode)
The Watch speaker is small and may struggle against engine and road noise. Test early whether it cuts through. The haptic tap is important as the pre-cue signal. If the speaker cannot be heard, the fallback is a Bluetooth earpiece or the phone in a cradle, not car audio. Voice may need to be clearer, slower and well-spaced for the Watch.

-----

## Section 6 - Data and Storage

### Requirements
- The app works fully offline; the route lives on the device, never fetched while driving.
- A route is a Route Object Model v0.2 file (JSON).
- The sole author must be able to get an edited route onto the phone easily, without rebuilds or the Google-Doc/cache pain.

### How routes get onto the phone (agreed)
- The app holds a small route library: a list of route source URLs (reusing GitHub hosting).
- Each route is downloaded once when online and stored on the device.
- Thereafter the app runs fully offline from the stored copy.
- A manual "refresh routes" action re-downloads when a change has been published.
- The device may hold a few routes at once.

### On-device storage
- Store route JSON files in the app's local storage.
- Parse into the Route Object Model on load; hold the parsed route in memory during a session.

### Update loop (ties to Section 7)
Edit a route in RouteStudio-lite, publish the JSON file to GitHub, tap "refresh routes" on the phone. No app rebuild needed to change route content.

-----

## Section 7 - RouteStudio-lite (personal editor)

### What it is
A throwaway personal tool for the sole author while iterating. A single-page web tool (runs in a browser on the Mac). Opens a Route Object Model v0.2 file, shows objects and notes in a form, validates, saves valid JSON. No accounts, no review/publish workflow, no polish. Not the real RouteStudio.

### What it edits
- Location Notes: text, category (dropdown from the controlled list), trigger offset, optional related object, note location; add and delete notes.
- Stop names: edit and tidy (and spell for the ear).
- Note location: pin/move a note.

### What it must NOT allow (AD-025)
- Turn directions are NOT hand-editable. The editor shows each turn's direction as a read-only value computed from geometry. If a stored value disagrees with the computed one, the editor flags the conflict rather than allowing a typed override. This bakes the BUG-001 fix into the tool.

### Map
- RouteStudio-lite includes a simple map (the "no map" rule applies to the driving app, not the desktop editor). The map is how the author sees where a note sits and places a new note without typing coordinates.

### Validation
Before saving: valid JSON, category from the controlled list, required fields present, IDs intact. The tool will not produce a broken route file, and writing the file properly avoids the curly-quote problem.

### Save and hand-off
- The editor saves the route JSON locally.
- The author commits it to the GitHub repo by hand (via Claude Code or git); that publishes it.
- The phone picks it up via "refresh routes". No GitHub publishing built into the editor.

### Deferred
- A separate "spoken form" field (FEAT-001). Hand-expand abbreviations for now. RouteStudio-lite is its future home.

-----

## Section 8 - Non-functional and Safety

### Offline
Routes and notices live on the device; on-device TTS means voice works with no signal. Only the sign-on refresh needs connectivity, done at the depot, never while driving.

### Background operation and battery
- Runs headless in a pocket for the whole run: screen off, GPS and audio alive throughout. Built to keep GPS and audio running in the background from the start (an iOS capability declared up front).
- Continuous GPS is a real battery draw. Flagged for measurement; a cradle/charging point mitigates it.

### GPS-accuracy degradation (Section 4)
Trust fixes under ~15 m; cautious over ~35 m (hold and coast); silent through a full dropout. Degrades gracefully rather than misfiring.

### Performance
Keep up with GPS fixes in real time (~1/sec) and fire cues without lag, on a range of phones including older ones.

### Safety principles
1. No interaction required while moving. Start before driving, phone away, voice-only, no in-motion controls. The cardinal property.
2. The app advises; the driver decides. A cue is coaching, never a command to act blindly. The driver's eyes and judgement always override. Explicit now, and stated plainly in the app when it reaches trainees.
3. Better silent than wrong. A wrong cue is the cardinal sin; silence is the safe fallback.
4. Cues must not distract. Pacing and priority are a safety feature: one clear cue at a time, hazards first.
5. Tester mode is never for solo driving.

### Scope boundary (future gate)
v0.1 is a personal prototype, not a trainee release. Before BusCraft reaches trainees, a safety, reliability and duty-of-care gate must be cleared, likely including how the app is introduced, what trainees are told about its limits, and sign-off from the training organisation. Recorded as a known future gate, not a v0.1 task.

-----

## Section 9 - Definition of Done and Sign-off Criteria

### Design sign-off
The v0.1 design is signed off when Sections 1-9 are agreed and captured. SIGNED OFF 30 June 2026.

### v0.1 build - Definition of Done

Core coaching
- Loads a Route Object Model v0.2 route from the on-device route library.
- Driver picks route and direction, taps Start, hears the confirmation, pockets the phone.
- Start arms the engine; silent until the bus reaches the route start, then cues.
- Speaks structural announcements (stops; turns from geometry) and expert notes in "Both" mode, correctly ordered and paced (one at a time, hazards first, no overlap).
- Approach cues fire early per their trigger offset.
- Speaks "Route complete" and stops itself at the end.

Engine
- Position as coarse segment + fine metres; forward-only; loop-safe on the 358 (windowed projection, heading gate, no-wrap).
- GPS-accuracy handling (trust good fixes, hold/coast on poor, silent through a dropout).

Voice / audio
- On-device TTS, offline. Abbreviations spelled for the ear. Ducks other audio. Rides system volume.
- Audio to phone by default, or Watch (haptic + speech) when Watch mode selected.

Watch
- Optional Apple Watch companion as speaker + haptic; phone remains the brain; app works fully without a Watch.

Offline
- A full run works with no signal once the route is on the device.

Tester mode
- Behind a build flag (absent from any trainee build). Observe-only: object N of total, distance to next cue, next-cue preview, GPS accuracy, cue log.

RouteStudio-lite
- Personal editor: open a route file, edit notes/categories/offsets/stop names with a map, turns read-only from geometry, validate, save valid JSON.

Seams for later (built, not filled)
- Refresh step able to also carry a notices bundle.
- Session start able to speak a briefing before the route arms.

### Acceptance test (the real proof)
A full run of the 358 (Sydenham to Mascot, then the full loop), driven or ridden as a passenger, where cues fire correctly at the right places, the loop is handled without wrong-strand errors, and it feels genuinely useful to someone learning the route.

-----

## Section 10 - Operational Notices (design-for-later; NOT in v0.1)

### What it is
A temporary, author-created information layer, separate from permanent route knowledge. Route knowledge is true every day (authored, reviewed, published slowly); Notices are time-bound (posted quickly, expire, not part of the route's permanent record).

### Authoring
- Authored by depot / operations staff. NEVER by drivers.
- A depot-side posting surface (or integration with the depot's existing sign-on system) posts, updates and clears notices. Detail defined at build time.

### A Notice (one object, author-set attributes)
- content: the message text.
- importance: varies on a single pile ("daily" vs "urgent" is a level, not a category split). Affects ordering/emphasis within the briefing.
- reach: which routes / depot / area it applies to. Delivered only to drivers in scope.
- placement: general to the run, or nominally tied to a spot.
- expiry: author decides per notice - set end date (auto-clear), manual clear (open-ended), or end-of-day reset.
- lifecycle: can be updated or cleared after posting.

### Delivery (the key simplification)
- Fetched at sign-on / session start at the depot, with connectivity, alongside the route refresh (reuses Section 6's mechanism).
- Carried offline for the drive. No live push to a moving vehicle.
- Delivered ONCE, as a spoken briefing at the start of the run, ordered by importance, before the route arms.
- Notices NEVER interrupt during the drive. Genuinely urgent mid-shift comms are handled by the bus radio, not BusCraft.
- Because delivery is briefing-only, even a location-specific notice is mentioned in the briefing rather than fired as a cue at the spot.
- Consequence of the offline model: an "all clear" also only lands at the next sign-on. Accepted.

### What v0.1 must do for this (the only build cost now)
Leave two clean seams:
1. The refresh step is built so it COULD also fetch a notices bundle.
2. Session start is built so it COULD speak a briefing before the route arms.
Nothing else is built in v0.1.

### Relationship to route knowledge
- Permanent hazards/coaching (e.g. "handbrake on hill seven") belong in the route as Location Notes, not as Notices.
- A Notice may temporarily EMPHASISE such existing knowledge (e.g. re-stressing the handbrake reminder after incidents), as briefing material, for a period.

-----

End of v0.1 Design Specification
