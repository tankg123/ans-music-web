"""Gửi email qua SMTP (Google Workspace / Gmail App Password).

Chưa cấu hình SMTP → chế độ dev: in mã ra console server (vẫn đăng ký test được).
Mẫu email: tiếng Anh chuyên nghiệp, layout table-based (tương thích Gmail/Outlook),
màu chủ đạo xanh lá + trắng, toàn bộ CSS inline, không ảnh ngoài / web font.
"""
import html
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

from . import config


def _build_html(brand_html: str, code: str, ttl_minutes: int,
                intro: str = "Use the verification code below to complete your registration:") -> str:
    """Dựng phần HTML của email (table-based, CSS inline, max-width 560px)."""
    return f"""\
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background-color:#f0faf4;margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"
             style="max-width:560px;width:100%;background-color:#ffffff;border-radius:12px;
                    border:1px solid #d1fae5;">
        <!-- Dải header xanh lá, tên brand chữ trắng -->
        <tr>
          <td align="center"
              style="background-color:#16a34a;border-radius:12px 12px 0 0;padding:22px 24px;">
            <span style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;
                         color:#ffffff;letter-spacing:0.5px;">{brand_html}</span>
          </td>
        </tr>
        <!-- Lời chào + hướng dẫn -->
        <tr>
          <td style="padding:32px 36px 8px;">
            <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:16px;
                      color:#111827;">Hello,</p>
            <p style="margin:0 0 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;
                      line-height:1.6;color:#374151;">{intro}</p>
          </td>
        </tr>
        <!-- Khối mã xác thực: nền xanh nhạt, viền xanh, chữ xanh đậm cỡ lớn -->
        <tr>
          <td style="padding:0 36px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center"
                    style="background-color:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;
                           padding:20px 12px;">
                  <span style="font-family:'Courier New',Courier,monospace;font-size:32px;
                               font-weight:bold;letter-spacing:10px;color:#065f46;">{code}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Hạn dùng + lưu ý bảo mật -->
        <tr>
          <td style="padding:22px 36px 28px;">
            <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;
                      line-height:1.6;color:#374151;">
              This code expires in {ttl_minutes} minutes.</p>
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;
                      line-height:1.6;color:#6b7280;">
              If you didn't request this code, you can safely ignore this email.
              Never share this code with anyone.</p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td align="center" style="padding:16px 36px 20px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;
                      color:#9ca3af;">
              &copy; {brand_html}. This is an automated message &mdash; please do not reply.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>"""


def send_verification_code(to_email: str, code: str,
                           brand_name: str = "ANS Music") -> bool:
    """Gửi mã xác thực. Trả True nếu đã gửi qua email, False nếu dev-mode/lỗi."""
    if not config.EMAIL_ENABLED:
        print(f"\n[email:DEV] Mã xác thực cho {to_email}: {code}  (cấu hình SMTP trong .env để gửi email thật)\n")
        return False

    # ép brand_name về 1 dòng: CR/LF trong header Subject làm EmailMessage
    # raise ValueError → mọi request đăng ký trả 500 cho tới khi admin sửa brand
    brand_name = " ".join(str(brand_name or "ANS Music").split()) or "ANS Music"
    ttl_minutes = config.EMAIL_CODE_TTL // 60
    msg = EmailMessage()
    msg["Subject"] = f"{brand_name} — Your verification code"
    msg["From"] = formataddr((config.SMTP_FROM_NAME, config.SMTP_FROM))
    msg["To"] = to_email
    # Bản text thuần (fallback cho client không hiển thị HTML)
    msg.set_content(
        f"Hello,\n\n"
        f"Use the verification code below to complete your registration "
        f"with {brand_name}:\n\n"
        f"    {code}\n\n"
        f"This code expires in {ttl_minutes} minutes.\n\n"
        f"If you didn't request this code, you can safely ignore this email. "
        f"Never share this code with anyone.\n\n"
        f"© {brand_name}. This is an automated message — please do not reply.")
    # Bản HTML (escape brand_name — giá trị cấu hình được từ Admin)
    msg.add_alternative(_build_html(html.escape(brand_name), code, ttl_minutes),
                        subtype="html")

    _smtp_send(msg, to_email)
    return True


def _smtp_send(msg: EmailMessage, to_email: str) -> None:
    try:
        if config.SMTP_TLS:
            ctx = ssl.create_default_context()
            with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=20) as s:
                s.starttls(context=ctx)
                s.login(config.SMTP_USER, config.SMTP_PASSWORD)
                s.send_message(msg)
        else:
            with smtplib.SMTP_SSL(config.SMTP_HOST, config.SMTP_PORT, timeout=20) as s:
                s.login(config.SMTP_USER, config.SMTP_PASSWORD)
                s.send_message(msg)
    except (smtplib.SMTPException, OSError) as e:
        # production: KHÔNG in mã ra log (tránh rò rỉ); chỉ báo lỗi
        print(f"[email] Lỗi gửi tới {to_email}: {e}")
        raise RuntimeError("SMTP send failed") from e


def send_reset_code(to_email: str, code: str,
                    brand_name: str = "ANS Music") -> bool:
    """Gửi mã ĐẶT LẠI MẬT KHẨU. Trả True nếu đã gửi, False nếu dev-mode."""
    if not config.EMAIL_ENABLED:
        print(f"\n[email:DEV] Mã đặt lại mật khẩu cho {to_email}: {code}  (cấu hình SMTP trong .env để gửi email thật)\n")
        return False

    brand_name = " ".join(str(brand_name or "ANS Music").split()) or "ANS Music"
    ttl_minutes = config.EMAIL_CODE_TTL // 60
    msg = EmailMessage()
    msg["Subject"] = f"{brand_name} — Password reset code"
    msg["From"] = formataddr((config.SMTP_FROM_NAME, config.SMTP_FROM))
    msg["To"] = to_email
    msg.set_content(
        f"Hello,\n\n"
        f"We received a request to reset the password for your {brand_name} "
        f"account. Use the code below to continue:\n\n"
        f"    {code}\n\n"
        f"This code expires in {ttl_minutes} minutes.\n\n"
        f"If you didn't request a password reset, you can safely ignore this "
        f"email — your password will remain unchanged. Never share this code "
        f"with anyone.\n\n"
        f"© {brand_name}. This is an automated message — please do not reply.")
    msg.add_alternative(
        _build_html(html.escape(brand_name), code, ttl_minutes,
                    intro="We received a request to reset your password. "
                          "Use the code below to continue:"),
        subtype="html")
    _smtp_send(msg, to_email)
    return True
