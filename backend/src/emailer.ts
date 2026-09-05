/** Gửi email qua SMTP (Google Workspace / Gmail App Password) — port emailer.py.
 *
 *  Chưa cấu hình SMTP → chế độ dev: in mã ra console server (vẫn đăng ký test được).
 *  Mẫu email: tiếng Anh chuyên nghiệp, layout table-based (tương thích Gmail/Outlook),
 *  màu chủ đạo xanh lá + trắng, toàn bộ CSS inline, không ảnh ngoài / web font.
 *
 *  Lưu ý: nodemailer gửi bất đồng bộ nên các hàm trả Promise<boolean>
 *  (false = dev-mode/không gửi qua SMTP). Caller dùng `await`. */
import nodemailer, { type Transporter } from 'nodemailer';
import {
  EMAIL_ENABLED, EMAIL_CODE_TTL,
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD,
  SMTP_FROM, SMTP_FROM_NAME, SMTP_TLS,
} from './config.js';

/** Escape HTML giống Python html.escape(s) (quote=True): & < > " '. */
function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/** Gộp mọi khoảng trắng về 1 dòng (chống CR/LF trong header Subject). */
function oneLineBrand(brandName?: string | null): string {
  const collapsed = String(brandName || 'ANS Music').split(/\s+/).filter(Boolean).join(' ');
  return collapsed || 'ANS Music';
}

/** Dựng phần HTML của email (table-based, CSS inline, max-width 560px). */
function buildHtml(brandHtml: string, code: string, ttlMinutes: number,
                   intro = 'Use the verification code below to complete your registration:'): string {
  return `\
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
                         color:#ffffff;letter-spacing:0.5px;">${brandHtml}</span>
          </td>
        </tr>
        <!-- Lời chào + hướng dẫn -->
        <tr>
          <td style="padding:32px 36px 8px;">
            <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:16px;
                      color:#111827;">Hello,</p>
            <p style="margin:0 0 24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;
                      line-height:1.6;color:#374151;">${intro}</p>
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
                               font-weight:bold;letter-spacing:10px;color:#065f46;">${code}</span>
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
              This code expires in ${ttlMinutes} minutes.</p>
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
              &copy; ${brandHtml}. This is an automated message &mdash; please do not reply.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

let _transport: Transporter | null = null;
function transport(): Transporter {
  if (!_transport) {
    _transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      // SMTP_TLS=true → STARTTLS (secure:false); false → SMTP_SSL implicit (secure:true)
      secure: !SMTP_TLS,
      requireTLS: SMTP_TLS,
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 20000,
    });
  }
  return _transport;
}

interface MailOpts { subject: string; text: string; html: string; }

async function smtpSend(toEmail: string, opts: MailOpts): Promise<void> {
  try {
    await transport().sendMail({
      from: { name: SMTP_FROM_NAME, address: SMTP_FROM },
      to: toEmail,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
  } catch (e) {
    // production: KHÔNG in mã ra log (tránh rò rỉ); chỉ báo lỗi
    console.log(`[email] Lỗi gửi tới ${toEmail}: ${e}`);
    throw new Error('SMTP send failed');
  }
}

/** Gửi mã xác thực. Trả true nếu đã gửi qua email, false nếu dev-mode. */
export async function sendVerificationCode(toEmail: string, code: string,
                                           brandName = 'ANS Music'): Promise<boolean> {
  if (!EMAIL_ENABLED) {
    console.log(`\n[email:DEV] Mã xác thực cho ${toEmail}: ${code}  (cấu hình SMTP trong .env để gửi email thật)\n`);
    return false;
  }
  const brand = oneLineBrand(brandName);
  const ttlMinutes = Math.floor(EMAIL_CODE_TTL / 60);
  const text =
    `Hello,\n\n` +
    `Use the verification code below to complete your registration ` +
    `with ${brand}:\n\n` +
    `    ${code}\n\n` +
    `This code expires in ${ttlMinutes} minutes.\n\n` +
    `If you didn't request this code, you can safely ignore this email. ` +
    `Never share this code with anyone.\n\n` +
    `© ${brand}. This is an automated message — please do not reply.`;
  await smtpSend(toEmail, {
    subject: `${brand} — Your verification code`,
    text,
    html: buildHtml(htmlEscape(brand), code, ttlMinutes),
  });
  return true;
}

/** Gửi mã ĐẶT LẠI MẬT KHẨU. Trả true nếu đã gửi, false nếu dev-mode. */
export async function sendResetCode(toEmail: string, code: string,
                                    brandName = 'ANS Music'): Promise<boolean> {
  if (!EMAIL_ENABLED) {
    console.log(`\n[email:DEV] Mã đặt lại mật khẩu cho ${toEmail}: ${code}  (cấu hình SMTP trong .env để gửi email thật)\n`);
    return false;
  }
  const brand = oneLineBrand(brandName);
  const ttlMinutes = Math.floor(EMAIL_CODE_TTL / 60);
  const text =
    `Hello,\n\n` +
    `We received a request to reset the password for your ${brand} ` +
    `account. Use the code below to continue:\n\n` +
    `    ${code}\n\n` +
    `This code expires in ${ttlMinutes} minutes.\n\n` +
    `If you didn't request a password reset, you can safely ignore this ` +
    `email — your password will remain unchanged. Never share this code ` +
    `with anyone.\n\n` +
    `© ${brand}. This is an automated message — please do not reply.`;
  await smtpSend(toEmail, {
    subject: `${brand} — Password reset code`,
    text,
    html: buildHtml(htmlEscape(brand), code, ttlMinutes,
      'We received a request to reset your password. Use the code below to continue:'),
  });
  return true;
}
