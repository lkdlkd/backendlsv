// // Script cập nhật DomainSmm cho cả Service (server) và Order thành ObjectId reference
// // Chạy script này một lần khi cần migrate dữ liệu cũ
// const mongoose = require('mongoose');
// const Service = require('../../models/server');
// const Order = require('../../models/Order');
// const SmmSv = require('../../models/SmmSv');

// async function migrateDomainSmmAll() {
//   await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/yourdb', {
//     useNewUrlParser: true,
//     useUnifiedTopology: true,
//   });
//   let countService = 0;
//   let countOrder = 0;
//   // Cập nhật cho Service
//   const services = await Service.find({});
//   console.log(`Tìm thấy ${services.length} dịch vụ để migrate...`);
//   for (const service of services) {
//     if (mongoose.Types.ObjectId.isValid(service.DomainSmm) && typeof service.DomainSmm !== 'string') continue;
//     const smm = await SmmSv.findOne({ name: service.DomainSmm });
//     console.log(service);
//     console.log(`Đang xử lý dịch vụ: ${service.name} với DomainSmm: ${service.DomainSmm}`);
//     if (smm) {
//       service.DomainSmm = smm._id;
//       await service.save();
//       countService++;
//       console.log(`[Service] Đã cập nhật DomainSmm cho dịch vụ ${service.name} thành ObjectId: ${smm._id}`);
//     } else {
//       console.warn(`[Service] Không tìm thấy SmmSv với name: ${service.DomainSmm} cho dịch vụ ${service.name}`);
//     }
//   }
//   // // Cập nhật cho Order
//   // const orders = await Order.find({});
//   // for (const order of orders) {
//   //   if (mongoose.Types.ObjectId.isValid(order.DomainSmm) && typeof order.DomainSmm !== 'string') continue;
//   //   const smm = await SmmSv.findOne({ name: order.DomainSmm });
//   //   if (smm) {
//   //     order.DomainSmm = smm._id;
//   //     await order.save();
//   //     countOrder++;
//   //     console.log(`[Order] Đã cập nhật DomainSmm cho đơn ${order.Madon} thành ObjectId: ${smm._id}`);
//   //   } else {
//   //     console.warn(`[Order] Không tìm thấy SmmSv với name: ${order.DomainSmm} cho đơn ${order.Madon}`);
//   //   }
//   // }
//   console.log(`Đã migrate xong DomainSmm cho ${countService} dịch vụ và ${countOrder} đơn hàng.`);
//   await mongoose.disconnect();
// }

// // Export hàm để gọi từ nơi khác
// module.exports = { migrateDomainSmmAll };
