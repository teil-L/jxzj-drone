from flask import Flask, Response, jsonify, request
from flask_cors import CORS
import cv2
from ultralytics import YOLO
import threading
import os
import time
import json
import urllib.request
import urllib.error

app = Flask(__name__)
# Enable CORS for local development
CORS(app)

# --- Configuration & Initialization ---
ASSETS_DIR = os.path.join(os.path.dirname(__file__), 'assets')
MODEL_PATH = os.path.join(ASSETS_DIR, 'best.pt')
VIDEO_PATH = os.path.join(ASSETS_DIR, 'source_video.mp4')
PROCESSED_VIDEO_PATH = os.path.join(ASSETS_DIR, 'processed_video.mp4')
DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions'

print(f"Loading YOLOv8 Model from: {MODEL_PATH}")
if not os.path.exists(MODEL_PATH):
    raise FileNotFoundError(f"Model file not found at {MODEL_PATH}")
    
model = YOLO(MODEL_PATH)

# Global variables to handle background processing
current_frame = None
processing_thread = None
is_processing = False

def process_video():
    """Background thread function that reads the video, runs inference, and saves the output."""
    global current_frame, is_processing
    
    cap = cv2.VideoCapture(VIDEO_PATH)
    if not cap.isOpened():
        print(f"Error opening video stream or file at {VIDEO_PATH}")
        is_processing = False
        return

    # Get video properties for saving the output
    frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps == 0: fps = 30.0 # fallback

    # Use mp4v codec for cross-platform MP4 saving
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(PROCESSED_VIDEO_PATH, fourcc, fps, (frame_width, frame_height))

    print(f"Starting video processing at {fps} FPS...")

    # Keep target vessel in view: smooth the crop center instead of jumping every frame.
    track_center_x = frame_width // 2
    track_center_y = frame_height // 2
    crop_zoom = 1.35
    smooth_alpha = 0.82
    
    while is_processing and cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            print("End of video stream reached.")
            # Loop the video for continuous demo
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            continue

        # Run YOLOv8 inference
        results = model.predict(frame, verbose=False)

        # Estimate a stable target center from the strongest detection.
        boxes = results[0].boxes
        if boxes is not None and len(boxes) > 0:
            confs = boxes.conf.cpu().numpy()
            best_idx = int(confs.argmax())
            xyxy = boxes.xyxy[best_idx].cpu().numpy()
            target_center_x = int((xyxy[0] + xyxy[2]) / 2.0)
            target_center_y = int((xyxy[1] + xyxy[3]) / 2.0)

            track_center_x = int(smooth_alpha * track_center_x + (1.0 - smooth_alpha) * target_center_x)
            track_center_y = int(smooth_alpha * track_center_y + (1.0 - smooth_alpha) * target_center_y)

        # Plot bounding boxes on the frame first, then stabilize by target-centric crop.
        annotated_frame = results[0].plot()

        crop_w = int(frame_width / crop_zoom)
        crop_h = int(frame_height / crop_zoom)
        half_w = crop_w // 2
        half_h = crop_h // 2

        crop_x1 = max(0, min(track_center_x - half_w, frame_width - crop_w))
        crop_y1 = max(0, min(track_center_y - half_h, frame_height - crop_h))
        crop_x2 = crop_x1 + crop_w
        crop_y2 = crop_y1 + crop_h

        cropped = annotated_frame[crop_y1:crop_y2, crop_x1:crop_x2]
        stabilized_frame = cv2.resize(cropped, (frame_width, frame_height), interpolation=cv2.INTER_LINEAR)

        # Update global reference for the MJPEG stream
        current_frame = stabilized_frame.copy()

        # Write frame to the output video file
        out.write(stabilized_frame)

        # Small sleep to simulate real-time processing and not overload the CPU blindly
        time.sleep(1.0 / fps)

    cap.release()
    out.release()
    print(f"Processing stopped. Output saved to {PROCESSED_VIDEO_PATH}")

def start_background_processing():
    """Starts the video processing thread if it's not already running."""
    global processing_thread, is_processing
    if not is_processing:
        is_processing = True
        processing_thread = threading.Thread(target=process_video)
        processing_thread.daemon = True
        processing_thread.start()


def build_dispatch_fallback(page_name, event_desc):
    title = "AI出警建议（本地策略）"
    lines = [
        "1) 就近调度: 指派最近执法艇与无人机双向靠拢，建立视频与AIS双证据链。",
        "2) 现场处置: 先广播警示并要求停机停桨，保持安全距离完成二次取证。",
        "3) 固化证据: 导出电子笔录、现场快照与哈希值，推送司法存证中心。"
    ]
    return {
        "source": "fallback",
        "title": title,
        "page": page_name or "unknown",
        "summary": f"页面: {page_name or 'unknown'}；事件: {event_desc or '未提供'}",
        "suggestion": "\n".join(lines)
    }


def request_deepseek_dispatch(page_name, event_desc):
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        return build_dispatch_fallback(page_name, event_desc)

    payload = {
        "model": "deepseek-chat",
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是水域执法调度助手。请输出简洁可执行的出警建议，"
                    "必须包含调度对象、优先级、处置步骤(3步以内)、证据链动作。"
                )
            },
            {
                "role": "user",
                "content": (
                    f"页面: {page_name or 'unknown'}\n"
                    f"事件描述: {event_desc or '未提供'}\n"
                    "请生成可直接展示在执法系统界面的出警建议。"
                )
            }
        ],
        "temperature": 0.4,
        "max_tokens": 420
    }

    req = urllib.request.Request(
        DEEPSEEK_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        }
    )

    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        print(f"[DeepSeek] HTTPError {err.code}: {err.reason}")
        return build_dispatch_fallback(page_name, event_desc)
    except Exception as err:
        print(f"[DeepSeek] Request failed: {err}")
        return build_dispatch_fallback(page_name, event_desc)

    choices = data.get("choices") or []
    content = ""
    if choices:
        content = ((choices[0].get("message") or {}).get("content") or "").strip()
    if not content:
        return build_dispatch_fallback(page_name, event_desc)

    return {
        "source": "deepseek",
        "title": "AI出警建议（DeepSeek）",
        "page": page_name or "unknown",
        "summary": f"页面: {page_name or 'unknown'}；事件: {event_desc or '未提供'}",
        "suggestion": content
    }

# --- HTTP Endpoints ---

def generate_mjpeg_stream():
    """Generator function that yields JPEG frames for the MJPEG stream."""
    global current_frame
    
    # Ensure background processing is running
    start_background_processing()
    
    while True:
        if current_frame is not None:
            # Encode frame to JPEG
            ret, buffer = cv2.imencode('.jpg', current_frame)
            if not ret:
                continue
            frame_bytes = buffer.tobytes()
            
            # Format as multipart/x-mixed-replace boundary chunk
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
        
        # Prevent tight loop spinning, wait for roughly 30fps
        time.sleep(0.03)


@app.route('/video_feed')
def video_feed():
    """Video streaming route. Put this in the src attribute of an img tag."""
    return Response(generate_mjpeg_stream(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/snapshot')
def snapshot():
    """Single-frame JPEG snapshot for evidence capture."""
    global current_frame
    start_background_processing()
    if current_frame is None:
        return jsonify({"error": "frame_not_ready"}), 503

    ret, buffer = cv2.imencode('.jpg', current_frame)
    if not ret:
        return jsonify({"error": "encode_failed"}), 500

    return Response(
        buffer.tobytes(),
        mimetype='image/jpeg',
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache"
        }
    )

@app.route('/status')
def status():
    """Endpoint to check if backend is alive and model is loaded."""
    return jsonify({
        "status": "online", 
        "processing": is_processing,
        "processed_file_exists": os.path.exists(PROCESSED_VIDEO_PATH)
    })


@app.route('/api/dispatch-suggestion', methods=['POST'])
def dispatch_suggestion():
    body = request.get_json(silent=True) or {}
    page_name = str(body.get("page", "")).strip()
    event_desc = str(body.get("event", "")).strip()
    result = request_deepseek_dispatch(page_name, event_desc)
    return jsonify(result)

if __name__ == '__main__':
    # Initial processing start when server boots up
    start_background_processing()
    print("---------------------------------------------------------")
    print("Drone YOLOv8 Backend Server Started on http://0.0.0.0:5000")
    print("Ensure the frontend accesses the stream via http://127.0.0.1:5000/video_feed")
    print("---------------------------------------------------------")
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)


