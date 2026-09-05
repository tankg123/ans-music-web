import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, assetUrl } from '../api';
import { usePlayer, type Track } from '../player';
import Waveform from '../components/Waveform';

const inp: React.CSSProperties = {
  padding: '9px 12px', background: 'var(--bg-elev2)',
  border: '1.5px solid var(--border)', borderRadius: 10, fontSize: 20,
  fontWeight: 800, outline: 'none', color: 'var(--text)', width: 340, maxWidth: '100%',
};

function fmtDur(ms: number) {
  const s = Math.floor((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function fmtTotal(ms: number) {
  const m = Math.round((ms || 0) / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} giờ ${m % 60} phút` : `${m} phút`;
}

export default function Playlist() {
  const { id } = useParams();
  const p = usePlayer();
  const [pl, setPl] = useState<any>(null);

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [nameErr, setNameErr] = useState('');

  useEffect(() => {
    setPl(null);
    api.get(`/v1/playlists/${id}`).then(d => { setPl(d); setTitle(d.title); }).catch(() => setPl(false));
  }, [id]);

  if (pl === false) return <div className="empty">Không tìm thấy playlist.</div>;
  if (!pl) return <div className="empty">Đang tải…</div>;

  const tracks: Track[] = pl.tracks || [];
  const isOwner = !!pl.is_owner;

  const saveTitle = async () => {
    const v = title.trim();
    if (!v) { setNameErr('Tên không được để trống'); return; }
    try {
      await api.patch(`/v1/me/playlists/${id}`, { title: v });
      setPl({ ...pl, title: v });
      setEditing(false); setNameErr('');
    } catch (e: any) { setNameErr(e.message); }
  };

  const removeTrack = async (trackId: string) => {
    try {
      await api.del(`/v1/me/playlists/${id}/tracks/${trackId}`);
      setPl({ ...pl, tracks: tracks.filter(t => t.id !== trackId) });
    } catch { /* giữ nguyên nếu lỗi */ }
  };

  const current = p.current && tracks.some(t => t.id === p.current!.id) ? p.current : null;
  const progress = current && p.duration ? p.position / p.duration : 0;

  return (
    <div className="page">
      <div className="album-hero">
        <div className="ah-cover" style={{ background: pl.accent || '#222' }}>
          {pl.cover_url && <img src={assetUrl(pl.cover_url)} alt="" />}
        </div>
        <div className="ah-info">
          <span className="ah-type">PLAYLIST</span>
          {editing ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0' }}>
              <input value={title} onChange={e => setTitle(e.target.value)} style={inp}
                onKeyDown={e => { if (e.key === 'Enter') saveTitle(); }} autoFocus />
              <button className="btn btn-primary" onClick={saveTitle}>Lưu</button>
              <button className="btn" style={{ background: 'var(--bg-elev2)' }}
                onClick={() => { setEditing(false); setTitle(pl.title); setNameErr(''); }}>Hủy</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <h1>{pl.title}</h1>
              {isOwner && (
                <button className="btn" style={{ background: 'var(--bg-elev2)', padding: '7px 14px' }}
                  onClick={() => setEditing(true)}>✎ Sửa tên</button>
              )}
            </div>
          )}
          {nameErr && <div className="form-err">{nameErr}</div>}
          <div className="ah-sub">
            {pl.owner_name ? <>Tạo bởi {pl.owner_name} · </> : null}
            {tracks.length} bài{pl.total_duration_ms ? ` · ${fmtTotal(pl.total_duration_ms)}` : ''}
          </div>
          {pl.description && <div style={{ color: 'var(--muted)', marginBottom: 12, maxWidth: 560 }}>{pl.description}</div>}
          <button className="btn btn-primary" onClick={() => tracks.length && p.play(tracks, 0)}>▶ Phát</button>
        </div>
      </div>

      {current && (
        <div style={{ marginBottom: 18 }}>
          <Waveform trackId={current.id} height={72} progress={progress} />
        </div>
      )}

      {tracks.length ? (
        <div className="track-list">
          {tracks.map((t, i) => {
            const isCur = p.current?.id === t.id;
            return (
              <div key={t.id} className={'track-row' + (isCur ? ' playing' : '')}
                onDoubleClick={() => p.play(tracks, i)}>
                <button className="tr-play" onClick={() => p.play(tracks, i)}>
                  {isCur && p.playing ? '⏸' : '▶'}
                </button>
                <img className="tr-cover" src={assetUrl(t.cover_url) || '/favicon.svg'} alt="" loading="lazy" />
                <div className="tr-main">
                  <div className="tr-title">{t.title}</div>
                  <div className="tr-artist">{(t.artists || []).map(a => a.name).join(', ')}</div>
                </div>
                <span className="tr-dur">{fmtDur(t.duration_ms || 0)}</span>
                {isOwner && (
                  <button title="Xóa khỏi playlist" onClick={() => removeTrack(t.id)}
                    style={{ border: 'none', background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16, padding: '4px 6px' }}>🗑</button>
                )}
              </div>
            );
          })}
        </div>
      ) : <div className="empty">Playlist chưa có bài hát nào.</div>}
    </div>
  );
}
