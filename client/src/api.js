const API = import.meta.env.VITE_API_URL || '/api';
const CACHE_PREFIX = 'c:';
const QUEUE_KEY = 'healthconnect:queue';

function readQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } }
function writeQueue(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }
export async function pendingCount() { return readQueue().length; }

async function request(path, options = {}, retried = false) {
  const headers = { 'X-Requested-With': 'healthconnect', ...(options.headers || {}) };
  let body = options.body;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  const response = await fetch(API + path, { method: options.method || 'GET', credentials: 'include', headers, body: options.form || body });
  if (response.status === 401 && !retried && !path.startsWith('/auth/')) {
    const refresh = await fetch(API + '/auth/refresh', { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'healthconnect' } });
    if (refresh.ok) return request(path, options, true);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) { const e = new Error(payload.message || `Request failed (${response.status})`); e.status = response.status; throw e; }
  return payload.data;
}

export const api = request;

export async function cachedGet(path) {
  const key = CACHE_PREFIX + path;
  try {
    const data = await request(path);
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
    return { data, fromCache: false };
  } catch (error) {
    try { const saved = JSON.parse(localStorage.getItem(key)); if (saved) return { data: saved.data, fromCache: true, cachedAt: saved.at }; } catch { /* ignore corrupt cache */ }
    throw error;
  }
}

export async function queuedPost(path, body) {
  try { return await request(path, { method: 'POST', body }); }
  catch (error) {
    if (navigator.onLine && !(error instanceof TypeError)) throw error;
    const item = { path, body: { ...body, clientId: body.clientId || crypto.randomUUID() }, queuedAt: Date.now() };
    writeQueue([...readQueue(), item]);
    if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then((registration) => registration.sync?.register('healthconnect-sync')).catch(() => {});
    return { queued: true };
  }
}

export async function flush() {
  const queue = readQueue();
  while (queue.length) {
    try { await request(queue[0].path, { method: 'POST', body: queue[0].body }); queue.shift(); writeQueue(queue); }
    catch { break; }
  }
}
