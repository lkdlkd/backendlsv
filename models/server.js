const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema({
  //tt bên thứ 3
  DomainSmm: { type: String, required: true },//bên thứ 3 lấy từ smmsv
  serviceName: { type: String, required: false },//sv name ở bên thứ 3
  originalRate: { type: Number, required: true },//giá lấy bên thứ 3
  // loai dv 
  category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true }, // Tham chiếu đến Category
  type: { type: mongoose.Schema.Types.ObjectId, ref: "Platform", required: true },
  description: { type: String, required: false },//mô tả sv
  //server
  Magoi: { type: String, required: true },// ma goi moi khi thêm
  name: { type: String, required: true },// tăng like tiktok, tăng view titkok
  rate: { type: Number, required: true },//giá lấy bên thứ 3* với smmPartner.price_update,
  maychu: { type: String, required: false },//sv1
  min: { type: Number, required: true },//min lấy bên thứ 3
  max: { type: Number, required: true },//max lấy bên thứ 3
  Linkdv: { type: String, required: false },//facebook-like, tiktok-view...
  serviceId: { type: String, required: true },//sv ở bên thứ 3
  //option
  getid: { type: String, enum: ["on", "off"], default: "on" },//chức năng get id sau khi nhập link mua
  comment: { type: String, enum: ["on", "off"], default: "of" },//chức năng get id sau khi nhập link mua
  reaction: { type: String, enum: ["on", "off"], default: "of" },//chức năng get id sau khi nhập link mua
  matlive: { type: String, enum: ["on", "off"], default: "of" },//chức năng get id sau khi nhập link mua
  isActive: { type: Boolean, default: true }, // Hiển thị hoặc ẩn dịch vụ
  domain: { type: String, default: null },
}, { timestamps: true }); // Thêm createdAt và updatedAt tự động

module.exports = mongoose.model('Service', serviceSchema);
