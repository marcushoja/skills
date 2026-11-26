#!/usr/bin/env python3
"""Fasst Registereinträge zusammen, nicht semantische oder Zeilenabdeckung."""
import json,sys,collections
r=json.load(sys.stdin); counts=collections.Counter(x['status'] for x in r['coverage'])
print(json.dumps({'ledger_counts':dict(counts),'remaining':[x for x in r['coverage'] if x['status'] in ('partial','not-reviewed')],'note':'Einträge sind unterschiedlich umfangreich; daraus wird kein Abdeckungsprozentsatz abgeleitet.'},indent=2))
