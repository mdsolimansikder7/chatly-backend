# Google sign-in with Better Auth

Chatly uses Better Auth for Google OAuth and bridges a successful Better Auth session into the existing Chatly JWT session used by chat APIs.

## Backend environment

Set these on the backend deployment:

- `MONGO_URI`
- `JWT_SECRET`
- `BETTER_AUTH_SECRET` (random secret, at least 32 characters; falls back to `JWT_SECRET` if omitted)
- `BETTER_AUTH_URL` (backend origin, e.g. `https://chatly-backend-pi.vercel.app`)
- `CLIENT_URL` (frontend origin, e.g. `https://chatly-message.vercel.app`)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Register this exact Authorized redirect URI in Google Cloud Console:

`https://chatly-backend-pi.vercel.app/api/better-auth/callback/google`

For local development, use:

`http://localhost:5000/api/better-auth/callback/google`

The frontend Vercel project needs `VITE_API_URL=https://chatly-backend-pi.vercel.app`. Redeploy the backend after changing backend environment variables and rebuild/redeploy the frontend after changing its Vite variable.

## Flow

The frontend starts Better Auth's Google social sign-in, Better Auth validates the provider response and stores the auth session in MongoDB, then the callback exchanges that verified session for Chatly's existing API token. Google email verification is handled by Google's OAuth identity response; no verification email is sent.

Better Auth cookies are configured for secure cross-origin use in production, and the backend allows credentialed requests only from configured frontend origins.
