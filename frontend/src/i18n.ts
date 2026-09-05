/** Song ngữ VI/EN — nút chuyển ở góc, lưu localStorage. */
import { useEffect, useState } from 'react';

type Lang = 'vi' | 'en';
const KEY = 'ans_lang';
let lang: Lang = (localStorage.getItem(KEY) as Lang) || 'vi';
const subs = new Set<() => void>();

const DICT: Record<string, { vi: string; en: string }> = {
  home: { vi: 'Trang chủ', en: 'Home' },
  search: { vi: 'Tìm kiếm', en: 'Search' },
  allTracks: { vi: 'Tất cả bài hát', en: 'All tracks' },
  library: { vi: 'Thư viện', en: 'Library' },
  charts: { vi: 'Bảng xếp hạng', en: 'Charts' },
  genres: { vi: 'Thể loại', en: 'Genres' },
  albumsNew: { vi: 'Album mới', en: 'New albums' },
  explore: { vi: 'Khám phá', en: 'Explore' },
  newReleases: { vi: 'Mới phát hành', en: 'New releases' },
  trending: { vi: 'Thịnh hành', en: 'Trending' },
  popularArtists: { vi: 'Nghệ sĩ nổi bật', en: 'Popular artists' },
  recentlyPlayed: { vi: 'Nghe gần đây', en: 'Recently played' },
  editorial: { vi: 'Playlist tuyển chọn', en: 'Editorial playlists' },
  login: { vi: 'Đăng nhập', en: 'Sign in' },
  logout: { vi: 'Đăng xuất', en: 'Sign out' },
  admin: { vi: 'Quản trị', en: 'Admin' },
  play: { vi: 'Phát', en: 'Play' },
  shuffle: { vi: 'Trộn bài', en: 'Shuffle' },
  repeat: { vi: 'Lặp lại', en: 'Repeat' },
  queue: { vi: 'Hàng đợi', en: 'Queue' },
  addQueue: { vi: 'Thêm vào hàng đợi', en: 'Add to queue' },
  playNext: { vi: 'Phát tiếp theo', en: 'Play next' },
  details: { vi: 'Thông tin chi tiết', en: 'Track details' },
  download: { vi: 'Tải xuống', en: 'Download' },
  downloadAlbum: { vi: 'Tải album', en: 'Download album' },
  addPlaylist: { vi: 'Thêm vào playlist', en: 'Add to playlist' },
  toArtist: { vi: 'Đến nghệ sĩ', en: 'Go to artist' },
  toAlbum: { vi: 'Đến album', en: 'Go to album' },
  copyLink: { vi: 'Sao chép liên kết', en: 'Copy link' },
  like: { vi: 'Yêu thích', en: 'Like' },
  follow: { vi: 'Theo dõi', en: 'Follow' },
  following: { vi: 'Đang theo dõi', en: 'Following' },
  followers: { vi: 'người theo dõi', en: 'followers' },
  label: { vi: 'Hãng phát hành', en: 'Record Label' },
  releaseDate: { vi: 'Ngày phát hành', en: 'Release date' },
  genre: { vi: 'Thể loại', en: 'Genre' },
  duration: { vi: 'Thời lượng', en: 'Duration' },
  language: { vi: 'Ngôn ngữ', en: 'Language' },
  plays: { vi: 'Lượt nghe', en: 'Plays' },
  loading: { vi: 'Đang tải…', en: 'Loading…' },
  notFound: { vi: 'Không tìm thấy', en: 'Not found' },
  topTracks: { vi: 'Bài hát nổi bật', en: 'Top tracks' },
  discography: { vi: 'Album', en: 'Discography' },
  appearsOn: { vi: 'Xuất hiện trong', en: 'Appears on' },
  similarArtists: { vi: 'Nghệ sĩ tương tự', en: 'Similar artists' },
  myPlaylists: { vi: 'Playlist của tôi', en: 'My playlists' },
  likedTracks: { vi: 'Bài đã thích', en: 'Liked tracks' },
  followedArtists: { vi: 'Nghệ sĩ theo dõi', en: 'Followed artists' },
  history: { vi: 'Lịch sử nghe', en: 'Listen history' },
  week: { vi: 'Tuần', en: 'Week' },
  month: { vi: 'Tháng', en: 'Month' },
  allTime: { vi: 'Mọi thời đại', en: 'All time' },
  loginNeeded: { vi: 'Đăng nhập để dùng tính năng này', en: 'Sign in to use this feature' },
  nowPlaying: { vi: 'Đang phát', en: 'Now playing' },
  lyrics: { vi: 'Lời bài hát', en: 'Lyrics' },
  noLyrics: { vi: 'Chưa có lời', en: 'No lyrics available' },
  albums: { vi: 'Album', en: 'Albums' },
  favPlaylist: { vi: 'Bài hát yêu thích', en: 'Liked Songs' },
  songsUnit: { vi: 'bài', en: 'songs' },
  playlistName: { vi: 'Tên playlist mới', en: 'New playlist name' },
  createAdd: { vi: 'Tạo & thêm', en: 'Create & add' },
  createdAdded: { vi: 'Đã tạo playlist & thêm bài', en: 'Playlist created & track added' },
};

export function t(key: string): string {
  const e = DICT[key];
  return e ? e[lang] : key;
}
export function getLang(): Lang { return lang; }
export function setLang(l: Lang) { lang = l; localStorage.setItem(KEY, l); subs.forEach(fn => fn()); }
export function toggleLang() { setLang(lang === 'vi' ? 'en' : 'vi'); }

/** Hook để component re-render khi đổi ngôn ngữ. */
export function useLang() {
  const [, force] = useState(0);
  useEffect(() => { const fn = () => force(n => n + 1); subs.add(fn); return () => { subs.delete(fn); }; }, []);
  return { lang, t, toggleLang };
}
