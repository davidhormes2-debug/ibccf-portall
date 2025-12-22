# Deploying IBCCF to Hostinger

This guide explains how to deploy the IBCCF application to Hostinger.

## Prerequisites

1. **Hostinger Business or Cloud Plan** - Required for Node.js support
2. **External PostgreSQL Database** - Hostinger doesn't provide PostgreSQL. Use one of:
   - [Neon](https://neon.tech) (Free tier available)
   - [Supabase](https://supabase.com) (Free tier available)
   - [Railway](https://railway.app)

## Step 1: Set Up Your Database

1. Create a free account on [Neon](https://neon.tech)
2. Create a new project and database
3. Copy the connection string (it looks like: `postgresql://user:pass@host/db?sslmode=require`)

## Step 2: Prepare Your Code

### Option A: Deploy via GitHub (Recommended)

1. Push your code to a GitHub repository
2. Make sure these files are in your repo:
   - `package.json` with build and start scripts
   - All source code files

### Option B: Upload as ZIP

1. Run locally first to build:
   ```bash
   npm install
   npm run build
   ```
2. Zip the entire project folder (excluding `node_modules`)

## Step 3: Deploy on Hostinger

1. Log in to [Hostinger hPanel](https://hpanel.hostinger.com)
2. Go to **Websites** → **Add Website** → **Node.js App**
3. Choose your deployment method:
   - **GitHub**: Connect your repository and select the branch
   - **Upload**: Upload your ZIP file

4. Configure the app settings:
   - **Entry point**: `dist/index.cjs`
   - **Node version**: 18 or higher
   - **Build command**: `npm run build`
   - **Start command**: `npm start`

## Step 4: Set Environment Variables

In the Hostinger Node.js app dashboard, add these environment variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Your PostgreSQL connection string from Neon/Supabase |
| `SESSION_SECRET` | A random secret string (generate one at random.org) |
| `OPENAI_API_KEY` | Your OpenAI API key (optional, for AI features) |
| `NODE_ENV` | Set to `production` |

## Step 5: Initialize Database

After the first deployment, you need to set up the database tables:

1. Connect to your database using a tool like [pgAdmin](https://www.pgadmin.org/) or the Neon/Supabase web console
2. The tables will be created automatically when the app first connects

Or run the migration command locally with your production DATABASE_URL:
```bash
DATABASE_URL="your-production-url" npm run db:push
```

## Step 6: Custom Domain (Optional)

1. In Hostinger dashboard, go to your website settings
2. Click **Add Domain**
3. Enter your custom domain
4. Update your domain's DNS to point to Hostinger

## Troubleshooting

### App won't start
- Check the logs in Hostinger dashboard
- Verify all environment variables are set correctly
- Make sure DATABASE_URL has `?sslmode=require` at the end

### Database connection errors
- Verify your database URL is correct
- Check if your database provider allows connections from Hostinger's IP

### Build fails
- Ensure Node.js version is 18+
- Check that all dependencies are listed in package.json

## Admin Access

After deployment, access the admin panel at:
- URL: `https://yourdomain.com/admin`
- Username: `Admin2025`
- Password: `Admin123456789`

**Important**: Change these credentials after first login!

## Support

For issues with:
- **Hostinger hosting**: Contact Hostinger support
- **Database (Neon/Supabase)**: Contact the respective provider
- **Application code**: Review logs and error messages
