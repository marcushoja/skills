#!/usr/bin/env python3
"""Validiert JSON-Schema und einfache feldübergreifende Regeln, nicht die Belegqualität."""
import argparse,json,sys
from pathlib import Path
p=argparse.ArgumentParser(); p.add_argument('report',type=Path); a=p.parse_args()
try: import jsonschema
except ImportError: sys.exit('jsonschema nicht verfügbar; keine Validierung durchgeführt')
schema=json.loads((Path(__file__).resolve().parents[1]/'assets/findings-schema.json').read_text()); report=json.loads(a.report.read_text())
jsonschema.Draft202012Validator(schema).validate(report)
ids=set()
for f in report['findings']:
    if f['id'] in ids: sys.exit('Doppelte Befund-ID: '+f['id'])
    ids.add(f['id'])
    for loc in f['locations']:
        if loc['end_line']<loc['start_line']: sys.exit('Ungültiger Zeilenbereich: '+f['id'])
print('Struktur gültig; sachliche Belege nicht überprüft')
