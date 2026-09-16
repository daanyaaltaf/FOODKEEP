# Foodkeep — Backend

Personal food & waste tracker. This adds a complete backend to the single-page
frontend: real user accounts, sessions and a SQLite database instead of
browser localStorage.

## Stack

- **Node.js** (≥ 22.5, built-in `node:sqlite` — no native compilation needed)
- **Express** — HTTP server + REST API
- **bcryptjs** — password hashing
- **SQLite** (WAL mode) — stored in `data/foodkeep.db`

## Run it

```bash
npm install
npm start          # → http://localhost:3000
```

Dev mode with auto-restart on file changes:

```bash
npm run dev
```

Environment variables (all optional):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `FOODKEEP_DB_PATH` | `./data/foodkeep.db` | SQLite file location |
| `FOODKEEP_DATA_DIR` | `./data` | Fallback dir for the DB |
| `FOODKEEP_SESSION_DAYS` | `30` | Session cookie lifetime (days) |

## API

All endpoints are JSON. Auth uses an httpOnly `foodkeep_session` cookie
(64-hex-char token, server-side session table).

### Auth (`/api/auth`)

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/signup` | `{name, email, password}` | 409 if email exists |
| POST | `/login` | `{email, password}` | bcrypt compare |
| POST | `/guest` | — | shared demo account, seeded with sample data on first use |
| POST | `/logout` | — | deletes the server session |
| GET | `/me` | — | current user from session cookie |

### Data (`/api`, requires session)

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/pantry` | — | sorted by expiry |
| POST | `/pantry` | `{name, category, qty, unit, cost, purchaseDate, expiryDate}` | validates category/dates |
| GET | `/waste` | — | sorted by date desc |
| POST | `/waste` | `{name, category, reason, qty, unit, cost, date, note, pantryItemId?}` | **transactional**: clamps qty to the pantry item, decrements or removes it in the same transaction |
| DELETE | `/waste/:id` | — | undo |
| GET | `/saved` | — | "used it up" history |
| POST | `/saved` | `{pantryItemId}` or `{name, cost}` | removes the pantry item atomically |
| GET | `/insights` | — | month totals, by-category/by-reason breakdown, projected annual cost, days since last toss |
| GET | `/recipes` | — | recipe ideas matched against the pantry (`?itemId=` for one item) |
| GET | `/health` | — | liveness check |

Categories: `Produce, Dairy & Eggs, Meat & Seafood, Grains & Bakery,
Pantry Staples, Leftovers, Beverages`.
Waste reasons: `Spoiled, Expired, Cooked too much, Forgot it was there,
Didn't like it, Other`.

## Structure

```
server.js         Express app: static hosting + /api routers
db.js             node:sqlite connection, schema, prepared queries
seed.js           Guest demo dataset
recipes.js        Recipe keyword dataset + matcher (shared logic)
routes/auth.js    Signup / login / guest / logout / me, sessions, cookie handling
routes/data.js    Pantry / waste / saved CRUD + insights + recipes
data/foodkeep.db  SQLite database (created on first run, gitignored)
index.html        Frontend (now API-backed)
```

## Security notes

- Passwords are bcrypt-hashed (cost 10); login uses a dummy-hash compare when
  the account doesn't exist to keep timing uniform.
- Session tokens are 256-bit random, stored server-side, httpOnly + SameSite=Lax.
- All data queries are scoped by `user_id`; IDs are opaque random hex.
- For production behind HTTPS, add `Secure` to the session cookie.
