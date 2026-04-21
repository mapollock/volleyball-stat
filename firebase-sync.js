/**
 * VolleyStat — Firebase Sync Module
 * Handles real-time sync between localStorage and Firestore.
 * Offline-first: app works without internet, syncs when connected.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, doc, setDoc, getDoc, onSnapshot, enableIndexedDbPersistence }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBrF9-6bi_hCLxPI75_jfXmhY7NusA1mDk",
  authDomain: "volleystat-5e650.firebaseapp.com",
  projectId: "volleystat-5e650",
  storageBucket: "volleystat-5e650.firebasestorage.app",
  messagingSenderId: "180076488843",
  appId: "1:180076488843:web:0eb2d012627523cdb54c8e"
};

const DEVICE_ID_KEY = 'volleystat_device_id';
const STORAGE_KEY    = 'volleystat_v010';

// ── Device ID ────────────────────────────────────────────────────────────────
// Each device gets a stable anonymous ID. Coaches can share their ID to
// access the same data on another device.
function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// ── Init ─────────────────────────────────────────────────────────────────────
const fbApp = initializeApp(FIREBASE_CONFIG);
const db    = getFirestore(fbApp);

// Enable offline persistence (IndexedDB cache)
enableIndexedDbPersistence(db).catch(function(err) {
  if (err.code === 'failed-precondition') {
    console.warn('[VolleyStat] Firestore persistence unavailable (multiple tabs open)');
  } else if (err.code === 'unimplemented') {
    console.warn('[VolleyStat] Firestore persistence not supported in this browser');
  }
});

const deviceId = getDeviceId();
const docRef   = doc(db, 'volleystat_data', deviceId);

// ── Status indicator ─────────────────────────────────────────────────────────
function setSyncStatus(status) {
  // status: 'synced' | 'saving' | 'offline' | 'error'
  const el = document.getElementById('syncStatus');
  if (!el) return;
  const labels = { synced:'✓ Synced', saving:'↑ Saving…', offline:'⚡ Offline', error:'⚠ Sync error' };
  const colors = { synced:'#16a34a', saving:'#2563eb', offline:'#d97706', error:'#dc2626' };
  el.textContent  = labels[status] || status;
  el.style.color  = colors[status] || '#6b7280';
}

// ── Save to Firestore ─────────────────────────────────────────────────────────
let saveTimer = null;
let lastSaved = null;

export function firebaseSave(stateObj) {
  // Debounce: wait 1.5s after last change before writing
  clearTimeout(saveTimer);
  setSyncStatus('saving');
  saveTimer = setTimeout(async function() {
    try {
      const payload = { data: JSON.stringify(stateObj), updatedAt: Date.now() };
      await setDoc(docRef, payload, { merge: true });
      lastSaved = Date.now();
      setSyncStatus('synced');
    } catch(e) {
      console.error('[VolleyStat] Firebase save error:', e);
      setSyncStatus(navigator.onLine ? 'error' : 'offline');
    }
  }, 1500);
}

// ── Load from Firestore ───────────────────────────────────────────────────────
export async function firebaseLoad() {
  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const raw = snap.data().data;
      if (raw) return JSON.parse(raw);
    }
  } catch(e) {
    console.warn('[VolleyStat] Firebase load error (using local data):', e);
  }
  return null;
}

// ── Real-time listener ────────────────────────────────────────────────────────
// Fires whenever another device saves — merges remote state into local
export function firebaseListen(onRemoteUpdate) {
  return onSnapshot(docRef, function(snap) {
    if (!snap.exists()) return;
    const remote = snap.data();
    if (!remote || !remote.data) return;
    // Skip if this update was from us (within 3s of our last save)
    if (lastSaved && (Date.now() - lastSaved) < 3000) return;
    try {
      const parsed = JSON.parse(remote.data);
      onRemoteUpdate(parsed);
      setSyncStatus('synced');
    } catch(e) {
      console.warn('[VolleyStat] Could not parse remote update');
    }
  }, function(err) {
    console.warn('[VolleyStat] Snapshot error:', err);
    setSyncStatus(navigator.onLine ? 'error' : 'offline');
  });
}

// ── Online/offline status ─────────────────────────────────────────────────────
window.addEventListener('online',  function() { setSyncStatus('synced'); });
window.addEventListener('offline', function() { setSyncStatus('offline'); });

// ── Device ID panel ───────────────────────────────────────────────────────────
// Expose device ID so users can share it or enter another device's ID
export function getDeviceIdPublic() { return deviceId; }
export function switchDevice(newId) {
  if (!newId || newId.trim().length < 8) return false;
  localStorage.setItem(DEVICE_ID_KEY, newId.trim());
  window.location.reload();
  return true;
}
