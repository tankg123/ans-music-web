/** Section Bài hát (Admin) — port từ frontend/js/admin.js (sections.tracks).
 *  GET /admin/v1/tracks?q= → bảng; tạo/sửa (SoundRecording), upload audio, xóa, preview. */
import { useEffect, useRef, useState } from 'react';
import { api, assetUrl } from '../../api';
import { toast, Modal, Badge, SecHead, fmtCount, fmtDur } from '../ui';

const LOGO = '/favicon.svg';
let _preview: HTMLAudioElement | null = null;

export default function Tracks() {
  const [items, setItems] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const [uploadFor, setUploadFor] = useState<any | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  async function load(qq: string) {
    setItems(null);
    try { const d = await api.get(`/admin/v1/tracks?q=${encodeURIComponent(qq)}`); setItems(d.items); }
    catch (e: any) { toast(e.message, true); setItems([]); }
  }
  useEffect(() => {
    const t = setTimeout(() => load(q), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q]);

  async function togglePlay(t: any) {
    try {
      if (!_preview) _preview = new Audio();
      if (playingId === t.id && !_preview.paused) { _preview.pause(); setPlayingId(null); return; }
      const { url } = await api.get<{ url: string }>(`/v1/tracks/${t.id}/stream`);
      _preview.src = url; _preview.play(); setPlayingId(t.id);
      _preview.onended = () => setPlayingId(null);
    } catch (e: any) { toast(e.message, true); }
  }
  async function del(t: any) {
    if (!confirm(`Xóa vĩnh viễn “${t.title}”?`)) return;
    try { await api.del(`/admin/v1/tracks/${t.id}`); toast('Đã xóa bài hát'); load(q); }
    catch (e: any) { toast(e.message, true); }
  }

  return (
    <div className="a-section">
      <SecHead title="🎵 Bài hát">
        <input type="search" placeholder="Tìm theo tên / ISRC…" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn btn-primary" onClick={() => setEditing('new')}>＋ Thêm bài hát</button>
      </SecHead>

      {items === null ? <p className="empty-note">Đang tải…</p> : (
        <div className="tbl-wrap"><table>
          <thead><tr><th>Bài hát</th><th>ISRC</th><th>Thời lượng</th><th>Audio</th><th>Lượt nghe</th><th>Trạng thái</th><th></th></tr></thead>
          <tbody>
            {items.length === 0 ? <tr><td colSpan={7} className="empty-note">Không có bài hát nào</td></tr>
              : items.map(t => (
                <tr key={t.id}>
                  <td><div className="cell-main">
                    <img className="thumb" src={assetUrl(t.cover_url) || LOGO} alt="" />
                    <div>{t.title}<div className="sub">{(t.artists || []).map((a: any) => a.name).join(', ') || '—'}</div></div>
                  </div></td>
                  <td className="mono">{t.isrc || '—'}</td>
                  <td>{fmtDur(t.duration_ms)}</td>
                  <td>{t.has_audio ? '✅' : <span style={{ color: 'var(--warn)' }}>✗ chưa có</span>}</td>
                  <td>{fmtCount(t.play_count)}</td>
                  <td><Badge status={t.status} /></td>
                  <td className="actions">
                    {t.has_audio && <button className="btn btn-ghost btn-sm" onClick={() => togglePlay(t)}>{playingId === t.id ? '⏸' : '▶'}</button>}
                    <button className="btn btn-ghost btn-sm" onClick={() => setUploadFor(t)}>⬆ Audio</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(t)}>Sửa</button>
                    <button className="btn btn-danger btn-sm" onClick={() => del(t)}>Xóa</button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table></div>
      )}

      {editing && <TrackModal track={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(q); }} />}
      {uploadFor && <AudioUploadModal track={uploadFor} onClose={() => setUploadFor(null)} onDone={() => { setUploadFor(null); load(q); }} />}
    </div>
  );
}

// ===========================================================================
// Modal tạo/sửa bài hát
// ===========================================================================
function TrackModal({ track, onClose, onSaved }: { track: any | null; onClose: () => void; onSaved: () => void }) {
  const [artists, setArtists] = useState<any[]>([]);
  const [releases, setReleases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [f, setF] = useState<any>({
    title: '', isrc: '', genre: '', language: 'vi', parental_warning: 'NotExplicit',
    p_line: '', lyrics_lrc: '', artist_ids: [] as string[], release_id: '', status: 'draft',
  });
  const keepRef = useRef<{ lyrics: string | null; subtitle: string | null }>({ lyrics: null, subtitle: null });
  const upd = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));

  useEffect(() => {
    (async () => {
      try {
        const [a, r] = await Promise.all([api.get('/admin/v1/artists'), api.get('/admin/v1/releases')]);
        setArtists(a.items); setReleases(r.items);
        if (track) {
          const detail = await api.get(`/v1/tracks/${track.id}`).catch(() => null);
          const ly = await api.get(`/v1/tracks/${track.id}/lyrics`).catch(() => ({ lyrics: '', lrc: '' }));
          keepRef.current = { lyrics: ly.lyrics || null, subtitle: detail?.subtitle || null };
          setF({
            title: track.title || '', isrc: track.isrc || '', genre: track.genre || '',
            language: detail?.language || 'vi', parental_warning: detail?.parental_warning || 'NotExplicit',
            p_line: detail?.p_line || '', lyrics_lrc: ly.lrc || '',
            artist_ids: (detail?.artists || []).map((x: any) => x.id),
            release_id: detail?.release?.id || '', status: track.status || 'draft',
          });
        }
      } catch (e: any) { toast(e.message, true); }
      finally { setLoading(false); }
    })();
  }, [track]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body: any = {
      title: f.title, isrc: f.isrc, genre: f.genre || null, language: f.language,
      parental_warning: f.parental_warning, p_line: f.p_line || null,
      lyrics_lrc: f.lyrics_lrc || null, lyrics: keepRef.current.lyrics, subtitle: keepRef.current.subtitle,
      artist_ids: f.artist_ids, release_id: f.release_id || null, status: f.status || 'draft',
    };
    try {
      if (track) await api.patch(`/admin/v1/tracks/${track.id}`, body);
      else await api.post('/admin/v1/tracks', body);
      toast(track ? 'Đã lưu' : 'Đã tạo bài hát — upload audio để phát hành');
      onSaved();
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <Modal title={track ? 'Sửa bài hát' : 'Thêm bài hát (SoundRecording)'} onClose={onClose} wide>
      {loading ? <p className="empty-note">Đang tải…</p> : (
        <form onSubmit={submit}>
          <div className="field"><label>Tiêu đề *</label><input required value={f.title} onChange={e => upd('title', e.target.value)} /></div>
          <div className="grid2">
            <div className="field"><label>ISRC *</label>
              <input required placeholder="VNA0D2600001" style={{ textTransform: 'uppercase' }} value={f.isrc} onChange={e => upd('isrc', e.target.value)} />
              <div className="sub" style={{ marginTop: 4 }}>Định dạng CC-XXX-YY-NNNNN (12 ký tự)</div></div>
            <div className="field"><label>Thể loại</label><input value={f.genre} placeholder="V-Pop, Ballad…" onChange={e => upd('genre', e.target.value)} /></div>
          </div>
          <div className="grid2">
            <div className="field"><label>Ngôn ngữ</label>
              <select value={f.language} onChange={e => upd('language', e.target.value)}>
                <option value="vi">Tiếng Việt</option><option value="en">English</option>
                <option value="ko">한국어</option><option value="ja">日本語</option></select></div>
            <div className="field"><label>Cảnh báo nội dung</label>
              <select value={f.parental_warning} onChange={e => upd('parental_warning', e.target.value)}>
                <option value="NotExplicit">NotExplicit</option><option value="Explicit">Explicit</option>
                <option value="Edited">Edited (Clean)</option></select></div>
          </div>
          <div className="field"><label>℗ P-Line</label><input value={f.p_line} placeholder="℗ 2026 Label Name" onChange={e => upd('p_line', e.target.value)} /></div>
          <div className="grid2">
            <div className="field"><label>Nghệ sĩ (Ctrl+click chọn nhiều — người đầu = MainArtist)</label>
              <select multiple size={5} value={f.artist_ids}
                onChange={e => upd('artist_ids', [...e.target.selectedOptions].map(o => o.value))}>
                {artists.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select></div>
            <div className="field"><label>Thuộc Release</label>
              <select value={f.release_id} disabled={!!track} onChange={e => upd('release_id', e.target.value)}>
                <option value="">— Không gắn —</option>
                {releases.map(r => <option key={r.id} value={r.id}>{r.title} ({r.release_type})</option>)}
              </select>
              {track && <div className="sub" style={{ marginTop: 4 }}>Đổi tracklist trong trang Release</div>}</div>
          </div>
          <div className="field"><label>Lời bài hát (LRC đồng bộ hoặc plain text)</label>
            <textarea rows={3} placeholder="[00:12.00]Câu hát đầu tiên…" value={f.lyrics_lrc} onChange={e => upd('lyrics_lrc', e.target.value)} />
            <div className="sub" style={{ marginTop: 4 }}>Để trống nếu chưa có; định dạng [mm:ss.xx] cho karaoke</div></div>
          {track && (
            <div className="field"><label>Trạng thái</label>
              <select value={f.status} onChange={e => upd('status', e.target.value)}>
                <option value="draft">Nháp</option><option value="live">Phát hành</option><option value="taken_down">Gỡ xuống</option>
              </select></div>
          )}
          {err && <div className="form-error">{err}</div>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Hủy</button>
            <button type="submit" className="btn btn-primary">{track ? 'Lưu thay đổi' : 'Tạo bài hát'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ===========================================================================
// Modal upload audio (global endpoint /admin/v1/tracks/:id/audio)
// ===========================================================================
function AudioUploadModal({ track, onClose, onDone }: { track: any; onClose: () => void; onDone: () => void }) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  async function doUpload(file: File) {
    setErr(''); setBusy(`Đang upload ${file.name}…`);
    const fd = new FormData(); fd.append('file', file);
    try {
      const res = await api.upload(`/admin/v1/tracks/${track.id}/audio`, fd);
      toast(`Đã upload — thời lượng ${fmtDur(res.duration_ms)}`);
      if (res.duplicate_of) toast(`⚠ File trùng hash với “${res.duplicate_of.title}”`, true);
      onDone();
    } catch (e: any) { setErr(e.message); setBusy(''); }
  }

  return (
    <Modal title={`⬆ Upload audio — ${track.title}`} onClose={onClose}>
      <div className={'dropzone' + (over ? ' over' : '')}
        onClick={() => fileInput.current?.click()}
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); const file = e.dataTransfer.files[0]; if (file) doUpload(file); }}>
        {busy || <>Kéo thả file vào đây hoặc <b>chọn file</b><br />
          <span style={{ fontSize: 12 }}>WAV / FLAC / MP3 / M4A / OGG — khuyến nghị WAV/FLAC ≥16-bit 44.1kHz</span></>}
      </div>
      <input ref={fileInput} type="file" accept=".wav,.flac,.mp3,.m4a,.ogg,.opus" hidden
        onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) doUpload(file); }} />
      {err && <div className="form-error">{err}</div>}
      <div className="modal-actions"><button className="btn btn-ghost" onClick={onClose}>Đóng</button></div>
    </Modal>
  );
}
