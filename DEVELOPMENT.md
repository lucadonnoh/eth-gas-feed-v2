# Development Guide

## Local Testing Workflow

**Always test locally before pushing to production!**

### Quick Test (Automated)

Run the automated test script:

```bash
./test-local.sh
```

This will:
1. Run `npm run build` to catch TypeScript/ESLint errors
2. Run database migration
3. Test API endpoints
4. Report success or failure

### Manual Testing (Full Application)

Test the complete application with live data:

**Terminal 1 - Ingestion Service:**
```bash
npm run ingest
```

Wait for:
- `✓ Database connected`
- `✅ Ingestion service running`
- `✓ Block XXXXXXX inserted`

**Terminal 2 - Next.js Dev Server:**
```bash
npm run dev
```

Wait for:
- `✓ Ready in XXXXms`

**Browser:**
Open http://localhost:3001 (or the port shown in Terminal 2)

**What to verify:**
- [ ] Page loads without errors
- [ ] No WebSocket errors in browser console
- [ ] Charts display data
- [ ] Block number updates every ~12 seconds
- [ ] Last update timestamp shows green and recent
- [ ] Priority fees load when hovering over blocks

### Testing Specific Changes

**Database changes:**
```bash
npm run migrate  # Apply schema changes
```

**API changes:**
```bash
curl http://localhost:3001/api/blocks | jq
curl http://localhost:3001/api/blocks?after=23970000 | jq
```

**Frontend changes:**
```bash
npm run dev  # Auto-reloads on file changes
```

**Ingestion logic:**
```bash
npm run ingest  # Watch logs for errors
```

## Pre-Push Checklist

Before pushing to production:

- [ ] `npm run build` passes with no errors
- [ ] Tested manually with `npm run dev` and `npm run ingest`
- [ ] No console errors in browser
- [ ] Block data updates in real-time
- [ ] All charts render correctly

## Environment Variables

Required in `.env.local` for local development:

```bash
DATABASE_URL=postgresql://...  # Railway Postgres public URL
ETH_WS_RPC_URL=wss://...       # Alchemy WebSocket URL
HTTPS_ETH_RPC_URL=https://...  # Alchemy HTTPS URL
```

## Deployment

The project auto-deploys to Railway when you push to `main`:

- **Web service**: Runs `npm run start` (Next.js production server)
- **Ingest service**: Runs `npm run ingest` (WebSocket block listener)

Both services connect to the same Railway Postgres database.

## Troubleshooting

**Port 3000 in use:**
Next.js will automatically use port 3001. Check the terminal output for the actual port.

**Database connection failed:**
Make sure your `DATABASE_URL` in `.env.local` points to the Railway public URL.

**No blocks in database:**
Wait a few seconds for the ingestion service to backfill initial blocks.

**WebSocket errors:**
Make sure you're testing the v2 code, not v1. Check that there's no `import { ethers }` in `src/app/page.tsx`.
