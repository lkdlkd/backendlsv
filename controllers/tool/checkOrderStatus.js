const cron = require('node-cron');
const Order = require('../../models/Order');
const Service = require('../../models/server'); // Đảm bảo đúng tên file model
const SmmSv = require('../../models/SmmSv');
const SmmApiService = require('../Smm/smmServices');
const User = require('../../models/User'); // Thêm dòng này ở đầu file để import model User
const HistoryUser = require('../../models/History');
const axios = require('axios');
const Telegram = require('../../models/Telegram');
const Refund = require('../../models/Refund');
function mapStatus(apiStatus) {
  switch (apiStatus) {
    case "Pending":
      return "Pending";
    case "Processing":
      return "Processing";
    case "Completed":
      return "Completed";
    case "In progress":
      return "In progress";
    case "Partial":
      return "Partial";
    case "Canceled":
      return "Canceled";
    default:
      return null;
  }
}

async function checkOrderStatus() {
  try {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const runningOrders = await Order.find({
      status: { $in: ["Pending", "In progress", "Processing"] },
      createdAt: { $gte: threeMonthsAgo }
    });
    if (runningOrders.length === 0) {
      console.log("Không có đơn hàng đang chạy.");
      return;
    }
    // console.log(`Đang kiểm tra trạng thái của ${runningOrders.length} đơn hàng...`);

    // Cache cho SmmSv để tránh truy vấn lặp lại
    const smmConfigCache = {};
    const groups = {};

    for (const order of runningOrders) {
      // Lấy domainSmm trực tiếp từ order
      const domainSmm = order.DomainSmm;
      if (!domainSmm) {
        console.warn(`Không tìm thấy DomainSmm cho đơn ${order.Madon} (SvID: ${order.SvID}, namesv: ${order.namesv})`);
        continue;
      }

      // Cache SmmSv
      let smmConfig = smmConfigCache[domainSmm];
      if (!smmConfig) {
        smmConfig = await SmmSv.findOne({ name: domainSmm });
        if (!smmConfig || !smmConfig.url_api || !smmConfig.api_token) {
          // Nếu không có cấu hình SMM thì bỏ qua đơn này
          continue;
        }
        smmConfigCache[domainSmm] = smmConfig;
      }

      const groupKey = smmConfig._id.toString();
      if (!groups[groupKey]) {
        groups[groupKey] = {
          smmService: new SmmApiService(smmConfig.url_api, smmConfig.api_token),
          orders: [],
        };
      }
      groups[groupKey].orders.push(order);
    }

    // Duyệt qua từng nhóm và gọi API kiểm tra trạng thái
    for (const groupKey in groups) {
      const { smmService, orders } = groups[groupKey];
      const orderIds = orders.map(order => order.orderId);
      const orderIdChunks = chunkArray(orderIds, 50);
      let allData = {};

      for (const chunk of orderIdChunks) {
        const data = await smmService.multiStatus(chunk);
        allData = { ...allData, ...data };
      }
      // Xử lý kết quả multi status
      for (const orderId in allData) {
        if (allData.hasOwnProperty(orderId)) {
          const statusObj = allData[orderId];
          // console.log(`Kết quả từ API cho orderId ${orderId}:`, statusObj);
          const order = orders.find(o => o.orderId.toString() === orderId);
          if (order) {
            // Lấy smmConfig từ cache
            const smmConfig = smmConfigCache[order.DomainSmm] || null;
            let phihoan = 1000;
            if (smmConfig && typeof smmConfig.phihoan === 'number') phihoan = smmConfig.phihoan;
            const mappedStatus = mapStatus(statusObj.status);
            // console.log(`API trả về cho đơn ${orderId}:`, statusObj);
            if (mappedStatus !== null) order.status = mappedStatus;
            if (statusObj.start_count !== undefined) order.start = statusObj.start_count;
            if (
              ['Pending', 'In progress', 'Processing'].includes(mappedStatus) &&
              Number(statusObj.remains) === 0
            ) {
              order.dachay = 0;
            } else if (statusObj.remains !== undefined) {
              order.dachay = order.quantity - Number(statusObj.remains);
            }
            // Nếu trạng thái là Canceled hoặc Partial thì hoàn tiền phần còn lại
            const user = await User.findOne({ username: order.username });
            const tiencu = user.balance || 0;
            if (mappedStatus === 'Partial') {
              if (user) {
                const soTienHoan = ((statusObj.remains || 0) * order.rate) - phihoan;
                if ((soTienHoan) < 50) {
                  order.iscancel = false; // Đánh dấu đơn hàng đã được hoàn tiền
                  await order.save();
                  // console.log(`Đã cập nhật đơn ${order.Madon}: status = ${order.status}, dachay = ${order.dachay}`);
                  continue;
                }
                const soTienHoanFormatted = Number(Math.floor(Number(soTienHoan))).toLocaleString("en-US");

                if (smmConfig && smmConfig.autohoan === 'on') {
                  // Lưu vào Refund với status true
                  await Refund.create({
                    username: order.username,
                    madon: order.Madon,
                    link: order.link,
                    server: order.namesv,
                    soluongmua: order.quantity,
                    giatien: order.rate,
                    chuachay: statusObj.remains || 0,
                    tonghoan: soTienHoan,
                    noidung: `Hệ thống hoàn cho bạn ${soTienHoanFormatted} dịch vụ tương đương với ${statusObj.remains} cho uid ${order.link} và ${phihoan} phí dịch vụ`,
                    status: true
                  });
                  user.balance = (user.balance || 0) + soTienHoan;
                  await user.save();
                  // Lưu historyData
                  const historyData = new HistoryUser({
                    username: order.username,
                    madon: order.Madon,
                    hanhdong: "Hoàn tiền",
                    link: order.link,
                    tienhientai: tiencu,
                    tongtien: soTienHoan,
                    tienconlai: user.balance,
                    createdAt: new Date(),
                    mota: `Hệ thống hoàn cho bạn ${soTienHoanFormatted} dịch vụ tương đương với ${statusObj.remains} cho uid ${order.link} và ${phihoan} phí dịch vụ`,
                  });
                  await historyData.save();
                  const taoluc = new Date(Date.now() + 7 * 60 * 60 * 1000); // Giờ Việt Nam (UTC+7)
                  // Gửi thông báo Telegram nếu có cấu hình
                  const teleConfig = await Telegram.findOne();
                  if (teleConfig && teleConfig.botToken && teleConfig.chatId) {
                    const telegramMessage =
                      `📌 *THÔNG BÁO HOÀN TIỀN!*\n` +
                      `👤 *Khách hàng:* ${order.username}\n` +
                      ` Mã đơn: ${order.Madon}\n` +
                      `💰 *Số tiền hoàn:* ${soTienHoanFormatted}\n` +
                      `🔹 *Tương ứng số lượng:* ${statusObj.remains} - Rate : ${order.rate}\n` +
                      `🔸 *Dịch vụ:* ${order.namesv}\n` +
                      `⏰ *Thời gian:* ${taoluc.toLocaleString("vi-VN", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}\n`;
                    try {
                      await axios.post(`https://api.telegram.org/bot${teleConfig.botToken}/sendMessage`, {
                        chat_id: teleConfig.chatId,
                        text: telegramMessage,
                        parse_mode: "Markdown",
                      });
                      console.log("Thông báo Telegram đã được gửi.");
                    } catch (telegramError) {
                      console.error("Lỗi gửi thông báo Telegram:", telegramError.message);
                    }
                  }
                } else {
                  // Lưu vào Refund với status false
                  await Refund.create({
                    username: order.username,
                    madon: order.Madon,
                    link: order.link,
                    server: order.namesv || '',
                    soluongmua: order.quantity,
                    giatien: order.rate,
                    chuachay: statusObj.remains || 0,
                    tonghoan: soTienHoan,
                    noidung: `Hệ thống hoàn cho bạn ${soTienHoanFormatted} dịch vụ tương đương với ${statusObj.remains} cho uid ${order.link} và ${phihoan} phí dịch vụ`,
                    status: false
                  });
                  const taoluc = new Date(Date.now() + 7 * 60 * 60 * 1000); // Giờ Việt Nam (UTC+7)
                  // Gửi thông báo Telegram nếu có cấu hình
                  const teleConfig = await Telegram.findOne();
                  if (teleConfig && teleConfig.botToken && teleConfig.chatId) {
                    const telegramMessage =
                      `📌 *THÔNG BÁO HOÀN TIỀN CHƯA DUYỆT!*\n` +
                      `👤 *Khách hàng:* ${order.username}\n` +
                      ` Mã đơn: ${order.Madon}\n` +
                      `💰 *Số tiền hoàn:* ${soTienHoanFormatted}\n` +
                      `🔹 *Tương ứng số lượng:* ${statusObj.remains} - Rate : ${order.rate}\n` +
                      `🔸 *Dịch vụ:* ${order.namesv}\n` +
                      `⏰ *Thời gian:* ${taoluc.toLocaleString("vi-VN", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}\n`;
                    try {
                      await axios.post(`https://api.telegram.org/bot${teleConfig.botToken}/sendMessage`, {
                        chat_id: teleConfig.chatId,
                        text: telegramMessage,
                        parse_mode: "Markdown",
                      });
                      console.log("Thông báo Telegram đã được gửi.");
                    } catch (telegramError) {
                      console.error("Lỗi gửi thông báo Telegram:", telegramError.message);
                    }
                  }
                }
                order.iscancel = false; // Đánh dấu đơn hàng đã được hoàn tiền
              }
            }
            if (mappedStatus === 'Canceled') {
              if (user) {
                const soTienHoan = ((order.quantity || 0) * order.rate) - phihoan;
                if ((soTienHoan) < 50) {
                  order.iscancel = false; // Đánh dấu đơn hàng đã được hoàn tiền
                  await order.save();
                  // console.log(`Đã cập nhật đơn ${order.Madon}: status = ${order.status}, dachay = ${order.dachay}`);
                  continue;
                }
                const soTienHoanFormatted = Number(Math.floor(Number(soTienHoan))).toLocaleString("en-US");
                if (smmConfig && smmConfig.autohoan === 'on') {
                  await Refund.create({
                    username: order.username,
                    madon: order.Madon,
                    link: order.link,
                    server: order.namesv || '',
                    soluongmua: order.quantity,
                    giatien: order.rate,
                    chuachay: order.quantity || 0,
                    tonghoan: soTienHoan,
                    noidung: `Hệ thống hoàn cho bạn ${soTienHoanFormatted} dịch vụ tương đương với ${order.quantity} cho uid ${order.link} và ${phihoan} phí dịch vụ`,
                    status: true
                  });
                  user.balance = (user.balance || 0) + soTienHoan;
                  await user.save();
                  const historyData = new HistoryUser({
                    username: order.username,
                    madon: order.Madon,
                    hanhdong: "Hoàn tiền",
                    link: order.link,
                    tienhientai: tiencu,
                    tongtien: soTienHoan,
                    tienconlai: user.balance,
                    createdAt: new Date(),
                    mota: `Hệ thống hoàn cho bạn ${soTienHoanFormatted} dịch vụ tương đương với ${order.quantity} cho uid ${order.link} và ${phihoan} phí dịch vụ`,
                  });
                  await historyData.save();
                  const taoluc = new Date(Date.now() + 7 * 60 * 60 * 1000); // Giờ Việt Nam (UTC+7)
                  // Gửi thông báo Telegram nếu có cấu hình
                  const teleConfig = await Telegram.findOne();
                  if (teleConfig && teleConfig.botToken && teleConfig.chatId) {
                    const telegramMessage =
                      `📌 *THÔNG BÁO HOÀN TIỀN!*\n` +
                      `👤 *Khách hàng:* ${order.username}\n` +
                      ` Mã đơn: ${order.Madon}\n` +
                      `💰 *Số tiền hoàn:* ${soTienHoanFormatted}\n` +
                      `🔹 *Tương ứng số lượng:* ${order.quantity} - Rate : ${order.rate}\n` +
                      `🔸 *Dịch vụ:* ${order.namesv}\n` +
                      `⏰ *Thời gian:* ${taoluc.toLocaleString("vi-VN", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}\n`;
                    try {
                      await axios.post(`https://api.telegram.org/bot${teleConfig.botToken}/sendMessage`, {
                        chat_id: teleConfig.chatId,
                        text: telegramMessage,
                        parse_mode: "Markdown",
                      });
                      console.log("Thông báo Telegram đã được gửi.");
                    } catch (telegramError) {
                      console.error("Lỗi gửi thông báo Telegram:", telegramError.message);
                    }
                  }
                } else {
                  // Lưu vào Refund với status false
                  await Refund.create({
                    username: order.username,
                    madon: order.Madon,
                    link: order.link,
                    server: order.namesv || '',
                    soluongmua: order.quantity,
                    giatien: order.rate,
                    chuachay: order.quantity || 0,
                    tonghoan: soTienHoan,
                    noidung: `Hệ thống hoàn cho bạn ${soTienHoanFormatted} dịch vụ tương đương với ${order.quantity} cho uid ${order.link} và ${phihoan} phí dịch vụ`,
                    status: false
                  });
                  const taoluc = new Date(Date.now() + 7 * 60 * 60 * 1000); // Giờ Việt Nam (UTC+7)
                  // Gửi thông báo Telegram nếu có cấu hình
                  const teleConfig = await Telegram.findOne();
                  if (teleConfig && teleConfig.botToken && teleConfig.chatId) {
                    const telegramMessage =
                      `📌 *THÔNG BÁO HOÀN TIỀN CHƯA DUYỆT!*\n` +
                      `👤 *Khách hàng:* ${order.username}\n` +
                      ` Mã đơn: ${order.Madon}\n` +
                      `💰 *Số tiền hoàn:* ${soTienHoanFormatted}\n` +
                      `🔹 *Tương ứng số lượng:* ${order.quantity} - Rate : ${order.rate}\n` +
                      `🔸 *Dịch vụ:* ${order.namesv}\n` +
                      `⏰ *Thời gian:* ${taoluc.toLocaleString("vi-VN", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}\n`;
                    try {
                      await axios.post(`https://api.telegram.org/bot${teleConfig.botToken}/sendMessage`, {
                        chat_id: teleConfig.chatId,
                        text: telegramMessage,
                        parse_mode: "Markdown",
                      });
                      console.log("Thông báo Telegram đã được gửi.");
                    } catch (telegramError) {
                      console.error("Lỗi gửi thông báo Telegram:", telegramError.message);
                    }
                  }
                }
                order.iscancel = false; // Đánh dấu đơn hàng đã được hoàn tiền
              }
            }
            await order.save();
            // console.log(`Đã cập nhật đơn ${order.Madon}: status = ${order.status}, dachay = ${order.dachay}`);
          } else {
            console.warn(`Không tìm thấy đơn nào tương ứng với orderId ${orderId}`);
          }
        }
      }
      //}
    }
  } catch (error) {
    console.error("Lỗi khi kiểm tra trạng thái đơn hàng:", error.message);
  }
}

// Đặt lịch chạy cron job, ví dụ: chạy mỗi 1 phút
cron.schedule('*/1 * * * *', () => {
  console.log("Cron job: Bắt đầu kiểm tra trạng thái đơn hàng");
  checkOrderStatus();
});

const chunkArray = (arr, size) => {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
};

