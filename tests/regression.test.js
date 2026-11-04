const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

test('API regression: persistence, isolation, validation, sessions and exports', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'finance-test-'));
  const port = 32000 + Math.floor(Math.random() * 10000);
  let processHandle;
  async function start() {
    processHandle = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATA_DIR: dir, SESSION_SECRET: 'test-only-secret-with-at-least-32-characters' }, stdio: ['ignore','pipe','pipe'] });
    processHandle.stderr.resume();
    await Promise.race([once(processHandle.stdout,'data'), once(processHandle,'exit').then(() => { throw new Error('Server exited'); }), new Promise((_,reject) => { const t = setTimeout(() => reject(new Error('Startup timed out')), 10000); t.unref(); })]);
  }
  async function stop() { if (processHandle && processHandle.exitCode === null) { processHandle.kill(); await once(processHandle,'exit'); } }
  function client() {
    return { cookie: '', async request(route, method='GET', body, headers={}) {
      const response = await fetch(`http://localhost:${port}${route}`, {method, headers:{'Content-Type':'application/json', Cookie:this.cookie,...headers}, body:body === undefined ? undefined : JSON.stringify(body)});
      if (response.headers.get('set-cookie')) this.cookie=response.headers.get('set-cookie').split(';')[0];
      const text=await response.text(); let data; try {data=JSON.parse(text)} catch {data=text}
      return { status:response.status, data };
    }};
  }
  try {
    await start(); const a=client(), b=client();
    const register = (c,email) => c.request('/api/auth/register','POST',{name:'Test User', email, password:'test-password-123'});
    assert.equal((await a.request('/api/transactions')).status,401);
    assert.equal((await register(a,'a@example.test')).status,201);
    assert.equal((await register(b,'b@example.test')).status,201);
    const tx={type:'expense',amount:'19.99',category:'Food',date:'2026-11-04',notes:'=1+1'};
    for (const amount of ['1.10','0.29','2.30','19.99']) assert.equal((await a.request('/api/transactions','POST',{...tx,amount})).status,201);
    for (const amount of [true,[5],null,'1.001','-1','1e3']) assert.equal((await a.request('/api/transactions','POST',{...tx,amount})).status,400);
    const concurrent=await Promise.all(Array.from({length:20},()=>a.request('/api/transactions','POST',tx)));
    assert.ok(concurrent.every(r=>r.status===201));
    let records=(await a.request('/api/transactions')).data.transactions; assert.equal(records.length,24);
    assert.equal((await b.request('/api/transactions')).data.transactions.length,0);
    const id=records[0].id;
    assert.equal((await b.request(`/api/transactions/${id}`,'PUT',tx)).status,404);
    assert.equal((await b.request(`/api/transactions/${id}`,'DELETE')).status,404);
    assert.equal((await a.request(`/api/transactions/${id}`,'PUT',{...tx,amount:'0.29'})).data.transaction.amountPaise,29);
    assert.equal((await a.request('/api/budget','PUT',{month:'2026-11',limit:'19.99'})).status,200);
    const budget=(await a.request('/api/budget?month=2026-11')).data;
    records=(await a.request('/api/transactions')).data.transactions;
    assert.equal(budget.spent,records.reduce((s,r)=>s+r.amountPaise,0)/100); assert.equal(budget.limit,19.99);
    const csv=(await a.request('/api/export?format=csv')).data; assert.ok(csv.includes('"\'=1+1"'));
    assert.equal((await a.request('/api/transactions','POST',tx,{Origin:'https://another-site.test'})).status,403);
    const bad=await fetch(`http://localhost:${port}/api/transactions`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{bad'}); assert.equal(bad.status,400);
    const huge=await a.request('/api/transactions','POST',{notes:'x'.repeat(25000)}); assert.equal(huge.status,413);
    await stop(); await start(); assert.equal((await a.request('/api/auth/me')).data.user.name,'Test User');
    assert.equal((await a.request('/api/transactions')).data.transactions.length,24);
    const filename=path.join(dir,'transactions.json'), original=await fs.readFile(filename,'utf8');
    await fs.writeFile(filename,'{broken'); assert.equal((await a.request('/api/transactions','POST',tx)).status,500);
    assert.equal(await fs.readFile(filename,'utf8'),'{broken');
    await fs.writeFile(filename,original); assert.equal((await a.request('/api/transactions','POST',tx)).status,201);
    assert.equal((await a.request('/api/auth/logout','POST')).status,200); assert.equal((await a.request('/api/transactions')).status,401);
    const sessions=JSON.parse(await fs.readFile(path.join(dir,'sessions.json'))); sessions.forEach(r=>r.expiresAt=0); await fs.writeFile(path.join(dir,'sessions.json'),JSON.stringify(sessions));
    assert.equal((await b.request('/api/transactions')).status,401);
    const c=client(),d=client(); const duplicates=await Promise.all([register(c,'same@example.test'),register(d,'same@example.test')]);
    assert.deepEqual(duplicates.map(r=>r.status).sort(),[201,409]);
  } finally { await stop(); await fs.rm(dir,{recursive:true,force:true}); }
});
