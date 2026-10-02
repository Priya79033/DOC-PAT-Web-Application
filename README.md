# DOC-PAT

Healthcare discovery, emergency assistance, and hospital transparency platform with a Vite/React client and Express/MongoDB API.

## Project layout

```text
index.html                         Vite client entry
client/src/App.jsx                 Responsive patient and role dashboards
client/src/api.js                  API sessions, cached reads, offline action queue
client/src/i18n.js                 English/Hindi interface labels
client/src/main.jsx                React entry and service worker registration
public/manifest.webmanifest        Installable PWA metadata
public/sw.js                       App shell cache and offline fallback
server/src/app.js                 Express application, imported by API tests
server/src/index.js               MongoDB connection and HTTP startup
server/src/integrations/index.js  Mock government data providers
server/src/locations.js           Demo location hierarchy
server/src/availability.js        Doctor consultation-hour checks
server/src/reminders.js           Hourly appointment reminder worker
server/src/more.js                OTP, saved items, chat, reviews, dashboards, and admin tools API
client/src/voice.js               English/Hindi phrase-to-route mapping
server/Dockerfile
docker-compose.yml                MongoDB and API services
server/test/unit.test.js
server/test/api.test.js
.env.example
package.json
```

## Run the API

1. Install Node.js and MongoDB.
2. Copy `.env.example` to `.env`, then set a private `JWT_SECRET` and the correct `MONGO_URI`.
3. From this directory, run `npm install`.
4. Run `npm run seed` to load demo records.
5. In separate terminals, run `npm run dev` (API on port 5000) and `npm run client` (Vite client on port 5173).

The seed script resets demo hospitals, blood banks, ambulances, and sample users. The demo administrator is `admin@example.com` / `ChangeMe123!`; change the password and secret before using any non-demo environment. Seed content and government integrations are demo data. OTP codes are printed to the API console in development; real SMS and email providers are not configured.

API health check: `http://localhost:5000/api/health`  
API documentation: `http://localhost:5000/api/docs`

To run the containerized API and MongoDB, set `JWT_SECRET` and run `docker compose up --build`. The React client is built separately with `npm run build`; deploy `dist/` to a static host and set `VITE_API_URL` to the deployed API base URL when it is not same-origin.

Run tests with `npm test`. API tests use Supertest and are skipped unless `MONGO_URI_TEST` points to a dedicated test database. They erase that database before running.

## Client and offline behavior

The client supports English/Hindi labels, optional location search, cached read-only discovery, offline emergency fallback information, and a local queue for appointment/emergency POST requests. Cached availability is marked as potentially stale and should be confirmed by phone. Complaint evidence uploads require a connection and are not stored in the offline queue. The service worker caches the app shell and pages; it does not cache private API responses.

## Implemented API features

Authentication and role checks, hospital/doctor discovery and detail pages, declared hospital prices and profile updates, appointments and reviews, complaints and private evidence uploads, bed availability, blood and ambulance lookup, OTP login and password reset, saved facilities, demo location selection, hospital and doctor dashboards, consultation-hour-limited appointment chat, voice navigation, government scheme listing, public information pages, admin verification queues and user/review tools, and admin reporting endpoints. Government integrations are explicit demo providers. An hourly worker sends one reminder for accepted appointments due within 24 hours. SMS/email delivery and malware scanning remain provider stubs; connect authorized production providers before deployment.





// cd 
// npm install - for dependencies 
// Open 2 powershell/ terminal

// for MongoDB start
// in 1st -  
<!-- Copy-Item .env.example .env
npm run seed
npm run dev -->
// For React app
// in 2nd
<!-- cd D:\PROJECT\DOC-PAT\DOC-PAT-Web-Application
npm run client -->

