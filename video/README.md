# Microcraft outro

Six-second landscape outro, 1920 × 1080, 24 fps, H.264 MP4.

- `output/Microcraft_Outro_with_sound.mp4`: finished video with original electronic sound effects and a closing chime.
- `output/Microcraft_Outro_with_sound.blend`: editable 3D scene with packed soundtrack.
- `output/Microcraft_Soundtrack.wav`: separate six-second stereo soundtrack, 48 kHz.

- `output/Microcraft_Outro_1080p.mp4`: finished video for your editor.
- `output/Microcraft_Outro.blend`: editable scene, animation, lights, camera, and packed font.
- `output/preview.png`: still from the finished composition.

The title assembles from voxels while the micro:bit rises and the saved house builds into a floating island. Light pulses travel along the tether. The final composition holds for the end of the clip.

The house geometry comes from the saved world at generation time. The Blender scene contains a complete copy of that geometry and does not need the server to run. The generator only reads world files; it does not change them.

To rebuild using the current saved house, run from the project directory in PowerShell:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 4.1\blender.exe' --background --python video/build_outro.py -- --render-video
```

In Blender, use the active camera and Render Animation to export again. The scene uses Eevee in Blender 4.1. The original exports remain silent. After rebuilding the picture, run `video/add_sound.py` with Blender's `--background --python` options to regenerate the soundtrack and the version with sound. The soundtrack is synthesized locally without external samples.
