/**
 * Notes.gs (v1.11): notes on Watchlist items, Owned positions and Sold sales.
 *
 *  - Watchlist note: one per ticker (the entry idea).
 *  - Owned note: one per position, i.e. ticker + account (when to sell, whether to buy more).
 *  - Sold note: one per sale. A sale that used several lots writes several Sold rows; they share a Sale ID and show the same note.
 *
 * Watchlist and Owned notes live on the "Notes" sheet (List, Ticker, Account, Note, Updated At), so you can read and edit them there too.
 * Sold notes live on the Sold sheet itself (columns Sale ID and Note) because they belong to the sale record.
 * A note moves with the stock: Watchlist -> Owned carries it over, and a full sale copies the Owned note into the Sold note.
 */

const NOTE_MAX = 4000;
const SOLD_COLS = 16;                         // Sold sheet: 14 original columns + Sale ID (15) + Note (16)

function cleanNote_(v) {
  const s = String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim();
  if (s.length > NOTE_MAX) throw new Error('A note can hold at most ' + NOTE_MAX + ' characters (this one has ' + s.length + ').');
  return s;
}
function noteKey_(ticker, account) { return String(ticker) + '|' + acct_(account).toLowerCase(); }

// ---------------------------------------------------------------- Notes sheet (Watchlist and Owned)
/** The Notes sheet. Created on first use, so an older installation works without running setup() again. */
function noteSheet_(create) {
  let s = ss_().getSheetByName(SHEETS.NOTES);
  if (!s && create) {
    s = ss_().insertSheet(SHEETS.NOTES);
    s.getRange(1, 1, 1, HEADERS.Notes.length).setValues([HEADERS.Notes]).setFontWeight('bold').setBackground('#e8eef7');
    s.setFrozenRows(1);
    try { s.getRange(2, 5, 5000, 1).setNumberFormat('yyyy-mm-dd hh:mm'); s.setColumnWidth(4, 460); }
    catch (e) { console.error('Notes sheet formatting skipped: ' + e); }                 // cosmetic only: never let it block saving a note
  }
  return s;
}
/** Every note row in sheet order. list is 'watch' or 'owned'; rows with an unknown list are ignored. */
function readNoteRows_() {
  const s = noteSheet_(false), n = s ? s.getLastRow() - 1 : 0;
  if (n < 1) return [];
  const out = [];
  s.getRange(2, 1, n, 4).getValues().forEach(function (r, i) {
    const l = String(r[0]).trim().toLowerCase(), list = l === 'owned' ? 'owned' : (l === 'watch' || l === 'watchlist') ? 'watch' : '';
    const ticker = String(r[1]).trim().toUpperCase();
    if (list && ticker) out.push({ row: i + 2, list: list, ticker: ticker, account: list === 'owned' ? acct_(r[2]) : '', note: String(r[3] == null ? '' : r[3]).trim() });
  });
  return out;
}
/** { watch: {ticker: note}, owned: {ticker|account: note} } (empty notes left out). */
function readNotes_() {
  const out = { watch: {}, owned: {} };
  readNoteRows_().forEach(function (r) {
    if (!r.note) return;
    if (r.list === 'watch') out.watch[r.ticker] = r.note; else out.owned[noteKey_(r.ticker, r.account)] = r.note;
  });
  return out;
}
/** Inside the lock. Sets, replaces or (empty text) removes one Watchlist or Owned note. */
function setNote_(list, ticker, account, text) {
  const owned = list === 'owned', acc = owned ? acct_(account) : '', t = String(ticker).trim().toUpperCase();
  const hits = readNoteRows_().filter(function (r) { return r.list === list && r.ticker === t && (!owned || r.account.toLowerCase() === acc.toLowerCase()); });
  if (!text) {
    if (!hits.length) return;
    const s = noteSheet_(false);
    hits.map(function (r) { return r.row; }).sort(function (a, b) { return b - a; }).forEach(function (r) { s.deleteRow(r); });
    return;
  }
  const s = noteSheet_(true);
  let row;
  if (hits.length) {
    row = hits[0].row;                                                         // rows are in ascending order, so deleting the later duplicates leaves this one in place
    hits.slice(1).map(function (r) { return r.row; }).sort(function (a, b) { return b - a; }).forEach(function (r) { s.deleteRow(r); });
  } else row = Math.max(s.getLastRow(), 1) + 1;
  const head = s.getRange(row, 1, 1, 4);
  head.setNumberFormat('@');                                                   // a note such as "=sell" or "-10% target" stays text
  head.setValues([[owned ? 'Owned' : 'Watch', t, acc, text]]);
  s.getRange(row, 5).setValue(new Date());
}
/** Inside the lock. The position changed account: its note goes along (joined to the target's note if that has one). */
function moveOwnedNote_(ticker, fromAccount, toAccount) {
  const notes = readNotes_().owned, a = notes[noteKey_(ticker, fromAccount)];
  if (!a) return;
  const b = notes[noteKey_(ticker, toAccount)];
  const same = noteKey_(ticker, fromAccount) === noteKey_(ticker, toAccount);
  setNote_('owned', ticker, fromAccount, '');
  setNote_('owned', ticker, toAccount, (b && !same && b !== a) ? b + '\n\n' + a : a);
}
/** Inside the lock. An account was renamed: only Owned notes carry an account (a Watchlist note has none). */
function renameNoteAccount_(oldName, newName) {
  const s = noteSheet_(false);
  let changed = 0;
  readNoteRows_().forEach(function (r) {
    if (r.list === 'owned' && r.account.toLowerCase() === acct_(oldName).toLowerCase()) {
      const c = s.getRange(r.row, 3);
      c.setNumberFormat('@'); c.setValue(newName); changed++;
    }
  });
  return changed;
}

// ---------------------------------------------------------------- Sold sheet: Sale ID + Note columns
function newSaleId_(have) {
  let id;
  do { id = 'S' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36).padStart(3, '0'); } while (have && have[id]);
  if (have) have[id] = true;
  return id;
}
/** The Sold sheet with room for the Sale ID and Note columns (an older sheet gets them added). */
function soldSheet_() {
  const s = sh_(SHEETS.SOLD);
  if (s.getMaxColumns() < SOLD_COLS) s.insertColumnsAfter(s.getMaxColumns(), SOLD_COLS - s.getMaxColumns());
  return s;
}
/** Sold rows as arrays of 16 values (Sale ID and Note are '' on rows written before v1.11). */
function readSoldRows_() {
  const s = sh_(SHEETS.SOLD), n = s.getLastRow() - 1;
  if (n < 1) return [];
  const w = Math.min(SOLD_COLS, s.getMaxColumns());
  return s.getRange(2, 1, n, w).getValues().map(function (r) { while (r.length < SOLD_COLS) r.push(''); return r; });
}
/**
 * Inside the lock. Gives every Sold row that has no Sale ID one, rows of the same sale (same ticker, account, date, price and FX) sharing it.
 * Idempotent: the first Sold page load after an upgrade does the work, later loads find nothing to do.
 */
function ensureSaleIds_() {
  const rows = readSoldRows_();
  if (!rows.length) return 0;
  const s = soldSheet_(), have = {}, byKey = {};
  rows.forEach(function (r) { if (r[14]) have[String(r[14])] = true; });
  let changed = 0;
  const ids = rows.map(function (r) {
    if (r[14]) return [String(r[14])];
    const k = [r[0], acct_(r[12]).toLowerCase(), isoDate_(r[6]), r[7], r[10]].join('|');
    if (!byKey[k]) byKey[k] = newSaleId_(have);
    changed++;
    return [byKey[k]];
  });
  if (changed) {
    s.getRange(2, 15, ids.length, 1).setNumberFormat('@').setValues(ids);
    ensureHeaders_(s, HEADERS.Sold);
  }
  return changed;
}

// ---------------------------------------------------------------- API
/**
 * Saves (or, with empty text, removes) one note.
 *  kind 'watch': key = ticker                      (the ticker must be on the Watchlist)
 *  kind 'owned': key = ticker, account = account   (the position must exist)
 *  kind 'sold' : key = Sale ID                     (every Sold row of that sale gets the note)
 */
function saveNote(kind, key, account, text) {
  return guard_(function () {
    const note = cleanNote_(text), k = String(key == null ? '' : key).trim();
    if (!k) throw new Error('Nothing to attach the note to. Reload the page and try again.');
    return withLock(function () {
      if (kind === 'watch') {
        if (!findRow_(SHEETS.WATCH, k, 5)) return fail(k + ' is not on the Watchlist any more. Reload the page.');
        setNote_('watch', k, '', note);
      } else if (kind === 'owned') {
        const lots = lotsOf_(k, account);
        if (!lots.length) return fail(k + ' is not held in ' + acct_(account) + ' any more. Reload the page.');
        account = lots[0].account;                                                // the account as the position spells it
        setNote_('owned', k, account, note);
      } else if (kind === 'sold') {
        const rows = readSoldRows_(), idx = [];
        rows.forEach(function (r, i) { if (String(r[14]) === k) idx.push(i); });
        if (!idx.length) return fail('That sale was not found. Reload the page.');
        const s = soldSheet_(), col = rows.map(function (r) { return [r[15]]; });
        idx.forEach(function (i) { col[i][0] = note; });
        s.getRange(2, 16, col.length, 1).setNumberFormat('@').setValues(col);
        ensureHeaders_(s, HEADERS.Sold);
      } else throw new Error('Unknown note type.');
      logAction('Note', (kind === 'sold' ? 'Sale ' : '') + k + (kind === 'owned' ? ' [' + acct_(account) + ']' : '') + (note ? ' saved (' + note.length + ' characters)' : ' removed'));
      return ok({ note: note }, note ? 'Note saved' : 'Note removed');
    });
  });
}
