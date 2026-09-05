"""Sinh QR code dạng SVG (cho 2FA otpauth URI) — dùng thư viện qrcode."""
import qrcode


def qr_svg(data: str, box: int = 6, dark: str = "#111318", light: str = "#ffffff") -> str:
    """Trả chuỗi SVG tự chứa (không ảnh ngoài), nền trắng để app scan dễ."""
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=3)
    q.add_data(data)
    q.make(fit=True)
    matrix = q.get_matrix()
    n = len(matrix)
    size = n * box
    rects = []
    for y, row in enumerate(matrix):
        x = 0
        while x < n:
            if row[x]:
                x0 = x
                while x < n and row[x]:
                    x += 1
                rects.append(f'<rect x="{x0 * box}" y="{y * box}" '
                             f'width="{(x - x0) * box}" height="{box}"/>')
            else:
                x += 1
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
            f'width="{size}" height="{size}">'
            f'<rect width="{size}" height="{size}" fill="{light}"/>'
            f'<g fill="{dark}">{"".join(rects)}</g></svg>')
