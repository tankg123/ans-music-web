import { useEffect, useState } from 'react';
import { api } from '../api';
import { useLang } from '../i18n';
import { AlbumCard } from '../components/cards';

/** Trang liệt kê toàn bộ album (bấm 1 album → mở trang album đó). */
export default function Albums() {
  const { t } = useLang();
  const [albums, setAlbums] = useState<any[] | null>(null);

  useEffect(() => {
    api.get('/v1/albums?limit=120')
      .then(d => setAlbums(d.items || d.albums || []))
      .catch(() => setAlbums([]));
  }, []);

  return (
    <div className="page">
      <h1 className="page-title">{t('albums')}</h1>
      {albums === null ? (
        <div className="empty">{t('loading')}</div>
      ) : albums.length ? (
        <div className="grid-cards">
          {albums.map(a => <AlbumCard key={a.id} album={a} />)}
        </div>
      ) : (
        <div className="pe-empty"><div className="pe-empty-ic">💿</div><h3>{t('notFound')}</h3></div>
      )}
    </div>
  );
}
