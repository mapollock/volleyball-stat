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

var APP_VERSION = '0.1.143';
console.log('[VolleyStat] v' + APP_VERSION + ' loaded');

var STORAGE_KEY = 'volleystat_v1'; // stable key — do not change between versions
var UI_MODE_KEY = 'volleystat_ui_mode';
var SCORE_STORE_KEY = 'volleystat_scores_v2';
var scoreStore = {};
var lastLocalUpdatedAt = 0;
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
    hint: 'Serve In % = (1 + 2 + 3 + ACE) ÷ Serve Attempts. OUT is a serve attempt but not "in". Green row = current server (Pos 1).'
  },
  coach: {
    serveAtt: 'Svr In Play',
    serveIn: 'Opp Passes',
    midPct: 'Svr Pressure %',
    aces: 'ACE',
    acePct: 'Ace%',
    passAtt: 'Pass Att',
    passAvg: 'Recv Pressure',
    hint: 'Svr Pressure % = (Aces + Opp pass 1) ÷ serves in play — higher = tougher serving. Recv Pressure = our pass average when receiving — higher = more pressure on their defense. Green row = current server (Pos 1).'
  }
};

var SERVE_IN_TOOLTIP = 'Serve In %: serves kept in play (1/2/3 + ACE) ÷ total serve attempts (includes OUT).';
var SERVE_PRESSURE_TOOLTIP = 'Serve Pressure %: (Aces + opponent 1-passes) ÷ serves in play. Higher = more pressure on their receive.';
var RECV_PRESSURE_TOOLTIP = 'Recv Pressure: our pass average when receiving. Higher = better passes and more pressure on their defense.';

// Rotation helpers
var POS_TO_BASE = { S:1, OH1:2, MB2:3, RS:4, OH2:5, MB1:6 };
var BASE_SLOT_LABELS = { 1:'S', 2:'OH1', 3:'MB2', 4:'RS', 5:'OH2', 6:'MB1' };
function normPosToken(pos){
  if (!pos) return '';
  var s = String(pos).toUpperCase().trim();
  s = s.replace(/\s+/g,'').replace(/[-_]+/g,'');
  return s;
}
function posColorKey(pos){
  var p = normPosToken(pos);
  if (p === 'OH1' || p === 'OH2') return 'OH';
  if (p === 'MB1' || p === 'MB2') return 'MB';
  return p;
}
function firstName(name){
  return (name || '').split(' ')[0] || name || '';
}
function ensureRotation(team){
  if (!team.rotation){
    team.rotation = { offset:0, base:{1:null,2:null,3:null,4:null,5:null,6:null}, setterPos:null, hasBall:true, liberoActive:false, liberoId:null, liberoSlot:null, dsActive:false, dsId:null, srMode:false, srSystem:'5-1', autoSubs:{}, subCount:0, liberoMB2:true };
  }
  if (team.rotation.offset === undefined || team.rotation.offset === null) team.rotation.offset = 0;
  if (!team.rotation.base) team.rotation.base = {1:null,2:null,3:null,4:null,5:null,6:null};
  if (team.rotation.setterPos === undefined) team.rotation.setterPos = null;
  if (team.rotation.hasBall === undefined) team.rotation.hasBall = true;
  if (team.rotation.liberoActive === undefined) team.rotation.liberoActive = false;
  if (team.rotation.liberoId === undefined) team.rotation.liberoId = null;
  if (team.rotation.liberoSlot === undefined) team.rotation.liberoSlot = null;
  if (team.rotation.dsActive === undefined) team.rotation.dsActive = false;
  if (team.rotation.dsId === undefined) team.rotation.dsId = null;
  if (team.rotation.srMode === undefined) team.rotation.srMode = false;
  if (team.rotation.srSystem === undefined) team.rotation.srSystem = '5-1';
  if (!team.rotation.srLayouts) team.rotation.srLayouts = {};
  if (!team.rotation.autoSubs) team.rotation.autoSubs = {};
  if (!team.rotation.autoSubPos) team.rotation.autoSubPos = {}; // per slot: 1=sub at pos1, 6=sub at pos6
  if (!team.rotation.autoSubOriginals) team.rotation.autoSubOriginals = {};
  if (!team.rotation.manualSubPairs) team.rotation.manualSubPairs = {};
  // Starter in base slot is not a sub — drop stale manual-sub pairs
  for (var msKey in team.rotation.manualSubPairs){
    var msSlot = parseInt(msKey, 10);
    var msPair = team.rotation.manualSubPairs[msKey];
    if (!msPair || msPair.in === team.rotation.base[msSlot]){
      delete team.rotation.manualSubPairs[msKey];
    }
  }
  if (team.rotation.subCount === undefined) team.rotation.subCount = 0;
  if (team.rotation.liberoMB2 === undefined) team.rotation.liberoMB2 = true;
  if (team.rotation.liberoForMB1 === undefined) team.rotation.liberoForMB1 = true;
  if (team.rotation.liberoForMB2 === undefined) team.rotation.liberoForMB2 = true;
  // Libero must never be tracked as a bench auto-sub
  var libIdClean = getLiberoId(team);
  if (libIdClean && team.rotation.autoSubs){
    for (var asKey in team.rotation.autoSubs){
      if (team.rotation.autoSubs[asKey] === libIdClean) delete team.rotation.autoSubs[asKey];
    }
  }
}

// ── Overlap rule validation ───────────────────────────────────────────────────
// pos map: {1..6} → {x, y} tile top-left. Tile size 110×80.
// Center of tile = {x+55, y+40}.
// Rules (court from coach POV, net at top):
//   Front row right of front row: cx(2) > cx(3), cx(3) > cx(4)
//   Back row right of back row:   cx(1) > cx(6), cx(6) > cx(5)
//   Front in front of back (same column): cy(2)<cy(1), cy(3)<cy(6), cy(4)<cy(5)
function validateSRPositions(positions){
  function cx(p){ return positions[p].x + 55; }
  function cy(p){ return positions[p].y + 40; }
  var violations = [];
  if (cx(2) <= cx(3)) violations.push('Pos 2 must be right of Pos 3');
  if (cx(3) <= cx(4)) violations.push('Pos 3 must be right of Pos 4');
  if (cx(1) <= cx(6)) violations.push('Pos 1 must be right of Pos 6');
  if (cx(6) <= cx(5)) violations.push('Pos 6 must be right of Pos 5');
  if (cy(2) >= cy(1)) violations.push('Pos 2 must be in front of Pos 1');
  if (cy(3) >= cy(6)) violations.push('Pos 3 must be in front of Pos 6');
  if (cy(4) >= cy(5)) violations.push('Pos 4 must be in front of Pos 5');
  return violations;
}

function getSRLayoutKey(team){
  var sys = team.rotation.srSystem || '5-1';
  var off = team.rotation.offset || 0;
  return sys + '_' + off;
}

function getSRLayout(team){
  var key = getSRLayoutKey(team);
  if (team.rotation.srLayouts && team.rotation.srLayouts[key]) return team.rotation.srLayouts[key];
  // Fall back to template
  return team.rotation.srSystem === '6-2' ? SR_STACKS_62[((6 - (team.rotation.offset||0)) % 6) + 1]
                                           : SR_STACKS_51[((6 - (team.rotation.offset||0)) % 6) + 1];
}

function saveSRLayout(team, positions){
  if (!team.rotation.srLayouts) team.rotation.srLayouts = {};
  team.rotation.srLayouts[getSRLayoutKey(team)] = positions;
}

function rotatedPos(basePos, offset){ return ((basePos - offset - 1 + 6000) % 6) + 1; }
function inverseBaseForCurrentPos(currentPos, offset){ return ((currentPos + offset - 1) % 6) + 1; }

// ── Serve Receive stacking templates ─────────────────────────────────────────
// Container: 396w × 204h (3 cols × 120px + 2 gaps × 12px, 2 rows × 90px + 1 gap × 12px + 2px)
// Tile size: 120×90. Position = top-left corner of tile.
// Base grid positions (top-left of each cell):
//   pos4=(0,0)    pos3=(132,0)   pos2=(264,0)    ← front row
//   pos5=(0,102)  pos6=(132,102) pos1=(264,102)   ← back row
//
// Stacking shifts tiles to show serve-receive overlap.
// Indexed by setter's current COURT position (1-6).

var SR_BASE_POS = {
  1:{x:430,y:215}, 2:{x:430,y:0}, 3:{x:215,y:0},
  4:{x:0,y:0},     5:{x:0,y:215}, 6:{x:215,y:215}
};

// SR stacking templates from 5-1/6-2 serve receive playbook.
// Key = ((6 - offset) % 6) + 1  (matches setter's court position for 5-1).
// Coordinates in 560×300 virtual space (y=0 net, y=300 back line).
// Stacked players (setter / MB) sit near attack line (y≈70–110).
// Passers (OHs / Libero) spread deep in back (y≈185–215).
// All positions satisfy validation: x[2]>x[3]>x[4], x[1]>x[6]>x[5], y[2]<y[1], y[3]<y[6], y[4]<y[5].

// 5-1 OFFENSE — RECEIVE formations
var SR_STACKS_51 = {
  // Rotation 1: front RS|M2|O1  back O2|L|S  →  RS stacks center, M2 near attack line right, S deep far right
  1:{ 4:{x:160,y:85},  3:{x:310,y:65},  2:{x:355,y:195},
      5:{x:20,y:205},  6:{x:175,y:195}, 1:{x:465,y:215} },
  // Rotation 6: front M2|O1|S  back RS|O2|L  →  S near net right, O1 near attack line center, M2 attack line left
  2:{ 4:{x:40,y:90},   3:{x:210,y:80},  2:{x:430,y:20},
      5:{x:20,y:200},  6:{x:215,y:195}, 1:{x:420,y:205} },
  // Rotation 5: front O1|S|M1  back L|RS|O2  →  S and M1 near net right-center, O1 drops left attack line
  3:{ 4:{x:25,y:85},   3:{x:330,y:20},  2:{x:400,y:30},
      5:{x:30,y:195},  6:{x:215,y:195}, 1:{x:430,y:205} },
  // Rotation 4: front S|M1|O2  back O1|L|RS  →  S near net far left, M1 stacks behind S, O2 near attack line right
  4:{ 4:{x:30,y:20},   3:{x:100,y:90},  2:{x:410,y:75},
      5:{x:20,y:200},  6:{x:215,y:190}, 1:{x:425,y:205} },
  // Rotation 3: front M1|O2|RS  back S|O1|L  →  M1 near attack line left, S stacks behind M1, RS near attack line right
  5:{ 4:{x:40,y:70},   3:{x:175,y:180}, 2:{x:400,y:80},
      5:{x:40,y:100},  6:{x:240,y:200}, 1:{x:395,y:210} },
  // Rotation 2: front O2|RS|M2  back L|S|O1  →  RS and S stacked center-right near attack line, M2 tucked far right
  6:{ 4:{x:20,y:185},  3:{x:310,y:70},  2:{x:440,y:80},
      5:{x:30,y:195},  6:{x:320,y:100}, 1:{x:440,y:205} },
};

// 6-2 OFFENSE — RECEIVE formations (same structure, two setters alternate)
var SR_STACKS_62 = {
  // Rotation 1: identical stacking pattern to 5-1 Rotation 1
  1:{ 4:{x:160,y:85},  3:{x:310,y:65},  2:{x:355,y:195},
      5:{x:20,y:205},  6:{x:175,y:195}, 1:{x:465,y:215} },
  // Rotation 6
  2:{ 4:{x:40,y:90},   3:{x:210,y:80},  2:{x:430,y:20},
      5:{x:20,y:200},  6:{x:215,y:195}, 1:{x:420,y:205} },
  // Rotation 5: setter (S2) stacks behind RS2 at center
  3:{ 4:{x:25,y:85},   3:{x:330,y:20},  2:{x:400,y:30},
      5:{x:30,y:195},  6:{x:330,y:100}, 1:{x:430,y:205} },
  // Rotation 4: RS2 near net far left, M1 stacks, O2 attack line right
  4:{ 4:{x:30,y:20},   3:{x:100,y:90},  2:{x:410,y:75},
      5:{x:20,y:200},  6:{x:215,y:190}, 1:{x:425,y:205} },
  // Rotation 3
  5:{ 4:{x:40,y:70},   3:{x:175,y:180}, 2:{x:400,y:80},
      5:{x:40,y:100},  6:{x:240,y:200}, 1:{x:395,y:210} },
  // Rotation 2: RS1 and S1 stacked center-right, M2 far right
  6:{ 4:{x:20,y:185},  3:{x:310,y:70},  2:{x:440,y:80},
      5:{x:30,y:195},  6:{x:320,y:100}, 1:{x:440,y:205} },
};

function setterCourtPos(team){
  if (!team.rotation.setterPos) return null;
  return rotatedPos(parseInt(team.rotation.setterPos,10), team.rotation.offset || 0);
}

function getSRStack(team){
  var sp = setterCourtPos(team);
  if (!sp) return null;
  return team.rotation.srSystem === '6-2' ? SR_STACKS_62[sp] : SR_STACKS_51[sp];
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

function courtPosToBaseSlot(team, courtPos){
  ensureRotation(team);
  var offset = team.rotation.offset || 0;
  for (var slot=1; slot<=6; slot++){
    if (rotatedPos(slot, offset) === courtPos) return slot;
  }
  return null;
}
function isMBBaseSlot(slot){ return slot === 3 || slot === 6; }
function isSubRuleSlot(slot){ return slot === 1 || slot === 2 || slot === 4 || slot === 5; }
var BACK_ROW_POSITIONS = {1:true, 5:true, 6:true};

function getLiberoId(team){
  var players = team.players || [];
  for (var i=0;i<players.length;i++){
    if (normPosToken(players[i].position) === 'LIB') return players[i].id;
  }
  return null;
}

function playerIdKey(id){
  return id == null ? '' : String(id);
}

function isLiberoPosition(pos){
  var tok = normPosToken(pos);
  return tok === 'LIB' || tok === 'LIBERO' || tok === 'L';
}

function isLiberoPlayer(team, pid){
  if (!pid) return false;
  var key = playerIdKey(pid);
  var players = team.players || [];
  for (var i=0; i<players.length; i++){
    if (playerIdKey(players[i].id) !== key) continue;
    if (isLiberoPosition(players[i].position)) return true;
    break;
  }
  var libId = (team.rotation && team.rotation.liberoId) || getLiberoId(team);
  return !!libId && playerIdKey(libId) === key;
}

// Libero for MB is unlimited and does not count toward the 15 team subs per set.
function shouldCountSubstitution(team, enteringId, leavingId, baseSlot){
  if (isLiberoPlayer(team, enteringId) || isLiberoPlayer(team, leavingId)) return false;
  return true;
}

// Set Base starters — used for labels only in sub/auto-sub picker (not filtering).
function getSetBasePlayerIds(team){
  ensureRotation(team);
  var ids = {};
  if (!team.savedBase) return ids;
  for (var s=1; s<=6; s++){
    var pid = team.savedBase[s] || team.savedBase[String(s)];
    if (pid) ids[playerIdKey(pid)] = true;
  }
  return ids;
}

function rosterSubPickerPlayers(team){
  return (team && team.players) ? team.players.slice() : [];
}

function getSubPickerPlayerTags(team, pid){
  var tags = [];
  if (!pid || !team) return tags;
  var key = playerIdKey(pid);
  if (getSetBasePlayerIds(team)[key]) tags.push('Set Base');
  if (isLiberoPlayer(team, pid)) tags.push('Libero');
  var onCourt = currentPosToPlayerId(team);
  for (var cp=1; cp<=6; cp++){
    if (onCourt[cp] && playerIdKey(onCourt[cp]) === key){
      tags.push('On court');
      break;
    }
  }
  return tags;
}

function benchManualSubCandidates(team, baseSlot){
  return rosterSubPickerPlayers(team);
}

function benchAutoSubCandidates(team, baseSlot){
  return rosterSubPickerPlayers(team);
}

function benchSubCandidates(team, baseSlot){
  return rosterSubPickerPlayers(team);
}

// Undo an in-progress auto-sub swap so court stays on the starter until rotation applies it.
function clearActiveAutoSub(team, baseSlot){
  if (!team.rotation || !team.rotation.autoSubOriginals) return;
  var original = team.rotation.autoSubOriginals[baseSlot];
  var subId = (team.rotation.autoSubs || {})[baseSlot];
  if (original && subId && team.rotation.base[baseSlot] === subId){
    team.rotation.base[baseSlot] = original;
  }
  delete team.rotation.autoSubOriginals[baseSlot];
}

// dblclick does not fire on iOS/Safari touch — detect two quick taps via pointerup/touchend.
function addDoubleTapListener(el, onDoubleTap){
  var lastTap = 0;
  var lastX = 0;
  var lastY = 0;
  var DBL_MS = 450;
  var DBL_DIST = 36;

  function onTap(x, y, e){
    if (el.dataset.wasDragged === '1'){
      el.dataset.wasDragged = '0';
      lastTap = 0;
      return;
    }
    var now = Date.now();
    if (lastTap && (now - lastTap) < DBL_MS &&
        Math.abs(x - lastX) < DBL_DIST && Math.abs(y - lastY) < DBL_DIST){
      lastTap = 0;
      if (e){ e.preventDefault(); e.stopPropagation(); }
      onDoubleTap(e || { preventDefault: function(){}, stopPropagation: function(){} });
      return;
    }
    lastTap = now;
    lastX = x;
    lastY = y;
  }

  el.addEventListener('pointerup', function(e){
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    onTap(e.clientX, e.clientY, e);
  });
  el.addEventListener('touchend', function(e){
    if (!e.changedTouches || !e.changedTouches.length) return;
    var t = e.changedTouches[0];
    onTap(t.clientX, t.clientY, e);
  }, { passive: false });
}

function getDSId(team){
  var players = team.players || [];
  for (var i=0;i<players.length;i++){
    if (normPosToken(players[i].position) === 'DS') return players[i].id;
  }
  return null;
}

function getMB1CurrentPos(team){
  ensureRotation(team);
  autoFillBaseFromRoster(team); // must run so base[6] is populated
  var mb1Id = team.rotation.base[6]; // MB1 is always base slot 6
  if (!mb1Id) return null;
  return rotatedPos(6, team.rotation.offset || 0);
}

function getMB2CurrentPos(team){
  ensureRotation(team);
  autoFillBaseFromRoster(team); // must run so base[3] is populated
  var mb2Id = team.rotation.base[3]; // MB2 is always base slot 3
  if (!mb2Id) return null;
  return rotatedPos(3, team.rotation.offset || 0);
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
  // Libero swap: replaces whichever middle (MB1 or MB2) is tracked in liberoSlot
  if (team.rotation.liberoActive){
    var libId = team.rotation.liberoId || getLiberoId(team);
    if (libId){
      var libTargetPos = (team.rotation.liberoSlot === 'MB2') ? getMB2CurrentPos(team) : getMB1CurrentPos(team);
      if (libTargetPos && isLiberoReplacePos(libTargetPos)){
        map[libTargetPos] = libId;
      }
    }
  }
  // DS swap: if active and MB2 is in back row, show DS in that slot
  if (team.rotation.dsActive){
    var dsId = team.rotation.dsId || getDSId(team);
    if (dsId){
      var mb2Pos = getMB2CurrentPos(team);
      if (mb2Pos && BACK_ROW_POSITIONS[mb2Pos]){
        map[mb2Pos] = dsId;
      }
    }
  }
  return map;
}

function getServerPlayerId(team){
  var map = currentPosToPlayerId(team);
  return map[1] || null;
}

function resetRotationRuntimeState(team){
  ensureRotation(team);
  team.rotation.offset = 0;
  team.rotation.hasBall = true;
  team.rotation.subCount = 0;
  team.rotation.manualSubPairs = {};
  team.rotation.autoSubOriginals = {};
  team.rotation.autoSubs = {};
  team.rotation.autoSubPos = {};
  team.rotation.liberoActive = false;
  team.rotation.liberoId = null;
  team.rotation.liberoSlot = null;
  team.rotation.srMode = false;
}

function courtLineupFromBaseObj(baseObj){
  var d = { 1:null, 2:null, 3:null, 4:null, 5:null, 6:null };
  if (!baseObj) return d;
  for (var cp=1; cp<=6; cp++){
    d[cp] = baseObj[inverseBaseForCurrentPos(cp, 0)] || null;
  }
  return d;
}

function restoreRotationOneBase(team){
  ensureRotation(team);
  if (team.savedBase){
    team.rotation.base = JSON.parse(JSON.stringify(team.savedBase));
  }
  resetRotationRuntimeState(team);
}

function mbBaseSlotForLabel(label){ return label === 'MB2' ? 3 : 6; }

function isMiddleBackRowPos(courtPos){
  return courtPos === 1 || courtPos === 5 || courtPos === 6;
}

function isLiberoReplacePos(courtPos){
  return isMiddleBackRowPos(courtPos);
}

function middleServesInRotation(team, label){
  var mb2Serves = team.rotation.liberoMB2 !== false;
  return label === 'MB2' ? mb2Serves : !mb2Serves;
}

function liberoEnabledForMiddle(team, label){
  ensureRotation(team);
  if (label === 'MB1') return team.rotation.liberoForMB1 !== false;
  if (label === 'MB2') return team.rotation.liberoForMB2 !== false;
  return false;
}

// Pos 1: libero replaces unless "I will serve" is on (manual Libero In can override with force).
function shouldSkipLiberoForMiddle(team, label, courtPos, force){
  if (force) return false;
  if (courtPos !== 1) return false;
  return middleServesInRotation(team, label);
}

function middleLabelForBaseSlot(baseSlot){
  if (baseSlot === 3) return 'MB2';
  if (baseSlot === 6) return 'MB1';
  return null;
}

// Which middle (if any) should have the libero on court right now.
function findLiberoEligibleMB(team, offset, force){
  ensureRotation(team);
  autoFillBaseFromRoster(team);
  var off = offset !== undefined ? offset : (team.rotation.offset || 0);
  var mbSlots = [3, 6];
  for (var i = 0; i < mbSlots.length; i++){
    var baseSlot = mbSlots[i];
    var label = middleLabelForBaseSlot(baseSlot);
    if (!label) continue;
    var pos = rotatedPos(baseSlot, off);
    if (!isMiddleBackRowPos(pos)) continue;
    if (!liberoEnabledForMiddle(team, label)) continue;
    if (shouldSkipLiberoForMiddle(team, label, pos, force)) continue;
    return label;
  }
  return null;
}

function getLiberoDisplayTarget(team){
  ensureRotation(team);
  if (team.rotation.liberoActive && team.rotation.liberoSlot) return team.rotation.liberoSlot;
  return findLiberoEligibleMB(team);
}

function tryActivateLibero(team, offset, force){
  ensureRotation(team);
  autoFillBaseFromRoster(team);
  var libId = getLiberoId(team);
  if (!libId) return false;
  var off = offset !== undefined ? offset : (team.rotation.offset || 0);

  if (team.rotation.liberoActive && team.rotation.liberoSlot){
    var activeLabel = team.rotation.liberoSlot;
    var activePos = rotatedPos(mbBaseSlotForLabel(activeLabel), off);
    if (isMiddleBackRowPos(activePos) && liberoEnabledForMiddle(team, activeLabel)
        && !shouldSkipLiberoForMiddle(team, activeLabel, activePos, force)){
      team.rotation.liberoId = libId;
      return true;
    }
    deactivateLibero(team);
  }

  var label = findLiberoEligibleMB(team, off, force);
  if (!label) return false;
  team.rotation.liberoId = libId;
  team.rotation.liberoSlot = label;
  team.rotation.liberoActive = true;
  return true;
}

function deactivateLibero(team){
  if (!team || !team.rotation) return;
  team.rotation.liberoActive = false;
  team.rotation.liberoSlot = null;
}
function getLineupBaseForReplay(team){
  ensureRotation(team);
  if (team.savedBase) return JSON.parse(JSON.stringify(team.savedBase));
  var base = JSON.parse(JSON.stringify(team.rotation.base));
  if (team.rotation.autoSubOriginals){
    for (var slot in team.rotation.autoSubOriginals){
      if (team.rotation.autoSubOriginals[slot]) base[slot] = team.rotation.autoSubOriginals[slot];
    }
  }
  return base;
}

function applyAutoSubsForOffset(team, offset){
  var MB_SLOTS = {3: true, 6: true};
  if (!team.rotation.autoSubs) return;
  if (!team.rotation.autoSubOriginals) team.rotation.autoSubOriginals = {};
  for (var baseSlot in team.rotation.autoSubs){
    var bSlot = parseInt(baseSlot, 10);
    if (MB_SLOTS[bSlot]) continue;
    var subPlayerId = team.rotation.autoSubs[baseSlot];
    if (!subPlayerId) continue;
    var courtPos = rotatedPos(bSlot, offset);
    var subInPos = (team.rotation.autoSubPos && team.rotation.autoSubPos[baseSlot]) || 1;
    var subOutPos = 4;

    if (courtPos === subInPos){
      if (!team.rotation.autoSubOriginals[baseSlot]){
        team.rotation.autoSubOriginals[baseSlot] = team.rotation.base[baseSlot];
      }
      if (team.rotation.base[baseSlot] !== subPlayerId){
        var prevId = team.rotation.base[baseSlot];
        team.rotation.base[baseSlot] = subPlayerId;
        if (shouldCountSubstitution(team, subPlayerId, prevId, bSlot)){
          team.rotation.subCount = (team.rotation.subCount || 0) + 1;
        }
      }
    } else if (courtPos === subOutPos){
      var original = team.rotation.autoSubOriginals[baseSlot];
      if (original && team.rotation.base[baseSlot] !== original){
        var subId = team.rotation.base[baseSlot];
        team.rotation.base[baseSlot] = original;
        if (shouldCountSubstitution(team, original, subId, bSlot)){
          team.rotation.subCount = (team.rotation.subCount || 0) + 1;
        }
      }
    }
  }
}

function applyRulesForOffset(team, offset){
  deactivateLibero(team);
  autoFillBaseFromRoster(team);
  applyAutoSubsForOffset(team, offset);
  tryActivateLibero(team, offset, false);
}

// Replay from saved base through each rotation so forward/back stay in sync with libero + auto-subs.
function syncRotationToOffset(team, targetOffset){
  ensureRotation(team);
  targetOffset = ((targetOffset % 6) + 6) % 6;
  team.rotation.base = getLineupBaseForReplay(team);
  team.rotation.subCount = 0;
  team.rotation.autoSubOriginals = {};
  team.rotation.manualSubPairs = {};
  deactivateLibero(team);

  for (var off = 0; off <= targetOffset; off++){
    team.rotation.offset = off;
    applyRulesForOffset(team, off);
  }
  team.rotation.offset = targetOffset;
}

function advanceRotation(team){
  ensureRotation(team);
  var cur = team.rotation.offset || 0;
  syncRotationToOffset(team, (cur + 1) % 6);
}

function retreatRotation(team){
  ensureRotation(team);
  var cur = team.rotation.offset || 0;
  syncRotationToOffset(team, (cur - 1 + 6) % 6);
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
    dig:0, digErr:0, blockKill:0, blockErr:0, oos:0,
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
  var map = { serve1:'1', serve2:'2', serve3:'3', ace:'ACE', serveOut:'OUT', passToTarget:'3', passNearTarget:'2', passAwayTarget:'1', passShank:'0', swing:'Swing', swingOut:'Error', kill:'Kill', dig:'Dig', digErr:'Dig Err', blockKill:'Block Kill', blockErr:'Block Err', oos:'OOS', errHitting:'Hit Err', errServing:'Srv Err', errPassing:'Pass Err', errNet:'Net', errTwoHand:'2-Touch', errRotation:'O.O.R.' };
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

function loadScoreStoreFromDisk(){
  try { return JSON.parse(localStorage.getItem(SCORE_STORE_KEY)) || {}; } catch(e){ return {}; }
}
function saveScoreStoreToDisk(store){
  localStorage.setItem(SCORE_STORE_KEY, JSON.stringify(store || {}));
}

function loadState(){
  var raw = localStorage.getItem(STORAGE_KEY);
  if (raw){
    try {
      var parsed = JSON.parse(raw);
      lastLocalUpdatedAt = parsed.clientUpdatedAt || 0;
      scoreStore = parsed.scoreStore ? parsed.scoreStore : loadScoreStoreFromDisk();
      delete parsed.clientUpdatedAt;
      delete parsed.scoreStore;
      return parsed;
    } catch(e){}
  }
  lastLocalUpdatedAt = 0;
  scoreStore = loadScoreStoreFromDisk();
  return { activeTeamId:null, teams:[] };
}

function buildSyncPayload(){
  return {
    activeTeamId: state.activeTeamId,
    teams: state.teams,
    scoreStore: scoreStore,
    clientUpdatedAt: lastLocalUpdatedAt
  };
}

function mergeScoreStores(primary, secondary){
  var merged = Object.assign({}, secondary || {});
  if (primary && typeof primary === 'object'){
    Object.keys(primary).forEach(function(k){ merged[k] = primary[k]; });
  }
  return merged;
}

function applyRemotePayload(remote){
  if (!remote || !Array.isArray(remote.teams)) return false;
  var remoteTs = remote.clientUpdatedAt || 0;
  state = { activeTeamId: remote.activeTeamId, teams: remote.teams };
  normalizeAllTeams(state);
  if (remote.scoreStore && typeof remote.scoreStore === 'object'){
    scoreStore = remoteTs >= lastLocalUpdatedAt
      ? mergeScoreStores(remote.scoreStore, scoreStore)
      : mergeScoreStores(scoreStore, remote.scoreStore);
  }
  if (remoteTs >= lastLocalUpdatedAt) lastLocalUpdatedAt = remoteTs;
  var diskState = Object.assign({}, state, { scoreStore: scoreStore, clientUpdatedAt: lastLocalUpdatedAt });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(diskState));
  saveScoreStoreToDisk(scoreStore);
  return true;
}

function saveState(){
  lastLocalUpdatedAt = Date.now();
  var diskState = Object.assign({}, state, { scoreStore: scoreStore, clientUpdatedAt: lastLocalUpdatedAt });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(diskState));
  saveScoreStoreToDisk(scoreStore);
  if (window._firebaseSave) window._firebaseSave(buildSyncPayload());
}

var state = loadState();
normalizeAllTeams(state);
saveState();

// Firebase sync bootstraps asynchronously after DOMContentLoaded
// window._firebaseSave and window._firebaseLoaded are set by the module

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
  var resetConfirmNoSave = byId('resetConfirmNoSave');
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
  // setterPosSelect removed

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
    var pressureHeader = pressureLabel || thPressure;
    if (pressureHeader){
      pressureHeader.textContent = L.midPct;
      pressureHeader.title = (uiMode === 'player') ? SERVE_IN_TOOLTIP : SERVE_PRESSURE_TOOLTIP;
    }
    if (thPassAtt) thPassAtt.textContent = L.passAtt;
    if (thPassAvg){
      thPassAvg.textContent = L.passAvg;
      thPassAvg.title = (uiMode === 'coach') ? RECV_PRESSURE_TOOLTIP : '';
    }
    if (hintText) hintText.textContent = L.hint;
    if (pressureLegendBar) pressureLegendBar.style.display = (uiMode === 'player') ? 'none' : '';
    if (pressureLegendLabels) pressureLegendLabels.style.display = (uiMode === 'player') ? 'none' : '';
    if (rotationBtn) rotationBtn.style.display = '';
    // Score bar rotation button — visible when a team with players exists
    var scoreRotBtn = byId('scoreRotationBtn');
    if (scoreRotBtn){
      var hasRosterForRot = !!(activeTeam() && activeTeam().players && activeTeam().players.length);
      scoreRotBtn.style.display = hasRosterForRot ? '' : 'none';
    }
    if (modePlayerBtn) modePlayerBtn.setAttribute('aria-pressed', uiMode === 'player' ? 'true' : 'false');
    if (modeCoachBtn) modeCoachBtn.setAttribute('aria-pressed', uiMode === 'coach' ? 'true' : 'false');
    // Keep score-bar floating toggle in sync
    var smPlayer = byId('scoreModePlayer');
    var smCoach  = byId('scoreModeCoach');
    if (smPlayer) smPlayer.setAttribute('aria-pressed', uiMode === 'player' ? 'true' : 'false');
    if (smCoach)  smCoach.setAttribute('aria-pressed',  uiMode === 'coach'  ? 'true' : 'false');
    updateRotationFAB();
  }
  function setUiMode(next){
    uiMode = (next === 'coach') ? 'coach' : 'player';
    saveUiMode(uiMode);
    applyModeToUI();
    syncExportNameDefault();
    renderTable();
    // rotation stays open regardless of mode
  }
  if (modePlayerBtn) modePlayerBtn.addEventListener('click', function(){ setUiMode('player'); });
  if (modeCoachBtn) modeCoachBtn.addEventListener('click', function(){ setUiMode('coach'); });

  // Score-bar floating mode toggle
  var scoreModePlayerBtn = byId('scoreModePlayer');
  var scoreModeCoachBtn  = byId('scoreModeCoach');
  if (scoreModePlayerBtn) scoreModePlayerBtn.addEventListener('click', function(){ setUiMode('player'); });
  if (scoreModeCoachBtn)  scoreModeCoachBtn.addEventListener('click',  function(){ setUiMode('coach');  });

  // Rotation FAB visibility
  function updateRotationFAB(){
    var fab = byId('rotationFAB');
    if (!fab) return;
    var team = activeTeam();
    var hasRoster = !!(team && team.players && team.players.length);
    var show = hasRoster;
    fab.style.display = show ? 'flex' : 'none';
  }

  function updateOnboardingAndControls(){
    buildDesktopStrip();
    renderRotationStrip();
    updateRotationFAB();
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
  if (resetConfirmNoSave) resetConfirmNoSave.addEventListener('click', function(){ closeResetConfirmModal('nosave'); });
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

  // Serve pressure: higher % is better for us → green when high
  function servePressureHeatStyle(pct){
    var v = Number.isFinite(pct) ? pct : 0;
    var t = Math.max(0, Math.min(1, v));
    var hue = 120 * t;
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
    var oppRecIn  = s1+s2+s3; // passes they got (excludes aces = their 0-pass)

    var oppPts = (s1*3) + (s2*2) + (s3*1) + (ace*0);
    var oppSrAvg = oppRecAtt ? (oppPts/oppRecAtt) : 0;

    var serveInPct = safePct(serveIn, serveAttPlayer);
    var servePressureHits = s1 + ace;
    var servePressurePct = safePct(servePressureHits, oppRecAtt);

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
      oppRecIn:  oppRecIn,
      oppSrAvg: oppSrAvg,
      servePressureHits: servePressureHits,
      servePressurePct: servePressurePct,
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
      errRotation: nz(c.errRotation,0),
      dig: nz(c.dig,0),
      digErr: nz(c.digErr,0),
      blockKill: nz(c.blockKill,0),
      blockErr: nz(c.blockErr,0),
      oos: nz(c.oos,0)
    };
  }

  function td(text, cls){ var el = document.createElement('td'); el.textContent = text; if (cls) el.className = cls; return el; }

  function renderTable(){
    statsBody.innerHTML='';
    var team = activeTeam();
    if (!team) return;

    var serverId = null;
    ensureRotation(team);
    autoFillBaseFromRoster(team);
    serverId = getServerPlayerId(team);

    var players = (team.players || []).slice().sort(sortPlayers);
    for (var i=0;i<players.length;i++){
      var p = players[i];
      var d = derived(p.id);
      var tr = document.createElement('tr');

      if (serverId && p.id === serverId){
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

      var sInCell = td(uiMode==='coach' ? String(d.oppRecIn) : String(d.serveIn));
      sInCell.style.background='#eff6ff';
      tr.appendChild(sInCell);

      var aceCell = td(String(d.aceCount));
      aceCell.style.background='#eff6ff';
      tr.appendChild(aceCell);

      var midPct = (uiMode === 'coach') ? d.servePressurePct : d.serveInPct;
      var pctCell = td(fmtPct(midPct));
      pctCell.style.background='#eff6ff';
      if (uiMode === 'coach'){
        var heat = servePressureHeatStyle(midPct);
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
      if (uiMode === 'coach') passAvgCell.title = RECV_PRESSURE_TOOLTIP;
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

      // ── DEFENSE columns (before errors) ──
      var digCell = td(String(d.dig));
      digCell.style.background='#e0f2fe'; digCell.style.borderLeft='2px solid #7dd3fc';
      if (d.dig > 0) digCell.style.color='#0369a1';
      tr.appendChild(digCell);

      var digErrCell = td(String(d.digErr));
      digErrCell.style.background='#e0f2fe';
      if (d.digErr > 0) digErrCell.style.color='#dc2626';
      tr.appendChild(digErrCell);

      var blkKillCell = td(String(d.blockKill));
      blkKillCell.style.background='#ede9fe'; blkKillCell.style.borderLeft='2px solid #c4b5fd';
      if (d.blockKill > 0) blkKillCell.style.color='#6d28d9';
      tr.appendChild(blkKillCell);

      var blkErrCell = td(String(d.blockErr));
      blkErrCell.style.background='#ede9fe';
      if (d.blockErr > 0) blkErrCell.style.color='#dc2626';
      tr.appendChild(blkErrCell);

      var oosCell = td(String(d.oos));
      oosCell.style.background='#fef9c3'; oosCell.style.borderLeft='2px solid #fde047';
      if (d.oos > 0) oosCell.style.color='#854d0e';
      tr.appendChild(oosCell);

      // ── ERROR columns ──
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
        oppRecAtt:0, oppRecIn:0, servePressureHits:0,
        passAtt:0, passPts:0, hitAtt:0, hitsIn:0, kills:0,
        aceCount:0, totalErrors:0,
        errHitting:0, errServing:0, errPassing:0,
        errNet:0, errTwoHand:0, errRotation:0,
        dig:0, digErr:0, blockKill:0, blockErr:0, oos:0
      };
      for (var ti=0; ti<players.length; ti++){
        var dd = derived(players[ti].id);
        totals.serveAtt   += dd.serveAttPlayer;
        totals.serveIn    += dd.serveIn;
        totals.oppRecAtt  += dd.oppRecAtt;
        totals.oppRecIn   += dd.oppRecIn;
        totals.servePressureHits += dd.servePressureHits;
        totals.passAtt    += dd.passAtt;
        totals.passPts    += dd.passAvg * dd.passAtt;
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
        totals.dig        += dd.dig;
        totals.digErr     += dd.digErr;
        totals.blockKill  += dd.blockKill;
        totals.blockErr   += dd.blockErr;
        totals.oos        += dd.oos;
      }
      var serveInPctTot = totals.serveAtt ? totals.serveIn / totals.serveAtt : 0;
      var servePressurePctTot = totals.oppRecAtt ? totals.servePressureHits / totals.oppRecAtt : 0;
      var recvPressureTot = totals.passAtt ? totals.passPts / totals.passAtt : 0;
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
      if (uiMode === 'coach'){
        tfoot.appendChild(ftd(String(totals.oppRecAtt), '#dde9ff'));
        tfoot.appendChild(ftd(String(totals.oppRecIn), '#dde9ff'));
        tfoot.appendChild(ftd(String(totals.aceCount), '#dde9ff'));
        var pctTotCell = ftd(fmtPct(servePressurePctTot), '#dde9ff');
        var svrHeat = servePressureHeatStyle(servePressurePctTot);
        pctTotCell.style.background = svrHeat.bg;
        pctTotCell.style.color = svrHeat.fg;
        tfoot.appendChild(pctTotCell);
      } else {
        tfoot.appendChild(ftd(String(totals.serveAtt), '#dde9ff'));
        tfoot.appendChild(ftd(String(totals.serveIn), '#dde9ff'));
        tfoot.appendChild(ftd(String(totals.aceCount), '#dde9ff'));
        tfoot.appendChild(ftd(fmtPct(serveInPctTot), '#dde9ff'));
      }

      // Pass cols
      tfoot.appendChild(ftd(String(totals.passAtt), '#c7d8f8', {borderLeft:'2px solid #bfdbfe'}));
      if (uiMode === 'coach'){
        var recvTotCell = ftd(fmtNum(recvPressureTot, 2), '#c7d8f8');
        if (totals.passAtt > 0){
          if (recvPressureTot < 2.0) recvTotCell.style.color = '#dc2626';
          else if (recvPressureTot >= 2.5) recvTotCell.style.color = '#16a34a';
        }
        tfoot.appendChild(recvTotCell);
      } else {
        tfoot.appendChild(ftd('', '#c7d8f8'));
      }

      // Hit cols
      tfoot.appendChild(ftd(String(totals.hitAtt), '#dde9ff', {borderLeft:'2px solid #bfdbfe'}));
      tfoot.appendChild(ftd(String(totals.hitsIn), '#dde9ff'));
      tfoot.appendChild(ftd('', '#dde9ff'));
      tfoot.appendChild(ftd('', '#dde9ff'));

      // Defense totals (before errors)
      tfoot.appendChild(ftd(String(totals.dig),       '#bae6fd', {borderLeft:'2px solid #7dd3fc', color: totals.dig>0?'#0369a1':''}));
      tfoot.appendChild(ftd(String(totals.digErr),    '#bae6fd', {color: totals.digErr>0?'#dc2626':''}));
      tfoot.appendChild(ftd(String(totals.blockKill), '#ddd6fe', {borderLeft:'2px solid #c4b5fd', color: totals.blockKill>0?'#6d28d9':''}));
      tfoot.appendChild(ftd(String(totals.blockErr),  '#ddd6fe', {color: totals.blockErr>0?'#dc2626':''}));
      tfoot.appendChild(ftd(String(totals.oos),       '#fef08a', {borderLeft:'2px solid #fde047', color: totals.oos>0?'#854d0e':''}));

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
  // ── Audio feedback (iOS-compatible via Web Audio API) ─────────────────────
  var _audioCtx = null;

  function getAudioCtx(){
    if (_audioCtx) return _audioCtx;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) _audioCtx = new Ctx();
    } catch(e) {}
    return _audioCtx;
  }

  // Resume context if suspended (required on iOS after page load)
  function resumeAudio(){
    var ctx = getAudioCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  // Short percussive click — frequency and duration tuned for courtside use
  function playStatClick(type){
    var ctx = getAudioCtx();
    if (!ctx) return;
    try {
      var now = ctx.currentTime;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'rally'){
        // Double click for SIDE OUT / OPP SCORE
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(660, now + 0.06);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.18);
      } else if (type === 'error'){
        // Lower tone for error/out stats
        osc.frequency.setValueAtTime(300, now);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      } else {
        // Standard stat click
        osc.frequency.setValueAtTime(600, now);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.start(now);
        osc.stop(now + 0.08);
      }
    } catch(e) {}
  }

  // iOS requires AudioContext to be created/resumed from a user gesture.
  // We resume on the first touch/click anywhere on the page.
  document.addEventListener('touchstart', resumeAudio, { once: true, passive: true });
  document.addEventListener('mousedown',  resumeAudio, { once: true, passive: true });

  // ── Visual stat feedback (button pulse + top banner) ─────────────────────
  var _statBannerTimer = null;
  function showStatFeedback(btn, isError){
    // Top banner
    var banner = document.getElementById('statBanner');
    if (banner){
      clearTimeout(_statBannerTimer);
      banner.textContent = isError ? '✗ Error recorded' : '✓ Recorded';
      banner.classList.toggle('error-banner', !!isError);
      banner.classList.add('visible');
      _statBannerTimer = setTimeout(function(){ banner.classList.remove('visible'); }, 900);
    }
    // Button pulse — find the last-tapped stat button
    if (btn && btn.classList){
      btn.classList.remove('stat-recorded');
      // Force reflow so animation restarts
      void btn.offsetWidth;
      var origBg = btn.style.background;
      var origColor = btn.style.color;
      btn.style.background = isError ? '#b91c1c' : '#16a34a';
      btn.style.color = '#fff';
      setTimeout(function(){
        btn.style.background = origBg;
        btn.style.color = origColor;
      }, 550);
    }
  }
  var _lastStatBtn = null; // track last tapped stat button for feedback

  function recordEvent(action, playerId){
    var team = activeTeam();
    if (!team) return;

    // Haptic (Android) + audio click (iOS and all devices)
    if (navigator.vibrate) navigator.vibrate(18);
    var clickType = (action === 'serveOut' || action === 'swingOut' || action === 'passShank' ||
                     action === 'errPassing' || action === 'errNet' || action === 'errTwoHand' ||
                     action === 'errRotation') ? 'error' : 'stat';
    playStatClick(clickType);

    var match = getMatchKey();
    var set = setSelect.value || '1';

    ensureCounters(team, match, set, playerId);
    var counters = team.data[match][set][playerId];

    if (counters[action] === undefined) Object.assign(counters, Object.assign(emptyCounters(), counters));
    if (counters[action] === undefined){
      alert('Unknown action. Try reloading the page.');
      return;
    }

    // Snapshot state BEFORE the change so undo can fully restore it
    var _scoreBefore = { our: (currentScore().our || 0), opp: (currentScore().opp || 0) };
    var _rotBefore   = JSON.parse(JSON.stringify(team.rotation || {}));

    counters[action] = nz(counters[action],0) + 1;
    team.history.push({ match:match, set:set, playerId:playerId, action:action, ts:Date.now(),
                        scoreBefore:_scoreBefore, rotationBefore:_rotBefore });

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
      advanceRotation(team);
      team.rotation.hasBall = true;
      team.rotation.srMode  = false;
      autoSelectServer();
    } else if (WE_WIN_RALLY){
      team.rotation.hasBall = true;
      team.rotation.srMode  = false;
      autoSelectServer();
    } else if (WE_LOSE_RALLY){
      // Lost the rally → opponent now serves → auto-enter serve receive
      team.rotation.hasBall = false;
      team.rotation.srMode  = true;
    }

    saveState();
    closePicker();
    renderTable();
    updateOnboardingAndControls();
    renderRotationStrip();
    if (rotationBackdrop && rotationBackdrop.style.display !== 'none') renderRotationWheel();

    // Visual feedback — button pulse + top banner
    var isErr = (action === 'serveOut' || action === 'swingOut' || action === 'passShank' ||
                 action === 'errPassing' || action === 'errNet' || action === 'errTwoHand' ||
                 action === 'errRotation');
    showStatFeedback(_lastStatBtn, isErr);
    _lastStatBtn = null;
  }

  // Picker
  function openPicker(){
    if (!pickerBackdrop || !playerGrid) return;
    buildPlayerGrid();
    // Show/update quick-record banner for currently selected player
    var quickBar = byId('pickerQuickBar');
    if (quickBar){
      if (selectionMode === 'rotationManualSub' || selectionMode === 'rotationAutoSub' || selectionMode === 'setBaseAssign'){
        quickBar.style.display = 'none';
      } else {
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
    }
    pickerBackdrop.style.zIndex = '1200';
    showModal(pickerBackdrop);
  }
  var _rotMenuReopenSlot = null;
  var _rotMenuReopenExpand = null;

  function getRotationPickerCandidates(team, mode, payload){
    if (mode === 'rotationManualSub' || mode === 'rotationAutoSub'){
      return rosterSubPickerPlayers(team);
    }
    return (team && team.players) ? team.players.slice() : [];
  }

  function openRotationSubPicker(team, baseSlot, mode, expandKey){
    selectionMode = mode;
    selectionPayload = baseSlot;
    pendingAction = null;
    _rotationWasOpenBeforePicker = true;
    _rotMenuReopenSlot = baseSlot;
    _rotMenuReopenExpand = expandKey;
    if (pickerTitle){
      var slotLabel = BASE_SLOT_LABELS[baseSlot] || '';
      var titleBase = mode === 'rotationAutoSub' ? 'Choose auto-sub' : 'Choose substitute';
      pickerTitle.textContent = titleBase + (slotLabel ? ' — ' + slotLabel : '');
    }
    if (pickerBackdrop) pickerBackdrop.style.zIndex = '1300';
    if (rotationBackdrop) rotationBackdrop.style.zIndex = '1100';
    openPicker();
  }

  function closePicker(){
    hideModal(pickerBackdrop);
    pendingAction = null;
    selectionMode = null;
    selectionPayload = null;

    var reopenSlot = _rotMenuReopenSlot;
    var reopenExpand = _rotMenuReopenExpand;
    var reopenAnchor = _rotMenuAnchor;
    _rotMenuReopenSlot = null;
    _rotMenuReopenExpand = null;

    if (_rotationWasOpenBeforePicker && rotationBackdrop){
      rotationBackdrop.style.display = 'flex';
      rotationBackdrop.classList.remove('hidden');
      rotationBackdrop.style.zIndex = '1100';
      if (pickerBackdrop) pickerBackdrop.style.zIndex = '1200';
      renderRotationWheel();
      if (reopenSlot && reopenAnchor){
        var team = activeTeam();
        if (team){
          _rotMenuBaseSlot = reopenSlot;
          _rotMenuExpand = reopenExpand;
          buildRotPlayerMenu(team, reopenSlot, reopenAnchor);
          var menu = document.getElementById('rotPlayerMenu');
          if (menu) positionRotPlayerMenu(menu, reopenAnchor);
        }
      }
    }
    _rotationWasOpenBeforePicker = false;
  }

  function buildPlayerGrid(){
    if (!playerGrid) return;
    var team = activeTeam();
    playerGrid.innerHTML='';
    var players = (team && team.players ? team.players.slice() : []);
    if (selectionMode === 'rotationManualSub' || selectionMode === 'rotationAutoSub'){
      players = getRotationPickerCandidates(team, selectionMode, selectionPayload);
    }
    players.sort(sortPlayers);

    if (!players.length){
      var empty = document.createElement('div');
      empty.className = 'roster-item';
      empty.style.cssText = 'grid-column:1/-1;padding:12px;color:#6b7280;font-size:13px;';
      empty.textContent = 'No players on roster. Add players in Roster first.';
      playerGrid.appendChild(empty);
      return;
    }

    var isSubPicker = selectionMode === 'rotationManualSub' || selectionMode === 'rotationAutoSub';

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
        var posTxt = p.position ? ('Pos: ' + p.position) : 'Pos: —';
        if (isSubPicker){
          var tags = getSubPickerPlayerTags(team, p.id);
          sub.textContent = tags.length ? posTxt + ' · ' + tags.join(', ') : posTxt;
        } else {
          sub.textContent = posTxt;
        }
        if (p.id === activePlayerId) sub.style.color = 'rgba(255,255,255,0.75)';
        btn.appendChild(sub);

        btn.addEventListener('click', function(){
          var team = activeTeam();
          if (!team) return;

          // rotation assignment mode
          if (selectionMode === 'rotationAssign'){
            ensureRotation(team);
            autoFillBaseFromRoster(team);
            // Capture flag BEFORE hiding the backdrop, then keep it true so closePicker reopens modal
            _rotationWasOpenBeforePicker = true;
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

          if (selectionMode === 'setBaseAssign'){
            var setPos = parseInt(selectionPayload, 10);
            if (setPos >= 1 && setPos <= 6){
              _rotationWasOpenBeforePicker = true;
              if (pickerBackdrop) pickerBackdrop.style.zIndex = '1300';
              if (rotationBackdrop) rotationBackdrop.style.zIndex = '1100';
              _setBaseDraft[setPos] = p.id;
              for (var k=1; k<=6; k++){
                if (k !== setPos && _setBaseDraft[k] === p.id) _setBaseDraft[k] = null;
              }
              closePicker();
              renderSetBasePanel();
              return;
            }
          }

          if (selectionMode === 'rotationManualSub'){
            var manSlot = parseInt(selectionPayload, 10);
            if (manSlot >= 1 && manSlot <= 6){
              _rotationWasOpenBeforePicker = true;
              if (pickerBackdrop) pickerBackdrop.style.zIndex = '1300';
              if (rotationBackdrop) rotationBackdrop.style.zIndex = '1100';
              _rotMenuReopenSlot = null;
              _rotMenuReopenExpand = null;
              applyManualSub(team, manSlot, p.id);
              closePicker();
              return;
            }
          }

          if (selectionMode === 'rotationAutoSub'){
            var autoSlot = parseInt(selectionPayload, 10);
            if (autoSlot >= 1 && autoSlot <= 6){
              _rotationWasOpenBeforePicker = true;
              if (pickerBackdrop) pickerBackdrop.style.zIndex = '1300';
              if (rotationBackdrop) rotationBackdrop.style.zIndex = '1100';
              clearActiveAutoSub(team, autoSlot);
              if (!team.rotation.autoSubs) team.rotation.autoSubs = {};
              team.rotation.autoSubs[autoSlot] = p.id;
              if (!team.rotation.autoSubPos) team.rotation.autoSubPos = {};
              if (!team.rotation.autoSubPos[autoSlot]) team.rotation.autoSubPos[autoSlot] = 1;
              saveState();
              closePicker();
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

  // Actions that auto-assign to the active player (no picker required)
  var SERVE_ACTIONS = { serve1:1, serve2:1, serve3:1, ace:1, serveOut:1 };

  // ── Server confirmation toast ─────────────────────────────────────────────
  var _serverConfirmTimer   = null;
  var _serverConfirmAction  = null;
  var _serverConfirmPid     = null;
  var serverConfirmToast    = byId('serverConfirmToast');
  var serverConfirmName     = byId('serverConfirmName');
  var serverConfirmOk       = byId('serverConfirmOk');
  var serverConfirmChange   = byId('serverConfirmChange');
  var serverConfirmBarFill  = byId('serverConfirmBarFill');

  function hideServerConfirm(){
    if (serverConfirmToast) serverConfirmToast.style.display = 'none';
    clearTimeout(_serverConfirmTimer);
    if (serverConfirmBarFill){ serverConfirmBarFill.style.transition = 'none'; serverConfirmBarFill.style.width = '100%'; }
    _serverConfirmAction = null;
    _serverConfirmPid    = null;
  }

  function showServerConfirm(action, pid){
    var team = activeTeam();
    var player = team ? (team.players||[]).find(function(p){ return p.id === pid; }) : null;
    if (!player){ recordEvent(action, pid); return; } // no name available — just record
    _serverConfirmAction = action;
    _serverConfirmPid    = pid;
    if (serverConfirmName) serverConfirmName.textContent = (player.number ? '#'+player.number+' ' : '') + player.name;
    if (serverConfirmToast) serverConfirmToast.style.display = 'block';
    // Countdown bar — auto-confirm after 2.5s
    if (serverConfirmBarFill){
      serverConfirmBarFill.style.transition = 'none';
      serverConfirmBarFill.style.width = '100%';
      requestAnimationFrame(function(){ requestAnimationFrame(function(){
        serverConfirmBarFill.style.transition = 'width 2.5s linear';
        serverConfirmBarFill.style.width = '0%';
      }); });
    }
    clearTimeout(_serverConfirmTimer);
    _serverConfirmTimer = setTimeout(function(){
      if (_serverConfirmAction){ recordEvent(_serverConfirmAction, _serverConfirmPid); }
      hideServerConfirm();
    }, 2500);
  }

  if (serverConfirmOk) serverConfirmOk.addEventListener('click', function(){
    if (_serverConfirmAction) recordEvent(_serverConfirmAction, _serverConfirmPid);
    hideServerConfirm();
  });

  if (serverConfirmChange) serverConfirmChange.addEventListener('click', function(){
    var action = _serverConfirmAction;
    hideServerConfirm();
    pendingAction = action;
    selectionMode = null;
    selectionPayload = null;
    if (pickerTitle) pickerTitle.textContent = 'Select Server — ' + prettyAction(action);
    openPicker();
  });

  function handleServeAction(action){
    if (!activePlayerId) autoSelectServer();
    if (activePlayerId){
      showServerConfirm(action, activePlayerId);
    } else {
      // No server known at all — open picker
      pendingAction = action;
      selectionMode = null;
      selectionPayload = null;
      if (pickerTitle) pickerTitle.textContent = 'Select Server — ' + prettyAction(action);
      openPicker();
    }
  }

  // Desktop toolbar stat buttons
  var toolbarBtns = document.querySelectorAll('.toolbar button[data-action]');
  for (var tb=0; tb<toolbarBtns.length; tb++){
    toolbarBtns[tb].addEventListener('click', function(){
      if (this.disabled) return;
      _lastStatBtn = this;
      var action = this.getAttribute('data-action');
      if (SERVE_ACTIONS[action]){ handleServeAction(action); return; }
      // All non-serve stats always open the picker for explicit player selection
      pendingAction = action;
      selectionMode = null;
      selectionPayload = null;
      if (pickerTitle) pickerTitle.textContent = 'Select Player — ' + prettyAction(action);
      openPicker();
    });
  }

  // Mobile stat buttons
  var mobileStatBtnsList = document.querySelectorAll('.stat-btn[data-action]');
  for (var ms=0; ms<mobileStatBtnsList.length; ms++){
    mobileStatBtnsList[ms].addEventListener('click', function(){
      if (this.disabled) return;
      _lastStatBtn = this;
      var action = this.getAttribute('data-action');
      if (SERVE_ACTIONS[action]){ handleServeAction(action); return; }
      // All non-serve stats always open the picker for explicit player selection
      pendingAction = action;
      selectionMode = null;
      selectionPayload = null;
      if (pickerTitle) pickerTitle.textContent = 'Select Player — ' + prettyAction(action);
      openPicker();
    });
  }

  // Rotation wheel
  function playerNameById(team, pid){
    if (!team || !team.players || !pid) return '—';
    for (var i=0;i<team.players.length;i++) if (team.players[i].id === pid) return team.players[i].name;
    return '—';
  }

  function getCourtSubBaseLabel(team, courtPos, pid){
    if (!pid) return null;
    var offset = team.rotation.offset || 0;
    if (team.rotation.manualSubPairs){
      for (var mSlot in team.rotation.manualSubPairs){
        var ms = parseInt(mSlot, 10);
        var pair = team.rotation.manualSubPairs[mSlot];
        if (!pair || pair.in !== pid) continue;
        if (rotatedPos(ms, offset) !== courtPos) continue;
        return BASE_SLOT_LABELS[ms];
      }
    }
    if (team.rotation.autoSubs){
      for (var slot=1; slot<=6; slot++){
        if (team.rotation.autoSubs[slot] !== pid) continue;
        if (team.rotation.base[slot] !== pid) continue;
        var orig = (team.rotation.autoSubOriginals || {})[slot];
        if (!orig || orig === pid) continue;
        if (rotatedPos(slot, offset) !== courtPos) continue;
        return BASE_SLOT_LABELS[slot];
      }
    }
    if (team.rotation.liberoActive){
      var libId = team.rotation.liberoId || getLiberoId(team);
      if (pid === libId){
        var libTargetPos = (team.rotation.liberoSlot === 'MB2') ? getMB2CurrentPos(team) : getMB1CurrentPos(team);
        if (libTargetPos === courtPos) return team.rotation.liberoSlot || 'MB';
      }
    }
    return null;
  }

  function buildPlayerNameLine(name, baseLabel){
    var el = document.createElement('div');
    el.className = 'rot-player-name';
    if (!name){
      el.textContent = 'Double-tap for options';
      el.style.color = '#9ca3af';
      return el;
    }
    el.appendChild(document.createTextNode(firstName(name) + ' '));
    if (baseLabel){
      var span = document.createElement('span');
      span.className = 'rot-base-pos';
      span.textContent = '(' + baseLabel + ')';
      el.appendChild(span);
    }
    return el;
  }

  function updateSubCountDisplay(team){
    var el = document.getElementById('subCountDisplay');
    if (el && team) el.textContent = 'Subs: ' + ((team.rotation || {}).subCount || 0) + '/15 (excl. libero)';
  }

  function slotHasRules(team, slot){
    if (!team || !team.rotation) return false;
    if (isMBBaseSlot(slot)) return true;
    if (isSubRuleSlot(slot)) return !!(team.rotation.autoSubs && team.rotation.autoSubs[slot]);
    return false;
  }

  var _rotMenuAnchor = null;
  var _rotMenuBaseSlot = null;
  var _rotMenuExpand = null;
  var _setBaseMode = false;
  var _setBaseDraft = { 1:null, 2:null, 3:null, 4:null, 5:null, 6:null };

  function lineupFromBase(team){
    ensureRotation(team);
    return courtLineupFromBaseObj(team.rotation.base);
  }

  function resetSetBaseDraft(){
    var team = activeTeam();
    if (team && team.savedBase){
      _setBaseDraft = courtLineupFromBaseObj(team.savedBase);
    } else if (team) {
      _setBaseDraft = lineupFromBase(team);
    } else {
      _setBaseDraft = { 1:null, 2:null, 3:null, 4:null, 5:null, 6:null };
    }
    renderSetBasePanel();
  }

  function resetRotationOnCourt(){
    var team = activeTeam();
    if (!team) return;
    if (!team.savedBase){
      alert('No saved base lineup yet. Use Set Base and Save Base first.');
      return;
    }
    restoreRotationOneBase(team);
    closeRotPlayerMenu();
    saveState();
    autoSelectServer();
    renderRotationWheel();
    renderTable();
    renderRotationStrip();
    var hint = document.getElementById('rotationHint');
    if (hint) hint.textContent = 'Back to Rot 1 — starting lineup restored.';
  }

  function updateLiberoBtn(team){
    var btn = byId('rotationLiberoBtn');
    if (!btn) return;
    if (_setBaseMode || !team){
      btn.style.display = 'none';
      return;
    }
    btn.style.display = '';
    var target = getLiberoDisplayTarget(team);
    var libId = getLiberoId(team);
    if (!libId){
      btn.disabled = true;
      btn.textContent = 'No Libero';
      btn.style.background = '';
      btn.style.color = '';
      btn.style.borderColor = '';
      return;
    }
    btn.disabled = false;
    var suffix = target ? (' (' + target + ')') : '';
    if (team.rotation.liberoActive){
      btn.textContent = 'Libero ✓' + suffix;
      btn.style.background = '#d97706';
      btn.style.color = '#fff';
      btn.style.borderColor = '#b45309';
      btn.title = target
        ? ('Libero on court for ' + target + ' — tap to remove')
        : 'Libero on court — tap to remove';
    } else {
      btn.textContent = 'Libero In' + suffix;
      btn.style.background = '';
      btn.style.color = '';
      btn.style.borderColor = '';
      btn.title = target
        ? ('Put libero on court for ' + target + ' at back row (pos 1, 5, or 6)')
        : 'Put libero on court when a middle reaches the back row';
    }
  }

  function toggleLiberoStart(team){
    ensureRotation(team);
    autoFillBaseFromRoster(team);
    if (team.rotation.liberoActive){
      deactivateLibero(team);
      return;
    }
    if (!getLiberoId(team)){
      alert('No libero on roster (position LIB).');
      return;
    }
    if (tryActivateLibero(team, undefined, true)){
      return;
    }
    var off = team.rotation.offset || 0;
    var mb2Pos = rotatedPos(3, off);
    var mb1Pos = rotatedPos(6, off);
    if (isMiddleBackRowPos(mb2Pos) && shouldSkipLiberoForMiddle(team, 'MB2', mb2Pos, false)){
      alert('MB2 is at pos 1 with “I will serve” on — libero enters on the next rotation (pos 5 or 6), or turn off “I will serve” on MB2.');
      return;
    }
    if (isMiddleBackRowPos(mb1Pos) && shouldSkipLiberoForMiddle(team, 'MB1', mb1Pos, false)){
      alert('MB1 is at pos 1 with “I will serve” on — libero enters on the next rotation (pos 5 or 6), or turn off “I will serve” on MB1.');
      return;
    }
    if ((isMiddleBackRowPos(mb2Pos) && !liberoEnabledForMiddle(team, 'MB2'))
        || (isMiddleBackRowPos(mb1Pos) && !liberoEnabledForMiddle(team, 'MB1'))){
      alert('Libero is off for the middle in the back row — middle plays back row. Turn on “Libero replaces back row” on that middle, or add a LIB player to the roster.');
      return;
    }
    if (isMiddleBackRowPos(mb2Pos) || isMiddleBackRowPos(mb1Pos)){
      alert('A middle is in the back row but libero could not be placed. Check that a player with position LIB is on the roster.');
      return;
    }
    var target = getLiberoDisplayTarget(team);
    if (target){
      alert(target + ' is in the front row. Libero will enter automatically on the next back-row rotation.');
    } else {
      alert('No middle is in the back row yet. Libero will enter on the next rotation.');
    }
  }

  function syncRotationModalFooter(){
    var courtView = document.getElementById('rotationCourtView');
    var panel = document.getElementById('setBasePanel');
    var coachCtrls = document.getElementById('rotationCoachControls');
    var setBaseActs = document.getElementById('setBaseActions');
    var hint = document.getElementById('rotationHint');
    var doneBtn = byId('rotationDone');
    if (_setBaseMode){
      if (courtView) courtView.classList.add('set-base-mode');
      if (panel) panel.classList.add('open');
      if (coachCtrls) coachCtrls.style.display = 'none';
      if (setBaseActs) setBaseActs.style.display = 'flex';
      if (hint) hint.textContent = 'Starting lineup — tap each position, then Save Base.';
      if (doneBtn) doneBtn.style.display = 'none';
    } else {
      if (courtView) courtView.classList.remove('set-base-mode');
      if (panel) panel.classList.remove('open');
      if (coachCtrls) coachCtrls.style.display = 'flex';
      if (setBaseActs) setBaseActs.style.display = 'none';
      if (hint) hint.textContent = 'Double-tap a player for Sub · Auto-sub · Serving';
      if (doneBtn) doneBtn.style.display = '';
    }
    updateLiberoBtn(activeTeam());
  }

  function enterSetBaseMode(){
    var team = activeTeam();
    if (!team){
      alert('Select a team first.');
      return;
    }
    ensureRotation(team);
    autoFillBaseFromRoster(team);
    closeRotPlayerMenu();
    _setBaseMode = true;
    _setBaseDraft = lineupFromBase(team);
    syncRotationModalFooter();
    renderSetBasePanel();
    var panel = document.getElementById('setBasePanel');
    if (panel && panel.scrollIntoView) panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function exitSetBaseMode(){
    _setBaseMode = false;
    syncRotationModalFooter();
  }

  function renderSetBasePanel(){
    var court = document.getElementById('setBaseCourt');
    var team = activeTeam();
    if (!court || !team) return;
    court.innerHTML = '';

    var oppLabel = document.createElement('div');
    oppLabel.className = 'rotation-court-label';
    oppLabel.style.cssText = 'background:rgba(0,0,0,.2);color:rgba(255,255,255,.7);';
    oppLabel.textContent = '← Opponent Side / NET →';
    court.appendChild(oppLabel);

    function makeSetBaseSlot(courtPos){
      var pid = _setBaseDraft[courtPos];
      var player = pid ? (team.players || []).find(function(p){ return p.id === pid; }) : null;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'set-base-slot' + (player ? ' filled' : ' empty');
      var posEl = document.createElement('div');
      posEl.className = 'set-base-pos';
      posEl.textContent = 'Pos ' + courtPos + (courtPos === 1 ? ' · Serve' : '');
      btn.appendChild(posEl);
      var nameEl = document.createElement('div');
      nameEl.className = 'set-base-name';
      nameEl.textContent = player ? firstName(player.name) : 'Tap to assign';
      btn.appendChild(nameEl);
      if (player && player.number){
        var numEl = document.createElement('div');
        numEl.className = 'set-base-num';
        numEl.textContent = '#' + player.number + (player.position ? ' · ' + normPosToken(player.position) : '');
        btn.appendChild(numEl);
      }
      btn.addEventListener('click', function(e){
        e.preventDefault();
        e.stopPropagation();
        openSetBasePicker(courtPos);
      });
      return btn;
    }

    var frontRow = document.createElement('div');
    frontRow.className = 'rotation-row front';
    [4, 3, 2].forEach(function(pos){ frontRow.appendChild(makeSetBaseSlot(pos)); });
    court.appendChild(frontRow);

    var backRow = document.createElement('div');
    backRow.className = 'rotation-row back';
    [5, 6, 1].forEach(function(pos){ backRow.appendChild(makeSetBaseSlot(pos)); });
    court.appendChild(backRow);

    var ourLabel = document.createElement('div');
    ourLabel.className = 'rotation-court-label';
    ourLabel.style.cssText = 'background:rgba(0,0,0,.15);color:rgba(255,255,255,.6);';
    ourLabel.textContent = '← Our Bench Side →';
    court.appendChild(ourLabel);
  }

  function openSetBasePicker(courtPos){
    selectionMode = 'setBaseAssign';
    selectionPayload = courtPos;
    pendingAction = null;
    if (pickerTitle) pickerTitle.textContent = 'Set Base — Position ' + courtPos;
    _rotationWasOpenBeforePicker = true;
    if (pickerBackdrop) pickerBackdrop.style.zIndex = '1300';
    if (rotationBackdrop) rotationBackdrop.style.zIndex = '1100';
    openPicker();
  }

  function saveSetBase(){
    var team = activeTeam();
    if (!team) return;
    var missing = [];
    var used = {};
    for (var cp=1; cp<=6; cp++){
      var pid = _setBaseDraft[cp];
      if (!pid) missing.push(cp);
      else if (used[pid]) missing.push(cp);
      else used[pid] = true;
    }
    if (missing.length){
      alert('Assign a unique player to all 6 positions before saving.');
      return;
    }
    ensureRotation(team);
    for (var courtPos=1; courtPos<=6; courtPos++){
      var baseSlot = inverseBaseForCurrentPos(courtPos, 0);
      team.rotation.base[baseSlot] = _setBaseDraft[courtPos];
    }
    resetRotationRuntimeState(team);
    team.savedBase = JSON.parse(JSON.stringify(team.rotation.base));
    saveState();
    exitSetBaseMode();
    autoSelectServer();
    renderRotationWheel();
    renderTable();
    renderRotationStrip();
    var hint = document.getElementById('rotationHint');
    if (hint) hint.textContent = 'Base saved — tap Libero In to put libero on court for the back-row middle.';
  }

  function hideRotPlayerMenu(){
    var menu = document.getElementById('rotPlayerMenu');
    if (menu){ menu.classList.remove('open'); menu.innerHTML = ''; }
  }

  function closeRotPlayerMenu(){
    hideRotPlayerMenu();
    _rotMenuAnchor = null;
    _rotMenuBaseSlot = null;
    _rotMenuExpand = null;
  }

  function positionRotPlayerMenu(menu, anchor){
    var wrap = document.getElementById('rotationCourtWrap');
    if (!wrap || !anchor) return;
    var aRect = anchor.getBoundingClientRect();
    var wRect = wrap.getBoundingClientRect();
    menu.style.visibility = 'hidden';
    menu.classList.add('open');
    var top = aRect.bottom - wRect.top + 6;
    var left = aRect.left - wRect.left + (aRect.width / 2) - (menu.offsetWidth / 2);
    left = Math.max(4, Math.min(left, wRect.width - menu.offsetWidth - 4));
    if (top + menu.offsetHeight > wRect.height - 4){
      top = aRect.top - wRect.top - menu.offsetHeight - 6;
    }
    menu.style.top = Math.max(4, top) + 'px';
    menu.style.left = left + 'px';
    menu.style.visibility = 'visible';
  }

  function makeMenuToggle(isOn, onChange){
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rot-menu-toggle' + (isOn ? ' on' : '');
    btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      var next = !btn.classList.contains('on');
      btn.classList.toggle('on', next);
      btn.setAttribute('aria-pressed', next ? 'true' : 'false');
      onChange(next);
    });
    return btn;
  }

  function applyManualSub(team, baseSlot, subId){
    clearActiveAutoSub(team, baseSlot);
    delete team.rotation.autoSubs[baseSlot];
    delete team.rotation.autoSubPos[baseSlot];
    var outId = team.rotation.base[baseSlot];
    team.rotation.base[baseSlot] = subId;
    if (!team.rotation.manualSubPairs) team.rotation.manualSubPairs = {};
    team.rotation.manualSubPairs[baseSlot] = { in: subId, out: outId };
    if (shouldCountSubstitution(team, subId, outId, baseSlot)){
      team.rotation.subCount = (team.rotation.subCount || 0) + 1;
    }
    saveState();
    closeRotPlayerMenu();
    renderRotationWheel();
    renderTable();
  }

  function appendPlayerChips(container, candidates, selectedId, onPick){
    var chips = document.createElement('div');
    chips.className = 'rot-menu-chips';
    if (!candidates.length){
      var empty = document.createElement('div');
      empty.className = 'rot-menu-expand-hint';
      empty.textContent = 'No bench players available.';
      container.appendChild(empty);
      return;
    }
    candidates.sort(function(a,b){ return parseInt(a.number || 999, 10) - parseInt(b.number || 999, 10); })
      .forEach(function(p){
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'rot-menu-chip' + (selectedId === p.id ? ' selected' : '');
        chip.textContent = '#' + (p.number || '?') + ' ' + firstName(p.name);
        chip.addEventListener('click', function(e){
          e.stopPropagation();
          onPick(p.id);
        });
        chips.appendChild(chip);
      });
    container.appendChild(chips);
  }

  function buildRotPlayerMenu(team, baseSlot, anchor){
    var menu = document.getElementById('rotPlayerMenu');
    if (!menu) return;
    menu.innerHTML = '';
    _rotMenuAnchor = anchor;

    var occupantId = (team.rotation.base || {})[baseSlot];
    var occupant = occupantId ? (team.players || []).find(function(p){ return p.id === occupantId; }) : null;
    var slotLabel = BASE_SLOT_LABELS[baseSlot] || ('Slot ' + baseSlot);
    var baseCourtPos = rotatedPos(baseSlot, team.rotation.offset || 0);

    var title = document.createElement('div');
    title.className = 'rot-menu-title';
    title.textContent = occupant
      ? '#' + (occupant.number || '?') + ' ' + firstName(occupant.name) + ' · ' + slotLabel + ' (Pos ' + baseCourtPos + ')'
      : slotLabel + ' · Pos ' + baseCourtPos;
    menu.appendChild(title);

    function refreshMenu(){
      _rotMenuBaseSlot = baseSlot;
      saveState();
      buildRotPlayerMenu(team, baseSlot, anchor);
      positionRotPlayerMenu(menu, anchor);
    }

    function addChoosePlayerBtn(container, label, onClick){
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rot-menu-opt-btn';
      btn.style.marginTop = '6px';
      btn.textContent = label;
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        onClick();
      });
      container.appendChild(btn);
    }

    var opts = document.createElement('div');
    opts.className = 'rot-menu-options';

    // ── 1. Sub (immediate / injury / discipline) ─────────────────────────────
    var subBtn = document.createElement('button');
    subBtn.type = 'button';
    subBtn.className = 'rot-menu-opt-btn' + (_rotMenuExpand === 'sub' ? ' active' : '');
    subBtn.textContent = '1. Sub';
    subBtn.addEventListener('click', function(e){
      e.stopPropagation();
      openRotationSubPicker(team, baseSlot, 'rotationManualSub', 'sub');
    });
    opts.appendChild(subBtn);
    if (_rotMenuExpand === 'sub'){
      var subExpand = document.createElement('div');
      subExpand.className = 'rot-menu-expand';
      var subHint = document.createElement('div');
      subHint.className = 'rot-menu-expand-hint';
      subHint.textContent = 'Replace on court immediately (counts toward subs unless libero).';
      subExpand.appendChild(subHint);
      var subBench = benchManualSubCandidates(team, baseSlot);
      if (subBench.length){
        var subLbl = document.createElement('div');
        subLbl.className = 'rot-menu-label';
        subLbl.style.marginTop = '8px';
        subLbl.textContent = 'Quick pick';
        subExpand.appendChild(subLbl);
        appendPlayerChips(subExpand, subBench, null, function(subId){
          applyManualSub(team, baseSlot, subId);
        });
      }
      opts.appendChild(subExpand);
    }

    // ── 2. Auto-sub (or Libero for MB) ───────────────────────────────────────
    var autoBtn = document.createElement('button');
    autoBtn.type = 'button';
    autoBtn.className = 'rot-menu-opt-btn' + (_rotMenuExpand === 'autosub' ? ' active' : '');
    autoBtn.textContent = isMBBaseSlot(baseSlot) ? '2. Libero' : '2. Auto-sub';
    autoBtn.addEventListener('click', function(e){
      e.stopPropagation();
      if (isMBBaseSlot(baseSlot)){
        _rotMenuExpand = (_rotMenuExpand === 'autosub') ? null : 'autosub';
        buildRotPlayerMenu(team, baseSlot, anchor);
        positionRotPlayerMenu(menu, anchor);
        return;
      }
      openRotationSubPicker(team, baseSlot, 'rotationAutoSub', 'autosub');
    });
    opts.appendChild(autoBtn);
    if (_rotMenuExpand === 'autosub'){
      var autoExpand = document.createElement('div');
      autoExpand.className = 'rot-menu-expand';
      if (isMBBaseSlot(baseSlot)){
        var mbLabel = baseSlot === 3 ? 'MB2' : 'MB1';
        var libOn = liberoEnabledForMiddle(team, mbLabel);
        var libRow = document.createElement('div');
        libRow.className = 'rot-menu-row';
        libRow.appendChild(document.createTextNode('Libero replaces back row'));
        libRow.appendChild(makeMenuToggle(libOn, function(on){
          if (baseSlot === 3) team.rotation.liberoForMB2 = on;
          else team.rotation.liberoForMB1 = on;
          if (!on && team.rotation.liberoActive && team.rotation.liberoSlot === mbLabel){
            deactivateLibero(team);
          }
          applyRulesForOffset(team, team.rotation.offset || 0);
          saveState();
          renderRotationWheel();
          refreshMenu();
        }));
        autoExpand.appendChild(libRow);
        var libHint = document.createElement('div');
        libHint.className = 'rot-menu-expand-hint';
        libHint.textContent = 'Default on. At pos 1, libero replaces unless “I will serve” is on (Serving below). Turn off only if libero is unavailable — middle plays back row.';
        autoExpand.appendChild(libHint);
      } else if (isSubRuleSlot(baseSlot)){
        var hasSub = !!(team.rotation.autoSubs && team.rotation.autoSubs[baseSlot]);
        var selectedSubId = hasSub ? team.rotation.autoSubs[baseSlot] : null;
        var selectedSub = selectedSubId
          ? (team.players || []).find(function(p){ return p.id === selectedSubId; })
          : null;
        var autoHint = document.createElement('div');
        autoHint.className = 'rot-menu-expand-hint';
        autoHint.textContent = 'Pick who subs in on rotation when this player reaches the back row.';
        autoExpand.appendChild(autoHint);
        if (selectedSub){
          var curLbl = document.createElement('div');
          curLbl.className = 'rot-menu-expand-hint';
          curLbl.style.color = '#1e3a8a';
          curLbl.style.fontWeight = '800';
          curLbl.textContent = 'Selected: #' + (selectedSub.number || '?') + ' ' + firstName(selectedSub.name)
            + (selectedSub.position ? ' (' + normPosToken(selectedSub.position) + ')' : '');
          autoExpand.appendChild(curLbl);
        }
        var autoBench = benchAutoSubCandidates(team, baseSlot);
        if (autoBench.length){
          var autoLbl = document.createElement('div');
          autoLbl.className = 'rot-menu-label';
          autoLbl.style.marginTop = '8px';
          autoLbl.textContent = 'Quick pick';
          autoExpand.appendChild(autoLbl);
          appendPlayerChips(autoExpand, autoBench, selectedSubId, function(subId){
            clearActiveAutoSub(team, baseSlot);
            if (!team.rotation.autoSubs) team.rotation.autoSubs = {};
            team.rotation.autoSubs[baseSlot] = subId;
            if (!team.rotation.autoSubPos) team.rotation.autoSubPos = {};
            if (!team.rotation.autoSubPos[baseSlot]) team.rotation.autoSubPos[baseSlot] = 1;
            saveState();
            buildRotPlayerMenu(team, baseSlot, anchor);
            positionRotPlayerMenu(menu, anchor);
          });
        }
        if (hasSub){
          var clearRow = document.createElement('div');
          clearRow.className = 'rot-menu-row';
          clearRow.style.marginTop = '8px';
          var clearBtn = document.createElement('button');
          clearBtn.type = 'button';
          clearBtn.className = 'rot-menu-chip';
          clearBtn.textContent = 'Clear auto-sub';
          clearBtn.addEventListener('click', function(e){
            e.stopPropagation();
            clearActiveAutoSub(team, baseSlot);
            delete team.rotation.autoSubs[baseSlot];
            delete team.rotation.autoSubPos[baseSlot];
            saveState();
            buildRotPlayerMenu(team, baseSlot, anchor);
            positionRotPlayerMenu(menu, anchor);
          });
          clearRow.appendChild(clearBtn);
          autoExpand.appendChild(clearRow);
        }
      }
      opts.appendChild(autoExpand);
    }

    menu.appendChild(opts);

    // ── 3. Serving (always visible) ──────────────────────────────────────────
    var serveSec = document.createElement('div');
    serveSec.className = 'rot-menu-section';
    var serveLbl = document.createElement('div');
    serveLbl.className = 'rot-menu-label';
    serveLbl.textContent = '3. Serving';
    serveSec.appendChild(serveLbl);

    if (isMBBaseSlot(baseSlot)){
      var mbLabel2 = baseSlot === 3 ? 'MB2' : 'MB1';
      var mb2Serves = team.rotation.liberoMB2 !== false;
      var iServe = (mbLabel2 === 'MB2') ? mb2Serves : !mb2Serves;
      var serveRow = document.createElement('div');
      serveRow.className = 'rot-menu-row';
      serveRow.appendChild(document.createTextNode('I will serve'));
      serveRow.appendChild(makeMenuToggle(iServe, function(on){
        if (on) team.rotation.liberoMB2 = (mbLabel2 === 'MB2');
        else team.rotation.liberoMB2 = (mbLabel2 !== 'MB2');
        applyRulesForOffset(team, team.rotation.offset || 0);
        saveState();
        renderRotationWheel();
        refreshMenu();
      }));
      serveSec.appendChild(serveRow);
    } else if (isSubRuleSlot(baseSlot)){
      var subInPos = (team.rotation.autoSubPos && team.rotation.autoSubPos[baseSlot]) || 1;
      var subServes = subInPos === 1;
      var serveRow2 = document.createElement('div');
      serveRow2.className = 'rot-menu-row';
      serveRow2.appendChild(document.createTextNode(subServes ? 'Sub serves' : 'Original serves'));
      serveRow2.appendChild(makeMenuToggle(subServes, function(on){
        clearActiveAutoSub(team, baseSlot);
        if (!team.rotation.autoSubPos) team.rotation.autoSubPos = {};
        team.rotation.autoSubPos[baseSlot] = on ? 1 : 6;
        saveState();
        buildRotPlayerMenu(team, baseSlot, anchor);
        positionRotPlayerMenu(menu, anchor);
      }));
      serveSec.appendChild(serveRow2);
      var serveNote = document.createElement('div');
      serveNote.className = 'rot-menu-expand-hint';
      serveNote.textContent = subServes
        ? 'Sub enters at Pos 1 to serve.'
        : 'Original serves — sub enters at Pos 6.';
      serveSec.appendChild(serveNote);
    }
    menu.appendChild(serveSec);

    var actions = document.createElement('div');
    actions.className = 'rot-menu-actions';
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', function(e){
      e.stopPropagation();
      closeRotPlayerMenu();
    });
    actions.appendChild(closeBtn);
    menu.appendChild(actions);

    positionRotPlayerMenu(menu, anchor);
  }

  function openRotPlayerMenu(anchor, courtPos){
    var team = activeTeam();
    if (!team || !anchor) return;
    ensureRotation(team);
    autoFillBaseFromRoster(team);
    var baseSlot = courtPosToBaseSlot(team, courtPos);
    if (!baseSlot) return;
    _rotMenuBaseSlot = baseSlot;
    buildRotPlayerMenu(team, baseSlot, anchor);
  }

  function openRotationAssignPicker(courtPos){
    selectionMode = 'rotationAssign';
    selectionPayload = courtPos;
    pendingAction = null;
    if (pickerTitle) pickerTitle.textContent = 'Assign Rotation Pos ' + courtPos;
    _rotationWasOpenBeforePicker = true;
    if (pickerBackdrop) pickerBackdrop.style.zIndex = '1300';
    if (rotationBackdrop) rotationBackdrop.style.zIndex = '1100';
    openPicker();
  }

  function renderRotationWheel(){
    var reopenSlot = _rotMenuBaseSlot;
    var reopenExpand = _rotMenuExpand;
    hideRotPlayerMenu();
    renderRotationStrip();
    syncRotationModalFooter();
    if (_setBaseMode){
      renderSetBasePanel();
      return;
    }
    if (!rotationWheel) return;
    var team = activeTeam();
    if (!team) return;
    ensureRotation(team);
    autoFillBaseFromRoster(team);

    // Rotation modal footer controls (Set Base mode hides them)
    var coachControls = byId('rotationCoachControls');
    if (coachControls && !_setBaseMode) coachControls.style.display = 'flex';
    rotationWheel.innerHTML='';
    rotationWheel.classList.remove('sr-mode');
    var map = currentPosToPlayerId(team);

    // ── Serve status banner ──────────────────────────────────────────────────
    var statusBar = document.getElementById('rotationStatusBar');
    if (statusBar){
      var hasBall = team.rotation.hasBall !== false;
      statusBar.textContent = hasBall ? '🟢 Serving' : '🔴 Receiving';
      statusBar.style.background = hasBall ? '#dcfce7' : '#fee2e2';
      statusBar.style.color      = hasBall ? '#15803d' : '#b91c1c';
    }

    // ── Rotation number label ─────────────────────────────────────────────────
    var rotNumLabel = document.getElementById('rotationNumberLabel');
    if (rotNumLabel) rotNumLabel.textContent = 'Rot ' + ((team.rotation.offset || 0) + 1);

    // ── SR mode setup ─────────────────────────────────────────────────────────
    var srOn = team.rotation.srMode && !team.rotation.hasBall;
    var srBtn = document.getElementById('rotationSRBtn');
    var srSystemToggle = document.getElementById('srSystemToggle');
    if (srBtn){
      var serving = team.rotation.hasBall !== false;
      srBtn.disabled = serving;
      srBtn.style.background  = (!serving && team.rotation.srMode) ? '#2563eb' : '';
      srBtn.style.color       = (!serving && team.rotation.srMode) ? '#fff' : '';
      srBtn.style.borderColor = (!serving && team.rotation.srMode) ? '#1d4ed8' : '';
      srBtn.style.opacity     = serving ? '0.4' : '1';
      srBtn.textContent = (!serving && team.rotation.srMode) ? 'SRV RCV ✓' : 'SRV RCV';
      srBtn.title = serving ? 'Switch to Receiving first' : 'Toggle serve receive stacking view';
    }
    if (srSystemToggle){
      srSystemToggle.style.display = team.rotation.srMode ? 'flex' : 'none';
      var btn51 = document.getElementById('srBtn51');
      var btn62 = document.getElementById('srBtn62');
      if (btn51){ btn51.style.background = team.rotation.srSystem === '5-1' ? '#1e3a8a' : '#f3f4f6'; btn51.style.color = team.rotation.srSystem === '5-1' ? '#fff' : '#374151'; }
      if (btn62){ btn62.style.background = team.rotation.srSystem === '6-2' ? '#1e3a8a' : '#f3f4f6'; btn62.style.color = team.rotation.srSystem === '6-2' ? '#fff' : '#374151'; }
    }

    var COURT_W = 560, COURT_H = 300, TILE_W = 130, TILE_H = 85;

    if (!srOn){
      rotationWheel.style.cssText = '';
    }

    var currentLayout = srOn ? JSON.parse(JSON.stringify(getSRLayout(team))) : null;

    var mb1Pos = getMB1CurrentPos(team);
    var mb2Pos = getMB2CurrentPos(team);
    var libId = team.rotation.liberoId || getLiberoId(team);
    var libTargetPos = team.rotation.liberoActive
      ? ((team.rotation.liberoSlot === 'MB2') ? mb2Pos : mb1Pos)
      : null;

    var POS_COLORS = {
      'S':   { bg:'#dbeafe', border:'#2563eb', text:'#1e3a8a' },
      'OH':  { bg:'#dcfce7', border:'#16a34a', text:'#14532d' },
      'MB':  { bg:'#ede9fe', border:'#7c3aed', text:'#5b21b6' },
      'RS':  { bg:'#ffedd5', border:'#ea580c', text:'#7c2d12' },
      'LIB': { bg:'#fef3c7', border:'#d97706', text:'#92400e' },
      'DS':  { bg:'#ccfbf1', border:'#0d9488', text:'#134e4a' }
    };

    // ── Court layout with volleyball player icons (both SR and non-SR) ────────────
    function makeCircleSlot(pos){
      var pid = map[pos];
      var player = pid ? (team.players||[]).find(function(p){ return p.id === pid; }) : null;
      var name = player ? player.name : '';
      var playerPos = player ? normPosToken(player.position) : '';
      var colors = playerPos ? POS_COLORS[posColorKey(playerPos)] : null;
      var subBaseLabel = pid ? getCourtSubBaseLabel(team, pos, pid) : null;
      var baseSlot = courtPosToBaseSlot(team, pos);

      var isServer = (pos === 1) && !srOn;
      var isLibActive = team.rotation.liberoActive && libId && libTargetPos === pos;
      var isSubIn = !!subBaseLabel;
      var hasRules = baseSlot && slotHasRules(team, baseSlot);

      var wrap = document.createElement('div');
      wrap.className = 'rot-circle-wrap' +
        (isServer ? ' is-server' : '') +
        (isLibActive ? ' is-libero' : '') +
        (isSubIn ? ' is-sub-in' : '') +
        (hasRules ? ' has-rules' : '') +
        (!pid ? ' is-empty' : '');
      wrap.setAttribute('data-rotpos', pos);
      if (baseSlot) wrap.setAttribute('data-base-slot', baseSlot);

      var ball = document.createElement('div');
      ball.className = 'rot-volleyball rot-circle';
      if (colors && pid){
        ball.style.borderColor = colors.border;
        ball.style.backgroundColor = colors.bg;
      }
      if (isServer && pid){ ball.style.borderColor = '#16a34a'; }
      if (isLibActive){ ball.style.borderColor = '#d97706'; }

      var posLabel = document.createElement('div');
      posLabel.className = 'rot-pos-label';
      posLabel.style.color = colors && pid ? colors.text : '#d1d5db';
      if (isLibActive){ posLabel.style.color = '#92400e'; posLabel.textContent = 'LIB'; }
      else if (isServer && pid){ posLabel.style.color = '#15803d'; posLabel.textContent = playerPos || '?'; }
      else { posLabel.textContent = pid ? (playerPos || '?') : '—'; }
      ball.appendChild(posLabel);

      if (player && player.number){
        var numEl = document.createElement('div');
        numEl.className = 'rot-ball-num';
        numEl.style.color = colors && pid ? colors.text : '#6b7280';
        if (isLibActive) numEl.style.color = '#92400e';
        if (isServer && pid) numEl.style.color = '#15803d';
        numEl.textContent = '#' + player.number;
        ball.appendChild(numEl);
      }

      wrap.appendChild(ball);
      wrap.appendChild(buildPlayerNameLine(name, subBaseLabel));

      var posNumEl = document.createElement('div');
      posNumEl.className = 'rot-circle-posnum';
      posNumEl.textContent = 'Pos ' + pos + (isServer ? ' ● serve' : '');
      wrap.appendChild(posNumEl);

      addDoubleTapListener(wrap, function(e){
        e.preventDefault();
        e.stopPropagation();
        if (wrap.dataset.wasDragged === '1'){ wrap.dataset.wasDragged = '0'; return; }
        if (!baseSlot){
          openRotationAssignPicker(pos);
          return;
        }
        if (_rotMenuBaseSlot === baseSlot){
          closeRotPlayerMenu();
          return;
        }
        _rotMenuExpand = null;
        openRotPlayerMenu(wrap, pos);
      });

      return wrap;
    }


    // ── Non-SR: fixed grid court layout ─────────────────────────────────────
    if (!srOn){
      var court = document.createElement('div');
      court.className = 'rotation-court';

      var oppLabel = document.createElement('div');
      oppLabel.className = 'rotation-court-label';
      oppLabel.style.cssText = 'background:rgba(0,0,0,.2);color:rgba(255,255,255,.7);';
      oppLabel.textContent = '← Opponent Side →';
      court.appendChild(oppLabel);

      var net = document.createElement('div');
      net.className = 'rotation-net';
      var netLbl = document.createElement('span');
      netLbl.className = 'rotation-net-label';
      netLbl.textContent = 'NET';
      net.appendChild(netLbl);
      court.appendChild(net);

      var frontRow = document.createElement('div');
      frontRow.className = 'rotation-row front';
      [4,3,2].forEach(function(pos){ frontRow.appendChild(makeCircleSlot(pos)); });
      court.appendChild(frontRow);

      var backRow = document.createElement('div');
      backRow.className = 'rotation-row back';
      [5,6,1].forEach(function(pos){ backRow.appendChild(makeCircleSlot(pos)); });
      court.appendChild(backRow);

      var ourLabel = document.createElement('div');
      ourLabel.className = 'rotation-court-label';
      ourLabel.style.cssText = 'background:rgba(0,0,0,.15);color:rgba(255,255,255,.6);';
      ourLabel.textContent = '← Our Bench Side →';
      court.appendChild(ourLabel);

      rotationWheel.appendChild(court);
    }

    // ── SR mode: same circles but absolutely positioned and draggable ────────
    if (srOn && currentLayout){
      var CIRC = 70; // circle diameter for SR drag mode

      var srCourt = document.createElement('div');
      srCourt.className = 'rotation-court';
      srCourt.style.cssText = 'background:linear-gradient(to bottom,#dbeafe 0%,#dcfce7 100%);border-radius:10px;border:2px solid #93c5fd;overflow:hidden;';

      var srOppLabel = document.createElement('div');
      srOppLabel.className = 'rotation-court-label';
      srOppLabel.style.cssText = 'background:rgba(0,0,0,.2);color:rgba(255,255,255,.7);';
      srOppLabel.textContent = '← Opponent Side →';
      srCourt.appendChild(srOppLabel);

      var srNet = document.createElement('div');
      srNet.className = 'rotation-net';
      var srNetLbl = document.createElement('span');
      srNetLbl.className = 'rotation-net-label';
      srNetLbl.textContent = 'NET  ·  Serve Receive — drag to position';
      srNet.appendChild(srNetLbl);
      srCourt.appendChild(srNet);

      // Draggable area
      var srField = document.createElement('div');
      srField.style.cssText = 'position:relative;width:100%;height:280px;';

      // Ghost position markers
      var ghostPos = {
        4:{x:0.05,y:0.05}, 3:{x:0.38,y:0.05}, 2:{x:0.72,y:0.05},
        5:{x:0.05,y:0.55}, 6:{x:0.38,y:0.55}, 1:{x:0.72,y:0.55}
      };
      [1,2,3,4,5,6].forEach(function(gp){
        var ghost = document.createElement('div');
        ghost.style.cssText = 'position:absolute;width:40px;height:40px;border-radius:50%;border:2px dashed rgba(100,116,139,.3);background:rgba(248,250,252,.4);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:900;color:rgba(100,116,139,.35);pointer-events:none;z-index:0;';
        ghost.setAttribute('data-ghost', gp);
        ghost.textContent = gp;
        srField.appendChild(ghost);
      });

      // Position ghost markers using CSS percentage
      function positionGhosts(){
        [1,2,3,4,5,6].forEach(function(gp){
          var g = srField.querySelector('[data-ghost="'+gp+'"]');
          if (!g) return;
          var gd = ghostPos[gp];
          g.style.left = (gd.x * 100).toFixed(1) + '%';
          g.style.top  = (gd.y * 100).toFixed(1) + '%';
        });
      }
      positionGhosts();

      // Build draggable circle for each position
      [1,2,3,4,5,6].forEach(function(pos){
        var wrap = makeCircleSlot(pos);
        // Override wrap styles for absolute drag mode
        wrap.style.cssText = 'position:absolute;display:flex;flex-direction:column;align-items:center;gap:3px;cursor:grab;z-index:1;touch-action:none;width:'+CIRC+'px;';
        // Remove the flex padding from makeCircleSlot
        wrap.style.padding = '0';

        // Place using currentLayout (560×300 space → percentage)
        function placeWrap(){
          var lp = currentLayout[pos];
          wrap.style.left = ((lp.x / 560) * 100).toFixed(2) + '%';
          wrap.style.top  = ((lp.y / 300) * 100).toFixed(2) + '%';
        }

        // Drag logic — assignment requires double-tap; single pointer drag only
        wrap.addEventListener('pointerdown', function(e){
          if (e.detail > 1) return;
          var el = wrap;
          el.setPointerCapture(e.pointerId);
          var capturedId = e.pointerId;
          var fieldRect = srField.getBoundingClientRect();
          var fw = fieldRect.width;
          var fh = fieldRect.height;
          var origPctLeft = parseFloat(el.style.left);
          var origPctTop  = parseFloat(el.style.top);
          var origPx = { x: origPctLeft / 100 * fw, y: origPctTop / 100 * fh };
          var startOffX = e.clientX - fieldRect.left - origPx.x;
          var startOffY = e.clientY - fieldRect.top  - origPx.y;
          var startX = e.clientX;
          var startY = e.clientY;
          var moved = false;
          el.style.cursor = 'grabbing';
          el.style.zIndex = '10';
          var DRAG_THRESHOLD = 10;

          function onMove(ev){
            if (ev.pointerId !== capturedId) return;
            if (!moved && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
            moved = true;
            var r = srField.getBoundingClientRect();
            var nx = Math.max(0, Math.min(r.width  - CIRC, ev.clientX - r.left - startOffX));
            var ny = Math.max(0, Math.min(r.height - CIRC, ev.clientY - r.top  - startOffY));
            el.style.left = (nx / r.width  * 100).toFixed(2) + '%';
            el.style.top  = (ny / r.height * 100).toFixed(2) + '%';
          }

          function finish(cancelled){
            el.removeEventListener('pointermove', onMove);
            el.removeEventListener('pointerup',   onUp);
            el.removeEventListener('pointercancel', onCancel);
            el.releasePointerCapture(capturedId);
            el.style.cursor = 'grab';
            el.style.zIndex = '1';

            if (!moved) return;
            el.dataset.wasDragged = '1';

            if (cancelled){
              el.style.left = origPctLeft + '%';
              el.style.top  = origPctTop  + '%';
              return;
            }

            // Convert current % positions → 560×300 space for validation + save
            var proposed = {};
            var r2 = srField.getBoundingClientRect();
            srField.querySelectorAll('[data-rotpos]').forEach(function(s){
              var p = parseInt(s.getAttribute('data-rotpos'));
              proposed[p] = {
                x: Math.round(parseFloat(s.style.left) / 100 * 560),
                y: Math.round(parseFloat(s.style.top)  / 100 * 300)
              };
            });

            var violations = validateSRPositions(proposed);
            if (violations.length){
              el.style.transition = 'left .25s,top .25s';
              el.style.left = origPctLeft + '%';
              el.style.top  = origPctTop  + '%';
              var circle2 = el.querySelector('.rot-volleyball, .rot-circle');
              if (circle2){ circle2.style.borderColor='#dc2626'; }
              setTimeout(function(){
                el.style.transition='';
                if (circle2){ circle2.style.borderColor=''; }
                renderRotationWheel();
              }, 500);
              var hint = document.getElementById('srViolationHint');
              if (hint){ hint.textContent = '⚠ ' + violations[0]; hint.style.display='block'; setTimeout(function(){ hint.style.display='none'; }, 2500); }
            } else {
              var t2 = activeTeam();
              if (t2){ saveSRLayout(t2, proposed); saveState(); }
            }
          }

          function onUp(ev){ if (ev.pointerId === capturedId) finish(false); }
          function onCancel(ev){ if (ev.pointerId === capturedId) finish(true); }
          el.addEventListener('pointermove', onMove);
          el.addEventListener('pointerup',   onUp);
          el.addEventListener('pointercancel', onCancel);
        });

        placeWrap();
        srField.appendChild(wrap);
      });

      srCourt.appendChild(srField);

      var srOurLabel = document.createElement('div');
      srOurLabel.className = 'rotation-court-label';
      srOurLabel.style.cssText = 'background:rgba(0,0,0,.15);color:rgba(255,255,255,.6);';
      srOurLabel.textContent = '← Our Bench Side →';
      srCourt.appendChild(srOurLabel);

      rotationWheel.appendChild(srCourt);
    }

    saveState();
    updateSubCountDisplay(team);
    updateLiberoBtn(team);
    if (reopenSlot){
      _rotMenuBaseSlot = reopenSlot;
      _rotMenuExpand = reopenExpand;
      var wrap = rotationWheel.querySelector('[data-base-slot="' + reopenSlot + '"]');
      if (wrap){
        _rotMenuAnchor = wrap;
        buildRotPlayerMenu(team, reopenSlot, wrap);
      }
    }

  }

  function openRotation(){
    if (!rotationBackdrop) return;
    renderRotationWheel();
    showModal(rotationBackdrop);
  }
  function closeRotation(){
    if (_setBaseMode) exitSetBaseMode();
    closeRotPlayerMenu();
    hideModal(rotationBackdrop);
    autoSelectServer();
    renderTable();
  }

  // Wire rotation FAB
  var rotationFAB = byId('rotationFAB');
  if (rotationFAB) rotationFAB.addEventListener('click', openRotation);

  document.addEventListener('click', function(e){
    if (!_rotMenuBaseSlot) return;
    var menu = document.getElementById('rotPlayerMenu');
    if (menu && menu.contains(e.target)) return;
    if (_rotMenuAnchor && _rotMenuAnchor.contains(e.target)) return;
    closeRotPlayerMenu();
  });

  // Tap status bar to toggle who is serving at start of set
  var rotationStatusBar = byId('rotationStatusBar');
  if (rotationStatusBar) rotationStatusBar.addEventListener('click', function(){
    var team = activeTeam();
    if (!team) return;
    ensureRotation(team);
    team.rotation.hasBall = !team.rotation.hasBall;
    if (!team.rotation.hasBall){
      team.rotation.srMode = true;
    } else {
      team.rotation.srMode = false;
      autoSelectServer();
    }
    saveState();
    renderRotationWheel();
  });

  // SRV RCV button — toggle serve receive stacking overlay
  var rotationSRBtn = byId('rotationSRBtn');
  if (rotationSRBtn) rotationSRBtn.addEventListener('click', function(){
    var team = activeTeam();
    if (!team) return;
    ensureRotation(team);
    if (team.rotation.hasBall) return; // can't enter SR mode while serving
    team.rotation.srMode = !team.rotation.srMode;
    saveState();
    renderRotationWheel();
  });

  // 5-1 / 6-2 system toggle
  var srBtn51 = byId('srBtn51');
  var srBtn62 = byId('srBtn62');
  if (srBtn51) srBtn51.addEventListener('click', function(){
    var team = activeTeam();
    if (!team) return;
    ensureRotation(team);
    team.rotation.srSystem = '5-1';
    saveState();
    renderRotationWheel();
  });
  if (srBtn62) srBtn62.addEventListener('click', function(){
    var team = activeTeam();
    if (!team) return;
    ensureRotation(team);
    team.rotation.srSystem = '6-2';
    saveState();
    renderRotationWheel();
  });

  // Reset SR layout for current rotation/system back to template
  var srResetLayout = byId('srResetLayout');
  if (srResetLayout) srResetLayout.addEventListener('click', function(){
    var team = activeTeam();
    if (!team) return;
    ensureRotation(team);
    var key = getSRLayoutKey(team);
    if (team.rotation.srLayouts) delete team.rotation.srLayouts[key];
    saveState();
    renderRotationWheel();
  });

  // ── SIDE OUT button — we win rally, no stat (opp error, block, etc.) ────────
  window._vsSideOut = function(){
    var team = activeTeam();
    if (!team) return;
    ensureRotation(team);
    if (team.rotation.hasBall) return;
    if (navigator.vibrate) navigator.vibrate([25, 60, 25]);
    playStatClick('rally');
    adjScore('our', 1);
    advanceRotation(team);
    team.rotation.hasBall = true;
    team.rotation.srMode  = false;
    autoSelectServer();
    saveState();
    renderRotationStrip();
    if (rotationBackdrop && rotationBackdrop.style.display !== 'none') renderRotationWheel();
  };
  var sideOutBtn = byId('sideOutBtn');
  if (sideOutBtn) sideOutBtn.addEventListener('click', window._vsSideOut);

  // ── OPP SCORE button — opponent wins rally, no stat (their ace, kill, etc.) ─
  window._vsOppScore = function(){
    var team = activeTeam();
    if (!team) return;
    ensureRotation(team);
    if (navigator.vibrate) navigator.vibrate([25, 60, 25]);
    playStatClick('rally');
    adjScore('opp', 1);
    // Opponent now has (or keeps) the serve — we receive
    team.rotation.hasBall = false;
    team.rotation.srMode  = true;
    saveState();
    renderRotationStrip();
    if (rotationBackdrop && rotationBackdrop.style.display !== 'none') renderRotationWheel();
  };
  var oppScoreBtn = byId('oppScoreBtn');
  if (oppScoreBtn) oppScoreBtn.addEventListener('click', window._vsOppScore);

  if (rotationBtn) rotationBtn.addEventListener('click', openRotation);

  // Score bar rotation button — opens rotation modal
  var scoreRotationBtn = byId('scoreRotationBtn');
  if (scoreRotationBtn) scoreRotationBtn.addEventListener('click', openRotation);

  // Score bar possession pill — tap to toggle serving/receiving
  var scorePossessionPill = byId('scorePossessionPill');
  if (scorePossessionPill) scorePossessionPill.addEventListener('click', function(){
    var team = activeTeam();
    if (!team) return;
    ensureRotation(team);
    team.rotation.hasBall = !team.rotation.hasBall;
    if (!team.rotation.hasBall){
      team.rotation.srMode = true;
    } else {
      team.rotation.srMode = false;
      autoSelectServer();
    }
    saveState();
    renderRotationStrip();
    if (rotationBackdrop && rotationBackdrop.style.display !== 'none') renderRotationWheel();
  });
  if (rotationClose) rotationClose.addEventListener('click', closeRotation);
  if (rotationDone) rotationDone.addEventListener('click', closeRotation);
  if (rotationBackdrop) rotationBackdrop.addEventListener('click', function(e){
    var btn = e.target && e.target.closest ? e.target.closest('button') : null;
    if (btn && btn.id){
      if (btn.id === 'rotationClear'){
        e.preventDefault();
        e.stopPropagation();
        enterSetBaseMode();
        return;
      }
      if (btn.id === 'setBaseCancel'){
        e.preventDefault();
        e.stopPropagation();
        exitSetBaseMode();
        renderRotationWheel();
        return;
      }
      if (btn.id === 'setBaseSave'){
        e.preventDefault();
        e.stopPropagation();
        saveSetBase();
        return;
      }
      if (btn.id === 'setBaseReset'){
        e.preventDefault();
        e.stopPropagation();
        resetSetBaseDraft();
        return;
      }
      if (btn.id === 'rotationReset'){
        e.preventDefault();
        e.stopPropagation();
        resetRotationOnCourt();
        return;
      }
      if (btn.id === 'rotationLiberoBtn'){
        e.preventDefault();
        e.stopPropagation();
        var libTeam = activeTeam();
        if (!libTeam) return;
        toggleLiberoStart(libTeam);
        saveState();
        autoSelectServer();
        renderRotationWheel();
        renderTable();
        return;
      }
    }
    if (e.target === rotationBackdrop) closeRotation();
  });

  var rotationForward = byId('rotationForward');
  var rotationBack    = byId('rotationBack');

  if (rotationForward) rotationForward.addEventListener('click', function(){
    var team = activeTeam();
    if (!team) return;
    advanceRotation(team);
    saveState();
    autoSelectServer();
    renderRotationWheel();
  });

  if (rotationBack) rotationBack.addEventListener('click', function(){
    var team = activeTeam();
    if (!team) return;
    retreatRotation(team);
    saveState();
    autoSelectServer();
    renderRotationWheel();
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
  var _undoBusy = false;

  function undoLast(){
    if (_undoBusy) return; // prevent double-press

    var team = activeTeam();
    if (!team || !team.history || !team.history.length) return;

    // Visual + audio + haptic feedback
    var undoBtns = [byId('undoBtn'), byId('mobileUndoBtn')].filter(Boolean);
    _undoBusy = true;
    undoBtns.forEach(function(b){
      b.style.background = '#16a34a';
      b.style.color = '#fff';
      b.disabled = true;
    });
    if (navigator.vibrate) navigator.vibrate(18);
    playStatClick('error');

    // Restore button after 800ms — single press only
    setTimeout(function(){
      undoBtns.forEach(function(b){
        b.style.background = '';
        b.style.color = '';
        b.disabled = false;
      });
      _undoBusy = false;
    }, 800);

    // Pop auto-linked error entries first (they have no snapshot; primary entry has it)
    while (team.history.length && team.history[team.history.length-1].auto){
      var autoEntry = team.history.pop();
      ensureCounters(team, autoEntry.match, autoEntry.set, autoEntry.playerId);
      var autoCtr = team.data[autoEntry.match][autoEntry.set][autoEntry.playerId];
      if (autoCtr && autoCtr[autoEntry.action] !== undefined)
        autoCtr[autoEntry.action] = Math.max(0, nz(autoCtr[autoEntry.action],0) - 1);
    }

    var last = team.history.pop();
    if (!last) return;
    var match  = last.match;
    var set    = last.set;
    var pid    = last.playerId;
    var action = last.action;

    // Reverse the stat counter
    ensureCounters(team, match, set, pid);
    var counters = team.data[match][set][pid];
    if (counters && counters[action] !== undefined)
      counters[action] = Math.max(0, nz(counters[action],0) - 1);

    // Restore score and rotation from snapshot if available, otherwise fall back
    if (last.scoreBefore){
      var sc = currentScore();
      sc.our = last.scoreBefore.our;
      sc.opp = last.scoreBefore.opp;
      saveScore();
    } else {
      var undoWasWin2  = (action === 'kill' || action === 'ace');
      var undoWasLose2 = (action === 'serveOut' || action === 'swingOut' || action === 'passShank' ||
                          action === 'errPassing' || action === 'errNet' || action === 'errTwoHand' ||
                          action === 'errRotation');
      if (undoWasWin2)  adjScore('our', -1);
      if (undoWasLose2) adjScore('opp', -1);
    }
    if (last.rotationBefore){
      team.rotation = last.rotationBefore;
    } else {
      ensureRotation(team);
      var undoWasWin3  = (action === 'kill' || action === 'ace');
      var undoWasLose3 = (action === 'serveOut' || action === 'swingOut' || action === 'passShank' ||
                          action === 'errPassing' || action === 'errNet' || action === 'errTwoHand' ||
                          action === 'errRotation');
      if (undoWasWin3 && team.rotation.hasBall){
        retreatRotation(team);
        team.rotation.hasBall = false;
        team.rotation.srMode  = true;
      } else if (undoWasLose3){
        team.rotation.hasBall = true;
        team.rotation.srMode  = false;
      }
    }
    autoSelectServer();

    saveState();
    renderTable();
    updateOnboardingAndControls();
    renderRotationStrip();
    if (rotationBackdrop && rotationBackdrop.style.display !== 'none') renderRotationWheel();
  }

  if (undoBtn) undoBtn.addEventListener('click', undoLast);
  var mobileUndoBtn = byId('mobileUndoBtn');
  if (mobileUndoBtn) mobileUndoBtn.addEventListener('click', undoLast);

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
        'Svr In Play', 'Opp Passes', 'Aces', 'Svr Pressure %',
        'Pass Att', 'Recv Pressure',
        'Hit Att', 'Hit Avg', 'Hits In', 'Hits In%',
        'Digs', 'Dig Errors', 'Block Kills', 'Block Errors', 'OOS',
        'Total Errors', 'Hit Errors', 'Serve Errors', 'Pass Errors', 'In the Net', 'Two Hand', 'Out of Rotation'
      ];
    } else {
      headers = [
        'Jersey', 'Player', 'Pos',
        'Serve Att', 'Serves In', 'Serve In %',
        'Aces', 'Ace%',
        'Pass Att', 'Pass Avg',
        'Hit Att', 'Hit Avg', 'Hits In', 'Hits In%',
        'Digs', 'Dig Errors', 'Block Kills', 'Block Errors', 'OOS',
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
          d.oppRecAtt, d.oppRecIn, d.aceCount, fmtPct(d.servePressurePct),
          d.passAtt, fmtNum(d.passAvg,2),
          d.hitAtt, fmtNum(d.hitAvg,3), d.hitsIn, fmtPct(d.hitsInPct),
          d.dig, d.digErr, d.blockKill, d.blockErr, d.oos,
          d.totalErrors, d.errHitting, d.errServing, d.errPassing, d.errNet, d.errTwoHand, d.errRotation
        ].map(csv).join(','));
      } else {
        out.push([
          p.number || '', p.name || '', p.position || '',
          d.serveAttPlayer, d.serveIn, fmtPct(d.serveInPct),
          d.aceCount, fmtPct(d.acePctPlayer),
          d.passAtt, fmtNum(d.passAvg,2),
          d.hitAtt, fmtNum(d.hitAvg,3), d.hitsIn, fmtPct(d.hitsInPct),
          d.dig, d.digErr, d.blockKill, d.blockErr, d.oos,
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

  // ── Save & Advance to next set / match ────────────────────────────────────
  window._vsNextSet = async function(){
    var vsConfirm = window.vsConfirm || function(){ return Promise.resolve(true); };
    var team = activeTeam();
    if (!team) return;

    var curSet   = parseInt(setSelect ? setSelect.value : '1') || 1;
    var curMatch = matchSelect ? matchSelect.value : 'Match 1';
    var score    = currentScore();
    var our = score.our || 0, opp = score.opp || 0;

    var isTiebreak = (curSet === 3);
    var winScore   = isTiebreak ? 15 : 25;
    var ourWon  = our >= winScore && (our - opp) >= 2;
    var oppWon  = opp >= winScore && (opp - our) >= 2;

    var resultStr = curMatch + ' · Set ' + curSet + ': ' + our + '-' + opp;
    if (!ourWon && !oppWon){
      if (!await vsConfirm('Set ' + curSet + ' score is ' + our + '-' + opp + ' — set not complete yet.<br><br>Advance anyway?')) return;
    } else {
      var winner = ourWon ? 'WE WIN' : 'OPPONENT WINS';
      if (!await vsConfirm(winner + ' Set ' + curSet + ': ' + our + '-' + opp + '<br><br>Save and advance?')) return;
    }

    // Archive current stats snapshot — fire and forget, don't block on offline
    if (window._firebaseArchive) {
      var now = new Date();
      var archLabel = (team.name || 'Team') + ' · ' + resultStr + ' · '
        + now.toLocaleDateString('en-US', {month:'short', day:'numeric'});
      window._firebaseArchive(state, archLabel).catch(function(e){ console.warn('[VolleyStat] Archive failed:', e.message); });
    }

    // Count sets won in this match
    var matchSetsOur = 0, matchSetsOpp = 0;
    var curDay = daySelect ? daySelect.value : 'Day 1';
    for (var s = 1; s <= curSet; s++){
      var sw2 = (s === 3) ? 15 : 25;
      var sc2;
      if (s === curSet){
        sc2 = score;
      } else {
        var sk2 = curDay + ' - ' + curMatch + ' - ' + s;
        sc2 = scoreStore[sk2] || {our:0, opp:0};
      }
      if ((sc2.our||0) >= sw2 && ((sc2.our||0)-(sc2.opp||0)) >= 2) matchSetsOur++;
      else if ((sc2.opp||0) >= sw2 && ((sc2.opp||0)-(sc2.our||0)) >= 2) matchSetsOpp++;
    }

    var nextSet   = curSet + 1;
    var nextMatch = curMatch;
    var matchOver = (matchSetsOur >= 2 || matchSetsOpp >= 2 || nextSet > 3);

    if (matchOver){
      var matches = team.matches || DEFAULT_MATCHES;
      var matchIdx = matches.indexOf(curMatch);
      if (matchIdx >= 0 && matchIdx < matches.length - 1){
        nextMatch = matches[matchIdx + 1];
        nextSet = 1;
        var mWinner = matchSetsOur >= 2 ? 'WE WIN' : 'OPPONENT WINS';
        if (!await vsConfirm(mWinner + ' the match!<br><br>Advancing to ' + nextMatch + '.')) return;
      } else {
        await vsConfirm('All matches complete for this day.');
        return;
      }
    }

    // Reset rotation for new set — restore locked base lineup
    ensureRotation(team);
    restoreRotationOneBase(team);

    // Advance selectors
    if (matchSelect && nextMatch !== curMatch){
      matchSelect.value = nextMatch;
      matchSelect.dispatchEvent(new Event('change'));
    }
    if (setSelect){
      setSelect.value = String(nextSet);
      setSelect.dispatchEvent(new Event('change'));
    }

    saveState();
    renderTable();
    updateOnboardingAndControls();
    renderRotationStrip();
    renderScore();
    autoSelectServer();
    if (window._firebaseRegisterSession && team.name) window._firebaseRegisterSession(team.name);
  };

  window._vsReset = async function(){
    var team = activeTeam();
    if (!team) return;

    var choice = await openResetConfirmModal({
      teamName: team.name || 'Team',
      scope: 'Stats archived to Firebase then cleared. Team, roster and rotation assignments kept.',
      rotation: 'Rotation resets to Rotation 1 (offset 0). Serving. Libero deactivated.'
    });

    if (choice === 'export'){
      try{ await runExport(); }catch(e){}
      return;
    }
    if (!choice) return;

    var skipSave = (choice === 'nosave');

    // Read custom session name from dialog input
    var sessionNameEl = byId('resetSessionName');
    var customSessionName = sessionNameEl ? sessionNameEl.value.trim() : '';
    if (sessionNameEl) sessionNameEl.value = '';

    // Archive before wiping unless user chose Don't Save
    if (!skipSave && window._firebaseArchive) {
      var now = new Date();
      var autoLabel = (team.name || 'Team') + ' · '
        + now.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
        + ' · ' + now.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', hour12:true });
      var label = customSessionName || autoLabel;
      window._firebaseArchive(state, label).catch(function(e){ console.warn('[VolleyStat] Archive failed:', e.message); });
    }

    team.data = buildEmptyData(team.players || [], team.matches && team.matches.length ? team.matches : DEFAULT_MATCHES);
    team.history = [];

    ensureRotation(team);
    team.rotation.offset = 0;
    team.rotation.hasBall = true;
    team.rotation.liberoActive = false;
    team.rotation.liberoSlot = null;
    team.rotation.srMode = false;
    team.rotation.subCount = 0;
    team.rotation.autoSubOriginals = {};
    // Restore saved base lineup if one exists
    if (team.savedBase) team.rotation.base = JSON.parse(JSON.stringify(team.savedBase));

    scoreStore = {};
    saveScore();
    saveState();

    if (!skipSave && window._firebaseRegisterSession && team.name) {
      window._firebaseRegisterSession(customSessionName || (team.name + ' (new set)'));
    }

    renderTable();
    updateOnboardingAndControls();
    renderRotationStrip();
    autoSelectServer();
    if (exportName) exportName.dataset.userEdited = '';
    syncExportNameDefault();
    populateMobilePlayerSelect();
    renderScore();
  };

  if (resetBtn) resetBtn.addEventListener('click', window._vsReset)
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
    var team = activeTeam();
    if (team){ ensureRotation(team); team.rotation.subCount = 0; team.rotation.autoSubOriginals = {}; saveState(); }
    renderTable();
    syncExportNameDefault();
    renderScore();
    renderRotationStrip();
  });
  setSelect.addEventListener('change', function(){
    var team = activeTeam();
    if (team){ ensureRotation(team); team.rotation.subCount = 0; team.rotation.autoSubOriginals = {}; saveState(); }
    renderTable();
    syncExportNameDefault();
    renderScore();
    renderRotationStrip();
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
  var verBadge = document.querySelector('.title-bar-badge');
  if (verBadge && typeof APP_VERSION !== 'undefined') verBadge.textContent = 'Alpha ' + APP_VERSION;

  // ── Firebase sync bootstrap ────────────────────────────────────────────────
  import('./firebase-sync.js?v=' + APP_VERSION).then(function(fb) {
    window._firebaseSave            = fb.firebaseSave;
    window._firebaseArchive         = fb.archiveSession;
    window._firebaseRegisterSession = fb.registerSession;
    window._firebaseLoadArchive     = fb.loadArchive;
    window._firebaseDeleteSession   = fb.deleteSession;
    window._firebaseDeleteArchive   = fb.deleteArchive;

    // ── Admin functions (alan.pollock@gmail.com only) ────────────────────────
    window._vsAdminLoadSessions = async function(){
      var statusEl = byId('adminGrantStatus');
      var sel = byId('adminGrantSession');
      if (!sel) return;
      try {
        if (statusEl) statusEl.textContent = 'Loading…';
        var sessions = await fb.adminLoadAllSessions();
        sel.innerHTML = '<option value="">— select a session —</option>';
        sessions.forEach(function(s){
          var opt = document.createElement('option');
          opt.value = s._docId;
          opt.textContent = (s.label || s.teamName || s._docId) + ' · ' + (s.userEmail || s.userId || '?');
          sel.appendChild(opt);
        });
        if (statusEl) statusEl.textContent = sessions.length + ' sessions loaded.';
      } catch(e) {
        if (statusEl) statusEl.textContent = 'Error: ' + e.message;
      }
    };

    window._vsAdminGrant = async function(){
      var statusEl = byId('adminGrantStatus');
      var email = (byId('adminGrantEmail') || {}).value || '';
      var sessionId = (byId('adminGrantSession') || {}).value || '';
      if (!email || !sessionId) {
        if (statusEl) statusEl.textContent = 'Enter an email and select a session.';
        return;
      }
      try {
        if (statusEl) statusEl.textContent = 'Granting…';
        await fb.adminGrantSessionAccess(email.trim(), sessionId);
        if (statusEl) statusEl.textContent = '✓ Access granted to ' + email;
      } catch(e) {
        if (statusEl) statusEl.textContent = 'Error: ' + e.message;
      }
    };

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

      // Show admin panel only for super-admin (verified email — matches Firestore rules)
      var adminPanel = byId('adminPanel');
      var adminStatus = byId('adminGrantStatus');
      if (adminPanel) {
        var isAdminEmail = normalizeEmail(user.email) === 'alan.pollock@gmail.com';
        adminPanel.style.display = isAdminEmail ? 'block' : 'none';
        if (isAdminEmail && adminStatus) {
          if (fb.isSuperAdmin(user)) {
            adminStatus.textContent = 'Super-admin active — full data access.';
            adminStatus.style.color = '#86efac';
          } else {
            adminStatus.textContent = 'Verify your email in Firebase Auth to unlock super-admin access.';
            adminStatus.style.color = '#fca5a5';
          }
        }
      }

      function normalizeEmail(email) {
        return (email || '').trim().toLowerCase();
      }

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

      // ── Firebase load + real-time sync ─────────────────────────────────────
      fb.firebaseLoad().then(function(remote) {
        var localTs = lastLocalUpdatedAt;
        var remoteTs = (remote && remote.clientUpdatedAt) || 0;
        var hasLocal = state.teams && state.teams.length;

        if (remote && remote.teams) {
          if (!hasLocal || remoteTs > localTs) {
            applyRemotePayload(remote);
            if (window._vsRefreshAfterSync) window._vsRefreshAfterSync();
            var activeT = state.teams && state.teams.length
              ? (state.teams.find(function(t){ return t.id === state.activeTeamId; }) || state.teams[0])
              : null;
            if (activeT && activeT.name) fb.registerSession(activeT.name);
          } else if (localTs > remoteTs) {
            saveState();
          }
        } else if (hasLocal) {
          saveState();
        }

        try {
          fb.firebaseListen(function(remoteState) {
            var rTs = remoteState.clientUpdatedAt || 0;
            if (rTs <= lastLocalUpdatedAt) return;
            if (applyRemotePayload(remoteState) && window._vsRefreshAfterSync) {
              window._vsRefreshAfterSync();
            }
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
      var sessions = fb.isSuperAdmin() ? await fb.adminLoadAllSessions() : await fb.listSessions();
      sessionDropdown.innerHTML = '<option value="">— select a session —</option>';
      if (!sessions.length) {
        sessionDropdown.innerHTML = '<option value="">No sessions found yet — tap Refresh</option>';
        return;
      }
      sessions.forEach(function(s) {
        var opt = document.createElement('option');
        opt.value = s.userId || s.deviceId;
        // Store archive metadata as data attributes via JSON in value
        if (s.type === 'archive') {
          opt.value = '__archive__' + s.userId + '__' + s.archiveId;
        }
        var currentUid = fb.getCurrentUser() ? fb.getCurrentUser().uid : null;
        var isMine = currentUid && s.userId === currentUid;
        var isArchive = s.type === 'archive';
        opt.textContent = (isMine && !isArchive ? '★ ' : '') + s.label + (isMine && !isArchive ? ' (you)' : '');
        if (isMine && !isArchive) {
          opt.style.fontWeight = '900';
          if (mySessionLabel) mySessionLabel.textContent = s.label;
        }
        if (isArchive) opt.style.color = '#92400e';
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
      if (!await vsConfirm('Load:<br><strong>' + selectedText + '</strong><br><br>This will replace your current view on this device.')) return;
      function setConnectBtn(text, disabled) {
        var btn = byId('connectSessionBtn'); if(btn){ btn.textContent = text; btn.disabled = disabled; }
      }
      setConnectBtn('Loading...', true);
      try {
        var remoteState;

        // Archive load path
        if (selected.indexOf('__archive__') === 0) {
          var parts = selected.replace('__archive__', '').split('__');
          var archUserId = parts[0];
          var archiveId  = parts[1];
          if (!window._firebaseLoadArchive) throw new Error('Archive loader not ready');
          remoteState = await window._firebaseLoadArchive(archUserId, archiveId);
        } else {
          // Live session load path
          remoteState = await fb.firebaseLoadFrom(selected);
        }

        if (!remoteState) {
          await vsConfirm('Could not load that session. It may have no data yet. Click OK to dismiss.');
          setConnectBtn('Connect to Selected Session', false);
          return;
        }
        applyRemotePayload(remoteState);
        if (window._vsRefreshAfterSync) window._vsRefreshAfterSync();

        // Only set up live listener for non-archive sessions
        if (selected.indexOf('__archive__') !== 0) {
          await fb.firebaseListenTo(selected, function(updatedState) {
            var rTs = updatedState.clientUpdatedAt || 0;
            if (rTs <= lastLocalUpdatedAt) return;
            if (applyRemotePayload(updatedState) && window._vsRefreshAfterSync) {
              window._vsRefreshAfterSync();
            }
          });
        }

        var panel = byId('syncDevicePanel');
        if (panel) panel.classList.add('hidden');
        setConnectBtn('Connect to Selected Session', false);
      } catch(e) {
        console.error('[VolleyStat] Connect error:', e);
        await vsConfirm('Error loading: ' + e.message + '. Click OK to dismiss.');
        setConnectBtn('Connect to Selected Session', false);
      }
    }

    // ── Global window functions for sync panel buttons ───────────────────────
    // Use custom confirm instead of browser confirm() which may be blocked
    window.vsConfirm = function vsConfirm(msg) {
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

    // Delete the currently selected session from the dropdown
    window._vsDeleteSelectedSession = async function(){
      var sd = byId('sessionDropdown');
      if (!sd || !sd.value) { await vsConfirm('Select a session first.'); return; }
      var selectedText = sd.options[sd.selectedIndex] ? sd.options[sd.selectedIndex].text : sd.value;
      if (!await vsConfirm('Delete:<br><strong>' + selectedText + '</strong><br><br>This cannot be undone.')) return;

      var selected = sd.value;
      try {
        if (selected.indexOf('__archive__') === 0){
          var parts = selected.replace('__archive__', '').split('__');
          if (window._firebaseDeleteArchive) await window._firebaseDeleteArchive(parts[0], parts[1]);
        } else {
          // Delete from volleystat_sessions using the userId as doc ID
          var currentUid = fb.getCurrentUser() ? fb.getCurrentUser().uid : null;
          if (window._firebaseDeleteSession && currentUid) {
            await window._firebaseDeleteSession(currentUid);
          }
        }
        await vsConfirm('Deleted. Tap Refresh to update the list.');
        if (window._vsRefreshSessions) window._vsRefreshSessions();
        if (window._vsLoadSessionList) window._vsLoadSessionList();
      } catch(e) {
        await vsConfirm('Delete failed: ' + e.message);
      }
    };

    // Load manage sessions list with delete buttons
    window._vsLoadSessionList = async function(){
      var list = byId('manageSessionsList');
      if (!list) return;
      list.innerHTML = '<div style="color:rgba(255,255,255,.4);font-size:10px;">Loading…</div>';
      try {
        var sessions = await fb.listSessions();
        var currentUid = fb.getCurrentUser() ? fb.getCurrentUser().uid : null;
        // Filter to own sessions only
        var mine = sessions.filter(function(s){ return s.userId === currentUid; });
        if (!mine.length){
          list.innerHTML = '<div style="color:rgba(255,255,255,.4);font-size:10px;">No sessions found.</div>';
          return;
        }
        list.innerHTML = '';
        mine.forEach(function(s){
          var row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;background:rgba(255,255,255,.08);border-radius:6px;padding:5px 8px;';
          var label = document.createElement('span');
          label.style.cssText = 'color:#fff;font-size:10px;font-weight:700;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
          label.textContent = s.label || s.teamName || s.userId;
          var delBtn = document.createElement('button');
          delBtn.textContent = '🗑';
          delBtn.style.cssText = 'background:rgba(220,38,38,.7);border:none;color:#fff;border-radius:5px;padding:2px 7px;font-size:11px;cursor:pointer;flex-shrink:0;';
          delBtn.title = 'Delete this session';
          delBtn.addEventListener('click', async function(){
            if (!await vsConfirm('Delete:<br><strong>' + (s.label || s.teamName) + '</strong><br>Cannot be undone.')) return;
            try {
              if (s.type === 'archive'){
                if (window._firebaseDeleteArchive) await window._firebaseDeleteArchive(s.userId, s.archiveId);
              } else {
                // volleystat_sessions doc ID is the userId for live sessions
                if (window._firebaseDeleteSession) await window._firebaseDeleteSession(s.userId);
              }
              row.remove();
            } catch(e2){
              await vsConfirm('Delete failed: ' + e2.message);
            }
          });
          row.appendChild(label);
          row.appendChild(delBtn);
          list.appendChild(row);
        });
      } catch(e){
        list.innerHTML = '<div style="color:#fca5a5;font-size:10px;">' + e.message + '</div>';
      }
    };

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

    // Revoke/copy share — called from dynamically created buttons
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
    if (ss) { ss.textContent = '⚡ Saved locally'; ss.style.color = '#d97706'; }
  });

  // ── Mobile UI wiring ──────────────────────────────────────────────────────

  // No bottom nav panels in new layout

  // Score tracker — scoreStore lives at module scope; synced to Firebase via saveState()
  function getScoreKey(){
    var day = (daySelect && daySelect.value) ? daySelect.value : 'Day 1';
    var match = matchSelect ? (matchSelect.value || 'Match 1') : 'Match 1';
    var set = setSelect ? (setSelect.value || '1') : '1';
    return day + ' - ' + match + ' - Set ' + set;
  }

  function currentScore(){
    var k = getScoreKey();
    if (!scoreStore[k]) scoreStore[k] = {our:0, opp:0};
    return scoreStore[k];
  }

  function saveScore(){
    saveState();
  }

  // ── Rotation status strip ─────────────────────────────────────────────────
  function renderRotationStrip(){
    var strip      = byId('rotationStatusStrip');
    var serverEl   = byId('stripServer');
    var sideOutBtn = byId('sideOutBtn');
    var oppScBtn   = byId('oppScoreBtn');
    var possessionPill = byId('scorePossessionPill');
    var scoreRotBtn    = byId('scoreRotationBtn');

    var team = activeTeam();

    // Score bar possession pill — always update when visible
    if (possessionPill && team){
      ensureRotation(team);
      var hasBallPill = team.rotation.hasBall !== false;
      possessionPill.textContent = hasBallPill ? '🟢 Serving' : '🔴 Receiving';
      possessionPill.style.background = hasBallPill ? 'rgba(22,163,74,.6)' : 'rgba(220,38,38,.6)';
    }

    // Score bar rotation button label
    if (scoreRotBtn && team){
      var rotN = ((team.rotation || {}).offset || 0) + 1;
      scoreRotBtn.textContent = '\uD83D\uDD04 Rot ' + rotN;
    }

    if (!strip) return;

    if (!team){
      strip.style.display = 'none';
      return;
    }
    strip.style.display = 'flex';

    ensureRotation(team);
    var hasBall = team.rotation.hasBall !== false;

    if (serverEl){
      var serverId = getServerPlayerId(team);
      serverEl.textContent = 'Server: ' + (serverId ? playerNameById(team, serverId) : '\u2014');
    }

    if (sideOutBtn){
      // Only available when receiving — can't side-out your own serve
      sideOutBtn.style.opacity = hasBall ? '0.35' : '1';
      sideOutBtn.disabled = !!hasBall;
    }
    if (oppScBtn){
      // Always available — opponent can score off our serve or their serve
      oppScBtn.style.opacity = '1';
      oppScBtn.disabled = false;
      oppScBtn.style.background = '#dc2626';
    }
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

  function refreshAllUI(){
    initTeamSelect();
    initMatchSelect();
    applyModeToUI();
    syncExportNameDefault();
    renderTable();
    updateOnboardingAndControls();
    populateMobilePlayerSelect();
    autoSelectServer();
    renderScore();
    renderRotationStrip();
  }
  window._vsRefreshAfterSync = refreshAllUI;

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

  var ourUp   = byId('ourScoreUp');
  var ourDown = byId('ourScoreDown');
  var oppUp   = byId('oppScoreUp');
  var oppDown = byId('oppScoreDown');

  if (ourUp) ourUp.addEventListener('click', function(){
    adjScore('our', 1);
    var team = activeTeam();
    if (team){
      ensureRotation(team);
      if (!team.rotation.hasBall) advanceRotation(team);
      team.rotation.hasBall = true;
      team.rotation.srMode  = false;
      autoSelectServer();
      saveState();
      renderRotationStrip();
      if (rotationBackdrop && rotationBackdrop.style.display !== 'none') renderRotationWheel();
    }
  });
  if (ourDown) ourDown.addEventListener('click', function(){ adjScore('our', -1); });
  if (oppUp) oppUp.addEventListener('click', function(){
    adjScore('opp', 1);
    var team = activeTeam();
    if (team){
      ensureRotation(team);
      team.rotation.hasBall = false;
      team.rotation.srMode  = true;
      saveState();
      renderRotationStrip();
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

  // Auto-select the current server as the active player when we have the ball
  function autoSelectServer(){
    var team = activeTeam();
    if (!team) return;
    ensureRotation(team);
    if (!team.rotation.hasBall) return;
    var serverId = getServerPlayerId(team);
    if (!serverId) return;
    if (activePlayerId === serverId) { updateSelectedBar(); return; }
    activePlayerId = serverId;
    setLastPlayer(serverId);
    // Update active highlight on existing strip buttons without rebuilding
    if (playerStripBtns){
      playerStripBtns.querySelectorAll('button').forEach(function(b){
        b.classList.toggle('active', b.dataset.pid === serverId);
      });
    }
    updateSelectedBar();
  }

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
      selectedPlayerBar.style.display = 'block';
      return;
    }
    var player = null;
    for (var i=0;i<team.players.length;i++) if(team.players[i].id===activePlayerId) player=team.players[i];
    if (!player){
      activePlayerId = '';
      selectedPlayerBar.textContent = 'Tap a player name above to select';
      selectedPlayerBar.style.background = '#64748b';
      selectedPlayerBar.style.display = 'block';
      return;
    }
    var isServer = false;
    ensureRotation(team);
    if (team.rotation.hasBall) isServer = (getServerPlayerId(team) === activePlayerId);
    selectedPlayerBar.textContent = 'Recording for: ' + (player.number?'#'+player.number+' ':'') + player.name + (isServer ? ' 🏐 Serving' : '');
    selectedPlayerBar.style.background = isServer ? '#16a34a' : '#1e3a8a';
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
  // Auto-select server on load if we have the ball and rotation is set up
  // Must run after populateMobilePlayerSelect so activePlayerId and strip are ready
  autoSelectServer();

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
  // mobilePlayerSelect removed — player selection now via player strip only

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
  });
  if (mobileModeCoach) mobileModeCoach.addEventListener('click', function(){
    if (modeCoachBtn) modeCoachBtn.click();
    mobileModeCoach.setAttribute('aria-pressed','true');
    mobileModePlayer.setAttribute('aria-pressed','false');
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
  if (mobileResetBtn) mobileResetBtn.addEventListener('click', function(){ if (window._vsReset) window._vsReset(); });

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
    navigator.serviceWorker.register('./sw.js?v=45', { updateViaCache: 'none' }).then(function(reg){
      reg.update();
      console.log('[VolleyStat] SW registered:', reg.scope);
    }).catch(function(err){
      console.warn('[VolleyStat] SW registration failed:', err);
    });
  });
}

// ── PWA: Install banner + help ───────────────────────────────────────────────
(function(){
  var INSTALL_DISMISS_KEY = 'volleystat_install_dismissed';
  var deferredPrompt = null;
  var banner = document.getElementById('installBanner');
  var titleEl = document.getElementById('installBannerTitle');
  var hintEl = document.getElementById('installBannerHint');
  var installBtn = document.getElementById('installBannerBtn');
  var dismissBtn = document.getElementById('installBannerDismiss');
  var helpBackdrop = document.getElementById('installHelpBackdrop');
  var helpBody = document.getElementById('installHelpBody');

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  function isSamsungBrowser() {
    return /SamsungBrowser/i.test(navigator.userAgent);
  }
  function isAndroid() {
    return /Android/i.test(navigator.userAgent);
  }
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function wasDismissed() {
    try { return localStorage.getItem(INSTALL_DISMISS_KEY) === '1'; } catch(e) { return false; }
  }
  function rememberDismissed() {
    try { localStorage.setItem(INSTALL_DISMISS_KEY, '1'); } catch(e) {}
  }

  function openInChrome() {
    var target = window.location.href.replace(/^https?:\/\//, '');
    window.location.href = 'intent://' + target + '#Intent;scheme=https;package=com.android.chrome;end';
  }
  window._vsOpenInChrome = openInChrome;

  function installHelpHtml() {
    if (isIOS()) {
      return '<ol><li>Tap the <strong>Share</strong> button in Safari.</li><li>Choose <strong>Add to Home Screen</strong>.</li><li>Tap <strong>Add</strong>.</li></ol>';
    }
    if (isSamsungBrowser()) {
      return '<ol><li>Open this site in <strong>Chrome</strong> (recommended).</li><li>In Chrome, tap the menu (⋮).</li><li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li></ol>' +
        '<div class="install-help-note">Samsung Internet may show an Android privacy warning during install. Chrome avoids that warning and is the recommended browser for installing VolleyStat.</div>';
    }
    if (isAndroid()) {
      return '<ol><li>Tap the browser menu (⋮).</li><li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li><li>Confirm the install.</li></ol>';
    }
    return '<ol><li>Use your browser menu.</li><li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li></ol>';
  }

  window._vsShowInstallHelp = function() {
    if (!helpBody || !helpBackdrop) return;
    helpBody.innerHTML = installHelpHtml();
    helpBackdrop.classList.remove('hidden');
  };
  window._vsCloseInstallHelp = function() {
    if (helpBackdrop) helpBackdrop.classList.add('hidden');
  };

  function configureBanner() {
    if (!titleEl || !hintEl || !installBtn) return;
    if (isSamsungBrowser()) {
      titleEl.textContent = 'Install VolleyStat with Chrome';
      hintEl.textContent = 'Samsung Internet can show a privacy warning. Chrome is recommended.';
      installBtn.textContent = 'Open Chrome';
      return;
    }
    if (isIOS()) {
      titleEl.textContent = 'Add VolleyStat to your home screen';
      hintEl.textContent = 'Install from Safari for the best courtside experience.';
      installBtn.textContent = 'How to install';
      return;
    }
    if (isAndroid()) {
      titleEl.textContent = 'Add VolleyStat to your home screen';
      hintEl.textContent = 'Install the app for quick access during tournaments.';
      installBtn.textContent = deferredPrompt ? 'Install' : 'How to install';
      return;
    }
    titleEl.textContent = 'Add VolleyStat to your home screen';
    hintEl.textContent = '';
    installBtn.textContent = deferredPrompt ? 'Install' : 'How to install';
  }

  function showBanner() {
    if (!banner || isStandalone() || wasDismissed()) return;
    configureBanner();
    banner.classList.add('visible');
  }

  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault();
    deferredPrompt = e;
    showBanner();
  });

  if (installBtn){
    installBtn.addEventListener('click', function(){
      if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function(){ deferredPrompt = null; });
        if (banner) banner.classList.remove('visible');
        return;
      }
      if (isSamsungBrowser()) {
        openInChrome();
        return;
      }
      window._vsShowInstallHelp();
    });
  }
  if (dismissBtn){
    dismissBtn.addEventListener('click', function(){
      rememberDismissed();
      if (banner) banner.classList.remove('visible');
    });
  }

  window.addEventListener('appinstalled', function(){
    rememberDismissed();
    if (banner) banner.classList.remove('visible');
    deferredPrompt = null;
  });

  window.addEventListener('load', function(){
    setTimeout(function(){
      if (!deferredPrompt) showBanner();
    }, 1500);
    var samsungNotice = document.getElementById('samsungInstallNotice');
    var samsungBtn = document.getElementById('samsungOpenChromeBtn');
    if (samsungNotice && isSamsungBrowser() && isAndroid() && !isStandalone()) {
      samsungNotice.classList.add('visible');
    }
    if (samsungBtn) {
      samsungBtn.addEventListener('click', openInChrome);
    }
  });
})();
