'use strict';

// ============================================================
// CONFIG
// ============================================================
const ROUTE_FILE          = 'route358.json';
const SIM_SPEED_MPS       = 40000 / 3600;            // 40 km/h
const SIM_INTERVAL_MS     = 500;
const SIM_STEP_M          = SIM_SPEED_MPS * (SIM_INTERVAL_MS / 1000); // ~5.56 m
const GPS_BACK_TOLERANCE  = 25;                       // metres

// ============================================================
// STATE
// ============================================================
let state = {
  mode:         'idle',   // 'idle' | 'live' | 'simulating'
  progress:     0,        // metres along route
  nextNoteIdx:  0,
  watchId:      null,
  simHandle:    null,
  simPosition:  0,
  audioUnlocked: false,
};

// ============================================================
// ROUTE DATA (populated by loadRoute)
// ============================================================
let routeData   = null;
let direction   = null;
let geometry    = [];
let cumDist     = [];     // cumDist[i] = metres from point 0 to point i
let totalDist   = 0;
let objects     = [];     // route objects sorted by sequence, annotated with distanceAlongRouteMetres
let notes       = [];     // published notes sorted by triggerDistanceMetres

// ============================================================
// HAVERSINE
// ============================================================
function haversineMetres(lat1, lng1, lat2, lng2) {
  const R    = 6371000;
  const toR  = x => x * Math.PI / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a    = Math.sin(dLat / 2) ** 2
             + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ============================================================
// DISTANCE MODEL
// ============================================================
function buildCumDist(geom) {
  const cum = [0];
  for (let i = 1; i < geom.length; i++) {
    cum.push(cum[i - 1] + haversineMetres(
      geom[i - 1].lat, geom[i - 1].lng,
      geom[i].lat,     geom[i].lng
    ));
  }
  return cum;
}

// Nearest-vertex projection: returns metres along route
function projectToRoute(lat, lng) {
  let minD = Infinity, bestIdx = 0;
  for (let i = 0; i < geometry.length; i++) {
    const d = haversineMetres(lat, lng, geometry[i].lat, geometry[i].lng);
    if (d < minD) { minD = d; bestIdx = i; }
  }
  return cumDist[bestIdx];
}

// ============================================================
// LOADER
// ============================================================
async function loadRoute() {
  const res = await fetch(ROUTE_FILE + '?v=' + Date.now());
  if (!res.ok) throw new Error(`Failed to fetch ${ROUTE_FILE}: ${res.status}`);
  routeData  = await res.json();
  direction  = routeData.directions[0];
  geometry   = direction.geometry;
  cumDist    = buildCumDist(geometry);
  totalDist  = cumDist[cumDist.length - 1];

  // Annotate route objects
  objects = direction.routeObjects
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map(obj => ({
      ...obj,
      distanceAlongRouteMetres: projectToRoute(obj.location.lat, obj.location.lng),
    }));

  // Annotate notes (published only), sort by trigger distance
  notes = direction.locationNotes
    .filter(n => n.approvalState === 'published')
    .map(n => {
      const d = projectToRoute(n.location.lat, n.location.lng);
      return { ...n, distanceAlongRouteMetres: d, triggerDistanceMetres: d + n.triggerOffsetMetres };
    })
    .sort((a, b) => a.triggerDistanceMetres - b.triggerDistanceMetres);

  // Debug: log computed distances
  console.group('Route loaded — trigger distances');
  notes.forEach(n => console.log(
    `${n.noteId} "${n.title}" → trigger at ${Math.round(n.triggerDistanceMetres)} m`
  ));
  console.log(`Total route length: ${Math.round(totalDist)} m`);
  console.groupEnd();

  renderHeader();
  renderRouteList();
  registerSW();
}

// ============================================================
// VOICE SERVICE
// ============================================================
const speechQueue = [];
let isSpeaking    = false;

function speakNext() {
  if (isSpeaking || speechQueue.length === 0) return;
  const { text } = speechQueue.shift();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate   = 0.95;
  utt.pitch  = 1.0;
  utt.volume = 1.0;
  isSpeaking = true;
  showNowPlaying(text);
  utt.onend = utt.onerror = () => {
    isSpeaking = false;
    if (speechQueue.length === 0) hideNowPlaying();
    speakNext();
  };
  speechSynthesis.speak(utt);
}

function enqueueSpeak(text) {
  speechQueue.push({ text });
  speakNext();
}

function clearSpeech() {
  speechSynthesis.cancel();
  speechQueue.length = 0;
  isSpeaking = false;
  hideNowPlaying();
}

// iOS requires speechSynthesis.speak() to be called in a user-gesture context.
// Call this on every button press before resetting state.
function unlockAudio() {
  if (state.audioUnlocked) return;
  state.audioUnlocked = true;
  // Calling speak() here — in the synchronous gesture callback — unlocks iOS audio.
  // The utterance will be cancelled by clearSpeech() but the unlock persists.
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
}

// ============================================================
// TRIGGER ENGINE
// ============================================================
function checkTriggers(progressM) {
  while (
    state.nextNoteIdx < notes.length &&
    progressM >= notes[state.nextNoteIdx].triggerDistanceMetres
  ) {
    const note = notes[state.nextNoteIdx];
    enqueueSpeak(note.text.authoredText);
    console.log(`▶ Fired ${note.noteId} at ${Math.round(progressM)} m (trigger ${Math.round(note.triggerDistanceMetres)} m): "${note.title}"`);
    state.nextNoteIdx++;
  }
}

function advanceProgress(newM) {
  // Forward-only guard: reject jumps backwards beyond noise tolerance
  if (newM < state.progress - GPS_BACK_TOLERANCE) return;
  state.progress = Math.max(state.progress, newM);
  checkTriggers(state.progress);
  updateUI();
}

// ============================================================
// GPS SERVICE
// ============================================================
function startLive() {
  if (!navigator.geolocation) {
    alert('Geolocation not supported by this browser.');
    return;
  }
  state.mode = 'live';
  setModeLabel('LIVE', 'live');
  setButtonState();

  state.watchId = navigator.geolocation.watchPosition(
    pos => advanceProgress(projectToRoute(pos.coords.latitude, pos.coords.longitude)),
    err  => console.error('GPS error', err.code, err.message),
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
  );
}

function stopGPS() {
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
}

// ============================================================
// SIMULATE MODE
// ============================================================
function startSimulate() {
  state.mode        = 'simulating';
  state.simPosition = 0;
  setModeLabel('SIMULATING', 'simulating');
  setButtonState();

  state.simHandle = setInterval(() => {
    state.simPosition += SIM_STEP_M;

    if (state.simPosition >= totalDist) {
      state.simPosition = totalDist;
      advanceProgress(state.simPosition);
      stopSimulate();
      state.mode = 'idle';
      setModeLabel('DONE', 'done');
      setButtonState();
      return;
    }

    advanceProgress(state.simPosition);
  }, SIM_INTERVAL_MS);
}

function stopSimulate() {
  if (state.simHandle !== null) {
    clearInterval(state.simHandle);
    state.simHandle = null;
  }
}

// ============================================================
// RESET
// ============================================================
function resetAll() {
  stopGPS();
  stopSimulate();
  clearSpeech();
  state.mode        = 'idle';
  state.progress    = 0;
  state.nextNoteIdx = 0;
  state.simPosition = 0;
  setModeLabel('IDLE', '');
  setButtonState();
  updateUI();
}

// ============================================================
// UI RENDERING
// ============================================================
const ICON = {
  startPoint: '🚌',
  busStop:    '🛑',
  turn:       '↗',
  endPoint:   '🏁',
};

function renderHeader() {
  document.getElementById('route-name').textContent      = routeData.routeName;
  document.getElementById('direction-name').textContent  = direction.name;
}

function renderRouteList() {
  const ul = document.getElementById('route-list');
  ul.innerHTML = '';

  objects.forEach((obj, i) => {
    const li = document.createElement('li');
    li.className  = 'route-item';
    li.dataset.idx = i;

    const params = obj.parameters || {};
    const label  = params.stopName ||
                   (params.turnDirection ? `Turn ${params.turnDirection} → ${params.intoStreet}` : obj.type);

    li.innerHTML = `
      <span class="item-seq">${obj.sequence}</span>
      <span class="item-icon">${ICON[obj.type] || '•'}</span>
      <div class="item-body">
        <div class="item-name">${label}</div>
        <div class="item-type">${obj.type}</div>
      </div>
      <div class="item-dist">${fmtDist(obj.distanceAlongRouteMetres)}</div>
    `;

    ul.appendChild(li);
  });
}

function updateUI() {
  updateDistanceDisplay();
  highlightActive();
}

function updateDistanceDisplay() {
  document.getElementById('distance-display').textContent = fmtDist(state.progress);
}

function highlightActive() {
  // Nearest object to current progress (smallest absolute delta)
  let activeIdx = 0, bestDelta = Infinity;
  for (let i = 0; i < objects.length; i++) {
    const delta = Math.abs(objects[i].distanceAlongRouteMetres - state.progress);
    if (delta < bestDelta) { bestDelta = delta; activeIdx = i; }
  }

  const items = document.querySelectorAll('.route-item');
  items.forEach((li, i) => {
    li.classList.remove('active', 'passed');
    if (i < activeIdx)      li.classList.add('passed');
    else if (i === activeIdx) {
      li.classList.add('active');
      li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
}

function showNowPlaying(text) {
  document.getElementById('np-text').textContent = text;
  document.getElementById('now-playing').classList.remove('hidden');
}

function hideNowPlaying() {
  document.getElementById('now-playing').classList.add('hidden');
}

function setModeLabel(text, cls) {
  const el = document.getElementById('mode-label');
  el.textContent = text;
  el.className   = cls;
}

function setButtonState() {
  const running = state.mode === 'live' || state.mode === 'simulating';
  document.getElementById('btn-start').disabled    = running;
  document.getElementById('btn-simulate').disabled = running;
  document.getElementById('btn-stop').disabled     = !running;
  document.getElementById('btn-reset').disabled    = running;
}

function fmtDist(m) {
  if (m >= 1000) return (m / 1000).toFixed(1) + ' km';
  return Math.round(m) + ' m';
}

// ============================================================
// BUTTON HANDLERS
// ============================================================
document.getElementById('btn-start').addEventListener('click', () => {
  unlockAudio();   // must be first, synchronously in gesture handler
  resetAll();
  startLive();
});

document.getElementById('btn-simulate').addEventListener('click', () => {
  unlockAudio();   // must be first, synchronously in gesture handler
  resetAll();
  startSimulate();
});

document.getElementById('btn-stop').addEventListener('click', () => {
  stopGPS();
  stopSimulate();
  clearSpeech();
  state.mode = 'idle';
  setModeLabel('STOPPED', 'stopped');
  setButtonState();
});

document.getElementById('btn-reset').addEventListener('click', resetAll);

// ============================================================
// SERVICE WORKER
// ============================================================
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err =>
      console.warn('SW registration failed:', err)
    );
  }
}

// ============================================================
// INIT
// ============================================================
loadRoute().catch(err => {
  console.error('Failed to load route:', err);
  document.getElementById('route-name').textContent = 'Error: ' + err.message;
});
