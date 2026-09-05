/** DDEX Ingestion — import thủ công gói ERN XML + lịch sử delivery. */
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { toast, Modal, Badge } from '../ui';

interface Delivery {
  id: string;
  partner_name?: string | null;
  message_id?: string | null;
  message_type?: string | null;
  ern_version?: string | null;
  received_at?: string | null;
  processed_at?: string | null;
  status: string;
  log?: string | null;
}
interface ImportReport { delivery_id: string; status: string; log: string[]; }

const typeLabel = (t?: string | null) => (t || '—').replace('Message', '');

export default function Ddex() {
  const [items, setItems] = useState<Delivery[]>([]);
  const [loadingTable, setLoadingTable] = useState(true);
  const [autoPublish, setAutoPublish] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [logView, setLogView] = useState<Delivery | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadTable() {
    try {
      const data = await api.get('/admin/v1/deliveries');
      setItems(data.items || []);
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setLoadingTable(false);
    }
  }
  useEffect(() => { loadTable(); }, []);

  async function doImport(file: File) {
    setReport(null);
    setReportError(null);
    setImporting(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const rep = await api.upload<ImportReport>(
        `/admin/v1/ddex/import?auto_publish=${autoPublish}`, fd);
      setReport(rep);
      if (rep.status === 'imported') toast('Import thành công');
      loadTable();
    } catch (e: any) {
      setReportError(e.message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function openLog(d: Delivery) {
    try {
      const full = await api.get(`/admin/v1/deliveries/${d.id}`);
      setLogView(full);
    } catch (e: any) {
      toast(e.message, true);
    }
  }

  return (
    <div>
      <div className="sec-head"><h1>📦 DDEX Ingestion</h1></div>
      <div className="two-col">
        <div className="panel">
          <h3>Import gói DDEX ERN (NewReleaseMessage / PurgeReleaseMessage)</h3>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
            Nhận file <b>ERN 3.8.2 / 4.3 XML</b> từ distributor — giống pipeline YouTube.
            Trong production, kênh nhận là SFTP/S3 per-partner; ở đây upload trực tiếp để
            demo/kiểm thử. File mẫu có sẵn tại <span className="mono">samples/ddex/</span> trong
            thư mục dự án.
          </p>
          <div
            className={'dropzone' + (dragOver ? ' over' : '')}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files[0];
              if (f) doImport(f);
            }}
          >
            Kéo thả file <b>.xml</b> vào đây hoặc <b>chọn file</b>
          </div>
          <input
            ref={fileRef} type="file" accept=".xml" hidden
            onChange={e => { const f = e.target.files?.[0]; if (f) doImport(f); }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 13, color: 'var(--muted)' }}>
            <input
              type="checkbox" style={{ width: 'auto' }}
              checked={autoPublish} onChange={e => setAutoPublish(e.target.checked)}
            /> Auto-publish (bỏ qua Review Queue)
          </label>
          <div style={{ marginTop: 16 }}>
            {importing && <p className="empty-note">Đang xử lý delivery…</p>}
            {reportError && (
              <div className="keybox" style={{ color: 'var(--danger)' }}>{reportError}</div>
            )}
            {report && (
              <>
                <div style={{ marginBottom: 8 }}>
                  <Badge status={report.status === 'duplicate' ? 'received' : report.status} />
                  {report.status === 'duplicate' && ' (đã xử lý trước đó — idempotent)'}
                </div>
                <div className="keybox">
                  {report.log.map((l, i) => (
                    <div key={i} style={l.startsWith('LỖI') ? { color: 'var(--danger)' } : undefined}>{l}</div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="panel">
          <h3>Lịch sử delivery</h3>
          {loadingTable ? (
            <p className="empty-note">Đang tải…</p>
          ) : items.length ? (
            <div className="tbl-wrap" style={{ border: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>Đối tác / MessageId</th><th>Loại</th><th>Nhận lúc</th>
                    <th>Trạng thái</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(d => (
                    <tr key={d.id}>
                      <td>
                        {d.partner_name || '—'}
                        <div className="sub mono">{d.message_id || ''}</div>
                      </td>
                      <td>
                        {typeLabel(d.message_type)}
                        <div className="sub">ERN {d.ern_version || '?'}</div>
                      </td>
                      <td className="sub">{d.received_at || ''}</td>
                      <td><Badge status={d.status} /></td>
                      <td className="actions">
                        <button className="btn btn-ghost btn-sm" onClick={() => openLog(d)}>Log</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-note">Chưa nhận delivery nào</p>
          )}
        </div>
      </div>

      {logView && (
        <Modal title="Delivery log" onClose={() => setLogView(null)}>
          <p className="mono" style={{ marginBottom: 12 }}>
            {logView.id} · {logView.message_type || ''} · ERN {logView.ern_version || '?'}
          </p>
          <div className="keybox">{logView.log || '(trống)'}</div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setLogView(null)}>Đóng</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
