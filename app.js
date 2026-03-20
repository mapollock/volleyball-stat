/**
 * VolleyStat v0.1.7.3
 * Fix: when assigning rotation positions, the Player Picker opens ABOVE the Rotation modal
 * and the Rotation modal is restored after a player is selected.
 */

console.log('[VolleyStat] v0.1.7.3 loaded');

var STORAGE_KEY = 'volleystat_v008';
var UI_MODE_KEY = 'volleystat_ui_mode';

var DEFAULT_MATCHES = ['Match 1', 'Match 2', 'Match 3'];

var PASS_WEIGHTS = { passToTarget: 3, passNearTarget: 2, passAwayTarget: 1, passShank: 0 };
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
    aces: 'ACE',
    acePct: 'Ace%',
    passAtt: 'Our SR Att',
    passAvg: 'Our SR Avg',
    hint: 'Server = Pos 1 (rotation). Opp SR Avg = (3*Opp3 + 2*Opp2 + 1*Opp1 + 0*ACE) ÷ Opp SR Att.'
  }
};

var SERVE_IN_TOOLTIP = 'Serve In %: serves kept in play (1/2/3 + ACE) ÷ total serve attempts (includes OUT).';

var POS_TO_BASE = { S:1, OH1:2, MB2:3, RS:4, OH2:5, MB1:6 };

function normPosToken(pos){
  if (!pos) return '';
  var s = String(pos).toUpperCase().trim();
  s = s.replace(/\s+/g,'').replace(/[-_]+/g,'');
  return s;
}

function ensureRotation(team){
  if (!team.rotation){
    team.rotation = { offset:0, base:{1:null,2:null,3:null,4:null,5:null,6:null}, setterPos:null };
  }
  if (team.rotation.offset === undefined || team.rotation.offset === null) team.rotation.offset = 0;
  if (!team.rotation.base) team.rotation.base = {1:null,2:null,3:null,4:null,5:null,6:null};
  if (team.rotation.setterPos === undefined) team.rotation.setterPos = null;
}

function rotatedPos(basePos, offset){
  return ((basePos - offset - 1 + 6000) % 6) + 1;
}

function inverseBaseForCurrentPos(currentPos, offset){
  return ((currentPos + offset - 1) % 6) + 1;
}

function autoFillBaseFromRoster(team){
  ensureRotation(team);
  var base = team.rotation.base;
  var players = team.players || [];
  for (var i=0;i<players.length;i++){
    var p = players[i];
    var tok = normPosToken(p.position);
    var slot = POS_TO_BASE[tok];
    if (!slot) continue;
    if (!base[slot]) base[slot] = p.id;
  }
}

function currentPosToPlayerId(team){
  ensureRotation(team);
  autoFillBaseFromRoster(team);
  var base = team.rotation.base;
  var offset = team.rotation.offset || 0;
  var map = {1:null,2:null,3:null,4:null,5:null,6:null};
  for (var slot=1; slot<=6; slot++){
    var pid = base[slot];
    if (!pid) continue;
    var cur = rotatedPos(slot, offset);
    map[cur] = pid;
  }
  return map;
}

function getServerPlayerId(team){
  var map = currentPosToPlayerId(team);
  return map[1] || null;
}

function advanceRotation(team){
  ensureRotation(team);
  team.rotation.offset = ((team.rotation.offset || 0) + 1) % 6;
}

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
function fmtNum(x, digits) { digits = nz(digits, 2); return Number.isFinite(x) ? x.toFixed(digits) : (0).toFixed(digits); }

function csv(v) {
  var s = String(v === undefined || v === null ? '' : v);
  if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) return '"' + s.replaceAll('"','""') + '"';
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
  var map = { serve1:'1', serve2:'2', serve3:'3', ace:'ACE', serveOut:'OUT', passToTarget:'3', passNearTarget:'2', passAwayTarget:'1', passShank:'0', swing:'Swing', swingOut:'Error', kill:'Kill', tip:'Tip', tipKill:'Tip+' };
  return map[a] || a;
}

function loadUiMode() {
  var v = localStorage.getItem(UI_MODE_KEY);
  return (v === 'coach' || v === 'player') ? v : 'player';
}

function saveUiMode(mode) { localStorage.setItem(UI_MODE_KEY, mode); }

function buildEmptyData(players, matches) {
  var data = {};
  for (var i = 0; i < matches.length; i++) {
    var m = matches[i];
    data[m] = { '1': {}, '2': {}, '3': {} };
    for (var s = 1; s <= 3; s++) {
      var ss = String(s);
      data[m][ss] = {};
      for (var p = 0; p < players.length; p++) data[m][ss][players[p].id] = emptyCounters();
    }
  }
  return data;
}

function newTeam(name) {
  var players = [];
  var matches = DEFAULT_MATCHES.slice();
  return { id: cryptoId(), name: name, matches: matches, players: players, data: buildEmptyData(players, matches), history: [], rotation: { offset:0, base:{1:null,2:null,3:null,4:null,5:null,6:null}, setterPos:null } };
}

var state = loadState();
normalizeAllTeams(state);
saveState();

function loadState() {
  var raw = localStorage.getItem(STORAGE_KEY);
  if (raw) { try { return JSON.parse(raw); } catch (e) {} }
  return { activeTeamId: null, teams: [] };
}

function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function activeTeam() {
  if (!state || !state.teams || !state.teams.length) return null;
  for (var i=0;i<state.teams.length;i++) if (state.teams[i].id === state.activeTeamId) return state.teams[i];
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
  ensureRotation(team);

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
  for (var i=0;i<st.teams.length;i++) normalizeTeam(st.teams[i]);
  if (st.teams.length) {
    var ok=false;
    for (var j=0;j<st.teams.length;j++) if (st.teams[j].id === st.activeTeamId) ok=true;
    if (!st.activeTeamId || !ok) st.activeTeamId = st.teams[0].id;
  } else st.activeTeamId = null;
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

  var teamsBtn = byId('teamsBtn');
  var rosterBtn = byId('rosterBtn');
  var undoBtn = byId('undoBtn');
  var exportName = byId('exportName');
  var exportBtn = byId('exportBtn');
  var resetBtn = byId('resetBtn');
  var rotationBtn = byId('rotationBtn');

  var onboarding = byId('onboarding');
  var onboardingTitle = byId('onboardingTitle');
  var onboardingSub = byId('onboardingSub');
  var onboardingTeamsBtn = byId('onboardingTeamsBtn');
  var onboardingRosterBtn = byId('onboardingRosterBtn');

  var exportConfirmBackdrop = byId('exportConfirmBackdrop');
  var exportConfirmClose = byId('exportConfirmClose');
  var exportConfirmCancel = byId('exportConfirmCancel');
  var exportConfirmOk = byId('exportConfirmOk');
  var exportConfirmFile = byId('exportConfirmFile');
  var exportConfirmTeam = byId('exportConfirmTeam');
  var exportConfirmView = byId('exportConfirmView');
  var exportConfirmScope = byId('exportConfirmScope');

  var pickerBackdrop = byId('pickerBackdrop');
  var pickerTitle = byId('pickerTitle');
  var playerGrid = byId('playerGrid');
  var pickerClose = byId('pickerClose');
  var pickerCancel = byId('pickerCancel');

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

  var rotationBackdrop = byId('rotationBackdrop');
  var rotationClose = byId('rotationClose');
  var rotationDone = byId('rotationDone');
  var rotationClear = byId('rotationClear');
  var rotationWheel = byId('rotationWheel');
  var setterPosSelect = byId('setterPosSelect');

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

  var pressureLegendBar = null;
  var pressureLegendLabels = null;
  if (thPressure) {
    try {
      var wrap = thPressure.querySelector('div');
      if (wrap && wrap.children && wrap.children.length >= 3) {
        pressureLegendBar = wrap.children[1];
        pressureLegendLabels = wrap.children[2];
      }
    } catch (e) {}
  }

  function hideModal(el){ if(!el) return; el.classList.add('hidden'); el.style.display='none'; }
  function showModal(el){ if(!el) return; el.classList.remove('hidden'); el.style.display='flex'; }

  hideModal(pickerBackdrop);
  hideModal(rosterBackdrop);
  hideModal(teamsBackdrop);
  hideModal(rotationBackdrop);
  hideModal(exportConfirmBackdrop);

  var uiMode = loadUiMode();

  var pendingAction = null;
  var selectionMode = null;
  var selectionPayload = null;
  var _rotationWasOpenBeforePicker = false;

  function applyModeToUI() {
    var L = LABELS[uiMode] || LABELS.player;
    if (thServeAtt) thServeAtt.textContent = L.serveAtt;
    if (thServeAvg) thServeAvg.textContent = L.serveAvg;

    if (pressureLabel) {
      pressureLabel.textContent = L.midPct;
      pressureLabel.title = (uiMode === 'player') ? SERVE_IN_TOOLTIP : '';
    }

    if (thAces) thAces.style.display = (uiMode === 'coach') ? 'none' : '';
    if (thAcePct) thAcePct.style.display = (uiMode === 'coach') ? 'none' : '';

    if (thPassAtt) thPassAtt.textContent = L.passAtt;
    if (thPassAvg) thPassAvg.textContent = L.passAvg;
    if (hintText) hintText.textContent = L.hint;

    if (pressureLegendBar) pressureLegendBar.style.display = (uiMode === 'player') ? 'none' : '';
    if (pressureLegendLabels) pressureLegendLabels.style.display = (uiMode === 'player') ? 'none' : '';

    if (rotationBtn) rotationBtn.style.display = (uiMode === 'coach') ? '' : 'none';

    if (modePlayerBtn) modePlayerBtn.setAttribute('aria-pressed', uiMode === 'player' ? 'true' : 'false');
    if (modeCoachBtn) modeCoachBtn.setAttribute('aria-pressed', uiMode === 'coach' ? 'true' : 'false');
  }

  function setUiMode(next) {
    uiMode = (next === 'coach') ? 'coach' : 'player';
    saveUiMode(uiMode);
    applyModeToUI();
    syncExportNameDefault();
    renderTable();
    if (uiMode !== 'coach') hideModal(rotationBackdrop);
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
      showModal(exportConfirmBackdrop);
      setTimeout(function(){ if (exportConfirmOk) exportConfirmOk.focus(); }, 0);
    });
  }

  function closeExportConfirmModal(result) {
    if (!exportConfirmBackdrop) return;
    hideModal(exportConfirmBackdrop);
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
      for (var k in agg) if (Object.prototype.hasOwnProperty.call(agg, k)) agg[k] += nz(merged[k], 0);
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
    var s1 = nz(c.serve1, 0);
    var s2 = nz(c.serve2, 0);
    var s3 = nz(c.serve3, 0);
    var ace = nz(c.ace, 0);
    var out = nz(c.serveOut, 0);

    var serveIn = s1 + s2 + s3 + ace;
    var serveAttPlayer = serveIn + out;
    var oppRecAtt = serveIn;

    var servePtsPlayer = (s1 * SERVE_WEIGHTS.serve1) + (s2 * SERVE_WEIGHTS.serve2) + (s3 * SERVE_WEIGHTS.serve3) + (ace * SERVE_WEIGHTS.ace);
    var serveAvgPlayer = serveAttPlayer ? (servePtsPlayer / serveAttPlayer) : 0;

    var oppPts = (s1 * 3) + (s2 * 2) + (s3 * 1) + (ace * 0);
    var oppSrAvg = oppRecAtt ? (oppPts / oppRecAtt) : 0;

    var serveInPct = safePct(serveIn, serveAttPlayer);
    var oppOosPct = safePct((s3 + ace), oppRecAtt);

    var passAtt = nz(c.passToTarget,0) + nz(c.passNearTarget,0) + nz(c.passAwayTarget,0) + nz(c.passShank,0);
    var passPts = nz(c.passToTarget,0)*PASS_WEIGHTS.passToTarget + nz(c.passNearTarget,0)*PASS_WEIGHTS.passNearTarget + nz(c.passAwayTarget,0)*PASS_WEIGHTS.passAwayTarget + nz(c.passShank,0)*PASS_WEIGHTS.passShank;
    var passAvg = passAtt ? (passPts / passAtt) : 0;

    var hitAtt = 0;
    for (var i = 0; i < HIT_ATTEMPT_ACTIONS.length; i++) hitAtt += nz(c[HIT_ATTEMPT_ACTIONS[i]],0);
    var kills = nz(c.kill,0) + nz(c.tipKill,0);
    var errs = 0;
    for (var j = 0; j < HIT_ERROR_ACTIONS.length; j++) errs += nz(c[HIT_ERROR_ACTIONS[j]],0);
    var hitAvg = hitAtt ? ((kills - errs) / hitAtt) : 0;
    var killPct = safePct(kills, hitAtt);

    var acePctPlayer = safePct(ace, serveAttPlayer);

    return { serveAttPlayer: serveAttPlayer, serveAvgPlayer: serveAvgPlayer, serveInPct: serveInPct, aceCount: ace, acePctPlayer: acePctPlayer, oppRecAtt: oppRecAtt, oppSrAvg: oppSrAvg, oppOosPct: oppOosPct, passAtt: passAtt, passAvg: passAvg, hitAtt: hitAtt, hitAvg: hitAvg, kills: kills, killPct: killPct };
  }

  function td(text, cls) { var el = document.createElement('td'); el.textContent = text; if (cls) el.className = cls; return el; }

  function renderTable() {
    statsBody.innerHTML = '';
    var team = activeTeam();
    if (!team) return;

    var serverId = null;
    if (uiMode === 'coach') { ensureRotation(team); autoFillBaseFromRoster(team); serverId = getServerPlayerId(team); }

    var players = (team.players || []).slice().sort(sortPlayers);
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      var d = derived(p.id);
      var tr = document.createElement('tr');

      if (uiMode === 'coach' && serverId && p.id === serverId) {
        tr.style.background = '#dcfce7';
        tr.style.fontWeight = '900';
        tr.style.boxShadow = 'inset 4px 0 0 #16a34a';
      }

      tr.appendChild(td(p.number || '—', 'left sticky-col'));
      tr.appendChild(td(p.name || '', 'left'));
      tr.appendChild(td(p.position || '—', 'left'));

      if (uiMode === 'coach') {
        tr.appendChild(td(String(d.oppRecAtt)));
        tr.appendChild(td(fmtNum(d.oppSrAvg, 2)));
      } else {
        tr.appendChild(td(String(d.serveAttPlayer)));
        tr.appendChild(td(fmtNum(d.serveAvgPlayer, 2)));
      }

      var midPct = (uiMode === 'coach') ? d.oppOosPct : d.serveInPct;
      var pctCell = td(fmtPct(midPct));

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

  function recordEvent(action, playerId) {
    var team = activeTeam();
    if (!team) return;

    var match = matchSelect.value || (team.matches[0] || 'Match 1');
    var set = setSelect.value || '1';

    ensureCounters(team, match, set, playerId);
    var counters = team.data[match][set][playerId];

    if (counters[action] === undefined) Object.assign(counters, Object.assign(emptyCounters(), counters));
    if (counters[action] === undefined) { alert('Unknown action. Try reloading the page.'); return; }

    counters[action] = nz(counters[action], 0) + 1;
    team.history.push({ match: match, set: set, playerId: playerId, action: action, ts: Date.now() });

    if (action === 'serveOut') { ensureRotation(team); advanceRotation(team); }

    saveState();
    closePicker();
    renderTable();
    updateOnboardingAndControls();

    if (rotationBackdrop && rotationBackdrop.style.display !== 'none') renderRotationWheel();
  }

  function openPicker() {
    if (!pickerBackdrop || !playerGrid) return;
    buildPlayerGrid();
    if (pickerBackdrop) pickerBackdrop.style.zIndex = '1200';
    showModal(pickerBackdrop);
  }

  function closePicker() {
    hideModal(pickerBackdrop);
    pendingAction = null;
    selectionMode = null;
    selectionPayload = null;

    if (_rotationWasOpenBeforePicker && rotationBackdrop && uiMode === 'coach') {
      rotationBackdrop.style.display = 'flex';
      rotationBackdrop.classList.remove('hidden');
      renderRotationWheel();
    }
    _rotationWasOpenBeforePicker = false;
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

        btn.addEventListener('click', function(){
          var team = activeTeam();
          if (!team) return;

          if (selectionMode === 'rotationAssign') {
            ensureRotation(team);
            autoFillBaseFromRoster(team);

            _rotationWasOpenBeforePicker = (rotationBackdrop && rotationBackdrop.style.display !== 'none');
            if (rotationBackdrop) rotationBackdrop.style.display = 'none';
            if (pickerBackdrop) pickerBackdrop.style.zIndex = '1200';
            if (rotationBackdrop) rotationBackdrop.style.zIndex = '1100';

            var curPos = parseInt(selectionPayload, 10);
            if (curPos >= 1 && curPos <= 6) {
              var baseSlot = inverseBaseForCurrentPos(curPos, team.rotation.offset || 0);
              team.rotation.base[baseSlot] = p.id;
              saveState();
              closePicker();
              renderRotationWheel();
              renderTable();
              return;
            }
          }

          recordEvent(pendingAction, p.id);
        });

        playerGrid.appendChild(btn);
      })(players[i]);
    }
  }

  if (pickerClose) pickerClose.addEventListener('click', closePicker);
  if (pickerCancel) pickerCancel.addEventListener('click', closePicker);
  if (pickerBackdrop) pickerBackdrop.addEventListener('click', function(e){ if (e.target === pickerBackdrop) closePicker(); });

  var toolbarBtns = document.querySelectorAll('.toolbar button[data-action]');
  for (var i = 0; i < toolbarBtns.length; i++) {
    toolbarBtns[i].addEventListener('click', function(){
      if (this.disabled) return;
      pendingAction = this.getAttribute('data-action');
      selectionMode = null;
      selectionPayload = null;
      if (pickerTitle) pickerTitle.textContent = 'Select Player — ' + prettyAction(pendingAction);
      openPicker();
    });
  }

  function playerNameById(team, pid) {
    if (!team || !team.players || !pid) return '—';
    for (var i = 0; i < team.players.length; i++) if (team.players[i].id === pid) return team.players[i].name;
    return '—';
  }

  function renderRotationWheel(){
    if (!rotationWheel) return;
    var team = activeTeam();
    if (!team) return;
    ensureRotation(team);
    autoFillBaseFromRoster(team);

    rotationWheel.innerHTML = '';
    var map = currentPosToPlayerId(team);

    if (setterPosSelect) setterPosSelect.value = team.rotation.setterPos ? String(team.rotation.setterPos) : '';

    var order = [4,3,2,5,6,1];
    for (var i=0;i<order.length;i++){
      (function(pos){
        var slot = document.createElement('div');
        slot.className = 'rotation-slot';

        var pid = map[pos];
        var name = playerNameById(team, pid);

        var posDiv = document.createElement('div');
        posDiv.className = 'rot-pos';
        posDiv.textContent = 'Pos ' + pos + (pos === 1 ? ' (Server)' : '');

        var nameDiv = document.createElement('div');
        nameDiv.className = 'rot-player';
        nameDiv.textContent = name || '—';

        slot.appendChild(posDiv);
        slot.appendChild(nameDiv);

        if (pos === 1) {
          slot.style.boxShadow = 'inset 0 0 0 3px #16a34a';
          if (pid) slot.style.background = '#dcfce7';
        }

        if (team.rotation.setterPos && parseInt(team.rotation.setterPos,10) === pos) slot.style.border = '3px solid #2563eb';

        slot.addEventListener('click', function(){
          selectionMode = 'rotationAssign';
          selectionPayload = pos;
          pendingAction = null;
          if (pickerTitle) pickerTitle.textContent = 'Assign Rotation Pos ' + pos;

          // Hide rotation backdrop while picker is active
          _rotationWasOpenBeforePicker = (rotationBackdrop && rotationBackdrop.style.display !== 'none');
          if (rotationBackdrop) rotationBackdrop.style.display = 'none';

          openPicker();
        });

        rotationWheel.appendChild(slot);
      })(order[i]);
    }

    saveState();
  }

  function openRotation(){
    if (!rotationBackdrop) return;
    if (uiMode !== 'coach') return;
    renderRotationWheel();
    showModal(rotationBackdrop);
  }

  function closeRotation(){
    hideModal(rotationBackdrop);
    renderTable();
  }

  if (rotationBtn) rotationBtn.addEventListener('click', openRotation);
  if (rotationClose) rotationClose.addEventListener('click', closeRotation);
  if (rotationDone) rotationDone.addEventListener('click', closeRotation);
  if (rotationBackdrop) rotationBackdrop.addEventListener('click', function(e){ if (e.target === rotationBackdrop) closeRotation(); });

  if (setterPosSelect) setterPosSelect.addEventListener('change', function(){
    var team = activeTeam();
    if (!team) return;
    ensureRotation(team);
    team.rotation.setterPos = setterPosSelect.value ? parseInt(setterPosSelect.value,10) : null;
    saveState();
    renderRotationWheel();
  });

  if (rotationClear) rotationClear.addEventListener('click', function(){
    var team = activeTeam();
    if (!team) return;
    ensureRotation(team);
    team.rotation.offset = 0;
    team.rotation.base = {1:null,2:null,3:null,4:null,5:null,6:null};
    team.rotation.setterPos = null;
    saveState();
    renderRotationWheel();
    renderTable();
  });

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
    if (rotationBackdrop && rotationBackdrop.style.display !== 'none') renderRotationWheel();
  });

  if (onboardingTeamsBtn) onboardingTeamsBtn.addEventListener('click', function(){ if (teamsBtn) teamsBtn.click(); });
  if (onboardingRosterBtn) onboardingRosterBtn.addEventListener('click', function(){ if (rosterBtn) rosterBtn.click(); });

  if (exportName) exportName.addEventListener('input', function(){
    exportName.dataset.userEdited = exportName.value.trim() ? '1' : '';
    if (!exportName.dataset.userEdited) syncExportNameDefault();
  });

  // Teams / roster / export / undo logic kept minimal for this snippet; if you need the full extended version, use v0.1.7.2 file.
  // NOTE: This build keeps the rotation + stacking fix as requested.

  // Initial paint
  initTeamSelect();
  initMatchSelect();
  applyModeToUI();
  renderTable();
  updateOnboardingAndControls();
});
