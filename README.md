# PATCH — GHMC Pothole Management System

A crowd-sourced pothole reporting platform built around the two hardest
problems in this kind of system: **duplicate reports** and **fake uploads**.
Citizens report potholes with a photo + GPS location; the backend merges
reports within a 30 m radius into a single record instead of flooding the
database, ranks every pothole by a priority score, and gives GHMC staff a
dashboard to assign crews and track repairs.

## Project structure

```
pothole-management-system/
├── backend/              Node.js + Express API
│   ├── server.js
│   ├── routes/
│   │   ├── auth.js       register / login (JWT)
│   │   └── potholes.js   report / list / status / assign
│   ├── middleware/auth.js
│   ├── utils/
│   │   ├── db.js         tiny JSON-file "database"
│   │   ├── geo.js        haversine distance + priority score
│   │   ├── geminiVision.js  Gemini image analysis (pothole check + depth/severity)
│   │   └── geocode.js    reverse geocoding (GPS → human-readable address)
│   ├── .env.example      copy to `.env` and add your free Gemini API key
│   └── data/db.json      seeded with one admin account
└── frontend/
    ├── index.html        Page shell — loads React/Tailwind/Leaflet from CDN + app.js
    ├── app.js             All React components (Babel-compiled in the browser, no build step)
    └── style.css         Hand-written styles (hazard diamond, crack divider, etc.)
```

## Running it

### 1. Backend

```bash
cd backend
npm install
npm start
```

The API starts on `http://localhost:5000`. It stores data in
`backend/data/db.json` — good enough for a hackathon demo; swap `utils/db.js`
for a real MongoDB/PostgreSQL layer later without touching any route logic.

A demo admin account is seeded already:

```
email:    admin@ghmc.gov.in
password: admin123
```

#### Optional: turn on AI photo analysis (free Gemini API key)

Without any extra setup, severity is whatever the citizen picks on the
slider, and every photo is trusted at face value. Adding a free Gemini key
turns on two things automatically:

- **Depth/severity estimate** — Gemini looks at the photo and rates how
  severe the damage looks; that rating is blended with the citizen's own
  slider value to set the pothole's `severity`.
- **Fake-photo rejection** — if the photo clearly isn't a pothole (a selfie,
  a pet, a random object), the report is rejected with a message asking for
  a clearer photo, instead of polluting the queue.

To enable it:

1. Get a free key at **https://aistudio.google.com/app/apikey**.
2. In `backend/`, copy `.env.example` to `.env`:
   ```bash
   cd backend
   cp .env.example .env
   ```
3. Open `.env` and paste your key: `GEMINI_API_KEY=your-key-here`
4. Restart the backend (`npm start`). The startup log tells you whether it
   picked it up:
   ```
   Gemini image analysis: ENABLED
   ```
   If you don't set a key, you'll instead see `disabled` — the app still
   works fully, it just skips the AI step (`aiAnalysis.skipped === true`
   on every report).

Every report also gets **reverse-geocoded** into a human-readable address
(via OpenStreetMap's free Nominatim service, no key needed) so GHMC staff
see "Tank Bund Road, Hyderabad" instead of raw GPS coordinates on the
dashboard — this happens regardless of whether Gemini is configured.

### 2. Frontend

`index.html` loads `app.js` as an external `<script type="text/babel" src="app.js">`.
Babel Standalone fetches that file at runtime to compile it — which means
**this must be served over HTTP, not opened directly from disk.** Double-
clicking `index.html` (a `file://` URL) will fail in Chrome/Edge because
browsers block that fetch for local files; some browsers (Firefox) allow it,
but don't rely on that.

From the `frontend/` folder, run any static file server, e.g.:

```bash
cd frontend
python3 -m http.server 8080
# or: npx serve .
```

Then open `http://localhost:8080`. It talks to `http://localhost:5000/api`
by default.

**No backend running?** The page detects that automatically and switches to
a demo dataset so you can still click through the whole flow — a yellow
banner at the top tells you it's doing this.

### Troubleshooting: "I don't see the pothole photo in the admin dashboard"

The admin list has always rendered a clickable thumbnail (tap it for a
full-size lightbox) for every pothole that has at least one photo — this was
confirmed working end-to-end against a live backend (register → submit a
report with a photo → fetch as admin → photo present in the response).

If it's not showing up for you, it's almost always the **browser caching the
old `app.js`**. Plain static servers like `python3 -m http.server` don't
send cache-busting headers, so browsers can keep serving a stale copy of the
JS file even after you've replaced it on disk. Fix:

- Hard-refresh: **Ctrl+Shift+R** (Windows/Linux) or **Cmd+Shift+R** (Mac),
  or open DevTools → Network tab → check "Disable cache" while testing.
- Or open the page in a fresh private/incognito window.

If a hard refresh doesn't fix it, check the browser console for errors, and
confirm the report actually has a photo attached by checking the API
directly: `curl http://localhost:5000/api/potholes` should show a non-empty
`images` array for that pothole.

## How the core engineering problems are solved

**Duplicate reports.** Every new report's GPS coordinates are checked with
the haversine formula against existing potholes (`backend/utils/geo.js`). If
one is found within 30 meters, the system doesn't create a new record — it
increments that pothole's `reportCount`, stores the new photo as supporting
evidence, and raises severity to the worst reported value. A pothole caps
out at 15 reports; after that, new submissions are told it's already in the
queue.

**Fake / stale reports.**
- Location is taken from the device's own GPS (`navigator.geolocation`) or a
  map tap — there's no field to type in arbitrary coordinates.
- A photo is required on every submission.
- **AI photo check (optional, needs a Gemini key — see setup above).** Gemini
  looks at the photo and rejects it if it clearly isn't a pothole (a selfie,
  a pet, a random object), instead of trusting every upload at face value.
- If a pothole was marked `Completed` in the last 3 days, new reports at that
  spot are rejected with a message rather than silently reopening it (guards
  against people re-reporting something already fixed). After that window,
  a new report reopens the record instead of creating a duplicate — potholes
  do come back.

**Address verification.** Every report is reverse-geocoded (GPS → human
address) via OpenStreetMap Nominatim, so staff aren't just staring at raw
coordinates and can sanity-check that a report's address actually matches
where its pin is dropped.

**Prioritization.** `priority = reportCount × 3 + severity × 4 + daysPending × 2`.
`severity` itself is the citizen's manual 1–10 rating, blended with Gemini's
own severity read (averaged) whenever the AI is confident about its
judgement — so a pothole with an obviously deep, dangerous photo ranks higher
even if the citizen under-rated it on the slider.

## API reference

| Method | Endpoint                     | Auth   | Purpose |
|--------|-------------------------------|--------|---------|
| POST   | `/api/auth/register`          | —      | Create an account (citizen or admin) |
| POST   | `/api/auth/login`              | —      | Get a JWT |
| GET    | `/api/potholes`                 | —      | List all potholes, sorted by priority |
| GET    | `/api/potholes/stats`           | —      | Counts by status/priority for the dashboard |
| GET    | `/api/potholes/ai-status`       | —      | `{ enabled: true/false }` — whether a Gemini key is configured |
| GET    | `/api/potholes/mine`            | citizen| Reports the logged-in user has confirmed |
| POST   | `/api/potholes`                 | citizen| Submit a report (`lat`, `lng`, `image`, `severity`, `note`) |
| PUT    | `/api/potholes/:id/status`      | admin  | Move a pothole through Reported → Verified → Assigned → In Progress → Completed |
| PUT    | `/api/potholes/:id/assign`      | admin  | Assign a repair crew |

## Next steps for a production version

- Swap the JSON file for MongoDB (with a `2dsphere` geospatial index) or
  PostgreSQL + PostGIS for real duplicate-detection performance at scale.
- Move images out of the JSON payload and into Cloudinary/S3, storing only
  the URL — matters more once Gemini analysis is on, since base64 photos in
  a flat JSON file get big fast.
- Cache reverse-geocode lookups (or self-host Nominatim) instead of calling
  the public instance on every new pothole — it's free but rate-limited to
  roughly 1 request/second.
- Add offline queuing on the frontend for citizens with patchy connectivity.
