# Pennywise — Personal Finance & Expense Tracker

A full-stack course project using HTML, CSS, vanilla JavaScript, Express and JSON files. Version 1.1 fixes the review findings and adds transaction editing, search, pagination and spending insights.

## Run locally

1. Install Node.js 22 or newer (an actively supported LTS release is recommended).
2. Open a terminal in this folder and run `npm ci`.
3. Copy `.env.example` to `.env` (`cp .env.example .env` on macOS/Linux, `Copy-Item .env.example .env` in PowerShell).
4. Generate a secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and paste it as `SESSION_SECRET` in `.env`. The example placeholder is deliberately rejected.
5. Run `npm start` and open http://localhost:3000.

Use `npm run dev` for automatic restarts, and `npm test` for the API regression suite. Tests create and remove their own temporary data directory; they do not change your personal records. No accounts, passwords, runtime data or node_modules are included in the ZIP.

## Features

- Registration, login, logout and persistent seven-day sessions; each user sees only their own records.
- Add, edit and delete income/expense transactions with date, category and notes.
- Expense categories: Food, Rent, Travel, Utilities, Other. Income categories: Salary, Freelance, Gifts, Other. Older category assignments remain editable.
- All-time or selected-month income, expenses and balance, category spending bars, and comparison with the previous month.
- History search by notes/category, type/category/date filters, and ten-row client-side pagination.
- Monthly spending budgets with expense-only totals and accessible progress indicators. The dashboard preview explicitly labels the selected budget month.
- CSV and JSON exports of the complete account history (not only the currently filtered rows).
- Responsive logout controls at phone, tablet and desktop widths, keyboard focus styles, retry/loading messages and session-expiry handling.

## Reliability and storage

New amounts are stored as integer paise (`amountPaise` and `limitPaise`); decimal conversion is performed only at the API/display boundary. Existing files from version 1.0 using rupee `amount`/`limit` values are readable; edited records use paise. Back up the old data directory before upgrading and copy it into this project's data directory while the server is stopped. This ZIP starts empty.

All collection changes serialize the complete read/modify/write operation. Writes use unique temporary files, file synchronization and atomic rename. Duplicate registration checks run within the same serialized operation. Session operations use the same mechanism; a failed operation does not poison later queue operations. Expired sessions are ignored and removed on subsequent session creation/saves.

**Run exactly one Node server process per data directory.** This is a simple single-process course-project store, not a multi-process database. Do not run cluster mode, multiple replicas or two servers against the same directory. History filtering and pagination currently load the user's full history into the browser. For large datasets or multi-server hosting, migrate to SQLite/PostgreSQL with database transactions, unique constraints, server-side pagination and a maintained shared session store.

Missing collections start empty. Malformed/unreadable files are preserved and operations fail explicitly; they are never silently replaced with an empty collection. To back up, stop the server and copy the complete data directory to a secure location. To recover, stop the server, retain a copy of the damaged file, restore a verified backup, then restart. Protect backups because users.json contains password hashes and sessions.json contains session records.

## Deployment configuration

Local defaults are in `.env.example`. Keep `.env` and runtime files out of version control.

- `PORT`: listening port (default 3000).
- `SESSION_SECRET`: randomly generated secret, at least 32 characters.
- `NODE_ENV=production`: enables secure session cookies; serve the application over HTTPS.
- `APP_ORIGIN`: exact public origin, e.g. `https://finance.example.com`, without a trailing slash. Used to reject cross-origin mutation requests.
- `TRUST_PROXY`: optional comma-separated trusted proxy IPs/CIDRs, e.g. `127.0.0.1/8,::1/128` for a same-host proxy. Only trust actual proxy addresses; leave unset for direct access. The proxy must set the correct forwarded protocol.
- `DATA_DIR`: optional absolute persistent-data directory. Leave unset for the local data folder.

Helmet provides security headers; authentication endpoints allow 30 attempts per IP per 15 minutes. That rate limiter is in-memory and resets on restart. SameSite cookies and origin checks help protect browser mutations. Passwords are bcrypt hashes; new passwords must have at least eight characters and at most 72 UTF-8 bytes.

CSV formula-like text is prefixed with an apostrophe and all cells are quoted. Spreadsheet interpretation varies: use JSON when exact original text matters, and do not remove text protection or enable formulas from untrusted notes.

## Project structure

- `server.js`: API routes, validation, authentication, session store, exports and headers.
- `storage.js`: serialized collection updates and atomic writes.
- `public/index.html`: forms, navigation, dashboard and history.
- `public/app.js`: UI state, API requests, charts, filtering and pagination.
- `public/styles.css`: responsive styling and accessibility refinements.
- `tests/regression.test.js`: API integration and persistence regression checks.
- `data/`: runtime collections; only the placeholder is distributed.

## API routes

| Method | Route | Purpose |
| --- | --- | --- |
| POST | /api/auth/register | Create an account |
| POST | /api/auth/login | Sign in |
| GET | /api/auth/me | Current account or null |
| POST | /api/auth/logout | Destroy session |
| GET | /api/transactions | Own history; optional category/from/to query filters |
| POST | /api/transactions | Add transaction |
| PUT | /api/transactions/:id | Edit owned transaction |
| DELETE | /api/transactions/:id | Delete owned transaction |
| GET | /api/budget?month=YYYY-MM | Monthly limit and expense total |
| PUT | /api/budget | Set monthly limit |
| GET | /api/export?format=csv | CSV export (also accepts json) |

Transaction writes accept `type`, `amount` (decimal string recommended), `category`, `date` (YYYY-MM-DD), and optional `notes` (250 characters). Budget writes accept `month` and decimal `limit`. Protected routes derive ownership from the session, never from a client-supplied user ID.

## Testing and demonstration

`npm test` checks decimal acceptance/rejection, 20 concurrent saves, edits, ownership isolation, totals, formula-prefixed exports, origin rejection, malformed/oversized JSON, restart persistence, logout/expiry, concurrent duplicate registration, and recovery after a corrupted file.

For a manual demo: register two accounts, add expenses/income, edit a decimal amount, search/filter history, set budgets for two months, compare dashboard months, export CSV/JSON, and verify the second account has separate records. Check keyboard navigation and logout at 375px, 768px and desktop widths.
