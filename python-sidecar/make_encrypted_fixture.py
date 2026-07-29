#!/usr/bin/env python3
"""Genera una fixture master.db CIFRATA per i test (§11).

REGOLA v4: il cifrato lo tocca SOLO Python. Un file SQLCipher valido non si
fabbrica "a byte": qui viene creato e cifrato a runtime con sqlcipher3, con
uno schema minimo compatibile-nei-nomi con Rekordbox 6 e una chiave nota.

Uso:
    python make_encrypted_fixture.py [out_path] [--key CHIAVE]

Default: ../tests/fixtures/master.db con chiave 'crateforge-test-key'.
I test Node NON aprono mai questo file: serve solo al sidecar Python.
"""

from __future__ import annotations

import argparse
import os
import sys

DEFAULT_KEY = "crateforge-test-key"

SCHEMA = """
CREATE TABLE djmdContent (
    ID TEXT PRIMARY KEY,
    Title TEXT,
    ArtistID TEXT,
    AlbumID TEXT,
    GenreID TEXT,
    KeyID TEXT,
    BPM INTEGER,
    Length INTEGER,
    ReleaseYear INTEGER,
    FileSize INTEGER,
    FolderPath TEXT
);
CREATE TABLE djmdArtist (ID TEXT PRIMARY KEY, Name TEXT);
CREATE TABLE djmdKey (ID TEXT PRIMARY KEY, ScaleName TEXT);
CREATE TABLE djmdPlaylist (ID TEXT PRIMARY KEY, Seq INTEGER, Name TEXT,
                           Attribute INTEGER, ParentID TEXT);
CREATE TABLE djmdSongPlaylist (ID TEXT PRIMARY KEY, PlaylistID TEXT,
                               ContentID TEXT, TrackNo INTEGER);
"""

ROWS = [
    ("c1", "Levels (Extended Mix)", "a1", None, None, "k1", 12600, 320, 2011,
     9_000_000, "/Music/Avicii - Levels (Extended Mix).mp3"),
    ("c2", "Strobe", "a2", None, None, "k2", 12800, 634, 2009,
     15_000_000, "/Music/deadmau5 - Strobe.mp3"),
    ("c3", "無題", "a3", None, None, None, 17400, 250, None,
     7_000_000, "/Music/無題.mp3"),
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "out",
        nargs="?",
        default=os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "master.db"),
    )
    parser.add_argument("--key", default=DEFAULT_KEY)
    args = parser.parse_args()

    try:
        import sqlcipher3  # type: ignore
    except ImportError:
        print(
            "sqlcipher3 non installato: pip install sqlcipher3-wheels\n"
            "In alternativa i test possono usare un vero master.db fornito "
            "dall'utente (variabile CRATEFORGE_TEST_MASTERDB).",
            file=sys.stderr,
        )
        return 2

    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    if os.path.exists(out):
        os.remove(out)

    conn = sqlcipher3.connect(out)
    conn.execute(f"PRAGMA key = '{args.key}'")
    conn.executescript(SCHEMA)
    conn.execute("INSERT INTO djmdArtist VALUES ('a1', 'Avicii')")
    conn.execute("INSERT INTO djmdArtist VALUES ('a2', 'deadmau5')")
    conn.execute("INSERT INTO djmdArtist VALUES ('a3', '知らない')")
    conn.execute("INSERT INTO djmdKey VALUES ('k1', 'C#m')")
    conn.execute("INSERT INTO djmdKey VALUES ('k2', 'B')")
    conn.executemany(
        "INSERT INTO djmdContent VALUES (?,?,?,?,?,?,?,?,?,?,?)", ROWS
    )
    conn.execute(
        "INSERT INTO djmdPlaylist VALUES ('p1', 1, 'Test Set', 0, 'root')"
    )
    conn.execute(
        "INSERT INTO djmdSongPlaylist VALUES ('sp1', 'p1', 'c1', 1)"
    )
    conn.commit()
    conn.close()
    print(f"Fixture cifrata scritta: {out} (chiave: {args.key})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
