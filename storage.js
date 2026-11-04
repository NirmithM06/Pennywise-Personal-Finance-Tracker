const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const queues = new Map();
function filename(name) {
  if (!['users', 'transactions', 'budgets', 'sessions'].includes(name)) throw new Error('Unknown collection');
  return path.join(DATA_DIR, `${name}.json`);
}
async function readCollection(name) {
  try {
    const values = JSON.parse(await fs.readFile(filename(name), 'utf8'));
    if (!Array.isArray(values)) throw new Error('Expected an array');
    return values;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error(`Cannot read ${name}; original file preserved. Restore a verified backup before retrying.`, { cause: error });
  }
}
async function atomicWrite(name, values) {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  const target = filename(name), temp = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(values, null, 2) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(temp, target);
  } finally { await fs.rm(temp, { force: true }); }
}
// Queue the entire read/modify/write. Run one server process per data directory.
function updateCollection(name, change) {
  const operation = (queues.get(name) || Promise.resolve()).then(async () => {
    const values = await readCollection(name);
    const result = await change(values);
    await atomicWrite(name, values);
    return result;
  });
  queues.set(name, operation.catch(() => {}));
  return operation;
}
module.exports = { readCollection, updateCollection, DATA_DIR };
