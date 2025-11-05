const Organization = require("../models/organization.model");
const UserOrganization = require("../models/userOrganization.model");
const User = require("../models/user.model");
const mongoose = require("mongoose");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");
const { formatUserWithRBAC } = require("../utils/userRBACFormatter");

class OrganizationService {
  /**
   * Get all organizations with pagination and filters
   */
  static async getAllOrganizations(query) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const skip = (page - 1) * limit;

    // Build filter
    const filter = { deletedAt: null };

    if (query.status) {
      filter.status = query.status;
    }

    if (query.search) {
      filter.$or = [
        { name: { $regex: query.search, $options: "i" } },
        { slug: { $regex: query.search, $options: "i" } },
        { primaryContactEmail: { $regex: query.search, $options: "i" } },
      ];
    }

    const totalOrganizations = await Organization.countDocuments(filter);
    const totalPages = Math.ceil(totalOrganizations / limit);

    const organizations = await Organization.find(filter)
      .select("-deletedAt")
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .lean();

    // Get user counts for each organization
    const orgIds = organizations.map((org) => org._id);
    const userCounts = await UserOrganization.aggregate([
      {
        $match: {
          organizationId: { $in: orgIds },
          status: "ACTIVE",
        },
      },
      {
        $group: {
          _id: "$organizationId",
          count: { $sum: 1 },
        },
      },
    ]);

    const userCountMap = {};
    userCounts.forEach((item) => {
      userCountMap[item._id.toString()] = item.count;
    });

    // Add user counts to organizations
    const organizationsWithCounts = organizations.map((org) => ({
      id: org._id.toString(),
      name: org.name,
      slug: org.slug,
      status: org.status,
      subscriptionTier: org.subscriptionTier,
      usersCount: userCountMap[org._id.toString()] || 0,
      maxUsers: org.maxUsers,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    }));

    return {
      data: organizationsWithCounts,
      pagination: {
        page,
        limit,
        total: totalOrganizations,
        totalPages,
      },
      success: true,
    };
  }

  /**
   * Get organization by ID with members
   */
  static async getOrganizationById(organizationId) {
    const organization = await Organization.findOne({
      _id: organizationId,
      deletedAt: null,
    });

    if (!organization) {
      throw new AppError("Organization not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Get members
    const memberships = await UserOrganization.find({
      organizationId: organization._id,
      status: "ACTIVE",
    })
      .populate("userId", "email fullName name role status")
      .lean();

    const members = memberships.map((membership) => ({
      id: membership._id.toString(),
      userId: membership.userId._id.toString(),
      userName: membership.userId.fullName || membership.userId.name,
      userEmail: membership.userId.email,
      orgRole: membership.orgRole,
      isActive: membership.isActive,
      joinedAt: membership.joinedAt || membership.createdAt,
    }));

    // Get user counts
    const activeUsersCount = memberships.length;
    const driversCount = memberships.filter(
      (m) => m.userId.role === "DRIVER"
    ).length;

    return {
      id: organization._id.toString(),
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
      subscriptionTier: organization.subscriptionTier,
      primaryContactName: organization.primaryContactName,
      primaryContactEmail: organization.primaryContactEmail,
      primaryContactPhone: organization.primaryContactPhone,
      billingEmail: organization.billingEmail,
      maxUsers: organization.maxUsers,
      maxDrivers: organization.maxDrivers,
      maxVehicles: organization.maxVehicles,
      features: organization.features,
      members: members,
      billing: {
        subscriptionStatus: organization.status,
        usersCount: activeUsersCount,
        driversCount: driversCount,
        vehiclesCount: 0, // TODO: Get from vehicles collection
      },
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
    };
  }

  /**
   * Create new organization
   */
  static async createOrganization(data, createdBy) {
    const {
      name,
      slug,
      status = "active",
      subscriptionTier = "free",
      maxUsers = 10,
      maxDrivers = 50,
      maxVehicles = 50,
      primaryContactName,
      primaryContactEmail,
      primaryContactPhone,
      billingEmail,
      features = {},
    } = data;

    // Validate slug uniqueness
    const existingOrg = await Organization.findOne({ slug });
    if (existingOrg) {
      throw new AppError(
        "Organization with this slug already exists.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    const organization = await Organization.create({
      name,
      slug: slug.toLowerCase().trim(),
      status,
      subscriptionTier,
      maxUsers,
      maxDrivers,
      maxVehicles,
      primaryContactName,
      primaryContactEmail,
      primaryContactPhone,
      billingEmail,
      features: {
        fatigueManagement: features.fatigueManagement || false,
        gpsTracking: features.gpsTracking || false,
        advancedReporting: features.advancedReporting || false,
        apiAccess: features.apiAccess || false,
      },
    });

    return {
      success: true,
      message: "Organization created successfully",
      data: await this.getOrganizationById(organization._id),
    };
  }

  /**
   * Update organization
   */
  static async updateOrganization(organizationId, data) {
    const organization = await Organization.findOne({
      _id: organizationId,
      deletedAt: null,
    });

    if (!organization) {
      throw new AppError("Organization not found.", HttpStatusCodes.NOT_FOUND);
    }

    // If slug is being updated, check uniqueness
    if (data.slug && data.slug !== organization.slug) {
      const existingOrg = await Organization.findOne({
        slug: data.slug.toLowerCase().trim(),
        _id: { $ne: organizationId },
      });
      if (existingOrg) {
        throw new AppError(
          "Organization with this slug already exists.",
          HttpStatusCodes.BAD_REQUEST
        );
      }
      data.slug = data.slug.toLowerCase().trim();
    }

    // Update features if provided
    if (data.features) {
      data.features = {
        ...organization.features.toObject(),
        ...data.features,
      };
    }

    const updatedOrganization = await Organization.findByIdAndUpdate(
      organizationId,
      data,
      { new: true, runValidators: true }
    );

    return {
      success: true,
      message: "Organization updated successfully",
      data: await this.getOrganizationById(updatedOrganization._id),
    };
  }

  /**
   * Delete organization (soft delete)
   */
  static async deleteOrganization(organizationId) {
    const organization = await Organization.findOne({
      _id: organizationId,
      deletedAt: null,
    });

    if (!organization) {
      throw new AppError("Organization not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Soft delete
    await Organization.findByIdAndUpdate(organizationId, {
      status: "deleted",
      deletedAt: new Date(),
    });

    // Optionally deactivate all memberships
    await UserOrganization.updateMany(
      { organizationId: organizationId },
      { status: "INACTIVE", isActive: false }
    );

    return {
      success: true,
      message: "Organization deleted successfully",
    };
  }

  /**
   * Add user to organization
   */
  static async addUserToOrganization(organizationId, userId, orgRole, systemRole, addedBy) {
    // Check if organization exists
    const organization = await Organization.findOne({
      _id: organizationId,
      deletedAt: null,
    });

    if (!organization) {
      throw new AppError("Organization not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError("User not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Check if user is already in organization
    const existingMembership = await UserOrganization.findOne({
      userId,
      organizationId,
    });

    if (existingMembership) {
      if (existingMembership.status === "ACTIVE") {
        throw new AppError(
          "User is already a member of this organization.",
          HttpStatusCodes.BAD_REQUEST
        );
      } else {
        // Reactivate membership
        existingMembership.status = "ACTIVE";
        existingMembership.isActive = true;
        existingMembership.orgRole = orgRole;
        existingMembership.joinedAt = new Date();
        await existingMembership.save();
      }
    } else {
      // Check organization user limit
      const activeUsersCount = await UserOrganization.countDocuments({
        organizationId,
        status: "ACTIVE",
      });

      if (activeUsersCount >= organization.maxUsers) {
        const error = new AppError(
          "Organization user limit reached",
          HttpStatusCodes.BAD_REQUEST
        );
        error.error = "MAX_USERS_EXCEEDED";
        error.details = {
          current: activeUsersCount,
          max: organization.maxUsers,
        };
        throw error;
      }

      // Create new membership
      await UserOrganization.create({
        userId,
        organizationId,
        orgRole,
        status: "ACTIVE",
        isActive: true,
        joinedAt: new Date(),
        invitedBy: addedBy,
        invitedAt: new Date(),
      });
    }

    // Update user's system role if provided
    if (systemRole) {
      await User.findByIdAndUpdate(userId, { role: systemRole });
    }

    // If this is user's first organization, set as active
    const userOrgs = await UserOrganization.countDocuments({
      userId,
      status: "ACTIVE",
    });

    if (userOrgs === 1) {
      await User.findByIdAndUpdate(userId, {
        activeOrganizationId: organizationId,
      });
    }

    // Get updated membership
    const membership = await UserOrganization.findOne({
      userId,
      organizationId,
    })
      .populate("userId", "email fullName name")
      .lean();

    return {
      success: true,
      message: "User added to organization successfully",
      data: {
        id: membership._id.toString(),
        userId: membership.userId._id.toString(),
        organizationId: membership.organizationId.toString(),
        orgRole: membership.orgRole,
        isActive: membership.isActive,
        joinedAt: membership.joinedAt || membership.createdAt,
      },
    };
  }

  /**
   * Remove user from organization
   */
  static async removeUserFromOrganization(organizationId, userId) {
    const membership = await UserOrganization.findOne({
      userId,
      organizationId,
      status: "ACTIVE",
    });

    if (!membership) {
      throw new AppError(
        "User is not a member of this organization.",
        HttpStatusCodes.NOT_FOUND
      );
    }

    // Soft delete membership
    membership.status = "INACTIVE";
    membership.isActive = false;
    await membership.save();

    // If this was user's active organization, clear it
    const user = await User.findById(userId);
    if (user && user.activeOrganizationId?.toString() === organizationId.toString()) {
      // Find another active organization
      const otherOrg = await UserOrganization.findOne({
        userId,
        status: "ACTIVE",
        organizationId: { $ne: organizationId },
      });

      if (otherOrg) {
        user.activeOrganizationId = otherOrg.organizationId;
      } else {
        user.activeOrganizationId = null;
      }
      await user.save();
    }

    return {
      success: true,
      message: "User removed from organization successfully",
    };
  }

  /**
   * Update user organization role
   */
  static async updateUserOrganizationRole(organizationId, userId, orgRole) {
    const membership = await UserOrganization.findOne({
      userId,
      organizationId,
      status: "ACTIVE",
    });

    if (!membership) {
      throw new AppError(
        "User is not a member of this organization.",
        HttpStatusCodes.NOT_FOUND
      );
    }

    membership.orgRole = orgRole;
    await membership.save();

    return {
      success: true,
      message: "User role updated successfully",
      data: {
        id: membership._id.toString(),
        userId: membership.userId.toString(),
        organizationId: membership.organizationId.toString(),
        orgRole: membership.orgRole,
        isActive: membership.isActive,
      },
    };
  }

  /**
   * Get organization users
   */
  static async getOrganizationUsers(organizationId, query) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const skip = (page - 1) * limit;

    // Verify organization exists
    const organization = await Organization.findOne({
      _id: organizationId,
      deletedAt: null,
    });

    if (!organization) {
      throw new AppError("Organization not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Build filter
    const filter = {
      organizationId,
      status: "ACTIVE",
    };

    if (query.role) {
      filter.orgRole = query.role;
    }

    const totalUsers = await UserOrganization.countDocuments(filter);
    const totalPages = Math.ceil(totalUsers / limit);

    const memberships = await UserOrganization.find(filter)
      .populate("userId", "email fullName name role status")
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .lean();

    const users = memberships.map((membership) => ({
      id: membership.userId._id.toString(),
      email: membership.userId.email,
      fullName: membership.userId.fullName || membership.userId.name,
      role: membership.userId.role,
      orgRole: membership.orgRole,
      status: membership.userId.status,
      isActive: membership.isActive,
      joinedAt: membership.joinedAt || membership.createdAt,
    }));

    // Apply search filter if provided
    let filteredUsers = users;
    if (query.search) {
      const searchLower = query.search.toLowerCase();
      filteredUsers = users.filter(
        (user) =>
          user.email.toLowerCase().includes(searchLower) ||
          user.fullName?.toLowerCase().includes(searchLower)
      );
    }

    return {
      data: filteredUsers,
      pagination: {
        page,
        limit,
        total: totalUsers,
        totalPages,
      },
      success: true,
    };
  }

  /**
   * Get organization statistics
   */
  static async getOrganizationStats(organizationId) {
    const organization = await Organization.findOne({
      _id: organizationId,
      deletedAt: null,
    }).lean();

    if (!organization) {
      throw new AppError("Organization not found.", HttpStatusCodes.NOT_FOUND);
    }

    const memberships = await UserOrganization.find({
      organizationId,
      status: "ACTIVE",
    })
      .populate("userId", "role status")
      .lean();

    const usersCount = memberships.length;
    const activeUsersCount = memberships.filter(
      (m) => m.userId.status === "ACTIVE"
    ).length;
    const driversCount = memberships.filter(
      (m) => m.userId.role === "DRIVER"
    ).length;

    return {
      usersCount,
      activeUsersCount,
      driversCount,
      vehiclesCount: 0, // TODO: Get from vehicles collection
      subscriptionStatus: organization.status,
      subscriptionTier: organization.subscriptionTier,
      monthlyRevenue: 0, // TODO: Calculate from billing
      usage: {
        users: {
          current: usersCount,
          max: organization.maxUsers,
          percentage: Math.round((usersCount / organization.maxUsers) * 100),
        },
        drivers: {
          current: driversCount,
          max: organization.maxDrivers,
          percentage: Math.round((driversCount / organization.maxDrivers) * 100),
        },
        vehicles: {
          current: 0,
          max: organization.maxVehicles,
          percentage: 0,
        },
      },
    };
  }

  /**
   * Check if user has access to organization
   */
  static async checkUserAccess(userId, organizationId) {
    const user = await User.findById(userId);

    // Super admin has access to all organizations
    if (user.isSuperAdmin || user.role === "SUPER_ADMIN") {
      return { hasAccess: true, isSuperAdmin: true };
    }

    // Check if user belongs to organization
    const membership = await UserOrganization.findOne({
      userId,
      organizationId,
      status: "ACTIVE",
    });

    if (!membership) {
      return { hasAccess: false };
    }

    return {
      hasAccess: true,
      orgRole: membership.orgRole,
      isTenantAdmin: membership.orgRole === "TENANT_ADMIN",
    };
  }
}

module.exports = OrganizationService;

