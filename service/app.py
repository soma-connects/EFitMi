# Adapted from JavTahir/Live-Measurements-Api (MIT License)
# https://github.com/JavTahir/Live-Measurements-Api
#
# What changed from the original: the original calibrates scale from a
# self-reported height by default (falling back to a blind largest-contour
# guess at an A4 sheet only when pose detection fails entirely) — see the
# EFitMi README for why that path was replaced. This version instead takes
# the pixel width of a bank card the caller has already located in the
# photo (dragged/confirmed by the user in the EFitMi web UI) and computes
# scale directly from the card's known real-world width. Pose extraction,
# contour-assisted width detection, and the MiDaS-nudged circumference
# estimate are otherwise unchanged from the original.

import cv2
import numpy as np
import mediapipe as mp
import torch
import torch.nn.functional as F
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

mp_pose = mp.solutions.pose
mp_holistic = mp.solutions.holistic
holistic = mp_holistic.Holistic()

# ISO/IEC 7810 ID-1 card width (bank/ATM/debit cards worldwide), in cm.
CARD_WIDTH_CM = 8.56


def load_depth_model():
    """MiDaS is an optional refinement, not a requirement: it only nudges the
    circumference estimate. If the weights can't be fetched (offline, blocked
    network), run without it rather than failing to start."""
    try:
        model = torch.hub.load("intel-isl/MiDaS", "MiDaS_small")
        model.eval()
        return model
    except Exception as e:
        print(f"WARNING: MiDaS unavailable, continuing without depth refinement ({e})")
        return None


depth_model = load_depth_model()


def estimate_depth(image):
    """Relative (unitless) depth map from MiDaS — used only to nudge the
    circumference estimate below, not as a metric cm measurement."""
    if depth_model is None:
        return None
    input_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB) / 255.0
    input_tensor = torch.tensor(input_image, dtype=torch.float32).permute(2, 0, 1).unsqueeze(0)
    input_tensor = F.interpolate(input_tensor, size=(384, 384), mode="bilinear", align_corners=False)
    with torch.no_grad():
        depth_map = depth_model(input_tensor)
    return depth_map.squeeze().numpy()


def get_body_width_at_height(frame, height_px, center_x):
    """Scan horizontally at a specific height to find body edges."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, thresh = cv2.threshold(blur, 50, 255, cv2.THRESH_BINARY)

    if height_px >= frame.shape[0]:
        height_px = frame.shape[0] - 1

    horizontal_line = thresh[height_px, :]
    center_x = int(center_x * frame.shape[1])
    left_edge, right_edge = center_x, center_x

    for i in range(center_x, 0, -1):
        if horizontal_line[i] == 0:
            left_edge = i
            break
    for i in range(center_x, len(horizontal_line)):
        if horizontal_line[i] == 0:
            right_edge = i
            break

    width_px = right_edge - left_edge
    min_width = 0.1 * frame.shape[1]
    if width_px < min_width:
        width_px = min_width
    return width_px


def calculate_measurements(results, scale_factor, image_width, image_height, depth_map, frame):
    landmarks = results.pose_landmarks.landmark

    def pixel_to_cm(value):
        return round(value * scale_factor, 2)

    def calculate_circumference(width_px, depth_ratio=1.0):
        # Elliptical approximation: C ~= 2*pi*sqrt((a^2 + b^2) / 2)
        width_cm = width_px * scale_factor
        estimated_depth_cm = width_cm * depth_ratio * 0.7
        half_width = width_cm / 2
        half_depth = estimated_depth_cm / 2
        return round(2 * np.pi * np.sqrt((half_width ** 2 + half_depth ** 2) / 2), 2)

    def depth_ratio_at(x_norm, y_norm):
        if depth_map is None:
            return 1.0
        x_scaled = int(x_norm * image_width * (384 / image_width))
        y_scaled = int(y_norm * image_height * (384 / image_height))
        if 0 <= y_scaled < 384 and 0 <= x_scaled < 384:
            depth = depth_map[y_scaled, x_scaled]
            max_depth = np.max(depth_map)
            return 1.0 + 0.5 * (1.0 - depth / max_depth)
        return 1.0

    measurements = {}

    left_shoulder = landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER.value]
    right_shoulder = landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER.value]
    left_hip = landmarks[mp_pose.PoseLandmark.LEFT_HIP.value]
    right_hip = landmarks[mp_pose.PoseLandmark.RIGHT_HIP.value]

    # Shoulder width
    shoulder_width_px = abs(left_shoulder.x * image_width - right_shoulder.x * image_width) * 1.1
    measurements["shoulder_width"] = pixel_to_cm(shoulder_width_px)

    # Chest width + circumference
    chest_y_ratio = 0.15
    chest_y = left_shoulder.y + (left_hip.y - left_shoulder.y) * chest_y_ratio
    chest_width_px = abs((right_shoulder.x - left_shoulder.x) * image_width) * 1.15
    chest_y_px = int(chest_y * image_height)
    center_x = (left_shoulder.x + right_shoulder.x) / 2
    detected_width = get_body_width_at_height(frame, chest_y_px, center_x)
    if detected_width > 0:
        chest_width_px = max(chest_width_px, detected_width)
    chest_depth_ratio = depth_ratio_at(center_x, chest_y)
    measurements["chest_width"] = pixel_to_cm(chest_width_px)
    measurements["chest_circumference"] = calculate_circumference(chest_width_px, chest_depth_ratio)

    # Waist width + circumference
    waist_y_ratio = 0.35
    waist_y = left_shoulder.y + (left_hip.y - left_shoulder.y) * waist_y_ratio
    waist_y_px = int(waist_y * image_height)
    waist_center_x = (left_hip.x + right_hip.x) / 2
    detected_width = get_body_width_at_height(frame, waist_y_px, waist_center_x)
    if detected_width > 0:
        waist_width_px = detected_width
    else:
        waist_width_px = abs(right_hip.x - left_hip.x) * image_width * 0.9
    waist_width_px *= 1.16
    waist_depth_ratio = depth_ratio_at(waist_center_x, waist_y)
    measurements["waist_width"] = pixel_to_cm(waist_width_px)
    measurements["waist"] = calculate_circumference(waist_width_px, waist_depth_ratio)

    # Hip width + circumference
    hip_width_px = abs(left_hip.x * image_width - right_hip.x * image_width) * 1.35
    left_knee = landmarks[mp_pose.PoseLandmark.LEFT_KNEE.value]
    hip_y = left_hip.y + (left_knee.y - left_hip.y) * 0.1
    hip_y_px = int(hip_y * image_height)
    detected_width = get_body_width_at_height(frame, hip_y_px, waist_center_x)
    if detected_width > 0:
        hip_width_px = max(hip_width_px, detected_width)
    hip_depth_ratio = depth_ratio_at(waist_center_x, left_hip.y)
    measurements["hip_width"] = pixel_to_cm(hip_width_px)
    measurements["hip"] = calculate_circumference(hip_width_px, hip_depth_ratio)

    return measurements


def validate_front_image(image_np):
    """Server-side sanity check. The EFitMi web UI already gates capture on
    live framing checks — this is a defense-in-depth check on whatever
    actually arrives at the API, not the primary UX gate."""
    try:
        rgb_frame = cv2.cvtColor(image_np, cv2.COLOR_BGR2RGB)
        image_height, image_width = image_np.shape[:2]

        with mp_holistic.Holistic(
            static_image_mode=True,
            model_complexity=1,
            enable_segmentation=False,
            refine_face_landmarks=False,
        ) as validator:
            results = validator.process(rgb_frame)

        if not results.pose_landmarks:
            return False, "No person detected. Please make sure you're clearly visible in the frame."

        required = [
            mp_holistic.PoseLandmark.NOSE,
            mp_holistic.PoseLandmark.LEFT_SHOULDER,
            mp_holistic.PoseLandmark.RIGHT_SHOULDER,
            mp_holistic.PoseLandmark.LEFT_HIP,
            mp_holistic.PoseLandmark.RIGHT_HIP,
        ]
        missing = [
            lm.name for lm in required
            if results.pose_landmarks.landmark[lm].visibility < 0.5
        ]
        if missing:
            return False, "Couldn't detect full body. Please make sure your full body is visible."

        nose = results.pose_landmarks.landmark[mp_holistic.PoseLandmark.NOSE]
        left_shoulder = results.pose_landmarks.landmark[mp_holistic.PoseLandmark.LEFT_SHOULDER]
        right_shoulder = results.pose_landmarks.landmark[mp_holistic.PoseLandmark.RIGHT_SHOULDER]
        shoulder_width = abs(left_shoulder.x - right_shoulder.x) * image_width
        head_to_shoulder = abs(left_shoulder.y - nose.y) * image_height
        if shoulder_width < head_to_shoulder * 1.2:
            return False, "Please step back to show more of your upper body, not just your face."

        return True, "ok"
    except Exception as e:
        print(f"Error validating body image: {e}")
        return False, "Couldn't read that image. Please try again."


@app.route("/measure", methods=["POST"])
def measure():
    if "front" not in request.files:
        return jsonify({"error": "Missing 'front' image."}), 400

    card_box_width_px = request.form.get("card_box_width_px")
    if not card_box_width_px:
        return jsonify({"error": "Missing 'card_box_width_px'."}), 400
    try:
        card_box_width_px = float(card_box_width_px)
        if card_box_width_px <= 0:
            raise ValueError
    except ValueError:
        return jsonify({"error": "'card_box_width_px' must be a positive number."}), 400

    image_np = np.frombuffer(request.files["front"].read(), np.uint8)
    frame = cv2.imdecode(image_np, cv2.IMREAD_COLOR)
    if frame is None:
        return jsonify({"error": "Could not decode 'front' image."}), 400

    is_valid, error_msg = validate_front_image(frame)
    if not is_valid:
        return jsonify({"error": error_msg, "code": "INVALID_POSE"}), 400

    scale_factor = CARD_WIDTH_CM / card_box_width_px

    image_height, image_width, _ = frame.shape
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = holistic.process(rgb_frame)
    if not results.pose_landmarks:
        return jsonify({"error": "No person detected.", "code": "INVALID_POSE"}), 400

    depth_map = estimate_depth(frame)
    measurements = calculate_measurements(
        results, scale_factor, image_width, image_height, depth_map, frame
    )

    return jsonify({
        "measurements": measurements,
        "debug_info": {
            "scale_factor_cm_per_px": scale_factor,
            "card_box_width_px": card_box_width_px,
            "depth_refinement": depth_map is not None,
        },
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8001)
