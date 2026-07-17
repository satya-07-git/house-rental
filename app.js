/* ─────────────────────────────────────────────
   RentEase – app.js  (Firebase Real-Time Sync)
   All devices share the same live database.
   Edit firebase-config.js to connect your project.
───────────────────────────────────────────── */


const TOTAL_ROOMS = 18;
const STORAGE_KEY = 'rentease_data';   // local offline cache key
const FB_PATH     = 'rentease/rooms';  // Firebase Realtime DB path

// ── Default tenant structure ──
const emptyTenant = () => ({
  name: '', phone: '', aadhar: '',
  occupation: '', moveIn: '', rent: '',
  emergency: '', email: '', notes: '',
  billStatus: 'unpaid'
});

// ── App state ──
let rooms = [];
let activeRoom = null;
let currentFilter = 'all';
let searchQuery = '';
let confirmCallback = null;

// ── Firebase state ──
let _db        = null;   // Firebase database instance
let _roomsRef  = null;   // DB reference for rooms
let _fbReady   = false;  // true when Firebase is initialised
let _ignoreNext = false; // suppress echo of our own writes

// ── DOM refs ──
const $grid       = document.getElementById('roomsGrid');
const $overlay    = document.getElementById('modalOverlay');
const $modal      = document.getElementById('modal');
const $form       = document.getElementById('tenantForm');
const $modalTitle = document.getElementById('modalTitle');
const $roomBadge  = document.getElementById('modalRoomBadge');
const $searchInput   = document.getElementById('searchInput');
const $roomJumpInput = document.getElementById('roomJumpInput');
const $toast      = document.getElementById('toast');
const $confirmOverlay = document.getElementById('confirmOverlay');
const $confirmMsg = document.getElementById('confirmMsg');

// ──────────────── INIT ────────────────

async function init() {
  SEC.printConsoleWarning();

  // Try Firebase first; fall back to localStorage if not configured
  const fbOk = initFirebase();
  if (!fbOk) await initFromLocalStorage();

  bindEvents();
}

// ── Firebase init ──
function initFirebase() {
  // Guard: config not filled in yet
  if (
    typeof FIREBASE_CONFIG === 'undefined' ||
    !FIREBASE_CONFIG.apiKey ||
    FIREBASE_CONFIG.apiKey === 'YOUR_API_KEY'
  ) {
    updateSyncUI('local');
    return false;
  }

  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    _db       = firebase.database();
    _roomsRef = _db.ref(FB_PATH);
    _fbReady  = true;

    // ── Connection status monitor ──
    _db.ref('.info/connected').on('value', snap => {
      updateSyncUI(snap.val() === true ? 'live' : 'offline');
    });

    // ── Seed Firebase if empty, then listen ──
    updateSyncUI('syncing');
    _roomsRef.once('value').then(snap => {
      if (snap.val() === null) {
        // First launch — migrate localStorage data into Firebase
        _seedFirebase();
      }
      // Start real-time listener (fires immediately + on every remote change)
      _roomsRef.on('value', _onFirebaseData);
    }).catch(err => {
      console.warn('Firebase read failed:', err);
      updateSyncUI('offline');
      initFromLocalStorage();
    });

    return true;
  } catch (err) {
    console.warn('Firebase init failed:', err.message);
    updateSyncUI('local');
    return false;
  }
}

// Upload localStorage data to Firebase on first launch
function _seedFirebase() {
  const saved = localStorage.getItem(STORAGE_KEY);
  let data = _freshRooms();
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (SEC.validateRoomData(parsed)) data = parsed;
    } catch { /* ignore */ }
  }
  _ignoreNext = true;
  _roomsRef.set(data);
}

// Real-time listener — fires for every change from any device
function _onFirebaseData(snapshot) {
  if (_ignoreNext) { _ignoreNext = false; return; }

  const raw = snapshot.val();
  if (!raw) return;

  // Firebase stores arrays as objects when there are gaps, normalise
  const parsed = Array.isArray(raw)
    ? raw
    : Object.keys(raw).sort((a,b) => +a - +b).map(k => raw[k]);

  // Schema guard
  if (!SEC.validateRoomData(parsed)) {
    console.warn('Firebase data failed schema validation — ignored');
    SEC.logAction('FB_SCHEMA_FAIL', 'Remote data rejected');
    return;
  }

  rooms = parsed;
  while (rooms.length < TOTAL_ROOMS) rooms.push({ occupied: false, tenant: emptyTenant() });
  rooms = rooms.slice(0, TOTAL_ROOMS);

  // Keep local cache in sync for offline use
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));

  renderAll();
}

// ── Fallback: load from localStorage (no Firebase) ──
async function initFromLocalStorage() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    let parsed;
    try { parsed = JSON.parse(saved); }
    catch {
      showToast('⚠ Local data corrupted. Resetting.', 'error');
      SEC.logAction('DATA_ERROR', 'JSON parse failed — reset');
      rooms = _freshRooms();
      save();
      renderAll();
      return;
    }

    const intact = await SEC.checkIntegrity(saved);
    if (!intact) {
      showToast('⚠ Data integrity mismatch detected!', 'error');
      SEC.logAction('INTEGRITY_FAIL', 'Hash mismatch');
    }

    if (!SEC.validateRoomData(parsed)) {
      showToast('⚠ Invalid data. Resetting to safe state.', 'error');
      SEC.logAction('SCHEMA_FAIL', 'Schema validation failed');
      rooms = _freshRooms();
    } else {
      rooms = parsed;
      while (rooms.length < TOTAL_ROOMS) rooms.push({ occupied: false, tenant: emptyTenant() });
      rooms = rooms.slice(0, TOTAL_ROOMS);
    }
  } else {
    rooms = _freshRooms();
  }
  renderAll();
}

function _freshRooms() {
  return Array.from({ length: TOTAL_ROOMS }, () => ({ occupied: false, tenant: emptyTenant() }));
}

// ──────────────── PERSIST ────────────────

function save() {
  const json = JSON.stringify(rooms);

  if (_fbReady && _roomsRef) {
    // Write to Firebase — propagates to ALL connected devices
    updateSyncUI('syncing');
    _ignoreNext = true;  // don't re-render from our own write
    _roomsRef.set(rooms)
      .then(()  => { updateSyncUI('live'); })
      .catch(() => { updateSyncUI('offline'); });
  }

  // Always cache locally (works offline too)
  localStorage.setItem(STORAGE_KEY, json);
  SEC.saveIntegrity(json); // fire-and-forget
}

// ──────────────── SYNC UI ────────────────

function updateSyncUI(state) {
  const pill = document.getElementById('syncPill');
  const dot  = document.getElementById('syncDot');
  const txt  = document.getElementById('syncText');
  if (!pill || !dot || !txt) return;

  pill.className = 'sync-pill ' + state;
  const map = {
    live:    { text: 'Live',        title: 'Synced with cloud — all devices up to date' },
    syncing: { text: 'Syncing…',   title: 'Saving to cloud…' },
    offline: { text: 'Offline',     title: 'No connection — changes will sync when back online' },
    local:   { text: 'Local only',  title: 'Firebase not configured — data is stored locally only' },
  };
  const info = map[state] || map.local;
  txt.textContent  = info.text;
  pill.title       = info.title;
}


// ──────────────── RENDER ────────────────

function renderAll() {
  renderStats();
  renderGrid();
}

function renderStats() {
  const occupied = rooms.filter(r => r.occupied).length;
  const vacant   = TOTAL_ROOMS - occupied;
  const paid     = rooms.filter(r => r.occupied && r.tenant.billStatus === 'paid').length;
  const unpaid   = rooms.filter(r => r.occupied && r.tenant.billStatus === 'unpaid').length;

  document.getElementById('occupiedCount').textContent = occupied;
  document.getElementById('vacantCount').textContent   = vacant;
  document.getElementById('paidCount').textContent     = paid;
  document.getElementById('unpaidCount').textContent   = unpaid;
}

function roomMatchesFilter(room, idx) {
  if (currentFilter === 'occupied' && !room.occupied) return false;
  if (currentFilter === 'vacant'   && room.occupied)  return false;
  if (currentFilter === 'unpaid'   && !(room.occupied && room.tenant.billStatus === 'unpaid')) return false;

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    const name = room.tenant.name.toLowerCase();
    const phone = room.tenant.phone.toLowerCase();
    const occ   = room.tenant.occupation.toLowerCase();
    const email = room.tenant.email.toLowerCase();
    if (!name.includes(q) && !phone.includes(q) && !occ.includes(q) && !email.includes(q)) return false;
  }

  return true;
}

// ── Room-number jump / highlight ──
let highlightTimer = null;

function jumpToRoom(num) {
  const idx = num - 1;
  if (idx < 0 || idx >= TOTAL_ROOMS) {
    showToast(`Room number must be between 1 and ${TOTAL_ROOMS}.`, 'error');
    return;
  }

  // Reset filters/search so the room is visible
  currentFilter = 'all';
  searchQuery   = '';
  $searchInput.value = '';
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.filter-btn[data-filter="all"]').classList.add('active');
  renderGrid();

  // Find and highlight the card
  const card = $grid.querySelector(`.room-card[data-room="${idx}"]`);
  if (!card) return;

  // Clear previous highlight
  clearTimeout(highlightTimer);
  $grid.querySelectorAll('.room-card.highlighted').forEach(c => c.classList.remove('highlighted'));

  // Scroll into view then highlight
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  requestAnimationFrame(() => card.classList.add('highlighted'));

  highlightTimer = setTimeout(() => card.classList.remove('highlighted'), 2500);
}

function renderGrid() {
  $grid.innerHTML = '';
  rooms.forEach((room, i) => {
    if (!roomMatchesFilter(room, i)) return;
    $grid.appendChild(buildCard(room, i));
  });

  if ($grid.children.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'grid-column:1/-1;text-align:center;padding:4rem;color:var(--text-3);font-size:0.9rem;';
    empty.innerHTML = '🔍 No rooms match your search or filter.';
    $grid.appendChild(empty);
  }
}

function buildCard(room, i) {
  const card = document.createElement('div');
  card.className = `room-card ${room.occupied ? 'occupied' : 'vacant'}`;
  card.dataset.room = i;

  const t = room.tenant;

  card.innerHTML = `
    <div class="card-head">
      <span class="room-num">Room ${i + 1}</span>
      <span class="occ-badge ${room.occupied ? 'occupied' : 'vacant'}">
        ${room.occupied ? '🔑 Occupied' : '🚪 Vacant'}
      </span>
    </div>

    ${room.occupied
      ? `<div class="tenant-name" title="${escHtml(t.name)}">${escHtml(t.name)}</div>`
      : `<div class="vacant-placeholder">Click to add a tenant</div>`
    }

    ${room.occupied ? `
    <div class="card-meta">
      ${t.phone ? `<div class="meta-row"><span class="meta-icon">📞</span><span class="meta-val">${escHtml(t.phone)}</span></div>` : ''}
      ${t.occupation ? `<div class="meta-row"><span class="meta-icon">💼</span><span class="meta-val">${escHtml(t.occupation)}</span></div>` : ''}
      ${t.moveIn ? `<div class="meta-row"><span class="meta-icon">📅</span><span class="meta-val">Since ${formatDate(t.moveIn)}</span></div>` : ''}
    </div>

    ${t.moveIn ? (() => {
      const dur = getTenancyDuration(t.moveIn);
      return `
      <div class="duration-bar">
        <div class="duration-label">
          <span class="dur-icon">⏱</span>
          <span class="dur-title">Tenancy Duration</span>
        </div>
        <div class="dur-value">${dur.text}</div>
        <div class="dur-track"><div class="dur-fill ${dur.fillClass}" style="width:${dur.pct}%"></div></div>
        <div class="dur-sub">${dur.days} day${dur.days !== 1 ? 's' : ''} total</div>
      </div>`;
    })() : ''}` : ''}

    <div class="card-footer">
      ${room.occupied
        ? `<button class="bill-pill ${t.billStatus}" data-action="toggleBill" data-room="${i}" title="Click to toggle payment status">
             ${t.billStatus === 'paid' ? '✅ Paid' : '❌ Unpaid'}
           </button>
           <div style="display:flex;align-items:center;gap:.5rem;">
             ${t.rent ? `<span class="rent-chip">₹${Number(t.rent).toLocaleString()}/mo</span>` : ''}
             <button class="edit-btn" data-action="edit" data-room="${i}">✏️ Edit</button>
           </div>`
        : `<button class="edit-btn" data-action="edit" data-room="${i}" style="margin-left:auto">➕ Add Tenant</button>`
      }
    </div>
  `;

  return card;
}

// ──────────────── MODAL ────────────────

function openModal(roomIdx) {
  activeRoom = roomIdx;
  const room = rooms[roomIdx];
  const t    = room.tenant;

  $roomBadge.textContent  = `Room ${roomIdx + 1}`;
  $modalTitle.textContent = room.occupied ? 'Edit Tenant' : 'Add Tenant';

  // Populate form
  document.getElementById('fName').value       = t.name;
  document.getElementById('fPhone').value      = t.phone;
  document.getElementById('fAadhar').value     = t.aadhar;
  document.getElementById('fOccupation').value = t.occupation;
  document.getElementById('fMoveIn').value     = t.moveIn;
  document.getElementById('fRent').value       = t.rent;
  document.getElementById('fEmergency').value  = t.emergency;
  document.getElementById('fEmail').value      = t.email;
  document.getElementById('fNotes').value      = t.notes;
  setBillToggle(t.billStatus || 'unpaid');

  $overlay.classList.add('open');
  document.getElementById('fName').focus();
}

function closeModal() {
  $overlay.classList.remove('open');
  activeRoom = null;
}

function setBillToggle(status) {
  const paidBtn   = document.getElementById('billPaidBtn');
  const unpaidBtn = document.getElementById('billUnpaidBtn');
  if (status === 'paid') {
    paidBtn.classList.add('active');
    unpaidBtn.classList.remove('active');
  } else {
    unpaidBtn.classList.add('active');
    paidBtn.classList.remove('active');
  }
}

function getBillToggle() {
  return document.getElementById('billPaidBtn').classList.contains('active') ? 'paid' : 'unpaid';
}

// ──────────────── SAVE ────────────────

function saveTenant(e) {
  e.preventDefault();

  // ── Collect raw values ──
  const raw = {
    name:       document.getElementById('fName').value,
    phone:      document.getElementById('fPhone').value,
    aadhar:     document.getElementById('fAadhar').value,
    occupation: document.getElementById('fOccupation').value,
    moveIn:     document.getElementById('fMoveIn').value,
    rent:       document.getElementById('fRent').value,
    emergency:  document.getElementById('fEmergency').value,
    email:      document.getElementById('fEmail').value,
    notes:      document.getElementById('fNotes').value,
  };

  // ── Validate required fields ──
  let valid = true;

  const setErr = (id, msg) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
    if (msg) valid = false;
  };

  // Clear previous errors
  ['errName','errPhone','errAadhar','errMoveIn','errRent','errEmail'].forEach(id => setErr(id, ''));

  // Name
  setErr('errName', SEC.validateField('name', raw.name) || '');

  // Phone
  setErr('errPhone', SEC.validateField('phone', raw.phone) || '');

  // Aadhar (optional)
  if (raw.aadhar.trim()) setErr('errAadhar', SEC.validateField('aadhar', raw.aadhar) || '');

  // Move-in date
  if (!raw.moveIn) {
    setErr('errMoveIn', 'Move-in date is required.');
  } else if (new Date(raw.moveIn) > new Date()) {
    setErr('errMoveIn', 'Move-in date cannot be in the future.');
  }

  // Rent
  setErr('errRent', SEC.validateField('rent', raw.rent) || '');

  // Email (optional)
  if (raw.email.trim()) setErr('errEmail', SEC.validateField('email', raw.email) || '');

  if (!valid) {
    showToast('Please fix the highlighted errors.', 'error');
    return;
  }

  // ── Sanitise all fields before saving ──
  const action = rooms[activeRoom].occupied ? 'EDIT_TENANT' : 'ADD_TENANT';

  rooms[activeRoom] = {
    occupied: true,
    tenant: {
      name:       SEC.sanitise(raw.name, 60),
      phone:      SEC.sanitise(raw.phone.replace(/[\s\-+()]/g,''), 15),
      aadhar:     SEC.sanitise(raw.aadhar.replace(/\s/g,''), 12),
      occupation: SEC.sanitise(raw.occupation, 80),
      moveIn:     raw.moveIn,
      rent:       SEC.sanitise(raw.rent, 10),
      emergency:  SEC.sanitise(raw.emergency, 15),
      email:      SEC.sanitise(raw.email, 120),
      notes:      SEC.sanitise(raw.notes, 500),
      billStatus: getBillToggle(),
    }
  };

  save();
  SEC.logAction(action, `Room ${activeRoom + 1} — ${rooms[activeRoom].tenant.name}`);
  renderAll();
  closeModal();
  showToast(`✅ Tenant info saved for Room ${activeRoom + 1}`, 'success');
}

// ──────────────── CLEAR ROOM ────────────────

function confirmClearRoom() {
  if (activeRoom === null) return;
  const roomNum = activeRoom + 1;
  openConfirm(
    `Remove tenant from Room ${roomNum}? This will clear all tenant data.`,
    () => {
      SEC.logAction('REMOVE_TENANT', `Room ${roomNum} cleared`);
      rooms[activeRoom] = { occupied: false, tenant: emptyTenant() };
      save();
      renderAll();
      closeModal();
      showToast(`Room ${roomNum} is now vacant.`, 'info');
    }
  );
}

// ──────────────── BILL TOGGLE ────────────────

function toggleBill(roomIdx) {
  if (!rooms[roomIdx].occupied) return;
  const cur = rooms[roomIdx].tenant.billStatus;
  rooms[roomIdx].tenant.billStatus = cur === 'paid' ? 'unpaid' : 'paid';
  save();
  const status = rooms[roomIdx].tenant.billStatus;
  SEC.logAction('BILL_TOGGLE', `Room ${roomIdx + 1} marked ${status}`);
  renderAll();
  showToast(
    `Room ${roomIdx + 1} bill marked as ${status}.`,
    status === 'paid' ? 'success' : 'error'
  );
}

// ──────────────── CONFIRM ────────────────

function openConfirm(msg, cb) {
  $confirmMsg.textContent = msg;
  confirmCallback = cb;
  $confirmOverlay.classList.add('open');
}

function closeConfirm() {
  $confirmOverlay.classList.remove('open');
  confirmCallback = null;
}

// ──────────────── TOAST ────────────────

let toastTimer = null;
function showToast(msg, type = 'info') {
  $toast.textContent = msg;
  $toast.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 3000);
}

// ──────────────── EVENTS ────────────────


function bindEvents() {

  // Grid click delegation
  $grid.addEventListener('click', e => {
    const card = e.target.closest('.room-card');
    if (!card) return;
    const roomIdx = parseInt(card.dataset.room, 10);

    const action = e.target.closest('[data-action]')?.dataset.action;

    if (action === 'toggleBill') {
      e.stopPropagation();
      toggleBill(roomIdx);
    } else if (action === 'edit' || !action) {
      openModal(roomIdx);
    }
  });

  // Modal close
  document.getElementById('modalClose').addEventListener('click', closeModal);
  $overlay.addEventListener('click', e => { if (e.target === $overlay) closeModal(); });

  // Form submit
  $form.addEventListener('submit', saveTenant);

  // Clear room
  document.getElementById('clearTenantBtn').addEventListener('click', confirmClearRoom);

  // Bill toggle buttons
  document.getElementById('billPaidBtn').addEventListener('click', () => setBillToggle('paid'));
  document.getElementById('billUnpaidBtn').addEventListener('click', () => setBillToggle('unpaid'));

  // Confirm dialog
  document.getElementById('confirmYes').addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
    closeConfirm();
  });
  document.getElementById('confirmNo').addEventListener('click', closeConfirm);
  $confirmOverlay.addEventListener('click', e => { if (e.target === $confirmOverlay) closeConfirm(); });

  // Keyword search
  $searchInput.addEventListener('input', e => {
    searchQuery = e.target.value.trim();
    renderGrid();
  });

  // Room-number jump — trigger on Enter or when value is valid
  $roomJumpInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const val = parseInt($roomJumpInput.value, 10);
      if (!isNaN(val)) { jumpToRoom(val); $roomJumpInput.blur(); }
    }
  });
  $roomJumpInput.addEventListener('change', e => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 1 && val <= TOTAL_ROOMS) jumpToRoom(val);
  });

  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderGrid();
    });
  });

  // Keyboard: Escape closes modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($confirmOverlay.classList.contains('open')) closeConfirm();
      else if ($overlay.classList.contains('open')) closeModal();
    }
  });
}

function escHtml(str) {
  // Covers all 5 dangerous characters — prevents XSS via innerHTML
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Returns how long a tenant has occupied the room.
 * @param {string} moveInStr  – ISO date string (YYYY-MM-DD)
 * @returns {{ text, days, pct }}
 *   text – human-friendly string  e.g. "2 yrs 4 mo 12 days"
 *   days – total elapsed days
 *   pct  – 0-100 fill for the progress bar (caps at 3 years = 100%)
 */
function getTenancyDuration(moveInStr) {
  if (!moveInStr) return { text: '—', days: 0, pct: 0 };

  const start = new Date(moveInStr);
  const now   = new Date();

  if (start > now) return { text: 'Future date', days: 0, pct: 0 };

  const totalMs  = now - start;
  const totalDays = Math.floor(totalMs / 864e5);

  let years  = 0, months = 0, days = 0;
  const cur  = new Date(start);

  // Count full years
  while (true) {
    const next = new Date(cur);
    next.setFullYear(next.getFullYear() + 1);
    if (next > now) break;
    years++;
    cur.setFullYear(cur.getFullYear() + 1);
  }
  // Count full months
  while (true) {
    const next = new Date(cur);
    next.setMonth(next.getMonth() + 1);
    if (next > now) break;
    months++;
    cur.setMonth(cur.getMonth() + 1);
  }
  // Remaining days
  days = Math.floor((now - cur) / 864e5);

  const parts = [];
  if (years)  parts.push(`${years} yr${years  !== 1 ? 's' : ''}`);
  if (months) parts.push(`${months} mo`);
  if (days || parts.length === 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);

  const text = parts.join(' ');

  // Progress bar: 0 → 0 days, 100 → 3 years (1095 days)
  const pct = Math.min(100, Math.round((totalDays / 1095) * 100));

  // Colour tier
  let fillClass = 'fresh';
  if (totalDays >= 730)      fillClass = 'long';      // 2+ years
  else if (totalDays >= 365) fillClass = 'veteran';   // 1–2 years
  else if (totalDays >= 90)  fillClass = 'settling';  // 3–12 months

  return { text, days: totalDays, pct, fillClass };
}

// ── Boot ──
init();

// Auto-refresh duration counters every 60 seconds
setInterval(renderGrid, 60_000);
