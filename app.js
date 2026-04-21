/**
 * VolleyStat v0.1.7.5 (full build)
 * - Restores Teams / Roster / Undo / Export / Reset functionality
 * - Export respects the View dropdown scope (Set / Match / Tournament)
 * - Reset uses a styled modal: clears ALL stats for CURRENT team only, preserves team+roster,
 *   resets rotation offset (keeps assignments) and reminds user to export first.
 * - Keeps v0.1.7.3 rotation picker stacking fix
 */

console.log('[VolleyStat] v0.1.9 loaded');

var STORAGE_KEY = 'volleystat_v009';
var UI_MODE_KEY = 'volleystat_ui_mode';
var DEFAULT_MATCHES = ['Match 1', 'Match 2', 'Match 3'];

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
    hint: 'Serve In % = (1 + 2 + 3 + ACE) ÷ Serve Attempts. OUT is a serve attempt but not “in”.'
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
    team.rotation = { offset:0, base:{1:null,2:null,3:null,4:null,5:null,6:null}, setterPos:null };
  }
  if (team.rotation.offset === undefined || team.rotation.offset === null) team.rotation.offset = 0;
  if (!team.rotation.base) team.rotation.base = {1:null,2:null,3:null,4:null,5:null,6:null};
  if (team.rotation.setterPos === undefined) team.rotation.setterPos = null;
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
  var map = { serve1:'1', serve2:'2', serve3:'3', ace:'ACE', serveOut:'OUT', passToTarget:'3', passNearTarget:'2', passAwayTarget:'1', passShank:'0', swing:'Swing', swingOut:'Error', kill:'Kill', errHitting:'Hit Err', errServing:'Srv Err', errPassing:'Pass Err', errNet:'Net', errTwoHand:'2-Hand', errRotation:'OOR' };
  return map[a] || a;
}

function loadUiMode(){
  var v = localStorage.getItem(UI_MODE_KEY);
  return (v === 'coach' || v === 'player') ? v : 'player';
}
function saveUiMode(mode){ localStorage.setItem(UI_MODE_KEY, mode); }

function buildEmptyData(players, matches){
  var data = {};
  for (var i=0;i<matches.length;i++){
    var m = matches[i];
    data[m] = { '1':{}, '2':{}, '3':{} };
    for (var s=1; s<=3; s++){
      var ss = String(s);
      data[m][ss] = {};
      for (var p=0;p<players.length;p++) data[m][ss][players[p].id] = emptyCounters();
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
    rotation: { offset:0, base:{1:null,2:null,3:null,4:null,5:null,6:null}, setterPos:null }
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

function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

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

  for (var mi=0; mi<team.matches.length; mi++){
    var m = team.matches[mi];
    if (!team.data[m]) team.data[m] = { '1':{}, '2':{}, '3':{} };
    for (var s=1;s<=3;s++){
      var ss = String(s);
      if (!team.data[m][ss]) team.data[m][ss] = {};
      for (var pi=0; pi<team.players.length; pi++){
        var p = team.players[pi];
        var existing = team.data[m][ss][p.id] || {};
        var merged = Object.assign(emptyCounters(), existing);
        // ensure new error fields exist in migrated data
        if (merged.serveOut === undefined) merged.serveOut = 0;
        team.data[m][ss][p.id] = merged;
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
  var matchSelect = byId('matchSelect');
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
  var thAcePct = byId('thAcePct');
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

  var uiMode = loadUiMode();

  // picker state
  var pendingAction = null;
  var selectionMode = null;
  var selectionPayload = null;
  var _rotationWasOpenBeforePicker = false;

  function setDisabled(el, disabled){ if (el) el.disabled = !!disabled; }
  function setToolbarStatsEnabled(enabled){
    var btns = document.querySelectorAll('.toolbar button[data-action], .mobile-stat-btn[data-action]');
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
    var team = activeTeam();
    var match = matchSelect.value || (team && team.matches && team.matches[0]) || 'Match 1';
    var set = setSelect.value || '1';
    if (view === 'set') return match + ' Set ' + set;
    if (view === 'match') return match;
    return 'Tournament';
  }
  function modeLabelForFile(){ return uiMode === 'coach' ? 'CoachView' : 'PlayerView'; }
  function defaultExportBaseName(){
    var t = activeTeam();
    var teamName = t && t.name ? t.name : 'team';
    return safeFile(teamName) + '_' + safeFile(getExportContextLabel()) + '_' + modeLabelForFile();
  }
  function syncExportNameDefault(){
    if (!exportName) return;
    if (!exportName.dataset.userEdited) exportName.value = defaultExportBaseName();
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
    matchSelect.value = team.matches[0] || 'Match 1';
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
    var match = matchSelect.value || (team.matches[0] || 'Match 1');
    var set = setSelect.value || '1';

    var agg = emptyCounters();
    function addFrom(matchName, setNum){
      var c = (((team.data || {})[matchName] || {})[setNum] || {})[playerId];
      if (!c) return;
      var merged = Object.assign(emptyCounters(), c);
      for (var k in agg) if (Object.prototype.hasOwnProperty.call(agg,k)) agg[k] += nz(merged[k],0);
    }

    if (view === 'set') addFrom(match, set);
    else if (view === 'match') { addFrom(match,'1'); addFrom(match,'2'); addFrom(match,'3'); }
    else {
      for (var mi=0; mi<team.matches.length; mi++){
        var mn = team.matches[mi];
        addFrom(mn,'1'); addFrom(mn,'2'); addFrom(mn,'3');
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
      tr.appendChild(td(p.name || '', 'left sticky-col'));

      if (uiMode === 'coach'){
        tr.appendChild(td(String(d.oppRecAtt)));
        tr.appendChild(td(String(d.oppRecAtt)));  // serveIn placeholder for coach
      } else {
        tr.appendChild(td(String(d.serveAttPlayer)));
        tr.appendChild(td(String(d.serveIn)));
      }

      var midPct = (uiMode === 'coach') ? d.oppOosPct : d.serveInPct;
      var pctCell = td(fmtPct(midPct));
      if (uiMode === 'coach'){
        var heat = pressureHeatStyle(midPct);
        pctCell.style.background = heat.bg;
        pctCell.style.color = heat.fg;
        pctCell.style.fontWeight = '900';
      } else {
        pctCell.style.fontWeight = '700';
      }
      tr.appendChild(pctCell);

      if (uiMode !== 'coach'){
        tr.appendChild(td(String(d.aceCount)));
        tr.appendChild(td(fmtPct(d.acePctPlayer)));
      }

      tr.appendChild(td(String(d.passAtt)));
      tr.appendChild(td(fmtNum(d.passAvg,2)));
      tr.appendChild(td(String(d.hitAtt)));
      tr.appendChild(td(fmtNum(d.hitAvg,3)));
      tr.appendChild(td(String(d.hitsIn)));
      tr.appendChild(td(fmtPct(d.hitsInPct)));
      // Errors columns
      tr.appendChild(td(String(d.totalErrors)));
      tr.appendChild(td(String(d.errHitting)));
      tr.appendChild(td(String(d.errServing)));
      tr.appendChild(td(String(d.errPassing)));
      tr.appendChild(td(String(d.errNet)));
      tr.appendChild(td(String(d.errTwoHand)));
      tr.appendChild(td(String(d.errRotation)));

      statsBody.appendChild(tr);
    }
  }

  // Record stat event
  function recordEvent(action, playerId){
    var team = activeTeam();
    if (!team) return;

    var match = matchSelect.value || (team.matches[0] || 'Match 1');
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

    if (action === 'serveOut'){
      ensureRotation(team);
      advanceRotation(team);
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
        var top = (p.number ? '#' + p.number + ' ' : '') + (p.name || '');
        btn.appendChild(document.createTextNode(top));
        var sub = document.createElement('span');
        sub.className='player-sub';
        sub.textContent = p.position ? ('Pos: ' + p.position) : 'Pos: —';
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

          recordEvent(pendingAction, p.id);
        });

        playerGrid.appendChild(btn);
      })(players[i]);
    }
  }

  if (pickerClose) pickerClose.addEventListener('click', closePicker);
  if (pickerCancel) pickerCancel.addEventListener('click', closePicker);
  if (pickerBackdrop) pickerBackdrop.addEventListener('click', function(e){ if (e.target === pickerBackdrop) closePicker(); });

  // All stat buttons (toolbar desktop + mobile panels)
  var toolbarBtns = document.querySelectorAll('.toolbar button[data-action], .mobile-stat-btn[data-action]');
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
      if (action === 'serveOut'){
        ensureRotation(team);
        team.rotation.offset = ((team.rotation.offset || 0) - 1 + 6) % 6;
      }
    }

    saveState();
    renderTable();
    updateOnboardingAndControls();
    if (rotationBackdrop && rotationBackdrop.style.display !== 'none') renderRotationWheel();
  }
  if (undoBtn) undoBtn.addEventListener('click', undoLast);

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

      team.data = buildEmptyData(team.players || [], team.matches || DEFAULT_MATCHES);
      team.history = [];

      ensureRotation(team);
      team.rotation.offset = 0;

      saveState();
      renderTable();
      updateOnboardingAndControls();
      if (exportName) exportName.dataset.userEdited = '';
      syncExportNameDefault();
    });
  }

  // Select change events
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

  // Initial paint
  initTeamSelect();
  initMatchSelect();
  applyModeToUI();
  syncExportNameDefault();
  renderTable();
  updateOnboardingAndControls();

  // ── Mobile UI wiring ──────────────────────────────────────────────────────

  // Bottom nav panel switching
  var navTabs = document.querySelectorAll('.nav-tab');
  var mobilePanels = document.querySelectorAll('.mobile-panel');
  navTabs.forEach(function(tab){
    tab.addEventListener('click', function(){
      navTabs.forEach(function(t){ t.classList.remove('active'); });
      mobilePanels.forEach(function(p){ p.classList.remove('active'); });
      tab.classList.add('active');
      var panelId = tab.getAttribute('data-panel');
      var panel = byId(panelId);
      if (panel) panel.classList.add('active');
    });
  });

  // Score tracker state (persisted in localStorage)
  var SCORE_KEY = 'volleystat_score';
  function loadScore(){
    try { return JSON.parse(localStorage.getItem(SCORE_KEY)) || {our:0, opp:0}; } catch(e){ return {our:0, opp:0}; }
  }
  function saveScore(s){ localStorage.setItem(SCORE_KEY, JSON.stringify(s)); }
  var score = loadScore();

  function renderScore(){
    var ourEl = byId('ourScore');
    var oppEl = byId('oppScore');
    var nameEl = byId('scoreTeamName');
    var setLabelEl = byId('scoreSetLabel');
    if (ourEl) ourEl.textContent = score.our;
    if (oppEl) oppEl.textContent = score.opp;
    var team = activeTeam();
    if (nameEl) nameEl.textContent = (team && team.name) ? team.name : 'Your Team';
    if (setLabelEl){
      var setEl = byId('mobileSetSelect') || byId('setSelect');
      var matchEl = byId('mobileMatchSelect') || byId('matchSelect');
      var matchName = matchEl ? matchEl.value : 'Match 1';
      var setNum = setEl ? setEl.value : '1';
      setLabelEl.textContent = (matchName || 'Match') + '  ·  Set ' + (setNum || '1');
    }
  }

  function adjScore(who, delta){
    score[who] = Math.max(0, (score[who] || 0) + delta);
    saveScore(score);
    renderScore();
  }

  var ourUp = byId('ourScoreUp'), ourDown = byId('ourScoreDown');
  var oppUp = byId('oppScoreUp'), oppDown = byId('oppScoreDown');
  if (ourUp) ourUp.addEventListener('click', function(){ adjScore('our', 1); });
  if (ourDown) ourDown.addEventListener('click', function(){ adjScore('our', -1); });
  if (oppUp) oppUp.addEventListener('click', function(){ adjScore('opp', 1); });
  if (oppDown) oppDown.addEventListener('click', function(){ adjScore('opp', -1); });

  renderScore();

  // Refresh score team name when team changes
  var origTeamChange = teamSelect && teamSelect.onchange;
  if (teamSelect) teamSelect.addEventListener('change', renderScore);

  // Mobile player select dropdown (mirrors desktop picker)
  var mobilePlayerSelect = byId('mobilePlayerSelect');
  function populateMobilePlayerSelect(){
    if (!mobilePlayerSelect) return;
    var team = activeTeam();
    mobilePlayerSelect.innerHTML = '<option value="">— select player —</option>';
    if (!team || !team.players || !team.players.length) return;
    var players = team.players.slice().sort(sortPlayers);
    players.forEach(function(p){
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = (p.number ? '#' + p.number + ' ' : '') + p.name + (p.position ? ' (' + p.position + ')' : '');
      mobilePlayerSelect.appendChild(opt);
    });
  }
  populateMobilePlayerSelect();

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
  var mobileStatBtns = document.querySelectorAll('.mobile-stat-btn[data-action]');
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
    // Populate mobile from desktop innerHTML when desktop changes
    function copyOptions(){
      mobileEl.innerHTML = desktopEl.innerHTML;
      mobileEl.value = desktopEl.value;
    }
    // Observe desktop select changes via mutation + change events
    desktopEl.addEventListener('change', function(){ mobileEl.value = desktopEl.value; renderScore(); });
    mobileEl.addEventListener('change', function(){
      desktopEl.value = mobileEl.value;
      desktopEl.dispatchEvent(new Event('change'));
    });
    copyOptions();
    // Also copy whenever team changes (match list regenerates)
    var observer = new MutationObserver(copyOptions);
    observer.observe(desktopEl, {childList:true});
  }

  syncSelects('mobileTeamSelect', teamSelect);
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
