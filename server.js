#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
//  server.js  —  Beat Dancer Dev Server
//
//  Usage:
//    node server.js          → http://localhost:3000
//    node server.js 8080     → http://localhost:8080
//
//  Live API endpoints (scanned fresh on EVERY request):
//    GET /api/animations     → lists everything in ./animations/
//    GET /api/music          → lists everything in ./music/
//
//  Drop files in the folders and refresh browser — instant pickup.
// ═══════════════════════════════════════════════════════════════

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2] || '3000', 10);
const ROOT = __dirname;

// ── MIME map ──────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.fbx':  'application/octet-stream',
  '.glb':  'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.ogg':  'audio/ogg',
  '.m4a':  'audio/mp4',
  '.aac':  'audio/aac',
  '.flac': 'audio/flac',
  '.opus': 'audio/opus',
  '.weba': 'audio/webm',
  '.mp4':  'video/mp4',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
  '.ttf':  'font/ttf',
};

// ── Slot detection ─────────────────────────────────────────────
const SLOT_RULES = [
  { slot:'idle',    test: n => /house|idle|breath|stand|lounge|groove|relax/i.test(n) },
  { slot:'left',    test: n => /swing|salsa|left|strut|slide.?l|walk.?l/i.test(n) },
  { slot:'right',   test: n => /hip.?hop|step.?hip|right|moonwalk|slide.?r|walk.?r/i.test(n) },
  { slot:'up',      test: n => /gangnam|thriller|jump|raise|lift|bounce|hype|floss/i.test(n) },
  { slot:'down',    test: n => /chicken|silly|crouch|squat|low|duck|worm|limbo/i.test(n) },
  { slot:'special', test: n => /special|robot|bboy|breakdanc|northern|freeze|wave|pop|lock/i.test(n) },
];

function detectSlot(filename, usedSlots) {
  const n = filename.replace(/\.[^.]+$/, '');
  for (const rule of SLOT_RULES) {
    if (!usedSlots.has(rule.slot) && rule.test(n)) return rule.slot;
  }
  let i = 1;
  while (usedSlots.has(`extra${i}`)) i++;
  return `extra${i}`;
}

function toLabel(filename) {
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

// ── Deduplicate: prefer "Name With Spaces.fbx" over "Name_With_Underscores.fbx"
//    If both exist, skip the underscore version.
function deduplicateFiles(files) {
  // Build a set of "canonical" names (lowercase, spaces normalized)
  const seen = new Map(); // canonical → preferred filename
  for (const f of files) {
    const canonical = f.replace(/[_ ]+/g, ' ').toLowerCase().trim();
    if (!seen.has(canonical)) {
      seen.set(canonical, f);
    } else {
      // Prefer the version without underscores (has spaces or parentheses = more human-friendly)
      const existing = seen.get(canonical);
      const fHasSpaces = f.includes(' ');
      const eHasSpaces = existing.includes(' ');
      if (fHasSpaces && !eHasSpaces) seen.set(canonical, f);
    }
  }
  return Array.from(seen.values());
}

// ── Live scan functions ────────────────────────────────────────
function scanAnimations() {
  const dir = path.join(ROOT, 'animations');
  let files;
  try { files = fs.readdirSync(dir); }
  catch(e) { return []; }

  const fbxFiles = files.filter(f => /\.(fbx|glb|gltf)$/i.test(f));
  const deduped  = deduplicateFiles(fbxFiles);

  // Sort: known-slot files first (by SLOT_RULES order), then alphabetical
  deduped.sort((a, b) => {
    const an = a.replace(/\.[^.]+$/, '');
    const bn = b.replace(/\.[^.]+$/, '');
    const ai = SLOT_RULES.findIndex(r => r.test(an));
    const bi = SLOT_RULES.findIndex(r => r.test(bn));
    const av = ai === -1 ? 99 : ai;
    const bv = bi === -1 ? 99 : bi;
    if (av !== bv) return av - bv;
    return a.localeCompare(b);
  });

  const usedSlots = new Set();
  const result = [];
  for (const file of deduped) {
    const slot = detectSlot(file, usedSlots);
    usedSlots.add(slot);
    result.push({ slot, file, label: toLabel(file) });
  }
  return result;
}

function scanMusic() {
  const dir = path.join(ROOT, 'music');
  let files;
  try { files = fs.readdirSync(dir); }
  catch(e) { return []; }

  const result = [];
  for (const file of files) {
    if (!/\.(mp3|wav|ogg|m4a|aac|flac|opus|weba)$/i.test(file)) continue;
    result.push({ name: toLabel(file), file });
  }
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

// ── Request handler ────────────────────────────────────────────
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(req.url.split('?')[0]); }
  catch(e) { pathname = req.url.split('?')[0]; }

  const fullPath = path.resolve(ROOT, '.' + pathname);
  if (!fullPath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  const apiHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store',
    'Access-Control-Allow-Origin': '*',
  };

  // /api/animations — live scan + update manifest
  if (pathname === '/api/animations') {
    const list = scanAnimations();
    // Update manifest.json so offline fallback stays current
    try { fs.writeFileSync(path.join(ROOT,'animations','manifest.json'), JSON.stringify({animations:list},null,2)); } catch(e){}
    console.log(`[scan] animations: ${list.length} → ${list.map(a=>a.label).join(', ') || 'none'}`);
    res.writeHead(200, apiHeaders);
    res.end(JSON.stringify({ animations: list }));
    return;
  }

  // /api/music — live scan + update manifest
  if (pathname === '/api/music') {
    const list = scanMusic();
    try { fs.writeFileSync(path.join(ROOT,'music','manifest.json'), JSON.stringify({tracks:list},null,2)); } catch(e){}
    console.log(`[scan] music: ${list.length} → ${list.map(t=>t.name).join(', ') || 'none'}`);
    res.writeHead(200, apiHeaders);
    res.end(JSON.stringify({ tracks: list }));
    return;
  }

  // / or /index.html
  if (pathname === '/' || pathname === '/index.html') {
    fs.readFile(path.join(ROOT, 'public', 'index.html'), (err, data) => {
      if (err) { res.writeHead(404); res.end('index.html not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
    return;
  }

  // Everything else: ROOT/pathname → ROOT/public/pathname
  const candidates = [
    path.join(ROOT, pathname),
    path.join(ROOT, 'public', pathname),
  ];

  function tryNext(i) {
    if (i >= candidates.length) {
      res.writeHead(404); res.end(`Not found: ${pathname}`); return;
    }
    const fp = candidates[i];
    if (!fp.startsWith(ROOT)) { tryNext(i+1); return; }
    fs.readFile(fp, (err, data) => {
      if (err) { tryNext(i+1); return; }
      const ext  = path.extname(fp).toLowerCase();
      const mime = MIME[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type':  mime,
        'Cache-Control': 'no-cache, no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(data);
    });
  }
  tryNext(0);
});

// ── Start ──────────────────────────────────────────────────────
// ── Write manifests to disk so offline fallback stays current ─
function writeManifests() {
  try {
    const anims  = scanAnimations();
    const tracks = scanMusic();
    fs.writeFileSync(
      path.join(ROOT, 'animations', 'manifest.json'),
      JSON.stringify({ animations: anims }, null, 2)
    );
    fs.writeFileSync(
      path.join(ROOT, 'music', 'manifest.json'),
      JSON.stringify({ tracks }, null, 2)
    );
    return { anims, tracks };
  } catch(e) {
    console.warn('[manifest] Could not write manifest:', e.message);
    return { anims: scanAnimations(), tracks: scanMusic() };
  }
}

server.listen(PORT, () => {
  const W = 54;
  const bar = '═'.repeat(W);
  const pad = s => s + ' '.repeat(Math.max(0, W - s.length));
  console.log(`\n╔${bar}╗`);
  console.log(`║  ${pad('🕺  BEAT DANCER')}║`);
  console.log(`╠${bar}╣`);
  console.log(`║  ${pad('➜  http://localhost:' + PORT)}║`);
  console.log(`╠${bar}╣`);
  console.log(`║  ${pad('Drop .fbx/.glb  →  animations/')}║`);
  console.log(`║  ${pad('Drop .mp3/.wav  →  music/')}║`);
  console.log(`║  ${pad('Refresh browser — picked up instantly')}║`);
  console.log(`╚${bar}╝\n`);

  // Write fresh manifests on every startup
  const { anims, tracks } = writeManifests();
  console.log(`  Animations (${anims.length}): ${anims.map(a => a.label).join(', ') || 'none yet'}`);
  console.log(`  Music      (${tracks.length}): ${tracks.map(t => t.name).join(', ') || 'none yet'}`);
  console.log('');
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is in use. Try:  node server.js ${PORT+1}\n`);
  } else { console.error(e); }
  process.exit(1);
});
