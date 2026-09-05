/** Hàng chờ duyệt — release pending_review từ DDEX feed / product gửi duyệt.
 *  Duyệt (approve) đẩy lên catalog; Từ chối (reject) trả về draft kèm ghi chú. */
import { useEffect, useState } from 'react';
import { api, assetUrl } from '../../api';
import { SecHead, Empty, Modal, toast, fmtCount } from '../ui';

export default function Review() {
  const [items, setItems] = useState<any[] | null>(null);
  const [rejecting, setRejecting] = useState<any | null>(null);   // release đang từ chối
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    setItems(null);
    api.get('/admin/v1/review-queue')
      .then(d => setItems(d.items))
      .catch(e => { toast(e.message, true); setItems([]); });
  };
  useEffect(load, []);

  const approve = async (r: any) => {
    setBusy(r.id);
    try {
      await api.post(`/admin/v1/review-queue/${r.id}/approve`);
      toast('Đã duyệt — release lên catalog');
      load();
    } catch (e: any) { toast(e.message, true); }
    finally { setBusy(null); }
  };

  const doReject = async () => {
    if (!rejecting) return;
    setBusy(rejecting.id);
    try {
      await api.post(`/admin/v1/review-queue/${rejecting.id}/reject`, { note: note.trim() });
      toast('Đã từ chối');
      setRejecting(null); setNote('');
      load();
    } catch (e: any) { toast(e.message, true); }
    finally { setBusy(null); }
  };

  return (
    <div>
      <SecHead title="✅ Hàng chờ duyệt" />
      <p className="sub" style={{ margin: '-12px 0 18px' }}>
        Nội dung từ DDEX feed (đối tác chưa bật auto-publish) chờ Content Manager phê duyệt.
      </p>

      {items === null ? <Empty>Đang tải…</Empty>
        : items.length === 0 ? <Empty>🎉 Không có nội dung nào chờ duyệt</Empty>
        : (
          <div className="tbl-wrap">
            <table>
              <thead><tr>
                <th>Release</th><th>UPC</th><th>Loại</th><th>Số bài</th><th>Label</th><th></th>
              </tr></thead>
              <tbody>{items.map(r => (
                <tr key={r.id}>
                  <td>
                    <div className="cell-main">
                      {r.cover_url ? <img className="thumb" src={assetUrl(r.cover_url)} alt="" /> : <span className="thumb" />}
                      <div>{r.title}
                        <div className="sub">{(r.artists || []).map((a: any) => a.name).join(', ') || '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="mono">{r.upc || '—'}</td>
                  <td>{r.release_type || '—'}</td>
                  <td>{fmtCount(r.track_count)}</td>
                  <td>{r.label_name || '—'}</td>
                  <td className="actions">
                    <button className="btn btn-ok btn-sm" disabled={busy === r.id} onClick={() => approve(r)}>✓ Duyệt</button>
                    <button className="btn btn-danger btn-sm" disabled={busy === r.id}
                      onClick={() => { setRejecting(r); setNote(''); }}>✗ Từ chối</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}

      {rejecting && (
        <Modal title={`Từ chối "${rejecting.title}"`} onClose={() => setRejecting(null)}>
          <div className="field">
            <label>Ghi chú lý do (uploader sẽ thấy để sửa)</label>
            <textarea rows={3} autoFocus value={note} onChange={e => setNote(e.target.value)}
              placeholder="VD: Ảnh bìa mờ, thiếu ISRC…" />
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setRejecting(null)}>Hủy</button>
            <button className="btn btn-danger" disabled={busy === rejecting.id} onClick={doReject}>Từ chối release</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
