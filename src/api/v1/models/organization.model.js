const mongoose = require("mongoose");

const OrganizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, index: true },
    slug: { 
      type: String, 
      required: true, 
      unique: true, 
      lowercase: true,
      index: true,
      trim: true
    },
    status: { 
      type: String, 
      enum: ["active", "suspended", "trial", "cancelled", "deleted"], 
      default: "active",
      index: true
    },
    subscriptionTier: {
      type: String,
      enum: ["free", "basic", "premium", "enterprise"],
      default: "free"
    },
    
    // Contact Information
    primaryContactName: { type: String },
    primaryContactEmail: { type: String, index: true },
    primaryContactPhone: { type: String },
    billingEmail: { type: String },
    
    // Limits & Quotas
    maxUsers: { type: Number, default: 10 },
    maxDrivers: { type: Number, default: 50 },
    maxVehicles: { type: Number, default: 50 },
    
    // Features (Feature flags)
    features: {
      fatigueManagement: { type: Boolean, default: false },
      gpsTracking: { type: Boolean, default: false },
      advancedReporting: { type: Boolean, default: false },
      apiAccess: { type: Boolean, default: false },
    },
    
    // Metadata
    deletedAt: { type: Date, default: null },
    description: { type: String },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Index for soft delete queries
OrganizationSchema.index({ deletedAt: 1 });

// Virtual for users count
OrganizationSchema.virtual("usersCount", {
  ref: "UserOrganization",
  localField: "_id",
  foreignField: "organizationId",
  count: true,
  match: { status: "ACTIVE" }
});

module.exports = mongoose.model("Organization", OrganizationSchema);

