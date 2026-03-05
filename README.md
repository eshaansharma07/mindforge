# Mind Forge 2026

Event platform for **AI Alliance x AIT CSE (AIML)**, built for **24 March 2026**.

## Includes

- Attractive event landing page
- Team registration (MongoDB)
- Candidate dashboard:
  - Team lookup
  - Live announcements
  - 60-second rapid quiz interface
  - Fastest-response submission tracking
- Admin/Controller dashboard:
  - View registrations
  - Push announcements
  - Launch/close rapid-round questions
  - Live response leaderboard

## Setup

1. Install deps:

```bash
npm install
```

2. Create `.env`:

```bash
cp .env.example .env
```

3. Fill env values:

- `MONGODB_URI`
- `MONGODB_DB`
- `ADMIN_KEY`

4. Run local:

```bash
npm run dev
```

5. Open:

- `http://localhost:3000` -> Landing + registration
- `http://localhost:3000/candidate.html` -> Candidate dashboard
- `http://localhost:3000/admin.html` -> Admin/controller dashboard

## Deploy

Push to GitHub and import into Vercel. Add the same environment variables in Vercel project settings.
