const express = require("express");
const multer = require("multer");
const { randomUUID } = require("crypto");
const { supabaseAdmin } = require("../config/supabase");
const authenticateResident = require("../middleware/authenticateResident");

const router = express.Router();

const BUCKET_NAME = "report-photos";
const MAX_FILE_SIZE = 8 * 1024 * 1024;

const REPORT_TYPES = [
  "Uncollected Garbage",
  "Overflowing Garbage",
  "Illegal Dumping",
  "Other"
];

const REPORT_COLUMNS = `
  report_id,
  user_id,
  barangay_id,
  report_type,
  description,
  photo_path,
  location_details,
  latitude,
  longitude,
  status,
  created_at
`;

const allowedImageTypes = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1
  },
  fileFilter: (req, file, callback) => {
    if (!allowedImageTypes[file.mimetype]) {
      return callback(new Error("Please upload a JPG, PNG, or WebP image."));
    }

    callback(null, true);
  }
});

function receivePhoto(req, res, next) {
  upload.single("photo")(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          message: "The photo must not exceed 8 MB."
        });
      }

      return res.status(400).json({
        message: "Unable to receive the uploaded photo."
      });
    }

    return res.status(400).json({
      message: error.message || "Invalid photo upload."
    });
  });
}

router.post("/", authenticateResident, receivePhoto, async (req, res) => {
  let uploadedPhotoPath = null;

  try {
    const {
      report_type,
      description,
      location_details,
      latitude,
      longitude
    } = req.body || {};

    if (
      typeof report_type !== "string" ||
      !REPORT_TYPES.includes(report_type)
    ) {
      return res.status(400).json({
        message: "Please select a valid report type."
      });
    }

    if (
      typeof description !== "string" ||
      !description.trim()
    ) {
      return res.status(400).json({
        message: "Report description is required."
      });
    }

    if (description.trim().length > 5000) {
      return res.status(400).json({
        message: "The description cannot exceed 5000 characters."
      });
    }

    if (req.resident.barangay_id == null) {
      return res.status(400).json({
        message: "Your account has no assigned barangay. Please contact the administrator."
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

    const parseCoordinate = (value, min, max) => {
      if (value == null || value === "") {
        return { valid: true, value: null };
      }

      const number = Number(value);

      if (
        !Number.isFinite(number) ||
        number < min ||
        number > max
      ) {
        return { valid: false, value: null };
      }

      return { valid: true, value: number };
    };

    const parsedLatitude = parseCoordinate(latitude, -90, 90);
    const parsedLongitude = parseCoordinate(longitude, -180, 180);

    if (!parsedLatitude.valid || !parsedLongitude.valid) {
      return res.status(400).json({
        message: "Invalid latitude or longitude."
      });
    }

    if (req.file) {
      const extension = allowedImageTypes[req.file.mimetype];
      const filename = `${req.resident.user_id}/${randomUUID()}.${extension}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .upload(filename, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: false
        });

      if (uploadError) {
        console.error("Report photo upload failed:", uploadError.message);

        return res.status(500).json({
          message: "Unable to upload your report photo. Please try again."
        });
      }

      uploadedPhotoPath = filename;
    }

    const { data, error } = await supabaseAdmin
      .from("reports")
      .insert({
        user_id: req.resident.user_id,
        barangay_id: req.resident.barangay_id,
        report_type,
        description: description.trim(),
        photo_path: uploadedPhotoPath,
        location_details: location_details?.trim() || null,
        latitude: parsedLatitude.value,
        longitude: parsedLongitude.value,
        status: "Pending"
      })
      .select(REPORT_COLUMNS)
      .single();

    if (error) {
      console.error("Report creation failed:", error.message);

      if (uploadedPhotoPath) {
        const { error: cleanupError } = await supabaseAdmin.storage
          .from(BUCKET_NAME)
          .remove([uploadedPhotoPath]);

        if (cleanupError) {
          console.error("Failed to clean up uploaded photo:", cleanupError.message);
        }
      }

      return res.status(500).json({
        message: "Unable to submit your report."
      });
    }

    return res.status(201).json({
      message: "Report submitted successfully.",
      report: data
    });
  } catch (error) {
    console.error("Report submission error:", error.message);

    if (uploadedPhotoPath) {
      const { error: cleanupError } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .remove([uploadedPhotoPath]);

      if (cleanupError) {
        console.error("Failed to clean up uploaded photo:", cleanupError.message);
      }
    }

    return res.status(500).json({
      message: "An unexpected error occurred while submitting your report."
    });
  }
});

router.get("/", authenticateResident, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("reports")
      .select(REPORT_COLUMNS)
      .eq("user_id", req.resident.user_id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Report retrieval failed:", error.message);

      return res.status(500).json({
        message: "Unable to load your reports."
      });
    }

    return res.json({
      reports: data ?? []
    });
  } catch (error) {
    console.error("Report retrieval error:", error.message);

    return res.status(500).json({
      message: "An unexpected error occurred while loading your reports."
    });
  }
});


router.get("/:id", authenticateResident, async (req, res) => {
  try {
    const reportId = Number(req.params.id);

    if (!Number.isSafeInteger(reportId) || reportId <= 0) {
      return res.status(400).json({
        message: "Invalid report ID."
      });
    }

    const { data: report, error } = await supabaseAdmin
      .from("reports")
      .select(REPORT_COLUMNS)
      .eq("report_id", reportId)
      .eq("user_id", req.resident.user_id)
      .maybeSingle();

    if (error) {
      console.error("Report lookup failed:", error.message);

      return res.status(500).json({
        message: "Unable to retrieve the report."
      });
    }

    if (!report) {
      return res.status(404).json({
        message: "Report not found."
      });
    }

    let photoUrl = null;

    if (report.photo_path) {
      const { data: signedUrlData, error: signedUrlError } =
        await supabaseAdmin.storage
          .from("report-photos")
          .createSignedUrl(report.photo_path, 3600);

      if (signedUrlError) {
        console.error(
          "Report photo URL generation failed:",
          signedUrlError.message
        );
      } else {
        photoUrl = signedUrlData?.signedUrl ?? null;
      }
    }

    return res.json({
      message: "Report loaded successfully.",
      report: {
        ...report,
        photo_url: photoUrl
      }
    });
  } catch (error) {
    console.error("Report detail error:", error.message);

    return res.status(500).json({
      message: "An unexpected error occurred while retrieving the report."
    });
  }
});

module.exports = router;