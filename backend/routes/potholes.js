const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { readDB, writeDB } = require("../utils/db");
const { findNearbyPothole, calculatePriority, priorityLabel } = require("../utils/geo");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { analyzePotholeImage, isConfigured: aiConfigured } = require("../utils/geminiVision");
const { reverseGeocode } = require("../utils/geocode");

const router = express.Router();

const DUPLICATE_RADIUS_METERS = 30;
const MAX_REPORTS_PER_POTHOLE = 15;
const REOPEN_AFTER_DAYS = 3; // a "completed" pothole reported again after this many days reopens instead of merging silently
const AI_REJECT_CONFIDENCE = 0.6; // only reject a photo when Gemini is fairly sure it isn't a pothole

function withComputedFields(pothole) {
  const priorityScore = calculatePriority(pothole);
  return { ...pothole, priorityScore, priorityLabel: priorityLabel(priorityScore) };
}

// GET /api/potholes  — all potholes, sorted by priority (highest first)
router.get("/", (req, res) => {
  const db = readDB();
  const withPriority = db.potholes.map(withComputedFields);
  withPriority.sort((a, b) => b.priorityScore - a.priorityScore);
  res.json(withPriority);
});

// GET /api/potholes/stats — quick counts for the admin dashboard
router.get("/stats", (req, res) => {
  const db = readDB();
  const withPriority = db.potholes.map(withComputedFields);
  const stats = {
    total: withPriority.length,
    reported: withPriority.filter((p) => p.status === "Reported").length,
    assigned: withPriority.filter((p) => p.status === "Assigned").length,
    inProgress: withPriority.filter((p) => p.status === "In Progress").length,
    completed: withPriority.filter((p) => p.status === "Completed").length,
    critical: withPriority.filter((p) => p.priorityLabel === "Critical").length,
  };
  res.json(stats);
});

// GET /api/potholes/ai-status — lets the frontend show whether Gemini image analysis is active
router.get("/ai-status", (req, res) => {
  res.json({ enabled: aiConfigured() });
});

// GET /api/potholes/mine — reports submitted by the logged-in citizen
router.get("/mine", authenticate, (req, res) => {
  const db = readDB();
  const mine = db.potholes.filter((p) => p.reports.some((r) => r.userId === req.user.id));
  res.json(mine.map(withComputedFields));
});

// POST /api/potholes — submit a new report (citizen)
router.post("/", authenticate, async (req, res) => {
  const { lat, lng, image, severity, note } = req.body;

  if (lat === undefined || lng === undefined) {
    return res.status(400).json({ message: "GPS location (lat, lng) is required." });
  }
  if (!image) {
    return res.status(400).json({ message: "A photo of the pothole is required." });
  }

  const userSeverity = Math.min(10, Math.max(1, Number(severity) || 5));

  // --- AI image check (Gemini) -------------------------------------------
  // Runs before anything touches the database. If a key isn't configured,
  // analysis.skipped is true and we fall through using the citizen's manual
  // severity rating, same as before this feature existed.
  let aiAnalysis;
  try {
    aiAnalysis = await analyzePotholeImage(image);
  } catch (err) {
    aiAnalysis = { skipped: true, reason: err.message };
  }

  if (!aiAnalysis.skipped && !aiAnalysis.isPothole && aiAnalysis.confidence >= AI_REJECT_CONFIDENCE) {
    return res.status(422).json({
      message: `Our image check couldn't confirm this is a pothole (${aiAnalysis.reasoning || "photo doesn't look like road damage"}). Please retake the photo showing the road surface clearly.`,
      aiAnalysis,
    });
  }

  // Blend AI severity with the citizen's own rating rather than overriding
  // it outright — a confident AI read nudges the score, it doesn't erase
  // the human's judgement.
  const severityScore =
    !aiAnalysis.skipped && aiAnalysis.confidence >= 0.4
      ? Math.round((userSeverity + aiAnalysis.severity) / 2)
      : userSeverity;

  const db = readDB();
  const now = new Date().toISOString();

  let match = findNearbyPothole(
    db.potholes.filter((p) => p.status !== "Completed"),
    lat,
    lng,
    DUPLICATE_RADIUS_METERS
  );

  // If the nearest match was already completed a while ago, treat this as
  // a fresh problem (road wear happens again) rather than reopening forever.
  if (!match) {
    const completedNearby = findNearbyPothole(
      db.potholes.filter((p) => p.status === "Completed"),
      lat,
      lng,
      DUPLICATE_RADIUS_METERS
    );
    if (completedNearby) {
      const daysSinceCompleted =
        (Date.now() - new Date(completedNearby.completedDate || completedNearby.createdDate).getTime()) /
        (1000 * 60 * 60 * 24);
      if (daysSinceCompleted <= REOPEN_AFTER_DAYS) {
        // Too soon after a repair — most likely a stale/duplicate report of a fixed pothole.
        return res.status(409).json({
          message: "This pothole was recently marked as repaired. If it has reappeared, please submit a new report with an updated photo.",
        });
      } else {
        match = completedNearby; // reopen the old record instead of creating a brand-new one
      }
    }
  }

  if (match) {
    if (match.reportCount >= MAX_REPORTS_PER_POTHOLE && match.status !== "Completed") {
      return res.status(200).json({
        message: "This pothole has already received sufficient reports and is in the queue.",
        pothole: withComputedFields(match),
      });
    }

    match.reportCount += 1;
    match.reports.push({ userId: req.user.id, image, note: note || "", timestamp: now, aiAnalysis });
    match.images.push(image);
    match.severity = Math.max(match.severity, severityScore); // worst reported severity wins
    if (!aiAnalysis.skipped) match.aiAnalysis = aiAnalysis; // keep the most recent read for the dashboard
    if (match.status === "Completed") {
      match.status = "Reported"; // reopened
      match.completedDate = null;
    }

    writeDB(db);
    return res.status(200).json({
      message: "Added your confirmation to an existing nearby report.",
      pothole: withComputedFields(match),
    });
  }

  // --- Reverse geocode (address verification) -----------------------------
  // Only done once, on creation — no need to re-geocode the same spot every
  // time someone confirms an existing pothole.
  const address = await reverseGeocode(lat, lng);

  // No match found — create a brand-new pothole record.
  const pothole = {
    id: uuidv4(),
    location: { lat: Number(lat), lng: Number(lng) },
    address,
    severity: severityScore,
    status: "Reported",
    reportCount: 1,
    images: [image],
    reports: [{ userId: req.user.id, image, note: note || "", timestamp: now, aiAnalysis }],
    assignedCrew: null,
    aiAnalysis: aiAnalysis.skipped ? null : aiAnalysis,
    createdDate: now,
    completedDate: null,
  };

  db.potholes.push(pothole);
  writeDB(db);

  res.status(201).json({ message: "New pothole reported.", pothole: withComputedFields(pothole) });
});

// PUT /api/potholes/:id/status — admin updates the repair pipeline stage
router.put("/:id/status", authenticate, requireAdmin, (req, res) => {
  const { status } = req.body;
  const allowed = ["Reported", "Verified", "Assigned", "In Progress", "Completed"];
  if (!allowed.includes(status)) {
    return res.status(400).json({ message: `Status must be one of: ${allowed.join(", ")}` });
  }

  const db = readDB();
  const pothole = db.potholes.find((p) => p.id === req.params.id);
  if (!pothole) return res.status(404).json({ message: "Pothole not found." });

  pothole.status = status;
  pothole.completedDate = status === "Completed" ? new Date().toISOString() : null;
  writeDB(db);

  res.json(withComputedFields(pothole));
});

// PUT /api/potholes/:id/assign — admin assigns a repair crew
router.put("/:id/assign", authenticate, requireAdmin, (req, res) => {
  const { crewName } = req.body;
  if (!crewName) return res.status(400).json({ message: "crewName is required." });

  const db = readDB();
  const pothole = db.potholes.find((p) => p.id === req.params.id);
  if (!pothole) return res.status(404).json({ message: "Pothole not found." });

  pothole.assignedCrew = crewName;
  if (pothole.status === "Reported" || pothole.status === "Verified") {
    pothole.status = "Assigned";
  }
  writeDB(db);

  res.json(withComputedFields(pothole));
});

module.exports = router;
