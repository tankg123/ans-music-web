/** Widget tiến độ upload (góc dưới phải) — port uploadTray của admin.js.
 *  Store dạng event (giống toast trong ui.tsx): gọi uploadTray.add/progress/done
 *  ở bất kỳ đâu, component <UploadTray/> tự re-render. Mỗi file 1 dòng % + bar,
 *  thêm % tổng ở đầu. File xong tự ẩn sau ~2s; lỗi giữ lại + đỏ. */
import { useEffect, useState } from 'react';

type UState = 'up' | 'ok' | 'err';
interface URow { uid: string; name: string; percent: number; state: UState; msg: string }

let _seq = 0;
let _rows: URow[] = [];
const _subs = new Set<(rows: URow[]) => void>();
function _emit() { _subs.forEach(fn => fn([..._rows])); }

export const uploadTray = {
  add(name: string): string {
    const uid = 'u' + (++_seq);
    _rows.push({ uid, name, percent: 0, state: 'up', msg: '' });
    _emit();
    return uid;
  },
  progress(uid: string, percent: number): void {
    const r = _rows.find(x => x.uid === uid);
    if (!r || r.state !== 'up') return;
    r.percent = Math.max(0, Math.min(100, Math.round(percent)));
    _emit();
  },
  done(uid: string, ok: boolean, msg = ''): void {
    const r = _rows.find(x => x.uid === uid);
    if (!r) return;
    r.state = ok ? 'ok' : 'err';
    if (ok) r.percent = 100;
    r.msg = ok ? '' : (msg || 'Lỗi');
    _emit();
    if (ok) setTimeout(() => { _rows = _rows.filter(x => x.uid !== uid); _emit(); }, 2000);
  },
  clear(): void { _rows = []; _emit(); },
};

const COLORS: Record<UState, string> = { up: 'var(--accent)', ok: 'var(--ok)', err: 'var(--danger)' };

export function UploadTray() {
  const [items, setItems] = useState<URow[]>([]);
  useEffect(() => { _subs.add(setItems); return () => { _subs.delete(setItems); }; }, []);
  if (items.length === 0) return null;

  let sum = 0;
  for (const r of items) sum += r.state === 'ok' ? 100 : r.percent;
  const total = Math.round(sum / items.length);
  const active = items.filter(r => r.state === 'up').length;

  return (
    <div style={{
      position: 'fixed', right: 24, bottom: 24, width: 330, zIndex: 300,
      background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 12,
      boxShadow: '0 12px 34px rgba(0,0,0,.45)', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>
          {active > 0 ? `Đang tải ${active} file…` : 'Tải lên'}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 800, color: 'var(--accent)' }}>{total}%</span>
        <button onClick={() => uploadTray.clear()} title="Đóng"
          style={{ border: 'none', background: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 15 }}>✕</button>
      </div>
      <div style={{ height: 3, background: 'var(--bg-elev2)' }}>
        <div style={{ height: '100%', width: `${total}%`, background: 'var(--accent)', transition: 'width .2s' }} />
      </div>
      <div style={{ maxHeight: 240, overflowY: 'auto', padding: '8px 12px' }}>
        {items.map(r => (
          <div key={r.uid} style={{ marginBottom: 9 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
              <span title={r.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
              <span style={{ marginLeft: 'auto', fontWeight: 700, color: COLORS[r.state] }}>
                {r.state === 'err' ? '✕' : r.state === 'ok' ? '✓' : r.percent + '%'}
              </span>
            </div>
            <div style={{ height: 4, background: 'var(--bg-elev2)', borderRadius: 99, marginTop: 4 }}>
              <div style={{
                height: '100%', width: `${r.state === 'ok' ? 100 : r.percent}%`,
                background: COLORS[r.state], borderRadius: 99, transition: 'width .2s',
              }} />
            </div>
            {r.msg && <div style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 3 }}>{r.msg}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
