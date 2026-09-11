# voxeled — Blender exporter.  File ▸ Export ▸ voxeled fixture (.vxl.json)
#
# Bakes LED positions + EMISSION NORMALS out of Blender into a voxeled fixture — the "bake in the
# tool, one baked interchange" principle. What becomes an LED:
#   MESH   (mode 'vertices')  each vertex, with its vertex normal            — point-cloud style
#          (mode 'faces')     each face centre, with the face normal         — panels modelled as quads
#          (mode 'islands')   each connected island (a modelled LED chip):
#                             centroid + the chip's thin axis as the normal — the chip-island idea
#   CURVE  sampled every `pitch` mm along the evaluated curve; the LED sits `voxeled_radius` off the
#          axis at `voxeled_angle`° around it (a rope zip-tied to a tube) with a RADIAL normal —
#          the same parallel-transport construction as voxeled's `rope` fixture
#   EMPTY  its origin, normal = its local +Z                                  — a single LED, aimed
# Per-object custom properties override the operator defaults: voxeled_mode, voxeled_angle,
# voxeled_radius, voxeled_pitch. Each object is one STRAND (data order = vertex / curve order);
# `s` runs 0→1 along it. Positions are world-space, scaled to millimetres from the scene's units.
#
# The geometry core (`fixture_from_objects`) is pure Python — no bpy — so it is unit-tested outside
# Blender; `collect()` is the thin bpy layer. Validate the result with `vox check`.

bl_info = {
    "name": "voxeled fixture export (.vxl.json)",
    "author": "voxeled",
    "version": (0, 1, 0),
    "blender": (4, 2, 0),
    "location": "File > Export > voxeled fixture (.vxl.json)",
    "description": "Export LED positions + emission normals (mesh vertices/faces/islands, curves, empties) as a voxeled fixture",
    "category": "Import-Export",
}

import json
import math

# ── pure geometry core (no bpy) ───────────────────────────────────────────────

def _sub(a, b): return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
def _add(a, b): return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
def _scale(a, s): return [a[0] * s, a[1] * s, a[2] * s]
def _dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def _cross(a, b): return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
def _len(a): return math.sqrt(_dot(a, a))
def _norm(a):
    l = _len(a)
    return [a[0] / l, a[1] / l, a[2] / l] if l > 1e-12 else [1.0, 0.0, 0.0]


def sample_polyline(P, spacing=None, count=None, start=0.0):
    """Points along a polyline by arclength: [(p, tangent, s_along)]."""
    if len(P) < 2:
        raise ValueError("a curve needs at least two points")
    cum = [0.0]
    for i in range(1, len(P)):
        cum.append(cum[-1] + _len(_sub(P[i], P[i - 1])))
    L = cum[-1]
    if count is None:
        if not spacing or spacing <= 0:
            raise ValueError("give spacing or count")
        count = max(1, int((L - start) // spacing) + 1)
    step = spacing if spacing else ((L - start) / (count - 1) if count > 1 else 0.0)
    out, seg = [], 0
    for k in range(count):
        s = min(L, start + k * step)
        while seg < len(P) - 2 and cum[seg + 1] < s:
            seg += 1
        seglen = max(1e-12, cum[seg + 1] - cum[seg])
        f = max(0.0, min(1.0, (s - cum[seg]) / seglen))
        p = _add(P[seg], _scale(_sub(P[seg + 1], P[seg]), f))
        t = _norm(_sub(P[seg + 1], P[seg]))
        if f > 0.999 and seg + 2 < len(P):
            t = _norm(_add(t, _norm(_sub(P[seg + 2], P[seg + 1]))))
        out.append((p, t, s))
    return out


def transport_frames(samples, up=(0.0, 0.0, 1.0)):
    """Parallel-transport (T, N, B) along sampled points; N₀ = up projected ⟂ T (place_leds.py)."""
    N = None
    out = []
    for p, T, s in samples:
        if N is None:
            n0 = _cross(T, up)
            if _len(n0) < 1e-6:
                n0 = _cross(T, (0.0, 1.0, 0.0))
            N = _norm(_cross(n0, T))
        else:
            N = _norm(_sub(N, _scale(T, _dot(N, T))))
        B = _cross(T, N)
        out.append((p, T, N, B, s))
    return out


def _islands(verts, faces):
    """Connected components of a mesh → list of vertex-index lists."""
    parent = list(range(len(verts)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for f in faces:
        r = find(f[0])
        for v in f[1:]:
            parent[find(v)] = r
    groups = {}
    for i in range(len(verts)):
        groups.setdefault(find(i), []).append(i)
    return list(groups.values())


def _thin_axis(points):
    """Smallest principal axis of a point set (unit), via a tiny Jacobi eigen solve."""
    n = len(points)
    c = [sum(p[k] for p in points) / n for k in range(3)]
    a = [[0.0] * 3 for _ in range(3)]
    for p in points:
        d = _sub(p, c)
        for i in range(3):
            for j in range(3):
                a[i][j] += d[i] * d[j] / n
    v = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
    for _ in range(60):
        p, q, mx = 0, 1, abs(a[0][1])
        if abs(a[0][2]) > mx: p, q, mx = 0, 2, abs(a[0][2])
        if abs(a[1][2]) > mx: p, q, mx = 1, 2, abs(a[1][2])
        if mx < 1e-14:
            break
        theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
        t = (1 if theta >= 0 else -1) / (abs(theta) + math.sqrt(theta * theta + 1))
        cs = 1 / math.sqrt(t * t + 1); sn = t * cs
        for k in range(3):
            akp, akq = a[k][p], a[k][q]; a[k][p] = cs * akp - sn * akq; a[k][q] = sn * akp + cs * akq
        for k in range(3):
            apk, aqk = a[p][k], a[q][k]; a[p][k] = cs * apk - sn * aqk; a[q][k] = sn * apk + cs * aqk
        for k in range(3):
            vkp, vkq = v[k][p], v[k][q]; v[k][p] = cs * vkp - sn * vkq; v[k][q] = sn * vkp + cs * vkq
    vals = [a[0][0], a[1][1], a[2][2]]
    j = vals.index(min(vals))
    return c, _norm([v[0][j], v[1][j], v[2][j]])


def fixture_from_objects(objs, scale_to_mm=1000.0, pitch_mm=None, mesh_mode="vertices", normal_sign="outward", up=(0.0, 0.0, 1.0)):
    """objs: list of dicts from collect() (world-space, Blender units). Returns a voxeled fixture dict."""
    pixels, strands = [], []
    all_centroid = [0.0, 0.0, 0.0]
    count_c = 0
    for o in objs:
        for p in o.get("verts", []) or [o.get("origin")] if o.get("type") == "EMPTY" else o.get("verts", []):
            if p:
                all_centroid = _add(all_centroid, p); count_c += 1
    if count_c:
        all_centroid = _scale(all_centroid, 1.0 / count_c)

    def sign_fix(p, n):
        if normal_sign == "outward" and _dot(n, _sub(p, all_centroid)) < 0:
            return _scale(n, -1.0)
        if normal_sign == "inward" and _dot(n, _sub(p, all_centroid)) > 0:
            return _scale(n, -1.0)
        return n

    for si, o in enumerate(objs):
        typ = o.get("type")
        mode = o.get("mode") or mesh_mode
        strand_px = []
        if typ == "MESH":
            verts, normals, faces = o["verts"], o.get("normals") or [], o.get("faces") or []
            if mode == "faces":
                for (centre, normal) in zip(o.get("face_centers", []), o.get("face_normals", [])):
                    strand_px.append((centre, _norm(normal)))
            elif mode == "islands":
                for isl in _islands(verts, faces):
                    if len(isl) < 3:
                        continue
                    c, axis = _thin_axis([verts[i] for i in isl])
                    strand_px.append((c, sign_fix(c, axis)))
            else:
                for i, p in enumerate(verts):
                    n = _norm(normals[i]) if i < len(normals) else sign_fix(p, _norm(_sub(p, all_centroid)))
                    strand_px.append((p, n))
        elif typ == "CURVE":
            pitch = (o.get("pitch") or pitch_mm)
            if not pitch:
                raise ValueError("curve '%s': set voxeled_pitch (mm) or the export pitch" % o.get("name"))
            radius = (o.get("radius") or 0.0) / scale_to_mm   # given in mm → blender units
            angle = math.radians(o.get("angle") or 0.0)
            for pl in o.get("polylines", []):
                frames = transport_frames(sample_polyline(pl, spacing=pitch / scale_to_mm), up=up)
                for (p, T, N, B, s) in frames:
                    D = _add(_scale(N, math.cos(angle)), _scale(B, math.sin(angle)))
                    strand_px.append((_add(p, _scale(D, radius)), D))
        elif typ == "EMPTY":
            strand_px.append((o["origin"], _norm(o.get("zaxis") or [0.0, 0.0, 1.0])))
        n = len(strand_px)
        for k, (p, nrm) in enumerate(strand_px):
            pixels.append({
                "i": len(pixels),
                "p": [round(p[0] * scale_to_mm, 3), round(p[1] * scale_to_mm, 3), round(p[2] * scale_to_mm, 3)],
                "n": [round(nrm[0], 4), round(nrm[1], 4), round(nrm[2], 4)],
                "s": round(k / (n - 1), 5) if n > 1 else 0.0, "v": 0.0, "strand": si,
            })
        strands.append({"name": o.get("name"), "type": typ, "mode": mode if typ == "MESH" else None, "count": n})
    if not pixels:
        raise ValueError("nothing exported — select meshes, curves or empties")
    # pitch: the median nearest step along the data order
    steps = sorted(_len(_sub(pixels[i]["p"], pixels[i - 1]["p"])) for i in range(1, len(pixels)) if pixels[i]["strand"] == pixels[i - 1]["strand"])
    pitch = round(steps[len(steps) // 2], 3) if steps else (pitch_mm or 10)
    return {
        "pixels": pixels,
        "meta": {"source": "blender", "units": "mm", "pitchMM": pitch, "points": len(pixels), "strands": strands, "hadNormals": True},
    }


# ── bpy layer ─────────────────────────────────────────────────────────────────

def collect(objects, depsgraph=None):
    """Turn Blender objects into the plain dicts the core consumes (world-space, Blender units)."""
    import bpy  # noqa: F401  (only here)
    from mathutils import Vector
    dg = depsgraph or bpy.context.evaluated_depsgraph_get()
    out = []
    for obj in objects:
        d = {"name": obj.name, "type": obj.type, "mode": obj.get("voxeled_mode"), "angle": obj.get("voxeled_angle"), "radius": obj.get("voxeled_radius"), "pitch": obj.get("voxeled_pitch")}
        M = obj.matrix_world
        if obj.type == "MESH":
            ev = obj.evaluated_get(dg)
            me = ev.to_mesh()
            nm = M.to_3x3().inverted().transposed()
            d["verts"] = [list(M @ v.co) for v in me.vertices]
            d["normals"] = [list((nm @ v.normal).normalized()) for v in me.vertices]
            d["faces"] = [list(p.vertices) for p in me.polygons]
            d["face_centers"] = [list(M @ p.center) for p in me.polygons]
            d["face_normals"] = [list((nm @ p.normal).normalized()) for p in me.polygons]
            ev.to_mesh_clear()
        elif obj.type == "CURVE":
            ev = obj.evaluated_get(dg)
            me = ev.to_mesh()   # a beveless curve evaluates to a polyline mesh (vertices + edges)
            verts = [list(M @ v.co) for v in me.vertices]
            nxt, prev = {}, {}
            for e in me.edges:
                a, b = e.vertices[0], e.vertices[1]
                nxt.setdefault(a, []).append(b); prev.setdefault(b, []).append(a)
            # walk chains from vertices with no predecessor (then any leftovers, for closed loops)
            seen, polylines = set(), []
            starts = [i for i in range(len(verts)) if i not in prev] + list(range(len(verts)))
            for s0 in starts:
                if s0 in seen or s0 not in nxt and s0 not in prev:
                    continue
                chain, cur = [], s0
                while cur is not None and cur not in seen:
                    seen.add(cur); chain.append(verts[cur])
                    cur = next((n for n in nxt.get(cur, []) if n not in seen), None)
                if len(chain) >= 2:
                    polylines.append(chain)
            d["polylines"] = polylines
            ev.to_mesh_clear()
        elif obj.type == "EMPTY":
            d["origin"] = list(M.translation)
            d["zaxis"] = list((M.to_3x3() @ Vector((0.0, 0.0, 1.0))).normalized())
        else:
            continue
        out.append(d)
    return out


def export_objects(objects, filepath, **kw):
    import bpy
    scale = bpy.context.scene.unit_settings.scale_length * 1000.0  # scene units → mm
    kw.setdefault("scale_to_mm", scale)
    fx = fixture_from_objects(collect(objects), **kw)
    with open(filepath, "w") as f:
        json.dump(fx, f)
    return fx


try:
    import bpy
    from bpy.props import FloatProperty, EnumProperty, BoolProperty
    from bpy_extras.io_utils import ExportHelper

    class VOXELED_OT_export(bpy.types.Operator, ExportHelper):
        bl_idname = "export_scene.voxeled"
        bl_label = "Export voxeled fixture"
        filename_ext = ".vxl.json"
        filter_glob: bpy.props.StringProperty(default="*.vxl.json;*.json", options={"HIDDEN"})
        pitch_mm: FloatProperty(name="Curve pitch (mm)", default=50.0, min=0.1, description="LED spacing along curves (per-object voxeled_pitch overrides)")
        mesh_mode: EnumProperty(name="Mesh LEDs", items=[("vertices", "Vertices", "one LED per vertex"), ("faces", "Faces", "one LED per face (panels as quads)"), ("islands", "Islands", "one LED per connected island (modelled chips)")], default="vertices")
        normal_sign: EnumProperty(name="Normal sign (islands / no normals)", items=[("outward", "Outward", ""), ("inward", "Inward", ""), ("keep", "Keep", "")], default="outward")
        selection_only: BoolProperty(name="Selected objects only", default=True)

        def execute(self, context):
            objs = context.selected_objects if self.selection_only else list(context.scene.objects)
            try:
                fx = export_objects(objs, self.filepath, pitch_mm=self.pitch_mm, mesh_mode=self.mesh_mode, normal_sign=self.normal_sign)
            except ValueError as e:
                self.report({"ERROR"}, str(e))
                return {"CANCELLED"}
            self.report({"INFO"}, "voxeled: %d LEDs in %d strand(s), pitch %.1f mm → %s" % (fx["meta"]["points"], len(fx["meta"]["strands"]), fx["meta"]["pitchMM"], self.filepath))
            return {"FINISHED"}

    def _menu(self, context):
        self.layout.operator(VOXELED_OT_export.bl_idname, text="voxeled fixture (.vxl.json)")

    def register():
        bpy.utils.register_class(VOXELED_OT_export)
        bpy.types.TOPBAR_MT_file_export.append(_menu)

    def unregister():
        bpy.types.TOPBAR_MT_file_export.remove(_menu)
        bpy.utils.unregister_class(VOXELED_OT_export)

except ImportError:  # imported outside Blender (tests): the pure core is still usable
    pass
