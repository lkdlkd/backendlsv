const Service = require('../../models/server');
const User = require('../../models/User');

// Thêm dịch vụ mới (chỉ admin)
const Counter = require("../../models/Counter "); // Import model Counter

exports.addServer = async (req, res) => {
  try {
    const user = req.user;
    if (!user || user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Chỉ admin mới có quyền sử dụng chức năng này" });
    }

    // Lấy giá trị Magoi tiếp theo từ bộ đếm
    const counter = await Counter.findOneAndUpdate(
      { name: "Magoi" },
      { $inc: { value: 1 } },
      { new: true, upsert: true } // Tạo mới nếu chưa tồn tại
    );
    // Gán giá trị Magoi tự động tăng
    let rate = req.body.rate;
    if (typeof rate === 'number') {
      rate = Math.round(rate * 10000) / 10000;
    }
    const newService = new Service({
      ...req.body,
      rate,
      Magoi: counter.value, // Gán giá trị Magoi từ bộ đếm
    });

    await newService.save();
    res.status(201).json({ success: true, message: "Dịch vụ được thêm thành công", data: newService });
  } catch (error) {
    res.status(400).json({ success: false, message: "Lỗi khi thêm dịch vụ", error: error.message });
  }
};
// Lấy danh sách dịch vụ (admin có phân trang, user thường chỉ lấy dịch vụ đang hoạt động)
exports.getServer = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, message: "Không xác thực được người dùng" });
    }

    const search = req.query.search ? req.query.search.trim() : "";
    let filter = {};

    // Tạo bộ lọc tìm kiếm
    if (search) {
      filter = {
        $or: [
          { Magoi: { $regex: search, $options: "i" } },
          { serviceId: { $regex: search, $options: "i" } },
          { name: { $regex: search, $options: "i" } },
        ],
      };
    }

    // Nếu không phải admin, chỉ hiển thị các dịch vụ đang hoạt động
    if (user.role !== "admin") {
      filter = { ...filter, isActive: true };
    }

    if (user.role === "admin") {
      // Admin: có thể xem tất cả dịch vụ với phân trang
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      const totalServices = await Service.countDocuments(filter);
      const services = await Service.find(filter)
        .populate("category", "name path") // Lấy thông tin tên của Category
        .populate("type", "name logo") // Lấy thông tin của Platform
        .skip(skip)
        .limit(limit);

      const formattedServices = services.map(service => ({
        _id: service._id,
        DomainSmm: service.DomainSmm,
        serviceName: service.serviceName,
        originalRate: service.originalRate,
        category: service.category ? service.category.name : "Không xác định",
        description: service.description,
        Magoi: service.Magoi,
        type: service.type ? service.type.name : "không xác định", // Trả về tên của Platform
        name: service.name,
        path: service.category.path || "",
        rate: service.rate,
        maychu: service.maychu,
        min: service.min,
        max: service.max,
        Linkdv: service.Linkdv,
        serviceId: service.serviceId,
        getid: service.getid,
        comment: service.comment,
        reaction: service.reaction,
        matlive: service.matlive,
        isActive: service.isActive,
        createdAt: service.createdAt,
        updatedAt: service.updatedAt,
      }));

      return res.status(200).json({
        success: true,
        data: formattedServices,
        pagination: {
          totalItems: totalServices,
          currentPage: page,
          totalPages: Math.ceil(totalServices / limit),
          pageSize: formattedServices.length,
        },
      });
    } else {
      // User thường: chỉ lấy các trường cần thiết
      const services = await Service.find(filter).populate("category", "name path");

      const formattedServices = services.map(service => ({
        description: service.description,
        path: service.category.path || "", // Lấy đường dẫn của Category
        Magoi: service.Magoi,
        id: service.id,
        maychu: service.maychu,
        getid: service.getid,//chức năng get id sau khi nhập link mua
        comment: service.comment,//chức năng get id sau khi nhập link mua
        reaction: service.reaction,//chức năng get id sau khi nhập link mua
        matlive: service.matlive,//chức năng get id sau khi nhập link mua
        name: service.name,
        rate: service.rate,
        min: service.min,
        max: service.max,
        type: service.type, // Lấy tên của Category
        category: service.category.name, // Lấy tên của Category
        isActive: service.isActive,
      }));

      return res.status(200).json({ success: true, data: formattedServices });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Lỗi khi lấy danh sách dịch vụ",
      error: error.message,
    });
  }
};

// Cập nhật dịch vụ (chỉ admin)
exports.updateServer = async (req, res) => {
  try {
    const user = req.user;
    if (!user || user.role !== "admin") {
      return res.status(403).json({ success: false, message: 'Chỉ admin mới có quyền sử dụng chức năng này' });
    }

    let updateData = { ...req.body };
    if (typeof updateData.rate === 'number') {
      updateData.rate = Math.round(updateData.rate * 10000) / 10000;
    }
    const updatedService = await Service.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!updatedService) {
      return res.status(404).json({ success: false, message: 'Dịch vụ không tồn tại' });
    }
    res.status(200).json({ success: true, message: 'Cập nhật dịch vụ thành công', data: updatedService });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Lỗi khi cập nhật dịch vụ', error: error.message });
  }
};

// Xóa dịch vụ (chỉ admin)
exports.deleteServer = async (req, res) => {
  try {
    const user = req.user;
    if (!user || user.role !== "admin") {
      return res.status(403).json({ success: false, message: 'Chỉ admin mới có quyền sử dụng chức năng này' });
    }

    const deletedService = await Service.findByIdAndDelete(req.params.id);
    if (!deletedService) {
      return res.status(404).json({ success: false, message: 'Dịch vụ không tồn tại' });
    }
    res.status(200).json({ success: true, message: 'Xóa dịch vụ thành công' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Lỗi khi xóa dịch vụ', error: error.message });
  }
};

exports.getServerByTypeAndPath = async (req, res) => {
  try {
    const { path } = req.query;

    // Nếu không có path thì trả về lỗi
    if (!path) {
      return res.status(400).json({ success: false, message: "Thiếu tham số path" });
    }

    // Lấy danh sách dịch vụ theo path category
    const services = await Service.aggregate([
      {
        $lookup: {
          from: "categories",
          localField: "category",
          foreignField: "_id",
          as: "category"
        }
      },
      { $unwind: "$category" },
      {
        $match: {
          "category.path": { $regex: path, $options: "i" }
        }
      }
    ]);

    // Lấy thông tin note và modal_show duy nhất từ category
    const uniqueNotes = services.length > 0
      ? {
        note: services[0].category.notes || "",
        modal_show: services[0].category.modal_show || "",
      }
      : { note: "", modal_show: "" };

    // Định dạng lại dữ liệu trả về
    const formattedServices = services.map(service => ({
      description: service.description,
      Magoi: service.Magoi,
      id: service.id,
      maychu: service.maychu,
      name: service.name,
      rate: service.rate,
      min: service.min,
      max: service.max,
      getid: service.getid,
      comment: service.comment,
      reaction: service.reaction,
      matlive: service.matlive,
      type: service.type,
      category: service.category.name,
      path: service.category.path,
      isActive: service.isActive,
    }));

    return res.status(200).json({
      success: true,
      notes: uniqueNotes,
      data: formattedServices,
    });
  } catch (error) {
    console.error("Lỗi khi lấy danh sách dịch vụ theo path:", error);
    return res.status(500).json({
      success: false,
      message: "Lỗi khi lấy danh sách dịch vụ",
      error: error.message,
    });
  }
};