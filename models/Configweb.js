const mongoose = require("mongoose");

const configwebSchema = new mongoose.Schema({
  tieude: { type: String, default: "" },
  title: { type: String, default: "" },
  logo: { type: String, default: "" },
  favicon: { type: String, default: "" },
  linktele: { type: String, default: "https://t.me/noti_web_245_bot" },
  cuphap: { type: String, default: "naptien" },
  lienhe: [
    {
      type: { type: String, default: "" },
      value: { type: String, default: "" },
      logolienhe: { type: String, default: "" },
    },
  ],
  domain: { type: String, default: null },

}, { timestamps: true });

module.exports = mongoose.model("Configweb", configwebSchema);