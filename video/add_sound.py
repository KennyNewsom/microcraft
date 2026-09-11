"""Create original procedural audio and mux it into the six-second outro."""
import bpy
import numpy as np
import wave
from pathlib import Path

OUT = Path(__file__).resolve().parent / 'output'
RATE = 48000
audio = np.zeros((RATE * 6, 2), dtype=np.float64)
rng = np.random.default_rng(27)

def add(start, signal, gain=1, pan=0):
    offset = round(start * RATE)
    length = min(len(signal), len(audio) - offset)
    audio[offset:offset+length, 0] += signal[:length] * gain * np.sqrt((1-pan)/2)
    audio[offset:offset+length, 1] += signal[:length] * gain * np.sqrt((1+pan)/2)

def tone(freq, duration, decay=4, shimmer=False):
    t = np.arange(round(duration*RATE))/RATE
    envelope = (1-np.exp(-t*180)) * np.exp(-t*decay)
    signal = np.sin(2*np.pi*freq*t)
    if shimmer:
        signal += .23*np.sin(2*np.pi*freq*2*t) + .10*np.sin(2*np.pi*freq*3*t)
    return signal * envelope * np.minimum(1, (duration-t)/.04)

# Soft upward electronic sweep as the board and world enter.
t = np.arange(round(1.65*RATE))/RATE
sweep = np.sin(2*np.pi*(95*t + 130*t*t))
add(.08, sweep * np.sin(np.pi*t/1.65)**2, .12, -.15)

# Rounded voxel clicks, timed to the staggered title and house arrivals.
for i in range(16):
    t = np.arange(round(.105*RATE))/RATE
    click = (.55*np.sin(2*np.pi*(650+37*i)*t) + .22*rng.normal(size=len(t)))
    click *= (1-np.exp(-t*1500))*np.exp(-t*65)
    add(.50+i*.087, click, .14, -.65+1.3*i/15)

# A gentle low impact as the assembled world settles.
t = np.arange(round(.45*RATE))/RATE
add(1.85, np.sin(2*np.pi*(90*t-35*t*t))*np.exp(-t*11)*(1-np.exp(-t*200)), .23)

# Small digital arpeggio follows the moving data along the tether.
for i, freq in enumerate([523.25, 659.25, 783.99, 1046.50]):
    add(2.12+i*.14, tone(freq,.65,7,True), .105, -.4+i*.27)

# Warm resolving C-major chime when the final caption appears.
for freq, pan in [(523.25,-.4),(659.25,0),(783.99,.4),(1046.50,.15)]:
    chime = tone(freq,2.8,1.7,True)
    add(3.08,chime,.115,pan)
    add(3.28,chime,.024,-pan)

# Low-level stereo echoes; fade the ending cleanly to silence.
dry = audio.copy()
for delay, gain in [(0.14,.12),(.29,.065)]:
    n = round(delay*RATE)
    audio[n:] += dry[:-n,::-1]*gain
audio[-round(.5*RATE):] *= np.linspace(1,0,round(.5*RATE))[:,None]
peak = float(np.max(np.abs(audio)))
audio *= .70/max(peak, .001)
pcm = (audio*32767).astype('<i2')
wav = OUT/'Microcraft_Soundtrack.wav'
with wave.open(str(wav),'wb') as f:
    f.setnchannels(2); f.setsampwidth(2); f.setframerate(RATE); f.writeframes(pcm.tobytes())
print('AUDIO_QA: 6 seconds, stereo 48000 Hz, peak',float(np.max(np.abs(audio))))

def output_settings(scene):
    scene.render.resolution_x=1920; scene.render.resolution_y=1080
    scene.render.resolution_percentage=100; scene.render.fps=24
    scene.frame_start=1; scene.frame_end=144
    scene.render.image_settings.file_format='FFMPEG'
    scene.render.ffmpeg.format='MPEG4'; scene.render.ffmpeg.codec='H264'
    scene.render.ffmpeg.constant_rate_factor='HIGH'
    scene.render.ffmpeg.audio_codec='AAC'; scene.render.ffmpeg.audio_bitrate=192
    scene.render.ffmpeg.audio_mixrate=RATE
    scene.render.filepath=str(OUT/'Microcraft_Outro_with_sound.mp4')

# Preserve the full editable 3D scene, with its soundtrack packed inside.
bpy.ops.wm.open_mainfile(filepath=str(OUT/'Microcraft_Outro.blend'))
scene=bpy.context.scene
scene.sequence_editor_create().sequences.new_sound('Original Microcraft sound design',str(wav),channel=1,frame_start=1)
output_settings(scene)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'Microcraft_Outro_with_sound.blend'))

# Encode the already rendered picture with audio without re-rendering geometry.
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.view_settings.view_transform='Standard'
editor=scene.sequence_editor_create()
movie=editor.sequences.new_movie('Finished picture',str(OUT/'Microcraft_Outro_1080p.mp4'),channel=1,frame_start=1)
assert movie.frame_duration==144
editor.sequences.new_sound('Sound design',str(wav),channel=2,frame_start=1)
output_settings(scene)
bpy.ops.render.render(animation=True)
