const OrganizationService = require("../services/organization.service");
const catchAsyncHandler = require("../utils/catchAsyncHandler");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");

class OrganizationController {
  // Get all organizations (Super Admin only)
  static getAllOrganizations = catchAsyncHandler(async (req, res) => {
    const result = await OrganizationService.getAllOrganizations(req.query);
    return res.status(200).json(result.data || result);
  });

  // Get organization by ID
  static getOrganizationById = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const { id: userId } = req.user;

    // Check access
    const access = await OrganizationService.checkUserAccess(userId, id);
    if (!access.hasAccess) {
      throw new AppError(
        "You don't have permission to access this organization.",
        HttpStatusCodes.FORBIDDEN
      );
    }

    const organization = await OrganizationService.getOrganizationById(id);
    return res.status(200).json(organization);
  });

  // Create organization (Super Admin only)
  static createOrganization = catchAsyncHandler(async (req, res) => {
    const { id: userId } = req.user;
    const result = await OrganizationService.createOrganization(
      req.body,
      userId
    );
    return res.status(201).json(result);
  });

  // Update organization
  static updateOrganization = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const { id: userId } = req.user;

    // Check access - Super Admin can update any, Tenant Admin can update their own
    const access = await OrganizationService.checkUserAccess(userId, id);
    if (!access.hasAccess) {
      throw new AppError(
        "You don't have permission to update this organization.",
        HttpStatusCodes.FORBIDDEN
      );
    }

    // Tenant Admin can only update limited fields
    if (!access.isSuperAdmin && access.isTenantAdmin) {
      // Allow tenant admin to update only specific fields
      const allowedFields = [
        "primaryContactName",
        "primaryContactEmail",
        "primaryContactPhone",
        "billingEmail",
      ];
      const updateData = {};
      allowedFields.forEach((field) => {
        if (req.body[field] !== undefined) {
          updateData[field] = req.body[field];
        }
      });
      const result = await OrganizationService.updateOrganization(id, updateData);
      return res.status(200).json(result);
    }

    // Super Admin can update all fields
    const result = await OrganizationService.updateOrganization(id, req.body);
    return res.status(200).json(result);
  });

  // Delete organization (Super Admin only)
  static deleteOrganization = catchAsyncHandler(async (req, res) => {
    const { id } = req.params;
    const result = await OrganizationService.deleteOrganization(id);
    return res.status(200).json(result);
  });

  // Add user to organization
  static addUserToOrganization = catchAsyncHandler(async (req, res) => {
    const { id: organizationId } = req.params;
    const { userId, orgRole, systemRole } = req.body;
    const { id: addedBy } = req.user;

    // Check access
    const access = await OrganizationService.checkUserAccess(
      addedBy,
      organizationId
    );
    if (!access.hasAccess || (!access.isSuperAdmin && !access.isTenantAdmin)) {
      throw new AppError(
        "You don't have permission to add users to this organization.",
        HttpStatusCodes.FORBIDDEN
      );
    }

    if (!userId) {
      throw new AppError("User ID is required.", HttpStatusCodes.BAD_REQUEST);
    }

    if (!orgRole || !["TENANT_ADMIN", "MEMBER"].includes(orgRole)) {
      throw new AppError(
        "Invalid orgRole. Must be TENANT_ADMIN or MEMBER.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    const result = await OrganizationService.addUserToOrganization(
      organizationId,
      userId,
      orgRole,
      systemRole,
      addedBy
    );
    return res.status(200).json(result);
  });

  // Remove user from organization
  static removeUserFromOrganization = catchAsyncHandler(async (req, res) => {
    const { id: organizationId, userId } = req.params;
    const { id: currentUserId } = req.user;

    // Check access
    const access = await OrganizationService.checkUserAccess(
      currentUserId,
      organizationId
    );
    if (!access.hasAccess || (!access.isSuperAdmin && !access.isTenantAdmin)) {
      throw new AppError(
        "You don't have permission to remove users from this organization.",
        HttpStatusCodes.FORBIDDEN
      );
    }

    const result = await OrganizationService.removeUserFromOrganization(
      organizationId,
      userId
    );
    return res.status(200).json(result);
  });

  // Update user organization role
  static updateUserOrganizationRole = catchAsyncHandler(async (req, res) => {
    const { id: organizationId, userId } = req.params;
    const { orgRole } = req.body;
    const { id: currentUserId } = req.user;

    // Check access
    const access = await OrganizationService.checkUserAccess(
      currentUserId,
      organizationId
    );
    if (!access.hasAccess || (!access.isSuperAdmin && !access.isTenantAdmin)) {
      throw new AppError(
        "You don't have permission to update user roles in this organization.",
        HttpStatusCodes.FORBIDDEN
      );
    }

    if (!orgRole || !["TENANT_ADMIN", "MEMBER"].includes(orgRole)) {
      throw new AppError(
        "Invalid orgRole. Must be TENANT_ADMIN or MEMBER.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    const result = await OrganizationService.updateUserOrganizationRole(
      organizationId,
      userId,
      orgRole
    );
    return res.status(200).json(result);
  });

  // Get organization users
  static getOrganizationUsers = catchAsyncHandler(async (req, res) => {
    const { id: organizationId } = req.params;
    const { id: userId } = req.user;

    // Check access
    const access = await OrganizationService.checkUserAccess(userId, organizationId);
    if (!access.hasAccess || (!access.isSuperAdmin && !access.isTenantAdmin)) {
      throw new AppError(
        "You don't have permission to view users in this organization.",
        HttpStatusCodes.FORBIDDEN
      );
    }

    const result = await OrganizationService.getOrganizationUsers(
      organizationId,
      req.query
    );
    return res.status(200).json(result);
  });

  // Get organization statistics
  static getOrganizationStats = catchAsyncHandler(async (req, res) => {
    const { id: organizationId } = req.params;
    const { id: userId } = req.user;

    // Check access
    const access = await OrganizationService.checkUserAccess(userId, organizationId);
    if (!access.hasAccess || (!access.isSuperAdmin && !access.isTenantAdmin)) {
      throw new AppError(
        "You don't have permission to view statistics for this organization.",
        HttpStatusCodes.FORBIDDEN
      );
    }

    const stats = await OrganizationService.getOrganizationStats(organizationId);
    return res.status(200).json(stats);
  });
}

module.exports = OrganizationController;

