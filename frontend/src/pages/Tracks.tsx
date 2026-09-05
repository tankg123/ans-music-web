import { useEffect, useState } from 'react';
import { api } from '../api';
import { TrackList } from '../components/cards';

export default function Tracks() {
  const [items, setItems] = useState<any[]>([]);
  const [sort, setSort] = useState('new');
  useEffect(() => { api.get(`/v1/tracks?sort=${sort}&limit=100`).then(d => setItems(d.items || [])).catch(() => {}); }, [sort]);
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Tất cả bài hát</h1>
        <select value={sort} onChange={e => setSort(e.target.value)}>
          <option value="new">Mới nhất</option>
          <option value="top">Nghe nhiều</option>
          <option value="az">A–Z</option>
        </select>
      </div>
      <TrackList tracks={items} />
    </div>
  );
}
