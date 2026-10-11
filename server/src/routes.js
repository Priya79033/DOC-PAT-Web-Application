import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import * as M from './models.js';
import { ok, wrap, HttpError, auth, allow, validate, audit, upload, scanFile, notify, setCookies, verifyRefresh } from './lib.js';
import { addFleetStream, publishFleetUpdate } from './live.js';
import { HEALTH_SCHEMES } from './schemes.js';
const r = Router();
const stale = (d, h = 6) => !d || Date.now() - new Date(d).getTime() > h * 36e5;
const near = (q, max = 25000) => (q.lat && q.lng ? { location: { $near: { $geometry: { type: 'Point', coordinates: [+q.lng, +q.lat] }, $maxDistance: +q.radius || max } } } : {});
const page = (q) => ({ skip: (Math.max(+q.page || 1, 1) - 1) * 20, limit: Math.min(+q.limit || 20, 50) });
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactText = (value) => new RegExp('^' + escapeRegex(value) + '$', 'i');
let nationalDirectoryCount = { value: null, expires: 0 };
const nationalDirectoryPages = new Map();

// ---------- AUTH ----------
const reg = z.object({ name: z.string().min(2), email: z.string().email().optional(), phone: z.string().regex(/^\+?\d{10,13}$/).optional(),
  password: z.string().min(8), role: z.enum(['PATIENT', 'DOCTOR', 'HOSPITAL_ADMIN', 'AMBULANCE_DRIVER', 'GOVERNMENT_ADMIN', 'SUPER_ADMIN']).default('PATIENT'), inviteToken: z.string().optional(), identityConsent: z.boolean().optional(), driverPhonePublicConsent: z.boolean().optional(),
  patientProfile: z.object({ age: z.number().int().min(0).max(120), gender: z.enum(['FEMALE', 'MALE', 'OTHER', 'PREFER_NOT_TO_SAY']), bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional() }).optional(),
  driverProfile: z.object({ vehicleId: z.string().min(2), inviteToken: z.string().min(16) }).optional(),
  doctorProfile: z.object({ qualification: z.string().min(2), specialization: z.string().min(2), licenseNo: z.string().min(3), experience: z.number().int().min(0).max(80), hospital: z.string().min(1), fee: z.number().nonnegative().optional() }).optional(),
  hospitalProfile: z.object({ name: z.string().min(2), licenseNumber: z.string().min(3), type: z.enum(['GOVERNMENT', 'PRIVATE']), city: z.string().min(2), area: z.string().optional(), phone: z.string().optional(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional()
}).refine((d) => d.email || d.phone, 'email or phone required')
  .refine((d) => d.role !== 'AMBULANCE_DRIVER' || !!d.phone, 'Ambulance driver contact phone is required')
  .refine((d) => d.role !== 'AMBULANCE_DRIVER' || d.driverPhonePublicConsent === true, 'Consent to share the driver phone in the public ambulance directory is required')
  .refine((d) => ['PATIENT', 'AMBULANCE_DRIVER'].includes(d.role) || d.identityConsent === true, 'Identity review consent is required for this account role')
  .refine((d) => d.role !== 'PATIENT' || !!d.patientProfile, 'Patient age and gender are required')
  .refine((d) => d.role === 'PATIENT' || !d.patientProfile, 'Patient details are only valid for patient accounts')
  .refine((d) => d.role !== 'AMBULANCE_DRIVER' || !!d.driverProfile, 'Vehicle pairing details are required for drivers')
  .refine((d) => d.role === 'AMBULANCE_DRIVER' || !d.driverProfile, 'Vehicle pairing details are only valid for driver accounts')
  .refine((d) => d.role !== 'DOCTOR' || !!d.doctorProfile, 'Doctor profile details are required')
  .refine((d) => d.role !== 'HOSPITAL_ADMIN' || !!d.hospitalProfile, 'Hospital details are required')
  .refine((d) => d.role === 'DOCTOR' || !d.doctorProfile, 'Doctor details are only valid for doctor accounts')
  .refine((d) => d.role === 'HOSPITAL_ADMIN' || !d.hospitalProfile, 'Hospital details are only valid for hospital-admin accounts');
r.post('/auth/register', validate(reg), wrap(async (req, res) => {
  const { password, inviteToken, identityConsent, driverPhonePublicConsent, patientProfile, driverProfile, doctorProfile, hospitalProfile, ...d } = req.body;
  if (doctorProfile && !(await M.Hospital.exists({ _id: doctorProfile.hospital, verified: true, deletedAt: null }))) throw new HttpError(400, 'Choose an approved registered hospital');
  let invite;
  if (['GOVERNMENT_ADMIN', 'SUPER_ADMIN'].includes(d.role)) {
    if (!inviteToken) throw new HttpError(403, 'Government and super-admin accounts require an administrator invitation');
    const tokenHash = crypto.createHash('sha256').update(inviteToken).digest('hex');
    invite = await M.RoleInvite.findOneAndUpdate({ tokenHash, role: d.role, usedAt: null, expiresAt: { $gt: new Date() } }, { usedAt: new Date() }, { new: true });
    if (!invite) throw new HttpError(403, 'Invitation is invalid, expired, or already used');
  }
  const authorized = !['PATIENT', 'AMBULANCE_DRIVER'].includes(d.role), submittedAt = authorized ? new Date() : undefined;
  const identityChecks = authorized ? { aadhaar: { status: 'PENDING' }, pan: { status: 'PENDING' }, digilocker: { status: 'PENDING' }, submittedAt, consentAt: submittedAt } : undefined;
  let u, createdHospital, assignedAmbulance;
  try {
    u = await M.User.create({ ...d, ...(patientProfile || {}), ...(driverPhonePublicConsent && { publicPhoneConsentAt: new Date() }), identityChecks, passwordHash: await bcrypt.hash(password, 12) });
    if (doctorProfile) await M.Doctor.create({ ...doctorProfile, user: u._id });
    if (driverProfile) {
      const inviteHash = crypto.createHash('sha256').update(driverProfile.inviteToken).digest('hex');
      assignedAmbulance = await M.Ambulance.findOneAndUpdate({ vehicleId: driverProfile.vehicleId, driverInviteHash: inviteHash, driverInviteExpiresAt: { $gt: new Date() }, driver: { $exists: false } }, { $set: { driver: u._id }, $unset: { driverInviteHash: 1, driverInviteExpiresAt: 1 } }, { new: true });
      if (!assignedAmbulance) throw new HttpError(403, 'Driver invitation is invalid, expired, or already used');
    }
    if (hospitalProfile) {
      const { lat, lng, ...profile } = hospitalProfile;
      createdHospital = await M.Hospital.create({ ...profile, location: { type: 'Point', coordinates: [lng, lat] }, verified: false });
      await M.User.updateOne({ _id: u._id }, { hospital: createdHospital._id });
    }
  } catch (e) {
    if (assignedAmbulance) await M.Ambulance.updateOne({ _id: assignedAmbulance._id, driver: u?._id }, { $unset: { driver: 1 }, $set: { driverInviteHash: crypto.createHash('sha256').update(driverProfile.inviteToken).digest('hex'), driverInviteExpiresAt: new Date(Date.now() + 48 * 3600e3) } });
    if (u) { await M.Doctor.deleteOne({ user: u._id }); await M.User.deleteOne({ _id: u._id }); }
    if (createdHospital) await M.Hospital.deleteOne({ _id: createdHospital._id });
    if (invite) await M.RoleInvite.updateOne({ _id: invite._id }, { $unset: { usedAt: 1 } });
    throw e;
  }
  if (authorized) await M.Audit.create({ user: u._id, action: 'IDENTITY_CHECK_REQUEST', target: String(u._id), meta: { providers: ['aadhaar', 'pan', 'digilocker'], source: 'signup' }, ip: req.ip }).catch(() => {});
  setCookies(res, u); ok(res, { id: u._id, name: u.name, role: u.role }, 'Registered', 201);
}));
r.post('/auth/login', validate(z.object({ identifier: z.string(), password: z.string(), role: z.enum(['PATIENT', 'DOCTOR', 'HOSPITAL_ADMIN', 'AMBULANCE_DRIVER', 'GOVERNMENT_ADMIN', 'SUPER_ADMIN']).optional() })), wrap(async (req, res) => {
  const { identifier, password, role } = req.body;
  const u = await M.User.findOne({ $or: [{ email: identifier.toLowerCase() }, { phone: identifier }], deletedAt: null });
  if (!u || u.suspended || !(await bcrypt.compare(password, u.passwordHash))) throw new HttpError(401, 'Invalid credentials');
  if (role && u.role !== role) throw new HttpError(403, 'This account does not use the selected role');
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
r.get('/users/me', auth(), (req, res) => {
  const { _id, name, email, phone, role, age, gender, bloodGroup, bio, location, language, createdAt } = req.user;
  ok(res, { id: _id, name, email, phone, role, age, gender, bloodGroup, bio, location, language, createdAt });
});
r.patch('/users/me', auth(), validate(z.object({
  name: z.string().trim().min(2).max(100).optional(),
  age: z.number().int().min(0).max(120).nullable().optional(),
  gender: z.enum(['FEMALE', 'MALE', 'OTHER', 'PREFER_NOT_TO_SAY']).nullable().optional(),
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).nullable().optional(),
  bio: z.string().trim().max(280).optional(),
  location: z.string().trim().max(120).optional(),
  language: z.enum(['en', 'hi']).optional(),
}).strict().refine((data) => Object.keys(data).length > 0, 'At least one profile field is required')), wrap(async (req, res) => {
  const updated = await M.User.findByIdAndUpdate(req.user._id, { $set: req.body }, { new: true, runValidators: true });
  const { _id, name, email, phone, role, age, gender, bloodGroup, bio, location, language, createdAt } = updated;
  ok(res, { id: _id, name, email, phone, role, age, gender, bloodGroup, bio, location, language, createdAt }, 'Profile updated');
}));
// OTP + password-reset: plug a provider into notify()/providers.sms, store hashed short-lived codes.

// ---------- HOSPITALS ----------
r.get('/hospitals', wrap(async (req, res) => {
  const q = req.query, f = { deletedAt: null, ...near(q) };
  if (q.verified === 'true') f.verified = true;
  if (q.verified === 'true') f.verified = true;
  if (q.type) f.type = q.type; if (q.emergency === 'true') f.emergency = true; if (q.country) f.country = new RegExp('^' + q.country.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); if (q.state) f.state = new RegExp('^' + q.state.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); if (q.city) f.city = new RegExp('^' + q.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  if (q.area && q.area !== '__all__') f.area = new RegExp('^' + q.area.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); if (q.dept) f.departments = q.dept; if (q.scheme) f.schemes = q.scheme;
  if (q.beds === 'true') f['beds.general.status'] = { $ne: 'FULL' }; if (q.icu === 'true') f['beds.icu.status'] = { $ne: 'FULL' };
  if (q.q) f.$text = { $search: q.q };
  const list = await M.Hospital.find(f, null, page(q)).sort({ name: 1, _id: 1 }).lean();
  ok(res, list.map((h) => ({ ...h, bedsStale: Object.values(h.beds || {}).some((b) => stale(b.updatedAt)) })));
}));
// Proxy the National Hospital Directory at data.gov.in. The API key stays on the server.
// These are source directory records; they are not HealthConnect verification results.
r.get('/national-hospitals', wrap(async (req, res) => {
  const key = process.env.DATA_GOV_IN_API_KEY;
  if (!key) throw new HttpError(503, 'National directory is not configured. Set DATA_GOV_IN_API_KEY on the server.');
  const pageNo = Math.max(Number(req.query.page) || 1, 1), limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const cacheKey = JSON.stringify([pageNo, limit, req.query.state || '', req.query.district || '', req.query.hospital_name || req.query.q || '', req.query.town || req.query.city || '']);
  const cached = nationalDirectoryPages.get(cacheKey);
  if (cached?.expires > Date.now()) return ok(res, cached.value);
  const params = new URLSearchParams({ 'api-key': key, format: 'json', offset: String((pageNo - 1) * limit), limit: String(limit) });
  // OGD's National Hospital Directory resource. Values are encoded by URLSearchParams.
  for (const field of ['state', 'district', 'hospital_name', 'town']) {
    const value = String(req.query[field] || '').trim();
    if (value) params.set(`filters[${field}]`, value);
  }
  if (req.query.city && !req.query.town) params.set('filters[town]', String(req.query.city).trim());
  if (req.query.q && !req.query.hospital_name) params.set('filters[hospital_name]', String(req.query.q).trim());
  const upstream = await fetch(`https://api.data.gov.in/resource/98fa254e-c5f8-4910-a19b-4828939b477d?${params}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (!upstream.ok) throw new HttpError(upstream.status === 429 ? 503 : 502, upstream.status === 429 ? 'National directory is temporarily rate limited. Try again shortly.' : 'National directory could not be reached.');
  const body = await upstream.json();
  if (!Array.isArray(body.records)) throw new HttpError(502, body.message || 'National directory returned an unexpected response.');
  const value = { records: body.records, total: Number(body.total) || null, page: pageNo, limit, source: 'National Hospital Directory · data.gov.in', sourceUpdated: '2025-06-02', sourceUrl: 'https://www.data.gov.in/resource/national-hospital-directory-geo-code-and-additional-parameters-updated-till-last-month' };
  if (nationalDirectoryPages.size >= 30) nationalDirectoryPages.delete(nationalDirectoryPages.keys().next().value);
  nationalDirectoryPages.set(cacheKey, { value, expires: Date.now() + 60e3 });
  ok(res, value);
}));
r.get('/public/stats', wrap(async (_req, res) => {
  const officialDirectoryCount = async () => {
    if (nationalDirectoryCount.expires > Date.now()) return nationalDirectoryCount.value;
    const key = process.env.DATA_GOV_IN_API_KEY;
    if (!key) return null;
    try {
      const params = new URLSearchParams({ 'api-key': key, format: 'json', limit: '1', offset: '0' });
      const response = await fetch(`https://api.data.gov.in/resource/98fa254e-c5f8-4910-a19b-4828939b477d?${params}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) { nationalDirectoryCount = { value: null, expires: Date.now() + 60e3 }; return null; }
      const body = await response.json(), total = Number(body.total);
      nationalDirectoryCount = { value: Number.isFinite(total) ? total : null, expires: Date.now() + 5 * 60e3 };
      return nationalDirectoryCount.value;
    } catch { nationalDirectoryCount = { value: null, expires: Date.now() + 60e3 }; return null; }
  };
  const [doctors, hospitalDirectoryRecords, [ratings]] = await Promise.all([
    M.Doctor.countDocuments({ verified: true }),
    officialDirectoryCount(),
    M.Review.aggregate([{ $match: { hidden: { $ne: true }, 'scores.overall': { $gte: 1, $lte: 5 } } }, { $group: { _id: null, average: { $avg: '$scores.overall' }, count: { $sum: 1 } } }]),
  ]);
  ok(res, { verifiedDoctors: doctors, hospitalDirectoryRecords, patientRating: ratings ? +ratings.average.toFixed(1) : null, reviewCount: ratings?.count || 0 });
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
  const q = req.query, f = {}; if (q.specialization) f.specialization = new RegExp(escapeRegex(q.specialization), 'i'); if (q.hospital) f.hospital = q.hospital; if (q.language) f.languages = q.language;
  ok(res, await M.Doctor.find(f, null, page(q)).sort({ verified: -1, rating: -1, ratingCount: -1, experience: -1 }).populate('user', 'name').populate('hospital', 'name city').lean());
}));
r.get('/doctors/departments', wrap(async (_req, res) => ok(res, (await M.Doctor.distinct('specialization')).filter(Boolean).sort((a, b) => a.localeCompare(b)))));
r.put('/doctors/me', auth(), allow('DOCTOR'), wrap(async (req, res) => {
  const { verified, rating, ratingCount, user, ...d } = req.body; // verification is admin-only
  ok(res, await M.Doctor.findOneAndUpdate({ user: req.user._id }, d, { upsert: true, new: true }), 'Profile saved');
}));

// ---------- BLOOD & AMBULANCE ----------
r.get('/blood/locations', wrap(async (req, res) => {
  const filter = {};
  if (req.query.state) filter.state = exactText(req.query.state);
  const regions = req.query.state ? await M.BloodBank.distinct('region', filter) : [];
  ok(res, { regions: regions.filter(Boolean).sort() });
}));
r.get('/blood', wrap(async (req, res) => {
  const f = { ...near(req.query, 50000) };
  for (const key of ['country', 'state', 'district', 'region']) if (req.query[key]) f[key] = exactText(req.query[key]);
  if (req.query.city) f.city = exactText(req.query.city);
  if (req.query.q) f.name = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const banks = await M.BloodBank.find(f, null, page(req.query)).lean();
  ok(res, banks.map((b) => {
    const selectedGroup = req.query.group && b.inventory.find((item) => item.group === req.query.group);
    return {
      ...b,
      inventory: req.query.group ? b.inventory.filter((item) => item.group === req.query.group) : b.inventory,
      ...(req.query.group && { selectedAvailability: {
        group: req.query.group,
        units: selectedGroup?.units ?? 0,
        status: !selectedGroup || selectedGroup.units == null ? 'NOT_REPORTED' : selectedGroup.units > 0 ? 'AVAILABLE' : 'NOT_AVAILABLE',
        updatedAt: selectedGroup?.updatedAt ?? null,
      } }),
      notice: 'Inventory changes quickly. Call the blood bank to confirm availability.',
    };
  }));
}));
r.get('/ambulances', wrap(async (req, res) => {
  const list = await M.Ambulance.find({ available: true, ...near(req.query, 30000) }).limit(20).lean();
  ok(res, list.map((a) => ({ _id: a._id, vehicleId: a.vehicleId, type: a.type, agency: a.agency, phone: a.phone, status: a.status, updatedAt: a.updatedAt, approxLocation: a.location.coordinates.map((n) => +n.toFixed(2)) })));
}));
r.get('/ambulances/directory', wrap(async (_req, res) => {
  const fleet = await M.Ambulance.find({}).select('vehicleId plateNumber type agency phone status updatedAt shift driver')
    .populate('driver', 'name phone publicPhoneConsentAt').sort('vehicleId').lean();
  ok(res, fleet.map(({ driver, ...ambulance }) => ({
    ...ambulance,
    driver: driver ? { name: driver.name, ...(driver.publicPhoneConsentAt && driver.phone && { phone: driver.phone }) } : null,
  })));
}));
// Exact fleet coordinates are private but available to signed-in patients, doctors and staff.
r.get('/ambulances/live', auth(), wrap(async (req, res) => {
  const items = await M.Ambulance.find({}).select('vehicleId type status location updatedAt site').populate('site', 'name location').sort('vehicleId').lean();
  ok(res, items);
}));
r.get('/ambulances/stream', auth(), (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders(); addFleetStream(res); res.write('retry: 5000\ndata: {"connected":true}\n\n');
  const heartbeat = setInterval(() => { if (!res.destroyed && !res.writableEnded) res.write(': keep-alive\n\n'); }, 20000);
  res.on('close', () => clearInterval(heartbeat));
});
// Ambulance fleet registry and location stream. Location updates are authenticated and
// geofenced against registered sites; coordinates are visible only to signed-in staff.
const fleetAccess = [auth(), allow('HOSPITAL_ADMIN', 'GOVERNMENT_ADMIN')];
const belongsToHospital = (user, hospital) => user.role !== 'HOSPITAL_ADMIN' || String(user.hospital || '') === String(hospital || '');
r.get('/ambulances/fleet', ...fleetAccess, wrap(async (req, res) => {
  const filter = req.user.role === 'HOSPITAL_ADMIN' ? { hospital: req.user.hospital } : {};
  const fleet = await M.Ambulance.find(filter).populate('site', 'name address location radiusMeters').populate('hospital', 'name city').populate('driver', 'name phone email').sort('vehicleId').lean();
  ok(res, fleet.map(({ driverInviteHash, driverInviteExpiresAt, ...a }) => ({ ...a, driverInvitePending: !!driverInviteHash && driverInviteExpiresAt > new Date() })));
}));
r.post('/ambulances/fleet', ...fleetAccess, wrap(async (req, res) => {
  const d = z.object({ vehicleId: z.string().min(2).max(40), plateNumber: z.string().min(3).max(20), type: z.string().min(2), agency: z.string().min(2), phone: z.string().min(3), equipment: z.array(z.string()).default([]), crew: z.string().optional(), site: z.string().optional(), hospital: z.string().optional(), shift: z.object({ days: z.array(z.number().int().min(0).max(6)).min(1), startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), timezone: z.literal('Asia/Kolkata').default('Asia/Kolkata') }).refine((shift) => shift.startTime !== shift.endTime, 'Shift start and end times must differ'), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() }).parse(req.body);
  const hospital = req.user.role === 'HOSPITAL_ADMIN' ? req.user.hospital : d.hospital;
  if (req.user.role === 'HOSPITAL_ADMIN' && !hospital) throw new HttpError(403, 'Register and verify a hospital before adding vehicles');
  if (d.site && !(await M.Site.exists({ _id: d.site, active: true, ...(hospital ? { hospital } : {}) }))) throw new HttpError(400, 'Choose an active site belonging to this hospital');
  const { lat, lng, hospital: _hospital, ...fields } = d; const coords = lat === undefined || lng === undefined ? undefined : { type: 'Point', coordinates: [lng, lat] };
  if (req.user.role === 'GOVERNMENT_ADMIN' && !hospital) throw new HttpError(400, 'Link the vehicle to a registered hospital');
  if (hospital && !(await M.Hospital.exists({ _id: hospital, verified: true }))) throw new HttpError(400, 'Ambulances must be linked to an approved hospital');
  const driverInviteToken = crypto.randomBytes(24).toString('base64url');
  const a = await M.Ambulance.create({ ...fields, hospital, site: d.site, driverInviteHash: crypto.createHash('sha256').update(driverInviteToken).digest('hex'), driverInviteExpiresAt: new Date(Date.now() + 48 * 3600e3), ...(coords && { location: coords }), status: 'AVAILABLE', available: true });
  publishFleetUpdate(a._id);
  const { driverInviteHash, driverInviteExpiresAt, ...vehicle } = a.toObject();
  await audit(req, 'AMBULANCE_REGISTER', a._id, { vehicleId: a.vehicleId }); ok(res, { ...vehicle, driverInviteToken }, 'Ambulance registered. Give the one-time driver invitation to its assigned driver.', 201);
}));
r.post('/ambulances/:id/driver-invite', ...fleetAccess, wrap(async (req, res) => {
  const a = await M.Ambulance.findById(req.params.id); if (!a || !belongsToHospital(req.user, a.hospital)) throw new HttpError(404, 'Ambulance not found');
  if (a.driver) throw new HttpError(409, 'A driver is already paired with this ambulance');
  const token = crypto.randomBytes(24).toString('base64url'); a.driverInviteHash = crypto.createHash('sha256').update(token).digest('hex'); a.driverInviteExpiresAt = new Date(Date.now() + 48 * 3600e3); await a.save();
  await audit(req, 'AMBULANCE_DRIVER_INVITE', a._id, { expiresAt: a.driverInviteExpiresAt }); ok(res, { vehicleId: a.vehicleId, driverInviteToken: token, expiresAt: a.driverInviteExpiresAt }, 'One-time driver invitation created');
}));
r.post('/sites', ...fleetAccess, wrap(async (req, res) => {
  const d = z.object({ name: z.string().min(2), address: z.string().optional(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), radiusMeters: z.number().int().min(25).max(5000).default(150), hospital: z.string().optional() }).parse(req.body);
  const hospital = req.user.role === 'HOSPITAL_ADMIN' ? req.user.hospital : d.hospital;
  if (req.user.role === 'HOSPITAL_ADMIN' && !hospital) throw new HttpError(403, 'Register a hospital before adding a site');
  if (req.user.role === 'GOVERNMENT_ADMIN' && !hospital) throw new HttpError(400, 'Link the site to a registered hospital');
  if (hospital && !(await M.Hospital.exists({ _id: hospital, verified: true }))) throw new HttpError(400, 'Sites must belong to an approved hospital');
  const { lat, lng, hospital: _hospital, ...fields } = d; const site = await M.Site.create({ ...fields, hospital, location: { type: 'Point', coordinates: [lng, lat] } });
  publishFleetUpdate('*');
  await audit(req, 'AMBULANCE_SITE_REGISTER', site._id); ok(res, site, 'Site registered', 201);
}));
r.get('/sites', ...fleetAccess, wrap(async (req, res) => ok(res, await M.Site.find({ active: true, ...(req.user.role === 'HOSPITAL_ADMIN' ? { hospital: req.user.hospital } : {}) }).populate('hospital', 'name').lean())));
r.patch('/ambulances/:id/location', ...fleetAccess, wrap(async (req, res) => {
  const d = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), status: z.enum(['AVAILABLE', 'DISPATCHED', 'MAINTENANCE']).optional() }).parse(req.body);
  const a = await M.Ambulance.findById(req.params.id); if (!a || !belongsToHospital(req.user, a.hospital)) throw new HttpError(404, 'Ambulance not found');
  const sites = await M.Site.find({ active: true, ...(a.hospital ? { hospital: a.hospital } : {}) }).lean();
  const distance = (p) => { const rad = (n) => n * Math.PI / 180, [lng, lat] = p.coordinates, dLat = rad(d.lat - lat), dLng = rad(d.lng - lng), h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(d.lat)) * Math.sin(dLng / 2) ** 2; return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)); };
  const site = sites.filter((s) => distance(s.location) <= s.radiusMeters).sort((a, b) => distance(a.location) - distance(b.location))[0];
  const wasDispatched = a.status === 'DISPATCHED';
  a.location = { type: 'Point', coordinates: [d.lng, d.lat] }; a.updatedAt = new Date(); a.site = site?._id || null;
  a.status = site ? (wasDispatched ? 'DISPATCHED' : 'ON_SITE') : (d.status || (wasDispatched ? 'DISPATCHED' : 'AVAILABLE')); a.available = !wasDispatched && (a.status === 'AVAILABLE' || a.status === 'ON_SITE'); await a.save();
  publishFleetUpdate(a._id);
  await audit(req, 'AMBULANCE_LOCATION_UPDATE', a._id, { site: site?._id, status: a.status }); ok(res, { id: a._id, status: a.status, site: site?.name || null, location: a.location, updatedAt: a.updatedAt });
}));
r.get('/driver/me', auth(), allow('AMBULANCE_DRIVER'), wrap(async (req, res) => {
  const vehicle = await M.Ambulance.findOne({ driver: req.user._id }).select('-driverInviteHash -driverInviteExpiresAt').populate('site', 'name address radiusMeters').populate('hospital', 'name city').lean();
  if (!vehicle) throw new HttpError(404, 'No ambulance is paired with this driver account');
  ok(res, { ...vehicle, driverContactPhone: req.user.phone, driverPhonePublicConsent: !!req.user.publicPhoneConsentAt });
}));
r.patch('/driver/public-contact', auth(), allow('AMBULANCE_DRIVER'), wrap(async (req, res) => {
  const { share } = z.object({ share: z.boolean() }).parse(req.body);
  if (share && !req.user.phone) throw new HttpError(400, 'Add a phone number to your driver account before sharing it');
  await M.User.updateOne({ _id: req.user._id }, { $set: { publicPhoneConsentAt: share ? new Date() : null } });
  await audit(req, share ? 'DRIVER_PHONE_PUBLIC_CONSENT' : 'DRIVER_PHONE_PUBLIC_CONSENT_REVOKED', req.user._id);
  ok(res, { shared: share }, share ? 'Driver phone is listed in the public ambulance directory' : 'Driver phone was removed from the public ambulance directory');
}));
r.patch('/driver/location', auth(), allow('AMBULANCE_DRIVER'), wrap(async (req, res) => {
  const d = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).parse(req.body);
  const a = await M.Ambulance.findOne({ driver: req.user._id }); if (!a) throw new HttpError(404, 'No ambulance is paired with this driver account');
  const sites = await M.Site.find({ active: true, hospital: a.hospital }).lean();
  const distance = (p) => { const rad = (n) => n * Math.PI / 180, [lng, lat] = p.coordinates, dLat = rad(d.lat - lat), dLng = rad(d.lng - lng), h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(d.lat)) * Math.sin(dLng / 2) ** 2; return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)); };
  const site = sites.filter((s) => distance(s.location) <= s.radiusMeters).sort((a, b) => distance(a.location) - distance(b.location))[0], wasDispatched = a.status === 'DISPATCHED';
  let arrived = false;
  if (wasDispatched) {
    const trip = await M.EmergencyRequest.findOne({ ambulance: a._id, status: 'DISPATCHED' }).sort('-createdAt');
    if (trip && distance(trip.location) <= 100) { trip.status = 'ARRIVED'; await trip.save(); arrived = true; await notify(trip.patient, 'Ambulance arrived', `${a.vehicleId} has reached your location.`); }
  }
  a.location = { type: 'Point', coordinates: [d.lng, d.lat] }; a.updatedAt = new Date(); a.site = site?._id || null;
  a.status = arrived ? 'ON_SITE' : site ? (wasDispatched ? 'DISPATCHED' : 'ON_SITE') : (wasDispatched ? 'DISPATCHED' : 'AVAILABLE');
  a.available = !wasDispatched; await a.save();
  publishFleetUpdate(a._id);
  await audit(req, 'AMBULANCE_LOCATION_UPDATE', a._id, { site: site?._id, status: a.status });
  ok(res, { vehicleId: a.vehicleId, status: a.status, site: site?.name || null, location: a.location, updatedAt: a.updatedAt });
}));
r.post('/emergency/requests', auth(), wrap(async (req, res) => {
  const d = z.object({ kind: z.string().default('AMBULANCE'), lat: z.number(), lng: z.number(), note: z.string().max(500).optional(), clientId: z.string().optional() }).parse(req.body);
  const ex = d.clientId && await M.EmergencyRequest.findOne({ clientId: d.clientId, patient: req.user._id }); if (ex) return ok(res, ex, 'Already received');
  const point = { type: 'Point', coordinates: [d.lng, d.lat] };
  const nearest = d.kind === 'AMBULANCE' ? await M.Ambulance.findOne({ available: true, status: { $in: ['AVAILABLE', 'ON_SITE'] }, location: { $near: { $geometry: point, $maxDistance: 30000 } } }) : null;
  if (nearest) { nearest.available = false; nearest.status = 'DISPATCHED'; nearest.site = null; await nearest.save(); publishFleetUpdate(nearest._id); }
  const request = await M.EmergencyRequest.create({ patient: req.user._id, kind: d.kind, note: d.note, clientId: d.clientId, location: point, ...(nearest && { ambulance: nearest._id, status: 'DISPATCHED' }) });
  ok(res, request, nearest ? 'Request sent; an available nearby ambulance was assigned' : 'Request sent; call 108 for immediate assistance', 201);
}));
r.get('/emergency/requests/mine', auth(), wrap(async (req, res) => ok(res, await M.EmergencyRequest.find({ patient: req.user._id }).sort('-createdAt').limit(20))));
r.get('/emergency/requests/:id', auth(), wrap(async (req, res) => {
  const trip = await M.EmergencyRequest.findOne({ _id: req.params.id, patient: req.user._id }).populate({ path: 'ambulance', select: 'vehicleId type status location updatedAt site', populate: { path: 'site', select: 'name' } }).lean();
  if (!trip) throw new HttpError(404, 'Emergency request not found'); ok(res, trip);
}));
r.patch('/ambulances/:id', auth(), allow('HOSPITAL_ADMIN', 'GOVERNMENT_ADMIN'), wrap(async (req, res) => {
  const a = await M.Ambulance.findById(req.params.id); if (!a || !belongsToHospital(req.user, a.hospital)) throw new HttpError(404, 'Ambulance not found');
  const d = z.object({ status: z.enum(['AVAILABLE', 'DISPATCHED', 'ON_SITE', 'MAINTENANCE']).optional(), shift: z.object({ days: z.array(z.number().int().min(0).max(6)).min(1), startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), timezone: z.literal('Asia/Kolkata').default('Asia/Kolkata') }).refine((shift) => shift.startTime !== shift.endTime, 'Shift start and end times must differ').optional() }).refine((value) => value.status || value.shift, 'Provide a status or shift schedule').parse(req.body);
  if (d.status) {
    a.status = d.status; a.available = d.status === 'AVAILABLE' || d.status === 'ON_SITE';
    if (!a.available) a.site = null;
  }
  if (d.shift) a.shift = d.shift;
  a.updatedAt = new Date(); await a.save(); publishFleetUpdate(a._id); await audit(req, d.shift ? 'AMBULANCE_SHIFT_UPDATE' : 'AMBULANCE_STATUS_UPDATE', a._id);
  ok(res, a, d.shift ? 'Driver shift schedule updated' : 'Fleet status updated');
}));

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
r.post('/admin/invites', ...admin, wrap(async (req, res) => {
  const role = z.enum(['GOVERNMENT_ADMIN', 'SUPER_ADMIN']).parse(req.body.role);
  if (role === 'SUPER_ADMIN' && req.user.role !== 'SUPER_ADMIN') throw new HttpError(403, 'Only a super admin can invite another super admin');
  const token = crypto.randomBytes(32).toString('base64url');
  await M.RoleInvite.create({ tokenHash: crypto.createHash('sha256').update(token).digest('hex'), role, createdBy: req.user._id, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) });
  await audit(req, 'ROLE_INVITE_CREATE', role, { expiresInHours: 48 });
  ok(res, { token, role, expiresInHours: 48 }, 'One-time invitation created', 201);
}));
r.get('/admin/stats', ...admin, wrap(async (req, res) => {
  const [patients, doctors, hospitals, complaints, pending, emergencies] = await Promise.all([M.User.countDocuments({ role: 'PATIENT' }), M.Doctor.countDocuments({ verified: true }), M.Hospital.countDocuments({ verified: true }),
    M.Complaint.countDocuments(), M.Complaint.countDocuments({ status: { $in: ['SUBMITTED', 'UNDER_REVIEW', 'INVESTIGATION'] } }), M.EmergencyRequest.countDocuments()]);
  ok(res, { patients, doctors, hospitals, complaints, pending, emergencies });
}));
r.patch('/admin/verify/:kind/:id', ...admin, wrap(async (req, res) => {
  const Model = { doctor: M.Doctor, hospital: M.Hospital }[req.params.kind]; if (!Model) throw new HttpError(400, 'Bad kind');
  if (req.params.kind === 'hospital' && req.body.verified) {
    const h = await M.Hospital.findById(req.params.id).select('+verificationDocuments');
    if (!h || !h.licenseNumber || !h.verificationDocuments?.length) throw new HttpError(400, 'Review the hospital licence number and uploaded proof documents before approval');
  }
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
const medicineInput = z.object({ name: z.string().trim().min(2).max(160), genericName: z.string().trim().min(2).max(160), strength: z.string().trim().max(80).optional(), form: z.string().trim().max(80).optional(), uses: z.string().trim().min(10).max(1200), benefits: z.string().trim().max(1200).optional(), sideEffects: z.string().trim().max(1200).optional(), prerequisites: z.string().trim().max(1200).optional(), prescription: z.enum(['REQUIRED', 'NOT_REQUIRED', 'ASK_PHARMACIST', 'UNKNOWN']), priceInr: z.number().nonnegative().optional(), priceBasis: z.enum(['PMBJP_MRP', 'NPPA_CEILING', 'NPPA_RETAIL_PRICE', 'OTHER_OFFICIAL']).optional(), pack: z.string().trim().max(100).optional(), sourceUrl: z.string().url().max(500).optional(), sourceName: z.string().trim().max(160).optional(), verifiedAt: z.string().datetime().optional(), active: z.boolean().optional() }).refine((d) => d.priceInr === undefined || (d.priceBasis && d.sourceUrl && d.sourceName && d.verifiedAt), 'A price requires an official source, price basis and verification date');
r.get('/medicines', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100), filter = { active: true };
  if (q) filter.$or = ['name', 'genericName', 'uses'].map((key) => ({ [key]: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }));
  ok(res, await M.Medicine.find(filter).sort('genericName name').limit(100).select('-verifiedBy').lean());
}));
r.get('/medicine-info', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (q.length < 2) return ok(res, { labels: [] });
  const term = q.replace(/[\\"]+/g, ' ').trim();
  if (/^(paracetamol|acetaminophen)(?:\s|$)/i.test(term)) {
    return ok(res, { labels: [{
      brand: 'Paracetamol (adult information)', generic: 'Paracetamol', ingredients: 'Paracetamol',
      uses: 'Relief of pain and high temperature (fever), including headache, toothache, sore throat, and cold or flu symptoms.',
      prerequisites: 'Adult information. Check the exact pack and strength. Ask a clinician or pharmacist first if you have had an allergy to paracetamol, have liver or kidney problems, weigh under 50 kg, or drink heavily. Do not combine it with other medicines that also contain paracetamol; taking too much can damage the liver.',
      sideEffects: 'Side effects are rare when used correctly. Serious effects can include an allergic reaction, liver problems, or blood-cell problems. Get urgent medical advice after taking more than the pack says or if you develop a severe reaction.',
      source: 'https://www.nhs.uk/medicines/paracetamol-for-adults/', sourceName: 'NHS adult medicine information',
      sourceNotice: 'Adult guidance from the UK NHS; follow the leaflet supplied with your Indian product and ask a local clinician or pharmacist.',
    }] });
  }
  const safeTerm = (value) => value.replace(/[\\"]+/g, ' ').trim().slice(0, 80);
  const requests = (url) => fetch(url, { signal: AbortSignal.timeout(4500) }).then((response) => response.ok ? response.json() : null).catch(() => null);
  const knownAliases = { paracetamol: ['acetaminophen'], acetaminophen: ['paracetamol'], salbutamol: ['albuterol'], albuterol: ['salbutamol'], frusemide: ['furosemide'], furosemide: ['frusemide'], lignocaine: ['lidocaine'], lidocaine: ['lignocaine'], adrenaline: ['epinephrine'], epinephrine: ['adrenaline'] };
  const aliasTerms = knownAliases[term.toLowerCase()] || [];
  let rxNames = [];
  let labels = [];
  // RxNorm normalizes international and alternate generic names (for example
  // paracetamol to acetaminophen) before searching the FDA label index.
  const [rx, directPayload] = await Promise.all([
    requests(`https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(term)}&search=2`),
    (async () => {
      const terms = [term, ...aliasTerms].map(safeTerm).filter(Boolean);
      const clauses = terms.flatMap((name) => [`openfda.brand_name:\"${name}\"`, `openfda.generic_name:\"${name}\"`]);
      return requests(`https://api.fda.gov/drug/label.json?search=${encodeURIComponent(`(${clauses.join('+OR+')})`)}&limit=8`);
    })(),
  ]);
  const rxcui = rx?.idGroup?.rxnormId?.[0];
  if (rxcui) {
    const related = await requests(`https://rxnav.nlm.nih.gov/REST/rxcui/${encodeURIComponent(rxcui)}/allrelated.json`);
    rxNames = (related?.allRelatedGroup?.conceptGroup || []).filter((group) => ['IN', 'PIN'].includes(group.tty))
      .flatMap((group) => group.conceptProperties || []).map((concept) => concept.name).filter(Boolean);
  }
  const terms = [...new Set([term, ...aliasTerms, ...rxNames].map(safeTerm).filter(Boolean))].slice(0, 6);
  const clauses = terms.flatMap((name) => [`openfda.brand_name:\"${name}\"`, `openfda.generic_name:\"${name}\"`]);
  const payload = directPayload?.results?.length ? directPayload : await requests(`https://api.fda.gov/drug/label.json?search=${encodeURIComponent(`(${clauses.join('+OR+')})`)}&limit=8`);
  labels = (payload?.results || []).map((label) => {
    const section = (key) => Array.isArray(label[key]) ? label[key].join('\n').slice(0, 5000) : '';
    const openfda = label.openfda || {}, setid = openfda.spl_set_id?.[0];
    return {
      brand: openfda.brand_name?.[0] || '', generic: openfda.generic_name?.[0] || '',
      ingredients: (openfda.substance_name || []).slice(0, 8).join(', '),
      uses: section('indications_and_usage') || section('purpose') || section('description'),
      prerequisites: ['contraindications', 'precautions', 'do_not_use', 'ask_doctor', 'ask_doctor_or_pharmacist'].map(section).filter(Boolean).join('\n\n'),
      sideEffects: section('adverse_reactions') || section('side_effects'), warnings: section('warnings'),
      source: setid ? `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${encodeURIComponent(setid)}` : 'https://open.fda.gov/apis/drug/label/',
      sourceName: 'US FDA / DailyMed label',
    };
  }).filter((label) => label.uses || label.prerequisites || label.sideEffects || label.warnings);
  ok(res, { labels });
}));
r.get('/admin/medicines', ...admin, wrap(async (_req, res) => ok(res, await M.Medicine.find().sort('genericName name').lean())));
r.post('/admin/medicines', ...admin, wrap(async (req, res) => {
  const d = medicineInput.parse(req.body);
  const item = await M.Medicine.create({ ...d, verifiedAt: d.priceInr === undefined ? undefined : new Date(d.verifiedAt), verifiedBy: req.user._id });
  await audit(req, 'MEDICINE_CREATE', item._id, { name: item.name, priceInr: item.priceInr, sourceName: item.sourceName });
  ok(res, item, 'Medicine published', 201);
}));
r.patch('/admin/medicines/:id', ...admin, wrap(async (req, res) => {
  const d = medicineInput.partial().parse(req.body);
  if (d.priceInr !== undefined && !(d.priceBasis && d.sourceUrl && d.sourceName && d.verifiedAt)) throw new HttpError(400, 'A price requires an official source, price basis and verification date');
  const item = await M.Medicine.findByIdAndUpdate(req.params.id, { ...d, ...(d.priceInr !== undefined && { verifiedAt: new Date(d.verifiedAt), verifiedBy: req.user._id }) }, { new: true, runValidators: true });
  if (!item) throw new HttpError(404, 'Medicine not found');
  await audit(req, 'MEDICINE_UPDATE', item._id, { name: item.name, priceInr: item.priceInr, sourceName: item.sourceName });
  ok(res, item, 'Medicine updated');
}));
r.get('/schemes', wrap(async (_req, res) => {
  const published = await M.Scheme.find().sort('-createdAt').lean();
  ok(res, [...HEALTH_SCHEMES, ...published.map((scheme) => ({ ...scheme, id: String(scheme._id), scope: scheme.region || 'Published by HealthConnect administrator', summary: scheme.body, url: '', source: '' }))]);
}));
r.get('/notifications', auth(), wrap(async (req, res) => ok(res, await M.Notification.find({ user: req.user._id }).sort('-createdAt').limit(30))));
export default r;
