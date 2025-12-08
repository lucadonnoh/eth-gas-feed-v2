# Ethereum Gas Feed v2 - Railway Edition

Real-time Ethereum gas monitoring with persistent storage.

## Architecture

- **Ingestion Service** (`services/ingestion.js`): WebSocket listener that writes blocks to PostgreSQL
- **Next.js Frontend**: Polls database for historical data
- **Database**: PostgreSQL (Railway or Neon)

## Deployment to Railway

### 1. Create Railway Account
- Go to https://railway.app
- Sign up (free $5/month credit)

### 2. Create New Project
- Click **New Project**
- Select **Deploy from GitHub repo**
- Connect your GitHub account
- Select this repository

### 3. Add PostgreSQL Database
- In your Railway project, click **New** → **Database** → **Add PostgreSQL**
- Railway will automatically set `DATABASE_URL` environment variable

### 4. Run Database Schema
- Go to your PostgreSQL service → **Data** tab
- Run the contents of `schema.sql`

### 5. Add Environment Variables
Click on your service → **Variables** tab:

```bash
# Ethereum RPC
ETH_WS_RPC_URL=wss://your-alchemy-or-infura-websocket-url

# Optional: for priority fee analysis
HTTPS_ETH_RPC_URL=https://your-alchemy-or-infura-https-url
```

### 6. Create Two Services

Railway needs two separate services in the same project:

#### Service 1: Ingestion (Background Worker)
- **Start Command**: `npm run ingest`
- **Name**: `ingestion-service`
- Uses `DATABASE_URL` and `ETH_WS_RPC_URL`

#### Service 2: Web App (Frontend)
- **Start Command**: `npm run start`
- **Name**: `web`
- Uses `DATABASE_URL` and `HTTPS_ETH_RPC_URL`
- Railway will auto-assign a public domain

### 7. Deploy
- Push to GitHub
- Railway will automatically deploy both services

## Local Development

1. Install dependencies:
```bash
npm install
```

2. Create `.env.local`:
```bash
DATABASE_URL=postgresql://...
ETH_WS_RPC_URL=wss://...
HTTPS_ETH_RPC_URL=https://...
```

3. Run database schema:
```bash
psql $DATABASE_URL < schema.sql
```

4. Start ingestion service (in one terminal):
```bash
npm run ingest
```

5. Start Next.js dev server (in another terminal):
```bash
npm run dev
```

## Alternative: Using Neon + Railway

If you already have Neon Postgres:
1. Skip step 3 (Railway database)
2. Add your Neon connection string as `DATABASE_URL`
3. Run schema in Neon dashboard

## Monitoring

- Ingestion service logs show blocks being processed
- Check PostgreSQL for block count: `SELECT COUNT(*) FROM blocks;`
- Frontend should update every ~12 seconds

## Cost Estimate

Railway free tier ($5/month credit):
- Ingestion service: ~$3/month
- Web service: ~$2/month
- Total: Within free tier

If using external Neon Postgres, it's completely free.
