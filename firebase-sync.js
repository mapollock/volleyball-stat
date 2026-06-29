/**
 * VolleyStat — Firebase Sync Module v4
 * Full authentication (Google + Email/Password) + sharing system
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import { getFirestore, doc, setDoc, getDoc, getDocs, deleteDoc,
         collection, onSnapshot, query, where }
  from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { getAuth, onAuthStateChanged, signOut,
         GoogleAuthProvider, signInWithPopup,
         createUserWithEmailAndPassword, signInWithEmailAndPassword }
  from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBrF9-6bi_hCLxPI75_jfXmhY7NusA1mDk",
  authDomain: "volleystat-5e650.firebaseapp.com",
  projectId: "volleystat-5e650",
  storageBucket: "volleystat-5e650.firebasestorage.app",
  messagingSenderId: "180076488843",
  appId: "1:180076488843:web:0eb2d012627523cdb54c8e"
};

// ── Init ──────────────────────────────────────────────────────────────────────
const fbApp = initializeApp(FIREBASE_CONFIG);
const auth  = getAuth(fbApp);
// Memory cache only — localStorage is the offline source of truth; avoids
// IndexedDB persistence conflicts when multiple tabs/versions are open.
const db = getFirestore(fbApp);

export function getDb() { return db; }

// ── Current user ──────────────────────────────────────────────────────────────
let currentUser = null;

function userDataRef() {
  if (!currentUser) throw new Error('Not authenticated');
  return doc(db, 'users', currentUser.uid, 'data', 'state');
}
function userSessionsCol() {
  if (!currentUser) throw new Error('Not authenticated');
  return collection(db, 'users', currentUser.uid, 'sessions');
}

function dataAccessRef(coachUserId, readerUserId) {
  return doc(db, 'data_access', coachUserId + '_' + readerUserId);
}

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

const SUPER_ADMIN_EMAIL = 'alan.pollock@gmail.com';

// Must match Firestore isAdmin() — verified email only.
export function isSuperAdmin(user) {
  const u = user || currentUser;
  if (!u) return false;
  return normalizeEmail(u.email) === normalizeEmail(SUPER_ADMIN_EMAIL) && u.emailVerified === true;
}

// Claim read access to a coach's data via a share link (validated by Firestore rules)
export async function claimShareAccess(token) {
  if (!currentUser) throw new Error('Not authenticated');
  const shareSnap = await getDoc(doc(db, 'shares', token));
  if (!shareSnap.exists()) throw new Error('Share not found or revoked');
  const share = shareSnap.data();
  const coachUserId = share.userId;
  if (coachUserId === currentUser.uid) return;

  const accessRef = dataAccessRef(coachUserId, currentUser.uid);
  const existing = await getDoc(accessRef);
  if (existing.exists()) return;

  await setDoc(accessRef, {
    coachUserId,
    readerUserId: currentUser.uid,
    readerEmail: currentUser.email || '',
    shareToken: token,
    via: 'share',
    grantedAt: Date.now()
  });
}

// Claim read access via an email invite (admin or coach email_grants)
export async function ensureCoachDataAccess(coachUserId) {
  if (!currentUser) throw new Error('Not authenticated');
  if (coachUserId === currentUser.uid) return;
  if (isSuperAdmin()) return;

  const accessRef = dataAccessRef(coachUserId, currentUser.uid);
  const existing = await getDoc(accessRef);
  if (existing.exists()) return;

  const email = normalizeEmail(currentUser.email);
  if (!email) throw new Error('Your account has no email address for access verification.');

  const grantsSnap = await getDocs(query(
    collection(db, 'users', coachUserId, 'email_grants'),
    where('readerEmail', '==', email)
  ));
  if (grantsSnap.empty) {
    throw new Error('You do not have access to this session. Ask the coach or an admin to grant access.');
  }

  const grantDoc = grantsSnap.docs[0];
  await setDoc(accessRef, {
    coachUserId,
    readerUserId: currentUser.uid,
    readerEmail: currentUser.email || '',
    grantId: grantDoc.id,
    via: 'admin',
    grantedAt: Date.now()
  });
}

// ── Status ────────────────────────────────────────────────────────────────────
function setSyncStatus(status) {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  const map = {
    synced:  { text: '✓ Synced',              color: '#16a34a' },
    saving:  { text: '↑ Saving…',             color: '#93c5fd' },
    local:   { text: '⚡ Saved locally',      color: '#d97706' },
    offline: { text: '⚡ Offline',            color: '#d97706' },
    pending: { text: '↑ Sync pending…',       color: '#fbbf24' },
    error:   { text: '⚠ Sync error',          color: '#dc2626' },
    nodb:    { text: '⚠ No database',         color: '#f97316' },
    auth:    { text: '🔒 Signing in…',       color: '#93c5fd' }
  };
  const s = map[status] || { text: status, color: '#93c5fd' };
  el.textContent = s.text;
  el.style.color  = s.color;
}

// ── Auth state ────────────────────────────────────────────────────────────────
export function onAuthReady(callback) {
  return onAuthStateChanged(auth, function(user) {
    currentUser = user;
    callback(user);
  });
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
}

export async function signInWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function createAccount(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

export async function signOutUser() {
  await signOut(auth);
}

export function getCurrentUser() { return currentUser; }

// ── Save ──────────────────────────────────────────────────────────────────────
let saveTimer = null;
let lastSaved = null;
let pendingState = null;
const SAVE_DEBOUNCE_MS = 800;

async function writeState(stateObj) {
  var json = JSON.stringify(stateObj);
  if (json.length > 1000000) {
    console.warn('[VolleyStat] State is', Math.round(json.length / 1024), 'KB — trimming before cloud save');
    setSyncStatus('error');
    throw new Error('Session data is too large to sync (' + Math.round(json.length / 1024) + ' KB). Export CSV and Reset, or archive and start fresh.');
  }
  await setDoc(userDataRef(), {
    data: json,
    updatedAt: Date.now()
  }, { merge: true });
  lastSaved = Date.now();
  setSyncStatus('synced');
  const team = stateObj && stateObj.teams && stateObj.teams.length
    ? (stateObj.teams.find(function(t){ return t.id === stateObj.activeTeamId; }) || stateObj.teams[0])
    : null;
  if (team && team.name) registerSession(team.name);
}

export async function flushFirebaseSave() {
  if (!currentUser || !pendingState) return;
  clearTimeout(saveTimer);
  setSyncStatus('saving');
  try {
    await writeState(pendingState);
    pendingState = null;
  } catch(e) {
    console.error('[VolleyStat] Flush save error:', e);
    if (e.message && e.message.indexOf('too large') >= 0) {
      setSyncStatus('error');
    } else if (!navigator.onLine) setSyncStatus('local');
    else setSyncStatus('error');
  }
}

export function firebaseSave(stateObj) {
  if (!currentUser) return;
  pendingState = stateObj;
  clearTimeout(saveTimer);
  if (navigator.onLine) setSyncStatus('saving');
  else setSyncStatus('local');
  saveTimer = setTimeout(async function() {
    try {
      await writeState(stateObj);
      pendingState = null;
    } catch(e) {
      console.error('[VolleyStat] Save error:', e);
      if (e.message && e.message.indexOf('too large') >= 0) {
        setSyncStatus('error');
      } else if (!navigator.onLine) setSyncStatus('local');
      else setSyncStatus('error');
    }
  }, SAVE_DEBOUNCE_MS);
}

// ── Load ──────────────────────────────────────────────────────────────────────
export async function firebaseLoad() {
  if (!currentUser) return null;
  try {
    const snap = await getDoc(userDataRef());
    if (snap.exists()) {
      const raw = snap.data().data;
      if (raw) { setSyncStatus('synced'); return JSON.parse(raw); }
    }
    setSyncStatus('synced');
  } catch(e) {
    console.warn('[VolleyStat] Load error:', e);
    if (!navigator.onLine) setSyncStatus('offline');
    else setSyncStatus('error');
  }
  return null;
}

// ── Listen ────────────────────────────────────────────────────────────────────
let unsubscribe = null;
export function firebaseListen(onUpdate) {
  if (!currentUser) return;
  if (unsubscribe) unsubscribe();
  unsubscribe = onSnapshot(userDataRef(),
    function(snap) {
      if (!snap.exists()) return;
      const remote = snap.data();
      if (!remote || !remote.data) return;
      if (lastSaved && (Date.now() - lastSaved) < 3000) return;
      try { onUpdate(JSON.parse(remote.data)); setSyncStatus('synced'); } catch(e) {}
    },
    function(err) {
      console.warn('[VolleyStat] Listen error:', err);
      if (!navigator.onLine) { setSyncStatus('offline'); return; }
      // Permissions error usually means auth token not yet ready — retry once after 2s
      if (err.code === 'permission-denied' && currentUser) {
        setTimeout(function() { firebaseListen(onUpdate); }, 2000);
        return;
      }
      setSyncStatus('error');
    }
  );
  return unsubscribe;
}

// ── Session registry ──────────────────────────────────────────────────────────
let lastRegisteredTeam = '';
export async function registerSession(teamName) {
  if (!currentUser) return;
  const name = (teamName || 'Unknown Team').trim();
  if (name === lastRegisteredTeam) return;
  lastRegisteredTeam = name;
  const now = new Date();
  const date = now.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  const time = now.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', hour12:true });
  const sessionData = {
    userId: currentUser.uid,
    userEmail: currentUser.email || '',
    teamName: name,
    date, time,
    ts: now.getTime(),
    label: name + ' · ' + date + ' · ' + time
  };
  try {
    // Write to shared collection so all users can discover each other's sessions
    await setDoc(doc(db, 'volleystat_sessions', currentUser.uid), sessionData, { merge: true });
    // Also write to private user collection for own reference
    await setDoc(doc(userSessionsCol(), 'current'), sessionData, { merge: true });
  } catch(e) { console.warn('[VolleyStat] Session register failed:', e.message); }
}

export async function listSessions() {
  if (!currentUser) return [];
  try {
    const snap = await getDocs(collection(db, 'volleystat_sessions'));
    const sessions = [];
    snap.forEach(function(d) {
      const s = d.data();
      if (!s.userId) s.userId = d.id;
      sessions.push(s);
    });
    sessions.sort(function(a,b){ return (b.ts||0)-(a.ts||0); });
    return sessions;
  } catch(e) {
    if (isSuperAdmin()) {
      console.warn('[VolleyStat] listSessions error (super-admin):', e.message);
    } else {
      console.warn('[VolleyStat] listSessions error:', e.message);
    }
    return [];
  }
}

// ── Sharing ───────────────────────────────────────────────────────────────────
function generateToken() {
  return Math.random().toString(36).slice(2,8) + Math.random().toString(36).slice(2,8);
}

export async function createShare(opts) {
  // opts: { type:'team'|'player', playerId?, playerName?, scope:'all'|'day'|'match'|'set', day?, match?, set?, teamName }
  if (!currentUser) throw new Error('Not authenticated');
  const token = generateToken();
  const shareData = {
    token,
    userId: currentUser.uid,
    userEmail: currentUser.email,
    type: opts.type || 'team',
    playerId: opts.playerId || null,
    playerName: opts.playerName || null,
    scope: opts.scope || 'all',
    day: opts.day || null,
    match: opts.match || null,
    set: opts.set || null,
    teamName: opts.teamName || '',
    createdAt: Date.now()
  };
  await setDoc(doc(db, 'shares', token), shareData);
  // Session registry for sync UI (read access is granted separately via share claim)
  await setDoc(doc(db, 'volleystat_sessions', currentUser.uid), {
    userId: currentUser.uid,
    userEmail: currentUser.email || '',
    teamName: opts.teamName || 'VolleyStat',
    ts: Date.now(),
    label: (opts.teamName || 'VolleyStat') + ' · share active'
  }, { merge: true });
  return token;
}

export async function listShares() {
  if (!currentUser) return [];
  try {
    const q = query(collection(db, 'shares'), where('userId', '==', currentUser.uid));
    const snap = await getDocs(q);
    const shares = [];
    snap.forEach(function(d) { shares.push(d.data()); });
    shares.sort(function(a,b){ return (b.createdAt||0)-(a.createdAt||0); });
    return shares;
  } catch(e) { return []; }
}

export async function revokeShare(token) {
  await deleteDoc(doc(db, 'shares', token));
}



export async function loadSharedData(token) {
  const shareSnap = await getDoc(doc(db, 'shares', token));
  if (!shareSnap.exists()) throw new Error('Share not found or revoked');
  const share = shareSnap.data();
  await claimShareAccess(token);
  const dataSnap = await getDoc(doc(db, 'users', share.userId, 'data', 'state'));
  if (!dataSnap.exists()) throw new Error('No data found');
  const state = JSON.parse(dataSnap.data().data);
  return { share, state };
}

// Fork a shared session into the recipient's own account
// Returns the forked state — recipient now owns an independent copy
export async function forkSharedSession(token) {
  if (!currentUser) throw new Error('Not authenticated');

  // Load the share metadata and source data
  const shareSnap = await getDoc(doc(db, 'shares', token));
  if (!shareSnap.exists()) throw new Error('Share link not found or has been revoked');
  const share = shareSnap.data();

  await claimShareAccess(token);

  // Load source data from coach's account
  const dataSnap = await getDoc(doc(db, 'users', share.userId, 'data', 'state'));
  if (!dataSnap.exists()) throw new Error('No data found in shared session');
  const raw = dataSnap.data().data;
  const state = JSON.parse(raw);

  // Save a copy into the recipient's own account
  await setDoc(doc(db, 'users', currentUser.uid, 'data', 'state'), {
    data: raw,
    updatedAt: Date.now(),
    forkedFrom: share.userId,
    forkedAt: Date.now()
  }, { merge: false }); // overwrite — this becomes their session

  // Register as recipient's session
  const team = state && state.teams && state.teams.length
    ? (state.teams.find(function(t){ return t.id === state.activeTeamId; }) || state.teams[0])
    : null;
  if (team && team.name) await registerSession(team.name + ' (shared)');

  return state;
}

// Load data from another user's session
export async function firebaseLoadFrom(targetUserId) {
  try {
    await ensureCoachDataAccess(targetUserId);
    const targetRef = doc(db, 'users', targetUserId, 'data', 'state');
    const snap = await getDoc(targetRef);
    if (snap.exists()) {
      const raw = snap.data().data;
      if (raw) return JSON.parse(raw);
    }
  } catch(e) {
    console.warn('[VolleyStat] firebaseLoadFrom error:', e.message);
    throw e;
  }
  return null;
}

// Listen to another user's data (read-only view of their session)
let unsubscribeOther = null;
export async function firebaseListenTo(targetUserId, onUpdate) {
  await ensureCoachDataAccess(targetUserId);
  if (unsubscribeOther) unsubscribeOther();
  const targetRef = doc(db, 'users', targetUserId, 'data', 'state');
  unsubscribeOther = onSnapshot(targetRef,
    function(snap) {
      if (!snap.exists()) return;
      try { onUpdate(JSON.parse(snap.data().data)); } catch(e) {}
    },
    function(err) { console.warn('[VolleyStat] ListenTo error:', err.message); }
  );
  return unsubscribeOther;
}

window.addEventListener('online', function() {
  if (pendingState && currentUser) {
    setSyncStatus('pending');
    flushFirebaseSave();
  } else {
    setSyncStatus('synced');
  }
});
window.addEventListener('offline', function() {
  setSyncStatus(pendingState ? 'local' : 'offline');
});
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'hidden') flushFirebaseSave();
});



// Archive current session before reset — saves a timestamped snapshot
export async function archiveSession(stateObj, label) {
  if (!currentUser) return;
  const ts = Date.now();
  const archiveId = String(ts);
  const finalLabel = label || ('Archive ' + new Date(ts).toLocaleString());

  // Save full snapshot to user's archives subcollection
  const archiveRef = doc(db, 'users', currentUser.uid, 'archives', archiveId);
  await setDoc(archiveRef, {
    data: JSON.stringify(stateObj),
    label: finalLabel,
    archivedAt: ts
  });

  // Also register in volleystat_sessions so it appears in the sync dropdown
  const sessionId = currentUser.uid + '_archive_' + archiveId;
  await setDoc(doc(db, 'volleystat_sessions', sessionId), {
    userId: currentUser.uid,
    userEmail: currentUser.email || '',
    teamName: finalLabel,
    label: '📦 ' + finalLabel,
    ts: ts,
    type: 'archive',
    archiveId: archiveId
  });

  return archiveId;
}

export async function loadArchive(userId, archiveId) {
  await ensureCoachDataAccess(userId);
  const archiveRef = doc(db, 'users', userId, 'archives', archiveId);
  const snap = await getDoc(archiveRef);
  if (!snap.exists()) throw new Error('Archive not found');
  const raw = snap.data().data;
  if (!raw) throw new Error('Archive is empty');
  return JSON.parse(raw);
}


// Delete a session entry from volleystat_sessions
export async function deleteSession(sessionDocId) {
  await deleteDoc(doc(db, 'volleystat_sessions', sessionDocId));
}

// Delete an archive snapshot
export async function deleteArchive(userId, archiveId) {
  await deleteDoc(doc(db, 'users', userId, 'archives', archiveId));
  // Also remove from sessions list
  const sessionId = userId + '_archive_' + archiveId;
  try { await deleteDoc(doc(db, 'volleystat_sessions', sessionId)); } catch(e) {}
}

// ── Super-admin: load ALL sessions across all users ──────────────────────────
export async function adminLoadAllSessions() {
  if (!isSuperAdmin()) throw new Error('Super-admin access required');
  const colRef = collection(db, 'volleystat_sessions');
  const snap = await getDocs(colRef);
  return snap.docs.map(function(d) {
    return Object.assign({ _docId: d.id }, d.data());
  }).sort(function(a, b) { return (b.ts || 0) - (a.ts || 0); });
}

// ── Super-admin: load state for any user ─────────────────────────────────────
export async function adminLoadUserState(userId) {
  if (!isSuperAdmin()) throw new Error('Super-admin access required');
  const ref = doc(db, 'users', userId, 'data', 'state');
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('No state found for user ' + userId);
  const raw = snap.data().data;
  if (!raw) throw new Error('State is empty');
  return JSON.parse(raw);
}

// ── Super-admin: write state to any user ─────────────────────────────────────
export async function adminWriteUserState(userId, stateObj) {
  if (!isSuperAdmin()) throw new Error('Super-admin access required');
  const ref = doc(db, 'users', userId, 'data', 'state');
  await setDoc(ref, { data: JSON.stringify(stateObj), updatedAt: Date.now() }, { merge: true });
}

// ── Super-admin: grant a user access to a specific session ───────────────────
export async function adminGrantSessionAccess(targetEmail, sessionDocId) {
  if (!isSuperAdmin()) throw new Error('Super-admin access required');
  const adminGrantId = 'grant_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  await setDoc(doc(db, 'admin_grants', adminGrantId), {
    targetEmail: targetEmail,
    sessionDocId: sessionDocId,
    grantedBy: currentUser ? currentUser.email : 'admin',
    grantedAt: Date.now()
  });
  const sessionSnap = await getDoc(doc(db, 'volleystat_sessions', sessionDocId));
  if (!sessionSnap.exists()) throw new Error('Session not found');
  const sessionData = sessionSnap.data();
  const coachUserId = sessionData.userId || sessionDocId.split('_archive_')[0];
  const normalizedEmail = normalizeEmail(targetEmail);
  if (!normalizedEmail) throw new Error('Invalid email address');

  const emailGrantId = 'grant_' + Date.now();
  await setDoc(doc(db, 'users', coachUserId, 'email_grants', emailGrantId), {
    readerEmail: normalizedEmail,
    grantedAt: Date.now(),
    grantedBy: currentUser ? currentUser.email : 'admin',
    via: 'admin'
  });

  const sharedId = 'shared_' + sessionDocId + '_to_' + normalizedEmail.replace(/[@.]/g, '_');
  await setDoc(doc(db, 'volleystat_sessions', sharedId), Object.assign({}, sessionData, {
    sharedWith: normalizedEmail,
    sharedBy: currentUser ? currentUser.email : 'admin',
    label: '🔗 ' + (sessionData.label || sessionData.teamName || sessionDocId)
  }));
  return adminGrantId;
}
