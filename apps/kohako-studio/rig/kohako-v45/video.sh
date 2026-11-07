#!/usr/bin/env bash
# Run after v38 and candidate builds. b441pw has Playwright 1.56.1, jimp and ffmpeg.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
VIDEO=$(cd "$HERE/../../verify/video" && pwd)
OUT=${OUT:?set OUT to build output directory}
DEST=${DEST:?set DEST to comparison output directory}
mkdir -p "$DEST"
docker cp "$HERE/record.mjs" b441pw:/work/record45.mjs
docker cp "$VIDEO/pair.mjs" b441pw:/work/pair.mjs
docker cp "$VIDEO/sheet.mjs" b441pw:/work/sheet.mjs
docker cp "$OUT/v38/out/kohako-v38.p2lrt" b441pw:/work/v38-45.p2lrt
docker cp "$OUT/v45/out/kohako-v45.p2lrt" b441pw:/work/v45.p2lrt
for version in v38 v45; do
 for scenario in idle blink slow det; do
  file=/work/v45.p2lrt; [ "$version" = v38 ] && file=/work/v38-45.p2lrt
  docker exec -w /work b441pw rm -rf "out/v45-$version-$scenario"
  docker exec -w /work -e H="${H:-http://kohako-studio.kohako-studio.svc.cluster.local}" -e OVERRIDE_P2LRT="$file" b441pw node record45.mjs kohako-v38 "$scenario" "out/v45-$version-$scenario" pc
 done
done
for scenario in idle blink slow det; do
 crop=0.4,0.31,0.4,0.18; scale=1.5; [ "$scenario" = det ] && crop=0,0,1,1 && scale=0.7
 docker exec -w /work b441pw rm -rf "pairs/v45-$scenario"
 docker exec -w /work b441pw node pair.mjs "out/v45-v38-$scenario" "out/v45-v45-$scenario" "pairs/v45-$scenario" --fps 30 --crop "$crop" --scale "$scale" --label v38,v45
 docker exec -w /work b441pw ffmpeg -y -loglevel error -framerate 30 -i "pairs/v45-$scenario/%05d.jpg" -vf 'pad=ceil(iw/2)*2:ceil(ih/2)*2' -pix_fmt yuv420p -c:v libx264 -crf 30 "v45-$scenario.mp4"
 docker cp "b441pw:/work/v45-$scenario.mp4" "$DEST/kohako-v45-$scenario.mp4"
done
for scenario in blink slow; do
 end=2.3; [ "$scenario" = slow ] && end=2.9
 docker exec -w /work b441pw node sheet.mjs "out/v45-v38-$scenario" "out/v45-v45-$scenario" --from 1.95 --to "$end" --every 1 --cols 5 --scale 2 --crop 0.4,0.31,0.4,0.18 --out "v45-$scenario-sheet.jpg" --label v38,v45 --max 60
 docker cp "b441pw:/work/v45-$scenario-sheet.jpg" "$DEST/kohako-v45-$scenario-sheet.jpg"
done
docker exec -w /work b441pw node sheet.mjs out/v45-v38-idle out/v45-v45-idle --from 6.2 --to 6.8 --every 1 --cols 6 --scale 2 --crop 0.4,0.31,0.4,0.18 --out v45-idle-sheet.jpg --label v38,v45 --max 50
docker cp b441pw:/work/v45-idle-sheet.jpg "$DEST/kohako-v45-idle-sheet.jpg"
