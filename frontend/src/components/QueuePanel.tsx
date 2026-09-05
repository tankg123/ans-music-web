/** Panel hàng đợi trượt từ phải — bài đang phát nổi bật, click để phát tại vị trí,
 *  xóa từng bài, xóa tất cả. Đóng bằng X hoặc bấm nền. */
import { usePlayer } from '../player';
import { assetUrl } from '../api';
import { useLang } from '../i18n';
import './queue.css';

const I = {
  close: <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z" /></svg>,
  trash: <svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M6 7h12l-1 13H7zm3-3h6l1 2h4v2H2V6h4z" /></svg>,
  eq: <span className="qp-eq"><i /><i /><i /></span>,
};

export default function QueuePanel() {
  const p = usePlayer();
  const { t, lang } = useLang();
  const open = p.showQueue;

  const L = (vi: string, en: string) => (lang === 'en' ? en : vi);

  return (
    <>
      <div className={'qp-backdrop' + (open ? ' open' : '')} onClick={() => p.setShowQueue(false)} />
      <aside className={'qp-panel' + (open ? ' open' : '')} aria-hidden={!open}>
        <header className="qp-head">
          <div className="qp-head-title">
            {t('queue')} <span className="qp-count">{p.queue.length}</span>
          </div>
          <div className="qp-head-actions">
            {p.queue.length > 0 && (
              <button className="qp-clear" onClick={p.clearQueue} title="Xóa tất cả">{L('Xóa tất cả', 'Clear')}</button>
            )}
            <button className="qp-close" onClick={() => p.setShowQueue(false)} title="Đóng" aria-label="Đóng">{I.close}</button>
          </div>
        </header>

        <div className="qp-list">
          {p.queue.length === 0 && (
            <div className="qp-empty">
              <div className="qp-empty-ic">♪</div>
              <div>{L('Hàng đợi trống', 'Queue is empty')}</div>
            </div>
          )}
          {p.queue.map((tr, i) => (
            <div key={`${tr.id}-${i}`}>
              {i === p.index && <div className="qp-group">{t('nowPlaying')}</div>}
              {i === p.index + 1 && <div className="qp-group">{L('Tiếp theo', 'Up next')}</div>}
              <div
                className={'qp-item' + (i === p.index ? ' current' : '')}
                onClick={() => { if (i !== p.index) p.play(p.queue, i); }}
              >
                <div className="qp-cover">
                  <img src={assetUrl(tr.cover_url) || '/favicon.svg'} alt="" loading="lazy" />
                  {i === p.index && p.playing && I.eq}
                </div>
                <div className="qp-text">
                  <div className="qp-title">{tr.title}</div>
                  <div className="qp-artist">{(tr.artists || []).map(a => a.name).join(', ')}</div>
                </div>
                {i !== p.index && (
                  <button className="qp-remove" title="Xóa khỏi hàng đợi"
                    onClick={(e) => { e.stopPropagation(); p.removeFromQueue(i); }}>
                    {I.trash}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
