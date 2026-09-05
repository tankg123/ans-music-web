/** API client + phiên đăng nhập — backend TÁCH RỜI, gọi qua VITE_API_URL với
 *  header X-API-Key (VITE_BACKEND_API_KEY) từ frontend/.env. */
export interface User {
  id: string; email: string; display_name: string; role: string;
  plan: string; avatar_url: string | null;
}
// Địa chỉ backend. Nếu VITE_API_URL trỏ localhost/127.0.0.1 nhưng trang đang mở
// từ máy khác (điện thoại/máy cùng LAN), tự đổi host API sang đúng host đang mở
// (giữ nguyên cổng 4039) → thiết bị LAN gọi được backend mà KHÔNG cần sửa .env.
function resolveApiUrl(): string {
  const raw = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(raw)) return raw; // đường dẫn tương đối → giữ nguyên
  try {
    const u = new URL(raw);
    const pageHost = window.location.hostname;
    const apiLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    const pageRemote = pageHost && pageHost !== 'localhost' && pageHost !== '127.0.0.1';
    if (apiLocal && pageRemote) u.hostname = pageHost;
    return u.toString().replace(/\/+$/, '');
  } catch {
    return raw;
  }
}
// http://localhost:4039/api  (backend). Bỏ '/' cuối nếu có.
export const API_URL = resolveApiUrl();
const API_KEY = import.meta.env.VITE_BACKEND_API_KEY || '';

/** Đường dẫn media/stream backend trả về (bắt đầu '/…') → URL tuyệt đối tới backend. */
export function assetUrl(p?: string | null): string {
  if (!p) return '';
  return /^https?:\/\//.test(p) ? p : API_URL + p;
}

// Brand nạp từ backend lúc khởi động (thay window.ANS_CFG). Mutable — components đọc
// sau khi loadBrand() xong sẽ thấy giá trị thật.
export const BRAND: Record<string, string> = {
  brand_name: 'ANS Music', brand_short: 'ANS', brand_suffix: 'Music',
  brand_tagline: 'Nghe nhạc trực tuyến', brand_accent: '#7c5cff',
  brand_logo_url: '', brand_favicon_url: '/favicon.svg',
};

/** Đổi icon trên tab trình duyệt theo brand. File upload nằm ở backend
 *  (/media/…) nên cần assetUrl; đường dẫn tĩnh của frontend (vd /favicon.svg)
 *  giữ nguyên. */
export function applyFavicon(url?: string | null): void {
  if (!url) return;
  const href = url.startsWith('/media/') ? assetUrl(url) : url;
  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
  const ext = href.split('?')[0].split('.').pop()?.toLowerCase();
  link.type = ext === 'svg' ? 'image/svg+xml'
    : ext === 'png' ? 'image/png'
    : ext === 'ico' ? 'image/x-icon'
    : ext === 'webp' ? 'image/webp'
    : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : '';
  link.href = href;
}

export async function loadBrand(): Promise<void> {
  try {
    const b = await api.get<Record<string, string>>('/v1/brand');
    Object.assign(BRAND, b);
    if (BRAND.brand_accent) document.documentElement.style.setProperty('--accent', BRAND.brand_accent);
    document.title = `${BRAND.brand_name} — ${BRAND.brand_tagline}`;
    applyFavicon(BRAND.brand_favicon_url);
  } catch { /* backend chưa sẵn sàng — dùng mặc định */ }
}

const TOKEN_KEY = 'ans_token';
const USER_KEY = 'ans_user';
type Listener = () => void;

class Auth {
  token: string | null = localStorage.getItem(TOKEN_KEY);
  user: User | null = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  private listeners = new Set<Listener>();
  get loggedIn() { return !!this.token; }
  set(token: string, user: User) {
    this.token = token; this.user = user;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    this.emit();
  }
  clear() {
    this.token = null; this.user = null;
    localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY);
    this.emit();
  }
  subscribe(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { this.listeners.forEach(fn => fn()); }
}
export const auth = new Auth();

export class ApiError extends Error { status: number; constructor(msg: string, status: number) { super(msg); this.status = status; } }

async function request<T = any>(method: string, url: string, body?: any, isForm = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (API_KEY) headers['X-API-Key'] = API_KEY;
  if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  const res = await fetch(API_URL + url, { method, headers, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  if (res.status === 401 && auth.token) auth.clear();
  let data: any = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const detail = data?.detail;
    const msg = typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : `Lỗi ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export const api = {
  get: <T = any>(url: string) => request<T>('GET', url),
  post: <T = any>(url: string, body?: any) => request<T>('POST', url, body),
  put: <T = any>(url: string, body?: any) => request<T>('PUT', url, body),
  patch: <T = any>(url: string, body?: any) => request<T>('PATCH', url, body),
  del: <T = any>(url: string) => request<T>('DELETE', url),
  upload: <T = any>(url: string, form: FormData) => request<T>('POST', url, form, true),
};

/** Upload kèm tiến độ (XHR) cho widget % khi tải nhạc. */
export function uploadWithProgress<T = any>(
  url: string, form: FormData, onProgress?: (p: { loaded: number; total: number; percent: number }) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', API_URL + url);
    if (API_KEY) xhr.setRequestHeader('X-API-Key', API_KEY);
    if (auth.token) xhr.setRequestHeader('Authorization', `Bearer ${auth.token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress)
        onProgress({ loaded: e.loaded, total: e.total, percent: Math.round((e.loaded / e.total) * 100) });
    };
    xhr.onload = () => {
      let data: any = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* */ }
      if (xhr.status === 401 && auth.token) auth.clear();
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else {
        const detail = data?.detail;
        reject(new ApiError(typeof detail === 'string' ? detail : `Lỗi ${xhr.status}`, xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError('Lỗi mạng', 0));
    xhr.send(form);
  });
}

// ---- Auth flows ----
export async function login(email: string, password: string) {
  const data = await api.post('/v1/auth/login', { email, password });
  if (data.requires_2fa) return data;
  auth.set(data.token, data.user);
  return data;
}
export async function loginVerify2fa(pending: string, code: string) {
  const data = await api.post('/v1/auth/2fa/verify', { pending, code });
  auth.set(data.token, data.user); return data;
}
export const registerRequest = (email: string, password: string, displayName: string) =>
  api.post('/v1/auth/register/request', { email, password, display_name: displayName });
export async function registerConfirm(email: string, code: string) {
  const data = await api.post('/v1/auth/register/confirm', { email, code });
  auth.set(data.token, data.user); return data;
}
export const forgotPassword = (email: string) => api.post('/v1/auth/password/forgot', { email });
export const resetPassword = (email: string, code: string, newPassword: string) =>
  api.post('/v1/auth/password/reset', { email, code, new_password: newPassword });
