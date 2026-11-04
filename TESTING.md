# Verification for version 1.1

- `npm test`: API regression passed. Covers concurrent writes, decimal values, input validation, edit ownership, budgets, CSV escaping, session restart/expiry/logout, duplicate registration, HTTP errors and corruption recovery.
- JavaScript syntax checks passed for server.js, storage.js and public/app.js.
- DOM integration check passed using jsdom against the real API: registration, decimal add/edit, search/reset, income categories, selected budget month, chart rendering and clearing data after logout.
- Full visual browser verification was unavailable in the build environment. The README includes manual checks at phone, tablet and desktop sizes.

The included `npm test` suite uses only Node built-ins and the application dependencies. The separate DOM build check used a temporary jsdom harness; jsdom is not required to run the application.
