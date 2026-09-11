"""Download a project-local ARM compiler, verifying the publisher's SHA-256."""
import hashlib
from pathlib import Path
import urllib.request
import zipfile

root = Path(__file__).resolve().parents[1] / '.tools'
name = 'xpack-arm-none-eabi-gcc-15.2.1-1.1-win32-x64.zip'
url = 'https://github.com/xpack-dev-tools/arm-none-eabi-gcc-xpack/releases/download/v15.2.1-1.1/' + name
archive = root / name
root.mkdir(exist_ok=True)
if not archive.exists():
    urllib.request.urlretrieve(url, archive)
with archive.open('rb') as stream:
    digest = hashlib.file_digest(stream, 'sha256').hexdigest()
if digest != 'bae6a3d1667697ce750c3b13d6d26d80973ecedc2cc87bf04869e83447fd93ea':
    raise ValueError('Compiler archive checksum mismatch')
with zipfile.ZipFile(archive) as z:
    for item in z.infolist():
        if not (root / item.filename).resolve().is_relative_to(root.resolve()):
            raise ValueError('Unsafe archive path')
    z.extractall(root)
print('Compiler extracted into', root)
