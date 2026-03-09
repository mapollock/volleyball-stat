/***********************
 * CONFIG
 ***********************/
const STORAGE_KEY = "volleystat_v003";

// Default matches
const DEFAULT_MATCHES = ["Match 1", "Match 2", "Match 3"];

// Default roster (editable in app)
const DEFAULT_PLAYERS = [
  { id: cryptoId(), name: "Caroline", number: "12", position: "OH" },
  { id: cryptoId(), name: "Aniya",    number: "7",  position: "S"  },
  { id: cryptoId(), name: "Maya",     number: "3",  position: "MB" },
];

// Passing rating weights
const PASS_WEIGHTS = {
  passToTarget: 3,
  passNearTarget: 2,
  passAwayTarget: 1,
  passShank: 0
};

// Hitting config
const HIT_ATTEMPT_ACTIONS = ["swing", "swingOut", "kill", "tip", "tipKill"];
const HIT_ERROR_ACTIONS = ["swingOut"];

/***********************
 * DATA MODEL
 * state.players: [{id,name,number,position}]
 * state.data[match][set][playerId] = counters
 ***********************/
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
    for (const s of ["1", "2", "3"]) {
      for (const p of players) {
        data[m][s][p.id] = emptyCounters();
      }
    }
  }
  return data;
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const st = JSON.parse(raw);
    // Safety: ensure structure
    st.matches ||= DEFAULT_MATCHES;
    st.players ||= DEFAULT_PLAYERS;
    st.data ||= buildEmptyData(st.players, st.matches);
    st.history ||= [];
    // Ensure counters exist for each player id (in case roster changed)
    normalizeData(st);
    return st;
  }

  const state = {
    matches: DEFAULT_MATCHES,
    players: DEFAULT_PLAYERS,
    data: buildEmptyData(DEFAULT_PLAYERS, DEFAULT_MATCHES),
    history: [] // undo stack
  };

  return state;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// Ensure state.data has keys for current roster
function normalizeData(st) {
  for (const m of st.matches) {
    st.data[m] ||= { "1": {}, "2": {}, "3": {} };
    for (const s of ["1","2","3"]) {
      st.data[m][s] ||= {};
      for (const p of st.players) {
        st.data[m][s][p.id] ||= emptyCounters();
      }
    }
  }
}

let state = loadState();

/***********************
 * DOM REFS
 ***********************/
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

let pendingAction = null;

/***********************
 * INIT
 ***********************/
initSelectors();
renderAll();

document.querySelectorAll("button[data-action]").forEach(btn => {
  btn.addEventListener("click", () => {
    pendingAction = btn.dataset.action;
    pickerTitle.textContent = `Select Player — ${prettyAction(pendingAction)}`;
    openPicker();
  });
});

[matchSelect, setSelect, viewSelect].forEach(sel => {
  sel.addEventListener("change", renderTable);
});

/***********************
 * SELECTORS
 ***********************/
function initSelectors() {
  matchSelect.innerHTML = "";
  for (const m of state.matches) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    matchSelect.appendChild(opt);
  }
  matchSelect.value = state.matches[0] || "Match 1";
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
  playerGrid.innerHTML = "";
  // Sort by jersey # if numeric, otherwise by name
  const players = [...state.players].sort((a,b) => {
    const an = parseInt(a.number,10), bn = parseInt(b.number,10);
    const aNum = Number.isFinite(an), bNum = Number.isFinite(bn);
    if (aNum && bNum) return an - bn;
    return a.name.localeCompare(b.name);
  });

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
 * ROSTER MODAL
 ***********************/
rosterBtn.addEventListener("click", () => {
  openRoster();
});

function openRoster() {
  clearRosterForm();
  renderRosterList();
  rosterBackdrop.classList.remove("hidden");
}
function closeRoster() {
  rosterBackdrop.classList.add("hidden");
  renderAll(); // refresh picker + table
}
rosterClose.addEventListener("click", closeRoster);
rosterDone.addEventListener("click", closeRoster);
rosterBackdrop.addEventListener("click", (e) => {
  if (e.target === rosterBackdrop) closeRoster();
});

newPlayerBtn.addEventListener("click", clearRosterForm);

playerForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const id = playerIdEl.value || cryptoId();
  const name = (playerNameEl.value || "").trim();
  const number = (playerNumberEl.value || "").trim();
  const position = (playerPosEl.value || "").trim();

  if (!name) return;

  const existingIndex = state.players.findIndex(p => p.id === id);
  if (existingIndex >= 0) {
    state.players[existingIndex] = { id, name, number, position };
  } else {
    state.players.push({ id, name, number, position });
    // Add counters for new player across all match/sets
    for (const m of state.matches) {
      for (const s of ["1","2","3"]) {
        state.data[m][s][id] = emptyCounters();
      }
    }
  }

  saveState();
  clearRosterForm();
  renderRosterList();
});

function clearRosterForm() {
  playerIdEl.value = "";
  playerNameEl.value = "";
  playerNumberEl.value = "";
  playerPosEl.value = "";
  playerNameEl.focus();
}

function renderRosterList() {
  rosterList.innerHTML = "";
  const players = [...state.players].sort((a,b) => {
    const an = parseInt(a.number,10), bn = parseInt(b.number,10);
    const aNum = Number.isFinite(an), bNum = Number.isFinite(bn);
    if (aNum && bNum) return an - bn;
    return a.name.localeCompare(b.name);
  });

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
    bottom.textContent = `Pos: ${p.position || "—"}  |  ID: ${p.id.slice(0,8)}`;
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
  const p = state.players.find(x => x.id === playerId);
  if (!p) return;

  const ok = confirm(`Remove ${p.name}? Stats for this player will also be removed.`);
  if (!ok) return;

  // Remove from roster
  state.players = state.players.filter(x => x.id !== playerId);

  // Remove counters from data
  for (const m of state.matches) {
    for (const s of ["1","2","3"]) {
      delete state.data[m][s][playerId];
    }
  }

  // Remove from undo history
  state.history = state.history.filter(h => h.playerId !== playerId);

  saveState();
  clearRosterForm();
  renderRosterList();
}



/***********************
 * RECORD EVENT
 ***********************/
function recordEvent(action, playerId) {
  const match = matchSelect.value;
  const set = setSelect.value;

  const counters = state.data[match][set][playerId];
  if (!counters || (counters[action] === undefined)) {
    alert("Unknown player/action. Try reopening roster.");
    return;
  }

  counters[action] += 1;

  state.history.push({
    match, set, playerId, action,
    ts: Date.now()
  });

  saveState();
  closePicker();
  renderTable();
}

/***********************
 * AGGREGATION
 ***********************/
function getAggregateCounters(playerId) {
  const view = viewSelect.value;
  const match = matchSelect.value;
  const set = setSelect.value;

  const agg = emptyCounters();

  function addFrom(matchName, setNum) {
    const c = state.data[matchName][setNum][playerId];
    if (!c) return;
    for (const k of Object.keys(agg)) agg[k] += c[k] || 0;
  }

  if (view === "set") {
    addFrom(match, set);
  } else if (view === "match") {
    for (const s of ["1","2","3"]) addFrom(match, s);
  } else {
    for (const m of state.matches) {
      for (const s of ["1","2","3"]) addFrom(m, s);
    }
  }
  return agg;
}

/***********************
 * DERIVED METRICS
 ***********************/
function safePct(n, d) {
  if (!d) return 0;
  return n / d;
}

function derived(playerId) {
  const c = getAggregateCounters(playerId);

  // Serve attempts per your requirement:
  // Serve Att = Ace + Serve In + Serve Out
  const serveAtt = c.ace + c.serveIn + c.serveOut;

  // Serve% counts "in" serves INCLUDING aces (since aces are successful serves)
  const serveMade = c.serveIn + c.ace;
  const servePct = safePct(serveMade, serveAtt);

  // Ace% is aces per total attempts
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
 * RENDER
 ***********************/
function renderAll() {
  normalizeData(state);
  saveState();
  renderTable();
}

function renderTable() {
  statsBody.innerHTML = "";

  // Sort like picker
  const players = [...state.players].sort((a,b) => {
    const an = parseInt(a.number,10), bn = parseInt(b.number,10);
    const aNum = Number.isFinite(an), bNum = Number.isFinite(bn);
    if (aNum && bNum) return an - bn;
    return a.name.localeCompare(b.name);
  });

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
  const last = state.history.pop();
  if (!last) return;

  const c = state.data[last.match]?.[last.set]?.[last.playerId];
  if (c && c[last.action] > 0) c[last.action] -= 1;

  saveState();
  renderTable();
});

exportBtn.addEventListener("click", () => {
  const header = ["Jersey","Player","Pos","ServeAtt","Serve%","Ace%","PassAtt","PassAvg","HitAtt","HitAvg","Kill%"];
  const rows = [header.join(",")];

  const players = [...state.players].sort((a,b) => (a.name||"").localeCompare(b.name||""));

  for (const p of players) {
    const d = derived(p.id);
    rows.push([
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
  a.download = `volleystat_${viewSelect.value}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

resetBtn.addEventListener("click", () => {
  const ok = confirm("Reset ALL stats + roster? This cannot be undone.");
  if (!ok) return;
  localStorage.removeItem(STORAGE_KEY);
  state = loadState();
  initSelectors();
  renderAll();
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

// Create stable-ish ID
function cryptoId(){
  // Works in modern browsers
  if (crypto?.randomUUID) return crypto.randomUUID();
  // Fallback
  return "id_" + Math.random().toString(16).slice(2) + Date.now().toString(16);

}

