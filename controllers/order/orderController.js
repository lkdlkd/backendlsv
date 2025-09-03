const axios = require('axios');
const Service = require('../../models/server');
const Order = require('../../models/Order');
const HistoryUser = require('../../models/History');
const SmmSv = require("../../models/SmmSv");
const SmmApiService = require('../Smm/smmServices'); // hoặc đường dẫn tương ứng
const Telegram = require('../../models/Telegram');

// Lấy đơn hàng theo category, user, và từ khóa tìm kiếm (phân trang)
async function getOrders(req, res) {
  const user = req.user;
  const { category, search, status } = req.query;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  // Xây dựng điều kiện tìm kiếm
  let filter = {};
  if (user.role !== 'admin') {
    filter.username = user.username;
  }
  if (category) {
    filter.category = category;
  }
  if (status) {
    filter.status = status;
  }
  if (search) {
    filter.$or = [
      { Madon: { $regex: search, $options: 'i' } },
      { link: { $regex: search, $options: 'i' } }
    ];
  }

  try {
    let selectFields = '-SvID -orderId -DomainSmm -lai -tientieu'; // Các trường không cần thiết cho người dùng thường
    if (user.role === 'admin') {
      selectFields = ''; // admin xem tất cả các trường
    }

    const orders = await Order.find(filter, selectFields)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('username');

    const totalOrders = await Order.countDocuments(filter);

    if (orders.length === 0) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    }

    res.status(200).json({
      orders,
      currentPage: page,
      totalPages: Math.ceil(totalOrders / limit),
      totalOrders
    });
  } catch (error) {
    res.status(500).json({
      message: 'Có lỗi xảy ra khi lấy đơn hàng',
      error: error.message
    });
  }
}
// Hàm xóa đơn hàng (chỉ admin)
async function deleteOrder(req, res) {
  const user = req.user;
  if (!user || user.role !== "admin") {
    return res.status(403).json({ error: 'Chỉ admin mới có quyền sử dụng chức năng này' });
  }

  const { orderId } = req.params;
  try {
    const order = await Order.findOneAndDelete({ _id: orderId });
    if (!order) {
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });
    }
    res.status(200).json({ message: 'Xóa đơn hàng thành công', order });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Có lỗi xảy ra khi xóa đơn hàng', error: error.message });
  }
}
// order
async function fetchServiceData(magoi) {
  const serviceFromDb = await Service.findOne({ Magoi: magoi });
  if (!serviceFromDb) throw new Error('Dịch vụ không tồn tại');
  return serviceFromDb;
}

async function fetchSmmConfig(domain) {
  const smmSvConfig = await SmmSv.findOne({ name: domain });
  if (!smmSvConfig || !smmSvConfig.url_api || !smmSvConfig.api_token) {
    throw new Error('Lỗi khi mua dịch vụ, vui lòng ib admin');
  }
  return smmSvConfig;
}

async function sendTelegramNotification(data) {
  const { telegramBotToken, telegramChatId, message } = data;
  if (telegramBotToken && telegramChatId) {
    try {
      await axios.post(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
        chat_id: telegramChatId,
        text: message,
      });
      console.log('Thông báo Telegram đã được gửi.');
    } catch (error) {
      console.error('Lỗi gửi thông báo Telegram:', error.message);
    }
  } else {
    console.log('Thiếu thông tin cấu hình Telegram.');
  }
}

async function addOrder(req, res) {
  try {
    // Lấy user từ middleware
    const user = req.user;
    const username = user.username;

    // Lấy thông tin từ body
    const { link, category, quantity, magoi, note, comments, ObjectLink } = req.body;
    const qty = Number(quantity);
    const formattedComments = comments ? comments.replace(/\r?\n/g, "\r\n") : "";

    // Lấy thông tin dịch vụ
    const serviceFromDb = await fetchServiceData(magoi);
    const smmSvConfig = await fetchSmmConfig(serviceFromDb.DomainSmm);

    const smm = new SmmApiService(smmSvConfig.url_api, smmSvConfig.api_token);
    const allServices = await smm.services();
    const serviceFromApi = allServices.find(
      s => s.service === Number(serviceFromDb.serviceId) || s.service === serviceFromDb.serviceId
    );

    if (!serviceFromApi) throw new Error('Dịch vụ không tồn tại');
    // Kiểm tra số dư và số lượng
    const totalCost = serviceFromDb.rate * qty;
    const apiRate = serviceFromApi.rate * smmSvConfig.tigia;
    if (apiRate > serviceFromDb.rate) {
      throw new Error('Lỗi khi mua dịch vụ, vui lòng ib admin');
    }
    if (qty < serviceFromDb.min || qty > serviceFromDb.max) {
      throw new Error('Số lượng không hợp lệ');
    }
    if (user.balance < totalCost) {
      throw new Error('Số dư không đủ để thực hiện giao dịch');
    }
    if (serviceFromDb.isActive === false) {
      throw new Error('Dịch vụ bảo trì, vui lòng liên hệ admin');
    }
    const lai = totalCost - (apiRate * qty);
    const tientieu = apiRate * qty;
    // Gửi yêu cầu mua dịch vụ
    const purchasePayload = {
      link,
      quantity: qty,
      service: serviceFromDb.serviceId,
      comments: formattedComments,
    };
    const purchaseResponse = await smm.order(purchasePayload);
    if (!purchaseResponse || !purchaseResponse.order) {
      throw new Error('Lỗi khi mua dịch vụ, vui lòng ib admin');
    }
    // Cập nhật số dư và lưu đơn hàng
    const newBalance = user.balance - totalCost;
    user.balance = newBalance;
    await user.save();

    const lastOrder = await Order.findOne({}).sort({ Madon: -1 });
    const newMadon = lastOrder && lastOrder.Madon ? Number(lastOrder.Madon) + 1 : 10000;

    const createdAt = new Date();
    const orderData = new Order({
      Madon: newMadon,
      Magoi: serviceFromDb.Magoi,
      username,
      SvID: serviceFromDb.serviceId,
      orderId: purchaseResponse.order,
      namesv: `${serviceFromDb.maychu} ${serviceFromDb.name}`,
      category,
      link,
      start: 0,
      quantity: qty,
      rate: serviceFromDb.rate,
      totalCost,
      status: 'Pending',
      note,
      ObjectLink,
      comments: formattedComments,
      DomainSmm: serviceFromDb.DomainSmm,
      tientieu: tientieu,
      lai: lai,
      refil: serviceFromDb.refil,
      cancel: serviceFromDb.cancel,
    });

    const HistoryData = new HistoryUser({
      username,
      madon: newMadon,
      hanhdong: 'Tạo đơn hàng',
      link,
      tienhientai: user.balance + totalCost,
      tongtien: totalCost,
      tienconlai: newBalance,
      createdAt,
      mota: `Tăng ${serviceFromDb.maychu} ${serviceFromDb.name} thành công cho uid ${link}`,
    });

    await orderData.save();
    await HistoryData.save();

    // Gửi thông báo Telegram nếu có cấu hình
    const teleConfig = await Telegram.findOne();
    if (teleConfig && teleConfig.botToken && teleConfig.chatId) {
      // Giờ Việt Nam (UTC+7)
      const createdAtVN = new Date(createdAt.getTime() + 7 * 60 * 60 * 1000);
      const telegramMessage = `📌 *Đơn hàng mới đã được tạo!*\n` +
        `👤 *Khách hàng:* ${username}\n` +
        `🆔 *Mã đơn:* ${newMadon}\n` +
        `🔹 *Dịch vụ:* ${serviceFromDb.maychu} ${serviceFromDb.name}\n` +
        `🔗 *Link:* ${link}\n` +
        `🔸 *Rate:* ${serviceFromDb.rate}\n` +
        `📌 *Số lượng:* ${qty}\n` +
        `💰 *Tiền cũ:* ${Number(Math.floor(Number(user.balance + totalCost))).toLocaleString("en-US")} VNĐ\n` +
        `💰 *Tổng tiền:* ${Number(Math.floor(Number(totalCost))).toLocaleString("en-US")} VNĐ\n` +
        `💰 *TIền còn lại:* ${Number(Math.floor(Number(newBalance))).toLocaleString("en-US")} VNĐ\n` +
        `📆 *Ngày tạo:* ${createdAtVN.toLocaleString("vi-VN", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}\n` +
        `📝 *Ghi chú:* ${note || 'Không có'}\n` +
        `Nguồn: ${serviceFromDb.DomainSmm}`;
      await sendTelegramNotification({
        telegramBotToken: teleConfig.botToken,
        telegramChatId: teleConfig.chatId,
        message: telegramMessage,
      });
    }

    res.status(200).json({ message: 'Mua dịch vụ thành công' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
}
// Hàm cập nhật trạng thái đơn hàng (chỉ admin)
async function updateOrderStatus(req, res) {
  try {
    const user = req.user;
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Chỉ admin mới có quyền cập nhật đơn hàng' });
    }
    const { Madon } = req.params;
    const { start, dachay, status, iscancel } = req.body;
    const order = await Order.findOne({ Madon });
    if (!order) {
      return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    }
    if (start !== undefined) order.start = start;
    if (dachay !== undefined) order.dachay = dachay;
    if (status !== undefined) order.status = status;
    if (iscancel !== undefined) order.iscancel = iscancel;
    await order.save();
    return res.status(200).json({ success: true, order });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}


module.exports = {
  addOrder,
  deleteOrder,
  getOrders,
  updateOrderStatus,
};
