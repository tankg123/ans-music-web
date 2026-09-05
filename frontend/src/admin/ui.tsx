/** UI dùng chung cho Admin: toast, Modal, badge, helpers. */
import { useEffect, useState, type ReactNode } from 'react';

// ---- Toast (event-based, gọi toast() ở bất kỳ đâu) ----
type ToastItem = { id: number; msg: string; err: boolean };
let _seq = 0;
const _subs = new Set<(t: ToastItem[]) => void>();
let _items: ToastItem[] = [];
function _emit() { _subs.forEach(fn => fn([..._items])); }
export function toast(msg: string, err = false) {
  const t = { id: ++_seq, msg, err };
  _items.push(t); _emit();
  setTimeout(() => { _items = _items.filter(x => x.id !== t.id); _emit(); }, 3000);
}
export function Toasts() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => { _subs.add(setItems); return () => { _subs.delete(setItems); }; }, []);
  return (
    <div id="toast-root">
      {items.map(t => <div key={t.id} className={'toast' + (t.err ? ' err' : '')}>{t.msg}</div>)}
    </div>
  );
}

// ---- Modal ----
export function Modal({ title, onClose, children, wide }: { title?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal' + (wide ? ' wide' : '')}>
        {title && <div className="modal-head"><h2>{title}</h2><button className="modal-x" onClick={onClose}>✕</button></div>}
        {children}
      </div>
    </div>
  );
}

// ---- Badge trạng thái ----
const BADGE_LABEL: Record<string, string> = {
  live: 'Đang phát hành', draft: 'Nháp', pending_review: 'Chờ duyệt', scheduled: 'Hẹn giờ',
  taken_down: 'Đã gỡ', received: 'Đã nhận', validated: 'Đã validate', imported: 'Đã import',
  failed: 'Lỗi', duplicate: 'Trùng',
};
export function Badge({ status }: { status: string }) {
  return <span className={'badge ' + status}>{BADGE_LABEL[status] || status}</span>;
}

// ---- helpers ----
export const fmtCount = (n: number) => (n || 0).toLocaleString('vi-VN');
export const fmtDur = (ms: number) => { const s = Math.floor((ms || 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const fmtDate = (d?: string) => (d ? String(d).slice(0, 10) : '—');
export function fmtBytes(b: number) { return b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB'; }

// ---- section header wrapper ----
export function SecHead({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="sec-head"><h1>{title}</h1><div className="tools">{children}</div></div>;
}
export function Empty({ children }: { children: ReactNode }) { return <p className="empty-note">{children}</p>; }
