'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { parseMultipart } = require('./lib/multipart');
const auth = require('./lib/auth');
const projects = require('./lib/project-store');
const platform = require('./lib/platform-store');
const aiProvider = require('./lib/ai-provider');
const { sendJson, readBody, ensureDir, mimeFromExt, safeName, makeId } = require('./lib/utils');
const { probeMedia, generateVideoProxy, tempDownloadPath, cleanupTemp } = require('./lib/proxy-generator');
const drive = require('./lib/google-drive');
const { renderProject } = require('./lib/ffmpeg-renderer');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const RENDER_DIR = path.join(ROOT, 'renders');
const PROXY_DIR = path.join(ROOT, 'temp', 'proxies');
const DOWNLOAD_DIR = path.join(ROOT, 'temp', 'downloads');

for (const dir of [PUBLIC_DIR, UPLOAD_DIR, RENDER_DIR, PROXY_DIR, DOWNLOAD_DIR, path.join(ROOT, 'projects'), path.join(ROOT, 'data'), path.join(ROOT, 'logs')]) ensureDir(dir);

function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] == null) process.env[key] = value;
  }
}
loadDotEnv();

const renderJobs = new Map();

function parseJsonBody(req, limit = 20 * 1024 * 1024) {
  return readBody(req, limit).then(buf => {
    const text = buf.toString('utf8').trim();
    return text ? JSON.parse(text) : {};
  });
}

function notFound(res) { sendJson(res, 404, { error: 'Not found' }); }
function bad(res, err, status = 400) { sendJson(res, status, { error: err && err.message ? err.message : String(err) }); }
function ok(res, data = {}) { sendJson(res, 200, data); }

function safeJoin(base, requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const finalPath = path.normalize(path.join(base, decoded));
  if (!finalPath.startsWith(base)) return null;
  return finalPath;
}

function serveFile(req, res, filePath, downloadName) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const stat = fs.statSync(filePath);
  const mime = mimeFromExt(filePath);
  const range = req.headers.range;
  const headers = {
    'content-type': mime,
    'accept-ranges': 'bytes',
    'cache-control': mime.startsWith('video/') || mime.startsWith('audio/') ? 'public, max-age=3600' : 'no-cache'
  };
  if (downloadName) headers['content-disposition'] = `attachment; filename="${safeName(downloadName)}"`;
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      if (!Number.isFinite(start)) start = 0;
      if (!Number.isFinite(end) || end >= stat.size) end = stat.size - 1;
      if (start > end || start >= stat.size) {
        res.writeHead(416, { 'content-range': `bytes */${stat.size}` });
        res.end();
        return;
      }
      headers['content-range'] = `bytes ${start}-${end}/${stat.size}`;
      headers['content-length'] = end - start + 1;
      res.writeHead(206, headers);
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
  }
  headers['content-length'] = stat.size;
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

function getAuth(req) {
  const session = auth.getRequestSession(req);
  return session.user ? session : null;
}

function requireUser(req, res) {
  const ctx = getAuth(req);
  if (!ctx) {
    sendJson(res, 401, { error: 'กรุณาเข้าสู่ระบบก่อนใช้งาน' });
    return null;
  }
  if (ctx.user.status && ctx.user.status !== 'active') {
    sendJson(res, 403, { error: 'บัญชีถูกปิดใช้งาน กรุณาติดต่อแอดมิน' });
    return null;
  }
  return ctx.user;
}

function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (!platform.canAdmin(user)) {
    sendJson(res, 403, { error: 'ต้องเป็นแอดมินหรือเจ้าของระบบ' });
    return null;
  }
  return user;
}

function classifyMime(mime) {
  mime = String(mime || '').toLowerCase();
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

async function handleAuth(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/me') {
    const ctx = getAuth(req);
    ok(res, { user: ctx ? auth.publicUser(ctx.user) : null });
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/register') {
    try {
      const body = await parseJsonBody(req);
      const user = auth.register(body);
      const sid = auth.createSession(user.id, req);
      auth.setSessionCookie(res, sid);
      ok(res, { user: auth.publicUser(user) });
    } catch (err) { bad(res, err); }
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    try {
      const body = await parseJsonBody(req);
      const user = auth.login(body);
      if (user.status && user.status !== 'active') throw new Error('บัญชีถูกปิดใช้งาน');
      const sid = auth.createSession(user.id, req);
      auth.setSessionCookie(res, sid);
      ok(res, { user: auth.publicUser(user) });
    } catch (err) { bad(res, err, 401); }
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const ctx = auth.getRequestSession(req);
    if (ctx.sid) auth.destroySession(ctx.sid);
    auth.clearSessionCookie(res);
    ok(res, { ok: true });
    return true;
  }
  if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/api/auth/sso') {
    try {
      const token = req.method === 'GET' ? url.searchParams.get('token') : (await parseJsonBody(req)).token;
      const user = auth.loginFromSso(token);
      const sid = auth.createSession(user.id, req);
      auth.setSessionCookie(res, sid);
      if (req.method === 'GET') { res.writeHead(302, { location: '/' }); res.end(); }
      else ok(res, { user: auth.publicUser(user) });
    } catch (err) { bad(res, err, 401); }
    return true;
  }
  return false;
}

async function handleProjects(req, res, url, user) {
  if (req.method === 'GET' && url.pathname === '/api/projects') return ok(res, { projects: projects.listProjects(user.id) }), true;
  if (req.method === 'GET' && url.pathname === '/api/projects/last') return ok(res, { project: projects.getOrCreateLastProject(user) }), true;
  if (req.method === 'POST' && url.pathname === '/api/projects') {
    const body = await parseJsonBody(req);
    return ok(res, { project: projects.createProject(user, body.name) }), true;
  }
  const m = url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(autosave))?$/);
  if (m) {
    const projectId = decodeURIComponent(m[1]);
    if (req.method === 'GET') {
      const project = projects.loadProject(user.id, projectId);
      if (!project) return notFound(res), true;
      return ok(res, { project }), true;
    }
    if (req.method === 'PUT' || (req.method === 'POST' && m[2] === 'autosave')) {
      const body = await parseJsonBody(req, 50 * 1024 * 1024);
      const project = body.project || body;
      project.id = projectId;
      const saved = projects.autosaveProject(user.id, project);
      return ok(res, { project: saved, autosavedAt: saved.autosavedAt }), true;
    }
    if (req.method === 'DELETE') {
      projects.deleteProject(user.id, projectId);
      return ok(res, { ok: true }), true;
    }
  }
  return false;
}

async function handleUpload(req, res, user) {
  try {
    const { files } = await parseMultipart(req, { uploadDir: UPLOAD_DIR, limitBytes: Number(process.env.UPLOAD_LIMIT_BYTES || 4 * 1024 * 1024 * 1024) });
    const assets = [];
    for (const file of files) {
      const type = classifyMime(file.mimeType);
      let media = { duration: 0, width: 0, height: 0, hasVideo: false, hasAudio: false };
      try { media = await probeMedia(file.path); } catch (_) {}
      const assetId = makeId('asset');
      const asset = {
        id: assetId, source: 'upload', type, name: file.originalName, storedName: file.storedName,
        url: `/uploads/${encodeURIComponent(file.storedName)}`, mimeType: file.mimeType, size: file.size,
        duration: media.duration || 6, width: media.width || 0, height: media.height || 0,
        hasVideo: media.hasVideo, hasAudio: media.hasAudio || type === 'audio', createdAt: new Date().toISOString(), proxies: {}
      };
      if (type === 'video') {
        try { const proxy = await generateVideoProxy(file.path, assetId, '360p'); asset.proxies['360p'] = { url: proxy.url, createdAt: new Date().toISOString() }; }
        catch (err) { console.error('[proxy upload]', err.message); }
      }
      assets.push(asset);
    }
    ok(res, { assets });
  } catch (err) { bad(res, err); }
}

async function handleDrive(req, res, url, user) {
  if (req.method === 'POST' && url.pathname === '/api/drive/import') {
    try {
      const body = await parseJsonBody(req, 2 * 1024 * 1024);
      const token = body.accessToken;
      if (!token) throw new Error('ต้องเชื่อมต่อ Google Drive ก่อน');
      const meta = body.fileId ? await drive.getMetadata(body.fileId, token) : body;
      const type = classifyMime(meta.mimeType || body.mimeType);
      const assetId = makeId('asset');
      const asset = {
        id: assetId, source: 'google_drive', type, driveFileId: meta.id || body.fileId,
        name: meta.name || body.name || 'Google Drive File', mimeType: meta.mimeType || body.mimeType,
        size: meta.size ? Number(meta.size) : 0, thumbnail: meta.thumbnailLink || body.thumbnail || null,
        url: meta.thumbnailLink || '', duration: meta.videoMediaMetadata && meta.videoMediaMetadata.durationMillis ? Number(meta.videoMediaMetadata.durationMillis) / 1000 : 6,
        width: meta.videoMediaMetadata && meta.videoMediaMetadata.width || meta.imageMediaMetadata && meta.imageMediaMetadata.width || 0,
        height: meta.videoMediaMetadata && meta.videoMediaMetadata.height || meta.imageMediaMetadata && meta.imageMediaMetadata.height || 0,
        hasVideo: type === 'video', hasAudio: type === 'audio', createdAt: new Date().toISOString(), proxies: {}
      };
      if (type === 'video' && body.createProxy !== false) {
        const tempPath = tempDownloadPath(asset.name);
        try {
          await drive.downloadFile(asset.driveFileId, token, tempPath);
          const media = await probeMedia(tempPath);
          asset.duration = media.duration || asset.duration; asset.width = media.width || asset.width; asset.height = media.height || asset.height; asset.hasAudio = media.hasAudio;
          const quality = body.quality || '360p';
          const proxy = await generateVideoProxy(tempPath, asset.id, quality);
          asset.proxies[quality] = { url: proxy.url, createdAt: new Date().toISOString() };
        } finally { fs.unlink(tempPath, () => {}); }
      }
      ok(res, { asset });
    } catch (err) { bad(res, err); }
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/api/proxy/create') {
    try {
      const body = await parseJsonBody(req, 2 * 1024 * 1024);
      const asset = body.asset; const quality = body.quality || '360p';
      if (!asset) throw new Error('Missing asset');
      let mediaPath;
      if (asset.source === 'upload') mediaPath = path.join(UPLOAD_DIR, safeName(asset.storedName));
      else if (asset.source === 'google_drive') { if (!body.accessToken) throw new Error('ต้องเชื่อมต่อ Google Drive เพื่อสร้าง proxy'); mediaPath = tempDownloadPath(asset.name); await drive.downloadFile(asset.driveFileId, body.accessToken, mediaPath); }
      else throw new Error('Unsupported asset source');
      const proxy = await generateVideoProxy(mediaPath, asset.id, quality);
      if (asset.source === 'google_drive') fs.unlink(mediaPath, () => {});
      ok(res, { proxy: { quality, url: proxy.url } });
    } catch (err) { bad(res, err); }
    return true;
  }
  return false;
}

async function handleRender(req, res, url, user) {
  if (req.method === 'POST' && url.pathname === '/api/render/quote') {
    try {
      const body = await parseJsonBody(req, 2 * 1024 * 1024);
      const quote = platform.getRenderQuote(user, body.quality || body.outputPreset, body);
      ok(res, { quote, user: auth.publicUser(auth.getUserById(user.id)) });
    } catch (err) { bad(res, err); }
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/api/render-jobs') {
    try {
      const body = await parseJsonBody(req, 80 * 1024 * 1024);
      const project = body.project;
      if (!project) throw new Error('Missing project');
      const quality = body.outputPreset || body.quality || '480p';
      const quote = platform.getRenderQuote(user, quality, { platformJobId: body.platformJobId || project.platformJobId });
      if (!quote.canRender) throw new Error(`เครดิตไม่พอสำหรับ ${quote.label}: ต้องใช้ ${quote.cost} เครดิต`);
      let tx = null;
      if (quote.cost > 0) tx = platform.chargeCredits(user.id, quote.cost, `Render ${quote.quality}`, { projectId: project.id, quality: quote.quality }).tx;
      project.userId = user.id;
      const jobId = makeId('job');
      const record = platform.addRenderRecord({ jobId, userId: user.id, projectId: project.id, projectName: project.name, status: 'queued', quality: quote.quality, costCredits: quote.cost, watermark: quote.watermark, txId: tx && tx.id, platformJobId: body.platformJobId || project.platformJobId || null });
      renderJobs.set(jobId, { id: jobId, status: 'queued', progress: 0, createdAt: new Date().toISOString(), result: null, error: null, quote, recordId: record.id });
      setImmediate(async () => {
        const job = renderJobs.get(jobId);
        if (!job) return;
        try {
          job.status = 'rendering'; job.progress = 10; renderJobs.set(jobId, job); platform.updateRenderRecord(jobId, { status: 'rendering', progress: 10 });
          const result = await renderProject(project, { user, driveAccessToken: body.driveAccessToken, preset: body.preset, crf: body.crf, outputPreset: quote.quality, watermark: quote.watermark, watermarkText: process.env.FREE_WATERMARK_TEXT || 'Sowwan Studio Free Preview' });
          job.status = 'done'; job.progress = 100; job.result = result; job.finishedAt = new Date().toISOString(); renderJobs.set(jobId, job);
          platform.updateRenderRecord(jobId, { status: 'done', progress: 100, result, finishedAt: job.finishedAt });
        } catch (err) {
          job.status = 'error'; job.error = err.message; job.finishedAt = new Date().toISOString(); renderJobs.set(jobId, job);
          platform.updateRenderRecord(jobId, { status: 'error', error: err.message, finishedAt: job.finishedAt });
          if (quote.cost > 0) {
            try { platform.adjustCredits(user.id, quote.cost, `คืนเครดิต Render ล้มเหลว ${quote.quality}`, { jobId }); } catch (_) {}
          }
        }
      });
      ok(res, { jobId, quote, user: auth.publicUser(auth.getUserById(user.id)) });
    } catch (err) { bad(res, err); }
    return true;
  }
  const m = url.pathname.match(/^\/api\/render-jobs\/([^/]+)$/);
  if (req.method === 'GET' && m) {
    const job = renderJobs.get(decodeURIComponent(m[1]));
    if (!job) return notFound(res), true;
    ok(res, { job });
    return true;
  }
  return false;
}

async function handlePlatform(req, res, url, user) {
  if (req.method === 'GET' && url.pathname === '/api/dashboard') {
    const fresh = auth.getUserById(user.id);
    const data = platform.load();
    return ok(res, {
      user: auth.publicUser(fresh), profile: platform.getProfile(user.id), projects: projects.listProjects(user.id),
      creditPackages: data.creditPackages, renderPolicy: { free: '480p + watermark', trial1080Cost: 5, marketplaceRender: 'covered by commission' },
      stats: { jobs: data.jobs.filter(j => j.clientId === user.id || j.assignedTo === user.id).length, campaigns: data.campaigns.filter(c => c.sponsorId === user.id || c.assignedTo === user.id).length }
    }), true;
  }
  if (req.method === 'GET' && url.pathname === '/api/credits') {
    const data = platform.load();
    return ok(res, { user: auth.publicUser(auth.getUserById(user.id)), packages: data.creditPackages, transactions: data.transactions.filter(t => t.userId === user.id).slice(0, 100), topups: data.topups.filter(t => t.userId === user.id).slice(0, 50) }), true;
  }
  if (req.method === 'POST' && url.pathname === '/api/credits/topups') {
    try { const body = await parseJsonBody(req); return ok(res, { topup: platform.createTopupRequest(user, body) }), true; } catch (err) { bad(res, err); return true; }
  }
  if (req.method === 'GET' && url.pathname === '/api/profile') return ok(res, { profile: platform.getProfile(user.id) }), true;
  if (req.method === 'PUT' && url.pathname === '/api/profile') {
    try { const body = await parseJsonBody(req); return ok(res, { profile: platform.updateProfile(user, body) }), true; } catch (err) { bad(res, err); return true; }
  }
  if (req.method === 'GET' && url.pathname === '/api/marketplace/freelancers') return ok(res, { freelancers: platform.listFreelancers() }), true;
  if (url.pathname === '/api/marketplace/jobs') {
    if (req.method === 'GET') return ok(res, { jobs: platform.listJobs(user) }), true;
    if (req.method === 'POST') { try { const body = await parseJsonBody(req); return ok(res, { job: platform.createJob(user, body) }), true; } catch (err) { bad(res, err); return true; } }
  }
  let m = url.pathname.match(/^\/api\/marketplace\/jobs\/([^/]+)\/(apply|assign|status)$/);
  if (m && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const id = decodeURIComponent(m[1]);
      if (m[2] === 'apply') return ok(res, { job: platform.applyJob(user, id, body.message) }), true;
      if (m[2] === 'assign') return ok(res, { job: platform.assignJob(user, id, body.freelancerId) }), true;
      return ok(res, { job: platform.updateJobStatus(user, id, body.status) }), true;
    } catch (err) { bad(res, err); return true; }
  }
  if (url.pathname === '/api/sponsor/campaigns') {
    if (req.method === 'GET') return ok(res, { campaigns: platform.listCampaigns() }), true;
    if (req.method === 'POST') { try { const body = await parseJsonBody(req); return ok(res, { campaign: platform.createCampaign(user, body) }), true; } catch (err) { bad(res, err); return true; } }
  }
  m = url.pathname.match(/^\/api\/sponsor\/campaigns\/([^/]+)\/(apply|status)$/);
  if (m && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req); const id = decodeURIComponent(m[1]);
      if (m[2] === 'apply') return ok(res, { campaign: platform.applyCampaign(user, id, body.message) }), true;
      return ok(res, { campaign: platform.updateCampaignStatus(user, id, body.status, body.assignedTo) }), true;
    } catch (err) { bad(res, err); return true; }
  }
  if (req.method === 'GET' && url.pathname === '/api/users/search') return ok(res, { users: platform.searchUsers(user, url.searchParams.get('q') || '') }), true;
  if (req.method === 'GET' && url.pathname === '/api/friends') return ok(res, platform.listFriends(user)), true;
  if (req.method === 'POST' && url.pathname === '/api/friends/request') { try { const body = await parseJsonBody(req); return ok(res, { request: platform.requestFriend(user, body.userId) }), true; } catch (err) { bad(res, err); return true; } }
  if (req.method === 'POST' && url.pathname === '/api/friends/respond') { try { const body = await parseJsonBody(req); return ok(res, { request: platform.respondFriend(user, body.requestId, !!body.accept) }), true; } catch (err) { bad(res, err); return true; } }
  if (req.method === 'GET' && url.pathname === '/api/chat/conversations') return ok(res, { conversations: platform.conversations(user) }), true;
  if (req.method === 'GET' && url.pathname === '/api/chat/messages') { try { return ok(res, { messages: platform.listMessages(user, url.searchParams.get('userId')) }), true; } catch (err) { bad(res, err); return true; } }
  if (req.method === 'POST' && url.pathname === '/api/chat/messages') { try { const body = await parseJsonBody(req); return ok(res, { message: platform.sendMessage(user, body.userId, body.text) }), true; } catch (err) { bad(res, err); return true; } }
  if (req.method === 'GET' && url.pathname === '/api/ai/models') return ok(res, { models: aiProvider.availableModels(), jobs: platform.listAiJobs(user) }), true;
  if (req.method === 'GET' && url.pathname === '/api/ai/jobs') return ok(res, { jobs: platform.listAiJobs(user) }), true;
  if (req.method === 'POST' && url.pathname === '/api/ai/jobs') {
    try {
      const body = await parseJsonBody(req, 4 * 1024 * 1024);
      const job = platform.createAiJob(user, body);
      setImmediate(async () => {
        try {
          platform.updateAiJob(job.id, { status: 'running' });
          const result = await aiProvider.runAiJob(job);
          platform.updateAiJob(job.id, { status: 'done', result });
        } catch (err) { platform.updateAiJob(job.id, { status: 'error', error: err.message }); }
      });
      return ok(res, { job }), true;
    } catch (err) { bad(res, err); return true; }
  }
  return false;
}

async function handleAdmin(req, res, url, adminUser) {
  if (req.method === 'GET' && url.pathname === '/api/admin/summary') return ok(res, { summary: platform.adminSummary(adminUser) }), true;
  if (req.method === 'GET' && url.pathname === '/api/admin/users') return ok(res, { users: auth.listUsers().map(auth.publicUser), profiles: platform.load().profiles }), true;
  let m = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (m && req.method === 'POST') {
    try { const body = await parseJsonBody(req); const user = auth.updateUser(decodeURIComponent(m[1]), body); return ok(res, { user: auth.publicUser(user) }), true; } catch (err) { bad(res, err); return true; }
  }
  m = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/credits$/);
  if (m && req.method === 'POST') {
    try { const body = await parseJsonBody(req); const result = platform.adjustCredits(decodeURIComponent(m[1]), Number(body.amount || 0), body.note || 'Admin credit adjustment', {}, adminUser.id); return ok(res, { user: auth.publicUser(result.user), tx: result.tx }), true; } catch (err) { bad(res, err); return true; }
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/topups') return ok(res, { topups: platform.load().topups }), true;
  m = url.pathname.match(/^\/api\/admin\/topups\/([^/]+)\/(approve|reject)$/);
  if (m && req.method === 'POST') { try { return ok(res, { topup: platform.updateTopup(adminUser, decodeURIComponent(m[1]), m[2]) }), true; } catch (err) { bad(res, err); return true; } }
  m = url.pathname.match(/^\/api\/admin\/profiles\/([^/]+)\/approve$/);
  if (m && req.method === 'POST') { try { const body = await parseJsonBody(req); return ok(res, { profile: platform.approveProfile(adminUser, decodeURIComponent(m[1]), body.kind || 'freelancer', body.status || 'approve') }), true; } catch (err) { bad(res, err); return true; } }
  if (req.method === 'GET' && url.pathname === '/api/admin/jobs') return ok(res, { jobs: platform.listJobs(adminUser) }), true;
  if (req.method === 'GET' && url.pathname === '/api/admin/campaigns') return ok(res, { campaigns: platform.listCampaigns() }), true;
  if (req.method === 'GET' && url.pathname === '/api/admin/renders') return ok(res, { renders: platform.load().renderRecords }), true;
  if (req.method === 'GET' && url.pathname === '/api/admin/ai-jobs') return ok(res, { jobs: platform.listAiJobs(adminUser) }), true;
  if (req.method === 'GET' && url.pathname === '/api/admin/settings') return ok(res, { settings: platform.load().settings, packages: platform.load().creditPackages }), true;
  if (req.method === 'PUT' && url.pathname === '/api/admin/settings') {
    try {
      const body = await parseJsonBody(req);
      const data = platform.load();
      data.settings = { ...data.settings, ...(body.settings || {}) };
      if (Array.isArray(body.creditPackages)) data.creditPackages = body.creditPackages;
      platform.save(data);
      return ok(res, { settings: data.settings, packages: data.creditPackages }), true;
    } catch (err) { bad(res, err); return true; }
  }
  return false;
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/config') {
    ok(res, {
      appOrigin: process.env.APP_ORIGIN || '',
      googleApiKey: process.env.GOOGLE_API_KEY || '',
      googleClientId: process.env.GOOGLE_CLIENT_ID || '',
      googleAppId: process.env.GOOGLE_APP_ID || '',
      pickerEnabled: !!(process.env.GOOGLE_API_KEY && process.env.GOOGLE_CLIENT_ID),
      previewDefault: process.env.PROXY_DEFAULT_HEIGHT || '360',
      freeRender: { quality: '480p', watermark: true },
      trial1080Cost: 5
    });
    return true;
  }
  if (await handleAuth(req, res, url)) return true;
  const adminPath = url.pathname.startsWith('/api/admin/');
  const user = adminPath ? requireAdmin(req, res) : requireUser(req, res);
  if (!user) return true;
  if (adminPath) return handleAdmin(req, res, url, user);
  if (await handleProjects(req, res, url, user)) return true;
  if (req.method === 'POST' && url.pathname === '/api/upload') return handleUpload(req, res, user), true;
  if (await handleDrive(req, res, url, user)) return true;
  if (await handleRender(req, res, url, user)) return true;
  if (await handlePlatform(req, res, url, user)) return true;
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    cleanupTemp();
    if (url.pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, url);
      if (!handled) notFound(res);
      return;
    }
    if (url.pathname.startsWith('/uploads/')) return serveFile(req, res, safeJoin(UPLOAD_DIR, url.pathname.slice('/uploads/'.length)));
    if (url.pathname.startsWith('/renders/')) {
      const filePath = safeJoin(RENDER_DIR, url.pathname.slice('/renders/'.length));
      return serveFile(req, res, filePath, path.basename(filePath || 'render.mp4'));
    }
    if (url.pathname.startsWith('/proxy/')) return serveFile(req, res, safeJoin(PROXY_DIR, url.pathname.slice('/proxy/'.length)));
    if (url.pathname === '/editor' || url.pathname === '/studio' || url.pathname === '/cloud-editor') {
      res.writeHead(302, { location: '/editor.html' }); res.end(); return;
    }
    let filePath = url.pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : safeJoin(PUBLIC_DIR, url.pathname);
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(PUBLIC_DIR, 'index.html');
    serveFile(req, res, filePath);
  } catch (err) {
    console.error('[server error]', err);
    if (!res.headersSent) bad(res, err, 500); else res.end();
  }
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, () => console.log(`Sowwan Studio Platform v4 running on http://localhost:${PORT}`));
