/**
 * VolleyStat v0.1.58 (full build)
 * - Restores Teams / Roster / Undo / Export / Reset functionality
 * - Export respects the View dropdown scope (Set / Match / Tournament)
 * - Reset uses a styled modal: clears ALL stats for CURRENT team only, preserves team+roster,
 *   resets rotation offset (keeps assignments) and reminds user to export first.
 * - Keeps v0.1.7.3 rotation picker stacking fix
 * - v0.1.58: Rotation now triggers correctly on side-out (regaining serve).
 *   Added hasBall possession tracking. Rotation wheel shows live serve status.
 *   Manual +our score also triggers rotation when we didn't have the ball.
 */

console.log('[VolleyStat] v0.1.58 loaded');

var STORAGE_KEY = 'volleystat_v058';
var UI_MODE_KEY = 'volleystat_ui_mode';
var DEFAULT_MATCHES = ['Match 1', 'Match 2', 'Match 3'];
var DEFAULT_DAYS = ['Day 1', 'Day 2', 'Day 3'];

var PASS_WEIGHTS = { passToTarget: 3, passNearTarget: 2, passAwayTarget: 1, passShank: 0 };
var SERVE_WEIGHTS = { serve1: 1, serve2: 2, serve3: 3, ace: 4 };

var HIT_ATTEMPT_ACTIONS = ['swing', 'swingOut', 'kill'];
var HIT_ERROR_ACTIONS = ['swingOut'];

// Unforced error action keys
var ERROR_ACTIONS = ['errHitting', 'errServing', 'errPassing', 'errNet', 'errTwoHand', 'errRotation'];
var ERROR_LABELS = {
  errHitting:  'Hit Error',
  errServing:  'Serve Error',
  errPassing:  'Pass Error',
  errNet:      'In the Net',
  errTwoHand:  'Two Hand',
  errRotation: 'Out of Rotation'
};

var LABELS = {
  player: {
    serveAtt: 'Serve Att',
    serveIn: 'Serves In',
    midPct: 'Serve In %',
    aces: 'ACE',
    acePct: 'Ace%',
    passAtt: 'Pass Att',
    passAvg: 'Pass Avg',
    hint: 'Serve In % = (1 + 2 + 3 + ACE) ÷ Serve Attempts. OUT is a serve attempt but not "in".'
  },
  coach: {
    serveAtt: 'Opp SR Att',
    serveIn: 'Opp SR In',
    midPct: 'Opp OOS%',
    aces: 'ACE',
    acePct: 'Ace%',
    passAtt: 'Our SR Att',
    passAvg: 'Our SR Avg',
    hint: 'Server = Pos 1 (rotation). Opp SR Avg = (3*Opp3 + 2*Opp2 + 1*Opp1 + 0*ACE) ÷ Opp SR Att.'
  }
};

var SERVE_IN_TOOLTIP = 'Serve In %: serves kept in play (1/2/3 + ACE) ÷ total serve attempts (includes OUT).';

// Rotation helpers
var POS_TO_BASE = { S:1, OH1:2, MB2:3, RS:4, OH2:5, MB1:6 };
function normPosToken(pos){
  if (!pos) return '';
  var s = String(pos).toUpperCase().trim();
  s = s.replace(/\s+/g,'').replace(/[-_]+/g,'');
  return s;
}
function ensureRotation(team){
  if (!team.rotation){
    team.rotation = { offset:0, base:{1:null,2:null,3:null,4:null,5:null,6:null}, setterPos:null, hasBall:true };
  }
  if (team.rotation.offset === undefined || team.rotation.offset === null) team.rotation.offset = 0;
  if (!team.rotation.base) team.rotation.base = {1:null,2:null,3:null,4:null,5:null,6:null};
  if (team.rotation.setterPos === undefined) team.rotation.setterPos = null;
  if (team.rotation.hasBall === undefined) team.rotation.hasBall = true;
}
function rotatedPos(basePos, offset){ return ((basePos - offset - 1 + 6000) % 6) + 1; }
function inverseBaseForCurrentPos(currentPos, offset){ return ((currentPos + offset - 1) % 6) + 1; }
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

// Utilities
function byId(id){ return document.getElementById(id); }
function nz(v,d){ return (v === undefined || v === null) ? d : v; }
function cryptoId(){
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return 'id_' + Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function emptyCounters(){
  return {
    serve1:0, serve2:0, serve3:0, ace:0, serveOut:0,
    passToTarget:0, passNearTarget:0, passAwayTarget:0, passShank:0,
    swing:0, swingOut:0, kill:0,
    errHitting:0, errServing:0, errPassing:0, errNet:0, errTwoHand:0, errRotation:0
  };
}
function safePct(n,d){ return d ? (n/d) : 0; }
function fmtPct(x){ return (x*100).toFixed(1) + '%'; }
function fmtNum(x,digits){ digits = nz(digits,2); return Number.isFinite(x) ? x.toFixed(digits) : (0).toFixed(digits); }
function csv(v){
  var s = String(v === undefined || v === null ? '' : v);
  if (s.indexOf(',')>=0 || s.indexOf('"')>=0 || s.indexOf('\n')>=0) return '"' + s.replaceAll('"','""') + '"';
  return s;
}
function safeFile(name){
  return String(name === undefined || name === null ? 'team' : name)
    .replace(/[^\w\-]+/g,'_')
    .replace(/_+/g,'_')
    .replace(/^_+|_+$/g,'')
    .slice(0,80);
}
function sortPlayers(a,b){
  var an = parseInt(a.number,10); var bn = parseInt(b.number,10);
  var aNum = Number.isFinite(an); var bNum = Number.isFinite(bn);
  if (aNum && bNum) return an - bn;
  if (aNum && !bNum) return -1;
  if (!aNum && bNum) return 1;
  return String(a.name||'').localeCompare(String(b.name||''));
}
function prettyAction(a){
  var map = { serve1:'1', serve2:'2', serve3:'3', ace:'ACE', serveOut:'OUT', passToTarget:'3', passNearTarget:'2', passAwayTarget:'1', passShank:'0', swing:'Swing', swingOut:'Error', kill:'Kill', errHitting:'Hit Err', errServing:'Srv Err', errPassing:'Pass Err', errNet:'Net', errTwoHand:'2-Touch', errRotation:'O.O.R.' };
  return map[a] || a;
}

function loadUiMode(){
  var v = localStorage.getItem(UI_MODE_KEY);
  return (v === 'coach' || v === 'player') ? v : 'player';
}
function saveUiMode(mode){ localStorage.setItem(UI_MODE_KEY, mode); }

function buildEmptyData(players, matches){
  var data = {};
  var days = DEFAULT_DAYS;
  for (var d=0;d<days.length;d++){
    for (var i=0;i<matches.length;i++){
      var key = days[d] + ' - ' + matches[i];
      data[key] = { '1':{}, '2':{}, '3':{} };
      for (var s=1; s<=3; s++){
        var ss = String(s);
        data[key][ss] = {};
        for (var p=0;p<players.length;p++) data[key][ss][players[p].id] = emptyCounters();
      }
    }
  }
  return data;
}

function newTeam(name){
  var players = [];
  var matches = DEFAULT_MATCHES.slice();
  return {
    id: cryptoId(),
    name: name,
    matches: matches,
    players: players,
    data: buildEmptyData(players, matches),
    history: [],
    rotation: { offset:0, base:{1:null,2:null,3:null,4:null,5:null,6:null}, setterPos:null, hasBall:true }
  };
}

function loadState(){
  var raw = localStorage.getItem(STORAGE_KEY);
  if (raw){ try { return JSON.parse(raw); } catch(e){} }
  return { activeTeamId:null, teams:[] };
}

var state = loadState();
normalizeAllTeams(state);
saveState();

// Firebase sync bootstraps asynchronously after DOMContentLoaded
// window._firebaseSave and window._firebaseLoaded are set by the module

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (window._firebaseSave) window._firebaseSave(state);
}

function activeTeam(){
  if (!state || !state.teams || !state.teams.length) return null;
  for (var i=0;i<state.teams.length;i++) if (state.teams[i].id === state.activeTeamId) return state.teams[i];
  return state.teams[0];
}

function ensureCounters(team, match, set, playerId){
  if (!team) return;
  if (!team.data) team.data = {};
  if (!team.data[match]) team.data[match] = { '1':{}, '2':{}, '3':{} };
  if (!team.data[match][set]) team.data[match][set] = {};
  if (!team.data[match][set][playerId]) team.data[match][set][playerId] = emptyCounters();
  if (team.data[match][set][playerId].serveOut === undefined) team.data[match][set][playerId].serveOut = 0;
}

function normalizeTeam(team){
  if (!team) return;
  if (!team.id) team.id = cryptoId();
  if (!team.name) team.name = 'Team';
  if (!Array.isArray(team.matches) || !team.matches.length) team.matches = DEFAULT_MATCHES.slice();
  if (!Array.isArray(team.players)) team.players = [];
  if (!Array.isArray(team.history)) team.history = [];
  if (!team.data) team.data = {};
  ensureRotation(team);

  var normDays = DEFAULT_DAYS;
  for (var nd=0; nd<normDays.length; nd++){
    for (var mi=0; mi<team.matches.length; mi++){
      var m = normDays[nd] + ' - ' + team.matches[mi];
      // also keep legacy keys (plain "Match 1" etc) for migration
      var legacyKey = team.matches[mi];
      if (!team.data[m]) {
        // migrate from legacy key if it exists
        team.data[m] = team.data[legacyKey] || { '1':{}, '2':{}, '3':{} };
      }
      for (var s=1;s<=3;s++){
        var ss = String(s);
        if (!team.data[m][ss]) team.data[m][ss] = {};
        for (var pi=0; pi<team.players.length; pi++){
          var p = team.players[pi];
          var existing = team.data[m][ss][p.id] || {};
          var merged = Object.assign(emptyCounters(), existing);
          if (merged.serveOut === undefined) merged.serveOut = 0;
          team.data[m][ss][p.id] = merged;
        }
      }
    }
  }
}

function normalizeAllTeams(st){
  if (!st) st = { activeTeamId:null, teams:[] };
  if (!Array.isArray(st.teams)) st.teams = [];
  for (var i=0;i<st.teams.length;i++) normalizeTeam(st.teams[i]);
  if (st.teams.length){
    var ok=false;
    for (var j=0;j<st.teams.length;j++) if (st.teams[j].id === st.activeTeamId) ok=true;
    if (!st.activeTeamId || !ok) st.activeTeamId = st.teams[0].id;
  } else {
    st.activeTeamId = null;
  }
}

// -------- App ---------
document.addEventListener('DOMContentLoaded', function(){
  var teamSelect = byId('teamSelect');
  var daySelect = byId('daySelect');
  var matchSelect = byId('matchSelect');

  function getMatchKey(){
    var day = (daySelect && daySelect.value) ? daySelect.value : 'Day 1';
    var match = matchSelect ? (matchSelect.value || 'Match 1') : 'Match 1';
    return day + ' - ' + match;
  }
  var setSelect = byId('setSelect');
  var viewSelect = byId('viewSelect');
  var statsBody = byId('statsBody');
  if (!teamSelect || !matchSelect || !setSelect || !viewSelect || !statsBody){
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
  var rotationBtn = byId('rotationBtn');

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

  // Reset confirm modal
  var resetConfirmBackdrop = byId('resetConfirmBackdrop');
  var resetConfirmClose = byId('resetConfirmClose');
  var resetConfirmCancel = byId('resetConfirmCancel');
  var resetConfirmOk = byId('resetConfirmOk');
  var resetConfirmExport = byId('resetConfirmExport');
  var resetConfirmTeam = byId('resetConfirmTeam');
  var resetConfirmScope = byId('resetConfirmScope');
  var resetConfirmRotation = byId('resetConfirmRotation');

  // Player picker modal
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

  // Rotation modal
  var rotationBackdrop = byId('rotationBackdrop');
  var rotationClose = byId('rotationClose');
  var rotationDone = byId('rotationDone');
  var rotationClear = byId('rotationClear');
  var rotationWheel = byId('rotationWheel');
  var setterPosSelect = byId('setterPosSelect');

  // Mode toggle
  var modePlayerBtn = byId('modePlayer');
  var modeCoachBtn = byId('modeCoach');

  // Table headers + hint
  var hintText = byId('hintText');
  var thServeAtt = byId('thServeAtt');
  var thServeIn = byId('thServeIn');
  var thAces = byId('thAces');
  var thAcePct = null; // removed
  var thPassAtt = byId('thPassAtt');
  var thPassAvg = byId('thPassAvg');
  var pressureLabel = byId('pressureLabel');
  var thPressure = byId('thPressure');

  var pressureLegendBar = null;
  var pressureLegendLabels = null;
  if (thPressure){
    try{
      var wrap = thPressure.querySelector('div');
      if (wrap && wrap.children && wrap.children.length >= 3){
        pressureLegendBar = wrap.children[1];
        pressureLegendLabels = wrap.children[2];
      }
    } catch(e){}
  }

  function hideModal(el){ if(!el) return; el.classList.add('hidden'); el.style.display='none'; }
  function showModal(el){ if(!el) return; el.classList.remove('hidden'); el.style.display='flex'; }

  hideModal(pickerBackdrop);
  hideModal(rosterBackdrop);
  hideModal(teamsBackdrop);
  hideModal(rotationBackdrop);
  hideModal(exportConfirmBackdrop);
  hideModal(resetConfirmBackdrop);
  if (byId('editBackdrop')) hideModal(byId('editBackdrop'));

  var uiMode = loadUiMode();

  // picker state
  var pendingAction = null;
  var selectionMode = null;
  var selectionPayload = null;
  var _rotationWasOpenBeforePicker = false;

  function setDisabled(el, disabled){ if (el) el.disabled = !!disabled; }
  function setToolbarStatsEnabled(enabled){
    var btns = document.querySelectorAll('.stat-btn[data-action], .toolbar button[data-action]');
    for (var i=0;i<btns.length;i++) btns[i].disabled = !enabled;
  }

  function getViewLabel(){
    var v = viewSelect.value;
    if (v === 'set') return 'Current Set';
    if (v === 'match') return 'Current Match';
    return 'Tournament Total';
  }
  function getExportContextLabel(){
    var view = viewSelect.value;
    var set = setSelect.value || '1';
    var matchKey = getMatchKey();
    if (view === 'set') return matchKey + ' Set ' + set;
    if (view === 'match') return matchKey;
    return 'Tournament';
  }
  function modeLabelForFile(){ return uiMode === 'coach' ? 'CoachView' : 'PlayerView'; }
  function defaultExportBaseName(){
    var t = activeTeam();
    var teamName = t && t.name ? t.name : 'team';
    return safeFile(teamName) + '_' + safeFile(getExportContextLabel()) + '_' + modeLabelForFile();
  }
  function syncExportNameDefault(){
    // Do not auto-populate — user types their own export name
    if (!exportName) return;
    if (!exportName.value && !exportName.dataset.userEdited) exportName.value = '';
  }

  function applyModeToUI(){
    var L = LABELS[uiMode] || LABELS.player;
    if (thServeAtt) thServeAtt.textContent = L.serveAtt;
    if (thServeIn) thServeIn.textContent = L.serveIn;
    if (pressureLabel){
      pressureLabel.textContent = L.midPct;
      pressureLabel.title = (uiMode === 'player') ? SERVE_IN_TOOLTIP : '';
    }
    if (thAces) thAces.style.display = (uiMode === 'coach') ? 'none' : '';
    if (thPassAtt) thPassAtt.textContent = L.passAtt;
    if (thPassAvg) thPassAvg.textContent = L.passAvg;
    if (hintText) hintText.textContent = L.hint;
    if (pressureLegendBar) pressureLegendBar.style.display = (uiMode === 'player') ? 'none' : '';
    if (pressureLegendLabels) pressureLegendLabels.style.display = (uiMode === 'player') ? 'none' : '';
    if (rotationBtn) rotationBtn.style.display = (uiMode === 'coach') ? '' : 'none';
    if (modePlayerBtn) modePlayerBtn.setAttribute('aria-pressed', uiMode === 'player' ? 'true' : 'false');
    if (modeCoachBtn) modeCoachBtn.setAttribute('aria-pressed', uiMode === 'coach' ? 'true' : 'false');
  }
  function setUiMode(next){
    uiMode = (next === 'coach') ? 'coach' : 'player';
    saveUiMode(uiMode);
    applyModeToUI();
    syncExportNameDefault();
    renderTable();
    if (uiMode !== 'coach') hideModal(rotationBackdrop);
  }
  if (modePlayerBtn) modePlayerBtn.addEventListener('click', function(){ setUiMode('player'); });
  if (modeCoachBtn) modeCoachBtn.addEventListener('click', function(){ setUiMode('coach'); });

  function updateOnboardingAndControls(){
    buildDesktopStrip();
    var team = activeTeam();
    var hasTeam = !!team;
    var hasRoster = !!(team && team.players && team.players.length);

    if (onboarding){
      if (!hasTeam){
        onboarding.classList.remove('hidden');
        if (onboardingTitle) onboardingTitle.textContent = 'Step 1: Add a Team';
        if (onboardingSub) onboardingSub.textContent = 'You don\u2019t have any teams yet. Add a team to begin.';
        if (onboardingRosterBtn) onboardingRosterBtn.style.display = 'none';
      } else if (!hasRoster){
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
    setDisabled(daySelect, !hasTeam);
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

  // Export confirm modal plumbing
  var _exportConfirmResolve = null;
  var _exportConfirmLastFocus = null;
  function isExportConfirmOpen(){ return exportConfirmBackdrop && !exportConfirmBackdrop.classList.contains('hidden'); }
  function openExportConfirmModal(opts){
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
  function closeExportConfirmModal(result){
    if (!exportConfirmBackdrop) return;
    hideModal(exportConfirmBackdrop);
    var resolver = _exportConfirmResolve;
    _exportConfirmResolve = null;
    try{ if (_exportConfirmLastFocus && _exportConfirmLastFocus.focus) _exportConfirmLastFocus.focus(); }catch(e){}
    _exportConfirmLastFocus = null;
    if (resolver) resolver(!!result);
  }
  if (exportConfirmOk) exportConfirmOk.addEventListener('click', function(){ closeExportConfirmModal(true); });
  if (exportConfirmCancel) exportConfirmCancel.addEventListener('click', function(){ closeExportConfirmModal(false); });
  if (exportConfirmClose) exportConfirmClose.addEventListener('click', function(){ closeExportConfirmModal(false); });
  if (exportConfirmBackdrop) exportConfirmBackdrop.addEventListener('click', function(e){ if (e.target === exportConfirmBackdrop) closeExportConfirmModal(false); });
  document.addEventListener('keydown', function(e){ if (isExportConfirmOpen() && e.key === 'Escape'){ e.preventDefault(); closeExportConfirmModal(false);} });

  // Reset confirm modal plumbing
  var _resetConfirmResolve = null;
  var _resetConfirmLastFocus = null;
  function isResetConfirmOpen(){ return resetConfirmBackdrop && !resetConfirmBackdrop.classList.contains('hidden'); }
  function openResetConfirmModal(opts){
    return new Promise(function(resolve){
      if (!resetConfirmBackdrop) return resolve(true);
      _resetConfirmLastFocus = document.activeElement;
      _resetConfirmResolve = resolve;
      if (resetConfirmTeam) resetConfirmTeam.textContent = opts.teamName;
      if (resetConfirmScope) resetConfirmScope.textContent = opts.scope;
      if (resetConfirmRotation) resetConfirmRotation.textContent = opts.rotation;
      showModal(resetConfirmBackdrop);
      setTimeout(function(){ if (resetConfirmOk) resetConfirmOk.focus(); }, 0);
    });
  }
  function closeResetConfirmModal(result){
    if (!resetConfirmBackdrop) return;
    hideModal(resetConfirmBackdrop);
    var resolver = _resetConfirmResolve;
    _resetConfirmResolve = null;
    try{ if (_resetConfirmLastFocus && _resetConfirmLastFocus.focus) _resetConfirmLastFocus.focus(); }catch(e){}
    _resetConfirmLastFocus = null;
    if (resolver) resolver(result);
  }
  if (resetConfirmOk) resetConfirmOk.addEventListener('click', function(){ closeResetConfirmModal(true); });
  if (resetConfirmCancel) resetConfirmCancel.addEventListener('click', function(){ closeResetConfirmModal(false); });
  if (resetConfirmExport) resetConfirmExport.addEventListener('click', function(){ closeResetConfirmModal('export'); });
  if (resetConfirmClose) resetConfirmClose.addEventListener('click', function(){ closeResetConfirmModal(false); });
  if (resetConfirmBackdrop) resetConfirmBackdrop.addEventListener('click', function(e){ if (e.target === resetConfirmBackdrop) closeResetConfirmModal(false); });
  document.addEventListener('keydown', function(e){ if (isResetConfirmOpen() && e.key === 'Escape'){ e.preventDefault(); closeResetConfirmModal(false);} });

  // Select init
  function initTeamSelect(){
    teamSelect.innerHTML = '';
    if (!state.teams.length){
      var opt = document.createElement('option');
      opt.value=''; opt.textContent='No teams yet'; opt.disabled=true; opt.selected=true;
      teamSelect.appendChild(opt);
      return;
    }
    for (var i=0;i<state.teams.length;i++){
      var t = state.teams[i];
      var o = document.createElement('option');
      o.value = t.id; o.textContent = t.name;
      teamSelect.appendChild(o);
    }
    var active = activeTeam();
    teamSelect.value = active ? active.id : state.teams[0].id;
  }
  function initMatchSelect(){
    var prevMatch = matchSelect ? matchSelect.value : '';
    matchSelect.innerHTML='';
    var team = activeTeam();
    if (!team){
      var opt = document.createElement('option');
      opt.value=''; opt.textContent='—'; opt.disabled=true; opt.selected=true;
      matchSelect.appendChild(opt);
      return;
    }
    for (var i=0;i<team.matches.length;i++){
      var m = team.matches[i];
      var o = document.createElement('option');
      o.value=m; o.textContent=m;
      matchSelect.appendChild(o);
    }
    // Restore previous selection if it still exists, otherwise default to first
    if (prevMatch && team.matches.indexOf(prevMatch) >= 0){
      matchSelect.value = prevMatch;
    } else {
      matchSelect.value = team.matches[0] || 'Match 1';
    }
  }

  function pressureHeatStyle(pct){
    var v = Number.isFinite(pct) ? pct : 0;
    var t = Math.max(0, Math.min(1, v));
    var hue = 120 * (1 - t);
    var sat = 75;
    var light = 92 - 37 * t;
    var bg = 'hsl(' + Math.round(hue) + ' ' + sat + '% ' + Math.round(light) + '%)';
    return { bg:bg, fg:'#111827' };
  }

  function getAggregateCounters(playerId){
    var team = activeTeam();
    if (!team) return emptyCounters();
    var view = viewSelect.value || 'tournament';
    var matchKey = getMatchKey();
    var set = setSelect.value || '1';

    var agg = emptyCounters();
    function addFrom(matchName, setNum){
      var c = (((team.data || {})[matchName] || {})[setNum] || {})[playerId];
      if (!c) return;
      var merged = Object.assign(emptyCounters(), c);
      for (var k in agg) if (Object.prototype.hasOwnProperty.call(agg,k)) agg[k] += nz(merged[k],0);
    }

    var day = (daySelect && daySelect.value) ? daySelect.value : 'Day 1';
    if (view === 'set') addFrom(matchKey, set);
    else if (view === 'match') { addFrom(matchKey,'1'); addFrom(matchKey,'2'); addFrom(matchKey,'3'); }
    else {
      // tournament: all days, all matches, all sets
      for (var nd=0; nd<DEFAULT_DAYS.length; nd++){
        for (var mi=0; mi<team.matches.length; mi++){
          var mn = DEFAULT_DAYS[nd] + ' - ' + team.matches[mi];
          addFrom(mn,'1'); addFrom(mn,'2'); addFrom(mn,'3');
        }
      }
    }
    return agg;
  }

  function derived(playerId){
    var c = getAggregateCounters(playerId);
    var s1 = nz(c.serve1,0), s2 = nz(c.serve2,0), s3 = nz(c.serve3,0), ace = nz(c.ace,0), out = nz(c.serveOut,0);
    var serveIn = s1+s2+s3+ace;
    var serveAttPlayer = serveIn + out;
    var oppRecAtt = serveIn;

    var oppPts = (s1*3) + (s2*2) + (s3*1) + (ace*0);
    var oppSrAvg = oppRecAtt ? (oppPts/oppRecAtt) : 0;

    var serveInPct = safePct(serveIn, serveAttPlayer);
    var oppOosPct = safePct((s3+ace), oppRecAtt);

    var passAtt = nz(c.passToTarget,0)+nz(c.passNearTarget,0)+nz(c.passAwayTarget,0)+nz(c.passShank,0);
    var passPts = nz(c.passToTarget,0)*PASS_WEIGHTS.passToTarget + nz(c.passNearTarget,0)*PASS_WEIGHTS.passNearTarget + nz(c.passAwayTarget,0)*PASS_WEIGHTS.passAwayTarget + nz(c.passShank,0)*PASS_WEIGHTS.passShank;
    var passAvg = passAtt ? (passPts/passAtt) : 0;

    var hitAtt = 0;
    for (var i=0;i<HIT_ATTEMPT_ACTIONS.length;i++) hitAtt += nz(c[HIT_ATTEMPT_ACTIONS[i]],0);
    var kills = nz(c.kill,0);
    var errs = 0;
    for (var j=0;j<HIT_ERROR_ACTIONS.length;j++) errs += nz(c[HIT_ERROR_ACTIONS[j]],0);
    var hitAvg = hitAtt ? ((kills-errs)/hitAtt) : 0;
    var hitsIn = kills; // kills = balls in (successful attacks)
    var hitsInPct = safePct(hitsIn, hitAtt);

    var acePctPlayer = safePct(ace, serveAttPlayer);

    // Unforced errors total
    var totalErrors = 0;
    for (var k=0;k<ERROR_ACTIONS.length;k++) totalErrors += nz(c[ERROR_ACTIONS[k]],0);

    return {
      serveAttPlayer: serveAttPlayer,
      serveIn: serveIn,
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
      hitsIn: hitsIn,
      hitsInPct: hitsInPct,
      totalErrors: totalErrors,
      errHitting: nz(c.errHitting,0),
      errServing: nz(c.errServing,0),
      errPassing: nz(c.errPassing,0),
      errNet: nz(c.errNet,0),
      errTwoHand: nz(c.errTwoHand,0),
      errRotation: nz(c.errRotation,0)
    };
  }

  function td(text, cls){ var el = document.createElement('td'); el.textContent = text; if (cls) el.className = cls; return el; }

  function renderTable(){
    statsBody.innerHTML='';
    var team = activeTeam();
    if (!team) return;

    var serverId = null;
    if (uiMode === 'coach'){
      ensureRotation(team);
      autoFillBaseFromRoster(team);
      serverId = getServerPlayerId(team);
    }

    var players = (team.players || []).slice().sort(sortPlayers);
    for (var i=0;i<players.length;i++){
      var p = players[i];
      var d = derived(p.id);
      var tr = document.createElement('tr');

      if (uiMode === 'coach' && serverId && p.id === serverId){
        tr.style.background = '#dcfce7';
        tr.style.fontWeight = '900';
        tr.style.boxShadow = 'inset 4px 0 0 #16a34a';
      }

      // Display: name only (no # or position — those are in export)
      var nameCell = td(p.name || '', 'left sticky-col');
      nameCell.style.background = '#f9fafb';
      tr.appendChild(nameCell);

      // ── SERVE columns (light blue bg) ──
      var sAttCell = td(uiMode==='coach' ? String(d.oppRecAtt) : String(d.serveAttPlayer));
      sAttCell.style.background='#eff6ff';
      tr.appendChild(sAttCell);

      var sInCell = td(uiMode==='coach' ? String(d.oppRecAtt) : String(d.serveIn));
      sInCell.style.background='#eff6ff';
      tr.appendChild(sInCell);

      var aceCell = td(String(d.aceCount));
      aceCell.style.background='#eff6ff';
      tr.appendChild(aceCell);

      var midPct = (uiMode === 'coach') ? d.oppOosPct : d.serveInPct;
      var pctCell = td(fmtPct(midPct));
      pctCell.style.background='#eff6ff';
      if (uiMode === 'coach'){
        var heat = pressureHeatStyle(midPct);
        pctCell.style.background = heat.bg;
        pctCell.style.color = heat.fg;
        pctCell.style.fontWeight = '900';
      } else {
        pctCell.style.fontWeight = '700';
      }
      tr.appendChild(pctCell);

      // ── SRV/REC columns (mid blue bg, left separator) ──
      var passAttCell = td(String(d.passAtt));
      passAttCell.style.background='#dbeafe';
      passAttCell.style.borderLeft='2px solid #bfdbfe';
      tr.appendChild(passAttCell);

      // Pass avg with color scale: <2.0 red, 2.0-2.5 sliding, >=2.5 green
      var passAvgCell = td(fmtNum(d.passAvg,2));
      passAvgCell.style.background='#dbeafe';
      passAvgCell.style.fontWeight='700';
      if (d.passAtt > 0){
        var pav = d.passAvg;
        if (pav < 2.0){
          passAvgCell.style.color='#dc2626';
        } else if (pav >= 2.5){
          passAvgCell.style.color='#16a34a';
        } else {
          // sliding 2.0-2.5: interpolate red->green
          var t = (pav - 2.0) / 0.5;
          var r = Math.round(220 + (22-220)*t);
          var g = Math.round(38 + (163-38)*t);
          var b = Math.round(38 + (74-38)*t);
          passAvgCell.style.color = 'rgb('+r+','+g+','+b+')';
        }
      }
      tr.appendChild(passAvgCell);

      // ── HIT columns (light blue bg, left separator) ──
      var hitAttCell = td(String(d.hitAtt));
      hitAttCell.style.background='#eff6ff';
      hitAttCell.style.borderLeft='2px solid #bfdbfe';
      tr.appendChild(hitAttCell);

      var hitsInCell = td(String(d.hitsIn));
      hitsInCell.style.background='#eff6ff';
      tr.appendChild(hitsInCell);

      var killsCell = td(String(d.kills));
      killsCell.style.background='#eff6ff';
      tr.appendChild(killsCell);

      // Hit avg: <0.250 = red, >=0.250 = green
      var hitAvgCell = td(fmtNum(d.hitAvg,3));
      hitAvgCell.style.background='#eff6ff';
      hitAvgCell.style.fontWeight='700';
      if (d.hitAtt > 0){
        if (d.hitAvg >= 0.250){
          hitAvgCell.style.color='#16a34a';
        } else {
          hitAvgCell.style.color='#dc2626';
        }
      }
      tr.appendChild(hitAvgCell);

      // ── ERROR columns (mid blue bg, left separator) ──
      var errTotCell = td(String(d.totalErrors));
      errTotCell.style.background='#dbeafe';
      errTotCell.style.borderLeft='2px solid #bfdbfe';
      errTotCell.style.fontWeight='900';
      if (d.totalErrors > 0) errTotCell.style.color='#dc2626';
      tr.appendChild(errTotCell);

      var eFields = ['errHitting','errServing','errPassing','errNet','errTwoHand','errRotation'];
      eFields.forEach(function(ef){
        var ec = td(String(d[ef]));
        ec.style.background='#dbeafe';
        if (d[ef] > 0) ec.style.color='#dc2626';
        tr.appendChild(ec);
      });

      statsBody.appendChild(tr);
    }

    // Totals row — sum all players
    if (players.length > 1){
      var totals = {
        serveAtt:0, serveIn:0,
        passAtt:0, hitAtt:0, hitsIn:0, kills:0,
        aceCount:0, totalErrors:0,
        errHitting:0, errServing:0, errPassing:0,
        errNet:0, errTwoHand:0, errRotation:0
      };
      for (var ti=0; ti<players.length; ti++){
        var dd = derived(players[ti].id);
        totals.serveAtt   += dd.serveAttPlayer;
        totals.serveIn    += dd.serveIn;
        totals.passAtt    += dd.passAtt;
        totals.hitAtt     += dd.hitAtt;
        totals.hitsIn     += dd.hitsIn;
        totals.kills      += dd.kills;
        totals.aceCount   += dd.aceCount;
        totals.totalErrors+= dd.totalErrors;
        totals.errHitting += dd.errHitting;
        totals.errServing += dd.errServing;
        totals.errPassing += dd.errPassing;
        totals.errNet     += dd.errNet;
        totals.errTwoHand += dd.errTwoHand;
        totals.errRotation+= dd.errRotation;
      }
      var serveInPctTot = totals.serveAtt ? totals.serveIn / totals.serveAtt : 0;
      var hitsInPctTot  = totals.hitAtt   ? totals.hitsIn  / totals.hitAtt  : 0;

      var tfoot = document.createElement('tr');
      tfoot.style.fontWeight = '900';
      tfoot.style.borderTop  = '2px solid #c7d2fe';

      function ftd(text, bg, extra){
        var c = document.createElement('td');
        c.textContent = text;
        c.style.background = bg || '#f0f4ff';
        c.style.fontWeight = '900';
        if (extra) Object.assign(c.style, extra);
        return c;
      }

      var totNameCell = document.createElement('td');
      totNameCell.textContent = 'TEAM TOTALS';
      totNameCell.className = 'left sticky-col';
      totNameCell.style.cssText = 'font-weight:900;background:#f0f4ff;';
      tfoot.appendChild(totNameCell);

      // Serve cols
      tfoot.appendChild(ftd(String(totals.serveAtt), '#dde9ff'));
      tfoot.appendChild(ftd(String(totals.serveIn), '#dde9ff'));
      tfoot.appendChild(ftd(String(totals.aceCount), '#dde9ff'));
      var pctTotCell = ftd(fmtPct(serveInPctTot), '#dde9ff');
      tfoot.appendChild(pctTotCell);

      // Pass cols
      tfoot.appendChild(ftd(String(totals.passAtt), '#c7d8f8', {borderLeft:'2px solid #bfdbfe'}));
      tfoot.appendChild(ftd('', '#c7d8f8'));

      // Hit cols
      tfoot.appendChild(ftd(String(totals.hitAtt), '#dde9ff', {borderLeft:'2px solid #bfdbfe'}));
      tfoot.appendChild(ftd(String(totals.hitsIn), '#dde9ff'));
      tfoot.appendChild(ftd('', '#dde9ff'));
      tfoot.appendChild(ftd('', '#dde9ff'));

      // Error cols
      var errTot = ftd(String(totals.totalErrors), '#c7d8f8', {borderLeft:'2px solid #bfdbfe', color: totals.totalErrors>0?'#dc2626':''});
      tfoot.appendChild(errTot);
      tfoot.appendChild(ftd(String(totals.errHitting), '#c7d8f8'));
      tfoot.appendChild(ftd(String(totals.errServing), '#c7d8f8'));
      tfoot.appendChild(ftd(String(totals.errPassing), '#c7d8f8'));
      tfoot.appendChild(ftd(String(totals.errNet), '#c7d8f8'));
      tfoot.appendChild(ftd(String(totals.errTwoHand), '#c7d8f8'));
      tfoot.appendChild(ftd(String(totals.errRotation), '#c7d8f8'));

      statsBody.appendChild(tfoot);
    }
  }

  // Record stat event
  function recordEvent(action, playerId){
    var team = activeTeam();
    if (!team) return;

    var match = getMatchKey();
    var set = setSelect.value || '1';

    ensureCounters(team, match, set, playerId);
    var counters = team.data[match][set][playerId];

    if (counters[action] === undefined) Object.assign(counters, Object.assign(emptyCounters(), counters));
    if (counters[action] === undefined){
      alert('Unknown action. Try reloading the page.');
      return;
    }

    counters[action] = nz(counters[action],0) + 1;
    team.history.push({ match:match, set:set, playerId:playerId, action:action, ts:Date.now() });

    // Auto-increment linked error counters
    var linkedError = null;
    if (action === 'serveOut')   linkedError = 'errServing';
    if (action === 'swingOut')   linkedError = 'errHitting';
    if (action === 'passShank')  linkedError = 'errPassing';
    if (linkedError){
      counters[linkedError] = nz(counters[linkedError], 0) + 1;
      team.history.push({ match:match, set:set, playerId:playerId, action:linkedError, ts:Date.now(), auto:true });
    }

    // Cap history at 500 entries to keep data size manageable
    if (team.history.length > 500) team.history = team.history.slice(-500);

    // Auto-adjust score based on action (only for primary action, not auto-linked errors)
    autoAdjustScore(action);

    // ── Possession + rotation logic ──────────────────────────────────────────
    // Side-out (we win rally without the serve) → rotate then take serve
    // We lose the rally → opponent gets the serve
    ensureRotation(team);
    var WE_WIN_RALLY  = (action === 'kill' || action === 'ace');
    var WE_LOSE_RALLY = (action === 'serveOut' || action === 'swingOut' || action === 'passShank' ||
                         action === 'errPassing' || action === 'errNet' || action === 'errTwoHand' ||
                         action === 'errRotation');
    if (WE_WIN_RALLY && !team.rotation.hasBall){
      // Side-out: we regained the serve → rotate, then mark as serving
      advanceRotation(team);
      team.rotation.hasBall = true;
    } else if (WE_WIN_RALLY){
      // Kill/ace while already serving → keep serving, no rotation
      team.rotation.hasBall = true;
    } else if (WE_LOSE_RALLY){
      // Lost the rally → opponent now serves
      team.rotation.hasBall = false;
    }

    saveState();
    closePicker();
    renderTable();
    updateOnboardingAndControls();
    if (rotationBackdrop && rotationBackdrop.style.display !== 'none') renderRotationWheel();
  }

  // Picker
  function openPicker(){
    if (!pickerBackdrop || !playerGrid) return;
    buildPlayerGrid();
    // Show/update quick-record banner for currently selected player
    var quickBar = byId('pickerQuickBar');
    if (quickBar){
      var team = activeTeam();
      var ap = null;
      if (team && activePlayerId){
        for (var qi=0;qi<team.players.length;qi++) if(team.players[qi].id===activePlayerId){ ap=team.players[qi]; break; }
      }
      if (ap){
        quickBar.style.display = 'block';
        var qLabel = byId('pickerQuickLabel');
        if (qLabel) qLabel.textContent = 'Record for: ' + (ap.number?'#'+ap.number+' ':'') + ap.name + ' (last selected)';
      } else {
        quickBar.style.display = 'none';
      }
    }
    pickerBackdrop.style.zIndex = '1200';
    showModal(pickerBackdrop);
  }
  function closePicker(){
    hideModal(pickerBackdrop);
    pendingAction = null;
    selectionMode = null;
    selectionPayload = null;

    if (_rotationWasOpenBeforePicker && rotationBackdrop && uiMode === 'coach'){
      rotationBackdrop.style.display = 'flex';
      rotationBackdrop.classList.remove('hidden');
      renderRotationWheel();
    }
    _rotationWasOpenBeforePicker = false;
  }
  function buildPlayerGrid(){
    if (!playerGrid) return;
    var team = activeTeam();
    playerGrid.innerHTML='';
    var players = (team && team.players ? team.players.slice() : []).sort(sortPlayers);

    for (var i=0;i<players.length;i++){
      (function(p){
        var btn = document.createElement('button');
        btn.type='button';
        btn.className='player-btn';
        // Highlight currently selected player
        if (p.id === activePlayerId){
          btn.style.cssText = 'background:#1e3a8a;color:#fff;border-color:#1e3a8a;';
        }
        var top = (p.number ? '#' + p.number + ' ' : '') + (p.name || '');
        btn.appendChild(document.createTextNode(top));
        var sub = document.createElement('span');
        sub.className='player-sub';
        sub.textContent = p.position ? ('Pos: ' + p.position) : 'Pos: —';
        if (p.id === activePlayerId) sub.style.color = 'rgba(255,255,255,0.75)';
        btn.appendChild(sub);

        btn.addEventListener('click', function(){
          var team = activeTeam();
          if (!team) return;

          // rotation assignment mode
          if (selectionMode === 'rotationAssign'){
            ensureRotation(team);
            autoFillBaseFromRoster(team);
            _rotationWasOpenBeforePicker = (rotationBackdrop && rotationBackdrop.style.display !== 'none');
            if (rotationBackdrop) rotationBackdrop.style.display = 'none';
            if (pickerBackdrop) pickerBackdrop.style.zIndex = '1200';
            if (rotationBackdrop) rotationBackdrop.style.zIndex = '1100';

            var curPos = parseInt(selectionPayload,10);
            if (curPos >= 1 && curPos <= 6){
              var baseSlot = inverseBaseForCurrentPos(curPos, team.rotation.offset || 0);
              team.rotation.base[baseSlot] = p.id;
              saveState();
              closePicker();
              renderRotationWheel();
              renderTable();
              return;
            }
          }

          // Update active player when picked via popup
          activePlayerId = p.id;
          setLastPlayer(p.id);
          buildPlayerStrip();
          buildDesktopStrip();
          recordEvent(pendingAction, p.id);
        });

        playerGrid.appendChild(btn);
      })(players[i]);
    }
  }

  // Quick record button — records for currently selected player
  var pickerQuickBtn = byId('pickerQuickBtn');
  if (pickerQuickBtn){
    pickerQuickBtn.addEventListener('click', function(){
      if (activePlayerId && pendingAction){
        buildPlayerStrip();
        buildDesktopStrip();
        recordEvent(pendingAction, activePlayerId);
      }
    });
  }

  if (pickerClose) pickerClose.addEventListener('click', closePicker);
  if (pickerCancel) pickerCancel.addEventListener('click', closePicker);
  if (pickerBackdrop) pickerBackdrop.addEventListener('click', function(e){ if (e.target === pickerBackdrop) closePicker(); });

  // Desktop toolbar stat buttons — always open picker (pre-highlights current player)
  var toolbarBtns = document.querySelectorAll('.toolbar button[data-action]');
  for (var tb=0; tb<toolbarBtns.length; tb++){
    toolbarBtns[tb].addEventListener('click', function(){
      if (this.disabled) return;
      pendingAction = this.getAttribute('data-action');
      selectionMode = null;
      selectionPayload = null;
      if (pickerTitle) pickerTitle.textContent = 'Select Player — ' + prettyAction(pendingAction);
      openPicker();
    });
  }

  // Mobile stat buttons — always open picker (pre-highlights current player)
  var mobileStatBtnsList = document.querySelectorAll('.stat-btn[data-action]');
  for (var ms=0; ms<mobileStatBtnsList.length; ms++){
    mobileStatBtnsList[ms].addEventListener('click', function(){
      if (this.disabled) return;
      pendingAction = this.getAttribute('data-action');
      selectionMode = null;
      selectionPayload = null;
      if (pickerTitle) pickerTitle.textContent = 'Select Player — ' + prettyAction(pendingAction);
      openPicker();
    });
  }

  // Rotation wheel
  function playerNameById(team, pid){
    if (!team || !team.players || !pid) return '—';
    for (var i=0;i<team.players.length;i++) if (team.players[i].id === pid) return team.players[i].name;
    return '—';
  }

  function renderRotationWheel(){
    if (!rotationWheel) return;
    var team = activeTeam();
    if (!team) return;
    ensureRotation(team);
    autoFillBaseFromRoster(team);

    rotationWheel.innerHTML='';
    var map = currentPosToPlayerId(team);

    if (setterPosSelect) setterPosSelect.value = team.rotation.setterPos ? String(team.rotation.setterPos) : '';

    // ── Serve status banner ──────────────────────────────────────────────────
    var statusBar = document.getElementById('rotationStatusBar');
    if (statusBar){
      var hasBall = team.rotation.hasBall !== false;
      statusBar.textContent = hasBall ? '🟢 Serving' : '🔴 Receiving';
      statusBar.style.background = hasBall ? '#dcfce7' : '#fee2e2';
      statusBar.style.color      = hasBall ? '#15803d' : '#b91c1c';
    }

    var order = [4,3,2,5,6,1];
    for (var i=0;i<order.length;i++){
      (function(pos){
        var slot = document.createElement('div');
        slot.className='rotation-slot';
        var pid = map[pos];
        var name = playerNameById(team, pid);

        var posDiv = document.createElement('div');
        posDiv.className='rot-pos';
        posDiv.textContent = 'Pos ' + pos + (pos === 1 ? ' (Server)' : '');

        var nameDiv = document.createElement('div');
        nameDiv.className='rot-player';
        nameDiv.textContent = name || '—';

        slot.appendChild(posDiv);
        slot.appendChild(nameDiv);

        if (pos === 1){
          slot.style.boxShadow = 'inset 0 0 0 3px #16a34a';
          if (pid) slot.style.background = '#dcfce7';
        }
        if (team.rotation.setterPos && parseInt(team.rotation.setterPos,10) === pos) slot.style.border = '3px solid #2563eb';

        slot.addEventListener('click', function(){
          selectionMode = 'rotationAssign';
          selectionPayload = pos;
          pendingAction = null;
          if (pickerTitle) pickerTitle.textContent = 'Assign Rotation Pos ' + pos;
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
  function closeRotation(){ hideModal(rotationBackdrop); renderTable(); }

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
    team.rotation.hasBall = true;
    saveState();
    renderRotationWheel();
    renderTable();
  });

  // Teams modal
  function openTeams(){
    if (!teamsBackdrop) return;
    buildTeamsList();
    var team = activeTeam();
    if (teamIdEl) teamIdEl.value = team ? team.id : '';
    if (teamNameEl) teamNameEl.value = team ? team.name : '';
    showModal(teamsBackdrop);
    try{ if (teamNameEl) teamNameEl.focus(); }catch(e){}
  }
  function closeTeams(){ hideModal(teamsBackdrop); }

  function buildTeamsList(){
    if (!teamsList) return;
    teamsList.innerHTML='';

    if (!state.teams.length){
      var div = document.createElement('div');
      div.className = 'roster-item';
      div.textContent = 'No teams yet — click New to create one.';
      teamsList.appendChild(div);
      return;
    }

    for (var i=0;i<state.teams.length;i++){
      (function(t){
        var row = document.createElement('div');
        row.className = 'roster-item';

        var left = document.createElement('div');
        left.className = 'roster-left';

        var title = document.createElement('div');
        title.className = 'roster-name';
        title.textContent = t.name;

        var meta = document.createElement('div');
        meta.className = 'roster-meta';
        meta.textContent = (t.players ? t.players.length : 0) + ' players';

        left.appendChild(title);
        left.appendChild(meta);

        var actions = document.createElement('div');
        actions.className = 'roster-actions';

        var selectBtn = document.createElement('button');
        selectBtn.type='button';
        selectBtn.className='btn secondary';
        selectBtn.textContent = (state.activeTeamId === t.id) ? 'Active' : 'Select';
        selectBtn.disabled = (state.activeTeamId === t.id);
        selectBtn.addEventListener('click', function(){
          state.activeTeamId = t.id;
          saveState();
          initTeamSelect();
          initMatchSelect();
          if (exportName) exportName.dataset.userEdited = '';
          syncExportNameDefault();
          renderTable();
          updateOnboardingAndControls();
          buildTeamsList();
        });

        var editBtn = document.createElement('button');
        editBtn.type='button';
        editBtn.className='btn';
        editBtn.textContent='Edit';
        editBtn.addEventListener('click', function(){
          if (teamIdEl) teamIdEl.value = t.id;
          if (teamNameEl) teamNameEl.value = t.name;
          try{ if (teamNameEl) teamNameEl.focus(); }catch(e){}
        });

        var delBtn = document.createElement('button');
        delBtn.type='button';
        delBtn.className='btn danger';
        delBtn.textContent='Delete';
        delBtn.addEventListener('click', function(){
          var ok = confirm('Delete team "' + t.name + '"? This removes the team, roster, and stats from this device.');
          if (!ok) return;
          state.teams = state.teams.filter(function(x){ return x.id !== t.id; });
          normalizeAllTeams(state);
          saveState();
          initTeamSelect();
          initMatchSelect();
          renderTable();
          updateOnboardingAndControls();
          buildTeamsList();
        });

        actions.appendChild(selectBtn);
        actions.appendChild(editBtn);
        actions.appendChild(delBtn);

        row.appendChild(left);
        row.appendChild(actions);
        teamsList.appendChild(row);
      })(state.teams[i]);
    }
  }

  if (teamsBtn) teamsBtn.addEventListener('click', openTeams);
  if (teamsClose) teamsClose.addEventListener('click', closeTeams);
  if (teamsDone) teamsDone.addEventListener('click', closeTeams);
  if (teamsBackdrop) teamsBackdrop.addEventListener('click', function(e){ if (e.target === teamsBackdrop) closeTeams(); });

  if (newTeamBtn) newTeamBtn.addEventListener('click', function(){
    if (teamIdEl) teamIdEl.value='';
    if (teamNameEl) teamNameEl.value='';
    try{ if (teamNameEl) teamNameEl.focus(); }catch(e){}
  });

  if (teamForm) teamForm.addEventListener('submit', function(e){
    e.preventDefault();
    var name = (teamNameEl && teamNameEl.value ? teamNameEl.value.trim() : 'Team');
    if (!name) name = 'Team';
    var id = (teamIdEl && teamIdEl.value ? teamIdEl.value : '');

    if (id){
      for (var i=0;i<state.teams.length;i++){
        if (state.teams[i].id === id){
          state.teams[i].name = name;
          break;
        }
      }
    } else {
      var t = newTeam(name);
      state.teams.push(t);
      state.activeTeamId = t.id;
    }

    normalizeAllTeams(state);
    saveState();
    initTeamSelect();
    initMatchSelect();
    if (exportName) exportName.dataset.userEdited = '';
    syncExportNameDefault();
    renderTable();
    updateOnboardingAndControls();
    buildTeamsList();
  });

  function downloadBlob(filename, text, mime){
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  }

  // Export/Import Team JSON
  if (exportTeamBtn) exportTeamBtn.addEventListener('click', function(){
    var team = activeTeam();
    if (!team) return;
    var payload = { version:'volleystat_team_v1', exportedAt:Date.now(), team:team };
    var fname = safeFile(team.name || 'team') + '_TeamExport.json';
    downloadBlob(fname, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  });

  if (importTeamBtn) importTeamBtn.addEventListener('click', function(){
    if (importTeamInput) importTeamInput.click();
  });

  if (importTeamInput) importTeamInput.addEventListener('change', function(){
    var file = importTeamInput.files && importTeamInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(){
      try{
        var parsed = JSON.parse(reader.result);
        var t = parsed && parsed.team ? parsed.team : parsed;
        if (!t || !t.name) throw new Error('Invalid team file');
        normalizeTeam(t);
        state.teams.push(t);
        state.activeTeamId = t.id;
        normalizeAllTeams(state);
        saveState();
        initTeamSelect();
        initMatchSelect();
        if (exportName) exportName.dataset.userEdited = '';
        syncExportNameDefault();
        renderTable();
        updateOnboardingAndControls();
        buildTeamsList();
        alert('Team imported successfully.');
      } catch(err){
        console.error(err);
        alert('Could not import team file. Please make sure you selected a valid team export.');
      } finally {
        importTeamInput.value = '';
      }
    };
    reader.readAsText(file);
  });

  // Roster modal
  function openRoster(){
    if (!rosterBackdrop) return;
    buildRosterList();
    loadPlayerIntoForm(null);
    showModal(rosterBackdrop);
    try{ if (playerNameEl) playerNameEl.focus(); }catch(e){}
  }
  function closeRoster(){ hideModal(rosterBackdrop); }

  function loadPlayerIntoForm(player){
    if (!playerIdEl || !playerNameEl || !playerNumberEl || !playerPosEl) return;
    if (!player){
      playerIdEl.value='';
      playerNameEl.value='';
      playerNumberEl.value='';
      playerPosEl.value='';
      return;
    }
    playerIdEl.value = player.id;
    playerNameEl.value = player.name || '';
    playerNumberEl.value = player.number || '';
    playerPosEl.value = player.position || '';
  }

  function buildRosterList(){
    if (!rosterList) return;
    rosterList.innerHTML='';
    var team = activeTeam();
    if (!team){
      var d = document.createElement('div');
      d.className='roster-item';
      d.textContent='No team selected.';
      rosterList.appendChild(d);
      return;
    }

    var players = (team.players || []).slice().sort(sortPlayers);
    if (!players.length){
      var div = document.createElement('div');
      div.className='roster-item';
      div.textContent='No players yet — add your first player above.';
      rosterList.appendChild(div);
      return;
    }

    for (var i=0;i<players.length;i++){
      (function(p){
        var row = document.createElement('div');
        row.className='roster-item';

        var left = document.createElement('div');
        left.className='roster-left';

        var title = document.createElement('div');
        title.className='roster-name';
        title.textContent = (p.number ? '#' + p.number + ' ' : '') + (p.name || '');

        var meta = document.createElement('div');
        meta.className='roster-meta';
        meta.textContent = p.position ? ('Pos: ' + p.position) : 'Pos: —';

        left.appendChild(title);
        left.appendChild(meta);

        var actions = document.createElement('div');
        actions.className='roster-actions';

        var editBtn = document.createElement('button');
        editBtn.type='button';
        editBtn.className='btn';
        editBtn.textContent='Edit';
        editBtn.addEventListener('click', function(){ loadPlayerIntoForm(p); try{ playerNameEl.focus(); }catch(e){} });

        var delBtn = document.createElement('button');
        delBtn.type='button';
        delBtn.className='btn danger';
        delBtn.textContent='Delete';
        delBtn.addEventListener('click', function(){
          var ok = confirm('Delete player "' + (p.name || '') + '"? Stats for this player will also be removed.');
          if (!ok) return;
          team.players = (team.players || []).filter(function(x){ return x.id !== p.id; });

          for (var mi=0; mi<(team.matches||[]).length; mi++){
            var m = team.matches[mi];
            if (!team.data || !team.data[m]) continue;
            for (var s=1;s<=3;s++){
              var ss = String(s);
              if (team.data[m][ss] && team.data[m][ss][p.id]) delete team.data[m][ss][p.id];
            }
          }

          team.history = (team.history || []).filter(function(h){ return h.playerId !== p.id; });
          saveState();
          loadPlayerIntoForm(null);
          buildRosterList();
          renderTable();
          updateOnboardingAndControls();
          if (rotationBackdrop && rotationBackdrop.style.display !== 'none') renderRotationWheel();
        });

        actions.appendChild(editBtn);
        actions.appendChild(delBtn);

        row.appendChild(left);
        row.appendChild(actions);
        rosterList.appendChild(row);
      })(players[i]);
    }
  }

  if (rosterBtn) rosterBtn.addEventListener('click', openRoster);
  if (rosterClose) rosterClose.addEventListener('click', closeRoster);
  if (rosterDone) rosterDone.addEventListener('click', closeRoster);
  if (rosterBackdrop) rosterBackdrop.addEventListener('click', function(e){ if (e.target === rosterBackdrop) closeRoster(); });

  if (newPlayerBtn) newPlayerBtn.addEventListener('click', function(){ loadPlayerIntoForm(null); try{ if (playerNameEl) playerNameEl.focus(); }catch(e){} });

  if (playerForm) playerForm.addEventListener('submit', function(e){
    e.preventDefault();
    var team = activeTeam();
    if (!team) return;

    var pid = playerIdEl && playerIdEl.value ? playerIdEl.value : '';
    var name = playerNameEl && playerNameEl.value ? playerNameEl.value.trim() : '';
    if (!name){ alert('Player name is required.'); return; }

    var num = playerNumberEl && playerNumberEl.value ? playerNumberEl.value.trim() : '';
    if (num && !/^[0-9]{1,2}$/.test(num)){ alert('Jersey number must be a number (0-99).'); return; }
    var pos = playerPosEl && playerPosEl.value ? playerPosEl.value.trim() : '';

    if (pid){
      for (var i=0;i<team.players.length;i++){
        if (team.players[i].id === pid){
          team.players[i].name = name;
          team.players[i].number = num;
          team.players[i].position = pos;
          break;
        }
      }
    } else {
      var p = { id: cryptoId(), name:name, number:num, position:pos };
      team.players.push(p);
      for (var mi=0; mi<team.matches.length; mi++){
        var m = team.matches[mi];
        for (var s=1;s<=3;s++) ensureCounters(team, m, String(s), p.id);
      }
    }

    normalizeTeam(team);
    saveState();
    loadPlayerIntoForm(null);
    buildRosterList();
    renderTable();
    updateOnboardingAndControls();
    if (rotationBackdrop && rotationBackdrop.style.display !== 'none') renderRotationWheel();
  });

  // Undo
  function undoLast(){
    var team = activeTeam();
    if (!team || !team.history || !team.history.length) return;

    var last = team.history.pop();
    var match = last.match;
    var set = last.set;
    var pid = last.playerId;
    var action = last.action;

    ensureCounters(team, match, set, pid);
    var counters = team.data[match][set][pid];
    if (counters && counters[action] !== undefined){
      counters[action] = Math.max(0, nz(counters[action],0) - 1);
      // Undo linked auto-error if the last history entry was an auto one
      var linkedErr = null;
      if (action === 'serveOut')  linkedErr = 'errServing';
      if (action === 'swingOut')  linkedErr = 'errHitting';
      if (action === 'passShank') linkedErr = 'errPassing';
      if (linkedErr && counters[linkedErr] !== undefined){
        // Only undo the auto entry if the next entry in history (already popped) was auto-linked
        counters[linkedErr] = Math.max(0, nz(counters[linkedErr],0) - 1);
        // Remove the auto history entry if it's sitting on top
        if (team.history.length && team.history[team.history.length-1].auto && team.history[team.history.length-1].action === linkedErr){
          team.history.pop();
        }
      }
      // Undo possession / rotation state
      ensureRotation(team);
      var undoWasWin  = (action === 'kill' || action === 'ace');
      var undoWasLose = (action === 'serveOut' || action === 'swingOut' || action === 'passShank' ||
                         action === 'errPassing' || action === 'errNet' || action === 'errTwoHand' ||
                         action === 'errRotation');
      if (undoWasWin && team.rotation.hasBall){
        // That win may have been a side-out rotate — reverse the offset and give serve back to opponent
        team.rotation.offset = ((team.rotation.offset || 0) - 1 + 6) % 6;
        team.rotation.hasBall = false;
      } else if (undoWasLose){
        // Undo the loss — serve returns to us
        team.rotation.hasBall = true;
      }
    }

    saveState();
    renderTable();
    updateOnboardingAndControls();
    if (rotationBackdrop && rotationBackdrop.style.display !== 'none') renderRotationWheel();
  }
  if (undoBtn) undoBtn.addEventListener('click', undoLast);

  // ── Edit / correct any stat for a player ────────────────────────────────
  var editBackdrop = byId('editBackdrop');
  var editPlayerName = byId('editPlayerName');
  var editGrid = byId('editGrid');
  var editClose = byId('editClose');
  var editDone = byId('editDone');

  function openEditModal(){
    var team = activeTeam();
    if (!team || !team.players || !team.players.length) return;
    buildEditGrid();
    // Update modal title with current context
    var titleEl = byId('editModalTitle');
    if (titleEl){
      var match = getMatchKey();
      var set = setSelect.value || '1';
      titleEl.textContent = 'Edit Stats — ' + match + ' Set ' + set + ' — tap to subtract 1';
    }
    showModal(editBackdrop);
  }
  function closeEditModal(){ hideModal(editBackdrop); }

  var COUNTER_LABELS = {
    serve1:'Serve 1', serve2:'Serve 2', serve3:'Serve 3', ace:'ACE', serveOut:'Serve OUT',
    passToTarget:'Pass 3', passNearTarget:'Pass 2', passAwayTarget:'Pass 1', passShank:'Pass 0',
    swing:'Swing', swingOut:'Swing Out', kill:'Kill',
    errHitting:'Hit Error', errServing:'Srv Error', errPassing:'Pass Error',
    errNet:'In Net', errTwoHand:'Two Hand', errRotation:'Out of Rotation'
  };

  function buildEditGrid(){
    if (!editGrid) return;
    editGrid.innerHTML = '';
    var team = activeTeam();
    if (!team) return;
    var players = (team.players || []).slice().sort(sortPlayers);
    var match = getMatchKey();
    var set = setSelect.value || '1';
    var hasAnything = false;

    players.forEach(function(p){
      var counters = (((team.data || {})[match] || {})[set] || {})[p.id] || {};
      var keys = Object.keys(COUNTER_LABELS);

      // Only show stats > 0
      var activeKeys = keys.filter(function(k){ return nz(counters[k], 0) > 0; });
      if (!activeKeys.length) return; // skip players with no stats

      hasAnything = true;
      var section = document.createElement('div');
      section.style.cssText = 'margin-bottom:18px;';

      var nameEl = document.createElement('div');
      nameEl.style.cssText = 'font-weight:900;font-size:14px;margin-bottom:8px;padding:6px 0;border-bottom:1px solid #e5e7eb;';
      nameEl.textContent = (p.number ? '#'+p.number+' ' : '') + p.name;
      section.appendChild(nameEl);

      var grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:6px;';

      activeKeys.forEach(function(key){
        var val = nz(counters[key], 0);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;font-weight:700;';
        btn.innerHTML = '<span>' + COUNTER_LABELS[key] + '</span><span style="background:#dbeafe;color:#1e3a8a;border-radius:5px;padding:2px 8px;min-width:28px;text-align:center;font-weight:900;">' + val + '</span>';

        btn.addEventListener('click', function(){
          var team2 = activeTeam();
          if (!team2) return;
          ensureCounters(team2, match, set, p.id);
          var c = team2.data[match][set][p.id];
          if (nz(c[key], 0) <= 0) return;
          c[key] = c[key] - 1;
          var hist = team2.history;
          for (var hi = hist.length-1; hi >= 0; hi--){
            if (hist[hi].playerId === p.id && hist[hi].action === key && hist[hi].match === match && hist[hi].set === set){
              hist.splice(hi, 1);
              break;
            }
          }
          saveState();
          renderTable();
          updateOnboardingAndControls();
          var newVal = nz(team2.data[match][set][p.id][key], 0);
          if (newVal <= 0){
            // Remove this button — stat is now 0
            btn.parentNode && btn.parentNode.removeChild(btn);
            // If no buttons left in grid, remove the whole player section
            if (!grid.children.length) section.parentNode && section.parentNode.removeChild(section);
          } else {
            btn.innerHTML = '<span>' + COUNTER_LABELS[key] + '</span><span style="background:#dbeafe;color:#1e3a8a;border-radius:5px;padding:2px 8px;min-width:28px;text-align:center;font-weight:900;">' + newVal + '</span>';
          }
        });

        grid.appendChild(btn);
      });

      section.appendChild(grid);
      editGrid.appendChild(section);
    });

    // Show message if nothing to edit
    if (!hasAnything){
      var msg = document.createElement('div');
      msg.style.cssText = 'text-align:center;color:#6b7280;font-size:14px;padding:24px 0;';
      msg.textContent = 'No stats recorded yet for this set.';
      editGrid.appendChild(msg);
    }
  }

  if (editClose) editClose.addEventListener('click', closeEditModal);
  if (editDone) editDone.addEventListener('click', closeEditModal);
  if (editBackdrop) editBackdrop.addEventListener('click', function(e){ if(e.target===editBackdrop) closeEditModal(); });
  document.addEventListener('keydown', function(e){ if (editBackdrop && !editBackdrop.classList.contains('hidden') && e.key==='Escape') closeEditModal(); });

  var editBtn = byId('editBtn');
  if (editBtn) editBtn.addEventListener('click', openEditModal);
  var mobileEditBtn = byId('mobileEditBtn');
  if (mobileEditBtn) mobileEditBtn.addEventListener('click', openEditModal);

  // Export (respects View)
  function exportCsvText(){
    var team = activeTeam();
    if (!team) return '';

    var players = (team.players || []).slice().sort(sortPlayers);

    var headers;
    if (uiMode === 'coach'){
      headers = [
        'Jersey', 'Player', 'Pos',
        'Opp SR Att', 'Opp SR In', 'Opp OOS%',
        'Our SR Att', 'Our SR Avg',
        'Hit Att', 'Hit Avg', 'Hits In', 'Hits In%',
        'Total Errors', 'Hit Errors', 'Serve Errors', 'Pass Errors', 'In the Net', 'Two Hand', 'Out of Rotation'
      ];
    } else {
      headers = [
        'Jersey', 'Player', 'Pos',
        'Serve Att', 'Serves In', 'Serve In %',
        'Aces', 'Ace%',
        'Pass Att', 'Pass Avg',
        'Hit Att', 'Hit Avg', 'Hits In', 'Hits In%',
        'Total Errors', 'Hit Errors', 'Serve Errors', 'Pass Errors', 'In the Net', 'Two Hand', 'Out of Rotation'
      ];
    }

    var out = [];
    out.push(headers.map(csv).join(','));

    for (var i=0;i<players.length;i++){
      var p = players[i];
      var d = derived(p.id);
      if (uiMode === 'coach'){
        out.push([
          p.number || '', p.name || '', p.position || '',
          d.oppRecAtt, d.oppRecAtt, fmtPct(d.oppOosPct),
          d.passAtt, fmtNum(d.passAvg,2),
          d.hitAtt, fmtNum(d.hitAvg,3), d.hitsIn, fmtPct(d.hitsInPct),
          d.totalErrors, d.errHitting, d.errServing, d.errPassing, d.errNet, d.errTwoHand, d.errRotation
        ].map(csv).join(','));
      } else {
        out.push([
          p.number || '', p.name || '', p.position || '',
          d.serveAttPlayer, d.serveIn, fmtPct(d.serveInPct),
          d.aceCount, fmtPct(d.acePctPlayer),
          d.passAtt, fmtNum(d.passAvg,2),
          d.hitAtt, fmtNum(d.hitAvg,3), d.hitsIn, fmtPct(d.hitsInPct),
          d.totalErrors, d.errHitting, d.errServing, d.errPassing, d.errNet, d.errTwoHand, d.errRotation
        ].map(csv).join(','));
      }
    }

    out.push('');
    out.push(csv('Scope') + ',' + csv(getExportContextLabel()));
    out.push(csv('Team') + ',' + csv(team.name || 'Team'));
    out.push(csv('Mode') + ',' + csv(uiMode));
    out.push(csv('View') + ',' + csv(getViewLabel()));

    // Add scores section
    var scoreKeys = Object.keys(scoreStore || {}).sort();
    if (scoreKeys.length) {
      out.push('');
      out.push(csv('SCORES'));
      out.push([csv('Context'), csv('Our Score'), csv('Opponent Score')].join(','));
      scoreKeys.forEach(function(k) {
        var sc = scoreStore[k];
        if (sc && (sc.our > 0 || sc.opp > 0)) {
          out.push([csv(k), csv(sc.our), csv(sc.opp)].join(','));
        }
      });
    }

    return out.join('\n');
  }

  async function runExport(){
    var team = activeTeam();
    if (!team) return;

    var base = exportName && exportName.value.trim() ? exportName.value.trim() : defaultExportBaseName();
    var filename = safeFile(base) + '.csv';

    var ok = await openExportConfirmModal({
      filename: filename,
      teamName: team.name || 'Team',
      viewLabel: getViewLabel(),
      scopeLabel: getExportContextLabel()
    });
    if (!ok) return;

    var csvText = exportCsvText();
    downloadBlob(filename, csvText, 'text/csv;charset=utf-8');
  }

  if (exportBtn) exportBtn.addEventListener('click', runExport);

  // ── Report page ────────────────────────────────────────────────────────────
  function openReport() {
    var team = activeTeam();
    if (!team) return;
    var reportData = {
      teams: state.teams,
      activeTeamId: state.activeTeamId,
      scoreStore: scoreStore || {},
      extraDays: []
    };
    localStorage.setItem('volleystat_report_data', JSON.stringify(reportData));
    window.open('report.html', '_blank');
  }
  window._vsOpenReport = openReport;

  // RESET (Current Team Only, Option B) — modal confirmation
  if (resetBtn){
    resetBtn.addEventListener('click', async function(){
      var team = activeTeam();
      if (!team) return;

      var choice = await openResetConfirmModal({
        teamName: team.name || 'Team',
        scope: 'ALL matches and sets (current team only). Team + roster are preserved.',
        rotation: 'Assignments kept. Rotation resets to starting position (offset = 0).'
      });

      if (choice === 'export'){
        try{ await runExport(); }catch(e){}
        return;
      }
      if (!choice) return;

      team.data = buildEmptyData(team.players || [], team.matches && team.matches.length ? team.matches : DEFAULT_MATCHES);
      team.history = [];

      ensureRotation(team);
      team.rotation.offset = 0;
      team.rotation.hasBall = true;

      // Clear all scores for this team
      scoreStore = {};
      saveScore();

      saveState();
      renderTable();
      updateOnboardingAndControls();
      if (exportName) exportName.dataset.userEdited = '';
      syncExportNameDefault();
      populateMobilePlayerSelect();
      renderScore();
    });
  }

  // Select change events
  if (daySelect) daySelect.addEventListener('change', function(){
    var mobileDayEl = byId('mobileDaySelect');
    if (mobileDayEl) mobileDayEl.value = daySelect.value;
    renderTable();
    syncExportNameDefault();
    renderScore(); // load score for this day
  });

  // Add Day button — appends a new day option to both day selects
  function addDay(){
    var current = [];
    for (var i=0; i<daySelect.options.length; i++) current.push(daySelect.options[i].value);
    var nextNum = current.length + 1;
    var newDay = 'Day ' + nextNum;
    if (current.indexOf(newDay) >= 0){ alert('Day ' + nextNum + ' already exists.'); return; }
    // Add to DEFAULT_DAYS so buildEmptyData covers it
    DEFAULT_DAYS.push(newDay);
    // Add option to desktop select
    var opt = document.createElement('option');
    opt.value = newDay; opt.textContent = newDay;
    daySelect.appendChild(opt);
    // Add option to mobile select
    var mds = byId('mobileDaySelect');
    if (mds){ var mopt = document.createElement('option'); mopt.value=newDay; mopt.textContent=newDay; mds.appendChild(mopt); }
    // Select the new day
    daySelect.value = newDay;
    if (mds) mds.value = newDay;
    // Ensure data structure exists for new day
    var team = activeTeam();
    if (team){
      normalizeTeam(team);
      saveState();
    }
    renderTable();
    syncExportNameDefault();
    renderScore();
  }

  // Add Match button — appends a new match option to team.matches
  function addMatch(){
    var team = activeTeam();
    if (!team) return;
    var nextNum = team.matches.length + 1;
    var newMatch = 'Match ' + nextNum;
    if (team.matches.indexOf(newMatch) >= 0){ alert('Match ' + nextNum + ' already exists.'); return; }
    team.matches.push(newMatch);
    normalizeTeam(team);
    saveState();
    initMatchSelect();
    // Select the new match
    matchSelect.value = newMatch;
    var mms = byId('mobileMatchSelect');
    if (mms) mms.value = newMatch;
    renderTable();
    syncExportNameDefault();
  }

  var addDayBtn = byId('addDayBtn');
  if (addDayBtn) addDayBtn.addEventListener('click', addDay);
  var mobileAddDayBtn = byId('mobileAddDayBtn');
  if (mobileAddDayBtn) mobileAddDayBtn.addEventListener('click', addDay);

  var addMatchBtn = byId('addMatchBtn');
  if (addMatchBtn) addMatchBtn.addEventListener('click', addMatch);
  var mobileAddMatchBtn = byId('mobileAddMatchBtn');
  if (mobileAddMatchBtn) mobileAddMatchBtn.addEventListener('click', addMatch);
  matchSelect.addEventListener('change', function(){
    renderTable();
    syncExportNameDefault();
    renderScore(); // load score for this match
  });
  setSelect.addEventListener('change', function(){
    renderTable();
    syncExportNameDefault();
    renderScore(); // load score for this set
  });
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

  // Initial paint
  initTeamSelect();
  initMatchSelect();
  applyModeToUI();
  syncExportNameDefault();
  renderTable();
  updateOnboardingAndControls();

  // ── Firebase sync bootstrap ────────────────────────────────────────────────
  import('./firebase-sync.js').then(function(fb) {
    window._firebaseSave = fb.firebaseSave;

    // ── Auth gate — show/hide overlay instead of redirecting ────────────────
    fb.onAuthReady(function(user) {
      var appWrap = document.querySelector('.page-wrap');
      var loginOverlay = byId('loginOverlay');
      var playerStripEl = byId('playerStrip');
      var scorebar = document.querySelector('.score-bar');
      var syncbar = byId('syncBar');

      if (!user) {
        // Show login overlay, hide app content
        if (appWrap) appWrap.style.display = 'none';
        if (playerStripEl) playerStripEl.style.display = 'none';
        if (scorebar) scorebar.style.display = 'none';
        if (loginOverlay) loginOverlay.style.display = 'flex';
        return;
      }

      // Signed in — hide overlay, show app
      if (loginOverlay) loginOverlay.style.display = 'none';
      if (appWrap) appWrap.style.display = '';
      if (playerStripEl) playerStripEl.style.display = '';
      if (scorebar) scorebar.style.display = '';

      // Register session immediately on login with current team name
      var currentTeam = activeTeam();
      if (currentTeam && currentTeam.name) fb.registerSession(currentTeam.name);

      // Show welcome message if arriving from a forked share
      var urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('forked') === '1') {
        // Clean the URL
        window.history.replaceState({}, '', window.location.pathname);
        // Show a brief notice
        var notice = document.createElement('div');
        notice.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);background:#16a34a;color:#fff;padding:10px 20px;border-radius:10px;font-size:13px;font-weight:700;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.2);';
        notice.textContent = 'Session forked to your account — you now have your own independent copy!';
        document.body.appendChild(notice);
        setTimeout(function(){ notice.style.opacity='0'; notice.style.transition='opacity .5s'; setTimeout(function(){ notice.parentNode && notice.parentNode.removeChild(notice); }, 500); }, 4000);
      }

      // Show user email in sync bar
      var emailEl = byId('userEmailDisplay');
      if (emailEl) emailEl.textContent = user.email || user.displayName || '';
      var syncEmailEl = byId('syncUserEmail');
      if (syncEmailEl) syncEmailEl.textContent = user.email || user.displayName || '';

      // Sign out button
      // signOut handled via window._vsSignOut global

      // ── Share buttons ───────────────────────────────────────────────────────
      function getShareScope() {
        var day   = daySelect ? daySelect.value : 'Day 1';
        var match = matchSelect ? matchSelect.value : 'Match 1';
        var set   = setSelect ? setSelect.value : '1';
        var view  = viewSelect ? viewSelect.value : 'tournament';
        return { day, match, set, scope: view === 'tournament' ? 'all' : view === 'match' ? 'match' : 'set' };
      }

      function getShareUrl(token) {
        return window.location.origin + '/share.html?share=' + token;
      }

      function copyToClipboard(text) {
        if (navigator.clipboard) return navigator.clipboard.writeText(text);
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
        return Promise.resolve();
      }

      async function renderActiveShares() {
        var listEl = byId('activeSharesList');
        if (!listEl) return;
        var shares = await fb.listShares();
        if (!shares.length) { listEl.innerHTML = '<div style="color:rgba(255,255,255,.4);font-size:11px;margin-top:4px;">No active shares</div>'; return; }
        listEl.innerHTML = '';
        shares.forEach(function(s) {
          var row = document.createElement('div');
          row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,.08);border-radius:8px;padding:7px 10px;margin-top:6px;gap:8px;';
          var label = s.type === 'player' ? ('👤 ' + (s.playerName||'Player')) : '👥 Full Team';
          var scope = s.scope === 'all' ? 'All data' : s.scope === 'match' ? s.day+' · '+s.match : s.day+' · '+s.match+' Set '+s.set;
          row.innerHTML = '<div style="flex:1;"><div style="color:#fff;font-size:12px;font-weight:700;">'+label+'</div><div style="color:rgba(255,255,255,.5);font-size:10px;">'+scope+'</div></div>';
          var btns = document.createElement('div');
          btns.style.cssText = 'display:flex;gap:5px;';
          var copyBtn = document.createElement('button');
          copyBtn.textContent = 'Copy Link';
          copyBtn.style.cssText = 'background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:6px;padding:4px 8px;font-size:11px;font-weight:700;cursor:pointer;';
          copyBtn.setAttribute('onclick', 'window._vsCopyShare(\'' + getShareUrl(s.token) + '\', this)');
          var revokeBtn = document.createElement('button');
          revokeBtn.textContent = 'Revoke';
          revokeBtn.setAttribute('onclick', 'window._vsRevokeShare(\'' + s.token + '\')');
          revokeBtn.style.cssText = 'background:rgba(220,38,38,.3);border:none;color:#fff;border-radius:6px;padding:4px 8px;font-size:11px;font-weight:700;cursor:pointer;';
          btns.appendChild(copyBtn);
          btns.appendChild(revokeBtn);
          row.appendChild(btns);
          listEl.appendChild(row);
        });
      }

      async function createAndCopyShare(opts) {
        try {
          var token = await fb.createShare(opts);
          var url = getShareUrl(token);
          await copyToClipboard(url);
          alert('Share link copied! Send this to the recipient: ' + url);
          renderActiveShares();
        } catch(e) {
          alert('Could not create share: ' + e.message);
        }
      }

      // Load active shares when panel opens
      document.querySelector('.sync-settings-btn').addEventListener('click', function() {
        setTimeout(renderActiveShares, 100);
      });

      // ── Existing Firebase load/listen (now inside auth gate) ──────────────
      fb.firebaseLoad().then(function(remote) {
      if (remote && remote.teams) {
        var local = loadState();
        var useRemote = !local.teams || !local.teams.length ||
          (remote.teams && remote.teams.length >= local.teams.length);
        if (useRemote) {
          state = remote;
          normalizeAllTeams(state);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          initTeamSelect();
          initMatchSelect();
          applyModeToUI();
          syncExportNameDefault();
          renderTable();
          updateOnboardingAndControls();
          populateMobilePlayerSelect();
          // Re-register session so it appears in dropdown with current team name
          var activeT = state.teams && state.teams.length
            ? (state.teams.find(function(t){ return t.id === state.activeTeamId; }) || state.teams[0])
            : null;
          if (activeT && activeT.name) fb.registerSession(activeT.name);
        }
      }
      // Start real-time listener — wrapped so permissions errors don't crash app
      try {
        fb.firebaseListen(function(remoteState) {
          state = remoteState;
          normalizeAllTeams(state);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          initTeamSelect();
          initMatchSelect();
          renderTable();
          updateOnboardingAndControls();
          populateMobilePlayerSelect();
          renderScore();
        });
      } catch(listenErr) {
        console.warn('[VolleyStat] Listener setup failed:', listenErr.message);
      }
    }).catch(function(e) {
      console.warn('[VolleyStat] Firebase load failed, using local data:', e);
    });

    // Wire up device ID panel buttons
    // Device ID buttons handled via window._vs* globals

    // ── Session dropdown — use event delegation on document ──────────────────
    // (byId may return null if panel not yet visible when listener attaches)
    var sessionDropdown = byId('sessionDropdown');
    var mySessionLabel = byId('mySessionLabel');

    // Populate session list
    async function loadSessionList() {
      var sessionDropdown = byId('sessionDropdown');
      if (!sessionDropdown) return;
      try {
      sessionDropdown.innerHTML = '<option value="">Loading sessions…</option>';
      var sessions = await fb.listSessions();
      sessionDropdown.innerHTML = '<option value="">— select a session —</option>';
      if (!sessions.length) {
        sessionDropdown.innerHTML = '<option value="">No sessions found yet — tap Refresh</option>';
        return;
      }
      sessions.forEach(function(s) {
        var opt = document.createElement('option');
        opt.value = s.userId || s.deviceId;
        var currentUid = fb.getCurrentUser() ? fb.getCurrentUser().uid : null;
        var isMine = currentUid && s.userId === currentUid;
        opt.textContent = (isMine ? '★ ' : '') + s.label + (isMine ? ' (this device)' : '');
        if (isMine) {
          opt.style.fontWeight = '900';
          opt.textContent += ' (you)';
          if (mySessionLabel) mySessionLabel.textContent = s.label;
        }
        sessionDropdown.appendChild(opt);
      });
      // Pre-select own session
      // Don't pre-select — user must choose explicitly
      sessionDropdown.value = '';
      } catch(e) { console.warn('[VolleyStat] loadSessionList error:', e.message); }
    }

    // Load sessions when panel opens
    var syncSettingsBtn = document.querySelector('.sync-settings-btn');
    if (syncSettingsBtn) syncSettingsBtn.addEventListener('click', async function() {
      var t = activeTeam();
      if (t && t.name) fb.registerSession(t.name);
      setTimeout(loadSessionList, 300);
    });



    // Connect to selected session
    async function doConnectSession() {
      var sd = byId('sessionDropdown');
      if (!sd) return;
      var idx = sd.selectedIndex;
      var selected = (idx > 0 && sd.options[idx]) ? sd.options[idx].value : '';
      if (!selected) {
        await vsConfirm('Please select a session from the dropdown first. Click OK to dismiss.');
        return;
      }
      var selectedText = sd.options[idx].text;
      if (!await vsConfirm('Connect to:<br><strong>' + selectedText + '</strong><br><br>This will load that session on this device.')) return;
      // Show loading state
      function setConnectBtn(text, disabled) {
        var btn = byId('connectSessionBtn'); if(btn){ btn.textContent = text; btn.disabled = disabled; }
      }
      setConnectBtn('Loading...', true);
      try {
        var remoteState = await fb.firebaseLoadFrom(selected);
        if (!remoteState) {
          await vsConfirm('Could not load that session. It may have no data yet. Click OK to dismiss.');
          setConnectBtn('Connect to Selected Session', false);
          return;
        }
        // Apply remote state
        state = remoteState;
        normalizeAllTeams(state);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        initTeamSelect();
        initMatchSelect();
        applyModeToUI();
        syncExportNameDefault();
        renderTable();
        updateOnboardingAndControls();
        populateMobilePlayerSelect();
        renderScore();
        // Live listener for updates from that user
        fb.firebaseListenTo(selected, function(updatedState) {
          state = updatedState;
          normalizeAllTeams(state);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          initTeamSelect();
          initMatchSelect();
          renderTable();
          updateOnboardingAndControls();
          populateMobilePlayerSelect();
          renderScore();
        });
        // Close panel and reset button
        var panel = byId('syncDevicePanel');
        if (panel) panel.classList.add('hidden');
        setConnectBtn('Connect to Selected Session', false);
      } catch(e) {
        console.error('[VolleyStat] Connect error:', e);
        await vsConfirm('Error connecting: ' + e.message + '. Click OK to dismiss.');
        setConnectBtn('Connect to Selected Session', false);
      }
    }

    // ── Global window functions for sync panel buttons ───────────────────────
    // Use custom confirm instead of browser confirm() which may be blocked
    function vsConfirm(msg) {
      return new Promise(function(resolve) {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';
        var box = document.createElement('div');
        box.style.cssText = 'background:#fff;border-radius:12px;padding:20px;max-width:380px;width:100%;box-shadow:0 8px 30px rgba(0,0,0,.2);';
        box.innerHTML = '<div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:16px;line-height:1.4;">' + msg + '</div>' +
          '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
          '<button id="_vsCancelBtn" style="border:1px solid #e5e7eb;background:#f9fafb;color:#374151;padding:8px 16px;border-radius:8px;font-weight:700;cursor:pointer;font-size:13px;">Cancel</button>' +
          '<button id="_vsOkBtn" style="border:none;background:#1e3a8a;color:#fff;padding:8px 16px;border-radius:8px;font-weight:700;cursor:pointer;font-size:13px;">OK</button>' +
          '</div>';
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        function cleanup(result) { document.body.removeChild(overlay); resolve(result); }
        box.querySelector('#_vsOkBtn').addEventListener('click', function(){ cleanup(true); });
        box.querySelector('#_vsCancelBtn').addEventListener('click', function(){ cleanup(false); });
      });
    }
    window._vsRefreshSessions = async function() {
      var t = activeTeam();
      if (t && t.name) await fb.registerSession(t.name);
      loadSessionList();
    };

    window._vsConnectSession = function() { doConnectSession(); };

    window._vsSignOut = async function() { if (!await vsConfirm('Sign out of VolleyStat?')) return; await fb.signOutUser(); };

    window._vsShareTeam = async function() {
      var team = activeTeam();
      if (!team) { alert('Add a team first.'); return; }
      var s = getShareScope();
      var scopeLabel = s.scope === 'all' ? 'full tournament' : s.scope === 'match' ? s.day+' - '+s.match : s.day+' - '+s.match+' Set '+s.set;
      if (!await vsConfirm('Share full team stats (' + scopeLabel + ')?<br><br>When the recipient opens the link, a <strong>full independent copy</strong> of your current session will be created in their account. They can record stats independently.')) return;
      await createAndCopyShare({ type:'team', scope:s.scope, day:s.day, match:s.match, set:s.set, teamName: team.name||'' });
    };

    window._vsSharePlayer = async function() {
      var team2 = activeTeam();
      if (!team2 || !team2.players || !team2.players.length) { alert('Add players to your roster first.'); return; }
      var players = team2.players.slice().sort(function(a,b){ return (parseInt(a.number)||999)-(parseInt(b.number)||999)||(a.name||'').localeCompare(b.name||''); });
      var opts = players.map(function(p){ return (p.number?'#'+p.number+' ':'')+p.name; });
      var choice = window.prompt('Enter player number or name to share: ' + opts.join(', '));
      if (!choice) return;
      var player = players.find(function(p){ return (p.number&&p.number===choice.replace('#','').trim())||(p.name&&p.name.toLowerCase().includes(choice.toLowerCase())); });
      if (!player) { alert('Player not found.'); return; }
      var s2 = getShareScope();
      if (!await vsConfirm('Share stats for ' + player.name + '? A link will be copied to your clipboard.')) return;
      await createAndCopyShare({ type:'player', playerId:player.id, playerName:player.name, scope:s2.scope, day:s2.day, match:s2.match, set:s2.set, teamName: team2.name||'' });
    };

    window._vsShowQr = function() {
      var wrap = byId('qrCodeWrap');
      var btn = document.querySelector('[onclick="window._vsShowQr()"]');
      if (!wrap) return;
      if (wrap.style.display === 'flex') {
        wrap.style.display = 'none';
        if (btn) btn.textContent = 'Show QR';
        return;
      }
      if (!window._qrGenerated && window.QRCode) {
        var canvas = byId('qrCanvas');
        if (canvas) {
          canvas.innerHTML = '';
          var u = fb.getCurrentUser();
          new window.QRCode(canvas, { text: u ? u.uid : 'no-user', width:160, height:160, colorDark:'#1e3a8a', colorLight:'#ffffff' });
          window._qrGenerated = true;
        }
      }
      wrap.style.display = 'flex';
      if (btn) btn.textContent = 'Hide QR';
    };

    window._vsScanQr = function() {
      if (!window.BarcodeDetector) { alert('QR scanning requires Chrome on Android. Use manual ID entry instead.'); return; }
      window._barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
      var scanWrap = byId('scanWrap');
      var video = byId('qrVideo');
      if (!scanWrap || !video) return;
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(function(stream) {
          window._scanStream = stream;
          video.srcObject = stream;
          scanWrap.style.display = 'block';
          window._scanInterval = setInterval(function() {
            if (!video || video.readyState < 2) return;
            var canvas = document.createElement('canvas');
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            canvas.getContext('2d').drawImage(video, 0, 0);
            window._barcodeDetector.detect(canvas).then(function(codes) {
              if (codes && codes.length && codes[0].rawValue) {
                window._vsCancelScan();
                vsConfirm('Connect to scanned QR session?').then(function(ok){ if(ok) window._vsSwitchDevice && (byId('switchDeviceInput').value = codes[0].rawValue) && window._vsSwitchDevice(); });
              }
            }).catch(function(){});
          }, 500);
        })
        .catch(function() { alert('Camera access denied.'); });
    };

    window._vsCancelScan = function() {
      if (window._scanStream) { window._scanStream.getTracks().forEach(function(t){t.stop();}); window._scanStream = null; }
      if (window._scanInterval) { clearInterval(window._scanInterval); window._scanInterval = null; }
      var sw = byId('scanWrap'); if (sw) sw.style.display = 'none';
    };

    window._vsCopyDeviceId = function() {
      var u = fb.getCurrentUser();
      if (!u) return;
      navigator.clipboard && navigator.clipboard.writeText(u.uid).then(function() {
        var btn = document.querySelector('[onclick="window._vsCopyDeviceId()"]');
        if (btn) { btn.textContent = 'Copied!'; setTimeout(function(){ btn.textContent = 'Copy'; }, 2000); }
      });
    };

    window._vsSwitchDevice = async function() {
      var input = byId('switchDeviceInput');
      if (!input || !input.value.trim()) return;
      var id = input.value.trim();
      if (!await vsConfirm('Load data from device/session ID:<br><strong>' + id + '</strong>')) return;
      var btn = byId('switchDeviceBtn');
      if (btn) { btn.textContent = 'Loading...'; btn.disabled = true; }
      try {
        var remoteState = await fb.firebaseLoadFrom(id);
        if (!remoteState) {
          await vsConfirm('No data found for that ID. It may be a different format or empty.');
          if (btn) { btn.textContent = 'Switch'; btn.disabled = false; }
          return;
        }
        state = remoteState;
        normalizeAllTeams(state);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        initTeamSelect(); initMatchSelect(); applyModeToUI();
        syncExportNameDefault(); renderTable();
        updateOnboardingAndControls(); populateMobilePlayerSelect(); renderScore();
        // Save to current user's Firebase so it becomes their active session
        fb.firebaseSave(state);
        var panel = byId('syncDevicePanel');
        if (panel) panel.classList.add('hidden');
        if (btn) { btn.textContent = 'Switch'; btn.disabled = false; }
        input.value = '';
      } catch(e) {
        await vsConfirm('Error loading: ' + e.message);
        if (btn) { btn.textContent = 'Switch'; btn.disabled = false; }
      }
    };

    // Revoke/copy share — called from dynamically created buttons
    window._vsRevokeShare = async function(token) {
      if (!await vsConfirm('Revoke this share? The recipient will lose access immediately.')) return;
      await fb.revokeShare(token);
      renderActiveShares();
    };
    window._vsMigrateSession = async function() {
      var input = byId('switchDeviceInput');
      if (!input || !input.value.trim()) {
        await vsConfirm('Paste an old Device ID in the field first, then click Migrate.');
        return;
      }
      var id = input.value.trim();
      if (!await vsConfirm('Migrate old session <strong>' + id.substring(0,16) + '...</strong> into your account?<br><br>This copies the old data to your account and registers it in the session list.')) return;
      var btn = document.querySelector('[onclick="window._vsMigrateSession()"]');
      if (btn) { btn.textContent = 'Migrating...'; btn.disabled = true; }
      try {
        var migrated = await fb.migrateOldSession(id);
        if (!migrated) {
          await vsConfirm('No data found for that Device ID. Check the ID and try again.');
          if (btn) { btn.textContent = 'Migrate'; btn.disabled = false; }
          return;
        }
        state = migrated;
        normalizeAllTeams(state);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        initTeamSelect(); initMatchSelect(); applyModeToUI();
        syncExportNameDefault(); renderTable();
        updateOnboardingAndControls(); populateMobilePlayerSelect(); renderScore();
        input.value = '';
        var panel = byId('syncDevicePanel');
        if (panel) panel.classList.add('hidden');
        if (btn) { btn.textContent = 'Migrate'; btn.disabled = false; }
      } catch(e) {
        await vsConfirm('Migration error: ' + e.message);
        if (btn) { btn.textContent = 'Migrate'; btn.disabled = false; }
      }
    };

    window._vsCopyShare = function(url, btn) {
      copyToClipboard(url).then(function() {
        btn.textContent = 'Copied!';
        setTimeout(function(){ btn.textContent = 'Copy Link'; }, 2000);
      });
    };

    // Initial session label — after _vs functions are defined
    loadSessionList();

    // ── QR Code: Show my ID as QR ────────────────────────────────────────────
    var showQrBtn = byId('showQrBtn');      }); // end onAuthReady

    // ── Login overlay button wiring ───────────────────────────────────────────
    function showLoginError(msg) {
      var el = byId('loginError');
      if (el) { el.textContent = msg; el.classList.add('visible'); }
    }
    function clearLoginError() {
      var el = byId('loginError');
      if (el) el.classList.remove('visible');
    }

    var loginGoogleBtn = byId('loginGoogleBtn');
    if (loginGoogleBtn) loginGoogleBtn.addEventListener('click', async function() {
      clearLoginError();
      try { await fb.signInWithGoogle(); }
      catch(e) { showLoginError('Google sign-in failed: ' + e.message); }
    });

    var loginSigninBtn = byId('loginSigninBtn');
    if (loginSigninBtn) loginSigninBtn.addEventListener('click', async function() {
      clearLoginError();
      var email = (byId('loginEmail') || {}).value || '';
      var pass  = (byId('loginPassword') || {}).value || '';
      if (!email || !pass) { showLoginError('Please enter your email and password.'); return; }
      loginSigninBtn.disabled = true;
      try { await fb.signInWithEmail(email, pass); }
      catch(e) {
        showLoginError(e.code === 'auth/invalid-credential' ? 'Incorrect email or password.' : e.message);
        loginSigninBtn.disabled = false;
      }
    });

    var loginCreateBtn = byId('loginCreateBtn');
    if (loginCreateBtn) loginCreateBtn.addEventListener('click', async function() {
      clearLoginError();
      var email   = (byId('createEmail') || {}).value || '';
      var pass    = (byId('createPassword') || {}).value || '';
      var confirm = (byId('createConfirm') || {}).value || '';
      if (!email || !pass) { showLoginError('Please fill in all fields.'); return; }
      if (pass.length < 6) { showLoginError('Password must be at least 6 characters.'); return; }
      if (pass !== confirm) { showLoginError('Passwords do not match.'); return; }
      loginCreateBtn.disabled = true;
      try { await fb.createAccount(email, pass); }
      catch(e) {
        showLoginError(e.code === 'auth/email-already-in-use' ? 'That email is already registered. Try signing in.' : e.message);
        loginCreateBtn.disabled = false;
      }
    });

    // Enter key support for login
    document.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter') return;
      var overlay = byId('loginOverlay');
      if (!overlay || overlay.style.display === 'none') return;
      var signinActive = byId('loginPanelSignin') && byId('loginPanelSignin').classList.contains('active');
      if (signinActive && loginSigninBtn) loginSigninBtn.click();
      else if (loginCreateBtn) loginCreateBtn.click();
    });

  }).catch(function(e) {
    console.warn('[VolleyStat] Firebase module failed to load:', e);
    var ss = byId('syncStatus');
    if (ss) { ss.textContent = '⚡ Offline'; ss.style.color = '#d97706'; }
  });

  // ── Mobile UI wiring ──────────────────────────────────────────────────────

  // No bottom nav panels in new layout

  // Score tracker state (persisted in localStorage)
  var SCORE_STORE_KEY = 'volleystat_scores_v2';

  // Scores stored as { "Day 1 - Match 1 - Set 1": {our:0, opp:0}, ... }
  function loadScoreStore(){
    try { return JSON.parse(localStorage.getItem(SCORE_STORE_KEY)) || {}; } catch(e){ return {}; }
  }
  function saveScoreStore(store){ localStorage.setItem(SCORE_STORE_KEY, JSON.stringify(store)); }

  function getScoreKey(){
    var day = (daySelect && daySelect.value) ? daySelect.value : 'Day 1';
    var match = matchSelect ? (matchSelect.value || 'Match 1') : 'Match 1';
    var set = setSelect ? (setSelect.value || '1') : '1';
    return day + ' - ' + match + ' - Set ' + set;
  }

  var scoreStore = loadScoreStore();

  function currentScore(){
    var k = getScoreKey();
    if (!scoreStore[k]) scoreStore[k] = {our:0, opp:0};
    return scoreStore[k];
  }

  function saveScore(){
    saveScoreStore(scoreStore);
  }

  function renderScore(){
    var score = currentScore();
    var ourEl = byId('ourScore');
    var oppEl = byId('oppScore');
    var nameEl = byId('scoreTeamName');
    var setLabelEl = byId('scoreSetLabel');
    if (ourEl) ourEl.textContent = score.our;
    if (oppEl) oppEl.textContent = score.opp;
    var team = activeTeam();
    if (nameEl) nameEl.textContent = (team && team.name) ? team.name : 'Your Team';
    if (setLabelEl){
      var day = (daySelect && daySelect.value) ? daySelect.value : 'Day 1';
      var matchName = matchSelect ? (matchSelect.value || 'Match 1') : 'Match 1';
      var setNum = setSelect ? (setSelect.value || '1') : '1';
      setLabelEl.textContent = day + ' · ' + matchName + ' · Set ' + setNum;
    }
  }

  function adjScore(who, delta){
    var score = currentScore();
    score[who] = Math.max(0, (score[who] || 0) + delta);
    saveScore();
    renderScore();
  }

  // Auto-adjust score based on recorded action
  function autoAdjustScore(action){
    // Our point: kill, ace
    if (action === 'kill' || action === 'ace'){
      adjScore('our', 1);
    }
    // Opponent point: serve out, swing out, pass shank, manual errors
    else if (action === 'serveOut' || action === 'swingOut' || action === 'passShank' ||
             action === 'errPassing' || action === 'errNet' || action === 'errTwoHand' ||
             action === 'errRotation'){
      adjScore('opp', 1);
    }
  }

  var ourUp = byId('ourScoreUp'), ourDown = byId('ourScoreDown');
  var oppUp = byId('oppScoreUp'), oppDown = byId('oppScoreDown');
  if (ourUp) ourUp.addEventListener('click', function(){
    adjScore('our', 1);
    // Manual point for us — if we didn't have the serve it's a side-out: rotate
    var team = activeTeam();
    if (team){
      ensureRotation(team);
      if (!team.rotation.hasBall){
        advanceRotation(team);
      }
      team.rotation.hasBall = true;
      saveState();
      if (rotationBackdrop && rotationBackdrop.style.display !== 'none') renderRotationWheel();
    }
  });
  if (ourDown) ourDown.addEventListener('click', function(){ adjScore('our', -1); });
  if (oppUp) oppUp.addEventListener('click', function(){
    adjScore('opp', 1);
    // Manual point for opponent — they now serve
    var team = activeTeam();
    if (team){
      ensureRotation(team);
      team.rotation.hasBall = false;
      saveState();
      if (rotationBackdrop && rotationBackdrop.style.display !== 'none') renderRotationWheel();
    }
  });
  if (oppDown) oppDown.addEventListener('click', function(){ adjScore('opp', -1); });

  renderScore();

  // Refresh score team name when team changes
  var origTeamChange = teamSelect && teamSelect.onchange;
  if (teamSelect) teamSelect.addEventListener('change', renderScore);

  // ── Persistent player strip ────────────────────────────────────────────────
  var mobilePlayerSelect = byId('mobilePlayerSelect');
  var playerStripBtns = byId('playerStripBtns');
  // also match new class name
  if (!playerStripBtns) playerStripBtns = document.querySelector('.ps-btns');
  var selectedPlayerBar = byId('selectedPlayerBar');
  var LAST_PLAYER_KEY = 'volleystat_last_player';

  // Last-used player memory
  function getLastPlayer(){ return localStorage.getItem(LAST_PLAYER_KEY) || ''; }
  function setLastPlayer(id){ localStorage.setItem(LAST_PLAYER_KEY, id); }

  var activePlayerId = getLastPlayer();

  function clearSelectedPlayer(){
    activePlayerId = '';
    localStorage.removeItem(LAST_PLAYER_KEY);
    buildPlayerStrip();
    buildDesktopStrip();
  }

  function updateSelectedBar(){
    if (!selectedPlayerBar) return;
    var team = activeTeam();
    if (!team || !activePlayerId){
      selectedPlayerBar.textContent = 'Tap a player name above to select';
      selectedPlayerBar.style.background = '#64748b';
      return;
    }
    var player = null;
    for (var i=0;i<team.players.length;i++) if(team.players[i].id===activePlayerId) player=team.players[i];
    if (!player){
      activePlayerId = '';
      selectedPlayerBar.textContent = 'Tap a player name above to select';
      selectedPlayerBar.style.background = '#64748b';
      return;
    }
    selectedPlayerBar.textContent = 'Recording for: ' + (player.number?'#'+player.number+' ':'') + player.name;
    selectedPlayerBar.style.background = '#1e3a8a';
    selectedPlayerBar.style.display = 'block';
  }

  // Desktop strip now unified — references point to universal strip
  var desktopPlayerStrip = null;  // removed
  var desktopStripBtns = byId('playerStripBtns');
  var desktopSelectedBar = byId('selectedPlayerBar');

  function buildDesktopStrip(){ buildPlayerStrip(); }

  function buildPlayerStrip(){
    if (!playerStripBtns) return;
    playerStripBtns.innerHTML = '';
    var team = activeTeam();
    if (!team || !team.players || !team.players.length){
      playerStripBtns.innerHTML = '<div style="font-size:12px;color:#6b7280;">Add players in Roster first</div>';
      if (selectedPlayerBar) selectedPlayerBar.style.display = 'none';
      return;
    }
    if (selectedPlayerBar) selectedPlayerBar.style.display = 'block';
    var players = team.players.slice().sort(sortPlayers);
    players.forEach(function(p){
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.pid = p.id;
      var label = (p.number ? '#'+p.number : '') + (p.number && p.name ? ' ' : '') + (p.name || '');
      if (p.position) label += ' · ' + p.position;
      btn.textContent = label;
      btn.className = 'player-pill';
      if (p.id === activePlayerId){ btn.classList.add('active'); }
      btn.addEventListener('click', function(){
        activePlayerId = p.id;
        setLastPlayer(p.id);
        // Update all strip buttons
        playerStripBtns.querySelectorAll('button').forEach(function(b){
          b.classList.toggle('active', b.dataset.pid === p.id);
        });
        updateSelectedBar();
        // Vibrate for feedback
        if (navigator.vibrate) navigator.vibrate(20);
      });
      playerStripBtns.appendChild(btn);
    });
    updateSelectedBar();
  }

  function populateMobilePlayerSelect(){
    buildPlayerStrip();
    buildDesktopStrip();
  }
  populateMobilePlayerSelect();

  // Wire clear buttons
  var clearPlayerBtn = byId('clearPlayerBtn');
  if (clearPlayerBtn) clearPlayerBtn.addEventListener('click', clearSelectedPlayer);

  // Click blank space in strip areas to clear selection
  var playerStripEl = byId('playerStrip');
  if (playerStripEl) playerStripEl.addEventListener('click', function(e){
    // Only clear if click landed directly on the strip container, not a button
    if (e.target === playerStripEl || e.target === playerStripBtns || e.target === selectedPlayerBar){
      clearSelectedPlayer();
    }
  });


  // Mobile stat buttons: wire data-action to the same handler as desktop
  // by injecting a synthetic click on the hidden desktop button, or dispatching directly
  function fireMobileAction(action){
    // No-op: all data-action buttons (including mobile ones) are now wired
    // directly in the unified toolbarBtns handler above. This function is kept
    // for compatibility but does nothing.
  }

  // Override selectedPlayer for mobile: when mobile player select changes,
  // keep desktop picker in sync. The existing code uses pendingAction + player picker modal.
  // For mobile, we inject the player selection first.
  var mobileSelectedPlayerId = null;
  if (mobilePlayerSelect){
    mobilePlayerSelect.addEventListener('change', function(){
      mobileSelectedPlayerId = mobilePlayerSelect.value || null;
    });
  }

  // Wire mobile stat buttons: add tap-flash + haptic on top of the
  // unified click handler already registered above (which opens the player picker)
  var mobileStatBtns = document.querySelectorAll('.stat-btn[data-action]');
  mobileStatBtns.forEach(function(btn){
    btn.addEventListener('click', function(){
      if (btn.disabled) return;
      // Tap flash feedback
      btn.classList.add('tap-flash');
      btn.addEventListener('animationend', function(){ btn.classList.remove('tap-flash'); }, {once:true});
      // Haptic feedback
      if (navigator.vibrate) navigator.vibrate(30);
    });
  });

  // Mobile undo
  var mobileUndoBtn = byId('mobileUndoBtn');
  if (mobileUndoBtn && undoBtn) mobileUndoBtn.addEventListener('click', function(){ undoBtn.click(); });

  // Mobile rotation button
  var mobileRotationBtn = byId('mobileRotationBtn');
  var mobileRotationBtnWrap = byId('mobileRotationBtnWrap');
  if (mobileRotationBtn && rotationBtn){
    mobileRotationBtn.addEventListener('click', function(){ rotationBtn.click(); });
  }
  // Show/hide mobile rotation button alongside desktop one
  var origApplyMode = applyModeToUI;
  function patchRotationBtnVisibility(){
    if (mobileRotationBtnWrap){
      mobileRotationBtnWrap.style.display = (uiMode === 'coach') ? '' : 'none';
    }
  }
  patchRotationBtnVisibility();

  // Mobile roster button
  var mobileRosterBtn = byId('mobileRosterBtn');
  if (mobileRosterBtn && rosterBtn) mobileRosterBtn.addEventListener('click', function(){ rosterBtn.click(); });

  // Mobile teams button
  var mobileTeamsBtn = byId('mobileTeamsBtn');
  if (mobileTeamsBtn && teamsBtn) mobileTeamsBtn.addEventListener('click', function(){ teamsBtn.click(); });

  // Mobile selects: keep in sync with desktop selects (bidirectional)
  function syncSelects(mobileId, desktopEl){
    var mobileEl = byId(mobileId);
    if (!mobileEl || !desktopEl) return;
    function copyOptions(){
      var prev = desktopEl.value; // preserve current value
      mobileEl.innerHTML = desktopEl.innerHTML;
      mobileEl.value = prev;
    }
    desktopEl.addEventListener('change', function(){ mobileEl.value = desktopEl.value; renderScore(); });
    mobileEl.addEventListener('change', function(){
      desktopEl.value = mobileEl.value;
      desktopEl.dispatchEvent(new Event('change'));
    });
    copyOptions();
    var observer = new MutationObserver(copyOptions);
    observer.observe(desktopEl, {childList:true});
  }

  syncSelects('mobileTeamSelect', teamSelect);
  // Day select: wire separately (not via syncSelects since it controls matchSelect)
  var mobileDaySelect = byId('mobileDaySelect');
  if (mobileDaySelect && daySelect){
    mobileDaySelect.value = daySelect.value;
    mobileDaySelect.addEventListener('change', function(){
      daySelect.value = mobileDaySelect.value;
      daySelect.dispatchEvent(new Event('change'));
    });
    daySelect.addEventListener('change', function(){ if(mobileDaySelect) mobileDaySelect.value = daySelect.value; });
  }
  syncSelects('mobileMatchSelect', matchSelect);
  syncSelects('mobileSetSelect', setSelect);
  syncSelects('mobileViewSelect', viewSelect);

  // Mobile mode toggle
  var mobileModePlayer = byId('mobileModePlayer');
  var mobileModeCoach = byId('mobileModeCoach');
  if (mobileModePlayer) mobileModePlayer.addEventListener('click', function(){
    if (modePlayerBtn) modePlayerBtn.click();
    mobileModePlayer.setAttribute('aria-pressed','true');
    mobileModeCoach.setAttribute('aria-pressed','false');
    patchRotationBtnVisibility();
  });
  if (mobileModeCoach) mobileModeCoach.addEventListener('click', function(){
    if (modeCoachBtn) modeCoachBtn.click();
    mobileModeCoach.setAttribute('aria-pressed','true');
    mobileModePlayer.setAttribute('aria-pressed','false');
    patchRotationBtnVisibility();
  });

  // Mobile export name + export button
  var mobileExportName = byId('mobileExportName');
  var mobileExportBtn = byId('mobileExportBtn');
  var mobileResetBtn = byId('mobileResetBtn');
  if (mobileExportName && exportName){
    mobileExportName.addEventListener('input', function(){
      exportName.value = mobileExportName.value;
      exportName.dataset.userEdited = mobileExportName.value.trim() ? '1' : '';
      if (!exportName.dataset.userEdited) syncExportNameDefault();
    });
    // keep in sync
    exportName.addEventListener('input', function(){ mobileExportName.value = exportName.value; });
  }
  if (mobileExportBtn && exportBtn) mobileExportBtn.addEventListener('click', function(){ exportBtn.click(); });
  if (mobileResetBtn && resetBtn) mobileResetBtn.addEventListener('click', function(){ resetBtn.click(); });

  // Re-populate mobile player select after roster changes
  var origBuildRosterList = buildRosterList;
  // Patch: after any renderTable call, repopulate player select
  var origRenderTable = renderTable;
  function afterRender(){ populateMobilePlayerSelect(); renderScore(); }
  var origRenderTableWrapped = renderTable;
  // Use a MutationObserver on statsBody to detect re-renders
  var statsBodyEl = byId('statsBody');
  if (statsBodyEl){
    var bodyObserver = new MutationObserver(afterRender);
    bodyObserver.observe(statsBodyEl, {childList:true});
  }

});

// ── PWA: Service Worker registration ────────────────────────────────────────
if ('serviceWorker' in navigator){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('./sw.js').then(function(reg){
      console.log('[VolleyStat] SW registered:', reg.scope);
    }).catch(function(err){
      console.warn('[VolleyStat] SW registration failed:', err);
    });
  });
}

// ── PWA: Install banner ──────────────────────────────────────────────────────
(function(){
  var deferredPrompt = null;
  var banner = document.getElementById('installBanner');
  var installBtn = document.getElementById('installBannerBtn');
  var dismissBtn = document.getElementById('installBannerDismiss');

  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault();
    deferredPrompt = e;
    if (banner) banner.classList.add('visible');
  });

  if (installBtn){
    installBtn.addEventListener('click', function(){
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function(){ deferredPrompt = null; });
      if (banner) banner.classList.remove('visible');
    });
  }
  if (dismissBtn){
    dismissBtn.addEventListener('click', function(){
      if (banner) banner.classList.remove('visible');
    });
  }

  window.addEventListener('appinstalled', function(){
    if (banner) banner.classList.remove('visible');
    deferredPrompt = null;
  });
})();
