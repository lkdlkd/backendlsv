const mongoose = require('mongoose');
const Order = require('./Order'); // Import model Order

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
  Magoi: { type: String, required: true },// ma goi moi khi them
  name: { type: String, required: true },// tăng like tiktok, tăng view titkok
  rate: { type: Number, required: true },//giá lấy bên thứ 3* với smmPartner.price_update,
  maychu: { type: String, required: false },//sv1
  min: { type: Number, required: true },//min lấy bên thứ 3
  max: { type: Number, required: true },//max lấy bên thứ 3
  Linkdv: { type: String, required: false },//facebook-like, tiktok-view...
  tocdodukien: { type: String, required: false },//tốc độ dự kiến
  serviceId: { type: String, required: true },//sv ở bên thứ 3
  //option
  getid: { type: String, enum: ["on", "off"], default: "on" },//chức năng get id sau khi nhập link mua
  comment: { type: String, enum: ["on", "off"], default: "of" },//chức năng get id sau khi nhập link mua
  reaction: { type: String, enum: ["on", "off"], default: "of" },//chức năng get id sau khi nhập link mua
  matlive: { type: String, enum: ["on", "off"], default: "of" },//chức năng get id sau khi nhập link mua
  isActive: { type: Boolean, default: true }, // Hiển thị hoặc ẩn dịch vụ
  domain: { type: String, default: null },
}, { timestamps: true }); // Thêm createdAt và updatedAt tự động

// Hàm cập nhật tốc độ dự kiến cho tất cả dịch vụ có trong Order
serviceSchema.statics.updateAllTocDoDuKien = async function () {
  const svIds = await Order.distinct('SvID');
  const results = [];
  for (const svId of svIds) {
    const tocdo = await this.updateTocDoDuKien(svId);
    results.push({ SvID: svId, tocdo });
  }
  return results;
};

// Static method: Tính và cập nhật tốc độ dự kiến
serviceSchema.statics.updateTocDoDuKien = async function (serviceId) {
  // Lấy tối đa 10 đơn hàng completed, trong vòng 7 ngày gần nhất
  const sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  let orders = await Order.find({
    SvID: serviceId,
    status: 'Completed',
    dachay: { $gt: 0 },
    createdAt: { $gte: sinceDate }
  })
    .sort({ updatedAt: -1 })
    .limit(10)
    .lean();

  // Nếu không có đơn nào trong 7 ngày, lấy 10 đơn gần nhất bất kỳ
  if (!orders.length) {
    orders = await Order.find({
      SvID: serviceId,
      status: 'Completed',
      dachay: { $gt: 0 }
    })
      .sort({ updatedAt: -1 })
      .limit(10)
      .lean();
  }

  if (!orders.length) return null;

  // Tính tốc độ từng đơn (ms/1000)
  const speeds = orders.map(order => {
    const timeMs = new Date(order.updatedAt) - new Date(order.createdAt);
    const soLuong = order.dachay || order.quantity || 0;
    if (soLuong === 0) return null;
    // Thời gian hoàn thành 1000 đơn vị (giây)
    return (timeMs / soLuong) * 1000 / 1000; // Đơn vị: giây
  }).filter(Boolean);

  if (!speeds.length) return null;

  // Trung bình (giây)
  const avgSeconds = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  // Đổi sang h m s
  const hours = Math.floor(avgSeconds / 3600);
  const minutes = Math.floor((avgSeconds % 3600) / 60);
  const seconds = Math.floor(avgSeconds % 60);
  let avgSpeedStr = '';
  if (hours > 0) avgSpeedStr += hours + 'h ';
  if (minutes > 0 || hours > 0) avgSpeedStr += minutes + 'm ';
  avgSpeedStr += seconds + 's/1000';

  // Cập nhật vào trường tocdodukien
  await this.updateOne({ serviceId }, { tocdodukien: avgSpeedStr });
  return avgSpeedStr;
};

module.exports = mongoose.model('Service', serviceSchema);
