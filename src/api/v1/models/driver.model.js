const mongoose = require("mongoose");

const DriverSchema = new mongoose.Schema(
  {
    partyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Party",
      required: true,
      index: true,
    },
    driverCode: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      uppercase: true,
    },
    employmentType: {
      type: String,
      enum: ["EMPLOYEE", "CONTRACTOR", "CASUAL"],
      default: "CONTRACTOR",
    },
    isActive: { type: Boolean, default: true, index: true },
    // Compliance expiry dates
    licenseExpiry: { type: Date },
    motorInsuranceExpiry: { type: Date },
    publicLiabilityExpiry: { type: Date },
    marineCargoExpiry: { type: Date },
    workersCompExpiry: { type: Date },
    // Driver Portal fields
    abn: { type: String },
    bankName: { type: String },
    bsb: { type: String },
    accountNumber: { type: String },
    accountName: { type: String },
    servicesProvided: [{ type: String }],
    contactType: { type: String },
    complianceStatus: { type: String, default: "Pending Review" },
    vehicleTypesInFleet: [{ type: String }],
    fleetSize: { type: String },
    gstRegistered: { type: Boolean, default: false },
    // Insurance policy numbers
    motorInsurancePolicyNumber: { type: String },
    marineCargoInsurancePolicyNumber: { type: String },
    publicLiabilityPolicyNumber: { type: String },
    workersCompPolicyNumber: { type: String },
    // Link to user account
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Virtual to populate party data
DriverSchema.virtual("party", {
  ref: "Party",
  localField: "partyId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("Driver", DriverSchema);

