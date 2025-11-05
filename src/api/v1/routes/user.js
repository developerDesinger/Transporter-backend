const express = require("express");
const multer = require("multer");
const UserController = require("../controller/UserController");
const MasterDataController = require("../controller/MasterDataController");
const { isAuthenticated, restrictTo } = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");

const router = express.Router();

// Configure multer for document uploads (PDF, JPG, PNG) - memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit per file
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "application/pdf",
      "image/jpeg",
      "image/jpg",
      "image/png",
    ];
    const allowedExtensions = [".pdf", ".jpg", ".jpeg", ".png"];
    const fileExtension = file.originalname
      .toLowerCase()
      .substring(file.originalname.lastIndexOf("."));

    if (
      allowedMimes.includes(file.mimetype) ||
      allowedExtensions.includes(fileExtension)
    ) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Only PDF, JPG, JPEG, and PNG files are allowed for document uploads"
        ),
        false
      );
    }
  },
});

// Public routes
router.post("/create", UserController.createUser); // Public registration (admin creation handled in controller)
router.post("/login", UserController.loginUser);
router.post("/social-login", UserController.socialLoginUser);
router.post("/verify-otp", UserController.verifyOtp);
router.post("/resend-otp", UserController.resendOtp);
router.post("/forgot-password", UserController.forgotPassword); // Public forgot password
router.post("/update-password", UserController.updatePassword);

// Driver Application Submission (Public - No Auth Required)
// Endpoint 1: Initial Application - POST /api/v1/users/application
router.post(
  "/application",
  MasterDataController.submitDriverApplication // Public endpoint - no authentication required
);

// Endpoint 2: Driver Induction - POST /api/v1/users/induction
router.post(
  "/induction",
  (req, res, next) => {
    upload.fields([
      { name: "motorInsuranceDocument", maxCount: 1 },
      { name: "marineCargoInsuranceDocument", maxCount: 1 },
      { name: "publicLiabilityDocument", maxCount: 1 },
      { name: "workersCompDocument", maxCount: 1 },
      { name: "licenseDocumentFront", maxCount: 1 },
      { name: "licenseDocumentBack", maxCount: 1 },
      { name: "policeCheckDocument", maxCount: 1 },
    ])(req, res, (err) => {
      if (err) {
        // Handle multer errors
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            success: false,
            message: "File too large",
            error: "File size exceeds 10MB limit",
          });
        }
        if (err.message && err.message.includes("Only PDF")) {
          return res.status(415).json({
            success: false,
            message: "Invalid file type",
            error: err.message,
          });
        }
        return res.status(400).json({
          success: false,
          message: "File upload error",
          error: err.message,
        });
      }
      next();
    });
  },
  MasterDataController.submitDriverInductionForm // Public endpoint - no authentication required
);

// Authenticated routes
router.get("/user-by-token", isAuthenticated, UserController.getUserByToken);
router.get("/permissions", isAuthenticated, UserController.getUserPermissions);
router.post("/switch-organization", isAuthenticated, UserController.switchOrganization);
router.post("/change-password", isAuthenticated, UserController.changePassword);

// Super Admin only routes - Approval Management (must come before parameterized routes)
router.get(
  "/approvals/pending",
  isAuthenticated,
  restrictTo("SUPER_ADMIN"),
  UserController.getPendingApprovals
);
router.post(
  "/approvals/:userId/approve",
  isAuthenticated,
  restrictTo("SUPER_ADMIN"),
  UserController.approveUser
);
router.post(
  "/approvals/:userId/reject",
  isAuthenticated,
  restrictTo("SUPER_ADMIN"),
  UserController.rejectUser
);

// Profile management routes
// TMS Access Control routes (require permissions)
router.get(
  "/",
  isAuthenticated,
  requirePermission("system.users.view"),
  UserController.getAllUsers
);

router.get(
  "/:id",
  isAuthenticated,
  requirePermission("system.users.view"),
  UserController.getUser
);

router.get(
  "/:id/permissions",
  isAuthenticated,
  requirePermission("system.users.view"),
  UserController.getUserPermissionsById
);

router.post(
  "/:id/permissions",
  isAuthenticated,
  requirePermission("system.users.manage"),
  UserController.updateUserPermissions
);

router.patch(
  "/update-user/:id",
  isAuthenticated,
  requirePermission("system.users.manage"),
  UserController.updateUser
);

// Admin password reset (separate from public forgot password)
router.post(
  "/admin/reset-password",
  isAuthenticated,
  requirePermission("system.users.manage"),
  UserController.forgotPassword
);

// Regular routes (for non-admin use)
router.delete("/:id", UserController.deleteUser);
router.patch(
  "/update-profile/:id",
  isAuthenticated,
  UserController.updateProfile
);

module.exports = router;
