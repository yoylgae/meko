"""기록지 사진 한 장 → 줄 목록. 사이트(Vercel Python 함수)에서 쓰는 본체.
  표 선 찾기(grid/cells) → 칸 360개 잘라내기 → 인식기 3개(ONNX) → 차량 기록·시간 순서로 다듬기"""
import os, re, numpy as np, cv2
import grid
from cells import lattice, N_H

grid.VERBOSE = False
HERE = os.path.dirname(os.path.abspath(__file__))
CH = "0123456789:"
SIZE = {"veh": (128, 32), "time": (104, 32), "co": (72, 32)}
CUT = {"veh": (1, 240), "co": (2, 140), "time": (3, 200)}   # (칸 번호, 잘라낼 폭)
BLANK = 0.02
VERBOSE = False
_sess = {}


def _onnx(name):
    if name not in _sess:
        import onnxruntime as ort
        o = ort.SessionOptions(); o.intra_op_num_threads = 2
        _sess[name] = ort.InferenceSession(os.path.join(HERE, "models", f"{name}.onnx"), o, providers=["CPUExecutionProvider"])
    return _sess[name]


def companies_of_model():
    with open(os.path.join(HERE, "models", "companies.txt"), encoding="utf-8") as f:
        return [l.strip() for l in f if l.strip()]


def prep(img, kind):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    W, H = SIZE[kind]
    g = cv2.resize(g, (W, H), interpolation=cv2.INTER_AREA).astype(np.float32)
    lo, hi = np.percentile(g, 2), np.percentile(g, 90)
    return 1 - np.clip((g - lo) / max(hi - lo, 1), 0, 1)


def ink(img):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    h, w = g.shape; c = g[int(h * .2):int(h * .8), int(w * .1):int(w * .9)]
    return float((c < np.percentile(g, 90) * 0.65).mean())


def cut_cells(img0):
    img, P = lattice(img0)
    pad = 3; out = []
    for k in range(6):
        for r in range(20):
            cell = {}
            for kind, (c, W) in CUT.items():
                i = k * 4 + c
                q = np.float32([P[r + 1, i], P[r + 1, i + 1], P[r + 2, i + 1], P[r + 2, i]])
                M = cv2.getPerspectiveTransform(q, np.float32([[0, 0], [W + 2 * pad, 0], [W + 2 * pad, 64 + 2 * pad], [0, 64 + 2 * pad]]))
                cell[kind] = cv2.warpPerspective(img, M, (W + 2 * pad, 64 + 2 * pad), flags=cv2.INTER_CUBIC)[pad:-pad, pad:-pad]
            out.append(cell)
    return out


def log_softmax(x, ax=-1):
    m = x.max(ax, keepdims=True); return x - m - np.log(np.exp(x - m).sum(ax, keepdims=True))


def greedy(lp):
    s, prev = "", 0
    for c in lp.argmax(-1):
        if c != prev and c != 0: s += CH[c - 1]
        prev = c
    return s


def ctc_ll(lp, texts):
    """lp (T,C) 로그확률 → 후보 글자열마다 CTC 로그확률 (numpy, 후보 묶어서 한 번에)"""
    T = lp.shape[0]; n = len(texts); L = max(len(t) for t in texts)
    S = 2 * L + 1
    ext = np.zeros((n, S), int)                       # blank(0)과 글자를 번갈아
    lens = np.array([2 * len(t) + 1 for t in texts])
    for k, t in enumerate(texts):
        for j, ch in enumerate(t): ext[k, 2 * j + 1] = CH.index(ch) + 1
    skip = np.zeros((n, S), bool)
    skip[:, 2:] = (ext[:, 2:] != 0) & (ext[:, 2:] != ext[:, :-2])
    valid = np.arange(S)[None, :] < lens[:, None]
    NEG = -1e30
    a = np.full((n, S), NEG); a[:, 0] = lp[0, 0]; a[:, 1] = np.where(lens > 1, lp[0, ext[:, 1]], NEG)
    for t in range(1, T):
        e = lp[t][ext]
        a1 = np.concatenate([np.full((n, 1), NEG), a[:, :-1]], 1)
        a2 = np.where(skip, np.concatenate([np.full((n, 2), NEG), a[:, :-2]], 1), NEG)
        m = np.maximum(np.maximum(a, a1), a2)
        a = m + np.log(np.exp(a - m) + np.exp(a1 - m) + np.exp(a2 - m)) + e
        a = np.where(valid, a, NEG)
    last = a[np.arange(n), lens - 1]; prev = np.where(lens > 1, a[np.arange(n), lens - 2], NEG)
    m = np.maximum(last, prev)
    return m + np.log(np.exp(last - m) + np.exp(prev - m))


def _time_table():
    ts = np.arange(4 * 60, 21 * 60)
    forms = []
    for t in ts:
        h, m = divmod(int(t), 60)
        fs = [(f"{h}:{m:02d}", 0.0), (f"{h:02d}:{m:02d}", 0.0), (f"{m:02d}", -1.0)]
        if h > 12: fs.append((f"{h - 12}:{m:02d}", -0.3))
        forms.append(fs)
    uniq = sorted({f for fs in forms for f, _ in fs}); ui = {f: k for k, f in enumerate(uniq)}
    idx = [[(ui[f], p) for f, p in fs] for fs in forms]
    return ts, uniq, idx

_TT = None


def solve_times(lts, after=None):
    """줄 전체 시각을 한 번에 맞춤(비터비). 위에서 아래로 같거나 늦고, 간격이 짧을수록 그럴듯함"""
    global _TT
    if _TT is None: _TT = _time_table()
    ts, uniq, idx = _TT
    g = ts[None, :] - ts[:, None]
    trans = np.where(g >= 0, -0.03 * g, -4.0 + 0.2 * g)
    score = None; back = []; margins = []
    for lp in lts:
        ll = ctc_ll(lp, uniq)
        e = np.array([max(ll[u] + p for u, p in fs) for fs in idx])
        top = np.sort(e)[-2:]; margins.append(float(top[1] - top[0]))
        if score is None:
            score = e.copy()
            if after is not None: score += np.where(ts >= after, 0.0, -4.0 + 0.2 * (ts - after))
            back.append(None); continue
        tot = score[:, None] + trans
        b = tot.argmax(0); score = tot[b, np.arange(len(ts))] + e; back.append(b)
    out = [None] * len(lts)
    if lts:
        k = int(score.argmax())
        for i in range(len(lts) - 1, -1, -1):
            out[i] = int(ts[k])
            if back[i] is not None: k = int(back[i][k])
    return out


def recognize(cells):
    def run(name, kind):
        x = np.stack([prep(c[kind], kind) for c in cells])[:, None].astype(np.float32)
        return _onnx(name).run(None, {"x": x})[0]
    lv = log_softmax(run("veh", "veh")); lt = log_softmax(run("time", "time"))
    pc = run("co", "co"); pc = np.exp(log_softmax(pc))
    return lv, lt, pc


def read(img0, known=(), veh_co=None, site_companies=None, after=None):
    """img0: BGR 사진. known: 예전에 온 차량번호들. veh_co: {차량: {업체: 횟수}}. after: 앞 장 마지막 시각(분)"""
    veh_co = veh_co or {}
    model_cos = companies_of_model(); DITTO = len(model_cos)
    best = None
    h, w = img0.shape[:2]
    # 사진 방향: 가로 사진은 그대로/뒤집기, 세로 사진은 왼쪽·오른쪽으로 돌려 보고 더 또렷하게 읽히는 쪽
    # 기록지를 세로로 가까이 찍은 사진도 있으니, 항상 그대로 먼저 → 안 되면 돌려 봄
    tries = [None, cv2.ROTATE_180, cv2.ROTATE_90_COUNTERCLOCKWISE, cv2.ROTATE_90_CLOCKWISE] if w >= h \
        else [None, cv2.ROTATE_90_COUNTERCLOCKWISE, cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_180]
    for rot in tries:
        im = img0 if rot is None else cv2.rotate(img0, rot)
        try:
            cells = cut_cells(im)
        except Exception:
            continue
        inks = [(ink(c["veh"]), ink(c["time"])) for c in cells]
        n = 0
        for a, b in inks:
            if a < BLANK and b < BLANK: break
            n += 1
        if n == 0: continue
        lv, lt, pc = recognize(cells[:n])
        # 제대로 된 방향이면 차량은 4자리, 시간은 '분' 또는 '시:분' 모양으로 읽힘
        vq = np.mean([bool(re.fullmatch(r"\d{4}", greedy(x))) for x in lv])
        tq = np.mean([bool(re.fullmatch(r"(\d{1,2}:)?\d{2}", greedy(x))) for x in lt])
        conf = float(vq + tq) + 0.002 * n
        if VERBOSE: print("  방향", rot, "줄", n, f"차량모양 {vq:.2f} 시간모양 {tq:.2f}")
        if best is None or conf > best[0]: best = (conf, cells[:n], lv, lt, pc)
        if vq + tq > 1.5 and n >= 3: break        # 충분히 또렷하면 다른 방향은 안 봄
    if best is None: return []
    _, cells, lv, lt, pc = best
    known = sorted({k for k in known if re.fullmatch(r"\d{4}", k)})
    rows, prev_co = [], None
    for i in range(len(cells)):
        check = {}
        raw_v = greedy(lv[i]); v = raw_v
        if known:
            kl = ctc_ll(lv[i], known); j = int(kl.argmax())
            free = ctc_ll(lv[i], [raw_v])[0] if re.fullmatch(r"\d+", raw_v) else -1e9
            if not re.fullmatch(r"\d{4}", raw_v) or kl[j] > free - 4.0: v = known[j]
            if v != raw_v and kl[j] < -2.5: check["vehicle_no"] = f"'{raw_v}'로 읽혀 {v}(으)로 맞춤 — 확인"
        if not re.fullmatch(r"\d{4}", v): check["vehicle_no"] = f"'{raw_v}'로 읽힘 — 4자리 확인"
        elif "vehicle_no" not in check and float(np.exp(lv[i].max(-1)).min()) < 0.5:
            check["vehicle_no"] = "흐리게 읽힘 — 확인"
        p = pc[i][:DITTO].copy()
        if prev_co in model_cos: p[model_cos.index(prev_co)] += pc[i][DITTO]
        hist = veh_co.get(v)
        if hist:
            tot = sum(hist.values())
            prior = np.array([(hist.get(c, 0) + 0.2) / (tot + 0.2 * DITTO) for c in model_cos])
            p = p * prior ** 0.7
        p = p / p.sum()
        c = int(p.argmax()); company = model_cos[c]
        if p[c] < 0.8: check["company"] = "업체가 흐리게 읽힘 — 확인"
        # 인식기가 아직 못 배운 새 업체: 이 차량이 늘 그 업체로 왔으면 기록을 따름
        if hist:
            top, cnt = max(hist.items(), key=lambda kv: kv[1])
            if top not in model_cos and cnt >= 2 and cnt >= 0.7 * sum(hist.values()):
                company = top; check["company"] = "이 차량의 지난 기록으로 채움 — 확인"
        if site_companies is not None and company not in site_companies: check["company"] = f"'{company}'는 등록 업체가 아님 — 확인"
        rows.append({"seq": i + 1, "vehicle": v, "company": company, "check": check, "_lt": lt[i]})
        prev_co = company
    times = solve_times([r.pop("_lt") for r in rows], after)
    for r, t in zip(rows, times):
        r["time"] = f"{t // 60}:{t % 60:02d}"
    return rows
