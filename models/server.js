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
  // Lấy tất cả cặp SvID + DomainSmm duy nhất trong Order
  const combos = await Order.aggregate([
    { $group: { _id: { SvID: "$SvID", DomainSmm: "$DomainSmm" } } }
  ]);
  const results = [];
  for (const combo of combos) {
    const { SvID, DomainSmm } = combo._id;
    const tocdo = await this.updateTocDoDuKien(SvID, DomainSmm);
    results.push({ SvID, DomainSmm, tocdo });
  }
  return results;
};
// Static method: Tính và cập nhật tốc độ dự kiến
// serviceSchema.statics.updateTocDoDuKien = async function (serviceId, domainSmm) {
//   const sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
//   let orderQuery = {
//     SvID: serviceId,
//     status: 'Completed',
//     createdAt: { $gte: sinceDate },
//   };
//   if (domainSmm) orderQuery.DomainSmm = domainSmm;

//   let orders = await Order.find(orderQuery)
//     .sort({ updatedAt: -1 })
//     .limit(10)
//     .lean();

//   // Nếu không có đơn nào trong 7 ngày, lấy 10 đơn gần nhất
//   if (!orders.length) {
//     let fallbackQuery = {
//       SvID: serviceId,
//       status: 'Completed',
//     };
//     if (domainSmm) fallbackQuery.DomainSmm = domainSmm;
//     orders = await Order.find(fallbackQuery)
//       .sort({ updatedAt: -1 })
//       .limit(10)
//       .lean();
//   }

//   if (!orders.length) return null;

//   // Tính trung bình trọng số theo dachay
//   let totalWeightedSpeed = 0;
//   let totalDachay = 0;

//   for (const order of orders) {
//     const timeMs = new Date(order.updatedAt) - new Date(order.createdAt);
//     const soLuong = order.dachay || order.quantity || 0;
//     if (soLuong === 0) continue;

//     const speedPer1000 = (timeMs / soLuong) * 1000 / 1000; // giây/1000
//     totalWeightedSpeed += speedPer1000 * soLuong;
//     totalDachay += soLuong;
//   }

//   if (totalDachay === 0) return null;

//   const avgSeconds = totalWeightedSpeed / totalDachay;
// if (isNaN(avgSeconds)) return null; // <-- thêm dòng này

//   // Format tốc độ về dạng "Xh Ym Zs/1000"
//   const hours = Math.floor(avgSeconds / 3600);
//   const minutes = Math.floor((avgSeconds % 3600) / 60);
//   const seconds = Math.floor(avgSeconds % 60);
//   let avgSpeedStr = '';
//   if (hours > 0) avgSpeedStr += hours + 'h ';
//   if (minutes > 0 || hours > 0) avgSpeedStr += minutes + 'm ';
//   avgSpeedStr += seconds + 's/1000';

//   // Cập nhật vào field `tocdodukien`
//   const updateQuery = domainSmm ? { serviceId, DomainSmm: domainSmm } : { serviceId };
//   await this.updateOne(updateQuery, { tocdodukien: avgSpeedStr });
//   return avgSpeedStr;
// };
serviceSchema.statics.updateTocDoDuKien = async function (serviceId, domainSmm) {
  const sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  let orderQuery = {
    SvID: serviceId,
    status: 'Completed',
    createdAt: { $gte: sinceDate },
  };
  if (domainSmm) orderQuery.DomainSmm = domainSmm;

  let orders = await Order.find(orderQuery)
    .sort({ updatedAt: -1 })
    .limit(10)
    .lean();

  // Nếu không có đơn nào trong 7 ngày, lấy 10 đơn gần nhất
  if (!orders.length) {
    let fallbackQuery = {
      SvID: serviceId,
      status: 'Completed',
    };
    if (domainSmm) fallbackQuery.DomainSmm = domainSmm;
    orders = await Order.find(fallbackQuery)
      .sort({ updatedAt: -1 })
      .limit(10)
      .lean();
  }

  if (!orders.length) return null;

  let totalSoLuong = 0;
  let totalTimeSeconds = 0;

  for (const order of orders) {
    const { createdAt, updatedAt, dachay, quantity } = order;

    // Kiểm tra ngày hợp lệ
    if (!createdAt || !updatedAt) continue;
    const timeMs = new Date(updatedAt) - new Date(createdAt);
    if (isNaN(timeMs) || timeMs <= 0) continue;

    // Lấy số lượng
    const soLuong = Number(dachay || quantity || 0);
    if (!soLuong || isNaN(soLuong) || soLuong <= 0) continue;

    const timeSeconds = timeMs / 1000;
    totalTimeSeconds += timeSeconds;
    totalSoLuong += soLuong;
  }

  if (totalSoLuong === 0 || totalTimeSeconds === 0) return null;

  const secondsPer1000 = (totalTimeSeconds / totalSoLuong) * 1000;
  if (!isFinite(secondsPer1000)) return null;

  const amountPerHour = Math.round((3600 / secondsPer1000) * 1000);

  // Format thời gian về dạng "Xh Ym Zs"
  const hours = Math.floor(secondsPer1000 / 3600);
  const minutes = Math.floor((secondsPer1000 % 3600) / 60);
  const seconds = Math.floor(secondsPer1000 % 60);

  let avgSpeedStr = '';
  if (hours > 0) avgSpeedStr += `${hours}h `;
  if (minutes > 0 || hours > 0) avgSpeedStr += `${minutes}m `;
  avgSpeedStr += `${seconds}s/1000`;
  avgSpeedStr += `  ( số lượng ~${amountPerHour.toLocaleString()}/h)`;

  // Cập nhật vào field `tocdodukien`
  const updateQuery = domainSmm
    ? { serviceId, DomainSmm: domainSmm }
    : { serviceId };
  await this.updateOne(updateQuery, { tocdodukien: avgSpeedStr });
  return avgSpeedStr;
};


module.exports = mongoose.model('Service', serviceSchema);
