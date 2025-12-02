const mongoose = require("mongoose");

const PlanningSheetSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: false,
      default: null,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    columns: {
      type: [String],
      default: ["#", "Time", "Driver", "Vehicle", "Customer", "Job Details", "Pickup Location", "Delivery Location"],
    },
    rows: {
      type: [
        {
          id: {
            type: String,
            required: true,
          },
          rowNumber: {
            type: Number,
            required: true,
          },
          time: {
            type: String,
            default: null,
          },
          driver: {
            type: String,
            default: null,
          },
          vehicle: {
            type: String,
            default: null,
          },
          customer: {
            type: String,
            default: null,
          },
          jobDetails: {
            type: String,
            default: null,
          },
          pickupLocation: {
            type: String,
            default: null,
          },
          deliveryLocation: {
            type: String,
            default: null,
          },
          // Allow additional dynamic fields
        },
      ],
      default: [],
    },
    columnFormats: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound unique index: one planning sheet per organization per date
PlanningSheetSchema.index({ organizationId: 1, date: 1 }, { unique: true });

// Index for efficient date range queries
PlanningSheetSchema.index({ organizationId: 1, date: -1 });

module.exports = mongoose.model("PlanningSheet", PlanningSheetSchema);

