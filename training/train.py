#!/usr/bin/env python3
"""Train a part-detection model from a Wrynch dataset export.

    pip install -r requirements.txt
    python train.py wrynch-dataset-2026-10-01.json

Downloads the photos (the links in an export work for 7 days), writes a YOLO dataset next to the export, trains,
and saves the best weights plus an ONNX copy. Needs a computer with an NVIDIA GPU (or Google Colab with a GPU
runtime); it will run on a CPU, just very slowly.
"""
import argparse
import json
import pathlib
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor


def build_dataset(manifest_path: pathlib.Path, out: pathlib.Path) -> pathlib.Path:
    m = json.loads(manifest_path.read_text())
    if m.get("format") != "wrynch-yolo-1":
        sys.exit("This doesn't look like a Wrynch dataset export.")
    for split in ("train", "val"):
        (out / "images" / split).mkdir(parents=True, exist_ok=True)
        (out / "labels" / split).mkdir(parents=True, exist_ok=True)

    def fetch(img):
        dest = out / "images" / img["split"] / f"{img['id']}.jpg"
        if not dest.exists():
            try:
                urllib.request.urlretrieve(img["url"], dest)
            except Exception as e:  # expired link, network error
                return f"{img['id']}: {e}"
        rows = [f"{c} {x:.6f} {y:.6f} {w:.6f} {h:.6f}" for c, x, y, w, h in img["labels"]]
        (out / "labels" / img["split"] / f"{img['id']}.txt").write_text("\n".join(rows) + "\n")
        return None

    with ThreadPoolExecutor(8) as pool:
        errors = [e for e in pool.map(fetch, m["images"]) if e]
    if errors:
        print(f"{len(errors)} photos couldn't be downloaded (links last 7 days; export again if they expired):")
        for e in errors[:10]:
            print("  ", e)

    names = {c["index"]: c["name"] for c in m["classes"]}
    yaml = out / "data.yaml"
    yaml.write_text(
        f"path: {out.resolve()}\ntrain: images/train\nval: images/val\nnames:\n"
        + "".join(f"  {i}: {names[i]}\n" for i in sorted(names))
    )
    counts = {"train": 0, "val": 0}
    for img in m["images"]:
        counts[img["split"]] += 1
    print(f"Dataset: {counts['train']} training photos, {counts['val']} validation photos, {len(names)} part types -> {yaml}")
    if counts["val"] == 0:
        sys.exit("No validation photos yet. Label more photos before training.")
    return yaml


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("export", type=pathlib.Path, help="the JSON file from Wrynch → Training data → Export dataset")
    ap.add_argument("--model", default="yolo11n.pt", help="starting weights (a small pretrained YOLO model by default)")
    ap.add_argument("--epochs", type=int, default=100)
    ap.add_argument("--imgsz", type=int, default=960, help="training image size; larger finds small parts better but is slower")
    ap.add_argument("--out", type=pathlib.Path, default=None, help="dataset folder (default: next to the export)")
    args = ap.parse_args()

    out = args.out or args.export.with_suffix("")
    data = build_dataset(args.export, out)

    from ultralytics import YOLO  # imported here so building the dataset works without it

    model = YOLO(args.model)
    model.train(data=str(data), epochs=args.epochs, imgsz=args.imgsz, project=str(out / "runs"), name="wrynch-parts")
    best = pathlib.Path(model.trainer.best)
    metrics = YOLO(best).val(data=str(data), imgsz=args.imgsz)
    print(f"Validation mAP50: {metrics.box.map50:.3f}   mAP50-95: {metrics.box.map:.3f}")
    onnx = YOLO(best).export(format="onnx", imgsz=args.imgsz)
    print(f"Best weights: {best}\nONNX copy:   {onnx}")


if __name__ == "__main__":
    main()
