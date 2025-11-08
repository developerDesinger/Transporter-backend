const bcrypt = require("bcrypt");
const crypto = require("crypto");
const User = require("../models/user.model");
const mongoose = require("mongoose");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");
const { createJwtToken } = require("../middlewares/auth.middleware");
const { s3SharpImageUpload } = require("../services/aws.service");
const { sendEmail, sendForgotPasswordEmail } = require("../utils/email");
const { formatUserWithRBAC, formatUsersWithRBAC } = require("../utils/userRBACFormatter");
const { getPermissionsForRole } = require("../utils/permissions");
const UserOrganization = require("../models/userOrganization.model");

const DRIVER_PORTAL_PERMISSIONS = [
  "driver.portal.view",
  "operations.dashboard.view",
  "driver.messages.view",
  "driver.messages.send",
  "driver.daily-board.view",
  "driver.induction.manage",
];

const ensureDriverPermissions = (existingPermissions = []) => {
  const current = Array.isArray(existingPermissions)
    ? existingPermissions
    : [];
  return Array.from(new Set([...current, ...DRIVER_PORTAL_PERMISSIONS]));
};

class UserService {
  static async createUser(data, isAdminCreation = false) {
    const { email, fullName, profilePhoto, role, password, userName } = data;

    if (!email) {
      throw new AppError(
        "Email is required.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // For admin creation, password is optional (will be auto-generated if not provided)
    if (!isAdminCreation && !password) {
      throw new AppError(
        "Password is required.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate role if provided (SUPER_ADMIN cannot be requested)
    if (role && !["ADMIN", "OPERATIONS", "FINANCE", "DRIVER", "STAFF"].includes(role)) {
      throw new AppError(
        "Invalid role. Allowed roles: ADMIN, OPERATIONS, FINANCE, DRIVER, STAFF",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Check if user already exists
    let user = await User.findOne({ email });

    // If user exists and is active, return error
    if (user && user.status === "ACTIVE") {
      return {
        user,
        message: "User with this email already exists and is active.",
        success: true,
      };
    }

    // Static OTP for now
    let otp = "123456";
    let tempPassword = null;

    // Generate password if not provided (for admin creation)
    let finalPassword = password;
    if (!finalPassword && isAdminCreation) {
      // Generate random password
      tempPassword = crypto.randomBytes(12).toString("base64").slice(0, 12);
      finalPassword = tempPassword;
    }

    // Prepare user data
    const userData = {
      email,
      fullName,
      profilePhoto,
      isSuperAdmin: false,
    };

    // Admin creation bypasses OTP and approval
    if (isAdminCreation) {
      userData.requestedRole = role || "STAFF";
      userData.role = role || "STAFF"; // Set role immediately
      userData.status = "ACTIVE"; // Active immediately
      userData.approvalStatus = "APPROVED"; // Approved immediately
      userData.userName = userName || email.split("@")[0]; // Auto-generate from email
    } else {
      // Regular registration flow
      userData.requestedRole = role || "STAFF";
      userData.role = "STAFF"; // Default role until approved
      userData.status = "PENDING_VERIFICATION"; // Initial status after registration
      userData.approvalStatus = "PENDING"; // Will be approved after super admin approval
      userData.otp = otp;
      userData.otpCreatedAt = new Date();
    }

    // Add password if provided or generated
    if (finalPassword) {
      userData.password = await bcrypt.hash(finalPassword, 10);
    }

    if (user) {
      // User exists but is inactive or pending
      if (isAdminCreation) {
        // Admin can reactivate existing users
      user.fullName = fullName;
      user.profilePhoto = profilePhoto;
      user.requestedRole = role || "STAFF";
        user.role = role || "STAFF";
        user.status = "ACTIVE";
        user.approvalStatus = "APPROVED";
        user.isSuperAdmin = false;
        if (userName) user.userName = userName;
        if (finalPassword) user.password = await bcrypt.hash(finalPassword, 10);
        await user.save();
      } else {
        // Regular flow - resend OTP
        user.fullName = fullName;
        user.profilePhoto = profilePhoto;
        user.requestedRole = role || "STAFF";
        user.status = "PENDING_VERIFICATION";
      user.approvalStatus = "PENDING";
      user.otp = otp;
      user.otpCreatedAt = new Date();
        user.isSuperAdmin = false;
        if (finalPassword) user.password = await bcrypt.hash(finalPassword, 10);
      await user.save();
      }
    } else {
      // Create new user
      user = await User.create(userData);
    }

    // Format user with RBAC data
    const formattedUser = await formatUserWithRBAC(user);

    if (isAdminCreation) {
      return {
        message: "User created successfully",
        success: true,
        user: formattedUser,
        tempPassword: tempPassword, // Return temp password if generated
      };
    }

    return {
      message: "OTP sent to your email. Please verify to continue. After verification, your account will be pending approval.",
      success: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        profilePhoto: user.profilePhoto,
        status: user.status,
        requestedRole: user.requestedRole,
        approvalStatus: user.approvalStatus,
      },
    };
  }

  static async updateUserAndProfile(userId, updateData) {
    // Prepare update data
    const updateFields = { ...updateData };

    // Handle password hashing if present
    if (updateFields.password) {
      updateFields.password = await bcrypt.hash(updateFields.password, 10);
    }

    // Update user
    const updatedUser = await User.findByIdAndUpdate(userId, updateFields, {
      new: true,
    });

    if (!updatedUser) {
      throw new AppError("User not found.", HttpStatusCodes.NOT_FOUND);
    }

    return {
      message: "User and profile updated successfully.",
      user: updatedUser,
      success: true,
    };
  }

  static async verifyUserName(data) {
    const { userName } = data;

    const existingUser = await User.findOne({ userName });
    if (existingUser) {
      throw new AppError(
        "UserName already in use.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    return { message: "UserName Available", success: true };
  }

  static async verifyOtp(data) {
    const { email, otp } = data;

    const user = await User.findOne({ email });
    if (!user) {
      throw new AppError("User not found.", HttpStatusCodes.BAD_REQUEST);
    }

    if (user.otp !== otp.toString()) {
      throw new AppError("Invalid OTP.", HttpStatusCodes.BAD_REQUEST);
    }

    const otpExpiryTime = 10 * 60 * 1000;
    if (Date.now() - user.otpCreatedAt.getTime() > otpExpiryTime) {
      throw new AppError("OTP has expired.", HttpStatusCodes.BAD_REQUEST);
    }

    // After OTP verification, set status to PENDING_APPROVAL
    // User needs super_admin approval before they can login
    const updatedUser = await User.findByIdAndUpdate(
      user.id,
      { 
        status: "PENDING_APPROVAL",
        approvalStatus: "PENDING"
      },
      { new: true }
    );

    // Don't return token - user needs approval first
    return {
      message: "OTP verified successfully. Your account is pending approval from super admin. You will be notified once approved.",
      success: true,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        fullName: updatedUser.fullName,
        status: updatedUser.status,
        approvalStatus: updatedUser.approvalStatus,
        requestedRole: updatedUser.requestedRole,
      },
    };
  }

  static async resendOtp(data) {
    const { email } = data;

    const user = await User.findOne({ email });
    if (!user) {
      throw new AppError("User not found.", HttpStatusCodes.BAD_REQUEST);
    }

    // const otp = crypto.randomInt(100000, 999999).toString();
    const otp = "123456";

    await User.findByIdAndUpdate(user.id, { otp, otpCreatedAt: new Date() });
    // await sendEmail({ email, otp });
    // sendOtpEmail(user.email, otp);

    return {
      message: "OTP has been resent successfully. Please check your email.",
      success: true,
    };
  }

  static async loginUser(data) {
    console.log("data<>><<>", data);
    const { email, password, role } = data;
    if (!email || !password) {
      return {
        message: "Email and password are required.",
        success: false,
      };
    }
    const user = await User.findOne({ email }).select(
      "_id email password role status fullName name profilePhoto userName isSuperAdmin activeOrganizationId permissions createdAt updatedAt"
    );
    if (!user) {
      return {
        message: "Invalid email or password.",
        success: false,
      };
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return {
        message: "Invalid email or password.",
        success: false,
      };
    }
    
    if (user.status === "PENDING_APPROVAL") {
      return {
        message: "Your account is pending approval from super admin. Please wait for approval.",
        success: false,
        status: user.status,
        approvalStatus: user.approvalStatus,
      };
    }

    if (user.status === "REJECTED") {
      return {
        message: "Your account has been rejected. Please contact support.",
        success: false,
        status: user.status,
      };
    }

    if (user.status !== "ACTIVE") {
      return {
        message: "Account is inactive. Please verify your email.",
        success: false,
        status: user.status,
      };
    }

    // Format user with RBAC data
    const formattedUser = await formatUserWithRBAC(user);

    // If user is a DRIVER, fetch and include driver status information
    let driverStatus = null;
    if (user.role === "DRIVER") {
      try {
        const Driver = require("../models/driver.model");
        const Party = require("../models/party.model");
        
        // Try to find driver by userId first
        let driver = await Driver.findOne({ userId: user._id })
          .select("driverStatus complianceStatus isActive userId")
          .lean();

        // If not found by userId, try to find by email via party
        if (!driver) {
          const party = await Party.findOne({ email: user.email }).select("_id").lean();
          if (party) {
            driver = await Driver.findOne({ partyId: party._id })
              .select("driverStatus complianceStatus isActive userId")
              .lean();
            
            // If found by party, update the userId link for future queries
            if (driver && !driver.userId) {
              await Driver.updateOne(
                { _id: driver._id },
                { $set: { userId: user._id } }
              );
              console.log(`✅ Linked driver ${driver._id} to user ${user._id} during login`);
            }
          }
        }

        if (driver) {
          driverStatus = {
            driverStatus: driver.driverStatus || null,
            complianceStatus: driver.complianceStatus || null,
            isActive: driver.isActive || false,
          };
          console.log(`✅ Driver status fetched for login: ${JSON.stringify(driverStatus)}`);
        } else {
          console.warn(`⚠️ No driver record found for user ${user._id} (${user.email})`);
        }
      } catch (driverError) {
        console.error("Error fetching driver status during login:", driverError);
        // Continue without driver status if there's an error
      }
    }

    const token = createJwtToken({ id: user.id, role: user.role });
    return {
      message: "Login successful.",
      success: true,
      data: {
        token,
        user: formattedUser,
        driverStatus, // Include driver status if user is a DRIVER
      },
      user: formattedUser, // Keep for backward compatibility
      token, // Keep for backward compatibility
      driverStatus, // Include driver status if user is a DRIVER (for backward compatibility)
    };
  }

  static async socialLogin(data) {
    const {
      email,
      provider,
      providerId,
      userName,
      profilePhoto,
    } = data;

    if (!email || !provider || !providerId) {
      throw new AppError(
        "Email, provider, and providerId are required.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    let user = await User.findOne({ email });

    // If user doesn't exist, create a new one
    if (!user) {
      user = await User.create({
        email,
        userName,
        loginType: provider,
        role: "STAFF",
        status: "ACTIVE",
        profilePhoto,
        isSuperAdmin: false,
      });
    } else {
      // Update login type if different
      if (user.loginType !== provider) {
        user.loginType = provider;
        await user.save();
      }

      // Check if the account is active
      if (user.status !== "ACTIVE") {
        throw new AppError(
          "Account is inactive. Please contact support.",
          HttpStatusCodes.UNAUTHORIZED
        );
      }
    }

    // Format user with RBAC data
    const formattedUser = await formatUserWithRBAC(user);

    // If user is a DRIVER, fetch and include driver status information
    let driverStatus = null;
    if (user.role === "DRIVER") {
      try {
        const Driver = require("../models/driver.model");
        const driver = await Driver.findOne({ userId: user._id })
          .select("driverStatus complianceStatus isActive")
          .lean();

        if (driver) {
          driverStatus = {
            driverStatus: driver.driverStatus || null,
            complianceStatus: driver.complianceStatus || null,
            isActive: driver.isActive || false,
          };
        }
      } catch (driverError) {
        console.error("Error fetching driver status during social login:", driverError);
        // Continue without driver status if there's an error
      }
    }

    const token = createJwtToken({ id: user.id, role: user.role });
    return {
      message: "Social login successful.",
      success: true,
      data: {
        token,
        user: formattedUser,
        driverStatus, // Include driver status if user is a DRIVER
      },
      user: formattedUser, // Keep for backward compatibility
      token, // Keep for backward compatibility
      driverStatus, // Include driver status if user is a DRIVER (for backward compatibility)
    };
  }

  static async getAllUsers(query) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const skip = (page - 1) * limit;

    const totalUsers = await User.countDocuments({ status: "ACTIVE" });
    const totalPages = Math.ceil(totalUsers / limit);

    const users = await User.find({ status: "ACTIVE" })
      .select("_id email fullName name role status isSuperAdmin activeOrganizationId permissions createdAt updatedAt")
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    if (!users || users.length === 0) {
      return {
        message: "No users found.",
        success: false,
        data: [],
        pagination: {
          currentPage: page,
          totalPages: 0,
          totalItems: 0,
          limit,
        },
      };
    }

    // Format users with RBAC data
    const formattedUsers = await formatUsersWithRBAC(users);

    return {
      message: "Users fetched successfully.",
      success: true,
      data: formattedUsers,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems: totalUsers,
        limit,
      },
    };
  }

  static async getAllUsersByRole(role) {
    if (!role) {
      throw new AppError("Role is required.", HttpStatusCodes.BAD_REQUEST);
    }
    console.log("Role:", role);

    const users = await User.find({ role: role.role });
    console.log("Users found:", users);
    return {
      message: ` All user with ${role.role}`,
      success: true,
      data: users,
    };
  }

  static async getUserByUserName(userName) {
    if (!userName) {
      throw new AppError("userName is required.", HttpStatusCodes.BAD_REQUEST);
    }
    console.log("userName", userName);
    const users = await User.find({ userName: userName.userName });
    console.log("Users found:", users);
    return {
      message: `User`,
      success: true,
      data: users,
    };
  }

  static async updateUser(userId, updateData) {
    // Remove password field if present in updateData
    const { password, orgRole, organizationId, ...dataToUpdate } = updateData;

    // Handle organization role update if provided
    if (orgRole && organizationId) {
      // Validate orgRole
      if (!["TENANT_ADMIN", "MEMBER"].includes(orgRole)) {
        throw new AppError(
          "Invalid orgRole. Allowed values: TENANT_ADMIN, MEMBER",
          HttpStatusCodes.BAD_REQUEST
        );
      }

      // Update or create user-organization relationship
      await UserOrganization.findOneAndUpdate(
        { userId, organizationId },
        { orgRole, status: "ACTIVE" },
        { upsert: true, new: true }
      );

      // If setting as active organization, update user's activeOrganizationId
      if (updateData.setAsActive) {
        dataToUpdate.activeOrganizationId = organizationId;
      }
    }

    const updatedUser = await User.findByIdAndUpdate(userId, dataToUpdate, {
      new: true,
    });

    if (!updatedUser) {
      throw new AppError("User profile not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Format user with RBAC data
    const formattedUser = await formatUserWithRBAC(updatedUser);

    return {
      message: "User profile updated successfully.",
      user: formattedUser,
      profile: formattedUser, // Keep for backward compatibility
      success: true,
    };
  }

  static async getUser(userId) {
    const user = await User.findById(userId).select(
      "_id email fullName name role status isSuperAdmin activeOrganizationId permissions profilePhoto userName createdAt updatedAt"
    );

    if (!user) throw new AppError("User not found.", HttpStatusCodes.NOT_FOUND);

    // Format user with RBAC data
    const formattedUser = await formatUserWithRBAC(user);

    return {
      message: "User fetched successfully.",
      user: formattedUser,
      success: true,
    };
  }

  static async deleteUser(userId) {
    const user = await User.findOne({
      _id: new mongoose.Types.ObjectId(userId),
      status: "ACTIVE",
    });

    if (!user) {
      throw new AppError("Active user not found", HttpStatusCodes.NOT_FOUND);
    }

    // Soft delete by updating status to inactive
    await User.findByIdAndUpdate(userId, { status: "INACTIVE" });

    return {
      message: "user deactivated successfully",
      success: true,
    };
  }

  static async forgotPassword(data) {
    const { email } = data;

    const user = await User.findOne({ email });
    if (!user) {
      throw new AppError("User not found.", HttpStatusCodes.NOT_FOUND);
    }

    // const otp = crypto.randomInt(100000, 999999).toString();
    const otp = "1234";
    await User.findByIdAndUpdate(user.id, { otp, otpCreatedAt: new Date() });
    // await sendForgotPasswordEmail({ email, otp });
    // sendOtpEmail(user.email, otp);

    return {
      message:
        "OTP has been sent to your email. Please verify to reset your password.",
      success: true,
      data: user,
    };
  }

  static async updatePassword(data) {
    console.log("data<>><<>", data);
    const { email, newPassword } = data;

    if (!newPassword) {
      throw new AppError("New password is required.", 400);
    }

    const user = await User.findOne({ email });
    if (!user) {
      throw new AppError("User not found.", HttpStatusCodes.BAD_REQUEST);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const updatedUser = await User.findByIdAndUpdate(
      user.id,
      { password: hashedPassword },
      { new: true }
    );

    return {
      message: "Password updated successfully.",
      success: true,
      user: updatedUser,
    };
  }

  static async changePassword({ userId, oldPassword, newPassword }) {
    if (!oldPassword || !newPassword) {
      throw new AppError("Old and new passwords are required.", 400);
    }
    const user = await User.findById(userId).select(
      "_id password email fullName role status createdAt updatedAt"
    );
    if (!user) {
      throw new AppError("User not found.", 404);
    }
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      throw new AppError("Old password is incorrect.", 400);
    }
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { password: await bcrypt.hash(newPassword, 10) },
    });
    return {
      message: "Password changed successfully.",
      success: true,
      user: updatedUser,
    };
  }

  static async updateProfile(userId, data) {
    try {
      // Destructure all possible updatable fields
      const {
        // Basic profile fields
        userName,
        password,
        profilePhoto,
        email,
        fullName,
      } = data;

      const userToUpdate = await User.findById(userId);
      if (!userToUpdate) {
        throw new AppError("User not found.", HttpStatusCodes.NOT_FOUND);
      }

      let updates = {};

      // Check email uniqueness if email is being updated
      if (email && email !== userToUpdate.email) {
        const emailExists = await User.findOne({
          email,
          _id: { $ne: new mongoose.Types.ObjectId(userId) },
        });
        if (emailExists) {
          throw new AppError(
            "Email already exists. Please use another email.",
            HttpStatusCodes.BAD_REQUEST
          );
        }
        updates.email = email;
      }

      // Handle profile photo as URL only
      if (profilePhoto) {
        updates.profilePhoto = profilePhoto;
      }

      // Handle password update
      if (password) {
        if (!password) {
          throw new AppError("Password is required.", 400);
        }
        updates.password = await bcrypt.hash(password, 10);
      }

      // Handle username update
      if (userName) {
        const existingUser = await User.findOne({
          userName,
          _id: { $ne: new mongoose.Types.ObjectId(userId) },
        });
        if (existingUser) {
          throw new AppError(
            "Username already taken.",
            HttpStatusCodes.BAD_REQUEST
          );
        }
        updates.userName = userName;
      }

      // Basic profile fields
      if (fullName !== undefined) updates.fullName = fullName;

      if (Object.keys(updates).length > 0) {
        const updatedUser = await User.findByIdAndUpdate(userId, updates, {
          new: true,
        });

        return {
          message: "Profile updated successfully.",
          success: true,
          user: updatedUser,
        };
      }

      return {
        message: "No changes to update.",
        success: true,
        user: userToUpdate,
      };
    } catch (error) {
      throw new AppError(
        error.message || "Failed to update profile.",
        error.statusCode || HttpStatusCodes.INTERNAL_SERVER_ERROR
      );
    }
  }

  static async getUserByToken(userId) {
    const user = await User.findById(userId).select(
      "_id email fullName name role status isSuperAdmin activeOrganizationId permissions profilePhoto userName createdAt updatedAt"
    );

    if (!user) throw new AppError("User not found.", HttpStatusCodes.NOT_FOUND);

    // Format user with RBAC data
    const formattedUser = await formatUserWithRBAC(user);

    return {
      message: "User fetched successfully.",
      user: formattedUser,
      success: true,
    };
  }

  // Approval Management Methods
  static async getPendingApprovals(query) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = {
      approvalStatus: "PENDING",
      status: "PENDING_APPROVAL"
    };

    const totalUsers = await User.countDocuments(filter);
    const totalPages = Math.ceil(totalUsers / limit);

    const users = await User.find(filter)
      .select("_id email fullName name requestedRole role status approvalStatus createdAt")
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    // Format users to match expected structure
    const formattedUsers = users.map(user => ({
      id: user._id.toString(),
      _id: user._id.toString(),
      email: user.email,
      fullName: user.fullName || user.name,
      role: user.requestedRole || user.role,
      status: user.status,
      createdAt: user.createdAt,
    }));

    return {
      message: "Pending approvals fetched successfully.",
      success: true,
      data: formattedUsers,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems: totalUsers,
        limit,
      },
    };
  }

  /**
   * Get user permissions based on role and organization role
   * @param {string} userId - User ID
   * @param {boolean} customOnly - If true, return only custom permissions (not role-based)
   * @returns {Object} Permissions object
   */
  static async getUserPermissions(userId, customOnly = false) {
    const user = await User.findById(userId).select(
      "_id role isSuperAdmin permissions activeOrganizationId"
    );

    if (!user) {
      throw new AppError("User not found.", HttpStatusCodes.NOT_FOUND);
    }

    // If only custom permissions requested, return those
    if (customOnly) {
      return {
        permissions: user.permissions || [],
        success: true,
      };
    }

    // Check if user is tenant admin
    let isTenantAdmin = false;
    if (user.activeOrganizationId) {
      const userOrg = await UserOrganization.findOne({
        userId: user._id,
        organizationId: user.activeOrganizationId,
        status: "ACTIVE"
      });
      isTenantAdmin = userOrg && userOrg.orgRole === "TENANT_ADMIN";
    }

    const isSuperAdmin = user.isSuperAdmin === true || user.role === "SUPER_ADMIN";
    
    // Get permissions based on role
    const permissions = getPermissionsForRole(
      user.role,
      isSuperAdmin,
      isTenantAdmin,
      user.permissions || []
    );

    return {
      permissions,
      success: true,
    };
  }

  /**
   * Update user custom permissions
   * @param {string} userId - User ID
   * @param {Array} permissions - Array of permission strings
   * @returns {Object} Updated permissions
   */
  static async updateUserPermissions(userId, permissions) {
    const user = await User.findById(userId);

    if (!user) {
      throw new AppError("User not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Validate permissions format
    if (!Array.isArray(permissions)) {
      throw new AppError(
        "Permissions must be an array.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate permission format (category.module.action)
    const permissionPattern = /^[a-z_]+\.[a-z_]+\.[a-z_]+$/;
    for (const permission of permissions) {
      if (typeof permission !== "string" || !permissionPattern.test(permission)) {
        throw new AppError(
          `Invalid permission format: ${permission}. Expected format: category.module.action`,
          HttpStatusCodes.BAD_REQUEST
        );
      }
    }

    // Update user permissions
    user.permissions = [...new Set(permissions)]; // Remove duplicates
    await user.save();

    return {
      success: true,
      message: "Permissions updated successfully",
      permissions: user.permissions,
    };
  }

  /**
   * Switch user's active organization
   * @param {string} userId - User ID
   * @param {string} organizationId - Organization ID to switch to
   * @returns {Object} Updated user object
   */
  static async switchOrganization(userId, organizationId) {
    const user = await User.findById(userId);

    if (!user) {
      throw new AppError("User not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Super admin can switch to any organization (or no organization)
    if (user.isSuperAdmin || user.role === "SUPER_ADMIN") {
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { activeOrganizationId: organizationId || null },
        { new: true }
      ).select("_id email fullName name role status isSuperAdmin activeOrganizationId permissions profilePhoto userName createdAt updatedAt");

      const formattedUser = await formatUserWithRBAC(updatedUser);
      
      return {
        message: "Organization switched successfully.",
        success: true,
        user: formattedUser,
      };
    }

    // Regular users can only switch to organizations they belong to
    if (!organizationId) {
      throw new AppError(
        "Organization ID is required for non-super admin users.",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Verify user belongs to this organization
    const userOrg = await UserOrganization.findOne({
      userId: user._id,
      organizationId: organizationId,
      status: "ACTIVE"
    });

    if (!userOrg) {
      throw new AppError(
        "You do not belong to this organization.",
        HttpStatusCodes.FORBIDDEN
      );
    }

    // Update active organization
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { activeOrganizationId: organizationId },
      { new: true }
    ).select("_id email fullName name role status isSuperAdmin activeOrganizationId permissions profilePhoto userName createdAt updatedAt");

    // Format user with RBAC data
    const formattedUser = await formatUserWithRBAC(updatedUser);

    return {
      message: "Organization switched successfully.",
      success: true,
      user: formattedUser,
    };
  }

  static async approveUser(userId, superAdminId, assignedRole) {
    const user = await User.findById(userId);
    
    if (!user) {
      throw new AppError("User not found.", HttpStatusCodes.NOT_FOUND);
    }

    if (user.approvalStatus !== "PENDING") {
      throw new AppError(
        `User is already ${user.approvalStatus.toLowerCase()}.`,
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Validate assigned role (SUPER_ADMIN can only be assigned manually, not through approval)
    if (!["ADMIN", "OPERATIONS", "FINANCE", "DRIVER", "STAFF"].includes(assignedRole)) {
      throw new AppError(
        "Invalid role. Allowed roles: ADMIN, OPERATIONS, FINANCE, DRIVER, STAFF",
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // If approving a DRIVER, handle driver-specific approval flow
    if (assignedRole === "DRIVER") {
      return await this.approveDriverApplication(userId, superAdminId);
    }

    // Update user: approve and assign role
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        role: assignedRole,
        status: "ACTIVE",
        approvalStatus: "APPROVED",
        approvedBy: superAdminId,
        approvedAt: new Date(),
      },
      { new: true }
    );

    // Format user with RBAC data
    const formattedUser = await formatUserWithRBAC(updatedUser);

    return {
      message: "User approved successfully.",
      success: true,
      user: formattedUser,
    };
  }

  /**
   * Approve driver application (Driver Requests)
   * Creates user account with default password and updates driver status to NEW_RECRUIT
   * @param {string} userId - User ID
   * @param {string} superAdminId - Admin ID approving the driver
   * @returns {Object} User and driver objects
   */
  static async approveDriverApplication(userId, superAdminId) {
    const Driver = require("../models/driver.model");
    const Party = require("../models/party.model");
    const bcrypt = require("bcrypt");
    const { sendDriverInductionApprovedEmail } = require("../utils/email");

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError("User not found.", HttpStatusCodes.NOT_FOUND);
    }

    // Find driver record
    const driver = await Driver.findOne({ userId: user._id }).populate("party");
    if (!driver) {
      throw new AppError(
        "Driver record not found. Cannot approve driver application.",
        HttpStatusCodes.NOT_FOUND
      );
    }

    // Verify driver is in PENDING_RECRUIT status
    if (driver.driverStatus !== "PENDING_RECRUIT") {
      throw new AppError(
        `Driver is not in PENDING_RECRUIT status. Current status: ${driver.driverStatus}`,
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // CRITICAL: Create/update user account with default password
    const defaultPassword = "123456";
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    // Get driver's email and name from party record
    const driverEmail = driver.party?.email || user.email;
    const driverFirstName = driver.party?.firstName || user.fullName?.split(" ")[0] || "";
    const driverLastName = driver.party?.lastName || user.fullName?.split(" ").slice(1).join(" ") || "";
    const driverFullName = `${driverFirstName} ${driverLastName}`.trim() || user.fullName;

    // Generate username from email if not exists
    let username = user.userName;
    if (!username) {
      const emailPrefix = driverEmail.split("@")[0];
      const randomSuffix = Math.random().toString(36).substring(7);
      username = `${emailPrefix}_${randomSuffix}`;
    }

    // Update user account
    user.password = passwordHash;
    user.userName = username;
    user.fullName = driverFullName;
    user.name = driverFullName;
    user.role = "DRIVER";
    user.status = "ACTIVE";
    user.approvalStatus = "APPROVED";
    user.approvedBy = superAdminId;
    user.approvedAt = new Date();
    user.passwordChangeRequired = true;
    user.permissions = ensureDriverPermissions(user.permissions);
    await user.save();

    // Update driver record
    driver.driverStatus = "NEW_RECRUIT";
    driver.complianceStatus = "PENDING_INDUCTION";
    driver.isActive = false; // Still inactive until induction is approved
    driver.userId = user._id; // Ensure userId is linked
    await driver.save();

    // Send approval email to driver with login credentials
    try {
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
      await sendDriverInductionApprovedEmail({
        email: driverEmail,
        firstName: driverFirstName,
        lastName: driverLastName,
        username: username,
        password: defaultPassword,
        loginUrl: `${frontendUrl}/login`,
        changePasswordUrl: `${frontendUrl}/profile`,
        subject: "Driver Application Approved - Complete Your Induction",
        isApplicationApproval: true, // Flag to indicate this is application approval, not induction approval
      });

      console.log(`✅ Sent approval email to driver: ${driverEmail}`);
    } catch (emailError) {
      console.error("Error sending approval email:", emailError);
      // Continue even if email fails
    }

    // Format user with RBAC data
    const formattedUser = await formatUserWithRBAC(user);

    return {
      success: true,
      message: "Driver approved successfully",
      user: formattedUser,
      driver: {
        id: driver._id.toString(),
        driverStatus: driver.driverStatus,
        complianceStatus: driver.complianceStatus,
        isActive: driver.isActive,
      },
    };
  }

  static async rejectUser(userId, superAdminId, rejectionReason) {
    const user = await User.findById(userId);
    
    if (!user) {
      throw new AppError("User not found.", HttpStatusCodes.NOT_FOUND);
    }

    if (user.approvalStatus !== "PENDING") {
      throw new AppError(
        `User is already ${user.approvalStatus.toLowerCase()}.`,
        HttpStatusCodes.BAD_REQUEST
      );
    }

    // Update user: reject
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        status: "REJECTED",
        approvalStatus: "REJECTED",
        approvedBy: superAdminId,
        approvedAt: new Date(),
      },
      { new: true }
    );

    return {
      message: "User rejected successfully.",
      success: true,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        fullName: updatedUser.fullName,
        status: updatedUser.status,
        approvalStatus: updatedUser.approvalStatus,
        approvedAt: updatedUser.approvedAt,
      },
    };
  }
}

module.exports = UserService;
