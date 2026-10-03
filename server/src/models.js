import mongoose from 'mongoose';
const { Schema, model } = mongoose;
const T = { timestamps: true };
const point = { type: { type: String, enum: ['Point'], default: 'Point' }, coordinates: { type: [Number], default: [0, 0] } };
const stamp = { status: { type: String, enum: ['AVAILABLE', 'LIMITED', 'FULL'], default: 'FULL' }, updatedAt: { type: Date, default: Date.now }, source: { type: String, default: 'hospital' }, verified: { type: Boolean, default: false } };
const ref = (n) => ({ type: Schema.Types.ObjectId, ref: n });

export const ROLES = ['PATIENT', 'DOCTOR', 'HOSPITAL_ADMIN', 'GOVERNMENT_ADMIN', 'SUPER_ADMIN'];
export const User = model('User', new Schema({
  name: { type: String, required: true }, email: { type: String, unique: true, sparse: true, lowercase: true },
  phone: { type: String, unique: true, sparse: true }, passwordHash: { type: String, required: true },
  role: { type: String, enum: ROLES, default: 'PATIENT' }, tokenVersion: { type: Number, default: 0 },
  hospital: ref('Hospital'), suspended: { type: Boolean, default: false }, language: { type: String, default: 'en' }, deletedAt: Date }, T));

const hs = new Schema({
  name: { type: String, required: true }, type: { type: String, enum: ['GOVERNMENT', 'PRIVATE'] },
  address: String, area: String, city: String, state: String, pincode: String, country: { type: String, default: 'India' },
  phone: String, emergencyPhone: String, location: point, departments: [String], facilities: [String], schemes: [String],
  hours: String, emergency: { type: Boolean, default: false }, verified: { type: Boolean, default: false },
  beds: { general: stamp, icu: stamp, emergency: stamp, pediatric: stamp, maternity: stamp },
  prices: [{ service: String, amount: Number, rule: String, updatedAt: { type: Date, default: Date.now }, verified: Boolean }], deletedAt: Date }, T);
hs.index({ location: '2dsphere' }); hs.index({ name: 'text' });
export const Hospital = model('Hospital', hs);

export const Doctor = model('Doctor', new Schema({
  user: { ...ref('User'), required: true }, hospital: ref('Hospital'), qualification: String, specialization: { type: String, index: true },
  licenseNo: String, experience: Number, fee: Number, languages: [String], modes: [String], slots: [{ day: Number, from: String, to: String }],
  verified: { type: Boolean, default: false }, rating: { type: Number, default: 0 }, ratingCount: { type: Number, default: 0 } }, T));

const bb = new Schema({ name: String, phone: String, country: { type: String, default: 'India' }, state: String, district: String, region: String, city: String, area: String, location: point, verified: Boolean,
  inventory: [{ group: { type: String, enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] }, units: Number, updatedAt: { type: Date, default: Date.now } }] }, T);
bb.index({ location: '2dsphere' });
bb.index({ country: 1, state: 1, district: 1, region: 1 });
export const BloodBank = model('BloodBank', bb);

const am = new Schema({ vehicleId: { type: String, unique: true }, type: String, agency: String, phone: String, equipment: [String],
  available: { type: Boolean, default: true }, location: point, updatedAt: { type: Date, default: Date.now } });
am.index({ location: '2dsphere' });
export const Ambulance = model('Ambulance', am);

export const EmergencyRequest = model('EmergencyRequest', new Schema({
  patient: ref('User'), kind: String, location: point, note: String, ambulance: ref('Ambulance'),
  status: { type: String, enum: ['REQUESTED', 'DISPATCHED', 'ARRIVED', 'CLOSED'], default: 'REQUESTED' }, clientId: { type: String, unique: true, sparse: true } }, T));

export const Appointment = model('Appointment', new Schema({
  patient: ref('User'), doctor: ref('Doctor'), hospital: ref('Hospital'), when: Date, reason: String,
  status: { type: String, enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'COMPLETED', 'CANCELLED'], default: 'PENDING' },
  reminded: { type: Boolean, default: false }, clientId: { type: String, unique: true, sparse: true } }, T));

export const Review = model('Review', new Schema({
  patient: ref('User'), appointment: { ...ref('Appointment'), unique: true }, doctor: ref('Doctor'), hospital: ref('Hospital'),
  scores: { communication: Number, waiting: Number, facilities: Number, transparency: Number, overall: Number },
  text: String, reply: { text: String, at: Date }, flagged: { type: Boolean, default: false }, hidden: { type: Boolean, default: false } }, T));

export const Message = model('Message', new Schema({
  appointment: { ...ref('Appointment'), required: true }, from: { ...ref('User'), required: true },
  to: { ...ref('User'), required: true }, text: { type: String, required: true, maxlength: 1000 },
}, T));

export const Complaint = model('Complaint', new Schema({
  complaintId: { type: String, unique: true }, patient: ref('User'),
  category: { type: String, enum: ['EXCESSIVE_CHARGE', 'UNEXPECTED_CHARGE', 'FACILITY_UNAVAILABLE', 'BED_ISSUE', 'DOCTOR', 'STAFF', 'EMERGENCY_SERVICE', 'AMBULANCE', 'BLOOD', 'INCORRECT_INFO', 'OTHER'] },
  hospital: ref('Hospital'), doctor: ref('Doctor'), description: String, incidentAt: Date, evidence: [{ path: String, mime: String, name: String }],
  status: { type: String, enum: ['SUBMITTED', 'UNDER_REVIEW', 'ASSIGNED', 'INVESTIGATION', 'RESOLVED', 'CLOSED'], default: 'SUBMITTED' },
  assignedTo: ref('User'), history: [{ status: String, note: String, by: ref('User'), at: { type: Date, default: Date.now } }],
  clientId: { type: String, unique: true, sparse: true } }, T));

export const Audit = model('Audit', new Schema({ user: Schema.Types.ObjectId, action: String, target: String, meta: Object, ip: String }, T));
export const Scheme = model('Scheme', new Schema({ title: String, body: String, region: String, publishedBy: Schema.Types.ObjectId }, T));
export const Notification = model('Notification', new Schema({ user: ref('User'), title: String, body: String, read: { type: Boolean, default: false } }, T));

const otp = new Schema({
  key: { type: String, required: true }, purpose: { type: String, enum: ['login', 'reset'], required: true },
  codeHash: { type: String, required: true }, expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0 },
}, T);
otp.index({ key: 1, purpose: 1 }, { unique: true });
otp.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const Otp = model('Otp', otp);

const saved = new Schema({ user: { ...ref('User'), required: true }, kind: { type: String, enum: ['hospital', 'doctor'], required: true }, target: { type: Schema.Types.ObjectId, required: true } }, T);
saved.index({ user: 1, kind: 1, target: 1 }, { unique: true });
export const Saved = model('Saved', saved);
