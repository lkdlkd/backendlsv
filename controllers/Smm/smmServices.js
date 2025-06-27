const axios = require('axios');

class SmmApiService {
  constructor(apiUrl, apiKey) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
  }

  async connect(payload) {
    const response = await axios.post(this.apiUrl, {
      key: this.apiKey,
      ...payload,
    });
    return response.data;
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

  async cancel(orderIds) {
    return this.connect({ action: 'cancel', orders: orderIds.join(',') });
  }

  async balance() {
    return this.connect({ action: 'balance' });
  }
}

module.exports = SmmApiService;
