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

## Run the application

1. Install Node.js and MongoDB.
2. Copy `.env.example` to `.env`, then set a private `JWT_SECRET` and the correct `MONGO_URI`.
   To load the National Hospital Directory from data.gov.in, generate an API key on the [official OGD portal](https://data.gov.in/) and set `DATA_GOV_IN_API_KEY` in `.env` (or your deployment secret store). The key is used only by the server.
3. From this directory, run `npm install`.
4. Optionally run `npm run seed` to load demo records. **Seeding resets demo hospitals, blood banks, ambulances, and sample users.**
5. Run `npm run dev` to start both the API (port 5000) and client (port 5173), then open `http://localhost:5173`. Use `npm run dev:api` to run only the API; use `npm run client` to run only the client.

The demo administrator is `admin@example.com` / `ChangeMe123!`; change the password and secret before using any non-demo environment. Seed hospitals, users, and some external government integrations are demo data. In development, OTP codes are printed to the API console. Password-reset delivery uses the configured email webhook or Twilio SMS credentials; set these before relying on delivery.

The India-wide hospital directory page reads records from the NIHFW National Hospital Directory published on data.gov.in. It displays the source's directory records and update date; it does not treat those records as HealthConnect verification or claim the source is real-time. This source currently requires a data.gov.in API key and may return unavailable if the resource API is not enabled for the dataset.

API health check: `http://localhost:5000/api/health`  
API documentation: `http://localhost:5000/api/docs`

To run the containerized API and MongoDB, set `JWT_SECRET` and run `docker compose up --build`. The React client is built separately with `npm run build`; deploy `dist/` to a static host and set `VITE_API_URL` to the deployed API base URL when it is not same-origin.

The full container stack includes the React client behind Nginx. Set `JWT_SECRET` and run `docker compose up --build`; open `http://localhost:5173`. Nginx serves the client, forwards `/api/` to the API container, and falls back to `index.html` for client routes. Set `VITE_GOOGLE_CLIENT_ID` before building to enable Google sign-in in the containerized client. For a separately hosted frontend, set `CLIENT_URL` to its origin.

Run tests with `npm test`. API tests use Supertest and are skipped unless `MONGO_URI_TEST` points to a dedicated test database. They erase that database before running.

## Client and offline behavior

The client supports English/Hindi labels, optional location search, cached read-only discovery, offline emergency fallback information, and a local queue for appointment/emergency POST requests. Cached availability is marked as potentially stale and should be confirmed by phone. Complaint evidence uploads require a connection and are not stored in the offline queue. The service worker caches the app shell and pages; it does not cache private API responses.

## Implemented API features

Authentication and role checks, hospital/doctor discovery and detail pages, declared hospital prices and profile updates, appointments and reviews, complaints and private evidence uploads, bed availability, blood and ambulance lookup, OTP login and password reset, saved facilities, demo location selection, hospital and doctor dashboards, consultation-hour-limited appointment chat, voice navigation, government scheme listing, public information pages, admin verification queues and user/review tools, and admin reporting endpoints. Signup offers all six roles; doctor signup stores qualification, specialty, licence number and experience; hospital-admin signup creates an unverified hospital profile from the submitted facility details. Government-admin and super-admin accounts require one-time invitations created by an authorized admin. Doctor, hospital-admin and invited admin accounts create an identity-review request at signup after consent. The database stores account data (passwords are hashed) and verification statuses/references, never Aadhaar/PAN numbers, OTPs, or identity documents. Login uses email/phone and password, offers an optional role check, and routes each account to its role dashboard; identity numbers are not login credentials. This demo does not connect to UIDAI, PAN or DigiLocker. Admins may record an outcome only after independently checking it with an authorized provider. Configure officially approved provider integrations before representing these checks as automated or production verification. See [UIDAI requesting-entity onboarding](https://uidai.gov.in/hi/authentication-requesting-agency), [Income Tax PAN verification](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/verify-your-pan) and [DigiLocker requester onboarding](https://www.digilocker.gov.in/web/implementation-model). Other government integrations are explicit demo providers. An hourly worker sends one reminder for accepted appointments due within 24 hours. SMS delivery supports Twilio and email delivery supports the configured webhook; configure credentials and verify delivery before production. Malware scanning remains a provider stub.





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

Government admins and hospital admins can open **Fleet** after signing in. Register a station with coordinates and a geofence radius, then register its ambulances with fleet ID, plate, type, contact, crew, equipment, and the assigned driver's weekly shift in India time. Fleet staff can update a vehicle's shift and status later. The public ambulance directory lists every registered vehicle, its contact number, paired driver's name, status, and shift. A driver's personal phone is shown as a tap-to-call number only when the driver explicitly consents during signup or in the Driver GPS page; the driver can withdraw consent there, and the directory never exposes driver email or exact location. The assigned driver signs in on the ambulance device and starts GPS sharing. Signed-in staff see fleet positions refreshed every five seconds; the API geofences each ping and updates the vehicle site/status. Creating an ambulance emergency request assigns the nearest available vehicle within 30 km when one is registered with a location. The driver's page must stay open for browser GPS sharing to continue.

Each ambulance registration creates a one-use driver invitation valid for 48 hours. Give it to the assigned driver; they select **Ambulance Driver** at signup and enter the fleet ID and invitation to pair a driver account. Drivers then use **Driver GPS** to stream their own device location. Patient registration collects age and gender (and optional blood group); patient signup also supports phone OTP and optional Google sign-in. Configure Twilio values to deliver SMS OTPs and an email webhook accepting `{ to, subject, text }` to deliver email OTPs. In production, the app returns a configuration error instead of claiming an OTP was sent if a provider is missing. To enable Google sign-in, set the same OAuth web client ID in `GOOGLE_CLIENT_ID` and `VITE_GOOGLE_CLIENT_ID`, and add the app's web origin in Google Cloud Console. Hospital admins must upload licence proof before a government admin can approve the hospital; only government admins can open those private files.

## Patient offline, search, and booking

The **Offline records** page fetches a signed-in patient's full app history (appointments, complaints, emergency requests, and feedback) and saves a copy in that browser for offline viewing. It contains activity created in this app, not medical charts kept by hospitals. The patient can remove the local copy from the page. Low Data mode reuses an exact cached search when available, skips embedded maps, and compresses supported evidence images before upload; appointment requests can queue until the connection returns. Voice search supports Hindi and English browser speech recognition and can search hospital names or doctor specialties. Browser microphone and speech support vary.

The **Area** page has independent optional continent/country/state/city/area dropdowns; any one selection filters registered hospitals. City and area options depend on hospital locations in the database. In the blood bank filters, country and state are followed directly by region/area (no city filter); India state choices include the supplied state-capital pairs. Selecting any blood group shows whether that group is available at each matching bank; a missing stock record is shown as unreported instead of being mistaken for a confirmed zero-stock result. Hospital search supports a hospital name and a state-capital dropdown, shows government/private facilities, opens full hospital details, and supports appointment requests at the hospital. The doctor directory lists departments and specialties, then loads matching doctor profiles with qualifications, experience, registration, consultation fee, hospital, languages, consultation modes, availability, and ratings. Additional specialties are included from registered doctor profiles. Home verification counts and patient ratings are calculated from database records. The scheme guide lists major central health programmes and links to the official myScheme portal for the full live Central and State/UT catalogue. Google Maps embeds and route links require an internet connection.
