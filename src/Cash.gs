/**
 * Cash.gs (v1.9): optional "available cash" per account.
 * You enter today's balance once (Accounts tab). From then on, buys and sales made in the app adjust it, and you can
 * correct it any time (deposit, withdrawal, fee, dividend, or simply "set it to what my statement says").
 * Every change is written to the CashLog sheet. An account whose cash was never set is simply not tracked.
 * Edits and deletes of holdings never touch cash (they correct records, they are not money movements).
 */

function r2_(x) { return Math.round(x * 100) / 100; }

function readAccountRows_() {
  const s = ss_().getSheetByName(SHEETS.ACCOUNTS), n = s ? s.getLastRow() - 1 : 0;
  if (n < 1) return [];
  return s.getRange(2, 1, n, 5).getValues().map(function (r, i) {
    return { row: i + 2, name: String(r[0]).replace(/\s+/g, ' ').trim(), cash: (typeof r[2] === 'number' && isFinite(r[2])) ? r[2] : null,
      ccy: String(r[3] || '').trim().toUpperCase(), updated: r[4] };
  }).filter(function (a) { return a.name; });
}
function accountRow_(name) {
  const k = acct_(name).toLowerCase();
  return readAccountRows_().filter(function (a) { return a.name.toLowerCase() === k; })[0] || null;
}
function cashCcyOk_(c) { return /^[A-Z]{3}$/.test(c) && c !== 'GBX'; }
/** Amount in `from` currency -> `to` currency through EUR. Null when a rate is missing (never guessed). */
function convertCcy_(amount, from, to, fx) {
  if (from === to) return amount;
  const a = fxToEur(from, fx), b = fxToEur(to, fx);
  return (a === null || b === null || b === 0) ? null : amount * a / b;
}
function logCash_(account, change, ccy, balance, reason, details) {
  const s = ss_().getSheetByName(SHEETS.CASHLOG);
  if (s) s.appendRow([new Date(), account, r2_(change), ccy, r2_(balance), reason, String(details || '').slice(0, 300)]);
}
/** Inside the lock. delta is in the instrument's major currency (negative = money out). */
function applyCash_(account, delta, fromCcy, reason, details) {
  const a = accountRow_(account);
  if (!a || a.cash === null) return { applied: false, reason: 'off' };
  const ccy = a.ccy || 'EUR', conv = convertCcy_(delta, fromCcy, ccy, readFx_());
  if (conv === null) return { applied: false, reason: 'fx', ccy: ccy };
  const bal = r2_(a.cash + conv), s = sh_(SHEETS.ACCOUNTS);
  s.getRange(a.row, 3).setValue(bal);
  s.getRange(a.row, 5).setValue(new Date());
  logCash_(a.name, conv, ccy, bal, reason, details);
  return { applied: true, change: r2_(conv), balance: bal, ccy: ccy };
}
function cashNote_(c) {
  if (!c) return '';
  if (c.applied) return ' Cash ' + (c.change >= 0 ? '+' : '') + c.change.toFixed(2) + ' ' + c.ccy + ', now ' + c.balance.toFixed(2) + ' ' + c.ccy + '.';
  if (c.reason === 'fx') return ' Cash was NOT updated (no FX rate for ' + c.ccy + '): adjust it by hand.';
  return '';
}
function cashMap_() {
  const m = {};
  readAccountRows_().forEach(function (a) { if (a.cash !== null) m[a.name] = { cash: a.cash, ccy: a.ccy || 'EUR' }; });
  return m;
}

/** Sets the balance to an exact figure (what your statement says today). Also used the first time, to start tracking. */
function setAccountCash(name, amount, currency, note) {
  return guard_(function () {
    const nm = cleanAccount_(name), amt = Number(amount), ccy = String(currency || 'EUR').trim().toUpperCase();
    if (amount === '' || amount === null || amount === undefined || !isFinite(amt)) throw new Error('Enter the available cash as a number.');
    if (!cashCcyOk_(ccy)) throw new Error('Currency must be a 3-letter code such as EUR, HUF or USD.');
    return withLock(function () {
      const canon = allAccountNames_().filter(function (n) { return n.toLowerCase() === nm.toLowerCase(); })[0];
      if (!canon) return fail('Account not found: ' + nm);
      ensureAccount_(canon);
      const a = accountRow_(canon), sameCcy = a.ccy === ccy, change = (a.cash === null || !sameCcy) ? amt : amt - a.cash;
      const s = sh_(SHEETS.ACCOUNTS);
      s.getRange(a.row, 3, 1, 3).setValues([[r2_(amt), ccy, new Date()]]);
      if (ccy !== 'EUR' && ccy !== 'HUF') ensureFxRow_(ccy + 'EUR');
      logCash_(canon, change, ccy, amt, 'Set balance', (a.cash === null ? 'Tracking started. ' : (sameCcy ? 'Was ' + a.cash.toFixed(2) + '. ' : 'Currency changed from ' + (a.ccy || '?') + '. ')) + (note || ''));
      logAction('Cash', canon + ' set to ' + r2_(amt) + ' ' + ccy);
      return ok({ account: canon, cash: r2_(amt), ccy: ccy }, 'Available cash of ' + canon + ' set to ' + r2_(amt).toFixed(2) + ' ' + ccy);
    });
  });
}
/** Adds (positive) or subtracts (negative) an amount: deposit, withdrawal, fee, dividend. Needs the cash to be set first. */
function adjustAccountCash(name, delta, note) {
  return guard_(function () {
    const nm = cleanAccount_(name), d = Number(delta);
    if (delta === '' || delta === null || delta === undefined || !isFinite(d) || d === 0) throw new Error('Enter an amount other than 0 (negative to take money out).');
    return withLock(function () {
      const a = accountRow_(nm);
      if (!a) return fail('Account not found: ' + nm);
      if (a.cash === null) return fail('Set the available cash of ' + a.name + ' first.');
      const bal = r2_(a.cash + d), s = sh_(SHEETS.ACCOUNTS);
      s.getRange(a.row, 3).setValue(bal);
      s.getRange(a.row, 5).setValue(new Date());
      logCash_(a.name, d, a.ccy || 'EUR', bal, 'Adjustment', note);
      logAction('Cash', a.name + ' ' + (d > 0 ? '+' : '') + r2_(d) + ' ' + (a.ccy || 'EUR') + (note ? ' (' + note + ')' : ''));
      return ok({ account: a.name, cash: bal, ccy: a.ccy || 'EUR' }, 'Cash of ' + a.name + ' is now ' + bal.toFixed(2) + ' ' + (a.ccy || 'EUR'));
    });
  });
}
/** Stops tracking cash for an account (clears the balance; the history stays in CashLog). */
function clearAccountCash(name) {
  return guard_(function () {
    return withLock(function () {
      const a = accountRow_(cleanAccount_(name));
      if (!a || a.cash === null) return fail('Cash is not tracked for this account.');
      sh_(SHEETS.ACCOUNTS).getRange(a.row, 3, 1, 3).clearContent();
      logCash_(a.name, 0, a.ccy || 'EUR', 0, 'Tracking stopped', 'Balance was ' + a.cash.toFixed(2));
      logAction('Cash', a.name + ': cash tracking stopped');
      return ok(null, 'Cash tracking stopped for ' + a.name);
    });
  });
}
function getCashLog(name) {
  return guard_(function () {
    const k = String(name || '').trim().toLowerCase(), s = ss_().getSheetByName(SHEETS.CASHLOG), n = s ? s.getLastRow() - 1 : 0;
    const rows = (n > 0 ? s.getRange(2, 1, n, 7).getValues() : []).filter(function (r) { return !k || String(r[1]).toLowerCase() === k; }).map(function (r) {
      return { time: isDate_(r[0]) ? Utilities.formatDate(r[0], tz_(), 'yyyy-MM-dd HH:mm') : String(r[0]), account: r[1], change: Number(r[2]), ccy: r[3], balance: Number(r[4]), reason: r[5], details: r[6] };
    });
    return ok({ rows: rows.reverse().slice(0, 200) });
  });
}

// ================================================================ saved page preferences (column widths / hidden columns / last sort)
function cleanPrefs_(p) {
  const out = { cols: {}, view: {} };
  ['owned', 'watch', 'sold', 'log', 'accounts'].forEach(function (t) {
    const c = p && p.cols && p.cols[t];
    if (!c) return;
    const okKey = function (k) { return typeof k === 'string' && /^[A-Za-z0-9_]{1,30}$/.test(k); }, widths = {};
    Object.keys(c.widths || {}).slice(0, 40).forEach(function (k) { const w = Number(c.widths[k]); if (okKey(k) && isFinite(w)) widths[k] = Math.max(40, Math.min(1200, Math.round(w))); });
    out.cols[t] = { hidden: (Array.isArray(c.hidden) ? c.hidden : []).filter(okKey).slice(0, 40), widths: widths };
  });
  ['owned', 'watch', 'sold'].forEach(function (t) {                  // the last sort of each list
    const v = p && p.view && p.view[t];
    if (!v || typeof v !== 'object') return;
    const col = v.col && typeof v.col.key === 'string' && /^[A-Za-z0-9_]{1,30}$/.test(v.col.key) && (v.col.dir === 1 || v.col.dir === -1) ? { key: v.col.key, dir: v.col.dir } : null;
    out.view[t] = { sort: (typeof v.sort === 'string' && /^[A-Za-z0-9]{1,12}$/.test(v.sort)) ? v.sort : '', col: col };
  });
  return out;
}
function getUiPrefs() {
  return guard_(function () {
    const raw = PropertiesService.getScriptProperties().getProperty('UI_PREFS');
    let p = {};
    try { p = raw ? JSON.parse(raw) : {}; } catch (e) { p = {}; }
    return ok(cleanPrefs_(p));
  });
}
function saveUiPrefs(p) {
  return guard_(function () {
    const c = cleanPrefs_(p), txt = JSON.stringify(c);
    if (txt.length > 8000) throw new Error('Preferences too large.');
    PropertiesService.getScriptProperties().setProperty('UI_PREFS', txt);
    return ok(c);
  });
}
