# Deploying the Chatly API to Vercel

The backend now exports an Express app from `index.js` for Vercel and keeps `server.js` for local or long-running Node deployments.

## Vercel project

1. Import the `mdsolimansikder7/chatly-backend` repository as a new Vercel project.
2. Set the project root to the repository root (the folder containing this `package.json`).
3. Select the Express framework preset. Leave the build command and output directory at their detected defaults; do not set a static output directory.
4. Add the environment variables below to Production and Preview as needed, then redeploy.

Required backend environment variables:

- `MONGO_URI`: MongoDB connection string. For Atlas, use a dedicated database user with a strong password. Vercel functions do not have a stable outbound IP on all plans; if Atlas requires network allowlisting, use Vercel Secure Compute/static egress where available rather than opening database access broadly.
- `JWT_SECRET`: a long, random signing secret.
- `CLIENT_URL`: the exact deployed frontend origin, such as `https://chatly-message.vercel.app` (no trailing slash).
- `API_BASE_URL`: the stable production API origin, such as `https://chatly-backend-pi.vercel.app` (no trailing slash).
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` for Google sign-in.
- `FACEBOOK_CLIENT_ID` and `FACEBOOK_CLIENT_SECRET` for Facebook sign-in if Facebook login is enabled.

Optional variables:

- `FRONTEND_URL`: an additional allowed frontend origin.
- `GOOGLE_CALLBACK_URL` and `FACEBOOK_CALLBACK_URL`: set only when overriding the callback URL. Otherwise the API origin above is used.

Set `VITE_API_URL` in the separate frontend Vercel project to the backend origin (for example `https://chatly-backend-pi.vercel.app`), then redeploy the frontend. This variable is embedded at frontend build time.

Register these exact redirect URLs in each provider's developer console:

- `https://chatly-backend-pi.vercel.app/api/auth/google/callback`
- `https://chatly-backend-pi.vercel.app/api/auth/facebook/callback`

The Google OAuth consent screen must also include the deployed frontend domain as an authorized domain. Keep client secrets only in backend Vercel environment variables.

## Verify a deployment

- `https://chatly-backend-pi.vercel.app/health` should return `{"status":"ok"}`.
- `https://chatly-backend-pi.vercel.app/api/auth/google` should redirect to Google's sign-in page once both Google credentials are configured.
- Registration and login use the MongoDB database and require `MONGO_URI` and `JWT_SECRET`.

## Important Vercel limitations

- Vercel Functions do not host this app's persistent Socket.IO server. REST endpoints and OAuth can run, but realtime chat events, online presence, and calls will not work with the Vercel API alone. Keep the Socket.IO service on a persistent WebSocket-capable host or migrate realtime features to a hosted service before switching the frontend's socket connection to Vercel.
- The existing upload code writes files to the function's temporary `/tmp` directory on Vercel. That storage is ephemeral and is not reliable for files that must remain available across requests or deployments. Use object storage (for example, S3-compatible storage or Cloudinary) for durable uploads.
- The API uses MongoDB and connects on demand. Keep database connection limits appropriate for serverless concurrency.
- Email-verification delivery is not part of the current signup flow; SMTP/Brevo variables are not needed for signup.
