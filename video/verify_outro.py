"""Decode the rendered MP4 in Blender and inspect its dimensions and timing."""
import bpy
import sys
from pathlib import Path

out = Path(__file__).resolve().parent / 'output'
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.resolution_x = 1920
scene.render.resolution_y = 1080
scene.render.resolution_percentage = 50
scene.render.fps = 24
scene.view_settings.view_transform = 'Standard'
scene.render.image_settings.file_format = 'PNG'
editor = scene.sequence_editor_create()
filename = 'Microcraft_Outro_with_sound.mp4' if '--with-sound' in sys.argv else 'Microcraft_Outro_1080p.mp4'
strip = editor.sequences.new_movie('Rendered outro', str(out / filename), channel=1, frame_start=1)
print('VIDEO_QA', strip.frame_duration, strip.elements[0].orig_width, strip.elements[0].orig_height)
assert strip.frame_duration == 144, strip.frame_duration
assert (strip.elements[0].orig_width, strip.elements[0].orig_height) == (1920, 1080)
for frame in (1, 24, 60, 144):
    scene.frame_set(frame)
    scene.render.filepath = str(out / ('decoded_%03d.png' % frame))
    bpy.ops.render.render(write_still=True)
