// Needs a running MongoDB. Run: MONGO_URI_TEST=mongodb://127.0.0.1:27017/hc_test JWT_SECRET=t npm test
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
const uri = process.env.MONGO_URI_TEST;
const skip = !uri && 'set MONGO_URI_TEST to run API tests';
let app, agent;
const H = { 'X-Requested-With': 'healthconnect' };
before(async () => { if (skip) return; await mongoose.connect(uri); await mongoose.connection.dropDatabase(); app = (await import('../src/app.js')).default; agent = request.agent(app); });
after(async () => { if (!skip) { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); } });

test('register then login', { skip }, async () => {
  const body = { name: 'Asha', email: 'asha@test.com', password: 'Password123!' };
  assert.equal((await agent.post('/api/auth/register').set(H).send(body)).status, 201);
  const fresh = request.agent(app); assert.equal((await fresh.post('/api/auth/login').set(H).send({ identifier: body.email, password: body.password })).status, 200);
  assert.equal((await fresh.get('/api/auth/me')).status, 200);
});
test('wrong password is rejected', { skip }, async () => assert.equal((await request(app).post('/api/auth/login').set(H).send({ identifier: 'asha@test.com', password: 'nope-nope-nope' })).status, 401));
test('hospital search is public and returns the standard shape', { skip }, async () => { const r = await request(app).get('/api/hospitals'); assert.equal(r.status, 200); assert.equal(r.body.success, true); });
test('unauthenticated access to private data is 401', { skip }, async () => { for (const p of ['/api/complaints/mine', '/api/appointments/mine', '/api/admin/stats']) assert.equal((await request(app).get(p)).status, 401); });
test('role escalation: cannot self-register as admin', { skip }, async () => assert.equal((await request(app).post('/api/auth/register').set(H).send({ name: 'X', email: 'x@test.com', password: 'Password123!', role: 'GOVERNMENT_ADMIN' })).status, 400));
test('patient cannot use admin endpoints', { skip }, async () => assert.equal((await agent.get('/api/admin/stats')).status, 403));
test('state-changing request without CSRF header is blocked', { skip }, async () => assert.equal((await request(app).post('/api/auth/login').send({ identifier: 'a@b.com', password: 'x' })).status, 403));
test('NoSQL injection in login is rejected', { skip }, async () => assert.equal((await request(app).post('/api/auth/login').set(H).send({ identifier: { $ne: '' }, password: { $ne: '' } })).status, 400));
test('disallowed upload type is rejected', { skip }, async () => {
  const r = await agent.post('/api/complaints').set(H).field('category', 'OTHER').field('description', 'long enough description').attach('evidence', Buffer.from('<script>alert(1)</script>'), { filename: 'x.html', contentType: 'text/html' });
  assert.equal(r.status, 400);
});
test('complaint submission gives an HC- id and cannot be read by another user', { skip }, async () => {
  const r = await agent.post('/api/complaints').set(H).field('category', 'OTHER').field('description', 'long enough description'); assert.equal(r.status, 201); assert.match(r.body.data.complaintId, /^HC-\d{4}-\d{6}$/);
  const other = request.agent(app); await other.post('/api/auth/register').set(H).send({ name: 'Bo', email: 'bo@test.com', password: 'Password123!' });
  assert.equal((await other.get(`/api/complaints/${r.body.data.complaintId}/evidence`)).status, 403);
});
