<<<<<<< HEAD
# DOC-PAT-Web-Application
Author: PRIYA SINGH

HealthConnect (MERN)
cd server && cp .env.example .env && npm i && node src/seed.js && npm run dev
cd client && npm i && npm run dev      # http://localhost:5173 (proxies /api to :5000)

Seed admin: admin@example.com / ChangeMe123! (change immediately).

Implemented: JWT access+refresh in httpOnly SameSite cookies, CSRF header, bcrypt, rate limits, zod validation, RBAC (5 roles), audit log, geo hospital/blood/ambulance search with staleness flags, bed status with source/verification, price publishing + outlier flagging, appointments, one-review-per-completed-appointment, complaints (HC-YYYY-000123, evidence upload with type/size limits, status history), admin verify/suspend/schemes/stats, notification provider abstraction, PWA (service worker, IndexedDB outbox with idempotent replay, offline/sync banners), Low Data mode + image compression, English/Hindi.

Not yet built (next steps): OTP and password reset, hierarchical continent→area selector and full India pincode data, hospital/doctor dashboards beyond the APIs, doctor chat, saved facilities, authorised evidence download route, real malware scanner, SMS/push providers, reports/analytics beyond basic counts, voice navigation, tests.
=======
# DOC-PAT

The repository currently contains the existing standalone page in `index.html` and an Express/MongoDB API in `server/`. The supplied React component is kept in `client/src/App.jsx` for the client work; it needs `api.js`, `i18n.js`, and a React/Vite setup before it can run as a client.

## Project layout

```text
.
├── index.html
├── client/
│   └── src/App.jsx
├── server/
│   ├── src/
│   │   ├── integrations/index.js
│   │   └── ... API modules
│   └── test/unit.test.js
├── .env.example
└── package.json
```

## Run the API

1. Install Node.js and MongoDB.
2. Copy `.env.example` to `.env` and set a private `JWT_SECRET` and the correct `MONGO_URI`.
3. From this directory, run `npm install`.
4. Run `npm run seed` to load the demo records, then `npm run dev` to start the API on port 5000.

The seed script resets demo hospitals, blood banks, ambulances, and sample users. Its demo administrator is `admin@example.com` / `ChangeMe123!`; change the password and secret before using any non-demo environment. Seed content and mock government integrations are demo data.

API health check: `http://localhost:5000/api/health`  
API documentation: `http://localhost:5000/api/docs`

Run the included unit tests with `npm test`.

## Client status

`index.html` remains the current standalone page. The supplied `client/src/App.jsx` belongs to a separate React client and imports `api.js` and `i18n.js`, which were not among the supplied files. The client also has no HTML entry point, styles, or Vite configuration yet, so it is organized but not runnable until those pieces are added.
>>>>>>> cd135e3 (Organize DOC-PAT project structure)
