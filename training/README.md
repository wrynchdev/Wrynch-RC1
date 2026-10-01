# Training a part-detection model

1. In Wrynch, a shop owner turns on **Settings → Help improve Wrynch’s AI**. Only those shops’ technician-confirmed
   photos are offered for labeling.
2. Wrynch staff open **Training data**, check the AI’s pre-drawn boxes, fix or add boxes, and approve (or skip)
   each photo. The page shows how many boxes each part type has; a few hundred good examples per part type is a
   common starting point.
3. **Export dataset** downloads a JSON file: part types, boxes in YOLO format, and photo links valid for 7 days.
4. On a computer with an NVIDIA GPU (or in Google Colab with a GPU runtime):

   ```
   pip install -r requirements.txt
   python train.py wrynch-dataset-2026-10-01.json
   ```

   It downloads the photos, builds the dataset (a stable 90/10 train/validation split), trains, prints the
   validation scores (mAP50 and mAP50-95; higher is better), and saves the best weights and an ONNX copy.

Options: `--model` (starting weights), `--epochs`, `--imgsz`. Photos and labels stay on the machine you train on;
treat them like customer data and delete them when you're done.

Using a trained model inside Wrynch (to find parts in new photos) is a separate step, for once the scores are good.
