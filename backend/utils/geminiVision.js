// Uses Google's free-tier Gemini API (gemini-2.0-flash) to look at the
// uploaded photo and answer two questions that are otherwise unenforceable
// on the frontend alone:
//   1. Is this actually a pothole / road-surface damage? (spam / fake-photo defense)
//   2. Roughly how severe/deep does it look? (feeds the priority score)
//
// Get a free key at https://aistudio.google.com/app/apikey and set it as
// GEMINI_API_KEY (see backend/.env.example). If no key is configured, every
// function here just reports itself as "skipped" so the rest of the app
// keeps working with the citizen's manually-selected severity.

const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function isConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function parseDataUrl(dataUrl) {
  const match = /^data:(.+);base64,(.*)$/.exec(dataUrl || "");
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

const ANALYSIS_PROMPT = `You are a civic-infrastructure inspector reviewing a photo submitted through a public pothole-reporting app.

Look at the image and respond with ONLY a JSON object (no markdown fences, no extra text) in exactly this shape:
{
  "isPothole": boolean,     // true only if the image clearly shows a pothole or significant road-surface damage
  "confidence": number,     // 0 to 1, how confident you are in the isPothole judgement
  "severity": number,       // 1 to 10, how severe/dangerous the damage looks (10 = very deep/wide/hazardous)
  "depthEstimate": string,  // one of "shallow", "moderate", "deep", "unknown"
  "reasoning": string       // one short sentence explaining the judgement
}

If the image shows something unrelated to road damage (a selfie, a pet, an object, a screenshot, an indoor scene, etc.), set isPothole to false and severity to 1.`;

/**
 * @param {string} dataUrl - the image as a data: URL, e.g. "data:image/jpeg;base64,...."
 * @returns {Promise<{skipped:true, reason:string} | {skipped:false, isPothole:boolean, confidence:number, severity:number, depthEstimate:string, reasoning:string}>}
 */
async function analyzePotholeImage(dataUrl) {
  if (!isConfigured()) {
    return { skipped: true, reason: "GEMINI_API_KEY not configured" };
  }

  const parsed = parseDataUrl(dataUrl);
  if (!parsed) {
    return { skipped: true, reason: "Image was not a valid data URL" };
  }

  const body = {
    contents: [
      {
        parts: [
          { text: ANALYSIS_PROMPT },
          { inline_data: { mime_type: parsed.mimeType, data: parsed.base64 } },
        ],
      },
    ],
    generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
  };

  let res;
  try {
    res = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Network failure talking to Gemini shouldn't take the whole report down.
    return { skipped: true, reason: `Could not reach Gemini API: ${err.message}` };
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return { skipped: true, reason: `Gemini API error (${res.status}): ${errText.slice(0, 200)}` };
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    return { skipped: true, reason: "Gemini returned an empty response" };
  }

  let parsedResult;
  try {
    parsedResult = JSON.parse(text);
  } catch {
    return { skipped: true, reason: "Gemini response wasn't valid JSON" };
  }

  return {
    skipped: false,
    isPothole: Boolean(parsedResult.isPothole),
    confidence: Math.min(1, Math.max(0, Number(parsedResult.confidence) || 0)),
    severity: Math.min(10, Math.max(1, Number(parsedResult.severity) || 5)),
    depthEstimate: ["shallow", "moderate", "deep"].includes(parsedResult.depthEstimate) ? parsedResult.depthEstimate : "unknown",
    reasoning: String(parsedResult.reasoning || "").slice(0, 300),
  };
}

module.exports = { analyzePotholeImage, isConfigured };
