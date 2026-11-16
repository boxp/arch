# BOXP-441 TD-27 (kohako-v37): v36 の backhair-anchor を当てた psd2live 6fe868a の RigBuilder.kt に、
# 後ろ髪の肩より下を「体の回転 ParamBodyAngleX」にも追従させる軸を足す（P2L_BACKHAIR_BODY=1 のときだけ効く）。
# 体層に頭髪が残っていた v36 までは、psd2live が体層のメッシュ範囲から肩線を頭の中（y≈92）と推定し、体の回転で頭ごと
# 大きく動いていた。v37 で頭髪を後ろ髪へ移すと肩線が正しくなり、首は体の回転でほぼ動かない（psd2live の設計どおり）。
# 後ろ髪は頭の子なので、肩より下の長い髪が体の回転に付いてこなくなる。そこで体側の行に、その点での胴の回転変位
# （BodyStance.bodyPoint）から頭の支点の変位を引いた分を足す。使い方: python patch_body.py <psd2live dir>
import sys
root = sys.argv[1]
p = root + '/src/main/kotlin/io/github/psd2live/core/RigBuilder.kt'
s = open(p).read()
if 'P2L_BACKHAIR_BODY' in s:
    print('already patched'); sys.exit(0)
assert 'P2L_BACKHAIR_ANCHOR' in s, 'apply kohako-v36/backhair-anchor.patch first'
reps = [
    ("config.rigTuning.hairRollHold / 100f), anchor = true)",
     "config.rigTuning.hairRollHold / 100f), anchor = true,\n"
     "\t\t\t\tbodyTurn = { x, y, bx -> val p = stance.bodyPoint(x.toDouble(), y.toDouble(), bx, 0f); "
     "val q = stance.bodyPoint(headPivotCanvas.first.toDouble(), headPivotCanvas.second.toDouble(), bx, 0f); "
     "((p[0] - x) - (q[0] - headPivotCanvas.first)).toFloat() to ((p[1] - y) - (q[1] - headPivotCanvas.second)).toFloat() })"),
    ("\t\tanchor: Boolean = false,\n\t): Deformer.Warp {",
     "\t\tanchor: Boolean = false,\n\t\tbodyTurn: ((Float, Float, Float) -> Pair<Float, Float>)? = null,\n\t): Deformer.Warp {"),
    ("\t\tval rollGain = env[\"P2L_BACKHAIR_G\"]?.toFloatOrNull() ?: 1f\n",
     "\t\tval rollGain = env[\"P2L_BACKHAIR_G\"]?.toFloatOrNull() ?: 1f\n"
     "\t\t// BOXP-441 TD-27 (kohako-v37): the length below the shoulders also follows the torso's turn (Body X).\n"
     "\t\tval withBody = anchored && bodyTurn != null && env[\"P2L_BACKHAIR_BODY\"] == \"1\"\n"
     "\t\tval bodyGain = env[\"P2L_BACKHAIR_BODY_GAIN\"]?.toFloatOrNull() ?: 1f\n"),
    ("\t\t\tif (bends) ninePoseAxes() + axis(StandardParameters.ANGLE_Z, -30f, 0f, 30f) else ninePoseAxes(),",
     "\t\t\tif (withBody) ninePoseAxes() + axis(StandardParameters.ANGLE_Z, -30f, 0f, 30f) + axis(StandardParameters.BODY_X, -10f, 0f, 10f)\n"
     "\t\t\telse if (bends) ninePoseAxes() + axis(StandardParameters.ANGLE_Z, -30f, 0f, 30f) else ninePoseAxes(),"),
    ("\t\t\t\tval dy = (rx * sin + ry * cos - ry) + values[1] / 30f * followY * onHead\n",
     "\t\t\t\tval dy = (rx * sin + ry * cos - ry) + values[1] / 30f * followY * onHead\n"
     "\t\t\t\tval (tx, ty) = if (withBody) requireNotNull(bodyTurn)(x, y, values[3]) else 0f to 0f\n"),
    ("\t\t\t\tpoint.first + dx / head.width to point.second + dy / head.height\n\t\t\t} else {",
     "\t\t\t\tpoint.first + (dx + tx * body * bodyGain) / head.width to point.second + (dy + ty * body * bodyGain) / head.height\n\t\t\t} else {"),
]
for old, new in reps:
    assert s.count(old) == 1, 'context not found once: ' + old[:60]
    s = s.replace(old, new)
open(p, 'w').write(s)
print('patched', len(reps), 'sites')
