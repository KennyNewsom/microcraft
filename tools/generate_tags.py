"""Build the PC's network tags from the installed, version-matched vanilla client."""
import json
import os
from pathlib import Path
import subprocess
import sys
import zipfile

root = Path(__file__).resolve().parents[1]
jar = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(os.environ['APPDATA']) / '.minecraft/versions/26.1/26.1.jar'
with zipfile.ZipFile(jar) as archive:
    tags = {name[len('data/minecraft/tags/'):-5]: json.loads(archive.read(name))
            for name in archive.namelist()
            if name.startswith('data/minecraft/tags/') and name.endswith('.json')}
subprocess.run(['node', str(root / 'tools/build_tags.js')], input=json.dumps(tags), text=True, check=True, cwd=root)
