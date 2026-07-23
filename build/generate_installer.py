#!/usr/bin/env python3
"""Genere un installeur PowerShell autonome (payloads en base64) a partir
du gabarit et des fichiers source. Un run = une architecture cible.
"""
import argparse
import base64
import datetime
import pathlib
import sys


def b64_bytes(path: pathlib.Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("ascii")


def b64_text(path: pathlib.Path) -> str:
    return base64.b64encode(path.read_text(encoding="utf-8").encode("utf-8")).decode("ascii")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", required=True, type=pathlib.Path)
    parser.add_argument("--kerberos-node", required=True, type=pathlib.Path,
                         help="binaire natif kerberos.node (win32)")
    parser.add_argument("--kerberos-index", required=True, type=pathlib.Path,
                         help="lib/index.js du package kerberos officiel")
    parser.add_argument("--kerberos-util", required=True, type=pathlib.Path,
                         help="lib/util.js du package kerberos officiel")
    parser.add_argument("--agent-js", required=True, type=pathlib.Path,
                         help="src/kerberos-proxy-agent.js de ce depot")
    parser.add_argument("--kerberos-version", required=True)
    parser.add_argument("--arch", required=True, choices=["x64", "arm64"])
    parser.add_argument("--output", required=True, type=pathlib.Path)
    args = parser.parse_args()

    for p in (args.template, args.kerberos_node, args.kerberos_index,
              args.kerberos_util, args.agent_js):
        if not p.is_file():
            print(f"ERREUR: fichier introuvable: {p}", file=sys.stderr)
            return 1

    template = args.template.read_text(encoding="utf-8")

    replacements = {
        "__KERBEROS_NODE_B64__": b64_bytes(args.kerberos_node),
        "__KERBEROS_INDEX_JS_B64__": b64_text(args.kerberos_index),
        "__KERBEROS_UTIL_JS_B64__": b64_text(args.kerberos_util),
        "__AGENT_JS_B64__": b64_text(args.agent_js),
        "__KERBEROS_VERSION__": args.kerberos_version,
        "__BUILD_ARCH__": args.arch,
        "__BUILD_DATE__": datetime.date.today().isoformat(),
    }

    output = template
    for placeholder, value in replacements.items():
        if placeholder not in output:
            print(f"ERREUR: placeholder absent du gabarit: {placeholder}", file=sys.stderr)
            return 1
        output = output.replace(placeholder, value)

    remaining = [line for line in output.splitlines() if "__" in line and line.strip().startswith("__")]
    if "__KERBEROS_NODE_B64__" in output or "__AGENT_JS_B64__" in output:
        print("ERREUR: des placeholders n'ont pas ete remplaces", file=sys.stderr)
        return 1

    args.output.write_text(output, encoding="utf-8")

    size_kb = args.output.stat().st_size / 1024
    print(f"OK: {args.output} genere ({size_kb:.0f} Ko, arch={args.arch}, "
          f"kerberos={args.kerberos_version})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
