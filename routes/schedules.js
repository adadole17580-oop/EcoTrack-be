
const express = require("express");
const { supabaseAdmin } = require("../config/supabase");
const authenticateResident = require("../middleware/authenticateResident");

const router = express.Router();

router.get("/", authenticateResident, async (req, res) => {
  try {
    const resident = req.resident;

    if (resident.barangay_id == null) {
      return res.status(200).json({
        message: "No barangay is assigned to this resident.",
        schedules: []
      });
    }

    const { data: schedules, error } = await supabaseAdmin
      .from("schedules")
      .select("schedule_id, barangay_id, collection_day, collection_time, waste_type")
      .eq("barangay_id", resident.barangay_id)
      .order("schedule_id", { ascending: true });

    if (error) {
      console.error("Schedule lookup failed:", error.message);

      return res.status(500).json({
        message: "Unable to load collection schedules."
      });
    }

    return res.status(200).json({
      message: "Collection schedules loaded successfully.",
      schedules: schedules || []
    });
  } catch (error) {
    console.error("Schedule lookup error:", error.message);

    return res.status(500).json({
      message: "An unexpected server error occurred."
    });
  }
});

module.exports = router;
