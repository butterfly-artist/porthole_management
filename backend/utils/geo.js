// Haversine distance in meters between two lat/lng points.
function distanceInMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Find an existing pothole within `radiusMeters` of the given coordinates
// that is not already marked Completed (a completed pothole should reopen
// rather than silently absorb new reports forever).
function findNearbyPothole(potholes, lat, lng, radiusMeters = 30) {
  return potholes.find((p) => {
    const d = distanceInMeters(lat, lng, p.location.lat, p.location.lng);
    return d <= radiusMeters;
  });
}

// Priority = weighted mix of how many people confirmed it, how severe it
// is, and how long it has been waiting. Tune the weights as needed.
function calculatePriority({ reportCount, severity, createdDate }) {
  const daysPending = Math.floor(
    (Date.now() - new Date(createdDate).getTime()) / (1000 * 60 * 60 * 24)
  );
  const score = reportCount * 3 + severity * 4 + daysPending * 2;
  return Math.round(score);
}

function priorityLabel(score) {
  if (score >= 60) return "Critical";
  if (score >= 35) return "High";
  if (score >= 15) return "Medium";
  return "Low";
}

module.exports = {
  distanceInMeters,
  findNearbyPothole,
  calculatePriority,
  priorityLabel,
};
