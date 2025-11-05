const mongoose = require("mongoose");

const PartySchema = new mongoose.Schema(
  {
    firstName: { type: String },
    lastName: { type: String },
    companyName: { type: String },
    email: { type: String, index: true },
    phone: { type: String },
    phoneAlt: { type: String },
    contactName: { type: String },
    suburb: { type: String },
    state: { type: String },
    postcode: { type: String },
    address: { type: String },
    // Additional fields for drivers
    abn: { type: String },
    stateRegion: { type: String },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

module.exports = mongoose.model("Party", PartySchema);

