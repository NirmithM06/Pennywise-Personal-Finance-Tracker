require('dotenv').config();
const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { readCollection, updateCollection } = require('./storage');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const CATEGORIES = ['Food', 'Rent', 'Travel', 'Utilities', 'Other', 'Salary', 'Freelance', 'Gifts'];
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || SESSION_SECRET.length < 32 || SESSION_SECRET.startsWith('replace-this')) {
  console.error('Set SESSION_SECRET to a random value at least 32 characters long (see .env.example).');
  process.exit(1);
}

app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

// Durable sessions share the same serialized collection operations as app data.
class JsonSessionStore extends session.Store {
  get(sid, callback) {
    readCollection('sessions').then(records => {
      const record = records.find(item => item.sid === sid && item.expiresAt > Date.now());
      callback(null, record ? record.session : null);
    }, callback);
  }
  set(sid, value, callback = () => {}) {
    updateCollection('sessions', records => {
      const next = records.filter(item => item.sid !== sid && item.expiresAt > Date.now());
      next.push({ sid, session: value, expiresAt: new Date(value.cookie.expires).getTime() });
      records.splice(0, records.length, ...next);
    }).then(() => callback(null), callback);
  }
  destroy(sid, callback = () => {}) {
    updateCollection('sessions', records => {
      const index = records.findIndex(item => item.sid === sid);
      if (index >= 0) records.splice(index, 1);
    }).then(() => callback(null), callback);
  }
  touch(sid, value, callback = () => {}) {
    updateCollection('sessions', records => {
      const record = records.find(item => item.sid === sid);
      if (record) { record.session.cookie = value.cookie; record.expiresAt = new Date(value.cookie.expires).getTime(); }
    }).then(() => callback(null), callback);
  }
}
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY.split(',').map(v => v.trim()));
app.use(require('helmet')({ contentSecurityPolicy: { directives: {
  "style-src": ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  "font-src": ["'self'", 'https://fonts.gstatic.com'],
  "img-src": ["'self'", 'data:'],
  "upgrade-insecure-requests": process.env.NODE_ENV === 'production' ? [] : null
} } }));
const { rateLimit } = require('express-rate-limit');
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' } });
app.use(['/api/auth/login', '/api/auth/register'], authLimiter);
// Require the browser's own origin for cookie-authenticated mutations.
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const expected = process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
    if (req.get('sec-fetch-site') === 'cross-site' || (req.get('origin') && req.get('origin') !== expected))
      return res.status(403).json({ error: 'Cross-origin request rejected.' });
  }
  next();
});

app.use(session({
  name: 'finance.sid',
  secret: SESSION_SECRET,
  store: new JsonSessionStore(),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(express.static(path.join(__dirname, 'public')));

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const fail = (res, status, message) => res.status(status).json({ error: message });
function requireAuth(req, res, next) {
  if (!req.session.userId) return fail(res, 401, 'Please sign in to continue.');
  next();
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validMonth(value) { return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value); }
function parseMoney(value) {
  if (!['string', 'number'].includes(typeof value)) return null;
  const text = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(paise) && paise > 0 && paise <= 100_000_000_000 ? paise : null;
}
const amountPaise = item => item.amountPaise ?? Math.round(item.amount * 100);
const publicTransaction = item => ({ ...item, amount: amountPaise(item) / 100 });
function transactionInput(body) {
  const type = body?.type;
  const amountPaise = parseMoney(body?.amount);
  const category = typeof body?.category === 'string' ? body.category : '';
  const date = body?.date;
  const notes = typeof body?.notes === 'string' ? body.notes.trim() : '';
  if (!['income', 'expense'].includes(type)) return 'Choose income or expense.';
  if (amountPaise === null) return 'Enter an amount greater than 0 with at most two decimal places.';
  if (!CATEGORIES.includes(category)) return 'Choose a valid category.';
  if (!validDate(date)) return 'Enter a valid transaction date.';
  if (notes.length > 250) return 'Notes must be 250 characters or fewer.';
  return { type, amountPaise, category, date, notes };
}
function currentUser(req) { return { id: req.session.userId, name: req.session.userName }; }

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  res.json({ user: currentUser(req) });
});

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (name.length < 2 || name.length > 60) return fail(res, 400, 'Name must be between 2 and 60 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return fail(res, 400, 'Enter a valid email address.');
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) return fail(res, 400, 'Password must be at least 8 characters and at most 72 UTF-8 bytes.');
  const user = { id: crypto.randomUUID(), name, email, passwordHash: await bcrypt.hash(password, 12), createdAt: new Date().toISOString() };
  const added = await updateCollection('users', users => {
    if (users.some(item => item.email === email)) return false;
    users.push(user); return true;
  });
  if (!added) return fail(res, 409, 'An account with that email already exists.');
  req.session.regenerate((error) => {
    if (error) return fail(res, 500, 'Could not start your session. Please try again.');
    req.session.userId = user.id;
    req.session.userName = user.name;
    req.session.save((saveError) => saveError ? fail(res, 500, 'Could not save your session.') : res.status(201).json({ user: currentUser(req) }));
  });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const users = await readCollection('users');
  const user = users.find((item) => item.email === email);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return fail(res, 401, 'Email or password is incorrect.');
  req.session.regenerate((error) => {
    if (error) return fail(res, 500, 'Could not start your session. Please try again.');
    req.session.userId = user.id;
    req.session.userName = user.name;
    req.session.save((saveError) => saveError ? fail(res, 500, 'Could not save your session.') : res.json({ user: currentUser(req) }));
  });
}));

app.post('/api/auth/logout', requireAuth, (req, res) => {
  req.session.destroy((error) => {
    if (error) return fail(res, 500, 'Could not sign out. Please try again.');
    res.clearCookie('finance.sid', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    res.json({ message: 'You are signed out.' });
  });
});

app.get('/api/transactions', requireAuth, asyncRoute(async (req, res) => {
  const { category, from, to } = req.query;
  if (category && !CATEGORIES.includes(category)) return fail(res, 400, 'Unknown category filter.');
  if (from && !validDate(from)) return fail(res, 400, 'Start date is invalid.');
  if (to && !validDate(to)) return fail(res, 400, 'End date is invalid.');
  if (from && to && from > to) return fail(res, 400, 'Start date must be on or before end date.');
  const transactions = (await readCollection('transactions'))
    .filter((item) => item.userId === req.session.userId)
    .filter((item) => !category || item.category === category)
    .filter((item) => !from || item.date >= from)
    .filter((item) => !to || item.date <= to)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  res.json({ transactions: transactions.map(publicTransaction) });
}));

app.post('/api/transactions', requireAuth, asyncRoute(async (req, res) => {
  const input = transactionInput(req.body);
  if (typeof input === 'string') return fail(res, 400, input);
  const transaction = { id: crypto.randomUUID(), userId: req.session.userId, ...input, createdAt: new Date().toISOString() };
  await updateCollection('transactions', records => records.push(transaction));
  res.status(201).json({ transaction: publicTransaction(transaction) });
}));

app.put('/api/transactions/:id', requireAuth, asyncRoute(async (req, res) => {
  const input = transactionInput(req.body);
  if (typeof input === 'string') return fail(res, 400, input);
  const transaction = await updateCollection('transactions', records => {
    const item = records.find(item => item.id === req.params.id && item.userId === req.session.userId);
    if (!item) return null;
    Object.assign(item, input); delete item.amount;
    return item;
  });
  if (!transaction) return fail(res, 404, 'Transaction not found.');
  res.json({ transaction: publicTransaction(transaction) });
}));
app.delete('/api/transactions/:id', requireAuth, asyncRoute(async (req, res) => {
  const found = await updateCollection('transactions', records => {
    const index = records.findIndex(item => item.id === req.params.id && item.userId === req.session.userId);
    if (index < 0) return false;
    records.splice(index, 1); return true;
  });
  if (!found) return fail(res, 404, 'Transaction not found.');
  res.json({ message: 'Transaction deleted.' });
}));

app.get('/api/budget', requireAuth, asyncRoute(async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  if (!validMonth(month)) return fail(res, 400, 'Month must use YYYY-MM format.');
  const record = (await readCollection('budgets')).find((item) => item.userId === req.session.userId && item.month === month);
  const transactions = (await readCollection('transactions')).filter((item) => item.userId === req.session.userId && item.type === 'expense' && item.date.startsWith(month));
  const spent = transactions.reduce((sum, item) => sum + amountPaise(item), 0);
  res.json({ month, limit: (record?.limitPaise ?? Math.round((record?.limit || 0) * 100)) / 100, spent: spent / 100 });
}));

app.put('/api/budget', requireAuth, asyncRoute(async (req, res) => {
  const { month } = req.body || {};
  const limitPaise = parseMoney(req.body?.limit);
  if (!validMonth(month)) return fail(res, 400, 'Month must use YYYY-MM format.');
  if (limitPaise === null) return fail(res, 400, 'Budget must be greater than 0 with at most two decimal places.');
  await updateCollection('budgets', budgets => {
    const existing = budgets.find(item => item.userId === req.session.userId && item.month === month);
    if (existing) { existing.limitPaise = limitPaise; delete existing.limit; }
    else budgets.push({ userId: req.session.userId, month, limitPaise });
  });
  res.json({ month, limit: limitPaise / 100 });
}));

app.get('/api/export', requireAuth, asyncRoute(async (req, res) => {
  const transactions = (await readCollection('transactions'))
    .filter((item) => item.userId === req.session.userId)
    .sort((a, b) => b.date.localeCompare(a.date)).map(publicTransaction);
  const format = req.query.format || 'csv';
  if (format === 'json') {
    res.setHeader('Content-Disposition', 'attachment; filename="my-transactions.json"');
    return res.json(transactions.map(({ id, type, amount, category, date, notes }) => ({ id, type, amount, category, date, notes })));
  }
  if (format !== 'csv') return fail(res, 400, 'Format must be csv or json.');
  const quote = (value) => { let text = String(value ?? ''); if (/^[\s]*[=+@\-＝＋－＠]/u.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text; return `"${text.replaceAll('"', '""')}"`; };
  const rows = [['Type', 'Amount', 'Category', 'Date', 'Notes'], ...transactions.map((item) => [item.type, item.amount.toFixed(2), item.category, item.date, item.notes])];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="my-transactions.csv"');
  res.send(rows.map((row) => row.map(quote).join(',')).join('\r\n'));
}));

app.use('/api', (req, res) => fail(res, 404, 'API endpoint not found.'));
app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  const status = error.type === 'entity.parse.failed' ? 400 : error.type === 'entity.too.large' ? 413 : 500;
  res.status(status).json({ error: status === 400 ? 'Invalid JSON body.' : status === 413 ? 'Request body too large.' : 'Could not complete the request. Your stored files have been preserved; check the server log.' });
});

app.listen(PORT, () => console.log(`Personal Finance Tracker running at http://localhost:${PORT}`));
