const cron = require('node-cron');
const Order = require('../../models/Order');
const Service = require('../../models/server'); // Đảm bảo đúng tên file model
const SmmSv = require('../../models/SmmSv');
const SmmApiService = require('../Smm/smmServices');
const User = require('../../models/User'); // Thêm dòng này ở đầu file để import model User
const HistoryUser = require('../../models/History');
const axios = require('axios');

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
    const runningOrders = await Order.find({
      status: { $in: ["Pending", "In progress", "Processing"] }
    });
    if (runningOrders.length === 0) {
      console.log("Không có đơn hàng đang chạy.");
      return;
    }
    console.log(`Đang kiểm tra trạng thái của ${runningOrders.length} đơn hàng...`);

    // Cache cho Service và SmmSv để tránh truy vấn lặp lại
    const serviceCache = {};
    const smmConfigCache = {};
    const groups = {};

    for (const order of runningOrders) {
      // Cache Service
      let service = serviceCache[order.SvID];
      if (!service) {
        service = await Service.findOne({ serviceId: order.SvID });
        if (!service) {
          console.warn(`Không tìm thấy dịch vụ cho đơn ${order.Madon} (namesv: ${order.namesv})`);
          continue;
        }
        serviceCache[order.SvID] = service;
      }

      // Cache SmmSv
      let smmConfig = smmConfigCache[service.DomainSmm];
      if (!smmConfig) {
        smmConfig = await SmmSv.findOne({ name: service.DomainSmm });
        if (!smmConfig || !smmConfig.url_api || !smmConfig.api_token) {
          console.warn(`Cấu hình SMM không hợp lệ cho dịch vụ ${service.name}`);
          continue;
        }
        smmConfigCache[service.DomainSmm] = smmConfig;
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

      if (orders.length === 1) {
        const order = orders[0];
        try {
          const statusObj = await smmService.status(order.orderId);
          console.log(`API trả về cho đơn ${order.orderId}:`, statusObj);

          const mappedStatus = mapStatus(statusObj.status);
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
          const user = await User.findOne({ username: order.username });
          const tiencu = user.balance || 0;
          if (mappedStatus === 'Partial') {
            if (user) {
              const soTienHoan = ((statusObj.remains || 0) * order.rate) - 1000; // Giả sử 1000 là phí dịch vụ
              if ((soTienHoan) < 0) return;
              user.balance = (user.balance || 0) + soTienHoan;
              await user.save();
              const historyData = new HistoryUser({
                username: order.username,
                madon: "null",
                hanhdong: "Hoàn tiền",
                link: "",
                tienhientai: tiencu,
                tongtien: soTienHoan,
                tienconlai: user.balance,
                createdAt: new Date(),
                mota: `Hệ thống hoàn cho bạn ${soTienHoan} dịch vụ tương đương với ${statusObj.remains} cho uid ${order.link} và 1000 phí dịch vụ`,
              });
              const taoluc = new Date();
              const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
              const telegramChatId = process.env.TELEGRAM_CHAT_ID;
              if (telegramBotToken && telegramChatId) {
                const telegramMessage =
                  `📌 *THÔNG BÁO HOÀN TIỀN!*\n\n` +
                  `👤 *Khách hàng:* ${order.username}\n` +
                  `💰 *Số tiền hoàn:* ${soTienHoan}\n` +
                  `🔹 *Tướng ứng số lượng:* ${statusObj.remains} Rate : ${order.rate}\n` +
                  `⏰ *Thời gian:* ${taoluc.toLocaleString()}\n`;
                try {
                  await axios.post(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
                    chat_id: telegramChatId,
                    text: telegramMessage,
                    parse_mode: "Markdown",
                  });
                  console.log("Thông báo Telegram đã được gửi.");
                } catch (telegramError) {
                  console.error("Lỗi gửi thông báo Telegram:", telegramError.message);
                }
              }
              await historyData.save();
              console.log(`Đã hoàn tiền cho user ${user.username} số tiền ${soTienHoan} do đơn ${order.Madon} bị hủy hoặc chạy thiếu.`);
            }
          }
          if (mappedStatus === 'Canceled') {
            if (user) {
              const soTienHoan = ((order.quantity || 0) * order.rate) - 1000; // Giả sử 1000 là phí dịch vụ
              if ((soTienHoan) < 0) return;
              user.balance = (user.balance || 0) + soTienHoan;
              await user.save();
              const historyData = new HistoryUser({
                username: order.username,
                madon: "null",
                hanhdong: "Hoàn tiền",
                link: "",
                tienhientai: tiencu,
                tongtien: soTienHoan,
                tienconlai: user.balance,
                createdAt: new Date(),
                mota: `Hệ thống hoàn cho bạn ${soTienHoan} dịch vụ tương đương với ${order.quantity} cho uid ${order.link} và 1000 phí dịch vụ`,
              });
              const taoluc = new Date();
              const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
              const telegramChatId = process.env.TELEGRAM_CHAT_ID;
              if (telegramBotToken && telegramChatId) {
                const telegramMessage =
                  `📌 *THÔNG BÁO HOÀN TIỀN!*\n\n` +
                  `👤 *Khách hàng:* ${order.username}\n` +
                  `💰 *Số tiền hoàn:* ${soTienHoan}\n` +
                  `🔹 *Tướng ứng số lượng:* ${order.quantity} Rate : ${order.rate}\n` +
                  `⏰ *Thời gian:* ${taoluc.toLocaleString()}\n`;
                try {
                  await axios.post(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
                    chat_id: telegramChatId,
                    text: telegramMessage,
                    parse_mode: "Markdown",
                  });
                  console.log("Thông báo Telegram đã được gửi.");
                } catch (telegramError) {
                  console.error("Lỗi gửi thông báo Telegram:", telegramError.message);
                }
              }
              await historyData.save();
              console.log(`Đã hoàn tiền cho user ${user._id} số tiền ${soTienHoan} do đơn ${order.Madon} bị hủy hoặc chạy thiếu.`);
            }
          }
          await order.save();
          console.log(`Đã cập nhật đơn ${order.Madon}: status = ${order.status}, dachay = ${order.dachay}`);
        } catch (apiError) {
          console.error(`Lỗi API trạng thái cho đơn ${order.orderId}:`, apiError.message);
        }
      } else {
        // Multi status
        const orderIds = orders.map(order => order.orderId);
        const orderIdChunks = chunkArray(orderIds, 100);
        let allData = {};

        for (const chunk of orderIdChunks) {
          const data = await smmService.multiStatus(chunk);
          allData = { ...allData, ...data };
        }

        // Sau đó xử lý allData như cũ
        for (const orderId in allData) {
          if (allData.hasOwnProperty(orderId)) {
            const statusObj = allData[orderId];
            const order = orders.find(o => o.orderId.toString() === orderId);
            if (order) {
              const mappedStatus = mapStatus(statusObj.status);
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
              // Nếu trạng thái là Canceled thì hoàn tiền
              const user = await User.findOne({ username: order.username });
              const tiencu = user.balance || 0;
              // Nếu trạng thái là Canceled hoặc Partial thì hoàn tiền phần còn lại
              if (mappedStatus === 'Partial') {
                if (user) {
                  const soTienHoan = ((statusObj.remains || 0) * order.rate) - 1000; // Giả sử 1000 là phí dịch vụ
                  if ((soTienHoan) < 0) return;
                  user.balance = (user.balance || 0) + soTienHoan;
                  await user.save();
                  const historyData = new HistoryUser({
                    username: order.username,
                    madon: "null",
                    hanhdong: "Hoàn tiền",
                    link: "",
                    tienhientai: tiencu,
                    tongtien: soTienHoan,
                    tienconlai: user.balance,
                    createdAt: new Date(),
                    mota: `Hệ thống hoàn cho bạn ${soTienHoan} dịch vụ tương đương với ${statusObj.remains} cho uid ${order.link} và 1000 phí dịch vụ`,
                  });
                  const taoluc = new Date();
                  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
                  const telegramChatId = process.env.TELEGRAM_CHAT_ID;
                  if (telegramBotToken && telegramChatId) {
                    const telegramMessage =
                      `📌 *THÔNG BÁO HOÀN TIỀN!*\n\n` +
                      `👤 *Khách hàng:* ${order.username}\n` +
                      `💰 *Số tiền hoàn:* ${soTienHoan}\n` +
                      `🔹 *Tướng ứng số lượng:* ${statusObj.remains} Rate : ${order.rate}\n` +
                      `⏰ *Thời gian:* ${taoluc.toLocaleString()}\n`;
                    try {
                      await axios.post(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
                        chat_id: telegramChatId,
                        text: telegramMessage,
                        parse_mode: "Markdown",
                      });
                      console.log("Thông báo Telegram đã được gửi.");
                    } catch (telegramError) {
                      console.error("Lỗi gửi thông báo Telegram:", telegramError.message);
                    }
                  }
                  await historyData.save();
                  console.log(`Đã hoàn tiền cho user ${user.username} số tiền ${soTienHoan} do đơn ${order.Madon} bị hủy hoặc chạy thiếu.`);
                }
              }
              if (mappedStatus === 'Canceled') {
                if (user) {
                  const soTienHoan = ((order.quantity || 0) * order.rate) - 1000; // Giả sử 1000 là phí dịch vụ
                  if ((soTienHoan) < 0) return;
                  user.balance = (user.balance || 0) + soTienHoan;
                  await user.save();
                  const historyData = new HistoryUser({
                    username: order.username,
                    madon: "null",
                    hanhdong: "Hoàn tiền",
                    link: "",
                    tienhientai: tiencu,
                    tongtien: soTienHoan,
                    tienconlai: user.balance,
                    createdAt: new Date(),
                    mota: `Hệ thống hoàn cho bạn ${soTienHoan} dịch vụ tương đương với ${order.quantity} cho uid ${order.link} và 1000 phí dịch vụ`,
                  });
                  const taoluc = new Date();
                  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
                  const telegramChatId = process.env.TELEGRAM_CHAT_ID;
                  if (telegramBotToken && telegramChatId) {
                    const telegramMessage =
                      `📌 *THÔNG BÁO HOÀN TIỀN!*\n\n` +
                      `👤 *Khách hàng:* ${order.username}\n` +
                      `💰 *Số tiền hoàn:* ${soTienHoan}\n` +
                      `🔹 *Tướng ứng số lượng:* ${order.quantity} Rate : ${order.rate}\n` +
                      `⏰ *Thời gian:* ${taoluc.toLocaleString()}\n`;
                    try {
                      await axios.post(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
                        chat_id: telegramChatId,
                        text: telegramMessage,
                        parse_mode: "Markdown",
                      });
                      console.log("Thông báo Telegram đã được gửi.");
                    } catch (telegramError) {
                      console.error("Lỗi gửi thông báo Telegram:", telegramError.message);
                    }
                  }
                  await historyData.save();
                  console.log(`Đã hoàn tiền cho user ${user._id} số tiền ${soTienHoan} do đơn ${order.Madon} bị hủy hoặc chạy thiếu.`);
                }
              }

              await order.save();
              console.log(`Đã cập nhật đơn ${order.Madon}: status = ${order.status}, dachay = ${order.dachay}`);
            } else {
              console.warn(`Không tìm thấy đơn nào tương ứng với orderId ${orderId}`);
            }
          }
        } 
      }
    }
  } catch (error) {
    console.error("Lỗi khi kiểm tra trạng thái đơn hàng:", error.message);
  }
}

// Đặt lịch chạy cron job, ví dụ: chạy mỗi 1 phút
cron.schedule('*/3 * * * *', () => {
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

