/** Khung Admin CMS — nav theo role, chuyển section bằng state (như bản cũ). */
import { useEffect, useState } from 'react';
import { auth, BRAND, assetUrl } from '../api';
import { useAuth } from '../useAuth';
import './admin.css';

import Dashboard from './sections/Dashboard';
import Products from './sections/Products';
import TracksSec from './sections/Tracks';
import Artists from './sections/Artists';
import Labels from './sections/Labels';
import Review from './sections/Review';
import IdPool from './sections/IdPool';
import Ddex from './sections/Ddex';
import Partners from './sections/Partners';
import Distributions from './sections/Distributions';
import Users from './sections/Users';
import Settings from './sections/Settings';
import { Toasts } from './ui';

type Role = 'admin' | 'manager' | 'uploader';
interface Sec { key: string; label: string; group: string; roles: Role[]; C: React.FC; }

const SECTIONS: Sec[] = [
  { key: 'dashboard', label: '📊 Tổng quan', group: '', roles: ['admin', 'manager'], C: Dashboard },
  { key: 'products', label: '📦 Products', group: 'Nội dung', roles: ['admin', 'manager', 'uploader'], C: Products },
  { key: 'tracks', label: '🎵 Bài hát', group: 'Nội dung', roles: ['admin', 'manager'], C: TracksSec },
  { key: 'artists', label: '🎤 Nghệ sĩ', group: 'Nội dung', roles: ['admin', 'manager'], C: Artists },
  { key: 'labels', label: '🏷 Labels', group: 'Nội dung', roles: ['admin', 'manager'], C: Labels },
  { key: 'review', label: '✅ Hàng chờ duyệt', group: 'Phát hành', roles: ['admin', 'manager'], C: Review },
  { key: 'idpool', label: '🔢 Kho mã UPC/ISRC', group: 'Phát hành', roles: ['admin', 'manager'], C: IdPool },
  { key: 'ddex', label: '📦 DDEX Ingestion', group: 'Phát hành', roles: ['admin', 'manager'], C: Ddex },
  { key: 'partners', label: '🤝 Đối tác', group: 'Phát hành', roles: ['admin'], C: Partners },
  { key: 'distributions', label: '🛰 Distributions', group: 'Phát hành', roles: ['admin'], C: Distributions },
  { key: 'users', label: '👥 Tài khoản', group: 'Hệ thống', roles: ['admin'], C: Users },
  { key: 'settings', label: '⚙ Cài đặt thương hiệu', group: 'Hệ thống', roles: ['admin'], C: Settings },
];

export default function AdminApp() {
  const { loggedIn, user } = useAuth();
  const role = user?.role as Role | undefined;
  const isStaff = role && ['admin', 'manager', 'uploader'].includes(role);
  const visible = SECTIONS.filter(s => role && s.roles.includes(role));
  const [active, setActive] = useState('');

  useEffect(() => {
    if (isStaff && !active) setActive(role === 'uploader' ? 'products' : 'dashboard');
  }, [isStaff, role]);

  if (!loggedIn || !isStaff) {
    return (
      <div className="admin-gate">
        <img src={assetUrl(BRAND.brand_logo_url) || '/favicon.svg'} width={48} height={48} alt="" />
        <h2>Khu vực quản trị</h2>
        <p>Bạn cần đăng nhập bằng tài khoản quản trị nội dung.</p>
        <a className="btn btn-primary" href="/login">Đăng nhập quản trị</a>
        <a className="back" href="/">← Về web nghe nhạc</a>
      </div>
    );
  }

  const Active = visible.find(s => s.key === active)?.C || (() => null);
  const groups = [...new Set(visible.map(s => s.group))];

  return (
    <div id="admin-app">
      <aside id="a-sidebar">
        <a className="brand" href="/admin">
          <img src={assetUrl(BRAND.brand_logo_url) || '/favicon.svg'} width={30} height={30} alt="" />
          <span>{BRAND.brand_name || 'ANS Music'} <b>Admin</b></span>
        </a>
        <nav id="a-nav">
          {groups.map(g => (
            <div key={g || 'top'}>
              {g && <div className="nav-group-label">{g}</div>}
              {visible.filter(s => s.group === g).map(s => (
                <button key={s.key} className={active === s.key ? 'active' : ''}
                  onClick={() => setActive(s.key)}>{s.label}</button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="who">{user?.email} — {role}</div>
          <a href="/" target="_blank">↗ Mở web nghe nhạc</a>
          <button onClick={() => { auth.clear(); location.href = '/login'; }}>Đăng xuất</button>
        </div>
      </aside>
      <main id="a-main"><Active /></main>
      <Toasts />
    </div>
  );
}
