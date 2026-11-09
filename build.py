#!/usr/bin/env python3
"""Assemble index.html from the files in src/.

    python3 build.py

No dependencies beyond Python 3. The result is a single self-contained page:
open it from disk or serve it with any static web server.
"""
import pathlib

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / 'src'
read = lambda name: (SRC / name).read_text(encoding='utf-8')

page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>LID Table Trainer</title>
<meta name="description" content="Latency-insensitive design trace trainer and animator (CSEE 4868): fill HW3-style tables, check them, and watch them unfold cycle by cycle.">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
{read('styles.css').strip()}
</style>
</head>
<body>
{read('page.html').strip()}

<script>
{read('core.js').strip()}
</script>
<script>
{read('animator.js').strip()}
</script>
<script>
{read('trainer.js').strip()}
</script>
</body>
</html>
"""
out = ROOT / 'index.html'
out.write_text(page, encoding='utf-8')
print(f'wrote {out} ({len(page):,} bytes)')
