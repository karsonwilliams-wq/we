# Render Chat (Socket.IO + SQLite)

Quick overview
- Node server with Socket.IO + SQLite stores channels, messages, reactions.
- Single-file client served from / (public/index.html).
- Passcode is enforced server-side: set env var PASSCODE. Users log in with that passcode and receive a session cookie.
- Deploy to Render (recommended) or run locally.

Local run
1. Install Node 18+, clone repo.
2. npm install
3. Set env vars locally:
   - PASSCODE="your-passcode"
   - SESSION_SECRET="random-secret"
4. npm start
5. Open http://localhost:3000

Deploy to Render
1. Push this project to GitHub.
2. Create a new Web Service on Render:
   - Connect your GitHub repo
   - Build command: (leave default) or `npm install`
   - Start command: `npm start`
   - Environment variables:
     - PASSCODE — your chosen passcode
     - SESSION_SECRET — random secret for session signing
   - Instance type: free or as needed (enable persistent disk on paid plans if you need SQLite persistence across restarts)
3. Deploy. Open the provided URL.

Important notes
- SQLite file is stored in the app directory on the instance. On Render free instances the disk is ephemeral across deploys or restarts; for stable persistence use Render Persistent Disks (paid) or switch to PostgreSQL.
- If you expect many messages or heavy usage, use a managed DB (Postgres) and adapt the server to use it instead of SQLite.
- To secure against abuse, consider adding rate limits, moderation, or requiring invites.

If you want, I can:
- Prepare a GitHub repo for you (you’ll need to grant me paste, I’ll give you the files to paste)
- Add a Dockerfile and Render service settings for container deploy
- Replace SQLite with PostgreSQL and give Render Postgres config instructions

Ready to proceed?
- If you want, I can produce a single archive (zip) of all files so you can push to GitHub quickly — say “zip files”.
- If you want me to adapt this to use PostgreSQL (recommended for persistence on Render) I can modify server.js to use pg and provide env var instructions.  