/**
 * Features.gs (v1.7): accounts, edit a holding, stock split, bulk import, daily value history, CSV export, failure alert.
 * Everything here goes through the same rules as the manual flows (resolveInstrument, locks, Owned XOR Watchlist).
 */

// ================================================================ accounts
function cleanAccount_(v) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!s) throw new Error('Account is required.');
  if (s.length > 40) throw new Error('Account name is too long (40 characters max).');
  return s;
}
function readAccountNames_() {
  const s = ss_().getSheetByName(SHEETS.ACCOUNTS);
  if (!s || s.getLastRow() < 2) return [];
  return s.getRange(2, 1, s.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]).replace(/\s+/g, ' ').trim(); }).filter(Boolean);
}
/** Accounts tab first (in its order), then any account still referenced by a row (e.g. legacy 'Main'). */
function allAccountNames_() {
  const out = [], seen = {};
  const add = function (n) { const k = n.toLowerCase(); if (n && !seen[k]) { seen[k] = true; out.push(n); } };
  readAccountNames_().forEach(add);
  readTab_(SHEETS.OWNED, 9).forEach(function (r) { add(acct_(r[8])); });
  readTab_(SHEETS.SOLD, 13).forEach(function (r) { add(acct_(r[12])); });
  return out;
}
/** Validated account for new data: matches an existing name case-insensitively, otherwise the cleaned new name. */
function accountInput_(v) {
  const s = cleanAccount_(v);
  const hit = allAccountNames_().filter(function (n) { return n.toLowerCase() === s.toLowerCase(); })[0];
  return hit || s;
}
/** Inside the lock: make sure an account used by new data is in the Accounts tab. */
function ensureAccount_(name) {
  const have = readAccountNames_().map(function (n) { return n.toLowerCase(); });
  if (have.indexOf(name.toLowerCase()) < 0) sh_(SHEETS.ACCOUNTS).appendRow([name, new Date()]);
}

function getAccountsData() {
  return guard_(function () {
    const cfg = getConfig_(), insts = readInstruments_(), fx = readFx_();
    const rows = readPositions_({ cfg: cfg, insts: insts, fx: fx });
    const sold = readTab_(SHEETS.SOLD, 13);
    const cashRows = readAccountRows_(), soldRows = readTab_(SHEETS.SOLD, 13);
    const accounts = allAccountNames_().map(function (n) {
      const k = n.toLowerCase(), mine = rows.filter(function (r) { return r.account.toLowerCase() === k; });
      const missing = mine.filter(function (r) { return r.valueEur === null; }).length, fxMissing = mine.filter(function (r) { return r.fxEur === null; }).length;
      const valueEur = missing ? null : mine.reduce(function (a, r) { return a + r.valueEur; }, 0);
      const investedEur = fxMissing ? null : mine.reduce(function (a, r) { return a + r.totalCost * r.fxEur; }, 0);
      const realizedEur = soldRows.filter(function (r) { return acct_(r[12]).toLowerCase() === k; }).reduce(function (a, r) { return a + (Number(r[11]) || 0); }, 0);
      const cr = cashRows.filter(function (c) { return c.name.toLowerCase() === k; })[0] || null, ccy = cr && cr.cash !== null ? (cr.ccy || 'EUR') : '';
      const cashRate = ccy ? fxToEur(ccy, fx) : null, cashEur = (cr && cr.cash !== null && cashRate !== null) ? cr.cash * cashRate : null;
      const tracked = !!(cr && cr.cash !== null);
      return { name: n, holdings: mine.length, sold: sold.filter(function (r) { return acct_(r[12]).toLowerCase() === k; }).length, valueEur: valueEur, missing: missing,
        investedEur: investedEur, realizedEur: realizedEur, cash: tracked ? cr.cash : null, cashCcy: ccy, cashEur: cashEur, cashUpdated: tracked ? fmtDateTime_(cr.updated) : '',
        totalEur: valueEur === null ? null : (tracked ? (cashEur === null ? null : valueEur + cashEur) : valueEur) };
    });
    return ok({ accounts: accounts });
  });
}
function addAccount(name) {
  return guard_(function () {
    const n = cleanAccount_(name);
    return withLock(function () {
      if (allAccountNames_().some(function (x) { return x.toLowerCase() === n.toLowerCase(); })) return fail('An account named "' + n + '" already exists.');
      sh_(SHEETS.ACCOUNTS).appendRow([n, new Date()]);
      logAction('Account', 'Added ' + n);
      return ok({ name: n }, 'Added account ' + n);
    });
  });
}
function renameAccount(oldName, newName) {
  return guard_(function () {
    const o = acct_(oldName), nn = cleanAccount_(newName);
    return withLock(function () {
      if (o === nn) return ok(null, 'No change');
      if (allAccountNames_().some(function (x) { return x.toLowerCase() === nn.toLowerCase() && x.toLowerCase() !== o.toLowerCase(); })) return fail('An account named "' + nn + '" already exists.');
      const s = sh_(SHEETS.ACCOUNTS), names = readAccountNames_().map(function (x) { return x.toLowerCase(); }), i = names.indexOf(o.toLowerCase());
      if (i >= 0) s.getRange(i + 2, 1).setValue(nn); else s.appendRow([nn, new Date()]);
      let changed = 0;
      [[SHEETS.OWNED, 9], [SHEETS.SOLD, 13], [SHEETS.HISTORY, 2], [SHEETS.CASHLOG, 2]].forEach(function (t) {
        const sh = ss_().getSheetByName(t[0]);
        const n = sh ? sh.getLastRow() - 1 : 0;
        if (n < 1) return;
        const col = sh.getRange(2, t[1], n, 1).getValues();
        let hit = false;
        col.forEach(function (r) { if (acct_(r[0]).toLowerCase() === o.toLowerCase()) { r[0] = nn; hit = true; changed++; } });
        if (hit) sh.getRange(2, t[1], n, 1).setValues(col);
      });
      changed += renameNoteAccount_(o, nn);                                          // Owned notes carry the account name too
      logAction('Account', 'Renamed ' + o + ' -> ' + nn + ' (' + changed + ' row(s) updated)');
      return ok({ name: nn }, 'Renamed to ' + nn + ' (' + changed + ' row(s) updated)');
    });
  });
}
function deleteAccount(name) {
  return guard_(function () {
    const n = acct_(name);
    return withLock(function () {
      const k = n.toLowerCase();
      const usedRows = readTab_(SHEETS.OWNED, 9).filter(function (r) { return acct_(r[8]).toLowerCase() === k; }), seenT = {};
      usedRows.forEach(function (r) { seenT[r[0]] = true; });
      const used = Object.keys(seenT).length;
      const hist = readTab_(SHEETS.SOLD, 13).filter(function (r) { return acct_(r[12]).toLowerCase() === k; }).length;
      const ar = accountRow_(n);
      if (ar && ar.cash !== null && ar.cash !== 0) return fail(n + ' still holds a cash balance of ' + ar.cash.toFixed(2) + ' ' + (ar.ccy || 'EUR') + '. Set it to 0 (or stop tracking cash) first.');
      if (used || hist) return fail(n + ' is still used by ' + used + ' holding(s) and ' + hist + ' sold row(s). Rename it, or move/delete those first.');
      const names = readAccountNames_().map(function (x) { return x.toLowerCase(); }), i = names.indexOf(k);
      if (i < 0) return fail('Account not found.');
      sh_(SHEETS.ACCOUNTS).deleteRow(i + 2);
      logAction('Account', 'Deleted ' + n);
      return ok(null, 'Deleted account ' + n);
    });
  });
}

// ================================================================ stock split
/** "for every oldShares you held you now hold newShares": quantity x ratio, buy price / ratio, in every account. Total cost is unchanged. */
function applySplit(ticker, newShares, oldShares) {
  return guard_(function () {
    ticker = String(ticker || '').trim();
    const n = posNum_(newShares, 'New shares'), o = posNum_(oldShares, 'Old shares'), factor = n / o;
    if (Math.abs(factor - 1) < 1e-12) throw new Error('A ratio of 1:1 changes nothing.');
    if (factor > 1000 || factor < 0.001) throw new Error('Ratio out of range (between 1:1000 and 1000:1).');
    return withLock(function () {
      const s = sh_(SHEETS.OWNED), vals = readTab_(SHEETS.OWNED, 9);
      let count = 0;
      vals.forEach(function (r, i) {
        if (r[0] !== ticker) return;
        s.getRange(i + 2, 7, 1, 2).setValues([[r6_(Number(r[6]) / factor), r8_(Number(r[7]) * factor)]]);
        count++;
      });
      if (!count) return fail(ticker + ' is not in Owned.');
      logAction('Split', ticker + ' ' + n + ' for ' + o + ': ' + count + ' lot(s) adjusted (quantity x' + r6_(factor) + ', buy price /' + r6_(factor) + ')');
      return ok({ adjusted: count, factor: factor }, 'Split applied to ' + count + ' lot(s) of ' + ticker + '. Click Refresh Now so prices catch up.');
    });
  });
}

// ================================================================ bulk import
const MARKET_CCY = { US: 'USD', DE: 'EUR', FR: 'EUR', NL: 'EUR', IT: 'EUR', ES: 'EUR', AT: 'EUR', CA: 'CAD', CH: 'CHF', SE: 'SEK', DK: 'DKK', HU: 'HUF' };   // UK lines trade in GBX, GBP, USD or EUR: no expectation
function symbolPart_(ticker) { return String(ticker).split(':')[1] || ''; }

/** Candidate listings for a plain symbol such as GOOGL or U.UN: your Symbols tab first, Yahoo search only when needed. */
function suggestListings(symbol, ccy) {
  return guard_(function () {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9.\-_]{0,14}$/.test(sym)) return fail('Not a plain symbol: ' + symbol);
    const key = sym.replace(/-/g, '.'), want = normalizeCcy_(ccy);
    const matches = function (t) { return symbolPart_(t).replace(/-/g, '.') === key; };
    const compat = function (market) { const c = MARKET_CCY[market]; return !want || !c || c === (want === 'GBX' ? 'GBP' : want); };
    const cands = [], seen = {};
    const add = function (t, name, market, from) { if (!seen[t]) { seen[t] = true; cands.push({ ticker: t, name: name, market: market, from: from, compat: compat(market) }); } };
    readSymbols_().forEach(function (x) { if (matches(x.ticker)) add(x.ticker, x.name, x.market, 'list'); });
    let onlineOk = true;
    if (!(cands.length === 1 && cands[0].compat)) {
      let list = searchYahooCached_(sym);
      if (list !== null && !list.some(function (c) { return matches(c.ticker); }) && sym.indexOf('.') > 0) list = searchYahooCached_(sym.replace(/\./g, '-'));
      if (list === null) onlineOk = false;
      else list.forEach(function (c) { if (matches(c.ticker)) add(c.ticker, c.name, c.market, 'online'); });
    }
    cands.sort(function (a, b) { return (b.compat ? 1 : 0) - (a.compat ? 1 : 0); });
    const good = cands.filter(function (c) { return c.compat; });
    const pick = cands.length === 1 ? cands[0].ticker : (good.length === 1 ? good[0].ticker : '');
    return ok({ candidates: cands, pick: pick, onlineOk: onlineOk });
  });
}

/** Validates every row and says what an import would do. Reads only; no Yahoo calls. rows: {action, account, ticker, date, price, qty, name, currency}. */
function previewImport(rows, opts) {
  return guard_(function () {
    rows = rows || []; opts = opts || {};
    if (rows.length > 500) throw new Error('Import at most 500 rows at a time.');
    const owned = readTab_(SHEETS.OWNED, 9), watch = readTab_(SHEETS.WATCH, 5);
    const ownedKeys = {}, ownedTick = {}, watchSet = {}, known = {};
    owned.forEach(function (r) { ownedKeys[r[0] + '|' + acct_(r[8]).toLowerCase()] = true; ownedTick[r[0]] = true; });
    watch.forEach(function (r) { watchSet[r[0]] = true; });
    allAccountNames_().forEach(function (n) { known[n.toLowerCase()] = true; });
    const seenOwned = {}, seenWatch = {}, newAccounts = {};
    const out = rows.map(function (r) {
      if (r.action === 'skip') return { state: 'skip', message: '' };
      try {
        const ticker = normTicker_(r.ticker), exch = parseTicker_(ticker).exch;
        if (!EXCHANGES[exch]) throw new Error('Unknown exchange prefix "' + exch + '".');
        if (r.action === 'watch') {
          if (ownedTick[ticker]) return { state: 'error', message: 'Already owned: a listing cannot be on both lists.' };
          if (watchSet[ticker] || seenWatch[ticker]) return { state: 'skipw', message: 'Already on the Watchlist.' };
          seenWatch[ticker] = true;
          return { state: 'new', message: '' };
        }
        posNum_(r.price, 'Buy price'); posNum_(r.qty, 'Quantity');
        pastDate_(r.date || opts.defaultDate, 'Buy date');
        const acc = accountInput_(r.account);
        if (!known[acc.toLowerCase()]) newAccounts[acc] = true;
        const key = ticker + '|' + acc.toLowerCase();
        let state = ownedKeys[key] ? 'exists' : (watchSet[ticker] ? 'move' : 'new');
        if (seenOwned[key]) state = 'dup';
        seenOwned[key] = true;
        const msg = { exists: 'Already held in this account (see the setting for existing holdings).', move: 'On the Watchlist: will move to Owned.', dup: 'Appears twice in this import: each row becomes its own lot.', 'new': '' }[state];
        return { state: state, message: (msg + (r.date ? '' : ' Default date used.')).trim() };
      } catch (e) { return { state: 'error', message: e.message }; }
    });
    return ok({ rows: out, newAccounts: Object.keys(newAccounts) });
  });
}

function currencyMismatch_(given, meta) {
  const g = normalizeCcy_(given);
  if (!g || g === meta.currency) return null;
  if (g === 'GBP' && meta.currency === 'GBX') return 'Quoted in pence (GBX) but the row says GBP: enter the buy price in pence.';
  if (g === 'GBX' && meta.currency === 'GBP') return 'Quoted in pounds (GBP) but the row says pence: enter the buy price in pounds.';
  return 'Currency mismatch: the row says ' + g + ' but ' + meta.ticker + ' is quoted in ' + meta.currency + ' (wrong listing?).';
}

/** Imports ONE row (the page calls this row by row so a long import never hits the Apps Script time limit). mode: 'add' | 'replace'. */
function importRow(row, mode, opts) {
  return guard_(function () {
    row = row || {}; opts = opts || {};
    if (row.action === 'watch') {
      const t = normTicker_(row.ticker);
      if (findRow_(SHEETS.OWNED, t, 9)) return fail(t + ' is already owned.');
      if (findRow_(SHEETS.WATCH, t, 5)) return ok(null, t + ' is already on the Watchlist.');
      ensureResolved_(t);
      return withLock(function () { return addWatchCore_(t, row.name); });
    }
    const p = validateOwnedInput_({ ticker: row.ticker, buyPrice: row.price, quantity: row.qty, buyDate: row.date || opts.defaultDate, account: row.account });
    ensureResolved_(p.ticker);
    const bad = currencyMismatch_(row.currency, metaFromInst_(requireInst_(p.ticker)));
    if (bad) return fail(bad, { code: 'CURRENCY' });
    return withLock(function () { return mode === 'replace' ? replaceOwnedCore_(p, row) : addOwnedCore_(p, row, true, opts.deductCash === true); });
  });
}

// ================================================================ daily value history
function round2_(x) { return Math.round(x * 100) / 100; }

function historySnapshot_() {
  const cfg = getConfig_(), insts = readInstruments_(), fx = readFx_(), by = {};
  const bump = function (k, r) {
    const e = by[k] || (by[k] = { value: 0, pl: 0, n: 0, missing: 0 });
    e.n++;
    if (r.valueEur === null) e.missing++; else { e.value += r.valueEur; e.pl += r.plEur; }
  };
  readPositions_({ cfg: cfg, insts: insts, fx: fx }).forEach(function (r) { bump(r.account, r); bump('ALL', r); });
  return by;
}
/** Inside the lock. One row per account (plus ALL) per day; a later run the same day overwrites. */
function recordDailyHistory_() {
  const by = historySnapshot_(), keys = Object.keys(by);
  if (!keys.length) return 0;
  const s = sh_(SHEETS.HISTORY), date = todayIso_(), now = new Date(), n = s.getLastRow() - 1;
  const idx = {};
  (n > 0 ? s.getRange(2, 1, n, 7).getValues() : []).forEach(function (r, i) { idx[isoDate_(r[0]) + '|' + r[1]] = i + 2; });
  keys.forEach(function (k) {
    const e = by[k], row = [toDate_(date), k, round2_(e.value), round2_(e.pl), e.n, e.missing, now], at = idx[date + '|' + k];
    if (at) s.getRange(at, 1, 1, 7).setValues([row]); else s.appendRow(row);
  });
  return keys.length;
}
function recordHistoryNow() {
  return guard_(function () {
    return withLock(function () {
      const n = recordDailyHistory_();
      logAction('History', n ? 'Snapshot recorded (' + n + ' series)' : 'Nothing to record (no holdings)');
      return ok({ series: n }, n ? 'Snapshot recorded' : 'No holdings to record');
    });
  });
}
function getHistoryData() {
  return guard_(function () {
    const rows = readTab_(SHEETS.HISTORY, 7).map(function (r) {
      return { date: isoDate_(r[0]), account: String(r[1]), valueEur: Number(r[2]), plEur: Number(r[3]), positions: Number(r[4]), missing: Number(r[5]) };
    });
    rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    const accounts = [];
    rows.forEach(function (r) { if (r.account !== 'ALL' && accounts.indexOf(r.account) < 0) accounts.push(r.account); });
    return ok({ rows: rows, accounts: accounts });
  });
}

// ================================================================ daily trigger: snapshot + health check
function dailyJob() {
  try {
    const r = withLock(function () { recordDailyHistory_(); return ok(); });
    if (!r.success) logAction('History', 'Snapshot skipped: ' + r.message, 'Warning');
  } catch (e) { logAction('History', String((e && e.message) || e), 'Error'); }
  try { healthCheck_(); } catch (e) { logAction('Alert', String((e && e.message) || e), 'Warning'); }
}

function alertAddress_(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (s.toLowerCase() === 'me') return Session.getEffectiveUser().getEmail();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s : '';
}
/** Emails once a day when no refresh succeeded for alertAfterHours (needs alertEmail in Config; skipped on weekends if Schedule is weekdays-only). */
function healthCheck_() {
  const cfg = getConfig_(), to = alertAddress_(cfg.alertEmail);
  if (!to || !(cfg.alertAfterHours > 0)) return;
  const sc = readSchedule_(), now = new Date();
  if (!sc.hours.some(function (h) { return h.run; })) return;
  if (sc.weekdaysOnly && Number(Utilities.formatDate(now, tz_(), 'u')) >= 6) return;
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(cfg.lastSuccessfulRefresh || '');
  const last = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) : null;
  if (last && (now.getTime() - last.getTime()) / 3600000 <= cfg.alertAfterHours) return;
  const props = PropertiesService.getScriptProperties(), today = todayIso_();
  if (props.getProperty('LAST_ALERT_DATE') === today) return;
  const bad = readInstruments_().filter(function (i) { return i.tracked && i.snap.status && i.snap.status !== 'OK'; }).map(function (i) { return i.ticker + ' (' + i.snap.status + ')'; });
  let url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) { url = ''; }
  MailApp.sendEmail({ to: to, subject: 'Investment Tracker: prices have not refreshed',
    body: 'The last successful price refresh was ' + (cfg.lastSuccessfulRefresh || 'never') + ' (more than ' + cfg.alertAfterHours + ' hours ago).\n\n' +
      'Open the Log tab to see why (look for Warning and Error lines), or click Refresh Now.\n' + (bad.length ? '\nFlagged now: ' + bad.join(', ') + '\n' : '') + (url ? '\n' + url + '\n' : '') +
      '\nThis alert is sent at most once a day. Clear alertEmail in the Config tab to stop it.' });
  props.setProperty('LAST_ALERT_DATE', today);
  logAction('Alert', 'Email sent to ' + to + ' (last refresh ' + (cfg.lastSuccessfulRefresh || 'never') + ')', 'Warning');
}
/** Run once from the editor after setting alertEmail, to check that mail works. */
function sendTestAlert() {
  const to = alertAddress_(getConfig_().alertEmail);
  if (!to) throw new Error('Set alertEmail in the Config tab first (an address, or the word me).');
  MailApp.sendEmail({ to: to, subject: 'Investment Tracker: test alert', body: 'If you can read this, failure alerts will reach you.' });
  return 'Sent to ' + to;
}

// ================================================================ CSV export
function csvCell_(v, sep, dec) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return isFinite(v) ? String(v).replace('.', dec) : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;                      // spreadsheet formula injection guard
  return (/["\n\r]/.test(s) || s.indexOf(sep) >= 0) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
/** kind: 'owned' | 'sold'; account '' = all; year '' = all (sold only, by sell date); preset 'std' (comma, decimal point) or 'eu' (semicolon, decimal comma). */
function exportCsv(kind, account, year, preset, level) {
  return guard_(function () {
    const eu = preset === 'eu', sep = eu ? ';' : ',', dec = eu ? ',' : '.';
    const acc = String(account || '').trim().toLowerCase(), yr = String(year || '').trim();
    let head, rows;
    if (kind === 'sold') {
      head = ['Account', 'Ticker', 'Market', 'Instrument Name', 'Currency', 'Buy Date', 'Buy Price', 'Sell Date', 'Sell Price', 'Sold Qty', 'Realized P/L', 'FX Rate at Sale', 'Realized P/L (EUR)', 'Note'];
      rows = readSoldRows_().filter(function (r) { return (!acc || acct_(r[12]).toLowerCase() === acc) && (!yr || isoDate_(r[6]).slice(0, 4) === yr); })
        .map(function (r) { return [acct_(r[12]), r[0], r[1], r[2], r[3], isoDate_(r[4]), Number(r[5]), isoDate_(r[6]), Number(r[7]), Number(r[8]), Number(r[9]), Number(r[10]), Number(r[11]), String(r[15] == null ? '' : r[15])]; });
    } else if (level === 'lots') {
      head = ['Account', 'Ticker', 'Market', 'Instrument Name', 'Currency', 'Buy Date', 'Days Held', 'Buy Price', 'Quantity', 'Actual Price', 'Total Cost', 'Total Actual', 'P/L', 'P/L %', 'Value EUR', 'Quote Time', 'Price Status', 'Lot ID', 'Note'];
      rows = [];
      const notes = readNotes_().owned;
      readPositions_().filter(function (r) { return !acc || r.account.toLowerCase() === acc; }).forEach(function (r) {
        r.lots.forEach(function (l) { rows.push([r.account, r.ticker, r.market, r.name, r.currency, l.buyDate, l.daysHeld, l.buyPrice, l.qty, r.price, l.totalCost, l.totalActual, l.pl, l.plPct, l.valueEur, r.quoteTime, r.pstatus, l.lotId, notes[noteKey_(r.ticker, r.account)] || '']); });
      });
    } else {
      head = ['Account', 'Ticker', 'Market', 'Instrument Name', 'Currency', 'First Buy', 'Last Buy', 'Lots', 'Average Buy Price', 'Quantity', 'Actual Price', 'Total Cost', 'Total Actual', 'P/L', 'P/L %', 'Value EUR', 'Quote Time', 'Price Status', 'Note'];
      const notes = readNotes_().owned;
      rows = readPositions_().filter(function (r) { return !acc || r.account.toLowerCase() === acc; })
        .map(function (r) { return [r.account, r.ticker, r.market, r.name, r.currency, r.buyDate, r.lastBuyDate, r.lotCount, r.buyPrice, r.qty, r.price, r.totalCost, r.totalActual, r.pl, r.plPct, r.valueEur, r.quoteTime, r.pstatus, notes[noteKey_(r.ticker, r.account)] || '']; });
    }
    const lines = [head.join(sep)].concat(rows.map(function (r) { return r.map(function (v) { return csvCell_(v, sep, dec); }).join(sep); }));
    const stamp = kind === 'sold' ? (yr || 'all-years') : todayIso_();
    const name = (kind === 'sold' ? 'sold_' : (level === 'lots' ? 'owned-lots_' : 'owned_')) + (account ? String(account).replace(/[^A-Za-z0-9]+/g, '-') : 'all-accounts') + '_' + stamp + '.csv';
    return ok({ filename: name, csv: '\uFEFF' + lines.join('\r\n') + '\r\n', rows: rows.length }, rows.length + ' row(s)');
  });
}
