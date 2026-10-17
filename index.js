
require("dotenv").config();
const authRoutes = require("./routes/auth");

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase environment variables in .env");
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);

app.get("/", (req, res) => {
  res.json({
    message: "EcoTrack Backend API",
    status: "running"
  });
});

app.get("/api/health", async (req, res) => {
  const { error } = await supabase
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
    console.log(`Server running on port ${PORT}`);
});

