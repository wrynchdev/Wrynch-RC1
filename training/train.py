#!/usr/bin/env python3
"""Train a part-detection model from a Wrynch dataset export.

    pip install -r requirements.txt
    python train.py wrynch-dataset-2026-10-01.json

Downloads the photos (the links in an export work for 7 days), builds the dataset next to the export, fine-tunes
RT-DETR v2 (pretrained on COCO; Apache 2.0, through Hugging Face Transformers), prints the validation scores, and
saves the model folder plus an ONNX copy. Needs a computer with an NVIDIA GPU (or Google Colab with a GPU runtime);
it will run on a CPU, just very slowly.

Licenses: the code, the starting weights and Transformers are Apache 2.0, so a model trained here can be used in a
commercial product. (The earlier version of this script used Ultralytics YOLO, which is AGPL-3.0.)
"""
import argparse
import json
import pathlib
import random
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

DEFAULT_MODEL = "PekingU/rtdetr_v2_r18vd"  # small and fast; PekingU/rtdetr_v2_r50vd is larger and more accurate


def build_dataset(manifest_path: pathlib.Path, out: pathlib.Path) -> dict:
    """Download the photos and return {classes, train, val}; each image is {file, labels: [[class, cx, cy, w, h], ...]}."""
    m = json.loads(manifest_path.read_text())
    if m.get("format") != "wrynch-yolo-1":
        sys.exit("This doesn't look like a Wrynch dataset export.")
    (out / "images").mkdir(parents=True, exist_ok=True)

    def fetch(img):
        dest = out / "images" / f"{img['id']}.jpg"
        if not dest.exists():
            try:
                urllib.request.urlretrieve(img["url"], dest)
            except Exception as e:  # expired link, network error
                return None, f"{img['id']}: {e}"
        return {"file": str(dest), "split": img["split"], "labels": img["labels"]}, None

    with ThreadPoolExecutor(8) as pool:
        results = list(pool.map(fetch, m["images"]))
    errors = [e for _, e in results if e]
    if errors:
        print(f"{len(errors)} photos couldn't be downloaded (links last 7 days; export again if they expired):")
        for e in errors[:10]:
            print("  ", e)
    images = [r for r, _ in results if r and r["labels"]]
    data = {
        "classes": {c["index"]: c["name"] for c in m["classes"]},
        "train": [i for i in images if i["split"] == "train"],
        "val": [i for i in images if i["split"] == "val"],
    }
    (out / "dataset.json").write_text(json.dumps(data, indent=1))
    print(f"Dataset: {len(data['train'])} training photos, {len(data['val'])} validation photos, {len(data['classes'])} part types")
    if not data["val"]:
        sys.exit("No validation photos yet. Label more photos before training.")
    return data


def coco_annotations(labels, width, height, image_id):
    """YOLO rows (fractions, box centre) to COCO boxes (pixels, top-left corner), the format the image processor takes."""
    anns = []
    for c, cx, cy, w, h in labels:
        bw, bh = w * width, h * height
        anns.append({"bbox": [(cx - w / 2) * width, (cy - h / 2) * height, bw, bh], "category_id": int(c), "area": bw * bh, "iscrowd": 0})
    return {"image_id": image_id, "annotations": anns}


def flip_labels(labels):
    """Mirror left to right. Part types don't include the side of the car, so a flipped photo is still correct."""
    return [[c, 1 - cx, cy, w, h] for c, cx, cy, w, h in labels]


def train(data: dict, out: pathlib.Path, model_id: str, epochs: int, imgsz: int, batch: int, lr: float):
    import numpy as np
    import torch
    from PIL import Image, ImageOps
    from transformers import AutoImageProcessor, AutoModelForObjectDetection, Trainer, TrainingArguments

    id2label = {int(i): n for i, n in data["classes"].items()}
    label2id = {n: i for i, n in id2label.items()}
    processor = AutoImageProcessor.from_pretrained(model_id, size={"height": imgsz, "width": imgsz})
    model = AutoModelForObjectDetection.from_pretrained(model_id, id2label=id2label, label2id=label2id, ignore_mismatched_sizes=True)

    class Photos(torch.utils.data.Dataset):
        def __init__(self, items, augment):
            self.items, self.augment = items, augment

        def __len__(self):
            return len(self.items)

        def __getitem__(self, i):
            item = self.items[i]
            img = ImageOps.exif_transpose(Image.open(item["file"])).convert("RGB")
            labels = item["labels"]
            if self.augment and random.random() < 0.5:
                img, labels = ImageOps.mirror(img), flip_labels(labels)
            enc = processor(images=img, annotations=coco_annotations(labels, img.width, img.height, i), return_tensors="pt")
            return {"pixel_values": enc["pixel_values"][0], "labels": enc["labels"][0]}

    def collate(batch_items):
        return {"pixel_values": torch.stack([b["pixel_values"] for b in batch_items]), "labels": [b["labels"] for b in batch_items]}

    args = TrainingArguments(
        output_dir=str(out / "runs"), num_train_epochs=epochs, per_device_train_batch_size=batch, per_device_eval_batch_size=batch,
        learning_rate=lr, weight_decay=1e-4, warmup_ratio=0.05, max_grad_norm=0.1, fp16=torch.cuda.is_available(),
        eval_strategy="epoch", save_strategy="epoch", save_total_limit=2, load_best_model_at_end=True,
        metric_for_best_model="eval_loss", greater_is_better=False, remove_unused_columns=False,
        dataloader_num_workers=2, logging_steps=20, report_to="none",
    )
    trainer = Trainer(model=model, args=args, train_dataset=Photos(data["train"], True), eval_dataset=Photos(data["val"], False), data_collator=collate)
    trainer.train()

    best = out / "model"
    trainer.save_model(str(best))
    processor.save_pretrained(str(best))
    score(trainer.model, processor, data["val"])
    export_onnx(trainer.model, imgsz, best / "model.onnx")
    print(f"Model folder: {best}")


def score(model, processor, items):
    """Validation mAP50 and mAP50-95 (higher is better)."""
    import torch
    from PIL import Image, ImageOps
    from torchmetrics.detection import MeanAveragePrecision

    metric = MeanAveragePrecision(box_format="xyxy")
    model.eval()
    device = next(model.parameters()).device
    for item in items:
        img = ImageOps.exif_transpose(Image.open(item["file"])).convert("RGB")
        with torch.no_grad():
            out = model(pixel_values=processor(images=img, return_tensors="pt")["pixel_values"].to(device))
        pred = processor.post_process_object_detection(out, threshold=0.01, target_sizes=torch.tensor([[img.height, img.width]]))[0]
        boxes = [[(cx - w / 2) * img.width, (cy - h / 2) * img.height, (cx + w / 2) * img.width, (cy + h / 2) * img.height] for _, cx, cy, w, h in item["labels"]]
        target = {"boxes": torch.tensor(boxes, dtype=torch.float32), "labels": torch.tensor([int(l[0]) for l in item["labels"]])}
        metric.update([{k: v.cpu() for k, v in pred.items()}], [target])
    r = metric.compute()
    print(f"Validation mAP50: {float(r['map_50']):.3f}   mAP50-95: {float(r['map']):.3f}")


def export_onnx(model, imgsz, path):
    """ONNX copy for running outside Python. Outputs: logits [batch, queries, classes], pred_boxes [batch, queries, 4] (cx, cy, w, h; fractions)."""
    import torch

    class Wrapper(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, pixel_values):
            o = self.m(pixel_values=pixel_values)
            return o.logits, o.pred_boxes

    try:
        model = model.cpu().eval()
        torch.onnx.export(Wrapper(model), (torch.zeros(1, 3, imgsz, imgsz),), str(path), input_names=["pixel_values"],
                          output_names=["logits", "pred_boxes"], dynamic_axes={"pixel_values": {0: "batch"}}, opset_version=17)
        print(f"ONNX copy:   {path}")
    except Exception as e:  # the model folder is still usable
        print(f"ONNX export didn't work ({e}); the model folder can still be loaded with Transformers.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("export", type=pathlib.Path, help="the JSON file from Wrynch → Training data → Export dataset")
    ap.add_argument("--model", default=DEFAULT_MODEL, help=f"starting weights on Hugging Face (default {DEFAULT_MODEL})")
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--imgsz", type=int, default=640, help="training image size; larger finds small parts better but is slower")
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--lr", type=float, default=5e-5)
    ap.add_argument("--out", type=pathlib.Path, default=None, help="dataset and output folder (default: next to the export)")
    ap.add_argument("--dataset-only", action="store_true", help="download the photos and build the dataset, then stop")
    args = ap.parse_args()

    out = args.out or args.export.with_suffix("")
    data = build_dataset(args.export, out)
    if args.dataset_only:
        return
    train(data, out, args.model, args.epochs, args.imgsz, args.batch, args.lr)


if __name__ == "__main__":
    main()
