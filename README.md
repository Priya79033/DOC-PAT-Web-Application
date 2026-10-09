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

The full container stack includes the React client behind Nginx. Set `JWT_SECRET` and run `docker compose up --build`; open `http://localhost:5173`. Nginx serves the client, forwards `/api/` to the API container, and falls back to `index.html` for client routes. Set `VITE_GOOGLE_CLIENT_ID` before building to enable Google sign-in in the containerized client. For a separately hosted frontend, set `CLIENT_URL` to its origin.

Run tests with `npm test`. API tests use Supertest and are skipped unless `MONGO_URI_TEST` points to a dedicated test database. They erase that database before running.

## Client and offline behavior

The client supports English/Hindi labels, optional location search, cached read-only discovery, offline emergency fallback information, and a local queue for appointment/emergency POST requests. Cached availability is marked as potentially stale and should be confirmed by phone. Complaint evidence uploads require a connection and are not stored in the offline queue. The service worker caches the app shell and pages; it does not cache private API responses.

## Implemented API features

Authentication and role checks, hospital/doctor discovery and detail pages, declared hospital prices and profile updates, appointments and reviews, complaints and private evidence uploads, bed availability, blood and ambulance lookup, OTP login and password reset, saved facilities, demo location selection, hospital and doctor dashboards, consultation-hour-limited appointment chat, voice navigation, government scheme listing, public information pages, admin verification queues and user/review tools, and admin reporting endpoints. Signup offers all five roles; doctor signup stores qualification, specialty, licence number and experience; hospital-admin signup creates an unverified hospital profile from the submitted facility details. Government-admin and super-admin accounts require one-time invitations created by an authorized admin. Doctor, hospital-admin and invited admin accounts create an identity-review request at signup after consent. The database stores account data (passwords are hashed) and verification statuses/references, never Aadhaar/PAN numbers, OTPs, or identity documents. Login uses email/phone and password; identity numbers are not login credentials. This demo does not connect to UIDAI, PAN or DigiLocker. Admins may record an outcome only after independently checking it with an authorized provider. Configure officially approved provider integrations before representing these checks as automated or production verification. See [UIDAI requesting-entity onboarding](https://uidai.gov.in/hi/authentication-requesting-agency), [Income Tax PAN verification](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/verify-your-pan) and [DigiLocker requester onboarding](https://www.digilocker.gov.in/web/implementation-model). Other government integrations are explicit demo providers. An hourly worker sends one reminder for accepted appointments due within 24 hours. SMS/email delivery and malware scanning remain provider stubs; connect authorized production providers before deployment.





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

## Registration and ambulance fleet

Hospital-admin signup records the facility licence/registration number and creates an unverified hospital. A government admin must approve it. Doctor signup requires an approved hospital and captures qualification, specialty, medical registration number, and experience. Patient phone-code login is available through the OTP flow; configure an SMS/email provider before production use.

Government admins and hospital admins can open **Fleet** after signing in. Register a station with coordinates and a geofence radius, then register its ambulances with fleet ID, plate, type, contact, crew, and equipment. The assigned driver signs in on the ambulance device and starts GPS sharing. Signed-in staff see fleet positions refreshed every five seconds; the API geofences each ping and updates the vehicle site/status. Creating an ambulance emergency request assigns the nearest available vehicle within 30 km when one is registered with a location. The driver's page must stay open for browser GPS sharing to continue. Public ambulance search intentionally returns only coarse coordinates.

Each ambulance registration creates a one-use driver invitation valid for 48 hours. Give it to the assigned driver; they select **Ambulance Driver** at signup and enter the fleet ID and invitation to pair a driver account. Drivers then use **Driver GPS** to stream their own device location. Patient registration collects age and gender (and optional blood group); patient signup also supports phone OTP and optional Google sign-in. Configure Twilio values to deliver SMS OTPs and an email webhook accepting `{ to, subject, text }` to deliver email OTPs. In production, the app returns a configuration error instead of claiming an OTP was sent if a provider is missing. To enable Google sign-in, set the same OAuth web client ID in `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID`, and add the app's web origin in Google Cloud Console. Hospital admins must upload licence proof before a government admin can approve the hospital; only government admins can open those private files.

## Patient offline, search, and booking

The **Offline records** page fetches a signed-in patient's full app history (appointments, complaints, emergency requests, and feedback) and saves a copy in that browser for offline viewing. It contains activity created in this app, not medical charts kept by hospitals. The patient can remove the local copy from the page. Low Data mode reuses an exact cached search when available, skips embedded maps, and compresses supported evidence images before upload; appointment requests can queue until the connection returns. Voice search supports Hindi and English browser speech recognition and can search hospital names or doctor specialties. Browser microphone and speech support vary.

The **Area** page has searchable, cascading continent/country/state/city/area selectors. It includes India's states and union territories; city and area choices are populated from registered hospital locations, so coverage depends on the hospitals entered in this database. Hospital search shows government and private results separately, embeds Google Maps when Low Data mode is off, and links to hospital details. Patients can choose a doctor and request an appointment from that hospital's detail page. Google Maps embeds and route links require an internet connection.
