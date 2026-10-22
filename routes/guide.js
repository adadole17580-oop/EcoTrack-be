const express = require("express");
const { supabaseAdmin } = require("../config/supabase");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("segregation_guide")
      .select("guide_id, waste_type, description, disposal_method")
      .order("guide_id", { ascending: true });

    if (error) {
      console.error("Waste guide lookup failed:", error.message);

      return res.status(500).json({
        message: "Unable to load waste segregation guide."
      });
    }

    return res.status(200).json({
      message: "Waste segregation guide loaded successfully.",
      guides: data || []
    });
  } catch (error) {
    console.error("Waste guide error:", error.message);

    return res.status(500).json({
      message: "An unexpected server error occurred."
    });
  }
});

module.exports = router;