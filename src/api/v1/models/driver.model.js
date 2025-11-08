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
    isActive: { type: Boolean, default: false, index: true }, // Default false for new recruits
    // Driver onboarding status fields
    driverStatus: {
      type: String,
      enum: ["PENDING_RECRUIT", "NEW_RECRUIT", "PENDING_INDUCTION", "COMPLIANT", null],
      default: null,
      index: true,
    },
    complianceStatus: {
      type: String,
      enum: ["PENDING_APPROVAL", "PENDING_INDUCTION", "PENDING_REVIEW", "COMPLIANT", null],
      default: null,
      index: true,
    },
    approvedAt: { type: Date, default: null },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // Compliance expiry dates
    licenseExpiry: { type: Date },
    licenseDocumentFront: { type: String, default: null },
    licenseDocumentBack: { type: String, default: null },
    motorInsuranceExpiry: { type: Date },
    motorInsuranceDocument: { type: String, default: null },
    publicLiabilityExpiry: { type: Date },
    publicLiabilityDocument: { type: String, default: null },
    marineCargoExpiry: { type: Date },
    marineCargoInsuranceDocument: { type: String, default: null },
    workersCompExpiry: { type: Date },
    workersCompDocument: { type: String, default: null },
    policeCheckDocument: { type: String, default: null },
    // Driver Portal fields
    abn: { type: String },
    bankName: { type: String },
    bsb: { type: String },
    accountNumber: { type: String },
    accountName: { type: String },
    servicesProvided: [{ type: String }],
    contactType: { type: String },
    vehicleTypesInFleet: [{ type: String }],
    fleetSize: { type: String },
    gstRegistered: { type: Boolean, default: false },
    rctiAgreementAccepted: { type: Boolean, default: false }, // RCTI agreement acceptance
    // Driver fuel levy percentage
    driverFuelLevyPct: { type: String, default: null },
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

