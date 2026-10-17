# env

Templates for the environment variables this app needs. Only the `*.example` files are committed.

| File | Use |
| --- | --- |
| `.env.example` | App settings. Copy to the project root: `cp env/.env.example .env.local` |
| `.env.verify-realtime.example` | For `.verify-realtime.mjs`. Copy to `env/.env.verify-realtime` and run `node --env-file=env/.env.verify-realtime .verify-realtime.mjs` |

Next.js reads `.env*` files only from the project root, so the app's real values go in `/.env.local`, not here. On Vercel, set the same keys in Project Settings → Environment Variables (or `vercel env pull .env.local`).
