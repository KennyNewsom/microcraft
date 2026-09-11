"""Build project firmware with project-local CODAL and ARM tools."""
import os
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
codal = root / '.tools/codal'
paths = [root / '.tools/xpack-arm-none-eabi-gcc-15.2.1-1.1/bin',
         root / '.tools/python/cmake/data/bin', root / '.tools/python/bin']
env = os.environ.copy()
env['PATH'] = os.pathsep.join(map(str, paths)) + os.pathsep + env['PATH']
env['PYTHONPATH'] = str(root / '.tools/python')
# CODAL's older CMake configuration requires this compatibility floor.
env['CMAKE_POLICY_VERSION_MINIMUM'] = '3.5'
shutil.copyfile(root / 'firmware/main.cpp', codal / 'source/main.cpp')
shutil.copyfile(root / 'firmware/Palette.h', codal / 'source/Palette.h')
shutil.copyfile(root / 'firmware/codal.json', codal / 'codal.json')
# The pinned CODAL driver omits 460800 despite the NRF52 hardware supporting it.
driver = codal / 'libraries/codal-nrf52/source/NRF52Serial.cpp'
if not driver.exists():
    subprocess.run([sys.executable, 'build.py'], cwd=codal, env=env, check=True)
source = driver.read_text()
if 'case 460800 :' not in source:
    needle = 'case 230400 : baud = NRF_UARTE_BAUDRATE_230400; break;'
    if needle not in source:
        raise RuntimeError('Unexpected CODAL baud switch; refusing an unverified driver patch')
    driver.write_text(source.replace(needle, needle + '\n        case 460800 : baud = NRF_UARTE_BAUDRATE_460800; break;'))
subprocess.run([sys.executable, 'build.py'], cwd=codal, env=env, check=True)
out = root / 'build'
out.mkdir(exist_ok=True)
shutil.copyfile(codal / 'MICROBIT.hex', out / 'MICROCRAFT.hex')
print(out / 'MICROCRAFT.hex')
