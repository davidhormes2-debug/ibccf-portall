# Deploying IBCCF to Railway

Railway is the easiest way to deploy this application with a built-in PostgreSQL database.

## Step 1: Create Railway Account

1. Go to [railway.app](https://railway.app)
2. Sign up with your GitHub account (recommended)

## Step 2: Deploy from GitHub

1. Push your code to a GitHub repository (or download from Replit and upload)
2. In Railway dashboard, click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Choose your repository
5. Railway will auto-detect it's a Node.js app

## Step 3: Add PostgreSQL Database

1. In your project, click **"+ New"**
2. Select **"Database"** → **"PostgreSQL"**
3. Railway creates the database instantly

## Step 4: Connect Database to App

1. Click on your web service
2. Go to **"Variables"** tab
3. Click **"Add Variable"**
4. Add: `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   (Railway will auto-fill this from your database)

## Step 5: Add Other Environment Variables

Add these variables in the Variables tab:

| Variable | Value |
|----------|-------|
| `SESSION_SECRET` | Any random string (e.g., `my-super-secret-key-2024`) |
| `NODE_ENV` | `production` |
| `OPENAI_API_KEY` | Your OpenAI API key (optional, for AI features) |

## Step 6: Configure Build Settings

In your service settings:
- **Build Command:** `npm run build`
- **Start Command:** `npm start`
- **Root Directory:** `/` (leave empty)

## Step 7: Deploy

Railway will automatically:
1. Install dependencies
2. Build your app
3. Start the server
4. Provide you with a public URL

## Step 8: Initialize Database

After first deployment, you may need to push the database schema:

1. In Railway, go to your PostgreSQL service
2. Copy the connection string
3. Run locally: `DATABASE_URL="your-railway-url" npm run db:push`

Or use Railway CLI:
```bash
npm i -g @railway/cli
railway login
railway link
railway run npm run db:push
```

## Your App URLs

After deployment:
- **Main site:** `https://your-app.up.railway.app`
- **Admin panel:** `https://your-app.up.railway.app/admin`

## Admin Credentials

- **Username:** Admin2025
- **Password:** Admin123456789
- **Demo User Code:** 774982

**Important:** Change these after first login!

## Estimated Cost

~$12/month for:
- Web service (~$8)
- PostgreSQL database (~$4)

Railway uses usage-based pricing, so costs scale with traffic.

## Custom Domain (Optional)

1. Go to your service settings
2. Click **"Settings"** → **"Networking"**
3. Add your custom domain
4. Update your domain's DNS to point to Railway
