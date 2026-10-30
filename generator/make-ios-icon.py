# 从 Android 自适应图标合成 iOS AppIcon 全尺寸
from PIL import Image
import json
import os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fg_path = os.path.join(
    root, "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.webp"
)
out_dir = os.path.join(root, "ios/MusicFree/Images.xcassets/AppIcon.appiconset")
bg = (0x27, 0x28, 0x2C, 255)

fg = Image.open(fg_path).convert("RGBA")
n = fg.width
canvas = Image.new("RGBA", (n, n), bg)
scale = 0.72
w = int(n * scale)
canvas.alpha_composite(fg.resize((w, w), Image.LANCZOS), ((n - w) // 2, (n - w) // 2))
base = canvas.resize((1024, 1024), Image.LANCZOS).convert("RGB")

specs = [
    ("Icon-20@2x.png", "iphone", "2x", "20x20", 40),
    ("Icon-20@3x.png", "iphone", "3x", "20x20", 60),
    ("Icon-29@2x.png", "iphone", "2x", "29x29", 58),
    ("Icon-29@3x.png", "iphone", "3x", "29x29", 87),
    ("Icon-40@2x.png", "iphone", "2x", "40x40", 80),
    ("Icon-40@3x.png", "iphone", "3x", "40x40", 120),
    ("Icon-60@2x.png", "iphone", "2x", "60x60", 120),
    ("Icon-60@3x.png", "iphone", "3x", "60x60", 180),
    ("Icon-1024.png", "ios-marketing", "1x", "1024x1024", 1024),
]
images = []
for filename, idiom, px_scale, size, px in specs:
    base.resize((px, px), Image.LANCZOS).save(os.path.join(out_dir, filename))
    images.append(
        {"filename": filename, "idiom": idiom, "scale": px_scale, "size": size}
    )

with open(os.path.join(out_dir, "Contents.json"), "w", encoding="utf-8") as f:
    json.dump({"images": images, "info": {"author": "xcode", "version": 1}}, f, indent=2)
    f.write("\n")
print("icons written to", out_dir)
