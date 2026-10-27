#!/usr/bin/env python3
"""Network regression: real signed release, fresh aqua cache, no write credentials."""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


REPO = Path(__file__).resolve().parents[2]
AQUA = shutil.which(os.environ.get("AQUA_TEST_BIN", "aqua"))
PACKAGE_IMPORT = (REPO / "aqua/imports/github-comment.yaml").read_text()
VERSION = re.search(r"suzuki-shunsuke/github-comment@(v[^\s]+)", PACKAGE_IMPORT).group(1)
PREFIX = f"github-comment_{VERSION.removeprefix('v')}"
RELEASE = f"https://github.com/suzuki-shunsuke/github-comment/releases/download/{VERSION}"


def run(args, env=None, reject=False):
    result = subprocess.run(args, env=env, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, timeout=600,
                            cwd=Path(env["AQUA_CONFIG"]).parent if env else None)
    if reject:
        if result.returncode == 0:
            raise AssertionError(f"unexpected verification success: {args}")
    elif result.returncode:
        raise AssertionError(f"{args}\n{result.stdout}")
    return result.stdout


def download(url, dest):
    run(["curl", "--fail", "--silent", "--show-error", "--location",
         "--retry", "3", url, "--output", str(dest)])


def fixture(base, name, package_import, registry):
    directory = base / name
    (directory / "imports").mkdir(parents=True)
    shutil.copy(REPO / "aqua/aqua.yaml", directory / "aqua.yaml")
    shutil.copy(REPO / "aqua/aqua-policy.yaml", directory / "aqua-policy.yaml")
    (directory / "registry.yaml").write_text(registry)
    (directory / "imports/package.yaml").write_text(package_import)
    # Each fixture has an empty cache, including downloaded checksum files.
    env = os.environ.copy()
    env.update(AQUA_ROOT_DIR=str(directory / "root"),
               AQUA_CONFIG=str(directory / "aqua.yaml"),
               AQUA_POLICY_CONFIG=str(directory / "aqua-policy.yaml"))
    for key in ("AQUA_DISABLE_COSIGN", "AQUA_DISABLE_SLSA",
                "AQUA_DISABLE_GITHUB_ARTIFACT_ATTESTATION"):
        if env.get(key, "").lower() not in ("", "false", "0"):
            raise AssertionError(f"verification disabled by {key}")
    return directory, env


def main():
    if not AQUA:
        raise RuntimeError("aqua must be installed (CI uses v2.64.0)")
    registry = (REPO / "aqua/registry.yaml").read_text()
    package_import = PACKAGE_IMPORT
    assert f"github-comment@{VERSION}" in package_import
    # Exercise the production import and registry, rather than a test-only fix.
    bundle_block = registry.rsplit('      - version_constraint: "true"', 1)[1]
    assert "bundle:" in bundle_block and "checksums.txt.sigstore.json" in bundle_block
    opts = [json.loads(value) if value.startswith('"') else value
            for value in re.findall(r"^              - (.+)$", bundle_block, re.M)]
    opts = [value.replace("{{.Version}}", VERSION) for value in opts]
    expected = {
        "--certificate-identity-regexp": r"^https://github\.com/suzuki-shunsuke/go-release-workflow/\.github/workflows/release\.yaml@.+$",
        "--certificate-oidc-issuer": "https://token.actions.githubusercontent.com",
        "--certificate-github-workflow-repository": "suzuki-shunsuke/github-comment",
        "--certificate-github-workflow-ref": f"refs/tags/{VERSION}",
    }
    assert opts == [part for pair in expected.items() for part in pair], opts

    with tempfile.TemporaryDirectory(prefix="aqua-github-comment-") as tmp:
        base = Path(tmp)
        directory, env = fixture(base, "current", package_import, registry)
        run([AQUA, "update-checksum", "-deep", "-prune"], env)
        generated = (directory / "aqua-checksums.json").read_bytes()
        entries = [entry for entry in json.loads(generated)["checksums"]
                   if "/suzuki-shunsuke/github-comment/" in entry["id"]]
        checksum = base / "checksums.txt"
        bundle = base / "checksums.txt.sigstore.json"
        download(f"{RELEASE}/{PREFIX}_checksums.txt", checksum)
        download(f"{RELEASE}/{PREFIX}_checksums.txt.sigstore.json", bundle)
        signed = {line.split()[1].lstrip("*"): line.split()[0].lower()
                  for line in checksum.read_text().splitlines()}
        expected_assets = {f"{PREFIX}_{system}_{arch}.tar.gz"
                           for system in ("darwin", "linux", "windows")
                           for arch in ("amd64", "arm64")}
        assert len(entries) == 6
        assert {entry["id"].rsplit("/", 1)[1] for entry in entries} == expected_assets
        for entry in entries:
            assert entry["algorithm"] == "sha256"
            assert entry["checksum"].lower() == signed[entry["id"].rsplit("/", 1)[1]]
        print("PASS: signed checksums match all six platform entries", flush=True)
        print(run([AQUA, "exec", "--", "github-comment", "--version"], env), flush=True)
        run([AQUA, "update-checksum", "-deep", "-prune"], env)
        assert generated == (directory / "aqua-checksums.json").read_bytes()
        print("PASS: real install and idempotent checksum generation", flush=True)

        cosign = next(path for path in (directory / "root/pkgs").rglob("cosign-linux-amd64")
                      if path.is_file())

        def verify(options=opts, artifact=checksum, signature=bundle, reject=False):
            return run([str(cosign), "verify-blob", "--bundle", str(signature),
                        *options, str(artifact)], env, reject=reject)

        verify()
        for flag in expected:
            wrong = opts.copy()
            wrong[wrong.index(flag) + 1] = "https://invalid.example/wrong" if flag != "--certificate-github-workflow-ref" else "refs/tags/v0.0.0"
            verify(wrong, reject=True)
            print(f"PASS: rejects wrong {flag}", flush=True)
        modified = base / "modified.txt"
        modified.write_bytes(checksum.read_bytes() + b"tampered\n")
        verify(artifact=modified, reject=True)
        tampered_bundle = base / "tampered.sigstore.json"
        data = json.loads(bundle.read_text())
        signature = data["messageSignature"]["signature"]
        data["messageSignature"]["signature"] = ("A" if signature[0] != "A" else "B") + signature[1:]
        tampered_bundle.write_text(json.dumps(data))
        verify(signature=tampered_bundle, reject=True)
        print("PASS: rejects modified checksum and signature", flush=True)

        # Legacy release still uses .pem/.sig plus SLSA; ghalint retains its upstream fix.
        for name, imported, binary in (
            ("legacy", package_import.replace(VERSION, "v6.4.1"), "github-comment"),
            ("ghalint", (REPO / "aqua/imports/ghalint.yaml").read_text(), "ghalint"),
        ):
            _, old_env = fixture(base, name, imported, registry)
            run([AQUA, "update-checksum", "-deep", "-prune"], old_env)
            print(run([AQUA, "exec", "--", binary, "--version"], old_env), flush=True)
            print(f"PASS: {name} real install with signature verification", flush=True)


if __name__ == "__main__":
    main()
