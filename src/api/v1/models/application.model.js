const mongoose = require("mongoose");

const ApplicationSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    companyName: { type: String },
    suburb: { type: String, required: true },
    stateRegion: { type: String, required: true },
    phone: { type: String, required: true },
    servicesProvided: [{ type: String }], // JSON array
    contactType: {
      type: String,
      enum: ["Owner Operator", "Fleet Owner"],
      required: true,
    },
    vehicleTypesInFleet: [{ type: String }], // JSON array
    fleetSize: {
      type: String,
      enum: ["1 to 5", "5 to 10", "10 +"],
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING_INDUCTION", "COMPLETED", "EXPIRED"],
      default: "PENDING_INDUCTION",
      index: true,
    },
    submittedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Index for email and status queries
ApplicationSchema.index({ email: 1, status: 1 });

module.exports = mongoose.model("Application", ApplicationSchema);

