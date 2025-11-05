const express = require("express");
const UserController = require("../controller/UserController");
const { isAuthenticated, restrictTo } = require("../middlewares/auth.middleware");

const router = express.Router();

// Public routes
router.post("/create", UserController.createUser);
router.post("/login", UserController.loginUser);
router.post("/social-login", UserController.socialLoginUser);
router.post("/verify-otp", UserController.verifyOtp);
router.post("/resend-otp", UserController.resendOtp);
router.post("/forgot-password", UserController.forgotPassword);
router.post("/update-password", UserController.updatePassword);

// Authenticated routes
router.get("/user-by-token", isAuthenticated, UserController.getUserByToken);
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
router.get("/", UserController.getAllUsers);
router.get("/:id", UserController.getUser);
router.delete("/:id", UserController.deleteUser);
router.patch(
  "/update-profile/:id",
  isAuthenticated,
  UserController.updateProfile
);
router.patch("/update-user/:id", isAuthenticated, UserController.updateUser);

module.exports = router;
