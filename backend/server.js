require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const potholeRoutes = require("./routes/potholes");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "10mb" })); // generous limit — pothole photos come in as base64

app.use("/api/auth", authRoutes);
app.use("/api/potholes", potholeRoutes);

app.get("/", (req, res) => {
  res.json({ message: "GHMC Pothole Management API is running." });
});

app.listen(PORT, () => {
  console.log(`Pothole Management API listening on http://localhost:${PORT}`);
  console.log(
    process.env.GEMINI_API_KEY
      ? "Gemini image analysis: ENABLED"
      : "Gemini image analysis: disabled (set GEMINI_API_KEY in backend/.env to enable — see .env.example)"
  );
});
