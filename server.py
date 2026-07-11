"""
SmartFlow AI local backend.

Run this on the machine that can access the RTSP cameras, then expose it with
ngrok when you need a public URL.
"""

import asyncio
import csv
import json
import logging
import os
import threading
import time
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
import atexit

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import cv2
from vpn_manager import VPNManager

# เริ่มต้นระบบจัดการ VPN อัตโนมัติ
vpn_manager = VPNManager()
atexit.register(vpn_manager.stop_monitoring)
from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from ultralytics import YOLO


logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("smartflow")

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR))
DATA_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_CAMERA_LIMIT = int(os.getenv("DEFAULT_CAMERA_LIMIT", "15"))
ENABLE_CAMERA_WORKER = os.getenv("ENABLE_CAMERA_WORKER", "true").lower() in {"1", "true", "yes", "on"}
LINE_CHANNEL_ACCESS_TOKEN = os.getenv("LINE_CHANNEL_ACCESS_TOKEN")
LINE_TARGET_ID = os.getenv("LINE_TARGET_ID")
LINE_VENDOR_TARGET_ID = os.getenv("LINE_VENDOR_TARGET_ID")
LINE_ALERT_COOLDOWN_SECONDS = int(os.getenv("LINE_ALERT_COOLDOWN_SECONDS", "300"))
YOLO_MODEL_PATH = os.getenv("YOLO_MODEL_PATH", str(BASE_DIR / "yolov8m.pt"))
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

CAMERA_CONFIG_FILE = DATA_DIR / "camera_config.json"
LOG_FILE_PATH = DATA_DIR / "visitor_history_log.csv"
LINE_CONFIG_FILE = DATA_DIR / "line_alert_config.json"
LINE_LAST_WEBHOOK_FILE = DATA_DIR / "line_last_webhook.json"

os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = os.getenv("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")
os.environ["OPENCV_FFMPEG_LOGLEVEL"] = os.getenv("OPENCV_FFMPEG_LOGLEVEL", "16")

DEFAULT_CAMERAS = [
    {
        "id": "main-prang",
        "name": "ปรางค์ประธาน",
        "url": os.getenv("CAMERA_MAIN_PRANG_RTSP_URL", ""),
        "limit": DEFAULT_CAMERA_LIMIT,
        "enabled": True,
    },
    {
        "id": "south-gopura",
        "name": "โคปุระทิศใต้",
        "url": os.getenv("CAMERA_SOUTH_GOPURA_RTSP_URL", ""),
        "limit": DEFAULT_CAMERA_LIMIT,
        "enabled": True,
    },
]

app = FastAPI(title="Phimai SmartFlow AI Local")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

zone_data = {}
latest_frames = {}
last_logged_count = {}
last_line_alert_at = {}
camera_threads = {}
model = None
line_alerts_sent = 0
vendor_line_alerts_sent = 0
db_ready = False


def load_camera_config():
    if CAMERA_CONFIG_FILE.exists():
        try:
            with CAMERA_CONFIG_FILE.open("r", encoding="utf-8") as file:
                cameras = json.load(file)
            return {
                item["id"]: {
                    "id": item["id"],
                    "name": item.get("name", item["id"]),
                    "url": item.get("rtsp_url") or item.get("url") or "",
                    "limit": int(item.get("limit", DEFAULT_CAMERA_LIMIT)),
                    "enabled": bool(item.get("enabled", True)),
                }
                for item in cameras
            }
        except Exception as exc:
            logger.warning("Cannot read camera_config.json: %s", exc)

    return {camera["id"]: dict(camera) for camera in DEFAULT_CAMERAS}


def save_camera_config(cameras):
    payload = []
    for camera in cameras.values():
        payload.append(
            {
                "id": camera["id"],
                "name": camera["name"],
                "rtsp_url": camera.get("url", ""),
                "limit": int(camera.get("limit", DEFAULT_CAMERA_LIMIT)),
                "enabled": bool(camera.get("enabled", True)),
            }
        )
    with CAMERA_CONFIG_FILE.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)


def get_cameras():
    return load_camera_config()


def upsert_camera(camera):
    camera_id = str(camera.get("id", "")).strip()
    name = str(camera.get("name", "")).strip()
    if not camera_id or not name:
        raise HTTPException(status_code=400, detail="Camera id and name are required")

    cameras = get_cameras()
    existing = cameras.get(camera_id, {})
    rtsp_url = camera.get("rtsp_url") or camera.get("url") or existing.get("url", "")
    item = {
        "id": camera_id,
        "name": name,
        "url": rtsp_url,
        "limit": int(camera.get("limit") or camera.get("camera_limit") or existing.get("limit") or DEFAULT_CAMERA_LIMIT),
        "enabled": bool(camera.get("enabled", existing.get("enabled", True))),
    }
    cameras[camera_id] = item
    save_camera_config(cameras)
    zone_data.setdefault(
        camera_id,
        {
            "name": item["name"],
            "count": 0,
            "limit": item["limit"],
            "density": "unknown",
            "online": False,
            "timestamp": None,
        },
    )

    if ENABLE_CAMERA_WORKER and item["enabled"] and item["url"] and camera_id not in camera_threads:
        start_camera_thread(camera_id, item)

    return item


def normalize_database_url(url):
    if url.startswith("postgres://"):
        return "postgresql://" + url[len("postgres://"):]
    return url


def get_db_connection():
    if not DATABASE_URL:
        return None
    try:
        import psycopg
    except ImportError:
        logger.warning("DATABASE_URL is set but psycopg is not installed")
        return None
    return psycopg.connect(normalize_database_url(DATABASE_URL))


def init_database():
    global db_ready
    db_ready = False
    if not DATABASE_URL:
        logger.info("DATABASE_URL not set; visitor history will use CSV only")
        return
    try:
        conn = get_db_connection()
        if conn is None:
            return
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS visitor_counts (
                        id BIGSERIAL PRIMARY KEY,
                        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        zone_id TEXT NOT NULL,
                        zone_name TEXT,
                        people_count INTEGER NOT NULL,
                        limit_count INTEGER,
                        density TEXT,
                        online BOOLEAN DEFAULT TRUE,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS idx_visitor_counts_recorded_at ON visitor_counts (recorded_at DESC)"
                )
                cur.execute(
                    "CREATE INDEX IF NOT EXISTS idx_visitor_counts_zone_time ON visitor_counts (zone_id, recorded_at DESC)"
                )
            conn.commit()
        db_ready = True
        logger.info("PostgreSQL visitor history ready")
    except Exception as exc:
        logger.exception("Cannot initialize PostgreSQL visitor history; falling back to CSV: %s", exc)


def save_visitor_log_to_db(zone_id, current_count):
    if not db_ready:
        return
    camera = get_cameras().get(zone_id, {})
    limit = int(camera.get("limit", DEFAULT_CAMERA_LIMIT))
    try:
        conn = get_db_connection()
        if conn is None:
            return
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO visitor_counts
                        (recorded_at, zone_id, zone_name, people_count, limit_count, density, online)
                    VALUES
                        (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        datetime.now(),
                        zone_id,
                        camera.get("name", zone_id),
                        int(current_count),
                        limit,
                        get_density(int(current_count), limit),
                        True,
                    ),
                )
            conn.commit()
    except Exception as exc:
        logger.exception("Cannot write visitor log to PostgreSQL: %s", exc)


def read_visitor_logs_from_db():
    if not db_ready:
        return None
    try:
        conn = get_db_connection()
        if conn is None:
            return None
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT recorded_at, zone_id, people_count
                    FROM visitor_counts
                    ORDER BY recorded_at ASC
                    """
                )
                rows = cur.fetchall()
        return [
            {
                "time": row[0].replace(tzinfo=None) if getattr(row[0], "tzinfo", None) else row[0],
                "zone_id": row[1],
                "count": int(row[2]),
            }
            for row in rows
        ]
    except Exception as exc:
        logger.exception("Cannot read visitor logs from PostgreSQL; falling back to CSV: %s", exc)
        return None


def save_visitor_log(zone_id, current_count):
    if last_logged_count.get(zone_id) == current_count:
        return
    last_logged_count[zone_id] = current_count

    save_visitor_log_to_db(zone_id, current_count)

    file_exists = LOG_FILE_PATH.exists()
    try:
        with LOG_FILE_PATH.open(mode="a", newline="", encoding="utf-8") as file:
            writer = csv.writer(file)
            if not file_exists:
                writer.writerow(["recorded_at", "zone_id", "people_count"])
            writer.writerow([datetime.now().strftime("%Y-%m-%d %H:%M:%S"), zone_id, current_count])
    except Exception as exc:
        logger.exception("Cannot write visitor log: %s", exc)


def read_visitor_logs():
    db_logs = read_visitor_logs_from_db()
    if db_logs is not None:
        return db_logs

    logs = []
    if not LOG_FILE_PATH.exists():
        return logs
    try:
        with LOG_FILE_PATH.open(mode="r", encoding="utf-8") as file:
            reader = csv.reader(file)
            next(reader, None)
            for row in reader:
                if len(row) < 3:
                    continue
                try:
                    logs.append(
                        {
                            "time": datetime.strptime(row[0], "%Y-%m-%d %H:%M:%S"),
                            "zone_id": row[1],
                            "count": int(row[2]),
                        }
                    )
                except Exception:
                    continue
    except Exception:
        logger.exception("Cannot read visitor logs")
    return logs


def load_line_config():
    if not LINE_CONFIG_FILE.exists():
        return {}
    try:
        return json.loads(LINE_CONFIG_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_line_config(config):
    LINE_CONFIG_FILE.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")


def load_line_target_id(target_type="staff"):
    if target_type == "vendor":
        if LINE_VENDOR_TARGET_ID:
            return LINE_VENDOR_TARGET_ID
        return load_line_config().get("vendor_target_id")
    if LINE_TARGET_ID:
        return LINE_TARGET_ID
    return load_line_config().get("target_id")


def save_line_target_id(target_id, source_type="unknown", target_type="staff"):
    if not target_id:
        return
    config = load_line_config()
    field_name = "vendor_target_id" if target_type == "vendor" else "target_id"
    config[field_name] = target_id
    config[f"{target_type}_source_type"] = source_type
    config[f"{target_type}_updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    write_line_config(config)
    logger.info("LINE %s target saved: %s %s", target_type, source_type, target_id)


def send_line_message(message, target_type="staff", target_id=None):
    target_id = target_id or load_line_target_id(target_type)
    if not LINE_CHANNEL_ACCESS_TOKEN:
        return False, "missing LINE_CHANNEL_ACCESS_TOKEN"
    if not target_id:
        env_name = "LINE_VENDOR_TARGET_ID" if target_type == "vendor" else "LINE_TARGET_ID"
        return False, f"missing LINE {target_type} target. Add bot to the target chat and send one message, or set {env_name}."

    payload = json.dumps({"to": target_id, "messages": [{"type": "text", "text": message}]}).encode("utf-8")
    req = urllib.request.Request(
        "https://api.line.me/v2/bot/message/push",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {LINE_CHANNEL_ACCESS_TOKEN}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return 200 <= response.status < 300, f"LINE status {response.status}"
    except Exception as exc:
        return False, str(exc)


def build_crowd_alert_message(zone_id, config, count, limit):
    zone_name = config.get("name", zone_id)
    return (
        "SmartFlow AI crowd alert\n"
        f"Camera/Zone: {zone_name}\n"
        f"People now: {count}\n"
        f"Alert limit: more than {limit}\n"
        f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        "Please check this area."
    )
    return (
        "แจ้งเตือนความหนาแน่นผู้เยี่ยมชม\n"
        f"กล้อง/จุดตรวจ: {zone_name}\n"
        f"จำนวนคนปัจจุบัน: {count} คน\n"
        f"ขีดจำกัดที่ตั้งไว้: {limit} คน\n"
        f"เวลา: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        "กรุณาส่งเจ้าหน้าที่เข้าตรวจสอบพื้นที่"
    )


def build_vendor_crowd_alert_message(zone_id, config, count, limit):
    zone_name = config.get("name", zone_id)
    return (
        "SmartFlow AI vendor notice\n"
        f"Area: {zone_name}\n"
        f"Visitors now: {count} people\n"
        f"High-crowd trigger: more than {limit} people\n"
        f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        "Please prepare staff, products, and queue flow."
    )


def maybe_send_crowd_alert(zone_id, config, count):
    global line_alerts_sent, vendor_line_alerts_sent
    limit = int(config.get("limit", DEFAULT_CAMERA_LIMIT))
    if count <= limit:
        return False

    now_ts = time.time()
    if now_ts - last_line_alert_at.get(zone_id, 0) < LINE_ALERT_COOLDOWN_SECONDS:
        return False

    message = (
        "แจ้งเตือนความหนาแน่นผู้เยี่ยมชม\n"
        f"จุด: {config.get('name', zone_id)}\n"
        f"จำนวนคน: {count} คน\n"
        f"ขีดจำกัด: {limit} คน\n"
        f"เวลา: {datetime.now().strftime('%H:%M:%S')}\n"
        "กรุณาส่งเจ้าหน้าที่เข้าตรวจสอบพื้นที่"
    )
    message = build_crowd_alert_message(zone_id, config, count, limit)
    ok, detail = send_line_message(message)
    vendor_ok, vendor_detail = send_line_message(
        build_vendor_crowd_alert_message(zone_id, config, count, limit),
        target_type="vendor",
    )
    if ok or vendor_ok:
        last_line_alert_at[zone_id] = now_ts
        if ok:
            line_alerts_sent += 1
        if vendor_ok:
            vendor_line_alerts_sent += 1
        if zone_id in zone_data:
            zone_data[zone_id]["last_line_alert"] = {
                "sent_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "count": count,
                "limit": limit,
                "detail": detail,
                "vendor_sent": vendor_ok,
                "vendor_detail": vendor_detail,
            }
        logger.info("LINE alert sent: %s count=%s", zone_id, count)
        return True
    else:
        if zone_id in zone_data:
            zone_data[zone_id]["last_line_alert_error"] = detail
        logger.warning("LINE alert failed: %s", detail)
        return False


def get_density(count, limit):
    if count > limit:
        return "high"
    if count >= limit * 0.7:
        return "medium"
    return "low"


def apply_count_update(zone_id, count, name=None, limit=None, online=True, frame=None):
    cameras = get_cameras()
    config = cameras.get(zone_id, {"name": name or zone_id, "limit": limit or DEFAULT_CAMERA_LIMIT})
    camera_limit = int(limit or config.get("limit") or DEFAULT_CAMERA_LIMIT)
    zone_data[zone_id] = {
        "name": name or config.get("name", zone_id),
        "count": int(count),
        "limit": camera_limit,
        "density": get_density(int(count), camera_limit),
        "online": bool(online),
        "timestamp": datetime.now().strftime("%H:%M:%S"),
    }
    if frame:
        latest_frames[zone_id] = frame
    save_visitor_log(zone_id, int(count))
    maybe_send_crowd_alert(zone_id, {"name": zone_data[zone_id]["name"], "limit": camera_limit}, int(count))


def load_model():
    global model
    if model is not None:
        return model
    logger.info("Loading YOLO model from %s", YOLO_MODEL_PATH)
    model = YOLO(YOLO_MODEL_PATH)
    return model


def process_camera(zone_id, config):
    if not config.get("url"):
        logger.warning("Camera %s has no RTSP URL; skipping", zone_id)
        return

    detector = load_model()
    cap, frame_count = None, 0
    while True:
        try:
            # รอการเชื่อมต่อ VPN ให้เรียบร้อยก่อนเปิดหรือดึงภาพกล้อง (เฉพาะเมื่อใช้ VPN และเป้าหมายปลายทางตรงกับเช็กไอพี)
            if vpn_manager.vpn_type != "none" and vpn_manager.check_ip and vpn_manager.check_ip in config.get("url", ""):
                if not vpn_manager.connection_event.is_set():
                    logger.info("Waiting for VPN connection for camera %s...", zone_id)
                    vpn_manager.connection_event.wait()

            if cap is None or not cap.isOpened():
                logger.info("Opening camera %s", zone_id)
                cap = cv2.VideoCapture(config["url"], cv2.CAP_FFMPEG)
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

            ret, frame = cap.read()
            if not ret:
                if cap is not None:
                    cap.release()
                cap = None
                zone_data[zone_id] = {
                    "name": config.get("name", zone_id),
                    "count": 0,
                    "limit": config.get("limit", DEFAULT_CAMERA_LIMIT),
                    "density": "unknown",
                    "online": False,
                    "timestamp": datetime.now().strftime("%H:%M:%S"),
                }
                time.sleep(3)
                continue

            frame_count += 1
            if frame_count % 5 == 0:
                latest_config = get_cameras().get(zone_id, config)
                small = cv2.resize(frame, (640, 480))
                results = detector(small, classes=[0], conf=0.4, verbose=False)
                count = len(results[0].boxes)
                annotated = results[0].plot(labels=False, conf=False)
                _, jpeg = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 70])
                apply_count_update(
                    zone_id,
                    count,
                    latest_config.get("name", config.get("name")),
                    latest_config.get("limit", config.get("limit")),
                    True,
                    jpeg.tobytes(),
                )
        except Exception as exc:
            logger.exception("Camera worker error for %s: %s", zone_id, exc)
            zone_data[zone_id] = {
                "name": config.get("name", zone_id),
                "count": 0,
                "limit": config.get("limit", DEFAULT_CAMERA_LIMIT),
                "density": "unknown",
                "online": False,
                "timestamp": datetime.now().strftime("%H:%M:%S"),
            }
            time.sleep(5)
        time.sleep(0.01)


def start_camera_thread(zone_id, config):
    if zone_id in camera_threads:
        return
    thread = threading.Thread(target=process_camera, args=(zone_id, config), daemon=True)
    camera_threads[zone_id] = thread
    thread.start()


async def generate_stream(zone_id):
    while True:
        if zone_id in latest_frames:
            yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + latest_frames[zone_id] + b"\r\n"
            await asyncio.sleep(0.04)
        else:
            await asyncio.sleep(0.5)


def get_hourly_forecast(logs, hour_labels, current_hour_values):
    hourly_zone_max = {}
    for item in logs:
        label = item["time"].strftime("%H:00")
        if label not in hour_labels:
            continue
        key = (item["time"].date(), label)
        zone_id = item["zone_id"]
        hourly_zone_max.setdefault(key, {})
        hourly_zone_max[key][zone_id] = max(hourly_zone_max[key].get(zone_id, 0), int(item["count"]))

    samples_by_hour = {label: [] for label in hour_labels}
    for (_date, label), zone_counts in hourly_zone_max.items():
        samples_by_hour[label].append(sum(zone_counts.values()))

    values = []
    for label in hour_labels:
        samples = samples_by_hour[label]
        if samples:
            values.append(round(sum(samples) / len(samples)))
        else:
            values.append(int(current_hour_values.get(label, 0) or 0))

    max_value = max(values) if values else 0
    peak_index = values.index(max_value) if values and max_value > 0 else 0
    peak_label = hour_labels[peak_index] if hour_labels else "-"
    observed_days = len({item["time"].date() for item in logs})
    sample_count = sum(len(samples) for samples in samples_by_hour.values())

    return {
        "labels": hour_labels,
        "values": values,
        "peak_hour": peak_label,
        "peak_value": max_value,
        "observed_days": observed_days,
        "sample_count": sample_count,
        "summary_text": (
            f"<b>คาดการณ์รายชั่วโมงใน 1 วัน:</b> "
            f"จากข้อมูลย้อนหลัง {observed_days} วัน คาดว่าช่วง <b>{peak_label} น.</b> "
            f"จะมีคนมากที่สุดประมาณ <b>{max_value} คน</b>"
        ),
    }


def get_advanced_analytics():
    now = datetime.now()
    logs = read_visitor_logs()
    minute_labels = [(now - timedelta(minutes=i)).strftime("%H:%M") for i in range(9, -1, -1)]
    hour_labels = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"]
    day_labels = [(now - timedelta(days=i)).strftime("%d/%m") for i in range(6, -1, -1)]
    month_labels = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
    th_months = {1: "ม.ค.", 2: "ก.พ.", 3: "มี.ค.", 4: "เม.ย.", 5: "พ.ค.", 6: "มิ.ย.", 7: "ก.ค.", 8: "ส.ค.", 9: "ก.ย.", 10: "ต.ค.", 11: "พ.ย.", 12: "ธ.ค."}
    current_year_th = now.year + 543
    year_labels = [str(current_year_th - 2), str(current_year_th - 1), str(current_year_th)]

    minute_values = {label: 0 for label in minute_labels}
    hour_values = {label: 0 for label in hour_labels}
    day_values = {label: 0 for label in day_labels}
    month_values = {label: 0 for label in month_labels}
    year_values = {label: 0 for label in year_labels}

    for item in logs:
        dt = item["time"]
        count = int(item["count"])
        m_str = dt.strftime("%H:%M")
        if m_str in minute_values:
            minute_values[m_str] = max(minute_values[m_str], count)
        if dt.date() == now.date():
            h_str = dt.strftime("%H:00")
            if h_str in hour_values:
                hour_values[h_str] = max(hour_values[h_str], count)
        d_str = dt.strftime("%d/%m")
        if d_str in day_values:
            day_values[d_str] = max(day_values[d_str], count)
        if dt.year == now.year:
            month_values[th_months[dt.month]] = max(month_values[th_months[dt.month]], count)
        y_th_str = str(dt.year + 543)
        if y_th_str in year_values:
            year_values[y_th_str] = max(year_values[y_th_str], count)

    current_cam_count = sum(int(info.get("count", 0) or 0) for info in zone_data.values())
    for m in minute_labels:
        if minute_values[m] == 0 and current_cam_count > 0:
            minute_values[m] = current_cam_count
    h_now_str = now.strftime("%H:00")
    if h_now_str in hour_values and hour_values[h_now_str] == 0 and current_cam_count > 0:
        hour_values[h_now_str] = current_cam_count

    if sum(day_values.values()) == 0:
        day_values = {d: (12 if i % 2 == 0 else 18) for i, d in enumerate(day_labels)}
    if sum(month_values.values()) == 0:
        month_values = {m: (35 if i in [11, 0, 1] else 15) for i, m in enumerate(month_labels)}
    if sum(year_values.values()) == 0:
        year_values = {str(current_year_th - 2): 28, str(current_year_th - 1): 34, str(current_year_th): max(10, current_cam_count)}

    peak_h = max(hour_values.items(), key=lambda x: x[1])
    positive_hours = [h for h in hour_values.items() if h[1] > 0]
    low_h = min(positive_hours, key=lambda x: x[1]) if positive_hours else ("09:00", 0)
    peak_d = max(day_values.items(), key=lambda x: x[1])
    hourly_forecast = get_hourly_forecast(logs, hour_labels, hour_values)
    summary_text = (
        f"<b>วิเคราะห์และคาดการณ์ผู้เยี่ยมชมรายชั่วโมง:</b><br/>"
        f"ข้อมูลจริงวันนี้สูงสุดที่ <b>{peak_h[0]} น. ({peak_h[1]} คน)</b> "
        f"และคาดการณ์ทั้งวันว่าคนจะเยอะสุดช่วง <b>{hourly_forecast['peak_hour']} น. "
        f"({hourly_forecast['peak_value']} คน)</b><br/>"
        f"ช่วงเวลาคนน้อยที่สุดวันนี้คือ <b>{low_h[0]} น.</b> "
        f"อ้างอิงข้อมูลย้อนหลัง {hourly_forecast['observed_days']} วัน"
    )
    return {
        "minute": {"labels": minute_labels, "values": [minute_values[m] for m in minute_labels]},
        "hour": {"labels": hour_labels, "values": [hour_values[h] for h in hour_labels]},
        "day": {"labels": day_labels, "values": [day_values[d] for d in day_labels]},
        "month": {"labels": month_labels, "values": [month_values[m] for m in month_labels]},
        "year": {"labels": year_labels, "values": [year_values[y] for y in year_labels]},
        "forecast": hourly_forecast,
        "summary_text": summary_text,
    }


def get_camera_analytics():
    now = datetime.now()
    logs = read_visitor_logs()
    labels = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"]
    cameras = get_cameras()
    values_by_camera = {camera_id: {label: 0 for label in labels} for camera_id in cameras}

    for item in logs:
        zone_id = item["zone_id"]
        if zone_id not in values_by_camera or item["time"].date() != now.date():
            continue
        label = item["time"].strftime("%H:00")
        if label in values_by_camera[zone_id]:
            values_by_camera[zone_id][label] = max(values_by_camera[zone_id][label], int(item["count"]))

    current_label = now.strftime("%H:00")
    for zone_id, data in zone_data.items():
        if zone_id in values_by_camera and current_label in values_by_camera[zone_id]:
            values_by_camera[zone_id][current_label] = max(
                values_by_camera[zone_id][current_label],
                int(data.get("count", 0) or 0),
            )

    analytics = {}
    for camera_id, camera in cameras.items():
        value_list = [values_by_camera[camera_id][label] for label in labels]
        analytics[camera_id] = {
            "name": camera["name"],
            "limit": camera["limit"],
            "labels": labels,
            "values": value_list,
            "current": int(zone_data.get(camera_id, {}).get("count", 0) or 0),
            "peak": max(value_list) if value_list else 0,
            "total": sum(value_list),
        }
    return analytics


def get_history_analytics(scale="hour", offset=0):
    now = datetime.now()
    offset = max(0, int(offset or 0))
    logs = read_visitor_logs()
    th_months = {1: "ม.ค.", 2: "ก.พ.", 3: "มี.ค.", 4: "เม.ย.", 5: "พ.ค.", 6: "มิ.ย.", 7: "ก.ค.", 8: "ส.ค.", 9: "ก.ย.", 10: "ต.ค.", 11: "พ.ย.", 12: "ธ.ค."}

    if scale == "minute":
        end = now - timedelta(minutes=offset * 10)
        labels = [(end - timedelta(minutes=i)).strftime("%H:%M") for i in range(9, -1, -1)]
        start = end - timedelta(minutes=9)
        period_label = f"{start.strftime('%d/%m/%Y %H:%M')} - {end.strftime('%H:%M')}"
        values = {label: 0 for label in labels}
        for item in logs:
            label = item["time"].strftime("%H:%M")
            if start <= item["time"] <= end and label in values:
                values[label] = max(values[label], item["count"])
    elif scale == "day":
        end_date = (now - timedelta(days=offset * 7)).date()
        dates = [end_date - timedelta(days=i) for i in range(6, -1, -1)]
        labels = [d.strftime("%d/%m") for d in dates]
        period_label = f"{dates[0].strftime('%d/%m/%Y')} - {dates[-1].strftime('%d/%m/%Y')}"
        date_labels = {d: d.strftime("%d/%m") for d in dates}
        values = {label: 0 for label in labels}
        for item in logs:
            label = date_labels.get(item["time"].date())
            if label:
                values[label] = max(values[label], item["count"])
    elif scale == "month":
        year = now.year - offset
        labels = [th_months[i] for i in range(1, 13)]
        period_label = f"ปี พ.ศ. {year + 543}"
        values = {label: 0 for label in labels}
        for item in logs:
            if item["time"].year == year:
                values[th_months[item["time"].month]] = max(values[th_months[item["time"].month]], item["count"])
    elif scale == "year":
        end_year = now.year - (offset * 3)
        years = [end_year - 2, end_year - 1, end_year]
        labels = [str(y + 543) for y in years]
        period_label = f"พ.ศ. {labels[0]} - {labels[-1]}"
        values = {label: 0 for label in labels}
        for item in logs:
            label = str(item["time"].year + 543)
            if label in values:
                values[label] = max(values[label], item["count"])
    else:
        target_date = (now - timedelta(days=offset)).date()
        labels = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00"]
        period_label = target_date.strftime("%d/%m/%Y")
        values = {label: 0 for label in labels}
        for item in logs:
            label = item["time"].strftime("%H:00")
            if item["time"].date() == target_date and label in values:
                values[label] = max(values[label], item["count"])

    value_list = [values[label] for label in labels]
    max_val = max(value_list) if value_list else 0
    peak_label = labels[value_list.index(max_val)] if value_list and max_val > 0 else "-"
    return {
        "scale": scale,
        "offset": offset,
        "period_label": period_label,
        "labels": labels,
        "values": value_list,
        "summary_text": f"<b>ข้อมูลย้อนหลังจากไฟล์บันทึก:</b> {period_label}<br/>ช่วงที่พบคนมากที่สุดคือ <b>{peak_label}</b> จำนวน <b>{max_val} คน</b>",
    }


@app.get("/healthz")
async def healthz():
    return {
        "ok": True,
        "mode": "local-ngrok",
        "camera_worker": ENABLE_CAMERA_WORKER,
        "database": "postgresql" if db_ready else "csv",
    }


@app.get("/api/cameras")
async def cameras_api():
    public = []
    for camera in get_cameras().values():
        item = {key: value for key, value in camera.items() if key != "url"}
        item["has_rtsp_url"] = bool(camera.get("url"))
        public.append(item)
    return {"cameras": public}


@app.post("/api/cameras")
async def save_camera_api(payload: dict):
    camera = upsert_camera(payload)
    return {"ok": True, "camera": {key: value for key, value in camera.items() if key != "url"}}


@app.post("/api/local/counts")
async def local_counts_api(payload: dict):
    zone_id = payload.get("zone_id")
    if not zone_id:
        raise HTTPException(status_code=400, detail="zone_id is required")
    apply_count_update(
        zone_id=zone_id,
        count=int(payload.get("count", 0)),
        name=payload.get("name"),
        limit=payload.get("limit"),
        online=payload.get("online", True),
    )
    return {"ok": True, "camera": zone_data[zone_id]}


@app.get("/stream/{zone_id}")
async def video_stream(zone_id: str):
    if zone_id not in get_cameras():
        raise HTTPException(status_code=404)
    return StreamingResponse(generate_stream(zone_id), media_type="multipart/x-mixed-replace; boundary=frame")


@app.get("/api/counts")
async def get_counts_api():
    for camera_id, camera in get_cameras().items():
        zone_data.setdefault(
            camera_id,
            {
                "name": camera["name"],
                "count": 0,
                "limit": camera["limit"],
                "density": "unknown",
                "online": False,
                "timestamp": None,
            },
        )
    return {
        "cameras": zone_data,
        "analytics": get_advanced_analytics(),
        "camera_analytics": get_camera_analytics(),
    }


@app.get("/api/analytics/history")
async def get_analytics_history_api(scale: str = "hour", offset: int = 0):
    allowed_scales = {"minute", "hour", "day", "month", "year"}
    if scale not in allowed_scales:
        raise HTTPException(status_code=400, detail="Invalid analytics scale")
    return get_history_analytics(scale, offset)


@app.post("/api/line/webhook")
async def line_webhook(request: Request):
    payload = await request.json()
    LINE_LAST_WEBHOOK_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    for event in payload.get("events", []):
        source = event.get("source", {})
        target_id = source.get("groupId") or source.get("roomId") or source.get("userId")
        if target_id:
            message_text = str(event.get("message", {}).get("text", "")).strip().lower()
            vendor_target_id = load_line_target_id("vendor")
            target_type = "vendor" if (
                message_text in {"vendor", "merchant", "seller", "vendors"} or target_id == vendor_target_id
            ) else "staff"
            save_line_target_id(target_id, source.get("type", "unknown"), target_type)
    return {
        "ok": True,
        "target_id": load_line_target_id("staff"),
        "vendor_target_id": load_line_target_id("vendor"),
    }


@app.get("/api/line/status")
async def line_status_api():
    target_id = load_line_target_id("staff")
    vendor_target_id = load_line_target_id("vendor")
    return {
        "has_token": bool(LINE_CHANNEL_ACCESS_TOKEN),
        "has_target": bool(target_id),
        "has_vendor_target": bool(vendor_target_id),
        "target_id": target_id,
        "vendor_target_id": vendor_target_id,
        "cooldown_seconds": LINE_ALERT_COOLDOWN_SECONDS,
        "alerts_sent": line_alerts_sent,
        "vendor_alerts_sent": vendor_line_alerts_sent,
        "last_alert_by_camera": {
            zone_id: data.get("last_line_alert")
            for zone_id, data in zone_data.items()
            if data.get("last_line_alert")
        },
    }


@app.post("/api/line/test")
async def line_test_api():
    message = (
        "ทดสอบระบบแจ้งเตือน SmartFlow AI\n"
        f"เวลา: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        "หากได้รับข้อความนี้ แปลว่าระบบ LINE พร้อมใช้งาน"
    )
    ok, detail = send_line_message(message)
    if not ok:
        raise HTTPException(status_code=400, detail=detail)
    return {"ok": True, "detail": detail}


@app.post("/api/line/vendors/test")
async def line_vendor_test_api():
    message = (
        "SmartFlow AI vendor group test\n"
        f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
        "Vendor high-crowd notifications are ready."
    )
    ok, detail = send_line_message(message, target_type="vendor")
    if not ok:
        raise HTTPException(status_code=400, detail=detail)
    return {"ok": True, "detail": detail}


@app.on_event("startup")
async def startup():
    init_database()

    # เริ่มระบบตรวจสอบและเชื่อมต่อ VPN เบื้องหลัง
    vpn_manager.start_monitoring()

    if ENABLE_CAMERA_WORKER:
        for zone_id, config in get_cameras().items():
            zone_data.setdefault(
                zone_id,
                {
                    "name": config["name"],
                    "count": 0,
                    "limit": config["limit"],
                    "density": "unknown",
                    "online": False,
                    "timestamp": None,
                },
            )
            if config.get("enabled") and config.get("url"):
                start_camera_thread(zone_id, config)
        logger.info("SmartFlow AI local camera workers started")
    else:
        logger.info("Camera workers disabled by ENABLE_CAMERA_WORKER=false")


@app.on_event("shutdown")
async def shutdown():
    # ปิดระบบตรวจสอบและตัดการเชื่อมต่อ VPN เมื่อเซิร์ฟเวอร์หยุดทำงาน
    vpn_manager.stop_monitoring()
    logger.info("SmartFlow AI local backend shutdown complete")


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            await ws.send_json(
                {
                    "cameras": zone_data,
                    "analytics": get_advanced_analytics(),
                    "camera_analytics": get_camera_analytics(),
                }
            )
            await asyncio.sleep(1)
    except Exception:
        pass


app.mount("/", StaticFiles(directory=str(BASE_DIR), html=True), name="static")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    logger.info("Starting local server on http://0.0.0.0:%s", port)
    uvicorn.run("server:app", host="0.0.0.0", port=port)
