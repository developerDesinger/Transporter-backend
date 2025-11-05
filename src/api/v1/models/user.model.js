const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    fullName: { type: String },
    name: { type: String }, // Alternative name field for compatibility
    profilePhoto: { type: String, default: "default-profile.png" },
    email: { type: String, required: true, unique: true, index: true },
    password: { type: String },
    role: { type: String, enum: ["SUPER_ADMIN", "ADMIN", "OPERATIONS", "FINANCE", "DRIVER", "STAFF"], default: "STAFF" },
    requestedRole: { type: String, enum: ["ADMIN", "OPERATIONS", "FINANCE", "DRIVER", "STAFF"] },
    status: { type: String, enum: ["ACTIVE", "INACTIVE", "PENDING_VERIFICATION", "PENDING_INDUCTION", "PENDING_APPROVAL", "REJECTED"], default: "PENDING_APPROVAL" },
    approvalStatus: { type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "APPROVED" },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },
    otp: { type: String },
    otpCreatedAt: { type: Date, default: Date.now },
    userName: { type: String, unique: true, sparse: true },
    passwordChangeRequired: { type: Boolean, default: false },
    loginType: {
      type: String,
      enum: ["EMAIL", "GOOGLE", "APPLE", "FACEBOOK"],
      default: "EMAIL",
    },
    // RBAC fields
    isSuperAdmin: { type: Boolean, default: false },
    activeOrganizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization" },
    permissions: [{ type: String }], // Array of custom permission strings
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Virtual to determine if user is super admin (check both isSuperAdmin flag and role)
UserSchema.virtual("isPlatformSuperAdmin").get(function () {
  return this.isSuperAdmin === true || this.role === "SUPER_ADMIN";
});

module.exports = mongoose.model("User", UserSchema);
