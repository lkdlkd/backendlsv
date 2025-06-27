const SmmSv = require("../../models/SmmSv");

// Thêm mới một đối tác SMM
exports.createPartner = async (req, res) => {
    try {
        const user = req.user;
        if (!user || user.role !== "admin") {
            return res.status(403).json({ error: "Chỉ admin mới có quyền sử dụng chức năng này" });
        }
        const newPartner = new SmmSv(req.body);
        await newPartner.save();
        res.status(201).json({ message: "Đã thêm đối tác SMM thành công!", data: newPartner });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Lấy danh sách tất cả đối tác SMM
exports.getAllPartners = async (req, res) => {
    try {
        const user = req.user;
        if (!user || user.role !== "admin") {
            return res.status(403).json({ error: "Chỉ admin mới có quyền sử dụng chức năng này" });
        }
        const partners = await SmmSv.find();
        res.status(200).json(partners);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Lấy thông tin một đối tác SMM theo ID
exports.getPartnerById = async (req, res) => {
    try {
        const user = req.user;
        if (!user || user.role !== "admin") {
            return res.status(403).json({ error: "Chỉ admin mới có quyền sử dụng chức năng này" });
        }
        const partner = await SmmSv.findById(req.params.id);
        if (!partner) {
            return res.status(404).json({ message: "Không tìm thấy đối tác SMM!" });
        }
        res.status(200).json(partner);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Cập nhật thông tin đối tác SMM
exports.updatePartner = async (req, res) => {
    try {
        const user = req.user;
        if (!user || user.role !== "admin") {
            return res.status(403).json({ error: "Chỉ admin mới có quyền sử dụng chức năng này" });
        }
        const updatedPartner = await SmmSv.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!updatedPartner) {
            return res.status(404).json({ message: "Không tìm thấy đối tác SMM!" });
        }
        res.status(200).json({ message: "Cập nhật thành công!", data: updatedPartner });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Xóa đối tác SMM
exports.deletePartner = async (req, res) => {
    try {
        const user = req.user;
        if (!user || user.role !== "admin") {
            return res.status(403).json({ error: "Chỉ admin mới có quyền sử dụng chức năng này" });
        }
        const deletedPartner = await SmmSv.findByIdAndDelete(req.params.id);
        if (!deletedPartner) {
            return res.status(404).json({ message: "Không tìm thấy đối tác SMM!" });
        }
        res.status(200).json({ message: "Xóa thành công!" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
