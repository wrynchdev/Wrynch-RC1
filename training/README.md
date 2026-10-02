# Training a part-detection model

1. In Wrynch, a shop owner turns on **Settings → Help improve Wrynch’s AI**. Only those shops’ technician-confirmed
   photos are offered for labeling.
2. Wrynch staff open **Training data**, check the pre-drawn boxes (from the part detector if `DETECTOR_URL` is set,
   otherwise from the AI), fix or add boxes, and approve (or skip)
   each photo. The page shows how many boxes each part type has; a few hundred good examples per part type is a
   common starting point.
3. **Export dataset** downloads a JSON file: part types, boxes in YOLO format, and photo links valid for 7 days.
4. On a computer with an NVIDIA GPU (or in Google Colab with a GPU runtime):

   ```
   pip install -r requirements.txt
   python train.py wrynch-dataset-2026-10-01.json
   ```

   It downloads the photos, builds the dataset (a stable 90/10 train/validation split), fine-tunes RT-DETR v2
   (pretrained on COCO), prints the validation scores (mAP50 and mAP50-95; higher is better), and saves the model
   folder (`<export name>/model`) plus an ONNX copy.

Options: `--model` (starting weights on Hugging Face; default `PekingU/rtdetr_v2_r18vd`, or the larger
`PekingU/rtdetr_v2_r50vd`), `--epochs`, `--imgsz`, `--batch`, `--lr`, and `--dataset-only` to just download and
build the dataset.

**Licenses.** The script, Transformers and the RT-DETR v2 weights are Apache 2.0, so a model trained here can be used
in Wrynch commercially. (Ultralytics YOLO, which the first version of this script used, is AGPL-3.0 and needs a paid
license for use in a closed product.) Public datasets each have their own license; check before mixing one in. Photos and labels stay on the machine you train on;
treat them like customer data and delete them when you're done.

Using a trained model inside Wrynch (to find parts in new photos) is a separate step, for once the scores are good.
