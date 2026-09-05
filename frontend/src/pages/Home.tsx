import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, assetUrl } from '../api';
import { AlbumCard, ArtistCard, TrackList } from '../components/cards';
import { usePlayer } from '../player';
import { useLang } from '../i18n';
import './home3d.css';

/** style có kèm CSS custom property (--x…) mà không lỗi type. */
const vars = (o: Record<string, string | number>) => o as CSSProperties;

/* --------- Card nghiêng theo con trỏ (bọc AlbumCard/ArtistCard…) --------- */
function Tilt({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    ref.current.classList.add('tilting');
    ref.current.style.setProperty('--ry', `${(px * 10).toFixed(2)}deg`);
    ref.current.style.setProperty('--rx', `${(-py * 10).toFixed(2)}deg`);
  };
  const reset = () => {
    if (!ref.current) return;
    ref.current.classList.remove('tilting');
    ref.current.style.setProperty('--rx', '0deg');
    ref.current.style.setProperty('--ry', '0deg');
  };
  return (
    <div ref={ref} className="tilt3d" onPointerMove={onMove} onPointerLeave={reset}>
      {children}
    </div>
  );
}

/* --------- Coverflow 3D cho album nổi bật --------- */
function Coverflow({ items, center, setCenter }: { items: any[]; center: number; setCenter: (i: number) => void }) {
  const nav = useNavigate();
  const n = items.length;
  return (
    <div className="cf3d">
      <div className="cf-stage">
        {items.map((a, i) => {
          const off = i - center;
          const abs = Math.abs(off);
          if (abs > 3) return null;
          const isCenter = off === 0;
          const transform =
            `translateX(${off * 62}%) ` +
            `translateZ(${isCenter ? 60 : -abs * 90}px) ` +
            `rotateY(${off * -34}deg) ` +
            `scale(${isCenter ? 1 : Math.max(0.6, 0.84 - (abs - 1) * 0.1)})`;
          const opacity = isCenter ? 1 : Math.max(0.28, 0.7 - (abs - 1) * 0.22);
          return (
            <div
              key={a.id}
              className={'cf-item' + (isCenter ? ' is-center' : '')}
              style={vars({ transform, opacity, zIndex: 20 - abs })}
              onClick={() => (isCenter ? nav(`/album/${a.id}`) : setCenter(i))}
              title={a.title}
            >
              <img src={assetUrl(a.cover_url)} alt={a.title} loading="lazy" />
            </div>
          );
        })}
      </div>
      <button className="cf-nav prev" onClick={() => setCenter(Math.max(0, center - 1))} aria-label="Trước">‹</button>
      <button className="cf-nav next" onClick={() => setCenter(Math.min(n - 1, center + 1))} aria-label="Sau">›</button>
      <div className="cf-dots">
        {items.map((a, i) => (
          <button key={a.id} className={i === center ? 'on' : ''} onClick={() => setCenter(i)} aria-label={`Album ${i + 1}`} />
        ))}
      </div>
    </div>
  );
}

/* --------- Hero: coverflow + panel thông tin album đang giữa --------- */
function Hero({ albums, onAccent }: { albums: any[]; onAccent: (a: string) => void }) {
  const { t } = useLang();
  const p = usePlayer();
  const [center, setCenter] = useState(0);
  const [paused, setPaused] = useState(false);
  const dir = useRef(1);

  // tự trôi qua lại (ping-pong) khi không rê chuột
  useEffect(() => {
    if (paused || albums.length <= 1) return;
    const id = window.setInterval(() => {
      setCenter(c => {
        let nx = c + dir.current;
        if (nx >= albums.length) { dir.current = -1; nx = c - 1; }
        else if (nx < 0) { dir.current = 1; nx = c + 1; }
        return nx;
      });
    }, 3800);
    return () => window.clearInterval(id);
  }, [paused, albums.length]);

  const cur = albums[center] || albums[0];
  const accent = cur?.accent || 'var(--accent)';

  // báo màu accent album đang giữa lên trang → aurora đổi màu theo
  useEffect(() => { onAccent(accent); }, [accent, onAccent]);

  const playAlbum = async (id: string) => {
    try {
      const alb = await api.get<any>(`/v1/albums/${id}`);
      if (alb?.tracks?.length) p.play(alb.tracks, 0);
    } catch { /* im lặng */ }
  };

  return (
    <section
      className="hero3d"
      style={vars({ '--home-accent': accent })}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
    >
      <div className="hero3d-info">
        <span className="hero3d-tag">{t('newReleases')}</span>
        <h1 className="hero3d-title" key={cur?.id}>{cur?.title}</h1>
        <div className="hero3d-sub">
          {(cur?.artists || []).map((ar: any, i: number) => (
            <span key={ar.id}>
              {i > 0 && ', '}
              <Link to={`/artist/${ar.id}`}>{ar.name}</Link>
            </span>
          ))}
          {cur?.release_type && <><span className="dot">·</span>{cur.release_type}</>}
          {cur?.track_count ? <><span className="dot">·</span>{cur.track_count} bài</> : null}
        </div>
        <div className="hero3d-actions">
          <button className="play-big" onClick={() => cur && playAlbum(cur.id)} title={t('play')} aria-label={t('play')}>▶</button>
          {cur && <Link className="hero-ghost" to={`/album/${cur.id}`}>{t('toAlbum')} →</Link>}
        </div>
      </div>
      <Coverflow items={albums} center={center} setCenter={setCenter} />
    </section>
  );
}

/* --------- Đầu mục section --------- */
function SecHead({ title, moreTo, moreLabel }: { title: string; moreTo?: string; moreLabel?: string }) {
  return (
    <div className="sec-head">
      <h2>{title}</h2>
      {moreTo && <Link className="sec-more" to={moreTo}>{moreLabel || 'Xem tất cả'} →</Link>}
    </div>
  );
}

export default function Home() {
  const { t } = useLang();
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [accent, setAccent] = useState('var(--accent)');

  useEffect(() => {
    api.get('/v1/home').then(setData).catch(e => setErr(e.message));
  }, []);

  if (err) return <div className="empty">Không tải được trang chủ: {err}</div>;
  if (!data) return <div className="empty">{t('loading')}</div>;

  const releases: any[] = (data.new_releases || []);
  const featured = releases.slice(0, 7);
  const marquee = releases.length ? [...releases, ...releases] : [];
  let sec = 0; // đếm để stagger

  return (
    <div className="page home3d" style={vars({ '--home-accent': accent })}>
      <div className="home-aurora" aria-hidden="true"><i /><i /><i /></div>

      <div className="home-inner">
        {featured.length > 0 && (
          <div className="home-reveal" style={vars({ '--i': sec++ })}>
            <Hero albums={featured} onAccent={setAccent} />
          </div>
        )}

        {marquee.length > 0 && (
          <div className="cover-marquee home-reveal" style={vars({ '--i': sec++ })} aria-hidden="true">
            <div className="mq-track">
              {marquee.map((a, i) => (
                <Link key={a.id + '-' + i} to={`/album/${a.id}`} tabIndex={-1}>
                  <img src={assetUrl(a.cover_url)} alt="" loading="lazy" />
                </Link>
              ))}
            </div>
          </div>
        )}

        <h1 className="page-title home-reveal" style={vars({ '--i': sec++ })}>{t('explore')}</h1>

        {releases.length > 0 && (
          <section className="home-section home-reveal" style={vars({ '--i': sec++ })}>
            <SecHead title={t('newReleases')} moreTo="/tracks" />
            <div className="grid-cards">
              {releases.map(a => <Tilt key={a.id}><AlbumCard album={a} /></Tilt>)}
            </div>
          </section>
        )}

        {data.top_tracks?.length > 0 && (
          <section className="home-section home-reveal" style={vars({ '--i': sec++ })}>
            <SecHead title={t('trending')} moreTo="/charts" moreLabel={t('charts')} />
            <TrackList tracks={data.top_tracks.slice(0, 6)} />
          </section>
        )}

        {data.editorial_playlists?.length > 0 && (
          <section className="home-section home-reveal" style={vars({ '--i': sec++ })}>
            <SecHead title={t('editorial')} />
            <div className="grid-cards">
              {data.editorial_playlists.map((pl: any) => (
                <Tilt key={pl.id}>
                  <Link to={`/playlist/${pl.id}`} className="pl-card">
                    <div className="pl-cover" style={vars({ background: pl.accent || 'var(--bg-elev2)' })}>
                      {pl.cover_url && <img src={assetUrl(pl.cover_url)} alt="" loading="lazy" />}
                    </div>
                    <div className="ac-title">{pl.title || pl.name}</div>
                    {pl.owner_name && <div className="ac-sub">{pl.owner_name}</div>}
                  </Link>
                </Tilt>
              ))}
            </div>
          </section>
        )}

        {data.popular_artists?.length > 0 && (
          <section className="home-section home-reveal" style={vars({ '--i': sec++ })}>
            <SecHead title={t('popularArtists')} />
            <div className="grid-cards artists">
              {data.popular_artists.map((a: any) => <Tilt key={a.id}><ArtistCard artist={a} /></Tilt>)}
            </div>
          </section>
        )}

        {data.genres?.length > 0 && (
          <section className="home-section home-reveal" style={vars({ '--i': sec++ })}>
            <SecHead title={t('genres')} moreTo="/genres" />
            <div className="genre-row">
              {data.genres.map((g: any, i: number) => {
                const hue = (i * 47) % 360;
                const bg = `linear-gradient(135deg, hsl(${hue} 68% 52%), hsl(${(hue + 42) % 360} 72% 42%))`;
                return (
                  <Link key={g.name} to={`/genre/${encodeURIComponent(g.name)}`} className="genre-chip" style={vars({ background: bg })}>
                    <b>{g.name}</b>
                    {g.track_count ? <span>{g.track_count} bài</span> : null}
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {data.recently_played?.length > 0 && (
          <section className="home-section home-reveal" style={vars({ '--i': sec++ })}>
            <SecHead title={t('recentlyPlayed')} />
            <TrackList tracks={data.recently_played.slice(0, 6)} />
          </section>
        )}
      </div>
    </div>
  );
}
