# Google and Facebook sign-in setup

Chatly supports email/password accounts without an email-verification link, plus Google and Facebook OAuth sign-in. OAuth accounts are authenticated by the provider; Chatly never receives the user's provider password.

## Backend environment

Set these variables on the backend host:

- `CLIENT_URL`: the deployed frontend origin, for example `https://chatly-message.vercel.app`
- `API_BASE_URL`: the public backend origin. Render also provides `RENDER_EXTERNAL_URL`.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` for Google sign-in
- `FACEBOOK_CLIENT_ID` and `FACEBOOK_CLIENT_SECRET` for Facebook sign-in
- Optional `GOOGLE_CALLBACK_URL` and `FACEBOOK_CALLBACK_URL` overrides

Register these callback URLs with the providers (replace the host if the backend URL differs):

- `https://chatly-backend-514y.onrender.com/api/auth/google/callback`
- `https://chatly-backend-514y.onrender.com/api/auth/facebook/callback`

The callback URL configured in the provider console must exactly match the URL used by Chatly. Restart/redeploy the backend after adding credentials.

## Google

Create an OAuth 2.0 Web application credential in Google Cloud Console, enable the Google identity APIs required by the consent screen, add the frontend domain as an authorized JavaScript origin, and add the Google callback above as an authorized redirect URI. Google sign-in requires a provider-verified email.

## Facebook

Create a Facebook Login app, enable the email and public-profile permissions, add the callback above as a Valid OAuth Redirect URI, and set the app's website domain to the frontend domain. Facebook may not return an email for every account; those users cannot create a Chatly account with Facebook until the provider supplies one. Facebook sign-in authenticates the Facebook account, but Facebook's email field is not treated as proof of mailbox control. If an email already belongs to a separate Chatly account, sign in to that account first; Facebook does not automatically link accounts by email.

Store client secrets only in the backend host's environment settings. Do not put provider secrets in Vercel frontend variables or commit them to source control.
