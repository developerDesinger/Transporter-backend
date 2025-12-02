const mongoose = require("mongoose");

const StatementSchema = new mongoose.Schema(
  {
    statementNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    statementDate: {
      type: Date,
      required: true,
      index: true,
    },
    periodStart: {
      type: Date,
      required: true,
    },
    periodEnd: {
      type: Date,
      required: true,
    },
    openingBalance: {
      type: Number,
      required: true,
      default: 0,
    },
    closingBalance: {
      type: Number,
      required: true,
      default: 0,
    },
    totalInvoiced: {
      type: Number,
      required: false,
      default: 0,
    },
    totalPaid: {
      type: Number,
      required: false,
      default: 0,
    },
    status: {
      type: String,
      enum: ["Draft", "Sent", "CREATED", "FAILED"],
      default: "CREATED",
      index: true,
    },
    sentAt: {
      type: Date,
      default: null,
    },
    sentTo: {
      type: String,
      default: null,
      trim: true,
    },
    ccEmails: {
      type: [String],
      default: [],
    },
    notes: {
      type: String,
      default: null,
      trim: true,
    },
    pdfUrl: {
      type: String,
      default: null,
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      default: null,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: false,
      default: null,
      index: true,
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Indexes
StatementSchema.index({ organizationId: 1, customerId: 1 });
StatementSchema.index({ organizationId: 1, status: 1 });
StatementSchema.index({ organizationId: 1, statementDate: -1 });

// Virtual to populate customer
StatementSchema.virtual("customer", {
  ref: "Customer",
  localField: "customerId",
  foreignField: "_id",
  justOne: true,
});

module.exports = mongoose.model("Statement", StatementSchema);

