
const express = require("express");
const { supabaseAdmin } = require("../config/supabase");
const authenticateResident = require("../middleware/authenticateResident");

const router = express.Router();

router.get("/", authenticateResident, async (req, res) => {
  try {
    const resident = req.resident;

    const [
      totalReportsResult,
      pendingReportsResult,
      schedulesResult
    ] = await Promise.all([
      supabaseAdmin
        .from("reports")
        .select("report_id", { count: "exact", head: true })
        .eq("user_id", resident.user_id),

      supabaseAdmin
        .from("reports")
        .select("report_id", { count: "exact", head: true })
        .eq("user_id", resident.user_id)
        .in("status", ["Pending", "In Progress"]),

      supabaseAdmin
        .from("schedules")
        .select("schedule_id")
        .eq("barangay_id", resident.barangay_id)
    ]);

    const queryError =
      totalReportsResult.error ||
      pendingReportsResult.error ||
      schedulesResult.error;

    if (queryError) {
      console.error("Dashboard query failed:", queryError.message);

      return res.status(500).json({
        message: "Unable to load resident dashboard."
      });
    }

    return res.json({
      message: "Resident dashboard loaded successfully.",
      user: {
        id: req.profile.id,
        full_name: req.profile.full_name,
        email: req.profile.email,
        role: req.profile.role,
        phone: req.profile.phone,
        barangay: req.profile.barangay
      },
      dashboard: {
        upcoming_collections: schedulesResult.data?.length ?? 0,
        total_reports: totalReportsResult.count ?? 0,
        pending_reports: pendingReportsResult.count ?? 0
      }
    });
  } catch (error) {
    console.error("Dashboard error:", error.message);

    return res.status(500).json({
      message: "An unexpected error occurred while loading the dashboard."
    });
  }
});

module.exports = router;
