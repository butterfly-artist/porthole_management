const { useState, useEffect, useRef, useCallback } = React;

/* ============================== CONFIG ============================== */
const API_BASE = "http://localhost:5000/api";
const HYDERABAD_CENTER = [17.3850, 78.4867];
const CITIZEN_DEMO_PASSWORD = "citizen-demo-pass"; // used for the passwordless "quick check-in" flow

/* ====================== TINY FETCH HELPER + DEMO FALLBACK ======================
   If the Node/Express backend (see /backend) isn't running, the app quietly
   switches to an in-memory demo dataset so the interface is still explorable.

   Important distinction used throughout this file:
   - a NETWORK error (fetch itself throws, e.g. TypeError: Failed to fetch)
     means the backend is unreachable -> fall back to demo mode.
   - an API error (backend responded, just with a non-2xx status, e.g. wrong
     password, validation failure) means the backend IS reachable -> show the
     real error to the user instead of silently switching to demo data. */

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
  } catch (err) {
    err.isNetworkError = true;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || "Request failed");
    err.isNetworkError = false;
    throw err;
  }
  return data;
}

function isNetworkError(err) {
  return !!err && err.isNetworkError === true;
}

/* ============================== DEMO / MOCK MODE ============================== */
function makeDemoPothole(over) {
  const base = {
    id: "demo-" + Math.random().toString(36).slice(2, 9),
    location: { lat: 17.3850 + (Math.random() - 0.5) * 0.02, lng: 78.4867 + (Math.random() - 0.5) * 0.02 },
    severity: 5, status: "Reported", reportCount: 1, images: [],
    reports: [], assignedCrew: null, createdDate: new Date().toISOString(), completedDate: null,
  };
  const p = { ...base, ...over };
  return recompute(p);
}

const SAMPLE_IMG = "data:image/svg+xml;base64," + btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="140"><rect width="200" height="140" fill="#444"/></svg>'
);

let demoStore = {
  potholes: [
    makeDemoPothole({ location: { lat: 17.3860, lng: 78.4870 }, severity: 9, reportCount: 14, status: "Reported", createdDate: new Date(Date.now() - 6 * 86400000).toISOString(), images: [SAMPLE_IMG] }),
    makeDemoPothole({ location: { lat: 17.4030, lng: 78.4560 }, severity: 6, reportCount: 4, status: "Assigned", assignedCrew: "Crew Alpha", createdDate: new Date(Date.now() - 2 * 86400000).toISOString(), images: [SAMPLE_IMG] }),
    makeDemoPothole({ location: { lat: 17.3600, lng: 78.4740 }, severity: 3, reportCount: 1, status: "In Progress", assignedCrew: "Crew Bravo", createdDate: new Date(Date.now() - 1 * 86400000).toISOString(), images: [SAMPLE_IMG] }),
    makeDemoPothole({ location: { lat: 17.4400, lng: 78.4980 }, severity: 8, reportCount: 2, status: "Completed", createdDate: new Date(Date.now() - 10 * 86400000).toISOString(), images: [SAMPLE_IMG] }),
  ],
};

function recompute(p) {
  const days = Math.floor((Date.now() - new Date(p.createdDate).getTime()) / 86400000);
  p.priorityScore = p.reportCount * 3 + p.severity * 4 + days * 2;
  p.priorityLabel = p.priorityScore >= 60 ? "Critical" : p.priorityScore >= 35 ? "High" : p.priorityScore >= 15 ? "Medium" : "Low";
  return p;
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const demoApi = {
  async login(email, password) {
    if (email === "admin@ghmc.gov.in" && password === "admin123") {
      return { token: "demo-admin-token", user: { id: "demo-admin", name: "GHMC Admin", role: "admin" } };
    }
    throw new Error("Invalid email or password.");
  },
  async registerOrLoginCitizen(name, email) {
    return { token: "demo-" + email, user: { id: "demo-" + email, name, role: "citizen" } };
  },
  async list() {
    return demoStore.potholes.map(recompute).sort((a, b) => b.priorityScore - a.priorityScore);
  },
  async stats() {
    const all = demoStore.potholes.map(recompute);
    return {
      total: all.length,
      reported: all.filter((p) => p.status === "Reported").length,
      assigned: all.filter((p) => p.status === "Assigned").length,
      inProgress: all.filter((p) => p.status === "In Progress").length,
      completed: all.filter((p) => p.status === "Completed").length,
      critical: all.filter((p) => p.priorityLabel === "Critical").length,
    };
  },
  async report({ lat, lng, image, severity, note, userId }) {
    const open = demoStore.potholes.filter((p) => p.status !== "Completed");
    const match = open.find((p) => haversine(lat, lng, p.location.lat, p.location.lng) <= 30);
    if (match) {
      match.reportCount += 1;
      match.severity = Math.max(match.severity, severity);
      match.images.push(image);
      match.reports.push({ userId, image, note, timestamp: new Date().toISOString() });
      recompute(match);
      return { message: "Added your confirmation to an existing nearby report.", pothole: match };
    }
    const fresh = makeDemoPothole({
      location: { lat, lng }, severity, images: [image],
      reports: [{ userId, image, note, timestamp: new Date().toISOString() }],
    });
    demoStore.potholes.push(fresh);
    return { message: "New pothole reported.", pothole: fresh };
  },
  async updateStatus(id, status) {
    const p = demoStore.potholes.find((x) => x.id === id);
    p.status = status;
    p.completedDate = status === "Completed" ? new Date().toISOString() : null;
    return recompute(p);
  },
  async assign(id, crewName) {
    const p = demoStore.potholes.find((x) => x.id === id);
    p.assignedCrew = crewName;
    if (p.status === "Reported" || p.status === "Verified") p.status = "Assigned";
    return recompute(p);
  },
};

/* ============================== SHARED UI ============================== */

function CrackDivider() {
  return (
    <svg className="crack-divider" viewBox="0 0 400 14" preserveAspectRatio="none">
      <path d="M0,7 L40,5 L55,10 L80,3 L110,9 L140,6 L170,11 L200,4 L230,8 L260,5 L290,10 L320,6 L350,9 L400,7"
        fill="none" stroke="#24262B" strokeWidth="1.5" />
    </svg>
  );
}

function PriorityDiamond({ score, label }) {
  const colors = { Critical: "#D64545", High: "#E85D2C", Medium: "#F2B705", Low: "#8A8D93" };
  return (
    <div className="flex items-center gap-2">
      <div className="hazard-diamond" style={{ "--diamond-color": colors[label] }}>
        <span className="font-display font-800 text-white text-sm leading-none">{score}</span>
      </div>
      <span className="font-display text-sm tracking-wide uppercase" style={{ color: colors[label] }}>{label}</span>
    </div>
  );
}

const STATUS_STEPS = ["Reported", "Verified", "Assigned", "In Progress", "Completed"];
function StatusPill({ status }) {
  const styles = {
    Reported: "bg-asphalt-light text-white",
    Verified: "bg-caution text-asphalt",
    Assigned: "bg-hazard text-white",
    "In Progress": "bg-hazard-dark text-white",
    Completed: "bg-okgreen text-white",
  };
  return <span className={`px-2.5 py-1 rounded-full text-xs font-semibold font-mono tracking-wide ${styles[status]}`}>{status.toUpperCase()}</span>;
}

function Stat({ label, value, accent }) {
  return (
    <div className="bg-white rounded-xl px-5 py-4 shadow-sm border-l-4" style={{ borderColor: accent }}>
      <div className="text-3xl font-display font-700 text-asphalt">{value}</div>
      <div className="text-xs uppercase tracking-wider text-asphalt/60 font-semibold mt-1">{label}</div>
    </div>
  );
}

function Banner({ backendOnline }) {
  if (backendOnline !== false) return null; // null (still checking) or true (online) -> show nothing
  return (
    <div className="bg-caution text-asphalt text-sm font-medium px-4 py-2 text-center">
      Demo mode — the Node/Express backend isn't running, so this preview uses sample data.
      Start <code className="font-mono bg-asphalt/10 px-1 rounded">backend/server.js</code> and refresh to go live.
    </div>
  );
}

/* ============================== MAP ============================== */
function MapView({ potholes, height = "420px", pickMode = false, onPick, pickedLocation }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const pickMarkerRef = useRef(null);

  useEffect(() => {
    if (mapRef.current) return;
    const map = L.map(containerRef.current).setView(HYDERABAD_CENTER, 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    if (pickMode) {
      map.on("click", (e) => onPick && onPick(e.latlng.lat, e.latlng.lng));
    }
    setTimeout(() => map.invalidateSize(), 100);
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layerRef.current) return;
    layerRef.current.clearLayers();
    const colors = { Critical: "#D64545", High: "#E85D2C", Medium: "#F2B705", Low: "#8A8D93" };
    potholes.forEach((p) => {
      const color = colors[p.priorityLabel] || "#8A8D93";
      const marker = L.circleMarker([p.location.lat, p.location.lng], {
        radius: 8 + Math.min(10, p.reportCount),
        color: "#24262B", weight: 1.5, fillColor: color, fillOpacity: 0.85,
      });
      marker.bindPopup(
        `<div style="font-family:Inter,sans-serif;min-width:160px">
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:700;">Priority ${p.priorityScore} · ${p.priorityLabel}</div>
          <div style="font-size:12px;margin-top:2px;">Status: <b>${p.status}</b></div>
          <div style="font-size:12px;">Reports: ${p.reportCount} · Severity: ${p.severity}/10</div>
          ${p.assignedCrew ? `<div style="font-size:12px;">Crew: ${p.assignedCrew}</div>` : ""}
        </div>`
      );
      marker.addTo(layerRef.current);
    });
  }, [potholes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pickMode) return;
    if (pickMarkerRef.current) map.removeLayer(pickMarkerRef.current);
    if (pickedLocation) {
      pickMarkerRef.current = L.marker([pickedLocation.lat, pickedLocation.lng], {
        icon: L.divIcon({ className: "", html: '<div style="font-size:28px;line-height:28px;">📍</div>', iconSize: [28, 28], iconAnchor: [14, 28] }),
      }).addTo(map);
      map.panTo([pickedLocation.lat, pickedLocation.lng]);
    }
  }, [pickedLocation, pickMode]);

  return <div ref={containerRef} style={{ height, width: "100%" }} className="rounded-xl border border-asphalt/10 z-0" />;
}

/* ============================== HOME ============================== */
function Home({ onSelect }) {
  return (
    <div className="max-w-4xl mx-auto px-6 py-16">
      <div className="tape-stripe h-2 w-24 rounded-full mb-6"></div>
      <h1 className="font-display text-6xl md:text-7xl font-800 leading-[0.95] text-asphalt">
        Every pothole<br />gets a paper trail.
      </h1>
      <p className="mt-5 text-lg text-asphalt/70 max-w-xl">
        PATCH turns scattered phone calls and social-media complaints into one
        ranked queue GHMC crews can actually work through — GPS-verified,
        duplicate-free, and sorted by what's most dangerous first.
      </p>
      <CrackDivider />
      <div className="grid sm:grid-cols-2 gap-5 mt-10">
        <button onClick={() => onSelect("citizen")}
          className="text-left bg-asphalt text-white rounded-2xl p-6 hover:bg-asphalt-dark transition shadow-lg group">
          <div className="text-xs uppercase tracking-widest text-caution font-semibold mb-2">Citizen</div>
          <div className="font-display text-3xl font-700">Report a pothole</div>
          <div className="text-white/60 text-sm mt-2">Snap a photo, share your location, done in under a minute.</div>
          <div className="mt-4 text-hazard group-hover:translate-x-1 transition-transform inline-block">→</div>
        </button>
        <button onClick={() => onSelect("admin")}
          className="text-left bg-white text-asphalt rounded-2xl p-6 hover:bg-white/70 transition shadow-lg border border-asphalt/10 group">
          <div className="text-xs uppercase tracking-widest text-hazard font-semibold mb-2">GHMC Staff</div>
          <div className="font-display text-3xl font-700">Open the dashboard</div>
          <div className="text-asphalt/60 text-sm mt-2">Priority queue, crew assignment, ward-wide map.</div>
          <div className="mt-4 text-hazard group-hover:translate-x-1 transition-transform inline-block">→</div>
        </button>
      </div>
    </div>
  );
}

/* ============================== CITIZEN PORTAL ============================== */
function CitizenPortal({ backendOnline, setBackendOnline }) {
  const [identity, setIdentity] = useState(null); // {token, user}
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [identityError, setIdentityError] = useState("");

  const [potholes, setPotholes] = useState([]);
  const [location, setLocation] = useState(null);
  const [image, setImage] = useState(null);
  const [severity, setSeverity] = useState(5);
  const [note, setNote] = useState("");
  const [submitMsg, setSubmitMsg] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const loadPotholes = useCallback(async () => {
    try {
      const data = await api("/potholes");
      setPotholes(data);
      setBackendOnline(true);
    } catch (err) {
      if (!isNetworkError(err)) { console.error(err); }
      setBackendOnline(false);
      setPotholes(await demoApi.list());
    }
  }, [setBackendOnline]);

  useEffect(() => { loadPotholes(); }, [loadPotholes]);

  // Try the real backend first; only fall back to the in-memory demo when the
  // backend is genuinely unreachable, not when it rejects the request.
  async function loginOrRegisterCitizen() {
    try {
      return await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password: CITIZEN_DEMO_PASSWORD }) });
    } catch (err) {
      if (isNetworkError(err)) throw err; // bubble up -> caller switches to demo mode
      // No account yet under this email -> register one on the fly.
      return await api("/auth/register", { method: "POST", body: JSON.stringify({ name, email, password: CITIZEN_DEMO_PASSWORD, role: "citizen" }) });
    }
  }

  async function handleContinue(e) {
    e.preventDefault();
    setIdentityError("");
    if (!name.trim() || !email.trim()) { setIdentityError("Enter your name and email to continue."); return; }
    try {
      const res = await loginOrRegisterCitizen();
      setBackendOnline(true);
      setIdentity(res);
    } catch (err) {
      if (isNetworkError(err)) {
        setBackendOnline(false);
        const res = await demoApi.registerOrLoginCitizen(name, email);
        setIdentity(res);
      } else {
        setIdentityError(err.message);
      }
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) { alert("Geolocation isn't available in this browser — tap the map instead."); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => alert("Couldn't get your location — tap the map to drop a pin instead.")
    );
  }

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImage(reader.result);
    reader.readAsDataURL(file);
  }

  async function submitReport(e) {
    e.preventDefault();
    setSubmitMsg(null);
    if (!location) { setSubmitMsg({ type: "error", text: "Set a location first — use your GPS or tap the map." }); return; }
    if (!image) { setSubmitMsg({ type: "error", text: "A photo of the pothole is required." }); return; }
    setSubmitting(true);
    try {
      let result;
      try {
        result = await api("/potholes", {
          method: "POST",
          headers: { Authorization: `Bearer ${identity.token}` },
          body: JSON.stringify({ lat: location.lat, lng: location.lng, image, severity, note }),
        });
        setBackendOnline(true);
      } catch (err) {
        if (!isNetworkError(err)) throw err; // real backend error (e.g. bad token) -> surface it
        setBackendOnline(false);
        result = await demoApi.report({ lat: location.lat, lng: location.lng, image, severity, note, userId: identity.user.id });
      }
      setSubmitMsg({ type: "success", text: result.message });
      setImage(null); setNote(""); setSeverity(5); setLocation(null);
      loadPotholes();
    } catch (err) {
      setSubmitMsg({ type: "error", text: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  const myReports = identity ? potholes.filter((p) => p.reports?.some((r) => r.userId === identity.user.id)) : [];

  if (!identity) {
    return (
      <div className="max-w-md mx-auto px-6 py-16">
        <div className="tape-stripe h-2 w-16 rounded-full mb-6"></div>
        <h2 className="font-display text-4xl font-700">Quick check-in</h2>
        <p className="text-asphalt/60 mt-2 text-sm">Just enough to attach your reports to your name — no password to remember.</p>
        <form onSubmit={handleContinue} className="mt-6 space-y-4">
          <div>
            <label className="text-xs uppercase tracking-wide font-semibold text-asphalt/60">Full name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full mt-1 border border-asphalt/20 rounded-lg px-3 py-2.5 bg-white" placeholder="Madhulika" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide font-semibold text-asphalt/60">Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="w-full mt-1 border border-asphalt/20 rounded-lg px-3 py-2.5 bg-white" placeholder="you@example.com" />
          </div>
          {identityError && <p className="text-danger text-sm">{identityError}</p>}
          <button className="w-full bg-hazard hover:bg-hazard-dark text-white font-display text-xl font-700 rounded-lg py-3 transition">Start reporting →</button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <div className="text-xs uppercase tracking-widest text-hazard font-semibold">Citizen portal</div>
          <h2 className="font-display text-4xl font-700">Hi {identity.user.name.split(" ")[0]}, spot a pothole?</h2>
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        <form onSubmit={submitReport} className="lg:col-span-2 bg-white rounded-2xl p-6 shadow-sm space-y-5 h-fit">
          <div>
            <label className="text-xs uppercase tracking-wide font-semibold text-asphalt/60 block mb-2">1. Location</label>
            <div className="flex gap-2">
              <button type="button" onClick={useMyLocation} className="flex-1 bg-asphalt text-white rounded-lg py-2 text-sm font-semibold hover:bg-asphalt-dark">Use my GPS</button>
              <span className="text-xs text-asphalt/50 self-center">or tap the map →</span>
            </div>
            {location && <p className="text-xs text-okgreen mt-2 font-mono">📍 {location.lat.toFixed(5)}, {location.lng.toFixed(5)}</p>}
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide font-semibold text-asphalt/60 block mb-2">2. Photo</label>
            <input type="file" accept="image/*" capture="environment" onChange={handleFile} className="text-sm w-full" />
            {image && <img src={image} alt="preview" className="mt-2 rounded-lg h-28 object-cover w-full" />}
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide font-semibold text-asphalt/60 block mb-2">3. How bad is it? ({severity}/10)</label>
            <input type="range" min="1" max="10" value={severity} onChange={(e) => setSeverity(Number(e.target.value))} className="w-full accent-hazard" />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide font-semibold text-asphalt/60 block mb-2">4. Note (optional)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows="2" className="w-full border border-asphalt/20 rounded-lg px-3 py-2 text-sm" placeholder="e.g. right outside the bus stop" />
          </div>

          {submitMsg && (
            <p className={`text-sm font-medium ${submitMsg.type === "error" ? "text-danger" : "text-okgreen"}`}>{submitMsg.text}</p>
          )}

          <button disabled={submitting} className="w-full bg-hazard hover:bg-hazard-dark disabled:opacity-50 text-white font-display text-xl font-700 rounded-lg py-3 transition">
            {submitting ? "Submitting…" : "Submit report"}
          </button>
        </form>

        <div className="lg:col-span-3 space-y-6">
          <MapView potholes={potholes} pickMode onPick={(lat, lng) => setLocation({ lat, lng })} pickedLocation={location} />
          {myReports.length > 0 && (
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <h3 className="font-display text-2xl font-700 mb-3">Your reports</h3>
              <div className="space-y-2">
                {myReports.map((p) => (
                  <div key={p.id} className="flex items-center justify-between border-b last:border-0 border-asphalt/10 py-2">
                    <div className="text-sm">
                      <div className="font-mono text-xs text-asphalt/50">{p.location.lat.toFixed(4)}, {p.location.lng.toFixed(4)}</div>
                      <div className="text-asphalt/70">{p.reportCount} confirmation{p.reportCount > 1 ? "s" : ""}</div>
                    </div>
                    <StatusPill status={p.status} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================== ADMIN PORTAL ============================== */
function AdminPortal({ backendOnline, setBackendOnline }) {
  const [auth, setAuth] = useState(null);
  const [email, setEmail] = useState("admin@ghmc.gov.in");
  const [password, setPassword] = useState("admin123");
  const [loginError, setLoginError] = useState("");

  const [potholes, setPotholes] = useState([]);
  const [stats, setStats] = useState(null);
  const [crewInputs, setCrewInputs] = useState({});

  const load = useCallback(async () => {
    try {
      const [list, s] = await Promise.all([api("/potholes"), api("/potholes/stats")]);
      setPotholes(list); setStats(s); setBackendOnline(true);
    } catch (err) {
      if (!isNetworkError(err)) { console.error(err); }
      setBackendOnline(false);
      setPotholes(await demoApi.list()); setStats(await demoApi.stats());
    }
  }, [setBackendOnline]);

  useEffect(() => { if (auth) load(); }, [auth, load]);

  async function handleLogin(e) {
    e.preventDefault();
    setLoginError("");
    try {
      const res = await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      setBackendOnline(true);
      if (res.user.role !== "admin") { setLoginError("This account isn't an admin account."); return; }
      setAuth(res);
    } catch (err) {
      if (isNetworkError(err)) {
        setBackendOnline(false);
        try {
          const res = await demoApi.login(email, password);
          setAuth(res);
        } catch (demoErr) {
          setLoginError(demoErr.message);
        }
      } else {
        setLoginError(err.message);
      }
    }
  }

  async function changeStatus(id, status) {
    try {
      await api(`/potholes/${id}/status`, { method: "PUT", headers: { Authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ status }) });
    } catch (err) {
      if (!isNetworkError(err)) { alert(err.message); return; }
      await demoApi.updateStatus(id, status);
    }
    load();
  }

  async function assignCrew(id) {
    const crewName = crewInputs[id];
    if (!crewName) return;
    try {
      await api(`/potholes/${id}/assign`, { method: "PUT", headers: { Authorization: `Bearer ${auth.token}` }, body: JSON.stringify({ crewName }) });
    } catch (err) {
      if (!isNetworkError(err)) { alert(err.message); return; }
      await demoApi.assign(id, crewName);
    }
    load();
  }

  if (!auth) {
    return (
      <div className="max-w-md mx-auto px-6 py-16">
        <div className="tape-stripe h-2 w-16 rounded-full mb-6"></div>
        <h2 className="font-display text-4xl font-700">GHMC staff sign-in</h2>
        <p className="text-asphalt/60 mt-2 text-sm">Demo credentials are pre-filled — just hit sign in.</p>
        <form onSubmit={handleLogin} className="mt-6 space-y-4">
          <div>
            <label className="text-xs uppercase tracking-wide font-semibold text-asphalt/60">Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full mt-1 border border-asphalt/20 rounded-lg px-3 py-2.5 bg-white" />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide font-semibold text-asphalt/60">Password</label>
            <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className="w-full mt-1 border border-asphalt/20 rounded-lg px-3 py-2.5 bg-white" />
          </div>
          {loginError && <p className="text-danger text-sm">{loginError}</p>}
          <button className="w-full bg-asphalt hover:bg-asphalt-dark text-white font-display text-xl font-700 rounded-lg py-3 transition">Sign in →</button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      <div className="mb-6">
        <div className="text-xs uppercase tracking-widest text-hazard font-semibold">GHMC dashboard</div>
        <h2 className="font-display text-4xl font-700">Priority repair queue</h2>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-8">
          <Stat label="Total" value={stats.total} accent="#24262B" />
          <Stat label="Reported" value={stats.reported} accent="#383B42" />
          <Stat label="Assigned" value={stats.assigned} accent="#E85D2C" />
          <Stat label="In progress" value={stats.inProgress} accent="#C94A1F" />
          <Stat label="Completed" value={stats.completed} accent="#3FA34D" />
          <Stat label="Critical" value={stats.critical} accent="#D64545" />
        </div>
      )}

      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2">
          <MapView potholes={potholes} height="600px" />
        </div>

        <div className="lg:col-span-3 bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="max-h-[600px] overflow-y-auto divide-y divide-asphalt/10">
            {potholes.length === 0 && <p className="p-6 text-asphalt/50 text-sm">No potholes reported yet.</p>}
            {potholes.map((p) => (
              <div key={p.id} className="p-4 hover:bg-concrete/50 transition">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <PriorityDiamond score={p.priorityScore} label={p.priorityLabel} />
                  <div className="flex-1 min-w-[140px]">
                    <div className="font-mono text-xs text-asphalt/50">{p.location.lat.toFixed(5)}, {p.location.lng.toFixed(5)}</div>
                    <div className="text-sm text-asphalt/70 mt-0.5">{p.reportCount} report{p.reportCount > 1 ? "s" : ""} · severity {p.severity}/10</div>
                    {p.assignedCrew && <div className="text-xs text-hazard font-semibold mt-0.5">Crew: {p.assignedCrew}</div>}
                  </div>
                  <StatusPill status={p.status} />
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <select value={p.status} onChange={(e) => changeStatus(p.id, e.target.value)}
                    className="text-xs border border-asphalt/20 rounded-md px-2 py-1.5 bg-white">
                    {STATUS_STEPS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <input placeholder="Assign crew…" value={crewInputs[p.id] || p.assignedCrew || ""}
                    onChange={(e) => setCrewInputs({ ...crewInputs, [p.id]: e.target.value })}
                    className="text-xs border border-asphalt/20 rounded-md px-2 py-1.5 flex-1 min-w-[100px]" />
                  <button onClick={() => assignCrew(p.id)} className="text-xs bg-asphalt text-white rounded-md px-3 py-1.5 font-semibold hover:bg-asphalt-dark">Assign</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================== APP SHELL ============================== */
function Navbar({ view, setView }) {
  return (
    <div className="bg-asphalt text-white sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        <button onClick={() => setView("home")} className="flex items-center gap-2">
          <div className="w-3 h-3 bg-hazard rounded-sm rotate-45"></div>
          <span className="font-display text-2xl font-800 tracking-wide">PATCH</span>
          <span className="hidden sm:inline text-white/40 text-xs font-mono ml-1">GHMC pothole response</span>
        </button>
        <div className="flex gap-1 bg-white/10 rounded-lg p-1">
          <button onClick={() => setView("citizen")} className={`px-3 py-1.5 rounded-md text-sm font-semibold transition ${view === "citizen" ? "bg-hazard text-white" : "text-white/70 hover:text-white"}`}>Citizen</button>
          <button onClick={() => setView("admin")} className={`px-3 py-1.5 rounded-md text-sm font-semibold transition ${view === "admin" ? "bg-hazard text-white" : "text-white/70 hover:text-white"}`}>Admin</button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [view, setView] = useState("home");
  const [backendOnline, setBackendOnline] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/potholes`)
      .then((res) => setBackendOnline(res.ok))
      .catch(() => setBackendOnline(false));
  }, []);

  return (
    <div className="min-h-screen">
      <Navbar view={view} setView={setView} />
      <Banner backendOnline={backendOnline} />
      {view === "home" && <Home onSelect={setView} />}
      {view === "citizen" && <CitizenPortal backendOnline={backendOnline} setBackendOnline={setBackendOnline} />}
      {view === "admin" && <AdminPortal backendOnline={backendOnline} setBackendOnline={setBackendOnline} />}
      <footer className="text-center text-xs text-asphalt/40 py-8">
        Built for GHMC · duplicate reports merge within a 30 m radius · priority = reports × 3 + severity × 4 + days waiting × 2
      </footer>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
