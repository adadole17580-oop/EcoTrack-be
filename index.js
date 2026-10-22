
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { supabaseAdmin } = require("./config/supabase");

const authRoutes = require("./routes/auth");
const residentRoutes = require("./routes/residents");
const scheduleRoutes = require("./routes/schedules");
const reportRoutes = require("./routes/reports");
const guideRoutes = require("./routes/guide");
const notificationRoutes = require("./routes/notifications");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);

app.use("/api/residents/schedules", scheduleRoutes);
app.use("/api/residents/reports", reportRoutes);
app.use("/api/residents/guide", guideRoutes);
app.use("/api/residents/notifications", notificationRoutes);

app.use("/api/residents", residentRoutes);

app.get("/", (req, res) => {
  res.json({
    message: "EcoTrack Backend API",
    status: "running"
  });
});

app.get("/api/health", async (req, res) => {
  const { error } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .limit(1);

  if (error) {
    console.error("Supabase connection check failed:", error.message);

    return res.status(500).json({
      status: "error",
      message: "Could not verify the Supabase database connection."
    });
  }

  res.json({
    status: "ok",
    server: "running",
    database: "connected"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`EcoTrack backend running at http://localhost:${PORT}`);
});
