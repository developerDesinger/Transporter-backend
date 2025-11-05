const mongoose = require("mongoose");

const OrganizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, index: true },
    status: { 
      type: String, 
      enum: ["ACTIVE", "SUSPENDED", "INACTIVE"], 
      default: "ACTIVE" 
    },
    description: { type: String },
    // Additional organization fields can be added here
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

module.exports = mongoose.model("Organization", OrganizationSchema);

