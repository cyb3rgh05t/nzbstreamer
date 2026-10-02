# UsenetStreamer - Windows Native Setup Guide

> **🎯 Beginner Friendly** | **📋 Just 1 Command** | **🖱️ All Configuration via Web UI**
>
> This guide requires only **one terminal command** - everything else is done through a user-friendly web interface!

This guide walks you through setting up UsenetStreamer on Windows using Docker Desktop. This setup uses **Windows Native Mode** which streams NZBs directly through Stremio v5 without needing NZBDav or SABnzbd.

## Requirements

- **Windows 10/11** (64-bit)
- **Stremio v5** (Windows Desktop version)
- **Usenet Provider Account** (Easynews, Newshosting, Eweka, etc.)
- **Newznab Indexer Account** (NZBgeek, DrunkenSlug, NZBFinder, etc.)

---

## Part 1: Install Docker Desktop

### Step 1: Download Docker Desktop

1. Go to [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/)
2. Click **"Download for Windows"**
3. Run the installer (`Docker Desktop Installer.exe`)

### Step 2: Install Docker Desktop

1. Follow the installation wizard
2. When prompted, ensure **"Use WSL 2 instead of Hyper-V"** is checked (recommended)
3. Click **Install**
4. Restart your computer when prompted

### Step 3: Start Docker Desktop

1. After restart, Docker Desktop should start automatically
2. If not, search for "Docker Desktop" in the Start menu and open it
3. Wait for Docker to fully start (the whale icon in system tray should stop animating)
4. You may need to accept the Docker terms of service

### Step 4: Enable Auto-Start (Optional but Recommended)

1. Right-click the Docker whale icon in the system tray
2. Click **Settings** (gear icon)
3. Under **General**, ensure **"Start Docker Desktop when you sign in"** is checked
4. Click **Apply & restart**

---

## Part 2: Run UsenetStreamer Container

### Step 1: Open PowerShell

1. Press `Win + X`
2. Click **"Windows Terminal"** or **"PowerShell"**

### Step 2: Create and Run the Container

Copy and paste this command into PowerShell:

```powershell
docker run -d `
  --name usenetstreamer `
  --restart unless-stopped `
  -p 7000:7000 `
  -v usenetstreamer_config:/app/config `
  -e STREAMING_MODE=native `
  -e ADDON_BASE_URL=http://localhost:7000 `
  -e ADMIN_USERNAME=admin `
  -e ADMIN_PASSWORD=ChooseAStrongPassword `
  ghcr.io/sanket9225/usenetstreamer:latest
```

> **📝 Note:** Replace `ChooseAStrongPassword` with a unique password for your admin login.

This will:

- Download the UsenetStreamer image
- Create a container named `usenetstreamer`
- Set it to auto-restart on boot
- Save your configuration so it persists after updates
- Expose port 7000 for the addon
- Enable Windows Native streaming mode
- Protect your admin panel with a username and password

### Step 3: Verify Container is Running

Run this command to check:

```powershell
docker ps
```

You should see `usenetstreamer` in the list with status "Up".

---

## Part 3: Configure UsenetStreamer

### Step 1: Open the Admin Panel

1. Open your web browser
2. Go to: **http://localhost:7000/admin/**
3. Sign in with username `admin` and the `ADMIN_PASSWORD` you set in the docker command.

### Step 2: Configure Streaming Mode

1. At the top of the configuration page, find **"Streaming Mode"**
2. Select **"Windows Native Mode (Stremio v5 Desktop)"**
3. You'll see a notice that Prowlarr/NZBHydra are disabled in this mode

### Step 3: Add Your Newznab Indexer

1. Scroll down to **"Direct Newznab Indexers"**
2. Click the **"Preset"** dropdown and select your indexer (e.g., NZBgeek, DrunkenSlug)
3. Click **"Add from preset"**
4. Fill in your details:
   - **API Key**: Your indexer API key (find this in your indexer's account settings)
   - **Enabled**: Check the box
   - **Paid Indexer**: Check if you have a paid subscription (recommended for health checks)
5. Click **"Test Connection"** to verify it works

> **Tip**: You can add multiple indexers for better coverage!

### Step 4: Configure NNTP Provider (Health Check & Streaming)

These credentials are used for both health checking NZBs AND for streaming in native mode.

1. Scroll down to **"NZB Health Check"**
2. Check **"Enable NZB Health Checks"**
3. Fill in your Usenet provider details:

| Field                         | Example Value       | Notes                                |
| ----------------------------- | ------------------- | ------------------------------------ |
| **Usenet Provider Host**      | `news.easynews.com` | Your provider's NNTP server          |
| **Usenet Provider Port**      | `563`               | Usually 563 for SSL, 119 for non-SSL |
| **Use TLS**                   | ☑️ Checked          | Enable for secure connection         |
| **Username**                  | `your_username`     | Your Usenet account username         |
| **Password**                  | `your_password`     | Your Usenet account password         |
| **Number of NZBs to Inspect** | `6`                 | Higher = more thorough, slower       |
| **Max Usenet Connections**    | `12`                | Stay within your provider's limit    |

4. Click **"Test Connection"** to verify your NNTP credentials work

### Step 5: Configure Addon Settings

1. Scroll down to **"Addon Metadata"**
2. Set **"Public Base URL"** to: `http://localhost:7000`
3. Optionally set an **"Addon Display Name"** (shows in Stremio)

### Step 6: Save Configuration

1. Click **"Save Changes"** at the bottom
2. You should see a success message

---

## Part 4: Install Addon in Stremio

### Step 1: Open Stremio

1. Make sure you have **Stremio v5** installed (download from [stremio.com](https://www.stremio.com/))
2. Open Stremio on your Windows PC

### Step 2: Install the Addon

**Option A: Use the Admin Panel Button**

1. In the admin panel, click **"Install via Stremio Web"** or **"Open in Stremio App"**

**Option B: Manual Install**

1. In Stremio, go to **Settings** → **Addons**
2. Click the search bar or "Add Addon" button
3. Paste this URL: `http://localhost:7000/manifest.json`
4. Click **Install**

### Step 3: Verify Installation

1. In Stremio, search for a movie or TV show
2. You should see results from "UsenetStreamer" (or your custom addon name)
3. Click a stream - it should start playing directly!

---

## Part 5: Verify Auto-Start After Reboot

### Test the Setup

1. Restart your Windows PC
2. Wait for Windows to fully boot
3. Docker Desktop should auto-start (check system tray for whale icon)
4. Open browser and go to: **http://localhost:7000/admin**
5. If the page loads, everything is working!

### If Docker Doesn't Auto-Start

1. Open Docker Desktop manually
2. Go to **Settings** → **General**
3. Enable **"Start Docker Desktop when you sign in"**
4. The container will auto-start with Docker because we used `--restart unless-stopped`

---

## Troubleshooting

### Container Not Starting

Check container logs:

```powershell
docker logs usenetstreamer
```

### Port 7000 Already in Use

Change to a different port:

```powershell
docker stop usenetstreamer
docker rm usenetstreamer
docker run -d --name usenetstreamer --restart unless-stopped -p 7001:7000 -e STREAMING_MODE=native -e ADDON_BASE_URL=http://localhost:7001 ghcr.io/sanket9225/usenetstreamer:latest
```

Then use `http://localhost:7001` everywhere.

### Streams Not Playing

1. Verify NNTP credentials in admin panel with "Test Connection"
2. Make sure you're using **Stremio v5** (not older versions)
3. Check that streams show the health check ✅ indicator

### Reset Configuration

To start fresh:

```powershell
docker stop usenetstreamer
docker rm usenetstreamer
docker volume rm usenetstreamer_config
```

Then re-run the docker run command from Part 2.

---

## Common Usenet Provider Settings

| Provider      | Host                     | SSL Port | Non-SSL Port |
| ------------- | ------------------------ | -------- | ------------ |
| Easynews      | `news.easynews.com`      | 563      | 119          |
| Newshosting   | `news.newshosting.com`   | 563      | 119          |
| Eweka         | `news.eweka.nl`          | 563      | 119          |
| Frugal Usenet | `news.frugalusenet.com`  | 563      | 119          |
| UsenetExpress | `news.usenetexpress.com` | 563      | 119          |
| Ninja         | `news.newsgroup.ninja`   | 563      | 119          |

---

## Quick Reference Commands

```powershell
# View running containers
docker ps

# View container logs
docker logs usenetstreamer

# Stop the container
docker stop usenetstreamer

# Start the container
docker start usenetstreamer

# Restart the container
docker restart usenetstreamer

# Remove the container (to recreate)
docker stop usenetstreamer
docker rm usenetstreamer

# Update to latest version
docker pull ghcr.io/sanket9225/usenetstreamer:latest
docker stop usenetstreamer
docker rm usenetstreamer
# Then re-run the docker run command
```

---

## Need Help?

- Join our [Discord Server](https://discord.gg/Ma4SnagqwE)
- Check the main [README](../README.md) for more details
- Open an issue on [GitHub](https://github.com/Sanket9225/UsenetStreamer/issues)

---

**Enjoy streaming!** 🎬
