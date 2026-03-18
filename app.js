/**
 * VolleyStat v0.1.4
 *
 * Requested updates:
 * 1) Player View: keep Serve In % (includes aces) and ensure NO heatmap/legend visuals are shown.
 * 2) Coach View: remove Opp SR 0 (ACE) and Opp SR 0% columns (they were redundant).
 * 3) Coach View: Opp SR Avg is the opponent serve-receive average (inverse of our serve rating):
 *    Opp SR Avg = (3*serve1 + 2*serve2 + 1*serve3 + 0*ace) / (serve1+serve2+serve3+ace)
 *    (ServeOut excluded because there was no reception.)
 * 4) CSV headers updated to match the above (Coach export excludes Opp SR 0 columns).
 *
 * Notes:
 * - Storage key remains volleystat_v008 to preserve existing saved teams.
 * - Uses broadly-compatible JS syntax (no optional catch binding, no optional chaining).
 */

console.log('[VolleyStat] v0.1.4 loaded');

var STORAGE_KEY = 'volleystat_v008';
var UI_MODE_KEY = 'volleystat_ui_mode';

var DEFAULT_MATCHES = ['Match 1', 'Match 2', 'Match 3'];

var PASS_WEIGHTS = { passToTarget: 3, passNearTarget: 2, passAwayTarget: 1, passShank: 0 };
// Serve weights are only used for PLAYER Serve Avg (OUT is not scored)
var SERVE_WEIGHTS = { serve1: 1, serve2: 2, serve3: 3, ace: 4 };

var HIT_ATTEMPT_ACTIONS = ['swing', 'swingOut', 'kill', 'tip', 'tipKill'];
var HIT_ERROR_ACTIONS = ['swingOut'];

var LABELS = {
  player: {
    serveAtt: 'Serve Att',
    serveAvg: 'Serve Avg',
    midPct: 'Serve In %',
    aces: 'ACE',
    acePct: 'Ace%',
    passAtt: 'Pass Att',
    passAvg: 'Pass Avg',
    hint: 'Serve In % = (1 + 2 + 3 + ACE) ÷ Serve Attempts. OUT is a serve attempt but not “in”.'
  },
  coach: {
    serveAtt: 'Opp SR Att',
    serveAvg: 'Opp SR Avg',
    midPct: 'Opp OOS%',
    // Aces columns are hidden in coach view
    aces: 'ACE',
    acePct: 'Ace%',
    passAtt: 'Our SR Att',
    passAvg: 'Our SR Avg',
    hint: 'Opp SR Avg = (3*Opp3 + 2*Opp2 + 1*Opp1 + 0*ACE) ÷ Opp SR Att. Opp OOS% = (Opp1 + ACE) ÷ Opp SR Att.'
  }
};

// Tiny tooltip text aimed at parents/players (Player View only)
var SERVE_IN_TOOLTIP = 'Serve In %: serves kept in play (1/2/3 + ACE) ÷ total serve attempts (includes OUT).';

function byId(id) { return document.getElementById(id); }
function nz(v, d) { return (v === undefined || v === null) ? d : v; }

function cryptoId() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return 'id_' + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function emptyCounters() {
  return {
    serve1: 0, serve2: 0, serve3: 0, ace: 0, serveOut: 0,
    passToTarget: 0, passNearTarget: 0, passAwayTarget: 0, passShank: 0,
    swing: 0, swingOut: 0, kill: 0, tip: 0, tipKill: 0
  };
}

function safePct(n, d) { return d ? (n / d) : 0; }
function fmtPct(x) { return (x * 100).toFixed(1) + '%'; }
function fmtNum(x, digits) {
  digits = nz(digits, 2);
  return Number.isFinite(x) ? x.toFixed(digits) : (0).toFixed(digits);
}

function csv(v) {
  var s = String(v === undefined || v === null ? '' : v);
  if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
    return '"' + s.replaceAll('"', '""') + '"';
  }
  return s;
}

function safeFile(name) {
  return String(name === undefined || name === null ? 'team' : name)
    .replace(/[^\w\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function sortPlayers(a, b) {
  var an = parseInt(a.number, 10);
  var bn = parseInt(b.number, 10);
  var aNum = Number.isFinite(an);
  var bNum = Number.isFinite(bn);
  if (aNum && bNum) return an - bn;
  if (aNum && !bNum) return -1;
  if (!aNum && bNum) return 1;
  return String(a.name || '').localeCompare(String(b.name || ''));
}

function prettyAction(a) {
  var map = {
    serve1: '1', serve2: '2', serve3: '3', ace: 'ACE', serveOut: 'OUT',
    passToTarget: '3', passNearTarget: '2', passAwayTarget: '1', passShank: '0',
    swing: 'Swing', swingOut: 'Error', kill: 'Kill', tip: 'Tip', tipKill: 'Tip+'
  };
  return map[a] || a;
}

function loadUiMode() {
  var v = localStorage.getItem(UI_MODE_KEY);
  return (v === 'coach' || v === 'player') ? v : 'player';
}

function saveUiMode(mode) {
  localStorage.setItem(UI_MODE_KEY, mode);
}

function buildEmptyData(players, matches) {
  var data = {};
  for (var i = 0; i < matches.length; i++) {
    var m = matches[i];
    data[m] = { '1': {}, '2': {}, '3': {} };
    for (var s = 1; s <= 3; s++) {
      var ss = String(s);
      data[m][ss] = {};
      for (var p = 0; p < players.length; p++) {
        data[m][ss][players[p].id] = emptyCounters();
      }
    }
  }
  return data;
}

function newTeam(name) {
  var players = [];
  var matches = DEFAULT_MATCHES.slice();
  return { id: cryptoId(), name: name, matches: matches, players: players, data: buildEmptyData(players, matches), history: [] };
}

// ---------- State ----------
var state = loadState();
normalizeAllTeams(state);
saveState();

function loadState() {
  var raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch (e) { /* ignore */ }
  }
  return { activeTeamId: null, teams: [] };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function activeTeam() {
  if (!state || !state.teams || !state.teams.length) return null;
  for (var i = 0; i < state.teams.length; i++) {
    if (state.teams[i].id === state.activeTeamId) return state.teams[i];
  }
  return state.teams[0];
}

function ensureCounters(team, match, set, playerId) {
  if (!team) return;
  if (!team.data) team.data = {};
  if (!team.data[match]) team.data[match] = { '1': {}, '2': {}, '3': {} };
  if (!team.data[match][set]) team.data[match][set] = {};
  if (!team.data[match][set][playerId]) team.data[match][set][playerId] = emptyCounters();
  if (team.data[match][set][playerId].serveOut === undefined) team.data[match][set][playerId].serveOut = 0;
}

function normalizeTeam(team) {
  if (!team) return;
  if (!team.id) team.id = cryptoId();
  if (!team.name) team.name = 'Team';
  if (!Array.isArray(team.matches) || !team.matches.length) team.matches = DEFAULT_MATCHES.slice();
  if (!Array.isArray(team.players)) team.players = [];
  if (!Array.isArray(team.history)) team.history = [];
  if (!team.data) team.data = {};

  for (var mi = 0; mi < team.matches.length; mi++) {
    var m = team.matches[mi];
    if (!team.data[m]) team.data[m] = { '1': {}, '2': {}, '3': {} };
    for (var s = 1; s <= 3; s++) {
      var ss = String(s);
      if (!team.data[m][ss]) team.data[m][ss] = {};
      for (var pi = 0; pi < team.players.length; pi++) {
        var p = team.players[pi];
        var existing = team.data[m][ss][p.id] || {};
        var merged = Object.assign(emptyCounters(), existing);
        if (merged.serveOut === undefined) merged.serveOut = 0;
        team.data[m][ss][p.id] = merged;
      }
    }
  }
}

function normalizeAllTeams(st) {
  if (!st) st = { activeTeamId: null, teams: [] };
  if (!Array.isArray(st.teams)) st.teams = [];
  for (var i = 0; i < st.teams.length; i++) normalizeTeam(st.teams[i]);
  if (st.teams.length) {
    var ok = false;
    for (var j = 0; j < st.teams.length; j++) if (st.teams[j].id === st.activeTeamId) ok = true;
    if (!st.activeTeamId || !ok) st.activeTeamId = st.teams[0].id;
  } else {
    st.activeTeamId = null;
  }
}

// ---------- App ----------
document.addEventListener('DOMContentLoaded', function () {
  var teamSelect = byId('teamSelect');
  var matchSelect = byId('matchSelect');
  var setSelect = byId('setSelect');
  var viewSelect = byId('viewSelect');
  var statsBody = byId('statsBody');

  if (!teamSelect || !matchSelect || !setSelect || !viewSelect || !statsBody) {
    console.error('[VolleyStat] Required DOM elements missing.');
    return;
  }

  // Controls
  var teamsBtn = byId('teamsBtn');
  var rosterBtn = byId('rosterBtn');
  var undoBtn = byId('undoBtn');
  var exportName = byId('exportName');
  var exportBtn = byId('exportBtn');
  var resetBtn = byId('resetBtn');

  // Onboarding
  var onboarding = byId('onboarding');
  var onboardingTitle = byId('onboardingTitle');
  var onboardingSub = byId('onboardingSub');
  var onboardingTeamsBtn = byId('onboardingTeamsBtn');
  var onboardingRosterBtn = byId('onboardingRosterBtn');

  // Export confirm modal
  var exportConfirmBackdrop = byId('exportConfirmBackdrop');
  var exportConfirmClose = byId('exportConfirmClose');
  var exportConfirmCancel = byId('exportConfirmCancel');
  var exportConfirmOk = byId('exportConfirmOk');
  var exportConfirmFile = byId('exportConfirmFile');
  var exportConfirmTeam = byId('exportConfirmTeam');
  var exportConfirmView = byId('exportConfirmView');
  var exportConfirmScope = byId('exportConfirmScope');

  // Picker modal
  var pickerBackdrop = byId('pickerBackdrop');
  var pickerTitle = byId('pickerTitle');
  var playerGrid = byId('playerGrid');
  var pickerClose = byId('pickerClose');
  var pickerCancel = byId('pickerCancel');

  // Roster modal
  var rosterBackdrop = byId('rosterBackdrop');
  var rosterClose = byId('rosterClose');
  var rosterDone = byId('rosterDone');
  var rosterList = byId('rosterList');
  var playerForm = byId('playerForm');
  var playerIdEl = byId('playerId');
  var playerNameEl = byId('playerName');
  var playerNumberEl = byId('playerNumber');
  var playerPosEl = byId('playerPos');
  var newPlayerBtn = byId('newPlayerBtn');

  // Teams modal
  var teamsBackdrop = byId('teamsBackdrop');
  var teamsClose = byId('teamsClose');
  var teamsDone = byId('teamsDone');
  var teamsList = byId('teamsList');
  var teamForm = byId('teamForm');
  var teamIdEl = byId('teamId');
  var teamNameEl = byId('teamName');
  var newTeamBtn = byId('newTeamBtn');
  var exportTeamBtn = byId('exportTeamBtn');
  var importTeamBtn = byId('importTeamBtn');
  var importTeamInput = byId('importTeamInput');

  // Mode + headers
  var modePlayerBtn = byId('modePlayer');
  var modeCoachBtn = byId('modeCoach');
  var hintText = byId('hintText');
  var thServeAtt = byId('thServeAtt');
  var thServeAvg = byId('thServeAvg');
  var thAces = byId('thAces');
  var thAcePct = byId('thAcePct');
  var thPassAtt = byId('thPassAtt');
  var thPassAvg = byId('thPassAvg');
  var pressureLabel = byId('pressureLabel');
  var thPressure = byId('thPressure');

  // We'll use this to hide the legend/gradient visuals in Player View.
  var pressureLegendBar = null;
  var pressureLegendLabels = null;
  if (thPressure) {
    // In the current HTML, thPressure contains a nested div wrapper with 3 children:
    // 1) label div (#pressureLabel)
    // 2) gradient bar div
    // 3) labels row div (Easy/Pressure)
    try {
      var wrap = thPressure.querySelector('div');
      if (wrap && wrap.children && wrap.children.length >= 3) {
        pressureLegendBar = wrap.children[1];
        pressureLegendLabels = wrap.children[2];
      }
    } catch (e) { /* ignore */ }
  }

  var uiMode = loadUiMode();

  function applyModeToUI() {
    var L = LABELS[uiMode] || LABELS.player;

    // Column titles
    if (thServeAtt) thServeAtt.textContent = L.serveAtt;
    if (thServeAvg) thServeAvg.textContent = L.serveAvg;

    // Middle percent column label
    if (pressureLabel) {
      pressureLabel.textContent = L.midPct;
      if (uiMode === 'player') {
        pressureLabel.title = SERVE_IN_TOOLTIP;
      } else {
        pressureLabel.title = '';
      }
    }

    // Hide ACE/Ace% columns in Coach View
    if (thAces) thAces.style.display = (uiMode === 'coach') ? 'none' : '';
    if (thAcePct) thAcePct.style.display = (uiMode === 'coach') ? 'none' : '';

    if (thPassAtt) thPassAtt.textContent = L.passAtt;
    if (thPassAvg) thPassAvg.textContent = L.passAvg;
    if (hintText) hintText.textContent = L.hint;

    // Hide heatmap legend visuals in Player View
    if (pressureLegendBar) pressureLegendBar.style.display = (uiMode === 'player') ? 'none' : '';
    if (pressureLegendLabels) pressureLegendLabels.style.display = (uiMode === 'player') ? 'none' : '';

    // Toggle button states
    if (modePlayerBtn) modePlayerBtn.setAttribute('aria-pressed', uiMode === 'player' ? 'true' : 'false');
    if (modeCoachBtn) modeCoachBtn.setAttribute('aria-pressed', uiMode === 'coach' ? 'true' : 'false');
  }

  function setUiMode(next) {
    uiMode = (next === 'coach') ? 'coach' : 'player';
    saveUiMode(uiMode);
    applyModeToUI();
    syncExportNameDefault();
    renderTable();
  }

  if (modePlayerBtn) modePlayerBtn.addEventListener('click', function(){ setUiMode('player'); });
  if (modeCoachBtn) modeCoachBtn.addEventListener('click', function(){ setUiMode('coach'); });

  function setDisabled(el, disabled) { if (el) el.disabled = !!disabled; }

  function setToolbarStatsEnabled(enabled) {
    var btns = document.querySelectorAll('.toolbar button[data-action]');
    for (var i = 0; i < btns.length; i++) btns[i].disabled = !enabled;
  }

  function getViewLabel() {
    var v = viewSelect.value;
    if (v === 'set') return 'Current Set';
    if (v === 'match') return 'Current Match';
    return 'Tournament Total';
  }

  function getExportContextLabel() {
    var view = viewSelect.value;
    var match = matchSelect.value || 'Match 1';
    var set = setSelect.value || '1';
    if (view === 'set') return match + ' Set ' + set;
    if (view === 'match') return match;
    return 'Tournament';
  }

  function modeLabelForFile() { return uiMode === 'coach' ? 'CoachView' : 'PlayerView'; }

  function defaultExportBaseName() {
    var t = activeTeam();
    var teamName = t && t.name ? t.name : 'team';
    return safeFile(teamName) + '_' + safeFile(getExportContextLabel()) + '_' + modeLabelForFile();
  }

  function syncExportNameDefault() {
    if (!exportName) return;
    if (!exportName.dataset.userEdited) exportName.value = defaultExportBaseName();
  }

  function updateOnboardingAndControls() {
    var team = activeTeam();
    var hasTeam = !!team;
    var hasRoster = !!(team && team.players && team.players.length);

    if (onboarding) {
      if (!hasTeam) {
        onboarding.classList.remove('hidden');
        if (onboardingTitle) onboardingTitle.textContent = 'Step 1: Add a Team';
        if (onboardingSub) onboardingSub.textContent = 'You don’t have any teams yet. Add a team to begin.';
        if (onboardingRosterBtn) onboardingRosterBtn.style.display = 'none';
      } else if (!hasRoster) {
        onboarding.classList.remove('hidden');
        if (onboardingTitle) onboardingTitle.textContent = 'Step 2: Add Your Roster';
        if (onboardingSub) onboardingSub.textContent = 'Your team is saved. Now add players to your roster.';
        if (onboardingRosterBtn) onboardingRosterBtn.style.display = 'inline-flex';
      } else {
        onboarding.classList.add('hidden');
        if (onboardingRosterBtn) onboardingRosterBtn.style.display = 'inline-flex';
      }
    }

    setDisabled(teamSelect, !hasTeam);
    setDisabled(matchSelect, !hasTeam);
    setDisabled(setSelect, !hasTeam);
    setDisabled(viewSelect, !hasTeam);
    setDisabled(rosterBtn, !hasTeam);

    setDisabled(undoBtn, !hasRoster);
    setDisabled(exportBtn, !hasRoster);
    setDisabled(exportName, !hasTeam);

    setToolbarStatsEnabled(hasRoster);
    if (hasTeam) syncExportNameDefault();
  }

  // ----- Export confirm modal -----
  var _exportConfirmResolve = null;
  var _exportConfirmLastFocus = null;

  function isExportConfirmOpen() {
    return exportConfirmBackdrop && !exportConfirmBackdrop.classList.contains('hidden');
  }

  function openExportConfirmModal(opts) {
    return new Promise(function(resolve){
      if (!exportConfirmBackdrop) return resolve(true);
      _exportConfirmLastFocus = document.activeElement;
      _exportConfirmResolve = resolve;
      if (exportConfirmFile) exportConfirmFile.textContent = opts.filename;
      if (exportConfirmTeam) exportConfirmTeam.textContent = opts.teamName;
      if (exportConfirmView) exportConfirmView.textContent = opts.viewLabel;
      if (exportConfirmScope) exportConfirmScope.textContent = opts.scopeLabel;
      exportConfirmBackdrop.classList.remove('hidden');
      setTimeout(function(){ if (exportConfirmOk) exportConfirmOk.focus(); }, 0);
    });
  }

  function closeExportConfirmModal(result) {
    if (!exportConfirmBackdrop) return;
    exportConfirmBackdrop.classList.add('hidden');
    var resolver = _exportConfirmResolve;
    _exportConfirmResolve = null;
    try { if (_exportConfirmLastFocus && _exportConfirmLastFocus.focus) _exportConfirmLastFocus.focus(); } catch (e) {}
    _exportConfirmLastFocus = null;
    if (resolver) resolver(!!result);
  }

  if (exportConfirmOk) exportConfirmOk.addEventListener('click', function(){ closeExportConfirmModal(true); });
  if (exportConfirmCancel) exportConfirmCancel.addEventListener('click', function(){ closeExportConfirmModal(false); });
  if (exportConfirmClose) exportConfirmClose.addEventListener('click', function(){ closeExportConfirmModal(false); });
  if (exportConfirmBackdrop) exportConfirmBackdrop.addEventListener('click', function(e){ if (e.target === exportConfirmBackdrop) closeExportConfirmModal(false); });
  document.addEventListener('keydown', function(e){ if (isExportConfirmOpen() && e.key === 'Escape') { e.preventDefault(); closeExportConfirmModal(false); } });

  // ----- Select init -----
  function initTeamSelect() {
    teamSelect.innerHTML = '';
    if (!state.teams.length) {
      var opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No teams yet';
      opt.disabled = true;
      opt.selected = true;
      teamSelect.appendChild(opt);
      return;
    }
    for (var i = 0; i < state.teams.length; i++) {
      var t = state.teams[i];
      var o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.name;
      teamSelect.appendChild(o);
    }
    var active = activeTeam();
    teamSelect.value = active ? active.id : state.teams[0].id;
  }

  function initMatchSelect() {
    matchSelect.innerHTML = '';
    var team = activeTeam();
    if (!team) {
      var opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '—';
      opt.disabled = true;
      opt.selected = true;
      matchSelect.appendChild(opt);
      return;
    }
    for (var i = 0; i < team.matches.length; i++) {
      var m = team.matches[i];
      var o = document.createElement('option');
      o.value = m;
      o.textContent = m;
      matchSelect.appendChild(o);
    }
    matchSelect.value = team.matches[0] || 'Match 1';
  }

  // ----- Middle column heatmap (coach only) -----
  function pressureHeatStyle(pct) {
    var v = Number.isFinite(pct) ? pct : 0;
    var t = Math.max(0, Math.min(1, v));
    var hue = 120 * (1 - t);
    var sat = 75;
    var light = 92 - 37 * t;
    var bg = 'hsl(' + Math.round(hue) + ' ' + sat + '% ' + Math.round(light) + '%)';
    return { bg: bg, fg: '#111827' };
  }

  function getAggregateCounters(playerId) {
    var team = activeTeam();
    if (!team) return emptyCounters();

    var view = viewSelect.value || 'tournament';
    var match = matchSelect.value || (team.matches[0] || 'Match 1');
    var set = setSelect.value || '1';

    var agg = emptyCounters();

    function addFrom(matchName, setNum) {
      var c = (((team.data || {})[matchName] || {})[setNum] || {})[playerId];
      if (!c) return;
      var merged = Object.assign(emptyCounters(), c);
      for (var k in agg) {
        if (Object.prototype.hasOwnProperty.call(agg, k)) agg[k] += nz(merged[k], 0);
      }
    }

    if (view === 'set') addFrom(match, set);
    else if (view === 'match') { addFrom(match,'1'); addFrom(match,'2'); addFrom(match,'3'); }
    else {
      for (var mi = 0; mi < team.matches.length; mi++) {
        var mn = team.matches[mi];
        addFrom(mn,'1'); addFrom(mn,'2'); addFrom(mn,'3');
      }
    }

    return agg;
  }

  function derived(playerId) {
    var c = getAggregateCounters(playerId);

    // Serve buckets
    var s1 = nz(c.serve1, 0);
    var s2 = nz(c.serve2, 0);
    var s3 = nz(c.serve3, 0);
    var ace = nz(c.ace, 0);
    var out = nz(c.serveOut, 0);

    // Player: attempts include OUT
    var serveIn = s1 + s2 + s3 + ace;
    var serveAttPlayer = serveIn + out;

    // Coach: opponent reception attempts exclude OUT
    var oppRecAtt = serveIn;

    // Player Serve Avg: weighted by our serve scale, OUT contributes 0 points (in denominator)
    var servePtsPlayer = (s1 * SERVE_WEIGHTS.serve1) + (s2 * SERVE_WEIGHTS.serve2) + (s3 * SERVE_WEIGHTS.serve3) + (ace * SERVE_WEIGHTS.ace);
    var serveAvgPlayer = serveAttPlayer ? (servePtsPlayer / serveAttPlayer) : 0;

    // Coach Opp SR Avg: inverse mapping to opponent pass scale (3/2/1/0)
    // serve1 => opp pass 3, serve2 => opp pass 2, serve3 => opp pass 1, ace => opp pass 0
    var oppPts = (s1 * 3) + (s2 * 2) + (s3 * 1) + (ace * 0);
    var oppSrAvg = oppRecAtt ? (oppPts / oppRecAtt) : 0;

    // Player Serve In %
    var serveInPct = safePct(serveIn, serveAttPlayer);

    // Coach Opp OOS% = (opp 1 + opp 0) / oppRecAtt = (serve3 + ace) / oppRecAtt
    var oppOosPct = safePct((s3 + ace), oppRecAtt);

    // Passing
    var passAtt = nz(c.passToTarget,0) + nz(c.passNearTarget,0) + nz(c.passAwayTarget,0) + nz(c.passShank,0);
    var passPts = nz(c.passToTarget,0)*PASS_WEIGHTS.passToTarget + nz(c.passNearTarget,0)*PASS_WEIGHTS.passNearTarget + nz(c.passAwayTarget,0)*PASS_WEIGHTS.passAwayTarget + nz(c.passShank,0)*PASS_WEIGHTS.passShank;
    var passAvg = passAtt ? (passPts / passAtt) : 0;

    // Hitting
    var hitAtt = 0;
    for (var i = 0; i < HIT_ATTEMPT_ACTIONS.length; i++) hitAtt += nz(c[HIT_ATTEMPT_ACTIONS[i]],0);
    var kills = nz(c.kill,0) + nz(c.tipKill,0);
    var errs = 0;
    for (var j = 0; j < HIT_ERROR_ACTIONS.length; j++) errs += nz(c[HIT_ERROR_ACTIONS[j]],0);
    var hitAvg = hitAtt ? ((kills - errs) / hitAtt) : 0;
    var killPct = safePct(kills, hitAtt);

    // Player ACE% uses player serve attempts
    var acePctPlayer = safePct(ace, serveAttPlayer);

    return {
      serveAttPlayer: serveAttPlayer,
      serveAvgPlayer: serveAvgPlayer,
      serveInPct: serveInPct,
      aceCount: ace,
      acePctPlayer: acePctPlayer,

      oppRecAtt: oppRecAtt,
      oppSrAvg: oppSrAvg,
      oppOosPct: oppOosPct,

      passAtt: passAtt,
      passAvg: passAvg,
      hitAtt: hitAtt,
      hitAvg: hitAvg,
      kills: kills,
      killPct: killPct
    };
  }

  function td(text, cls) {
    var el = document.createElement('td');
    el.textContent = text;
    if (cls) el.className = cls;
    return el;
  }

  function renderTable() {
    statsBody.innerHTML = '';
    var team = activeTeam();
    if (!team) return;

    var players = (team.players || []).slice().sort(sortPlayers);
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      var d = derived(p.id);
      var tr = document.createElement('tr');

      tr.appendChild(td(p.number || '—', 'left sticky-col'));
      tr.appendChild(td(p.name || '', 'left'));
      tr.appendChild(td(p.position || '—', 'left'));

      // Serve att + avg depend on mode
      if (uiMode === 'coach') {
        tr.appendChild(td(String(d.oppRecAtt)));
        tr.appendChild(td(fmtNum(d.oppSrAvg, 2)));
      } else {
        tr.appendChild(td(String(d.serveAttPlayer)));
        tr.appendChild(td(fmtNum(d.serveAvgPlayer, 2)));
      }

      // Middle % column
      var midPct = (uiMode === 'coach') ? d.oppOosPct : d.serveInPct;
      var pctCell = td(fmtPct(midPct));

      // Heatmap only for coach view
      if (uiMode === 'coach') {
        var heat = pressureHeatStyle(midPct);
        pctCell.style.background = heat.bg;
        pctCell.style.color = heat.fg;
        pctCell.style.fontWeight = '900';
      } else {
        pctCell.style.background = '';
        pctCell.style.color = '';
        pctCell.style.fontWeight = '700';
      }

      tr.appendChild(pctCell);

      // ACE columns shown only in player view
      if (uiMode !== 'coach') {
        tr.appendChild(td(String(d.aceCount)));
        tr.appendChild(td(fmtPct(d.acePctPlayer)));
      }

      tr.appendChild(td(String(d.passAtt)));
      tr.appendChild(td(fmtNum(d.passAvg, 2)));
      tr.appendChild(td(String(d.hitAtt)));
      tr.appendChild(td(fmtNum(d.hitAvg, 3)));
      tr.appendChild(td(String(d.kills)));
      tr.appendChild(td(fmtPct(d.killPct)));

      statsBody.appendChild(tr);
    }
  }

  // ----- Event recording -----
  var pendingAction = null;

  function recordEvent(action, playerId) {
    var team = activeTeam();
    if (!team) return;

    var match = matchSelect.value || (team.matches[0] || 'Match 1');
    var set = setSelect.value || '1';

    ensureCounters(team, match, set, playerId);
    var counters = team.data[match][set][playerId];

    if (counters[action] === undefined) {
      // Merge defaults for legacy objects so new actions become valid
      Object.assign(counters, Object.assign(emptyCounters(), counters));
    }

    if (counters[action] === undefined) {
      alert('Unknown action. Try reloading the page.');
      return;
    }

    counters[action] = nz(counters[action], 0) + 1;
    team.history.push({ match: match, set: set, playerId: playerId, action: action, ts: Date.now() });

    saveState();
    closePicker();
    renderTable();
    updateOnboardingAndControls();
  }

  function openPicker() {
    if (!pickerBackdrop || !playerGrid) return;
    buildPlayerGrid();
    pickerBackdrop.classList.remove('hidden');
  }

  function closePicker() {
    if (pickerBackdrop) pickerBackdrop.classList.add('hidden');
    pendingAction = null;
  }

  function buildPlayerGrid() {
    if (!playerGrid) return;
    var team = activeTeam();
    playerGrid.innerHTML = '';
    var players = (team && team.players ? team.players.slice() : []).sort(sortPlayers);
    for (var i = 0; i < players.length; i++) {
      (function(p){
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'player-btn';

        var top = (p.number ? '#' + p.number + ' ' : '') + (p.name || '');
        btn.appendChild(document.createTextNode(top));

        var sub = document.createElement('span');
        sub.className = 'player-sub';
        sub.textContent = p.position ? ('Pos: ' + p.position) : 'Pos: —';
        btn.appendChild(sub);

        btn.addEventListener('click', function(){ recordEvent(pendingAction, p.id); });
        playerGrid.appendChild(btn);
      })(players[i]);
    }
  }

  if (pickerClose) pickerClose.addEventListener('click', closePicker);
  if (pickerCancel) pickerCancel.addEventListener('click', closePicker);
  if (pickerBackdrop) pickerBackdrop.addEventListener('click', function(e){ if (e.target === pickerBackdrop) closePicker(); });

  // ----- Roster modal -----
  function clearRosterForm() {
    if (!playerIdEl || !playerNameEl || !playerNumberEl || !playerPosEl) return;
    playerIdEl.value = '';
    playerNameEl.value = '';
    playerNumberEl.value = '';
    playerPosEl.value = '';
    playerNameEl.focus();
  }

  function renderRosterList() {
    if (!rosterList) return;
    var team = activeTeam();
    rosterList.innerHTML = '';
    var players = (team && team.players ? team.players.slice() : []).sort(sortPlayers);
    for (var i = 0; i < players.length; i++) {
      (function(p){
        var item = document.createElement('div');
        item.className = 'roster-item';

        var meta = document.createElement('div');
        meta.className = 'meta';

        var top = document.createElement('div');
        top.className = 'top';
        top.textContent = (p.number ? '#' + p.number + ' ' : '') + p.name;

        var bottom = document.createElement('div');
        bottom.className = 'bottom';
        bottom.textContent = 'Pos: ' + (p.position || '—');

        meta.appendChild(top);
        meta.appendChild(bottom);

        var actions = document.createElement('div');
        actions.className = 'actions';

        var editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'btn secondary';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', function(){
          if (!playerIdEl || !playerNameEl || !playerNumberEl || !playerPosEl) return;
          playerIdEl.value = p.id;
          playerNameEl.value = p.name;
          playerNumberEl.value = p.number || '';
          playerPosEl.value = p.position || '';
          playerNameEl.focus();
        });

        var delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn danger';
        delBtn.textContent = 'Remove';
        delBtn.addEventListener('click', function(){ removePlayer(p.id); });

        actions.appendChild(editBtn);
        actions.appendChild(delBtn);

        item.appendChild(meta);
        item.appendChild(actions);
        rosterList.appendChild(item);
      })(players[i]);
    }
  }

  function openRoster() {
    if (!rosterBackdrop || !rosterList || !playerForm || !playerNameEl) return;
    var team = activeTeam();
    if (!team) return;
    clearRosterForm();
    renderRosterList();
    rosterBackdrop.classList.remove('hidden');
  }

  function closeRoster() {
    if (rosterBackdrop) rosterBackdrop.classList.add('hidden');
    renderTable();
    updateOnboardingAndControls();
  }

  function removePlayer(playerId) {
    var team = activeTeam();
    if (!team) return;
    var p = null;
    for (var i = 0; i < team.players.length; i++) if (team.players[i].id === playerId) p = team.players[i];
    if (!p) return;
    if (!confirm('Remove ' + p.name + ' from ' + team.name + '? This also removes their saved stats.')) return;

    team.players = team.players.filter(function(x){ return x.id !== playerId; });
    for (var mi = 0; mi < team.matches.length; mi++) {
      var m = team.matches[mi];
      for (var s = 1; s <= 3; s++) {
        var ss = String(s);
        if (team.data && team.data[m] && team.data[m][ss]) delete team.data[m][ss][playerId];
      }
    }
    team.history = team.history.filter(function(h){ return h.playerId !== playerId; });

    normalizeTeam(team);
    saveState();
    renderRosterList();
    renderTable();
    updateOnboardingAndControls();
  }

  if (rosterBtn) rosterBtn.addEventListener('click', openRoster);
  if (rosterClose) rosterClose.addEventListener('click', closeRoster);
  if (rosterDone) rosterDone.addEventListener('click', closeRoster);
  if (rosterBackdrop) rosterBackdrop.addEventListener('click', function(e){ if (e.target === rosterBackdrop) closeRoster(); });
  if (newPlayerBtn) newPlayerBtn.addEventListener('click', clearRosterForm);

  if (playerForm) playerForm.addEventListener('submit', function(e){
    e.preventDefault();
    var team = activeTeam();
    if (!team || !playerNameEl) return;

    var id = (playerIdEl && playerIdEl.value) ? playerIdEl.value : cryptoId();
    var name = String(playerNameEl.value || '').trim();
    var number = String((playerNumberEl && playerNumberEl.value) ? playerNumberEl.value : '').trim();
    var position = String((playerPosEl && playerPosEl.value) ? playerPosEl.value : '').trim();
    if (!name) return;

    var idx = -1;
    for (var i = 0; i < team.players.length; i++) if (team.players[i].id === id) idx = i;
    var player = { id: id, name: name, number: number, position: position };
    if (idx >= 0) team.players[idx] = player; else team.players.push(player);

    for (var mi = 0; mi < team.matches.length; mi++) {
      var m = team.matches[mi];
      ensureCounters(team, m, '1', id);
      ensureCounters(team, m, '2', id);
      ensureCounters(team, m, '3', id);
    }

    normalizeTeam(team);
    saveState();
    clearRosterForm();
    renderRosterList();
    renderTable();
    updateOnboardingAndControls();
  });

  // ----- Teams modal -----
  function clearTeamForm() {
    if (!teamIdEl || !teamNameEl) return;
    teamIdEl.value = '';
    teamNameEl.value = '';
    teamNameEl.focus();
  }

  function renderTeamsList() {
    if (!teamsList) return;
    teamsList.innerHTML = '';

    if (!state.teams.length) {
      var empty = document.createElement('div');
      empty.className = 'hint';
      empty.textContent = 'No teams yet. Use the form above to create your first team.';
      teamsList.appendChild(empty);
      return;
    }

    var teams = state.teams.slice().sort(function(a,b){ return String(a.name||'').localeCompare(String(b.name||'')); });
    for (var i = 0; i < teams.length; i++) {
      (function(t){
        var item = document.createElement('div');
        item.className = 'roster-item';

        var meta = document.createElement('div');
        meta.className = 'meta';

        var top = document.createElement('div');
        top.className = 'top';
        top.textContent = t.name;

        var bottom = document.createElement('div');
        bottom.className = 'bottom';
        bottom.textContent = (t.players ? t.players.length : 0) + ' players';

        meta.appendChild(top);
        meta.appendChild(bottom);

        var actions = document.createElement('div');
        actions.className = 'actions';

        var useBtn = document.createElement('button');
        useBtn.type = 'button';
        useBtn.className = 'btn secondary';
        useBtn.textContent = 'Use';
        useBtn.addEventListener('click', function(){
          state.activeTeamId = t.id;
          saveState();
          initTeamSelect();
          initMatchSelect();
          renderTable();
          if (exportName) exportName.dataset.userEdited = '';
          updateOnboardingAndControls();
        });

        var editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'btn secondary';
        editBtn.textContent = 'Rename';
        editBtn.addEventListener('click', function(){
          if (!teamIdEl || !teamNameEl) return;
          teamIdEl.value = t.id;
          teamNameEl.value = t.name;
          teamNameEl.focus();
        });

        var delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn danger';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', function(){ deleteTeam(t.id); });

        actions.appendChild(useBtn);
        actions.appendChild(editBtn);
        actions.appendChild(delBtn);

        item.appendChild(meta);
        item.appendChild(actions);
        teamsList.appendChild(item);
      })(teams[i]);
    }
  }

  function openTeams() {
    if (!teamsBackdrop || !teamsList || !teamForm || !teamNameEl) return;
    clearTeamForm();
    renderTeamsList();
    teamsBackdrop.classList.remove('hidden');
  }

  function closeTeams() {
    if (teamsBackdrop) teamsBackdrop.classList.add('hidden');
    initTeamSelect();
    initMatchSelect();
    renderTable();
    if (exportName) exportName.dataset.userEdited = '';
    updateOnboardingAndControls();
  }

  function deleteTeam(teamId) {
    var t = null;
    for (var i = 0; i < state.teams.length; i++) if (state.teams[i].id === teamId) t = state.teams[i];
    if (!t) return;
    if (!confirm('Delete team "' + t.name + '"? This removes roster + stats from this device.')) return;

    state.teams = state.teams.filter(function(x){ return x.id !== teamId; });
    normalizeAllTeams(state);
    saveState();
    initTeamSelect();
    initMatchSelect();
    renderTeamsList();
    renderTable();
    if (exportName) exportName.dataset.userEdited = '';
    updateOnboardingAndControls();
  }

  if (teamsBtn) teamsBtn.addEventListener('click', openTeams);
  if (teamsClose) teamsClose.addEventListener('click', closeTeams);
  if (teamsDone) teamsDone.addEventListener('click', closeTeams);
  if (teamsBackdrop) teamsBackdrop.addEventListener('click', function(e){ if (e.target === teamsBackdrop) closeTeams(); });
  if (newTeamBtn) newTeamBtn.addEventListener('click', clearTeamForm);

  if (teamForm) teamForm.addEventListener('submit', function(e){
    e.preventDefault();
    var id = (teamIdEl && teamIdEl.value) ? teamIdEl.value : cryptoId();
    var name = String((teamNameEl && teamNameEl.value) ? teamNameEl.value : '').trim();
    if (!name) return;

    var idx = -1;
    for (var i = 0; i < state.teams.length; i++) if (state.teams[i].id === id) idx = i;

    if (idx >= 0) state.teams[idx].name = name;
    else {
      var nt = newTeam(name);
      nt.id = id;
      state.teams.push(nt);
      state.activeTeamId = nt.id;
    }

    normalizeAllTeams(state);
    saveState();
    clearTeamForm();
    renderTeamsList();
    initTeamSelect();
    initMatchSelect();
    renderTable();
    updateOnboardingAndControls();
  });

  // Export/Import team
  if (exportTeamBtn) exportTeamBtn.addEventListener('click', function(){
    var team = activeTeam();
    if (!team) return;
    var payload = JSON.stringify(team, null, 2);
    var blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = safeFile(team.name) + '.team.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  if (importTeamBtn) importTeamBtn.addEventListener('click', function(){ if (importTeamInput) importTeamInput.click(); });

  if (importTeamInput) importTeamInput.addEventListener('change', function(e){
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    file.text().then(function(text){
      var team = JSON.parse(text);
      if (!team || !team.name || !Array.isArray(team.matches)) {
        alert('That file doesn’t look like a valid team export.');
        return;
      }
      team.id = cryptoId();
      if (!Array.isArray(team.players)) team.players = [];
      if (!team.data) team.data = buildEmptyData(team.players, team.matches);
      if (!Array.isArray(team.history)) team.history = [];
      normalizeTeam(team);
      state.teams.push(team);
      state.activeTeamId = team.id;
      normalizeAllTeams(state);
      saveState();
      initTeamSelect();
      initMatchSelect();
      renderTeamsList();
      renderTable();
      if (exportName) exportName.dataset.userEdited = '';
      updateOnboardingAndControls();
      alert('Imported team: ' + team.name);
    }).catch(function(err){
      console.error(err);
      alert('Import failed. Make sure it\'s a .team.json export from this app.');
    }).finally(function(){
      importTeamInput.value = '';
    });
  });

  // Toolbar click binding
  var toolbarBtns = document.querySelectorAll('.toolbar button[data-action]');
  for (var i = 0; i < toolbarBtns.length; i++) {
    toolbarBtns[i].addEventListener('click', function(){
      if (this.disabled) return;
      pendingAction = this.getAttribute('data-action');
      if (pickerTitle) pickerTitle.textContent = 'Select Player — ' + prettyAction(pendingAction);
      openPicker();
    });
  }

  // Selector events
  matchSelect.addEventListener('change', function(){ renderTable(); syncExportNameDefault(); });
  setSelect.addEventListener('change', function(){ renderTable(); syncExportNameDefault(); });
  viewSelect.addEventListener('change', function(){ renderTable(); syncExportNameDefault(); });

  teamSelect.addEventListener('change', function(){
    state.activeTeamId = teamSelect.value;
    saveState();
    initMatchSelect();
    renderTable();
    if (exportName) exportName.dataset.userEdited = '';
    updateOnboardingAndControls();
  });

  if (onboardingTeamsBtn) onboardingTeamsBtn.addEventListener('click', openTeams);
  if (onboardingRosterBtn) onboardingRosterBtn.addEventListener('click', openRoster);

  if (exportName) exportName.addEventListener('input', function(){
    exportName.dataset.userEdited = exportName.value.trim() ? '1' : '';
    if (!exportName.dataset.userEdited) syncExportNameDefault();
  });

  if (undoBtn) undoBtn.addEventListener('click', function(){
    var team = activeTeam();
    if (!team) return;
    var last = team.history.pop();
    if (!last) return;
    var c = (((team.data || {})[last.match] || {})[last.set] || {})[last.playerId];
    if (c && nz(c[last.action],0) > 0) c[last.action] -= 1;
    saveState();
    renderTable();
    updateOnboardingAndControls();
  });

  if (exportBtn) exportBtn.addEventListener('click', function(){
    var team = activeTeam();
    if (!team || !team.players || !team.players.length) return;

    // Mode-specific CSV headers
    // Coach view: remove Opp SR 0 columns
    var header = (uiMode === 'coach')
      ? ['Team','Jersey','Player','Pos','Opp_SR_Att','Opp_SR_Avg','Opp_OOS%','Our_SR_Att','Our_SR_Avg','HitAtt','HitAvg','Kills','Kill%']
      : ['Team','Jersey','Player','Pos','ServeAtt','ServeAvg','ServeIn%','ACE','Ace%','PassAtt','PassAvg','HitAtt','HitAvg','Kills','Kill%'];

    var rows = [header.join(',')];
    var players = team.players.slice().sort(function(a,b){ return String(a.name||'').localeCompare(String(b.name||'')); });
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      var d = derived(p.id);

      if (uiMode === 'coach') {
        rows.push([
          csv(team.name),
          csv(p.number || ''),
          csv(p.name),
          csv(p.position || ''),
          d.oppRecAtt,
          d.oppSrAvg.toFixed(2),
          (d.oppOosPct * 100).toFixed(1),
          d.passAtt,
          d.passAvg.toFixed(2),
          d.hitAtt,
          d.hitAvg.toFixed(3),
          d.kills,
          (d.killPct * 100).toFixed(1)
        ].join(','));
      } else {
        rows.push([
          csv(team.name),
          csv(p.number || ''),
          csv(p.name),
          csv(p.position || ''),
          d.serveAttPlayer,
          d.serveAvgPlayer.toFixed(2),
          (d.serveInPct * 100).toFixed(1),
          d.aceCount,
          (d.acePctPlayer * 100).toFixed(1),
          d.passAtt,
          d.passAvg.toFixed(2),
          d.hitAtt,
          d.hitAvg.toFixed(3),
          d.kills,
          (d.killPct * 100).toFixed(1)
        ].join(','));
      }
    }

    var base = safeFile((exportName && exportName.value ? exportName.value.trim() : '') || defaultExportBaseName());
    var filename = base + '.csv';

    openExportConfirmModal({
      filename: filename,
      teamName: team.name,
      viewLabel: getViewLabel(),
      scopeLabel: getExportContextLabel()
    }).then(function(ok){
      if (!ok) return;
      var blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    });
  });

  if (resetBtn) resetBtn.addEventListener('click', function(){
    if (!confirm('Reset ALL teams + stats on this device? This cannot be undone.')) return;
    localStorage.removeItem(STORAGE_KEY);
    state = loadState();
    normalizeAllTeams(state);
    saveState();
    initTeamSelect();
    initMatchSelect();
    renderTable();
    if (exportName) exportName.dataset.userEdited = '';
    updateOnboardingAndControls();
  });

  // Initial paint
  initTeamSelect();
  initMatchSelect();
  applyModeToUI();
  renderTable();
  updateOnboardingAndControls();
});
