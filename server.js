#!/usr/bin/env node
// Local server for the scenario planner. Serves the app and saves scenarios as JSON files on disk.
//   node server.js            then open http://localhost:8123
// Scenarios live in scenarios/<name>.json (override with SCENARIO_DIR, port with PORT).
// No dependencies. Listens on localhost only.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = +process.env.PORT || 8123;
const DIR = __dirname;
const SCENARIO_DIR = path.resolve(process.env.SCENARIO_DIR || path.join(DIR, 'scenarios'));
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/engine.js': ['engine.js', 'text/javascript; charset=utf-8'],
};
const MAX_BODY = 1024 * 1024;

fs.mkdirSync(SCENARIO_DIR, { recursive: true });

// Scenario name -> file name. Names are free text, so keep only safe characters in the file name.
function fileFor(name) {
  if (typeof name !== 'string') return null;
  const n = name.trim();
  if (!n || n.length > 80 || /[\u0000-\u001f]/.test(n)) return null;
  const slug = n.replace(/[^\w .()-]/g, '_');
  if (slug.startsWith('.')) return null;
  return slug + '.json';
}
const send = (res, code, body, type) => {
  res.writeHead(code, { 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const fail = (res, code, error) => send(res, code, { error });
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function listScenarios() {
  return fs.readdirSync(SCENARIO_DIR).filter(f => f.endsWith('.json')).map(f => {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(SCENARIO_DIR, f), 'utf8'));
      return { name: s.name, savedAt: s.savedAt, file: f };
    } catch (e) { return null; }
  }).filter(s => s && s.name).sort((a, b) => a.name.localeCompare(b.name));
}

const server = http.createServer(async (req, res) => {
  try {
    // Only answer requests addressed to localhost (blocks DNS-rebinding from other sites).
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (host !== 'localhost' && host !== '127.0.0.1') return fail(res, 403, 'forbidden host');
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (!p.startsWith('/api/')) {
      const hit = req.method === 'GET' && STATIC[p];
      if (!hit) return fail(res, 404, 'not found');
      return send(res, 200, fs.readFileSync(path.join(DIR, hit[0])), hit[1]);
    }

    // Writes must carry a custom header, which a foreign web page cannot send without a CORS preflight.
    if (req.method !== 'GET' && req.headers['x-planner'] !== '1') return fail(res, 403, 'missing X-Planner header');

    const m = p.match(/^\/api\/scenarios(?:\/([^/]+))?$/);
    if (!m) return fail(res, 404, 'not found');
    if (!m[1]) {
      if (req.method !== 'GET') return fail(res, 405, 'method not allowed');
      return send(res, 200, { dir: SCENARIO_DIR, scenarios: listScenarios() });
    }
    let name; try { name = decodeURIComponent(m[1]); } catch (e) { return fail(res, 400, 'bad name'); }
    const file = fileFor(name);
    if (!file) return fail(res, 400, 'invalid scenario name');
    const full = path.join(SCENARIO_DIR, file);
    if (path.dirname(full) !== SCENARIO_DIR) return fail(res, 400, 'invalid scenario name');

    if (req.method === 'GET') {
      if (!fs.existsSync(full)) return fail(res, 404, 'no such scenario');
      return send(res, 200, fs.readFileSync(full, 'utf8'));
    }
    if (req.method === 'PUT') {
      let body; try { body = JSON.parse(await readBody(req)); } catch (e) { return fail(res, 400, 'body must be JSON'); }
      if (!body || !body.data || !Array.isArray(body.data.assets)) return fail(res, 400, 'scenario needs data.assets');
      if (fs.existsSync(full)) {   // two different names must not share one file
        try { const old = JSON.parse(fs.readFileSync(full, 'utf8')); if (old.name && old.name !== name.trim()) return fail(res, 409, 'file name clashes with scenario "' + old.name + '"'); } catch (e) {}
      }
      const out = { name: name.trim(), savedAt: new Date().toISOString(), data: body.data };
      const tmp = full + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(out, null, 2)); fs.renameSync(tmp, full);   // atomic replace
      return send(res, 200, { name: out.name, savedAt: out.savedAt, file });
    }
    if (req.method === 'DELETE') {
      if (!fs.existsSync(full)) return fail(res, 404, 'no such scenario');
      fs.unlinkSync(full);
      return send(res, 200, { deleted: name.trim() });
    }
    return fail(res, 405, 'method not allowed');
  } catch (e) {
    return fail(res, 500, String(e.message || e));
  }
});
server.listen(PORT, '127.0.0.1', () => {
  console.log('Scenario planner:  http://localhost:' + PORT);
  console.log('Scenarios saved in: ' + SCENARIO_DIR);
});
