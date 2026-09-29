import test from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm, roundedPoint } from '../src/maps.js';
import { isAllowedFile, signEvidenceUrl, checkSignature } from '../src/storage.js';
import { GovernmentService } from '../src/integrations/index.js';

test('haversine: Jaipur to Delhi is roughly 235 km', () => { const d = haversineKm([75.79, 26.91], [77.21, 28.61]); assert.ok(d > 220 && d < 250); });
test('vehicle locations are coarsened', () => assert.deepEqual(roundedPoint([75.78912, 26.91234]), [75.79, 26.91]));
test('upload allow-list accepts real types', () => { assert.ok(isAllowedFile('bill.PDF', 'application/pdf')); assert.ok(isAllowedFile('a.jpg', 'image/jpeg')); });
test('upload allow-list rejects scripts, double extensions and mismatches', () => {
  assert.ok(!isAllowedFile('x.exe', 'application/octet-stream')); assert.ok(!isAllowedFile('x.html', 'text/html'));
  assert.ok(!isAllowedFile('x.pdf.js', 'application/pdf')); assert.ok(!isAllowedFile('x.pdf', 'text/html'));
});
test('signed evidence URL verifies, and tampering or expiry fails', () => {
  const u = new URL('http://x' + signEvidenceUrl('HC-2026-000001', 'f.pdf', 60)), q = Object.fromEntries(u.searchParams);
  assert.ok(checkSignature('HC-2026-000001', 'f.pdf', q.exp, q.sig)); assert.ok(!checkSignature('HC-2026-000002', 'f.pdf', q.exp, q.sig));
  assert.ok(!checkSignature('HC-2026-000001', 'f.pdf', Date.now() - 1, q.sig));
});
test('government providers are demo-flagged', async () => { assert.equal((await GovernmentService.schemes.schemes()).demo, true); assert.equal((await GovernmentService.doctors.verify({ licenseNo: 'DEMO-1' })).data.valid, true); });
