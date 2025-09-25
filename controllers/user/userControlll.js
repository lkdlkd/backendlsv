const jwt = require("jsonwebtoken");
const User = require("../../models/User");
const HistoryUser = require("../../models/History");
const axios = require("axios");
const crypto = require("crypto");
const Telegram = require('../../models/Telegram');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

exports.login = async (req, res) => {
  try {
    let { username, password, token: otpToken } = req.body;

    username = username.toLowerCase();

    const user = await User.findOne({ username: username });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: "Sai tên người dùng hoặc mật khẩu" });
    }

    // Kiểm tra trạng thái tài khoản
    if (user.status !== "active") {
      return res.status(403).json({ error: "Tài khoản đã bị khóa" });
    }
    if (user.twoFactorEnabled) {
      if (!otpToken) {
        return res.status(200).json({ twoFactorRequired: true, message: 'Yêu cầu mã 2FA' });
      }
      // Cần lấy secret (đã bật) gồm trường twoFactorSecret (ẩn theo select:false)
      const userWithSecret = await User.findById(user._id).select('+twoFactorSecret');
      if (!userWithSecret || !userWithSecret.twoFactorSecret) {
        return res.status(500).json({ error: 'Không tìm thấy secret 2FA' });
      }
      const verified = speakeasy.totp.verify({
        secret: userWithSecret.twoFactorSecret,
        encoding: 'base32',
        token: otpToken,
        window: 1,
      });
      if (!verified) {
        return res.status(401).json({ error: 'Mã 2FA không chính xác' });
      }
    }

    // Lưu lịch sử đăng nhập vào mảng loginHistory
    // Ưu tiên lấy IP từ header X-User-IP (IP thật từ client), sau đó mới dùng x-forwarded-for
    const ip = req.headers['x-user-ip'] ||
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.connection.remoteAddress ||
      null;
    const userAgent = req.headers['user-agent'] || '';
    user.loginHistory = user.loginHistory || [];
    user.loginHistory.push({ ip, agent: userAgent, time: new Date() });
    await user.save();
    const token = jwt.sign(
      { username: user.username, userId: user._id, role: user.role },
      process.env.secretKey,
      { expiresIn: '7d' }
    );

    // Nếu là admin, gửi thông báo Telegram
    if (user.role === 'admin') {
      const taoluc = new Date(Date.now() + 7 * 60 * 60 * 1000);
      const teleConfig = await Telegram.findOne();
      if (teleConfig && teleConfig.botToken && teleConfig.chatId) {
        const telegramMessage =
          `📌 *Admin đăng nhập!*\n` +
          `👤 *Admin:* ${user.username}\n` +
          `🔹 *IP:* ${ip}\n` +
          `🔹 *User-Agent:* ${userAgent}\n` +
          `🔹 *Thời gian:* ${taoluc.toLocaleString("vi-VN", {
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
          console.log("Thông báo Telegram admin đăng nhập đã được gửi.");
        } catch (telegramError) {
          console.error("Lỗi gửi thông báo Telegram:", telegramError.message);
        }
      }
    }
    // ✅ Trả về token mới
    return res.status(200).json({ token, role: user.role, username: user.username, twoFactorEnabled: user.twoFactorEnabled });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Có lỗi xảy ra khi đăng nhập" });
  }
};

// Bắt đầu thiết lập 2FA: tạo secret tạm & trả về QR code + otpauth URL
exports.setup2FA = async (req, res) => {
  try {
    const currentUser = req.user;
    const user = await User.findById(currentUser.userId || currentUser._id);
    if (!user) return res.status(404).json({ error: 'User không tồn tại' });

    // Nếu đã bật 2FA thì không nên cho setup lại (buộc disable trước)
    if (user.twoFactorEnabled) {
      return res.status(400).json({ status: false, message: 'Bạn đã bật 2FA. Hãy tắt trước nếu muốn tạo lại.' });
    }

    const secret = speakeasy.generateSecret({
      name: `App-${user.username}`,
      length: 20,
    });

    user.twoFactorTempSecret = secret.base32;
    await user.save();

    // Tạo QR code từ otpauth_url
    const qrDataURL = await QRCode.toDataURL(secret.otpauth_url);

    return res.status(200).json({
      status: true,
      otpauth_url: secret.otpauth_url,
      qr: qrDataURL,
      base32: secret.base32,
      message: 'Quét QR trong Google Authenticator và xác minh bằng mã OTP.'
    });
  } catch (err) {
    console.error('Setup 2FA error:', err);
    return res.status(500).json({ error: 'Lỗi server khi setup 2FA' });
  }
};

// Xác minh mã OTP để kích hoạt 2FA (dùng secret tạm)
exports.verify2FA = async (req, res) => {
  try {
    const currentUser = req.user;
    // Chấp nhận cả 'token' hoặc 'code' từ client cho linh hoạt
    const { token, code } = req.body;
    const otp = token || code;
    if (!otp) return res.status(400).json({ error: 'Thiếu mã OTP' });

    const user = await User.findById(currentUser.userId || currentUser._id).select('+twoFactorTempSecret +twoFactorSecret');
    if (!user) return res.status(404).json({ status: false, message: 'User không tồn tại' });
    if (user.twoFactorEnabled) return res.status(400).json({ status: false, message: '2FA đã được bật' });
    if (!user.twoFactorTempSecret) return res.status(400).json({ status: false, message: 'Chưa tạo secret tạm' });

    // Speakeasy yêu cầu field 'token', không phải 'code'.
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorTempSecret,
      encoding: 'base32',
      token: otp,
      window: 1, // Cho phép lệch 1 bước thời gian (±30s)
    });
    if (!verified) {
      return res.status(400).json({ status: false, message: 'Mã OTP không chính xác hoặc đã hết hạn' });
    }

    // Chuyển secret tạm thành secret chính & bật 2FA
    user.twoFactorSecret = user.twoFactorTempSecret;
    user.twoFactorTempSecret = undefined;
    user.twoFactorEnabled = true;
    await user.save();

    return res.status(200).json({ status: true, message: 'Kích hoạt 2FA thành công', twoFactorEnabled: true });
  } catch (err) {
    console.error('Verify 2FA error:', err);
    return res.status(500).json({ status: false, message: 'Lỗi server khi verify 2FA' });
  }
};

// Tắt 2FA (yêu cầu OTP hiện tại nếu đang bật để tránh bị lạm dụng)
exports.disable2FA = async (req, res) => {
  try {
    const currentUser = req.user;
    const { code } = req.body; // OTP để xác nhận tắt
    const user = await User.findById(currentUser.userId || currentUser._id).select('+twoFactorSecret');
    if (!user) return res.status(404).json({ error: 'User không tồn tại' });
    if (!user.twoFactorEnabled) return res.status(400).json({ status: false, message: '2FA chưa bật' });
    console.log(code);
    // Xác thực OTP trước khi tắt
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: code,
      window: 1,
    });
    if (!verified) return res.status(401).json({ status: false, message: 'Mã OTP không chính xác hoặc đã hết hạn' });

    user.twoFactorEnabled = false;
    user.twoFactorSecret = undefined;
    user.twoFactorTempSecret = undefined;
    await user.save();
    return res.status(200).json({ status: true, message: 'Đã tắt 2FA thành công', twoFactorEnabled: false });
  } catch (err) {
    console.error('Disable 2FA error:', err);
    return res.status(500).json({ error: 'Lỗi server khi tắt 2FA' });
  }
};

exports.register = async (req, res) => {
  try {
    let { username, password } = req.body;

    // Chuyển username thành chữ thường
    username = username.toLowerCase();

    // Kiểm tra username và password không được ngắn hơn 6 ký tự
    if (username.length < 6) {
      return res.status(400).json({ error: "Tên người dùng phải có ít nhất 6 ký tự" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Mật khẩu phải có ít nhất 6 ký tự" });
    }

    // Kiểm tra username chỉ chứa chữ và số (không cho phép ký tự đặc biệt hoặc gạch dưới)
    const usernameRegex = /^[a-zA-Z0-9]+$/;
    if (!usernameRegex.test(username)) {
      return res.status(400).json({ error: "Tên người dùng không được chứa ký tự đặc biệt" });
    }

    // Kiểm tra username phải chứa ít nhất một ký tự chữ
    const containsLetterRegex = /[a-zA-Z]/;
    if (!containsLetterRegex.test(username)) {
      return res.status(400).json({ error: "Tên người dùng phải chứa ít nhất một ký tự chữ" });
    }

    // Kiểm tra nếu người dùng đã tồn tại (không phân biệt hoa thường)
    const existingUser = await User.findOne({ username: username.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: "Tên người dùng đã tồn tại" });
    }

    // Kiểm tra xem đã có admin chưa
    const isAdminExists = await User.findOne({ role: "admin" });

    // **Tạo API key**
    const apiKey = crypto.randomBytes(32).toString("hex");

    // Tạo người dùng mới
    const user = new User({
      username,
      password,
      role: isAdminExists ? "user" : "admin",
      apiKey, // **Lưu API key**
    });

    await user.save();


    // **Thông báo qua Telegram**
    const teleConfig = await Telegram.findOne();
    if (teleConfig && teleConfig.botToken && teleConfig.chatId) {
      // Giờ Việt Nam (UTC+7)
      const taoluc = new Date(Date.now() + 7 * 60 * 60 * 1000);
      const telegramMessage =
        `📌 *Có khách mới được tạo!*\n` +
        `👤 *Khách hàng:* ${username}\n` +
        `🔹 *Tạo lúc:* ${taoluc.toLocaleString("vi-VN", {
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

    return res.status(201).json({
      message: "Đăng ký thành công",
    });
  } catch (error) {
    console.error("Đăng ký lỗi:", error);
    return res.status(500).json({ error: "Có lỗi xảy ra. Vui lòng thử lại." });
  }
};

exports.getMe = async (req, res) => {
  try {
    const currentUser = req.user; // Lấy từ middleware
    const username = currentUser.username; // Lấy username từ params
    // Nếu là admin hoặc chính chủ mới được xem thông tin
    if (currentUser.role !== "admin" && currentUser.username !== username) {
      return res.status(403).json({ error: "Bạn không có quyền xem thông tin người dùng này" });
    }

    // Tìm người dùng theo username
    const user = await User.findOne({ username }).select("-password");
    if (!user) {
      return res.status(404).json({ error: "Người dùng không tồn tại" });
    }

    // Trả về thông tin user nhưng thay token bằng apiKey
    const loginHistory = Array.isArray(user.loginHistory)
      ? user.loginHistory.slice(-10).reverse()
      : [];
    return res.status(200).json({
      balance: user.balance,
      capbac: user.capbac,
      createdAt: user.createdAt,
      role: user.role,
      status: user.status,
      twoFactorEnabled: user.twoFactorEnabled,
      token: user.apiKey, // Hiển thị API Key thay vì token
      tongnap: user.tongnap,
      tongnapthang: user.tongnapthang,
      updatedAt: user.updatedAt,
      userId: user._id,
      username: user.username,
      loginHistory,
    });
  } catch (error) {
    console.error("Get user error:", error);
    return res.status(500).json({ error: "Có lỗi xảy ra. Vui lòng thử lại sau." });
  }
};

// Cập nhật thông tin người dùng (chỉ admin hoặc chính chủ mới có thể sửa)
exports.updateUser = async (req, res) => {
  try {
    const currentUser = req.user;
    const { id } = req.params;

    // Chỉ admin hoặc chính chủ mới được cập nhật
    if (currentUser.role !== "admin") {
      return res.status(403).json({ error: "Bạn không có quyền sửa thông tin người dùng này" });
    }

    const updatedData = req.body;
    const updatedUser = await User.findByIdAndUpdate(id, updatedData, { new: true })
      .select("-password");
    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }
    return res.json(updatedUser);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
// Cộng tiền vào số dư (chỉ admin mới có quyền)
exports.addBalance = async (req, res) => {
  try {
    const currentUser = req.user;
    if (currentUser.role !== "admin") {
      return res.status(403).json({ error: "Chỉ admin mới có quyền cộng tiền vào số dư" });
    }
    const { id } = req.params;
    const { amount } = req.body;

    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ message: "Số tiền không hợp lệ" });
    }

    // Lấy ngày hiện tại
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();

    // Tìm người dùng và cập nhật số dư
    let user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "Người dùng không tồn tại" });
    }

    const update = {
      $inc: {
        balance: amount,
        tongnap: amount,
        tongnapthang: amount,
      },
      $set: { lastDepositMonth: { month: currentMonth, year: currentYear } },
    };

    const updatedUser = await User.findByIdAndUpdate(id, update, { new: true })
      .select("-password");

    // Lưu lịch sử giao dịch
    const currentBalance = updatedUser.balance;
    const historyDataa = new HistoryUser({
      username: updatedUser.username,
      madon: "null",
      hanhdong: "Cộng tiền",
      link: "",
      tienhientai: user.balance,
      tongtien: amount,
      tienconlai: currentBalance,
      createdAt: new Date(),
      mota: `Admin cộng thành công số tiền ${amount}`,
    });
    await historyDataa.save();
    const taoluc = new Date();

    // Sử dụng cấu hình Telegram trong DB
    const teleConfig = await Telegram.findOne();
    if (teleConfig && teleConfig.botToken && teleConfig.chatId) {
      // Giờ Việt Nam (UTC+7)
      const taoluc = new Date(Date.now() + 7 * 60 * 60 * 1000);
      const telegramMessage =
        `📌 *Cộng tiền!*\n` +
        `👤 *Khách hàng:* ${updatedUser.username}\n` +
        `👤 *Cộng tiền:*  Admin đã cộng thành công số tiền ${amount}.\n` +
        `🔹 *Tạo lúc:* ${taoluc.toLocaleString("vi-VN", {
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
    res.status(200).json({ message: "Cộng tiền thành công" });
  } catch (error) {
    console.error("Add balance error:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

// Trừ tiền khỏi số dư (chỉ admin mới có quyền)
exports.deductBalance = async (req, res) => {
  try {
    const currentUser = req.user;
    if (currentUser.role !== "admin") {
      return res.status(403).json({ error: "Chỉ admin mới có quyền trừ tiền từ số dư" });
    }

    const { id } = req.params;
    const { amount } = req.body;

    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ message: "Số tiền cần trừ không hợp lệ" });
    }

    // Tìm người dùng trong cơ sở dữ liệu
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "Người dùng không tồn tại" });
    }

    // Kiểm tra số dư có đủ để trừ không
    if (user.balance < amount) {
      return res.status(400).json({ message: "Số dư không đủ để trừ" });
    }
    const tiencu = user.balance;
    // Trừ tiền và cập nhật số dư
    const updatedBalance = user.balance - amount;
    const updatedUser = await User.findByIdAndUpdate(
      id,
      { balance: updatedBalance },
      { new: true }
    ).select("-password");

    // Lưu lịch sử giao dịch
    const historyData = new HistoryUser({
      username: updatedUser.username,
      madon: "null",
      hanhdong: "Trừ tiền",
      link: "",
      tienhientai: tiencu,
      tongtien: amount,
      tienconlai: updatedBalance,
      createdAt: new Date(),
      mota: `Admin trừ thành công số tiền ${amount}`,
    });
    await historyData.save();

    // Gửi thông báo qua Telegram (nếu cấu hình có đủ)
    const taoluc = new Date();
    const teleConfig = await Telegram.findOne();
    if (teleConfig && teleConfig.botToken && teleConfig.chatId) {
      // Giờ Việt Nam (UTC+7)
      const taoluc = new Date(Date.now() + 7 * 60 * 60 * 1000);
      const telegramMessage =
        `📌 *Trừ tiền!*\n` +
        `👤 *Khách hàng:* ${updatedUser.username}\n` +
        `💸 *Số tiền trừ:* Admin đã trừ thành công số tiền ${amount}.\n` +
        `🔹 *Tạo lúc:* ${taoluc.toLocaleString("vi-VN", {
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

    return res.status(200).json({ message: "Trừ tiền thành công" });
  } catch (error) {
    console.error("Deduct balance error:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
};

// Xóa người dùng (chỉ admin mới có quyền)
exports.deleteUser = async (req, res) => {
  try {
    const currentUser = req.user;
    if (currentUser.role !== "admin") {
      return res.status(403).json({ error: "Chỉ admin mới có quyền xóa người dùng" });
    }
    const { id } = req.params;
    const deletedUser = await User.findByIdAndDelete(id);
    if (!deletedUser) {
      return res.status(404).json({ message: "User not found" });
    }
    return res.json({ message: "Xóa user thành công" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// Đổi mật khẩu (chỉ admin hoặc chính chủ tài khoản mới có thể đổi mật khẩu)
exports.changePassword = async (req, res) => {
  try {
    const currentUser = req.user;
    const { id } = req.params;
    const { oldPassword, newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({ error: "Mật khẩu mới không được để trống" });
    }

    // Kiểm tra độ dài mật khẩu mới
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Mật khẩu mới phải có ít nhất 6 ký tự" });
    }

    // Kiểm tra quyền hạn
    if (currentUser.role !== "admin" && currentUser._id.toString() !== id) {
      return res.status(403).json({ error: "Bạn không có quyền đổi mật khẩu cho người dùng này" });
    }

    // Tìm user
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: "Người dùng không tồn tại" });
    }

    // Nếu không phải admin, kiểm tra mật khẩu cũ
    if (currentUser.role !== "admin") {
      if (!oldPassword) {
        return res.status(400).json({ error: "Vui lòng cung cấp mật khẩu hiện tại" });
      }
      const isMatch = await user.comparePassword(oldPassword);
      if (!isMatch) {
        return res.status(400).json({ error: "Mật khẩu hiện tại không chính xác" });
      }
    }

    // Cập nhật mật khẩu mới
    user.password = newPassword;

    // Tạo token mới
    const newToken = jwt.sign(
      { username: user.username, userId: user._id, role: user.role },
      process.env.secretKey
    );

    // **Tạo API key mới**
    const newApiKey = crypto.randomBytes(32).toString("hex");

    // Cập nhật thông tin mới vào database
    user.apiKey = newApiKey;
    await user.save();

    return res.status(200).json({
      message: "Đổi mật khẩu thành công"

    });
  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({ error: "Có lỗi xảy ra. Vui lòng thử lại sau." });
  }
};

// // Lấy danh sách tất cả người dùng (chỉ admin mới có quyền)
// exports.getAllUsers = async (req, res) => {
//   try {
//     const currentUser = req.user;
//     if (currentUser.role !== "admin") {
//       return res.status(403).json({ error: "Chỉ admin mới có quyền xem danh sách người dùng" });
//     }
//     const users = await User.find()
//       .select("-password")
//       .sort({ balance: -1 }); // Sắp xếp theo balance từ cao đến thấp

//     // Lấy tất cả user, loại bỏ trường password
//     //const users = await User.find().select("-password");
//     return res.status(200).json({ users });
//   } catch (error) {
//     console.error("Get all users error:", error);
//     return res.status(500).json({ error: "Có lỗi xảy ra. Vui lòng thử lại sau." });
//   }
// };
exports.getUsers = async (req, res) => {
  try {
    const currentUser = req.user;
    if (currentUser.role !== "admin") {
      return res.status(403).json({ error: "Chỉ admin mới có quyền xem danh sách người dùng" });
    }

    // Lấy các tham số từ query
    let { username } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    // Tạo bộ lọc tìm kiếm
    const filter = username ? { username: { $regex: username, $options: "i" } } : {};

    const skip = (page - 1) * limit;
    const users = await User.find(filter)
      .select("-password")
      .sort({ balance: -1 })
      .skip(skip)
      .limit(limit);

    // Tổng số người dùng
    const total = await User.countDocuments(filter);

    return res.json({
      total,
      page,
      totalPages: Math.ceil(total / limit),
      users,
    });
  } catch (error) {
    console.error("Lỗi khi lấy danh sách người dùng:", error);
    return res.status(500).json({ message: "Lỗi server", error: error.message });
  }
};

// Lấy danh sách lịch sử theo username hoặc orderId, hỗ trợ phân trang
exports.getHistory = async (req, res) => {
  try {
    const currentUser = req.user;
    let { page = 1, limit = 10, orderId, search, action } = req.query;
    page = parseInt(page);
    limit = limit === "all" ? null : parseInt(limit);
    const skip = (page - 1) * (limit || 0);
    let filter = {};

    if (currentUser.role === "admin") {
      // Admin: xem tất cả, tìm kiếm theo username hoặc orderId
      if (orderId) {
        filter.madon = orderId;
      }
      if (search) {
        filter.username = { $regex: search, $options: "i" };
      }
      if (action) {
        filter.hanhdong = action;
      }
    } else {
      // User thường: chỉ xem lịch sử của chính mình
      filter.username = currentUser.username;
      if (orderId) {
        filter.madon = orderId;
        // filter.search = link;
      }
      if (action) {
        filter.hanhdong = action;
      }
    }

    if (!limit) {
      const history = await HistoryUser.find(filter).sort({ createdAt: -1 });
      return res.status(200).json({
        history,
        totalItems: history.length,
        page: 1,
        totalPages: 1,
      });
    }

    const totalItems = await HistoryUser.countDocuments(filter);
    const totalPages = Math.ceil(totalItems / limit);

    const history = await HistoryUser.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return res.status(200).json({
      history,
      totalItems,
      page,
      totalPages,
    });
  } catch (error) {
    console.error("Lỗi khi lấy lịch sử:", error);
    res.status(500).json({ message: "Lỗi server", error });
  }
};




