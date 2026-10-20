from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'extension/manifest.json').read_text())
# Explicit release inputs prevent local scratch files from becoming public.
runtime = '''app-config.js core.js github.js mentions.js panel-layout.js
popup.css popup.html popup.js sandbox.html sandbox.js viewer.css viewer.html
viewer.js worker.js manifest.json icons/16.png icons/32.png icons/48.png icons/128.png'''.split()
inputs = {name: root / 'extension' / name for name in runtime}
inputs.update({name: root / name for name in ['LICENSE', 'PRIVACY.md']})
for name, path in inputs.items():
    if path.is_symlink() or path.resolve() != path.absolute() or not path.is_file():
        raise ValueError(f'Unsafe or missing release input: {name}')
version = manifest['version']
if not all(part.isdigit() for part in version.split('.')):
    raise ValueError('Invalid release version')
out = root / 'dist'
out.mkdir(exist_ok=True)
output = out / f'artifact-threads-{version}.zip'
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name, path in sorted(inputs.items()):
        archive.write(path, name)
with zipfile.ZipFile(output) as archive:
    if set(archive.namelist()) != set(inputs) or archive.testzip() is not None:
        raise ValueError('Release archive failed validation')
print(output)
