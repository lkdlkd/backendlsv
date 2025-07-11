const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  username: { type: String, required: true },//username đặt đơn
  Madon: { type: String, required: true },//id đơn hàng
  orderId: { type: String, required: true },//id đơn hàng bên thứ 3 
  SvID: { type: String, required: true },//svsv đơn hàng bên thứ 3 
  Magoi: { type: String, required: false }, // mã gói dịch vụ
  namesv: { type: String, required: true }, // tên sv đã mua
  category: { type: String, required: true }, // loại dịch vụ đã mua
  comments: { type: String, required: false }, // cmt vụ đã mua
  link: { type: String, required: true }, // link đã mua
  start: { type: Number, default: 0 }, //  số lượng bắt đầu
  dachay: { type: Number, default: 0 }, // số lượng bắt đầu
  quantity: { type: Number, required: false },// số lượng mua 
  rate: { type: Number, required: true },// giá
  totalCost: { type: Number, required: true },// tổng tiền mua
  status: { type: String, default: 'Pending' },// trạng thái đơn hàng
  note: { type: String, default: '' },// ghi chú đơn hàng
  ObjectLink : { type: String, default: '' }, // link object
  lai : { type: Number, default: 0 }, // lợi nhuận từ đơn hàng
  DomainSmm: { type: String, default: null }, // tên miền của dịch
  domain: { type: String, default: null },
}, { timestamps: true }); // Tự động tạo createdAt và updatedAt

module.exports = mongoose.model('Order', orderSchema);
