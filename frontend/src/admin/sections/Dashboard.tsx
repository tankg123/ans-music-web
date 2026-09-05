/** Tổng quan — số liệu nhanh + top bài hát tuần + delivery gần đây. */
import { useEffect, useState } from 'react';
import { api, assetUrl } from '../../api';
import { SecHead, Badge, Empty, fmtCount } from '../ui';

interface TopTrack {
  id: string; title: string; cover_url?: string | null;
  artists?: { name: string }[]; week_plays: number;
}
interface RecentDelivery {
  id: string; partner_name?: string | null; message_id?: string | null;
  message_type?: string | null; ern_version?: string | null; status: string;
}
interface Stats {
  tracks: number; tracks_live: number; releases: number; artists: number;
  users: number; plays_7d: number; pending_review: number; failed_deliveries: number;
  top_tracks_week: TopTrack[]; recent_deliveries: RecentDelivery[];
}

const FALLBACK_COVER = '/favicon.svg';

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    api.get<Stats>('/admin/v1/stats')
      .then(s => { if (alive) setStats(s); })
      .catch(e => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, []);

  if (err) return (<div className="a-section"><SecHead title="📊 Tổng quan" /><Empty>{err}</Empty></div>);
  if (!stats) return (<div className="a-section"><SecHead title="📊 Tổng quan" /><Empty>Đang tải…</Empty></div>);

  const top = stats.top_tracks_week || [];
  const deliveries = stats.recent_deliveries || [];

  return (
    <div className="a-section">
      <SecHead title="📊 Tổng quan" />
      <div className="stat-grid">
        <div className="stat-card"><div className="num">{fmtCount(stats.plays_7d)}</div><div className="lbl">Lượt nghe 7 ngày</div></div>
        <div className="stat-card"><div className="num">{fmtCount(stats.tracks_live)}/{fmtCount(stats.tracks)}</div><div className="lbl">Bài hát đang phát hành</div></div>
        <div className="stat-card"><div className="num">{fmtCount(stats.releases)}</div><div className="lbl">Release</div></div>
        <div className="stat-card"><div className="num">{fmtCount(stats.artists)}</div><div className="lbl">Nghệ sĩ</div></div>
        <div className="stat-card"><div className="num">{fmtCount(stats.users)}</div><div className="lbl">Người dùng</div></div>
        <div className={'stat-card' + (stats.pending_review ? ' warn' : '')}><div className="num">{fmtCount(stats.pending_review)}</div><div className="lbl">Chờ duyệt</div></div>
        <div className={'stat-card' + (stats.failed_deliveries ? ' danger' : '')}><div className="num">{fmtCount(stats.failed_deliveries)}</div><div className="lbl">Delivery lỗi</div></div>
      </div>

      <div className="two-col">
        <div className="panel">
          <h3>🔥 Top bài hát tuần</h3>
          <div className="tbl-wrap" style={{ border: 'none' }}>
            <table>
              <thead><tr><th>#</th><th>Bài hát</th><th style={{ textAlign: 'right' }}>Lượt nghe tuần</th></tr></thead>
              <tbody>
                {top.length ? top.map((t, i) => (
                  <tr key={t.id}>
                    <td>{i + 1}</td>
                    <td>
                      <div className="cell-main">
                        <img className="thumb" src={assetUrl(t.cover_url) || FALLBACK_COVER} alt="" />
                        <div>{t.title}<div className="sub">{(t.artists || []).map(a => a.name).join(', ') || '—'}</div></div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>{fmtCount(t.week_plays)}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={3} className="empty-note">Chưa có dữ liệu</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <h3>📦 Delivery gần đây</h3>
          <div className="tbl-wrap" style={{ border: 'none' }}>
            <table>
              <thead><tr><th>Đối tác</th><th>Loại</th><th>Trạng thái</th></tr></thead>
              <tbody>
                {deliveries.length ? deliveries.map(d => (
                  <tr key={d.id}>
                    <td>{d.partner_name || '—'}<div className="sub mono">{d.message_id || ''}</div></td>
                    <td>{d.message_type || '—'}<div className="sub">ERN {d.ern_version || '?'}</div></td>
                    <td><Badge status={d.status} /></td>
                  </tr>
                )) : (
                  <tr><td colSpan={3} className="empty-note">Chưa nhận delivery nào — thử import ở mục DDEX Ingestion</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
