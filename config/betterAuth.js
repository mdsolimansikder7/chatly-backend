const mongoose = require("mongoose");
const connectDB = require("./db");

let authPromise;

function getBackendUrl() {
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return (
    process.env.BETTER_AUTH_URL ||
    process.env.API_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    (vercelHost ? `https://${vercelHost}` : `http://localhost:${Number(process.env.PORT) || 5000}`)
  ).replace(/\/+$/, "");
}

async function getBetterAuth() {
  if (!authPromise) {
    authPromise = (async () => {
      const secret = process.env.BETTER_AUTH_SECRET || process.env.JWT_SECRET;
      if (!secret || secret.length < 32) {
        throw new Error("Set BETTER_AUTH_SECRET to at least 32 characters.");
      }
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        throw new Error("Google sign-in is not configured on the backend.");
      }

      await connectDB();
      const [{ betterAuth }, { mongodbAdapter }] = await Promise.all([
        import("better-auth"),
        import("@better-auth/mongo-adapter"),
      ]);
      const database = mongoose.connection.db;
      if (!database) throw new Error("MongoDB is not connected.");

      const frontendOrigins = [
        process.env.CLIENT_URL,
        process.env.FRONTEND_URL,
        "http://localhost:5173",
        "https://chatly-message.vercel.app",
      ].filter(Boolean).map((origin) => origin.replace(/\/+$/, ""));
      const production = process.env.NODE_ENV === "production";

      return betterAuth({
        appName: "Chatly",
        baseURL: getBackendUrl(),
        basePath: "/api/better-auth",
        secret,
        database: mongodbAdapter(database, {
          client: mongoose.connection.getClient(),
        }),
        trustedOrigins: [...new Set(frontendOrigins)],
        socialProviders: {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            scope: ["openid", "email", "profile"],
          },
        },
        account: {
          encryptOAuthTokens: true,
          accountLinking: {
            enabled: true,
            trustedProviders: ["google"],
            allowDifferentEmails: false,
          },
        },
        advanced: {
          defaultCookieAttributes: {
            sameSite: production ? "none" : "lax",
            secure: production,
          },
        },
      });
    })().catch((error) => {
      authPromise = undefined;
      throw error;
    });
  }

  return authPromise;
}

module.exports = { getBackendUrl, getBetterAuth };
