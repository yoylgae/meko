"""표 선 → 양식 비율에 맞춰 세로 25줄·가로 22줄 확정 → 칸 잘라내기"""
import cv2, numpy as np, sys, os, json
import grid
from grid import build, at, masks

COL_FR = [0.0, 0.153, 0.484, 0.674]          # 묶음 안 세로선 위치(번호|차량|업체|시간)
T_V = [k + f for k in range(6) for f in COL_FR] + [6.0]   # 25개 (묶음 단위)
N_H = 22                                        # 머리글 위·아래 + 20줄

def curve_x(L, y): return at(L, y)
def curve_y(L, x): return at(L, x)

def fit_template(cands, T, pos, tol_frac):
    """후보 선들(pos(L)=기준 위치)을 템플릿 T(선 간격 패턴)에 맞춤.
    양 끝 선에 기대지 않고, 후보 두 개 × 템플릿 두 개로 만든 모든 직선 대응 중 가장 많이 맞는 것을 고른 뒤(RANSAC),
    맞은 선들로 2차 보정. 반환: T 길이의 [선 또는 None], 매핑 계수"""
    p = np.array([pos(L) for L in cands]); T = np.array(T, float)
    n = len(p)
    # 후보 수가 딱 맞고 간격이 고르게 변하면(원근만 있는 경우) 순서대로 대응
    if n == len(T):
        g = np.diff(p)
        if g.min() > 0 and np.all(g[1:] / g[:-1] > 0.75) and np.all(g[1:] / g[:-1] < 1.33) or \
           (g.min() > 0.6 * np.median(g) and g.max() < 1.7 * np.median(g)):
            return list(cands), np.polyfit(T, p, 2)
    best = (-1, 1e18, None)
    gapT = np.min(np.diff(T))
    for a in range(n):
        for b in range(a + 1, n):
            for i in range(len(T)):
                for j in range(i + 1, len(T)):
                    scale = (p[b] - p[a]) / (T[j] - T[i])
                    if scale <= 0: continue
                    pred = p[a] + (T - T[i]) * scale
                    d = np.abs(p[None, :] - pred[:, None]).min(1)
                    tol = tol_frac * gapT * scale
                    ok = d < tol
                    score = (ok.sum(), -d[ok].sum())
                    if (score[0], score[1]) > (best[0], -best[1]):
                        best = (score[0], -score[1], (p[a] - T[i] * scale, scale))
    c0, sc = best[2]
    coef = np.array([0.0, sc, c0])
    for _ in range(4):
        pred = np.polyval(coef, T)
        dg = np.diff(pred)
        lg = np.minimum(np.r_[dg[0], dg], np.r_[dg, dg[-1]])   # 그 자리의 선 간격 (원근으로 위아래가 다름)
        match = [None] * len(T); used = set()
        for i, x in enumerate(pred):
            j = int(np.argmin(np.abs(p - x)))
            if abs(p[j] - x) < tol_frac * lg[i] and j not in used:
                match[i] = j; used.add(j)
        ti = [T[i] for i in range(len(T)) if match[i] is not None]
        pi = [p[match[i]] for i in range(len(T)) if match[i] is not None]
        if len(ti) >= 8: coef = np.polyfit(ti, pi, 3)
        elif len(ti) >= 6: coef = np.polyfit(ti, pi, 2)
    return [cands[m] if m is not None else None for m in match], coef

def match_columns(Vc, ymid, table_h, xlo=-1e9, xhi=1e9):
    """묶음 경계 7개를 고르는 DP: 각 묶음 안에 양식 비율대로 칸 선 3개가 있고, 이웃 묶음 폭이 비슷해야 함.
    사진 밖으로 잘린 맨 끝 경계는 이웃 묶음 폭으로 추정."""
    # 표 밖(집게·옆 종이)의 세로선은 빼기: 가로선이 시작·끝나는 곳이 표의 좌우 끝
    cand = [L for L in Vc if L["span"] > 0.35 * table_h and xlo <= curve_x(L, ymid) <= xhi]
    xs = np.array([curve_x(L, ymid) for L in cand]); n = len(xs)
    inner = COL_FR[1:]
    def block(xa, xb):
        wdt = xb - xa
        if wdt < 150: return -1e9, None
        sc, picks = 0.0, []
        for f in inner:
            d = np.abs(xs - (xa + f * wdt)); j = int(np.argmin(d)); tol = 0.06 * wdt
            if d[j] < tol: sc += 1 - d[j] / tol; picks.append(j)
            else: picks.append(None)
        return sc, picks
    BS = {}
    for i in range(n):
        for j in range(i + 1, n):
            BS[(i, j)] = block(xs[i], xs[j])[0]
    # dp[(prev,last)] = (점수, 경계 목록)
    best = None
    dp = {(i, j): (BS[(i, j)] + 0.5, [i, j]) for (i, j) in BS if BS[(i, j)] > 1.0}
    for step in range(5):  # 경계 2개 → 7개
        nd = {}
        for (i, j), (sc, path) in dp.items():
            w0 = xs[j] - xs[i]
            for k in range(j + 1, n):
                w1 = xs[k] - xs[j]
                if not (0.82 < w1 / w0 < 1.22): continue
                v = sc + BS[(j, k)] + 0.5
                if (j, k) not in nd or nd[(j, k)][0] < v: nd[(j, k)] = (v, path + [k])
        # 여기서 끝내고 사진 밖으로 잘린 양 끝 경계를 추정하는 경우도 후보
        for (i, j), (sc, path) in dp.items():
            m = len(path)
            if m in (5, 6):
                miss = 7 - m
                for nl in range(miss + 1):
                    v2 = sc - 0.8 * miss
                    if best is None or v2 > best[0]: best = (v2, path, (nl, miss - nl))
        dp = nd
    for (i, j), (sc, path) in dp.items():
        if len(path) == 7 and (best is None or sc > best[0]): best = (sc, path, None)
    if best is None: raise RuntimeError("묶음 경계를 찾지 못함")
    sc, path, side = best
    bxs = [xs[i] for i in path]; lines = [cand[i] for i in path]
    nl, nr = side if side else (0, 0)
    for _ in range(nr): bxs.append(2 * bxs[-1] - bxs[-2]); lines.append(None)
    for _ in range(nl): bxs.insert(0, 2 * bxs[0] - bxs[1]); lines.insert(0, None)
    out = [None] * len(T_V)
    for k in range(7): out[min(k * 4, 24)] = lines[k]
    for k in range(6):
        _, picks = block(bxs[k], bxs[k + 1])
        for c, pj in enumerate(picks, start=1):
            if pj is not None: out[k * 4 + c] = cand[pj]
    return out

def lattice(tag):
    img, V, H = build(f"in/{tag}.jpg" if isinstance(tag, str) else tag, "out", tag if isinstance(tag, str) else "img")
    h, w = img.shape[:2]
    # 가로선: 22줄. 첫 해: 세로 기준 위치 = 표 가운데에서의 y
    # 표 폭의 절반도 안 되는 짧은 가로선(집게·종이 끝 등)은 제외
    maxspan = max(L["span"] for L in H)
    Hc = [L for L in H if L["span"] > 0.5 * maxspan]
    # 표 왼쪽 끝까지 오지 않고 한참 오른쪽에서 시작하는 선(집게·종이 끝 그림자)은 표 선이 아님
    um = np.median([L["umin"] for L in Hc])
    Hc = sorted([L for L in Hc if L["umin"] < um + 0.06 * w], key=lambda L: curve_y(L, w / 2))
    ys = np.array([curve_y(L, w / 2) for L in Hc])
    # 연속 간격 중 가장 흔한 값 = 줄 높이
    rowh = np.median(np.diff(ys))
    T_H = list(range(N_H))
    Hm, _ = fit_template(Hc, T_H, lambda L: curve_y(L, w / 2), 0.35)
    # 세로선: 묶음 경계(굵은 선)를 먼저 확정하고, 묶음마다 양식 비율로 칸 선을 맞춤 (원근으로 묶음 폭이 달라도 됨)
    table_h = ys.max() - ys.min()
    ymid = (ys.min() + ys.max()) / 2
    Vc = sorted([L for L in V if L["span"] > 0.35 * table_h], key=lambda L: curve_x(L, ymid))
    umin = np.median([L["umin"] for L in Hc]); umax = np.median([L["umax"] for L in Hc])
    Vm = match_columns(Vc, ymid, table_h, umin - 40, umax + 0.2 * (umax - umin))
    if grid.VERBOSE: print(tag, "가로선 맞춤", sum(m is not None for m in Hm), "/", N_H, " 세로선 맞춤", sum(m is not None for m in Vm), "/", len(T_V))

    # 교점 격자 P[j][i] (못 찾은 선은 이웃 선 사이를 보간)
    def interp(lines, T):
        idx = [i for i, L in enumerate(lines) if L is not None]
        return idx
    vidx = interp(Vm, T_V); hidx = interp(Hm, T_H)

    def vx(i, y):
        if Vm[i] is not None: return curve_x(Vm[i], y)
        a = max(k for k in vidx if k < i) if any(k < i for k in vidx) else None
        b = min(k for k in vidx if k > i) if any(k > i for k in vidx) else None
        if a is None or b is None:  # 끝: 가까운 두 선으로 외삽
            k1, k2 = (vidx[0], vidx[1]) if a is None else (vidx[-2], vidx[-1])
            x1, x2 = curve_x(Vm[k1], y), curve_x(Vm[k2], y)
            return x1 + (x2 - x1) * (T_V[i] - T_V[k1]) / (T_V[k2] - T_V[k1])
        xa, xb = curve_x(Vm[a], y), curve_x(Vm[b], y)
        return xa + (xb - xa) * (T_V[i] - T_V[a]) / (T_V[b] - T_V[a])
    def hy(j, x):
        if Hm[j] is not None: return curve_y(Hm[j], x)
        a = max((k for k in hidx if k < j), default=None); b = min((k for k in hidx if k > j), default=None)
        if a is None or b is None:
            k1, k2 = (hidx[0], hidx[1]) if a is None else (hidx[-2], hidx[-1])
            y1, y2 = curve_y(Hm[k1], x), curve_y(Hm[k2], x)
            return y1 + (y2 - y1) * (j - k1) / (k2 - k1)
        ya, yb = curve_y(Hm[a], x), curve_y(Hm[b], x)
        return ya + (yb - ya) * (j - a) / (b - a)

    P = np.zeros((N_H, len(T_V), 2))
    for j in range(N_H):
        for i in range(len(T_V)):
            x = vx(i, ys.mean()); y = hy(j, x)
            for _ in range(15): x = vx(i, y); y = hy(j, x)
            P[j, i] = (x, y)
    return img, refine_rows(img, refine_cols(img, P))

def refine_cols(img, P):
    """휘어진 곳: 세로선 교점을 실제 세로선 흔적에 좌우로 맞춤. 가운데 줄에서 위·아래로 퍼져 나감"""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    bw, _, _ = masks(g)
    vl = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, 20)))
    vl = cv2.GaussianBlur(cv2.dilate(vl, np.ones((1, 3), np.uint8)).astype(np.float32) / 255, (5, 1), 0)
    H_, W_ = vl.shape
    nj, ni = P.shape[:2]
    Q = P.copy()
    mid = nj // 2
    offs = np.zeros((nj, ni))
    order = [mid] + [j for d in range(1, nj) for j in (mid - d, mid + d) if 0 <= j < nj]
    for j in order:
        prior = offs[j + 1] if j < mid else offs[j - 1] if j > mid else np.zeros(ni)
        for i in range(ni):
            cw = np.median(np.diff(P[j, :, 0])) if ni > 1 else 50
            ya = (P[j - 1, i, 1] + P[j, i, 1]) / 2 if j > 0 else P[j, i, 1]
            yb = (P[j, i, 1] + P[j + 1, i, 1]) / 2 if j < nj - 1 else P[j, i, 1]
            xa = (P[j - 1, i, 0] + P[j, i, 0]) / 2 if j > 0 else P[j, i, 0]
            xb = (P[j, i, 0] + P[j + 1, i, 0]) / 2 if j < nj - 1 else P[j, i, 0]
            ys = np.linspace(ya, yb, 30); base = np.linspace(xa, xb, 30) + prior[i]
            ok = (ys >= 0) & (ys < H_ - 1)
            best, bd = -1, 0.0
            rng = 0.25 * min(cw, 60)
            for d in np.arange(-rng, rng + 0.1, 1.0):
                xx = np.clip(base + d, 0, W_ - 1).astype(int)
                v = vl[ys[ok].astype(int), xx[ok]].mean() - 0.002 * abs(d)
                if v > best: best, bd = v, d
            offs[j, i] = prior[i] + (bd if best > 0.35 else 0)
    Q[:, :, 0] += offs
    return Q

def refine_rows(img, P):
    """종이가 처진 곳: 가로선 교점마다 실제 가로선 흔적(가로선 마스크)에 위아래로 맞춤.
    위 줄에서 찾은 어긋남을 다음 줄의 출발점으로 넘겨서, 아래로 갈수록 커지는 어긋남도 따라감"""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    bw, _, _ = masks(g)
    # 기울어진 선도 잡히게 짧은 가로 막대(20px)로만 거름
    hl = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (20, 1)))
    hl = cv2.GaussianBlur(cv2.dilate(hl, np.ones((3, 1), np.uint8)).astype(np.float32) / 255, (1, 5), 0)
    H_, W_ = hl.shape
    nj, ni = P.shape[:2]
    Q = P.copy()
    prior = np.zeros(ni)
    for j in range(nj):
        rh = np.median(P[min(j + 1, nj - 1), :, 1] - P[max(j - 1, 0), :, 1]) / (2 if 0 < j < nj - 1 else 1)
        offs = np.zeros(ni)
        for i in range(ni):
            xa = (P[j, i - 1, 0] + P[j, i, 0]) / 2 if i > 0 else P[j, i, 0]
            xb = (P[j, i, 0] + P[j, i + 1, 0]) / 2 if i < ni - 1 else P[j, i, 0]
            ya = (P[j, i - 1, 1] + P[j, i, 1]) / 2 if i > 0 else P[j, i, 1]
            yb = (P[j, i, 1] + P[j, i + 1, 1]) / 2 if i < ni - 1 else P[j, i, 1]
            xs = np.linspace(xa, xb, 40); base = np.linspace(ya, yb, 40) + prior[i]
            ok = (xs >= 0) & (xs < W_ - 1)
            if ok.sum() < 10: offs[i] = prior[i]; continue
            best, bd = -1, 0.0
            lo_, hi_ = (-0.3, 0.8) if j == nj - 1 else (-0.8, 0.3) if j == 0 else (-0.42, 0.42)
            for d in np.arange(lo_ * rh, hi_ * rh + 0.1, 1.0):
                yy = np.clip(base + d, 0, H_ - 1).astype(int)
                v = hl[yy[ok], xs[ok].astype(int)].mean() - 0.002 * abs(d)
                if v > best: best, bd = v, d
            offs[i] = prior[i] + (bd if best > 0.35 else 0)
        # 이웃 교점끼리 튀지 않게 살짝 부드럽게
        sm = offs.copy()
        for i in range(ni):
            nb = offs[max(0, i - 1): i + 2]
            sm[i] = np.median(nb)
        Q[j, :, 1] += sm
        prior = sm
    return Q

def warp(img, q, W, Hh):
    src = np.float32(q); dst = np.float32([[0, 0], [W, 0], [W, Hh], [0, Hh]])
    return cv2.warpPerspective(img, cv2.getPerspectiveTransform(src, dst), (W, Hh), flags=cv2.INTER_CUBIC)

def cut(tag):
    img, P = lattice(tag)
    os.makedirs(f"out/{tag}_cells", exist_ok=True)
    vis = img.copy()
    for j in range(N_H):
        cv2.polylines(vis, [P[j].astype(np.int32)], False, (0, 170, 0), 2)
    for i in range(P.shape[1]):
        cv2.polylines(vis, [P[:, i].astype(np.int32)], False, (0, 0, 255) if i % 4 == 0 else (255, 0, 0), 2)
    cv2.imwrite(f"out/{tag}_lattice.jpg", cv2.resize(vis, (1100, int(vis.shape[0] * 1100 / vis.shape[1]))))
    # 데이터 줄 j=1..20 (j=0은 머리글), 묶음 k, 칸 c(1=차량,2=업체,3=시간)
    cells = {}
    pad = 3  # 선 두께만큼 안쪽으로
    for k in range(6):
        for r in range(20):
            seq = k * 20 + r + 1
            for c, name, W in ((1, "veh", 240), (2, "co", 140), (3, "time", 200)):
                i = k * 4 + c
                q = [P[r + 1, i], P[r + 1, i + 1], P[r + 2, i + 1], P[r + 2, i]]
                crop = warp(img, q, W + 2 * pad, 64 + 2 * pad)[pad:-pad, pad:-pad]
                cv2.imwrite(f"out/{tag}_cells/{seq:03d}_{name}.png", crop)
                cells[(seq, name)] = crop
    return cells

def sheet(tag, cells, seqs, out):
    rows = []
    for s in seqs:
        row = [cells[(s, n)] for n in ("veh", "co", "time")]
        lab = np.full((64, 60, 3), 255, np.uint8)
        cv2.putText(lab, str(s), (4, 42), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 2)
        sep = np.full((64, 6, 3), 200, np.uint8)
        rows.append(np.hstack([lab, row[0], sep, row[1], sep, row[2]]))
        rows.append(np.full((4, rows[-1].shape[1], 3), 200, np.uint8))
    cv2.imwrite(out, np.vstack(rows))

if __name__ == "__main__":
    for tag in sys.argv[1:]:
        cells = cut(tag)
        sheet(tag, cells, [1, 2, 13, 20, 21, 36, 41, 54, 60, 61, 80, 81, 96, 100], f"out/{tag}_sample.png")
