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

const REPORT_TYPES = [
  "Uncollected Garbage",
  "Overflowing Garbage",
  "Illegal Dumping",
  "Other"
];

const REPORT_COLUMNS = [
  "report_id",
  "user_id",
  "barangay_id",
  "report_type",
  "description",
  "photo_path",
  "location_details",
  "latitude",
  "longitude",
  "status",
  "created_at",
  "updated_at"
].join(", ");

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

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select(
      "id, user_id, full_name, email, role, phone, barangay_id, profile_image, is_active, address, created_at, updated_at"
    )
    .eq("id", authUserId)
    .maybeSingle();

  if (profileError) {
    console.error("Profile lookup failed:", profileError.message);
    res.status(500).json({
      message: "Unable to load user profile."
    });
    return null;
  }

  if (!profile) {
    res.status(404).json({
      message: "User profile not found."
    });
    return null;
  }

  if (profile.role?.toLowerCase() !== "resident") {
    res.status(403).json({
      message: "This endpoint is for residents only."
    });
    return null;
  }

  const { data: resident, error: residentError } = await supabaseAdmin
    .from("users")
    .select(
      "user_id, auth_user_id, full_name, email, contact_number, barangay_id, role, is_active, address, profile_image, created_at"
    )
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (residentError) {
    console.error("Resident lookup failed:", residentError.message);
    res.status(500).json({
      message: "Unable to load resident information."
    });
    return null;
  }

  if (!resident) {
    res.status(404).json({
      message: "Resident account mapping not found in users table."
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

  return { profile, resident };
}

router.get("/dashboard", async (req, res) => {
  try {
    const authenticated = await authenticateResident(req, res);

    if (!authenticated) return;

    const { resident } = authenticated;

    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select(`
        user_id,
        auth_user_id,
        full_name,
        email,
        contact_number,
        address,
        barangay_id,
        role
      `)
      .eq("user_id", resident.user_id)
      .single();

    if (userError || !user) {
      console.error("Resident profile lookup failed:", userError?.message);
      return res.status(500).json({
        message: "Unable to load resident profile."
      });
    }

    let barangayName = null;

    if (user.barangay_id != null) {
      const { data: barangay, error: barangayError } =
        await supabaseAdmin
          .from("barangays")
          .select("barangay_name")
          .eq("barangay_id", user.barangay_id)
          .maybeSingle();

      if (barangayError) {
        console.error("Barangay lookup failed:", barangayError.message);
        return res.status(500).json({
          message: "Unable to load resident barangay."
        });
      }

      barangayName = barangay?.barangay_name ?? null;
    }

    const { count: totalReports, error: totalReportsError } =
      await supabaseAdmin
        .from("reports")
        .select("report_id", { count: "exact", head: true })
        .eq("user_id", resident.user_id);

    if (totalReportsError) {
      console.error("Report count failed:", totalReportsError.message);
      return res.status(500).json({
        message: "Unable to load report summary."
      });
    }

    const { count: pendingReports, error: pendingReportsError } =
      await supabaseAdmin
        .from("reports")
        .select("report_id", { count: "exact", head: true })
        .eq("user_id", resident.user_id)
        .in("status", ["Pending", "In Progress"]);

    if (pendingReportsError) {
      console.error("Pending report count failed:", pendingReportsError.message);
      return res.status(500).json({
        message: "Unable to load pending report summary."
      });
    }

    let upcomingCollections = 0;

    if (user.barangay_id != null) {
      const { data: schedules, error: schedulesError } =
        await supabaseAdmin
          .from("schedules")
          .select("schedule_id, collection_day, collection_time, waste_type")
          .eq("barangay_id", user.barangay_id);

      if (schedulesError) {
        console.error("Schedule lookup failed:", schedulesError.message);
        return res.status(500).json({
          message: "Unable to load collection schedule."
        });
      }

      const dayNames = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday"
      ];

      const now = new Date();

      upcomingCollections = (schedules || []).filter((schedule) => {
        const targetDay = dayNames.indexOf(schedule.collection_day);

        if (targetDay === -1) return false;

        const daysUntil = (targetDay - now.getDay() + 7) % 7;

        if (daysUntil > 0) return true;
        if (!schedule.collection_time) return true;

        const [hours, minutes, seconds = "0"] =
          schedule.collection_time.split(":");

        const scheduledTime = new Date(now);

        scheduledTime.setHours(
          Number(hours),
          Number(minutes),
          Number(seconds.split(".")[0]),
          0
        );

        return scheduledTime >= now;
      }).length;
    }

    return res.status(200).json({
      message: "Resident dashboard loaded successfully.",
      user: {
        id: user.auth_user_id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        phone: user.contact_number,
        address: user.address,
        barangay: barangayName
      },
      dashboard: {
        upcoming_collections: upcomingCollections,
        total_reports: totalReports ?? 0,
        pending_reports: pendingReports ?? 0
      }
    });
  } catch (error) {
    console.error("Resident dashboard error:", error.message);
    return res.status(500).json({
      message: "An unexpected server error occurred."
    });
  }
});

router.post("/reports", async (req, res) => {
  try {
    const authenticated = await authenticateResident(req, res);

    if (!authenticated) return;

    const { resident } = authenticated;

    const {
      report_type,
      description,
      photo_path,
      location_details,
      latitude,
      longitude
    } = req.body || {};

    if (
      typeof report_type !== "string" ||
      !REPORT_TYPES.includes(report_type)
    ) {
      return res.status(400).json({
        message: "Please provide a valid report_type.",
        allowed_values: REPORT_TYPES
      });
    }

    if (
      typeof description !== "string" ||
      !description.trim()
    ) {
      return res.status(400).json({
        message: "A report description is required."
      });
    }

    if (description.trim().length > 5000) {
      return res.status(400).json({
        message: "The description cannot exceed 5000 characters."
      });
    }

    if (resident.barangay_id == null) {
      return res.status(400).json({
        message: "Your account has no assigned barangay. Please contact the administrator."
      });
    }

    if (
      photo_path != null &&
      (typeof photo_path !== "string" || photo_path.length > 1000)
    ) {
      return res.status(400).json({
        message: "Invalid photo_path."
      });
    }

    if (
      location_details != null &&
      (typeof location_details !== "string" ||
        location_details.length > 500)
    ) {
      return res.status(400).json({
        message: "Location details cannot exceed 500 characters."
      });
    }

    const validCoordinate = (value, min, max) =>
      value == null ||
      (typeof value === "number" &&
        Number.isFinite(value) &&
        value >= min &&
        value <= max);

    if (
      !validCoordinate(latitude, -90, 90) ||
      !validCoordinate(longitude, -180, 180)
    ) {
      return res.status(400).json({
        message: "Invalid latitude or longitude."
      });
    }

    const newReport = {
      user_id: resident.user_id,
      barangay_id: resident.barangay_id,
      report_type,
      description: description.trim(),
      photo_path: photo_path || null,
      location_details: location_details?.trim() || null,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      status: "Pending"
    };

    const { data: report, error } = await supabaseAdmin
      .from("reports")
      .insert(newReport)
      .select(REPORT_COLUMNS)
      .single();

    if (error) {
      console.error("Report creation failed:", error.message);
      return res.status(500).json({
        message: "Unable to submit your report."
      });
    }

    return res.status(201).json({
      message: "Report submitted successfully.",
      report
    });
  } catch (error) {
    console.error("Report creation error:", error.message);
    return res.status(500).json({
      message: "An unexpected server error occurred."
    });
  }
});

router.get("/reports", async (req, res) => {
  try {
    const authenticated = await authenticateResident(req, res);

    if (!authenticated) return;

    const { resident } = authenticated;

    const { data: reports, error } = await supabaseAdmin
      .from("reports")
      .select(REPORT_COLUMNS)
      .eq("user_id", resident.user_id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Reports lookup failed:", error.message);
      return res.status(500).json({
        message: "Unable to load your reports."
      });
    }

    return res.status(200).json({
      message: "Reports loaded successfully.",
      reports: reports || []
    });
  } catch (error) {
    console.error("Reports lookup error:", error.message);
    return res.status(500).json({
      message: "An unexpected server error occurred."
    });
  }
});

router.get("/reports/:id", async (req, res) => {
  try {
    const authenticated = await authenticateResident(req, res);

    if (!authenticated) return;

    const { resident } = authenticated;
    const reportId = req.params.id;

    if (!/^\d+$/.test(reportId)) {
      return res.status(400).json({
        message: "Report ID must be a number."
      });
    }

    const { data: report, error } = await supabaseAdmin
      .from("reports")
      .select(REPORT_COLUMNS)
      .eq("report_id", Number(reportId))
      .eq("user_id", resident.user_id)
      .maybeSingle();

    if (error) {
      console.error("Report lookup failed:", error.message);
      return res.status(500).json({
        message: "Unable to load this report."
      });
    }

    if (!report) {
      return res.status(404).json({
        message: "Report not found."
      });
    }

    return res.status(200).json({
      message: "Report loaded successfully.",
      report
    });
  } catch (error) {
    console.error("Report lookup error:", error.message);
    return res.status(500).json({
      message: "An unexpected server error occurred."
    });
  }
});

router.get("/profile", async (req, res) => {
  try {
    const authenticated = await authenticateResident(req, res);

    if (!authenticated) return;

    const { resident } = authenticated;

    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select(
        "user_id, auth_user_id, full_name, email, role, contact_number, barangay_id, profile_image, is_active, address, created_at"
      )
      .eq("user_id", resident.user_id)
      .eq("auth_user_id", resident.auth_user_id)
      .single();

    if (userError || !user) {
      console.error("Resident profile lookup failed:", userError?.message);

      return res.status(500).json({
        message: "Unable to load your profile."
      });
    }

    let barangay = null;

    if (user.barangay_id != null) {
      const { data: barangayData, error: barangayError } =
        await supabaseAdmin
          .from("barangays")
          .select("barangay_id, barangay_name, address, phone_number, email, captain_name")
          .eq("barangay_id", user.barangay_id)
          .maybeSingle();

      if (barangayError) {
        console.error("Barangay lookup failed:", barangayError.message);

        return res.status(500).json({
          message: "Unable to load your barangay information."
        });
      }

      barangay = barangayData;
    }

    return res.status(200).json({
      message: "Resident profile loaded successfully.",
      user,
      barangay
    });
  } catch (error) {
    console.error("Resident profile error:", error.message);

    return res.status(500).json({
      message: "An unexpected server error occurred."
    });
  }
});

router.put("/profile", async (req, res) => {
  try {
    const authenticated = await authenticateResident(req, res);

    if (!authenticated) return;

    const { profile, resident } = authenticated;
    const { full_name, contact_number, barangay_id, address } = req.body || {};

    if (typeof full_name !== "string" || !full_name.trim()) {
      return res.status(400).json({
        message: "Full name is required."
      });
    }

    if (full_name.trim().length > 150) {
      return res.status(400).json({
        message: "Full name cannot exceed 150 characters."
      });
    }

    if (
      contact_number !== undefined &&
      contact_number !== null &&
      typeof contact_number !== "string"
    ) {
      return res.status(400).json({
        message: "Contact number must be text."
      });
    }

    if (
      typeof contact_number === "string" &&
      contact_number.trim().length > 30
    ) {
      return res.status(400).json({
        message: "Contact number cannot exceed 30 characters."
      });
    }

    if (
      address !== undefined &&
      address !== null &&
      typeof address !== "string"
    ) {
      return res.status(400).json({
        message: "Address must be text."
      });
    }

    let selectedBarangayId = resident.barangay_id;

    if (barangay_id !== undefined) {
      if (barangay_id === null || barangay_id === "") {
        selectedBarangayId = null;
      } else {
        const parsedBarangayId = Number(barangay_id);

        if (!Number.isInteger(parsedBarangayId) || parsedBarangayId <= 0) {
          return res.status(400).json({
            message: "Please select a valid barangay."
          });
        }

        const { data: selectedBarangay, error: barangayError } =
          await supabaseAdmin
            .from("barangays")
            .select("barangay_id")
            .eq("barangay_id", parsedBarangayId)
            .maybeSingle();

        if (barangayError) {
          console.error("Barangay validation failed:", barangayError.message);
          return res.status(500).json({
            message: "Unable to validate the selected barangay."
          });
        }

        if (!selectedBarangay) {
          return res.status(400).json({
            message: "The selected barangay does not exist."
          });
        }

        selectedBarangayId = parsedBarangayId;
      }
    }

    const updates = {
      full_name: full_name.trim(),
      contact_number:
        contact_number === undefined
          ? resident.contact_number ?? profile.phone ?? null
          : typeof contact_number === "string"
            ? contact_number.trim() || null
            : null,
      address:
        address === undefined
          ? resident.address ?? null
          : typeof address === "string"
            ? address.trim() || null
            : null,
      barangay_id: selectedBarangayId
    };

    const { data: updatedUser, error: userUpdateError } =
      await supabaseAdmin
        .from("users")
        .update(updates)
        .eq("user_id", resident.user_id)
        .eq("auth_user_id", profile.id)
        .select(
          "user_id, auth_user_id, full_name, email, contact_number, address, profile_image, role, barangay_id, is_active, created_at"
        )
        .single();

    if (userUpdateError || !updatedUser) {
      console.error("Resident users update failed:", userUpdateError?.message);
      return res.status(500).json({
        message: "Unable to update your profile."
      });
    }

    const { data: updatedProfile, error: profileFetchError } =
      await supabaseAdmin
        .from("profiles")
        .select("id, user_id, full_name, email, role, phone, barangay_id, profile_image, is_active, address, created_at, updated_at")
        .eq("id", profile.id)
        .single();

    if (profileFetchError || !updatedProfile) {
      console.error(
        "Synchronized profile lookup failed:",
        profileFetchError?.message
      );

      return res.status(500).json({
        message: "Your profile was updated, but we could not retrieve the synchronized profile."
      });
    }

    let barangay = null;

    if (updatedUser.barangay_id != null) {
      const { data: barangayData, error: barangayError } =
        await supabaseAdmin
          .from("barangays")
          .select("barangay_id, barangay_name")
          .eq("barangay_id", updatedUser.barangay_id)
          .maybeSingle();

      if (barangayError) {
        console.error("Updated barangay lookup failed:", barangayError.message);
      } else {
        barangay = barangayData;
      }
    }

    return res.status(200).json({
      message: "Profile updated successfully.",
      user: updatedUser,
      profile: updatedProfile,
      barangay
    });
  } catch (error) {
    console.error("Resident profile update error:", error.message);

    return res.status(500).json({
      message: "An unexpected server error occurred."
    });
  }
});

router.put("/change-password", async (req, res) => {
  try {
    const authenticated = await authenticateResident(req, res);

    if (!authenticated) return;

    const { profile } = authenticated;
    const { current_password, new_password } = req.body;

    if (
      typeof current_password !== "string" ||
      !current_password ||
      typeof new_password !== "string" ||
      !new_password
    ) {
      return res.status(400).json({
        message: "Current password and new password are required."
      });
    }

    if (new_password.length < 8) {
      return res.status(400).json({
        message: "Your new password must be at least 8 characters."
      });
    }

    if (!/[0-9]/.test(new_password) || !/[^A-Za-z0-9]/.test(new_password)) {
      return res.status(400).json({
        message: "Your new password must include a number and a symbol."
      });
    }

    if (current_password === new_password) {
      return res.status(400).json({
        message: "Your new password must be different from your current password."
      });
    }

    const { data: signInData, error: signInError } =
      await supabaseAuth.auth.signInWithPassword({
        email: profile.email,
        password: current_password
      });

    if (signInError || !signInData.user) {
      return res.status(400).json({
        message: "Your current password is incorrect."
      });
    }

    const { error: updateError } =
      await supabaseAdmin.auth.admin.updateUserById(
        signInData.user.id,
        { password: new_password }
      );

    if (updateError) {
      console.error("Resident password update failed:", updateError.message);

      return res.status(500).json({
        message: "Unable to update your password. Please try again."
      });
    }

    return res.status(200).json({
      message: "Password updated successfully."
    });
  } catch (error) {
    console.error("Resident change-password error:", error.message);

    return res.status(500).json({
      message: "An unexpected server error occurred."
    });
  }
});

router.get("/schedules", async (req, res) => {
  try {
    const authenticated = await authenticateResident(req, res);

    if (!authenticated) return;

    const { resident } = authenticated;

    if (resident.barangay_id == null) {
      return res.status(200).json({
        message: "Schedules loaded successfully.",
        schedules: []
      });
    }

    const { data: schedules, error } = await supabaseAdmin
      .from("schedules")
      .select("schedule_id, barangay_id, collection_day, collection_time, waste_type, schedule_group_id, collector_id, custom_address"
      )
      .eq("barangay_id", resident.barangay_id)
      .order("schedule_id", { ascending: true });

    if (error) {
      console.error("Resident schedules lookup failed:", error.message);
      return res.status(500).json({
        message: "Unable to load collection schedules."
      });
    }

    return res.status(200).json({
      message: "Schedules loaded successfully.",
      schedules: schedules || []
    });
  } catch (error) {
    console.error("Resident schedules error:", error.message);
    return res.status(500).json({
      message: "An unexpected server error occurred."
    });
  }
});

router.get("/barangays", async (req, res) => {
  try {
    const authenticated = await authenticateResident(req, res);

    if (!authenticated) return;

    const { data: barangays, error } = await supabaseAdmin
      .from("barangays")
      .select("barangay_id, barangay_name")
      .order("barangay_name", { ascending: true });

    if (error) {
      console.error("Barangays lookup failed:", error.message);
      return res.status(500).json({
        message: "Unable to load barangays."
      });
    }

    return res.status(200).json({
      message: "Barangays loaded successfully.",
      barangays: barangays || []
    });
  } catch (error) {
    console.error("Barangays error:", error.message);
    return res.status(500).json({
      message: "An unexpected server error occurred."
    });
  }
});

router.delete("/account", async (req, res) => {
  try {
    const authenticated = await authenticateResident(req, res);

    if (!authenticated) return;

    const { profile, resident } = authenticated;
    const authUserId = profile.id;

    const { data: reports, error: reportsError } = await supabaseAdmin
      .from("reports")
      .select("report_id, photo_path")
      .eq("user_id", resident.user_id);

    if (reportsError) {
      console.error("Account deletion report lookup failed:", reportsError.message);
      return res.status(500).json({
        message: "Unable to prepare your reports for account deletion."
      });
    }

    const reportPhotoPaths = (reports || [])
      .map((report) => report.photo_path)
      .filter((path) => typeof path === "string" && path.trim());

    if (reportPhotoPaths.length > 0) {
      const { error: photoRemovalError } = await supabaseAdmin
        .storage
        .from("report-photos")
        .remove(reportPhotoPaths);

      if (photoRemovalError) {
        console.error("Report photo removal failed:", photoRemovalError.message);
        return res.status(500).json({
          message: "Unable to remove report photos. Your account has not been deleted."
        });
      }
    }

    const { error: reportUpdateError } = await supabaseAdmin
      .from("reports")
      .update({
        user_id: null,
        description: null,
        photo_path: null,
        location_details: null,
        latitude: null,
        longitude: null
      })
      .eq("user_id", resident.user_id);

    if (reportUpdateError) {
      console.error("Report anonymization failed:", reportUpdateError.message);
      return res.status(500).json({
        message: "Report photos were removed, but report anonymization failed. Please contact the administrator before retrying."
      });
    }

    const { error: notificationsError } = await supabaseAdmin
      .from("notifications")
      .delete()
      .eq("user_id", resident.user_id);

    if (notificationsError) {
      console.error("Resident notification cleanup failed:", notificationsError.message);
      return res.status(500).json({
        message: "Reports were anonymized, but notification cleanup failed. Please contact the administrator to complete account deletion."
      });
    }

    const { error: userDeleteError } = await supabaseAdmin
      .from("users")
      .delete()
      .eq("user_id", resident.user_id)
      .eq("auth_user_id", authUserId);

    if (userDeleteError) {
      console.error("Resident database account deletion failed:", userDeleteError.message);
      return res.status(500).json({
        message: "Reports were anonymized, but account cleanup failed. Please contact the administrator to complete deletion."
      });
    }

    const { error: profileDeleteError } = await supabaseAdmin
      .from("profiles")
      .delete()
      .eq("id", authUserId);

    if (profileDeleteError) {
      console.error("Resident profile deletion failed:", profileDeleteError.message);
      return res.status(500).json({
        message: "Reports were anonymized, but profile cleanup failed. Please contact the administrator to complete deletion."
      });
    }

    const { error: authDeleteError } =
      await supabaseAdmin.auth.admin.deleteUser(authUserId);

    if (authDeleteError) {
      console.error("Resident Auth account deletion failed:", authDeleteError.message);
      return res.status(500).json({
        message: "Reports and profile data were cleaned up, but authentication account deletion failed. Please contact the administrator to complete deletion."
      });
    }

    return res.status(200).json({
      message: "Your account was deleted. Administrative report records were retained with identifying details removed."
    });
  } catch (error) {
    console.error("Resident account deletion error:", error.message);
    return res.status(500).json({
      message: "An unexpected error occurred while deleting your account. Please contact the administrator if you are unable to sign in."
    });
  }
});

module.exports = router;