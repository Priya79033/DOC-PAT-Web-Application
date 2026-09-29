// Government integration layer. Only MOCK providers exist: all data is DEMO DATA.
// For production, implement each interface against officially authorised APIs and set GOV_MODE=live.
const demo = (data) => ({ demo: true, notice: 'DEMO DATA - not from a government source', data });

class HospitalDataProvider { async list() { throw new Error('not implemented'); } }
class DoctorVerificationProvider { async verify() { throw new Error('not implemented'); } }
class EmergencyServiceProvider { async numbers() { throw new Error('not implemented'); } }
class BloodAvailabilityProvider { async availability() { throw new Error('not implemented'); } }
class HealthcareSchemeProvider { async schemes() { throw new Error('not implemented'); } }

class MockHospitalData extends HospitalDataProvider { async list() { return demo([{ name: 'DEMO District Hospital', state: 'Rajasthan', registryId: 'DEMO-H-001' }]); } }
class MockDoctorVerification extends DoctorVerificationProvider {
  async verify({ licenseNo }) { return demo({ valid: /^DEMO-/i.test(licenseNo || ''), hint: 'Demo rule: licence numbers starting with DEMO- pass' }); }
}
class MockEmergency extends EmergencyServiceProvider { async numbers() { return demo([{ name: 'Ambulance', number: '108' }, { name: 'Unified emergency', number: '112' }, { name: 'Ambulance (alt)', number: '102' }]); } }
class MockBlood extends BloodAvailabilityProvider { async availability() { return demo([]); } }
class MockSchemes extends HealthcareSchemeProvider { async schemes() { return demo([{ title: 'DEMO scheme entry', body: 'Placeholder. Real schemes come from an authorised source.' }]); } }

export const GovernmentService = process.env.GOV_MODE === 'live'
  ? (() => { throw new Error('Live government providers are not configured. Implement them against authorised APIs.'); })()
  : { hospitals: new MockHospitalData(), doctors: new MockDoctorVerification(), emergency: new MockEmergency(), blood: new MockBlood(), schemes: new MockSchemes() };
