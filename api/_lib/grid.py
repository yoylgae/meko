"""기록지 사진 → 표 선(곡선 허용) 찾기 → 칸 120×(번호/차량/업체/시간) 잘라내기"""
import cv2, numpy as np, sys, os, json

W_WORK = 1800
VERBOSE = True  # 작업 해상도(가로)

def masks(g):
    h, w = g.shape
    bw = cv2.adaptiveThreshold(g, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 31, 12)
    hl = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (w // 40, 1)))
    vl = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, h // 40)))
    return bw, hl, vl

def pieces(mask, axis):
    """axis='h': 가로선 조각들 [(xs, ys)], 'v': 세로선"""
    n, lab, st, _ = cv2.connectedComponentsWithStats(mask, 8)
    out = []
    for i in range(1, n):
        x, y, ww, hh, area = st[i]
        length = ww if axis == "h" else hh
        if length < 25: continue
        ys, xs = np.where(lab[y:y + hh, x:x + ww] == i)
        out.append((xs + x, ys + y, area / max(length, 1)))
    return out

def group_lines(ps, axis, tol):
    """조각들을 같은 선끼리 묶고 2차 곡선으로 맞춤. 가로선: y=f(x), 세로선: x=f(y)"""
    def coords(p):
        xs, ys, th = p
        return (xs, ys) if axis == "h" else (ys, xs)  # (독립변수, 종속변수)
    ps = sorted(ps, key=lambda p: -len(p[0]))
    lines = []  # dict(u, v, thick)
    for p in ps:
        u, v = coords(p)
        uc, vc = u.mean(), v.mean()
        best, bd = None, tol
        for L in lines:
            deg = 2 if (L["u"].max() - L["u"].min()) > 400 else 1
            f = np.polyfit(L["u"], L["v"], deg)
            d = abs(np.polyval(f, uc) - vc)
            # 조각 양 끝도 맞아야 함
            d = max(d, abs(np.polyval(f, u.min()) - v[u.argmin()]), abs(np.polyval(f, u.max()) - v[u.argmax()]))
            if d < bd: bd, best = d, L
        if best is None:
            lines.append({"u": u.astype(float), "v": v.astype(float), "thick": [p[2]] * 1})
        else:
            best["u"] = np.concatenate([best["u"], u]); best["v"] = np.concatenate([best["v"], v]); best["thick"].append(p[2])
    # 한 선이 두 조각으로 갈라진 경우(가운데가 끊기거나 휘어서): 이어지는 지점에서 높이가 같으면 합침
    merged = True
    while merged:
        merged = False
        for a in range(len(lines)):
            for b in range(len(lines)):
                if a == b: continue
                A, B = lines[a], lines[b]
                if A["u"].max() > B["u"].min() + 60: continue          # A가 B 왼쪽(위쪽)에 있어야
                if B["u"].min() - A["u"].max() > 300: continue
                j = (A["u"].max() + B["u"].min()) / 2
                fa = np.polyfit(A["u"], A["v"], 1 if np.ptp(A["u"]) < 400 else 2)
                fb = np.polyfit(B["u"], B["v"], 1 if np.ptp(B["u"]) < 400 else 2)
                # 끝부분 짧은 구간 기울기로 이음매 높이 비교
                ea = A["u"] > A["u"].max() - 150; eb = B["u"] < B["u"].min() + 150
                la = np.polyfit(A["u"][ea], A["v"][ea], 1) if ea.sum() > 20 else fa
                lb = np.polyfit(B["u"][eb], B["v"][eb], 1) if eb.sum() > 20 else fb
                if abs(np.polyval(la, j) - np.polyval(lb, j)) < tol * 0.8:
                    A["u"] = np.concatenate([A["u"], B["u"]]); A["v"] = np.concatenate([A["v"], B["v"]]); A["thick"] += B["thick"]
                    lines.pop(b); merged = True; break
            if merged: break
    res = []
    for L in lines:
        span = L["u"].max() - L["u"].min()
        # 길게 이어진 선은 3차까지 (종이가 처지거나 휜 부분을 따라가게)
        deg = 3 if (span > 1000 and len(L["u"]) > 2000) else 2 if span > 400 else 1
        f = np.polyfit(L["u"], L["v"], deg)
        res.append({"f": f, "umin": L["u"].min(), "umax": L["u"].max(), "span": span,
                    "thick": float(np.median(L["thick"]))})
    return res

def at(L, u): return np.polyval(L["f"], u)

def intersect(H, V):
    """가로선 y=H(x), 세로선 x=V(y)의 교점"""
    x = np.polyval(V["f"], np.polyval(H["f"], (V["umin"] + V["umax"]) / 2) if False else 0)
    x = (V["umin"] + V["umax"]) / 2  # 시작값 아무거나
    y = at(H, x)
    for _ in range(20):
        x = at(V, y); y = at(H, x)
    return x, y

def build(path, outdir, tag):
    img0 = cv2.imread(path) if isinstance(path, str) else path
    s = W_WORK / img0.shape[1]
    img = cv2.resize(img0, (W_WORK, int(img0.shape[0] * s)), interpolation=cv2.INTER_AREA)
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    h, w = g.shape
    bw, hl, vl = masks(g)

    V = group_lines(pieces(vl, "v"), "v", tol=w / 120)
    H = group_lines(pieces(hl, "h"), "h", tol=h / 110)
    # 표의 일부인 긴 선만
    V = [L for L in V if L["span"] > h * 0.25]
    H = [L for L in H if L["span"] > w * 0.25]
    # 표 세로 범위(세로선 대부분이 덮는 구간) 안의 가로선만 — 종이 끝·클립 제거
    top = np.median([L["umin"] for L in V]); bot = np.percentile([L["umax"] for L in V], 75)
    H = [L for L in H if top - h * 0.03 < at(L, w / 2) < bot + h * 0.06]
    V.sort(key=lambda L: at(L, h / 2)); H.sort(key=lambda L: at(L, w / 2))
    if VERBOSE: print(tag, "세로선", len(V), "가로선", len(H))
    return img, V, H

def lattice(img, V, H, tag, outdir):
    vis = img.copy()
    for L in V:
        ys = np.linspace(L["umin"], L["umax"], 50); xs = at(L, ys)
        cv2.polylines(vis, [np.stack([xs, ys], 1).astype(np.int32)], False, (0, 0, 255) if L["thick"] > 3.2 else (255, 0, 0), 2)
    for L in H:
        xs = np.linspace(L["umin"], L["umax"], 50); ys = at(L, xs)
        cv2.polylines(vis, [np.stack([xs, ys], 1).astype(np.int32)], False, (0, 160, 0), 2)
    cv2.imwrite(f"{outdir}/{tag}_lines.jpg", cv2.resize(vis, (1100, int(vis.shape[0] * 1100 / vis.shape[1]))))

if __name__ == "__main__":
    for tag in sys.argv[1:]:
        img, V, H = build(f"/home/claude/ocr-lab/in/{tag}.jpg", "/home/claude/ocr-lab/out", tag)
        print([round(L["thick"], 1) for L in V])
        lattice(img, V, H, tag, "/home/claude/ocr-lab/out")
