import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import * as M from './models.js';
import { ok, wrap, HttpError, auth, allow, validate, audit, upload, scanFile, notify, setCookies, verifyRefresh } from './lib.js';
const r = Router();
const stale = (d, h = 6) => !d || Date.now() - new Date(d).getTime() > h * 36e5;
const near = (q, max = 25000) => (q.lat && q.lng ? { location: { $near: { $geometry: { type: 'Point', coordinates: [+q.lng, +q.lat] }, $maxDistance: +q.radius || max } } } : {});
const page = (q) => ({ skip: (Math.max(+q.page || 1, 1) - 1) * 20, limit: Math.min(+q.limit || 20, 50) });

// ---------- AUTH ----------
const reg = z.object({ name: z.string().min(2), email: z.string().email().optional(), phone: z.string().regex(/^\+?\d{10,13}$/).optional(),
  password: z.string().min(8), role: z.enum(['PATIENT', 'DOCTOR', 'HOSPITAL_ADMIN']).default('PATIENT') }).refine((d) => d.email || d.phone, 'email or phone required');
r.post('/auth/register', validate(reg), wrap(async (req, res) => {
  const { password, ...d } = req.body;
  const u = await M.User.create({ ...d, passwordHash: await bcrypt.hash(password, 12) });
  setCookies(res, u); ok(res, { id: u._id, name: u.name, role: u.role }, 'Registered', 201);
}));
r.post('/auth/login', validate(z.object({ identifier: z.string(), password: z.string() })), wrap(async (req, res) => {
  const { identifier, password } = req.body;
  const u = await M.User.findOne({ $or: [{ email: identifier.toLowerCase() }, { phone: identifier }], deletedAt: null });
  if (!u || u.suspended || !(await bcrypt.compare(password, u.passwordHash))) throw new HttpError(401, 'Invalid credentials');
  setCookies(res, u); ok(res, { id: u._id, name: u.name, role: u.role }, 'Logged in');
}));
r.post('/auth/refresh', wrap(async (req, res) => {
  let p; try { p = verifyRefresh(req.cookies.rt); } catch { throw new HttpError(401, 'Login again'); }
  const u = await M.User.findById(p.id); if (!u || u.tokenVersion !== p.v) throw new HttpError(401, 'Login again');
  setCookies(res, u); ok(res);
}));
r.post('/auth/logout', (req, res) => { res.clearCookie('at'); res.clearCookie('rt', { path: '/api/auth' }); ok(res, {}, 'Logged out'); });
r.post('/auth/logout-all', auth(), wrap(async (req, res) => { await M.User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } }); res.clearCookie('at'); ok(res, {}, 'Logged out everywhere'); }));
r.get('/auth/me', auth(), (req, res) => ok(res, { id: req.user._id, name: req.user.name, role: req.user.role, language: req.user.language }));
// OTP + password-reset: plug a provider into notify()/providers.sms, store hashed short-lived codes.

// ---------- HOSPITALS ----------
r.get('/hospitals', wrap(async (req, res) => {
  const q = req.query, f = { deletedAt: null, ...near(q) };
  if (q.type) f.type = q.type; if (q.emergency === 'true') f.emergency = true; if (q.city) f.city = new RegExp('^' + q.city, 'i');
  if (q.area) f.area = new RegExp('^' + q.area, 'i'); if (q.dept) f.departments = q.dept; if (q.scheme) f.schemes = q.scheme;
  if (q.beds === 'true') f['beds.general.status'] = { $ne: 'FULL' }; if (q.icu === 'true') f['beds.icu.status'] = { $ne: 'FULL' };
  if (q.q) f.$text = { $search: q.q };
  const list = await M.Hospital.find(f, null, page(q)).lean();
  ok(res, list.map((h) => ({ ...h, bedsStale: Object.values(h.beds || {}).some((b) => stale(b.updatedAt)) })));
}));
r.get('/hospitals/:id', wrap(async (req, res) => ok(res, await M.Hospital.findById(req.params.id).lean())));
r.patch('/hospitals/:id/beds', auth(), allow('HOSPITAL_ADMIN', 'GOVERNMENT_ADMIN'), wrap(async (req, res) => {
  if (req.user.role === 'HOSPITAL_ADMIN' && String(req.user.hospital) !== req.params.id) throw new HttpError(403, 'Not your hospital');
  const set = {};
  for (const [k, v] of Object.entries(req.body)) if (['general', 'icu', 'emergency', 'pediatric', 'maternity'].includes(k) && ['AVAILABLE', 'LIMITED', 'FULL'].includes(v))
    set[`beds.${k}`] = { status: v, updatedAt: new Date(), source: req.user.role, verified: req.user.role !== 'HOSPITAL_ADMIN' };
  await M.Hospital.updateOne({ _id: req.params.id }, { $set: set }); await audit(req, 'BED_UPDATE', req.params.id, set); ok(res, {}, 'Beds updated');
}));
r.put('/hospitals/:id/prices', auth(), allow('HOSPITAL_ADMIN'), wrap(async (req, res) => {
  if (String(req.user.hospital) !== req.params.id) throw new HttpError(403, 'Not your hospital');
  const prices = z.array(z.object({ service: z.string(), amount: z.number().nonnegative(), rule: z.string().optional() })).parse(req.body).map((p) => ({ ...p, updatedAt: new Date(), verified: false }));
  await M.Hospital.updateOne({ _id: req.params.id }, { prices }); await audit(req, 'PRICE_UPDATE', req.params.id); ok(res, {}, 'Prices published (pending verification)');
}));

// ---------- DOCTORS ----------
r.get('/doctors', wrap(async (req, res) => {
  const q = req.query, f = {}; if (q.specialization) f.specialization = new RegExp(q.specialization, 'i'); if (q.hospital) f.hospital = q.hospital; if (q.language) f.languages = q.language;
  ok(res, await M.Doctor.find(f, null, page(q)).populate('user', 'name').populate('hospital', 'name city').lean());
}));
r.put('/doctors/me', auth(), allow('DOCTOR'), wrap(async (req, res) => {
  const { verified, rating, ratingCount, user, ...d } = req.body; // verification is admin-only
  ok(res, await M.Doctor.findOneAndUpdate({ user: req.user._id }, d, { upsert: true, new: true }), 'Profile saved');
}));

// ---------- BLOOD & AMBULANCE ----------
r.get('/blood', wrap(async (req, res) => {
  const f = { ...near(req.query, 50000) }; if (req.query.city) f.city = new RegExp('^' + req.query.city, 'i');
  const banks = await M.BloodBank.find(f, null, page(req.query)).lean();
  ok(res, banks.map((b) => ({ ...b, inventory: req.query.group ? b.inventory.filter((i) => i.group === req.query.group) : b.inventory,
    notice: 'Availability is subject to confirmation from the blood bank.' })));
}));
r.get('/ambulances', wrap(async (req, res) => ok(res, await M.Ambulance.find({ available: true, ...near(req.query, 30000) }).limit(20).lean())));
r.post('/emergency/requests', auth(), wrap(async (req, res) => {
  const d = z.object({ kind: z.string().default('AMBULANCE'), lat: z.number(), lng: z.number(), note: z.string().max(500).optional(), clientId: z.string().optional() }).parse(req.body);
  const ex = d.clientId && await M.EmergencyRequest.findOne({ clientId: d.clientId }); if (ex) return ok(res, ex, 'Already received');
  ok(res, await M.EmergencyRequest.create({ patient: req.user._id, kind: d.kind, note: d.note, clientId: d.clientId, location: { type: 'Point', coordinates: [d.lng, d.lat] } }), 'Request sent', 201);
}));
r.get('/emergency/requests/mine', auth(), wrap(async (req, res) => ok(res, await M.EmergencyRequest.find({ patient: req.user._id }).sort('-createdAt').limit(20))));
r.patch('/ambulances/:id', auth(), allow('HOSPITAL_ADMIN', 'GOVERNMENT_ADMIN'), wrap(async (req, res) => ok(res, await M.Ambulance.findByIdAndUpdate(req.params.id, { available: !!req.body.available, updatedAt: new Date() }, { new: true }))));

// ---------- APPOINTMENTS & REVIEWS ----------
r.post('/appointments', auth(), allow('PATIENT'), wrap(async (req, res) => {
  const d = z.object({ doctor: z.string(), when: z.coerce.date(), reason: z.string().max(500).optional(), clientId: z.string().optional() }).parse(req.body);
  if (d.clientId && (await M.Appointment.findOne({ clientId: d.clientId }))) return ok(res, {}, 'Already received');
  const doc = await M.Doctor.findById(d.doctor); if (!doc) throw new HttpError(404, 'Doctor not found');
  const a = await M.Appointment.create({ ...d, patient: req.user._id, hospital: doc.hospital });
  await notify(doc.user, 'New appointment request', 'A patient requested an appointment.'); ok(res, a, 'Appointment requested', 201);
}));
r.get('/appointments/mine', auth(), wrap(async (req, res) => {
  const f = req.user.role === 'DOCTOR' ? { doctor: (await M.Doctor.findOne({ user: req.user._id }))?._id } : { patient: req.user._id };
  ok(res, await M.Appointment.find(f).sort('-when').populate('doctor').lean());
}));
r.patch('/appointments/:id', auth(), allow('DOCTOR'), wrap(async (req, res) => {
  const s = z.enum(['ACCEPTED', 'REJECTED', 'COMPLETED']).parse(req.body.status), doc = await M.Doctor.findOne({ user: req.user._id });
  const a = await M.Appointment.findOneAndUpdate({ _id: req.params.id, doctor: doc?._id }, { status: s }, { new: true }); if (!a) throw new HttpError(404, 'Not found');
  await notify(a.patient, `Appointment ${s.toLowerCase()}`, 'Check your appointments.', ['sms']); ok(res, a);
}));
r.post('/reviews', auth(), allow('PATIENT'), wrap(async (req, res) => {
  const d = z.object({ appointment: z.string(), text: z.string().max(1000).optional(), scores: z.object(Object.fromEntries(['communication', 'waiting', 'facilities', 'transparency', 'overall'].map((k) => [k, z.number().min(1).max(5)]))) }).parse(req.body);
  const a = await M.Appointment.findOne({ _id: d.appointment, patient: req.user._id, status: 'COMPLETED' }); if (!a) throw new HttpError(400, 'Only completed appointments can be reviewed');
  const rv = await M.Review.create({ ...d, patient: req.user._id, doctor: a.doctor, hospital: a.hospital }); // unique index = one review per appointment
  const doc = await M.Doctor.findById(a.doctor), n = doc.ratingCount + 1;
  await M.Doctor.updateOne({ _id: doc._id }, { rating: (doc.rating * doc.ratingCount + d.scores.overall) / n, ratingCount: n }); ok(res, rv, 'Thanks for your feedback', 201);
}));
r.post('/reviews/:id/report', auth(), wrap(async (req, res) => { await M.Review.updateOne({ _id: req.params.id }, { flagged: true }); ok(res, {}, 'Reported for moderation'); }));

// ---------- COMPLAINTS ----------
r.post('/complaints', auth(), allow('PATIENT'), upload.array('evidence', 6), wrap(async (req, res) => {
  const b = z.object({ category: z.string(), description: z.string().min(10).max(3000), hospital: z.string().optional(), doctor: z.string().optional(), incidentAt: z.coerce.date().optional(), clientId: z.string().optional() }).parse(req.body);
  if (b.clientId && (await M.Complaint.findOne({ clientId: b.clientId }))) return ok(res, {}, 'Already received');
  for (const f of req.files || []) if (!(await scanFile(f))) throw new HttpError(400, 'File failed security scan');
  const n = (await M.Complaint.countDocuments()) + 1;
  const c = await M.Complaint.create({ ...b, patient: req.user._id, complaintId: `HC-${new Date().getFullYear()}-${String(n).padStart(6, '0')}`,
    evidence: (req.files || []).map((f) => ({ path: f.filename, mime: f.mimetype, name: f.originalname })), history: [{ status: 'SUBMITTED', by: req.user._id }] });
  ok(res, { complaintId: c.complaintId, status: c.status }, 'Complaint submitted', 201);
}));
r.get('/complaints/mine', auth(), wrap(async (req, res) => ok(res, await M.Complaint.find({ patient: req.user._id }).sort('-createdAt').select('-evidence.path').lean())));
r.get('/complaints/track/:cid', auth(), wrap(async (req, res) => {
  const c = await M.Complaint.findOne({ complaintId: req.params.cid, patient: req.user._id }).select('complaintId status history category'); if (!c) throw new HttpError(404, 'Not found'); ok(res, c);
}));

// ---------- ADMIN ----------
const admin = [auth(), allow('GOVERNMENT_ADMIN')];
r.get('/admin/stats', ...admin, wrap(async (req, res) => {
  const [patients, doctors, hospitals, complaints, pending, emergencies] = await Promise.all([M.User.countDocuments({ role: 'PATIENT' }), M.Doctor.countDocuments({ verified: true }), M.Hospital.countDocuments({ verified: true }),
    M.Complaint.countDocuments(), M.Complaint.countDocuments({ status: { $in: ['SUBMITTED', 'UNDER_REVIEW', 'INVESTIGATION'] } }), M.EmergencyRequest.countDocuments()]);
  ok(res, { patients, doctors, hospitals, complaints, pending, emergencies });
}));
r.patch('/admin/verify/:kind/:id', ...admin, wrap(async (req, res) => {
  const Model = { doctor: M.Doctor, hospital: M.Hospital }[req.params.kind]; if (!Model) throw new HttpError(400, 'Bad kind');
  await Model.updateOne({ _id: req.params.id }, { verified: !!req.body.verified }); await audit(req, 'VERIFY_' + req.params.kind.toUpperCase(), req.params.id, req.body); ok(res, {}, 'Updated');
}));
r.get('/admin/complaints', ...admin, wrap(async (req, res) => ok(res, await M.Complaint.find(req.query.status ? { status: req.query.status } : {}, null, page(req.query)).sort('-createdAt').lean())));
r.patch('/admin/complaints/:id', ...admin, wrap(async (req, res) => {
  const d = z.object({ status: z.enum(['UNDER_REVIEW', 'ASSIGNED', 'INVESTIGATION', 'RESOLVED', 'CLOSED']), note: z.string().optional(), assignedTo: z.string().optional() }).parse(req.body);
  const c = await M.Complaint.findByIdAndUpdate(req.params.id, { status: d.status, ...(d.assignedTo && { assignedTo: d.assignedTo }), $push: { history: { status: d.status, note: d.note, by: req.user._id } } }, { new: true });
  await notify(c.patient, `Complaint ${c.complaintId}: ${d.status}`, d.note || '', ['sms', 'email']); await audit(req, 'COMPLAINT_STATUS', c.complaintId, d); ok(res, c);
}));
r.patch('/admin/users/:id/suspend', ...admin, wrap(async (req, res) => { await M.User.updateOne({ _id: req.params.id }, { suspended: !!req.body.suspended, $inc: { tokenVersion: 1 } }); await audit(req, 'SUSPEND', req.params.id, req.body); ok(res); }));
r.post('/admin/schemes', ...admin, wrap(async (req, res) => ok(res, await M.Scheme.create({ ...req.body, publishedBy: req.user._id }), 'Published', 201)));
r.get('/admin/audit', auth(), allow('GOVERNMENT_ADMIN'), wrap(async (req, res) => ok(res, await M.Audit.find({}, null, page(req.query)).sort('-createdAt').lean())));
r.get('/admin/price-outliers', ...admin, wrap(async (req, res) => { // flags prices >2x the median for the same service; a lead for review, never an accusation
  const hs = await M.Hospital.find({ 'prices.0': { $exists: true } }).select('name prices').lean(), by = {};
  hs.forEach((h) => h.prices.forEach((p) => (by[p.service] ||= []).push({ h: h.name, a: p.amount })));
  const out = []; for (const [s, v] of Object.entries(by)) { const m = v.map((x) => x.a).sort((a, b) => a - b)[Math.floor(v.length / 2)]; v.filter((x) => v.length > 2 && x.a > 2 * m).forEach((x) => out.push({ service: s, hospital: x.h, amount: x.a, median: m })); }
  ok(res, out);
}));
r.get('/schemes', wrap(async (req, res) => ok(res, await M.Scheme.find().sort('-createdAt').limit(20))));
r.get('/notifications', auth(), wrap(async (req, res) => ok(res, await M.Notification.find({ user: req.user._id }).sort('-createdAt').limit(30))));
export default r;
