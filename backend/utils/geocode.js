// Turns GPS coordinates into a human-readable address so GHMC staff can
// sanity-check "does this address make sense for these coordinates" at a
// glance, instead of staring at raw lat/lng pairs. Uses OpenStreetMap's free
// Nominatim service — no API key needed, but it does require a descriptive
// User-Agent and asks that you stay under ~1 request/second.
// Docs: https://nominatim.org/release-docs/latest/api/Reverse/

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";

/**
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<string|null>} a display address, or null if lookup failed
 */
async function reverseGeocode(lat, lng) {
  try {
    const url = `${NOMINATIM_URL}?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=0`;
    const res = await fetch(url, {
      headers: {
        // Nominatim's usage policy requires an identifiable User-Agent.
        "User-Agent": "PATCH-Pothole-Reporter/1.0 (hackathon civic-tech project)",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.display_name || null;
  } catch {
    return null; // a geocoding hiccup should never block someone's report
  }
}

module.exports = { reverseGeocode };
