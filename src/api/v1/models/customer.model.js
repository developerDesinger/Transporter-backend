const mongoose = require("mongoose");

const CustomerSchema = new mongoose.Schema(
  {
    partyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Party",
      required: true,
      index: true,
    },
    // Company Information
    acn: { type: String }, // Australian Company Number
    legalCompanyName: { type: String },
    tradingName: { type: String },
    websiteUrl: { type: String },
    registeredAddress: { type: String },
    city: { type: String },
    state: { type: String },
    postcode: { type: String },
    // Primary Contact
    primaryContactName: { type: String },
    primaryContactPosition: { type: String },
    primaryContactEmail: { type: String },
    primaryContactPhone: { type: String },
    primaryContactMobile: { type: String },
    // Accounts Contact
    accountsName: { type: String },
    accountsEmail: { type: String },
    accountsPhone: { type: String },
    accountsMobile: { type: String },
    // Billing & Payment
    termsDays: { type: Number, default: 30 },
    defaultFuelLevyPct: { type: String },
    invoiceGrouping: {
      type: String,
      enum: ["DAY", "WEEK", "MONTH"],
      default: "DAY",
    },
    invoicePrefix: { type: String, default: "INV" },
    // Onboarding
    onboardingStatus: {
      type: String,
      enum: ["DRAFT", "SENT", "SUBMITTED", "APPROVED", "REJECTED"],
      default: "DRAFT",
    },
    onboardingSentAt: { type: Date },
    // Service Information
    serviceStates: [{ type: String }], // Array of state codes
    serviceCities: [{ type: String }], // Array of city names
    serviceTypes: [{ type: String }], // Array of service types: "INTERSTATE", "METRO"
    // Pallet Information
    palletsUsed: { type: Boolean, default: false },
    chepAccountNumber: { type: String },
    loscamAccountNumber: { type: String },
    palletControllerName: { type: String },
    palletControllerEmail: { type: String },
    // Status
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Virtual to populate party data
CustomerSchema.virtual("party", {
  ref: "Party",
  localField: "partyId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("Customer", CustomerSchema);

