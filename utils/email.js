function escapeHtml(value) {
  return String(value || "").replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character],
  );
}

// EMAIL_FROM যদি "Chatly <a@b.com>" ধরনের হয়, শুধু a@b.com নেবে
function getSenderEmail() {
  const from = process.env.EMAIL_FROM || "";
  const match = from.match(/<(.+)>/);
  return match ? match[1].trim() : from.trim();
}

async function sendVerificationEmail({ email, name, token }) {
  const { BREVO_API_KEY } = process.env;
  const senderEmail = getSenderEmail();

  if (!BREVO_API_KEY || !senderEmail) {
    throw new Error(
      "Email service is not configured. Add BREVO_API_KEY and EMAIL_FROM.",
    );
  }

  const clientUrl = (
    process.env.CLIENT_URL ||
    process.env.FRONTEND_URL ||
    "http://localhost:5173"
  ).replace(/\/$/, "");
  const verificationUrl = `${clientUrl}/verify-email?token=${encodeURIComponent(token)}`;

  // SMTP না, সাধারণ HTTPS request (port 443), তাই Render free plan-এও চলবে
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: "Chatly", email: senderEmail },
      to: [{ email, name }],
      subject: "Verify your Chatly email address",
      textContent: `Hi ${name}, verify your Chatly account by opening this link: ${verificationUrl}. This link expires in 1 hour.`,
      htmlContent: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#20213a">
          <h1 style="margin:0 0 12px;color:#8b5cf6">Welcome to Chatly</h1>
          <p>Hi ${escapeHtml(name)},</p>
          <p>Confirm your email address to activate your Chatly account. You cannot log in until it is verified.</p>
          <p style="margin:28px 0"><a href="${verificationUrl}" style="display:inline-block;padding:13px 20px;border-radius:12px;background:linear-gradient(90deg,#8b5cf6,#ec4899);color:#fff;text-decoration:none;font-weight:700">Verify email address</a></p>
          <p style="font-size:13px;color:#68708a">This link expires in 1 hour. If you did not create this account, you can ignore this email.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Brevo email failed (${response.status}): ${details}`);
  }
}

module.exports = { sendVerificationEmail };
