// VolleyStat – clean functional core
const STORAGE_KEY = 'volleystat_core';

const state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {
  teams: [],
  activeTeamId: null
};

const $ = id => document.getElementById(id);

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return crypto.randomUUID();
}

function activeTeam() {
  return state.teams.find(t => t.id === state.activeTeamId);
}

/* ---------- INIT ---------- */
function init() {
  if (!state.teams.length) {
    createTeam('Default Team');
  }
  if (!state.activeTeamId) {
    state.activeTeamId = state.teams[0].id;
  }
  renderTeams();
  renderTable();
  save();
}

/* ---------- TEAMS ---------- */
function createTeam(name) {
  const team = {
    id: uid(),
    name,
    players: []
  };
  state.teams.push(team);
  state.activeTeamId = team.id;
}

function renderTeams() {
  const sel = $('teamSelect');
  sel.innerHTML = '';
  state.teams.forEach(t => {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.name;
    sel.appendChild(o);
  });
  sel.value = state.activeTeamId;
}

/* ---------- PLAYERS ---------- */
function addPlayer() {
  const name = $('playerName').value.trim();
  if (!name) return alert('Player name required');

  activeTeam().players.push({
    id: uid(),
    name,
    number: $('playerNumber').value,
    pos: $('playerPos').value
  });

  $('playerName').value = '';
  $('playerNumber').value = '';
  $('playerPos').value = '';

  renderTable();
  save();
}

function renderTable() {
  const body = $('statsBody');
  body.innerHTML = '';
  activeTeam().players.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p.number || ''}</td><td>${p.name}</td><td>${p.pos || ''}</td>`;
    body.appendChild(tr);
  });
}

/* ---------- EXPORT ---------- */
function exportCSV() {
  const rows = ['Number,Name,Pos'];
  activeTeam().players.forEach(p =>
    rows.push(`${p.number},${p.name},${p.pos}`)
  );
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'volley_stat.csv';
  a.click();
}

/* ---------- EVENTS ---------- */
$('addTeamBtn').onclick = () => {
  const name = prompt('Team name');
  if (!name) return;
  createTeam(name);
  renderTeams();
  renderTable();
  save();
};

$('teamSelect').onchange = e => {
  state.activeTeamId = e.target.value;
  renderTable();
  save();
};

$('addPlayerBtn').onclick = addPlayer;
$('exportBtn').onclick = exportCSV;
$('resetBtn').onclick = () => {
  if (confirm('Reset all data?')) {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }
};

init();
