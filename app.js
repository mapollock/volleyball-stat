/**
 * VolleyStat v0.0.6
 * - Starts with NO default team and NO default players
 * - Onboarding prompt: Add a team → Add a roster
 * - Serve Attempts = Ace + Serve In + Serve Out
 * - Kills column = (Kill + Tip Kill)
 * - Kill% is based on (Kill + Tip Kill) / Hit Attempts
 * - CSV export excludes the Kills column (per request)
 * - Custom confirmation modal before exporting CSV
 */

const STORAGE_KEY = "volleystat_v006";
const DEFAULT_MATCHES = ["Match 1", "Match 2", "Match 3"];

const PASS_WEIGHTS = {
  passToTarget: 3,
  passNearTarget: 2,
  passAwayTarget: 1,
  passShank: 0
};

const HIT_ATTEMPT_ACTIONS = ["swing", "swingOut", "kill", "tip", "tipKill"];
const HIT_ERROR_ACTIONS = ["swingOut"];

/* ------------------ Helpers ------------------ */
function cryptoId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return "id_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function emptyCounters() {
  return {
    serveIn: 0, serveOut: 0, ace: 0,
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
    serveIn: "Serve In", serveOut: "Serve Out", ace: "Ace",
    passToTarget: "Pass: To Target", passNearTarget: "Pass: Near Target",
    passAwayTarget: "Pass: Away", passShank: "Pass: Shank",
    swing: "Swing", swingOut: "Swing Out", kill: "Kill", tip: "Tip", tipKill: "Tip Kill"
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
  return {
    id: cryptoId(),
    name,
    matches,
    players,
    data: buildEmptyData(players, matches),
    history: []
  };
}

/* ------------------ Export name helpers ------------------ */
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
  const ctx = getExportContextLabel();
  return `${safeFile(teamName)}_${safeFile(ctx)}`;
}

function syncExportNameDefault() {
  if (!exportName) return;
  if (!exportName.dataset.userEdited) {
    exportName.value = defaultExportBaseName();
  }
}

/* ------------------ State ------------------ */
let state = loadState();
normalizeAllTeams(state);
saveState();

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch { /* fallthrough */ }
  }

  // Optional migration: if older versions exist, keep them.
  const oldRaw = localStorage.getItem("volleystat_v005") || localStorage.getItem("volleystat_v003");
  if (oldRaw) {
    try {
      const old = JSON.parse(oldRaw);
      if (old?.teams && Array.isArray(old.teams)) {
        return old;
      }
      if (old?.players || old?.matches || old?.data) {
        // v003 single-team format
        const team = {
          id: cryptoId(),
          name: "My Team",
          matches: Array.isArray(old.matches) && old.matches.length ? old.matches : [...DEFAULT_MATCHES],
          players: Array.isArray(old.players) ? old.players : [],
          data: old.data || buildEmptyData(Array.isArray(old.players) ? old.players : [], Array.isArray(old.matches) && old.matches.length ? old.matches : DEFAULT_MATCHES),
          history: Array.isArray(old.history) ? old.history : []
        };
        return { activeTeamId: team.id, teams: [team] };
      }
    } catch {
      // ignore
    }
  }

  // NEW behavior: start with NO teams
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
  if (!team) return;
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
        if (!team.data[m][s][p.id]) team.data[m][s][p.id] = emptyCounters();
      }
    }
  }
}

function normalizeAllTeams(st) {
  st ||= { activeTeamId: null, teams: [] };
  if (!Array.isArray(st.teams)) st.teams = [];

  for (const t of st.teams) normalizeTeam(t);

  if (st.teams.length) {
    if (!st.activeTeamId || !st.teams.some(t => t.id === st.activeTeamId)) {
      st.activeTeamId = st.teams[0].id;
    }
  } else {
    st.activeTeamId = null;
  }
}

/* ------------------ DOM Refs ------------------ */
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

(function domSanityCheck() {
  const required = [
    [teamSelect, "teamSelect"], [teamsBtn, "teamsBtn"], [matchSelect, "matchSelect"], [setSelect, "setSelect"],
    [viewSelect, "viewSelect"], [statsBody, "statsBody"], [exportBtn, "exportBtn"],
    [pickerBackdrop, "pickerBackdrop"], [playerGrid, "playerGrid"],
    [rosterBackdrop, "rosterBackdrop"], [teamsBackdrop, "teamsBackdrop"],
    [importTeamBtn, "importTeamBtn"], [importTeamInput, "importTeamInput"],
    [exportConfirmBackdrop, "exportConfirmBackdrop"], [exportConfirmOk, "exportConfirmOk"],
    [onboarding, "onboarding"], [onboardingTeamsBtn, "onboardingTeamsBtn"], [onboardingRosterBtn, "onboardingRosterBtn"]
  ];
  const missing = required.filter(([el]) => !el).map(([, id]) => id);
  if (missing.length) console.error("VolleyStat: missing required DOM elements:", missing);
})();

/* ------------------ UI Enable/Disable + Onboarding ------------------ */
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
  const hasRoster = !!(team && Array.isArray(team.players) && team.players.length);

  // Onboarding visibility + messaging
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

  // Controls
  setDisabled(teamSelect, !hasTeam);
  setDisabled(matchSelect, !hasTeam);
  setDisabled(setSelect, !hasTeam);
  setDisabled(viewSelect, !hasTeam);

  setDisabled(rosterBtn, !hasTeam);
  setDisabled(undoBtn, !hasRoster);
  setDisabled(exportBtn, !hasRoster);
  setDisabled(exportName, !hasTeam);

  setToolbarStatsEnabled(hasRoster);

  // Export name default if possible
  if (hasTeam) syncExportNameDefault();
}

/* ------------------ Export Confirm Modal ------------------ */
let _exportConfirmResolve = null;
let _exportConfirmLastFocus = null;

function isExportConfirmOpen() {
  return exportConfirmBackdrop && !exportConfirmBackdrop.classList.contains("hidden");
}

function openExportConfirmModal({ filename, teamName, viewLabel, scopeLabel }) {
  return new Promise((resolve) => {
    if (!exportConfirmBackdrop) return resolve(true); // fallback

    if (_exportConfirmResolve) {
      try { _exportConfirmResolve(false); } catch {}
      _exportConfirmResolve = null;
    }

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

/* ------------------ Init ------------------ */
initTeamSelect();
initMatchSelect();
renderTable();
updateOnboardingAndControls();

// Onboarding buttons
onboardingTeamsBtn?.addEventListener("click", () => openTeams());
onboardingRosterBtn?.addEventListener("click", () => openRoster());

// Export confirm modal wiring
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

// Track user edits to export name
exportName?.addEventListener("input", () => {
  exportName.dataset.userEdited = exportName.value.trim() ? "1" : "";
  if (!exportName.dataset.userEdited) syncExportNameDefault();
});

// Import button opens file picker
importTeamBtn?.addEventListener("click", () => importTeamInput?.click());

// Toolbar stat buttons open picker modal
document.querySelectorAll("button[data-action]").forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    pendingAction = btn.dataset.action;
    pickerTitle.textContent = `Select Player — ${prettyAction(pendingAction)}`;
    openPicker();
  });
});

// selectors update
[matchSelect, setSelect, viewSelect].forEach(sel =>
  sel?.addEventListener("change", () => {
    renderTable();
    syncExportNameDefault();
  })
);

// team selection
teamSelect?.addEventListener("change", () => {
  state.activeTeamId = teamSelect.value;
  saveState();
  initMatchSelect();
  renderTable();
  exportName && (exportName.dataset.userEdited = "");
  updateOnboardingAndControls();
});

/* ------------------ Selectors ------------------ */
function initTeamSelect() {
  if (!teamSelect) return;

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
  state.activeTeamId = active?.id || state.teams[0].id;
  teamSelect.value = state.activeTeamId;
}

function initMatchSelect() {
  if (!matchSelect) return;
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

/* ------------------ Picker Modal ------------------ */
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

    const topText = `${p.number ? "#" + p.number + " " : ""}${p.name}`;
    btn.appendChild(document.createTextNode(topText));

    const sub = document.createElement("span");
    sub.className = "player-sub";
    sub.textContent = p.position ? `Pos: ${p.position}` : "Pos: —";
    btn.appendChild(sub);

    btn.addEventListener("click", () => recordEvent(pendingAction, p.id));
    playerGrid.appendChild(btn);
  }
}

/* ------------------ Roster Modal ------------------ */
rosterBtn?.addEventListener("click", openRoster);

function openRoster() {
  const team = activeTeam();
  if (!team) return;
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

  const existingIdx = team.players.findIndex(p => p.id === id);
  const player = { id, name, number, position };

  if (existingIdx >= 0) {
    team.players[existingIdx] = player;
  } else {
    team.players.push(player);
    for (const m of team.matches) {
      for (const s of ["1", "2", "3"]) {
        ensureCounters(team, m, s, id);
      }
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
  clearRosterForm();
  renderRosterList();
  renderTable();
  updateOnboardingAndControls();
}

/* ------------------ Teams Modal ------------------ */
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

// Export active team JSON
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

/* ------------------ Record + Derived + Render ------------------ */
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

  if (view === "set") {
    addFrom(match, set);
  } else if (view === "match") {
    ["1", "2", "3"].forEach(s => addFrom(match, s));
  } else {
    team.matches.forEach(m => ["1", "2", "3"].forEach(s => addFrom(m, s)));
  }

  return agg;
}

function derived(playerId) {
  const c = getAggregateCounters(playerId);

  const serveAtt = c.ace + c.serveIn + c.serveOut;
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
  const kills = (c.kill || 0) + (c.tipKill || 0);
  const errs = HIT_ERROR_ACTIONS.reduce((sum, key) => sum + (c[key] || 0), 0);
  const hitAvg = hitAtt ? ((kills - errs) / hitAtt) : 0;
  const killPct = safePct(kills, hitAtt);

  return { serveAtt, servePct, acePct, passAtt, passAvg, hitAtt, hitAvg, kills, killPct };
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
    tr.appendChild(td(fmtPct(d.servePct)));
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

/* ------------------ Controls ------------------ */
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
    "Team", "Jersey", "Player", "Pos",
    "ServeAtt", "Serve%", "Ace%",
    "PassAtt", "PassAvg",
    "HitAtt", "HitAvg",
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
      (d.servePct * 100).toFixed(1),
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

  const scope = getExportContextLabel();
  const viewLbl = getViewLabel();
  const ok = await openExportConfirmModal({
    filename,
    teamName: team.name,
    viewLabel: viewLbl,
    scopeLabel: scope
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
  localStorage.removeItem("volleystat_v005");
  localStorage.removeItem("volleystat_v003");

  state = loadState();
  normalizeAllTeams(state);
  saveState();

  initTeamSelect();
  initMatchSelect();
  renderTable();

  if (exportName) exportName.dataset.userEdited = "";
  updateOnboardingAndControls();
});
