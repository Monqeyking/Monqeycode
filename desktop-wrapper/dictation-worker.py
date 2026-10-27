# Whisper/VAD approach based on tonyd2wild/DeepSeek-Harness-Dictation (MIT).
# The desktop owns this process; audio and model files never leave this machine.
import io
import json
import sys
from faster_whisper import WhisperModel

model = WhisperModel(sys.argv[1], device="cpu", compute_type="int8", local_files_only=True)
print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    try:
        import base64
        request = json.loads(line)
        if request.get("warm"):
            print(json.dumps({"text": ""}), flush=True)
            continue
        audio = base64.b64decode(request["audio"], validate=True)
        segments, _ = model.transcribe(io.BytesIO(audio), language=request.get("language"),
                                       beam_size=5, vad_filter=True, condition_on_previous_text=False)
        print(json.dumps({"text": " ".join(s.text.strip() for s in segments).strip()}), flush=True)
    except Exception as error:
        print(json.dumps({"error": str(error)}), flush=True)
