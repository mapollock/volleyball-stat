/***********************
 * VolleyStat v0.0.4 (Local-only Team Profiles)
 ***********************/
const STORAGE_KEY = "volleystat_v004";

// Default matches
const DEFAULT_MATCHES = ["Match 1", "Match 2", "Match 3"];

// Passing weights (edit if desired)
const PASS_WEIGHTS = {
  passToTarget: 3,
  passNearTarget: 2,
  passAwayTarget: 1,
  passShank: 0
};

// Hitting config
const HIT_ATTEMPT_ACTIONS = ["swing", "swingOut", "kill", "tip", "tipKill"];
const HIT_ERROR_ACTIONS = ["swingOut"];

// Default roster for a brand new team
function defaultPlayers() {
  return [
    { id: cryptoId(), name: "Player 1", number: "1", position: "OH" },
    { id: cryptoId(), name: "Player 2", number: "2", position: "MB" },
  ];
}

function emptyCounters() {
  return {
    serveIn: 0, serveOut: 0, ace: 0,
    passToTarget: 0, passNearTarget: 0, passAwayTarget: 0, passShank: 0,
    swing: 0, swingOut: 0, kill: 0, tip: 0, tipKill: 0
  };
}

function buildEmptyData(players, matches) {
  const data = {};
  for (const m of matches) {
    data[m] = { "1": {}, "2": {}, "3": {} };
    for (const s of ["1","2","3"]) {
      for (const p of players) {
        data[m][s][p.id] = emptyCounters();
      }
    }
  }
  return data;
}

function newTeam(name = "New Team") {
  const players = defaultPlayers();
  return {
    id: cryptoId(),
    name,
    matches: [...DEFAULT_MATCHES],
    players,
    data: buildEmptyData(players, DEFAULT_MATCHES),
    history: [] // undo stack for this team
  };
}

/***********************
 * STATE
 * state = { activeTeamId, teams: [team...] }
 ***********************/
let state = loadState();
normalizeAllTeams(state);
saveState(); // ensure storage is upgraded

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) return JSON.parse(raw);

  // --- MIGRATION: If older versions exist (v0.0.3 key), wrap into a team ---
  const oldRaw = localStorage.getItem("volleystat_v003");
  if (oldRaw) {
    const old = JSON.parse(oldRaw);

    // Build one team from old single-roster state
    const team = {
      id: cryptoId(),
      name: "My Team",
      matches: old.matches || [...DEFAULT_MATCHES],
      players: old.players || defaultPlayers(),
      data: old.data || buildEmptyData(old.players || defaultPlayers(), old.matches || DEFAULT_MATCHES),
      history: old.history || []
    };

    return { activeTeamId: team.id, teams: [team] };
  }

  // Fresh install
  const team = newTeam("My Team");
  return { activeTeamId: team.id, teams: [team] };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function activeTeam() {
  return state.teams.find(t => t.id === state.activeTeamId) || state.teams[0];
}

function normalizeTeam(team) {
  team.matches ||= [...DEFAULT_MATCHES];
  team.players ||= [];
  team.data ||= {};
  team.history ||= [];

  // Ensure data shape exists
  for (const m of team.matches) {
    team.data[m] ||= { "1": {}, "2": {}, "3": {} };
    for (const s of ["1","2","3"]) {
      team.data[m][s] ||= {};
      for (const p of team.players) {
        team.data[m][s][p.id] ||= emptyCounters();
      }
    }
  }
}

function normalizeAllTeams(st) {
  st.teams ||= [];
  if (!st.teams.length) st.teams.push(newTeam("My Team"));
  st.activeTeamId ||= st.teams[0].id;

  for (const t of st.teams) normalizeTeam(t);

  // Ensure activeTeamId is valid
  if (!st.teams.some(t => t.id === st.activeTeamId)) {
    st.activeTeamId = st.teams[0].id;
  }
}

/***********************
 * DOM REFS
 ***********************/
const teamSelect  = document.getElementById("teamSelect");
const teamsBtn    = document.getElementById("teamsBtn");

const matchSelect = document.getElementById("matchSelect");
const setSelect   = document.getElementById("setSelect");
const viewSelect  = document.getElementById("viewSelect");
const statsBody   = document.getElementById("statsBody");

const rosterBtn   = document.getElementById("rosterBtn");
const undoBtn     = document.getElementById("undoBtn");
const exportBtn   = document.getElementById("exportBtn");
const resetBtn    = document.getElementById("resetBtn");

// Picker modal
const pickerBackdrop = document.getElementById("pickerBackdrop");
const pickerTitle    = document.getElementById("pickerTitle");
const playerGrid     = document.getElementById("playerGrid");
const pickerClose    = document.getElementById("pickerClose");
const pickerCancel   = document.getElementById("pickerCancel");

// Roster modal
const rosterBackdrop = document.getElementById("rosterBackdrop");
const rosterClose    = document.getElementById("rosterClose");
const rosterDone     = document.getElementById("rosterDone");
const rosterList     = document.getElementById("rosterList");

const playerForm     = document.getElementById("playerForm");
const playerIdEl     = document.getElementById("playerId");
const playerNameEl   = document.getElementById("playerName");
const playerNumberEl = document.getElementById("playerNumber");
const playerPosEl    = document.getElementById("playerPos");
const newPlayerBtn   = document.getElementById("newPlayerBtn");

// Teams modal
const teamsBackdrop  = document.getElementById("teamsBackdrop");
const teamsClose     = document.getElementById("teamsClose");
const teamsDone      = document.getElementById("teamsDone");
const teamsList      = document.getElementById("teamsList");

const teamForm       = document.getElementById("teamForm");
const teamIdEl       = document.getElementById("teamId");
const teamNameEl     = document.getElementById("teamName");
const newTeamBtn     = document.getElementById("newTeamBtn");
const exportTeamBtn  = document.getElementById("exportTeamBtn");
const importTeamInput= document.getElementById("importTeamInput");

let pendingAction = null;

/***********************
 * INIT
 ***********************/
initTeamSelect();
initMatchSelect();
renderTable();

// Top stat buttons
document.querySelectorAll("button[data-action]").forEach(btn => {
  btn.addEventListener("click", () => {
    pendingAction = btn.dataset.action;
    pickerTitle.textContent = `Select Player — ${prettyAction(pendingAction)}`;
    openPicker();
  });
});

// selectors update
[matchSelect, setSelect, viewSelect].forEach(sel => {
  sel.addEventListener("change", renderTable);
});

// team selection
teamSelect.addEventListener("change", () => {
  state.activeTeamId = teamSelect.value;
  saveState();
  initMatchSelect();
  renderTable();
});

/***********************
 * TEAM SELECT + MATCH SELECT
 ***********************/
function initTeamSelect() {
  teamSelect.innerHTML = "";
  for (const t of state.teams) {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    teamSelect.appendChild(opt);
  }
  teamSelect.value = state.activeTeamId;
}

function initMatchSelect() {
  const team = activeTeam();
  matchSelect.innerHTML = "";
  for (const m of team.matches) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    matchSelect.appendChild(opt);
  }
  matchSelect.value = team.matches[0] || "Match 1";
}

/***********************
 * PICKER MODAL
 ***********************/
function openPicker() {
  buildPlayerGrid();
  pickerBackdrop.classList.remove("hidden");
}
function closePicker() {
  pickerBackdrop.classList.add("hidden");
  pendingAction = null;
}
pickerClose.addEventListener("click", closePicker);
pickerCancel.addEventListener("click", closePicker);
pickerBackdrop.addEventListener("click", (e) => {
  if (e.target === pickerBackdrop) closePicker();
});

function buildPlayerGrid() {
  const team = activeTeam();
  playerGrid.innerHTML = "";

  const players = [...team.players].sort(sortPlayers);

  for (const p of players) {
    const btn = document.createElement("button");
    btn.className = "player-btn";

    const top = `${p.number ? "#" + p.number + " " : ""}${p.name}`;
    btn.textContent = top;

    const sub = document.createElement("span");
    sub.className = "player-sub";
    sub.textContent = p.position ? `Pos: ${p.position}` : "Pos: —";
    btn.appendChild(sub);

    btn.addEventListener("click", () => recordEvent(pendingAction, p.id));
    playerGrid.appendChild(btn);
  }
}

/***********************
 * ROSTER MODAL (per active team)
 ***********************/
rosterBtn.addEventListener("click", () => openRoster());

function openRoster() {
  clearRosterForm();
  renderRosterList();
  rosterBackdrop.classList.remove("hidden");
}
function closeRoster() {
  rosterBackdrop.classList.add("hidden");
  renderTable();
}
rosterClose.addEventListener("click", closeRoster);
rosterDone.addEventListener("click", closeRoster);
rosterBackdrop.addEventListener("click", (e) => {
  if (e.target === rosterBackdrop) closeRoster();
});

newPlayerBtn.addEventListener("click", clearRosterForm);

playerForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const team = activeTeam();

  const id = playerIdEl.value || cryptoId();
  const name = (playerNameEl.value || "").trim();
  const number = (playerNumberEl.value || "").trim();
  const position = (playerPosEl.value || "").trim();
  if (!name) return;

  const idx = team.players.findIndex(p => p.id === id);
  if (idx >= 0) {
    team.players[idx] = { id, name, number, position };
  } else {
    team.players.push({ id, name, number, position });

    // Add counters for new player across all match/sets
    for (const m of team.matches) {
      team.data[m] ||= { "1": {}, "2": {}, "3": {} };
      for (const s of ["1","2","3"]) {
        team.data[m][s] ||= {};
        team.data[m][s][id] = emptyCounters();
      }
    }
  }

  normalizeTeam(team);
  saveState();
  clearRosterForm();
  renderRosterList();
  renderTable();
});

function clearRosterForm() {
  playerIdEl.value = "";
  playerNameEl.value = "";
  playerNumberEl.value = "";
  playerPosEl.value = "";
  playerNameEl.focus();
}

function renderRosterList() {
  const team = activeTeam();
  rosterList.innerHTML = "";

  const players = [...team.players].sort(sortPlayers);
  for (const p of players) {
    const item = document.createElement("div");
    item.className = "roster-item";

    const meta = document.createElement("div");
    meta.className = "meta";
    const top = document.createElement("div");
    top.className = "top";
    top.textContent = `${p.number ? "#" + p.number + " " : ""}${p.name}`;
    const bottom = document.createElement("div");
    bottom.className = "bottom";
    bottom.textContent = `Pos: ${p.position || "—"}`;
    meta.appendChild(top);
    meta.appendChild(bottom);

    const actions = document.createElement("div");
    actions.className = "actions";

    const editBtn = document.createElement("button");
    editBtn.className = "btn secondary";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => {
      playerIdEl.value = p.id;
      playerNameEl.value = p.name;
      playerNumberEl.value = p.number || "";
      playerPosEl.value = p.position || "";
      playerNameEl.focus();
    });

    const delBtn = document.createElement("button");
    delBtn.className = "btn danger";
    delBtn.textContent = "Remove";
    delBtn.addEventListener("click", () => removePlayer(p.id));

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    item.appendChild(meta);
    item.appendChild(actions);
    rosterList.appendChild(item);
  }
}

function removePlayer(playerId) {
  const team = activeTeam();
  const p = team.players.find(x => x.id === playerId);
  if (!p) return;

  const ok = confirm(`Remove ${p.name} from ${team.name}? This also removes their saved stats.`);
  if (!ok) return;

  team.players = team.players.filter(x => x.id !== playerId);

  for (const m of team.matches) {
    for (const s of ["1","2","3"]) {
      delete team.data[m]?.[s]?.[playerId];
    }
  }

  team.history = team.history.filter(h => h.playerId !== playerId);

  normalizeTeam(team);
  saveState();
  clearRosterForm();
  renderRosterList();
  renderTable();
}

/***********************
 * TEAMS MODAL
 ***********************/
teamsBtn.addEventListener("click", openTeams);

function openTeams() {
  clearTeamForm();
  renderTeamsList();
  teamsBackdrop.classList.remove("hidden");
}

function closeTeams() {
  teamsBackdrop.classList.add("hidden");
  initTeamSelect();
  initMatchSelect();
  renderTable();
}

teamsClose.addEventListener("click", closeTeams);
teamsDone.addEventListener("click", closeTeams);
teamsBackdrop.addEventListener("click", (e) => {
  if (e.target === teamsBackdrop) closeTeams();
});

newTeamBtn.addEventListener("click", clearTeamForm);

teamForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const id = teamIdEl.value || cryptoId();
  const name = (teamNameEl.value || "").trim();
  if (!name) return;

  const idx = state.teams.findIndex(t => t.id === id);
  if (idx >= 0) {
    state.teams[idx].name = name;
  } else {
    const t = newTeam(name);
    t.id = id;
    state.teams.push(t);
    state.activeTeamId = t.id;
  }

  normalizeAllTeams(state);
  saveState();
  clearTeamForm();
  renderTeamsList();
  initTeamSelect();
});

function clearTeamForm() {
  teamIdEl.value = "";
  teamNameEl.value = "";
  teamNameEl.focus();
}

function renderTeamsList() {
  teamsList.innerHTML = "";

  const teams = [...state.teams].sort((a,b) => a.name.localeCompare(b.name));
  for (const t of teams) {
    const item = document.createElement("div");
    item.className = "roster-item";

    const meta = document.createElement("div");
    meta.className = "meta";
    const top = document.createElement("div");
    top.className = "top";
    top.textContent = t.name;
    const bottom = document.createElement("div");
    bottom.className = "bottom";
    bottom.textContent = `${t.players?.length || 0} players`;
    meta.appendChild(top);
    meta.appendChild(bottom);

    const actions = document.createElement("div");
    actions.className = "actions";

    const useBtn = document.createElement("button");
    useBtn.className = "btn secondary";
    useBtn.textContent = "Use";
    useBtn.addEventListener("click", () => {
      state.activeTeamId = t.id;
      saveState();
      initTeamSelect();
      initMatchSelect();
      renderTable();
    });

    const editBtn = document.createElement("button");
    editBtn.className = "btn secondary";
    editBtn.textContent = "Rename";
    editBtn.addEventListener("click", () => {
      teamIdEl.value = t.id;
      teamNameEl.value = t.name;
      teamNameEl.focus();
    });

    const delBtn = document.createElement("button");
    delBtn.className = "btn danger";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => deleteTeam(t.id));

    actions.appendChild(useBtn);
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    item.appendChild(meta);
    item.appendChild(actions);
    teamsList.appendChild(item);
  }
}

function deleteTeam(teamId) {
  const t = state.teams.find(x => x.id === teamId);
  if (!t) return;

  const ok = confirm(`Delete team "${t.name}"? This removes roster + stats from this device.`);
  if (!ok) return;

  state.teams = state.teams.filter(x => x.id !== teamId);
  normalizeAllTeams(state);
  saveState();

  initTeamSelect();
  initMatchSelect();
  renderTeamsList();
  renderTable();
}

// Export active team JSON
exportTeamBtn.addEventListener("click", () => {
  const team = activeTeam();
  const payload = JSON.stringify(team, null, 2);
  const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFile(team.name)}.team.json`;
  a.click();

  URL.revokeObjectURL(url);
});

// Import team JSON
importTeamInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const team = JSON.parse(text);

    if (!team?.name || !team?.players || !team?.matches) {
      alert("That file doesn’t look like a valid team export.");
      return;
    }

    // Ensure unique ID (avoid collisions)
    team.id = cryptoId();

    normalizeTeam(team);
    state.teams.push(team);
    state.activeTeamId = team.id;

    normalizeAllTeams(state);
    saveState();

    initTeamSelect();
    initMatchSelect();
    renderTeamsList();
    renderTable();
    alert(`Imported team: ${team.name}`);
  } catch (err) {
    alert("Import failed. Make sure it’s a .team.json export from this app.");
  } finally {
    importTeamInput.value = "";
  }
});

/***********************
 * RECORD EVENT (per active team)
 ***********************/
function recordEvent(action, playerId) {
  const team = activeTeam();
  const match = matchSelect.value;
  const set = setSelect.value;

  const counters = team.data?.[match]?.[set]?.[playerId];
  if (!counters || counters[action] === undefined) {
    alert("Unknown player/action. Try reopening Teams/Roster.");
    return;
  }

  counters[action] += 1;

  team.history.push({ match, set, playerId, action, ts: Date.now() });

  saveState();
  closePicker();
  renderTable();
}

/***********************
 * AGGREGATION + DERIVED METRICS
 ***********************/
function getAggregateCounters(playerId) {
  const team = activeTeam();
  const view = viewSelect.value;
  const match = matchSelect.value;
  const set = setSelect.value;

  const agg = emptyCounters();

  function addFrom(matchName, setNum) {
    const c = team.data?.[matchName]?.[setNum]?.[playerId];
    if (!c) return;
    for (const k of Object.keys(agg)) agg[k] += c[k] || 0;
  }

  if (view === "set") {
    addFrom(match, set);
  } else if (view === "match") {
    for (const s of ["1","2","3"]) addFrom(match, s);
  } else {
    for (const m of team.matches) {
      for (const s of ["1","2","3"]) addFrom(m, s);
    }
  }

  return agg;
}

function safePct(n, d) {
  if (!d) return 0;
  return n / d;
}

function derived(playerId) {
  const c = getAggregateCounters(playerId);

  // Per your rule:
  // Serve Attempts = Ace + Serve In + Serve Out
  const serveAtt = c.ace + c.serveIn + c.serveOut;

  // "Successful serves" are Serve In + Ace
  const serveMade = c.serveIn + c.ace;
  const servePct = safePct(serveMade, serveAtt);
  const acePct = safePct(c.ace, serveAtt);

  const passAtt = c.passToTarget + c.passNearTarget + c.passAwayTarget + c.passShank;
  const passPts =
    c.passToTarget * PASS_WEIGHTS.passToTarget +
    c.passNearTarget * PASS_WEIGHTS.passNearTarget +
    c.passAwayTarget * PASS_WEIGHTS.passAwayTarget +
    c.passShank * PASS_WEIGHTS.passShank;
  const passAvg = passAtt ? (passPts / passAtt) : 0;

  const hitAtt = HIT_ATTEMPT_ACTIONS.reduce((sum, key) => sum + (c[key] || 0), 0);
  const kills  = (c.kill || 0) + (c.tipKill || 0);
  const errs   = HIT_ERROR_ACTIONS.reduce((sum, key) => sum + (c[key] || 0), 0);
  const hitAvg = hitAtt ? ((kills - errs) / hitAtt) : 0;
  const killPct = safePct(kills, hitAtt);

  return { serveAtt, servePct, acePct, passAtt, passAvg, hitAtt, hitAvg, killPct };
}

function fmtPct(x) { return (x * 100).toFixed(1) + "%"; }
function fmtNum(x, digits=2) { return Number.isFinite(x) ? x.toFixed(digits) : "0.00"; }

/***********************
 * RENDER TABLE (per active team)
 ***********************/
function renderTable() {
  const team = activeTeam();
  statsBody.innerHTML = "";

  const players = [...team.players].sort(sortPlayers);

  for (const p of players) {
    const d = derived(p.id);
    const tr = document.createElement("tr");

    tr.appendChild(td(p.number || "—", "left sticky-col"));
    tr.appendChild(td(p.name, "left"));
    tr.appendChild(td(p.position || "—", "left"));

    tr.appendChild(td(String(d.serveAtt)));
    tr.appendChild(td(fmtPct(d.servePct)));
    tr.appendChild(td(fmtPct(d.acePct)));

    tr.appendChild(td(String(d.passAtt)));
    tr.appendChild(td(fmtNum(d.passAvg, 2)));

    tr.appendChild(td(String(d.hitAtt)));
    tr.appendChild(td(fmtNum(d.hitAvg, 3)));
    tr.appendChild(td(fmtPct(d.killPct)));

    statsBody.appendChild(tr);
  }
}

function td(text, cls="") {
  const el = document.createElement("td");
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
}

/***********************
 * CONTROLS
 ***********************/
undoBtn.addEventListener("click", () => {
  const team = activeTeam();
  const last = team.history.pop();
  if (!last) return;

  const c = team.data?.[last.match]?.[last.set]?.[last.playerId];
  if (c && c[last.action] > 0) c[last.action] -= 1;

  saveState();
  renderTable();
});

exportBtn.addEventListener("click", () => {
  const team = activeTeam();
  const header = ["Team","Jersey","Player","Pos","ServeAtt","Serve%","Ace%","PassAtt","PassAvg","HitAtt","HitAvg","Kill%"];
  const rows = [header.join(",")];

  const players = [...team.players].sort((a,b) => (a.name||"").localeCompare(b.name||""));
  for (const p of players) {
    const d = derived(p.id);
    rows.push([
      csv(team.name),
      csv(p.number || ""),
      csv(p.name),
      csv(p.position || ""),
      d.serveAtt,
      (d.servePct*100).toFixed(1),
      (d.acePct*100).toFixed(1),
      d.passAtt,
      d.passAvg.toFixed(2),
      d.hitAtt,
      d.hitAvg.toFixed(3),
      (d.killPct*100).toFixed(1)
    ].join(","));
  }

  const blob = new Blob([rows.join("\n")], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFile(team.name)}_${viewSelect.value}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

resetBtn.addEventListener("click", () => {
  const ok = confirm("Reset ALL teams + stats on this device? This cannot be undone.");
  if (!ok) return;
  localStorage.removeItem(STORAGE_KEY);
  // Optionally also remove old key
  localStorage.removeItem("volleystat_v003");
  state = loadState();
  normalizeAllTeams(state);
  saveState();
  initTeamSelect();
  initMatchSelect();
  renderTable();
});

/***********************
 * HELPERS
 ***********************/
function prettyAction(a){
  const map = {
    serveIn:"Serve In", serveOut:"Serve Out", ace:"Ace",
    passToTarget:"Pass: To Target", passNearTarget:"Pass: Near Target",
    passAwayTarget:"Pass: Away", passShank:"Pass: Shank",
    swing:"Swing", swingOut:"Swing Out", kill:"Kill", tip:"Tip", tipKill:"Tip Kill"
  };
  return map[a] || a;
}

function csv(v){
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replaceAll('"','""')}"`;
  }
  return s;
}

function safeFile(name) {
  return String(name || "team").replace(/[^\w\-]+/g, "_").slice(0, 60);
}

function sortPlayers(a,b) {
  const an = parseInt(a.number,10), bn = parseInt(b.number,10);
  const aNum = Number.isFinite(an), bNum = Number.isFinite(bn);
  if (aNum && bNum) return an - bn;
  if (aNum && !bNum) return -1;
  if (!aNum && bNum) return 1;
  return (a.name||"").localeCompare(b.name||"");
}

function cryptoId(){
  if (crypto?.randomUUID) return crypto.randomUUID();
  return "id_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}
