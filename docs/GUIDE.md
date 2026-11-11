# Investment Tracker: Installation & User Guide

Version 1.13 (Google Apps Script only) · November 2026

## 1. What you are installing

A personal portfolio tracker that lives entirely inside your own Google account:

- A **Google Sheet** is the database (Owned, Watchlist, Sold, Schedule, Log, Config, Symbols, Accounts, History, plus two hidden tabs, Instruments and FxRates).
- **Apps Script** is the backend. It also collects prices: `GOOGLEFINANCE` formulas first, and Yahoo Finance (fetched by the script) only for tickers Google cannot resolve or when a Google quote is stale or suspect.
- A **web app** (one page, five tabs) is the only place you edit data in normal use.

There is no server, no VM, no API key and no cost. Totals are shown in EUR (the fixed base currency in this version) and, unless you switch it off with `showHuf` (section 6), in HUF, across all currencies you hold.

**What it can do:**

- **Accounts, lots and selling:** the same stock can sit in several brokerage accounts. Every purchase is tracked as its own lot, and the Sell dialog shows each lot's return so you can choose which to sell (section 4.5).
- **Available cash per account** (optional): enter it once; buys and sales adjust it (section 4.11).
- **Bulk import** from pasted spreadsheet cells, an **Edit** dialog, **stock splits** and **CSV export** for tax time (sections 4.12 to 4.16).
- **History:** a daily portfolio-value snapshot with a chart (section 4.15).
- **Notes** on Watchlist items, positions and sales (section 4.20), and **research links** for each ticker (section 4.18).
- **A phone layout** of the same page (section 4.19), **light and dark themes** (automatic, or a switch in the header, section 4.1) and tables with resizable, hideable columns (section 4.17).
- An optional **email** when prices stop refreshing (section 7.4).

## 2. Before you start

- A personal Google account. The web app runs as you and is accessible only to you.
- About 20 minutes.
- A browser signed in to that Google account.

The `src` folder of this repository holds 14 files. On GitHub use **Code → Download ZIP**, unzip it, and keep the files in `src` open next to the Apps Script editor; you will paste each one in. Two small examples for the importer are in `docs`: `import-template.xlsx` (Excel, with an account drop-down) and `import-template.csv`.

- `Code.gs`, `Data.gs`, `Market.gs`, `Features.gs`, `Lots.gs`, `Cash.gs`, `Notes.gs`: the backend. All seven are needed.
- `TestMode.gs`: optional Google-vs-Yahoo comparison (section 7.2). Skip it if you do not want it.
- `Check.gs`: optional self-check. Running `checkInstall` names any file that is missing, empty or an older copy.
- `index.html`, `client.html`, `styles.html`: the page. `symbols.html`: the starting list for the Symbols tab, used once by setup.
- `appsscript.json`: project settings (time zone, permissions, web app access).

What the backend files hold: `Code.gs` (setup and the main actions), `Data.gs` and `Market.gs` (tickers, prices, currencies and the refresh), `Features.gs` (accounts, edit, split, import, history, export, alerts), `Lots.gs` (lots, positions and selling), `Cash.gs` (available cash and saved column layouts) and `Notes.gs` (notes on Watchlist items, positions and sales).

## 3. Installation, step by step

### 3.1 Create the spreadsheet

1. Go to sheets.new to create a blank spreadsheet.
2. Name it, for example, **Investment Tracker**. Leave it empty; the setup function builds every tab.

### 3.2 Open Apps Script and load the settings file

1. In the spreadsheet choose **Extensions → Apps Script**. A new tab opens with a project that is already linked (bound) to this sheet.
2. Rename the project (top left), for example **Investment Tracker**.
3. Click the gear icon (**Project Settings**) and tick **Show 'appsscript.json' manifest file in editor**.
4. Go back to the **Editor** (the `<>` icon), open `appsscript.json` in the file list and replace its entire content with the provided `appsscript.json`. **Change the `"timeZone"` line to your own time zone** (for example `"America/New_York"`, `"Europe/London"` or `"Europe/Budapest"`; the file ships with `"Etc/UTC"`). The schedule hours, the daily snapshot and the dates in the sheet all follow it. Save with Ctrl+S (Cmd+S on Mac).

This also requests the four permissions the app needs (spreadsheets, external requests for Yahoo, triggers, and sending email for the optional alert in section 7.4) and preselects the web app settings (run as you, only you).

### 3.3 Add the code files

The names matter and are case-sensitive, because the page loads its parts by name.

1. Open the existing `Code.gs`, select everything and paste the contents of the provided `Code.gs`.
2. Next to **Files** click **+ → Script**. Type `Data` (the editor adds `.gs`) and paste `Data.gs`. Repeat for `Market`, `Features`, `Lots`, `Cash` and `Notes`, then for `Check` (optional, but it makes checking the install easy) and, optionally, `TestMode`.
3. Click **+ → HTML**. Type `index` and paste `index.html`. Repeat for `styles`, `client` and `symbols` with their files. Do not type the `.html` yourself.
4. You should now see: `Code.gs`, `Data.gs`, `Market.gs`, `Features.gs`, `Lots.gs`, `Cash.gs`, `Notes.gs`, (`Check.gs`), (`TestMode.gs`), `index.html`, `styles.html`, `client.html`, `symbols.html`, `appsscript.json`. Save everything.

If you prefer the command line, the `src` folder works with `clasp push` as well. `clasp` writes a `.clasp.json` file that contains your script ID; it is listed in `.gitignore`, so never commit it.

### 3.4 Run the one-time setup

1. In the editor toolbar choose the function **`setup`** from the dropdown and click **Run**.
2. Google asks for authorization. Click **Review permissions**, choose your account, then **Advanced → Go to Investment Tracker (unsafe) → Allow**. The warning appears because the script is your own and has not been through Google's public verification; that is expected for personal scripts.
3. Wait for **Execution completed** in the log.

`setup` creates all tabs and headers, fills the Config tab with defaults, fills the Symbols tab with 37 starter tickers, seeds the Schedule (10, 14, 16, 18, 20 and 22 hours, weekdays only), creates the FX rows (USDEUR, GBPEUR, EURHUF), hides the two technical tabs and installs the two triggers (the hourly refresh and the daily job at about 23:00). It is safe to run again later: it never overwrites your data.

Setup also creates one account called **Main** and sets the spreadsheet's time zone to the script's. Rename it, and add your own accounts (for example one per broker), at any time in the Accounts tab.

**Upgrading to a newer release?** Replace **all** files, and `appsscript.json` (keep your own `"timeZone"` line), then run `checkInstall` (if you added `Check.gs`) and `setup` once more (it never overwrites your data), then publish a new deployment version as in section 3.8. Google asks you to authorize again if a release needs a new permission. Rows without an account show as **Main**: fix them with Edit, or rename Main in the Accounts tab.

### 3.5 Check the spreadsheet

Return to the spreadsheet tab (reload it if needed).

- Tabs visible: Owned, Watchlist, Sold, Schedule, Log, Config, Symbols, Accounts, History, CashLog, Notes.
- **View → Hidden sheets** lists Instruments and FxRates (you normally never touch these).
- In Apps Script, the clock icon (**Triggers**) shows two triggers: dailyJob (once a day, between 23:00 and midnight) and `refreshMarketData`, time-driven, every hour.
- If you added `Check.gs`, choose `checkInstall` in the editor's function dropdown and click **Run**: the log should say **All checks passed**.

### 3.6 Deploy the web app

1. In Apps Script click **Deploy → New deployment**.
2. Click the gear next to **Select type** and choose **Web app**.
3. Set **Execute as: Me** and **Who has access: Only myself**.
4. Click **Deploy** and copy the **Web app URL**. Open it and bookmark it (on a phone, use *Add to Home Screen*).

The first time you open the URL Google may ask you to authorize once more. Use the same Google account that owns the sheet. If you are signed in to several accounts and see 'Sorry, unable to open the file', open the URL in a private window and sign in with the right account only.

**Tip for experimenting:** **Deploy → Test deployments** gives a URL that always runs your latest saved code, without creating versions.

### 3.7 First-run checklist

Work through these once.

1. Open the web app. The Owned tab says **No data**.
2. Click **+ Add**, type `GOOGL`, pick `NASDAQ:GOOGL`. After a few seconds the dialog shows currency USD and **source Google**. Enter price, quantity and date, then **Add**.
3. Add `ETR:2B70`. Expect **source Yahoo** (Google cannot resolve Xetra ETFs).
4. Add `LON:VOD`. Expect currency **GBX** (pence) with amounts shown in GBP.
5. Click **Refresh Now**. The header shows a new 'Last updated' time and the button counts down its cooldown.
6. Open the **Log** tab and read the summary line for the refresh.

**Online search check.** In the Add dialog type a company name you have not added before, click **Search online**, and confirm that real matches appear. Try one US stock and one Xetra ETF, then note the result. If it says 'Online search unavailable', everything else still works; you just type the ticker yourself.

**Accounts check.** Open the Accounts tab and confirm that the account **Main** is listed (rename it and add your own). In the Add dialog, Account is the first field after the search, and the account you used last is pre-selected.

### 3.8 Updating the code later

Edit and save the files, then **Deploy → Manage deployments**, click the pencil on your deployment, set **Version: New version** and **Deploy**. The URL stays the same.

## 4. Using the app

### 4.1 Header and Refresh Now

The header shows when prices were last refreshed successfully and the next scheduled runs. **Refresh Now** runs the same job as the hourly trigger on demand, with a cooldown (60 seconds by default). Google's own formulas recalculate on Google's schedule and cannot be forced, so each row also shows its **Quote Time**, the timestamp of the price itself.

Tabs load when first opened and stay cached; the reload button (↻) on each tab fetches fresh data. Click a column header to sort, click again to reverse. Your last sort of Owned, Watchlist and Sold is remembered the next time you open the app, on every device; the filters are not, so you always start with the full picture.

**Light or dark.** The page follows your device's setting automatically. The round button to the left of **Refresh Now** changes that for the device and browser you are using: each click moves through **Automatic** (follows the device), **Light** and **Dark**, and a short message names the choice. Its icon shows the current choice: a half-filled circle (Automatic), a sun (Light) or a moon (Dark). The choice is remembered on that device only; your other devices keep their own. On a phone the same switch is also the last item of the **More** sheet (section 4.19).

### 4.2 Owned tab

- **Summary cards:** Total Portfolio Value in EUR and HUF, and Unrealised P/L in EUR.
- **Toolbar:** market filter, search, sort (Name A-Z (the default), Ticker, Allocation, P/L %, 52w proximity with stocks nearest their high first) and **+ Add**.
- **Table:** prices are in quote units exactly as your broker shows them; Total Cost, Total Actual and P/L are in the major currency (pence become pounds). Negative P/L is red, positive green, missing values show N/A.
- **Click a row** to sell. The trash icon deletes a row (see 4.6). The note icon next to the ticker opens the position's note (see 4.20).

**Accounts in this tab.** The first filter in the toolbar picks an account. The three cards, the Alloc % column and the sorts then work on that account alone; All accounts shows everything, and the same ticker held in two accounts appears as two rows. The pencil icon edits a holding, the toolbar's **Import / Export** menu opens the importer and the CSV export (sections 4.14 and 4.16), and clicking a ticker opens its menu with the research links and **Stock split...** (sections 4.13 and 4.18).

**Positions and lots.** Each row is a **position**: all purchases of one ticker in one account, shown with the total quantity, the weighted average buy price, the first and last buy dates and the number of lots. Click the arrow at the start of the row (or **Show all lots**) to open the lots. Each lot shows its buy date, days held, buy price, quantity, value, P/L and return, with the **best** and **worst** lot tagged, and has its own **Sell this lot**, edit (pencil) and delete (trash) buttons.

**The same ticker in several accounts.** Each account has its own position, so a ticker you hold in two accounts appears as two rows. Such rows carry a small blue line under the account name: "Also in Broker B: 12" when there is one other account, or "Also in 2 other accounts: 17.5" (the quantity held there in total) when there are more; hover over it to see every account with its quantity. The line looks at all your positions, whatever filters are set. **Click it** (on the phone, the "Show all" line under the card) to show every position of that ticker together: the account, market and search filters are cleared and a bar "Showing only NASDAQ:ASML · 3 positions" appears above the list, where **Show all** brings the full list back. The totals at the top do not change. With the default Name A-Z sort, the rows of one ticker already sit directly under each other, in account order, so no separate grouped view is needed; the hint matters most when you sort by something else, such as P/L %.

### 4.3 Adding a holding

1. Click **+ Add**. Type at least two characters and pause half a second; suggestions come from your Symbols tab, best matches first (exact symbol, then symbol prefix, then name), with a Search online link under them. Or type a full `EXCHANGE:SYMBOL` such as `NASDAQ:GOOGL` and press Enter.
2. The app resolves the ticker (usually 3 to 15 seconds) and shows the detected market, quote currency, source and current price.
3. Edit the instrument name if you like, then enter **Buy price in quote units** (pence for London stocks quoted in GBX), **Quantity** and **Buy date** (not in the future).
4. Click **Add**.

**Search online** asks Yahoo for matches (one call, kept for 5 minutes) and converts each result to this app's `EXCHANGE:SYMBOL` form. Only equities and ETFs on the supported exchanges are listed; the rest are dropped. A US listing is placed on NASDAQ, NYSE, NYSEARCA, NYSEAMERICAN or OTCMKTS from Yahoo's exchange code. If that venue differs from Google's, the ticker simply resolves through Yahoo instead. If Yahoo blocks the request you see 'Online search unavailable, type the ticker manually'; typing `EXCHANGE:SYMBOL` always works. Whatever you pick, the app still checks it against Google and then Yahoo and rejects it if both fail, so the list only suggests.

**The Symbols tab** (Ticker, Name, Market, Yahoo Symbol, Added At) is your suggestion list. Setup seeds it with 37 starter tickers that have no Yahoo symbol yet. Each time you confirm an add, the ticker is appended if it is new. A starter row gets its Yahoo symbol, and a placeholder starter name is replaced by the name you confirmed. Resolving without adding changes nothing. For tickers that resolved through Google, the stored Yahoo symbol is the app's suggested mapping, not one checked against Yahoo. The tab is visible so you can fix a name or delete a row by hand; keep Ticker in `EXCHANGE:SYMBOL` form. If the tab is empty or missing, the starter list is used.

**Account.** Every holding belongs to one account. Pick one from the list or type a new name, which creates it (names are matched ignoring capitals and extra spaces, so revolut and Revolut are the same). The same listing in another account is a separate row; the Watchlist rule is unchanged: a listing held in any account cannot also be watched.

Supported exchange prefixes: `NASDAQ`, `NYSE`, `NYSEARCA`, `NYSEAMERICAN`, `OTCMKTS` (US); `ETR` (Germany, Xetra); `LON` (UK); `EPA` (France); `AMS` (Netherlands); `BIT` (Italy); `BME` (Spain); `VIE` (Austria); `TSE` (Canada); `SWX` (Switzerland); `STO` (Sweden); `CPH` (Denmark); `BUD` (Hungary). To support another exchange, add a line to the `EXCHANGES` table at the top of `Market.gs`.

If resolving fails with 'Cannot resolve this ticker', a box appears where you can type the exact Yahoo symbol (for example `2B70.DE`) and retry. A ticker is the same listing only if the full `EXCHANGE:SYMBOL` matches, so `NASDAQ:ASML` and `AMS:ASML` are two different holdings and can coexist.

### 4.4 Buying more of something you already own

Add the same ticker again with **+ Add**, in the same account. The purchase is saved as a **new lot**: nothing is merged or averaged away, so you keep the real price and date of every purchase. The position row shows the total quantity and the weighted average price, and the lots are one click away.

### 4.5 Selling

Click a position row to sell from it, or open the position and click **Sell this lot** on the lot you want. The dialog lists every lot with its **return at the sell price**, so you can see which purchases are in profit before you decide.

- Enter the **Sell price** (pre-filled with today's price) and the **Quantity to sell**.
- Choose which lots to sell from: **Oldest first (FIFO)**, **Best return first**, **Worst return first**, or **I choose the quantities**, where you type a quantity next to each lot and the total follows. **Sell this lot** selects that lot in full.
- The preview shows how many lots are used and the realized P/L in the instrument's currency and in EUR. The FX rate to EUR is read-only and frozen at the sale; if none is available you must type one.
- Selling everything in every lot closes the position and offers **Add to Watchlist**.
- **Why are you selling?** is optional and is saved as the note of the sale. If the sale closes the position, the position's own note is added to it under the words "While held:" (see 4.20).

Each lot used becomes its **own Sold row** with that lot's real buy date and buy price, so realized P/L is exact per purchase and never based on an average. The FX rate is frozen once for the whole sale and never changes afterwards, and the Sold row keeps the lot id for traceability.

A sale always comes from one account's row, and the Sold row records that account. The offer to add the ticker to the Watchlist appears only when no other account still holds it.

### 4.6 Deleting a row

The trash icon on a **position** deletes the whole position (every lot); the trash icon on a **lot** deletes just that purchase. Neither creates a Sold record, so use them for data-entry mistakes only. To record a real sale use Sell. The Log notes every delete. Deleting a whole position or its last lot also deletes the position's note, and the confirmation says so; deleting one of several lots keeps it.

### 4.7 Watchlist tab

- **+ Add** works like the Owned dialog without price or quantity. A listing that you own cannot be added.
- **Click a row** to Pause or Resume it, or to **Move to Owned** (you enter price, quantity and date). If you try to add a watched listing to Owned, the app offers the move automatically.
- **Paused rows are frozen:** they are not refreshed and show their last saved price.
- **Remove all Paused** deletes every paused row after confirmation.
- Columns include the change versus the previous close (absolute and percent).
- **Notes:** the note icon (or the Note column) holds your entry idea for the ticker. Moving the row to Owned carries the note over as the starting note of the new position; deleting the row, or **Remove all Paused**, deletes the notes of the rows removed (see 4.20).

### 4.8 Sold tab

Read-only history with Total Realized P/L in EUR (the sum of the frozen values) and in HUF (that EUR total at today's EURHUF rate). The **+ Watchlist** button appears only for tickers that are currently on neither Owned nor Watchlist.

Filter by account and by year of sale: the two cards add up exactly the rows you have filtered, which gives a per-account figure for a tax year in one click.

Each sale can carry a note about why you sold (see 4.20). A sale that used several lots shows the same note on each of its rows, and changing it on one row changes it for the whole sale. The search box also looks inside notes.

### 4.9 Schedule tab

Tick the hours (in the time zone shown above the table, the script's) at which the refresh job should run, tick **Weekdays only** if you do not want weekend runs, and **Save**. One trigger fires every hour; most invocations check this table and exit at once. Triggers fire somewhere inside the hour, not at the exact minute. Active watchlist rows refresh on the same hours as Owned.

### 4.10 Log tab

Every refresh writes a summary line (counts per source and any Stale, Suspect or Error tickers). Adds, sells, deletes, schedule saves and failures are logged too. Filter by status, search, **Clear Log** (the header stays) or **Archive year...** (see section 7).

### 4.11 Accounts tab

Lists each account with its holdings, sold rows, **Invested** (the cost of what you still hold, at today's FX), **Value**, **Realized** profit from sales, **Available cash**, that cash in EUR, and a **Total** (value plus cash). **+ Add account** creates one, **Rename** changes the name everywhere at once (holdings, sold history, History and the cash log), and **Delete** is enabled only for an account that nothing uses and that has no cash balance. Typing a new name in Add, Move, Edit or Import also creates an account, so check this tab for typos.

**Available cash (optional).** Click **Set cash...** on an account and enter what its statement shows today, with the currency (EUR, HUF, USD and so on). From then on:

- Buying in the app (**+ Add**, or moving a watchlist row) deducts the cost and selling adds the proceeds, converted at today's FX when the currencies differ. Each of those dialogs has a checkbox if you do not want that one to count.
- **Adjust** adds or subtracts an amount for deposits, withdrawals, fees and dividends. **History** lists every movement (it is also kept in the CashLog sheet). The pencil sets the balance again whenever you want it to match your statement. Editing or deleting a holding never touches cash.
- Importing holdings does **not** touch cash unless you tick Deduct purchases in the import dialog, because imported holdings were paid for before.
- If no exchange rate is available, the purchase or sale is still recorded, the cash is left alone, and the message tells you to adjust it by hand.

Cash is an estimate: dividends, fees and interest are only included if you enter them with Adjust. When you select an account on the Owned tab, an Available cash card shows its balance.

### 4.12 Edit a holding

Click the pencil on a **position** to change its name or account; all its lots move together, and moving into an account that already holds the ticker joins the lots into one position. Click the pencil on a **lot** to correct that purchase's price, quantity or buy date. Editing is for correcting mistakes, not for recording trades: use Sell or + Add for those so the Sold history stays right. Every edit is logged with the old and new values.

### 4.13 Stock split

When a company splits its shares, click its ticker on the Owned tab and press **Stock split...** in the title of the menu that opens (on a phone, tap the ticker and use the same button in the sheet). The dialog opens with that ticker selected; enter 'for every N old shares you now hold M'. The dialog previews each position. Every lot of that ticker, in every account, has its quantity multiplied and its buy price divided by the ratio, so the total cost of each lot is unchanged; a reverse split works the same way (1 new for 10 old). Sold history is left as recorded. Afterwards click Refresh Now, because until prices catch up a split can make a quote look Suspect.

### 4.14 Export to CSV

**Import / Export, then Export to CSV...** on Owned (or the plain Export... button on Sold) creates a CSV for one account or all (and a year of sale for Sold). For Owned you can choose one row per position (average price and lot count) or one row per lot (each purchase with its days held and lot id). Choose the European format if your Excel expects semicolons and decimal commas, otherwise Standard. **Download .csv** saves the file; if your browser blocks the download, use Copy to clipboard or select the text in the box. A name that starts with = + - or @ gets a leading apostrophe so a spreadsheet never runs it as a formula; notes get the same protection. The exports of Owned positions, Owned lots and Sold end with a Note column holding the note (see 4.20).

### 4.15 History tab

One snapshot of portfolio value is recorded every day between 23:00 and midnight in the script's time zone: one row per account plus an ALL row, in the History tab. The page draws value in EUR over 30 or 90 days, a year, or everything, for all accounts or one. It shows value, not performance, because buying and selling also move the line. Each day uses the prices and FX rates available when it was recorded. Days with a missing price or FX rate are left out of the chart rather than guessed (the Missing column counts the holdings without data). **Record snapshot now** takes one immediately; a second snapshot on the same day overwrites the first.

### 4.16 Importing many holdings at once

The importer works from pasted cells, so Excel and Google Sheets both work, and it applies the same checks as adding by hand.

**Part A: prepare the data (about 10 minutes)**

1. In Excel or Google Sheets put one holding per row under a header row. Your own layout is fine; the app lets you say which column is which. Useful columns: **Ticker** (required), Quantity, Buy price, Currency, Buy date, Account, Name, Broker and Action (Owned / Watchlist / Skip). A row without a buy price and quantity becomes a Watchlist candidate. `docs/import-template.xlsx` (Excel, with sample rows and an account drop-down) and `docs/import-template.csv` show the idea.
2. Plain symbols such as ADI are fine, the app looks up the listing. For ETFs and non-US shares the exact `EXCHANGE:SYMBOL` (for example `ETR:2B70`) is more reliable.
3. Select the cells, including the header row, and copy them (Ctrl+C).

**Part B: import in the app**

4. Open the web app, stay on the **Owned** tab, click **Import / Export** in the toolbar (next to + Add) and choose **Import from spreadsheet...**.
5. Click in the large text box and press **Ctrl+V**. Leave Numbers use on Auto-detect. Set Buy date for rows without one only if some Buy Date cells are empty. Fill Account for rows without one if the whole list belongs to one account. Click **Read data**.
6. The next screen asks what each column holds. The app guesses from the header names; correct any wrong guess and click **Continue**. Columns set to (ignore) are not used.
7. Wait while it says Finding listings (about a second per row). Then a table appears with one row per line of your list. Plain symbols such as ADI have turned into NASDAQ:ADI. Where a drop-down says pick listing..., choose the right exchange. The Status column shows **Ready** or a red problem.
8. Fix red rows by typing in the cell (Account, Ticker, Buy date, Buy price, Qty and Currency can be edited), or set their Action to Skip. To set an account or an action for many rows at once, tick the rows (or use the Select buttons, one per value of the Broker column) and use the **With the selected rows** line.
9. Click **Import N row(s)** and keep the dialog open until it finishes; a list of about 40 rows takes 5 to 10 minutes. Each row shows importing... and then Imported. A row that is refused stays in the table in red with the reason, and nothing is written for it.
10. Fix the refused rows in place and click **Import** again; only the unfinished rows are retried. If a price really is in pence, change its Currency from GBP to GBX. If a symbol picked the wrong listing, type the exact EXCHANGE:SYMBOL in the Ticker cell, or set the row to Skip and add it with + Add.
11. Click **Close**, then check the Owned, Watchlist and Accounts tabs.

To rehearse first, paste only the header row and three data rows.

**Accounts.** An account named in your list that does not exist yet is **created by the import**; the preview says "New accounts that will be created: ..." before anything is written. Names are matched without regard to upper and lower case, so `broker a` uses `Broker A`, but a typo such as `Brokr A` would create a new account, so read that line before you click Import.

**Lots and existing holdings.** Every imported row becomes its own lot, so a list with several purchases of the same ticker and account gives several lots. The setting **If a holding already exists in that account** decides what happens when the account already holds the ticker: **Skip it** (the default, so importing the same list twice cannot double your quantities), **Add as a new lot**, or **Replace it**, where all its lots are replaced by the one imported lot.

**Import and cash.** If the accounts you import into track available cash, tick **Deduct purchases from the accounts' available cash** only when the list contains purchases you have not yet paid for in the cash figure. For a list of holdings you already own, leave it off.

**Safety check.** If the Currency column disagrees with what the listing really trades in, the row is refused instead of imported with the wrong unit.

**What the importer typically flags:**

- **A price that looks like pence while the currency says GBP**, or an unusual quantity: refused until price and currency agree.
- **A plain symbol whose default listing trades in another currency than your Currency column** (for example a EUR-priced UCITS ETF whose plain symbol is the US ETF, which trades in USD): refused as a currency mismatch; type the exact EXCHANGE:SYMBOL of the listing you hold.
- **Quantity 0, or something that is not a real ticker:** shows as a problem until you fix it or set it to Skip.
- **Rows with no buy price:** import as Watchlist candidates (set the ones you do not want to Skip).
- **A typo in the Broker column** gives an extra Select button; fix the cell, or ignore the column and use Account.

### 4.17 Columns, widths and layout

Every table has a **Columns** button. Untick the columns you do not need; the first column and the buttons always stay. Drag the edge of a column header to resize it, or double-click the edge to fit the column to its content. The first column (the ticker) stays in place when you scroll right, and the edit and delete buttons stay pinned at the right edge. Your widths and hidden columns are saved and come back on every visit.

The page itself does not scroll: the header, tabs, cards and toolbar stay in view and only the table scrolls, so there is a single pair of scrollbars. On a phone the page scrolls normally and uses its own layout (section 4.19). The scrollbars follow the light or dark theme.

### 4.18 Research links

Click a ticker in the Owned, Watchlist or Sold tab to open a small menu of research pages. Each choice opens in a **new browser tab**, so the app stays where it was:

- **Yahoo Finance** (quote, chart and key statistics) and **Yahoo Finance: analyst view** (ratings, price targets and estimates). The link uses the Yahoo symbol the app stored when the ticker was added, so listings such as `ETR:2B70` open as `2B70.DE`.
- **Perplexity Finance** for US-listed stocks, which opens that ticker's page. For other listings (Europe, Hungary, Canada, OTC, class shares such as BRK.B) it opens a Perplexity search for the name and ticker instead, asking for analyst ratings, targets and outlook.
- **Google Finance** for the same listing; not every exchange-traded fund exists there.

The links are only shortcuts to third-party sites. Analyst ratings are opinions, and ETFs usually have none, so treat them as one input and not as advice. Clicking anywhere else on a row still opens Sell, and the arrow still opens the lots.

On the Owned tab the title of this menu also holds a **Stock split...** button, which opens the split dialog for that ticker (section 4.13). It is not offered on the Watchlist and Sold tabs, because a split concerns shares you hold.

### 4.19 Using it on a phone

The same web page adapts to a narrow screen (up to 760 px wide, or a phone held sideways), so there is nothing extra to install: open the same URL on the phone. The layout switches by itself when you rotate the phone or resize the window.

- **Tabs.** A bar at the bottom holds Owned, Watchlist, Sold, Accounts and **More**; More opens History, Schedule and Log.
- **Light or dark.** The button next to Refresh Now (and the **Theme** row at the bottom of **More**) switches between Automatic, Light and Dark, as described in section 4.1.
- **Cards.** Every holding, watchlist row, sale and account is a card. On Owned, tap a card (anywhere except the ticker) to open it: the details, one block per lot with **Sell this lot**, edit and delete, and **Sell...**, **Edit** and **Delete** for the whole position. Tap the ticker itself for the Yahoo, Perplexity and Google links and, on Owned, Stock split...
- **Search and filters.** The search box is always visible. **Filters** unfolds the account, market, status or year choices and the sort order, and shows how many filters are active. The **...** button holds the rest: Reload, Export, Import, Expand all, Remove all Paused, Archive year and Clear Log.
- **+ Add.** The round button above the tab bar adds a holding, a watchlist row or an account. It steps aside while you scroll down and returns when you scroll up.
- **Dialogs.** They slide up from the bottom, with large buttons and fields. In the Sell dialog each lot is a small card with its own quantity box, so you can still sell any combination of lots. The page behind does not scroll while a dialog is open.
- **Schedule.** The hours are tap buttons (blue = refresh in that hour) instead of a table of checkboxes.

Three things stay easier on a computer: choosing and resizing columns (cards show a fixed set of fields), the bulk **Import** (it edits a wide table, which scrolls sideways on a phone), and reading many columns side by side.

**If the phone still shows the old layout,** the new files are not live yet: check that index.html, styles.html and client.html were all replaced and that you made a new deployment version (section 3.8), then reload the page. Running `checkInstall` in the editor reports a mix of old and new files. The layout was checked in a real browser emulating phones 320 to 430 px wide, in light and dark mode, but not on a physical phone: if something looks wrong on yours, note the phone and browser and report it.

### 4.20 Notes

Every Watchlist item, Owned position and sale can carry a free-text note of up to 4,000 characters. The three lists use notes for different things, so each keeps its own kind:

- **Watchlist note** (one per ticker): your entry idea, for example "buy below 90 or after the next earnings".
- **Owned note** (one per position, that is per ticker and account): your plan for the holding, such as when to sell or whether to buy more. A ticker held in two accounts is two positions with two notes, because the plan for a pension account is often not the plan for a taxable one.
- **Sold note** (one per sale): why you sold. A sale that used several lots is still one sale, so its Sold rows share one note.

**Opening and editing a note.** On the desktop a small note icon sits next to the ticker (it shows when you point at a row, and turns filled and coloured once the row has a note), and a **Note** column before the action icons shows the start of the text. Click either one. On the phone the icon sits next to the ticker in the card header and the note shows as up to three lines under it; tap them to edit. The editor shows a character counter. **Save** stores the note, **Ctrl+Enter** (Cmd+Enter on a Mac) does the same, and **Clear** removes it. The text is kept exactly as you type it, so a note that starts with = or - stays plain text. The Note column can be resized or hidden with **Columns** (section 4.17), and the search box on each tab also looks inside notes.

**Notes in the dialogs.**

- **+ Add** has an optional Note field. If you add to a ticker you already hold in the same account, the text is appended under the existing note.
- **Move to Owned** shows the Watchlist note in a Note field, so you can keep it as the starting Owned note, rewrite it, or empty it.
- **Sell** shows the position's note as a reminder and has a field **Why are you selling?** that is saved as the note of the sale. In a partial sale the position keeps its note. When the sale closes the position, the position's note is copied into the sale note under your reason, after the words "While held:", and the Owned note itself is deleted; the idea behind the position stays with the sale record.

**What happens to a note when things change.**

- Moving a Watchlist item to Owned carries its note over, as described above.
- Changing a position's account with Edit moves its note along, and joins it to the note of the target position if that one has one. Renaming an account renames the account on its Owned notes.
- Deleting a Watchlist row, **Remove all Paused**, deleting a whole position, or deleting the last lot of a position deletes the note as well (the confirmation says so). Deleting one lot of several keeps it.
- **Archive year** (section 7.1) clears the Sold tab, with the notes on its sales, but keeps Watchlist and Owned notes.
- The CSV exports (section 4.14) end with a Note column.

**Where notes live in the spreadsheet.** Watchlist and Owned notes are in a tab called **Notes** (columns List, Ticker, Account, Note, Updated At). You can read or edit it there: List is `Watch` or `Owned`, and an Owned note needs the account spelled as in the Owned tab. Sale notes are in two extra columns at the end of the Sold tab, **Sale ID** and **Note**; the Sale ID ties the rows of one sale together, so do not delete or change it. Both are created automatically the first time they are needed, which is why you do not have to run `setup` again after upgrading.

## 5. Prices, units and statuses

### 5.1 Where a price comes from

Every price the page shows goes through one function, `getMarketData`.

- **Google rows:** the live formula cell is used only if it is valid: numeric, has a trade time, quoted in the expected currency and inside the sanity limits. Otherwise the last good saved snapshot is shown with a flag.
- **Yahoo rows** (Xetra ETFs, Budapest, dotted Canadian tickers such as `U.UN`): the snapshot written by the refresh job.
- **Paused watchlist rows:** snapshot only.

### 5.2 Status badges

No badge means OK. Hover a badge to see the Quote Time and source.

- **Stale** (grey): the quote's own timestamp is older than 5 days, or Google was behind and Yahoo could not be reached.
- **Suspect** (orange): the quote failed a sanity check, or its currency changed. The last good value is kept.
- **Error** (red): no value at all from either source.

### 5.3 Sanity checks

A new quote must be a positive number, inside the 52-week low and high widened by 5 percent, and within 40 percent of the previous close. During testing Yahoo once returned a wrong price for a Budapest stock; these rules catch that. A genuine stock split can also trip the checks; split adjustment is manual in this version.

### 5.4 Pence and other units

London shares quoted in pence (`GBX`) keep prices in pence, matching your broker, while Total Cost, Total Actual and P/L are in GBP and convert to EUR with the GBP rate. The currency is always the quoted currency of the instrument, never inferred from the exchange: London lists GBX, GBP and USD instruments.

### 5.5 Totals

Total EUR is the sum of each holding's value times its FX rate to EUR. Total HUF is the EUR total times EURHUF. HUF holdings convert with 1 divided by EURHUF. If any price or FX rate is missing the totals show **N/A** with a warning naming the culprits, never a silently wrong number.

### 5.6 Freshness of Google quotes

Each refresh first rewrites the live formulas (the 'nudge') to prompt Google to recalculate, waits up to three times 2 seconds for cells showing Loading..., and only then evaluates them. For Google rows whose quote is older than 30 hours (not on weekends or Monday before noon) the script cross-checks Yahoo, and uses it if its timestamp is more than 60 minutes newer.

## 6. Settings (Config tab)

Edit the values in column B. Changes apply on the next call.

- `yahooFetcher` (GAS): GAS = the script fetches Yahoo; VM = an external refresher owns Yahoo rows; OFF = no Yahoo calls at all.
- `sanityTolerancePct` (5): allowed percent outside the 52-week range.
- `maxDailyMovePct` (40): largest allowed move versus previous close.
- `staleQuoteDays` (5): age at which a quote becomes Stale.
- `refreshNowMinIntervalSec` (60): cooldown between manual refreshes.
- `googleMaxAgeHours` (30) and `googleLagMinutes` (60): control the Yahoo cross-check.
- `liveReadRetries` (3): retries for cells showing Loading...
- `showHuf` (TRUE): set to FALSE to hide the HUF cards if you do not need them. EUR is the fixed base currency in this version; prices in other currencies (USD, GBP, GBX, HUF and so on) are converted to EUR.
- `baseCurrency`: informational; EUR is fixed in version 1.
- `lastSuccessfulRefresh`: written by the app.

## 7. Maintenance

### 7.1 Year rollover

Log tab → **Archive year...** copies the whole spreadsheet to `Investment_<year>` and then clears **Sold** and **Log** to start a fresh year. The notes on sales are cleared with the Sold rows (they stay in the archive copy); Watchlist and Owned notes stay with their rows. **Owned and Watchlist are kept**, because they hold your live positions. If you want them cleared too, change `archiveYear` in `Code.gs`.

### 7.2 Test Mode (optional, 3 to 5 days)

An open question is whether Google cells stay fresh when nobody opens the sheet. To measure it:

1. Add a few real tickers (a US stock, a Xetra stock, a London stock).
2. In the editor run **`installTestTrigger`**. On every scheduled hour it logs Google and Yahoo side by side to a new **TestLog** sheet. You can also run **`runTest`** by hand at any time.
3. After a few days compare quote times and match results. Mostly fresh: keep Google primary. Often stale: rely on the nudge and cross-check. Stale even after the nudge, or Yahoo flaky: consider moving the refresh to the VM (section 10).
4. Finish with **`removeTestMode`**, which removes the trigger and the TestLog sheet, and delete `TestMode.gs`.

Test Mode roughly doubles Yahoo calls while it runs.

### 7.3 Backups and quotas

Google Sheets keeps **File → Version history**; also make an occasional copy of the sheet. Apps Script has daily limits on trigger runtime and URL fetch calls; check the current figures on Google's Apps Script quotas page. A normal run with a handful of tickers takes tens of seconds and the hourly trigger exits immediately outside scheduled hours, so personal use should sit far below the limits.

### 7.4 Failure alert email (optional)

A daily check at about 23:00 can email you when prices have stopped refreshing. In the Config tab set `alertEmail` to your address, or to the word `me` for the Google account that owns the script; leave it blank for no alerts. `alertAfterHours` (default 26) is how old the last successful refresh may be. The check is skipped at weekends when the Schedule is weekdays-only, at most one email is sent per day, and the Log records it. Run `sendTestAlert` once from the editor to confirm that mail arrives.

Sending email needs one extra permission (`script.send_mail`, already listed in `appsscript.json`), which Google asks for when you re-authorize after upgrading. To drop the feature, delete that scope line and `healthCheck_` in `Features.gs`; nothing else depends on it.

## 8. Troubleshooting

- **'Missing sheet ... Run setup()':** run `setup` from the editor once, from a script opened through the sheet's Extensions menu.
- **Blank page or 'unable to open':** wrong Google account; use a private window and sign in with the owning account only. Also re-open the deployment URL after authorizing.
- **'Unable to open file with name styles' (or client, symbols):** an HTML file is missing or named differently. Names must be exactly `index`, `styles`, `client`, `symbols`.
- **'Script function not found: doGet':** `Code.gs` was not saved or not pasted fully.
- **Changes are not visible:** you are on an old deployed version. Use Manage deployments → New version, or use the test deployment URL.
- **Add dialog says 'Cannot resolve':** check the prefix and symbol (the format is `EXCHANGE:SYMBOL`), retry once in case Google was still loading, or enter the Yahoo symbol in the override box. If Search online says unavailable, Yahoo is blocking the request: wait a minute and try again, or type EXCHANGE:SYMBOL, which never depends on it.
- **Prices show N/A or Error:** click Refresh Now. If it persists, unhide Instruments (View → Hidden sheets) and look at columns J to O of that row; a persistent empty value means Google does not know the symbol, so remove and re-add it so it resolves via Yahoo.
- **Everything is Stale:** read the latest Log lines. 'Fetch failed' for Yahoo means throttling or a changed endpoint; try again later.
- **Totals are N/A:** a currency pair is missing a rate. Unhide FxRates and check that Live or Rate is filled for the pair named in the warning.
- **No automatic refreshes:** open the Triggers page and confirm the hourly trigger exists; check the hours ticked on the Schedule tab; check the Log for 'Could not get the lock' warnings.
- **Archive year fails with a permission error:** add `https://www.googleapis.com/auth/drive` to `oauthScopes` in `appsscript.json`, then run any function and re-authorize.
- **Never edit** the hidden tabs by hand, and avoid renaming tabs or header cells.

**More problems and fixes:**

- **A row shows account Main:** a row without an account is shown as Main; use Edit on it, or rename Main in the Accounts tab.
- **Import says 'No listing found':** Yahoo had no match for that symbol, or its search was unavailable. Type EXCHANGE:SYMBOL in the Ticker cell, or pick one from the listing dropdown.
- **Import refuses a row with 'Currency mismatch' or 'pence':** the row's currency is not what that listing trades in. Fix the currency or price, or choose another listing.
- **A row says 'Account is required':** use the Account cell, or select rows and apply an account to them.
- **History is empty:** the first snapshot is recorded at about 23:00, or click Record snapshot now. Gaps mean a price or FX rate was missing that day.
- **No alert email:** check that alertEmail is a valid address or me, run sendTestAlert, and confirm you authorized the mail permission after upgrading.
- **CSV opens as one column in Excel:** export again with the European format (semicolons and decimal commas).

**Install problems.** The error 'Syntax error: Unexpected token <, line 1, file Features.gs' means HTML was pasted into a .gs file, and the browser error 'Cannot read properties of null (reading addEventListener)' means `index.html` does not hold the page layout. Both are paste mix-ups between files. Each file must start with: any `.gs` file with `/**`; `index.html` with `<!DOCTYPE html>`; `styles.html` with `<style>`; `client.html` with `<script>`; `symbols.html` with `<!--`; `appsscript.json` with `{`. Fix the file named in the error (select all, delete, paste the right file), then add the optional `Check.gs` and run `checkInstall`: it lists wrong or missing files in plain words. The `src` folder also works with `clasp push`, which avoids pasting altogether.

**Lots.** A holding row without a Lot ID becomes one opening lot automatically when the Owned tab first loads; there is nothing to do. If a sale says a lot is not part of the position, reload the page, because it was open on old data. Do not edit the Lot ID column in the Owned or Sold sheet by hand. If `checkInstall` says an older copy of `recordSell` or `exportCsv` is still in the project, replace `Code.gs`, `Features.gs` and `Lots.gs` with the new versions and delete any duplicate.

**Cash and layout.** 'Cash was NOT updated (no FX rate...)' means there is no exchange rate yet for that currency: click Refresh Now, or correct the cash with Adjust. If a column layout does not stick, open Columns and use Show all columns or Reset column widths, then set it up again. If the Owned tab shows no Available cash card, the selected account has no cash set (Accounts tab, Set cash...).

**Notes.** If `checkInstall` says `Notes.gs: function saveNote not found`, the file `Notes.gs` was not added (create it with + > Script and paste the content). If it says an older copy of `recordSell` or `moveWatchlistToOwned` is still in the project, replace `Code.gs`, `Features.gs`, `Lots.gs` and `Notes.gs` with the new versions. If the page shows no note icons, `client.html` and `styles.html` are older copies: replace `index.html`, `styles.html` and `client.html` together and publish a new deployment version. A message "A note can hold at most 4000 characters" means exactly that; shorten the text. "That sale was not found. Reload the page." appears when the Sale ID in the Sold tab was edited or deleted by hand or the sale was archived meanwhile.

## 9. Known limitations and what is not yet verified

**How this was tested.** The backend logic (resolve, DCA, sells, FX freezing, sanity checks, paused rows, refresh and cross-check, schedule), the importer on a realistic holdings list, and the page were exercised against a simulated spreadsheet and a real Chromium browser: 474 automated checks when the desktop version was built, then a separate suite for each later addition. On the final files of this release these suites all passed (they are not part of this repository): backend and notes logic (94 checks), desktop layout (19), phone layout in emulated phones 320 to 430 px wide (102), remembered sorting (24), notes in the page (54), the "also in" hint (53), and the one-row toolbar with the Import / Export menu and the split option (60), in light and dark mode. That cannot reproduce Google's live services, so the following must be confirmed on your own account, and Test Mode (section 7.2) is the tool for the first two:

- Whether rewriting the GOOGLEFINANCE formulas really forces a recalculation when run from a trigger.
- Freshness of Google quotes when the sheet is closed, and Yahoo reliability over several days.
- FX pairs other than USDEUR, GBPEUR and EURHUF; the `name` attribute for ETFs; Yahoo suffixes other than `.DE`, `.L`, `.TO` and `.BD`.
- Apps Script quotas, the copy permission used by Archive year, and the Search online call to Yahoo's search endpoint (try it once from Apps Script).

The following also could not run in the test environment: the new mail permission and alert email, the 23:00 daily trigger, the CSV download from the page (browsers differ; the text box always works) and the importer's Yahoo lookup of exchanges. The first import is the real test of that lookup, so watch the preview before you click Import.

**Design limits.** Single user. Google data can be about 20 minutes late. Hourly triggers are not minute-exact. The Yahoo endpoint is unofficial and may change, and Search online uses the same service. Stock splits are applied by hand (section 4.13). Dividends and fees are not part of P/L: you can record them in an account's cash with Adjust (section 4.11), but the P/L figures follow prices only. The suggestion list grows only from your own adds plus the starter list. Only pence (GBX) is handled as a minor currency unit.

## 10. Upgrade path

The design keeps a seam for an external price refresher: all prices are read from the Instruments snapshot columns, derived values are never stored, and writers match rows by ticker. To add an external refresher later (for example on a small VM), port it so it writes the snapshot columns with `Writer = VM`, then set `yahooFetcher` to `VM` in Config. Nothing in the page or the business rules changes.
