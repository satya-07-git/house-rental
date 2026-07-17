/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║              RentEase – Firebase Configuration               ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  SETUP STEPS  (one-time, ~5 minutes):                        ║
 * ║                                                              ║
 * ║  1. Open: https://console.firebase.google.com               ║
 * ║     Sign in with any Google account.                         ║
 * ║                                                              ║
 * ║  2. Click "Add project" → name it (e.g. "my-rentease")      ║
 * ║     → Disable Google Analytics (optional) → Create project   ║
 * ║                                                              ║
 * ║  3. Left sidebar → Build → Realtime Database                 ║
 * ║     → "Create database" → pick region (asia-south1 for IN)  ║
 * ║     → "Start in TEST mode" → Enable                          ║
 * ║                                                              ║
 * ║  4. Left sidebar → ⚙ Project settings                       ║
 * ║     → "Your apps" tab → click </>  (Web)                    ║
 * ║     → App nickname: "RentEase" → Register app               ║
 * ║     → Copy the firebaseConfig object shown on screen         ║
 * ║                                                              ║
 * ║  5. Paste the config values below (replace the placeholders) ║
 * ║                                                              ║
 * ║  6. Share this entire folder (rental-manager/) with anyone   ║
 * ║     who needs access.  All devices sync in real time.        ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

/*
 ┌──────────────────────────────────────────────────────────────┐
 │  FIREBASE SECURITY RULES (paste in Firebase Console)         │
 │  Realtime Database → Rules tab → Replace content → Publish   │
 │                                                              │
 │  {                                                           │
 │    "rules": {                                                │
 │      "rentease": {                                           │
 │        ".read": true,                                        │
 │        ".write": true                                        │
 │      }                                                       │
 │    }                                                         │
 │  }                                                           │
 └──────────────────────────────────────────────────────────────┘
*/
