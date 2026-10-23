const nodemailer = require("nodemailer");

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
  }[character]));
}

function createTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error("Email service is not configured. Add SMTP_HOST, SMTP_USER, and SMTP_PASS to .env.");
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

async function sendVerificationEmail({ email, name, token }) {
  const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
  const verificationUrl = `${clientUrl}/verify-email?token=${encodeURIComponent(token)}`;
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;
  const transporter = createTransporter();

  await transporter.sendMail({
    from,
    to: email,
    subject: "Verify your Chatly email address",
    text: `Hi ${name}, verify your Chatly account by opening this link: ${verificationUrl}. This link expires in 1 hour.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#20213a">
        <h1 style="margin:0 0 12px;color:#8b5cf6">Welcome to Chatly</h1>
        <p>Hi ${escapeHtml(name)},</p>
        <p>Confirm your email address to activate your Chatly account. You cannot log in until it is verified.</p>
        <p style="margin:28px 0"><a href="${verificationUrl}" style="display:inline-block;padding:13px 20px;border-radius:12px;background:linear-gradient(90deg,#8b5cf6,#ec4899);color:#fff;text-decoration:none;font-weight:700">Verify email address</a></p>
        <p style="font-size:13px;color:#68708a">This link expires in 1 hour. If you did not create this account, you can ignore this email.</p>
      </div>
    `,
  });
}

module.exports = { sendVerificationEmail };
