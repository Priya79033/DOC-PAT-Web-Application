import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { User, Audit, Notification } from './models.js';
import { isAllowedFile } from './storage.js';
const SECRET = process.env.JWT_SECRET || 'dev-secret';
export const ok = (res, data = {}, message = 'OK', code = 200) => res.status(code).json({ success: true, message, data });
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
export class HttpError extends Error { constructor(code, message) { super(message); this.code = code; } }

export const signAccess = (u) => jwt.sign({ id: u._id, role: u.role, v: u.tokenVersion }, SECRET, { expiresIn: '15m' });
export const signRefresh = (u) => jwt.sign({ id: u._id, v: u.tokenVersion }, SECRET + 'r', { expiresIn: '30d' });
export const verifyRefresh = (t) => jwt.verify(t, SECRET + 'r');
export const setCookies = (res, u) => {
  const o = { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' };
  res.cookie('at', signAccess(u), { ...o, maxAge: 15 * 60e3 });
  res.cookie('rt', signRefresh(u), { ...o, maxAge: 30 * 864e5, path: '/api/auth' });
};

// CSRF: SameSite=strict cookies + required custom header on state-changing requests
export const csrf = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'healthconnect') return res.status(403).json({ success: false, message: 'CSRF check failed' });
  next();
};
export const auth = (required = true) => wrap(async (req, res, next) => {
  const t = req.cookies?.at;
  if (!t) { if (required) throw new HttpError(401, 'Login required'); return next(); }
  let p; try { p = jwt.verify(t, SECRET); } catch { throw new HttpError(401, 'Session expired'); }
  const u = await User.findById(p.id);
  if (!u || u.suspended || u.tokenVersion !== p.v) throw new HttpError(401, 'Session invalid');
  req.user = u; next();
});
export const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) || req.user.role === 'SUPER_ADMIN' ? next() : next(new HttpError(403, 'Not permitted'));
export const validate = (schema) => (req, res, next) => {
  const r = schema.safeParse(req.body);
  if (!r.success) return next(new HttpError(400, r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
  req.body = r.data; next();
};
export const audit = (req, action, target, meta) => Audit.create({ user: req.user?._id, action, target, meta, ip: req.ip }).catch(() => {});

// Evidence uploads: type + size allow-list. Wire a malware scanner (e.g. ClamAV) in scanFile().
export const upload = multer({
  storage: multer.diskStorage({ destination: 'uploads', filename: (r, f, cb) => cb(null, crypto.randomUUID() + path.extname(f.originalname).toLowerCase()) }),
  limits: { fileSize: 25 * 1024 * 1024, files: 6 },
  fileFilter: (r, f, cb) => (isAllowedFile(f.originalname, f.mimetype) ? cb(null, true) : cb(new HttpError(400, 'File type not allowed. Use JPG, PNG, WEBP, MP4, MOV, MP3, WAV, M4A or PDF.'))),
});
export const scanFile = async (file) => true; // TODO: integrate ClamAV / cloud scanner

// Notification provider abstraction (swap in Twilio / FCM / Indian SMS gateway)
export const providers = { email: async () => {}, sms: async () => {}, push: async () => {} };
export const notify = async (userId, title, body, channels = []) => {
  await Notification.create({ user: userId, title, body });
  await Promise.all(channels.map((c) => providers[c]?.(userId, title, body)));
};
