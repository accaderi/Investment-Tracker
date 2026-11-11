/**
 * Lots.gs (v1.8): every row of the Owned tab is a LOT, one purchase with its own date, price and quantity.
 * A POSITION is all lots of one ticker in one account; the Owned page shows positions and expands them into lots.
 * A sale consumes lots (FIFO by default, or the lots you pick) and writes one Sold row per lot used, so the cost
 * and buy date of every sale are exact.
 */

// ================================================================ lots
function newLotId_(have) {
  let id;
  do { id = 'L' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36).padStart(3, '0'); } while (have && have[id]);
  if (have) have[id] = true;
  return id;
}
function lotFromRow_(r, rowNum) {
  return { row: rowNum, ticker: r[0], market: r[1], name: r[2], currency: r[3], buyDate: r[4], buyPrice: Number(r[6]), qty: Number(r[7]), account: acct_(r[8]), lotId: String(r[9] || '') };
}
function readLots_() {
  const s = sh_(SHEETS.OWNED), n = s.getLastRow() - 1;
  return n > 0 ? s.getRange(2, 1, n, 10).getValues().map(function (r, i) { return lotFromRow_(r, i + 2); }) : [];
}
function lotsOf_(ticker, account) {
  const a = acct_(account).toLowerCase();
  return readLots_().filter(function (l) { return l.ticker === ticker && l.account.toLowerCase() === a; });
}
function lotById_(id) { return readLots_().filter(function (l) { return l.lotId === id; })[0] || null; }
/** Gives an id to every lot that has none (rows from before lots existed become one opening lot each). Idempotent. */
function ensureLotIds_() {
  const s = sh_(SHEETS.OWNED), n = s.getLastRow() - 1;
  if (n < 1) return 0;
  const col = s.getRange(2, 10, n, 1).getValues(), have = {};
  col.forEach(function (r) { if (r[0]) have[r[0]] = true; });
  let changed = 0;
  col.forEach(function (r) { if (!r[0]) { r[0] = newLotId_(have); changed++; } });
  if (changed) s.getRange(2, 10, n, 1).setValues(col);
  return changed;
}
function fifoCmp_(a, b) {
  const x = isoDate_(a.buyDate), y = isoDate_(b.buyDate);
  return x < y ? -1 : x > y ? 1 : a.row - b.row;
}

// ================================================================ positions (what the page shows)
function lotView_(l, md, div, fxEur, today) {
  const d = computeDerivedFields({ buyPrice: l.buyPrice, qty: l.qty, divisor: div }, md, fxEur), bd = isoDate_(l.buyDate);
  return { lotId: l.lotId, buyDate: bd, daysHeld: bd ? Math.max(0, Math.round((today.getTime() - toDate_(bd).getTime()) / 86400000)) : null,
    buyPrice: l.buyPrice, qty: l.qty, totalCost: d.totalCost, totalActual: d.totalActual, pl: d.pl, plPct: d.plPct, valueEur: d.valueEur, plEur: d.plEur, best: false, worst: false };
}
function positionView_(lots, insts, cfg, fx) {
  const f = lots[0], inst = insts.filter(function (i) { return i.ticker === f.ticker; })[0];
  const md = getMarketData(f.ticker, { instruments: insts, cfg: cfg });
  const div = inst ? inst.divisor : divisorForCcy_(String(f.currency)), mccy = inst ? inst.mccy : majorCcy_(String(f.currency)), fxEur = fxToEur(mccy, fx);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const views = lots.slice().sort(fifoCmp_).map(function (l) { return lotView_(l, md, div, fxEur, today); });
  const qty = views.reduce(function (a, v) { return a + v.qty; }, 0), cost = views.reduce(function (a, v) { return a + v.buyPrice * v.qty; }, 0), avg = cost / qty;
  const ranked = views.filter(function (v) { return typeof v.plPct === 'number' && isFinite(v.plPct); });
  if (views.length > 1 && ranked.length > 1) {
    const hi = ranked.reduce(function (a, v) { return v.plPct > a.plPct ? v : a; }), lo = ranked.reduce(function (a, v) { return v.plPct < a.plPct ? v : a; });
    if (hi.plPct !== lo.plPct) { hi.best = true; lo.worst = true; }
  }
  const d = computeDerivedFields({ buyPrice: avg, qty: qty, divisor: div }, md, fxEur);
  return { ticker: f.ticker, ysym: yahooSymbolFor_(f.ticker, inst), account: f.account, market: f.market, name: f.name, currency: f.currency, buyDate: views[0].buyDate, lastBuyDate: views[views.length - 1].buyDate,
    buyPrice: avg, qty: qty, lotCount: views.length, lots: views, majorCcy: mccy, divisor: div, fxEur: fxEur, price: md.price, high52: md.high52, low52: md.low52,
    quoteTime: md.quoteTime, pstatus: md.status, source: md.source, writer: md.writer, totalCost: d.totalCost, totalActual: d.totalActual, pl: d.pl, plPct: d.plPct,
    valueEur: d.valueEur, plEur: d.plEur, pos52: d.pos52, allocPct: null };
}
function readPositions_(ctx) {
  ctx = ctx || {};
  const cfg = ctx.cfg || getConfig_(), insts = ctx.insts || readInstruments_(), fx = ctx.fx || readFx_(), groups = {}, order = [];
  readLots_().forEach(function (l) {
    const k = l.ticker + '|' + l.account.toLowerCase();
    if (!groups[k]) { groups[k] = []; order.push(k); }
    groups[k].push(l);
  });
  return order.map(function (k) { return positionView_(groups[k], insts, cfg, fx); });
}

function getOwnedData() {
  return guard_(function () {
    if (readLots_().some(function (l) { return !l.lotId; })) withLock(function () { ensureLotIds_(); return ok(); });     // first load after an upgrade
    const cfg = getConfig_(), insts = readInstruments_(), fx = readFx_();
    const rows = readPositions_({ cfg: cfg, insts: insts, fx: fx }), notes = readNotes_().owned;
    rows.forEach(function (r) { r.note = notes[noteKey_(r.ticker, r.account)] || ''; });
    return ok({ rows: rows, totals: computePortfolioTotals(rows, fx), showHuf: cfg.showHuf, accounts: allAccountNames_(), cash: cashMap_() });
  });
}

// ================================================================ add a lot
/** Inside the lock. Every purchase becomes its own lot; nothing is merged or averaged away. */
function addOwnedCore_(p, data, moveFromWatch, deduct) {
  const given = (data && typeof data.note === 'string') ? cleanNote_(data.note) : null;                // null = no note typed
  const u = validateTickerUniqueness(p.ticker, SHEETS.OWNED);
  if (u && !moveFromWatch) return fail(u.message, { code: u.code });
  const inst = requireInst_(p.ticker), name = applyName_(inst, data && data.name);
  const watchNote = u ? (readNotes_().watch[p.ticker] || '') : '';
  if (u) { const w = findRow_(SHEETS.WATCH, p.ticker, 5); if (w) w.sheet.deleteRow(w.row); }          // moving from the Watchlist
  ensureAccount_(p.account);
  ensureLotIds_();
  const have = {};
  readLots_().forEach(function (l) { have[l.lotId] = true; });
  const id = newLotId_(have);
  sh_(SHEETS.OWNED).appendRow([p.ticker, inst.market, name, inst.qccy, toDate_(p.date), toDate_(p.date), p.price, p.qty, p.account, id]);
  const n = lotsOf_(p.ticker, p.account).length;
  if (u) {                                                                                             // the entry idea becomes the starting text of the position's note (or what was typed instead)
    setNote_('watch', p.ticker, '', '');
    setNote_('owned', p.ticker, p.account, given !== null ? given : watchNote);
  } else if (given) {                                                                                  // buying more: the new line is added under the existing note
    const have = readNotes_().owned[noteKey_(p.ticker, p.account)];
    setNote_('owned', p.ticker, p.account, have ? have + '\n\n' + given : given);
  }
  const cash = deduct ? applyCash_(p.account, -(p.price * p.qty / inst.divisor), inst.mccy, 'Buy', p.ticker + ' ' + p.qty + ' @ ' + p.price) : { applied: false, reason: 'off' };
  logAction('Add ticker', 'Lot ' + p.ticker + ' [' + p.account + '] ' + p.qty + ' @ ' + p.price + ' (' + id + ')');
  recordSymbol_(inst, name);
  syncTracked_();
  return ok({ ticker: p.ticker, account: p.account, lotId: id, cash: cash }, (n > 1 ? 'Added a lot of ' + p.qty + ' to ' + p.ticker + ' in ' + p.account + ' (now ' + n + ' lots).' : 'Added ' + p.ticker + ' to ' + p.account + '.') + cashNote_(cash));
}

/** Inside the lock: delete every lot of the position and create one new lot (used by the importer's "Replace it"). */
function replaceOwnedCore_(p, data) {
  const lots = lotsOf_(p.ticker, p.account);
  if (!lots.length) return addOwnedCore_(p, data, true);
  lots.map(function (l) { return l.row; }).sort(function (a, b) { return b - a; }).forEach(function (r) { sh_(SHEETS.OWNED).deleteRow(r); });
  const r = addOwnedCore_(p, data, true, false);                       // a correction, not a new payment: cash untouched
  logAction('Import (replace)', p.ticker + ' [' + p.account + '] ' + lots.length + ' lot(s) replaced by ' + p.qty + ' @ ' + p.price);
  return r.success ? ok(r.data, 'Replaced ' + p.ticker + ' in ' + p.account + ' (' + lots.length + ' lot(s) became 1)') : r;
}

// ================================================================ sell
/**
 * Sells from one position. plan = [{lotId, qty}] chooses exactly which lots (the page builds it from FIFO / best / worst / manual);
 * without a plan the oldest lots go first (FIFO). One Sold row is written per lot used; the FX rate is frozen once for the sale.
 */
function recordSell(ticker, account, sellPrice, soldQty, sellDate, fxOverride, addToWatchlist, plan, addToCash, saleNote) {
  return guard_(function () {
    ticker = String(ticker || '').trim();
    const price = posNum_(sellPrice, 'Sell price'), sq = posNum_(soldQty, 'Sold quantity'), date = pastDate_(sellDate, 'Sell date'), reason = cleanNote_(saleNote);
    return withLock(function () {
      ensureLotIds_();
      const lots = lotsOf_(ticker, account);
      if (!lots.length) return fail(ticker + ' is not held in ' + acct_(account) + '.');
      const total = r8_(lots.reduce(function (a, l) { return a + l.qty; }, 0));
      if (sq > total + 1e-9) return fail('Sold quantity (' + sq + ') exceeds quantity owned (' + total + ').');
      const alloc = [];
      if (plan && plan.length) {
        const seen = {};
        let sum = 0;
        for (let i = 0; i < plan.length; i++) {
          const lot = lots.filter(function (l) { return l.lotId === String(plan[i].lotId); })[0], q = Number(plan[i].qty);
          if (!lot) return fail('A selected lot is not part of ' + ticker + ' in ' + acct_(account) + '. Reload the page and try again.');
          if (seen[lot.lotId]) return fail('A lot was listed twice.');
          seen[lot.lotId] = true;
          if (!(q > 0) || !isFinite(q)) return fail('Each lot quantity must be greater than 0.');
          if (q > lot.qty + 1e-9) return fail('The lot bought ' + isoDate_(lot.buyDate) + ' has only ' + lot.qty + ' left.');
          alloc.push({ lot: lot, qty: q }); sum += q;
        }
        if (Math.abs(sum - sq) > 1e-6 * Math.max(1, sq)) return fail('The lot quantities add up to ' + r8_(sum) + ', not the sold quantity ' + sq + '.');
      } else {
        let left = sq;
        lots.slice().sort(fifoCmp_).forEach(function (l) {
          if (left <= 1e-9) return;
          const take = Math.min(l.qty, left);
          alloc.push({ lot: l, qty: take }); left = r8_(left - take);
        });
      }
      const inst = findInst_(ticker), ccy = String(lots[0].currency), acc = lots[0].account;
      const div = inst ? inst.divisor : divisorForCcy_(ccy), mccy = inst ? inst.mccy : majorCcy_(ccy);
      let fxRate = fxToEur(mccy);
      if (fxRate === null) {
        if (fxOverride === undefined || fxOverride === null || fxOverride === '')
          return fail('No FX rate available for ' + mccy + '->EUR. Enter the rate manually.', { code: 'FX_UNAVAILABLE' });
        fxRate = posNum_(fxOverride, 'FX rate');
      }
      // The sale's note: what you typed, plus (when everything is sold) the note you kept on the position, so Sold keeps the whole story.
      const sellsAll = lots.every(function (l) { const a = alloc.filter(function (x) { return x.lot === l; })[0]; return !!a && r8_(l.qty - a.qty) <= 1e-9; });
      const heldNote = sellsAll ? (readNotes_().owned[noteKey_(ticker, acc)] || '') : '';
      const soldNote = heldNote ? (reason ? reason + '\n\n' : '') + 'While held: ' + heldNote : reason;
      const saleId = newSaleId_();
      let realizedSum = 0, eurSum = 0;
      const soldRows = alloc.map(function (a) {
        const realized = r6_((price - a.lot.buyPrice) * a.qty / div), eur = r6_(realized * fxRate);
        realizedSum += realized; eurSum += eur;
        return [ticker, a.lot.market, a.lot.name, ccy, a.lot.buyDate, a.lot.buyPrice, toDate_(date), price, a.qty, realized, fxRate, eur, acc, a.lot.lotId, saleId, soldNote];
      });
      const soldSheet = soldSheet_(), firstRow = soldSheet.getLastRow() + 1;
      soldSheet.getRange(firstRow, 15, soldRows.length, 2).setNumberFormat('@');                           // Sale ID and Note stay text (a note such as "=sell" is not a formula)
      soldSheet.getRange(firstRow, 1, soldRows.length, SOLD_COLS).setValues(soldRows);
      const dels = [];
      alloc.forEach(function (a) {                                      // update partly sold lots first (row numbers still valid), then delete emptied lots bottom-up
        const left = r8_(a.lot.qty - a.qty);
        if (left <= 1e-9) dels.push(a.lot.row); else sh_(SHEETS.OWNED).getRange(a.lot.row, 8).setValue(left);
      });
      dels.sort(function (x, y) { return y - x; }).forEach(function (r) { sh_(SHEETS.OWNED).deleteRow(r); });
      const full = lotsOf_(ticker, account).length === 0;
      if (full) setNote_('owned', ticker, acc, '');                                                          // the position is gone; its note now lives in the sale's note
      if (full && addToWatchlist && !findRow_(SHEETS.OWNED, ticker, 9) && !findRow_(SHEETS.WATCH, ticker, 5)) sh_(SHEETS.WATCH).appendRow([ticker, lots[0].market, lots[0].name, ccy, 'Active']);
      syncTracked_();
      const cash = addToCash === false ? { applied: false, reason: 'off' } : applyCash_(acc, price * sq / div, mccy, 'Sell', ticker + ' ' + sq + ' @ ' + price);
      realizedSum = r6_(realizedSum); eurSum = r6_(eurSum);
      logAction(full ? 'Full sell' : 'Partial sell', ticker + ' [' + acc + '] ' + sq + ' @ ' + price + ' from ' + alloc.length + ' lot(s), P/L ' + realizedSum + ' ' + mccy + ' (' + eurSum + ' EUR @ ' + fxRate + ')');
      return ok({ realized: realizedSum, realizedEur: eurSum, full: full, lots: alloc.length, cash: cash, saleId: saleId },
        (full ? 'Sold all of ' : 'Sold part of ') + ticker + ' (' + acc + ', ' + alloc.length + ' lot' + (alloc.length === 1 ? '' : 's') + '): realized ' + eurSum.toFixed(2) + ' EUR.' + cashNote_(cash));
    });
  });
}

// ================================================================ edit / delete
/** Corrects one lot's price, quantity or buy date. */
function editLot(p) {
  return guard_(function () {
    p = p || {};
    const price = posNum_(p.buyPrice, 'Buy price'), qty = posNum_(p.quantity, 'Quantity'), date = pastDate_(p.buyDate, 'Buy date');
    return withLock(function () {
      ensureLotIds_();
      const l = lotById_(String(p.lotId || ''));
      if (!l) return fail('Lot not found. Reload the page and try again.');
      sh_(SHEETS.OWNED).getRange(l.row, 5, 1, 4).setValues([[toDate_(date), toDate_(date), price, qty]]);
      logAction('Edit lot', l.ticker + ' [' + l.account + '] ' + isoDate_(l.buyDate) + ' ' + l.qty + ' @ ' + l.buyPrice + ' -> ' + date + ' ' + qty + ' @ ' + price + ' (' + l.lotId + ')');
      return ok({ lotId: l.lotId }, 'Updated the lot of ' + l.ticker + ' (' + l.account + ')');
    });
  });
}

/** Position-level edit: the name and/or the account of ALL lots of the position. Moving into an account that already holds the ticker joins the lots. */
function editOwnedRow(p) {
  return guard_(function () {
    p = p || {};
    const ticker = String(p.ticker || '').trim(), target = accountInput_(p.newAccount ? p.newAccount : p.account);
    return withLock(function () {
      ensureLotIds_();
      const lots = lotsOf_(ticker, p.account);
      if (!lots.length) return fail(ticker + ' is not held in ' + acct_(p.account) + '.');
      const cur = lots[0].account, joins = target.toLowerCase() !== cur.toLowerCase() && lotsOf_(ticker, target).length > 0;
      const inst = findInst_(ticker), name = String(p.name || '').trim() || String(lots[0].name);
      if (inst) applyName_(inst, name);
      ensureAccount_(target);
      const s = sh_(SHEETS.OWNED);
      lots.forEach(function (l) { s.getRange(l.row, 3).setValue(name); s.getRange(l.row, 9).setValue(target); });
      if (target !== cur) moveOwnedNote_(ticker, cur, target);                       // the note follows the position
      logAction('Edit holding', ticker + ' [' + cur + (target !== cur ? ' -> ' + target : '') + '] name "' + name + '" (' + lots.length + ' lot(s))');
      return ok({ ticker: ticker, account: target }, 'Updated ' + ticker + ' (' + target + ')' + (joins ? ': its lots joined the existing position' : ''));
    });
  });
}

function deleteLot(lotId) {
  return guard_(function () {
    return withLock(function () {
      ensureLotIds_();
      const l = lotById_(String(lotId || ''));
      if (!l) return fail('Lot not found. Reload the page and try again.');
      sh_(SHEETS.OWNED).deleteRow(l.row);
      if (!lotsOf_(l.ticker, l.account).length) setNote_('owned', l.ticker, l.account, '');       // it was the last lot: the position and its note are gone
      syncTracked_();
      logAction('Delete lot', l.ticker + ' [' + l.account + '] ' + isoDate_(l.buyDate) + ' ' + l.qty + ' @ ' + l.buyPrice + ' (no Sold record created)');
      return ok(null, 'Deleted the lot of ' + l.ticker);
    });
  });
}
/** Deletes the whole position (every lot) without a Sold record: for data-entry mistakes. */
function deleteOwnedRow(ticker, account) {
  return guard_(function () {
    return withLock(function () {
      const lots = lotsOf_(String(ticker), account);
      if (!lots.length) return fail(ticker + ' is not held in ' + acct_(account) + '.');
      lots.map(function (l) { return l.row; }).sort(function (a, b) { return b - a; }).forEach(function (r) { sh_(SHEETS.OWNED).deleteRow(r); });
      setNote_('owned', String(ticker), account, '');
      syncTracked_();
      logAction('Delete owned', ticker + ' [' + acct_(account) + '] ' + lots.length + ' lot(s) (no Sold record created)');
      return ok(null, 'Deleted ' + ticker + ' from ' + acct_(account) + ' (' + lots.length + ' lot' + (lots.length === 1 ? '' : 's') + ')');
    });
  });
}
