# DOC-PAT-Web-Application
Author: PRIYA SINGH

HealthConnect (MERN)
cd server && cp .env.example .env && npm i && node src/seed.js && npm run dev
cd client && npm i && npm run dev      # http://localhost:5173 (proxies /api to :5000)

Seed admin: admin@example.com / ChangeMe123! (change immediately).

Implemented: JWT access+refresh in httpOnly SameSite cookies, CSRF header, bcrypt, rate limits, zod validation, RBAC (5 roles), audit log, geo hospital/blood/ambulance search with staleness flags, bed status with source/verification, price publishing + outlier flagging, appointments, one-review-per-completed-appointment, complaints (HC-YYYY-000123, evidence upload with type/size limits, status history), admin verify/suspend/schemes/stats, notification provider abstraction, PWA (service worker, IndexedDB outbox with idempotent replay, offline/sync banners), Low Data mode + image compression, English/Hindi.

Not yet built (next steps): OTP and password reset, hierarchical continent→area selector and full India pincode data, hospital/doctor dashboards beyond the APIs, doctor chat, saved facilities, authorised evidence download route, real malware scanner, SMS/push providers, reports/analytics beyond basic counts, voice navigation, tests.
