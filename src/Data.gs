/**
 * Data.gs — Instruments access, getMarketData (the ONLY way the UI obtains prices), syncTracked, FX, derived fields.
 */

function numOrNull_(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
function ageDays_(d) { return isDate_(d) ? (Date.now() - d.getTime()) / 86400000 : null; }
function ageHours_(d) { return isDate_(d) ? (Date.now() - d.getTime()) / 3600000 : null; }

// ---------------------------------------------------------------- Instruments
function instFromRow_(r, rowNum) {
  return {
    row: rowNum, ticker: r[IC.TICKER], market: r[IC.MARKET], name: r[IC.NAME], qccy: r[IC.QCCY], mccy: r[IC.MCCY],
    divisor: Number(r[IC.DIV]) || 1, source: r[IC.SRC], gsym: r[IC.GSYM], ysym: r[IC.YSYM],
    live: { price: r[IC.LPRICE], prev: r[IC.LPREV], high: r[IC.LHIGH], low: r[IC.LLOW], ccy: r[IC.LCCY], time: r[IC.LTIME] },
    snap: { price: r[IC.PRICE], prev: r[IC.PREV], high: r[IC.HIGH], low: r[IC.LOW], quoteTime: r[IC.QTIME], updatedAt: r[IC.UPD], status: r[IC.STATUS], writer: r[IC.WRITER] },
    tracked: r[IC.TRACKED] === true || String(r[IC.TRACKED]).toUpperCase() === 'TRUE'
  };
}
function readInstruments_() {
  const s = sh_(SHEETS.INST), n = s.getLastRow() - 1;
  if (n < 1) return [];
  return s.getRange(2, 1, n, NCOL).getValues().map(function (r, i) { return instFromRow_(r, i + 2); });
}
function findInst_(ticker) {
  const s = sh_(SHEETS.INST), n = s.getLastRow() - 1;
  if (n < 1) return null;
  const vals = s.getRange(2, 1, n, NCOL).getValues();
  for (let i = 0; i < vals.length; i++) if (vals[i][IC.TICKER] === ticker) return instFromRow_(vals[i], i + 2);
  return null;
}
function liveFormulas_(row) {
  const g = '$H' + row;
  return ['=IFERROR(GOOGLEFINANCE(' + g + ',"price"),"")', '=IFERROR(GOOGLEFINANCE(' + g + ',"closeyest"),"")',
    '=IFERROR(GOOGLEFINANCE(' + g + ',"high52"),"")', '=IFERROR(GOOGLEFINANCE(' + g + ',"low52"),"")',
    '=IFERROR(GOOGLEFINANCE(' + g + ',"currency"),"")', '=IFERROR(GOOGLEFINANCE(' + g + ',"tradetime"),"")'];
}

// ---------------------------------------------------------------- market data (seam rule 1)
/** Is the Google Live block of this row usable? (spec 4.4 step 3) */
function evaluateLive_(inst, cfg) {
  const L = inst.live;
  if (inst.source !== 'Google') return { valid: false, why: 'not a Google row' };
  if (!isValidNum(L.price)) return { valid: false, why: 'live price missing' };
  if (!isDate_(L.time)) return { valid: false, why: 'live trade time missing' };
  if (L.ccy && normalizeCcy_(L.ccy) !== inst.qccy) return { valid: false, suspect: true, why: 'currency changed (' + L.ccy + ')' };
  const md = { price: L.price, prevClose: isValidNum(L.prev) ? L.prev : null, high52: isValidNum(L.high) ? L.high : null,
    low52: isValidNum(L.low) ? L.low : null, quoteTime: L.time };
  const sc = sanityCheck(md, cfg);
  if (!sc.ok) return { valid: false, suspect: true, why: sc.why };
  return { valid: true, md: md };
}

function staleStatus_(quoteTime, cfg) {
  const a = ageDays_(quoteTime);
  return (a !== null && a > cfg.staleQuoteDays) ? 'Stale' : 'OK';
}

/**
 * The only function UI code uses to obtain prices.
 * ctx (optional): { instruments, cfg } preloaded by the caller so a table of N rows needs one sheet read.
 * Returns { price, prevClose, high52, low52, quoteTime, updatedAt, status, source, writer, via }.
 */
function getMarketData(ticker, ctx) {
  ctx = ctx || {};
  const cfg = ctx.cfg || getConfig_();
  const insts = ctx.instruments || readInstruments_();
  const inst = insts.filter(function (i) { return i.ticker === ticker; })[0];
  const empty = { price: null, prevClose: null, high52: null, low52: null, quoteTime: '', updatedAt: '', status: 'Error', source: '', writer: '', via: 'none' };
  if (!inst) return empty;

  const fromSnapshot = function (forced) {
    const s = inst.snap, price = isValidNum(s.price) ? s.price : null;
    let status = price === null ? 'Error' : (forced || s.status || 'OK');
    if (status === 'OK') status = staleStatus_(s.quoteTime, cfg);
    return { price: price, prevClose: numOrNull_(s.prev), high52: numOrNull_(s.high), low52: numOrNull_(s.low), quoteTime: fmtDateTime_(s.quoteTime),
      updatedAt: fmtDateTime_(s.updatedAt), status: status, source: inst.source, writer: s.writer || '', via: 'snapshot' };
  };
  if (!inst.tracked || inst.source !== 'Google') return fromSnapshot();        // Paused rows are frozen; Yahoo rows only have a snapshot

  const ev = evaluateLive_(inst, cfg);
  if (ev.valid) {
    const m = ev.md;
    return { price: m.price, prevClose: m.prevClose, high52: m.high52, low52: m.low52, quoteTime: fmtDateTime_(m.quoteTime), updatedAt: fmtDateTime_(new Date()),
      status: staleStatus_(m.quoteTime, cfg), source: 'Google', writer: 'GAS', via: 'live' };
  }
  return fromSnapshot(ev.suspect ? 'Suspect' : undefined);                     // never show an unchecked Live quote
}

// ---------------------------------------------------------------- lifecycle (spec 3.9)
/** Recompute Tracked for every Instruments row and delete rows no longer on Owned/Watchlist. Call inside the lock. */
function syncTracked_() {
  const s = sh_(SHEETS.INST), n = s.getLastRow() - 1;
  if (n < 1) return;
  const owned = {}, watchAny = {}, watchActive = {};
  readTab_(SHEETS.OWNED, 1).forEach(function (r) { owned[r[0]] = true; });
  readTab_(SHEETS.WATCH, 5).forEach(function (r) { watchAny[r[0]] = true; if (r[4] === 'Active') watchActive[r[0]] = true; });
  const data = s.getRange(2, 1, n, NCOL).getValues(), flags = [], del = [];
  data.forEach(function (r, i) {
    const t = r[IC.TICKER], referenced = owned[t] || watchAny[t];
    flags.push([!!(owned[t] || watchActive[t])]);
    const freshProbe = r[IC.WRITER] === 'PROBE' && isDate_(r[IC.UPD]) && ageHours_(r[IC.UPD]) < 0.5;   // keep a just-resolved row while the Add dialog is open
    if (!referenced && !freshProbe) del.push(i + 2);
  });
  s.getRange(2, IC.TRACKED + 1, n, 1).setValues(flags);
  for (let k = data.length - 1; k >= 0; k--) {        // promote probe rows that are now in use
    if (flags[k][0] && data[k][IC.WRITER] === 'PROBE') s.getRange(k + 2, IC.WRITER + 1).setValue('GAS');
  }
  del.sort(function (a, b) { return b - a; }).forEach(function (row) { s.deleteRow(row); });
}

// ---------------------------------------------------------------- FX (spec 3.8)
function readFx_() {
  const s = sh_(SHEETS.FX), n = s.getLastRow() - 1, map = {};
  if (n < 1) return map;
  s.getRange(2, 1, n, 5).getValues().forEach(function (r, i) { map[r[0]] = { row: i + 2, live: r[1], rate: r[2], updatedAt: r[3], status: r[4] }; });
  return map;
}
function fxRate_(pair, fx) {
  const e = fx[pair];
  if (!e) return null;
  if (isValidNum(e.live)) return e.live;
  if (isValidNum(e.rate)) return e.rate;
  return null;
}
function ensureFxRow_(pair) {
  const s = sh_(SHEETS.FX), n = s.getLastRow() - 1;
  const names = n > 0 ? s.getRange(2, 1, n, 1).getValues().map(function (r) { return r[0]; }) : [];
  if (names.indexOf(pair) >= 0) return;
  const row = s.getLastRow() + 1;
  s.getRange(row, 1).setValue(pair);
  s.getRange(row, 2).setFormula('=IFERROR(GOOGLEFINANCE("CURRENCY:"&A' + row + '),"")');
}
/** Major currency -> EUR. EUR = 1; HUF = 1 / EURHUF; GBX is already converted to GBP by the price divisor. Null if unavailable. */
function fxToEur(major, fx) {
  fx = fx || readFx_();
  if (major === 'EUR') return 1;
  if (major === 'HUF') { const r = fxRate_('EURHUF', fx); return r ? 1 / r : null; }
  return fxRate_(major + 'EUR', fx);
}

// ---------------------------------------------------------------- derived values (never stored)
function computeDerivedFields(row, md, fxEur) {
  const d = { totalCost: row.buyPrice * row.qty / row.divisor, totalActual: null, pl: null, plPct: null, valueEur: null, plEur: null, pos52: null };
  if (md.price === null) return d;
  d.totalActual = md.price * row.qty / row.divisor;
  d.pl = d.totalActual - d.totalCost;
  d.plPct = d.totalCost > 0 ? d.pl / d.totalCost * 100 : null;
  if (fxEur !== null) { d.valueEur = d.totalActual * fxEur; d.plEur = d.pl * fxEur; }
  if (md.high52 !== null && md.low52 !== null && md.high52 > md.low52) d.pos52 = (md.price - md.low52) / (md.high52 - md.low52);
  return d;
}

/** Totals are N/A (never silently wrong) if any price or FX rate is missing. */
function computePortfolioTotals(rows, fx) {
  const missing = [];
  let eur = 0, plEur = 0;
  rows.forEach(function (r) {
    if (r.valueEur === null) missing.push(r.ticker); else { eur += r.valueEur; plEur += r.plEur; }
  });
  const good = missing.length === 0, eurhuf = fxRate_('EURHUF', fx);
  rows.forEach(function (r) { r.allocPct = (good && eur > 0) ? r.valueEur / eur * 100 : null; });
  return { eur: good ? eur : null, huf: (good && eurhuf) ? eur * eurhuf : null, plEur: good ? plEur : null, missing: missing, eurhuf: eurhuf };
}

// ---------------------------------------------------------------- Symbols tab (CR-1)
function seedSymbols_() {
  const m = /<script[^>]*id="symbols"[^>]*>([\s\S]*?)<\/script>/.exec(include('symbols'));
  let list = [];
  try { list = m ? JSON.parse(m[1]) : []; } catch (e) { list = []; }
  return list.map(function (x) { return { ticker: x.ticker, name: x.name, market: x.market, yahoo: '' }; });
}
function readSymbols_() {
  const s = ss_().getSheetByName(SHEETS.SYMBOLS);
  const rows = (s && s.getLastRow() > 1) ? s.getRange(2, 1, s.getLastRow() - 1, 4).getValues().map(function (r) {
    return { ticker: String(r[0]).trim().toUpperCase(), name: String(r[1] || ''), market: String(r[2] || ''), yahoo: String(r[3] || '') };
  }).filter(function (x) { return x.ticker; }) : [];
  return rows.length ? rows : seedSymbols_();
}
/**
 * Called inside the add functions' lock after the user confirmed an add. Appends the ticker if it is new; a seeded row
 * (no Yahoo symbol yet) gets the symbol stored in Instruments, and a placeholder seed name is replaced by the confirmed name.
 * Never lets a Symbols problem break the add itself.
 */
function recordSymbol_(inst, name) {
  try {
    const s = ss_().getSheetByName(SHEETS.SYMBOLS);
    if (!s) return;
    const n = s.getLastRow() - 1, vals = n > 0 ? s.getRange(2, 1, n, 4).getValues() : [];
    for (let i = 0; i < vals.length; i++) {
      if (String(vals[i][0]).trim().toUpperCase() !== inst.ticker) continue;
      if (!vals[i][3] && inst.ysym) {
        s.getRange(i + 2, 4).setValue(inst.ysym);
        if (/name resolved on add/i.test(String(vals[i][1])) && name) s.getRange(i + 2, 2).setValue(name);
      }
      return;
    }
    s.appendRow([inst.ticker, name || inst.name, inst.market, inst.ysym || '', new Date()]);
  } catch (e) { console.error('recordSymbol_ failed: ' + e); }
}

/** Yahoo symbol for research links: the one stored when the ticker was resolved, otherwise the Appendix C mapping. */
function yahooSymbolFor_(ticker, inst) { return (inst && inst.ysym) || mapInternalToYahoo(ticker); }
