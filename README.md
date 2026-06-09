# Phimai SmartFlow AI

FastAPI backend, static visitor site, staff dashboard, LINE alerts, and a local RTSP AI worker for crowd counting.

## Architecture Report

Render should run only the public web/API service:

```text
RTSP Cameras
  -> Local AI Service (count.py, runs on the camera LAN)
  -> POST /api/local/counts
  -> Render FastAPI Backend
  -> PostgreSQL + Dashboard + LINE Notifications
```

Keep RTSP processing local. Most cameras are on private IP addresses, and Render cannot reach `192.168.x.x` camera networks. The Render service stores camera settings, receives counts, serves dashboards, runs analytics, and sends LINE notifications.

## Deployment Blockers Found

- Hardcoded RTSP URL and credentials in `server.py` and `count.py`.
- Hardcoded LINE access token fallback in `server.py`.
- Dashboard JavaScript used `hostname:8000`, which breaks behind Render HTTPS.
- Local CSV/JSON files were used for visitor logs and LINE target state.
- No `requirements.txt`, `render.yaml`, health check, or documented start command.
- Camera processing started inside the web process on startup, which can block cloud deploys and cannot reach private cameras.
- The local repo folder is not a Git working copy, although the upstream repo is `https://github.com/tanth123-h/phimai`.

## Required Environment Variables

Render web service:

- `DATABASE_URL`: Render PostgreSQL connection string.
- `PORT`: provided by Render.
- `ENABLE_CAMERA_WORKER=false`: keep false on Render.
- `LOCAL_INGEST_TOKEN`: shared token used by the local AI worker.
- `LINE_CHANNEL_ACCESS_TOKEN`: LINE Messaging API channel token.
- `LINE_TARGET_ID`: group, room, or user ID for push messages. Optional if captured through webhook.
- `LINE_ALERT_COOLDOWN_SECONDS=300`
- `LOG_LEVEL=INFO`
- `CORS_ALLOW_ORIGINS=*`

Local AI worker:

- `RENDER_API_URL=https://your-render-service.onrender.com`
- `LOCAL_INGEST_TOKEN`: same value as Render.
- `RTSP_URL=rtsp://user:password@private-camera-ip:554/stream2`
- `CAMERA_ID=main-prang`
- `CAMERA_NAME=ปรางค์ประธาน`
- `CAMERA_LIMIT=30`
- `YOLO_MODEL_PATH=yolov8m.pt`

## Render Commands

Build command:

```bash
pip install -r requirements.txt
```

Start command:

```bash
uvicorn server:app --host 0.0.0.0 --port $PORT
```

Health check path:

```text
/healthz
```

## Database Migration Plan

The app creates tables automatically on startup when `DATABASE_URL` exists. For manual setup, run:

```bash
psql "$DATABASE_URL" -f migrations/001_render_init.sql
```

Tables:

- `cameras`: dashboard-editable camera metadata and RTSP URL.
- `visitor_logs`: PostgreSQL replacement for `visitor_history_log.csv`.
- `app_settings`: LINE target and small operational settings.

## Deployment Checklist

1. Push this repo to GitHub.
2. Create a Render PostgreSQL database.
3. Create a Render web service from the repo or use `render.yaml`.
4. Set the environment variables above.
5. Deploy and confirm `/healthz` returns `{"ok": true}`.
6. Open `/staff/` and save camera metadata in the camera settings panel.
7. Configure LINE webhook URL as `https://your-render-service.onrender.com/api/line/webhook`.
8. Add the LINE bot to the target group and send one message, or set `LINE_TARGET_ID`.
9. On the local camera machine, install `requirements-local.txt` and run `count.py`.
10. Confirm `/api/counts` shows live counts and the staff dashboard updates.

## Local AI Service

```bash
pip install -r requirements-local.txt
set RENDER_API_URL=https://your-render-service.onrender.com
set LOCAL_INGEST_TOKEN=the-same-token-from-render
set RTSP_URL=rtsp://user:password@camera-private-ip:554/stream2
python count.py
```

On macOS/Linux use `export` instead of `set`.
