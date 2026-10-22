# Notes-style Expenses (offline-first web app)

A minimal, dark, Notes-inspired expense list. Expenses are saved in IndexedDB on the device. Monthly totals update locally and include the configured recurring autopay amount.

## Features
- Notes-like scrolling month sections
- Quick entry: `Speakers. 2800`, `Lunch ₹250`, or `Coffee 250`
- Live month total based on the month section in view
- Monthly autopay included in each month's total (default ₹430)
- Edit/delete expenses
- Local settings
- Export and import JSON backups
- PWA manifest and service worker for offline app-shell caching
- No analytics, login, server-side expense database, or network calls for expense entry

## Run locally on your computer
1. Unzip the project.
2. Open the folder in VS Code.
3. Install the VS Code extension **Live Server**, or use a local static server.
4. Start the server and open the local URL in your desktop browser.

Service workers require `localhost` or HTTPS. Opening `index.html` directly using a `file://` URL will not enable offline app installation.

## Put it on your iPhone
For the easiest reliable installation:
1. Deploy the folder to a static HTTPS host, for example Cloudflare Pages.
2. Open the HTTPS URL in Safari on your iPhone.
3. Let the page load once while online.
4. In Safari, tap **Share → Add to Home Screen**. If offered, enable **Open as Web App**.
5. Open the Home Screen icon while still online once, then confirm it loads.
6. Turn on Airplane Mode and test adding an entry. The app shell should load offline and entries should still save locally.

Hosting the app makes its code/URL accessible to others. Expense data is not uploaded by this app: it is stored in local IndexedDB in the browser origin. Other people opening the URL on their own device will see their own empty data. Do not clear Safari website data if you want to retain the local records.

## Important data note
Browser storage is persistent for normal use, but no browser-local storage is a guaranteed permanent archive. Export a JSON backup regularly using **Export backup** and keep it somewhere safe. The backup contains your expense data; treat it as private.

## Deploy with Cloudflare Pages (one route)
- Create a GitHub repository and upload all files from this folder.
- In Cloudflare, create a Pages project connected to the repository.
- Framework preset: **None**; build command: leave empty; output directory: `/` (the repository root).
- Deploy, then open the assigned HTTPS URL on iPhone Safari.

You can also use any static HTTPS host that serves these files without a build step.

## How monthly total works
The large total follows the month section near the top of the scrolling list. It includes all recorded entries dated in that month plus the autopay amount from Settings. New expenses are dated to the current calendar date. To change the autopay amount, open the `•••` menu → Settings.

## Parsing entry amounts
The final number is treated as the amount:
- `Speakers. 2800`
- `Bought keyboard. 2,800`
- `Coffee ₹250`
- `Taxi 125.50`

If no amount can be detected, the app asks you to try again. Entries are recorded on the current date; use Edit to change a date.
