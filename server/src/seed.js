import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User, Hospital, BloodBank, Ambulance } from './models.js';
await mongoose.connect(process.env.MONGO_URI);
const s = (status) => ({ status, updatedAt: new Date(), source: 'seed' });
await Hospital.deleteMany({});
await Hospital.insertMany([
  { name: 'SMS Government Hospital', type: 'GOVERNMENT', city: 'Jaipur', state: 'Rajasthan', area: 'Tonk Road', emergency: true, verified: true, emergencyPhone: '0141-2560291', location: { type: 'Point', coordinates: [75.8, 26.9] }, departments: ['Cardiology', 'Pediatrics'], schemes: ['Ayushman Bharat'], beds: { general: s('LIMITED'), icu: s('FULL'), emergency: s('AVAILABLE') } },
  { name: 'City Care Clinic', type: 'PRIVATE', city: 'Jaipur', state: 'Rajasthan', area: 'Malviya Nagar', emergency: false, verified: true, location: { type: 'Point', coordinates: [75.82, 26.86] }, beds: { general: s('AVAILABLE') } }]);
await BloodBank.deleteMany({}); await BloodBank.create({ name: 'Jaipur Blood Bank', city: 'Jaipur', verified: true, location: { type: 'Point', coordinates: [75.81, 26.91] }, inventory: [{ group: 'O+', units: 12 }, { group: 'A-', units: 0 }] });
await Ambulance.deleteMany({}); await Ambulance.create({ vehicleId: 'RJ-108-01', type: 'ALS', agency: '108', phone: '108', equipment: ['Oxygen', 'Defibrillator'], location: { type: 'Point', coordinates: [75.79, 26.92] } });
await User.deleteOne({ email: 'admin@example.com' }); await User.create({ name: 'Govt Admin', email: 'admin@example.com', role: 'GOVERNMENT_ADMIN', passwordHash: await bcrypt.hash('ChangeMe123!', 12) });
for (const [name, email, role] of [['DEMO Patient', 'patient@example.com', 'PATIENT'], ['DEMO Doctor', 'doctor@example.com', 'DOCTOR'], ['DEMO Hospital Admin', 'hospital@example.com', 'HOSPITAL_ADMIN']]) { await User.deleteOne({ email }); await User.create({ name, email, role, passwordHash: await bcrypt.hash('DemoPass123!', 12) }); }
console.log('ALL SEED DATA IS DEMO DATA. Test accounts (password DemoPass123!): patient@, doctor@, hospital@example.com');
console.log('Seeded. Admin: admin@example.com / ChangeMe123!'); process.exit();
