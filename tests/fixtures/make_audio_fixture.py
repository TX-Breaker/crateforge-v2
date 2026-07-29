"""Genera un MP3 minimo VALIDO per i test di write-tags (§11).

Solo Python tocca la generazione delle fixture (come per il cifrato): qui non
c'è crittografia, ma teniamo la stessa disciplina — il file deve essere un vero
MPEG che mutagen riconosce, non byte inventati a mano in Node.

Uso: python make_audio_fixture.py OUT.mp3 [--title T] [--artist A]
"""
from __future__ import annotations

import argparse
import sys


def make_mp3(path: str, title: str | None, artist: str | None) -> None:
    # Frame MPEG-1 Layer III, 44.1 kHz, 128 kbps, no padding → 417 byte.
    # Header 0xFFFB9000 + payload a zero: silenzio decodificabile.
    frame = b"\xff\xfb\x90\x00" + b"\x00" * 413
    with open(path, "wb") as f:
        for _ in range(60):  # ~1.5 s di silenzio
            f.write(frame)

    if title or artist:
        from mutagen.easyid3 import EasyID3
        from mutagen.id3 import ID3, ID3NoHeaderError

        try:
            tags = EasyID3(path)
        except ID3NoHeaderError:
            ID3().save(path)
            tags = EasyID3(path)
        if title:
            tags["title"] = [title]
        if artist:
            tags["artist"] = [artist]
        tags.save(path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--title")
    ap.add_argument("--artist")
    args = ap.parse_args()
    make_mp3(args.out, args.title, args.artist)
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
