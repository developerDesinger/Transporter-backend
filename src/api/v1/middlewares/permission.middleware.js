const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");
const { getPermissionsForRole } = require("../utils/permissions");
const UserOrganization = require("../models/userOrganization.model");

/**
 * Check if user has a specific permission
 * @param {Object} user - User object from req.user
 * @param {string} permission - Permission string (e.g., "system.users.view")
 * @returns {boolean} True if user has permission
 */
async function hasPermission(user, permission) {
  // Super admin has all permissions
  if (user.isSuperAdmin === true || user.role === "SUPER_ADMIN") {
    return true;
  }

  // Get user's active organization role
  let isTenantAdmin = false;
  if (user.activeOrganizationId) {
    const userOrg = await UserOrganization.findOne({
      userId: user._id,
      organizationId: user.activeOrganizationId,
      status: "ACTIVE",
    });
    isTenantAdmin = userOrg && userOrg.orgRole === "TENANT_ADMIN";
  }

  // Get all permissions for user
  const userPermissions = getPermissionsForRole(
    user.role,
    false, // isSuperAdmin already checked
    isTenantAdmin,
    user.permissions || []
  );

  // Check if permission exists
  return userPermissions.includes(permission);
}

/**
 * Middleware to check if user has required permission
 * @param {string} requiredPermission - Required permission (e.g., "system.users.view")
 */
const requirePermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized. Please login again.",
        });
      }

      // Check permission
      const hasAccess = await hasPermission(user, requiredPermission);

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: "You don't have permission to perform this action.",
        });
      }

      next();
    } catch (error) {
      console.error("Permission Middleware Error:", error);
      res.status(500).json({
        success: false,
        message: "An error occurred while checking permissions.",
      });
    }
  };
};

/**
 * Middleware to check if user has any of the required permissions
 * @param {string[]} requiredPermissions - Array of permissions (user needs at least one)
 */
const requireAnyPermission = (...requiredPermissions) => {
  return async (req, res, next) => {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized. Please login again.",
        });
      }

      // Check if user has any of the required permissions
      for (const permission of requiredPermissions) {
        const hasAccess = await hasPermission(user, permission);
        if (hasAccess) {
          return next();
        }
      }

      return res.status(403).json({
        success: false,
        message: "You don't have permission to perform this action.",
      });
    } catch (error) {
      console.error("Permission Middleware Error:", error);
      res.status(500).json({
        success: false,
        message: "An error occurred while checking permissions.",
      });
    }
  };
};

module.exports = {
  hasPermission,
  requirePermission,
  requireAnyPermission,
};

