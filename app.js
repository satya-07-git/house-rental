/* ─────────────────────────────────────────────
   RentEase – app.js
   Full rental home management logic
───────────────────────────────────────────── */

const TOTAL_ROOMS = 18;
const STORAGE_KEY = 'rentease_data';

// ── Default tenant structure ──
const emptyTenant = () => ({
  name: '', phone: '', aadhar: '',
  occupation: '', moveIn: '', rent: '',
  emergency: '', email: '', notes: '',
  billStatus: 'unpaid'
});

// ── State ──
let rooms = [];          // array[18] of { occupied, tenant }
let activeRoom = null;   // currently open room index (0-based)
let currentFilter = 'all';
let searchQuery = '';
let confirmCallback = null;

// ── DOM refs ──
const $grid       = document.getElementById('roomsGrid');
const $overlay    = document.getElementById('modalOverlay');
const $modal      = document.getElementById('modal');
const $form       = document.getElementById('tenantForm');
const $modalTitle = document.getElementById('modalTitle');
const $roomBadge  = document.getElementById('modalRoomBadge');
const $searchInput= document.getElementById('searchInput');
const $toast      = document.getElementById('toast');
const $confirmOverlay = document.getElementById('confirmOverlay');
const $confirmMsg = document.getElementById('confirmMsg');

// ── Init ──
function init() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    rooms = JSON.parse(saved);
    // Ensure 18 rooms
    while (rooms.length < TOTAL_ROOMS) rooms.push({ occupied: false, tenant: emptyTenant() });
    rooms = rooms.slice(0, TOTAL_ROOMS);
  } else {
    rooms = Array.from({ length: TOTAL_ROOMS }, () => ({ occupied: false, tenant: emptyTenant() }));
  }
  renderAll();
  bindEvents();
}

// ── Persist ──
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
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
    const roomNum = `room ${idx + 1}`;
    const name    = room.tenant.name.toLowerCase();
    const phone   = room.tenant.phone.toLowerCase();
    const occ     = room.tenant.occupation.toLowerCase();
    if (!roomNum.includes(q) && !name.includes(q) && !phone.includes(q) && !occ.includes(q)) return false;
  }

  return true;
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
    </div>` : ''}

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

  const name  = document.getElementById('fName').value.trim();
  const phone = document.getElementById('fPhone').value.trim();
  const rent  = document.getElementById('fRent').value.trim();
  const moveIn= document.getElementById('fMoveIn').value;

  if (!name || !phone || !moveIn || !rent) {
    showToast('Please fill in all required fields.', 'error');
    return;
  }

  rooms[activeRoom] = {
    occupied: true,
    tenant: {
      name,
      phone,
      aadhar:     document.getElementById('fAadhar').value.trim(),
      occupation: document.getElementById('fOccupation').value.trim(),
      moveIn,
      rent,
      emergency:  document.getElementById('fEmergency').value.trim(),
      email:      document.getElementById('fEmail').value.trim(),
      notes:      document.getElementById('fNotes').value.trim(),
      billStatus: getBillToggle()
    }
  };

  save();
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
  renderAll();
  const status = rooms[roomIdx].tenant.billStatus;
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

  // Search
  $searchInput.addEventListener('input', e => {
    searchQuery = e.target.value.trim();
    renderGrid();
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

// ──────────────── HELPERS ────────────────

function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Boot ──
init();
