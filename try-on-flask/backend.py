"""import os
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv
from getstream import Stream

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app) # Enable CORS so your frontend kiosk can communicate with this backend

# Initialize the Stream Server Client
# The secret gives this server full admin access to the Stream API
stream_client = Stream(
    api_key=os.environ.get("STREAM_API_KEY"),
    api_secret=os.environ.get("STREAM_API_SECRET")
)

@app.route('/api/auth-mirror', methods=['POST'])
def auth_mirror_user():
    ""
    Endpoint called by the frontend kiosk.
    Expects a unique user_id (e.g., 'kiosk-01' or a temporary guest session ID).
    ""
    data = request.get_json() or {}
    user_id = data.get("user_id")
    
    if not user_id:
        return jsonify({"error": "user_id is required"}), 400

    try:
        # 1. Upsert/Register the user state on Stream's servers
        stream_client.upsert_users([{
            "id": user_id,
            "name": f"Retail Customer ({user_id})",
            "role": "user"
        }])
        
        # 2. Generate a secure, time-limited JWT Token for this specific user ID
        # The client uses this token to authenticate directly with Stream's WebRTC edge
        token = stream_client.create_token(user_id=user_id)
        
        return jsonify({
            "token": token,
            "apiKey": os.environ.get("STREAM_API_KEY"),
            "userId": user_id
        }), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/create-session', methods=['POST'])
def create_video_session():
    ""
    Optional: Explicitly pre-create or configure a video call/mirror room 
    from the backend if you need to restrict access or log metrics.
    ""
    data = request.get_json() or {}
    call_id = data.get("call_id") # e.g., "mirror-room-booth-A"
    user_id = data.get("user_id")
    
    if not call_id or not user_id:
        return jsonify({"error": "call_id and user_id are required"}), 400
        
    try:
        # Create a default 'default' type video call room managed by the backend
        call = stream_client.video.call(call_type="default", call_id=call_id)
        call.get_or_create(data={"created_by_id": user_id})
        
        return jsonify({"status": "success", "call_id": call_id}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(port=5000, debug=True) """