# Usman Stationary

Windows Electron application for distribution, inventory, POS and PKR accounting. React UI, Express API, MySQL/MariaDB production database and SQLite for local development. The desktop connects to **https://store.aleemcore.com** by default. No customer data, passwords or database files belong in this public repository.

## Local development

Use Node **22.13+** (or Node 24). Open PowerShell in the project:

```powershell
npm ci
$env:SETUP_KEY='choose-a-long-random-setup-secret'
npm run server
```

In a second terminal run `npm run dev`, then open http://127.0.0.1:5173. Create the administrator using your setup key and a password of at least 12 characters. The empty database is intentional: add your own items, opening stock and contacts. For the desktop run `npm run build` and `npm run desktop`; sign in with your server URL (http://127.0.0.1:4000 for local testing).

`npm test` runs local checks (MySQL integration is skipped without `MYSQL_TEST_MODE=1`). GitHub CI also runs integration checks against real MySQL 8.4 and MariaDB 11.4, including concurrent oversell prevention. It checks accounting, stock, return limits, report generation, atomic rollback, authentication, session revocation and the API. `npm run ui:check` uses an isolated local QA database and Edge to check navigation and checkout (start the API with `DB_PATH=data/qa.db`, `QA_MODE=1` and `SETUP_KEY=local-ui-test-only-setup` first). It refuses to seed an API that is not marked for QA. `npm run desktop:check` verifies the bundled Electron renderer and native printer/PDF bridge against that QA API. `npm run dist` produces the Windows installer in `release/`.

## Included workflows

- Dashboard with actual sales, receivables/payables, stock alerts and recent transactions.
- POS with keyboard barcode scanning, invoices, immutable sale history, quotations and sale orders. Use a quotation/order as a starting point for an invoice.
- Purchases, purchase orders, original-invoice-linked sale and purchase returns with cumulative quantity limits and original prices/taxes/discounts.
- Item catalog, opening stock, weighted-average purchase cost, low-stock limits, categories, units and item-level batch/serial identifiers. Code 128 barcode generation and A4 label printing.
- Customers/suppliers with WhatsApp phone numbers, expenses/categories, cash and bank opening balances, transfers, receipts and payments.
- Per-line taxes and discounts by percentage or fixed PKR amount. Amounts stored as integer paisa, with server-side calculations.
- A4, 80 mm and 58 mm document layouts, Windows printer selection and PDF export. Barcode labels use a normal A4 printer.
- WhatsApp opens a prefilled document summary addressed to the contact. Save the PDF and attach it manually in WhatsApp to share the file; this is not unattended WhatsApp Business API delivery.
- All **34** reports from the supplied screenshots, with date filters, CSV export and print/PDF. Party/item filters apply to relevant reports. Accounting statements use cumulative end-date balances.
- Backup export and a server-side restore script. Passwords and sessions are excluded from exported business backups.

## Hostinger Business deployment

Hostinger documents Express/Node.js support on Business plans. See [their current Node.js deployment guide](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/).

1. In hPanel, add a **Node.js Web App**, connect `Aleem33/Usman-Stationary`, and select `main`.
2. Set the application root to **server**, framework **Express**, Node **22** (22.13+) or **24**, entry **index.js**, install command **npm ci**, start command **npm start**. The API is a separate package and does not install Electron. Set the build command to `npm run build`; this checks the backend JavaScript syntax. Leave the output directory empty. The entry file must be `index.js` relative to the `server` application root.
3. Bind the custom domain **store.aleemcore.com** to this Node.js application, enable SSL and let hPanel configure the domain routing. Existing files on a different website root do not automatically expose this API.
4. Create a MySQL database under **Databases → Management**. Keep the full database name and username, including Hostinger's `u..._` prefix. Add environment variables from `.env.example` in hPanel: `DB_CLIENT=mysql`, `DB_HOST=127.0.0.1`, `DB_PORT=3306`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `HOST=0.0.0.0` and a random `SETUP_KEY`. Keep an existing Hostinger-assigned `PORT`; if a value is required and none is assigned, the app default is `4000`. Do not use `DB_PATH` for MySQL. Keep the database password and setup key out of GitHub.
5. Deploy/restart the backend. The entry file starts listening immediately to support Hostinger’s imported-entry loader, then initializes the database. During initialization, the API returns HTTP 503 with `status: starting`; readiness becomes healthy only after all tables are available. It connects to your existing MySQL database and creates all tables automatically; no phpMyAdmin SQL import is necessary. Table creation needs the normal CREATE privilege on that database. Production requires MySQL credentials and refuses to fall back to a temporary SQLite file. Backend 1.0.3 is compatible with the existing Windows 1.0.0 client.
6. Open `https://store.aleemcore.com/api/health`; it should return `ok: true`. In the desktop app create your admin with the setup key. After the account exists, remove the setup key from hPanel. It is not needed for subsequent sign-ins.
7. Export backups regularly and verify recovery into a separate database. Managed hosting deployment, DNS, SSL and physical printer output must be checked on your account/devices.

The repository can deploy the backend alone from `server/`. The desktop UI is bundled into the installer. The API does not need to serve the frontend on Hostinger.

## GitHub releases and automatic updates

The Windows installer uses `electron-updater` with `Aleem33/Usman-Stationary` public GitHub Releases. Follow [electron-builder's auto-update documentation](https://www.electron.build/auto-update.html).

1. For a desktop update, increase the root package version (`npm version 1.0.1 --no-git-tag-version`), commit changes and push the matching tag, e.g. `v1.0.1`. The backend has its own package version and can be deployed separately without reinstalling the desktop.
2. `.github/workflows/release.yml` tests, builds and uploads the installer, blockmap and `latest.yml`. Its default release is a **draft**. Review it, then publish the draft in GitHub Releases to make it available to installed clients.
3. For Windows signing, set repository secrets `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD` to your signing certificate and password. Without a certificate builds are unsigned and Windows may show SmartScreen warnings.
4. The installed app checks at startup and supports manual checks in Settings. Updates download automatically; installation requires a deliberate restart so an unfinished checkout is not lost. Updating source code alone does not update installed apps; publish a higher-version GitHub Release with all metadata.

Do not embed a GitHub token in the application. Keep this release repository public, or configure a separate authenticated update service for private distribution.

## Accounting and operational boundaries

The API posts double-entry accounts and stock changes in a single transaction. Negative stock and excessive returns are rejected. Business dates default to Asia/Karachi; currency is PKR. Taxes are user-configured calculations; no statutory tax filing integration is included.

This first release is an online, single-store, single-administrator application. No offline synchronization, multi-user roles, full per-unit serial tracking, batch expiry allocation, bank reconciliation/import, or order fulfillment lifecycle is implemented. Batch/serial reports show item-level identifiers. Orders and quotations are immutable informational documents; using one for an invoice copies its lines and does not track partial fulfillment. Receipts/payments post to the party ledger rather than allocating against individual invoices. Invoice Paid/Balance fields show payments at posting time; the party statement includes later receipts/payments.

Stock summaries report end-date quantities at **current** weighted-average cost, not historical valuation. Keep these report notes in mind when comparing periods. Financial balances require complete opening balances and transaction entry; have your accountant verify your starting ledger before relying on it for formal accounts.

## Recovery

With the API stopped, configure the MySQL variables for a new empty recovery database, then restore a JSON export. SQLite development restores can instead use `DB_PATH`:

```powershell
$env:DB_PATH='D:\safe-location\restored.db'
node scripts/restore.cjs 'D:\backups\usman-backup.json'
```

The restore tool refuses to overwrite an existing business database. Point the API at the restored database, configure a setup key, and create a new administrator. Keep the previous database until the restored data has been verified. A raw SQLite backup must include a consistent snapshot (stop the API before copying files; do not copy only the `.db` while WAL writes are active).
