"""Run an API-format ComfyUI workflow with field overrides, download outputs, write meta.json.

Usage:
  python tools/art/ai/run_comfy.py art/ai/workflows/h3_image_edit.json \
      --image load1=art/ai/refs/akai_body_teen_x8.png \
      --set cond.prompt="..." --set sampler.seed=1 \
      --out art/ai/raw/test/h3_image_edit

Node keys in the workflow JSON are readable names (e.g. "sampler"), so --set uses
<node>.<input>=<value>. Values are parsed as JSON when possible, else kept as strings.
--image <node>=<path> uploads the file and sets that LoadImage node's "image" input.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import threading
import time
import uuid
from pathlib import Path

import requests

DEFAULT_URL = "http://127.0.0.1:8000"


def parse_value(raw: str):
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


class VramSampler(threading.Thread):
    """Poll nvidia-smi for peak used memory (MiB) while a job runs."""

    def __init__(self, interval: float = 0.5):
        super().__init__(daemon=True)
        self.interval = interval
        self.peak = 0
        self._stop = threading.Event()

    def run(self):
        while not self._stop.is_set():
            try:
                out = subprocess.run(
                    ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                    capture_output=True, text=True, timeout=5,
                ).stdout.strip().splitlines()
                if out:
                    self.peak = max(self.peak, int(out[0]))
            except Exception:
                pass
            self._stop.wait(self.interval)

    def stop(self):
        self._stop.set()


def upload(url: str, path: Path) -> str:
    with path.open("rb") as f:
        r = requests.post(f"{url}/upload/image", files={"image": (path.name, f, "image/png")},
                          data={"overwrite": "true"}, timeout=60)
    r.raise_for_status()
    d = r.json()
    return f"{d['subfolder']}/{d['name']}" if d.get("subfolder") else d["name"]


def run(workflow: dict, url: str, out_dir: Path, timeout: float) -> dict:
    client_id = uuid.uuid4().hex
    r = requests.post(f"{url}/prompt", json={"prompt": workflow, "client_id": client_id}, timeout=60)
    if r.status_code != 200:
        raise SystemExit(f"/prompt rejected ({r.status_code}): {r.text[:2000]}")
    prompt_id = r.json()["prompt_id"]

    vram = VramSampler()
    vram.start()
    t0 = time.time()
    try:
        while True:
            h = requests.get(f"{url}/history/{prompt_id}", timeout=30).json()
            if prompt_id in h:
                entry = h[prompt_id]
                status = entry.get("status", {})
                if status.get("completed") or status.get("status_str") in ("success", "error"):
                    break
            if time.time() - t0 > timeout:
                raise SystemExit(f"timeout after {timeout}s (prompt {prompt_id})")
            time.sleep(1)
    finally:
        vram.stop()
    elapsed = time.time() - t0

    if status.get("status_str") == "error":
        msgs = [m for m in status.get("messages", []) if m[0] == "execution_error"]
        raise SystemExit(f"execution error: {json.dumps(msgs, ensure_ascii=False)[:3000]}")

    out_dir.mkdir(parents=True, exist_ok=True)
    files = []
    for node_id, node_out in entry.get("outputs", {}).items():
        for kind in ("images", "gifs", "videos"):
            for item in node_out.get(kind, []):
                if item.get("type") == "temp":
                    continue
                params = {"filename": item["filename"], "subfolder": item.get("subfolder", ""),
                          "type": item.get("type", "output")}
                data = requests.get(f"{url}/view", params=params, timeout=120).content
                dest = out_dir / item["filename"]
                dest.write_bytes(data)
                files.append(str(dest))
    return {"prompt_id": prompt_id, "seconds": round(elapsed, 1), "vram_peak_mib": vram.peak, "files": files}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("workflow", type=Path)
    ap.add_argument("--set", action="append", default=[], metavar="NODE.INPUT=VALUE")
    ap.add_argument("--image", action="append", default=[], metavar="NODE=PATH")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--timeout", type=float, default=3600)
    ap.add_argument("--free", action="store_true", help="call /free (unload models) after the run")
    ap.add_argument("--tag", default="", help="free-text note stored in meta.json")
    args = ap.parse_args()

    wf = json.loads(args.workflow.read_text(encoding="utf-8"))
    wf.pop("_meta_doc", None)
    overrides = {}
    for spec in args.image:
        node, path = spec.split("=", 1)
        name = upload(args.url, Path(path))
        wf[node]["inputs"]["image"] = name
        overrides[f"{node}.image"] = path
    for spec in args.set:
        key, raw = spec.split("=", 1)
        node, field = key.split(".", 1)
        if node not in wf:
            raise SystemExit(f"unknown node '{node}' (have: {', '.join(wf)})")
        value = parse_value(raw)
        if value is None:  # --set node.input=null removes an (optional) input link
            wf[node]["inputs"].pop(field, None)
        else:
            wf[node]["inputs"][field] = value
        overrides[key] = value
    # drop nodes nothing references anymore (e.g. an unused LoadImage after removing its link)
    def referenced():
        refs = set()
        for n in wf.values():
            for v in n["inputs"].values():
                if isinstance(v, list) and len(v) == 2 and isinstance(v[0], str):
                    refs.add(v[0])
        return refs
    while True:
        refs = referenced()
        dead = [k for k, n in wf.items() if k not in refs and not n["class_type"].startswith("Save")]
        if not dead:
            break
        for k in dead:
            wf.pop(k)

    result = run(wf, args.url, args.out, args.timeout)

    models = {k: v["inputs"] for k, v in wf.items()
              if v["class_type"] in ("UNETLoader", "CLIPLoader", "VAELoader", "LoraLoaderModelOnly",
                                     "LoraLoader", "CheckpointLoaderSimple", "UnetLoaderGGUF")}
    meta = {
        "workflow": str(args.workflow).replace("\\", "/"),
        "overrides": overrides,
        "models": models,
        "tag": args.tag,
        "time": time.strftime("%Y-%m-%d %H:%M:%S"),
        **result,
    }
    meta_path = args.out / "meta.json"
    existing = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else []
    if isinstance(existing, dict):
        existing = [existing]
    existing.append(meta)
    meta_path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.free:
        requests.post(f"{args.url}/free", json={"unload_models": True, "free_memory": True}, timeout=60)

    print(json.dumps({k: meta[k] for k in ("seconds", "vram_peak_mib", "files")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
