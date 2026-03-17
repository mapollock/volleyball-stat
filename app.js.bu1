/**
 * VolleyStat v0.0.7
 * Serving model (opponent pass quality):
 *   Opp 3 -> serve1
 *   Opp 2 -> serve2
 *   Opp 1 -> serve3
 *   Shank/no pass -> ace
 *
 * Serve Avg heatmap + legend in index.html.
 * Serve Pressure% = (serve3 + ace) / serve attempts
 */

const STORAGE_KEY = "volleystat_v007";
const DEFAULT_MATCHES = ["Match 1", "Match 2", "Match 3"];

const PASS_WEIGHTS = {
  passToTarget: 3,
  passNearTarget: 2,
  passAwayTarget: 1,
  passShank: 0
};

const SERVE_WEIGHTS = {
  serve1: 1,
  serve2: 2,
  serve3: 3,
  ace: 4
};

const HIT_ATTEMPT_ACTIONS = ["swing", "swingOut", "kill", "tip", "tipKill"];
const HIT_ERROR_ACTIONS = ["swingOut"];

function cryptoId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return "id_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function emptyCounters() {
  return {
    serve1: 0, serve2: 0, serve3: 0, ace: 0,
    passToTarget: 0, passNearTarget: 0, passAwayTarget: 0, passShank: 0,
    swing: 0, swingOut: 0, kill: 0, tip: 0, tipKill: 0
  };
}

function safePct(n, d) { return d ? (n / d) : 0; }
function fmtPct(x) { return (x * 100).toFixed(1) + "%"; }
function fmtNum(x, digits = 2) { return Number.isFinite(x) ? x.toFixed(digits) : (0).toFixed(digits); }

function csv(v) {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function safeFile(name) {
  return String(name || "team")
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function sortPlayers(a, b) {
  const an = parseInt(a.number, 10), bn = parseInt(b.number, 10);
  const aNum = Number.isFinite(an), bNum = Number.isFinite(bn);
  if (aNum && bNum) return an - bn;
  if (aNum && !bNum) return -1;
  if (!aNum && bNum) return 1;
  return (a.name || "").localeCompare(b.name || "");
}

function prettyAction(a) {
  const map = {
    serve1: "1",
    serve2: "2",
    serve3: "3",
    ace: "ACE",
    passToTarget: "Pass 3",
    passNearTarget: "Pass 2",
    passAwayTarget: "Pass 1",
    passShank: "Pass 0",
    swing: "Swing",
    swingOut: "Error",
    kill: "Kill",
    tip: "Tip",
    tipKill: "Tip+"
  };
  return map[a] || a;
}

function buildEmptyData(players, matches) {
  const data = {};
  for (const m of matches) {
    data[m] = { "1": {}, "2": {}, "3": {} };
    for (const s of ["1", "2", "3"]) {
      data[m][s] = {};
      for (const p of players) {
        data[m][s][p.id] = emptyCounters();
      }
    }
  }
  return data;
}

function newTeam(name) {
  const players = [];
  const matches = [...DEFAULT_MATCHES];
  return { id: cryptoId(), name, matches, players, data: buildEmptyData(players, matches), history: [] };
}

function getViewLabel() {
  const v = viewSelect?.value || "tournament";
  if (v === "set") return "Current Set";
  if (v === "match") return "Current Match";
  return "Tournament Total";
}

function getExportContextLabel() {
  const view = viewSelect?.value || "tournament";
  const match = matchSelect?.value || "Match 1";
  const set = setSelect?.value || "1";
  if (view === "set") return `${match} Set ${set}`;
  if (view === "match") return `${match}`;
  return "Tournament";
}

function defaultExportBaseName() {
  const team = activeTeam();
  const teamName = team?.name || "team";
  return `${safeFile(teamName)}_${safeFile(getExportContextLabel())}`;
}

function syncExportNameDefault() {
  if (!exportName) return;
  if (!exportName.dataset.userEdited) exportName.value = defaultExportBaseName();
}

let state = loadState();
normalizeAllTeams(state);
saveState();

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch { /* ignore */ }
  }
  // start with no teams
  return { activeTeamId: null, teams: [] };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function activeTeam() {
  if (!state?.teams?.length) return null;
  return state.teams.find(t => t.id === state.activeTeamId) || state.teams[0];
}

function ensureCounters(team, match, set, playerId) {
  team.data ||= {};
  team.data[match] ||= { "1": {}, "2": {}, "3": {} };
  team.data[match][set] ||= {};
  if (!team.data[match][set][playerId]) team.data[match][set][playerId] = emptyCounters();
}

function normalizeTeam(team) {
  team.id ||= cryptoId();
  team.name ||= "Team";
  if (!Array.isArray(team.matches) || !team.matches.length) team.matches = [...DEFAULT_MATCHES];
  if (!Array.isArray(team.players)) team.players = [];
  if (!Array.isArray(team.history)) team.history = [];

  team.data ||= {};
  for (const m of team.matches) {
    team.data[m] ||= { "1": {}, "2": {}, "3": {} };
    for (const s of ["1", "2", "3"]) {
      team.data[m][s] ||= {};
      for (const p of team.players) {
        const existing = team.data[m][s][p.id] || {};
        team.data[m][s][p.id] = { ...emptyCounters(), ...existing };
      }
    }
  }
}

function normalizeAllTeams(st) {
  st ||= { activeTeamId: null, teams: [] };
  if (!Array.isArray(st.teams)) st.teams = [];
  for (const t of st.teams) normalizeTeam(t);
  if (st.teams.length) {
    if (!st.activeTeamId || !st.teams.some(t => t.id === st.activeTeamId)) st.activeTeamId = st.teams[0].id;
  } else {
    st.activeTeamId = null;
  }
}

// DOM refs
const teamSelect = document.getElementById("teamSelect");
const teamsBtn = document.getElementById("teamsBtn");
const matchSelect = document.getElementById("matchSelect");
const setSelect = document.getElementById("setSelect");
const viewSelect = document.getElementById("viewSelect");
const statsBody = document.getElementById("statsBody");
const rosterBtn = document.getElementById("rosterBtn");
const undoBtn = document.getElementById("undoBtn");
const exportName = document.getElementById("exportName");
const exportBtn = document.getElementById("exportBtn");
const resetBtn = document.getElementById("resetBtn");

// Onboarding
const onboarding = document.getElementById("onboarding");
const onboardingTitle = document.getElementById("onboardingTitle");
const onboardingSub = document.getElementById("onboardingSub");
const onboardingTeamsBtn = document.getElementById("onboardingTeamsBtn");
const onboardingRosterBtn = document.getElementById("onboardingRosterBtn");

// Export confirm modal
const exportConfirmBackdrop = document.getElementById("exportConfirmBackdrop");
const exportConfirmClose = document.getElementById("exportConfirmClose");
const exportConfirmCancel = document.getElementById("exportConfirmCancel");
const exportConfirmOk = document.getElementById("exportConfirmOk");
const exportConfirmFile = document.getElementById("exportConfirmFile");
const exportConfirmTeam = document.getElementById("exportConfirmTeam");
const exportConfirmView = document.getElementById("exportConfirmView");
const exportConfirmScope = document.getElementById("exportConfirmScope");

// Picker modal
const pickerBackdrop = document.getElementById("pickerBackdrop");
const pickerTitle = document.getElementById("pickerTitle");
const playerGrid = document.getElementById("playerGrid");
const pickerClose = document.getElementById("pickerClose");
const pickerCancel = document.getElementById("pickerCancel");

// Roster modal
const rosterBackdrop = document.getElementById("rosterBackdrop");
const rosterClose = document.getElementById("rosterClose");
const rosterDone = document.getElementById("rosterDone");
const rosterList = document.getElementById("rosterList");
const playerForm = document.getElementById("playerForm");
const playerIdEl = document.getElementById("playerId");
const playerNameEl = document.getElementById("playerName");
const playerNumberEl = document.getElementById("playerNumber");
const playerPosEl = document.getElementById("playerPos");
const newPlayerBtn = document.getElementById("newPlayerBtn");

// Teams modal
const teamsBackdrop = document.getElementById("teamsBackdrop");
const teamsClose = document.getElementById("teamsClose");
const teamsDone = document.getElementById("teamsDone");
const teamsList = document.getElementById("teamsList");
const teamForm = document.getElementById("teamForm");
const teamIdEl = document.getElementById("teamId");
const teamNameEl = document.getElementById("teamName");
const newTeamBtn = document.getElementById("newTeamBtn");
const exportTeamBtn = document.getElementById("exportTeamBtn");
const importTeamBtn = document.getElementById("importTeamBtn");
const importTeamInput = document.getElementById("importTeamInput");

let pendingAction = null;

function setDisabled(el, disabled) {
  if (!el) return;
  el.disabled = !!disabled;
}

function setToolbarStatsEnabled(enabled) {
  document.querySelectorAll(".toolbar button[data-action]").forEach(btn => {
    btn.disabled = !enabled;
  });
}

function updateOnboardingAndControls() {
  const team = activeTeam();
  const hasTeam = !!team;
  const hasRoster = !!(team && team.players && team.players.length);

  if (onboarding) {
    if (!hasTeam) {
      onboarding.classList.remove("hidden");
      onboardingTitle.textContent = "Step 1: Add a Team";
      onboardingSub.textContent = "You don’t have any teams yet. Add a team to begin.";
      onboardingRosterBtn.style.display = "none";
    } else if (!hasRoster) {
      onboarding.classList.remove("hidden");
      onboardingTitle.textContent = "Step 2: Add Your Roster";
      onboardingSub.textContent = "Your team is saved. Now add players to your roster.";
      onboardingRosterBtn.style.display = "inline-flex";
    } else {
      onboarding.classList.add("hidden");
      onboardingRosterBtn.style.display = "inline-flex";
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

// Export confirm modal
let _exportConfirmResolve = null;
let _exportConfirmLastFocus = null;

function isExportConfirmOpen() {
  return exportConfirmBackdrop && !exportConfirmBackdrop.classList.contains("hidden");
}

function openExportConfirmModal({ filename, teamName, viewLabel, scopeLabel }) {
  return new Promise((resolve) => {
    if (!exportConfirmBackdrop) return resolve(true);

    _exportConfirmLastFocus = document.activeElement;
    _exportConfirmResolve = resolve;

    exportConfirmFile.textContent = filename;
    exportConfirmTeam.textContent = teamName;
    exportConfirmView.textContent = viewLabel;
    exportConfirmScope.textContent = scopeLabel;

    exportConfirmBackdrop.classList.remove("hidden");
    setTimeout(() => exportConfirmOk?.focus(), 0);
  });
}

function closeExportConfirmModal(result) {
  if (!exportConfirmBackdrop) return;
  exportConfirmBackdrop.classList.add("hidden");

  const resolver = _exportConfirmResolve;
  _exportConfirmResolve = null;

  try { _exportConfirmLastFocus?.focus?.(); } catch {}
  _exportConfirmLastFocus = null;

  if (resolver) resolver(!!result);
}

// Init
initTeamSelect();
initMatchSelect();
renderTable();
updateOnboardingAndControls();

onboardingTeamsBtn?.addEventListener("click", () => openTeams());
onboardingRosterBtn?.addEventListener("click", () => openRoster());

exportConfirmOk?.addEventListener("click", () => closeExportConfirmModal(true));
exportConfirmCancel?.addEventListener("click", () => closeExportConfirmModal(false));
exportConfirmClose?.addEventListener("click", () => closeExportConfirmModal(false));
exportConfirmBackdrop?.addEventListener("click", (e) => {
  if (e.target === exportConfirmBackdrop) closeExportConfirmModal(false);
});

document.addEventListener("keydown", (e) => {
  if (!isExportConfirmOpen()) return;
  if (e.key === "Escape") {
    e.preventDefault();
    closeExportConfirmModal(false);
  }
});

exportName?.addEventListener("input", () => {
  exportName.dataset.userEdited = exportName.value.trim() ? "1" : "";
  if (!exportName.dataset.userEdited) syncExportNameDefault();
});

importTeamBtn?.addEventListener("click", () => importTeamInput?.click());

document.querySelectorAll("button[data-action]").forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    pendingAction = btn.dataset.action;
    pickerTitle.textContent = `Select Player — ${prettyAction(pendingAction)}`;
    openPicker();
  });
});

[matchSelect, setSelect, viewSelect].forEach(sel =>
  sel?.addEventListener("change", () => {
    renderTable();
    syncExportNameDefault();
  })
);

teamSelect?.addEventListener("change", () => {
  state.activeTeamId = teamSelect.value;
  saveState();
  initMatchSelect();
  renderTable();
  exportName && (exportName.dataset.userEdited = "");
  updateOnboardingAndControls();
});

function initTeamSelect() {
  teamSelect.innerHTML = "";

  if (!state.teams.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No teams yet";
    opt.disabled = true;
    opt.selected = true;
    teamSelect.appendChild(opt);
    return;
  }

  for (const t of state.teams) {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    teamSelect.appendChild(opt);
  }

  const active = activeTeam();
  teamSelect.value = active?.id || state.teams[0].id;
}

function initMatchSelect() {
  matchSelect.innerHTML = "";
  const team = activeTeam();
  if (!team) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "—";
    opt.disabled = true;
    opt.selected = true;
    matchSelect.appendChild(opt);
    return;
  }

  for (const m of team.matches) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    matchSelect.appendChild(opt);
  }
  matchSelect.value = team.matches[0] || "Match 1";
}

// Picker
function openPicker() {
  buildPlayerGrid();
  pickerBackdrop.classList.remove("hidden");
}

function closePicker() {
  pickerBackdrop.classList.add("hidden");
  pendingAction = null;
}

pickerClose?.addEventListener("click", closePicker);
pickerCancel?.addEventListener("click", closePicker);
pickerBackdrop?.addEventListener("click", (e) => {
  if (e.target === pickerBackdrop) closePicker();
});

function buildPlayerGrid() {
  const team = activeTeam();
  playerGrid.innerHTML = "";
  const players = [...(team?.players || [])].sort(sortPlayers);

  for (const p of players) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "player-btn";

    const top = `${p.number ? "#" + p.number + " " : ""}${p.name}`;
    btn.appendChild(document.createTextNode(top));

    const sub = document.createElement("span");
    sub.className = "player-sub";
    sub.textContent = p.position ? `Pos: ${p.position}` : "Pos: —";
    btn.appendChild(sub);

    btn.addEventListener("click", () => recordEvent(pendingAction, p.id));
    playerGrid.appendChild(btn);
  }
}

// Roster
rosterBtn?.addEventListener("click", openRoster);

function openRoster() {
  if (!activeTeam()) return;
  clearRosterForm();
  renderRosterList();
  rosterBackdrop.classList.remove("hidden");
}

function closeRoster() {
  rosterBackdrop.classList.add("hidden");
  renderTable();
  updateOnboardingAndControls();
}

rosterClose?.addEventListener("click", closeRoster);
rosterDone?.addEventListener("click", closeRoster);
rosterBackdrop?.addEventListener("click", (e) => {
  if (e.target === rosterBackdrop) closeRoster();
});

newPlayerBtn?.addEventListener("click", clearRosterForm);

playerForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const team = activeTeam();
  if (!team) return;

  const id = playerIdEl.value || cryptoId();
  const name = (playerNameEl.value || "").trim();
  const number = (playerNumberEl.value || "").trim();
  const position = (playerPosEl.value || "").trim();
  if (!name) return;

  const idx = team.players.findIndex(p => p.id === id);
  const player = { id, name, number, position };

  if (idx >= 0) team.players[idx] = player;
  else team.players.push(player);

  // ensure counters for this player
  for (const m of team.matches) {
    for (const s of ["1", "2", "3"]) {
      ensureCounters(team, m, s, id);
    }
  }

  normalizeTeam(team);
  saveState();
  clearRosterForm();
  renderRosterList();
  renderTable();
  updateOnboardingAndControls();
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
  const players = [...(team?.players || [])].sort(sortPlayers);

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
    editBtn.type = "button";
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
    delBtn.type = "button";
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
  const p = team?.players?.find(x => x.id === playerId);
  if (!team || !p) return;

  const ok = confirm(`Remove ${p.name} from ${team.name}? This also removes their saved stats.`);
  if (!ok) return;

  team.players = team.players.filter(x => x.id !== playerId);

  for (const m of team.matches) {
    for (const s of ["1", "2", "3"]) {
      delete team.data?.[m]?.[s]?.[playerId];
    }
  }

  team.history = team.history.filter(h => h.playerId !== playerId);
  normalizeTeam(team);
  saveState();
  renderRosterList();
  renderTable();
  updateOnboardingAndControls();
}

// Teams
teamsBtn?.addEventListener("click", openTeams);

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
  exportName && (exportName.dataset.userEdited = "");
  updateOnboardingAndControls();
}

teamsClose?.addEventListener("click", closeTeams);
teamsDone?.addEventListener("click", closeTeams);
teamsBackdrop?.addEventListener("click", (e) => {
  if (e.target === teamsBackdrop) closeTeams();
});

newTeamBtn?.addEventListener("click", clearTeamForm);

teamForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = teamIdEl.value || cryptoId();
  const name = (teamNameEl.value || "").trim();
  if (!name) return;

  const idx = state.teams.findIndex(t => t.id === id);
  if (idx >= 0) state.teams[idx].name = name;
  else {
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
  initMatchSelect();
  renderTable();
  updateOnboardingAndControls();
});

function clearTeamForm() {
  teamIdEl.value = "";
  teamNameEl.value = "";
  teamNameEl.focus();
}

function renderTeamsList() {
  teamsList.innerHTML = "";

  if (!state.teams.length) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "No teams yet. Use the form above to create your first team.";
    teamsList.appendChild(empty);
    return;
  }

  const teams = [...state.teams].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
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
    useBtn.type = "button";
    useBtn.className = "btn secondary";
    useBtn.textContent = "Use";
    useBtn.addEventListener("click", () => {
      state.activeTeamId = t.id;
      saveState();
      initTeamSelect();
      initMatchSelect();
      renderTable();
      exportName && (exportName.dataset.userEdited = "");
      updateOnboardingAndControls();
    });

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn secondary";
    editBtn.textContent = "Rename";
    editBtn.addEventListener("click", () => {
      teamIdEl.value = t.id;
      teamNameEl.value = t.name;
      teamNameEl.focus();
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
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
  exportName && (exportName.dataset.userEdited = "");
  updateOnboardingAndControls();
}

exportTeamBtn?.addEventListener("click", () => {
  const team = activeTeam();
  if (!team) return;
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
importTeamInput?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const team = JSON.parse(text);
    if (!team?.name || !Array.isArray(team?.matches)) {
      alert("That file doesn’t look like a valid team export.");
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
    exportName && (exportName.dataset.userEdited = "");
    updateOnboardingAndControls();

    alert(`Imported team: ${team.name}`);
  } catch (err) {
    console.error(err);
    alert("Import failed. Make sure it’s a .team.json export from this app.");
  } finally {
    importTeamInput.value = "";
  }
});

// Record + derived
function recordEvent(action, playerId) {
  const team = activeTeam();
  if (!team) return;

  const match = matchSelect.value;
  const set = setSelect.value;

  ensureCounters(team, match, set, playerId);
  const counters = team.data[match][set][playerId];

  if (counters[action] === undefined) {
    alert("Unknown action. Try reloading the page.");
    return;
  }

  counters[action] += 1;
  team.history.push({ match, set, playerId, action, ts: Date.now() });

  saveState();
  closePicker();
  renderTable();
  updateOnboardingAndControls();
}

function getAggregateCounters(playerId) {
  const team = activeTeam();
  if (!team) return emptyCounters();

  const view = viewSelect.value;
  const match = matchSelect.value;
  const set = setSelect.value;

  const agg = emptyCounters();

  function addFrom(matchName, setNum) {
    const c = team.data?.[matchName]?.[setNum]?.[playerId];
    if (!c) return;
    for (const k of Object.keys(agg)) agg[k] += c[k] || 0;
  }

  if (view === "set") addFrom(match, set);
  else if (view === "match") ["1","2","3"].forEach(s => addFrom(match, s));
  else team.matches.forEach(m => ["1","2","3"].forEach(s => addFrom(m, s)));

  return agg;
}

function derived(playerId) {
  const c = getAggregateCounters(playerId);

  const serveAtt = (c.serve1 || 0) + (c.serve2 || 0) + (c.serve3 || 0) + (c.ace || 0);
  const servePts =
    (c.serve1 || 0) * SERVE_WEIGHTS.serve1 +
    (c.serve2 || 0) * SERVE_WEIGHTS.serve2 +
    (c.serve3 || 0) * SERVE_WEIGHTS.serve3 +
    (c.ace || 0) * SERVE_WEIGHTS.ace;
  const serveAvg = serveAtt ? (servePts / serveAtt) : 0;
  const acePct = safePct((c.ace || 0), serveAtt);
  const servePressurePct = safePct(((c.serve3 || 0) + (c.ace || 0)), serveAtt);

  const passAtt = (c.passToTarget || 0) + (c.passNearTarget || 0) + (c.passAwayTarget || 0) + (c.passShank || 0);
  const passPts =
    (c.passToTarget || 0) * PASS_WEIGHTS.passToTarget +
    (c.passNearTarget || 0) * PASS_WEIGHTS.passNearTarget +
    (c.passAwayTarget || 0) * PASS_WEIGHTS.passAwayTarget +
    (c.passShank || 0) * PASS_WEIGHTS.passShank;
  const passAvg = passAtt ? (passPts / passAtt) : 0;

  const hitAtt = HIT_ATTEMPT_ACTIONS.reduce((sum, key) => sum + (c[key] || 0), 0);
  const kills = (c.kill || 0) + (c.tipKill || 0);
  const errs = HIT_ERROR_ACTIONS.reduce((sum, key) => sum + (c[key] || 0), 0);
  const hitAvg = hitAtt ? ((kills - errs) / hitAtt) : 0;
  const killPct = safePct(kills, hitAtt);

  return {
    serveAtt, serveAvg, servePressurePct, acePct,
    passAtt, passAvg,
    hitAtt, hitAvg, kills, killPct
  };
}

function serveAvgHeatStyle(serveAvg) {
  // 1.00 -> green, 4.00 -> red
  const min = 1.0;
  const max = 4.0;
  const v = Number.isFinite(serveAvg) ? serveAvg : 0;
  const t = Math.max(0, Math.min(1, (v - min) / (max - min)));

  const hue = 120 * (1 - t);
  const sat = 75;
  const light = 92 - (37 * t);

  const bg = `hsl(${hue.toFixed(0)} ${sat}% ${light.toFixed(0)}%)`;
  const fg = "#111827";
  return { bg, fg };
}

function renderTable() {
  const team = activeTeam();
  statsBody.innerHTML = "";
  if (!team) return;

  const players = [...(team.players || [])].sort(sortPlayers);
  for (const p of players) {
    const d = derived(p.id);
    const tr = document.createElement("tr");

    tr.appendChild(td(p.number || "—", "left sticky-col"));
    tr.appendChild(td(p.name, "left"));
    tr.appendChild(td(p.position || "—", "left"));

    tr.appendChild(td(String(d.serveAtt)));

    const sAvg = td(fmtNum(d.serveAvg, 2));
    const heat = serveAvgHeatStyle(d.serveAvg);
    sAvg.style.background = heat.bg;
    sAvg.style.color = heat.fg;
    sAvg.style.fontWeight = "900";
    tr.appendChild(sAvg);

    tr.appendChild(td(fmtPct(d.servePressurePct)));
    tr.appendChild(td(fmtPct(d.acePct)));

    tr.appendChild(td(String(d.passAtt)));
    tr.appendChild(td(fmtNum(d.passAvg, 2)));

    tr.appendChild(td(String(d.hitAtt)));
    tr.appendChild(td(fmtNum(d.hitAvg, 3)));
    tr.appendChild(td(String(d.kills)));
    tr.appendChild(td(fmtPct(d.killPct)));

    statsBody.appendChild(tr);
  }
}

function td(text, cls = "") {
  const el = document.createElement("td");
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
}

undoBtn?.addEventListener("click", () => {
  const team = activeTeam();
  if (!team) return;

  const last = team.history.pop();
  if (!last) return;

  const c = team.data?.[last.match]?.[last.set]?.[last.playerId];
  if (c && c[last.action] > 0) c[last.action] -= 1;

  saveState();
  renderTable();
  updateOnboardingAndControls();
});

exportBtn?.addEventListener("click", async () => {
  const team = activeTeam();
  if (!team || !team.players?.length) return;

  const header = [
    "Team","Jersey","Player","Pos",
    "ServeAtt","ServeAvg","ServePressure%","Ace%",
    "PassAtt","PassAvg",
    "HitAtt","HitAvg",
    "Kill%"
  ];

  const rows = [header.join(",")];
  const players = [...team.players].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  for (const p of players) {
    const d = derived(p.id);
    rows.push([
      csv(team.name),
      csv(p.number || ""),
      csv(p.name),
      csv(p.position || ""),
      d.serveAtt,
      d.serveAvg.toFixed(2),
      (d.servePressurePct * 100).toFixed(1),
      (d.acePct * 100).toFixed(1),
      d.passAtt,
      d.passAvg.toFixed(2),
      d.hitAtt,
      d.hitAvg.toFixed(3),
      (d.killPct * 100).toFixed(1)
    ].join(","));
  }

  const base = safeFile((exportName?.value || "").trim() || defaultExportBaseName());
  const filename = `${base}.csv`;

  const ok = await openExportConfirmModal({
    filename,
    teamName: team.name,
    viewLabel: getViewLabel(),
    scopeLabel: getExportContextLabel()
  });
  if (!ok) return;

  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
});

resetBtn?.addEventListener("click", () => {
  const ok = confirm("Reset ALL teams + stats on this device? This cannot be undone.");
  if (!ok) return;
  localStorage.removeItem(STORAGE_KEY);
  state = loadState();
  normalizeAllTeams(state);
  saveState();
  initTeamSelect();
  initMatchSelect();
  renderTable();
  if (exportName) exportName.dataset.userEdited = "";
  updateOnboardingAndControls();
});
