#!/usr/bin/env bash
# Machete videos: idle, walk, moves 1-3, dash. 4 seeds each, 512x576.
cd /c/AI/last-light-outpost
KEEPV="Pixel art game sprite animation of the chibi baseball kid from <Picture 1>: keep his face, curly hair under the navy cap, pinstripe jersey with red 7, navy shorts, bandaged knees, red and white sneakers, the machete with its long wide blade, colors and thick black outlines exactly. Three-quarter view facing right, fixed camera, no zoom, no pan, full body and the whole machete visible at all times. The background stays plain solid magenta in every frame. No slash trails, no motion streaks, no sparks, no flashes, no effects. Flat colors."
SZ="--set scale_first.width=512 --set scale_first.height=576 --set scale_last.width=512 --set scale_last.height=576 --set cond.width=512 --set cond.height=576"
R=art/ai/raw/machete/machete_ready.png
run() { name=$1; first=$2; last=$3; len=$4; prompt=$5
  for s in 1 2 3 4; do
    PYTHONIOENCODING=utf-8 ./.venv-art/Scripts/python -I tools/art/ai/run_comfy.py art/ai/workflows/h3_video_i2v.json $SZ \
      --image first=$first --image last=$last --set cond.length=$len --set noise.noise_seed=$s \
      --set save.filename_prefix=ai_art/machete_${name}_s$s --out art/ai/raw/machete/${name}_s$s \
      --tag "machete $name seed $s" --set cond.prompt="$KEEPV $prompt" 2>&1 | grep -oE '"seconds[^,]*|error.*' | sed "s/^/$name s$s /"
  done; }
run idle $R $R 56 "He stands in his ready stance holding the machete up beside his shoulder, breathing calmly, chest rises and falls slightly, the machete and the guard hand stay still, feet stay planted. Seamless loop."
run walk art/ai/raw/machete/machete_walkkey.png art/ai/raw/machete/machete_walkkey.png 56 "He walks in place on a treadmill keeping the machete raised beside his shoulder and the guard hand up, long strides, legs clearly alternating, knees lifting, heel strike and toe push-off, steady rhythm. Two full steps. Seamless loop."
run m1 $R $R 39 "Diagonal chop: he swings the machete from above his shoulder diagonally down across the front of his body, chopping forward to the right and down to the lower left, the blade ending low near his left knee, his torso turning with the swing, then he lifts it back up to the ready stance. Feet stay on the ground line."
run m2 $R $R 39 "Backhand cut: he starts with the machete low on his left side, then swings it back up across his body in a wide sweeping arc from the lower left to the upper right in front of him, arm extended, then returns to the ready stance. Feet stay on the ground line."
run m3 $R $R 39 "Jumping chop: he crouches, hops a little off the ground with both feet, raises the machete high overhead with both hands, then chops it straight down hard in front of him as he lands, knees bent on landing, then straightens back up to the ready stance."
run dash $R $R 39 "Spinning slash: he spins his whole body around one full turn in place with the machete held out at arm's length, the blade sweeping around him in a full circle; halfway through the spin his back faces the camera; then he finishes facing right again and returns to the ready stance."
echo ALL_VIDEOS_DONE
