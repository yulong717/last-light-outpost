#!/usr/bin/env bash
# Knife videos: idle, walk, moves 1-4, dash. 4 seeds each, 512x576.
cd /c/AI/last-light-outpost
KEEPV="Pixel art game sprite animation of the chibi baseball kid from <Picture 1>: keep his face, curly hair under the navy cap, pinstripe jersey with red 7, navy shorts, bandaged knees, red and white sneakers, the small military combat knife in his right hand, colors and thick black outlines exactly. Three-quarter view facing right, fixed camera, no zoom, no pan, full body and the knife visible at all times, plain solid magenta background, flat colors."
SZ="--set scale_first.width=512 --set scale_first.height=576 --set scale_last.width=512 --set scale_last.height=576 --set cond.width=512 --set cond.height=576"
R=art/ai/raw/knife/knife_ready.png
run() { name=$1; first=$2; last=$3; len=$4; prompt=$5
  for s in 1 2 3 4; do
    PYTHONIOENCODING=utf-8 ./.venv-art/Scripts/python -I tools/art/ai/run_comfy.py art/ai/workflows/h3_video_i2v.json $SZ \
      --image first=$first --image last=$last --set cond.length=$len --set noise.noise_seed=$s \
      --set save.filename_prefix=ai_art/knife_${name}_s$s --out art/ai/raw/knife/${name}_s$s \
      --tag "knife $name seed $s" --set cond.prompt="$KEEPV $prompt" 2>&1 | grep -oE '"seconds[^,]*|error.*' | sed "s/^/$name s$s /"
  done; }
run idle $R $R 56 "He stands in his low knife-fighting stance, breathing calmly, chest rises and falls slightly, the knife hand and guard hand stay up, feet stay planted. Seamless loop."
run walk art/ai/raw/knife/knife_walkkey.png art/ai/raw/knife/knife_walkkey.png 56 "He walks in place on a treadmill keeping the knife hand and guard hand up in front of his chest, long strides, legs clearly alternating, knees lifting, heel strike and toe push-off, steady rhythm. Two full steps. Seamless loop."
run m1 $R $R 39 "Quick stab: he snaps his right hand forward and stabs the knife straight ahead to the right at chest height, arm fully extended, the blade pointing forward, then quickly pulls back to the ready stance. Very fast, short motion. Feet stay on the ground line."
run m2 $R $R 39 "Second stab: he twists his body so his left shoulder comes forward, then stabs the knife straight ahead to the right again with a quick thrust at chest height, then returns to the ready stance. Fast motion. Feet stay on the ground line."
run m3 $R $R 39 "Wide horizontal slash: he swings the knife arm outward in a big horizontal arc in front of him from left to right at chest height, the blade sweeping wide, his torso turning with the swing, then returns to the ready stance. Feet stay on the ground line."
run m4 $R $R 39 "Heavy lunge stab: he drops his body low, grips the knife with both hands and lunges his whole body forward, thrusting the knife hard straight ahead to the right, front knee deeply bent, back leg stretched, then recovers back to the ready stance. Powerful motion."
run dash $R $R 39 "Low sliding lunge: he crouches very low and slides forward along the ground with his body almost touching the ground, one leg stretched forward, stabbing the knife straight ahead to the right, then rises back up to the ready stance."
echo ALL_VIDEOS_DONE
