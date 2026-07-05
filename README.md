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
│   │   └── geo.js        haversine distance + priority score
│   └── data/db.json      seeded with one admin account
└── frontend/
    ├── index.html        Page shell — loads React/Tailwind/Leaflet from CDN + app.js
    ├── app.js            All React components (Babel-compiled in the browser, no build step)
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
- If a pothole was marked `Completed` in the last 3 days, new reports at that
  spot are rejected with a message rather than silently reopening it (guards
  against people re-reporting something already fixed). After that window,
  a new report reopens the record instead of creating a duplicate — potholes
  do come back.

**Prioritization.** `priority = reportCount × 3 + severity × 4 + daysPending × 2`,
recalculated on every read so the queue always reflects current wait time.
The admin dashboard sorts by this automatically.

## API reference

| Method | Endpoint                     | Auth   | Purpose |
|--------|-------------------------------|--------|---------|
| POST   | `/api/auth/register`          | —      | Create an account (citizen or admin) |
| POST   | `/api/auth/login`              | —      | Get a JWT |
| GET    | `/api/potholes`                 | —      | List all potholes, sorted by priority |
| GET    | `/api/potholes/stats`           | —      | Counts by status/priority for the dashboard |
| GET    | `/api/potholes/mine`            | citizen| Reports the logged-in user has confirmed |
| POST   | `/api/potholes`                 | citizen| Submit a report (`lat`, `lng`, `image`, `severity`, `note`) |
| PUT    | `/api/potholes/:id/status`      | admin  | Move a pothole through Reported → Verified → Assigned → In Progress → Completed |
| PUT    | `/api/potholes/:id/assign`      | admin  | Assign a repair crew |

## Next steps for a production version

- Swap the JSON file for MongoDB (with a `2dsphere` geospatial index) or
  PostgreSQL + PostGIS for real duplicate-detection performance at scale.
- Add a YOLOv8/TensorFlow pothole-detection pass on uploaded images instead
  of trusting every photo.
- Move images out of the JSON payload and into Cloudinary/S3, storing only
  the URL.
- Add offline queuing on the frontend for citizens with patchy connectivity.
