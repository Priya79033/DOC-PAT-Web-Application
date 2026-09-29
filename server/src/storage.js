import crypto from 'node:crypto';
import path from 'node:path';
const SECRET = process.env.JWT_SECRET || 'dev-secret';
export const EXT_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.pdf': 'application/pdf' };
const MIME_OK = new Set([...Object.values(EXT_MIME), 'audio/x-m4a', 'audio/wave', 'audio/x-wav']);
export const isAllowedFile = (name, mime) => { const e = path.extname(name).toLowerCase(); return !!EXT_MIME[e] && MIME_OK.has(mime); };
const sig = (c, f, exp) => crypto.createHmac('sha256', SECRET).update(`${c}|${f}|${exp}`).digest('hex');
export const signEvidenceUrl = (complaintId, file, ttlSec = 300) => { const exp = Date.now() + ttlSec * 1000; return `/api/evidence/${complaintId}/${file}?exp=${exp}&sig=${sig(complaintId, file, exp)}`; };
export const checkSignature = (c, f, exp, s) => +exp > Date.now() && typeof s === 'string' && s.length === 64 && crypto.timingSafeEqual(Buffer.from(sig(c, f, exp)), Buffer.from(s));
