import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scrapers" / "news-feed" / "helpers"))
sys.path.insert(0, str(ROOT / "scrapers" / "corporate"))
