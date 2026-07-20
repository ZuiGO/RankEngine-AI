import axios from 'axios';

export const API_BASE = 'http://localhost:3000/api';

const api = axios.create({
  baseURL: API_BASE,
});

// Attach JWT from localStorage to every outgoing request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('re_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, clear stale token so ProtectedRoute redirects to /login
// On 402, dispatch a custom DOM event for the UpgradeBanner to consume
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('re_token');
      window.location.href = '/login';
    }
    if (err.response?.status === 402) {
      const data = err.response.data || {};
      window.dispatchEvent(
        new CustomEvent('upgrade-required', {
          detail: {
            feature: data.feature || 'this feature',
            requiredPlan: data.requiredPlan || 'pro',
          },
        })
      );
    }
    return Promise.reject(err);
  }
);

export default api;
