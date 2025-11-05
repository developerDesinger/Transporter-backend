const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    fullName: { type: String },
    profilePhoto: { type: String, default: "default-profile.png" },
    email: { type: String, required: true, unique: true, index: true },
    password: { type: String },
    role: { type: String, enum: ["SUPER_ADMIN", "ADMIN", "OPERATIONS", "FINANCE", "DRIVER", "STAFF"], default: "STAFF" },
    requestedRole: { type: String, enum: ["ADMIN", "OPERATIONS", "FINANCE", "DRIVER", "STAFF"] },
    status: { type: String, enum: ["ACTIVE", "INACTIVE", "PENDING_APPROVAL", "REJECTED"], default: "PENDING_APPROVAL" },
    approvalStatus: { type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "PENDING" },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },
    otp: { type: String },
    otpCreatedAt: { type: Date, default: Date.now },
    userName: { type: String, unique: true, sparse: true },
    loginType: {
      type: String,
      enum: ["EMAIL", "GOOGLE", "APPLE", "FACEBOOK"],
      default: "EMAIL",
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

module.exports = mongoose.model("User", UserSchema);
