# Usman Stationary

Windows Electron application for distribution, inventory, POS and PKR accounting. React UI, Express API, MySQL/MariaDB production database and SQLite for local development. The desktop connects to **https://store.aleemcore.com** by default. No customer data, passwords or database files belong in this public repository.

## Local development

Use Node **22.13+** (or Node 24). Open PowerShell in the project:

```powershell
npm ci
$env:SETUP_KEY='choose-a-long-random-setup-secret'
npm run server
```

In a second terminal run `npm run dev`, then open http://127.0.0.1:5173. Create the administrator using your setup key and a password of at least 6 characters. The empty database is intentional: add your own items, opening stock and contacts. For the desktop run `npm run build` and `npm run desktop`; sign in with your server URL (http://127.0.0.1:4000 for local testing).

`npm test` runs local checks (MySQL integration is skipped without `MYSQL_TEST_MODE=1`). GitHub CI also runs integration checks against real MySQL 8.4 and MariaDB 11.4, including concurrent oversell prevention. It checks accounting, stock, return limits, report generation, atomic rollback, authentication, session revocation and the API. `npm run ui:check` uses an isolated local QA database and Edge to check navigation and checkout (start the API with `DB_PATH=data/qa.db`, `QA_MODE=1` and `SETUP_KEY=local-ui-test-only-setup` first). It refuses to seed an API that is not marked for QA. `npm run desktop:check` verifies the bundled Electron renderer and native printer/PDF bridge against that QA API. `npm run dist` produces the Windows installer in `release/`.

`npm run pos:check` (after `npm run build`) uses Edge and a fresh in-memory database to verify every POS shortcut, customer creation, unfinished-cart preservation, stock/account totals and successful checkout. It never connects to the live store.

## Included workflows

### Store design, wholesale rules and customer accounts (Windows 1.0.7 / API 1.0.9)

The mobile and desktop storefront includes a homepage with editable banners, category tiles, featured products, new arrivals, and best sellers based on net quantities in posted sale/return history. Catalog controls include product/SKU search, category/collection, availability, price range and sorting. Product photos can be configured with HTTPS image URLs; products without a photo use a labelled stationery illustration.

Open **Settings → Online store & wholesale pricing → Manage online store**. Branding edits the homepage text. Products controls featured/new labels, image URLs, minimum base-unit quantities, pieces per pack/carton and quantity price breaks. Enter actual PKR rates (for example breaks at 10 and 50); the normal selling price applies before a break. A carton size must be a multiple of the pack size. Existing prices, packaging and minimum quantities stay unchanged until rules are saved. Pieces/base units, packs and cartons have explicit prices, and pack/carton order quantities are converted to base units before POS processing. Historical requests keep the prices and base quantities captured at submission.

Price groups provides Retailer, School and Large buyer discounts and product-specific rates. For approved members, the group discount applies to the lower of the applicable public quantity rate and the group-specific product rate. An optional order-wide bulk discount applies after these rates, before tax; it is allocated across request lines in integer paisa and carried into the accepted POS order. Supplier offers use their own proposed base-unit prices and do not receive customer discounts. All pricing, packaging and minimum quantities are revalidated on the server.

Visitors can **Account → Request an account** and sign in at public prices while awaiting approval. In store management → Customers, the owner verifies the details, approves an account, assigns its price group, blocks access or resets the password. Applicants cannot assign their own groups. Customer credentials/sessions are separate from administrator login, and private price lists are never returned to guests. Customer passwords use the same 6-character minimum as the administrator. No email delivery or automatic identity verification is configured.

**Quick order** accepts product name/SKU search, quantity and unit rows, and CSV/XLSX import (up to 500 rows / 1 MB, up to 100 distinct products per request). Imports are parsed locally in the browser, preserve text SKUs and show a preview. Unknown/ambiguous products or invalid units reject the whole import without changing the bag. SKU columns in Excel must be formatted as text to preserve leading zeros. **Buy again** reorders completed online purchases made through the signed-in account, using current prices, quantities and minimums. A newly registered account is not automatically linked to someone else's old POS records by phone number.

New business tables `store_settings` and `store_order_links` are included in backups, restore and business reset; older version-1 backups remain accepted. Customer login tables `store_customers` and `store_customer_sessions` are preserved by business reset/restore and excluded from business backup files, like administrator credentials. Restoring a backup to another server does not transfer customer credentials or silently grant access to historical purchases. Store configuration saves reject stale versions to prevent overwriting changes made on another device.

`npm run wholesale:check` runs mobile/desktop storefront, actual XLSX import, private pricing/approval, owner settings and reorder checks using a fresh in-memory database; append `-- --packaged` to use the packaged Windows owner app on isolated local port 4000. `npm run build` also bundles the pinned XLSX reader locally; Hostinger uses the committed assets in `server/public/` without an external CDN. See `server/public/XLSX-LICENSE.txt` for its license.

The public store is at **https://store.aleemcore.com/usmanstationary** (both with and without a trailing slash). It is served directly by the Node backend from `server/public/`, so Hostinger's existing `server` app root and build command remain valid. No second website or environment variables are required. New table `storefront_requests` is created additively at startup; existing data is preserved.

Customers browse all product names, categories, units, barcodes and selling prices, then send sales order requests. Suppliers use the same page, select Supplier and enter offered prices to send purchase order requests. Purchase costs, exact quantities in stock and private records are not exposed. These are unverified requests, with no online payment or automatic customer-account matching.

Open **POS → Online store requests** to review pending requests (refreshes every 15 seconds while POS is open). Check contact details, choose an existing contact or create a new one, then accept as a sale/purchase order or reject. Open the accepted order and use **Use for invoice / purchase**, review quantities, prices, tax, discount and payment, and save. Acceptance does not post stock or accounts; the final transaction does. Each accepted request can produce one final transaction, with repeated submissions and processing calls protected against duplicates. Rejected and fulfilled requests remain in history. The queue shows up to 500 requests with pending requests first; accepted orders also remain in normal Sales/Purchases history.

Store requests are included in Settings backups, restore and business reset. Existing version-1 backups from before the store feature remain supported; restoring one restores its business records with an empty store request queue. Reset/restore always preserves administrator accounts and sessions. `npm run store:check` (after `npm run build`) exercises the public mobile/desktop site and POS with an isolated in-memory database; append `-- --packaged` to check the packaged Windows app, using local port 4000 and a separate test profile.

- Dashboard with actual sales, receivables/payables, stock alerts and recent transactions.
- POS with keyboard barcode scanning, invoices, immutable sale history, quotations and sale orders. Direct POS actions open purchases, sale/purchase returns, quotations, orders, expenses, receipts, supplier payments, cash/bank transfers and opening balances while preserving the unfinished sale underneath. Create and select a customer beside checkout, see cash/bank balances and reopen recent transactions. Use a quotation/order as a starting point for an invoice.
- Purchases, purchase orders, original-invoice-linked sale and purchase returns with cumulative quantity limits and original prices/taxes/discounts.
- Item catalog, opening stock, weighted-average purchase cost, low-stock limits, categories, units and item-level batch/serial identifiers. Code 128 barcode generation and A4 label printing.
- Customers/suppliers with WhatsApp phone numbers, expenses/categories, cash and bank opening balances, transfers, receipts and payments.
- Per-line taxes and discounts by percentage or fixed PKR amount. Amounts stored as integer paisa, with server-side calculations.
- A4, 80 mm and 58 mm document layouts, Windows printer selection and PDF export. Barcode labels use a normal A4 printer.
- WhatsApp opens a prefilled document summary addressed to the contact. Save the PDF and attach it manually in WhatsApp to share the file; this is not unattended WhatsApp Business API delivery.
- All **34** reports from the supplied screenshots, with date filters, CSV export and print/PDF. Party/item filters apply to relevant reports. Accounting statements use cumulative end-date balances.
- Settings controls for backup download, restore and business-data reset. Login accounts, passwords and sessions are excluded from backups and preserved during restore/reset. A server-side restore script is also included.

## Hostinger Business deployment

Hostinger documents Express/Node.js support on Business plans. See [their current Node.js deployment guide](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/).

1. In hPanel, add a **Node.js Web App**, connect `Aleem33/Usman-Stationary`, and select `main`.
2. Set the application root to **server**, framework **Express**, Node **22** (22.13+) or **24**, entry **index.js**, install command **npm ci**, start command **npm start**. The API is a separate package and does not install Electron. Set the build command to `npm run build`; this checks the backend JavaScript syntax. Leave the output directory empty. The entry file must be `index.js` relative to the `server` application root.
3. Bind the custom domain **store.aleemcore.com** to this Node.js application, enable SSL and let hPanel configure the domain routing. Existing files on a different website root do not automatically expose this API.
4. Create a MySQL database under **Databases → Management**. Keep the full database name and username, including Hostinger's `u..._` prefix. Add environment variables from `.env.example` in hPanel: `DB_CLIENT=mysql`, `DB_HOST=127.0.0.1`, `DB_PORT=3306`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `HOST=0.0.0.0` and a random `SETUP_KEY`. Keep an existing Hostinger-assigned `PORT`; if a value is required and none is assigned, the app default is `4000`. Do not use `DB_PATH` for MySQL. Keep the database password and setup key out of GitHub.
5. Deploy/restart the backend. The entry file starts listening immediately to support Hostinger’s imported-entry loader, then initializes the database. During initialization, the API returns HTTP 503 with `status: starting`; readiness becomes healthy only after all tables are available. It connects to your existing MySQL database and creates all tables automatically; no phpMyAdmin SQL import is necessary. Table creation needs the normal CREATE privilege on that database. Production requires MySQL credentials and refuses to fall back to a temporary SQLite file. Backend 1.0.9 remains compatible with older Windows clients; the new Settings restore/reset controls require Windows client 1.0.2 or newer.
6. Open `https://store.aleemcore.com/api/health`; it should return `ok: true`. In the desktop app create your admin with the setup key. Keep SETUP_KEY private if you use it for forgotten-password recovery. If you configure a separate PASSWORD_RESET_KEY, the original setup key may be removed after the account exists. Neither key is needed for normal sign-in.
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

## Passwords and in-app notifications

Passwords require at least **6 characters** for setup, change and recovery. Existing longer passwords continue to work. New passwords are limited to bcrypt's 72-byte UTF-8 input size.

Use **Settings → Change password** with the current password. The current session remains active; other sessions are revoked. On the sign-in screen, **Forgot password?** resets the password using the administrator username and a private recovery key. The server uses `PASSWORD_RESET_KEY` when configured, otherwise the existing `SETUP_KEY`. Recovery keys must be private, at least 16 characters long, and not example placeholders. Store them in Hostinger environment variables, never GitHub or a client build. Successful recovery revokes the account's existing sessions and requires sign-in with the new password. Both paths preserve business data and are rate limited.

Success, error, warning, validation, printing and updater messages use dismissible in-app toasts. Update installation uses an in-app confirmation. Normal printer selection and file-save pickers remain native system interfaces.

Logout clears the local session immediately and revokes that specific server token idempotently. Temporary upstream failures are retried once for reads and logout. Business writes, restore/reset and password changes are never automatically retried. Non-JSON error pages produce a readable server message, and delayed responses from an old session cannot invalidate a new sign-in.

## Backup, restore and reset in Settings

Use **Settings → Backup & restore** to download a JSON backup or select a saved backup for restore. A restore replaces all business records and business settings in the connected store. **Reset business data** clears inventory, parties, documents, financial entries, expenses and business settings. Server environment variables and the local API connection are not changed.

Both operations preserve every administrator account, password and login session. They require the current administrator password and typing `RESTORE` or `RESET`. Download a current backup first if you need a recovery copy. A preview shows the affected record counts. If business records change after the preview, the server refuses the operation and asks for a fresh preview.

Restore validates checksums (when present), table/column names, IDs, accounting balances and foreign keys. Backup files cannot import users or sessions. Deletion and insertion happen in one database transaction; a failure rolls back the operation. Files are limited to **20 MB / 50,000 rows**. Legacy version-1 business backups without checksums remain supported.

## Recovery

With the API stopped, configure the MySQL variables for a new empty recovery database, then restore a JSON export. SQLite development restores can instead use `DB_PATH`:

```powershell
$env:DB_PATH='D:\safe-location\restored.db'
node scripts/restore.cjs 'D:\backups\usman-backup.json'
```

The restore tool refuses to overwrite an existing business database. Point the API at the restored database, configure a setup key, and create a new administrator. Keep the previous database until the restored data has been verified. A raw SQLite backup must include a consistent snapshot (stop the API before copying files; do not copy only the `.db` while WAL writes are active).
