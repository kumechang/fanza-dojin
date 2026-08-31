"""EraX-NSFW-V1.0(erax-ai/EraX-NSFW-V1.0, YOLO11)で検出した性的描写部位を黒塗りするCLIスクリプト。
Node.js側 (src/x/censorImage.ts) からサブプロセスとして呼び出される。
検出クラス: anus / make_love / nipple / penis / vagina

引数: ジョブ定義ファイルのパス(JSON)。
  {
    "confThreshold": 0.15,
    "iouThreshold": 0.3,
    "jobs": [{"input": "...", "output": "...", "classes": ["anus", "nipple", ...]}]
  }

標準出力: 各ジョブの結果をJSON配列で最終行に1行出力する(検出クラス・スコア・boxを含む、ログ/デバッグ用)。
失敗時は非ゼロで終了しstderrにエラーを出す。Node側はそれを例外として扱い、投稿しない
(検閲に失敗したら投稿しない、というフェイルセーフはNode側のtry/catchに委ねる)。
"""

import json
import sys

from ensure_erax_model import ensure_model
from PIL import Image, ImageDraw
from ultralytics import YOLO

# confidence閾値を低め(0.15)にしている分、検出boxの境界が実際の露出部位より
# やや狭く出ることがあるため、塗りつぶし範囲に安全マージンを加える。
BOX_PADDING_RATIO = 0.1


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: censor_image.py <jobs.json>", file=sys.stderr)
        sys.exit(1)

    with open(sys.argv[1], encoding="utf-8") as f:
        spec = json.load(f)
    jobs = spec["jobs"]

    images = [Image.open(job["input"]) for job in jobs]
    for img in images:
        if getattr(img, "is_animated", False):
            # アニメーションGIF等の複数フレーム画像は先頭フレームしか塗れず取りこぼしの
            # 危険があるため、黙って処理せず失敗させる(投稿しない方を優先するフェイルセーフ)。
            raise ValueError(f"animated image not supported for censorship: {job['input']}")

    model = YOLO(str(ensure_model()))
    results = model(
        [job["input"] for job in jobs],
        conf=spec["confThreshold"],
        iou=spec["iouThreshold"],
        verbose=False,
    )

    output = []
    for job, img, result in zip(jobs, images, results):
        classes = set(job.get("classes") or [])
        rgb = img.convert("RGB")
        draw = ImageDraw.Draw(rgb)
        matched = []
        for box in result.boxes:
            cls_name = result.names[int(box.cls[0])]
            score = float(box.conf[0])
            if classes and cls_name not in classes:
                continue
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            pad_x, pad_y = (x2 - x1) * BOX_PADDING_RATIO, (y2 - y1) * BOX_PADDING_RATIO
            box_padded = (
                max(0, x1 - pad_x),
                max(0, y1 - pad_y),
                min(rgb.width, x2 + pad_x),
                min(rgb.height, y2 + pad_y),
            )
            draw.rectangle(box_padded, fill="black")
            matched.append({"class": cls_name, "score": score, "box": [x1, y1, x2, y2]})
        rgb.save(job["output"])
        output.append({"input": job["input"], "output": job["output"], "detections": matched})

    print(json.dumps(output))


if __name__ == "__main__":
    main()
