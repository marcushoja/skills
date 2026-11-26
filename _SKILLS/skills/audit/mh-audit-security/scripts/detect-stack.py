#!/usr/bin/env python3
"""Leitet Technologiehinweise aus Inventar-JSON der Standardeingabe ab, nicht aus Dateiinhalten."""
import json,sys
from pathlib import PurePath
files=json.load(sys.stdin)['files']; names={PurePath(f).name for f in files}
markers={'JavaScript/TypeScript':['package.json','tsconfig.json'],'Python':['pyproject.toml','requirements.txt','setup.py'],'Rust':['Cargo.toml'],'Go':['go.mod'],'Java/Kotlin':['pom.xml','build.gradle','build.gradle.kts'],'Ruby':['Gemfile'],'PHP':['composer.json'],'Dotnet':['global.json'],'Container':['Dockerfile','compose.yaml','docker-compose.yml']}
print(json.dumps({'hints':{k:sorted(names.intersection(v)) for k,v in markers.items() if names.intersection(v)},'note':'Nur heuristisch; tatsächliche Manifeste und verschachtelte Komponenten prüfen.'},indent=2))
