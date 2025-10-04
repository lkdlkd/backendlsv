const axios = require('axios');

class SmmApiService {
  constructor(apiUrl, apiKey) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
  }

  async connect(payload) {
    try {
      const response = await axios.post(this.apiUrl, {
        key: this.apiKey,
        ...payload,
      });
      return response.data;
    } catch (err) {
      // Chuẩn hóa lỗi từ axios để caller luôn nhận được object thay vì throw
      const status = err?.response?.status;
      const data = err?.response?.data;
      if (data && typeof data === 'object') {
        // Nhiều panel trả về { code, status: 'error', error: '...' }
        return data;
      }
      const errorMsg = (data && typeof data === 'string') ? data : (err?.message || 'Unknown error');
      return { status, error: errorMsg };
    }
  }

  async order(data) {
    return this.connect({ action: 'add', ...data });
  }

  async status(orderId) {
    return this.connect({ action: 'status', order: orderId });
  }

  async multiStatus(orderIds) {
    return this.connect({ action: 'status', orders: orderIds.join(',') });
  }

  async services() {
    return this.connect({ action: 'services' });
  }

  async refill(orderId) {
    return this.connect({ action: 'refill', order: orderId });
  }

  async multiRefill(orderIds) {
    return this.connect({ action: 'refill', orders: orderIds.join(',') });
  }

  async refillStatus(refillId) {
    return this.connect({ action: 'refill_status', refill: refillId });
  }

  async multiRefillStatus(refillIds) {
    return this.connect({ action: 'refill_status', refills: refillIds.join(',') });
  }

  async cancel2(orderIds) {
    return this.connect({ action: 'cancel', order: orderIds });
  }

  async cancel(orderIds) {
    return this.connect({ action: 'cancel', orders: orderIds.join(',') });
  }

  async balance() {
    return this.connect({ action: 'balance' });
  }
}

module.exports = SmmApiService;
