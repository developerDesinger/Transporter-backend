const express = require("express");
const UserController = require("../controller/UserController");
const { isAuthenticated, restrictTo } = require("../middlewares/auth.middleware");
const { requirePermission } = require("../middlewares/permission.middleware");

const router = express.Router();

// Public routes
router.post("/create", UserController.createUser); // Public registration (admin creation handled in controller)
router.post("/login", UserController.loginUser);
router.post("/social-login", UserController.socialLoginUser);
router.post("/verify-otp", UserController.verifyOtp);
router.post("/resend-otp", UserController.resendOtp);
router.post("/forgot-password", UserController.forgotPassword); // Public forgot password
router.post("/update-password", UserController.updatePassword);

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
