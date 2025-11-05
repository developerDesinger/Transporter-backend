const express = require("express");
const OrganizationController = require("../controller/OrganizationController");
const { isAuthenticated, restrictTo } = require("../middlewares/auth.middleware");

const router = express.Router();

// All organization routes require authentication
router.use(isAuthenticated);

// Super Admin only routes
router.get(
  "/admin/organizations",
  restrictTo("SUPER_ADMIN"),
  OrganizationController.getAllOrganizations
);

router.post(
  "/admin/organizations",
  restrictTo("SUPER_ADMIN"),
  OrganizationController.createOrganization
);

router.delete(
  "/admin/organizations/:id",
  restrictTo("SUPER_ADMIN"),
  OrganizationController.deleteOrganization
);

// Organization details (Super Admin or Tenant Admin of that org)
router.get(
  "/admin/organizations/:id",
  OrganizationController.getOrganizationById
);

// Update organization (Super Admin or Tenant Admin with limited fields)
router.patch(
  "/admin/organizations/:id",
  OrganizationController.updateOrganization
);

// Organization users management
router.get(
  "/admin/organizations/:id/users",
  OrganizationController.getOrganizationUsers
);

router.post(
  "/admin/organizations/:id/members",
  OrganizationController.addUserToOrganization
);

router.delete(
  "/admin/organizations/:id/members/:userId",
  OrganizationController.removeUserFromOrganization
);

router.patch(
  "/admin/organizations/:id/members/:userId",
  OrganizationController.updateUserOrganizationRole
);

// Organization statistics
router.get(
  "/admin/organizations/:id/stats",
  OrganizationController.getOrganizationStats
);

module.exports = router;

