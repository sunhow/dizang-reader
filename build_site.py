#!/usr/bin/env python3
"""Validate content, version the offline cache, and assemble GitHub Pages assets."""
from pathlib import Path
import hashlib,shutil,re,runpy
ROOT=Path(__file__).resolve().parent
runpy.run_path(str(ROOT/'build.py'),run_name='__main__')
assets=['index.html','manifest.webmanifest','style.css','dizang.css','config.js','app.js','book.js','icon-192.png','icon-512.png','icon-maskable-512.png','apple-touch-icon.png','favicon-32.png']
paths=[]
for item in assets:
 p=ROOT/item
 paths.extend(sorted(p.rglob('*')) if p.is_dir() else [p])
digest=hashlib.sha256()
for p in paths:
 if p.is_file():digest.update(p.relative_to(ROOT).as_posix().encode());digest.update(p.read_bytes())
sw=(ROOT/'sw.js').read_text()
digest.update(re.sub(r"const VERSION = '[^']+';","const VERSION = '';",sw).encode())
sw=re.sub(r"const VERSION = '[^']+';",f"const VERSION = '{digest.hexdigest()[:14]}';",sw)
(ROOT/'sw.js').write_text(sw)
out=ROOT/'dist'
if out.exists():shutil.rmtree(out)
out.mkdir()
for item in assets+['sw.js','LICENSE','SOURCES.md']:
 p=ROOT/item
 if p.is_dir():shutil.copytree(p,out/item)
 else:shutil.copy2(p,out/item)
(out/'.nojekyll').touch()
print('Static site ready:',out)
