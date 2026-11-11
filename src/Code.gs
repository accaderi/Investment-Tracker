/**
 * Investment Portfolio Tracker — Google Apps Script web app (spec v1.6-S.1)
 *
 * Code.gs   : constants, one-time setup, web-app entry, API exposed to the browser, simple business rules (incl. getSymbols, searchOnline)
 * Data.gs   : sheet access, getMarketData (the ONLY price read path), syncTracked, FX, derived fields
 * Market.gs : Yahoo fetch, sanity checks, resolveInstrument, scheduled refresh
 * TestMode.gs (optional, Appendix D): Google-vs-Yahoo comparison. Delete after testing.
 */

// ---------------------------------------------------------------- constants
const SHEETS = { OWNED: 'Owned', WATCH: 'Watchlist', SOLD: 'Sold', SCHED: 'Schedule', LOG: 'Log', CONFIG: 'Config', SYMBOLS: 'Symbols', ACCOUNTS: 'Accounts', CASHLOG: 'CashLog', HISTORY: 'History', INST: 'Instruments', FX: 'FxRates', NOTES: 'Notes' };

const INST_HEADERS = ['Internal Ticker', 'Market', 'Instrument Name', 'Quote Currency', 'Major Currency', 'Price Divisor', 'Source',
  'Google Symbol', 'Yahoo Symbol', 'Live Price', 'Live Prev Close', 'Live 52w High', 'Live 52w Low', 'Live Currency', 'Live Trade Time',
  'Price', 'Prev Close', '52w High', '52w Low', 'Quote Time', 'Updated At', 'Status', 'Writer', 'Tracked'];

// 0-based column indexes of the Instruments tab (A..X, spec 3.7). Column H = Google Symbol.
const IC = { TICKER: 0, MARKET: 1, NAME: 2, QCCY: 3, MCCY: 4, DIV: 5, SRC: 6, GSYM: 7, YSYM: 8,
  LPRICE: 9, LPREV: 10, LHIGH: 11, LLOW: 12, LCCY: 13, LTIME: 14,
  PRICE: 15, PREV: 16, HIGH: 17, LOW: 18, QTIME: 19, UPD: 20, STATUS: 21, WRITER: 22, TRACKED: 23 };
const NCOL = 24;

const HEADERS = {
  Owned: ['Ticker', 'Market', 'Instrument Name', 'Currency', 'Buy Date', 'Last Buy Date', 'Buy Price', 'Quantity', 'Account', 'Lot ID'],   // one row = one lot
  Watchlist: ['Ticker', 'Market', 'Instrument Name', 'Currency', 'Status'],
  Sold: ['Ticker', 'Market', 'Instrument Name', 'Currency', 'Buy Date', 'Buy Price', 'Sell Date', 'Sell Price', 'Sold Qty', 'Realized P/L', 'FX Rate at Sale', 'Realized P/L (EUR)', 'Account', 'Lot ID', 'Sale ID', 'Note'],
  Notes: ['List', 'Ticker', 'Account', 'Note', 'Updated At'],
  Log: ['Timestamp', 'Action', 'Details', 'Status'],
  Symbols: ['Ticker', 'Name', 'Market', 'Yahoo Symbol', 'Added At'],
  Accounts: ['Account', 'Added At', 'Cash', 'Cash Currency', 'Cash Updated'],
  CashLog: ['Timestamp', 'Account', 'Change', 'Currency', 'Balance After', 'Reason', 'Details'],
  History: ['Date', 'Account', 'Value EUR', 'Unrealised P/L EUR', 'Positions', 'Missing', 'Recorded At'],
  FxRates: ['Pair', 'Live', 'Rate', 'Updated At', 'Status']
};

const CONFIG_DEFAULTS = {
  baseCurrency: 'EUR', showHuf: true, yahooFetcher: 'GAS', sanityTolerancePct: 5, maxDailyMovePct: 40, staleQuoteDays: 5,
  refreshNowMinIntervalSec: 60, googleMaxAgeHours: 30, googleLagMinutes: 60, liveReadRetries: 3, lastSuccessfulRefresh: '',
  alertEmail: '', alertAfterHours: 26
};
// Accounts created by setup() the first time (rename/add/remove them later in the app). Legacy rows without an account show as 'Main'.
const DEFAULT_ACCOUNTS = ['Main'];
const DEFAULT_ACCOUNT = 'Main';
const CONFIG_NOTES = {
  baseCurrency: 'Informational in v1 (EUR is fixed)', showHuf: 'TRUE/FALSE: show HUF totals in the UI',
  yahooFetcher: 'GAS = this script fetches Yahoo | VM = external refresher owns Yahoo rows | OFF = no Yahoo calls',
  sanityTolerancePct: 'Allowed % outside the 52-week range before a quote is Suspect', maxDailyMovePct: 'Price vs previous close change above this % is Suspect',
  staleQuoteDays: 'Quote older than this many days is Stale', refreshNowMinIntervalSec: 'Minimum seconds between manual refreshes',
  googleMaxAgeHours: 'Google quote age that triggers the Yahoo cross-check', googleLagMinutes: 'How much newer Yahoo must be to override Google',
  liveReadRetries: 'Retries (2 s apart) for GOOGLEFINANCE cells showing Loading...', lastSuccessfulRefresh: 'Written by the app',
  alertEmail: 'Leave blank = no alerts. An address, or the word me, to get an email when refreshes stop', alertAfterHours: 'Alert when the last successful refresh is older than this many hours (weekends skipped if Schedule is weekdays-only)'
};

// ---------------------------------------------------------------- result helpers (spec 4.5)
function ok(data, message) { return { success: true, message: message || '', data: data === undefined ? null : data }; }
function fail(message, data) { return { success: false, message: String(message), data: data === undefined ? null : data }; }

function api(fn) {
  return function () {
    try { return fn.apply(null, arguments); }
    catch (e) { logAction('Error', String((e && e.message) || e), 'Error'); return fail((e && e.message) || e); }
  };
}
function guard_(fn) { return api(fn)(); }

function withLock(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return fail('Busy, try again');
  try { return fn(); } finally { lock.releaseLock(); }
}

function isValidNum(v) { return typeof v === 'number' && isFinite(v) && v > 0; }

// ---------------------------------------------------------------- spreadsheet access
let _ss = null, _cfg = null;
function ss_() {
  if (_ss) return _ss;
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  _ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!_ss) throw new Error('Spreadsheet not found. Open the script from the sheet (Extensions > Apps Script) and run setup().');
  return _ss;
}
function sh_(name) {
  const s = ss_().getSheetByName(name);
  if (!s) throw new Error('Missing sheet "' + name + '". Run setup() from the Apps Script editor.');
  return s;
}
function tz_() { return Session.getScriptTimeZone(); }
function isDate_(v) { return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime()); }
function isoDate_(v) { return isDate_(v) ? Utilities.formatDate(v, tz_(), 'yyyy-MM-dd') : (typeof v === 'string' ? v : ''); }
function fmtDateTime_(v) { return isDate_(v) ? Utilities.formatDate(v, tz_(), 'yyyy-MM-dd HH:mm') : ''; }
function todayIso_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function toDate_(iso) { const p = String(iso).split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
function r6_(x) { return Math.round(x * 1e6) / 1e6; }
function r8_(x) { return Math.round(x * 1e8) / 1e8; }

function readTab_(name, ncol) {
  const s = sh_(name), n = s.getLastRow() - 1;
  return n > 0 ? s.getRange(2, 1, n, ncol).getValues() : [];
}
function findRow_(tab, ticker, ncol) {
  const s = sh_(tab), n = s.getLastRow() - 1;
  if (n < 1) return null;
  const vals = s.getRange(2, 1, n, ncol).getValues();
  for (let i = 0; i < vals.length; i++) if (vals[i][0] === ticker) return { row: i + 2, v: vals[i], sheet: s };
  return null;
}

function getConfig_() {
  if (_cfg) return _cfg;
  const cfg = Object.assign({}, CONFIG_DEFAULTS);
  const s = ss_().getSheetByName(SHEETS.CONFIG);
  if (s && s.getLastRow() > 1) {
    s.getRange(2, 1, s.getLastRow() - 1, 2).getValues().forEach(function (r) {
      const k = String(r[0]).trim();
      if (!(k in CONFIG_DEFAULTS) || r[1] === '' || r[1] === null) return;
      const d = CONFIG_DEFAULTS[k];
      if (typeof d === 'number') { const n = Number(r[1]); if (isFinite(n)) cfg[k] = n; }
      else if (typeof d === 'boolean') cfg[k] = (r[1] === true || String(r[1]).toLowerCase() === 'true');
      else cfg[k] = isDate_(r[1]) ? fmtDateTime_(r[1]) : String(r[1]);
    });
  }
  cfg.yahooFetcher = String(cfg.yahooFetcher).toUpperCase();
  return (_cfg = cfg);
}
function setConfigValue_(key, value) {
  const s = sh_(SHEETS.CONFIG), n = s.getLastRow() - 1;
  const keys = n > 0 ? s.getRange(2, 1, n, 1).getValues().map(function (r) { return r[0]; }) : [];
  const i = keys.indexOf(key);
  if (i >= 0) s.getRange(i + 2, 2).setValue(value); else s.appendRow([key, value, CONFIG_NOTES[key] || '']);
  _cfg = null;
}

function logAction(action, details, status) {
  try { sh_(SHEETS.LOG).appendRow([new Date(), action, String(details).slice(0, 2000), status || 'Success']); }
  catch (e) { console.error('logAction failed: ' + e); }
}

// ---------------------------------------------------------------- web app entry
function doGet() {
  return HtmlService.createTemplateFromFile('index').evaluate()
    .setTitle('Investment Tracker')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

// ---------------------------------------------------------------- one-time setup (run from the editor)
function setup() { setupSpreadsheet(); installTriggers(); return 'Setup complete'; }

function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Run setup() from a script opened via the sheet: Extensions > Apps Script.');
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  _ss = ss; _cfg = null;
  ss.setSpreadsheetTimeZone(tz_());                          // the sheet follows the script's time zone (appsscript.json)

  const ensure = function (name, headers) {
    let s = ss.getSheetByName(name);
    if (!s) s = ss.insertSheet(name);
    if (headers && s.getLastRow() === 0) {
      s.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e8eef7');
      s.setFrozenRows(1);
    }
    return s;
  };
  const owned = ensure(SHEETS.OWNED, HEADERS.Owned), watch = ensure(SHEETS.WATCH, HEADERS.Watchlist),
    sold = ensure(SHEETS.SOLD, HEADERS.Sold), sched = ensure(SHEETS.SCHED), log = ensure(SHEETS.LOG, HEADERS.Log),
    conf = ensure(SHEETS.CONFIG), symb = ensure(SHEETS.SYMBOLS, HEADERS.Symbols), accts = ensure(SHEETS.ACCOUNTS, HEADERS.Accounts),
    hist = ensure(SHEETS.HISTORY, HEADERS.History), cashlog = ensure(SHEETS.CASHLOG, HEADERS.CashLog), inst = ensure(SHEETS.INST, INST_HEADERS), fx = ensure(SHEETS.FX, HEADERS.FxRates),
    notes = ensure(SHEETS.NOTES, HEADERS.Notes);
  if (sold.getMaxColumns() < SOLD_COLS) sold.insertColumnsAfter(sold.getMaxColumns(), SOLD_COLS - sold.getMaxColumns());
  ensureHeaders_(owned, HEADERS.Owned); ensureHeaders_(sold, HEADERS.Sold); ensureHeaders_(accts, HEADERS.Accounts);          // upgrade: adds the Account / Lot ID / Sale ID / Note columns to an older sheet
  ensureLotIds_();                                                                  // existing holdings become one opening lot each
  ensureSaleIds_();                                                                 // existing sales get a Sale ID (the Note column needs it)

  owned.getRange(2, 5, 1000, 2).setNumberFormat('yyyy-mm-dd');
  sold.getRange(2, 5, 1000, 1).setNumberFormat('yyyy-mm-dd');
  sold.getRange(2, 7, 1000, 1).setNumberFormat('yyyy-mm-dd');
  log.getRange(2, 1, 2000, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  inst.getRange(2, IC.LTIME + 1, 1000, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  inst.getRange(2, IC.QTIME + 1, 1000, 2).setNumberFormat('yyyy-mm-dd hh:mm');
  fx.getRange(2, 4, 100, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  symb.getRange(2, 5, 5000, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  accts.getRange(2, 2, 200, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  accts.getRange(2, 3, 200, 1).setNumberFormat('#,##0.00');
  accts.getRange(2, 5, 200, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  cashlog.getRange(2, 1, 5000, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  cashlog.getRange(2, 3, 5000, 1).setNumberFormat('#,##0.00');
  cashlog.getRange(2, 5, 5000, 1).setNumberFormat('#,##0.00');
  hist.getRange(2, 1, 20000, 1).setNumberFormat('yyyy-mm-dd');
  hist.getRange(2, 7, 20000, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  notes.getRange(2, 1, 5000, 4).setNumberFormat('@');
  notes.getRange(2, 5, 5000, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  notes.setColumnWidth(4, 460);
  sold.getRange(2, 15, 5000, 2).setNumberFormat('@');
  sold.protect().setWarningOnly(true).setDescription('Sold history is read-only; edit only to correct mistakes.');

  if (conf.getLastRow() === 0) {
    conf.getRange(1, 1, 1, 3).setValues([['Key', 'Value', 'Notes']]).setFontWeight('bold').setBackground('#e8eef7');
    conf.setFrozenRows(1);
    conf.getRange('B2:B100').setNumberFormat('@');
  }
  const have = {};
  readTab_(SHEETS.CONFIG, 1).forEach(function (r) { have[r[0]] = true; });
  Object.keys(CONFIG_DEFAULTS).forEach(function (k) {
    if (!have[k]) conf.appendRow([k, k === 'lastSuccessfulRefresh' ? '' : CONFIG_DEFAULTS[k], CONFIG_NOTES[k] || '']);
  });

  if (sched.getLastRow() === 0) {
    sched.getRange('A1:B1').setValues([['Weekdays Only', true]]);
    sched.getRange('B1').insertCheckboxes();
    sched.getRange('A3:B3').setValues([['Hour (0-23, ' + tz_() + ' time)', 'Run?']]).setFontWeight('bold').setBackground('#e8eef7');
    const seed = [10, 14, 16, 18, 20, 22], rows = [];
    for (let h = 0; h < 24; h++) rows.push([h, seed.indexOf(h) >= 0]);
    sched.getRange(4, 1, 24, 2).setValues(rows);
    sched.getRange(4, 2, 24, 1).insertCheckboxes();
  }

  if (fx.getLastRow() < 2) ['USDEUR', 'GBPEUR', 'EURHUF'].forEach(ensureFxRow_);
  if (accts.getLastRow() < 2) DEFAULT_ACCOUNTS.forEach(function (n) { accts.appendRow([n, new Date()]); });
  if (symb.getLastRow() < 2) {                               // CR-1: seed once; the tab then grows by itself
    const seed = seedSymbols_(), nowTs = new Date();
    symb.getRange(2, 1, seed.length, 5).setValues(seed.map(function (x) { return [x.ticker, x.name, x.market, '', nowTs]; }));
  }

  const stale = ss.getSheetByName('Sheet1');
  if (stale && stale.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(stale);
  inst.hideSheet(); fx.hideSheet();
  logAction('Setup', 'Spreadsheet structure verified', 'Success');
}

function ensureHeaders_(s, headers) {
  const cur = s.getRange(1, 1, 1, headers.length).getValues()[0];
  headers.forEach(function (h, i) { if (cur[i] === '' || cur[i] === null) s.getRange(1, i + 1).setValue(h).setFontWeight('bold').setBackground('#e8eef7'); });
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const h = t.getHandlerFunction();
    if (h === 'refreshMarketData' || h === 'dailyJob') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('refreshMarketData').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(23).create();      // daily value snapshot + health check
}

// ---------------------------------------------------------------- validation helpers
function normTicker_(t) {
  const s = String(t || '').trim().toUpperCase();
  if (!parseTicker_(s)) throw new Error('Ticker must look like EXCHANGE:SYMBOL, e.g. NASDAQ:GOOGL or ETR:2B70.');
  return s;
}
function posNum_(v, label) {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || !isFinite(n) || n <= 0) throw new Error(label + ' must be a number greater than 0.');
  return n;
}
function pastDate_(v, label) {
  const s = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(label + ' is required (YYYY-MM-DD).');
  if (isoDate_(toDate_(s)) !== s) throw new Error(label + ' is not a valid date.');
  if (s > todayIso_()) throw new Error(label + ' cannot be in the future.');
  return s;
}
/** Spec 4.4: Owned XOR Watchlist, keyed on the full EXCHANGE:SYMBOL. Returns null when allowed. */
function validateTickerUniqueness(ticker, target) {
  const inOwned = findRow_(SHEETS.OWNED, ticker, 9), inWatch = findRow_(SHEETS.WATCH, ticker, 5);
  if (target === SHEETS.WATCH) {
    if (inOwned) return { code: 'ON_OWNED', message: ticker + ' is already in Owned. A listing cannot be on both Owned and Watchlist.' };
    if (inWatch) return { code: 'DUPLICATE', message: ticker + ' is already on the Watchlist.' };
  }
  if (target === SHEETS.OWNED && inWatch) return { code: 'ON_WATCHLIST', message: ticker + ' is on your Watchlist. Move it to Owned instead?' };
  return null;
}
/** Make sure an Instruments row exists (re-resolves if it was cleaned up). Call OUTSIDE the lock. */
function ensureResolved_(ticker, yahooOverride) {
  if (findInst_(ticker)) return;
  const r = withLock(function () {
    try { return ok(resolveInstrument_(ticker, yahooOverride)); } catch (e) { return fail(e.message); }
  });
  if (!r.success) throw new Error(r.message);
}
function requireInst_(ticker) {
  const i = findInst_(ticker);
  if (!i) throw new Error('Instrument ' + ticker + ' is not resolved. Please try again.');
  return i;
}
function applyName_(inst, name) {
  const n = String(name || '').trim();
  if (n && n !== inst.name) { sh_(SHEETS.INST).getRange(inst.row, IC.NAME + 1).setValue(n); inst.name = n; }
  return inst.name;
}

// ---------------------------------------------------------------- API: reads
function getWatchlistData() {
  return guard_(function () {
    const cfg = getConfig_(), insts = readInstruments_(), notes = readNotes_().watch;
    const rows = readTab_(SHEETS.WATCH, 5).map(function (r) {
      const md = getMarketData(r[0], { instruments: insts, cfg: cfg }), inst = insts.filter(function (i) { return i.ticker === r[0]; })[0];
      const chg = (md.price !== null && md.prevClose !== null) ? md.price - md.prevClose : null;
      return { ticker: r[0], ysym: yahooSymbolFor_(r[0], inst), market: r[1], name: r[2], currency: r[3], wstatus: r[4], price: md.price, change: chg,
        changePct: chg !== null ? chg / md.prevClose * 100 : null, high52: md.high52, low52: md.low52,
        quoteTime: md.quoteTime, pstatus: md.status, source: md.source, writer: md.writer, note: notes[String(r[0]).toUpperCase()] || '' };
    });
    return ok({ rows: rows });
  });
}
function getSoldData() {
  return guard_(function () {
    const fx = readFx_(), onList = {}, insts = readInstruments_();
    readTab_(SHEETS.OWNED, 1).forEach(function (r) { onList[r[0]] = true; });
    readTab_(SHEETS.WATCH, 1).forEach(function (r) { onList[r[0]] = true; });
    if (readSoldRows_().some(function (r) { return !r[14]; })) withLock(function () { ensureSaleIds_(); return ok(); });          // first load after an upgrade: every sale gets its Sale ID
    const rows = readSoldRows_().map(function (r) {
      return { ticker: r[0], ysym: yahooSymbolFor_(r[0], insts.filter(function (i) { return i.ticker === r[0]; })[0]), market: r[1], name: r[2], currency: r[3], buyDate: isoDate_(r[4]), buyPrice: Number(r[5]), sellDate: isoDate_(r[6]),
        sellPrice: Number(r[7]), qty: Number(r[8]), realized: Number(r[9]), fx: Number(r[10]), realizedEur: Number(r[11]), account: acct_(r[12]), canWatch: !onList[r[0]],
        saleId: String(r[14] || ''), note: String(r[15] == null ? '' : r[15]).trim() };
    });
    return ok({ rows: rows, totals: { eurhuf: fxRate_('EURHUF', fx) }, accounts: allAccountNames_() });
  });
}
function getLogData() {
  return guard_(function () {
    const rows = readTab_(SHEETS.LOG, 4).map(function (r) {
      return { time: isDate_(r[0]) ? Utilities.formatDate(r[0], tz_(), 'yyyy-MM-dd HH:mm:ss') : String(r[0]), action: r[1], details: r[2], status: r[3] };
    });
    return ok({ rows: rows.reverse().slice(0, 1000) });
  });
}
/** CR-1: the whole Symbols tab, loaded once by the page and filtered on the client. Falls back to the seed list if the tab is missing or empty. */
function getSymbols() { return guard_(function () { return ok(readSymbols_()); }); }

const ONLINE_UNAVAILABLE = 'Online search unavailable, type the ticker manually';
/** CR-1: optional Yahoo symbol search. Never required: typing EXCHANGE:SYMBOL always works. Results (and failures) are cached. */
function searchOnline(query) {
  return guard_(function () {
    const q = String(query || '').trim().slice(0, 40);
    if (q.length < 2) return ok([]);
    const list = searchYahooCached_(q);
    return list === null ? fail(ONLINE_UNAVAILABLE) : ok(list);
  });
}
function resolveInstrument(ticker, yahooOverride) {
  return guard_(function () {
    return withLock(function () {
      const meta = resolveInstrument_(ticker, yahooOverride);
      return ok(meta, 'Resolved ' + meta.ticker + ' via ' + meta.source);
    });
  });
}

// ---------------------------------------------------------------- API: Owned / Watchlist mutations
// Owned rows are identified by ticker + account: one listing can be held in several accounts, but never on Owned AND Watchlist.

function acct_(v) { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return s || DEFAULT_ACCOUNT; }   // legacy blank = Main
function validateOwnedInput_(d) {
  d = d || {};
  return { ticker: normTicker_(d.ticker), price: posNum_(d.buyPrice, 'Buy price'), qty: posNum_(d.quantity, 'Quantity'),
    date: pastDate_(d.buyDate, 'Buy date'), account: accountInput_(d.account) };
}

function addOwnedRow(data) {
  return guard_(function () {
    const p = validateOwnedInput_(data);
    ensureResolved_(p.ticker, data && data.yahooSymbol);
    return withLock(function () { return addOwnedCore_(p, data, false, !(data && data.deductCash === false)); });
  });
}

function addWatchCore_(ticker, name, note) {
  const u = validateTickerUniqueness(ticker, SHEETS.WATCH);
  if (u) return fail(u.message, { code: u.code });
  const text = cleanNote_(note), inst = requireInst_(ticker), nm = applyName_(inst, name);
  sh_(SHEETS.WATCH).appendRow([ticker, inst.market, nm, inst.qccy, 'Active']);
  setNote_('watch', ticker, '', text);                                       // also clears a stale note left by an earlier entry of this ticker
  recordSymbol_(inst, nm);
  syncTracked_();
  logAction('Add ticker', 'Watchlist ' + ticker);
  return ok({ ticker: ticker }, 'Added ' + ticker + ' to Watchlist');
}
function addWatchlistRow(data) {
  return guard_(function () {
    data = data || {};
    const ticker = normTicker_(data.ticker);
    cleanNote_(data.note);                                                    // a too-long note is refused before anything is resolved or written
    ensureResolved_(ticker, data.yahooSymbol);
    return withLock(function () { return addWatchCore_(ticker, data.name, data.note); });
  });
}

/** ownedNote: text for the new Owned note; leave it out (or null) to carry the Watchlist note over unchanged. */
function moveWatchlistToOwned(ticker, buyPrice, buyDate, quantity, account, deductCash, ownedNote) {
  return guard_(function () {
    ticker = String(ticker || '').trim();
    const p = validateOwnedInput_({ ticker: ticker, buyPrice: buyPrice, buyDate: buyDate, quantity: quantity, account: account });
    const carry = ownedNote == null ? null : cleanNote_(ownedNote);
    return withLock(function () {
      const w = findRow_(SHEETS.WATCH, ticker, 5);
      if (!w) return fail(ticker + ' is not on the Watchlist.');
      if (findRow_(SHEETS.OWNED, ticker, 9)) return fail(ticker + ' is already in Owned.');
      const r = addOwnedCore_(p, { name: w.v[2], note: carry }, true, deductCash !== false);
      if (r.success) logAction('Add ticker', 'Moved ' + ticker + ' Watchlist -> Owned [' + p.account + ']');
      return r.success ? ok(r.data, 'Moved ' + ticker + ' to Owned (' + p.account + ').' + cashNote_(r.data.cash)) : r;
    });
  });
}

function toggleWatchlistStatus(ticker) {
  return guard_(function () {
    return withLock(function () {
      const w = findRow_(SHEETS.WATCH, String(ticker), 5);
      if (!w) return fail('Not on the Watchlist.');
      const next = w.v[4] === 'Active' ? 'Paused' : 'Active';
      w.sheet.getRange(w.row, 5).setValue(next);
      syncTracked_();
      logAction('Toggle watchlist', ticker + ' -> ' + next);
      return ok({ status: next }, ticker + ' is now ' + next);
    });
  });
}

function removeAllPaused() {
  return guard_(function () {
    return withLock(function () {
      const s = sh_(SHEETS.WATCH), vals = readTab_(SHEETS.WATCH, 5);
      let n = 0;
      for (let i = vals.length - 1; i >= 0; i--) if (vals[i][4] === 'Paused') { setNote_('watch', vals[i][0], '', ''); s.deleteRow(i + 2); n++; }
      syncTracked_();
      logAction('Remove paused', n + ' paused row(s) removed');
      return ok({ removed: n }, n + ' paused row(s) removed');
    });
  });
}

function deleteWatchlistRow(ticker) {
  return guard_(function () {
    return withLock(function () {
      const f = findRow_(SHEETS.WATCH, String(ticker), 5);
      if (!f) return fail(ticker + ' not found.');
      f.sheet.deleteRow(f.row);
      setNote_('watch', String(ticker), '', '');                                   // its note goes with it
      syncTracked_();
      logAction('Delete watchlist', ticker);
      return ok(null, 'Deleted ' + ticker);
    });
  });
}

function addSoldToWatchlist(ticker) {
  return guard_(function () {
    ticker = String(ticker || '').trim();
    if (findRow_(SHEETS.OWNED, ticker, 9) || findRow_(SHEETS.WATCH, ticker, 5)) return fail(ticker + ' is already on Owned or Watchlist.');
    ensureResolved_(ticker);
    return withLock(function () {
      const inst = requireInst_(ticker);
      sh_(SHEETS.WATCH).appendRow([ticker, inst.market, inst.name, inst.qccy, 'Active']);
      recordSymbol_(inst, inst.name);
      syncTracked_();
      logAction('Add ticker', 'Watchlist (from Sold) ' + ticker);
      return ok(null, 'Added ' + ticker + ' to Watchlist');
    });
  });
}

// ---------------------------------------------------------------- API: refresh info, schedule, maintenance
function refreshNow() {
  return guard_(function () {
    const cfg = getConfig_(), cache = CacheService.getScriptCache(), last = Number(cache.get('refreshNowTs') || 0);
    const wait = Math.ceil(cfg.refreshNowMinIntervalSec - (Date.now() - last) / 1000);
    if (last && wait > 0) return fail('Please wait ' + wait + ' s before refreshing again.', { retryAfter: wait });
    cache.put('refreshNowTs', String(Date.now()), Math.max(cfg.refreshNowMinIntervalSec, 1));
    const sum = runRefresh_(true);
    return sum.skipped ? fail(sum.message) : ok(sum, sum.message);
  });
}

function getRefreshInfo() {
  return guard_(function () {
    const cfg = getConfig_(), sc = readSchedule_(), runs = [], now = new Date();
    if (sc.hours.some(function (h) { return h.run; })) {
      const start = new Date(Math.floor(now.getTime() / 3600000) * 3600000);
      for (let k = 1; k <= 24 * 8 && runs.length < 3; k++) {
        const d = new Date(start.getTime() + k * 3600000);
        const h = Number(Utilities.formatDate(d, tz_(), 'H')), wd = Number(Utilities.formatDate(d, tz_(), 'u'));
        if (sc.hours[h].run && !(sc.weekdaysOnly && wd >= 6)) runs.push(Utilities.formatDate(d, tz_(), 'EEE HH:00'));
      }
    }
    return ok({ lastSuccessfulRefresh: cfg.lastSuccessfulRefresh, nextRuns: runs, cooldownSec: cfg.refreshNowMinIntervalSec, timeZone: tz_() });
  });
}

function readSchedule_() {
  const s = sh_(SHEETS.SCHED), wk = s.getRange('B1').getValue();
  const vals = s.getRange(4, 1, 24, 2).getValues();
  const hours = [];
  for (let h = 0; h < 24; h++) hours.push({ hour: h, run: false });
  vals.forEach(function (r) { const h = Number(r[0]); if (h >= 0 && h <= 23) hours[h].run = r[1] === true; });
  return { weekdaysOnly: wk === true, hours: hours, timeZone: tz_() };
}
function getSchedule() { return guard_(function () { return ok(readSchedule_()); }); }
function saveSchedule(data) {
  return guard_(function () {
    if (!data || !data.hours || data.hours.length !== 24) throw new Error('Invalid schedule data.');
    return withLock(function () {
      const s = sh_(SHEETS.SCHED);
      s.getRange('B1').setValue(data.weekdaysOnly === true);
      s.getRange(4, 1, 24, 2).setValues(data.hours.map(function (h, i) { return [i, h.run === true]; }));
      const on = data.hours.filter(function (h) { return h.run; }).length;
      logAction('Schedule', on + ' hour(s) enabled, weekdays only = ' + (data.weekdaysOnly === true));
      return ok(readSchedule_(), 'Schedule saved');
    });
  });
}

function clearLog() {
  return guard_(function () {
    return withLock(function () {
      const s = sh_(SHEETS.LOG), n = s.getLastRow() - 1;
      if (n > 0) s.deleteRows(2, n);
      return ok(null, 'Log cleared');
    });
  });
}

/**
 * Year rollover. Copies the whole spreadsheet to "Investment_<year>" and then starts the new year by clearing
 * Sold (realised history) and Log. Open positions (Owned) and the Watchlist are KEPT.
 * (Spec 10.3 says "reset Owned/Watchlist", which would erase live holdings; see the installation guide.)
 */
function archiveYear(year) {
  return guard_(function () {
    const y = Number(year) || new Date().getFullYear();
    if (y < 2000 || y > 2100) throw new Error('Invalid year.');
    return withLock(function () {
      const copy = ss_().copy('Investment_' + y);
      const sold = sh_(SHEETS.SOLD), log = sh_(SHEETS.LOG);
      if (sold.getLastRow() > 1) sold.deleteRows(2, sold.getLastRow() - 1);
      if (log.getLastRow() > 1) log.deleteRows(2, log.getLastRow() - 1);
      logAction('Archive year', 'Copied to Investment_' + y + '; Sold and Log cleared');
      return ok({ url: copy.getUrl() }, 'Archived to Investment_' + y + '. Sold and Log were cleared.');
    });
  });
}
