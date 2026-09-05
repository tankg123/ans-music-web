/** TOTP (RFC 6238) cho 2FA — port từ backend/app/totp.py, dùng thư viện otplib.
 *
 *  Chu kỳ 30s, 6 số, HMAC-SHA1 (chuẩn mặc định Google Authenticator). otplib với
 *  các mặc định (algorithm=SHA1, digits=6, step=30, keyEncoder=base32) sinh/kiểm
 *  code Y HỆT thuật toán stdlib của Python → tương thích secret cũ trong DB. */
import { authenticator } from 'otplib';

/** Secret base32 20 byte (khớp Python: base32(token_bytes(20)) → 32 ký tự). */
export function newSecret(): string {
  return authenticator.generateSecret(20);
}

/** Code hiện tại cho secret (chu kỳ 30s hiện thời). */
export function totpNow(secret: string): string {
  return authenticator.generate(secret);
}

/** So khớp code với cửa sổ ±window chu kỳ (bù lệch đồng hồ điện thoại). */
export function verifyTotp(secret: string, code: string, window = 1): boolean {
  const clean = (code || '').trim().replace(/ /g, '');
  if (!/^\d{6}$/.test(clean) || !secret) return false;
  authenticator.options = { window };
  try {
    return authenticator.verify({ token: clean, secret });
  } catch {
    return false;
  }
}

/** URI otpauth:// — Google Authenticator hiển thị nhãn '{brand} - {email}'. */
export function otpauthUri(secret: string, email: string, brandName = 'ANS Music'): string {
  const label = encodeURIComponent(`${brandName} - ${email}`);
  const issuer = encodeURIComponent(brandName);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}
