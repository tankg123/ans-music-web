import React, { useEffect, useState } from 'react';
import { Routes, Route, NavLink, useNavigate, Navigate, Link } from 'react-router-dom';
import { PlayerProvider, usePlayer } from './player';
import { PlayerBar } from './components/PlayerBar';
import NowPlaying from './components/NowPlaying';
import QueuePanel from './components/QueuePanel';
import { BRAND, auth, assetUrl, api } from './api';
import { useAuth } from './useAuth';
import { useLang } from './i18n';
import Home from './pages/Home';
import Login from './pages/Login';
import Album from './pages/Album';
import Albums from './pages/Albums';
import Artist from './pages/Artist';
import Search from './pages/Search';
import Tracks from './pages/Tracks';
import Profile from './pages/Profile';
import Library from './pages/Library';
import Playlist from './pages/Playlist';
import Charts from './pages/Charts';
import Genres from './pages/Genres';
import GenreDetail from './pages/GenreDetail';
import AdminApp from './admin/AdminApp';

function SidebarLibrary() {
  const { loggedIn } = useAuth();
  const { t } = useLang();
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [likedCount, setLikedCount] = useState(0);
  useEffect(() => {
    if (!loggedIn) { setPlaylists([]); setLikedCount(0); return; }
    api.get('/v1/me/playlists').then(d => setPlaylists(d.items || [])).catch(() => {});
    api.get('/v1/me/favorites?type=track').then(d => setLikedCount((d.items || []).length)).catch(() => {});
  }, [loggedIn]);
  if (!loggedIn) return null;
  return (
    <div className="sb-lib">
      <div className="sb-lib-head">📚 {t('library')}</div>
      <div className="sb-lib-list">
        <Link to="/library?tab=liked" className="sb-liked">
          <span className="sb-liked-ic">♥</span>
          <span className="sb-liked-meta">
            <span className="sb-liked-title">{t('favPlaylist')}</span>
            <span className="sb-liked-sub">{likedCount} {t('songsUnit')}</span>
          </span>
        </Link>
        {playlists.map(pl => (
          <Link key={pl.id} to={`/playlist/${pl.id}`} className="sb-pl" title={pl.title}>
            <span className="sb-pl-ic" style={{ background: pl.accent || 'var(--bg-elev2)' }}>
              {pl.cover_url ? <img src={assetUrl(pl.cover_url)} alt="" loading="lazy" /> : '♪'}
            </span>
            <span className="sb-pl-title">{pl.title}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Sidebar() {
  const name = BRAND.brand_name || 'ANS Music';
  const logo = BRAND.brand_logo_url || '/favicon.svg';
  const { loggedIn } = useAuth();
  const { t } = useLang();
  const link = ({ isActive }: { isActive: boolean }) => 'nav-link' + (isActive ? ' active' : '');
  return (
    <aside id="sidebar">
      <NavLink to="/" className="brand">
        <img src={assetUrl(logo) || '/favicon.svg'} alt="" width={34} height={34} />
        <span>{BRAND.brand_short ? <>{BRAND.brand_short} <b>{BRAND.brand_suffix}</b></> : name}</span>
      </NavLink>
      <nav>
        <NavLink to="/" end className={link}>🏠 {t('home')}</NavLink>
        <NavLink to="/search" className={link}>🔍 {t('search')}</NavLink>
        <NavLink to="/charts" className={link}>📊 {t('charts')}</NavLink>
        <NavLink to="/genres" className={link}>🏷 {t('genres')}</NavLink>
        <NavLink to="/albums" className={link}>💿 {t('albums')}</NavLink>
        <NavLink to="/tracks" className={link}>🎵 {t('allTracks')}</NavLink>
        {loggedIn && <NavLink to="/library" className={link}>📚 {t('library')}</NavLink>}
      </nav>
      <SidebarLibrary />
    </aside>
  );
}

function LangToggle() {
  const { lang, toggleLang } = useLang();
  return (
    <button className="lang-toggle" onClick={toggleLang} title="VI / EN">🌐 {lang.toUpperCase()}</button>
  );
}

/* Icon cho thanh điều hướng dưới (mobile) */
const NI = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
    strokeLinecap="round" strokeLinejoin="round" width="23" height="23" {...p} />
);
const NavIc = {
  home: <NI><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></NI>,
  search: <NI><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></NI>,
  charts: <NI><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></NI>,
  album: <NI><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="2.3" /></NI>,
  library: <NI><path d="M4 5v14M9 5v14" /><rect x="13" y="5" width="7" height="14" rx="1.5" /></NI>,
};

/* Thanh điều hướng dưới đáy — chỉ hiện trên màn hình hẹp (điện thoại). */
function MobileNav() {
  const { t } = useLang();
  const cls = ({ isActive }: { isActive: boolean }) => 'mnav-item' + (isActive ? ' active' : '');
  return (
    <nav className="mobile-nav">
      <NavLink to="/" end className={cls}>{NavIc.home}<span>{t('home')}</span></NavLink>
      <NavLink to="/search" className={cls}>{NavIc.search}<span>{t('search')}</span></NavLink>
      <NavLink to="/charts" className={cls}>{NavIc.charts}<span>{t('charts')}</span></NavLink>
      <NavLink to="/albums" className={cls}>{NavIc.album}<span>{t('albums')}</span></NavLink>
      <NavLink to="/library" className={cls}>{NavIc.library}<span>{t('library')}</span></NavLink>
    </nav>
  );
}

function Topbar() {
  const { loggedIn, user } = useAuth();
  const { t, lang, toggleLang } = useLang();
  const nav = useNavigate();
  const isStaff = user && ['admin', 'manager', 'uploader'].includes(user.role);
  const logo = BRAND.brand_logo_url || '/favicon.svg';
  return (
    <header id="topbar">
      <NavLink to="/" className="tb-brand-m">
        <img src={assetUrl(logo) || '/favicon.svg'} alt="" width={30} height={30} />
        <span>{BRAND.brand_short ? <>{BRAND.brand_short} <b>{BRAND.brand_suffix}</b></> : (BRAND.brand_name || 'ANS Music')}</span>
      </NavLink>
      <div className="topbar-nav">
        <button onClick={() => nav(-1)} title="Quay lại">‹</button>
        <button onClick={() => nav(1)} title="Tiếp">›</button>
      </div>
      <div className="spacer" />
      <button className="tb-lang-m" onClick={toggleLang} title="VI / EN">🌐 {lang.toUpperCase()}</button>
      {isStaff && <a className="btn btn-ghost btn-sm tb-admin" href="/admin">🛠 <span className="tb-admin-label">{t('admin')}</span></a>}
      {loggedIn ? (
        <div className="user-menu">
          <Link to="/profile" className="user-chip" title="Hồ sơ của tôi">
            {user?.avatar_url ? <img className="avatar" src={assetUrl(user.avatar_url)} alt="" />
              : <span className="avatar">{(user?.display_name || user?.email || '?')[0].toUpperCase()}</span>}
            <span>{user?.display_name}</span>
          </Link>
          <button className="btn btn-ghost btn-sm" onClick={() => { auth.clear(); nav('/'); }}>{t('logout')}</button>
        </div>
      ) : (
        <NavLink to="/login" className="btn btn-primary btn-sm">{t('login')}</NavLink>
      )}
    </header>
  );
}

function ListenerApp() {
  const p = usePlayer();
  const hasPlayer = !!p.current;
  return (
    <div id="app" className={hasPlayer ? 'has-player' : 'no-player'}>
      <Sidebar />
      <div id="content">
        <Topbar />
        <main id="main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<Search />} />
            <Route path="/charts" element={<Charts />} />
            <Route path="/genres" element={<Genres />} />
            <Route path="/genre/:name" element={<GenreDetail />} />
            <Route path="/albums" element={<Albums />} />
            <Route path="/tracks" element={<Tracks />} />
            <Route path="/album/:id" element={<Album />} />
            <Route path="/artist/:id" element={<Artist />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/library" element={<Library />} />
            <Route path="/playlist/:id" element={<Playlist />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      {hasPlayer && <PlayerBar />}
      <NowPlaying />
      <QueuePanel />
      <LangToggle />
      <MobileNav />
    </div>
  );
}

export default function App() {
  return (
    <PlayerProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="*" element={<ListenerApp />} />
      </Routes>
    </PlayerProvider>
  );
}
