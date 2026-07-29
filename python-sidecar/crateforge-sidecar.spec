# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
hiddenimports = []

# collect_all su pyrekordbox NON tira dentro numpy con le sue estensioni C
# (numpy 2.x usa numpy._core._exceptions caricato dinamicamente): senza una
# raccolta esplicita il binario frozen fallisce con
# "No module named 'numpy._core._exceptions'" e ingest-masterdb / read-history
# muoiono all'import. Raccogliamo esplicitamente le dipendenze native.
for _pkg in ('pyrekordbox', 'numpy', 'sqlcipher3', 'sqlalchemy'):
    _d, _b, _h = collect_all(_pkg)
    datas += _d; binaries += _b; hiddenimports += _h


a = Analysis(
    ['sidecar.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='crateforge-sidecar',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='crateforge-sidecar',
)
