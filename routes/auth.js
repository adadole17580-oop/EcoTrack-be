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

function logDatabaseError(label, error) {
  console.error(label, {
    message: error?.message,
    code: error?.code,
    details: error?.details,
    hint: error?.hint
  });
}

router.get("/barangays", async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("barangays")
      .select("barangay_id, barangay_name")
      .order("barangay_name", { ascending: true });

    if (error) {
      logDatabaseError("Barangays lookup failed:", error);

      return res.status(500).json({
        message: "Unable to load barangays."
      });
    }

    return res.status(200).json({
      barangays: data || []
    });
  } catch (error) {
    logDatabaseError("Barangays endpoint error:", error);

    return res.status(500).json({
      message: "An unexpected server error occurred."
    });
  }
});

router.post("/register", async (req, res) => {
  try {
    const {
      full_name,
      email,
      password,
      phone,
      barangay_id,
      address
    } = req.body;

    if (
      typeof full_name !== "string" ||
      !full_name.trim() ||
      typeof email !== "string" ||
      !email.trim() ||
      typeof password !== "string" ||
      password.length < 8 ||
      !Number.isInteger(Number(barangay_id)) ||
      Number(barangay_id) <= 0 ||
      typeof address !== "string" ||
      !address.trim()
    ) {
      return res.status(400).json({
        message:
          "Full name, valid email, password of at least 8 characters, barangay, and home address are required."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = full_name.trim();
    const normalizedPhone =
      typeof phone === "string" && phone.trim()
        ? phone.trim()
        : null;
    const normalizedBarangayId = Number(barangay_id);
    const normalizedAddress = address.trim();

    const { data: barangay, error: barangayError } =
      await supabaseAdmin
        .from("barangays")
        .select("barangay_id")
        .eq("barangay_id", normalizedBarangayId)
        .maybeSingle();

    if (barangayError) {
      logDatabaseError("Barangay validation failed:", barangayError);

      return res.status(500).json({
        message: "Unable to validate the selected barangay."
      });
    }

    if (!barangay) {
      return res.status(400).json({
        message: "Please select a valid barangay."
      });
    }

    const { data, error } = await supabaseAuth.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: "ecotrack://auth/callback",
        data: {
          full_name: normalizedName
        }
      }
    });

    if (error) {
      return res.status(400).json({
        message: error.message
      });
    }

    if (!data.user) {
      return res.status(400).json({
        message: "Registration could not be completed."
      });
    }

    const userId = data.user.id;

    const { data: existingUser, error: lookupError } =
      await supabaseAdmin
        .from("users")
        .select("user_id")
        .eq("auth_user_id", userId)
        .maybeSingle();

    if (lookupError) {
      logDatabaseError("User lookup failed:", lookupError);

      return res.status(500).json({
        message: "Account created, but resident record lookup failed."
      });
    }

    const userRecord = {
      auth_user_id: userId,
      full_name: normalizedName,
      email: normalizedEmail,
      role: "Resident",
      contact_number: normalizedPhone,
      barangay_id: normalizedBarangayId,
      address: normalizedAddress
    };

    const userResult = existingUser
      ? await supabaseAdmin
          .from("users")
          .update(userRecord)
          .eq("user_id", existingUser.user_id)
          .select("user_id")
      : await supabaseAdmin
          .from("users")
          .insert(userRecord)
          .select("user_id");

    if (userResult.error) {
      logDatabaseError("Users table operation failed:", userResult.error);

      return res.status(500).json({
        message: "Account created, but resident record setup failed."
      });
    }

    return res.status(201).json({
      message:
        "Registration request received. Check your email for a confirmation link.",
      user: {
        id: userId,
        email: normalizedEmail,
        full_name: normalizedName,
        role: "Resident",
        barangay_id: normalizedBarangayId,
        address: normalizedAddress
      }
    });
  } catch (error) {
    logDatabaseError("Registration error:", error);

    return res.status(500).json({
      message: "An unexpected server error occurred."
    });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== "string" ||
      !email.trim() ||
      typeof password !== "string" ||
      !password
    ) {
      return res.status(400).json({
        message: "Email and password are required."
      });
    }

    const { data, error } = await supabaseAuth.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password
    });

    if (error || !data.user || !data.session) {
      return res.status(401).json({
        message: error?.message || "Supabase did not return a valid session."
      });
    }

    if (!data.user.email_confirmed_at) {
      return res.status(403).json({
        message: "Please confirm your email before logging in."
      });
    }


    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select(
        "id, user_id, full_name, email, role, phone, barangay_id, profile_image, is_active, address, created_at, updated_at"
      )
      .eq("id", data.user.id)
      .single();


    if (profileError || !profile) {
      logDatabaseError("Profile lookup failed:", profileError);

      return res.status(500).json({
        message: "Could not retrieve the user profile."
      });
    }

    return res.status(200).json({
      message: "Login successful.",
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      user: profile
    });
  } catch (error) {
    logDatabaseError("Login error:", error);

    return res.status(500).json({
      message: "An unexpected server error occurred."
    });
  }
});

router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (typeof email !== "string" || !email.trim()) {
      return res.status(400).json({
        message: "Email is required."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const { error } = await supabaseAuth.auth.resetPasswordForEmail(
      normalizedEmail
    );

    if (error) {
      console.error("Password recovery request failed:", error.message);

      const status = /rate limit|too many requests/i.test(error.message)
        ? 429
        : 400;

      return res.status(status).json({
        message: error.message
      });
    }

    return res.status(200).json({
      message: "If the account is eligible, a password recovery email will be sent."
    });
  } catch (error) {
    logDatabaseError("Forgot password error:", error);

    return res.status(500).json({
      message: "Unable to process the password recovery request."
    });
  }
});


router.post("/verify-recovery-otp", async (req, res) => {
  try {
    const { email, token } = req.body;

    if (
      typeof email !== "string" ||
      !email.trim() ||
      typeof token !== "string" ||
      !/^\d{6}$/.test(token.trim())
    ) {
      return res.status(400).json({
        message: "A valid email and 6-digit verification code are required."
      });
    }

    const { data, error } = await supabaseAuth.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: token.trim(),
      type: "recovery"
    });

    if (error || !data.session) {
      return res.status(400).json({
        message: "The verification code is invalid or expired. Please try again."
      });
    }

    return res.status(200).json({
      message: "Verification successful.",
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token
    });
  } catch (error) {
    logDatabaseError("Recovery OTP verification error:", error);

    return res.status(500).json({
      message: "Unable to verify the code. Please try again."
    });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { new_password } = req.body;
    const authorization = req.headers.authorization;

    if (
      typeof new_password !== "string" ||
      new_password.length < 8
    ) {
      return res.status(400).json({
        message: "The new password must contain at least 8 characters."
      });
    }

    if (
      typeof authorization !== "string" ||
      !authorization.startsWith("Bearer ")
    ) {
      return res.status(401).json({
        message: "A verified password recovery session is required."
      });
    }

    const accessToken = authorization.slice(7).trim();

    if (!accessToken) {
      return res.status(401).json({
        message: "A verified password recovery session is required."
      });
    }

    const { data: userData, error: userError } =
      await supabaseAuth.auth.getUser(accessToken);

    if (userError || !userData.user) {
      return res.status(401).json({
        message: "Your recovery session is invalid or expired. Request a new code."
      });
    }

    const { error: updateError } =
      await supabaseAdmin.auth.admin.updateUserById(
        userData.user.id,
        {
          password: new_password
        }
      );

    if (updateError) {
      console.error("Password update failed:", updateError.message);

      return res.status(400).json({
        message: updateError.message
      });
    }

    return res.status(200).json({
      message: "Password reset successful. You can now log in with your new password."
    });
  } catch (error) {
    logDatabaseError("Reset password error:", error);

    return res.status(500).json({
      message: "Unable to reset your password."
    });
  }
});

module.exports = router;