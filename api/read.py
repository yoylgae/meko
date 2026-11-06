"""기록지 사진 읽기 (사이트 안에서만 호출: /api/ocr 가 비밀 머리글을 붙여 부름)"""
import base64, hashlib, hmac, json, os, sys, time
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "_lib"))


def _key():
    secret = os.environ.get("SESSION_SECRET") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    return hmac.new(("meko-ocr:" + secret).encode(), b"read", hashlib.sha256).hexdigest() if secret else ""


class handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        """상태 확인: 인식기를 불러와 빈 칸 하나를 읽어 봄"""
        try:
            import numpy as np, cv2, onnxruntime
            import reader
            x = np.zeros((1, 1, 32, 128), np.float32)
            reader._onnx("veh").run(None, {"x": x})
            return self._send(200, {"ok": True, "cv2": cv2.__version__, "onnxruntime": onnxruntime.__version__,
                                    "companies": reader.companies_of_model()})
        except Exception as e:
            return self._send(500, {"ok": False, "error": f"{type(e).__name__}: {e}"})

    def do_POST(self):
        k = _key()
        if not k or not hmac.compare_digest(self.headers.get("x-meko-key", ""), k):
            return self._send(401, {"error": "unauthorized"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(n))
            import numpy as np, cv2
            import reader
            buf = np.frombuffer(base64.b64decode(req["image"]), np.uint8)
            img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
            if img is None:
                return self._send(400, {"error": "사진 파일을 열 수 없습니다."})
            t0 = time.time()
            rows = reader.read(img, known=req.get("known") or [], veh_co=req.get("veh_co") or {},
                               site_companies=req.get("companies"), after=req.get("after"))
            print(f"[read] rows={len(rows)} sec={time.time() - t0:.1f}", flush=True)
            return self._send(200, {"rows": rows, "model_companies": reader.companies_of_model()})
        except Exception as e:
            import traceback; traceback.print_exc()
            return self._send(500, {"error": f"{type(e).__name__}: {e}"})
