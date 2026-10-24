# Google sign-in with Better Auth

Better Auth manages Google OAuth and stores its user/session records in MongoDB. Chatly exchanges the verified Better Auth session for its existing API JWT after the browser returns to `/oauth/callback`.

## Production configuration

Configure the backend Vercel project with:

- `MONGO_URI`
- `JWT_SECRET`
- `BETTER_AUTH_SECRET` (at least 32 random characters; falls back to `JWT_SECRET`)
- `BETTER_AUTH_URL=https://chatly-message.vercel.app`
- `CLIENT_URL=https://chatly-message.vercel.app`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

The frontend Vercel project needs `VITE_API_URL=https://chatly-backend-pi.vercel.app` for regular Chatly API calls. Its `vercel.json` proxies Better Auth requests and the session exchange endpoint through the frontend origin so the OAuth state cookie remains first-party.

In Google Cloud Console, set the Authorized redirect URI to exactly:

`https://chatly-message.vercel.app/api/better-auth/callback/google`

For local development, set `BETTER_AUTH_URL=http://localhost:5173` and register:

`http://localhost:5173/api/better-auth/callback/google`

Redeploy the backend after changing backend environment variables and redeploy the frontend after changing its rewrite configuration or `VITE_API_URL`.

## Why the same-origin proxy is needed

The frontend and API use different Vercel hostnames. OAuth begins in the browser and must preserve Better Auth's state cookie until Google sends the browser back. Privacy-focused browsers may block cookies set by cross-site API requests, causing `state_mismatch`. Routing Better Auth through the frontend's own origin keeps the cookie first-party. On success, the browser returns to the frontend `/oauth/callback`, exchanges the session, and navigates to `/chat`.
