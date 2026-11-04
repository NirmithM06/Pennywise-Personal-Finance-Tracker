const CURRENCY = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
const CATEGORY_ICONS = { Food: '⌁', Rent: '⌂', Travel: '↗', Utilities: 'ϟ', Other: '✳' };
const state = { user: null, transactions: [], visibleTransactions: [], type: 'expense', budget: { month: '', limit: 0, spent: 0 }, noticeTimer: null, epoch: 0, page: 1, editing: null, transactionRequest: 0, budgetRequest: 0 };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

async function api(url, options = {}) {
  const epoch = state.epoch;
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  if (epoch !== state.epoch) throw new Error('STALE');
  if (response.status === 401 && state.user) { resetWorkspace(); showAuth(); setAuthMessage('Your session expired. Please sign in again.'); throw new Error('STALE'); }
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    const payload = contentType.includes('application/json') ? await response.json() : {};
    if (epoch !== state.epoch) throw new Error('STALE');
    throw new Error(payload.error || 'Something went wrong. Please try again.');
  }
  if (options.download) return response.blob();
  const result = contentType.includes('application/json') ? await response.json() : null;
  if (epoch !== state.epoch) throw new Error('STALE');
  return result;
}
const money = (value) => CURRENCY.format(Number(value) || 0);
const monthNow = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; };
const dateNow = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
function prettyDate(value) { return new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
function setNotice(message, kind = 'success') {
  if (message === 'STALE') return;
  const notice = $('#notice');
  notice.textContent = message;
  notice.className = `notice show ${kind}`;
  clearTimeout(state.noticeTimer);
  state.noticeTimer = setTimeout(() => { notice.className = 'notice'; notice.textContent = ''; }, 4000);
}
function setAuthMessage(message, success = false) {
  const box = $('#auth-message');
  box.textContent = message;
  box.classList.toggle('success', success);
}
function showAuth() { $('#app-screen').classList.add('hidden'); $('#auth-screen').classList.remove('hidden'); }
function showApp() {
  $('#auth-screen').classList.add('hidden'); $('#app-screen').classList.remove('hidden');
  $('#sidebar-name').textContent = state.user.name;
  $('#greeting-name').textContent = state.user.name.split(/\s+/)[0];
  $('#avatar-initial').textContent = state.user.name.trim().charAt(0).toUpperCase();
  $('#today-label').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  loadWorkspace();
}
function setAuthMode(register) {
  const form = $('#auth-form');
  form.dataset.mode = register ? 'register' : 'login';
  $('#name-field').classList.toggle('hidden', !register);
  form.elements.name.required = register; form.elements.name.disabled = !register;
  $('#auth-eyebrow').textContent = register ? 'GET STARTED' : 'WELCOME BACK';
  $('#auth-title').textContent = register ? 'Create your account' : 'Sign in to your account';
  $('#auth-subtitle').textContent = register ? 'A clearer picture of your money starts here.' : 'Your finances are ready when you are.';
  $('#auth-submit').innerHTML = register ? 'Create account <span>→</span>' : 'Sign in <span>→</span>';
  $('#auth-switch-copy').textContent = register ? 'Already have an account?' : 'New to Pennywise?';
  $('#auth-switch').textContent = register ? 'Sign in' : 'Create an account';
  form.elements.password.autocomplete = register ? 'new-password' : 'current-password';
  setAuthMessage('');
}

$('#auth-switch').addEventListener('click', () => setAuthMode($('#auth-form').dataset.mode !== 'register'));
$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const register = form.dataset.mode === 'register';
  const payload = Object.fromEntries(new FormData(form).entries());
  const button = $('#auth-submit'); button.disabled = true;
  try {
    const result = await api(`/api/auth/${register ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(payload) });
    resetWorkspace(); state.user = result.user;
    form.reset();
    showApp();
  } catch (error) { setAuthMessage(error.message); }
  finally { button.disabled = false; }
});

function resetWorkspace() {
  state.epoch++; state.user = null; state.transactions = []; state.visibleTransactions = [];
  state.budget = { month: monthNow(), limit: 0, spent: 0 }; state.page = 1;
  $('#filter-form').reset(); $('#filter-form').dataset.filtered = 'false';
  $('#summary-month').value = ''; $('#budget-form').reset(); cancelEdit();
  updateSummary(); renderTransactions(); renderRecent(); renderBudget();
  $('#notice').className = 'notice'; $('#notice').textContent = '';
}
async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); resetWorkspace(); showAuth(); setAuthMode(false); }
  catch (error) { setNotice(error.message === 'STALE' ? 'STALE' : 'Sign out failed. Please retry before leaving this device.', 'error'); }
}
$('#logout-button').addEventListener('click', logout);
$('#mobile-logout').addEventListener('click', logout);

function setPage(name) {
  const pages = { dashboard: 'Overview', transactions: 'Transactions', budget: 'Monthly budget' };
  if (!pages[name]) name = 'dashboard';
  $$('.page-section').forEach((section) => section.classList.toggle('hidden', section.id !== `${name}-section`));
  $$('.nav-link').forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${name}`));
  $('#topbar-section').textContent = pages[name];
  if (name === 'budget') loadBudget($('#budget-form').elements.month.value || monthNow());
}
window.addEventListener('hashchange', () => setPage(location.hash.slice(1)));
$$('.nav-link').forEach((link) => link.addEventListener('click', () => setPage(link.hash.slice(1))));

async function loadWorkspace() {
  const epoch = state.epoch;
  $('#budget-form').elements.month.value = monthNow();
  $('#transaction-form').elements.date.value = dateNow();
  await Promise.all([loadTransactions(), loadBudget(monthNow())]);
  if (epoch !== state.epoch) return;
  updateSummary(); renderRecent(); setPage(location.hash.slice(1) || 'dashboard');
}
async function loadTransactions() {
  const request = ++state.transactionRequest;
  $('#history-status').textContent = 'Loading transactions…';
  try {
    const { transactions } = await api('/api/transactions');
    if (request !== state.transactionRequest) return;
    state.transactions = transactions; applyFilters(); updateSummary(); renderRecent();
    $('#history-status').textContent = '';
  } catch (error) {
    if (error.message !== 'STALE' && request === state.transactionRequest) $('#history-status').textContent = 'Could not load records. Use Retry.';
    setNotice(error.message, 'error');
  }
}
function applyFilters() {
  const filters = currentFilters();
  if (filters.from && filters.to && filters.from > filters.to) { setNotice('Start date must be before end date.', 'error'); return; }
  state.visibleTransactions = state.transactions.filter(item =>
    (!filters.category || item.category === filters.category) && (!filters.type || item.type === filters.type) &&
    (!filters.from || item.date >= filters.from) && (!filters.to || item.date <= filters.to) &&
    (!filters.search || `${item.notes} ${item.category}`.toLowerCase().includes(filters.search.toLowerCase())));
  state.page = 1; renderTransactions();
}
const paise = item => item.amountPaise ?? Math.round(item.amount * 100);
function updateSummary() {
  const month = $('#summary-month').value;
  const records = state.transactions.filter(item => !month || item.date.startsWith(month));
  const income = records.filter(item => item.type === 'income').reduce((sum, item) => sum + paise(item), 0);
  const expense = records.filter(item => item.type === 'expense').reduce((sum, item) => sum + paise(item), 0);
  $('#balance-value').textContent = money((income - expense) / 100);
  $('#income-value').textContent = money(income / 100); $('#expense-value').textContent = money(expense / 100);
  $$('.summary-period').forEach(el => el.textContent = month ? `For ${month}` : 'Across all records');
  const chart = $('#category-chart'); chart.replaceChildren();
  const totals = {};
  records.filter(item => item.type === 'expense').forEach(item => totals[item.category] = (totals[item.category] || 0) + paise(item));
  Object.entries(totals).sort((a,b) => b[1]-a[1]).forEach(([category, total]) => {
    const row = document.createElement('div'); row.className = 'chart-row';
    const label = document.createElement('span'); label.textContent = `${category}: ${money(total/100)}`;
    const bar = document.createElement('div'); bar.className = 'chart-bar'; bar.style.width = `${expense ? total/expense*100 : 0}%`;
    row.append(label, bar); chart.append(row);
  });
  if (!Object.keys(totals).length) chart.textContent = 'No expenses for this period.';
  const comparison = $('#month-comparison'); comparison.textContent = 'Choose a month to compare spending with the previous month.';
  if (month) {
    const date = new Date(`${month}-01T12:00:00`); date.setMonth(date.getMonth()-1);
    const previous = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
    const old = state.transactions.filter(item => item.type === 'expense' && item.date.startsWith(previous)).reduce((sum,item) => sum + paise(item),0);
    comparison.textContent = `${money(Math.abs(expense-old)/100)} ${expense >= old ? 'more' : 'less'} spent than ${previous} (${money(old/100)}).`;
  }
}
$('#summary-month').addEventListener('change', updateSummary);
$('#summary-all').addEventListener('click', () => { $('#summary-month').value = ''; updateSummary(); });
function createRecentRow(item) {
  const row = document.createElement('div'); row.className = 'recent-item';
  const icon = document.createElement('span'); icon.className = 'category-icon'; icon.textContent = CATEGORY_ICONS[item.category] || '✳';
  const copy = document.createElement('div'); copy.className = 'recent-copy';
  const title = document.createElement('strong'); title.textContent = item.notes || item.category;
  const detail = document.createElement('small'); detail.textContent = `${item.category} · ${prettyDate(item.date)}`;
  copy.append(title, detail);
  const amount = document.createElement('span'); amount.className = `recent-amount amount-${item.type}`; amount.textContent = `${item.type === 'income' ? '+' : '−'}${money(item.amount)}`;
  row.append(icon, copy, amount); return row;
}
function renderRecent() {
  const list = $('#recent-list'); list.replaceChildren();
  const recent = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
  if (!recent.length) { const empty = document.createElement('div'); empty.className = 'recent-empty'; empty.textContent = 'No activity yet. Add your first transaction to begin.'; list.append(empty); return; }
  recent.forEach((item) => list.append(createRecentRow(item)));
}
function renderTransactions() {
  const body = $('#transaction-rows'); body.replaceChildren();
  $('#record-count').textContent = `${state.visibleTransactions.length} of ${state.transactions.length} records`;
  const noTransactions = state.visibleTransactions.length === 0;
  $('#history-empty').classList.toggle('hidden', !noTransactions || $('#filter-form').dataset.filtered === 'true');
  $('#filter-empty').classList.toggle('hidden', !noTransactions || $('#filter-form').dataset.filtered !== 'true');
  const pages = Math.max(1, Math.ceil(state.visibleTransactions.length / 10)); state.page = Math.min(state.page, pages);
  $('#page-label').textContent = `Page ${state.page} of ${pages}`; $('#page-prev').disabled = state.page === 1; $('#page-next').disabled = state.page === pages;
  state.visibleTransactions.slice((state.page - 1) * 10, state.page * 10).forEach((item) => {
    const row = document.createElement('tr');
    const titleCell = document.createElement('td');
    const title = document.createElement('div'); title.className = 'table-title';
    const icon = document.createElement('span'); icon.className = 'category-icon'; icon.textContent = CATEGORY_ICONS[item.category] || '✳';
    const text = document.createElement('span'); text.textContent = item.notes || item.category;
    title.append(icon, text); titleCell.append(title);
    const category = document.createElement('td'); category.textContent = item.category;
    const date = document.createElement('td'); date.textContent = prettyDate(item.date);
    const amount = document.createElement('td'); amount.className = `table-amount amount-${item.type}`; amount.textContent = `${item.type === 'income' ? '+' : '−'}${money(item.amount)}`;
    const action = document.createElement('td'); const remove = document.createElement('button'); remove.className = 'delete-row'; remove.title = 'Delete transaction'; remove.setAttribute('aria-label', `Delete ${item.category} transaction`); remove.textContent = '×'; remove.addEventListener('click', () => deleteTransaction(item.id)); action.append(remove);
    const edit = document.createElement('button'); edit.className = 'text-button edit-row'; edit.textContent = 'Edit'; edit.setAttribute('aria-label', `Edit ${item.category} transaction`); edit.addEventListener('click', () => editTransaction(item)); action.prepend(edit);
    row.append(titleCell, category, date, amount, action); body.append(row);
  });
}

$$('.type-option').forEach((button) => button.addEventListener('click', () => {
  state.type = button.dataset.type;
  $$('.type-option').forEach(option => { option.classList.toggle('selected', option === button); option.setAttribute('aria-pressed', String(option === button)); });
  updateCategories();
}));
$('#transaction-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.type = state.type;
  const button = form.querySelector('button[type="submit"]'); button.disabled = true;
  try {
    await api(state.editing ? `/api/transactions/${encodeURIComponent(state.editing)}` : '/api/transactions', { method: state.editing ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    cancelEdit();
    form.reset(); form.elements.date.value = dateNow();
    await loadTransactions(); await loadBudget($('#budget-form').elements.month.value || monthNow());
    setNotice('Transaction saved.');
  } catch (error) { setNotice(error.message, 'error'); }
  finally { button.disabled = false; }
});
async function deleteTransaction(id) {
  if (!window.confirm('Delete this transaction?')) return;
  try { await api(`/api/transactions/${encodeURIComponent(id)}`, { method: 'DELETE' }); await loadTransactions(); await loadBudget($('#budget-form').elements.month.value || monthNow()); setNotice('Transaction deleted.'); }
  catch (error) { setNotice(error.message, 'error'); }
}
function currentFilters() {
  const values = Object.fromEntries(new FormData($('#filter-form')).entries());
  $('#filter-form').dataset.filtered = String(Object.values(values).some(Boolean));
  return values;
}
$('#filter-form').addEventListener('submit', (event) => { event.preventDefault(); applyFilters(); });
$('#filter-form').addEventListener('reset', () => setTimeout(() => { $('#filter-form').dataset.filtered = 'false'; applyFilters(); }, 0));


async function loadBudget(month) {
  if (!month) return;
  const request = ++state.budgetRequest;
  try {
    const budget = await api(`/api/budget?month=${encodeURIComponent(month)}`);
    if (request !== state.budgetRequest) return;
    state.budget = budget;
    renderBudget();
  } catch (error) { setNotice(error.message, 'error'); }
}
function progressClass(percent) { return percent >= 100 ? 'over' : percent >= 80 ? 'warning' : ''; }
function renderBudget() {
  const { month, limit, spent } = state.budget;
  $('#preview-month').textContent = month === monthNow() ? 'THIS MONTH' : month;
  const percent = limit > 0 ? Math.round((spent / limit) * 100) : 0;
  const width = Math.min(percent, 100);
  $('#preview-spent').textContent = money(spent); $('#preview-limit').textContent = money(limit);
  $('#preview-percent').textContent = limit > 0 ? `${percent}% used` : 'No budget yet';
  $('#preview-progress').style.width = `${width}%`; $('#preview-progress').className = `progress-fill ${progressClass(limit > 0 ? spent / limit * 100 : 0)}`;
  $('#preview-budget-note').textContent = limit > 0 ? (spent >= limit ? 'You have reached your monthly spending limit.' : `${money(Math.max(limit - spent, 0))} left in your plan.`) : 'Set a monthly limit to keep your plans on track.';
  const labelDate = new Date(`${month}-01T00:00:00`);
  $('#budget-month-label').textContent = labelDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  $('#budget-spent').textContent = money(spent); $('#budget-limit').textContent = limit > 0 ? money(limit) : 'Not set';
  $('#budget-progress').style.width = `${width}%`; $('#budget-progress').className = `progress-fill ${progressClass(limit > 0 ? spent / limit * 100 : 0)}`;
  $('#budget-percent').textContent = limit > 0 ? `${percent}%` : '—';
  $('#budget-status').textContent = limit > 0 ? (spent >= limit ? 'Limit reached' : spent / limit >= .8 ? 'Getting close to your limit' : 'You’re within your plan') : 'Set a budget to get started';
  $('#budget-callout').querySelector('p').textContent = limit > 0 ? (spent >= limit ? 'Your expenses have reached or passed this month’s limit. Review your history to see where it went.' : `${money(Math.max(limit - spent, 0))} remains in your plan for this month.`) : 'Small spending check-ins can make your goals feel more achievable.';
  const monthInput = $('#budget-form').elements.month;
  if (monthInput.value !== month) monthInput.value = month;
  $$('.progress-track').forEach(el => { el.setAttribute('aria-valuenow', String(width)); el.setAttribute('aria-valuetext', `${money(spent)} spent of ${money(limit)}`); });
  $('#budget-form').elements.limit.value = limit > 0 ? limit : '';
}
$('#budget-form').elements.month.addEventListener('change', (event) => loadBudget(event.target.value));
$('#budget-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const payload = { month: form.elements.month.value, limit: form.elements.limit.value };
  const button = form.querySelector('button[type="submit"]'); button.disabled = true;
  try { await api('/api/budget', { method: 'PUT', body: JSON.stringify(payload) }); await loadBudget(payload.month); setNotice('Monthly budget saved.'); }
  catch (error) { setNotice(error.message, 'error'); }
  finally { button.disabled = false; }
});

async function download(format) {
  try {
    const blob = await api(`/api/export?format=${format}`, { download: true });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `my-transactions.${format}`; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    setNotice(`${format.toUpperCase()} export downloaded.`);
  } catch (error) { setNotice(error.message, 'error'); }
}
$('#export-csv').addEventListener('click', () => download('csv'));
$('#export-json').addEventListener('click', () => download('json'));

function updateCategories(selected = '') {
  const options = state.type === 'income' ? ['Salary', 'Freelance', 'Gifts', 'Other'] : ['Food', 'Rent', 'Travel', 'Utilities', 'Other'];
  if (selected && !options.includes(selected)) options.push(selected);
  const select = $('#transaction-form').elements.category; select.replaceChildren(new Option('Choose a category', ''));
  options.forEach(value => select.add(new Option(value, value))); select.value = selected;
}
function cancelEdit() {
  state.editing = null; state.type = 'expense'; $('#transaction-form').reset();
  $('#transaction-form').elements.date.value = dateNow(); $('#entry-title').textContent = 'Add transaction';
  $('#save-entry').textContent = 'Save transaction →'; $('#cancel-edit').classList.add('hidden');
  $$('.type-option').forEach(el => { el.classList.toggle('selected', el.dataset.type === state.type); el.setAttribute('aria-pressed', String(el.dataset.type === state.type)); });
  updateCategories();
}
function editTransaction(item) {
  state.editing = item.id; state.type = item.type;
  updateCategories(item.category);
  const form = $('#transaction-form'); ['amount','date','notes'].forEach(key => form.elements[key].value = item[key]);
  $$('.type-option').forEach(el => { el.classList.toggle('selected', el.dataset.type === state.type); el.setAttribute('aria-pressed', String(el.dataset.type === state.type)); });
  $('#entry-title').textContent = 'Edit transaction'; $('#save-entry').textContent = 'Save changes →'; $('#cancel-edit').classList.remove('hidden'); form.elements.amount.focus();
}
$('#cancel-edit').addEventListener('click', cancelEdit);
$('#page-prev').addEventListener('click', () => { state.page--; renderTransactions(); });
$('#page-next').addEventListener('click', () => { state.page++; renderTransactions(); });
$('#history-retry').addEventListener('click', loadTransactions);
async function init() {
  setAuthMode(false); cancelEdit();
  try {
    const { user } = await api('/api/auth/me');
    if (user) { state.user = user; showApp(); } else showAuth();
  } catch { showAuth(); }
}
init();
