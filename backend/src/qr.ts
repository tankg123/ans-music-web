/** Sinh QR code dạng SVG (cho 2FA otpauth URI) — port từ backend/app/qr_svg.py.
 *
 *  Dùng thư viện 'qrcode' để lấy ma trận module (QRCode.create — ĐỒNG BỘ), rồi tự
 *  dựng SVG y hệt bản Python: quiet zone 3 module, gộp các ô đen liền hàng thành
 *  1 <rect>, nền sáng để app quét dễ. Hàm ĐỒNG BỘ (gọi trực tiếp, không cần await). */
import QRCode from 'qrcode';

const BORDER = 3;

/** Trả chuỗi SVG tự chứa (không ảnh ngoài) mã hoá `data`. */
export function qrSvg(data: string, box = 6, dark = '#111318', light = '#fff'): string {
  const qr = QRCode.create(data, { errorCorrectionLevel: 'M' });
  const s = qr.modules.size;          // số module (chưa gồm viền)
  const n = s + BORDER * 2;           // kích thước ma trận gồm viền (như get_matrix Python)
  const size = n * box;

  // true nếu ô (y,x) là module đen; vùng viền luôn sáng (false)
  const on = (y: number, x: number): boolean => {
    if (y < BORDER || x < BORDER || y >= BORDER + s || x >= BORDER + s) return false;
    return qr.modules.get(y - BORDER, x - BORDER) === 1;
  };

  const rects: string[] = [];
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (on(y, x)) {
        const x0 = x;
        while (x < n && on(y, x)) x++;
        rects.push(
          `<rect x="${x0 * box}" y="${y * box}" width="${(x - x0) * box}" height="${box}"/>`,
        );
      } else {
        x++;
      }
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" ` +
    `width="${size}" height="${size}">` +
    `<rect width="${size}" height="${size}" fill="${light}"/>` +
    `<g fill="${dark}">${rects.join('')}</g></svg>`
  );
}
