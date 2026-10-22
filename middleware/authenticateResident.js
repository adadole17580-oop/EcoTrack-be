
const { supabaseAdmin, supabaseAuth } = require("../config/supabase");

async function authenticateResident(req, res, next) {
  try {
    const authorization = req.headers.authorization;

    if (!authorization || !authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Authentication token is required."
      });
    }

    const accessToken = authorization.slice(7);

    const { data: authData, error: authError } =
      await supabaseAuth.auth.getUser(accessToken);

    if (authError || !authData.user) {
      return res.status(401).json({
        message: "Invalid or expired authentication token."
      });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, user_id, full_name, email, role, phone, barangay_id")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Profile lookup failed:", profileError.message);

      return res.status(500).json({
        message: "Unable to retrieve resident profile."
      });
    }

    if (!profile || profile.role?.toLowerCase() !== "resident") {
      return res.status(403).json({
        message: "Resident access only."
      });
    }

    const { data: resident, error: residentError } = await supabaseAdmin
      .from("users")
      .select("user_id, auth_user_id, barangay_id, role, is_active")
      .eq("auth_user_id", authData.user.id)
      .maybeSingle();

    if (residentError) {
      console.error("Resident lookup failed:", residentError.message);

      return res.status(500).json({
        message: "Unable to retrieve resident account."
      });
    }

    if (!resident || resident.role?.toLowerCase() !== "resident") {
      return res.status(403).json({
        message: "Resident account not found."
      });
    }

    if (!resident.is_active) {
      return res.status(403).json({
        message: "Your account is inactive."
      });
    }

    req.profile = profile;
    req.resident = resident;
    req.authUser = authData.user;

    return next();
  } catch (error) {
    console.error("Resident authentication failed:", error.message);

    return res.status(500).json({
      message: "An unexpected authentication error occurred."
    });
  }
}

module.exports = authenticateResident;
