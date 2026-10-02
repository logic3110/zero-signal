"""zs-sign: ed25519 signing for packs and models (US-12.4, US-15.10, NFR-8).

The signature covers the SHA-256 digest of the file, so verifiers hash once
(which they do anyway for integrity) and verify 32 bytes.

    zs-sign keygen --out keys/
    zs-sign sign --key keys/zs_ed25519.pem dist/*.sqlite dist/*.json
    zs-sign verify --pub <hex> dist/medical-core.sqlite
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey


def file_digest(path: Path) -> bytes:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.digest()


def keygen(out: Path) -> tuple[Path, str]:
    out.mkdir(parents=True, exist_ok=True)
    key = Ed25519PrivateKey.generate()
    priv = out / "zs_ed25519.pem"
    priv.write_bytes(
        key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    )
    priv.chmod(0o600)
    pub_hex = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex()
    (out / "zs_ed25519.pub").write_text(pub_hex + "\n")
    return priv, pub_hex


def load_private(path: Path) -> Ed25519PrivateKey:
    key = serialization.load_pem_private_key(path.read_bytes(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError("not an ed25519 key")
    return key


def sign_file(key: Ed25519PrivateKey, path: Path) -> str:
    sig = key.sign(file_digest(path)).hex()
    path.with_name(path.name + ".sig").write_text(sig + "\n")
    return sig


def verify_file(pub_hex: str, path: Path, sig_hex: str | None = None) -> bool:
    if sig_hex is None:
        sig_hex = path.with_name(path.name + ".sig").read_text().strip()
    pub = Ed25519PublicKey.from_public_bytes(bytes.fromhex(pub_hex))
    try:
        pub.verify(bytes.fromhex(sig_hex), file_digest(path))
        return True
    except InvalidSignature:
        return False


def _update_sidecar(path: Path, sig: str) -> None:
    """Record the signature in ``<pack>.manifest.json`` next to the file."""
    stem = path.name.split(".")[0]
    sidecar = path.with_name(f"{stem}.manifest.json")
    if not sidecar.exists():
        return
    data = json.loads(sidecar.read_text())
    for kind, f in data.get("files", {}).items():
        if f["name"] == path.name:
            f["signature"] = sig
    if path.suffix == ".sqlite":
        data["signature"] = sig
    sidecar.write_text(json.dumps(data, indent=2))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="zs-sign", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    k = sub.add_parser("keygen")
    k.add_argument("--out", type=Path, required=True)
    s = sub.add_parser("sign")
    s.add_argument("--key", type=Path, required=True)
    s.add_argument("files", nargs="+", type=Path)
    v = sub.add_parser("verify")
    v.add_argument("--pub", required=True, help="hex public key or path to .pub file")
    v.add_argument("files", nargs="+", type=Path)
    args = ap.parse_args(argv)

    if args.cmd == "keygen":
        priv, pub = keygen(args.out)
        print(f"private key: {priv} (keep secret, never commit)\npublic key : {pub}")
        return 0
    if args.cmd == "sign":
        key = load_private(args.key)
        for f in args.files:
            if f.name.endswith((".sig", ".manifest.json")) or f.name == "catalog.json":
                continue
            sig = sign_file(key, f)
            _update_sidecar(f, sig)
            print(f"signed {f.name}: {sig[:16]}…")
        return 0
    pub = Path(args.pub).read_text().strip() if Path(args.pub).exists() else args.pub
    ok = True
    for f in args.files:
        good = verify_file(pub, f)
        ok &= good
        print(f"{'OK ' if good else 'BAD'} {f}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
