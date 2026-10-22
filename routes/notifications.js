
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const router = express.Router();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function authenticateResident(req, res) {
  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith("Bearer ")) {
    res.status(401).json({
      message: "Authentication token is required."
    });
    return null;
  }

  const accessToken = authorization.substring(7).trim();

  if (!accessToken) {
    res.status(401).json({
      message: "Authentication token is required."
    });
    return null;
  }

  const { data: authData, error: authError } =
    await supabaseAuth.auth.getUser(accessToken);

  if (authError || !authData.user) {
    res.status(401).json({
      message: "Invalid or expired authentication token."
    });
    return null;
  }

  const authUserId = authData.user.id;

  const { data: resident, error } = await supabaseAdmin
    .from("users")
    .select("user_id, auth_user_id, role, is_active")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (error) {
    console.error("Resident lookup failed:", error.message);
    res.status(500).json({
      message: "Unable to load resident information."
    });
    return null;
  }

  if (!resident) {
    res.status(404).json({
      message: "Resident account mapping not found."
    });
    return null;
  }

  if (resident.role?.toLowerCase() !== "resident") {
    res.status(403).json({
      message: "This endpoint is for residents only."
    });
    return null;
  }

  if (resident.is_active === false) {
    res.status(403).json({
      message: "This resident account is inactive."
    });
    return null;
  }

  return resident;
}

router.get("/", async (req, res) => {
  try {
    const resident = await authenticateResident(req, res);

    if (!resident) return;

    const { data: notifications, error } = await supabaseAdmin
      .from("notifications")
      .select(
        "notification_id, user_id, report_id, title, message, type, is_read, created_at, notification_type, reference_type, reference_id"
      )
      .eq("user_id", resident.user_id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Notifications lookup failed:", error.message);
      return res.status(500).json({
        message: "Unable to load your notifications."
      });
    }

    return res.status(200).json({
      message: "Notifications loaded successfully.",
      notifications: notifications || []
    });
  } catch (error) {
    console.error("Notifications error:", error.message);
    return res.status(500).json({
      message: "An unexpected server error occurred."
    });
  }
});

module.exports = router;
