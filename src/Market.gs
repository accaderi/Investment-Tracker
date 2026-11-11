/**
 * Market.gs — exchange/Yahoo mapping, fetchYahoo, sanityCheck, resolveInstrument, scheduled refresh.
 */

// Appendix C. Internal tickers use Google-style prefixes (EXCHANGE:SYMBOL).
const US_ = { market: 'US', ysuffix: '', dashDots: true };
const EXCHANGES = {
  NASDAQ: US_, NYSE: US_, NYSEARCA: US_, NYSEAMERICAN: US_, OTCMKTS: US_,
  ETR: { market: 'DE', ysuffix: '.DE' }, LON: { market: 'UK', ysuffix: '.L' }, EPA: { market: 'FR', ysuffix: '.PA' },
  AMS: { market: 'NL', ysuffix: '.AS' }, BIT: { market: 'IT', ysuffix: '.MI' }, BME: { market: 'ES', ysuffix: '.MC' },
  VIE: { market: 'AT', ysuffix: '.VI' }, TSE: { market: 'CA', ysuffix: '.TO', dashDots: true },
  SWX: { market: 'CH', ysuffix: '.SW' }, STO: { market: 'SE', ysuffix: '.ST' }, CPH: { market: 'DK', ysuffix: '.CO' },
  BUD: { market: 'HU', ysuffix: '.BD', noGoogle: true }        // Google does not recognise Budapest (Appendix A)
};

function parseTicker_(t) {
  const m = /^([A-Z]+):([A-Z0-9][A-Z0-9.\-_]*)$/.exec(String(t || ''));
  return m ? { exch: m[1], sym: m[2] } : null;
}
/** Suggestion only; verified at resolve time and then stored. Never derive Yahoo symbols at refresh time. */
function mapInternalToYahoo(ticker) {
  const p = parseTicker_(ticker), ex = p && EXCHANGES[p.exch];
  if (!ex) return '';
  return (ex.dashDots ? p.sym.replace(/\./g, '-') : p.sym) + ex.ysuffix;
}
function normalizeCcy_(c) {
  const s = String(c || '').trim();
  if (s === 'GBp' || s === 'GBX' || s === 'GBx') return 'GBX';
  return s.toUpperCase();
}
function majorCcy_(q) { return q === 'GBX' ? 'GBP' : q; }
function divisorForCcy_(q) { return q === 'GBX' ? 100 : 1; }

// ---------------------------------------------------------------- Yahoo (spec 5.3)
let _lastYahooCall = 0;
function fetchYahooOnce_(sym) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym).replace(/%3D/g, '=') + '?range=1d&interval=1d';
  let res;
  try { res = UrlFetchApp.fetch(url, { muteHttpExceptions: true }); }
  catch (e) { return { error: 'fetch failed: ' + String(e).slice(0, 80) }; }
  const code = res.getResponseCode(), body = res.getContentText();
  try {
    const m = JSON.parse(body).chart.result[0].meta;
    const price = Number(m.regularMarketPrice);
    if (!isValidNum(price)) return { error: code + ' no numeric price' };
    return { price: price, prevClose: numOrNull_(m.chartPreviousClose), high52: numOrNull_(m.fiftyTwoWeekHigh), low52: numOrNull_(m.fiftyTwoWeekLow),
      currency: m.currency, quoteTime: m.regularMarketTime ? new Date(m.regularMarketTime * 1000) : null,
      name: m.longName || m.shortName || '', notFound: false };
  } catch (e) {
    return { error: code + ' ' + String(body).slice(0, 80), notFound: code === 404 };
  }
}
/** One call + one retry after 5 s (not retried when Yahoo says the symbol does not exist). Calls are spaced 1 s apart. */
function fetchYahoo(sym) {
  const wait = 1000 - (Date.now() - _lastYahooCall);
  if (wait > 0) Utilities.sleep(wait);
  let r = fetchYahooOnce_(sym);
  if (r.error && !r.notFound) { Utilities.sleep(5000); r = fetchYahooOnce_(sym); }
  _lastYahooCall = Date.now();
  return r;
}

// ---------------------------------------------------------------- online symbol search (CR-1)
// US listings carry no Yahoo suffix, so the venue comes from Yahoo's exchange code. Everything else is mapped by suffix,
// derived from EXCHANGES so Appendix C stays the single source of truth.
const YAHOO_US_EXCH = { NMS: 'NASDAQ', NGM: 'NASDAQ', NCM: 'NASDAQ', NYQ: 'NYSE', PCX: 'NYSEARCA', ASE: 'NYSEAMERICAN', PNK: 'OTCMKTS', OQB: 'OTCMKTS', OQX: 'OTCMKTS' };

function mapYahooToInternal_(sym, exchCode) {
  sym = String(sym || '').trim().toUpperCase();
  if (!sym) return null;
  const dot = sym.lastIndexOf('.');
  let exch = null, base = sym;
  if (dot > 0) {                                           // suffix style: 2B70.DE, VOD.L, U-UN.TO, OTP.BD
    const sfx = sym.slice(dot);
    Object.keys(EXCHANGES).forEach(function (k) { if (EXCHANGES[k].ysuffix === sfx) exch = k; });
    base = sym.slice(0, dot);
  } else {                                                 // US style: venue from the exchange code
    exch = YAHOO_US_EXCH[String(exchCode || '').toUpperCase()] || null;
  }
  if (!exch) return null;
  if (EXCHANGES[exch].dashDots) base = base.replace(/-/g, '.');
  const internal = exch + ':' + base;
  if (!parseTicker_(internal) || mapInternalToYahoo(internal) !== sym) return null;   // round-trip guard
  return internal;
}

function mapSearchResults_(quotes) {
  const out = [], seen = {};
  quotes.forEach(function (q) {
    if (!q || (q.quoteType !== 'EQUITY' && q.quoteType !== 'ETF')) return;
    const t = mapYahooToInternal_(q.symbol, q.exchange);
    if (!t || seen[t]) return;
    seen[t] = true;
    out.push({ ticker: t, name: String(q.longname || q.shortname || q.symbol), market: EXCHANGES[parseTicker_(t).exch].market, yahoo: String(q.symbol).toUpperCase() });
  });
  return out.slice(0, 10);
}

/** One call to Yahoo's search endpoint. Throws on any failure (HTTP error, bad JSON, unexpected shape). */
function fetchYahooSearch_(q) {
  const url = 'https://query1.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(q) + '&quotesCount=10&newsCount=0&listsCount=0';
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InvestmentTracker/1.0)' } });
  if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode());
  const body = JSON.parse(res.getContentText());
  if (!body || !Array.isArray(body.quotes)) throw new Error('unexpected response');
  return mapSearchResults_(body.quotes);
}

/** Cached wrapper used by searchOnline and suggestListings. Returns a list, or null when Yahoo is unavailable (failures cached 60 s). */
function searchYahooCached_(q) {
  const cache = CacheService.getScriptCache(), key = 'srch:' + q.toLowerCase().replace(/\s+/g, ' ');
  const hit = cache.get(key);
  if (hit) { try { const c = JSON.parse(hit); return c.err ? null : c.list; } catch (e) { /* fall through to a fresh call */ } }
  let list = null;
  try { list = fetchYahooSearch_(q); }
  catch (e) { logAction('Search online', 'Failed for "' + q + '": ' + String((e && e.message) || e).slice(0, 150), 'Warning'); }
  cache.put(key, JSON.stringify(list === null ? { err: true } : { list: list }), list === null ? 60 : 300);
  return list;
}

// ---------------------------------------------------------------- sanity check (spec 5.6)
function sanityCheck(md, cfg) {
  if (!isValidNum(md.price)) return { ok: false, why: 'price not numeric' };
  const tol = cfg.sanityTolerancePct / 100;
  if (isValidNum(md.low52) && md.price < md.low52 * (1 - tol)) return { ok: false, why: 'below 52w low' };
  if (isValidNum(md.high52) && md.price > md.high52 * (1 + tol)) return { ok: false, why: 'above 52w high' };
  if (isValidNum(md.prevClose) && Math.abs(md.price / md.prevClose - 1) > cfg.maxDailyMovePct / 100) return { ok: false, why: 'daily move too large' };
  return { ok: true };
}

// ---------------------------------------------------------------- resolve (spec 5.4) — call inside the lock
function metaFromInst_(i) {
  const price = isValidNum(i.snap.price) ? i.snap.price : (isValidNum(i.live.price) ? i.live.price : null);
  return { ticker: i.ticker, market: i.market, name: i.name, currency: i.qccy, majorCurrency: i.mccy, divisor: i.divisor,
    source: i.source, yahooSymbol: i.ysym, price: price, status: i.snap.status || '' };
}

function resolveInstrument_(raw, yahooOverride) {
  const ticker = normTicker_(raw), cfg = getConfig_();
  const existing = findInst_(ticker);
  if (existing) return metaFromInst_(existing);
  const p = parseTicker_(ticker), ex = EXCHANGES[p.exch];
  if (!ex) throw new Error('Unknown exchange prefix "' + p.exch + '". Supported: ' + Object.keys(EXCHANGES).join(', ') + '.');
  const ysym = (yahooOverride && String(yahooOverride).trim()) || mapInternalToYahoo(ticker);
  const s = sh_(SHEETS.INST), now = new Date();
  let meta = null;

  // 1) probe Google. On success the probe row becomes the permanent row (formulas kept).
  if (!ex.noGoogle) {
    const row = s.getLastRow() + 1;
    let keep = false;
    try {
      s.getRange(row, IC.TICKER + 1).setValue(ticker);
      s.getRange(row, IC.SRC + 1).setValue('Google');
      s.getRange(row, IC.GSYM + 1).setValue(ticker);
      s.getRange(row, IC.LPRICE + 1, 1, 6).setFormulas([liveFormulas_(row)]);
      s.getRange(row, NCOL + 1).setFormula('=IFERROR(GOOGLEFINANCE($H' + row + ',"name"),"")');   // scratch cell for the name
      let v = null;
      for (let k = 0; k < Math.max(1, cfg.liveReadRetries); k++) {
        SpreadsheetApp.flush();
        Utilities.sleep(k === 0 ? 1000 : 2000);
        v = s.getRange(row, IC.LPRICE + 1, 1, 6).getValues()[0];             // J..O
        if (isValidNum(v[0])) break;
      }
      if (v && isValidNum(v[0])) {
        const qccy = normalizeCcy_(v[4]);
        if (!qccy) throw new Error('Google returned a price but no currency for ' + ticker + '.');
        let name = String(s.getRange(row, NCOL + 1).getValue() || '').trim();   // scratch cell (column Y)
        if (!name && ysym) { const y = fetchYahooOnce_(ysym); if (!y.error) name = y.name; }
        const md = { price: v[0], prevClose: isValidNum(v[1]) ? v[1] : null, high52: isValidNum(v[2]) ? v[2] : null, low52: isValidNum(v[3]) ? v[3] : null };
        const status = sanityCheck(md, cfg).ok ? (isDate_(v[5]) ? staleStatus_(v[5], cfg) : 'OK') : 'Suspect';
        s.getRange(row, IC.TICKER + 1, 1, 9).setValues([[ticker, ex.market, name || p.sym, qccy, majorCcy_(qccy), divisorForCcy_(qccy), 'Google', ticker, ysym]]);
        s.getRange(row, IC.PRICE + 1, 1, 9).setValues([[md.price, md.prevClose === null ? '' : md.prevClose, md.high52 === null ? '' : md.high52,
          md.low52 === null ? '' : md.low52, isDate_(v[5]) ? v[5] : '', now, status, 'PROBE', false]]);
        keep = true;
        meta = { ticker: ticker, market: ex.market, name: name || p.sym, currency: qccy, majorCurrency: majorCcy_(qccy), divisor: divisorForCcy_(qccy),
          source: 'Google', yahooSymbol: ysym, price: md.price, status: status };
      }
    } finally {
      try { s.getRange(row, NCOL + 1).clearContent(); } catch (e) { /* ignore */ }
      if (!keep) { try { s.deleteRow(row); } catch (e) { /* ignore */ } }
    }
  }

  // 2) probe Yahoo
  if (!meta) {
    if (!ysym) throw new Error('Cannot resolve this ticker from Google or Yahoo.');
    const y = fetchYahoo(ysym);
    if (y.error) throw new Error('Cannot resolve this ticker from Google or Yahoo (Yahoo symbol ' + ysym + ': ' + y.error + ').');
    const qccy = normalizeCcy_(y.currency);
    const status = sanityCheck(y, cfg).ok ? (y.quoteTime ? staleStatus_(y.quoteTime, cfg) : 'OK') : 'Suspect';
    const nm = y.name || p.sym, row = s.getLastRow() + 1;
    s.getRange(row, 1, 1, NCOL).setValues([[ticker, ex.market, nm, qccy, majorCcy_(qccy), divisorForCcy_(qccy), 'Yahoo', '', ysym, '', '', '', '', '', '',
      y.price, y.prevClose === null ? '' : y.prevClose, y.high52 === null ? '' : y.high52, y.low52 === null ? '' : y.low52, y.quoteTime || '', now, status, 'PROBE', false]]);
    meta = { ticker: ticker, market: ex.market, name: nm, currency: qccy, majorCurrency: majorCcy_(qccy), divisor: divisorForCcy_(qccy),
      source: 'Yahoo', yahooSymbol: ysym, price: y.price, status: status };
  }

  const m = meta.majorCurrency;
  if (m !== 'EUR' && m !== 'HUF') ensureFxRow_(m + 'EUR');
  ensureFxRow_('EURHUF');
  logAction('Resolve ticker', ticker + ' -> ' + meta.source + ', ' + meta.currency + (meta.source === 'Yahoo' ? ', ' + ysym : ''));
  return meta;
}

// ---------------------------------------------------------------- scheduled refresh (spec 6)
function shouldRunNow() {
  const sc = readSchedule_(), now = new Date();
  const hour = Number(Utilities.formatDate(now, tz_(), 'H')), wd = Number(Utilities.formatDate(now, tz_(), 'u'));
  if (sc.weekdaysOnly && wd >= 6) return false;
  return sc.hours[hour].run === true;
}

/** Hourly trigger entry point. Most invocations exit immediately. */
function refreshMarketData() {
  try {
    if (!shouldRunNow()) return;
    runRefresh_(false);
  } catch (e) { logAction('Refresh', String((e && e.message) || e), 'Error'); }
}

function crossCheckAllowed_(now) {
  const wd = Number(Utilities.formatDate(now, tz_(), 'u')), h = Number(Utilities.formatDate(now, tz_(), 'H'));
  return !(wd >= 6 || (wd === 1 && h < 12));       // skip Sat, Sun and Monday before 12:00
}

/** Rewrite the Live formulas so Google recalculates (spec 5.9.4). Uses the lock because it addresses rows by position. */
function nudgeFormulas_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return false;
  try {
    const s = sh_(SHEETS.INST), n = s.getLastRow() - 1;
    if (n > 0) {
      const src = s.getRange(2, IC.SRC + 1, n, 1).getValues();
      const f = src.map(function (r, i) { return r[0] === 'Google' ? liveFormulas_(i + 2) : ['', '', '', '', '', '']; });
      const rng = s.getRange(2, IC.LPRICE + 1, n, 6);
      rng.clearContent(); rng.setFormulas(f);
    }
    const fs = sh_(SHEETS.FX), m = fs.getLastRow() - 1;
    if (m > 0) {
      const fr = fs.getRange(2, 2, m, 1);
      fr.clearContent();
      fr.setFormulas(fs.getRange(2, 1, m, 1).getValues().map(function (r, i) { return ['=IFERROR(GOOGLEFINANCE("CURRENCY:"&A' + (i + 2) + '),"")']; }));
    }
    SpreadsheetApp.flush();
    return true;
  } finally { lock.releaseLock(); }
}

function runRefresh_(manual) {
  const cfg = getConfig_(), action = manual ? 'Refresh Now' : 'Refresh', now = new Date();
  const lk = LockService.getScriptLock();
  if (!lk.tryLock(10000)) { logAction(action, 'Could not get the lock; skipped (next run retries)', 'Warning'); return { skipped: true, message: 'Busy, try again.' }; }
  try { syncTracked_(); } finally { lk.releaseLock(); }

  let insts = readInstruments_().filter(function (i) { return i.tracked; });
  if (!insts.length) { logAction(action, 'Nothing to refresh', 'Success'); return { skipped: false, message: 'Nothing to refresh.', updated: 0 }; }

  const nudged = nudgeFormulas_();
  const hasGoogle = insts.some(function (i) { return i.source === 'Google'; });
  if (nudged && hasGoogle) {                                  // wait for Loading... cells
    for (let k = 0; k < cfg.liveReadRetries; k++) {
      Utilities.sleep(2000);
      const cur = readInstruments_().filter(function (i) { return i.tracked && i.source === 'Google'; });
      if (cur.every(function (i) { return isValidNum(i.live.price); })) break;
    }
  }
  insts = readInstruments_().filter(function (i) { return i.tracked; });

  const upd = {}, counts = { google: 0, yahoo: 0, cross: 0 }, flags = { Suspect: [], Stale: [], Error: [] };
  const yahooOn = cfg.yahooFetcher === 'GAS';
  const asMd = function (y) { return { price: y.price, prevClose: y.prevClose, high52: y.high52, low52: y.low52, quoteTime: y.quoteTime }; };

  insts.forEach(function (inst) {
    let cand = null, writer = 'GAS', forceStale = false, suspectWhy = '';
    if (inst.source === 'Google') {
      const ev = evaluateLive_(inst, cfg);
      if (ev.valid) {
        cand = ev.md; counts.google++;
        if (yahooOn && inst.ysym && crossCheckAllowed_(now) && ageHours_(cand.quoteTime) > cfg.googleMaxAgeHours) {
          const y = fetchYahoo(inst.ysym);
          if (y.error || !isDate_(y.quoteTime)) forceStale = true;              // Google behind and Yahoo unavailable
          else if (y.quoteTime.getTime() - cand.quoteTime.getTime() > cfg.googleLagMinutes * 60000 && sanityCheck(y, cfg).ok && normalizeCcy_(y.currency) === inst.qccy) {
            cand = asMd(y); writer = 'GAS-Yahoo'; counts.cross++;
            logAction('Refresh', 'Google quote stale for ' + inst.ticker + ', used Yahoo', 'Warning');
          }
        }
      } else {
        suspectWhy = ev.suspect ? ev.why : '';
        if (yahooOn && inst.ysym) {
          const y = fetchYahoo(inst.ysym);
          if (!y.error && normalizeCcy_(y.currency) === inst.qccy) { cand = asMd(y); writer = 'GAS-Yahoo'; counts.yahoo++; }
          else logAction('Fetch failed', inst.ticker + ': Google ' + (ev.why || 'unavailable') + '; Yahoo ' + (y.error || 'currency mismatch'), 'Warning');
        } else logAction('Fetch failed', inst.ticker + ': Google ' + (ev.why || 'unavailable'), 'Warning');
      }
    } else if (yahooOn) {
      const y = fetchYahoo(inst.ysym);
      if (!y.error && normalizeCcy_(y.currency) === inst.qccy) { cand = asMd(y); counts.yahoo++; }
      else { logAction('Fetch failed', inst.ticker + ': ' + (y.error || 'currency mismatch'), 'Warning'); }
    } else if (cfg.yahooFetcher === 'VM') {
      return;                                                                   // the VM owns this row
    }

    const u = { writer: writer, replace: false };
    if (cand) {
      const sc = sanityCheck(cand, cfg);
      if (sc.ok) {
        u.replace = true; u.md = cand;
        u.status = forceStale ? 'Stale' : (isDate_(cand.quoteTime) ? staleStatus_(cand.quoteTime, cfg) : 'OK');
      } else {
        u.status = 'Suspect';
        logAction('Sanity check', inst.ticker + ' quote rejected (' + sc.why + '); last good value kept', 'Warning');
      }
    } else {
      u.status = suspectWhy ? 'Suspect' : (isValidNum(inst.snap.price) ? 'Stale' : 'Error');
    }
    flags[u.status] && flags[u.status].push(inst.ticker);
    upd[inst.ticker] = u;
  });

  // FX: Live -> Yahoo XXXEUR=X -> keep last
  const fxUpd = {}, fx = readFx_();
  Object.keys(fx).forEach(function (pair) {
    const e = fx[pair];
    if (isValidNum(e.live)) { fxUpd[pair] = { rate: e.live, status: 'OK' }; return; }
    if (yahooOn) {
      const y = fetchYahoo(pair + '=X');
      if (!y.error) { fxUpd[pair] = { rate: y.price, status: 'OK' }; return; }
    }
    fxUpd[pair] = { rate: null, status: isValidNum(e.rate) ? 'Stale' : 'Error' };
  });

  // write phase: short lock, rows located by ticker, one batch
  const lk2 = LockService.getScriptLock();
  if (!lk2.tryLock(10000)) { logAction(action, 'Could not get the lock for the write phase; skipped', 'Warning'); return { skipped: true, message: 'Busy, try again.' }; }
  try {
    const s = sh_(SHEETS.INST), n = s.getLastRow() - 1;
    if (n > 0) {
      const tick = s.getRange(2, 1, n, 1).getValues(), blk = s.getRange(2, IC.PRICE + 1, n, 8).getValues();   // Price..Writer
      tick.forEach(function (r, i) {
        const u = upd[r[0]];
        if (!u) return;
        const b = blk[i], nv = function (v) { return v === null || v === undefined ? '' : v; };
        if (u.replace) { b[0] = u.md.price; b[1] = nv(u.md.prevClose); b[2] = nv(u.md.high52); b[3] = nv(u.md.low52); b[4] = u.md.quoteTime || ''; b[7] = u.writer; }
        b[5] = now; b[6] = u.status;
      });
      s.getRange(2, IC.PRICE + 1, n, 8).setValues(blk);
    }
    const fs = sh_(SHEETS.FX), m = fs.getLastRow() - 1;
    if (m > 0) {
      const fv = fs.getRange(2, 3, m, 3).getValues(), names = fs.getRange(2, 1, m, 1).getValues();   // Rate, Updated At, Status
      names.forEach(function (r, i) {
        const u = fxUpd[r[0]];
        if (!u) return;
        if (u.rate !== null) { fv[i][0] = u.rate; fv[i][1] = now; }
        fv[i][2] = u.status;
      });
      fs.getRange(2, 3, m, 3).setValues(fv);
    }
    setConfigValue_('lastSuccessfulRefresh', Utilities.formatDate(now, tz_(), 'yyyy-MM-dd HH:mm'));
  } finally { lk2.releaseLock(); }

  const fxBad = Object.keys(fxUpd).filter(function (p) { return fxUpd[p].status !== 'OK'; });
  const parts = ['google=' + counts.google, 'yahoo=' + counts.yahoo, 'google->yahoo cross-check=' + counts.cross, 'fx ok=' + (Object.keys(fxUpd).length - fxBad.length) + '/' + Object.keys(fxUpd).length];
  ['Suspect', 'Stale', 'Error'].forEach(function (k) { if (flags[k].length) parts.push(k + ': ' + flags[k].join(', ')); });
  if (fxBad.length) parts.push('FX problems: ' + fxBad.join(', '));
  const bad = flags.Suspect.length + flags.Stale.length + flags.Error.length + fxBad.length > 0;
  logAction(action, parts.join(' | '), bad ? 'Warning' : 'Success');
  return { skipped: false, updated: Object.keys(upd).length, message: 'Refreshed ' + Object.keys(upd).length + ' instrument(s)' + (bad ? ' (see Log for warnings)' : ''), flags: flags };
}
