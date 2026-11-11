/**
 * Check.gs: run checkInstall() from the editor to see whether every file was pasted into the right place.
 * It reports wrong or missing files in plain words. Safe to run any time; it changes nothing.
 * (If Apps Script refuses to run anything and shows "Syntax error ... file X", fix file X first: a .gs file must
 * start with /** and contain no HTML.)
 */
function checkInstall() {
  const problems = [], passed = [];
  const need = { 'Code.gs': ['doGet', 'setup', 'addOwnedRow'], 'Data.gs': ['getMarketData', 'syncTracked_', 'readInstruments_'],
    'Market.gs': ['resolveInstrument_', 'runRefresh_', 'fetchYahoo'], 'Features.gs': ['importRow', 'previewImport', 'dailyJob'], 'Lots.gs': ['readPositions_', 'recordSell', 'editLot', 'addOwnedCore_'], 'Cash.gs': ['setAccountCash', 'applyCash_', 'saveUiPrefs'], 'Notes.gs': ['saveNote', 'setNote_', 'readNotes_', 'ensureSaleIds_'] };
  Object.keys(need).forEach(function (file) {
    need[file].forEach(function (fn) {
      if (typeof globalThis[fn] !== 'function') problems.push(file + ': function ' + fn + ' not found. The file is missing, empty or holds the wrong content.');
    });
    if (!problems.some(function (p) { return p.indexOf(file) === 0; })) passed.push(file);
  });
  const arity = { recordSell: 10, moveWatchlistToOwned: 7, exportCsv: 5 };       // changed signatures: an older copy still in the project is reported
  Object.keys(arity).forEach(function (fn) {
    if (typeof globalThis[fn] === 'function' && globalThis[fn].length !== arity[fn])
      problems.push('An older copy of ' + fn + ' is still in the project. Replace Code.gs, Features.gs, Lots.gs and Notes.gs with the new versions, and delete any old duplicate.');
  });
  if (typeof globalThis.cleanPrefs_ === 'function') {                 // v1.10.1: the last sort is saved; an older Cash.gs would silently forget it
    const v = cleanPrefs_({ cols: {}, view: { owned: { sort: 'name' } } }).view;
    if (!v || !v.owned) problems.push('An older Cash.gs is still in the project, so the last sort is not remembered. Replace Cash.gs with the new version.');
  }
  const html = function (name, test, what) {
    let c = '';
    try { c = HtmlService.createHtmlOutputFromFile(name).getContent().trim(); }
    catch (e) { problems.push(name + '.html: missing. Create it with + > HTML and type exactly "' + name + '".'); return; }
    if (test(c)) passed.push(name + '.html'); else problems.push(name + '.html: wrong content. ' + what);
  };
  html('index', function (c) { return /^<!DOCTYPE html>/i.test(c) && c.indexOf('id="tabs"') > 0 && c.indexOf('id="btnRefresh"') > 0 && c.indexOf('id="tabMore"') > 0 && c.indexOf('id="btnTheme"') > 0 && c.indexOf("include('client')") > 0; },
    'It must start with <!DOCTYPE html> and contain the page layout (id="tabs", id="btnRefresh", id="btnTheme", id="tabMore"). If your page is blank or the console says "Cannot read properties of null", this file holds something else, or it is an older copy: since the phone layout (v1.10) index.html, styles.html and client.html must be replaced together.');
  html('styles', function (c) { return /^<style>/.test(c) && c.indexOf('html.phone') > 0 && c.indexOf('.pc-also') > 0 && c.indexOf('.iomenu') > 0 && c.indexOf('data-theme') > 0; }, 'It must start with <style> and contain the phone layout rules (html.phone), the "also in" hint (.pc-also), the Import / Export menu (.iomenu) and the theme rules (data-theme). An older copy (before v1.13)? Replace index.html, styles.html and client.html together.');
  html('client', function (c) { return /^<script>/.test(c) && c.indexOf('function openImport') > 0 && c.indexOf('function openTabMore') > 0 && c.indexOf('function openNote') > 0 && c.indexOf('tkfilter') > 0 && c.indexOf('function openIoMenu') > 0 && c.indexOf('function cycleTheme') > 0 && /<\/script>$/.test(c); }, 'It must start with <script> and contain the page logic (it is the largest file). An older copy (before the theme button, v1.13)? Replace index.html, styles.html and client.html together.');
  html('symbols', function (c) { return c.indexOf('id="symbols"') > 0; }, 'It must contain the starter ticker list (<script type="application/json" id="symbols">).');
  const ss = ss_(), missingTabs = Object.keys(SHEETS).map(function (k) { return SHEETS[k]; }).filter(function (n) { return n !== SHEETS.NOTES && !ss.getSheetByName(n); });     // the Notes tab is created by the first note
  if (missingTabs.length) problems.push('Spreadsheet tabs missing: ' + missingTabs.join(', ') + '. Run setup().'); else passed.push('all spreadsheet tabs');
  const msg = problems.length ? 'PROBLEMS (' + problems.length + '):\n- ' + problems.join('\n- ') + '\n\nOK so far: ' + passed.join(', ')
    : 'All checks passed: ' + passed.join(', ') + '.';
  console.log(msg);
  return msg;
}
