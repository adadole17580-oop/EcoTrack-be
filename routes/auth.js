
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

router.post("/register", async (req, res) => {
  try {
    const { full_name, email, password, phone, barangay } = req.body;

    if (
      typeof full_name !== "string" ||
      !full_name.trim() ||
      typeof email !== "string" ||
      !email.trim() ||
      typeof password !== "string" ||
      password.length < 8
    ) {
      return res.status(400).json({
        message: "Full name, valid email, and password of at least 8 characters are required."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const { data, error } = await supabaseAuth.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
            emailRedirectTo: "ecotrack://auth/callback",
        data: {
          full_name: full_name.trim()
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

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({
        full_name: full_name.trim(),
        email: normalizedEmail,
        phone: typeof phone === "string" && phone.trim()
          ? phone.trim()
          : null,
        barangay: typeof barangay === "string" && barangay.trim()
          ? barangay.trim()
          : null
      })
      .eq("id", data.user.id);

    if (profileError) {
      console.error("Profile update failed:", profileError.message);

      return res.status(500).json({
        message: "Account created, but profile setup failed."
      });
    }

    return res.status(201).json({
      message: "Registration request received. Check your email for a confirmation link.",
      user: {
        id: data.user.id,
        email: data.user.email,
        full_name: full_name.trim(),
        role: "resident"
      }
    });
  } catch (error) {
    console.error("Registration error:", error.message);

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
      console.error("Login failed:", error?.message);

      return res.status(401).json({
        message: error?.message || "Supabase did not return a valid session."
      });
    }

    if (!data.user?.email_confirmed_at) {
      return res.status(403).json({
        message: "Please confirm your email before logging in."
      });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, role, phone, barangay")
      .eq("id", data.user.id)
      .single();

    if (profileError || !profile) {
      console.error("Profile lookup failed:", profileError?.message);

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
    console.error("Login error:", error.message);

    return res.status(500).json({
      message: "An unexpected server error occurred."
    });
  }
});

module.exports = router;
