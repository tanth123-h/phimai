"""
Local SmartFlow AI camera worker.

Run this on the same network as the RTSP cameras. It sends counts to the
Render backend instead of exposing a local-only Flask server.
"""

import json
import os
import time
import urllib.request
from datetime import datetime

import cv2
from ultralytics import YOLO


RENDER_API_URL = os.getenv("RENDER_API_URL", "").rstrip("/")
LOCAL_INGEST_TOKEN = os.getenv("LOCAL_INGEST_TOKEN", "")
CAMERA_ID = os.getenv("CAMERA_ID", "main-prang")
CAMERA_NAME = os.getenv("CAMERA_NAME", "ปรางค์ประธาน")
CAMERA_LIMIT = int(os.getenv("CAMERA_LIMIT", "30"))
RTSP_URL = os.getenv("RTSP_URL")
YOLO_MODEL_PATH = os.getenv("YOLO_MODEL_PATH", "yolov8m.pt")
POST_EVERY_N_FRAMES = int(os.getenv("POST_EVERY_N_FRAMES", "5"))

os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = os.getenv("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")
os.environ["OPENCV_FFMPEG_LOGLEVEL"] = os.getenv("OPENCV_FFMPEG_LOGLEVEL", "16")


def api_request(path, method="GET", payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"}
    if LOCAL_INGEST_TOKEN:
        headers["Authorization"] = f"Bearer {LOCAL_INGEST_TOKEN}"
    req = urllib.request.Request(f"{RENDER_API_URL}{path}", data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=15) as response:
        body = response.read().decode("utf-8")
        return json.loads(body) if body else {}


def load_rtsp_url_from_backend():
    # The public API intentionally does not expose RTSP URLs. Configure RTSP_URL
    # locally, or use the dashboard only as the source of truth for Render-side
    # metadata and limits.
    return None


def post_count(count, online=True):
    payload = {
        "zone_id": CAMERA_ID,
        "name": CAMERA_NAME,
        "limit": CAMERA_LIMIT,
        "count": int(count),
        "online": bool(online),
        "captured_at": datetime.now().isoformat(),
    }
    return api_request("/api/local/counts", method="POST", payload=payload)


def main():
    if not RENDER_API_URL:
        raise RuntimeError("Set RENDER_API_URL to your Render backend URL before starting the worker")

    rtsp_url = RTSP_URL or load_rtsp_url_from_backend()
    if not rtsp_url:
        raise RuntimeError("Set RTSP_URL in the local environment before starting the worker")

    print(f"Loading YOLO model: {YOLO_MODEL_PATH}")
    model = YOLO(YOLO_MODEL_PATH)
    cap = None
    frame_count = 0

    while True:
        try:
            if cap is None or not cap.isOpened():
                print(f"Opening camera {CAMERA_ID}")
                cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

            ret, frame = cap.read()
            if not ret:
                print("Camera unavailable, retrying...")
                post_count(0, online=False)
                if cap is not None:
                    cap.release()
                cap = None
                time.sleep(5)
                continue

            frame_count += 1
            if frame_count % POST_EVERY_N_FRAMES != 0:
                continue

            frame = cv2.resize(frame, (640, 480))
            results = model(frame, classes=[0], conf=0.4, verbose=False)
            count = len(results[0].boxes)
            post_count(count, online=True)
            print(f"{datetime.now().strftime('%H:%M:%S')} {CAMERA_ID}: {count} people")
        except Exception as exc:
            print(f"Worker error: {exc}")
            time.sleep(5)


if __name__ == "__main__":
    main()
