#!/usr/bin/env python3
"""Lesendes Pfadinventar; folgt keinen symbolischen Links."""
import argparse, os, json
from pathlib import Path
p=argparse.ArgumentParser(); p.add_argument('root',type=Path); p.add_argument('--limit',type=int,default=20000); a=p.parse_args()
root=a.root.resolve(strict=True)
if not root.is_dir() or a.limit<1: p.error('Verzeichnis und positives Limit erforderlich')
exclude={'.git','node_modules','.venv','vendor','dist','build','__pycache__'}
files=[]; skipped=[]; errors=[]; truncated=False
for base,dirs,names in os.walk(root,followlinks=False,onerror=lambda e: errors.append(str(e))):
    dirs.sort(); names.sort()
    for d in dirs[:]:
        path=Path(base)/d
        if d in exclude or path.is_symlink():
            dirs.remove(d); skipped.append(str(path.relative_to(root)))
    for n in names:
        path=Path(base)/n
        if path.is_symlink() or not path.is_file(): skipped.append(str(path.relative_to(root))); continue
        if len(files)>=a.limit: truncated=True; break
        files.append(str(path.relative_to(root)))
    if truncated: break
print(json.dumps({'files':files,'excluded':skipped,'errors':errors,'truncated':truncated,'note':'Nur Pfadinventar; Ausschlüsse müssen geprüft werden.'},indent=2))
