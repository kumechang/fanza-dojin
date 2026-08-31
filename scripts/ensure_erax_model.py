"""EraX-NSFW-V1.0のモデルファイルをmodels/配下に用意する。既にあれば何もしない。
CIのキャッシュミス時のフォールバック、およびローカル開発の初回セットアップの両方で使う。
"""

from pathlib import Path

from huggingface_hub import hf_hub_download

MODEL_DIR = Path(__file__).parent.parent / "models"
MODEL_FILENAME = "erax_nsfw_yolo11m.pt"
REPO_ID = "erax-ai/EraX-NSFW-V1.0"


def ensure_model() -> Path:
    target = MODEL_DIR / MODEL_FILENAME
    if not target.exists():
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        hf_hub_download(repo_id=REPO_ID, filename=MODEL_FILENAME, local_dir=str(MODEL_DIR))
    return target


if __name__ == "__main__":
    print(ensure_model())
