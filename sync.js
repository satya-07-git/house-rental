/**
 * RentEase – sync.js
 * ─────────────────────────────────────────────────────────────
 * Zero-setup cloud sync. No account. No API key. Completely free.
 *
 * PRIMARY:  ExtendsClass JSON Storage  (no data expiry, CORS-enabled)
 *           https://extendsclass.com/json-storage.html
 * FALLBACK: JSONBlob.com               (75-day inactivity expiry)
 *           https://jsonblob.com
 *
 * How it works:
 *   1. On first open, creates a cloud bin and stores its ID in localStorage.
 *   2. Polls every 8 seconds — any change from another device triggers a
 *      full re-render with a toast notification.
 *   3. The "Share Link" button copies a URL with the bin ID in the hash.
 *      Anyone who opens that URL joins the same live session.
 * ─────────────────────────────────────────────────────────────
 */

const CLOUDSYNC = (() => {

  /* ── Backends ── */
  const EC_API   = 'https://json.extendsclass.com/bin';  // ExtendsClass (primary)
  const JB_API   = 'https://jsonblob.com/api/jsonBlob';  // JSONBlob    (fallback)

  /* ── Storage keys ── */
  const BLOB_KEY   = 'rentease_blob_id';
  const BACKEND_KEY = 'rentease_backend'; // 'ec' | 'jb'

  /* ── Polling interval ── */
  const POLL_MS = 8000;

  /* ── Internal state ── */
  let _blobId   = null;
  let _backend  = null;   // 'ec' or 'jb'
  let _version  = 0;      // version counter for change detection
  let _pollTimer = null;
  let _isBusy   = false;
  let _onRemote = null;   // fn(rooms[])
  let _onStatus = null;   // fn('live'|'syncing'|'offline')

  /* ═══════════════════════════ PUBLIC API ═══════════════════════════ */

  /**
   * Initialise: detect existing session from hash or localStorage.
   * Returns the existing blob ID if found, else null.
   */
  async function init(onRemoteChange, onStatusChange) {
    _onRemote = onRemoteChange;
    _onStatus = onStatusChange;

    _status('syncing');

    // URL hash takes priority (someone opened a shared link)
    const urlId = _readHashId();
    if (urlId) {
      _blobId  = urlId;
      _backend = localStorage.getItem(BACKEND_KEY) || 'ec';
      localStorage.setItem(BLOB_KEY, _blobId);
      history.replaceState(null, '', location.pathname + location.search);
    } else {
      _blobId  = localStorage.getItem(BLOB_KEY);
      _backend = localStorage.getItem(BACKEND_KEY) || 'ec';
    }

    return _blobId || null;
  }

  /**
   * Create a brand-new cloud bin seeded with current `rooms`.
   * Tries ExtendsClass first, falls back to JSONBlob.
   */
  async function createBlob(rooms) {
    _status('syncing');

    // Try ExtendsClass
    let id = await _ecCreate(rooms);
    if (id) {
      _blobId  = id;
      _backend = 'ec';
    } else {
      // Fall back to JSONBlob
      id = await _jbCreate(rooms);
      if (id) {
        _blobId  = id;
        _backend = 'jb';
      }
    }

    if (_blobId) {
      _version = 1;
      localStorage.setItem(BLOB_KEY, _blobId);
      localStorage.setItem(BACKEND_KEY, _backend);
      _status('live');
      _startPolling();
      return _blobId;
    }

    _status('offline');
    return null;
  }

  /** Push local rooms to the cloud (called after every save). */
  async function push(rooms) {
    if (!_blobId || _isBusy) return false;
    _isBusy = true;
    _status('syncing');
    _version++;
    const payload = { version: _version, ts: Date.now(), rooms };

    const ok = _backend === 'ec'
      ? await _ecUpdate(payload)
      : await _jbUpdate(payload);

    _isBusy = false;
    _status(ok ? 'live' : 'offline');
    return ok;
  }

  /** Fetch the current cloud state. Returns { version, rooms } or null. */
  async function pull() {
    if (!_blobId) return null;
    const data = _backend === 'ec'
      ? await _ecRead()
      : await _jbRead();
    return data;
  }

  /** Returns the shareable URL for this sync session. */
  function getShareUrl() {
    if (!_blobId) return null;
    return `${location.origin}${location.pathname}#sync=${_blobId}`;
  }

  function getBlobId() { return _blobId; }
  function isReady()   { return !!_blobId; }

  function stopPolling()   { clearInterval(_pollTimer); }
  function resumePolling() { if (_blobId) _startPolling(); }

  /* ═══════════════════════ EXTENDS CLASS API ═══════════════════════ */

  async function _ecCreate(rooms) {
    try {
      const res = await fetch(EC_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Security-key': _getSecurityKey(),
        },
        body: JSON.stringify({ version: 1, ts: Date.now(), rooms }),
      });
      if (!res.ok) throw new Error(`EC create HTTP ${res.status}`);
      const data = await res.json();
      return data.id || null;
    } catch (e) {
      console.warn('[SYNC] ExtendsClass create failed:', e.message);
      return null;
    }
  }

  async function _ecUpdate(payload) {
    try {
      const res = await fetch(`${EC_API}/${_blobId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Security-key': _getSecurityKey(),
        },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch (e) {
      console.warn('[SYNC] ExtendsClass update failed:', e.message);
      return false;
    }
  }

  async function _ecRead() {
    try {
      const res = await fetch(`${EC_API}/${_blobId}`, {
        headers: { 'Security-key': _getSecurityKey() },
      });
      if (!res.ok) throw new Error(`EC read HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn('[SYNC] ExtendsClass read failed:', e.message);
      return null;
    }
  }

  /* ═══════════════════════ JSONBLOB FALLBACK ═══════════════════════ */

  async function _jbCreate(rooms) {
    try {
      const res = await fetch(JB_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ version: 1, ts: Date.now(), rooms }),
      });
      if (!res.ok) throw new Error(`JB create HTTP ${res.status}`);
      const loc = res.headers.get('Location') || '';
      const id  = loc.split('/').pop();
      return id && id.length > 5 ? id : null;
    } catch (e) {
      console.warn('[SYNC] JSONBlob create failed:', e.message);
      return null;
    }
  }

  async function _jbUpdate(payload) {
    try {
      const res = await fetch(`${JB_API}/${_blobId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch (e) {
      console.warn('[SYNC] JSONBlob update failed:', e.message);
      return false;
    }
  }

  async function _jbRead() {
    try {
      const res = await fetch(`${JB_API}/${_blobId}`, {
        headers: { 'Accept': 'application/json' },
      });
      if (!res.ok) throw new Error(`JB read HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn('[SYNC] JSONBlob read failed:', e.message);
      return null;
    }
  }

  /* ═════════════════════════ INTERNALS ═════════════════════════ */

  function _status(state) {
    if (_onStatus) _onStatus(state);
  }

  /** A lightweight key derived from the blob ID so only your devices can write. */
  function _getSecurityKey() {
    // Uses blob ID as a pseudo-secret — prevents random overwrites
    return _blobId ? `rentease-${_blobId.slice(-8)}` : 'rentease-init';
  }

  function _readHashId() {
    const raw = location.hash.replace(/^#/, '');
    const params = new URLSearchParams(raw);
    const id = params.get('sync');
    return id && id.length > 3 ? id : null;
  }

  function _startPolling() {
    clearInterval(_pollTimer);
    _pollTimer = setInterval(_doPoll, POLL_MS);
  }

  async function _doPoll() {
    if (_isBusy) return;
    const data = await pull();
    if (!data) { _status('offline'); return; }
    _status('live');

    if (typeof data.version === 'number' && data.version > _version) {
      _version = data.version;
      if (_onRemote && Array.isArray(data.rooms)) {
        _onRemote(data.rooms);
      }
    }
  }

  /* ══════════════════════ EXPORT ══════════════════════ */
  return {
    init, createBlob, push, pull,
    getShareUrl, getBlobId, isReady,
    stopPolling, resumePolling,
  };

})();
