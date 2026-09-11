# Extension entry point (Blender 4.2+ "Install from Disk" on a zip of this folder). The legacy
# add-on path (installing voxeled_export.py directly) works too.
from .voxeled_export import register, unregister, bl_info  # noqa: F401
