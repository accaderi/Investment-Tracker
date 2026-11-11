/**
 * TestMode.gs — TEMPORARY (spec Appendix D). Compares Google and Yahoo for every tracked instrument and logs
 * both results to a "TestLog" sheet. It never touches the main app's data. Delete this file after 3-5 days.
 *
 *   installTestTrigger()  -> hourly trigger that runs runTest() only in hours enabled on the Schedule tab
 *   runTest()             -> run once by hand (Run button) to take a sample right now
 *   removeTestMode()      -> deletes the test trigger and the TestLog sheet
 */
const TEST_HEADERS = ['Timestamp', 'Ticker', 'Source', 'Google Price', 'Google Quote Time', 'Google Status', 'Yahoo Price', 'Yahoo Quote Time', 'Yahoo Status', 'Price Match', 'Notes'];

function installTestTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'runTestScheduled') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('runTestScheduled').timeBased().everyHours(1).create();
}
function runTestScheduled() { if (shouldRunNow()) runTest(); }

function runTest() {
  const cfg = getConfig_(), ss = ss_();
  let log = ss.getSheetByName('TestLog');
  if (!log) {
    log = ss.insertSheet('TestLog');
    log.getRange(1, 1, 1, TEST_HEADERS.length).setValues([TEST_HEADERS]).setFontWeight('bold');
    log.setFrozenRows(1);
  }
  const rows = [], now = new Date();
  readInstruments_().filter(function (i) { return i.tracked; }).forEach(function (inst) {
    const notes = [];
    let gP = '', gT = '', gS = 'N/A', yP = '', yT = '', yS = 'N/A', match = 'N/A';
    if (inst.source === 'Google') {                         // read the Live cells exactly as they are (no nudge)
      const L = inst.live;
      if (String(L.price).indexOf('Loading') === 0) gS = 'Loading';
      else if (!isValidNum(L.price)) gS = 'Error';
      else {
        gP = L.price; gT = isDate_(L.time) ? L.time : '';
        gS = !isDate_(L.time) ? 'Error' : (ageHours_(L.time) > cfg.googleMaxAgeHours ? 'Stale' : 'OK');
      }
    }
    if (inst.ysym) {
      const y = fetchYahoo(inst.ysym);                      // 1 s spacing is enforced inside fetchYahoo
      if (y.error) { yS = 'Error'; notes.push('Yahoo: ' + y.error); }
      else {
        yP = y.price; yT = y.quoteTime || '';
        yS = isDate_(y.quoteTime) && ageHours_(y.quoteTime) > cfg.googleMaxAgeHours ? 'Stale' : 'OK';
      }
    } else notes.push('no Yahoo symbol');
    if (isValidNum(gP) && isValidNum(yP)) match = Math.abs(gP / yP - 1) < 0.005 ? 'Yes' : 'No';
    rows.push([now, inst.ticker, inst.source, gP, gT, gS, yP, yT, yS, match, notes.join('; ')]);
  });
  if (rows.length) {
    log.getRange(log.getLastRow() + 1, 1, rows.length, TEST_HEADERS.length).setValues(rows);
    log.getRange(2, 1, log.getLastRow(), 1).setNumberFormat('yyyy-mm-dd hh:mm');
    log.getRange(2, 5, log.getLastRow(), 1).setNumberFormat('yyyy-mm-dd hh:mm');
    log.getRange(2, 8, log.getLastRow(), 1).setNumberFormat('yyyy-mm-dd hh:mm');
  }
}

function removeTestMode() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'runTestScheduled') ScriptApp.deleteTrigger(t); });
  const s = ss_().getSheetByName('TestLog');
  if (s) ss_().deleteSheet(s);
}
