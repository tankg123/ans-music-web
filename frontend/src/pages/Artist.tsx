import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, assetUrl } from '../api';
import { AlbumCard, ArtistCard, TrackList } from '../components/cards';
import { usePlayer, type Track } from '../player';
import { useAuth } from '../useAuth';
import { useLang } from '../i18n';
import './pages-extra.css';

function useTilt(max = 9) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--rx', `${(-py * max).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${(px * max).toFixed(2)}deg`);
  };
  const reset = () => {
    const el = ref.current; if (!el) return;
    el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg');
  };
  return { ref, onMouseMove: onMove, onMouseLeave: reset };
}

const fmtCount = (n?: number) => (n || 0).toLocaleString('vi-VN');

export default function Artist() {
  const { id } = useParams();
  const { t } = useLang();
  const { loggedIn } = useAuth();
  const p = usePlayer();
  const tilt = useTilt();
  const [a, setA] = useState<any>(null);
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setA(null);
    api.get(`/v1/artists/${id}`).then(d => { setA(d); setFollowing(!!d.following); }).catch(() => setA(false));
  }, [id]);

  if (a === false) return <div className="pe-empty"><div className="pe-empty-ic">🎤</div><h3>{t('notFound')}</h3></div>;
  if (!a) return <div className="empty">{t('loading')}</div>;

  const accent = a.accent || 'var(--accent)';
  const topTracks: Track[] = a.top_tracks || [];

  const toggleFollow = async () => {
    if (busy) return;
    setBusy(true);
    const target = !following;
    try {
      if (target) await api.post(`/v1/me/follows/${a.id}`);
      else await api.del(`/v1/me/follows/${a.id}`);
      setFollowing(target);
    } catch { /* giữ nguyên trạng thái nếu lỗi */ }
    finally { setBusy(false); }
  };

  return (
    <div className="page pe-scope" style={{ ['--pg-accent' as any]: accent }}>
      <div className="pe-hero">
        <div className="pe-avatar-wrap">
          <div className="pe-avatar" {...tilt}>
            {a.image_url ? <img src={assetUrl(a.image_url)} alt={a.name} />
              : <div className="pe-cover-ph">{(a.name || '?')[0]}</div>}
          </div>
        </div>
        <div className="pe-hero-info">
          <div className="pe-type">Nghệ sĩ</div>
          <h1 className="pe-title">{a.name}</h1>
          <div className="pe-submeta">
            <span><b>{fmtCount(a.total_plays)}</b> {t('plays').toLowerCase()}</span>
            <span className="pe-dot">·</span>
            <span><b>{fmtCount(a.followers)}</b> {t('followers')}</span>
          </div>
          <div className="pe-actions">
            <button className="pe-play-big" title={t('play')}
              onClick={() => topTracks.length && p.play(topTracks, 0)}>▶</button>
            {loggedIn ? (
              <button className={'pe-btn' + (following ? ' on' : '')} onClick={toggleFollow} disabled={busy}>
                {following ? `✓ ${t('following')}` : `＋ ${t('follow')}`}
              </button>
            ) : (
              <Link className="pe-btn" to="/login">＋ {t('follow')}</Link>
            )}
          </div>
        </div>
      </div>

      {topTracks.length > 0 && (
        <section className="pe-section">
          <h2 className="pe-h2">{t('topTracks')}</h2>
          <TrackList tracks={topTracks} />
        </section>
      )}

      {a.releases?.length > 0 && (
        <section className="pe-section">
          <h2 className="pe-h2">{t('discography')}</h2>
          <div className="grid-cards">{a.releases.map((r: any) => <AlbumCard key={r.id} album={r} />)}</div>
        </section>
      )}

      {a.appears_on?.length > 0 && (
        <section className="pe-section">
          <h2 className="pe-h2">{t('appearsOn')}</h2>
          <div className="grid-cards">{a.appears_on.map((r: any) => <AlbumCard key={r.id} album={r} />)}</div>
        </section>
      )}

      {a.similar_artists?.length > 0 && (
        <section className="pe-section">
          <h2 className="pe-h2">{t('similarArtists')}</h2>
          <div className="grid-cards artists">{a.similar_artists.map((s: any) => <ArtistCard key={s.id} artist={s} />)}</div>
        </section>
      )}

      {a.bio && (
        <section className="pe-section">
          <h2 className="pe-h2">Giới thiệu</h2>
          <p style={{ color: 'var(--muted)', maxWidth: 660, lineHeight: 1.75 }}>{a.bio}</p>
        </section>
      )}
    </div>
  );
}
