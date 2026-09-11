# voxeled — Grasshopper exporter (a GhPython / Python 3 script component).
#
# Grasshopper is where parametric LED placement really lives: you already Divide Curve, Populate
# Surface, Evaluate Surface for normals. This component takes those results and writes a voxeled
# fixture (.vxl.json) — points + EMISSION NORMALS + strand + order — validated by `vox check`.
#
# Inputs (right-click each and set the type hint to "No type hint" / Point3d / Vector3d):
#   P      points               list  — LED positions in document units (item access: list)
#   N      normals (optional)   list  — emission direction per point; if missing, estimated outward
#   S      strand ids (optional) list — an int per point (which strip/rope it belongs to); default 0
#   Scale  number  — document units → mm (mm doc: 1, metres: 1000, inches: 25.4). Default 1.
#   Pitch  number  — LED spacing in mm (optional; estimated from the points if blank)
#   File   text    — where to write, e.g. C:\art\piece.vxl.json
#   Write  bool    — set True to write the file
# Outputs:
#   JSON   the fixture as text (feed it to a Panel to inspect)
#   Count  number of LEDs
#   Info   what happened
#
# Order matters: the list order of P is the DATA order voxeled will address (pixel i → byte i*3).
# Works in both IronPython 2.7 and CPython 3 components.

import json
import math


def _xyz(p):
    """Point3d/Vector3d (X, Y, Z) or a tuple/list → [x, y, z]."""
    if hasattr(p, "X"):
        return [float(p.X), float(p.Y), float(p.Z)]
    return [float(p[0]), float(p[1]), float(p[2])]


def _norm(v):
    l = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    return [v[0] / l, v[1] / l, v[2] / l] if l > 1e-12 else [1.0, 0.0, 0.0]


def to_fixture(points, normals=None, strands=None, scale=1.0, pitch=None, name="grasshopper"):
    """Pure conversion: lists of points/normals/strand ids → a voxeled fixture dict (mm)."""
    pts = [_xyz(p) for p in points]
    if not pts:
        raise ValueError("no points")
    had_normals = bool(normals) and len(normals) == len(pts)
    if had_normals:
        nrm = [_norm(_xyz(n)) for n in normals]
    else:  # estimate: outward from the centroid (verify in the viewer with N)
        c = [sum(p[k] for p in pts) / len(pts) for k in range(3)]
        nrm = [_norm([p[0] - c[0], p[1] - c[1], p[2] - c[2]]) for p in pts]
    sid = [int(s) for s in strands] if strands and len(strands) == len(pts) else [0] * len(pts)
    # s along each strand, in data order
    counts, seen = {}, {}
    for s in sid:
        counts[s] = counts.get(s, 0) + 1
    pixels = []
    for i, p in enumerate(pts):
        k = seen.get(sid[i], 0)
        seen[sid[i]] = k + 1
        n = counts[sid[i]]
        pixels.append({
            "i": i,
            "p": [round(p[0] * scale, 3), round(p[1] * scale, 3), round(p[2] * scale, 3)],
            "n": [round(nrm[i][0], 4), round(nrm[i][1], 4), round(nrm[i][2], 4)],
            "s": round(float(k) / (n - 1), 5) if n > 1 else 0.0, "v": 0.0, "strand": sid[i],
        })
    if pitch is None:
        steps = []
        for i in range(1, len(pixels)):
            if pixels[i]["strand"] == pixels[i - 1]["strand"]:
                a, b = pixels[i]["p"], pixels[i - 1]["p"]
                steps.append(math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2))
        steps.sort()
        pitch = round(steps[len(steps) // 2], 3) if steps else 10.0
    return {
        "pixels": pixels,
        "meta": {"source": name, "units": "mm", "pitchMM": pitch, "points": len(pixels), "strands": len(counts), "hadNormals": had_normals},
    }


def main():
    g = globals()
    P_ = g.get("P") or []
    fx = to_fixture(P_, g.get("N"), g.get("S"), scale=float(g.get("Scale") or 1.0), pitch=g.get("Pitch"))
    text = json.dumps(fx)
    info = "{0} LEDs, {1} strand(s), pitch {2} mm, normals {3}".format(fx["meta"]["points"], fx["meta"]["strands"], fx["meta"]["pitchMM"], "given" if fx["meta"]["hadNormals"] else "ESTIMATED (check with N in the viewer)")
    if g.get("Write") and g.get("File"):
        with open(g["File"], "w") as f:
            f.write(text)
        info += " -> wrote " + str(g["File"])
    g["JSON"], g["Count"], g["Info"] = text, fx["meta"]["points"], info


if "P" in globals():  # running inside a Grasshopper component
    main()
