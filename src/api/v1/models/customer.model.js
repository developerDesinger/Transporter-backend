const mongoose = require("mongoose");

const CustomerSchema = new mongoose.Schema(
  {
    partyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Party",
      required: true,
      index: true,
    },
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

