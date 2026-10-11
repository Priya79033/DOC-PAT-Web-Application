import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import * as M from './models.js';
import { ok, wrap, HttpError, auth, allow, validate, audit, setCookies, providers, upload, scanFile } from './lib.js';
import { children, INDIA_STATE_CAPITALS, INDIA_STATES, TREE } from './locations.js';
import { inSlot } from './availability.js';
const r = Router(), sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Complete patient history for the offline records page. Each collection is
// scoped to the authenticated patient and intentionally has no recent-item cap.
r.get('/records/mine', auth(), allow('PATIENT'), wrap(async (req, res) => {
  const patient = req.user._id;
  const [appointments, complaints, emergencies, reviews] = await Promise.all([
    M.Appointment.find({ patient }).sort('-when').populate({ path: 'doctor', populate: { path: 'user', select: 'name' } }).populate('hospital', 'name city type').lean(),
    M.Complaint.find({ patient }).sort('-createdAt').select('-evidence.path').populate('hospital', 'name city').lean(),
    M.EmergencyRequest.find({ patient }).sort('-createdAt').lean(),
    M.Review.find({ patient }).sort('-createdAt').populate('doctor', 'specialization').populate('hospital', 'name').lean(),
  ]);
  ok(res, { appointments, complaints, emergencies, reviews, exportedAt: new Date().toISOString() });
}));

// ---- Authorized-person identity review. Provider credentials are not configured in this demo;
// never accept/store Aadhaar or PAN values here. An admin records outcomes from an authorized provider.
const identityRoles = [auth(), allow('DOCTOR', 'HOSPITAL_ADMIN', 'GOVERNMENT_ADMIN', 'SUPER_ADMIN')];
r.get('/identity/me', ...identityRoles, wrap(async (req, res) => ok(res, req.user.identityChecks || {})));
r.post('/identity/request', ...identityRoles, wrap(async (req, res) => {
  if (req.user.identityChecks?.submittedAt) return ok(res, req.user.identityChecks, 'Identity review is already on file');
  if (req.body?.consent !== true) throw new HttpError(400, 'Consent is required to create an identity review request');
  const now = new Date(), checks = Object.fromEntries(['aadhaar', 'pan', 'digilocker'].map((k) => [k, { status: 'PENDING' }]));
  await M.User.updateOne({ _id: req.user._id }, { $set: { identityChecks: { ...checks, submittedAt: now, consentAt: now } } });
  await audit(req, 'IDENTITY_CHECK_REQUEST', req.user._id, { providers: ['aadhaar', 'pan', 'digilocker'] });
  ok(res, { ...checks, submittedAt: now }, 'Request queued. Complete checks with an authorized provider; no identity numbers were collected.', 202);
}));
r.get('/admin/identity-queue', auth(), allow('GOVERNMENT_ADMIN'), wrap(async (req, res) => {
  const users = await M.User.find({ 'identityChecks.submittedAt': { $exists: true }, role: { $in: ['DOCTOR', 'HOSPITAL_ADMIN', 'GOVERNMENT_ADMIN', 'SUPER_ADMIN'] } }).select('name email role hospital identityChecks').sort('identityChecks.submittedAt').limit(100).lean();
  ok(res, users);
}));
r.patch('/admin/identity/:id/:provider', auth(), allow('GOVERNMENT_ADMIN'), wrap(async (req, res) => {
  const provider = z.enum(['aadhaar', 'pan', 'digilocker']).parse(req.params.provider);
  const d = z.object({ status: z.enum(['VERIFIED', 'REJECTED', 'PENDING']), providerRef: z.string().min(1).max(200).optional() }).parse(req.body);
  if (d.status === 'VERIFIED' && !d.providerRef) throw new HttpError(400, 'A provider transaction reference is required to record a verified result');
  const user = await M.User.findOne({ _id: req.params.id, role: { $in: ['DOCTOR', 'HOSPITAL_ADMIN', 'GOVERNMENT_ADMIN', 'SUPER_ADMIN'] }, 'identityChecks.submittedAt': { $exists: true } });
  if (!user) throw new HttpError(404, 'Verification request not found');
  if (String(user._id) === String(req.user._id)) throw new HttpError(403, 'You cannot verify your own identity checks');
  const update = { [`identityChecks.${provider}.status`]: d.status, [`identityChecks.${provider}.checkedAt`]: new Date() };
  if (d.providerRef) update[`identityChecks.${provider}.providerRef`] = d.providerRef;
  await M.User.updateOne({ _id: user._id }, { $set: update });
  await audit(req, 'IDENTITY_CHECK_RESULT', user._id, { provider, status: d.status, providerRef: d.providerRef });
  ok(res, {}, 'Identity check updated');
}));

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
r.post('/auth/google', validate(z.object({ credential: z.string().min(50), patientProfile: z.object({ age: z.number().int().min(0).max(120), gender: z.enum(['FEMALE', 'MALE', 'OTHER', 'PREFER_NOT_TO_SAY']), bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional() }).optional() })), wrap(async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) throw new HttpError(503, 'Google sign-in is not configured');
  let response; try { response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(req.body.credential)}`); } catch { throw new HttpError(502, 'Google sign-in could not be reached'); }
  if (!response.ok) throw new HttpError(401, 'Google credential is invalid or expired');
  const claims = await response.json();
  if (claims.aud !== process.env.GOOGLE_CLIENT_ID || ![true, 'true'].includes(claims.email_verified) || !claims.email || Number(claims.exp) * 1000 <= Date.now()) throw new HttpError(401, 'Google account verification failed');
  const email = claims.email.toLowerCase(); let u = await M.User.findOne({ email });
  if (u && u.role !== 'PATIENT') throw new HttpError(403, 'This Google account belongs to a professional account; sign in with your password');
  if (!u) {
    if (!req.body.patientProfile) throw new HttpError(400, 'Patient age and gender are required to create an account');
    try { u = await M.User.create({ name: claims.name || email.split('@')[0], email, ...req.body.patientProfile, role: 'PATIENT', passwordHash: await bcrypt.hash(crypto.randomUUID(), 12) }); }
    catch (e) { if (e.code !== 11000) throw e; u = await M.User.findOne({ email }); }
  } else if (req.body.patientProfile) {
    await M.User.updateOne({ _id: u._id }, { $set: req.body.patientProfile }); u = await M.User.findById(u._id);
  }
  if (u.suspended) throw new HttpError(403, 'Account suspended'); setCookies(res, u); ok(res, { id: u._id, name: u.name, role: u.role }, 'Signed in with Google');
}));
r.post('/auth/otp/request', validate(id), wrap(async (req, res) => { await issue(req.body.identifier.toLowerCase(), 'login'); ok(res, {}, 'If the number is valid, a code has been sent'); }));
r.post('/auth/otp/verify', validate(id.extend({ code: z.string().length(6), patientProfile: z.object({ name: z.string().min(2), age: z.number().int().min(0).max(120), gender: z.enum(['FEMALE', 'MALE', 'OTHER', 'PREFER_NOT_TO_SAY']), bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional() }).optional() })), wrap(async (req, res) => {
  const key = req.body.identifier.toLowerCase(); let u = await M.User.findOne({ $or: [{ email: key }, { phone: key }] });
  if (u && u.role !== 'PATIENT') throw new HttpError(403, 'Phone-code sign-in is for patient accounts; use your password for this role');
  if (!u && !req.body.patientProfile) throw new HttpError(400, 'Enter your name, age and gender to create a patient account');
  await check(key, 'login', req.body.code);
  u = await M.User.findOne({ $or: [{ email: key }, { phone: key }] });
  if (!u) {
    if (!req.body.patientProfile) throw new HttpError(400, 'Enter your name, age and gender to create a patient account, then request a new code');
    const { name, ...profile } = req.body.patientProfile;
    u = await M.User.create({ name, ...profile, ...(!/@/.test(key) ? { phone: key } : { email: key }), passwordHash: await bcrypt.hash(crypto.randomUUID(), 10) });
  } else if (req.body.patientProfile && u.role === 'PATIENT') {
    const { name, ...profile } = req.body.patientProfile; await M.User.updateOne({ _id: u._id }, { $set: { name, ...profile } }); u = await M.User.findById(u._id);
  }
  if (u.suspended) throw new HttpError(403, 'Account suspended'); setCookies(res, u); ok(res, { id: u._id, name: u.name, role: u.role }, 'Logged in');
}));
r.post('/auth/password/forgot', validate(id), wrap(async (req, res) => { const k = req.body.identifier.toLowerCase(); if (await M.User.exists({ $or: [{ email: k }, { phone: k }] })) await issue(k, 'reset'); ok(res, {}, 'If the account exists, a code has been sent'); }));
r.post('/auth/password/reset', validate(id.extend({ code: z.string().length(6), password: z.string().min(8) })), wrap(async (req, res) => {
  const k = req.body.identifier.toLowerCase(); await check(k, 'reset', req.body.code);
  await M.User.updateOne({ $or: [{ email: k }, { phone: k }] }, { passwordHash: await bcrypt.hash(req.body.password, 12), $inc: { tokenVersion: 1 } }); ok(res, {}, 'Password changed. Please log in.');
}));

// ---- Location hierarchy ----
r.get('/locations', wrap(async (req, res) => {
  const parts = (req.query.path || '').split('>').filter(Boolean),
    base = children(parts), clean = (items) => [...new Set(items.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()))].sort((a, b) => a.localeCompare(b));
  const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let items = base;
  if (req.query.level === 'all') {
    const [states, cities, areas] = await Promise.all([
      M.Hospital.distinct('state', { deletedAt: null }),
      M.Hospital.distinct('city', { deletedAt: null }),
      M.Hospital.distinct('area', { deletedAt: null }),
    ]);
    return ok(res, { demo: false, items: {
      continent: ['Asia'], country: ['India'],
      state: clean([...INDIA_STATES, ...states]),
      capitals: INDIA_STATE_CAPITALS,
      city: clean([...cities, ...Object.values(TREE?.Asia?.India || {}).flatMap((places) => Object.keys(places))]),
      area: clean([...areas, ...Object.values(TREE?.Asia?.India || {}).flatMap((places) => Object.values(places).flat())]),
    } });
  }
  const states = await M.Hospital.distinct('state', { country: 'India', deletedAt: null });
    if (req.query.level === 'continent') items = ['Asia'];
    else if (req.query.level === 'country') items = ['India'];
    else if (req.query.level === 'state') items = clean([...INDIA_STATES, ...states]);
    else if (req.query.level === 'city') items = clean([...(await M.Hospital.distinct('city', { deletedAt: null })), ...Object.values(TREE?.Asia?.India || {}).flatMap((cities) => Object.keys(cities))]);
    else if (req.query.level === 'area') items = clean([...(await M.Hospital.distinct('area', { deletedAt: null })), ...Object.values(TREE?.Asia?.India || {}).flatMap((cities) => Object.values(cities).flat())]);
    else if (parts.length === 1 && parts[0] === 'Asia') items = ['India'];
  else if (parts.length === 2 && parts[1] === 'India') {
    items = clean([...INDIA_STATES, ...states, ...base]);
    return ok(res, { demo: false, items, capitals: INDIA_STATE_CAPITALS });
  }
  else if (parts.length === 3 && parts[1] === 'India') {
    const state = new RegExp(`^${escapeRegex(parts[2])}$`, 'i');
    items = clean([...(await M.Hospital.distinct('city', { state, deletedAt: null })), ...base]);
  } else if (parts.length === 4 && parts[1] === 'India') {
    const state = new RegExp(`^${escapeRegex(parts[2])}$`, 'i'), city = new RegExp(`^${escapeRegex(parts[3])}$`, 'i');
    items = clean([...(await M.Hospital.distinct('area', { state, city, deletedAt: null })), ...base]);
  }
  ok(res, { demo: false, items });
}));

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
  const d = z.object({ name: z.string().min(2), licenseNumber: z.string().min(3), type: z.enum(['GOVERNMENT', 'PRIVATE']), city: z.string(), area: z.string().optional(), phone: z.string().optional(), lat: z.number(), lng: z.number() }).parse(req.body);
  const h = await M.Hospital.create({ ...d, location: { type: 'Point', coordinates: [d.lng, d.lat] }, verified: false }); await M.User.updateOne({ _id: req.user._id }, { hospital: h._id });
  await audit(req, 'HOSPITAL_CLAIM', h._id); ok(res, h, 'Submitted. Shown as unverified until a government admin verifies it.', 201);
}));
r.post('/hospital/verification-documents', ...HA, upload.array('documents', 5), wrap(async (req, res) => {
  const hospitalId = mine(req.user), files = req.files || [];
  if (!files.length) throw new HttpError(400, 'Choose at least one hospital licence document');
  const allowed = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  try {
    for (const file of files) if (!allowed.has(file.mimetype) || !(await scanFile(file))) throw new HttpError(400, 'Hospital documents must be clean PDF or image files');
    const documents = files.map((file) => ({ path: file.filename, mime: file.mimetype, name: path.basename(file.originalname).slice(0, 180), uploadedAt: new Date() }));
    await M.Hospital.updateOne({ _id: hospitalId }, { $push: { verificationDocuments: { $each: documents } } });
    await audit(req, 'HOSPITAL_DOCUMENTS_UPLOAD', hospitalId, { count: documents.length }); ok(res, { count: documents.length }, 'Documents submitted for admin review', 201);
  } catch (e) { await Promise.all(files.map((file) => fs.unlink(file.path).catch(() => {}))); throw e; }
}));
r.get('/admin/hospitals/:id/documents/:file', auth(), allow('GOVERNMENT_ADMIN'), wrap(async (req, res) => {
  const filename = path.basename(req.params.file), h = await M.Hospital.findOne({ _id: req.params.id, 'verificationDocuments.path': filename });
  if (!h) throw new HttpError(404, 'Document not found');
  await audit(req, 'HOSPITAL_DOCUMENT_VIEW', h._id, { file: filename });
  const full = path.resolve('uploads', filename); res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }); res.sendFile(full);
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
    M.Hospital.find({ verified: false, deletedAt: null }).select('+verificationDocuments').sort('-createdAt').limit(100).lean(),
  ]);
  ok(res, { doctors, hospitals });
}));
r.get('/admin/users', auth(), allow('GOVERNMENT_ADMIN'), wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const filter = q ? { $or: [{ name: new RegExp(escaped, 'i') }, { email: new RegExp(escaped, 'i') }, { phone: new RegExp(escaped, 'i') }] } : {};
  const users = await M.User.find(filter).select('name email phone role hospital suspended createdAt').sort('-createdAt').limit(100).lean();
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
