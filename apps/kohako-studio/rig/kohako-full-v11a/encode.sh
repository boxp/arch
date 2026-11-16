#!/bin/sh
set -eu
cd /work
ffmpeg -y -loglevel error -framerate 8 -i normal-j/%04d.jpg -framerate 8 -i normal-k/%04d.jpg -filter_complex '[0:v]scale=418:554,drawtext=text=v10k:x=10:y=10:fontcolor=white:box=1:boxcolor=black@0.6[a];[1:v]scale=418:554,drawtext=text=v11a:x=10:y=10:fontcolor=white:box=1:boxcolor=black@0.6[b];[a][b]hstack' -c:v libx264 -preset veryfast -crf 27 -pix_fmt yuv420p -movflags +faststart normal-pair.mp4
count=$(find natural-k -name '*.jpg' | wc -l)
fps=$(awk "BEGIN {print $count/15}")
ffmpeg -y -loglevel error -framerate "$fps" -i natural-k/%04d.jpg -vf 'scale=418:554,drawtext=text=v11a:x=10:y=10:fontcolor=white:box=1:boxcolor=black@0.6' -c:v libx264 -preset veryfast -crf 27 -pix_fmt yuv420p -movflags +faststart natural.mp4
