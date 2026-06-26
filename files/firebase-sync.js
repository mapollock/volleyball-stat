/**
 * VolleyStat — Firebase Sync Module v4
 * Full authentication (Google + Email/Password) + sharing system
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, doc, setDoc, getDoc, getDocs, deleteDoc,
         collection, onSnapshot, initializeFirestore,
         persistentLocalCache, persistentMultipleTabManager }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth, onAuthStateChanged, signOut,
         GoogleAuthProvider, signInWithPopup,
         createUserWithEmailAndPassword, signInWithEmailAndPassword }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

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
let db;
try {
  db = initializeFirestore(fbApp, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch(e) { db = getFirestore(fbApp); }

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

// ── Status ────────────────────────────────────────────────────────────────────
function setSyncStatus(status) {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  const map = {
    synced:  { text: '✓ Synced',     color: '#16a34a' },
    saving:  { text: '↑ Saving...',  color: '#93c5fd' },
    offline: { text: '⚡ Offline',   color: '#d97706' },
    error:   { text: '⚠ Sync error', color: '#dc2626' },
    nodb:    { text: '⚠ No database',color: '#f97316' },
    auth:    { text: '🔒 Signing in…',color: '#93c5fd' }
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

export function firebaseSave(stateObj) {
  if (!currentUser) return;
  clearTimeout(saveTimer);
  setSyncStatus('saving');
  saveTimer = setTimeout(async function() {
    try {
      await setDoc(userDataRef(), {
        data: JSON.stringify(stateObj),
        updatedAt: Date.now()
      }, { merge: true });
      lastSaved = Date.now();
      setSyncStatus('synced');
      // Register session
      const team = stateObj && stateObj.teams && stateObj.teams.length
        ? (stateObj.teams.find(function(t){ return t.id === stateObj.activeTeamId; }) || stateObj.teams[0])
        : null;
      if (team && team.name) registerSession(team.name);
    } catch(e) {
      console.error('[VolleyStat] Save error:', e);
      if (!navigator.onLine) setSyncStatus('offline');
      else setSyncStatus('error');
    }
  }, 1500);
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
      if (!navigator.onLine) setSyncStatus('offline');
      else setSyncStatus('error');
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
    // Read from shared collection — all users' sessions visible here
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
    console.warn('[VolleyStat] listSessions error:', e.message);
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
  return token;
}

export async function listShares() {
  if (!currentUser) return [];
  try {
    const snap = await getDocs(collection(db, 'shares'));
    const shares = [];
    snap.forEach(function(d) {
      const s = d.data();
      if (s.userId === currentUser.uid) shares.push(s);
    });
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
    // Try user-based path first
    const targetRef = doc(db, 'users', targetUserId, 'data', 'state');
    const snap = await getDoc(targetRef);
    if (snap.exists()) {
      const raw = snap.data().data;
      if (raw) return JSON.parse(raw);
    }
    // Fall back to legacy device path
    const legacyRef = doc(db, 'volleystat_data', targetUserId);
    const legacySnap = await getDoc(legacyRef);
    if (legacySnap.exists()) {
      const raw = legacySnap.data().data;
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
export function firebaseListenTo(targetUserId, onUpdate) {
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

window.addEventListener('online',  function() { setSyncStatus('synced'); });
window.addEventListener('offline', function() { setSyncStatus('offline'); });

// Legacy switchDevice — kept for QR scan compatibility
// Now just reloads with the new ID stored; the new _vsSwitchDevice is preferred
export function switchDevice(newId) {
  if (!newId || newId.trim().length < 8) return false;
  localStorage.setItem('volleystat_device_id', newId.trim());
  window.location.reload();
  return true;
}

// Migrate an old device-ID session into the current user's account
export async function migrateOldSession(deviceId) {
  if (!currentUser) throw new Error('Not authenticated');
  try {
    // Read from legacy path
    const legacyRef = doc(db, 'volleystat_data', deviceId);
    const snap = await getDoc(legacyRef);
    if (!snap.exists()) return null;
    const raw = snap.data().data;
    if (!raw) return null;
    // Write to user's path
    await setDoc(userDataRef(), { data: raw, updatedAt: Date.now() }, { merge: true });
    // Register session
    const state = JSON.parse(raw);
    const team = state && state.teams && state.teams.length
      ? (state.teams.find(function(t){ return t.id === state.activeTeamId; }) || state.teams[0])
      : null;
    if (team && team.name) await registerSession(team.name);
    return JSON.parse(raw);
  } catch(e) {
    console.warn('[VolleyStat] migrateOldSession error:', e.message);
    throw e;
  }
}
