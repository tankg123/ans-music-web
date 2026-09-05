import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, assetUrl } from '../api';
import { useAuth } from '../useAuth';
import { useLang } from '../i18n';
import { TrackList, ArtistCard } from '../components/cards';
import { usePlayer, type Track } from '../player';
import './pages-extra.css';

interface Playlist {
  id: string; title: string; cover_url: string | null; accent: string | null;
  track_count: number; visibility: string | null;
}

function PlaylistCard({ pl }: { pl: Playlist }) {
  return (
    <Link to={`/playlist/${pl.id}`} className="pe-pl-card album-card">
      <div className="pe-pl-cover" style={{ background: `linear-gradient(135deg, ${pl.accent || 'var(--accent)'}, var(--accent2))` }}>
        {pl.cover_url ? <img src={assetUrl(pl.cover_url)} alt="" loading="lazy" /> : '🎧'}
      </div>
      <div className="ac-title">{pl.title}</div>
      <div className="ac-sub">{pl.track_count} bài</div>
    </Link>
  );
}

/* Danh sách phát "Yêu thích" (Liked Songs) — luôn hiện, bấm ▶ phát toàn bộ. */
function LikedCard({ count, onOpen, onPlay }: { count: number; onOpen: () => void; onPlay: () => void }) {
  const { t } = useLang();
  return (
    <div className="pe-pl-card album-card pe-liked-card" role="button" onClick={onOpen}>
      <div className="pe-pl-cover pe-liked-cover">
        <span className="pe-liked-heart">♥</span>
        {count > 0 && (
          <button className="pe-liked-play" title={t('play')}
            onClick={e => { e.stopPropagation(); onPlay(); }}>▶</button>
        )}
      </div>
      <div className="ac-title">{t('favPlaylist')}</div>
      <div className="ac-sub">{count} bài</div>
    </div>
  );
}

type TabKey = 'playlists' | 'liked' | 'artists' | 'history';

const TAB_KEYS: TabKey[] = ['playlists', 'liked', 'artists', 'history'];

export default function Library() {
  const { loggedIn } = useAuth();
  const { t } = useLang();
  const p = usePlayer();
  const [sp] = useSearchParams();
  const initTab = (sp.get('tab') as TabKey);
  const [tab, setTab] = useState<TabKey>(TAB_KEYS.includes(initTab) ? initTab : 'playlists');

  // mở từ sidebar (?tab=liked) khi đang ở sẵn trang Thư viện
  useEffect(() => {
    const q = sp.get('tab') as TabKey;
    if (q && TAB_KEYS.includes(q)) setTab(q);
  }, [sp]);

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [favorites, setFavorites] = useState<Track[]>([]);
  const [follows, setFollows] = useState<any[]>([]);
  const [history, setHistory] = useState<Track[]>([]);

  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [createErr, setCreateErr] = useState('');

  useEffect(() => {
    if (!loggedIn) return;
    api.get('/v1/me/playlists').then(d => setPlaylists(d.items || [])).catch(() => {});
    api.get('/v1/me/favorites?type=track').then(d => setFavorites(d.items || [])).catch(() => {});
    api.get('/v1/me/follows').then(d => setFollows(d.items || [])).catch(() => {});
    api.get('/v1/me/history').then(d => setHistory(d.items || [])).catch(() => {});
  }, [loggedIn]);

  if (!loggedIn) {
    return (
      <div className="page">
        <h1 className="page-title">{t('library')}</h1>
        <div className="pe-empty">
          <div className="pe-empty-ic">📚</div>
          <h3>{t('library')}</h3>
          <p>Đăng nhập để lưu bài hát yêu thích, album, nghệ sĩ và playlist của riêng bạn.</p>
          <Link className="btn btn-primary" to="/login">{t('login')}</Link>
        </div>
      </div>
    );
  }

  const createPlaylist = async () => {
    const v = title.trim();
    if (!v) { setCreateErr('Nhập tên playlist'); return; }
    try {
      const pl = await api.post<Playlist>('/v1/me/playlists', { title: v, visibility });
      setPlaylists([pl, ...playlists]);
      setTitle(''); setVisibility('private'); setCreating(false); setCreateErr('');
    } catch (e: any) { setCreateErr(e.message); }
  };

  const tabs: { key: TabKey; label: string; n: number }[] = [
    { key: 'playlists', label: t('myPlaylists'), n: playlists.length },
    { key: 'liked', label: t('likedTracks'), n: favorites.length },
    { key: 'artists', label: t('followedArtists'), n: follows.length },
    { key: 'history', label: t('history'), n: history.length },
  ];

  return (
    <div className="page">
      <h1 className="page-title">{t('library')}</h1>

      <div className="pe-tabs">
        {tabs.map(x => (
          <button key={x.key} className={'pe-tab' + (tab === x.key ? ' on' : '')} onClick={() => setTab(x.key)}>
            {x.label}{x.n > 0 && <span className="pe-tab-n">{x.n}</span>}
          </button>
        ))}
      </div>

      {tab === 'playlists' && (
        <section>
          <div className="page-head" style={{ marginBottom: 16 }}>
            <div />
            <button className="btn btn-primary btn-sm" onClick={() => setCreating(v => !v)}>＋ Tạo playlist</button>
          </div>
          {creating && (
            <div className="pe-create">
              <input className="pe-input" placeholder="Tên playlist" value={title}
                onChange={e => setTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createPlaylist(); }} autoFocus />
              <select className="pe-select" value={visibility} onChange={e => setVisibility(e.target.value)}>
                <option value="private">Riêng tư</option>
                <option value="public">Công khai</option>
                <option value="unlisted">Ẩn (ai có link)</option>
              </select>
              <button className="btn btn-primary btn-sm" onClick={createPlaylist}>Tạo</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setCreating(false); setCreateErr(''); }}>Hủy</button>
              {createErr && <span className="pe-note err">{createErr}</span>}
            </div>
          )}
          <div className="grid-cards">
            <LikedCard count={favorites.length}
              onOpen={() => setTab('liked')}
              onPlay={() => { if (favorites.length) p.play(favorites); }} />
            {playlists.map(pl => <PlaylistCard key={pl.id} pl={pl} />)}
          </div>
        </section>
      )}

      {tab === 'liked' && (
        <section>
          {favorites.length ? <TrackList tracks={favorites} />
            : <div className="pe-empty"><div className="pe-empty-ic">♥</div><h3>Chưa thích bài nào</h3>
              <p>Bấm ♥ ở bất kỳ bài hát nào để lưu vào đây.</p></div>}
        </section>
      )}

      {tab === 'artists' && (
        <section>
          {follows.length ? (
            <div className="grid-cards artists">{follows.map(x => <ArtistCard key={x.id} artist={x} />)}</div>
          ) : (
            <div className="pe-empty"><div className="pe-empty-ic">🎤</div><h3>Chưa theo dõi nghệ sĩ nào</h3>
              <p>Theo dõi nghệ sĩ để không bỏ lỡ phát hành mới.</p></div>
          )}
        </section>
      )}

      {tab === 'history' && (
        <section>
          {history.length ? <TrackList tracks={history} />
            : <div className="pe-empty"><div className="pe-empty-ic">🕑</div><h3>Chưa có lịch sử nghe</h3>
              <p>Những bài bạn nghe sẽ xuất hiện ở đây.</p></div>}
        </section>
      )}
    </div>
  );
}
