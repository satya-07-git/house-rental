/**
 * RentEase – security.js  (Lightweight Edition)
 * ─────────────────────────────────────────────
 * Input validation, sanitisation, data integrity,
 * schema validation, audit logging, console warning.
 * PIN / lock system has been removed.
 * ─────────────────────────────────────────────
 */

const SEC = (() => {

  /* ── Storage keys ── */
  const K = {
    LOG       : 'rentease_audit_log',
    INTEGRITY : 'rentease_data_hash',
  };

  /* ══════════════════════════════════════════
     CRYPTO HELPERS
  ══════════════════════════════════════════ */

  async function _sha256(message) {
    const buf  = new TextEncoder().encode(message);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /* ══════════════════════════════════════════
     DATA INTEGRITY
  ══════════════════════════════════════════ */

  async function saveIntegrity(dataStr) {
    const hash = await _sha256(dataStr);
    localStorage.setItem(K.INTEGRITY, hash);
  }

  async function checkIntegrity(dataStr) {
    const stored = localStorage.getItem(K.INTEGRITY);
    if (!stored) return true; // first save — no prior hash
    const hash = await _sha256(dataStr);
    return hash === stored;
  }

  /* ══════════════════════════════════════════
     AUDIT LOG
  ══════════════════════════════════════════ */

  function _log(action, detail = '') {
    const logs = getLogs();
    logs.unshift({ ts: new Date().toISOString(), action, detail });
    try {
      localStorage.setItem(K.LOG, JSON.stringify(logs.slice(0, 200)));
    } catch { /* storage full */ }
  }

  function getLogs() {
    try { return JSON.parse(localStorage.getItem(K.LOG) || '[]'); }
    catch { return []; }
  }

  function logAction(action, detail) { _log(action, detail); }

  /* ══════════════════════════════════════════
     INPUT VALIDATION
  ══════════════════════════════════════════ */

  const RULES = {
    name  : { min: 2, max: 60, pattern: /^[a-zA-Z\s\-'.]+$/, label: 'Full Name' },
    phone : { pattern: /^[6-9]\d{9}$/, label: 'Phone Number (10 digits, starting 6-9)' },
    aadhar: { pattern: /^\d{12}$/, label: 'Aadhar (12 digits)' },
    email : { pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, label: 'Email' },
    rent  : { min: 100, max: 99999, label: 'Monthly Rent (₹100 – ₹99,999)' },
  };

  function validateField(field, value) {
    const v = String(value).trim();
    const r = RULES[field];
    if (!r) return null;

    if (field === 'name') {
      if (v.length < r.min) return `${r.label} must be at least ${r.min} characters.`;
      if (v.length > r.max) return `${r.label} must be at most ${r.max} characters.`;
      if (!r.pattern.test(v)) return `${r.label} may only contain letters, spaces, hyphens, or apostrophes.`;
    }
    if (field === 'phone') {
      const digits = v.replace(/[\s\-+()]/g, '');
      if (!r.pattern.test(digits)) return `${r.label}: enter a valid 10-digit Indian mobile number.`;
    }
    if (field === 'aadhar' && v !== '') {
      if (!r.pattern.test(v.replace(/\s/g, ''))) return `${r.label}: must be exactly 12 digits.`;
    }
    if (field === 'email' && v !== '') {
      if (!r.pattern.test(v)) return `${r.label}: enter a valid email address.`;
    }
    if (field === 'rent') {
      const n = Number(v);
      if (isNaN(n) || n < r.min || n > r.max) return `${r.label}.`;
    }
    return null;
  }

  function sanitise(str, maxLen = 200) {
    return String(str || '')
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // strip control characters
      .slice(0, maxLen)
      .trim();
  }

  /* ══════════════════════════════════════════
     SCHEMA VALIDATOR  (load-time)
  ══════════════════════════════════════════ */

  const TENANT_SCHEMA = {
    name:'string', phone:'string', aadhar:'string', occupation:'string',
    moveIn:'string', rent:'string', emergency:'string', email:'string',
    notes:'string', billStatus:'string',
  };

  function validateRoomData(rooms) {
    if (!Array.isArray(rooms)) return false;
    for (const r of rooms) {
      if (typeof r !== 'object' || typeof r.occupied !== 'boolean') return false;
      if (typeof r.tenant !== 'object') return false;
      for (const [k, t] of Object.entries(TENANT_SCHEMA)) {
        if (typeof r.tenant[k] !== t) return false;
      }
      if (!['paid', 'unpaid'].includes(r.tenant.billStatus)) return false;
    }
    return true;
  }

  /* ══════════════════════════════════════════
     CONSOLE SECURITY WARNING
  ══════════════════════════════════════════ */

  function printConsoleWarning() {
    const css1 = 'color:#e05252;font-size:2rem;font-weight:900;';
    const css2 = 'color:#5a6acf;font-size:0.9rem;';
    console.log('%c⚠ STOP!', css1);
    console.log('%cThis browser console is intended for developers only.\nIf someone told you to paste something here, it is a social engineering attack.\nDo NOT paste or run any code here.', css2);
    console.log('%cRentEase Security Module active. Audit log: SEC.getLogs()', 'color:#2dbd8a;font-size:0.8rem;');
  }

  /* ── Public API ── */
  return {
    saveIntegrity, checkIntegrity,
    validateField, sanitise, validateRoomData,
    logAction, getLogs,
    printConsoleWarning,
  };
})();
