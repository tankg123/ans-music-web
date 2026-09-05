import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, assetUrl } from '../api';
import { useLang } from '../i18n';
import { AlbumCard, ArtistCard, TrackList } from '../components/cards';
import './pages-extra.css';

function PlaylistCard({ pl }: { pl: any }) {
  return (
    <Link to={`/playlist/${pl.id}`} className="pe-pl-card album-card">
      <div className="pe-pl-cover" style={{ background: `linear-gradient(135deg, ${pl.accent || 'var(--accent)'}, var(--accent2))` }}>
        {pl.cover_url ? <img src={assetUrl(pl.cover_url)} alt="" loading="lazy" /> : '🎧'}
      </div>
      <div className="ac-title">{pl.title}</div>
      <div className="ac-sub">{pl.track_count != null ? `${pl.track_count} bài` : 'Playlist'}</div>
    </Link>
  );
}

export default function Search() {
  const { t } = useLang();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [genres, setGenres] = useState<any[]>([]);

  // gợi ý thể loại khi ô tìm còn trống
  useEffect(() => {
    api.get('/v1/home').then(d => setGenres(d.genres || [])).catch(() => {});
  }, []);

  // Ctrl+K / Cmd+K → focus ô tìm
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // instant search có debounce
  useEffect(() => {
    const query = q.trim();
    if (!query) { setRes(null); setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(() => {
      api.get(`/v1/search?q=${encodeURIComponent(query)}&limit=8`)
        .then(d => setRes(d))
        .catch(() => setRes(null))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const hasAny = res && (res.tracks?.length || res.artists?.length || res.releases?.length || res.playlists?.length);

  return (
    <div className="page">
      <h1 className="page-title">{t('search')}</h1>

      <div className="pe-search-wrap">
        <span className="pe-search-ic">🔍</span>
        <input ref={inputRef} className="pe-search" autoFocus
          placeholder="Bài hát, nghệ sĩ, album…"
          value={q} onChange={e => setQ(e.target.value)} />
        {loading ? <span className="pe-spinner" /> : <span className="pe-kbd">Ctrl K</span>}
      </div>

      {/* trạng thái rỗng: chưa gõ gì */}
      {!q.trim() && (
        <section className="pe-section">
          {genres.length > 0 ? (
            <>
              <h2 className="pe-h2">{t('genres')}</h2>
              <div className="pe-chips">
                {genres.map((g: any) => (
                  <Link key={g.name} className="pe-chip" to={`/genre/${encodeURIComponent(g.name)}`}>{g.name}</Link>
                ))}
              </div>
            </>
          ) : (
            <div className="pe-empty">
              <div className="pe-empty-ic">🔎</div>
              <h3>{t('search')}</h3>
              <p>Nhập tên bài hát, nghệ sĩ hoặc album. Hỗ trợ tiếng Việt không dấu.</p>
            </div>
          )}
        </section>
      )}

      {/* có kết quả */}
      {q.trim() && res && hasAny && (
        <>
          {res.tracks?.length > 0 && (
            <section className="pe-section">
              <h2 className="pe-h2">Bài hát</h2>
              <TrackList tracks={res.tracks} />
            </section>
          )}
          {res.artists?.length > 0 && (
            <section className="pe-section">
              <h2 className="pe-h2">Nghệ sĩ</h2>
              <div className="grid-cards artists">{res.artists.map((a: any) => <ArtistCard key={a.id} artist={a} />)}</div>
            </section>
          )}
          {res.releases?.length > 0 && (
            <section className="pe-section">
              <h2 className="pe-h2">Album</h2>
              <div className="grid-cards">{res.releases.map((a: any) => <AlbumCard key={a.id} album={a} />)}</div>
            </section>
          )}
          {res.playlists?.length > 0 && (
            <section className="pe-section">
              <h2 className="pe-h2">Playlist</h2>
              <div className="grid-cards">{res.playlists.map((pl: any) => <PlaylistCard key={pl.id} pl={pl} />)}</div>
            </section>
          )}
        </>
      )}

      {/* không có kết quả */}
      {q.trim() && res && !hasAny && !loading && (
        <div className="pe-empty">
          <div className="pe-empty-ic">🫥</div>
          <h3>Không tìm thấy “{q.trim()}”</h3>
          <p>Thử từ khóa khác hoặc kiểm tra chính tả.</p>
        </div>
      )}
    </div>
  );
}
