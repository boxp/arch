#!/bin/sh
set -eu
cd /work
for kind in normal magenta; do
 ffmpeg -y -loglevel error -framerate 8 -i "$kind-h/%04d.jpg" -framerate 8 -i "$kind-i/%04d.jpg" -filter_complex '[0:v]scale=418:554,drawtext=text=v10h:x=10:y=10:fontcolor=white:box=1:boxcolor=black@0.6[a];[1:v]scale=418:554,drawtext=text=v10i:x=10:y=10:fontcolor=white:box=1:boxcolor=black@0.6[b];[a][b]hstack' -c:v libx264 -preset veryfast -crf 27 -pix_fmt yuv420p -movflags +faststart "$kind-pair.mp4"
done
for ver in h i; do
 count=$(find "natural-$ver" -name '*.jpg' | wc -l)
 fps=$(awk "BEGIN {print $count/15}")
 ffmpeg -y -loglevel error -framerate "$fps" -i "natural-$ver/%04d.jpg" -vf "scale=418:554,drawtext=text=v10$ver:x=10:y=10:fontcolor=white:box=1:boxcolor=black@0.6" -c:v libx264 -preset veryfast -crf 27 -pix_fmt yuv420p -movflags +faststart "natural-$ver.mp4"
done
