const SmmSv = require("../../models/SmmSv");
const SmmApiService = require('../../controllers/Smm/smmServices'); // Đảm bảo đường dẫn đúng đến SmmApiService

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
        // Nếu có SmmApiService, lấy balance cho từng partner đang hoạt động
        const partnersWithBalance = await Promise.all(partners.map(async (partner) => {
            let balance = null;
            if (partner.status === 'on' && partner.url_api && partner.api_token) {
                try {
                    const smmService = new SmmApiService(partner.url_api, partner.api_token);
                    const balanceData = await smmService.balance();
                    balance = balanceData.balance * partner.tigia || 1;
                } catch (err) {
                    balance = { error: err.message };
                }
            }
            
            return { ...partner.toObject(), balance };
        }));
        res.status(200).json(partnersWithBalance);
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
