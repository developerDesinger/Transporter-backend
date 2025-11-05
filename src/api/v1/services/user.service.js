const bcrypt = require("bcrypt");
const crypto = require("crypto");
const User = require("../models/user.model");
const mongoose = require("mongoose");
const AppError = require("../utils/AppError");
const HttpStatusCodes = require("../enums/httpStatusCode");
const { createJwtToken } = require("../middlewares/auth.middleware");
const { s3SharpImageUpload } = require("../services/aws.service");
const { sendEmail, sendForgotPasswordEmail } = require("../utils/email");

class UserService {
  static async createUser(data) {
    const { email, fullName, profilePhoto, role, password } = data;

    if (!email || !password) {
      throw new AppError(
        "Email and password are required.",
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
    let otp = "1234";

    // Prepare user data
    const userData = {
      email,
      fullName,
      requestedRole: role || "STAFF",
      role: "STAFF", // Default role until approved
      status: "INACTIVE",
      approvalStatus: "PENDING",
      otp,
      profilePhoto,
      otpCreatedAt: new Date(),
    };

    // Add password if provided
    if (password) {
      userData.password = await bcrypt.hash(password, 10);
    }

    if (user) {
      // User exists but is inactive - resend OTP and update role
      user.fullName = fullName;
      user.profilePhoto = profilePhoto;
      user.requestedRole = role || "STAFF";
      user.approvalStatus = "PENDING";
      user.otp = otp;
      user.otpCreatedAt = new Date();
      if (password) user.password = await bcrypt.hash(password, 10);
      await user.save();
    } else {
      // Create new user with or without password
      user = await User.create(userData);
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
    const otp = "1234";

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
        message: "Email, password, and role are required.",
        success: false,
      };
    }
    const user = await User.findOne({ email }).select(
      "_id email password role status fullName profilePhoto userName createdAt updatedAt"
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
    // if (user.role !== role) {
    //   throw new AppError(
    //     "Role mismatch. Access denied.",
    //     HttpStatusCodes.UNAUTHORIZED
    //   );
    // }
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

    const token = createJwtToken({ id: user.id, role: user.role });
    return {
      message: "Login successful.",
      success: true,
      user,
      token,
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

    const token = createJwtToken({ id: user.id, role: user.role });
    return {
      message: "Social login successful.",
      success: true,
      user,
      token,
    };
  }

  static async getAllUsers(query) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const skip = (page - 1) * limit;

    const totalUsers = await User.countDocuments({ status: "ACTIVE" });
    const totalPages = Math.ceil(totalUsers / limit);

    const users = await User.find({ status: "ACTIVE" })
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

    return {
      message: "Users fetched successfully.",
      success: true,
      data: users,
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
    const { password, ...dataToUpdate } = updateData;

    const updatedUser = await User.findByIdAndUpdate(userId, dataToUpdate, {
      new: true,
    });

    if (!updatedUser) {
      throw new AppError("User profile not found.", HttpStatusCodes.NOT_FOUND);
    }

    return {
      message: "User profile updated successfully.",
      profile: updatedUser,
      success: true,
    };
  }

  static async getUser(userId) {
    const user = await User.findById(userId);

    if (!user) throw new AppError("User not found.", HttpStatusCodes.NOT_FOUND);

    return {
      message: "User updated successfully.",
      user,
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
    const user = await User.findById(userId);

    if (!user) throw new AppError("User not found.", HttpStatusCodes.NOT_FOUND);

    return {
      message: "User updated successfully.",
      user,
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
      .select("_id email fullName requestedRole status approvalStatus createdAt")
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    return {
      message: "Pending approvals fetched successfully.",
      success: true,
      data: users,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems: totalUsers,
        limit,
      },
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

    return {
      message: "User approved successfully.",
      success: true,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        fullName: updatedUser.fullName,
        role: updatedUser.role,
        status: updatedUser.status,
        approvalStatus: updatedUser.approvalStatus,
        approvedAt: updatedUser.approvedAt,
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
