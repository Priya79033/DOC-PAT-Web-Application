import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import * as M from './models.js';
import { ok, wrap, HttpError, auth, allow, validate, audit, setCookies, providers } from './lib.js';
import { children } from './locations.js';
import { inSlot } from './availability.js';
const r = Router(), sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---- OTP login + password reset (codes hashed, 10 min expiry, 5 attempts, same reply whether or not the account exists) ----
const issue = async (key, purpose) => {
  const code = String(crypto.randomInt(100000, 999999));
  await M.Otp.deleteMany({ key, purpose }); await M.Otp.create({ key, purpose, codeHash: sha(code), expiresAt: new Date(Date.now() + 10 * 60e3) });
  if (process.env.NODE_ENV !== 'production') console.log(`[DEV OTP] ${purpose} ${key}: ${code}`);
  await (/@/.test(key) ? providers.email : providers.sms)(key, 'HealthConnect code', `Your code is ${code}`); // plug in a real provider
};
const check = async (key, purpose, code) => {
  const o = await M.Otp.findOne({ key, purpose, expiresAt: { $gt: new Date() } }); if (!o || o.attempts >= 5) throw new HttpError(400, 'Code is invalid or expired');
  if (o.codeHash !== sha(String(code))) { await M.Otp.updateOne({ _id: o._id }, { $inc: { attempts: 1 } }); throw new HttpError(400, 'Code is invalid or expired'); }
  await o.deleteOne();
};
const id = z.object({ identifier: z.string().min(5) });
r.post('/auth/otp/request', validate(id), wrap(async (req, res) => { await issue(req.body.identifier.toLowerCase(), 'login'); ok(res, {}, 'If the number is valid, a code has been sent'); }));
r.post('/auth/otp/verify', validate(id.extend({ code: z.string().length(6) })), wrap(async (req, res) => {
  const key = req.body.identifier.toLowerCase(); await check(key, 'login', req.body.code);
  const u = await M.User.findOne({ $or: [{ email: key }, { phone: key }] }) || await M.User.create({ name: 'Patient', phone: key, passwordHash: await bcrypt.hash(crypto.randomUUID(), 10) });
  if (u.suspended) throw new HttpError(403, 'Account suspended'); setCookies(res, u); ok(res, { id: u._id, name: u.name, role: u.role }, 'Logged in');
}));
r.post('/auth/password/forgot', validate(id), wrap(async (req, res) => { const k = req.body.identifier.toLowerCase(); if (await M.User.exists({ $or: [{ email: k }, { phone: k }] })) await issue(k, 'reset'); ok(res, {}, 'If the account exists, a code has been sent'); }));
r.post('/auth/password/reset', validate(id.extend({ code: z.string().length(6), password: z.string().min(8) })), wrap(async (req, res) => {
  const k = req.body.identifier.toLowerCase(); await check(k, 'reset', req.body.code);
  await M.User.updateOne({ $or: [{ email: k }, { phone: k }] }, { passwordHash: await bcrypt.hash(req.body.password, 12), $inc: { tokenVersion: 1 } }); ok(res, {}, 'Password changed. Please log in.');
}));

// ---- Location hierarchy ----
r.get('/locations', (req, res) => ok(res, { demo: true, items: children((req.query.path || '').split('>').filter(Boolean)) }));

// ---- Saved facilities ----
r.get('/saved', auth(), wrap(async (req, res) => {
  const s = await M.Saved.find({ user: req.user._id }).lean();
  const [hs, ds] = await Promise.all([M.Hospital.find({ _id: { $in: s.filter((x) => x.kind === 'hospital').map((x) => x.target) } }).lean(), M.Doctor.find({ _id: { $in: s.filter((x) => x.kind === 'doctor').map((x) => x.target) } }).populate('user', 'name').lean()]);
  ok(res, { hospitals: hs, doctors: ds });
}));
r.put('/saved/:kind/:id', auth(), wrap(async (req, res) => { z.enum(['hospital', 'doctor']).parse(req.params.kind); await M.Saved.updateOne({ user: req.user._id, kind: req.params.kind, target: req.params.id }, {}, { upsert: true }); ok(res, {}, 'Saved'); }));
r.delete('/saved/:kind/:id', auth(), wrap(async (req, res) => { await M.Saved.deleteOne({ user: req.user._id, kind: req.params.kind, target: req.params.id }); ok(res, {}, 'Removed'); }));

// ---- Hospital dashboard ----
const HA = [auth(), allow('HOSPITAL_ADMIN')], mine = (u) => { if (!u.hospital) throw new HttpError(404, 'No hospital linked yet'); return u.hospital; };
r.post('/hospital/claim', ...HA, wrap(async (req, res) => {
  if (req.user.hospital) throw new HttpError(409, 'Already linked');
  const d = z.object({ name: z.string().min(2), type: z.enum(['GOVERNMENT', 'PRIVATE']), city: z.string(), area: z.string().optional(), phone: z.string().optional(), lat: z.number(), lng: z.number() }).parse(req.body);
  const h = await M.Hospital.create({ ...d, location: { type: 'Point', coordinates: [d.lng, d.lat] }, verified: false }); await M.User.updateOne({ _id: req.user._id }, { hospital: h._id });
  await audit(req, 'HOSPITAL_CLAIM', h._id); ok(res, h, 'Submitted. Shown as unverified until a government admin verifies it.', 201);
}));
r.get('/hospital/me', ...HA, wrap(async (req, res) => { const id = mine(req.user); ok(res, { hospital: await M.Hospital.findById(id).lean(), doctors: await M.Doctor.find({ hospital: id }).populate('user', 'name').lean(), appointments: await M.Appointment.find({ hospital: id }).sort('-when').limit(30).lean(), complaints: await M.Complaint.find({ hospital: id }).select('complaintId category status createdAt').sort('-createdAt').limit(30).lean() }); }));
r.put('/hospital/me', ...HA, wrap(async (req, res) => {
  const d = z.object({ phone: z.string(), emergencyPhone: z.string(), hours: z.string(), departments: z.array(z.string()), facilities: z.array(z.string()), schemes: z.array(z.string()), emergency: z.boolean() }).partial().parse(req.body); // verification and location are not editable here
  await M.Hospital.updateOne({ _id: mine(req.user) }, d); await audit(req, 'HOSPITAL_UPDATE', mine(req.user), d); ok(res, {}, 'Saved');
}));
r.patch('/notifications/:id/read', auth(), wrap(async (req, res) => { await M.Notification.updateOne({ _id: req.params.id, user: req.user._id }, { read: true }); ok(res); }));
r.get('/doctors/me', auth(), allow('DOCTOR'), wrap(async (req, res) => ok(res, await M.Doctor.findOne({ user: req.user._id }).lean())));

// ---- Admin review queues and user search ----
r.get('/admin/queue', auth(), allow('GOVERNMENT_ADMIN'), wrap(async (req, res) => {
  const [doctors, hospitals] = await Promise.all([
    M.Doctor.find({ verified: false }).populate('user', 'name email').sort('-createdAt').limit(100).lean(),
    M.Hospital.find({ verified: false, deletedAt: null }).sort('-createdAt').limit(100).lean(),
  ]);
  ok(res, { doctors, hospitals });
}));
r.get('/admin/users', auth(), allow('GOVERNMENT_ADMIN'), wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filter = q ? { $or: [{ name: new RegExp(escaped, 'i') }, { email: new RegExp(escaped, 'i') }, { phone: new RegExp(escaped, 'i') }] } : {};
  const users = await M.User.find(filter).select('-passwordHash').sort('-createdAt').limit(100).lean();
  ok(res, users);
}));

// ---- Feedback: doctor replies, public reviews, admin moderation ----
r.post('/reviews/:id/reply', auth(), allow('DOCTOR'), validate(z.object({ text: z.string().min(2).max(1000) })), wrap(async (req, res) => {
  const d = await M.Doctor.findOne({ user: req.user._id });
  const rv = await M.Review.findOneAndUpdate({ _id: req.params.id, doctor: d?._id }, { reply: { text: req.body.text, at: new Date() } }, { new: true }); if (!rv) throw new HttpError(404, 'Not found'); ok(res, rv, 'Reply posted');
}));
r.get('/doctors/:id/reviews', wrap(async (req, res) => ok(res, await M.Review.find({ doctor: req.params.id, hidden: false }).sort('-createdAt').limit(30).select('scores text reply createdAt').lean())));
r.get('/admin/reviews', auth(), allow('GOVERNMENT_ADMIN'), wrap(async (req, res) => ok(res, await M.Review.find({ flagged: true }).sort('-createdAt').limit(50).lean())));
r.patch('/admin/reviews/:id', auth(), allow('GOVERNMENT_ADMIN'), wrap(async (req, res) => { await M.Review.updateOne({ _id: req.params.id }, { hidden: !!req.body.hidden, flagged: false }); await audit(req, 'REVIEW_MODERATE', req.params.id, req.body); ok(res); }));

// ---- Chat: only between the two people on an accepted appointment, and only inside the doctor's consultation hours ----
const chatGuard = async (req) => {
  const a = await M.Appointment.findById(req.params.id).populate('doctor'); if (!a || a.status !== 'ACCEPTED') throw new HttpError(403, 'Chat opens after the doctor accepts the appointment');
  const patient = String(a.patient) === String(req.user._id), doctor = String(a.doctor.user) === String(req.user._id); if (!patient && !doctor) throw new HttpError(403, 'Not permitted');
  return { a, to: patient ? a.doctor.user : a.patient };
};
r.get('/appointments/:id/messages', auth(), wrap(async (req, res) => { const { a } = await chatGuard(req); ok(res, { open: inSlot(a.doctor.slots), messages: await M.Message.find({ appointment: req.params.id }).sort('createdAt').limit(200).lean() }); }));
r.post('/appointments/:id/messages', auth(), validate(z.object({ text: z.string().min(1).max(1000) })), wrap(async (req, res) => {
  const { a, to } = await chatGuard(req); if (!inSlot(a.doctor.slots)) throw new HttpError(403, "Chat is open only during the doctor's consultation hours");
  const m = await M.Message.create({ appointment: a._id, from: req.user._id, to, text: req.body.text }); await M.Notification.create({ user: to, title: 'New message', body: 'You have a new message on an appointment.' }); ok(res, m, 'Sent', 201);
}));
export default r;
