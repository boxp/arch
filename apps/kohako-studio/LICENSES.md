# Licenses and provenance

- Web / BFF code: adapted from boxp/even-g2-lab at commit 4122e3e (BOXP-441). G2-only modules (candidates, board, results, context, realtime, G2 instructions) are not included.
- PSD2Live web player (`p2l.js`) and runtime (`p2l_runtime.wasm`): MIT (`targets/web` and `runtime/` crate of https://github.com/tsunehimatoi/psd2live at commit 6fe868a20c7bf12586fa8ce0a05982f099faa865; the wasm is rebuilt from that source). The PSD2Live editor/CLI itself (GPL-3.0) is not included. Full notices: `web/public/kohako/live2d/sample/LICENSES.txt`.
- Sample model `tml.p2lrt`: CC0 1.0 (psd2live-examples, cases/tml). It is not Kohako.
- Kohako models (`kohako-min` = v0, `kohako-v1`, `kohako-v2`, `kohako-v3`, `kohako-v5`, `kohako-v6`, `kohako-v11`, `kohako-v12` and comparison images) and the c48v6 expression images: derived from the Owner's original character sheet; published here with the Owner's approval. No Live2D Cubism Core / SDK file is used or included.
