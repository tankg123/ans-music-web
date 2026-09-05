/** Distribution SFTP (DDEX delivery kiểu YouTube) — port từ backend/app/distributions.py.
 *
 *  Mỗi distribution có 1 cặp SSH key. Server chỉ giữ PUBLIC key (authorized) để xác
 *  thực; PRIVATE key sinh ra chỉ trả về 1 LẦN cho admin đưa cho đối tác. Đối tác dùng
 *  private key push DDEX (XML + audio) lên SFTP dropbox của mình.
 *
 *  KỸ THUẬT: asyncssh (Python) được thay bằng ssh2.utils —
 *    - generateKeyPairSync('ed25519') → cặp key OpenSSH ('ssh-ed25519 AAAA…' + PEM).
 *    - parseKey(...) validate + trích public blob.
 *    - fingerprint SHA256 tự tính (SHA256:base64(sha256(publicSSHblob)) bỏ '=') —
 *      KHỚP định dạng OpenSSH 'SHA256:...' mà asyncssh.get_fingerprint() trả về. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import ssh2 from 'ssh2';
import type { ParsedKey } from 'ssh2';
import { SFTP_HOST_KEY } from './config.js';

// ssh2 là CommonJS: default import = toàn bộ module.exports (namespace import '* as'
// KHÔNG lộ .utils khi chạy trên Node ESM). Vì vậy dùng default import rồi destructure.
const { utils } = ssh2;

/** Fingerprint SHA256 chuẩn OpenSSH ('SHA256:...') từ 1 ParsedKey (public/private). */
function fingerprintFromParsed(key: ParsedKey): string {
  const blob = key.getPublicSSH(); // blob wire-format của phần public
  const b64 = crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');
  return `SHA256:${b64}`;
}

/** Sinh cặp SSH Ed25519. Trả public (OpenSSH 1 dòng), private (OpenSSH PEM),
 *  fingerprint SHA256 — server chỉ lưu public + fingerprint. */
export function generateKeypair(): { public_key: string; private_key: string; fingerprint: string } {
  const kp = utils.generateKeyPairSync('ed25519');
  const publicKey = kp.public.trim();
  return {
    public_key: publicKey,
    private_key: kp.private,
    fingerprint: fingerprintOf(publicKey),
  };
}

/** Fingerprint SHA256 chuẩn OpenSSH (SHA256:base64) từ public key. Lỗi → ''. */
export function fingerprintOf(publicOpenssh: string): string {
  try {
    const key = utils.parseKey(publicOpenssh);
    if (key instanceof Error) return '';
    return fingerprintFromParsed(key);
  } catch {
    return '';
  }
}

/** Chuẩn hóa + kiểm tra public key OpenSSH đối tác dán vào. Lỗi → ném Error. */
export function normalizePublicKey(raw: string): string {
  const s = (raw || '').trim();
  if (!s) throw new Error('Public key rỗng');
  const key = utils.parseKey(s);
  if (key instanceof Error) {
    throw new Error(
      "Public key không hợp lệ (cần định dạng OpenSSH: 'ssh-ed25519 AAAA…' hoặc 'ssh-rsa …')",
    );
  }
  // Dựng lại dạng OpenSSH 1 dòng chuẩn: '<type> <base64(blob)> [comment]'
  const line = `${key.type} ${key.getPublicSSH().toString('base64')}`;
  return key.comment ? `${line} ${key.comment}` : line;
}

/** Tên tài khoản SFTP an toàn từ tên distribution + hậu tố ngẫu nhiên. */
export function makeSftpUsername(name: string, suffix: string): string {
  const slug = (name || 'dist').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16) || 'dist';
  return `dist_${slug}_${suffix}`;
}

/** Host key CỐ ĐỊNH của SFTP server (sinh 1 lần, lưu data/sftp_host_key) →
 *  fingerprint không đổi để đối tác pin an toàn. File rỗng/hỏng → tự tái sinh.
 *  Trả về chuỗi private key OpenSSH (dùng trực tiếp cho ssh2 Server hostKeys). */
export function hostKey(): string {
  try {
    if (fs.existsSync(SFTP_HOST_KEY) && fs.statSync(SFTP_HOST_KEY).size > 0) {
      const data = fs.readFileSync(SFTP_HOST_KEY, 'utf8');
      const parsed = utils.parseKey(data);
      if (!(parsed instanceof Error) && parsed.isPrivateKey()) return data;
      // file cắt cụt/hỏng (đứt giữa lần ghi đầu, disk đầy…) → sinh lại
    }
  } catch {
    // đọc lỗi → sinh lại
  }
  const kp = utils.generateKeyPairSync('ed25519');
  try {
    fs.writeFileSync(SFTP_HOST_KEY, kp.private, { mode: 0o600 });
    try { fs.chmodSync(SFTP_HOST_KEY, 0o600); } catch { /* Windows: bỏ qua */ }
  } catch {
    // ghi lỗi: vẫn dùng key trong RAM cho phiên này
  }
  return kp.private;
}

/** Fingerprint SHA256 của host key (để đối tác pin). Lỗi → ''. */
export function hostKeyFingerprint(): string {
  try {
    const parsed = utils.parseKey(hostKey());
    if (parsed instanceof Error) return '';
    return fingerprintFromParsed(parsed);
  } catch {
    return '';
  }
}

// ---- Ánh xạ vai trò DDEX → vai trò contributor trên web (khớp ALL_ROLES) ----
// ALL_ROLES = MainArtist, Composer, Lyricist, MusicPublisher, Producer, Mixer,
//             FeaturedArtist, Remixer, Performer
export const DDEX_ROLE_MAP: Record<string, string> = {
  // DisplayArtist / performers
  mainartist: 'MainArtist', artist: 'MainArtist', primaryartist: 'MainArtist',
  featuredartist: 'FeaturedArtist', featuring: 'FeaturedArtist', featured: 'FeaturedArtist',
  performer: 'Performer', musician: 'Performer', orchestra: 'Performer',
  conductor: 'Performer', soloist: 'Performer',
  // Sáng tác (IndirectContributor)
  composer: 'Composer', writer: 'Composer', songwriter: 'Composer',
  composerlyricist: 'Composer',
  lyricist: 'Lyricist', author: 'Lyricist', wordwriter: 'Lyricist',
  musicpublisher: 'MusicPublisher', publisher: 'MusicPublisher',
  originalpublisher: 'MusicPublisher',
  // Sản xuất / kỹ thuật
  producer: 'Producer', executiveproducer: 'Producer', coproducer: 'Producer',
  arranger: 'Producer', recordingengineer: 'Producer',
  mixer: 'Mixer', mixingengineer: 'Mixer', masteringengineer: 'Mixer',
  remixer: 'Remixer', remixerartist: 'Remixer',
};

/** DDEX role (bất kỳ hoa/thường/khoảng trắng) → role web hợp lệ. */
export function mapDdexRole(ddexRole: string, def = 'Performer'): string {
  const key = (ddexRole || '').toLowerCase().replace(/[^a-z]/g, '');
  return DDEX_ROLE_MAP[key] ?? def;
}
