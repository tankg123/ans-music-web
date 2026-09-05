/* API client + quản lý phiên đăng nhập */
const TOKEN_KEY = 'ans_token';
const USER_KEY = 'ans_user';

// API key giao tiếp frontend↔backend — tiêm từ server (.env) vào window.ANS_CFG
const API_KEY = (window.ANS_CFG && window.ANS_CFG.apiKey) || '';

export const auth = {
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: JSON.parse(localStorage.getItem(USER_KEY) || 'null'),

  set(token, user) {
    this.token = token;
    this.user = user;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    window.dispatchEvent(new CustomEvent('auth:change'));
  },
  clear() {
    this.token = null;
    this.user = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.dispatchEvent(new CustomEvent('auth:change'));
  },
  get loggedIn() { return !!this.token; },
};

async function request(method, url, body, isForm = false) {
  const headers = {};
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
  if (body && !isForm) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });

  if (res.status === 401 && auth.token) {
    auth.clear(); // token hết hạn
  }
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const msg = data && data.detail
      ? (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail))
      : `Lỗi ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  patch: (url, body) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
  upload: (url, formData) => request('POST', url, formData, true),
};

/* Upload multipart CÓ tiến độ — dùng XMLHttpRequest (fetch không hỗ trợ progress)
   để bắt xhr.upload.onprogress → gọi onProgress({loaded,total,percent}).
   Vẫn gắn X-API-Key + Authorization như request(); xử lý 401, parse JSON,
   reject Error(msg) khi !2xx. Trả Promise<data>. */
export function uploadWithProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    if (API_KEY) xhr.setRequestHeader('X-API-Key', API_KEY);
    if (auth.token) xhr.setRequestHeader('Authorization', `Bearer ${auth.token}`);
    // KHÔNG set Content-Type — trình duyệt tự thêm boundary cho multipart

    if (xhr.upload && typeof onProgress === 'function') {
      xhr.upload.onprogress = (e) => {
        const total = e.lengthComputable ? e.total : 0;
        const percent = total ? Math.round((e.loaded / total) * 100) : 0;
        onProgress({ loaded: e.loaded, total, percent });
      };
    }

    xhr.onload = () => {
      if (xhr.status === 401 && auth.token) auth.clear(); // token hết hạn
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* no body */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        const msg = data && data.detail
          ? (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail))
          : `Lỗi ${xhr.status}`;
        const err = new Error(msg);
        err.status = xhr.status;
        reject(err);
      }
    };
    xhr.onerror = () => reject(new Error('Lỗi mạng khi upload'));
    xhr.send(formData);
  });
}

/* Đăng nhập. Trả về:
   - {requires_2fa:true, pending, email}  → tài khoản bật 2FA, cần gọi loginVerify2fa
   - {token, user}                        → đã đăng nhập xong (auth.set sẵn)     */
export async function login(email, password) {
  const data = await api.post('/v1/auth/login', { email, password });
  if (data.requires_2fa) return data;
  auth.set(data.token, data.user);
  return data;
}

/* Bước 2 đăng nhập khi bật 2FA: mã 6 số từ Google Authenticator */
export async function loginVerify2fa(pending, code) {
  const data = await api.post('/v1/auth/2fa/verify', { pending, code });
  auth.set(data.token, data.user);
  return data;
}

/* Quên mật khẩu: gửi mã qua email → đặt mật khẩu mới bằng mã */
export const forgotPassword = (email) =>
  api.post('/v1/auth/password/forgot', { email });
export const resetPassword = (email, code, newPassword) =>
  api.post('/v1/auth/password/reset', { email, code, new_password: newPassword });

/* Hồ sơ cá nhân + 2FA */
export const getProfile = () => api.get('/v1/me/profile');
export const updateProfile = (patch) => api.patch('/v1/me', patch);
export const uploadAvatar = (formData) => api.upload('/v1/me/avatar', formData);
export async function changePassword(currentPassword, newPassword) {
  const data = await api.post('/v1/me/password',
    { current_password: currentPassword, new_password: newPassword });
  // server cấp token mới (đã tăng token_version) → giữ phiên hiện tại đăng nhập
  if (data && data.token) auth.set(data.token, auth.user);
  return data;
}
export const twofaSetup = () => api.post('/v1/me/2fa/setup');
export const twofaEnable = (code) => api.post('/v1/me/2fa/enable', { code });
export const twofaDisable = (password, code) =>
  api.post('/v1/me/2fa/disable', { password, code });

/* Đăng ký 2 bước có xác thực email */
export async function registerRequest(email, password, displayName) {
  return api.post('/v1/auth/register/request', {
    email, password, display_name: displayName,
  });
}

export async function registerConfirm(email, code) {
  const data = await api.post('/v1/auth/register/confirm', { email, code });
  auth.set(data.token, data.user);
  return data.user;
}
