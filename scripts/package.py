from pathlib import Path
import zipfile
root=Path(__file__).resolve().parent.parent
out=root/'dist'
out.mkdir(exist_ok=True)
with zipfile.ZipFile(out/'artifact-threads-0.1.0.zip','w',zipfile.ZIP_DEFLATED) as archive:
    for path in sorted((root/'extension').rglob('*')):
        if path.is_file():archive.write(path,path.relative_to(root/'extension'))
print(out/'artifact-threads-0.1.0.zip')
