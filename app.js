// VolleyStat – functional rebuild
const STORAGE_KEY = 'volleystat_v1';

const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{"teams":[],"activeTeamId":null}');

const el = id => document.getElementById(id);

function save(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function uid(){ return crypto.randomUUID(); }

function activeTeam(){ return state.teams.find(t=>t.id===state.activeTeamId); }

function init(){
  if(!state.teams.length){ createTeam('Default Team'); }
  if(!state.activeTeamId){ state.activeTeamId = state.teams[0].id; }
  save();
  initTeamSelect();
  initMatchSelect();
  renderTable();
}

function createTeam(name){
  const t = { id: uid(), name, matches:['Match 1'], players:[], data:{}, history:[] };
  state.teams.push(t);
  state.activeTeamId = t.id;
}

function initTeamSelect(){
  const sel = el('teamSelect'); sel.innerHTML='';
  state.teams.forEach(t=>{
    const o=document.createElement('option'); o.value=t.id; o.textContent=t.name; sel.appendChild(o);
  });
  sel.value = state.activeTeamId;
}

function initMatchSelect(){
  const sel = el('matchSelect'); sel.innerHTML='';
  const t = activeTeam();
  t.matches.forEach(m=>{ const o=document.createElement('option'); o.value=m; o.textContent=m; sel.appendChild(o); });
}

function renderTable(){
  const body = el('statsBody'); body.innerHTML='';
  const t = activeTeam();
  t.players.forEach(p=>{
    const tr=document.createElement('tr');
    tr.innerHTML = `<td>${p.number||''}</td><td>${p.name}</td><td>${p.pos||''}</td>` + '<td>0</td>'.repeat(11);
    body.appendChild(tr);
  });
}

// Teams modal
el('teamsBtn').onclick=()=>el('teamsBackdrop').classList.remove('hidden');
el('teamsDone').onclick=()=>el('teamsBackdrop').classList.add('hidden');
el('teamForm').onsubmit=e=>{
  e.preventDefault();
  createTeam(el('teamName').value);
  el('teamName').value='';
  initTeamSelect(); save();
};

// Roster modal
el('rosterBtn').onclick=()=>el('rosterBackdrop').classList.remove('hidden');
el('rosterDone').onclick=()=>el('rosterBackdrop').classList.add('hidden');
el('playerForm').onsubmit=e=>{
  e.preventDefault();
  const t=activeTeam();
  t.players.push({ id:uid(), name:el('playerName').value, number:el('playerNumber').value, pos:el('playerPos').value });
  el('playerName').value=''; el('playerNumber').value=''; el('playerPos').value='';
  save(); renderTable();
};

// Export
el('exportBtn').onclick=()=>{
  const rows=['Player,Number,Position'];
  activeTeam().players.forEach(p=>rows.push(`${p.name},${p.number},${p.pos}`));
  const blob=new Blob([rows.join('
')],{type:'text/csv'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='volley.csv'; a.click();
};

init();
