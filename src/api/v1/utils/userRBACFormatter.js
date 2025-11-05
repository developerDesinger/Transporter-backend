const UserOrganization = require("../models/userOrganization.model");
const Organization = require("../models/organization.model");

/**
 * Formats a user object with RBAC data according to frontend requirements
 * @param {Object} user - MongoDB user document
 * @returns {Object} Formatted user object with RBAC fields
 */
async function formatUserWithRBAC(user) {
  if (!user) {
    return null;
  }

  // Convert to plain object if it's a Mongoose document
  const userObj = user.toObject ? user.toObject() : user;

  // Determine if user is super admin
  const isSuperAdmin = userObj.isSuperAdmin === true || userObj.role === "SUPER_ADMIN";

  // Get user's organizations if not super admin (super admins can access all orgs)
  let organizations = [];
  let currentOrgRole = null;

  if (!isSuperAdmin && userObj._id) {
    // Fetch user's organization memberships
    const userOrgs = await UserOrganization.find({
      userId: userObj._id,
      status: "ACTIVE"
    }).populate("organizationId", "id name status");

    organizations = userOrgs.map((userOrg) => ({
      id: userOrg.organizationId._id.toString(),
      name: userOrg.organizationId.name,
      orgRole: userOrg.orgRole,
    }));

    // Get current organization role if activeOrganizationId is set
    if (userObj.activeOrganizationId) {
      const activeOrgId = userObj.activeOrganizationId.toString ? 
        userObj.activeOrganizationId.toString() : 
        userObj.activeOrganizationId;
      
      const activeUserOrg = userOrgs.find(
        (uo) => uo.organizationId._id.toString() === activeOrgId
      );
      if (activeUserOrg) {
        currentOrgRole = activeUserOrg.orgRole;
      }
    } else if (organizations.length > 0) {
      // If no active org is set but user has organizations, use the first one
      userObj.activeOrganizationId = organizations[0].id;
      currentOrgRole = organizations[0].orgRole;
    }
  }

  // Format the user object according to RBAC spec
  const formattedUser = {
    id: userObj._id ? userObj._id.toString() : userObj.id,
    _id: userObj._id ? userObj._id.toString() : userObj.id,
    email: userObj.email,
    fullName: userObj.fullName || userObj.name,
    name: userObj.name || userObj.fullName,
    role: userObj.role || null, // System role
    isSuperAdmin: isSuperAdmin, // Platform role flag
    status: userObj.status || "INACTIVE",
    profilePhoto: userObj.profilePhoto,
    userName: userObj.userName,
    activeOrganizationId: userObj.activeOrganizationId 
      ? (userObj.activeOrganizationId.toString ? userObj.activeOrganizationId.toString() : userObj.activeOrganizationId)
      : null,
    organizations: organizations, // Multi-tenant support
    currentOrgRole: currentOrgRole, // Role in active organization
    permissions: userObj.permissions || [], // Custom permissions
    createdAt: userObj.createdAt,
    updatedAt: userObj.updatedAt,
  };

  return formattedUser;
}

/**
 * Formats multiple users with RBAC data
 * @param {Array} users - Array of MongoDB user documents
 * @returns {Array} Array of formatted user objects
 */
async function formatUsersWithRBAC(users) {
  if (!users || !Array.isArray(users)) {
    return [];
  }

  return Promise.all(users.map((user) => formatUserWithRBAC(user)));
}

module.exports = {
  formatUserWithRBAC,
  formatUsersWithRBAC,
};

