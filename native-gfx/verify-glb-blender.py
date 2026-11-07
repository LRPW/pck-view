import bpy
import json
import math
import sys
from mathutils import Vector

path = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
rigs = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
shapes = {bone.custom_shape for rig in rigs for bone in rig.pose.bones if bone.custom_shape}
meshes = [o for o in meshes if o not in shapes]
if '--static' in sys.argv:
    assert meshes and not rigs and len(bpy.data.images) > 0, 'Invalid static GLB'
    assert all(math.isfinite(x) for mesh in meshes for v in mesh.data.vertices for x in v.co)
    print('STATIC_GLB_OK', len(meshes), sum(len(o.data.vertices) for o in meshes), len(bpy.data.images))
    sys.exit(0)
assert meshes and rigs, 'Missing mesh or armature'
assert bpy.data.actions, 'Missing animation clips'
for mesh in meshes:
    if not any(m.type == 'ARMATURE' for m in mesh.modifiers):
        assert mesh.parent_type == 'BONE', 'Missing skin or rigid bone attachment'
        continue
    assert all(abs(sum(g.weight for g in v.groups) - 1) < 0.002 for v in mesh.data.vertices), 'Invalid weight sum'
    assert all(math.isfinite(x) for v in mesh.data.vertices for x in v.co)
scene = bpy.context.scene
rig = rigs[0]
rig.animation_data_create()
for track in rig.animation_data.nla_tracks: track.mute = True
mesh = next(o for o in meshes if any(m.type == 'ARMATURE' for m in o.modifiers))


def sample(frame):
    scene.frame_set(frame);
    bpy.context.view_layer.update()
    evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get());
    data = evaluated.to_mesh()
    result = [v.co.copy() for v in data.vertices];
    evaluated.to_mesh_clear();
    return result


moved = []
for action in bpy.data.actions:
    rig.animation_data.action = action
    if hasattr(action, 'slots') and len(action.slots): rig.animation_data.action_slot = action.slots[0]
    lo, hi = action.frame_range
    first = sample(int(lo));
    second = sample(int(lo + (hi - lo) * 0.37))
    delta = max((a - b).length for a, b in zip(first, second))
    moved.append({'name': action.name, 'frames': [lo, hi], 'max_vertex_delta': delta})
assert any(x['max_vertex_delta'] > 0.001 for x in moved), 'Animation does not deform mesh'
rig.animation_data.action = None
scene.frame_set(1);
bpy.context.view_layer.update()
points = [o.matrix_world @ Vector(corner) for o in meshes for corner in o.bound_box]
low = Vector(tuple(min(v[i] for v in points) for i in range(3)));
high = Vector(tuple(max(v[i] for v in points) for i in range(3)))
report = {'file': path, 'meshes': len(meshes), 'vertices': sum(len(o.data.vertices) for o in meshes),
          'bones': sum(len(o.data.bones) for o in rigs), 'images': len(bpy.data.images),
          'bounds': [list(low), list(high)], 'actions': moved}
print('GLB_REPORT=' + json.dumps(report, ensure_ascii=True))
with open(path + '.report.json', 'w', encoding='utf-8') as f: json.dump(report, f, ensure_ascii=False, indent=2)
center = (low + high) * 0.5;
radius = max((high - low).length, 1)
bpy.ops.object.camera_add(location=center + Vector((1, -1, 0.6)) * radius)
camera = bpy.context.object;
camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler();
camera.data.type = 'ORTHO';
camera.data.ortho_scale = radius * 1.2;
scene.camera = camera
for direction in [(1, -1, 2), (-1, 0, 1)]:
    bpy.ops.object.light_add(type='AREA', location=center + Vector(direction) * radius)
    lamp = bpy.context.object;
    lamp.data.energy = 1200;
    lamp.data.shape = 'DISK';
    lamp.data.size = radius;
    lamp.rotation_euler = (center - lamp.location).to_track_quat('-Z', 'Y').to_euler()
scene.world = bpy.data.worlds.new('World');
scene.world.color = (0.1, 0.1, 0.1)
scene.render.engine = 'CYCLES';
scene.cycles.samples = 8;
scene.render.resolution_x = 640;
scene.render.resolution_y = 640;
scene.render.resolution_percentage = 100;
scene.render.filepath = path + '.png'
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=path + '.blend')
