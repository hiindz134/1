# FB Auto Backend (Render-ready)

This is a Node.js backend to bulk **Private Reply** by `post_id` and to view logs.
It is compliant with Meta policies for comment private replies and 24h messaging.

## Deploy on Render (Web Service)

1. Create a new **Web Service** from this folder on Render.
2. Build command: `npm install`
3. Start command: `npm run render-start`
4. Environment variables (Render → Dashboard → your service → Environment):
   - `PAGE_ACCESS_TOKEN` = your Page token (with pages_messaging, pages_manage_engagement, pages_read_engagement)
   - `VERIFY_TOKEN` = any secret you choose (used when verifying webhook)
   - `APP_SECRET` = your app secret (optional but recommended)
   - `GRAPH_VERSION` = v21.0 (or your app's version)
   - `ALLOW_ORIGIN` = your dashboard origin (e.g. https://dashboard.example.com), or `*` during testing

Render will expose a public URL like: `https://fb-auto-backend.onrender.com`

## Webhook (Meta)
- Callback URL: `https://<your-render-url>/webhook`
- Verify Token: the same `VERIFY_TOKEN`
- Subscribe: `messages`, `messaging_postbacks`, `messaging_optins`
- Then **Subscribe Page to App**.

## API Endpoints
- `GET /` → health
- `GET /api/posts/:postId/comments` → list comments
- `POST /api/private-replies` → body: `{ "post_id": "<POST_ID>", "message": "text" }`
- `GET /api/logs` → recent logs
- (optional) `POST /api/send/inbox` → body: `{ "psid": "...", "text": "..." }` (within 24h window)

## Notes
- Private Reply: one message per `comment_id`.
- Likes (reactions) cannot be messaged unless a valid thread exists or user opted-in.
- SQLite file `db.sqlite` is created locally on the instance (reset on redeploy).
