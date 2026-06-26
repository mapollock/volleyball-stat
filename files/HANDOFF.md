# VolleyStat — Project Handoff Document
## For continuation in a new Claude account

---

## Project Overview

**VolleyStat** is a live courtside volleyball stat tracking Progressive Web App (PWA) built for tournament use. It runs entirely in the browser, works offline, and syncs to Firebase in real time.

- **Live URL:** `https://volleystat-5e650.web.app`
- **Current Version:** Alpha 0.1.57
- **Firebase Project:** `volleystat-5e650`
- **Deployment:** Firebase Hosting (`firebase deploy` from project folder)

---

## Firebase Configuration

```javascript
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBrF9-6bi_hCLxPI75_jfXmhY7NusA1mDk",
  authDomain: "volleystat-5e650.firebaseapp.com",
  projectId: "volleystat-5e650",
  storageBucket: "volleystat-5e650.firebasestorage.app",
  messagingSenderId: "180076488843",
  appId: "1:180076488843:web:0eb2d012627523cdb54c8e"
};
```

**Firebase Services enabled:**
- Firestore Database (native mode)
- Authentication: Google + Email/Password
- Hosting

**Current Firestore Rules:**
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/data/{document} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    match /users/{userId}/sessions/{document} {
      allow read, write: if request.auth != null;
    }
    match /shares/{shareToken} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
      allow delete: if request.auth != null && request.auth.uid == resource.data.userId;
    }
    match /volleystat_sessions/{docId} {
      allow read, write: if request.auth != null;
    }
    match /volleystat_data/{deviceId} {
      allow read, write: if true;
    }
  }
}
```

---

## File Structure

```
project-folder/
├── index.html          # Main app (single page, all layouts)
├── app.js              # All app logic (~2900 lines)
├── firebase-sync.js    # Firebase module (auth, save, load, share, sessions)
├── report.html         # Report page (opens in new tab, print-to-PDF)
├── share.html          # Read-only shared stats / fork landing page
├── login.html          # Legacy login page (no longer used, kept for safety)
├── sw.js               # Service worker v6 (never caches app.js)
├── styles.css          # Minimal shared styles
├── manifest.json       # PWA manifest
├── favicon.svg         # Navy volleyball favicon
├── quickstart.pdf      # User guide (v0.1.31, needs updating)
└── firebase.json       # { "hosting": { "public": ".", "ignore": [...] } }
```

---

## Architecture

### App Layout Order (top to bottom, all devices)
1. Sync bar — Firebase status + Sync Settings + user email
2. Login overlay — full-screen, shown when not authenticated
3. Title — app name, version, Quick Start Guide
4. Score bar — navy, your team left / opponent right, +/- buttons
5. Select Player strip — player pills, Clear / Undo / Edit / Report buttons
6. Stat buttons — Serving / Srv/Rec / Attacking / Unforced Errors
7. Stats table — color-coded, horizontally scrollable
8. Bottom controls — Team, Day (+Day), Match (+Match), Set, View, Mode, Export CSV, Reset

### CSS Breakpoints
- `≤649px` mobile portrait: stat groups stack, buttons wrap
- `≥650px` tablet/desktop: 2-column stat grid, single-row buttons
- Page max-width: 1012px centered

### Data Storage
- **localStorage key:** `volleystat_v057`
- **Score store key:** `volleystat_scores_v2`
- **Firebase (user data):** `users/{userId}/data/state`
- **Firebase (sessions):** `users/{userId}/sessions/current` and `volleystat_sessions/{userId}`
- **Firebase (shares):** `shares/{token}`

### Player Object Structure
```javascript
{
  id: "uuid",
  name: "Player Name",
  number: "1",          // jersey number as string
  position: "OH1"       // S, OH1, OH2, MB1, MB2, LIB, DS
}
```
**CRITICAL:** Position is stored as `player.position` — NOT `player.pos`.

### Stat Counters Per Player Per Set
```
serve1, serve2, serve3, ace, serveOut
passToTarget, passNearTarget, passAwayTarget, passShank
swing, swingOut, kill
errHitting, errServing, errPassing, errNet, errTwoHand, errRotation
```

### Score Store
```javascript
scoreStore["Day 1 - Match 1 - Set 1"] = { our: 25, opp: 18 }
```

---

## Critical Technical Decisions

### 1. Button Wiring Pattern (MOST IMPORTANT)
All buttons in hidden panels (sync settings, player strip) MUST use:
```html
<button onclick="window._vsMyFunction()">Label</button>
```
```javascript
window._vsMyFunction = async function() { ... };
```
**Never use `byId() + addEventListener`** for these — `byId()` returns null for buttons inside `display:none` elements at init time, silently failing.

### 2. Browser Dialog Blocking
Firefox and Chrome block `alert()`, `confirm()`, `prompt()`. Always use:
```javascript
function vsConfirm(msg) {
  return new Promise(function(resolve) {
    // in-page modal with OK/Cancel
  });
}
await vsConfirm('Are you sure?')  // returns true/false
```

### 3. Authentication Flow
- Login is an **in-page overlay** (NOT a redirect to login.html)
- `onAuthReady(user)` shows overlay if null, hides it if user exists
- Sign out just calls `fb.signOutUser()` — overlay shows automatically

### 4. Auto-scoring from Stats
- Kill, ACE → our score +1
- Serve OUT, Swing Out, Pass 0, any error button → opponent +1
- Score stored per Day/Match/Set context

### 5. Auto-linked Errors
- Serve OUT → also records `errServing`
- Swing Out → also records `errHitting`
- Pass 0 → also records `errPassing`

### 6. Session Sharing / Forking
- Full team share: `forkSharedSession(token)` copies coach's Firestore data to recipient's account → recipient gets independent copy
- Player share: read-only in share.html
- Share tokens: `shares/{token}` collection

### 7. Report System
- `window._vsOpenReport()` writes to `localStorage('volleystat_report_data')`
- `report.html` reads from localStorage, renders in new tab
- Print → Save as PDF via browser

---

## Stat Button Labels

| Group | Buttons | data-action values |
|-------|---------|-------------------|
| Serving | 1, 2, 3, ACE, OUT | serve1, serve2, serve3, ace, serveOut |
| Srv / Rec | 3, 2, 1, 0 | passToTarget, passNearTarget, passAwayTarget, passShank |
| Attacking | Kill, Swing, Out | kill, swing, swingOut |
| Unforced Errors | Passing, Net, 2-Touch, O.O.R. | errPassing, errNet, errTwoHand, errRotation |

---

## Known Issues / Technical Debt

1. `login.html` — no longer used but still deployed
2. `styles.css` — minimal; most styles are in `<style>` tag in index.html
3. `quickstart.pdf` — outdated (v0.1.31), needs full rewrite
4. Mobile mirror elements — hidden `<select>` elements in bottom controls kept for JS sync compatibility
5. `DEFAULT_DAYS` — global array mutated by +Day button; not explicitly persisted separately

---

## Pending Features / Ideas

1. Quickstart PDF rewrite for current UI
2. Block tracking (Kill Block button only — simple)
3. App Store submission via Capacitor
4. Payments/subscriptions via Stripe
5. Tournament summary view (per-day/match breakdown side by side)

---

## Deployment

```bash
cd /path/to/project-folder
firebase deploy
```

Always verify:
1. `node --check app.js` — syntax check before deploying
2. Version in index.html matches version in app.js console.log and STORAGE_KEY
3. Hard reload after deploy: Ctrl+Shift+R (desktop), hold reload (mobile)

### Version Bump Checklist
Every change requires updating:
- `index.html`: `Version Alpha 0.1.XX`
- `index.html`: `app.js?v=0.1.XX`
- `app.js`: `console.log('[VolleyStat] v0.1.XX loaded')`
- `app.js`: `var STORAGE_KEY = 'volleystat_vXX'`

---

## Instructions for New Claude Session

### Suggested opening prompt:
> "I'm continuing development of VolleyStat, a volleyball stat tracking PWA at volleystat-5e650.web.app. Current version is 0.1.57. I'm uploading all source files and a handoff document. Please read both before making any changes."

### Upload these files to the new session:
- `app.js`, `index.html`, `firebase-sync.js`, `report.html`, `share.html`, `sw.js`, `styles.css`, `manifest.json`, `favicon.svg`
- This handoff document

### Key reminders for Claude:
- Player position = `p.position` not `p.pos`
- Sync panel buttons use `onclick="window._vsXxx()"` pattern
- Use `vsConfirm()` not `confirm()` or `alert()`
- Keep working files in `/tmp/`, copy to `/mnt/user-data/outputs/` when ready
- Run `node --check app.js` before every deploy
- Bump version in both files on every change

---

## Firebase Console
`console.firebase.google.com/project/volleystat-5e650`
