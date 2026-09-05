/** SFTP DDEX ingestion — server nhúng + watcher (kiểu YouTube).
 *  Port từ backend/app/sftp_server.py + backend/app/sftp_watcher.py sang Node/ssh2.
 *
 *  Đối tác kết nối bằng SSH KEY (public đã add ở Admin), được chroot vào đúng dropbox
 *  của mình (media/sftp/{username}/incoming|processed|failed) rồi push XML + audio.
 *  Watcher quét dropbox mỗi SFTP_POLL_SEC giây: khi 1 delivery (1 file ERN XML + audio
 *  kèm) ỔN ĐỊNH (không đổi trong SFTP_STABLE_SEC giây) → parseErn + importDelivery →
 *  đính audio theo report.tracks (khớp ISRC ↔ file) → move sang processed/ hoặc failed/.
 *
 *  KỸ THUẬT ssh2 là CommonJS trên Node ESM: PHẢI default-import rồi destructure
 *  ('import ssh2 from "ssh2"; const { Server, utils } = ssh2;'). Namespace import '* as'
 *  KHÔNG lộ .utils/.Server lúc chạy. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ssh2 from 'ssh2';
import type {
  Connection, AuthContext, Session, SFTPWrapper, FileEntry, Attributes, ParsedKey,
} from 'ssh2';

import {
  SFTP_ENABLED, SFTP_PORT, SFTP_BIND, SFTP_ROOT, SFTP_POLL_SEC, SFTP_STABLE_SEC, AUDIO_DIR,
} from './config.js';
import { db, type Row } from './db.js';
import { hostKey } from './distributions.js';
import { importDelivery, parseErn, type ParsedErn, type DeliveryReport } from './ddex.js';
import { processAudio, audioDurationMs } from './transcode.js';
import { invalidateWaveform } from './waveform.js';
import { cleanIsrc } from './utils.js';

const { Server, utils } = ssh2;
const STATUS = utils.sftp.STATUS_CODE;

const AUDIO_EXTS = new Set(['.wav', '.flac', '.mp3', '.m4a', '.ogg', '.aiff', '.aif']);
// tên tài khoản SFTP an toàn (khớp makeSftpUsername: 'dist_<slug>_<suffix>')
const USERNAME_RE = /^[A-Za-z0-9_.-]+$/;

// ===========================================================================
//  PHẦN 1 — SFTP SERVER (ssh2)
// ===========================================================================

/** Trả ParsedKey đã authorize cho tài khoản SFTP (public key lưu ở Admin), hoặc null. */
function authorizedKeyFor(username: string): ParsedKey | null {
  try {
    const row = db.prepare(
      "SELECT ssh_public_key FROM delivery_partners "
      + "WHERE sftp_username = ? AND delivery_channel = 'sftp'",
    ).get(username) as Row | undefined;
    if (!row || !row.ssh_public_key) return null;
    const parsed = utils.parseKey(row.ssh_public_key);
    if (parsed instanceof Error) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** So sánh 2 buffer an toàn thời gian (chống timing) — khác độ dài coi như khác. */
function buffersEqual(a?: Buffer | null, b?: Buffer | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** fs.Stats → Attributes SFTP (atime/mtime ĐƠN VỊ GIÂY Unix, không phải ms). */
function statToAttrs(st: fs.Stats): Attributes {
  return {
    mode: st.mode,
    uid: st.uid,
    gid: st.gid,
    size: st.size,
    atime: Math.floor(st.atimeMs / 1000),
    mtime: Math.floor(st.mtimeMs / 1000),
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Chuỗi 'ls -l' cho READDIR longname (client dùng để hiển thị; attrs mới là dữ liệu thật). */
function longname(name: string, st: fs.Stats): string {
  const type = st.isDirectory() ? 'd' : st.isSymbolicLink() ? 'l' : '-';
  const rwx = (m: number) => (m & 4 ? 'r' : '-') + (m & 2 ? 'w' : '-') + (m & 1 ? 'x' : '-');
  const perm = type + rwx((st.mode >> 6) & 7) + rwx((st.mode >> 3) & 7) + rwx(st.mode & 7);
  const d = new Date(st.mtimeMs);
  const mon = MONTHS[d.getMonth()];
  const day = String(d.getDate()).padStart(2, ' ');
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${perm} 1 owner group ${String(st.size).padStart(9, ' ')} ${mon} ${day} ${hm} ${name}`;
}

interface FileHandle { type: 'file'; fd: number; }
interface DirHandle { type: 'dir'; real: string; read: boolean; }
type Handle = FileHandle | DirHandle;

/** Cài đặt bộ handler SFTP cho 1 phiên, chroot cứng vào rootReal (chống path traversal). */
function setupSftpSession(sftp: SFTPWrapper, rootReal: string): void {
  const handles = new Map<number, Handle>();
  let handleSeq = 0;

  const newHandle = (h: Handle): Buffer => {
    const id = handleSeq++;
    handles.set(id, h);
    const buf = Buffer.allocUnsafe(4);
    buf.writeUInt32BE(id >>> 0, 0);
    return buf;
  };
  const getHandle = (buf: Buffer): { id: number; h: Handle } | null => {
    if (!buf || buf.length < 4) return null;
    const id = buf.readUInt32BE(0);
    const h = handles.get(id);
    return h ? { id, h } : null;
  };

  /** Chuẩn hóa path ẢO của client về dạng '/...' neo tại gốc chroot (thu gọn '..'). */
  const virtualNormalize = (p: string): string => {
    const raw = (p && p.length ? p : '.').replace(/\\/g, '/');
    const anchored = raw.startsWith('/') ? raw : `/${raw}`;
    let norm = path.posix.normalize(anchored); // '/a/../../b' → '/b'; '/..' → '/'
    if (norm.length > 1 && norm.endsWith('/')) norm = norm.slice(0, -1);
    return norm;
  };

  /** path ảo → path THẬT trong chroot; null nếu (dù đã chuẩn hóa) vẫn thoát ra ngoài root
   *  hoặc đi qua symlink trỏ ra ngoài. */
  const toReal = (virt: string): string | null => {
    const rel = virt.replace(/^\/+/, '');
    let real = rel ? path.join(rootReal, rel) : rootReal;
    real = path.resolve(real);
    if (real !== rootReal && !real.startsWith(rootReal + path.sep)) return null;
    // Nếu đã tồn tại: resolve symlink rồi kiểm tra lại (chống symlink trỏ ra ngoài).
    try {
      const resolved = fs.realpathSync(real);
      if (resolved !== rootReal && !resolved.startsWith(rootReal + path.sep)) return null;
      return resolved;
    } catch {
      // chưa tồn tại (VD file sắp WRITE mới) → dùng path từ vựng đã trong root.
      return real;
    }
  };

  /** ENOENT → NO_SUCH_FILE, EACCES/EPERM → PERMISSION_DENIED, còn lại → FAILURE. */
  const errStatus = (e: any): number => {
    const code = e && e.code;
    if (code === 'ENOENT') return STATUS.NO_SUCH_FILE;
    if (code === 'EACCES' || code === 'EPERM') return STATUS.PERMISSION_DENIED;
    return STATUS.FAILURE;
  };

  // ---- REALPATH: '.' → path ảo canonical + attrs (client dùng làm base) -----
  sftp.on('REALPATH', (reqId, p) => {
    const virt = virtualNormalize(p);
    const real = toReal(virt);
    if (real === null) { sftp.status(reqId, STATUS.PERMISSION_DENIED); return; }
    let attrs: Attributes;
    try { attrs = statToAttrs(fs.lstatSync(real)); }
    catch { attrs = { mode: 0o040755, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 }; }
    sftp.name(reqId, [{ filename: virt, longname: virt, attrs }]);
  });

  // ---- STAT / LSTAT: attrs của 1 path -------------------------------------
  const statPath = (reqId: number, p: string) => {
    const real = toReal(virtualNormalize(p));
    if (real === null) { sftp.status(reqId, STATUS.PERMISSION_DENIED); return; }
    try { sftp.attrs(reqId, statToAttrs(fs.lstatSync(real))); }
    catch (e) { sftp.status(reqId, errStatus(e)); }
  };
  sftp.on('STAT', statPath);
  sftp.on('LSTAT', statPath);

  // ---- FSTAT: attrs theo handle file --------------------------------------
  sftp.on('FSTAT', (reqId, handleBuf) => {
    const ent = getHandle(handleBuf);
    if (!ent || ent.h.type !== 'file') { sftp.status(reqId, STATUS.FAILURE); return; }
    try { sftp.attrs(reqId, statToAttrs(fs.fstatSync(ent.h.fd))); }
    catch (e) { sftp.status(reqId, errStatus(e)); }
  });

  // ---- SETSTAT / FSETSTAT: bỏ qua (chỉ ACK OK) ----------------------------
  sftp.on('SETSTAT', (reqId) => { sftp.status(reqId, STATUS.OK); });
  sftp.on('FSETSTAT', (reqId) => { sftp.status(reqId, STATUS.OK); });

  // ---- OPEN: mở file (đọc/ghi) trong chroot -------------------------------
  sftp.on('OPEN', (reqId, filename, flags, attrs) => {
    const real = toReal(virtualNormalize(filename));
    if (real === null) { sftp.status(reqId, STATUS.PERMISSION_DENIED); return; }
    const flagStr = utils.sftp.flagsToString(flags) || 'r';
    const mode = attrs && typeof attrs.mode === 'number' ? (attrs.mode & 0o777) : 0o644;
    try {
      const fd = fs.openSync(real, flagStr as fs.OpenMode, mode);
      sftp.handle(reqId, newHandle({ type: 'file', fd }));
    } catch (e) {
      sftp.status(reqId, errStatus(e));
    }
  });

  // ---- READ: đọc len byte từ offset ---------------------------------------
  sftp.on('READ', (reqId, handleBuf, offset, len) => {
    const ent = getHandle(handleBuf);
    if (!ent || ent.h.type !== 'file') { sftp.status(reqId, STATUS.FAILURE); return; }
    const buf = Buffer.allocUnsafe(len);
    try {
      const bytes = fs.readSync(ent.h.fd, buf, 0, len, offset);
      if (bytes <= 0) { sftp.status(reqId, STATUS.EOF); return; }
      sftp.data(reqId, buf.subarray(0, bytes));
    } catch (e) {
      sftp.status(reqId, errStatus(e));
    }
  });

  // ---- WRITE: ghi data vào offset (upload của đối tác) --------------------
  sftp.on('WRITE', (reqId, handleBuf, offset, data) => {
    const ent = getHandle(handleBuf);
    if (!ent || ent.h.type !== 'file') { sftp.status(reqId, STATUS.FAILURE); return; }
    try {
      fs.writeSync(ent.h.fd, data, 0, data.length, offset);
      sftp.status(reqId, STATUS.OK);
    } catch (e) {
      sftp.status(reqId, errStatus(e));
    }
  });

  // ---- OPENDIR: mở thư mục để đọc -----------------------------------------
  sftp.on('OPENDIR', (reqId, p) => {
    const real = toReal(virtualNormalize(p));
    if (real === null) { sftp.status(reqId, STATUS.PERMISSION_DENIED); return; }
    try {
      if (!fs.statSync(real).isDirectory()) { sftp.status(reqId, STATUS.NO_SUCH_FILE); return; }
    } catch (e) { sftp.status(reqId, errStatus(e)); return; }
    sftp.handle(reqId, newHandle({ type: 'dir', real, read: false }));
  });

  // ---- READDIR: liệt kê 1 lần rồi EOF -------------------------------------
  sftp.on('READDIR', (reqId, handleBuf) => {
    const ent = getHandle(handleBuf);
    if (!ent || ent.h.type !== 'dir') { sftp.status(reqId, STATUS.FAILURE); return; }
    if (ent.h.read) { sftp.status(reqId, STATUS.EOF); return; }
    ent.h.read = true;
    const entries: FileEntry[] = [];
    try {
      for (const nm of fs.readdirSync(ent.h.real)) {
        try {
          const st = fs.lstatSync(path.join(ent.h.real, nm));
          entries.push({ filename: nm, longname: longname(nm, st), attrs: statToAttrs(st) });
        } catch { /* bỏ qua entry lỗi */ }
      }
    } catch (e) { sftp.status(reqId, errStatus(e)); return; }
    if (entries.length === 0) { sftp.status(reqId, STATUS.EOF); return; }
    sftp.name(reqId, entries);
  });

  // ---- MKDIR / RMDIR / REMOVE / RENAME ------------------------------------
  sftp.on('MKDIR', (reqId, p) => {
    const real = toReal(virtualNormalize(p));
    if (real === null) { sftp.status(reqId, STATUS.PERMISSION_DENIED); return; }
    try { fs.mkdirSync(real); sftp.status(reqId, STATUS.OK); }
    catch (e) { sftp.status(reqId, errStatus(e)); }
  });
  sftp.on('RMDIR', (reqId, p) => {
    const real = toReal(virtualNormalize(p));
    if (real === null) { sftp.status(reqId, STATUS.PERMISSION_DENIED); return; }
    try { fs.rmdirSync(real); sftp.status(reqId, STATUS.OK); }
    catch (e) { sftp.status(reqId, errStatus(e)); }
  });
  sftp.on('REMOVE', (reqId, p) => {
    const real = toReal(virtualNormalize(p));
    if (real === null) { sftp.status(reqId, STATUS.PERMISSION_DENIED); return; }
    try { fs.unlinkSync(real); sftp.status(reqId, STATUS.OK); }
    catch (e) { sftp.status(reqId, errStatus(e)); }
  });
  sftp.on('RENAME', (reqId, oldPath, newPath) => {
    const from = toReal(virtualNormalize(oldPath));
    const to = toReal(virtualNormalize(newPath));
    if (from === null || to === null) { sftp.status(reqId, STATUS.PERMISSION_DENIED); return; }
    try { fs.renameSync(from, to); sftp.status(reqId, STATUS.OK); }
    catch (e) { sftp.status(reqId, errStatus(e)); }
  });

  // ---- CLOSE: đóng file/dir handle ----------------------------------------
  sftp.on('CLOSE', (reqId, handleBuf) => {
    const ent = getHandle(handleBuf);
    if (!ent) { sftp.status(reqId, STATUS.FAILURE); return; }
    handles.delete(ent.id);
    if (ent.h.type === 'file') {
      try { fs.closeSync(ent.h.fd); } catch { /* ignore */ }
    }
    sftp.status(reqId, STATUS.OK);
  });

  // ---- Cấm symlink/readlink/extended (chống traversal + không cần thiết) --
  sftp.on('SYMLINK', (reqId) => { sftp.status(reqId, STATUS.PERMISSION_DENIED); });
  sftp.on('READLINK', (reqId) => { sftp.status(reqId, STATUS.OP_UNSUPPORTED); });
  sftp.on('EXTENDED', (reqId) => { sftp.status(reqId, STATUS.OP_UNSUPPORTED); });

  // dọn mọi fd còn mở khi phiên đóng
  sftp.on('end', () => {
    for (const h of handles.values()) {
      if (h.type === 'file') { try { fs.closeSync(h.fd); } catch { /* ignore */ } }
    }
    handles.clear();
  });
}

/** Tạo (nếu chưa có) 3 thư mục dropbox của 1 đối tác, trả về realpath gốc chroot. */
function ensureDropbox(username: string): string {
  const root = path.join(SFTP_ROOT, username);
  for (const sub of ['incoming', 'processed', 'failed']) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
  return fs.realpathSync(root);
}

let server: InstanceType<typeof Server> | null = null;

/** Khởi động SFTP server (không throw ra ngoài — lỗi cổng bận KHÔNG được làm sập web). */
function startServer(): void {
  let srv: InstanceType<typeof Server>;
  try {
    srv = new Server({ hostKeys: [hostKey()] }, (client: Connection) => {
      let authUser = '';

      client.on('authentication', (ctx: AuthContext) => {
        // Chỉ cho phép public key khớp đối tác; cấm password/keyboard/none.
        if (ctx.method !== 'publickey') { ctx.reject(['publickey']); return; }
        const allowed = authorizedKeyFor(ctx.username);
        if (!allowed) { ctx.reject(); return; }
        // đối chiếu blob public key (chống nhầm loại/khóa), rồi verify chữ ký
        if (!buffersEqual(ctx.key.data, allowed.getPublicSSH())) { ctx.reject(); return; }
        if (ctx.signature) {
          const ok = allowed.verify(ctx.blob as Buffer, ctx.signature, ctx.hashAlgo);
          if (ok !== true) { ctx.reject(); return; }
        }
        // (probe không kèm chữ ký: key đã khớp → accept để client ký tiếp)
        authUser = ctx.username;
        ctx.accept();
      });

      client.on('ready', () => {
        client.on('session', (accept) => {
          const session: Session = accept();
          // Chỉ mở SFTP subsystem — cấm shell/exec/pty/subsystem khác.
          session.on('sftp', (acceptSftp) => {
            if (!USERNAME_RE.test(authUser)) { client.end(); return; }
            let rootReal: string;
            try { rootReal = ensureDropbox(authUser); }
            catch (e) { console.error('[sftp] không tạo được dropbox:', e); client.end(); return; }
            const sftp = acceptSftp();
            setupSftpSession(sftp, rootReal);
          });
          session.on('shell', (_a, reject) => reject());
          session.on('exec', (_a, reject) => reject());
          session.on('pty', (_a, reject) => reject());
          session.on('subsystem', (_a, reject) => reject());
        });
      });

      client.on('error', () => { /* nuốt lỗi socket từng client — không sập server */ });
    });
  } catch (e) {
    console.error(`[sftp] KHÔNG khởi tạo được SFTP server: ${e} (web vẫn chạy).`);
    return;
  }

  srv.on('error', (e: any) => {
    console.error(
      `[sftp] KHÔNG mở được SFTP cổng ${SFTP_PORT}: ${e?.code || e} `
      + '(web vẫn chạy; đổi ANS_SFTP_PORT hoặc kiểm tra quyền/cổng bận). SFTP ingestion tạm tắt.',
    );
  });
  srv.listen(SFTP_PORT, SFTP_BIND, () => {
    console.log(`[sftp] SFTP DDEX server đang chạy tại cổng ${SFTP_PORT} (bind ${SFTP_BIND})`);
  });
  server = srv;
}

// ===========================================================================
//  PHẦN 2 — WATCHER (quét dropbox, nạp delivery)
// ===========================================================================

/** Đệ quy liệt kê mọi file THẬT dưới dir (bỏ symlink — chống thoát thư mục). */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

/** File coi là ổn định nếu sửa lần cuối cách đây >= SFTP_STABLE_SEC giây. */
function isStable(file: string, nowMs: number): boolean {
  try { return (nowMs - fs.statSync(file).mtimeMs) >= SFTP_STABLE_SEC * 1000; }
  catch { return false; }
}

/** Mọi file audio THẬT dưới deliveryDir (không theo symlink, phải nằm trong deliveryDir). */
function collectAudio(deliveryDir: string): string[] {
  let rootReal: string;
  try { rootReal = fs.realpathSync(deliveryDir); }
  catch { return []; }
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.isFile()) continue;
      if (!AUDIO_EXTS.has(path.extname(e.name).toLowerCase())) continue;
      try {
        const real = fs.realpathSync(full);
        if (real === rootReal || real.startsWith(rootReal + path.sep)) out.push(full);
      } catch { /* bỏ qua */ }
    }
  };
  walk(deliveryDir);
  return out;
}

/** Tìm file audio cho 1 recording: ưu tiên tên file trong XML, rồi ISRC trong tên file.
 *  CHỈ fallback 'file audio duy nhất' khi delivery có ĐÚNG 1 recording (tránh gán nhầm). */
function findAudio(deliveryDir: string, fileUri: string, isrc: string, single: boolean): string | null {
  const base = path.basename((fileUri || '').replace(/\\/g, '/')).toLowerCase();
  const candidates = collectAudio(deliveryDir);
  if (base) {
    for (const p of candidates) if (path.basename(p).toLowerCase() === base) return p;
  }
  if (isrc) {
    const iso = isrc.replace(/-/g, '').toUpperCase();
    for (const p of candidates) {
      if (path.basename(p).replace(/-/g, '').toUpperCase().includes(iso)) return p;
    }
  }
  if (single && candidates.length === 1) return candidates[0];
  return null;
}

/** Copy file theo khối 1MB, trả về sha256 hex (tương đương stream hash bên Python). */
function copyWithHash(src: string, dest: string): string {
  const sha = crypto.createHash('sha256');
  const fdIn = fs.openSync(src, 'r');
  const fdOut = fs.openSync(dest, 'w');
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    let pos = 0;
    for (;;) {
      const bytes = fs.readSync(fdIn, buf, 0, buf.length, pos);
      if (bytes <= 0) break;
      sha.update(buf.subarray(0, bytes));
      fs.writeSync(fdOut, buf, 0, bytes, null);
      pos += bytes;
    }
  } finally {
    try { fs.closeSync(fdIn); } catch { /* ignore */ }
    try { fs.closeSync(fdOut); } catch { /* ignore */ }
  }
  return sha.digest('hex');
}

/** Đính 1 file audio vào track (copy → transcode → cập nhật DB). Trả 1 nếu thành công. */
function attachOne(tid: string, src: string, rec: { duration_ms?: number }): number {
  const ext = path.extname(src).toLowerCase();
  const dest = path.join(AUDIO_DIR, `${tid}${ext}`);
  const hash = copyWithHash(src, dest);
  const dur = audioDurationMs(dest) || (rec.duration_ms || 0);

  let audioName = path.basename(dest);
  let masterName: string | null = null;
  const tr = processAudio(dest, tid);
  if (tr) {
    audioName = tr.audio_name;
    masterName = tr.master_name;
    // processAudio đã sinh {tid}.m4a/{tid}.wav — bản copy thô còn thừa thì xóa
    if (path.basename(dest) !== audioName) { try { fs.rmSync(dest, { force: true }); } catch { /* ignore */ } }
  }

  db.prepare(
    'UPDATE tracks SET audio_path=?, master_path=?, audio_hash=?, '
    + 'duration_ms=COALESCE(NULLIF(?,0), duration_ms) WHERE id=?',
  ).run(audioName, masterName, hash, dur, tid);
  // track có audio + nằm trong release đang live → cho track live luôn
  db.prepare(
    "UPDATE tracks SET status='live' WHERE id=? AND status IN ('draft','pending_review') "
    + 'AND EXISTS (SELECT 1 FROM release_tracks rt JOIN releases r ON r.id=rt.release_id '
    + "            WHERE rt.track_id=? AND r.status='live')",
  ).run(tid, tid);
  invalidateWaveform(tid);
  return 1;
}

/** Đính audio vào ĐÚNG track mà import vừa tạo/sửa cho delivery này (theo report.tracks) —
 *  KHÔNG dò lại theo ISRC toàn hệ thống (tránh chạm track của đối tác khác trùng ISRC). */
function attachAudio(parsed: ParsedErn, report: DeliveryReport, deliveryDir: string, log: string[]): void {
  const allowed = new Map<string, string>();
  for (const t of report.tracks) if (t.id) allowed.set(cleanIsrc(t.isrc || ''), t.id);
  const recs = parsed.recordings;
  const single = recs.length === 1;
  let attached = 0;
  for (const rec of recs) {
    try {
      const isrc = cleanIsrc(rec.isrc || '');
      const tid = allowed.get(isrc);
      if (!tid) continue; // track không do delivery này tạo/sửa → không đụng vào
      const src = findAudio(deliveryDir, rec.file_uri || '', isrc, single);
      if (!src) {
        log.push(`  ⚠ Track ISRC ${isrc}: không thấy file audio khớp — bỏ qua`);
        continue;
      }
      attached += attachOne(tid, src, rec);
    } catch (e) {
      log.push(`  ⚠ Track ISRC ${rec.isrc}: lỗi đính audio — ${e}`);
    }
  }
  log.push(`  ♫ Đã đính kèm audio cho ${attached} track`);
}

/** Nạp 1 delivery (1 file XML). Trả True nếu đã xử lý (thành/bại đều rời khỏi incoming). */
function processOne(partner: Row, xmlPath: string): void {
  const deliveryDir = path.dirname(xmlPath);
  let log: string[] = [];
  let ok = false;
  try {
    const xmlBytes = fs.readFileSync(xmlPath);
    const parsed = parseErn(xmlBytes);
    const report = importDelivery(xmlBytes, { autoPublish: !!partner.auto_publish, partner: partner as any });
    log = [...report.log];
    if (report.status !== 'duplicate' && report.status !== 'failed') {
      attachAudio(parsed, report, deliveryDir, log);
    }
    db.prepare("UPDATE delivery_partners SET last_delivery_at=datetime('now') WHERE id=?")
      .run(partner.id);
    ok = report.status !== 'failed';
  } catch (e) {
    log.push(`Lỗi xử lý: ${e}`);
    ok = false;
  }

  const destRoot = path.join(SFTP_ROOT, partner.sftp_username, ok ? 'processed' : 'failed');
  try { fs.mkdirSync(destRoot, { recursive: true }); } catch { /* ignore */ }
  const stamp = String(Math.floor(Date.now() / 1000));
  try {
    if (path.basename(deliveryDir) === 'incoming') {
      fs.renameSync(xmlPath, path.join(destRoot, `${stamp}_${path.basename(xmlPath)}`));
    } else {
      fs.renameSync(deliveryDir, path.join(destRoot, `${stamp}_${path.basename(deliveryDir)}`));
    }
  } catch { /* ignore */ }
  console.log(`[sftp-watch] ${partner.name}: ${path.basename(xmlPath)} → ${ok ? 'processed' : 'failed'}`);
  for (const line of log) console.log('   ' + line);
}

/** Quét tất cả dropbox 1 lần (đồng bộ). */
function scanOnce(): void {
  const partners = db.prepare(
    "SELECT * FROM delivery_partners WHERE delivery_channel='sftp' AND sftp_username IS NOT NULL",
  ).all() as Row[];
  const nowMs = Date.now();
  for (const partner of partners) {
    const incoming = path.join(SFTP_ROOT, partner.sftp_username, 'incoming');
    try { if (!fs.statSync(incoming).isDirectory()) continue; }
    catch { continue; }
    const xmls = walkFiles(incoming)
      .filter(f => path.extname(f).toLowerCase() === '.xml')
      .sort();
    for (const xmlPath of xmls) {
      // cả XML lẫn mọi file trong thư mục delivery phải ổn định (đối tác upload xong)
      const folder = path.dirname(xmlPath);
      const files = walkFiles(folder);
      if (files.length === 0 || !files.every(f => isStable(f, nowMs))) continue;
      processOne(partner, xmlPath);
    }
  }
}

let watchTimer: ReturnType<typeof setTimeout> | null = null;
let watchStopped = false;

function scheduleScan(): void {
  if (watchStopped) return;
  watchTimer = setTimeout(() => {
    try { scanOnce(); }
    catch (e) { console.error('[sftp-watch] lỗi vòng quét:', e); }
    scheduleScan();
  }, SFTP_POLL_SEC * 1000);
}

// ===========================================================================
//  API công khai (index.ts gọi startSftp qua dynamic import)
// ===========================================================================

/** Khởi động SFTP server + watcher. Không làm gì nếu ANS_SFTP_ENABLED != true. */
export async function startSftp(): Promise<void> {
  if (!SFTP_ENABLED) return;
  startServer();
  watchStopped = false;
  scheduleScan();
}

/** Dừng SFTP server + watcher (dùng khi tắt/khởi động lại). */
export function stopSftp(): void {
  watchStopped = true;
  if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }
  if (server) {
    try { server.close(); } catch { /* ignore */ }
    server = null;
  }
}
