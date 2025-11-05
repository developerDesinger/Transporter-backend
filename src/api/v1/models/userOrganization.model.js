const mongoose = require("mongoose");

const UserOrganizationSchema = new mongoose.Schema(
  {
    userId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true,
      index: true 
    },
    organizationId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "Organization", 
      required: true,
      index: true 
    },
    orgRole: { 
      type: String, 
      enum: ["TENANT_ADMIN", "MEMBER"], 
      default: "MEMBER",
      required: true 
    },
    status: { 
      type: String, 
      enum: ["ACTIVE", "INACTIVE"], 
      default: "ACTIVE" 
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Compound index to ensure one user can only have one role per organization
UserOrganizationSchema.index({ userId: 1, organizationId: 1 }, { unique: true });

module.exports = mongoose.model("UserOrganization", UserOrganizationSchema);

