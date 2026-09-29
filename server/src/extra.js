import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import * as M from './models.js';
import { ok, wrap, HttpError, auth, allow, audit } from './lib.js';
import { GovernmentService } from './integrations/index.js';
import { signEvidenceUrl, checkSignature } from './storage.js';
import { mapProvider } from './maps.js';
const r = Router();
const isAdmin = (u) => ['GOVERNMENT_ADMIN', 'SUPER_ADMIN'].includes(u.role);

// ---- Private evidence: never public. Owner/admin asks for a short-lived signed link, then downloads. ----
r.get('/complaints/:cid/evidence', auth(), wrap(async (req, res) => {
  const c = await M.Complaint.findOne({ complaintId: req.params.cid }); if (!c) throw new HttpError(404, 'Not found');
  if (!isAdmin(req.user) && String(c.patient) !== String(req.user._id)) throw new HttpError(403, 'Not permitted');
  await audit(req, 'EVIDENCE_LINKS', c.complaintId);
  ok(res, c.evidence.map((e) => ({ name: e.name, mime: e.mime, url: signEvidenceUrl(c.complaintId, e.path) })));
}));
r.get('/evidence/:cid/:file', wrap(async (req, res) => {
  const { cid, file } = req.params, { exp, sig } = req.query;
  if (!checkSignature(cid, file, exp, sig)) throw new HttpError(403, 'Link expired or invalid');
  const c = await M.Complaint.findOne({ complaintId: cid, 'evidence.path': file }); if (!c) throw new HttpError(404, 'Not found');
  const full = path.resolve('uploads', path.basename(file)); if (!fs.existsSync(full)) throw new HttpError(404, 'Not found');
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'attachment' }); res.sendFile(full);
}));

// ---- Analytics + downloadable report ----
const analytics = async () => {
  const bedsOk = (k) => M.Hospital.countDocuments({ [`beds.${k}.status`]: { $ne: 'FULL' }, verified: true });
  const groupBy = (Model, field) => Model.aggregate([{ $group: { _id: '$' + field, n: { $sum: 1 } } }]);
  const [patients, doctors, hospitals, active, general, icu, emergencyReq, ambReq, complaints, resolved, pending, cStatus, aStatus, bloodBanks] = await Promise.all([
    M.User.countDocuments({ role: 'PATIENT' }), M.Doctor.countDocuments({ verified: true }), M.Hospital.countDocuments({ verified: true }), M.Hospital.countDocuments({ verified: true, emergency: true }),
    bedsOk('general'), bedsOk('icu'), M.EmergencyRequest.countDocuments(), M.EmergencyRequest.countDocuments({ kind: 'AMBULANCE' }), M.Complaint.countDocuments(),
    M.Complaint.countDocuments({ status: { $in: ['RESOLVED', 'CLOSED'] } }), M.Complaint.countDocuments({ status: { $in: ['SUBMITTED', 'UNDER_REVIEW', 'ASSIGNED', 'INVESTIGATION'] } }),
    groupBy(M.Complaint, 'status'), groupBy(M.Appointment, 'status'), M.BloodBank.countDocuments({ verified: true, 'inventory.units': { $gt: 0 } })]);
  return { totals: { patients, verifiedDoctors: doctors, verifiedHospitals: hospitals, emergencyHospitals: active, hospitalsWithGeneralBeds: general, hospitalsWithIcuBeds: icu, bloodBanksWithStock: bloodBanks, emergencyRequests: emergencyReq, ambulanceRequests: ambReq, complaints, resolvedComplaints: resolved, pendingInvestigations: pending },
    complaintsByStatus: Object.fromEntries(cStatus.map((x) => [x._id, x.n])), appointmentsByStatus: Object.fromEntries(aStatus.map((x) => [x._id, x.n])) };
};
r.get('/admin/analytics', auth(), allow('GOVERNMENT_ADMIN'), wrap(async (req, res) => ok(res, await analytics())));
r.get('/admin/report.csv', auth(), allow('GOVERNMENT_ADMIN'), wrap(async (req, res) => {
  const a = await analytics(), rows = [['metric', 'value'], ...Object.entries(a.totals), ...Object.entries(a.complaintsByStatus).map(([k, v]) => [`complaints_${k}`, v]), ...Object.entries(a.appointmentsByStatus).map(([k, v]) => [`appointments_${k}`, v])];
  await audit(req, 'REPORT_DOWNLOAD', 'report.csv'); res.type('text/csv').attachment(`healthconnect-report-${new Date().toISOString().slice(0, 10)}.csv`).send(rows.map((x) => x.join(',')).join('\n'));
}));

// ---- Government integration (mock providers, responses flagged demo:true) ----
r.get('/gov/emergency-numbers', wrap(async (req, res) => ok(res, await GovernmentService.emergency.numbers())));
r.get('/gov/schemes', wrap(async (req, res) => ok(res, await GovernmentService.schemes.schemes())));
r.post('/admin/doctors/:id/check-license', auth(), allow('GOVERNMENT_ADMIN'), wrap(async (req, res) => {
  const d = await M.Doctor.findById(req.params.id); if (!d) throw new HttpError(404, 'Not found');
  ok(res, await GovernmentService.doctors.verify({ licenseNo: d.licenseNo }), 'Check finished. An admin must still confirm verification.');
}));

// ---- Public vehicle view: coarse position only ----
r.get('/ambulances/public', wrap(async (req, res) => {
  const list = await M.Ambulance.find({ available: true }).limit(30).lean();
  ok(res, list.map((a) => ({ _id: a._id, type: a.type, agency: a.agency, phone: a.phone, updatedAt: a.updatedAt, approxLocation: a.location.coordinates.map((n) => +n.toFixed(2)) })));
}));
r.get('/directions', (req, res) => ok(res, { url: mapProvider.directionsUrl([+req.query.lng, +req.query.lat]) }));

// ---- OpenAPI ----
const secured = { security: [{ cookieAuth: [] }] }, body = (props, req = []) => ({ requestBody: { content: { 'application/json': { schema: { type: 'object', required: req, properties: props } } } } });
const S = { type: 'string' }, resp = { 200: { description: 'OK: { success, message, data }' }, 400: { description: 'Validation error' }, 401: { description: 'Not logged in' }, 403: { description: 'Not permitted' } };
const op = (summary, extra = {}) => ({ summary, responses: resp, ...extra });
export const openapi = { openapi: '3.0.3', info: { title: 'HealthConnect API', version: '1.0.0', description: 'All responses: { success, message, data }. State-changing calls need header X-Requested-With: healthconnect.' },
  components: { securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'at' } } },
  paths: {
    '/api/auth/register': { post: op('Register', body({ name: S, email: S, phone: S, password: S, role: { enum: ['PATIENT', 'DOCTOR', 'HOSPITAL_ADMIN'] } }, ['name', 'password'])) },
    '/api/auth/login': { post: op('Log in', body({ identifier: S, password: S }, ['identifier', 'password'])) },
    '/api/auth/logout-all': { post: op('Log out everywhere', secured) },
    '/api/hospitals': { get: op('Search hospitals (city, type, emergency, beds, icu, lat, lng, page)') },
    '/api/hospitals/{id}/beds': { patch: op('Update bed status (HOSPITAL_ADMIN of that hospital, GOVERNMENT_ADMIN)', secured) },
    '/api/doctors': { get: op('Search doctors') }, '/api/blood': { get: op('Blood availability (group, city)') }, '/api/ambulances/public': { get: op('Available vehicles, coarse location') },
    '/api/emergency/requests': { post: op('Create emergency request (idempotent via clientId)', secured) },
    '/api/appointments': { post: op('Request appointment (PATIENT)', secured) }, '/api/reviews': { post: op('Review a completed appointment (PATIENT)', secured) },
    '/api/complaints': { post: op('Submit complaint, multipart with evidence files (PATIENT)', secured) },
    '/api/complaints/{cid}/evidence': { get: op('Signed, expiring evidence links (owner or admin)', secured) },
    '/api/admin/analytics': { get: op('Analytics (GOVERNMENT_ADMIN)', secured) }, '/api/admin/report.csv': { get: op('CSV report (GOVERNMENT_ADMIN)', secured) },
    '/api/admin/complaints/{id}': { patch: op('Update complaint status (GOVERNMENT_ADMIN)', secured) },
    '/api/gov/schemes': { get: op('Schemes via mock provider (DEMO DATA)') } } };
export default r;
