/** DDEX ERN Ingestion — parse NewReleaseMessage (ERN 3.x / 4.x) và import vào catalog.
 *  Port 1:1 từ backend/app/ddex.py.
 *
 *  Pipeline: VALIDATE (định dạng ISRC/UPC, MessageId idempotent) → PARSE+MAP →
 *  PUBLISH (review queue) → ACK log. Cách ly đa đối tác qua releases.source_partner_id.
 *
 *  Dùng fast-xml-parser với {ignoreAttributes:false, removeNSPrefix:true} để bỏ
 *  namespace ern:. Traversal đệ quy (findDeep/findAllDeep) thay cho ElementTree.iter().
 */
import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';

import { DELIVERY_DIR, COVER_DIR } from './config.js';
import { db, newId, type Row } from './db.js';
import { normalizeText, validateIsrc, cleanIsrc, validateUpc, stableSeed } from './utils.js';
import { mapDdexRole } from './distributions.js';
import { generateCover, generateAvatar } from './covers.js';
import { markCodeUsed } from './idpool.js';

// ---- Kiểu dữ liệu trung gian (khớp dict Python parse_ern) ------------------
export interface ErnArtist { name: string; role: string; }
export interface ErnRecording {
  isrc: string; ref: string; title: string; duration_ms: number;
  artists: ErnArtist[]; p_line: string; genre: string;
  parental_warning: string; file_uri: string;
}
export interface ErnRelease {
  upc: string; title: string; release_type: string;
  resource_refs: string[]; label: string; genre: string; purge: boolean;
}
export interface ErnDeal {
  territories: string[]; use_types: string[]; commercial_models: string[]; start_date: string;
}
export interface ParsedErn {
  message_type: string; ern_version: string; message_id: string;
  sender_dpid: string; sender_name: string;
  recordings: ErnRecording[]; releases: ErnRelease[]; deals: ErnDeal[];
}

export interface DeliveryPartner { id: string; name: string; dpid?: string; [k: string]: any; }
export interface ImportOptions { autoPublish?: boolean; partner?: DeliveryPartner | null; }
export interface DeliveryReport {
  delivery_id: string; status: string; log: string[];
  releases: any[]; tracks: Array<{ isrc: string; title: string; id: string }>;
}

/** Lỗi parse/validate ERN — tương đương ValueError của Python (được import_delivery bắt). */
export class ErnError extends Error {}

// ---- Node & traversal helpers (thay ElementTree, đã bỏ namespace) ----------
interface Node { tag: string; value: any; }

const ATTR_PREFIX = '@_';
const TEXT_KEY = '#text';

/** Con trực tiếp của node (mảng cùng tên → nhiều node); bỏ attribute + #text. */
function childNodes(node: Node): Node[] {
  const v = node.value;
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return [];
  const out: Node[] = [];
  for (const key of Object.keys(v)) {
    if (key.startsWith(ATTR_PREFIX) || key === TEXT_KEY) continue;
    const cv = v[key];
    if (Array.isArray(cv)) {
      for (const item of cv) out.push({ tag: key, value: item });
    } else {
      out.push({ tag: key, value: cv });
    }
  }
  return out;
}

/** Text của node (leaf string, hoặc #text nếu có attribute) → .strip() như Python. */
function text(node: Node | null | undefined): string {
  if (!node) return '';
  const v = node.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v).trim();
  if (typeof v === 'object' && !Array.isArray(v)) {
    const t = v[TEXT_KEY];
    if (t === null || t === undefined) return '';
    return typeof t === 'string' ? t.trim() : String(t).trim();
  }
  return '';
}

/** Giá trị attribute (không prefix) — tương đương el.get(name, ""). */
function attr(node: Node, name: string): string {
  const v = node.value;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const a = v[ATTR_PREFIX + name];
    if (a === null || a === undefined) return '';
    return typeof a === 'string' ? a : String(a);
  }
  return '';
}

/** Tìm phần tử theo tên local (bỏ namespace), path dạng 'A/B/C' — chỉ con trực tiếp. */
function find(node: Node, pathStr: string): Node | null {
  const parts = pathStr.split('/');
  let current: Node[] = [node];
  for (const p of parts) {
    const nxt: Node[] = [];
    for (const c of current) {
      for (const ch of childNodes(c)) if (ch.tag === p) nxt.push(ch);
    }
    if (nxt.length === 0) return null;
    current = nxt;
  }
  return current[0];
}

/** Mọi con trực tiếp có tên local = name. */
function findall(node: Node, name: string): Node[] {
  return childNodes(node).filter(c => c.tag === name);
}

/** Phần tử đầu tiên tên local = name ở bất kỳ độ sâu nào (gồm chính node — như iter()). */
function findDeep(node: Node, name: string): Node | null {
  if (node.tag === name) return node;
  for (const ch of childNodes(node)) {
    const r = findDeep(ch, name);
    if (r) return r;
  }
  return null;
}

/** Mọi phần tử tên local = name ở mọi độ sâu (pre-order, gồm chính node). */
function findAllDeep(node: Node, name: string): Node[] {
  const out: Node[] = [];
  const walk = (n: Node) => {
    if (n.tag === name) out.push(n);
    for (const ch of childNodes(n)) walk(ch);
  };
  walk(node);
  return out;
}

/** ISO-8601 PT3M45S → ms. */
function parseDurationIso(value: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(value || '');
  if (!m) return 0;
  const h = m[1] ? parseFloat(m[1]) : 0;
  const mi = m[2] ? parseFloat(m[2]) : 0;
  const s = m[3] ? parseFloat(m[3]) : 0;
  return Math.trunc((h * 3600 + mi * 60 + s) * 1000);
}

// ---------------------------------------------------------------------------
/** Parse ERN XML → cấu trúc trung gian. Ném ErnError nếu không hợp lệ. */
export function parseErn(input: Buffer | string): ParsedErn {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  let xmlStr = buf.toString('utf8');
  if (xmlStr.charCodeAt(0) === 0xfeff) xmlStr = xmlStr.slice(1); // bỏ BOM

  // ERN hợp lệ không bao giờ cần DTD — chặn để loại trừ entity-expansion DoS.
  const head = xmlStr.slice(0, 4096).toUpperCase();
  if (head.includes('<!DOCTYPE') || head.includes('<!ENTITY')) {
    throw new ErnError('XML chứa DOCTYPE/ENTITY — không được phép');
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    attributeNamePrefix: ATTR_PREFIX,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    ignoreDeclaration: true,
    ignorePiTags: true,
  });
  let obj: any;
  try {
    obj = parser.parse(xmlStr);
  } catch (e: any) {
    throw new ErnError(`XML không parse được: ${e?.message || e}`);
  }

  const rootKey = obj && typeof obj === 'object'
    ? Object.keys(obj).find(k => !k.startsWith(ATTR_PREFIX) && k !== TEXT_KEY && k !== '?xml')
    : undefined;
  if (!rootKey) throw new ErnError('XML không parse được: thiếu phần tử gốc');
  const root: Node = { tag: rootKey, value: obj[rootKey] };
  const rootTag = rootKey;
  if (rootTag !== 'NewReleaseMessage' && rootTag !== 'PurgeReleaseMessage') {
    throw new ErnError(`Loại message không hỗ trợ: ${rootTag}`);
  }

  // Version: từ namespace URI (/ern/NNN) rồi override bằng MessageSchemaVersionId.
  let version = 'unknown';
  const mns = xmlStr.match(/\/ern\/(\d+)/);
  if (mns) {
    const raw = mns[1];
    version = raw.length <= 3 ? raw.split('').join('.') : raw;
  }
  const schemaAttr = attr(root, 'MessageSchemaVersionId');
  if (schemaAttr) {
    version = schemaAttr.replaceAll('ern/', '').trim() || version;
  }

  const header = findDeep(root, 'MessageHeader');
  if (!header) throw new ErnError('Thiếu MessageHeader');
  const messageId = text(find(header, 'MessageId'));
  if (!messageId) throw new ErnError('Thiếu MessageId');
  const sender = find(header, 'MessageSender');
  const senderDpid = sender ? text(findDeep(sender, 'PartyId')) : '';
  const senderName = sender ? text(findDeep(sender, 'FullName')) : '';

  const result: ParsedErn = {
    message_type: rootTag,
    ern_version: version,
    message_id: messageId,
    sender_dpid: senderDpid || 'UNKNOWN_DPID',
    sender_name: senderName || 'Unknown Partner',
    recordings: [],
    releases: [],
    deals: [],
  };

  if (rootTag === 'PurgeReleaseMessage') {
    for (const icpn of findAllDeep(root, 'ICPN')) {
      result.releases.push({
        upc: text(icpn), title: '', release_type: '', resource_refs: [],
        label: '', genre: '', purge: true,
      });
    }
    return result;
  }

  // ---- PartyList (ERN 4.x): PartyReference → tên -----------------------
  const partyNames: Record<string, string> = {};
  const partyList = findDeep(root, 'PartyList');
  if (partyList) {
    for (const party of findall(partyList, 'Party')) {
      const ref = text(find(party, 'PartyReference'));
      const name = text(findDeep(party, 'FullName'));
      if (ref && name) partyNames[ref] = name;
    }
  }

  const partyNameOf = (
    el: Node,
    nameTag = 'FullName',
    refTags: string[] = ['ArtistPartyReference', 'PartyReference'],
  ): string => {
    const full = text(findDeep(el, nameTag));
    if (!full) {
      for (const rt of refTags) {
        const pref = text(findDeep(el, rt));
        if (pref && partyNames[pref] !== undefined) return partyNames[pref];
      }
    }
    return full;
  };

  // ---- ResourceList / SoundRecording --------------------------------
  for (const sr of findAllDeep(root, 'SoundRecording')) {
    const isrc = text(findDeep(sr, 'ISRC'));
    const ref = text(findDeep(sr, 'ResourceReference'));
    const title = text(findDeep(sr, 'TitleText'));
    const durationMs = parseDurationIso(text(findDeep(sr, 'Duration')));

    const artists: ErnArtist[] = [];
    const seenRoles = new Set<string>(); // (name, role) — tránh trùng
    const add = (name: string, roleWeb: string) => {
      const nm = (name || '').trim();
      const key = `${nm} ${roleWeb}`;
      if (nm && !seenRoles.has(key)) {
        seenRoles.add(key);
        artists.push({ name: nm, role: roleWeb });
      }
    };

    // 1) DisplayArtist → MainArtist / FeaturedArtist (mặc định MainArtist)
    for (const da of findAllDeep(sr, 'DisplayArtist')) {
      const full = partyNameOf(da);
      const raw = text(findDeep(da, 'ArtistRole'))
        || text(findDeep(da, 'DisplayArtistRole')) || 'MainArtist';
      add(full, mapDdexRole(raw, 'MainArtist'));
    }
    // 2) Contributor (nhạc công, producer, mixer, remixer…) → theo Role
    for (const c of [...findAllDeep(sr, 'ResourceContributor'), ...findAllDeep(sr, 'Contributor')]) {
      const full = partyNameOf(c, 'FullName', ['PartyReference', 'ContributorPartyReference']);
      const raw = text(findDeep(c, 'ResourceContributorRole'))
        || text(findDeep(c, 'Role')) || 'Performer';
      add(full, mapDdexRole(raw, 'Performer'));
    }
    // 3) IndirectContributor (composer, lyricist, publisher…) → theo Role
    for (const c of [...findAllDeep(sr, 'IndirectResourceContributor'), ...findAllDeep(sr, 'IndirectContributor')]) {
      const full = partyNameOf(c, 'FullName', ['PartyReference', 'ContributorPartyReference']);
      const raw = text(findDeep(c, 'IndirectResourceContributorRole'))
        || text(findDeep(c, 'Role')) || 'Composer';
      add(full, mapDdexRole(raw, 'Composer'));
    }

    // đảm bảo có ít nhất 1 MainArtist
    if (!artists.some(a => a.role === 'MainArtist') && artists.length) {
      artists[0].role = 'MainArtist';
    }

    // file audio tham chiếu trong TechnicalDetails (để watcher SFTP đính kèm)
    let fileUri = '';
    for (const tag of ['URI', 'FileName', 'URL']) {
      fileUri = text(findDeep(sr, tag));
      if (fileUri) break;
    }

    const genre = text(findDeep(sr, 'GenreText'));
    const pw = text(findDeep(sr, 'ParentalWarningType')) || 'NotExplicit';
    result.recordings.push({
      isrc, ref, title, duration_ms: durationMs,
      artists, p_line: text(findDeep(sr, 'PLineText')), genre,
      parental_warning: pw, file_uri: fileUri,
    });
  }

  // ---- ReleaseList ----------------------------------------------------
  for (const rel of findAllDeep(root, 'Release')) {
    const upc = text(findDeep(rel, 'ICPN'));
    const title = text(findDeep(rel, 'TitleText'));
    const rtype = text(findDeep(rel, 'ReleaseType')) || 'Album';
    const refs = findAllDeep(rel, 'ReleaseResourceReference').map(r => text(r));
    const label = text(findDeep(rel, 'LabelName'));
    const genre = text(findDeep(rel, 'GenreText'));
    // ERN 4.x: Release không có ICPN → là TrackRelease, bỏ qua
    const isMain = attr(rel, 'IsMainRelease').toLowerCase() === 'true' || !!upc;
    if (!isMain) continue;
    result.releases.push({
      upc, title, release_type: rtype,
      resource_refs: refs, label, genre, purge: false,
    });
  }

  // ---- DealList -------------------------------------------------------
  for (const deal of findAllDeep(root, 'DealTerms')) {
    const territories = findAllDeep(deal, 'TerritoryCode').map(t => text(t));
    const useTypes = findAllDeep(deal, 'UseType').map(u => text(u));
    const models = findAllDeep(deal, 'CommercialModelType').map(c => text(c));
    // chuẩn hóa StartDate về YYYY-MM-DD (loại '2026-07-10T00:00:00Z'…)
    const rawStart = text(findDeep(deal, 'StartDate'));
    const mStart = /^(\d{4}-\d{2}-\d{2})/.exec(rawStart);
    const start = mStart ? mStart[1] : '';
    result.deals.push({
      territories: territories.length ? territories : ['Worldwide'],
      use_types: useTypes.length ? useTypes : ['OnDemandStream'],
      commercial_models: models.length ? models : ['SubscriptionModel'],
      start_date: start,
    });
  }

  return result;
}

/** Business rules — trả về danh sách lỗi (rỗng = hợp lệ). */
function validate(parsed: ParsedErn): string[] {
  const errors: string[] = [];
  if (parsed.message_type === 'PurgeReleaseMessage') {
    if (!parsed.releases.length) errors.push('PurgeReleaseMessage không có UPC nào');
    return errors;
  }
  if (!parsed.releases.length) errors.push('Không tìm thấy Release (thiếu ICPN/UPC)');
  for (const r of parsed.releases) {
    if (!r.upc) errors.push(`Release '${r.title}' thiếu UPC/ICPN`);
    else if (!validateUpc(r.upc)) errors.push(`UPC không hợp lệ (checksum GTIN): ${r.upc}`);
    if (!r.title) errors.push(`Release UPC ${r.upc} thiếu tiêu đề`);
  }
  if (!parsed.recordings.length) errors.push('Không có SoundRecording nào trong ResourceList');
  for (const t of parsed.recordings) {
    if (!t.isrc) errors.push(`Track '${t.title}' thiếu ISRC`);
    else if (!validateIsrc(t.isrc)) errors.push(`ISRC sai định dạng: ${t.isrc}`);
    if (!t.title) errors.push(`SoundRecording ${t.isrc} thiếu TitleText`);
  }
  if (!parsed.deals.length) errors.push('Thiếu DealList — cần ít nhất 1 Deal (territory + use type)');
  return errors;
}

/** Tìm hoặc tạo artist theo tên chuẩn hóa; sinh avatar SVG cho artist mới. */
function getOrCreateArtist(name: string): string {
  const norm = normalizeText(name);
  const row = db.prepare('SELECT id FROM artists WHERE name_norm = ?').get(norm) as Row | undefined;
  if (row) return row.id;
  const aid = newId();
  const img = path.join(COVER_DIR, `artist_${aid}.svg`);
  const accent = generateAvatar(img, { seed: stableSeed(norm), name });
  db.prepare(
    'INSERT INTO artists(id,name,name_norm,sort_name,image_url,accent) VALUES(?,?,?,?,?,?)',
  ).run(aid, name, norm, name, `/media/covers/artist_${aid}.svg`, accent);
  return aid;
}

// ---------------------------------------------------------------------------
/** Pipeline đầy đủ cho 1 gói delivery. Trả về report dict.
 *
 *  partner: đối tác ĐÃ XÁC THỰC qua API key (id, name, dpid) — khi có,
 *  idempotency tính theo partner thật, không tin DPID tự khai trong XML.
 */
export function importDelivery(input: Buffer | string, opts: ImportOptions = {}): DeliveryReport {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  const partner = opts.partner ?? null;
  const autoPublish = opts.autoPublish ?? false;

  const deliveryId = newId();
  const log: string[] = [];
  const report: DeliveryReport = {
    delivery_id: deliveryId, status: 'failed', log, releases: [], tracks: [],
  };
  const partnerId: string | null = partner ? partner.id : null;
  const channel = partner ? 'partner_api' : 'admin_upload';

  // [1-2] LƯU GÓI ------------------------------------------------------
  const xmlName = `${deliveryId}.xml`;
  const xmlPath = path.join(DELIVERY_DIR, xmlName);
  fs.writeFileSync(xmlPath, buf);

  const run = db.transaction(() => {
    let parsed: ParsedErn;
    try {
      parsed = parseErn(buf);
    } catch (e) {
      if (!(e instanceof ErnError)) throw e;
      db.prepare(
        'INSERT INTO deliveries(id,partner_id,partner_name,dpid,message_id,message_type,'
        + 'ern_version,xml_path,status,log,channel,processed_at) '
        + "VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now'))",
      ).run(deliveryId, partnerId, partner ? partner.name : null,
        null, null, null, null, xmlName, 'failed', e.message, channel);
      log.push(`LỖI: ${e.message}`);
      return;
    }

    // Idempotent: theo đối tác xác thực nếu có, không thì theo dpid trong XML
    let dup: Row | undefined;
    if (partner) {
      dup = db.prepare(
        'SELECT id, status FROM deliveries WHERE partner_id = ? AND message_id = ?',
      ).get(partnerId, parsed.message_id) as Row | undefined;
    } else {
      dup = db.prepare(
        'SELECT id, status FROM deliveries WHERE partner_id IS NULL '
        + 'AND dpid = ? AND message_id = ?',
      ).get(parsed.sender_dpid, parsed.message_id) as Row | undefined;
    }
    if (dup) {
      log.push(`MessageId '${parsed.message_id}' đã xử lý trước đó `
        + `(delivery ${dup.id}, status=${dup.status}) — bỏ qua (idempotent).`);
      report.status = 'duplicate';
      return;
    }

    // [3] VALIDATE ---------------------------------------------------------
    const errors = validate(parsed);
    const status = errors.length ? 'failed' : 'validated';
    const displayName = partner ? partner.name : parsed.sender_name;
    db.prepare(
      'INSERT INTO deliveries(id,partner_id,partner_name,dpid,message_id,message_type,'
      + 'ern_version,xml_path,status,log,channel) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    ).run(deliveryId, partnerId, displayName, parsed.sender_dpid,
      parsed.message_id, parsed.message_type, parsed.ern_version,
      xmlName, status, '', channel);
    log.push(`Nhận ${parsed.message_type} ERN ${parsed.ern_version} `
      + `từ ${displayName} (${parsed.sender_dpid})`);
    if (errors.length) {
      for (const er of errors) log.push(`LỖI VALIDATE: ${er}`);
      db.prepare("UPDATE deliveries SET log = ?, processed_at = datetime('now') WHERE id = ?")
        .run(log.join('\n'), deliveryId);
      return;
    }

    // ---- Takedown --------------------------------------------------------
    if (parsed.message_type === 'PurgeReleaseMessage') {
      for (const r of parsed.releases) {
        const row = db.prepare('SELECT id, title FROM releases WHERE upc = ?')
          .get(r.upc) as Row | undefined;
        if (row) {
          db.prepare("UPDATE releases SET status = 'taken_down' WHERE id = ?").run(row.id);
          // chỉ gỡ track KHÔNG còn nằm trong release live nào khác
          db.prepare(
            "UPDATE tracks SET status = 'taken_down' WHERE id IN ("
            + '  SELECT rt.track_id FROM release_tracks rt'
            + '  WHERE rt.release_id = ?'
            + '    AND NOT EXISTS ('
            + '      SELECT 1 FROM release_tracks rt2'
            + '      JOIN releases r2 ON r2.id = rt2.release_id'
            + '      WHERE rt2.track_id = rt.track_id'
            + "        AND r2.id != ? AND r2.status = 'live'))",
          ).run(row.id, row.id);
          log.push(`TAKEDOWN: đã gỡ release '${row.title}' (UPC ${r.upc})`);
          report.releases.push({ upc: r.upc, action: 'taken_down' });
        } else {
          log.push(`TAKEDOWN: không tìm thấy UPC ${r.upc} — bỏ qua`);
        }
      }
      report.status = 'imported';
      db.prepare(
        "UPDATE deliveries SET status='imported', log=?, processed_at=datetime('now') WHERE id=?",
      ).run(log.join('\n'), deliveryId);
      return;
    }

    // [4] PARSE + MAP → catalog ---------------------------------------------
    const recByRef = new Map<string, ErnRecording>();
    for (const t of parsed.recordings) if (t.ref) recByRef.set(t.ref, t);
    const deal = parsed.deals[0];
    let publishStatus: string;
    if (autoPublish) {
      // StartDate của Deal ở tương lai → hẹn giờ, publisher tự phát hành đúng hạn
      const start = (deal.start_date || '').slice(0, 10);
      publishStatus = start > todayIso() ? 'scheduled' : 'live';
    } else {
      publishStatus = 'pending_review';
    }

    const partId: string | null = partner ? partner.id : null;
    for (const r of parsed.releases) {
      const existing = db.prepare('SELECT id, source_partner_id FROM releases WHERE upc = ?')
        .get(r.upc) as Row | undefined;
      // CÁCH LY ĐA ĐỐI TÁC: đối tác chỉ sửa release do CHÍNH MÌNH đưa vào.
      if (existing && partId
        && existing.source_partner_id != null && existing.source_partner_id !== partId) {
        log.push(`TỪ CHỐI: UPC ${r.upc} thuộc đối tác khác — bỏ qua (không ghi đè)`);
        continue;
      }
      const rid = existing ? existing.id : newId();
      const action = existing ? 'updated' : 'created';

      const coverPath = path.join(COVER_DIR, `release_${rid}.svg`);
      const accent = generateCover(coverPath, {
        seed: stableSeed(r.upc), title: r.title, subtitle: r.label || parsed.sender_name,
      });
      if (existing) {
        // DDEX là chuẩn full-replace: update thay toàn bộ metadata
        db.prepare(
          'UPDATE releases SET title=?, title_norm=?, release_type=?, label_name=?, genre=?, '
          + "status=?, source='ddex_feed', delivery_id=?, source_partner_id=COALESCE(source_partner_id,?), "
          + 'platform_release_date=COALESCE(?, platform_release_date) WHERE id=?',
        ).run(r.title, normalizeText(r.title), r.release_type, r.label,
          r.genre, publishStatus, deliveryId, partId,
          deal.start_date, rid);
        db.prepare('DELETE FROM release_tracks WHERE release_id=?').run(rid);
        db.prepare('DELETE FROM release_artists WHERE release_id=?').run(rid);
      } else {
        db.prepare(
          'INSERT INTO releases(id,upc,title,title_norm,release_type,label_name,genre,'
          + 'cover_url,accent,status,source,delivery_id,source_partner_id,platform_release_date) '
          + 'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ).run(rid, r.upc, r.title, normalizeText(r.title), r.release_type,
          r.label, r.genre, `/media/covers/release_${rid}.svg`, accent,
          publishStatus, 'ddex_feed', deliveryId, partId, deal.start_date || null);
      }

      // DDEX là full-replace: deal mới thay toàn bộ deal cũ của release
      db.prepare('DELETE FROM deals WHERE release_id=?').run(rid);
      db.prepare(
        'INSERT INTO deals(id,release_id,territories,use_types,commercial_models,start_date) '
        + 'VALUES(?,?,?,?,?,?)',
      ).run(newId(), rid, deal.territories.join(','), deal.use_types.join(','),
        deal.commercial_models.join(','), deal.start_date);

      const refs = r.resource_refs.length ? r.resource_refs : Array.from(recByRef.keys());
      let trackNo = 0;
      const releaseArtistAdded = new Set<string>();
      for (const ref of refs) {
        const rec = recByRef.get(ref);
        if (!rec) continue; // ảnh bìa hoặc resource khác
        trackNo += 1;
        const isrc = cleanIsrc(rec.isrc);
        const tExisting = db.prepare('SELECT id, status, audio_path FROM tracks WHERE isrc=?')
          .get(isrc) as Row | undefined;
        // CÁCH LY: track (ISRC) đã thuộc release của đối tác KHÁC → không ghi đè.
        if (tExisting && partId) {
          const other = db.prepare(
            'SELECT 1 FROM release_tracks rt JOIN releases r2 ON r2.id=rt.release_id '
            + 'WHERE rt.track_id=? AND r2.source_partner_id IS NOT NULL '
            + 'AND r2.source_partner_id != ? LIMIT 1',
          ).get(tExisting.id, partId) as Row | undefined;
          if (other) {
            log.push(`  ⚠ ISRC ${isrc} thuộc đối tác khác — bỏ qua track (không ghi đè)`);
            trackNo -= 1;
            continue;
          }
        }
        const tid = tExisting ? tExisting.id : newId();
        if (tExisting) {
          // full-replace metadata, giữ play_count + audio hiện có.
          let tStatus: string;
          if (publishStatus === 'live') {
            tStatus = tExisting.audio_path ? 'live' : 'draft';
          } else {
            tStatus = tExisting.status;
          }
          db.prepare(
            'UPDATE tracks SET title=?, title_norm=?, duration_ms=?, genre=?, '
            + 'parental_warning=?, p_line=?, status=? WHERE id=?',
          ).run(rec.title, normalizeText(rec.title),
            rec.duration_ms, rec.genre || r.genre,
            rec.parental_warning, rec.p_line, tStatus, tid);
          db.prepare('DELETE FROM track_artists WHERE track_id=?').run(tid);
        } else {
          db.prepare(
            'INSERT INTO tracks(id,isrc,title,title_norm,duration_ms,genre,'
            + 'parental_warning,p_line,status) VALUES(?,?,?,?,?,?,?,?,?)',
          ).run(tid, isrc, rec.title, normalizeText(rec.title),
            rec.duration_ms, rec.genre || r.genre,
            rec.parental_warning, rec.p_line,
            'draft'); // draft: chưa có file audio (chờ upload/batch media)
        }
        db.prepare(
          'INSERT OR REPLACE INTO release_tracks(release_id,track_id,disc_no,track_no) '
          + 'VALUES(?,?,1,?)',
        ).run(rid, tid, trackNo);
        let seq = 0;
        for (const a of rec.artists) {
          seq += 1;
          const aid = getOrCreateArtist(a.name);
          db.prepare(
            'INSERT OR IGNORE INTO track_artists(track_id,artist_id,role,sequence) VALUES(?,?,?,?)',
          ).run(tid, aid, a.role, seq);
          if (a.role === 'MainArtist' && !releaseArtistAdded.has(aid)) {
            releaseArtistAdded.add(aid);
            db.prepare(
              'INSERT OR IGNORE INTO release_artists(release_id,artist_id,role,sequence) VALUES(?,?,?,?)',
            ).run(rid, aid, 'MainArtist', releaseArtistAdded.size);
          }
        }
        markCodeUsed('isrc', isrc, tid);
        log.push(`  ♪ Track ${rec.title} (ISRC ${isrc}) — `
          + `${tExisting ? 'cập nhật' : 'tạo mới, chờ file audio'}`);
        // id để watcher đính audio ĐÚNG track đã tạo/sửa
        report.tracks.push({ isrc, title: rec.title, id: tid });
      }

      markCodeUsed('upc', r.upc, rid);
      log.push(`Release '${r.title}' (UPC ${r.upc}) — ${action}, `
        + `trạng thái: ${publishStatus}`);
      report.releases.push({ upc: r.upc, id: rid, action, status: publishStatus });
    }

    // [6-7] PUBLISH + ACK ---------------------------------------------------
    report.status = 'imported';
    log.push('ACK: import thành công'
      + (autoPublish ? '' : ' — chờ duyệt trong Review Queue'));
    db.prepare(
      "UPDATE deliveries SET status='imported', log=?, processed_at=datetime('now') WHERE id=?",
    ).run(log.join('\n'), deliveryId);
  });

  run();
  return report;
}

/** Ngày hôm nay theo giờ địa phương (YYYY-MM-DD) — khớp date.today().isoformat() của Python. */
function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
