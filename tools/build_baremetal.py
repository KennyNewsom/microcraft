"""Freestanding nRF52833 build: ARM GCC only, no CODAL/SDK/SoftDevice."""
from pathlib import Path
import json
import subprocess

ROOT=Path(__file__).resolve().parents[1]
BIN=ROOT/'.tools/xpack-arm-none-eabi-gcc-15.2.1-1.1/bin'
OUT=ROOT/'build'; OUT.mkdir(exist_ok=True)
def run(tool,*args):
    return subprocess.check_output([str(BIN/(tool+'.exe')), *map(str,args)], text=True)
flags=['-mcpu=cortex-m4','-mthumb','-mfloat-abi=soft','-O3','-flto','-ffreestanding',
       '-fno-builtin','-fno-exceptions','-fno-rtti','-fno-unwind-tables',
       '-fno-asynchronous-unwind-tables','-fno-threadsafe-statics','-ffunction-sections',
       '-fdata-sections','-DMICROCRAFT_BAREMETAL','-DMICROCRAFT_CACHE_CAPACITY=16384',
       '-nostdlib','-I'+str(ROOT/'firmware')]
sources=['firmware/main.cpp','firmware/baremetal/startup.S',
         'firmware/baremetal/runtime.cpp','firmware/baremetal/platform.cpp']
elf=OUT/'MICROCRAFT.elf'
print(run('arm-none-eabi-g++',*flags,*[ROOT/s for s in sources],
    '-T'+str(ROOT/'firmware/baremetal/linker.ld'),'-Wl,--gc-sections',
    '-Wl,-Map='+str(OUT/'MICROCRAFT.map'),'-lgcc','-o',elf))
run('arm-none-eabi-objcopy','-O','ihex',elf,OUT/'MICROCRAFT.hex')
print(run('arm-none-eabi-size',elf))
symbols={line.split()[2]:int(line.split()[0],16) for line in run('arm-none-eabi-nm','-n',elf).splitlines() if len(line.split())==3}
report={'runtime':'bare-metal','physical_ram':131072,'static_ram':symbols['__bss_end']-0x20000000,
        'reserved_stack':8192,'free_gap':symbols['__stack_limit']-symbols['__bss_end'],
        'edit_limit':12288,'cache_buckets':16384}
(OUT/'memory.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2)); print(OUT/'MICROCRAFT.hex')
